/**
 * `codaryn run`: reads the settings and the task, prepares the model, then hands over to the
 * assembled engine. Every outcome becomes one CliOutput object and its exit code.
 * Messages never contain secret values, keys or file contents.
 *
 * Order (security checks S-1 to S-9 from `./security`):
 *  1. arguments; every path given on the command line must be a local path (S-5)
 *  2. `--vars-file` (T-15): read, reject a BOM, load; values it newly set become secrets (S-4)
 *  3. current key; the config file: `--config`, CODARYN_CONFIG (a local path, S-5) or the default
 *     location (N-1); `--goal` or the one-line goal (N-9) must not hold a key (S-8)
 *  4. config and task files: read, key check on the raw text, parse, key check on the parsed
 *     value with a depth limit (S-6). A key stops the run before anything else is checked
 *  5. validate the config (S-3, S-7, S-9), apply `--profile` (N-8), then the task (S-3, S-5, S-7)
 *  6. the workspace exists and is apart from the CLI's install directory (U-3); the env, config,
 *     task, script and cancel files are outside it (S-1); `integrity.paths` exist outside it (U-1)
 *  7. secret values: secretEnv (S-3 messages), the key in every run (S-2), env file values (S-4)
 *  8. model, then the assembled engine
 * Steps 1 to 7 are prepareTask's, in src/app/prepare.ts since the CLI migration's C-5 (U-287). Since
 * C-6a (U-296) steps 8 on are the app layer's run life (runLife, src/app/run-life.ts); this file draws
 * what a person sees (runThroughApp). A run that carries out an approved plan (codaryn apply) keeps
 * the life of runPrepared below until C-6b.
 */

import path from "node:path";
import { toSchemaFieldPath, toShownWorkspace } from "../contracts/index.js";
import type {
  AnthropicProviderDeps,
  ApiProviderDeps,
  ApiProviderName,
  ApprovalChannel,
  ApprovedPlanRunDeps,
  Clock,
  ContentHash,
  CreateAnthropicProvider,
  CreateApiProvider,
  EngineDeps,
  EngineResult,
  InputDiagnostic,
  InputDiagnosticFile,
  Journal,
  JournalEvent,
  MaskedText,
  MessageLanguage,
  ModelProvider,
  PrivacyGateway,
  HumanOutput,
  MessageCatalog,
  RunApprovedPlan,
  RunSummaryContext,
  RunTask,
  StoredChangesPlan,
} from "../contracts/index.js";
import { withoutEmptyStateChanged } from "./result-fields.js";
import { cleanText } from "../app/input/text-safety.js";
import { createMessageCatalog } from "../i18n/index.js";
import { terminalConfirm } from "./confirm.js";
import type { AskLine } from "./confirm.js";
import { runApprovedPlan as engineRunApprovedPlan, runTask as engineRunTask } from "../engine/index.js";
import { createScriptedProvider, parseScript } from "../model/index.js";
import { parseArgs } from "./args.js";
import type { ApprovedPlanParts, Assemble } from "../app/assembly.js";
import { API_PROVIDER_FACTORIES } from "./provider.js";
import { createRunId } from "../app/input/run-id.js";
import { PROGRESS_PREFIX, englishProgressLines, withProgress, writeProgressLines } from "./progress.js";
import { resolveApiSettings } from "../app/input/settings.js";
import { countingJournal } from "../app/tally.js";
import { journalWithEvents } from "../app/events.js";
import { MODEL_NOT_FOUND_HINT, defaultConfigNotice, runLife } from "../app/run-life.js";
import type { RunObserver } from "../app/types.js";
import { argumentsError, cliError as error, jsonSyntaxError, parseJson, prepareTask, readText, scrub, settingsError } from "../app/prepare.js";
import type { CliRunOutcome, PrepareEnvironment, PreparedTask, RunArgs, RunNotes } from "../app/prepare.js";

// U-287 (CLI migration C-5): the run's steps 1 to 7 (prepareTask) and the error outcomes are the app
// layer's now (src/app/prepare.ts). These re-exports keep the old names for the tests, the CLI's
// commands until they import from there, and the app layer (plan A); steps 8 on stay here until C-6a.
export { argumentsError, cliError, jsonSyntaxError, positionDiagnostic, prepareTask, settingsError, withHint, workflowProblemText } from "../app/prepare.js";
export type { CliRunOutcome, PrepareEnvironment, PreparedTask, RunNotes, RunOutcomeInfo } from "../app/prepare.js";
// U-293 (C-6a): the end summary's counting is the app layer's (src/app/tally.ts); its test keeps this name.
export { notePrivateData } from "../app/tally.js";
// U-296 (C-6a): the Y-4 hint and the default location's notice are the app layer's run life's (one text
// each); tests and this file's approved-plan run take them by these names.
export { MODEL_NOT_FOUND_HINT, defaultConfigNotice } from "../app/run-life.js";

export interface CliEnvironment extends PrepareEnvironment {
  readonly argv: readonly string[];
  readonly clock: Clock;
  readonly randomBytes: (size: number) => Uint8Array;
  readonly assemble: Assemble;
  readonly runTask?: RunTask;
  /** U-195: overrides the engine's runApprovedPlan in tests (a run that carries out an approved run plan). */
  readonly runApprovedPlan?: RunApprovedPlan;
  /** Overrides `anthropicProviderFactory` in tests. `null` stands for a provider that is not connected. */
  readonly createAnthropicProvider?: CreateAnthropicProvider | null;
  /** Passed to the anthropic provider. Tests inject `fetch` here; the real CLI leaves it unset. */
  readonly anthropicDeps?: AnthropicProviderDeps;
  /**
   * SP-6: overrides an API provider's factory (API_PROVIDER_FACTORIES when absent); `null` stands for
   * a provider that is not connected. For anthropic, `createAnthropicProvider` is read first.
   */
  readonly providerFactories?: { readonly [P in ApiProviderName]?: CreateApiProvider | null };
  /** SP-6: injection points per API provider; anthropic falls back to `anthropicDeps`. */
  readonly providerDeps?: { readonly [P in ApiProviderName]?: ApiProviderDeps };
  /** Cancellation for the run. Created from the parsed arguments. */
  readonly cancelSignal: (cancelFile: string | null) => { signal: AbortSignal; dispose(): void };
  /**
   * U-110 (B-5): asks one line at a terminal. The real CLI gives it only when standard input and
   * stderr are terminals. Absent, or with --quiet: the permission question is not asked (denied by
   * default, DR-10).
   */
  readonly ask?: AskLine;
  /** U-8: writes one progress line (with its line feed) to stderr. Absent or `--quiet`: no progress. */
  readonly writeProgress?: (line: string) => void;
  /**
   * N-4, N-5: the human renderer and the catalog for the config file's language (null when it has
   * none). Called once the config is read. Absent: English progress lines and no end summary.
   */
  readonly human?: (configLanguage: MessageLanguage | null) => { readonly output: HumanOutput; readonly messages: MessageCatalog };
}

/** N-15: a message that starts with a schema field path (the script parser's messages do). */
function headDiagnostic(file: InputDiagnosticFile, message: string): InputDiagnostic | undefined {
  const field = toSchemaFieldPath(message.split(" ", 1)[0] ?? "");
  return field === null ? undefined : { code: "invalid_value", file, field, line: null, column: null };
}

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

function withModelHint(
  result: EngineResult,
  privacy: PrivacyGateway,
  write: ((line: string) => void) | undefined,
  /** N-4: the progress line in the chosen language; the notice in the result stays English. */
  progressText: string = MODEL_NOT_FOUND_HINT,
): EngineResult {
  const masked = privacy.mask(MODEL_NOT_FOUND_HINT);
  if (!masked.ok) return result;
  if (write !== undefined) writeMasked(write, privacy, progressText);
  return { ...result, notices: [...result.notices, masked.text] };
}

/**
 * U-195: ApprovedPlanRunDeps from a run's deps: no gate of its own (the engine makes it with
 * policyFor, adding the plan's files as one more writable list), and the approved plan with the
 * assembly's probe, claim and records question.
 */
function approvedDeps(deps: EngineDeps, approved: ApprovedRunPlan, parts: ApprovedPlanParts): ApprovedPlanRunDeps {
  const { policy: _gate, ...rest } = deps;
  return {
    ...rest,
    approved: {
      planRunId: approved.planRunId,
      digest: approved.digest,
      approval: approved.approval,
      plan: approved.plan,
      fileNow: parts.fileNow,
      markApplied: () => parts.markApplied(),
      planRecordsUnchecked: () => parts.planRecordsUnchecked(),
    },
    policyFor: (sets) => parts.policyFor(sets),
  };
}

/** U-182: the English of progress.not_writable_hint, when no catalog is given. */
const notWritableHint = (count: number): string =>
  `Writes denied because the file is not in writablePaths: ${count}. To allow a file, add it to writablePaths wherever that is set (config file, profile, task type, task file); every list must cover it.`;

/** Writes one masked progress line; best effort. */
function writeMasked(write: (line: string) => void, privacy: PrivacyGateway, text: string): void {
  const masked = privacy.mask(`${PROGRESS_PREFIX}${text}`);
  if (!masked.ok) return;
  try {
    write(`${masked.text}\n`);
  } catch {
    // Progress is best effort.
  }
}

/** Adds one masked notice to the result (and so to result.json). */
function withNotice(result: EngineResult, privacy: PrivacyGateway, text: string): EngineResult {
  const masked = privacy.mask(text);
  return masked.ok ? { ...result, notices: [...result.notices, masked.text] } : result;
}

export async function runCli(io: CliEnvironment): Promise<CliRunOutcome> {
  const parsed = parseArgs(io.argv);
  if (!parsed.ok) return argumentsError(parsed);
  const args = parsed.args;
  const notes: RunNotes = { configLanguage: null, configDefault: null, deniedToolCalls: 0, deniedCommandCalls: 0, failedToolCalls: 0 };
  const outcome = await runParsed(io, args, notes);
  return { ...outcome, info: { configLanguage: notes.configLanguage, summary: summaryContext(args, notes), quiet: args.quiet } };
}

/** N-5, N-17, N-23: what the end summary needs; no typed or file value. */
function summaryContext(args: RunArgs, notes: RunNotes): RunSummaryContext {
  return {
    workspaceForm: args.input.kind === "task" ? "task" : args.input.oneLine ? "current" : "given",
    // DR-51 (U-38): with "given" only; the hints then show the path the person typed.
    ...(args.input.kind === "quick" && !args.input.oneLine && notes.workspaceShown !== undefined ? { workspaceShown: notes.workspaceShown } : {}),
    configDefault: notes.configDefault,
    profileApplied: args.profile !== null,
    deniedToolCalls: notes.deniedToolCalls,
    deniedCommandCalls: notes.deniedCommandCalls,
    failedToolCalls: notes.failedToolCalls,
    // U-110 (R-85 M1): the denials after a permission question, so the hint is not to add a rule.
    ...(notes.confirmationDenied === undefined ? {} : { confirmationDenied: { ...notes.confirmationDenied, couldAsk: notes.couldAsk === true } }),
    // U-148 (U-140, UXM-18): what the task type left out, as run_started records it; not when empty.
    ...(notes.policyNarrowings === undefined || notes.policyNarrowings.length === 0 ? {} : { policyNarrowings: notes.policyNarrowings }),
    // U-195 (Codex V-14 L-1, U-198): the writes refused as not writable, by why; not when none.
    ...(notes.deniedNotPlanned === undefined ? {} : { deniedNotPlanned: notes.deniedNotPlanned }),
    ...(notes.deniedNotWritable === undefined ? {} : { deniedNotWritable: notes.deniedNotWritable }),
    // U-210 (U-207): the calls refused at unreadable paths and the table results that hid groups; not when none.
    ...(notes.deniedUnreadable === undefined ? {} : { deniedUnreadable: notes.deniedUnreadable }),
    ...(notes.hiddenGroups === undefined ? {} : { hiddenGroups: { ...notes.hiddenGroups } }),
    // U-220 (U-201): the run's lock could not be released at its end; not when it was.
    ...(notes.lockLeft === true ? { lockLeft: true } : {}),
    policySource: args.input.kind === "task" ? "task" : "config",
  };
}

/** Writes human text (several lines) masked with the run's gateway and cleaned; best effort. */
function writeHuman(write: (line: string) => void, privacy: PrivacyGateway, text: string): void {
  if (text.length === 0) return;
  const masked = privacy.mask(text);
  if (!masked.ok) return;
  try {
    write(`${cleanText(masked.text, true).replace(/\t/g, " ").replace(/\n?$/, "\n")}`);
  } catch {
    // Human output is best effort.
  }
}

async function runParsed(io: CliEnvironment, args: RunArgs, notes: RunNotes): Promise<CliRunOutcome> {
  const ready = await prepareTask(io, args, notes);
  if (!("prepared" in ready)) return ready;
  return runPrepared(io, args, notes, ready.prepared);
}

/**
 * U-195 (DR-69 B-3, B-4): an approved `run` plan that `codaryn apply` carries out (ApprovedChangesPlan
 * without what the assembly makes): the plan run, the approved digest, how the person approved it,
 * and the plan as loaded (LoadAnyPlan).
 */
export interface ApprovedRunPlan {
  readonly planRunId: string;
  readonly digest: ContentHash;
  readonly approval: ApprovalChannel;
  readonly plan: StoredChangesPlan;
}

/**
 * U-296 (the CLI migration's C-6a, its fourth commit): an ordinary run's steps 8 on are the app
 * layer's run life (runLife: the model, the HTTP 404 watch, the cancel source, the assembly and the
 * lock, the end summary's counts, the engine, the notices, the end), on this run's own environment as
 * it is (process.env with the variables file loaded into it, the CLI's assembly: DR-4 as before), so
 * what a test gives reaches the life unchanged. The CLI draws what a person sees, as before:
 * - once assembled: the typed workspace for the end summary (DR-51), the renderer in the config's
 *   language, the permission question at a terminal (B-5), and each record as stored
 *   (RunObserver.onStoredRecord, through the app's journalWithEvents) drawn as its progress lines and
 *   masked with the run's gateway as RunHandle.mask masks; right after the start, the default
 *   location's line (N-1);
 * - after the run, the lock released: the Y-4 line, the writablePaths line and the end summary.
 * The refusals are the life's own (cliError), so the JSON line keeps its keys' order.
 */
async function runThroughApp(io: CliEnvironment, args: RunArgs, notes: RunNotes, prepared: PreparedTask): Promise<CliRunOutcome> {
  const { defaultDisplay } = prepared;
  // U-8: progress lines follow the journal; they start only once the run has started.
  const write = args.quiet ? undefined : io.writeProgress;
  // Set once assembled (the closure below), so declared wide: control flow cannot see that.
  let privacy = null as PrivacyGateway | null;
  // N-4, N-5: the human renderer in the chosen language (the config's language is known now).
  let human = undefined as { readonly output: HumanOutput; readonly messages: MessageCatalog } | undefined;
  const assemble: Assemble = async (input) => {
    const assembled = await io.assemble(input);
    if (!assembled.ok) return assembled;
    const gateway = assembled.deps.privacy;
    privacy = gateway;
    // DR-51 (U-38): the typed --workspace for the end summary's hints, after the run's own masking.
    // Best effort, as the summary is: a gateway that cannot mask it leaves the hint at <workspace>.
    if (args.input.kind === "quick" && !args.input.oneLine) {
      try {
        const typed = args.input.workspace;
        const masked = gateway.mask(typed);
        const shown = toShownWorkspace(typed, masked.ok ? masked.text : null);
        if (shown !== null) notes.workspaceShown = shown;
      } catch {
        // No path is shown.
      }
    }
    try {
      human = write === undefined ? undefined : io.human?.(notes.configLanguage);
    } catch {
      human = undefined;
    }
    const shown = human;
    // As RunHandle.mask masks (app.ts): with the run's gateway; null when the text cannot be masked.
    const mask = (text: string): MaskedText | null => {
      try {
        const masked = gateway.mask(text);
        return masked.ok ? masked.text : null;
      } catch {
        return null;
      }
    };
    const render = shown === undefined ? englishProgressLines() : (event: JournalEvent) => shown.output.progressLine(event);
    let announced = defaultDisplay === null;
    const observer: RunObserver =
      write === undefined
        ? {}
        : {
            onStoredRecord(record) {
              writeProgressLines(record, mask, write, render);
              // N-1: say once, right after the run started, that the default config location was used.
              if (!announced && record.type === "run_started") {
                announced = true;
                writeMasked(
                  write,
                  gateway,
                  shown !== undefined && defaultDisplay !== null
                    ? shown.messages.format("progress.config_default", { location: defaultDisplay })
                    : defaultConfigNotice(defaultDisplay ?? ""),
                );
              }
            },
          };
    // U-110 (B-5): at a terminal and without --quiet, the engine's permission question is asked on
    // stderr in the chosen language (English when no renderer is given).
    let questions: MessageCatalog | undefined;
    if (!args.quiet && io.ask !== undefined) {
      try {
        questions = shown?.messages ?? io.human?.(notes.configLanguage).messages;
      } catch {
        questions = undefined;
      }
    }
    const confirm = args.quiet || io.ask === undefined ? undefined : terminalConfirm(io.ask, questions ?? createMessageCatalog("en"));
    notes.couldAsk = confirm !== undefined;
    const journal = journalWithEvents(assembled.deps.journal, observer, gateway);
    return { ...assembled, deps: { ...assembled.deps, journal, ...(confirm === undefined ? {} : { confirm }) } };
  };
  const end = await runLife({ ...io, assemble }, args, notes, prepared);
  if (end.kind === "refused") return { output: end.output, exitCode: end.output.exitCode };
  const result = end.result;
  try {
    if (write !== undefined && privacy !== null) {
      const gateway: PrivacyGateway = privacy;
      const shown = human;
      // Y-4: the line in the chosen language when the life added the hint; the notice stays English.
      if (end.modelNotFound) writeMasked(write, gateway, shown === undefined ? MODEL_NOT_FOUND_HINT : shown.messages.format("progress.model_not_found"));
      // U-182 (DR-69 B-4): writes denied as path_not_writable, and how to allow a file. A progress
      // line only; the result is unchanged.
      const notWritable = notes.deniedNotWritable ?? 0;
      if (notWritable > 0) {
        writeMasked(write, gateway, shown === undefined ? notWritableHint(notWritable) : shown.messages.format("progress.not_writable_hint", { count: notWritable }));
      }
      // N-5: the end summary on stderr, after the lock is released.
      if (shown !== undefined) {
        let summary = "";
        try {
          summary = shown.output.runSummary(result, summaryContext(args, notes));
        } catch {
          summary = "";
        }
        writeHuman(write, gateway, summary);
      }
    }
  } catch {
    // As before, when a line after the engine could not be drawn (the life has released the lock).
    return error("internal_error", "the run stopped because of an internal error");
  }
  return { output: result, exitCode: result.exitCode };
}

/**
 * Steps 8 on (the model, the assembly, the engine, the end summary) for a prepared task. `run` gives
 * no `approved`: since C-6a (U-296) that is the app layer's life (runThroughApp). U-195: `codaryn
 * apply` gives the approved `run` plan it checked: the assembly then claims that plan run
 * (AssemblyInput.planRunId) and the engine's runApprovedPlan carries it out (EngineResult with
 * planRunId and planDigest); the rest (progress lines, end summary, result.json) is a run's. That run
 * keeps the life below until the CLI migration's C-6b.
 */
export async function runPrepared(io: CliEnvironment, args: RunArgs, notes: RunNotes, prepared: PreparedTask, approved?: ApprovedRunPlan): Promise<CliRunOutcome> {
  if (approved === undefined) return runThroughApp(io, args, notes, prepared);
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
    if (!resolved.ok) return settingsError(resolved);
    // Already registered above (S-2); kept so the key sent is always a registered secret.
    addSecret(resolved.settings.apiKey);
    // SP-6: the factory of the task's provider (API_PROVIDER_FACTORIES), given only its own settings.
    const provider = task.model.provider;
    const override = provider === "anthropic" && io.createAnthropicProvider !== undefined ? io.createAnthropicProvider : io.providerFactories?.[provider];
    const factory = override === undefined ? API_PROVIDER_FACTORIES[provider] : override;
    if (factory === null) {
      return error("provider_not_implemented", `the ${provider} provider is not connected; nothing was sent`);
    }
    try {
      model = factory(resolved.settings, io.providerDeps?.[provider] ?? (provider === "anthropic" ? io.anthropicDeps : undefined));
    } catch {
      // The provider re-checks the settings and throws only if they disagree with the CLI's checks.
      return error("internal_error", `the ${provider} provider rejected the resolved settings; nothing was sent`);
    }
  } else {
    const scriptText = await readText(io, task.model.scriptPath);
    if (scriptText === null) return error("invalid_script", "the script file cannot be read as JSON");
    const scriptJson = parseJson(scriptText);
    if (!scriptJson.ok) {
      const syntax = jsonSyntaxError("script file", "script", scriptText);
      return error("invalid_script", syntax.message, syntax.diagnostic);
    }
    const script = parseScript(scriptJson.value);
    if (!script.ok) return error("invalid_script", script.message, headDiagnostic("script", script.message));
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
      ...(approved === undefined ? {} : { planRunId: approved.planRunId }),
    });
    if (!assembled.ok) return error(assembled.code, scrub(assembled.message, secrets));
    // U-195: an assembly that cannot claim a plan (an older one) carries none out.
    const parts = assembled.approvedPlan;
    if (approved !== undefined && parts === undefined) {
      await assembled.finish(null);
      return error("internal_error", "this build cannot carry out a run plan; nothing was sent or written");
    }
    // U-195 (PM, as an apply of a plan of moves, U-1): the plan run's records-changed mark again, now
    // that the lock is held: a mark written since apply's own look stops the run before anything is
    // recorded, sent or written. A look that cannot be made counts as a mark (fail closed).
    if (approved !== undefined && parts !== undefined) {
      let marked: boolean;
      try {
        marked = await parts.planRecordsChanged();
      } catch {
        marked = true;
      }
      if (marked) {
        await assembled.finish(null);
        return error(
          "plan_records_changed",
          "the plan run's records were changed by something other than the run (a records-changed mark), found under the workspace lock; its plan may not be the one approved, so nothing was recorded, sent or written. Make the plan again with a new codaryn run",
        );
      }
    }
    const recorded = assembled.deps.journal;
    // The end summary's counts, as the records are written (U-293: the counting moved to src/app/tally.ts).
    const watched = countingJournal(recorded, notes, approved);
    // U-8: progress lines follow the journal; they start only once the run has started.
    const write = args.quiet ? undefined : io.writeProgress;
    const privacy = assembled.deps.privacy;
    // DR-51 (U-38): the typed --workspace for the end summary's hints, after the run's own masking.
    // Best effort, as the summary is: a gateway that cannot mask it leaves the hint at <workspace>.
    if (args.input.kind === "quick" && !args.input.oneLine) {
      try {
        const typed = args.input.workspace;
        const masked = privacy.mask(typed);
        const shown = toShownWorkspace(typed, masked.ok ? masked.text : null);
        if (shown !== null) notes.workspaceShown = shown;
      } catch {
        // No path is shown.
      }
    }
    // N-4, N-5: the human renderer in the chosen language (the config's language is known now).
    let human: { readonly output: HumanOutput; readonly messages: MessageCatalog } | undefined;
    try {
      human = write === undefined ? undefined : io.human?.(notes.configLanguage);
    } catch {
      human = undefined;
    }
    let announced = defaultDisplay === null;
    const progressed =
      write === undefined ? watched : withProgress(watched, privacy, write, human === undefined ? undefined : (event) => human.output.progressLine(event));
    // N-1: say once, right after the run started, that the default config location was used.
    const journal: Journal =
      announced || write === undefined
        ? progressed
        : {
            async append(event) {
              const stored = await progressed.append(event);
              if (!announced && event.type === "run_started") {
                announced = true;
                writeMasked(
                  write,
                  privacy,
                  human !== undefined && defaultDisplay !== null
                    ? human.messages.format("progress.config_default", { location: defaultDisplay })
                    : defaultConfigNotice(defaultDisplay ?? ""),
                );
              }
              return stored;
            },
            close: () => progressed.close(),
          };
    // U-110 (B-5): at a terminal and without --quiet, the engine's permission question is asked on
    // stderr in the chosen language (English when no renderer is given).
    let questions: MessageCatalog | undefined;
    if (!args.quiet && io.ask !== undefined) {
      try {
        questions = human?.messages ?? io.human?.(notes.configLanguage).messages;
      } catch {
        questions = undefined;
      }
    }
    const confirm = args.quiet || io.ask === undefined ? undefined : terminalConfirm(io.ask, questions ?? createMessageCatalog("en"));
    notes.couldAsk = confirm !== undefined;
    const deps = { ...assembled.deps, journal, ...(confirm === undefined ? {} : { confirm }) };
    let result: EngineResult | null = null;
    try {
      // DR-38 (PM after bf04750): an empty stateChanged is left out, in the output and in result.json.
      const ended = withoutEmptyStateChanged(
        approved === undefined || parts === undefined
          ? await (io.runTask ?? engineRunTask)(deps)
          : await (io.runApprovedPlan ?? engineRunApprovedPlan)(approvedDeps(deps, approved, parts)),
      );
      const hint = human === undefined ? undefined : human.messages.format("progress.model_not_found");
      const hinted = modelNotFound && ended.reason === "model_error" ? withModelHint(ended, privacy, write, hint) : ended;
      // U-182 (DR-69 B-4): writes denied as path_not_writable, and how to allow a file. A progress
      // line only; the result is unchanged. U-195 (Codex V-14 L-1, U-198): not in a run that carries
      // out a plan, whose refused writes are counted as outside the plan (deniedNotPlanned), which no
      // writablePaths entry widens; the end summary tells those and how to go on.
      const notWritable = notes.deniedNotWritable ?? 0;
      if (write !== undefined && notWritable > 0) {
        writeMasked(write, privacy, human === undefined ? notWritableHint(notWritable) : human.messages.format("progress.not_writable_hint", { count: notWritable }));
      }
      result = defaultDisplay === null ? hinted : withNotice(hinted, privacy, defaultConfigNotice(defaultDisplay));
    } finally {
      // Releases the workspace lock even when the run threw. U-220: a lock it could not release is
      // told in the end summary (lock.release_failed); the run's result and exit code stay.
      const finished: unknown = await assembled.finish(result);
      if (typeof finished === "object" && finished !== null && (finished as { readonly lockLeft?: unknown }).lockLeft === true) notes.lockLeft = true;
    }
    // N-5: the end summary on stderr, after the lock is released.
    if (write !== undefined && human !== undefined) {
      let summary = "";
      try {
        summary = human.output.runSummary(result, summaryContext(args, notes));
      } catch {
        summary = "";
      }
      writeHuman(write, privacy, summary);
    }
    return { output: result, exitCode: result.exitCode };
  } catch {
    return error("internal_error", "the run stopped because of an internal error");
  } finally {
    cancel.dispose();
  }
}
