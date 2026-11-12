/**
 * Unit U-55 (AXM-9), the app layer's part.
 * - Every error the app layer makes into the CLI's error output (toCliError, which CLI `changes`
 *   prints and the GUI's engine host reads) carries the contract's facts: `category` and
 *   `retryable` by cliErrorFacts(code). An AppError that already carries them (the CLI's own error,
 *   as fromCliError keeps it: model_list_failed decides `retryable` by the listing's model error)
 *   keeps its own. The exit code and the other fields stay as they were.
 * - A run's result reaches the run handle's `done` with the engine's `modelError` as it is (kind,
 *   turn, retryable; retryable absent when it cannot be told).
 * Reproduced first (0d8e566, todo); toCliError fills the facts now. Real runs through the app
 * (scripted model), the real store. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CLI_ERROR_EXIT_CODES, cliErrorFacts } from "../../../src/contracts/index.js";
import type { CliErrorCode, EngineResult } from "../../../src/contracts/index.js";
import { appError, createCodarynApp, fromCliError, toCliError } from "../../../src/app/index.js";
import { runTask as engineRunTask } from "../../../src/engine/index.js";
import { WRITE_NOTES, appEnvironment, setupRun, taskRequest } from "./support.js";

const CODES = Object.keys(CLI_ERROR_EXIT_CODES) as CliErrorCode[];

describe("U-55: the app layer's CLI error output carries category and retryable", () => {
  test("every code: cliErrorFacts(code) added, nothing else changed", () => {
    for (const code of CODES) {
      const output = toCliError(appError(code, "fixed text"));
      assert.deepEqual(output, { schemaVersion: 1, kind: "error", code, message: "fixed text", ...cliErrorFacts(code), exitCode: CLI_ERROR_EXIT_CODES[code] }, code);
    }
  });

  test("model_list_failed without the listing's model error: retryable left out (unknown), the category given", () => {
    const output = toCliError(appError("model_list_failed", "fixed text")) as unknown as Record<string, unknown>;
    assert.equal(output["category"], "environment");
    assert.equal("retryable" in output, false);
  });

  test("an AppError that carries the CLI's own facts keeps them", () => {
    const cli = { schemaVersion: 1, kind: "error", code: "model_list_failed", exitCode: CLI_ERROR_EXIT_CODES.model_list_failed, message: "m", category: "environment", retryable: true } as const;
    assert.deepEqual(toCliError(fromCliError(cli)), cli);
  });
});

/** A run through the app whose script ends after two turns: the third request is a model error. */
async function exhaustedRun(hooks: Parameters<typeof createCodarynApp>[1] = {}): Promise<EngineResult> {
  const base = await setupRun({ "notes.txt": "plain\n" }, {}, [{ toolCalls: [{ name: "read_file", args: { path: "notes.txt" } }] }, WRITE_NOTES]);
  const app = createCodarynApp(await appEnvironment(base), hooks);
  const started = await app.startRun(taskRequest(base));
  assert.ok(started.ok, JSON.stringify(started));
  const done = await started.handle.done;
  assert.ok(done.ok, JSON.stringify(done));
  return done.result;
}

describe("U-55: the run handle's result carries the engine's modelError as it is", () => {
  test("a script that runs out: script_exhausted at its turn, not retryable", async () => {
    const result = await exhaustedRun();
    assert.deepEqual([result.status, result.reason], ["failed", "model_error"]);
    assert.deepEqual(result.modelError, { kind: "script_exhausted", turn: 3, retryable: false });
  });

  test("a modelError without retryable (it cannot be told) stays without it", async () => {
    const result = await exhaustedRun({ runTask: async (deps) => ({ ...(await engineRunTask(deps)), modelError: { kind: "api_error", turn: 3 } }) });
    assert.deepEqual(result.modelError, { kind: "api_error", turn: 3 });
  });
});
