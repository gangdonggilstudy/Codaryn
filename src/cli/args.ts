/**
 * Command line parsing for `codaryn run` and `codaryn revert`.
 *
 *   codaryn run --task <task.json> [options]
 *   codaryn run --workspace <dir> --goal <text> [options]
 *   options: --config <config.json>  --vars-file <path>  --cancel-file <path>
 *   codaryn revert --workspace <dir> --run <runId>
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
}

export type ParseArgsOutcome =
  | { readonly ok: true; readonly args: RunArgs }
  | { readonly ok: false; readonly message: string };

export const REVERT_USAGE = "codaryn revert --workspace <dir> --run <runId>";

export const USAGE =
  "usage: codaryn run (--task <task.json> | --workspace <dir> --goal <text>) " +
  `[--config <config.json>] [--vars-file <path>] [--cancel-file <path>] | ${REVERT_USAGE}`;

const OPTIONS = ["--task", "--workspace", "--goal", "--config", "--vars-file", "--cancel-file"] as const;

/**
 * T-15: Node 26 reads `--env-file` itself, even after the script name: a missing file ends the
 * process (exit 9) and a UNC path is opened before codaryn can check it. codaryn does not take it.
 */
export const ENV_FILE_REFUSED_MESSAGE =
  "--env-file is not a codaryn option: Node reads that name itself before codaryn starts. Use --vars-file <path>";
type Option = (typeof OPTIONS)[number];

const REVERT_OPTIONS = ["--workspace", "--run"] as const;
type RevertOption = (typeof REVERT_OPTIONS)[number];

/** Same rule as the run directory names the store accepts. */
export const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Reads `--flag value` pairs. Each flag at most once, every value non-empty and not a flag. */
function readOptions<O extends string>(
  rest: readonly string[],
  allowed: readonly O[],
): { ok: true; values: Map<O, string> } | { ok: false; message: string } {
  const values = new Map<O, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!(allowed as readonly (string | undefined)[]).includes(flag) || values.has(flag as O)) {
      return { ok: false, message: `unknown or repeated option. ${USAGE}` };
    }
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      return { ok: false, message: `${flag} needs a value. ${USAGE}` };
    }
    values.set(flag as O, value);
  }
  return { ok: true, values };
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
  const read = readOptions<RevertOption>(rest, REVERT_OPTIONS);
  if (!read.ok) return read;
  const workspace = read.values.get("--workspace");
  const runId = read.values.get("--run");
  if (workspace === undefined || runId === undefined) {
    return { ok: false, message: `--workspace and --run are required. usage: ${REVERT_USAGE}` };
  }
  if (!RUN_ID_PATTERN.test(runId) || runId.includes("..")) {
    return { ok: false, message: "--run must be a run id: 1-128 characters of letters, digits, '.', '_' and '-'" };
  }
  return { ok: true, args: { command: "revert", workspace, runId } };
}

export function parseArgs(argv: readonly string[]): ParseArgsOutcome {
  const [command, ...rest] = argv;
  if (command !== "run") return { ok: false, message: USAGE };
  // Checked by name before anything else, so the hint is not lost in the generic usage message.
  if (rest.some((item, index) => index % 2 === 0 && (item === "--env-file" || item.startsWith("--env-file=")))) {
    return { ok: false, message: ENV_FILE_REFUSED_MESSAGE };
  }

  const read = readOptions<Option>(rest, OPTIONS);
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
    },
  };
}
