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
 * - `retried`: a change seen is tried again from the start, at most `GUARD_ATTEMPTS` times. A swap is
 *   seen on every try; a person's or a program's ordinary change near the path (a file created in
 *   the same folder in that instant) usually is not seen twice.
 * - Not closed: Node has no calls relative to a folder handle, so between a last check and a call
 *   by path an instant stays. The checks make every swap that is still there, or that was made and
 *   undone, visible on file systems that keep folder change times (FAT and exFAT keep none; there a
 *   swap and its undoing between two walks is not seen). The workspace root's own parent is not
 *   walked: the root itself swapped and swapped back is not seen.
 */

import path from "node:path";

import type { FileId, IdStat } from "./file-layer.js";

/** How many times a guarded operation runs when it saw a change. */
export const GUARD_ATTEMPTS = 3;

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

/** Runs `attempt` again while it answers `changed`, at most GUARD_ATTEMPTS times; then `changed`. */
export async function retried<T>(attempt: () => Promise<T | "changed">): Promise<T | "changed"> {
  for (let tries = 1; ; tries += 1) {
    const outcome = await attempt();
    if (outcome !== "changed" || tries >= GUARD_ATTEMPTS) return outcome;
  }
}
