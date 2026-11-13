/**
 * U-198 after review R-103 M-1: a run plan's summary in ChangesPlanOutput (the app's plan() output to
 * the GUI, the CLI's --json, the approval screen) is made safe in the output object itself, as the move
 * plan's summary is (R-49 R49-M1, planSummary in src/cli/plan-commands.ts): masked with the registered
 * values, then key shapes and the current key hidden and control characters replaced, trimmed. Line
 * feeds and tabs stay (cleanText's keepLineBreaks): the run plan's summary is the later run's
 * instruction and keeps them where it is stored (safeModelText, V-7). Before the fix only the registered
 * values were masked. Plans are written with the store's own recorder, as a plan made without the
 * tool's own safe step would be. The key shapes are built from parts and are not keys.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { HIDDEN_KEY_MARKER, maskedParts } from "../../../../src/contracts/index.js";
import type { ContentHash, StoredPlannedFile } from "../../../../src/contracts/index.js";
import { MODEL_TEXT_PREFIX, changesPlanOutput, renderChangesPlan } from "../../../../src/cli/human/index.js";
import type { LoadedChangesPlan } from "../../../../src/cli/human/index.js";
import { cleanText, hideKeys } from "../../../../src/cli/text-safety.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";
import { createPrivacyGateway } from "../../../../src/privacy/index.js";
import { createPlanRecorder, loadAnyPlan } from "../../../../src/store/index.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const PLAN_RUN = "20261113T120000Z-0a1b2c3d";
const KEY_SHAPED = ["sk", "ant", "fakefakefake0000fakefakefake0000"].join("-");
const CURRENT = ["fake", "current", "key", "0123456789", "abcdefXYZ"].join("-");
const NONE = createPrivacyGateway({ secrets: [] });

/** A run plan with this summary, stored by the store's recorder, and loadAnyPlan's reading of it. */
async function stored(summary: string): Promise<LoadedChangesPlan> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-u198r103-")));
  roots.push(root);
  const files: StoredPlannedFile[] = [{ path: "docs/guide.md", change: "modify", sha256: "a".repeat(64) as ContentHash, shown: maskedParts("docs/guide.md") }];
  const digest = await createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).saveChangesPlan!({ summary: maskedParts(summary), files });
  const dir = join(root, ".codaryn", "runs", PLAN_RUN);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "journal.jsonl"), `${JSON.stringify({ seq: 1, at: "2026-11-13T12:00:01.000Z", runId: PLAN_RUN, type: "run_started", schemaVersion: 1, taskId: "t", workflow: "write", provider: "scripted", limits: { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: null, maxDurationMs: 1000 } })}\n`);
  const result = {
    schemaVersion: 1, kind: "run", runId: PLAN_RUN, taskId: "t", status: "needs-input", reason: "plan_pending", exitCode: 3, provider: "scripted", verifiers: [], changes: [],
    usage: { modelTurns: 1, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 1 }, journalPath: `.codaryn/runs/${PLAN_RUN}/journal.jsonl`, notices: [],
    plan: { digest, actions: 1, kind: "changes" },
  };
  await writeFile(join(dir, "result.json"), `${JSON.stringify(result)}\n`);
  const outcome = await loadAnyPlan({ workspaceRoot: root, runId: PLAN_RUN });
  assert.ok(outcome.ok && outcome.plan.kind === "changes", JSON.stringify(outcome));
  return { plan: outcome.plan, digest: outcome.digest, applied: outcome.applied };
}

function summaryOf(loaded: LoadedChangesPlan, currentKey?: string): string {
  const outcome = changesPlanOutput(loaded, NONE, currentKey === undefined ? {} : { currentKey });
  assert.ok(outcome.ok, JSON.stringify(outcome));
  return outcome.output.summary;
}

describe("U-198 (R-103 M-1): the run plan's summary is safe in the output itself", () => {
  test("a key shape is hidden and control characters are replaced, also with no current key given (R-103's reproduction)", async () => {
    const summary = summaryOf(await stored(`Use ${KEY_SHAPED} here\u0007 and go`));
    assert.ok(!summary.includes(KEY_SHAPED), summary);
    assert.ok(summary.includes(HIDDEN_KEY_MARKER), summary);
    assert.ok(!summary.includes("\u0007"), "no control character");
  });

  test("the current key is hidden when it is given", async () => {
    const loaded = await stored(`Keep ${CURRENT} out of it`);
    const summary = summaryOf(loaded, CURRENT);
    assert.ok(!summary.includes(CURRENT), summary);
  });

  test("the same rule as the move plan's summary, line feeds and tabs kept: cleanText(hideKeys(masked, key), true).trim()", async () => {
    // A space and a word after each value: hideKeys also finds a key split by a line feed or a tab (R-52 M2).
    const text = `  First ${KEY_SHAPED} here.\n\tthen ${CURRENT} now\r and\u001b[2J done  `;
    const summary = summaryOf(await stored(text), CURRENT);
    assert.equal(summary, cleanText(hideKeys(text, CURRENT), true).trim());
    assert.ok(summary.includes("\n") && summary.includes("\t"), "line feeds and tabs stay");
    assert.ok(!summary.includes("\r") && !summary.includes("\u001b"), "a carriage return and an escape do not");
  });

  test("an ordinary summary is as before, and the view still shows every line", async () => {
    assert.equal(summaryOf(await stored("Rewrite the guide's intro and start a changelog")), "Rewrite the guide's intro and start a changelog");
    const lines = Array.from({ length: 12 }, (_, index) => `step ${index + 1}`).join("\n");
    const loaded = await stored(lines);
    const outcome = changesPlanOutput(loaded, NONE);
    assert.ok(outcome.ok);
    const rows = renderChangesPlan(outcome.output, null, createMessageCatalog("en")).split("\n").filter((line) => line.startsWith(MODEL_TEXT_PREFIX));
    assert.equal(rows.length, 12);
  });
});
