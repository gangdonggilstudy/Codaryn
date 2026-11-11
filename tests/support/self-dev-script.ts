/**
 * Scripts for the self-development rehearsal (tests/fixtures/self-dev.ts). The scripted model
 * changes the copied privacy module a little; the protected verifier decides. Steps take the
 * target's text as it was copied, so the scripts follow the repository without hard-coded hashes.
 */

import type { ScriptStep } from "../../src/contracts/index.js";
import { BENIGN_NOTE, REHEARSAL_TARGET, TYPE_ERROR_SNIPPET } from "../fixtures/self-dev.js";
import type { TamperMode } from "../fixtures/self-dev.js";
import { NODE } from "./cli.js";
import { callStep, finalStep, readStep, replaceAllStep } from "./repair-script.js";

export interface RehearsalTexts {
  readonly original: string;
  /** The target after the passing change (a comment appended). */
  readonly benign: string;
  /** The target after the failing change (a type error appended). */
  readonly broken: string;
}

export function rehearsalTexts(original: string): RehearsalTexts {
  return { original, benign: original + BENIGN_NOTE, broken: original + TYPE_ERROR_SNIPPET };
}

/** Read, make a comment-only change, claim completion. The protected verifier should pass. */
export function passingRehearsal(original: string): ScriptStep[] {
  const texts = rehearsalTexts(original);
  return [
    readStep("r-target", REHEARSAL_TARGET),
    replaceAllStep("w-benign", REHEARSAL_TARGET, texts.original, texts.benign),
    finalStep("주석을 하나 추가했다"),
  ];
}

/**
 * Read, introduce a type error, claim completion (the verifier fails), then answer the repair
 * request by replacing the error with the comment-only change and claim again (the verifier
 * passes). Needs `maxRepairAttempts` >= 1.
 */
export function repairRehearsal(original: string): ScriptStep[] {
  const texts = rehearsalTexts(original);
  return [
    readStep("r-target", REHEARSAL_TARGET),
    replaceAllStep("w-broken", REHEARSAL_TARGET, texts.original, texts.broken),
    finalStep("상수를 하나 추가했다"),
    replaceAllStep("w-repair", REHEARSAL_TARGET, texts.broken, texts.benign),
    finalStep("타입 오류를 고쳤다"),
  ];
}

/** `run_command node tamper.mjs <mode> <path>` (see TAMPER in tests/fixtures/self-dev.ts). */
export function tamperStep(id: string, mode: TamperMode, path: string): ScriptStep {
  return callStep(id, "run_command", { executable: NODE, args: ["tamper.mjs", mode, path] });
}
