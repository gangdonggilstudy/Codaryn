/**
 * Fix batch T contract values (T-3, T-6, T-10, T-13, T-14). Other modules rely on these exact values.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_COMMAND_TIMEOUT_MS,
  MAX_EVIDENCE_BYTES,
  MAX_OUTPUT_TOKENS_LIMIT,
  PROTECTED_PATH_PROBLEMS,
  TOOL_DEFINITIONS,
} from "../../../src/contracts/index.js";
import type { JsonObject, RevertSkipReason } from "../../../src/contracts/index.js";

test("T-3 the run_command schema states the timeout cap the engine enforces", () => {
  assert.equal(MAX_COMMAND_TIMEOUT_MS, 600_000);
  const properties = TOOL_DEFINITIONS.run_command.inputSchema["properties"] as JsonObject;
  assert.deepEqual(properties["timeoutMs"], { type: "integer", minimum: 1, maximum: MAX_COMMAND_TIMEOUT_MS });
});

test("T-6, T-14 caps", () => {
  assert.equal(MAX_EVIDENCE_BYTES, 8192);
  assert.equal(MAX_OUTPUT_TOKENS_LIMIT, 200_000);
});

test("T-10, T-13 reason lists", () => {
  const missing: RevertSkipReason = "missing_record";
  assert.equal(missing, "missing_record");
  assert.deepEqual([...PROTECTED_PATH_PROBLEMS], ["not_a_list", "not_a_string", "empty", "absolute", "parent_segment", "invalid_name"]);
});
