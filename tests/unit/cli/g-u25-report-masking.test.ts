/**
 * Unit U-25 (DR-52, AXM-17), the CLI's report: a run's result.json carries `masking` (counts only:
 * values registered, places masked in what the model was sent), and `codaryn report --json` read it
 * back without it, since readResult rebuilds the result from the fields it checks. It now keeps the
 * two counts as recorded, checks they are counts, and carries nothing else of that field. Absent
 * stays absent (nothing registered, or a result written before DR-52).
 * Real assembly, scripted model, fake values only, no network.
 */

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { RESULT_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { EngineResult, ReportOutput } from "../../../src/contracts/index.js";
import { readResult, runReport } from "../../../src/cli/report.js";
import { runCli } from "../../../src/cli/run.js";
import { FAKE_SECRET, cliIo, setupRun } from "./k-support.js";

const RUN = "20261113T060000Z-0000abcd";

/** A finished scripted run that read README.md (holding the registered fake value, or not). */
async function finishedRun(readme: string, task: Readonly<Record<string, unknown>> = {}): Promise<{ work: string; result: EngineResult }> {
  const base = await setupRun({ "README.md": readme }, task, [
    { toolCalls: [{ name: "read_file", args: { path: "README.md" } }] },
    { text: "done" },
  ]);
  const outcome = await runCli(cliIo(base));
  assert.equal(outcome.output.kind, "run", JSON.stringify(outcome.output));
  return { work: path.join(base, "work"), result: outcome.output as EngineResult };
}

async function reportJson(work: string, runId: string): Promise<{ text: string; parsed: ReportOutput }> {
  const outcome = await runReport({ argv: ["report", "--workspace", work, "--run", runId, "--json"], cwd: path.dirname(work), env: {} });
  assert.ok("text" in outcome, JSON.stringify(outcome));
  return { text: outcome.text, parsed: JSON.parse(outcome.text) as ReportOutput };
}

/** A minimal recorded run result, with `extra` fields. */
function recorded(extra: Readonly<Record<string, unknown>>): string {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "run",
    runId: RUN,
    taskId: "t",
    status: "done",
    reason: "verified",
    exitCode: 0,
    provider: "scripted",
    verifiers: [],
    changes: [],
    usage: { modelTurns: 1, toolCalls: 0, inputTokens: null, outputTokens: null, durationMs: 1 },
    journalPath: `.codaryn/runs/${RUN}/journal.jsonl`,
    notices: [],
    ...extra,
  });
}

describe("U-25 (DR-52): report keeps the run's masking counts as recorded", () => {
  test("report --json gives the run's masking: one value registered, the place the model was sent masked", async () => {
    const run = await finishedRun(`# Title\nthe token is ${FAKE_SECRET}\n`);
    assert.deepEqual(run.result.masking, { registeredValues: 1, maskedPlaces: 1 });
    const { text, parsed } = await reportJson(run.work, run.result.runId);
    assert.deepEqual(parsed.result?.masking, run.result.masking);
    assert.deepEqual(parsed.result, run.result);
    assert.equal(text.includes(FAKE_SECRET), false);
  });

  test("registered and nothing to mask: the counts say so (0 places), not absent", async () => {
    const run = await finishedRun("# Title\n");
    assert.deepEqual(run.result.masking, { registeredValues: 1, maskedPlaces: 0 });
    assert.deepEqual((await reportJson(run.work, run.result.runId)).parsed.result?.masking, { registeredValues: 1, maskedPlaces: 0 });
  });

  test("nothing registered: no masking in the run's result nor in the report", async () => {
    const run = await finishedRun("# Title\n", { privacy: { secretEnv: [] } });
    assert.equal(run.result.masking, undefined);
    const { parsed } = await reportJson(run.work, run.result.runId);
    assert.equal(parsed.result !== null && parsed.result !== undefined && "masking" in parsed.result, false);
  });

  test("readResult keeps the two counts and nothing else of the field; absent stays absent", () => {
    assert.deepEqual(readResult(recorded({ masking: { registeredValues: 2, maskedPlaces: 5 } }), RUN, "t").masking, { registeredValues: 2, maskedPlaces: 5 });
    const more = readResult(recorded({ masking: { registeredValues: 1, maskedPlaces: 0, values: ["x"], length: 9 } }), RUN, "t");
    assert.deepEqual(more.masking, { registeredValues: 1, maskedPlaces: 0 });
    assert.equal("masking" in readResult(recorded({}), RUN, "t"), false);
  });

  test("a masking field that is not two counts is refused like any damaged field", () => {
    for (const masking of [
      null,
      "1/0",
      [1, 0],
      {},
      { registeredValues: 1 },
      { maskedPlaces: 0 },
      // Present only when at least one value was registered.
      { registeredValues: 0, maskedPlaces: 0 },
      { registeredValues: 1, maskedPlaces: -1 },
      { registeredValues: 1.5, maskedPlaces: 0 },
      { registeredValues: "1", maskedPlaces: 0 },
    ]) {
      assert.throws(() => readResult(recorded({ masking }), RUN, "t"), /not an object|out of range/, JSON.stringify(masking));
    }
  });

  test("report of a run whose result.json has a damaged masking field: invalid_run_record, nothing of it shown", async () => {
    const run = await finishedRun("# Title\n");
    const file = path.join(run.work, STATE_DIR_NAME, RUNS_DIR_NAME, run.result.runId, RESULT_FILE_NAME);
    const record = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    await writeFile(file, JSON.stringify({ ...record, masking: { registeredValues: 0, maskedPlaces: 0 } }), "utf8");
    const outcome = await runReport({ argv: ["report", "--workspace", run.work, "--run", run.result.runId, "--json"], cwd: path.dirname(run.work), env: {} });
    assert.ok("output" in outcome && outcome.output.kind === "error", JSON.stringify(outcome));
    assert.equal(outcome.output.code, "invalid_run_record");
    assert.equal(outcome.exitCode, 2);
  });
});
