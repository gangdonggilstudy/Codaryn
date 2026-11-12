/** N-14 parameter kinds: what each kind accepts at run time, and that anything else is the replacement mark. */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  API_KEY_ENVS,
  DEFAULT_CONFIG_DISPLAY,
  INIT_SUGGESTED_COMMANDS,
  INIT_SUGGESTED_PROTECTED_PATHS,
  INTEGRITY_PHASES,
  MODEL_ERROR_KINDS,
  MODEL_PROVIDER_NAMES,
  PERMISSION_KINDS,
  POLICY_DENIAL_CODES,
  RUN_REASONS,
  TERMINAL_RUN_STATUSES,
  TOOL_ERROR_CODES,
} from "../../../src/contracts/index.js";
import type { MessageParamKind } from "../../../src/contracts/index.js";
import { cleanLine, CLOSED_KIND_VALUES, formatParam, HIDDEN_KEY, REPLACEMENT } from "../../../src/i18n/index.js";
import { KEY_SHAPED, OPENAI_KEY_SHAPED, OPENAI_LEGACY_SHAPED, OPENAI_LOOSE_SHAPED } from "./support.js";

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

describe("i18n params: seconds (N-20)", () => {
  test("non-negative numbers with at most one decimal place, in decimal digits", () => {
    for (const [value, shown] of [
      [0, "0"],
      [12, "12"],
      [4.2, "4.2"],
      [0.1, "0.1"],
      [0.30000000000000004, "0.3"],
      [59.9, "59.9"],
      [3600, "3600"],
    ] as const) {
      assert.equal(show("seconds", value), shown, String(value));
    }
  });

  test("anything else is the replacement mark", () => {
    for (const value of [-0.1, 1.25, Number.NaN, Number.POSITIVE_INFINITY, 1e12, "4.2", null, undefined, {}]) {
      assert.equal(show("seconds", value), REPLACEMENT, String(value));
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
      ["provider", MODEL_PROVIDER_NAMES],
      ["location", [...Object.values(DEFAULT_CONFIG_DISPLAY), "--config", "CODARYN_CONFIG"]],
      ["suggestedCommand", INIT_SUGGESTED_COMMANDS],
      ["suggestedPath", INIT_SUGGESTED_PROTECTED_PATHS],
      ["language", ["ko", "en"]],
      ["keyEnv", API_KEY_ENVS],
    ];
    assert.ok(MODEL_PROVIDER_NAMES.includes("openai"), "the second provider's name is shown as itself");
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
      ["provider", "OpenAI"],
      ["provider", "codex"],
      ["keyEnv", "ANTHROPIC_API_KEY "],
      ["location", "C:\\Users\\a\\AppData\\Roaming\\Codaryn\\config.json"],
      ["location", "~/.config/codaryn/other.json"],
      ["suggestedCommand", "npm run probe"],
      ["suggestedCommand", "codaryn doctor"],
      ["suggestedPath", "src"],
      ["language", "KO"],
      ["language", "ja"],
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
  });

  test("OpenAI key shapes, narrow and loose, are hidden too (DR-32 (a), DR-33, API_KEY_MASK_PATTERN_SOURCES)", () => {
    const BEL = String.fromCharCode(0x07);
    assert.equal(cleanLine(`x ${OPENAI_KEY_SHAPED} y`), `x ${HIDDEN_KEY} y`);
    assert.equal(cleanLine(`x ${OPENAI_LEGACY_SHAPED} y`), `x ${HIDDEN_KEY} y`);
    assert.equal(cleanLine(`x ${OPENAI_LOOSE_SHAPED} y`), `x ${HIDDEN_KEY} y`);
    assert.equal(cleanLine(`a ${OPENAI_KEY_SHAPED.slice(0, 12)}${BEL}${OPENAI_KEY_SHAPED.slice(12)} b`), `a ${HIDDEN_KEY} b`);
    assert.equal(cleanLine(`${KEY_SHAPED} ${OPENAI_KEY_SHAPED}`), `${HIDDEN_KEY} ${HIDDEN_KEY}`);
    // Too short for the loose shape, or not at a word start: shown as it is.
    assert.equal(cleanLine("sk-short-name"), "sk-short-name");
    assert.equal(cleanLine(`task${OPENAI_LOOSE_SHAPED}`), `task${OPENAI_LOOSE_SHAPED}`);
  });

  test("a key variable is shown only as one of the contract's names (keyEnv, SP-D12)", () => {
    for (const name of API_KEY_ENVS) assert.equal(show("keyEnv", name), name);
    for (const value of ["SOME_OTHER_KEY", KEY_SHAPED, OPENAI_KEY_SHAPED, "anthropic_api_key", "", 1]) {
      assert.equal(show("keyEnv", value), REPLACEMENT, String(value));
    }
  });

  test("a key shape broken up by control characters is still hidden (N-23 h, review R-2 L-5)", () => {
    const BEL = String.fromCharCode(0x07);
    const ESC = String.fromCharCode(0x1b);
    const RLO = String.fromCharCode(0x202e);
    const LF = String.fromCharCode(0x0a);
    // R-2's input: `sk-ant-AB<BEL>CDEF…` with 30 more key characters.
    assert.equal(cleanLine(`created sk-ant-AB${BEL}CDEFGHIJKLMNOPQRSTUVWXYZ012345`), `created ${HIDDEN_KEY}`);
    assert.equal(cleanLine(`a ${KEY_SHAPED.slice(0, 9)}${ESC}${RLO}${KEY_SHAPED.slice(9)} tail${LF}`), `a ${HIDDEN_KEY} tail?`);
    assert.equal(cleanLine(`${BEL}${KEY_SHAPED}${BEL}`), `?${HIDDEN_KEY}?`);
    assert.equal(cleanLine(`${KEY_SHAPED} ${BEL} ${KEY_SHAPED}`), `${HIDDEN_KEY} ? ${HIDDEN_KEY}`);
    assert.equal(cleanLine(`sk-ant-short${BEL}`), "sk-ant-short?");
    assert.equal(cleanLine(`sk-ant-${BEL}`), "sk-ant-?");
    assert.equal(cleanLine("한국어 그대로"), "한국어 그대로");
  });
});
