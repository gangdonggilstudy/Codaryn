/**
 * How one command is started on Windows (task G1).
 *
 * - The name is looked up with PATH and PATHEXT from the environment the child receives.
 *   The working directory is not searched, and relative PATH entries are skipped.
 *   A name with a directory part is resolved against the working directory instead.
 * - `.exe` and `.com` start directly, without a shell, as before, unless they lie inside the
 *   workspace (T-4): a program that resolves into the workspace is never run, whatever its type.
 * - `.cmd` and `.bat` start as `cmd.exe /d /s /c ""<script>" <args>"`, but only when the script
 *   path and every argument use a narrow character set, and only when the script is outside
 *   the workspace (a script the model wrote is never run through a shell).
 *   cmd.exe gets `NoDefaultCurrentDirectoryInExePath=1`, so commands inside the script are not
 *   looked up in the working directory either.
 * - Other file types are refused.
 *
 * Policy decisions stay with the policy gate. They use the name the model asked for (for example
 * `npm`). This module never widens or changes them; it can only refuse to start.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

/** File access used by the lookup. Injected in unit tests. */
export interface ExecutableFileSystem {
  /** True when the path names an existing regular file. Never throws. */
  isFile(path: string): Promise<boolean>;
  /** Real absolute path with links and short names resolved. Throws when it cannot be resolved. */
  realpath(path: string): Promise<string>;
}

export interface WindowsLaunchInput {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwdAbsolute: string;
  /** Environment the child receives (already filtered). PATH and PATHEXT are read from it. */
  readonly env: Readonly<Record<string, string>>;
  /** Real path of the workspace root. Without it, `.cmd` and `.bat` files are refused. */
  readonly workspaceRoot: string | undefined;
  /** Windows directory. cmd.exe is taken from its System32 folder. */
  readonly systemRoot: string;
  readonly fileSystem: ExecutableFileSystem;
}

export interface WindowsLaunch {
  readonly file: string;
  readonly args: readonly string[];
  /** True only for cmd.exe: the command line is passed exactly as built, without Node's quoting. */
  readonly verbatimArguments: boolean;
  readonly env: Readonly<Record<string, string>>;
}

export type WindowsLaunchPlan =
  | { readonly ok: true; readonly launch: WindowsLaunch }
  | { readonly ok: false; readonly message: string };

export const realExecutableFileSystem: ExecutableFileSystem = {
  async isFile(file) {
    try {
      return (await fs.stat(file)).isFile();
    } catch {
      return false;
    }
  },
  realpath: (file) => fs.realpath(file),
};

const DEFAULT_PATHEXT = [".com", ".exe", ".bat", ".cmd"] as const;
const DIRECT_TYPES = new Set([".exe", ".com"]);
const SCRIPT_TYPES = new Set([".cmd", ".bat"]);

/**
 * Characters an argument may use when it goes through cmd.exe. Everything else is refused,
 * including all cmd metacharacters (& | < > ^ % ! " ( ) and line breaks), whitespace, the
 * batch delimiters , and ;, wildcards, quotes and every non-ASCII character (Windows
 * "best fit" conversion can turn some of them into quotes or other metacharacters).
 */
const SCRIPT_ARGUMENT = /^[A-Za-z0-9_\-.:/\\=+@~#]+$/;
/** A script path: drive-letter path with the same set plus spaces (the path is quoted). */
const SCRIPT_PATH = /^[A-Za-z]:\\[A-Za-z0-9 _\-.\\=+@~#]*$/;
const ALLOWED_LIST = "letters, digits and _ - . : / \\ = + @ ~ #";

const NOT_FOUND = "could not start process (ENOENT)";

function refuse(reason: string, detail: string): WindowsLaunchPlan {
  return { ok: false, message: `could not start process (${reason}): ${detail}` };
}

/** Environment lookup without case, as Windows does. */
export function envValue(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const wanted = name.toUpperCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === wanted && value !== undefined) return value;
  }
  return undefined;
}

function pathExtensions(value: string | undefined): readonly string[] {
  const found: string[] = [];
  for (const entry of (value ?? "").split(";")) {
    const ext = entry.trim().toLowerCase();
    if (/^\.[a-z0-9_]+$/.test(ext) && !found.includes(ext)) found.push(ext);
  }
  return found.length > 0 ? found : DEFAULT_PATHEXT;
}

/** Drive-letter or UNC path. Relative entries (".", "bin", "\\x") are not searched. */
function fullyQualified(dir: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(dir) || /^[\\/]{2}[^\\/?.]/.test(dir);
}

function searchDirectories(value: string | undefined): string[] {
  return (value ?? "")
    .split(";")
    .map((entry) => entry.replaceAll('"', ""))
    .filter((entry) => entry.length > 0 && fullyQualified(entry));
}

async function findExecutable(input: WindowsLaunchInput): Promise<string | null> {
  const { executable, cwdAbsolute, env, fileSystem } = input;
  // An empty name or a NUL character cannot name a file.
  if (executable.length === 0 || executable.includes("\0")) return null;
  // "C:x.exe" depends on a per-drive current directory. Not supported.
  if (/^[A-Za-z]:(?![\\/])/.test(executable)) return null;
  const hasDirectory = /[\\/]/.test(executable) || /^[A-Za-z]:/.test(executable);
  const bases = hasDirectory
    ? [path.win32.resolve(cwdAbsolute, executable)]
    : searchDirectories(envValue(env, "PATH")).map((dir) => path.win32.join(dir, executable));
  const extensions = pathExtensions(envValue(env, "PATHEXT"));
  const literalFirst = path.win32.extname(executable) !== "";
  for (const base of bases) {
    const candidates = literalFirst ? [base, ...extensions.map((ext) => base + ext)] : extensions.map((ext) => base + ext);
    for (const candidate of candidates) {
      if (await fileSystem.isFile(candidate)) return candidate;
    }
  }
  return null;
}

/** Same path or below it, without case (ASCII paths; see SCRIPT_PATH). */
function insideOrSame(target: string, root: string): boolean {
  const child = path.win32.resolve(target).toLowerCase();
  const base = path.win32.resolve(root).toLowerCase();
  const prefix = base.endsWith("\\") ? base : `${base}\\`;
  return child === base || child.startsWith(prefix);
}

function typeOf(file: string): string {
  return path.win32.extname(file).toLowerCase();
}

/**
 * Real path of `found`, and whether it lies in the workspace. Both the found path and its real
 * path are compared with both the root as given and its real path, so a link cannot lead around
 * the check in either direction. `null` when a real path cannot be resolved.
 */
async function locate(
  found: string,
  workspaceRoot: string,
  fileSystem: ExecutableFileSystem,
): Promise<{ readonly real: string; readonly inside: boolean } | null> {
  let real: string;
  let rootReal: string;
  try {
    real = await fileSystem.realpath(found);
    rootReal = await fileSystem.realpath(workspaceRoot);
  } catch {
    return null;
  }
  const inside = [found, real].some((candidate) =>
    [workspaceRoot, rootReal].some((root) => insideOrSame(candidate, root)),
  );
  return { real, inside };
}

export async function planWindowsLaunch(input: WindowsLaunchInput): Promise<WindowsLaunchPlan> {
  const found = await findExecutable(input);
  if (found === null) return { ok: false, message: NOT_FOUND };
  const { workspaceRoot, fileSystem } = input;

  const type = typeOf(found);
  if (DIRECT_TYPES.has(type)) {
    // T-4: a program inside the workspace (one the model could have placed there) is not run,
    // whether it was named with a directory part or found through a PATH entry in the workspace.
    // Without a known root this check cannot be made; the CLI always supplies the root.
    if (workspaceRoot !== undefined) {
      const located = await locate(found, workspaceRoot, fileSystem);
      if (located === null) return { ok: false, message: NOT_FOUND };
      if (located.inside) return refuse("executable_refused", "executables inside the workspace are not run");
    }
    return { ok: true, launch: { file: found, args: input.args, verbatimArguments: false, env: input.env } };
  }
  if (!SCRIPT_TYPES.has(type)) {
    return refuse("unsupported_type", "only .exe, .com, .cmd and .bat files can be started");
  }

  if (workspaceRoot === undefined) {
    return refuse("script_refused", "the workspace root is not known, so .cmd and .bat files are not run");
  }
  const located = await locate(found, workspaceRoot, fileSystem);
  if (located === null) return { ok: false, message: NOT_FOUND };
  const script = located.real;
  // A link may lead elsewhere: the file cmd.exe would open must be a script too.
  if (!SCRIPT_TYPES.has(typeOf(script))) {
    return refuse("unsupported_type", "only .exe, .com, .cmd and .bat files can be started");
  }
  if (located.inside) {
    return refuse("script_refused", ".cmd and .bat files inside the workspace are not run");
  }
  if (!SCRIPT_PATH.test(script)) {
    return refuse(
      "script_refused",
      `the script path has a character outside the set allowed for cmd.exe (${ALLOWED_LIST}, space)`,
    );
  }
  for (let index = 0; index < input.args.length; index += 1) {
    if (!SCRIPT_ARGUMENT.test(input.args[index] ?? "")) {
      return refuse(
        "script_refused",
        `argument ${index + 1} has a character outside the set allowed for cmd.exe (${ALLOWED_LIST}); it must not be empty`,
      );
    }
  }

  // /d: no AutoRun commands. /s with the outer quotes: cmd.exe removes exactly those two quotes
  // and runs the rest as written. Only the script path is quoted; the arguments need no quoting.
  const commandLine = [`"${script}"`, ...input.args].join(" ");
  return {
    ok: true,
    launch: {
      file: path.win32.join(input.systemRoot, "System32", "cmd.exe"),
      args: ["/d", "/s", "/c", `"${commandLine}"`],
      verbatimArguments: true,
      env: { ...input.env, NoDefaultCurrentDirectoryInExePath: "1" },
    },
  };
}
