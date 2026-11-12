/** N-4 parameter kinds: what each kind accepts, and that anything else is the replacement mark. */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CLI_ERROR_EXIT_CODES,
  DEFAULT_CONFIG_DISPLAY,
  POLICY_DENIAL_CODES,
  RUN_REASONS,
  TERMINAL_RUN_STATUSES,
  TOOL_NAMES,
} from "../../../src/contracts/index.js";
import type { MessageParamKind } from "../../../src/contracts/index.js";
import { cleanLine, formatParam, HIDDEN_KEY, MESSAGE_CODES, REPLACEMENT } from "../../../src/i18n/index.js";
import { KEY_SHAPED } from "./support.js";

function show(kind: MessageParamKind, value: unknown, own: readonly string[] = []): string {
  return formatParam(kind, value, "en", (text) => own.includes(text));
}

describe("i18n params: numbers and codes", () => {
  test("count: non-negative safe integers only", () => {
    assert.equal(show("count", 0), "0");
    assert.equal(show("count", 150000), "150000");
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, "3", null, undefined, {}]) {
      assert.equal(show("count", value), REPLACEMENT, String(value));
    }
  });

  test("code: the contracts' fixed codes only", () => {
    for (const code of [...Object.keys(CLI_ERROR_EXIT_CODES), ...TERMINAL_RUN_STATUSES, ...RUN_REASONS, ...POLICY_DENIAL_CODES]) {
      assert.equal(show("code", code), code);
    }
    for (const code of ["pass", "inconclusive", "anthropic", "scripted", "before_verify", "auth_failed", "changed_since_run", "default"]) {
      assert.ok(MESSAGE_CODES.has(code), code);
    }
    for (const value of ["probe-code", "Done", "done ", "needs input", "__proto__", "toString", "", 3, null]) {
      assert.equal(show("code", value), REPLACEMENT, String(value));
    }
  });

  test("name: tool names only (verifier ids and profile names come from files)", () => {
    for (const tool of TOOL_NAMES) assert.equal(show("name", tool), tool);
    for (const value of ["unit-tests", "doc", "customer private memo", ""]) assert.equal(show("name", value), REPLACEMENT, value);
  });

  test("runId: the generated run id form only", () => {
    assert.equal(show("runId", "20261111T233839Z-d9c21658"), "20261111T233839Z-d9c21658");
    for (const value of ["latest", "run-1", "20261111T233839Z-D9C21658", "20261111T233839Z-d9c21658\n", ""]) {
      assert.equal(show("runId", value), REPLACEMENT, value);
    }
  });

  test("path: the fixed config location displays only", () => {
    for (const display of Object.values(DEFAULT_CONFIG_DISPLAY)) assert.equal(show("path", display), display);
    assert.equal(show("path", "--config"), "--config");
    for (const value of ["C:\\Users\\a\\AppData\\Roaming\\Codaryn\\config.json", "tests", "docs/INSTALL.md", ""]) {
      assert.equal(show("path", value), REPLACEMENT, value);
    }
  });

  test("command: codaryn or npm with known words, run ids, placeholders and numbers only", () => {
    for (const value of [
      "codaryn doctor",
      "codaryn models --use <number>",
      "codaryn models --use 3",
      "codaryn revert --workspace <workspace> --run 20261111T233839Z-d9c21658 --dry-run",
      "codaryn report --workspace <workspace> --run latest",
      "npm run build",
      "npm test",
    ]) {
      assert.equal(show("command", value), value);
    }
    for (const value of [
      "codaryn revert --workspace D:\\work --run 20261111T233839Z-d9c21658",
      "codaryn run probe-goal",
      "npm run probe-script",
      "rm -rf x",
      "codaryn  doctor",
      " codaryn",
      "codaryn <Workspace>",
      `codaryn ${KEY_SHAPED}`,
      "codaryn\ndoctor",
      `codaryn ${"--json ".repeat(60)}`.trim(),
      "",
      7,
    ]) {
      assert.equal(show("command", value), REPLACEMENT, String(value));
    }
  });

  test("text and detail: only text the catalog produced", () => {
    assert.equal(show("text", "완료", ["완료"]), "완료");
    assert.equal(show("detail", "완료", ["완료"]), "완료");
    assert.equal(show("text", "완료"), REPLACEMENT);
    assert.equal(show("detail", 3, ["3"]), REPLACEMENT);
  });
});

describe("i18n params: field positions", () => {
  test("contract field names and indexes pass", () => {
    assert.equal(show("field", "policy.commands[2].argsPrefix"), "policy.commands[2].argsPrefix");
    assert.equal(show("field", "verifiers[0].rules[3].path"), "verifiers[0].rules[3].path");
    assert.equal(show("field", "steps[4].toolCalls[0].name"), "steps[4].toolCalls[0].name");
    assert.equal(show("field", "policy.commands[007]"), "policy.commands[7]");
  });

  test("a name the contracts do not define is shown as ?", () => {
    assert.equal(show("field", "profiles.probeProfile.limits.maxModelTurns"), "profiles.?.limits.maxModelTurns");
    assert.equal(show("field", "modle"), "?");
    assert.equal(show("field", "__proto__.constructor"), "?.?");
  });

  test("the top level is a word in each language", () => {
    assert.equal(formatParam("field", "", "ko", () => false), "최상위");
    assert.equal(formatParam("field", "", "en", () => false), "top level");
  });

  test("anything that is not a position is ? as a whole", () => {
    for (const value of ["[0]", "policy..commands", "policy.", ".policy", "policy.commands[]", "policy.commands[1234567]", "policy commands", "policy/commands", "policy.commands[2]x", "1policy", `policy.${"a".repeat(300)}`, null, 7]) {
      assert.equal(show("field", value), REPLACEMENT, String(value));
    }
  });
});

describe("i18n params: cleanLine", () => {
  test("replaces controls and line breaks and hides key-shaped text", () => {
    assert.equal(cleanLine("a\r\nb\tc\u2028d\u0085e\u202ef"), "a??b?c?d?e?f");
    assert.equal(cleanLine(`x ${KEY_SHAPED} y`), `x ${HIDDEN_KEY} y`);
    assert.equal(cleanLine("한국어 그대로"), "한국어 그대로");
  });
});
