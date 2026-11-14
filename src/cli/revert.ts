/**
 * `codaryn revert --workspace <dir> --run <runId|latest> [--dry-run | --allow-unsafe-move] [--quiet]` (R-7, N-7, DR-25): puts
 * back the files a run changed, except those changed again since. Prints one RevertOutput or
 * CliErrorOutput. Paths in the output come from the run's journal, which holds them masked.
 * `--dry-run` reports the same decisions and changes nothing (no lock, no revert record).
 */

import type { CliErrorOutput, MessageCatalog, PlanApplyState, RevertOutput } from "../contracts/index.js";
import { parseRevertArgs } from "./args.js";
import type { PlanApply } from "../app/revert-command.js";
import { argumentsError, cliError } from "../app/prepare.js";
import { revertOnce, revertOutput, startRevert } from "../app/revert-command.js";
import type { RevertRulesEnvironment } from "../app/revert-command.js";

// U-314 (CLI migration C-9a): the revert's rules are the app layer's (src/app/revert-command.ts); these
// names stay for the tests and the app layer (plan A).
export type { AdapterRevert, RevertRulesEnvironment } from "../app/revert-command.js";

export interface RevertEnvironment extends RevertRulesEnvironment {
  readonly argv: readonly string[];
  /**
   * DR-25: shows the question on stderr and returns the line typed, or null. Present only when
   * stdin and stderr are terminals. Asked once, after a revert skipped files as `unsafe_move`.
   */
  readonly ask?: (question: string) => Promise<string | null>;
  /** U-16 (R-55 L-1): the catalog of the hint's lines (revert.plan_*); English when absent. */
  readonly messages?: MessageCatalog;
}

export interface RevertCliOutcome {
  readonly output: RevertOutput | CliErrorOutput;
  readonly exitCode: number;
  /** `--quiet` (N-5): no human-readable output on stderr. False when the arguments were not parsed. */
  readonly quiet?: boolean;
  /**
   * U-16 (UXM-5): a line for the person (stderr), when the run reverted is a plan run whose plan an
   * apply run used: nothing of it was put back, and the apply run is the one to revert. Fixed
   * English; the JSON line is as before.
   */
  readonly hint?: string;
  /**
   * U-220 (U-176, U-201): the revert finished but its workspace lock could not be released; the
   * summary says `lock.release_failed` (RevertSummaryContext.lockLeft). Not in the JSON line.
   */
  readonly lockLeft?: true;
}

/** A catalog text, or `fallback` while this build's catalog does not have the id yet (N-B). */
function textOr(make: (() => string) | null, fallback: string): string {
  if (make === null) return fallback;
  try {
    return make();
  } catch {
    return fallback;
  }
}

/**
 * U-16 (UXM-5): what reverting an applied plan run tells the person. R-55 L-1: by the contract's
 * rule (planApplyStateOf), it advises reverting the apply run only for PLAN_APPLY_STATES_TO_REVERT
 * (its changes are there to undo); otherwise it says what is so. The catalog's lines (revert.plan_*)
 * when it has them, these English lines otherwise.
 */
export function appliedPlanHint(planRunId: string, apply: PlanApply, dryRun: boolean, messages?: MessageCatalog): string {
  const id = apply.runId;
  const format = (key: string, params: Record<string, string> = {}): (() => string) | null =>
    messages === undefined ? null : () => (messages.format as (id: string, params?: Record<string, string>) => string)(key, params);
  const head = textOr(
    format("revert.plan_only"),
    `Run ${planRunId} only made a plan and changed no file itself, so there ${dryRun ? "is" : "was"} nothing to put back and it is not marked as reverted.`,
  );
  if (apply.state === "unknown") return `${head} Its plan was applied by run ${id}; the run list could not be read to tell whether that run can still be reverted.`;
  const tail: { readonly [S in PlanApplyState]: string } = {
    applied: textOr(format("revert.plan_revert_apply", { runId: id }), `Its plan was applied by run ${id}: to undo those changes, revert that run (--run ${id}).`),
    unfinished: textOr(
      format("revert.plan_revert_apply", { runId: id }),
      `Its plan was applied by run ${id}, which did not finish (${apply.reason ?? "no reason recorded"}): to undo what it changed, revert that run (--run ${id}).`,
    ),
    applying: textOr(format("revert.plan_applying", { runId: id }), `Its plan is being applied by run ${id}, which has no result yet.`),
    reverted: textOr(format("revert.plan_apply_reverted", { runId: id }), `Its plan was applied by run ${id}, which was already reverted.`),
    record_missing: textOr(
      format("revert.plan_apply_missing", { runId: id }),
      `Its plan was applied by run ${id}, whose records are no longer in this workspace or do not pass the checks, so that run cannot be reverted any more.`,
    ),
  };
  return `${head} ${tail[apply.state]}`;
}

const YES = new Set(["y", "yes", "예", "네"]);

export async function runRevert(io: RevertEnvironment): Promise<RevertCliOutcome> {
  const parsed = parseRevertArgs(io.argv);
  if (!parsed.ok) return argumentsError(parsed);
  const { runId: requested, dryRun, quiet } = parsed.args;
  // U-314 (C-9a): the revert's rules are the app layer's (startRevert, revertOnce, revertOutput); the
  // DR-25 terminal question, the plan run's hint and what is printed are the CLI's. A consent given at
  // the terminal is a second call, as before (PM Q-19).
  const start = await startRevert(io, { workspace: parsed.args.workspace, dryRun, allowUnsafeMove: parsed.args.allowUnsafeMove });
  if (!start.ok) return start.outcome;
  const { started } = start;
  const ask = started.mayAsk ? io.ask : undefined;
  const consent = started.consent;
  let result = await revertOnce(io, started, requested, dryRun, consent);
  if (result === null) return { ...cliError("internal_error", "the revert stopped because of an internal error"), quiet };
  if (!result.ok) return { ...cliError(result.code, result.message), quiet };

  // DR-25: at a terminal, files skipped as unsafe_move may go back with the person's answer, for
  // this run and this revert only. The files already put back are not touched again.
  const unsafe = result.outcome.skipped.filter((file) => file.reason === "unsafe_move").length;
  if (!dryRun && consent === null && ask !== undefined && unsafe > 0) {
    const question =
      `${unsafe} file${unsafe === 1 ? "" : "s"} can only be moved back without the guarantee that nothing at the ` +
      `original path is replaced (the drive has no hard links). ${unsafe === 1 ? "It was" : "They were"} not moved. ` +
      `Revert again and move ${unsafe === 1 ? "it" : "them"} back anyway, for this revert only? [y/N] `;
    const answer = (await ask(question))?.trim().toLowerCase() ?? "";
    if (YES.has(answer)) {
      const again = await revertOnce(io, started, result.runId, dryRun, { channel: "cli-tty", runId: result.runId });
      if (again === null) return { ...cliError("internal_error", "the revert stopped because of an internal error"), quiet };
      if (!again.ok) return { ...cliError(again.code, again.message), quiet };
      result = again;
    }
  }

  const { output, exitCode } = revertOutput(result, dryRun);
  return {
    output,
    exitCode,
    quiet,
    ...(result.planApply === undefined ? {} : { hint: appliedPlanHint(result.runId, result.planApply, dryRun, io.messages) }),
    // U-220: a lock left by this revert, for the summary only (the JSON line is as before).
    ...(result.lockLeft === true ? { lockLeft: true as const } : {}),
  };
}
