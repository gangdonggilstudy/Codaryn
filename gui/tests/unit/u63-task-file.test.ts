/**
 * U-63 (docs/design/standalone-gui.md 3.5, GUI-D8): a run of a task file, with a variables file when
 * asked for. The page sends the open workspace and whether to choose a variables file; the main
 * process's OS dialogs choose the paths, which go to the engine host only and are not kept. The
 * engine host gives the app layer the task form and the variables file. A task file names its own
 * workspace (the app layer does not tell the window which), so the result offers the next steps only
 * when the open workspace's run list has the run, and with the run's form unknown.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { createHostHandler } from "../../src/engine-host/host.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { newTaskScreen } from "../../src/renderer/run/new-task.js";
import { RunModel } from "../../src/renderer/run/run-model.js";
import { runScreen } from "../../src/renderer/run/run-screen.js";
import { parseStartTaskArgs } from "../../src/shared/ipc.js";
import type { RunResultView } from "../../src/shared/ipc.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import type { HostMessage } from "../../src/shared/protocol.js";
import { fakeApp } from "./fake-app.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const HANDLE = "1".repeat(32);
const RUN = "20261113T070000Z-0000a063";
const byId = (root: FakeElement, id: string): FakeElement | undefined => root.findAll((e) => e.getAttribute("id") === id)[0];

test("U-63: the page sends the open workspace and whether to choose a variables file, never a path", () => {
  assert.deepEqual(parseStartTaskArgs({ workspace: HANDLE, withVars: true }), { workspace: HANDLE, withVars: true });
  assert.deepEqual(parseStartTaskArgs({ workspace: HANDLE, withVars: false }), { workspace: HANDLE, withVars: false });
  for (const bad of [{ workspace: HANDLE }, { workspace: HANDLE, withVars: "yes" }, { workspace: "C:\\work", withVars: false }, { workspace: HANDLE, withVars: false, taskPath: "C:\\t.json" }]) {
    assert.equal(parseStartTaskArgs(bad), null, JSON.stringify(bad));
  }
});

test("U-63: the engine host gives the app layer the task form and the variables file the dialogs chose", async () => {
  const requests: unknown[] = [];
  const written: HostMessage[] = [];
  const handler = createHostHandler({
    app: fakeApp({
      startRun: async (request) => {
        requests.push(request);
        return { ok: false, error: { code: "invalid_task", message: "a message with C:\\some\\path" } };
      },
    }),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (text) => text,
    providers: [],
    itemsIn: () => () => null,
    token: () => "0".repeat(32),
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
  });
  const call = async (id: number, args: unknown): Promise<unknown> => {
    await handler.handleLine(JSON.stringify({ v: 1, id, call: "startTaskRun", args }));
    const message = written.find((m) => "id" in m && m.id === id) as { ok: boolean; value?: unknown; error?: { code: string } };
    return message.ok ? message.value : message.error?.code;
  };
  const task = path.resolve("tasks", "task.json");
  const vars = path.resolve("tasks", "vars.env");
  assert.deepEqual(await call(1, { taskPath: task, varsFile: vars, language: "en" }), { ok: false, code: "invalid_task" }, "the app layer's code only, no message");
  assert.deepEqual(requests[0], { input: { kind: "task", taskPath: task }, configPath: null, varsFile: vars, profile: null, workflowRef: null, cancelFile: null });
  await call(2, { taskPath: task, varsFile: null, language: "ko" });
  assert.equal((requests[1] as { varsFile: unknown }).varsFile, null);
  for (const [id, bad] of [[3, { taskPath: "tasks/task.json", varsFile: null, language: "en" }], [4, { taskPath: task, varsFile: "vars.env", language: "en" }], [5, { taskPath: task, varsFile: null, language: "en", workspace: task }], [6, { taskPath: task, varsFile: null, language: "fr" }]] as const) {
    assert.equal(await call(id, bad), "invalid_args", JSON.stringify(bad));
  }
  assert.equal(requests.length, 2, "nothing started for refused arguments");
});

test("U-63: the new task screen starts a task file's run; a dialog closed without a file starts nothing and keeps the goal", async () => {
  const restore = installFakeDom();
  try {
    const calls: unknown[][] = [];
    const replies: unknown[] = [{ ok: false, code: "cancelled" }, { ok: true, runId: RUN }];
    const view = { file: null, model: null, language: null, profiles: [], workflows: { builtin: [], config: [] }, keyAvailable: false, providers: [], env: { model: false, language: false }, rules: { limits: [], commands: [], protectedPaths: [], secretEnv: [] }, provider: null, defaultProvider: null, apiProviders: [] };
    const api = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => async (...args: unknown[]) => {
        if (name === "settings") return { ok: true, view };
        if (name === "startTaskRun") {
          calls.push(args);
          return replies.shift();
        }
        return null;
      },
    });
    const run = new RunModel();
    run.last = { goal: "the session's goal", profile: null, workflow: null };
    let shownRun = 0;
    const screen = newTaskScreen({ texts: textsFor("en"), api, run, current: () => ({ handle: HANDLE, name: "ws" }), open: () => undefined, showRun: () => void (shownRun += 1) });
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    byId(root, "task-run-file")?.click();
    await settle();
    assert.deepEqual(calls, [[HANDLE, false]]);
    assert.equal(run.phase, "idle");
    assert.equal(run.startError, "start_cancelled");
    assert.equal(run.last?.goal, "the session's goal", "the goal stays for the next run");
    (byId(root, "task-with-vars") as FakeElement & { checked: boolean }).checked = true;
    byId(root, "task-run-file")?.click();
    await settle();
    assert.deepEqual(calls[1], [HANDLE, true], "a variables file too");
    assert.equal(run.phase, "running");
    assert.equal(run.last?.taskFile, true);
    assert.equal(shownRun, 1);
  } finally {
    restore();
  }
});

function result(): RunResultView {
  return {
    runId: RUN, status: "needs-input", reason: "awaiting_review", exitCode: 0, changes: [{ path: "a.md", created: false }], verifiers: [],
    usage: { turns: 1, tools: 0, inputTokens: null, outputTokens: null, durationMs: null }, notices: [], plan: { digest: "d".repeat(64), actions: 1 },
    review: { checklist: ["check it"] }, protectedChanged: null, kind: "run", planRunId: null, unsafeMoves: null, applied: [], finalMessage: null,
  };
}

async function ended(listed: boolean, plans: unknown[][]): Promise<FakeElement> {
  const model = new RunModel();
  model.starting({ goal: "", profile: null, workflow: null, taskFile: true });
  model.started(RUN, Date.now());
  model.finished({ runId: RUN, ok: true, result: result(), labels: { status: "S", reason: "R" } });
  const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "listRuns" ? { ok: true, runs: listed ? [{ state: "checked", runId: RUN, kind: "run", startedAt: null, taskId: "t", status: "needs-input", reason: "awaiting_review", changes: 1, reverted: null, revertRecordDamaged: false }] : [], omitted: 0 } : null) });
  const root = new FakeElement("main");
  runScreen({ texts: textsFor("en"), api, run: model, newTask: () => undefined, announce: () => undefined, current: () => ({ handle: HANDLE, name: "ws" }), openPlan: (...args: unknown[]) => void plans.push(args), openChanges: () => undefined, openReport: () => undefined }).show(root as unknown as HTMLElement);
  await settle();
  await settle();
  return root;
}

test("U-63: a task file's run offers its next steps only when the open workspace has it, with its form unknown", async () => {
  const restore = installFakeDom();
  const roots: FakeElement[] = [];
  try {
    const plans: unknown[][] = [];
    const here = await ended(true, plans);
    roots.push(here);
    assert.equal(byId(here, "run-task-steps")?.getAttribute("data-task-place"), "open");
    assert.ok(byId(here, "run-view-report") !== undefined);
    byId(here, "run-view-plan")?.click();
    assert.deepEqual(plans, [[RUN, null, null, false]], "its plan is shown, not applied here");
    assert.equal(byId(here, "review-accept"), undefined, "no review panel without the run's form");
    assert.ok(byId(here, "run-review-cli")?.textContent.includes("codaryn review"));
    const elsewhere = await ended(false, plans);
    roots.push(elsewhere);
    assert.equal(byId(elsewhere, "run-task-steps")?.getAttribute("data-task-place"), "elsewhere");
    assert.ok(byId(elsewhere, "run-task-elsewhere")?.textContent.includes("open that folder"));
    assert.equal(byId(elsewhere, "run-view-report"), undefined, "nothing that would read the open workspace's records");
  } finally {
    for (const root of roots) root.replaceChildren();
    restore();
  }
});
