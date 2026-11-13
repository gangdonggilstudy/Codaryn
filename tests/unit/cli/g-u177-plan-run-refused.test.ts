/**
 * U-177 (review R-99 M-2) refused plan mode "run" at the CLI's parsers while nothing carried a run
 * plan out. U-195 (DR-69 B-4) lifts it: codaryn apply now carries a run plan out (see
 * g-u195-run-plan-cli.test.ts for the whole way on the real CLI). So a task file's and a config
 * definition's `plan: "run"` are taken again, a wrong plan value's message lists every PLAN_MODES
 * value, and the hint plan_run_not_available is no longer given (it stays listed, as hints are only
 * added; cli-contract 8.3).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CLI_ERROR_HINTS } from "../../../src/contracts/index.js";
import { parseConfig } from "../../../src/cli/config.js";
import { parseTask } from "../../../src/cli/task.js";

const TASK = {
  schemaVersion: 1,
  id: "u177",
  goal: "g",
  workflow: "code",
  workspaceRoot: "./ws",
  model: { provider: "scripted", scriptPath: "./script.json" },
  policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
  privacy: { secretEnv: [] },
  limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 },
  verifiers: [],
};
const hintOf = (value: object): unknown => (value as { readonly hint?: unknown }).hint;

describe("U-195 lifts U-177: the parsers take plan \"run\" again", () => {
  test("a task file's plan \"run\" parses", () => {
    const outcome = parseTask({ ...TASK, plan: "run" }, process.cwd());
    assert.ok(outcome.ok, outcome.ok ? "" : outcome.message);
    if (outcome.ok) assert.equal(outcome.task.plan, "run");
  });

  test("a wrong plan value's message lists none, apply and run, without a hint", () => {
    const outcome = parseTask({ ...TASK, plan: "later" }, process.cwd());
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.message, "plan must be one of none, apply, run");
    assert.equal(hintOf(outcome), undefined);
  });

  test("a config definition's plan \"run\" parses; the hint stays listed but is not given", () => {
    const outcome = parseConfig({ schemaVersion: 1, workflows: { rundef: { tools: ["read_file", "search_files", "write_file", "propose_changes"], plan: "run" } } });
    assert.ok(outcome.ok, outcome.ok ? "" : outcome.message);
    assert.ok((CLI_ERROR_HINTS as readonly string[]).includes("plan_run_not_available"));
  });
});
