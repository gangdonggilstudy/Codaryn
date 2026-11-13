/**
 * The plan view and the person's review through the app layer (adapter-contract 5.6; DR-1, DR-5,
 * DR-17, GT-D6, R-4 L-4): the CLI's `plan` and `review` with the task form, masked with the
 * secrets it registers. Real engine, store, tools and scripted model; fake values only.
 */

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import type { ApplyResult, PlanOutput, ReviewOutput } from "../../../src/contracts/index.js";
import { createCodarynApp, planArguments, reviewArguments } from "../../../src/app/index.js";
import type { AppCallOutcome, ReviewRequest } from "../../../src/app/index.js";
import { FAKE_SECRET, WRITE_NOTES, appEnvironment, exists, plannedRun, planSteps, runDir, setupRun, taskForm, taskRequest } from "./support.js";

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}

function code<T>(outcome: AppCallOutcome<T>): string | null {
  return outcome.ok ? null : outcome.error.code;
}

describe("plan", () => {
  test("shows the stored plan, masked with the task form's secrets; after the apply it names that apply", async () => {
    const secretName = `${FAKE_SECRET}.txt`;
    const { base, app, plan, digest } = await plannedRun({ [secretName]: "alpha\n" }, planSteps(secretName, "sorted/b.txt"));
    const view = ok(await app.plan({ settings: taskForm(base), runId: "latest" })) as PlanOutput;
    assert.deepEqual([view.kind, view.runId, view.status, view.digest, view.appliedBy], ["plan", plan.runId, "pending", digest, null]);
    assert.equal(view.actions.length, 1);
    assert.equal(JSON.stringify(view).includes(FAKE_SECRET), false, "the file name's secret is masked");

    const started = await app.applyPlan({ settings: taskForm(base), planRunId: plan.runId, digest: digest.slice(0, 12), cancelFile: null, unsafeMoveConsent: null });
    assert.ok(started.ok, JSON.stringify(started));
    const applied = ok<ApplyResult>(await started.handle.done);
    const after = ok(await app.plan({ settings: taskForm(base), runId: plan.runId })) as PlanOutput;
    assert.deepEqual([after.status, after.appliedBy?.runId], ["applied", applied.runId]);
  });

  test("a run that is not a plan run, an unknown run and a broken task form are the CLI's errors", async () => {
    const { base, app } = await plannedRun();
    const normal = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const other = createCodarynApp(await appEnvironment(normal));
    const started = await other.startRun(taskRequest(normal));
    assert.ok(started.ok);
    await started.handle.done;
    assert.equal(code(await other.plan({ settings: taskForm(normal), runId: started.handle.runId })), "run_not_plan");
    assert.equal(code(await app.plan({ settings: taskForm(base), runId: "20200101T000000Z-00000000" })), "run_not_found");
    assert.equal(code(await app.plan({ settings: taskForm(base, { input: { kind: "task", taskPath: path.join(base, "absent.json") } }), runId: "latest" })), "invalid_task");
  });
});

describe("DR-28 (R-11 M-1)", () => {
  // The app layer passes plan and apply to the CLI, which compares the masked paths (contract
  // bed4d81; the CLI and the store implement it since the bundle merge d7f8381).
  test(
    "a task form with other secrets than the plan run shows and moves nothing: plan_secrets_differ",
    async () => {
      const secretName = `${FAKE_SECRET}.txt`;
      const { base, app, plan, digest } = await plannedRun({ [secretName]: "alpha\n" }, planSteps(secretName, "sorted/b.txt"));
      // The same task without the secret variable: the plan run's token for the name is not registered now.
      const task = JSON.parse(await readFile(path.join(base, "task.json"), "utf8")) as Record<string, unknown>;
      await writeFile(path.join(base, "other.json"), JSON.stringify({ ...task, privacy: { secretEnv: [] } }), "utf8");
      const other = taskForm(base, { input: { kind: "task", taskPath: path.join(base, "other.json") } });

      const view = await app.plan({ settings: other, runId: plan.runId });
      assert.equal(JSON.stringify(view).includes(FAKE_SECRET), false, "no plaintext of the plan run's secret");
      assert.equal(code(view), "plan_secrets_differ");

      const started = await app.applyPlan({ settings: other, planRunId: plan.runId, digest: digest.slice(0, 12), cancelFile: null, unsafeMoveConsent: null });
      assert.equal(started.ok ? null : started.error.code, "plan_secrets_differ");
      assert.equal(await exists(path.join(base, "work", secretName)), true, "nothing was moved");
    },
  );
});

describe("review", () => {
  /** A run on the built-in analyze workflow: verified, then awaiting the person's review (GT-D7). */
  async function awaitingReview(): Promise<{ base: string; app: ReturnType<typeof createCodarynApp>; runId: string }> {
    const base = await setupRun({}, { workflowRef: "analyze" }, [WRITE_NOTES, { text: "done" }]);
    const app = createCodarynApp(await appEnvironment(base));
    const started = await app.startRun(taskRequest(base));
    assert.ok(started.ok);
    const ended = await started.handle.done;
    assert.ok(ended.ok, JSON.stringify(ended));
    assert.deepEqual([ended.result.status, ended.result.reason], ["needs-input", "awaiting_review"]);
    return { base, app, runId: started.handle.runId };
  }

  test("stores the verdict with the note masked; a second review replaces it", async () => {
    const { base, app, runId } = await awaitingReview();
    const first = ok<ReviewOutput>(await app.review({ settings: taskForm(base), runId: "latest", decision: "accept", note: `checked ${FAKE_SECRET}` }));
    assert.deepEqual([first.kind, first.runId, first.verdict, first.replaced], ["review", runId, "accepted", false]);
    const stored = await readFile(path.join(runDir(base, runId), "review.json"), "utf8");
    assert.equal(stored.includes(FAKE_SECRET), false, "R-4 L-4: the note is stored masked");
    assert.equal(JSON.stringify(first).includes(FAKE_SECRET), false);

    const second = ok<ReviewOutput>(await app.review({ settings: taskForm(base), runId, decision: "reject", note: "" }));
    assert.deepEqual([second.verdict, second.replaced], ["rejected", true]);
  });

  test("a note starting with --, another decision, or a run not awaiting review writes nothing", async () => {
    const { base, app, runId } = await awaitingReview();
    const reviewFile = path.join(runDir(base, runId), "review.json");
    const bad = async (request: ReviewRequest): Promise<string | null> => code(await app.review(request));
    const dashed = await app.review({ settings: taskForm(base), runId, decision: "accept", note: "--reject" });
    assert.ok(!dashed.ok);
    assert.deepEqual([dashed.error.code, /cannot start with --/.test(dashed.error.message)], ["invalid_arguments", true], "the app layer's own message");
    assert.equal(await bad({ settings: taskForm(base), runId, decision: "maybe" as "accept", note: null }), "invalid_arguments");
    await assert.rejects(readFile(reviewFile, "utf8"), "nothing was written");

    const { base: planBase, app: planApp, plan } = await plannedRun();
    assert.equal(await planApp.review({ settings: taskForm(planBase), runId: plan.runId, decision: "accept", note: null }).then(code), "run_not_awaiting_review");
  });
});

describe("arguments", () => {
  test("plan and review take the task form and --json; an empty note is no note", () => {
    const settings = { input: { kind: "task" as const, taskPath: "T" }, configPath: null, varsFile: "V", profile: null, workflowRef: null };
    assert.deepEqual(planArguments({ settings, runId: "latest" }), ["plan", "--task", "T", "--vars-file", "V", "--run", "latest", "--json"]);
    const review = reviewArguments({ settings, runId: "R", decision: "reject", note: "" });
    assert.deepEqual(review.ok ? review.argv : null, ["review", "--task", "T", "--vars-file", "V", "--run", "R", "--reject", "--json"]);
    const noted = reviewArguments({ settings, runId: "R", decision: "accept", note: "fine" });
    assert.deepEqual(noted.ok ? noted.argv.slice(-4) : null, ["--accept", "--note", "fine", "--json"]);
  });
});
