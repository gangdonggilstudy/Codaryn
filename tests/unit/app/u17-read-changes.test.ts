/**
 * Unit U-17 (DR-46, UXM-3, UXM-19), the app layer's part: `changes` reads a run's changes, so its
 * quick form (`--workspace`) needs no key, model or run limits. It needs only what masks the text:
 * the secrets a run with that form registers now (DR-17, DR-29). The CLI's `changes` command goes
 * through the app's `changes`. Before U-17 the app found those secrets by running the CLI's `run`
 * path up to its assembly, so a config without a provider (or without one at all) refused the
 * reading. Reproduced first, todo until the app prepares the form as a reading command
 * (prepareTask's readOnly, the CLI's part of U-17). Real runs through the app (scripted model).
 * Fake values only.
 */

import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, ChangesOutput, CodarynApp, TaskForm } from "../../../src/app/index.js";
import { WRITE_NOTES, appEnvironment, setupRun, taskRequest } from "./support.js";

const TODO = { todo: "U-17: wait for the app to prepare the quick form as a reading command" };

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}
const codeOf = (outcome: AppCallOutcome<unknown>): string | null => (outcome.ok ? null : outcome.error.code);

/** A finished run that created NOTES.md, through the app with its task file. */
async function finishedRun(): Promise<{ base: string; workspace: string; app: CodarynApp; runId: string }> {
  const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
  const app = createCodarynApp(await appEnvironment(base));
  const started = await app.startRun(taskRequest(base));
  assert.ok(started.ok, JSON.stringify(started));
  await started.handle.done;
  return { base, workspace: path.join(base, "work"), app, runId: started.handle.runId };
}

const quickForm = (workspace: string, configPath: string | null): TaskForm => ({ input: { kind: "workspace", workspace }, configPath, varsFile: null, profile: null, workflowRef: null });
const pathsOf = (output: ChangesOutput): string[] => JSON.stringify(output).match(/NOTES\.md/g) ?? [];

describe("U-17 (DR-46): changes --workspace needs no provider settings", () => {
  test("without any config file: the run's changes are read", TODO, async () => {
    const run = await finishedRun();
    const output = ok<ChangesOutput>(await run.app.changes({ settings: quickForm(run.workspace, null), runId: run.runId }));
    assert.equal(output.runId, run.runId);
    assert.ok(pathsOf(output).length > 0, JSON.stringify(output));
  });

  test("with init's config (placeholder model, no key): the run's changes are read", TODO, async () => {
    const run = await finishedRun();
    const config = path.join(run.base, "init-config.json");
    await writeFile(
      config,
      JSON.stringify({ schemaVersion: 1, model: "<model id>", maxOutputTokens: 4096, limits: { maxModelTurns: 12, maxToolCalls: 24, maxTotalTokens: 150000, maxDurationMs: 600000 }, policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false } }),
      "utf8",
    );
    const output = ok<ChangesOutput>(await run.app.changes({ settings: quickForm(run.workspace, config), runId: run.runId }));
    assert.equal(output.runId, run.runId);
  });

  test("the form is still checked: a workspace that is not there is refused", async () => {
    const run = await finishedRun();
    assert.notEqual(codeOf(await run.app.changes({ settings: quickForm(path.join(run.base, "absent"), null), runId: run.runId })), null);
  });

  test("the task file form reads as before", async () => {
    const run = await finishedRun();
    const output = ok<ChangesOutput>(await run.app.changes({ settings: { input: { kind: "task", taskPath: path.join(run.base, "task.json") }, configPath: null, varsFile: null, profile: null, workflowRef: null }, runId: run.runId }));
    assert.ok(pathsOf(output).length > 0, JSON.stringify(output));
  });
});
