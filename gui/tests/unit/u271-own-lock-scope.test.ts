/**
 * U-271 (ne-verify's R-111c L-1): the overlap rule of R-111b M-1 (9b24074) took any locking call of the
 * window that went on during a check for the window's own lock. So another process's real lock on
 * workspace A looked like the window's when, during A's check, the window saved a text in workspace B, or
 * a review of A was refused with workspace_locked, refused because of that very lock. Now only calls for
 * the workspace checked count, and a call that ended refused for the lock does not. A call for A still
 * going at the answer, or one that answered, still counts (it may be what the check saw).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodarynApi } from "../../src/renderer/api.js";
import { OpenCheck, heldFor } from "../../src/renderer/workspace/open-check.js";
import { OwnLockCalls } from "../../src/renderer/workspace/own-lock.js";
import { toDoctorView } from "../../src/shared/ipc.js";

const A = "a".repeat(32);
const B = "b".repeat(32);

function held(): unknown {
  const output = { schemaVersion: 1, kind: "doctor", status: "warn", exitCode: 3, checks: [{ id: "lock", status: "warn", message: "lock", text: { id: "doctor.lock.held", params: {} } }] };
  return { ok: true, view: toDoctorView(output), labels: {}, workspaceName: "ws" };
}

/** A window whose open workspace is `open()`, its locking calls answered by `answers`, and A's open check. */
function windowWith(open: () => string) {
  const doctors: ((value: unknown) => void)[] = [];
  const pending = new Map<string, (value: unknown) => void>();
  const later = (name: string) => () => new Promise((resolve) => pending.set(name, resolve));
  const base = {
    doctor: () => new Promise((resolve) => doctors.push(resolve)),
    saveText: later("saveText"),
    review: later("review"),
    startRun: later("startRun"),
    checkPlan: later("checkPlan"),
  } as unknown as CodarynApi;
  const calls = new OwnLockCalls(open);
  const api = calls.track(base);
  const check = new OpenCheck(api, { busy: () => false, mark: () => calls.mark(), overlapped: (handle, since) => calls.overlapped(handle, since) });
  const answer = (name: string, value: unknown): void => {
    pending.get(name)?.(value);
    pending.delete(name);
  };
  /** Checks A while `during` runs; the doctor says the lock is held. Whether A's lock counts as another's. */
  const heldAfter = async (during: () => Promise<void>): Promise<boolean> => {
    const checking = check.run({ handle: A, name: "a" });
    await during();
    doctors.shift()?.(held());
    await checking;
    return heldFor(check.state, A);
  };
  return { api, answer, heldAfter };
}

test("U-271 (R-111c L-1): a locking call in another workspace during A's check leaves A's held lock another's", async () => {
  let open = B;
  const w = windowWith(() => open);
  // A text saved in B (its token was made there): not A's lock.
  assert.equal(await w.heldAfter(async () => {
    const saving = w.api.saveText("t", "x");
    w.answer("saveText", { ok: true });
    await saving;
  }), true);
  // A review of B by its handle, while A is open: not A's lock either.
  open = A;
  assert.equal(await w.heldAfter(async () => {
    const reviewing = w.api.review(B, "r", null, null, "accept", null);
    w.answer("review", { ok: true });
    await reviewing;
  }), true);
  // The same review of A: it may be what the check saw.
  assert.equal(await w.heldAfter(async () => {
    const reviewing = w.api.review(A, "r", null, null, "accept", null);
    w.answer("review", { ok: true });
    await reviewing;
  }), false);
});

test("U-271 (R-111c L-1): a call refused for the lock does not count; one going on at the answer does", async () => {
  const w = windowWith(() => A);
  // Refused because the lock is held: the window did not hold it.
  assert.equal(await w.heldAfter(async () => {
    const reviewing = w.api.review(A, "r", null, null, "accept", null);
    w.answer("review", { ok: false, code: "workspace_locked" });
    await reviewing;
  }), true);
  assert.equal(await w.heldAfter(async () => {
    const starting = w.api.startRun(A, "g", null, null);
    w.answer("startRun", { ok: false, code: "workspace_locked" });
    await starting;
  }), true, "a start refused for the lock");
  // A plan check of A still going when the doctor answers: it may hold the lock now.
  let checking: Promise<unknown> = Promise.resolve();
  assert.equal(await w.heldAfter(async () => {
    checking = w.api.checkPlan("p");
  }), false);
  w.answer("checkPlan", { ok: true });
  await checking;
  // A call that ended before the check started is not in it.
  const before = w.api.saveText("t", "x");
  w.answer("saveText", { ok: true });
  await before;
  assert.equal(await w.heldAfter(async () => undefined), true);
  // Refused for another reason (it may have taken the lock before): still counted, as the PM's rule says.
  assert.equal(await w.heldAfter(async () => {
    const saving = w.api.saveText("t", "x");
    w.answer("saveText", { ok: false, code: "text_changed" });
    await saving;
  }), false);
});
