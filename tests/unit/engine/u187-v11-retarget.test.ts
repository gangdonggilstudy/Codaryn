/**
 * U-187, review V-11 H-1: after the approval and before the run, a planned file's parent folder is
 * turned into a junction (docs -> other). The plan names the effective path it had when it was made
 * (docs/new.md); the run must not write the place the junction now leads to (other/new.md).
 * The three reproductions of V-11, with the real workspace, gate and planned file probe: a create
 * without policy lists, a create under the policy list [docs], and a modify whose new target holds
 * the same bytes. Each must end as failed/plan_stale before any model request, with no claim.
 * Not a race: the folder is changed between the approval and the run.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import type { ApprovedChangesPlan, ContentHash, StoredChangesPlan, StoredPlannedFile, WritablePathSet, Workspace } from "../../../src/contracts/index.js";
import { runApprovedPlan } from "../../../src/engine/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { createPlannedFileProbe } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { FakeTools, HASH_A, finalAnswer, harness, response } from "./fakes.js";
import type { TaskOverrides } from "./fakes.js";

const sha = (text: string): ContentHash => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex") as ContentHash;
const PLAN_RUN = "20261113T090000Z-0000aaaa";
let base: string;

function junctions(): boolean {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-v11j-"));
  try {
    fs.mkdirSync(path.join(probe, "t"));
    fs.symlinkSync(path.join(probe, "t"), path.join(probe, "l"), "junction");
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
}
const canLink = junctions();

before(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u187v11-"));
});
after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

/** A workspace with docs/guide.md and other/, then (after the approval) docs moved away and docs -> other. */
async function retargeted(name: string, otherFiles: Record<string, string> = {}): Promise<{ root: string; workspace: Workspace }> {
  const root = path.join(base, name);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.mkdirSync(path.join(root, "other"));
  fs.writeFileSync(path.join(root, "docs", "guide.md"), "guide");
  for (const [file, text] of Object.entries(otherFiles)) fs.writeFileSync(path.join(root, "other", file), text);
  fs.renameSync(path.join(root, "docs"), path.join(root, "saved-docs"));
  fs.symlinkSync(path.join(root, "other"), path.join(root, "docs"), "junction");
  return { root, workspace: await createWorkspace({ root }) };
}

function planOf(files: readonly StoredPlannedFile[]): StoredChangesPlan {
  return { schemaVersion: 1, kind: "changes", runId: PLAN_RUN, summary: ["write it"], files };
}

async function carry(workspace: Workspace, plan: StoredChangesPlan, sets: readonly WritablePathSet[] | undefined, writeTo: string) {
  const task: TaskOverrides = { tools: ["read_file", "write_file"], plan: "run", ...(sets === undefined ? {} : { writablePathSets: sets }) };
  const run = harness({
    steps: [() => response([{ id: "w1", name: "write_file", args: { path: writeTo, expectedHash: null, change: { kind: "replace_all", content: "written" } } }]), () => finalAnswer()],
    task,
    tools: new FakeTools(),
  });
  let claims = 0;
  const approved: ApprovedChangesPlan = {
    planRunId: PLAN_RUN,
    digest: HASH_A as ContentHash,
    approval: "cli-flag",
    plan,
    fileNow: createPlannedFileProbe({ workspace }),
    markApplied: async () => ((claims += 1), "marked"),
  };
  const { policy: _unused, ...rest } = run.deps;
  const result = await runApprovedPlan({
    ...rest,
    approved,
    policyFor: (writablePathSets) => createPolicyGate({ config: rest.task.policy, workspace, writablePathSets }),
  });
  return { result, run, claims };
}

describe("V-11 H-1: a parent folder turned into a junction after the approval", { skip: !canLink && "no junctions here" }, () => {
  test("a create without policy lists: plan_stale before any model request, no claim", async () => {
    const { root, workspace } = await retargeted("create-free");
    const { result, run, claims } = await carry(workspace, planOf([{ path: "docs/new.md", change: "create", sha256: null, shown: ["docs/new.md"] }]), undefined, "other/new.md");
    assert.deepEqual([result.status, result.reason], ["failed", "plan_stale"]);
    assert.deepEqual([run.model.requests.length, claims, run.tools.executed.length], [0, 0, 0]);
    assert.equal(fs.existsSync(path.join(root, "other", "new.md")), false);
  });

  test("a create under the policy list [docs]: the same", async () => {
    const { root, workspace } = await retargeted("create-listed");
    const sets: WritablePathSet[] = [{ source: "config", entries: ["docs"] }];
    const { result, run, claims } = await carry(workspace, planOf([{ path: "docs/new.md", change: "create", sha256: null, shown: ["docs/new.md"] }]), sets, "other/new.md");
    assert.deepEqual([result.status, result.reason], ["failed", "plan_stale"]);
    assert.deepEqual([run.model.requests.length, claims], [0, 0]);
    assert.equal(fs.existsSync(path.join(root, "other", "new.md")), false);
  });

  test("a modify whose new target holds the same bytes: the same", async () => {
    const { root, workspace } = await retargeted("modify-same", { "guide.md": "guide" });
    const { result, run, claims } = await carry(workspace, planOf([{ path: "docs/guide.md", change: "modify", sha256: sha("guide"), shown: ["docs/guide.md"] }]), undefined, "other/guide.md");
    assert.deepEqual([result.status, result.reason], ["failed", "plan_stale"]);
    assert.deepEqual([run.model.requests.length, claims], [0, 0]);
    assert.equal(fs.readFileSync(path.join(root, "other", "guide.md"), "utf8"), "guide", "untouched");
    assert.ok(result.notices.some((one) => one.includes("file 0 is not as it was")));
  });
});
