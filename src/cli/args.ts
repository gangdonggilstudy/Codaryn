/**
 * Command line parsing for `codaryn run`, `revert`, `report`, `doctor` and `models`.
 *
 *   codaryn run --task <task.json> [options]
 *   codaryn run --workspace <dir> --goal <text> [options]
 *   options: --config <config.json>  --vars-file <path>  --cancel-file <path>  --quiet
 *   codaryn revert --workspace <dir> --run <runId>
 *   codaryn report --workspace <dir> --run <runId> [--json]
 *   codaryn doctor [--config <config.json>] [--vars-file <path>] [--task <task.json> | --workspace <dir>] [--json]
 *   codaryn models [--config <config.json>] [--vars-file <path>] [--json] [--use <number|id>]
 *
 * Options take one value, which must not be empty or start with "--". Switches take none.
 * Each may appear once.
 */

/** Where the task comes from: a task file, or the quick form built from the config file. */
export type RunInput =
  | { readonly kind: "task"; readonly taskPath: string }
  | { readonly kind: "quick"; readonly workspace: string; readonly goal: string };

export interface RunArgs {
  readonly command: "run";
  readonly input: RunInput;
  /** `--config`. When null, CODARYN_CONFIG may name the file. */
  readonly configPath: string | null;
  /** `--vars-file`: variables to load. Read only when given (C-2, T-15). */
  readonly varsFile: string | null;
  readonly cancelFile: string | null;
  /** `--quiet` (U-8): no progress lines on stderr. */
  readonly quiet: boolean;
}

export type ParseArgsOutcome =
  | { readonly ok: true; readonly args: RunArgs }
  | { readonly ok: false; readonly message: string };

export const RUN_USAGE =
  "codaryn run (--task <task.json> | --workspace <dir> --goal <text>) " +
  "[--config <config.json>] [--vars-file <path>] [--cancel-file <path>] [--quiet]";
export const REVERT_USAGE = "codaryn revert --workspace <dir> --run <runId>";
export const REPORT_USAGE = "codaryn report --workspace <dir> --run <runId> [--json]";
export const DOCTOR_USAGE =
  "codaryn doctor [--config <config.json>] [--vars-file <path>] [--task <task.json> | --workspace <dir>] [--json]";

export const MODELS_USAGE = "codaryn models [--config <config.json>] [--vars-file <path>] [--json] [--use <number|id>]";

export const USAGE =
  `usage: ${RUN_USAGE} | ${REVERT_USAGE} | ${REPORT_USAGE} | ${DOCTOR_USAGE} | ${MODELS_USAGE} | ` +
  "codaryn --help | codaryn --version";

const OPTIONS = ["--task", "--workspace", "--goal", "--config", "--vars-file", "--cancel-file"] as const;
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

const REPORT_OPTIONS = ["--workspace", "--run"] as const;
type ReportOption = (typeof REPORT_OPTIONS)[number];
const DOCTOR_OPTIONS = ["--config", "--vars-file", "--task", "--workspace"] as const;
type DoctorOption = (typeof DOCTOR_OPTIONS)[number];
const JSON_SWITCH = ["--json"] as const;
type JsonSwitch = (typeof JSON_SWITCH)[number];

/** Same rule as the run directory names the store accepts. */
export const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const RUN_ID_MESSAGE = "--run must be a run id: 1-128 characters of letters, digits, '.', '_' and '-'";

function isRunId(value: string): boolean {
  return RUN_ID_PATTERN.test(value) && !value.includes("..");
}

type ReadOutcome<O extends string, S extends string> =
  | { ok: true; values: Map<O, string>; switches: Set<S> }
  | { ok: false; message: string };

/** Reads `--option value` pairs and bare switches. Each at most once, every value non-empty and not a flag. */
function readOptions<O extends string, S extends string = never>(
  rest: readonly string[],
  allowed: readonly O[],
  usage: string,
  switches: readonly S[] = [],
): ReadOutcome<O, S> {
  const values = new Map<O, string>();
  const seen = new Set<S>();
  let index = 0;
  while (index < rest.length) {
    const flag = rest[index] as string;
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
  return { ok: true, values, switches: seen };
}

export interface RevertArgs {
  readonly command: "revert";
  readonly workspace: string;
  readonly runId: string;
}

export type ParseRevertArgsOutcome =
  | { readonly ok: true; readonly args: RevertArgs }
  | { readonly ok: false; readonly message: string };

/** `codaryn revert --workspace <dir> --run <runId>`. Both options are required. */
export function parseRevertArgs(argv: readonly string[]): ParseRevertArgsOutcome {
  const [command, ...rest] = argv;
  if (command !== "revert") return { ok: false, message: USAGE };
  if (rest.some(isEnvFileFlag)) return { ok: false, message: ENV_FILE_REFUSED_MESSAGE };
  const read = readOptions<RevertOption>(rest, REVERT_OPTIONS, USAGE);
  if (!read.ok) return read;
  const workspace = read.values.get("--workspace");
  const runId = read.values.get("--run");
  if (workspace === undefined || runId === undefined) {
    return { ok: false, message: `--workspace and --run are required. usage: ${REVERT_USAGE}` };
  }
  if (!isRunId(runId)) return { ok: false, message: RUN_ID_MESSAGE };
  return { ok: true, args: { command: "revert", workspace, runId } };
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
  return {
    ok: true,
    args: {
      command: "doctor",
      configPath: read.values.get("--config") ?? null,
      varsFile: read.values.get("--vars-file") ?? null,
      taskPath,
      workspace,
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

function isEnvFileFlag(item: string): boolean {
  return NODE_ENV_FILE_FLAG.test(item);
}

export function parseArgs(argv: readonly string[]): ParseArgsOutcome {
  const [command, ...rest] = argv;
  if (command !== "run") return { ok: false, message: USAGE };
  // Checked by name before anything else, so the hint is not lost in the generic usage message.
  // No value can start with "--", so the name is a flag wherever it appears.
  if (rest.some(isEnvFileFlag)) return { ok: false, message: ENV_FILE_REFUSED_MESSAGE };

  const read = readOptions<Option, Switch>(rest, OPTIONS, USAGE, SWITCHES);
  if (!read.ok) return read;
  const values = read.values;

  const taskPath = values.get("--task");
  const workspace = values.get("--workspace");
  const goal = values.get("--goal");
  let input: RunInput;
  if (taskPath !== undefined) {
    if (workspace !== undefined || goal !== undefined) {
      return { ok: false, message: `--task cannot be combined with --workspace or --goal. ${USAGE}` };
    }
    input = { kind: "task", taskPath };
  } else if (workspace !== undefined && goal !== undefined) {
    input = { kind: "quick", workspace, goal };
  } else if (workspace !== undefined || goal !== undefined) {
    return { ok: false, message: `--workspace and --goal must be given together. ${USAGE}` };
  } else {
    return { ok: false, message: `--task, or --workspace with --goal, is required. ${USAGE}` };
  }

  return {
    ok: true,
    args: {
      command: "run",
      input,
      configPath: values.get("--config") ?? null,
      varsFile: values.get("--vars-file") ?? null,
      cancelFile: values.get("--cancel-file") ?? null,
      quiet: read.switches.has("--quiet"),
    },
  };
}
