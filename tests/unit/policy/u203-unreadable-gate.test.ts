/**
 * U-203 (P1 bundle A, A-3; R-1, R-3, R-5, R-8): the gate judges PolicyConfig.unreadablePaths.
 * - A deny list judged as the protected paths are: the text first (checkRequested), then the real
 *   path (checkEffective), a link entry covering its target; an unusable list or entry covers
 *   everything (fail closed); an entry that does not exist is judged the same way.
 * - Under it every access but `aggregate` (query_table) is `path`/`unreadable_path`: read_file,
 *   search_files' and inspect_files' start, a write (reported before a protected path).
 * - With any unreadable entry every command is denied (R-5's guard; the resolution refuses first).
 * - Without the field nothing changes.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { BUILTIN_TOOLS, QUERY_TABLE_DESCRIPTOR, WORKFLOW_TOOLS } from "../../../src/contracts/index.js";
import type { EffectiveToolCall, JsonObject, PolicyConfig, PolicyDecision, ToolDescriptor, Workspace } from "../../../src/contracts/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { compilePathSet } from "../../../src/policy/path-set.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const ALLOW = { allowed: true };
const UNREADABLE = { allowed: false, permission: "path", code: "unreadable_path" };
const NO_COMMAND = { allowed: false, permission: "command", code: "command_not_allowed" };
const BASE: PolicyConfig = {
  commands: [{ executable: "node", argsPrefix: ["--test"], allowExtraArgs: true }],
  network: "deny",
  destructive: "deny",
  restorePathTokens: false,
};

let base: string;
let workspace: Workspace;
let links = false;

before(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u203g-"));
  const root = path.join(base, "root");
  for (const dir of ["data/sub", "data2", "docs"]) fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const file of ["data/people.csv", "data/sub/x.csv", "data2/y.csv", "docs/readme.md"]) fs.writeFileSync(path.join(root, file), "x\n");
  fs.mkdirSync(path.join(base, "outside"));
  // Links first, before anything awaits: the tests read `links` when they are defined.
  try {
    fs.symlinkSync(path.join(root, "data"), path.join(root, "alias"), "junction");
    fs.symlinkSync(path.join(base, "outside"), path.join(root, "out-link"), "junction");
    links = true;
  } catch {
    links = false;
  }
  workspace = await createWorkspace({ root });
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

const gate = (extra: Partial<PolicyConfig>, unreadablePaths?: readonly string[]) =>
  createPolicyGate({ config: { ...BASE, ...extra }, workspace, ...(unreadablePaths === undefined ? {} : { unreadablePaths }) });

async function both(extra: Partial<PolicyConfig>, name: string, args: JsonObject, descriptor: ToolDescriptor): Promise<[PolicyDecision, PolicyDecision]> {
  const g = gate(extra);
  return [g.checkRequested({ id: "c1", name, args }, descriptor), await g.checkEffective({ id: "c1", name, args } as unknown as EffectiveToolCall, descriptor)];
}
const read = (extra: Partial<PolicyConfig>, target: string) => both(extra, "read_file", { path: target }, BUILTIN_TOOLS.read_file);
const writeArgs = (target: string): JsonObject => ({ path: target, expectedHash: null, change: { kind: "replace_all", content: "x" } });

describe("U-203: the gate judges unreadable paths", () => {
  test("without the field, or with an empty list, nothing changes", async () => {
    assert.deepEqual(await read({}, "data/people.csv"), [ALLOW, ALLOW]);
    assert.deepEqual(await read({ unreadablePaths: [] }, "data/people.csv"), [ALLOW, ALLOW]);
    const command = await both({ unreadablePaths: [] }, "run_command", { executable: "node", args: ["--test"] }, BUILTIN_TOOLS.run_command);
    assert.deepEqual(command[1], ALLOW);
  });

  test("under it: read_file, search_files, inspect_files and write_file are unreadable_path at both stages", async () => {
    const policy = { unreadablePaths: ["data"] };
    assert.deepEqual(await read(policy, "data/people.csv"), [UNREADABLE, UNREADABLE]);
    assert.deepEqual(await both(policy, "search_files", { path: "data", text: "x" }, BUILTIN_TOOLS.search_files), [UNREADABLE, UNREADABLE]);
    assert.deepEqual(await both(policy, "inspect_files", { path: "data/sub" }, WORKFLOW_TOOLS.inspect_files), [UNREADABLE, UNREADABLE]);
    assert.deepEqual(await both(policy, "write_file", writeArgs("data/new.csv"), BUILTIN_TOOLS.write_file), [UNREADABLE, UNREADABLE]);
    assert.deepEqual(await both({ ...policy, protectedPaths: ["data"] }, "write_file", writeArgs("data/new.csv"), BUILTIN_TOOLS.write_file), [UNREADABLE, UNREADABLE], "reported before the protected path");
  });

  test("query_table's aggregate reaches under it; whole segments only; elsewhere as before", async () => {
    const policy = { unreadablePaths: ["data"] };
    assert.deepEqual(await both(policy, "query_table", { path: "data/people.csv" }, QUERY_TABLE_DESCRIPTOR), [ALLOW, ALLOW]);
    assert.deepEqual(await read(policy, "data2/y.csv"), [ALLOW, ALLOW]);
    assert.deepEqual(await read(policy, "docs/readme.md"), [ALLOW, ALLOW]);
    assert.deepEqual(await both(policy, "search_files", { path: ".", text: "x" }, BUILTIN_TOOLS.search_files), [ALLOW, ALLOW], "a start above it is allowed; the tool leaves it out");
  });

  test("an entry that does not exist is judged the same way: no error tells it", async () => {
    assert.deepEqual(await read({ unreadablePaths: ["secret"] }, "secret/a.txt"), [UNREADABLE, UNREADABLE]);
  });

  test("links: a path through a link is judged by its real path; a link entry covers its target", { skip: !links && "no junctions here" }, async () => {
    assert.deepEqual(await read({ unreadablePaths: ["data"] }, "alias/people.csv"), [ALLOW, UNREADABLE], "the text passes, the real path does not");
    assert.deepEqual(await read({ unreadablePaths: ["alias"] }, "data/people.csv"), [ALLOW, UNREADABLE], "the entry's real path");
  });

  test("an unusable list or entry covers everything but aggregate (fail closed)", { skip: !links && "no junctions here" }, async () => {
    assert.deepEqual(await read({ unreadablePaths: ["../x"] }, "docs/readme.md"), [UNREADABLE, UNREADABLE]);
    assert.deepEqual((await read({ unreadablePaths: ["out-link"] }, "docs/readme.md"))[1], UNREADABLE, "an entry leading outside");
    assert.deepEqual(await both({ unreadablePaths: ["../x"] }, "query_table", { path: "docs/readme.md" }, QUERY_TABLE_DESCRIPTOR), [ALLOW, ALLOW]);
  });

  test("review R-102 M-1: the run's own list (PolicyGateOptions.unreadablePaths) is judged, with the policy's as well", async () => {
    const run = gate({}, ["data"]);
    const args = { path: "data/people.csv" };
    assert.deepEqual(
      [run.checkRequested({ id: "c1", name: "read_file", args }, BUILTIN_TOOLS.read_file), await run.checkEffective({ id: "c1", name: "read_file", args } as unknown as EffectiveToolCall, BUILTIN_TOOLS.read_file)],
      [UNREADABLE, UNREADABLE],
      "only in the run's list",
    );
    const both = gate({ unreadablePaths: ["docs"] }, ["data"]);
    assert.deepEqual(both.checkRequested({ id: "c1", name: "read_file", args: { path: "docs/readme.md" } }, BUILTIN_TOOLS.read_file), UNREADABLE, "the policy's list too");
    assert.deepEqual(both.checkRequested({ id: "c1", name: "read_file", args }, BUILTIN_TOOLS.read_file), UNREADABLE);
    const command = gate({}, ["data"]);
    assert.deepEqual(command.checkRequested({ id: "c1", name: "run_command", args: { executable: "node", args: ["--test"] } }, BUILTIN_TOOLS.run_command), NO_COMMAND);
    assert.deepEqual(gate({}, []).checkRequested({ id: "c1", name: "read_file", args }, BUILTIN_TOOLS.read_file), ALLOW, "an empty run list adds nothing");
  });

  test("R-5: with any unreadable entry every command is denied, even one a rule allows", async () => {
    const command = await both({ unreadablePaths: ["data"] }, "run_command", { executable: "node", args: ["--test"] }, BUILTIN_TOOLS.run_command);
    assert.deepEqual(command, [NO_COMMAND, NO_COMMAND]);
  });
});

describe("U-203: PathSet.snapshot", () => {
  test("covers by text and by real path, and within tells whether a folder holds an entry, whatever exists", { skip: !links && "no junctions here" }, async () => {
    const snapshot = await compilePathSet(["alias", "secret/inner"], { match: "prefix", onUnusable: "covers" }).snapshot(workspace);
    assert.deepEqual(
      ["alias/x", "data/people.csv", "data2/y.csv", "secret/inner/z", "secret"].map((one) => snapshot.covers(one)),
      [true, true, false, true, false],
    );
    assert.deepEqual([".", "secret", "data", "docs"].map((one) => snapshot.within(one)), [true, true, true, false]);
    const all = await compilePathSet(["out-link"], { match: "prefix", onUnusable: "covers" }).snapshot(workspace);
    assert.deepEqual([all.covers("docs/readme.md"), all.within("docs")], [true, true], "an unusable entry covers everything");
  });
});
