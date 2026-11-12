/**
 * U-35 (UXM-7; the U-19 survey, section 3 B): the help of plan, apply, review, changes and cleanup
 * says what each does, its options and its exit codes in both languages, as the other commands'
 * help does. They were a usage line and one fixed English sentence before (src/cli/help.ts
 * USAGE_ONLY). Help shows no decision or review numbers (PM).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CLEANUP_EXIT_CODES, MAX_REVIEW_NOTE_CHARS, PLAN_EXIT_CODES, REVIEW_EXIT_CODES, RUN_EXIT_CODES } from "../../../src/contracts/index.js";
import type { MessageId } from "../../../src/contracts/index.js";
import { MESSAGE_TEXTS, PLACEHOLDER } from "../../../src/i18n/index.js";

const HANGUL = /[가-힣]/u;
const LANGUAGES = ["en", "ko"] as const;
const COMMANDS = ["plan", "apply", "review", "changes", "cleanup"] as const;

/** Each new option's text starts with how it is typed, as the others do (help.ts prints it as it is). */
const SYNTAX = {
  digest: "--digest <",
  plan_run: "--run <",
  accept: "--accept: ",
  reject: "--reject: ",
  note: "--note <",
  older_than: "--older-than <",
  run_ids: "--run <id>[,<id>...]: ",
  reverted: "--reverted: ",
  discarded_older_than: "--discarded-older-than <",
  discarded_run: "--discarded-run <id>[,<id>...]: ",
  confirm: "--confirm <",
  include_not_reverted: "--include-not-reverted: ",
  delete_discarded: "--delete-discarded: ",
} as const;

function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1] as string);
}

describe("U-35: the help of the five plan and state commands", () => {
  test("help shows no decision or review numbers", () => {
    for (const language of LANGUAGES) {
      for (const [id, text] of Object.entries(MESSAGE_TEXTS[language])) {
        if (id.startsWith("help.")) assert.ok(!/\b(DR|UXM|AXM|U|R|N|G|SP)-\d/.test(text), `${language} ${id}: ${text}`);
      }
    }
  });

  test("each command has a description and exit codes; the Korean is in Korean", () => {
    for (const language of LANGUAGES) {
      const t = MESSAGE_TEXTS[language];
      for (const command of COMMANDS) {
        assert.ok(t[`help.command.${command}`].length > 0 && t[`help.exit.${command}`].length > 0, `${language} ${command}`);
        if (language === "ko") assert.ok(HANGUL.test(t[`help.command.${command}`]), command);
      }
    }
  });

  test("each option text starts with its syntax and takes no parameter", () => {
    for (const language of LANGUAGES) {
      for (const [option, start] of Object.entries(SYNTAX)) {
        const text = MESSAGE_TEXTS[language][`help.option.${option}` as MessageId];
        assert.ok(text.startsWith(start), `${language} ${option}: ${text}`);
        assert.deepEqual(placeholders(text), [], `${language} ${option}`);
        if (language === "ko") assert.ok(HANGUL.test(text), option);
      }
    }
  });

  test("apply's and cleanup's --run take exact ids; cleanup's confirmations go with --confirm", () => {
    for (const language of LANGUAGES) {
      const t = MESSAGE_TEXTS[language];
      // help.option.run offers latest; these two never take it.
      for (const option of ["plan_run", "run_ids"] as const) {
        assert.match(t[`help.option.${option}`], language === "en" ? /latest is not taken/ : /latest는 받지 않습니다/, `${language} ${option}`);
      }
      for (const option of ["include_not_reverted", "delete_discarded"] as const) assert.ok(t[`help.option.${option}`].includes("--confirm"), `${language} ${option}`);
      for (const option of ["--confirm", "--include-not-reverted", "--delete-discarded"]) assert.ok(t["help.command.cleanup"].includes(option), `${language} ${option}`);
      // The note's bound is the contract's.
      assert.ok(t["help.option.note"].includes(String(MAX_REVIEW_NOTE_CHARS)), language);
    }
  });

  test("the exit codes are the contract's; none of the five asks the model (no 7 or 8)", () => {
    for (const language of LANGUAGES) {
      const t = MESSAGE_TEXTS[language];
      for (const [status, code] of Object.entries(PLAN_EXIT_CODES)) assert.ok(t["help.exit.plan"].includes(`${status} ${code}`), `${language} plan ${status}`);
      for (const [status, code] of Object.entries(REVIEW_EXIT_CODES)) assert.ok(t["help.exit.review"].includes(`${status} ${code}`), `${language} review ${status}`);
      for (const [status, code] of Object.entries(CLEANUP_EXIT_CODES)) assert.ok(t["help.exit.cleanup"].includes(`${status} ${code}`), `${language} cleanup ${status}`);
      // An apply run ends as a run does, and can stop on an internal error.
      for (const [status, code] of Object.entries(RUN_EXIT_CODES)) assert.ok(t["help.exit.apply"].includes(`${status} ${code}`), `${language} apply ${status}`);
      assert.match(t["help.exit.apply"], /70$/);
      for (const command of COMMANDS) assert.ok(!/\b[78]\b/.test(t[`help.exit.${command}`]), `${language} ${command}`);
      // Errors: 2, or 6 when the workspace is locked or the latest run is still going.
      for (const command of ["plan", "review", "changes", "cleanup"] as const) {
        assert.match(t[`help.exit.${command}`], language === "en" ? /errors 2 or 6$/ : /오류 2 또는 6$/, `${language} ${command}`);
      }
    }
  });
});
