/**
 * F4: write_file hands the file's original to the ChangeRecorder right before it writes
 * (contracts/changes.ts, work order R-6). The recorder is a stand-in at the contract boundary.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  ChangeRecorder,
  FileChange,
  RawText,
  RawToolOutcome,
  ResolvedPath,
} from "../../../src/contracts/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import { FAKE_SECRET_A, TOKEN_A, TOKEN_UNKNOWN, createFakePrivacy, createFakeWorkspace, sha256 } from "./doubles.js";
import type { FakeWorkspace } from "./doubles.js";

const never = new AbortController().signal;

interface SaveCall {
  readonly path: ResolvedPath;
  readonly original: RawText | null;
  /** Writes the workspace had received when the save was asked for. */
  readonly writesBefore: number;
}

type Behaviour = "resolve" | "reject" | "throw" | "hold";

function fakeRecorder(workspace: FakeWorkspace, behaviour: Behaviour = "resolve") {
  const calls: SaveCall[] = [];
  const held: (() => void)[] = [];
  const changeRecorder: ChangeRecorder = {
    saveOriginal(path, original) {
      calls.push({ path, original, writesBefore: workspace.writeRequests.length });
      if (behaviour === "throw") throw new Error("recorder-detail-must-not-leak");
      if (behaviour === "reject") return Promise.reject(new Error("recorder-detail-must-not-leak"));
      if (behaviour === "hold") return new Promise<void>((resolve) => held.push(resolve));
      return Promise.resolve();
    },
  };
  /** Lets every held save finish, and later ones finish at once. */
  const release = (): void => {
    behaviour = "resolve";
    for (const resolve of held.splice(0)) resolve();
  };
  return { changeRecorder, calls, release };
}

function setup(initial: Record<string, string | Buffer>, behaviour?: Behaviour) {
  const workspace = createFakeWorkspace(initial);
  const recorder = fakeRecorder(workspace, behaviour);
  const tools = createToolRunner({
    workspace,
    privacy: createFakePrivacy(),
    changeRecorder: recorder.changeRecorder,
  });
  return { workspace, recorder, tools };
}

function hashOf(workspace: FakeWorkspace, path: string): string | null {
  const bytes = workspace.files.get(path);
  return bytes === undefined ? null : sha256(bytes);
}

function write(
  tools: ReturnType<typeof createToolRunner>,
  path: string,
  expectedHash: string | null,
  change: FileChange,
): Promise<RawToolOutcome> {
  return tools.execute({ id: "w", name: "write_file", args: { path, expectedHash, change } }, never);
}

test("F4: the exact original (raw, BOM included) is saved before the write, and the write waits for it", { timeout: 10_000 }, async () => {
  const original = `﻿key=${FAKE_SECRET_A}\r\nname=a\r\n`;
  const { workspace, recorder, tools } = setup({ "conf.ini": original }, "hold");
  const pending = write(tools, "conf.ini", hashOf(workspace, "conf.ini"), {
    kind: "replace_text",
    oldText: "name=a",
    newText: "name=b",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0]?.original, original);
  assert.equal(recorder.calls[0]?.path.relative, "conf.ini");
  assert.equal(recorder.calls[0]?.writesBefore, 0);
  assert.equal(workspace.writeRequests.length, 0, "no write while the save is pending");

  recorder.release();
  const outcome = await pending;
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(recorder.calls.length, 1, "one save per write");
  assert.equal(workspace.writeRequests.length, 1);
  assert.equal(workspace.files.get("conf.ini")?.toString("utf8"), `﻿key=${FAKE_SECRET_A}\r\nname=b\r\n`);
});

test("F4: a new file is saved as null before it is created", async () => {
  const { workspace, recorder, tools } = setup({});
  const outcome = await write(tools, "dir/new.txt", null, { kind: "replace_all", content: "hello\n" });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.deepEqual(
    recorder.calls.map((call) => ({ relative: call.path.relative, original: call.original, writesBefore: call.writesBefore })),
    [{ relative: "dir/new.txt", original: null, writesBefore: 0 }],
  );
  assert.equal(outcome.ok && "created" in outcome.payload && outcome.payload.created, true);
});

test("F4: when saving the original fails, nothing is written and the call is io_error", async () => {
  for (const behaviour of ["reject", "throw"] as const) {
    const { workspace, recorder, tools } = setup({ "a.txt": "v1\n" }, behaviour);
    const before = hashOf(workspace, "a.txt");
    const outcome = await write(tools, "a.txt", before, { kind: "replace_all", content: "v2\n" });
    assert.equal(outcome.ok, false, behaviour);
    assert.equal(outcome.ok === false && outcome.code, "io_error", behaviour);
    assert.ok(outcome.ok === false && !outcome.message.includes("recorder-detail-must-not-leak"));
    assert.equal(recorder.calls.length, 1, behaviour);
    assert.equal(workspace.writeRequests.length, 0, behaviour);
    assert.equal(hashOf(workspace, "a.txt"), before, behaviour);
  }
  // A new file is not created either.
  const created = setup({}, "reject");
  const outcome = await write(created.tools, "new.txt", null, { kind: "replace_all", content: "x" });
  assert.equal(outcome.ok === false && outcome.code, "io_error");
  assert.equal(created.workspace.files.has("new.txt"), false);
});

test("F4: nothing is saved when the change is refused before writing", async () => {
  const secretFile = `key=${FAKE_SECRET_A}\nname=a\n`;
  const cases: { name: string; code: string; path: string; expected?: string | null; change: FileChange }[] = [
    { name: "stale expectedHash", code: "conflict", path: "a.txt", expected: sha256(Buffer.from("old")), change: { kind: "replace_all", content: "x" } },
    { name: "file exists, expected new", code: "conflict", path: "a.txt", expected: null, change: { kind: "replace_all", content: "x" } },
    { name: "protected span removed", code: "protected_span_violation", path: "s.ini", change: { kind: "replace_all", content: "key=gone\n" } },
    { name: "protected span moved", code: "protected_span_violation", path: "s.ini", change: { kind: "replace_text", oldText: `key=${TOKEN_A}`, newText: `old=${TOKEN_A}${TOKEN_A}` } },
    { name: "unknown token", code: "invalid_token", path: "a.txt", change: { kind: "replace_all", content: TOKEN_UNKNOWN } },
    { name: "no match", code: "no_match", path: "a.txt", change: { kind: "replace_text", oldText: "zzz", newText: "y" } },
    { name: "ambiguous", code: "ambiguous_match", path: "d.txt", change: { kind: "replace_text", oldText: "x", newText: "y" } },
    { name: "empty oldText", code: "invalid_args", path: "a.txt", change: { kind: "replace_text", oldText: "", newText: "y" } },
    { name: "replace_text on a missing file", code: "not_found", path: "missing.txt", expected: null, change: { kind: "replace_text", oldText: "a", newText: "b" } },
    { name: "state directory", code: "policy_denied", path: ".codaryn/x.txt", expected: null, change: { kind: "replace_all", content: "x" } },
    { name: "binary file", code: "not_text", path: "bin.dat", change: { kind: "replace_all", content: "x" } },
  ];
  for (const item of cases) {
    const { workspace, recorder, tools } = setup({
      "a.txt": "one\n",
      "d.txt": "x x\n",
      "s.ini": secretFile,
      "bin.dat": Buffer.from([0x61, 0x00, 0x62]),
    });
    const expected = item.expected === undefined ? hashOf(workspace, item.path) : item.expected;
    const outcome = await write(tools, item.path, expected, item.change);
    assert.equal(outcome.ok === false && outcome.code, item.code, item.name);
    assert.equal(recorder.calls.length, 0, item.name);
    assert.equal(workspace.writeRequests.length, 0, item.name);
  }
});

test("F4: without a recorder write_file writes as before", async () => {
  const workspace = createFakeWorkspace({ "a.txt": "v1\n" });
  const tools = createToolRunner({ workspace, privacy: createFakePrivacy() });
  const outcome = await write(tools, "a.txt", hashOf(workspace, "a.txt"), { kind: "replace_all", content: "v2\n" });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(workspace.files.get("a.txt")?.toString("utf8"), "v2\n");
});

test("F4: every write hands over the text it read; keeping only the first is the recorder's job", async () => {
  const { workspace, recorder, tools } = setup({ "a.txt": "v1\n" });
  assert.equal((await write(tools, "a.txt", hashOf(workspace, "a.txt"), { kind: "replace_all", content: "v2\n" })).ok, true);
  assert.equal((await write(tools, "a.txt", hashOf(workspace, "a.txt"), { kind: "replace_all", content: "v3\n" })).ok, true);
  assert.deepEqual(
    recorder.calls.map((call) => call.original),
    ["v1\n", "v2\n"],
  );
});

test("F4: a concurrent change caught by the workspace after the save is still a conflict", async () => {
  const { workspace, recorder, tools } = setup({ "a.txt": "v1\n" });
  workspace.beforeWrite = () => workspace.files.set("a.txt", Buffer.from("user edit\n"));
  const outcome = await write(tools, "a.txt", hashOf(workspace, "a.txt"), { kind: "replace_all", content: "v2\n" });
  assert.equal(outcome.ok === false && outcome.code, "conflict");
  assert.deepEqual(recorder.calls.map((call) => call.original), ["v1\n"]);
  assert.equal(workspace.files.get("a.txt")?.toString("utf8"), "user edit\n");
});
