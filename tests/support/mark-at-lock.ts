/**
 * U-304 (ne-verify R-116 I-2; U-1, U-195): writes a plan run's records-changed mark at the moment its
 * workspace lock is taken, so that the mark comes after apply's own look (before the lock) and before
 * the look under the lock: the window U-1's second look exists for, without a race. The lock file is
 * made by a hard link or, where links are not supported, a new file (src/store/lock.ts tryCreate); both
 * calls of node:fs/promises are wrapped, and syncBuiltinESMExports() carries the wrappers into the
 * named imports of the modules already loaded. Only the first making of that one lock file writes the
 * mark; every other call is the original's.
 *
 * Test harness code, not product code. Two uses:
 * - in a CLI process: `node --import <this module>` with MARK_AT_LOCK_ENV naming the lock file and the
 *   mark file (`<lock>|<mark>`); without it, importing this module does nothing;
 * - in the test's own process (the app layer's applyPlan): installMarkAtLock, then its remover.
 */

import { writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import path from "node:path";

export const MARK_AT_LOCK_ENV = "CODARYN_IT_MARK_AT_LOCK";
/** This module's URL, for `startCli`'s `preload`. */
export const MARK_AT_LOCK_MODULE_URL = import.meta.url;

const require = createRequire(import.meta.url);

type Wrapped = { link: (existing: unknown, target: unknown) => Promise<void>; writeFile: (file: unknown, data: unknown, options?: unknown) => Promise<void> };

/** Wraps the lock file's making; returns the remover. `made()` says whether the mark was written. */
export function installMarkAtLock(lockFile: string, markFile: string): { readonly remove: () => void; readonly made: () => boolean } {
  const promises = require("node:fs/promises") as Wrapped;
  const originalLink = promises.link;
  const originalWriteFile = promises.writeFile;
  const fold = (text: string): string => (process.platform === "win32" ? text.toLowerCase() : text);
  const target = fold(path.resolve(lockFile));
  const isLock = (file: unknown): boolean => typeof file === "string" && fold(path.resolve(file)) === target;
  let written = false;
  const mark = (): void => {
    if (written) return;
    written = true;
    writeFileSync(markFile, "{}\n");
  };
  promises.link = async (existing, to) => {
    if (isLock(to)) mark();
    return originalLink(existing, to);
  };
  promises.writeFile = async (file, data, options) => {
    if (isLock(file)) mark();
    return originalWriteFile(file, data, options);
  };
  syncBuiltinESMExports();
  return {
    remove: () => {
      promises.link = originalLink;
      promises.writeFile = originalWriteFile;
      syncBuiltinESMExports();
    },
    made: () => written,
  };
}

const given = process.env[MARK_AT_LOCK_ENV];
if (given !== undefined && given.includes("|")) {
  const [lockFile, markFile] = given.split("|") as [string, string];
  installMarkAtLock(lockFile, markFile);
}
