/**
 * U-175 (R-99 M-3, DR-69 B-3/B-4): the contract the later units lean on, only additions.
 * - planApplyStateOf takes a run (`kind: "run"`) that names the plan run in `planRunId` as that
 *   plan's apply, as an apply run; RunListEntry.planRunId may be on such a run. Lists without one
 *   give every state as before (g-r55-plan-apply-state is unchanged).
 * - EngineResult.plan.kind "changes" for a `run` plan; absent for a plan of mode apply.
 * - LoadPlanOutcome<P> with LoadPlan as before (StoredPlan) and LoadAnyPlan for both kinds.
 * - PlanRecorder.saveChangesPlan, optional until the store has it.
 * - ChangesPlanOutput beside PlanOutput (AnyPlanOutput), told apart by `planKind`.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { maskedParts, planApplyStateOf, toRunId } from "../../../src/contracts/index.js";
import type {
  AnyPlanOutput,
  AnyStoredPlan,
  ChangesPlanOutput,
  ContentHash,
  EngineResult,
  LoadPlanOutcome,
  MaskedPlannedFile,
  MaskedText,
  PlanOutput,
  PlanRecorder,
  RunId,
  RunListEntry,
  RunReason,
  StoredChangesPlan,
  StoredPlan,
  TerminalRunStatus,
} from "../../../src/contracts/index.js";

type Checked = Extract<RunListEntry, { state: "checked" }>;

const PLAN = toRunId("20261113T070000Z-0000aaaa") as RunId;
const RUN = toRunId("20261113T070100Z-0000bbbb") as RunId;
const OTHER_PLAN = toRunId("20261113T065900Z-0000cccc") as RunId;
const HASH = "c".repeat(64) as ContentHash;

function entry(runId: RunId, status: TerminalRunStatus | null, reason: RunReason | null, more: Partial<Checked> = {}): Checked {
  return { state: "checked", runId, startedAt: "2026-11-13T07:00:00.000Z", taskId: "docs", status, reason, changes: null, reverted: null, ...more };
}
const plan = entry(PLAN, "needs-input", "plan_pending", { appliedBy: { runId: RUN, at: "2026-11-13T07:01:00.000Z" } });
const carriedOut = (status: TerminalRunStatus | null, reason: RunReason | null, more: Partial<Checked> = {}) =>
  entry(RUN, status, reason, { kind: "run", planRunId: PLAN, ...more });
const stateIn = (entries: readonly RunListEntry[]) => planApplyStateOf(plan, entries);

describe("U-175: a run that carried out a run plan is that plan's apply", () => {
  test("its status reads as an apply run's would", () => {
    assert.deepEqual(stateIn([carriedOut("done", "verified"), plan]), { state: "applied", applyRunId: RUN });
    assert.deepEqual(stateIn([carriedOut(null, null), plan]), { state: "applying", applyRunId: RUN });
    assert.deepEqual(stateIn([carriedOut("needs-input", "no_verifier"), plan]), { state: "unfinished", applyRunId: RUN, reason: "no_verifier" });
    assert.deepEqual(stateIn([carriedOut("failed", "plan_stale"), plan]), { state: "unfinished", applyRunId: RUN, reason: "plan_stale" });
    assert.deepEqual(stateIn([carriedOut("done", "verified", { reverted: { at: "2026-11-13T08:00:00.000Z", status: "complete" } }), plan]), { state: "reverted", applyRunId: RUN });
  });

  test("a kind left out is a run too, as everywhere in the list", () => {
    assert.deepEqual(stateIn([entry(RUN, "done", "verified", { planRunId: PLAN }), plan]), { state: "applied", applyRunId: RUN });
  });

  test("a run of another plan, or one naming none, is not this plan's apply", () => {
    for (const other of [carriedOut("done", "verified", { planRunId: OTHER_PLAN }), entry(RUN, "done", "verified", { kind: "run" }), entry(RUN, "done", "verified")]) {
      assert.deepEqual(stateIn([other, plan]), { state: "record_missing", applyRunId: RUN }, JSON.stringify(other));
    }
  });
});

describe("U-175: EngineResult.plan's kind", () => {
  test("changes for a run plan, absent for a plan of mode apply", () => {
    const runPlan: Pick<EngineResult, "plan"> = { plan: { digest: HASH, actions: 3, kind: "changes" } };
    const applyPlan: Pick<EngineResult, "plan"> = { plan: { digest: HASH, actions: 3 } };
    assert.deepEqual(JSON.parse(JSON.stringify(runPlan)), runPlan);
    assert.deepEqual(Object.keys(applyPlan.plan ?? {}), ["digest", "actions"], "the apply plan's JSON is as before");
    // @ts-expect-error the only kind named is "changes"; a plan of mode apply has none
    const wrong: Pick<EngineResult, "plan"> = { plan: { digest: HASH, actions: 1, kind: "plan" } };
    assert.ok(wrong);
  });
});

describe("U-175: loading and storing either plan", () => {
  const changes: StoredChangesPlan = {
    schemaVersion: 1,
    kind: "changes",
    runId: PLAN,
    summary: maskedParts("rewrite the guide"),
    files: [{ path: "docs/guide.md", change: "modify", sha256: HASH, shown: maskedParts("docs/guide.md") }],
  };
  const moves: StoredPlan = { schemaVersion: 1, kind: "plan", runId: PLAN, actions: [{ kind: "discard", path: "a.txt", sha256: HASH }] };

  test("LoadPlan's outcome is as before: a moves plan only", () => {
    const loaded: LoadPlanOutcome = { ok: true, plan: moves, digest: HASH, applied: null };
    assert.equal(loaded.ok && loaded.plan.kind, "plan");
    // @ts-expect-error LoadPlan never gives a run plan; LoadAnyPlan does
    const refused: LoadPlanOutcome = { ok: true, plan: changes, digest: HASH, applied: null };
    assert.ok(refused);
  });

  test("LoadAnyPlan's outcome holds either, told apart by kind", () => {
    const outcomes: LoadPlanOutcome<AnyStoredPlan>[] = [
      { ok: true, plan: moves, digest: HASH, applied: null },
      { ok: true, plan: changes, digest: HASH, applied: { schemaVersion: 1, kind: "plan_applied", planRunId: PLAN, applyRunId: RUN, at: "2026-11-13T07:01:00.000Z" } },
      { ok: false, code: "invalid_run_record" },
    ];
    const counts = outcomes.map((outcome) => (!outcome.ok ? null : outcome.plan.kind === "changes" ? outcome.plan.files.length : outcome.plan.actions.length));
    assert.deepEqual(counts, [1, 1, null]);
  });

  test("PlanRecorder.saveChangesPlan is optional until the store has it", async () => {
    const without: PlanRecorder = { savePlan: async () => HASH };
    assert.equal(without.saveChangesPlan, undefined);
    const given: { summary: readonly string[]; files: number }[] = [];
    const withIt: PlanRecorder = {
      savePlan: async () => HASH,
      saveChangesPlan: async (stored) => {
        given.push({ summary: stored.summary, files: stored.files.length });
        return HASH;
      },
    };
    assert.equal(await withIt.saveChangesPlan?.({ summary: changes.summary, files: changes.files }), HASH);
    assert.deepEqual(given, [{ summary: ["rewrite the guide"], files: 1 }]);
  });
});

describe("U-175: the plan view of a run plan", () => {
  const file: MaskedPlannedFile = { path: "docs/guide.md" as MaskedText, change: "modify", sha256: HASH };
  const view: ChangesPlanOutput = {
    schemaVersion: 1,
    kind: "plan",
    planKind: "changes",
    runId: PLAN,
    status: "pending",
    exitCode: 0,
    digest: HASH,
    files: [file, { path: "docs/new.md" as MaskedText, change: "create", sha256: null }],
    summary: "rewrite the guide" as MaskedText,
    appliedBy: null,
  };

  test("plain JSON, told apart from the apply plan's view by planKind", () => {
    assert.deepEqual(JSON.parse(JSON.stringify(view)), view);
    const applyView: PlanOutput = { schemaVersion: 1, kind: "plan", runId: PLAN, status: "pending", exitCode: 0, digest: HASH, actions: [], inventoryLimitReached: false, appliedBy: null };
    const views: AnyPlanOutput[] = [applyView, view];
    assert.deepEqual(
      views.map((one) => ("planKind" in one ? `files ${one.files.length}` : `actions ${one.actions.length}`)),
      ["actions 0", "files 2"],
    );
    assert.equal(Object.hasOwn(applyView, "planKind"), false, "the apply plan's JSON has no new key");
  });

  test("a masked create holds no hash, a masked modify holds one", () => {
    // @ts-expect-error a create path holds nothing yet
    const wrong: MaskedPlannedFile = { path: "x" as MaskedText, change: "create", sha256: HASH };
    assert.ok(wrong);
  });
});
