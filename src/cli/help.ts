/**
 * `codaryn --help`, `codaryn help [command]`, `codaryn <command> --help` and `codaryn --version`
 * (U-7, N-21), and `codaryn` with no arguments at a terminal (DR-49). Plain text on stdout, exit code 0. Nothing is read except package.json for the
 * version. The usage lines (command syntax) stay English; every description comes from the
 * message catalog in the chosen language.
 */

import { HELP_COMMANDS } from "../contracts/index.js";
import type { HelpCommand, HelpOption, MessageCatalog, MessageId } from "../contracts/index.js";
import { createMessageCatalog } from "../i18n/index.js";
import { APPLY_USAGE, DOCTOR_USAGE, INIT_USAGE, MODELS_USAGE, PLAN_USAGE, REPORT_USAGE, REVERT_USAGE, REVIEW_USAGE, RUNS_USAGE, RUN_USAGE } from "./args.js";
import { CHANGES_USAGE } from "./changes.js";
import { CLEANUP_USAGE } from "./cleanup.js";

export const COMMANDS = HELP_COMMANDS;

/** U-35 (UXM-7): every command's help comes from the catalog; the five plan and state commands too. */
export type CommandName = HelpCommand;

export function isCommandName(value: string | undefined): value is CommandName {
  return (COMMANDS as readonly (string | undefined)[]).includes(value);
}

const USAGES: { readonly [C in HelpCommand]: string } = {
  run: RUN_USAGE,
  revert: REVERT_USAGE,
  report: REPORT_USAGE,
  doctor: DOCTOR_USAGE,
  models: MODELS_USAGE,
  init: INIT_USAGE,
  runs: RUNS_USAGE,
  plan: PLAN_USAGE,
  apply: APPLY_USAGE,
  review: REVIEW_USAGE,
  changes: CHANGES_USAGE,
  cleanup: CLEANUP_USAGE,
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
  // U-35: apply, review and cleanup (as their usage lines write them).
  digest: "--digest <first 12+ hex>",
  plan_run: "--run <runId>",
  accept: "--accept",
  reject: "--reject",
  note: "--note <text>",
  older_than: "--older-than <days>",
  run_ids: "--run <id>[,<id>...]",
  reverted: "--reverted",
  discarded_older_than: "--discarded-older-than <days>",
  discarded_run: "--discarded-run <id>[,<id>...]",
  confirm: "--confirm <first 12+ hex of the digest>",
  include_not_reverted: "--include-not-reverted",
  delete_discarded: "--delete-discarded",
};

/**
 * The options each command's help describes, in order. DR-49 (U-23): `run`, `revert` and `apply`
 * list `--json` (their JSON line at a terminal), which their usage lines leave out (args.ts
 * SWITCHES). U-35: the five plan and state commands list theirs in the order of their usage lines.
 */
export const COMMAND_OPTIONS: { readonly [C in HelpCommand]: readonly HelpOption[] } = {
  run: ["task", "workspace", "goal", "config", "vars_file", "cancel_file", "quiet", "profile", "json"],
  revert: ["workspace", "run", "dry_run", "allow_unsafe_move", "quiet", "json"],
  report: ["workspace", "run", "json"],
  doctor: ["config", "vars_file", "task", "workspace", "profile", "json"],
  models: ["provider", "config", "vars_file", "use", "json"],
  init: ["config", "workspace", "json"],
  runs: ["workspace", "limit", "json"],
  plan: ["task", "workspace", "profile", "config", "vars_file", "run", "json"],
  apply: ["task", "workspace", "profile", "config", "vars_file", "plan_run", "digest", "allow_unsafe_move", "cancel_file", "quiet", "json"],
  review: ["task", "workspace", "profile", "config", "vars_file", "run", "accept", "reject", "note", "json"],
  changes: ["task", "workspace", "profile", "config", "vars_file", "run", "json"],
  cleanup: ["workspace", "older_than", "run_ids", "reverted", "discarded_older_than", "discarded_run", "confirm", "delete_discarded", "include_not_reverted", "json"],
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
    lines.push("  codaryn --help | codaryn help <command> | codaryn <command> --help", "  codaryn --version", "");
    lines.push(messages.format("help.output"), messages.format("help.key"), messages.format("help.contract"));
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

/**
 * What the arguments ask for when it is help or the version; null for a normal command.
 * DR-49 (U-23, UXM-9, PM answer): `codaryn` alone at a terminal (`stdoutIsTerminal`) shows the help,
 * as `--help` does. Otherwise (a pipe or a file, or no context given) it stays invalid_arguments as
 * before: what a script reads is not changed (DR-48).
 */
export function helpRequest(
  argv: readonly string[],
  context: { readonly stdoutIsTerminal: boolean } = { stdoutIsTerminal: false },
): { kind: "help"; command: CommandName | null } | { kind: "version" } | null {
  if (argv.length === 0) return context.stdoutIsTerminal ? { kind: "help", command: null } : null;
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
