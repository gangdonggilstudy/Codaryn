/**
 * U-189 (T-1 of the tool path race study): the policy gate judges the real path of each path
 * argument; the tool resolves the argument again before it uses it. When a folder was swapped for a
 * junction in between, the tool's real path is another one (here a protected or not writable place
 * inside the workspace): the tool refuses with policy_denied and does nothing. Without a swap, with a
 * link that was there before the judgment, and without a gate, the tools work as before.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { BUILTIN_TOOLS } from "../../../src/contracts/index.js";
import type { EffectiveToolCall, PolicyConfig, ToolName, WritablePathSet } from "../../../src/contracts/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { createFakePrivacy } from "./doubles.js";

const never = new AbortController().signal;
let base = "";
let root = "";
let junctions = true;

function junction(target: string, at: string): boolean {
  try {
    fs.symlinkSync(target, at, "junction");
    return true;
  } catch {
    return false;
  }
}

before(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u189-t1-")));
  root = path.join(base, "root");
  for (const dir of ["docs", "src", "secret"]) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "a.md"), "docs\n");
  fs.writeFileSync(path.join(root, "secret", "a.md"), "SECRET\n");
  fs.writeFileSync(path.join(root, "src", "b.ts"), "src\n");
  junctions = junction(path.join(root, "src"), path.join(root, "link-in"));
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

const config = (extra: Partial<PolicyConfig> = {}): PolicyConfig => ({ commands: [], network: "deny", destructive: "deny", protectedPaths: ["secret"], restorePathTokens: false, ...extra });

async function setup(writablePathSets?: readonly WritablePathSet[]) {
  const workspace = await createWorkspace({ root });
  const gate = createPolicyGate({ config: config(), workspace, ...(writablePathSets === undefined ? {} : { writablePathSets }) });
  const tools = createToolRunner({ workspace, privacy: createFakePrivacy() });
  return { workspace, gate, tools };
}

const call = (name: ToolName, args: Record<string, unknown>): EffectiveToolCall => ({ id: "c1", name, args }) as unknown as EffectiveToolCall;

test("U-189: without a swap the judged path is the tool's: read and write go on", async () => {
  const { gate, tools } = await setup();
  const read = call("read_file", { path: "docs/a.md" });
  assert.ok((await gate.checkEffective(read, BUILTIN_TOOLS.read_file)).allowed);
  const outcome = await tools.execute(read, never);
  assert.ok(outcome.ok && (outcome.payload as unknown as { content: string }).content === "docs\n");
});

test("U-189: a folder swapped for a junction after the gate judged a read: policy_denied, the protected file is not read", { skip: !junctions && "no junctions here" }, async () => {
  const { gate, tools } = await setup();
  fs.mkdirSync(path.join(root, "r1"));
  fs.writeFileSync(path.join(root, "r1", "a.md"), "plain\n");
  const read = call("read_file", { path: "r1/a.md" });
  assert.ok((await gate.checkEffective(read, BUILTIN_TOOLS.read_file)).allowed);
  // The swap: r1 now leads to the protected folder (whose a.md the gate never judged).
  fs.renameSync(path.join(root, "r1"), path.join(root, "r1-moved"));
  assert.ok(junction(path.join(root, "secret"), path.join(root, "r1")));
  const outcome = await tools.execute(read, never);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.code, "policy_denied");
  assert.equal(JSON.stringify(outcome).includes("SECRET"), false);
});

test("U-189: a folder swapped after the gate judged a write: policy_denied, nothing written where it leads", { skip: !junctions && "no junctions here" }, async () => {
  const { gate, tools } = await setup([{ source: "config", entries: ["w1"] }]);
  fs.mkdirSync(path.join(root, "w1"));
  const write = call("write_file", { path: "w1/new.md", expectedHash: null, change: { kind: "replace_all", content: "x\n" } });
  assert.ok((await gate.checkEffective(write, BUILTIN_TOOLS.write_file)).allowed, "w1 is writable");
  // The swap: w1 now leads to src (not writable).
  fs.renameSync(path.join(root, "w1"), path.join(root, "w1-moved"));
  assert.ok(junction(path.join(root, "src"), path.join(root, "w1")));
  const outcome = await tools.execute(write, never);
  assert.equal(outcome.ok === false && outcome.code, "policy_denied");
  assert.equal(fs.existsSync(path.join(root, "src", "new.md")), false);
});

test("U-189: a link inside the root that was there before the judgment is read as before", { skip: !junctions && "no junctions here" }, async () => {
  const { gate, tools } = await setup();
  const read = call("read_file", { path: "link-in/b.ts" });
  assert.ok((await gate.checkEffective(read, BUILTIN_TOOLS.read_file)).allowed);
  const outcome = await tools.execute(read, never);
  assert.ok(outcome.ok && (outcome.payload as unknown as { path: string }).path === "src/b.ts");
});

test("U-189: a tool with no judgment before it (a unit test, a second run of the same call) works as before", async () => {
  const { gate, tools } = await setup();
  const read = call("read_file", { path: "docs/a.md" });
  assert.ok((await tools.execute(read, never)).ok, "no gate: no note to compare");
  assert.ok((await gate.checkEffective(read, BUILTIN_TOOLS.read_file)).allowed);
  assert.ok((await tools.execute(read, never)).ok);
  assert.ok((await tools.execute(read, never)).ok, "the note was taken once; the engine's retry of a read goes on");
});

test("U-189: search_files compares its folder argument; the files it reads one by one are guarded by the read itself", { skip: !junctions && "no junctions here" }, async () => {
  const { gate, tools } = await setup();
  fs.mkdirSync(path.join(root, "s1"));
  fs.writeFileSync(path.join(root, "s1", "a.md"), "needle\n");
  const search = call("search_files", { path: "s1", text: "needle" });
  assert.ok((await gate.checkEffective(search, BUILTIN_TOOLS.search_files)).allowed);
  const found = await tools.execute(search, never);
  assert.ok(found.ok && (found.payload as unknown as { entries: unknown[] }).entries.length === 1);
  assert.ok((await gate.checkEffective(search, BUILTIN_TOOLS.search_files)).allowed);
  fs.renameSync(path.join(root, "s1"), path.join(root, "s1-moved"));
  assert.ok(junction(path.join(root, "secret"), path.join(root, "s1")));
  const swapped = await tools.execute(search, never);
  assert.equal(swapped.ok === false && swapped.code, "policy_denied");
});
