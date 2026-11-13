/**
 * Unit U-42 (review R-59 I-1): text a model wrote, as rows for an adapter's window, from the app
 * layer. The GUI's engine host read the CLI's quoteModelText from the engine's dist by path
 * (gui/src/engine-host/main.ts, cli/human/format.js) and took the quote mark off itself. The app
 * layer now gives `modelTextRows` and `MODEL_TEXT_MAX_ROWS` on its public surface:
 * - the rows are the CLI `plan` view's rows of the same summary (renderPlan: the key values hidden,
 *   then quoteModelText at the width for output that is not a terminal), without the quote mark;
 * - at most MODEL_TEXT_MAX_ROWS rows of text (the CLI's FINAL_MESSAGE_MAX_LINES, the plan view's
 *   number) and a last "… (+N)" row for the rest.
 * Reproduced first (6d765e3, todo); the app layer gives them now (src/app/model-text.ts). A real plan
 * through the app (scripted model) and the CLI's own renderPlan. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MODEL_TEXT_MAX_ROWS, modelTextRows } from "../../../src/app/index.js";
import type { PlanOutput } from "../../../src/app/index.js";
import { MODEL_TEXT_PREFIX, terminalColumns } from "../../../src/cli/human/format.js";
import { FINAL_MESSAGE_MAX_LINES } from "../../../src/cli/human/output.js";
import { renderPlan } from "../../../src/cli/plan-commands.js";
import { FAKE_API_KEY } from "../../fixtures/secrets.js";
import { plannedRun, taskForm } from "./support.js";

/** The rows the CLI's plan view draws for the summary, without the quote mark (its "… (+N)" row trimmed). */
function cliRows(output: PlanOutput, keys: readonly string[] | null = null): string[] {
  return renderPlan(output, keys)
    .split("\n")
    .filter((line) => line.startsWith(MODEL_TEXT_PREFIX) || /^ {2}… \(\+\d+\)$/.test(line))
    .map((line) => (line.startsWith(MODEL_TEXT_PREFIX) ? line.slice(MODEL_TEXT_PREFIX.length) : line.trim()));
}

/** A plan through the app whose model wrote `summary`; the app's PlanOutput. */
async function planWith(summary: string): Promise<PlanOutput> {
  const run = await plannedRun({ "a.txt": "alpha\n" }, [
    { toolCalls: [{ name: "propose_plan", args: { summary, actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] },
  ]);
  const shown = await run.app.plan({ settings: taskForm(run.base), runId: run.plan.runId });
  assert.ok(shown.ok, JSON.stringify(shown));
  assert.equal(typeof shown.output.summary, "string");
  return shown.output as PlanOutput;
}

// 409 characters, within the tool's 500 (MAX_PLAN_SUMMARY_CHARS).
const WORDS = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
// The CLI's plan view folds for the terminal when stdout or stderr is one; under node --test neither is.
const NOT_A_TERMINAL = { skip: terminalColumns() !== null && "stdout or stderr is a terminal here; the CLI would fold for it" };

describe("U-42 (R-59 I-1): modelTextRows gives the CLI plan view's rows of a model's text", () => {
  test("MODEL_TEXT_MAX_ROWS is the plan view's number of rows (FINAL_MESSAGE_MAX_LINES)", () => {
    assert.equal(MODEL_TEXT_MAX_ROWS, FINAL_MESSAGE_MAX_LINES);
  });

  test("a real plan's summary: the same rows as the CLI's plan view, without the quote mark", NOT_A_TERMINAL, async () => {
    const output = await planWith(WORDS);
    const rows = modelTextRows(output.summary ?? "");
    assert.ok(rows.length > 1, "folded into more than one row");
    assert.deepEqual(rows, cliRows(output));
    assert.ok(rows.every((row) => !row.startsWith(MODEL_TEXT_PREFIX) && row === row.trim() && row.length > 0));
  });

  test("past MODEL_TEXT_MAX_ROWS: that many rows and the CLI's '… (+N)' row", NOT_A_TERMINAL, async () => {
    const output = await planWith("tidy");
    const long = { ...output, summary: Array.from({ length: 600 }, (_, i) => `w${i}`).join(" ") } as PlanOutput;
    const rows = modelTextRows(long.summary ?? "");
    assert.deepEqual(rows, cliRows(long));
    assert.equal(rows.length, FINAL_MESSAGE_MAX_LINES + 1);
    assert.match(rows[rows.length - 1] ?? "", /^… \(\+\d+\)$/);
  });

  test("the key values given are hidden as the CLI's plan view hides the current keys", NOT_A_TERMINAL, async () => {
    const output = await planWith("tidy");
    const withKey = { ...output, summary: `the key is ${FAKE_API_KEY} here` } as PlanOutput;
    const rows = modelTextRows(withKey.summary ?? "", { keys: [FAKE_API_KEY] });
    assert.deepEqual(rows, cliRows(withKey, [FAKE_API_KEY]));
    assert.equal(rows.join("\n").includes(FAKE_API_KEY), false);
  });

  test("maxRows: fewer rows, the rest counted; nothing to show gives no rows", () => {
    const rows = modelTextRows(WORDS, { maxRows: 2 });
    assert.equal(rows.length, 3);
    assert.match(rows[2] ?? "", /^… \(\+\d+\)$/);
    assert.deepEqual(modelTextRows("   \n\t "), []);
  });
});
