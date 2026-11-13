/**
 * U-86 (UXM-10, the rest of UXM-1; PM: nc-human's plan B): the cleanup preview is grouped by what
 * a person must give for an item to go: --confirm alone, --include-not-reverted too,
 * --delete-discarded too, or nothing in this selection (kept with its apply run). Each warning is its
 * own line under its item; the preview ends with two commands (--confirm alone, and everything); with
 * nothing selected it shows two example commands. The output after a confirmation stays, and so does
 * `cleanup --json`: what the store works out for the preview (each item's fate, the discarded-files
 * folders without run records) travels under symbol keys.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CLEANUP_CONFIRM_FLAGS,
  CLEANUP_ITEM_FATES,
  FIXED_MESSAGES,
  MESSAGE_IDS,
  STATE_DISCARDED_WITHOUT_RECORDS,
  messageParams,
} from "../../../src/contracts/index.js";
import type { CleanupItemFate, CleanupPlan, ContentHash, MessageId, RunId, StateSummary } from "../../../src/contracts/index.js";

const NEW: { readonly [id: string]: { readonly [param: string]: string } } = {
  "cleanup.summary.discarded_without_records": { count: "count", bytes: "count" },
  "cleanup.group.confirm": { count: "count", bytes: "count" },
  "cleanup.group.include_not_reverted": { count: "count", bytes: "count" },
  "cleanup.group.delete_discarded": { count: "count", files: "count", bytes: "count" },
  "cleanup.group.kept": { count: "count" },
  "cleanup.command.confirm": {},
  "cleanup.command.all": {},
  "cleanup.no_selection": {},
  "cleanup.example.older_than": {},
  "cleanup.example.reverted": {},
};

const RETIRED = [
  "cleanup.confirm.runs",
  "cleanup.confirm.discarded",
  "cleanup.confirm.not_reverted",
  "cleanup.confirm.leftovers",
  "cleanup.next.confirm_runs",
  "cleanup.next.not_reverted",
  "cleanup.next.discarded",
  "cleanup.next.discarded_left",
  "cleanup.next.confirm_discarded",
  "cleanup.next.confirm_leftovers",
];

describe("U-86: the preview's texts", () => {
  test("the new ids, with counts only", () => {
    const ids = MESSAGE_IDS as readonly string[];
    for (const [id, params] of Object.entries(NEW)) {
      assert.equal(ids.filter((entry) => entry === id).length, 1, id);
      assert.ok(Object.hasOwn(FIXED_MESSAGES, id), id);
      assert.deepEqual(messageParams(id as MessageId), params, id);
    }
  });

  test("the ids the new preview no longer uses are gone; the output after a confirmation keeps its own", () => {
    const ids = MESSAGE_IDS as readonly string[];
    for (const id of RETIRED) assert.equal(ids.includes(id), false, id);
    for (const kept of ["cleanup.nothing", "cleanup.size", "cleanup.nothing_removed", "cleanup.done", "cleanup.done_leftovers", "cleanup.done_discarded_left", "cleanup.summary.runs"]) {
      assert.ok(ids.includes(kept), kept);
    }
  });
});

describe("U-86: what the store works out, under symbol keys", () => {
  test("an item's fate: the fewest flags besides --confirm, or kept whatever is confirmed", () => {
    assert.deepEqual([...CLEANUP_CONFIRM_FLAGS], ["include_not_reverted", "delete_discarded"]);
    const fates: CleanupItemFate[] = [
      { removedWith: [] },
      { removedWith: ["include_not_reverted"] },
      { removedWith: ["delete_discarded"] },
      { removedWith: ["include_not_reverted", "delete_discarded"] },
      { keptFor: "used_by_kept_apply" },
      { keptFor: "discarded_left" },
    ];
    // @ts-expect-error only the two reasons no confirmation lifts
    const wrong: CleanupItemFate = { keptFor: "io_error" };
    assert.equal(fates.length + (wrong ? 0 : 0), 6);
  });

  test("cleanup --json does not change: neither value is in the JSON line", () => {
    const runId = "20261113T000000Z-0000abcd" as RunId;
    const plan: CleanupPlan = {
      items: [{ target: "run", runId, size: { files: 1, bytes: 10 }, warnings: [] }],
      blocked: [],
      totals: { runs: { count: 1, notReverted: 0, files: 1, bytes: 10 }, discarded: { count: 0, files: 0, bytes: 0 }, leftovers: { count: 0, files: 0, bytes: 0 } },
      parked: { files: 0, bytes: 0 },
      digest: "a".repeat(64) as ContentHash,
      [CLEANUP_ITEM_FATES]: [{ removedWith: [] }],
    };
    const before = JSON.stringify({ ...plan, [CLEANUP_ITEM_FATES]: undefined });
    assert.equal(JSON.stringify(plan), before);
    assert.equal(JSON.stringify(plan).includes("removedWith"), false);
    assert.deepEqual({ ...plan }[CLEANUP_ITEM_FATES], [{ removedWith: [] }], "a spread copy keeps it");
    const summary: Pick<StateSummary, typeof STATE_DISCARDED_WITHOUT_RECORDS> = { [STATE_DISCARDED_WITHOUT_RECORDS]: { count: 2, files: 3, bytes: 40 } };
    assert.equal(JSON.stringify(summary), "{}");
    assert.equal(typeof CLEANUP_ITEM_FATES, "symbol");
    assert.equal(typeof STATE_DISCARDED_WITHOUT_RECORDS, "symbol");
  });
});
