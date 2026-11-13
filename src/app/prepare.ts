/**
 * U-287 (CLI migration C-5; plan docs/reviews/2026-11-13-cli-migration-plan.md): the run's steps 1 to 7,
 * the app layer's now. prepareTask reads the arguments, the variables file, the key, the config and task
 * files, validates them, checks the workspace and the files' places, and registers the secrets (DR-17:
 * run, plan, apply, review and the app's reading of settings share it), in the order of src/cli/run.ts's
 * head comment; with the error outcomes it and the CLI's commands make. The text below is as it was in
 * src/cli/run.ts (RunArgs in src/cli/args.ts), but for: readText, parseJson and scrub are exported (the
 * run's step 8 on, in run.ts until C-6a, uses them, and error as cliError); readText takes
 * PrepareEnvironment's readFile; and PrepareEnvironment is an interface with the fields of CliEnvironment
 * it named, their comments as they were, which CliEnvironment extends. The CLI's old places re-export
 * these names (plan A).
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
  privateDataProblem,
  toSchemaFieldPath,
  workflowPolicyNarrowings,
  workflowVerifierNarrowings,
} from "../contracts/index.js";
import type {
  CliErrorCode,
  CliErrorHint,
  CliErrorHintDetail,
  CliErrorOutput,
  CliOutput,
  CodarynConfig,
  DefaultConfigDisplay,
  DefaultConfigLocation,
  DetailedCliErrorHint,
  InputDiagnostic,
  InputDiagnosticFile,
  MessageLanguage,
  ResolvedTaskSpec,
  PlanMode,
  PolicyConfig,
  PolicyNarrowing,
  RunSummaryContext,
  ShownWorkspace,
  VerifierConfig,
  WorkflowDefinition,
  WorkflowProblem,
  WorkflowSettings,
} from "../contracts/index.js";
import { resolveWorkflow, workflowDefinitions } from "../workflows/index.js";
import { parseConfig } from "./input/config.js";
import { chooseConfigFile, isMissingFile, selectProfile } from "./input/config-file.js";
import { jsonSyntaxPosition } from "./input/json-position.js";
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
} from "./input/security/index.js";
import type { PathRelation, WorkspaceLocation } from "./input/security/index.js";
import { SETTINGS_MISSING, knownKeyEntries, knownKeyValues, runKeySecrets } from "./input/settings.js";
import type { SettingsEnvironment, SettingsFailure } from "./input/settings.js";
import { buildQuickTask, localPathProblem, parseTask, withConfigSecrets } from "./input/task.js";
import type { InputErrorPosition } from "./input/task.js";
import { writablePathSetsOf } from "./input/writable.js";
import { UNREADABLE_PATHS_REQUIRED_TEXT, runMinGroupSize, runUnreadablePaths } from "./input/unreadable.js";

/**
 * Where the task comes from: a task file, or the quick form built from the config file.
 * `oneLine` (N-9): the goal was given as the positional argument and `workspace` is the current
 * directory (".").
 */
export type RunInput =
  | { readonly kind: "task"; readonly taskPath: string }
  | { readonly kind: "quick"; readonly workspace: string; readonly goal: string; readonly oneLine: boolean };

export interface RunArgs {
  readonly command: "run";
  readonly input: RunInput;
  /** `--config`. When null, CODARYN_CONFIG may name the file. */
  readonly configPath: string | null;
  /** `--vars-file`: variables to load. Read only when given (C-2, T-15). */
  readonly varsFile: string | null;
  readonly cancelFile: string | null;
  /** `--quiet` (U-8, N-5): no human-readable output on stderr. */
  readonly quiet: boolean;
  /** `--profile` (N-8): a profile name from the config file. */
  readonly profile: string | null;
  /** `--workflow` (G-A, DR-2): the quick form's workflow definition id. Absent for a task file. */
  readonly workflow: string | null;
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
  /**
   * U-182 (DR-69 B-4): the denied writes outside the writable lists (path_not_writable); absent is 0.
   * U-195 (Codex V-14 L-1, U-198): in a run that does not carry out a plan.
   */
  deniedNotWritable?: number;
  /** U-195 (Codex V-14 L-1, U-198): such writes in a run that carries out a plan (outside its files); absent is 0. */
  deniedNotPlanned?: number;
  /** U-220 (U-176, U-201): the run's workspace lock could not be released at its end (finish said so). */
  lockLeft?: boolean;
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
  /** U-210 (U-207, R-8): the denied calls whose code is `unreadable_path`; absent while there is none. */
  deniedUnreadable?: number;
  /** U-210 (U-207, DR-70): query_table results that hid groups, and the largest k they applied; absent while there is none. */
  hiddenGroups?: { results: number; minGroupSize: number };
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

/** G-A: what each workflow problem means, after the field position (never a value). */
/** U-228: what a workflow problem means after its field (doctor tells plan_tool_missing with it). */
export function workflowProblemText(problem: WorkflowProblem): string {
  return WORKFLOW_PROBLEM_TEXT[problem];
}

const WORKFLOW_PROBLEM_TEXT: { readonly [P in WorkflowProblem]: string } = {
  unknown_workflow: "names no built-in workflow and no workflows entry of the config file",
  tool_not_allowed: "names a tool the workflow definition does not offer (tools only narrow)",
  plan_weakened: 'cannot be "none" under a workflow with plan "apply"',
  // U-224 (p4g; one line in this file for the contract's new problem).
  plan_tool_missing: 'leaves out the plan tool of the plan mode: "apply" needs propose_plan and "run" needs propose_changes among the tools',
  commands_not_allowed: "must be empty: the workflow allows no command",
  review_without_checklist: 'is required with completion "human_review"',
  checklist_without_review: 'is only allowed with completion "human_review"',
  instructions_too_long: "is longer than the limit",
  checklist_too_long: "must have 1 to the maximum number of non-blank lines within the length limit",
  // U-210 (bundle A, R-5, P-1): a command rule (a command verifier's text is unreadableWithCommandsText's).
  unreadable_with_commands: "must be empty while unreadablePaths is set: a command can read any file, the ones kept from the agent too",
  unreadable_paths_required: UNREADABLE_PATHS_REQUIRED_TEXT,
};

/**
 * U-210 (bundle A, R-5): why a command rule or a `command` verifier is refused beside unreadable
 * paths, by the field that holds it. A command can read any file, the unreadable ones too, and a
 * command verifier's output goes to the model in a repair.
 */
function unreadableWithCommandsText(field: string): string {
  return field.endsWith("policy.commands")
    ? WORKFLOW_PROBLEM_TEXT.unreadable_with_commands
    : "cannot be a command verifier while unreadablePaths is set: a command can read any file, and its output goes to the model";
}

/**
 * U-210 (bundle A, R-5; privateDataProblem): with any unreadable path in the run, the first command
 * rule or `command` verifier, where it was written: the task type definition's own (the config
 * file's `workflows`), then the given ones (the task file's, else the config's or the profile's),
 * then, failing closed, the merged ones the run would use. Null when none is there or no path is
 * unreadable.
 */
function unreadableWithCommands(
  unreadablePaths: readonly string[],
  definition: WorkflowDefinition | undefined,
  given: { readonly policy: Pick<PolicyConfig, "commands"> | undefined; readonly verifiers: readonly VerifierConfig[] | undefined; readonly file: "task" | "config" },
  merged: { readonly policy: Pick<PolicyConfig, "commands">; readonly verifiers: readonly VerifierConfig[] },
): { output: CliErrorOutput; exitCode: number } | null {
  const places: [string, "task" | "config", Pick<PolicyConfig, "commands">, readonly VerifierConfig[]][] = [
    ["workflows.", "config", definition?.policy ?? { commands: [] }, definition?.verifiers ?? []],
    ["", given.file, given.policy ?? { commands: [] }, given.verifiers ?? []],
    ["", given.file, merged.policy, merged.verifiers],
  ];
  for (const [prefix, file, policy, verifiers] of places) {
    const found = privateDataProblem(unreadablePaths, policy, verifiers);
    if (found === null) continue;
    const field = `${prefix}${found.field}`;
    return error(file === "task" ? "invalid_task" : "invalid_config", `${field} ${unreadableWithCommandsText(field)}`, positionDiagnostic(file, { code: "invalid_value", field }));
  }
  return null;
}

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

/** Task, config and script files may start with a UTF-8 byte order mark (common on Windows). */
export async function readText(io: Pick<PrepareEnvironment, "readFile">, file: string): Promise<string | null> {
  try {
    return (await io.readFile(file)).replace(/^﻿/, "");
  } catch {
    return null;
  }
}

export function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Removes secret values from a message before it is printed. */
export function scrub(message: string, secrets: readonly string[]): string {
  return secrets.reduce((text, secret) => text.split(secret).join("[secret]"), message);
}

/** A file read before the run, with where it came from and the error code that belongs to it. */
interface InputFile {
  readonly label: string;
  readonly path: string;
  readonly code: "invalid_config" | "invalid_task";
  readonly text: string;
  value?: unknown;
}

/** What `prepareTask` reads besides the arguments: the parts of CliEnvironment steps 1 to 7 use. */
export interface PrepareEnvironment {
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
  /**
   * U-3: the running CLI's package root (`findInstall` in the real CLI, which always sets it).
   * Undefined: not checked (in-process tests). Null: it could not be found, so every run is refused.
   */
  readonly installDir?: string | null;
  /** U-1, U-3: real path relation (`relateRealPaths` when absent). */
  readonly relatePaths?: (target: string, base: string) => Promise<PathRelation>;
  /**
   * N-1: the default config location (`findDefaultConfigLocation` in the real CLI), read when
   * neither `--config` nor CODARYN_CONFIG is given and a file exists there. Absent or null: none.
   */
  readonly defaultConfig?: DefaultConfigLocation | null;
}

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
  // U-210 (bundle A, A-6; R-2, Q-4, R-102 M-1): the run's unreadable paths, every source's united (the
  // config file's also under a task file and a profile), and its k, the largest a source states (never
  // below 5). Neither field when no source states one, so a run without them is as before. P-1: the
  // resolution needs the list (analyze-private).
  const runSources = { config: fileConfig, profile: args.profile, definition, taskFilePolicy: taskFile !== null ? parsed.policy : null };
  const unreadablePaths = runUnreadablePaths(runSources);
  const minGroupSize = runMinGroupSize(runSources);
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
    unreadablePaths,
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
    if (resolved.problem === "unknown_workflow") return withHint(workflowError, "task_type_not_found");
    // U-228 (U-224): which plan tool each plan mode needs, in the chosen language.
    if (resolved.problem === "plan_tool_missing") return withHint(workflowError, "plan_tool_missing");
    // U-210 (R-110 M-1): bundle A's reasons, in the chosen language. A task type that allows no command
    // refuses the task's own rule as commands_not_allowed; with unreadable paths in the run it is also
    // the reason unreadable_with_commands gives (organize without them: no hint, as before).
    if (resolved.problem === "unreadable_paths_required") return withHint(workflowError, "unreadable_paths_required");
    if (resolved.problem === "commands_not_allowed" && unreadablePaths.length > 0) return withHint(workflowError, "unreadable_with_commands");
    return workflowError;
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
  // U-210 (R-5): with the run's unreadable paths (above) no command rule and no command verifier,
  // refused before anything is recorded.
  const commandsRefused = unreadableWithCommands(
    unreadablePaths,
    definition,
    taskFile !== null
      ? { policy: parsed.policy, verifiers: parsed.verifiers, file: "task" }
      : { policy: config?.policy, verifiers: config?.verifiers, file: "config" },
    { policy: mergedPolicy, verifiers: mergedVerifiers },
  );
  // R-110 M-1: the reason in the chosen language.
  if (commandsRefused !== null) return withHint(commandsRefused, "unreadable_with_commands");
  const task = withConfigSecrets(
    {
      ...withWorkflow({ ...parsed, policy: mergedPolicy, verifiers: mergedVerifiers }, resolved.workflowRef, resolved.settings),
      ...(policyNarrowings.length === 0 ? {} : { policyNarrowings }),
      ...(writablePathSets.length === 0 ? {} : { writablePathSets }),
      ...(unreadablePaths.length === 0 ? {} : { unreadablePaths }),
      ...(minGroupSize === undefined ? {} : { minGroupSize }),
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
