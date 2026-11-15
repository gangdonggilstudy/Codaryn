/**
 * U-271 (ne-verify's R-112 L-1): an apply of a plan of moves stores `plan_item_started` right before each
 * action (R-9 I-4) and the app layer does not give it (src/app/apply.ts: its number is skipped), so the
 * numbers given skip one before each action's record. The engine host counted that as a missing line, so
 * every apply with an action showed "some progress lines are missing" (run.gap) with none missing. Now
 * that one known number is not a gap; a record the app layer could not give (it could not be masked)
 * still is one, and a model run's rule is as before.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createRunRegistry } from "../../src/engine-host/runs.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import type { HostMessage } from "../../src/shared/protocol.js";

const TOKEN = "c".repeat(32);
const RUN = "20261114T010000Z-0000a271";
const record = (seq: number, type: string): unknown => ({ kind: "record", record: { seq, at: "2026-11-14T01:00:00.000Z", runId: RUN, type } });
const itemOf = (event: unknown): { at: string | null; kind: string; text: string } | null => {
  const r = (event as { record?: Record<string, unknown> }).record;
  return r === undefined ? null : { at: r["at"] as string, kind: r["type"] as string, text: "" };
};

/** The item kinds the engine host sends for `events`, given after the start (an apply's or a run's) answered. */
async function kindsOf(events: readonly unknown[], apply: boolean): Promise<string[]> {
  const written: HostMessage[] = [];
  const seen: { observer?: { onEvent(event: unknown): void } } = {};
  const begin = async (_request: unknown, observer: { onEvent(event: unknown): void }): Promise<unknown> => {
    seen.observer = observer;
    return { ok: true, handle: { runId: RUN, cancel: () => undefined, done: new Promise(() => undefined) } };
  };
  const registry = createRunRegistry({
    startRun: begin,
    applyPlan: begin,
    itemOf,
    shown: (text) => text,
    token: () => TOKEN,
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
    flushMs: 1,
  });
  if (apply) await registry.startApply({ workspace: "C:\\ws", profile: null, workflowRef: null, planRunId: "20261114T000000Z-0000b271", digest: "ab".repeat(32), consent: false });
  else await registry.start({ workspace: "C:\\ws", goal: "g", profile: null, workflowRef: null });
  for (const event of events) seen.observer?.onEvent(event);
  await new Promise((resolve) => setTimeout(resolve, 20));
  return written.flatMap((m) => ("type" in m && m.type === "events" ? m.items.map((item) => item.kind) : []));
}

test("U-271 (R-112 L-1): an apply's action records after their undelivered start records are no gap", async () => {
  // 3, 5 and 7 are the plan_item_started of the three actions: stored, not given.
  const kinds = await kindsOf([record(1, "apply_started"), record(2, "plan_checked"), record(4, "file_moved"), record(6, "file_discarded"), record(8, "plan_item_failed"), record(9, "run_finished")], true);
  assert.deepEqual(kinds, ["apply_started", "plan_checked", "file_moved", "file_discarded", "plan_item_failed", "run_finished"]);
});

test("U-271 (R-112 L-1): a record an apply could not give is still a gap; a model run's rule is as before", async () => {
  // 6 (file_moved) was not given: 8 comes four after 4. 10 (verifier_result) was not given: 11 is no action record.
  const apply = await kindsOf([record(1, "apply_started"), record(2, "plan_checked"), record(4, "file_moved"), record(8, "file_moved"), record(9, "verifier_result"), record(11, "run_finished")], true);
  assert.deepEqual(apply, ["apply_started", "plan_checked", "file_moved", "gap", "file_moved", "verifier_result", "gap", "run_finished"]);
  // A run has no undelivered start records: a skipped number is a gap whatever comes after it.
  const run = await kindsOf([record(1, "run_started"), record(3, "plan_item_failed"), record(5, "tool_result")], false);
  assert.deepEqual(run, ["run_started", "gap", "plan_item_failed", "gap", "tool_result"]);
});
