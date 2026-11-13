/**
 * U-139 (UXM-23, PM (a)): the runs table showed local start times beside run ids that are UTC
 * (…T135733Z…), and nothing said which was which. The table's header now says so:
 * runs.column.run_id "run id (UTC)" and the new header-only runs.column.started_local
 * "started (local)" (drafts, nb-i18n refines them). runs.column.started stays the word of the
 * chosen-run line ("Chose the latest run: <id> (started <time>)"), which is unchanged. The header
 * fits the columns the run ids and times already take, so the data rows are as before.
 * Both languages with the real catalog. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_LANGUAGES, toRunId } from "../../../../src/contracts/index.js";
import type { CatalogText, RunId, RunListEntry, RunsOutput } from "../../../../src/contracts/index.js";
import { createHumanOutput, displayWidth } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const STARTED = "2026-11-13T05:05:05.000Z";
const RUN = toRunId("20261113T050505Z-0a1b2c3d") as RunId;
const entry = { state: "checked", runId: RUN, kind: "run", startedAt: STARTED, taskId: "t", status: "done", reason: "verified", changes: 1, reverted: null, revertRecordDamaged: false } as unknown as Extract<RunListEntry, { readonly state: "checked" }>;
const listing = { schemaVersion: 1, kind: "runs", status: "listed", exitCode: 0, runs: [entry], omitted: 0 } as unknown as RunsOutput;
const WORDS: Record<string, { readonly utc: string; readonly local: string }> = { en: { utc: "UTC", local: "local" }, ko: { utc: "UTC", local: "지역" } };

for (const language of MESSAGE_LANGUAGES) {
  const catalog = createMessageCatalog(language);
  const t = catalog.format as (id: string, ...rest: unknown[]) => CatalogText;
  const out = createHumanOutput(catalog);

  describe(`U-139 (${language}): the runs table's header says UTC and local`, () => {
    test("the run id and started headers are the catalog's, and say UTC and local", () => {
      const [header] = out.runsText(listing).split("\n");
      const runId = t("runs.column.run_id");
      const started = t("runs.column.started_local");
      assert.ok(header?.startsWith(runId), String(header));
      assert.ok(header?.includes(started), String(header));
      assert.ok(runId.includes(WORDS[language]?.utc ?? "?") && started.includes(WORDS[language]?.local ?? "?"), `${runId} / ${started}`);
    });

    test("the header fits the columns: each data cell starts under its header cell", () => {
      const [header, row] = out.runsText(listing).split("\n");
      const columnOf = (line: string, text: string): number => displayWidth(line.slice(0, line.indexOf(text)));
      assert.equal(columnOf(row ?? "", "2026-"), columnOf(header ?? "", t("runs.column.started_local")));
      assert.equal(columnOf(row ?? "", "  1  ") + 2, columnOf(header ?? "", t("runs.column.changes")));
      assert.ok(displayWidth(t("runs.column.run_id")) <= RUN.length && displayWidth(t("runs.column.started_local")) <= "2026-11-13 14:05:05".length, "no column grew");
    });

    test("the chosen-run line keeps runs.column.started", () => {
      const line = out.latestChosen(entry).trimEnd();
      assert.ok(line.includes(`(${t("runs.column.started")} `), line);
      assert.equal(line.includes(t("runs.column.started_local")), false);
    });
  });
}
