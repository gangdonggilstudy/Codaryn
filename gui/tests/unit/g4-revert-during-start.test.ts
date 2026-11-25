/** G-4: real IPC handlers, with explicit gates at the host and OS confirmation boundaries. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { asRevert } from "../../src/renderer/api.js";
import { errorText, textsFor } from "../../src/renderer/i18n/catalog.js";
import type { HostCall } from "../../src/shared/protocol.js";
import { IPC_CHANNELS, createIpc } from "./gsec-ipc-harness.js";
import type { Ipc } from "./gsec-ipc-harness.js";

const OLD = "20261125T080000Z-00000001", RUN = "20261126T080000Z-00000002", TOKEN = "1".repeat(32);
const starts = ["startRun", "startTaskRun", "applyPlan"] as const;
const reverts = ["revert", "revertConsent"] as const;
type Start = (typeof starts)[number];
type Revert = (typeof reverts)[number];
const gate = () => ({ entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() });

async function fixture(sameWorkspace: boolean) {
  const ipc = await createIpc(), a = await ipc.openWorkspace(), b = sameWorkspace ? a : await ipc.openWorkspace();
  ipc.confirm = true;
  Object.assign(ipc.deps, { chooseOpenFile: async () => { ipc.effects.push("chooseOpenFile"); return "g4-synthetic-task.json"; } });
  ipc.answer = call => ({ v: 1, id: 0, ok: true, value: call === "revert"
    ? { ok: true, runId: OLD, status: "complete", dryRun: false, reverted: [{ path: "a.txt", action: "restored", from: null, unsafe: false }], skipped: [], moveSafetyUnchecked: false, revertedBefore: null }
    : { ok: true, run: TOKEN, runId: RUN } });
  return { ipc, startWorkspace: a.handle, revertWorkspace: b.handle };
}

function start(ipc: Ipc, kind: Start, workspace: string): Promise<unknown> {
  if (kind === "startRun") return ipc.call(IPC_CHANNELS.startRun, [{ workspace, goal: "G-4 synthetic work", profile: null, workflow: null }]);
  if (kind === "startTaskRun") return ipc.call(IPC_CHANNELS.startTaskRun, [{ workspace, withVars: false }]);
  const approval = ipc.deps.approvals.issue({ workspace, profile: null, workflowRef: null, planRunId: OLD, digest: "d".repeat(64), moves: 1, discards: 0 });
  return ipc.call(IPC_CHANNELS.applyPlan, [{ approval, askConsent: false }]);
}

function revert(ipc: Ipc, kind: Revert, workspace: string): { invoke: () => Promise<unknown>; consumed: () => unknown } {
  if (kind === "revert") {
    const preview = ipc.deps.history.issuePreview({ workspace, runId: OLD, reverted: 1, skipped: 0 });
    return { invoke: () => ipc.call(IPC_CHANNELS.revert, [{ preview }]), consumed: () => ipc.deps.history.takePreview(preview) };
  }
  const retry = ipc.deps.history.issueConsentRetry({ workspace, runId: OLD, files: 1 });
  return { invoke: () => ipc.call(IPC_CHANNELS.revertConsent, [{ retry }]), consumed: () => ipc.deps.history.takeConsentRetry(retry) };
}

/** Hold the first host acquisition, or one host call's response, without delaying unrelated calls. */
async function holdHost(ipc: Ipc, call: HostCall | null, waiting: ReturnType<typeof gate>): Promise<void> {
  const available = await ipc.deps.host();
  assert.ok("host" in available);
  if (call === null) {
    let first = true;
    Object.assign(ipc.deps, { host: async () => {
      if (first) { first = false; waiting.entered.resolve(); await waiting.release.promise; }
      return available;
    } });
    return;
  }
  let held = false;
  Object.assign(ipc.deps, { host: async () => ({ ...available, host: { ...available.host,
    call: async (name: HostCall, args: unknown, timeout: number) => {
      const response = await available.host.call(name, args, timeout);
      if (name === call && !held) { held = true; waiting.entered.resolve(); await waiting.release.promise; }
      return response;
    },
  } }) });
}

for (const kind of starts) for (const undo of reverts) for (const same of [true, false]) for (const phase of ["host acquisition", "start response"] as const) {
  test(`G-4a: ${kind} pending ${phase} refuses ${undo} (${same ? "same" : "different"} GUI workspace)`, { timeout: 5000 }, async t => {
    const { ipc, startWorkspace, revertWorkspace } = await fixture(same), waiting = gate();
    await holdHost(ipc, phase === "host acquisition" ? null : kind, waiting);
    const pending = start(ipc, kind, startWorkspace);
    try {
      await waiting.entered.promise;
      assert.equal(ipc.deps.runs.running, false, "the host response has not reached runs.begin");
      const request = revert(ipc, undo, revertWorkspace), reply = await request.invoke();
      const questions = ipc.effects.filter(effect => effect === "confirmRevert" || effect === "confirmRevertConsent");
      const hostReverts = ipc.hostCalls.filter(row => row.call === "revert");
      t.diagnostic(JSON.stringify({ direction: "a", kind, undo, same, phase, reply, questions, hostReverts: hostReverts.length }));
      assert.deepEqual(reply, { ok: false, code: "run_active" });
      assert.deepEqual(questions, [], "a refused revert must not ask for confirmation");
      assert.equal(hostReverts.length, 0, "a refused revert must not reach the host");
      assert.equal(request.consumed(), null, "the preview/retry remains consumed before the active check");
    } finally {
      waiting.release.resolve();
      assert.deepEqual(await pending, { ok: true, runId: RUN });
    }
  });
}

for (const kind of starts) for (const undo of reverts) for (const same of [true, false]) for (const phase of ["confirmation", "revert response"] as const) {
  test(`G-4b: ${undo} pending ${phase} versus ${kind} (${same ? "same" : "different"} GUI workspace)`, { timeout: 5000 }, async t => {
    const { ipc, startWorkspace, revertWorkspace } = await fixture(same), waiting = gate();
    if (phase === "confirmation") {
      Object.assign(ipc.deps, { [undo === "revert" ? "confirmRevert" : "confirmRevertConsent"]: async () => {
        waiting.entered.resolve(); await waiting.release.promise; return true;
      } });
    } else await holdHost(ipc, "revert", waiting);
    const pending = revert(ipc, undo, revertWorkspace).invoke();
    try {
      await waiting.entered.promise;
      assert.equal(ipc.deps.runs.running, false, "a revert is not a RunManager run");
      const effects = ipc.effects.length;
      const reply = await start(ipc, kind, startWorkspace);
      const hostStarts = ipc.hostCalls.filter(row => starts.includes(row.call as Start));
      t.diagnostic(JSON.stringify({ direction: "b", kind, undo, same, phase, reply, hostStarts: hostStarts.length, running: ipc.deps.runs.running }));
      assert.deepEqual(reply, { ok: false, code: "revert_active" });
      assert.equal(hostStarts.length, 0, "a reserved revert refuses the start before any host start call");
      assert.equal(ipc.effects.length, effects, "the refused start does not open a file or approval dialog");
      assert.equal(ipc.deps.runs.running, false, "the refused start does not begin a run");
    } finally {
      waiting.release.resolve();
      const finished = await pending as { ok: boolean };
      assert.equal(finished.ok, true, "the already confirmed revert completes too");
    }
    assert.deepEqual(await start(ipc, kind, startWorkspace), { ok: true, runId: RUN }, "the completed revert releases its reservation");
  });
}

for (const first of reverts) for (const second of reverts) for (const same of [true, false]) for (const phase of ["confirmation", "revert response"] as const) {
  test(`G-4b reverts: ${first} pending ${phase} refuses ${second} (${same ? "same" : "different"} GUI workspace)`, { timeout: 5000 }, async t => {
    const { ipc, startWorkspace, revertWorkspace } = await fixture(same), waiting = gate();
    if (phase === "confirmation") {
      let held = false;
      const name = first === "revert" ? "confirmRevert" : "confirmRevertConsent";
      Object.assign(ipc.deps, { [name]: async () => {
        ipc.effects.push(name);
        if (!held) { held = true; waiting.entered.resolve(); await waiting.release.promise; }
        return true;
      } });
    } else await holdHost(ipc, "revert", waiting);
    const pending = revert(ipc, first, startWorkspace).invoke();
    try {
      await waiting.entered.promise;
      const questions = ipc.effects.length, calls = ipc.hostCalls.length;
      const request = revert(ipc, second, revertWorkspace), reply = await request.invoke();
      t.diagnostic(JSON.stringify({ direction: "reverts", first, second, same, phase, reply, extraQuestions: ipc.effects.length - questions, extraCalls: ipc.hostCalls.length - calls }));
      assert.deepEqual(reply, { ok: false, code: "revert_active" });
      assert.equal(ipc.effects.length, questions, "no second confirmation");
      assert.equal(ipc.hostCalls.length, calls, "no second host revert");
      assert.equal(request.consumed(), null, "a refused preview/retry is still consumed");
      assert.deepEqual(await start(ipc, "startRun", revertWorkspace), { ok: false, code: "revert_active" }, "refusing the second revert must not release the first one's reservation");
    } finally {
      waiting.release.resolve();
      assert.equal((await pending as { ok: boolean }).ok, true);
    }
    assert.deepEqual(await start(ipc, "startRun", revertWorkspace), { ok: true, runId: RUN });
  });
}

const endings = ["success", "declined", "confirmation throws", "host unavailable", "host acquisition throws", "host failure", "host call throws", "malformed reply", "wrong run"] as const;
for (const undo of reverts) for (const ending of endings) {
  test(`G-4b release: ${undo} after ${ending} admits another revert and a start`, { timeout: 5000 }, async () => {
    const { ipc, startWorkspace } = await fixture(true);
    const confirmation = undo === "revert" ? "confirmRevert" : "confirmRevertConsent";
    const answer = ipc.answer, host = ipc.deps.host, confirm = ipc.deps[confirmation];
    if (ending === "declined") ipc.confirm = false;
    if (ending === "confirmation throws") Object.assign(ipc.deps, { [confirmation]: async () => { throw new Error("g4 synthetic confirmation failure"); } });
    if (ending === "host unavailable") Object.assign(ipc.deps, { host: async () => ({ failure: "host_not_started" }) });
    if (ending === "host acquisition throws") Object.assign(ipc.deps, { host: async () => { throw new Error("g4 synthetic host acquisition failure"); } });
    if (ending === "host failure") ipc.answer = () => ({ v: 1, id: 0, ok: false, error: { code: "g4_failure", message: "synthetic" } });
    if (ending === "host call throws") ipc.answer = () => { throw new Error("g4 synthetic host call failure"); };
    if (ending === "malformed reply") ipc.answer = () => ({ v: 1, id: 0, ok: true, value: { ok: true } });
    if (ending === "wrong run") ipc.answer = (name, args) => {
      const reply = answer(name, args);
      assert.ok(reply.ok);
      return { ...reply, value: { ...(reply.value as object), runId: RUN } };
    };
    try {
      const pending = revert(ipc, undo, startWorkspace).invoke();
      if (["confirmation throws", "host acquisition throws", "host call throws"].includes(ending)) await assert.rejects(pending, /g4 synthetic/);
      else {
        const expected = ending === "declined" ? "not_confirmed" : ending === "host unavailable" ? "host_not_started" : ending === "host failure" ? "g4_failure" : "host_error";
        const reply = await pending;
        if (ending === "success") assert.equal((reply as { ok: boolean }).ok, true);
        else assert.deepEqual(reply, { ok: false, code: expected });
      }
    } finally {
      ipc.confirm = true; ipc.answer = answer;
      Object.assign(ipc.deps, { host, [confirmation]: confirm });
    }
    const nextUndo = undo === "revert" ? "revertConsent" : "revert";
    assert.equal((await revert(ipc, nextUndo, startWorkspace).invoke() as { ok: boolean }).ok, true, "neither revert handler remains reserved");
    assert.deepEqual(await start(ipc, "startRun", startWorkspace), { ok: true, runId: RUN }, "the start is no longer blocked by the completed revert");
  });
}

test("G-4b words: the renderer preserves revert_active and shows both languages without changing run_active", () => {
  const reply = asRevert({ ok: false, code: "revert_active" });
  assert.deepEqual(reply, { ok: false, code: "revert_active" });
  assert.ok(!reply.ok);
  assert.equal(errorText(textsFor("en"), reply.code), "A revert is going on. Try again after it ends.");
  assert.equal(errorText(textsFor("ko"), reply.code), "되돌리기를 처리하고 있습니다. 끝난 뒤에 다시 하세요.");
  assert.equal(errorText(textsFor("en"), "run_active"), "A run is already going on. Start a new task after it ends.");
  assert.equal(errorText(textsFor("ko"), "run_active"), "이미 실행 중인 작업이 있습니다. 끝난 뒤에 새 작업을 시작하세요.");
});
