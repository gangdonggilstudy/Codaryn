/**
 * U-34 (UXM-7, AXM-22): the cleanup lines that were fixed English come from the catalog now. The
 * English output must not change by a single character, and `cleanup --json` not at all (PM).
 * This pins the English text as it was before U-34 (main 0ad28bc): the lines U-34 moves are written
 * out here as they were; the lines that already came from the catalog are the English catalog's.
 * It passed on the renderer before U-34 and must pass after it.
 * renderCleanup on made-up outputs (u34-cleanup-fixtures); the JSON through runCleanup with the
 * store's functions injected. Nothing is removed and nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { CleanupOutput, MessageCatalog, MessageId } from "../../../src/contracts/index.js";
import { renderCleanup, runCleanup } from "../../../src/cli/cleanup.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import {
  LEFTOVER,
  NOTHING_REMOVED,
  PLAN_ALL,
  PLAN_DISCARDED,
  PLAN_EMPTY,
  PLAN_LEFTOVERS,
  REMOVED,
  RUN_A,
  RUN_B,
  RUN_C,
  RUN_D,
  SHORT,
  SUMMARY,
  SUMMARY_PLAIN,
  preview,
} from "./u34-cleanup-fixtures.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const english = createMessageCatalog("en");
const en = (id: MessageId, params?: Record<string, number>): string => (english.format as (id: MessageId, params?: Record<string, number>) => string)(id, params);
const text = (lines: readonly string[]): string => `${lines.join("\n")}\n`;

const summaryLines = [
  en("cleanup.summary.runs", { count: 4, bytes: 4000 }),
  en("cleanup.summary.discarded", { files: 2, bytes: 200 }),
  en("cleanup.summary.parked", { files: 1, bytes: 10 }),
  en("cleanup.summary.leftovers", { count: 1, bytes: 30 }),
  en("cleanup.summary.unknown_folders", { count: 1, bytes: 5 }),
  "",
];

describe("U-34: the English cleanup output is as it was", () => {
  test("a preview with run records, a discarded-files folder, a leftover and a blocked run", () => {
    assert.equal(
      renderCleanup(preview(PLAN_ALL), english),
      text([
        ...summaryLines,
        en("cleanup.confirm.runs", { count: 3, bytes: 450 }),
        `  ${en("cleanup.confirm.not_reverted", { count: 1 })}`,
        `- ${RUN_A}: 3 file(s), 300 bytes; ${en("cleanup.warning.not_reverted")}`,
        `- ${RUN_B}: 1 file(s), 100 bytes; ${en("cleanup.warning.discarded_left")}`,
        `- ${RUN_C}: 1 file(s), 50 bytes`,
        en("cleanup.confirm.discarded", { files: 2, bytes: 200 }),
        `- ${RUN_B}: 2 file(s), 200 bytes; ${en("cleanup.warning.people_files")}`,
        en("cleanup.confirm.leftovers", { count: 1, bytes: 30 }),
        `- cleanup-${LEFTOVER}: 3 file(s), 30 bytes; ${en("cleanup.warning.leftover")}`,
        `- run ${RUN_D}: ${en("cleanup.blocked.lock_held")}`,
        "",
        `Nothing was removed. To remove the run records, run the same command with --confirm ${SHORT}.`,
        "The records of 1 run(s) not reverted, only partly reverted, or whose records cannot be checked are kept unless you add --include-not-reverted yourself; once they are removed, those runs can no longer be reverted.",
        "People's discarded files are deleted only with --delete-discarded besides.",
        "The records of 1 apply run(s) whose discarded files are still kept stay unless those files are deleted in the same cleanup (--delete-discarded, with their folders selected) or the apply is reverted first; only the records say what the files were.",
      ]),
    );
  });

  test("a preview with only a discarded-files folder", () => {
    assert.equal(
      renderCleanup(preview(PLAN_DISCARDED), english),
      text([
        ...summaryLines,
        en("cleanup.confirm.discarded", { files: 2, bytes: 200 }),
        `- ${RUN_B}: 2 file(s), 200 bytes; ${en("cleanup.warning.people_files")}`,
        `- discarded ${RUN_D}: ${en("cleanup.blocked.no_result")}`,
        "",
        `Nothing was removed. To delete the discarded files, run the same command with --confirm ${SHORT} --delete-discarded.`,
      ]),
    );
  });

  test("a preview with only a leftover folder", () => {
    assert.equal(
      renderCleanup(preview(PLAN_LEFTOVERS), english),
      text([
        ...summaryLines,
        en("cleanup.confirm.leftovers", { count: 1, bytes: 30 }),
        `- cleanup-${LEFTOVER}: 3 file(s), 30 bytes; ${en("cleanup.warning.leftover")}`,
        "",
        `Nothing was removed. To remove what earlier cleanups left, run the same command with --confirm ${SHORT}.`,
      ]),
    );
  });

  test("a preview with nothing to clean up", () => {
    assert.equal(
      renderCleanup(preview(PLAN_EMPTY, SUMMARY_PLAIN), english),
      text([
        en("cleanup.summary.runs", { count: 0, bytes: 0 }),
        en("cleanup.summary.discarded", { files: 0, bytes: 0 }),
        en("cleanup.summary.parked", { files: 0, bytes: 0 }),
        "",
        en("cleanup.nothing"),
      ]),
    );
  });

  test("a confirmed cleanup that removed nothing, an item of each kind kept", () => {
    assert.equal(
      renderCleanup(NOTHING_REMOVED, english),
      text([
        "Nothing was removed.",
        `- run ${RUN_A}: ${en("cleanup.kept.not_reverted_not_confirmed")}`,
        `- discarded ${RUN_B}: ${en("cleanup.kept.not_confirmed")}`,
        `- leftover cleanup-${LEFTOVER}: ${en("cleanup.kept.partly_removed")}`,
      ]),
    );
  });

  test("a confirmed cleanup that removed runs, a folder and a leftover and kept an apply run", () => {
    assert.equal(
      renderCleanup(REMOVED, english),
      text([
        en("cleanup.done", { runs: 2, folders: 1, bytes: 550 }),
        en("cleanup.done_leftovers", { count: 1, bytes: 30 }),
        en("cleanup.done_discarded_left", { count: 1 }),
        `- run ${RUN_B}: ${en("cleanup.kept.discarded_left")}`,
      ]),
    );
  });

  test("cleanup --json does not read the catalog: the same line in English, in Korean and with a catalog that fails", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "codaryn-g-u34-"));
    temporaryDirs.push(workspace);
    const failing = {
      language: "en",
      format: () => {
        throw new Error("the JSON line must not read the catalog");
      },
    } as unknown as MessageCatalog;
    const printed: string[] = [];
    for (const messages of [english, createMessageCatalog("ko"), failing]) {
      const outcome = await runCleanup({
        argv: ["cleanup", "--workspace", workspace, "--older-than", "0", "--json"],
        cwd: workspace,
        env: {},
        clock: { now: () => Date.parse("2026-11-13T00:00:00.000Z") },
        messages,
        summarizeState: async () => SUMMARY,
        planCleanup: async () => PLAN_ALL,
      });
      assert.ok("text" in outcome, JSON.stringify(outcome));
      assert.equal(outcome.exitCode, 0);
      printed.push(outcome.text);
    }
    assert.equal(new Set(printed).size, 1, printed.join("\n"));
    const shown = JSON.parse(printed[0] ?? "") as CleanupOutput;
    assert.deepEqual(shown, preview(PLAN_ALL));
  });
});
