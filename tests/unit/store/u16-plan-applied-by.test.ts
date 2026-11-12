/**
 * U-16 (UXM-5, contract a9e8761): listRuns gives a plan run whose plan was applied the apply run and
 * when it claimed the plan (RunListEntry.appliedBy, from the plan run's PLAN_APPLIED_FILE_NAME), so
 * the list does not leave it as needing input. Absent for a plan not applied, an apply run, a model
 * run that is not a plan run, and an applied.json that cannot be read; such a record never makes
 * the run damaged. Fake values only.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { PLAN_APPLIED_FILE_NAME } from "../../../src/contracts/index.js";
import type { ContentHash, EngineResult, JournalEvent, RunId, RunListEntry } from "../../../src/contracts/index.js";
import { createJournal, journalRelativePath, listRuns, markPlanApplied, writeResult } from "../../../src/store/index.js";
import { createHumanOutput } from "../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const PLAN = "20260101T030000Z-0000000c";
const APPLY = "20260101T040000Z-0000000d";
const OTHER = "20260101T050000Z-0000000e"; // a model run that is not a plan run
const HASH = "a".repeat(64) as ContentHash;
const AT = "2026-01-01T04:00:01.000Z";
const at = (runId: string): number => Date.UTC(2026, 0, 1, Number(runId.slice(9, 11)), 0, 1);
const STARTED = { type: "run_started", schemaVersion: 1, taskId: "t", workflow: "organize", provider: "scripted", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 } } as unknown as JournalEvent;
const usage = { modelTurns: 1, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 9 };
const state = (root: string, ...parts: string[]) => join(root, ".codaryn", ...parts);

async function modelRun(root: string, runId: string, plan: boolean): Promise<void> {
  const journal = createJournal({ workspaceRoot: root, runId, clock: { now: () => at(runId) } });
  await journal.append(STARTED);
  const [status, reason, exitCode] = plan ? (["needs-input", "plan_pending", 3] as const) : (["done", "verified", 0] as const);
  await journal.append({ type: "run_finished", status, reason, usage });
  await journal.close();
  const result = {
    schemaVersion: 1, kind: "run", runId, taskId: "t", status, reason, exitCode, provider: "scripted", verifiers: [], changes: [],
    usage, journalPath: journalRelativePath(runId), notices: [], ...(plan ? { plan: { digest: HASH, actions: 1 } } : {}),
  } as unknown as EngineResult;
  await writeResult(root, result);
}

/** A plan run, an apply run that applied it (its journal only: listRuns reads its first record), and a model run. */
async function workspace(applied: boolean): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-u16-")));
  roots.push(root);
  await modelRun(root, PLAN, true);
  await modelRun(root, OTHER, false);
  const apply = createJournal({ workspaceRoot: root, runId: APPLY, clock: { now: () => at(APPLY) } });
  await apply.append({ type: "apply_started", schemaVersion: 1, planRunId: PLAN, taskId: "t", digest: HASH, approval: "cli-flag", actions: 1, maxDurationMs: 60_000 } as unknown as JournalEvent);
  await apply.close();
  if (applied) assert.equal(await markPlanApplied({ workspaceRoot: root, planRunId: PLAN, applyRunId: APPLY, at: AT }), "marked");
  return root;
}

const byId = async (root: string): Promise<Record<string, RunListEntry>> =>
  Object.fromEntries((await listRuns({ workspaceRoot: root })).runs.map((entry) => [entry.runId, entry]));
const appliedByOf = (entry: RunListEntry | undefined): unknown => (entry?.state === "checked" ? (entry.appliedBy ?? "absent") : `state ${entry?.state}`);

describe("U-16 (UXM-5): a plan run whose plan was applied names the apply run", () => {
  test("applied: appliedBy is the apply run and the time it claimed the plan; no other entry has it", async () => {
    const runs = await byId(await workspace(true));
    assert.deepEqual(appliedByOf(runs[PLAN]), { runId: APPLY, at: AT });
    assert.equal(appliedByOf(runs[APPLY]), "absent");
    assert.equal(appliedByOf(runs[OTHER]), "absent");
  });

  test("not applied: absent, and the entry is as before", async () => {
    const runs = await byId(await workspace(false));
    assert.equal(appliedByOf(runs[PLAN]), "absent");
    assert.equal(runs[PLAN]?.state === "checked" ? runs[PLAN].reason : null, "plan_pending");
  });

  test("an applied.json that cannot be read gives no appliedBy and does not make the plan run damaged", async () => {
    const cases: [string, (file: string) => Promise<void>][] = [
      ["not JSON", (file) => writeFile(file, "{", "utf8")],
      ["another plan run", (file) => writeFile(file, JSON.stringify({ schemaVersion: 1, kind: "plan_applied", planRunId: OTHER, applyRunId: APPLY, at: AT }), "utf8")],
      ["not a run id", (file) => writeFile(file, JSON.stringify({ schemaVersion: 1, kind: "plan_applied", planRunId: PLAN, applyRunId: "../x", at: AT }), "utf8")],
      ["not a time", (file) => writeFile(file, JSON.stringify({ schemaVersion: 1, kind: "plan_applied", planRunId: PLAN, applyRunId: APPLY, at: "soon" }), "utf8")],
      ["a field more", (file) => writeFile(file, JSON.stringify({ schemaVersion: 1, kind: "plan_applied", planRunId: PLAN, applyRunId: APPLY, at: AT, extra: 1 }), "utf8")],
      ["a directory", (file) => mkdir(file)],
    ];
    for (const [name, make] of cases) {
      const root = await workspace(false);
      await make(state(root, "runs", PLAN, PLAN_APPLIED_FILE_NAME));
      const runs = await byId(root);
      assert.equal(appliedByOf(runs[PLAN]), "absent", name);
    }
  });

  test("an applied.json in a run that is not a plan run is not read", async () => {
    const root = await workspace(false);
    await writeFile(state(root, "runs", OTHER, PLAN_APPLIED_FILE_NAME), JSON.stringify({ schemaVersion: 1, kind: "plan_applied", planRunId: OTHER, applyRunId: APPLY, at: AT }), "utf8");
    assert.equal(appliedByOf((await byId(root))[OTHER]), "absent");
  });
});

describe("R-55 M-1: what the run list's row of the plan run says, by how its apply run ended", () => {
  const en = createMessageCatalog("en");
  const rowOf = async (root: string, runId: string): Promise<string> => {
    const text = createHumanOutput(en).runsText({ schemaVersion: 1, kind: "runs", ...(await listRuns({ workspaceRoot: root })) } as never);
    return text.split(String.fromCharCode(10)).find((row) => row.startsWith(runId)) ?? "";
  };
  const applyResult = (status: string, reason: string, exitCode: number) => ({
    schemaVersion: 1, kind: "apply", runId: APPLY, planRunId: PLAN, taskId: "t", digest: HASH, status, reason, exitCode,
    applied: [{ index: 0, action: { kind: "move", from: "a.txt", to: "b/a.txt", sha256: HASH }, stored: null }], verifiers: [],
    usage: { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 5 }, journalPath: journalRelativePath(APPLY), notices: [],
  });
  const applied = en.format("runs.plan_applied", { runId: APPLY as RunId });

  test("the apply run is still going (its journal only): the plan row does not say applied", async () => {
    const root = await workspace(true);
    assert.equal((await rowOf(root, PLAN)).includes(applied), false, await rowOf(root, PLAN));
  });

  test("the apply failed part way (failed/apply_incomplete): the plan row does not say applied", async () => {
    const root = await workspace(true);
    await writeFile(state(root, "runs", APPLY, "result.json"), `${JSON.stringify(applyResult("failed", "apply_incomplete", 1))}\n`, "utf8");
    assert.ok((await rowOf(root, APPLY)).includes("apply_incomplete"), await rowOf(root, APPLY));
    assert.equal((await rowOf(root, PLAN)).includes(applied), false, await rowOf(root, PLAN));
  });

  test("the apply ended done: the plan row says applied, with the apply run", async () => {
    const root = await workspace(true);
    await writeFile(state(root, "runs", APPLY, "result.json"), `${JSON.stringify(applyResult("done", "verified", 0))}\n`, "utf8");
    assert.ok((await rowOf(root, PLAN)).includes(applied), await rowOf(root, PLAN));
  });
});
