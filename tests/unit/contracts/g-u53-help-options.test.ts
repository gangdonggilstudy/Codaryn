/**
 * U-53 (review R-64 L1, I1 to I3; R-58 L2): option texts the help could not give.
 * - workflow: run, plan, apply and review take `--workflow <id>`, but no help line described it.
 * - json_line: the `--json` of run, revert and apply shared `help.option.json` ("print the result as
 *   one JSON line"), which reads as "JSON instead of text"; there it prints the result's JSON line on
 *   stdout at a terminal too.
 * - run_task: `--task` of plan, apply, review and changes said "the task file to run"; they run
 *   nothing and read the task's settings, checks and secrets.
 * - workspace_or_current: `--workspace` of report, runs, plan and changes did not say that leaving it
 *   out (with no --task) means the current directory (U-17); apply, review, cleanup and revert need it.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { HELP_OPTIONS, MESSAGE_IDS, messageParams } from "../../../src/contracts/index.js";
import type { HelpOption, MessageId } from "../../../src/contracts/index.js";

const NEW_OPTIONS = ["workflow", "json_line", "run_task", "workspace_or_current"];

describe("U-53: the help's missing option texts", () => {
  test("the four options come after the others, each once", () => {
    assert.deepEqual(HELP_OPTIONS.slice(-NEW_OPTIONS.length), NEW_OPTIONS);
    assert.equal(new Set(HELP_OPTIONS).size, HELP_OPTIONS.length);
    for (const kept of ["task", "workspace", "json", "run", "plan_run"]) assert.ok((HELP_OPTIONS as readonly string[]).includes(kept), kept);
  });

  test("each has its help.option id, without parameters", () => {
    const ids = MESSAGE_IDS as readonly string[];
    for (const option of NEW_OPTIONS) {
      const id = `help.option.${option}`;
      assert.equal(ids.filter((entry) => entry === id).length, 1, id);
      assert.deepEqual(messageParams(id as MessageId), {}, id);
    }
    const typed: HelpOption = "workspace_or_current";
    assert.ok(HELP_OPTIONS.includes(typed));
  });
});
