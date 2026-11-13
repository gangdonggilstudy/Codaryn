/**
 * U-203 (bundle A, R-3, R-4; Codex V-13 M-1, M-2): search_files' listing when the run has unreadable
 * paths. It is Workspace.list (the same order, limit, state directory rule and folder guards) with
 * what the unreadable paths cover left out before it is counted or entered:
 *
 * - An entry the snapshot covers is not listed, and a folder it covers is never read, so neither the
 *   number of entries there nor an error reading them changes `entries`, `truncated` or the outcome.
 * - An entry that is neither a folder nor a file (a link or a junction) is resolved, and left out
 *   when its real path is covered or cannot be found (a dangling link, one that leaves the root): a
 *   name that leads under an unreadable path is hidden as the path itself is.
 *
 * Without unreadable paths search_files uses Workspace.list, unchanged.
 */

import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { MAX_SEARCH_ENTRIES } from "../contracts/index.js";
import type { GuardedCallOptions, ListEntry, ListOutcome, ResolvedPath, Workspace } from "../contracts/index.js";
import type { PathSetSnapshot } from "../policy/path-set.js";
import { nodeFileLayer } from "../workspace/file-layer.js";
import { FolderWatch, retried, retryDeadline, sameChain, walkChain } from "../workspace/guard.js";
import { isStateDirName } from "../workspace/lexical.js";

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface Pending extends ListEntry {
  readonly absolute: string;
}

const CHANGED = new Error("changed");

/** True when the link `relative` leads to a real path the snapshot does not cover. */
async function leadsToVisible(workspace: Workspace, relative: string, hidden: PathSetSnapshot): Promise<boolean> {
  let resolved: Awaited<ReturnType<Workspace["resolve"]>>;
  try {
    resolved = await workspace.resolve(relative, "read");
  } catch {
    return false;
  }
  return resolved.ok && !hidden.covers(resolved.path.relative);
}

async function listOnce(workspace: Workspace, dir: ResolvedPath, hidden: PathSetSnapshot): Promise<ListOutcome | "changed"> {
  const first = await walkChain(nodeFileLayer.lstatId, workspace.root, dir.relative);
  if (!first.ok) return first.code === "changed" ? "changed" : { ok: false, code: first.code === "not_found" ? "not_found" : "io_error" };
  if (!first.last.isDirectory()) return { ok: false, code: "not_found" };
  const watch = new FolderWatch(nodeFileLayer.lstatId);
  // Sorted descending so `pop` yields the smallest relative path, as in Workspace.list.
  const pending: Pending[] = [];

  async function expand(absolute: string, relative: string): Promise<void> {
    if (!(await watch.enter(absolute))) throw CHANGED;
    const children: Dirent[] = await fs.readdir(absolute, { withFileTypes: true });
    for (const child of children) {
      if (relative === "." && isStateDirName(child.name)) continue;
      const childRelative = relative === "." ? child.name : `${relative}/${child.name}`;
      if (hidden.covers(childRelative)) continue;
      if (!child.isDirectory() && !child.isFile() && !(await leadsToVisible(workspace, childRelative, hidden))) continue;
      pending.push({ absolute: path.join(absolute, child.name), relative: childRelative, kind: child.isDirectory() ? "dir" : "file" });
    }
    pending.sort((a, b) => compareCodeUnits(b.relative, a.relative));
  }

  const entries: ListEntry[] = [];
  let truncated = false;
  try {
    await expand(dir.absolute, dir.relative);
    for (;;) {
      const next = pending.pop();
      if (next === undefined) break;
      if (entries.length >= MAX_SEARCH_ENTRIES) {
        truncated = true;
        break;
      }
      entries.push({ relative: next.relative, kind: next.kind });
      if (next.kind === "dir") await expand(next.absolute, next.relative);
    }
  } catch (error) {
    return error === CHANGED ? "changed" : { ok: false, code: "io_error" };
  }
  const second = await walkChain(nodeFileLayer.lstatId, workspace.root, dir.relative);
  if (!second.ok || !sameChain(first.seen, second.seen) || !(await watch.unchanged())) return "changed";
  return { ok: true, entries, truncated };
}

/**
 * U-203 (V-13): `dir` listed as Workspace.list does, without what `hidden` covers (see the module's note).
 * U-213: its tries again as Workspace.list's: the run's signal ends a wait, and no try starts at or
 * after the caller's time limit (or 2 s from the call).
 */
export async function listVisible(workspace: Workspace, dir: ResolvedPath, hidden: PathSetSnapshot, options: GuardedCallOptions = {}): Promise<ListOutcome> {
  const outcome = await retried(() => listOnce(workspace, dir, hidden), { signal: options.signal, until: options.retryUntil ?? retryDeadline() });
  return outcome === "changed" ? { ok: false, code: "io_error" } : outcome;
}
