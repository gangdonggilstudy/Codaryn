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

import type { DataRule, RawVerifierResult, Workspace } from "../../../src/contracts/index.js";
import { runDataChecksVerifier } from "../../../src/verify/data-checks.js";
import type { DataChecksOptions } from "../../../src/verify/data-checks.js";
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

/** C2R: small real files; cancellation is placed at the contract boundary, never by elapsed time. */
async function smallFixture(t: TestContext) {
  const parent = await fs.realpath(tmpdir());
  const root = await fs.realpath(await fs.mkdtemp(path.join(parent, "codaryn-c2r-")));
  const inside = () => {
    assert.equal(path.dirname(root).toLowerCase(), parent.toLowerCase());
    assert.ok(path.basename(root).startsWith("codaryn-c2r-"));
  };
  inside();
  t.after(async () => { inside(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  for (const [file, text] of [["table.csv", "v\n1\n"], ["other.csv", "v\n1\n"], ["total.csv", "total\n1\n"], ["spare.csv", "unused\n0\n"]]) {
    await fs.writeFile(path.join(root, file!), text!);
  }
  return { root, workspace: await createWorkspace({ root }) };
}

const shape: DataRule = { type: "table_shape", table: { path: "table.csv", format: "csv" }, rows: { equals: 1 } };
const smallAggregate: DataRule = { type: "aggregate_match", source: { path: "table.csv", format: "csv" }, column: "v", op: "sum", target: { path: "total.csv", format: "csv" }, targetColumn: "total" };
const smallSameAs: DataRule = { type: "table_shape", table: { path: "table.csv", format: "csv" }, rows: { sameAs: { path: "other.csv", format: "csv" } } };
const smallRun = (workspace: Workspace, rules: DataRule[], signal: AbortSignal, options: DataChecksOptions = {}) =>
  runDataChecksVerifier({ id: "c2r", kind: "data_checks", rules }, workspace, signal, options);

function cancelled(result: RawVerifierResult): void {
  assert.equal(result.outcome, "inconclusive", result.evidence);
  assert.ok(result.evidence.endsWith(CANCELLED), result.evidence);
}

for (const [name, rule, last] of [
  ["table_shape", shape, "table.csv"],
  ["aggregate_match", smallAggregate, "total.csv"],
  ["rows.sameAs", smallSameAs, "other.csv"],
  ["parse failure", shape, "table.csv"],
] as const) {
  test(`C2R-1: ${name} cancelled in the final unreadable-path resolve is undecided`, async t => {
    const f = await smallFixture(t), controller = new AbortController();
    if (name === "parse failure") await fs.writeFile(path.join(f.root, "table.csv"), 'v\n"unterminated\n');
    let lastClosed = false, hit = false;
    const seen = watch(t, f.root, (file, event) => { if (file === last && event === "close") lastClosed = true; });
    const workspace: Workspace = { ...f.workspace, async resolve(file, access) {
      const result = await f.workspace.resolve(file, access);
      if (file === "spare.csv" && lastClosed) { hit = true; controller.abort(); }
      return result;
    } };
    const result = await smallRun(workspace, [rule], controller.signal, { unreadablePaths: ["spare.csv"] });
    t.diagnostic(JSON.stringify({ case: name, hit, outcome: result.outcome, cancelledNote: result.evidence.endsWith(CANCELLED) }));
    assert.equal(hit, true, "the cancellation is after the last table's close, during path resolution");
    assert.deepEqual([seen.get(last)?.opens, seen.get(last)?.closes], [1, 1]);
    cancelled(result);
  });
}

test("C2R-2: an exception after cancellation also becomes the rule's cancellation verdict", async t => {
  const f = await smallFixture(t), controller = new AbortController();
  let closed = false, hit = false;
  watch(t, f.root, (file, event) => { if (file === "table.csv" && event === "close") closed = true; });
  const workspace: Workspace = { ...f.workspace, async resolve(file, access) {
    if (file === "spare.csv" && closed) {
      hit = true;
      controller.abort();
      throw Object.assign(new Error("synthetic resolution failure"), { code: "EIO" });
    }
    return f.workspace.resolve(file, access);
  } };
  const result = await smallRun(workspace, [shape], controller.signal, { unreadablePaths: ["spare.csv"] });
  assert.equal(hit, true);
  cancelled(result);
  assert.ok(!result.evidence.includes("check failed"));
});

for (const fault of ["oversize", "stat EIO"] as const) for (const abort of [false, true]) {
  test(`C2R-2: ${fault} with abort=${abort} preserves the chosen error/cancel priority`, async t => {
    const f = await smallFixture(t), controller = new AbortController(), actualOpen = fs.open;
    let closed = 0, reads = 0, hit = false;
    t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await actualOpen(...args);
      if (args[0] !== path.join(f.root, "table.csv")) return handle;
      const stat = handle.stat.bind(handle), close = handle.close.bind(handle);
      t.mock.method(handle, "stat", async () => {
        const info = await stat();
        hit = true;
        if (abort) controller.abort();
        if (fault === "stat EIO") throw Object.assign(new Error("synthetic stat failure"), { code: "EIO" });
        return info;
      });
      t.mock.method(handle, "read", async () => { reads++; throw new Error("early rejection must not read"); });
      t.mock.method(handle, "close", async () => { await close(); closed++; });
      return handle;
    });
    const result = await smallRun(f.workspace, [shape], controller.signal, { maxTableBytes: 3 });
    t.diagnostic(JSON.stringify({ fault, abort, outcome: result.outcome, cancelledNote: result.evidence.endsWith(CANCELLED) }));
    assert.equal(hit, true);
    assert.deepEqual([reads, closed], [0, 1]);
    if (abort) cancelled(result);
    else {
      assert.equal(result.outcome, fault === "oversize" ? "fail" : "inconclusive");
      assert.ok(result.evidence.includes(fault === "oversize" ? "larger than 3 bytes" : "file could not be read (EIO)"));
      assert.ok(!result.evidence.includes("cancelled"));
    }
  });
}

test("C2R-2 control: read EIO plus abort already uses the cancellation verdict", async t => {
  const f = await smallFixture(t), controller = new AbortController(), actualOpen = fs.open;
  let closed = 0, hit = false;
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await actualOpen(...args), close = handle.close.bind(handle);
    t.mock.method(handle, "read", async () => {
      hit = true;
      controller.abort();
      throw Object.assign(new Error("synthetic read failure"), { code: "EIO" });
    });
    t.mock.method(handle, "close", async () => { await close(); closed++; });
    return handle;
  });
  cancelled(await smallRun(f.workspace, [shape], controller.signal));
  assert.deepEqual([hit, closed], [true, 1]);
});

test("C2R-2: abort during close after an early size rejection overrides the size verdict", async t => {
  const f = await smallFixture(t), controller = new AbortController();
  const seen = watch(t, f.root, (file, event) => { if (file === "table.csv" && event === "close") controller.abort(); });
  cancelled(await smallRun(f.workspace, [shape], controller.signal, { maxTableBytes: 3 }));
  assert.deepEqual([seen.get("table.csv")?.bytes, seen.get("table.csv")?.closes], [0, 1]);
});

test("C2R-2: a previous failed rule keeps fail while the current rule becomes cancelled", async t => {
  const f = await smallFixture(t), controller = new AbortController();
  let hits = 0;
  const workspace: Workspace = { ...f.workspace, async resolve(file, access) {
    const result = await f.workspace.resolve(file, access);
    if (file === "spare.csv" && ++hits === 2) controller.abort();
    return result;
  } };
  const failure: DataRule = { ...shape, rows: { equals: 2 } };
  const result = await smallRun(workspace, [failure, shape], controller.signal, { unreadablePaths: ["spare.csv"] });
  const lines = result.evidence.split("\n");
  assert.equal(hits, 2);
  assert.equal(result.outcome, "fail");
  assert.ok(lines[0]?.startsWith("not held:"));
  assert.ok(lines[1]?.startsWith("undecided:") && lines[1].endsWith(CANCELLED));
});

test("C2R-2 control: a pre-cancelled run keeps the existing before-rule wording without opening tables", async t => {
  const f = await smallFixture(t), controller = new AbortController();
  controller.abort();
  const seen = watch(t, f.root, () => {});
  const result = await smallRun(f.workspace, [shape, smallAggregate], controller.signal);
  assert.equal(result.outcome, "inconclusive");
  assert.equal(seen.size, 0);
  assert.equal(result.evidence.split("\n").filter(line => line.endsWith("(cancelled before this rule was checked)")).length, 2);
});

test("C2R-2 control: a parse error without cancellation keeps its failure and evidence", async t => {
  const f = await smallFixture(t);
  await fs.writeFile(path.join(f.root, "table.csv"), 'v\n"unterminated\n');
  const result = await smallRun(f.workspace, [shape], new AbortController().signal, { unreadablePaths: ["spare.csv"] });
  assert.equal(result.outcome, "fail");
  assert.ok(result.evidence.includes("does not parse as csv"));
  assert.ok(!result.evidence.includes("cancelled"));
});
