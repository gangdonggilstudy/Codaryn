/**
 * U-201 (U-176, U-193): a command that finished but could not release the workspace lock says so with
 * `lock.release_failed` (no path; doctor's lock line names the file). The run, apply and revert
 * summaries say it right before their next commands when their context's `lockLeft` is true (drafts for
 * na-core, which fills them); lockReleaseFailedLine gives the same line for the cleanup's text and
 * anything else that has a CleanupOutcome.lockLeft. Absent or false: no line, every summary as before.
 * Both languages with the real catalog. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MESSAGE_LANGUAGES, toRunId } from "../../../../src/contracts/index.js";
import type { ApplyResult, ApplySummaryContext, CatalogText, EngineResult, RevertOutput, RunId, RunSummaryContext } from "../../../../src/contracts/index.js";
import { createHumanOutput, lockReleaseFailedLine } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const RUN = toRunId("20261113T150000Z-0a1b2c3d") as RunId;
const PLAN = toRunId("20261113T140000Z-11111111") as RunId;
const result = {
  schemaVersion: 1, kind: "run", runId: RUN, taskId: "t", status: "done", reason: "verified", exitCode: 0, provider: "scripted",
  verifiers: [], changes: [{ path: "notes.md", previousHash: null, newHash: "b".repeat(64), created: true }],
  usage: { modelTurns: 2, toolCalls: 1, inputTokens: 10, outputTokens: 5, durationMs: 100 }, journalPath: "x", notices: [], protectedChanged: [],
} as unknown as EngineResult;
const runContext = (extra: Record<string, unknown> = {}): RunSummaryContext =>
  ({ workspaceForm: "current", configDefault: null, profileApplied: false, deniedToolCalls: 0, deniedCommandCalls: 0, failedToolCalls: 0, policySource: "config", ...extra }) as unknown as RunSummaryContext;
const applyResult = {
  schemaVersion: 1, kind: "apply", runId: RUN, planRunId: PLAN, taskId: "t", digest: "d".repeat(64), status: "done", reason: "verified", exitCode: 0,
  applied: [{ index: 0, action: { kind: "move", from: "a.txt", to: "b.txt", sha256: "a".repeat(64) }, stored: null }], verifiers: [],
  usage: { modelTurns: 0, toolCalls: 0, inputTokens: null, outputTokens: null, durationMs: 10 }, journalPath: "x", notices: [],
} as unknown as ApplyResult;
const revertOutput = {
  schemaVersion: 1, kind: "revert", runId: RUN, status: "reverted", exitCode: 0, reverted: [{ path: "notes.md", action: "deleted" }], skipped: [],
} as unknown as RevertOutput;

for (const language of MESSAGE_LANGUAGES) {
  const catalog = createMessageCatalog(language);
  const t = catalog.format as (id: string, ...rest: unknown[]) => CatalogText;
  const line = t("lock.release_failed");
  const split = (text: string): string[] => text.trimEnd().split("\n");

  describe(`U-201 (${language}): lock.release_failed in the end summaries`, () => {
    test("run: right after the advice, before the next commands; the rest as without it", () => {
      const left = split(createHumanOutput(catalog).runSummary(result, runContext({ lockLeft: true })));
      const plain = split(createHumanOutput(catalog).runSummary(result, runContext()));
      const at = left.indexOf(line);
      assert.equal(left[at - 1], t("advice.verified"), left.join("\n"));
      assert.equal(left[at + 1], t("summary.run_id", { runId: RUN }));
      assert.deepEqual([...left.slice(0, at), ...left.slice(at + 1)], plain);
    });

    test("apply: after its facts and notices, before the next commands", () => {
      const context = (extra: Record<string, unknown> = {}): ApplySummaryContext => ({ workspaceForm: "current", ...extra }) as ApplySummaryContext;
      const left = split(createHumanOutput(catalog).applySummary?.(applyResult, context({ lockLeft: true })) ?? "");
      const plain = split(createHumanOutput(catalog).applySummary?.(applyResult, context()) ?? "");
      const at = left.indexOf(line);
      assert.equal(left[at - 1], t("advice.verified"), left.join("\n"));
      assert.equal(left[at + 1], t("summary.run_id", { runId: RUN }));
      assert.deepEqual([...left.slice(0, at), ...left.slice(at + 1)], plain);
    });

    test("revert: after its lists, the last line here", () => {
      const left = split(createHumanOutput(catalog).revertSummary(revertOutput, { lockLeft: true }));
      const plain = split(createHumanOutput(catalog).revertSummary(revertOutput));
      assert.equal(left.at(-1), line);
      assert.deepEqual(left.slice(0, -1), plain);
    });

    test("absent, false or not true: no line in any of them", () => {
      for (const lockLeft of [undefined, false, "true", 1]) {
        assert.deepEqual(createHumanOutput(catalog).runSummary(result, runContext({ lockLeft })), createHumanOutput(catalog).runSummary(result, runContext()), String(lockLeft));
        assert.deepEqual(createHumanOutput(catalog).revertSummary(revertOutput, { lockLeft } as never), createHumanOutput(catalog).revertSummary(revertOutput), String(lockLeft));
      }
    });

    test("lockReleaseFailedLine: the line for true only (for the cleanup's text)", () => {
      assert.equal(lockReleaseFailedLine(true, catalog), line);
      for (const value of [undefined, false, null, "true", 1]) assert.equal(lockReleaseFailedLine(value, catalog), null, String(value));
    });
  });
}
