/** Per-run verifier rounds, repairs and approved-plan preflight; the run loop stays in index. */
import { asRawText, plannedFileStale } from "../contracts/index.js";
import type { ApprovedChangesPlan, EngineDeps, MaskedText, PlannedFileNow, RawVerifierResult, VerifierOutcome, VerifierResult, workflowSettingsOf } from "../contracts/index.js";
import { buildRepairFeedback, failureSignature, prepareEvidence } from "./feedback.js";
import type { FailedForFeedback } from "./feedback.js";
import { judgePlannedFile } from "./planned-file.js";
import { APPROVED_STALE_LEAD, APPROVED_STALE_END, APPROVED_DENIED_LEAD, APPROVED_DENIED_END, APPROVED_CLAIMED_NOTICE, APPROVED_CLAIM_FAILED_NOTICE, APPROVED_RECORDS_UNCHECKED_NOTICE, REVIEW_NOTICE, NO_VERIFIER_NOTICE, VERIFIER_NOT_RUN_EVIDENCE, VERIFIER_NOT_RUN_CHECKED } from "./model-texts.js";
import { MASKING_FAILED, PLAN_STALE, AWAITING_REVIEW } from "./pure.js";
import type { End, RepairNeeded } from "./pure.js";
import type { createRunChecks } from "./run-checks.js";
import type { createRunConverse } from "./run-converse.js";
import type { createRunHelpers } from "./run-helpers.js";
import type { RunTally } from "./run-tally.js";

export function createRunVerify(
  tally: RunTally,
  task: EngineDeps["task"],
  verifiers: EngineDeps["verifiers"],
  settings: ReturnType<typeof workflowSettingsOf>,
  limits: EngineDeps["task"]["limits"],
  integrity: EngineDeps["integrity"],
  policy: EngineDeps["policy"],
  runSignal: AbortSignal,
  mask: ReturnType<typeof createRunHelpers>["mask"],
  interrupted: ReturnType<typeof createRunHelpers>["interrupted"],
  record: ReturnType<typeof createRunHelpers>["record"],
  checkPoint: ReturnType<typeof createRunChecks>["checkPoint"],
  checkState: ReturnType<typeof createRunChecks>["checkState"],
  noteActivity: ReturnType<typeof createRunChecks>["noteActivity"],
  budgetStop: ReturnType<typeof createRunConverse>["budgetStop"],
) {
  /** Signature of the latest failed verification, and how many times in a row it occurred. */
  let lastSignature: string | null = null;
  let sameFailures = 0;

  /**
   * GT-E4: with `completion: "human_review"`, a run whose checks are done waits for a person: it
   * ends as needs-input/awaiting_review with the masked checklist. It never becomes done.
   */
  const awaitReview = (): End => {
    const checklist: MaskedText[] = [];
    for (const item of settings.humanReview?.checklist ?? []) {
      const masked = mask(item);
      if (masked === null) return MASKING_FAILED;
      checklist.push(masked);
    }
    tally.reviewChecklist = checklist;
    const notice = mask(REVIEW_NOTICE);
    if (notice !== null) tally.notices.push(notice);
    return AWAITING_REVIEW;
  };

  /**
   * Runs every verifier once (one round). `EngineResult.verifiers` holds the latest round.
   * Returns the end of the run, or the failed results when a repair may follow.
   */
  const verify = async (): Promise<End | RepairNeeded> => {
    tally.state.transition("verifying");
    const interruption = interrupted();
    if (interruption !== null) return interruption;
    if (task.verifiers.length === 0) {
      const notice = mask(NO_VERIFIER_NOTICE);
      if (notice !== null) tally.notices.push(notice);
      if (settings.completion === "human_review") return awaitReview();
      return { status: "needs-input", reason: "no_verifier" };
    }
    // U-1: when protected material changed since run start, this round's verifiers are not run.
    // EngineResult.verifiers then keeps the previous round, as when a limit ends the run here.
    const before = await checkPoint("before_verify");
    if (before !== null) return before;
    const stateBefore = await checkState("before_verify", true);
    if (stateBefore !== null) return stateBefore;
    tally.verifierResults.length = 0;
    /** Whether each recorded evidence of this round was cut (T-6), by verifier id. */
    const evidenceCut = new Map<string, boolean>();
    const outcomes: VerifierOutcome[] = [];
    for (const config of task.verifiers) {
      const stop = interrupted();
      if (stop !== null) return stop;
      let raw: RawVerifierResult;
      // W-1: a verifier command may change protected material.
      noteActivity("verifiers");
      try {
        raw = await verifiers.run(config, runSignal);
      } catch {
        raw = {
          id: config.id,
          kind: config.kind,
          outcome: "inconclusive" as const,
          evidence: asRawText(VERIFIER_NOT_RUN_EVIDENCE),
          checked: [VERIFIER_NOT_RUN_CHECKED],
          limits: [],
        };
      }
      const masked = mask(raw.evidence);
      const checked = raw.checked.map(mask);
      const limitNotes = raw.limits.map(mask);
      if (masked === null || checked.includes(null) || limitNotes.includes(null)) {
        return MASKING_FAILED;
      }
      // T-6: masked first, then the runner's slack dropped and the text cut. A cut of masked text
      // plus a fixed note holds nothing that was not already masked.
      const prepared = prepareEvidence(masked, raw.evidenceTruncated === true);
      const result: VerifierResult = {
        id: raw.id,
        kind: raw.kind,
        outcome: raw.outcome,
        evidence: prepared.text as MaskedText,
        checked: checked as MaskedText[],
        limits: limitNotes as MaskedText[],
      };
      tally.verifierResults.push(result);
      evidenceCut.set(result.id, prepared.truncated);
      outcomes.push(raw.outcome);
      await record({ type: "verifier_result", result });
    }
    // T-8: the user's cancel, or the duration limit ending while the last verifier ran.
    const stopped = interrupted();
    if (stopped !== null) return stopped;
    // U-1, U-2: a change made during the round (a verifier command, for example) makes the whole
    // round untrusted, whatever the verifiers said, and is not repaired.
    const after = await checkPoint("after_verify");
    if (after !== null) return after;
    const stateAfter = await checkState("after_verify", true);
    if (stateAfter !== null) return stateAfter;
    // IR-E3: either capture (integrity, or the state check without one) may have outlasted the
    // duration limit or met a cancel; a change found comes first (above). With neither, nothing ran.
    const late = interrupted();
    if (late !== null) return late;
    if (!outcomes.includes("fail")) {
      if (outcomes.includes("inconclusive")) return { status: "needs-input", reason: "verifier_inconclusive" };
      if (settings.completion === "human_review") return awaitReview();
      return { status: "done", reason: "verified" };
    }
    // R-1: a verifier that could not decide is not something the model can fix, so no repair.
    if (outcomes.includes("inconclusive")) return { status: "failed", reason: "verifier_failed" };
    return decideRepair(
      tally.verifierResults
        .filter((result) => result.outcome === "fail")
        .map((result) => ({ ...result, evidenceCut: evidenceCut.get(result.id) === true })),
    );
  };

  /** R-2, R-3: a repair only while attempts are left and the same failure has not repeated too often. */
  const decideRepair = (failed: readonly FailedForFeedback[]): End | RepairNeeded => {
    const signature = failureSignature(failed);
    sameFailures = signature === lastSignature ? sameFailures + 1 : 1;
    lastSignature = signature;
    if (tally.repairAttempts >= limits.maxRepairAttempts) return { status: "failed", reason: "verifier_failed" };
    if (sameFailures >= limits.maxSameFailures) return { status: "failed", reason: "repeated_failure" };
    return { failed: [...failed] };
  };

  /**
   * Starts a repair: records repair_started, goes back to running and adds the masked, cut
   * evidence as the next user message. Nothing starts when no model call could follow.
   */
  const repair = async (needed: RepairNeeded): Promise<End | null> => {
    const stop = budgetStop();
    if (stop !== null) return stop;
    const attempt = tally.repairAttempts + 1;
    const feedback = buildRepairFeedback(needed.failed, attempt, limits.maxRepairAttempts);
    const content = mask(feedback.text);
    if (content === null) return MASKING_FAILED;
    tally.repairAttempts = attempt;
    await record({
      type: "repair_started",
      attempt,
      failedVerifiers: needed.failed.map((result) => result.id),
      feedbackTruncated: feedback.truncated,
    });
    tally.state.transition("running");
    tally.messages.push({ role: "user", content });
    return null;
  };

  /** Ends the run before its first model request with a notice (masked); null when it cannot be masked. */
  const staleWith = (text: string): End => {
    const masked = mask(text);
    if (masked !== null) tally.notices.push(masked);
    return PLAN_STALE;
  };

  /**
   * U-187 (B-6, B-7): before the first model request of a run that carries out an approved plan,
   * every planned file as it is now (fail closed), then the gate on it as a write, then the claim.
   */
  const checkApprovedPlan = async (plan: ApprovedChangesPlan): Promise<End | null> => {
    for (const [index, file] of plan.plan.files.entries()) {
      let now: PlannedFileNow;
      try {
        now = await plan.fileNow(file, runSignal);
      } catch {
        now = { kind: "other" };
      }
      const stop = interrupted();
      if (stop !== null) return stop;
      if (plannedFileStale(file, now)) return staleWith(`${APPROVED_STALE_LEAD}${index}${APPROVED_STALE_END}`);
      // U-219: judgePlannedFile, given out for the app layer's check before the approval;
      // Codex V-21: the app still has its own lines until p5a connects it (U-229).
      const decision = await judgePlannedFile(policy, file.path);
      if (!decision.allowed) return staleWith(`${APPROVED_DENIED_LEAD}${index}: ${decision.permission}/${decision.code}${APPROVED_DENIED_END}`);
    }
    const stop = interrupted();
    if (stop !== null) return stop;
    let claimed: "marked" | "already_applied";
    try {
      claimed = await plan.markApplied();
    } catch {
      return staleWith(APPROVED_CLAIM_FAILED_NOTICE);
    }
    if (claimed !== "marked") return staleWith(APPROVED_CLAIMED_NOTICE);
    // U-181's handoff: as an apply run, whether a run since the plan could not check the records;
    // told once, the run goes on. A question that cannot be answered counts as unchecked.
    if (plan.planRecordsUnchecked !== undefined) {
      let unchecked: boolean;
      try {
        unchecked = (await plan.planRecordsUnchecked()) === true;
      } catch {
        unchecked = true;
      }
      if (unchecked) {
        const masked = mask(APPROVED_RECORDS_UNCHECKED_NOTICE);
        if (masked !== null) tally.notices.push(masked);
      }
    }
    return null;
  };

  return { verify, repair, checkApprovedPlan };
}
