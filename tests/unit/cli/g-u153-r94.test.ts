/**
 * U-153 (review R-94, info I2 and the small way of I4):
 * - I2: rejecting a run whose changes were already reverted completely gave the revert command
 *   again (it ended as already_reverted: one wasted step). Now no revert line then; a run not
 *   reverted, or reverted in part, still gets it.
 * - I4: `changes` reads the task file a second time for its plan text, without the size check the
 *   first read has. Now the same check (DR-40 (b), inputFileTooLarge): a larger file gives the text
 *   as before (no plan lines), as any file it cannot read.
 * JSON as before. The real CLI with the scripted model for I2; `runChanges` with a stand-in app
 * for I4.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { TestContext } from "node:test";
import type { MessageId } from "../../../src/contracts/index.js";
import { runChanges } from "../../../src/cli/changes.js";
import type { ChangesEnvironment } from "../../../src/cli/changes.js";
import { MAX_INPUT_FILE_BYTES } from "../../../src/cli/security/keys.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { createSandbox } from "../../fixtures/builders.js";
import { analyzeScript, salesDataChecks, writeGeneralTask, writeSalesSource } from "../../fixtures/general-tasks.js";
import { cliEnv, expectRunResult } from "../../support/cli.js";
import type { CliRun } from "../../support/cli.js";
import { runGuarded } from "../../support/fake-anthropic.js";
import { reviewArgs } from "../../support/general.js";

const english = createMessageCatalog("en");
const en = (id: string, params?: Record<string, unknown>): string => (english.format as (id: MessageId, params?: Record<string, unknown>) => string)(id as MessageId, params);

describe("U-153 (R-94 I2): no revert line for a run already reverted completely", () => {
  test("rejected after a complete revert: no revert command; review --json as before", async (t: TestContext) => {
    const sb = createSandbox(t);
    writeSalesSource(sb);
    const task = writeGeneralTask(
      sb,
      { id: "u153-analyze", label: "analyze", goal: "data/sales.csv로 지역별 합계 표와 보고서를 만든다", fields: { workflowRef: "analyze" }, policy: { protectedPaths: ["data"] }, verifiers: [salesDataChecks()], limits: { maxRepairAttempts: 1 } },
      analyzeScript(),
    );
    const cli = (args: readonly string[]): Promise<CliRun> => runGuarded(sb, args, cliEnv());
    const run = expectRunResult(await cli(["run", "--task", task]));
    const before = await cli(reviewArgs(task, run.runId, "reject", undefined, false));
    assert.ok(before.stdout.includes(en("summary.next_revert", { runId: run.runId })), "not reverted yet: the command is given");
    const reverted = await cli(["revert", "--workspace", sb.workspace, "--run", run.runId]);
    assert.equal(reverted.exitCode, 0, reverted.stderr);
    const after = await cli(reviewArgs(task, run.runId, "reject", undefined, false));
    assert.equal(after.exitCode, before.exitCode);
    assert.equal(after.stdout.includes("codaryn revert"), false, after.stdout);
    const json = JSON.parse((await cli(reviewArgs(task, run.runId, "reject"))).stdout.trim()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(json).sort(), ["checklist", "exitCode", "kind", "replaced", "runId", "schemaVersion", "verdict"]);
  });
});

const RUN_ID = "20261113T000000Z-abcdef12";
const APPLY_ID = "20261113T000100Z-abcdef13";

/** runChanges for a plan run whose plan RUN_ID's apply run took up, with `taskText` as the second read. */
async function changesText(taskText: string): Promise<{ text: string; read: string[] }> {
  const read: string[] = [];
  const checked = (runId: string, extra: Record<string, unknown>) => ({ state: "checked", runId, startedAt: "2026-11-13T00:00:00.000Z", taskId: "t", status: "done", reason: "verified", changes: 0, reverted: null, ...extra });
  const app = {
    changes: async () => ({ ok: true, output: { schemaVersion: 1, kind: "changes", runId: RUN_ID, exitCode: 0, masking: "current_secrets", files: [] } }),
    listRuns: async () => ({
      ok: true,
      output: {
        schemaVersion: 1,
        kind: "runs",
        status: "listed",
        exitCode: 0,
        runs: [checked(APPLY_ID, { kind: "apply", planRunId: RUN_ID }), checked(RUN_ID, { status: "needs-input", reason: "plan_pending", appliedBy: { runId: APPLY_ID, at: "2026-11-13T00:01:00.000Z" } })],
        omitted: 0,
      },
    }),
  };
  const io = {
    argv: ["changes", "--task", "task.json", "--run", RUN_ID],
    env: {},
    app,
    messages: english,
    cwd: "/u153",
    readFile: async (file: string) => {
      read.push(file);
      return taskText;
    },
  } as unknown as ChangesEnvironment;
  const outcome = await runChanges(io);
  assert.ok("text" in outcome, JSON.stringify(outcome));
  return { text: outcome.text, read };
}

describe("U-153 (R-94 I4): the second task read has the first read's size check", () => {
  test("a task file of normal size: the plan lines", async () => {
    const { text, read } = await changesText(JSON.stringify({ workspaceRoot: "./work" }));
    assert.equal(read.length, 1);
    assert.ok(text.includes(en("changes.plan_only")) && text.includes(en("changes.plan_applied", { runId: APPLY_ID })), text);
  });

  test("a task file over the cap: the text as before, without the plan lines", async () => {
    const big = JSON.stringify({ workspaceRoot: "./work", pad: "x".repeat(MAX_INPUT_FILE_BYTES) });
    const { text } = await changesText(big);
    assert.equal(text.includes(en("changes.plan_only")), false, text.slice(0, 400));
    assert.ok(text.includes(en("changes.none")), text.slice(0, 400));
  });
});
