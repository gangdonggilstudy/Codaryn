/**
 * U-294 (ne-verify's R-113 L-1): U-271 (332aeaff) left a locking call refused for the lock out of a check's
 * own work, but it knew that refusal only as `{ ok: false, code: "workspace_locked" }`. A text save is
 * refused in another shape, SaveTextReply's `{ ok: true, saved: false, status: "workspace_locked" }`, so
 * a save of workspace A refused because another process held A's lock still made that lock look like the
 * window's own. Now that shape is a refusal for the lock too; a save refused for another reason, or saved,
 * still counts (it may have held the lock).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodarynApi } from "../../src/renderer/api.js";
import { OpenCheck, heldFor } from "../../src/renderer/workspace/open-check.js";
import { OwnLockCalls } from "../../src/renderer/workspace/own-lock.js";
import { toDoctorView } from "../../src/shared/ipc.js";
import type { SaveTextReply } from "../../src/shared/ipc.js";

const A = "a".repeat(32);

function held(): unknown {
  const output = { schemaVersion: 1, kind: "doctor", status: "warn", exitCode: 3, checks: [{ id: "lock", status: "warn", message: "lock", text: { id: "doctor.lock.held", params: {} } }] };
  return { ok: true, view: toDoctorView(output), labels: {}, workspaceName: "ws" };
}

/** A's held lock after a text save of A that answers `reply` during A's check: another's (true) or the window's own. */
async function heldAfterSave(reply: SaveTextReply): Promise<boolean> {
  const doctors: ((value: unknown) => void)[] = [];
  const base = { doctor: () => new Promise((resolve) => doctors.push(resolve)), saveText: async () => reply } as unknown as CodarynApi;
  const calls = new OwnLockCalls(() => A);
  const api = calls.track(base);
  const check = new OpenCheck(api, { busy: () => false, mark: () => calls.mark(), overlapped: (handle, since) => calls.overlapped(handle, since) });
  const checking = check.run({ handle: A, name: "a" });
  await api.saveText("t", "x");
  doctors.shift()?.(held());
  await checking;
  return heldFor(check.state, A);
}

const refused = (status: "workspace_locked" | "conflict" | "write_failed"): SaveTextReply => ({ ok: true, saved: false, status, readOnlyReasons: [], textProblems: [], lockLeft: false });

test("U-294 (R-113 L-1): a text save refused for the lock, in SaveTextReply's own shape, is not the window's lock", async () => {
  assert.equal(await heldAfterSave(refused("workspace_locked")), true);
});

test("U-294 (R-113 L-1): a save refused for another reason, or saved, still counts as the window's own work", async () => {
  assert.equal(await heldAfterSave(refused("conflict")), false);
  assert.equal(await heldAfterSave(refused("write_failed")), false);
  assert.equal(await heldAfterSave({ ok: true, saved: true, unchanged: false, lockLeft: false, editToken: null }), false);
});
