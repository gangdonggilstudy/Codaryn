// U-313 (the CLI migration's C-7b, after ne-verify's U-312): preloaded into a CLI process with
// `node --import` by scripts/compare-cli-boards.mjs for a step with `fsFaults`. Two file system faults
// this machine cannot otherwise make, as tests/support/fs-faults.ts makes them (U-312), kept here so
// that both builds of a comparison get the same imitation whatever commit each is:
// - `noLinksUnder`: every hard link made under that folder fails with ENOTSUP, as on a volume without
//   hard links (FAT, exFAT): the plan executor judges the moves unsafe (DR-21) and the lock is made as
//   a new file instead.
// - `failLockRemoval`: removing that file fails with EPERM, so the lock's release gives up after its
//   retries and the lock is left (U-220).
// The faults come as JSON in CODARYN_CMP_FS_FAULTS, with absolute paths. node:fs/promises is wrapped
// and the wrappers reach the loaded modules' named imports through syncBuiltinESMExports. Every other
// call is the original's. An imitation: no real FAT volume is used.

import { createRequire, syncBuiltinESMExports } from "node:module";
import path from "node:path";

const given = process.env.CODARYN_CMP_FS_FAULTS;
if (given !== undefined && given !== "") {
  const faults = JSON.parse(given);
  const fold = (text) => {
    const resolved = path.resolve(text);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const fault = (code, message) => Object.assign(new Error(`${message} (a comparison's fault)`), { code });
  const under = typeof faults.noLinksUnder === "string" ? fold(faults.noLinksUnder) + path.sep : null;
  const lock = typeof faults.failLockRemoval === "string" ? fold(faults.failLockRemoval) : null;
  const promises = createRequire(import.meta.url)("node:fs/promises");
  const originalLink = promises.link;
  const originalRm = promises.rm;
  promises.link = async (existing, target) => {
    if (under !== null && typeof target === "string" && fold(target).startsWith(under)) throw fault("ENOTSUP", "hard links are not supported here");
    return originalLink(existing, target);
  };
  promises.rm = async (target, options) => {
    if (lock !== null && typeof target === "string" && fold(target) === lock) throw fault("EPERM", "the lock file cannot be removed");
    return originalRm(target, options);
  };
  syncBuiltinESMExports();
}
