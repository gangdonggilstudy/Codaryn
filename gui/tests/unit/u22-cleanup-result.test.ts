/**
 * U-22 (DR-48, review R-51 M-1): the app layer says what a cleanup did (status removed,
 * nothing_removed or partly_failed) and its outcome is `ok` for `removed` only; a digest that is
 * not the plan's is the call error cleanup_plan_changed. The window shows each as it is: what was
 * removed, what was kept and why. Before the fix the engine host read `ok: false` as "nothing done,
 * `code` says why" and every such cleanup became host_error.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { createHostHandler } from "../../src/engine-host/host.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { cleanupScreen } from "../../src/renderer/runs/cleanup-screen.js";
import { toCleanupResultReply } from "../../src/shared/ipc.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import type { HostMessage } from "../../src/shared/protocol.js";
import { fakeApp } from "./fake-app.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const WS = path.resolve("ws-for-u22");
const RUN_A = "20261101T010203Z-0000000a";
const RUN_B = "20261102T010203Z-0000000b";
const LEFTOVER = "0123456789abcdef";
const NOW = "2026-11-13T10:00:00.000Z";
const DIGEST = "d".repeat(64);
const size = (files: number, bytes: number) => ({ files, bytes });
const TOTALS = { runs: { count: 2, notReverted: 1, files: 8, bytes: 2000 }, discarded: { count: 0, files: 0, bytes: 0 }, leftovers: { count: 0, files: 0, bytes: 0 } };

/** The app layer's applyCleanup outputs (src/app/cleanup.ts, DR-48). */
const OUTPUTS = {
  removed: { ok: true, output: { kind: "cleanup_applied", status: "removed", outcome: { ok: true, removed: [{ target: "run", runId: RUN_A, size: size(4, 1000) }], kept: [{ target: "run", runId: RUN_B, reason: "not_reverted_not_confirmed" }], totals: TOTALS } } },
  nothing_removed: { ok: true, output: { kind: "cleanup_applied", status: "nothing_removed", outcome: { ok: false, removed: [], kept: [{ target: "run", runId: RUN_B, reason: "not_reverted_not_confirmed" }], totals: TOTALS } } },
  partly_failed: {
    ok: true,
    output: { kind: "cleanup_applied", status: "partly_failed", outcome: { ok: false, removed: [{ target: "run", runId: RUN_A, size: size(4, 1000) }], kept: [{ target: "leftover", leftoverId: LEFTOVER, reason: "partly_removed" }, { target: "run", runId: RUN_B, reason: "io_error" }], totals: TOTALS } },
  },
  plan_changed: { ok: false, error: { code: "cleanup_plan_changed", message: "the plan made again under the lock is not the confirmed one; nothing was removed." } },
} as const;

function host(outcome: unknown) {
  const written: HostMessage[] = [];
  const handler = createHostHandler({
    app: fakeApp({ applyCleanup: async () => outcome }),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (text) => text,
    providers: [],
    itemsIn: () => () => null,
    token: () => "0".repeat(32),
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
  });
  return async (): Promise<{ ok: boolean; value?: unknown; error?: { code: string } }> => {
    await handler.handleLine(JSON.stringify({ v: 1, id: 1, call: "applyCleanup", args: { workspace: WS, selection: {}, now: NOW, confirmation: { digest: DIGEST, discarded: false, includeNotReverted: false } } }));
    return written.find((m) => "id" in m && m.id === 1) as { ok: boolean; value?: unknown; error?: { code: string } };
  };
}

test("U-22: a cleanup that removed nothing, or failed in part, reaches the window as what it did", async () => {
  for (const status of ["removed", "nothing_removed", "partly_failed"] as const) {
    const message = await host(OUTPUTS[status])();
    assert.equal(message.ok, true, `${status}: ${JSON.stringify(message)}`);
    const reply = toCleanupResultReply(message.value);
    assert.ok(reply.ok && reply.result.ok, `${status}: ${JSON.stringify(reply)}`);
    if (!reply.ok || !reply.result.ok) continue;
    assert.equal(reply.result.status, status);
    const removed = OUTPUTS[status].output.outcome.removed.length;
    assert.equal(reply.result.removed.length, removed, `${status}: removed`);
    assert.equal(reply.result.kept.length, OUTPUTS[status].output.outcome.kept.length, `${status}: kept`);
  }
  const bad = await host({ ok: true, output: { kind: "cleanup_applied", status: "exploded", outcome: OUTPUTS.removed.output.outcome } })();
  assert.equal(toCleanupResultReply(bad.ok ? bad.value : bad).ok, false, "an unknown status is refused");
});

test("U-22: a digest that is not the plan's is the call's error, with its own words", async () => {
  const message = await host(OUTPUTS.plan_changed)();
  assert.deepEqual(toCleanupResultReply(message.ok ? message.value : message), { ok: false, code: "cleanup_plan_changed" }, "the main process passes the code on");
  assert.match(EN["error.cleanup_plan_changed"], /changed after the preview, so nothing was removed/);
  assert.match(KO["error.cleanup_plan_changed"], /아무것도 지우지 않았습니다/);
});

async function shown(status: "removed" | "nothing_removed" | "partly_failed"): Promise<FakeElement> {
  const message = await host(OUTPUTS[status])();
  const reply = toCleanupResultReply(message.value);
  const summary = { runs: { count: 2, bytes: 2000, oldest: null, newest: null }, entries: [], discarded: { runs: 0, files: 0, bytes: 0 }, parked: { files: 0, bytes: 0 }, leftovers: { count: 0, files: 0, bytes: 0 } };
  const plan = { items: [{ target: "run", id: RUN_A, files: 4, bytes: 1000, warnings: [] }, { target: "run", id: RUN_B, files: 4, bytes: 1000, warnings: ["not_reverted"] }], blocked: [], totals: TOTALS, parked: { files: 0, bytes: 0 }, digest: DIGEST };
  const api = new Proxy({} as CodarynApi, {
    get: (_t, name: string) => async () => {
      if (name === "stateSummary") return { ok: true, summary };
      if (name === "previewCleanup") return { ok: true, token: "e".repeat(32), plan };
      if (name === "applyCleanup") return reply;
      return null;
    },
  });
  const screen = cleanupScreen({ texts: textsFor("en"), api, current: () => ({ handle: "1".repeat(32), name: "ws" }), announce: () => undefined });
  const root = new FakeElement("main");
  screen.show(root as unknown as HTMLElement);
  await settle();
  root.findAll((e) => e.getAttribute("id") === "cleanup-preview")[0]?.click();
  await settle();
  root.findAll((e) => e.getAttribute("id") === "cleanup-apply")[0]?.click();
  await settle();
  await settle();
  return root;
}

test("U-22: the screen says nothing was removed, or that not everything could be, with what was kept and why", async () => {
  const restore = installFakeDom();
  try {
    const byId = (root: FakeElement, id: string) => root.findAll((e) => e.getAttribute("id") === id)[0];
    const nothing = await shown("nothing_removed");
    assert.equal(byId(nothing, "cleanup-result")?.getAttribute("data-result"), "done", "carried out, not an error");
    assert.equal(byId(nothing, "cleanup-result")?.getAttribute("data-status"), "nothing_removed");
    assert.equal(nothing.findAll((e) => e.getAttribute("data-error") !== null).length, 0, "no error box");
    assert.match(byId(nothing, "cleanup-status")?.textContent ?? "", /Nothing was removed/);
    assert.deepEqual(nothing.findAll((e) => e.getAttribute("data-reason") !== null).map((e) => e.getAttribute("data-reason")), ["not_reverted_not_confirmed"]);

    const partly = await shown("partly_failed");
    assert.equal(byId(partly, "cleanup-result")?.getAttribute("data-status"), "partly_failed");
    assert.match(byId(partly, "cleanup-status")?.textContent ?? "", /Not everything could be removed/);
    assert.equal(byId(partly, "cleanup-removed")?.getAttribute("data-removed"), "1");
    assert.deepEqual(partly.findAll((e) => e.getAttribute("data-reason") !== null).map((e) => e.getAttribute("data-reason")), ["partly_removed", "io_error"]);

    const removed = await shown("removed");
    assert.equal(byId(removed, "cleanup-result")?.getAttribute("data-status"), "removed");
    assert.equal(byId(removed, "cleanup-status"), undefined, "the removed line says it");
  } finally {
    restore();
  }
});
