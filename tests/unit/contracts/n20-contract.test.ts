/**
 * N-20 to N-22: contract additions for the catalog (listed code words, seconds, yes/no defaults,
 * language source, help and doctor texts) and for revert and run lists.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLI_ERROR_EXIT_CODES,
  DOCTOR_CHECK_IDS,
  DOCTOR_HINT_ERROR_CODES,
  FIXED_MESSAGES,
  HELP_COMMANDS,
  INIT_QUESTION_DEFAULTS,
  LANGUAGE_SOURCES,
  MESSAGE_IDS,
  MODEL_ERROR_KINDS,
  PERMISSION_KINDS,
  POLICY_DENIAL_CODES,
  REVERT_SKIP_REASONS,
  TOOL_ERROR_CODES,
  messageParams,
  toSchemaFieldPath,
} from "../../../src/contracts/index.js";
import type { CatalogText, DoctorText, MessageCatalog, MessageLanguageChoice } from "../../../src/contracts/index.js";

const SYNTHETIC = "SYNTHETIC_PRIVATE_VALUE";

test("N-20: every denial code, permission kind, phase and model error kind has a word id", () => {
  const ids = new Set<string>(MESSAGE_IDS);
  for (const code of [...POLICY_DENIAL_CODES, ...TOOL_ERROR_CODES]) assert.ok(ids.has(`denial.${code}`), code);
  for (const kind of PERMISSION_KINDS) assert.ok(ids.has(`permission.${kind}`), kind);
  for (const phase of ["run_start", "before_verify", "after_verify"]) assert.ok(ids.has(`phase.${phase}`), phase);
  for (const kind of MODEL_ERROR_KINDS) assert.ok(ids.has(`modelError.${kind}`), kind);
  for (const source of LANGUAGE_SOURCES) assert.ok(ids.has(`language.source.${source}`), source);
  assert.equal(new Set(MESSAGE_IDS).size, MESSAGE_IDS.length, "no id is listed twice");
});

test("N-20: the run summary gives seconds, and seconds is its own kind", () => {
  assert.deepEqual(messageParams("summary.usage"), { turns: "count", toolCalls: "count", seconds: "seconds" });
  const catalog = { language: "en", format: (id: string) => id as CatalogText } as unknown as MessageCatalog;
  catalog.format("summary.usage", { turns: 1, toolCalls: 2, seconds: 4.2 });
  // @ts-expect-error milliseconds are no longer a parameter
  catalog.format("summary.usage", { turns: 1, toolCalls: 2, durationMs: 4200 });
  // @ts-expect-error seconds are a number, never text
  catalog.format("summary.usage", { turns: 1, toolCalls: 2, seconds: SYNTHETIC });
});

test("N-20: yes/no prompts show their default; widening questions default to no", () => {
  assert.equal(Object.hasOwn(FIXED_MESSAGES, "init.yes_no"), false);
  assert.ok(Object.hasOwn(FIXED_MESSAGES, "prompt.yes_no_default_yes") && Object.hasOwn(FIXED_MESSAGES, "prompt.yes_no_default_no"));
  assert.deepEqual(INIT_QUESTION_DEFAULTS, { confirm_create: "yes", commands_suggest: "no", protected_suggest: "yes" });
});

test("N-20: the language choice says where it came from, never the input values", () => {
  const choice: MessageLanguageChoice = { language: "ko", source: "env", envIgnored: false };
  // @ts-expect-error the raw CODARYN_LANG value is not part of the choice
  const leaky: MessageLanguageChoice = { ...choice, envValue: SYNTHETIC };
  assert.ok(leaky);
  assert.deepEqual(messageParams("language.chosen"), { language: "language", source: "text" });
});

test("N-21: help and doctor texts are catalog ids; doctor checks carry a typed text", () => {
  const ids = new Set<string>(MESSAGE_IDS);
  for (const command of HELP_COMMANDS) assert.ok(ids.has(`help.command.${command}`) && ids.has(`help.exit.${command}`), command);
  for (const id of DOCTOR_CHECK_IDS) assert.ok(ids.has(`doctor.check.${id}`), id);
  assert.deepEqual(DOCTOR_CHECK_IDS.slice(-2), ["language", "lock"]);
  const ok: DoctorText = { id: "doctor.vars_file.ok", params: { count: 2 } };
  const plain: DoctorText = { id: "doctor.api_key.ok" };
  // @ts-expect-error a doctor text cannot carry a file value
  const leaky: DoctorText = { id: "doctor.vars_file.ok", params: { count: SYNTHETIC } };
  // @ts-expect-error only doctor ids
  const other: DoctorText = { id: "summary.changes", params: { count: 1 } };
  assert.ok(ok && plain && leaky && other);
});

test("N-24, N-25: script usage fields are schema positions; the lock has a doctor check and a removal hint", () => {
  // Review R-3 R3-4 input.
  assert.equal(toSchemaFieldPath("steps[0].usage.inputTokens"), "steps[0].usage.inputTokens");
  assert.equal(toSchemaFieldPath("steps[0].usage.outputTokens"), "steps[0].usage.outputTokens");
  const ids = new Set<string>(MESSAGE_IDS);
  for (const id of ["doctor.check.lock", "doctor.lock.none", "doctor.lock.held", "doctor.lock.stale", "doctor.lock.unreadable", "lock.remove_hint"]) {
    assert.ok(ids.has(id), id);
  }
});

test("N-22: rejected calls, already reverted files and the doctor hint list", () => {
  assert.deepEqual(messageParams("progress.tool_rejected"), { tool: "text", code: "denial" });
  assert.ok((REVERT_SKIP_REASONS as readonly string[]).includes("already_reverted"));
  assert.ok(MESSAGE_IDS.includes("revert.skip.already_reverted"));
  for (const code of DOCTOR_HINT_ERROR_CODES) assert.ok(Object.hasOwn(CLI_ERROR_EXIT_CODES, code), code);
  assert.deepEqual([...DOCTOR_HINT_ERROR_CODES], [
    "invalid_config",
    "invalid_task",
    "key_in_file",
    "secret_env_missing",
    "workspace_is_install_dir",
    "provider_not_configured",
    "model_list_failed",
  ]);
});

test("N-21: a doctor text never takes catalog text, so the JSON holds codes and numbers only", () => {
  for (const id of MESSAGE_IDS) {
    if (!id.startsWith("doctor.") || id === "doctor.footer") continue;
    for (const kind of Object.values(messageParams(id))) assert.notEqual(kind, "text", id);
  }
});
