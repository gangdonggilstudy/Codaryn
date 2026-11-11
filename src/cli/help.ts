/**
 * `codaryn --help`, `codaryn help [command]`, `codaryn <command> --help` and `codaryn --version`
 * (U-7). Plain text on stdout, exit code 0. Nothing is read except package.json for the version.
 */

import { DOCTOR_USAGE, REPORT_USAGE, REVERT_USAGE, RUN_USAGE } from "./args.js";

export const COMMANDS = ["run", "revert", "report", "doctor"] as const;
export type CommandName = (typeof COMMANDS)[number];

export function isCommandName(value: string | undefined): value is CommandName {
  return (COMMANDS as readonly (string | undefined)[]).includes(value);
}

const GENERAL_HELP = [
  "codaryn: a local task agent. One run works inside one workspace directory, under a policy,",
  "and ends when its verifiers decide. Records go to <workspace>/.codaryn/.",
  "",
  "Commands:",
  `  ${RUN_USAGE}`,
  `  ${REVERT_USAGE}`,
  `  ${REPORT_USAGE}`,
  `  ${DOCTOR_USAGE}`,
  "  codaryn --help | codaryn help <command> | codaryn <command> --help",
  "  codaryn --version",
  "",
  "run prints one JSON line on stdout and progress lines on stderr (--quiet turns them off).",
  "The API key is read only from the ANTHROPIC_API_KEY environment variable, never from a file",
  "given with --task or --config. See docs/cli-contract.md for the full contract.",
];

const COMMAND_HELP: { readonly [C in CommandName]: readonly string[] } = {
  run: [
    `usage: ${RUN_USAGE}`,
    "",
    "Runs one task. --task names a task file; the quick form takes --workspace and --goal and",
    "uses the config file for the model, limits, policy and verifiers.",
    "  --config <file>       settings (CODARYN_CONFIG names it when absent); never holds a key",
    "  --vars-file <file>    variables to load, outside the workspace (Node's --env-file is refused)",
    "  --cancel-file <file>  the run is cancelled when this file appears; outside the workspace",
    "  --quiet               no progress lines on stderr",
    "Exit codes: done 0, failed 1, input errors 2, needs-input 3, budget-exhausted 4, cancelled 5,",
    "workspace locked 6, provider not configured 7, internal error 70.",
  ],
  revert: [
    `usage: ${REVERT_USAGE}`,
    "",
    "Puts back the files a run changed with its file tools, except files changed again since.",
    "Exit codes: complete 0, partial 3, errors 2 or 6.",
  ],
  report: [
    `usage: ${REPORT_USAGE}`,
    "",
    "Prints a Markdown summary of one run from its result.json and journal (masked records only):",
    "status, verifier results, protected material, changes, usage and what was not checked.",
    "  --json   print the report object as one JSON line instead",
    "Exit codes: complete 0, incomplete (no result.json) 3, errors 2. Nothing is changed.",
  ],
  doctor: [
    `usage: ${DOCTOR_USAGE}`,
    "",
    "Checks what a run would need without running one: Node.js version, config, variables and",
    "task files, whether the key is set (never its value), model and limits, file locations,",
    "whether allowed commands are found, the workspace and the install directory.",
    "No network access is made and nothing is changed.",
    "  --json   print the result object as one JSON line instead",
    "Exit codes: ok 0, fail 1, warn 3, argument errors 2.",
  ],
};

export function helpText(command: CommandName | null): string {
  return `${(command === null ? GENERAL_HELP : COMMAND_HELP[command]).join("\n")}\n`;
}

export function versionText(version: string | null): string {
  return version === null ? "codaryn (version unknown)\n" : `codaryn ${version}\n`;
}

/** What the arguments ask for when it is help or the version; null for a normal command. */
export function helpRequest(argv: readonly string[]): { kind: "help"; command: CommandName | null } | { kind: "version" } | null {
  const [first, ...rest] = argv;
  if (first === "--version" || first === "-v" || first === "version") return rest.length === 0 ? { kind: "version" } : null;
  if (first === "--help" || first === "-h" || first === "help") {
    if (rest.length === 0) return { kind: "help", command: null };
    return rest.length === 1 && isCommandName(rest[0]) ? { kind: "help", command: rest[0] } : null;
  }
  // No option value may start with "--", so "--help" is a flag wherever it appears.
  if (isCommandName(first) && (rest.includes("--help") || (rest.length === 1 && rest[0] === "-h"))) {
    return { kind: "help", command: first };
  }
  return null;
}
