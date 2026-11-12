/**
 * Run list (N-7): `listRuns` (ListRuns in src/contracts/commands.ts) for `codaryn runs` and
 * `--run latest`, and the revert record (`RevertRecord`, REVERT_RECORD_FILE_NAME) that marks a
 * run as reverted.
 *
 * `listRuns` reads only the state directory: per run the first journal record, result.json and
 * the revert record. It creates, writes and locks nothing, and never opens snapshots. Links are
 * not followed: a link in place of `.codaryn`, `runs` or a run directory could lead the list to
 * records of another place. A run whose records fail a check is listed as `damaged` with its id
 * only (N-16), and is never `latest`.
 */

import { realpath as realpathCallback } from "node:fs";
import { lstat, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  JOURNAL_FILE_NAME,
  MAX_REPORT_FILE_BYTES,
  RESULT_FILE_NAME,
  REVERT_RECORD_FILE_NAME,
  CONTENT_HASH_PATTERN_SOURCE,
  RUN_EXIT_CODES,
  RUN_TIMESTAMP_PATTERN_SOURCE,
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
  TASK_ID_PATTERN_SOURCE,
  TERMINAL_RUN_STATUSES,
  toRunId,
} from "../contracts/index.js";
import type {
  ListRuns,
  RevertRecord,
  RunListEntry,
  RunListing,
  RunReason,
  RunReasonByStatus,
  RunId,
  TerminalRunStatus,
} from "../contracts/index.js";
import { assertRunId, errorCode, runDir } from "./common.js";

const realpathNative = promisify(realpathCallback.native);

const TASK_ID = new RegExp(TASK_ID_PATTERN_SOURCE);
const HASH = new RegExp(CONTENT_HASH_PATTERN_SOURCE);
const PROVIDERS: readonly string[] = ["scripted", "anthropic"];
const RUN_TIMESTAMP = new RegExp(RUN_TIMESTAMP_PATTERN_SOURCE);
/** A run id as the CLI makes it (P-3): `<UTC yyyymmddThhmmssZ>-<8 lowercase hex>`. */
const CLI_RUN_ID = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-[0-9a-f]{8}$/;
/** The first journal record is read up to this many bytes. A longer first line is unreadable. */
const FIRST_RECORD_MAX_BYTES = 64 * 1024;
/** Largest revert record read. It holds a few short fields. */
const REVERT_RECORD_MAX_BYTES = 4 * 1024;

/** Every reason, per status (as report.ts checks them). */
const REASONS: { readonly [S in TerminalRunStatus]: readonly RunReasonByStatus[S][] } = {
  done: ["verified"],
  failed: ["verifier_failed", "model_error", "repeated_failure"],
  "needs-input": ["verifier_inconclusive", "no_verifier", "unknown_tool_outcome", "protected_changed"],
  cancelled: ["cancelled"],
  "budget-exhausted": ["max_model_turns", "max_tool_calls", "max_total_tokens", "max_duration", "usage_unknown"],
};

/** The run records directory cannot be listed. The message names no path and no content. */
export class RunListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunListError";
  }
}

/** A record failed a check: the run is listed as damaged. */
class Unreadable extends Error {}

function unreadable(): never {
  throw new Unreadable();
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A run directory name (the contract's RunId rule). */
export function isStoredRunId(name: string): boolean {
  return toRunId(name) !== null;
}

/**
 * N-24(c): a recorded time in RUN_TIMESTAMP_PATTERN_SOURCE form that names a real UTC instant.
 * `Date` carries impossible dates over (2026-02-30 becomes 2026-03-02), so the text must equal
 * `toISOString` of what it parses to, with the milliseconds written out to three digits.
 */
export function isRunTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !RUN_TIMESTAMP.test(value)) return false;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  const dot = value.indexOf(".");
  const full = dot < 0 ? `${value.slice(0, -1)}.000Z` : `${value.slice(0, dot + 1)}${value.slice(dot + 1, -1).padEnd(3, "0")}Z`;
  return new Date(time).toISOString() === full;
}

/** A timestamp as recorded, when it is a real one (`isRunTimestamp`). */
function timestamp(value: unknown): string | null {
  return isRunTimestamp(value) ? value : null;
}

function sameFsPath(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** A regular file no larger than `max` bytes; "missing" when there is none. Anything else is unreadable. */
async function checkedFile(file: string, max: number): Promise<"file" | "missing"> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size > max) unreadable();
    return "file";
  } catch (error) {
    if (error instanceof Unreadable) throw error;
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return "missing";
    return unreadable();
  }
}

async function readText(file: string, max: number): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch {
    return unreadable();
  }
  if (bytes.length > max) unreadable();
  return bytes.toString("utf8");
}

function parseObject(text: string): Obj {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return unreadable();
  }
  return isObj(value) ? value : unreadable();
}

/**
 * The journal's first record: `startedAt` and `taskId`. A first line that is not complete (still
 * being written) or is not this run's `run_started` makes the run damaged.
 */
async function firstRecord(file: string, runId: string): Promise<{ startedAt: string; taskId: string }> {
  if ((await checkedFile(file, MAX_REPORT_FILE_BYTES)) === "missing") unreadable();
  const handle = await open(file, "r").catch(() => unreadable());
  let text: string;
  try {
    const buffer = Buffer.alloc(FIRST_RECORD_MAX_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    text = buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return unreadable();
  } finally {
    await handle.close().catch(() => undefined);
  }
  const end = text.indexOf("\n");
  if (end < 0) unreadable();
  const record = parseObject(text.slice(0, end));
  if (record["runId"] !== runId || record["seq"] !== 1 || record["type"] !== "run_started" || record["schemaVersion"] !== 1) unreadable();
  if (typeof record["provider"] !== "string" || !PROVIDERS.includes(record["provider"])) unreadable();
  const taskId = record["taskId"];
  if (typeof taskId !== "string" || !TASK_ID.test(taskId)) unreadable();
  const startedAt = timestamp(record["at"]);
  if (startedAt === null) unreadable();
  return { startedAt, taskId: taskId as string };
}

/** Status, reason and change count from result.json, or nulls when the run has none. */
async function resultOf(
  file: string,
  runId: string,
  taskId: string,
): Promise<{ status: TerminalRunStatus | null; reason: RunReason | null; changes: number | null }> {
  if ((await checkedFile(file, MAX_REPORT_FILE_BYTES)) === "missing") return { status: null, reason: null, changes: null };
  const result = parseObject(await readText(file, MAX_REPORT_FILE_BYTES));
  if (result["schemaVersion"] !== 1 || result["kind"] !== "run" || result["runId"] !== runId) unreadable();
  if (result["taskId"] !== taskId) unreadable();
  const status = result["status"];
  if (typeof status !== "string" || !(TERMINAL_RUN_STATUSES as readonly string[]).includes(status)) unreadable();
  const reason = result["reason"];
  const reasons = REASONS[status as TerminalRunStatus] as readonly string[];
  if (typeof reason !== "string" || !reasons.includes(reason)) unreadable();
  if (result["exitCode"] !== RUN_EXIT_CODES[status as TerminalRunStatus]) unreadable();
  if (typeof result["provider"] !== "string" || !PROVIDERS.includes(result["provider"])) unreadable();
  const changes = result["changes"];
  if (!Array.isArray(changes) || !changes.every(isChangeRecord)) unreadable();
  return { status: status as TerminalRunStatus, reason: reason as RunReason, changes: changes.length };
}

/** A FileChangeRecord as result.json holds it (report.ts checks the same fields). */
function isChangeRecord(value: unknown): boolean {
  if (!isObj(value)) return false;
  const previous = value["previousHash"];
  return (
    typeof value["path"] === "string" &&
    typeof value["created"] === "boolean" &&
    typeof value["newHash"] === "string" &&
    HASH.test(value["newHash"]) &&
    (previous === null || (typeof previous === "string" && HASH.test(previous)))
  );
}

function parseRevertRecord(record: Obj, runId: string): RevertRecord {
  const count = (value: unknown): number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : unreadable();
  if (record["schemaVersion"] !== 1 || record["kind"] !== "revert_record" || record["runId"] !== runId) unreadable();
  const at = timestamp(record["at"]);
  const status = record["status"];
  if (at === null || (status !== "complete" && status !== "partial")) unreadable();
  return { schemaVersion: 1, kind: "revert_record", runId, at, status, reverted: count(record["reverted"]), skipped: count(record["skipped"]) };
}

async function revertRecordAt(file: string, runId: string): Promise<RevertRecord | null> {
  if ((await checkedFile(file, REVERT_RECORD_MAX_BYTES)) === "missing") return null;
  return parseRevertRecord(parseObject(await readText(file, REVERT_RECORD_MAX_BYTES)), runId);
}

type CheckedRun = Extract<RunListEntry, { readonly state: "checked" }>;

/** The UTC second a CLI run id names, in milliseconds, or null for any other id or an impossible date. */
export function runIdSecond(runId: string): number | null {
  const match = CLI_RUN_ID.exec(runId);
  if (match === null) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [number, number, number, number, number, number];
  const time = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(time);
  const same =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;
  return same ? time : null;
}

/**
 * How long after the run id's second the first record may be written. The CLI reads the clock for
 * the run id, then sets up the workspace, the lock and the model before the engine writes
 * `run_started` with a second reading, so the two can fall into different seconds.
 */
export const RUN_START_TOLERANCE_MS = 10 * 60 * 1000;

/**
 * N-23(b): the start time must agree with the run id (not before its second, at most
 * RUN_START_TOLERANCE_MS after it) and must not lie in the future. A run that fails either was
 * not written by a run as recorded, so it is damaged and never `latest`.
 */
function checkStartTime(runId: string, startedAt: string, now: number): void {
  const second = runIdSecond(runId);
  const started = Date.parse(startedAt);
  if (second === null || started < second || started >= second + RUN_START_TOLERANCE_MS || started > now) unreadable();
}

async function readEntry(dir: string, runId: RunId, now: number): Promise<CheckedRun> {
  const { startedAt, taskId } = await firstRecord(join(dir, JOURNAL_FILE_NAME), runId);
  checkStartTime(runId, startedAt, now);
  const { status, reason, changes } = await resultOf(join(dir, RESULT_FILE_NAME), runId, taskId);
  // N-23(g): the revert record only marks a reverted run. One that fails its checks takes the
  // mark away, not the run: the run stays checked and can still be reported and reverted.
  const record = await revertRecordAt(join(dir, REVERT_RECORD_FILE_NAME), runId).catch(() => null);
  return {
    state: "checked",
    runId,
    startedAt,
    taskId,
    status,
    reason,
    changes,
    reverted: record === null ? null : { at: record.at, status: record.status },
  };
}

/** Newest first by start time, then by run id, both descending. */
function newestFirst(a: CheckedRun, b: CheckedRun): number {
  const difference = Date.parse(b.startedAt) - Date.parse(a.startedAt);
  if (difference !== 0) return difference;
  return a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0;
}

/**
 * See ListRuns: checked runs newest first, then damaged runs by run id, descending.
 * `workspaceRoot` is the real absolute path of the root. A workspace without `.codaryn/runs` has
 * no runs. Rejects with RunListError when that directory exists but cannot be listed, or when it
 * (or `.codaryn`) is a link.
 */
export const listRuns: ListRuns = (request) => listRunsAt(request, Date.now());

/** `listRuns` with the current time given, in milliseconds (start times after it are damaged). */
export async function listRunsAt(request: { readonly workspaceRoot: string }, now: number): Promise<RunListing> {
  const runsDir = join(request.workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME);
  let real: string;
  try {
    real = await realpathNative(runsDir);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return { runs: [] };
    throw new RunListError("the run records directory cannot be read");
  }
  if (!sameFsPath(real, runsDir)) {
    throw new RunListError("the run records directory is a link; only the workspace's own records are listed");
  }
  let entries;
  try {
    if (!(await lstat(runsDir)).isDirectory()) throw new Error("not a directory");
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch {
    throw new RunListError("the run records directory cannot be read");
  }

  const checked: CheckedRun[] = [];
  const damaged: RunId[] = [];
  for (const entry of entries) {
    const runId = toRunId(entry.name);
    if (runId === null) continue;
    if (!entry.isDirectory()) {
      damaged.push(runId);
      continue;
    }
    try {
      checked.push(await readEntry(join(runsDir, entry.name), runId, now));
    } catch {
      damaged.push(runId);
    }
  }
  damaged.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const listing: RunListing = {
    runs: [...checked.sort(newestFirst), ...damaged.map((runId) => ({ state: "damaged" as const, runId }))],
  };
  return listing;
}

/** The id `--run latest` stands for (see `latestRun`), or null when there is none. */
export async function latestRunId(workspaceRoot: string): Promise<RunId | null> {
  return latestRun((await listRuns({ workspaceRoot })).runs)?.runId ?? null;
}

/**
 * The run `--run latest` names in a listing: the first checked run that has a result (N-23(b)).
 * A run without result.json (running, or stopped without one) is listed but never chosen.
 */
export function latestRun(runs: readonly RunListEntry[]): CheckedRun | null {
  for (const run of runs) {
    if (run.state === "checked" && run.status !== null) return run;
  }
  return null;
}

/**
 * The run's revert record, null when it has none. Rejects when one exists but cannot be read or
 * fails its checks. `revert` reads it before reverting to fill `RevertOutput.revertedBefore`.
 */
export async function readRevertRecord(workspaceRoot: string, runId: string): Promise<RevertRecord | null> {
  assertRunId(runId);
  const dir = runDir(workspaceRoot, runId);
  if (!(await isPlainDirectory(dir))) throw new RunListError("the run directory is missing or a link; its revert record is not read");
  try {
    return await revertRecordAt(join(dir, REVERT_RECORD_FILE_NAME), runId);
  } catch {
    throw new RunListError("the run's revert record cannot be read");
  }
}

/**
 * The directory exists and is the workspace's own: not a link or junction (as `listRuns` sees run
 * directories), so a record is never read from or written to another place.
 */
async function isPlainDirectory(dir: string): Promise<boolean> {
  try {
    const info = await lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink()) return false;
    return sameFsPath(await realpathNative(dir), dir);
  } catch {
    return false;
  }
}

/**
 * Writes `<root>/.codaryn/runs/<runId>/revert.json` atomically, replacing an earlier record.
 * `revert` calls it after `revertRun` (not a dry run) returned, while it still holds the lock.
 * The run directory must exist (the run has a journal) and be a plain directory; it is not
 * created, and a link or junction in its place is refused with RunListError, nothing written.
 */
export async function writeRevertRecord(workspaceRoot: string, record: RevertRecord): Promise<void> {
  assertRunId(record.runId);
  let checked: RevertRecord;
  try {
    checked = parseRevertRecord(record as unknown as Obj, record.runId);
  } catch {
    throw new TypeError("writeRevertRecord needs a valid RevertRecord");
  }
  const dir = runDir(workspaceRoot, record.runId);
  if (!(await isPlainDirectory(dir))) throw new RunListError("the run directory is missing or a link; no revert record was written");
  const target = join(dir, REVERT_RECORD_FILE_NAME);
  const temporary = `${target}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(checked)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
