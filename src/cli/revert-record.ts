/**
 * N-7: the revert record `<root>/.codaryn/runs/<runId>/revert.json` (RevertRecord). `revert`
 * writes it after a real revert, holding the lock; `listRuns` and the next revert read it.
 * N-16: a record is used only when it passes the checks (same run id, timestamp pattern, status);
 * anything else counts as no record. Writing never follows a link: when the run directory is not
 * a plain directory nothing is written. Writing is best effort and never changes the outcome.
 */

import { randomBytes } from "node:crypto";
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { REVERT_RECORD_FILE_NAME, RUN_TIMESTAMP_PATTERN_SOURCE, RUNS_DIR_NAME, STATE_DIR_NAME } from "../contracts/index.js";
import type { RevertRecord, RevertStatus } from "../contracts/index.js";

/** A revert record is a few hundred bytes; a larger file is not one. */
export const MAX_REVERT_RECORD_BYTES = 64 * 1024;

const TIMESTAMP = new RegExp(RUN_TIMESTAMP_PATTERN_SOURCE);

export function isRunTimestamp(value: unknown): value is string {
  return typeof value === "string" && TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

export function runDirectory(workspaceRoot: string, runId: string): string {
  return path.join(workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME, runId);
}

/** The checked parts of a revert record's text, or null when it is not a valid record of `runId`. */
export function parseRevertRecord(text: string, runId: string): { readonly at: string; readonly status: RevertStatus } | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record["schemaVersion"] !== 1 || record["kind"] !== "revert_record" || record["runId"] !== runId) return null;
  if (!isRunTimestamp(record["at"])) return null;
  const status = record["status"];
  if (status !== "complete" && status !== "partial") return null;
  return { at: record["at"], status };
}

/** The run's revert record, checked, or null. Never throws. */
export async function readRevertRecord(workspaceRoot: string, runId: string): Promise<{ readonly at: string; readonly status: RevertStatus } | null> {
  const file = path.join(runDirectory(workspaceRoot, runId), REVERT_RECORD_FILE_NAME);
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size > MAX_REVERT_RECORD_BYTES) return null;
    return parseRevertRecord(await readFile(file, "utf8"), runId);
  } catch {
    return null;
  }
}

/** Writes the record by a temporary file and a rename, only into a plain run directory. Never throws. */
export async function writeRevertRecord(workspaceRoot: string, record: RevertRecord): Promise<boolean> {
  const dir = runDirectory(workspaceRoot, record.runId);
  const temporary = path.join(dir, `${REVERT_RECORD_FILE_NAME}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const info = await lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink()) return false;
    await writeFile(temporary, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path.join(dir, REVERT_RECORD_FILE_NAME));
    return true;
  } catch {
    await rm(temporary, { force: true }).catch(() => {});
    return false;
  }
}
