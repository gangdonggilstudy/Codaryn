/**
 * Unit U-319 (the CLI migration's C-9b, PM): the CLI's cleanup and the app's (the GUI's) are one copy
 * after their checks (src/app/cleanup.ts: summaryOf, cleanupPlanOf, cleanupConfirmed). On the real
 * store, with one time for both:
 * - the same workspace gives the same summary and the same plan, digest included, to both callers;
 * - copies of one workspace (the digest holds each folder's inode, so each caller confirms its own
 *   preview's digest; the CLI its prefix) give the same status and outcome: a run not reverted kept
 *   without its confirmation (nothing_removed), then removed with it (removed, ok);
 * - a held lock is workspace_locked to both, each with its own text;
 * - the input checks stay apart (PM): the CLI takes --older-than 40000, the app's request check
 *   refuses it.
 * Runs are made through the app with a scripted model; nothing is sent.
 */

import assert from "node:assert/strict";
import { cp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { LOCK_FILE_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, CleanupApplied, CleanupPreview, CodarynApp, StateSummaryView } from "../../../src/app/index.js";
import { runCleanup } from "../../../src/cli/cleanup.js";
import type { CleanupOutput } from "../../../src/cli/cleanup.js";
import { WRITE_NOTES, appEnvironment, setupRun, taskRequest, tempDir } from "../app/support.js";

const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}

/** A workspace with one finished run that wrote NOTES.md and was not reverted, and a copy of it. */
async function twoCopies(): Promise<{ cliBase: string; appBase: string; runId: string; now: number }> {
  const cliBase = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
  const started = await createCodarynApp(await appEnvironment(cliBase)).startRun(taskRequest(cliBase));
  assert.ok(started.ok, JSON.stringify(started));
  const done = await started.handle.done;
  assert.ok(done.ok, JSON.stringify(done));
  const appBase = await tempDir("codaryn-u319-copy-");
  await cp(cliBase, appBase, { recursive: true });
  return { cliBase, appBase, runId: done.result.runId, now: Date.now() };
}

/** `codaryn cleanup --workspace work <args> --json` at `now`: the output, or the error's code and text. */
async function cli(base: string, now: number, args: readonly string[]): Promise<{ output: CleanupOutput | null; error: { code: string; message: string } | null }> {
  const outcome = await runCleanup({ argv: ["cleanup", "--workspace", "work", ...args, "--json"], cwd: base, env: {}, clock: { now: () => now } });
  if ("output" in outcome) return { output: null, error: outcome.output as unknown as { code: string; message: string } };
  return { output: JSON.parse(outcome.text) as CleanupOutput, error: null };
}

async function appAt(base: string, now: number): Promise<CodarynApp> {
  return createCodarynApp(await appEnvironment(base, { clock: { now: () => now } }));
}

const lockHeld = (base: string) =>
  writeFile(path.join(base, "work", STATE_DIR_NAME, LOCK_FILE_NAME), JSON.stringify({ pid: process.pid, runId: "20200101T000000Z-0000beef", startedAt: "2020-01-01T00:00:00.000Z" }), "utf8");

describe("U-319: the CLI's cleanup and the app's are one copy after their checks", () => {
  test("the same workspace: the same summary and plan, digest included, at the same time", async () => {
    const { cliBase, runId, now } = await twoCopies();
    const fromCli = await cli(cliBase, now, ["--run", runId]);
    assert.ok(fromCli.output !== null && fromCli.output.status === "preview", JSON.stringify(fromCli));
    const app = await appAt(cliBase, now);
    const workspace = path.join(cliBase, "work");
    const summary = ok<StateSummaryView>(await app.stateSummary({ workspace }));
    const preview = ok<CleanupPreview>(await app.previewCleanup({ workspace, selection: { runs: { runIds: [runId] } } }));
    assert.deepEqual(fromCli.output.summary, json(summary.summary));
    assert.deepEqual(fromCli.output.plan, json(preview.plan));
    assert.equal(preview.now, new Date(now).toISOString());
    assert.equal(preview.plan.items.length, 1, "the run is in the plan");
  });

  test("copies of one workspace: the same status and outcome, kept without the run's confirmation, removed with it", async () => {
    const { cliBase, appBase, runId, now } = await twoCopies();
    const selection = { runs: { runIds: [runId] } };
    const app = await appAt(appBase, now);
    const workspace = path.join(appBase, "work");
    for (const includeNotReverted of [false, true]) {
      const shown = await cli(cliBase, now, ["--run", runId]);
      assert.ok(shown.output !== null && shown.output.status === "preview", JSON.stringify(shown));
      const prefix = shown.output.plan.digest.slice(0, 12);
      const fromCli = await cli(cliBase, now, ["--run", runId, "--confirm", prefix, ...(includeNotReverted ? ["--include-not-reverted"] : [])]);
      assert.ok(fromCli.output !== null && fromCli.output.status !== "preview", JSON.stringify(fromCli));

      const preview = ok<CleanupPreview>(await app.previewCleanup({ workspace, selection }));
      const fromApp = ok<CleanupApplied>(await app.applyCleanup({ workspace, selection, now: preview.now, confirmation: { digest: preview.plan.digest, discarded: false, includeNotReverted } }));

      assert.equal(fromCli.output.status, fromApp.status);
      assert.equal(fromCli.output.status, includeNotReverted ? "removed" : "nothing_removed");
      assert.deepEqual(fromCli.output.outcome, json(fromApp.outcome));
      assert.equal(fromCli.output.outcome.ok, includeNotReverted);
    }
  });

  test("a held lock: workspace_locked to both, each with its own text", async () => {
    const { cliBase, appBase, runId, now } = await twoCopies();
    await lockHeld(cliBase);
    await lockHeld(appBase);
    const shown = await cli(cliBase, now, ["--run", runId]);
    assert.ok(shown.output !== null && shown.output.status === "preview", JSON.stringify(shown));
    const fromCli = await cli(cliBase, now, ["--run", runId, "--confirm", shown.output.plan.digest.slice(0, 12), "--include-not-reverted"]);

    const app = await appAt(appBase, now);
    const workspace = path.join(appBase, "work");
    const selection = { runs: { runIds: [runId] } };
    const preview = ok<CleanupPreview>(await app.previewCleanup({ workspace, selection }));
    const fromApp = await app.applyCleanup({ workspace, selection, now: preview.now, confirmation: { digest: preview.plan.digest, discarded: false, includeNotReverted: true } });
    assert.ok(!fromApp.ok, JSON.stringify(fromApp));

    assert.equal(fromCli.error?.code, "workspace_locked");
    assert.equal(fromApp.error.code, "workspace_locked");
    assert.equal(fromCli.error?.message, "another Codaryn process holds the workspace lock; nothing was removed");
    assert.equal(fromApp.error.message, "another task holds the workspace lock; nothing was removed. Try again when it ends.");
    for (const base of [cliBase, appBase]) await rm(path.join(base, "work", STATE_DIR_NAME, LOCK_FILE_NAME), { force: true });
  });

  test("the input checks stay apart: --older-than 40000 is the CLI's, the app's request check refuses it", async () => {
    const { cliBase, now } = await twoCopies();
    const fromCli = await cli(cliBase, now, ["--older-than", "40000"]);
    assert.equal(fromCli.output?.status, "preview", JSON.stringify(fromCli));
    const fromApp = await (await appAt(cliBase, now)).previewCleanup({ workspace: path.join(cliBase, "work"), selection: { runs: { olderThanDays: 40000 } } });
    assert.ok(!fromApp.ok && fromApp.error.code === "invalid_arguments", JSON.stringify(fromApp));
  });
});
