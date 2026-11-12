/**
 * R21b-L-1 and the last task form per workspace: the main process remembers the task form of each
 * run started in the app (src/main/gui-state.ts, src/main/workspaces.ts); the run list opens a plan
 * with that form, and a plan whose form is unknown is shown but not applied (plan screen).
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { EMPTY_STATE, MAX_REMEMBERED_RUNS, MAX_REMEMBERED_WORKSPACES, memoryFor, parseGuiState, readGuiState, withOpened, withoutPath, withRunForm, writeGuiState } from "../../src/main/gui-state.js";
import { Workspaces } from "../../src/main/workspaces.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { planScreen } from "../../src/renderer/plan/plan-screen.js";
import { RunModel } from "../../src/renderer/run/run-model.js";
import { runsScreen } from "../../src/renderer/runs/runs-screen.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const RUN = (n: number): string => `20261112T0102${String(n % 60).padStart(2, "0")}Z-${n.toString(16).padStart(8, "0")}`;
const ORGANIZE = { profile: null, workflow: "organize" };
const TIDY = { profile: "tidy", workflow: null };

test("run forms: remembered per workspace, newest first and once, kept through opening and forgetting, bounded", () => {
  let state = withRunForm(EMPTY_STATE, "C:\\w\\a", RUN(1), ORGANIZE, "win32");
  state = withRunForm(state, "c:\\W\\A", RUN(2), TIDY, "win32");
  state = withRunForm(state, "C:\\w\\a", RUN(1), TIDY, "win32");
  const memory = memoryFor(state, "C:\\w\\a", "win32");
  assert.deepEqual(memory?.runs, [
    { runId: RUN(1), ...TIDY },
    { runId: RUN(2), ...TIDY },
  ]);
  assert.deepEqual(memory?.lastForm, TIDY);
  state = withoutPath(withOpened(state, "C:\\w\\b", new Date(), "win32"), "C:\\w\\a", "win32");
  assert.deepEqual(memoryFor(state, "C:\\w\\a", "win32")?.runs.length, 2, "forgetting a recent folder keeps its run forms");
  assert.equal(withRunForm(state, "C:\\w\\a", "latest", TIDY, "win32"), state, "a run id only");
  assert.equal(withRunForm(state, "C:\\w\\a", RUN(3), { profile: "bad\u0007", workflow: null }, "win32"), state, "no control characters");

  let many = EMPTY_STATE;
  for (let i = 0; i < MAX_REMEMBERED_RUNS + 10; i += 1) many = withRunForm(many, "/w", RUN(i), ORGANIZE, "linux");
  assert.equal(memoryFor(many, "/w", "linux")?.runs.length, MAX_REMEMBERED_RUNS);
  for (let i = 0; i < MAX_REMEMBERED_WORKSPACES + 3; i += 1) many = withRunForm(many, `/w${i}`, RUN(i), ORGANIZE, "linux");
  assert.equal(many.workspaceMemory.length, MAX_REMEMBERED_WORKSPACES);
});

test("run forms: the state file keeps them; entries that do not fit are dropped, the rest kept", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gui-forms-"));
  try {
    const file = path.join(dir, "gui-state.json");
    const state = withRunForm(withOpened(EMPTY_STATE, dir, new Date(), process.platform), dir, RUN(7), ORGANIZE, process.platform);
    await writeGuiState(file, state);
    assert.deepEqual(await readGuiState(file, process.platform), state);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  const parsed = parseGuiState(
    JSON.stringify({
      schemaVersion: 1,
      recentWorkspaces: [],
      workspaceMemory: [
        { path: "D:\\w\\a", lastForm: { profile: "tidy", workflow: null }, runs: [{ runId: RUN(1), profile: null, workflow: "organize" }, { runId: "latest", profile: null, workflow: null }, { runId: RUN(2), profile: 3, workflow: null }] },
        { path: "relative", lastForm: null, runs: [] },
        { path: "\\\\server\\share\\w", lastForm: null, runs: [] },
      ],
    }),
    "win32",
  );
  assert.deepEqual(parsed.workspaceMemory, [{ path: "D:\\w\\a", lastForm: { profile: "tidy", workflow: null }, runs: [{ runId: RUN(1), profile: null, workflow: "organize" }] }]);
  assert.deepEqual(parseGuiState(JSON.stringify({ schemaVersion: 1, recentWorkspaces: [] }), "win32").workspaceMemory, [], "an older file has none");
});

test("run forms: a workspace remembers its runs' forms across a restart and opens with its last form", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gui-forms-"));
  try {
    const ws = path.join(dir, "ws");
    await fs.mkdir(ws);
    const stateFile = path.join(dir, "state", "gui-state.json");
    let n = 0;
    const deps = { stateFile, platform: process.platform, randomBytes: (size: number) => Uint8Array.from({ length: size }, () => ++n % 256), now: () => new Date(), isDirectory: async () => true };
    const first = new Workspaces(deps);
    const opened = await first.open(ws);
    assert.ok(opened.ok);
    if (!opened.ok) return;
    assert.equal(opened.lastForm, null);
    await first.rememberRun(opened.handle, RUN(5), ORGANIZE);
    assert.deepEqual([...(await first.runForms(opened.handle))], [[RUN(5), ORGANIZE]]);
    await first.rememberRun("0".repeat(32), RUN(6), TIDY);

    const later = new Workspaces(deps);
    const again = await later.open(ws);
    assert.ok(again.ok);
    if (!again.ok) return;
    assert.deepEqual(again.lastForm, ORGANIZE, "the last form after a restart");
    assert.deepEqual([...(await later.runForms(again.handle))], [[RUN(5), ORGANIZE]], "an unknown handle remembered nothing");
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

const PLAN_VIEW = { runId: RUN(1), status: "pending", digest: "d".repeat(64), actions: [{ kind: "move", from: "a.txt", to: "x/a.txt" }], inventoryLimitReached: false, appliedBy: null };

async function planShown(formKnown: boolean | undefined): Promise<FakeElement> {
  const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "plan" ? { ok: true, view: PLAN_VIEW, approval: "a".repeat(32) } : null) });
  const screen = planScreen({ texts: textsFor("en"), api, run: new RunModel(), current: () => ({ handle: "1".repeat(32), name: "ws" }), showRun: () => undefined });
  screen.choose(RUN(1), null, null, formKnown);
  const root = new FakeElement("main");
  screen.show(root as unknown as HTMLElement);
  await settle();
  return root;
}

test("run forms (R21b-L-1): a plan whose form is unknown is shown with a notice and no apply button", async () => {
  const restore = installFakeDom();
  try {
    const byId = (root: FakeElement, id: string) => root.findAll((e) => e.getAttribute("id") === id)[0];
    const known = await planShown(undefined);
    assert.ok(byId(known, "plan-apply") !== undefined, "a known form (the default) can be applied");
    assert.equal(byId(known, "plan-form-unknown"), undefined);
    const unknown = await planShown(false);
    assert.equal(byId(unknown, "plan-apply"), undefined, "no apply button");
    assert.ok(byId(unknown, "plan-form-unknown")?.textContent.includes(`codaryn apply ${RUN(1)}`));
    assert.ok(byId(unknown, "plan-actions") !== undefined, "the plan is still shown");
  } finally {
    restore();
  }
});

test("run forms (R21b-L-1): the run list opens a plan with the run's remembered form, or as unknown", async () => {
  const restore = installFakeDom();
  try {
    const row = (n: number, form: unknown) => ({ state: "checked", runId: RUN(n), kind: "run", startedAt: null, taskId: "t", status: "needs-input", reason: "plan_pending", changes: 0, reverted: null, revertRecordDamaged: false, form });
    const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "listRuns" ? { ok: true, runs: [row(1, ORGANIZE), row(2, null)], omitted: 0 } : null) });
    const opened: unknown[][] = [];
    const reports: unknown[][] = [];
    const screen = runsScreen({
      texts: textsFor("en"),
      api,
      current: () => ({ handle: "1".repeat(32), name: "ws" }),
      open: () => undefined,
      announce: () => undefined,
      openPlan: (...args: unknown[]) => opened.push(args),
      openChanges: () => undefined,
      openReport: (...args: unknown[]) => reports.push(args),
    });
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    for (const n of [1, 2]) root.findAll((e) => e.getAttribute("data-plan") === RUN(n))[0]?.click();
    assert.deepEqual(opened, [
      [RUN(1), null, "organize", true],
      [RUN(2), null, null, false],
    ]);
    root.findAll((e) => e.getAttribute("data-report") === RUN(1))[0]?.click();
    assert.deepEqual(reports, [[RUN(1), ORGANIZE]], "the report keeps the run's own form for its changes view");
  } finally {
    restore();
  }
});
