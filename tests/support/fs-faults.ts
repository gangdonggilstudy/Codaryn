/**
 * U-312 (ne-verify's C-7b integration gaps): two file system faults a test cannot otherwise make on this
 * machine, for a CLI process (`node --import`, startCli's `preload`) or for the test's own process (the app
 * layer). Both wrap node:fs/promises and carry the wrappers into the loaded modules' named imports with
 * syncBuiltinESMExports, as mark-at-lock.ts does.
 * - `noLinksUnder`: every hard link made under that folder fails with ENOTSUP, as on a volume without hard
 *   links (FAT, exFAT): the plan executor judges the moves unsafe (src/tools/plan-files.ts
 *   isLinkUnsupported, DR-21) and the lock is made as a new file instead (src/store/lock.ts tryCreate).
 * - `failLockRemoval`: removing that lock file fails with EPERM, so the lock's release gives up after its
 *   retries and the lock is left (src/store/lock.ts releaseLock, U-220).
 * Every other call is the original's. Test harness code, not product code.
 */

import { createRequire, syncBuiltinESMExports } from "node:module";
import path from "node:path";

export const FS_FAULTS_ENV = "CODARYN_IT_FS_FAULTS";
/** This module's URL, for `startCli`'s `preload`. */
export const FS_FAULTS_MODULE_URL = import.meta.url;

export interface FsFaults {
  readonly noLinksUnder?: string;
  readonly failLockRemoval?: string;
}

const require = createRequire(import.meta.url);

type Wrapped = {
  link: (existing: unknown, target: unknown) => Promise<void>;
  rm: (target: unknown, options?: unknown) => Promise<void>;
};

const fold = (text: string): string => {
  const resolved = path.resolve(text);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

function fault(code: string, message: string): Error {
  return Object.assign(new Error(`${message} (a test's fault)`), { code });
}

/** Installs the faults; `remove()` puts the originals back. `counts` says how often each fault was met. */
export function installFsFaults(faults: FsFaults): { readonly remove: () => void; readonly counts: { links: number; removals: number } } {
  const promises = require("node:fs/promises") as Wrapped;
  const originalLink = promises.link;
  const originalRm = promises.rm;
  const under = faults.noLinksUnder === undefined ? null : fold(faults.noLinksUnder) + path.sep;
  const lock = faults.failLockRemoval === undefined ? null : fold(faults.failLockRemoval);
  const counts = { links: 0, removals: 0 };
  promises.link = async (existing, target) => {
    if (under !== null && typeof target === "string" && fold(target).startsWith(under)) {
      counts.links += 1;
      throw fault("ENOTSUP", "hard links are not supported here");
    }
    return originalLink(existing, target);
  };
  promises.rm = async (target, options) => {
    if (lock !== null && typeof target === "string" && fold(target) === lock) {
      counts.removals += 1;
      throw fault("EPERM", "the lock file cannot be removed");
    }
    return originalRm(target, options);
  };
  syncBuiltinESMExports();
  return {
    remove: () => {
      promises.link = originalLink;
      promises.rm = originalRm;
      syncBuiltinESMExports();
    },
    counts,
  };
}

const given = process.env[FS_FAULTS_ENV];
if (given !== undefined && given !== "") installFsFaults(JSON.parse(given) as FsFaults);
