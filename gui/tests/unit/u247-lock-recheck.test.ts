/**
 * U-247 (found by the smoke's openCheck, which failed once of three runs): showing the new task screen
 * while another process holds the workspace's lock checks the workspace again (U-123). While that check
 * ran, the lock counted as free, so a screen drawn meanwhile turned its run button on. The check now
 * keeps "held" for the same workspace until its new answer says otherwise; another workspace starts free.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodarynApi } from "../../src/renderer/api.js";
import { OpenCheck } from "../../src/renderer/workspace/open-check.js";
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
