/**
 * U-110 (review R-85 M1, PM: in one board with na-core's terminal question), the human renderer's
 * part. A command whose rule asks first was denied with no line about the question, and the end
 * summary told the person to add a rule (the rule is there; it asks first; a plain rule would let
 * the command run without the question). Now
 * - each `confirmation_answered` has its progress line, the result of the question:
 *   `progress.confirmation_allowed`, or `progress.confirmation_denied.<by>` (the person denied it, no
 *   answer or nobody to ask, or the run was cancelled while it waited). The question itself has no
 *   progress line: at a terminal the CLI asks it on stderr (U-74 contract: then one progress line);
 * - the end summary reads RunSummaryContext.confirmationDenied (na-core's run): a line for each count
 *   above 0, in CONFIRMATION_BY order: `summary.confirm_denied.user`, `.unasked` (this run could not
 *   ask) or `.unanswered` (it could, and no answer came) for `default`, `.cancelled`. The add-a-rule
 *   hint is only for the other denied command calls.
 * Both languages with the real catalog. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_LANGUAGES, toRunId } from "../../../../src/contracts/index.js";
import type { CatalogText, EngineResult, JournalEvent, MessageCatalog, RunId, RunSummaryContext } from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const format = (catalog: MessageCatalog) => catalog.format as (id: string, ...rest: unknown[]) => CatalogText;
const RUN = toRunId("20261113T040506Z-0a1b2c3d") as RunId;
const started = { type: "run_started", schemaVersion: 1, taskId: "t", workflow: "quick", provider: "anthropic", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 1000, maxDurationMs: 60_000 } } as unknown as JournalEvent;
const requested = (id = "q1", callId = "c1"): JournalEvent =>
  ({ type: "confirmation_requested", id, kind: "permission", callId, tool: "run_command", permission: "command", subject: "C:\\tools\\node.exe", argumentCount: 1 }) as unknown as JournalEvent;
const answered = (decision: unknown, by: unknown, id = "q1"): JournalEvent => ({ type: "confirmation_answered", id, decision, by }) as unknown as JournalEvent;
const decided = (allowed: boolean, code: string | null, callId = "c1"): JournalEvent =>
  ({ type: "tool_decision", callId, tool: "run_command", stage: "policy_effective", allowed, permission: allowed ? null : "command", code }) as unknown as JournalEvent;
const deniedResult = (callId = "c1"): JournalEvent =>
  ({ type: "tool_result", result: { callId, tool: "run_command", ok: false, content: "denied by policy: command/confirmation_required", errorCode: "policy_denied" } }) as unknown as JournalEvent;

const result = {
  schemaVersion: 1, kind: "run", runId: RUN, taskId: "t", status: "done", reason: "verified", exitCode: 0, provider: "anthropic",
  verifiers: [{ id: "v", kind: "file_rules", outcome: "pass", evidence: "", checked: [], limits: [] }], changes: [],
  usage: { modelTurns: 2, toolCalls: 1, inputTokens: 10, outputTokens: 5, durationMs: 100 }, journalPath: "x", notices: [], protectedChanged: [],
} as unknown as EngineResult;
/** A summary context; `extra` may hold values a caller should not give (malformed cases). */
const context = (extra: Readonly<Record<string, unknown>>): RunSummaryContext =>
  ({ workspaceForm: "current", configDefault: null, profileApplied: false, deniedToolCalls: 1, deniedCommandCalls: 1, failedToolCalls: 0, policySource: "config", ...extra }) as unknown as RunSummaryContext;
const summaryLines = (catalog: MessageCatalog, ctx: RunSummaryContext): string[] => createHumanOutput(catalog).runSummary(result, ctx).trimEnd().split("\n");

for (const language of MESSAGE_LANGUAGES) {
  const catalog = createMessageCatalog(language);
  const t = format(catalog);
  const ruleHint = t("summary.denied_hint");
  const ruleHintTask = t("summary.denied_hint_task");

  describe(`U-110 (${language}): the progress line of a permission question's answer`, () => {
    test("allowed once, and denied by the person, by default (no answer or nobody to ask) or as cancelled", () => {
      const out = createHumanOutput(catalog);
      out.progressLine(started);
      assert.equal(out.progressLine(answered("allow_once", "user")), t("progress.confirmation_allowed"));
      for (const by of ["user", "default", "cancelled"]) assert.equal(out.progressLine(answered("deny", by)), t(`progress.confirmation_denied.${by}`), by);
    });

    test("the question itself has no progress line (at a terminal it is asked on stderr)", () => {
      const out = createHumanOutput(catalog);
      out.progressLine(started);
      assert.equal(out.progressLine(requested()), null);
    });

    test("an answer record that is not well formed has no line, never an exception", () => {
      const out = createHumanOutput(catalog);
      out.progressLine(started);
      for (const [decision, by] of [["allow_once", "default"], ["deny", "maybe"], ["always", "user"], [undefined, undefined], ["deny", null]]) {
        assert.equal(out.progressLine(answered(decision, by)), null, `${String(decision)}/${String(by)}`);
      }
    });

    test("the engine's records of a call denied with no one to ask: the answer, then the denial", () => {
      const out = createHumanOutput(catalog);
      const lines = [started, requested(), answered("deny", "default"), decided(false, "confirmation_required"), deniedResult()]
        .map((event) => out.progressLine(event))
        .filter((line): line is string => line !== null);
      assert.deepEqual(lines.slice(1), [t("progress.confirmation_denied.default"), t("progress.tool_denied", { tool: t("tool.run_command"), permission: "command", code: "confirmation_required" })]);
    });
  });

  describe(`U-110 (${language}): the end summary after denials that followed a permission question`, () => {
    test("denied by the person: its line, and no add-a-rule hint", () => {
      const lines = summaryLines(catalog, context({ confirmationDenied: { user: 1, default: 0, cancelled: 0, couldAsk: true } }));
      assert.ok(lines.includes(t("summary.confirm_denied.user", { count: 1 })), lines.join("\n"));
      assert.equal(lines.includes(ruleHint), false, "the rule is there: no add-a-rule hint");
    });

    test("no answer: this run could not ask (unasked), or it could and none came (unanswered)", () => {
      const unasked = summaryLines(catalog, context({ confirmationDenied: { user: 0, default: 1, cancelled: 0, couldAsk: false } }));
      assert.ok(unasked.includes(t("summary.confirm_denied.unasked", { count: 1 })), unasked.join("\n"));
      assert.equal(unasked.includes(t("summary.confirm_denied.unanswered", { count: 1 })), false);
      assert.equal(unasked.includes(ruleHint), false);
      const unanswered = summaryLines(catalog, context({ confirmationDenied: { user: 0, default: 1, cancelled: 0, couldAsk: true } }));
      assert.ok(unanswered.includes(t("summary.confirm_denied.unanswered", { count: 1 })), unanswered.join("\n"));
      assert.equal(unanswered.includes(t("summary.confirm_denied.unasked", { count: 1 })), false);
    });

    test("cancelled while it waited: its line, and no add-a-rule hint", () => {
      const lines = summaryLines(catalog, context({ deniedToolCalls: 0, deniedCommandCalls: 0, confirmationDenied: { user: 0, default: 0, cancelled: 1, couldAsk: true } }));
      assert.ok(lines.includes(t("summary.confirm_denied.cancelled", { count: 1 })), lines.join("\n"));
      assert.equal(lines.includes(ruleHint), false);
    });

    test("another denied command call keeps the add-a-rule hint, after the question's lines (config and task forms)", () => {
      const lines = summaryLines(catalog, context({ deniedToolCalls: 2, deniedCommandCalls: 2, confirmationDenied: { user: 1, default: 0, cancelled: 0, couldAsk: true } }));
      const user = lines.indexOf(t("summary.confirm_denied.user", { count: 1 }));
      assert.ok(user > 0 && lines.indexOf(ruleHint) === user + 1, lines.join("\n"));
      const task = summaryLines(catalog, context({ policySource: "task", deniedToolCalls: 2, deniedCommandCalls: 2, confirmationDenied: { user: 0, default: 1, cancelled: 0, couldAsk: false } }));
      assert.ok(task.includes(ruleHintTask), task.join("\n"));
    });

    test("all three, in CONFIRMATION_BY order, after the denied and failed counts and before the usage line", () => {
      const lines = summaryLines(catalog, context({ deniedToolCalls: 3, deniedCommandCalls: 3, failedToolCalls: 1, confirmationDenied: { user: 1, default: 2, cancelled: 1, couldAsk: false } }));
      const wanted = [t("summary.confirm_denied.user", { count: 1 }), t("summary.confirm_denied.unasked", { count: 2 }), t("summary.confirm_denied.cancelled", { count: 1 })];
      const at = lines.indexOf(wanted[0] as string);
      assert.deepEqual(lines.slice(at, at + 3), wanted, lines.join("\n"));
      assert.ok(lines.indexOf(t("summary.denied", { count: 3 })) < at && lines.indexOf(t("summary.failed", { count: 1 })) < at);
      assert.ok(lines.indexOf(t("summary.usage", { turns: 2, toolCalls: 1, seconds: 0.1 })) > at + 2, lines.join("\n"));
      assert.equal(lines.includes(ruleHint), false, "every denied command call followed a question");
    });

    test("without the field (no question, or a caller that does not count them): the add-a-rule hint as before", () => {
      const lines = summaryLines(catalog, context({}));
      assert.ok(lines.includes(ruleHint));
      assert.equal(lines.some((line) => line === t("summary.confirm_denied.user", { count: 1 }) || line === t("summary.confirm_denied.unasked", { count: 1 })), false);
    });

    test("a field that is not well formed: the summary is the one without it (the hint as before)", () => {
      const without = summaryLines(catalog, context({}));
      for (const given of [{ user: -1, default: 1.5, cancelled: "2", couldAsk: "yes" }, null, "x", { user: 1e300 * 10, default: Number.NaN, cancelled: 0, couldAsk: true }]) {
        assert.deepEqual(summaryLines(catalog, context({ confirmationDenied: given })), without, JSON.stringify(given));
      }
    });
  });
}
