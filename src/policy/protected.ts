/**
 * Protected paths (R-5, T-13): workspace-relative prefixes that no file tool may write.
 *
 * - `checkProtectedPaths` is the single format rule, shared by the CLI and the gate.
 * - Matching is by whole `/` separated segments, ignoring case on Windows.
 * - Lexically before links are resolved (checkRequested), and against real paths after
 *   (checkEffective). An entry that is a link also protects its real path; an entry whose real
 *   path is outside the workspace denies every write.
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

/** The reason one entry is unusable, or null when it is a usable relative prefix. */
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
export const checkProtectedPaths: CheckProtectedPaths = (value) => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [{ index: null, reason: "not_a_list" }];
  const problems: ProtectedPathProblem[] = [];
  (value as readonly unknown[]).forEach((entry, index) => {
    const reason = entryProblem(entry);
    if (reason !== null) problems.push({ index, reason });
  });
  return problems;
};

export interface ProtectedPaths {
  /** Lexical check: true when a write to `relative` (`/` separated, "." for the root) is denied. */
  covers(relative: string): boolean;
  /**
   * Effective check: also resolves each entry to its real path, so a link entry protects its
   * target. An entry whose real path is outside the workspace denies every write.
   */
  coversEffective(relative: string, workspace: Workspace): Promise<boolean>;
}

const NOTHING: ProtectedPaths = { covers: () => false, coversEffective: async () => false };
const EVERYTHING: ProtectedPaths = { covers: () => true, coversEffective: async () => true };

function prefixCovers(prefix: readonly string[], relative: string): boolean {
  const segments = relative === "." ? [] : relative.split("/").map(fold);
  return prefix.length <= segments.length && prefix.every((segment, index) => segment === segments[index]);
}

/**
 * Builds the matcher from `PolicyConfig.protectedPaths`. Absent or empty protects nothing.
 * A value that `checkProtectedPaths` rejects fails closed: every write is denied.
 */
export function compileProtectedPaths(value: unknown): ProtectedPaths {
  if (checkProtectedPaths(value).length > 0) return EVERYTHING;
  const entries = (value ?? []) as readonly string[];
  if (entries.length === 0) return NOTHING;
  const lexical = entries.map(segmentsOf);
  const covers = (relative: string): boolean => lexical.some((prefix) => prefixCovers(prefix, relative));
  return {
    covers,
    async coversEffective(relative, workspace) {
      if (covers(relative)) return true;
      // Resolved on every call: a link created during the run is seen as well.
      for (const entry of entries) {
        const resolved = await workspace.resolve(entry, "read");
        if (!resolved.ok) {
          // Inside the state directory: file tools cannot write there anyway.
          if (resolved.code === "state_dir") continue;
          // Outside the workspace (or a dangling link): the entry is unusable. Fail closed.
          return true;
        }
        if (prefixCovers(segmentsOf(resolved.path.relative), relative)) return true;
      }
      return false;
    },
  };
}
