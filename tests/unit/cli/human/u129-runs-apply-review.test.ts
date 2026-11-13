/**
 * U-129 (PM approved), the human renderer's part of the runs table:
 * (1) UXM-4, UXM-5: an apply run's number in the changes column is its applied actions, not files.
 *     The cell says so: `runs.apply_action_one` for one, else `runs.apply_actions` (PM: English
 *     "1 action", "N actions"; Korean "동작 N"). A model run's cell is the number as before; the JSON
 *     keeps the number.
 * (2) AXM-21: a run with RunListEntry.review (a person's verdict, store U-129) gets `runs.review`
 *     with `{verdict}` = `review.verdict.<verdict>` in its result column, before the revert and
 *     records marks. No field, or a verdict that is not one of REVIEW_VERDICTS: nothing added.
 * The ids are p4g-general's (33c376e) and their texts nb-i18n's: a stand-in shows each id with its
 * parameters, and the real texts are checked in both languages once the catalog has them.
 * Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_LANGUAGES, toRunId } from "../../../../src/contracts/index.js";
import type { CatalogText, MessageCatalog, RunId, RunListEntry, RunsOutput } from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";
import { MESSAGE_TEXTS } from "../../../../src/i18n/catalog.js";

const NEW_IDS = ["runs.apply_actions", "runs.apply_action_one", "runs.review"] as const;
const real = createMessageCatalog("en");
const asText = (catalog: MessageCatalog) => catalog.format as (id: string, ...rest: unknown[]) => CatalogText;
const standIn: MessageCatalog = {
  language: "en",
  format: ((id: string, ...params: unknown[]) =>
    (NEW_IDS as readonly string[]).includes(id) ? (`<${id}${params[0] === undefined ? "" : ` ${JSON.stringify(params[0])}`}>` as CatalogText) : asText(real)(id, ...params)) as MessageCatalog["format"],
};

const STARTED = "2026-11-13T03:12:26.000Z";
const PLAN = toRunId("20261113T031226Z-b632fa09") as RunId;
const APPLY = toRunId("20261113T031226Z-e1c72b29") as RunId;
const REVIEWED = toRunId("20261113T031224Z-a1320fe8") as RunId;
const checked = (runId: RunId, extra: Record<string, unknown>): RunListEntry =>
  ({ state: "checked", runId, kind: "run", startedAt: STARTED, taskId: "t", status: "done", reason: "verified", changes: 2, reverted: null, revertRecordDamaged: false, ...extra }) as unknown as RunListEntry;
const apply = (changes: number | null, extra: Record<string, unknown> = {}): RunListEntry => checked(APPLY, { kind: "apply", planRunId: PLAN, changes, ...extra });
const planRun = checked(PLAN, { status: "needs-input", reason: "plan_pending", changes: 0, appliedBy: { runId: APPLY, at: STARTED } });
const awaiting = (review?: unknown, extra: Record<string, unknown> = {}): RunListEntry =>
  checked(REVIEWED, { status: "needs-input", reason: "awaiting_review", ...(review === undefined ? {} : { review }), ...extra });
const listing = (...runs: RunListEntry[]): RunsOutput => ({ schemaVersion: 1, kind: "runs", status: "listed", exitCode: 0, runs, omitted: 0 }) as unknown as RunsOutput;
/** The table's rows split into cells at runs of two or more spaces (the cells hold single spaces only). */
const rowsOf = (catalog: MessageCatalog, ...runs: RunListEntry[]): string[][] =>
  createHumanOutput(catalog).runsText(listing(...runs)).trimEnd().split("\n").slice(1).map((row) => row.split(/ {2,}/));

describe("U-129 (1): an apply run's changes cell says the number is actions", () => {
  test("7 actions, 1 action, none without a result; the plan run and a model run keep their number", () => {
    const rows = rowsOf(standIn, apply(7), planRun, checked(REVIEWED, {}));
    assert.deepEqual(rows.map((row) => row[2]), ['<runs.apply_actions {"count":7}>', "0", "2"]);
    assert.equal(rowsOf(standIn, apply(1))[0]?.[2], "<runs.apply_action_one>");
    assert.equal(rowsOf(standIn, apply(0))[0]?.[2], '<runs.apply_actions {"count":0}>');
    assert.equal(rowsOf(standIn, apply(null, { status: null, reason: null }))[0]?.[2], "-");
  });

  test("the rest of the apply row is as before (its status words)", () => {
    const [row] = rowsOf(standIn, apply(7));
    assert.equal(row?.[0], APPLY);
    assert.equal(row?.[3], `${asText(real)("status.done")} (done/verified)`);
  });
});

describe("U-129 (2): a person's verdict in the result column", () => {
  test("rejected and accepted: the verdict's word, before the revert mark", () => {
    for (const verdict of ["rejected", "accepted"] as const) {
      const [row] = rowsOf(standIn, awaiting({ verdict, at: STARTED }, { reverted: { at: STARTED, status: "complete" } }));
      const words = asText(real)(`review.verdict.${verdict}`);
      assert.equal(
        row?.[3],
        `${asText(real)("status.needs-input")} (needs-input/awaiting_review) · <runs.review ${JSON.stringify({ verdict: words })}> · ${asText(real)("runs.reverted")} (complete)`,
      );
    }
  });

  test("no verdict, or one that is not accepted or rejected: nothing added", () => {
    const plain = `${asText(real)("status.needs-input")} (needs-input/awaiting_review)`;
    for (const review of [undefined, null, "rejected", { verdict: "maybe", at: STARTED }, { at: STARTED }]) {
      assert.equal(rowsOf(standIn, awaiting(review))[0]?.[3], plain, JSON.stringify(review));
    }
  });
});

describe("U-129 with the real catalog", () => {
  const ready = MESSAGE_LANGUAGES.every((language) => NEW_IDS.every((id) => Object.hasOwn(MESSAGE_TEXTS[language], id)));
  const skip = ready ? false : "the texts of runs.apply_actions, runs.apply_action_one and runs.review are not in the catalog yet (nb-i18n)";
  test("en: '7 actions' and '1 action' (PM)", { skip }, () => {
    const catalog = createMessageCatalog("en");
    assert.deepEqual([rowsOf(catalog, apply(7))[0]?.[2], rowsOf(catalog, apply(1))[0]?.[2]], ["7 actions", "1 action"]);
  });
  test("ko: '동작 7' and '동작 1' (PM)", { skip }, () => {
    const catalog = createMessageCatalog("ko");
    assert.deepEqual([rowsOf(catalog, apply(7))[0]?.[2], rowsOf(catalog, apply(1))[0]?.[2]], ["동작 7개", "동작 1개"]);
  });
  for (const language of MESSAGE_LANGUAGES) {
    test(`${language}: the verdict's line is the catalog's, with the verdict's own word`, { skip }, () => {
      const catalog = createMessageCatalog(language);
      const t = asText(catalog);
      const [row] = rowsOf(catalog, awaiting({ verdict: "rejected", at: STARTED }));
      assert.equal(row?.[3], `${t("status.needs-input")} (needs-input/awaiting_review) · ${t("runs.review", { verdict: t("review.verdict.rejected") })}`);
    });
  }
});
