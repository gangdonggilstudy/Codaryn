/**
 * U-189 (W-2, W-3 and P-1 of the tool path race study; Codex V-10): what a read, a listing and
 * `inspect_files` use to tell that the folders on a checked real path stayed the same objects while
 * they were used.
 *
 * - `walkChain` walks a real path (from `Workspace.resolve`, so links are already resolved) from the
 *   root with `lstat`: the root and each folder must be a folder, never a link; a link there now is a
 *   swap. Each step keeps its identity (device, file id) and, for folders, its change time.
 * - `sameChain` compares two walks: the same objects, and the folders unchanged. A folder's change
 *   time moves when an entry in it is added, removed or renamed, so a folder swapped for a junction
 *   and swapped back between two walks (V-10's "aba-parent") shows in its parent's change time even
 *   though every identity is the same again.
 * - `FolderWatch` keeps each folder a listing reads (looked at before its `readdir`) and checks at
 *   the end that every one is still that folder, unchanged.
 * - `retried`: a change seen is tried again from the start, at most `GUARD_ATTEMPTS` times, twice at
 *   once and then after waits (`GUARD_PAUSES_MS`) that end when the run's signal is aborted. A
 *   listing, inspect_files and a search start no try more once `GUARD_TIME_LIMIT_MS` has passed. A
 *   swap is seen on every try; a person's or a program's ordinary change near the path (a file
 *   created in the same folder in that instant) usually is not seen twice, and a burst of changes
 *   (npm install, a checkout) is usually over before the last waits end. Changes that never stop
 *   are io_error still.
 * - Not closed: Node has no calls relative to a folder handle, so between a last check and a call
 *   by path an instant stays. The checks make every swap that is still there, or that was made and
 *   undone, visible on file systems that keep folder change times (FAT and exFAT keep none; there a
 *   swap and its undoing between two walks is not seen). The workspace root's own parent is not
 *   walked: the root itself swapped and swapped back is not seen.
 */

import path from "node:path";

import type { FileId, IdStat } from "./file-layer.js";

/**
 * How many times a guarded operation runs when it saw a change. U-213 (ne-verify's measurement of
 * read refusals after U-189, its P5): six. Three tries without a wait refused a read in a burst of
 * changes of about a second (npm install, a big build, a checkout) 10% of the time, and a listing or
 * inspect_files 19%; with the waits below, 0.3% and 1%. Ordinary activity (an atomic save, a watcher,
 * a sync program) was never refused either way, and took no longer.
 */
export const GUARD_ATTEMPTS = 6;

/**
 * The wait before each try after the first (before the second, the third, …). The first two are at
 * once: a single change near the path (an atomic save, a file made and removed) is over by then. The
 * later ones outlast a burst of about a second; they are used only when the first three tries all
 * saw a change, so an ordinary read is not slowed. Together 750 ms at most.
 */
export const GUARD_PAUSES_MS: readonly number[] = [0, 0, 50, 200, 500];

/**
 * A listing, inspect_files, and a search's listing with all its reads start no try after the first
 * once this long would have passed since they began (`retryDeadline`). A try takes as long as the
 * folders it walks, and a search reads many files: their tries must not add up. A single read has no
 * time limit of its own: six tries of one file and the waits are short.
 */
export const GUARD_TIME_LIMIT_MS = 2_000;

/** The time and the waits `retried` uses (tests give their own). A wait ends early when `signal` is aborted. */
export interface RetryClock {
  readonly now: () => number;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const REAL_CLOCK: RetryClock = {
  now: () => performance.now(),
  sleep: (ms, signal) =>
    new Promise<void>((done) => {
      if (signal?.aborted === true) {
        done();
        return;
      }
      const finish = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", finish);
        done();
      };
      const timer = setTimeout(finish, ms);
      signal?.addEventListener("abort", finish, { once: true });
    }),
};

/** How a guarded operation may try again (the contract's GuardedCallOptions, and a clock for tests). */
export interface RetryOptions {
  /** Aborted: the wait ends at once and no try more starts. */
  readonly signal?: AbortSignal | undefined;
  /** A time of the clock at or after which no try after the first starts. */
  readonly until?: number | undefined;
  readonly clock?: RetryClock;
}

/** The time GUARD_TIME_LIMIT_MS from now: the `until` of a listing, inspect_files or a search. */
export function retryDeadline(clock: RetryClock = REAL_CLOCK): number {
  return clock.now() + GUARD_TIME_LIMIT_MS;
}

/** One step of a walk: its identity, and its change time (compared for folders only). */
export interface Seen {
  readonly id: FileId;
  readonly ctime: bigint;
  readonly folder: boolean;
}

export type ChainWalk =
  | { readonly ok: true; readonly seen: readonly Seen[]; readonly last: IdStat }
  | { readonly ok: false; readonly code: "not_found" | "io_error" | "changed" };

type LstatId = (target: string) => Promise<IdStat>;

const errorCode = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;
const missing = (error: unknown): boolean => errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR";

export const sameId = (a: FileId | undefined, b: FileId | undefined): boolean => a !== undefined && b !== undefined && a.dev === b.dev && a.ino === b.ino;

/**
 * `lstat` of `root` and of every prefix of the real path `relative` ("." is the root): the root and
 * each folder before the last a folder, never a link. A link now means a swap (`changed`). The last
 * is what the path names; its kind is the caller's to judge.
 */
export async function walkChain(lstatId: LstatId, root: string, relative: string): Promise<ChainWalk> {
  const segments = relative === "." ? [] : relative.split("/");
  const places = [root, ...segments.map((_segment, index) => path.join(root, ...segments.slice(0, index + 1)))];
  const seen: Seen[] = [];
  let last: IdStat | undefined;
  for (const [index, place] of places.entries()) {
    try {
      last = await lstatId(place);
    } catch (error) {
      return { ok: false, code: missing(error) ? "not_found" : "io_error" };
    }
    if (last.isSymbolicLink()) return { ok: false, code: "changed" };
    if (index < places.length - 1 && !last.isDirectory()) return { ok: false, code: index === 0 ? "changed" : "not_found" };
    seen.push({ id: last.id, ctime: last.ctime, folder: last.isDirectory() });
  }
  return last === undefined ? { ok: false, code: "io_error" } : { ok: true, seen, last };
}

/** The same objects in both walks, and every folder unchanged (its change time). */
export function sameChain(a: readonly Seen[], b: readonly Seen[]): boolean {
  return a.length === b.length && a.every((step, index) => {
    const other = b[index];
    return other !== undefined && sameId(step.id, other.id) && step.folder === other.folder && (!step.folder || step.ctime === other.ctime);
  });
}

/** The folders a listing read, each looked at before its `readdir`, checked again at the end. */
export class FolderWatch {
  private readonly folders = new Map<string, Seen>();

  constructor(private readonly lstatId: LstatId) {}

  /** Looks at the folder `absolute` before it is read: false when it is not a folder (a link now, or gone). */
  async enter(absolute: string): Promise<boolean> {
    let stat: IdStat;
    try {
      stat = await this.lstatId(absolute);
    } catch {
      return false;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
    this.folders.set(absolute, { id: stat.id, ctime: stat.ctime, folder: true });
    return true;
  }

  /** Every folder read is still that folder, unchanged since it was looked at. */
  async unchanged(): Promise<boolean> {
    for (const [absolute, before] of this.folders) {
      let now: IdStat;
      try {
        now = await this.lstatId(absolute);
      } catch {
        return false;
      }
      if (now.isSymbolicLink() || !now.isDirectory() || !sameId(now.id, before.id) || now.ctime !== before.ctime) return false;
    }
    return true;
  }
}

/**
 * Runs `attempt` again while it answers `changed`: at most GUARD_ATTEMPTS times, after the waits of
 * GUARD_PAUSES_MS; no try that would start at or after `until`, and none once `signal` is aborted
 * (a wait under way ends then); then `changed`.
 */
export async function retried<T>(attempt: () => Promise<T | "changed">, options: RetryOptions = {}): Promise<T | "changed"> {
  const clock = options.clock ?? REAL_CLOCK;
  const { signal, until } = options;
  // Read each time: the signal can be aborted while a try or a wait is under way.
  const aborted = (): boolean => signal?.aborted === true;
  for (let tries = 1; ; tries += 1) {
    const outcome = await attempt();
    if (outcome !== "changed" || tries >= GUARD_ATTEMPTS || aborted()) return outcome;
    const pause = GUARD_PAUSES_MS[tries - 1] ?? 0;
    if (until !== undefined && clock.now() + pause >= until) return outcome;
    if (pause > 0) {
      await clock.sleep(pause, signal);
      if (aborted()) return outcome;
    }
  }
}
