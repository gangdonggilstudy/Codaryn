/**
 * T-9: reclaiming a dead lock is atomic. Several runs that reclaim the same dead lock at the same
 * time end with exactly one holder, and lock.json names that holder. EPERM and EBUSY end as
 * workspace_locked, not as an exception. Review input: store-revert 1 (exp-lock.mjs).
 *
 * W-4: the crashed run's pid is a fixed number that the injected liveness check calls dead. The
 * cases used to take the pid of a process that had just exited; under the load of the whole unit
 * suite the system gave that pid to a new process, the dead lock looked held, and a round ended
 * with no winner (seen 11 times in 1,800 rounds, each time with that pid alive again).
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";

import { acquireLock } from "../../../src/store/index.js";
import { ACQUIRE_BUDGET_MS } from "./lock-budget.js";

const clock = { now: () => Date.UTC(2026, 10, 12, 6, 0, 0) };

/** The crashed run's pid. Only the injected check decides that it is dead. */
const CRASHED_PID = 4_000_001;
const crashedIsDead = (pid: number): boolean => pid !== CRASHED_PID;

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "codaryn-lock-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const lockFile = (root: string): string => join(root, ".codaryn", "lock.json");

type ContenderResult = { ok: boolean; code: string | null };

/** Every contender is ready before go, and stays alive until the parent has checked every result. */
async function withContenders(ids: readonly string[], script: string, root: string, check: (results: ContenderResult[]) => Promise<void>): Promise<void> {
  const states: { child: ReturnType<typeof spawn>; ready: Promise<void>; result: Promise<ContenderResult>; closed: Promise<number | null> }[] = [];
  const failed = Promise.withResolvers<never>();
  let fault: Error | undefined, releasing = false, allResults = false;
  const fail = (error: Error): void => { fault ??= error; failed.reject(fault); };
  void failed.promise.catch(() => undefined);
  const bounded = async <T>(pending: Promise<T>, ms = 120_000): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([pending, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("owned contenders did not reach the next phase")), ms);
      })]);
    } finally { clearTimeout(timer); }
  };
  const killOwned = (): void => {
    for (const { child } of states) if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  try {
    for (const runId of ids) {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script, runId], {
        windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"],
        env: {
          SystemRoot: "C:/Windows", WINDIR: "C:/Windows", ComSpec: join("C:/Windows", "System32/cmd.exe"),
          PATH: [dirname(process.execPath), "C:/Program Files/Git/cmd", "C:/Windows/System32", "C:/Windows/System32/WindowsPowerShell/v1.0"].join(delimiter),
          HOME: root, USERPROFILE: root, APPDATA: root, LOCALAPPDATA: root, TEMP: root, TMP: root,
        },
      });
      const ready = Promise.withResolvers<void>(), result = Promise.withResolvers<ContenderResult>(), closed = Promise.withResolvers<number | null>();
      states.push({ child, ready: ready.promise, result: result.promise, closed: closed.promise });
      let readySeen = false, resultSeen = false, stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
      child.once("error", fail);
      child.once("close", (code) => {
        closed.resolve(code);
        if (!releasing) fail(new Error(`child ${runId} closed before release: ${stderr.slice(0, 300)}`));
      });
      child.on("message", (message) => {
        const value = message as { type?: string; ok?: boolean; code?: string | null };
        if (value.type === "ready" && !readySeen) { readySeen = true; ready.resolve(); }
        else if (value.type === "result" && readySeen && !resultSeen && typeof value.ok === "boolean" && (value.code === null || typeof value.code === "string")) {
          resultSeen = true; result.resolve({ ok: value.ok, code: value.code });
        } else fail(new Error(`unexpected message from child ${runId}`));
      });
    }
    await bounded(Promise.race([Promise.all(states.map((state) => state.ready)), failed.promise]));
    for (const { child } of states) child.send("go", (error) => { if (error) fail(error); });
    const results = await bounded(Promise.race([Promise.all(states.map((state) => state.result)), failed.promise]));
    allResults = true;
    assert.ok(states.every(({ child }) => child.exitCode === null && child.signalCode === null), "all contenders stay alive while the parent checks results");
    await check(results);
    if (fault) throw fault;
  } finally {
    releasing = true;
    if (allResults) {
      for (const { child } of states) if (child.connected) child.send("release", (error) => { if (error) child.kill("SIGKILL"); });
    } else killOwned();
    const closed = Promise.all(states.map((state) => state.closed));
    try {
      const codes = await bounded(closed, 10_000);
      if (allResults) assert.ok(codes.every((code) => code === 0), `owned child exit codes: ${JSON.stringify(codes)}`);
    } catch (error) {
      killOwned();
      await bounded(closed, 10_000);
      throw error;
    }
  }
}

async function leaveDeadLock(root: string, pid: number): Promise<void> {
  await mkdir(join(root, ".codaryn"), { recursive: true });
  await writeFile(lockFile(root), `${JSON.stringify({ pid, runId: "crashed-run", startedAt: "2026-11-11T00:00:00.000Z" })}\n`);
}

test("W-4: the injected liveness check decides, so a pid given to another live process does not keep a dead lock", async () => {
  // The parent process stands for a new process that received the crashed run's pid.
  const reused = process.ppid;
  await withRoot(async (root) => {
    await leaveDeadLock(root, reused);
    const ids = ["run-a", "run-b", "run-c"];
    const outcomes = await Promise.all(
      ids.map((runId) => acquireLock({ workspaceRoot: root, runId, clock, retryForMs: ACQUIRE_BUDGET_MS, isProcessAlive: (pid) => pid !== reused })),
    );
    const winners = ids.filter((_, index) => outcomes[index]?.ok === true);
    assert.equal(winners.length, 1, `winners ${JSON.stringify(winners)}`);
    const holder = JSON.parse(await readFile(lockFile(root), "utf8")) as { runId: string };
    assert.equal(holder.runId, winners[0]);
  });
});

test("T-9: contenders reclaiming one dead lock in the same process end with exactly one holder", async () => {
  const dead = CRASHED_PID;
  for (let round = 0; round < 40; round += 1) {
    await withRoot(async (root) => {
      await leaveDeadLock(root, dead);
      const ids = ["run-a", "run-b", "run-c"];
      const outcomes = await Promise.all(
        ids.map((runId) => acquireLock({ workspaceRoot: root, runId, clock, retryForMs: ACQUIRE_BUDGET_MS, isProcessAlive: crashedIsDead })),
      );
      const winners = ids.filter((_, index) => outcomes[index]?.ok === true);
      assert.equal(winners.length, 1, `round ${round}: winners ${JSON.stringify(winners)}`);
      const holder = JSON.parse(await readFile(lockFile(root), "utf8")) as { runId: string; pid: number };
      assert.equal(holder.runId, winners[0], `round ${round}: lock.json must name the winner`);
      for (const [index, outcome] of outcomes.entries()) {
        if (outcome.ok) continue;
        assert.equal(outcome.code, "workspace_locked", `round ${round}: ${ids[index]}`);
      }
      assert.deepEqual((await readdir(join(root, ".codaryn"))).sort(), [".gitignore", "lock.json"], "no leftovers");
    });
  }
});

test("T-9: separate processes reclaiming one dead lock at the same moment end with one holder", async () => {
  const storeUrl = new URL("../../../src/store/index.js", import.meta.url).href;
  const dead = CRASHED_PID;
  for (let round = 0; round < 6; round += 1) {
    await withRoot(async (root) => {
      await leaveDeadLock(root, dead);
      const script = [
        "const go = Promise.withResolvers(), release = Promise.withResolvers(); let released = false;",
        "process.on(\"message\", (message) => { if (message === \"go\") go.resolve(); if (message === \"release\") { released = true; release.resolve(); } });",
        "process.once(\"disconnect\", () => { if (!released) process.exit(2); });",
        "const watchdog = setTimeout(() => process.exit(2), 120_000);",
        `const { acquireLock } = await import(${JSON.stringify(storeUrl)});`,
        "process.send({ type: \"ready\" });",
        "await go.promise;",
        `const outcome = await acquireLock({ workspaceRoot: ${JSON.stringify(root)}, runId: process.argv[1], clock: { now: () => 0 }, retryForMs: ${ACQUIRE_BUDGET_MS}, isProcessAlive: (pid) => pid !== ${dead} });`,
        "process.send({ type: \"result\", ok: outcome.ok, code: outcome.code ?? null });",
        "await release.promise;",
        "clearTimeout(watchdog); process.disconnect();",
      ].join(String.fromCharCode(10));
      const ids = ["proc-a", "proc-b", "proc-c"];
      await withContenders(ids, script, root, async (results) => {
        const winners = ids.filter((_, index) => results[index]?.ok === true);
        assert.equal(winners.length, 1, `round ${round}: ${JSON.stringify(results)}`);
        assert.ok(results.every((result) => result.ok || result.code === "workspace_locked"), JSON.stringify(results));
        const holder = JSON.parse(await readFile(lockFile(root), "utf8")) as { runId: string };
        assert.equal(holder.runId, winners[0]);
      });
    });
  }
});
