/**
 * DR-29 (docs/design/standalone-gui.md 3.4, 7, 8): a line comparison of two texts the app layer
 * already masked. Pure: no DOM, so unit tests run it under Node, and no new dependency.
 * - Lines are split at LF (the engine host turned CRLF into LF).
 * - The common start and end are kept; the middle is compared by the longest common subsequence.
 *   When the middle is too large to compare in a reasonable time and memory (MAX_CELLS), its old
 *   lines are listed as removed and its new lines as added: still correct, not minimal.
 * - A created file (no before) is all added; a file that is gone (no after) all removed.
 */

export type DiffKind = "same" | "removed" | "added";

export interface DiffLine {
  readonly kind: DiffKind;
  /** 1-based line number in the old text, or null for an added line. */
  readonly oldNo: number | null;
  /** 1-based line number in the new text, or null for a removed line. */
  readonly newNo: number | null;
  readonly text: string;
}

/** Most cells of the comparison table for the middle part (4 bytes each). */
export const MAX_CELLS = 4_000_000;

export function splitLines(text: string | null): string[] {
  if (text === null || text.length === 0) return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function lineDiff(before: string | null, after: string | null): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const out: DiffLine[] = [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    out.push({ kind: "same", oldNo: start + 1, newNo: start + 1, text: a[start] as string });
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const n = endA - start;
  const m = endB - start;
  if (n > 0 && m > 0 && (n + 1) * (m + 1) <= MAX_CELLS) {
    // lcs[i][j]: the longest common subsequence of a[start+i..endA) and b[start+j..endB).
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        lcs[i * width + j] =
          a[start + i] === b[start + j] ? (lcs[(i + 1) * width + j + 1] as number) + 1 : Math.max(lcs[(i + 1) * width + j] as number, lcs[i * width + j + 1] as number);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        out.push({ kind: "same", oldNo: start + i + 1, newNo: start + j + 1, text: a[start + i] as string });
        i += 1;
        j += 1;
      } else if ((lcs[(i + 1) * width + j] as number) >= (lcs[i * width + j + 1] as number)) {
        out.push({ kind: "removed", oldNo: start + i + 1, newNo: null, text: a[start + i] as string });
        i += 1;
      } else {
        out.push({ kind: "added", oldNo: null, newNo: start + j + 1, text: b[start + j] as string });
        j += 1;
      }
    }
    for (; i < n; i += 1) out.push({ kind: "removed", oldNo: start + i + 1, newNo: null, text: a[start + i] as string });
    for (; j < m; j += 1) out.push({ kind: "added", oldNo: null, newNo: start + j + 1, text: b[start + j] as string });
  } else {
    for (let i = start; i < endA; i += 1) out.push({ kind: "removed", oldNo: i + 1, newNo: null, text: a[i] as string });
    for (let j = start; j < endB; j += 1) out.push({ kind: "added", oldNo: null, newNo: j + 1, text: b[j] as string });
  }
  for (let k = 0; endA + k < a.length; k += 1) out.push({ kind: "same", oldNo: endA + k + 1, newNo: endB + k + 1, text: a[endA + k] as string });
  return out;
}

/** The index of the first line of each run of changed lines (for next/previous change, F7). */
export function hunkStarts(lines: readonly DiffLine[]): number[] {
  const starts: number[] = [];
  for (let k = 0; k < lines.length; k += 1) {
    if ((lines[k] as DiffLine).kind !== "same" && (k === 0 || (lines[k - 1] as DiffLine).kind === "same")) starts.push(k);
  }
  return starts;
}
