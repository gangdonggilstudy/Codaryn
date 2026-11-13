/**
 * U-207 (P1 bundle A, DR-70; contract U-197): the human output of private data tasks, before A-5 and
 * A-6 carry them out. Drafts in both languages (nb-i18n is blocked).
 * - A query_table result that succeeded has a progress line of what was asked only: the operation
 *   kinds (codes, in parentheses) and how many columns it grouped by, or that the shape was asked. No
 *   path, column name, group key, row count or aggregate of the table reaches it (queryTableFacts reads
 *   nothing else).
 * - The end summary: the calls refused at a path this task may not read (RunSummaryContext.
 *   deniedUnreadable) with once what a person can do, and the table results that left out groups of
 *   fewer than k rows (RunSummaryContext.hiddenGroups), counts only. Drafts for na-core.
 * - analyze-private's checklist item (P-3, PRIVATE_REVIEW_ITEM) in the chosen language; every other
 *   entry as recorded, as before.
 * Absent fields and other results: every output as before. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ALL_TOOL_NAMES, MESSAGE_LANGUAGES, PRIVATE_REVIEW_ITEM, toRunId } from "../../../../src/contracts/index.js";
import type { CatalogText, EngineResult, JournalEvent, RunId, RunSummaryContext } from "../../../../src/contracts/index.js";
import { builtinReviewItemText, createHumanOutput, queryTableFacts } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const RUN = toRunId("20261113T180000Z-0a1b2c3d") as RunId;
// Values that must never reach a line: a path, column names, group keys, row counts and aggregates.
const TABLE_TEXT = ["people/salaries.csv", "region", "salary", "Seoul-Gangnam", "Busan-Haeundae", "98765.4321", "424242"];
const GROUPS_PAYLOAD = {
  kind: "groups",
  groupBy: ["region"],
  operations: [{ op: "sum", column: "salary" }, { op: "count", column: "salary" }, { op: "sum", column: "bonus" }],
  groups: [
    { keys: ["Seoul-Gangnam"], rows: 424242, values: [98765.4321, 424242, 1] },
    { keys: ["Busan-Haeundae"], rows: 7, values: [12, 7, 2] },
  ],
  suppressedGroups: 3,
  next: "g2",
  minGroupSize: 5,
};
const resultRecord = (payload: unknown, extra: Record<string, unknown> = {}): JournalEvent =>
  ({ type: "tool_result", result: { callId: "c1", tool: "query_table", ok: true, content: JSON.stringify(payload), errorCode: null, ...extra } }) as unknown as JournalEvent;
const result = (extra: Record<string, unknown> = {}): EngineResult =>
  ({
    schemaVersion: 1, kind: "run", runId: RUN, taskId: "t", status: "done", reason: "verified", exitCode: 0, provider: "scripted",
    verifiers: [], changes: [], usage: { modelTurns: 2, toolCalls: 3, inputTokens: 10, outputTokens: 5, durationMs: 100 }, journalPath: "x", notices: [], protectedChanged: [],
    ...extra,
  }) as unknown as EngineResult;
const context = (extra: Record<string, unknown> = {}): RunSummaryContext =>
  ({ workspaceForm: "current", configDefault: null, profileApplied: false, deniedToolCalls: 0, deniedCommandCalls: 0, failedToolCalls: 0, policySource: "config", ...extra }) as unknown as RunSummaryContext;

describe("U-207: queryTableFacts reads what was asked and two counts, nothing of the table", () => {
  test("groups: the operation kinds once each in order, the group columns, the hidden groups and k", () => {
    const facts = queryTableFacts((resultRecord(GROUPS_PAYLOAD) as unknown as { result: unknown }).result);
    assert.deepEqual(facts, { kind: "groups", operations: ["sum", "count"], groupColumns: 1, suppressedGroups: 3, minGroupSize: 5 });
    for (const text of TABLE_TEXT) assert.ok(!JSON.stringify(facts).includes(text), text);
  });

  test("describe: that the shape was asked", () => {
    const facts = queryTableFacts({ tool: "query_table", ok: true, content: JSON.stringify({ kind: "describe", columns: [{ name: "salary", nonEmpty: 9, numeric: 9 }], rows: 9, minGroupSize: 5 }) });
    assert.deepEqual(facts, { kind: "describe" });
  });

  test("anything else: null (another tool, a failure, an unknown operation, too many group columns, bad counts, not JSON)", () => {
    const base = { tool: "query_table", ok: true, content: JSON.stringify(GROUPS_PAYLOAD) };
    const bad: unknown[] = [
      null,
      { ...base, tool: "read_file" },
      { ...base, ok: false },
      { ...base, content: "error (invalid_table): not_table at line 3" },
      { ...base, content: JSON.stringify({ ...GROUPS_PAYLOAD, operations: [{ op: "median", column: "salary" }] }) },
      { ...base, content: JSON.stringify({ ...GROUPS_PAYLOAD, operations: [] }) },
      { ...base, content: JSON.stringify({ ...GROUPS_PAYLOAD, groupBy: ["a", "b", "c"] }) },
      { ...base, content: JSON.stringify({ ...GROUPS_PAYLOAD, suppressedGroups: -1 }) },
      { ...base, content: JSON.stringify({ ...GROUPS_PAYLOAD, minGroupSize: 0 }) },
      { ...base, content: JSON.stringify({ ...GROUPS_PAYLOAD, kind: "rows" }) },
    ];
    for (const item of bad) assert.equal(queryTableFacts(item), null, JSON.stringify(item).slice(0, 80));
  });
});

for (const language of MESSAGE_LANGUAGES) {
  const catalog = createMessageCatalog(language);
  const t = catalog.format as (id: string, ...rest: unknown[]) => CatalogText;
  const lineOf = (event: JournalEvent): string | null => createHumanOutput(catalog).progressLine(event);
  const summaryOf = (res: EngineResult, ctx: RunSummaryContext): string[] => createHumanOutput(catalog).runSummary(res, ctx).trimEnd().split("\n");

  describe(`U-207 (${language}): the query_table progress line`, () => {
    test("grouped: the words with the group column count, the operation codes in parentheses; nothing of the table", () => {
      const line = lineOf(resultRecord(GROUPS_PAYLOAD));
      assert.equal(line, `${t("progress.query_table", { groupColumns: 1 })} (sum, count)`);
      for (const text of TABLE_TEXT) assert.ok(!String(line).includes(text), `${text} in ${line}`);
    });

    test("the whole table, and describe", () => {
      assert.equal(lineOf(resultRecord({ ...GROUPS_PAYLOAD, groupBy: [], operations: [{ op: "mean", column: "salary" }] })), `${t("progress.query_table_whole")} (mean)`);
      assert.equal(lineOf(resultRecord({ kind: "describe", columns: [{ name: "salary", nonEmpty: 9, numeric: 9 }], rows: 9, minGroupSize: 5 })), t("progress.query_table_describe"));
    });

    test("a failed query keeps its failure line; another tool's result that succeeded has none, as before", () => {
      const failed = { type: "tool_result", result: { callId: "c2", tool: "query_table", ok: false, content: "error (invalid_table): x", errorCode: "invalid_table" } } as unknown as JournalEvent;
      // The tool's own word once A-5 adds query_table to ALL_TOOL_NAMES; until then the unknown tool's.
      const word = (ALL_TOOL_NAMES as readonly string[]).includes("query_table") ? t("tool.query_table") : t("progress.unknown_tool");
      assert.equal(lineOf(failed), t("progress.tool_failed", { tool: word, code: "invalid_table" }));
      const read = { type: "tool_result", result: { callId: "c3", tool: "read_file", ok: true, content: "{}", errorCode: null } } as unknown as JournalEvent;
      assert.equal(lineOf(read), null);
    });
  });

  describe(`U-207 (${language}): the end summary`, () => {
    test("calls refused at an unreadable path: the count right after the denied calls, then what a person can do", () => {
      const lines = summaryOf(result(), context({ deniedToolCalls: 4, deniedUnreadable: 2 }));
      const at = lines.indexOf(t("summary.denied", { count: 4 }));
      assert.ok(at > 0, lines.join("\n"));
      assert.deepEqual(lines.slice(at + 1, at + 3), [t("summary.denied_unreadable", { count: 2 }), t("summary.denied_unreadable_hint")]);
    });

    test("groups hidden for fewer than k rows: one line with the number of results and k, before the usage", () => {
      const lines = summaryOf(result(), context({ hiddenGroups: { results: 3, minGroupSize: 5 } }));
      const at = lines.indexOf(t("summary.groups_hidden", { results: 3, k: 5 }));
      assert.ok(at > 0, lines.join("\n"));
      assert.equal(lines[at + 1], t("summary.usage", { turns: 2, toolCalls: 3, seconds: 0.1 }));
    });

    test("absent, 0 or not counts: no line, and the summary is the one without the fields", () => {
      const without = summaryOf(result(), context({ deniedToolCalls: 1 }));
      for (const extra of [{ deniedUnreadable: 0 }, { deniedUnreadable: "2" }, { hiddenGroups: { results: 0, minGroupSize: 5 } }, { hiddenGroups: { results: 2 } }, { hiddenGroups: null }]) {
        assert.deepEqual(summaryOf(result(), context({ deniedToolCalls: 1, ...extra })), without, JSON.stringify(extra));
      }
    });
  });

  describe(`U-207 (${language}): analyze-private's checklist item (P-3)`, () => {
    test("in the chosen language; the other items as recorded", () => {
      const checklist = ["The report's interpretation matches the result table.", PRIVATE_REVIEW_ITEM];
      const lines = summaryOf(result({ status: "needs-input", reason: "awaiting_review", exitCode: 3, review: { checklist } }), context());
      assert.ok(lines.includes(`  - ${checklist[0]}`), lines.join("\n"));
      assert.ok(lines.includes(`  - ${t("review.item.no_identifying_values")}`), lines.join("\n"));
      assert.equal(builtinReviewItemText(PRIVATE_REVIEW_ITEM, catalog), t("review.item.no_identifying_values"));
      assert.equal(builtinReviewItemText(checklist[0], catalog), null);
    });
  });
}
