/**
 * Progress display (U-8): the CLI writes one masked line per event to stderr while stdout stays
 * one JSON line. These helpers read those lines and show that no fake secret, no listed variant
 * of one and no piece of one reaches stderr. The line format is the CLI's; nothing here parses it.
 */

import assert from "node:assert/strict";
import type { CliRun } from "./cli.js";
import { decodedSource, findFragments, findLeaks } from "./leak.js";
import type { TextSource } from "./leak.js";

/** Non-empty stderr lines, in order. */
export function progressLines(run: CliRun): string[] {
  return run.stderr.split(/\r?\n/).filter((line) => line.trim() !== "");
}

/** stderr as written, and with every JSON line (if a line is JSON) decoded. */
export function progressSources(run: CliRun): TextSource[] {
  return [{ label: "stderr", text: run.stderr }, decodedSource("stderr", run.stderr, true)];
}

export interface ProgressCheck {
  /** Raw values that must not appear, nor their listed variants (extended set). */
  readonly secrets: readonly string[];
  /** Secrets whose every piece of `fragmentLength` characters must be absent too. */
  readonly fragmentSecrets?: readonly string[];
  /** Defaults to 4, as in the record checks. */
  readonly fragmentLength?: number;
}

/** One line per finding; empty when stderr is clean. */
export function progressLeaks(run: CliRun, check: ProgressCheck): string[] {
  const sources = progressSources(run);
  const found = findLeaks(sources, check.secrets, { extended: true });
  for (const secret of check.fragmentSecrets ?? []) {
    found.push(...findFragments(sources, secret, check.fragmentLength ?? 4));
  }
  return found;
}

/**
 * stderr carries progress (at least `minLines` lines, so the check is not vacuous) and none of
 * it leaks. Use on runs where secrets were read, printed by commands and sent back in repairs.
 */
export function assertProgressClean(run: CliRun, check: ProgressCheck, minLines = 1): void {
  const lines = progressLines(run);
  assert.ok(lines.length >= minLines, `expected progress on stderr, got ${lines.length} line(s)`);
  assert.deepEqual(progressLeaks(run, check), [], "progress lines must be masked");
}

/** `--quiet`: nothing on stderr. */
export function assertQuiet(run: CliRun): void {
  assert.equal(run.stderr, "", "--quiet must leave stderr empty");
}
