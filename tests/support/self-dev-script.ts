/**
 * Scripts for the self-development rehearsal (tests/fixtures/self-dev.ts). The scripted model
 * changes one line of the copied privacy module; the protected verifier decides. Edits are built
 * from the target's text as copied, so the scripts follow the repository without fixed hashes;
 * `fileEdit` throws when the anchor line is no longer there exactly once.
 */

import type { ScriptStep } from "../../src/contracts/index.js";
import { fileEdit } from "../fixtures/repair-project.js";
import type { FileEdit } from "../fixtures/repair-project.js";
import { REHEARSAL_ANCHOR, REHEARSAL_BENIGN_LINE, REHEARSAL_BROKEN_LINE, REHEARSAL_TARGET } from "../fixtures/self-dev.js";
import type { TamperMode } from "../fixtures/self-dev.js";
import { NODE } from "./cli.js";
import { callStep, editStep, finalStep, readStep } from "./repair-script.js";

export interface RehearsalEdits {
  /** Anchor line → the same line with a comment. */
  readonly benign: FileEdit;
  /** Anchor line → a type error. */
  readonly broken: FileEdit;
  /** The type error → the commented line, so `repair.after === benign.after`. */
  readonly repair: FileEdit;
}

export function rehearsalEdits(original: string): RehearsalEdits {
  const benign = fileEdit(REHEARSAL_TARGET, original, REHEARSAL_ANCHOR, REHEARSAL_BENIGN_LINE);
  const broken = fileEdit(REHEARSAL_TARGET, original, REHEARSAL_ANCHOR, REHEARSAL_BROKEN_LINE);
  const repair = fileEdit(REHEARSAL_TARGET, broken.after, REHEARSAL_BROKEN_LINE, REHEARSAL_BENIGN_LINE);
  return { benign, broken, repair };
}

export interface RehearsalTexts {
  readonly original: string;
  /** The target after the passing change. */
  readonly benign: string;
  /** The target after the failing change. */
  readonly broken: string;
}

export function rehearsalTexts(original: string): RehearsalTexts {
  const edits = rehearsalEdits(original);
  return { original, benign: edits.benign.after, broken: edits.broken.after };
}

/** Read, make a comment-only change, claim completion. The protected verifier should pass. */
export function passingRehearsal(original: string): ScriptStep[] {
  return [readStep("r-target", REHEARSAL_TARGET), editStep("w-benign", rehearsalEdits(original).benign), finalStep("주석을 하나 추가했다")];
}

/**
 * Read, introduce a type error, claim completion (the verifier fails), then answer the repair
 * request by replacing the error with the comment-only change and claim again (the verifier
 * passes). Needs `maxRepairAttempts` >= 1.
 */
export function repairRehearsal(original: string): ScriptStep[] {
  const edits = rehearsalEdits(original);
  return [
    readStep("r-target", REHEARSAL_TARGET),
    editStep("w-broken", edits.broken),
    finalStep("상수 형을 적었다"),
    editStep("w-repair", edits.repair),
    finalStep("타입 오류를 고쳤다"),
  ];
}

/** `run_command node tamper.mjs <mode> <path>` (see TAMPER in tests/fixtures/self-dev.ts). */
export function tamperStep(id: string, mode: TamperMode, path: string): ScriptStep {
  return callStep(id, "run_command", { executable: NODE, args: ["tamper.mjs", mode, path] });
}
