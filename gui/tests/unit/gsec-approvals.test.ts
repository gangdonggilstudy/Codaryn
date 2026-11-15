/**
 * G-sec (U-274; standalone-gui 3.9, 6.6, DR-21): the window cannot put an approval's values in.
 * What the person approves is what the main process showed: a plan view gets a token, and the apply
 * and the check send the engine host the run, the digest and the form kept with that token, never
 * values from the window. The same holds for every other approval the window holds only by token: a
 * settings proposal, a cleanup preview, a revert preview, the unsafe-move consent of a revert, and a
 * text edit. The main process's real handlers run with an `electron` stand-in (gsec-ipc-harness.ts);
 * the plan view is the engine host's own planValue of an app plan output. Written by a session that
 * did not implement the GUI.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { planValue } from "../../src/engine-host/plans.js";
import type { HostResponse } from "../../src/shared/protocol.js";
import { IPC_CHANNELS, createIpc } from "./gsec-ipc-harness.js";
import type { Ipc } from "./gsec-ipc-harness.js";

const PLAN_RUN = "20261112T010203Z-0000abcd";
const APPLY_RUN = "20261112T020304Z-0000beef";
const DIGEST = "d".repeat(64);
const RUN_TOKEN = "ab".repeat(16);
const NEVER_ISSUED = "0123456789abcdef0123456789abcdef";

/** An app plan output of one move: pending unless `more` says otherwise. */
const planOutput = (more: Record<string, unknown> = {}) => ({ kind: "plan", runId: PLAN_RUN, status: "pending", exitCode: 0, digest: DIGEST, actions: [{ kind: "move", from: "a.txt", to: "x/a.txt", sha256: "a".repeat(64) }], inventoryLimitReached: false, appliedBy: null, ...more });

/** The engine host's plan value of that output, as the host answers `plan`. */
function planAnswer(more: Record<string, unknown> = {}): HostResponse {
  return { v: 1, id: 0, ok: true, value: planValue({ ok: true, output: planOutput(more) }, (text) => text) };
}

/** A workspace, its plan view shown to the window, and the token the view came with. */
async function shownPlan(ipc: Ipc, more: Record<string, unknown> = {}): Promise<{ readonly root: string; readonly handle: string; readonly approval: string | null }> {
  const { root, handle } = await ipc.openWorkspace();
  ipc.answer = (call) => (call === "plan" ? planAnswer(more) : { v: 1, id: 0, ok: false, error: { code: "gsec", message: "gsec" } });
  const reply = (await ipc.call(IPC_CHANNELS.plan, [{ workspace: handle, runId: PLAN_RUN, profile: "doc", workflow: "organize" }])) as { ok: boolean; approval?: string | null };
  assert.equal(reply.ok, true, JSON.stringify(reply));
  ipc.hostCalls.length = 0;
  return { root, handle, approval: reply.approval ?? null };
}

const code = (reply: unknown): unknown => (reply as { code?: unknown } | null)?.code;

describe("G-sec: plan approvals are the main process's", () => {
  test("an apply or a check with a token the main process never issued: unknown_plan, no question, no host call", async () => {
    const ipc = await createIpc();
    ipc.confirm = true;
    assert.equal(code(await ipc.call(IPC_CHANNELS.applyPlan, [{ approval: NEVER_ISSUED, askConsent: false }])), "unknown_plan");
    assert.equal(code(await ipc.call(IPC_CHANNELS.checkPlan, [{ approval: NEVER_ISSUED }])), "unknown_plan");
    assert.deepEqual([ipc.hostCalls, ipc.effects], [[], []]);
  });

  test("an apply or a check that brings the plan's values (run, digest, workspace) instead of a token: invalid_args, nothing done", async () => {
    const ipc = await createIpc();
    ipc.confirm = true;
    const { handle, approval } = await shownPlan(ipc);
    for (const args of [
      { approval, askConsent: false, digest: "e".repeat(64) },
      { approval, askConsent: false, planRunId: APPLY_RUN },
      { approval, askConsent: false, workspace: handle },
      { workspace: handle, runId: PLAN_RUN, digest: DIGEST, askConsent: false },
    ]) {
      assert.equal(code(await ipc.call(IPC_CHANNELS.applyPlan, [args])), "invalid_args", JSON.stringify(args));
    }
    for (const args of [{ approval, digest: "e".repeat(64) }, { workspace: handle, runId: PLAN_RUN, digest: DIGEST }]) {
      assert.equal(code(await ipc.call(IPC_CHANNELS.checkPlan, [args])), "invalid_args", JSON.stringify(args));
    }
    assert.deepEqual([ipc.hostCalls, ipc.effects], [[], []]);
  });

  test("the token's apply asks the person first and sends the host the plan shown: its run, full digest and form", async () => {
    const ipc = await createIpc();
    const { root, approval } = await shownPlan(ipc);
    assert.match(String(approval), /^[0-9a-f]{32}$/);
    // The person says no: nothing reaches the host.
    assert.equal(code(await ipc.call(IPC_CHANNELS.applyPlan, [{ approval, askConsent: false }])), "not_confirmed");
    assert.deepEqual([ipc.effects, ipc.hostCalls], [["confirmApply"], []]);
    // The person says yes: the host gets the plan the main process kept with the token.
    ipc.confirm = true;
    ipc.answer = (call) => (call === "applyPlan" ? { v: 1, id: 0, ok: true, value: { ok: true, run: RUN_TOKEN, runId: APPLY_RUN } } : { v: 1, id: 0, ok: false, error: { code: "gsec", message: "gsec" } });
    const started = (await ipc.call(IPC_CHANNELS.applyPlan, [{ approval, askConsent: false }])) as { ok: boolean; runId?: string };
    assert.deepEqual(started, { ok: true, runId: APPLY_RUN });
    assert.equal(ipc.hostCalls.length, 1);
    assert.deepEqual(ipc.hostCalls[0], {
      call: "applyPlan",
      args: { workspace: root, profile: "doc", workflowRef: "organize", planRunId: PLAN_RUN, digest: DIGEST, consent: false, language: "en" },
    });
    // While that apply runs, the token starts nothing more.
    assert.equal(code(await ipc.call(IPC_CHANNELS.applyPlan, [{ approval, askConsent: false }])), "run_active");
    assert.equal(ipc.hostCalls.length, 1);
  });

  test("the token's check sends the host the plan shown, and an answer about another plan is refused", async () => {
    const ipc = await createIpc();
    const { root, approval } = await shownPlan(ipc);
    ipc.answer = (call) => (call === "checkPlan" ? { v: 1, id: 0, ok: true, value: { ok: true, planRunId: APPLY_RUN, digest: DIGEST, problems: [], unsafeMoves: [], inventoryLimitReached: false, probesLeft: 0, probesRemoved: 0, lockLeft: false } } : { v: 1, id: 0, ok: false, error: { code: "gsec", message: "gsec" } });
    const checked = await ipc.call(IPC_CHANNELS.checkPlan, [{ approval }]);
    assert.deepEqual(ipc.hostCalls, [{ call: "checkPlan", args: { workspace: root, profile: "doc", workflowRef: "organize", planRunId: PLAN_RUN, digest: DIGEST } }]);
    assert.equal(code(checked), "host_error", "a check of another run is not passed on as this plan's");
  });

  test("the unsafe-move consent is asked only after this token's apply stopped as consent_required: consent_not_asked, no dialog, no host call", async () => {
    const ipc = await createIpc();
    ipc.confirm = true;
    const { approval } = await shownPlan(ipc);
    assert.equal(code(await ipc.call(IPC_CHANNELS.applyPlan, [{ approval, askConsent: true }])), "consent_not_asked");
    assert.deepEqual([ipc.effects, ipc.hostCalls], [[], []]);
  });

  for (const [what, more] of [
    ["already applied", { status: "applied", appliedBy: { runId: APPLY_RUN, at: "2026-11-12T02:03:04.000Z" } }],
    ["its run's records changed (DR-38)", { recordsChanged: true }],
  ] as const) {
    test(`a plan view the person cannot approve (${what}) comes with no token`, async () => {
      const ipc = await createIpc();
      const { approval } = await shownPlan(ipc, more);
      assert.equal(approval, null);
    });
  }

  // Finding (U-274, for p5u-gui): engine-host/plans.ts reads every status but "applied" as "pending",
  // so an output whose status the contract does not have (PLAN_STATUSES: pending, applied) is shown
  // as an approvable plan and gets a token. Today the app gives only those two (low); fail closed.
  test("a plan output whose status the contract does not have is refused by the host, not shown as pending", () => {
    for (const status of ["stale", "gsec-unknown", 1, null]) {
      assert.deepEqual(planValue({ ok: true, output: planOutput({ status }) }, (text) => text), { ok: false, code: "host_error" }, String(status));
    }
  });
});

describe("G-sec: the other approvals the window holds only by token", () => {
  const cases: readonly { readonly what: string; readonly channel: string; readonly unknown: Record<string, unknown>; readonly withValues: Record<string, unknown> }[] = [
    { what: "a settings proposal", channel: IPC_CHANNELS.applySettings, unknown: { token: NEVER_ISSUED }, withValues: { token: NEVER_ISSUED, next: { schemaVersion: 1 } } },
    { what: "a cleanup preview", channel: IPC_CHANNELS.applyCleanup, unknown: { token: NEVER_ISSUED }, withValues: { token: NEVER_ISSUED, digest: DIGEST } },
    { what: "a revert preview", channel: IPC_CHANNELS.revert, unknown: { preview: NEVER_ISSUED }, withValues: { preview: NEVER_ISSUED, runId: PLAN_RUN } },
    { what: "a revert's unsafe-move consent", channel: IPC_CHANNELS.revertConsent, unknown: { retry: NEVER_ISSUED }, withValues: { retry: NEVER_ISSUED, consent: true } },
    { what: "a text edit", channel: IPC_CHANNELS.saveText, unknown: { token: NEVER_ISSUED, text: "x" }, withValues: { token: NEVER_ISSUED, text: "x", path: "a.txt" } },
  ];
  for (const { what, channel, unknown, withValues } of cases) {
    test(`${what}: a token never issued is refused, values beside it are invalid_args; no question, no host call`, async () => {
      const ipc = await createIpc();
      ipc.confirm = true;
      const refusedUnknown = await ipc.call(channel, [unknown]);
      assert.ok(refusedUnknown === null || (refusedUnknown as { ok?: unknown }).ok === false, JSON.stringify(refusedUnknown));
      assert.notEqual(code(refusedUnknown), undefined, JSON.stringify(refusedUnknown));
      assert.equal(code(await ipc.call(channel, [withValues])), "invalid_args");
      assert.deepEqual([ipc.effects, ipc.hostCalls], [[], []]);
    });
  }

  test("a revert preview of a run the window was not shown in a list: unknown_run, no host call", async () => {
    const ipc = await createIpc();
    const { handle } = await ipc.openWorkspace();
    assert.equal(code(await ipc.call(IPC_CHANNELS.previewRevert, [{ workspace: handle, runId: PLAN_RUN }])), "unknown_run");
    assert.deepEqual([ipc.effects, ipc.hostCalls], [[], []]);
  });
});
