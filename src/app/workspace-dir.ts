/**
 * U-89 (gap survey, GUI 3.3; PM: the draft's form and security requirements adopted): one directory
 * of a workspace for an adapter's file tree (`listWorkspaceDir`, adapter-contract 5.12).
 *
 * - The directory is named by plain relative segments (WORKSPACE_DIR_SHAPE); anything else is
 *   `invalid_arguments` before anything is read (U-102: so is a segment holding a character that
 *   makes a listed name masked for its shape, a C1 control, a line or paragraph separator or a
 *   default ignorable character: such an entry is not listed in turn). It is resolved by the
 *   engine's workspace rules (`Workspace.resolve`: inside the root, not the state directory, no
 *   invalid names), and every segment of it is looked at with `lstat`: a link or junction on the
 *   way is `refused`, so nothing is ever followed.
 * - Entries are read one level deep (`readdir` with their own types, which do not follow links): a
 *   link or junction is `link`, the root's `.codaryn` is `state`; neither can be listed in turn.
 * - Names are shown masked: a name with a control character is not shown at all (""); otherwise the
 *   key shapes and every key value set now (`hideKeys`), then the values the settings register now
 *   (the gateway's `mask`, AC-D14), both on the name as it is, so a value split by an invisible
 *   character is still found; then `cleanText`, and (U-102, R-78 L-2) every default ignorable
 *   character (zero width space and joiners, BOM, soft hyphen, Hangul fillers, variation selectors)
 *   is shown as "?", so two names cannot look the same. An entry whose shown name is not its name is
 *   `masked` and carries no `name`: the real name of a masked entry never leaves the app layer, and
 *   the entry can be neither opened nor chosen.
 * - `protected` (U-102, R-78 L-1): what the policy gate's write check says of the entry's path, with
 *   the policy's own matcher (`compileProtectedPaths`): by its letters (`covers`, as checkRequested),
 *   then by its real path (`coversEffective`, as checkEffective). So the target of a protected link,
 *   a link into a protected folder and a protected folder reached by its short name are protected
 *   too. The real path of a file or directory entry is the listed directory's real path and its name;
 *   a link or other entry is resolved as a write would resolve it. The workspace's resolutions are
 *   kept for the one listing. A check that cannot be made shows the entry as protected.
 * - A directory with more than MAX_WORKSPACE_DIR_ENTRIES entries is `too_large`: never listed in
 *   part. Pages of at most WORKSPACE_PAGE_SIZE, directories first, then the rest, each in a fixed
 *   order (numeric collation, then code points).
 * - Reads only: no lock, no records, nothing sent.
 */

import { lstat, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { STATE_DIR_NAME } from "../contracts/index.js";
import type { MaskedText, PathAccess, PrivacyGateway, ResolvePathOutcome, Workspace } from "../contracts/index.js";
import { REPLACEMENT, cleanText, hideKeys } from "../cli/text-safety.js";
import { compileProtectedPaths } from "../policy/index.js";
import { createWorkspace } from "../workspace/index.js";
import { appError } from "./errors.js";
import type { AppCallOutcome, AppError, WorkspaceDirListing, WorkspaceEntry, WorkspaceEntryKind } from "./types.js";

/** The most entries one page gives (as the GUI's tree and `inspect_files`). */
export const WORKSPACE_PAGE_SIZE = 500;
/** A directory with more entries is `too_large` rather than listed in part. */
export const MAX_WORKSPACE_DIR_ENTRIES = 100_000;
const MAX_DEPTH = 64;
const MAX_SEGMENT = 255;
/**
 * Characters a segment may not hold: separators of another kind, a drive colon, control characters,
 * and (U-102) the characters that make a listed name masked for its shape: C1 controls, line and
 * paragraph separators, default ignorable characters.
 */
const SEGMENT_REFUSED = /[\\:\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Default_Ignorable_Code_Point}]/u;
/** C0, DEL and C1 controls: a name holding one is not shown at all. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
/** U-102 (R-78 L-2): invisible characters (zero width space and joiners, BOM, soft hyphen, fillers), shown as REPLACEMENT. */
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;
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
    return refuse(`dir must be "" or relative segments joined by "/" (no empty, ".", ".." or "\\", ":", control or invisible characters; at most ${MAX_SEGMENT} characters each, ${MAX_DEPTH} deep)`);
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
    // On the name as it is: hideKeys and the gateway find a value split by an invisible character.
    masked = source.privacy.mask(hideKeys(name, source.keys));
  } catch {
    return "";
  }
  return masked.ok ? cleanText(masked.text).replace(INVISIBLE, REPLACEMENT) : "";
}

/** `workspace` with its path resolutions kept for one listing (the policy's matcher resolves its entries for every path). */
function listingWorkspace(workspace: Workspace): Workspace {
  const resolved = new Map<string, Promise<ResolvePathOutcome>>();
  return new Proxy(workspace, {
    get(target, key) {
      if (key === "resolve") {
        return (relative: string, access: PathAccess): Promise<ResolvePathOutcome> => {
          const id = `${access}:${relative}`;
          let outcome = resolved.get(id);
          if (outcome === undefined) {
            outcome = target.resolve(relative, access);
            resolved.set(id, outcome);
          }
          return outcome;
        };
      }
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
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
  /** The listed directory's real path relative to the root ("." for the root). */
  let realDir = ".";
  if (segments.length > 0) {
    // The engine's rules first (inside the root, not the state directory, no invalid names).
    const resolved = await workspace.resolve(dir, "read");
    if (!resolved.ok || (segments[0] !== undefined && isStateName(segments[0]))) return status("refused");
    realDir = resolved.path.relative;
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
  const resolving = listingWorkspace(workspace);
  const atRoot = segments.length === 0;
  /** U-102 (R-78 L-1): the policy gate's write check of the entry's path, by its letters, then by its real path. */
  const protectedOf = async (name: string, kind: WorkspaceEntryKind): Promise<boolean> => {
    const relative = atRoot ? name : `${dir}/${name}`;
    try {
      if (covered.covers(relative)) return true;
      let real: string;
      if (kind === "dir" || kind === "file") {
        real = realDir === "." ? name : `${realDir}/${name}`;
      } else {
        const outcome = await resolving.resolve(relative, "write");
        // A write the workspace refuses (outside the root, the state directory) meets no protected path.
        if (!outcome.ok) return false;
        real = outcome.path.relative;
      }
      return await covered.coversEffective(real, resolving);
    } catch {
      return true;
    }
  };
  const all: { sortName: string; entry: WorkspaceEntry }[] = [];
  for (const dirent of dirents) {
    const name = dirent.name;
    const kind = kindOf(dirent, atRoot);
    const shown = shownOf(name, source);
    const masked = shown !== name;
    const entry: WorkspaceEntry = {
      name: masked ? null : name,
      shown: shown as MaskedText,
      kind,
      masked,
      protected: await protectedOf(name, kind),
    };
    all.push({ sortName: name, entry });
  }
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
