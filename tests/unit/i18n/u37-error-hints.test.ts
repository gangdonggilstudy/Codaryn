/**
 * U-37 (UXM-2, DR-57; the U-19 survey, section 3 G): the reason of an argument, input or setting
 * error is told in the chosen language, as one line per hint: what is wrong and how to fix it. No
 * value the person typed is repeated: an unknown option is told by its position only, a key's place
 * by its field position, a missing setting by its variable and field names.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ALL_CLI_ERROR_HINTS, CLI_ERROR_HINTS, DETAILED_CLI_ERROR_HINTS, MIN_PLAN_DIGEST_PREFIX, PROVIDER_SETTINGS } from "../../../src/contracts/index.js";
import type { MessageId } from "../../../src/contracts/index.js";
import { MAX_INPUT_FILE_BYTES } from "../../../src/cli/security/index.js";
import { MESSAGE_TEXTS, PLACEHOLDER } from "../../../src/i18n/index.js";

const HANGUL = /[가-힣]/u;
const LANGUAGES = ["en", "ko"] as const;
const ITEMS = ["error.missing.key", "error.missing.model", "error.missing.model_placeholder", "error.missing.output_limit"] as const;
const hintIds = ALL_CLI_ERROR_HINTS.map((hint) => `error.hint.${hint}` as MessageId);

function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1] as string);
}

describe("U-37: the reasons of argument, input and setting errors", () => {
  test("every hint and item has a text in both languages; the Korean is in Korean", () => {
    assert.equal(ALL_CLI_ERROR_HINTS.length, CLI_ERROR_HINTS.length + DETAILED_CLI_ERROR_HINTS.length);
    for (const language of LANGUAGES) {
      for (const id of [...hintIds, ...ITEMS]) {
        const text = MESSAGE_TEXTS[language][id];
        assert.ok(text.length > 0 && !text.includes("\n"), `${language} ${id}`);
        if (language === "ko") assert.ok(HANGUL.test(text), id);
      }
    }
  });

  test("a hint says what is wrong and then how to fix it, in two parts", () => {
    for (const language of LANGUAGES) {
      for (const id of hintIds) {
        const text = MESSAGE_TEXTS[language][id];
        // The cause, then the fix: a semicolon or a second sentence (in Korean, a second sentence).
        assert.ok(language === "en" ? /; |\. [A-Za-z]/.test(text) : /[다)]\. \S/.test(text), `${language} ${id}: ${text}`);
        assert.ok(/[.]$/.test(text), `${language} ${id}`);
      }
    }
  });

  test("no typed value comes back: an unknown option by its position, never by a name", () => {
    for (const language of LANGUAGES) {
      const t = MESSAGE_TEXTS[language];
      assert.deepEqual(placeholders(t["error.hint.unknown_option"]), ["position"], language);
      assert.ok(!/--[a-z]/.test(t["error.hint.unknown_option"]), `${language}: no option name`);
      for (const hint of CLI_ERROR_HINTS) assert.deepEqual(placeholders(t[`error.hint.${hint}`]), [], `${language} ${hint}`);
      for (const hint of ["key_field_in_task", "key_field_in_config"] as const) assert.deepEqual(placeholders(t[`error.hint.${hint}`]), ["field"], `${language} ${hint}`);
      assert.deepEqual(placeholders(t["error.hint.provider_settings_missing"]), [], language);
    }
  });

  test("the bounds the hints name are the code's", () => {
    assert.equal(MIN_PLAN_DIGEST_PREFIX, 12);
    assert.equal(MAX_INPUT_FILE_BYTES, 1024 * 1024);
    for (const language of LANGUAGES) {
      const t = MESSAGE_TEXTS[language];
      assert.ok(t["error.hint.digest_form"].includes("12") && t["error.hint.digest_form"].includes("64"), language);
      assert.ok(t["error.hint.input_too_large"].includes("1 MiB"), language);
      assert.ok(t["error.hint.apply_needs_run_id"].includes("latest"), language);
    }
  });

  test("the missing settings: one item each, in the contract's order, naming where it is set", () => {
    assert.deepEqual([...PROVIDER_SETTINGS], ["key", "model", "output_limit"]);
    const { en, ko } = MESSAGE_TEXTS;
    assert.deepEqual(
      ITEMS.map((id) => en[id].slice(0, en[id].indexOf(":"))),
      ["key", "model", "model", "output limit"],
    );
    assert.deepEqual(
      ITEMS.map((id) => ko[id].slice(0, ko[id].indexOf(":"))),
      ["키", "모델", "모델", "출력 상한"],
    );
    for (const language of LANGUAGES) {
      const t = MESSAGE_TEXTS[language];
      assert.deepEqual(placeholders(t["error.missing.key"]), ["keyEnv"], language);
      for (const id of ["error.missing.model", "error.missing.model_placeholder"] as const) {
        assert.deepEqual(placeholders(t[id]), ["variable", "field"], `${language} ${id}`);
        assert.ok(t[id].includes("task model.model") && t[id].includes("codaryn models --use"), `${language} ${id}`);
      }
      assert.deepEqual(placeholders(t["error.missing.output_limit"]), ["field"], language);
      assert.ok(t["error.missing.output_limit"].includes("task model.maxOutputTokens"), language);
    }
  });
});
