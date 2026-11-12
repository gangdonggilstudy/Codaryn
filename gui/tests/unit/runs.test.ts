/**
 * GU-3: a run from the window. The engine host's run registry and calls with a fake app
 * (src/engine-host/runs.ts, host.ts), the run messages on the channel (src/shared/protocol.ts), the
 * main process's run manager (src/main/runs.ts) and the window's run model (src/renderer/run).
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { createHostHandler, serve } from "../../src/engine-host/host.js";
import type { HostDeps } from "../../src/engine-host/host.js";
import { fakeApp } from "./fake-app.js";
import { createRunRegistry, runResultValue } from "../../src/engine-host/runs.js";
import type { HostStartRunRequest } from "../../src/engine-host/runs.js";
import { RunManager } from "../../src/main/runs.js";
import { GOAL_LIMIT, RunModel, clock, localTime } from "../../src/renderer/run/run-model.js";
import { IPC_EVENTS, MAX_GOAL_CHARS, parseStartRunArgs } from "../../src/shared/ipc.js";
import type { RunDonePayload, RunEventsPayload } from "../../src/shared/ipc.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import type { HostMessage, HostRunMessage } from "../../src/shared/protocol.js";

const TOKEN = "ab".repeat(16);
const RUN_ID = "20261112T010203Z-0000abcd";
const WORKSPACE = path.resolve("ws-for-run-test");
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const RESULT = {
  schemaVersion: 1,
  kind: "run",
  runId: RUN_ID,
  taskId: "quick",
  status: "needs-input",
  reason: "no_verifier",
  exitCode: 3,
  provider: "anthropic",
  verifiers: [{ id: "v-secret-name", kind: "file_rules", outcome: "pass", evidence: "e", checked: [], limits: [] }],
  changes: [{ path: "docs/a\u0007.md", previousHash: null, newHash: "a".repeat(64), created: true }],
  usage: { modelTurns: 2, toolCalls: 1, inputTokens: 10, outputTokens: 5, durationMs: 1500 },
  journalPath: ".codaryn/runs/x/journal.jsonl",
  notices: ["note"],
};

const record = (seq: number, type: string, extra: Record<string, unknown> = {}): unknown => ({
  kind: "record",
  record: { seq, at: "2026-11-12T01:02:03.000Z", runId: RUN_ID, type, ...extra },
});

/** A fake app run: emits `events` (some before startRun answers), then ends with `outcome` when `finish` is called. */
function fakeRun(events: unknown[], outcome: unknown = { ok: true, result: RESULT }) {
  let finish: () => void = () => undefined;
  const cancelled: string[] = [];
  const requests: HostStartRunRequest[] = [];
  const startRun = async (request: HostStartRunRequest, observer: { onEvent(event: unknown): void }): Promise<unknown> => {
    requests.push(request);
    observer.onEvent(events[0]);
    const done = new Promise<unknown>((resolve) => {
      finish = () => {
        for (const event of events.slice(1)) observer.onEvent(event);
        resolve(outcome);
      };
    });
    return { ok: true, handle: { runId: RUN_ID, workspaceRoot: WORKSPACE, cancel: () => cancelled.push(RUN_ID), done } };
  };
  return { startRun, finish: () => finish(), cancelled, requests };
}

const itemOf = (event: unknown): { at: string | null; kind: string; text: string } | null => {
  const r = (event as { record?: Record<string, unknown> }).record;
  return r === undefined ? null : { at: r["at"] as string, kind: r["type"] as string, text: `line ${String(r["seq"])}` };
};

test("runs (GU-3): items go out in one events message after the start's answer, and done goes last", async () => {
  const written: HostMessage[] = [];
  const fake = fakeRun([record(1, "run_started"), record(2, "model_request"), record(3, "tool_result"), record(4, "run_finished")]);
  const registry = createRunRegistry({
    startRun: fake.startRun,
    itemOf,
    shown: (text) => `<${text}>`,
    token: () => TOKEN,
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
    flushMs: 5,
  });
  const started = await registry.start({ workspace: WORKSPACE, goal: "do it", profile: "doc", workflowRef: null });
  assert.deepEqual(started, { ok: true, run: TOKEN, runId: RUN_ID });
  assert.equal(written.length, 0, "nothing goes out before the answer to startRun is written");
  assert.deepEqual(fake.requests[0], { input: { kind: "quick", workspace: WORKSPACE, goal: "do it" }, configPath: null, varsFile: null, profile: "doc", workflowRef: null, cancelFile: null });
  await sleep(20);
  fake.finish();
  await sleep(30);
  const types = written.map((message) => ("type" in message ? message.type : "response"));
  assert.equal(types.at(-1), "done");
  const events = written.filter((m): m is HostRunMessage & { type: "events" } => "type" in m && m.type === "events");
  assert.deepEqual(
    events.flatMap((m) => m.items.map((item) => item.text)),
    ["line 1", "line 2", "line 3", "line 4"],
  );
  assert.deepEqual(events.at(-1)?.counts, { turns: 1, tools: 1 });
  const done = written.at(-1) as HostRunMessage & { type: "done" };
  const text = JSON.stringify(done.outcome);
  assert.equal(text.includes("journal.jsonl") || text.includes(WORKSPACE) || text.includes("v-secret-name"), false, "no paths and no verifier ids go out");
  assert.deepEqual((done.outcome as { result: { changes: unknown } }).result.changes, [{ path: "<docs/a\u0007.md>", created: true }]);
  assert.equal(registry.size, 0);
});

test("runs (GU-3): a skipped record number becomes one gap item; a failed start sends nothing but its code", async () => {
  const written: HostMessage[] = [];
  const fake = fakeRun([record(1, "run_started"), record(5, "run_finished")]);
  const registry = createRunRegistry({ startRun: fake.startRun, itemOf, shown: (t) => t, token: () => TOKEN, write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage), log: () => undefined, flushMs: 1 });
  await registry.start({ workspace: WORKSPACE, goal: "g", profile: null, workflowRef: null });
  fake.finish();
  await sleep(20);
  const kinds = written.flatMap((m) => ("type" in m && m.type === "events" ? m.items.map((item) => item.kind) : []));
  assert.deepEqual(kinds, ["run_started", "gap", "run_finished"]);

  const failing = createRunRegistry({
    startRun: async (_request, observer) => {
      observer.onEvent(record(1, "run_started"));
      return { ok: false, error: { code: "invalid_task", message: "C:\\some\\path" } };
    },
    itemOf,
    shown: (t) => t,
    token: () => TOKEN,
    write: () => assert.fail("nothing is written for a run that did not start"),
    log: () => undefined,
    flushMs: 1,
  });
  assert.deepEqual(await failing.start({ workspace: WORKSPACE, goal: "g", profile: null, workflowRef: null }), { ok: false, code: "invalid_task" });
  await sleep(10);
});

test("runs (GU-3): the host checks startRun's arguments, cancels by token, and cancels every run when the input ends", async () => {
  const written: HostMessage[] = [];
  const fake = fakeRun([record(1, "run_started")]);
  const deps: HostDeps = {
    app: fakeApp({ startRun: fake.startRun }),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (t) => t,
    providers: [],
    itemsIn: () => itemOf,
    token: () => TOKEN,
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
  };
  const handler = createHostHandler(deps);
  const call = async (id: number, name: string, args: unknown): Promise<unknown> => {
    await handler.handleLine(JSON.stringify({ v: 1, id, call: name, args }));
    const message = written.find((m) => "id" in m && m.id === id) as { ok: boolean; value?: unknown; error?: { code: string } };
    return message.ok ? message.value : message.error?.code;
  };
  const good = { workspace: WORKSPACE, goal: "g", profile: null, workflowRef: null, language: "ko" };
  for (const [id, args] of [
    [1, { ...good, workspace: "relative" }],
    [2, { ...good, goal: "   " }],
    [3, { ...good, language: "fr" }],
    [4, { ...good, configPath: "C:\\x.json" }],
    [5, { ...good, profile: "line\nbreak" }],
    [6, { ...good, goal: "x".repeat(20_001) }],
  ] as const) {
    assert.equal(await call(id, "startRun", args), "invalid_args", `request ${id}`);
  }
  assert.equal(fake.requests.length, 0, "no refused request reached the app");
  assert.deepEqual(await call(7, "startRun", good), { ok: true, run: TOKEN, runId: RUN_ID });
  // The answer to startRun is the first line about this run.
  assert.equal(written.findIndex((m) => "type" in m), -1);
  assert.equal(await call(8, "cancelRun", { run: "x" }), "invalid_args");
  assert.deepEqual(await call(9, "cancelRun", { run: "cd".repeat(16) }), { ok: false });
  assert.deepEqual(await call(10, "cancelRun", { run: TOKEN }), { ok: true });
  assert.deepEqual(fake.cancelled, [RUN_ID]);

  // serve(): when the input ends, every run is cancelled.
  const second = fakeRun([record(1, "run_started")]);
  const lines = [JSON.stringify({ v: 1, id: 1, call: "startRun", args: good }) + "\n"];
  async function* input(): AsyncGenerator<string> {
    for (const line of lines) yield line;
    await sleep(20);
  }
  await serve(input(), { ...deps, app: fakeApp({ startRun: second.startRun }), write: () => undefined }, { graceMs: 10 });
  assert.deepEqual(second.cancelled, [RUN_ID]);
});

test("runs (GU-3): run messages on the channel are checked", () => {
  const ok = { v: 1, type: "events", run: TOKEN, items: [{ at: "2026-11-12T01:02:03.000Z", kind: "tool_denied", text: "x" }], counts: { turns: 1, tools: 2 } };
  assert.notEqual(parseHostMessage(JSON.stringify(ok)), null);
  for (const bad of [
    { ...ok, run: "short" },
    { ...ok, items: [{ at: "yesterday", kind: "x", text: "x" }] },
    { ...ok, items: [{ at: null, kind: "Bad Kind", text: "x" }] },
    { ...ok, items: [{ at: null, kind: "x", text: "y".repeat(5000) }] },
    { ...ok, items: Array.from({ length: 2001 }, () => ({ at: null, kind: "x", text: "" })) },
    { ...ok, counts: { turns: -1, tools: 0 } },
    { ...ok, type: "other" },
  ]) {
    assert.equal(parseHostMessage(JSON.stringify(bad)), null, JSON.stringify(bad).slice(0, 80));
  }
  assert.deepEqual(parseHostMessage(JSON.stringify({ v: 1, type: "done", run: TOKEN, outcome: { ok: true } })), { v: 1, type: "done", run: TOKEN, outcome: { ok: true } });
});

test("runs (GU-3): the main process passes on the active run's messages only, checked, and keeps early ones", async () => {
  const sent: [string, RunEventsPayload | RunDonePayload][] = [];
  const changes: boolean[] = [];
  const manager = new RunManager({
    send: (channel, payload) => sent.push([channel, payload]),
    labels: async (status, reason) => ({ status: `S:${status}`, reason: `R:${reason}` }),
    onChange: (running) => changes.push(running),
  });
  const events: HostRunMessage = { v: 1, type: "events", run: TOKEN, items: [{ at: null, kind: "x", text: "early" }], counts: { turns: 0, tools: 0 } };
  await manager.receive(events);
  assert.equal(sent.length, 0);
  manager.begin(TOKEN, RUN_ID);
  await sleep(0);
  assert.deepEqual(sent[0], [IPC_EVENTS.runEvents, { runId: RUN_ID, items: events.items, counts: events.counts }], "an early message is replayed on begin");
  await manager.receive({ ...events, run: "cd".repeat(16) });
  assert.equal(sent.length, 1, "another token's messages are dropped");
  const outcome = runResultValue({ ok: true, result: RESULT }, (t) => t);
  await manager.receive({ v: 1, type: "done", run: TOKEN, outcome });
  const done = sent.at(-1)?.[1] as RunDonePayload;
  assert.equal(done.ok, true);
  if (done.ok) {
    assert.deepEqual(done.labels, { status: "S:needs-input", reason: "R:no_verifier" });
    assert.equal(done.result.runId, RUN_ID);
    assert.deepEqual(done.result.verifiers, [{ number: 1, outcome: "pass" }]);
  }
  assert.equal(manager.running, false);
  assert.deepEqual(changes, [true, false]);

  manager.begin(TOKEN, RUN_ID);
  await manager.receive({ v: 1, type: "done", run: TOKEN, outcome: { ok: true, result: { ...RESULT, status: "exploded" } } });
  assert.deepEqual(sent.at(-1), [IPC_EVENTS.runDone, { runId: RUN_ID, ok: false, code: "host_error" }]);

  manager.begin(TOKEN, RUN_ID);
  assert.equal(await manager.waitDone(20), false, "waiting stops at its limit");
  manager.hostExited();
  assert.deepEqual(sent.at(-1), [IPC_EVENTS.runDone, { runId: RUN_ID, ok: false, code: "adapter_host_exited" }]);
  assert.equal(await manager.waitDone(20), true);
});

test("runs (GU-3): the window's run model: one run at a time, its own items only, filters and a cap", () => {
  const run = new RunModel();
  let changes = 0;
  run.subscribe(() => (changes += 1));
  assert.equal(run.canCancel, false);
  assert.equal(run.starting({ goal: "g", profile: null, workflow: null }), true);
  assert.equal(run.starting({ goal: "again", profile: null, workflow: null }), false, "one run at a time");
  assert.equal(run.canCancel, false, "nothing to cancel before startRun answered");
  run.started(RUN_ID, 1000);
  assert.equal(run.canCancel, true);
  run.events({ runId: "20261112T000000Z-ffffffff", items: [{ at: null, kind: "x", text: "other run" }], counts: { turns: 9, tools: 9 } });
  assert.equal(run.items.length, 0, "another run's items are not taken");
  run.events({
    runId: RUN_ID,
    items: [
      { at: null, kind: "tool_denied", text: "denied" },
      { at: null, kind: "gap", text: "" },
      { at: null, kind: "file_changed", text: "changed" },
      { at: null, kind: "verifier_result", text: "check" },
    ],
    counts: { turns: 1, tools: 2 },
  });
  assert.equal(run.gap, true);
  assert.deepEqual(run.shown("denied").map((i) => i.text), ["denied"]);
  assert.deepEqual(run.shown("files").map((i) => i.text), ["changed"]);
  assert.deepEqual(run.shown("checks").map((i) => i.text), ["check"]);
  assert.equal(run.shown("all").length, 3);
  assert.equal(run.elapsed(4500), 3);
  run.cancelling();
  run.cancelFailed();
  assert.equal(run.phase, "running");
  run.events({ runId: RUN_ID, items: Array.from({ length: 6000 }, (_v, i) => ({ at: null, kind: "x", text: String(i) })), counts: { turns: 1, tools: 2 } });
  assert.equal(run.items.length, 5000);
  // 3 earlier items and 6000 new ones: the 1003 oldest go, so new item 1000 comes first.
  assert.equal(run.items[0]?.text, "1000", "the oldest go first");
  run.finished({ runId: RUN_ID, ok: false, code: "adapter_host_exited" });
  assert.equal(run.phase, "done");
  assert.equal(run.canStart, true);
  assert.equal(run.last?.goal, "g", "the goal stays for this session only");
  assert.ok(changes > 0);
  assert.equal(clock(5), "0:05");
  assert.equal(clock(3725), "1:02:05");
  assert.equal(localTime("not a time"), "");
  assert.match(localTime("2026-11-12T01:02:03.000Z"), /^\d\d:\d\d:\d\d$/);
});

test("runs (GU-3): the window's startRun arguments are a handle, a goal and names only", () => {
  const handle = "0".repeat(32);
  assert.deepEqual(parseStartRunArgs({ workspace: handle, goal: "g", profile: null, workflow: "code" }), { workspace: handle, goal: "g", profile: null, workflow: "code" });
  assert.equal(parseStartRunArgs({ workspace: "C:\\work", goal: "g", profile: null, workflow: null }), null, "a path is not a handle");
  assert.equal(parseStartRunArgs({ workspace: handle, goal: "", profile: null, workflow: null }), null);
  assert.equal(parseStartRunArgs({ workspace: handle, goal: "g", profile: null, workflow: null, policy: {} }), null, "no policy field");
  assert.equal(GOAL_LIMIT, MAX_GOAL_CHARS, "the page and the main process take the same longest goal");
  assert.equal(parseStartRunArgs({ workspace: handle, goal: "g", profile: "a\u0000b", workflow: null }), null);
});
