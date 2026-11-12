/**
 * GU-2: one directory of the workspace for the read-only file tree (docs/design/standalone-gui.md
 * 3.3). Interim: the app layer has no workspace listing function yet (design 5, "작업 공간 목록"),
 * so the engine host lists with the engine's own rules. When the app layer gains one, this file is
 * replaced by a call to it.
 *
 * - The directory is resolved by the engine's `Workspace.resolve` (inside the root, not the state
 *   directory, no invalid names), then listed one level deep. Nothing is followed: a link or
 *   junction is listed as `link`.
 * - Names are shown as the CLI shows recorded text: key shapes and the current key hidden
 *   (`hideKeys`). A name with a control character is not shown at all. Either way the entry is
 *   `masked`; the main process gives it no id, so it cannot be opened. Secrets registered in the
 *   settings (`secretEnv`) are not masked here; that needs the app layer's function.
 * - Directories come first, then the rest, each in a fixed order. Pages of TREE_PAGE_SIZE.
 */

import { lstat, readdir } from "node:fs/promises";

export const TREE_PAGE_SIZE = 500;
/** A directory with more entries is refused (`too_large`) rather than listed in part. */
export const MAX_TREE_ENTRIES = 100_000;
const MAX_DEPTH = 64;
const MAX_SEGMENT = 255;
const STATE_DIR_NAME = ".codaryn";

/** The parts of the engine's Workspace (src/contracts/workspace.ts) used here. */
export interface TreeWorkspace {
  readonly root: string;
  resolve(
    path: string,
    access: "read",
  ): Promise<{ readonly ok: true; readonly path: { readonly absolute: string; readonly relative: string } } | { readonly ok: false; readonly code: string }>;
}

export interface TreeEngine {
  /** `createWorkspace` from src/workspace. */
  createWorkspace(options: { readonly root: string }): Promise<TreeWorkspace>;
  /** `cleanText` and `hideKeys` from src/cli/text-safety. */
  cleanText(text: string): string;
  hideKeys(text: string, currentKey: string | null): string;
  /** The current API key for `hideKeys`, or null. */
  currentKey(): string | null;
  readonly platform: NodeJS.Platform;
}

export type TreeEntryKind = "dir" | "file" | "link" | "state" | "other";

export interface TreeEntry {
  /** The real name. The main process keeps it to build child paths; it never reaches the window. */
  readonly name: string;
  /** The name as shown; "" when it cannot be shown at all. */
  readonly shown: string;
  readonly kind: TreeEntryKind;
  readonly masked: boolean;
}

export type TreeResult =
  | { readonly ok: true; readonly entries: readonly TreeEntry[]; readonly total: number; readonly offset: number; readonly nextOffset: number | null }
  | { readonly ok: false; readonly code: "invalid_path" | "outside_root" | "state_dir" | "not_found" | "not_dir" | "too_large" | "io_error" };

/** A relative directory as the main process sends it: "" for the root, else `/`-separated plain segments. */
export function isTreeDir(dir: string): boolean {
  if (dir === "") return true;
  const segments = dir.split("/");
  if (segments.length > MAX_DEPTH) return false;
  return segments.every(
    (segment) => segment.length > 0 && segment.length <= MAX_SEGMENT && segment !== "." && segment !== ".." && !/[\\:\u0000-\u001f]/.test(segment),
  );
}

const ORDER = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function rank(kind: TreeEntryKind): number {
  return kind === "dir" || kind === "state" ? 0 : 1;
}

export function createTreeLister(engine: TreeEngine): (request: { readonly workspace: string; readonly dir: string; readonly offset: number }) => Promise<TreeResult> {
  const workspaces = new Map<string, Promise<TreeWorkspace>>();

  function workspaceFor(root: string): Promise<TreeWorkspace> {
    let found = workspaces.get(root);
    if (found === undefined) {
      if (workspaces.size >= 16) {
        const oldest = workspaces.keys().next().value;
        if (oldest !== undefined) workspaces.delete(oldest);
      }
      found = engine.createWorkspace({ root });
      // A failed creation is not kept: the folder may exist next time.
      found.catch(() => workspaces.delete(root));
      workspaces.set(root, found);
    }
    return found;
  }

  function show(name: string): { shown: string; masked: boolean } {
    if (engine.cleanText(name) !== name) return { shown: "", masked: true };
    const shown = engine.hideKeys(name, engine.currentKey());
    return { shown, masked: shown !== name };
  }

  return async function list(request) {
    if (!isTreeDir(request.dir)) return { ok: false, code: "invalid_path" };
    let absolute: string;
    let atRoot: boolean;
    try {
      const workspace = await workspaceFor(request.workspace);
      const resolved = await workspace.resolve(request.dir === "" ? "." : request.dir, "read");
      if (!resolved.ok) {
        const code = resolved.code;
        return { ok: false, code: code === "outside_root" || code === "state_dir" ? code : "invalid_path" };
      }
      absolute = resolved.path.absolute;
      atRoot = resolved.path.relative === ".";
      if (!(await lstat(absolute)).isDirectory()) return { ok: false, code: "not_dir" };
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      return { ok: false, code: code === "ENOENT" || code === "ENOTDIR" ? "not_found" : "io_error" };
    }
    let dirents;
    try {
      dirents = await readdir(absolute, { withFileTypes: true });
    } catch {
      return { ok: false, code: "io_error" };
    }
    if (dirents.length > MAX_TREE_ENTRIES) return { ok: false, code: "too_large" };
    const sameName = (a: string, b: string): boolean => (engine.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
    const entries: TreeEntry[] = dirents.map((dirent) => {
      let kind: TreeEntryKind;
      if (atRoot && sameName(dirent.name, STATE_DIR_NAME)) kind = "state";
      else if (dirent.isSymbolicLink()) kind = "link";
      else if (dirent.isDirectory()) kind = "dir";
      else if (dirent.isFile()) kind = "file";
      else kind = "other";
      return { name: dirent.name, kind, ...show(dirent.name) };
    });
    entries.sort((a, b) => rank(a.kind) - rank(b.kind) || ORDER.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const offset = Math.min(request.offset, entries.length);
    const end = offset + TREE_PAGE_SIZE;
    return { ok: true, entries: entries.slice(offset, end), total: entries.length, offset, nextOffset: end < entries.length ? end : null };
  };
}
