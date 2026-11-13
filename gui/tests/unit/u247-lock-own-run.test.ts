/**
 * U-247 (ne-verify's R-111b M-1): after this window's own run in the workspace, the new task screen kept
 * its run button off and said another process held the lock until a check again answered (seconds on a
 * busy machine; until F5 when that check failed), with no lock file there: a check made while the run
 * went on had seen the run's own lock, and 9e63369 and ad0086d carried it. Now:
 * (a) a held lock seen while this window's own run goes on in the workspace is the window's own: it is
 *     not counted, and it is never carried into a check again;
 * (b) while a lock seen held by another process is checked again, the screen says it is being checked
 *     (the run button stays off), not that another process holds it;
 * (c) when that check fails, the lock still counts as held, and the screen offers to check again.
 * M-1 under load once more: a revert of this window (a locking call, not a run) that went on while a check
 * went on made its held answer count as another process's. Now any locking call of the window that
 * started, went on or ended during the check makes a held answer its own (OwnLockCalls), on the home
 * card too.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { RunModel } from "../../src/renderer/run/run-model.js";
import { newTaskScreen } from "../../src/renderer/run/new-task.js";
import { OpenCheck, heldFor, openCheckCard } from "../../src/renderer/workspace/open-check.js";
import { LOCKING_CALLS, OwnLockCalls } from "../../src/renderer/workspace/own-lock.js";
import type { OpenCheckState } from "../../src/renderer/workspace/open-check.js";
import { toDoctorView } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const HANDLE = "1".repeat(32);

function doctorOutput(lockText: string): Record<string, unknown> {
  return { schemaVersion: 1, kind: "doctor", status: "warn", exitCode: 3, checks: [{ id: "lock", status: lockText === "doctor.lock.none" ? "ok" : "warn", message: "lock", text: { id: lockText, params: {} } }] };
}

function harness(ownRun: () => boolean) {
  const answers: { resolve: (value: unknown) => void }[] = [];
  const api = { doctor: () => new Promise((resolve) => answers.push({ resolve })) } as unknown as CodarynApi;
  const check = new OpenCheck(api, { busy: () => ownRun(), started: () => 0 });
  const answer = (index: number, lockText: string): void => answers[index]?.resolve({ ok: true, view: toDoctorView(doctorOutput(lockText)), labels: {}, workspaceName: "ws" });
  const fail = (index: number): void => answers[index]?.resolve({ ok: false, code: "adapter_timeout" });
  return { check, answer, fail, now: (): OpenCheckState => check.state };
}

test("U-247 (R-111b a): a held lock seen while this window's own run goes on is its own: not counted, never carried", async () => {
  let running = true;
  const { check, answer, now } = harness(() => running);
  const during = check.run({ handle: HANDLE, name: "ws" });
  answer(0, "doctor.lock.held");
  await during;
  assert.equal(heldFor(now(), HANDLE), false, "the window's own run's lock");
  running = false;
  const after = check.run({ handle: HANDLE, name: "ws" });
  assert.deepEqual([now().phase, heldFor(now(), HANDLE)], ["checking", false], "nothing carried into the check after the run");
  answer(1, "doctor.lock.none");
  await after;
  assert.equal(heldFor(now(), HANDLE), false);
  // Another process's lock, seen with no own run: counted and carried as before.
  const other = check.run({ handle: HANDLE, name: "ws" });
  answer(2, "doctor.lock.held");
  await other;
  assert.equal(heldFor(now(), HANDLE), true);
  const again = check.run({ handle: HANDLE, name: "ws" });
  assert.deepEqual([now().phase, heldFor(now(), HANDLE)], ["checking", true]);
  answer(3, "doctor.lock.none");
  await again;
});

function screenWith(state: { locked: boolean; checking: boolean; failed: boolean }, rechecks: number[]): FakeElement {
  const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "settings" ? { ok: true, view: { file: null, model: null, language: null, profiles: [], workflows: { builtin: [], config: [] }, keyAvailable: true, providers: [], env: { model: false, language: false }, rules: { limits: [], commands: [], protectedPaths: [], secretEnv: [] } } } : null) });
  const screen = newTaskScreen({
    texts: textsFor("ko"),
    api,
    run: new RunModel(),
    current: () => ({ handle: HANDLE, name: "ws" }),
    open: () => undefined,
    showRun: () => undefined,
    lock: { locked: () => state.locked, checking: () => state.checking, failed: () => state.failed, recheck: () => void rechecks.push(1), watch: () => undefined },
  });
  const root = new FakeElement("main");
  screen.show(root as unknown as HTMLElement);
  return root;
}

test("U-247 (R-111b b, c): a lock being checked again is said to be checked; a failed check offers to check again", async () => {
  const restore = installFakeDom();
  try {
    const byId = (root: FakeElement, id: string): FakeElement | undefined => root.findAll((e) => e.getAttribute("id") === id)[0];
    const rechecks: number[] = [];
    const checking = screenWith({ locked: true, checking: true, failed: false }, rechecks);
    await settle();
    assert.equal(byId(checking, "task-run")?.hasAttribute("disabled"), true, "still off while it is checked");
    assert.equal(byId(checking, "task-locked")?.textContent, KO["task.lockChecking"]);
    assert.equal(byId(checking, "task-lock-recheck"), undefined);
    const failed = screenWith({ locked: true, checking: false, failed: true }, rechecks);
    await settle();
    assert.equal(byId(failed, "task-run")?.hasAttribute("disabled"), true);
    assert.ok(byId(failed, "task-locked")?.textContent.startsWith(KO["task.lockCheckFailed"]));
    byId(failed, "task-lock-recheck")?.click();
    assert.equal(rechecks.length, 1, "the person can check again");
    const held = screenWith({ locked: true, checking: false, failed: false }, rechecks);
    await settle();
    assert.ok(byId(held, "task-locked")?.textContent.startsWith(KO["task.locked"]), "an answer that says held: another process");
    const free = screenWith({ locked: false, checking: false, failed: false }, rechecks);
    await settle();
    assert.equal(byId(free, "task-run")?.hasAttribute("disabled"), false);
    assert.ok(EN["task.lockChecking"] && EN["task.lockCheckFailed"] && EN["task.lockRecheck"]);
  } finally {
    restore();
  }
});

test("U-247 (R-111b c): a failed check after another process's lock keeps it held, and checking again recovers", async () => {
  const { check, answer, fail, now } = harness(() => false);
  const first = check.run({ handle: HANDLE, name: "ws" });
  answer(0, "doctor.lock.held");
  await first;
  const again = check.run({ handle: HANDLE, name: "ws" });
  fail(1);
  await again;
  assert.deepEqual([now().phase, heldFor(now(), HANDLE)], ["error", true]);
  const recheck = check.run({ handle: HANDLE, name: "ws" });
  answer(2, "doctor.lock.none");
  await recheck;
  assert.deepEqual([now().phase, heldFor(now(), HANDLE)], ["done", false]);
});

test("U-247 (R-111b M-1): a locking call of this window during the check makes a held answer its own, on the home card too", async () => {
  const answers: { resolve: (value: unknown) => void }[] = [];
  let finishRevert: (value: unknown) => void = () => undefined;
  const base = {
    doctor: () => new Promise((resolve) => answers.push({ resolve })),
    revert: () => new Promise((resolve) => (finishRevert = resolve)),
    saveText: () => Promise.reject(new Error("refused")),
    info: async () => "info",
  } as unknown as CodarynApi;
  const calls = new OwnLockCalls();
  const api = calls.track(base);
  const check = new OpenCheck(api, { busy: () => calls.inFlight > 0, started: () => calls.started });
  const held = (index: number): void => answers[index]?.resolve({ ok: true, view: toDoctorView(doctorOutput("doctor.lock.held")), labels: {}, workspaceName: "ws" });
  // A revert that starts and ends while the check goes on: the doctor may have seen its lock.
  const during = check.run({ handle: HANDLE, name: "ws" });
  const reverting = api.revert("p");
  assert.equal(calls.inFlight, 1, "counted while it goes on");
  finishRevert({ ok: true });
  await reverting;
  assert.equal(calls.inFlight, 0);
  held(0);
  await during;
  assert.equal(heldFor(check.state, HANDLE), false, "the window's own revert's lock");
  const restore = installFakeDom();
  try {
    const card = openCheckCard(textsFor("ko"), check.state, false, () => undefined) as unknown as FakeElement;
    assert.equal(card.getAttribute("data-locked"), "false");
    assert.equal(card.findAll((e) => e.getAttribute("data-lock") === "held").length, 0, "no line says another run holds it");
  } finally {
    restore();
  }
  // A revert going on when the check starts, ended before its answer: its own too.
  const second = api.revert("p");
  const before = check.run({ handle: HANDLE, name: "ws" });
  finishRevert({ ok: true });
  await second;
  held(1);
  await before;
  assert.equal(heldFor(check.state, HANDLE), false);
  // No own work during the check: a held answer is another process's, as before.
  const other = check.run({ handle: HANDLE, name: "ws" });
  held(2);
  await other;
  assert.equal(heldFor(check.state, HANDLE), true);
  // A call that rejects is counted only while it goes on; every other call is the api's own.
  await assert.rejects(api.saveText("t", "x"));
  assert.deepEqual([calls.inFlight, calls.started], [0, 3]);
  assert.equal(await api.info(), "info");
  assert.equal(base.revert === api.revert, false, "the tracked object, not the page's");
  assert.deepEqual([...LOCKING_CALLS].sort(), ["applyCleanup", "applyPlan", "checkPlan", "revert", "revertConsent", "review", "saveText", "startRun", "startTaskRun"]);
});
