/**
 * `codaryn revert --workspace <dir> --run <runId|latest> [--dry-run | --allow-unsafe-move] [--quiet]` (R-7, N-7, DR-25): puts
 * back the files a run changed, except those changed again since. Prints one RevertOutput or
 * CliErrorOutput. Paths in the output come from the run's journal, which holds them masked.
 * `--dry-run` reports the same decisions and changes nothing (no lock, no revert record).
 */

import path from "node:path";
import { REVERT_EXIT_CODES, RESULT_SCHEMA_VERSION, UNSAFE_MOVE_CONSENT_ARGUMENT } from "../contracts/index.js";
import type { CliErrorOutput, Clock, MessageCatalog, PlanApplyState, RevertOutput } from "../contracts/index.js";
import { parseRevertArgs } from "./args.js";
import { revertStatus } from "./assemble.js";
import type { PlanApply, RevertCommand, RevertCommandInput, RevertCommandOutcome } from "./assemble.js";
import { argumentsError, cliError } from "./run.js";
import { createRunId } from "./run-id.js";
import { localPathProblem } from "./task.js";

export interface RevertEnvironment {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly isDirectory: (path: string) => Promise<boolean>;
  readonly clock: Clock;
  readonly randomBytes: (size: number) => Uint8Array;
  /**
   * `createRevertCommand(revertRun)` from assemble.ts; main.ts always passes it. When absent
   * (a build without the store), the command stops before anything is read or changed.
   */
  readonly revert?: RevertCommand;
  /**
   * DR-25: shows the question on stderr and returns the line typed, or null. Present only when
   * stdin and stderr are terminals. Asked once, after a revert skipped files as `unsafe_move`.
   */
  readonly ask?: (question: string) => Promise<string | null>;
  /** Set by the app layer only (AdapterRevert). Absent: the CLI's channels (argument, terminal). */
  readonly adapter?: AdapterRevert;
  /** U-16 (R-55 L-1): the catalog of the hint's lines (revert.plan_*); English when absent. */
  readonly messages?: MessageCatalog;
}

/**
 * DR-25, as AdapterApply for apply: how the app layer reverts for an adapter (the GUI). Only the
 * app layer sets it.
 * - `unsafeMoveConsent` is the person's consent to move this run's files back unsafely, or null.
 *   The caller passes only what the person gave as input on screen for this one revert; never a
 *   value from a task, config, profile, record, model or an earlier revert. Its channel must be
 *   `adapter` and its `runId` the run reverted; anything else is refused before anything changes.
 * - No terminal question is asked and `--allow-unsafe-move` is refused.
 */
export interface AdapterRevert {
  readonly unsafeMoveConsent: { readonly channel: "adapter"; readonly runId: string } | null;
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

  // T-12 (S-5): a network or device path is refused before the file system is touched.
  const problem = localPathProblem(parsed.args.workspace, io.cwd);
  if (problem !== null) return cliError("invalid_arguments", `the path given by --workspace ${problem}`);

  const workspace = path.resolve(io.cwd, parsed.args.workspace);
  // DR-51 (U-38), review R-70 L-1 (PM): no typed path for the summary. revert knows no registered
  // value, so its consent hint says <workspace> whatever was typed.
  if (!(await io.isDirectory(workspace))) {
    return cliError("workspace_not_found", "the workspace is not an existing directory");
  }
  const revert = io.revert;
  if (revert === undefined) {
    return cliError("internal_error", "revert is not connected in this build; nothing was changed");
  }

  // DR-25: the consent comes only from the person: the CLI's argument, the terminal answer below,
  // or the app layer's adapter path. No file, record or model gives it.
  const adapter = io.adapter;
  const ask = adapter === undefined ? io.ask : undefined;
  let consent: RevertCommandInput["consent"] = null;
  if (adapter !== undefined) {
    if (parsed.args.allowUnsafeMove) {
      return cliError("invalid_arguments", `an adapter's revert takes the person's consent in its request, not ${UNSAFE_MOVE_CONSENT_ARGUMENT}; nothing was changed`);
    }
    const given = adapter.unsafeMoveConsent;
    if (given !== null) {
      if (given.channel !== "adapter" || typeof given.runId !== "string") {
        return cliError("invalid_arguments", "the consent to unsafe moves is not the adapter's consent for one run; nothing was changed");
      }
      consent = { channel: "adapter", runId: given.runId };
    }
  } else if (parsed.args.allowUnsafeMove) {
    consent = { channel: "cli-flag", runId: null };
  }

  // The lock is held under an id of its own, so it never looks like the reverted run is active.
  const once = async (runId: string, given: RevertCommandInput["consent"]): Promise<RevertCommandOutcome | null> => {
    const lockId = createRunId(new Date(io.clock.now()), io.randomBytes);
    try {
      return await revert({ workspace, runId, lockId, clock: io.clock, dryRun, consent: given });
    } catch {
      return null;
    }
  };
  let result = await once(requested, consent);
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
      const again = await once(result.runId, { channel: "cli-tty", runId: result.runId });
      if (again === null) return { ...cliError("internal_error", "the revert stopped because of an internal error"), quiet };
      if (!again.ok) return { ...cliError(again.code, again.message), quiet };
      result = again;
    }
  }

  const status = revertStatus(result.outcome);
  const exitCode = REVERT_EXIT_CODES[status];
  return {
    output: {
      schemaVersion: RESULT_SCHEMA_VERSION,
      kind: "revert",
      runId: result.runId,
      status,
      exitCode,
      reverted: result.outcome.reverted,
      skipped: result.outcome.skipped,
      ...(dryRun ? { dryRun: true as const } : {}),
      // DR-25: a dry run does not judge whether files can go back safely; the summary says so.
      ...(result.outcome.moveSafetyUnchecked === true ? { moveSafetyUnchecked: true as const } : {}),
      ...(result.revertedBefore === null ? {} : { revertedBefore: result.revertedBefore }),
      // DR-38: the run has a records-changed mark; the revert still checked every file.
      ...(result.recordsChanged === true ? { recordsChanged: true as const } : {}),
    },
    exitCode,
    quiet,
    ...(result.planApply === undefined ? {} : { hint: appliedPlanHint(result.runId, result.planApply, dryRun, io.messages) }),
  };
}
