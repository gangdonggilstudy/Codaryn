/**
 * `codaryn --help`, `codaryn help [command]`, `codaryn <command> --help` and `codaryn --version`
 * (U-7, N-21). Plain text on stdout, exit code 0. Nothing is read except package.json for the
 * version. The usage lines (command syntax) stay English; every description comes from the
 * message catalog in the chosen language.
 */

import { HELP_COMMANDS } from "../contracts/index.js";
import type { HelpCommand, HelpOption, MessageCatalog, MessageId } from "../contracts/index.js";
import { createMessageCatalog } from "../i18n/index.js";
import { APPLY_USAGE, DOCTOR_USAGE, INIT_USAGE, MODELS_USAGE, PLAN_USAGE, REPORT_USAGE, REVERT_USAGE, REVIEW_USAGE, RUNS_USAGE, RUN_USAGE } from "./args.js";
import { CHANGES_USAGE } from "./changes.js";

export const COMMANDS = HELP_COMMANDS;

/**
 * G-F commands whose help texts are not in the contract yet (HELP_COMMANDS and the `help.*` ids,
 * w3:p9). Until they are, their help is the usage line and one fixed English sentence.
 */
const USAGE_ONLY = {
  plan: { usage: PLAN_USAGE, about: "Shows a plan run's stored plan, masked again, with its digest and whether it was applied." },
  apply: {
    usage: APPLY_USAGE,
    about: "Applies a plan run's plan after the person approves its digest; `codaryn revert --run <apply run id>` undoes it.",
  },
  review: { usage: REVIEW_USAGE, about: "Records a person's verdict on a run that waits for review (review.json); the run's result is not changed." },
  changes: {
    usage: CHANGES_USAGE,
    about: "Shows a run's changed files and their state, masked with the current secrets; a file's changed lines only when the current secrets mask it as the run did (DR-29). Reads only.",
  },
} as const;
type UsageOnlyCommand = keyof typeof USAGE_ONLY;

export type CommandName = HelpCommand | UsageOnlyCommand;

function isUsageOnly(value: CommandName): value is UsageOnlyCommand {
  return Object.hasOwn(USAGE_ONLY, value);
}

export function isCommandName(value: string | undefined): value is CommandName {
  return (COMMANDS as readonly (string | undefined)[]).includes(value) || (value !== undefined && Object.hasOwn(USAGE_ONLY, value));
}

const USAGES: { readonly [C in HelpCommand]: string } = {
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
  allow_unsafe_move: "--allow-unsafe-move",
  json: "--json",
  use: "--use <number|id>",
  limit: "--limit <n>",
  // SP-6: `codaryn models --provider <name>`.
  provider: "--provider <name>",
};

/** The options each command's help describes, in order. */
export const COMMAND_OPTIONS: { readonly [C in HelpCommand]: readonly HelpOption[] } = {
  run: ["task", "workspace", "goal", "config", "vars_file", "cancel_file", "quiet", "profile"],
  revert: ["workspace", "run", "dry_run", "allow_unsafe_move", "quiet"],
  report: ["workspace", "run", "json"],
  doctor: ["config", "vars_file", "task", "workspace", "profile", "json"],
  models: ["provider", "config", "vars_file", "use", "json"],
  init: ["config", "workspace", "json"],
  runs: ["workspace", "limit", "json"],
};

/**
 * A message, or the English one when the catalog has no text for it, or the id when neither has:
 * help must never fail because a text is missing.
 */
function line(messages: MessageCatalog, id: MessageId): string {
  for (const catalog of [messages, createMessageCatalog("en")]) {
    try {
      return (catalog.format as (id: MessageId) => string)(id);
    } catch {
      // Try the next one.
    }
  }
  return id;
}

/** The help text. Without a catalog, English. */
export function helpText(command: CommandName | null, catalog: MessageCatalog = createMessageCatalog("en")): string {
  const messages = { format: (id: MessageId) => line(catalog, id) };
  const lines: string[] = [];
  if (command === null) {
    lines.push(messages.format("help.intro"), "", messages.format("help.commands_heading"));
    for (const name of COMMANDS) lines.push(`  ${USAGES[name]}`);
    for (const entry of Object.values(USAGE_ONLY)) lines.push(`  ${entry.usage}`);
    lines.push("  codaryn --help | codaryn help <command> | codaryn <command> --help", "  codaryn --version", "");
    lines.push(messages.format("help.output"), messages.format("help.key"), messages.format("help.contract"));
  } else if (isUsageOnly(command)) {
    lines.push(`usage: ${USAGE_ONLY[command].usage}`, "", USAGE_ONLY[command].about);
  } else {
    lines.push(`usage: ${USAGES[command]}`, "", messages.format(`help.command.${command}`), "", messages.format("help.options_heading"));
    const width = Math.max(...COMMAND_OPTIONS[command].map((option) => OPTION_SYNTAX[option].length));
    for (const option of COMMAND_OPTIONS[command]) {
      // N-D 4.1: a text that already starts with the option's syntax is printed as it is.
      const described = messages.format(`help.option.${option}`);
      lines.push(described.startsWith("--") ? `  ${described}` : `  ${OPTION_SYNTAX[option].padEnd(width)}  ${described}`);
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
