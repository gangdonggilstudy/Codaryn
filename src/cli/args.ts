/** Command line parsing for `codaryn run --task <path> [--cancel-file <path>]`. */

export interface RunArgs {
  readonly command: "run";
  readonly taskPath: string;
  readonly cancelFile: string | null;
}

export type ParseArgsOutcome =
  | { readonly ok: true; readonly args: RunArgs }
  | { readonly ok: false; readonly message: string };

export const USAGE = "usage: codaryn run --task <task.json> [--cancel-file <path>]";

export function parseArgs(argv: readonly string[]): ParseArgsOutcome {
  const [command, ...rest] = argv;
  if (command !== "run") return { ok: false, message: USAGE };

  let taskPath: string | null = null;
  let cancelFile: string | null = null;
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      return { ok: false, message: `${flag ?? "option"} needs a value. ${USAGE}` };
    }
    if (flag === "--task" && taskPath === null) {
      taskPath = value;
    } else if (flag === "--cancel-file" && cancelFile === null) {
      cancelFile = value;
    } else {
      return { ok: false, message: `unknown or repeated option. ${USAGE}` };
    }
  }
  if (taskPath === null) return { ok: false, message: `--task is required. ${USAGE}` };
  return { ok: true, args: { command: "run", taskPath, cancelFile } };
}
