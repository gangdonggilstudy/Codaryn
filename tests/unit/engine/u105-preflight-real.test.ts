/**
 * U-105 with the real parts (only the inventory and the verifiers are stand-ins): preflightPlan with
 * tools' executor and the real policy gate in a temporary workspace judges as the real apply does,
 * moves nothing, and the executor tells the hard link probes it could not take back (a count, its
 * answers unchanged). A probe the executor did take back, or one already gone, is not counted.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { asRawText, planActionShown } from "../../../src/contracts/index.js";
import type {
  ApplyDeps,
  ApplyJournalEntry,
  InventoryChecker,
  MaskedPlanAction,
  MaskedText,
  PlanActionKind,
  PolicyConfig,
  ResolvedPlanAction,
  StoredPlanAction,
  Workspace,
} from "../../../src/contracts/index.js";
import { applyPlan, preflightPlan } from "../../../src/engine/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { createPlanExecutor } from "../../../src/tools/index.js";
import type { CountingPlanExecutor, PlanFileOps } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { FakeClock, FakeVerifiers } from "./fakes.js";

const RUN_ID = "20261113T000100Z-0000bbbb";
const PLAN_ACTIONS: readonly PlanActionKind[] = ["move"];
const CONFIG: PolicyConfig = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move"] };

const sha = (text: string): string => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
const errno = (code: string): Error => Object.assign(new Error(code), { code });
const isProbe = (file: string): boolean => path.basename(file).startsWith(".codaryn-link-probe-");

let base = "";
let workspace: Workspace;
beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-u105-real-")));
  const root = path.join(base, "ws");
  await fs.mkdir(path.join(root, ".codaryn", "runs"), { recursive: true });
  await fs.mkdir(path.join(root, "done"));
  for (const [name, text] of Object.entries({ "a.txt": "alpha", "b.txt": "bravo", "c.txt": "charlie", "d.txt": "delta" })) {
    await fs.writeFile(path.join(root, name), text, "utf8");
  }
  await fs.writeFile(path.join(root, "done", "c.txt"), "already here", "utf8");
  workspace = await createWorkspace({ root });
});
afterEach(async () => fs.rm(base, { recursive: true, force: true }));

/** 0 fits, 1 its source changed since the plan, 2 its destination exists, 3 a discard the task does not allow. */
function actions(): ResolvedPlanAction[] {
  return [
    { kind: "move", from: "a.txt", to: "done/a.txt", sha256: sha("alpha") },
    { kind: "move", from: "b.txt", to: "done/b.txt", sha256: sha("bravo before") },
    { kind: "move", from: "c.txt", to: "done/c.txt", sha256: sha("charlie") },
    { kind: "discard", path: "d.txt", sha256: sha("delta") },
  ];
}

function executor(fileOps?: Partial<PlanFileOps>): CountingPlanExecutor {
  return createPlanExecutor({ workspace, workspaceRoot: workspace.root, runId: RUN_ID, ...(fileOps === undefined ? {} : { fileOps }) });
}

async function tree(): Promise<string[]> {
  const entries = await fs.readdir(workspace.root, { recursive: true });
  return entries.map((entry) => entry.split(path.sep).join("/")).sort();
}

const EXPECTED = {
  stopped: false,
  problems: [
    { index: 1, problem: "source_changed" },
    { index: 2, problem: "destination_exists" },
    { index: 3, problem: "denied" },
  ],
  unsafeMoves: [],
};

describe("U-105: preflightPlan with tools' executor and the real gate", () => {
  test("it judges each action, moves nothing and leaves no probe", async () => {
    const before = await tree();
    const exec = executor();
    const outcome = await preflightPlan({ actions: actions(), planActions: PLAN_ACTIONS, policy: createPolicyGate({ config: CONFIG, workspace }), executor: exec });
    assert.deepEqual(outcome, EXPECTED);
    assert.deepEqual(await tree(), before, "nothing moved, made or left");
    assert.equal(exec.probesLeft(), 0);
  });

  test("its result is the real apply's plan_checked for the same workspace", async () => {
    const outcome = await preflightPlan({ actions: actions(), planActions: PLAN_ACTIONS, policy: createPolicyGate({ config: CONFIG, workspace }), executor: executor() });
    const privacy = createPrivacyGateway({ secrets: [] });
    const stored = actions().map((action): StoredPlanAction => {
      const masked: MaskedPlanAction =
        action.kind === "move"
          ? { kind: "move", from: action.from as MaskedText, to: action.to as MaskedText, sha256: action.sha256 }
          : { kind: "discard", path: action.path as MaskedText, sha256: action.sha256 };
      return { ...action, shown: planActionShown(masked) } as StoredPlanAction;
    });
    const records: ApplyJournalEntry[] = [];
    const inventory: InventoryChecker = {
      capture: async () => ({ entries: [], limitReached: false }),
      check: async () => ({ id: "inventory", kind: "inventory", outcome: "pass", evidence: asRawText("ok"), checked: [], limits: [] }),
    };
    const marks: string[] = [];
    const deps: ApplyDeps = {
      plan: { schemaVersion: 1, kind: "plan", runId: "20261113T000000Z-0000aaaa", actions: stored },
      planRunId: "20261113T000000Z-0000aaaa",
      digest: "d".repeat(64),
      approval: "cli-flag",
      runId: RUN_ID,
      taskId: "tidy",
      maxDurationMs: 60_000,
      verifierConfigs: [],
      executor: executor(),
      policy: createPolicyGate({ config: CONFIG, workspace }),
      planActions: PLAN_ACTIONS,
      discardedRoot: path.join(workspace.root, ".codaryn", "discarded", RUN_ID),
      privacy,
      verifiers: new FakeVerifiers(),
      inventory,
      journal: { append: async (event) => void records.push(event), close: async () => undefined },
      clock: new FakeClock(),
      signal: new AbortController().signal,
      async markApplied() {
        marks.push("mark");
        return "marked";
      },
    };
    const result = await applyPlan(deps);
    assert.deepEqual([result.status, result.reason, marks], ["failed", "plan_stale", []]);
    const checked = records.find((record) => record.type === "plan_checked");
    assert.ok(checked !== undefined && checked.type === "plan_checked" && !outcome.stopped);
    assert.deepEqual({ problems: checked.problems, unsafeMoves: checked.unsafeMoves }, { problems: outcome.problems, unsafeMoves: outcome.unsafeMoves });
  });
});

describe("U-105: the executor tells the probes it could not take back", () => {
  test("a probe whose removal fails is counted, and the check's answer is unchanged", async () => {
    const left: string[] = [];
    const exec = executor({
      unlink: async (target) => {
        if (isProbe(target)) {
          left.push(target);
          throw errno("EPERM");
        }
        await fs.unlink(target);
      },
    });
    const fits: ResolvedPlanAction = { kind: "move", from: "a.txt", to: "done/a.txt", sha256: sha("alpha") };
    assert.equal(await exec.check(fits), null, "an unknown probe answer does not decide, as before");
    assert.equal(exec.probesLeft(), 1);
    // "unknown" is not kept for the volume, so the next check probes again: a second probe left.
    assert.equal(await exec.check({ kind: "discard", path: "d.txt", sha256: sha("delta") }), null);
    assert.equal(exec.probesLeft(), 2);
    assert.equal(left.length, 2);
    for (const probe of left) {
      assert.equal(path.dirname(probe), path.join(workspace.root, ".codaryn"), "in the state directory (same volume)");
      assert.ok((await fs.lstat(probe)).isFile(), "the probe is really there");
      await fs.unlink(probe);
    }
  });

  test("a probe already gone when it is removed is not counted", async () => {
    const exec = executor({
      unlink: async (target) => {
        await fs.unlink(target);
        if (isProbe(target)) throw errno("ENOENT");
      },
    });
    assert.equal(await exec.check({ kind: "move", from: "a.txt", to: "done/a.txt", sha256: sha("alpha") }), null);
    assert.equal(exec.probesLeft(), 0);
    assert.deepEqual((await fs.readdir(path.join(workspace.root, ".codaryn"))).filter(isProbe), []);
  });

  test("no probe made (no hard links on the volume), or one taken back: nothing counted", async () => {
    const noLinks = executor({ link: () => Promise.reject(errno("EPERM")) });
    assert.equal(await noLinks.check({ kind: "move", from: "a.txt", to: "done/a.txt", sha256: sha("alpha") }), "unsafe_move");
    assert.equal(noLinks.probesLeft(), 0);
    const plain = executor();
    assert.equal(await plain.check({ kind: "move", from: "a.txt", to: "done/a.txt", sha256: sha("alpha") }), null);
    assert.equal(plain.probesLeft(), 0);
  });

  test("the count holds across a preflight: preflightPlan, then probesLeft", async () => {
    const exec = executor({
      unlink: async (target) => {
        if (isProbe(target)) throw errno("EBUSY");
        await fs.unlink(target);
      },
    });
    const outcome = await preflightPlan({ actions: actions(), planActions: PLAN_ACTIONS, policy: createPolicyGate({ config: CONFIG, workspace }), executor: exec });
    assert.deepEqual(outcome, EXPECTED, "the same judgement");
    // Only action 0 is probed: the check probes last, after the source and the destination, so
    // action 1 (source changed) and action 2 (destination exists) end before it, and action 3 is
    // denied before the executor is asked.
    assert.equal(exec.probesLeft(), 1);
    const probes = (await fs.readdir(path.join(workspace.root, ".codaryn"))).filter(isProbe);
    assert.equal(probes.length, 1);
  });
});
