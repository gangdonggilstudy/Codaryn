/**
 * Where the engine host's Node comes from during development (DR-26: an installed Node 26 or
 * later). Packaged builds will carry their own Node; how is decided before distribution, and
 * until then a packaged build finds none. The version is checked from the host's `ready`.
 */

import { delimiter as posixDelimiter } from "node:path/posix";
import { isAbsolute as posixIsAbsolute, join as posixJoin } from "node:path/posix";
import { delimiter as winDelimiter, isAbsolute as winIsAbsolute, join as winJoin } from "node:path/win32";

/** Looks a variable up as the platform does: without case on Windows. */
export function envValue(env: Readonly<Record<string, string | undefined>>, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== "win32") return env[name];
  const wanted = name.toUpperCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === wanted && value !== undefined) return value;
  }
  return undefined;
}

const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i;

/**
 * R-10 L-3: whether a path may be looked at at all: not a network (UNC) path and not a device
 * path. The same rule as the CLI's `checkLocalPathSyntax` (src/cli/security/paths.ts), copied here
 * because the main process does not load engine code; a unit test keeps the two equal. Network and
 * device entries are never touched, not even with stat, so starting the app makes no SMB
 * connection and sends no credentials.
 */
export function isLocalPathSyntax(input: string, platform: NodeJS.Platform): boolean {
  if (input.length === 0 || input.includes("\0")) return false;
  if (platform !== "win32") return !/^\/+dev(\/|$)/.test(input);
  if (/^[\\/]{2}[?.][\\/]/.test(input) || /^[\\/]\?\?[\\/]/.test(input)) return false;
  if (/^[\\/]{2}/.test(input)) return false;
  const rest = /^[A-Za-z]:/.test(input) ? input.slice(2) : input;
  for (const segment of rest.split(/[\\/]/)) {
    const stem = (segment.split(".")[0] ?? "").trimEnd();
    if (WINDOWS_DEVICE_NAME.test(stem)) return false;
  }
  return true;
}

/**
 * The Node to start the engine host with: `npm_node_execpath` (set by `npm start`) when it is an
 * absolute local path to a file, else the first `node` found through absolute local PATH entries.
 * Network and device paths are skipped without being touched (R-10 L-3). Null when there is none.
 */
export function findDevelopmentNode(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  isFile: (file: string) => boolean,
): string | null {
  const win = platform === "win32";
  const isAbs = win ? winIsAbsolute : posixIsAbsolute;
  const join = win ? winJoin : posixJoin;
  const usable = (path: string): boolean => isAbs(path) && isLocalPathSyntax(path, platform);
  const fromNpm = envValue(env, "npm_node_execpath", platform);
  if (fromNpm !== undefined && usable(fromNpm) && isFile(fromNpm)) return fromNpm;
  const path = envValue(env, "PATH", platform) ?? "";
  for (const entry of path.split(win ? winDelimiter : posixDelimiter)) {
    const dir = win ? entry.trim().replaceAll('"', "") : entry;
    if (dir.length === 0 || !usable(dir)) continue;
    const candidate = join(dir, win ? "node.exe" : "node");
    if (isFile(candidate)) return candidate;
  }
  return null;
}
