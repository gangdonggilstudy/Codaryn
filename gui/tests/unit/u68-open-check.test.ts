/**
 * U-68 (docs/design/standalone-gui.md 3.2): the checks when a workspace opens. The window keeps the
 * doctor check's message id (never its parameters) to tell a lock another process holds
 * (`doctor.lock.held`); the workspace screen shows the workspace checks that are not ok, and the new
 * task's run button is off while the lock is another's.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { OpenCheck, lockHeld, openCheckCard, openProblems } from "../../src/renderer/workspace/open-check.js";
import { toDoctorView } from "../../src/shared/ipc.js";
import type { DoctorReply } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const HANDLE = "0123456789abcdef0123456789abcdef";

function doctorOutput(lockText: string, workspaceStatus = "warn"): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: "doctor",
    status: "warn",
    exitCode: 3,
    checks: [
      { id: "api_key", status: "fail", message: "no key", text: { id: "doctor.api_key.missing", params: {} } },
      { id: "workspace", status: workspaceStatus, message: "not a git repository", text: { id: "doctor.workspace.ok", params: {} } },
      { id: "lock", status: lockText === "doctor.lock.none" ? "ok" : "warn", message: "a process holds .codaryn/lock.json", text: { id: lockText, params: { path: "C:/secret/place" } } },
    ],
  };
}

const reply = (output: Record<string, unknown>): Extract<DoctorReply, { ok: true }> => {
  const view = toDoctorView(output);
  assert.ok(view !== null);
  return { ok: true, view, labels: { "doctor.check.workspace": "Workspace" }, workspaceName: "ws" };
};

test("U-68: the doctor view keeps a check's message id (never its parameters), and a held lock is told apart", () => {
  const view = toDoctorView(doctorOutput("doctor.lock.held"));
  assert.equal(view?.checks[2]?.textId, "doctor.lock.held");
  assert.equal(JSON.stringify(view).includes("C:/secret/place"), false, "parameters are not passed on");
  for (const bad of ["Doctor.lock.held", "doctor", "doctor.lock.held.x.y", "doctor.lock.<b>", 5]) {
    const output = doctorOutput("doctor.lock.none");
    (output["checks"] as Record<string, unknown>[])[2] = { id: "lock", status: "ok", message: "m", text: { id: bad } };
    assert.equal(toDoctorView(output)?.checks[2]?.textId, undefined, String(bad));
  }
  assert.equal(lockHeld(reply(doctorOutput("doctor.lock.held"))), true);
  for (const other of ["doctor.lock.none", "doctor.lock.stale", "doctor.lock.unreadable", "doctor.lock.reclaim_left"]) assert.equal(lockHeld(reply(doctorOutput(other))), false, other);
  assert.deepEqual(openProblems(reply(doctorOutput("doctor.lock.held"))).map((check) => check.id), ["workspace", "lock"], "the key check is not the workspace's");
  assert.deepEqual(openProblems(reply(doctorOutput("doctor.lock.none", "ok"))), []);
});

test("U-68: the card says what is wrong with the workspace, a held lock in its own words (not for this window's own run), or that nothing is", () => {
  const restore = installFakeDom();
  try {
    const t = textsFor("en");
    let shown = 0;
    const held = openCheckCard(t, { phase: "done", handle: HANDLE, reply: reply(doctorOutput("doctor.lock.held")), lockHeld: true }, false, () => (shown += 1)) as unknown as FakeElement;
    assert.equal(held.getAttribute("data-locked"), "true");
    const lockLine = held.findAll((e) => e.getAttribute("data-lock") === "held")[0];
    assert.equal(lockLine?.getAttribute("role"), "alert");
    assert.match(lockLine?.textContent ?? "", /Another run is using this workspace/);
    assert.ok(held.findAll((e) => e.getAttribute("data-check") === "workspace").length === 1);
    held.findAll((e) => e.getAttribute("id") === "open-check-all")[0]?.click();
    assert.equal(shown, 1);
    const own = openCheckCard(t, { phase: "done", handle: HANDLE, reply: reply(doctorOutput("doctor.lock.held")), lockHeld: true }, true, () => undefined) as unknown as FakeElement;
    assert.equal(own.getAttribute("data-locked"), "false", "this window's own run holds it");
    assert.equal(own.findAll((e) => e.getAttribute("data-check") === "lock").length, 0);
    const clean = openCheckCard(t, { phase: "done", handle: HANDLE, reply: reply(doctorOutput("doctor.lock.none", "ok")), lockHeld: false }, false, () => undefined) as unknown as FakeElement;
    assert.equal(clean.textContent.includes("No problem found"), true);
    const failed = openCheckCard(t, { phase: "error", handle: HANDLE, code: "adapter_host_exited" }, false, () => undefined) as unknown as FakeElement;
    assert.equal(failed.findAll((e) => e.getAttribute("data-error") === "adapter_host_exited").length, 1);
    assert.equal((openCheckCard(t, { phase: "none" }, false, () => undefined) as unknown as FakeElement).hasAttribute("hidden"), true);
    for (const language of ["ko", "en"] as const) {
      const texts = textsFor(language);
      for (const id of ["open.title", "open.checking", "open.failed", "open.clean", "open.locked", "open.all", "task.locked"]) assert.ok(texts.has(id), `${language} ${id}`);
    }
  } finally {
    restore();
  }
});

test("U-68: the check runs per workspace, drops an earlier answer, and tells its watchers", async () => {
  const answers: unknown[] = [];
  const api = {
    doctor: (handle: string) => new Promise((resolve) => answers.push({ handle, resolve })),
  } as unknown as CodarynApi;
  const check = new OpenCheck(api);
  const seen: string[] = [];
  check.watch("a", () => seen.push(check.state.phase));
  check.watch("a", () => seen.push(`again:${check.state.phase}`));
  const first = check.run({ handle: HANDLE, name: "ws" });
  const second = check.run({ handle: "f".repeat(32), name: "other" });
  const [one, two] = answers as { resolve: (value: unknown) => void }[];
  two?.resolve({ ok: true, view: toDoctorView(doctorOutput("doctor.lock.held")), labels: {}, workspaceName: "other" });
  one?.resolve({ ok: true, view: toDoctorView(doctorOutput("doctor.lock.none")), labels: {}, workspaceName: "ws" });
  await Promise.all([first, second]);
  await settle();
  assert.equal(check.state.phase, "done");
  assert.ok(check.state.phase === "done" && check.state.handle === "f".repeat(32) && check.state.lockHeld, "the later workspace's answer stays");
  assert.deepEqual(seen, ["again:checking", "again:checking", "again:done"], "one watcher per key");
  await check.run(null);
  assert.equal(check.state.phase, "none");
});
