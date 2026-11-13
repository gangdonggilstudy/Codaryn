/**
 * U-119 (docs/design/standalone-gui.md 3.9, DR-21; adapter-contract 5.14): the check before an
 * apply. The page sends the plan view's approval token only; the main process checks the plan it
 * showed (that token's run and digest) and passes indexes, codes and counts on. The plan screen
 * marks the rows, counts the moves that need the DR-21 consent, says what the check could not take
 * back, and that the check is no approval; the apply button waits for the check's answer.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createHostHandler } from "../../src/engine-host/host.js";
import { planCheckValue } from "../../src/engine-host/plan-check.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { planCheckParts, planScreen } from "../../src/renderer/plan/plan-screen.js";
import { RunModel } from "../../src/renderer/run/run-model.js";
import { IPC_CHANNELS, parseCheckPlanArgs, toPlanCheckReply } from "../../src/shared/ipc.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import { fakeApp } from "./fake-app.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const RUN_ID = "20261113T130000Z-0000a119";
const DIGEST = "ab".repeat(32);
const HANDLE = "0123456789abcdef0123456789abcdef";
const check = (extra: Record<string, unknown> = {}) => ({
  ok: true,
  output: { kind: "plan_check", planRunId: RUN_ID, digest: DIGEST, checkedAt: "2026-11-13T13:00:00.000Z", problems: [], unsafeMoves: [], inventoryLimitReached: false, probesLeft: 0, probesRemoved: 0, lockLeft: false, ...extra },
});

test("U-119: the engine host passes indexes, codes and counts only; anything else is host_error", () => {
  assert.deepEqual(planCheckValue(check({ problems: [{ index: 1, problem: "source_changed" }], unsafeMoves: [0], probesLeft: 2, probesRemoved: 1, lockLeft: true })), {
    ok: true,
    planRunId: RUN_ID,
    digest: DIGEST,
    problems: [{ index: 1, problem: "source_changed" }],
    unsafeMoves: [0],
    inventoryLimitReached: false,
    probesLeft: 2,
    probesRemoved: 1,
    lockLeft: true,
  });
  assert.deepEqual(planCheckValue({ ok: false, error: { code: "plan_not_approved", message: "x" } }), { ok: false, code: "plan_not_approved" });
  for (const bad of [null, check({ problems: [{ index: -1, problem: "x" }] }), check({ problems: [{ index: 0, problem: "C:\\path" }] }), check({ unsafeMoves: ["0"] }), check({ lockLeft: "no" }), check({ digest: "x" })]) {
    assert.deepEqual(planCheckValue(bad), { ok: false, code: "host_error" }, JSON.stringify(bad).slice(0, 100));
  }
});

test("U-119: the host checks its call; the main process takes the token only and the answer for its plan only", async () => {
  const asked: unknown[] = [];
  const written: unknown[] = [];
  const handler = createHostHandler({
    app: fakeApp({ checkApply: async (request) => (asked.push(request), check()) }),
    itemsIn: () => () => null,
    token: () => "0".repeat(32),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (text) => text,
    providers: [],
    write: (line) => written.push(parseHostMessage(line.trimEnd())),
    log: () => undefined,
  });
  const abs = process.platform === "win32" ? "C:\\ws" : "/ws";
  await handler.handleLine(JSON.stringify({ v: 1, id: 1, call: "checkPlan", args: { workspace: abs, profile: "tidy", workflowRef: null, planRunId: RUN_ID, digest: DIGEST } }));
  await handler.handleLine(JSON.stringify({ v: 1, id: 2, call: "checkPlan", args: { workspace: abs, profile: null, workflowRef: null, planRunId: RUN_ID, digest: DIGEST.slice(0, 12) } }));
  assert.deepEqual(asked, [{ settings: { input: { kind: "workspace", workspace: abs }, configPath: null, varsFile: null, profile: "tidy", workflowRef: null }, planRunId: RUN_ID, digest: DIGEST }]);
  assert.equal((written[1] as { error?: { code: string } }).error?.code, "invalid_args", "the full digest of the plan shown only");
  const value = (written[0] as { value: unknown }).value;
  assert.ok(toPlanCheckReply(value, RUN_ID, DIGEST, 3).ok);
  assert.deepEqual(toPlanCheckReply(value, RUN_ID, "cd".repeat(32), 3), { ok: false, code: "host_error" }, "another plan's answer");
  assert.deepEqual(toPlanCheckReply({ ...(value as object), unsafeMoves: [3] }, RUN_ID, DIGEST, 3), { ok: false, code: "host_error" }, "an index past the plan");
  assert.equal(IPC_CHANNELS.checkPlan, "codaryn:plan:check");
  assert.equal(parseCheckPlanArgs({ approval: "1".repeat(32) }), "1".repeat(32));
  for (const bad of [{ approval: "1".repeat(32), digest: DIGEST }, { runId: RUN_ID }, { approval: "x" }, "1".repeat(32)]) assert.equal(parseCheckPlanArgs(bad), null, JSON.stringify(bad));
});

test("U-119: the check's words mark the plan's rows and say what was left behind and that it is no approval", () => {
  const restore = installFakeDom();
  try {
    const t = textsFor("en");
    const rows = [new FakeElement("li"), new FakeElement("li"), new FakeElement("li")];
    const parts = planCheckParts(t, { ok: true, problems: [{ index: 1, problem: "destination_exists" }], unsafeMoves: [2], inventoryLimitReached: false, probesLeft: 1, probesRemoved: 2, lockLeft: true }, rows as unknown as HTMLElement[]) as unknown as FakeElement[];
    assert.equal(rows[1]?.getAttribute("data-problem"), "destination_exists");
    assert.match(rows[1]?.textContent ?? "", /something is already at the destination/);
    assert.equal(rows[2]?.getAttribute("data-unsafe"), "true");
    assert.equal(rows[0]?.hasAttribute("data-problem"), false);
    const ids = parts.map((part) => part.getAttribute("id"));
    assert.deepEqual(ids.filter((id) => id !== null), ["plan-check-problems", "plan-check-unsafe", "plan-check-probes-removed", "plan-check-probes-left", "plan-check-lock-left"]);
    assert.equal(parts.find((p) => p.getAttribute("id") === "plan-check-lock-left")?.getAttribute("role"), "alert");
    assert.match(parts.at(-1)?.textContent ?? "", /not an approval/);
    const clean = planCheckParts(t, { ok: true, problems: [], unsafeMoves: [], inventoryLimitReached: false, probesLeft: 0, probesRemoved: 0, lockLeft: false }, []) as unknown as FakeElement[];
    assert.equal(clean[0]?.getAttribute("id"), "plan-check-clean");
    const failed = planCheckParts(t, { ok: false, code: "workspace_locked" }, []) as unknown as FakeElement[];
    assert.equal(failed[0]?.getAttribute("data-error"), "workspace_locked");
    for (const language of ["ko", "en"] as const) {
      const texts = textsFor(language);
      for (const problem of ["source_missing", "source_changed", "source_not_file", "destination_exists", "destination_parent_not_dir", "denied", "cross_device", "unsafe_move", "io_error"]) assert.ok(texts.has(`plancheck.problem.${problem}`), `${language} ${problem}`);
    }
  } finally {
    restore();
  }
});

test("U-119: the plan screen checks with the view's token and the apply button waits for the answer", async () => {
  const restore = installFakeDom();
  try {
    let answer: (value: unknown) => void = () => undefined;
    const tokens: string[] = [];
    const api = {
      async plan() {
        return { ok: true, view: { runId: RUN_ID, status: "pending", digest: DIGEST, actions: [{ kind: "move", from: "a", to: "b" }, { kind: "discard", path: "c" }], inventoryLimitReached: false, appliedBy: null }, approval: "2".repeat(32) };
      },
      checkPlan: (token: string) => (tokens.push(token), new Promise((resolve) => (answer = resolve))),
    } as unknown as CodarynApi;
    const screen = planScreen({ texts: textsFor("en"), api, run: new RunModel(), current: () => ({ handle: HANDLE, name: "ws" }), showRun: () => undefined });
    const root = new FakeElement("main");
    screen.choose(RUN_ID, null, null);
    screen.show(root as unknown as HTMLElement);
    await settle();
    const byId = (id: string): FakeElement | undefined => root.findAll((e) => e.getAttribute("id") === id)[0];
    assert.deepEqual(tokens, ["2".repeat(32)]);
    assert.equal(byId("plan-apply")?.hasAttribute("disabled"), true, "the apply waits for the check");
    assert.equal(byId("plan-check")?.getAttribute("data-check"), "checking");
    answer({ ok: true, problems: [], unsafeMoves: [0], inventoryLimitReached: false, probesLeft: 0, probesRemoved: 0, lockLeft: false });
    await settle();
    assert.equal(byId("plan-check")?.getAttribute("data-check"), "unsafe");
    assert.equal(byId("plan-apply")?.hasAttribute("disabled"), false);
    assert.equal(root.findAll((e) => e.getAttribute("data-index") === "0")[0]?.getAttribute("data-unsafe"), "true");
  } finally {
    restore();
  }
});
