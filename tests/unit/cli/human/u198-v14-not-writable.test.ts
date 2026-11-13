/**
 * U-198 (Codex V-14 L-1, the renderer's part): the end summary of a run tells the writes refused as
 * path_not_writable apart by why, each with its own advice:
 * - RunSummaryContext.deniedNotPlanned: not one of the files the carried-out plan approved; to change
 *   others, make a new plan that names them and approve it (never "add it to writablePaths");
 * - RunSummaryContext.deniedNotWritable: outside the settings' writablePaths; add the file to every list.
 * Both right after the denied calls, the plan's first. Absent: no line, the summary as without them.
 * Drafts for na-core (U-195), which passes the counts. Both languages with the real catalog. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MESSAGE_LANGUAGES, toRunId } from "../../../../src/contracts/index.js";
import type { CatalogText, ContentHash, EngineResult, RunId, RunSummaryContext } from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const RUN = toRunId("20261113T190000Z-0a1b2c3d") as RunId;
const PLAN = toRunId("20261113T180000Z-11111111") as RunId;
const carried = {
  schemaVersion: 1, kind: "run", runId: RUN, taskId: "t", status: "done", reason: "verified", exitCode: 0, provider: "scripted",
  verifiers: [], changes: [], usage: { modelTurns: 2, toolCalls: 4, inputTokens: 10, outputTokens: 5, durationMs: 100 }, journalPath: "x", notices: [], protectedChanged: [],
  planRunId: PLAN, planDigest: "d".repeat(64) as ContentHash,
} as unknown as EngineResult;
const context = (extra: Record<string, unknown> = {}): RunSummaryContext =>
  ({ workspaceForm: "current", configDefault: null, profileApplied: false, deniedToolCalls: 0, deniedCommandCalls: 0, failedToolCalls: 0, policySource: "config", ...extra }) as unknown as RunSummaryContext;

for (const language of MESSAGE_LANGUAGES) {
  const catalog = createMessageCatalog(language);
  const t = catalog.format as (id: string, ...rest: unknown[]) => CatalogText;
  const summaryOf = (ctx: RunSummaryContext): string[] => createHumanOutput(catalog).runSummary(carried, ctx).trimEnd().split("\n");
  const afterDenied = (lines: string[], denied: number): string[] => lines.slice(lines.indexOf(t("summary.denied", { count: denied })) + 1);

  describe(`U-198 V-14 L-1 (${language}): writes refused as not writable, by why`, () => {
    test("not one of the plan's files: its count, then make a new plan - not writablePaths", () => {
      const lines = afterDenied(summaryOf(context({ deniedToolCalls: 3, deniedNotPlanned: 3 })), 3);
      assert.deepEqual(lines.slice(0, 2), [t("summary.denied_not_planned", { count: 3 }), t("summary.denied_not_planned_hint")]);
      const all = lines.join("\n");
      assert.ok(!all.includes(t("summary.denied_not_writable_hint")), "no writablePaths advice for a write outside the plan");
    });

    test("outside the settings' writablePaths: its count, then add the file to every list", () => {
      const lines = afterDenied(summaryOf(context({ deniedToolCalls: 2, deniedNotWritable: 2 })), 2);
      assert.deepEqual(lines.slice(0, 2), [t("summary.denied_not_writable", { count: 2 }), t("summary.denied_not_writable_hint")]);
    });

    test("both: the plan's first, each with its own advice", () => {
      const lines = afterDenied(summaryOf(context({ deniedToolCalls: 5, deniedNotPlanned: 3, deniedNotWritable: 2 })), 5);
      assert.deepEqual(lines.slice(0, 4), [
        t("summary.denied_not_planned", { count: 3 }),
        t("summary.denied_not_planned_hint"),
        t("summary.denied_not_writable", { count: 2 }),
        t("summary.denied_not_writable_hint"),
      ]);
    });

    test("absent, 0 or not counts: no line, and the summary is the one without the fields", () => {
      const without = summaryOf(context({ deniedToolCalls: 1 }));
      for (const extra of [{ deniedNotPlanned: 0 }, { deniedNotWritable: 0 }, { deniedNotPlanned: "1" }, { deniedNotWritable: -1 }]) {
        assert.deepEqual(summaryOf(context({ deniedToolCalls: 1, ...extra })), without, JSON.stringify(extra));
      }
    });
  });
}

describe("U-198 V-14 L-1: the drafts say what the PM asked", () => {
  test("English and Korean", () => {
    const en = createMessageCatalog("en");
    const ko = createMessageCatalog("ko");
    assert.equal(en.format("summary.denied_not_planned", { count: 2 }), "Writes denied because the file is not in the approved plan: 2");
    assert.equal(en.format("summary.denied_not_planned_hint"), "To change other files, make a new plan that names them and approve it.");
    assert.equal(en.format("summary.denied_not_writable", { count: 2 }), "Writes denied because the file is not in writablePaths: 2");
    assert.equal(ko.format("summary.denied_not_planned", { count: 2 }), "승인한 계획에 없는 파일이라 거부된 쓰기: 2건");
    assert.equal(ko.format("summary.denied_not_planned_hint"), "다른 파일을 바꾸려면 그 파일을 담은 새 계획을 만들어 승인하세요.");
    assert.equal(ko.format("summary.denied_not_writable", { count: 2 }), "writablePaths에 없는 파일이라 거부된 쓰기: 2건");
  });
});
