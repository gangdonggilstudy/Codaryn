/**
 * DR-38 (R-24 L-1, DR-37 (b)): the state guard (StateGuard, src/contracts/state.ts), made together
 * with the run's journal and recorders (createRunRecorders) so it knows what the run itself wrote.
 *
 * - A fingerprint walks one tier of `.codaryn/` without following links. Each entry has its kind and
 *   file id; a regular file also its size and change times, and the SHA-256 of the record files the
 *   views trust (tier "run": every file of the run's records but the `.orig` snapshots; tier "state":
 *   the record files of other runs and the top-level files, not journals, snapshots, discarded or
 *   parked files). The fingerprint object holds only its tier; the entries stay inside the guard.
 * - The writers note each file they leave (its expected SHA-256 and size, and its metadata right
 *   after the write) and each directory they make. compare(before, after) takes a difference as the
 *   run's own only when the run wrote that path between the two fingerprints and the path is now
 *   exactly as the run left it. So a line appended by anything else to the journal is found even
 *   after the run's next line (the expected SHA-256 is of the run's own bytes).
 * - Tier "run": a path that cannot be read is a change (fail closed). Tier "state": MAX_STATE_ENTRIES,
 *   MAX_STATE_HASH_BYTES and read errors make the fingerprint `limited`; the part not fingerprinted
 *   is not compared. In tier "run" a file over the hash budget keeps a metadata fingerprint (a
 *   known limit: an edit of the same size that also restores the change times goes unseen).
 */

import type { BigIntStats } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import {
  DISCARDED_DIR_NAME,
  JOURNAL_FILE_NAME,
  LOCK_FILE_NAME,
  MAX_STATE_ENTRIES,
  MAX_STATE_HASH_BYTES,
  PARKED_DIR_NAME,
  RECORDS_CHANGED_FILE_NAME,
  RUNS_DIR_NAME,
  RUN_TIMESTAMP_PATTERN_SOURCE,
  STATE_DIR_NAME,
} from "../contracts/index.js";
import type {
  ApplyJournalEntry,
  CreateApplyRecorders,
  CreateRunRecorders,
  JournalEvent,
  MaskedText,
  RawText,
  RecordsChangedMark,
  RunRecorders,
  RunRecordersOptions,
  StateComparison,
  StateFingerprint,
  StateGuard,
  StateTier,
} from "../contracts/index.js";
import { changeRecorderWith } from "./changes.js";
import { discardedRootPath } from "./discarded.js";
import { assertRunId, createExclusive, errorCode, hasExactRunEntry, isPlainDirectory, replaceAtomically, runDir, sha256Hex } from "./common.js";
import { appendOnlyJournal } from "./journal.js";
import { markPlanAppliedWith, planRecorderWith } from "./plan.js";
import type { RunWriteNotes } from "./run-writes.js";
import { isStoredRunId } from "./runs.js";

/** A record file of another run larger than this keeps a metadata fingerprint (tier "state"). */
const MAX_STATE_FILE_HASH_BYTES = 1024 * 1024;
/** How many record files a fingerprint reads at once. */
const READ_CONCURRENCY = 32;
/** A records-changed mark larger than this is not joined; a new one replaces it. */
const MAX_MARK_BYTES = 8 * 1024 * 1024;

type Entry =
  | { readonly kind: "dir"; readonly ino: bigint }
  | { readonly kind: "file"; readonly size: bigint; readonly mtimeNs: bigint; readonly ctimeNs: bigint; readonly ino: bigint; readonly sha256: string | null }
  | { readonly kind: "other"; readonly size: bigint; readonly mtimeNs: bigint; readonly ctimeNs: bigint; readonly ino: bigint }
  | { readonly kind: "unreadable" };

interface Print {
  readonly tier: StateTier;
  /** The write log's position when the fingerprint was taken. */
  readonly seq: number;
  readonly entries: Map<string, Entry>;
  limited: boolean;
  /** Set when the walk stopped at MAX_STATE_ENTRIES: the last path it took (walk order). */
  cut: string | null;
}

function entryOf(info: BigIntStats, sha256: string | null, size: bigint = info.size): Entry {
  if (info.isDirectory()) return { kind: "dir", ino: info.ino };
  const meta = { size, mtimeNs: info.mtimeNs, ctimeNs: info.ctimeNs, ino: info.ino };
  return info.isFile() ? { kind: "file", ...meta, sha256 } : { kind: "other", ...meta };
}

/** Two entries describe the same thing: by content when both hashed it, else by metadata. */
function sameEntry(a: Entry | undefined, b: Entry | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.kind === "unreadable" || b.kind === "unreadable") return false;
  if (a.kind === "dir" || b.kind === "dir") return a.kind === b.kind && a.ino === b.ino;
  if (a.kind !== b.kind) return false;
  if (a.kind === "file" && b.kind === "file" && a.sha256 !== null && b.sha256 !== null) return a.size === b.size && a.sha256 === b.sha256;
  return a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.ino === b.ino;
}

/**
 * The temporary names the store's own writers use and remove again: `.<16 hex>.tmp` (createExclusive,
 * replaceAtomically), `<name>.<16 hex>.tmp` (the snapshot and revert writers), `<name>.<pid>.tmp`
 * (writeResult), a lock attempt's `lock.json[.reclaim].<runId>.<pid>.<12 hex>.tmp` and a reclaimed
 * lock moved aside, `lock.json.<pid>.<12 hex>.stale`. Another Codaryn process that only tries the lock
 * (a second `codaryn run`) leaves such a file for the length of its attempt, so a fingerprint does not
 * list them. No view reads a file of these names; a record renamed to one is still missing.
 */
const TRANSIENT_NAME = /\.(?:[0-9a-f]{16}|[0-9]+|[0-9]+\.[0-9a-f]{12})\.tmp$|^lock\.json\.[0-9]+\.[0-9a-f]{12}\.stale$/;

/** Depth-first walk order: segment by segment in code unit order, a directory before what it holds. */
function walkOrder(a: string, b: string): number {
  const x = a.split("/");
  const y = b.split("/");
  for (let index = 0; index < Math.min(x.length, y.length); index += 1) {
    const p = x[index] as string;
    const q = y[index] as string;
    if (p !== q) return p < q ? -1 : 1;
  }
  return x.length - y.length;
}

/**
 * U-181 (DR-69 B-3, B-7): the options of a run that carries out an approved `run` plan: the plan
 * run whose directory gets PLAN_APPLIED_FILE_NAME, as ApplyRecordersOptions.planRunId.
 */
export interface PlanCarryingRecordersOptions extends RunRecordersOptions {
  readonly planRunId: string;
}

/**
 * U-181 (B-3, B-7): such a run's recorders, and its claim of the plan: applied.json in the plan run's
 * directory, created exclusively with this run as `applyRunId` (ApplyRecorders.markApplied's rules),
 * so a plan is carried out once. The state guard knows that write (tier "state"), as an apply's.
 */
export interface PlanCarryingRecorders extends RunRecorders {
  markApplied(): Promise<"marked" | "already_applied">;
}

/**
 * DR-38: CreateRunRecorders (state.ts): the run's journal, change recorder and plan recorder (as
 * createJournal, createChangeRecorder and createPlanRecorder make them) and the state guard that
 * knows what they write. The CLI and the app pass `stateGuard` to the engine as EngineDeps.stateGuard.
 * U-181 (B-3, B-7): with `planRunId`, for a run that carries out that plan run's `run` plan, also
 * `markApplied` (PlanCarryingRecorders); the plan run is another run. Without it, as before.
 */
export function createRunRecorders(options: PlanCarryingRecordersOptions): PlanCarryingRecorders;
export function createRunRecorders(options: RunRecordersOptions): RunRecorders;
export function createRunRecorders(options: RunRecordersOptions & { readonly planRunId?: string }): RunRecorders | PlanCarryingRecorders {
  const { workspaceRoot, runId, planRunId, clock } = options;
  if (planRunId !== undefined) {
    assertRunId(planRunId);
    if (planRunId === runId) throw new TypeError("a run cannot carry out its own plan");
  }
  const { notes, stateGuard } = guardFor(options);
  const recorders: RunRecorders = {
    journal: appendOnlyJournal<JournalEvent>(options, notes),
    changeRecorder: changeRecorderWith({ workspaceRoot, runId }, notes),
    planRecorder: planRecorderWith({ workspaceRoot, runId }, notes),
    stateGuard,
  };
  if (planRunId === undefined) return recorders;
  return {
    ...recorders,
    markApplied: () => markPlanAppliedWith({ workspaceRoot, planRunId, applyRunId: runId, at: new Date(clock.now()).toISOString() }, notes),
  };
}
// The contract's signature still fits (CreateRunRecorders, state.ts).
createRunRecorders satisfies CreateRunRecorders;

/** A stored name the executor gives a discarded file (discardedStoredName: the action index). */
const STORED_NAME = /^(?:0|[1-9][0-9]{0,8})$/;

/**
 * DR-38: CreateApplyRecorders (state.ts) for apply runs: the apply's journal and markApplied (its
 * plan run's PLAN_APPLIED_FILE_NAME, tier "state", noted when created), with the state guard that
 * knows them. The engine takes tier "run" afresh after the actions (ApplyDeps.stateGuard); the
 * journal also notes `discarded/<runId>/<stored>` and its folders as they are when `file_discarded`
 * is appended (the executor moved the file just before), so those moves are the apply's own either way.
 */
export const createApplyRecorders: CreateApplyRecorders = (options) => {
  const { notes, stateGuard } = guardFor(options);
  const { workspaceRoot, runId, planRunId, clock } = options;
  assertRunId(planRunId);
  const discardedRoot = discardedRootPath(workspaceRoot, runId);
  const afterAppend = async (event: ApplyJournalEntry): Promise<void> => {
    if (event.type !== "file_discarded") return;
    const stored: unknown = (event as { readonly stored?: unknown }).stored;
    if (typeof stored !== "string" || !STORED_NAME.test(stored)) return;
    await notes.dir(discardedRoot);
    await notes.present(join(discardedRoot, stored));
  };
  return {
    journal: appendOnlyJournal<ApplyJournalEntry>(options, notes, afterAppend),
    markApplied: () => markPlanAppliedWith({ workspaceRoot, planRunId, applyRunId: runId, at: new Date(clock.now()).toISOString() }, notes),
    stateGuard,
  };
};

/** The write log, the notes the writers use and the state guard over them, for one run. */
function guardFor(options: RunRecordersOptions): { readonly notes: RunWriteNotes; readonly stateGuard: StateGuard } {
  const { workspaceRoot, runId, clock } = options;
  assertRunId(runId);
  const maxEntries = options.limits?.maxEntries ?? MAX_STATE_ENTRIES;
  const maxHashBytes = options.limits?.maxHashBytes ?? MAX_STATE_HASH_BYTES;
  const stateDir = join(workspaceRoot, STATE_DIR_NAME);
  const runPrefix = `${RUNS_DIR_NAME}/${runId}`;
  const discardedPrefix = `${DISCARDED_DIR_NAME}/${runId}`;
  const inRunTier = (path: string): boolean =>
    path === LOCK_FILE_NAME || path === runPrefix || path.startsWith(`${runPrefix}/`) || path === discardedPrefix || path.startsWith(`${discardedPrefix}/`);

  /** `/` separated path below the state directory, or null for anything outside it. */
  const pathOf = (absolute: string): string | null => {
    const rel = relative(stateDir, absolute);
    if (rel === "" || rel.startsWith("..") || rel.includes(":")) return rel === "" ? "" : null;
    return rel.split(sep).join("/");
  };

  // The write log: each path's states as the run left them, in order.
  let seq = 0;
  const writes = new Map<string, { readonly seq: number; readonly entry: Entry }[]>();
  const note = (path: string, entry: Entry): void => {
    seq += 1;
    const list = writes.get(path) ?? [];
    list.push({ seq, entry });
    writes.set(path, list);
  };
  /** The last state the run left `path` in after `from` and up to `to`. */
  const ownWrite = (path: string, from: number, to: number): Entry | undefined => {
    const list = writes.get(path);
    if (list === undefined) return undefined;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const item = list[index] as { seq: number; entry: Entry };
      if (item.seq <= to) return item.seq > from ? item.entry : undefined;
    }
    return undefined;
  };

  const notes: RunWriteNotes = {
    async file(file, content) {
      const path = pathOf(file);
      if (path === null || path === "") return;
      let info: BigIntStats;
      try {
        info = await lstat(file, { bigint: true });
      } catch {
        return; // Nothing noted: the next check sees what is there and fails closed.
      }
      note(path, entryOf(info, content.sha256, BigInt(content.size)));
    },
    async dir(dir) {
      for (let current = dir; ; current = dirname(current)) {
        const path = pathOf(current);
        if (path === null || path === "") return;
        try {
          const info = await lstat(current, { bigint: true });
          if (info.isDirectory()) note(path, { kind: "dir", ino: info.ino });
        } catch {
          // Not noted.
        }
      }
    },
    async present(file) {
      const path = pathOf(file);
      if (path === null || path === "") return;
      try {
        note(path, entryOf(await lstat(file, { bigint: true }), null));
      } catch {
        // Not noted: the next check sees what is there.
      }
    },
  };

  const hashes = (tier: StateTier, path: string): boolean => {
    const segments = path.split("/");
    const name = segments[segments.length - 1] as string;
    if (name.endsWith(".orig") || segments[0] === DISCARDED_DIR_NAME || segments[0] === PARKED_DIR_NAME) return false;
    if (tier === "run") return true;
    if (segments[0] === RUNS_DIR_NAME) return name !== JOURNAL_FILE_NAME;
    return segments.length === 1;
  };

  const prints = new WeakMap<object, Print>();

  async function walk(tier: StateTier): Promise<Print> {
    const print: Print = { tier, seq, entries: new Map(), limited: false, cut: null };
    let hashed = 0;
    let stopped = false;
    let last: string | null = null;
    // Which files are hashed is decided in walk order (the budget); their reads run READ_CONCURRENCY at a time.
    const reads: Promise<void>[] = [];
    let active = 0;
    const waiting: (() => void)[] = [];
    const limited = async (task: () => Promise<void>): Promise<void> => {
      if (active >= READ_CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
      active += 1;
      try {
        await task();
      } finally {
        active -= 1;
        waiting.shift()?.();
      }
    };
    const limit = (): void => {
      if (tier === "state") print.limited = true;
    };
    const add = (path: string, entry: Entry): boolean => {
      if (stopped) return false;
      if (tier === "state" && print.entries.size >= maxEntries) {
        stopped = true;
        print.limited = true;
        print.cut = last ?? "";
        return false;
      }
      print.entries.set(path, entry);
      last = path;
      return true;
    };
    const visit = async (absolute: string, path: string): Promise<void> => {
      let info: BigIntStats;
      try {
        info = await lstat(absolute, { bigint: true });
      } catch (error) {
        const code = errorCode(error);
        if (code === "ENOENT" || code === "ENOTDIR") return;
        add(path, { kind: "unreadable" });
        limit();
        return;
      }
      if (info.isDirectory()) {
        if (!add(path, entryOf(info, null))) return;
        let names: string[];
        try {
          names = (await readdir(absolute)).sort();
        } catch {
          print.entries.set(path, { kind: "unreadable" });
          limit();
          return;
        }
        for (const name of names) {
          const child = `${path}/${name}`;
          if (TRANSIENT_NAME.test(name) || (tier === "state" && inRunTier(child))) continue;
          await visit(join(absolute, name), child);
          if (stopped) return;
        }
        return;
      }
      if (info.isFile() && hashes(tier, path)) {
        const size = Number(info.size);
        if ((tier === "state" && size > MAX_STATE_FILE_HASH_BYTES) || hashed + size > maxHashBytes) {
          limit();
          add(path, entryOf(info, null));
          return;
        }
        // A metadata entry until the read is done (walk order and the entry limit are decided here).
        if (!add(path, entryOf(info, null))) return;
        hashed += size;
        reads.push(
          limited(async () => {
            try {
              const data = await readFile(absolute);
              print.entries.set(path, entryOf(info, sha256Hex(data), BigInt(data.byteLength)));
            } catch {
              print.entries.set(path, { kind: "unreadable" });
              limit();
            }
          }),
        );
        return;
      }
      add(path, entryOf(info, null));
    };

    try {
      if (tier === "run") {
        for (const path of [discardedPrefix, LOCK_FILE_NAME, runPrefix]) await visit(join(stateDir, ...path.split("/")), path);
      } else {
        let names: string[] = [];
        try {
          names = (await readdir(stateDir)).sort();
        } catch (error) {
          const code = errorCode(error);
          if (!(code === "ENOENT" || code === "ENOTDIR")) limit();
        }
        for (const name of names) {
          if (TRANSIENT_NAME.test(name) || inRunTier(name)) continue;
          await visit(join(stateDir, name), name);
          if (stopped) break;
        }
      }
    } catch {
      // Never rejects for a file-level problem: what could not be walked is not known.
      if (tier === "run") print.entries.set(runPrefix, { kind: "unreadable" });
      else print.limited = true;
    }
    await Promise.all(reads);
    return print;
  }

  async function writeMark(dir: string, id: string, detection: RecordsChangedMark["detections"][number]): Promise<void> {
    const file = join(dir, RECORDS_CHANGED_FILE_NAME);
    let earlier: RecordsChangedMark["detections"] = [];
    let present = true;
    try {
      const info = await lstat(file);
      if (info.isFile() && info.size <= MAX_MARK_BYTES) {
        const value: unknown = JSON.parse(await readFile(file, "utf8"));
        if (isMark(value, id)) earlier = value.detections;
      }
    } catch (error) {
      const code = errorCode(error);
      if (code === "ENOENT" || code === "ENOTDIR") present = false;
    }
    const mark: RecordsChangedMark = { schemaVersion: 1, kind: "records_changed", runId: id, detections: [...earlier, detection] };
    const text = `${JSON.stringify(mark)}\n`;
    // Created exclusively; a later detection replaces it with the joined list (state.ts).
    if (present || !(await createExclusive(file, text))) await replaceAtomically(file, text);
    await notes.file(file, { sha256: sha256Hex(text), size: Buffer.byteLength(text, "utf8") });
  }

  const RUN_OF_PATH = new RegExp(`^(?:${RUNS_DIR_NAME}|${DISCARDED_DIR_NAME})/([^/]+)(?:/|$)`);

  const stateGuard: StateGuard = {
    async capture(tier) {
      if (tier !== "run" && tier !== "state") throw new TypeError("capture needs a tier of STATE_TIERS");
      const print = await walk(tier);
      const fingerprint = Object.freeze({ tier }) as unknown as StateFingerprint;
      prints.set(fingerprint, print);
      return fingerprint;
    },
    compare(before, after): StateComparison {
      const a = prints.get(before as object);
      const b = prints.get(after as object);
      if (a === undefined || b === undefined) throw new TypeError("compare needs two fingerprints made by this guard");
      if (a.tier !== b.tier) throw new TypeError("compare needs two fingerprints of one tier");
      const from = Math.min(a.seq, b.seq);
      const to = Math.max(a.seq, b.seq);
      const cuts = [a.cut, b.cut].filter((cut): cut is string => cut !== null).sort(walkOrder);
      const cut = cuts[0] ?? null;
      const changed: string[] = [];
      for (const path of new Set([...a.entries.keys(), ...b.entries.keys()])) {
        if (cut !== null && walkOrder(path, cut) > 0) continue;
        const x = a.entries.get(path);
        const y = b.entries.get(path);
        if (x?.kind === "unreadable" || y?.kind === "unreadable") {
          if (a.tier === "run") changed.push(path);
          continue;
        }
        if (sameEntry(x, y)) continue;
        const own = ownWrite(path, from, to);
        if (own !== undefined && sameEntry(own, y)) continue;
        changed.push(path);
      }
      changed.sort();
      return { changed: changed as RawText[], limited: a.tier === "state" && (a.limited || b.limited) };
    },
    async markRecordsChanged(changed: readonly MaskedText[]) {
      const at = new Date(clock.now()).toISOString();
      const byRun = new Map<string, MaskedText[]>([[runId, [...changed]]]);
      for (const path of changed) {
        const id = RUN_OF_PATH.exec(path)?.[1];
        if (id === undefined || id === runId || !isStoredRunId(id)) continue;
        byRun.set(id, [...(byRun.get(id) ?? []), path]);
      }
      let written = 0;
      let failure: unknown = null;
      for (const [id, paths] of byRun) {
        try {
          const dir = runDir(workspaceRoot, id);
          if (id !== runId && !((await hasExactRunEntry(workspaceRoot, id)) && (await isPlainDirectory(dir)))) continue;
          await writeMark(dir, id, { detectedBy: runId, at, paths });
          written += 1;
        } catch (error) {
          failure = error;
        }
      }
      if (written === 0) throw new Error("no records-changed mark could be written", { cause: failure });
    },
  };

  return { notes, stateGuard };
}

const RUN_TIMESTAMP = new RegExp(RUN_TIMESTAMP_PATTERN_SOURCE);

/** A records-changed mark of `runId` as stored (exact keys). */
function isMark(value: unknown, runId: string): value is RecordsChangedMark {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const mark = value as Record<string, unknown>;
  if (Object.keys(mark).sort().join() !== "detections,kind,runId,schemaVersion") return false;
  if (mark["schemaVersion"] !== 1 || mark["kind"] !== "records_changed" || mark["runId"] !== runId || !Array.isArray(mark["detections"])) return false;
  return mark["detections"].every((item: unknown) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
    const detection = item as Record<string, unknown>;
    return (
      Object.keys(detection).sort().join() === "at,detectedBy,paths" &&
      typeof detection["detectedBy"] === "string" &&
      typeof detection["at"] === "string" &&
      RUN_TIMESTAMP.test(detection["at"]) &&
      Array.isArray(detection["paths"]) &&
      detection["paths"].every((path: unknown) => typeof path === "string")
    );
  });
}
