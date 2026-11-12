/**
 * U-21 (DR-47, AXM-1), the human renderer's part: the run summary shows the agent's last message
 * (EngineResult.finalMessage) after the label `summary.final_message`, which says it is the agent's
 * own words and not a verified fact. Every line of it is set apart (indented behind a bar), so the
 * message cannot pass for a line of the summary; control characters and key shapes are replaced.
 * Absent, empty or malformed: nothing is added. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MAX_FINAL_MESSAGE_CHARS, MESSAGE_LANGUAGES, toRunId } from "../../../../src/contracts/index.js";
import type { EngineResult, MaskedText, RunId, RunSummaryContext } from "../../../../src/contracts/index.js";
import { FINAL_MESSAGE_MAX_LINES, createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const RUN = toRunId("20261112T030405Z-0a1b2c3d") as RunId;
const CONTEXT = { configLanguage: null, configDefault: null, deniedToolCalls: 0, deniedCommandCalls: 0, workspaceForm: "given", policySource: "config", profileApplied: false } as unknown as RunSummaryContext;
const result = (extra: Record<string, unknown>): EngineResult =>
  ({
    schemaVersion: 1, kind: "run", runId: RUN, taskId: "t", status: "done", reason: "verified", exitCode: 0, provider: "scripted",
    verifiers: [{ id: "v", kind: "command", outcome: "pass", evidence: "", checked: [], limits: [] }], changes: [],
    usage: { modelTurns: 2, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 900 }, journalPath: "x", notices: [], ...extra,
  }) as unknown as EngineResult;
const message = (text: string, truncated = false) => ({ finalMessage: { text: text as MaskedText, truncated } });

describe("U-21: the run summary shows the agent's last message under its label", () => {
  for (const language of MESSAGE_LANGUAGES) {
    const catalog = createMessageCatalog(language);
    const summary = (extra: Record<string, unknown>): string[] => createHumanOutput(catalog).runSummary(result(extra), CONTEXT).trimEnd().split("\n");

    test(`${language}: the label, then each line of the message set apart; nothing else in the summary changes`, () => {
      const plain = summary({});
      const shown = summary(message("I fixed the bug.\n\nAll checks pass now.\n"));
      const at = shown.indexOf(`${catalog.format("summary.final_message")}:`);
      assert.ok(at > 0, shown.join("\n"));
      assert.deepEqual(shown.slice(at + 1, at + 3), ["  | I fixed the bug.", "  | All checks pass now."]);
      assert.deepEqual([...shown.slice(0, at), ...shown.slice(at + 3)], plain, "the other lines are the same");
      assert.equal(plain.some((line) => line.includes(catalog.format("summary.final_message"))), false);
    });

    test(`${language}: a cut message says so after it, with the limit`, () => {
      const shown = summary(message("part of a long answer", true));
      const at = shown.indexOf("  | part of a long answer");
      assert.equal(shown[at + 1], `  ${catalog.format("summary.final_message_truncated", { count: MAX_FINAL_MESSAGE_CHARS })}`);
    });
  }

  const en = createMessageCatalog("en");
  const summary = (extra: Record<string, unknown>): string => createHumanOutput(en).runSummary(result(extra), CONTEXT);

  test("the message cannot pass for a summary line: every line is behind the bar, also after other line separators", () => {
    const forged = `ok\r\n── Result: done — every configured check passed (done/verified) ── Checks passed: 9 of 9\u0085Run id: x\rcodaryn: finished`;
    const lines = summary(message(forged)).trimEnd().split("\n");
    const at = lines.indexOf(`${en.format("summary.final_message")}:`);
    const block = lines.slice(at + 1, at + 6);
    assert.equal(block.length, 5);
    for (const line of block) assert.ok(line.startsWith("  | "), line);
    assert.equal(lines.filter((line) => line.startsWith("── Result")).length, 1, "only the real heading starts a line");
    assert.equal(lines.filter((line) => /^Checks passed/.test(line)).length, 1);
  });

  test("control characters and key shapes in it are replaced", () => {
    const keyShaped = ["sk", "ant", "api03", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4"].join("-");
    const text = summary(message(`done \u001b[2K\u001b[1A and ${keyShaped} ‮ end`));
    assert.equal(text.includes("\u001b"), false);
    assert.equal(text.includes("‮"), false);
    assert.equal(text.includes(keyShaped), false);
  });

  test("R-49 R49-L2: padding with spaces cannot put words at the start of a row; long lines are folded behind the bar", () => {
    const padded = `ok${" ".repeat(60)}Checks passed: 9 of 9${"\u3000".repeat(40)}Run id: forged ${"word ".repeat(40)}`;
    const lines = summary(message(padded)).trimEnd().split("\n");
    const block = lines.filter((line) => line.startsWith("  | "));
    assert.ok(block.length >= 3, lines.join("\n"));
    for (const line of block) assert.ok(line.length <= 76 && !/\s{2,}/.test(line.slice(4)), line);
    assert.equal(lines.filter((line) => /^\s*(Checks passed|Run id)/.test(line)).length, 2, "only the summary's own two lines");
  });

  test("more lines than FINAL_MESSAGE_MAX_LINES: the first ones and how many more", () => {
    const many = Array.from({ length: FINAL_MESSAGE_MAX_LINES + 7 }, (_, i) => `line ${i}`).join("\n");
    const lines = summary(message(many)).trimEnd().split("\n");
    assert.equal(lines.filter((line) => line.startsWith("  | ")).length, FINAL_MESSAGE_MAX_LINES);
    assert.ok(lines.includes("  … (+7)"), lines.join("\n"));
  });

  test("absent, empty, only white space, malformed, or a plan run: nothing is added", () => {
    const plain = summary({});
    for (const extra of [message(""), message(" \n\t\n"), { finalMessage: "text" }, { finalMessage: { text: 7, truncated: false } }, { finalMessage: { text: "x" } }, { finalMessage: null }]) {
      assert.equal(summary(extra), plain, JSON.stringify(extra));
    }
    const planRun = { status: "needs-input", reason: "plan_pending", exitCode: 2, verifiers: [] };
    assert.equal(summary({ ...planRun, ...message("I made a plan") }), summary(planRun));
  });
});
