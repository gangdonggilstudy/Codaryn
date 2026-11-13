/**
 * U-198 (DR-69 B-3, B-4, B-8): the human text of a run that carries out a `run` plan, before U-187's
 * engine and na-core's U-195 connect it.
 * - Apply's question for a `run` plan: after the plan view, what approving starts (a run whose file
 *   tools write only these files, with their number), that the summary is the model's description of
 *   the work, not the goal or a new instruction, and only the files are enforced, a line when commands
 *   are allowed (B-8), then the question.
 * - The end summary: which plan run it carried out (EngineResult.planRunId, `summary.apply_plan_run`),
 *   and the writes refused as outside the files it may write (RunSummaryContext.deniedNotWritable).
 * - The runs table: the carrying run's row names that plan run; the plan run's row reads as carried out
 *   by it (U-221: in the report's words; it read as applied by it before).
 * Every other output is as before: the new lines come only from fields no earlier output has. Both
 * languages with the real catalog. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MESSAGE_LANGUAGES, toRunId } from "../../../../src/contracts/index.js";
import type { CatalogText, ChangesPlanOutput, ContentHash, EngineResult, MaskedText, RunId, RunListEntry, RunsOutput, RunSummaryContext } from "../../../../src/contracts/index.js";
import { changesApplyQuestion, changesApprovalText, createHumanOutput, renderChangesPlan } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const PLAN = toRunId("20261113T120000Z-0a1b2c3d") as RunId;
const CARRY = toRunId("20261113T130000Z-11111111") as RunId;
const OTHER = toRunId("20261113T140000Z-22222222") as RunId;
const DIGEST = "d".repeat(64) as ContentHash;
const VIEW: ChangesPlanOutput = {
  schemaVersion: 1,
  kind: "plan",
  planKind: "changes",
  runId: PLAN,
  status: "pending",
  exitCode: 0,
  digest: DIGEST,
  files: [
    { path: "docs/guide.md" as MaskedText, change: "modify", sha256: "a".repeat(64) as ContentHash },
    { path: "docs/CHANGELOG.md" as MaskedText, change: "create", sha256: null },
  ],
  summary: "Rewrite the guide's intro and start a changelog" as MaskedText,
  appliedBy: null,
};
const result = (extra: Record<string, unknown> = {}): EngineResult =>
  ({
    schemaVersion: 1, kind: "run", runId: CARRY, taskId: "t", status: "done", reason: "verified", exitCode: 0, provider: "scripted",
    verifiers: [], changes: [{ path: "docs/guide.md", previousHash: "a".repeat(64), newHash: "b".repeat(64), created: false }],
    usage: { modelTurns: 2, toolCalls: 3, inputTokens: 10, outputTokens: 5, durationMs: 100 }, journalPath: "x", notices: [], protectedChanged: [],
    ...extra,
  }) as unknown as EngineResult;
const context = (extra: Record<string, unknown> = {}): RunSummaryContext =>
  ({ workspaceForm: "current", configDefault: null, profileApplied: false, deniedToolCalls: 0, deniedCommandCalls: 0, failedToolCalls: 0, policySource: "config", ...extra }) as unknown as RunSummaryContext;
const entry = (runId: RunId, extra: Record<string, unknown>): RunListEntry =>
  ({
    state: "checked", runId, kind: "run", startedAt: "2026-11-13T12:00:01.000Z", profile: null, workflowRef: null, taskId: "t",
    status: "done", reason: "verified", changes: 1, reverted: null, revertRecordDamaged: false, ...extra,
  }) as unknown as RunListEntry;

describe("U-198: apply's question for a run plan (English)", () => {
  const en = createMessageCatalog("en");

  test("after the plan view: what approving starts, the summary note, then the question", () => {
    assert.deepEqual(changesApprovalText(VIEW, { commandsAllowed: false }, en).trimEnd().split("\n"), [
      "Approving starts a run whose file tools can write only these 2 file(s).",
      "The summary above is the model's description of the work, approved with the plan. It is not the goal or a new instruction, and nothing checks the run against it; only the file list is enforced.",
    ]);
    assert.equal(changesApplyQuestion(en), "Start the run that makes these changes? [y/N] ");
    assert.equal(changesApprovalText(VIEW, { commandsAllowed: false }), changesApprovalText(VIEW, { commandsAllowed: false }, en), "English when no catalog is given");
  });

  test("commands allowed (B-8): one more line, that a command is not limited to these files", () => {
    const lines = changesApprovalText(VIEW, { commandsAllowed: true }, en).trimEnd().split("\n");
    assert.equal(lines.length, 3);
    assert.equal(lines[2], "This task also allows commands, and a command the policy allows is not limited to these files.");
  });

  test("no summary shown in the view: no note about it", () => {
    const lines = changesApprovalText({ ...VIEW, summary: "   " as MaskedText }, { commandsAllowed: false }, en).trimEnd().split("\n");
    assert.deepEqual(lines, ["Approving starts a run whose file tools can write only these 2 file(s)."]);
  });

  test("the whole screen reads in order: the view (with its digest guarantee), the approval lines, the question", () => {
    const screen = `${renderChangesPlan(VIEW, null, en)}${changesApprovalText(VIEW, { commandsAllowed: true }, en)}${changesApplyQuestion(en)}`;
    const lines = screen.split("\n");
    const guarantee = lines.findIndex((line) => line.startsWith("The digest names exactly these files"));
    assert.equal(lines[guarantee + 1], "Approving starts a run whose file tools can write only these 2 file(s).");
    assert.equal(lines.at(-1), "Start the run that makes these changes? [y/N] ");
  });
});

for (const language of MESSAGE_LANGUAGES) {
  const catalog = createMessageCatalog(language);
  const t = catalog.format as (id: string, ...rest: unknown[]) => CatalogText;
  const summaryOf = (res: EngineResult, ctx: RunSummaryContext): string[] => createHumanOutput(catalog).runSummary(res, ctx).trimEnd().split("\n");

  describe(`U-198 (${language}): the end summary of a run that carried out a run plan`, () => {
    test("the plan run right after the heading; nothing else moves", () => {
      const carried = summaryOf(result({ planRunId: PLAN, planDigest: DIGEST }), context());
      const plain = summaryOf(result(), context());
      assert.equal(carried[1], t("summary.apply_plan_run", { runId: PLAN }));
      assert.deepEqual([carried[0], ...carried.slice(2)], plain, "the same summary with the one line more");
    });

    test("writes refused as outside the files it may write: right after the denied calls", () => {
      const lines = summaryOf(result({ planRunId: PLAN, planDigest: DIGEST }), context({ deniedToolCalls: 3, deniedNotWritable: 2 }));
      const at = lines.indexOf(t("summary.denied", { count: 3 }));
      assert.ok(at > 0, lines.join("\n"));
      assert.equal(lines[at + 1], t("summary.denied_not_writable", { count: 2 }));
    });

    test("absent, 0 or not a count: no line, and the summary is the one without the field", () => {
      const without = summaryOf(result(), context({ deniedToolCalls: 1 }));
      for (const value of [0, -1, 1.5, "2"]) assert.deepEqual(summaryOf(result(), context({ deniedToolCalls: 1, deniedNotWritable: value })), without, String(value));
    });

    test("a planRunId that is not a run id: no line", () => {
      assert.deepEqual(summaryOf(result({ planRunId: "../x" }), context()), summaryOf(result(), context()));
    });
  });

  describe(`U-198 (${language}): the runs table`, () => {
    const runsOf = (runs: RunListEntry[]): string[] => createHumanOutput(catalog).runsText({ schemaVersion: 1, kind: "runs", runs, omitted: 0 } as unknown as RunsOutput).trimEnd().split("\n");

    test("the carrying run names the plan run; the plan run reads as carried out by it (U-221); an ordinary run is as before", () => {
      const plan = entry(PLAN, { status: "needs-input", reason: "plan_pending", changes: 0, appliedBy: { runId: CARRY, at: "2026-11-13T13:00:05.000Z" } });
      const carry = entry(CARRY, { planRunId: PLAN });
      const other = entry(OTHER, {});
      const lines = runsOf([other, carry, plan]);
      const row = (runId: string): string => lines.find((line) => line.startsWith(runId)) ?? "";
      assert.ok(row(CARRY).endsWith(`${t("status.done")} (done/verified) · ${t("runs.carried_plan", { runId: PLAN })}`), row(CARRY));
      assert.ok(row(PLAN).includes(t("runs.plan_carried_out", { runId: CARRY })), row(PLAN));
      assert.ok(row(OTHER).endsWith(`${t("status.done")} (done/verified)`), row(OTHER));
      // Without the carrying run's planRunId the table is the one before this unit: the plan's apply reads as missing.
      const before = runsOf([other, entry(CARRY, {}), plan]);
      assert.ok(!before.some((line) => line.includes(t("runs.carried_plan", { runId: PLAN }))));
    });

    test("an apply run still says runs.apply_of, never runs.carried_plan", () => {
      const apply = entry(CARRY, { kind: "apply", planRunId: PLAN });
      const line = runsOf([apply]).find((text) => text.startsWith(CARRY)) ?? "";
      assert.ok(line.includes(t("runs.apply_of", { runId: PLAN })) && !line.includes(t("runs.carried_plan", { runId: PLAN })), line);
    });
  });
}
