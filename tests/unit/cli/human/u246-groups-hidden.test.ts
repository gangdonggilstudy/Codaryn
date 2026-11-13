/**
 * U-246 (review R-110 L-2): the end summary's hidden-groups line, with its new last sentence, where it
 * was: after the denied lines, k and the number of results as the context gives them, no key or value.
 * A result that left out only a value counts as U-210 made it (RunSummaryContext.hiddenGroups). Both
 * languages with the real catalog. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MESSAGE_LANGUAGES, toRunId } from "../../../../src/contracts/index.js";
import type { CatalogText, EngineResult, RunId, RunSummaryContext } from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const RUN = toRunId("20261113T150000Z-0a1b2c3d") as RunId;
const result = {
  schemaVersion: 1, kind: "run", runId: RUN, taskId: "t", status: "needs-input", reason: "awaiting_review", exitCode: 3, provider: "scripted",
  verifiers: [], changes: [], usage: { modelTurns: 3, toolCalls: 3, inputTokens: 1, outputTokens: 1, durationMs: 100 }, journalPath: "x", notices: [],
} as unknown as EngineResult;
const context = (extra: Record<string, unknown> = {}): RunSummaryContext =>
  ({ workspaceForm: "task", configDefault: null, profileApplied: false, deniedToolCalls: 0, deniedCommandCalls: 0, failedToolCalls: 0, policySource: "task", ...extra }) as unknown as RunSummaryContext;

for (const language of MESSAGE_LANGUAGES) {
  const catalog = createMessageCatalog(language);
  const t = catalog.format as (id: string, params?: object) => CatalogText;

  describe(`U-246 (${language}): the hidden-groups line`, () => {
    test("after the refused-at-unreadable lines, with k and the number of results; it says the agent got no value", () => {
      const lines = createHumanOutput(catalog)
        .runSummary(result, context({ deniedToolCalls: 2, deniedUnreadable: 2, hiddenGroups: { results: 3, minGroupSize: 6 } }))
        .trimEnd()
        .split("\n");
      const at = lines.indexOf(t("summary.groups_hidden", { results: 3, k: 6 }));
      assert.ok(at > lines.indexOf(t("summary.denied_unreadable_hint")), lines.join("\n"));
      const line = lines[at] ?? "";
      assert.ok(line.includes(language === "en" ? "neither those groups nor those values" : "그 묶음과 값을 받지 않았고"), line);
    });

    test("no hiddenGroups: no such line", () => {
      const text = createHumanOutput(catalog).runSummary(result, context());
      assert.equal(text.includes(t("summary.groups_hidden", { results: 1, k: 5 }).slice(0, 12)), false, text);
    });
  });
}
