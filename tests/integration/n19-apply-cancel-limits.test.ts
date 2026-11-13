/**
 * U-288 (C-31 of docs/reviews/2026-11-13-design-gap-survey.md): GI-09 of docs/design/general-tasks.md
 * 10.2 and the limits of its section 13, with real CLI processes, a scripted model, no key and every
 * command behind the network guard. Product code is not changed here.
 * - GI-09: `apply --cancel-file` stops between actions. The cancel file appears once the apply's
 *   journal shows the first done action of a plan of MAX_PLAN_ACTIONS actions. The apply ends as
 *   cancelled/cancelled (exit 5); the done actions are the first n in plan order and stay; the plan
 *   is claimed; `revert` brings the first layout back byte for byte.
 * - A cancel file that is there before the apply: nothing is claimed or moved, the plan applies later.
 * - inspect_files' hash budget (MAX_INSPECT_HASH_BYTES) with real bytes: files summing to exactly
 *   64 MiB are all hashed; a file larger than what is left is not, a smaller one after it is.
 * - Only with CODARYN_IT_MEASURE=1 (it writes 4 GiB): a plan of exactly MAX_PLAN_SOURCE_BYTES, one
 *   byte more refused, and the times of the plan run, the apply and the revert. Times are
 *   diagnostics, never assertions.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { JOURNAL_FILE_NAME, MAX_INSPECT_HASH_BYTES, MAX_PLAN_ACTIONS, MAX_PLAN_SOURCE_BYTES, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../src/contracts/index.js";
import type { ApplyJournalEntryRecord, ApplyJournalRecord, JournalRecord, ScriptStep } from "../../src/contracts/index.js";
import { createSandbox, writeAt } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { UNREQUESTED_STEP, afterActions, proposePlanArgs, sha256Of, toolStep, writeGeneralTask } from "../fixtures/general-tasks.js";
import type { OrganizeAction } from "../fixtures/general-tasks.js";
import { cliEnv, describeRun, expectCliError, expectRunResult, lockPath, readRunFiles, startCli } from "../support/cli.js";
import type { CliRun, StartedCli } from "../support/cli.js";
import { runGuarded } from "../support/fake-anthropic.js";
import { applyArgs, expectApplyResult, expectPlanOutput, planArgs, planDigestOf, readApplyJournal, recordsOf, shortDigest } from "../support/general.js";
import { expectRevertOutput, treeBytes, workspaceBytes } from "../support/repair-check.js";

const MIB = 1024 * 1024;
const MEASURE = process.env["CODARYN_IT_MEASURE"] === "1";
/** Far above what 1,000 small files or 4 GiB take here, so only a stop of the product ends a run. */
const LONG_MS = 1_800_000;

/** An organize task (both plan actions) with a long time limit; the definition sets none of its own. */
function writeTask(sb: Sandbox, id: string, steps: readonly ScriptStep[]): string {
  return writeGeneralTask(
    sb,
    { id, label: "organize", goal: "sort the inbox", fields: { workflowRef: "organize" }, policy: { planActions: ["move", "discard"] }, limits: { maxDurationMs: LONG_MS } },
    steps,
  );
}

interface Planned {
  readonly sb: Sandbox;
  readonly task: string;
  readonly original: Map<string, Buffer>;
  readonly actions: readonly OrganizeAction[];
  readonly planRunId: string;
  readonly digest: string;
  /** How long the plan run took (a diagnostic). */
  readonly planMs: number;
  readonly cli: (args: readonly string[]) => Promise<CliRun>;
}

/**
 * `count` small files `in/f0000.bin`… (each with a byte that is not UTF-8) and a plan run that
 * proposed them: every tenth is discarded, the others move to `out/`.
 */
async function planned(t: TestContext, count: number): Promise<Planned> {
  const sb = createSandbox(t);
  const original = new Map<string, Buffer>();
  const actions: OrganizeAction[] = [];
  mkdirSync(join(sb.workspace, "in"));
  for (let index = 0; index < count; index += 1) {
    const path = `in/f${String(index).padStart(4, "0")}.bin`;
    const bytes = Buffer.concat([Buffer.from(`file ${index}\n`), Uint8Array.of(0xff, index % 256)]);
    writeFileSync(join(sb.workspace, path), bytes);
    original.set(path, bytes);
    actions.push(index % 10 === 9 ? { kind: "discard", path } : { kind: "move", from: path, to: path.replace("in/", "out/") });
  }
  const task = writeTask(sb, `u288-${count}`, [toolStep("propose_plan", proposePlanArgs(actions, "sort the inbox")), UNREQUESTED_STEP]);
  const cli = (args: readonly string[]): Promise<CliRun> => runGuarded(sb, args, cliEnv(), 600_000);
  const run = await cli(["run", "--task", task]);
  const plan = expectRunResult(run);
  assert.equal(plan.plan?.actions, count);
  return { sb, task, original, actions, planRunId: plan.runId, digest: planDigestOf(plan), planMs: run.durationMs, cli };
}

/** `apply --digest <12> --cancel-file <sandbox>/cancel.flag` behind the network guard. */
function startApply(p: Planned): StartedCli {
  const args = [...applyArgs(p.task, p.planRunId, shortDigest(p.digest)), "--cancel-file", p.sb.cancelFile];
  return startCli(args, { cwd: p.sb.base, env: cliEnv(), timeoutMs: 600_000, netGuardLog: join(p.sb.base, "net-guard.log") });
}

function assertNoNetwork(sb: Sandbox): void {
  const log = join(sb.base, "net-guard.log");
  assert.equal(existsSync(log) ? readFileSync(log, "utf8").trim() : "", "", "the CLI tried to reach a host");
}

/** Done actions so far in journals of runs other than the plan run (whole lines only). */
function doneSoFar(p: Planned): number {
  const runs = join(p.sb.workspace, STATE_DIR_NAME, RUNS_DIR_NAME);
  let done = 0;
  for (const id of readdirSync(runs)) {
    const file = join(runs, id, JOURNAL_FILE_NAME);
    if (id === p.planRunId || !existsSync(file)) continue;
    done += readFileSync(file, "utf8").split("\n").filter((line) => /"type":"file_(moved|discarded)".*\}$/.test(line)).length;
  }
  return done;
}

/** `plan_item_started` indexes. Stored, though no reader's type lists it (ApplyJournalEntryRecord). */
function startedIndexes(records: readonly ApplyJournalRecord[]): number[] {
  return (records as readonly ApplyJournalEntryRecord[]).flatMap((record) => (record.type === "plan_item_started" ? [record.index] : []));
}

test("U-288 GI-09 apply --cancel-file: 1,000개 계획을 항목 사이에서 멈추고, 한 것만 남고, revert로 처음 배치", { timeout: 1_200_000 }, async (t) => {
  const p = await planned(t, MAX_PLAN_ACTIONS);
  const started = startApply(p);
  let exited = false;
  started.child.once("exit", () => (exited = true));
  let doneAtCancel = 0;
  while (!exited && doneAtCancel === 0) {
    await delay(5);
    doneAtCancel = doneSoFar(p);
  }
  writeFileSync(p.sb.cancelFile, "cancel");
  const cancelAt = Date.now();
  const run = await started.done;
  const result = expectApplyResult(run, p.planRunId);
  const n = result.applied.length;
  t.diagnostic(`plan run of ${MAX_PLAN_ACTIONS} actions ${p.planMs} ms; done when the cancel file appeared ${doneAtCancel}, at the end ${n}; exit ${Date.now() - cancelAt} ms after the file`);
  assertNoNetwork(p.sb);
  assert.ok(doneAtCancel > 0, `the apply ended before an action was seen done. ${describeRun(run)}`);

  await t.test("cancelled/cancelled(종료 5), 앞의 n개만 계획 순서대로, 검증 없음, 잠금 풀림", () => {
    assert.deepEqual([result.status, result.reason, run.exitCode], ["cancelled", "cancelled", 5]);
    assert.ok(n >= doneAtCancel && n < MAX_PLAN_ACTIONS, `stopped between actions: ${n}`);
    assert.deepEqual(
      result.applied.map((item) => item.index),
      Array.from({ length: n }, (_, index) => index),
    );
    assert.deepEqual(result.verifiers, [], "nothing is checked after a cancel");
    assert.ok(result.notices.some((text) => text.includes("codaryn revert")), "the result says revert undoes the done actions");
    assert.deepEqual(workspaceBytes(p.sb.workspace), afterActions(p.original, p.actions.slice(0, n)), "only the done actions changed the workspace");
    assert.equal(existsSync(lockPath(p.sb.workspace)), false);
  });

  await t.test("기록: 끝난 항목 n개, 시작했지만 하지 않은 항목은 많아야 하나(plan_item_failed), run_finished cancelled", () => {
    const records = readApplyJournal(p.sb.workspace, result.runId);
    assert.equal(recordsOf(records, "file_moved").length + recordsOf(records, "file_discarded").length, n);
    const startedItems = startedIndexes(records);
    const failed = recordsOf(records, "plan_item_failed").map((record) => [record.index, record.problem]);
    if (startedItems.length === n) assert.deepEqual(failed, []);
    else assert.deepEqual(failed, [[n, "io_error"]], "an item the cancel reached is recorded as not done");
    assert.deepEqual(startedItems, Array.from({ length: startedItems.length }, (_, index) => index));
    assert.ok(startedItems.length === n || startedItems.length === n + 1);
    const finished = recordsOf(records, "run_finished");
    assert.deepEqual([finished.length, finished[0]?.status, finished[0]?.reason], [1, "cancelled", "cancelled"]);
  });

  await t.test("계획은 그 적용이 차지함: plan은 applied, 같은 다이제스트로 다시 apply는 plan_already_applied(무변경)", async () => {
    const shown = expectPlanOutput(await p.cli(planArgs(p.task, p.planRunId)), p.planRunId);
    assert.equal(shown.status, "applied");
    assert.equal(shown.appliedBy?.runId, result.runId);
    const before = treeBytes(p.sb.workspace);
    expectCliError(await p.cli(applyArgs(p.task, p.planRunId, p.digest)), "plan_already_applied");
    assert.deepEqual(treeBytes(p.sb.workspace), before);
  });

  await t.test("revert --run <적용 id>: n개를 되돌려 처음 배치와 바이트", async () => {
    const reverted = expectRevertOutput(await p.cli(["revert", "--workspace", p.sb.workspace, "--run", result.runId]), result.runId);
    assert.equal(reverted.status, "complete");
    assert.equal(reverted.reverted.length, n);
    assert.deepEqual(workspaceBytes(p.sb.workspace), p.original, "back to the first layout, byte for byte");
  });
});

test("U-288 GI-09 apply 전부터 있는 취소 파일: 아무것도 차지하거나 옮기지 않고, 뒤의 apply는 done", { timeout: 600_000 }, async (t) => {
  const p = await planned(t, 20);
  writeFileSync(p.sb.cancelFile, "cancel");
  const run = await startApply(p).done;
  assertNoNetwork(p.sb);
  const result = expectApplyResult(run, p.planRunId);
  assert.deepEqual([result.status, result.reason, run.exitCode], ["cancelled", "cancelled", 5]);
  assert.deepEqual(result.applied, []);
  assert.deepEqual(workspaceBytes(p.sb.workspace), p.original);
  const records = readApplyJournal(p.sb.workspace, result.runId);
  assert.deepEqual(recordsOf(records, "plan_checked"), [], "stopped before the preflight");
  assert.deepEqual(startedIndexes(records), []);
  assert.equal(recordsOf(records, "run_finished")[0]?.status, "cancelled");
  assert.equal(expectPlanOutput(await p.cli(planArgs(p.task, p.planRunId)), p.planRunId).status, "pending", "the plan is not claimed");

  rmSync(p.sb.cancelFile);
  const later = expectApplyResult(await startApply(p).done, p.planRunId);
  assert.deepEqual([later.status, later.reason, later.applied.length], ["done", "verified", 20]);
  assert.deepEqual(workspaceBytes(p.sb.workspace), afterActions(p.original, p.actions));
});

/** The inspect_files results of a run, each with the time from the record before it. */
function inspectCalls(records: readonly JournalRecord[]): { payload: { entries: { path: string; sha256?: string }[]; hashesIncomplete: boolean }; ms: number }[] {
  return records.flatMap((record, index) => {
    if (record.type !== "tool_result" || record.result.tool !== "inspect_files" || !record.result.ok) return [];
    const before = records[index - 1] as JournalRecord;
    return [{ payload: JSON.parse(record.result.content) as never, ms: Date.parse(record.at) - Date.parse(before.at) }];
  });
}

test("U-288 13절 inspect_files 해시 상한: 합계 정확히 64 MiB는 모두 해시, 남은 예산보다 큰 파일만 빠지고 뒤의 작은 파일은 해시", { timeout: 600_000 }, async (t) => {
  const sb = createSandbox(t);
  const first = Buffer.alloc(40 * MIB, "first ");
  const second = Buffer.alloc(MAX_INSPECT_HASH_BYTES - first.length, "second ");
  const larger = Buffer.concat([second, Uint8Array.of(0x37)]);
  writeAt(sb.workspace, "exact/a.bin", first);
  writeAt(sb.workspace, "exact/b.bin", second);
  writeAt(sb.workspace, "over/a.bin", first);
  writeAt(sb.workspace, "over/b.bin", larger);
  writeAt(sb.workspace, "over/c.txt", "c\n");
  const task = writeTask(sb, "u288-hash-budget", [
    toolStep("inspect_files", { path: "exact", hash: true }),
    toolStep("inspect_files", { path: "over", hash: true }),
    toolStep("propose_plan", proposePlanArgs([{ kind: "move", from: "over/c.txt", to: "c.txt" }], "move one file")),
    UNREQUESTED_STEP,
  ]);
  const result = expectRunResult(await runGuarded(sb, ["run", "--task", task], cliEnv(), 600_000));
  assert.equal(result.reason, "plan_pending");
  const [exact, over, ...rest] = inspectCalls(readRunFiles(sb.workspace, result).records);
  assert.ok(exact !== undefined && over !== undefined && rest.length === 0);
  const hashes = (call: typeof exact) => call.payload.entries.map((entry) => [entry.path, entry.sha256 ?? null]);
  assert.deepEqual(hashes(exact), [
    ["exact/a.bin", sha256Of(first)],
    ["exact/b.bin", sha256Of(second)],
  ]);
  assert.equal(exact.payload.hashesIncomplete, false);
  assert.deepEqual(hashes(over), [
    ["over/a.bin", sha256Of(first)],
    ["over/b.bin", null],
    ["over/c.txt", sha256Of("c\n")],
  ]);
  assert.equal(over.payload.hashesIncomplete, true);
  t.diagnostic(`inspect_files hashing exactly 64 MiB: ${exact.ms} ms; 40 MiB and a skipped file: ${over.ms} ms`);
});

test(
  "U-288 13절 실측(CODARYN_IT_MEASURE=1): 원본 합계 정확히 4 GiB 계획의 제안·적용·되돌리기, 1바이트 넘으면 거부",
  { skip: MEASURE ? false : "set CODARYN_IT_MEASURE=1 to measure (writes 4 GiB)", timeout: 3_600_000 },
  async (t) => {
    const sb = createSandbox(t);
    const piece = 64 * MIB;
    const pieces = MAX_PLAN_SOURCE_BYTES / piece;
    const moves: OrganizeAction[] = [];
    let at = Date.now();
    const lap = (): number => {
      const now = Date.now();
      const ms = now - at;
      at = now;
      return ms;
    };
    for (let index = 0; index < pieces; index += 1) {
      const path = `big/p${String(index).padStart(2, "0")}.bin`;
      writeAt(sb.workspace, path, Buffer.alloc(piece, `piece ${index} `));
      moves.push({ kind: "move", from: path, to: path.replace("big/", "sorted/") });
    }
    writeAt(sb.workspace, "big/extra.txt", "x");
    t.diagnostic(`wrote ${pieces} files of 64 MiB: ${lap()} ms`);
    const tooLarge = [...moves, { kind: "move", from: "big/extra.txt", to: "sorted/extra.txt" } as const];
    const task = writeTask(sb, "u288-4gib", [toolStep("propose_plan", proposePlanArgs(tooLarge, "one byte too many")), toolStep("propose_plan", proposePlanArgs(moves, "exactly 4 GiB")), UNREQUESTED_STEP]);
    const cli = (args: readonly string[]): Promise<CliRun> => runGuarded(sb, args, cliEnv(), 3_000_000);

    const planRun = await cli(["run", "--task", task]);
    const plan = expectRunResult(planRun);
    const records = readRunFiles(sb.workspace, plan).records;
    const proposals = records.flatMap((record, index) =>
      record.type === "tool_result" && record.result.tool === "propose_plan" ? [{ ok: record.result.ok, text: record.result.content, ms: Date.parse(record.at) - Date.parse((records[index - 1] as JournalRecord).at) }] : [],
    );
    assert.deepEqual(proposals.map((one) => one.ok), [false, true]);
    assert.match(proposals[0]?.text ?? "", /too_large/);
    const digest = planDigestOf(plan);
    t.diagnostic(`plan run ${lap()} ms: refused 4 GiB + 1 byte in ${proposals[0]?.ms} ms, proposed exactly 4 GiB in ${proposals[1]?.ms} ms`);

    const apply = expectApplyResult(await cli(applyArgs(task, plan.runId, shortDigest(digest))), plan.runId);
    const applyMs = lap();
    assert.deepEqual([apply.status, apply.reason, apply.applied.length, apply.verifiers[0]?.outcome], ["done", "verified", pieces, "pass"]);
    const journal = readApplyJournal(sb.workspace, apply.runId);
    const time = (type: string): number => Date.parse(journal.find((record) => record.type === type)?.at ?? "");
    const lastMove = Date.parse(recordsOf(journal, "file_moved").at(-1)?.at ?? "");
    t.diagnostic(
      `apply ${applyMs} ms: preflight ${time("plan_checked") - time("apply_started")} ms, moves ${lastMove - time("plan_checked")} ms, ` +
        `inventory check ${time("verifier_result") - lastMove} ms, then ${time("run_finished") - time("verifier_result")} ms to the end`,
    );

    const reverted = expectRevertOutput(await cli(["revert", "--workspace", sb.workspace, "--run", apply.runId]), apply.runId);
    assert.deepEqual([reverted.status, reverted.reverted.length], ["complete", pieces]);
    assert.ok(moves.every((move) => move.kind === "move" && statSync(join(sb.workspace, move.from)).size === piece));
    t.diagnostic(`revert ${lap()} ms`);
  },
);
