/**
 * U-105 (app layer U-91, gap survey GUI 3.9): the engine gives out the apply preflight's judgement
 * of each action as `preflightPlan`, and `applyPlan` calls the same function, so a caller that
 * checks a plan before applying it does not judge again. Each action: the apply task's planActions,
 * the policy gate before and after, then the executor's check; nothing is moved, recorded or
 * claimed. The apply's own behaviour stays: the same `plan_checked`, and a cancel or the duration
 * limit before an action still ends the apply as before. The records the engine writes all carry
 * a type of the contract's lists (U-105 contract).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { APPLY_JOURNAL_ENTRY_TYPES, JOURNAL_EVENT_TYPES, PLAN_ACTION_DESCRIPTORS, asRawText, planActionShown } from "../../../src/contracts/index.js";
import type {
  ApplyJournalEntryRecord,
  ApplyDeps,
  ApplyJournalEntry,
  InventoryChecker,
  MaskedPlanAction,
  MaskedText,
  PlanActionKind,
  PlanExecutor,
  PlanItemOutcome,
  PlanItemProblem,
  PolicyDecision,
  ResolvedPlanAction,
  StoredPlanAction,
} from "../../../src/contracts/index.js";
import { applyPlan, preflightPlan, runTask } from "../../../src/engine/index.js";
import { FakeClock, FakePolicy, FakeVerifiers, HASH_A, HASH_B, fakePrivacy, finalAnswer, harness, readCall, response } from "./fakes.js";

const move = (from: string, sha256 = HASH_A): ResolvedPlanAction => ({ kind: "move", from, to: `done/${from}`, sha256 });
const discard = (path: string): ResolvedPlanAction => ({ kind: "discard", path, sha256: HASH_B });

/** The judgement cases, one per action: what each part says about it. */
const ACTIONS: readonly ResolvedPlanAction[] = [
  move("ok.txt"), // 0: every part allows
  discard("tmp.txt"), // 1: not in planActions (move only)
  move("asked.txt"), // 2: the gate's first check denies
  move("throws.txt"), // 3: the gate's second check throws
  move("changed.txt"), // 4: the executor: source_changed
  move("fat.txt"), // 5: the executor: unsafe_move (DR-21)
  move("broken.txt"), // 6: the executor throws
];
const PLAN_ACTIONS: readonly PlanActionKind[] = ["move"];
const DENY: PolicyDecision = { allowed: false, permission: "path", code: "plan_action_not_allowed" };

function sourceOf(action: ResolvedPlanAction): string {
  return action.kind === "move" ? action.from : action.path;
}

class JudgingExecutor implements PlanExecutor {
  readonly checked: string[] = [];
  readonly applied: number[] = [];
  constructor(private readonly onCheck: (action: ResolvedPlanAction) => void = () => undefined) {}
  async check(action: ResolvedPlanAction): Promise<PlanItemProblem | null> {
    this.checked.push(sourceOf(action));
    this.onCheck(action);
    const answers: Record<string, PlanItemProblem | null> = { "changed.txt": "source_changed", "fat.txt": "unsafe_move" };
    if (sourceOf(action) === "broken.txt") throw new Error("the disk went away");
    return answers[sourceOf(action)] ?? null;
  }
  async apply(action: ResolvedPlanAction, index: number): Promise<PlanItemOutcome> {
    this.applied.push(index);
    return { ok: true, applied: { index, action, stored: null } };
  }
}

function judgingPolicy(): FakePolicy {
  return new FakePolicy({
    requested: (call) => (call.id === "action-2" ? DENY : { allowed: true }),
    effective: (call) => {
      if (call.id === "action-3") throw new Error("the gate failed");
      return { allowed: true };
    },
  });
}

function stored(action: ResolvedPlanAction): StoredPlanAction {
  const masked: MaskedPlanAction =
    action.kind === "move"
      ? { kind: "move", from: action.from as MaskedText, to: action.to as MaskedText, sha256: action.sha256 }
      : { kind: "discard", path: action.path as MaskedText, sha256: action.sha256 };
  return { ...action, shown: planActionShown(masked) } as StoredPlanAction;
}

class ApplyRecords {
  readonly events: ApplyJournalEntry[] = [];
  async append(event: ApplyJournalEntry): Promise<ApplyJournalEntryRecord> {
    this.events.push(event);
    return { seq: this.events.length, at: new Date(0).toISOString(), runId: "fake-apply", ...event };
  }
  async close(): Promise<void> {}
}

const inventory: InventoryChecker = {
  capture: async () => ({ entries: [], limitReached: false }),
  check: async () => ({ id: "inventory", kind: "inventory", outcome: "pass", evidence: asRawText("ok"), checked: [], limits: [] }),
};

function applyDeps(actions: readonly ResolvedPlanAction[], executor: PlanExecutor, policy: FakePolicy, clock = new FakeClock()) {
  const journal = new ApplyRecords();
  const controller = new AbortController();
  const marks: string[] = [];
  const deps: ApplyDeps = {
    plan: { schemaVersion: 1, kind: "plan", runId: "20261113T000000Z-0000aaaa", actions: actions.map(stored) },
    planRunId: "20261113T000000Z-0000aaaa",
    digest: "d".repeat(64),
    approval: "cli-flag",
    runId: "20261113T000100Z-0000bbbb",
    taskId: "tidy",
    maxDurationMs: 60_000,
    verifierConfigs: [],
    executor,
    policy,
    planActions: PLAN_ACTIONS,
    discardedRoot: "/work/.codaryn/discarded/20261113T000100Z-0000bbbb",
    privacy: fakePrivacy(),
    verifiers: new FakeVerifiers(),
    inventory,
    journal,
    clock,
    signal: controller.signal,
    async markApplied() {
      marks.push("mark");
      return "marked";
    },
  };
  return { deps, journal, controller, marks };
}

describe("U-105: preflightPlan is the apply's own judgement", () => {
  test("each part decides as in the apply, and the result equals the apply's plan_checked", async () => {
    const executor = new JudgingExecutor();
    const outcome = await preflightPlan({ actions: ACTIONS, planActions: PLAN_ACTIONS, policy: judgingPolicy(), executor });
    assert.deepEqual(outcome, {
      stopped: false,
      problems: [
        { index: 1, problem: "denied" },
        { index: 2, problem: "denied" },
        { index: 3, problem: "denied" },
        { index: 4, problem: "source_changed" },
        { index: 6, problem: "io_error" },
      ],
      unsafeMoves: [5],
    });
    assert.deepEqual(executor.checked, ["ok.txt", "changed.txt", "fat.txt", "broken.txt"], "a denied action is not checked");

    const applyExecutor = new JudgingExecutor();
    const run = applyDeps(ACTIONS, applyExecutor, judgingPolicy());
    const result = await applyPlan(run.deps);
    assert.deepEqual([result.status, result.reason], ["failed", "plan_stale"]);
    const checked = run.journal.events.find((event) => event.type === "plan_checked");
    assert.ok(checked !== undefined && checked.type === "plan_checked" && !outcome.stopped);
    assert.deepEqual({ problems: checked.problems, unsafeMoves: checked.unsafeMoves }, { problems: outcome.problems, unsafeMoves: outcome.unsafeMoves });
    assert.deepEqual(applyExecutor.checked, executor.checked);
  });

  test("the gate is asked as the apply asks it: id action-<index>, the descriptor's name, the path fields", async () => {
    const policy = new FakePolicy();
    const actions = [move("a.txt"), discard("b.txt")];
    const outcome = await preflightPlan({ actions, planActions: ["move", "discard"], policy, executor: new JudgingExecutor() });
    assert.deepEqual(outcome, { stopped: false, problems: [], unsafeMoves: [] });
    assert.deepEqual(
      policy.effectiveCalls.map((call) => [call.id, call.name, call.args]),
      [
        ["action-0", PLAN_ACTION_DESCRIPTORS.move.name, { from: "a.txt", to: "done/a.txt" }],
        ["action-1", PLAN_ACTION_DESCRIPTORS.discard.name, { path: "b.txt" }],
      ],
    );
  });

  test("nothing is moved, recorded or claimed: only check is called", async () => {
    const executor = new JudgingExecutor();
    await preflightPlan({ actions: [move("ok.txt"), move("fat.txt")], planActions: PLAN_ACTIONS, policy: new FakePolicy(), executor });
    assert.deepEqual(executor.applied, []);
    assert.deepEqual(executor.checked, ["ok.txt", "fat.txt"]);
  });

  test("no actions: nothing to judge", async () => {
    const outcome = await preflightPlan({ actions: [], planActions: [], policy: new FakePolicy(), executor: new JudgingExecutor() });
    assert.deepEqual(outcome, { stopped: false, problems: [], unsafeMoves: [] });
  });

  test("stop is asked before each action; true stops there with nothing more judged", async () => {
    const executor = new JudgingExecutor();
    let asked = 0;
    const outcome = await preflightPlan({
      actions: ACTIONS,
      planActions: PLAN_ACTIONS,
      policy: new FakePolicy(),
      executor,
      stop: () => {
        asked += 1;
        return asked === 3;
      },
    });
    assert.deepEqual(outcome, { stopped: true });
    assert.equal(asked, 3);
    assert.deepEqual(executor.checked, ["ok.txt"], "action 1 is not in planActions, action 2 is not reached");
    const first = new JudgingExecutor();
    assert.deepEqual(await preflightPlan({ actions: ACTIONS, planActions: PLAN_ACTIONS, policy: new FakePolicy(), executor: first, stop: () => true }), { stopped: true });
    assert.deepEqual(first.checked, []);
  });
});

describe("U-105: the apply around preflightPlan is as before", () => {
  test("a cancel during the preflight ends the apply as cancelled: no plan_checked, nothing claimed or moved", async () => {
    let controller: AbortController | undefined;
    const executor = new JudgingExecutor((action) => {
      if (sourceOf(action) === "ok.txt") controller?.abort();
    });
    const run = applyDeps([move("ok.txt"), move("next.txt")], executor, new FakePolicy());
    controller = run.controller;
    const result = await applyPlan(run.deps);
    assert.deepEqual([result.status, result.reason, result.exitCode], ["cancelled", "cancelled", 5]);
    assert.deepEqual(executor.checked, ["ok.txt"]);
    assert.deepEqual(executor.applied, []);
    assert.deepEqual(run.marks, []);
    assert.deepEqual(run.journal.events.map((event) => event.type), ["apply_started", "run_finished"]);
  });

  test("the duration limit during the preflight ends the apply as budget-exhausted/max_duration", async () => {
    const clock = new FakeClock();
    const executor = new JudgingExecutor(() => {
      clock.t += 60_000;
    });
    const run = applyDeps([move("ok.txt"), move("next.txt")], executor, new FakePolicy(), clock);
    const result = await applyPlan(run.deps);
    assert.deepEqual([result.status, result.reason, result.exitCode], ["budget-exhausted", "max_duration", 4]);
    assert.deepEqual(executor.checked, ["ok.txt"]);
    assert.deepEqual(run.marks, []);
  });

  test("a plan that fits is judged, claimed and applied as before", async () => {
    const executor = new JudgingExecutor();
    const run = applyDeps([move("ok.txt"), move("two.txt")], executor, new FakePolicy());
    const result = await applyPlan(run.deps);
    assert.deepEqual([result.status, result.reason], ["done", "verified"]);
    assert.deepEqual(executor.applied, [0, 1]);
    const checked = run.journal.events.find((event) => event.type === "plan_checked");
    assert.deepEqual(checked, { type: "plan_checked", problems: [], inventoryLimitReached: false, unsafeMoves: [] });
  });
});

describe("U-105: the records the engine writes carry a type of the contract's lists", () => {
  test("an apply journal", async () => {
    const run = applyDeps([move("ok.txt"), discard("tmp.txt")], new JudgingExecutor(), new FakePolicy());
    run.deps = { ...run.deps, planActions: ["move", "discard"] };
    await applyPlan(run.deps);
    const known: readonly string[] = APPLY_JOURNAL_ENTRY_TYPES;
    const types = run.journal.events.map((event) => event.type);
    assert.ok(types.includes("plan_item_started") && types.includes("file_discarded"));
    for (const type of types) assert.ok(known.includes(type), type);
  });

  test("a run journal", async () => {
    const h = harness({ steps: [() => response([readCall("c1")]), () => finalAnswer()] });
    await runTask(h.deps);
    const known: readonly string[] = JOURNAL_EVENT_TYPES;
    const types = h.journal.events.map((event) => event.type);
    assert.ok(types.includes("tool_result") && types.includes("run_finished"));
    for (const type of types) assert.ok(known.includes(type), type);
  });

  test("a run journal with a permission question (U-74's two records)", async () => {
    const mark: PolicyDecision = { allowed: false, permission: "command", code: "confirmation_required", confirm: true };
    let checks = 0;
    const policy = new FakePolicy({ effective: () => (checks++ === 0 ? mark : { allowed: true }) });
    const call = { id: "c1", name: "run_command", args: { executable: "npm", args: ["test"] } };
    const h = harness({ steps: [() => response([call]), () => finalAnswer()], policy });
    h.deps = { ...h.deps, confirm: async () => ({ decision: "allow_once" }) };
    await runTask(h.deps);
    const known: readonly string[] = JOURNAL_EVENT_TYPES;
    const types = h.journal.events.map((event) => event.type);
    assert.ok(types.includes("confirmation_requested") && types.includes("confirmation_answered"));
    for (const type of types) assert.ok(known.includes(type), type);
  });
});
