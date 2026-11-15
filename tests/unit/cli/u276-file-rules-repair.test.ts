/**
 * U-276 (Codex V-28 H1): V-28's file-rule-true and file-rule-false on the real CLI. The unreadable list
 * is in the config file only (k 5); private/data.csv holds the header g,v and one row, HIDDEN,73, or
 * HIDDEN,74 in the control. The check holds contains(private/data.csv, "HIDDEN,73") and exists of a
 * file that is not there, so it fails and goes back to the model once. The scripted model asks
 * query_table for a sum and answers done. Before, the repair request said "held … (text found)" for 73
 * and "not held … (text not found)" for 74. Now the rule is not compared and the repair request reads
 * the same in both. Scripted model, temporary folders, synthetic values.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { JournalRecord, JsonObject } from "../../../src/contracts/index.js";
import { cliEnv } from "../../support/cli.js";
import type { CliRun } from "../../support/cli.js";
import { runGuarded } from "../../support/fake-anthropic.js";
import { writeConfigFile } from "../../fixtures/anthropic.js";
import { createSandbox, writeWorkspaceFile } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { textStep, toolStep, writeGeneralTask } from "../../fixtures/general-tasks.js";

const LIMITS = { maxModelTurns: 8, maxToolCalls: 24, maxTotalTokens: 1000, maxDurationMs: 60_000 };
const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };
const json = (run: CliRun): Record<string, unknown> => JSON.parse(run.stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;

function journalOf(sb: Sandbox, runId: string): JournalRecord[] {
  const text = readFileSync(path.join(sb.workspace, ".codaryn", "runs", runId, "journal.jsonl"), "utf8");
  return text.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as JournalRecord);
}

/** Every string of the run's model requests that names the check's files: the repair's text. */
function repairTexts(records: readonly JournalRecord[]): string[] {
  const found: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      if (value.includes("force-repair.txt")) found.push(value);
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === "object" && value !== null) Object.values(value).forEach(walk);
  };
  for (const record of records) if (record.type === "model_request") walk(record);
  return found;
}

async function runCase(t: Parameters<typeof createSandbox>[0], value: string): Promise<string[]> {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "private/data.csv", `g,v\nHIDDEN,${value}\n`);
  const config = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, policy: { ...POLICY, unreadablePaths: ["private"], minGroupSize: 5 } }, "c.json");
  const check: JsonObject = {
    id: "files",
    kind: "file_rules",
    rules: [
      { type: "contains", path: "private/data.csv", text: "HIDDEN,73" },
      { type: "exists", path: "force-repair.txt" },
    ],
  };
  const steps = [toolStep("query_table", { path: "private/data.csv", operations: [{ op: "sum", column: "v" }] }), textStep("done"), textStep("done again"), textStep("done at last")];
  const task = writeGeneralTask(sb, { id: `v28-${value}`, fields: { workflowRef: "analyze-private" }, verifiers: [check], limits: { maxRepairAttempts: 1 } }, steps);
  const ran = await runGuarded(sb, ["run", "--task", task, "--config", config], cliEnv());
  const records = journalOf(sb, String(json(ran)["runId"]));
  assert.ok(records.some((record) => record.type === "repair_started"), "the failed check went back to the model");
  return repairTexts(records);
}

test("U-276 (V-28 file-rule-true and file-rule-false): the repair request reads the same for the guess and the control", { timeout: 120_000 }, async (t) => {
  const guess = await runCase(t, "73");
  const control = await runCase(t, "74");
  assert.ok(guess.length > 0, "the repair request names the check");
  assert.deepEqual(control, guess);
  for (const text of guess) {
    assert.equal(/text found|text not found/.test(text), false, text);
    assert.ok(text.includes("not compared: a verdict on a file under unreadable paths would tell the model about it"), text);
  }
});
