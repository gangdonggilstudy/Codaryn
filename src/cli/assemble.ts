/**
 * The CLI's revert command (createRevertCommand, revertStatus), which moves to the app layer in the CLI
 * migration's C-9a. The run's assembly, the one place where real modules are put together for one run,
 * is the app layer's since C-4 (U-285): src/app/assembly.ts; its names are re-exported below (plan A).
 * Other modules are used through their public `index.ts` exports only.
 */

import { lstat, stat } from "node:fs/promises";
import path from "node:path";
import { JOURNAL_FILE_NAME, REVERT_ERROR_CODES, RUNS_DIR_NAME, STATE_DIR_NAME, planApplyStateOf } from "../contracts/index.js";
import type { PlanApplyState, RunId, RunListEntry, RunReason } from "../contracts/index.js";
import { RevertRunError, acquireLock, hasRecordsChangedMark, listRuns as storeListRuns, releaseLock } from "../store/index.js";
import type { RunInspection } from "../store/index.js";
import { createWorkspace } from "../workspace/index.js";
import type {
  ApprovalChannel,
  RevertErrorCode,
  CliErrorCode,
  Clock,
  ListRuns,
  LoadPlan,
  ReadRevertRecord,
  RevertOutcome,
  RevertRun,
  RevertStatus,
  WriteRevertRecord,
} from "../contracts/index.js";
import { resolveRunReference } from "../app/input/run-ref.js";
import type { CheckedRun } from "../app/input/run-ref.js";
import { lockedMessage } from "../app/assembly.js";

// U-285 (CLI migration C-4): the run's assembly is the app layer's now (src/app/assembly.ts). These
// re-exports keep the old names for the tests, the pinned file (tests/unit/cli/sp0-pins.ts takes
// assembleRun) and the app layer's wrapper until p5a points it at the new place (plan A); the CLI's
// own users (run.ts, main.ts) import from there. The revert command below stays until C-9a.
export { assembleRun, createAssemble } from "../app/assembly.js";
export type { ApprovedPlanParts, Assemble, AssembleHooks, AssemblyInput, AssemblyOutcome } from "../app/assembly.js";

export interface RevertCommandInput {
  /** Absolute path of an existing directory. */
  readonly workspace: string;
  /** The run to revert, or LATEST_RUN_ALIAS. Already checked against RUN_ID_PATTERN. */
  readonly runId: string;
  /** Id under which this revert holds the workspace lock. */
  readonly lockId: string;
  readonly clock: Clock;
  /** N-7: decide and report, change nothing; no lock and no revert record. */
  readonly dryRun?: boolean;
  /**
   * DR-25: the person's consent to move files back unsafely in this revert, or absent/null for
   * none. It comes only from a person: the CLI's argument or terminal answer (`runId` null: the run
   * this command resolves to), or the app layer's adapter path after the person agreed on screen
   * (`runId`: the run the person saw, which must be the one resolved). Not with `dryRun`.
   */
  readonly consent?: { readonly channel: ApprovalChannel; readonly runId: string | null } | null;
}

export type RevertCommandOutcome =
  | {
      readonly ok: true;
      readonly outcome: RevertOutcome;
      /** The run that was (or would be) reverted: `latest` resolved. */
      readonly runId: string;
      /** N-7: the run's checked revert record from before this command, or null. */
      readonly revertedBefore: { readonly at: string; readonly status: RevertStatus } | null;
      /** DR-38: the run has a records-changed mark (or one that cannot be read). The revert still ran its checks. */
      readonly recordsChanged?: boolean;
      /**
       * U-16 (UXM-5): the run is a plan run whose plan an apply run used, and this revert found
       * nothing of its own to put back: the changes are the apply run's. No revert record is written
       * for it (the run list would show it as reverted while the apply's changes stay).
       * R-55 L-1: with where that apply run stands in the run list, so the hint advises reverting it
       * only while it is there and not reverted.
       */
      readonly planApply?: PlanApply;
      /**
       * U-220 (U-176, U-201): the revert finished but its workspace lock could not be released (the
       * release threw after its retries, or answered false). The outcome is the revert's own; the
       * summary says `lock.release_failed`. Absent: released.
       */
      readonly lockLeft?: true;
    }
  | { readonly ok: false; readonly code: CliErrorCode; readonly message: string };

export type RevertCommand = (input: RevertCommandInput) => Promise<RevertCommandOutcome>;

/**
 * U-16, R-55 L-1: the apply run that used a plan run's plan, judged by the contract's one rule
 * (planApplyStateOf over the run list), or `unknown` when the run list could not be read.
 */
export interface PlanApply {
  readonly runId: string;
  readonly state: PlanApplyState | "unknown";
  /** The apply run's reason, for `unfinished`. */
  readonly reason?: RunReason;
}

export interface RevertCommandOptions {
  /**
   * N-7: the store's `revertRun` when it honours `RevertRequest.dryRun` (it changes nothing then).
   * Absent: `--dry-run` stops before anything is read, because a store that ignored the flag
   * would really revert.
   */
  readonly dryRun?: RevertRun;
  /** N-7: the store's `listRuns`, for `--run latest`. Absent: `latest` is not available. */
  readonly listRuns?: ListRuns;
  /** N-22: the store's revert record functions. Absent: no record is read or written. */
  readonly readRecord?: ReadRevertRecord;
  readonly writeRecord?: WriteRevertRecord;
  /** U-16 (UXM-5): the store's `loadPlan`, to tell a plan run an apply used. Absent: not told. */
  readonly loadPlan?: LoadPlan;
  /** N-23: told which run `--run latest` chose, before anything is read or changed. */
  readonly announceLatest?: (entry: CheckedRun) => void;
  /**
   * N-26: whether a run's records pass the run list's checks. A damaged run is refused even when
   * named by its id. Absent: `listRuns` decides (the run's entry is `damaged`); without either,
   * nothing is refused.
   */
  readonly isDamaged?: (workspaceRoot: string, runId: string) => Promise<boolean>;
  /**
   * N-27 (a): the store's `inspectRun`. An explicit id with no entry of exactly that name is
   * run_not_found, and without `isDamaged` it judges damage too.
   */
  readonly inspect?: (workspaceRoot: string, runId: string) => Promise<RunInspection>;
  /** DR-38: the store's `hasRecordsChangedMark` (the default); injected by tests. A rejection counts as a mark. */
  readonly hasRecordsChangedMark?: (workspaceRoot: string, runId: string) => Promise<boolean>;
}

/** N-26: `listRuns` as the damage check, until the store's own function is passed. */
async function damagedByListing(listRuns: ListRuns, workspaceRoot: string, runId: string): Promise<boolean> {
  const listing = await listRuns({ workspaceRoot });
  return listing.runs.some((entry) => entry.runId === runId && entry.state === "damaged");
}

/**
 * N-7, N-22: the revert outcome's status. A file skipped as `already_reverted` is already as it
 * was before the run, so only the other reasons make it partial.
 */
export function revertStatus(outcome: RevertOutcome): RevertStatus {
  return outcome.skipped.some((file) => file.reason !== "already_reverted") ? "partial" : "complete";
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * `codaryn revert` around the store's `revertRun` (R-7). The run must have a journal in this
 * workspace. The workspace lock is held while files are put back, so no run can start meanwhile,
 * and a running task makes the revert stop with `workspace_locked` before anything changes.
 */
/** The CLI's fixed text for each code revertRun rejects with (REVERT_ERROR_CODES). */
const REVERT_ERROR_MESSAGES: { readonly [C in RevertErrorCode]: string } = {
  run_not_found: "the workspace has no journal for that run id; nothing was changed",
  invalid_run_record: "the run's journal cannot be read; nothing was changed",
  // R-9c C-1: the apply's files' real paths are known only from its plan run's plan.json.
  plan_run_missing: "the plan run this apply used, or its plan.json, is gone, so the files' real paths are not known; nothing was changed. Keep a plan run while its apply may be reverted",
};

export function createRevertCommand(revertRun: RevertRun, options: RevertCommandOptions = {}): RevertCommand {
  const failed = (error: unknown): RevertCommandOutcome => {
    // revertRun rejects only before it changes anything, with one of REVERT_ERROR_CODES. Its text
    // is not passed on; anything else is invalid_run_record.
    const code: RevertErrorCode = error instanceof RevertRunError && REVERT_ERROR_CODES.includes(error.code) ? error.code : "invalid_run_record";
    return { ok: false, code, message: REVERT_ERROR_MESSAGES[code] };
  };
  return async ({ workspace, runId: requested, lockId, clock, dryRun = false, consent = null }) => {
    if (dryRun && consent !== null) {
      return { ok: false, code: "invalid_arguments", message: "a dry run moves nothing and takes no consent to unsafe moves; nothing was read or changed" };
    }
    if (dryRun && options.dryRun === undefined) {
      return { ok: false, code: "internal_error", message: "--dry-run is not connected in this build; nothing was read or changed" };
    }
    let workspaceRoot: string;
    try {
      workspaceRoot = (await createWorkspace({ root: workspace })).root;
    } catch {
      return { ok: false, code: "workspace_not_found", message: "the workspace is not an existing directory" };
    }
    // N-7, N-18: `latest` is resolved first; an ambiguous one stops here.
    const resolved = await resolveRunReference(workspaceRoot, requested, {
      exists,
      ...(options.listRuns === undefined ? {} : { listRuns: options.listRuns }),
      ...(options.inspect === undefined ? {} : { inspect: options.inspect }),
    });
    if (!resolved.ok) return resolved;
    const runId = resolved.runId;
    // DR-25: a consent that names another run counts as none; it is refused before anything changes.
    if (consent !== null && consent.runId !== null && consent.runId !== runId) {
      return { ok: false, code: "invalid_arguments", message: "the consent to unsafe moves names another run than the one reverted; nothing was changed" };
    }
    if (resolved.latest !== null) {
      try {
        options.announceLatest?.(resolved.latest);
      } catch {
        // The notice is best effort.
      }
    }
    const journal = path.join(workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME, runId, JOURNAL_FILE_NAME);
    if (!(await isFile(journal))) {
      return { ok: false, code: "run_not_found", message: "the workspace has no journal for that run id; nothing was changed" };
    }
    // N-26: the records of a damaged run are not trusted to decide what to put back.
    const inspect = options.inspect;
    const damageCheck =
      options.isDamaged ??
      (inspect === undefined ? undefined : async (root: string, id: string) => (await inspect(root, id)) === "damaged") ??
      (options.listRuns === undefined ? undefined : (root: string, id: string) => damagedByListing(options.listRuns as ListRuns, root, id));
    if (damageCheck !== undefined) {
      let damaged: boolean;
      try {
        damaged = await damageCheck(workspaceRoot, runId);
      } catch {
        damaged = true;
      }
      if (damaged) {
        return {
          ok: false,
          code: "invalid_run_record",
          message: "the run's records do not pass the checks (`codaryn runs` shows it as damaged); nothing was changed",
        };
      }
    }
    // N-22, N-23: a record that cannot be read or checked is ignored, never an error.
    let revertedBefore: { readonly at: string; readonly status: RevertStatus } | null = null;
    try {
      const record = (await options.readRecord?.(workspaceRoot, runId)) ?? null;
      revertedBefore = record === null ? null : { at: record.at, status: record.status };
    } catch {
      revertedBefore = null;
    }
    // DR-38 (P-3): a marked run is not refused; the output says so. A mark that cannot be read counts.
    let recordsChanged: boolean;
    try {
      recordsChanged = await (options.hasRecordsChangedMark ?? hasRecordsChangedMark)(workspaceRoot, runId);
    } catch {
      recordsChanged = true;
    }
    // Absent means false, as in RevertOutput.
    const marked = recordsChanged ? { recordsChanged: true as const } : {};
    // U-16 (UXM-5): a plan run changes no file; when its plan was applied, the changes are the apply
    // run's. Told only when this revert had nothing to put back or skip. Reads only; best effort.
    // R-55 L-1: and where the apply run stands in the run list (the store's, or the one given).
    const appliedPlanOf = async (outcome: RevertOutcome): Promise<{ planApply?: PlanApply }> => {
      if (options.loadPlan === undefined || outcome.reverted.length > 0 || outcome.skipped.length > 0) return {};
      let applyRunId: string;
      try {
        const loaded = await options.loadPlan({ workspaceRoot, runId });
        if (!loaded.ok || loaded.applied === null) return {};
        applyRunId = loaded.applied.applyRunId;
      } catch {
        return {};
      }
      try {
        const entries = (await (options.listRuns ?? storeListRuns)({ workspaceRoot })).runs;
        // The plan run's own entry, naming the apply run applied.json names (the store's list gives
        // appliedBy from the same file; this keeps the one the revert just read).
        type Checked = Extract<RunListEntry, { readonly state: "checked" }>;
        const own = entries.find((run): run is Checked => run.state === "checked" && run.runId === runId);
        const judged = planApplyStateOf({ ...(own ?? ({} as Checked)), appliedBy: { runId: applyRunId as RunId, at: "" } }, entries);
        if (judged === null) return {};
        return { planApply: { runId: applyRunId, state: judged.state, ...(judged.reason === undefined ? {} : { reason: judged.reason }) } };
      } catch {
        return { planApply: { runId: applyRunId, state: "unknown" } };
      }
    };

    if (dryRun && options.dryRun !== undefined) {
      // N-7: no lock, no record, nothing written.
      try {
        const outcome = await options.dryRun({ workspaceRoot, runId, dryRun: true });
        return { ok: true, outcome, runId, revertedBefore, ...marked, ...(await appliedPlanOf(outcome)) };
      } catch (error) {
        return failed(error);
      }
    }

    const lock = await acquireLock({ workspaceRoot, runId: lockId, clock });
    if (!lock.ok) return { ok: false, code: "workspace_locked", message: `${lockedMessage(lock.holder)}; nothing was changed` };
    /** The revert itself, under the lock. */
    const underLock = async (): Promise<RevertCommandOutcome> => {
    try {
      const outcome = await revertRun({
        workspaceRoot,
        runId,
        ...(consent === null ? {} : { unsafeMoveConsent: { channel: consent.channel, runId } }),
      });
      // U-16 (UXM-5): nothing of an applied plan run was reverted, so no record says it was.
      const appliedPlan = await appliedPlanOf(outcome);
      if (appliedPlan.planApply !== undefined) return { ok: true, outcome, runId, revertedBefore, ...marked, ...appliedPlan };
      // N-7, N-22: the revert record, written while the lock is held; best effort.
      try {
        await options.writeRecord?.(workspaceRoot, {
          schemaVersion: 1,
          kind: "revert_record",
          runId,
          at: new Date(clock.now()).toISOString(),
          status: revertStatus(outcome),
          reverted: outcome.reverted.length,
          skipped: outcome.skipped.length,
          // DR-25: how the person consented, and how many files went back unsafely under it.
          unsafeMoveConsent: consent === null ? null : consent.channel,
          unsafeMoves: outcome.reverted.filter((file) => file.unsafe === true).length,
        });
      } catch {
        // The record never changes the outcome.
      }
      return { ok: true, outcome, runId, revertedBefore, ...marked };
    } catch (error) {
      return failed(error);
    }
    };
    const finished = await underLock();
    // U-220 (U-176, U-201): a release that throws after its retries, or answers false, leaves the
    // lock; the revert's outcome stays and says so (lockLeft), never internal_error.
    const released = await releaseLock({ workspaceRoot, runId: lockId }).then((value) => value === true, () => false);
    return finished.ok && !released ? { ...finished, lockLeft: true } : finished;
  };
}
