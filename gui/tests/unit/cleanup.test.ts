/**
 * GU-4 (3.8), DR-39, DR-44: cleaning up run records and discard boxes. The selection check
 * (src/shared/cleanup.ts), the engine host's three calls with a fake app, the main process's checks
 * and questions, the preview tokens, the dialog sizes, and the screen with a DOM stand-in.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { createHostHandler } from "../../src/engine-host/host.js";
import { CLEANUP_PREVIEW_TTL_MS, CleanupPreviews } from "../../src/main/cleanup-previews.js";
import { formatBytes } from "../../src/main/dialog-texts.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { cleanupScreen } from "../../src/renderer/runs/cleanup-screen.js";
import { cleanupQuestions, parseCleanupSelection } from "../../src/shared/cleanup.js";
import { parseCleanupPreviewArgs, toCleanupResultReply, toHostCleanupPreview, toStateSummaryReply } from "../../src/shared/ipc.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import type { HostMessage } from "../../src/shared/protocol.js";
import { fakeApp } from "./fake-app.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const WS = path.resolve("ws-for-cleanup");
const RUN_A = "20261101T010203Z-0000000a";
const APPLY_B = "20261102T010203Z-0000000b";
const RUN_C = "20261103T010203Z-0000000c";
const LEFTOVER = "0123456789abcdef";
const DIGEST = "d".repeat(64);
const NOW = "2026-11-12T10:00:00.000Z";
const size = (files: number, bytes: number) => ({ files, bytes });

test("cleanup: a selection is checked field by field; anything else is refused", () => {
  assert.deepEqual(parseCleanupSelection({}), {});
  assert.deepEqual(parseCleanupSelection({ runs: { olderThanDays: 30, reverted: true }, discarded: { runIds: [RUN_A, RUN_A] } }), { runs: { olderThanDays: 30, reverted: true }, discarded: { runIds: [RUN_A] } });
  const refused: unknown[] = [
    null,
    { runs: { olderThanDays: -1 } },
    { runs: { olderThanDays: 1.5 } },
    { runs: { reverted: false } },
    { runs: { runIds: ["latest"] } },
    { runs: { runIds: Array.from({ length: 501 }, () => RUN_A) } },
    { runs: { all: true } },
    { discarded: { reverted: true } },
    { leftovers: {} },
  ];
  for (const value of refused) assert.equal(parseCleanupSelection(value), null, JSON.stringify(value).slice(0, 80));
  assert.equal(parseCleanupPreviewArgs({ workspace: "1".repeat(32), selection: {}, now: NOW }), null, "the window sends no moment and no digest");
});

const SUMMARY = {
  runs: { count: 3, bytes: 3000, oldest: "2026-11-01T01:02:03.000Z", newest: "2026-11-03T01:02:03.000Z" },
  entries: [
    { runId: RUN_C, kind: "run", status: "done", startedAt: "2026-11-03T01:02:03.000Z", records: size(5, 1000), reverted: false, partlyReverted: true, discarded: null, recordsChanged: false, path: "C:\\people\\file.txt" },
    { runId: APPLY_B, kind: "apply", status: "done", startedAt: "2026-11-02T01:02:03.000Z", records: size(3, 1000), reverted: false, partlyReverted: false, discarded: size(2, 400), recordsChanged: false },
    { runId: RUN_A, kind: "run", status: "done", startedAt: "2026-11-01T01:02:03.000Z", records: size(4, 1000), reverted: true, partlyReverted: false, discarded: null, recordsChanged: false },
  ],
  discarded: { runs: 1, files: 2, bytes: 400 },
  parked: size(1, 10),
  leftovers: { count: 1, files: 2, bytes: 20 },
};

const PLAN = {
  items: [
    { target: "run", runId: RUN_C, size: size(5, 1000), warnings: ["partly_reverted"] },
    { target: "run", runId: APPLY_B, size: size(3, 1000), warnings: ["not_reverted", "discarded_left"] },
    { target: "run", runId: RUN_A, size: size(4, 1000), warnings: [] },
    { target: "discarded", runId: APPLY_B, size: size(2, 400), warnings: ["people_files"] },
    { target: "leftover", leftoverId: LEFTOVER, size: size(2, 20), warnings: ["leftover"] },
  ],
  blocked: [{ target: "run", runId: "20261104T010203Z-0000000d", code: "lock_held" }],
  totals: { runs: { count: 3, notReverted: 2, files: 12, bytes: 3000 }, discarded: { count: 1, files: 2, bytes: 400 }, leftovers: { count: 1, files: 2, bytes: 20 } },
  parked: size(1, 10),
  digest: DIGEST,
};

function host(app: Parameters<typeof fakeApp>[0]) {
  const written: HostMessage[] = [];
  const handler = createHostHandler({
    app: fakeApp(app),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (text) => text,
    providers: [],
    itemsIn: () => () => null,
    token: () => "0".repeat(32),
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
  });
  return async (id: number, call: string, args: unknown): Promise<unknown> => {
    await handler.handleLine(JSON.stringify({ v: 1, id, call, args }));
    const message = written.find((m) => "id" in m && m.id === id) as { ok: boolean; value?: unknown; error?: { code: string } };
    return message.ok ? message.value : message.error?.code;
  };
}

test("cleanup (DR-39, DR-44): the engine host passes the three calls and keeps the known fields only", async () => {
  const applied: unknown[] = [];
  const call = host({
    stateSummary: async () => ({ ok: true, output: { kind: "state_summary", summary: SUMMARY } }),
    previewCleanup: async () => ({ ok: true, output: { kind: "cleanup_preview", now: NOW, plan: PLAN } }),
    applyCleanup: async (request) => {
      applied.push(request);
      return {
        ok: true,
        output: {
          kind: "cleanup_applied",
          outcome: {
            ok: true,
            removed: [{ target: "run", runId: RUN_A, size: size(4, 1000) }],
            kept: [
              { target: "run", runId: APPLY_B, reason: "not_reverted_not_confirmed" },
              { target: "leftover", leftoverId: LEFTOVER, reason: "partly_removed" },
            ],
            totals: PLAN.totals,
          },
        },
      };
    },
  });
  const summary = toStateSummaryReply(await call(1, "stateSummary", { workspace: WS }));
  assert.equal(summary.ok, true);
  assert.equal(JSON.stringify(summary).includes("people"), false, "no person's file name goes on");
  assert.deepEqual(summary.ok && summary.summary.leftovers, { count: 1, files: 2, bytes: 20 });
  assert.equal(summary.ok && summary.summary.entries[0]?.partlyReverted, true);

  assert.equal(await call(2, "previewCleanup", { workspace: WS, selection: { runs: { reverted: false } } }), "invalid_args");
  const preview = toHostCleanupPreview(await call(3, "previewCleanup", { workspace: WS, selection: { runs: { olderThanDays: 0 } } }));
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.equal(preview.now, NOW);
  assert.deepEqual(preview.plan.items.map((item) => [item.target, item.id]), [["run", RUN_C], ["run", APPLY_B], ["run", RUN_A], ["discarded", APPLY_B], ["leftover", LEFTOVER]]);
  assert.deepEqual(cleanupQuestions(preview.plan), {
    hasItems: true,
    records: { count: 3, bytes: 3000 },
    notReverted: 2,
    discarded: { count: 1, files: 2, bytes: 400 },
    leftovers: 1,
    discardedLeft: 1,
  });

  const confirmation = { digest: DIGEST, discarded: false, includeNotReverted: false };
  assert.equal(await call(4, "applyCleanup", { workspace: WS, selection: {}, now: NOW, confirmation: { digest: DIGEST, discarded: false } }), "invalid_args", "includeNotReverted is required");
  assert.equal(await call(5, "applyCleanup", { workspace: WS, selection: {}, now: "yesterday", confirmation }), "invalid_args");
  const result = toCleanupResultReply(await call(6, "applyCleanup", { workspace: WS, selection: { runs: { olderThanDays: 0 } }, now: NOW, confirmation }));
  assert.deepEqual(applied, [{ workspace: WS, selection: { runs: { olderThanDays: 0 } }, now: NOW, confirmation }]);
  assert.equal(result.ok, true);
  if (!result.ok || !result.result.ok) return;
  assert.deepEqual(result.result.removed, [{ target: "run", id: RUN_A, files: 4, bytes: 1000 }], "only what was removed entirely");
  assert.deepEqual(result.result.kept.map((item) => item.reason), ["not_reverted_not_confirmed", "partly_removed"]);
});

test("cleanup: a failed cleanup is a code; a plan with another shape is refused by the main process", async () => {
  const call = host({ applyCleanup: async () => ({ ok: true, output: { kind: "cleanup_applied", outcome: { ok: false, code: "plan_changed" } } }) });
  const result = toCleanupResultReply(await call(1, "applyCleanup", { workspace: WS, selection: {}, now: NOW, confirmation: { digest: DIGEST, discarded: true, includeNotReverted: true } }));
  assert.deepEqual(result, { ok: true, result: { ok: false, code: "plan_changed" } });
  const value = { ok: true, now: NOW, plan: { ...PLAN, items: [{ target: "leftover", id: "../x", files: 1, bytes: 1, warnings: [] }] } };
  assert.equal(toHostCleanupPreview(value).ok, false, "a leftover id is 16 hex digits");
  assert.equal(toHostCleanupPreview({ ...value, plan: { ...PLAN, items: [], digest: "x" } }).ok, false);
});

test("cleanup: a preview token works once and for a while; the dialog sizes read as people read them", () => {
  let now = 0;
  let seed = 0;
  const previews = new CleanupPreviews((n) => Uint8Array.from({ length: n }, () => ++seed % 256), () => now);
  const record = { workspace: "1".repeat(32), root: WS, selection: {}, now: NOW, plan: { items: [], blocked: [], totals: PLAN.totals, parked: size(0, 0), digest: DIGEST } };
  const token = previews.issue(record);
  assert.deepEqual(previews.take(token), record);
  assert.equal(previews.take(token), null);
  const old = previews.issue(record);
  now += CLEANUP_PREVIEW_TTL_MS + 1;
  assert.equal(previews.take(old), null);
  assert.equal(formatBytes("en", 512), "512 bytes");
  assert.equal(formatBytes("ko", 2048), "2.0 KB");
  assert.equal(formatBytes("en", 5 * 1024 * 1024), "5.0 MB");
});

test("cleanup (DR-44): the screen asks apart about not reverted runs and discard boxes, and never shows partly_removed as removed", async () => {
  const restore = installFakeDom();
  try {
    const calls: [string, unknown][] = [];
    const hostPlan = (() => {
      const items = PLAN.items.map((item) => ({ target: item.target, id: "leftoverId" in item ? item.leftoverId : item.runId, files: item.size.files, bytes: item.size.bytes, warnings: item.warnings }));
      return { ...PLAN, items };
    })();
    const api = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => async (...args: unknown[]) => {
        calls.push([name, args]);
        if (name === "stateSummary") return { ok: true, summary: { ...SUMMARY, entries: SUMMARY.entries.map(({ ...entry }) => entry) } };
        if (name === "previewCleanup") return { ok: true, token: "e".repeat(32), plan: hostPlan };
        if (name === "applyCleanup") {
          return {
            ok: true,
            result: {
              ok: true,
              removed: [{ target: "run", id: RUN_A, files: 4, bytes: 1000 }],
              kept: [
                { target: "run", id: APPLY_B, reason: "not_reverted_not_confirmed" },
                { target: "leftover", id: LEFTOVER, reason: "partly_removed" },
              ],
              totals: PLAN.totals,
            },
          };
        }
        return null;
      },
    });
    const announced: string[] = [];
    const screen = cleanupScreen({ texts: textsFor("en"), api, current: () => ({ handle: "1".repeat(32), name: "ws" }), announce: (text) => announced.push(text) });
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    const byId = (id: string) => root.findAll((e) => e.getAttribute("id") === id)[0];
    assert.equal(byId("cleanup")?.getAttribute("data-cleanup-ready"), "ok");
    assert.ok(byId("cleanup-summary")?.textContent.includes("1 folders an earlier cleanup could not remove entirely"));
    assert.ok(byId("cleanup-entries")?.textContent.includes("partly reverted"));

    // Choose run C's records and B's discard box one by one, and everything older than 0 days.
    (root.findAll((e) => e.getAttribute("data-run-select") === RUN_C)[0] as unknown as { checked: boolean }).checked = true;
    (root.findAll((e) => e.getAttribute("data-discarded-select") === APPLY_B)[0] as unknown as { checked: boolean }).checked = true;
    (byId("cleanup-runs-days") as FakeElement).value = "0";
    byId("cleanup-preview")?.click();
    await settle();
    assert.deepEqual(calls.find(([name]) => name === "previewCleanup")?.[1], ["1".repeat(32), { runs: { olderThanDays: 0, runIds: [RUN_C] }, discarded: { runIds: [APPLY_B] } }]);
    assert.ok(byId("cleanup-plan-not-reverted")?.textContent.includes("2 of them are runs that were not reverted, only partly, or whose records cannot be checked"), "DR-44 (a): asked apart");
    assert.ok(byId("cleanup-plan-discarded")?.textContent.includes("deleted for good"));
    assert.ok(byId("cleanup-plan-discarded-left")?.textContent.includes("Their records are kept unless those discarded files are deleted in this cleanup too"), "DR-44 (c), U-13");
    assert.ok(byId("cleanup-plan-leftovers") !== undefined);
    assert.equal(root.findAll((e) => e.getAttribute("data-target") === "leftover").length, 1);

    byId("cleanup-apply")?.click();
    await settle();
    await settle();
    assert.deepEqual(calls.find(([name]) => name === "applyCleanup")?.[1], ["e".repeat(32)], "the token only");
    assert.equal(byId("cleanup-removed")?.getAttribute("data-removed"), "1", "partly_removed is not counted as removed");
    assert.ok(byId("cleanup-removed")?.textContent.includes("1 run records, 0 discarded-files folders, 0 leftover folders"));
    assert.deepEqual(
      root.findAll((e) => e.hasAttribute("data-reason")).map((e) => e.getAttribute("data-reason")),
      ["not_reverted_not_confirmed", "partly_removed"],
    );
    assert.ok(byId("cleanup-partly-removed")?.textContent.includes("not counted as removed"));
    assert.equal(byId("cleanup-result")?.getAttribute("data-result"), "done");
    assert.deepEqual(announced, ["1 items were cleaned up."]);
  } finally {
    restore();
  }
});

test("cleanup (R-34b P-1): a run whose records cannot be checked is asked about apart, by the store's own count", () => {
  // The contract decides which warnings need includeNotReverted (NOT_REVERTED_WARNINGS) and the store
  // counts them (totals.runs.notReverted). A damaged run may carry a code the window does not know.
  const plan = {
    items: [{ target: "run" as const, id: RUN_C, files: 2, bytes: 200, warnings: ["records_unverifiable"] }],
    blocked: [],
    totals: { runs: { count: 1, notReverted: 1, files: 2, bytes: 200 }, discarded: { count: 0, files: 0, bytes: 0 }, leftovers: { count: 0, files: 0, bytes: 0 } },
    parked: size(0, 0),
    digest: DIGEST,
  };
  assert.equal(cleanupQuestions(plan).notReverted, 1, "asked apart: the main process follows the store's count");
  const known = { ...plan, items: [{ ...plan.items[0]!, warnings: ["not_reverted"] }], totals: { ...plan.totals, runs: { ...plan.totals.runs, notReverted: 0 } } };
  assert.equal(cleanupQuestions(known).notReverted, 1, "a known code still counts when a total is missing or lower");
});
