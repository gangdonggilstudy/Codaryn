/**
 * Command line parsing for `codaryn run`, `revert`, `report`, `doctor`, `models`, `init` and `runs`.
 *
 *   codaryn run "<goal>" [options]                      (N-9: the current directory is the workspace)
 *   codaryn run --task <task.json> [options]
 *   codaryn run --workspace <dir> --goal <text> [options]
 *   options: --config <config.json>  --vars-file <path>  --cancel-file <path>  --quiet  --profile <name>
 *   codaryn revert --workspace <dir> --run <runId|latest> [--dry-run] [--quiet]
 *   codaryn report --workspace <dir> --run <runId|latest> [--json]
 *   codaryn doctor [--config <config.json>] [--vars-file <path>] [--task <task.json> | --workspace <dir>] [--profile <name>] [--json]
 *   codaryn models [--config <config.json>] [--vars-file <path>] [--json] [--use <number|id>]
 *   codaryn init [--config <config.json>] [--workspace <dir>] [--json]
 *   codaryn runs [--workspace <dir>] [--limit <n>] [--json]
 *
 * Options take one value, which must not be empty or start with "--". Switches take none.
 * Each may appear once. Only `run` takes a positional argument (the goal), at most one.
 */

import { LATEST_RUN_ALIAS, MAX_REVIEW_NOTE_CHARS, MIN_PLAN_DIGEST_PREFIX, PROFILE_NAME_PATTERN_SOURCE, WORKFLOW_ID_PATTERN_SOURCE } from "../contracts/index.js";

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

export type ParseArgsOutcome =
  | { readonly ok: true; readonly args: RunArgs }
  | { readonly ok: false; readonly message: string };

export const RUN_USAGE =
  'codaryn run ("<goal>" | --task <task.json> | --workspace <dir> --goal <text>) ' +
  "[--config <config.json>] [--vars-file <path>] [--cancel-file <path>] [--quiet] [--profile <name>] [--workflow <id>]";
export const REVERT_USAGE = "codaryn revert --workspace <dir> --run <runId|latest> [--dry-run] [--quiet]";
export const REPORT_USAGE = "codaryn report --workspace <dir> --run <runId|latest> [--json]";
export const DOCTOR_USAGE =
  "codaryn doctor [--config <config.json>] [--vars-file <path>] [--task <task.json> | --workspace <dir>] [--profile <name>] [--json]";

export const MODELS_USAGE = "codaryn models [--config <config.json>] [--vars-file <path>] [--json] [--use <number|id>]";
export const INIT_USAGE = "codaryn init [--config <config.json>] [--workspace <dir>] [--json]";
/** The same text as `RUNS_USAGE` in src/cli/runs.ts, which parses `runs` (N-22); kept here for USAGE. */
export const RUNS_USAGE = "codaryn runs [--workspace <dir>] [--limit <n>] [--json]";

export const USAGE =
  `usage: ${RUN_USAGE} | ${REVERT_USAGE} | ${REPORT_USAGE} | ${DOCTOR_USAGE} | ${MODELS_USAGE} | ` +
  `${INIT_USAGE} | ${RUNS_USAGE} | codaryn plan|apply|review ... | codaryn --help | codaryn --version`;

const OPTIONS = ["--task", "--workspace", "--goal", "--config", "--vars-file", "--cancel-file", "--profile", "--workflow"] as const;
type Option = (typeof OPTIONS)[number];
const SWITCHES = ["--quiet"] as const;
type Switch = (typeof SWITCHES)[number];

/**
 * T-15, V-3: Node 26 reads `--env-file` and `--env-file-if-exists` itself, even after the script
 * name: a missing `--env-file` ends the process (exit 9), `--env-file-if-exists` notes a missing
 * file on stderr, and either path is opened before codaryn can check it. codaryn refuses both
 * names in every command, with this hint; it cannot stop Node's own access.
 */
export const ENV_FILE_REFUSED_MESSAGE =
  "--env-file and --env-file-if-exists are not codaryn options: Node reads those names itself before codaryn starts. Use --vars-file <path>";

/** `--env-file`, `--env-file-if-exists`, alone or with `=value`. No value can start with "--". */
const NODE_ENV_FILE_FLAG = /^--env-file(-if-exists)?(=|$)/;

const REVERT_OPTIONS = ["--workspace", "--run"] as const;
type RevertOption = (typeof REVERT_OPTIONS)[number];
const REVERT_SWITCHES = ["--dry-run", "--quiet"] as const;
type RevertSwitch = (typeof REVERT_SWITCHES)[number];

const REPORT_OPTIONS = ["--workspace", "--run"] as const;
type ReportOption = (typeof REPORT_OPTIONS)[number];
const DOCTOR_OPTIONS = ["--config", "--vars-file", "--task", "--workspace", "--profile"] as const;
type DoctorOption = (typeof DOCTOR_OPTIONS)[number];
const JSON_SWITCH = ["--json"] as const;
type JsonSwitch = (typeof JSON_SWITCH)[number];

/** Same rule as the run directory names the store accepts. */
export const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const RUN_ID_MESSAGE = `--run must be a run id (1-128 characters of letters, digits, '.', '_' and '-') or "${LATEST_RUN_ALIAS}"`;

const PROFILE_NAME = new RegExp(PROFILE_NAME_PATTERN_SOURCE);
const WORKFLOW_ID = new RegExp(WORKFLOW_ID_PATTERN_SOURCE);

/** G-A (DR-2): `--workflow <id>`, quick form only. */
export function workflowOf(
  values: ReadonlyMap<string, string>,
  input: RunInput,
): { ok: true; workflow: string | null } | { ok: false; message: string } {
  const workflow = values.get("--workflow") ?? null;
  if (workflow === null) return { ok: true, workflow };
  if (!WORKFLOW_ID.test(workflow)) {
    return { ok: false, message: "--workflow must be a workflow id: 1-64 letters, digits, '.', '_' and '-', starting with a letter or digit" };
  }
  if (input.kind === "task") return { ok: false, message: "--workflow is for the quick form; a task file names its workflow with workflowRef" };
  return { ok: true, workflow };
}
const PROFILE_MESSAGE = "--profile must be a profile name: 1-64 letters, digits, '.', '_' and '-', starting with a letter or digit";

function isRunId(value: string): boolean {
  return RUN_ID_PATTERN.test(value) && !value.includes("..");
}

type ReadOutcome<O extends string, S extends string> =
  | { ok: true; values: Map<O, string>; switches: Set<S>; positionals: string[] }
  | { ok: false; message: string };

/**
 * Reads `--option value` pairs and bare switches. Each at most once, every value non-empty and not
 * a flag. With `positional`, a token that does not start with "--" and is not an option's value
 * is collected as a positional argument; without it, such a token is an error.
 */
function readOptions<O extends string, S extends string = never>(
  rest: readonly string[],
  allowed: readonly O[],
  usage: string,
  switches: readonly S[] = [],
  positional = false,
): ReadOutcome<O, S> {
  const values = new Map<O, string>();
  const seen = new Set<S>();
  const positionals: string[] = [];
  let index = 0;
  while (index < rest.length) {
    const flag = rest[index] as string;
    if (positional && !flag.startsWith("--")) {
      positionals.push(flag);
      index += 1;
      continue;
    }
    if ((switches as readonly string[]).includes(flag)) {
      if (seen.has(flag as S)) return { ok: false, message: `unknown or repeated option. ${usage}` };
      seen.add(flag as S);
      index += 1;
      continue;
    }
    const value = rest[index + 1];
    if (!(allowed as readonly string[]).includes(flag) || values.has(flag as O)) {
      return { ok: false, message: `unknown or repeated option. ${usage}` };
    }
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      return { ok: false, message: `${flag} needs a value. ${usage}` };
    }
    values.set(flag as O, value);
    index += 2;
  }
  return { ok: true, values, switches: seen, positionals };
}

function profileOf(values: ReadonlyMap<string, string>): { ok: true; profile: string | null } | { ok: false; message: string } {
  const profile = values.get("--profile") ?? null;
  if (profile !== null && !PROFILE_NAME.test(profile)) return { ok: false, message: PROFILE_MESSAGE };
  return { ok: true, profile };
}

export interface RevertArgs {
  readonly command: "revert";
  readonly workspace: string;
  /** A run id, or LATEST_RUN_ALIAS (N-7). */
  readonly runId: string;
  /** `--dry-run` (N-7): decide and report, change nothing. */
  readonly dryRun: boolean;
  /** `--quiet` (N-5): no human-readable output on stderr. */
  readonly quiet: boolean;
}

export type ParseRevertArgsOutcome =
  | { readonly ok: true; readonly args: RevertArgs }
  | { readonly ok: false; readonly message: string };

/** `codaryn revert --workspace <dir> --run <runId|latest> [--dry-run] [--quiet]`. Both options are required. */
export function parseRevertArgs(argv: readonly string[]): ParseRevertArgsOutcome {
  const [command, ...rest] = argv;
  if (command !== "revert") return { ok: false, message: USAGE };
  if (rest.some(isEnvFileFlag)) return { ok: false, message: ENV_FILE_REFUSED_MESSAGE };
  const read = readOptions<RevertOption, RevertSwitch>(rest, REVERT_OPTIONS, USAGE, REVERT_SWITCHES);
  if (!read.ok) return read;
  const workspace = read.values.get("--workspace");
  const runId = read.values.get("--run");
  if (workspace === undefined || runId === undefined) {
    return { ok: false, message: `--workspace and --run are required. usage: ${REVERT_USAGE}` };
  }
  if (!isRunId(runId)) return { ok: false, message: RUN_ID_MESSAGE };
  return {
    ok: true,
    args: { command: "revert", workspace, runId, dryRun: read.switches.has("--dry-run"), quiet: read.switches.has("--quiet") },
  };
}

export interface ReportArgs {
  readonly command: "report";
  readonly workspace: string;
  readonly runId: string;
  /** `--json`: print ReportOutput as one JSON line instead of Markdown. */
  readonly json: boolean;
}

export type ParseReportArgsOutcome =
  | { readonly ok: true; readonly args: ReportArgs }
  | { readonly ok: false; readonly message: string };

/** `codaryn report --workspace <dir> --run <runId> [--json]` (U-5). */
export function parseReportArgs(argv: readonly string[]): ParseReportArgsOutcome {
  const [command, ...rest] = argv;
  if (command !== "report") return { ok: false, message: USAGE };
  if (rest.some(isEnvFileFlag)) return { ok: false, message: ENV_FILE_REFUSED_MESSAGE };
  const read = readOptions<ReportOption, JsonSwitch>(rest, REPORT_OPTIONS, `usage: ${REPORT_USAGE}`, JSON_SWITCH);
  if (!read.ok) return read;
  const workspace = read.values.get("--workspace");
  const runId = read.values.get("--run");
  if (workspace === undefined || runId === undefined) {
    return { ok: false, message: `--workspace and --run are required. usage: ${REPORT_USAGE}` };
  }
  if (!isRunId(runId)) return { ok: false, message: RUN_ID_MESSAGE };
  return { ok: true, args: { command: "report", workspace, runId, json: read.switches.has("--json") } };
}

export interface DoctorArgs {
  readonly command: "doctor";
  readonly configPath: string | null;
  readonly varsFile: string | null;
  readonly taskPath: string | null;
  readonly workspace: string | null;
  /** `--profile` (N-8). */
  readonly profile: string | null;
  readonly json: boolean;
}

export type ParseDoctorArgsOutcome =
  | { readonly ok: true; readonly args: DoctorArgs }
  | { readonly ok: false; readonly message: string };

/** `codaryn doctor [...]` (U-6). Every option is optional; `--task` and `--workspace` exclude each other. */
export function parseDoctorArgs(argv: readonly string[]): ParseDoctorArgsOutcome {
  const [command, ...rest] = argv;
  if (command !== "doctor") return { ok: false, message: USAGE };
  if (rest.some(isEnvFileFlag)) return { ok: false, message: ENV_FILE_REFUSED_MESSAGE };
  const read = readOptions<DoctorOption, JsonSwitch>(rest, DOCTOR_OPTIONS, `usage: ${DOCTOR_USAGE}`, JSON_SWITCH);
  if (!read.ok) return read;
  const taskPath = read.values.get("--task") ?? null;
  const workspace = read.values.get("--workspace") ?? null;
  if (taskPath !== null && workspace !== null) {
    return { ok: false, message: `--task names its own workspace and cannot be combined with --workspace. usage: ${DOCTOR_USAGE}` };
  }
  const profile = profileOf(read.values);
  if (!profile.ok) return profile;
  return {
    ok: true,
    args: {
      command: "doctor",
      configPath: read.values.get("--config") ?? null,
      varsFile: read.values.get("--vars-file") ?? null,
      taskPath,
      workspace,
      profile: profile.profile,
      json: read.switches.has("--json"),
    },
  };
}

const MODELS_OPTIONS = ["--config", "--vars-file", "--use"] as const;
type ModelsOption = (typeof MODELS_OPTIONS)[number];

export interface ModelsArgs {
  readonly command: "models";
  readonly configPath: string | null;
  readonly varsFile: string | null;
  /** `--use`: a 1-based number from the list or a listed model id. */
  readonly use: string | null;
  readonly json: boolean;
}

export type ParseModelsArgsOutcome =
  | { readonly ok: true; readonly args: ModelsArgs }
  | { readonly ok: false; readonly message: string };

/** `codaryn models [--config <file>] [--vars-file <path>] [--json] [--use <number|id>]` (Y-1). */
export function parseModelsArgs(argv: readonly string[]): ParseModelsArgsOutcome {
  const [command, ...rest] = argv;
  if (command !== "models") return { ok: false, message: USAGE };
  if (rest.some(isEnvFileFlag)) return { ok: false, message: ENV_FILE_REFUSED_MESSAGE };
  const read = readOptions<ModelsOption, JsonSwitch>(rest, MODELS_OPTIONS, `usage: ${MODELS_USAGE}`, JSON_SWITCH);
  if (!read.ok) return read;
  return {
    ok: true,
    args: {
      command: "models",
      configPath: read.values.get("--config") ?? null,
      varsFile: read.values.get("--vars-file") ?? null,
      use: read.values.get("--use") ?? null,
      json: read.switches.has("--json"),
    },
  };
}

const INIT_OPTIONS = ["--config", "--workspace"] as const;
type InitOption = (typeof INIT_OPTIONS)[number];

export interface InitArgs {
  readonly command: "init";
  /** `--config`: write there instead of the default location. */
  readonly configPath: string | null;
  /** `--workspace`: where command and protected path suggestions come from (N-2). */
  readonly workspace: string | null;
  readonly json: boolean;
}

export type ParseInitArgsOutcome =
  | { readonly ok: true; readonly args: InitArgs }
  | { readonly ok: false; readonly message: string };

/** `codaryn init [--config <file>] [--workspace <dir>] [--json]` (N-2). */
export function parseInitArgs(argv: readonly string[]): ParseInitArgsOutcome {
  const [command, ...rest] = argv;
  if (command !== "init") return { ok: false, message: USAGE };
  if (rest.some(isEnvFileFlag)) return { ok: false, message: ENV_FILE_REFUSED_MESSAGE };
  const read = readOptions<InitOption, JsonSwitch>(rest, INIT_OPTIONS, `usage: ${INIT_USAGE}`, JSON_SWITCH);
  if (!read.ok) return read;
  return {
    ok: true,
    args: {
      command: "init",
      configPath: read.values.get("--config") ?? null,
      workspace: read.values.get("--workspace") ?? null,
      json: read.switches.has("--json"),
    },
  };
}

/**
 * G-F (DR-17): the task form `plan`, `apply` and `review` share with `run`: `--task <file>`, or
 * `--workspace <dir>` with `--profile` and `--workflow`; and `--config`, `--vars-file`.
 * There is no goal: these commands do not run a model.
 */
export interface TaskFormArgs {
  readonly input: { readonly kind: "task"; readonly taskPath: string } | { readonly kind: "quick"; readonly workspace: string };
  readonly configPath: string | null;
  readonly varsFile: string | null;
  readonly profile: string | null;
  readonly workflow: string | null;
}

const TASK_FORM_OPTIONS = ["--task", "--workspace", "--config", "--vars-file", "--profile", "--workflow"] as const;
export const TASK_FORM_USAGE = "(--task <task.json> | --workspace <dir> [--profile <name>] [--workflow <id>]) [--config <config.json>] [--vars-file <path>]";
export const PLAN_USAGE = `codaryn plan ${TASK_FORM_USAGE} --run <runId|latest> [--json]`;
export const APPLY_USAGE = `codaryn apply ${TASK_FORM_USAGE} --run <runId> --digest <first 12+ hex> [--cancel-file <path>] [--quiet]`;
export const REVIEW_USAGE = `codaryn review ${TASK_FORM_USAGE} --run <runId|latest> (--accept | --reject) [--note <text>] [--json]`;

function taskFormOf(values: ReadonlyMap<string, string>, usage: string): { ok: true; form: TaskFormArgs } | { ok: false; message: string } {
  const taskPath = values.get("--task");
  const workspace = values.get("--workspace");
  if ((taskPath === undefined) === (workspace === undefined)) {
    return { ok: false, message: `give --task or --workspace, not both. usage: ${usage}` };
  }
  const input: TaskFormArgs["input"] = taskPath !== undefined ? { kind: "task", taskPath } : { kind: "quick", workspace: workspace as string };
  const profile = profileOf(values);
  if (!profile.ok) return profile;
  const workflow = workflowOf(values, input.kind === "task" ? input : { kind: "quick", workspace: input.workspace, goal: "-", oneLine: false });
  if (!workflow.ok) return workflow;
  return {
    ok: true,
    form: { input, configPath: values.get("--config") ?? null, varsFile: values.get("--vars-file") ?? null, profile: profile.profile, workflow: workflow.workflow },
  };
}

export interface PlanArgs {
  readonly command: "plan";
  readonly form: TaskFormArgs;
  /** A run id, or LATEST_RUN_ALIAS. */
  readonly runId: string;
  readonly json: boolean;
}

/** `codaryn plan ...` (DR-17). */
export function parsePlanArgs(argv: readonly string[]): { readonly ok: true; readonly args: PlanArgs } | { readonly ok: false; readonly message: string } {
  const [command, ...rest] = argv;
  if (command !== "plan") return { ok: false, message: USAGE };
  if (rest.some(isEnvFileFlag)) return { ok: false, message: ENV_FILE_REFUSED_MESSAGE };
  const read = readOptions<(typeof TASK_FORM_OPTIONS)[number] | "--run", JsonSwitch>(rest, [...TASK_FORM_OPTIONS, "--run"], `usage: ${PLAN_USAGE}`, JSON_SWITCH);
  if (!read.ok) return read;
  const form = taskFormOf(read.values, PLAN_USAGE);
  if (!form.ok) return form;
  const runId = read.values.get("--run");
  if (runId === undefined) return { ok: false, message: `--run is required. usage: ${PLAN_USAGE}` };
  if (!isRunId(runId)) return { ok: false, message: RUN_ID_MESSAGE };
  return { ok: true, args: { command: "plan", form: form.form, runId, json: read.switches.has("--json") } };
}

export interface ApplyArgs {
  readonly command: "apply";
  readonly form: TaskFormArgs;
  /** The plan run's id. `latest` is not accepted: the approval names one plan (PM, Q4). */
  readonly runId: string;
  /** The approved digest's first characters (MIN_PLAN_DIGEST_PREFIX or more lowercase hex), or null at a terminal. */
  readonly digest: string | null;
  readonly cancelFile: string | null;
  readonly quiet: boolean;
}

const DIGEST_PREFIX = /^[0-9a-f]+$/;

/** `codaryn apply ...` (6.2, DR-2, DR-5). */
export function parseApplyArgs(argv: readonly string[]): { readonly ok: true; readonly args: ApplyArgs } | { readonly ok: false; readonly message: string } {
  const [command, ...rest] = argv;
  if (command !== "apply") return { ok: false, message: USAGE };
  if (rest.some(isEnvFileFlag)) return { ok: false, message: ENV_FILE_REFUSED_MESSAGE };
  const options = [...TASK_FORM_OPTIONS, "--run", "--digest", "--cancel-file"] as const;
  const read = readOptions<(typeof options)[number], "--quiet">(rest, options, `usage: ${APPLY_USAGE}`, ["--quiet"]);
  if (!read.ok) return read;
  const form = taskFormOf(read.values, APPLY_USAGE);
  if (!form.ok) return form;
  const runId = read.values.get("--run");
  if (runId === undefined) return { ok: false, message: `--run is required. usage: ${APPLY_USAGE}` };
  if (runId === LATEST_RUN_ALIAS) return { ok: false, message: "apply needs the plan run's id; latest is not accepted, so the approval names one plan" };
  if (!isRunId(runId)) return { ok: false, message: RUN_ID_MESSAGE };
  const digest = read.values.get("--digest") ?? null;
  if (digest !== null && (!DIGEST_PREFIX.test(digest) || digest.length < MIN_PLAN_DIGEST_PREFIX || digest.length > 64)) {
    return { ok: false, message: `--digest must be ${MIN_PLAN_DIGEST_PREFIX} to 64 lowercase hexadecimal characters of the plan's digest` };
  }
  return {
    ok: true,
    args: { command: "apply", form: form.form, runId, digest, cancelFile: read.values.get("--cancel-file") ?? null, quiet: read.switches.has("--quiet") },
  };
}

export interface ReviewArgs {
  readonly command: "review";
  readonly form: TaskFormArgs;
  readonly runId: string;
  readonly verdict: "accepted" | "rejected";
  readonly note: string | null;
  readonly json: boolean;
}

/** `codaryn review ...` (8, GT-D6, R-4 L-4). */
export function parseReviewArgs(argv: readonly string[]): { readonly ok: true; readonly args: ReviewArgs } | { readonly ok: false; readonly message: string } {
  const [command, ...rest] = argv;
  if (command !== "review") return { ok: false, message: USAGE };
  if (rest.some(isEnvFileFlag)) return { ok: false, message: ENV_FILE_REFUSED_MESSAGE };
  const options = [...TASK_FORM_OPTIONS, "--run", "--note"] as const;
  const read = readOptions<(typeof options)[number], "--accept" | "--reject" | "--json">(rest, options, `usage: ${REVIEW_USAGE}`, [
    "--accept",
    "--reject",
    "--json",
  ]);
  if (!read.ok) return read;
  const form = taskFormOf(read.values, REVIEW_USAGE);
  if (!form.ok) return form;
  const runId = read.values.get("--run");
  if (runId === undefined) return { ok: false, message: `--run is required. usage: ${REVIEW_USAGE}` };
  if (!isRunId(runId)) return { ok: false, message: RUN_ID_MESSAGE };
  const accept = read.switches.has("--accept");
  if (accept === read.switches.has("--reject")) return { ok: false, message: `give --accept or --reject. usage: ${REVIEW_USAGE}` };
  const note = read.values.get("--note") ?? null;
  if (note !== null && [...note].length > MAX_REVIEW_NOTE_CHARS) return { ok: false, message: `--note must be at most ${MAX_REVIEW_NOTE_CHARS} characters` };
  return { ok: true, args: { command: "review", form: form.form, runId, verdict: accept ? "accepted" : "rejected", note, json: read.switches.has("--json") } };
}

function isEnvFileFlag(item: string): boolean {
  return NODE_ENV_FILE_FLAG.test(item);
}

export function parseArgs(argv: readonly string[]): ParseArgsOutcome {
  const [command, ...rest] = argv;
  if (command !== "run") return { ok: false, message: USAGE };
  // Checked by name before anything else, so the hint is not lost in the generic usage message.
  // No value can start with "--", so the name is a flag wherever it appears.
  if (rest.some(isEnvFileFlag)) return { ok: false, message: ENV_FILE_REFUSED_MESSAGE };

  const read = readOptions<Option, Switch>(rest, OPTIONS, USAGE, SWITCHES, true);
  if (!read.ok) return read;
  const values = read.values;

  const taskPath = values.get("--task");
  const workspace = values.get("--workspace");
  const goal = values.get("--goal");
  const [positional, ...extra] = read.positionals;
  if (extra.length > 0) return { ok: false, message: `run takes one goal as its only positional argument. ${USAGE}` };
  let input: RunInput;
  if (positional !== undefined) {
    // N-9: one-line run. The current directory is the workspace.
    if (taskPath !== undefined || workspace !== undefined || goal !== undefined) {
      return { ok: false, message: `a goal given as an argument cannot be combined with --task, --workspace or --goal. ${USAGE}` };
    }
    if (positional.trim().length === 0) return { ok: false, message: `the goal must not be empty. ${USAGE}` };
    input = { kind: "quick", workspace: ".", goal: positional, oneLine: true };
  } else if (taskPath !== undefined) {
    if (workspace !== undefined || goal !== undefined) {
      return { ok: false, message: `--task cannot be combined with --workspace or --goal. ${USAGE}` };
    }
    input = { kind: "task", taskPath };
  } else if (workspace !== undefined && goal !== undefined) {
    input = { kind: "quick", workspace, goal, oneLine: false };
  } else if (workspace !== undefined || goal !== undefined) {
    return { ok: false, message: `--workspace and --goal must be given together. ${USAGE}` };
  } else {
    return { ok: false, message: `a goal, --task, or --workspace with --goal, is required. ${USAGE}` };
  }
  const profile = profileOf(values);
  if (!profile.ok) return profile;
  const workflow = workflowOf(values, input);
  if (!workflow.ok) return workflow;

  return {
    ok: true,
    args: {
      command: "run",
      input,
      configPath: values.get("--config") ?? null,
      varsFile: values.get("--vars-file") ?? null,
      cancelFile: values.get("--cancel-file") ?? null,
      quiet: read.switches.has("--quiet"),
      profile: profile.profile,
      workflow: workflow.workflow,
    },
  };
}
