/**
 * `codaryn revert --workspace <dir> --run <runId|latest> [--dry-run] [--quiet]` (R-7, N-7): puts
 * back the files a run changed, except those changed again since. Prints one RevertOutput or
 * CliErrorOutput. Paths in the output come from the run's journal, which holds them masked.
 * `--dry-run` reports the same decisions and changes nothing (no lock, no revert record).
 */

import path from "node:path";
import { REVERT_EXIT_CODES, RESULT_SCHEMA_VERSION } from "../contracts/index.js";
import type { CliErrorOutput, Clock, RevertOutput } from "../contracts/index.js";
import { parseRevertArgs } from "./args.js";
import { revertStatus } from "./assemble.js";
import type { RevertCommand, RevertCommandOutcome } from "./assemble.js";
import { cliError } from "./run.js";
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
}

export interface RevertCliOutcome {
  readonly output: RevertOutput | CliErrorOutput;
  readonly exitCode: number;
  /** `--quiet` (N-5): no human-readable output on stderr. False when the arguments were not parsed. */
  readonly quiet?: boolean;
}

export async function runRevert(io: RevertEnvironment): Promise<RevertCliOutcome> {
  const parsed = parseRevertArgs(io.argv);
  if (!parsed.ok) return cliError("invalid_arguments", parsed.message);
  const { runId: requested, dryRun, quiet } = parsed.args;

  // T-12 (S-5): a network or device path is refused before the file system is touched.
  const problem = localPathProblem(parsed.args.workspace, io.cwd);
  if (problem !== null) return cliError("invalid_arguments", `the path given by --workspace ${problem}`);

  const workspace = path.resolve(io.cwd, parsed.args.workspace);
  if (!(await io.isDirectory(workspace))) {
    return cliError("workspace_not_found", "the workspace is not an existing directory");
  }
  if (io.revert === undefined) {
    return cliError("internal_error", "revert is not connected in this build; nothing was changed");
  }

  // The lock is held under an id of its own, so it never looks like the reverted run is active.
  const lockId = createRunId(new Date(io.clock.now()), io.randomBytes);
  let result: RevertCommandOutcome;
  try {
    result = await io.revert({ workspace, runId: requested, lockId, clock: io.clock, dryRun });
  } catch {
    return { ...cliError("internal_error", "the revert stopped because of an internal error"), quiet };
  }
  if (!result.ok) return { ...cliError(result.code, result.message), quiet };

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
      ...(result.revertedBefore === null ? {} : { revertedBefore: result.revertedBefore }),
    },
    exitCode,
    quiet,
  };
}
