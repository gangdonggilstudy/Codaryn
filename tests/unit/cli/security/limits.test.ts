import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ABSOLUTE_LIMITS, MAX_TIMER_MS, checkTimerMs, resolveBoundedLimits } from "../../../../src/cli/security/index.js";
import type { Limits } from "../../../../src/contracts/index.js";

const CONFIG: Partial<Limits> = { maxModelTurns: 20, maxToolCalls: 100, maxTotalTokens: 200_000, maxDurationMs: 600_000 };

function resolve(task: Partial<Limits> | undefined, config: Partial<Limits> | undefined, provider: "anthropic" | "scripted" = "anthropic", form: "task" | "quick" = "task") {
  return resolveBoundedLimits({ form, provider, task, config });
}

/** No error message may repeat a number taken from a file. */
function assertNoValues(outcome: { ok: boolean; message?: string }, values: readonly number[]): void {
  assert.equal(outcome.ok, false);
  for (const value of values) assert.ok(!(outcome.message ?? "").includes(String(value)), `${outcome.message} contains ${value}`);
}

describe("S-7 resolveBoundedLimits", () => {
  test("H2-7: a task value above the config value is rejected", () => {
    const outcome = resolve({ maxModelTurns: 9007199254740991, maxTotalTokens: null }, { ...CONFIG, maxModelTurns: 5, maxTotalTokens: 10_000 });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "invalid_task");
    assertNoValues(outcome, [9007199254740991, 5, 10_000]);
  });

  test("config values are upper bounds; the task may only lower them", () => {
    const outcome = resolve({ maxModelTurns: 7, maxTotalTokens: 50_000 }, CONFIG);
    assert.deepEqual(outcome, {
      ok: true,
      limits: { maxModelTurns: 7, maxToolCalls: 100, maxTotalTokens: 50_000, maxDurationMs: 600_000, maxRepairAttempts: 0, maxSameFailures: 2 },
    });
    assert.equal(resolve({ ...CONFIG }, CONFIG).ok, true);
    const over = resolve({ maxToolCalls: 101 }, CONFIG);
    assert.ok(!over.ok && over.code === "invalid_task" && over.message.includes("limits.maxToolCalls"));
  });

  test("absolute caps apply to both files", () => {
    assert.deepEqual(ABSOLUTE_LIMITS, {
      maxModelTurns: 1000,
      maxToolCalls: 5000,
      maxTotalTokens: 50_000_000,
      maxDurationMs: 86_400_000,
      maxRepairAttempts: 20,
      maxSameFailures: 10,
    });
    const task = resolve({ maxModelTurns: 1001, maxToolCalls: 1, maxTotalTokens: 1, maxDurationMs: 1 }, undefined);
    assert.ok(!task.ok && task.code === "invalid_task");
    assertNoValues(task, [1001]);
    const quick = resolve(undefined, { ...CONFIG, maxTotalTokens: 50_000_001 }, "anthropic", "quick");
    assert.ok(!quick.ok && quick.code === "invalid_config");
    assertNoValues(quick, [50_000_001]);
    const config = resolve({ maxModelTurns: 1 }, { ...CONFIG, maxDurationMs: 86_400_001 });
    assert.ok(!config.ok && config.code === "invalid_config");
    assert.equal(resolve({ ...CONFIG, maxModelTurns: 1000, maxToolCalls: 5000, maxTotalTokens: 50_000_000, maxDurationMs: 86_400_000 }, undefined).ok, true);
  });

  test("anthropic runs must have a token limit; scripted runs may state none", () => {
    const fromTask = resolve({ maxTotalTokens: null }, { ...CONFIG, maxTotalTokens: null });
    assert.ok(!fromTask.ok && fromTask.code === "invalid_task");
    const fromConfig = resolve(undefined, { ...CONFIG, maxTotalTokens: null }, "anthropic", "quick");
    assert.ok(!fromConfig.ok && fromConfig.code === "invalid_config");
    const inherited = resolve({ maxModelTurns: 3 }, { ...CONFIG, maxTotalTokens: null });
    assert.ok(!inherited.ok && inherited.code === "invalid_config");
    const scripted = resolve({ ...CONFIG, maxTotalTokens: null }, { ...CONFIG, maxTotalTokens: null }, "scripted");
    assert.ok(scripted.ok && scripted.limits.maxTotalTokens === null);
  });

  test("a config without a token limit bounds nothing, but a task null cannot lift a config number", () => {
    const lowered = resolve({ maxTotalTokens: 1234 }, { ...CONFIG, maxTotalTokens: null }, "scripted");
    assert.ok(lowered.ok && lowered.limits.maxTotalTokens === 1234);
    const lifted = resolve({ maxTotalTokens: null }, CONFIG, "scripted");
    assert.ok(!lifted.ok && lifted.code === "invalid_task");
  });

  test("a field set in neither file is an error in the form's own code", () => {
    const task = resolve({ maxModelTurns: 1 }, undefined);
    assert.ok(!task.ok && task.code === "invalid_task" && task.message.includes("limits.maxToolCalls"));
    const quick = resolve(undefined, { maxModelTurns: 1 }, "anthropic", "quick");
    assert.ok(!quick.ok && quick.code === "invalid_config");
  });

  test("repair limits: defaults, bounds and the same upper-bound rule", () => {
    const withRepair = resolve({ maxRepairAttempts: 3, maxSameFailures: 1 }, { ...CONFIG, maxRepairAttempts: 5, maxSameFailures: 3 });
    assert.ok(withRepair.ok && withRepair.limits.maxRepairAttempts === 3 && withRepair.limits.maxSameFailures === 1);
    const above = resolve({ maxRepairAttempts: 6 }, { ...CONFIG, maxRepairAttempts: 5 });
    assert.ok(!above.ok && above.code === "invalid_task");
    // Without a config value the absolute cap is the only bound.
    assert.equal(resolve({ ...CONFIG, maxRepairAttempts: 20, maxSameFailures: 10 }, undefined).ok, true);
    assert.equal(resolve({ ...CONFIG, maxRepairAttempts: 21 }, undefined).ok, false);
    assert.equal(resolve({ ...CONFIG, maxSameFailures: 11 }, undefined).ok, false);
    assert.equal(resolve({ ...CONFIG, maxSameFailures: 0 }, undefined).ok, false);
    assert.ok(resolve({ ...CONFIG, maxRepairAttempts: 0 }, undefined).ok);
  });

  test("rejects values that are not integers in range", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "5", true, null]) {
      const outcome = resolve({ ...CONFIG, maxToolCalls: bad as number }, undefined);
      assert.ok(!outcome.ok && outcome.code === "invalid_task", String(bad));
    }
    assert.equal(resolve({ ...CONFIG, maxRepairAttempts: -1 }, undefined).ok, false);
    assert.equal(resolve({ ...CONFIG, maxRepairAttempts: 0.5 }, undefined).ok, false);
  });
});

describe("S-7 checkTimerMs", () => {
  test("H2-8: time values above 2^31-1 are rejected without echoing them", () => {
    assert.equal(MAX_TIMER_MS, 2_147_483_647);
    assert.deepEqual(checkTimerMs(2_147_483_647, "requestTimeoutMs"), { ok: true });
    const outcome = checkTimerMs(3_000_000_000, "requestTimeoutMs");
    assert.deepEqual(outcome, { ok: false, message: "requestTimeoutMs must be a positive integer of at most 2147483647 ms" });
    assert.ok(!outcome.ok && !outcome.message.includes("3000000000"));
    for (const bad of [0, -5, 1.5, "100", Number.NaN]) {
      assert.equal(checkTimerMs(bad, "verifiers[0].timeoutMs").ok, false, String(bad));
    }
  });
});
