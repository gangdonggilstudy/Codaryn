/**
 * `codaryn run`: validates input, prepares the model, then hands over to the assembled engine.
 * Every outcome becomes one CliOutput object and its exit code.
 * Messages never contain secret values, keys or file contents.
 */

import path from "node:path";
import { CLI_ERROR_EXIT_CODES, RESULT_SCHEMA_VERSION } from "../contracts/index.js";
import type { CliErrorCode, CliOutput, Clock, EngineResult, ModelProvider, RunTask } from "../contracts/index.js";
import { runTask as engineRunTask } from "../engine/index.js";
import { anthropicAvailability, createScriptedProvider, parseScript } from "../model/index.js";
import type { ProviderEnvironment } from "../model/index.js";
import { parseArgs } from "./args.js";
import type { Assemble } from "./assemble.js";
import { createRunId } from "./run-id.js";
import { parseTask } from "./task.js";

export interface CliEnvironment {
  readonly argv: readonly string[];
  readonly env: ProviderEnvironment;
  readonly cwd: string;
  /** Reads a UTF-8 file. Rejects when it cannot be read. */
  readonly readFile: (path: string) => Promise<string>;
  readonly isDirectory: (path: string) => Promise<boolean>;
  readonly clock: Clock;
  readonly randomBytes: (size: number) => Uint8Array;
  readonly assemble: Assemble;
  readonly runTask?: RunTask;
  /** Cancellation for the run. Created from the parsed arguments. */
  readonly cancelSignal: (cancelFile: string | null) => { signal: AbortSignal; dispose(): void };
}

export interface CliRunOutcome {
  readonly output: CliOutput;
  readonly exitCode: number;
}

function error(code: CliErrorCode, message: string): CliRunOutcome {
  const exitCode = CLI_ERROR_EXIT_CODES[code];
  return { output: { schemaVersion: RESULT_SCHEMA_VERSION, kind: "error", code, exitCode, message }, exitCode };
}

async function readJson(io: CliEnvironment, file: string): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: JSON.parse(await io.readFile(file)) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Removes secret values from a message before it is printed. */
function scrub(message: string, secrets: readonly string[]): string {
  return secrets.reduce((text, secret) => text.split(secret).join("[secret]"), message);
}

export async function runCli(io: CliEnvironment): Promise<CliRunOutcome> {
  const parsed = parseArgs(io.argv);
  if (!parsed.ok) return error("invalid_arguments", parsed.message);
  const taskPath = path.resolve(io.cwd, parsed.args.taskPath);

  const taskJson = await readJson(io, taskPath);
  if (!taskJson.ok) return error("invalid_task", "the task file cannot be read as JSON");
  const taskOutcome = parseTask(taskJson.value, path.dirname(taskPath));
  if (!taskOutcome.ok) return error("invalid_task", taskOutcome.message);
  const task = taskOutcome.task;

  if (!(await io.isDirectory(task.workspaceRoot))) {
    return error("workspace_not_found", "workspaceRoot is not an existing directory");
  }

  const secrets: string[] = [];
  for (const name of task.privacy.secretEnv) {
    const value = io.env[name];
    if (value === undefined || value.length === 0) {
      return error("secret_env_missing", `environment variable ${name} listed in privacy.secretEnv is not set`);
    }
    secrets.push(value);
  }

  // Phase 1a: the anthropic provider stops here without sending anything.
  if (task.model.provider === "anthropic") {
    return anthropicAvailability(io.env) === "not_configured"
      ? error("provider_not_configured", "ANTHROPIC_API_KEY and CODARYN_MODEL must both be set; nothing was sent")
      : error("provider_not_implemented", "the anthropic provider is not implemented in phase 1a; nothing was sent");
  }
  const scriptJson = await readJson(io, task.model.scriptPath);
  if (!scriptJson.ok) return error("invalid_script", "the script file cannot be read as JSON");
  const script = parseScript(scriptJson.value);
  if (!script.ok) return error("invalid_script", script.message);
  const model: ModelProvider = createScriptedProvider(script.script);

  const runId = createRunId(new Date(io.clock.now()), io.randomBytes);
  const cancel = io.cancelSignal(
    parsed.args.cancelFile === null ? null : path.resolve(io.cwd, parsed.args.cancelFile),
  );
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
