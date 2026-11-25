/**
 * IR-C2 (review C): data_checks sees the run's signal while a rule reads its tables. A cancel that
 * comes during the read of a table stops the read before the next chunk; one that comes between the
 * two tables of a rule leaves the second unread; one that comes after the last table leaves the
 * comparison undone. The rule ends undecided "cancelled while this rule was checked" and the file
 * is closed. Real files in a temporary workspace; the file boundary only counts reads and calls
 * abort at a chosen point (no time limit is asserted). A run that is not cancelled is unchanged.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import type { DataRule, RawVerifierResult } from "../../../src/contracts/index.js";
import { runDataChecksVerifier } from "../../../src/verify/data-checks.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const ROWS = 2_000_000;
const CHUNK = 64 * 1024;
const BIG = `v\n${"1\n".repeat(ROWS)}`;
const SIZE = Buffer.byteLength(BIG);
const CANCELLED = "(cancelled while this rule was checked)";

interface Seen { opens: number; closes: number; reads: number; bytes: number }

async function fixture(t: TestContext) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "codaryn-ir-c2-")));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await fs.writeFile(path.join(root, "big.csv"), BIG);
  await fs.writeFile(path.join(root, "other.csv"), BIG);
  await fs.writeFile(path.join(root, "total.csv"), `total\n${ROWS}\n`);
  return { root, workspace: await createWorkspace({ root }) };
}

/** Counts each file's opens, closes, reads and bytes; `when` may abort after a read or at a close. */
function watch(t: TestContext, root: string, when: (file: string, event: "read" | "close", seen: Seen) => void): Map<string, Seen> {
  const seen = new Map<string, Seen>();
  const actualOpen = fs.open;
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await actualOpen(...args);
    const file = path.relative(root, String(args[0]));
    const count = seen.get(file) ?? { opens: 0, closes: 0, reads: 0, bytes: 0 };
    seen.set(file, count);
    count.opens += 1;
    const read = handle.read.bind(handle) as (...values: unknown[]) => Promise<{ bytesRead: number }>;
    const close = handle.close.bind(handle);
    t.mock.method(handle, "read", async (...values: unknown[]) => {
      const result = await read(...values);
      count.reads += 1;
      count.bytes += result.bytesRead;
      when(file, "read", count);
      return result;
    });
    t.mock.method(handle, "close", async () => {
      await close();
      count.closes += 1;
      when(file, "close", count);
    });
    return handle;
  });
  return seen;
}

const aggregate: DataRule = { type: "aggregate_match", source: { path: "big.csv", format: "csv" }, column: "v", op: "sum", target: { path: "total.csv", format: "csv" }, targetColumn: "total" };
const sameAs: DataRule = { type: "table_shape", table: { path: "big.csv", format: "csv" }, rows: { sameAs: { path: "other.csv", format: "csv" } } };

async function run(workspace: Awaited<ReturnType<typeof createWorkspace>>, rule: DataRule, signal: AbortSignal): Promise<RawVerifierResult> {
  return runDataChecksVerifier({ id: "c2", kind: "data_checks", rules: [rule] }, workspace, signal, { chunkBytes: CHUNK });
}

test("IR-C2: a cancel during the read of a table stops before the next chunk; undecided, file closed", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  const seen = watch(t, f.root, (file, event, count) => { if (file === "big.csv" && event === "read" && count.reads === 3) controller.abort(); });
  const result = await run(f.workspace, aggregate, controller.signal);
  const big = seen.get("big.csv")!;
  t.diagnostic(JSON.stringify({ size: SIZE, big }));
  assert.equal(big.reads, 3, "no read after the cancel");
  assert.equal(big.bytes, 3 * CHUNK);
  assert.deepEqual([big.opens, big.closes], [1, 1]);
  assert.equal(seen.has("total.csv"), false, "the second table is not opened");
  assert.equal(result.outcome, "inconclusive");
  assert.ok(result.evidence.endsWith(CANCELLED), result.evidence);
});

test("IR-C2: a cancel between the two tables of aggregate_match leaves the target unread", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  const seen = watch(t, f.root, (file, event) => { if (file === "big.csv" && event === "close") controller.abort(); });
  const result = await run(f.workspace, aggregate, controller.signal);
  assert.equal(seen.get("big.csv")!.bytes, SIZE, "the source was read through before the cancel");
  assert.equal(seen.has("total.csv"), false, "the target is not opened");
  assert.equal(result.outcome, "inconclusive");
  assert.ok(result.evidence.endsWith(CANCELLED), result.evidence);
});

test("IR-C2: a cancel between the two tables of table_shape rows.sameAs leaves the second unread", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  const seen = watch(t, f.root, (file, event) => { if (file === "big.csv" && event === "close") controller.abort(); });
  const result = await run(f.workspace, sameAs, controller.signal);
  assert.equal(seen.has("other.csv"), false, "the sameAs table is not opened");
  assert.equal(result.outcome, "inconclusive");
  assert.ok(result.evidence.endsWith(CANCELLED), result.evidence);
});

test("IR-C2: a cancel after the last table is read leaves the comparison undone", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  const seen = watch(t, f.root, (file, event) => { if (file === "total.csv" && event === "close") controller.abort(); });
  const result = await run(f.workspace, aggregate, controller.signal);
  assert.equal(seen.get("total.csv")!.closes, 1);
  assert.equal(result.outcome, "inconclusive");
  assert.ok(result.evidence.endsWith(CANCELLED), result.evidence);
});

test("IR-C2: a run that is not cancelled reads every table through and passes as before", async (t) => {
  const f = await fixture(t);
  const seen = watch(t, f.root, () => {});
  const result = await run(f.workspace, aggregate, new AbortController().signal);
  assert.equal(seen.get("big.csv")!.bytes, SIZE);
  assert.deepEqual([seen.get("big.csv")!.opens, seen.get("big.csv")!.closes, seen.get("total.csv")!.closes], [1, 1, 1]);
  assert.equal(result.outcome, "pass", result.evidence);
});
