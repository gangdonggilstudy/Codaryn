/**
 * `codaryn doctor [--config <file>] [--vars-file <file>] [--task <task.json> | --workspace <dir>] [--json]`
 * (U-6): checks what a run would need, without running one. No network access, no model request,
 * no write, and the process environment is not changed (the variables file is parsed, not loaded).
 *
 * Messages are built from fixed text, field positions and counts. No value read from a file or the
 * environment is printed: the API key is reported as set or not set only, and paths, names and
 * file contents are not echoed. Validation messages from the config and task parsers name fields
 * only, by the same rule. Printed text also passes `hideKeys`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import {
  ANTHROPIC_API_KEY_ENV,
  CODARYN_API_BASE_URL_ENV,
  CODARYN_CONFIG_ENV,
  CODARYN_MODEL_ENV,
  DOCTOR_CHECK_IDS,
  DOCTOR_EXIT_CODES,
  CODARYN_LANG_ENV,
  LOCK_FILE_NAME,
  STATE_DIR_NAME,
  toSchemaFieldPath,
} from "../contracts/index.js";
import type {
  CatalogText,
  CodarynConfig,
  ConfigLocationDisplay,
  DefaultConfigLocation,
  DoctorText,
  ExplainMessageLanguage,
  MessageCatalog,
  MessageId,
  SchemaFieldPath,
  DoctorCheck,
  DoctorCheckId,
  DoctorCheckStatus,
  DoctorOutput,
  DoctorStatus,
  ResolvedTaskSpec,
  Workspace,
} from "../contracts/index.js";
import { parseScript } from "../model/index.js";
import { buildChildEnv, planWindowsLaunch } from "../tools/index.js";
import type { ExecutableFileSystem } from "../tools/index.js";
import { createWorkspace } from "../workspace/index.js";
import { parseDoctorArgs } from "./args.js";
import { parseConfig } from "./config.js";
import { chooseConfigFile, isMissingFile, selectProfile } from "./config-file.js";
import { jsonSyntaxPosition } from "./json-position.js";
import { jsonLine } from "./guard.js";
import type { CommandOutcome } from "./guard.js";
import { cliError } from "./run.js";
import {
  MAX_KEY_SCAN_DEPTH,
  checkLocalPathSyntax,
  findKeyInJson,
  normalizeApiBaseUrlStrict,
  rawTextHoldsKey,
} from "./security/index.js";
import type { PathRelation, WorkspaceLocation } from "./security/index.js";
import { envValue, missingModelText, modelPlaceholderSeen, resolveModelId } from "./settings.js";
import type { SettingsEnvironment } from "./settings.js";
import { PROCESS_START_TOLERANCE_MS, isRunTimestamp, processStartTime } from "../store/index.js";
import { buildQuickTask, localPathProblem, parseTask } from "./task.js";
import type { InputErrorPosition } from "./task.js";
import { hideKeys } from "./text-safety.js";

/** Y-4: doctor makes no network access, so it cannot know whether the model id exists. */
export const MODELS_HINT = "`codaryn models` lists the models the key can use";
export const MODEL_EXISTENCE_NOT_CHECKED = `whether the model exists is not checked (no network access); ${MODELS_HINT}`;

/** The Node.js major version `package.json` requires (`engines.node`). */
export const REQUIRED_NODE_MAJOR = 26;

export interface DoctorEnvironment {
  readonly argv: readonly string[];
  /** The process environment. Read, never changed. */
  readonly env: SettingsEnvironment;
  readonly cwd: string;
  /** `process.versions.node`. */
  readonly nodeVersion: string;
  /** The CLI's package root. Undefined: not checked. Null: it could not be determined. */
  readonly installDir?: string | null;
  readonly readFile: (file: string) => Promise<string>;
  readonly isDirectory: (dir: string) => Promise<boolean>;
  /** True when `file` names an existing regular file. Never throws. */
  readonly isFile: (file: string) => Promise<boolean>;
  /** Real path, as the command runner resolves it (`fs.realpath` when absent). */
  readonly realpath?: (file: string) => Promise<string>;
  readonly locateInWorkspace: (file: string, workspaceRoot: string) => Promise<WorkspaceLocation>;
  readonly relatePaths: (target: string, base: string) => Promise<PathRelation>;
  readonly platform?: NodeJS.Platform;
  /** N-1: the default config location (`findDefaultConfigLocation`). Absent or null: none. */
  readonly defaultConfig?: DefaultConfigLocation | null;
  /** N-1: a default location exists but is a network or device path, so it is not used. */
  readonly defaultConfigRefused?: boolean;
  /** N-21: the catalog for the text output in the chosen language. Absent: the English messages. */
  readonly messages?: MessageCatalog;
  /** N-20: `explainMessageLanguage` (src/i18n). Absent: the `language` check is `skipped`. */
  readonly explainLanguage?: ExplainMessageLanguage;
  /** `Intl` locale for the language check (`runtimeLocale()` in the real CLI). */
  readonly osLocale?: string | null;
  /** N-25 (a): the state of `<workspace>/.codaryn/lock.json`, read without changing it. Absent: `skipped`. */
  readonly inspectLock?: (workspaceRoot: string) => Promise<LockState>;
}

/**
 * N-25 (a): none, held by a live process, left by an ended one, or unreadable. DR-27 (b):
 * `reclaim_left` when `lock.json.reclaim` is in a state the store never clears, so no lock is
 * reclaimed while it stays.
 */
export type LockState = "none" | "held" | "stale" | "unreadable" | "reclaim_left";

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
async function loadJson(io: DoctorEnvironment, file: string, label: string, currentKey: string | null): Promise<Loaded> {
  let text: string;
  try {
    text = await io.readFile(file);
  } catch (failure) {
    return { ok: false, message: `the ${label} cannot be read`, missing: isMissingFile(failure), failure: "unreadable" };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
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
interface CommandEntry {
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
async function checkCommands(
  io: DoctorEnvironment,
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
function loadText(kind: "config" | "task" | "script", loaded: Extract<Loaded, { ok: false }>, location: ConfigLocationDisplay): DoctorText {
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
function fieldOf(position: InputErrorPosition | undefined, message?: string): SchemaFieldPath | null {
  if (position !== undefined) return toSchemaFieldPath(position.field);
  return message === undefined ? null : toSchemaFieldPath(message.split(" ", 1)[0] ?? "");
}

/**
 * N-25 (a, b), review R-6 low 1: reads the lock file without changing it and judges its holder as
 * the store's `acquireLock` does: a pid that does not run is stale; a lock with
 * `processStartedAt` whose pid now runs a process started at another time (beyond
 * PROCESS_START_TOLERANCE_MS) is stale too, since the pid was given to another process; an unknown
 * start time counts as held; a lock without it (written before N-25 b) is judged by its pid alone.
 * A start time that is not a timestamp is not understood: "unreadable", as the store never reclaims it.
 *
 * DR-27 (b): `lock.json.reclaim` is read first, as the store's reclaimer reads it. One whose owner
 * has ended is cleared by the next run, so `lock.json` decides. Any other one stays: text still
 * being written (no final newline and not yet whole JSON; an exclusive create on a volume without
 * hard links leaves it so when the attempt ends in between), text that is not understood, or a
 * live owner. Then no lock is reclaimed while it stays: `reclaim_left`.
 */
export async function inspectLockFile(
  workspaceRoot: string,
  readText: (file: string) => Promise<string>,
  isAlive: (pid: number) => boolean = processAlive,
  startTimeOf: (pid: number) => Promise<number | null> = processStartTime,
): Promise<LockState> {
  let reclaim: string | null;
  try {
    reclaim = await readText(path.join(workspaceRoot, STATE_DIR_NAME, `${LOCK_FILE_NAME}.reclaim`));
  } catch (failure) {
    if (!isMissingFile(failure)) return "reclaim_left";
    reclaim = null;
  }
  if (reclaim !== null && (stillWritten(reclaim) || (await judgeLockText(reclaim, isAlive, startTimeOf)) !== "stale")) return "reclaim_left";
  let text: string;
  try {
    text = await readText(path.join(workspaceRoot, STATE_DIR_NAME, LOCK_FILE_NAME));
  } catch (failure) {
    return isMissingFile(failure) ? "none" : "unreadable";
  }
  return judgeLockText(text, isAlive, startTimeOf);
}

/** As the store: text with no final newline that is not yet whole JSON may still be growing. */
function stillWritten(text: string): boolean {
  if (text.endsWith("\n")) return false;
  try {
    JSON.parse(text);
    return false;
  } catch {
    return true;
  }
}

/** A complete lock-shaped text's holder, judged as the store's `acquireLock` judges it. */
async function judgeLockText(
  text: string,
  isAlive: (pid: number) => boolean,
  startTimeOf: (pid: number) => Promise<number | null>,
): Promise<"held" | "stale" | "unreadable"> {
  let pid: unknown;
  let processStartedAt: unknown;
  try {
    ({ pid, processStartedAt } = (JSON.parse(text) ?? {}) as { pid?: unknown; processStartedAt?: unknown });
  } catch {
    return "unreadable";
  }
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return "unreadable";
  if (processStartedAt !== undefined && (typeof processStartedAt !== "string" || !isRunTimestamp(processStartedAt))) return "unreadable";
  if (!isAlive(pid)) return "stale";
  if (processStartedAt === undefined) return "held";
  let actual: number | null;
  try {
    actual = await startTimeOf(pid);
  } catch {
    actual = null;
  }
  if (actual === null) return "held";
  return Math.abs(actual - Date.parse(processStartedAt)) <= PROCESS_START_TOLERANCE_MS ? "held" : "stale";
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: unknown }).code === "EPERM";
  }
}

function worst(checks: readonly DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "ok";
}

/** N-21: the text output in the catalog's language. Without a catalog (or a text), the English lines. */
export function renderDoctor(output: DoctorOutput, messages?: MessageCatalog): string {
  if (messages === undefined) return renderDoctorEnglish(output);
  const raw = messages.format as (id: MessageId, params?: object) => CatalogText;
  // A catalog without a text for an id (an older catalog) must not stop doctor: the English stays.
  const format = (id: MessageId, fallback: string, params?: object): string => {
    try {
      return raw(id, params);
    } catch {
      return fallback;
    }
  };
  const status = (value: DoctorCheckStatus): string => `[${format(`doctor.status.${value}`, value)}]`;
  const labels = output.checks.map((check) => format(`doctor.check.${check.id}`, check.id));
  const width = Math.max(...labels.map((label) => label.length));
  const lines = output.checks.map((check, index) => {
    const body =
      check.text === undefined ? check.message : format(check.text.id, check.message, "params" in check.text ? check.text.params : undefined);
    return `${status(check.status).padEnd(10)}${(labels[index] ?? check.id).padEnd(width)}  ${body}`;
  });
  const english = `doctor: ${output.status} (exit code ${output.exitCode}). No network access was made and nothing was changed.`;
  let footer: string;
  try {
    footer = raw("doctor.footer", { status: raw(`doctor.status.${output.status}`), exitCode: output.exitCode });
  } catch {
    footer = english;
  }
  lines.push("", footer);
  return `${lines.join("\n")}\n`;
}

function renderDoctorEnglish(output: DoctorOutput): string {
  const width = Math.max(...output.checks.map((check) => check.id.length));
  const lines = output.checks.map((check) => `[${check.status}]`.padEnd(10) + `${check.id.padEnd(width)}  ${check.message}`);
  lines.push("", `doctor: ${output.status} (exit code ${output.exitCode}). No network access was made and nothing was changed.`);
  return `${lines.join("\n")}\n`;
}

export async function runDoctor(io: DoctorEnvironment): Promise<CommandOutcome> {
  const parsed = parseDoctorArgs(io.argv);
  if (!parsed.ok) return cliError("invalid_arguments", parsed.message);
  const args = parsed.args;
  const platform = io.platform ?? process.platform;

  // S-5: nothing given on the command line may reach another machine or a device.
  const given: [string | null, string][] = [
    [args.configPath, "--config"],
    [args.varsFile, "--vars-file"],
    [args.taskPath, "--task"],
    [args.workspace, "--workspace"],
  ];
  for (const [value, option] of given) {
    if (value === null) continue;
    const problem = localPathProblem(value, io.cwd);
    if (problem !== null) return cliError("invalid_arguments", `the path given by ${option} ${problem}`);
  }

  const results = new Map<DoctorCheckId, DoctorCheck>();
  const set = (id: DoctorCheckId, status: DoctorCheckStatus, message: string, text: DoctorText): void => {
    results.set(id, { id, status, message, text });
  };

  // node_version
  const major = Number.parseInt(io.nodeVersion.split(".")[0] ?? "", 10);
  if (Number.isSafeInteger(major) && major >= REQUIRED_NODE_MAJOR) {
    set("node_version", "ok", `Node.js ${major} meets the requirement (${REQUIRED_NODE_MAJOR} or later)`, {
      id: "doctor.node_version.ok",
      params: { major, required: REQUIRED_NODE_MAJOR },
    });
  } else {
    set("node_version", "fail", `Node.js ${REQUIRED_NODE_MAJOR} or later is required`, { id: "doctor.node_version.fail", params: { required: REQUIRED_NODE_MAJOR } });
  }

  // vars_file: parsed, never loaded. Variables already set keep their values, as in `run`.
  let env: SettingsEnvironment = io.env;
  let varsPath: string | null = null;
  if (args.varsFile === null) {
    set("vars_file", "skipped", "no --vars-file given", { id: "doctor.vars_file.skipped" });
  } else {
    varsPath = path.resolve(io.cwd, args.varsFile);
    let text: string | null;
    try {
      text = await io.readFile(varsPath);
    } catch {
      text = null;
    }
    if (text === null) {
      set("vars_file", "fail", "the file given by --vars-file cannot be read", { id: "doctor.vars_file.unreadable" });
    } else if (text.charCodeAt(0) === 0xfeff) {
      set("vars_file", "fail", "the file given by --vars-file starts with a byte order mark; save it as UTF-8 without BOM", { id: "doctor.vars_file.bom" });
    } else {
      let loaded: Record<string, string | undefined>;
      try {
        loaded = parseEnv(text);
      } catch {
        loaded = {};
      }
      env = { ...loaded, ...io.env };
      const count = Object.keys(loaded).length;
      set("vars_file", "ok", `the file given by --vars-file defines ${count} variable(s)`, { id: "doctor.vars_file.ok", params: { count } });
    }
  }
  const currentKey = envValue(env, ANTHROPIC_API_KEY_ENV);

  // config_file: --config, CODARYN_CONFIG, then the default location (N-1).
  let config: CodarynConfig | null = null;
  let configPath: string | null = null;
  const chosen = chooseConfigFile({ argument: args.configPath, env, cwd: io.cwd, defaultLocation: io.defaultConfig ?? null });
  const refusedNote = io.defaultConfigRefused === true ? "; the default location is a network or device path and is not used" : "";
  if (!chosen.ok) {
    set("config_file", "fail", `the path given by ${CODARYN_CONFIG_ENV} is not a plain local path`, { id: "doctor.config_file.env_not_local" });
  } else if (chosen.candidate === null) {
    if (io.defaultConfigRefused === true) {
      set("config_file", "warn", `no --config given and ${CODARYN_CONFIG_ENV} is not set${refusedNote}`, { id: "doctor.config_file.default_refused" });
    } else {
      set("config_file", "skipped", `no --config given, ${CODARYN_CONFIG_ENV} is not set and there is no default location`, { id: "doctor.config_file.none" });
    }
  } else {
    const candidate = chosen.candidate;
    const where = candidate.source === "default" ? ` at the default location ${candidate.display}` : "";
    const loaded = await loadJson(io, candidate.path, "config file", currentKey);
    if (!loaded.ok && candidate.optional && loaded.missing === true) {
      set(
        "config_file",
        "skipped",
        `no --config given, ${CODARYN_CONFIG_ENV} is not set and there is no file at the default location ${candidate.display}; \`codaryn init\` creates one`,
        { id: "doctor.config_file.default_missing", params: { location: candidate.display } },
      );
    } else if (!loaded.ok) {
      set("config_file", "fail", `${loaded.message}${where}`, loadText("config", loaded, candidate.display));
    } else {
      const outcome = parseConfig(loaded.value);
      if (outcome.ok) {
        config = outcome.config;
        configPath = loaded.path;
        set("config_file", "ok", `the config file${where} is valid`, { id: "doctor.config_file.valid_at", params: { location: candidate.display } });
      } else {
        const field = fieldOf(outcome.position);
        set(
          "config_file",
          "fail",
          outcome.message,
          field === null
            ? { id: "doctor.config_file.invalid_unlocated", params: { location: candidate.display } }
            : { id: "doctor.config_file.invalid", params: { location: candidate.display, field } },
        );
      }
    }
  }
  // N-8: --profile is checked against the config file as a run would. N-D 4.3: when the config
  // file itself failed, that failure stays the reason (a profile cannot be looked up in it).
  if (args.profile !== null && results.get("config_file")?.status !== "fail") {
    const selected = selectProfile(config, args.profile);
    if (selected.ok) config = selected.config;
    else set("config_file", "fail", selected.message, { id: "doctor.config_file.profile_missing" });
  }

  // task_file
  let task: ResolvedTaskSpec | null = null;
  let taskPath: string | null = null;
  if (args.taskPath === null) {
    set("task_file", "skipped", "no --task given", { id: "doctor.task_file.skipped" });
  } else {
    const loaded = await loadJson(io, path.resolve(io.cwd, args.taskPath), "task file", currentKey);
    if (!loaded.ok) {
      set("task_file", "fail", loaded.message, loadText("task", loaded, "--config"));
    } else {
      const outcome = parseTask(loaded.value, path.dirname(loaded.path), { limits: config?.limits });
      if (outcome.ok) {
        task = outcome.task;
        taskPath = loaded.path;
        set("task_file", "ok", "the task file is valid", { id: "doctor.task_file.valid" });
      } else {
        const field = fieldOf(outcome.position);
        set("task_file", "fail", outcome.message, field === null ? { id: "doctor.task_file.invalid_unlocated" } : { id: "doctor.task_file.invalid", params: { field } });
      }
    }
  }
  const taskUnusable = args.taskPath !== null && task === null;
  const provider = task?.model.provider ?? "anthropic";

  // api_key: present or not, nothing else.
  if (taskUnusable) {
    set("api_key", "skipped", "the task file could not be used", { id: "doctor.task_unusable" });
  } else if (provider === "scripted") {
    set("api_key", "skipped", "the task uses the scripted model; no key is needed", { id: "doctor.api_key.scripted" });
  } else if (currentKey !== null) {
    set("api_key", "ok", `${ANTHROPIC_API_KEY_ENV} is set`, { id: "doctor.api_key.ok" });
  } else {
    set("api_key", "fail", `${ANTHROPIC_API_KEY_ENV} is not set; an anthropic run stops with provider_not_configured`, { id: "doctor.api_key.missing" });
  }

  // model
  if (taskUnusable) {
    set("model", "skipped", "the task file could not be used", { id: "doctor.task_unusable" });
  } else if (task !== null && task.model.provider === "scripted") {
    const scriptPath = task.model.scriptPath;
    const loaded = await loadJson(io, scriptPath, "script file", currentKey);
    const script = loaded.ok ? parseScript(loaded.value) : null;
    if (!loaded.ok) set("model", "fail", loaded.message, loadText("script", loaded, "--config"));
    else if (script !== null && !script.ok) {
      const field = fieldOf(undefined, script.message);
      set("model", "fail", script.message, field === null ? { id: "doctor.model.script_invalid_unlocated" } : { id: "doctor.model.script_invalid", params: { field } });
    } else set("model", "ok", "the scripted model file is valid", { id: "doctor.model.scripted_ok" });
  } else {
    const fromTask = task !== null && task.model.provider === "anthropic" ? task.model : null;
    // N-3: a placeholder (blank or <...>) counts as not set at every level.
    const modelId = resolveModelId(fromTask?.model, env, config);
    const maxOutputTokens = fromTask?.maxOutputTokens ?? config?.maxOutputTokens ?? null;
    const missing: string[] = [];
    if (modelId === null) missing.push(missingModelText(modelPlaceholderSeen(fromTask?.model, env, config)));
    if (maxOutputTokens === null) missing.push("maxOutputTokens (task model.maxOutputTokens or config maxOutputTokens)");
    const baseUrl = envValue(env, CODARYN_API_BASE_URL_ENV);
    const baseUrlProblem = baseUrl === null ? null : normalizeApiBaseUrlStrict(baseUrl, CODARYN_API_BASE_URL_ENV);
    const placeholder = modelPlaceholderSeen(fromTask?.model, env, config);
    const missingText: DoctorText =
      modelId === null ? { id: placeholder ? "doctor.model.placeholder" : "doctor.model.missing" } : { id: "doctor.model.output_cap_missing" };
    if (missing.length > 0) set("model", "fail", `not set: ${missing.join("; ")}; ${MODELS_HINT}`, missingText);
    else if (baseUrlProblem !== null && !baseUrlProblem.ok) set("model", "fail", baseUrlProblem.message, { id: "doctor.model.base_url_invalid" });
    else set("model", "ok", `the model and maxOutputTokens are set; ${MODEL_EXISTENCE_NOT_CHECKED}`, { id: "doctor.model.ok" });
  }

  // limits
  if (taskUnusable) {
    set("limits", "skipped", "the task file could not be used", { id: "doctor.task_unusable" });
  } else if (task !== null) {
    set("limits", "ok", "every limit is set", { id: "doctor.limits.ok" });
  } else {
    const quick = buildQuickTask({ workspace: args.workspace ?? ".", goal: "doctor", cwd: io.cwd, config });
    if (quick.ok) set("limits", "ok", "every limit is set for the quick form", { id: "doctor.limits.ok_quick" });
    else {
      const field = fieldOf(quick.position);
      set("limits", "fail", quick.message, field === null ? { id: "doctor.limits.invalid_unlocated" } : { id: "doctor.limits.invalid", params: { field } });
    }
  }

  // workspace
  const workspaceRoot = task?.workspaceRoot ?? (args.workspace === null ? null : path.resolve(io.cwd, args.workspace));
  let workspaceReady = false;
  if (workspaceRoot === null) {
    set("workspace", "skipped", "no --workspace or --task given", { id: "doctor.workspace.skipped" });
  } else if (await io.isDirectory(workspaceRoot)) {
    workspaceReady = true;
    set("workspace", "ok", "the workspace is an existing directory", { id: "doctor.workspace.ok" });
  } else {
    set("workspace", "fail", "the workspace is not an existing directory", { id: "doctor.workspace.missing" });
  }

  // file_locations (S-1)
  if (!workspaceReady || workspaceRoot === null) {
    set("file_locations", "skipped", "no usable workspace", { id: "doctor.no_workspace" });
  } else {
    const files: [string | null, string][] = [
      [varsPath, "the file given by --vars-file"],
      [configPath, "the config file"],
      [taskPath, "the task file"],
      [task !== null && task.model.provider === "scripted" ? task.model.scriptPath : null, "the script file"],
    ];
    const inside: string[] = [];
    let checked = 0;
    for (const [file, label] of files) {
      if (file === null) continue;
      checked += 1;
      if ((await io.locateInWorkspace(file, workspaceRoot)) !== "outside") inside.push(label);
    }
    if (checked === 0) set("file_locations", "skipped", "no input file given", { id: "doctor.file_locations.no_input" });
    else if (inside.length > 0) {
      set("file_locations", "fail", `inside the workspace or not confirmable: ${inside.join(", ")}; a run refuses them`, {
        id: "doctor.file_locations.inside",
        params: { count: inside.length },
      });
    } else set("file_locations", "ok", `${checked} input file(s) are outside the workspace`, { id: "doctor.file_locations.ok", params: { count: checked } });
  }

  // commands
  const policy = task?.policy ?? (args.taskPath === null ? config?.policy : undefined);
  const verifiers = task?.verifiers ?? (args.taskPath === null ? config?.verifiers : undefined) ?? [];
  const commandEntries: CommandEntry[] = [];
  (policy?.commands ?? []).forEach((rule, index) =>
    commandEntries.push({ position: `policy.commands[${index}]`, executable: rule.executable, args: rule.argsPrefix, cwd: null }),
  );
  verifiers.forEach((verifier, index) => {
    if (verifier.kind === "command") {
      commandEntries.push({ position: `verifiers[${index}]`, executable: verifier.executable, args: verifier.args, cwd: verifier.cwd ?? "." });
    }
  });
  if (taskUnusable) {
    set("commands", "skipped", "the task file could not be used", { id: "doctor.task_unusable" });
  } else if (commandEntries.length === 0) {
    set("commands", "skipped", "no command is allowed and no command verifier is configured", { id: "doctor.commands.none" });
  } else {
    const checked = await checkCommands(io, commandEntries, env, workspaceReady ? workspaceRoot : null, platform);
    // G-F (general-tasks.md 7.1, PM answer Q5): rules that take any further arguments beside plan
    // actions. Codaryn does not check a command's arguments, so such a command can change files
    // outside an approved plan. Problems found above keep their text; the warning joins the message.
    const extraArgs = (policy?.commands ?? []).filter((rule) => rule.allowExtraArgs).length;
    if (extraArgs > 0 && (policy?.planActions ?? []).length > 0) {
      const warning =
        `${extraArgs} command rule(s) take any further arguments (allowExtraArgs) while plans may move or discard files ` +
        "(policy.planActions); Codaryn does not check those arguments, so such a command can change files outside an approved plan";
      if (checked.status === "ok") {
        set("commands", "warn", warning, { id: "doctor.commands.extra_args_with_plan", params: { count: extraArgs } });
      } else {
        set("commands", checked.status, `${checked.message}; ${warning}`, checked.text);
      }
    } else {
      set("commands", checked.status, checked.message, checked.text);
    }
  }

  // install_dir (U-3)
  if (!workspaceReady || workspaceRoot === null) {
    set("install_dir", "skipped", "no usable workspace", { id: "doctor.no_workspace" });
  } else if (io.installDir === undefined) {
    set("install_dir", "skipped", "the install directory is not known in this environment", { id: "doctor.install_dir.unknown_env" });
  } else if (io.installDir === null) {
    set("install_dir", "fail", "the CLI's install directory cannot be determined; a run refuses to start", { id: "doctor.install_dir.not_found" });
  } else {
    const relation = await io.relatePaths(workspaceRoot, io.installDir);
    if (relation === "separate") set("install_dir", "ok", "the workspace is outside the CLI's install directory", { id: "doctor.install_dir.ok" });
    else {
      set("install_dir", "fail", "the workspace is the CLI's install directory, lies inside it, contains it, or cannot be compared", {
        id: "doctor.install_dir.overlap",
      });
    }
  }

  // integrity_paths (U-1)
  const integrityPaths = config?.integrity?.paths ?? [];
  if (integrityPaths.length === 0) {
    set("integrity_paths", "skipped", "integrity.paths is not set", { id: "doctor.integrity_paths.skipped" });
  } else {
    const problems: string[] = [];
    for (const [index, entry] of integrityPaths.entries()) {
      const relation = workspaceReady && workspaceRoot !== null ? await io.relatePaths(entry, workspaceRoot) : await io.relatePaths(entry, entry);
      if (relation === "unknown") problems.push(`integrity.paths[${index}] does not exist`);
      else if (workspaceReady && relation !== "separate") problems.push(`integrity.paths[${index}] is not outside the workspace`);
    }
    const missingCount = problems.filter((problem) => problem.endsWith("does not exist")).length;
    const integrityCount = { count: integrityPaths.length };
    if (problems.length > 0) {
      set("integrity_paths", "fail", problems.join("; "), {
        id: "doctor.integrity_paths.problems",
        params: { missing: missingCount, inside: problems.length - missingCount },
      });
    } else if (workspaceReady) {
      set("integrity_paths", "ok", `${integrityPaths.length} path(s) exist outside the workspace`, { id: "doctor.integrity_paths.ok", params: integrityCount });
    } else {
      set("integrity_paths", "ok", `${integrityPaths.length} path(s) exist; give --workspace or --task to check their position`, {
        id: "doctor.integrity_paths.ok",
        params: integrityCount,
      });
    }
  }

  // language (N-20): which language the human output uses and where that came from.
  if (io.explainLanguage === undefined) {
    set("language", "skipped", "the language selection is not connected in this build", { id: "doctor.language.unchecked" });
  } else {
    const choice = io.explainLanguage({ env: env[CODARYN_LANG_ENV] ?? null, config: config?.language ?? null, osLocale: io.osLocale ?? null });
    if (choice.envIgnored) {
      set("language", "warn", `${CODARYN_LANG_ENV} is not ko or en and is ignored; messages use ${choice.language}`, {
        id: "doctor.language.env_ignored",
        params: { language: choice.language },
      });
    } else {
      set("language", "ok", `messages use ${choice.language} (from ${choice.source})`, {
        id: `doctor.language.from_${choice.source}`,
        params: { language: choice.language },
      });
    }
  }

  // lock (N-25 a): read only. A lock held by a live process may be a run in progress.
  if (!workspaceReady || workspaceRoot === null) {
    set("lock", "skipped", "no usable workspace", { id: "doctor.no_workspace" });
  } else {
    const state = await (io.inspectLock ?? ((root: string) => inspectLockFile(root, io.readFile)))(workspaceRoot);
    const lockMessages: { readonly [S in LockState]: readonly [DoctorCheckStatus, string] } = {
      none: ["ok", "no run holds the workspace lock"],
      held: ["warn", `a process holds ${STATE_DIR_NAME}/${LOCK_FILE_NAME}; if no Codaryn is running in this workspace, remove that file`],
      stale: ["ok", "the lock was left by a process that has ended; the next run reclaims it"],
      unreadable: ["warn", `${STATE_DIR_NAME}/${LOCK_FILE_NAME} cannot be read; if no Codaryn is running in this workspace, remove that file`],
      reclaim_left: [
        "warn",
        `${STATE_DIR_NAME}/${LOCK_FILE_NAME}.reclaim was left by an attempt to reclaim the lock; while it stays, a lock left by an ended process is not reclaimed. If no Codaryn is running in this workspace, remove ${STATE_DIR_NAME}/${LOCK_FILE_NAME}.reclaim (and ${STATE_DIR_NAME}/${LOCK_FILE_NAME} if it is there)`,
      ],
    };
    const [status, message] = lockMessages[state];
    set("lock", status, message, { id: `doctor.lock.${state}` });
  }

  const checks = DOCTOR_CHECK_IDS.map((id) => results.get(id) as DoctorCheck);
  const status = worst(checks);
  const output: DoctorOutput = { schemaVersion: 1, kind: "doctor", status, exitCode: DOCTOR_EXIT_CODES[status], checks };
  const text = args.json ? jsonLine(output) : renderDoctor(output, io.messages);
  return { text: hideKeys(text, currentKey), exitCode: output.exitCode };
}
