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

/**
 * The Node to start the engine host with: `npm_node_execpath` (set by `npm start`) when it is an
 * absolute path to a file, else the first `node` on PATH found through absolute PATH entries only.
 * Null when there is none.
 */
export function findDevelopmentNode(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  isFile: (file: string) => boolean,
): string | null {
  const win = platform === "win32";
  const isAbs = win ? winIsAbsolute : posixIsAbsolute;
  const join = win ? winJoin : posixJoin;
  const fromNpm = envValue(env, "npm_node_execpath", platform);
  if (fromNpm !== undefined && isAbs(fromNpm) && isFile(fromNpm)) return fromNpm;
  const path = envValue(env, "PATH", platform) ?? "";
  for (const entry of path.split(win ? winDelimiter : posixDelimiter)) {
    const dir = entry.trim().replace(/^"(.*)"$/, "$1");
    if (dir.length === 0 || !isAbs(dir)) continue;
    const candidate = join(dir, win ? "node.exe" : "node");
    if (isFile(candidate)) return candidate;
  }
  return null;
}
