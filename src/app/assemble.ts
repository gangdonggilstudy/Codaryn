/**
 * Assembly of one run for the app layer: the one assembly (createAssemble, ./assembly.ts) with the
 * app's hooks. U-237 (p4g's R-108 H-2, with na-core's U-210): there is one assembly. The app kept a
 * copy of it, which fell behind twice the same way (the writable lists before U-186, the unreadable
 * paths and k with U-210: its gate, tool runner, verifier runner and integrity checks were made
 * without them, so a run through the app ignored the run's unreadable paths). Now every part a run
 * through the app gets is the one the CLI's runs get too, made from the same place (runGuards), and
 * so is the carried-out plan's gate (approvedPlan.policyFor, U-195). U-285 (CLI migration C-4) moved
 * that assembly from src/cli/assemble.ts, which re-exports it, to ./assembly.ts; the CLI's runs call
 * it without hooks. U-286: this wrapper takes it from ./assembly.ts.
 *
 * The app's hooks:
 * - DR-4: the command runner takes its parent environment from the run's environment copy (the
 *   variables file loaded into it), not from `process.env`, and the platform it was made for. The CLI
 *   loads `--vars-file` into `process.env`; the app layer loads it into a copy, so it hands that copy
 *   to the runner and keeps the host's own variables out of the children. What reaches a child from
 *   the file (R-4 I-1): only an allowlisted variable whose value is shorter than 8 characters; a longer
 *   value the file sets is registered as a secret (S-4) and the runner leaves it out (T-1).
 * - onAssembled: the run's privacy gateway and the real workspace root once the lock is held.
 * - U-193 (after U-176): when the run's lock cannot be released at its end (the release threw after
 *   the store's retries, or answered false), the assembly's finish resolves with `{ lockLeft: true }`
 *   (U-220) and the app calls `onLockLeft`; the run's result (written to result.json first) stays.
 *   The lock is then held while this process lives, and a later run of another process finds it
 *   stale once it has ended. Nothing tries to release it again (Codex V-17, V-17b).
 */

import type { PrivacyGateway } from "../contracts/index.js";
import { createAssemble } from "./assembly.js";
import type { Assemble } from "./assembly.js";

export function createAppAssemble(
  parentEnv: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  onAssembled: (assembled: { readonly privacy: PrivacyGateway; readonly workspaceRoot: string }) => void,
  onLockLeft: () => void = () => undefined,
): Assemble {
  const assemble = createAssemble({ parentEnv: parentEnv as NodeJS.ProcessEnv, platform, onAssembled });
  return async (input) => {
    const assembled = await assemble(input);
    if (!assembled.ok) return assembled;
    return {
      ...assembled,
      async finish(result) {
        const finished = await assembled.finish(result);
        // U-193: a lock left is told, never a reason to lose the run's result.
        if (typeof finished === "object" && finished !== null && finished.lockLeft === true) onLockLeft();
        return finished;
      },
    };
  };
}
