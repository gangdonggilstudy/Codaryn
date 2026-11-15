/**
 * The apply run through the app layer (adapter-contract 5.6; DR-1, DR-2, DR-21, DR-25, R-9 I-4):
 * the CLI's `apply` as an adapter, events built in memory without start records, and the person's
 * consent only from the request, as the adapter's channel. The plan run is real (engine, store,
 * tools, scripted model); where an unsafe move would be needed (a volume without hard links), a
 * stand-in apply engine records what it was given. Nothing is sent.
 */

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import type { ApplyDeps, ApplyResult, RevertOutput } from "../../../src/contracts/index.js";
import { applyArguments, createCodarynApp, revertConsentOf } from "../../../src/app/index.js";
import type { AppCallOutcome, ApplyEvent, ApplyPlanRequest } from "../../../src/app/index.js";
import { WRITE_NOTES, appEnvironment, exists, plannedRun as planned, runDir, setupRun, taskForm, taskRequest } from "./support.js";

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}

function code<T>(outcome: AppCallOutcome<T> | { readonly ok: boolean; readonly error?: { readonly code: string } }): string | null {
  return outcome.ok ? null : ((outcome as { error: { code: string } }).error.code ?? null);
}

function request(base: string, planRunId: string, digest: string, consent: string | null = null): ApplyPlanRequest {
  return { settings: taskForm(base), planRunId, digest, cancelFile: null, unsafeMoveConsent: consent === null ? null : { digest: consent } };
}

async function journalLines(base: string, runId: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(path.join(runDir(base, runId), "journal.jsonl"), "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** A stand-in apply engine: records its deps; without a consent for this digest it stops as consent_required. */
function standIn(): { calls: ApplyDeps[]; applyPlan: (deps: ApplyDeps) => Promise<ApplyResult> } {
  const calls: ApplyDeps[] = [];
  const applyPlan = async (deps: ApplyDeps): Promise<ApplyResult> => {
    calls.push(deps);
    await deps.journal.append({
      type: "apply_started",
      schemaVersion: 1,
      planRunId: deps.planRunId,
      taskId: deps.taskId,
      digest: deps.digest,
      approval: deps.approval,
      actions: 1,
      maxDurationMs: deps.maxDurationMs,
      unsafeMoveConsent: deps.unsafeMoveConsent?.channel ?? null,
    });
    await deps.journal.append({ type: "plan_checked", problems: [], inventoryLimitReached: false, unsafeMoves: [0] });
    const consented = deps.unsafeMoveConsent?.digest === deps.digest;
    await deps.journal.close();
    return {
      schemaVersion: 1,
      kind: "apply",
      runId: deps.runId,
      planRunId: deps.planRunId,
      taskId: deps.taskId,
      digest: deps.digest,
      status: consented ? "done" : "needs-input",
      reason: consented ? "verified" : "consent_required",
      exitCode: consented ? 0 : 3,
      applied: [],
      verifiers: [],
      usage: { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 },
      journalPath: `.codaryn/runs/${deps.runId}/journal.jsonl`,
      notices: [],
    };
  };
  return { calls, applyPlan };
}

describe("applyPlan", () => {
  test("applies the approved plan as the adapter; the handle comes first; start records stay out of the events", async () => {
    const { base, app, plan, digest } = await planned();
    const events: ApplyEvent[] = [];
    const started = await app.applyPlan(request(base, plan.runId, digest.slice(0, 12)), { onEvent: (event) => events.push(event) });
    assert.ok(started?.ok, JSON.stringify(started));
    assert.equal(events.length, 0, "no event before the handle");
    const result = ok<ApplyResult>((await started.handle.done) as AppCallOutcome<ApplyResult>);
    assert.deepEqual([result.kind, result.runId, result.planRunId, result.digest], ["apply", started.handle.runId, plan.runId, digest]);
    assert.equal(await exists(path.join(base, "work", "sorted", "a.txt")), true, "the move was made");

    const stored = await journalLines(base, result.runId);
    const startedRecord = stored.find((line) => line["type"] === "apply_started");
    assert.deepEqual([startedRecord?.["approval"], startedRecord?.["unsafeMoveConsent"]], ["adapter", null]);
    assert.ok(stored.some((line) => line["type"] === "plan_item_started"), "the start record is stored (R-9 I-4)");

    const records = events.flatMap((event) => (event.kind === "record" ? [event.record] : []));
    assert.equal(records.some((record) => (record.type as string) === "plan_item_started"), false, "and not delivered");
    assert.deepEqual(
      records.map((record) => [record.seq, record.type]),
      stored.filter((line) => line["type"] !== "plan_item_started").map((line) => [line["seq"], line["type"]]),
      "every other stored record is delivered under its stored number",
    );
  });

  test("DR-21: the consent reaches the engine as the adapter's, for this plan's full digest only", async () => {
    const { base, plan, digest } = await planned();
    const engine = standIn();
    const app = createCodarynApp(await appEnvironment(base), { applyPlan: engine.applyPlan });

    const without = await app.applyPlan(request(base, plan.runId, digest.slice(0, 12)));
    assert.ok(without?.ok);
    const stopped = ok<ApplyResult>((await without.handle.done) as AppCallOutcome<ApplyResult>);
    assert.deepEqual([stopped.status, stopped.reason], ["needs-input", "consent_required"]);
    assert.deepEqual([engine.calls[0]?.approval, engine.calls[0]?.unsafeMoveConsent ?? null], ["adapter", null]);

    const withConsent = await app.applyPlan(request(base, plan.runId, digest.slice(0, 12), digest));
    assert.ok(withConsent?.ok);
    assert.equal(ok<ApplyResult>((await withConsent.handle.done) as AppCallOutcome<ApplyResult>).reason, "verified");
    assert.deepEqual(engine.calls[1]?.unsafeMoveConsent, { channel: "adapter", digest });
  });

  test("a consent for another plan, a short or wrong digest, or no plan run is refused before anything runs", async () => {
    const { base, plan, digest } = await planned();
    const engine = standIn();
    const app = createCodarynApp(await appEnvironment(base), { applyPlan: engine.applyPlan });
    const runsBefore = (await readdir(path.join(base, "work", ".codaryn", "runs"))).length;

    assert.equal(code(await app.applyPlan(request(base, plan.runId, digest.slice(0, 12), "b".repeat(64)))), "invalid_arguments");
    assert.equal(code(await app.applyPlan(request(base, plan.runId, digest.slice(0, 11), digest))), "invalid_arguments");
    const other = digest.startsWith("0") ? "1".repeat(12) : "0".repeat(12);
    assert.equal(code(await app.applyPlan(request(base, plan.runId, other))), "plan_not_approved");
    assert.equal(code(await app.applyPlan(request(base, "20200101T000000Z-00000000", digest.slice(0, 12)))), "run_not_found");
    assert.equal(engine.calls.length, 0, "the engine was never called");
    assert.equal((await readdir(path.join(base, "work", ".codaryn", "runs"))).length, runsBefore, "no apply run was made");
    assert.equal(await exists(path.join(base, "work", "a.txt")), true);
  });

  test("the arguments: the task form, the plan run, the digest, quiet; never a consent argument", () => {
    const settings = { input: { kind: "workspace" as const, workspace: "W" }, configPath: "C", varsFile: null, profile: "p", workflowRef: null };
    const argv = applyArguments({ settings, planRunId: "R", digest: "D", cancelFile: "F" });
    assert.deepEqual(argv, ["apply", "--workspace", "W", "--config", "C", "--profile", "p", "--run", "R", "--digest", "D", "--quiet", "--cancel-file", "F"]);
    const withWorkflow = applyArguments({ settings: { ...settings, profile: null, workflowRef: "organize" }, planRunId: "R", digest: "D", cancelFile: null });
    assert.deepEqual(withWorkflow.slice(0, 6), ["apply", "--workspace", "W", "--config", "C", "--workflow"], "R-14 L-3: the workflow travels as --workflow");
    assert.equal(argv.includes("--allow-unsafe-move"), false);
  });
});

describe("DR-25: the revert consent", () => {
  test("only for the run reverted, not with latest, another run or a dry run", () => {
    const consent = { runId: "R1" };
    assert.deepEqual(revertConsentOf({ runId: "R1", unsafeMoveConsent: consent }), { ok: true, consent: { channel: "adapter", runId: "R1" } });
    assert.deepEqual(revertConsentOf({ runId: "R1" }), { ok: true, consent: null });
    for (const bad of [
      { runId: "latest", unsafeMoveConsent: consent },
      { runId: "R2", unsafeMoveConsent: consent },
      { runId: "R1", dryRun: true, unsafeMoveConsent: consent },
      { runId: "R1", unsafeMoveConsent: { runId: "" } },
      { runId: "R1", unsafeMoveConsent: "yes" as unknown as { runId: string } },
    ]) {
      const outcome = revertConsentOf(bad);
      assert.equal(outcome.ok ? null : outcome.error.code, "invalid_arguments", JSON.stringify(bad));
    }
  });

  test("a revert with the person's consent records the adapter's channel; a refused one changes nothing", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const app = createCodarynApp(await appEnvironment(base));
    const started = await app.startRun(taskRequest(base));
    assert.ok(started.ok);
    assert.ok((await started.handle.done).ok);
    const runId = started.handle.runId;
    const workspace = path.join(base, "work");
    const notes = path.join(workspace, "NOTES.md");

    for (const bad of [
      { workspace, runId: "latest", unsafeMoveConsent: { runId } },
      { workspace, runId, dryRun: true, unsafeMoveConsent: { runId } },
      { workspace, runId, unsafeMoveConsent: { runId: "20200101T000000Z-00000000" } },
    ]) {
      assert.equal(code(await app.revert(bad)), "invalid_arguments", JSON.stringify(bad));
    }
    assert.equal(await exists(notes), true, "nothing was reverted");

    const done = ok<RevertOutput>(await app.revert({ workspace, runId, unsafeMoveConsent: { runId } }));
    assert.equal(done.status, "complete");
    assert.equal(await exists(notes), false);
    const record = JSON.parse(await readFile(path.join(runDir(base, runId), "revert.json"), "utf8")) as { unsafeMoveConsent?: unknown };
    assert.equal(record.unsafeMoveConsent, "adapter");
  });
});
