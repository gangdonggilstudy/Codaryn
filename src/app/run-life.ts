/**
 * U-293 (the CLI migration's C-6a, the third of its five commits; docs/reviews/2026-11-13-cli-migration-plan.md
 * 6.1 to 6.4): a run's life from step 8 on, the app layer's own: the model (SP-4, SP-6, a scripted
 * model's file), the HTTP 404 watch (Y-4), the run id and the cancel source, the assembly with the
 * workspace lock, the end summary's counts (tally.ts), the engine, the notices (Y-4, N-1), and the end
 * (result.json, the lock released or told as left, U-220). In the order of the CLI's runPrepared
 * (src/cli/run.ts), with its codes and messages, copied from it; without what only a terminal shows
 * (progress lines, the default location's line, the writablePaths line, the end summary, the
 * permission question's words, the typed workspace): an adapter draws those from
 * RunObserver.onStoredRecord, the handle (AppRunHandle) and the outcome (tally, modelNotFound). The
 * CLI keeps its own copy until it runs through the app layer (C-6a's fourth commit); a run that carries
 * out an approved run plan (applyPlan, U-218) still takes the CLI's until C-6b.
 */

import path from "node:path";
import { toSchemaFieldPath } from "../contracts/index.js";
import type { CliErrorOutput, EngineResult, InputDiagnostic, InputDiagnosticFile, ModelProvider, PrivacyGateway } from "../contracts/index.js";
import type { CliEnvironment } from "../cli/run.js";
import { API_PROVIDER_FACTORIES } from "../cli/provider.js";
import { runTask as engineRunTask } from "../engine/index.js";
import { createScriptedProvider, parseScript } from "../model/index.js";
import { createRunId } from "./input/run-id.js";
import { resolveApiSettings } from "./input/settings.js";
import { cliError as error, jsonSyntaxError, parseJson, readText, scrub, settingsError } from "./prepare.js";
import type { PreparedTask, RunArgs, RunNotes } from "./prepare.js";
import { withoutEmptyStateChanged } from "./result-fields.js";
import { countingJournal } from "./tally.js";

/** What the life reads of the run's environment: the CLI's run environment as the app layer makes it (app.ts). */
export type RunLifeEnvironment = Pick<
  CliEnvironment,
  "env" | "cwd" | "readFile" | "clock" | "randomBytes" | "assemble" | "runTask" | "createAnthropicProvider" | "anthropicDeps" | "providerFactories" | "providerDeps" | "cancelSignal"
>;

/**
 * How a life ended: refused before the engine (the CLI's error output, as runPrepared returns it), or
 * with the engine's result. `modelNotFound`: the Y-4 hint was added (a request was answered with HTTP
 * 404 and the run ended with a model error), where the CLI also writes its progress line.
 */
export type RunLifeEnd =
  | { readonly kind: "refused"; readonly output: CliErrorOutput }
  | { readonly kind: "ended"; readonly result: EngineResult; readonly modelNotFound: boolean };

const refused = (outcome: { readonly output: CliErrorOutput }): RunLifeEnd => ({ kind: "refused", output: outcome.output });

/** N-15: a message that starts with a schema field path (the script parser's messages do). */
function headDiagnostic(file: InputDiagnosticFile, message: string): InputDiagnostic | undefined {
  const field = toSchemaFieldPath(message.split(" ", 1)[0] ?? "");
  return field === null ? undefined : { code: "invalid_value", file, field, line: null, column: null };
}

/**
 * Y-4: added to the result's notices when the run ended with a model error whose request was answered
 * with HTTP 404. The error kind stays the provider's.
 */
export const MODEL_NOT_FOUND_HINT =
  "the API answered HTTP 404, which usually means the model id is unknown: run `codaryn models` to list the models this key can use";

/**
 * Y-4 with SP-3: `model` with every outcome watched; `onNotFound` is called when a request was
 * answered with HTTP 404 (ModelOutcome.httpStatus, not the message's first characters).
 */
function watchingNotFound(model: ModelProvider, onNotFound: () => void): ModelProvider {
  return {
    name: model.name,
    async complete(request, signal) {
      const outcome = await model.complete(request, signal);
      if (!outcome.ok && outcome.httpStatus === 404) onNotFound();
      return outcome;
    },
  };
}

/** Y-4: the result with the hint's notice, masked; the result itself when the hint cannot be masked. */
function withModelHint(result: EngineResult, privacy: PrivacyGateway): EngineResult {
  const masked = privacy.mask(MODEL_NOT_FOUND_HINT);
  if (!masked.ok) return result;
  return { ...result, notices: [...result.notices, masked.text] };
}

/** Adds one masked notice to the result (and so to result.json). */
function withNotice(result: EngineResult, privacy: PrivacyGateway, text: string): EngineResult {
  const masked = privacy.mask(text);
  return masked.ok ? { ...result, notices: [...result.notices, masked.text] } : result;
}

/** N-1: in the result's notices when the default location was used. */
export function defaultConfigNotice(display: string): string {
  return `settings were read from the default config file location ${display}`;
}

/** Steps 8 on for a prepared task, an ordinary run's (not one that carries out an approved plan). */
export async function runLife(io: RunLifeEnvironment, args: RunArgs, notes: RunNotes, prepared: PreparedTask): Promise<RunLifeEnd> {
  const { task, config, integrityPaths, defaultDisplay } = prepared;
  const secrets = [...prepared.secrets];
  const addSecret = (value: string): void => {
    if (value.length > 0 && !secrets.includes(value)) secrets.push(value);
  };

  // 8. The model.
  let model: ModelProvider;
  if (task.model.provider !== "scripted") {
    // SP-4, DR-34 (c): every API provider's settings are resolved first, its address variable
    // checked with its own rule, before any provider is made.
    const resolved = resolveApiSettings(task.model, io.env, config);
    if (!resolved.ok) return refused(settingsError(resolved));
    // Already registered above (S-2); kept so the key sent is always a registered secret.
    addSecret(resolved.settings.apiKey);
    // SP-6: the factory of the task's provider (API_PROVIDER_FACTORIES), given only its own settings.
    const provider = task.model.provider;
    const override = provider === "anthropic" && io.createAnthropicProvider !== undefined ? io.createAnthropicProvider : io.providerFactories?.[provider];
    const factory = override === undefined ? API_PROVIDER_FACTORIES[provider] : override;
    if (factory === null) {
      return refused(error("provider_not_implemented", `the ${provider} provider is not connected; nothing was sent`));
    }
    try {
      model = factory(resolved.settings, io.providerDeps?.[provider] ?? (provider === "anthropic" ? io.anthropicDeps : undefined));
    } catch {
      // The provider re-checks the settings and throws only if they disagree with the CLI's checks.
      return refused(error("internal_error", `the ${provider} provider rejected the resolved settings; nothing was sent`));
    }
  } else {
    const scriptText = await readText(io, task.model.scriptPath);
    if (scriptText === null) return refused(error("invalid_script", "the script file cannot be read as JSON"));
    const scriptJson = parseJson(scriptText);
    if (!scriptJson.ok) {
      const syntax = jsonSyntaxError("script file", "script", scriptText);
      return refused(error("invalid_script", syntax.message, syntax.diagnostic));
    }
    const script = parseScript(scriptJson.value);
    if (!script.ok) return refused(error("invalid_script", script.message, headDiagnostic("script", script.message)));
    model = createScriptedProvider(script.script);
  }

  // Y-4: a model request answered with HTTP 404 (usually an unknown model id).
  let modelNotFound = false;
  const watchedModel = watchingNotFound(model, () => {
    modelNotFound = true;
  });
  const runId = createRunId(new Date(io.clock.now()), io.randomBytes);
  const cancel = io.cancelSignal(args.cancelFile === null ? null : path.resolve(io.cwd, args.cancelFile));
  try {
    const assembled = await io.assemble({
      task,
      runId,
      model: watchedModel,
      secrets,
      clock: io.clock,
      signal: cancel.signal,
      integrityPaths,
    });
    if (!assembled.ok) return refused(error(assembled.code, scrub(assembled.message, secrets)));
    // The end summary's counts, as the records are written (tally.ts); an ordinary run carries out no plan.
    const journal = countingJournal(assembled.deps.journal, notes, undefined);
    const privacy = assembled.deps.privacy;
    const deps = { ...assembled.deps, journal };
    let result: EngineResult | null = null;
    let hinted = false;
    try {
      // DR-38 (PM after bf04750): an empty stateChanged is left out, in the output and in result.json.
      const ended = withoutEmptyStateChanged(await (io.runTask ?? engineRunTask)(deps));
      const withHint = modelNotFound && ended.reason === "model_error" ? withModelHint(ended, privacy) : ended;
      hinted = withHint !== ended;
      result = defaultDisplay === null ? withHint : withNotice(withHint, privacy, defaultConfigNotice(defaultDisplay));
    } finally {
      // Releases the workspace lock even when the run threw. U-220: a lock it could not release is
      // told (RunOutcome.lockLeft, lock.release_failed); the run's result and exit code stay.
      const finished: unknown = await assembled.finish(result);
      if (typeof finished === "object" && finished !== null && (finished as { readonly lockLeft?: unknown }).lockLeft === true) notes.lockLeft = true;
    }
    return { kind: "ended", result, modelNotFound: hinted };
  } catch {
    return refused(error("internal_error", "the run stopped because of an internal error"));
  } finally {
    cancel.dispose();
  }
}
