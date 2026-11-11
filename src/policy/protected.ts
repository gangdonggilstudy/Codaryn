/**
 * Protected paths (R-5): workspace-relative prefixes that no file tool may write.
 * Matching is by whole `/` separated segments against `ResolvedPath.relative`
 * (or the lexical relative path before links are resolved). Windows ignores case.
 */

import path from "node:path";

import { isValidPathInput } from "../workspace/lexical.js";

const IS_WINDOWS = process.platform === "win32";
const ENTRY_SEPARATORS = IS_WINDOWS ? /[\\/]/ : /\//;

export interface ProtectedPaths {
  /** True when a write to `relative` (`/` separated, "." for the root) must be denied. */
  covers(relative: string): boolean;
}

const NOTHING: ProtectedPaths = { covers: () => false };
const EVERYTHING: ProtectedPaths = { covers: () => true };

function fold(segment: string): string {
  return IS_WINDOWS ? segment.toLowerCase() : segment;
}

/**
 * Segments of one entry, or `null` when it is not a relative prefix inside the workspace:
 * not a string, empty, absolute, drive-relative, UNC or device, with a `..` segment,
 * or a name that cannot address an ordinary file.
 */
export function parseProtectedEntry(entry: unknown): readonly string[] | null {
  if (typeof entry !== "string" || entry.length === 0 || !isValidPathInput(entry)) return null;
  if (path.isAbsolute(entry) || /^[\\/]/.test(entry) || /^[A-Za-z]:/.test(entry)) return null;
  const segments = entry.split(ENTRY_SEPARATORS).filter((segment) => segment !== "" && segment !== ".");
  if (segments.includes("..")) return null;
  return segments.map(fold);
}

/**
 * Builds the matcher from `PolicyConfig.protectedPaths`.
 * Absent or empty protects nothing. Anything malformed fails closed: every write is denied,
 * because a mistyped entry must not silently leave the intended path writable.
 */
export function compileProtectedPaths(value: unknown): ProtectedPaths {
  if (value === undefined) return NOTHING;
  if (!Array.isArray(value)) return EVERYTHING;
  const prefixes: (readonly string[])[] = [];
  for (const entry of value as readonly unknown[]) {
    const segments = parseProtectedEntry(entry);
    if (segments === null) return EVERYTHING;
    prefixes.push(segments);
  }
  if (prefixes.length === 0) return NOTHING;
  return {
    covers(relative: string): boolean {
      const segments = relative === "." ? [] : relative.split("/").map(fold);
      return prefixes.some(
        (prefix) => prefix.length <= segments.length && prefix.every((segment, index) => segment === segments[index]),
      );
    },
  };
}
