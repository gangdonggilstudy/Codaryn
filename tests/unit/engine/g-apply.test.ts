/**
 * G-B: the apply run (`applyPlan`, GT-E3, contract plan.ts ApplyDeps). No model: the stored
 * actions are judged, claimed, applied in order and verified (inventory first). The cases follow
 * the contract's order and its end states, including G-C's report: an executor that sees the
 * signal abort may answer io_error, and the apply must still end as cancelled.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE, asRawText } from "../../../src/contracts/index.js";
import type {
  AppliedPlanAction,
  ApplyDeps,
  ApplyJournalEvent,
  IntegrityChecker,
  IntegrityManifest,
  InventoryCheckInput,
  InventoryChecker,
  InventoryManifest,
  PlanExecutor,
  PlanItemOutcome,
  PlanItemProblem,
  RawVerifierResult,
  ResolvedPlanAction,
  VerifierOutcome,
} from "../../../src/contracts/index.js";
import { APPLY_FIXED_TEXTS, applyPlan } from "../../../src/engine/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { FAKE_SECRET, FAKE_TOKEN, FakeClock, FakePolicy, FakeVerifiers, HASH_A, HASH_B, fakePrivacy } from "./fakes.js";

const MOVE: ResolvedPlanAction = { kind: "move", from: "a.jpg", to: "2026/a.jpg", sha256: HASH_A };
const DISCARD: ResolvedPlanAction = { kind: "discard", path: "b.tmp", sha256: HASH_B };

class FakeApplyJournal {
  readonly events: ApplyJournalEvent[] = [];
  closed = false;
  async append(event: ApplyJournalEvent): Promise<void> {
    this.events.push(event);
  }
  async close(): Promise<void> {
    this.closed = true;
  }
  types(): string[] {
    return this.events.map((event) => event.type);
  }
  ofType<T extends ApplyJournalEvent["type"]>(type: T): Extract<ApplyJournalEvent, { type: T }>[] {
    return this.events.filter((event): event is Extract<ApplyJournalEvent, { type: T }> => event.type === type);
  }
}

class FakeExecutor implements PlanExecutor {
  readonly checked: number[] = [];
  readonly applied: number[] = [];
  constructor(
    private readonly options: {
      check?: (action: ResolvedPlanAction) => PlanItemProblem | null;
      apply?: (action: ResolvedPlanAction, index: number) => PlanItemOutcome;
    } = {},
  ) {}
  async check(action: ResolvedPlanAction): Promise<PlanItemProblem | null> {
    this.checked.push(this.checked.length);
    return this.options.check?.(action) ?? null;
  }
  async apply(action: ResolvedPlanAction, index: number): Promise<PlanItemOutcome> {
    this.applied.push(index);
    if (this.options.apply !== undefined) return this.options.apply(action, index);
    return { ok: true, applied: { index, action, stored: action.kind === "discard" ? String(index).padStart(4, "0") : null } };
  }
}

class FakeInventory implements InventoryChecker {
  captures = 0;
  readonly inputs: InventoryCheckInput[] = [];
  constructor(
    private readonly options: { limitReached?: boolean; outcome?: VerifierOutcome; captureThrows?: boolean } = {},
  ) {}
  async capture(): Promise<InventoryManifest> {
    this.captures += 1;
    if (this.options.captureThrows === true) throw new Error("cannot list");
    return { entries: [], limitReached: this.options.limitReached === true };
  }
  async check(input: InventoryCheckInput): Promise<RawVerifierResult> {
    this.inputs.push(input);
    return {
      id: "inventory",
      kind: "inventory",
      outcome: this.options.outcome ?? "pass",
      evidence: asRawText(`checked ${input.applied.length} actions`),
      checked: ["the inventory"],
      limits: ["a file outside the plan that changed but kept its size is not detected"],
    };
  }
}

interface Setup {
  deps: ApplyDeps;
  journal: FakeApplyJournal;
  executor: FakeExecutor;
  inventory: FakeInventory;
  verifiers: FakeVerifiers;
  clock: FakeClock;
  controller: AbortController;
  marks: string[];
}

function setup(parts: Partial<Omit<ApplyDeps, "journal" | "executor" | "inventory" | "verifiers" | "clock" | "signal">> & {
  executor?: FakeExecutor;
  inventory?: FakeInventory;
  verifiers?: FakeVerifiers;
  alreadyApplied?: boolean;
} = {}): Setup {
  const journal = new FakeApplyJournal();
  const executor = parts.executor ?? new FakeExecutor();
  const inventory = parts.inventory ?? new FakeInventory();
  const verifiers = parts.verifiers ?? new FakeVerifiers();
  const clock = new FakeClock();
  const controller = new AbortController();
  const marks: string[] = [];
  const deps: ApplyDeps = {
    plan: { schemaVersion: 1, kind: "plan", runId: "20261112T000000Z-0000aaaa", actions: [MOVE, DISCARD] },
    planRunId: "20261112T000000Z-0000aaaa",
    digest: "d".repeat(64),
    approval: "cli-flag",
    runId: "20261112T000100Z-0000bbbb",
    taskId: "tidy",
    maxDurationMs: 60_000,
    verifierConfigs: [{ id: "v1", kind: "file_rules", rules: [{ type: "exists", path: "2026/a.jpg" }] }],
    policy: new FakePolicy(),
    planActions: ["move", "discard"],
    discardedRoot: "/work/.codaryn/discarded/20261112T000100Z-0000bbbb",
    privacy: fakePrivacy(),
    async markApplied() {
      marks.push("mark");
      return parts.alreadyApplied === true ? "already_applied" : "marked";
    },
    ...parts,
    executor,
    inventory,
    verifiers,
    journal,
    clock,
    signal: controller.signal,
  };
  return { deps, journal, executor, inventory, verifiers, clock, controller, marks };
}

describe("applyPlan: a plan that fits", () => {
  test("judges, claims, applies in order, verifies the inventory first and ends done", async () => {
    const run = setup();
    const result = await applyPlan(run.deps);
    assert.deepEqual(run.journal.types(), [
      "apply_started",
      "plan_checked",
      "file_moved",
      "file_discarded",
      "verifier_result",
      "verifier_result",
      "run_finished",
    ]);
    assert.deepEqual([result.kind, result.status, result.reason, result.exitCode], ["apply", "done", "verified", 0]);
    assert.deepEqual(result.verifiers.map((verifier) => verifier.id), ["inventory", "v1"]);
    assert.deepEqual(result.applied.map((record) => [record.index, record.action.kind, record.stored]), [
      [0, "move", null],
      [1, "discard", "0001"],
    ]);
    assert.deepEqual(run.marks, ["mark"]);
    assert.equal(run.inventory.captures, 2, "before the actions and after them");
    assert.equal(run.inventory.inputs[0]?.discardedRoot, run.deps.discardedRoot);
    assert.deepEqual(run.inventory.inputs[0]?.applied.map((one: AppliedPlanAction) => one.index), [0, 1]);
    assert.deepEqual({ ...result.usage, durationMs: 0 }, { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, repairAttempts: 0 });
    assert.equal(result.planRunId, run.deps.planRunId);
    assert.equal(result.journalPath, `.codaryn/runs/${run.deps.runId}/journal.jsonl`);
    assert.ok(run.journal.closed);
    const [started] = run.journal.ofType("apply_started");
    assert.deepEqual([started?.approval, started?.actions, started?.digest], ["cli-flag", 2, "d".repeat(64)]);
  });

  test("paths are masked in the record and the result", async () => {
    const run = setup({
      plan: {
        schemaVersion: 1,
        kind: "plan",
        runId: "20261112T000000Z-0000aaaa",
        actions: [{ kind: "move", from: `${FAKE_SECRET}.jpg`, to: "x.jpg", sha256: HASH_A }],
      },
    });
    const result = await applyPlan(run.deps);
    assert.equal(JSON.stringify([run.journal.events, result]).includes(FAKE_SECRET), false);
    const [moved] = run.journal.ofType("file_moved");
    assert.equal(moved?.from, `${FAKE_TOKEN}.jpg`);
  });

  test("every fixed text is plain: the real gateway leaves it unchanged and it spells no marker", () => {
    const privacy = createPrivacyGateway({ secrets: ["fake-secret-VALUE-0009"] });
    const marker = new RegExp(PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE, "i");
    for (const text of APPLY_FIXED_TEXTS) {
      assert.equal(marker.test(text), false, text);
      const masked = privacy.mask(text);
      assert.ok(masked.ok && masked.text === text, text);
    }
  });
});

describe("applyPlan: preflight stops before anything moves", () => {
  test("an action that no longer fits makes the apply plan_stale; nothing is claimed or applied", async () => {
    const executor = new FakeExecutor({ check: (action) => (action.kind === "discard" ? "source_changed" : null) });
    const run = setup({ executor });
    const result = await applyPlan(run.deps);
    assert.deepEqual([result.status, result.reason, result.exitCode], ["failed", "plan_stale", 1]);
    assert.deepEqual(run.journal.ofType("plan_checked")[0]?.problems, [{ index: 1, problem: "source_changed" }]);
    assert.deepEqual(executor.applied, []);
    assert.deepEqual(run.marks, []);
    assert.deepEqual(result.applied, []);
    assert.deepEqual(result.verifiers, []);
  });

  test("an action the apply task's policy denies is a problem (DR-5)", async () => {
    const policy = new FakePolicy({
      requested: (call) => (call.args["path"] === "b.tmp" ? { allowed: false, permission: "path", code: "protected_path" } : { allowed: true }),
    });
    const run = setup({ policy });
    const result = await applyPlan(run.deps);
    assert.equal(result.reason, "plan_stale");
    assert.deepEqual(run.journal.ofType("plan_checked")[0]?.problems, [{ index: 1, problem: "denied" }]);
  });

  test("a kind missing from the apply task's planActions is denied without asking the gate", async () => {
    const asked: string[] = [];
    const policy = new FakePolicy({
      requested: (call) => {
        asked.push(call.name);
        return { allowed: true };
      },
    });
    const run = setup({ policy, planActions: ["move"] });
    const result = await applyPlan(run.deps);
    assert.equal(result.reason, "plan_stale");
    assert.deepEqual(asked, ["plan.move"]);
    assert.deepEqual(run.journal.ofType("plan_checked")[0]?.problems, [{ index: 1, problem: "denied" }]);
  });

  test("the inventory limit stops the apply before anything moves (DR-6)", async () => {
    const run = setup({ inventory: new FakeInventory({ limitReached: true }) });
    const result = await applyPlan(run.deps);
    assert.equal(result.reason, "plan_stale");
    assert.equal(run.journal.ofType("plan_checked")[0]?.inventoryLimitReached, true);
    assert.deepEqual(run.executor.applied, []);
    assert.ok(result.notices.some((notice) => notice.includes("inventory")));
  });

  test("an inventory that cannot be taken stops the apply too", async () => {
    const run = setup({ inventory: new FakeInventory({ captureThrows: true }) });
    const result = await applyPlan(run.deps);
    assert.equal(result.reason, "plan_stale");
    assert.deepEqual(run.executor.applied, []);
  });

  test("a plan applied before is not applied again", async () => {
    const run = setup({ alreadyApplied: true });
    const result = await applyPlan(run.deps);
    assert.equal(result.reason, "plan_stale");
    assert.deepEqual(run.marks, ["mark"]);
    assert.deepEqual(run.executor.applied, []);
  });
});

describe("applyPlan: stopping while applying", () => {
  test("a failed action ends as apply_incomplete; the earlier ones stay listed and nothing is verified", async () => {
    const executor = new FakeExecutor({
      apply: (action, index) => (index === 1 ? { ok: false, problem: "destination_exists" } : { ok: true, applied: { index, action, stored: null } }),
    });
    const run = setup({ executor });
    const result = await applyPlan(run.deps);
    assert.deepEqual([result.status, result.reason], ["failed", "apply_incomplete"]);
    assert.deepEqual(result.applied.map((record) => record.index), [0]);
    assert.deepEqual(run.journal.ofType("plan_item_failed"), [{ type: "plan_item_failed", index: 1, problem: "destination_exists" }]);
    assert.deepEqual(result.verifiers, []);
    assert.ok(result.notices.some((notice) => notice.includes("codaryn revert")));
  });

  test("G-C: an executor that reports io_error for a cancelled action still ends the apply as cancelled", async () => {
    let controller: AbortController | null = null;
    const executor = new FakeExecutor({
      apply: (action, index) => {
        if (index === 1) {
          controller?.abort();
          return { ok: false, problem: "io_error" };
        }
        return { ok: true, applied: { index, action, stored: null } };
      },
    });
    const run = setup({ executor });
    controller = run.controller;
    const result = await applyPlan(run.deps);
    assert.deepEqual([result.status, result.reason, result.exitCode], ["cancelled", "cancelled", 5]);
    assert.deepEqual(result.applied.map((record) => record.index), [0]);
    assert.equal(run.journal.ofType("plan_item_failed")[0]?.index, 1, "the cancelled action is recorded as not done");
  });

  test("a cancel between actions stops before the next one", async () => {
    let controller: AbortController | null = null;
    const executor = new FakeExecutor({
      apply: (action, index) => {
        controller?.abort();
        return { ok: true, applied: { index, action, stored: null } };
      },
    });
    const run = setup({ executor });
    controller = run.controller;
    const result = await applyPlan(run.deps);
    assert.equal(result.reason, "cancelled");
    assert.deepEqual(executor.applied, [0]);
    assert.deepEqual(result.applied.map((record) => record.index), [0]);
  });

  test("the duration limit between actions ends as budget-exhausted/max_duration", async () => {
    let clock: FakeClock | null = null;
    const executor = new FakeExecutor({
      apply: (action, index) => {
        if (clock !== null) clock.t = 60_000;
        return { ok: true, applied: { index, action, stored: null } };
      },
    });
    const run = setup({ executor });
    clock = run.clock;
    const result = await applyPlan(run.deps);
    assert.deepEqual([result.status, result.reason, result.exitCode], ["budget-exhausted", "max_duration", 4]);
    assert.deepEqual(executor.applied, [0]);
  });
});

describe("applyPlan: verification", () => {
  test("a failing inventory ends as verifier_failed; no repair", async () => {
    const run = setup({ inventory: new FakeInventory({ outcome: "fail" }) });
    const result = await applyPlan(run.deps);
    assert.deepEqual([result.status, result.reason], ["failed", "verifier_failed"]);
    assert.equal(result.applied.length, 2, "the actions stay done");
  });

  test("an inconclusive task verifier ends as needs-input/verifier_inconclusive", async () => {
    const run = setup({ verifiers: new FakeVerifiers({ v1: "inconclusive" }) });
    const result = await applyPlan(run.deps);
    assert.deepEqual([result.status, result.reason], ["needs-input", "verifier_inconclusive"]);
  });

  test("protected material changed during the apply makes it protected_changed", async () => {
    let captures = 0;
    const manifest = (sha: string): IntegrityManifest => ({ entries: [{ path: asRawText("tests/a.test.ts"), kind: "file", sha256: sha }] });
    const integrity: IntegrityChecker = {
      async capture() {
        captures += 1;
        return captures === 1 ? manifest(HASH_A) : manifest(HASH_B);
      },
      compare(before, after) {
        return before.entries[0]?.kind === "file" && after.entries[0]?.kind === "file" && before.entries[0].sha256 !== after.entries[0].sha256
          ? [asRawText("tests/a.test.ts")]
          : [];
      },
    };
    const run = setup({ integrity });
    const result = await applyPlan(run.deps);
    assert.deepEqual([result.status, result.reason], ["needs-input", "protected_changed"]);
    assert.deepEqual(result.protectedChanged, ["tests/a.test.ts"]);
    assert.equal(result.applied.length, 2);
  });
});
