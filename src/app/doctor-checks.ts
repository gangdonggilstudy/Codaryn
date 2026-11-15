/** U-324 (C10-1): the doctor's existing checks' helpers, a single source; its core and renderer still live in the CLI. */
import fs from "node:fs/promises";
import path from "node:path";
import { toSchemaFieldPath } from "../contracts/index.js";
import type { ConfigLocationDisplay, DoctorCheck, DoctorCheckStatus, DoctorStatus, DoctorText, SchemaFieldPath, Workspace } from "../contracts/index.js";
import { buildChildEnv, planWindowsLaunch } from "../tools/index.js";
import type { ExecutableFileSystem } from "../tools/index.js";
import { createWorkspace } from "../workspace/index.js";
import { inspectLock, nodeLockFileSystem } from "../store/index.js";
import { isMissingFile } from "./input/config-file.js";
import { jsonSyntaxPosition } from "./input/json-position.js";
import { MAX_KEY_SCAN_DEPTH, checkLocalPathSyntax, findKeyInJson, inputFileTooLarge, inputFileTooLargeMessage, rawTextHoldsKey } from "./input/security/index.js";
import type { KnownKeys } from "./input/security/index.js";
import type { SettingsEnvironment } from "./input/settings.js";
import type { InputErrorPosition } from "./input/task.js";
import type { DoctorCheckEnvironment, LockState } from "./doctor-types.js";

/** Y-4: doctor makes no network access, so it cannot know whether the model id exists. */
export const MODELS_HINT = "`codaryn models` lists the models the key can use";
export const MODEL_EXISTENCE_NOT_CHECKED = `whether the model exists is not checked (no network access); ${MODELS_HINT}`;

/** The Node.js major version `package.json` requires (`engines.node`). */
export const REQUIRED_NODE_MAJOR = 26;

/** Why a JSON input could not be used, for the typed doctor texts (N-21). */
type LoadFailure = "unreadable" | "key" | "json_syntax" | "too_deep";

type Loaded =
  | { readonly ok: true; readonly value: unknown; readonly path: string }
  | {
      readonly ok: false;
      readonly message: string;
      readonly missing?: boolean;
      readonly failure: LoadFailure;
      readonly line?: number;
      readonly column?: number;
    };

/** Read, key check on the raw text, parse, key check on the parsed value: the order `run` uses (S-6). */
export async function loadJson(io: DoctorCheckEnvironment, file: string, label: string, currentKey: KnownKeys): Promise<Loaded> {
  let text: string;
  try {
    text = await io.readFile(file);
  } catch (failure) {
    return { ok: false, message: `the ${label} cannot be read`, missing: isMissingFile(failure), failure: "unreadable" };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // DR-40 (b): a file over the cap is not read further (shown as unreadable, with the reason in the message).
  if (inputFileTooLarge(text)) return { ok: false, message: inputFileTooLargeMessage(label), failure: "unreadable" };
  if (rawTextHoldsKey(text, currentKey)) return { ok: false, message: `the ${label} contains a key value`, failure: "key" };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // N-15: the position from our own scan, never the parser's message.
    const at = jsonSyntaxPosition(text);
    return {
      ok: false,
      message: `the ${label} cannot be read as JSON${at === null ? "" : ` (line ${at.line}, column ${at.column})`}`,
      failure: "json_syntax",
      ...(at === null ? {} : { line: at.line, column: at.column }),
    };
  }
  const found = findKeyInJson(value, currentKey);
  if (found.kind === "key") return { ok: false, message: `the ${label} has a key field or key value at ${found.location}`, failure: "key" };
  if (found.kind === "too_deep") {
    return { ok: false, message: `the ${label} is nested more than ${MAX_KEY_SCAN_DEPTH} levels deep`, failure: "too_deep" };
  }
  return { ok: true, value, path: file };
}

/** A variable's value from an environment object; case-insensitive on Windows. */
function variable(env: SettingsEnvironment, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== "win32") return env[name];
  const key = Object.keys(env).find((item) => item.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

/** One executable a run may start: a command rule (run_command) or a command verifier. */
export interface CommandEntry {
  /** `policy.commands[i]` or `verifiers[i]`. */
  readonly position: string;
  readonly executable: string;
  /** The rule's `argsPrefix`, or the verifier's `args`. */
  readonly args: readonly string[];
  /** The verifier's `cwd` as written; null for a rule (the model chooses the cwd per call). */
  readonly cwd: string | null;
}

/**
 * PATH entries split into those that may be looked at and the number of network or device
 * entries (X-1): those are never touched, not even with stat. Quotes are dropped on Windows, as
 * the runner does.
 */
function pathEntries(value: string | undefined, platform: NodeJS.Platform): { local: string[]; remote: number } {
  const local: string[] = [];
  let remote = 0;
  for (const raw of (value ?? "").split(platform === "win32" ? ";" : ":")) {
    const entry = platform === "win32" ? raw.replaceAll('"', "") : raw;
    if (entry.length === 0) continue;
    if (checkLocalPathSyntax(entry, platform).ok) local.push(entry);
    else remote += 1;
  }
  return { local, remote };
}

function hasDirectoryPart(name: string, platform: NodeJS.Platform): boolean {
  if (name.includes("/")) return true;
  return platform === "win32" && (name.includes(path.win32.sep) || /^[A-Za-z]:/.test(name));
}

/**
 * Whether a command name would be found (existence only): a name with a directory part against
 * `baseDir`, otherwise in the absolute local PATH entries, with PATHEXT on Windows. Used where
 * the run applies no further rule (POSIX) or none can be judged (no workspace).
 */
async function existsOnPath(
  name: string,
  localDirs: readonly string[],
  env: Readonly<Record<string, string>>,
  baseDir: string,
  platform: NodeJS.Platform,
  isFile: (file: string) => Promise<boolean>,
): Promise<boolean> {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const extensions =
    platform === "win32" && pathApi.extname(name) === ""
      ? (variable(env, "PATHEXT", platform) ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((ext) => ext.length > 0)
      : [""];
  const hasDir = hasDirectoryPart(name, platform);
  const dirs = hasDir ? [pathApi.dirname(pathApi.resolve(baseDir, name))] : localDirs.filter((dir) => pathApi.isAbsolute(dir));
  const base = hasDir ? pathApi.basename(name) : name;
  for (const dir of dirs) {
    for (const ext of extensions) {
      if (await isFile(pathApi.join(dir, `${base}${ext}`))) return true;
    }
  }
  return false;
}

/** The reason code in a launch refusal such as "could not start process (executable_refused): ...". */
function reasonOf(message: string): string {
  const open = message.indexOf("(");
  const close = message.indexOf(")", open + 1);
  return open >= 0 && close > open ? message.slice(open + 1, close) : "refused";
}

/**
 * X-1, X-3: the `commands` check with the run's rules. The child environment is built as the
 * command runner builds it (`buildChildEnv`). A verifier's cwd is resolved by the workspace as
 * the verifier runner does (`outside_root`, `state_dir`, `invalid_path`). On Windows each
 * executable goes through the runner's own `planWindowsLaunch` (T-4: nothing inside the
 * workspace; `.cmd`/`.bat` only outside it with the narrow character set). Network and device
 * paths are never touched: PATH entries of that kind are left out and counted, and the file
 * access refuses such paths.
 */
export async function checkCommands(
  io: DoctorCheckEnvironment,
  entries: readonly CommandEntry[],
  env: SettingsEnvironment,
  workspaceRoot: string | null,
  platform: NodeJS.Platform,
): Promise<{ status: DoctorCheckStatus; message: string; text: DoctorText }> {
  const isLocal = (file: string): boolean => checkLocalPathSyntax(file, platform).ok;
  const childEnv = buildChildEnv(env as NodeJS.ProcessEnv, platform);
  const pathKey = Object.keys(childEnv).find((key) => (platform === "win32" ? key.toUpperCase() === "PATH" : key === "PATH"));
  const { local, remote } = pathEntries(pathKey === undefined ? undefined : childEnv[pathKey], platform);
  const launchEnv: Record<string, string> =
    pathKey === undefined ? childEnv : { ...childEnv, [pathKey]: local.join(platform === "win32" ? ";" : ":") };
  const realpathOf = io.realpath ?? ((file: string) => fs.realpath(file));
  const fileSystem: ExecutableFileSystem = {
    isFile: async (file) => isLocal(file) && (await io.isFile(file)),
    realpath: async (file) => {
      if (!isLocal(file)) throw new Error("not a local path");
      return realpathOf(file);
    },
  };

  let workspace: Workspace | null = null;
  if (workspaceRoot !== null) {
    try {
      workspace = await createWorkspace({ root: workspaceRoot });
    } catch {
      workspace = null;
    }
  }
  const systemRoot = variable(env, "SystemRoot", platform) ?? `C:${path.win32.sep}Windows`;
  const rejected: string[] = [];
  const notFound: string[] = [];
  const notFoundLocally: string[] = [];
  let allowed = 0;
  for (const entry of entries) {
    let cwdAbsolute = workspace?.root ?? io.cwd;
    if (workspace !== null && entry.cwd !== null) {
      const resolved = await workspace.resolve(entry.cwd, "cwd");
      if (!resolved.ok) {
        rejected.push(`${entry.position}.cwd (${resolved.code})`);
        continue;
      }
      cwdAbsolute = resolved.path.absolute;
    }
    const missing = (): void => {
      const couldBeRemote = remote > 0 && !hasDirectoryPart(entry.executable, platform);
      (couldBeRemote ? notFoundLocally : notFound).push(entry.position);
    };
    if (platform === "win32" && workspace !== null) {
      const plan = await planWindowsLaunch({
        executable: entry.executable,
        args: entry.args,
        cwdAbsolute,
        env: launchEnv,
        workspaceRoot: workspace.root,
        systemRoot,
        fileSystem,
      });
      if (plan.ok) allowed += 1;
      else if (reasonOf(plan.message) === "ENOENT") missing();
      else rejected.push(`${entry.position} (${reasonOf(plan.message)})`);
      continue;
    }
    if (await existsOnPath(entry.executable, local, launchEnv, cwdAbsolute, platform, fileSystem.isFile)) allowed += 1;
    else missing();
  }

  const parts: string[] = [];
  if (rejected.length > 0) parts.push(`rejected at run time: ${rejected.join(", ")}`);
  if (notFound.length > 0) parts.push(`not found: ${notFound.join(", ")}`);
  if (notFoundLocally.length > 0) parts.push(`not found in local PATH entries: ${notFoundLocally.join(", ")}`);
  if (remote > 0) {
    parts.push(`${remote} network or device PATH ${remote === 1 ? "entry" : "entries"} not checked: remote paths are not accessed`);
  }
  const problems: DoctorText = {
    id: "doctor.commands.problems",
    params: { rejected: rejected.length, notFound: notFound.length, notFoundLocally: notFoundLocally.length, remote },
  };
  if (rejected.length > 0 || notFound.length > 0) return { status: "fail", message: parts.join("; "), text: problems };
  if (parts.length > 0) {
    return { status: "warn", message: allowed > 0 ? `${allowed} executable(s) found; ${parts.join("; ")}` : parts.join("; "), text: problems };
  }
  return workspace !== null
    ? { status: "ok", message: `${allowed} executable(s) found and allowed by the run's rules`, text: { id: "doctor.commands.ok", params: { count: allowed } } }
    : {
        status: "ok",
        message: `${allowed} executable(s) found; the run's rules need a workspace and were not checked`,
        text: { id: "doctor.commands.ok_unchecked", params: { count: allowed } },
      };
}

/** N-21: a failed load of a config, task or script file as a typed doctor text. */
export function loadText(kind: "config" | "task" | "script", loaded: Extract<Loaded, { ok: false }>, location: ConfigLocationDisplay): DoctorText {
  const syntax = loaded.line !== undefined && loaded.column !== undefined ? { line: loaded.line, column: loaded.column } : null;
  if (kind === "config") {
    if (loaded.failure === "json_syntax" && syntax !== null) return { id: "doctor.config_file.json_syntax", params: { location, ...syntax } };
    if (loaded.failure === "key") return { id: "doctor.config_file.key", params: { location } };
    if (loaded.failure === "too_deep") return { id: "doctor.config_file.too_deep", params: { location } };
    return { id: "doctor.config_file.unreadable", params: { location } };
  }
  if (kind === "task") {
    if (loaded.failure === "json_syntax" && syntax !== null) return { id: "doctor.task_file.json_syntax", params: syntax };
    if (loaded.failure === "key") return { id: "doctor.task_file.key" };
    if (loaded.failure === "too_deep") return { id: "doctor.task_file.too_deep" };
    return { id: "doctor.task_file.unreadable" };
  }
  if (loaded.failure === "json_syntax" && syntax !== null) return { id: "doctor.model.script_json_syntax", params: syntax };
  if (loaded.failure === "key") return { id: "doctor.model.script_key" };
  if (loaded.failure === "too_deep") return { id: "doctor.model.script_too_deep" };
  return { id: "doctor.model.script_unreadable" };
}

/** N-15, N-21: a validator's position as a schema field, or null when it is not a plain schema path. */
export function fieldOf(position: InputErrorPosition | undefined, message?: string): SchemaFieldPath | null {
  if (position !== undefined) return toSchemaFieldPath(position.field);
  return message === undefined ? null : toSchemaFieldPath(message.split(" ", 1)[0] ?? "");
}

/**
 * N-25 (a, b), N-27 (d), DR-27 (b): the lock as the next run would find it, judged by the store's
 * `inspectLock` with acquireLock's own rules (the Linux identity, then the process start time, then
 * the pid; and `lock.json.reclaim`). Reads only. `readText` and the liveness functions are injected
 * by tests; when a test injects liveness, the Linux identity is not asked, so the answer does not
 * depend on the platform. By default the store's functions decide.
 */
export async function inspectLockFile(
  workspaceRoot: string,
  readText: (file: string) => Promise<string>,
  isAlive?: (pid: number) => boolean,
  startTimeOf?: (pid: number) => Promise<number | null>,
): Promise<LockState> {
  const injected = isAlive !== undefined || startTimeOf !== undefined;
  const inspection = await inspectLock(workspaceRoot, {
    fileSystem: { ...nodeLockFileSystem, readText },
    ...(isAlive === undefined ? {} : { isProcessAlive: isAlive }),
    ...(startTimeOf === undefined ? {} : { processStartTime: startTimeOf }),
    ...(injected ? { processIdentity: async () => null } : {}),
  });
  return inspection.state;
}

export function worst(checks: readonly DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "ok";
}
