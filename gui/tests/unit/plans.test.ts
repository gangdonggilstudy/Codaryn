/**
 * GU-5: the plan view, its apply with the DR-21 consent, and a person's review. The engine host's
 * calls with a fake app (src/engine-host/plans.ts, runs.ts), the main process's checks
 * (src/shared/ipc.ts) and its plan approvals (src/main/plans.ts).
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { test } from "node:test";

import { createHostHandler } from "../../src/engine-host/host.js";
import type { HostApplyRequest } from "../../src/engine-host/runs.js";
import { APPROVAL_TTL_MS, PlanApprovals } from "../../src/main/plans.js";
import { parseApplyArgs, parsePlanArgs, parseReviewArgs, toPlanView, toReviewReply, toRunResultView } from "../../src/shared/ipc.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import type { HostMessage, HostRunMessage } from "../../src/shared/protocol.js";
import { fakeApp } from "./fake-app.js";

const WS = path.resolve("ws-for-plans");
const PLAN_RUN = "20261112T010203Z-0000abcd";
const APPLY_RUN = "20261112T020304Z-0000beef";
const DIGEST = "d".repeat(64);
const HANDLE = "1".repeat(32);
const TOKEN = "ab".repeat(16);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function host(app: Parameters<typeof fakeApp>[0]) {
  const written: HostMessage[] = [];
  const handler = createHostHandler({
    app: fakeApp(app),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (text) => `<${text}>`,
    providers: [],
    itemsIn: () => () => null,
    token: () => TOKEN,
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
  });
  const call = async (id: number, name: string, args: unknown): Promise<unknown> => {
    await handler.handleLine(JSON.stringify({ v: 1, id, call: name, args }));
    const message = written.find((m) => "id" in m && m.id === id) as { ok: boolean; value?: unknown; error?: { code: string } };
    return message.ok ? message.value : message.error?.code;
  };
  return { call, written };
}

const FORM = (profile: string | null, workflowRef: string | null = null) => ({ input: { kind: "workspace", workspace: WS }, configPath: null, varsFile: null, profile, workflowRef });

test("plans (GU-5): the plan view takes a plan run id and a profile, cleans paths, and passes errors as codes", async () => {
  const calls: unknown[] = [];
  const { call } = host({
    plan: async (request) => {
      calls.push(request);
      if (request.runId === APPLY_RUN) return { ok: false, error: { code: "plan_secrets_differ", message: "a/secret-value.txt" } };
      return {
        ok: true,
        output: {
          kind: "plan",
          runId: PLAN_RUN,
          status: "pending",
          exitCode: 0,
          digest: DIGEST,
          actions: [
            { kind: "move", from: "a.txt", to: "x/a.txt", sha256: "a".repeat(64) },
            { kind: "discard", path: "b.tmp", sha256: "b".repeat(64) },
          ],
          inventoryLimitReached: true,
          appliedBy: null,
        },
      };
    },
  });
  for (const [id, args] of [
    [1, { workspace: WS, profile: null, runId: "latest" }],
    [2, { workspace: WS, profile: null, runId: PLAN_RUN, digest: DIGEST }],
    [3, { workspace: "rel", profile: null, runId: PLAN_RUN }],
  ] as const) {
    assert.equal(await call(id, "plan", args), "invalid_args", `request ${id}`);
  }
  assert.equal(calls.length, 0);
  // R-14 L-3: the task kind the plan run was started with goes into the task form.
  const value = await call(4, "plan", { workspace: WS, profile: "doc", workflowRef: "organize", runId: PLAN_RUN });
  assert.deepEqual(calls, [{ settings: FORM("doc", "organize"), runId: PLAN_RUN }]);
  assert.deepEqual(toPlanView(value), {
    ok: true,
    view: {
      runId: PLAN_RUN,
      status: "pending",
      digest: DIGEST,
      actions: [
        { kind: "move", from: "<a.txt>", to: "<x/a.txt>" },
        { kind: "discard", from: "<b.tmp>", to: null },
      ],
      inventoryLimitReached: true,
      appliedBy: null,
    },
  });
  const refused = await call(5, "plan", { workspace: WS, profile: null, runId: APPLY_RUN });
  assert.deepEqual(refused, { ok: false, code: "plan_secrets_differ" });
  assert.equal(JSON.stringify(refused).includes("secret-value"), false, "an error's message does not go on");
});

test("plans (GU-5, DR-21): the app gets a consent only when the main process says so, and then for this plan's digest", async () => {
  const requests: HostApplyRequest[] = [];
  let finish: () => void = () => undefined;
  const { call, written } = host({
    applyPlan: async (request, observer) => {
      requests.push(request);
      observer.onEvent({ kind: "record", record: { seq: 1, at: "2026-11-12T01:02:03.000Z", runId: APPLY_RUN, type: "apply_started" } });
      observer.onEvent({ kind: "record", record: { seq: 2, at: "2026-11-12T01:02:03.000Z", runId: APPLY_RUN, type: "plan_checked", unsafeMoves: [0, 2] } });
      const done = new Promise((resolve) => {
        finish = () =>
          resolve({
            ok: true,
            output: {
              kind: "apply",
              runId: APPLY_RUN,
              planRunId: PLAN_RUN,
              taskId: "t",
              digest: DIGEST,
              status: "needs-input",
              reason: "consent_required",
              exitCode: 3,
              applied: [{ index: 1, action: { kind: "discard", path: "b.tmp", sha256: "b".repeat(64) }, stored: "1", unsafe: true }],
              verifiers: [],
              usage: { modelTurns: 0, toolCalls: 0, inputTokens: null, outputTokens: null, durationMs: 10 },
              journalPath: ".codaryn/runs/x/journal.jsonl",
              notices: [],
            },
          });
      });
      return { ok: true, handle: { runId: APPLY_RUN, cancel: () => undefined, done } };
    },
  });
  const good = { workspace: WS, profile: null, workflowRef: "organize", planRunId: PLAN_RUN, digest: DIGEST, consent: false, language: "ko" };
  for (const [id, args] of [
    [1, { ...good, digest: "d".repeat(12) }],
    [2, { ...good, consent: "yes" }],
    [3, { ...good, unsafeMoveConsent: { digest: DIGEST } }],
    [4, { ...good, planRunId: "latest" }],
  ] as const) {
    assert.equal(await call(id, "applyPlan", args), "invalid_args", `request ${id}`);
  }
  assert.equal(requests.length, 0);
  assert.deepEqual(await call(5, "applyPlan", good), { ok: true, run: TOKEN, runId: APPLY_RUN });
  assert.deepEqual(requests[0], { settings: FORM(null, "organize"), planRunId: PLAN_RUN, digest: DIGEST, cancelFile: null, unsafeMoveConsent: null });
  finish();
  await sleep(150);
  const done = written.find((m): m is HostRunMessage & { type: "done" } => "type" in m && m.type === "done");
  const view = toRunResultView(done?.outcome);
  assert.equal(view.ok, true);
  if (view.ok) {
    assert.equal(view.result.kind, "apply");
    assert.equal(view.result.reason, "consent_required");
    assert.equal(view.result.unsafeMoves, 2, "from the plan_checked record");
    assert.equal(view.result.planRunId, PLAN_RUN);
    assert.deepEqual(view.result.applied, [{ kind: "discard", from: "<b.tmp>", to: null, unsafe: true }]);
  }
  assert.equal(JSON.stringify(done?.outcome).includes("journal.jsonl"), false);
  await call(6, "applyPlan", { ...good, consent: true });
  assert.deepEqual(requests[1]?.["unsafeMoveConsent"], { digest: DIGEST }, "the consent names the plan's full digest");
});

test("plans (GU-5): a review takes a decision and a short note, with the run's task form", async () => {
  const calls: unknown[] = [];
  const { call } = host({
    review: async (request) => {
      calls.push(request);
      return { ok: true, output: { kind: "review", runId: PLAN_RUN, verdict: "accepted", exitCode: 0, checklist: ["c"], replaced: false } };
    },
  });
  for (const [id, args] of [
    [1, { workspace: WS, profile: null, runId: PLAN_RUN, decision: "maybe", note: null }],
    [2, { workspace: WS, profile: null, runId: PLAN_RUN, decision: "accept", note: "x".repeat(501) }],
    [3, { workspace: WS, profile: null, runId: "latest", decision: "accept", note: null }],
  ] as const) {
    assert.equal(await call(id, "review", args), "invalid_args", `request ${id}`);
  }
  const value = await call(4, "review", { workspace: WS, profile: "doc", runId: PLAN_RUN, decision: "accept", note: "looks right" });
  assert.deepEqual(calls, [{ settings: FORM("doc"), runId: PLAN_RUN, decision: "accept", note: "looks right" }]);
  assert.deepEqual(toReviewReply(value), { ok: true, verdict: "accepted", replaced: false });
});

test("plans (GU-5, 6.6): the window gives an approval token and a question flag, never a consent or a digest", () => {
  assert.deepEqual(parseApplyArgs({ approval: HANDLE, askConsent: false }), { approval: HANDLE, askConsent: false });
  assert.equal(parseApplyArgs({ approval: HANDLE, askConsent: true, consent: true }), null);
  assert.equal(parseApplyArgs({ approval: HANDLE, askConsent: false, digest: DIGEST }), null);
  assert.equal(parseApplyArgs({ approval: DIGEST, askConsent: false }), null, "a digest is no approval token");
  assert.equal(parseApplyArgs({ approval: HANDLE, askConsent: "yes" }), null);
  assert.deepEqual(parsePlanArgs({ workspace: HANDLE, runId: PLAN_RUN, profile: null }), { workspace: HANDLE, runId: PLAN_RUN, profile: null, workflow: null });
  assert.deepEqual(parsePlanArgs({ workspace: HANDLE, runId: PLAN_RUN, profile: "doc", workflow: "organize" }), { workspace: HANDLE, runId: PLAN_RUN, profile: "doc", workflow: "organize" });
  assert.equal(parsePlanArgs({ workspace: HANDLE, runId: PLAN_RUN, profile: null, workflow: "two\nlines" }), null);
  assert.equal(parsePlanArgs({ workspace: HANDLE, runId: "latest", profile: null }), null);
  assert.equal(parseReviewArgs({ workspace: HANDLE, runId: PLAN_RUN, profile: null, decision: "accept", note: "n".repeat(501) }), null);
  const view = { ok: true, runId: PLAN_RUN, status: "pending", digest: DIGEST, actions: [], inventoryLimitReached: false, appliedBy: null };
  assert.equal(toPlanView(view).ok, true);
  assert.equal(toPlanView({ ...view, digest: "d".repeat(12) }).ok, false);
  assert.equal(toPlanView({ ...view, actions: [{ kind: "delete", from: "a", to: null }] }).ok, false);
  assert.equal(toReviewReply({ ok: true, verdict: "maybe", replaced: false }).ok, false);
});

test("plans (GU-5, DR-21): an approval may ask for the consent only after its apply stopped as consent_required", () => {
  let now = 0;
  const approvals = new PlanApprovals((size) => randomBytes(size), () => now);
  const token = approvals.issue({ workspace: HANDLE, profile: null, workflowRef: null, planRunId: PLAN_RUN, digest: DIGEST, moves: 1, discards: 1 });
  assert.equal(approvals.get(token)?.digest, DIGEST);
  assert.equal(approvals.mayAskConsent(token), false, "not before an apply asked for it");
  approvals.applied(token, APPLY_RUN);
  assert.equal(approvals.mayAskConsent(token), false, "not while the apply goes on");
  approvals.ended("20261112T030405Z-0000cafe", "consent_required");
  assert.equal(approvals.mayAskConsent(token), false, "another run's end changes nothing");
  approvals.ended(APPLY_RUN, "consent_required");
  assert.equal(approvals.mayAskConsent(token), true);
  approvals.applied(token, "20261112T040506Z-0000f00d");
  assert.equal(approvals.mayAskConsent(token), false, "the consent holds for one apply");
  approvals.ended("20261112T040506Z-0000f00d", "verified");
  assert.equal(approvals.get(token), null, "an apply that ended otherwise forgets the approval");
  const old = approvals.issue({ workspace: HANDLE, profile: null, workflowRef: null, planRunId: PLAN_RUN, digest: DIGEST, moves: 0, discards: 0 });
  now += APPROVAL_TTL_MS + 1;
  assert.equal(approvals.get(old), null);
  const closed = approvals.issue({ workspace: HANDLE, profile: null, workflowRef: null, planRunId: PLAN_RUN, digest: DIGEST, moves: 0, discards: 0 });
  approvals.forget(HANDLE);
  assert.equal(approvals.get(closed), null);
});
