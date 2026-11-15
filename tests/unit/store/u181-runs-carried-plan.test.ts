/**
 * U-181 (DR-69 B-3; RunListEntry.planRunId, contract U-175): a model run that carried out an approved
 * `run` plan names the plan run in its list entry (`run_started.planRunId`), so the run list's rule
 * (planApplyStateOf) reads that plan as carried out, not as `record_missing`. Every other model run's
 * entry is as before. A first record or result that names a plan badly makes the run damaged, as an
 * apply run's would. Fake values only.
 */

import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { planApplyStateOf } from "../../../src/contracts/index.js";
import type { ContentHash, EngineResult, JournalEvent, RunListEntry } from "../../../src/contracts/index.js";
import { createJournal, journalRelativePath, listRuns, markPlanApplied, writeResult } from "../../../src/store/index.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const PLAN = "20260101T030000Z-0000000c";
const CARRY = "20260101T040000Z-0000000d"; // carried out PLAN's run plan
const OTHER = "20260101T050000Z-0000000e"; // an ordinary model run
const DIGEST = "d".repeat(64) as ContentHash;
const AT = "2026-01-01T04:00:01.000Z";
const at = (runId: string): number => Date.UTC(2026, 0, 1, Number(runId.slice(9, 11)), 0, 1);
const STARTED = { type: "run_started", schemaVersion: 1, taskId: "t", workflow: "write", provider: "scripted", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 } };
const CARRIED = { planRunId: PLAN, planDigest: DIGEST, approval: "cli-flag" };
const usage = { modelTurns: 1, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 9 };

type Kind = "plan" | "carry" | "plain";

/** A model run: a plan run (plan_pending), a run carrying out a plan, or an ordinary run. */
async function modelRun(root: string, runId: string, kind: Kind, overrides: { started?: Record<string, unknown>; result?: Record<string, unknown>; noResult?: boolean } = {}): Promise<void> {
  const journal = createJournal({ workspaceRoot: root, runId, clock: { now: () => at(runId) } });
  await journal.append({ ...STARTED, ...(kind === "carry" ? CARRIED : {}), ...overrides.started } as unknown as JournalEvent);
  const [status, reason, exitCode] = kind === "plan" ? (["needs-input", "plan_pending", 3] as const) : (["done", "verified", 0] as const);
  if (overrides.noResult === true) {
    await journal.close();
    return;
  }
  await journal.append({ type: "run_finished", status, reason, usage });
  await journal.close();
  const result = {
    schemaVersion: 1, kind: "run", runId, taskId: "t", status, reason, exitCode, provider: "scripted", verifiers: [], changes: [],
    usage, journalPath: journalRelativePath(runId), notices: [],
    ...(kind === "plan" ? { plan: { digest: DIGEST, actions: 1, kind: "changes" } } : {}),
    ...(kind === "carry" ? { planRunId: PLAN, planDigest: DIGEST } : {}),
    ...overrides.result,
  } as unknown as EngineResult;
  await writeResult(root, result);
}

async function workspace(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-u181-runs-")));
  roots.push(root);
  return root;
}

const byId = async (root: string): Promise<Record<string, RunListEntry>> =>
  Object.fromEntries((await listRuns({ workspaceRoot: root })).runs.map((entry) => [entry.runId, entry]));
const checked = (entry: RunListEntry | undefined): Extract<RunListEntry, { state: "checked" }> => {
  assert.equal(entry?.state, "checked");
  return entry as Extract<RunListEntry, { state: "checked" }>;
};

describe("U-181 (B-3): a run that carried out a run plan names its plan run", () => {
  test("the carrying run's entry has planRunId; the plan run's apply reads as applied, not record_missing", async () => {
    const root = await workspace();
    await modelRun(root, PLAN, "plan");
    await modelRun(root, CARRY, "carry");
    await modelRun(root, OTHER, "plain");
    assert.equal(await markPlanApplied({ workspaceRoot: root, planRunId: PLAN, applyRunId: CARRY, at: AT }), "marked");
    const runs = await byId(root);
    const carry = checked(runs[CARRY]);
    assert.equal(carry.kind, "run");
    assert.equal(carry.planRunId, PLAN);
    assert.equal(carry.status, "done");
    const plan = checked(runs[PLAN]);
    assert.deepEqual(plan.appliedBy, { runId: CARRY, at: AT });
    assert.deepEqual(planApplyStateOf(plan, Object.values(runs)), { state: "applied", applyRunId: CARRY });
  });

  test("a carrying run without a result yet: the plan reads as being carried out (applying)", async () => {
    const root = await workspace();
    await modelRun(root, PLAN, "plan");
    await modelRun(root, CARRY, "carry", { noResult: true });
    assert.equal(await markPlanApplied({ workspaceRoot: root, planRunId: PLAN, applyRunId: CARRY, at: AT }), "marked");
    const runs = await byId(root);
    assert.equal(checked(runs[CARRY]).planRunId, PLAN);
    assert.deepEqual(planApplyStateOf(checked(runs[PLAN]), Object.values(runs)), { state: "applying", applyRunId: CARRY });
  });

  test("every other model run's entry has no planRunId, as before", async () => {
    const root = await workspace();
    await modelRun(root, PLAN, "plan");
    await modelRun(root, OTHER, "plain");
    const runs = await byId(root);
    assert.equal(Object.hasOwn(checked(runs[OTHER]), "planRunId"), false);
    assert.equal(Object.hasOwn(checked(runs[PLAN]), "planRunId"), false);
  });

  test("a plan named badly makes the run damaged, in its first record or its result", async () => {
    const cases: [string, { started?: Record<string, unknown>; result?: Record<string, unknown> }, Kind][] = [
      ["planRunId without the digest and approval", { started: { planDigest: undefined, approval: undefined } }, "carry"],
      ["the digest alone", { started: { planDigest: DIGEST } }, "plain"],
      ["its own run id", { started: { planRunId: CARRY }, result: { planRunId: CARRY } }, "carry"],
      ["a planRunId that is not a run id", { started: { planRunId: "plans/1" }, result: { planRunId: "plans/1" } }, "carry"],
      ["a digest that is not a SHA-256", { started: { planDigest: "D".repeat(64) }, result: { planDigest: "D".repeat(64) } }, "carry"],
      ["an unknown approval", { started: { approval: "email" } }, "carry"],
      ["a null planRunId", { started: { planRunId: null } }, "carry"],
      ["a result without the plan run", { result: { planRunId: undefined, planDigest: undefined } }, "carry"],
      ["a result naming another plan run", { result: { planRunId: OTHER } }, "carry"],
      ["a result with another digest", { result: { planDigest: "e".repeat(64) } }, "carry"],
      ["a plan in the result of a run that named none", { result: { planRunId: PLAN, planDigest: DIGEST } }, "plain"],
    ];
    for (const [name, overrides, kind] of cases) {
      const root = await workspace();
      await modelRun(root, PLAN, "plan");
      await modelRun(root, CARRY, kind, overrides);
      const runs = await byId(root);
      assert.equal(runs[CARRY]?.state, "damaged", name);
      assert.equal(runs[PLAN]?.state, "checked", name);
    }
  });
});
