/** IR-E2 follow-up: actual bytes from temporary files, with timing injected only at fs boundaries. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, isAbsolute } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { MAX_READ_BYTES, MAX_REPORT_FILE_BYTES } from "../../../src/contracts/index.js";
import { acquireLock, createJournal, inspectLock, nodeLockFileSystem, readRunOriginals, revertRun } from "../../../src/store/index.js";
import { reviewRecordIn } from "../../../src/store/review.js";

const RUN = "20260102T030405Z-0a1b2c3d", AT = "2026-01-02T03:04:05.000Z", LOCK_MAX = 64 * 1024;
const clock = { now: () => Date.parse(AT) };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const liveness = { isProcessAlive: () => false, processIdentity: async () => null, processStartTime: async () => null };
async function fixture(t: TestContext) {
  const parent = await fs.realpath(tmpdir()), root = await fs.realpath(await fs.mkdtemp(join(parent, "codaryn-e2-more-")));
  const inside = relative(parent, root); assert.ok(inside && !inside.startsWith("..") && !isAbsolute(inside));
  t.after(async () => {
    assert.equal(await fs.realpath(root), root); assert.equal(relative(parent, root), inside);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  const dir = join(root, ".codaryn", "runs", RUN), snapshots = join(dir, "snapshots");
  await fs.mkdir(snapshots, { recursive: true });
  const change = JSON.stringify({ seq: 1, at: AT, runId: RUN, type: "file_changed", path: "a.txt", previousHash: hash("original\n"), newHash: hash("now\n") }) + "\n";
  await fs.writeFile(join(dir, "journal.jsonl"), change);
  await fs.writeFile(join(snapshots, "index.json"), JSON.stringify({ schemaVersion: 1, entries: [{ path: "a.txt", existed: true, file: "1.orig" }] }) + "\n");
  await fs.writeFile(join(snapshots, "1.orig"), "original\n"); await fs.writeFile(join(root, "a.txt"), "now\n");
  return { root, dir, snapshots, change };
}
async function enlarge(file: string, length: number) {
  const handle = await fs.open(file, "r+"); try { await handle.truncate(length); } finally { await handle.close(); }
}
function observe(t: TestContext, target: string, growth?: () => Promise<void>) {
  const actualRead = fs.readFile, actualOpen = fs.open, actualLstat = fs.lstat;
  let grew = false;
  const seen = { bytes: 0, whole: 0, opens: 0, closes: 0, requested: [] as number[] };
  t.mock.method(fs, "lstat", async (...args: unknown[]) => {
    const info = await Reflect.apply(actualLstat, fs, args);
    if (args[0] === target && !grew && growth) { grew = true; await growth(); }
    return info;
  });
  t.mock.method(fs, "readFile", async (...args: unknown[]) => {
    const data = await Reflect.apply(actualRead, fs, args) as Buffer | string;
    if (args[0] === target) { seen.whole++; seen.bytes += Buffer.byteLength(data); }
    return data;
  });
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await actualOpen(...args);
    if (args[0] !== target || args[1] !== "r") return handle;
    seen.opens++; const read = handle.read.bind(handle), close = handle.close.bind(handle);
    t.mock.method(handle, "read", async (...readArgs: unknown[]) => {
      seen.requested.push(readArgs[2] as number);
      const value = await Reflect.apply(read, handle, readArgs) as { bytesRead: number }; seen.bytes += value.bytesRead; return value;
    });
    t.mock.method(handle, "close", async () => { await close(); seen.closes++; });
    return handle;
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return seen;
}
function bounded(t: TestContext, site: string, seen: ReturnType<typeof observe>, max: number) {
  t.diagnostic(JSON.stringify({ site, max, ...seen }));
  assert.ok(seen.bytes <= (max + 1) * Math.max(1, seen.opens), "actual bytes must remain within each read's budget");
  assert.equal(seen.whole, 0, "the site must use bounded handle reads");
  assert.equal(seen.opens, seen.closes); assert.ok(seen.requested.every(n => n <= 64 * 1024));
}

test("E2-more lock read: oversized text is not read in full", async t => {
  const f = await fixture(t), file = join(f.root, ".codaryn", "lock.json"); await fs.writeFile(file, "x".repeat(LOCK_MAX + 16));
  const seen = observe(t, file), refused = await nodeLockFileSystem.readText(file).then(() => false, () => true);
  bounded(t, "lock-readText", seen, LOCK_MAX); assert.equal(refused, true);
});
for (const reclaim of [false, true]) test(`E2-more lock safety: oversized ${reclaim ? "reclaim" : "lock"} is never taken or removed`, async t => {
  const f = await fixture(t), lock = join(f.root, ".codaryn", "lock.json"), file = reclaim ? `${lock}.reclaim` : lock;
  const small = JSON.stringify({ pid: 123456, runId: "old-run", startedAt: AT }) + "\n";
  const large = small.trimEnd() + " ".repeat(LOCK_MAX) + "\n"; await fs.writeFile(lock, small); await fs.writeFile(file, large);
  const actualRead = fs.readFile, seen = observe(t, file);
  const outcome = await acquireLock({ workspaceRoot: f.root, runId: RUN, clock, retryForMs: 0, ...liveness });
  const kept = await actualRead(file, "utf8").catch(() => null);
  t.diagnostic(JSON.stringify({ site: reclaim ? "reclaim-safety" : "lock-safety", refused: !outcome.ok, kept: kept === large, bytes: seen.bytes }));
  assert.equal(kept, large);
  assert.deepEqual(outcome, { ok: false, code: "workspace_locked", holder: reclaim ? JSON.parse(small) : null });
  const state = await inspectLock(f.root, liveness); assert.equal(state.state, reclaim ? "reclaim_left" : "unreadable");
});
test("E2-more lock control: a small valid lock keeps its held classification and exact text", async t => {
  const f = await fixture(t), file = join(f.root, ".codaryn", "lock.json"), text = JSON.stringify({ pid: 123456, runId: "old-run", startedAt: AT }) + "\n";
  await fs.writeFile(file, text); const seen = observe(t, file);
  assert.equal(await nodeLockFileSystem.readText(file), text);
  assert.equal((await inspectLock(f.root, { ...liveness, isProcessAlive: () => true })).state, "held");
  t.diagnostic(JSON.stringify({ site: "small-lock", ...seen })); assert.equal(seen.opens, seen.closes);
});

for (const site of ["revert-journal", "originals-journal", "append-journal"] as const) test(`E2-more ${site}: an oversized journal is refused without a whole read`, async t => {
  const f = await fixture(t), file = join(f.dir, "journal.jsonl"); await enlarge(file, MAX_REPORT_FILE_BYTES + 64 * 1024);
  const seen = observe(t, file); let failure: unknown = null;
  try {
  if (site === "append-journal") {
    const journal = createJournal({ workspaceRoot: f.root, runId: RUN, clock });
    try { await journal.append({ type: "run_finished" } as Parameters<typeof journal.append>[0]); } finally { await journal.close(); }
  } else {
    const call = site === "revert-journal" ? revertRun({ workspaceRoot: f.root, runId: RUN, dryRun: true }) : readRunOriginals({ workspaceRoot: f.root, runId: RUN });
    await call;
  }
  } catch (error) { failure = error; }
  bounded(t, site, seen, MAX_REPORT_FILE_BYTES);
  assert.ok(failure); if (site !== "append-journal") assert.equal((failure as { code: string }).code, "invalid_run_record");
});
test("E2-more snapshot index: an oversized list keeps the unreadable result and bounded reads", async t => {
  const f = await fixture(t), file = join(f.snapshots, "index.json"); await enlarge(file, MAX_REPORT_FILE_BYTES + 64 * 1024);
  const seen = observe(t, file), rows = await readRunOriginals({ workspaceRoot: f.root, runId: RUN });
  assert.deepEqual(rows[0]?.original, { unavailable: "unreadable" }); bounded(t, "snapshot-index", seen, MAX_REPORT_FILE_BYTES);
});
test("E2-more revert original: an oversized snapshot is not the run's original (missing_snapshot, as before)", async t => {
  const f = await fixture(t), file = join(f.snapshots, "1.orig"); await enlarge(file, MAX_READ_BYTES + 4096);
  const seen = observe(t, file), result = await revertRun({ workspaceRoot: f.root, runId: RUN, dryRun: true });
  bounded(t, "revert-original", seen, MAX_READ_BYTES); assert.equal(result.skipped[0]?.reason, "missing_snapshot");
});
for (const site of ["original-text", "shown", "review"] as const) test(`E2-more ${site}: growth after lstat cannot bypass its existing bound`, async t => {
  const f = await fixture(t);
  const file = site === "original-text" ? join(f.snapshots, "1.orig") : site === "shown" ? join(f.snapshots, "shown-0.json") : join(f.dir, "review.json");
  const max = site === "original-text" ? MAX_READ_BYTES : 16 * 1024;
  if (site === "shown") await fs.writeFile(file, JSON.stringify({ schemaVersion: 2, path: "a.txt", original: hash("original\n"), next: hash("now\n") }));
  if (site === "review") await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, kind: "review_record", runId: RUN, at: AT, verdict: "accept", note: null }));
  const seen = observe(t, file, () => enlarge(file, max + 4096));
  const result = site === "review" ? await reviewRecordIn(f.dir, RUN).then(() => "accepted", () => "refused") : await readRunOriginals({ workspaceRoot: f.root, runId: RUN });
  bounded(t, site, seen, max);
  if (site === "review") assert.equal(result, "refused");
  else {
    assert.ok(Array.isArray(result));
    if (site === "original-text") assert.deepEqual(result[0]?.original, { unavailable: "too_large" });
    else assert.equal(Object.hasOwn(result[0] ?? {}, "shown"), false);
  }
});
test("E2-more journal control: small originals and appended bytes preserve content and sequence", async t => {
  const f = await fixture(t), file = join(f.dir, "journal.jsonl"), seen = observe(t, file);
  const rows = await readRunOriginals({ workspaceRoot: f.root, runId: RUN }); assert.deepEqual(rows[0]?.original, { text: "original\n" });
  const journal = createJournal({ workspaceRoot: f.root, runId: RUN, clock });
  const event = { type: "run_finished" } as Parameters<typeof journal.append>[0], appended = await journal.append(event); await journal.close();
  assert.equal(appended.seq, 2);
  t.diagnostic(JSON.stringify({ site: "small-journal", ...seen })); assert.equal(seen.opens, seen.closes);
  t.mock.restoreAll(); syncBuiltinESMExports();
  assert.equal(await fs.readFile(file, "utf8"), f.change + JSON.stringify({ seq: 2, at: AT, runId: RUN, ...event }) + "\n");
});
