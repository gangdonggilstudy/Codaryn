/**
 * The apply run (GT-E3, `applyPlan`, contract plan.ts `ApplyDeps`). It carries out a stored plan
 * a person approved. No model takes part: there is no conversation, no repair, and the only
 * actions are the plan's moves and discards, done by the executor in plan order.
 *
 * Order (see ApplyDeps):
 * 1. `apply_started`; the integrity baseline when protected material is configured.
 * 2. Preflight: the inventory, then every action judged by the apply task's `planActions`, the
 *    policy gate (PLAN_ACTION_DESCRIPTORS, before and after, the paths being already effective)
 *    and `executor.check`. `plan_checked` records it. A problem or the inventory limit ends the
 *    apply as failed/plan_stale with nothing moved.
 * 3. `markApplied`; a plan applied before ends the apply as failed/plan_stale, nothing moved.
 * 4. Each action in order. The signal and the duration limit are looked at before each action and
 *    after a failed one, so a cancel ends the apply as cancelled even when the executor reports
 *    io_error for it. Done actions stay and are listed; `codaryn revert` undoes them.
 * 5. The inventory check first, then the task's verifiers; integrity checks around them.
 * 6. `run_finished` and the ApplyResult.
 *
 * Every text bound for the journal or the result is masked first. An action whose paths cannot be
 * masked is not applied (nothing is moved that could not be recorded).
 */

import {
  INVENTORY_VERIFIER_ID,
  JOURNAL_FILE_NAME,
  PLAN_ACTION_DESCRIPTORS,
  RUNS_DIR_NAME,
  RUN_EXIT_CODES,
  STATE_DIR_NAME,
  asRawText,
} from "../contracts/index.js";
import type {
  AppliedActionRecord,
  AppliedPlanAction,
  ApplyPlan,
  ApplyResult,
  IntegrityManifest,
  IntegrityPhase,
  InventoryManifest,
  JsonObject,
  MaskedPlanAction,
  MaskedText,
  PlanItemOutcome,
  PlanItemProblem,
  RawVerifierResult,
  ResolvedPlanAction,
  RunReason,
  TerminalRunStatus,
  VerifierOutcome,
  VerifierResult,
} from "../contracts/index.js";
import { prepareEvidence } from "./feedback.js";
import { RunState } from "./state.js";

const PLAN_STALE_NOTICE = "the plan cannot be applied to the workspace as it is now; nothing was moved";
const INVENTORY_LIMIT_NOTICE =
  "the workspace has more files than the inventory check can list, so the apply could not be verified; nothing was moved";
const INVENTORY_FAILED_NOTICE = "the workspace inventory could not be taken; nothing was moved";
const ALREADY_APPLIED_NOTICE = "the plan was already applied; nothing was moved";
const UNMASKABLE_NOTICE = "the plan's paths could not be masked for the record; nothing was moved";
const APPLY_INCOMPLETE_NOTICE = "an action failed; the actions done before it stay, and codaryn revert can undo them";
const INTERRUPTED_NOTICE = "the apply stopped between actions; the actions done stay, and codaryn revert can undo them";
const INTEGRITY_NOTICE = "protected material changed or could not be checked during the apply; the result is not trusted";
const VERIFIER_NOT_RUN_EVIDENCE = "the verifier could not be run";
const VERIFIER_NOT_RUN_CHECKED = "nothing: the verifier did not complete";
const UNMASKABLE_EVIDENCE = "the verifier's result could not be masked, so it is not shown";

/** Every fixed text the apply run records. Tests mask these with the real gateway. */
export const APPLY_FIXED_TEXTS: readonly string[] = [
  PLAN_STALE_NOTICE,
  INVENTORY_LIMIT_NOTICE,
  INVENTORY_FAILED_NOTICE,
  ALREADY_APPLIED_NOTICE,
  UNMASKABLE_NOTICE,
  APPLY_INCOMPLETE_NOTICE,
  INTERRUPTED_NOTICE,
  INTEGRITY_NOTICE,
  VERIFIER_NOT_RUN_EVIDENCE,
  VERIFIER_NOT_RUN_CHECKED,
  UNMASKABLE_EVIDENCE,
];

const MAX_TIMER_MS = 2_147_483_647;

interface End {
  readonly status: TerminalRunStatus;
  readonly reason: RunReason;
}

const PLAN_STALE: End = { status: "failed", reason: "plan_stale" };
const APPLY_INCOMPLETE: End = { status: "failed", reason: "apply_incomplete" };
const CANCELLED: End = { status: "cancelled", reason: "cancelled" };
const MAX_DURATION: End = { status: "budget-exhausted", reason: "max_duration" };
const PROTECTED_CHANGED: End = { status: "needs-input", reason: "protected_changed" };

function pathArgs(action: ResolvedPlanAction): JsonObject {
  return action.kind === "move" ? { from: action.from, to: action.to } : { path: action.path };
}

export const applyPlan: ApplyPlan = async (deps) => {
  const {
    plan,
    planRunId,
    digest,
    approval,
    runId,
    taskId,
    maxDurationMs,
    verifierConfigs,
    executor,
    policy,
    planActions,
    discardedRoot,
    privacy,
    verifiers,
    inventory,
    journal,
    clock,
    signal,
    integrity,
  } = deps;
  const startedAt = clock.now();
  const state = new RunState();
  const notices: MaskedText[] = [];
  const applied: AppliedActionRecord[] = [];
  const appliedRaw: AppliedPlanAction[] = [];
  const verifierResults: VerifierResult[] = [];
  let protectedChanged: readonly MaskedText[] | undefined;
  let baseline: IntegrityManifest | null = null;
  /** Whether actions or verifiers ran since the last integrity check (W-1 for apply runs). */
  let sinceCheck = false;

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), Math.min(maxDurationMs, MAX_TIMER_MS));
  timer.unref();
  const runSignal = AbortSignal.any([signal, deadline.signal]);

  const mask = (text: string): MaskedText | null => {
    try {
      const outcome = privacy.mask(text);
      return outcome.ok ? outcome.text : null;
    } catch {
      return null;
    }
  };
  const notice = (text: string): void => {
    const masked = mask(text);
    if (masked !== null) notices.push(masked);
  };
  const interrupted = (): End | null => {
    if (signal.aborted) return CANCELLED;
    if (deadline.signal.aborted || clock.now() - startedAt >= maxDurationMs) return MAX_DURATION;
    return null;
  };

  const maskAction = (action: ResolvedPlanAction): MaskedPlanAction | null => {
    if (action.kind === "move") {
      const from = mask(action.from);
      const to = mask(action.to);
      return from === null || to === null ? null : { kind: "move", from, to, sha256: action.sha256 };
    }
    const path = mask(action.path);
    return path === null ? null : { kind: "discard", path, sha256: action.sha256 };
  };

  /** The apply task's planActions and the policy gate, before and after (the paths are effective). */
  const permitted = async (action: ResolvedPlanAction, index: number): Promise<boolean> => {
    if (!planActions.includes(action.kind)) return false;
    const descriptor = PLAN_ACTION_DESCRIPTORS[action.kind];
    const call = { id: `action-${index}`, name: descriptor.name, args: pathArgs(action) };
    try {
      if (!policy.checkRequested(call, descriptor).allowed) return false;
      return (await policy.checkEffective(call, descriptor)).allowed;
    } catch {
      return false;
    }
  };

  /** One integrity check against the baseline. "changed" also when it cannot be completed. */
  const inspect = async (phase: IntegrityPhase): Promise<"unchanged" | "changed"> => {
    if (integrity === undefined) return "unchanged";
    sinceCheck = false;
    let changedRaw: readonly string[];
    try {
      const current = await integrity.capture();
      if (baseline === null) baseline = current;
      changedRaw = integrity.compare(baseline, current);
    } catch {
      notice(INTEGRITY_NOTICE);
      return "changed";
    }
    const changed: MaskedText[] = [];
    for (const path of changedRaw) {
      const masked = mask(path);
      if (masked === null) {
        notice(INTEGRITY_NOTICE);
        return "changed";
      }
      changed.push(masked);
    }
    await journal.append({ type: "integrity_checked", phase, changed });
    protectedChanged = changed;
    if (changed.length === 0) return "unchanged";
    notice(INTEGRITY_NOTICE);
    return "changed";
  };

  /** Masks a verifier's raw result for the record and the result; unmaskable becomes inconclusive. */
  const recordVerifier = async (raw: RawVerifierResult): Promise<VerifierOutcome> => {
    const evidence = mask(raw.evidence);
    const checked = raw.checked.map(mask);
    const limits = raw.limits.map(mask);
    let result: VerifierResult;
    if (evidence === null || checked.includes(null) || limits.includes(null)) {
      const fallback = [mask(UNMASKABLE_EVIDENCE), mask(VERIFIER_NOT_RUN_CHECKED)];
      result = {
        id: raw.id,
        kind: raw.kind,
        outcome: "inconclusive",
        evidence: (fallback[0] ?? "") as MaskedText,
        checked: [(fallback[1] ?? "") as MaskedText],
        limits: [],
      };
    } else {
      const prepared = prepareEvidence(evidence, raw.evidenceTruncated === true);
      result = {
        id: raw.id,
        kind: raw.kind,
        outcome: raw.outcome,
        evidence: prepared.text as MaskedText,
        checked: checked as MaskedText[],
        limits: limits as MaskedText[],
      };
    }
    verifierResults.push(result);
    await journal.append({ type: "verifier_result", result });
    return result.outcome;
  };

  const notRun = (id: string, kind: RawVerifierResult["kind"]): RawVerifierResult => ({
    id,
    kind,
    outcome: "inconclusive",
    evidence: asRawText(VERIFIER_NOT_RUN_EVIDENCE),
    checked: [VERIFIER_NOT_RUN_CHECKED],
    limits: [],
  });

  const run = async (): Promise<End> => {
    await journal.append({
      type: "apply_started",
      schemaVersion: 1,
      planRunId,
      taskId,
      digest,
      approval,
      actions: plan.actions.length,
      maxDurationMs,
    });
    state.transition("running");
    if ((await inspect("run_start")) === "changed") return PROTECTED_CHANGED;

    // 2. Preflight: nothing is moved unless every action can be applied.
    const early = interrupted();
    if (early !== null) return early;
    let before: InventoryManifest;
    try {
      before = await inventory.capture();
    } catch {
      notice(INVENTORY_FAILED_NOTICE);
      return PLAN_STALE;
    }
    const problems: { index: number; problem: PlanItemProblem }[] = [];
    for (const [index, action] of plan.actions.entries()) {
      const stop = interrupted();
      if (stop !== null) return stop;
      if (!(await permitted(action, index))) {
        problems.push({ index, problem: "denied" });
        continue;
      }
      let problem: PlanItemProblem | null;
      try {
        problem = await executor.check(action);
      } catch {
        problem = "io_error";
      }
      if (problem !== null) problems.push({ index, problem });
    }
    await journal.append({ type: "plan_checked", problems, inventoryLimitReached: before.limitReached });
    if (problems.length > 0) {
      notice(PLAN_STALE_NOTICE);
      return PLAN_STALE;
    }
    if (before.limitReached) {
      notice(INVENTORY_LIMIT_NOTICE);
      return PLAN_STALE;
    }
    // Every action must be recordable before the first one is done.
    const masked: MaskedPlanAction[] = [];
    for (const action of plan.actions) {
      const one = maskAction(action);
      if (one === null) {
        notice(UNMASKABLE_NOTICE);
        return PLAN_STALE;
      }
      masked.push(one);
    }

    // 3. Claim the plan.
    if ((await deps.markApplied()) === "already_applied") {
      notice(ALREADY_APPLIED_NOTICE);
      return PLAN_STALE;
    }

    // 4. The actions, in plan order.
    for (const [index, action] of plan.actions.entries()) {
      const stop = interrupted();
      if (stop !== null) {
        notice(INTERRUPTED_NOTICE);
        return stop;
      }
      sinceCheck = true;
      let outcome: PlanItemOutcome;
      try {
        outcome = await executor.apply(action, index, runSignal);
      } catch {
        outcome = { ok: false, problem: "io_error" };
      }
      if (!outcome.ok) {
        await journal.append({ type: "plan_item_failed", index, problem: outcome.problem });
        // The executor may report a cancel as io_error: the signal decides how the apply ends.
        const late = interrupted();
        if (late !== null) {
          notice(INTERRUPTED_NOTICE);
          return late;
        }
        notice(APPLY_INCOMPLETE_NOTICE);
        return APPLY_INCOMPLETE;
      }
      const shown = masked[index] as MaskedPlanAction;
      const stored = outcome.applied.stored;
      if (shown.kind === "move") {
        await journal.append({ type: "file_moved", index, from: shown.from, to: shown.to, sha256: shown.sha256 });
      } else {
        await journal.append({ type: "file_discarded", index, path: shown.path, stored: stored ?? "", sha256: shown.sha256 });
      }
      applied.push({ index, action: shown, stored });
      appliedRaw.push(outcome.applied);
    }

    // 5. Verification: the inventory first, then the task's verifiers. No repair.
    state.transition("verifying");
    const stopped = interrupted();
    if (stopped !== null) return stopped;
    if ((await inspect("before_verify")) === "changed") return PROTECTED_CHANGED;
    const outcomes: VerifierOutcome[] = [];
    sinceCheck = true;
    let inventoryRaw: RawVerifierResult;
    try {
      const after = await inventory.capture();
      inventoryRaw = await inventory.check({ before, after, applied: appliedRaw, discardedRoot });
    } catch {
      inventoryRaw = notRun(INVENTORY_VERIFIER_ID, "inventory");
    }
    outcomes.push(await recordVerifier(inventoryRaw));
    for (const config of verifierConfigs) {
      const stop = interrupted();
      if (stop !== null) return stop;
      let raw: RawVerifierResult;
      try {
        raw = await verifiers.run(config, runSignal);
      } catch {
        raw = notRun(config.id, config.kind);
      }
      outcomes.push(await recordVerifier(raw));
    }
    const late = interrupted();
    if (late !== null) return late;
    if ((await inspect("after_verify")) === "changed") return PROTECTED_CHANGED;
    if (outcomes.includes("fail")) return { status: "failed", reason: "verifier_failed" };
    if (outcomes.includes("inconclusive")) return { status: "needs-input", reason: "verifier_inconclusive" };
    return { status: "done", reason: "verified" };
  };

  try {
    const end = await run();
    // W-1 for apply runs: actions or verifiers that no check followed are checked once more. The
    // end keeps its status (done always follows an after_verify check).
    if (sinceCheck && baseline !== null && end.status !== "done") {
      await inspect("before_verify");
    }
    if (state.status === "created" && end.status !== "cancelled") state.transition("running");
    if (state.status !== end.status) state.transition(end.status);
    const durationMs = clock.now() - startedAt;
    const usage = { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs, repairAttempts: 0 };
    await journal.append({ type: "run_finished", status: end.status, reason: end.reason, usage });
    const result: ApplyResult = {
      schemaVersion: 1,
      kind: "apply",
      runId,
      planRunId,
      taskId,
      digest,
      status: end.status,
      reason: end.reason,
      exitCode: RUN_EXIT_CODES[end.status],
      applied,
      verifiers: verifierResults,
      usage,
      journalPath: `${STATE_DIR_NAME}/${RUNS_DIR_NAME}/${runId}/${JOURNAL_FILE_NAME}`,
      notices,
      ...(protectedChanged !== undefined ? { protectedChanged } : {}),
    };
    return result;
  } finally {
    clearTimeout(timer);
    await journal.close();
  }
};
