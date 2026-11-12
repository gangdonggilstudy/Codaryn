/**
 * N-E E-6 and review R-2 (M-2): the run list and `--run latest` (N-7, N-16, N-18, N-23, N-26;
 * docs/cli-contract.md 17.3 and 17.6). The R-2 input is a run directory written by someone else
 * (support/forged-run.ts): it claims to have created the user's `notes.md`, so reverting it would
 * delete that file. Scripted model, no key, every command behind the network guard.
 */

import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  CLI_ERROR_EXIT_CODES,
  REVERT_RECORD_FILE_NAME,
  RUNS_DIR_NAME,
  RUNS_MAX_LIMIT,
  STATE_DIR_NAME,
} from "../../src/contracts/index.js";
import type { RunListEntry } from "../../src/contracts/index.js";
import { createSandbox, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { FORGED_FUTURE_AT, FORGED_FUTURE_RUN_ID, FORGED_MISMATCH_RUN_ID } from "../fixtures/review-inputs.js";
import { REPO_ROOT, cliEnv, expectCliError, expectRunResult, lockPath, startCli, waitFor } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { expectReportOutput } from "../support/commands.js";
import { runGuarded } from "../support/fake-anthropic.js";
import { forgeRun } from "../support/forged-run.js";
import { expectRevertOutput, treeBytes, workspaceBytes } from "../support/repair-check.js";
import { expectRunsOutput } from "../support/usability.js";

function cli(sb: Sandbox, args: readonly string[]): Promise<CliRun> {
  return runGuarded(sb, args, cliEnv());
}

interface DemoRun {
  readonly sb: Sandbox;
  readonly workspace: string;
  readonly task: string;
  readonly runId: string;
  /** Workspace bytes after the run. */
  readonly afterRun: Map<string, Buffer>;
}

/** Copies the demo out of the repository and runs it once. */
async function demoRun(t: TestContext): Promise<DemoRun> {
  const sb = createSandbox(t);
  const demo = join(sb.base, "demo");
  cpSync(join(REPO_ROOT, "examples", "demo"), demo, { recursive: true });
  const workspace = join(demo, "workspace");
  const task = join(demo, "task.json");
  const result = expectRunResult(await cli(sb, ["run", "--task", task]), "scripted");
  return { sb, workspace, task, runId: result.runId, afterRun: workspaceBytes(workspace) };
}

function checked(entry: RunListEntry | undefined): Extract<RunListEntry, { state: "checked" }> {
  if (entry === undefined || entry.state !== "checked") assert.fail(`expected a checked entry, got ${JSON.stringify(entry)}`);
  return entry;
}

/**
 * A run id and first-record time for the current second (not in the future, which would make it
 * damaged). Callers wait past the second of any run it must come after.
 */
function nowRunId(suffix: string): { readonly runId: string; readonly at: string } {
  const at = new Date(Math.floor(Date.now() / 1000) * 1000);
  const iso = at.toISOString();
  const compact = iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return { runId: `${compact}-${suffix}`, at: iso };
}

test("R-2 위조된 실행은 손상으로 표시되고 latest가 되지 않으며, id를 지정해도 되돌리지 않는다(N-23 (b), N-26)", { timeout: 120_000 }, async (t) => {
  const d = await demoRun(t);
  const notes = join(d.workspace, "notes.md");
  const notesBytes = readFileSync(notes);
  forgeRun(d.workspace, { templateRunId: d.runId, runId: FORGED_FUTURE_RUN_ID, at: FORGED_FUTURE_AT, claimsCreated: "notes.md" });
  forgeRun(d.workspace, { templateRunId: d.runId, runId: FORGED_MISMATCH_RUN_ID, at: "2026-01-01T00:00:00.000Z", claimsCreated: "notes.md" });
  const futureWithResult = "20991230T000000Z-feedc0de";
  forgeRun(d.workspace, { templateRunId: d.runId, runId: futureWithResult, at: "2099-12-30T00:00:00.000Z", claimsCreated: "notes.md", withResult: true });

  await t.test("runs: 정상 실행이 먼저, 위조 셋은 손상(실행 id만)", async () => {
    const output = expectRunsOutput(await cli(d.sb, ["runs", "--workspace", d.workspace, "--json"]));
    assert.equal(checked(output.runs[0]).runId, d.runId);
    const damaged = output.runs.filter((entry) => entry.state === "damaged").map((entry) => entry.runId).sort();
    assert.deepEqual(damaged, [FORGED_MISMATCH_RUN_ID, futureWithResult, FORGED_FUTURE_RUN_ID].sort());
    for (const entry of output.runs.filter((item) => item.state === "damaged")) {
      assert.deepEqual(Object.keys(entry).sort(), ["runId", "state"], "a damaged entry holds its run id only");
    }
  });

  await t.test("id를 지정한 되돌리기도 invalid_run_record, notes.md 그대로(N-26)", async () => {
    for (const runId of [FORGED_FUTURE_RUN_ID, FORGED_MISMATCH_RUN_ID, futureWithResult]) {
      const before = treeBytes(d.workspace);
      const run = await cli(d.sb, ["revert", "--workspace", d.workspace, "--run", runId]);
      expectCliError(run, "invalid_run_record");
      assert.equal(run.exitCode, CLI_ERROR_EXIT_CODES.invalid_run_record);
      assert.deepEqual(treeBytes(d.workspace), before, `${runId}: nothing changed, not even a revert record`);
    }
    assert.deepEqual(readFileSync(notes), notesBytes);
  });

  await t.test("revert --run latest는 정상 실행을 골라 그 실행이 만든 summary.md만 지운다", async () => {
    const dry = expectRevertOutput(await cli(d.sb, ["revert", "--workspace", d.workspace, "--run", "latest", "--dry-run"]), d.runId);
    assert.equal(dry.dryRun, true);
    const run = await cli(d.sb, ["revert", "--workspace", d.workspace, "--run", "latest"]);
    const output = expectRevertOutput(run, d.runId);
    assert.deepEqual(output.reverted, [{ path: "summary.md", action: "deleted" }]);
    assert.ok(run.stderr.includes(d.runId), "the chosen run is named on stderr");
    assert.deepEqual(readFileSync(notes), notesBytes, "the user's notes.md survives");
    assert.equal(existsSync(join(d.workspace, "summary.md")), false);
  });
});

test("R-2 결과 파일이 없는 실행은 시각이 정상이어도 latest 후보가 아니다(N-23 (b))", { timeout: 120_000 }, async (t) => {
  const d = await demoRun(t);
  await delay(1100);
  const later = nowRunId("cafef00d");
  forgeRun(d.workspace, { templateRunId: d.runId, runId: later.runId, at: later.at, claimsCreated: "notes.md" });
  const output = expectRunsOutput(await cli(d.sb, ["runs", "--workspace", d.workspace, "--json"]));
  const entry = output.runs.find((item) => item.runId === later.runId);
  assert.equal(entry?.state, "checked", "a run without result.json is not damaged");
  assert.equal(checked(entry).status, null);
  expectReportOutput(await cli(d.sb, ["report", "--workspace", d.workspace, "--run", "latest", "--json"]), d.runId);
});

test("N-23 (g) 되돌리기 기록만 손상된 실행은 따로 표시하고 되돌리기는 진행한다", { timeout: 120_000 }, async (t) => {
  const d = await demoRun(t);
  expectRevertOutput(await cli(d.sb, ["revert", "--workspace", d.workspace, "--run", d.runId]), d.runId);
  const record = join(d.workspace, STATE_DIR_NAME, RUNS_DIR_NAME, d.runId, REVERT_RECORD_FILE_NAME);
  writeFileSync(record, "{ not json");
  const entry = checked(expectRunsOutput(await cli(d.sb, ["runs", "--workspace", d.workspace, "--json"])).runs[0]);
  assert.equal(entry.runId, d.runId);
  assert.equal(entry.revertRecordDamaged, true);
  assert.equal(entry.reverted, null);
  const again = await cli(d.sb, ["revert", "--workspace", d.workspace, "--run", d.runId]);
  const output = expectRevertOutput(again, d.runId);
  assert.equal(output.status, "complete", "the revert goes on without the damaged record");
  assert.equal(output.revertedBefore, undefined, "a damaged record is not quoted");
});

test("N-E E-6 실행 목록의 경계: 기록 없음, latest 없음, latest라는 디렉터리, --limit, 실행 중 목록", { timeout: 180_000 }, async (t) => {
  await t.test("상태 디렉터리가 없으면 빈 목록이고 만들지 않는다. latest는 run_not_found", async (st) => {
    const sb = createSandbox(st);
    writeWorkspaceFile(sb, "README.md", "# a\n");
    const output = expectRunsOutput(await cli(sb, ["runs", "--workspace", sb.workspace, "--json"]));
    assert.deepEqual(output.runs, []);
    assert.equal(existsSync(join(sb.workspace, STATE_DIR_NAME)), false);
    for (const args of [
      ["report", "--workspace", sb.workspace, "--run", "latest"],
      ["revert", "--workspace", sb.workspace, "--run", "latest"],
    ]) {
      const run = await cli(sb, args);
      expectCliError(run, "run_not_found");
      assert.equal(run.exitCode, CLI_ERROR_EXIT_CODES.run_not_found);
    }
    assert.equal(existsSync(join(sb.workspace, STATE_DIR_NAME)), false);
  });

  await t.test("runs/latest 디렉터리가 있으면 --run latest는 invalid_arguments, 무변경(N-18)", async (st) => {
    const d = await demoRun(st);
    mkdirSync(join(d.workspace, STATE_DIR_NAME, RUNS_DIR_NAME, "latest"));
    const before = treeBytes(d.workspace);
    for (const args of [
      ["report", "--workspace", d.workspace, "--run", "latest"],
      ["revert", "--workspace", d.workspace, "--run", "latest"],
      ["revert", "--workspace", d.workspace, "--run", "latest", "--dry-run"],
    ]) {
      expectCliError(await cli(d.sb, args), "invalid_arguments");
    }
    assert.deepEqual(treeBytes(d.workspace), before);
    assert.deepEqual(workspaceBytes(d.workspace), d.afterRun);
  });

  await t.test("--limit: 최신순으로 자르고 나머지 수를 알린다. 범위 밖은 invalid_arguments", async (st) => {
    const sb = createSandbox(st);
    writeWorkspaceFile(sb, "README.md", "# a\n");
    const task = writeTask(sb, { id: "e6-limit", verifiers: [{ id: "r", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] }] }, [{ text: "끝" }]);
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) ids.push(expectRunResult(await cli(sb, ["run", "--task", task])).runId);
    const output = expectRunsOutput(await cli(sb, ["runs", "--workspace", sb.workspace, "--limit", "2", "--json"]));
    assert.deepEqual(output.runs.map((entry) => entry.runId), [ids[2], ids[1]], "newest first");
    assert.equal(output.omitted, 1);
    for (const limit of ["0", String(RUNS_MAX_LIMIT + 1), "x"]) {
      expectCliError(await cli(sb, ["runs", "--workspace", sb.workspace, "--limit", limit, "--json"]), "invalid_arguments");
    }
  });

  await t.test("실행이 잠금을 쥐고 있어도 runs는 동작하고 그 실행을 결과 없이 보인다", async (st) => {
    const sb = createSandbox(st);
    writeWorkspaceFile(sb, "README.md", "# a\n");
    const task = writeTask(sb, { id: "e6-live", verifiers: [{ id: "r", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] }] }, [
      { text: "잠금을 쥐고 기다린다", delayMs: 3000 },
      { text: "끝" },
    ]);
    const live = startCli(["run", "--task", task], { cwd: sb.base, env: cliEnv(), timeoutMs: 60_000 });
    await waitFor(() => existsSync(lockPath(sb.workspace)), 20_000, "the run holds the lock");
    const output = expectRunsOutput(await cli(sb, ["runs", "--workspace", sb.workspace, "--json"]));
    assert.equal(output.runs.length, 1);
    assert.equal(checked(output.runs[0]).status, null, "no result yet");
    assert.ok(existsSync(lockPath(sb.workspace)), "runs takes no lock and leaves the run's lock alone");
    expectRunResult(await live.done);
  });
});
