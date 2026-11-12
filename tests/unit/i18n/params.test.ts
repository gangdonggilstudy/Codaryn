/** N-14 parameter kinds: what each kind accepts at run time, and that anything else is the replacement mark. */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_CONFIG_DISPLAY,
  INIT_SUGGESTED_COMMANDS,
  INIT_SUGGESTED_PROTECTED_PATHS,
  INTEGRITY_PHASES,
  MODEL_ERROR_KINDS,
  PERMISSION_KINDS,
  POLICY_DENIAL_CODES,
  RUN_REASONS,
  TERMINAL_RUN_STATUSES,
  TOOL_ERROR_CODES,
} from "../../../src/contracts/index.js";
import type { MessageParamKind } from "../../../src/contracts/index.js";
import { cleanLine, CLOSED_KIND_VALUES, formatParam, HIDDEN_KEY, REPLACEMENT } from "../../../src/i18n/index.js";
import { KEY_SHAPED } from "./support.js";

function show(kind: MessageParamKind, value: unknown, own: readonly string[] = []): string {
  return formatParam(kind, value, (text) => own.includes(text));
}

describe("i18n params: numbers", () => {
  test("count: non-negative safe integers only", () => {
    assert.equal(show("count", 0), "0");
    assert.equal(show("count", 150000), "150000");
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, "3", null, undefined, {}]) {
      assert.equal(show("count", value), REPLACEMENT, String(value));
    }
  });
});

describe("i18n params: closed codes and fixed strings", () => {
  test("each closed kind accepts exactly the contract's list", () => {
    const expected: [MessageParamKind, readonly string[]][] = [
      ["status", TERMINAL_RUN_STATUSES],
      ["reason", RUN_REASONS],
      ["permission", PERMISSION_KINDS],
      ["denial", [...POLICY_DENIAL_CODES, ...TOOL_ERROR_CODES]],
      ["modelError", MODEL_ERROR_KINDS],
      ["phase", INTEGRITY_PHASES],
      ["provider", ["scripted", "anthropic"]],
      ["location", [...Object.values(DEFAULT_CONFIG_DISPLAY), "--config", "CODARYN_CONFIG"]],
      ["suggestedCommand", INIT_SUGGESTED_COMMANDS],
      ["suggestedPath", INIT_SUGGESTED_PROTECTED_PATHS],
    ];
    for (const [kind, values] of expected) {
      assert.deepEqual([...CLOSED_KIND_VALUES[kind as keyof typeof CLOSED_KIND_VALUES]].sort(), [...values].sort(), kind);
      for (const value of values) assert.equal(show(kind, value), value, `${kind} ${value}`);
    }
  });

  test("a code of another kind, a near miss or a prototype name is the replacement mark", () => {
    const cases: [MessageParamKind, unknown][] = [
      ["status", "verified"],
      ["status", "Done"],
      ["status", "done "],
      ["reason", "needs-input"],
      ["permission", "command_not_allowed"],
      ["denial", "command"],
      ["modelError", "probe"],
      ["phase", "start"],
      ["provider", "openai"],
      ["location", "C:\\Users\\a\\AppData\\Roaming\\Codaryn\\config.json"],
      ["location", "~/.config/codaryn/other.json"],
      ["suggestedCommand", "npm run probe"],
      ["suggestedCommand", "codaryn doctor"],
      ["suggestedPath", "src"],
      ["status", "__proto__"],
      ["reason", "toString"],
      ["status", 1],
      ["status", null],
    ];
    for (const [kind, value] of cases) assert.equal(show(kind, value), REPLACEMENT, `${kind} ${String(value)}`);
  });
});

describe("i18n params: field positions, run ids and catalog text", () => {
  test("field: schema positions only, by the contract's toSchemaFieldPath", () => {
    for (const value of ["policy.commands[2].argsPrefix", "verifiers[0].rules[3].path", "steps[4].toolCalls[0].name", "config", "profiles[3].limits"]) {
      assert.equal(show("field", value), value);
    }
    for (const value of ["", "modle", "profiles.probeProfile.limits", "policy.commands[007]", "[0]", "policy..commands", "policy commands", "1policy", `policy.${"a".repeat(300)}`, null, 7]) {
      assert.equal(show("field", value), REPLACEMENT, String(value));
    }
  });

  test("runId: the run directory rule, by the contract's toRunId", () => {
    for (const value of ["20261111T233839Z-d9c21658", "run-1"]) assert.equal(show("runId", value), value);
    for (const value of ["a..b", "-run", "a/b", "a b", "x".repeat(129), "", 3]) assert.equal(show("runId", value), REPLACEMENT, String(value));
  });

  test("text: only text the catalog produced", () => {
    assert.equal(show("text", "완료", ["완료"]), "완료");
    assert.equal(show("text", "완료"), REPLACEMENT);
    assert.equal(show("text", 3, ["3"]), REPLACEMENT);
  });
});

describe("i18n params: cleanLine", () => {
  test("replaces controls and line breaks and hides key-shaped text", () => {
    assert.equal(cleanLine("a\r\nb\tc\u2028d\u0085e\u202ef"), "a??b?c?d?e?f");
    assert.equal(cleanLine(`x ${KEY_SHAPED} y`), `x ${HIDDEN_KEY} y`);
    assert.equal(cleanLine("한국어 그대로"), "한국어 그대로");
  });
});
