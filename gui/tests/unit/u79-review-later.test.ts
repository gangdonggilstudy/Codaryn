/**
 * U-79 (docs/design/standalone-gui.md 3.7, 3.8; design gap survey 1): a run that waits for a person's
 * review (needs-input / awaiting_review) can be reviewed later, not only on the run's own result
 * screen: its row in the run list opens the report on the review tab, and that tab has the checklist
 * and the same review panel (no default button, asked once more in the window, then the app layer's
 * review with the run's own form). Before U-79 the list had no way to it, so after the app started
 * again such a run could not be reviewed in the GUI.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { reportValue } from "../../src/engine-host/report.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { reportScreen } from "../../src/renderer/report/report-screen.js";
import { runsScreen } from "../../src/renderer/runs/runs-screen.js";
import { toReportReply } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const RUN = "20261113T050000Z-0000a079";
const HANDLE = "1".repeat(32);
const same = (text: string): string => text;
const byId = (root: FakeElement, id: string): FakeElement | undefined => root.findAll((e) => e.getAttribute("id") === id)[0];

test("U-79: a run waiting for its review has a review action in the run list, opening the report's review tab with the run's form", async () => {
  const restore = installFakeDom();
  try {
    const row = { state: "checked", runId: RUN, kind: "run", startedAt: null, taskId: "t", status: "needs-input", reason: "awaiting_review", changes: 1, reverted: null, revertRecordDamaged: false, form: { profile: "doc", workflow: "analyze" } };
    const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "listRuns" ? { ok: true, runs: [row], omitted: 0 } : null) });
    const opened: unknown[][] = [];
    const screen = runsScreen({ texts: textsFor("en"), api, current: () => ({ handle: HANDLE, name: "ws" }), open: () => undefined, announce: () => undefined, openPlan: () => undefined, openChanges: () => undefined, openReport: (...args: unknown[]) => void opened.push(args) });
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    const action = root.findAll((e) => e.getAttribute("data-review") === RUN)[0];
    assert.ok(action !== undefined, "a review action on the row");
    action.click();
    assert.deepEqual(opened, [[RUN, { profile: "doc", workflow: "analyze" }, "review"]]);
  } finally {
    restore();
  }
});

const report = (verdict: unknown) => ({
  ok: true,
  output: {
    schemaVersion: 1,
    kind: "report",
    runId: RUN,
    status: "complete",
    exitCode: 0,
    result: { runId: RUN, status: "needs-input", reason: "awaiting_review", review: { checklist: ["The numbers match the table.", "<b>nothing</b> left out"] } },
    verdict,
    journal: { taskId: "t", workflow: "analyze", provider: "anthropic", records: 3, modelRequests: 2, deniedToolCalls: 0, repairs: 0, lastRound: [], changes: [], integrityChecks: [], finished: { status: "needs-input", reason: "awaiting_review" } },
  },
});

async function reviewTab(verdict: unknown, form: { profile: string | null; workflow: string | null } | null, calls: unknown[][]): Promise<FakeElement> {
  const reply = toReportReply(reportValue(report(verdict), same, same));
  assert.ok(reply.ok, JSON.stringify(reply));
  const api = new Proxy({} as CodarynApi, {
    get: (_t, name: string) => async (...args: unknown[]) => {
      if (name === "report") return { ...reply, labels: null };
      if (name === "review") {
        calls.push(args);
        return { ok: true, verdict: args[4] === "accept" ? "accepted" : "rejected", replaced: false };
      }
      return null;
    },
  });
  const screen = reportScreen({ texts: textsFor("en"), api, current: () => ({ handle: HANDLE, name: "ws" }), openChanges: () => undefined });
  screen.choose(RUN, form, "review");
  const root = new FakeElement("main");
  screen.show(root as unknown as HTMLElement);
  await settle();
  await settle();
  return root;
}

test("U-79: the report's review tab has the checklist and the review panel, and records with the run's form", async () => {
  const restore = installFakeDom();
  try {
    const calls: unknown[][] = [];
    const root = await reviewTab(null, { profile: "doc", workflow: "analyze" }, calls);
    const items = root.findAll((e) => e.getAttribute("id") === "report-review-checklist")[0]?.findAll((e) => e.tagName === "li").map((e) => e.textContent);
    assert.deepEqual(items, ["The numbers match the table.", "<b>nothing</b> left out"], "the workflow's checklist, as text");
    const accept = byId(root, "review-accept");
    assert.ok(accept !== undefined && byId(root, "review-reject") !== undefined, "accept and reject, neither the default");
    accept.click();
    assert.equal(byId(root, "review-confirm")?.hasAttribute("hidden"), false, "asked once more in the window");
    assert.deepEqual(calls, [], "nothing recorded before the second answer");
    (byId(root, "review-note") as FakeElement).value = "  checked  ";
    byId(root, "review-record")?.click();
    await settle();
    assert.deepEqual(calls, [[HANDLE, RUN, "doc", "analyze", "accept", "checked"]], "the run's own form");
    assert.equal(byId(root, "review-outcome")?.getAttribute("data-verdict"), "accepted");
  } finally {
    restore();
  }
});

test("U-79: a review already recorded is shown, and a run this app did not start is reviewed with the CLI", async () => {
  const restore = installFakeDom();
  try {
    const calls: unknown[][] = [];
    const done = await reviewTab({ verdict: "rejected", at: "2026-11-13T05:10:00.000Z", note: null }, { profile: null, workflow: "analyze" }, calls);
    assert.equal(byId(done, "report-verdict")?.getAttribute("data-verdict"), "rejected");
    assert.equal(byId(done, "review-accept"), undefined, "no panel once there is a verdict");
    const unknown = await reviewTab(null, null, calls);
    assert.equal(byId(unknown, "review-accept"), undefined, "no form, no review here");
    assert.ok(byId(unknown, "report-review-cli")?.textContent.includes("codaryn review"));
    assert.deepEqual(calls, []);
  } finally {
    restore();
  }
});
