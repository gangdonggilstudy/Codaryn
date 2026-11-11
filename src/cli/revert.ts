/**
 * `codaryn revert --workspace <dir> --run <runId>` (R-7): puts back the files a run changed,
 * except those changed again since. Prints one RevertOutput or CliErrorOutput.
 * Paths in the output come from the run's journal, which holds them masked.
 */

import path from "node:path";
import { REVERT_EXIT_CODES, RESULT_SCHEMA_VERSION } from "../contracts/index.js";
import type { CliErrorOutput, Clock, RevertOutput } from "../contracts/index.js";
import { parseRevertArgs } from "./args.js";
import type { RevertCommand, RevertCommandOutcome } from "./assemble.js";
import { cliError } from "./run.js";
import { createRunId } from "./run-id.js";

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
}

export async function runRevert(io: RevertEnvironment): Promise<RevertCliOutcome> {
  const parsed = parseRevertArgs(io.argv);
  if (!parsed.ok) return cliError("invalid_arguments", parsed.message);
  const { runId } = parsed.args;

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
    result = await io.revert({ workspace, runId, lockId, clock: io.clock });
  } catch {
    return cliError("internal_error", "the revert stopped because of an internal error");
  }
  if (!result.ok) return cliError(result.code, result.message);

  const status = result.outcome.skipped.length === 0 ? "complete" : "partial";
  const exitCode = REVERT_EXIT_CODES[status];
  return {
    output: {
      schemaVersion: RESULT_SCHEMA_VERSION,
      kind: "revert",
      runId,
      status,
      exitCode,
      reverted: result.outcome.reverted,
      skipped: result.outcome.skipped,
    },
    exitCode,
  };
}
