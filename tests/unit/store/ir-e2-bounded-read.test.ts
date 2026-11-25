/** IR-E2: growing store records keep their existing outcomes and bounded, same-handle reads. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { MAX_REPORT_FILE_BYTES } from "../../../src/contracts/index.js";
import type { MaskedText } from "../../../src/contracts/index.js";
import { createRunRecorders, listRuns, loadPlan, readRevertRecord } from "../../../src/store/index.js";
import { RunListError } from "../../../src/store/runs.js";
import { readBounded } from "../../../src/store/read-bounded.js";

const RUN = "20260102T030405Z-0a1b2c3d";
const AT = "2026-01-02T03:04:05.000Z";
const CHUNK = 64 * 1024;
const clock = { now: () => Date.parse(AT) };
const runDir = (root: string) => join(root, ".codaryn", "runs", RUN);

async function fixture(t: TestContext): Promise<string> {
  const parent = await fs.realpath(tmpdir());
  const root = await fs.realpath(await fs.mkdtemp(join(parent, "codaryn-ir-e2-")));
  const inside = () => assert.ok(resolve(root).startsWith(parent.endsWith(sep) ? parent : parent + sep));
  inside();
  t.after(async () => {
    inside();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return root;
}

interface Timing {
  afterLstat?: () => Promise<void>;
  afterStat?: () => Promise<void>;
  failReadAfter?: number;
  shortReads?: number;
  failStat?: boolean;
}

/** Only fs timing/failures are injected. Every byte counted comes from the actual temporary file. */
function observe(t: TestContext, target: string, timing: Timing = {}) {
  const actualLstat = fs.lstat, actualReadFile = fs.readFile, actualOpen = fs.open;
  let lstatDone = false, statDone = false;
  const seen = { bytesRead: 0, wholeReads: 0, opens: 0, stats: 0, closes: 0, lengths: [] as number[], buffers: [] as number[] };
  t.mock.method(fs, "lstat", async (...args: unknown[]) => {
    const info = await Reflect.apply(actualLstat, fs, args);
    if (args[0] === target && !lstatDone) { lstatDone = true; await timing.afterLstat?.(); }
    return info;
  });
  t.mock.method(fs, "readFile", async (...args: unknown[]) => {
    const result = await Reflect.apply(actualReadFile, fs, args) as Buffer | string;
    if (args[0] === target) { seen.wholeReads++; seen.bytesRead += Buffer.byteLength(result); }
    return result;
  });
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await actualOpen(...args);
    if (args[0] !== target || args[1] !== "r") return handle;
    seen.opens++;
    const stat = handle.stat.bind(handle), read = handle.read.bind(handle), close = handle.close.bind(handle);
    t.mock.method(handle, "stat", async () => {
      seen.stats++;
      if (timing.failStat) throw Object.assign(new Error("synthetic stat failure"), { code: "EIO" });
      const info = await stat();
      if (!statDone) { statDone = true; await timing.afterStat?.(); }
      return info;
    });
    t.mock.method(handle, "read", async (...readArgs: unknown[]) => {
      assert.ok(Buffer.isBuffer(readArgs[0]));
      seen.buffers.push(readArgs[0].length);
      seen.lengths.push(readArgs[2] as number);
      if (timing.failReadAfter !== undefined && seen.bytesRead >= timing.failReadAfter) {
        throw Object.assign(new Error("synthetic read failure"), { code: "EIO" });
      }
      if (timing.shortReads !== undefined) readArgs[2] = Math.min(readArgs[2] as number, timing.shortReads);
      const result = await Reflect.apply(read, handle, readArgs) as { bytesRead: number; buffer: Buffer };
      seen.bytesRead += result.bytesRead;
      return result;
    });
    t.mock.method(handle, "close", async () => { await close(); seen.closes++; });
    return handle;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return seen;
}

function bounded(seen: ReturnType<typeof observe>, max: number): void {
  assert.ok(seen.bytesRead <= max + 1, `read ${seen.bytesRead} bytes for ${max} + 1`);
  assert.equal(seen.wholeReads, 0, "no whole-file path read");
  assert.deepEqual([seen.opens, seen.stats, seen.closes], [1, 1, 1], "one statted, always-closed handle");
  assert.ok(seen.lengths.every(n => n <= CHUNK));
  assert.ok(seen.buffers.every(n => n <= CHUNK));
}

async function planFixture(root: string): Promise<void> {
  const dir = runDir(root);
  await fs.mkdir(dir, { recursive: true });
  const plan = JSON.stringify({ schemaVersion: 1, kind: "plan", runId: RUN,
    actions: [{ kind: "discard", path: "notes.txt", sha256: "a".repeat(64) }] }) + "\n";
  const digest = createHash("sha256").update(plan).digest("hex");
  await fs.writeFile(join(dir, "plan.json"), plan);
  await fs.writeFile(join(dir, "journal.jsonl"), JSON.stringify({ seq: 1, at: AT, runId: RUN, type: "run_started",
    schemaVersion: 1, taskId: "task", workflow: "organize", provider: "scripted", limits: {} }) + "\n");
  await fs.writeFile(join(dir, "result.json"), JSON.stringify({ schemaVersion: 1, kind: "run", runId: RUN, taskId: "task",
    status: "needs-input", reason: "plan_pending", exitCode: 3, provider: "scripted", changes: [], plan: { digest } }) + "\n");
}

for (const tier of ["state", "run"] as const) {
  test(`IR-E2 state-guard ${tier}: growth after lstat uses the reserved size, with the existing tier limit result`, async t => {
    const root = await fixture(t);
    const target = tier === "state" ? join(root, ".codaryn", "sample.json") : join(runDir(root), "result.json");
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.alloc(16, 1));
    const records = createRunRecorders({ workspaceRoot: root, runId: RUN, clock, limits: { maxHashBytes: 64 } });
    const seen = observe(t, target, { afterLstat: () => fs.appendFile(target, Buffer.alloc(CHUNK, 2)) });
    const print = await records.stateGuard.capture(tier);
    const comparison = records.stateGuard.compare(print, print);
    t.diagnostic(JSON.stringify({ reader: `state-${tier}`, grownBytes: 16 + CHUNK, budget: 16, ...seen, limited: comparison.limited }));
    assert.equal(comparison.limited, tier === "state");
    bounded(seen, 16);
  });
}

test("IR-E2 revert: growth after lstat stays unreadable without reading beyond 4096 + 1", async t => {
  const root = await fixture(t), target = join(runDir(root), "revert.json");
  await fs.mkdir(runDir(root), { recursive: true });
  await fs.writeFile(target, JSON.stringify({ schemaVersion: 1, kind: "revert_record", runId: RUN, at: AT,
    status: "complete", reverted: 0, skipped: 0, conflicts: 0 }) + "\n");
  const initial = (await fs.stat(target)).size;
  const seen = observe(t, target, { afterLstat: () => fs.appendFile(target, Buffer.alloc(1024 * 1024, 0x20)) });
  await assert.rejects(readRevertRecord(root, RUN), RunListError);
  t.diagnostic(JSON.stringify({ reader: "revert", initial, budget: 4096, ...seen }));
  bounded(seen, 4096);
});

test("IR-E2 runs applied: growth stays an omitted appliedBy on a checked plan run", async t => {
  const root = await fixture(t);
  await planFixture(root);
  const target = join(runDir(root), "applied.json");
  await fs.writeFile(target, JSON.stringify({ schemaVersion: 1, kind: "plan_applied", planRunId: RUN,
    applyRunId: "20260102T030500Z-11111111", at: AT }) + "\n");
  const seen = observe(t, target, { afterLstat: () => fs.appendFile(target, Buffer.alloc(CHUNK, 0x20)) });
  const listing = await listRuns({ workspaceRoot: root });
  assert.equal(listing.runs[0]?.state, "checked");
  assert.equal(Object.hasOwn(listing.runs[0] ?? {}, "appliedBy"), false);
  t.diagnostic(JSON.stringify({ reader: "runs-applied", budget: 4096, ...seen }));
  bounded(seen, 4096);
});

for (const reader of ["plan", "runs"] as const) {
  test(`IR-E2 ${reader} result: growth within the report budget preserves the outcome through bounded chunks`, async t => {
    const root = await fixture(t);
    await planFixture(root);
    const target = join(runDir(root), "result.json"), initial = (await fs.stat(target)).size;
    const seen = observe(t, target, { afterLstat: () => fs.appendFile(target, Buffer.alloc(2 * 1024 * 1024, 0x20)) });
    if (reader === "plan") assert.equal((await loadPlan({ workspaceRoot: root, runId: RUN })).ok, true);
    else assert.equal((await listRuns({ workspaceRoot: root })).runs[0]?.state, "checked");
    t.diagnostic(JSON.stringify({ reader: `${reader}-result`, initial, budget: MAX_REPORT_FILE_BYTES,
      bytesRead: seen.bytesRead, wholeReads: seen.wholeReads, opens: seen.opens, closes: seen.closes, chunks: seen.lengths.length }));
    assert.equal(seen.bytesRead, initial + 2 * 1024 * 1024);
    bounded(seen, MAX_REPORT_FILE_BYTES);
  });
}

test("IR-E2 plan journal: existence and type are checked without reading its bytes", async t => {
  const root = await fixture(t);
  await planFixture(root);
  const target = join(runDir(root), "journal.jsonl");
  const seen = observe(t, target, { afterLstat: () => fs.appendFile(target, Buffer.alloc(CHUNK, 0x20)) });
  assert.equal((await loadPlan({ workspaceRoot: root, runId: RUN })).ok, true);
  t.diagnostic(JSON.stringify({ reader: "plan-journal", ...seen }));
  assert.equal(seen.bytesRead, 0);
  assert.equal(seen.opens, 0);
});

test("IR-E2 mark merge: growth past the mark limit replaces rather than joins the oversized mark", async t => {
  const root = await fixture(t), target = join(runDir(root), "records-changed.json");
  await fs.mkdir(runDir(root), { recursive: true });
  const detection = { detectedBy: RUN, at: AT, paths: ["earlier.json"] };
  await fs.writeFile(target, JSON.stringify({ schemaVersion: 1, kind: "records_changed", runId: RUN, detections: [detection] }));
  const records = createRunRecorders({ workspaceRoot: root, runId: RUN, clock });
  const seen = observe(t, target, { afterLstat: () => fs.appendFile(target, Buffer.alloc(8 * 1024 * 1024, 0x20)) });
  await records.stateGuard.markRecordsChanged(["sample.json" as MaskedText]);
  t.diagnostic(JSON.stringify({ reader: "mark", budget: 8 * 1024 * 1024, ...seen }));
  bounded(seen, 8 * 1024 * 1024);
  const bytes = await fs.readFile(target, "utf8");
  const mark = JSON.parse(bytes) as { detections: unknown[] };
  assert.deepEqual(mark.detections, [{ detectedBy: RUN, at: AT, paths: ["sample.json"] }]);
});

for (const [name, data] of [
  ["empty at zero budget", Buffer.alloc(0)],
  ["exact budget", Buffer.alloc(64, 3)],
  ["binary BOM and CRLF", Buffer.from([0xef, 0xbb, 0xbf, 0, 0xff, 0x0d, 0x0a])],
  ["multiple chunks", Buffer.concat([Buffer.alloc(CHUNK, 1), Buffer.alloc(CHUNK, 2), Buffer.alloc(19, 3)])],
] as const) {
  test(`IR-E2 helper: ${name} keeps the exact bytes through one handle`, async t => {
    const root = await fixture(t), target = join(root, "record.bin");
    await fs.writeFile(target, data);
    const seen = observe(t, target);
    assert.deepEqual(await readBounded(target, data.length), data);
    bounded(seen, data.length);
    assert.equal(seen.bytesRead, data.length);
  });
}

test("IR-E2 helper: fstat oversize rejects before reading and closes the handle", async t => {
  const root = await fixture(t), target = join(root, "record.bin");
  await fs.writeFile(target, Buffer.alloc(1024, 3));
  const seen = observe(t, target);
  assert.equal(await readBounded(target, 64), "too_large");
  bounded(seen, 64);
  assert.equal(seen.bytesRead, 0);
  assert.deepEqual(seen.lengths, []);
});

test("IR-E2 helper: growth after fstat consumes only the small budget plus one detection byte", async t => {
  const root = await fixture(t), target = join(root, "record.bin");
  await fs.writeFile(target, Buffer.alloc(8, 1));
  const seen = observe(t, target, { afterStat: () => fs.appendFile(target, Buffer.alloc(1024, 2)) });
  assert.equal(await readBounded(target, 64), "too_large");
  t.diagnostic(JSON.stringify({ reader: "helper-after-fstat", budget: 64, ...seen }));
  bounded(seen, 64);
  assert.equal(seen.bytesRead, 65);
});

test("IR-E2 helper: growth within budget includes all the new bytes", async t => {
  const root = await fixture(t), target = join(root, "record.bin");
  const initial = Buffer.alloc(8, 1), extra = Buffer.alloc(24, 2);
  await fs.writeFile(target, initial);
  const seen = observe(t, target, { afterStat: () => fs.appendFile(target, extra) });
  assert.deepEqual(await readBounded(target, 64), Buffer.concat([initial, extra]));
  bounded(seen, 64);
  assert.equal(seen.bytesRead, 32);
});

test("IR-E2 helper: short reads continue to EOF without losing or duplicating bytes", async t => {
  const root = await fixture(t), target = join(root, "record.bin");
  const data = Buffer.from(Array.from({ length: 103 }, (_, n) => n));
  await fs.writeFile(target, data);
  const seen = observe(t, target, { shortReads: 7 });
  assert.deepEqual(await readBounded(target, 103), data);
  bounded(seen, 103);
  assert.equal(seen.bytesRead, 103);
});

for (const failure of ["stat", "read"] as const) {
  test(`IR-E2 helper: ${failure} failure rejects and closes its original handle`, async t => {
    const root = await fixture(t), target = join(root, "record.bin");
    await fs.writeFile(target, Buffer.alloc(2 * CHUNK, 3));
    const seen = observe(t, target, failure === "stat" ? { failStat: true } : { failReadAfter: CHUNK });
    await assert.rejects(readBounded(target, 2 * CHUNK), { code: "EIO" });
    bounded(seen, 2 * CHUNK);
    assert.equal(seen.bytesRead, failure === "stat" ? 0 : CHUNK);
  });
}

test("IR-E2 helper: a non-file handle is rejected without reading", async t => {
  const root = await fixture(t), target = join(root, "directory");
  await fs.mkdir(target);
  // A regular-file handle with a non-file stat models platforms that allow opening directories.
  const file = join(root, "record.bin");
  await fs.writeFile(file, Buffer.alloc(1));
  const actualOpen = fs.open, directoryStat = await fs.stat(target);
  let reads = 0, closes = 0;
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await actualOpen(...args), close = handle.close.bind(handle);
    t.mock.method(handle, "stat", async () => directoryStat);
    t.mock.method(handle, "read", async () => { reads++; throw new Error("must not read a non-file"); });
    t.mock.method(handle, "close", async () => { await close(); closes++; });
    return handle;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(readBounded(file, 64), /not a regular record file/);
  assert.deepEqual([reads, closes], [0, 1]);
});

for (const tier of ["state", "run"] as const) {
  test(`IR-E2 state-guard ${tier}: growth after fstat stops at the reserved size plus one`, async t => {
    const root = await fixture(t);
    const target = tier === "state" ? join(root, ".codaryn", "sample.json") : join(runDir(root), "result.json");
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.alloc(16, 1));
    const records = createRunRecorders({ workspaceRoot: root, runId: RUN, clock, limits: { maxHashBytes: 64 } });
    const seen = observe(t, target, { afterStat: () => fs.appendFile(target, Buffer.alloc(CHUNK, 2)) });
    const print = await records.stateGuard.capture(tier);
    assert.equal(records.stateGuard.compare(print, print).limited, tier === "state");
    bounded(seen, 16);
    assert.equal(seen.bytesRead, 17);
  });
}

test("IR-E2 revert: growth after fstat stays unreadable and reads at most 4097 bytes", async t => {
  const root = await fixture(t), target = join(runDir(root), "revert.json");
  await fs.mkdir(runDir(root), { recursive: true });
  await fs.writeFile(target, "{}\n");
  const seen = observe(t, target, { afterStat: () => fs.appendFile(target, Buffer.alloc(CHUNK, 0x20)) });
  await assert.rejects(readRevertRecord(root, RUN), RunListError);
  bounded(seen, 4096);
  assert.equal(seen.bytesRead, 4097);
});

for (const reader of ["plan", "runs"] as const) {
  test(`IR-E2 ${reader} result: read failure keeps the existing invalid/damaged outcome`, async t => {
    const root = await fixture(t);
    await planFixture(root);
    const target = join(runDir(root), "result.json");
    const seen = observe(t, target, { failReadAfter: 0 });
    if (reader === "plan") assert.deepEqual(await loadPlan({ workspaceRoot: root, runId: RUN }), { ok: false, code: "invalid_run_record" });
    else assert.equal((await listRuns({ workspaceRoot: root })).runs[0]?.state, "damaged");
    bounded(seen, MAX_REPORT_FILE_BYTES);
    assert.equal(seen.bytesRead, 0);
  });
}
