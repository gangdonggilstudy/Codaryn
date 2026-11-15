/**
 * Review R-14 L-1 (docs/reviews/2026-11-12-r14-review-app-layer-additions.md), reproduction first:
 * `changes` judges a run as the run list does (store `inspectRun`): a damaged run is
 * `invalid_run_record`, an id with no entry of exactly that name is `run_not_found` (N-27).
 * Fake values only.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome } from "../../../src/app/index.js";
import type { RunsOutput } from "../../../src/contracts/index.js";
import { WRITE_NOTES, appEnvironment, setupRun, taskForm, taskRequest } from "./support.js";

function code<T>(outcome: AppCallOutcome<T>): string | null {
  return outcome.ok ? null : outcome.error.code;
}

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}

describe("R-14 L-1: changes judges the run as the run list does", () => {
  const FORGED = "20991231T235959Z-0c0ffee0";

  test("a damaged run is invalid_run_record and a case variant of an id is run_not_found; no path is shown", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const app = createCodarynApp(await appEnvironment(base));
    const started = await app.startRun(taskRequest(base));
    assert.ok(started.ok);
    assert.ok((await started.handle.done).ok);
    const workspace = path.join(base, "work");

    // A run directory with records the run list does not trust (a start time in the future, DR-19).
    const forgedDir = path.join(workspace, ".codaryn", "runs", FORGED);
    await mkdir(forgedDir, { recursive: true });
    const at = "2099-12-31T23:59:59.000Z";
    const lines = [
      { seq: 1, at, runId: FORGED, type: "run_started", schemaVersion: 1, taskId: "forged", workflow: "x", provider: "scripted", limits: { maxModelTurns: 1, maxToolCalls: 1, maxTotalTokens: null, maxDurationMs: 1000 } },
      { seq: 2, at, runId: FORGED, type: "file_changed", callId: "c", path: "forged-path.md", previousHash: null, newHash: "a".repeat(64), created: true },
    ];
    await writeFile(path.join(forgedDir, "journal.jsonl"), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
    const listed = ok<RunsOutput>(await app.listRuns({ workspace }));
    assert.equal(listed.runs.find((entry) => entry.runId === FORGED)?.state, "damaged", "the run list judges it damaged");

    const forged = await app.changes({ settings: taskForm(base), runId: FORGED });
    assert.equal(code(forged), "invalid_run_record");
    assert.equal(JSON.stringify(forged).includes("forged-path.md"), false);

    const variant = started.handle.runId.replace("T", "t");
    assert.equal(code(await app.changes({ settings: taskForm(base), runId: variant })), "run_not_found");
  });
});
