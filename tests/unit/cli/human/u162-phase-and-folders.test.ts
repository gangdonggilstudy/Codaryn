/**
 * U-162 (PM), the human renderer's part of U-158:
 * - AXM-8: a run without a result says its phase in the runs table: runs.running, runs.no_result,
 *   and runs.incomplete as before when the entry has no phase. A run with a result is as before.
 * - GT-D14: the apply summary tells how many folders the actions left without files (kept in
 *   place), summary.folders_left_empty, right after the actions list; none when the result has no
 *   count, or a count below 1.
 * Both languages with the real catalog (nb-i18n's texts). Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_LANGUAGES, toRunId } from "../../../../src/contracts/index.js";
import type { ApplyResult, CatalogText, RunId, RunListEntry, RunsOutput } from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const STARTED = "2026-11-13T05:05:05.000Z";
const RUN = toRunId("20261113T050505Z-0a1b2c3d") as RunId;
const PLAN = toRunId("20261113T050500Z-0a1b2c3e") as RunId;
const entry = (extra: Record<string, unknown>): RunListEntry =>
  ({ state: "checked", runId: RUN, kind: "run", startedAt: STARTED, taskId: "t", status: null, reason: null, changes: null, reverted: null, revertRecordDamaged: false, ...extra }) as unknown as RunListEntry;
const listing = (run: RunListEntry): RunsOutput => ({ schemaVersion: 1, kind: "runs", status: "listed", exitCode: 0, runs: [run], omitted: 0 }) as unknown as RunsOutput;
const applied = [
  { index: 0, action: { kind: "move", from: "inbox/a.jpg", to: "photos/a.jpg" } },
  { index: 1, action: { kind: "discard", path: "inbox/b.tmp" } },
];
const applyResult = (extra: Record<string, unknown> = {}): ApplyResult =>
  ({
    schemaVersion: 1, kind: "apply", runId: RUN, planRunId: PLAN, taskId: "t", digest: "a".repeat(64), status: "done", reason: "verified", exitCode: 0,
    applied, verifiers: [{ id: "inventory", kind: "inventory", outcome: "pass", evidence: "", checked: [], limits: [] }],
    usage: { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 5 }, journalPath: "x", notices: [], protectedChanged: [], ...extra,
  }) as unknown as ApplyResult;

for (const language of MESSAGE_LANGUAGES) {
  const catalog = createMessageCatalog(language);
  const t = catalog.format as (id: string, ...rest: unknown[]) => CatalogText;
  const resultOf = (run: RunListEntry): string => (createHumanOutput(catalog).runsText(listing(run)).trimEnd().split("\n")[1] ?? "").split(/ {2,}/)[3] ?? "";
  const summaryOf = (result: ApplyResult): string[] => createHumanOutput(catalog).applySummary?.(result, { workspaceForm: "task" }).trimEnd().split("\n") ?? [];

  describe(`U-162 (${language}): a run without a result says its phase`, () => {
    test("running, stopped without a result, and as before without a phase", () => {
      assert.equal(resultOf(entry({ phase: "running" })), t("runs.running"));
      assert.equal(resultOf(entry({ phase: "no_result" })), t("runs.no_result"));
      assert.equal(resultOf(entry({})), t("runs.incomplete"));
      assert.equal(resultOf(entry({ phase: "made_up" })), t("runs.incomplete"));
    });

    test("a run with a result is as before, whatever its phase", () => {
      const done = `${t("status.done")} (done/verified)`;
      for (const phase of ["finished", undefined]) assert.equal(resultOf(entry({ status: "done", reason: "verified", changes: 1, phase })), done);
    });
  });

  describe(`U-162 (${language}): the apply summary tells the folders left without files`, () => {
    test("right after the actions list, before the plan run line", () => {
      const lines = summaryOf(applyResult({ foldersLeftEmpty: 2 }));
      const at = lines.indexOf(t("summary.folders_left_empty", { count: 2 }));
      assert.ok(at > 0, lines.join("\n"));
      assert.ok(lines[at - 1]?.startsWith("  "), "the line before it is the last action");
      assert.equal(lines[at + 1], t("summary.apply_plan_run", { runId: PLAN }));
    });

    test("no count, 0, or not a whole number: no line; the summary as without the field", () => {
      const without = summaryOf(applyResult());
      for (const foldersLeftEmpty of [0, -1, 1.5, "2", null]) assert.deepEqual(summaryOf(applyResult({ foldersLeftEmpty })), without, String(foldersLeftEmpty));
    });
  });
}
