/**
 * G-B: the apply run (`applyPlan`, GT-E3, contract plan.ts ApplyDeps). No model: the stored
 * actions are judged, claimed, applied in order and verified (inventory first). The cases follow
 * the contract's order and its end states, including G-C's report: an executor that sees the
 * signal abort may answer io_error, and the apply must still end as cancelled.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE, asRawText, planActionShown } from "../../../src/contracts/index.js";
import type {
  AppliedPlanAction,
  ApplyDeps,
  ApplyJournalEntry,
  IntegrityChecker,
  IntegrityManifest,
  InventoryCheckInput,
  InventoryChecker,
  InventoryManifest,
  MaskedPlanAction,
  MaskedText,
  PlanExecutor,
  PlanItemOutcome,
  PlanItemProblem,
  RawVerifierResult,
  PrivacyGateway,
  ResolvedPlanAction,
  StoredPlanAction,
  VerifierOutcome,
} from "../../../src/contracts/index.js";
import { APPLY_FIXED_TEXTS, applyPlan } from "../../../src/engine/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { FAKE_SECRET, FAKE_TOKEN, FakeClock, FakePolicy, FakeVerifiers, HASH_A, HASH_B, fakePrivacy } from "./fakes.js";

const MOVE: ResolvedPlanAction = { kind: "move", from: "a.jpg", to: "2026/a.jpg", sha256: HASH_A };
const DISCARD: ResolvedPlanAction = { kind: "discard", path: "b.tmp", sha256: HASH_B };

/** DR-28: an action as a plan run stores it, `shown` made with that run's gateway. */
function stored(action: ResolvedPlanAction, privacy: PrivacyGateway = fakePrivacy()): StoredPlanAction {
  const mask = (text: string): MaskedText => {
    const masked = privacy.mask(text);
    if (!masked.ok) throw new Error("fixture cannot be masked");
    return masked.text;
  };
  const masked: MaskedPlanAction =
    action.kind === "move"
      ? { kind: "move", from: mask(action.from), to: mask(action.to), sha256: action.sha256 }
      : { kind: "discard", path: mask(action.path), sha256: action.sha256 };
  return { ...action, shown: planActionShown(masked) } as StoredPlanAction;
}

/** DR-28: a gateway with no secrets registered, as a task form without the plan run's secrets. */
function plainPrivacy(): PrivacyGateway {
  return { ...fakePrivacy(), mask: (text) => ({ ok: true, text: text as MaskedText }) };
}

class FakeApplyJournal {
  readonly events: ApplyJournalEntry[] = [];
  closed = false;
  /** R-9 I-4: a record type whose append fails, as when the process ends right before it. */
  failOn: string | null = null;
  async append(event: ApplyJournalEntry): Promise<void> {
    if (event.type === this.failOn) throw new Error("the process ended");
    this.events.push(event);
  }
  async close(): Promise<void> {
    this.closed = true;
  }
  types(): string[] {
    return this.events.map((event) => event.type);
  }
  ofType<T extends ApplyJournalEntry["type"]>(type: T): Extract<ApplyJournalEntry, { type: T }>[] {
    return this.events.filter((event): event is Extract<ApplyJournalEntry, { type: T }> => event.type === type);
  }
}

class FakeExecutor implements PlanExecutor {
  readonly checked: number[] = [];
  readonly applied: number[] = [];
  /** DR-21: the `allowUnsafeMove` the engine passed for each applied index. */
  readonly allowUnsafe: { index: number; allow: boolean | undefined }[] = [];
  constructor(
    private readonly options: {
      check?: (action: ResolvedPlanAction) => PlanItemProblem | null;
      apply?: (action: ResolvedPlanAction, index: number, allowUnsafeMove: boolean | undefined) => PlanItemOutcome;
    } = {},
  ) {}
  async check(action: ResolvedPlanAction): Promise<PlanItemProblem | null> {
    this.checked.push(this.checked.length);
    return this.options.check?.(action) ?? null;
  }
  async apply(
    action: ResolvedPlanAction,
    index: number,
    _signal: AbortSignal,
    options?: { readonly allowUnsafeMove: boolean },
  ): Promise<PlanItemOutcome> {
    this.applied.push(index);
    this.allowUnsafe.push({ index, allow: options?.allowUnsafeMove });
    if (this.options.apply !== undefined) return this.options.apply(action, index, options?.allowUnsafeMove);
    return { ok: true, applied: { index, action, stored: action.kind === "discard" ? String(index) : null } };
  }
}

/**
 * DR-21: an executor on a drive without hard links. The check reports every action as unsafe; the
 * apply moves only with `allowUnsafeMove` and then marks the outcome unsafe.
 */
function noHardLinkExecutor(): FakeExecutor {
  return new FakeExecutor({
    check: () => "unsafe_move",
    apply: (action, index, allow) =>
      allow === true
        ? { ok: true, applied: { index, action, stored: action.kind === "discard" ? String(index) : null, unsafe: true } }
        : { ok: false, problem: "unsafe_move" },
  });
}

class FakeInventory implements InventoryChecker {
  captures = 0;
  readonly inputs: InventoryCheckInput[] = [];
  constructor(
    private readonly options: {
      limitReached?: boolean;
      outcome?: VerifierOutcome;
      captureThrows?: boolean;
      /** R18-M1: runs during a capture, then the capture throws an AbortError (as a listing given the cancel signal does). */
      abortDuring?: () => void;
    } = {},
  ) {}
  async capture(): Promise<InventoryManifest> {
    this.captures += 1;
    if (this.options.abortDuring !== undefined) {
      this.options.abortDuring();
      throw new DOMException("This operation was aborted", "AbortError");
    }
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
    plan: { schemaVersion: 1, kind: "plan", runId: "20261112T000000Z-0000aaaa", actions: [stored(MOVE), stored(DISCARD)] },
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
      "plan_item_started",
      "file_moved",
      "plan_item_started",
      "file_discarded",
      "verifier_result",
      "verifier_result",
      "run_finished",
    ]);
    assert.deepEqual([result.kind, result.status, result.reason, result.exitCode], ["apply", "done", "verified", 0]);
    assert.deepEqual(result.verifiers.map((verifier) => verifier.id), ["inventory", "v1"]);
    assert.deepEqual(result.applied.map((record) => [record.index, record.action.kind, record.stored]), [
      [0, "move", null],
      [1, "discard", "1"],
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
        actions: [stored({ kind: "move", from: `${FAKE_SECRET}.jpg`, to: "x.jpg", sha256: HASH_A })],
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

describe("applyPlan: the plan's paths must be masked now as the plan run masked them (DR-28, R-11 M-1)", () => {
  const SECRET_MOVE: ResolvedPlanAction = { kind: "move", from: `${FAKE_SECRET}/c.jpg`, to: `2026/${FAKE_SECRET}/c.jpg`, sha256: HASH_A };
  const SECRET_DISCARD: ResolvedPlanAction = { kind: "discard", path: `${FAKE_SECRET}.tmp`, sha256: HASH_B };
  const planOf = (actions: StoredPlanAction[]) => ({ schemaVersion: 1, kind: "plan", runId: "20261112T000000Z-0000aaaa", actions }) as const;

  /** Nothing ran: no check, no inventory, no claim, no move, and the value appears nowhere. */
  function assertStoppedBeforeAnything(run: Setup, result: Awaited<ReturnType<typeof applyPlan>>): void {
    assert.deepEqual([result.status, result.reason], ["failed", "plan_stale"]);
    assert.ok(result.notices.some((notice) => notice.includes("plan_secrets_differ")), "the notice names the error");
    assert.deepEqual(run.executor.checked, [], "no action was checked");
    assert.deepEqual(run.executor.applied, [], "nothing was moved");
    assert.equal(run.inventory.captures, 0, "the inventory was not taken");
    assert.deepEqual(run.marks, [], "the plan was not claimed");
    assert.deepEqual(result.applied, []);
    assert.deepEqual(run.journal.types(), ["apply_started", "run_finished"]);
    assert.doesNotMatch(JSON.stringify(run.journal.events), new RegExp(FAKE_SECRET), "no plain value in the record");
    assert.doesNotMatch(JSON.stringify(result), new RegExp(FAKE_SECRET), "no plain value in the result");
  }

  test("R-11 M-1 reproduction: a plan made with a secret, applied without it, stops before anything", async () => {
    const run = setup({ plan: planOf([stored(SECRET_MOVE), stored(SECRET_DISCARD)]), privacy: plainPrivacy() });
    assertStoppedBeforeAnything(run, await applyPlan(run.deps));
  });

  test("a plan without shown (stored before DR-28) is treated as masked differently", async () => {
    const run = setup({ plan: planOf([MOVE, DISCARD] as StoredPlanAction[]) });
    assertStoppedBeforeAnything(run, await applyPlan(run.deps));
  });

  test("masking more than the plan run did is a difference too", async () => {
    const run = setup({ plan: planOf([stored(MOVE, plainPrivacy()), stored(DISCARD, plainPrivacy())]), privacy: fakePrivacy() });
    const withSecretPath = setup({
      plan: planOf([stored({ kind: "move", from: `${FAKE_SECRET}/c.jpg`, to: "d.jpg", sha256: HASH_A }, plainPrivacy())]),
    });
    assertStoppedBeforeAnything(withSecretPath, await applyPlan(withSecretPath.deps));
    assert.equal((await applyPlan(run.deps)).reason, "verified", "no secret in these paths: the same parts");
  });

  test("a shown form of the other kind never matches", async () => {
    const wrong = { ...MOVE, shown: { path: ["a.jpg"] } } as unknown as StoredPlanAction;
    const run = setup({ plan: planOf([wrong, stored(DISCARD)]) });
    assertStoppedBeforeAnything(run, await applyPlan(run.deps));
  });

  test("the same secrets as the plan run: the apply goes on, and the records stay masked", async () => {
    const run = setup({ plan: planOf([stored(SECRET_MOVE), stored(SECRET_DISCARD)]) });
    const result = await applyPlan(run.deps);
    assert.equal(result.reason, "verified");
    assert.deepEqual(run.executor.applied, [0, 1]);
    assert.doesNotMatch(JSON.stringify(run.journal.events), new RegExp(FAKE_SECRET));
    assert.match(JSON.stringify(run.journal.ofType("file_moved")), new RegExp(PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE));
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

  test("R18-M1: the engine ends a cancel during the listing as cancelled; nothing is claimed or moved", async () => {
    let controller: AbortController | undefined;
    const run = setup({ inventory: new FakeInventory({ abortDuring: () => controller?.abort() }) });
    controller = run.controller;
    const result = await applyPlan(run.deps);
    assert.deepEqual([result.status, result.reason, result.exitCode], ["cancelled", "cancelled", 5]);
    assert.ok(!result.notices.some((notice) => notice.includes("inventory")), "not reported as a failed listing");
    assert.deepEqual(run.executor.checked, []);
    assert.deepEqual(run.executor.applied, []);
    assert.deepEqual(run.marks, [], "the plan is not claimed: it can be applied again");
  });

  test("R18-M1: the duration limit reached during the listing ends as budget-exhausted, not plan_stale", async () => {
    let clock: FakeClock | undefined;
    const run = setup({ inventory: new FakeInventory({ abortDuring: () => { if (clock !== undefined) clock.t += 120_000; } }), maxDurationMs: 60_000 });
    clock = run.clock;
    const result = await applyPlan(run.deps);
    assert.deepEqual([result.status, result.reason], ["budget-exhausted", "max_duration"]);
    assert.deepEqual(run.marks, []);
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

describe("applyPlan: unsafe moves need a person's consent for this apply (DR-21)", () => {
  test("without consent the apply stops as needs-input/consent_required; nothing is claimed or moved", async () => {
    const executor = noHardLinkExecutor();
    const run = setup({ executor });
    const result = await applyPlan(run.deps);
    assert.deepEqual([result.status, result.reason], ["needs-input", "consent_required"]);
    const checked = run.journal.ofType("plan_checked")[0];
    assert.deepEqual(checked?.problems, []);
    assert.deepEqual(checked?.unsafeMoves, [0, 1]);
    assert.equal(run.journal.ofType("apply_started")[0]?.unsafeMoveConsent, null);
    assert.deepEqual(executor.applied, []);
    assert.deepEqual(run.marks, []);
    assert.deepEqual(result.applied, []);
    assert.deepEqual(result.verifiers, []);
    assert.deepEqual(run.journal.types(), ["apply_started", "plan_checked", "run_finished"]);
    assert.ok(result.notices.some((notice) => notice.includes("consent")));
  });

  test("with consent for this plan the moves are made, passed allowUnsafeMove, and recorded as unsafe", async () => {
    const executor = noHardLinkExecutor();
    const run = setup({ executor, unsafeMoveConsent: { channel: "cli-tty", digest: "d".repeat(64) } });
    const result = await applyPlan(run.deps);
    assert.deepEqual([result.status, result.reason], ["done", "verified"]);
    assert.equal(run.journal.ofType("apply_started")[0]?.unsafeMoveConsent, "cli-tty");
    assert.deepEqual(executor.allowUnsafe, [
      { index: 0, allow: true },
      { index: 1, allow: true },
    ]);
    assert.equal(run.journal.ofType("file_moved")[0]?.unsafe, true);
    assert.equal(run.journal.ofType("file_discarded")[0]?.unsafe, true);
    assert.deepEqual(
      result.applied.map((record) => record.unsafe),
      [true, true],
    );
    assert.ok(result.notices.some((notice) => notice.includes("consent")));
  });

  test("consent only lets the actions the preflight listed move unsafely", async () => {
    const executor = new FakeExecutor({ check: (action) => (action.kind === "move" ? "unsafe_move" : null) });
    const run = setup({ executor, unsafeMoveConsent: { channel: "adapter", digest: "d".repeat(64) } });
    const result = await applyPlan(run.deps);
    assert.equal(result.reason, "verified");
    assert.deepEqual(run.journal.ofType("plan_checked")[0]?.unsafeMoves, [0]);
    assert.deepEqual(executor.allowUnsafe, [
      { index: 0, allow: true },
      { index: 1, allow: false },
    ]);
    assert.equal(run.journal.ofType("file_discarded")[0]?.unsafe, undefined);
  });

  test("a consent given for another plan counts as none and says so", async () => {
    const executor = noHardLinkExecutor();
    const run = setup({ executor, unsafeMoveConsent: { channel: "cli-flag", digest: "e".repeat(64) } });
    const result = await applyPlan(run.deps);
    assert.equal(result.reason, "consent_required");
    assert.equal(run.journal.ofType("apply_started")[0]?.unsafeMoveConsent, null);
    assert.deepEqual(executor.applied, []);
    assert.ok(result.notices.some((notice) => notice.includes("another plan")));
  });

  test("a plan with no unsafe move ignores a consent: nothing is passed or marked unsafe", async () => {
    const run = setup({ unsafeMoveConsent: { channel: "cli-flag", digest: "d".repeat(64) } });
    const result = await applyPlan(run.deps);
    assert.equal(result.reason, "verified");
    assert.equal(run.journal.ofType("apply_started")[0]?.unsafeMoveConsent, "cli-flag");
    assert.deepEqual(run.journal.ofType("plan_checked")[0]?.unsafeMoves, []);
    assert.ok(run.executor.allowUnsafe.every((entry) => entry.allow === false));
    assert.ok(result.applied.every((record) => record.unsafe === undefined));
  });

  test("a problem still wins over unsafe moves: plan_stale, not consent_required", async () => {
    const executor = new FakeExecutor({ check: (action) => (action.kind === "move" ? "unsafe_move" : "source_changed") });
    const run = setup({ executor });
    const result = await applyPlan(run.deps);
    assert.equal(result.reason, "plan_stale");
    assert.deepEqual(run.journal.ofType("plan_checked")[0]?.problems, [{ index: 1, problem: "source_changed" }]);
  });

  test("an action the executor finds unsafe only while applying stops the apply; it is not moved", async () => {
    const executor = new FakeExecutor({
      apply: (action, index) =>
        action.kind === "discard"
          ? { ok: false, problem: "unsafe_move" }
          : { ok: true, applied: { index, action, stored: null } },
    });
    const run = setup({ executor });
    const result = await applyPlan(run.deps);
    assert.deepEqual([result.status, result.reason], ["failed", "apply_incomplete"]);
    const failed = run.journal.ofType("plan_item_failed")[0];
    assert.deepEqual([failed?.index, failed?.problem], [1, "unsafe_move"]);
  });
});

describe("applyPlan: a start record before each action (R-9 I-4)", () => {
  test("a stop right after an action, before its record, still leaves a record naming it", async () => {
    const run = setup();
    run.journal.failOn = "file_moved";
    await assert.rejects(applyPlan(run.deps));
    assert.deepEqual(run.executor.applied, [0], "the move was made");
    assert.deepEqual(run.journal.ofType("plan_item_started"), [
      { type: "plan_item_started", index: 0, action: { kind: "move", from: "a.jpg", to: "2026/a.jpg", sha256: HASH_A } },
    ]);
  });

  test("each action's start record is written before the executor runs it", async () => {
    let journal: FakeApplyJournal | undefined;
    const lastTypes: string[] = [];
    const executor = new FakeExecutor({
      apply: (action, index) => {
        lastTypes.push(journal?.types().at(-1) ?? "");
        return { ok: true, applied: { index, action, stored: action.kind === "discard" ? String(index) : null } };
      },
    });
    const run = setup({ executor });
    journal = run.journal;
    const result = await applyPlan(run.deps);
    assert.equal(result.reason, "verified");
    assert.deepEqual(lastTypes, ["plan_item_started", "plan_item_started"]);
    assert.deepEqual(run.journal.types().slice(0, 6), [
      "apply_started",
      "plan_checked",
      "plan_item_started",
      "file_moved",
      "plan_item_started",
      "file_discarded",
    ]);
  });

  test("an action that is not reached has no start record", async () => {
    let controller: AbortController | undefined;
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
    assert.deepEqual(
      run.journal.ofType("plan_item_started").map((event) => event.index),
      [0],
    );
  });

  test("a failed action keeps its start record and then its failure", async () => {
    const executor = new FakeExecutor({ apply: () => ({ ok: false, problem: "source_changed" }) });
    const run = setup({ executor });
    const result = await applyPlan(run.deps);
    assert.equal(result.reason, "apply_incomplete");
    assert.deepEqual(run.journal.types().slice(0, 4), ["apply_started", "plan_checked", "plan_item_started", "plan_item_failed"]);
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
