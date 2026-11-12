/**
 * `codaryn --help`, `codaryn help [command]`, `codaryn <command> --help` and `codaryn --version`
 * (U-7, N-21). Plain text on stdout, exit code 0. Nothing is read except package.json for the
 * version. The usage lines (command syntax) stay English; every description comes from the
 * message catalog in the chosen language.
 */

import { HELP_COMMANDS } from "../contracts/index.js";
import type { HelpCommand, HelpOption, MessageCatalog } from "../contracts/index.js";
import { createMessageCatalog } from "../i18n/index.js";
import { DOCTOR_USAGE, INIT_USAGE, MODELS_USAGE, REPORT_USAGE, REVERT_USAGE, RUNS_USAGE, RUN_USAGE } from "./args.js";

export const COMMANDS = HELP_COMMANDS;
export type CommandName = HelpCommand;

export function isCommandName(value: string | undefined): value is CommandName {
  return (COMMANDS as readonly (string | undefined)[]).includes(value);
}

const USAGES: { readonly [C in CommandName]: string } = {
  run: RUN_USAGE,
  revert: REVERT_USAGE,
  report: REPORT_USAGE,
  doctor: DOCTOR_USAGE,
  models: MODELS_USAGE,
  init: INIT_USAGE,
  runs: RUNS_USAGE,
};

/** How each option is written on the command line. */
const OPTION_SYNTAX: { readonly [O in HelpOption]: string } = {
  task: "--task <task.json>",
  workspace: "--workspace <dir>",
  goal: "--goal <text>",
  config: "--config <file>",
  vars_file: "--vars-file <file>",
  cancel_file: "--cancel-file <file>",
  quiet: "--quiet",
  profile: "--profile <name>",
  run: "--run <runId|latest>",
  dry_run: "--dry-run",
  json: "--json",
  use: "--use <number|id>",
  limit: "--limit <n>",
};

/** The options each command's help describes, in order. */
export const COMMAND_OPTIONS: { readonly [C in CommandName]: readonly HelpOption[] } = {
  run: ["task", "workspace", "goal", "config", "vars_file", "cancel_file", "quiet", "profile"],
  revert: ["workspace", "run", "dry_run", "quiet"],
  report: ["workspace", "run", "json"],
  doctor: ["config", "vars_file", "task", "workspace", "profile", "json"],
  models: ["config", "vars_file", "use", "json"],
  init: ["config", "workspace", "json"],
  runs: ["workspace", "limit", "json"],
};

/** The help text. Without a catalog, English. */
export function helpText(command: CommandName | null, messages: MessageCatalog = createMessageCatalog("en")): string {
  const lines: string[] = [];
  if (command === null) {
    lines.push(messages.format("help.intro"), "", messages.format("help.commands_heading"));
    for (const name of COMMANDS) lines.push(`  ${USAGES[name]}`);
    lines.push("  codaryn --help | codaryn help <command> | codaryn <command> --help", "  codaryn --version", "");
    lines.push(messages.format("help.output"), messages.format("help.key"), messages.format("help.contract"));
  } else {
    lines.push(`usage: ${USAGES[command]}`, "", messages.format(`help.command.${command}`), "", messages.format("help.options_heading"));
    const width = Math.max(...COMMAND_OPTIONS[command].map((option) => OPTION_SYNTAX[option].length));
    for (const option of COMMAND_OPTIONS[command]) {
      lines.push(`  ${OPTION_SYNTAX[option].padEnd(width)}  ${messages.format(`help.option.${option}`)}`);
    }
    lines.push("", `${messages.format("help.exit_heading")} ${messages.format(`help.exit.${command}`)}`);
  }
  return `${lines.join("\n")}\n`;
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
