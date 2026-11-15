/**
 * U-247 (found by the smoke's openCheck, which failed once of three runs): showing the new task screen
 * while another process holds the workspace's lock checks the workspace again (U-123). While that check
 * ran, the lock counted as free, so a screen drawn meanwhile turned its run button on. The check now
 * keeps "held" for the same workspace until its new answer says otherwise; another workspace starts free.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodarynApi } from "../../src/renderer/api.js";
import { OpenCheck, heldFor } from "../../src/renderer/workspace/open-check.js";
import type { OpenCheckState } from "../../src/renderer/workspace/open-check.js";
import { toDoctorView } from "../../src/shared/ipc.js";

const HANDLE = "1".repeat(32);
const OTHER = "2".repeat(32);

/** The doctor's output as U-68's test makes it: the lock check's message id says whether it is held. */
function doctorOutput(lockText: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: "doctor",
    status: "warn",
    exitCode: 3,
    checks: [{ id: "lock", status: lockText === "doctor.lock.none" ? "ok" : "warn", message: "lock", text: { id: lockText, params: {} } }],
  };
}

test("U-247: checking the same workspace again keeps a held lock held until the new answer, and only for that workspace", async () => {
  const answers: { resolve: (value: unknown) => void }[] = [];
  const api = { doctor: () => new Promise((resolve) => answers.push({ resolve })) } as unknown as CodarynApi;
  const check = new OpenCheck(api);
  // Read through a function: each run changes the state the test looks at.
  const now = (): OpenCheckState => check.state;
  const held = (): boolean | undefined => {
    const state = now();
    return state.phase === "done" || state.phase === "checking" ? state.lockHeld : undefined;
  };
  const answer = (index: number, lockText: string): void => {
    answers[index]?.resolve({ ok: true, view: toDoctorView(doctorOutput(lockText)), labels: {}, workspaceName: "ws" });
  };
  const first = check.run({ handle: HANDLE, name: "ws" });
  assert.deepEqual([now().phase, held()], ["checking", undefined], "a first check knows nothing yet");
  answer(0, "doctor.lock.held");
  await first;
  assert.deepEqual([now().phase, held()], ["done", true]);
  const again = check.run({ handle: HANDLE, name: "ws" });
  assert.deepEqual([now().phase, held()], ["checking", true], "still held while it checks again");
  answer(1, "doctor.lock.none");
  await again;
  assert.deepEqual([now().phase, held()], ["done", false], "free once the answer says so");
  const third = check.run({ handle: HANDLE, name: "ws" });
  assert.deepEqual([now().phase, held()], ["checking", undefined], "a free lock is not carried");
  answer(2, "doctor.lock.held");
  await third;
  const other = check.run({ handle: OTHER, name: "other" });
  assert.deepEqual([now().phase, held()], ["checking", undefined], "another workspace starts without it");
  answer(3, "doctor.lock.none");
  await other;
});

/**
 * Codex V-27 L-1: a check again that ends in a failure (the host timed out or ended, a host error) said
 * nothing about the lock, yet the carried "held" was dropped and the run button came on; and a doctor
 * call that rejected left the check "checking" for good. A failure now keeps "held" (only a free answer
 * frees it), is shown as the check's error, and the next check recovers.
 */
test("U-247 (V-27 L-1): a check again that fails or rejects keeps a held lock held until a free answer", async () => {
  for (const failure of ["adapter_timeout", "adapter_host_exited", "host_error", "rejected"] as const) {
    const answers: { resolve: (value: unknown) => void; reject: (error: unknown) => void }[] = [];
    const api = { doctor: () => new Promise((resolve, reject) => answers.push({ resolve, reject })) } as unknown as CodarynApi;
    const check = new OpenCheck(api);
    const now = (): OpenCheckState => check.state;
    const first = check.run({ handle: HANDLE, name: "ws" });
    answers[0]?.resolve({ ok: true, view: toDoctorView(doctorOutput("doctor.lock.held")), labels: {}, workspaceName: "ws" });
    await first;
    const again = check.run({ handle: HANDLE, name: "ws" });
    if (failure === "rejected") answers[1]?.reject(new Error("the channel broke"));
    else answers[1]?.resolve({ ok: false, code: failure });
    await again;
    const failed = now();
    assert.equal(failed.phase, "error", `${failure}: shown as the check's error`);
    assert.equal(failed.phase === "error" ? failed.code : null, failure === "rejected" ? "host_error" : failure);
    assert.equal(heldFor(failed, HANDLE), true, `${failure}: still held, the run button stays off`);
    assert.equal(heldFor(failed, OTHER), false, "for that workspace only");
    // A second failure keeps it too; a free answer frees it.
    const third = check.run({ handle: HANDLE, name: "ws" });
    answers[2]?.resolve({ ok: false, code: "host_error" });
    await third;
    assert.equal(heldFor(now(), HANDLE), true, `${failure}: held through a second failure`);
    const fourth = check.run({ handle: HANDLE, name: "ws" });
    answers[3]?.resolve({ ok: true, view: toDoctorView(doctorOutput("doctor.lock.none")), labels: {}, workspaceName: "ws" });
    await fourth;
    assert.deepEqual([now().phase, heldFor(now(), HANDLE)], ["done", false], `${failure}: recovered by the next check`);
  }
});

test("U-247 (V-27 L-1): a failure without a held lock before it holds nothing; a rejection never leaves it checking", async () => {
  const api = { doctor: () => Promise.reject(new Error("no host")) } as unknown as CodarynApi;
  const check = new OpenCheck(api);
  await check.run({ handle: HANDLE, name: "ws" });
  const state: OpenCheckState = check.state;
  assert.deepEqual([state.phase, state.phase === "error" ? state.code : null, heldFor(state, HANDLE)], ["error", "host_error", false]);
  assert.equal(heldFor({ phase: "none" }, HANDLE), false);
  assert.equal(heldFor({ phase: "checking", handle: HANDLE }, HANDLE), false);
});
