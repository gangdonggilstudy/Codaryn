/**
 * U-144: a run's progress and end can reach the window before startRun's answer (the main process
 * begins the run, then writes gui-state, then answers; the engine host sends progress by timer after
 * its answer). The window kept nothing then: a run that ended meanwhile stayed "running" with no
 * items, and a new run could not start. While starting, the run model keeps them (bounded) and takes
 * those of the run id the answer names.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { RunDonePayload, RunEventsPayload } from "../../src/shared/ipc.js";
import { MAX_EARLY_EVENTS, RunModel } from "../../src/renderer/run/run-model.js";

const RUN_ID = "20261113T010203Z-0000abcd";
const OTHER = "20261113T000000Z-ffffffff";

const events = (runId: string, texts: readonly string[], turns: number, tools: number): RunEventsPayload => ({
  runId,
  items: texts.map((text) => ({ at: null, kind: text === "gap" ? "gap" : "tool_denied", text: text === "gap" ? "" : text })),
  counts: { turns, tools },
});
const failed = (runId: string): RunDonePayload => ({ runId, ok: false, code: "adapter_host_exited" });

const starting = (): RunModel => {
  const run = new RunModel();
  assert.equal(run.starting({ goal: "g", profile: null, workflow: null }), true);
  return run;
};

test("U-144: progress and the end that came before startRun's answer are taken for that run, in order", () => {
  const run = starting();
  let changes = 0;
  run.subscribe(() => (changes += 1));
  run.events(events(RUN_ID, ["first"], 1, 0));
  run.events(events(OTHER, ["another run"], 9, 9));
  run.events(events(RUN_ID, ["second", "third"], 2, 1));
  run.finished(failed(RUN_ID));
  assert.equal(run.phase, "starting", "nothing shows before the answer");
  assert.equal(run.items.length, 0);
  assert.equal(changes, 0);

  run.started(RUN_ID, 1000);
  assert.deepEqual(run.items.map((item) => item.text), ["first", "second", "third"], "another run's items are not taken");
  assert.deepEqual(run.counts, { turns: 2, tools: 1 });
  assert.equal(run.phase, "done", "a run that ended meanwhile shows its end");
  assert.deepEqual(run.done, failed(RUN_ID));
  assert.equal(run.canStart, true, "a new run can start");
  assert.equal(run.startedAt, 1000);
  assert.equal(changes, 1, "one change for the answer and what it takes");
});

test("U-144: an end of another run before the answer is not taken; the run goes on and takes later items", () => {
  const run = starting();
  run.events(events(RUN_ID, ["early"], 1, 0));
  run.finished(failed(OTHER));
  run.started(RUN_ID, 1000);
  assert.equal(run.phase, "running");
  assert.equal(run.done, null);
  assert.equal(run.canCancel, true);
  run.events(events(RUN_ID, ["later"], 2, 1));
  assert.deepEqual(run.items.map((item) => item.text), ["early", "later"]);
  run.finished(failed(RUN_ID));
  assert.equal(run.phase, "done");
});

test("U-144: a gap that came early is kept; more early messages than the bound mark a gap", () => {
  const withGap = starting();
  withGap.events(events(RUN_ID, ["gap", "after"], 1, 1));
  withGap.started(RUN_ID, 0);
  assert.equal(withGap.gap, true);
  assert.deepEqual(withGap.items.map((item) => item.text), ["after"]);

  const many = starting();
  for (let i = 0; i < MAX_EARLY_EVENTS + 5; i += 1) many.events(events(RUN_ID, [String(i)], i, 0));
  many.started(RUN_ID, 0);
  assert.equal(many.items.length, MAX_EARLY_EVENTS, "the kept ones are the first");
  assert.equal(many.items.at(-1)?.text, String(MAX_EARLY_EVENTS - 1));
  assert.equal(many.gap, true, "the dropped ones are a gap in the progress");
  assert.equal(many.phase, "running");
});

test("U-144: a refused start forgets what came; the next start takes only its own", () => {
  const run = starting();
  run.events(events(RUN_ID, ["of a refused start"], 1, 0));
  run.finished(failed(RUN_ID));
  run.failedToStart("run_active");
  assert.equal(run.phase, "idle");
  assert.equal(run.startError, "run_active");
  assert.equal(run.items.length, 0);

  assert.equal(run.starting({ goal: "again", profile: null, workflow: null }), true);
  run.started(RUN_ID, 0);
  assert.equal(run.phase, "running", "the earlier end is not this start's");
  assert.equal(run.items.length, 0);
  assert.equal(run.gap, false);
});

test("U-144: outside starting nothing is kept: before any start, and after a run ended", () => {
  const run = new RunModel();
  run.events(events(RUN_ID, ["before"], 1, 0));
  run.finished(failed(RUN_ID));
  assert.equal(run.phase, "idle");
  assert.equal(run.starting({ goal: "g", profile: null, workflow: null }), true);
  run.started(RUN_ID, 0);
  assert.equal(run.items.length, 0, "what came before the start is not taken");
  assert.equal(run.phase, "running");
  run.finished(failed(RUN_ID));
  run.events(events(RUN_ID, ["late"], 3, 3));
  assert.equal(run.items.length, 0, "an ended run takes no more");
});
