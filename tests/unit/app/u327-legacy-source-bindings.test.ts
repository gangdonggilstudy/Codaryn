/** U-327: old public paths retain the existing app function bindings. */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as oldReport from "../../../src/cli/report.js";
import * as reportSource from "../../../src/app/report-read.js";
import { resolveWorkspaceRoot as oldResolve } from "../../../src/cli/runs.js";
import { resolveWorkspaceRoot } from "../../../src/app/workspace-root.js";

for (const name of ["readApplyResult", "readResult", "summarizeApplyJournal", "summarizeJournal"] as const) {
  test(`U-327: legacy report.${name} is the canonical app binding`, () => {
    assert.strictEqual(oldReport[name], reportSource[name]);
  });
}

test("U-327: legacy runs.resolveWorkspaceRoot is the canonical app binding", () => {
  assert.strictEqual(oldResolve, resolveWorkspaceRoot);
});
