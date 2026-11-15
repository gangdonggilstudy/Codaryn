/**
 * Y-1 to Y-3 contract values and shapes: ModelInfo, ListAnthropicModels, the models command output,
 * its exit codes and error codes. p5 (listAnthropicModels) and p4 (fake server cases) rely on them.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { CLI_ERROR_EXIT_CODES, MAX_MODEL_LIST_PAGES, MODELS_EXIT_CODES, MODELS_STATUSES } from "../../../src/contracts/index.js";
import type { AnthropicListSettings, CommandOutput, ListAnthropicModels, ModelInfo, ModelsOutput } from "../../../src/contracts/index.js";

test("models statuses, exit codes, error codes and the page bound", () => {
  assert.deepEqual([...MODELS_STATUSES], ["listed", "selected"]);
  assert.deepEqual(MODELS_EXIT_CODES, { listed: 0, selected: 0 });
  assert.equal(CLI_ERROR_EXIT_CODES.model_list_failed, 8);
  assert.equal(CLI_ERROR_EXIT_CODES.config_write_failed, 2);
  assert.equal(CLI_ERROR_EXIT_CODES.provider_not_configured, 7);
  assert.equal(MAX_MODEL_LIST_PAGES, 20);
});

test("the listing function and its outcome", async () => {
  const model: ModelInfo = { id: "fake-model-a", displayName: "Fake A", createdAt: null, maxInputTokens: 1000, maxOutputTokens: null };
  const list: ListAnthropicModels = async (settings, _deps, signal) => {
    const keys: (keyof AnthropicListSettings)[] = ["apiKey", "apiBaseUrl", "requestTimeoutMs", "maxRetries"];
    assert.deepEqual(Object.keys(settings).sort(), [...keys].sort());
    if (signal?.aborted === true) return { ok: false, kind: "aborted", message: "aborted" };
    return { ok: true, models: [model] };
  };
  const settings: AnthropicListSettings = { apiKey: "fake-key-value", apiBaseUrl: "http://127.0.0.1:1", requestTimeoutMs: 1000, maxRetries: 0 };
  assert.deepEqual(await list(settings), { ok: true, models: [model] });
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await list(settings, undefined, controller.signal), { ok: false, kind: "aborted", message: "aborted" });
});

test("the models output is a command output", () => {
  const output: ModelsOutput = {
    schemaVersion: 1,
    kind: "models",
    status: "selected",
    exitCode: MODELS_EXIT_CODES.selected,
    models: [{ number: 1, id: "fake-model-a", displayName: "Fake A", createdAt: "2026-01-01T00:00:00Z", maxInputTokens: null, maxOutputTokens: 4096 }],
    current: { id: "fake-model-a", source: "config", listed: true },
    selected: { id: "fake-model-a", created: false, overriddenBy: null },
  };
  const printed: CommandOutput = output;
  assert.equal(printed.kind, "models");
});
