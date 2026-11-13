/**
 * DR-39 (DR-9, R-19 I-5): seeing and cleaning up the state directory (src/contracts/cleanup.ts).
 * summarizeState and planCleanup read only; applyCleanup removes, under the workspace lock, only
 * what a plan made again has the confirmed digest for. Run records (`runs/<runId>/`) and discarded-
 * files folders (`discarded/<runId>/`, people's files) are confirmed apart. Parked files, the lock
 * file, `.gitignore` and anything else are never removed. Exact run directory names and plain
 * directories only; no link is followed, and a run directory that is a link is not an item.
 *
 * DR-44 (R-34): records of runs that were not, or only partly, reverted go only with
 * `includeNotReverted`; an apply run whose records are an item is warned about whenever its
 * discarded files could stay; apply runs are handled before the plan runs they use, and a plan run
 * whose apply run stays is kept; a folder moved aside that cannot be removed entirely is kept as
 * `partly_removed`, never reported or logged as removed, and the next plan shows it (a leftover).
 */

import { randomBytes } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { appendFile, lstat, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  CLEANUP_LEFTOVER_MARK_FILE_NAME,
  PLAN_APPLIED_FILE_NAME,
  CLEANUP_LEFTOVER_PATTERN_SOURCE,
  CLEANUP_LOG_FILE_NAME,
  CLEANUP_WARNING_CODES,
  DISCARDED_DIR_NAME,
  PARKED_DIR_NAME,
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
  cleanupRecordWarnings,
  isCleanupLeftoverMark,
  needsNotRevertedConfirmation,
  selectedAsReverted,
} from "../contracts/index.js";
import type {
  ApplyCleanup,
  CleanupLeftoverMark,
  CleanupBlockCode,
  CleanupItem,
  CleanupItemRef,
  CleanupKeptReason,
  CleanupLogLine,
  CleanupPlan,
  CleanupSelection,
  CleanupWarningCode,
  ContentHash,
  LastRevert,
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
const LEFTOVER = new RegExp(CLEANUP_LEFTOVER_PATTERN_SOURCE);
const LEFTOVER_PREFIX = "cleanup-";
/** A mark file larger than this is not read (the mark is a few dozen bytes). */
const MAX_MARK_BYTES = 4096;

/**
 * R-34b P-2: whether the folder `dir` holds its own mark (CLEANUP_LEFTOVER_MARK_FILE_NAME as a plain
 * file whose JSON is isCleanupLeftoverMark for `leftoverId`). applyCleanup writes it right after the
 * move aside and removes it last, so what a failed removal leaves still has it.
 */
async function hasOwnMark(dir: string, leftoverId: string): Promise<boolean> {
  const read = async (name: string): Promise<unknown> => {
    const file = join(dir, name);
    const info = await lstat(file);
    if (!info.isFile() || info.size > MAX_MARK_BYTES) throw new Error("not a mark file");
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  };
  try {
    if (isCleanupLeftoverMark(await read(CLEANUP_LEFTOVER_MARK_FILE_NAME), leftoverId)) return true;
  } catch {
    // No mark of this build; the earlier one may be there.
  }
  try {
    return isEarlierMark(await read(EARLIER_MARK_FILE_NAME));
  } catch {
    return false;
  }
}

/**
 * U-7 (R-40 L-1): the mark the build of 6f85b65 wrote into a folder it moved aside (never released,
 * but development workspaces may hold one): `.codaryn-cleanup` with exactly
 * {schemaVersion: 1, kind: "cleanup_leftover", target: "run" | "discarded", at: <string>}. A folder
 * with it is a leftover too; this build writes only CLEANUP_LEFTOVER_MARK_FILE_NAME.
 */
const EARLIER_MARK_FILE_NAME = ".codaryn-cleanup";

function isEarlierMark(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (Object.keys(value).sort().join(",") !== "at,kind,schemaVersion,target") return false;
  const mark = value as Record<string, unknown>;
  return mark["schemaVersion"] === 1 && mark["kind"] === "cleanup_leftover" && (mark["target"] === "run" || mark["target"] === "discarded") && typeof mark["at"] === "string";
}

/** The mark files of a leftover: removed after everything else in it. */
const MARK_FILE_NAMES: readonly string[] = [CLEANUP_LEFTOVER_MARK_FILE_NAME, EARLIER_MARK_FILE_NAME];

/** U-13: whether a discarded-files folder holds at least one file (an empty one holds nothing to lose). */
const holdsFiles = (tree: Tree | null): boolean => tree !== null && tree.size.files > 0;

/** The apply run a plan run's PLAN_APPLIED_FILE_NAME names, or null when there is no such readable record. */
async function appliedBy(planRunDir: string, planRunId: string): Promise<string | null> {
  const file = join(planRunDir, PLAN_APPLIED_FILE_NAME);
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size > MAX_MARK_BYTES) return null;
    const record = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (typeof record !== "object" || record === null || Array.isArray(record)) return null;
    const { kind, planRunId: named, applyRunId } = record as Record<string, unknown>;
    return kind === "plan_applied" && named === planRunId && typeof applyRunId === "string" ? applyRunId : null;
  } catch {
    return null;
  }
}

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
  readonly lastRevert: LastRevert;
}

interface Scan {
  readonly runs: readonly RunFacts[];
  /** Discarded-files folders whose run has no records any more (newest first). */
  readonly orphanDiscarded: readonly { readonly runId: RunId; readonly tree: Tree }[];
  /** DR-44 (d): folders an earlier cleanup could not remove entirely, by name. */
  readonly leftovers: readonly { readonly leftoverId: string; readonly tree: Tree }[];
  /** R-34b P-2: folders named like a leftover without their own mark: shown, never items. */
  readonly unknownFolders: readonly Tree[];
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
    const lastRevert: LastRevert = checked?.reverted?.status ?? null;
    const summary: StateRunSummary = {
      runId: entry.runId,
      kind: checked?.kind ?? null,
      status: checked?.status ?? null,
      startedAt: checked?.startedAt ?? null,
      records: records?.size ?? ZERO,
      // DR-44 (b): a partial revert left changes in place, so the run is not reverted.
      reverted: lastRevert === "complete",
      partlyReverted: lastRevert === "partial",
      discarded: discardedTree?.size ?? null,
      recordsChanged: await recordsChangedMarkIn(join(runsDir, entry.runId)),
    };
    runs.push({
      summary,
      records,
      discardedTree,
      changes: checked?.changes ?? 0,
      planRunId: checked?.kind === "apply" ? (checked.planRunId ?? null) : null,
      lastRevert,
    });
  }
  // R-47 R47-M1: a run whose records cannot be checked and whose discarded-files folder holds files is
  // treated as an apply run that left them. Its own records do not say which plan it used; the plan
  // run's record of the apply that claimed it (PLAN_APPLIED_FILE_NAME) does.
  const unreadableWithFiles = runs.filter((run) => run.summary.kind === null && holdsFiles(run.discardedTree));
  if (unreadableWithFiles.length > 0) {
    const claimedBy = new Map<string, string>();
    for (const run of runs) {
      if (run.summary.kind !== "run") continue;
      const applyRunId = await appliedBy(join(runsDir, run.summary.runId), run.summary.runId);
      if (applyRunId !== null) claimedBy.set(applyRunId, run.summary.runId);
    }
    for (const run of unreadableWithFiles) (run as { planRunId: string | null }).planRunId = claimedBy.get(run.summary.runId) ?? null;
  }
  const known = new Set(entries.map((entry) => entry.runId as string));
  const orphanDiscarded: { runId: RunId; tree: Tree }[] = [];
  for (const name of [...discardedNames].sort().reverse()) {
    if (known.has(name)) continue;
    const tree = await measure(join(discardedDir, name));
    if (tree !== null) orphanDiscarded.push({ runId: name as RunId, tree });
  }
  const leftovers: { leftoverId: string; tree: Tree }[] = [];
  const unknownFolders: Tree[] = [];
  let stateNames: string[] = [];
  try {
    stateNames = await readdir(stateDir);
  } catch {
    stateNames = [];
  }
  for (const name of stateNames.filter((entry) => LEFTOVER.test(entry)).sort()) {
    const leftoverId = name.slice(LEFTOVER_PREFIX.length);
    const tree = await measure(join(stateDir, name));
    if (tree === null) continue;
    // R-34b P-2: a folder of that name without its own mark is not cleanup's: shown, never an item.
    if (await hasOwnMark(join(stateDir, name), leftoverId)) leftovers.push({ leftoverId, tree });
    else unknownFolders.push(tree);
  }
  const parked = (await measure(join(stateDir, PARKED_DIR_NAME)))?.size ?? ZERO;
  let lockHolder: string | null = null;
  try {
    const lock = await inspectLock(workspaceRoot);
    if (lock.state === "held") lockHolder = lock.holder.runId;
  } catch {
    lockHolder = null;
  }
  return { runs, orphanDiscarded, leftovers, unknownFolders, parked, lockHolder };
}

const sizeOf = (trees: readonly Tree[]): StateSize => ({
  files: trees.reduce((sum, tree) => sum + tree.size.files, 0),
  bytes: trees.reduce((sum, tree) => sum + tree.size.bytes, 0),
});

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
    discarded: { runs: folders.length, ...sizeOf(folders) },
    parked: found.parked,
    leftovers: { count: found.leftovers.length, ...sizeOf(found.leftovers.map((item) => item.tree)) },
    // R-34b P-2: absent when there is none.
    ...(found.unknownFolders.length > 0 ? { unknownFolders: { count: found.unknownFolders.length, ...sizeOf(found.unknownFolders) } } : {}),
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

/** What applyCleanup needs to know of a run item besides the plan: its kind and the plan run it uses. */
interface ItemFacts {
  readonly kind: "run" | "apply" | null;
  readonly planRunId: string | null;
}

/**
 * The order applyCleanup handles a plan's items in, plan order within each step. U-13: discarded-files
 * folders first, so an apply's records go only after its folder went. DR-44 (a): then apply runs, then
 * the other runs (their plan runs among them), then leftovers. U-86: the preview foresees in it too.
 */
function cleanupOrder(items: readonly CleanupItem[], facts: readonly (ItemFacts | null)[]): { item: CleanupItem; index: number }[] {
  const rank = (item: CleanupItem, index: number): number =>
    item.target === "discarded" ? 0 : item.target === "run" ? (facts[index]?.kind === "apply" || (facts[index]?.planRunId ?? null) !== null ? 1 : 2) : 3;
  return items.map((item, index) => ({ item, index })).sort((a, b) => rank(a.item, a.index) - rank(b.item, b.index) || a.index - b.index);
}

interface Planned {
  readonly plan: CleanupPlan;
  /** For each item, in plan order, the fingerprint the digest holds. */
  readonly prints: readonly string[];
  /** For each item, in plan order (null for a discarded-files or leftover folder). */
  readonly facts: readonly (ItemFacts | null)[];
}

async function makePlan(workspaceRoot: string, selection: CleanupSelection, nowText: string): Promise<Planned> {
  const now = Date.parse(nowText);
  if (!Number.isFinite(now)) throw new TypeError("planCleanup needs `now` as RUN_TIMESTAMP_PATTERN_SOURCE");
  const found = await scan(workspaceRoot);
  const items: CleanupItem[] = [];
  const prints: string[] = [];
  const facts: (ItemFacts | null)[] = [];
  const blocked: { target: "run" | "discarded"; runId: RunId; code: CleanupBlockCode }[] = [];

  const selectedRuns = found.runs.filter(
    (run) => run.records !== null && matches(selection.runs, run.summary.runId, startOf(run.summary.runId, run.summary.startedAt), selectedAsReverted(run.lastRevert), now),
  );
  const blockOf = (run: RunFacts): CleanupBlockCode | null => {
    if (found.lockHolder !== null && found.lockHolder === run.summary.runId) return "lock_held";
    if (run.summary.kind !== null && run.summary.status === null) return "no_result";
    return null;
  };
  // Apply runs that will go: selected and not blocked. A plan run one of the others uses stays.
  const goingApplies = new Set(selectedRuns.filter((run) => (run.summary.kind === "apply" || run.planRunId !== null) && blockOf(run) === null).map((run) => run.summary.runId as string));
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
    // DR-44 (a)-(c): the contract's one rule for a run's records; R-34b P-1: records that cannot be
    // checked (kind null) get records_unreadable and are confirmed apart like a run not reverted.
    const recordWarnings = cleanupRecordWarnings({
      kind: run.summary.kind,
      changes: run.changes,
      lastRevert: run.lastRevert,
      // U-13: a folder that holds at least one file; an empty one holds nothing to lose.
      hasDiscarded: holdsFiles(run.discardedTree),
      recordsChanged: run.summary.recordsChanged,
    });
    // R-47 R47-M1: records that cannot be checked beside discarded files: the same warning as an apply's.
    const warnings = run.summary.kind === null && holdsFiles(run.discardedTree) ? ordered([...recordWarnings, "discarded_left"]) : recordWarnings;
    items.push({ target: "run", runId: id, size: (run.records as Tree).size, warnings });
    prints.push((run.records as Tree).print);
    facts.push({ kind: run.summary.kind, planRunId: run.planRunId });
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
    facts.push(null);
  }
  // DR-44 (d): what an earlier cleanup could not remove entirely; always included, last.
  for (const leftover of found.leftovers) {
    items.push({ target: "leftover", leftoverId: leftover.leftoverId, size: leftover.tree.size, warnings: ["leftover"] });
    prints.push(leftover.tree.print);
    facts.push(null);
  }

  const totals = totalsOf(items);
  const digest = sha256Hex(JSON.stringify({ items, blocked, totals, parked: found.parked, prints })) as ContentHash;
  return { plan: { items, blocked, totals, parked: found.parked, digest }, prints, facts };
}

/** CleanupPlan.totals of `items` (the items of a plan, or what was removed). */
function totalsOf(items: readonly (CleanupItemRef & { readonly size: StateSize; readonly warnings?: readonly CleanupWarningCode[] })[]): CleanupPlan["totals"] {
  const of = (target: CleanupItemRef["target"]) => {
    const chosen = items.filter((item) => item.target === target);
    return { count: chosen.length, files: chosen.reduce((sum, item) => sum + item.size.files, 0), bytes: chosen.reduce((sum, item) => sum + item.size.bytes, 0) };
  };
  const runs = of("run");
  const notReverted = items.filter((item) => item.target === "run" && needsNotRevertedConfirmation(item.warnings ?? [])).length;
  return { runs: { count: runs.count, notReverted, files: runs.files, bytes: runs.bytes }, discarded: of("discarded"), leftovers: of("leftover") };
}

export const planCleanup: PlanCleanup = async (request) => (await makePlan(request.workspaceRoot, request.selection, request.now)).plan;

/** U-86: a confirmation's two switches (CleanupConfirmation without its digest). */
export interface CleanupSwitches {
  readonly includeNotReverted: boolean;
  readonly discarded: boolean;
}

/**
 * U-86 (C-18): what a confirmed cleanup does with a plan item, as applyCleanup decides it when every
 * removal succeeds: removed, or kept for a reason the confirmation decides. A plan run kept because
 * an apply run that uses it is kept names that apply run. What a removal itself can meet (changed,
 * not_plain_directory, io_error, partly_removed) is not foreseen.
 */
export type PredictedCleanupFate =
  | { readonly removed: true }
  | { readonly removed: false; readonly reason: "not_reverted_not_confirmed" | "discarded_left" | "not_confirmed" }
  | { readonly removed: false; readonly reason: "used_by_kept_apply"; readonly keptWith: RunId };

/** U-86: applyCleanup's decisions on `plan` under `switches`, in its order (cleanupOrder), without removing. */
function predictFates(plan: CleanupPlan, facts: readonly (ItemFacts | null)[], switches: CleanupSwitches): PredictedCleanupFate[] {
  const fates: PredictedCleanupFate[] = plan.items.map(() => ({ removed: true }));
  // The discarded-files folders this cleanup removes; they go before any run's records.
  const foldersGoing = new Set<string>(switches.discarded ? plan.items.flatMap((item) => (item.target === "discarded" ? [item.runId] : [])) : []);
  /** Plan runs a kept apply run uses, each with the first such apply run. */
  const plansOfKeptApplies = new Map<string, RunId>();
  for (const { item, index } of cleanupOrder(plan.items, facts)) {
    if (item.target === "run") {
      const itemFacts = facts[index] ?? null;
      const keepApply = (reason: "not_reverted_not_confirmed" | "discarded_left"): void => {
        fates[index] = { removed: false, reason };
        const planRunId = itemFacts?.planRunId ?? null;
        if (planRunId !== null && !plansOfKeptApplies.has(planRunId)) plansOfKeptApplies.set(planRunId, item.runId);
      };
      if (needsNotRevertedConfirmation(item.warnings) && !switches.includeNotReverted) {
        keepApply("not_reverted_not_confirmed");
        continue;
      }
      // A run that is not known to be a plain run, with files in its discarded-files folder (the
      // warning says so), keeps its records unless that folder goes in the same cleanup.
      if (itemFacts?.kind !== "run" && item.warnings.includes("discarded_left") && !foldersGoing.has(item.runId)) {
        keepApply("discarded_left");
        continue;
      }
      const keptWith = plansOfKeptApplies.get(item.runId);
      if (keptWith !== undefined) fates[index] = { removed: false, reason: "used_by_kept_apply", keptWith };
    } else if (item.target === "discarded" && !switches.discarded) {
      fates[index] = { removed: false, reason: "not_confirmed" };
    }
  }
  return fates;
}

/**
 * U-86 (C-18): planCleanup's plan and, for each confirmation asked, what a confirmed cleanup does with
 * each item, in plan order. Reads only; the plan is planCleanup's, unchanged.
 */
export async function previewCleanup(
  request: Parameters<PlanCleanup>[0],
  confirmations: readonly CleanupSwitches[],
): Promise<{ readonly plan: CleanupPlan; readonly fates: readonly (readonly PredictedCleanupFate[])[] }> {
  const { plan, facts } = await makePlan(request.workspaceRoot, request.selection, request.now);
  return { plan, fates: confirmations.map((switches) => predictFates(plan, facts, switches)) };
}

/**
 * U-86 (UXM-1): the discarded-files folders whose run has no records any more and that hold at least
 * one file. Nothing says any more what those files were called or where they were. Reads only.
 */
export async function recordlessDiscarded(request: { readonly workspaceRoot: string }): Promise<{ readonly count: number } & StateSize> {
  const folders = (await scan(request.workspaceRoot)).orphanDiscarded.filter((item) => holdsFiles(item.tree));
  return { count: folders.length, ...sizeOf(folders.map((item) => item.tree)) };
}

/** Whether `parent` has an entry named exactly `name` (N-27 (a), as for run directories). */
async function hasExactEntry(parent: string, name: string): Promise<boolean> {
  try {
    return (await readdir(parent)).includes(name);
  } catch {
    return false;
  }
}

/** How applyCleanup removes a directory it moved aside; for tests. */
export interface CleanupOperations {
  readonly remove?: (dir: string) => Promise<void>;
  /** Writes the mark file (exclusive create). */
  readonly writeMark?: (file: string, text: string) => Promise<void>;
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
  const writeMark = operations.writeMark ?? ((file: string, text: string) => writeFile(file, text, { encoding: "utf8", flag: "wx" }));
  /**
   * Writes the folder's mark. A plain file already at the mark's name (inside records the person
   * confirmed for removal) is replaced; anything else there, or any other failure, is false.
   */
  const marked = async (dir: string, leftoverId: string): Promise<boolean> => {
    const file = join(dir, CLEANUP_LEFTOVER_MARK_FILE_NAME);
    const mark: CleanupLeftoverMark = { schemaVersion: 1, kind: "cleanup_leftover", leftoverId };
    const text = `${JSON.stringify(mark)}\n`;
    try {
      await writeMark(file, text);
      return true;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") return false;
    }
    try {
      if (!(await lstat(file)).isFile()) return false;
      await rm(file);
      await writeMark(file, text);
      return true;
    } catch {
      return false;
    }
  };
  /** True when `path` is gone in the end (REMOVE_ATTEMPTS tries). */
  const removeTried = async (path: string): Promise<boolean> => {
    for (let attempt = 1; attempt <= REMOVE_ATTEMPTS; attempt += 1) {
      try {
        await remove(path);
        return true;
      } catch {
        if (attempt < REMOVE_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
    return false;
  };
  /**
   * True when the folder `dir` moved aside is gone in the end. Its contents go first, the marker
   * after them and the folder last, so what is left of a failed removal still has the marker.
   */
  const removeAside = async (dir: string): Promise<boolean> => {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return false;
    }
    let whole = true;
    for (const name of names) {
      if (!MARK_FILE_NAMES.includes(name) && !(await removeTried(join(dir, name)))) whole = false;
    }
    if (!whole) return false;
    for (const name of MARK_FILE_NAMES) {
      if (names.includes(name) && !(await removeTried(join(dir, name)))) return false;
    }
    return removeTried(dir);
  };
  const stateDir = await ensureStateDir(workspaceRoot);
  const lockId = `cleanup-${randomBytes(4).toString("hex")}`;
  const lock = await acquireLock({ workspaceRoot, runId: lockId, clock: { now: () => Date.now() } });
  if (!lock.ok) return { ok: false, code: "workspace_locked" };
  try {
    const { plan, prints, facts } = await makePlan(workspaceRoot, selection, now);
    if (plan.digest !== confirmation.digest) return { ok: false, code: "plan_changed" };
    const removed: (CleanupItemRef & { size: StateSize; warnings: readonly CleanupWarningCode[] })[] = [];
    const kept: (CleanupItemRef & { reason: CleanupKeptReason })[] = [];
    const refOf = (item: CleanupItem): CleanupItemRef =>
      item.target === "leftover" ? { target: "leftover", leftoverId: item.leftoverId } : { target: item.target, runId: item.runId };
    const keep = (item: CleanupItem, reason: CleanupKeptReason): void => {
      kept.push({ ...refOf(item), reason });
    };
    // U-13: discarded-files folders first, so an apply's records go only after its folder went.
    // DR-44 (a): then apply runs, then the other runs (their plan runs among them), then leftovers.
    const order = cleanupOrder(plan.items, facts);
    /** Plan runs an apply run uses that was selected and stays. */
    const plansOfKeptApplies = new Set<string>();
    /** U-13: runs whose discarded-files folder this cleanup moved aside and could not remove entirely. */
    const discardedPartlyLeft = new Set<string>();
    /**
     * U-13 (UXM-1): whether a discarded file of the apply run `runId` is left: its folder holds a file
     * now (looked at again right before its records go), cannot be looked at, or was not removed
     * entirely just before. Without the records nothing says what those files were.
     */
    const discardedLeft = async (runId: string): Promise<boolean> => {
      if (discardedPartlyLeft.has(runId)) return true;
      const dir = join(stateDir, DISCARDED_DIR_NAME, runId);
      try {
        await lstat(dir);
      } catch (error) {
        return errorCode(error) !== "ENOENT";
      }
      const tree = await measure(dir);
      return tree === null || tree.size.files > 0;
    };

    for (const { item, index } of order) {
      const itemFacts = facts[index] ?? null;
      const keepApply = (reason: CleanupKeptReason): void => {
        keep(item, reason);
        if (itemFacts !== null && itemFacts.planRunId !== null) plansOfKeptApplies.add(itemFacts.planRunId);
      };
      if (item.target === "run" && needsNotRevertedConfirmation(item.warnings) && !confirmation.includeNotReverted) {
        keepApply("not_reverted_not_confirmed");
        continue;
      }
      // R-47 R47-M1: also a run whose records cannot be checked (not known to be a plain run).
      if (item.target === "run" && itemFacts?.kind !== "run" && (await discardedLeft(item.runId))) {
        keepApply("discarded_left");
        continue;
      }
      if (item.target === "run" && plansOfKeptApplies.has(item.runId)) {
        keep(item, "used_by_kept_apply");
        continue;
      }
      if (item.target === "discarded" && !confirmation.discarded) {
        keep(item, "not_confirmed");
        continue;
      }
      let dir: string;
      let exact: boolean;
      if (item.target === "leftover") {
        const name = `${LEFTOVER_PREFIX}${item.leftoverId}`;
        dir = join(stateDir, name);
        exact = LEFTOVER.test(name) && (await hasExactEntry(stateDir, name)) && (await hasOwnMark(dir, item.leftoverId));
      } else {
        const parent = join(stateDir, item.target === "run" ? RUNS_DIR_NAME : DISCARDED_DIR_NAME);
        dir = join(parent, item.runId);
        exact = item.target === "run" ? await hasExactRunEntry(workspaceRoot, item.runId) : await hasExactEntry(parent, item.runId);
      }
      const tree = exact ? await measure(dir) : null;
      if (tree === null) {
        keepApply("not_plain_directory");
        continue;
      }
      if (tree.print !== prints[index]) {
        keepApply("changed");
        continue;
      }
      let aside = dir;
      if (item.target !== "leftover") {
        // Renamed aside first, so no half-removed run directory is ever left in place.
        const leftoverId = randomBytes(8).toString("hex");
        aside = join(stateDir, `${LEFTOVER_PREFIX}${leftoverId}`);
        try {
          await rename(dir, aside);
        } catch {
          keepApply("io_error");
          continue;
        }
        // R-34b P-2: its mark, right after the move. U-7 (R-40 L-2): without the mark nothing of it is
        // removed; the folder goes back to its place (io_error), so it can be selected again. Only when
        // it cannot go back either does it stay aside, as a folder not removed entirely.
        if (!(await marked(aside, leftoverId))) {
          let back = true;
          try {
            await rename(aside, dir);
          } catch {
            back = false;
          }
          // U-13: a discarded-files folder that stays aside still holds the run's discarded files.
          if (!back && item.target === "discarded") discardedPartlyLeft.add(item.runId);
          keepApply(back ? "io_error" : "partly_removed");
          continue;
        }
      }
      // DR-44 (d): what is left aside is a leftover the next plan shows; not reported or logged as removed.
      if (!(await removeAside(aside))) {
        if (item.target === "discarded") discardedPartlyLeft.add(item.runId);
        keepApply("partly_removed");
        continue;
      }
      removed.push({ ...refOf(item), size: item.size, warnings: item.warnings });
    }
    const totals = totalsOf(removed);
    const line: CleanupLogLine = {
      schemaVersion: 1,
      at: new Date().toISOString(),
      runs: { count: totals.runs.count, files: totals.runs.files, bytes: totals.runs.bytes },
      discarded: totals.discarded,
      ...(totals.leftovers.count > 0 ? { leftovers: totals.leftovers } : {}),
    };
    try {
      await appendFile(join(stateDir, CLEANUP_LOG_FILE_NAME), `${JSON.stringify(line)}\n`, "utf8");
    } catch (error) {
      // The removal happened; a log that cannot be written does not undo it.
      void errorCode(error);
    }
    return { ok: true, removed: removed.map(({ warnings: _warnings, ...entry }) => entry), kept, totals };
  } finally {
    await releaseLock({ workspaceRoot, runId: lockId }).catch(() => false);
  }
}
