/**
 * U-139 (UXM-5, PM): an apply run's row in the runs table did not say which plan it applied (the
 * JSON has RunListEntry.planRunId; the plan run's row names its apply run, runs.plan_applied). Now
 * the apply row's result column has " · " and runs.apply_of with that plan run's id right after its
 * status words, before the revert and records marks. Not on a model run's row (U-198: a model run
 * that carried out a run plan says runs.carried_plan there instead), and not when the id is missing
 * or not a run id. The id and its texts are drafts (p4g-general, nb-i18n refine them).
 * Both languages with the real catalog. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_LANGUAGES, toRunId } from "../../../../src/contracts/index.js";
import type { CatalogText, RunId, RunListEntry, RunsOutput } from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const STARTED = "2026-11-13T04:13:45.000Z";
const PLAN = toRunId("20261113T041344Z-98a62f55") as RunId;
const APPLY = toRunId("20261113T041345Z-084c6f3c") as RunId;
const entry = (extra: Record<string, unknown>): RunListEntry =>
  ({ state: "checked", runId: APPLY, kind: "apply", planRunId: PLAN, startedAt: STARTED, taskId: "t", status: "done", reason: "verified", changes: 7, reverted: null, revertRecordDamaged: false, ...extra }) as unknown as RunListEntry;
const listing = (...runs: RunListEntry[]): RunsOutput => ({ schemaVersion: 1, kind: "runs", status: "listed", exitCode: 0, runs, omitted: 0 }) as unknown as RunsOutput;

for (const language of MESSAGE_LANGUAGES) {
  const catalog = createMessageCatalog(language);
  const t = catalog.format as (id: string, ...rest: unknown[]) => CatalogText;
  /** The result column of the table's only data row (the cells are split at runs of two spaces). */
  const resultOf = (run: RunListEntry): string => (createHumanOutput(catalog).runsText(listing(run)).trimEnd().split("\n")[1] ?? "").split(/ {2,}/)[3] ?? "";
  const done = `${t("status.done")} (done/verified)`;

  describe(`U-139 (${language}): an apply run's row names the plan run it applied`, () => {
    test("right after the status words, before the revert and records marks", () => {
      assert.equal(resultOf(entry({})), `${done} · ${t("runs.apply_of", { runId: PLAN })}`);
      assert.equal(
        resultOf(entry({ reverted: { at: STARTED, status: "complete" }, recordsChanged: true })),
        `${done} · ${t("runs.apply_of", { runId: PLAN })} · ${t("runs.reverted")} (complete) · ${t("runs.records_changed")}`,
      );
      // An apply run with no result yet keeps its words and names its plan too.
      assert.equal(resultOf(entry({ status: null, reason: null, changes: null })), `${t("runs.incomplete")} · ${t("runs.apply_of", { runId: PLAN })}`);
    });

    test("not on a model run's row, nor without a plan run id that is a run id", () => {
      assert.equal(resultOf(entry({ kind: "run", planRunId: undefined, changes: 2 })), done);
      // U-198 (DR-69 B-3, contract U-175): a planRunId on a model run's entry is the plan it carried out
      // (store U-181); its row says runs.carried_plan, never runs.apply_of. No list before B-3 has one.
      assert.equal(resultOf(entry({ kind: "run", changes: 2 })), `${done} · ${t("runs.carried_plan", { runId: PLAN })}`, "a model run's planRunId is the plan it carried out");
      for (const planRunId of [undefined, "../x", "a b", "", 7]) assert.equal(resultOf(entry({ planRunId })), done, String(planRunId));
    });
  });
}
