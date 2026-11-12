/**
 * G-E: the stored plan of a plan run and its claim by an apply run (src/contracts/plan.ts).
 *
 * - `<root>/.codaryn/runs/<plan runId>/plan.json` (StoredPlan): the actions and their source
 *   hashes, nothing else (DR-5). Written once by `createPlanRecorder`; its bytes' SHA-256 is the
 *   digest a person approves.
 * - `<root>/.codaryn/runs/<plan runId>/applied.json` (PlanAppliedRecord): created exclusively by
 *   `markPlanApplied`, so a plan is applied at most once.
 * - `loadPlan` reads both for `plan` and `apply`; it changes nothing.
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
  MAX_REPORT_FILE_BYTES,
  PLAN_APPLIED_FILE_NAME,
  PLAN_FILE_NAME,
  RESULT_FILE_NAME,
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
  toRunId,
} from "../contracts/index.js";
import type {
  ContentHash,
  CreatePlanRecorder,
  LoadPlan,
  LoadPlanOutcome,
  PlanAppliedRecord,
  ResolvedPlanAction,
  StoredPlan,
} from "../contracts/index.js";
import { assertRunId, createExclusive, ensureRunDir, errorCode, isPlainDirectory, runDir, sha256Hex } from "./common.js";
import { isRunTimestamp } from "./runs.js";

const CONTENT_HASH = new RegExp(CONTENT_HASH_PATTERN_SOURCE);

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
  return (segments[0] as string).toLowerCase() !== STATE_DIR_NAME;
}

/** One action in canonical form (fixed key order), or null when it is not a resolved action. */
function canonicalAction(value: unknown): ResolvedPlanAction | null {
  if (!isObj(value)) return null;
  const sha256 = value["sha256"];
  if (typeof sha256 !== "string" || !CONTENT_HASH.test(sha256)) return null;
  const hash = sha256 as ContentHash;
  if (value["kind"] === "move" && hasExactKeys(value, ["kind", "from", "to", "sha256"])) {
    const { from, to } = value;
    return isWorkspaceRelativePath(from) && isWorkspaceRelativePath(to) ? { kind: "move", from, to, sha256: hash } : null;
  }
  if (value["kind"] === "discard" && hasExactKeys(value, ["kind", "path", "sha256"])) {
    const { path } = value;
    return isWorkspaceRelativePath(path) ? { kind: "discard", path, sha256: hash } : null;
  }
  return null;
}

/** The actions in canonical form, or null when any is not a resolved action or the count is out of range. */
export function canonicalActions(value: unknown): ResolvedPlanAction[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PLAN_ACTIONS) return null;
  const actions: ResolvedPlanAction[] = [];
  for (const item of value) {
    const action = canonicalAction(item);
    if (action === null) return null;
    actions.push(action);
  }
  return actions;
}

/** plan.json's content for these actions: one line of JSON and a line feed. */
function planText(runId: string, actions: readonly ResolvedPlanAction[]): string {
  const stored: StoredPlan = { schemaVersion: 1, kind: "plan", runId, actions };
  return `${JSON.stringify(stored)}\n`;
}

/**
 * See PlanRecorder. plan.json is created exclusively (it must not exist); the digest is the
 * SHA-256 of exactly the bytes written. Actions that are not resolved workspace paths with hashes
 * reject with TypeError before anything is written.
 */
export const createPlanRecorder: CreatePlanRecorder = (options) => {
  const { workspaceRoot, runId } = options;
  assertRunId(runId);
  return {
    async savePlan(actions) {
      const canonical = canonicalActions(actions);
      if (canonical === null) throw new TypeError("savePlan needs 1 to MAX_PLAN_ACTIONS resolved actions with source hashes");
      const text = planText(runId, canonical);
      const dir = await ensureRunDir(workspaceRoot, runId);
      if (!(await createExclusive(join(dir, PLAN_FILE_NAME), text))) {
        throw new Error("the run already has a plan.json; it was left as it is");
      }
      return sha256Hex(text);
    },
  };
};

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

/** See LoadPlan. */
export const loadPlan: LoadPlan = async (request): Promise<LoadPlanOutcome> => {
  const { workspaceRoot, runId } = request;
  if (toRunId(runId) === null) return { ok: false, code: "run_not_found" };
  const runsDir = join(workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME);
  const dir = runDir(workspaceRoot, runId);
  try {
    await lstat(dir);
  } catch {
    return { ok: false, code: "run_not_found" };
  }
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
    if (planBytes === "missing") return { ok: false, code: "run_not_plan" };
    const digest = sha256Hex(planBytes);
    if (digest !== planInfo["digest"]) invalid();
    const stored = parseObject(planBytes);
    if (!hasExactKeys(stored, ["schemaVersion", "kind", "runId", "actions"])) invalid();
    if (stored["schemaVersion"] !== 1 || stored["kind"] !== "plan" || stored["runId"] !== runId) invalid();
    const actions = canonicalActions(stored["actions"]);
    if (actions === null) return invalid();

    const appliedBytes = await readRecordBytes(join(dir, PLAN_APPLIED_FILE_NAME));
    const applied = appliedBytes === "missing" ? null : parseApplied(parseObject(appliedBytes), runId);
    return { ok: true, plan: { schemaVersion: 1, kind: "plan", runId, actions }, digest, applied };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, code: "invalid_run_record" };
    return { ok: false, code: "invalid_run_record" };
  }
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
  const { workspaceRoot, planRunId, applyRunId, at } = request;
  assertRunId(planRunId);
  assertRunId(applyRunId);
  if (!isRunTimestamp(at)) throw new TypeError("markPlanApplied needs an ISO 8601 UTC time");
  const dir = runDir(workspaceRoot, planRunId);
  if (!(await isPlainDirectory(dir))) throw new Error("the plan run has no directory of its own; nothing was written");
  const record: PlanAppliedRecord = { schemaVersion: 1, kind: "plan_applied", planRunId, applyRunId, at };
  return (await createExclusive(join(dir, PLAN_APPLIED_FILE_NAME), `${JSON.stringify(record)}\n`)) ? "marked" : "already_applied";
}
