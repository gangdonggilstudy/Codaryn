/**
 * U-143 (SP-U10, design gap survey C-9): every tool definition both providers receive keeps to the
 * contract's JSON Schema subset (TOOL_SCHEMA_KEYWORDS) and its name to TOOL_NAME_PATTERN_SOURCE.
 * The walk visits every schema node of every built-in and task type tool; the keys of `properties`
 * are property names, not keywords. Only a test and two contract constants: no definition changed.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TOOL_DEFINITIONS, TOOL_NAME_PATTERN_SOURCE, TOOL_SCHEMA_KEYWORDS, WORKFLOW_TOOL_DEFINITIONS } from "../../../src/contracts/index.js";
import type { JsonObject, JsonValue } from "../../../src/contracts/index.js";

const JSON_TYPES = ["object", "array", "string", "integer", "number", "boolean", "null"];
const DEFINITIONS: readonly (readonly [string, JsonObject])[] = Object.entries({ ...TOOL_DEFINITIONS, ...WORKFLOW_TOOL_DEFINITIONS }).map(([name, definition]) => [name, definition.inputSchema]);

const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

/** Every problem of one schema node and the nodes under it, as `<tool> <path>: <problem>`. */
function problems(node: JsonValue, where: string): string[] {
  if (Array.isArray(node)) return node.flatMap((item, index) => problems(item, `${where}[${index}]`));
  if (!isObject(node)) return [];
  const found: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (!(TOOL_SCHEMA_KEYWORDS as readonly string[]).includes(key)) found.push(`${where}: keyword ${key} is outside the subset`);
    if (key === "additionalProperties" && value !== false) found.push(`${where}: additionalProperties is not false`);
    if (key === "type") {
      const types = Array.isArray(value) ? value : [value];
      const shapeOk = types.length === 1 || (types.length === 2 && types[1] === "null");
      if (!shapeOk || !types.every((type) => typeof type === "string" && JSON_TYPES.includes(type))) found.push(`${where}: type ${JSON.stringify(value)}`);
    }
    if (key === "properties" && isObject(value)) {
      for (const [name, property] of Object.entries(value)) found.push(...problems(property, `${where}.properties.${name}`));
    } else if (key === "items" || key === "anyOf") {
      found.push(...problems(value, `${where}.${key}`));
    }
  }
  if (Array.isArray(node["required"])) {
    const keys = isObject(node["properties"]) ? Object.keys(node["properties"]) : [];
    for (const name of node["required"]) if (typeof name !== "string" || !keys.includes(name)) found.push(`${where}: required ${String(name)} is not a property`);
  }
  return found;
}

describe("U-143 SP-U10: the tool schemas both providers receive", () => {
  test("every built-in and task type tool keeps to TOOL_SCHEMA_KEYWORDS and its rules", () => {
    assert.ok(DEFINITIONS.length >= 6);
    const all = DEFINITIONS.flatMap(([name, schema]) => problems(schema, name));
    assert.deepEqual(all, []);
  });

  test("every tool name fits TOOL_NAME_PATTERN_SOURCE", () => {
    const pattern = new RegExp(TOOL_NAME_PATTERN_SOURCE);
    for (const [name] of DEFINITIONS) assert.match(name, pattern, name);
  });

  test("the walk finds what it should: a keyword outside the subset, a loose additionalProperties, a missing required property", () => {
    const bad: JsonObject = {
      type: "object",
      properties: { a: { type: "string", format: "uri" }, b: { type: ["string", "integer"] } },
      required: ["a", "c"],
      additionalProperties: true,
    };
    assert.deepEqual(problems(bad, "bad"), [
      "bad.properties.a: keyword format is outside the subset",
      'bad.properties.b: type ["string","integer"]',
      "bad: additionalProperties is not false",
      "bad: required c is not a property",
    ]);
  });

  test("the subset is the one second-provider 4.9 lists, each keyword once", () => {
    assert.equal(new Set(TOOL_SCHEMA_KEYWORDS).size, TOOL_SCHEMA_KEYWORDS.length);
    assert.deepEqual([...TOOL_SCHEMA_KEYWORDS].sort(), ["additionalProperties", "anyOf", "const", "description", "enum", "items", "maxItems", "maxLength", "maximum", "minItems", "minLength", "minimum", "pattern", "properties", "required", "type"]);
  });
});
