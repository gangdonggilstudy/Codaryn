/**
 * U-175 (DR-69 B-2): the policy gate judges writable paths (PolicyGateOptions.writablePathSets).
 * - A write must be covered by every list (the intersection); otherwise `path`/`path_not_writable`.
 * - Only after links are resolved (checkEffective); checkRequested decides nothing about it.
 * - A policy's list covers what is below its entries; the plan's files (`plan`) only themselves.
 * - Allow lists fail closed: an unusable list covers nothing, an unusable entry is passed over.
 * - A protected path is reported first. Reads, a command's cwd and gates without lists are as before.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { BUILTIN_TOOLS, PLANNED_FILE_DESCRIPTOR, PLAN_ACTION_DESCRIPTORS } from "../../../src/contracts/index.js";
import type { EffectiveToolCall, JsonObject, PolicyConfig, PolicyGate, ToolDescriptor, WritablePathSet, Workspace } from "../../../src/contracts/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const ALLOW = { allowed: true };
const NOT_WRITABLE = { allowed: false, permission: "path", code: "path_not_writable" };
const PROTECTED = { allowed: false, permission: "path", code: "protected_path" };

const BASE: PolicyConfig = {
  commands: [{ executable: "node", argsPrefix: ["--test"], allowExtraArgs: true }],
  network: "deny",
  destructive: "deny",
  restorePathTokens: false,
  planActions: ["move", "discard"],
};

let base: string;
let root: string;
let workspace: Workspace;
let links = false;

function tryJunction(target: string, link: string): boolean {
  try {
    fs.symlinkSync(target, link, "junction");
    return true;
  } catch {
    return false;
  }
}

before(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u175g-"));
  root = path.join(base, "root");
  for (const dir of ["src", "docs", "out", "build"]) fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const file of ["src/a.ts", "docs/guide.md", "out/a.txt", "build/b.txt"]) fs.writeFileSync(path.join(root, file), "x\n");
  fs.mkdirSync(path.join(base, "outside"));
  links =
    tryJunction(path.join(root, "build"), path.join(root, "dist-link")) &&
    tryJunction(path.join(root, "src"), path.join(root, "out", "into-src")) &&
    tryJunction(path.join(base, "outside"), path.join(root, "link-out"));
  workspace = await createWorkspace({ root });
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

function gate(writablePathSets?: readonly WritablePathSet[], extra: Partial<PolicyConfig> = {}): PolicyGate {
  return createPolicyGate({ config: { ...BASE, ...extra }, workspace, ...(writablePathSets === undefined ? {} : { writablePathSets }) });
}

const writeArgs = (target: string): JsonObject => ({ path: target, expectedHash: null, change: { kind: "replace_all", content: "x" } });

async function judge(g: PolicyGate, name: string, args: JsonObject, descriptor: ToolDescriptor): Promise<{ requested: object; effective: object }> {
  const requested = g.checkRequested({ id: "c1", name, args }, descriptor);
  const effective = await g.checkEffective({ id: "c1", name, args } as unknown as EffectiveToolCall, descriptor);
  return { requested, effective };
}

const write = async (g: PolicyGate, target: string): Promise<object> => {
  const { requested, effective } = await judge(g, "write_file", writeArgs(target), BUILTIN_TOOLS.write_file);
  assert.deepEqual(requested, ALLOW, `checkRequested decides nothing about writable paths (${target})`);
  return effective;
};

describe("U-175: writable lists in the gate", () => {
  test("no list, or none given: writes as before", async () => {
    assert.deepEqual(await write(gate(), "src/a.ts"), ALLOW);
    assert.deepEqual(await write(gate([]), "src/a.ts"), ALLOW);
  });

  test("one list: what is below its entries is writable, nothing else", async () => {
    const g = gate([{ source: "config", entries: ["out", "docs/guide.md"] }]);
    assert.deepEqual(await write(g, "out/a.txt"), ALLOW);
    assert.deepEqual(await write(g, "out/new/deep.txt"), ALLOW);
    assert.deepEqual(await write(g, "docs/guide.md"), ALLOW);
    assert.deepEqual(await write(g, "src/a.ts"), NOT_WRITABLE);
    assert.deepEqual(await write(g, "docs/other.md"), NOT_WRITABLE);
    assert.deepEqual(await write(g, "outer.txt"), NOT_WRITABLE, "whole segments only");
  });

  test("several lists: every one must cover the write (the intersection); none widens another", async () => {
    const g = gate([
      { source: "config", entries: ["out", "docs"] },
      { source: "task", entries: ["docs", "src"] },
    ]);
    assert.deepEqual(await write(g, "docs/guide.md"), ALLOW);
    assert.deepEqual(await write(g, "out/a.txt"), NOT_WRITABLE, "the task's list leaves out out/");
    assert.deepEqual(await write(g, "src/a.ts"), NOT_WRITABLE, "the config's list leaves out src/");
  });

  test("the plan's files cover exactly themselves, under the policy's lists", async () => {
    const g = gate([
      { source: "config", entries: ["docs"] },
      { source: "plan", entries: ["docs/guide.md", "docs/new.md"] },
    ]);
    assert.deepEqual(await write(g, "docs/guide.md"), ALLOW);
    assert.deepEqual(await write(g, "docs/new.md"), ALLOW, "a file to create");
    assert.deepEqual(await write(g, "docs/other.md"), NOT_WRITABLE);
    assert.deepEqual(await write(g, "docs/new.md/inner.txt"), NOT_WRITABLE, "nothing below a planned file");
    assert.deepEqual(await write(gate([{ source: "plan", entries: ["docs"] }]), "docs/guide.md"), NOT_WRITABLE, "a plan names files, not folders");
  });

  test("an empty list allows no write; a list the format rule rejects allows none either", async () => {
    assert.deepEqual(await write(gate([{ source: "task", entries: [] }]), "out/a.txt"), NOT_WRITABLE);
    for (const entries of [["../out"], ["/abs"], [""]]) {
      assert.deepEqual(await write(gate([{ source: "task", entries }]), "out/a.txt"), NOT_WRITABLE, JSON.stringify(entries));
    }
  });

  test("a protected path is reported first", async () => {
    const g = gate([{ source: "config", entries: ["src"] }], { protectedPaths: ["docs"] });
    // The protected path is denied at both stages, as before; the writable list adds nothing to it.
    const both = await judge(g, "write_file", writeArgs("docs/guide.md"), BUILTIN_TOOLS.write_file);
    assert.deepEqual([both.requested, both.effective], [PROTECTED, PROTECTED]);
    assert.deepEqual(await write(g, "src/a.ts"), ALLOW);
  });

  test("links: a link entry covers its real path; a link below an entry does not lead out", { skip: !links && "no junctions here" }, async () => {
    const g = gate([{ source: "config", entries: ["dist-link"] }]);
    assert.deepEqual(await write(g, "build/b.txt"), ALLOW, "the entry's real path");
    assert.deepEqual(await write(g, "dist-link/b.txt"), ALLOW, "through the entry itself");
    const below = gate([{ source: "config", entries: ["out"] }]);
    assert.deepEqual(await write(below, "out/a.txt"), ALLOW);
    assert.deepEqual(await write(below, "out/into-src/a.ts"), NOT_WRITABLE, "resolves to src/a.ts, outside out/");
  });

  test("an unusable entry is passed over: it allows nothing, the other entries still allow", { skip: !links && "no junctions here" }, async () => {
    assert.deepEqual(await write(gate([{ source: "config", entries: ["link-out"] }]), "src/a.ts"), NOT_WRITABLE);
    assert.deepEqual(await write(gate([{ source: "config", entries: ["link-out", "src"] }]), "src/a.ts"), ALLOW);
  });

  test("every write access is judged: plan actions and a planned file too; reads and a command's cwd are not", async () => {
    const g = gate([{ source: "config", entries: ["out"] }]);
    const move = await judge(g, "plan.move", { from: "out/a.txt", to: "src/moved.txt" }, PLAN_ACTION_DESCRIPTORS.move);
    assert.deepEqual(move.effective, NOT_WRITABLE);
    const inside = await judge(g, "plan.move", { from: "out/a.txt", to: "out/moved.txt" }, PLAN_ACTION_DESCRIPTORS.move);
    assert.deepEqual(inside.effective, ALLOW);
    const planned = await judge(g, "plan.file", { path: "docs/guide.md" }, PLANNED_FILE_DESCRIPTOR);
    assert.deepEqual(planned.effective, NOT_WRITABLE);
    const read = await judge(g, "read_file", { path: "src/a.ts" }, BUILTIN_TOOLS.read_file);
    assert.deepEqual(read.effective, ALLOW);
    const command = await judge(g, "run_command", { executable: "node", args: ["--test"], cwd: "src" }, BUILTIN_TOOLS.run_command);
    assert.deepEqual(command.effective, ALLOW, "B-8: writable paths guard the file tools only");
  });
});
