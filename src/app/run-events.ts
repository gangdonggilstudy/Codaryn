/**
 * U-90 (gap survey, GUI 3.7 "records" tab; PM: implement the draft): one page of a run's stored
 * records for an adapter (`listRunEvents`, adapter-contract 5.13).
 *
 * - The run is judged first as the run list, `report` and `changes` judge it (the store's
 *   `inspectRun`, R-14 L-1): no entry of exactly that name is `run_not_found`, a damaged run is
 *   `invalid_run_record` and nothing of it is shown. A journal or result.json that is not a regular
 *   file, or is larger than MAX_REPORT_FILE_BYTES, is `invalid_run_record` too.
 * - The journal is read after the run, and commands allowed during a run can append lines to it
 *   (R-4 H-1). Each line is judged by its number (review R-80 M-1, PM's decisions):
 *   - A line of this run is a JSON object with this run's `runId` and a whole `seq` from 1. Any
 *     other line (broken, an array, another run's, no number) is skipped and the journal damaged.
 *   - A number given by two lines or more: neither is given (none is chosen as the real one), the
 *     number counts as missing, the journal is damaged.
 *   - A line at its place (the expected `seq`) counts, given or not, so the records after it
 *     follow. It is given when it has a real time (`at`, the store's `isRunTimestamp`), a type of
 *     the run's kind (a model run's JournalEventType, an apply's ApplyJournalEventType), field
 *     names that are plain words the masking leaves as they are, at most MAX_RECORD_DEPTH levels,
 *     and can be masked; else it is skipped (a registered value equal to a field name, say).
 *   - A larger number than expected: taken up from there; the numbers between are missing and
 *     the journal damaged. A smaller one (out of order) is skipped and the journal damaged.
 *   - The fields of each type are not checked one by one; everything in a record is masked and
 *     cleaned instead, and an adapter reads the fields as outside data.
 * - `status` is "damaged" when anything above damaged the journal, or when `report`'s own reading
 *   of the journal and result.json (summarizeJournal, readResult; their apply forms) refuses it, so
 *   a journal `report` refuses (invalid_run_record) is never "complete" here. The records taken and
 *   `missing` are given with it.
 * - An apply's `plan_item_started` (R-9 I-4) is taken (its number counts) but not given, as its
 *   events leave it out.
 * - Every record is masked again as an event is (DR-15): a model run's with `sanitizeRecord` (tool
 *   names limited), an apply's with `maskStrings`, both with the gateway of the values the settings
 *   register now; then the key shapes and every key value set now (`hideKeysInStrings`). A record
 *   that cannot be masked is skipped. Tokens are never restored.
 * - R-80 L-1: then every string is cleaned: CR LF as LF, control and bidirectional characters
 *   (`cleanText`, line feeds and tabs kept) and default ignorable characters shown as "?", the
 *   values of fields the contract does not know too (field names are plain words already).
 * - The unfinished last line of a run that is still going (no result.json) is left out uncounted;
 *   for a finished run it is counted in `skipped` and the journal is damaged.
 * - DR-38: a records-changed mark gives `recordsChanged: true` (the store's hasRecordsChangedMark;
 *   one that cannot be checked counts). The records are given all the same, as `report` shows them.
 * - Pages of at most MAX_RUN_EVENTS_PAGE records, cut before MAX_RUN_EVENTS_PAGE_BYTES of JSON; a
 *   larger record comes alone, so every page moves on.
 * - Reads only: no lock, no records, nothing sent. The whole journal is read and checked for each
 *   page, so `total` and `skipped` hold for every page of the same journal.
 */

import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { JOURNAL_FILE_NAME, MAX_REPORT_FILE_BYTES, RESULT_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../contracts/index.js";
import type { ApplyJournalEventType, JournalEventType, JournalRecord, PrivacyGateway } from "../contracts/index.js";
import { RUN_ID_PATTERN } from "../cli/args.js";
import { readApplyResult, readResult, summarizeApplyJournal, summarizeJournal } from "../cli/report.js";
import { REPLACEMENT, cleanText, hideKeys, hideKeysInStrings } from "../cli/text-safety.js";
import { hasRecordsChangedMark, inspectRun, isRunTimestamp } from "../store/index.js";
import type { RunInspection } from "../store/index.js";
import { createWorkspace } from "../workspace/index.js";
import { appError } from "./errors.js";
import { maskStrings, sanitizeRecord } from "./events.js";
import type { AppCallOutcome, AppError, RunEventType, RunEventsPage, StoredRunRecord } from "./types.js";

/** Records a page gives when the request names no limit. */
export const RUN_EVENTS_PAGE_SIZE = 200;
/** The most records one page gives. */
export const MAX_RUN_EVENTS_PAGE = 1000;
/** A page is cut before its records' JSON reaches this many UTF-8 bytes (a model request can be large). */
export const MAX_RUN_EVENTS_PAGE_BYTES = 2 * 1024 * 1024;
/** Deeper records are skipped (the journal's own records are a few levels deep). */
const MAX_RECORD_DEPTH = 64;
/** The contract's field names are plain camel-case words. */
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
/** R-80 L-1: invisible characters (zero width space and joiners, BOM, soft hyphen, fillers), shown as REPLACEMENT. */
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;
const CR_LF = /\r\n/g;

/** A model run's record types; the compiler checks the list against the contract's union. */
const RUN_TYPES = {
  run_started: true,
  model_request: true,
  model_response: true,
  model_error: true,
  tool_decision: true,
  tool_result: true,
  file_changed: true,
  verifier_result: true,
  repair_started: true,
  integrity_checked: true,
  state_checked: true,
  run_finished: true,
} as const satisfies Record<JournalEventType, true>;

/** An apply's shown record types; `plan_item_started` is taken but not given. */
const APPLY_TYPES = {
  apply_started: true,
  plan_checked: true,
  file_moved: true,
  file_discarded: true,
  plan_item_failed: true,
  verifier_result: true,
  integrity_checked: true,
  state_checked: true,
  run_finished: true,
} as const satisfies Record<ApplyJournalEventType, true>;
const PLAN_ITEM_STARTED = "plan_item_started";

/** Every record type a page can give, for the request's filter. */
export const RUN_EVENT_TYPES: readonly RunEventType[] = [...new Set<RunEventType>([...(Object.keys(RUN_TYPES) as JournalEventType[]), ...(Object.keys(APPLY_TYPES) as ApplyJournalEventType[])])];

const isOwn = (table: object, key: string): boolean => Object.prototype.hasOwnProperty.call(table, key);

/** The request's run, page and filter, checked before anything is read. */
export function runEventsArguments(
  request: unknown,
): { readonly ok: true; readonly runId: string; readonly offset: number; readonly limit: number; readonly types: ReadonlySet<string> | null } | { readonly ok: false; readonly error: AppError } {
  const refuse = (message: string) => ({ ok: false as const, error: appError("invalid_arguments", message) });
  if (typeof request !== "object" || request === null) return refuse("the request must be an object");
  const { runId, offset, limit, types } = request as { runId?: unknown; offset?: unknown; limit?: unknown; types?: unknown };
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId) || runId.includes("..")) {
    return refuse("the run id must be 1-128 characters of letters, digits, '.', '_' and '-'");
  }
  if (runId === "latest") return refuse('the run id must be a run\'s own id from the run list; "latest" is not taken');
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) return refuse("offset must be a whole number from 0");
  if (limit !== undefined && (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RUN_EVENTS_PAGE)) {
    return refuse(`limit must be a whole number from 1 to ${MAX_RUN_EVENTS_PAGE}`);
  }
  if (types !== undefined) {
    const known: readonly string[] = RUN_EVENT_TYPES;
    if (!Array.isArray(types) || types.length === 0 || types.length > known.length || !types.every((type) => typeof type === "string" && known.includes(type))) {
      return refuse("types must be a list of record type names (RUN_EVENT_TYPES), not empty");
    }
  }
  return { ok: true, runId, offset, limit: limit ?? RUN_EVENTS_PAGE_SIZE, types: types === undefined ? null : new Set(types as string[]) };
}

/** What the settings resolved to: the workspace and the masking. */
export interface RunEventsSource {
  readonly workspaceRoot: string;
  /** The gateway of the values the settings register now. */
  readonly privacy: PrivacyGateway;
  /** Every API key value set now (knownKeyValues). */
  readonly keys: readonly string[];
}

export interface RunEventsDeps {
  /** The store's run judgement (inspectRun). */
  readonly inspect?: (workspaceRoot: string, runId: string) => Promise<RunInspection>;
  /** The store's records-changed mark check (hasRecordsChangedMark). */
  readonly recordsChanged?: (workspaceRoot: string, runId: string) => Promise<boolean>;
  /** MAX_RUN_EVENTS_PAGE_BYTES unless given (tests). */
  readonly maxPageBytes?: number;
}

/** "file" (regular, not too large), "missing", or "bad". */
async function fileState(file: string): Promise<"file" | "missing" | "bad"> {
  try {
    const info = await lstat(file);
    return info.isFile() && info.size <= MAX_REPORT_FILE_BYTES ? "file" : "bad";
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "bad";
  }
}

/** Every field name, at every level, a plain word the masking leaves as it is; at most MAX_RECORD_DEPTH deep. */
function plainFields(value: unknown, privacy: PrivacyGateway, keys: readonly string[], depth = 0): boolean {
  if (typeof value !== "object" || value === null) return true;
  if (depth >= MAX_RECORD_DEPTH) return false;
  if (Array.isArray(value)) return value.every((item) => plainFields(item, privacy, keys, depth + 1));
  for (const [name, child] of Object.entries(value)) {
    if (!FIELD_NAME.test(name) || hideKeys(name, keys) !== name) return false;
    const masked = privacy.mask(name);
    if (!masked.ok || masked.text !== name) return false;
    if (!plainFields(child, privacy, keys, depth + 1)) return false;
  }
  return true;
}

/** R-80 L-1: every string of `value` cleaned for a person's screen; field names are plain words already. */
function cleanStrings<T>(value: T): T {
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") return cleanText(item.replace(CR_LF, "\n"), true).replace(INVISIBLE, REPLACEMENT);
    if (Array.isArray(item)) return item.map(walk);
    if (typeof item === "object" && item !== null) return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, walk(child)]));
    return item;
  };
  return walk(value) as T;
}

/** A line of this run (a JSON object with this run's id and a whole number from 1), or what else it is. */
function ownLine(line: string, runId: string): { readonly record: Record<string, unknown>; readonly seq: number } | "other" {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return "other";
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "other";
  const record = value as Record<string, unknown>;
  const seq = record["seq"];
  if (record["runId"] !== runId || typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) return "other";
  return { record, seq };
}

type Line = { readonly kind: "record"; readonly record: StoredRunRecord } | { readonly kind: "taken" } | { readonly kind: "skipped" };

/** A line at its place: the record to give, a record taken but not given, or one skipped. */
function readRecord(record: Record<string, unknown>, runKind: "run" | "apply", source: RunEventsSource): Line {
  const type = record["type"];
  if (!isRunTimestamp(record["at"]) || typeof type !== "string") return { kind: "skipped" };
  const table = runKind === "run" ? RUN_TYPES : APPLY_TYPES;
  const taken = runKind === "apply" && type === PLAN_ITEM_STARTED;
  if (!taken && !isOwn(table, type)) return { kind: "skipped" };
  try {
    if (!plainFields(record, source.privacy, source.keys)) return { kind: "skipped" };
    if (taken) return { kind: "taken" };
    const masked = runKind === "run" ? sanitizeRecord(record as unknown as JournalRecord, source.privacy) : maskStrings(record, source.privacy);
    if (masked === null) return { kind: "skipped" };
    return { kind: "record", record: cleanStrings(hideKeysInStrings(masked as unknown as StoredRunRecord, source.keys)) };
  } catch {
    // A record whose fields do not fit what the masking walks through is not given.
    return { kind: "skipped" };
  }
}

/** One page of `runId`'s records (arguments checked by runEventsArguments) in the workspace the settings resolved to. */
export async function listRunEventsIn(
  source: RunEventsSource,
  runId: string,
  offset: number,
  limit: number,
  types: ReadonlySet<string> | null,
  deps: RunEventsDeps = {},
): Promise<AppCallOutcome<RunEventsPage>> {
  let root: string;
  try {
    root = (await createWorkspace({ root: source.workspaceRoot })).root;
  } catch {
    return { ok: false, error: appError("workspace_not_found", "the workspace is not an existing directory") };
  }
  // R-14 L-1: judged as the run list judges it; nothing of a damaged run is shown.
  let judged: RunInspection;
  try {
    judged = await (deps.inspect ?? inspectRun)(root, runId);
  } catch {
    judged = "damaged";
  }
  if (judged === "missing") return { ok: false, error: appError("run_not_found", "the workspace has no records for that run id") };
  if (judged === "damaged") {
    return { ok: false, error: appError("invalid_run_record", "the run's records do not pass the checks (`codaryn runs` shows it as damaged); nothing is shown") };
  }

  const dir = path.join(root, STATE_DIR_NAME, RUNS_DIR_NAME, runId);
  const journalState = await fileState(path.join(dir, JOURNAL_FILE_NAME));
  const resultState = await fileState(path.join(dir, RESULT_FILE_NAME));
  if (journalState === "missing") return { ok: false, error: appError("run_not_found", "the workspace has no journal for that run id") };
  if (journalState === "bad" || resultState === "bad") {
    return { ok: false, error: appError("invalid_run_record", `a run file is not a regular file, cannot be read or is larger than ${MAX_REPORT_FILE_BYTES} bytes`) };
  }
  let recordsChanged: boolean;
  try {
    recordsChanged = await (deps.recordsChanged ?? hasRecordsChangedMark)(root, runId);
  } catch {
    recordsChanged = true;
  }
  let text: string;
  try {
    const bytes = await readFile(path.join(dir, JOURNAL_FILE_NAME));
    if (bytes.length > MAX_REPORT_FILE_BYTES) throw new Error("too large");
    text = bytes.toString("utf8");
  } catch {
    return { ok: false, error: appError("invalid_run_record", "the run's journal cannot be read") };
  }

  const complete = resultState === "file";
  const lines = text.split("\n");
  const tail = lines.pop() ?? "";
  // DR-12: the first record says which journal it is (inspectRun checked it).
  const runKind: "run" | "apply" = (() => {
    try {
      return (JSON.parse(lines[0] ?? "") as { type?: unknown }).type === "apply_started" ? "apply" : "run";
    } catch {
      return "run";
    }
  })();

  // R-80 M-1: each line by its number; a number two lines give is given by neither.
  const parsed = lines.map((line) => ownLine(line, runId));
  const given = new Map<number, number>();
  for (const item of parsed) if (item !== "other") given.set(item.seq, (given.get(item.seq) ?? 0) + 1);
  const passed: StoredRunRecord[] = [];
  let damaged = complete && tail.length > 0;
  let skipped = damaged ? 1 : 0;
  let expectedSeq = 1;
  /** Lines taken at their place, given or not, and the highest number seen at a place or doubled. */
  let placed = 0;
  let highest = 0;
  for (const item of parsed) {
    if (item === "other") {
      skipped += 1;
      damaged = true;
      continue;
    }
    if ((given.get(item.seq) ?? 0) > 1) {
      skipped += 1;
      damaged = true;
      highest = Math.max(highest, item.seq);
      continue;
    }
    if (item.seq < expectedSeq) {
      skipped += 1;
      damaged = true;
      continue;
    }
    // A larger number: taken up from here; the numbers between are missing.
    if (item.seq > expectedSeq) damaged = true;
    expectedSeq = item.seq + 1;
    placed += 1;
    highest = Math.max(highest, item.seq);
    const read = readRecord(item.record, runKind, source);
    if (read.kind === "skipped") {
      skipped += 1;
      continue;
    }
    if (read.kind === "record" && (types === null || types.has(read.record.type))) passed.push(read.record);
  }
  const missing = highest - placed;
  // A journal report refuses (invalid_run_record) is never complete here: report's own reading.
  if (!damaged) {
    try {
      const resultText = complete ? await readFile(path.join(dir, RESULT_FILE_NAME), "utf8") : null;
      if (runKind === "apply") {
        const summary = summarizeApplyJournal(text, runId, complete);
        if (resultText !== null) readApplyResult(resultText, runId, summary);
      } else {
        const summary = summarizeJournal(text, runId, complete);
        if (resultText !== null) readResult(resultText, runId, summary.taskId);
      }
    } catch {
      damaged = true;
    }
  }

  const start = Math.min(offset, passed.length);
  const records: StoredRunRecord[] = [];
  let bytes = 2; // "[" and "]"
  for (let index = start; index < passed.length && records.length < limit; index += 1) {
    const record = passed[index] as StoredRunRecord;
    const size = Buffer.byteLength(JSON.stringify(record), "utf8") + (records.length > 0 ? 1 : 0);
    if (records.length > 0 && bytes + size > (deps.maxPageBytes ?? MAX_RUN_EVENTS_PAGE_BYTES)) break;
    records.push(record);
    bytes += size;
  }
  const end = start + records.length;
  return {
    ok: true,
    output: {
      kind: "run_events",
      runId,
      runKind,
      status: damaged ? "damaged" : complete ? "complete" : "incomplete",
      ...(recordsChanged ? { recordsChanged: true as const } : {}),
      masking: "current_secrets",
      records,
      total: passed.length,
      skipped,
      missing,
      offset: start,
      nextOffset: end < passed.length ? end : null,
    },
  };
}
