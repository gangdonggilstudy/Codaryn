/**
 * C4 (review SP-1): the group limits over sparse JSONL rows. Every row brings a key not seen before
 * and lacks the earlier ones, so after the first row each row is incomplete (the sparse path since
 * C4). 10,001 groups: query_table ends too_many_groups and data_checks aggregate_match is undecided
 * at the 10,000-group limit, with the same bytes as the dense many.jsonl cases of
 * c4-sparse-equivalence.test.ts (only the table's name differs). No time limit (load sensitive).
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { DataRule, QueryTableArgs, Workspace } from "../../../src/contracts/index.js";
import { queryTableTool } from "../../../src/tools/query-table.js";
import { runDataChecksVerifier } from "../../../src/verify/data-checks.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const GROUPS = 10_001;
const ROWS = Array.from({ length: GROUPS }, (_, i) => ({ g: String(i), v: 1, [`k${i}`]: i }));
const FIXTURES: Record<string, string> = {
  "sparse-many.jsonl": ROWS.map((row) => JSON.stringify(row)).join("\n") + "\n",
  "out/groups.jsonl": "{\"g\":\"a\",\"total\":21}\n{\"total\":15,\"g\":\"b\",\"extra\":\"\"}\n",
};
const LIMITS = { chunkBytes: 65536, minGroupSize: 5 };

const QUERY: QueryTableArgs = { path: "sparse-many.jsonl", format: "jsonl", groupBy: ["g"], operations: [{ op: "sum", column: "v" }] };
const RULES: readonly DataRule[] = [
  { type: "aggregate_match", source: { path: "sparse-many.jsonl", format: "jsonl" }, column: "v", op: "sum", target: { path: "out/groups.jsonl", format: "jsonl" }, targetColumn: "total", groupBy: "g", targetKeyColumn: "g" },
];
const QUERY_BYTES = "{\"ok\":false,\"code\":\"too_many_groups\",\"message\":\"the query counts more than 10000 groups\"}";
const DATA_BYTES = "{\"id\":\"c4\",\"kind\":\"data_checks\",\"outcome\":\"inconclusive\",\"evidence\":\"undecided: sum of \\\"v\\\" in \\\"sparse-many.jsonl\\\" (jsonl) grouped by \\\"g\\\" matches \\\"total\\\" in \\\"out/groups.jsonl\\\" (jsonl) (key column \\\"g\\\") within absolute 1e-9, relative 1e-9 (group comparison exceeded the safety limit of 10,000; split the table or change its group column)\",\"checked\":[\"sum of \\\"v\\\" in \\\"sparse-many.jsonl\\\" (jsonl) grouped by \\\"g\\\" matches \\\"total\\\" in \\\"out/groups.jsonl\\\" (jsonl) (key column \\\"g\\\") within absolute 1e-9, relative 1e-9\"],\"limits\":[\"only the listed table shapes and aggregates are checked; the method, the interpretation and any number written in prose are not\",\"tables are read as CSV (an RFC 4180 subset), TSV or JSON Lines of at most 16 MiB; numbers are plain decimals (-?digits[.digits][e±digits]) computed as doubles\",\"group values are compared as exact text, and rows whose group cell is empty are left out of the groups\",\"sum, min, max and mean cannot be checked (inconclusive) when the column, or any one group of a grouped rule, has only empty cells; sum and mean cannot be checked when a running sum goes beyond a double's range, which depends on the row order (the same values in another order may be checked)\",\"1 of 1 rules exceeded the 10,000-group comparison safety limit\"]}";

let root: string;
let workspace: Workspace;
before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "codaryn-c4-group-limit-")));
  for (const [file, text] of Object.entries(FIXTURES)) {
    const at = path.join(root, file);
    await fs.mkdir(path.dirname(at), { recursive: true });
    await fs.writeFile(at, text);
  }
  workspace = await createWorkspace({ root });
});
after(async () => { await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

test("C4 SP-1: after the first row every row is incomplete (it adds one key and lacks the earlier ones)", () => {
  const seen = new Set<string>();
  for (const [index, row] of ROWS.entries()) {
    const keys = Object.keys(row);
    assert.equal(keys.filter((key) => !seen.has(key)).length, index === 0 ? 3 : 1, `row ${index + 1} adds one new key`);
    keys.forEach((key) => seen.add(key));
    if (index > 0) assert.ok(keys.length < seen.size, `row ${index + 1} lacks earlier keys`);
  }
  assert.equal(new Set(ROWS.map((row) => row.g)).size, GROUPS);
});

test("C4 SP-1: query_table over sparse rows ends too_many_groups with the dense case's bytes", async () => {
  const result = await queryTableTool({ workspace, ...LIMITS }, QUERY, new AbortController().signal);
  assert.equal(JSON.stringify(result), QUERY_BYTES);
});

test("C4 SP-1: data_checks aggregate_match over sparse rows stops at the group limit with the dense case's bytes", async () => {
  const result = await runDataChecksVerifier({ id: "c4", kind: "data_checks", rules: RULES }, workspace, new AbortController().signal, LIMITS);
  assert.equal(JSON.stringify(result), DATA_BYTES);
});
