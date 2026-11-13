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
 */

import path from "node:path";
import {
  CLI_ERROR_EXIT_CODES,
  CLI_ERROR_HINT_DETAIL,
  cliErrorFacts,
  LEGACY_WORKFLOW_SETTINGS,
  RESULT_SCHEMA_VERSION,
  mergeWorkflowPolicy,
  mergeWorkflowVerifiers,
  toSchemaFieldPath,
  toShownWorkspace,
  workflowPolicyNarrowings,
  workflowVerifierNarrowings,
} from "../contracts/index.js";
import type {
  AnthropicProviderDeps,
  ApiProviderDeps,
  ApiProviderName,
  ApprovalChannel,
  ApprovedPlanRunDeps,
  CliErrorCode,
  CliErrorHint,
  CliErrorHintDetail,
  CliErrorOutput,
  CliOutput,
  Clock,
  CodarynConfig,
  ContentHash,
  CreateAnthropicProvider,
  CreateApiProvider,
  DefaultConfigDisplay,
  DefaultConfigLocation,
  DetailedCliErrorHint,
  EngineDeps,
  EngineResult,
  InputDiagnostic,
  InputDiagnosticFile,
  Journal,
  MessageLanguage,
  ResolvedTaskSpec,
  ModelProvider,
  PrivacyGateway,
  HumanOutput,
  MessageCatalog,
  PlanMode,
  PolicyNarrowing,
  RunApprovedPlan,
  RunSummaryContext,
  RunTask,
  ShownWorkspace,
  StoredChangesPlan,
  WorkflowDefinition,
  WorkflowProblem,
  WorkflowSettings,
} from "../contracts/index.js";
import { resolveWorkflow, workflowDefinitions } from "../workflows/index.js";
import { withoutEmptyStateChanged } from "./result-fields.js";
import { cleanText } from "./text-safety.js";
import { createMessageCatalog } from "../i18n/index.js";
import { terminalConfirm } from "./confirm.js";
import type { AskLine } from "./confirm.js";
import { runApprovedPlan as engineRunApprovedPlan, runTask as engineRunTask } from "../engine/index.js";
import { createScriptedProvider, parseScript } from "../model/index.js";
import { parseArgs } from "./args.js";
import type { RunArgs } from "./args.js";
import type { ApprovedPlanParts, Assemble } from "./assemble.js";
import { parseConfig } from "./config.js";
import { chooseConfigFile, isMissingFile, selectProfile } from "./config-file.js";
import { jsonSyntaxPosition } from "./json-position.js";
import { API_PROVIDER_FACTORIES } from "./provider.js";
import { createRunId } from "./run-id.js";
import { createFailedCalls } from "./failed-calls.js";
import { PROGRESS_PREFIX, withProgress } from "./progress.js";
import {
  MAX_KEY_SCAN_DEPTH,
  findKeyInJson,
  goalHoldsKey,
  inputFileTooLarge,
  inputFileTooLargeMessage,
  keyHintFor,
  keyOwnerIn,
  rawTextHoldsKey,
  relateRealPaths,
  secretEnvNotSetMessage,
  selectEnvFileSecrets,
} from "./security/index.js";
import type { PathRelation, WorkspaceLocation } from "./security/index.js";
import { SETTINGS_MISSING, envValue, knownKeyEntries, knownKeyValues, resolveApiSettings, runKeySecrets } from "./settings.js";
import type { SettingsEnvironment, SettingsFailure } from "./settings.js";
import { buildQuickTask, localPathProblem, parseTask, withConfigSecrets } from "./task.js";
import type { InputErrorPosition } from "./task.js";
import { writablePathSetsOf } from "./writable.js";

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
  /**
   * U-3: the running CLI's package root (`findInstall` in the real CLI, which always sets it).
   * Undefined: not checked (in-process tests). Null: it could not be found, so every run is refused.
   */
  readonly installDir?: string | null;
  /** U-1, U-3: real path relation (`relateRealPaths` when absent). */
  readonly relatePaths?: (target: string, base: string) => Promise<PathRelation>;
  /** U-8: writes one progress line (with its line feed) to stderr. Absent or `--quiet`: no progress. */
  readonly writeProgress?: (line: string) => void;
  /**
   * N-1: the default config location (`findDefaultConfigLocation` in the real CLI), read when
   * neither `--config` nor CODARYN_CONFIG is given and a file exists there. Absent or null: none.
   */
  readonly defaultConfig?: DefaultConfigLocation | null;
  /**
   * N-4, N-5: the human renderer and the catalog for the config file's language (null when it has
   * none). Called once the config is read. Absent: English progress lines and no end summary.
   */
  readonly human?: (configLanguage: MessageLanguage | null) => { readonly output: HumanOutput; readonly messages: MessageCatalog };
}

/**
 * What the human-readable output needs besides the output itself (N-4, N-5, N-17). Holds no typed
 * or file value: `summary` is exactly the contract's RunSummaryContext.
 */
export interface RunOutcomeInfo {
  /** The valid config file's `language`, or null (N-4). */
  readonly configLanguage: MessageLanguage | null;
  readonly summary: RunSummaryContext;
  /** `--quiet`. */
  readonly quiet: boolean;
}

/** Filled while a run is prepared and while it runs. */
export interface RunNotes {
  configLanguage: MessageLanguage | null;
  configDefault: DefaultConfigDisplay | null;
  /** N-17: `tool_decision` records with `allowed: false`, as ReportJournalSummary counts them. */
  deniedToolCalls: number;
  /** N-23: the denied calls whose permission is `command`. */
  deniedCommandCalls: number;
  /** U-182 (DR-69 B-4): the denied writes outside the writable lists (path_not_writable); absent is 0. */
  deniedNotWritable?: number;
  /** DR-51 (U-38): the typed --workspace of the quick form, after the run's masking (toShownWorkspace); absent when it gives none. */
  workspaceShown?: ShownWorkspace;
  /** U-18 (AXM-4): calls allowed and then failed, by the rule of failed-calls.ts (RunSummaryContext.failedToolCalls). */
  failedToolCalls: number;
  /** U-110 (R-85 M1): `confirmation_answered` records with `deny`, by who decided; absent while there is none. */
  confirmationDenied?: { user: number; default: number; cancelled: number };
  /** U-110: whether this run gave the engine a way to ask (the terminal question). */
  couldAsk?: boolean;
  /** U-148 (U-140, UXM-18): `run_started.policyNarrowings` as recorded; absent when it has none. */
  policyNarrowings?: readonly PolicyNarrowing[];
}

export interface CliRunOutcome {
  readonly output: CliOutput;
  readonly exitCode: number;
  /** Absent when the arguments could not be parsed. */
  readonly info?: RunOutcomeInfo;
}

function error(code: CliErrorCode, message: string, diagnostic?: InputDiagnostic): { output: CliErrorOutput; exitCode: number } {
  const exitCode = CLI_ERROR_EXIT_CODES[code];
  return {
    // U-55 (AXM-9): every error says its category and whether the same command may succeed later.
    output: { schemaVersion: RESULT_SCHEMA_VERSION, kind: "error", code, exitCode, message, ...(diagnostic === undefined ? {} : { diagnostic }), ...cliErrorFacts(code) },
    exitCode,
  };
}

/**
 * N-15: a validator's position as an InputDiagnostic, or undefined when it is not a plain schema
 * field path (then nothing about the position is printed).
 */
export function positionDiagnostic(file: InputDiagnosticFile, position: InputErrorPosition | undefined): InputDiagnostic | undefined {
  if (position === undefined) return undefined;
  const field = toSchemaFieldPath(position.field);
  if (field === null) return undefined;
  if (position.code !== "unknown_field") return { code: position.code, file, field, line: null, column: null };
  const suggestion = position.suggestion === undefined || position.suggestion === null ? null : toSchemaFieldPath(position.suggestion);
  return { code: "unknown_field", file, field, line: null, column: null, suggestion };
}

/** N-15: the message and diagnostic for a file JSON.parse rejected; the parser's own text is never used. */
export function jsonSyntaxError(label: string, file: InputDiagnosticFile, text: string): { message: string; diagnostic: InputDiagnostic } {
  const at = jsonSyntaxPosition(text);
  return {
    message: `the ${label} cannot be read as JSON${at === null ? "" : ` (line ${at.line}, column ${at.column})`}`,
    diagnostic: { code: "json_syntax", file, field: null, line: at?.line ?? null, column: at?.column ?? null },
  };
}

/** N-15: a message that starts with a schema field path (the script parser's messages do). */
function headDiagnostic(file: InputDiagnosticFile, message: string): InputDiagnostic | undefined {
  const field = toSchemaFieldPath(message.split(" ", 1)[0] ?? "");
  return field === null ? undefined : { code: "invalid_value", file, field, line: null, column: null };
}

/** One CliErrorOutput and its exit code. The message must not contain secrets or file contents. */
export const cliError = error;

type ErrorOutcome = { output: CliErrorOutput; exitCode: number };

/**
 * U-37 (UXM-2, DR-57): the error with the hint that names its reason, for the human error; the
 * JSON line gains only `hint`. A detailed hint's values go under CLI_ERROR_HINT_DETAIL, a symbol
 * key the JSON line leaves out. `message` is not changed.
 */
export function withHint(outcome: ErrorOutcome, hint: CliErrorHint | DetailedCliErrorHint, detail?: CliErrorHintDetail): ErrorOutcome {
  return { ...outcome, output: { ...outcome.output, hint, ...(detail === undefined ? {} : { [CLI_ERROR_HINT_DETAIL]: detail }) } };
}

/** U-37: an argument error from a parse failure, with its hint and unknown_option's place when it has them. */
export function argumentsError(failure: {
  readonly message: string;
  readonly hint?: CliErrorHint | DetailedCliErrorHint;
  readonly position?: number;
}): ErrorOutcome {
  const outcome = error("invalid_arguments", failure.message);
  if (failure.hint === undefined) return outcome;
  return withHint(outcome, failure.hint, failure.hint === "unknown_option" && failure.position !== undefined ? { position: failure.position } : undefined);
}

/** U-37: a settings failure; provider_not_configured names the missing settings (provider_settings_missing). */
export function settingsError(failure: SettingsFailure): ErrorOutcome {
  const outcome = error(failure.code, failure.message);
  const missing = failure[SETTINGS_MISSING];
  return failure.code === "provider_not_configured" && missing !== undefined && missing.length > 0
    ? withHint(outcome, "provider_settings_missing", { missing })
    : outcome;
}

/**
 * Y-4: added to the result's notices (and, with progress on, to stderr) when the run ended with a
 * model error whose request was answered with HTTP 404. The error kind stays the provider's.
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

/** G-A: what each workflow problem means, after the field position (never a value). */
const WORKFLOW_PROBLEM_TEXT: { readonly [P in WorkflowProblem]: string } = {
  unknown_workflow: "names no built-in workflow and no workflows entry of the config file",
  tool_not_allowed: "names a tool the workflow definition does not offer (tools only narrow)",
  plan_weakened: 'cannot be "none" under a workflow with plan "apply"',
  commands_not_allowed: "must be empty: the workflow allows no command",
  review_without_checklist: 'is required with completion "human_review"',
  checklist_without_review: 'is only allowed with completion "human_review"',
  instructions_too_long: "is longer than the limit",
  checklist_too_long: "must have 1 to the maximum number of non-blank lines within the length limit",
};

/**
 * U-195 (U-177's note): plan_weakened names the task's and the definition's plan modes (U-180: a task
 * keeps a definition's "apply" or "run", or sets one under "none"). A definition's "apply" and a
 * task's "none" give WORKFLOW_PROBLEM_TEXT's text, as before.
 */
function planWeakenedText(taskPlan: PlanMode | undefined, definitionPlan: PlanMode | undefined): string {
  if (taskPlan === undefined || definitionPlan === undefined) return WORKFLOW_PROBLEM_TEXT.plan_weakened;
  return `cannot be "${taskPlan}" under a workflow with plan "${definitionPlan}"`;
}

/**
 * G-A: the config as a task sees it when a workflow definition applies: the definition's limits
 * under the config's (and so under the profile's); in the quick form, DR-41 and DR-43 (a): its
 * policy and its verifiers merged with the profile's or the config's (mergeWorkflowPolicy,
 * mergeWorkflowVerifiers), never replaced by them.
 */
function underDefinition(config: CodarynConfig | null, definition: WorkflowDefinition, quick: boolean): CodarynConfig {
  const base: CodarynConfig = config ?? { schemaVersion: 1 };
  // Review R-11 L-1: a definition's limits are defaults (contract: "laid under"), never bounds. In
  // the quick form the config's limits are the run's, with the definition's filling the gaps; a task
  // file gets them through parseTask's workflowLimits, and only the config bounds it (S-7).
  const limits = !quick || definition.limits === undefined ? base.limits : { ...definition.limits, ...(base.limits ?? {}) };
  const policy = quick ? mergeWorkflowPolicy(definition.policy, base.policy) : base.policy;
  const verifiers = quick ? mergeWorkflowVerifiers(definition.verifiers, base.verifiers) : base.verifiers;
  return {
    ...base,
    ...(limits === undefined ? {} : { limits }),
    ...(policy === undefined ? {} : { policy }),
    ...(verifiers === undefined ? {} : { verifiers }),
  };
}

/**
 * G-A: the resolved task carries every workflow field when a workflow applies; a task with no
 * workflow keeps none of them, so it runs exactly as before stage 4 (GT-U14).
 */
function withWorkflow(task: ResolvedTaskSpec, workflowRef: string | null, settings: WorkflowSettings): ResolvedTaskSpec {
  if (workflowRef === null && settings === LEGACY_WORKFLOW_SETTINGS) return task;
  const { humanReview: _drop, ...rest } = task;
  return {
    ...rest,
    ...(workflowRef === null ? {} : { workflowRef }),
    tools: settings.tools,
    instructions: settings.instructions,
    plan: settings.plan,
    completion: settings.completion,
    ...(settings.humanReview === null ? {} : { humanReview: settings.humanReview }),
  };
}

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

/** Task, config and script files may start with a UTF-8 byte order mark (common on Windows). */
async function readText(io: Pick<CliEnvironment, "readFile">, file: string): Promise<string | null> {
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


/** N-1: shown in the progress lines and the result's notices when the default location was used. */
export function defaultConfigNotice(display: string): string {
  return `settings were read from the default config file location ${display}`;
}

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

/** What `prepareTask` reads besides the arguments: the parts of CliEnvironment steps 1 to 7 use. */
export type PrepareEnvironment = Pick<
  CliEnvironment,
  "env" | "cwd" | "readFile" | "isDirectory" | "loadEnvFile" | "locateInWorkspace" | "relatePaths" | "installDir" | "defaultConfig"
>;

/** A task ready to run, plan, apply or review: steps 1 to 7 passed. */
export interface PreparedTask {
  readonly task: ResolvedTaskSpec;
  readonly config: CodarynConfig | null;
  /** Every registered secret value (S-2 to S-4). */
  readonly secrets: readonly string[];
  readonly integrityPaths: readonly string[];
  readonly defaultDisplay: DefaultConfigDisplay | null;
}

/**
 * Steps 1 to 7 (arguments, variable file, key, config and task files, validation, workspace,
 * secrets), shared by `run`, `plan`, `apply` and `review` (DR-17): each registers the same
 * secrets and resolves the same task. An error outcome, or the prepared task.
 */
export async function prepareTask(
  io: PrepareEnvironment,
  args: RunArgs,
  notes: RunNotes,
  /**
   * `secrets: false` (review without a note, R-4 L-4): the secretEnv variables are not read, so a
   * missing one does not stop the command. The key and the variable file's values are still kept.
   */
  options: {
    readonly secrets?: boolean;
    /** U-17: the quick form of a command that runs nothing (QuickTaskInput.readOnly). */
    readonly readOnly?: boolean;
  } = {},
): Promise<CliRunOutcome | { readonly prepared: PreparedTask }> {
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

  // U-3, review R-6 low 2: the quick form names its workspace on the command line, so the install
  // directory is refused before any file is read; otherwise a missing config would be reported
  // first. A workspace that cannot be resolved here is judged with the task later.
  const relate = io.relatePaths ?? ((target: string, base: string) => relateRealPaths(target, base));
  if (args.input.kind === "quick" && io.installDir !== undefined && io.installDir !== null) {
    const relation = await relate(path.resolve(io.cwd, args.input.workspace), io.installDir);
    if (relation === "same" || relation === "inside" || relation === "contains") {
      return error(
        "workspace_is_install_dir",
        "the workspace is the CLI's install directory, lies inside it or contains it; use a separate candidate directory",
      );
    }
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

  // 3. The current key, the config file (N-1: --config, CODARYN_CONFIG, the default location), the goal (S-5, S-8).
  // SP-2: every key variable Codaryn knows, whatever provider runs.
  const currentKey = knownKeyValues(io.env);
  const chosen = chooseConfigFile({ argument: args.configPath, env: io.env, cwd: io.cwd, defaultLocation: io.defaultConfig ?? null });
  if (!chosen.ok) return error("invalid_config", chosen.message);
  if (args.input.kind === "quick" && goalHoldsKey(args.input.goal, currentKey)) {
    return withHint(error("key_in_file", `the goal contains a key value; ${keyHintFor(keyOwnerIn(args.input.goal, knownKeyEntries(io.env)))}`), "key_in_goal");
  }

  // 4. Read both files, then look for a key in each before anything else is judged (C-1, S-6).
  const files: InputFile[] = [];
  const candidate = chosen.candidate;
  let defaultDisplay: DefaultConfigDisplay | null = null;
  // U-115 (UXM-9): no file at the default location (nor --config, nor CODARYN_CONFIG).
  let noConfigYet = false;
  if (candidate !== null) {
    let text: string | null = null;
    try {
      text = (await io.readFile(candidate.path)).replace(/^\uFEFF/, "");
    } catch (failure) {
      // N-1: no file at the default location means no config file, as before. Anything else stops.
      if (!(candidate.optional && isMissingFile(failure))) {
        return error(
          "invalid_config",
          candidate.source === "default"
            ? `the config file at the default location ${candidate.display} cannot be read`
            : "the config file cannot be read as JSON",
        );
      }
      noConfigYet = candidate.source === "default";
    }
    if (text !== null) {
      // DR-40 (b): a file over the cap is refused before any check reads it.
      if (inputFileTooLarge(text)) return withHint(error("invalid_config", inputFileTooLargeMessage("config file")), "input_too_large");
      files.push({ label: "config file", path: candidate.path, code: "invalid_config", text });
      if (candidate.source === "default") defaultDisplay = io.defaultConfig?.display ?? null;
    }
  }
  if (args.input.kind === "task") {
    const taskPath = path.resolve(io.cwd, args.input.taskPath);
    const text = await readText(io, taskPath);
    // U-37: the message stays as it was (DR-48), though the file was not read rather than not JSON.
    if (text === null) return withHint(error("invalid_task", "the task file cannot be read as JSON"), "task_file_unreadable");
    if (inputFileTooLarge(text)) return withHint(error("invalid_task", inputFileTooLargeMessage("task file")), "input_too_large");
    files.push({ label: "task file", path: taskPath, code: "invalid_task", text });
  }
  for (const file of files) {
    if (rawTextHoldsKey(file.text, currentKey)) {
      return withHint(
        error("key_in_file", `the ${file.label} contains a key value; ${keyHintFor(keyOwnerIn(file.text, knownKeyEntries(io.env)))}`),
        file.code === "invalid_config" ? "key_in_config" : "key_in_task",
      );
    }
  }
  const fileKind = (code: "invalid_config" | "invalid_task"): InputDiagnosticFile => (code === "invalid_config" ? "config" : "task");
  for (const file of files) {
    const json = parseJson(file.text);
    if (!json.ok) {
      const syntax = jsonSyntaxError(file.label, fileKind(file.code), file.text);
      return error(file.code, syntax.message, syntax.diagnostic);
    }
    file.value = json.value;
  }
  for (const file of files) {
    const found = findKeyInJson(file.value, currentKey);
    if (found.kind === "key") {
      // A key field belongs to no provider; a key value found there names its owner.
      const keyError = error("key_in_file", `the ${file.label} has a key field or key value at ${found.location}; ${keyHintFor(keyOwnerIn(file.text, knownKeyEntries(io.env)))}`);
      // U-37: the place when it is a schema field path; otherwise only which file.
      const field = toSchemaFieldPath(found.location);
      const inConfig = file.code === "invalid_config";
      return field === null
        ? withHint(keyError, inConfig ? "key_in_config" : "key_in_task")
        : withHint(keyError, inConfig ? "key_field_in_config" : "key_field_in_task", { field });
    }
    if (found.kind === "too_deep") {
      return error(file.code, `the ${file.label} is nested more than ${MAX_KEY_SCAN_DEPTH} levels deep`, {
        code: "too_deep",
        file: fileKind(file.code),
        field: null,
        line: null,
        column: null,
      });
    }
  }
  const configFile = files.find((file) => file.code === "invalid_config") ?? null;
  const taskFile = files.find((file) => file.code === "invalid_task") ?? null;

  // 5. Validate the config, apply --profile (N-8), then the task.
  let config: CodarynConfig | null = null;
  if (configFile !== null) {
    const outcome = parseConfig(configFile.value);
    if (!outcome.ok) {
      const failed = error("invalid_config", outcome.message, positionDiagnostic("config", outcome.position));
      // U-177: a parser's hint (a definition's plan "run") makes the human error say why.
      return outcome.hint === undefined ? failed : withHint(failed, outcome.hint);
    }
    config = outcome.config;
    notes.configLanguage = config.language ?? null;
    notes.configDefault = defaultDisplay;
  }
  // U-182 (DR-69 B-4): the config file's own policy is one writable list even when a profile's
  // policy replaces it below, so it is kept as parsed.
  const fileConfig = config;
  let profileWorkflowRef: string | null = null;
  if (args.profile !== null) {
    profileWorkflowRef = (config?.profiles ?? {})[args.profile]?.workflowRef ?? null;
    const selected = selectProfile(config, args.profile);
    if (!selected.ok) return withHint(error("invalid_config", selected.message), selected.hint);
    config = selected.config;
  }

  // G-A (GT-D1): the workflow definition named by the task's workflowRef, --workflow or the
  // profile. Its limits lie under the config's; its policy and verifiers are merged (DR-41, DR-43 (a)).
  const definitions = workflowDefinitions(config?.workflows);
  const rawTaskRef = taskFile === null ? undefined : (taskFile.value as { workflowRef?: unknown } | null)?.workflowRef;
  const requestedRef = (typeof rawTaskRef === "string" ? rawTaskRef : null) ?? args.workflow ?? profileWorkflowRef;
  const definition = requestedRef !== null && Object.hasOwn(definitions, requestedRef) ? definitions[requestedRef] : undefined;
  const taskConfig = definition === undefined ? config : underDefinition(config, definition, taskFile === null);

  const taskOutcome =
    taskFile !== null
      ? parseTask(taskFile.value, path.dirname(taskFile.path), { limits: taskConfig?.limits, workflowLimits: definition?.limits })
      : args.input.kind === "quick"
        ? buildQuickTask({ workspace: args.input.workspace, goal: args.input.goal, cwd: io.cwd, config: taskConfig, workflowRef: args.workflow, ...(options.readOnly === true ? { readOnly: true } : {}) })
        : null;
  if (taskOutcome === null) return error("internal_error", "no task input");
  if (!taskOutcome.ok) {
    // A task file's own fields are "task"; limits bounded by the config file and the quick form are "config".
    const file: InputDiagnosticFile = taskFile !== null && taskOutcome.code === "invalid_task" ? "task" : "config";
    const failed = error(taskOutcome.code, taskOutcome.message, positionDiagnostic(file, taskOutcome.position));
    // U-177: a parser's hint (a task file's plan "run") makes the human error say why.
    if (taskOutcome.hint !== undefined) return withHint(failed, taskOutcome.hint);
    // U-115 (UXM-9, U-37): the quick form's settings were missing because there is no config file
    // yet; the person is told so (codaryn init). The message, the code and the exit code are as before.
    return noConfigYet && taskFile === null && configFile === null && taskOutcome.code === "invalid_config" ? withHint(failed, "config_missing") : failed;
  }

  // Where each secret name came from, for S-3 messages that give a position, never a name.
  const secretSources: { readonly name: string; readonly field: string; readonly index: number }[] = [];
  const ownField = taskFile !== null ? "privacy.secretEnv" : "secretEnv";
  taskOutcome.task.privacy.secretEnv.forEach((name, index) => secretSources.push({ name, field: ownField, index }));
  if (taskFile !== null) {
    (config?.secretEnv ?? []).forEach((name, index) => {
      if (!secretSources.some((source) => source.name === name)) secretSources.push({ name, field: "secretEnv", index });
    });
  }
  // G-A: resolve the workflow settings under the definition's ceilings (resolveWorkflow).
  const parsed = taskOutcome.task;
  const resolved = resolveWorkflow({
    definitions,
    task: {
      ...(parsed.workflowRef === undefined ? {} : { workflowRef: parsed.workflowRef }),
      ...(parsed.tools === undefined ? {} : { tools: parsed.tools }),
      ...(parsed.plan === undefined ? {} : { plan: parsed.plan }),
      ...(parsed.completion === undefined ? {} : { completion: parsed.completion }),
      ...(parsed.humanReview === undefined ? {} : { humanReview: parsed.humanReview }),
    },
    profileWorkflowRef,
    commandRules: parsed.policy.commands.length,
  });
  if (!resolved.ok) {
    const fromConfig = taskFile === null || resolved.field.startsWith("profiles") || resolved.field.startsWith("workflows");
    const file: InputDiagnosticFile = fromConfig ? "config" : "task";
    const workflowError = error(
      fromConfig ? "invalid_config" : "invalid_task",
      `${resolved.field} ${resolved.problem === "plan_weakened" ? planWeakenedText(parsed.plan, definition?.plan) : WORKFLOW_PROBLEM_TEXT[resolved.problem]}`,
      positionDiagnostic(file, { code: "invalid_value", field: resolved.field }),
    );
    // U-37: a task type neither built in nor in the config's workflows.
    return resolved.problem === "unknown_workflow" ? withHint(workflowError, "task_type_not_found") : workflowError;
  }
  // DR-41 (PM after 27afb01): where a definition applies its rules are not loosened. A task file's
  // own policy is merged with them here (resolveWorkflow above counted its own command rules first,
  // GT-D10); the quick form's was merged in underDefinition. What the merge left out is recorded.
  // DR-43 (a), R-31 L-2: likewise its verifiers: the definition's always run, the given ones added.
  const givenPolicy = taskFile !== null ? parsed.policy : config?.policy;
  const givenVerifiers = taskFile !== null ? parsed.verifiers : config?.verifiers;
  const policyNarrowings =
    definition === undefined
      ? []
      : [...workflowPolicyNarrowings(definition.policy, givenPolicy), ...workflowVerifierNarrowings(definition.verifiers, givenVerifiers)];
  const mergeHere = taskFile !== null && definition !== undefined;
  const mergedPolicy = mergeHere ? (mergeWorkflowPolicy(definition.policy, parsed.policy) ?? parsed.policy) : parsed.policy;
  const mergedVerifiers = mergeHere ? (mergeWorkflowVerifiers(definition.verifiers, parsed.verifiers) ?? parsed.verifiers) : parsed.verifiers;
  // U-182 (DR-69 B-4): every source's writable list, each its own (the gate needs all to cover a
  // write); none when no source states one, so a run without them is as before.
  const writablePathSets = writablePathSetsOf({ config: fileConfig, profile: args.profile, definition, taskFilePolicy: taskFile !== null ? parsed.policy : null });
  const task = withConfigSecrets(
    {
      ...withWorkflow({ ...parsed, policy: mergedPolicy, verifiers: mergedVerifiers }, resolved.workflowRef, resolved.settings),
      ...(policyNarrowings.length === 0 ? {} : { policyNarrowings }),
      ...(writablePathSets.length === 0 ? {} : { writablePathSets }),
    },
    config,
  );

  // 6. The workspace, and S-1: no file that shapes this or a later run may lie inside it.
  if (!(await io.isDirectory(task.workspaceRoot))) {
    return error("workspace_not_found", "workspaceRoot is not an existing directory");
  }
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
  // U-37: the last element, whether the error gets input_inside_workspace. R-69 L1, R-69b L1 (PM):
  // not the script file and the cancel file, which the hint (task, config or variables file) does not name.
  const located: [string | null, CliErrorCode, string, boolean][] = [
    [envPath, "invalid_config", "the file given by --vars-file", true],
    [configFile?.path ?? null, "invalid_config", "the config file", true],
    [taskFile?.path ?? null, "invalid_task", "the task file", true],
    [task.model.provider === "scripted" ? task.model.scriptPath : null, "invalid_script", "the script file", false],
    // T-12: a cancel file inside the workspace could be created by the run itself.
    [args.cancelFile === null ? null : path.resolve(io.cwd, args.cancelFile), "invalid_arguments", "the file given by --cancel-file", false],
  ];
  for (const [file, code, label, inputHint] of located) {
    if (file === null) continue;
    const where = await io.locateInWorkspace(file, task.workspaceRoot);
    if (where !== "outside") {
      const inside = error(code, `${label} is inside the workspace or its location cannot be confirmed; keep it outside so a run cannot change it`);
      return inputHint ? withHint(inside, "input_inside_workspace") : inside;
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
  for (const source of options.secrets === false ? [] : secretSources) {
    const value = io.env[source.name];
    if (value === undefined || value.length === 0) {
      return error("secret_env_missing", secretEnvNotSetMessage(source.field, source.index));
    }
    addSecret(value);
  }
  // S-2, SP-2, DR-34 (b): the run's own key, and every other known key from 20 characters, are
  // masked whatever the provider (a scripted task can still read a file that holds one). A short
  // placeholder in a key variable the run does not use is left alone (review R-20 M-2).
  runKeySecrets(io.env, task.model.provider).forEach(addSecret);
  // S-4: what the env file set, so a value read back from a file or an output is masked too.
  envSecrets.forEach(addSecret);

  return { prepared: { task, config, secrets, integrityPaths, defaultDisplay } };
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
 * Steps 8 on (the model, the assembly, the engine, the end summary) for a prepared task. `run` gives
 * no `approved`. U-195: `codaryn apply` gives the approved `run` plan it checked: the assembly then
 * claims that plan run (AssemblyInput.planRunId) and the engine's runApprovedPlan carries it out
 * (EngineResult with planRunId and planDigest); the rest (progress lines, end summary, result.json)
 * is a run's.
 */
export async function runPrepared(io: CliEnvironment, args: RunArgs, notes: RunNotes, prepared: PreparedTask, approved?: ApprovedRunPlan): Promise<CliRunOutcome> {
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
    // U-18: the calls allowed and then failed, counted as the records are written.
    const failed = createFailedCalls();
    const watched: Journal = {
      async append(event) {
        await recorded.append(event);
        if (failed.observe(event)) notes.failedToolCalls += 1;
        if (event.type === "tool_decision" && !event.allowed) {
          notes.deniedToolCalls += 1;
          if (event.permission === "command") notes.deniedCommandCalls += 1;
          if (event.code === "path_not_writable") notes.deniedNotWritable = (notes.deniedNotWritable ?? 0) + 1;
        }
        if (event.type === "confirmation_answered" && event.decision === "deny" && (event.by === "user" || event.by === "default" || event.by === "cancelled")) {
          const denied = (notes.confirmationDenied ??= { user: 0, default: 0, cancelled: 0 });
          denied[event.by] += 1;
        }
        // U-148 (U-140, UXM-18): the end summary repeats what run_started recorded as left out.
        if (event.type === "run_started" && event.policyNarrowings !== undefined && event.policyNarrowings.length > 0) {
          notes.policyNarrowings = event.policyNarrowings;
        }
      },
      close: () => recorded.close(),
    };
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
              await progressed.append(event);
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
      // line only; the result is unchanged.
      const notWritable = notes.deniedNotWritable ?? 0;
      if (write !== undefined && notWritable > 0) {
        writeMasked(write, privacy, human === undefined ? notWritableHint(notWritable) : human.messages.format("progress.not_writable_hint", { count: notWritable }));
      }
      result = defaultDisplay === null ? hinted : withNotice(hinted, privacy, defaultConfigNotice(defaultDisplay));
    } finally {
      // Releases the workspace lock even when the run threw.
      await assembled.finish(result);
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
