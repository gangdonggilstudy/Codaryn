/**
 * U-271 (docs/design/standalone-gui.md 3.6): the status bar and the run screen showed the turns and tool
 * calls so far ("turns 3"); the design shows them against the run's limits ("turns 3/12, tools 5/24").
 * The engine host now takes the limits the run started with (run_started.limits: maxModelTurns,
 * maxToolCalls, maxDurationMs) and sends them with the counts; the main process and the window check
 * them again (whole numbers above 0; anything else is left out and the counts still go), and both show
 * "3/12" and the time against its limit. Before the start gave them, the counts show alone, as before.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createRunRegistry } from "../../src/engine-host/runs.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { asRunEvents } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { RunModel, countValues } from "../../src/renderer/run/run-model.js";
import { runScreen } from "../../src/renderer/run/run-screen.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import type { HostMessage } from "../../src/shared/protocol.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const TOKEN = "d".repeat(32);
const RUN = "20261114T060000Z-0000f271";
const LIMITS = { maxModelTurns: 12, maxToolCalls: 24, maxTotalTokens: null, maxDurationMs: 600_000 };
const record = (seq: number, type: string, extra: Record<string, unknown> = {}): unknown => ({ kind: "record", record: { seq, at: "2026-11-14T06:00:00.000Z", runId: RUN, type, ...extra } });

async function countsSent(events: readonly unknown[]): Promise<unknown[]> {
  const written: HostMessage[] = [];
  const seen: { observer?: { onEvent(event: unknown): void } } = {};
  const registry = createRunRegistry({
    startRun: async (_request, observer) => {
      seen.observer = observer;
      return { ok: true, handle: { runId: RUN, cancel: () => undefined, done: new Promise(() => undefined) } };
    },
    // Counts go with a batch of items: every record has a line here.
    itemOf: (event) => {
      const r = (event as { record?: Record<string, unknown> }).record;
      return r === undefined ? null : { at: null, kind: String(r["type"]), text: "" };
    },
    shown: (text) => text,
    token: () => TOKEN,
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
    flushMs: 1,
  });
  await registry.start({ workspace: "C:\\ws", goal: "g", profile: null, workflowRef: null });
  for (const event of events) {
    seen.observer?.onEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return written.flatMap((m) => ("type" in m && m.type === "events" ? [m.counts] : []));
}

test("U-271 (3.6): the engine host sends the run's limits with its counts once run_started gave them", async () => {
  const sent = await countsSent([record(1, "run_started", { limits: LIMITS }), record(2, "model_request"), record(3, "tool_result")]);
  assert.deepEqual(sent.at(-1), { turns: 1, tools: 1, limits: { turns: 12, tools: 24, durationMs: 600_000 } });
  // A start without limits that fit: the counts alone, as before.
  const none = await countsSent([record(1, "run_started", { limits: { ...LIMITS, maxModelTurns: 0 } }), record(2, "model_request")]);
  assert.deepEqual(none.at(-1), { turns: 1, tools: 0 });
  const missing = await countsSent([record(1, "run_started"), record(2, "model_request")]);
  assert.deepEqual(missing.at(-1), { turns: 1, tools: 0 });
});

test("U-271 (3.6): the main process and the window check the limits again; ones that do not fit are left out, the counts kept", () => {
  const line = (limits: unknown) => JSON.stringify({ v: 1, type: "events", run: TOKEN, items: [], counts: { turns: 2, tools: 3, limits } });
  assert.deepEqual((parseHostMessage(line({ turns: 12, tools: 24, durationMs: 600_000 })) as { counts?: unknown }).counts, { turns: 2, tools: 3, limits: { turns: 12, tools: 24, durationMs: 600_000 } });
  for (const bad of [{ turns: 0, tools: 24, durationMs: 1 }, { turns: 1.5, tools: 24, durationMs: 1 }, { turns: "12", tools: 24, durationMs: 1 }, null, "x"]) {
    assert.deepEqual((parseHostMessage(line(bad)) as { counts?: unknown }).counts, { turns: 2, tools: 3 }, JSON.stringify(bad));
    assert.deepEqual(asRunEvents({ runId: RUN, items: [], counts: { turns: 2, tools: 3, limits: bad } })?.counts, { turns: 2, tools: 3 }, JSON.stringify(bad));
  }
  assert.deepEqual(asRunEvents({ runId: RUN, items: [], counts: { turns: 2, tools: 3, limits: { turns: 12, tools: 24, durationMs: 600_000, extra: 1 } } })?.counts, { turns: 2, tools: 3, limits: { turns: 12, tools: 24, durationMs: 600_000 } });
});

test("U-271 (3.6): the counts against the limits, and alone before they are known", () => {
  assert.deepEqual(countValues({ turns: 3, tools: 5, limits: { turns: 12, tools: 24, durationMs: 600_000 } }, 42), { time: "0:42/10:00", turns: "3/12", tools: "5/24" });
  assert.deepEqual(countValues({ turns: 3, tools: 5 }, 42), { time: "0:42", turns: "3", tools: "5" });
  assert.deepEqual(countValues({ turns: 0, tools: 0, limits: { turns: 1, tools: 1, durationMs: 1_500 } }, null), { time: "-", turns: "0/1", tools: "0/1" });
});

test("U-271 (3.6): the run screen shows the counts against the run's limits", async () => {
  const restore = installFakeDom();
  const root = new FakeElement("main");
  try {
    const run = new RunModel();
    const api = new Proxy({} as CodarynApi, { get: () => async () => null });
    runScreen({ texts: textsFor("en"), api, run, newTask: () => undefined, announce: () => undefined, current: () => ({ handle: "1".repeat(32), name: "ws" }), openPlan: () => undefined, openChanges: () => undefined, openReport: () => undefined }).show(root as unknown as HTMLElement);
    assert.ok(run.starting({ goal: "g", profile: null, workflow: null }));
    run.started(RUN, Date.now());
    run.events({ runId: RUN, items: [], counts: { turns: 3, tools: 5, limits: { turns: 12, tools: 24, durationMs: 600_000 } } });
    await settle();
    const counts = root.findAll((e) => e.getAttribute("id") === "run-counts")[0]?.textContent ?? "";
    assert.match(counts, /model turns 3\/12 · tool calls 5\/24/);
    assert.match(counts, /\/10:00/);
  } finally {
    root.replaceChildren();
    restore();
  }
});
