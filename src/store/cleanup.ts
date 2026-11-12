/**
 * DR-39 (DR-9, R-19 I-5): seeing and cleaning up the state directory (src/contracts/cleanup.ts).
 * summarizeState and planCleanup read only; applyCleanup removes, under the workspace lock, only
 * what a plan made again has the confirmed digest for. Run records (`runs/<runId>/`) and discarded-
 * files folders (`discarded/<runId>/`, people's files) are confirmed apart. Parked files, the lock
 * file, `.gitignore` and anything else are never removed. Exact run directory names and plain
 * directories only; no link is followed, and a run directory that is a link is not an item.
 */

import { randomBytes } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { appendFile, lstat, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  CLEANUP_LOG_FILE_NAME,
  CLEANUP_WARNING_CODES,
  DISCARDED_DIR_NAME,
  PARKED_DIR_NAME,
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
} from "../contracts/index.js";
import type {
  ApplyCleanup,
  CleanupBlockCode,
  CleanupItem,
  CleanupKeptReason,
  CleanupLogLine,
  CleanupPlan,
  CleanupSelection,
  CleanupTarget,
  CleanupWarningCode,
  ContentHash,
  PlanCleanup,
  RunId,
  RunListEntry,
  StateRunSummary,
  StateSize,
  StateSummary,
  SummarizeState,
} from "../contracts/index.js";
import { ensureStateDir, errorCode, hasExactRunEntry, isPlainDirectory, sha256Hex } from "./common.js";
import { acquireLock, inspectLock, releaseLock } from "./lock.js";
import { recordsChangedMarkIn } from "./marks.js";
import { isStoredRunId, listRuns, runIdSecond } from "./runs.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A plain directory's files and bytes and the metadata fingerprint of everything below it. */
interface Tree {
  readonly size: StateSize;
  readonly print: string;
}

/** Walks `dir` without following links; null when `dir` is not a plain directory. */
async function measure(dir: string): Promise<Tree | null> {
  let top: BigIntStats;
  try {
    top = await lstat(dir, { bigint: true });
  } catch {
    return null;
  }
  if (!top.isDirectory() || !(await isPlainDirectory(dir))) return null;
  let files = 0;
  let bytes = 0;
  const lines: string[] = [`.\td\t${top.ino}`];
  const visit = async (absolute: string, path: string): Promise<void> => {
    let names: string[];
    try {
      names = (await readdir(absolute)).sort();
    } catch {
      lines.push(`${path}\te`);
      return;
    }
    for (const name of names) {
      const child = path === "" ? name : `${path}/${name}`;
      let info: BigIntStats;
      try {
        info = await lstat(join(absolute, name), { bigint: true });
      } catch {
        lines.push(`${child}\te`);
        continue;
      }
      if (info.isDirectory()) {
        lines.push(`${child}\td\t${info.ino}`);
        await visit(join(absolute, name), child);
      } else {
        const kind = info.isFile() ? "f" : "o";
        if (info.isFile()) {
          files += 1;
          bytes += Number(info.size);
        }
        lines.push(`${child}\t${kind}\t${info.size}\t${info.mtimeNs}\t${info.ctimeNs}\t${info.ino}`);
      }
    }
  };
  await visit(dir, "");
  return { size: { files, bytes }, print: sha256Hex(lines.join("\n")) };
}

const ZERO: StateSize = { files: 0, bytes: 0 };

/** One run as the cleanup functions need it. */
interface RunFacts {
  readonly summary: StateRunSummary;
  readonly records: Tree | null;
  readonly discardedTree: Tree | null;
  readonly changes: number;
  readonly planRunId: string | null;
}

interface Scan {
  readonly runs: readonly RunFacts[];
  /** Discarded-files folders whose run has no records any more (newest first). */
  readonly orphanDiscarded: readonly { readonly runId: RunId; readonly tree: Tree }[];
  readonly parked: StateSize;
  readonly lockHolder: string | null;
}

/** The run's start: its recorded time, else the second its id names. */
function startOf(runId: string, startedAt: string | null): number | null {
  if (startedAt !== null) return Date.parse(startedAt);
  return runIdSecond(runId);
}

async function scan(workspaceRoot: string): Promise<Scan> {
  const stateDir = join(workspaceRoot, STATE_DIR_NAME);
  const runsDir = join(stateDir, RUNS_DIR_NAME);
  const discardedDir = join(stateDir, DISCARDED_DIR_NAME);
  let entries: readonly RunListEntry[] = [];
  try {
    entries = (await listRuns({ workspaceRoot })).runs;
  } catch {
    entries = [];
  }
  let discardedNames: string[] = [];
  if ((await measure(discardedDir)) !== null) {
    try {
      discardedNames = (await readdir(discardedDir)).filter(isStoredRunId);
    } catch {
      discardedNames = [];
    }
  }
  const runs: RunFacts[] = [];
  for (const entry of entries) {
    const records = await measure(join(runsDir, entry.runId));
    const discardedTree = discardedNames.includes(entry.runId) ? await measure(join(discardedDir, entry.runId)) : null;
    const checked = entry.state === "checked" ? entry : null;
    const summary: StateRunSummary = {
      runId: entry.runId,
      kind: checked?.kind ?? null,
      status: checked?.status ?? null,
      startedAt: checked?.startedAt ?? null,
      records: records?.size ?? ZERO,
      // DR-44 (나), R-34 L-1: a partial revert left changes in place, so the run is not reverted.
      reverted: checked !== null && checked.reverted !== null && checked.reverted.status === "complete",
      discarded: discardedTree?.size ?? null,
      recordsChanged: await recordsChangedMarkIn(join(runsDir, entry.runId)),
    };
    runs.push({ summary, records, discardedTree, changes: checked?.changes ?? 0, planRunId: checked?.kind === "apply" ? (checked.planRunId ?? null) : null });
  }
  const known = new Set(entries.map((entry) => entry.runId as string));
  const orphanDiscarded: { runId: RunId; tree: Tree }[] = [];
  for (const name of [...discardedNames].sort().reverse()) {
    if (known.has(name)) continue;
    const tree = await measure(join(discardedDir, name));
    if (tree !== null) orphanDiscarded.push({ runId: name as RunId, tree });
  }
  const parked = (await measure(join(stateDir, PARKED_DIR_NAME)))?.size ?? ZERO;
  let lockHolder: string | null = null;
  try {
    const lock = await inspectLock(workspaceRoot);
    if (lock.state === "held") lockHolder = lock.holder.runId;
  } catch {
    lockHolder = null;
  }
  return { runs, orphanDiscarded, parked, lockHolder };
}

export const summarizeState: SummarizeState = async (request) => {
  const found = await scan(request.workspaceRoot);
  const starts = found.runs.map((run) => run.summary.startedAt).filter((at): at is string => at !== null);
  starts.sort((a, b) => Date.parse(a) - Date.parse(b));
  const folders = [...found.runs.map((run) => run.discardedTree).filter((tree): tree is Tree => tree !== null), ...found.orphanDiscarded.map((item) => item.tree)];
  return {
    runs: {
      count: found.runs.length,
      bytes: found.runs.reduce((sum, run) => sum + run.summary.records.bytes, 0),
      oldest: starts[0] ?? null,
      newest: starts[starts.length - 1] ?? null,
    },
    entries: found.runs.map((run) => run.summary),
    discarded: {
      runs: folders.length,
      files: folders.reduce((sum, tree) => sum + tree.size.files, 0),
      bytes: folders.reduce((sum, tree) => sum + tree.size.bytes, 0),
    },
    parked: found.parked,
  } satisfies StateSummary;
};

/** Whether a run matches every criterion of its part; a part with no criterion matches nothing. */
function matches(part: CleanupSelection["runs"] | CleanupSelection["discarded"], runId: string, start: number | null, reverted: boolean, now: number): boolean {
  if (part === undefined) return false;
  const { olderThanDays, runIds } = part;
  const revertedOnly = "reverted" in part ? part.reverted : undefined;
  if (olderThanDays === undefined && runIds === undefined && revertedOnly === undefined) return false;
  if (olderThanDays !== undefined && (start === null || now - start <= olderThanDays * DAY_MS)) return false;
  if (runIds !== undefined && !runIds.includes(runId)) return false;
  if (revertedOnly === true && !reverted) return false;
  return true;
}

const ordered = (codes: readonly CleanupWarningCode[]): CleanupWarningCode[] => CLEANUP_WARNING_CODES.filter((code) => codes.includes(code));

interface Planned {
  readonly plan: CleanupPlan;
  /** For each item, in plan order, the fingerprint the digest holds. */
  readonly prints: readonly string[];
}

async function makePlan(workspaceRoot: string, selection: CleanupSelection, nowText: string): Promise<Planned> {
  const now = Date.parse(nowText);
  if (!Number.isFinite(now)) throw new TypeError("planCleanup needs `now` as RUN_TIMESTAMP_PATTERN_SOURCE");
  const found = await scan(workspaceRoot);
  const items: CleanupItem[] = [];
  const prints: string[] = [];
  const blocked: { target: CleanupTarget; runId: RunId; code: CleanupBlockCode }[] = [];

  const selectedRuns = found.runs.filter((run) => run.records !== null && matches(selection.runs, run.summary.runId, startOf(run.summary.runId, run.summary.startedAt), run.summary.reverted, now));
  const blockOf = (run: RunFacts): CleanupBlockCode | null => {
    if (found.lockHolder !== null && found.lockHolder === run.summary.runId) return "lock_held";
    if (run.summary.kind !== null && run.summary.status === null) return "no_result";
    return null;
  };
  // Apply runs that will go: selected and not blocked. A plan run one of the others uses stays.
  const goingApplies = new Set(selectedRuns.filter((run) => run.summary.kind === "apply" && blockOf(run) === null).map((run) => run.summary.runId as string));
  const discardedCandidates = [
    ...found.runs.filter((run) => run.discardedTree !== null).map((run) => ({ runId: run.summary.runId, tree: run.discardedTree as Tree, run: run as RunFacts | null })),
    ...found.orphanDiscarded.map((item) => ({ runId: item.runId, tree: item.tree, run: null as RunFacts | null })),
  ].filter((item) => matches(selection.discarded, item.runId, startOf(item.runId, item.run?.summary.startedAt ?? null), false, now));

  for (const run of selectedRuns) {
    const id = run.summary.runId;
    let code = blockOf(run);
    if (code === null && run.summary.kind === "run") {
      const usedBy = found.runs.some((other) => other.planRunId === id && !goingApplies.has(other.summary.runId));
      if (usedBy) code = "plan_used_by_apply";
    }
    if (code !== null) {
      blocked.push({ target: "run", runId: id, code });
      continue;
    }
    const warnings: CleanupWarningCode[] = [];
    if (run.summary.kind !== null && run.changes > 0 && !run.summary.reverted) warnings.push("not_reverted");
    // DR-44 (다), R-34 L-2: its discarded-files folder stays unless its removal is confirmed apart.
    if (run.summary.kind === "apply" && run.discardedTree !== null) warnings.push("discarded_left");
    if (run.summary.recordsChanged) warnings.push("records_changed");
    items.push({ target: "run", runId: id, size: (run.records as Tree).size, warnings: ordered(warnings) });
    prints.push((run.records as Tree).print);
  }
  for (const item of discardedCandidates) {
    const run = item.run;
    let code: CleanupBlockCode | null = null;
    if (found.lockHolder !== null && found.lockHolder === item.runId) code = "lock_held";
    else if (run !== null && run.summary.kind !== null && run.summary.status === null) code = "no_result";
    if (code !== null) {
      blocked.push({ target: "discarded", runId: item.runId, code });
      continue;
    }
    const warnings: CleanupWarningCode[] = ["people_files"];
    if (run?.summary.recordsChanged === true) warnings.push("records_changed");
    items.push({ target: "discarded", runId: item.runId, size: item.tree.size, warnings: ordered(warnings) });
    prints.push(item.tree.print);
  }

  const total = (target: CleanupTarget) => {
    const chosen = items.filter((item) => item.target === target);
    return { count: chosen.length, files: chosen.reduce((sum, item) => sum + item.size.files, 0), bytes: chosen.reduce((sum, item) => sum + item.size.bytes, 0) };
  };
  const totals = { runs: total("run"), discarded: total("discarded") };
  const digest = sha256Hex(JSON.stringify({ items, blocked, totals, parked: found.parked, prints })) as ContentHash;
  return { plan: { items, blocked, totals, parked: found.parked, digest }, prints };
}

export const planCleanup: PlanCleanup = async (request) => (await makePlan(request.workspaceRoot, request.selection, request.now)).plan;

/** Whether `.codaryn/discarded` has an entry named exactly `runId` (N-27 (a), as for run directories). */
async function hasExactDiscardedEntry(discardedDir: string, runId: string): Promise<boolean> {
  try {
    return (await readdir(discardedDir)).includes(runId);
  } catch {
    return false;
  }
}

/** How applyCleanup removes a directory it moved aside; for tests. */
export interface CleanupOperations {
  readonly remove?: (dir: string) => Promise<void>;
  /** Wait between the REMOVE_ATTEMPTS attempts. */
  readonly retryDelayMs?: number;
}

/** A removal that fails (a file another process has open, a denied delete) is tried this often. */
const REMOVE_ATTEMPTS = 4;

export const applyCleanup: ApplyCleanup = (request) => applyCleanupWith(request);

/** applyCleanup with the removal step given (CleanupOperations), for tests. */
export async function applyCleanupWith(request: Parameters<ApplyCleanup>[0], operations: CleanupOperations = {}): Promise<Awaited<ReturnType<ApplyCleanup>>> {
  const { workspaceRoot, selection, now, confirmation } = request;
  const remove = operations.remove ?? ((dir: string) => rm(dir, { recursive: true, force: true }));
  const retryDelayMs = operations.retryDelayMs ?? 100;
  /** True when `dir` is gone in the end. */
  const removeAside = async (dir: string): Promise<boolean> => {
    for (let attempt = 1; attempt <= REMOVE_ATTEMPTS; attempt += 1) {
      try {
        await remove(dir);
        return true;
      } catch {
        if (attempt < REMOVE_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
    return false;
  };
  const stateDir = await ensureStateDir(workspaceRoot);
  const lockId = `cleanup-${randomBytes(4).toString("hex")}`;
  const lock = await acquireLock({ workspaceRoot, runId: lockId, clock: { now: () => Date.now() } });
  if (!lock.ok) return { ok: false, code: "workspace_locked" };
  try {
    const { plan, prints } = await makePlan(workspaceRoot, selection, now);
    if (plan.digest !== confirmation.digest) return { ok: false, code: "plan_changed" };
    const removed: { target: CleanupTarget; runId: RunId; size: StateSize }[] = [];
    const kept: { target: CleanupTarget; runId: RunId; reason: CleanupKeptReason }[] = [];
    for (const [index, item] of plan.items.entries()) {
      if (item.target === "discarded" && !confirmation.discarded) {
        kept.push({ target: item.target, runId: item.runId, reason: "not_confirmed" });
        continue;
      }
      const parent = join(stateDir, item.target === "run" ? RUNS_DIR_NAME : DISCARDED_DIR_NAME);
      const dir = join(parent, item.runId);
      const exact = item.target === "run" ? await hasExactRunEntry(workspaceRoot, item.runId) : await hasExactDiscardedEntry(parent, item.runId);
      const tree = exact ? await measure(dir) : null;
      if (tree === null) {
        kept.push({ target: item.target, runId: item.runId, reason: "not_plain_directory" });
        continue;
      }
      if (tree.print !== prints[index]) {
        kept.push({ target: item.target, runId: item.runId, reason: "changed" });
        continue;
      }
      // Renamed aside first, so no half-removed run directory is ever left in place.
      const aside = join(stateDir, `cleanup-${randomBytes(8).toString("hex")}`);
      try {
        await rename(dir, aside);
      } catch {
        kept.push({ target: item.target, runId: item.runId, reason: "io_error" });
        continue;
      }
      // DR-44 (라), R-34 L-3: what is left aside is not removed; it is not reported or logged as removed.
      if (!(await removeAside(aside))) {
        kept.push({ target: item.target, runId: item.runId, reason: "io_error" });
        continue;
      }
      removed.push({ target: item.target, runId: item.runId, size: item.size });
    }
    const total = (target: CleanupTarget) => {
      const chosen = removed.filter((item) => item.target === target);
      return { count: chosen.length, files: chosen.reduce((sum, item) => sum + item.size.files, 0), bytes: chosen.reduce((sum, item) => sum + item.size.bytes, 0) };
    };
    const totals = { runs: total("run"), discarded: total("discarded") };
    const line: CleanupLogLine = { schemaVersion: 1, at: new Date().toISOString(), runs: totals.runs, discarded: totals.discarded };
    try {
      await appendFile(join(stateDir, CLEANUP_LOG_FILE_NAME), `${JSON.stringify(line)}\n`, "utf8");
    } catch (error) {
      // The removal happened; a log that cannot be written does not undo it.
      void errorCode(error);
    }
    return { ok: true, removed, kept, totals };
  } finally {
    await releaseLock({ workspaceRoot, runId: lockId }).catch(() => false);
  }
}
