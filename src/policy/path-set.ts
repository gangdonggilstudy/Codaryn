/**
 * U-175 (DR-69 B-2): one matcher for a set of workspace-relative paths, judged on the text and then
 * on the real path (T-13). It is protected.ts's matcher made general; the protected paths keep
 * exactly their rule (`match: "prefix"`, `onUnusable: "covers"`).
 *
 * | list                                  | match  | an unusable entry or list |
 * | ------------------------------------- | ------ | ------------------------- |
 * | protectedPaths, unreadablePaths (A-3) | prefix | covers (deny lists)       |
 * | a policy's writablePaths (B-4)        | prefix | misses (allow lists)      |
 * | an approved `run` plan's files (B-5)  | exact  | misses                    |
 *
 * - `checkPathSetFormat` is the single format rule (checkProtectedPaths, policy.ts in the contracts).
 *   A list it rejects is unusable as a whole: it covers everything or nothing, by `onUnusable`.
 * - Matching is by whole `/` separated segments, ignoring case on Windows. `prefix`: an entry
 *   covers itself and everything below it (`.` covers the whole workspace). `exact`: the entry
 *   itself only, never what is below it.
 * - `covers` looks at the text only. `coversEffective` takes a path whose links are already
 *   resolved (ResolvedPath.relative) and also resolves every entry, so an entry that is a link
 *   covers its real path too. An entry whose real path is outside the workspace (or a dangling
 *   link) is unusable: it covers everything (`covers`) or nothing (`misses`). An entry inside the
 *   state directory is passed over: no file tool writes there.
 * - U-175 (review V-3 M-1): an allow list (`misses`) covers a path only through an entry whose
 *   real path was found: every entry is resolved before its text or its real path may allow, and
 *   an entry that cannot be resolved (refused, or the resolving failed) allows nothing. What is not
 *   checked is not allowed. A deny list (`covers`) keeps its rule exactly: its text covers at once,
 *   since covering more is its safe side.
 * - U-180 (review R-101 L-2): an allow list resolves the entries whose text covers the path first,
 *   so an allowed write usually costs one resolve; the other entries (which can cover only through
 *   their real paths) are resolved only when none of those allowed. The answer is the same.
 */

import path from "node:path";

import type { CheckProtectedPaths, ProtectedPathProblem, Workspace } from "../contracts/index.js";
import { isValidPathInput } from "../workspace/lexical.js";

const IS_WINDOWS = process.platform === "win32";
const ENTRY_SEPARATORS = IS_WINDOWS ? /[\\/]/ : /\//;

function fold(segment: string): string {
  return IS_WINDOWS ? segment.toLowerCase() : segment;
}

function segmentsOf(entry: string): string[] {
  return entry.split(ENTRY_SEPARATORS).filter((segment) => segment !== "" && segment !== ".").map(fold);
}

/** The reason one entry is unusable, or null when it is a usable relative path. */
function entryProblem(entry: unknown): ProtectedPathProblem["reason"] | null {
  if (typeof entry !== "string") return "not_a_string";
  if (entry.trim().length === 0) return "empty";
  if (entry.includes("\0")) return "invalid_name";
  if (path.isAbsolute(entry) || /^[\\/]/.test(entry) || /^[A-Za-z]:/.test(entry)) return "absolute";
  if (entry.split(ENTRY_SEPARATORS).includes("..")) return "parent_segment";
  if (!isValidPathInput(entry)) return "invalid_name";
  return null;
}

/** T-13: see `CheckProtectedPaths` in the contracts. Pure and lexical. */
export const checkPathSetFormat: CheckProtectedPaths = (value) => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [{ index: null, reason: "not_a_list" }];
  const problems: ProtectedPathProblem[] = [];
  (value as readonly unknown[]).forEach((entry, index) => {
    const reason = entryProblem(entry);
    if (reason !== null) problems.push({ index, reason });
  });
  return problems;
};

export interface PathSetOptions {
  /** `prefix`: an entry covers itself and what is below it. `exact`: the entry itself only. */
  readonly match: "prefix" | "exact";
  /** What an unusable list or entry covers: everything (a deny list) or nothing (an allow list). */
  readonly onUnusable: "covers" | "misses";
  /**
   * Review V-11 H-1, allow lists only: `refuse` for entries that are effective paths already (an
   * approved plan's files, resolved when the plan was made). Such an entry covers only its own text,
   * and only while it still resolves to itself: a link now on its way makes it allow nothing, and it
   * never covers the place a link leads to. Absent or `follow`: a link entry covers its real path.
   */
  readonly entryLinks?: "follow" | "refuse";
}

export interface PathSet {
  /** Lexical check: true when the set covers `relative` (`/` separated, "." for the root) by its text. */
  covers(relative: string): boolean;
  /**
   * Effective check, for a path whose links are resolved: the text first, then every entry resolved
   * to its real path, so a link entry covers its target. Each call resolves again, so a link made
   * during the run is seen as well. For an allow list (`misses`) an entry counts only once it was
   * resolved; `covers` alone never allows a write there.
   */
  coversEffective(relative: string, workspace: Workspace): Promise<boolean>;
  /**
   * U-203 (bundle A, R-3, R-4): every entry resolved once, for judging many paths of one listing
   * without resolving again for each: an entry covers by its text and by its real path as resolved
   * now. An unusable list or entry covers everything (`covers`) or nothing (`misses`), as for
   * coversEffective; an entry in the state directory is passed over. Link entries cover their real
   * paths: it is for lists that follow links (the unreadable paths, a deny list).
   */
  snapshot(workspace: Workspace): Promise<PathSetSnapshot>;
}

/** U-203: a path set with its entries resolved once (PathSet.snapshot). */
export interface PathSetSnapshot {
  /** True when an entry covers `relative` (`/` separated, "." for the root) by its text or its real path. */
  covers(relative: string): boolean;
  /**
   * True when an entry, by its text or its real path, lies at or below `relative`: a listing of
   * that folder reaches what the set covers. It depends on the entries only, never on what exists.
   */
  within(relative: string): boolean;
}

const ALL_SNAPSHOT: PathSetSnapshot = { covers: () => true, within: () => true };
const NO_SNAPSHOT: PathSetSnapshot = { covers: () => false, within: () => false };
const NOTHING: PathSet = { covers: () => false, coversEffective: async () => false, snapshot: async () => NO_SNAPSHOT };
const EVERYTHING: PathSet = { covers: () => true, coversEffective: async () => true, snapshot: async () => ALL_SNAPSHOT };

/** U-203: a snapshot from entry segments (text and real paths), as prefixes. */
function snapshotOf(prefixes: readonly (readonly string[])[], match: PathSetOptions["match"]): PathSetSnapshot {
  return {
    covers: (relative) => prefixes.some((entry) => entryCovers(entry, relative, match)),
    within: (relative) => {
      const folder = relative === "." ? [] : relative.split("/").map(fold);
      return prefixes.some((entry) => folder.length <= entry.length && folder.every((segment, index) => segment === entry[index]));
    },
  };
}

/** U-203: the entries resolved once: their text, and their real paths where they resolve. */
async function resolvedPrefixes(
  entries: readonly string[],
  lexical: readonly (readonly string[])[],
  workspace: Workspace,
  options: PathSetOptions,
): Promise<readonly (readonly string[])[] | "everything"> {
  const prefixes: (readonly string[])[] = [];
  for (const [index, entry] of entries.entries()) {
    let resolved: Awaited<ReturnType<Workspace["resolve"]>> | null;
    try {
      resolved = await workspace.resolve(entry, "read");
    } catch {
      resolved = null;
    }
    if (resolved === null || !resolved.ok) {
      if (resolved !== null && !resolved.ok && resolved.code === "state_dir") continue;
      if (options.onUnusable === "covers") return "everything";
      continue;
    }
    prefixes.push(lexical[index] as readonly string[], segmentsOf(resolved.path.relative));
  }
  return prefixes;
}

function entryCovers(entry: readonly string[], relative: string, match: PathSetOptions["match"]): boolean {
  const segments = relative === "." ? [] : relative.split("/").map(fold);
  if (match === "exact" ? entry.length !== segments.length : entry.length > segments.length) return false;
  return entry.every((segment, index) => segment === segments[index]);
}

/**
 * Builds the matcher for one list. Absent or empty covers nothing. A value that checkPathSetFormat
 * rejects is unusable: it covers everything or nothing, by `options.onUnusable`.
 */
export function compilePathSet(value: unknown, options: PathSetOptions): PathSet {
  if (checkPathSetFormat(value).length > 0) return options.onUnusable === "covers" ? EVERYTHING : NOTHING;
  const entries = (value ?? []) as readonly string[];
  if (entries.length === 0) return NOTHING;
  const lexical = entries.map(segmentsOf);
  const covers = (relative: string): boolean => lexical.some((entry) => entryCovers(entry, relative, options.match));
  const snapshot = async (workspace: Workspace): Promise<PathSetSnapshot> => {
    const prefixes = await resolvedPrefixes(entries, lexical, workspace, options);
    return prefixes === "everything" ? ALL_SNAPSHOT : snapshotOf(prefixes, options.match);
  };
  if (options.onUnusable === "covers") {
    // A deny list (the protected paths' rule, unchanged): the text covers at once.
    return {
      covers,
      snapshot,
      async coversEffective(relative, workspace) {
        if (covers(relative)) return true;
        for (const entry of entries) {
          const resolved = await workspace.resolve(entry, "read");
          if (!resolved.ok) {
            // Inside the state directory: file tools cannot write there anyway.
            if (resolved.code === "state_dir") continue;
            // Outside the workspace (or a dangling link): the entry is unusable. Fail closed.
            return true;
          }
          if (entryCovers(segmentsOf(resolved.path.relative), relative, options.match)) return true;
        }
        return false;
      },
    };
  }
  // An allow list (V-3 M-1): an entry allows only after its real path was found.
  return {
    covers,
    snapshot,
    async coversEffective(relative, workspace) {
      // R-101 L-2: the entries whose text covers the path first, then the others.
      const byText = lexical.map((text) => entryCovers(text, relative, options.match));
      const order = [...entries.keys()].sort((a, b) => Number(byText[b]) - Number(byText[a]));
      for (const index of order) {
        const entry = entries[index] as string;
        let resolved: Awaited<ReturnType<Workspace["resolve"]>>;
        try {
          resolved = await workspace.resolve(entry, "read");
        } catch {
          continue; // not checked: it allows nothing
        }
        // Refused (outside the workspace, a dangling link, the state directory, a form the
        // workspace does not accept): the entry allows nothing.
        if (!resolved.ok) continue;
        const real = segmentsOf(resolved.path.relative);
        if (options.entryLinks === "refuse") {
          // V-11 H-1: an effective path covers its own text only while it still resolves to itself.
          const text = lexical[index] as readonly string[];
          if (byText[index] === true && real.length === text.length && real.every((segment, at) => segment === text[at])) return true;
          continue;
        }
        if (byText[index] === true || entryCovers(real, relative, options.match)) return true;
      }
      return false;
    },
  };
}
