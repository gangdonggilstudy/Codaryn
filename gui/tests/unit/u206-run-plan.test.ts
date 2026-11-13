/**
 * U-206 (U-196, DR-69 B-3): a run plan in the plan screen. The app layer gives ChangesPlanOutput
 * (`planKind: "changes"`): the files a later run will make or change, its summary (approved with
 * the files: it is in plan.json and the digest), the digest and the status. The engine host and the
 * main process pass it on field by field; the screen lists the files, shows the summary under the
 * label of the plan being approved (the model's description, not the goal), marks the files the
 * check finds denied. U-226 (U-218): the apply button comes on once the check answered, as for a
 * plan of moves; carrying the plan out is the app's run (u226-run-plan-apply.test.ts).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { planCheckValue } from "../../src/engine-host/plan-check.js";
import { planValue } from "../../src/engine-host/plans.js";
import { PlanApprovals } from "../../src/main/plans.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { planScreen } from "../../src/renderer/plan/plan-screen.js";
import { RunModel } from "../../src/renderer/run/run-model.js";
import { toPlanCheckReply, toPlanView } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const RUN_ID = "20261113T120000Z-0000b206";
const DIGEST = "ab".repeat(32);
const HANDLE = "0123456789abcdef0123456789abcdef";
const shown = (text: string): string => text.replace("[[SECRET]]", "[key]");
const rows = (text: string): string[] => text.split("\n");

const changesOutput = (extra: Record<string, unknown> = {}) => ({
  ok: true,
  output: {
    schemaVersion: 1,
    kind: "plan",
    planKind: "changes",
    runId: RUN_ID,
    status: "pending",
    exitCode: 0,
    digest: DIGEST,
    files: [
      { path: "docs/new.md", change: "create", sha256: null },
      { path: "src/[[SECRET]].ts", change: "modify", sha256: "cd".repeat(32) },
    ],
    summary: "Add the guide\nand fix the module",
    appliedBy: null,
    ...extra,
  },
});

test("U-206: the engine host passes a run plan's files (paths through shown), kind and summary; a file that does not fit is host_error", () => {
  const value = planValue(changesOutput(), shown, rows) as Record<string, unknown>;
  assert.equal(value["planKind"], "changes");
  assert.deepEqual(value["files"], [
    { path: "docs/new.md", change: "create" },
    { path: "src/[key].ts", change: "modify" },
  ]);
  assert.deepEqual(value["actions"], []);
  assert.equal(value["inventoryLimitReached"], false);
  assert.deepEqual(value["summary"], ["Add the guide", "and fix the module"]);
  assert.equal(JSON.stringify(value).includes("cdcd"), false, "the file hashes stay out");
  for (const files of [[{ path: "a", change: "delete" }], [{ change: "create" }], "x"]) {
    assert.deepEqual(planValue(changesOutput({ files }), shown, rows), { ok: false, code: "host_error" }, JSON.stringify(files));
  }
  const marked = planValue(changesOutput({ recordsChanged: true }), shown, rows) as Record<string, unknown>;
  assert.equal(marked["recordsChanged"], true);
  assert.equal("summary" in marked, false, "a marked plan run's summary is not passed on");
});

test("U-206: the main process takes a run plan view field by field; mixed or unknown kinds are host_error", () => {
  const value = planValue(changesOutput(), shown, rows) as Record<string, unknown>;
  const checked = toPlanView(value);
  assert.ok(checked.ok);
  if (!checked.ok) return;
  assert.equal(checked.view.planKind, "changes");
  assert.deepEqual(checked.view.files, [
    { path: "docs/new.md", change: "create" },
    { path: "src/[key].ts", change: "modify" },
  ]);
  for (const bad of [
    { ...value, planKind: "other" },
    { ...value, actions: [{ kind: "discard", from: "a", to: null }] },
    { ...value, files: [{ path: "a", change: "remove" }] },
    { ...value, files: [{ path: "a‮", change: "create" }] },
    { ...value, planKind: undefined },
  ]) {
    assert.deepEqual(toPlanView(bad), { ok: false, code: "host_error" }, JSON.stringify(bad).slice(0, 80));
  }
});

test("U-206: a run plan's check names its kind; its indexes are the plan's files; a kind that does not match is host_error", () => {
  const check = (extra: Record<string, unknown> = {}) => ({
    ok: true,
    output: { kind: "plan_check", planKind: "changes", planRunId: RUN_ID, digest: DIGEST, checkedAt: "2026-11-13T12:00:00.000Z", problems: [{ index: 1, problem: "denied" }], unsafeMoves: [], inventoryLimitReached: false, probesLeft: 0, probesRemoved: 0, lockLeft: false, ...extra },
  });
  const value = planCheckValue(check());
  assert.equal(value["planKind"], "changes");
  assert.deepEqual(planCheckValue(check({ unsafeMoves: [0] })), { ok: false, code: "host_error" }, "no DR-21 consent in a run plan");
  const reply = toPlanCheckReply(value, RUN_ID, DIGEST, 2, "changes");
  assert.ok(reply.ok && reply.planKind === "changes" && reply.problems[0]?.problem === "denied");
  assert.deepEqual(toPlanCheckReply(value, RUN_ID, DIGEST, 1, "changes"), { ok: false, code: "host_error" }, "an index past the files");
  assert.deepEqual(toPlanCheckReply(value, RUN_ID, DIGEST, 2), { ok: false, code: "host_error" }, "a run plan's check for an apply plan's view");
  const applyCheck = planCheckValue(check({ planKind: undefined }));
  assert.deepEqual(toPlanCheckReply(applyCheck, RUN_ID, DIGEST, 2, "changes"), { ok: false, code: "host_error" }, "an apply plan's check for a run plan's view");
});

test("U-206: a run plan's approval keeps its kind and file count (its apply dialog names their number)", () => {
  const approvals = new PlanApprovals((size) => new Uint8Array(size).fill(7), () => 0);
  const token = approvals.issue({ workspace: HANDLE, profile: null, workflowRef: null, planRunId: RUN_ID, digest: DIGEST, moves: 0, discards: 0, planKind: "changes", files: 2 });
  assert.deepEqual({ planKind: approvals.get(token)?.planKind, files: approvals.get(token)?.files }, { planKind: "changes", files: 2 });
});

test("U-206: the plan screen lists the files, shows the summary as the approved plan's description, marks denied files, then offers apply", async () => {
  const restore = installFakeDom();
  try {
    const view = toPlanView(planValue(changesOutput(), shown, rows));
    assert.ok(view.ok);
    const calls: string[] = [];
    const api = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => async () => {
        calls.push(name);
        if (name === "plan") return { ok: true, view: view.ok ? view.view : null, approval: "a".repeat(32) };
        if (name === "checkPlan") return { ok: true, planKind: "changes", problems: [{ index: 1, problem: "denied" }], unsafeMoves: [], inventoryLimitReached: false, probesLeft: 0, probesRemoved: 0, lockLeft: false };
        return null;
      },
    });
    for (const language of ["ko", "en"] as const) {
      const texts = language === "ko" ? KO : EN;
      const screen = planScreen({ texts: textsFor(language), api, run: new RunModel(), current: () => ({ handle: HANDLE, name: "ws" }), showRun: () => undefined });
      screen.choose(RUN_ID, null, null);
      const root = new FakeElement("main");
      screen.show(root as unknown as HTMLElement);
      await settle();
      const byId = (id: string): FakeElement | undefined => root.findAll((e) => e.getAttribute("id") === id)[0];
      const items = byId("plan-files")?.children ?? [];
      assert.deepEqual(items.map((li) => li.getAttribute("data-change")), ["create", "modify"]);
      assert.equal(items[0]?.textContent, `${texts["plan.fileCreate"]}: docs/new.md`);
      assert.equal(byId("plan-actions"), undefined, "no move table");
      assert.equal(byId("plan-summary")?.getAttribute("data-plan-kind"), "changes");
      assert.ok(byId("plan-agent-words")?.textContent.startsWith(texts["plan.runSummaryLabel"]), "the approved plan's description, not the goal");
      assert.equal(byId("plan-agent-words")?.getAttribute("data-approved"), "true");
      // U-226: on once the check answered (it holds the lock a moment), as for a plan of moves.
      assert.equal(byId("plan-apply")?.hasAttribute("disabled"), false, "apply on after the check");
      assert.equal(byId("plan-run-apply-unavailable"), undefined, "no longer said to be unavailable");
      assert.equal(byId("plan-check")?.getAttribute("data-check"), "problems");
      assert.equal(items[1]?.getAttribute("data-problem"), "denied");
      assert.ok(items[1]?.textContent.includes(texts["plancheck.runProblem.denied"]));
      assert.ok(byId("plan-check-problems")?.textContent.startsWith(texts["plancheck.deniedFiles"].split("{count}")[0] ?? "-"));
    }
    assert.equal(calls.includes("applyPlan"), false, "nothing is applied until the button is pressed");
  } finally {
    restore();
  }
});
