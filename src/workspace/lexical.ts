/**
 * Lexical path rules shared by the workspace and the policy gate.
 * Nothing here touches the file system: links are resolved by `Workspace.resolve`.
 */

import path from "node:path";

export const STATE_DIR_NAME = ".codaryn";

export type PathDenialCode = "outside_root" | "state_dir" | "invalid_path";

export type ContainmentOutcome =
  | {
      readonly ok: true;
      /** Relative to the root, `/` separated. "." is the root itself. */
      readonly relative: string;
    }
  | { readonly ok: false; readonly code: "outside_root" | "state_dir" };

export type LexicalOutcome =
  | { readonly ok: true; readonly absolute: string; readonly relative: string }
  | { readonly ok: false; readonly code: PathDenialCode };

const IS_WINDOWS = process.platform === "win32";

/** DOS device names. A segment such as `NUL` or `con.txt` opens a device, not a file. */
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i;
const WINDOWS_FORBIDDEN_CHARS = /[<>"|?*\u0000-\u001f]/;

/** True for the state directory name. Compared without case on every platform (conservative). */
export function isStateDirName(segment: string): boolean {
  return segment.toLowerCase() === STATE_DIR_NAME;
}

/** Rejects path strings that cannot name an ordinary file under the root. */
export function isValidPathInput(input: unknown): input is string {
  if (typeof input !== "string" || input.length === 0 || input.includes("\0")) {
    return false;
  }
  if (!IS_WINDOWS) {
    return true;
  }

  // UNC (`\\server\share`), device (`\\.\`, `\\?\`) and any other double-separator prefix.
  if (/^[\\/]{2}/.test(input)) {
    return false;
  }

  let rest = input;
  if (/^[A-Za-z]:/.test(input)) {
    // Drive-relative paths (`C:name`) depend on a per-drive current directory.
    if (!/^[A-Za-z]:[\\/]/.test(input)) {
      return false;
    }
    rest = input.slice(2);
  }
  // Any other colon is an alternate data stream or an NT namespace path.
  if (rest.includes(":") || WINDOWS_FORBIDDEN_CHARS.test(rest)) {
    return false;
  }

  for (const segment of rest.split(/[\\/]/)) {
    if (segment === "" || segment === "." || segment === "..") {
      continue;
    }
    // Windows drops trailing dots and spaces, so `.codaryn.` would open `.codaryn`.
    if (/[. ]$/.test(segment)) {
      return false;
    }
    const stem = (segment.split(".")[0] ?? "").trimEnd();
    if (WINDOWS_DEVICE_NAME.test(stem)) {
      return false;
    }
  }
  return true;
}

/**
 * Classifies an absolute, normalized path against the root.
 * `path.relative` ignores case on Windows.
 */
export function classifyAgainstRoot(root: string, absolute: string): ContainmentOutcome {
  const relative = path.relative(root, absolute);
  if (relative === "") {
    return { ok: true, relative: "." };
  }
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return { ok: false, code: "outside_root" };
  }
  const segments = relative.split(path.sep);
  if (isStateDirName(segments[0] ?? "")) {
    return { ok: false, code: "state_dir" };
  }
  return { ok: true, relative: segments.join("/") };
}

/** Validates and normalizes a path against the root without resolving links. */
export function lexicalCheck(root: string, input: unknown): LexicalOutcome {
  if (!isValidPathInput(input)) {
    return { ok: false, code: "invalid_path" };
  }
  const absolute = path.resolve(root, input);
  const outcome = classifyAgainstRoot(root, absolute);
  return outcome.ok ? { ok: true, absolute, relative: outcome.relative } : outcome;
}
