/**
 * U-194 (U-176; report smoke-flake): releasing the workspace lock while another process holds the
 * lock file open without delete sharing (as a scanner or an indexer may) at the moment the run ends.
 * U-176: the release reads and removes the lock again after 25, 50, 100, 200 and 400 ms when that
 * fails with EPERM or EBUSY (775 ms in all), then throws; the lock then stays and is judged as any
 * other (held while the process lives, stale once it has ended, when the next acquire reclaims it).
 * - held briefly (100 ms after the run wrote its result, so a slow holder still lets go within the tries): the run ends done, the lock is gone, the
 *   next run starts and ends done;
 * - held long (4 s): the run's records are complete (result.json done). U-220: the CLI prints the
 *   run's own result and exits with its code, and the end summary says lock.release_failed (it was
 *   internal_error before); the lock is left with the ended CLI's pid, doctor calls it stale, and the
 *   next run reclaims it.
 * Windows only: elsewhere removing a file another process has open does not fail. The holder is a
 * PowerShell process ([IO.File]::Open with FileShare.Read); the time bounds are generous.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { createMessageCatalog } from "../../src/i18n/index.js";
import { createSandbox } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { createFileArgs, textStep, toolStep, writeGeneralTask } from "../fixtures/general-tasks.js";
import { cliEnv, waitFor } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { runGuarded } from "../support/fake-anthropic.js";

const WINDOWS = process.platform === "win32";

/**
 * Starts a holder that waits for <workspace>/.codaryn/lock.json, opens it without delete sharing,
 * waits until a result.json appears under the run records (the run is about to release its lock)
 * and keeps holding `holdMs` more. It writes "ready" when it waits and a line to its log at the end.
 */
function startHolder(t: TestContext, sb: Sandbox, holdMs: number): { readonly child: ChildProcess; readonly ready: string; readonly log: string } {
  const state = path.join(sb.workspace, ".codaryn");
  const ready = path.join(sb.base, "holder-ready.txt");
  const log = path.join(sb.base, "holder.log");
  const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`;
  const script = [
    `$lock = Join-Path ${quote(state)} 'lock.json'; $runs = Join-Path ${quote(state)} 'runs'`,
    `[IO.File]::WriteAllText(${quote(ready)}, 'r')`,
    "$end = [DateTime]::Now.AddSeconds(60); $f = $null",
    "while ($f -eq $null -and [DateTime]::Now -lt $end) { if ([IO.File]::Exists($lock)) { try { $f = [IO.File]::Open($lock, 'Open', 'Read', 'Read') } catch {} } }",
    `if ($f -eq $null) { [IO.File]::WriteAllText(${quote(log)}, 'never held'); exit 0 }`,
    "while (-not ([IO.Directory]::Exists($runs) -and @([IO.Directory]::GetFiles($runs, 'result.json', 'AllDirectories')).Count -gt 0) -and [DateTime]::Now -lt $end) { Start-Sleep -Milliseconds 5 }",
    "$seen = [DateTime]::Now",
    `Start-Sleep -Milliseconds ${holdMs}`,
    "$f.Close()",
    `[IO.File]::WriteAllText(${quote(log)}, 'held ' + [int]([DateTime]::Now - $seen).TotalMilliseconds + ' ms after the result')`,
  ].join("; ");
  const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore", windowsHide: true });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  return { child, ready, log };
}

const ended = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve() : child.once("exit", () => resolve())));

/** A task that writes one file and checks it, so a run that goes through ends done. */
function task(sb: Sandbox, file: string): string {
  return writeGeneralTask(
    sb,
    { id: "u194-lock", verifiers: [{ id: "made", kind: "file_rules", rules: [{ type: "exists", path: file }] }] },
    [toolStep("write_file", createFileArgs(file, "x\n")), textStep("done")],
  );
}

function lastJson(run: CliRun): { kind: string; runId?: string; status?: string; reason?: string; code?: string } {
  return JSON.parse(run.stdout.trim().split("\n").pop() ?? "{}") as { kind: string; runId?: string; status?: string; reason?: string; code?: string };
}

const lockFile = (sb: Sandbox): string => path.join(sb.workspace, ".codaryn", "lock.json");

test("U-194: the lock file held briefly when the run releases it: the run ends done, the lock goes, the next run starts", { timeout: 120_000, skip: WINDOWS ? false : "only Windows refuses to remove a file another process holds" }, async (t) => {
  const sb = createSandbox(t);
  const holder = startHolder(t, sb, 100);
  await waitFor(() => existsSync(holder.ready), 30_000, "the holder waiting");
  const first = await runGuarded(sb, ["run", "--task", task(sb, "one.txt")], cliEnv(), 60_000);
  await ended(holder.child);
  const log = existsSync(holder.log) ? readFileSync(holder.log, "utf8") : "no log";
  t.diagnostic(`holder: ${log}; run ${first.durationMs} ms`);
  assert.match(log, /^held \d+ ms after the result$/, "the holder held the lock file when the run released it");
  const output = lastJson(first);
  assert.deepEqual([output.kind, output.status, output.reason, first.exitCode], ["run", "done", "verified", 0], first.stdout + first.stderr);
  assert.equal(existsSync(lockFile(sb)), false, "the release went through after its tries");
  const second = await runGuarded(sb, ["run", "--task", task(sb, "two.txt")], cliEnv(), 60_000);
  const next = lastJson(second);
  assert.deepEqual([next.kind, next.status, second.exitCode], ["run", "done", 0], second.stdout + second.stderr);
  assert.equal(existsSync(lockFile(sb)), false);
});

/**
 * Z-1 (src/store/lock.ts, processStartTime): the lock's holder is judged by `process.kill(pid, 0)`
 * and, when that pid lives, by its start time. Under load another process may meanwhile get the
 * ended CLI's pid, and Windows PowerShell may answer its start time after START_QUERY_TIMEOUT_MS;
 * the judgment then says "held" (unknown, so held: the product's safe side). The test, which knows
 * from its own child handle that the CLI ended, asks again a bounded number of times: only that
 * answer (doctor's held, a run's workspace_locked) is asked again, and the last answer must still
 * be stale and done.
 */
const JUDGE_TRIES = 4;
const JUDGE_PAUSE_MS = 1_500;
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test("U-194, U-220: the lock file held long: the run's result stands and the summary says the lock was left; the lock is stale and the next run reclaims it", { timeout: 180_000, skip: WINDOWS ? false : "only Windows refuses to remove a file another process holds" }, async (t) => {
  const sb = createSandbox(t);
  const holder = startHolder(t, sb, 4_000);
  await waitFor(() => existsSync(holder.ready), 30_000, "the holder waiting");
  const first = await runGuarded(sb, ["run", "--task", task(sb, "one.txt")], cliEnv(), 60_000);
  await ended(holder.child);
  const log = existsSync(holder.log) ? readFileSync(holder.log, "utf8") : "no log";
  t.diagnostic(`holder: ${log}; run ${first.durationMs} ms; stderr: ${first.stderr.trim().split("\n").slice(-2).join(" | ")}`);
  assert.match(log, /^held \d+ ms after the result$/);
  const output = lastJson(first);
  // The run wrote its result before the release; the release gave up after its tries. U-220: the
  // CLI prints the run's own result and exits with its code; the end summary says the lock was left.
  assert.deepEqual([output.kind, output.status, output.reason, first.exitCode], ["run", "done", "verified", 0], first.stdout + first.stderr);
  assert.ok(first.stderr.includes(createMessageCatalog("en").format("lock.release_failed")), first.stderr);
  assert.ok(!first.stderr.includes("internal_error"), first.stderr);
  const runs = path.join(sb.workspace, ".codaryn", "runs");
  const recorded = JSON.parse(readFileSync(path.join(runs, readdirOne(runs), "result.json"), "utf8")) as { runId: string; status: string; reason: string };
  assert.deepEqual([recorded.status, recorded.reason], ["done", "verified"], "the run's own records are complete");
  assert.equal(output.runId, recorded.runId, "the printed result is the stored one");
  // The lock stays with the CLI's pid; that process has ended, so the lock is stale.
  assert.ok(existsSync(lockFile(sb)), "the lock file is left");
  // The CLI that left it is this test's own child: its handle closed with an exit code, so it ended.
  assert.equal(typeof first.exitCode, "number", "the CLI that left the lock has ended");
  assert.equal((JSON.parse(readFileSync(lockFile(sb), "utf8")) as { pid?: unknown }).pid, first.pid, "the lock was left by that CLI");
  type LockCheck = { id: string; status: string; text?: { id: string } };
  let lock: LockCheck | undefined;
  const answers: string[] = [];
  for (let attempt = 1; attempt <= JUDGE_TRIES; attempt++) {
    const doctor = await runGuarded(sb, ["doctor", "--task", task(sb, "two.txt"), "--json"], cliEnv(), 60_000);
    lock = (JSON.parse(doctor.stdout.trim()) as { checks: LockCheck[] }).checks.find((check) => check.id === "lock");
    answers.push(lock?.text?.id ?? "none");
    if (lock?.text?.id !== "doctor.lock.held" || attempt === JUDGE_TRIES) break;
    await pause(JUDGE_PAUSE_MS);
  }
  t.diagnostic(`doctor lock answers: ${answers.join(", ")}`);
  assert.equal(lock?.text?.id, "doctor.lock.stale", JSON.stringify({ lock, answers }));
  // The next run reclaims the stale lock and goes through. It judges the holder by the same rule.
  let second: Awaited<ReturnType<typeof runGuarded>> | undefined;
  let next: ReturnType<typeof lastJson> = { kind: "none" };
  const outcomes: string[] = [];
  for (let attempt = 1; attempt <= JUDGE_TRIES; attempt++) {
    second = await runGuarded(sb, ["run", "--task", task(sb, "two.txt")], cliEnv(), 60_000);
    next = lastJson(second);
    outcomes.push(`${next.kind}/${next.status ?? next.code ?? "?"}`);
    if (next.code !== "workspace_locked" || attempt === JUDGE_TRIES) break;
    await pause(JUDGE_PAUSE_MS);
  }
  t.diagnostic(`next run outcomes: ${outcomes.join(", ")}`);
  assert.deepEqual([next.kind, next.status, second?.exitCode], ["run", "done", 0], JSON.stringify(outcomes) + (second?.stdout ?? "") + (second?.stderr ?? ""));
  assert.equal(existsSync(lockFile(sb)), false, "released by the next run");
});

/** The one run folder in `runs`. */
function readdirOne(runs: string): string {
  const names = readdirSync(runs);
  assert.equal(names.length, 1, JSON.stringify(names));
  return names[0] ?? "";
}
