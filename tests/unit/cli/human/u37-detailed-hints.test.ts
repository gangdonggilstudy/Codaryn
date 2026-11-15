/**
 * U-37 (UXM-2, DR-57; review R-69 M1), the human renderer's part: the four hints whose line takes a
 * value (DETAILED_CLI_ERROR_HINTS) were in the JSON only. The error now draws them from the error's
 * CLI_ERROR_HINT_DETAIL (a symbol key, never in the JSON line), in the place of the other hints:
 * - unknown_option: error.hint.unknown_option with the argument's position (counted from 1);
 * - key_field_in_task, key_field_in_config: their line with the SchemaFieldPath;
 * - provider_settings_missing: its line, then one item line per setting not set (error.missing.key,
 *   .model or .model_placeholder, .output_limit), in PROVIDER_SETTINGS order.
 * A detail that is absent or does not fit (a position that is not a count above 0, a field that is
 * not a schema path, an unknown name, items out of order, twice or none) leaves the hint's lines out,
 * never an exception and never part of them. Real catalogs, both languages; fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CLI_ERROR_HINT_DETAIL, MESSAGE_LANGUAGES, toSchemaFieldPath } from "../../../../src/contracts/index.js";
import type { CatalogText, CliErrorOutput, MessageCatalog, SchemaFieldPath } from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const field = (path: string): SchemaFieldPath => {
  const shown = toSchemaFieldPath(path);
  assert.ok(shown !== null, path);
  return shown;
};
const error = (code: string, hint: string | undefined, detail?: unknown): CliErrorOutput =>
  ({ schemaVersion: 1, kind: "error", code, exitCode: 2, message: "m", ...(hint === undefined ? {} : { hint }), ...(detail === undefined ? {} : { [CLI_ERROR_HINT_DETAIL]: detail }) }) as unknown as CliErrorOutput;
const KEY = { setting: "key", keyEnv: "ANTHROPIC_API_KEY" };
const MODEL = { setting: "model", modelEnv: "CODARYN_MODEL", field: "model", placeholder: false };
const PLACEHOLDER = { setting: "model", modelEnv: "CODARYN_OPENAI_MODEL", field: "providers.openai.model", placeholder: true };
const LIMIT = { setting: "output_limit", field: "maxOutputTokens" };

for (const language of MESSAGE_LANGUAGES) {
  const catalog = createMessageCatalog(language);
  const format = catalog.format as (id: string, ...rest: unknown[]) => CatalogText;
  const out = createHumanOutput(catalog);
  const linesOf = (output: CliErrorOutput): string[] => out.error(output).trimEnd().split("\n");
  /** The error's lines without any hint: what an error with a detail that does not fit gives. */
  const plain = (code: string): string[] => linesOf(error(code, undefined));

  describe(`U-37 (R-69 M1), ${language}: the hints that take a value are drawn from the error's detail`, () => {
    test("unknown_option: one line with the argument's position, after the fix line", () => {
      for (const position of [1, 3, 12]) {
        const lines = linesOf(error("invalid_arguments", "unknown_option", { position }));
        assert.deepEqual(lines, [...plain("invalid_arguments"), `  ${format("error.hint.unknown_option", { position })}`]);
        assert.ok(lines.at(-1)?.includes(String(position)), lines.join("\n"));
      }
    });

    test("key_field_in_task and key_field_in_config: one line with the field's place", () => {
      for (const [hint, place] of [["key_field_in_task", "model.model"], ["key_field_in_config", "providers.anthropic.model"]] as const) {
        const lines = linesOf(error("key_in_file", hint, { field: place }));
        assert.deepEqual(lines, [...plain("key_in_file"), `  ${format(`error.hint.${hint}`, { field: field(place) })}`]);
      }
    });

    test("provider_settings_missing: its line, then one item per setting not set, in order", () => {
      const lines = linesOf(error("provider_not_configured", "provider_settings_missing", { missing: [KEY, MODEL, LIMIT] }));
      assert.deepEqual(lines, [
        ...plain("provider_not_configured"),
        `  ${format("error.hint.provider_settings_missing")}`,
        `    - ${format("error.missing.key", { keyEnv: "ANTHROPIC_API_KEY" })}`,
        `    - ${format("error.missing.model", { variable: "CODARYN_MODEL", field: field("model") })}`,
        `    - ${format("error.missing.output_limit", { field: field("maxOutputTokens") })}`,
      ]);
      const some = linesOf(error("provider_not_configured", "provider_settings_missing", { missing: [PLACEHOLDER] }));
      assert.deepEqual(some.slice(-2), [
        `  ${format("error.hint.provider_settings_missing")}`,
        `    - ${format("error.missing.model_placeholder", { variable: "CODARYN_OPENAI_MODEL", field: field("providers.openai.model") })}`,
      ]);
      assert.deepEqual(linesOf(error("provider_not_configured", "provider_settings_missing", { missing: [KEY, LIMIT] })).slice(-2), [
        `    - ${format("error.missing.key", { keyEnv: "ANTHROPIC_API_KEY" })}`,
        `    - ${format("error.missing.output_limit", { field: field("maxOutputTokens") })}`,
      ]);
    });

    test("a detail that is absent or does not fit: no hint line, no exception", () => {
      const cases: [string, string, string, unknown][] = [
        ["invalid_arguments", "unknown_option", "no detail", undefined],
        ["invalid_arguments", "unknown_option", "position 0", { position: 0 }],
        ["invalid_arguments", "unknown_option", "position -1", { position: -1 }],
        ["invalid_arguments", "unknown_option", "position 1.5", { position: 1.5 }],
        ["invalid_arguments", "unknown_option", "position as text", { position: "3" }],
        ["invalid_arguments", "unknown_option", "a field in place of a position", { field: "model" }],
        ["key_in_file", "key_field_in_task", "a field that is not a schema path", { field: "model.apiKey" }],
        ["key_in_file", "key_field_in_config", "no field", { position: 2 }],
        ["provider_not_configured", "provider_settings_missing", "no items", { missing: [] }],
        ["provider_not_configured", "provider_settings_missing", "not a list", { missing: KEY }],
        ["provider_not_configured", "provider_settings_missing", "out of order", { missing: [LIMIT, KEY] }],
        ["provider_not_configured", "provider_settings_missing", "twice", { missing: [KEY, KEY] }],
        ["provider_not_configured", "provider_settings_missing", "an unknown setting", { missing: [{ setting: "base_url" }] }],
        ["provider_not_configured", "provider_settings_missing", "an unknown key variable", { missing: [{ setting: "key", keyEnv: "MY_KEY" }] }],
        ["provider_not_configured", "provider_settings_missing", "a model without its field", { missing: [{ setting: "model", modelEnv: "CODARYN_MODEL", placeholder: false }] }],
        ["provider_not_configured", "provider_settings_missing", "placeholder not a boolean", { missing: [{ ...MODEL, placeholder: "yes" }] }],
        ["provider_not_configured", "provider_settings_missing", "one good item, one bad", { missing: [KEY, { setting: "output_limit", field: "x..y" }] }],
        ["provider_not_configured", "provider_settings_missing", "detail not an object", 7],
      ];
      for (const [code, hint, name, detail] of cases) assert.deepEqual(linesOf(error(code, hint, detail)), plain(code), name);
    });

    test("a detailed hint's detail never reaches the JSON line; a listed hint is drawn as before", () => {
      const output = error("invalid_arguments", "unknown_option", { position: 2 });
      assert.equal(JSON.stringify(output).includes("position"), false);
      assert.deepEqual(linesOf(error("invalid_arguments", "run_id_form")), [...plain("invalid_arguments"), `  ${format("error.hint.run_id_form")}`]);
    });
  });
}

describe("U-37: the item lines keep their order whatever the catalog", () => {
  test("every item is one line, two spaces deeper than the hint", () => {
    const catalog: MessageCatalog = createMessageCatalog("en");
    const text = createHumanOutput(catalog).error(error("provider_not_configured", "provider_settings_missing", { missing: [KEY, PLACEHOLDER, LIMIT] }));
    const items = text.split("\n").filter((line) => line.startsWith("    - "));
    assert.equal(items.length, 3, text);
  });
});
