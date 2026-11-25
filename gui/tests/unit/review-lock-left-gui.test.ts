/** GUI review: host projection, shared validation, renderer validation and panel text together. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { reviewValue } from "../../src/engine-host/plans.js";
import { createHostHandler } from "../../src/engine-host/host.js";
import { toReviewReply } from "../../src/shared/ipc.js";
import { asReview } from "../../src/renderer/api.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { reviewPanel } from "../../src/renderer/run/review-panel.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { fakeApp } from "./fake-app.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const RUN = "20261127T010203Z-00000001";
const output = { schemaVersion: 1 as const, kind: "review" as const, runId: RUN, verdict: "accepted" as const, exitCode: 0, checklist: [], replaced: false };

test("review lockLeft: the host forwards only literal true without needing a root contract change", () => {
  const value = reviewValue({ ok: true, output: { ...output, lockLeft: true } });
  assert.deepEqual(value, { ok: true, runId: RUN, verdict: "accepted", replaced: false, lockLeft: true });
  for (const lockLeft of [undefined, false, null, 0, "true", {}, []]) {
    const normal = reviewValue({ ok: true, output: { ...output, lockLeft } });
    assert.deepEqual(normal, { ok: true, runId: RUN, verdict: "accepted", replaced: false });
  }
});

for (const [name, check] of [["shared", toReviewReply], ["renderer", asReview]] as const) test(`review lockLeft: ${name} accepts true/absent and refuses every other flag value`, () => {
  const base = { ok: true, verdict: "accepted", replaced: false };
  assert.deepEqual(check(base), base);
  assert.deepEqual(check({ ...base, lockLeft: true }), { ...base, lockLeft: true });
  for (const lockLeft of [false, null, 0, 1, "true", {}, []]) assert.equal(check({ ...base, lockLeft }).ok, false);
});

for (const language of ["ko", "en"] as const) for (const decision of ["accept", "reject"] as const) for (const left of [false, true]) {
  test(`review panel ${language}/${decision}/lockLeft=${left}: the actual host-to-renderer chain preserves the verdict and warning`, async t => {
    const restore = installFakeDom(); t.after(restore);
    const messages: { id?: number; value?: unknown; ok?: boolean }[] = [];
    let lockLeft = left;
    const handler = createHostHandler({ app: fakeApp({ review: async request => ({ ok: true, output: {
      ...output, verdict: request.decision === "accept" ? "accepted" : "rejected", ...(lockLeft ? { lockLeft: true } : {}),
    } }) }), messages: { texts: () => ({ language, texts: {} }) }, tree: async () => null, shown: text => text, providers: [],
      itemsIn: () => () => null, token: () => "a".repeat(32), write: line => messages.push(JSON.parse(line)), log: () => undefined });
    let calls = 0;
    const api = { review: async (_workspace: unknown, runId: string, profile: unknown, workflow: unknown, verdict: string, note: unknown) => {
      await handler.handleLine(JSON.stringify({ v: 1, id: ++calls, call: "review", args: {
        workspace: resolve("synthetic-workspace"), runId, profile, workflowRef: workflow, decision: verdict, note,
      } }));
      const message = messages.find(m => m.id === calls); assert.ok(message?.ok, JSON.stringify(message));
      return toReviewReply(message.value);
    } } as unknown as CodarynApi;
    const texts = textsFor(language), announced: string[] = [];
    const panel = reviewPanel({ texts, api, workspace: { handle: "b".repeat(32), name: "synthetic" }, runId: RUN,
      profile: null, workflow: null, announce: text => announced.push(text) }, { panel: "synthetic-review", title: "synthetic-title" }) as unknown as FakeElement;
    const byId = (id: string) => { const e = panel.findAll(e => e.getAttribute("id") === id)[0]; assert.ok(e, id); return e; };
    const record = async () => { byId(`review-${decision}`).click(); byId("review-record").click(); await settle(); await settle(); };
    await record();
    const outcome = byId("review-outcome"), verdict = decision === "accept" ? "accepted" : "rejected";
    assert.equal(outcome.getAttribute("data-verdict"), verdict);
    assert.ok(outcome.textContent.includes(texts.format(decision === "accept" ? "review.accepted" : "review.rejected")));
    const warningId: string = "review.lockLeft";
    const warning = texts.has(warningId) ? texts.format(warningId) : "missing review.lockLeft";
    t.diagnostic(JSON.stringify({ language, decision, left, warningPresent: outcome.textContent.includes(warning), outcome: outcome.textContent }));
    assert.equal(outcome.children.filter(e => e.textContent === warning).length, left ? 1 : 0);
    if (left) assert.equal(texts.has(warningId), true);
    assert.ok(announced.length > 0);
    // A later normal reply replaces the earlier warning rather than leaving it in the panel.
    lockLeft = false; await record(); assert.equal(outcome.textContent.includes(warning), false);
  });
}
