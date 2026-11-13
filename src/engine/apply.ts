/**
 * The apply run (GT-E3, `applyPlan`, contract plan.ts `ApplyDeps`). It carries out a stored plan
 * a person approved. No model takes part: there is no conversation, no repair, and the only
 * actions are the plan's moves and discards, done by the executor in plan order.
 *
 * Order (see ApplyDeps):
 * 1. `apply_started`; the integrity baseline when protected material is configured.
 * 2. Preflight: the inventory, then every action judged by the apply task's `planActions`, the
 *    policy gate (PLAN_ACTION_DESCRIPTORS, before and after, the paths being already effective)
 *    and `executor.check` (U-105: `preflightPlan`, preflight.ts, given out for the app layer's
 *    check). `plan_checked` records it. A problem or the inventory limit ends the apply as
 *    failed/plan_stale with nothing moved.
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
  APPLY_NOTICE_KINDS,
  INVENTORY_VERIFIER_ID,
  JOURNAL_FILE_NAME,
  RUNS_DIR_NAME,
  RUN_EXIT_CODES,
  STATE_DIR_NAME,
  asRawText,
  planActionShownMatches,
} from "../contracts/index.js";
import type {
  AppliedActionRecord,
  AppliedPlanAction,
  ApplyNoticeKind,
  ApplyPlan,
  ApplyResult,
  IntegrityManifest,
  IntegrityPhase,
  InventoryManifest,
  MaskedPlanAction,
  MaskedText,
  PlanItemOutcome,
  PlanRecordsUncheckedCause,
  RawVerifierResult,
  ResolvedPlanAction,
  RunReason,
  StateCheckPhase,
  StateFingerprint,
  TerminalRunStatus,
  VerifierOutcome,
  VerifierResult,
} from "../contracts/index.js";
import { prepareEvidence } from "./feedback.js";
import { preflightPlan } from "./preflight.js";
import { RunState } from "./state.js";

const PLAN_STALE_NOTICE = "the plan cannot be applied to the workspace as it is now; nothing was moved";
const INVENTORY_LIMIT_NOTICE =
  "the workspace has more files than the inventory check can list, so the apply could not be verified; nothing was moved";
const INVENTORY_FAILED_NOTICE = "the workspace inventory could not be taken; nothing was moved";
const ALREADY_APPLIED_NOTICE = "the plan was already applied; nothing was moved";
/** U-1 (R-33 R33-L3): the plan run's records-changed mark, found under the lock (ApplyDeps.planRecordsChanged). */
const PLAN_RECORDS_CHANGED_NOTICE =
  "the plan run's records were changed outside its run, or could not be checked (plan_records_changed): its plan may differ from the one approved, so nothing was moved. Make the plan again";
const UNMASKABLE_NOTICE = "the plan's paths could not be masked for the record; nothing was moved";
const PLAN_SECRETS_DIFFER_NOTICE =
  "the secrets registered now mask the plan's paths differently from the plan run (plan_secrets_differ); nothing was checked or moved. Apply with the same task form as the plan run, or make the plan again";
const APPLY_INCOMPLETE_NOTICE = "an action failed; the actions done before it stay, and codaryn revert can undo them";
const INTERRUPTED_NOTICE = "the apply stopped between actions; the actions done stay, and codaryn revert can undo them";
const INTEGRITY_NOTICE = "protected material changed or could not be checked during the apply; the result is not trusted";
const VERIFIER_NOT_RUN_EVIDENCE = "the verifier could not be run";
const VERIFIER_NOT_RUN_CHECKED = "nothing: the verifier did not complete";
const UNMASKABLE_EVIDENCE = "the verifier's result could not be masked, so it is not shown";
const CONSENT_REQUIRED_NOTICE =
  "some moves could replace a file that appears meanwhile, because this drive has no hard links; nothing was moved. A person can consent for one apply to move them anyway";
const CONSENT_OTHER_PLAN_NOTICE = "the consent to unsafe moves was given for another plan and was not used";
const UNSAFE_DONE_NOTICE = "some moves were made without the guarantee against replacing a file, with the person's consent";
/** DR-38: a change to the run records found during the apply (paths follow), or a check not made. */
const STATE_NOTICE_LEAD = "Codaryn's run records changed outside the apply, so they are not trusted: ";
const STATE_FAILED_NOTICE = "the run records could not be checked, so they are not trusted";
/** U-16 (UXM-15): the plan run ran with another task (ApplyNoticeKind plan_task_differs). */
const PLAN_TASK_DIFFERS_NOTICE =
  "the plan was made by another task than the one given to this apply (plan_task_differs): that task's verifiers and rules are not the ones used here";
/** U-8 (R-39 L-1): a state check was limited (ApplyNoticeKind plan_records_unchecked). */
const PLAN_RECORDS_UNCHECKED_NOTICE =
  "the plan run's records could not be checked for changes, because the state directory is too large to check entirely (plan_records_unchecked); a cleanup that makes it smaller lets them be checked";
/**
 * U-29 (R-44 R44-L1): a run before this apply could not check them (ApplyDeps.planRecordsUnchecked).
 * U-33: told only when every check of this apply was complete (cause "run_since_plan").
 */
const PLAN_RECORDS_UNCHECKED_EARLIER_NOTICE =
  "a run since the plan was made could not check the state directory entirely, so the plan run's records may have changed without a mark (plan_records_unchecked)";

/** Every fixed text the apply run records. Tests mask these with the real gateway. */
export const APPLY_FIXED_TEXTS: readonly string[] = [
  PLAN_STALE_NOTICE,
  INVENTORY_LIMIT_NOTICE,
  INVENTORY_FAILED_NOTICE,
  ALREADY_APPLIED_NOTICE,
  PLAN_RECORDS_CHANGED_NOTICE,
  UNMASKABLE_NOTICE,
  PLAN_SECRETS_DIFFER_NOTICE,
  APPLY_INCOMPLETE_NOTICE,
  INTERRUPTED_NOTICE,
  INTEGRITY_NOTICE,
  VERIFIER_NOT_RUN_EVIDENCE,
  VERIFIER_NOT_RUN_CHECKED,
  UNMASKABLE_EVIDENCE,
  CONSENT_REQUIRED_NOTICE,
  CONSENT_OTHER_PLAN_NOTICE,
  UNSAFE_DONE_NOTICE,
  STATE_NOTICE_LEAD,
  STATE_FAILED_NOTICE,
  PLAN_RECORDS_UNCHECKED_EARLIER_NOTICE,
  PLAN_RECORDS_UNCHECKED_NOTICE,
  PLAN_TASK_DIFFERS_NOTICE,
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
/** DR-38: the records changed other than by the apply, or could not be checked. */
const STATE_CHANGED: End = { status: "failed", reason: "state_changed" };
const CONSENT_REQUIRED: End = { status: "needs-input", reason: "consent_required" };

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
  // DR-21: a consent counts only for this plan's digest. It comes from the caller (a person's
  // input); nothing in the plan or the task can give it.
  const consent = deps.unsafeMoveConsent ?? null;
  const consented = consent !== null && consent.digest === digest;
  const startedAt = clock.now();
  const state = new RunState();
  const notices: MaskedText[] = [];
  const applied: AppliedActionRecord[] = [];
  const appliedRaw: AppliedPlanAction[] = [];
  const verifierResults: VerifierResult[] = [];
  let protectedChanged: readonly MaskedText[] | undefined;
  // DR-38 (ApplyDeps.stateGuard): tier state's base from the start, tier run's last fingerprint
  // (taken afresh after the actions), the last recorded list.
  const stateGuard = deps.stateGuard;
  let stateBase: StateFingerprint | null = null;
  let lastRunPrint: StateFingerprint | null = null;
  let stateChanged: readonly MaskedText[] | undefined;
  // U-8: a limited state check at any phase; told once (notice and ApplyResult.noticeKinds).
  let planUnchecked = false;
  // U-29, U-33: a run since the plan could not check (ApplyDeps.planRecordsUnchecked); told at the
  // end, and only when no check of this apply was limited.
  let sincePlanUnchecked = false;
  // U-16: the plan run ran with another task than this apply's.
  let taskDiffers = false;
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

  /**
   * DR-38: one check of the state directory. `run`: "skip" (run_start), "fresh" (before_verify: a new
   * base after the actions, compared with itself) or "chain" (against the last fingerprint). Tier
   * state against the start's base. Recorded at run_start and run_end always, otherwise only on a
   * change or when tier state is limited. A change, or a capture that cannot be made, marks the runs
   * and ends the apply as failed/state_changed.
   */
  const checkState = async (phase: StateCheckPhase, run: "skip" | "fresh" | "chain"): Promise<End | null> => {
    if (stateGuard === undefined) return null;
    const changedRaw: string[] = [];
    let limited = false;
    try {
      if (run !== "skip") {
        const nowRun = await stateGuard.capture("run");
        changedRaw.push(...stateGuard.compare(run === "chain" && lastRunPrint !== null ? lastRunPrint : nowRun, nowRun).changed);
        lastRunPrint = nowRun;
      }
      const nowState = await stateGuard.capture("state");
      if (stateBase === null) stateBase = nowState;
      const comparison = stateGuard.compare(stateBase, nowState);
      changedRaw.push(...comparison.changed);
      limited = comparison.limited;
    } catch {
      notice(STATE_FAILED_NOTICE);
      return STATE_CHANGED;
    }
    if (limited && !planUnchecked) {
      planUnchecked = true;
      notice(PLAN_RECORDS_UNCHECKED_NOTICE);
    }
    const sorted = [...new Set(changedRaw)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const changed: MaskedText[] = [];
    for (const path of sorted) {
      const masked = mask(path);
      if (masked === null) {
        notice(UNMASKABLE_NOTICE);
        return STATE_CHANGED;
      }
      changed.push(masked);
    }
    if (phase === "run_start" || phase === "run_end" || changed.length > 0 || limited) {
      await journal.append({ type: "state_checked", phase, changed, limited });
      stateChanged = changed;
    }
    if (changed.length === 0) return null;
    try {
      await stateGuard.markRecordsChanged(changed);
    } catch {
      // The apply still ends as state_changed; the record above names the paths.
    }
    notice(`${STATE_NOTICE_LEAD}${sorted.join(", ")}`);
    return STATE_CHANGED;
  };

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
      unsafeMoveConsent: consented ? consent.channel : null,
    });
    state.transition("running");
    // U-1 (R-33 R33-L3): the caller refused a marked plan run; a mark written since then is found
    // here, under the lock, before anything else. A check that cannot be made counts as a mark.
    if (deps.planRecordsChanged !== undefined) {
      let marked: boolean;
      try {
        marked = await deps.planRecordsChanged();
      } catch {
        marked = true;
      }
      if (marked) {
        notice(PLAN_RECORDS_CHANGED_NOTICE);
        return PLAN_STALE;
      }
    }
    // U-16 (UXM-15): told, not refused.
    if (deps.planTaskId !== undefined && deps.planTaskId !== taskId) {
      taskDiffers = true;
      notice(PLAN_TASK_DIFFERS_NOTICE);
    }
    if (consent !== null && !consented) notice(CONSENT_OTHER_PLAN_NOTICE);
    // U-29 (R-44 R44-L1): whether a run before this apply could not check; asked here, under the
    // lock and before anything is moved. A question that cannot be answered counts as unchecked.
    // U-33 (R-56 R56-L2): the answer is told at the end, once the apply's own checks are known.
    if (deps.planRecordsUnchecked !== undefined) {
      try {
        sincePlanUnchecked = await deps.planRecordsUnchecked();
      } catch {
        sincePlanUnchecked = true;
      }
    }
    if ((await inspect("run_start")) === "changed") return PROTECTED_CHANGED;
    const stateStart = await checkState("run_start", "skip");
    if (stateStart !== null) return stateStart;

    // 2. Preflight: nothing is moved unless every action can be applied.
    const early = interrupted();
    if (early !== null) return early;
    // DR-28 (R-11 M-1): every path must be masked now as the plan run masked it, or a value the
    // plan run hid would be checked, recorded and shown in plain text. The caller compared already
    // (plan_secrets_differ); this is the second defence, before anything else is done. The masked
    // actions are the ones recorded later, so every action is recordable before the first is done.
    const masked: MaskedPlanAction[] = [];
    for (const action of plan.actions) {
      const one = maskAction(action);
      if (one === null) {
        notice(UNMASKABLE_NOTICE);
        return PLAN_STALE;
      }
      if (!planActionShownMatches(action, one)) {
        notice(PLAN_SECRETS_DIFFER_NOTICE);
        return PLAN_STALE;
      }
      masked.push(one);
    }
    let before: InventoryManifest;
    try {
      before = await inventory.capture();
    } catch {
      // R18-M1: a listing given the cancel signal stops with an AbortError. A cancel (or the
      // duration limit) is not a failed listing: nothing was claimed, so the plan can be applied again.
      const stop = interrupted();
      if (stop !== null) return stop;
      notice(INVENTORY_FAILED_NOTICE);
      return PLAN_STALE;
    }
    // U-105: the judgement of each action is preflightPlan's (the one the app layer's check calls).
    // A cancel or the duration limit is looked at before each action, as before.
    const halt: { end: End | null } = { end: null };
    const preflight = await preflightPlan({
      actions: plan.actions,
      planActions,
      policy,
      executor,
      stop: () => (halt.end = interrupted()) !== null,
    });
    if (preflight.stopped) return halt.end ?? CANCELLED;
    const { problems, unsafeMoves } = preflight;
    await journal.append({ type: "plan_checked", problems, inventoryLimitReached: before.limitReached, unsafeMoves });
    if (problems.length > 0) {
      notice(PLAN_STALE_NOTICE);
      return PLAN_STALE;
    }
    if (before.limitReached) {
      notice(INVENTORY_LIMIT_NOTICE);
      return PLAN_STALE;
    }
    // DR-21: blocked by default; only a person's consent for this plan lets the unsafe moves run.
    if (unsafeMoves.length > 0 && !consented) {
      notice(CONSENT_REQUIRED_NOTICE);
      return CONSENT_REQUIRED;
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
      // Only the moves the preflight reported, and only with consent, may be made unsafely.
      const allowUnsafeMove = consented && unsafeMoves.includes(index);
      // R-9 I-4: name the action before it is done, so a stop right after it still leaves a record.
      await journal.append({ type: "plan_item_started", index, action: masked[index] as MaskedPlanAction });
      try {
        outcome = await executor.apply(action, index, runSignal, { allowUnsafeMove });
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
      const unsafe = outcome.applied.unsafe === true ? ({ unsafe: true } as const) : {};
      if (shown.kind === "move") {
        await journal.append({ type: "file_moved", index, from: shown.from, to: shown.to, sha256: shown.sha256, ...unsafe });
      } else {
        await journal.append({ type: "file_discarded", index, path: shown.path, stored: stored ?? "", sha256: shown.sha256, ...unsafe });
      }
      if (outcome.applied.unsafe === true && !applied.some((record) => record.unsafe === true)) notice(UNSAFE_DONE_NOTICE);
      applied.push({ index, action: shown, stored, ...unsafe });
      appliedRaw.push(outcome.applied);
    }

    // 5. Verification: the inventory first, then the task's verifiers. No repair.
    state.transition("verifying");
    const stopped = interrupted();
    if (stopped !== null) return stopped;
    if ((await inspect("before_verify")) === "changed") return PROTECTED_CHANGED;
    const stateBefore = await checkState("before_verify", "fresh");
    if (stateBefore !== null) return stateBefore;
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
    const stateAfter = await checkState("after_verify", "chain");
    if (stateAfter !== null) return stateAfter;
    if (outcomes.includes("fail")) return { status: "failed", reason: "verifier_failed" };
    if (outcomes.includes("inconclusive")) return { status: "needs-input", reason: "verifier_inconclusive" };
    return { status: "done", reason: "verified" };
  };

  try {
    const ended = await run();
    // DR-38: the run records at the end; a change replaces the end.
    const end = stateGuard === undefined || ended.reason === "state_changed" ? ended : ((await checkState("run_end", "chain")) ?? ended);
    // W-1 for apply runs: actions or verifiers that no check followed are checked once more. The
    // end keeps its status (done always follows an after_verify check).
    if (sinceCheck && baseline !== null && end.status !== "done") {
      await inspect("before_verify");
    }
    // U-33 (R-56 Q-1 (a)): the apply's own limited check comes first; it was told with U-8's notice,
    // and the result is U-8's. Only when every own check was complete is a run since the plan told.
    const cause: PlanRecordsUncheckedCause | null = sincePlanUnchecked && !planUnchecked ? "run_since_plan" : null;
    if (cause !== null) notice(PLAN_RECORDS_UNCHECKED_EARLIER_NOTICE);
    if (state.status === "created" && end.status !== "cancelled") state.transition("running");
    if (state.status !== end.status) state.transition(end.status);
    const durationMs = clock.now() - startedAt;
    const usage = { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs, repairAttempts: 0 };
    await journal.append({ type: "run_finished", status: end.status, reason: end.reason, usage });
    const told: { readonly [K in ApplyNoticeKind]: boolean } = { plan_records_unchecked: planUnchecked || cause !== null, plan_task_differs: taskDiffers };
    const noticeKinds = APPLY_NOTICE_KINDS.filter((kind) => told[kind]);
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
      ...(stateChanged !== undefined ? { stateChanged } : {}),
      ...(noticeKinds.length > 0 ? { noticeKinds } : {}),
      ...(cause !== null ? { planRecordsUncheckedCause: cause } : {}),
    };
    return result;
  } finally {
    clearTimeout(timer);
    await journal.close();
  }
};
