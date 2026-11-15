/**
 * U-258 (PM exception for src/cli/unreadable.ts): the verifier runner gets the run's k as well as its
 * unreadable paths, so a data check over an unreadable source compares the groups query_table shows,
 * at the same k. Before, runGuards gave the verifier runner the list only: with k raised to 6,
 * query_table hid a group of 5 rows while the verifier compared it at 5, and its "no target row for 1
 * of the source's groups of at least 5 rows" told the model that a hidden group had exactly 5 rows.
 * Real CLI, scripted model, temporary folders, synthetic values.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { JournalRecord, JsonObject, ResolvedTaskSpec } from "../../../src/contracts/index.js";
import { runGuards } from "../../../src/cli/unreadable.js";
import { UNREADABLE_SOURCE_NOTE } from "../../../src/verify/data-checks.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { cliEnv } from "../../support/cli.js";
import type { CliRun } from "../../support/cli.js";
import { runGuarded } from "../../support/fake-anthropic.js";
import { createSandbox, writeWorkspaceFile } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { createFileArgs, textStep, toolStep, writeGeneralTask } from "../../fixtures/general-tasks.js";

const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };
// harbor 6 rows (shown at k 6), meadow 5 rows (hidden at k 6, shown at k 5).
const AMOUNTS = { harbor: ["10.25", "20.5", "30.75", "40.125", "50.25", "60.5"], meadow: ["11.5", "21.25", "31.75", "41.5", "51.25"] };
const SOURCE = `region,amount\n${Object.entries(AMOUNTS)
  .flatMap(([region, amounts]) => amounts.map((amount) => `${region},${amount}`))
  .join("\n")}\n`;
const HARBOR = AMOUNTS.harbor.reduce((sum, amount) => sum + Number(amount), 0);

const json = (run: CliRun): Record<string, unknown> => JSON.parse(run.stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;
function checks(sb: Sandbox, runId: string): { outcome: string; evidence: string }[] {
  const text = readFileSync(path.join(sb.workspace, ".codaryn", "runs", runId, "journal.jsonl"), "utf8");
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as JournalRecord)
    .flatMap((record) => (record.type === "verifier_result" && record.result.id === "totals" ? [{ outcome: String(record.result.outcome), evidence: String(record.result.evidence) }] : []));
}

test("U-258: runGuards gives the verifier runner the run's k with its list", async (t) => {
  const sb = createSandbox(t);
  const policy = POLICY as unknown as ResolvedTaskSpec["policy"];
  const guards = runGuards({ policy, unreadablePaths: ["private"], minGroupSize: 6 }, await createWorkspace({ root: sb.workspace }));
  assert.deepEqual(guards.verifiers, { unreadablePaths: ["private"], minGroupSize: 6 });
  // Without k, as before.
  assert.deepEqual(runGuards({ policy, unreadablePaths: ["private"] }, await createWorkspace({ root: sb.workspace })).verifiers, { unreadablePaths: ["private"] });
});

test("U-258: with k 6 the check compares the groups of at least 6 rows, as query_table shows them", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "private/sales.csv", SOURCE);
  const check: JsonObject = {
    id: "totals",
    kind: "data_checks",
    rules: [
      {
        type: "aggregate_match",
        source: { path: "private/sales.csv", format: "csv" },
        column: "amount",
        op: "sum",
        groupBy: "region",
        target: { path: "out/summary.csv", format: "csv" },
        targetColumn: "sum",
        targetKeyColumn: "region",
      },
    ],
  };
  // The model writes the one group query_table shows at k 6.
  const steps = [toolStep("write_file", createFileArgs("out/summary.csv", `region,sum\nharbor,${HARBOR}\n`)), textStep("done")];
  const task = writeGeneralTask(
    sb,
    { id: "u258-k6", fields: { workflowRef: "analyze-private" }, policy: { unreadablePaths: ["private"], minGroupSize: 6 }, verifiers: [check] },
    steps,
  );
  const ran = await runGuarded(sb, ["run", "--task", task], cliEnv());
  const found = checks(sb, String(json(ran)["runId"]));
  assert.equal(found.length, 1, ran.stdout);
  const evidence = found[0]?.evidence ?? "";
  assert.equal(found[0]?.outcome, "pass", evidence);
  assert.ok(evidence.endsWith(`(1 groups agree; the source's groups of fewer than 6 rows are not compared; ${UNREADABLE_SOURCE_NOTE})`), evidence);
  assert.equal(evidence.includes("at least 5 rows"), false, evidence);
});
