/**
 * U-37 (UXM-2, DR-57; the U-19 survey, section 3 G): an argument, input or setting error said its
 * reason in the English `message` only; the human error said "the command arguments are not valid"
 * and nothing more. The reasons become CliErrorOutput.hint codes, so the human error tells them in
 * the chosen language and JSON readers get only more values of `hint`.
 *
 * A hint whose line needs a value (which argument, which field, which settings) takes it from
 * CliErrorHintDetail, kept under a symbol key: JSON.stringify leaves it out, so the JSON line is the
 * same but for `hint`. An unknown option is told by its position, never by its name (DR-57).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ALL_CLI_ERROR_HINTS,
  API_KEY_ENVS,
  API_MODEL_ENVS,
  CLI_ERROR_HINT_DETAIL,
  CLI_ERROR_HINTS,
  DETAILED_CLI_ERROR_HINTS,
  FIXED_MESSAGES,
  MESSAGE_IDS,
  PROVIDER_SETTINGS,
  messageParams,
  toSchemaFieldPath,
} from "../../../src/contracts/index.js";
import type { CliErrorHintDetail, CliErrorOutput, MessageId, ProviderSettingMissing, SchemaFieldPath } from "../../../src/contracts/index.js";

const PLAIN = [
  "quick_form_needs_task",
  "unknown_command",
  "workspace_goal_together",
  "apply_needs_run_id",
  "digest_form",
  "review_needs_verdict",
  "run_id_form",
  "version_no_json",
  "task_file_unreadable",
  "input_too_large",
  "input_inside_workspace",
  "profile_needs_config",
  "profile_not_found",
  "task_type_not_found",
  "key_in_goal",
  "key_in_task",
  "key_in_config",
  // U-115 (UXM-9, PM: in na-core's branch for p4g-general to confirm): no config file at all.
  "config_missing",
  // U-228 (nd-docs' findings, in na-core's branch for p4g-general to confirm): a plan of another kind
  // than the task carries out, and a plan mode without its plan tool (U-224).
  "plan_kind_differs",
  "plan_tool_missing",
];
const DETAILED: { readonly [hint: string]: { readonly [param: string]: string } } = {
  unknown_option: { position: "count" },
  key_field_in_task: { field: "field" },
  key_field_in_config: { field: "field" },
  provider_settings_missing: {},
};
const ITEMS: { readonly [id: string]: { readonly [param: string]: string } } = {
  "error.missing.key": { keyEnv: "keyEnv" },
  "error.missing.model": { variable: "settingEnv", field: "field" },
  "error.missing.model_placeholder": { variable: "settingEnv", field: "field" },
  "error.missing.output_limit": { field: "field" },
};

describe("U-37: the reasons of argument, input and setting errors are hints", () => {
  test("the hint codes: the plain ones and those whose line needs a value", () => {
    // The listed ones keep their name, so a renderer that knows only them leaves the others out.
    assert.deepEqual([...CLI_ERROR_HINTS], PLAIN);
    assert.deepEqual([...DETAILED_CLI_ERROR_HINTS], Object.keys(DETAILED));
    assert.deepEqual([...ALL_CLI_ERROR_HINTS], [...PLAIN, ...Object.keys(DETAILED)]);
  });

  test("a plain hint is a listed id without parameters; a detailed one a fixed id with its value", () => {
    const ids = MESSAGE_IDS as readonly string[];
    for (const hint of PLAIN) {
      const id = `error.hint.${hint}`;
      assert.equal(ids.filter((entry) => entry === id).length, 1, id);
      assert.equal(Object.hasOwn(FIXED_MESSAGES, id), false, id);
      assert.deepEqual(messageParams(id as MessageId), {}, id);
    }
    for (const [hint, params] of Object.entries(DETAILED)) {
      const id = `error.hint.${hint}`;
      assert.equal(ids.filter((entry) => entry === id).length, 1, id);
      assert.ok(Object.hasOwn(FIXED_MESSAGES, id), id);
      assert.deepEqual(messageParams(id as MessageId), params, id);
    }
  });

  test("each setting not set is one item after provider_settings_missing, in a fixed order", () => {
    assert.deepEqual([...PROVIDER_SETTINGS], ["key", "model", "output_limit"]);
    const ids = MESSAGE_IDS as readonly string[];
    for (const [id, params] of Object.entries(ITEMS)) {
      assert.equal(ids.filter((entry) => entry === id).length, 1, id);
      assert.deepEqual(messageParams(id as MessageId), params, id);
    }
    const field = (text: string): SchemaFieldPath => toSchemaFieldPath(text) as SchemaFieldPath;
    const missing: ProviderSettingMissing[] = [
      { setting: "key", keyEnv: API_KEY_ENVS[0] },
      { setting: "model", modelEnv: API_MODEL_ENVS[1], field: field("providers.openai.model"), placeholder: true },
      { setting: "output_limit", field: field("maxOutputTokens") },
    ];
    assert.deepEqual(missing.map((item) => item.setting), [...PROVIDER_SETTINGS]);
  });

  test("the detail is for the human line only: the JSON line has the hint and no detail", () => {
    const detail: CliErrorHintDetail = { position: 3 };
    const output: CliErrorOutput = {
      schemaVersion: 1,
      kind: "error",
      code: "invalid_arguments",
      exitCode: 2,
      message: "unknown or repeated option",
      hint: "unknown_option",
      [CLI_ERROR_HINT_DETAIL]: detail,
    };
    assert.equal(typeof CLI_ERROR_HINT_DETAIL, "symbol");
    assert.equal(JSON.stringify(output), '{"schemaVersion":1,"kind":"error","code":"invalid_arguments","exitCode":2,"message":"unknown or repeated option","hint":"unknown_option"}');
    // A copy made with a spread keeps it (as withQuickFormHint makes one).
    assert.deepEqual({ ...output, message: "x" }[CLI_ERROR_HINT_DETAIL], { position: 3 });
    // @ts-expect-error the detail holds no free text: an option's name has no place in it
    const named: CliErrorHintDetail = { option: "--frobnicate" };
    assert.ok(named);
  });
});
