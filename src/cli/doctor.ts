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

import path from "node:path";
import { parseEnv } from "node:util";
import {
  ANTHROPIC_API_KEY_ENV,
  CODARYN_API_BASE_URL_ENV,
  CODARYN_CONFIG_ENV,
  CODARYN_MODEL_ENV,
  DOCTOR_CHECK_IDS,
  DOCTOR_EXIT_CODES,
} from "../contracts/index.js";
import type {
  CodarynConfig,
  DoctorCheck,
  DoctorCheckId,
  DoctorCheckStatus,
  DoctorOutput,
  DoctorStatus,
  ResolvedTaskSpec,
} from "../contracts/index.js";
import { parseScript } from "../model/index.js";
import { parseDoctorArgs } from "./args.js";
import { parseConfig } from "./config.js";
import type { CommandOutcome } from "./guard.js";
import { cliError } from "./run.js";
import {
  MAX_KEY_SCAN_DEPTH,
  findKeyInJson,
  normalizeApiBaseUrlStrict,
  rawTextHoldsKey,
} from "./security/index.js";
import type { PathRelation, WorkspaceLocation } from "./security/index.js";
import { envValue } from "./settings.js";
import type { SettingsEnvironment } from "./settings.js";
import { buildQuickTask, localPathProblem, parseTask } from "./task.js";
import { hideKeys } from "./text-safety.js";

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
  readonly locateInWorkspace: (file: string, workspaceRoot: string) => Promise<WorkspaceLocation>;
  readonly relatePaths: (target: string, base: string) => Promise<PathRelation>;
  /** Whether a run checks `integrity.paths` in this build (`INTEGRITY_CONNECTED`). */
  readonly integrityConnected: boolean;
  readonly platform?: NodeJS.Platform;
}

type Loaded = { readonly ok: true; readonly value: unknown; readonly path: string } | { readonly ok: false; readonly message: string };

/** Read, key check on the raw text, parse, key check on the parsed value: the order `run` uses (S-6). */
async function loadJson(io: DoctorEnvironment, file: string, label: string, currentKey: string | null): Promise<Loaded> {
  let text: string;
  try {
    text = await io.readFile(file);
  } catch {
    return { ok: false, message: `the ${label} cannot be read` };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (rawTextHoldsKey(text, currentKey)) return { ok: false, message: `the ${label} contains a key value` };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, message: `the ${label} cannot be read as JSON` };
  }
  const found = findKeyInJson(value, currentKey);
  if (found.kind === "key") return { ok: false, message: `the ${label} has a key field or key value at ${found.location}` };
  if (found.kind === "too_deep") return { ok: false, message: `the ${label} is nested more than ${MAX_KEY_SCAN_DEPTH} levels deep` };
  return { ok: true, value, path: file };
}

/** A variable's value from an environment object; case-insensitive on Windows. */
function variable(env: SettingsEnvironment, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== "win32") return env[name];
  const key = Object.keys(env).find((item) => item.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

/**
 * Whether a command name would be found: a name with a directory part against `baseDir`,
 * otherwise in the absolute PATH entries (relative entries are skipped, as the runner does),
 * with PATHEXT on Windows.
 */
async function findExecutable(
  io: DoctorEnvironment,
  name: string,
  env: SettingsEnvironment,
  baseDir: string,
  platform: NodeJS.Platform,
): Promise<boolean> {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const extensions =
    platform === "win32" && pathApi.extname(name) === ""
      ? (variable(env, "PATHEXT", platform) ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((ext) => ext.length > 0)
      : [""];
  const hasDir = name.includes("/") || (platform === "win32" && name.includes(pathApi.sep));
  const dirs = hasDir
    ? [pathApi.dirname(pathApi.resolve(baseDir, name))]
    : (variable(env, "PATH", platform) ?? "").split(pathApi.delimiter).filter((dir) => dir.length > 0 && pathApi.isAbsolute(dir));
  const base = hasDir ? pathApi.basename(name) : name;
  for (const dir of dirs) {
    for (const ext of extensions) {
      if (await io.isFile(pathApi.join(dir, `${base}${ext}`))) return true;
    }
  }
  return false;
}

function worst(checks: readonly DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "ok";
}

export function renderDoctor(output: DoctorOutput): string {
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
  const set = (id: DoctorCheckId, status: DoctorCheckStatus, message: string): void => {
    results.set(id, { id, status, message });
  };

  // node_version
  const major = Number.parseInt(io.nodeVersion.split(".")[0] ?? "", 10);
  if (Number.isSafeInteger(major) && major >= REQUIRED_NODE_MAJOR) {
    set("node_version", "ok", `Node.js ${major} meets the requirement (${REQUIRED_NODE_MAJOR} or later)`);
  } else {
    set("node_version", "fail", `Node.js ${REQUIRED_NODE_MAJOR} or later is required`);
  }

  // vars_file: parsed, never loaded. Variables already set keep their values, as in `run`.
  let env: SettingsEnvironment = io.env;
  let varsPath: string | null = null;
  if (args.varsFile === null) {
    set("vars_file", "skipped", "no --vars-file given");
  } else {
    varsPath = path.resolve(io.cwd, args.varsFile);
    let text: string | null;
    try {
      text = await io.readFile(varsPath);
    } catch {
      text = null;
    }
    if (text === null) {
      set("vars_file", "fail", "the file given by --vars-file cannot be read");
    } else if (text.charCodeAt(0) === 0xfeff) {
      set("vars_file", "fail", "the file given by --vars-file starts with a byte order mark; save it as UTF-8 without BOM");
    } else {
      let loaded: Record<string, string | undefined>;
      try {
        loaded = parseEnv(text);
      } catch {
        loaded = {};
      }
      env = { ...loaded, ...io.env };
      const count = Object.keys(loaded).length;
      set("vars_file", "ok", `the file given by --vars-file defines ${count} variable(s)`);
    }
  }
  const currentKey = envValue(env, ANTHROPIC_API_KEY_ENV);

  // config_file
  let config: CodarynConfig | null = null;
  let configPath: string | null = null;
  const configFromEnv = args.configPath === null ? envValue(env, CODARYN_CONFIG_ENV) : null;
  const configSource = args.configPath ?? configFromEnv;
  if (configSource === null) {
    set("config_file", "skipped", `no --config given and ${CODARYN_CONFIG_ENV} is not set`);
  } else if (configFromEnv !== null && localPathProblem(configFromEnv, io.cwd) !== null) {
    set("config_file", "fail", `the path given by ${CODARYN_CONFIG_ENV} is not a plain local path`);
  } else {
    const loaded = await loadJson(io, path.resolve(io.cwd, configSource), "config file", currentKey);
    if (!loaded.ok) {
      set("config_file", "fail", loaded.message);
    } else {
      const outcome = parseConfig(loaded.value);
      if (outcome.ok) {
        config = outcome.config;
        configPath = loaded.path;
        set("config_file", "ok", "the config file is valid");
      } else {
        set("config_file", "fail", outcome.message);
      }
    }
  }

  // task_file
  let task: ResolvedTaskSpec | null = null;
  let taskPath: string | null = null;
  if (args.taskPath === null) {
    set("task_file", "skipped", "no --task given");
  } else {
    const loaded = await loadJson(io, path.resolve(io.cwd, args.taskPath), "task file", currentKey);
    if (!loaded.ok) {
      set("task_file", "fail", loaded.message);
    } else {
      const outcome = parseTask(loaded.value, path.dirname(loaded.path), { limits: config?.limits });
      if (outcome.ok) {
        task = outcome.task;
        taskPath = loaded.path;
        set("task_file", "ok", "the task file is valid");
      } else {
        set("task_file", "fail", outcome.message);
      }
    }
  }
  const taskUnusable = args.taskPath !== null && task === null;
  const provider = task?.model.provider ?? "anthropic";

  // api_key: present or not, nothing else.
  if (taskUnusable) {
    set("api_key", "skipped", "the task file could not be used");
  } else if (provider === "scripted") {
    set("api_key", "skipped", "the task uses the scripted model; no key is needed");
  } else if (currentKey !== null) {
    set("api_key", "ok", `${ANTHROPIC_API_KEY_ENV} is set`);
  } else {
    set("api_key", "fail", `${ANTHROPIC_API_KEY_ENV} is not set; an anthropic run stops with provider_not_configured`);
  }

  // model
  if (taskUnusable) {
    set("model", "skipped", "the task file could not be used");
  } else if (task !== null && task.model.provider === "scripted") {
    const scriptPath = task.model.scriptPath;
    const loaded = await loadJson(io, scriptPath, "script file", currentKey);
    const script = loaded.ok ? parseScript(loaded.value) : null;
    if (!loaded.ok) set("model", "fail", loaded.message);
    else if (script !== null && !script.ok) set("model", "fail", script.message);
    else set("model", "ok", "the scripted model file is valid");
  } else {
    const fromTask = task !== null && task.model.provider === "anthropic" ? task.model : null;
    const modelId = fromTask?.model ?? envValue(env, CODARYN_MODEL_ENV) ?? config?.model ?? null;
    const maxOutputTokens = fromTask?.maxOutputTokens ?? config?.maxOutputTokens ?? null;
    const missing: string[] = [];
    if (modelId === null) missing.push(`the model (task model.model, ${CODARYN_MODEL_ENV} or config model)`);
    if (maxOutputTokens === null) missing.push("maxOutputTokens (task model.maxOutputTokens or config maxOutputTokens)");
    const baseUrl = envValue(env, CODARYN_API_BASE_URL_ENV);
    const baseUrlProblem = baseUrl === null ? null : normalizeApiBaseUrlStrict(baseUrl, CODARYN_API_BASE_URL_ENV);
    if (missing.length > 0) set("model", "fail", `not set: ${missing.join("; ")}`);
    else if (baseUrlProblem !== null && !baseUrlProblem.ok) set("model", "fail", baseUrlProblem.message);
    else set("model", "ok", "the model and maxOutputTokens are set");
  }

  // limits
  if (taskUnusable) {
    set("limits", "skipped", "the task file could not be used");
  } else if (task !== null) {
    set("limits", "ok", "every limit is set");
  } else {
    const quick = buildQuickTask({ workspace: args.workspace ?? ".", goal: "doctor", cwd: io.cwd, config });
    if (quick.ok) set("limits", "ok", "every limit is set for the quick form");
    else set("limits", "fail", quick.message);
  }

  // workspace
  const workspaceRoot = task?.workspaceRoot ?? (args.workspace === null ? null : path.resolve(io.cwd, args.workspace));
  let workspaceReady = false;
  if (workspaceRoot === null) {
    set("workspace", "skipped", "no --workspace or --task given");
  } else if (await io.isDirectory(workspaceRoot)) {
    workspaceReady = true;
    set("workspace", "ok", "the workspace is an existing directory");
  } else {
    set("workspace", "fail", "the workspace is not an existing directory");
  }

  // file_locations (S-1)
  if (!workspaceReady || workspaceRoot === null) {
    set("file_locations", "skipped", "no usable workspace");
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
    if (checked === 0) set("file_locations", "skipped", "no input file given");
    else if (inside.length > 0) {
      set("file_locations", "fail", `inside the workspace or not confirmable: ${inside.join(", ")}; a run refuses them`);
    } else set("file_locations", "ok", `${checked} input file(s) are outside the workspace`);
  }

  // commands
  const policy = task?.policy ?? (args.taskPath === null ? config?.policy : undefined);
  const verifiers = task?.verifiers ?? (args.taskPath === null ? config?.verifiers : undefined) ?? [];
  const commandEntries: [string, string, string][] = [];
  (policy?.commands ?? []).forEach((rule, index) => commandEntries.push([`policy.commands[${index}]`, rule.executable, workspaceRoot ?? io.cwd]));
  verifiers.forEach((verifier, index) => {
    if (verifier.kind === "command") {
      const base = workspaceRoot === null ? io.cwd : path.resolve(workspaceRoot, verifier.cwd ?? ".");
      commandEntries.push([`verifiers[${index}]`, verifier.executable, base]);
    }
  });
  if (taskUnusable) {
    set("commands", "skipped", "the task file could not be used");
  } else if (commandEntries.length === 0) {
    set("commands", "skipped", "no command is allowed and no command verifier is configured");
  } else {
    const missing: string[] = [];
    for (const [position, executable, base] of commandEntries) {
      if (!(await findExecutable(io, executable, env, base, platform))) missing.push(position);
    }
    if (missing.length > 0) set("commands", "fail", `not found: ${missing.join(", ")}`);
    else set("commands", "ok", `${commandEntries.length} executable(s) found`);
  }

  // install_dir (U-3)
  if (!workspaceReady || workspaceRoot === null) {
    set("install_dir", "skipped", "no usable workspace");
  } else if (io.installDir === undefined) {
    set("install_dir", "skipped", "the install directory is not known in this environment");
  } else if (io.installDir === null) {
    set("install_dir", "fail", "the CLI's install directory cannot be determined; a run refuses to start");
  } else {
    const relation = await io.relatePaths(workspaceRoot, io.installDir);
    if (relation === "separate") set("install_dir", "ok", "the workspace is outside the CLI's install directory");
    else set("install_dir", "fail", "the workspace is the CLI's install directory, lies inside it, contains it, or cannot be compared");
  }

  // integrity_paths (U-1)
  const integrityPaths = config?.integrity?.paths ?? [];
  if (integrityPaths.length === 0) {
    set("integrity_paths", "skipped", "integrity.paths is not set");
  } else if (!io.integrityConnected) {
    set("integrity_paths", "fail", "integrity.paths is set, but this build does not check it yet; a run stops with invalid_config");
  } else {
    const problems: string[] = [];
    for (const [index, entry] of integrityPaths.entries()) {
      const relation = workspaceReady && workspaceRoot !== null ? await io.relatePaths(entry, workspaceRoot) : await io.relatePaths(entry, entry);
      if (relation === "unknown") problems.push(`integrity.paths[${index}] does not exist`);
      else if (workspaceReady && relation !== "separate") problems.push(`integrity.paths[${index}] is not outside the workspace`);
    }
    if (problems.length > 0) set("integrity_paths", "fail", problems.join("; "));
    else if (workspaceReady) set("integrity_paths", "ok", `${integrityPaths.length} path(s) exist outside the workspace`);
    else set("integrity_paths", "ok", `${integrityPaths.length} path(s) exist; give --workspace or --task to check their position`);
  }

  const checks = DOCTOR_CHECK_IDS.map((id) => results.get(id) as DoctorCheck);
  const status = worst(checks);
  const output: DoctorOutput = { schemaVersion: 1, kind: "doctor", status, exitCode: DOCTOR_EXIT_CODES[status], checks };
  const text = args.json ? `${JSON.stringify(output)}\n` : renderDoctor(output);
  return { text: hideKeys(text, currentKey), exitCode: output.exitCode };
}
