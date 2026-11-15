/**
 * U-53 (review R-64 L1, I1 to I3; R-58 L2), the CLI's part: the help had no line for --workflow,
 * which run, plan, apply and review take; run, revert and apply described their --json with the
 * text of report's ("JSON instead of text"), though theirs prints the result's JSON line at a
 * terminal too; --task said "the task file to run" for commands that run nothing; and --workspace
 * did not say that report, runs, plan and changes take the current directory without it (U-17).
 * With the contract's new options (f2c99d3) each help lists the fitting text, in the order of its
 * usage line; run, revert and apply list --json last, as their usage lines leave it out (the usage
 * lines are inside invalid_arguments messages and stay as they are).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { MessageId } from "../../../src/contracts/index.js";
import { APPLY_USAGE, REVERT_USAGE, RUN_USAGE } from "../../../src/cli/args.js";
import { COMMAND_OPTIONS, helpText } from "../../../src/cli/help.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";

const EXPECTED = {
  run: ["task", "workspace", "goal", "config", "vars_file", "cancel_file", "quiet", "profile", "workflow", "json_line"],
  revert: ["workspace", "run", "dry_run", "allow_unsafe_move", "quiet", "json_line"],
  report: ["workspace_or_current", "run", "json"],
  doctor: ["config", "vars_file", "task", "workspace", "profile", "json"],
  models: ["provider", "config", "vars_file", "use", "json"],
  init: ["config", "workspace", "json"],
  runs: ["workspace_or_current", "limit", "json"],
  plan: ["run_task", "workspace_or_current", "profile", "workflow", "config", "vars_file", "run", "json"],
  apply: ["run_task", "workspace", "profile", "workflow", "config", "vars_file", "plan_run", "digest", "allow_unsafe_move", "cancel_file", "quiet", "json_line"],
  review: ["run_task", "workspace", "profile", "workflow", "config", "vars_file", "run", "accept", "reject", "note", "json"],
  changes: ["run_task", "workspace_or_current", "profile", "config", "vars_file", "run", "json"],
  cleanup: ["workspace", "older_than", "run_ids", "reverted", "discarded_older_than", "discarded_run", "confirm", "delete_discarded", "include_not_reverted", "json"],
} as const;

describe("U-53: each help lists the option texts that fit the command", () => {
  test("the option lists, in the order of each usage line", () => {
    for (const [command, options] of Object.entries(EXPECTED)) {
      assert.deepEqual(COMMAND_OPTIONS[command as keyof typeof COMMAND_OPTIONS], options, command);
    }
  });

  for (const language of ["en", "ko"] as const) {
    test(`${language}: --workflow, run/revert/apply's --json, the reading commands' --task and --workspace are drawn`, () => {
      const catalog = createMessageCatalog(language);
      const t = (id: MessageId): string => (catalog.format as (id: MessageId) => string)(id);
      for (const command of ["run", "plan", "apply", "review"] as const) assert.ok(helpText(command, catalog).includes(`  ${t("help.option.workflow")}\n`), command);
      for (const command of ["run", "revert", "apply"] as const) {
        const help = helpText(command, catalog);
        assert.ok(help.includes(`  ${t("help.option.json_line")}\n`), command);
        assert.equal(help.includes(`  ${t("help.option.json")}\n`), false, command);
      }
      for (const command of ["plan", "apply", "review", "changes"] as const) assert.ok(helpText(command, catalog).includes(`  ${t("help.option.run_task")}\n`), command);
      for (const command of ["report", "runs", "plan", "changes"] as const) assert.ok(helpText(command, catalog).includes(`  ${t("help.option.workspace_or_current")}\n`), command);
    });
  }

  test("the usage lines of run, revert and apply do not gain --json", () => {
    for (const usage of [RUN_USAGE, REVERT_USAGE, APPLY_USAGE]) assert.equal(usage.includes("--json"), false, usage);
  });
});
