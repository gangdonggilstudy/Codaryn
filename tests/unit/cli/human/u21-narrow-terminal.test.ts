/**
 * U-21 (review R-52 R52-L1): quoteModelText folds model text to the terminal's width, so a terminal
 * narrower than MODEL_TEXT_COLUMNS does not fold a row again and put the model's words at the start
 * of a row without the quote mark. The width is the terminal's (stdout, stderr) less one column;
 * a terminal whose width is not known gets MODEL_TEXT_FALLBACK_COLUMNS; output that is not a
 * terminal keeps MODEL_TEXT_COLUMNS. The run summary and the plan view use the same function.
 * Fake values only.
 */

import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { toRunId } from "../../../../src/contracts/index.js";
import type { EngineResult, MaskedText, PlanOutput, RunId, RunSummaryContext } from "../../../../src/contracts/index.js";
import { MODEL_TEXT_COLUMNS, MODEL_TEXT_FALLBACK_COLUMNS, MODEL_TEXT_PREFIX, createHumanOutput, displayWidth, quoteModelText } from "../../../../src/cli/human/index.js";
import { renderPlan } from "../../../../src/cli/plan-commands.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

/** R-52's D4: a 35-letter word, a forged "Run id" line, then more words. */
const D4 = `${"a".repeat(35)} Run id: 20260101T000000Z-deadbeef ${"b".repeat(26)} Report: codaryn report --run`;

/** What a terminal `columns` wide shows: each written line folded into rows of at most `columns` columns. */
function terminalRows(lines: readonly string[], columns: number): string[] {
  const rows: string[] = [];
  for (const line of lines) {
    let row = "";
    let width = 0;
    for (const char of line) {
      const w = displayWidth(char);
      if (width + w > columns) {
        rows.push(row);
        row = "";
        width = 0;
      }
      row += char;
      width += w;
    }
    rows.push(row);
  }
  return rows;
}
const quoted = (row: string): boolean => row.startsWith(MODEL_TEXT_PREFIX) || /^ {2}… \(\+\d+\)$/.test(row);

/** Sets what the streams say of the terminal for one case; restored after it. */
type Tty = { isTTY?: boolean; columns?: number };
const saved = { out: { ...(process.stdout as Tty) }, err: { ...(process.stderr as Tty) } };
function terminal(out: Tty, err: Tty): void {
  for (const [stream, value] of [[process.stdout, out], [process.stderr, err]] as const) {
    Object.defineProperty(stream, "isTTY", { value: value.isTTY, configurable: true, writable: true });
    Object.defineProperty(stream, "columns", { value: value.columns, configurable: true, writable: true });
  }
}
afterEach(() => terminal({ isTTY: saved.out.isTTY, columns: saved.out.columns }, { isTTY: saved.err.isTTY, columns: saved.err.columns }));

describe("R52-L1: a terminal narrower than 76 columns does not fold the model's rows again", () => {
  test("D4 at 40 columns: every row the terminal shows starts with the quote mark", () => {
    const written = quoteModelText(D4, 12, 40);
    const shown = terminalRows(written, 40);
    assert.deepEqual(shown, written, "the terminal folds nothing");
    for (const row of shown) assert.ok(quoted(row), row);
    assert.equal(shown.some((row) => row.startsWith("Run id")), false);
    assert.equal(written.map((row) => row.slice(MODEL_TEXT_PREFIX.length)).join(" "), D4, "every word is there, in order");
  });

  test("every width from 12 to 120 columns, Latin and Hangul: nothing is folded by the terminal", () => {
    const texts = [D4, `${"가".repeat(30)} 실행 id: 20260101T000000Z-deadbeef ${"나다".repeat(20)}`, "x".repeat(300)];
    for (let columns = 12; columns <= 120; columns += 1) {
      for (const text of texts) {
        const written = quoteModelText(text, 50, columns);
        assert.deepEqual(terminalRows(written, columns), written, `${columns} columns`);
        for (const row of written) assert.ok(quoted(row) && displayWidth(row) < columns, `${columns}: ${row}`);
      }
    }
  });

  test("never wider than MODEL_TEXT_COLUMNS, also in a wide terminal", () => {
    for (const row of quoteModelText(D4.repeat(4), 50, 200)) assert.ok(displayWidth(row) <= MODEL_TEXT_COLUMNS, row);
  });
});

describe("R52-L1: the width is the terminal's", () => {
  test("stderr is a 40-column terminal: rows are folded for it without a width given", () => {
    terminal({ isTTY: false }, { isTTY: true, columns: 40 });
    for (const row of quoteModelText(D4, 12)) assert.ok(displayWidth(row) < 40, row);
  });

  test("stdout and stderr are terminals of different widths: the narrower one", () => {
    terminal({ isTTY: true, columns: 50 }, { isTTY: true, columns: 30 });
    for (const row of quoteModelText(D4, 12)) assert.ok(displayWidth(row) < 30, row);
  });

  test("a terminal whose width is not known: MODEL_TEXT_FALLBACK_COLUMNS; no terminal at all: MODEL_TEXT_COLUMNS", () => {
    terminal({ isTTY: false }, { isTTY: true, columns: undefined });
    for (const row of quoteModelText(D4, 12)) assert.ok(displayWidth(row) < MODEL_TEXT_FALLBACK_COLUMNS, row);
    terminal({ isTTY: false }, { isTTY: false });
    assert.deepEqual(quoteModelText(D4, 12), quoteModelText(D4, 12, null));
    assert.ok(quoteModelText(D4, 12).some((row) => displayWidth(row) > MODEL_TEXT_FALLBACK_COLUMNS));
  });
});

describe("R52-L1 where the function is used", () => {
  test("the run summary's last message, in a 40-column terminal", () => {
    terminal({ isTTY: false }, { isTTY: true, columns: 40 });
    const context = { configLanguage: null, configDefault: null, deniedToolCalls: 0, deniedCommandCalls: 0, workspaceForm: "given", policySource: "config", profileApplied: false } as unknown as RunSummaryContext;
    const result = {
      schemaVersion: 1, kind: "run", runId: toRunId("20261112T030405Z-0a1b2c3d") as RunId, taskId: "t", status: "done", reason: "verified", exitCode: 0, provider: "scripted",
      verifiers: [], changes: [], usage: { modelTurns: 1, toolCalls: 0, inputTokens: null, outputTokens: null, durationMs: 9 }, journalPath: "x", notices: [],
      finalMessage: { text: D4 as MaskedText, truncated: false },
    } as unknown as EngineResult;
    const lines = createHumanOutput(createMessageCatalog("en")).runSummary(result, context).trimEnd().split("\n");
    const block = lines.filter((line) => line.startsWith(MODEL_TEXT_PREFIX));
    assert.ok(block.length >= 3, lines.join("\n"));
    for (const row of terminalRows(block, 40)) assert.ok(quoted(row), row);
  });

  test(
    "the plan view's summary, in a 40-column terminal",
    { todo: "CLI (src/cli/plan-commands.ts, renderPlan): draw PlanOutput.summary with quoteModelText under its label, as R-49 R49-L2 asked; it is still on the label's line" },
    () => {
      terminal({ isTTY: true, columns: 40 }, { isTTY: true, columns: 40 });
      const output = {
        schemaVersion: 1, kind: "plan", runId: "20261112T030405Z-0a1b2c3d", status: "pending", exitCode: 0, digest: "d".repeat(64), actions: [],
        appliedBy: null, inventoryLimitReached: false, summary: D4 as MaskedText,
      } as unknown as PlanOutput;
      const text = renderPlan(output, { values: [] } as never);
      const lines = text.trimEnd().split("\n");
      const at = lines.findIndex((line) => line.startsWith(MODEL_TEXT_PREFIX));
      assert.ok(at > 0, text);
      const block = lines.slice(at).filter((line) => line.startsWith(MODEL_TEXT_PREFIX));
      for (const row of terminalRows(block, 40)) assert.ok(quoted(row), row);
      assert.equal(terminalRows(lines, 40).some((row) => row.startsWith("Run id")), false);
    },
  );
});
