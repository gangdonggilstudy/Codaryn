/**
 * `codaryn run`: reads the settings and the task, prepares the model, then hands over to the
 * assembled engine. Every outcome becomes one CliOutput object and its exit code.
 * Messages never contain secret values, keys or file contents.
 *
 * Order (security checks S-1 to S-9 from `./security`):
 *  1. arguments; every path given on the command line must be a local path (S-5)
 *  2. `--vars-file` (T-15): read, reject a BOM, load; values it newly set become secrets (S-4)
 *  3. current key; CODARYN_CONFIG must be a local path (S-5); `--goal` must not hold a key (S-8)
 *  4. config and task files: read, key check on the raw text, parse, key check on the parsed
 *     value with a depth limit (S-6). A key stops the run before anything else is checked
 *  5. validate the config (S-3, S-7, S-9), then the task (S-3, S-5, S-7)
 *  6. the workspace exists and is apart from the CLI's install directory (U-3); the env, config,
 *     task, script and cancel files are outside it (S-1); `integrity.paths` exist outside it (U-1)
 *  7. secret values: secretEnv (S-3 messages), the key in every run (S-2), env file values (S-4)
 *  8. model, then the assembled engine
 */

import path from "node:path";
import {
  ANTHROPIC_API_KEY_ENV,
  CLI_ERROR_EXIT_CODES,
  CODARYN_CONFIG_ENV,
  RESULT_SCHEMA_VERSION,
} from "../contracts/index.js";
import type {
  AnthropicProviderDeps,
  CliErrorCode,
  CliErrorOutput,
  CliOutput,
  Clock,
  CodarynConfig,
  CreateAnthropicProvider,
  EngineResult,
  ModelProvider,
  RunTask,
} from "../contracts/index.js";
import { runTask as engineRunTask } from "../engine/index.js";
import { createScriptedProvider, parseScript } from "../model/index.js";
import { parseArgs } from "./args.js";
import type { Assemble } from "./assemble.js";
import { parseConfig } from "./config.js";
import { anthropicProviderFactory } from "./provider.js";
import { createRunId } from "./run-id.js";
import { withProgress } from "./progress.js";
import {
  MAX_KEY_SCAN_DEPTH,
  findKeyInJson,
  goalHoldsKey,
  rawTextHoldsKey,
  relateRealPaths,
  secretEnvNotSetMessage,
  selectEnvFileSecrets,
} from "./security/index.js";
import type { PathRelation, WorkspaceLocation } from "./security/index.js";
import { envValue, resolveAnthropicSettings } from "./settings.js";
import type { SettingsEnvironment } from "./settings.js";
import { buildQuickTask, localPathProblem, parseTask, withConfigSecrets } from "./task.js";

export interface CliEnvironment {
  readonly argv: readonly string[];
  /** Read after `loadEnvFile`, so it must reflect what that call loaded. */
  readonly env: SettingsEnvironment;
  readonly cwd: string;
  /** Reads a UTF-8 file. Rejects when it cannot be read. */
  readonly readFile: (path: string) => Promise<string>;
  readonly isDirectory: (path: string) => Promise<boolean>;
  /**
   * Loads the variables file given by `--vars-file` into `env` (process.loadEnvFile in the real CLI).
   * Variables already set keep their values. Throws when the file cannot be read.
   */
  readonly loadEnvFile: (path: string) => void;
  /**
   * S-1: where a file really is relative to the workspace root, after links (the security
   * module's `locateInWorkspace` in the real CLI). Anything but "outside" is rejected.
   */
  readonly locateInWorkspace: (file: string, workspaceRoot: string) => Promise<WorkspaceLocation>;
  readonly clock: Clock;
  readonly randomBytes: (size: number) => Uint8Array;
  readonly assemble: Assemble;
  readonly runTask?: RunTask;
  /** Overrides `anthropicProviderFactory` in tests. `null` stands for a provider that is not connected. */
  readonly createAnthropicProvider?: CreateAnthropicProvider | null;
  /** Passed to the anthropic provider. Tests inject `fetch` here; the real CLI leaves it unset. */
  readonly anthropicDeps?: AnthropicProviderDeps;
  /** Cancellation for the run. Created from the parsed arguments. */
  readonly cancelSignal: (cancelFile: string | null) => { signal: AbortSignal; dispose(): void };
  /**
   * U-3: the running CLI's package root (`findInstall` in the real CLI, which always sets it).
   * Undefined: not checked (in-process tests). Null: it could not be found, so every run is refused.
   */
  readonly installDir?: string | null;
  /** U-1, U-3: real path relation (`relateRealPaths` when absent). */
  readonly relatePaths?: (target: string, base: string) => Promise<PathRelation>;
  /** U-8: writes one progress line (with its line feed) to stderr. Absent or `--quiet`: no progress. */
  readonly writeProgress?: (line: string) => void;
}

export interface CliRunOutcome {
  readonly output: CliOutput;
  readonly exitCode: number;
}

function error(code: CliErrorCode, message: string): { output: CliErrorOutput; exitCode: number } {
  const exitCode = CLI_ERROR_EXIT_CODES[code];
  return { output: { schemaVersion: RESULT_SCHEMA_VERSION, kind: "error", code, exitCode, message }, exitCode };
}

/** One CliErrorOutput and its exit code. The message must not contain secrets or file contents. */
export const cliError = error;

/** Task, config and script files may start with a UTF-8 byte order mark (common on Windows). */
async function readText(io: CliEnvironment, file: string): Promise<string | null> {
  try {
    return (await io.readFile(file)).replace(/^﻿/, "");
  } catch {
    return null;
  }
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Removes secret values from a message before it is printed. */
function scrub(message: string, secrets: readonly string[]): string {
  return secrets.reduce((text, secret) => text.split(secret).join("[secret]"), message);
}

const KEY_HINT = `keys are read only from the ${ANTHROPIC_API_KEY_ENV} environment variable`;

/** A file read before the run, with where it came from and the error code that belongs to it. */
interface InputFile {
  readonly label: string;
  readonly path: string;
  readonly code: "invalid_config" | "invalid_task";
  readonly text: string;
  value?: unknown;
}

export async function runCli(io: CliEnvironment): Promise<CliRunOutcome> {
  const parsed = parseArgs(io.argv);
  if (!parsed.ok) return error("invalid_arguments", parsed.message);
  const args = parsed.args;

  // 1. S-5: nothing given on the command line may reach another machine or a device.
  const argumentPaths: [string | null, CliErrorCode, string][] = [
    [args.input.kind === "task" ? args.input.taskPath : null, "invalid_task", "--task"],
    [args.input.kind === "quick" ? args.input.workspace : null, "invalid_arguments", "--workspace"],
    [args.configPath, "invalid_config", "--config"],
    [args.varsFile, "invalid_config", "--vars-file"],
    [args.cancelFile, "invalid_arguments", "--cancel-file"],
  ];
  for (const [given, code, option] of argumentPaths) {
    if (given === null) continue;
    const problem = localPathProblem(given, io.cwd);
    if (problem !== null) return error(code, `the path given by ${option} ${problem}`);
  }

  // 2. The env file. S-4: values it newly sets are registered as secrets later.
  let envPath: string | null = null;
  let envSecrets: readonly string[] = [];
  if (args.varsFile !== null) {
    envPath = path.resolve(io.cwd, args.varsFile);
    let envText: string;
    try {
      envText = await io.readFile(envPath);
    } catch {
      return error("invalid_config", "the file given by --vars-file cannot be read");
    }
    // process.loadEnvFile would read a BOM as part of the first name and silently skip that variable.
    if (envText.startsWith("﻿")) {
      return error("invalid_config", "the file given by --vars-file starts with a byte order mark; save it as UTF-8 without BOM");
    }
    const before = { ...io.env };
    try {
      io.loadEnvFile(envPath);
    } catch {
      return error("invalid_config", "the file given by --vars-file cannot be read");
    }
    envSecrets = selectEnvFileSecrets(before, { ...io.env });
  }

  // 3. The current key, the config path from the environment, and the goal (S-5, S-8).
  const currentKey = envValue(io.env, ANTHROPIC_API_KEY_ENV);
  const configFromEnv = args.configPath === null ? envValue(io.env, CODARYN_CONFIG_ENV) : null;
  if (configFromEnv !== null) {
    const problem = localPathProblem(configFromEnv, io.cwd);
    if (problem !== null) return error("invalid_config", `the path given by ${CODARYN_CONFIG_ENV} ${problem}`);
  }
  if (args.input.kind === "quick" && goalHoldsKey(args.input.goal, currentKey)) {
    return error("key_in_file", `the goal contains a key value; ${KEY_HINT}`);
  }

  // 4. Read both files, then look for a key in each before anything else is judged (C-1, S-6).
  const files: InputFile[] = [];
  const configSource = args.configPath ?? configFromEnv;
  if (configSource !== null) {
    const configPath = path.resolve(io.cwd, configSource);
    const text = await readText(io, configPath);
    if (text === null) return error("invalid_config", "the config file cannot be read as JSON");
    files.push({ label: "config file", path: configPath, code: "invalid_config", text });
  }
  if (args.input.kind === "task") {
    const taskPath = path.resolve(io.cwd, args.input.taskPath);
    const text = await readText(io, taskPath);
    if (text === null) return error("invalid_task", "the task file cannot be read as JSON");
    files.push({ label: "task file", path: taskPath, code: "invalid_task", text });
  }
  for (const file of files) {
    if (rawTextHoldsKey(file.text, currentKey)) return error("key_in_file", `the ${file.label} contains a key value; ${KEY_HINT}`);
  }
  for (const file of files) {
    const json = parseJson(file.text);
    if (!json.ok) return error(file.code, `the ${file.label} cannot be read as JSON`);
    file.value = json.value;
  }
  for (const file of files) {
    const found = findKeyInJson(file.value, currentKey);
    if (found.kind === "key") {
      return error("key_in_file", `the ${file.label} has a key field or key value at ${found.location}; ${KEY_HINT}`);
    }
    if (found.kind === "too_deep") {
      return error(file.code, `the ${file.label} is nested more than ${MAX_KEY_SCAN_DEPTH} levels deep`);
    }
  }
  const configFile = files.find((file) => file.code === "invalid_config") ?? null;
  const taskFile = files.find((file) => file.code === "invalid_task") ?? null;

  // 5. Validate the config, then the task.
  let config: CodarynConfig | null = null;
  if (configFile !== null) {
    const outcome = parseConfig(configFile.value);
    if (!outcome.ok) return error("invalid_config", outcome.message);
    config = outcome.config;
  }

  const taskOutcome =
    taskFile !== null
      ? parseTask(taskFile.value, path.dirname(taskFile.path), { limits: config?.limits })
      : args.input.kind === "quick"
        ? buildQuickTask({ workspace: args.input.workspace, goal: args.input.goal, cwd: io.cwd, config })
        : null;
  if (taskOutcome === null) return error("internal_error", "no task input");
  if (!taskOutcome.ok) return error(taskOutcome.code, taskOutcome.message);

  // Where each secret name came from, for S-3 messages that give a position, never a name.
  const secretSources: { readonly name: string; readonly field: string; readonly index: number }[] = [];
  const ownField = taskFile !== null ? "privacy.secretEnv" : "secretEnv";
  taskOutcome.task.privacy.secretEnv.forEach((name, index) => secretSources.push({ name, field: ownField, index }));
  if (taskFile !== null) {
    (config?.secretEnv ?? []).forEach((name, index) => {
      if (!secretSources.some((source) => source.name === name)) secretSources.push({ name, field: "secretEnv", index });
    });
  }
  const task = withConfigSecrets(taskOutcome.task, config);

  // 6. The workspace, and S-1: no file that shapes this or a later run may lie inside it.
  if (!(await io.isDirectory(task.workspaceRoot))) {
    return error("workspace_not_found", "workspaceRoot is not an existing directory");
  }
  const relate = io.relatePaths ?? ((target: string, base: string) => relateRealPaths(target, base));
  // U-3: the running CLI must not work on its own installation, by real paths.
  if (io.installDir !== undefined) {
    const relation = io.installDir === null ? "unknown" : await relate(task.workspaceRoot, io.installDir);
    if (relation !== "separate") {
      return error(
        "workspace_is_install_dir",
        relation === "unknown"
          ? "cannot confirm that the workspace is outside the CLI's install directory; nothing was run"
          : "the workspace is the CLI's install directory, lies inside it or contains it; use a separate candidate directory",
      );
    }
  }
  const located: [string | null, CliErrorCode, string][] = [
    [envPath, "invalid_config", "the file given by --vars-file"],
    [configFile?.path ?? null, "invalid_config", "the config file"],
    [taskFile?.path ?? null, "invalid_task", "the task file"],
    [task.model.provider === "scripted" ? task.model.scriptPath : null, "invalid_script", "the script file"],
    // T-12: a cancel file inside the workspace could be created by the run itself.
    [args.cancelFile === null ? null : path.resolve(io.cwd, args.cancelFile), "invalid_arguments", "the file given by --cancel-file"],
  ];
  for (const [file, code, label] of located) {
    if (file === null) continue;
    const where = await io.locateInWorkspace(file, task.workspaceRoot);
    if (where !== "outside") {
      return error(code, `${label} is inside the workspace or its location cannot be confirmed; keep it outside so a run cannot change it`);
    }
  }
  // U-1: protected material outside the workspace must exist and stay apart from it.
  const integrityPaths = config?.integrity?.paths ?? [];
  for (const [index, entry] of integrityPaths.entries()) {
    const relation = await relate(entry, task.workspaceRoot);
    if (relation === "unknown") return error("invalid_config", `integrity.paths[${index}] does not exist or cannot be resolved`);
    if (relation !== "separate") {
      return error("invalid_config", `integrity.paths[${index}] must be outside the workspace and must not contain it`);
    }
  }

  // 7. Secret values.
  const secrets: string[] = [];
  const addSecret = (value: string): void => {
    if (value.length > 0 && !secrets.includes(value)) secrets.push(value);
  };
  for (const source of secretSources) {
    const value = io.env[source.name];
    if (value === undefined || value.length === 0) {
      return error("secret_env_missing", secretEnvNotSetMessage(source.field, source.index));
    }
    addSecret(value);
  }
  // S-2: the key is masked in every run, whatever the provider. A scripted task can still read
  // a workspace file that holds it.
  if (currentKey !== null) addSecret(currentKey);
  // S-4: what the env file set, so a value read back from a file or an output is masked too.
  envSecrets.forEach(addSecret);

  // 8. The model.
  let model: ModelProvider;
  if (task.model.provider === "anthropic") {
    const resolved = resolveAnthropicSettings(task.model, io.env, config);
    if (!resolved.ok) return error(resolved.code, resolved.message);
    // Already registered above (S-2); kept so the key sent is always a registered secret.
    addSecret(resolved.settings.apiKey);
    const factory = io.createAnthropicProvider === undefined ? anthropicProviderFactory : io.createAnthropicProvider;
    if (factory === null) {
      return error("provider_not_implemented", "the anthropic provider is not connected; nothing was sent");
    }
    try {
      model = factory(resolved.settings, io.anthropicDeps);
    } catch {
      // The provider re-checks the settings and throws only if they disagree with the CLI's checks.
      return error("internal_error", "the anthropic provider rejected the resolved settings; nothing was sent");
    }
  } else {
    const scriptText = await readText(io, task.model.scriptPath);
    const scriptJson = scriptText === null ? null : parseJson(scriptText);
    if (scriptJson === null || !scriptJson.ok) return error("invalid_script", "the script file cannot be read as JSON");
    const script = parseScript(scriptJson.value);
    if (!script.ok) return error("invalid_script", script.message);
    model = createScriptedProvider(script.script);
  }

  const runId = createRunId(new Date(io.clock.now()), io.randomBytes);
  const cancel = io.cancelSignal(args.cancelFile === null ? null : path.resolve(io.cwd, args.cancelFile));
  try {
    const assembled = await io.assemble({ task, runId, model, secrets, clock: io.clock, signal: cancel.signal, integrityPaths });
    if (!assembled.ok) return error(assembled.code, scrub(assembled.message, secrets));
    // U-8: progress lines follow the journal; they start only once the run has started.
    const write = args.quiet ? undefined : io.writeProgress;
    const deps =
      write === undefined
        ? assembled.deps
        : { ...assembled.deps, journal: withProgress(assembled.deps.journal, assembled.deps.privacy, write) };
    let result: EngineResult | null = null;
    try {
      result = await (io.runTask ?? engineRunTask)(deps);
    } finally {
      // Releases the workspace lock even when the run threw.
      await assembled.finish(result);
    }
    return { output: result, exitCode: result.exitCode };
  } catch {
    return error("internal_error", "the run stopped because of an internal error");
  } finally {
    cancel.dispose();
  }
}
