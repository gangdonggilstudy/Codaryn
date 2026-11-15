/**
 * U-210, review R-108 L-2 (p4g): after Codex V-19 a query_table result on an unreadable table can show
 * a group of at least k rows but leave a value null because fewer than k cells went into it
 * (QueryGroup.fewCells). The end summary counted only results that left out whole groups
 * (suppressedGroups), so a run whose results hid only such values said nothing of what was kept from
 * the agent. Now such a result counts too (queryTableFacts tells how many shown groups had a value
 * left out, a count only), and the summary's line says what was left out: whole groups of fewer than k
 * rows, or values from fewer than k cells. Real CLI, scripted model; and the run's observer.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { JournalEvent, JournalRecord } from "../../../src/contracts/index.js";
import { queryTableFacts } from "../../../src/cli/human/index.js";
import { notePrivateData } from "../../../src/cli/run.js";
import type { RunNotes } from "../../../src/cli/run.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { cliEnv } from "../../support/cli.js";
import type { CliRun } from "../../support/cli.js";
import { runGuarded } from "../../support/fake-anthropic.js";
import { createSandbox, writeWorkspaceFile } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { textStep, toolStep, writeGeneralTask } from "../../fixtures/general-tasks.js";

const json = (run: CliRun): Record<string, unknown> => JSON.parse(run.stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;

function journalOf(sb: Sandbox, runId: string): JournalRecord[] {
  const text = readFileSync(path.join(sb.workspace, ".codaryn", "runs", runId, "journal.jsonl"), "utf8");
  return text.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as JournalRecord);
}

const baseNotes = (): RunNotes => ({ configLanguage: null, configDefault: null, deniedToolCalls: 0, deniedCommandCalls: 0, failedToolCalls: 0 });
const result = (payload: object): JournalEvent =>
  ({ type: "tool_result", result: { callId: "c1", tool: "query_table", ok: true, content: JSON.stringify(payload), errorCode: null } }) as unknown as JournalEvent;
const groups = (suppressedGroups: number, shown: readonly object[]): object => ({
  kind: "groups",
  groupBy: ["dept"],
  operations: [{ op: "sum", column: "amount" }],
  groups: shown,
  suppressedGroups,
  next: null,
  minGroupSize: 5,
});

describe("U-210 (R-108 L-2): values left out for fewer than k cells count as kept from the agent", () => {
  test("queryTableFacts tells how many shown groups had a value left out, a count only", () => {
    const facts = queryTableFacts((result(groups(0, [{ keys: ["a"], rows: 6, values: [null], fewCells: [0] }, { keys: ["b"], rows: 7, values: [12] }])) as { result: unknown }).result);
    assert.ok(facts !== null && facts.kind === "groups");
    assert.equal((facts as { hiddenValues?: number }).hiddenValues, 1);
  });

  test("the run's observer counts a result that hid only values, and one that hid only groups; not one that hid nothing", () => {
    const notes = baseNotes();
    for (const event of [
      result(groups(0, [{ keys: ["a"], rows: 6, values: [null], fewCells: [0] }])),
      result(groups(2, [{ keys: ["b"], rows: 7, values: [12] }])),
      result(groups(0, [{ keys: ["c"], rows: 9, values: [3] }])),
    ]) {
      notePrivateData(notes, event);
    }
    assert.deepEqual((notes as RunNotes & { hiddenGroups?: unknown }).hiddenGroups, { results: 2, minGroupSize: 5 });
  });

  test("on the real CLI: a group of 6 rows with 2 amounts gives no sum, and the end summary says something was left out", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    const rows = Array.from({ length: 6 }, (_, index) => `p${index},a,${index < 2 ? String(index * 1000 + 17) : ""}`);
    writeWorkspaceFile(sb, "private/people.csv", ["id,dept,amount", ...rows, ""].join("\n"));
    const task = writeGeneralTask(sb, { id: "r108-few", fields: { workflowRef: "analyze-private" }, policy: { unreadablePaths: ["private"] } }, [
      toolStep("query_table", { path: "private/people.csv", groupBy: ["dept"], operations: [{ op: "sum", column: "amount" }] }),
      textStep("done"),
    ]);
    for (const lang of ["en", "ko"] as const) {
      const ran = await runGuarded(sb, ["run", "--task", task], cliEnv({ extra: { CODARYN_LANG: lang } }));
      const output = json(ran);
      const query = journalOf(sb, String(output["runId"])).find((record) => record.type === "tool_result" && record.result.tool === "query_table");
      assert.ok(query !== undefined && query.type === "tool_result" && typeof query.result.content === "string", ran.stdout);
      const payload = JSON.parse(query.result.content as string) as { groups: { values: unknown[]; fewCells?: number[] }[]; suppressedGroups: number };
      assert.deepEqual([payload.groups.map((group) => [group.values, group.fewCells]), payload.suppressedGroups], [[[[null], [0]]], 0], "V-19 hides the sum");
      assert.equal(ran.stdout.includes("1017"), false);
      assert.ok(ran.stderr.includes(createMessageCatalog(lang).format("summary.groups_hidden", { results: 1, k: 5 })), ran.stderr);
    }
  });
});
