/**
 * U-55 (AXM-9, PM answers Q-1 to Q-3): whether trying again may help, said in the outputs, additions
 * only. A run that a model error ended carries `modelError {kind, turn, retryable?}`; every error JSON
 * carries `retryable` and `category`. Retryable follows the adapters' own classification (classifyStatus
 * and the transport; second-provider-facts C-5, C-6). An api_error without an HTTP status cannot be
 * told apart (a connection failure is retried by the transport, a TLS failure or a refusal is not), so
 * `retryable` is left out there: absent means unknown, never false.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CLI_ERROR_CATEGORIES,
  CLI_ERROR_CATEGORY,
  CLI_ERROR_EXIT_CODES,
  CLI_ERROR_RETRYABLE,
  MODEL_ERROR_KINDS,
  cliErrorFacts,
  modelErrorRetryable,
} from "../../../src/contracts/index.js";
import type { CliErrorCode, CliErrorOutput, EngineResult, ModelErrorKind, RunModelError } from "../../../src/contracts/index.js";

const CODES = Object.keys(CLI_ERROR_EXIT_CODES) as CliErrorCode[];

describe("U-55: a model error's retryability, by the adapters' classification", () => {
  test("kinds that are always or never worth trying again later", () => {
    const always: ModelErrorKind[] = ["rate_limited", "overloaded", "timeout"];
    const never: ModelErrorKind[] = ["auth_failed", "quota_exhausted", "not_configured", "not_implemented", "script_exhausted", "malformed_response", "aborted"];
    assert.deepEqual([...always, ...never, "api_error"].sort(), [...MODEL_ERROR_KINDS].sort(), "every kind is decided");
    for (const kind of always) assert.equal(modelErrorRetryable(kind), true, kind);
    for (const kind of never) assert.equal(modelErrorRetryable(kind), false, kind);
    assert.equal(modelErrorRetryable("rate_limited", 429), true);
    assert.equal(modelErrorRetryable("auth_failed", 401), false);
  });

  test("api_error by its HTTP status: 408, 409 and 5xx yes, others no, none unknown", () => {
    for (const status of [408, 409, 500, 502, 504, 599]) assert.equal(modelErrorRetryable("api_error", status), true, String(status));
    for (const status of [302, 400, 404, 413, 422]) assert.equal(modelErrorRetryable("api_error", status), false, String(status));
    assert.equal(modelErrorRetryable("api_error"), undefined, "no status: unknown, not false");
  });
});

describe("U-55: every CLI error has a category and, where it can be told, retryable", () => {
  test("a category for every code, from the four", () => {
    assert.deepEqual([...CLI_ERROR_CATEGORIES], ["input", "state", "environment", "internal"]);
    for (const code of CODES) assert.ok(CLI_ERROR_CATEGORIES.includes(CLI_ERROR_CATEGORY[code]), code);
    assert.equal(CLI_ERROR_CATEGORY.internal_error, "internal");
    assert.equal(CLI_ERROR_CATEGORY.invalid_arguments, "input");
    assert.equal(CLI_ERROR_CATEGORY.workspace_locked, "state");
    assert.equal(CLI_ERROR_CATEGORY.provider_not_configured, "environment");
  });

  test("only a run or lock that ends lets the same command succeed; a model listing goes by its error", () => {
    type Tabled = Exclude<CliErrorCode, "model_list_failed" | "config_write_failed">;
    const yes = CODES.filter((code) => Object.hasOwn(CLI_ERROR_RETRYABLE, code) && CLI_ERROR_RETRYABLE[code as Tabled]);
    assert.deepEqual(yes.sort(), ["run_in_progress", "workspace_locked"]);
    assert.equal(Object.hasOwn(CLI_ERROR_RETRYABLE, "model_list_failed"), false);
    // U-82 (review R-71 L1): config_write_failed cannot be told apart, so it has no entry (unknown).
    assert.equal(Object.hasOwn(CLI_ERROR_RETRYABLE, "config_write_failed"), false);
    assert.deepEqual(cliErrorFacts("model_list_failed", { kind: "rate_limited", httpStatus: 429 }), { category: "environment", retryable: true });
    assert.deepEqual(cliErrorFacts("model_list_failed", { kind: "auth_failed", httpStatus: 401 }), { category: "environment", retryable: false });
    assert.deepEqual(cliErrorFacts("model_list_failed", { kind: "api_error" }), { category: "environment" }, "unknown: left out");
    assert.deepEqual(cliErrorFacts("model_list_failed"), { category: "environment" });
    assert.deepEqual(cliErrorFacts("invalid_task"), { category: "input", retryable: false });
    assert.deepEqual(cliErrorFacts("workspace_locked"), { category: "state", retryable: true });
  });

  test("the fields are additions: optional in the types, values only", () => {
    const before: CliErrorOutput = { schemaVersion: 1, kind: "error", code: "invalid_task", exitCode: 2, message: "m" };
    const now: CliErrorOutput = { ...before, ...cliErrorFacts(before.code) };
    assert.equal(JSON.stringify(now), '{"schemaVersion":1,"kind":"error","code":"invalid_task","exitCode":2,"message":"m","category":"input","retryable":false}');
    const modelError: RunModelError = { kind: "api_error", turn: 2 };
    const result: Pick<EngineResult, "modelError"> = { modelError };
    assert.equal(Object.hasOwn(result.modelError as object, "retryable"), false);
  });
});
