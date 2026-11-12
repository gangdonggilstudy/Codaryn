/**
 * G-E: reverting an apply run (RevertRun, src/contracts/changes.ts, G-A part). Its journal starts
 * with `apply_started`; its `file_moved` and `file_discarded` records are handled last first.
 *
 * - A moved file goes back from `to` to `from` when the file at `to` has the recorded SHA-256 and
 *   nothing exists at `from`. A discarded file goes back from `.codaryn/discarded/<runId>/<stored>`
 *   (DR-9) the same way. Renames only: nothing is copied or replaced. Directories the apply created
 *   are left in place; a missing parent of the original path is created.
 * - Skips: the file changed since (`changed_since_run`), something at the original path
 *   (`original_path_taken`), the file already back (`already_reverted`), a recorded path that holds
 *   a privacy token with no stored plan to find the file by (`missing_snapshot`), a read or write
 *   failure (`io_error`).
 * - Real paths: the records hold masked paths. The plan run's plan.json holds the resolved ones, so
 *   an action's paths are taken from it by index when its kind and hash match the record; otherwise
 *   the record's own path is used when it holds no token.
 * - A record that does not belong to the run, or names a stored file outside the run's discarded
 *   directory, rejects with RevertRunError before anything is changed.
 */

import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { link, lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  CONTENT_HASH_PATTERN_SOURCE,
  MAX_REPORT_FILE_BYTES,
  PLAN_FILE_NAME,
  PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE,
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
  toRunId,
} from "../contracts/index.js";
import type { ContentHash, RevertAction, RevertOutcome, RevertSkipReason, RevertedFile, ResolvedPlanAction, SkippedFile, Workspace } from "../contracts/index.js";
import { createWorkspace } from "../workspace/index.js";
import { errorCode, isPlainDirectory, runDir } from "./common.js";
import { discardedRootPath } from "./discarded.js";
import { canonicalActions, isWorkspaceRelativePath } from "./plan.js";

const CONTENT_HASH = new RegExp(CONTENT_HASH_PATTERN_SOURCE);
const TOKEN_FRAGMENT = new RegExp(PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE, "i");
/** A stored name inside the discarded directory: plain segments only (the executor builds it from the index). */
const STORED_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

type Item =
  | { readonly kind: "move"; readonly index: number; readonly from: string; readonly to: string; readonly sha256: ContentHash }
  | { readonly kind: "discard"; readonly index: number; readonly path: string; readonly stored: string; readonly sha256: ContentHash };

/** The journal's records failed a check. Thrown as RevertRunError("invalid_run_record") by the caller. */
export class ApplyRecordError extends Error {}

function bad(): never {
  throw new ApplyRecordError("the apply run's journal cannot be used; nothing was changed");
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function index(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : bad();
}

function hash(value: unknown): ContentHash {
  return typeof value === "string" && CONTENT_HASH.test(value) ? (value as ContentHash) : bad();
}

function text(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : bad();
}

function stored(value: unknown): string {
  const name = text(value);
  const segments = name.split("/");
  return segments.length <= 8 && segments.every((segment) => STORED_SEGMENT.test(segment) && segment !== "..") ? name : bad();
}

/** Whether the journal's first complete record is this run's `apply_started` (DR-12). */
export function isApplyJournal(journal: string, runId: string): boolean {
  const end = journal.indexOf("\n");
  if (end < 0) return false;
  try {
    const first: unknown = JSON.parse(journal.slice(0, end));
    return isObj(first) && first["type"] === "apply_started" && first["runId"] === runId;
  } catch {
    return false;
  }
}

/** The plan run's id and the done actions, in journal order. A cut-off last line is ignored (T-10). */
function applyRecords(journal: string, runId: string): { readonly planRunId: string; readonly items: Item[] } {
  const lines = journal.split("\n");
  const last = lines.pop() ?? "";
  const records: Obj[] = [];
  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return bad();
    }
    records.push(isObj(value) ? value : bad());
  }
  if (last.length > 0) {
    try {
      const value: unknown = JSON.parse(last);
      records.push(isObj(value) ? value : bad());
    } catch (error) {
      if (error instanceof ApplyRecordError) throw error;
    }
  }
  const first = records[0];
  if (first === undefined || first["type"] !== "apply_started") bad();
  const planRunId = first["planRunId"];
  if (typeof planRunId !== "string" || toRunId(planRunId) === null) bad();
  const items: Item[] = [];
  for (const record of records) {
    if (record["runId"] !== runId || typeof record["type"] !== "string") bad();
    if (record["type"] === "file_moved") {
      items.push({ kind: "move", index: index(record["index"]), from: text(record["from"]), to: text(record["to"]), sha256: hash(record["sha256"]) });
    } else if (record["type"] === "file_discarded") {
      items.push({ kind: "discard", index: index(record["index"]), path: text(record["path"]), stored: stored(record["stored"]), sha256: hash(record["sha256"]) });
    }
  }
  return { planRunId: planRunId as string, items };
}

/** The plan run's resolved actions, or null when its plan.json cannot be read or is not a plan of that run. */
async function planActions(workspaceRoot: string, planRunId: string): Promise<readonly ResolvedPlanAction[] | null> {
  const dir = runDir(workspaceRoot, planRunId);
  if (!(await isPlainDirectory(join(workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME))) || !(await isPlainDirectory(dir))) return null;
  try {
    const file = join(dir, PLAN_FILE_NAME);
    const info = await lstat(file);
    if (!info.isFile() || info.size > MAX_REPORT_FILE_BYTES) return null;
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!isObj(value) || value["kind"] !== "plan" || value["runId"] !== planRunId) return null;
    return canonicalActions(value["actions"]);
  } catch {
    return null;
  }
}

function usable(path: string): boolean {
  return !TOKEN_FRAGMENT.test(path) && isWorkspaceRelativePath(path);
}

/** The real paths of an item: from the plan when it agrees with the record, else the record's own when they hold no token. */
function realPaths(item: Item, plan: readonly ResolvedPlanAction[] | null): { from: string; to: string } | { path: string } | null {
  const planned = plan?.[item.index];
  if (planned !== undefined && planned.kind === item.kind && planned.sha256 === item.sha256) {
    return planned.kind === "move" ? { from: planned.from, to: planned.to } : { path: planned.path };
  }
  if (item.kind === "move") return usable(item.from) && usable(item.to) ? { from: item.from, to: item.to } : null;
  return usable(item.path) ? { path: item.path } : null;
}

type FileState = { readonly kind: "file"; readonly sha256: ContentHash } | { readonly kind: "absent" } | { readonly kind: "other" } | { readonly kind: "error" };

/** What is at `file`: a regular file and its SHA-256 (streamed), nothing, something else, or unreadable. */
async function stateOf(file: string): Promise<FileState> {
  try {
    const info = await lstat(file);
    if (!info.isFile()) return { kind: "other" };
  } catch (error) {
    const code = errorCode(error);
    return code === "ENOENT" || code === "ENOTDIR" ? { kind: "absent" } : { kind: "error" };
  }
  try {
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(file)) digest.update(chunk as Buffer);
    return { kind: "file", sha256: digest.digest("hex") as ContentHash };
  } catch {
    return { kind: "error" };
  }
}

/**
 * Renames `source` to `target` without ever replacing something at `target`: a hard link (which
 * fails when `target` exists) and then the source's removal. Where links are not supported it
 * checks `target` again right before a rename.
 */
async function moveWithoutReplacing(source: string, target: string): Promise<"moved" | "taken" | "failed"> {
  try {
    await mkdir(dirname(target), { recursive: true });
  } catch {
    return "failed";
  }
  try {
    await link(source, target);
  } catch (error) {
    const code = errorCode(error);
    if (code === "EEXIST") return "taken";
    if (code !== "EPERM" && code !== "EXDEV" && code !== "ENOTSUP" && code !== "EOPNOTSUPP" && code !== "ENOSYS" && code !== "EMLINK") return "failed";
    if ((await stateOf(target)).kind !== "absent") return "taken";
    try {
      await rename(source, target);
      return "moved";
    } catch {
      return "failed";
    }
  }
  try {
    await rm(source);
    return "moved";
  } catch {
    // Undo the link so the file is not left in two places.
    await rm(target).catch(() => undefined);
    return "failed";
  }
}

type Outcome = { readonly action: RevertAction } | { readonly reason: RevertSkipReason };

/** A workspace path to write through, or null when it cannot be resolved as it was recorded. */
async function resolved(workspace: Workspace, path: string): Promise<string | null> {
  const outcome = await workspace.resolve(path, "write");
  return outcome.ok && outcome.path.relative === path ? outcome.path.absolute : null;
}

async function revertMove(workspace: Workspace, paths: { from: string; to: string }, sha256: ContentHash, dryRun: boolean): Promise<Outcome> {
  const at = await resolved(workspace, paths.to);
  const back = await resolved(workspace, paths.from);
  if (at === null || back === null) return { reason: "changed_since_run" };
  const now = await stateOf(at);
  if (now.kind === "error") return { reason: "io_error" };
  if (now.kind !== "file" || now.sha256 !== sha256) {
    const original = await stateOf(back);
    if (now.kind === "absent" && original.kind === "file" && original.sha256 === sha256) return { reason: "already_reverted" };
    return { reason: "changed_since_run" };
  }
  if ((await stateOf(back)).kind !== "absent") return { reason: "original_path_taken" };
  if (dryRun) return { action: "moved_back" };
  const moved = await moveWithoutReplacing(at, back);
  return moved === "moved" ? { action: "moved_back" } : { reason: moved === "taken" ? "original_path_taken" : "io_error" };
}

async function revertDiscard(
  workspace: Workspace,
  discarded: string | null,
  path: string,
  storedName: string,
  sha256: ContentHash,
  dryRun: boolean,
): Promise<Outcome> {
  const back = await resolved(workspace, path);
  if (back === null) return { reason: "changed_since_run" };
  if (discarded === null) return { reason: "io_error" };
  const source = join(discarded, ...storedName.split("/"));
  const kept = await stateOf(source);
  if (kept.kind === "error") return { reason: "io_error" };
  if (kept.kind !== "file" || kept.sha256 !== sha256) {
    const original = await stateOf(back);
    if (kept.kind === "absent" && original.kind === "file" && original.sha256 === sha256) return { reason: "already_reverted" };
    return { reason: "changed_since_run" };
  }
  if ((await stateOf(back)).kind !== "absent") return { reason: "original_path_taken" };
  if (dryRun) return { action: "restored_from_discard" };
  const moved = await moveWithoutReplacing(source, back);
  return moved === "moved" ? { action: "restored_from_discard" } : { reason: moved === "taken" ? "original_path_taken" : "io_error" };
}

/**
 * Reverts (or, with `dryRun`, decides) an apply run whose journal text was read by `revertRun`.
 * Rejects with ApplyRecordError before anything is changed when a record fails its checks.
 */
export async function revertApplyRun(workspaceRoot: string, runId: string, journal: string, dryRun: boolean): Promise<RevertOutcome> {
  const { planRunId, items } = applyRecords(journal, runId);
  const reverted: RevertedFile[] = [];
  const skipped: SkippedFile[] = [];
  if (items.length === 0) return { reverted, skipped };

  const plan = await planActions(workspaceRoot, planRunId);
  let workspace: Workspace | null;
  try {
    workspace = await createWorkspace({ root: workspaceRoot });
  } catch {
    workspace = null;
  }
  const discardedRoot = discardedRootPath(workspaceRoot, runId);
  const discarded =
    (await isPlainDirectory(dirname(discardedRoot))) && (await isPlainDirectory(discardedRoot)) ? discardedRoot : null;

  for (const item of [...items].reverse()) {
    const shown = item.kind === "move" ? item.from : item.path;
    const paths = realPaths(item, plan);
    let outcome: Outcome;
    if (paths === null) {
      outcome = { reason: "missing_snapshot" };
    } else if (workspace === null) {
      outcome = { reason: "io_error" };
    } else {
      try {
        outcome =
          item.kind === "move" && "from" in paths
            ? await revertMove(workspace, paths, item.sha256, dryRun)
            : item.kind === "discard" && "path" in paths
              ? await revertDiscard(workspace, discarded, paths.path, item.stored, item.sha256, dryRun)
              : { reason: "io_error" };
      } catch {
        outcome = { reason: "io_error" };
      }
    }
    if ("action" in outcome) {
      reverted.push(item.kind === "move" ? { path: shown, action: outcome.action, from: item.to } : { path: shown, action: outcome.action });
    } else {
      skipped.push({ path: shown, reason: outcome.reason });
    }
  }
  return { reverted, skipped };
}
