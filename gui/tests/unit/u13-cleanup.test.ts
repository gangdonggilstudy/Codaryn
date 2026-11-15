/**
 * U-13 (DR-53, UXM-1): an apply run whose discarded files stay keeps its records (kept reason
 * discarded_left) unless its discarded files are deleted in the same cleanup. The window says why it
 * was kept and how it can go, in the plan, the main process's dialogs and the result.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanupDiscardedDetail, dialogText } from "../../src/main/dialog-texts.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { cleanupScreen } from "../../src/renderer/runs/cleanup-screen.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const APPLY = "20261102T010203Z-0000000b";

test("U-13: the plan notice and the main process's dialogs say an apply run's records stay while its discarded files stay", () => {
  for (const [language, kept] of [["en", /records .*kept/], ["ko", /기록은 남깁니다/]] as const) {
    assert.match(textsFor(language).format("cleanup.plan.discardedLeft", { count: "2" }), kept, `${language} plan notice`);
    assert.match(dialogText(language, "cleanup.discardedLeft", { count: 2 }), kept, `${language} first dialog`);
    assert.match(cleanupDiscardedDetail(language, 2), kept, `${language} discarded files dialog`);
  }
  assert.doesNotMatch(dialogText("en", "cleanup.discardedLeft", { count: 2 }), /can no longer be put back/, "no longer what happens");
});

test("U-13: a result's apply run kept as discarded_left says why and how it can go", async () => {
  const restore = installFakeDom();
  try {
    const summary = { runs: { count: 1, bytes: 10, oldest: null, newest: null }, entries: [], discarded: { runs: 1, files: 2, bytes: 20 }, parked: { files: 0, bytes: 0 }, leftovers: { count: 0, files: 0, bytes: 0 } };
    const plan = {
      items: [{ target: "run", id: APPLY, files: 1, bytes: 10, warnings: ["discarded_left"] }],
      blocked: [],
      totals: { runs: { count: 1, notReverted: 0, files: 1, bytes: 10 }, discarded: { count: 0, files: 0, bytes: 0 }, leftovers: { count: 0, files: 0, bytes: 0 } },
      parked: { files: 0, bytes: 0 },
      digest: "d".repeat(64),
    };
    const api = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => async () => {
        if (name === "stateSummary") return { ok: true, summary };
        if (name === "previewCleanup") return { ok: true, token: "e".repeat(32), plan };
        if (name === "applyCleanup") return { ok: true, result: { ok: true, status: "nothing_removed", removed: [], kept: [{ target: "run", id: APPLY, reason: "discarded_left" }], totals: plan.totals } };
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
    const line = root.findAll((e) => e.getAttribute("data-reason") === "discarded_left")[0];
    assert.ok(line !== undefined);
    assert.doesNotMatch(line.textContent, /discarded_left/, "words, not the code");
    assert.match(line.textContent, /discarded files/);
    assert.match(line.textContent, /revert|delete/, "says how it can go");
    assert.match(root.findAll((e) => e.getAttribute("id") === "cleanup-kept-discarded-left")[0]?.textContent ?? "", /records of 1 apply runs were kept/);
  } finally {
    restore();
  }
});
