/**
 * U-210, review R-108 H-1 (p4g): the run that carries out an approved `run` plan made its policy gate
 * without the run's unreadable paths (src/cli/assemble.ts, approvedPlan.policyFor). The gate then saw
 * only the task policy's own entries, so under a task file the config file's entries (R-2: always
 * united) did not bind it: a read_file under them was allowed while the plan was carried out and the
 * cells went to the model. The tool runner and the verifier runner had the list; the gate did not.
 * Now every part of a run that judges or reads gets the run's list and k from one place, and on the
 * real CLI (scripted model) the carried-out run refuses that read as unreadable_path, its search
 * leaves the table out, and the canary of the table is in no record, result or output. The plan run
 * refused the same read before, which stays.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { JournalRecord } from "../../../src/contracts/index.js";
import { cliEnv } from "../../support/cli.js";
import type { CliRun } from "../../support/cli.js";
import { cliOutputSources, runGuarded } from "../../support/fake-anthropic.js";
import { findLeaks } from "../../support/leak.js";
import { writeConfigFile } from "../../fixtures/anthropic.js";
import { createSandbox, writeWorkspaceFile } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { sha256Of, textStep, toolStep, writeGeneralTask } from "../../fixtures/general-tasks.js";

const LIMITS = { maxModelTurns: 8, maxToolCalls: 24, maxTotalTokens: 1000, maxDurationMs: 60_000 };
const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };
/** Made at run time, letters and digits only. */
const CANARY = `cnry${randomBytes(6).toString("hex")}`;

const json = (run: CliRun): Record<string, unknown> => JSON.parse(run.stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;

function journalOf(sb: Sandbox, runId: string): JournalRecord[] {
  const text = readFileSync(path.join(sb.workspace, ".codaryn", "runs", runId, "journal.jsonl"), "utf8");
  return text.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as JournalRecord);
}

const decisions = (records: readonly JournalRecord[]): string[] =>
  records.flatMap((record) => (record.type === "tool_decision" ? [`${record.tool}:${record.allowed ? "allowed" : record.code}`] : []));

describe("U-210 (R-108 H-1): the run that carries out a plan has the run's unreadable paths at its gate", () => {
  test("the config file's entries under a task file: the carried-out run refuses the read, and no cell leaves", { timeout: 90_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "docs/guide.md", "old guide\n");
    writeWorkspaceFile(sb, "private/people.csv", `name,phone\nrow ${CANARY},010\n`);
    const config = writeConfigFile(
      sb,
      {
        schemaVersion: 1,
        limits: LIMITS,
        policy: { ...POLICY, unreadablePaths: ["private"] },
        workflows: { rewrite: { tools: ["read_file", "search_files", "write_file", "propose_changes"], plan: "run" } },
      },
      "c.json",
    );
    // The task file's own policy has no unreadable entry: only the config file's binds the run (R-2).
    const task = writeGeneralTask(sb, { id: "r108-carried", goal: "rewrite the guide", fields: { workflowRef: "rewrite" } }, [
      toolStep("read_file", { path: "private/people.csv" }),
      toolStep("propose_changes", { summary: "rewrite the guide", files: [{ path: "docs/guide.md", change: "modify" }] }),
      textStep("planned"),
    ]);
    const made = json(await runGuarded(sb, ["run", "--task", task, "--config", config], cliEnv()));
    assert.equal(made["reason"], "plan_pending", JSON.stringify(made));
    assert.deepEqual(decisions(journalOf(sb, String(made["runId"]))), ["read_file:unreadable_path", "propose_changes:allowed"], "the plan run refused the read");

    writeFileSync(
      sb.scriptPath,
      JSON.stringify({
        schemaVersion: 1,
        steps: [
          toolStep("read_file", { path: "private/people.csv" }),
          toolStep("search_files", { path: ".", text: "row" }),
          toolStep("write_file", { path: "docs/guide.md", expectedHash: sha256Of("old guide\n"), change: { kind: "replace_all", content: "new guide\n" } }),
          textStep("done"),
        ],
      }),
    );
    const digest = String((made["plan"] as { digest: string }).digest).slice(0, 12);
    const carried = await runGuarded(sb, ["apply", "--task", task, "--config", config, "--run", String(made["runId"]), "--digest", digest], cliEnv());
    const output = json(carried);
    assert.equal(output["planRunId"], made["runId"], carried.stdout);
    const records = journalOf(sb, String(output["runId"]));
    assert.deepEqual(decisions(records), ["read_file:unreadable_path", "search_files:allowed", "write_file:allowed"]);
    const search = records.find((record) => record.type === "tool_result" && record.result.tool === "search_files");
    assert.ok(search !== undefined && search.type === "tool_result" && typeof search.result.content === "string");
    const found = JSON.parse(search.result.content as string) as { entries: { path: string }[]; withheld?: boolean };
    assert.deepEqual([found.entries.map((entry) => entry.path), found.withheld], [[], true], "the table's line is left out of the search");
    assert.deepEqual(findLeaks(cliOutputSources(sb.workspace, carried), [CANARY]), [], "no cell of the unreadable table in a record, a result or the output");
    assert.equal(readFileSync(path.join(sb.workspace, "docs", "guide.md"), "utf8"), "new guide\n", "the planned write went through");
  });
});
