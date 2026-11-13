/**
 * U-104 (U-99b: UXM-18, AXM-20; PM approved), the human renderer's part: a run or an apply checks its
 * protected material several times, and each check that found nothing was a progress line of its own
 * (5 of the keyless demo's 22 lines). Now
 * - the first check of a run that found nothing is shown, later ones that found nothing are folded;
 * - a check that found a change is never folded (PM: only "unchanged" is folded);
 * - the end summary (run and apply) says how many checks there were, when none found a change
 *   (summary.integrity_unchanged), right after the verifiers line;
 * - all of it starts again at the next run or apply (the renderer may draw several, U-52).
 * The count is the renderer's own, of the records it drew: the CLI draws a run's or an apply's progress
 * and its summary with one renderer. The text is the catalog owner's; a stand-in shows the id and its
 * count, and the real lines are checked in both languages once the catalog has them. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_LANGUAGES, toRunId } from "../../../../src/contracts/index.js";
import type { ApplyJournalEvent, ApplyResult, CatalogText, EngineResult, JournalEvent, MessageCatalog, RunId, RunSummaryContext } from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";
import { MESSAGE_TEXTS } from "../../../../src/i18n/catalog.js";

const ID = "summary.integrity_unchanged";
const real = createMessageCatalog("en");
const asReal = (catalog: MessageCatalog) => catalog.format as (id: string, ...rest: unknown[]) => CatalogText;
const standIn: MessageCatalog = {
  language: "en",
  format: ((id: string, ...params: unknown[]) => (id === ID ? (`<${id} ${JSON.stringify(params[0])}>` as CatalogText) : asReal(real)(id, ...params))) as MessageCatalog["format"],
};
const summaryLine = (count: number): string => `<${ID} ${JSON.stringify({ count })}>`;

const RUN = toRunId("20261113T040506Z-0a1b2c3d") as RunId;
const started = { type: "run_started", schemaVersion: 1, taskId: "t", workflow: "document", provider: "scripted", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 } } as unknown as JournalEvent;
const applyStarted = { type: "apply_started", schemaVersion: 1, planRunId: "20261113T010203Z-0a1b2c3d", taskId: "t", digest: "a".repeat(64), approval: "cli-flag", actions: 1, maxDurationMs: 60_000 } as unknown as JournalEvent;
const check = (phase: string, changed: readonly string[] = []): JournalEvent => ({ type: "integrity_checked", phase, changed }) as unknown as JournalEvent;
const verifier = (outcome: "pass" | "fail"): JournalEvent => ({ type: "verifier_result", result: { id: "summary", kind: "file_rules", outcome, evidence: "", checked: [], limits: [] } }) as unknown as JournalEvent;
const repair = { type: "repair_started", attempt: 1, failedVerifiers: ["summary"], feedbackTruncated: false } as unknown as JournalEvent;
/** The demo's protected-material checks and verifier rounds (usage section 3), without the model's turns. */
const DEMO: readonly JournalEvent[] = [started, check("run_start"), check("before_verify"), verifier("fail"), check("after_verify"), repair, check("before_verify"), verifier("pass"), check("after_verify")];
const CONTEXT = { workspaceForm: "task", configDefault: null, profileApplied: false, deniedToolCalls: 0, deniedCommandCalls: 0, policySource: "task" } as unknown as RunSummaryContext;
const result = {
  schemaVersion: 1, kind: "run", runId: RUN, taskId: "t", status: "done", reason: "verified", exitCode: 0, provider: "scripted",
  verifiers: [{ id: "summary", kind: "file_rules", outcome: "pass", evidence: "", checked: [], limits: [] }], changes: [],
  usage: { modelTurns: 6, toolCalls: 3, inputTokens: null, outputTokens: null, durationMs: 100 }, journalPath: "x", notices: [], protectedChanged: [],
} as unknown as EngineResult;
const applyResult = {
  schemaVersion: 1, kind: "apply", runId: RUN, planRunId: "20261113T010203Z-0a1b2c3d", taskId: "t", digest: "a".repeat(64), status: "done", reason: "verified", exitCode: 0,
  applied: [], verifiers: [{ id: "inventory", kind: "inventory", outcome: "pass", evidence: "", checked: [], limits: [] }],
  usage: { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 5 }, journalPath: "x", notices: [], protectedChanged: [],
} as unknown as ApplyResult;
const unchangedLine = (catalog: MessageCatalog, phase: string): string => asReal(catalog)("progress.integrity_unchanged", { phase });
const changedLine = (catalog: MessageCatalog, phase: string, count: number): string => asReal(catalog)("progress.integrity_changed", { phase, count });
const linesOf = (text: string): string[] => text.trimEnd().split("\n");

describe("U-104: the protected-material checks that found nothing are folded after the first", () => {
  test("the demo's five checks: the first is shown, four are folded; the summary says five, after the verifiers line", () => {
    const out = createHumanOutput(standIn);
    const lines = DEMO.map((event) => out.progressLine(event)).filter((line): line is string => line !== null);
    assert.deepEqual(lines.filter((line) => line.startsWith("protected material")), [unchangedLine(real, "run_start")]);
    const summary = linesOf(out.runSummary(result, CONTEXT));
    const at = summary.indexOf(summaryLine(5));
    assert.ok(at > 0, summary.join("\n"));
    assert.equal(summary[at - 1], real.format("summary.verifiers", { passed: 1, total: 1 }));
  });

  test("a check that found a change is never folded; then the summary has no 'nothing changed' line", () => {
    const out = createHumanOutput(standIn);
    const events = [started, check("run_start"), check("before_verify", ["a"]), check("before_verify"), check("after_verify", ["a", "b"])];
    const lines = events.map((event) => out.progressLine(event)).filter((line): line is string => line !== null && line.startsWith("protected material"));
    assert.deepEqual(lines, [unchangedLine(real, "run_start"), changedLine(real, "before_verify", 1), changedLine(real, "after_verify", 2)]);
    assert.equal(out.runSummary(result, CONTEXT).includes(`<${ID}`), false);
  });

  test("an apply: the same, through applyProgressLine; its summary says three", () => {
    const out = createHumanOutput(standIn);
    const events = [applyStarted, check("run_start"), check("before_verify"), verifier("pass"), check("after_verify")];
    const lines = events.map((event) => out.applyProgressLine?.(event as unknown as ApplyJournalEvent) ?? null).filter((line): line is string => line !== null && line.startsWith("protected material"));
    assert.deepEqual(lines, [unchangedLine(real, "run_start")]);
    const summary = linesOf(out.applySummary?.(applyResult, { workspaceForm: "task" }) ?? "");
    const at = summary.indexOf(summaryLine(3));
    assert.ok(at > 0, summary.join("\n"));
    assert.equal(summary[at - 1], real.format("summary.verifiers", { passed: 1, total: 1 }));
  });

  test("the next run starts again: its first check is shown and its count is its own", () => {
    const out = createHumanOutput(standIn);
    for (const event of DEMO) out.progressLine(event);
    const second = [started, check("run_start"), check("before_verify")].map((event) => out.progressLine(event)).filter((line): line is string => line !== null && line.startsWith("protected material"));
    assert.deepEqual(second, [unchangedLine(real, "run_start")]);
    assert.ok(linesOf(out.runSummary(result, CONTEXT)).includes(summaryLine(2)));
  });

  test("no check drawn (nothing protected, or a summary without the run's progress): no line", () => {
    const out = createHumanOutput(standIn);
    out.progressLine(started);
    assert.equal(out.runSummary(result, CONTEXT).includes(`<${ID}`), false);
    assert.equal(createHumanOutput(standIn).applySummary?.(applyResult, { workspaceForm: "task" }).includes(`<${ID}`), false);
  });

  test("a check record that is not well formed is neither shown nor counted", () => {
    const out = createHumanOutput(standIn);
    out.progressLine(started);
    assert.equal(out.progressLine({ type: "integrity_checked", phase: "made_up", changed: [] } as unknown as JournalEvent), null);
    assert.equal(out.runSummary(result, CONTEXT).includes(`<${ID}`), false);
  });
});

describe("U-104 with the real catalog", () => {
  const ready = MESSAGE_LANGUAGES.every((language) => Object.hasOwn(MESSAGE_TEXTS[language], ID));
  for (const language of MESSAGE_LANGUAGES) {
    test(`${language}: the summary line is the catalog's, with the count`, { skip: ready ? false : `${ID} is not in the catalog yet (nb-i18n)` }, () => {
      const catalog = createMessageCatalog(language);
      const out = createHumanOutput(catalog);
      for (const event of DEMO) out.progressLine(event);
      assert.ok(linesOf(out.runSummary(result, CONTEXT)).includes(asReal(catalog)(ID, { count: 5 })));
    });
  }
});
