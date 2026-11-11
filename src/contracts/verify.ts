/**
 * Verifiers decide the final status. A model's "done" never does.
 * Nothing here assumes Git or a test runner.
 */

import type { MaskedText, RawText } from "./text.js";

/** Runs a user-configured command without a shell. It is task configuration, not a model request. */
export interface CommandVerifierConfig {
  readonly id: string;
  readonly kind: "command";
  readonly executable: string;
  readonly args: readonly string[];
  /** Relative to the workspace root. Defaults to ".". */
  readonly cwd?: string;
  /** Defaults to DEFAULT_COMMAND_TIMEOUT_MS. */
  readonly timeoutMs?: number;
  /** Defaults to 0. */
  readonly expectExitCode?: number;
}

export type FileRule =
  | { readonly type: "exists"; readonly path: string }
  | { readonly type: "absent"; readonly path: string }
  | { readonly type: "contains"; readonly path: string; readonly text: string }
  | { readonly type: "not_contains"; readonly path: string; readonly text: string };

/** Checks files under the workspace root with literal rules. */
export interface FileRulesVerifierConfig {
  readonly id: string;
  readonly kind: "file_rules";
  /** At least one rule. */
  readonly rules: readonly FileRule[];
}

export type VerifierConfig = CommandVerifierConfig | FileRulesVerifierConfig;
export type VerifierKind = VerifierConfig["kind"];

/**
 * pass: every check held. fail: at least one check did not hold.
 * inconclusive: the verifier could not decide (timeout, could not start, unreadable file).
 */
export type VerifierOutcome = "pass" | "fail" | "inconclusive";

/**
 * Upper bound, in UTF-8 bytes, for the evidence of one verifier result as recorded and printed
 * (T-6). The engine cuts after masking, never the verifier on raw text.
 */
export const MAX_EVIDENCE_BYTES = 8192;

/** Local result. It must be masked before it is recorded or printed. */
export interface RawVerifierResult {
  readonly id: string;
  readonly kind: VerifierKind;
  readonly outcome: VerifierOutcome;
  /**
   * Raw evidence. A verifier does not cut it (T-6): command output is passed on as the command
   * runner captured it, up to MAX_COMMAND_OUTPUT_BYTES plus the runner's capture slack per stream.
   */
  readonly evidence: RawText;
  /**
   * True when the command runner dropped output beyond its capture, so `evidence` ends at an
   * arbitrary byte. The engine then masks, drops the trailing slack where a cut secret variant
   * could remain, and only then cuts to MAX_EVIDENCE_BYTES. Absent means false.
   */
  readonly evidenceTruncated?: boolean;
  /** What was checked. Required, at least one entry. */
  readonly checked: readonly string[];
  /** What this verifier does not check. Required. An empty list states "no known limits". */
  readonly limits: readonly string[];
}

export interface VerifierResult {
  readonly id: string;
  readonly kind: VerifierKind;
  readonly outcome: VerifierOutcome;
  readonly evidence: MaskedText;
  readonly checked: readonly MaskedText[];
  readonly limits: readonly MaskedText[];
}

export interface VerifierRunner {
  /** Runs one configured verifier. Never throws for verifier-level failures. */
  run(config: VerifierConfig, signal: AbortSignal): Promise<RawVerifierResult>;
}
