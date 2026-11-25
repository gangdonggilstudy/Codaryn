/** G-4: real IPC handlers, with explicit gates at the host and OS confirmation boundaries. */
import assert from "node:assert/strict";
import { test } from "node:test";
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
  Object.assign(ipc.deps, { chooseOpenFile: async () => "g4-synthetic-task.json" });
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
  Object.assign(ipc.deps, { host: async () => ({ ...available, host: { ...available.host,
    call: async (name: HostCall, args: unknown, timeout: number) => {
      const response = await available.host.call(name, args, timeout);
      if (name === call) { waiting.entered.resolve(); await waiting.release.promise; }
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
      const reply = await start(ipc, kind, startWorkspace);
      const hostStarts = ipc.hostCalls.filter(row => starts.includes(row.call as Start));
      t.diagnostic(JSON.stringify({ direction: "b", kind, undo, same, phase, reply, hostStarts: hostStarts.length, running: ipc.deps.runs.running }));
      // G-4b deliberately records current behavior; reserving a revert needs a separate PM decision.
      assert.deepEqual(reply, { ok: true, runId: RUN });
      assert.equal(hostStarts.length, 1, "the new run reaches the host during the revert");
      assert.equal(ipc.deps.runs.running, true, "both operations have been admitted");
    } finally {
      waiting.release.resolve();
      const finished = await pending as { ok: boolean };
      assert.equal(finished.ok, true, "the already confirmed revert completes too");
    }
  });
}
