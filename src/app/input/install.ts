/**
 * Where the running CLI is installed (U-3) and its version (U-7).
 * The install directory is the package root: the nearest directory above the entry file whose
 * package.json is named "codaryn". `npm link` and a global install both keep that layout.
 */

import path from "node:path";

export const PACKAGE_NAME = "codaryn";

export interface InstallInfo {
  /** Package root, as found from the entry file (not yet a real path). */
  readonly dir: string;
  /** `version` from package.json, or null when it is missing or not a plain version string. */
  readonly version: string | null;
}

const VERSION_PATTERN = /^[0-9A-Za-z.+-]{1,64}$/;

function packageOf(text: string): { name?: unknown; version?: unknown } | null {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as { name?: unknown; version?: unknown }) : null;
  } catch {
    return null;
  }
}

/** Walks up from the entry file. Null when no codaryn package.json is found. */
export async function findInstall(entryFile: string, readFile: (file: string) => Promise<string>): Promise<InstallInfo | null> {
  let dir = path.dirname(path.resolve(entryFile));
  for (;;) {
    let text: string | null;
    try {
      text = await readFile(path.join(dir, "package.json"));
    } catch {
      text = null;
    }
    const pkg = text === null ? null : packageOf(text);
    if (pkg !== null && pkg.name === PACKAGE_NAME) {
      const version = typeof pkg.version === "string" && VERSION_PATTERN.test(pkg.version) ? pkg.version : null;
      return { dir, version };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
