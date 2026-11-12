/**
 * DR-29, DR-32 (c): write_file tells the change recorder how this run masked the file: the digest
 * of the original's visible parts with saveOriginal, and after a successful write the new text's
 * SHA-256 and the digest of its visible parts with saveNext. The digest is
 * SHA-256(maskedPartsEncoding(maskedParts(text masked by the run's gateway))). When masking fails
 * no digest is given and saveNext is not called. The tool's outcome does not change.
 *
 * Real workspace, real privacy gateway, real store (change recorder, journal, readRunOriginals);
 * the journal records are written here as the engine writes them after a write.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { changeShownMatches, maskedParts, maskedPartsEncoding } from "../../../src/contracts/index.js";
import type { ChangeRecorder, ContentHash, FileChange, MaskedText, PrivacyGateway, RawToolOutcome } from "../../../src/contracts/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { createChangeRecorder, createJournal, readRunOriginals } from "../../../src/store/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const RUN = "20261112T000000Z-0a1b2c3d";
const SECRET = "fake-dr32-secret-value-0001";
const BOM = "\uFEFF";
const FAIL_MARK = "MASKING-FAILS-HERE";
const never = new AbortController().signal;
const clock = { now: () => Date.UTC(2026, 10, 12, 0, 0, 0) };
const sha = (text: string): ContentHash => createHash("sha256").update(text, "utf8").digest("hex") as ContentHash;

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function workspaceRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-g-shown-write-")));
  roots.push(root);
  const journal = createJournal({ workspaceRoot: root, runId: RUN, clock });
  await journal.append({
    type: "run_started",
    schemaVersion: 1,
    taskId: "t",
    workflow: "document" as MaskedText,
    provider: "scripted",
    limits: { maxModelTurns: 1, maxToolCalls: 1, maxTotalTokens: null, maxDurationMs: 1 },
  });
  await journal.close();
  return root;
}

/** The digest a comparison view computes with `gateway` (contract: plan.ts maskedPartsEncoding). */
function digestWith(gateway: PrivacyGateway, text: string): ContentHash {
  const masked = gateway.mask(text);
  assert.ok(masked.ok, "the test's own masking works");
  return sha(maskedPartsEncoding(maskedParts(masked.text)));
}

/** The run's gateway, whose mask fails for any text holding FAIL_MARK. */
function runGateway(): PrivacyGateway {
  const real = createPrivacyGateway({ secrets: [SECRET] });
  return new Proxy(real, {
    get(target, name, receiver) {
      if (name === "mask") return (text: string) => (text.includes(FAIL_MARK) ? { ok: false, code: "masking_failed" } : target.mask(text));
      return Reflect.get(target, name, receiver);
    },
  });
}

interface Spy {
  readonly recorder: ChangeRecorder;
  readonly originals: unknown[][];
  readonly nexts: unknown[][];
}

/** The real store recorder, with its calls seen; `rejectNext` makes saveNext fail after nothing was kept. */
function spied(root: string, rejectNext = false): Spy {
  const real = createChangeRecorder({ workspaceRoot: root, runId: RUN });
  const originals: unknown[][] = [];
  const nexts: unknown[][] = [];
  const recorder: ChangeRecorder = {
    saveOriginal(...args) {
      originals.push(args);
      return real.saveOriginal(...args);
    },
    saveNext(...args) {
      nexts.push(args);
      if (rejectNext) return Promise.reject(new Error("recorder-detail-must-not-leak"));
      assert.ok(real.saveNext !== undefined);
      return real.saveNext(...args);
    },
  };
  return { recorder, originals, nexts };
}

async function write(root: string, gateway: PrivacyGateway, recorder: ChangeRecorder | undefined, path: string, change: FileChange): Promise<RawToolOutcome> {
  const workspace = await createWorkspace({ root });
  const tools = createToolRunner({ workspace, privacy: gateway, ...(recorder === undefined ? {} : { changeRecorder: recorder }) });
  let expectedHash: string | null = null;
  try {
    expectedHash = createHash("sha256").update(await readFile(join(root, path))).digest("hex");
  } catch {
    expectedHash = null;
  }
  const outcome = await tools.execute({ id: "w", name: "write_file", args: { path, expectedHash, change } }, never);
  if (outcome.ok && "newHash" in outcome.payload) {
    const payload = outcome.payload;
    const journal = createJournal({ workspaceRoot: root, runId: RUN, clock });
    await journal.append({ type: "file_changed", callId: "w", path: path as MaskedText, previousHash: payload.previousHash as ContentHash | null, newHash: payload.newHash as ContentHash, created: payload.created });
    await journal.close();
  }
  return outcome;
}

async function shownOf(root: string, path: string) {
  const entry = (await readRunOriginals({ workspaceRoot: root, runId: RUN })).find((item) => item.path === path);
  assert.ok(entry !== undefined, `the run changed ${path}`);
  return entry.shown;
}

test("DR-32 (c): a write keeps the original's digest and the new text's SHA-256 and digest (BOM and secret included)", async () => {
  const root = await workspaceRoot();
  const original = `${BOM}key: ${SECRET}\r\nname: a\r\n`;
  await writeFile(join(root, "conf.yml"), original, "utf8");
  const gateway = runGateway();
  const spy = spied(root);
  const outcome = await write(root, gateway, spy.recorder, "conf.yml", { kind: "replace_text", oldText: "name: a", newText: "name: b" });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  const written = await readFile(join(root, "conf.yml"), "utf8");
  assert.equal(written, `${BOM}key: ${SECRET}\r\nname: b\r\n`);
  assert.deepEqual(await shownOf(root, "conf.yml"), {
    original: digestWith(gateway, original),
    next: { sha256: sha(written), partsDigest: digestWith(gateway, written) },
  });
  assert.equal(spy.originals.length, 1);
  assert.equal(spy.nexts.length, 1);
  // A view with the same secret registered now (other token ids) matches; without it, it does not.
  const now = createPrivacyGateway({ secrets: [SECRET] });
  const shown = await shownOf(root, "conf.yml");
  assert.equal(changeShownMatches(shown, { original: digestWith(now, original), current: { sha256: sha(written), partsDigest: digestWith(now, written) } }), true);
  const without = createPrivacyGateway({ secrets: [] });
  assert.equal(changeShownMatches(shown, { original: digestWith(without, original), current: { sha256: sha(written), partsDigest: digestWith(without, written) } }), false);
});

test("DR-32 (c): a created file has no original digest; the last of several writes is kept", async () => {
  const root = await workspaceRoot();
  const gateway = runGateway();
  const spy = spied(root);
  // No secret here: replacing a whole file that holds one is refused (protected_span_violation).
  const first = await write(root, gateway, spy.recorder, "new.md", { kind: "replace_all", content: "first\n" });
  assert.equal(first.ok, true, JSON.stringify(first));
  const second = await write(root, gateway, spy.recorder, "new.md", { kind: "replace_all", content: "second\n" });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.deepEqual(await shownOf(root, "new.md"), { original: null, next: { sha256: sha("second\n"), partsDigest: digestWith(gateway, "second\n") } });
  assert.equal(spy.originals[0]?.[2], null, "null for a file that did not exist");
});

test("DR-32 (c): when the original cannot be masked, no digest is given and saveNext is not called; the write still succeeds", async () => {
  const root = await workspaceRoot();
  await writeFile(join(root, "a.txt"), `old ${FAIL_MARK}\n`, "utf8");
  const spy = spied(root);
  const outcome = await write(root, runGateway(), spy.recorder, "a.txt", { kind: "replace_all", content: "new\n" });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(spy.originals[0]?.length, 2, "saveOriginal gets no digest argument");
  assert.equal(spy.nexts.length, 0);
  assert.equal(await shownOf(root, "a.txt"), undefined, "the view will show no text");
});

test("DR-32 (c): when the new text cannot be masked, saveNext is not called; the original's digest stays", async () => {
  const root = await workspaceRoot();
  await writeFile(join(root, "b.txt"), "old\n", "utf8");
  const gateway = runGateway();
  const spy = spied(root);
  assert.equal((await write(root, gateway, spy.recorder, "b.txt", { kind: "replace_all", content: `new ${FAIL_MARK}\n` })).ok, true);
  assert.equal(spy.nexts.length, 0);
  assert.deepEqual(await shownOf(root, "b.txt"), { original: digestWith(gateway, "old\n"), next: null });
});

test("DR-32 (c): a saveNext that fails leaves the write's outcome as it is", async () => {
  const root = await workspaceRoot();
  const spy = spied(root, true);
  const outcome = await write(root, runGateway(), spy.recorder, "c.txt", { kind: "replace_all", content: "c\n" });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(spy.nexts.length, 1);
  assert.equal(JSON.stringify(outcome).includes("recorder-detail"), false);
});

test("DR-32 (c): the outcome is the same as without a recorder", async () => {
  const outcomes: RawToolOutcome[] = [];
  for (const withRecorder of [true, false]) {
    const root = await workspaceRoot();
    await writeFile(join(root, "same.md"), `${BOM}a ${SECRET}\nline two\n`, "utf8");
    const gateway = runGateway();
    // A distinctive oldText: a token's random hex id must not be able to match it.
    outcomes.push(await write(root, gateway, withRecorder ? spied(root).recorder : undefined, "same.md", { kind: "replace_text", oldText: "line two", newText: "line 2" }));
  }
  assert.deepEqual(outcomes[0], outcomes[1]);
});
