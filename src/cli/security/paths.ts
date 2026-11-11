/**
 * Path checks for files the CLI reads before a run (S-1, S-5).
 * `checkLocalPathSyntax` never touches the file system. `locateInWorkspace` only resolves real paths.
 */

import { realpath as realpathCallback } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export type PathSyntaxOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: "unc" | "device" | "invalid" };

/** DOS device names. `CON`, `nul.json` and `COM1.txt` open a device on Windows, not a file. */
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i;

/**
 * S-5: rejects paths that would reach another machine or a device before any file access.
 * On Windows: UNC (`\\server\share`, `//server/share`), device namespaces (`\\?\`, `\\.\`, `\??\`)
 * and DOS device names in any segment. On POSIX: anything under `/dev/`.
 * Call it on the path as given and again on the absolute path it resolves to: a relative path
 * under a UNC working directory becomes UNC after `path.resolve`.
 */
export function checkLocalPathSyntax(input: string, platform: NodeJS.Platform = process.platform): PathSyntaxOutcome {
  if (typeof input !== "string" || input.length === 0 || input.includes("\0")) return { ok: false, reason: "invalid" };
  if (platform !== "win32") {
    return /^\/+dev(\/|$)/.test(input) ? { ok: false, reason: "device" } : { ok: true };
  }
  if (/^[\\/]{2}[?.][\\/]/.test(input) || /^[\\/]\?\?[\\/]/.test(input)) return { ok: false, reason: "device" };
  if (/^[\\/]{2}/.test(input)) return { ok: false, reason: "unc" };
  const rest = /^[A-Za-z]:/.test(input) ? input.slice(2) : input;
  for (const segment of rest.split(/[\\/]/)) {
    const stem = (segment.split(".")[0] ?? "").trimEnd();
    if (WINDOWS_DEVICE_NAME.test(stem)) return { ok: false, reason: "device" };
  }
  return { ok: true };
}

/** The two calls `locateInWorkspace` makes. Tests inject failures here. */
export interface RealpathFs {
  /** Resolves every link (and 8.3 short names on Windows). Rejects with ENOENT when missing. */
  realpath(path: string): Promise<string>;
  /** Does not follow a link in the last segment. */
  lstat(path: string): Promise<unknown>;
}

const realpathNative = promisify(realpathCallback.native);
const nodeRealpathFs: RealpathFs = { realpath: (target) => realpathNative(target), lstat: (target) => fs.lstat(target) };

function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** Real path of `target`, resolving the deepest existing ancestor when the rest does not exist. */
async function realPathOf(target: string, files: RealpathFs): Promise<string | null> {
  let current = path.resolve(target);
  const rest: string[] = [];
  for (;;) {
    try {
      const real = await files.realpath(current);
      return rest.length > 0 ? path.join(real, ...rest) : real;
    } catch (error) {
      if (!isMissing(error)) return null;
    }
    try {
      // The name exists but its target does not: a dangling link. Where it leads is unknown.
      await files.lstat(current);
      return null;
    } catch (error) {
      if (!isMissing(error)) return null;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    rest.unshift(path.basename(current));
    current = parent;
  }
}

/** How one real path relates to another. "unknown": either cannot be resolved. */
export type PathRelation = "same" | "inside" | "contains" | "separate" | "unknown";

function isBelow(child: string, parent: string, platform: NodeJS.Platform): boolean {
  // Same separator rule as locateInWorkspace: on Windows `<dir>:x` is a stream of `<dir>` itself.
  const separator = platform === "win32" ? /[\\/:]/ : /\//;
  return child.startsWith(parent) && separator.test(child.charAt(parent.length));
}

/**
 * U-1, U-3: where the real path of `target` lies relative to the real path of `base`, after
 * links and short names are resolved: the same path, inside it, containing it, or neither.
 * Both must exist. Windows compares without case.
 */
export async function relateRealPaths(
  target: string,
  base: string,
  files: RealpathFs = nodeRealpathFs,
  platform: NodeJS.Platform = process.platform,
): Promise<PathRelation> {
  if (typeof target !== "string" || target.length === 0 || typeof base !== "string" || base.length === 0) return "unknown";
  const api = platform === "win32" ? path.win32 : path.posix;
  let realTarget: string;
  let realBase: string;
  try {
    realTarget = await files.realpath(api.resolve(target));
    realBase = await files.realpath(api.resolve(base));
  } catch {
    return "unknown";
  }
  const fold = (value: string): string => (platform === "win32" ? value.toLowerCase() : value).replace(/[\\/]+$/, "");
  const a = fold(realTarget);
  const b = fold(realBase);
  if (a === b) return "same";
  if (isBelow(a, b, platform)) return "inside";
  if (isBelow(b, a, platform)) return "contains";
  return "separate";
}

export type WorkspaceLocation = "inside" | "outside" | "unknown";

/**
 * S-1: where `file` really is relative to the workspace, after links and short names are
 * resolved. Windows compares without case. The root must exist.
 * Treat "unknown" like "inside": the caller cannot prove that a run cannot change the file.
 */
export async function locateInWorkspace(
  file: string,
  workspaceRoot: string,
  files: RealpathFs = nodeRealpathFs,
  platform: NodeJS.Platform = process.platform,
): Promise<WorkspaceLocation> {
  if (typeof file !== "string" || file.length === 0 || typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
    return "unknown";
  }
  let root: string;
  try {
    root = await files.realpath(path.resolve(workspaceRoot));
  } catch {
    return "unknown";
  }
  const real = await realPathOf(file, files);
  if (real === null) return "unknown";

  const fold = (value: string): string => (platform === "win32" ? value.toLowerCase() : value);
  const normalizedRoot = fold(root.replace(/[\\/]+$/, ""));
  const normalizedFile = fold(real);
  // On Windows a ":" right after the root starts an alternate data stream of the root
  // directory itself (`<root>:cfg`), which belongs to the workspace (T-14).
  const separator = platform === "win32" ? /[\\/:]/ : /\//;
  if (normalizedFile === normalizedRoot) return "inside";
  if (normalizedFile.startsWith(normalizedRoot) && separator.test(normalizedFile.charAt(normalizedRoot.length))) {
    return "inside";
  }
  return "outside";
}
