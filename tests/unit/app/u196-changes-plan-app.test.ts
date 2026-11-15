/**
 * Unit U-196 (DR-69 B-3, B-4, the app layer's part before the CLI's apply chooses by kind, which is
 * na-core's U-195; PM: (a), AC-D16): a `run` plan (plan.json `kind: "changes"`, the store's
 * loadAnyPlan) reaches the GUI through the app.
 * - plan(): a run plan's view (ChangesPlanOutput, nc-human's changesPlanOutput from U-191): the
 *   planned files masked again with the secrets registered now (DR-28: a path that masks otherwise
 *   now is plan_secrets_differ), the summary, the digest, pending or applied (applied.json), the
 *   records-changed mark. A plan of mode apply keeps the CLI's own view.
 * - checkApply on a run plan: the apply task must resolve to plan "run" (a refusal that says so
 *   otherwise; no setting can yet, U-177). What it looks at then (checkChangesPlanFiles): each
 *   planned file judged by the gate the run will have (the task's policy and writable lists, and
 *   the plan's files as one more list) as the engine judges it before its first model request,
 *   without taking the lock. Whether a file still fits the plan (staleness) the engine checks.
 * Reproduced first (86d2adc, todo until the app gave them). Temporary folders, fake values only.
 */

import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import * as appModule from "../../../src/app/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, CodarynApp } from "../../../src/app/index.js";
import { maskedParts } from "../../../src/contracts/index.js";
import type { ContentHash, PolicyConfig, StoredPlannedFile, WritablePathSet } from "../../../src/contracts/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { createPlanRecorder, markPlanApplied } from "../../../src/store/index.js";
import { FAKE_SECRET, PLAN_TASK, appEnvironment, setupRun, taskForm } from "./support.js";

const PLAN_RUN = "20261101T120000Z-0a1b2c3d";
const CARRY_RUN = "20261101T130000Z-11111111";
const HASH = "a".repeat(64) as ContentHash;

type View = {
  readonly kind: string;
  readonly planKind?: string;
  readonly runId: string;
  readonly status: string;
  readonly digest: string;
  readonly files: readonly { readonly path: string; readonly change: string; readonly sha256: string | null }[];
  readonly summary: string;
  readonly appliedBy: { readonly runId: string } | null;
  readonly recordsChanged?: true;
};
const failure = (outcome: AppCallOutcome<unknown>): { code: string; message: string } => {
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  return (outcome as { error: { code: string; message: string } }).error;
};

/** A run plan stored in the workspace of `base` as the store writes it, with its plan run's result; `maskWith` masks the paths' shown parts as the plan run did. */
async function storeRunPlan(base: string, files: readonly { path: string; change: "create" | "modify" }[], summary: string, maskWith: readonly string[] = []): Promise<string> {
  const work = path.join(base, "work");
  const privacy = createPrivacyGateway({ secrets: maskWith });
  const mask = (text: string): string => {
    const masked = privacy.mask(text);
    assert.ok(masked.ok);
    return masked.text;
  };
  const planned: StoredPlannedFile[] = files.map((file) =>
    file.change === "create" ? { path: file.path, change: "create", sha256: null, shown: maskedParts(mask(file.path)) } : { path: file.path, change: "modify", sha256: HASH, shown: maskedParts(mask(file.path)) },
  );
  const digest = await createPlanRecorder({ workspaceRoot: work, runId: PLAN_RUN }).saveChangesPlan!({ summary: maskedParts(mask(summary)), files: planned });
  const dir = path.join(work, ".codaryn", "runs", PLAN_RUN);
  await mkdir(dir, { recursive: true });
  const started = { seq: 1, at: "2026-11-01T12:00:01.000Z", runId: PLAN_RUN, type: "run_started", schemaVersion: 1, taskId: "app-task", workflow: "write", provider: "scripted", limits: { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: null, maxDurationMs: 1000 } };
  // A finished run's records, so `latest` names it as the store judges runs.
  const finished = { seq: 2, at: "2026-11-01T12:00:02.000Z", runId: PLAN_RUN, type: "run_finished", status: "needs-input", reason: "plan_pending", usage: { modelTurns: 1, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 1, repairAttempts: 0 } };
  await writeFile(path.join(dir, "journal.jsonl"), `${JSON.stringify(started)}\n${JSON.stringify(finished)}\n`);
  const result = {
    schemaVersion: 1, kind: "run", runId: PLAN_RUN, taskId: "app-task", status: "needs-input", reason: "plan_pending", exitCode: 3, provider: "scripted", verifiers: [], changes: [],
    usage: { modelTurns: 1, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 1 }, journalPath: `.codaryn/runs/${PLAN_RUN}/journal.jsonl`, notices: [],
    plan: { digest, actions: files.length, kind: "changes" },
  };
  await writeFile(path.join(dir, "result.json"), `${JSON.stringify(result)}\n`);
  return digest;
}

const FILES = [
  { path: "docs/guide.md", change: "modify" },
  { path: "docs/CHANGELOG.md", change: "create" },
] as const;

async function withRunPlan(files: readonly { path: string; change: "create" | "modify" }[] = FILES, maskWith: readonly string[] = []): Promise<{ base: string; app: CodarynApp; digest: string }> {
  const base = await setupRun({}, {}, []);
  const digest = await storeRunPlan(base, files, "Tidy the guide.", maskWith);
  return { base, app: createCodarynApp(await appEnvironment(base)), digest };
}

describe("U-196: plan() shows a run plan", () => {
  test("its files, summary, digest and pending status, as the plan run stored them", async () => {
    const { base, app, digest } = await withRunPlan();
    const outcome = await app.plan({ settings: taskForm(base), runId: PLAN_RUN });
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    const view = (outcome as unknown as { output: View }).output;
    assert.deepEqual(
      { kind: view.kind, planKind: view.planKind, runId: view.runId, status: view.status, digest: view.digest, summary: view.summary, appliedBy: view.appliedBy },
      { kind: "plan", planKind: "changes", runId: PLAN_RUN, status: "pending", digest, summary: "Tidy the guide.", appliedBy: null },
    );
    assert.deepEqual(view.files, [
      { path: "docs/guide.md", change: "modify", sha256: HASH },
      { path: "docs/CHANGELOG.md", change: "create", sha256: null },
    ]);
    const latest = await app.plan({ settings: taskForm(base), runId: "latest" });
    assert.equal((latest as unknown as { output: View }).output.runId, PLAN_RUN, "latest names it as for any plan");
  });

  test("applied once applied.json names the run that carried it out", async () => {
    const { base, app } = await withRunPlan();
    await markPlanApplied({ workspaceRoot: path.join(base, "work"), planRunId: PLAN_RUN, applyRunId: CARRY_RUN, at: "2026-11-01T13:00:05.000Z" });
    const view = (await app.plan({ settings: taskForm(base), runId: PLAN_RUN })) as unknown as { ok: boolean; output: View };
    assert.deepEqual([view.output.status, view.output.appliedBy?.runId], ["applied", CARRY_RUN]);
  });

  test("a path that masks otherwise with the secrets registered now: plan_secrets_differ (DR-28), no path shown", async () => {
    const { base, app } = await withRunPlan([{ path: `notes/${FAKE_SECRET}.md`, change: "create" }]);
    const error = failure(await app.plan({ settings: taskForm(base), runId: PLAN_RUN }));
    assert.equal(error.code, "plan_secrets_differ");
    assert.equal(JSON.stringify(error).includes(FAKE_SECRET), false);
  });

  test("the same secrets as the plan run: the path is shown masked", async () => {
    const { base, app } = await withRunPlan([{ path: `notes/${FAKE_SECRET}.md`, change: "create" }], [FAKE_SECRET]);
    const view = (await app.plan({ settings: taskForm(base), runId: PLAN_RUN })) as unknown as { ok: boolean; output: View };
    assert.equal(view.ok, true, JSON.stringify(view));
    assert.equal(JSON.stringify(view.output).includes(FAKE_SECRET), false);
    assert.equal(view.output.files.length, 1);
  });

  test("a records-changed mark on the plan run is shown", async () => {
    const { base, app } = await withRunPlan();
    await writeFile(path.join(base, "work", ".codaryn", "runs", PLAN_RUN, "records-changed.json"), "{}");
    const view = (await app.plan({ settings: taskForm(base), runId: PLAN_RUN })) as unknown as { ok: boolean; output: View };
    assert.equal(view.output.recordsChanged, true);
  });
});

describe("U-196: checkApply and a run plan", () => {
  test("an apply task that does not resolve to plan \"run\" is refused, saying so; nothing is checked", async () => {
    const base = await setupRun({}, PLAN_TASK, []);
    const digest = await storeRunPlan(base, FILES, "Tidy the guide.");
    const app = createCodarynApp(await appEnvironment(base));
    const error = failure(await app.checkApply({ settings: taskForm(base), planRunId: PLAN_RUN, digest }));
    assert.equal(error.code, "run_not_plan");
    assert.match(error.message, /plan "run"/);
  });

  test("checkChangesPlanFiles: each planned file judged by the run's gate (policy, writable lists and the plan's files)", async () => {
    const check = (appModule as unknown as Record<string, unknown>)["checkChangesPlanFiles"] as
      | ((source: { readonly workspaceRoot: string; readonly policy: PolicyConfig; readonly writablePathSets?: readonly WritablePathSet[] }, files: readonly { readonly path: string }[]) => Promise<readonly { index: number; problem: string }[]>)
      | undefined;
    assert.equal(typeof check, "function", "the app layer gives checkChangesPlanFiles");
    const base = await setupRun({ "docs/guide.md": "g\n" }, {}, []);
    const work = path.join(base, "work");
    const policy = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, protectedPaths: ["docs/private"] } as PolicyConfig;
    const files = [{ path: "docs/guide.md" }, { path: "docs/private/x.md" }, { path: "out/new.md" }, { path: "docs/new.md" }];
    // No list: only the protected path is denied.
    assert.deepEqual(await check!({ workspaceRoot: work, policy }, files), [{ index: 1, problem: "denied" }]);
    // The config's list allows docs only: out/new.md is denied too.
    assert.deepEqual(await check!({ workspaceRoot: work, policy, writablePathSets: [{ source: "config", entries: ["docs"] }] }, files), [
      { index: 1, problem: "denied" },
      { index: 2, problem: "denied" },
    ]);
    // By the real path too: a junction to the protected folder is allowed by its letters, denied by where it leads.
    await mkdir(path.join(work, "docs", "private"), { recursive: true });
    await symlink(path.join(work, "docs", "private"), path.join(work, "alias"), "junction");
    assert.deepEqual(await check!({ workspaceRoot: work, policy }, [{ path: "alias/x.md" }, { path: "docs/guide.md" }]), [{ index: 0, problem: "denied" }]);
  });
});
