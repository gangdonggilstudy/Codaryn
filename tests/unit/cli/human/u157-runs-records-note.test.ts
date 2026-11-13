/**
 * U-157 (UXM-18, PM): a run's row in the runs table carried the records-changed mark with its
 * explanation, which made the row long (121 columns in English). Now the row carries only the short
 * mark (runs.records_changed) and the explanation is one line under the table
 * (runs.records_changed_note), once, when a listed run has the mark; before the "more runs" line.
 * No marked run: no line. Both languages with the real catalog (draft texts). Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_LANGUAGES, toRunId } from "../../../../src/contracts/index.js";
import type { CatalogText, RunId, RunListEntry, RunsOutput } from "../../../../src/contracts/index.js";
import { createHumanOutput, displayWidth } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const STARTED = "2026-11-13T04:58:04.000Z";
const run = (id: string, extra: Record<string, unknown>): RunListEntry =>
  ({ state: "checked", runId: toRunId(id) as RunId, kind: "run", startedAt: STARTED, taskId: "t", status: "done", reason: "verified", changes: 1, reverted: null, revertRecordDamaged: false, ...extra }) as unknown as RunListEntry;
const MARKED = run("20261113T045804Z-9181679d", { recordsChanged: true });
const OTHER_MARKED = run("20261113T045805Z-0000000a", { recordsChanged: true, status: "failed", reason: "state_changed" });
const PLAIN = run("20261113T045806Z-0000000b", {});
const listing = (runs: RunListEntry[], omitted = 0): RunsOutput => ({ schemaVersion: 1, kind: "runs", status: "listed", exitCode: 0, runs, omitted }) as unknown as RunsOutput;

for (const language of MESSAGE_LANGUAGES) {
  const catalog = createMessageCatalog(language);
  const t = catalog.format as (id: string, ...rest: unknown[]) => CatalogText;
  const linesOf = (output: RunsOutput): string[] => createHumanOutput(catalog).runsText(output).trimEnd().split("\n");
  const note = t("runs.records_changed_note");

  describe(`U-157 (${language}): the records-changed mark is short; its explanation is a line under the table`, () => {
    test("a marked row ends with the short mark; the note is once under the table, before the more-runs line", () => {
      const lines = linesOf(listing([PLAIN, MARKED, OTHER_MARKED], 3));
      const marked = lines.find((line) => line.startsWith("20261113T045804Z")) ?? "";
      assert.ok(marked.endsWith(` · ${t("runs.records_changed")}`), marked);
      assert.equal(lines.filter((line) => line === note).length, 1, lines.join("\n"));
      assert.equal(lines.indexOf(note), 4, "right after the header and the three rows");
      assert.equal(lines[5], t("runs.omitted", { count: 3 }));
    });

    test("no marked run: no note, and the table is as before", () => {
      const lines = linesOf(listing([PLAIN]));
      assert.equal(lines.includes(note), false);
      assert.equal(lines.length, 2);
    });

    test("a done run's marked row fits 100 columns", () => {
      const marked = linesOf(listing([MARKED])).find((line) => line.startsWith("20261113T045804Z")) ?? "";
      assert.ok(displayWidth(marked) <= 100, `${displayWidth(marked)}: ${marked}`);
    });
  });
}
