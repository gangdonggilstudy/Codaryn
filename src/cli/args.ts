/**
 * Command line parsing for `codaryn run`.
 *
 *   codaryn run --task <task.json> [options]
 *   codaryn run --workspace <dir> --goal <text> [options]
 *   options: --config <config.json>  --env-file <path>  --cancel-file <path>
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
  /** `--env-file`. Read only when given (C-2). */
  readonly envFile: string | null;
  readonly cancelFile: string | null;
}

export type ParseArgsOutcome =
  | { readonly ok: true; readonly args: RunArgs }
  | { readonly ok: false; readonly message: string };

export const USAGE =
  "usage: codaryn run (--task <task.json> | --workspace <dir> --goal <text>) " +
  "[--config <config.json>] [--env-file <path>] [--cancel-file <path>]";

const OPTIONS = ["--task", "--workspace", "--goal", "--config", "--env-file", "--cancel-file"] as const;
type Option = (typeof OPTIONS)[number];

function isOption(flag: string | undefined): flag is Option {
  return (OPTIONS as readonly (string | undefined)[]).includes(flag);
}

export function parseArgs(argv: readonly string[]): ParseArgsOutcome {
  const [command, ...rest] = argv;
  if (command !== "run") return { ok: false, message: USAGE };

  const values = new Map<Option, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!isOption(flag) || values.has(flag)) {
      return { ok: false, message: `unknown or repeated option. ${USAGE}` };
    }
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      return { ok: false, message: `${flag} needs a value. ${USAGE}` };
    }
    values.set(flag, value);
  }

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
      envFile: values.get("--env-file") ?? null,
      cancelFile: values.get("--cancel-file") ?? null,
    },
  };
}
