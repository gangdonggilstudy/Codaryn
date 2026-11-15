/**
 * TOOL_DEFINITIONS reach the model without passing the privacy gateway, so they must be plain
 * fixed text. Their schemas must also agree with the engine's shape validation.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE, TOOL_DEFINITIONS, TOOL_NAMES } from "../../../src/contracts/index.js";
import type { JsonObject, JsonValue, ToolName } from "../../../src/contracts/index.js";
import { validateToolArgs } from "../../../src/engine/validate-args.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";

const FRAGMENT = new RegExp(PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE, "i");
const HASH = "a".repeat(64);

function strings(value: JsonValue): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value as JsonObject).flatMap(([key, item]) => [key, ...strings(item)]);
  }
  return [];
}

/** Arguments using every property each schema declares. */
const FULL_ARGS: { readonly [N in ToolName]: JsonObject } = {
  read_file: { path: "notes.md" },
  search_files: { path: ".", nameContains: ".md", text: "todo" },
  write_file: { path: "notes.md", expectedHash: HASH, change: { kind: "replace_text", oldText: "a", newText: "b" } },
  run_command: { executable: "node", args: ["--version"], cwd: ".", timeoutMs: 1000 },
};

test("every tool has exactly one definition", () => {
  assert.deepEqual(Object.keys(TOOL_DEFINITIONS).sort(), [...TOOL_NAMES].sort());
});

test("definitions are fixed text the real gateway leaves unchanged", () => {
  const privacy = createPrivacyGateway({ secrets: ["fake-secret-VALUE-0002"] });
  for (const name of TOOL_NAMES) {
    const definition = TOOL_DEFINITIONS[name];
    for (const text of [definition.description, ...strings(definition.inputSchema)]) {
      assert.equal(FRAGMENT.test(text), false, `${name} spells the marker`);
      const masked = privacy.mask(text);
      assert.ok(masked.ok);
      assert.equal(masked.text, text);
    }
  }
});

test("schemas list the properties the engine accepts and nothing more", () => {
  for (const name of TOOL_NAMES) {
    const schema = TOOL_DEFINITIONS[name].inputSchema;
    assert.equal(schema["type"], "object");
    assert.equal(schema["additionalProperties"], false);
    const properties = Object.keys(schema["properties"] as JsonObject).sort();
    const required = schema["required"] as readonly string[];
    assert.ok(required.every((field) => properties.includes(field)), `${name} requires an undeclared field`);

    const full = FULL_ARGS[name];
    assert.deepEqual(Object.keys(full).sort(), properties);
    assert.notEqual(validateToolArgs(name, full), null, `${name} full args rejected`);
    const minimal = Object.fromEntries(Object.entries(full).filter(([key]) => required.includes(key)));
    assert.notEqual(validateToolArgs(name, minimal), null, `${name} required-only args rejected`);
    assert.equal(validateToolArgs(name, { ...full, extra: "x" }), null, `${name} accepts an extra field`);
  }
});

test("write_file accepts null and replace_all as the schema says", () => {
  const args = { path: "new.md", expectedHash: null, change: { kind: "replace_all", content: "" } };
  assert.notEqual(validateToolArgs("write_file", args), null);
});
