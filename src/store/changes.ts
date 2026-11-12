/**
 * Change snapshots and revert (phase 2, R-6 to R-8). Contract: src/contracts/changes.ts.
 *
 * Layout of `<root>/.codaryn/runs/<runId>/snapshots/`:
 * - `index.json`: `{"schemaVersion":1,"entries":[{"path","existed","file"?}]}`, one entry per path in
 *   the order the run first changed them. `path` is the tool's `ResolvedPath.relative`. It is raw
 *   (a path may itself hold a secret), so the index never leaves this directory. `existed: false`
 *   records that the file did not exist before the run. The index holds no file content.
 * - `<n>.orig`: the original bytes of an entry with `existed: true`. Names are sequence numbers,
 *   so they reveal nothing about the path.
 * Every file is written under a temporary name and renamed into place. The content file is placed
 * before the index names it, so an index entry never points at a partial file.
 *
 * Nothing here writes to the journal, prints, or returns file content.
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  CONTENT_HASH_PATTERN_SOURCE,
  JOURNAL_FILE_NAME,
  PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE,
  RUNS_DIR_NAME,
  SNAPSHOTS_DIR_NAME,
  STATE_DIR_NAME,
} from "../contracts/index.js";
import type {
  ContentHash,
  CreateChangeRecorder,
  RawText,
  ResolvedPath,
  RevertAction,
  RevertRun,
  RevertSkipReason,
  RevertedFile,
  SkippedFile,
  Workspace,
} from "../contracts/index.js";
import { createWorkspace } from "../workspace/index.js";
import { assertRunId, ensureStateDir, errorCode, runDir } from "./common.js";

const INDEX_FILE_NAME = "index.json";
const CONTENT_FILE_PATTERN = /^([1-9][0-9]{0,8})\.orig$/;
const CONTENT_HASH = new RegExp(CONTENT_HASH_PATTERN_SOURCE);
const TOKEN_FRAGMENT = new RegExp(PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE, "i");

interface IndexEntry {
  readonly path: string;
  readonly existed: boolean;
  /** Content file name inside the snapshots directory. Set exactly when `existed` is true. */
  readonly file?: string;
}

/** Value relative to the workspace root, `/` separated: where a run's snapshots are kept. */
export function snapshotsRelativePath(runId: string): string {
  assertRunId(runId);
  return [STATE_DIR_NAME, RUNS_DIR_NAME, runId, SNAPSHOTS_DIR_NAME].join("/");
}

function snapshotsDir(workspaceRoot: string, runId: string): string {
  return join(runDir(workspaceRoot, runId), SNAPSHOTS_DIR_NAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(bytes: Uint8Array): ContentHash {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A workspace-relative, `/` separated path below the root, as `ResolvedPath.relative` gives it. */
function isRelativeFilePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value === ".") return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** `null` when the text is not a valid index. */
function parseIndex(text: string): IndexEntry[] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value["schemaVersion"] !== 1 || !Array.isArray(value["entries"])) return null;
  const entries: IndexEntry[] = [];
  const paths = new Set<string>();
  const files = new Set<string>();
  for (const item of value["entries"] as unknown[]) {
    if (!isRecord(item) || !isRelativeFilePath(item["path"]) || typeof item["existed"] !== "boolean") return null;
    const path = item["path"];
    if (paths.has(path)) return null;
    paths.add(path);
    if (item["existed"]) {
      const file = item["file"];
      if (typeof file !== "string" || !CONTENT_FILE_PATTERN.test(file) || files.has(file)) return null;
      files.add(file);
      entries.push({ path, existed: true, file });
    } else {
      if (item["file"] !== undefined) return null;
      entries.push({ path, existed: false });
    }
  }
  return entries;
}

/** Reads the index. "missing" when there is none. Rejects when it exists but cannot be read. */
async function readIndex(dir: string): Promise<IndexEntry[] | "missing" | "invalid"> {
  let text: string;
  try {
    text = await readFile(join(dir, INDEX_FILE_NAME), "utf8");
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return "missing";
    throw error;
  }
  return parseIndex(text) ?? "invalid";
}

/** Writes the complete data under a temporary name in the same directory, then renames it into place. */
async function writeAtomically(target: string, data: string | Uint8Array): Promise<void> {
  const temporary = `${target}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function nextContentFile(entries: readonly IndexEntry[]): string {
  let highest = 0;
  for (const entry of entries) {
    const match = entry.file === undefined ? null : CONTENT_FILE_PATTERN.exec(entry.file);
    if (match !== null) highest = Math.max(highest, Number(match[1]));
  }
  return `${highest + 1}.orig`;
}

/**
 * Keeps the first original of each path a run changes. Calls are handled one at a time.
 * An existing index of the same run (an earlier recorder) is continued, never rewritten from scratch,
 * so its originals stay the first ones. An index that cannot be understood makes every call reject.
 */
export const createChangeRecorder: CreateChangeRecorder = (options) => {
  const { workspaceRoot, runId } = options;
  assertRunId(runId);
  const dir = snapshotsDir(workspaceRoot, runId);

  let entries: readonly IndexEntry[] | null = null;
  let queue: Promise<void> = Promise.resolve();

  async function load(): Promise<readonly IndexEntry[]> {
    if (entries !== null) return entries;
    const found = await readIndex(dir);
    if (found === "invalid") throw new Error("the snapshot index of this run cannot be read; nothing was kept");
    entries = found === "missing" ? [] : found;
    return entries;
  }

  async function save(path: ResolvedPath, original: RawText | null): Promise<void> {
    const relative: unknown = (path as Partial<ResolvedPath> | null)?.relative;
    if (!isRelativeFilePath(relative)) {
      throw new TypeError("saveOriginal needs a resolved path below the workspace root");
    }
    if (original !== null && (typeof original !== "string" || !original.isWellFormed())) {
      throw new TypeError("saveOriginal needs the original text as read, or null");
    }
    const current = await load();
    if (current.some((entry) => entry.path === relative)) return;

    await ensureStateDir(workspaceRoot);
    await mkdir(dir, { recursive: true });
    let entry: IndexEntry;
    if (original === null) {
      entry = { path: relative, existed: false };
    } else {
      const file = nextContentFile(current);
      await writeAtomically(join(dir, file), Buffer.from(original, "utf8"));
      entry = { path: relative, existed: true, file };
    }
    const next = [...current, entry];
    await writeAtomically(join(dir, INDEX_FILE_NAME), `${JSON.stringify({ schemaVersion: 1, entries: next })}\n`);
    entries = next;
  }

  return {
    saveOriginal(path, original) {
      const run = queue.then(() => save(path, original));
      queue = run.catch(() => undefined);
      return run;
    },
  };
};

export type RevertRunErrorCode = "run_not_found" | "invalid_run_record";

/**
 * Why `revertRun` rejected. Nothing was changed. The message names no path and no content.
 * `run_not_found`: the run has no journal. `invalid_run_record`: the journal cannot be read or parsed.
 */
export class RevertRunError extends Error {
  readonly code: RevertRunErrorCode;

  constructor(code: RevertRunErrorCode, message: string) {
    super(message);
    this.name = "RevertRunError";
    this.code = code;
  }
}

interface ChangedPath {
  readonly path: string;
  /** `previousHash` of the path's first `file_changed` record: the state before the run. */
  readonly before: ContentHash | null;
  /** `newHash` of the path's last `file_changed` record: the state the run left. */
  after: ContentHash;
}

function invalidRecord(): RevertRunError {
  return new RevertRunError("invalid_run_record", "the run's journal cannot be parsed; nothing was changed");
}

/**
 * Distinct paths of the `file_changed` records, in order of first appearance.
 * Every line ends with LF. A last line without LF was being written when the run stopped: it is
 * used when it still parses and ignored when it was cut off (T-10). Any other line that does not
 * parse, or a record that does not belong to this run, rejects.
 */
function changedPaths(text: string, runId: string): ChangedPath[] {
  const lines = text.split("\n");
  const last = lines.pop() ?? "";
  const byPath = new Map<string, ChangedPath>();
  const take = (record: unknown): void => {
    if (!isRecord(record) || record["runId"] !== runId || typeof record["type"] !== "string") throw invalidRecord();
    if (record["type"] !== "file_changed") return;
    const { path, previousHash, newHash } = record;
    const validBefore = previousHash === null || (typeof previousHash === "string" && CONTENT_HASH.test(previousHash));
    if (typeof path !== "string" || path.length === 0 || !validBefore || typeof newHash !== "string" || !CONTENT_HASH.test(newHash)) {
      throw invalidRecord();
    }
    const known = byPath.get(path);
    if (known === undefined) {
      byPath.set(path, { path, before: previousHash as ContentHash | null, after: newHash });
    } else {
      known.after = newHash;
    }
  };
  for (const line of lines) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      throw invalidRecord();
    }
    take(record);
  }
  if (last.length > 0) {
    let record: unknown;
    let complete = true;
    try {
      record = JSON.parse(last);
    } catch {
      complete = false;
    }
    if (complete) take(record);
  }
  return [...byPath.values()];
}

type Snapshots =
  | { readonly kind: "found"; readonly dir: string; readonly byPath: ReadonlyMap<string, IndexEntry> }
  | { readonly kind: "missing" }
  | { readonly kind: "unreadable" };

async function loadSnapshots(dir: string): Promise<Snapshots> {
  try {
    const found = await readIndex(dir);
    if (found === "missing") return { kind: "missing" };
    if (found === "invalid") return { kind: "unreadable" };
    return { kind: "found", dir, byPath: new Map(found.map((entry) => [entry.path, entry])) };
  } catch {
    return { kind: "unreadable" };
  }
}

/** SHA-256 of the file, `null` when it does not exist, `undefined` when it cannot be read. */
async function hashOf(file: string): Promise<ContentHash | null | undefined> {
  try {
    return sha256(await readFile(file));
  } catch (error) {
    const code = errorCode(error);
    return code === "ENOENT" || code === "ENOTDIR" ? null : undefined;
  }
}

type FileOutcome = { readonly action: RevertAction } | { readonly reason: RevertSkipReason };

/** The original kept for `change`, checked against the run's first record of that path. */
async function originalOf(
  change: ChangedPath,
  snapshots: Snapshots,
): Promise<{ readonly text: RawText | null } | { readonly reason: RevertSkipReason }> {
  if (snapshots.kind === "unreadable") return { reason: "io_error" };
  if (snapshots.kind === "missing") return { reason: "missing_snapshot" };
  const entry = snapshots.byPath.get(change.path);
  if (entry === undefined) return { reason: "missing_snapshot" };
  if (!entry.existed || entry.file === undefined) {
    return change.before === null ? { text: null } : { reason: "missing_snapshot" };
  }
  if (change.before === null) return { reason: "missing_snapshot" };
  let bytes: Buffer;
  try {
    bytes = await readFile(join(snapshots.dir, entry.file));
  } catch (error) {
    return { reason: errorCode(error) === "ENOENT" ? "missing_snapshot" : "io_error" };
  }
  // A snapshot taken before a write that then failed may differ from the state the run's first
  // successful change replaced. It is not that state's original, so it is not used.
  if (sha256(bytes) !== change.before) return { reason: "missing_snapshot" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) as RawText };
  } catch {
    return { reason: "missing_snapshot" };
  }
}

/** What a revert does with one file, decided without changing anything. */
type FilePlan =
  | { readonly action: RevertAction; readonly target: ResolvedPath; readonly text: RawText | null }
  | { readonly reason: RevertSkipReason };

/**
 * The checks of a revert for one file. Reads only: nothing is written or removed. A real revert
 * and a dry run (N-7) both decide here, so a dry run reports what the revert would do.
 */
async function planFile(change: ChangedPath, snapshots: Snapshots, workspace: Workspace | null): Promise<FilePlan> {
  // A masked path names a token, not the file, so it cannot be matched to a snapshot.
  if (TOKEN_FRAGMENT.test(change.path)) return { reason: "missing_snapshot" };
  const original = await originalOf(change, snapshots);
  if ("reason" in original) return original;
  if (workspace === null) return { reason: "io_error" };

  const resolved = await workspace.resolve(change.path, "write");
  if (!resolved.ok) return { reason: resolved.code === "invalid_path" ? "io_error" : "changed_since_run" };
  // A link created after the run could lead the path to another file.
  if (resolved.path.relative !== change.path) return { reason: "changed_since_run" };

  const current = await hashOf(resolved.path.absolute);
  if (current === undefined) return { reason: "io_error" };
  if (current !== change.after) return { reason: "changed_since_run" };
  return { action: original.text === null ? "deleted" : "restored", target: resolved.path, text: original.text };
}

/** Carries out a plan. The hash is checked again right before the change. */
async function applyPlan(change: ChangedPath, plan: FilePlan, workspace: Workspace | null): Promise<FileOutcome> {
  if ("reason" in plan) return plan;
  if (workspace === null) return { reason: "io_error" };
  if (plan.text === null) {
    try {
      await rm(plan.target.absolute);
    } catch (error) {
      return { reason: errorCode(error) === "ENOENT" ? "changed_since_run" : "io_error" };
    }
    return { action: "deleted" };
  }
  const written = await workspace.writeText({ path: plan.target, expectedHash: change.after, text: plan.text });
  if (written.ok) return { action: "restored" };
  return { reason: written.code === "conflict" ? "changed_since_run" : "io_error" };
}

/**
 * Puts back the originals of one run. See `RevertRun` in src/contracts/changes.ts.
 * Rejects with RevertRunError, before changing anything, when the journal is missing or invalid
 * (a cut-off last line excepted, T-10). Index paths without a record are `missing_record`.
 * Restores go through the workspace (links resolved, root and state directory enforced, atomic
 * replace that checks the hash again right before it). A deletion checks the hash right before it.
 *
 * `dryRun` (N-7): every file is decided the same way and nothing is changed: no file is written,
 * deleted or created, and the state directory is not touched. A real revert decides every file
 * again, so files changed in between are skipped then.
 */
export const revertRun: RevertRun = async (request) => {
  const { workspaceRoot, runId } = request;
  const dryRun = request.dryRun === true;
  assertRunId(runId);
  const dir = runDir(workspaceRoot, runId);

  let text: string;
  try {
    text = await readFile(join(dir, JOURNAL_FILE_NAME), "utf8");
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new RevertRunError("run_not_found", "the workspace has no journal for this run; nothing was changed");
    }
    throw new RevertRunError("invalid_run_record", "the run's journal cannot be read; nothing was changed");
  }
  const changes = changedPaths(text, runId);

  const reverted: RevertedFile[] = [];
  const skipped: SkippedFile[] = [];
  const snapshots = await loadSnapshots(join(dir, SNAPSHOTS_DIR_NAME));

  if (changes.length > 0) {
    let workspace: Workspace | null;
    try {
      workspace = await createWorkspace({ root: workspaceRoot });
    } catch {
      workspace = null;
    }
    for (const change of changes) {
      let outcome: FileOutcome;
      try {
        const plan = await planFile(change, snapshots, workspace);
        outcome = dryRun ? ("reason" in plan ? plan : { action: plan.action }) : await applyPlan(change, plan, workspace);
      } catch {
        outcome = { reason: "io_error" };
      }
      if ("action" in outcome) {
        reverted.push({ path: change.path, action: outcome.action });
      } else {
        skipped.push({ path: change.path, reason: outcome.reason });
      }
    }
  }

  // T-10: an original was kept but the run stopped before its record. The state the run left is
  // unknown, so the file is not touched; reporting it keeps the outcome from claiming "complete".
  // The path comes from the index (unmasked), see SkippedFile.
  if (snapshots.kind === "found") {
    const recorded = new Set(changes.map((change) => change.path));
    for (const path of snapshots.byPath.keys()) {
      if (!recorded.has(path)) skipped.push({ path, reason: "missing_record" });
    }
  }
  return { reverted, skipped };
};
