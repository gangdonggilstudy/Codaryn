/**
 * A9: a model's completion claim never makes a run `done`; verifier results decide.
 * A10: the anthropic provider without key or model ends before any run, with no journal.
 * No API key is ever placed in the environment of these tests.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CODARYN_MODEL_ENV, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../src/contracts/index.js";
import { createSandbox, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import { writeProgram } from "../fixtures/programs.js";
import { FAKE_SECRET_ENV_A } from "../fixtures/secrets.js";
import { NODE, cliEnv, expectCliError, expectRunResult, readRunFiles, runTask } from "../support/cli.js";

const CLAIM = "모든 테스트를 통과했고 작업을 완료했다";

test("A9 completion claim + failing file rule -> failed", { timeout: 60_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# a\n");
  const taskPath = writeTask(
    sb,
    { id: "a09-fail-rule", verifiers: [{ id: "doc", kind: "file_rules", rules: [{ type: "contains", path: "README.md", text: "## 설치" }] }] },
    [{ text: CLAIM }],
  );
  const run = await runTask(taskPath, { cwd: sb.base });
  const result = expectRunResult(run);
  readRunFiles(sb.workspace, result);
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "verifier_failed");
  assert.equal(run.exitCode, 1);
  assert.equal(result.verifiers[0]?.outcome, "fail");
});

test("A9 completion claim + failing command verifier -> failed", { timeout: 60_000 }, async (t) => {
  const sb = createSandbox(t);
  writeProgram(sb, "exit-code.mjs");
  const taskPath = writeTask(
    sb,
    { id: "a09-fail-cmd", verifiers: [{ id: "cmd", kind: "command", executable: NODE, args: ["exit-code.mjs", "1"] }] },
    [{ text: CLAIM }],
  );
  const result = expectRunResult(await runTask(taskPath, { cwd: sb.base }));
  assert.equal(result.status, "failed");
  assert.equal(result.verifiers[0]?.outcome, "fail");
});

test("A9 no verifier -> needs-input, never done", { timeout: 60_000 }, async (t) => {
  const sb = createSandbox(t);
  const taskPath = writeTask(sb, { id: "a09-none", verifiers: [] }, [{ text: CLAIM }]);
  const run = await runTask(taskPath, { cwd: sb.base });
  const result = expectRunResult(run);
  readRunFiles(sb.workspace, result);
  assert.equal(result.status, "needs-input");
  assert.equal(result.reason, "no_verifier");
  assert.equal(run.exitCode, 3);
  assert.ok(result.notices.length >= 1, "the result must say there was no automatic verification");
});

test("A9 verifier timeout -> needs-input (inconclusive)", { timeout: 60_000 }, async (t) => {
  const sb = createSandbox(t);
  writeProgram(sb, "sleep.mjs");
  const taskPath = writeTask(
    sb,
    { id: "a09-inconclusive", verifiers: [{ id: "slow", kind: "command", executable: NODE, args: ["sleep.mjs"], timeoutMs: 500 }] },
    [{ text: CLAIM }],
  );
  const result = expectRunResult(await runTask(taskPath, { cwd: sb.base }));
  assert.equal(result.status, "needs-input");
  assert.equal(result.reason, "verifier_inconclusive");
  assert.equal(result.verifiers[0]?.outcome, "inconclusive");
});

function assertNoRun(workspace: string): void {
  assert.equal(existsSync(join(workspace, STATE_DIR_NAME, RUNS_DIR_NAME)), false, "no run directory may be created");
}

test("A10 anthropic provider without key and model -> provider_not_configured, no run", { timeout: 60_000 }, async (t) => {
  const sb = createSandbox(t);
  const taskPath = writeTask(sb, { id: "a10-none", model: { provider: "anthropic" } });
  const run = await runTask(taskPath, { cwd: sb.base, env: cliEnv() });
  expectCliError(run, "provider_not_configured");
  assert.equal(run.exitCode, 7);
  assertNoRun(sb.workspace);
});

test("A10 anthropic provider with model but no key -> provider_not_configured, no run", { timeout: 60_000 }, async (t) => {
  const sb = createSandbox(t);
  const taskPath = writeTask(sb, { id: "a10-model-only", model: { provider: "anthropic" } });
  const run = await runTask(taskPath, { cwd: sb.base, env: cliEnv({ extra: { [CODARYN_MODEL_ENV]: "fake-model-for-tests" } }) });
  expectCliError(run, "provider_not_configured");
  assertNoRun(sb.workspace);
});

test("pre-run errors: missing secret env and missing script", { timeout: 60_000 }, async (t) => {
  await t.test("secret_env_missing", async (st) => {
    const sb = createSandbox(st);
    const taskPath = writeTask(sb, { id: "pre-secret", secretEnv: [FAKE_SECRET_ENV_A] }, [{ text: "끝" }]);
    const run = await runTask(taskPath, { cwd: sb.base, env: cliEnv() });
    expectCliError(run, "secret_env_missing");
    assert.equal(run.exitCode, 2);
    assertNoRun(sb.workspace);
  });

  await t.test("invalid_script", async (st) => {
    const sb = createSandbox(st);
    const taskPath = writeTask(sb, { id: "pre-script" });
    const run = await runTask(taskPath, { cwd: sb.base });
    expectCliError(run, "invalid_script");
    assertNoRun(sb.workspace);
  });
});
