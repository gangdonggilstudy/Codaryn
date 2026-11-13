/**
 * U-146 (UXM-18, PM), the human renderer's part of U-140: what a task type's own rules left out of
 * the given policy and checks was said only at the end of the start line, which is easy to pass
 * over. The end summary now tells it once more from RunSummaryContext.policyNarrowings (na-core's run
 * fills it): one line per narrowing, in their order, with the start line's texts
 * (progress.workflow_policy.<kind>, with the count where the kind has one), right after the checks
 * lines. Absent or empty: no line. Entries the start line leaves out (an unknown kind, a count below
 * 1) are left out here too. Both languages with the real catalog. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_LANGUAGES, toRunId } from "../../../../src/contracts/index.js";
import type { CatalogText, EngineResult, JournalEvent, RunId, RunSummaryContext } from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const RUN = toRunId("20261113T050505Z-0a1b2c3d") as RunId;
const NARROWINGS = [
  { kind: "commands_dropped", count: 2 },
  { kind: "restore_path_tokens_off" },
  { kind: "verifiers_dropped", count: 1 },
  { kind: "plan_actions_dropped", count: 3 },
  { kind: "commands_narrowed", count: 1 },
];
const result = {
  schemaVersion: 1, kind: "run", runId: RUN, taskId: "t", status: "done", reason: "verified", exitCode: 0, provider: "scripted",
  verifiers: [{ id: "v", kind: "file_rules", outcome: "pass", evidence: "", checked: [], limits: [] }], changes: [],
  usage: { modelTurns: 2, toolCalls: 1, inputTokens: 10, outputTokens: 5, durationMs: 100 }, journalPath: "x", notices: [], protectedChanged: [],
} as unknown as EngineResult;
const context = (extra: Record<string, unknown>): RunSummaryContext =>
  ({ workspaceForm: "current", configDefault: null, profileApplied: false, deniedToolCalls: 0, deniedCommandCalls: 0, failedToolCalls: 0, policySource: "config", ...extra }) as unknown as RunSummaryContext;
const started = (policyNarrowings: unknown): JournalEvent =>
  ({ type: "run_started", schemaVersion: 1, taskId: "t", workflow: "code", provider: "scripted", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 }, policyNarrowings }) as unknown as JournalEvent;

for (const language of MESSAGE_LANGUAGES) {
  const catalog = createMessageCatalog(language);
  const t = catalog.format as (id: string, ...rest: unknown[]) => CatalogText;
  const texts = (given: readonly Record<string, unknown>[]): string[] =>
    given.map((item) => (item["kind"] === "restore_path_tokens_off" ? t("progress.workflow_policy.restore_path_tokens_off") : t(`progress.workflow_policy.${String(item["kind"])}`, { count: item["count"] })));
  const summaryOf = (extra: Record<string, unknown>): string[] => createHumanOutput(catalog).runSummary(result, context(extra)).trimEnd().split("\n");

  describe(`U-146 (${language}): the end summary repeats the policy narrowings`, () => {
    test("one line each, in their order, with the start line's texts, right after the checks lines", () => {
      const lines = summaryOf({ policyNarrowings: NARROWINGS });
      const expected = texts(NARROWINGS);
      const at = lines.indexOf(expected[0] as string);
      assert.deepEqual(lines.slice(at, at + expected.length), expected, lines.join("\n"));
      assert.equal(lines[at - 1], t("summary.verifiers", { passed: 1, total: 1 }), "right after the checks line");
      assert.equal(lines[at + expected.length], t("summary.changes", { count: 0 }), "before the files changed line");
    });

    test("the same texts as the start line, which joins them to itself", () => {
      const start = createHumanOutput(catalog).progressLine(started(NARROWINGS)) ?? "";
      assert.equal(start, [t("progress.run_started", { provider: "scripted" }), ...texts(NARROWINGS)].join(" · "));
    });

    test("absent or empty: no line; the summary is the one without the field", () => {
      const without = summaryOf({});
      assert.deepEqual(summaryOf({ policyNarrowings: [] }), without);
      for (const text of texts(NARROWINGS)) assert.equal(without.includes(text), false);
    });

    test("an entry the start line leaves out is left out here too", () => {
      const odd = [{ kind: "made_up", count: 1 }, { kind: "commands_dropped", count: 0 }, { kind: "commands_dropped", count: 1.5 }, null, "x", { kind: "commands_dropped" }, { kind: "commands_dropped", count: 4 }];
      const lines = summaryOf({ policyNarrowings: odd });
      const shown = texts([{ kind: "commands_dropped", count: 4 }]);
      assert.deepEqual(lines.filter((line) => line.startsWith(t("progress.workflow_policy.commands_dropped", { count: 4 }).slice(0, 6))), shown, lines.join("\n"));
      assert.equal(createHumanOutput(catalog).progressLine(started(odd)), [t("progress.run_started", { provider: "scripted" }), ...shown].join(" · "));
      assert.deepEqual(summaryOf({ policyNarrowings: "x" }), summaryOf({}));
    });
  });
}
