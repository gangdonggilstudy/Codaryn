/**
 * Unit U-237 (p4g's R-108 H-2, after U-210's runGuards): the app's checks before an apply judge with
 * the gate the apply will have, the run's unreadable paths included.
 * Beside the run assembly, the app built a gate in two more places, both without the run's list:
 * - checkApply on a plan of moves (check-apply.ts): the preflight's gate. The CLI's apply of moves
 *   makes its gate from runGuards, so a move into an unreadable folder is refused there while the
 *   check said nothing about it.
 * - checkApply on a run plan (changes-plan.ts, checkChangesPlanFiles): the gate of the run that will
 *   carry the plan out. That run's gate is runGuards' (approvedPlan.policyFor), so a planned file
 *   under an unreadable folder is denied there while the check said nothing. The check also now asks
 *   the engine's own judgement (judgePlannedFile, U-219; Codex V-21) with the same lists
 *   (approvedPlanWritablePathSets) instead of its own lines.
 * Each plan is made while no list exists; then the config file gets `unreadablePaths: ["private"]`.
 * Reproduced first (todo until the checks used runGuards). Temporary folders, scripted model, fake values only.
 */

import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { PlanCheck } from "../../../src/app/index.js";
import { appEnvironment, exists, planSteps, plannedRun, setupRun, taskForm, taskRequest } from "./support.js";

const TODO = { todo: "R-108 H-2: the app's checks judge with runGuards' gate" };
/** A whole policy (a config file's policy is one), with the private folder unreadable. */
const PRIVATE_POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, unreadablePaths: ["private"] };
const REWRITE = { tools: ["read_file", "search_files", "write_file", "propose_changes"], plan: "run" };

function checked(outcome: { ok: boolean }): PlanCheck {
  assert.ok(outcome.ok, JSON.stringify(outcome));
  return (outcome as unknown as { output: PlanCheck }).output;
}

describe("U-237, R-108 H-2: the app's checks and the run's unreadable paths", () => {
  test("a plan of moves into an unreadable folder: the check says so, as the apply refuses it", TODO, async () => {
    const planned = await plannedRun({ "a.txt": "alpha\n" }, planSteps("a.txt", "private/a.txt"));
    const config = path.join(planned.base, "config.json");
    await writeFile(config, JSON.stringify({ schemaVersion: 1, policy: PRIVATE_POLICY }), "utf8");
    const settings = taskForm(planned.base, { configPath: config });
    const check = checked(await planned.app.checkApply({ settings, planRunId: planned.plan.runId, digest: planned.digest }));
    assert.equal(check.problems.length, 1, JSON.stringify(check.problems));
    assert.equal(check.problems[0]?.index, 0);
    // The apply with the same form moves nothing either.
    const applied = await planned.app.applyPlan({ settings, planRunId: planned.plan.runId, digest: planned.digest, cancelFile: null, unsafeMoveConsent: null });
    if (applied.ok) await applied.handle.done;
    assert.equal(await exists(path.join(planned.base, "work", "private", "a.txt")), false);
    assert.equal(await exists(path.join(planned.base, "work", "a.txt")), true);
  });

  test("a run plan with a file under an unreadable folder: the check denies that file, as the carried-out run's gate does", TODO, async () => {
    const propose = { toolCalls: [{ name: "propose_changes", args: { summary: "add the notes", files: [{ path: "NOTES.md", change: "create" }, { path: "private/notes.md", change: "create" }] } }] };
    const base = await setupRun({}, { workflowRef: "rewrite" }, [propose, { text: "planned" }]);
    const config = path.join(base, "config.json");
    await writeFile(config, JSON.stringify({ schemaVersion: 1, workflows: { rewrite: REWRITE } }), "utf8");
    const app = createCodarynApp(await appEnvironment(base));
    const started = await app.startRun(taskRequest(base, { configPath: config }));
    assert.ok(started.ok, JSON.stringify(started));
    const ended = await started.handle.done;
    assert.ok(ended.ok, JSON.stringify(ended));
    const plan = ended.result.plan as { digest: string; kind?: string } | undefined;
    assert.deepEqual([ended.result.reason, plan?.kind], ["plan_pending", "changes"], JSON.stringify(ended.result));
    // Afterwards the private folder becomes unreadable.
    await writeFile(config, JSON.stringify({ schemaVersion: 1, policy: PRIVATE_POLICY, workflows: { rewrite: REWRITE } }), "utf8");
    const check = checked(await app.checkApply({ settings: taskForm(base, { configPath: config }), planRunId: ended.result.runId, digest: plan!.digest }));
    assert.deepEqual([check.kind, check.planKind], ["plan_check", "changes"]);
    assert.deepEqual(check.problems, [{ index: 1, problem: "denied" }], "the file under private, not NOTES.md");
  });
});
