/**
 * G-B with G-C, real parts end to end: the engine's plan run (`runTask`) and apply run
 * (`applyPlan`) with the real tool runner and its workflow tools, the real plan executor, the real
 * policy gate (which now judges `requires.planAction`), the real privacy gateway and a real
 * workspace on disk. Only parts other work items own and that do not exist yet stand in at their
 * contract: the plan recorder and the "applied" mark (G-E), the inventory check (G-D), the
 * journal and the model (a scripted list of responses). No real API.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { PLAN_APPLIED_FILE_NAME, PLAN_FILE_NAME, asRawText } from "../../../src/contracts/index.js";
import type {
  ApplyDeps,
  ApplyJournalEntry,
  ContentHash,
  EngineDeps,
  InventoryChecker,
  JsonObject,
  PlanActionKind,
  PlanRecorder,
  PolicyConfig,
  ResolvedPlanAction,
  ResolvedTaskSpec,
  StoredPlan,
  Workspace,
} from "../../../src/contracts/index.js";
import { applyPlan, runTask } from "../../../src/engine/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { createPlanExecutor, createToolRunner, discardedRootOf } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { FakeClock, FakeJournal, FakeModel, FakeVerifiers, finalAnswer, response } from "./fakes.js";

const PLAN_RUN = "20261112T120000Z-0000aaaa";
const APPLY_RUN = "20261112T120500Z-0000bbbb";
const FAKE_SECRET = "fake-secret-NAME-gb02";

const sha = (bytes: string | Buffer): ContentHash => createHash("sha256").update(bytes).digest("hex") as ContentHash;

interface Space {
  readonly root: string;
  readonly workspace: Workspace;
  read(relative: string): Promise<string | null>;
  cleanup(): Promise<void>;
}

async function space(): Promise<Space> {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gb-real-")));
  const files: Record<string, string> = {
    "photos/a.jpg": "jpeg bytes a",
    "old/b.tmp": "temporary b",
    "keep/x.txt": "keep me",
    [`notes/${FAKE_SECRET}.md`]: "named after a secret",
  };
  for (const [relative, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(base, relative)), { recursive: true });
    await fs.writeFile(path.join(base, relative), text, "utf8");
  }
  await fs.mkdir(path.join(base, ".codaryn", "runs", PLAN_RUN), { recursive: true });
  await fs.mkdir(path.join(base, ".codaryn", "runs", APPLY_RUN), { recursive: true });
  const workspace = await createWorkspace({ root: base });
  return {
    root: workspace.root,
    workspace,
    async read(relative) {
      try {
        return await fs.readFile(path.join(workspace.root, relative), "utf8");
      } catch {
        return null;
      }
    },
    cleanup: () => fs.rm(base, { recursive: true, force: true }),
  };
}

/** G-E stand-in with the contract's behaviour: plan.json with actions and hashes only, created once. */
function planRecorder(root: string, runId: string): PlanRecorder {
  return {
    async savePlan(actions) {
      const stored: StoredPlan = { schemaVersion: 1, kind: "plan", runId, actions };
      const bytes = Buffer.from(`${JSON.stringify(stored)}\n`, "utf8");
      await fs.writeFile(path.join(root, ".codaryn", "runs", runId, PLAN_FILE_NAME), bytes, { flag: "wx" });
      return sha(bytes);
    },
  };
}

const POLICY: PolicyConfig = {
  commands: [],
  network: "deny",
  destructive: "deny",
  restorePathTokens: false,
  protectedPaths: ["keep"],
  planActions: ["move", "discard"],
};

function planTask(root: string, policy: PolicyConfig = POLICY): ResolvedTaskSpec {
  return {
    schemaVersion: 1,
    id: "tidy",
    goal: "tidy the folders",
    workflow: "organize",
    workflowRef: "organize",
    workspaceRoot: root,
    model: { provider: "scripted", scriptPath: "/unused" },
    policy,
    privacy: { secretEnv: [] },
    limits: { maxModelTurns: 6, maxToolCalls: 10, maxTotalTokens: null, maxDurationMs: 600_000, maxRepairAttempts: 0, maxSameFailures: 2 },
    verifiers: [],
    tools: ["read_file", "search_files", "inspect_files", "propose_plan"],
    plan: "apply",
    completion: "verifiers",
  };
}

async function planRun(s: Space, steps: ConstructorParameters<typeof FakeModel>[0], policy: PolicyConfig = POLICY) {
  const privacy = createPrivacyGateway({ secrets: [FAKE_SECRET] });
  const journal = new FakeJournal();
  const model = new FakeModel(steps);
  const deps: EngineDeps = {
    task: planTask(s.root, policy),
    runId: PLAN_RUN,
    model,
    privacy,
    policy: createPolicyGate({ config: policy, workspace: s.workspace }),
    tools: createToolRunner({ workspace: s.workspace, privacy, planRecorder: planRecorder(s.root, PLAN_RUN) }),
    verifiers: new FakeVerifiers(),
    journal,
    clock: new FakeClock(),
    signal: new AbortController().signal,
  };
  const result = await runTask(deps);
  return { result, journal, model };
}

const proposal = (actions: JsonObject[]) =>
  response([{ id: "p1", name: "propose_plan", args: { summary: "group by year, drop temporary files", actions } }]);

/** G-D stand-in: passes when every applied action's source is gone (enough for these cases). */
const inventory: InventoryChecker = {
  async capture() {
    return { entries: [], limitReached: false };
  },
  async check(input) {
    return {
      id: "inventory",
      kind: "inventory",
      outcome: "pass",
      evidence: asRawText(`${input.applied.length} actions`),
      checked: ["applied actions"],
      limits: [],
    };
  },
};

async function applyRun(s: Space, plan: StoredPlan, digest: ContentHash, options: { gate?: PolicyConfig; planActions?: readonly PlanActionKind[] } = {}) {
  const privacy = createPrivacyGateway({ secrets: [FAKE_SECRET] });
  const journal: ApplyJournalEntry[] = [];
  const deps: ApplyDeps = {
    plan,
    planRunId: PLAN_RUN,
    digest,
    approval: "cli-flag",
    runId: APPLY_RUN,
    taskId: "tidy",
    maxDurationMs: 600_000,
    verifierConfigs: [],
    executor: createPlanExecutor({ workspace: s.workspace, workspaceRoot: s.root, runId: APPLY_RUN }),
    policy: createPolicyGate({ config: options.gate ?? POLICY, workspace: s.workspace }),
    planActions: options.planActions ?? POLICY.planActions ?? [],
    discardedRoot: discardedRootOf(s.root, APPLY_RUN),
    privacy,
    verifiers: new FakeVerifiers(),
    inventory,
    journal: {
      append: async (event) => {
        journal.push(event);
      },
      close: async () => {},
    },
    clock: new FakeClock(),
    signal: new AbortController().signal,
    async markApplied() {
      try {
        await fs.writeFile(path.join(s.root, ".codaryn", "runs", PLAN_RUN, PLAN_APPLIED_FILE_NAME), "{}", { flag: "wx" });
        return "marked";
      } catch {
        return "already_applied";
      }
    },
  };
  return { result: await applyPlan(deps), journal };
}

async function storedPlan(s: Space): Promise<{ plan: StoredPlan; digest: ContentHash; bytes: Buffer }> {
  const bytes = await fs.readFile(path.join(s.root, ".codaryn", "runs", PLAN_RUN, PLAN_FILE_NAME));
  return { plan: JSON.parse(bytes.toString("utf8")) as StoredPlan, digest: sha(bytes), bytes };
}

const MOVE_AND_DISCARD: JsonObject[] = [
  { kind: "move", from: "photos/a.jpg", to: "2026/a.jpg" },
  { kind: "discard", path: "old/b.tmp" },
];

describe("plan run and apply run with the real parts", () => {
  test("a plan is stored without changing files, then applied exactly, with the discarded file kept", async () => {
    const s = await space();
    try {
      const planned = await planRun(s, [
        () => response([{ id: "i1", name: "inspect_files", args: { path: ".", hash: true } }]),
        () => proposal(MOVE_AND_DISCARD),
      ]);
      assert.deepEqual([planned.result.status, planned.result.reason], ["needs-input", "plan_pending"]);
      const { plan, digest } = await storedPlan(s);
      assert.equal(planned.result.plan?.digest, digest, "the result's digest is plan.json's");
      assert.deepEqual(Object.keys(plan).sort(), ["actions", "kind", "runId", "schemaVersion"], "DR-5");
      assert.equal(await s.read("photos/a.jpg"), "jpeg bytes a", "the plan run moved nothing");
      // The inspect result named a file after a registered secret; it reached the record masked.
      const inspected = planned.journal.ofType("tool_result")[0]?.result.content ?? "";
      assert.equal(inspected.includes(FAKE_SECRET), false);
      assert.ok(inspected.includes("notes/"), "the listing was returned");

      const applied = await applyRun(s, plan, digest);
      assert.deepEqual([applied.result.status, applied.result.reason], ["done", "verified"]);
      assert.equal(await s.read("photos/a.jpg"), null);
      assert.equal(await s.read("2026/a.jpg"), "jpeg bytes a");
      assert.equal(await s.read("old/b.tmp"), null);
      const discarded = applied.result.applied.find((record) => record.action.kind === "discard");
      assert.ok(discarded?.stored !== null && discarded?.stored !== undefined);
      const kept = await fs.readFile(path.join(discardedRootOf(s.root, APPLY_RUN), discarded.stored), "utf8");
      assert.equal(kept, "temporary b", "a discard keeps the file");
      assert.equal(await s.read("keep/x.txt"), "keep me");

      const again = await applyRun(s, plan, digest);
      assert.equal(again.result.reason, "plan_stale", "a plan is applied once");
    } finally {
      await s.cleanup();
    }
  });

  test("the real gate refuses an action on a protected path in the plan run; nothing is stored", async () => {
    const s = await space();
    try {
      const planned = await planRun(s, [() => proposal([{ kind: "move", from: "keep/x.txt", to: "2026/x.txt" }]), () => finalAnswer()]);
      assert.deepEqual([planned.result.status, planned.result.reason], ["failed", "model_error"]);
      const decision = planned.journal.ofType("tool_decision").find((record) => !record.allowed);
      assert.deepEqual([decision?.permission, decision?.code], ["path", "protected_path"]);
      await assert.rejects(fs.access(path.join(s.root, ".codaryn", "runs", PLAN_RUN, PLAN_FILE_NAME)));
    } finally {
      await s.cleanup();
    }
  });

  test("DR-18 (a): the apply re-judges with the gate of the apply task's policy", async () => {
    const s = await space();
    try {
      await planRun(s, [() => proposal(MOVE_AND_DISCARD)]);
      const { plan, digest } = await storedPlan(s);
      // The gate built from a policy without "discard" denies it, though the engine's own list allows it.
      const byGate = await applyRun(s, plan, digest, { gate: { ...POLICY, planActions: ["move"] }, planActions: ["move", "discard"] });
      assert.equal(byGate.result.reason, "plan_stale");
      const checked = byGate.journal.find((event) => event.type === "plan_checked");
      assert.deepEqual(checked?.type === "plan_checked" ? checked.problems : null, [{ index: 1, problem: "denied" }]);
      assert.equal(await s.read("photos/a.jpg"), "jpeg bytes a", "nothing moved");
      // The engine's own check still holds when a gate would allow it (defence in depth).
      const byEngine = await applyRun(s, plan, digest, { planActions: ["move"] });
      assert.equal(byEngine.result.reason, "plan_stale");
      assert.equal(await s.read("old/b.tmp"), "temporary b");
    } finally {
      await s.cleanup();
    }
  });

  test("a source changed after the plan makes the apply stale; the real executor finds it", async () => {
    const s = await space();
    try {
      await planRun(s, [() => proposal(MOVE_AND_DISCARD)]);
      const { plan, digest } = await storedPlan(s);
      await fs.writeFile(path.join(s.root, "photos", "a.jpg"), "edited after the plan", "utf8");
      const applied = await applyRun(s, plan, digest);
      assert.equal(applied.result.reason, "plan_stale");
      const checked = applied.journal.find((event) => event.type === "plan_checked");
      assert.deepEqual(checked?.type === "plan_checked" ? checked.problems : null, [{ index: 0, problem: "source_changed" }]);
      assert.equal(await s.read("old/b.tmp"), "temporary b", "nothing moved");
    } finally {
      await s.cleanup();
    }
  });

  test("the stored actions carry the tool's hashes of the sources, not anything from the model", async () => {
    const s = await space();
    try {
      await planRun(s, [() => proposal(MOVE_AND_DISCARD)]);
      const { plan } = await storedPlan(s);
      const expected: ResolvedPlanAction[] = [
        { kind: "move", from: "photos/a.jpg", to: "2026/a.jpg", sha256: sha("jpeg bytes a") },
        { kind: "discard", path: "old/b.tmp", sha256: sha("temporary b") },
      ];
      assert.deepEqual(plan.actions, expected);
    } finally {
      await s.cleanup();
    }
  });
});
