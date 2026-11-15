/**
 * Review R-13 (G-D, 2026-11-12) low findings, reproduced first:
 * - L-1: a source sum or mean beyond a double's range is a source problem (inconclusive), not a
 *   wrong target (fail).
 * - L-2 (PM decision: the behaviour is kept and named in the limits): in a grouped rule, one group
 *   whose source cells are all empty leaves the whole rule inconclusive, whatever the target holds,
 *   as a column without any number does; DATA_CHECKS_LIMITS says so.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import type { DataChecksVerifierConfig, DataRule, RawVerifierResult, Workspace } from "../../../src/contracts/index.js";
import { DATA_CHECKS_LIMITS, runDataChecksVerifier } from "../../../src/verify/data-checks.js";
import { createWorkspace } from "../../../src/workspace/index.js";

let root = "";
let workspace: Workspace;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "codaryn-r13-"));
  await mkdir(join(root, "data"));
  await mkdir(join(root, "out"));
  const files: Record<string, string> = {
    "data/huge.csv": "v\n1e308\n1e308\n",
    "data/huge-cancel.csv": "v\n1e308\n1e308\n-1e308\n-1e308\n",
    "data/order-within.csv": "v\n1e308\n-1e308\n1e308\n",
    "data/order-over.csv": "v\n1e308\n1e308\n-1e308\n",
    "out/big.csv": "total\n1e308\n",
    "out/five.csv": "total\n5\n",
    "out/zero.csv": "total\n0\n",
    "data/gaps.csv": "k,v\na,1\nb,\nb,\nc,2\n",
    "data/all-empty.csv": "k,v\na,\nb,\n",
    "out/gaps-empty.csv": "k,total\na,1\nb,\nc,2\n",
    "out/gaps-zero.csv": "k,total\na,1\nb,0\nc,2\n",
    "out/gaps-missing.csv": "k,total\na,1\nc,2\n",
    "out/gaps-count.csv": "k,total\na,1\nb,0\nc,1\n",
  };
  for (const [name, text] of Object.entries(files)) await writeFile(join(root, name), text, "utf8");
  workspace = await createWorkspace({ root });

});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

const csv = (path: string) => ({ path, format: "csv" as const });
const config = (...rules: DataRule[]): DataChecksVerifierConfig => ({ id: "data", kind: "data_checks", rules });
const run = (...rules: DataRule[]): Promise<RawVerifierResult> => runDataChecksVerifier(config(...rules), workspace, new AbortController().signal);

const total = (source: string, target: string, op: "sum" | "mean" = "sum"): DataRule => ({
  type: "aggregate_match",
  source: csv(source),
  column: "v",
  op,
  target: csv(target),
  targetColumn: "total",
});
const byKey = (target: string, op: "sum" | "count" | "min" | "max" | "mean" = "sum", source = "data/gaps.csv"): DataRule => ({
  type: "aggregate_match",
  source: csv(source),
  column: "v",
  op,
  groupBy: "k",
  target: csv(target),
  targetColumn: "total",
  targetKeyColumn: "k",
});

test("R-13 L-1: a source sum or mean beyond a double's range is inconclusive, not fail", async () => {
  for (const op of ["sum", "mean"] as const) {
    const result = await run(total("data/huge.csv", "out/five.csv", op));
    assert.equal(result.outcome, "inconclusive", `${op}: ${result.evidence}`);
    assert.match(result.evidence, /out of range/, result.evidence);
    assert.equal(result.evidence.includes("NaN"), false, result.evidence);
  }
  // The exact sum is 0, but its partial sums overflow: the verifier cannot decide it.
  const cancelling = await run(total("data/huge-cancel.csv", "out/zero.csv"));
  assert.equal(cancelling.outcome, "inconclusive", cancelling.evidence);
});

test("review R-18 I1, I2: the overflow depends on the row order and concerns sum and mean only; the limits say so", async () => {
  // The same three values: the running sum stays in range in one order and overflows in the other.
  const within = await run(total("data/order-within.csv", "out/big.csv"));
  assert.equal(within.outcome, "pass", within.evidence);
  const over = await run(total("data/order-over.csv", "out/big.csv"));
  assert.equal(over.outcome, "inconclusive", over.evidence);
  // min and max add nothing up: two values of 1e308 are checked.
  for (const op of ["min", "max"] as const) {
    const result = await run({ ...total("data/huge.csv", "out/big.csv"), op } as DataRule);
    assert.equal(result.outcome, "pass", `${op}: ${result.evidence}`);
  }
  const line = DATA_CHECKS_LIMITS.find((text) => text.includes("double's range")) ?? "";
  assert.match(line, /sum and mean cannot be checked when a running sum goes beyond a double's range/);
  assert.match(line, /depends on the row order/);
});

test("R-13 L-2 (kept): a group with only empty source cells leaves the rule inconclusive, and the limits say so", async () => {
  // Whatever the target holds for that group (empty, 0 or no row): the rule is not decided.
  for (const op of ["sum", "min", "max", "mean"] as const) {
    for (const target of ["out/gaps-empty.csv", "out/gaps-zero.csv", "out/gaps-missing.csv"]) {
      const result = await run(byKey(target, op));
      assert.equal(result.outcome, "inconclusive", `${op} ${target}: ${result.evidence}`);
      assert.match(result.evidence, /has no number to compute \(group first seen at source data row 2\)/, result.evidence);
    }
  }
  // count needs no number: the empty group counts 0 non-empty cells and is checked.
  const count = await run(byKey("out/gaps-count.csv", "count"));
  assert.equal(count.outcome, "pass", count.evidence);
  // Not grouped: a column without any number cannot be checked either.
  const ungrouped = await run({ type: "aggregate_match", source: csv("data/all-empty.csv"), column: "v", op: "sum", target: csv("out/zero.csv"), targetColumn: "total" });
  assert.equal(ungrouped.outcome, "inconclusive", ungrouped.evidence);
  // The verifier's result names this limit (review R-13 L-2: it was not listed).
  assert.ok(
    DATA_CHECKS_LIMITS.some((line) => /any one group of a grouped rule, has only empty cells/.test(line)),
    "DATA_CHECKS_LIMITS names the rule",
  );
  const result = await run(byKey("out/gaps-empty.csv"));
  assert.ok(result.limits.some((line) => /only empty cells/.test(line)), "the result carries the limit");
});
