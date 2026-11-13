/**
 * The run's unreadable paths as the verifiers judge them: the same matcher as the policy gate's
 * (compilePathSet, prefix matching, a value that is not a list or an entry the format refuses covers
 * everything), on the real path. data_checks (U-223, U-258) and file_rules (U-276) use it.
 *
 * U-276 (Codex V-28 H1, PM decision): a verdict on a file under unreadable paths goes to the model in a
 * repair and tells it about the file (whether a guessed text is in it, whether it is there), so a file
 * rule on such a file is not compared: it is undecided with FILE_NOT_JUDGED_NOTE, and the verifier's
 * limits count such rules (fileRulesNotComparedLimit), as data_checks counts its own.
 */

import { compilePathSet } from "../policy/path-set.js";
import type { PathSet } from "../policy/path-set.js";

/** The matcher of a run's unreadable paths; absent or empty: null, and nothing changes. */
export function unreadablePathSet(value: unknown): PathSet | null {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) return null;
  return compilePathSet(Array.isArray(value) ? value : "not a list", { match: "prefix", onUnusable: "covers" });
}

/** U-276: why a file rule on a file under unreadable paths is not compared. */
export const FILE_NOT_JUDGED_NOTE = "not compared: a verdict on a file under unreadable paths would tell the model about it";

/** U-276: the file_rules verifier's limit when rules were not compared. */
export function fileRulesNotComparedLimit(count: number, rules: number): string {
  return `${count} of ${rules} rules were not compared: a file they check is under unreadable paths, and a verdict would tell the model about it`;
}
