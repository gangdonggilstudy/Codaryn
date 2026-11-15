/** DR-76: per-table distinct group cap, without changing the U-202 reference behavior below it. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import type { DataChecksVerifierConfig, DataRule, RawVerifierResult, Workspace } from "../../../src/contracts/index.js";
import { MAX_DATA_CHECK_GROUPS, MAX_DATA_TABLE_BYTES } from "../../../src/contracts/index.js";
import { DATA_CHECKS_LIMITS, runDataChecksVerifier } from "../../../src/verify/data-checks.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const CAP = 10_000;
let root = "";
let workspace: Workspace;

const csv = (path: string) => ({ path, format: "csv" as const });
const rows = (count: number, value = "1") => `key,value\n${Array.from({ length: count }, (_, i) => `group-${i},${value}`).join("\n")}\n`;
const grouped = (source = "data/source.csv", target = "data/target.csv"): DataRule => ({
  type: "aggregate_match", source: csv(source), column: "value", op: "sum", groupBy: "key",
  target: csv(target), targetColumn: "value", targetKeyColumn: "key",
});
const total = (): DataRule => ({ type: "aggregate_match", source: csv("data/total.csv"), column: "value", op: "sum", target: csv("data/wrong.csv"), targetColumn: "value" });

before(async () => {
  root = await mkdtemp(join(tmpdir(), "codaryn-e4-groups-"));
  await mkdir(join(root, "data"));
  await mkdir(join(root, ".codaryn"));
  workspace = await createWorkspace({ root });
  await put("data/source.csv", rows(CAP));
  await put("data/target.csv", rows(CAP));
  await put("data/total.csv", "value\n1\n");
  await put("data/wrong.csv", "value\n2\n");
});

after(async () => { await rm(root, { recursive: true, force: true }); });

async function put(path: string, text: string): Promise<void> { await writeFile(join(root, path), text, "utf8"); }
async function run(rules: readonly DataRule[], unreadablePaths?: readonly string[]): Promise<RawVerifierResult> {
  return runDataChecksVerifier(
    { id: "e4", kind: "data_checks", rules: [...rules] } satisfies DataChecksVerifierConfig,
    workspace,
    new AbortController().signal,
    unreadablePaths === undefined ? {} : { unreadablePaths },
  );
}
function capNote(result: RawVerifierResult): void {
  assert.match(result.evidence, /group comparison exceeded the safety limit of 10,000/);
  assert.ok(result.limits.some((line) => line.includes("exceeded the 10,000-group comparison safety limit")));
}

test("exactly 10,000 distinct keys on both tables remain comparable and keep fixed limits", async () => {
  assert.equal(MAX_DATA_CHECK_GROUPS, CAP);
  assert.equal(MAX_DATA_TABLE_BYTES, 16 * 1024 * 1024);
  await put("data/source.csv", rows(CAP));
  await put("data/target.csv", rows(CAP));
  const result = await run([grouped()]);
  assert.equal(result.outcome, "pass", result.evidence);
  assert.deepEqual(result.limits, DATA_CHECKS_LIMITS);
  assert.doesNotMatch(result.evidence, /safety limit/);
});

test("10,001 source groups exceed the cap without retaining or disclosing the extra key", async () => {
  await put("data/source.csv", rows(CAP + 1));
  await put("data/target.csv", rows(CAP));
  const result = await run([grouped()]);
  assert.equal(result.outcome, "inconclusive");
  capNote(result);
  assert.doesNotMatch(result.evidence, /group-10000|10001|10001 data row/);
});

test("10,001 target groups exceed the cap independently of a within-cap source", async () => {
  await put("data/source.csv", rows(CAP));
  await put("data/target.csv", rows(CAP + 1));
  const result = await run([grouped()]);
  assert.equal(result.outcome, "inconclusive");
  capNote(result);
  assert.doesNotMatch(result.evidence, /group-10000|10001|10001 data row/);
});

test("a cap-exceeded rule is inconclusive while another rule's failure still wins", async () => {
  await put("data/source.csv", rows(CAP + 1));
  await put("data/target.csv", rows(CAP));
  const result = await run([grouped(), total()]);
  assert.equal(result.outcome, "fail");
  capNote(result);
  assert.match(result.evidence, /not held:.*recomputed 1, found 2/);
});

test("a hidden source is counted before the k-group filter and its keys stay out of evidence", async () => {
  await put("data/hidden-source.csv", rows(CAP + 1));
  await put("data/target.csv", rows(CAP));
  const result = await run([grouped("data/hidden-source.csv")], ["data/hidden-source.csv"]);
  assert.equal(result.outcome, "inconclusive");
  capNote(result);
  assert.match(result.evidence, /source is under unreadable paths/);
  assert.doesNotMatch(result.evidence, /group-\d+|source data row \d+|10001/);
});

test("a table parse error after exceeding the observed cap retains load-error precedence", async () => {
  await put("data/source.csv", `${rows(CAP + 1)}\"unterminated`);
  await put("data/target.csv", rows(CAP));
  const result = await run([grouped()]);
  assert.equal(result.outcome, "inconclusive");
  assert.match(result.evidence, /does not parse as csv/);
  assert.doesNotMatch(result.evidence, /safety limit/);
});
