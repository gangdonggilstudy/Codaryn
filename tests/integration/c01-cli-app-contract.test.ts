/**
 * U-112 (docs/design/standalone-gui.md 8.3 and 12, the GUI design gap survey 4 and 8, design gap
 * survey C-32): the contract layer test. One scripted case is run twice, from two sandboxes with the
 * same task file, script, workspace files and environment:
 * - (a) the CLI process: `codaryn run --task <task> --json` (and `apply --task --run --digest`);
 * - (b) the app layer's startRun (and applyPlan), the path the GUI engine host takes: the app made
 *   by `createCodarynApp(createNodeAppEnvironment())`, as gui/src/engine-host/main.ts makes it, with
 *   the CLI's environment and working directory.
 * The EngineResult (ApplyResult) and the stored records (journal.jsonl: kinds, order and every
 * masked field) must be the same. Only values that differ between any two runs are normalized (see
 * `normalized`): run ids and a plan's digest (plan.json names its run; the two plan.json files are
 * compared first, the run id aside), privacy tokens (random per run, contracts/text.ts; named by
 * first appearance), times, durations and the sandbox folder. An apply's `approval` names its
 * channel by design (contracts/plan.ts APPROVAL_CHANNELS: `cli-flag` for `--digest`, `adapter` for
 * an adapter's apply); each side is checked for its own value, then it is left out.
 *
 * Cases: a document run (with a registered secret read and masked), a run with refusals, a run with
 * a repair, a plan run and its apply, a run that ends with a model error. A difference found here is
 * not fixed in this unit: the case is marked todo with what differs (PM).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { createCodarynApp, createNodeAppEnvironment } from "../../src/app/index.js";
import type { CodarynApp, TaskForm } from "../../src/app/index.js";
import { PLAN_FILE_NAME, PRIVACY_TOKEN_PATTERN_SOURCE } from "../../src/contracts/index.js";
import type { ApplyJournalRecord, ApplyResult, CommandVerifierConfig, EngineResult, JournalRecord, ScriptStep } from "../../src/contracts/index.js";
import { createSandbox, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { organizeScript, writeOrganizeTask, writeOrganizeWorkspace } from "../fixtures/general-tasks.js";
import { EDIT_RIGHT_FIX, EDIT_WRONG_FIX, PRICE_CHECK_PATH, PRICE_PATH, writeRepairProject } from "../fixtures/repair-project.js";
import { FAKE_SECRET_A, FAKE_SECRET_ENV_A } from "../fixtures/secrets.js";
import { NODE, cliEnv, expectRunResult, readRunFiles, runDirOf, runTask, sha256Hex, startCli } from "../support/cli.js";
import { applyArgs, expectApplyResult, planDigestOf, readApplyJournal, shortDigest } from "../support/general.js";
import { attemptSteps, spareSteps } from "../support/repair-script.js";
import type { Attempt } from "../support/repair-script.js";

const TIMEOUT_MS = 120_000;

interface Side {
  readonly sb: Sandbox;
  readonly task: string;
}

interface RunSide {
  readonly result: EngineResult;
  readonly records: readonly JournalRecord[];
}

/** Two sandboxes prepared the same way: one for the CLI, one for the app layer. */
function pairOf(t: TestContext, prepare: (sb: Sandbox) => string): { readonly cli: Side; readonly app: Side } {
  const cliSandbox = createSandbox(t);
  const appSandbox = createSandbox(t);
  return { cli: { sb: cliSandbox, task: prepare(cliSandbox) }, app: { sb: appSandbox, task: prepare(appSandbox) } };
}

/** The app as the GUI engine host makes it, with the CLI's environment and working directory. */
async function appFor(sb: Sandbox, env: NodeJS.ProcessEnv): Promise<CodarynApp> {
  return createCodarynApp({ ...(await createNodeAppEnvironment()), env, cwd: sb.base, homeDir: null });
}

function taskFormOf(task: string): TaskForm {
  return { input: { kind: "task", taskPath: task }, configPath: null, varsFile: null, profile: null, workflowRef: null };
}

async function viaCli(side: Side, env: NodeJS.ProcessEnv): Promise<RunSide> {
  const run = await runTask(side.task, { cwd: side.sb.base, env, timeoutMs: TIMEOUT_MS });
  const result = expectRunResult(run);
  return { result, records: readRunFiles(side.sb.workspace, result).records };
}

async function viaApp(side: Side, env: NodeJS.ProcessEnv): Promise<RunSide & { readonly app: CodarynApp }> {
  const app = await appFor(side.sb, env);
  const started = await app.startRun({ input: { kind: "task", taskPath: side.task }, configPath: null, varsFile: null, profile: null, workflowRef: null, cancelFile: null });
  assert.ok(started.ok, `the app layer did not start the run: ${JSON.stringify(started)}`);
  const done = await started.handle.done;
  assert.ok(done.ok, `the app layer's run ended with an error: ${JSON.stringify(done)}`);
  assert.equal(done.result.runId, started.handle.runId);
  return { app, result: done.result, records: readRunFiles(side.sb.workspace, done.result).records };
}

/** An ISO 8601 UTC time anywhere, also inside a tool result's JSON text (a file's `modifiedAt`). */
const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
const PRIVACY_TOKEN = new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE, "g");

/**
 * `value` with the values that differ between any two runs replaced, and nothing else:
 * - the run ids (and a plan's digest, which covers plan.json and so its run id), each by its role;
 * - the privacy tokens, "random per run and never derived from the secret value"
 *   (contracts/text.ts): each distinct token by the order it first appears, so the same token must
 *   stand in the same places on both sides;
 * - the sandbox folder, times (record `at`, file times in tool results) and durations.
 */
function normalized(value: unknown, sb: Sandbox, ids: Readonly<Record<string, string>>, leaveOut: readonly string[] = []): unknown {
  let text = JSON.stringify(value);
  for (const [role, id] of Object.entries(ids)) text = text.split(id).join(`<${role}>`);
  text = text.replace(ISO_TIME, "<TIME>");
  const tokens = new Map<string, string>();
  text = text.replace(PRIVACY_TOKEN, (token) => {
    const known = tokens.get(token);
    if (known !== undefined) return known;
    const named = `<TOKEN${tokens.size + 1}>`;
    tokens.set(token, named);
    return named;
  });
  for (const form of [sb.base, sb.base.split("\\").join("/")]) text = text.split(JSON.stringify(form).slice(1, -1)).join("<BASE>");
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node !== "object" || node === null) return node;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(node)) {
      if (leaveOut.includes(key)) continue;
      if (key === "at") out[key] = "<AT>";
      else if (key === "durationMs" && typeof inner === "number") out[key] = "<MS>";
      else out[key] = walk(inner);
    }
    return out;
  };
  return walk(JSON.parse(text) as unknown);
}

/** A run's ids by role: its own id and, for a plan run, its plan's digest. */
function idsOf(result: EngineResult): Record<string, string> {
  return { RUN: result.runId, ...(result.plan?.digest === undefined ? {} : { DIGEST: result.plan.digest }) };
}

/** The same result and the same records, kinds and order first (the clearest message), then every field. */
function assertSameRun(cli: RunSide, cliSb: Sandbox, app: RunSide, appSb: Sandbox): void {
  assert.deepEqual(
    app.records.map((record) => record.type),
    cli.records.map((record) => record.type),
    "the app layer's run records the same kinds of events in the same order as the CLI's",
  );
  assert.deepEqual(normalized(app.result, appSb, idsOf(app.result)), normalized(cli.result, cliSb, idsOf(cli.result)), "the same EngineResult");
  assert.deepEqual(normalized(app.records, appSb, idsOf(app.result)), normalized(cli.records, cliSb, idsOf(cli.result)), "the same records, field by field");
}

function countOf(records: readonly { readonly type: string }[], type: string): number {
  return records.filter((record) => record.type === type).length;
}

// ---------------------------------------------------------------------------------------------

test("U-112 문서 실행: 등록한 비밀을 읽고 가린 실행이 CLI와 앱 계층에서 같다", { timeout: TIMEOUT_MS * 2 }, async (t) => {
  const env = cliEnv({ extra: { [FAKE_SECRET_ENV_A]: FAKE_SECRET_A } });
  const steps: ScriptStep[] = [
    { toolCalls: [{ id: "r1", name: "read_file", args: { path: "README.md" } }] },
    { toolCalls: [{ id: "w1", name: "write_file", args: { path: "NOTE.md", expectedHash: null, change: { kind: "replace_all", content: "# Note\n\nThe readme was read.\n" } } }] },
    { text: "wrote NOTE.md" },
  ];
  const { cli, app } = pairOf(t, (sb) => {
    writeWorkspaceFile(sb, "README.md", `# Readme\n\ntoken: ${FAKE_SECRET_A}\n`);
    return writeTask(
      sb,
      { id: "u112-document", workflow: "document", secretEnv: [FAKE_SECRET_ENV_A], verifiers: [{ id: "note", kind: "file_rules", rules: [{ type: "contains", path: "NOTE.md", text: "# Note" }] }] },
      steps,
    );
  });
  const viaCliRun = await viaCli(cli, env);
  const viaAppRun = await viaApp(app, env);

  assert.deepEqual([viaCliRun.result.status, viaCliRun.result.reason], ["done", "verified"]);
  for (const side of [viaCliRun, viaAppRun]) {
    const text = JSON.stringify(side.records);
    assert.equal(text.includes(FAKE_SECRET_A), false, "the registered value is never recorded");
    assert.match(text, /\[\[CODARYN_SECRET:[0-9a-f]+\]\]/, "the read is recorded with the value masked");
  }
  assertSameRun(viaCliRun, cli.sb, viaAppRun, app.sb);
});

test("U-112 거부가 있는 실행: 허용되지 않은 명령, 작업 공간 밖 쓰기, 보호 경로 쓰기가 같다", { timeout: TIMEOUT_MS * 2 }, async (t) => {
  const env = cliEnv();
  const steps: ScriptStep[] = [
    { toolCalls: [{ id: "c1", name: "run_command", args: { executable: "node", args: ["--version"] } }] },
    { toolCalls: [{ id: "w1", name: "write_file", args: { path: "../outside.txt", expectedHash: null, change: { kind: "replace_all", content: "x\n" } } }] },
    { toolCalls: [{ id: "w2", name: "write_file", args: { path: "keep/locked.txt", expectedHash: null, change: { kind: "replace_all", content: "x\n" } } }] },
    { text: "could not do it" },
  ];
  const { cli, app } = pairOf(t, (sb) => {
    writeWorkspaceFile(sb, "keep/readme.txt", "kept\n");
    return writeTask(sb, { id: "u112-refusals", workflow: "code", protectedPaths: ["keep"] }, steps);
  });
  const viaCliRun = await viaCli(cli, env);
  const viaAppRun = await viaApp(app, env);

  assert.deepEqual([viaCliRun.result.status, viaCliRun.result.reason], ["needs-input", "no_verifier"]);
  const refusedCalls = viaCliRun.records.filter((record) => (record.type === "tool_decision" && !record.allowed) || (record.type === "tool_result" && !record.result.ok));
  assert.ok(refusedCalls.length >= 3, `three calls are refused (got ${refusedCalls.length})`);
  assert.equal(viaCliRun.result.changes.length, 0, "nothing was written");
  assertSameRun(viaCliRun, cli.sb, viaAppRun, app.sb);
});

test("U-112 재수정이 있는 실행: 검증 실패, 재수정, 통과가 같다", { timeout: TIMEOUT_MS * 2 }, async (t) => {
  const env = cliEnv();
  const check: CommandVerifierConfig = { id: "check", kind: "command", executable: NODE, args: [PRICE_CHECK_PATH], timeoutMs: 30_000 };
  const attempts: Attempt[] = [
    { reads: [PRICE_PATH], edits: [EDIT_WRONG_FIX], claim: "fixed the quantity" },
    { edits: [EDIT_RIGHT_FIX], claim: "fixed the discount too" },
  ];
  const { cli, app } = pairOf(t, (sb) => {
    writeRepairProject(sb);
    return writeTask(sb, { id: "u112-repair", workflow: "code", limits: { maxRepairAttempts: 2 }, verifiers: [check] }, [...attemptSteps(attempts), ...spareSteps(2)]);
  });
  const viaCliRun = await viaCli(cli, env);
  const viaAppRun = await viaApp(app, env);

  assert.deepEqual([viaCliRun.result.status, viaCliRun.result.reason], ["done", "verified"]);
  assert.equal(viaCliRun.result.usage.repairAttempts, 1);
  assert.equal(countOf(viaCliRun.records, "repair_started"), 1);
  assertSameRun(viaCliRun, cli.sb, viaAppRun, app.sb);
});

test("U-112 계획 실행 → apply: 계획 실행과 그 적용이 같다(승인 통로 이름만 다르다)", { timeout: TIMEOUT_MS * 3 }, async (t) => {
  const env = cliEnv();
  const { cli, app } = pairOf(t, (sb) => {
    writeOrganizeWorkspace(sb);
    return writeOrganizeTask(sb, "u112-organize", organizeScript());
  });
  const viaCliRun = await viaCli(cli, env);
  const viaAppRun = await viaApp(app, env);
  const cliDigest = planDigestOf(viaCliRun.result);
  const appDigest = planDigestOf(viaAppRun.result);
  // The digest is the SHA-256 of plan.json, which names its own run (contracts/plan.ts StoredPlan),
  // so it differs between any two runs. The two plan.json files must be the same bytes but for that id.
  const planText = (side: Side, runId: string): string => readFileSync(join(runDirOf(side.sb.workspace, runId), PLAN_FILE_NAME), "utf8").split(runId).join("<RUN>");
  assert.equal(planText(app, viaAppRun.result.runId), planText(cli, viaCliRun.result.runId), "the same plan.json but for its run id");
  assert.equal(sha256Hex(readFileSync(join(runDirOf(cli.sb.workspace, viaCliRun.result.runId), PLAN_FILE_NAME))), cliDigest, "the digest is plan.json's SHA-256");
  assertSameRun(viaCliRun, cli.sb, viaAppRun, app.sb);

  // (a) the CLI's apply with the digest's first characters.
  const applied = await startCli(applyArgs(cli.task, viaCliRun.result.runId, shortDigest(cliDigest)), { cwd: cli.sb.base, env, timeoutMs: TIMEOUT_MS }).done;
  const cliApply: ApplyResult = expectApplyResult(applied, viaCliRun.result.runId);
  const cliApplyRecords: readonly ApplyJournalRecord[] = readApplyJournal(cli.sb.workspace, cliApply.runId);
  // (b) the app layer's applyPlan, as the GUI's main process asks for it after the person's approval.
  const started = await viaAppRun.app.applyPlan({ settings: taskFormOf(app.task), planRunId: viaAppRun.result.runId, digest: shortDigest(appDigest), cancelFile: null, unsafeMoveConsent: null });
  assert.ok(started.ok, `the app layer did not start the apply: ${JSON.stringify(started)}`);
  const done = await started.handle.done;
  assert.ok(done.ok, `the app layer's apply ended with an error: ${JSON.stringify(done)}`);
  const appApply = done.output;
  const appApplyRecords: readonly ApplyJournalRecord[] = readApplyJournal(app.sb.workspace, appApply.runId);

  assert.equal(cliApply.status, "done", JSON.stringify(cliApply));
  // The approval channel is recorded in apply_started: the CLI's --digest and an adapter's apply.
  const approvalOf = (records: readonly ApplyJournalRecord[]): unknown => {
    const first = records.find((record) => record.type === "apply_started");
    return first === undefined ? undefined : (first as { readonly approval?: unknown }).approval;
  };
  assert.equal(approvalOf(cliApplyRecords), "cli-flag", "the CLI's --digest is its own channel");
  assert.equal(approvalOf(appApplyRecords), "adapter", "the app layer's apply is an adapter's");
  assert.deepEqual(
    appApplyRecords.map((record) => record.type),
    cliApplyRecords.map((record) => record.type),
    "the apply records the same kinds of events in the same order",
  );
  const cliIds = { PLAN: viaCliRun.result.runId, APPLY: cliApply.runId, DIGEST: cliDigest };
  const appIds = { PLAN: viaAppRun.result.runId, APPLY: appApply.runId, DIGEST: appDigest };
  assert.deepEqual(normalized(appApply, app.sb, appIds), normalized(cliApply, cli.sb, cliIds), "the same ApplyResult");
  assert.deepEqual(normalized(appApplyRecords, app.sb, appIds, ["approval"]), normalized(cliApplyRecords, cli.sb, cliIds, ["approval"]), "the same apply records (approval aside)");
});

test("U-112 모델 오류로 끝난 실행: 대본이 다한 실행의 결과와 기록이 같다", { timeout: TIMEOUT_MS * 2 }, async (t) => {
  const env = cliEnv();
  const steps: ScriptStep[] = [{ toolCalls: [{ id: "r1", name: "read_file", args: { path: "README.md" } }] }];
  const { cli, app } = pairOf(t, (sb) => {
    writeWorkspaceFile(sb, "README.md", "# Readme\n");
    return writeTask(sb, { id: "u112-model-error", workflow: "document" }, steps);
  });
  const viaCliRun = await viaCli(cli, env);
  const viaAppRun = await viaApp(app, env);

  assert.deepEqual([viaCliRun.result.status, viaCliRun.result.reason], ["failed", "model_error"]);
  assert.equal(viaCliRun.result.modelError?.kind, "script_exhausted");
  assert.equal(countOf(viaCliRun.records, "model_error"), 1);
  assertSameRun(viaCliRun, cli.sb, viaAppRun, app.sb);
});
