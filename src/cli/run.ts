/**
 * `codaryn run`: reads the settings and the task, prepares the model, then hands over to the
 * assembled engine. Every outcome becomes one CliOutput object and its exit code.
 * Messages never contain secret values, keys or file contents.
 *
 * Order: arguments → `--env-file` → read the config and task files → key check on both
 * (`key_in_file`) → validate the config, then the task → workspace → secret values → model.
 */

import path from "node:path";
import { ANTHROPIC_API_KEY_ENV, CLI_ERROR_EXIT_CODES, CODARYN_CONFIG_ENV, RESULT_SCHEMA_VERSION } from "../contracts/index.js";
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
import { findKeyInFile } from "./keys.js";
import { anthropicProviderFactory } from "./provider.js";
import { createRunId } from "./run-id.js";
import { envValue, resolveAnthropicSettings } from "./settings.js";
import type { SettingsEnvironment } from "./settings.js";
import { buildQuickTask, parseTask, withConfigSecrets } from "./task.js";

export interface CliEnvironment {
  readonly argv: readonly string[];
  /** Read after `loadEnvFile`, so it must reflect what that call loaded. */
  readonly env: SettingsEnvironment;
  readonly cwd: string;
  /** Reads a UTF-8 file. Rejects when it cannot be read. */
  readonly readFile: (path: string) => Promise<string>;
  readonly isDirectory: (path: string) => Promise<boolean>;
  /**
   * Loads an env file given by `--env-file` into `env` (process.loadEnvFile in the real CLI).
   * Variables already set keep their values. Throws when the file cannot be read.
   */
  readonly loadEnvFile: (path: string) => void;
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
async function readJson(io: CliEnvironment, file: string): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: JSON.parse((await io.readFile(file)).replace(/^﻿/, "")) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Removes secret values from a message before it is printed. */
function scrub(message: string, secrets: readonly string[]): string {
  return secrets.reduce((text, secret) => text.split(secret).join("[secret]"), message);
}

const KEY_HINT = `keys are read only from the ${ANTHROPIC_API_KEY_ENV} environment variable`;

export async function runCli(io: CliEnvironment): Promise<CliRunOutcome> {
  const parsed = parseArgs(io.argv);
  if (!parsed.ok) return error("invalid_arguments", parsed.message);
  const args = parsed.args;

  if (args.envFile !== null) {
    const envPath = path.resolve(io.cwd, args.envFile);
    let envText: string;
    try {
      envText = await io.readFile(envPath);
    } catch {
      return error("invalid_config", "the file given by --env-file cannot be read");
    }
    // process.loadEnvFile would read a BOM as part of the first name and silently skip that variable.
    if (envText.startsWith("﻿")) {
      return error("invalid_config", "the file given by --env-file starts with a byte order mark; save it as UTF-8 without BOM");
    }
    try {
      io.loadEnvFile(envPath);
    } catch {
      return error("invalid_config", "the file given by --env-file cannot be read");
    }
  }

  const configSource = args.configPath ?? envValue(io.env, CODARYN_CONFIG_ENV);
  let configJson: { readonly value: unknown } | null = null;
  if (configSource !== null) {
    const read = await readJson(io, path.resolve(io.cwd, configSource));
    if (!read.ok) return error("invalid_config", "the config file cannot be read as JSON");
    configJson = { value: read.value };
  }

  let taskFile: { readonly value: unknown; readonly dir: string } | null = null;
  if (args.input.kind === "task") {
    const taskPath = path.resolve(io.cwd, args.input.taskPath);
    const read = await readJson(io, taskPath);
    if (!read.ok) return error("invalid_task", "the task file cannot be read as JSON");
    taskFile = { value: read.value, dir: path.dirname(taskPath) };
  }

  // C-1: a key in either file stops the run before anything else is checked.
  const currentKey = envValue(io.env, ANTHROPIC_API_KEY_ENV);
  for (const [label, file] of [["config file", configJson], ["task file", taskFile]] as const) {
    if (file === null) continue;
    const where = findKeyInFile(file.value, currentKey);
    if (where !== null) return error("key_in_file", `the ${label} has a key field or key value at ${where}; ${KEY_HINT}`);
  }

  let config: CodarynConfig | null = null;
  if (configJson !== null) {
    const outcome = parseConfig(configJson.value);
    if (!outcome.ok) return error("invalid_config", outcome.message);
    config = outcome.config;
  }

  const taskOutcome =
    taskFile !== null
      ? parseTask(taskFile.value, taskFile.dir, { limits: config?.limits })
      : args.input.kind === "quick"
        ? buildQuickTask({ workspace: args.input.workspace, goal: args.input.goal, cwd: io.cwd, config })
        : null;
  if (taskOutcome === null) return error("internal_error", "no task input");
  if (!taskOutcome.ok) return error(taskFile !== null ? "invalid_task" : "invalid_config", taskOutcome.message);
  const task = withConfigSecrets(taskOutcome.task, config);

  if (!(await io.isDirectory(task.workspaceRoot))) {
    return error("workspace_not_found", "workspaceRoot is not an existing directory");
  }

  const secrets: string[] = [];
  for (const name of task.privacy.secretEnv) {
    const value = io.env[name];
    if (value === undefined || value.length === 0) {
      return error("secret_env_missing", `environment variable ${name} listed in privacy.secretEnv is not set`);
    }
    if (!secrets.includes(value)) secrets.push(value);
  }
  // S-2: the key is masked in every run, whatever the provider. A scripted task can still read
  // a workspace file that holds it.
  if (currentKey !== null && !secrets.includes(currentKey)) secrets.push(currentKey);

  let model: ModelProvider;
  if (task.model.provider === "anthropic") {
    const resolved = resolveAnthropicSettings(task.model, io.env, config);
    if (!resolved.ok) return error(resolved.code, resolved.message);
    // Already registered above (S-2); kept so the key sent is always a registered secret.
    if (!secrets.includes(resolved.settings.apiKey)) secrets.push(resolved.settings.apiKey);
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
    const scriptJson = await readJson(io, task.model.scriptPath);
    if (!scriptJson.ok) return error("invalid_script", "the script file cannot be read as JSON");
    const script = parseScript(scriptJson.value);
    if (!script.ok) return error("invalid_script", script.message);
    model = createScriptedProvider(script.script);
  }

  const runId = createRunId(new Date(io.clock.now()), io.randomBytes);
  const cancel = io.cancelSignal(args.cancelFile === null ? null : path.resolve(io.cwd, args.cancelFile));
  try {
    const assembled = await io.assemble({ task, runId, model, secrets, clock: io.clock, signal: cancel.signal });
    if (!assembled.ok) return error(assembled.code, scrub(assembled.message, secrets));
    let result: EngineResult | null = null;
    try {
      result = await (io.runTask ?? engineRunTask)(assembled.deps);
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
