/**
 * G-E: the stored plan of a plan run and its claim by an apply run (src/contracts/plan.ts).
 *
 * - `<root>/.codaryn/runs/<plan runId>/plan.json` (StoredPlan): the actions and their source
 *   hashes, nothing else (DR-5). Written once by `createPlanRecorder`; its bytes' SHA-256 is the
 *   digest a person approves.
 * - `<root>/.codaryn/runs/<plan runId>/applied.json` (PlanAppliedRecord): created exclusively by
 *   `markPlanApplied`, so a plan is applied at most once.
 * - `loadPlan` reads both for `plan` and `apply`; it changes nothing.
 * - U-181 (DR-69 B-1, B-3, B-7): plan.json of a `run` plan (StoredChangesPlan, `kind: "changes"`),
 *   written once by the same recorder's `saveChangesPlan` under the same digest rule (the summary is
 *   in the bytes, so the digest covers it); `loadAnyPlan` reads either kind, told apart by `kind`, and
 *   `loadPlan` still refuses a `run` plan. The run that carries such a plan out claims it with the
 *   same applied.json, once.
 *
 * plan.json is raw local text like the snapshots (R-8): paths as the workspace resolved them. It is
 * never sent to a model and is shown only masked again. Run directories that are links are not
 * read or written through.
 */

import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  CONTENT_HASH_PATTERN_SOURCE,
  JOURNAL_FILE_NAME,
  MAX_PLAN_ACTIONS,
  MAX_PLAN_SUMMARY_CHARS,
  MAX_PLANNED_FILES,
  MAX_REPORT_FILE_BYTES,
  PLAN_APPLIED_FILE_NAME,
  PLAN_FILE_NAME,
  RESULT_FILE_NAME,
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
  toRunId,
} from "../contracts/index.js";
import type {
  AnyStoredPlan,
  ContentHash,
  CreatePlanRecorder,
  LoadAnyPlan,
  LoadPlan,
  LoadPlanOutcome,
  MaskedParts,
  PlanAppliedRecord,
  StoredChangesPlan,
  StoredPlan,
  StoredPlanAction,
  StoredPlannedFile,
} from "../contracts/index.js";
import {
  assertRunId,
  createExclusive,
  ensureRunDir,
  errorCode,
  hasExactRunEntry,
  isOwnRunDir,
  isPlainDirectory,
  maskedPartsOf as sharedMaskedPartsOf,
  runDir,
  sha256Hex,
} from "./common.js";
import { isRunTimestamp } from "./runs.js";
import type { RunWriteNotes } from "./run-writes.js";
import { isStateDirName, isValidPathInput } from "../workspace/lexical.js";

const CONTENT_HASH = new RegExp(CONTENT_HASH_PATTERN_SOURCE);
/** DR-28: bounds for one path's visible parts (a stored path has at most 4096 characters). */
const MAX_SHOWN_PARTS = 4097;
const MAX_SHOWN_TEXT = 8192;
/**
 * U-181: bounds for a `run` plan's summary as visible parts. The tool takes at most
 * MAX_PLAN_SUMMARY_CHARS UTF-16 units and masking only takes text out (the tokens), so the parts
 * are at most one more than that; the text bound is the plan view's for a masked summary.
 */
const MAX_SUMMARY_PARTS = MAX_PLAN_SUMMARY_CHARS + 1;
const MAX_SUMMARY_TEXT = MAX_PLAN_SUMMARY_CHARS * 4;

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Obj, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * A path relative to the workspace root as `Workspace.resolve` gives it: `/` separated, no empty,
 * `.` or `..` segment, no backslash, not absolute, not inside the state directory.
 */
export function isWorkspaceRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) return false;
  if (value.includes("\\") || value.includes("\u0000") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return false;
  // DR-24 (d): the workspace's own rules too (device names, streams, trailing dots and spaces on
  // Windows), so a stored path is one Workspace.resolve would accept.
  return isValidPathInput(value) && !isStateDirName(segments[0] as string);
}

/**
 * DR-28: one path as the plan run masked it, as visible parts (MaskedParts): at least one string,
 * none holding a privacy token (the text was split at the tokens). Null for anything else.
 */
function maskedPartsOf(value: unknown): MaskedParts | null {
  return sharedMaskedPartsOf(value, MAX_SHOWN_PARTS, MAX_SHOWN_TEXT);
}

/** The keys of an action, without or (DR-28) with its masked form `shown`. */
function hasActionKeys(value: Obj, keys: readonly string[]): boolean {
  return hasExactKeys(value, keys) || hasExactKeys(value, [...keys, "shown"]);
}

/**
 * One action in canonical form (fixed key order), or null when it is not a resolved action. DR-28:
 * `shown`, when present, has exactly the action's path keys, each as visible parts.
 */
function canonicalAction(value: unknown): StoredPlanAction | null {
  if (!isObj(value)) return null;
  const sha256 = value["sha256"];
  if (typeof sha256 !== "string" || !CONTENT_HASH.test(sha256)) return null;
  const hash = sha256 as ContentHash;
  const shown = value["shown"];
  const hasShown = Object.hasOwn(value, "shown");
  if (hasShown && !isObj(shown)) return null;
  if (value["kind"] === "move" && hasActionKeys(value, ["kind", "from", "to", "sha256"])) {
    const { from, to } = value;
    if (!isWorkspaceRelativePath(from) || !isWorkspaceRelativePath(to)) return null;
    if (!hasShown) return { kind: "move", from, to, sha256: hash };
    const parts = shown as Obj;
    const shownFrom = hasExactKeys(parts, ["from", "to"]) ? maskedPartsOf(parts["from"]) : null;
    const shownTo = hasExactKeys(parts, ["from", "to"]) ? maskedPartsOf(parts["to"]) : null;
    return shownFrom !== null && shownTo !== null ? { kind: "move", from, to, sha256: hash, shown: { from: shownFrom, to: shownTo } } : null;
  }
  if (value["kind"] === "discard" && hasActionKeys(value, ["kind", "path", "sha256"])) {
    const { path } = value;
    if (!isWorkspaceRelativePath(path)) return null;
    if (!hasShown) return { kind: "discard", path, sha256: hash };
    const parts = shown as Obj;
    const shownPath = hasExactKeys(parts, ["path"]) ? maskedPartsOf(parts["path"]) : null;
    return shownPath !== null ? { kind: "discard", path, sha256: hash, shown: { path: shownPath } } : null;
  }
  return null;
}

/**
 * The actions in canonical form, or null when any is not a resolved action or the count is out of
 * range. DR-28: each keeps its masked form (`shown`) when it has one; a plan written before DR-28
 * has none.
 */
export function canonicalActions(value: unknown): StoredPlanAction[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PLAN_ACTIONS) return null;
  const actions: StoredPlanAction[] = [];
  for (const item of value) {
    const action = canonicalAction(item);
    if (action === null) return null;
    actions.push(action);
  }
  return actions;
}

/**
 * U-181 (B-1): one planned file in canonical form (path, change, sha256, shown), or null. Exactly
 * those keys; the path passes the same lexical rules as an action's (DR-24 d); `create` has a null
 * hash and `modify` a SHA-256; `shown` is the path's visible parts (DR-28), always present.
 */
function canonicalPlannedFile(value: unknown): StoredPlannedFile | null {
  if (!isObj(value) || !hasExactKeys(value, ["path", "change", "sha256", "shown"])) return null;
  const { path, change, sha256 } = value;
  if (!isWorkspaceRelativePath(path)) return null;
  const shown = maskedPartsOf(value["shown"]);
  if (shown === null) return null;
  if (change === "create" && sha256 === null) return { path, change, sha256: null, shown };
  if (change === "modify" && typeof sha256 === "string" && CONTENT_HASH.test(sha256)) return { path, change, sha256: sha256 as ContentHash, shown };
  return null;
}

/**
 * U-181 (B-1, B-5): the planned files in canonical form, or null when any is not a planned file,
 * a path is listed twice, or the count is not 1 to MAX_PLANNED_FILES.
 */
export function canonicalPlannedFiles(value: unknown): StoredPlannedFile[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PLANNED_FILES) return null;
  const files: StoredPlannedFile[] = [];
  const paths = new Set<string>();
  for (const item of value) {
    const file = canonicalPlannedFile(item);
    if (file === null || paths.has(file.path)) return null;
    paths.add(file.path);
    files.push(file);
  }
  return files;
}

/** U-181 (B-1): a `run` plan's summary as the plan run masked it (visible parts), or null. */
function summaryPartsOf(value: unknown): MaskedParts | null {
  return sharedMaskedPartsOf(value, MAX_SUMMARY_PARTS, MAX_SUMMARY_TEXT);
}

/** plan.json's content for these actions: one line of JSON and a line feed. */
function planText(runId: string, actions: readonly StoredPlanAction[]): string {
  const stored: StoredPlan = { schemaVersion: 1, kind: "plan", runId, actions };
  return `${JSON.stringify(stored)}\n`;
}

/** U-181 (B-1): plan.json's content for a `run` plan, as planText: one line of JSON and a line feed. */
function changesPlanText(runId: string, summary: MaskedParts, files: readonly StoredPlannedFile[]): string {
  const stored: StoredChangesPlan = { schemaVersion: 1, kind: "changes", runId, summary, files };
  return `${JSON.stringify(stored)}\n`;
}

/**
 * See PlanRecorder. plan.json is created exclusively (it must not exist); the digest is the
 * SHA-256 of exactly the bytes written. Actions that are not resolved workspace paths with hashes
 * reject with TypeError before anything is written.
 */
export const createPlanRecorder: CreatePlanRecorder = (options) => planRecorderWith(options);

/** DR-38: createPlanRecorder that notes the plan file and run directory it writes (createRunRecorders). */
export function planRecorderWith(options: Parameters<CreatePlanRecorder>[0], notes?: RunWriteNotes): ReturnType<CreatePlanRecorder> {
  const { workspaceRoot, runId } = options;
  assertRunId(runId);
  /** plan.json created exclusively with exactly `text`; resolves with the SHA-256 of those bytes. */
  const writePlan = async (text: string): Promise<ContentHash> => {
    const dir = await ensureRunDir(workspaceRoot, runId);
    if (notes !== undefined) await notes.dir(dir);
    const file = join(dir, PLAN_FILE_NAME);
    if (!(await createExclusive(file, text))) {
      throw new Error("the run already has a plan.json; it was left as it is");
    }
    if (notes !== undefined) await notes.file(file, { sha256: sha256Hex(text), size: Buffer.byteLength(text, "utf8") });
    return sha256Hex(text);
  };
  return {
    async savePlan(actions) {
      const canonical = canonicalActions(actions);
      if (canonical === null) throw new TypeError("savePlan needs 1 to MAX_PLAN_ACTIONS resolved actions with source hashes");
      return writePlan(planText(runId, canonical));
    },
    // U-181 (B-1, B-3): a `run` plan, with savePlan's rules; the summary is in the bytes the digest covers.
    async saveChangesPlan(plan) {
      const summary = summaryPartsOf((plan as { readonly summary?: unknown } | null)?.summary);
      const files = canonicalPlannedFiles((plan as { readonly files?: unknown } | null)?.files);
      if (summary === null || files === null) {
        throw new TypeError("saveChangesPlan needs the summary's visible parts and 1 to MAX_PLANNED_FILES planned files, each path once");
      }
      return writePlan(changesPlanText(runId, summary, files));
    },
  };
}

/** A record failed a check. */
class Invalid extends Error {}

function invalid(): never {
  throw new Invalid();
}

/** A regular file's bytes, or "missing". A link, a directory or a file over the limit is invalid. */
async function readRecordBytes(file: string): Promise<Buffer | "missing"> {
  let size: number;
  try {
    const info = await lstat(file);
    if (!info.isFile()) return invalid();
    size = info.size;
  } catch (error) {
    if (error instanceof Invalid) throw error;
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return "missing";
    return invalid();
  }
  if (size > MAX_REPORT_FILE_BYTES) invalid();
  try {
    const bytes = await readFile(file);
    return bytes.length > MAX_REPORT_FILE_BYTES ? invalid() : bytes;
  } catch {
    return invalid();
  }
}

function parseObject(bytes: Buffer): Obj {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return invalid();
  }
  return isObj(value) ? value : invalid();
}

function parseApplied(record: Obj, planRunId: string): PlanAppliedRecord {
  const { applyRunId, at } = record;
  if (record["schemaVersion"] !== 1 || record["kind"] !== "plan_applied" || record["planRunId"] !== planRunId) invalid();
  if (typeof applyRunId !== "string" || toRunId(applyRunId) === null || !isRunTimestamp(at)) invalid();
  return { schemaVersion: 1, kind: "plan_applied", planRunId, applyRunId, at };
}

/**
 * U-181 (B-1): plan.json's object as a stored plan of either kind, by its `kind`, with that kind's
 * exact keys; anything else is invalid.
 */
function storedPlanOf(stored: Obj, runId: string): AnyStoredPlan {
  if (stored["schemaVersion"] !== 1 || stored["runId"] !== runId) invalid();
  if (stored["kind"] === "plan") {
    if (!hasExactKeys(stored, ["schemaVersion", "kind", "runId", "actions"])) invalid();
    const actions = canonicalActions(stored["actions"]);
    if (actions === null) return invalid();
    return { schemaVersion: 1, kind: "plan", runId, actions };
  }
  if (stored["kind"] === "changes") {
    if (!hasExactKeys(stored, ["schemaVersion", "kind", "runId", "summary", "files"])) invalid();
    const summary = summaryPartsOf(stored["summary"]);
    const files = canonicalPlannedFiles(stored["files"]);
    if (summary === null || files === null) return invalid();
    return { schemaVersion: 1, kind: "changes", runId, summary, files };
  }
  return invalid();
}

/** See LoadAnyPlan (U-181): LoadPlan's codes and checks, for either kind of plan. */
export const loadAnyPlan: LoadAnyPlan = async (request): Promise<LoadPlanOutcome<AnyStoredPlan>> => {
  const { workspaceRoot, runId } = request;
  if (toRunId(runId) === null) return { ok: false, code: "run_not_found" };
  const runsDir = join(workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME);
  const dir = runDir(workspaceRoot, runId);
  try {
    await lstat(dir);
  } catch {
    return { ok: false, code: "run_not_found" };
  }
  if (!(await hasExactRunEntry(workspaceRoot, runId))) return { ok: false, code: "run_not_found" };
  if (!(await isPlainDirectory(runsDir)) || !(await isPlainDirectory(dir))) return { ok: false, code: "invalid_run_record" };

  try {
    if ((await readRecordBytes(join(dir, JOURNAL_FILE_NAME))) === "missing") return { ok: false, code: "run_not_found" };

    const resultBytes = await readRecordBytes(join(dir, RESULT_FILE_NAME));
    if (resultBytes === "missing") return { ok: false, code: "run_not_plan" };
    const result = parseObject(resultBytes);
    if (result["schemaVersion"] !== 1 || result["kind"] !== "run" || result["runId"] !== runId) invalid();
    if (result["status"] !== "needs-input" || result["reason"] !== "plan_pending") return { ok: false, code: "run_not_plan" };
    const planInfo = result["plan"];
    if (!isObj(planInfo) || typeof planInfo["digest"] !== "string" || !CONTENT_HASH.test(planInfo["digest"])) invalid();

    const planBytes = await readRecordBytes(join(dir, PLAN_FILE_NAME));
    // R-9c C-1: a plan run (plan_pending) whose plan.json is gone was deleted, not "not a plan".
    if (planBytes === "missing") return { ok: false, code: "plan_run_missing" };
    const digest = sha256Hex(planBytes);
    if (digest !== planInfo["digest"]) invalid();
    const plan = storedPlanOf(parseObject(planBytes), runId);
    // U-181 (EngineResult.plan.kind): the result names a `run` plan exactly when plan.json is one.
    if (plan.kind === "changes" ? planInfo["kind"] !== "changes" : Object.hasOwn(planInfo, "kind")) invalid();

    const appliedBytes = await readRecordBytes(join(dir, PLAN_APPLIED_FILE_NAME));
    const applied = appliedBytes === "missing" ? null : parseApplied(parseObject(appliedBytes), runId);
    return { ok: true, plan, digest, applied };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, code: "invalid_run_record" };
    return { ok: false, code: "invalid_run_record" };
  }
};

/** See LoadPlan: loadAnyPlan for a plan of mode apply; a `run` plan is `invalid_run_record` (U-181, B-4). */
export const loadPlan: LoadPlan = async (request): Promise<LoadPlanOutcome> => {
  const outcome = await loadAnyPlan(request);
  if (!outcome.ok) return outcome;
  const { plan, digest, applied } = outcome;
  if (plan.kind !== "plan") return { ok: false, code: "invalid_run_record" };
  return { ok: true, plan, digest, applied };
};

export interface MarkPlanAppliedRequest {
  /** Real absolute path of the workspace root. */
  readonly workspaceRoot: string;
  readonly planRunId: string;
  readonly applyRunId: string;
  /** ISO 8601 UTC, when the apply claims the plan. */
  readonly at: string;
}

/**
 * `ApplyDeps.markApplied`: creates applied.json in the plan run's directory exclusively. "marked"
 * for the one caller that created it, "already_applied" for every other. The plan run's directory
 * must exist and be plain; otherwise it rejects and nothing is created.
 */
export async function markPlanApplied(request: MarkPlanAppliedRequest): Promise<"marked" | "already_applied"> {
  return markPlanAppliedWith(request);
}

/** DR-38: markPlanApplied that notes the applied.json it creates (createApplyRecorders). */
export async function markPlanAppliedWith(request: MarkPlanAppliedRequest, notes?: RunWriteNotes): Promise<"marked" | "already_applied"> {
  const { workspaceRoot, planRunId, applyRunId, at } = request;
  assertRunId(planRunId);
  assertRunId(applyRunId);
  if (!isRunTimestamp(at)) throw new TypeError("markPlanApplied needs an ISO 8601 UTC time");
  const dir = runDir(workspaceRoot, planRunId);
  if (!(await isOwnRunDir(workspaceRoot, planRunId))) throw new Error("the plan run has no directory of its own; nothing was written");
  const record: PlanAppliedRecord = { schemaVersion: 1, kind: "plan_applied", planRunId, applyRunId, at };
  const text = `${JSON.stringify(record)}\n`;
  const file = join(dir, PLAN_APPLIED_FILE_NAME);
  if (!(await createExclusive(file, text))) return "already_applied";
  if (notes !== undefined) await notes.file(file, { sha256: sha256Hex(text), size: Buffer.byteLength(text, "utf8") });
  return "marked";
}
