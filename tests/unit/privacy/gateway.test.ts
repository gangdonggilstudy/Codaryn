import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PrivacyGateway } from "../../../src/contracts/privacy.js";
import { asRawText, PRIVACY_TOKEN_PATTERN_SOURCE } from "../../../src/contracts/text.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";

// Fake secrets only. None of them follows a real key format.
const SECRET = 'fake pw/"q"&한글-0001';
const OTHER = "fake-other-비밀-0002";

/** Deterministic random source: 1, 2, 3 ... offset by `seed` in the first byte. */
function counterRandom(seed = 0): (size: number) => Uint8Array {
  let n = 0;
  return (size) => {
    const bytes = new Uint8Array(size);
    n += 1;
    bytes[0] = seed;
    bytes[size - 1] = n & 0xff;
    bytes[size - 2] = (n >> 8) & 0xff;
    return bytes;
  };
}

function gatewayFor(secrets: readonly string[] = [SECRET, OTHER], seed = 0): PrivacyGateway {
  return createPrivacyGateway({ secrets, randomBytes: counterRandom(seed) });
}

function maskOk(gateway: PrivacyGateway, text: string): string {
  const outcome = gateway.mask(text);
  assert.equal(outcome.ok, true);
  return outcome.ok ? outcome.text : "";
}

function tokensIn(text: string): string[] {
  return [...text.matchAll(new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE, "g"))].map((m) => m[0]);
}

function variantsOf(secret: string): Record<string, string> {
  const bytes = Buffer.from(secret, "utf8");
  return {
    base64: bytes.toString("base64"),
    url: encodeURIComponent(secret),
    json: JSON.stringify(secret).slice(1, -1),
    hexLower: bytes.toString("hex"),
    hexUpper: bytes.toString("hex").toUpperCase(),
  };
}

function assertNoSecret(value: unknown, secrets: readonly string[] = [SECRET, OTHER]): void {
  const dump = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of secrets) {
    assert.equal(dump.includes(secret), false);
    for (const variant of Object.values(variantsOf(secret))) {
      assert.equal(dump.includes(variant), false);
    }
  }
}

describe("privacy gateway: mask", () => {
  it("PR-01 same secret gets the same token within and across inputs", () => {
    const gateway = gatewayFor();
    const first = maskOk(gateway, `a=${SECRET}; b=${SECRET}`);
    const second = maskOk(gateway, `다른 입력 ${SECRET} 끝`);
    const tokens = [...tokensIn(first), ...tokensIn(second)];
    assert.equal(tokens.length, 3);
    assert.equal(new Set(tokens).size, 1);
    assert.equal(first, `a=${tokens[0]}; b=${tokens[0]}`);
    assert.equal(second, `다른 입력 ${tokens[0]} 끝`);
    assertNoSecret(first + second);
  });

  it("PR-02 listed variants are masked, each as its own entry restoring to itself", () => {
    const gateway = gatewayFor();
    const variants = variantsOf(SECRET);
    const seen = new Set<string>();
    for (const [name, variant] of Object.entries(variants)) {
      assert.notEqual(variant, SECRET, name);
      const masked = maskOk(gateway, `x:${variant}:y`);
      assertNoSecret(masked);
      const tokens = tokensIn(masked);
      assert.equal(tokens.length, 1, name);
      assert.equal(masked, `x:${tokens[0]}:y`, name);
      seen.add(tokens[0] ?? "");
      const resolved = gateway.resolveToolArgs({
        args: { value: tokens[0] ?? "" },
        restoreFields: ["value"],
        documentFields: [],
      });
      assert.deepEqual(resolved, { ok: true, args: { value: variant }, restoredFields: ["value"] });
    }
    seen.add(tokensIn(maskOk(gateway, SECRET))[0] ?? "");
    assert.equal(seen.size, 6);
  });

  it("does not register a variant that equals the raw value twice", () => {
    // Plain lowercase ASCII: URL encoding and JSON escaping equal the raw value.
    const gateway = gatewayFor(["fakeplainvalue"]);
    const masked = maskOk(gateway, "fakeplainvalue fakeplainvalue");
    const tokens = tokensIn(masked);
    assert.equal(tokens.length, 2);
    assert.equal(tokens[0], tokens[1]);
  });

  it("uses leftmost-longest matching in one pass", () => {
    const gateway = gatewayFor(["fake-abc", "fake-abc-longer"]);
    const masked = maskOk(gateway, "v=fake-abc-longer;w=fake-abc;");
    const tokens = tokensIn(masked);
    assert.equal(tokens.length, 2);
    assert.notEqual(tokens[0], tokens[1]);
    assert.equal(masked, `v=${tokens[0]};w=${tokens[1]};`);
    const resolved = gateway.resolveToolArgs({
      args: { a: tokens[0] ?? "", b: tokens[1] ?? "" },
      restoreFields: ["a", "b"],
      documentFields: [],
    });
    assert.equal(resolved.ok, true);
    if (resolved.ok) assert.deepEqual(resolved.args, { a: "fake-abc-longer", b: "fake-abc" });
  });

  it("leaves already issued tokens unchanged", () => {
    const gateway = gatewayFor();
    const once = maskOk(gateway, `첫 줄 ${SECRET}\r\n둘째 ${OTHER}`);
    assert.equal(maskOk(gateway, once), once);
    assert.equal(maskOk(gateway, `${once} + ${SECRET}`), `${once} + ${tokensIn(once)[0]}`);
  });

  it("masks a secret hidden inside a token-shaped string that was never issued", () => {
    const gateway = gatewayFor(["fa4e0000deadbeef"]);
    const masked = maskOk(gateway, "[[CODARYN_SECRET:fa4e0000deadbeef]]");
    assert.equal(masked.includes("fa4e0000deadbeef"), false);
  });

  it("builds token ids from the random source, not from the value", () => {
    const a = tokensIn(maskOk(gatewayFor([SECRET], 1), SECRET))[0];
    const b = tokensIn(maskOk(gatewayFor([SECRET], 2), SECRET))[0];
    assert.equal(a, "[[CODARYN_SECRET:0100000000000001]]");
    assert.equal(b, "[[CODARYN_SECRET:0200000000000001]]");
  });

  it("PR-10 masks a tool result that is a JSON string", () => {
    const gateway = gatewayFor();
    const result = JSON.stringify({
      stdout: `token=${SECRET}\r\nhex=${variantsOf(OTHER).hexLower}`,
      nested: [{ value: OTHER }],
    });
    const masked = maskOk(gateway, result);
    assertNoSecret(masked);
    assert.equal(tokensIn(masked).length, 3);
    assert.doesNotThrow(() => JSON.parse(masked));
  });

  it("PR-11 returns masking_failed instead of throwing when the random source fails", () => {
    const throwing = createPrivacyGateway({
      secrets: [SECRET],
      randomBytes: () => {
        throw new Error("no entropy");
      },
    });
    assert.deepEqual(throwing.mask(`a ${SECRET}`), { ok: false, code: "masking_failed" });

    const short = createPrivacyGateway({ secrets: [SECRET], randomBytes: () => new Uint8Array(2) });
    assert.deepEqual(short.mask(`a ${SECRET}`), { ok: false, code: "masking_failed" });

    const stuck = createPrivacyGateway({
      secrets: [SECRET, OTHER],
      randomBytes: (size) => new Uint8Array(size),
    });
    const outcome = stuck.mask(`${SECRET} ${OTHER}`);
    assert.deepEqual(outcome, { ok: false, code: "masking_failed" });
  });

  it("rejects an empty secret at creation without echoing other secrets", () => {
    assert.throws(
      () => createPrivacyGateway({ secrets: [SECRET, ""] }),
      (error: unknown) => error instanceof TypeError && !error.message.includes(SECRET),
    );
  });

  it("works with the default random source", () => {
    const gateway = createPrivacyGateway({ secrets: [SECRET] });
    const masked = maskOk(gateway, SECRET);
    assert.match(masked, new RegExp(`^${PRIVACY_TOKEN_PATTERN_SOURCE}$`));
  });
});

describe("privacy gateway: resolveToolArgs", () => {
  it("restores only restoreFields and leaves documentFields untouched", () => {
    const gateway = gatewayFor();
    const [token] = tokensIn(maskOk(gateway, SECRET));
    const [other] = tokensIn(maskOk(gateway, OTHER));
    assert.ok(token && other);
    const args = {
      env: { API: token, list: [`p=${other}`, "plain"] },
      content: `문서 ${token}\r\n`,
      count: 3,
      flag: true,
      none: null,
    };
    const outcome = gateway.resolveToolArgs({
      args,
      restoreFields: ["env"],
      documentFields: ["content"],
    });
    assert.deepEqual(outcome, {
      ok: true,
      args: {
        env: { API: SECRET, list: [`p=${OTHER}`, "plain"] },
        content: `문서 ${token}\r\n`,
        count: 3,
        flag: true,
        none: null,
      },
      restoredFields: ["env.API", "env.list.0"],
    });
    assert.equal(args.env.API, token);
  });

  it("PR-08 rejects the call when a non-restorable field still holds the token", () => {
    const gateway = gatewayFor();
    const [token] = tokensIn(maskOk(gateway, SECRET));
    assert.ok(token);
    const outcome = gateway.resolveToolArgs({
      args: { header: token, command: `curl -H ${token}` },
      restoreFields: ["header"],
      documentFields: [],
    });
    assert.deepEqual(outcome, { ok: false, code: "unresolved_token", field: "command" });
    assertNoSecret(outcome);
  });

  it("reports unresolved tokens in nested objects, arrays and keys", () => {
    const gateway = gatewayFor();
    const [token] = tokensIn(maskOk(gateway, SECRET));
    assert.ok(token);
    const nested = gateway.resolveToolArgs({
      args: { a: { b: ["x", { c: `v ${token}` }] } },
      restoreFields: [],
      documentFields: [],
    });
    assert.deepEqual(nested, { ok: false, code: "unresolved_token", field: "a.b.1.c" });
    const key = gateway.resolveToolArgs({
      args: { a: { [token]: "x" } },
      restoreFields: ["a"],
      documentFields: [],
    });
    assert.equal(key.ok, false);
    if (!key.ok) assert.equal(key.code, "unresolved_token");
    assertNoSecret(key);
  });

  it("PR-03 rejects truncated, case-changed and never-issued tokens", () => {
    // Seed 0xab puts letters in the id, so the case-changed forms differ from the issued token.
    const gateway = gatewayFor([SECRET, OTHER], 0xab);
    const [token] = tokensIn(maskOk(gateway, SECRET));
    assert.ok(token);
    const altered = [
      token.slice(0, -3),
      token.slice(2),
      token.toLowerCase(),
      token.replace(/[0-9a-f]{16}/, (id) => id.toUpperCase()),
      token.replace(/[0-9a-f]{16}/, (id) => id.slice(1)),
      "[[CODARYN_SECRET:ffffffffffffffff]]",
      `${token} and codaryn_secret`,
    ];
    for (const value of altered) {
      for (const restoreFields of [["value"], []]) {
        const outcome = gateway.resolveToolArgs({
          args: { value },
          restoreFields,
          documentFields: [],
        });
        assert.deepEqual(outcome, { ok: false, code: "invalid_token", field: "value" }, value);
        assertNoSecret(outcome);
      }
    }
  });

  it("PR-05 rejects a token issued by another run", () => {
    const current = gatewayFor([SECRET], 1);
    const previous = gatewayFor([SECRET], 2);
    maskOk(current, SECRET);
    const [foreign] = tokensIn(maskOk(previous, SECRET));
    assert.ok(foreign);
    const outcome = current.resolveToolArgs({
      args: { value: foreign },
      restoreFields: ["value"],
      documentFields: [],
    });
    assert.deepEqual(outcome, { ok: false, code: "invalid_token", field: "value" });
    assert.deepEqual(
      current.rebuildDocument({ original: asRawText(`k=${SECRET}`), maskedNext: `k=${foreign}` }),
      { ok: false, code: "invalid_token" },
    );
  });

  it("keeps a __proto__ key as plain data", () => {
    const gateway = gatewayFor();
    const args = JSON.parse('{"__proto__": {"x": "y"}, "a": "b"}') as Record<string, string>;
    const outcome = gateway.resolveToolArgs({ args, restoreFields: [], documentFields: [] });
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(JSON.stringify(outcome.args), '{"__proto__":{"x":"y"},"a":"b"}');
      assert.equal(Object.getPrototypeOf(outcome.args), Object.prototype);
    }
  });
});

describe("privacy gateway: rebuildDocument", () => {
  const original = asRawText(
    [
      "# 설정 문서",
      `키 = "${SECRET}"`,
      "설명: 첫 번째 줄",
      `인코딩 = ${variantsOf(SECRET).base64}`,
      `다시 = ${SECRET} / ${OTHER}`,
      "끝",
      "",
    ].join("\r\n"),
  );

  it("PR-06 keeps protected spans byte-identical in a Korean CRLF document", () => {
    const gateway = gatewayFor();
    const masked = maskOk(gateway, original);
    assertNoSecret(masked);
    assert.equal(tokensIn(masked).length, 4);
    const maskedNext = masked
      .replace("설명: 첫 번째 줄", "설명: 바뀐 줄 🙂")
      .replace("끝\r\n", "끝\r\n추가 줄\n");
    const outcome = gateway.rebuildDocument({ original, maskedNext });
    const expected = original
      .replace("설명: 첫 번째 줄", "설명: 바뀐 줄 🙂")
      .replace("끝\r\n", "끝\r\n추가 줄\n");
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.deepEqual(Buffer.from(outcome.text, "utf8"), Buffer.from(expected, "utf8"));
    }
    const same = gateway.rebuildDocument({ original, maskedNext: masked });
    assert.deepEqual(same, { ok: true, text: original });
  });

  it("restores each token from the span at the same position, not by value lookup", () => {
    // The file already holds a literal copy of an issued token. It must stay a literal.
    const gateway = gatewayFor();
    const [token] = tokensIn(maskOk(gateway, SECRET));
    assert.ok(token);
    const doc = asRawText(`literal ${token}\r\nreal ${SECRET}\r\n`);
    const masked = maskOk(gateway, doc);
    assert.equal(masked, `literal ${token}\r\nreal ${token}\r\n`);
    const outcome = gateway.rebuildDocument({ original: doc, maskedNext: `${masked}tail` });
    assert.deepEqual(outcome, { ok: true, text: `${doc}tail` });
  });

  it("PR-07 rejects new, duplicated, moved, removed and altered tokens", () => {
    const gateway = gatewayFor();
    const masked = maskOk(gateway, original);
    const [first, second, , fourth] = tokensIn(masked);
    assert.ok(first && second && fourth);
    const violation = { ok: false, code: "protected_span_violation" };

    const duplicated = `${masked}복사 = ${first}\r\n`;
    assert.deepEqual(gateway.rebuildDocument({ original, maskedNext: duplicated }), violation);

    const removed = masked.replace(second, "");
    assert.deepEqual(gateway.rebuildDocument({ original, maskedNext: removed }), violation);

    const moved = masked.replace(second, "@@").replace(fourth, second).replace("@@", fourth);
    assert.equal(tokensIn(moved).length, 4);
    assert.deepEqual(gateway.rebuildDocument({ original, maskedNext: moved }), violation);

    const swappedKind = masked.replace(fourth, first);
    assert.deepEqual(gateway.rebuildDocument({ original, maskedNext: swappedKind }), violation);

    for (const altered of [
      masked.replace(first, first.slice(0, -1)),
      masked.replace(first, first.toLowerCase()),
      masked.replace(second, "[[CODARYN_SECRET:ffffffffffffffff]]"),
    ]) {
      const outcome = gateway.rebuildDocument({ original, maskedNext: altered });
      assert.deepEqual(outcome, { ok: false, code: "invalid_token" });
    }
  });

  it("PR-07 rejects any token when the file does not exist yet", () => {
    const gateway = gatewayFor();
    const [token] = tokensIn(maskOk(gateway, SECRET));
    assert.ok(token);
    assert.deepEqual(gateway.rebuildDocument({ original: null, maskedNext: `새 파일 ${token}` }), {
      ok: false,
      code: "protected_span_violation",
    });
    assert.deepEqual(
      gateway.rebuildDocument({ original: null, maskedNext: "x [[CODARYN_SECRET:ffffffffffffffff]]" }),
      { ok: false, code: "invalid_token" },
    );
    assert.deepEqual(gateway.rebuildDocument({ original: null, maskedNext: "새 파일\r\n본문" }), {
      ok: true,
      text: "새 파일\r\n본문",
    });
  });

  it("rejects a token moved in from another file", () => {
    const gateway = gatewayFor();
    const [token] = tokensIn(maskOk(gateway, `other file ${SECRET}`));
    assert.ok(token);
    const outcome = gateway.rebuildDocument({
      original: asRawText("비밀 없는 파일\r\n"),
      maskedNext: `비밀 없는 파일\r\n${token}\r\n`,
    });
    assert.deepEqual(outcome, { ok: false, code: "protected_span_violation" });
  });
});
