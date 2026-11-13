/**
 * U-261 (nd-docs' F-3; hints drafted by nb-i18n, U-260): query_table's seven problems all come as
 * the one tool error invalid_table, so the code's one hint fitted only some (asking a table under
 * unreadablePaths for max was told to look at the columns). Now each message ends with its problem's
 * own hint (QUERY_TABLE_PROBLEM_HINTS) and the engine adds none. The hints are model-bound fixed texts
 * (FIXED_MODEL_TEXTS) with no number in them, and under unreadablePaths a message names no data row
 * and no line (nothing of a single row reaches the model, DR-70); a general table keeps them.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { QUERY_TABLE_PROBLEMS, QUERY_TABLE_PROBLEM_HINTS, TOOL_FAILURE_HINTS, failedToolContent, toolFailureMessage } from "../../../src/contracts/index.js";
import type { RawWorkflowToolOutcome, Workspace } from "../../../src/contracts/index.js";
import { FIXED_MODEL_TEXTS } from "../../../src/engine/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { createFakePrivacy } from "./doubles.js";

const never = new AbortController().signal;
let base: string;
let workspace: Workspace;

before(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u261-"));
  const root = path.join(base, "root");
  for (const dir of ["private", "data"]) fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const dir of ["private", "data"]) {
    fs.writeFileSync(path.join(root, dir, "bad-number.csv"), "g,v\nx,1\nx,1\nx,1\nx,1\nx,word\n");
    fs.writeFileSync(path.join(root, dir, "bad-quote.csv"), 'g,v\nx,1\nx,"open\n');
    fs.writeFileSync(path.join(root, dir, "people.csv"), "g,v\nx,1\nx,2\nx,3\nx,4\nx,5\n");
  }
  workspace = await createWorkspace({ root });
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

async function query(args: Record<string, unknown>): Promise<RawWorkflowToolOutcome> {
  const tools = createToolRunner({ workspace, privacy: createFakePrivacy(), unreadablePaths: ["private"] });
  assert.ok(tools.executeWorkflowTool !== undefined);
  return tools.executeWorkflowTool({ id: "c1", name: "query_table", args } as never, never);
}
const messageOf = (outcome: RawWorkflowToolOutcome): string => {
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  assert.equal((outcome as { code: string }).code, "invalid_table");
  return String((outcome as { message: string }).message);
};

describe("U-261: query_table's hints, one for each problem", () => {
  test("every problem has a hint; the column problems share one, the others their own; no number in any; all are fixed model texts", () => {
    assert.deepEqual(Object.keys(QUERY_TABLE_PROBLEM_HINTS).sort(), [...QUERY_TABLE_PROBLEMS].sort());
    assert.equal(QUERY_TABLE_PROBLEM_HINTS.unknown_column, QUERY_TABLE_PROBLEM_HINTS.duplicate_column);
    assert.equal(new Set(Object.values(QUERY_TABLE_PROBLEM_HINTS)).size, QUERY_TABLE_PROBLEMS.length - 1);
    for (const hint of Object.values(QUERY_TABLE_PROBLEM_HINTS)) {
      assert.ok(hint.endsWith("."), hint);
      assert.doesNotMatch(hint.replace("UTF-8", ""), /[0-9]/, hint);
      assert.ok(FIXED_MODEL_TEXTS.includes(hint), hint);
    }
  });

  test("the engine adds no hint of its own to invalid_table, so a message ends with its problem's hint once", () => {
    assert.equal(TOOL_FAILURE_HINTS.invalid_table, undefined);
    const message = `table rejected: op_not_allowed at operations[0].op. ${QUERY_TABLE_PROBLEM_HINTS.op_not_allowed}`;
    assert.equal(toolFailureMessage("invalid_table", message), message);
    assert.equal(failedToolContent("invalid_table", toolFailureMessage("invalid_table", message)), `error (invalid_table): ${message}`);
  });

  test("F-3: max on a table under unreadablePaths is told which operations it takes, not to look at the columns", async () => {
    const message = messageOf(await query({ path: "private/people.csv", operations: [{ op: "max", column: "v" }] }));
    assert.equal(message, `table rejected: op_not_allowed at operations[0].op. ${QUERY_TABLE_PROBLEM_HINTS.op_not_allowed}`);
    assert.equal(message.includes("describe"), false);
  });

  test("under unreadablePaths no data row and no line; a general table names them", async () => {
    const privateNumber = messageOf(await query({ path: "private/bad-number.csv", operations: [{ op: "sum", column: "v" }] }));
    assert.equal(privateNumber, `table rejected: not_number at operations[0]. ${QUERY_TABLE_PROBLEM_HINTS.not_number}`);
    const privateQuote = messageOf(await query({ path: "private/bad-quote.csv", operations: [{ op: "count", column: "v" }] }));
    assert.equal(privateQuote, `table rejected: not_table at (unterminated_quote). ${QUERY_TABLE_PROBLEM_HINTS.not_table}`);
    const describeQuote = messageOf(await query({ path: "private/bad-quote.csv", describe: true }));
    assert.equal(describeQuote, privateQuote);
    for (const message of [privateNumber, privateQuote]) assert.doesNotMatch(message.replace(/operations\[\d+\]/g, ""), /[0-9]/, message);
    assert.match(messageOf(await query({ path: "data/bad-number.csv", operations: [{ op: "sum", column: "v" }] })), /^table rejected: not_number at data row 5, operations\[0\]\. /);
    assert.match(messageOf(await query({ path: "data/bad-quote.csv", operations: [{ op: "count", column: "v" }] })), /^table rejected: not_table at line 3 \(unterminated_quote\)\. /);
  });
});
