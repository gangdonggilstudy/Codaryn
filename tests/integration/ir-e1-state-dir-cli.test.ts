/**
 * IR-E1 (review E): the real CLI `run` in a workspace whose `.codaryn` (or `.codaryn/runs`) is a
 * junction to a folder outside it ends before anything is recorded: exit 2, state_dir_not_plain, and
 * the folder outside stays empty. Before IR-E1 the run ended done/verified with its journal, result
 * and snapshots outside the workspace. Junctions are Windows only; elsewhere these cases skip.
 */

import assert from "node:assert/strict";
import { mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import type { CliErrorCode } from "../../src/contracts/index.js";
import { createSandbox, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import { cliEnv, expectCliError, runTask } from "../support/cli.js";

const SKIP = process.platform === "win32" ? false : "junctions exist on Windows only";
const STEPS = [
  { toolCalls: [{ name: "write_file", args: { path: "NOTES.md", expectedHash: null, change: { kind: "replace_all", content: "# Notes\n" } } }] },
  { text: "done" },
];

for (const place of ["state", "runs"] as const) {
  const where = place === "state" ? ".codaryn" : ".codaryn/runs";
  test(`IR-E1 CLI run: a junction at ${where} ends as state_dir_not_plain (exit 2) and writes nothing outside`, { skip: SKIP }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "README.md", "# ws\n");
    const task = writeTask(sb, { id: "ir-e1", verifiers: [{ id: "notes", kind: "file_rules", rules: [{ type: "contains", path: "NOTES.md", text: "# Notes" }] }] }, STEPS as unknown as Parameters<typeof writeTask>[2]);
    const outside = join(sb.base, "outside");
    mkdirSync(outside);
    if (place === "state") symlinkSync(outside, join(sb.workspace, ".codaryn"), "junction");
    else {
      mkdirSync(join(sb.workspace, ".codaryn"));
      symlinkSync(outside, join(sb.workspace, ".codaryn", "runs"), "junction");
    }
    const run = await runTask(task, { cwd: sb.base, env: cliEnv() });
    assert.equal(run.exitCode, 2);
    expectCliError(run, "state_dir_not_plain" as CliErrorCode);
    assert.deepEqual(readdirSync(outside), [], "nothing was written through the junction");
  });
}
