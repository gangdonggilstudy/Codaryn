/**
 * U-155 (AXM-8, design gap survey C-27, the contract's part): RunListEntry gains an optional `phase`
 * (running, finished, no_result), so a machine can tell a run still going from one that stopped
 * without a result, which `status: null` cannot. Only additions: no store writes it yet, so
 * `runs --json` is unchanged; an entry without it is read as unknown.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { RUN_PHASES, planApplyStateOf, toRunId } from "../../../src/contracts/index.js";
import type { RunId, RunListEntry, RunPhase, RunsOutput } from "../../../src/contracts/index.js";

type Checked = Extract<RunListEntry, { readonly state: "checked" }>;

const RUN = toRunId("20261113T030000Z-0000cccc") as RunId;
const going: Checked = { state: "checked", runId: RUN, startedAt: "2026-11-13T03:00:00.000Z", taskId: "doc", status: null, reason: null, changes: null, reverted: null };

describe("U-155: RunListEntry.phase", () => {
  test("three phases, each once", () => {
    assert.deepEqual(RUN_PHASES, ["running", "finished", "no_result"]);
    assert.equal(new Set(RUN_PHASES).size, RUN_PHASES.length);
  });

  test("optional: an entry without it is as before; status null with running or no_result tells the two apart", () => {
    assert.equal(going.phase, undefined);
    const running: Checked = { ...going, phase: "running" };
    const stopped: Checked = { ...going, phase: "no_result" };
    const finished: Checked = { ...going, status: "done", reason: "verified", changes: 1, phase: "finished" };
    assert.deepEqual(
      [running, stopped, finished].map((entry) => [entry.status, entry.phase]),
      [
        [null, "running"],
        [null, "no_result"],
        ["done", "finished"],
      ],
    );
    // @ts-expect-error a phase is one of RUN_PHASES
    const wrong: Checked = { ...going, phase: "paused" };
    assert.ok(wrong);
  });

  test("a damaged entry has no phase", () => {
    // @ts-expect-error a damaged entry holds its state and run id only
    const damaged: RunListEntry = { state: "damaged", runId: RUN, phase: "running" };
    assert.ok(damaged);
  });

  test("a runs line with the field is plain JSON", () => {
    const output: RunsOutput = { schemaVersion: 1, kind: "runs", status: "listed", exitCode: 0, runs: [{ ...going, phase: "running" }], omitted: 0 };
    assert.deepEqual(JSON.parse(JSON.stringify(output)), output);
    const phases: readonly RunPhase[] = output.runs.flatMap((entry) => (entry.state === "checked" && entry.phase !== undefined ? [entry.phase] : []));
    assert.deepEqual(phases, ["running"]);
  });

  test("the rule for plan runs does not look at it", () => {
    const plan: Checked = { ...going, status: "needs-input", reason: "plan_pending", phase: "finished" };
    assert.equal(planApplyStateOf(plan, [plan]), null);
  });
});
