/**
 * G-E: the human review record `<root>/.codaryn/runs/<runId>/review.json` (ReviewRecord, GT-D6).
 * `codaryn review` writes it under the workspace lock for a run that ended as
 * `needs-input`/`awaiting_review`; a later review replaces it. It never changes the run's
 * result.json or journal. The note arrives cleaned and masked by the caller; it is checked again
 * here and never sent to a model. Run directories that are links are not read or written through.
 */

import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

import { MAX_REVIEW_NOTE_CHARS, REVIEW_FILE_NAME, REVIEW_VERDICTS } from "../contracts/index.js";
import type { MaskedText, ReviewRecord, ReviewVerdict } from "../contracts/index.js";
import { assertRunId, errorCode, isOwnRunDir, replaceAtomically, runDir } from "./common.js";
import { isRunTimestamp } from "./runs.js";

/** Largest review.json read: the note is at most MAX_REVIEW_NOTE_CHARS. */
const REVIEW_RECORD_MAX_BYTES = 16 * 1024;

/** C0 and C1 controls, line and paragraph separators, bidirectional controls: the caller removes them. */
function hasControlCharacter(text: string): boolean {
  for (const char of text) {
    const cp = char.codePointAt(0) as number;
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029 || cp === 0x061c || cp === 0x200e || cp === 0x200f) return true;
    if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) return true;
  }
  return false;
}

/** The record in canonical form, or null when it fails a check. */
function checkedReview(value: unknown, runId: string): ReviewRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const { at, verdict, note } = record;
  if (record["schemaVersion"] !== 1 || record["kind"] !== "review_record" || record["runId"] !== runId) return null;
  if (!isRunTimestamp(at)) return null;
  if (typeof verdict !== "string" || !(REVIEW_VERDICTS as readonly string[]).includes(verdict)) return null;
  if (note !== null && (typeof note !== "string" || note.length > MAX_REVIEW_NOTE_CHARS || hasControlCharacter(note))) return null;
  return { schemaVersion: 1, kind: "review_record", runId, at, verdict: verdict as ReviewVerdict, note: note as MaskedText | null };
}

/**
 * The run's review record, or null when it has none. Rejects when one exists but cannot be read or
 * fails the checks, or when the run directory is a link.
 */
export async function readReviewRecord(workspaceRoot: string, runId: string): Promise<ReviewRecord | null> {
  assertRunId(runId);
  const dir = runDir(workspaceRoot, runId);
  if (!(await isOwnRunDir(workspaceRoot, runId))) throw new Error("the run directory is missing or a link; its review record is not read");
  return reviewRecordIn(dir, runId);
}

/**
 * U-129 (AXM-21): the review record in a run directory the caller has checked to be the run's own
 * plain directory (listRuns does), with readReviewRecord's checks: null when there is none; rejects
 * when one exists but cannot be read or fails the checks.
 */
export async function reviewRecordIn(dir: string, runId: string): Promise<ReviewRecord | null> {
  const file = join(dir, REVIEW_FILE_NAME);
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size > REVIEW_RECORD_MAX_BYTES) throw new Error("not a review record");
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw new Error("the run's review record cannot be read");
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error("the run's review record cannot be read");
  }
  const checked = checkedReview(value, runId);
  if (checked === null) throw new Error("the run's review record fails its checks");
  return checked;
}

/**
 * Writes review.json atomically, replacing an earlier review. The run directory must exist and be
 * plain; it is not created. A record that fails the checks rejects with TypeError before anything
 * is written.
 */
export async function writeReviewRecord(workspaceRoot: string, record: ReviewRecord): Promise<void> {
  assertRunId(record.runId);
  const checked = checkedReview(record, record.runId);
  if (checked === null) throw new TypeError("writeReviewRecord needs a valid ReviewRecord");
  const dir = runDir(workspaceRoot, record.runId);
  if (!(await isOwnRunDir(workspaceRoot, record.runId))) throw new Error("the run directory is missing or a link; no review record was written");
  await replaceAtomically(join(dir, REVIEW_FILE_NAME), `${JSON.stringify(checked)}\n`);
}
