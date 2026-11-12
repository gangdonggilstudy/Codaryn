/**
 * N-6, N-15 helpers for the validators (config.ts, task.ts): a schema field position as text, and
 * the known field name closest to an unknown one. Neither ever returns text read from the file:
 * a position shows only names in SCHEMA_FIELD_NAMES and indexes (anything else, profile names and
 * map keys included, as "?"), and the suggestion is a schema name from the known list. The unknown
 * name itself is never part of an answer (S-6, T-14, N-23(c)). Validators should still pass the
 * result through `toSchemaFieldPath` for a SchemaFieldPath. Line and column of a JSON syntax error
 * come from ./json-position.ts.
 */

import { SCHEMA_FIELD_NAMES } from "../../contracts/index.js";

export type FieldSegment = string | number;

/** Shown for the top level of a file (an empty position). */
export const TOP_LEVEL_POSITION = "(top level)";

/** Names longer than this are not compared (the comparison is quadratic). */
const MAX_COMPARED_NAME = 128;

const SCHEMA_NAMES: ReadonlySet<string> = new Set(SCHEMA_FIELD_NAMES);

/**
 * N-23(c): a field name of the task, config or script schema (SCHEMA_FIELD_NAMES). Anything else,
 * a profile name or a map key or an unknown key included, is not shown even if it looks like one.
 */
export function isFieldName(name: string): boolean {
  return SCHEMA_NAMES.has(name);
}

/** `limits.maxModelTurns`, `policy.commands[2].args`; an empty position is TOP_LEVEL_POSITION. */
export function fieldPath(position: readonly FieldSegment[]): string {
  if (position.length === 0) return TOP_LEVEL_POSITION;
  let out = "";
  for (const segment of position) {
    if (typeof segment === "number") {
      out += Number.isSafeInteger(segment) && segment >= 0 ? `[${segment}]` : "[?]";
    } else {
      out += `${out.length === 0 ? "" : "."}${isFieldName(segment) ? segment : "?"}`;
    }
  }
  return out;
}

/** Optimal string alignment distance (Levenshtein with adjacent transpositions). */
function editDistance(a: string, b: string): number {
  const cols = b.length + 1;
  const d: number[] = new Array<number>((a.length + 1) * cols).fill(0);
  const at = (i: number, j: number): number => d[i * cols + j] as number;
  for (let i = 0; i <= a.length; i += 1) d[i * cols] = i;
  for (let j = 0; j <= b.length; j += 1) d[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, at(i - 2, j - 2) + 1);
      d[i * cols + j] = value;
    }
  }
  return at(a.length, b.length);
}

/**
 * The known name closest to `name`, or null when none is close: case differences are free, then
 * at most 1 edit for names of 3-4 characters and 2 for longer ones. Ties go to the earlier entry.
 * Only an entry of `known` (a valid field name) is returned.
 */
export function closestKnownName(name: string, known: readonly string[]): string | null {
  if (name.length === 0 || name.length > MAX_COMPARED_NAME) return null;
  const lower = name.toLowerCase();
  const allowed = lower.length >= 5 ? 2 : lower.length >= 3 ? 1 : 0;
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of known) {
    if (candidate === name || !isFieldName(candidate)) continue;
    const distance = editDistance(lower, candidate.toLowerCase());
    if (distance <= allowed && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
