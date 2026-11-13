/**
 * U-213 (ne-verify's measurement of read refusals after U-189, report-read-refusals.md, its P5): a
 * guarded read, listing or inspect_files that saw the folders on its path change tries again twice
 * at once, then after waits of 50, 200 and 500 ms (six tries in all). A burst of changes of about a
 * second (npm install, a checkout) is then usually over before the last try; changes that never stop
 * are io_error still. A listing, inspect_files, and a search's listing with all its reads start no
 * try after the first 2 s or more after they began; the run's signal ends a wait at once. The tools'
 * error texts do not change. A fake clock for the schedule; real workspaces for the rest.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import type { EffectiveWorkflowToolCall } from "../../../src/contracts/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import { nodeFileLayer } from "../../../src/workspace/file-layer.js";
import type { FileLayer } from "../../../src/workspace/file-layer.js";
import { GUARD_ATTEMPTS, GUARD_PAUSES_MS, GUARD_TIME_LIMIT_MS, retried, retryDeadline } from "../../../src/workspace/guard.js";
import type { RetryClock } from "../../../src/workspace/guard.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { createWorkspaceWithFileLayer } from "../../../src/workspace/workspace.js";
import { createFakePrivacy } from "../tools/doubles.js";

/** A clock whose time moves only by the test's tries and by the waits retried asks for. */
function fakeClock(onSleep?: () => void): RetryClock & { time: number; slept: number[] } {
  const clock = {
    time: 0,
    slept: [] as number[],
    now: () => clock.time,
    sleep: async (ms: number) => {
      clock.slept.push(ms);
      clock.time += ms;
      onSleep?.();
    },
  };
  return clock;
}

/** An attempt that answers `changed` for its first `changes` tries, each taking `takes` ms, then "read". */
function attempts(clock: { time: number }, changes: number, takes = 1): { tries: () => number; attempt: () => Promise<"read" | "changed"> } {
  let tries = 0;
  return {
    tries: () => tries,
    attempt: async () => {
      tries += 1;
      clock.time += takes;
      return tries <= changes ? "changed" : "read";
    },
  };
}

test("U-213: six tries, twice at once, then waits of 50, 200 and 500 ms; a 2 s limit for listings, inspect_files and a search", () => {
  assert.equal(GUARD_ATTEMPTS, 6);
  assert.deepEqual(GUARD_PAUSES_MS, [0, 0, 50, 200, 500]);
  assert.equal(GUARD_PAUSES_MS.length, GUARD_ATTEMPTS - 1, "a wait before each try after the first");
  assert.equal(GUARD_TIME_LIMIT_MS, 2_000);
});

test("U-213: a change seen once or twice is tried again at once; no wait slows such a read", async () => {
  for (const changes of [0, 1, 2]) {
    const clock = fakeClock();
    const run = attempts(clock, changes);
    assert.equal(await retried(run.attempt, { clock }), "read");
    assert.equal(run.tries(), changes + 1);
    assert.deepEqual(clock.slept, [], `${changes} changes: no wait`);
  }
});

test("U-213: after three changed tries it waits, so a burst that ends is read; one that never ends is changed after six", async () => {
  const burst = fakeClock();
  const ending = attempts(burst, 4);
  assert.equal(await retried(ending.attempt, { clock: burst }), "read");
  assert.deepEqual([ending.tries(), burst.slept], [5, [50, 200]]);
  const churn = fakeClock();
  const never = attempts(churn, Infinity);
  assert.equal(await retried(never.attempt, { clock: churn }), "changed");
  assert.deepEqual([never.tries(), churn.slept], [6, [50, 200, 500]]);
});

test("U-213: no try starts at or after the time limit (slow tries of a large tree); a single read has none of its own", async () => {
  // Tries of 900 ms within 2 s: the third ends at 2.7 s, so the fourth is not started.
  const slow = fakeClock();
  const big = attempts(slow, Infinity, 900);
  assert.equal(await retried(big.attempt, { clock: slow, until: retryDeadline(slow) }), "changed");
  assert.deepEqual([big.tries(), slow.slept], [3, []]);
  // Tries of 400 ms: the fifth ends at 2.25 s, so the sixth is not started.
  const medium = fakeClock();
  const tree = attempts(medium, Infinity, 400);
  assert.equal(await retried(tree.attempt, { clock: medium, until: retryDeadline(medium) }), "changed");
  assert.deepEqual([tree.tries(), medium.slept], [5, [50, 200]]);
  // Without a limit (a read alone): all six.
  const alone = fakeClock();
  const read = attempts(alone, Infinity, 900);
  assert.equal(await retried(read.attempt, { clock: alone }), "changed");
  assert.equal(read.tries(), 6);
});

test("U-213: the run's signal ends the tries: aborted during a wait, or already aborted, no try more starts", async () => {
  const controller = new AbortController();
  const clock = fakeClock(() => controller.abort());
  const run = attempts(clock, Infinity);
  assert.equal(await retried(run.attempt, { clock, signal: controller.signal }), "changed");
  assert.deepEqual([run.tries(), clock.slept], [3, [50]], "the first wait was cut and nothing more was tried");
  const early = fakeClock();
  const once = attempts(early, Infinity);
  assert.equal(await retried(once.attempt, { clock: early, signal: AbortSignal.abort() }), "changed");
  assert.deepEqual([once.tries(), early.slept], [1, []]);
});

test("U-213: a real wait ends as soon as the signal is aborted", async () => {
  // Tries take no time: the 500 ms wait runs from about 250 ms to 750 ms; the abort at 400 ms cuts it.
  const controller = new AbortController();
  let tries = 0;
  const started = performance.now();
  setTimeout(() => controller.abort(), 400);
  const outcome = await retried(
    async () => {
      tries += 1;
      return "changed" as const;
    },
    { signal: controller.signal },
  );
  const took = performance.now() - started;
  assert.equal(outcome, "changed");
  assert.equal(tries, 5, "three tries at once, two after the 50 and 200 ms waits, then the 500 ms wait the abort cut");
  assert.ok(took < 650, `ended ${Math.round(took)} ms after the start, not when the 500 ms wait would have ended`);
});

let base = "";
let root = "";

before(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u213-retry-")));
  root = path.join(base, "root");
  fs.mkdirSync(path.join(root, "parent"), { recursive: true });
  fs.writeFileSync(path.join(root, "parent", "a.txt"), "inside\n");
  fs.mkdirSync(path.join(root, "flat"));
  fs.writeFileSync(path.join(root, "flat", "one.txt"), "one\n");
  fs.mkdirSync(path.join(root, "many"));
  for (let index = 0; index < 8; index += 1) fs.writeFileSync(path.join(root, "many", `f${index}.txt`), "needle\n");
  fs.mkdirSync(path.join(root, "insp"));
  fs.writeFileSync(path.join(root, "insp", "x.txt"), "x\n");
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * Makes and removes a file in `folder` (what a burst does), past the clock tick of the folder's last
 * change: two changes within one tick leave its change time as it was (the guard's known limit), and
 * a try's change would then not be seen.
 */
async function touch(folder: string): Promise<void> {
  await sleep(20);
  const sibling = path.join(folder, `burst-${process.pid}.tmp`);
  fs.writeFileSync(sibling, "x");
  fs.unlinkSync(sibling);
}

/** A file layer whose open of a file in `folder` changes that folder after each of its first `burst` opens. */
function burstReads(folder: string, burst: number): { layer: FileLayer; opens: () => number } {
  let opens = 0;
  return {
    opens: () => opens,
    layer: {
      ...nodeFileLayer,
      openRead: async (target) => {
        const handle = await nodeFileLayer.openRead(target);
        if (path.dirname(target) === folder) {
          opens += 1;
          if (opens <= burst) await touch(folder);
        }
        return handle;
      },
    },
  };
}

test("U-213: a read whose folder changed on its first three tries is read on the fourth (three tries alone refused it)", async () => {
  const { layer, opens } = burstReads(path.join(root, "parent"), 3);
  const workspace = await createWorkspaceWithFileLayer({ root }, layer);
  const target = await workspace.resolve("parent/a.txt", "read");
  assert.ok(target.ok, JSON.stringify(target));
  const read = await workspace.readText(target.path);
  assert.deepEqual(read.ok ? { ok: true, text: read.snapshot.text } : read, { ok: true, text: "inside\n" });
  assert.equal(opens(), 4);
});

test("U-213: a read whose folder changes on every try is io_error after six; aborted during a wait, it ends at once", async () => {
  const every = burstReads(path.join(root, "parent"), Infinity);
  const workspace = await createWorkspaceWithFileLayer({ root }, every.layer);
  const target = await workspace.resolve("parent/a.txt", "read");
  assert.ok(target.ok, JSON.stringify(target));
  const read = await workspace.readText(target.path);
  assert.deepEqual([read.ok ? "read" : read.code, every.opens()], ["io_error", GUARD_ATTEMPTS]);
  const cut = burstReads(path.join(root, "parent"), Infinity);
  const tools = createToolRunner({ workspace: await createWorkspaceWithFileLayer({ root }, cut.layer), privacy: createFakePrivacy() });
  // Aborted about when the first wait begins (three tries of about 20 ms each): no 200 or 500 ms wait follows.
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const started = performance.now();
  const outcome = await tools.execute({ id: "c1", name: "read_file", args: { path: "parent/a.txt" } }, controller.signal);
  const took = performance.now() - started;
  assert.ok(took < 500, `ended ${Math.round(took)} ms after the start, not after the waits`);
  assert.deepEqual(outcome.ok ? "read" : [outcome.code, outcome.message], ["io_error", "cannot read file: io_error"], "the tool's words do not change");
  assert.ok(cut.opens() <= 3, `${cut.opens()} tries`);
});

test("U-213: a listing's tries are limited in time: by the caller's time, or else 2 s from the call", async () => {
  const flat = path.join(root, "flat");
  let reads = 0;
  let slowMs = 0;
  const layer: FileLayer = {
    ...nodeFileLayer,
    readdir: async (target) => {
      if (target !== flat) return nodeFileLayer.readdir(target);
      reads += 1;
      if (slowMs > 0) await sleep(slowMs);
      const entries = await nodeFileLayer.readdir(target);
      await touch(flat);
      return entries;
    },
  };
  const workspace = await createWorkspaceWithFileLayer({ root }, layer);
  const dir = await workspace.resolve("flat", "read");
  assert.ok(dir.ok, JSON.stringify(dir));
  const past = await workspace.list(dir.path, { retryUntil: performance.now() });
  assert.deepEqual([past.ok ? "listed" : past.code, reads], ["io_error", 1], "a time already reached: one try");
  reads = 0;
  slowMs = 700;
  const slow = await workspace.list(dir.path);
  assert.deepEqual([slow.ok ? "listed" : slow.code, reads], ["io_error", 3], "tries of over 700 ms: none starts after 2 s");
});

test("U-213: a search's listing and reads share one time limit, so files that change on every read do not add up", async () => {
  const many = path.join(root, "many");
  const every = burstReads(many, Infinity);
  const tools = createToolRunner({ workspace: await createWorkspaceWithFileLayer({ root }, every.layer), privacy: createFakePrivacy() });
  const started = performance.now();
  const outcome = await tools.execute({ id: "c1", name: "search_files", args: { path: "many", text: "needle" } }, new AbortController().signal);
  const took = performance.now() - started;
  assert.ok(outcome.ok, JSON.stringify(outcome));
  const payload = outcome.payload as unknown as { entries: unknown[]; truncated: boolean };
  assert.deepEqual([payload.entries.length, payload.truncated], [0, true], "not read: the result says it is not complete (V-10b)");
  // Eight files each with six tries and 750 ms of waits would take 6 s; one limit keeps it near 2 s.
  assert.ok(took < 3_500, `took ${Math.round(took)} ms`);
  assert.ok(every.opens() < 8 * GUARD_ATTEMPTS, "fewer tries than six for each file");
});

function inspectCall(dir: string): EffectiveWorkflowToolCall {
  return { id: "c1", name: "inspect_files", args: { path: dir } } as unknown as EffectiveWorkflowToolCall;
}

test("U-213: inspect_files is limited in time and ends with the signal, in its own words", async () => {
  const insp = path.join(root, "insp");
  const file = path.join(insp, "x.txt");
  let tries = 0;
  let slowMs = 0;
  const workspace = await createWorkspace({ root });
  // Each entry's lstat runs once per try: the folder changes there on every try.
  const tools = createToolRunner({
    workspace,
    privacy: createFakePrivacy(),
    fileOps: {
      lstat: async (target) => {
        if (target === file) {
          tries += 1;
          if (slowMs > 0) await sleep(slowMs);
          await touch(insp);
        }
        return fs.promises.lstat(target, { bigint: true });
      },
    },
  });
  assert.ok(tools.executeWorkflowTool !== undefined);
  const kept = await tools.executeWorkflowTool(inspectCall("insp"), new AbortController().signal);
  assert.deepEqual([kept.ok ? "listed" : kept.code, tries], ["io_error", GUARD_ATTEMPTS]);
  tries = 0;
  slowMs = 700;
  const slow = await tools.executeWorkflowTool(inspectCall("insp"), new AbortController().signal);
  assert.deepEqual([slow.ok ? "listed" : slow.code, tries], ["io_error", 3], "tries of 700 ms: none starts after 2 s");
  tries = 0;
  slowMs = 0;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const started = performance.now();
  const cut = await tools.executeWorkflowTool(inspectCall("insp"), controller.signal);
  const took = performance.now() - started;
  assert.ok(took < 500, `ended ${Math.round(took)} ms after the start, not after the waits`);
  assert.deepEqual(cut.ok ? "listed" : [cut.code, cut.message], ["cancelled", "inspect_files cancelled"], "its existing words");
});
