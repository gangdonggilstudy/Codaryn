/**
 * U-89 (gap survey, GUI 3.3; PM: the draft's form and security requirements adopted): one directory
 * of a workspace for an adapter's file tree (`listWorkspaceDir`, adapter-contract 5.12).
 *
 * - The directory is named by plain relative segments (WORKSPACE_DIR_SHAPE); anything else is
 *   `invalid_arguments` before anything is read. It is resolved by the engine's workspace rules
 *   (`Workspace.resolve`: inside the root, not the state directory, no invalid names), and every
 *   segment of it is looked at with `lstat`: a link or junction on the way is `refused`, so nothing
 *   is ever followed.
 * - Entries are read one level deep (`readdir` with their own types, which do not follow links): a
 *   link or junction is `link`, the root's `.codaryn` is `state`; neither can be listed in turn.
 * - Names are shown masked: a name with a control character is not shown at all (""); otherwise
 *   `cleanText`, then the key shapes and every key value set now (`hideKeys`), then the values the
 *   settings register now (the gateway's `mask`, AC-D14). An entry whose shown name is not its name
 *   is `masked` and carries no `name`: the real name of a masked entry never leaves the app layer.
 * - `protected`: the effective policy's protected paths (`compileProtectedPaths`, lexical, as the
 *   policy judges a path) cover the entry's relative path.
 * - A directory with more than MAX_WORKSPACE_DIR_ENTRIES entries is `too_large`: never listed in
 *   part. Pages of at most WORKSPACE_PAGE_SIZE, directories first, then the rest, each in a fixed
 *   order (numeric collation, then code points).
 * - Reads only: no lock, no records, nothing sent.
 */

import { lstat, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { STATE_DIR_NAME } from "../contracts/index.js";
import type { MaskedText, PrivacyGateway } from "../contracts/index.js";
import { cleanText, hideKeys } from "../cli/text-safety.js";
import { compileProtectedPaths } from "../policy/protected.js";
import { createWorkspace } from "../workspace/index.js";
import { appError } from "./errors.js";
import type { AppCallOutcome, AppError, WorkspaceDirListing, WorkspaceEntry, WorkspaceEntryKind } from "./types.js";

/** The most entries one page gives (as the GUI's tree and `inspect_files`). */
export const WORKSPACE_PAGE_SIZE = 500;
/** A directory with more entries is `too_large` rather than listed in part. */
export const MAX_WORKSPACE_DIR_ENTRIES = 100_000;
const MAX_DEPTH = 64;
const MAX_SEGMENT = 255;
/** Characters a segment may not hold: separators of another kind, a drive colon, control characters. */
const SEGMENT_REFUSED = /[\\:\u0000-\u001f\u007f]/;
/** C0, DEL and C1 controls: a name holding one is not shown at all. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const ORDER = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** "" for the root, else "/"-separated plain segments: no empty, ".", ".." or refused characters, at most 255 each and 64 deep. */
export function isWorkspaceDir(dir: unknown): dir is string {
  if (typeof dir !== "string") return false;
  if (dir === "") return true;
  const segments = dir.split("/");
  return (
    segments.length <= MAX_DEPTH &&
    segments.every((segment) => segment.length > 0 && segment.length <= MAX_SEGMENT && segment !== "." && segment !== ".." && !SEGMENT_REFUSED.test(segment))
  );
}

/** The request's directory and page, checked before anything is read. */
export function workspaceDirArguments(
  request: unknown,
): { readonly ok: true; readonly dir: string; readonly offset: number; readonly limit: number } | { readonly ok: false; readonly error: AppError } {
  const refuse = (message: string) => ({ ok: false as const, error: appError("invalid_arguments", message) });
  if (typeof request !== "object" || request === null) return refuse("the request must be an object");
  const { dir, offset, limit } = request as { dir?: unknown; offset?: unknown; limit?: unknown };
  if (!isWorkspaceDir(dir)) {
    return refuse(`dir must be "" or relative segments joined by "/" (no empty, ".", ".." or "\\", ":" or control characters; at most ${MAX_SEGMENT} characters each, ${MAX_DEPTH} deep)`);
  }
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) return refuse("offset must be a whole number from 0");
  if (limit !== undefined && (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > WORKSPACE_PAGE_SIZE)) {
    return refuse(`limit must be a whole number from 1 to ${WORKSPACE_PAGE_SIZE}`);
  }
  return { ok: true, dir, offset, limit: limit ?? WORKSPACE_PAGE_SIZE };
}

/** What the settings resolved to: the workspace, the masking and the protected paths. */
export interface WorkspaceDirSource {
  readonly workspaceRoot: string;
  /** The gateway of the values the settings register now. */
  readonly privacy: PrivacyGateway;
  /** Every API key value set now (knownKeyValues). */
  readonly keys: readonly string[];
  /** The effective policy's protected paths; absent protects nothing. */
  readonly protectedPaths: readonly string[] | undefined;
}

export interface WorkspaceDirOptions {
  /** MAX_WORKSPACE_DIR_ENTRIES unless given (tests). */
  readonly maxEntries?: number;
}

const errorCode = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;
const isStateName = (name: string): boolean => name.toLowerCase() === STATE_DIR_NAME;

function kindOf(dirent: Dirent, atRoot: boolean): WorkspaceEntryKind {
  if (atRoot && isStateName(dirent.name)) return "state";
  if (dirent.isSymbolicLink()) return "link";
  if (dirent.isDirectory()) return "dir";
  if (dirent.isFile()) return "file";
  return "other";
}

const rank = (kind: WorkspaceEntryKind): number => (kind === "dir" || kind === "state" ? 0 : 1);

/** The shown name; "" when it cannot be shown at all (a control character, or masking failed). */
function shownOf(name: string, source: WorkspaceDirSource): string {
  if (CONTROL.test(name)) return "";
  let masked;
  try {
    masked = source.privacy.mask(hideKeys(cleanText(name), source.keys));
  } catch {
    return "";
  }
  return masked.ok ? masked.text : "";
}

/** Lists `dir` (checked by workspaceDirArguments) of the workspace the settings resolved to. */
export async function listWorkspaceDirIn(
  source: WorkspaceDirSource,
  dir: string,
  offset: number,
  limit: number,
  options: WorkspaceDirOptions = {},
): Promise<AppCallOutcome<WorkspaceDirListing>> {
  const status = (value: "not_found" | "not_dir" | "too_large" | "refused" | "unreadable"): AppCallOutcome<WorkspaceDirListing> => ({
    ok: true,
    output: { kind: "workspace_dir", status: value },
  });
  let root: string;
  let workspace;
  try {
    workspace = await createWorkspace({ root: source.workspaceRoot });
    root = workspace.root;
  } catch {
    return { ok: false, error: appError("workspace_not_found", "the workspace is not an existing directory") };
  }

  const segments = dir === "" ? [] : dir.split("/");
  if (segments.length > 0) {
    // The engine's rules first (inside the root, not the state directory, no invalid names).
    const resolved = await workspace.resolve(dir, "read");
    if (!resolved.ok || (segments[0] !== undefined && isStateName(segments[0]))) return status("refused");
    // Then every segment as it is on disk: a link or junction on the way is never followed.
    for (let index = 0; index < segments.length; index += 1) {
      let stat;
      try {
        stat = await lstat(path.join(root, ...segments.slice(0, index + 1)));
      } catch (error) {
        const code = errorCode(error);
        return status(code === "ENOENT" || code === "ENOTDIR" ? "not_found" : "unreadable");
      }
      if (stat.isSymbolicLink()) return status("refused");
      if (!stat.isDirectory()) return status(index === segments.length - 1 ? "not_dir" : "not_found");
    }
  }

  let dirents: Dirent[];
  try {
    dirents = await readdir(path.join(root, ...segments), { withFileTypes: true });
  } catch (error) {
    const code = errorCode(error);
    return status(code === "ENOENT" ? "not_found" : code === "ENOTDIR" ? "not_dir" : "unreadable");
  }
  if (dirents.length > (options.maxEntries ?? MAX_WORKSPACE_DIR_ENTRIES)) return status("too_large");

  const covered = compileProtectedPaths(source.protectedPaths);
  const atRoot = segments.length === 0;
  const all = dirents.map((dirent) => {
    const name = dirent.name;
    const kind = kindOf(dirent, atRoot);
    const shown = shownOf(name, source);
    const masked = shown !== name;
    const entry: WorkspaceEntry = {
      name: masked ? null : name,
      shown: shown as MaskedText,
      kind,
      masked,
      protected: covered.covers(atRoot ? name : `${dir}/${name}`),
    };
    return { sortName: name, entry };
  });
  all.sort(
    (a, b) =>
      rank(a.entry.kind) - rank(b.entry.kind) ||
      ORDER.compare(a.sortName, b.sortName) ||
      (a.sortName < b.sortName ? -1 : a.sortName > b.sortName ? 1 : 0),
  );
  const start = Math.min(offset, all.length);
  const end = start + limit;
  return {
    ok: true,
    output: {
      kind: "workspace_dir",
      status: "listed",
      masking: "current_secrets",
      entries: all.slice(start, end).map((item) => item.entry),
      total: all.length,
      offset: start,
      nextOffset: end < all.length ? end : null,
    },
  };
}
