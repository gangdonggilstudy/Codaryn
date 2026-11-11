import assert from "node:assert/strict";
import { test } from "node:test";

import type { FileChange, RawToolOutcome } from "../../../src/contracts/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import {
  FAKE_SECRET_A,
  FAKE_SECRET_B,
  TOKEN_A,
  TOKEN_B,
  TOKEN_UNKNOWN,
  createFakePrivacy,
  createFakeWorkspace,
  sha256,
  utf8,
} from "./doubles.js";
import type { FakeWorkspace } from "./doubles.js";

const never = new AbortController().signal;

function setup(initial: Record<string, string | Buffer> = {}) {
  const workspace = createFakeWorkspace(initial);
  const privacy = createFakePrivacy();
  const tools = createToolRunner({ workspace, privacy });
  return { workspace, privacy, tools };
}

function hashOf(workspace: FakeWorkspace, path: string): string {
  const bytes = workspace.files.get(path);
  assert.ok(bytes, `missing file ${path}`);
  return sha256(bytes);
}

async function write(
  tools: ReturnType<typeof createToolRunner>,
  path: string,
  expectedHash: string | null,
  change: FileChange,
): Promise<RawToolOutcome> {
  return tools.execute(
    { id: "c1", name: "write_file", args: { path, expectedHash, change } },
    never,
  );
}

function assertFailed(outcome: RawToolOutcome, code: string): void {
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.code, code);
}

test("WS-05: replace_text with no occurrence is no_match and nothing is written", async () => {
  const { workspace, tools } = setup({ "a.txt": "one\ntwo\n" });
  const before = hashOf(workspace, "a.txt");
  const outcome = await write(tools, "a.txt", before, {
    kind: "replace_text",
    oldText: "three",
    newText: "3",
  });
  assertFailed(outcome, "no_match");
  assert.equal(workspace.writeRequests.length, 0);
  assert.equal(hashOf(workspace, "a.txt"), before);
});

test("WS-05: replace_text with several occurrences is ambiguous_match and nothing is written", async () => {
  const { workspace, tools } = setup({ "a.txt": "x = 1\nx = 1\n" });
  const before = hashOf(workspace, "a.txt");
  const outcome = await write(tools, "a.txt", before, {
    kind: "replace_text",
    oldText: "x = 1",
    newText: "x = 2",
  });
  assertFailed(outcome, "ambiguous_match");
  assert.equal(workspace.writeRequests.length, 0);
  assert.equal(hashOf(workspace, "a.txt"), before);
});

test("WS-05: overlapping occurrences count as ambiguous", async () => {
  const { workspace, tools } = setup({ "a.txt": "aaa" });
  const outcome = await write(tools, "a.txt", hashOf(workspace, "a.txt"), {
    kind: "replace_text",
    oldText: "aa",
    newText: "b",
  });
  assertFailed(outcome, "ambiguous_match");
  assert.equal(workspace.writeRequests.length, 0);
});

test("replace_text keeps BOM, CRLF, multibyte text and untouched bytes", async () => {
  const original = "﻿첫 줄\r\n둘째 줄\r\n셋째 줄\r\n";
  const { workspace, tools } = setup({ "문서/메모.txt": original });
  const before = hashOf(workspace, "문서/메모.txt");
  const outcome = await write(tools, "문서/메모.txt", before, {
    kind: "replace_text",
    oldText: "둘째 줄",
    newText: "바뀐 줄",
  });
  assert.equal(outcome.ok, true);
  const expected = utf8("﻿첫 줄\r\n바뀐 줄\r\n셋째 줄\r\n");
  assert.deepEqual(workspace.files.get("문서/메모.txt"), expected);
  assert.deepEqual(outcome.ok && outcome.payload, {
    path: "문서/메모.txt",
    previousHash: before,
    newHash: sha256(expected),
    created: false,
  });
});

test("replace_all on a file with BOM puts the BOM back exactly once", async () => {
  const { workspace, tools } = setup({ "a.txt": "﻿old\n", "b.txt": "﻿old\n" });
  await write(tools, "a.txt", hashOf(workspace, "a.txt"), { kind: "replace_all", content: "new\n" });
  await write(tools, "b.txt", hashOf(workspace, "b.txt"), {
    kind: "replace_all",
    content: "﻿new\n",
  });
  assert.deepEqual(workspace.files.get("a.txt"), utf8("﻿new\n"));
  assert.deepEqual(workspace.files.get("b.txt"), utf8("﻿new\n"));
});

test("replace_text matches in the masked context and keeps protected bytes in place", async () => {
  const original = `key = ${FAKE_SECRET_A}\nname = old\n`;
  const { workspace, tools } = setup({ "conf.ini": original });
  const outcome = await write(tools, "conf.ini", hashOf(workspace, "conf.ini"), {
    kind: "replace_text",
    oldText: `key = ${TOKEN_A}\nname = old`,
    newText: `key = ${TOKEN_A}\nname = new`,
  });
  assert.equal(outcome.ok, true);
  assert.deepEqual(workspace.files.get("conf.ini"), utf8(`key = ${FAKE_SECRET_A}\nname = new\n`));
});

test("replace_text does not match raw secret text: matching happens on the masked context", async () => {
  const { workspace, tools } = setup({ "conf.ini": `key = ${FAKE_SECRET_A}\n` });
  const before = hashOf(workspace, "conf.ini");
  const outcome = await write(tools, "conf.ini", before, {
    kind: "replace_text",
    oldText: FAKE_SECRET_A,
    newText: "x",
  });
  assertFailed(outcome, "no_match");
  assert.equal(workspace.writeRequests.length, 0);
});

test("failure messages do not contain file content or secrets", async () => {
  const { workspace, tools } = setup({ "conf.ini": `key = ${FAKE_SECRET_A}\n` });
  const outcome = await write(tools, "conf.ini", hashOf(workspace, "conf.ini"), {
    kind: "replace_text",
    oldText: TOKEN_A,
    newText: `${TOKEN_A}${TOKEN_A}`,
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.ok === false && !outcome.message.includes(FAKE_SECRET_A));
});

const violations: { name: string; file: string; change: FileChange }[] = [
  {
    name: "token copied to a new position",
    file: "conf.ini",
    change: { kind: "replace_text", oldText: "name = old", newText: `name = ${TOKEN_A}` },
  },
  {
    name: "token removed",
    file: "conf.ini",
    change: { kind: "replace_text", oldText: `key = ${TOKEN_A}`, newText: "key = none" },
  },
  {
    name: "token removed by replace_all",
    file: "conf.ini",
    change: { kind: "replace_all", content: "name = new\n" },
  },
  {
    name: "tokens reordered",
    file: "two.ini",
    change: { kind: "replace_all", content: `a = ${TOKEN_B}\nb = ${TOKEN_A}\n` },
  },
  {
    name: "token of another file inserted",
    file: "plain.txt",
    change: { kind: "replace_text", oldText: "hello", newText: TOKEN_A },
  },
];

for (const violation of violations) {
  test(`PR-07 (tool level): ${violation.name} is rejected with no write request`, async () => {
    const { workspace, tools } = setup({
      "conf.ini": `key = ${FAKE_SECRET_A}\nname = old\n`,
      "two.ini": `a = ${FAKE_SECRET_A}\nb = ${FAKE_SECRET_B}\n`,
      "plain.txt": "hello\n",
    });
    const before = hashOf(workspace, violation.file);
    const outcome = await write(tools, violation.file, before, violation.change);
    assertFailed(outcome, "protected_span_violation");
    assert.equal(workspace.writeRequests.length, 0);
    assert.equal(hashOf(workspace, violation.file), before);
  });
}

test("PR-07 (tool level): a token in a new file is rejected and the file is not created", async () => {
  const { workspace, tools } = setup();
  const outcome = await write(tools, "new.txt", null, {
    kind: "replace_all",
    content: `leak = ${TOKEN_A}\n`,
  });
  assertFailed(outcome, "protected_span_violation");
  assert.equal(workspace.writeRequests.length, 0);
  assert.equal(workspace.files.has("new.txt"), false);
});

test("a token that was never issued is rejected as invalid_token with no write request", async () => {
  const { workspace, tools } = setup({ "plain.txt": "hello\n" });
  const outcome = await write(tools, "plain.txt", hashOf(workspace, "plain.txt"), {
    kind: "replace_all",
    content: TOKEN_UNKNOWN,
  });
  assertFailed(outcome, "invalid_token");
  assert.equal(workspace.writeRequests.length, 0);
});

test("masking failure stops replace_text before any write request", async () => {
  const { workspace, privacy, tools } = setup({ "a.txt": "one\n" });
  privacy.failMask = true;
  const outcome = await write(tools, "a.txt", hashOf(workspace, "a.txt"), {
    kind: "replace_text",
    oldText: "one",
    newText: "two",
  });
  assertFailed(outcome, "masking_failed");
  assert.equal(workspace.writeRequests.length, 0);
});

test("conflict: a stale expectedHash writes nothing", async () => {
  const { workspace, tools } = setup({ "a.txt": "current\n" });
  const before = hashOf(workspace, "a.txt");
  const outcome = await write(tools, "a.txt", sha256(utf8("older\n")), {
    kind: "replace_all",
    content: "mine\n",
  });
  assertFailed(outcome, "conflict");
  assert.equal(workspace.writeRequests.length, 0);
  assert.equal(hashOf(workspace, "a.txt"), before);
});

test("conflict: expectedHash null on an existing file writes nothing", async () => {
  const { workspace, tools } = setup({ "a.txt": "current\n" });
  const outcome = await write(tools, "a.txt", null, { kind: "replace_all", content: "mine\n" });
  assertFailed(outcome, "conflict");
  assert.deepEqual(workspace.files.get("a.txt"), utf8("current\n"));
});

test("conflict: a hash for a file that does not exist creates nothing", async () => {
  const { workspace, tools } = setup();
  const outcome = await write(tools, "a.txt", sha256(utf8("x")), {
    kind: "replace_all",
    content: "mine\n",
  });
  assertFailed(outcome, "conflict");
  assert.equal(workspace.files.has("a.txt"), false);
});

test("conflict reported by the workspace (file changed after the snapshot) is passed on", async () => {
  const { workspace, tools } = setup({ "a.txt": "current\n" });
  workspace.beforeWrite = () => workspace.files.set("a.txt", utf8("changed by someone else\n"));
  const outcome = await write(tools, "a.txt", hashOf(workspace, "a.txt"), {
    kind: "replace_all",
    content: "mine\n",
  });
  assertFailed(outcome, "conflict");
  assert.deepEqual(workspace.files.get("a.txt"), utf8("changed by someone else\n"));
});

test("a new file is created with expectedHash null", async () => {
  const { workspace, tools } = setup();
  const outcome = await write(tools, "dir/new.txt", null, { kind: "replace_all", content: "hi\n" });
  assert.deepEqual(outcome.ok && outcome.payload, {
    path: "dir/new.txt",
    previousHash: null,
    newHash: sha256(utf8("hi\n")),
    created: true,
  });
  assert.deepEqual(workspace.files.get("dir/new.txt"), utf8("hi\n"));
});

test("replace_text on a missing file is not_found", async () => {
  const { workspace, tools } = setup();
  const outcome = await write(tools, "a.txt", null, {
    kind: "replace_text",
    oldText: "a",
    newText: "b",
  });
  assertFailed(outcome, "not_found");
  assert.equal(workspace.writeRequests.length, 0);
});

test("a path the workspace rejects is never read or written", async () => {
  const { workspace, tools } = setup();
  for (const path of ["../outside.txt", ".codaryn/lock.json"]) {
    const outcome = await write(tools, path, null, { kind: "replace_all", content: "x" });
    assertFailed(outcome, "policy_denied");
  }
  assert.equal(workspace.readCalls.length, 0);
  assert.equal(workspace.writeRequests.length, 0);
  assert.deepEqual(
    workspace.resolveCalls.map((call) => call.access),
    ["write", "write"],
  );
});
