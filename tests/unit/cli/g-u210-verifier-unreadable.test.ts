/**
 * U-210 with U-223 (P1 bundle A, A-6 and A-7, R-6): the CLI gives the run's unreadable paths to the
 * verifier runner. U-223 made data_checks keep every number read from a source under them out of its
 * evidence (VerifierRunnerOptions.unreadablePaths), but the CLI's assembly of a run and of a plan's
 * apply built the runner without the list, so on the real CLI the evidence still held the recomputed
 * numbers of an unreadable table, and a repair sent them to the model: a way around k.
 * Now, on the real CLI with the scripted model, an aggregate_match whose source lies under the run's
 * unreadable paths fails on a wrong result table with U-223's note, and no number read from the source
 * (its cells and its groups' sums) is in a record, a model request (the journal's model_request) or the
 * human output: in a run that repairs (src/cli/assemble.ts) and in the apply of a plan of moves, whose
 * verifiers run after the moves (src/cli/plan-commands.ts). A source outside the list keeps its
 * numbers, as before. Temporary folders, no network.
 */

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { JournalRecord, JsonObject } from "../../../src/contracts/index.js";
import { UNREADABLE_SOURCE_NOTE } from "../../../src/verify/data-checks.js";
import { cliEnv } from "../../support/cli.js";
import type { CliRun } from "../../support/cli.js";
import { cliOutputSources, runGuarded } from "../../support/fake-anthropic.js";
import { findLeaks } from "../../support/leak.js";
import { createSandbox, writeWorkspaceFile } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { createFileArgs, proposePlanArgs, textStep, toolStep, writeGeneralTask, writeOrganizeTask } from "../../fixtures/general-tasks.js";

/** Cells and group sums unlike any other number of the run (north 1234.5678 + 1111.1111). */
const SOURCE = "region,amount\nnorth,1234.5678\nsouth,4321.8765\nnorth,1111.1111\neast,777.7777\n";
const SOURCE_NUMBERS = ["1234.5678", "4321.8765", "1111.1111", "777.7777", "2345.6789"];
const WRONG_SUMMARY = "region,sum\nnorth,1\nsouth,2\neast,3\n";

const json = (run: CliRun): Record<string, unknown> => JSON.parse(run.stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;

function journalOf(sb: Sandbox, runId: string): JournalRecord[] {
  const text = readFileSync(path.join(sb.workspace, ".codaryn", "runs", runId, "journal.jsonl"), "utf8");
  return text.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as JournalRecord);
}

function totalsCheck(source: string): JsonObject {
  return {
    id: "totals",
    kind: "data_checks",
    rules: [
      {
        type: "aggregate_match",
        source: { path: source, format: "csv" },
        column: "amount",
        op: "sum",
        groupBy: "region",
        target: { path: "out/summary.csv", format: "csv" },
        targetColumn: "sum",
        targetKeyColumn: "region",
      },
    ],
  };
}

/** The verdicts of the totals check in the run, in order (an apply also records its inventory check). */
function verdicts(records: readonly JournalRecord[]): { outcome: string; evidence: string }[] {
  return records.flatMap((record) =>
    record.type === "verifier_result" && record.result.id === "totals" ? [{ outcome: String(record.result.outcome), evidence: String(record.result.evidence) }] : [],
  );
}

describe("U-210: the verifier runner gets the run's unreadable paths (U-223, R-6)", () => {
  test("a run that repairs: the evidence and the repair hold no number of the unreadable source", { timeout: 90_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "private/sales.csv", SOURCE);
    const steps = [toolStep("write_file", createFileArgs("out/summary.csv", WRONG_SUMMARY)), textStep("done"), textStep("done again"), textStep("done at last"), textStep("still done")];
    // One repair (the default is none), so the failed check goes back to the model.
    const task = writeGeneralTask(
      sb,
      { id: "u210-verify", fields: { workflowRef: "analyze-private" }, policy: { unreadablePaths: ["private"] }, verifiers: [totalsCheck("private/sales.csv")], limits: { maxRepairAttempts: 1 } },
      steps,
    );
    const ran = await runGuarded(sb, ["run", "--task", task], cliEnv());
    const output = json(ran);
    assert.equal(output["kind"], "run", ran.stdout);
    const records = journalOf(sb, output["runId"] as string);
    const found = verdicts(records);
    assert.ok(found.length > 0, "the check ran");
    assert.ok(found.every((verdict) => verdict.outcome === "fail" && verdict.evidence.includes(UNREADABLE_SOURCE_NOTE)), JSON.stringify(found));
    assert.ok(records.some((record) => record.type === "repair_started"), "the failed check went back to the model");
    assert.deepEqual(findLeaks(cliOutputSources(sb.workspace, ran), SOURCE_NUMBERS), [], "no number read from the unreadable source");
  });

  test("the apply of a plan of moves: its checks after the moves hold no number of the unreadable source", { timeout: 90_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "private/sales.csv", SOURCE);
    writeWorkspaceFile(sb, "inbox/summary.csv", WRONG_SUMMARY);
    const actions = [{ kind: "move", from: "inbox/summary.csv", to: "out/summary.csv" }] as const;
    const task = writeOrganizeTask(sb, "u210-verify-apply", [toolStep("propose_plan", proposePlanArgs(actions, "move the summary")), textStep("planned")]);
    // The organize task with the unreadable paths and the check (writeOrganizeTask writes the base).
    const written = JSON.parse(readFileSync(task, "utf8")) as Record<string, unknown> & { policy: Record<string, unknown> };
    written.policy = { ...written.policy, unreadablePaths: ["private"] };
    written["verifiers"] = [totalsCheck("private/sales.csv")];
    writeFileSync(task, JSON.stringify(written));
    const planned = json(await runGuarded(sb, ["run", "--task", task], cliEnv()));
    assert.equal(planned["reason"], "plan_pending", JSON.stringify(planned));
    const digest = String((planned["plan"] as { digest: string }).digest).slice(0, 12);
    const applied = await runGuarded(sb, ["apply", "--task", task, "--run", String(planned["runId"]), "--digest", digest], cliEnv());
    const output = json(applied);
    assert.equal(output["kind"], "apply", applied.stdout);
    const records = journalOf(sb, output["runId"] as string);
    const found = verdicts(records);
    assert.ok(found.length > 0 && found.every((verdict) => verdict.outcome === "fail" && verdict.evidence.includes(UNREADABLE_SOURCE_NOTE)), JSON.stringify(found));
    assert.deepEqual(findLeaks(cliOutputSources(sb.workspace, applied), SOURCE_NUMBERS), [], "no number read from the unreadable source");
  });

  test("a source outside the unreadable paths keeps its numbers, as before", { timeout: 90_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "data/sales.csv", SOURCE);
    const steps = [toolStep("write_file", createFileArgs("out/summary.csv", WRONG_SUMMARY)), textStep("done"), textStep("done again"), textStep("done at last"), textStep("still done")];
    const task = writeGeneralTask(sb, { id: "u210-verify-public", fields: { workflowRef: "analyze-private" }, policy: { unreadablePaths: ["private"] }, verifiers: [totalsCheck("data/sales.csv")] }, steps);
    const ran = await runGuarded(sb, ["run", "--task", task], cliEnv());
    const found = verdicts(journalOf(sb, json(ran)["runId"] as string));
    assert.ok(found.length > 0 && found.every((verdict) => verdict.outcome === "fail" && !verdict.evidence.includes(UNREADABLE_SOURCE_NOTE)), JSON.stringify(found));
    assert.ok(found.some((verdict) => verdict.evidence.includes("2345.6789")), "the recomputed sum is written for a readable source");
  });
});
