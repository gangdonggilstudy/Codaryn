/**
 * U-35 (UXM-7; the U-19 survey, section 3 B), the CLI's part: the help of plan, apply, review,
 * changes and cleanup was a usage line and one fixed English sentence (help.ts USAGE_ONLY), with
 * decision numbers in it, no options and no exit codes, in English in a Korean help too. With the
 * contract (0a14577) the five are HelpCommands, so `codaryn --help` printed "undefined" for them
 * until help.ts has their usage lines. Now each is drawn like the other seven: the usage line, the
 * catalog's description, its options and its exit codes, in the chosen language.
 * The usage lines themselves (args.ts, changes.ts, cleanup.ts) do not change: they are also inside
 * invalid_arguments messages.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { MessageId } from "../../../src/contracts/index.js";
import { APPLY_USAGE, PLAN_USAGE, REVIEW_USAGE } from "../../../src/cli/args.js";
import { CHANGES_USAGE } from "../../../src/cli/changes.js";
import { CLEANUP_USAGE } from "../../../src/cli/cleanup.js";
import { COMMAND_OPTIONS, helpText } from "../../../src/cli/help.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";

const FIVE = { plan: PLAN_USAGE, apply: APPLY_USAGE, review: REVIEW_USAGE, changes: CHANGES_USAGE, cleanup: CLEANUP_USAGE } as const;

/** The options each help lists, in the order its usage line has them (apply takes --json too, U-23). */
const OPTIONS = {
  plan: ["task", "workspace", "profile", "config", "vars_file", "run", "json"],
  apply: ["task", "workspace", "profile", "config", "vars_file", "plan_run", "digest", "allow_unsafe_move", "cancel_file", "quiet", "json"],
  review: ["task", "workspace", "profile", "config", "vars_file", "run", "accept", "reject", "note", "json"],
  changes: ["task", "workspace", "profile", "config", "vars_file", "run", "json"],
  cleanup: ["workspace", "older_than", "run_ids", "reverted", "discarded_older_than", "discarded_run", "confirm", "delete_discarded", "include_not_reverted", "json"],
} as const;

describe("U-35: the help of plan, apply, review, changes and cleanup", () => {
  for (const language of ["en", "ko"] as const) {
    const catalog = createMessageCatalog(language);
    const t = (id: MessageId): string => (catalog.format as (id: MessageId) => string)(id);
    for (const [command, usage] of Object.entries(FIVE) as [keyof typeof FIVE, string][]) {
      test(`${language} ${command}: usage, description, options and exit codes, as the other commands' help`, () => {
        const options = COMMAND_OPTIONS[command] as readonly string[];
        assert.deepEqual(options, OPTIONS[command]);
        const expected = [
          `usage: ${usage}`,
          "",
          t(`help.command.${command}`),
          "",
          t("help.options_heading"),
          // Every option text of these starts with its syntax, so it is printed as it is.
          ...options.map((option) => `  ${t(`help.option.${option}` as MessageId)}`),
          "",
          `${t("help.exit_heading")} ${t(`help.exit.${command}`)}`,
        ];
        const help = helpText(command, catalog);
        assert.equal(help, `${expected.join("\n")}\n`);
        assert.doesNotMatch(help, /\((DR|UXM|AXM|R)-\d+/, "no decision number");
      });
    }
  }

  test("codaryn --help lists each usage line once, in the order before, and no undefined", () => {
    const help = helpText(null);
    assert.equal(help.includes("undefined"), false, help);
    const at = Object.values(FIVE).map((usage) => {
      assert.equal(help.split(`  ${usage}\n`).length, 2, usage);
      return help.indexOf(`  ${usage}\n`);
    });
    assert.deepEqual([...at].sort((a, b) => a - b), at, "plan, apply, review, changes, cleanup, as before");
  });
});
