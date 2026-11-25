/** Per-run integrity and state checks, with private baselines and late result getters. */
import type { EngineDeps, IntegrityManifest, IntegrityPhase, MaskedText, RawText, StateCheckPhase, StateFingerprint } from "../contracts/index.js";
import { INTEGRITY_NOTICE_LEADS, INTEGRITY_MORE_PATHS, INTEGRITY_FAILED_NOTICE, INTEGRITY_END_LEAD, INTEGRITY_END_UNMASKABLE, INTEGRITY_END_LABEL, STATE_NOTICE_LEAD, STATE_FAILED_NOTICE } from "./model-texts.js";
import { INTEGRITY_NOTICE_PATHS, MASKING_FAILED, PROTECTED_CHANGED, STATE_CHANGED, codeUnitOrder } from "./pure.js";
import type { End } from "./pure.js";
import type { createRunHelpers } from "./run-helpers.js";

export function createRunChecks(
  integrity: EngineDeps["integrity"],
  stateGuard: EngineDeps["stateGuard"],
  mask: ReturnType<typeof createRunHelpers>["mask"],
  record: ReturnType<typeof createRunHelpers>["record"],
  interrupted: ReturnType<typeof createRunHelpers>["interrupted"],
  notices: MaskedText[],
) {
  /** The run_start manifest (U-1). Every later check compares with it. Local only, never recorded. */
  let baseline: IntegrityManifest | null = null;
  /** `changed` of the latest recorded `integrity_checked`; undefined while none was recorded. */
  let protectedChanged: readonly MaskedText[] | undefined;
  // DR-38: the state guard, the last tier-run fingerprint (each window chains from it) and the
  // tier-state base of the run's start; the last recorded list goes into the result.
  let lastRunPrint: StateFingerprint | null = null;
  let stateBase: StateFingerprint | null = null;
  let stateChanged: readonly MaskedText[] | undefined;
  /**
   * W-1: what ran since the last integrity check was made: nothing, a model turn (with its tool
   * calls), or verifiers. Anything but "nothing" at the end of the run calls for one more check.
   */
  let sinceCheck: "nothing" | "model" | "verifiers" = "nothing";

  /**
   * One integrity check (U-1, U-2): capture, compare with the run_start baseline, record the
   * masked list and add a notice when it is not empty. Paths are masked one by one for the record
   * and the result; the notice is built from the raw paths and masked as a whole.
   * - "failed": the capture rejected (not a file-level problem; those are `unchecked` entries).
   *   There is no list of paths, so nothing is recorded; a notice says the check was not completed.
   * - "unmaskable": a changed path could not be masked. Nothing about it is recorded.
   */
  const inspect = async (
    integrityChecker: NonNullable<EngineDeps["integrity"]>,
    phase: IntegrityPhase,
    lead: string,
    label: string,
  ): Promise<"unchanged" | "changed" | "failed" | "unmaskable"> => {
    sinceCheck = "nothing";
    let changedRaw: readonly RawText[];
    try {
      const current = await integrityChecker.capture();
      if (phase === "run_start" && baseline === null) baseline = current;
      if (baseline === null) throw new Error("no run_start baseline");
      changedRaw = integrityChecker.compare(baseline, current);
    } catch {
      const notice = mask(`${INTEGRITY_FAILED_NOTICE[0]}${label}${INTEGRITY_FAILED_NOTICE[1]}`);
      if (notice !== null) notices.push(notice);
      return "failed";
    }
    const changed: MaskedText[] = [];
    for (const path of changedRaw) {
      const masked = mask(path);
      if (masked === null) return "unmaskable";
      changed.push(masked);
    }
    await record({ type: "integrity_checked", phase, changed });
    protectedChanged = changed;
    if (changed.length === 0) return "unchanged";
    const shown = changedRaw.slice(0, INTEGRITY_NOTICE_PATHS).join(", ");
    const hidden = changedRaw.length - INTEGRITY_NOTICE_PATHS;
    const more = hidden > 0 ? `${INTEGRITY_MORE_PATHS[0]}${hidden}${INTEGRITY_MORE_PATHS[1]}` : "";
    const notice = mask(`${lead}${shown}${more}`);
    if (notice !== null) notices.push(notice);
    return "changed";
  };

  /**
   * A check at run start or around a verification round: a change, or material that cannot be
   * shown unchanged, ends the run as needs-input/protected_changed (fails closed).
   */
  const checkIntegrity = async (phase: IntegrityPhase): Promise<End | null> => {
    if (integrity === undefined) return null;
    const outcome = await inspect(integrity, phase, INTEGRITY_NOTICE_LEADS[phase], phase);
    if (outcome === "unchanged") return null;
    return outcome === "unmaskable" ? MASKING_FAILED : PROTECTED_CHANGED;
  };

  /**
   * W-1: one more check when the run ends after a model turn or verifiers that no check has
   * followed (limits, cancel, model error, unknown tool outcome, no verifier, a round cut short).
   * The end keeps its status and reason; the change goes into the record, `protectedChanged` and a
   * notice. Only `done` would be overturned, and done always follows an after_verify check, so
   * nothing has run since. The contract has no run_end phase: the check is recorded as
   * after_verify when verifiers ran since the last check, otherwise as before_verify.
   */
  const checkAtEnd = async (end: End): Promise<End> => {
    if (integrity === undefined || baseline === null || sinceCheck === "nothing") return end;
    const phase: IntegrityPhase = sinceCheck === "verifiers" ? "after_verify" : "before_verify";
    const outcome = await inspect(integrity, phase, INTEGRITY_END_LEAD, INTEGRITY_END_LABEL);
    if (outcome === "unchanged") return end;
    if (outcome === "unmaskable") {
      const notice = mask(INTEGRITY_END_UNMASKABLE);
      if (notice !== null) notices.push(notice);
    }
    return end.status === "done" ? PROTECTED_CHANGED : end;
  };

  /**
   * DR-38: one check of the state directory (EngineDeps.stateGuard). Tier "run" is compared with the
   * last tier-run fingerprint, so a change between two windows is found too (the guard discounts
   * the run's own writes); tier "state", when `both`, with the run's start. Recorded at run_start and
   * run_end always, otherwise only when something changed or tier "state" was limited. A change, or
   * a capture that cannot be made (fail closed), marks the runs and ends the run as
   * failed/state_changed; a changed path that cannot be masked ends it as masking_failed.
   */
  const checkState = async (phase: StateCheckPhase, both: boolean, callId?: string): Promise<End | null> => {
    if (stateGuard === undefined) return null;
    let changedRaw: RawText[];
    let limited = false;
    try {
      const nowRun = await stateGuard.capture("run");
      changedRaw = [...stateGuard.compare(lastRunPrint ?? nowRun, nowRun).changed];
      lastRunPrint = nowRun;
      if (both) {
        const nowState = await stateGuard.capture("state");
        if (stateBase === null) stateBase = nowState;
        const comparison = stateGuard.compare(stateBase, nowState);
        changedRaw.push(...comparison.changed);
        limited = comparison.limited;
      }
    } catch {
      const notice = mask(STATE_FAILED_NOTICE);
      if (notice !== null) notices.push(notice);
      return STATE_CHANGED;
    }
    const sorted = [...new Set(changedRaw)].sort(codeUnitOrder);
    const changed: MaskedText[] = [];
    for (const path of sorted) {
      const masked = mask(path);
      if (masked === null) return MASKING_FAILED;
      changed.push(masked);
    }
    if (phase === "run_start" || phase === "run_end" || changed.length > 0 || limited) {
      await record({ type: "state_checked", phase, ...(callId === undefined ? {} : { callId }), changed, limited });
      stateChanged = changed;
    }
    if (changed.length === 0) return null;
    try {
      await stateGuard.markRecordsChanged(changed);
    } catch {
      // The run still ends as state_changed; the record above names the paths.
    }
    const hidden = sorted.length - INTEGRITY_NOTICE_PATHS;
    const more = hidden > 0 ? `${INTEGRITY_MORE_PATHS[0]}${hidden}${INTEGRITY_MORE_PATHS[1]}` : "";
    const notice = mask(`${STATE_NOTICE_LEAD}${sorted.slice(0, INTEGRITY_NOTICE_PATHS).join(", ")}${more}`);
    if (notice !== null) notices.push(notice);
    return STATE_CHANGED;
  };

  /** DR-38: the run_end check; a change replaces the end the run would have had. */
  const checkStateAtEnd = async (end: End): Promise<End> => {
    if (stateGuard === undefined || end.reason === "state_changed") return end;
    return (await checkState("run_end", true)) ?? end;
  };

  /** A check point: an interruption already in effect comes first and skips the check. */
  const checkPoint = async (phase: IntegrityPhase): Promise<End | null> => {
    if (integrity === undefined) return null;
    const stop = interrupted();
    if (stop !== null) return stop;
    return checkIntegrity(phase);
  };

  const noteActivity = (activity: "model" | "verifiers"): void => {
    sinceCheck = activity;
  };

  return {
    checkIntegrity, checkAtEnd, checkState, checkStateAtEnd, checkPoint, noteActivity,
    get protectedChanged() { return protectedChanged; },
    get stateChanged() { return stateChanged; },
  };
}
