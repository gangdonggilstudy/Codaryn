/**
 * Regression tests for the cross review of src/tools (docs/reviews/2026-11-12-cross-review-tools.md,
 * findings 1, 2, 3 and 5). They use the real privacy gateway with fake secrets only.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_COMMAND_OUTPUT_BYTES, PRIVACY_TOKEN_PATTERN_SOURCE } from "../../../src/contracts/index.js";
import type { RawToolOutcome, RunCommandPayload, SearchFilesPayload } from "../../../src/contracts/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import {
  COMMAND_CAPTURE_SLACK_BYTES,
  MAX_SEARCH_LINE_CHARS,
  OutputCapture,
  buildChildEnv,
  createToolRunner,
  envValueFreeOfSecrets,
} from "../../../src/tools/index.js";
import { createFakeCommandRunner, createFakePrivacy, createFakeWorkspace } from "./doubles.js";

const never = new AbortController().signal;

/** 18 characters, like the review's repro. Not shaped like any real key. */
const SECRET = "fakeQZ-review-0042";
/** Longer than a privacy token (35 characters), so masking shrinks the text. */
const LONG_SECRET = `fakeLONG-${"q".repeat(80)}-review`;
const TOKEN = new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE, "g");

function privacy() {
  return createPrivacyGateway({ secrets: [SECRET, LONG_SECRET] });
}

function searchPayload(outcome: RawToolOutcome): SearchFilesPayload {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { payload: SearchFilesPayload }).payload;
}

function commandPayload(outcome: RawToolOutcome): RunCommandPayload {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { payload: RunCommandPayload }).payload;
}

/** No prefix of the secret (3 characters or more) may appear. */
function assertNoSecretPart(text: string, secret: string): void {
  for (let length = 3; length <= secret.length; length += 1) {
    assert.ok(!text.includes(secret.slice(0, length)), `secret prefix of ${length} chars leaked`);
  }
}

// ---- Finding 1: search must not be an oracle on raw text ----

test("review 1: text search with any prefix of a secret gives the same result as a non-matching text", async () => {
  const workspace = createFakeWorkspace({ "conf.ini": `key=${SECRET}\nname=demo\n` });
  const tools = createToolRunner({ workspace, privacy: privacy() });
  const search = async (text: string) =>
    searchPayload(await tools.execute({ id: "s", name: "search_files", args: { path: ".", text } }, never));

  const baseline = await search("key=zzz-no-such-value");
  assert.deepEqual(baseline, { entries: [], truncated: false });
  for (let length = 1; length <= SECRET.length; length += 1) {
    assert.deepEqual(await search(`key=${SECRET.slice(0, length)}`), baseline, `prefix length ${length}`);
  }
});

test("review 1: matching lines come back masked", async () => {
  const workspace = createFakeWorkspace({ "conf.ini": `key=${SECRET}\nname=demo\n` });
  const tools = createToolRunner({ workspace, privacy: privacy() });
  const payload = searchPayload(
    await tools.execute({ id: "s", name: "search_files", args: { path: ".", text: "key=" } }, never),
  );
  const line = payload.entries[0]?.matches?.[0];
  assert.equal(line?.line, 1);
  assert.match(line?.text ?? "", new RegExp(`^key=${PRIVACY_TOKEN_PATTERN_SOURCE}$`));
});

test("review 1: nameContains matches the masked relative path and returns it masked", async () => {
  const workspace = createFakeWorkspace({ [`notes-${SECRET}.txt`]: "x\n", "other.txt": "y\n" });
  const tools = createToolRunner({ workspace, privacy: privacy() });
  const search = async (nameContains: string) =>
    searchPayload(
      await tools.execute({ id: "s", name: "search_files", args: { path: ".", nameContains } }, never),
    );

  for (let length = 1; length <= SECRET.length; length += 1) {
    assert.deepEqual(await search(`notes-${SECRET.slice(0, length)}`), { entries: [], truncated: false });
  }
  const all = await search(".txt");
  assert.equal(all.entries.length, 2);
  for (const entry of all.entries) assertNoSecretPart(entry.path, SECRET);
  assert.match(all.entries[0]?.path ?? "", new RegExp(`^notes-${PRIVACY_TOKEN_PATTERN_SOURCE}\\.txt$`));
});

test("review 1: a masking failure fails the whole search instead of dropping the file", async () => {
  const workspace = createFakeWorkspace({ "a.txt": "needle\n", "b.txt": "needle\n" });
  const fake = createFakePrivacy();
  fake.failMask = true;
  const tools = createToolRunner({ workspace, privacy: fake });
  for (const args of [
    { path: ".", text: "needle" },
    { path: ".", nameContains: "a" },
  ]) {
    const outcome = await tools.execute({ id: "s", name: "search_files", args }, never);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.code, "masking_failed");
  }
});

// ---- Finding 2: line cut after masking, never inside a token ----

test("review 2: a secret across the line limit leaves no prefix and no partial token", async () => {
  const workspace = createFakeWorkspace({ "long.txt": `${"x".repeat(995)}${SECRET}\n` });
  const tools = createToolRunner({ workspace, privacy: privacy() });
  const payload = searchPayload(
    await tools.execute({ id: "s", name: "search_files", args: { path: ".", text: "x" } }, never),
  );
  const text = payload.entries[0]?.matches?.[0]?.text ?? "";
  assertNoSecretPart(text, SECRET);
  assert.equal(text, "x".repeat(995));
  assert.ok(!text.includes("[["), "no partial token");
  assert.equal(payload.truncated, true);
});

test("review 2: a token that ends before the line limit is kept whole", async () => {
  const workspace = createFakeWorkspace({ "long.txt": `${SECRET}${"x".repeat(2000)}\n` });
  const tools = createToolRunner({ workspace, privacy: privacy() });
  const payload = searchPayload(
    await tools.execute({ id: "s", name: "search_files", args: { path: ".", text: "x" } }, never),
  );
  const text = payload.entries[0]?.matches?.[0]?.text ?? "";
  assert.equal(text.length, MAX_SEARCH_LINE_CHARS);
  assert.equal(text.match(TOKEN)?.length, 1);
  assert.ok(text.startsWith("[[CODARYN_SECRET:"));
});

// ---- Finding 3: command output cap after masking ----

test("review 3: a secret across the output cap leaves no prefix and no partial token", async () => {
  const raw = `${"y".repeat(65_530)}${SECRET}`;
  const tools = createToolRunner({
    workspace: createFakeWorkspace(),
    privacy: privacy(),
    commandRunner: createFakeCommandRunner(async () => ({
      exitCode: 0,
      stdout: raw,
      stderr: raw,
      timedOut: false,
      truncated: false,
    })),
  });
  const payload = commandPayload(
    await tools.execute({ id: "c", name: "run_command", args: { executable: "node", args: [] } }, never),
  );
  for (const stream of [payload.stdout, payload.stderr]) {
    assertNoSecretPart(stream, SECRET);
    assert.ok(Buffer.byteLength(stream, "utf8") <= MAX_COMMAND_OUTPUT_BYTES);
    assert.equal(stream, "y".repeat(65_530));
  }
  assert.equal(payload.truncated, true);
});

test("review 3: output is returned masked and short output keeps every byte", async () => {
  const tools = createToolRunner({
    workspace: createFakeWorkspace(),
    privacy: privacy(),
    commandRunner: createFakeCommandRunner(async () => ({
      exitCode: 1,
      stdout: `token is ${SECRET}\n한글\n`,
      stderr: "",
      timedOut: false,
      truncated: false,
    })),
  });
  const payload = commandPayload(
    await tools.execute({ id: "c", name: "run_command", args: { executable: "node", args: [] } }, never),
  );
  assert.match(payload.stdout, new RegExp(`^token is ${PRIVACY_TOKEN_PATTERN_SOURCE}\\n한글\\n$`));
  assert.equal(payload.truncated, false);
  assert.equal(payload.exitCode, 1);
});

test("review 3: when masking shrinks the text, the cut capture end still leaks nothing", async () => {
  // The runner stopped capturing in the middle of a long secret. Many earlier copies of that
  // secret shrink the masked text far below the cap, so a byte cap alone would keep the tail.
  const capture = MAX_COMMAND_OUTPUT_BYTES + COMMAND_CAPTURE_SLACK_BYTES;
  const head = `${LONG_SECRET}\n`.repeat(100);
  const tail = LONG_SECRET.slice(0, 50);
  const raw = head + "z".repeat(capture - head.length - tail.length) + tail;
  assert.equal(Buffer.byteLength(raw), capture);
  const tools = createToolRunner({
    workspace: createFakeWorkspace(),
    privacy: privacy(),
    commandRunner: createFakeCommandRunner(async () => ({
      exitCode: 0,
      stdout: raw,
      stderr: "",
      timedOut: false,
      truncated: true,
    })),
  });
  const payload = commandPayload(
    await tools.execute({ id: "c", name: "run_command", args: { executable: "node", args: [] } }, never),
  );
  assertNoSecretPart(payload.stdout, LONG_SECRET);
  assert.equal(payload.stdout.match(TOKEN)?.length, 100);
  assert.equal(payload.truncated, true);
});

test("review 3: masking failure of command output fails the call", async () => {
  const fake = createFakePrivacy();
  fake.failMask = true;
  const tools = createToolRunner({
    workspace: createFakeWorkspace(),
    privacy: fake,
    commandRunner: createFakeCommandRunner(async () => ({
      exitCode: 0,
      stdout: "out",
      stderr: "",
      timedOut: false,
      truncated: false,
    })),
  });
  const outcome = await tools.execute(
    { id: "c", name: "run_command", args: { executable: "node", args: [] } },
    never,
  );
  assert.equal(outcome.ok === false && outcome.code, "masking_failed");
});

test("review 3: the runner capture keeps the slack beyond the cap and marks only real loss", () => {
  const capture = new OutputCapture(MAX_COMMAND_OUTPUT_BYTES + COMMAND_CAPTURE_SLACK_BYTES);
  capture.push(Buffer.from(`${"y".repeat(65_530)}${SECRET}`));
  assert.equal(capture.text(), `${"y".repeat(65_530)}${SECRET}`);
  assert.equal(capture.truncated, false);
  capture.push(Buffer.alloc(COMMAND_CAPTURE_SLACK_BYTES, 0x7a));
  assert.equal(capture.truncated, true);
  assert.equal(Buffer.byteLength(capture.text()), MAX_COMMAND_OUTPUT_BYTES + COMMAND_CAPTURE_SLACK_BYTES);
});

// ---- Finding 5: allow-listed variables that carry a registered secret ----

test("review 5: an allow-listed variable whose value holds a registered secret is not passed", () => {
  const allow = envValueFreeOfSecrets(privacy());
  const parent = {
    PATH: "C:\\bin",
    TMP: `C:\\tmp\\${SECRET}`,
    HOME: `C:\\users\\${Buffer.from(SECRET).toString("base64")}`,
    TEMP: "C:\\temp",
  };
  assert.deepEqual(buildChildEnv(parent, "win32", allow), { PATH: "C:\\bin", TEMP: "C:\\temp" });
});

test("review 5: a value check that cannot mask drops the variable", () => {
  const fake = createFakePrivacy();
  fake.failMask = true;
  assert.deepEqual(buildChildEnv({ PATH: "C:\\bin" }, "win32", envValueFreeOfSecrets(fake)), {});
});
