/**
 * U-66 (docs/design/standalone-gui.md 3.4): the side-by-side form of a line comparison. Pure: no
 * DOM. Each row has the old line on the left and the new line on the right. Unchanged lines stand
 * on both sides; in a run of changes, the removed lines and the added lines that follow them are
 * put side by side in order, and the longer side's rest stands against an empty cell. `hunk` marks
 * the first row of each run of changes (for next/previous change, F7), as hunkStarts does for the
 * one-column form.
 */

import type { DiffLine } from "./line-diff.js";

export interface SideRow {
  readonly left: DiffLine | null;
  readonly right: DiffLine | null;
  /** The first row of a run of changed lines. */
  readonly hunk: boolean;
}

export function sideBySide(lines: readonly DiffLine[]): SideRow[] {
  const rows: SideRow[] = [];
  let k = 0;
  while (k < lines.length) {
    const line = lines[k] as DiffLine;
    if (line.kind === "same") {
      rows.push({ left: line, right: line, hunk: false });
      k += 1;
      continue;
    }
    // A run of changes: its removed lines, then its added lines (lineDiff may interleave them, so
    // both are collected up to the next unchanged line, each kept in its own order).
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (k < lines.length && (lines[k] as DiffLine).kind !== "same") {
      const changed = lines[k] as DiffLine;
      (changed.kind === "removed" ? removed : added).push(changed);
      k += 1;
    }
    const height = Math.max(removed.length, added.length);
    for (let i = 0; i < height; i += 1) rows.push({ left: removed[i] ?? null, right: added[i] ?? null, hunk: i === 0 });
  }
  return rows;
}
