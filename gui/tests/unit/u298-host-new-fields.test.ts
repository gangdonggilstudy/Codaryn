/**
 * U-298 (ne-verify's R-114 I-2): U-293 (C-6a, the app's lifetime) gave a run's handle `mask`,
 * `configLanguage` and `defaultConfig`, its outcome `tally` beside the result and `modelNotFound`, and a
 * refused start `configLanguage`. The engine host passes none of them to the main process: it writes the
 * fields it picks (runs.ts), and `mask` is a function. Only that structure kept it so; this test pins it,
 * as R-114's probe did: a fake handle and outcome with every new field, carrying a marker, go through the
 * run registry for a run, a task file's run and an apply, started and refused, and neither the call's
 * answer nor any line written for the main process holds a field name, the marker or the language.
 * No product code changes with it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createRunRegistry } from "../../src/engine-host/runs.js";

const RUN = "20261114T080000Z-0000a298";
const MARK = "u298-marker-value";
const NEEDLES = ["configLanguage", "defaultConfig", '"mask"', MARK, "tally", "deniedToolCalls", "deniedCommandCalls", "failedToolCalls", "modelNotFound", '"ko"'];

const record = (seq: number, type: string): unknown => ({ kind: "record", record: { seq, at: "2026-11-14T08:00:00.000Z", runId: RUN, type } });

/** A start as the app layer gives it since U-293: every new field, each with the marker where it is text. */
function begin(refuse: boolean) {
  return async (_request: unknown, observer: { onEvent(event: unknown): void }): Promise<unknown> => {
    if (refuse) return { ok: false, error: { code: "workspace_locked", message: `locked ${MARK}`, category: "state", retryable: true }, configLanguage: "ko" };
    observer.onEvent(record(1, "run_started"));
    return {
      ok: true,
      handle: {
        runId: RUN,
        workspaceRoot: "C:\\ws",
        cancel: () => undefined,
        configLanguage: "ko",
        defaultConfig: `%APPDATA%\\Codaryn\\config.json ${MARK}`,
        mask: (text: string) => `${MARK}:${text}`,
        done: new Promise((resolve) => {
          setTimeout(() => {
            observer.onEvent(record(2, "run_finished"));
            resolve({
              ok: true,
              result: { schemaVersion: 1, kind: "run", runId: RUN, taskId: "t", status: "done", reason: "verified", exitCode: 0, changes: [], verifiers: [], usage: {}, notices: [], masking: { registeredValues: 0, maskedPlaces: 0 } },
              tally: { deniedToolCalls: 7, deniedCommandCalls: 7, failedToolCalls: 7, marker: MARK },
              modelNotFound: true,
            });
          }, 5);
        }),
      },
    };
  };
}

type Way = "run" | "task file" | "apply";

/** The call's answer and every line the host wrote, for one way of starting, started or refused. */
async function written(way: Way, refuse: boolean): Promise<{ readonly reply: unknown; readonly lines: readonly string[] }> {
  const lines: string[] = [];
  const registry = createRunRegistry({
    startRun: begin(refuse),
    applyPlan: begin(refuse),
    itemOf: (event) => {
      const r = (event as { record?: Record<string, unknown> }).record;
      return r === undefined ? null : { at: null, kind: String(r["type"]), text: "" };
    },
    shown: (text) => text,
    token: () => "c".repeat(32),
    write: (line) => lines.push(line),
    log: () => undefined,
    flushMs: 1,
  });
  const reply =
    way === "run"
      ? await registry.start({ workspace: "C:\\ws", goal: "g", profile: null, workflowRef: null })
      : way === "task file"
        ? await registry.startTask({ taskPath: "C:\\tasks\\t.json", varsFile: null })
        : await registry.startApply({ workspace: "C:\\ws", profile: null, workflowRef: null, planRunId: "20261114T070000Z-0000b298", digest: "ab".repeat(32), consent: false });
  await new Promise((resolve) => setTimeout(resolve, 40));
  return { reply, lines };
}

for (const way of ["run", "task file", "apply"] as const) {
  const named = `${way === "apply" ? "an" : "a"} ${way}`;
  test(`U-298 (R-114 I-2): ${named} started: the app's new fields reach no line for the main process`, async () => {
    const { reply, lines } = await written(way, false);
    const types = lines.map((line) => (JSON.parse(line) as { type?: unknown }).type);
    assert.ok(types.includes("events") && types.includes("done"), `the host wrote its lines: ${JSON.stringify(types)}`);
    const all = `${JSON.stringify(reply)}\n${lines.join("")}`;
    assert.deepEqual(NEEDLES.filter((needle) => all.includes(needle)), []);
  });

  test(`U-298 (R-114 I-2): ${named} refused: its configLanguage reaches neither the answer nor a line`, async () => {
    const { reply, lines } = await written(way, true);
    assert.equal((reply as { ok?: unknown }).ok, false);
    const all = `${JSON.stringify(reply)}\n${lines.join("")}`;
    assert.deepEqual(NEEDLES.filter((needle) => all.includes(needle)), []);
  });
}
