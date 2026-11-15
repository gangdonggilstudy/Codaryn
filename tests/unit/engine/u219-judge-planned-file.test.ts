/**
 * U-219 (p5a's request; contract plan.ts `JudgePlannedFile`): the engine gives out how the gate of a
 * run that carries out an approved `run` plan judges one planned file, so the app layer's check before
 * the approval calls the same function. With the real gate made as that run's
 * (approvedPlanWritablePathSets): a planned file inside every list is allowed; a file the plan does
 * not name, a planned file outside a settings list and a planned file under a protected path are
 * denied with their codes. The effective decision is asked only after the requested one allowed.
 * approvedPlanWritablePathSets takes the files' paths alone, as the app holds them.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { approvedPlanWritablePathSets } from "../../../src/contracts/index.js";
import type { PolicyConfig, PolicyDecision, PolicyGate, WritablePathSet, Workspace } from "../../../src/contracts/index.js";
import { judgePlannedFile } from "../../../src/engine/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

let base: string;
let workspace: Workspace;

before(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-u219-")));
  for (const dir of ["src", "docs", "keep"]) await fs.mkdir(path.join(base, dir));
  for (const file of ["src/a.ts", "src/b.ts", "docs/c.md", "keep/d.txt"]) await fs.writeFile(path.join(base, file), "x\n", "utf8");
  workspace = await createWorkspace({ root: base });
});

after(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

const POLICY: PolicyConfig = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, protectedPaths: ["keep"] };
const SETTINGS: readonly WritablePathSet[] = [{ source: "config", entries: ["src", "keep"] }];
const PLANNED = { files: [{ path: "src/a.ts" }, { path: "docs/c.md" }, { path: "keep/d.txt" }] };

function runGate(): PolicyGate {
  return createPolicyGate({ config: POLICY, workspace, writablePathSets: approvedPlanWritablePathSets(SETTINGS, PLANNED) });
}

describe("U-219: judgePlannedFile, the gate's decision on one planned file", () => {
  test("a planned file inside every list is allowed", async () => {
    assert.deepEqual(await judgePlannedFile(runGate(), "src/a.ts"), { allowed: true });
  });

  test("denials keep their permission and code", async () => {
    const denied = async (file: string): Promise<string> => {
      const decision = await judgePlannedFile(runGate(), file);
      assert.equal(decision.allowed, false, file);
      return decision.allowed ? "" : `${decision.permission}/${decision.code}`;
    };
    assert.equal(await denied("src/b.ts"), "path/path_not_writable", "not in the plan");
    assert.equal(await denied("docs/c.md"), "path/path_not_writable", "planned, outside the settings' list");
    assert.equal(await denied("keep/d.txt"), "path/protected_path", "planned, protected");
  });

  test("the effective decision is asked only after the requested one allowed", async () => {
    const asked: string[] = [];
    const stub = (requested: PolicyDecision, effective: PolicyDecision): PolicyGate =>
      ({
        checkRequested(call: { args: { path: string } }) {
          asked.push(`requested ${call.args.path}`);
          return requested;
        },
        async checkEffective(call: { args: { path: string } }) {
          asked.push(`effective ${call.args.path}`);
          return effective;
        },
      }) as unknown as PolicyGate;
    const no: PolicyDecision = { allowed: false, permission: "path", code: "protected_path" };
    assert.deepEqual(await judgePlannedFile(stub(no, { allowed: true }), "x.ts"), no);
    assert.deepEqual(asked, ["requested x.ts"]);
    asked.length = 0;
    const late: PolicyDecision = { allowed: false, permission: "path", code: "path_not_writable" };
    assert.deepEqual(await judgePlannedFile(stub({ allowed: true }, late), "y.ts"), late);
    assert.deepEqual(asked, ["requested y.ts", "effective y.ts"]);
  });

  test("approvedPlanWritablePathSets takes the files' paths alone: the settings' lists, then the plan's", () => {
    assert.deepEqual(approvedPlanWritablePathSets(SETTINGS, PLANNED), [...SETTINGS, { source: "plan", entries: ["src/a.ts", "docs/c.md", "keep/d.txt"] }]);
    assert.deepEqual(approvedPlanWritablePathSets(undefined, { files: [] }), [{ source: "plan", entries: [] }]);
  });
});
