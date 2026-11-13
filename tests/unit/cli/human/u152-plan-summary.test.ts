/**
 * U-152 (AXM-15, the CLI's part; the contract and engine parts are closed, U-59): a plan run's end
 * summary said "A plan is ready" without the agent's description of the plan, which the result carries
 * (EngineResult.planSummary) and the plan view shows. Now runSummary shows it where another run shows
 * its last message (after the facts, before the advice): under the plan view's label
 * (plan.summary_label) as quoted rows, folded as the plan view folds them. Not for a run that is not a
 * plan run, nor without the text; a plan run's final message is still not shown. No new text id.
 * Both languages with the real catalog. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_LANGUAGES, toRunId } from "../../../../src/contracts/index.js";
import type { CatalogText, EngineResult, RunId, RunSummaryContext } from "../../../../src/contracts/index.js";
import { FINAL_MESSAGE_MAX_LINES, MODEL_TEXT_PREFIX, createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const RUN = toRunId("20261113T060606Z-0a1b2c3d") as RunId;
const SUMMARY = "inbox 파일을 종류별 폴더로 옮기고 중복과 임시 파일을 버린다";
const planRun = (extra: Record<string, unknown> = {}): EngineResult =>
  ({
    schemaVersion: 1, kind: "run", runId: RUN, taskId: "t", status: "needs-input", reason: "plan_pending", exitCode: 3, provider: "scripted",
    verifiers: [], changes: [], usage: { modelTurns: 2, toolCalls: 2, inputTokens: 0, outputTokens: 0, durationMs: 100 }, journalPath: "x", notices: [], protectedChanged: [],
    plan: { digest: "b".repeat(64), actions: 7 }, planSummary: SUMMARY, ...extra,
  }) as unknown as EngineResult;
const doneRun = (extra: Record<string, unknown> = {}): EngineResult =>
  ({ ...(planRun() as unknown as Record<string, unknown>), status: "done", reason: "verified", exitCode: 0, plan: undefined, ...extra }) as unknown as EngineResult;
const context = { workspaceForm: "task", configDefault: null, profileApplied: false, deniedToolCalls: 0, deniedCommandCalls: 0, failedToolCalls: 0, policySource: "task" } as unknown as RunSummaryContext;

for (const language of MESSAGE_LANGUAGES) {
  const catalog = createMessageCatalog(language);
  const t = catalog.format as (id: string, ...rest: unknown[]) => CatalogText;
  const label = `${t("plan.summary_label")}:`;
  const linesOf = (result: EngineResult): string[] => createHumanOutput(catalog).runSummary(result, context).trimEnd().split("\n");

  describe(`U-152 (${language}): a plan run's end summary shows the agent's description of the plan`, () => {
    test("under the plan view's label, a quoted row, after the facts and before the advice", () => {
      const lines = linesOf(planRun());
      const at = lines.indexOf(label);
      assert.ok(at > 0, lines.join("\n"));
      assert.equal(lines[at + 1], `${MODEL_TEXT_PREFIX}${SUMMARY}`);
      assert.ok(lines.indexOf(t("summary.plan_ready", { actions: 7 })) < at, "after the plan-ready fact");
      assert.equal(lines[at + 2], t("advice.plan_pending"), "right before the advice");
    });

    test("a long description is folded into at most FINAL_MESSAGE_MAX_LINES quoted rows", () => {
      const long = Array.from({ length: 60 }, (_, index) => `word${index}`).join(" ").repeat(4);
      const lines = linesOf(planRun({ planSummary: long }));
      const at = lines.indexOf(label);
      const rows = lines.slice(at + 1).filter((line) => line.startsWith(MODEL_TEXT_PREFIX));
      assert.ok(rows.length >= 2 && rows.length <= FINAL_MESSAGE_MAX_LINES, String(rows.length));
    });

    test("no description, an empty one, or one that is not text: no label", () => {
      for (const planSummary of [undefined, "", 7]) assert.equal(linesOf(planRun({ planSummary })).includes(label), false, String(planSummary));
    });

    test("not for a run that is not a plan run; a plan run's final message is still not shown", () => {
      assert.equal(linesOf(doneRun()).includes(label), false);
      const withFinal = linesOf(planRun({ finalMessage: { text: "the model's last words", truncated: false } }));
      assert.equal(withFinal.includes(`${t("summary.final_message")}:`), false);
      assert.ok(withFinal.includes(label));
    });
  });
}
