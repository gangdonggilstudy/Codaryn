/**
 * U-35 (UXM-7 ②; the U-19 survey, section 3 B): the help of plan, apply, review, changes and
 * cleanup was a usage line and one fixed English sentence (src/cli/help.ts USAGE_ONLY). The five
 * commands join HELP_COMMANDS, so each has `help.command.<command>` and `help.exit.<command>`, and
 * the options they take that no help described yet join HELP_OPTIONS.
 *
 * Besides the survey's twelve options, `plan_run`: apply's `--run` takes a plan run's id and never
 * `latest` (args.ts), so it cannot share `help.option.run`, whose text offers `latest`.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { HELP_COMMANDS, HELP_OPTIONS, MESSAGE_IDS, messageParams } from "../../../src/contracts/index.js";
import type { HelpCommand, HelpOption, MessageId } from "../../../src/contracts/index.js";

const BEFORE_COMMANDS = ["run", "revert", "report", "doctor", "models", "init", "runs"];
const NEW_COMMANDS = ["plan", "apply", "review", "changes", "cleanup"];

/** The new options and the command that takes each (U-19 survey 3 B, and plan_run). */
const NEW_OPTIONS: { readonly [option: string]: string } = {
  digest: "apply --digest <first 12+ hex>",
  plan_run: "apply --run <runId>",
  accept: "review --accept",
  reject: "review --reject",
  note: "review --note <text>",
  older_than: "cleanup --older-than <days>",
  run_ids: "cleanup --run <id>[,<id>...]",
  reverted: "cleanup --reverted",
  discarded_older_than: "cleanup --discarded-older-than <days>",
  discarded_run: "cleanup --discarded-run <id>[,<id>...]",
  confirm: "cleanup --confirm <first 12+ hex of the digest>",
  include_not_reverted: "cleanup --include-not-reverted",
  delete_discarded: "cleanup --delete-discarded",
};

describe("U-35: the help of the five plan and state commands is in the contract", () => {
  test("HELP_COMMANDS keeps its seven commands first and adds the five", () => {
    assert.deepEqual([...HELP_COMMANDS], [...BEFORE_COMMANDS, ...NEW_COMMANDS]);
  });

  test("each new command has its description and its exit codes, without parameters", () => {
    const ids = MESSAGE_IDS as readonly string[];
    for (const command of NEW_COMMANDS) {
      for (const id of [`help.command.${command}`, `help.exit.${command}`]) {
        assert.equal(ids.filter((entry) => entry === id).length, 1, id);
        assert.deepEqual(messageParams(id as MessageId), {}, id);
      }
    }
    const typed: HelpCommand = "cleanup";
    assert.ok(HELP_COMMANDS.includes(typed));
  });

  test("the options of the five commands that no help described have an id each", () => {
    const ids = MESSAGE_IDS as readonly string[];
    for (const option of Object.keys(NEW_OPTIONS)) {
      assert.ok((HELP_OPTIONS as readonly string[]).includes(option), option);
      const id = `help.option.${option}`;
      assert.equal(ids.filter((entry) => entry === id).length, 1, id);
      assert.deepEqual(messageParams(id as MessageId), {}, id);
    }
    assert.equal(Object.keys(NEW_OPTIONS).length, 13);
    const typed: HelpOption = "plan_run";
    assert.ok(HELP_OPTIONS.includes(typed));
  });

  test("the options already described stay, and no option is listed twice", () => {
    for (const option of ["task", "workspace", "config", "vars_file", "cancel_file", "quiet", "profile", "run", "json", "allow_unsafe_move"]) {
      assert.ok((HELP_OPTIONS as readonly string[]).includes(option), option);
    }
    assert.equal(new Set(HELP_OPTIONS).size, HELP_OPTIONS.length);
  });
});
