/**
 * Protected paths (R-5, T-13): workspace-relative prefixes that no file tool may write.
 *
 * - `checkProtectedPaths` is the single format rule, shared by the CLI and the gate.
 * - Matching is by whole `/` separated segments, ignoring case on Windows.
 * - Lexically before links are resolved (checkRequested), and against real paths after
 *   (checkEffective). An entry that is a link also protects its real path; an entry whose real
 *   path is outside the workspace denies every write.
 *
 * U-175 (DR-69 B-2): the matcher is path-set.ts's, with the protected paths' own rule (`prefix`,
 * an unusable list or entry covers everything). Their decisions are what they were.
 */

import type { CheckProtectedPaths } from "../contracts/index.js";
import { checkPathSetFormat, compilePathSet } from "./path-set.js";
import type { PathSet } from "./path-set.js";

/** T-13: see `CheckProtectedPaths` in the contracts. Pure and lexical. */
export const checkProtectedPaths: CheckProtectedPaths = checkPathSetFormat;

/**
 * `covers(relative)`: lexical check, true when a write to `relative` (`/` separated, "." for the
 * root) is denied. `coversEffective(relative, workspace)`: also resolves each entry to its real
 * path, so a link entry protects its target; an entry whose real path is outside the workspace
 * denies every write.
 */
export type ProtectedPaths = PathSet;

/**
 * Builds the matcher from `PolicyConfig.protectedPaths`. Absent or empty protects nothing.
 * A value that `checkProtectedPaths` rejects fails closed: every write is denied.
 */
export function compileProtectedPaths(value: unknown): ProtectedPaths {
  return compilePathSet(value, { match: "prefix", onUnusable: "covers" });
}
