/**
 * Unit U-211, Codex V-17 H-1: the app's releases of one lock run one at a time.
 * Codex's reproduction (verify-V17-a4.md, locks.mjs "race"): the later try of U-211 read the lock,
 * found this process and this id, and was about to remove it; meanwhile a second release of the same
 * id removed it and a next owner took the workspace (this process's next run, or another process,
 * even with the same id string); then the paused removal went on and removed the next owner's lock.
 * The store's release checks the holder and then removes the file; the two steps are not one, so two
 * releases of one lock at once are not safe. Now every release the app makes of a lock it holds goes
 * through one queue per lock (workspace and id):
 * - a release asked while another of that lock is under way waits for it and shares its answer;
 * - the later tries run only once no release of that lock is under way, and once a release answered
 *   (removed, or not this id's lock) they end without asking the store again;
 * - one set of later tries per lock: a second request while they are pending joins them.
 * Here the removal of lock.json is paused at the file system (only there, as Codex's script does);
 * the next owners are real acquires, in this process and in child processes. Reproduced first (todo
 * until the app's releases of one lock were queued). Temporary folders, the real store, fake values only.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, describe, test } from "node:test";

import * as lockRetry from "../../../src/app/lock-retry.js";
import { retryLockRelease } from "../../../src/app/lock-retry.js";
import { acquireLock, releaseLock as storeReleaseLock } from "../../../src/store/index.js";

const TODO = { todo: "V-17 H-1: the app's releases of one lock are queued" };

type Lock = { readonly workspaceRoot: string; readonly runId: string };
type Release = (lock: Lock) => Promise<boolean>;
/** The app's release of a lock it holds (one queue per lock); before the fix there was none, so the store's own. */
const appRelease = (release?: Release): Release => {
  const own = (lockRetry as unknown as Record<string, unknown>)["releaseOwnLock"] as ((lock: Lock, release?: Release) => Promise<boolean>) | undefined;
  return (lock) => (own === undefined ? (release ?? storeReleaseLock)(lock) : own(lock, release));
};

const A = "20261113T100000Z-u211v17a";
const B = "20261113T100001Z-u211v17b";
const C = "20261113T100002Z-u211v17c";
const clock = { now: () => Date.now() };
const here = path.dirname(fileURLToPath(import.meta.url));
const STORE_URL = pathToFileURL(path.join(here, "..", "..", "..", "src", "store", "index.js")).href;

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const dir = realpathSync.native(await mkdtemp(path.join(tmpdir(), "codaryn-u211v17-")));
  temporaryDirs.push(dir);
  return dir;
}
const lockFileOf = (root: string): string => path.join(root, ".codaryn", "lock.json");
const holderOf = (root: string): { pid: number; runId: string } | null => {
  try {
    return JSON.parse(readFileSync(lockFileOf(root), "utf8")) as { pid: number; runId: string };
  } catch {
    return null;
  }
};
const deferred = <T = void>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const turns = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function acquired(root: string, runId: string): Promise<void> {
  const taken = await acquireLock({ workspaceRoot: root, runId, clock, retryForMs: 100 });
  assert.ok(taken.ok, JSON.stringify(taken));
}

const require = createRequire(import.meta.url);
const promises: { rm: typeof import("node:fs/promises").rm } = require("node:fs/promises");

/** The first removal of `file` waits at the file system until `resume`; every other removal is real. */
function pauseFirstRemoval(file: string): { readonly paused: Promise<void>; readonly resume: () => void; readonly restore: () => void } {
  const target = path.resolve(file).toLowerCase();
  const original = promises.rm;
  const paused = deferred();
  const resumed = deferred();
  let intercepted = false;
  promises.rm = async (where, options) => {
    if (!intercepted && path.resolve(String(where)).toLowerCase() === target) {
      intercepted = true;
      paused.resolve();
      await resumed.promise;
    }
    return original(where, options);
  };
  syncBuiltinESMExports();
  return {
    paused: paused.promise,
    resume: () => resumed.resolve(),
    restore: () => {
      resumed.resolve();
      promises.rm = original;
      syncBuiltinESMExports();
    },
  };
}

/** Another process tries once to take the lock of `root` as `runId`; when it does, it holds it until `stop`. */
async function childOwner(root: string, runId: string): Promise<{ readonly ok: boolean; readonly pid: number; readonly stop: () => Promise<void> }> {
  const script = [
    `import { acquireLock, releaseLock } from ${JSON.stringify(STORE_URL)};`,
    "const root = process.env.U211_ROOT; const runId = process.env.U211_RUN;",
    "const taken = await acquireLock({ workspaceRoot: root, runId, clock: { now: () => Date.now() }, retryForMs: 0 });",
    "process.stdout.write(JSON.stringify({ ok: taken.ok }) + '\\n');",
    "if (taken.ok) { process.stdin.resume(); process.stdin.on('end', async () => { await releaseLock({ workspaceRoot: root, runId }); process.exit(0); }); }",
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, U211_ROOT: root, U211_RUN: runId }, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  // A child that did not take the lock has ended; closing its input then is not an error here.
  child.stdin?.on("error", () => undefined);
  const answer = await new Promise<{ ok: boolean }>((resolve, reject) => {
    let text = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      text += chunk.toString();
      if (text.includes("\n")) resolve(JSON.parse(text.split("\n")[0]!) as { ok: boolean });
    });
    child.once("exit", () => reject(new Error("the child ended before it answered")));
  });
  return {
    ok: answer.ok,
    pid: child.pid ?? -1,
    stop: async () => {
      child.stdin?.end();
      await exited;
    },
  };
}

/** A next owner of the workspace: this process's next run, or a child process with another id or the same id string. */
type Owner = "same-process-next" | "child-next" | "child-same-id";
async function nextOwner(root: string, owner: Owner): Promise<{ readonly ok: boolean; readonly pid: number; readonly runId: string; readonly stop: () => Promise<void> }> {
  if (owner === "same-process-next") {
    const taken = await acquireLock({ workspaceRoot: root, runId: B, clock, retryForMs: 0 });
    return { ok: taken.ok, pid: process.pid, runId: B, stop: async () => void (taken.ok ? await storeReleaseLock({ workspaceRoot: root, runId: B }) : undefined) };
  }
  const runId = owner === "child-same-id" ? A : B;
  return { ...(await childOwner(root, runId)), runId };
}

describe("U-211, V-17 H-1: Codex's race - a second release of the same lock while the later try is between its check and its removal", () => {
  for (const owner of ["same-process-next", "child-next", "child-same-id"] as const) {
    test(`it waits for that try and shares its answer; the next owner (${owner}) keeps its lock`, TODO, async () => {
      const root = await workspace();
      await acquired(root, A);
      const removal = pauseFirstRemoval(lockFileOf(root));
      const owners: { readonly ok: boolean; readonly pid: number; readonly runId: string; readonly stop: () => Promise<void> }[] = [];
      try {
        const later = retryLockRelease({ workspaceRoot: root, runId: A }, { delaysMs: [1] });
        await removal.paused;
        // The later try read the lock (this process, A) and waits at its removal. A second release of A:
        let secondEnded = false;
        const second = appRelease()({ workspaceRoot: root, runId: A }).then((answer) => {
          secondEnded = true;
          return answer;
        });
        await turns(50);
        // A next owner tries meanwhile: while the lock is still this run's, it cannot take it.
        const early = await nextOwner(root, owner);
        owners.push(early);
        const secondEndedBeforeResume = secondEnded;
        removal.resume();
        assert.equal(await later, "released");
        assert.equal(await second, true, "the second release shares the answer");
        const next = early.ok ? early : await nextOwner(root, owner);
        if (!early.ok) owners.push(next);
        assert.equal(next.ok, true, "the next owner takes the workspace once the lock was released");
        await turns(50);
        assert.deepEqual([holderOf(root)?.pid, holderOf(root)?.runId], [next.pid, next.runId], "the next owner's lock stays");
        const third = await acquireLock({ workspaceRoot: root, runId: C, clock, retryForMs: 0 });
        assert.equal(third.ok, false, "a third run finds the workspace locked");
        if (third.ok) await storeReleaseLock({ workspaceRoot: root, runId: C });
        assert.equal(secondEndedBeforeResume, false, "the second release waited for the release under way");
        assert.equal(early.ok, false, "no next owner while the lock was this run's");
      } finally {
        removal.restore();
        for (const held of owners) await held.stop();
        if (existsSync(lockFileOf(root)) && holderOf(root)?.pid === process.pid) await storeReleaseLock({ workspaceRoot: root, runId: holderOf(root)!.runId });
      }
    });
  }
});

describe("U-211, V-17 H-1: the later tries and the other releases of one lock", () => {
  test("a release asked while the later tries wait: it runs, and the later tries end without asking the store again", TODO, async () => {
    const root = await workspace();
    await acquired(root, A);
    let storeCalls = 0;
    const counted: Release = (lock) => {
      storeCalls += 1;
      return storeReleaseLock(lock);
    };
    const later = retryLockRelease({ workspaceRoot: root, runId: A }, { delaysMs: [200], release: counted });
    assert.equal(await appRelease(counted)({ workspaceRoot: root, runId: A }), true);
    await acquired(root, B);
    try {
      assert.equal(await later, "released", "the release asked meanwhile removed the lock");
      assert.equal(storeCalls, 1, "one release of the store for the two requests");
      assert.equal(holderOf(root)?.runId, B);
    } finally {
      await storeReleaseLock({ workspaceRoot: root, runId: B });
    }
  });

  test("a later try waits for a release of that lock still under way, and tries only after it ended", TODO, async () => {
    const root = await workspace();
    const lock = { workspaceRoot: root, runId: A };
    const first = deferred();
    const order: string[] = [];
    let calls = 0;
    const release: Release = async () => {
      calls += 1;
      const call = calls;
      order.push(`start ${call}`);
      if (call === 1) {
        await first.promise;
        order.push("end 1 (threw)");
        throw new Error("synthetic failure of the first release");
      }
      order.push(`end ${call}`);
      return true;
    };
    const firstRelease = appRelease(release)(lock).catch(() => "threw");
    const later = retryLockRelease(lock, { delaysMs: [1], release });
    await turns(50);
    assert.deepEqual(order, ["start 1"], "no try while the first release is under way");
    first.resolve();
    assert.equal(await firstRelease, "threw");
    assert.equal(await later, "released");
    assert.deepEqual(order, ["start 1", "end 1 (threw)", "start 2", "end 2"]);
  });

  test("a second request for later tries of the same lock while they are pending: the same tries, once", TODO, async () => {
    const root = await workspace();
    const lock = { workspaceRoot: root, runId: A };
    let calls = 0;
    const release: Release = async () => {
      calls += 1;
      throw new Error("synthetic failure");
    };
    const one = retryLockRelease(lock, { delaysMs: [1, 1], release });
    const two = retryLockRelease(lock, { delaysMs: [1, 1], release });
    assert.deepEqual([await one, await two], ["left", "left"]);
    assert.equal(calls, 2, "two tries in all, not four");
  });
});
