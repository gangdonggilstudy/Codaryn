/**
 * U-173 (DR-72, the text editing study's A1, with the PM's choice of a bound of its own):
 * write_file does not leave a file larger than MAX_WRITE_BYTES (16 MiB). The size is the file's
 * bytes on disk: UTF-8, the byte order mark included. Over it the call is too_large: nothing is
 * written and no original is kept. The bound is apart from MAX_READ_BYTES: agents still write
 * documents and tables larger than read_file reads, which the verifiers read (U-151). The tool
 * definitions are unchanged (the requests' fixed values stay).
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { MAX_DATA_TABLE_BYTES, MAX_MARKDOWN_RULE_FILE_BYTES, MAX_READ_BYTES, MAX_WRITE_BYTES, TOOL_DEFINITIONS } from "../../../src/contracts/index.js";
import type { ChangeRecorder, FileChange, RawToolOutcome } from "../../../src/contracts/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { createFakePrivacy, createFakeWorkspace, sha256 } from "./doubles.js";
import type { FakeWorkspace } from "./doubles.js";

const never = new AbortController().signal;
const BOM = "﻿";

function spyRecorder(): { recorder: ChangeRecorder; calls: { originals: number; nexts: number } } {
  const calls = { originals: 0, nexts: 0 };
  const recorder: ChangeRecorder = {
    async saveOriginal() {
      calls.originals += 1;
    },
    async saveNext() {
      calls.nexts += 1;
    },
  };
  return { recorder, calls };
}

function setup(initial: Record<string, string | Buffer> = {}) {
  const workspace = createFakeWorkspace(initial);
  const spy = spyRecorder();
  const tools = createToolRunner({ workspace, privacy: createFakePrivacy(), changeRecorder: spy.recorder });
  return { workspace, tools, calls: spy.calls };
}

const hashOf = (workspace: FakeWorkspace, path: string): string | null => {
  const bytes = workspace.files.get(path);
  return bytes === undefined ? null : sha256(bytes);
};

function write(tools: ReturnType<typeof createToolRunner>, path: string, expectedHash: string | null, change: FileChange): Promise<RawToolOutcome> {
  return tools.execute({ id: "c1", name: "write_file", args: { path, expectedHash, change } }, never);
}

function assertTooLarge(outcome: RawToolOutcome): void {
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.code, "too_large");
}

test("U-173: the write bound is 16 MiB, apart from the read bound, and holds what the verifiers read", () => {
  assert.equal(MAX_WRITE_BYTES, 16 * 1024 * 1024);
  assert.ok(MAX_WRITE_BYTES > MAX_READ_BYTES);
  assert.ok(MAX_WRITE_BYTES >= MAX_DATA_TABLE_BYTES, "a data table the verifiers read can be written");
  assert.ok(MAX_WRITE_BYTES >= MAX_MARKDOWN_RULE_FILE_BYTES, "a Markdown document the verifiers read can be written");
});

test("U-173: a file over the read bound but under the write bound is written as before (U-151's documents)", async () => {
  const { workspace, tools, calls } = setup();
  const content = "x".repeat(MAX_READ_BYTES * 4);
  assert.equal((await write(tools, "big.md", null, { kind: "replace_all", content })).ok, true);
  assert.equal(workspace.files.get("big.md")?.byteLength, MAX_READ_BYTES * 4);
  assert.equal(calls.originals, 1);
});

test("U-173: a new file of MAX_WRITE_BYTES bytes is written; one byte more is too_large and nothing is written", async () => {
  const { workspace, tools, calls } = setup();
  assert.equal((await write(tools, "at.txt", null, { kind: "replace_all", content: "x".repeat(MAX_WRITE_BYTES) })).ok, true);
  assert.equal(workspace.files.get("at.txt")?.byteLength, MAX_WRITE_BYTES);
  const requests = workspace.writeRequests.length;
  const originals = calls.originals;

  assertTooLarge(await write(tools, "over.txt", null, { kind: "replace_all", content: "x".repeat(MAX_WRITE_BYTES + 1) }));
  assert.equal(workspace.writeRequests.length, requests, "nothing written");
  assert.equal(workspace.files.has("over.txt"), false);
  assert.equal(calls.originals, originals, "no original kept for a refused write");
});

test("U-173: the size is the UTF-8 bytes, not the characters", async () => {
  const { workspace, tools } = setup();
  // 3 bytes each: fewer characters than the bound, more bytes.
  const content = "가".repeat(Math.floor(MAX_WRITE_BYTES / 3) + 1);
  assert.ok(content.length < MAX_WRITE_BYTES);
  assertTooLarge(await write(tools, "ko.txt", null, { kind: "replace_all", content }));
  assert.equal(workspace.writeRequests.length, 0);
  assert.equal((await write(tools, "ko.txt", null, { kind: "replace_all", content: "가".repeat(Math.floor(MAX_WRITE_BYTES / 3)) })).ok, true);
});

test("U-173: the byte order mark the tool puts back counts", async () => {
  const { workspace, tools } = setup({ "bom.txt": `${BOM}old\n` });
  // The BOM is 3 bytes on disk: the content may be MAX_WRITE_BYTES - 3 bytes.
  const before = hashOf(workspace, "bom.txt");
  assertTooLarge(await write(tools, "bom.txt", before, { kind: "replace_all", content: "y".repeat(MAX_WRITE_BYTES - 2) }));
  assert.equal(hashOf(workspace, "bom.txt"), before, "unchanged");
  assert.equal((await write(tools, "bom.txt", before, { kind: "replace_all", content: "y".repeat(MAX_WRITE_BYTES - 3) })).ok, true);
  const bytes = workspace.files.get("bom.txt");
  assert.equal(bytes?.byteLength, MAX_WRITE_BYTES);
  assert.equal(bytes?.subarray(0, 3).toString("hex"), "efbbbf", "the BOM stays");
});

test("U-173: replace_text in a file the tools can read is written within the bound (the replace_text path counts the same way)", async () => {
  const start = "intro\nmark\n";
  const { workspace, tools, calls } = setup({ "grow.txt": start });
  const before = hashOf(workspace, "grow.txt");
  // An existing file is read first (at most MAX_READ_BYTES), so replace_text can grow it past the
  // write bound only with a newText that large itself.
  assertTooLarge(await write(tools, "grow.txt", before, { kind: "replace_text", oldText: "mark", newText: "z".repeat(MAX_WRITE_BYTES) }));
  assert.equal(hashOf(workspace, "grow.txt"), before);
  assert.equal(workspace.writeRequests.length, 0);
  assert.equal(calls.originals, 0);
  assert.equal((await write(tools, "grow.txt", before, { kind: "replace_text", oldText: "mark", newText: "mark!" })).ok, true);
  assert.equal(calls.originals, 1);
});

test("U-173: the tool definitions stay as they were (no new words, no maxLength): the requests' fixed values do not move", () => {
  const definition = TOOL_DEFINITIONS.write_file;
  assert.doesNotMatch(definition.description, /bytes|large|size/i);
  assert.doesNotMatch(JSON.stringify(definition.inputSchema), /maxLength/);
});

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

test("U-173: on disk, a file at the write bound is written; one over it is not created", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-u173-")));
  roots.push(root);
  const workspace = await createWorkspace({ root });
  const tools = createToolRunner({ workspace, privacy: createFakePrivacy() });
  assert.equal((await write(tools, "at.txt", null, { kind: "replace_all", content: "z".repeat(MAX_WRITE_BYTES) })).ok, true);
  assert.equal((await stat(join(root, "at.txt"))).size, MAX_WRITE_BYTES);

  assertTooLarge(await write(tools, "over.txt", null, { kind: "replace_all", content: "z".repeat(MAX_WRITE_BYTES + 1) }));
  await assert.rejects(readFile(join(root, "over.txt")), { code: "ENOENT" });
});
