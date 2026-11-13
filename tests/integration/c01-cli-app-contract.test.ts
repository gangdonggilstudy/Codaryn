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
 *
 * U-295 (before the CLI migration's step C-6a moves a run's life into the app layer): three more,
 * on the paths that step takes over and no case compared. A cancel file there before the run (the
 * cancel source sees it as it is made); a permission question with no way to ask (the CLI is not at
 * a terminal, the app has no observer: both record deny by default), through the local fake API; and
 * a refusal of a lock another run holds (the CLI's error JSON and the app's StartOutcome).
 *
 * U-302 (before C-6b moves the run that carries out an approved plan into the app layer): a run plan
 * (a task type with plan "run") carried out by the CLI's `apply --digest` and by the app layer's
 * applyPlan, from plan runs made the same way. The carrying run done; a plan made stale by a person's
 * edit; a lock a live process holds; a write outside the approved files refused and counted; a cancel
 * file there before the apply. The result, the records and whether the plan was claimed must match.
 *
 * U-304 (ne-verify R-116 I-2; U-1, U-195): the plan run's records-changed mark, there before the apply
 * (apply's own look refuses) and written as the apply makes the workspace lock file (only the look under
 * the lock can find it; mark-at-lock.ts makes that moment deterministic, no race). Both refusals are the
 * same on both ways, the lock is released, and nothing is claimed, written or recorded.
 *
 * U-310 (ne-verify R-117 I-1; before C-7b): the app layer's plan, review and checkApply, which the GUI
 * uses, beside the CLI's plan, review and apply's own preflight, now that C-7a gave them one set of rules
 * (showPlan, recordReview). What is left to differ is the wrapping: the task form and the workspace form
 * (with its task type), where DR-28's secrets come from (the task file's or the config's), and an
 * error's way back (fromCliError).
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { createCodarynApp, createNodeAppEnvironment } from "../../src/app/index.js";
import type { CodarynApp, TaskForm } from "../../src/app/index.js";
import { PLAN_FILE_NAME, PRIVACY_TOKEN_PATTERN_SOURCE, RECORDS_CHANGED_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../src/contracts/index.js";
import type { ApplyJournalRecord, ApplyResult, CommandVerifierConfig, EngineResult, JournalRecord, ScriptStep } from "../../src/contracts/index.js";
import { fakeApiConfig, writeConfigFile } from "../fixtures/anthropic.js";
import { createSandbox, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { createFileArgs, organizeScript, sha256Of, textStep, toolStep, writeGeneralTask, writeOrganizeTask, writeOrganizeWorkspace } from "../fixtures/general-tasks.js";
import { EDIT_RIGHT_FIX, EDIT_WRONG_FIX, PRICE_CHECK_PATH, PRICE_PATH, writeRepairProject } from "../fixtures/repair-project.js";
import { FAKE_API_KEY, FAKE_SECRET_A, FAKE_SECRET_ENV_A } from "../fixtures/secrets.js";
import { NODE, cliEnv, expectCliError, expectRunResult, lockPath, readRunFiles, runDirOf, runTask, sha256Hex, startCli, waitFor } from "../support/cli.js";
import { MOCK_LABEL, replyText, replyTools, runGuarded, startFakeAnthropic, toolUse } from "../support/fake-anthropic.js";
import { applyArgs, expectApplyResult, planDigestOf, readApplyJournal, recordsOf, shortDigest } from "../support/general.js";
import { MARK_AT_LOCK_ENV, MARK_AT_LOCK_MODULE_URL, installMarkAtLock } from "../support/mark-at-lock.js";
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

/** U-295: `cancelFile`, the run's cancel file (`--cancel-file`, the request's `cancelFile`). */
async function viaCli(side: Side, env: NodeJS.ProcessEnv, cancelFile?: string): Promise<RunSide> {
  const run = await runTask(side.task, { cwd: side.sb.base, env, timeoutMs: TIMEOUT_MS, ...(cancelFile === undefined ? {} : { cancelFile }) });
  const result = expectRunResult(run);
  return { result, records: readRunFiles(side.sb.workspace, result).records };
}

async function viaApp(side: Side, env: NodeJS.ProcessEnv, cancelFile?: string): Promise<RunSide & { readonly app: CodarynApp }> {
  const app = await appFor(side.sb, env);
  const started = await app.startRun({ input: { kind: "task", taskPath: side.task }, configPath: null, varsFile: null, profile: null, workflowRef: null, cancelFile: cancelFile ?? null });
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

// ---------------------------------------------------------------------------------------------
// U-295: before C-6a, the paths of a run's life the app layer takes over

test("U-295 시작 전부터 있는 취소 파일: 첫 턴 전에 멈춘 실행의 결과와 기록이 CLI와 앱 계층에서 같다", { timeout: TIMEOUT_MS * 2 }, async (t) => {
  const env = cliEnv();
  const { cli, app } = pairOf(t, (sb) => {
    writeWorkspaceFile(sb, "README.md", "# Readme\n");
    writeFileSync(sb.cancelFile, "cancel");
    return writeTask(sb, { id: "u295-cancelled", workflow: "document" }, [{ text: "never asked" }]);
  });
  const viaCliRun = await viaCli(cli, env, cli.sb.cancelFile);
  const viaAppRun = await viaApp(app, env, app.sb.cancelFile);

  assert.deepEqual([viaCliRun.result.status, viaCliRun.result.reason, viaCliRun.result.usage.modelTurns], ["cancelled", "cancelled", 0]);
  assert.deepEqual(
    viaCliRun.records.map((record) => record.type),
    ["run_started", "state_checked", "state_checked", "run_finished"],
  );
  assertSameRun(viaCliRun, cli.sb, viaAppRun, app.sb);
});

test(`${MOCK_LABEL} U-295 터미널 없는 권한 질문: 물을 수 없는 CLI와 관찰자 없는 앱 계층이 같이 기본 거부로 기록한다`, { timeout: TIMEOUT_MS * 2 }, async (t) => {
  const goal = "Run the two checks.";
  const asked = (word: string) => toolUse(`toolu_${word}`, "run_command", { executable: NODE, args: ["-e", `require('fs').writeFileSync('ran-${word}.txt', '')`] });
  /** Each side has its own fake API with the same replies, and a config with its address and an asking rule. */
  const sideOf = async (): Promise<{ readonly sb: Sandbox; readonly config: string }> => {
    const sb = createSandbox(t);
    const api = await startFakeAnthropic(t, [replyTools([asked("one")]), replyTools([asked("two")]), replyText("Both checks are asked.")]);
    writeWorkspaceFile(sb, "notes.md", "# Weekly notes\n");
    const config = writeConfigFile(
      sb,
      fakeApiConfig(api.url, {
        model: "fake-model",
        maxRetries: 0,
        limits: { maxModelTurns: 6, maxToolCalls: 6, maxTotalTokens: 200_000, maxDurationMs: 60_000 },
        policy: { commands: [{ executable: NODE, argsPrefix: ["-e"], allowExtraArgs: true, confirm: true }], network: "deny", destructive: "deny", restorePathTokens: false },
      }),
    );
    return { sb, config };
  };
  const env = cliEnv({ fakeApiKey: FAKE_API_KEY });
  const cliSide = await sideOf();
  const appSide = await sideOf();

  const run = await runGuarded(cliSide.sb, ["run", "--config", cliSide.config, "--workspace", cliSide.sb.workspace, "--goal", goal], env, TIMEOUT_MS);
  const cliResult = expectRunResult(run, "anthropic");
  const viaCliRun: RunSide = { result: cliResult, records: readRunFiles(cliSide.sb.workspace, cliResult).records };

  const appOf = await appFor(appSide.sb, env);
  const started = await appOf.startRun({ input: { kind: "quick", workspace: appSide.sb.workspace, goal }, configPath: appSide.config, varsFile: null, profile: null, workflowRef: null, cancelFile: null });
  assert.ok(started.ok, `the app layer did not start the run: ${JSON.stringify(started)}`);
  const done = await started.handle.done;
  assert.ok(done.ok, `the app layer's run ended with an error: ${JSON.stringify(done)}`);
  const viaAppRun: RunSide = { result: done.result, records: readRunFiles(appSide.sb.workspace, done.result).records };

  assert.deepEqual([cliResult.status, cliResult.reason, run.exitCode], ["needs-input", "no_verifier", 3]);
  const answers = (side: RunSide) => side.records.flatMap((record) => (record.type === "confirmation_answered" ? [`${record.decision}/${record.by}`] : []));
  assert.deepEqual(answers(viaCliRun), ["deny/default", "deny/default"]);
  for (const side of [cliSide, appSide]) {
    assert.deepEqual(["ran-one.txt", "ran-two.txt"].filter((name) => existsSync(join(side.sb.workspace, name))), [], "no asked command ran");
  }
  assertSameRun(viaCliRun, cliSide.sb, viaAppRun, appSide.sb);
});

test("U-295 다른 실행이 쥔 잠금: CLI의 오류 JSON과 앱 계층의 거부가 같은 코드·글·분류이고, 둘 다 실행을 만들지 않는다", { timeout: TIMEOUT_MS * 2 }, async (t) => {
  const env = cliEnv();
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# Readme\n");
  const task = writeTask(sb, { id: "u295-locked", workflow: "document" }, [{ delayMs: 60_000, text: "never" }]);
  const holder = startCli(["run", "--task", task, "--cancel-file", sb.cancelFile], { cwd: sb.base, env, timeoutMs: TIMEOUT_MS });
  try {
    await waitFor(() => existsSync(lockPath(sb.workspace)), 30_000, "the holder's lock");
    const run = await runTask(task, { cwd: sb.base, env, timeoutMs: TIMEOUT_MS });
    const cliError = expectCliError(run, "workspace_locked");
    assert.equal(run.exitCode, 6);

    const started = await (await appFor(sb, env)).startRun({ input: { kind: "task", taskPath: task }, configPath: null, varsFile: null, profile: null, workflowRef: null, cancelFile: null });
    assert.ok(!started.ok, `the app layer started a run in a locked workspace: ${JSON.stringify(started)}`);
    const facts = (error: { code: string; message: string; category?: string; retryable?: boolean }) => ({ code: error.code, message: error.message, category: error.category, retryable: error.retryable });
    assert.deepEqual(facts(started.error), facts(cliError));
    assert.equal(readdirSync(join(sb.workspace, STATE_DIR_NAME, RUNS_DIR_NAME)).length, 1, "only the holder's run");
  } finally {
    writeFileSync(sb.cancelFile, "cancel");
    assert.equal(expectRunResult(await holder.done).status, "cancelled");
  }
});

// ---------------------------------------------------------------------------------------------
// U-302: before C-6b, a run plan carried out by the CLI's apply and by the app layer's applyPlan

const OLD_GUIDE = "old guide\n";
const PLANNED_FILES = [
  { path: "docs/guide.md", change: "modify" },
  { path: "docs/new.md", change: "create" },
] as const;
/** The plan run: reads the guide and proposes the two files; anything after the proposal is never asked. */
const PLAN_STEPS: ScriptStep[] = [
  toolStep("read_file", { path: "docs/guide.md" }),
  toolStep("propose_changes", { summary: "rewrite the guide and add a page", files: PLANNED_FILES.map((file) => ({ ...file })) }),
  textStep("never asked"),
];
/** The carrying run: `before`, then the two approved writes and its answer. */
const carrySteps = (before: readonly ScriptStep[] = []): ScriptStep[] => [
  ...before,
  toolStep("write_file", { path: "docs/guide.md", expectedHash: sha256Of(OLD_GUIDE), change: { kind: "replace_all", content: "new guide\n" } }),
  toolStep("write_file", createFileArgs("docs/new.md", "new page\n")),
  textStep("complete"),
];
const UNPLANNED_WRITE = toolStep("write_file", createFileArgs("docs/other.md", "not in the plan\n"));

interface PlanSide {
  readonly sb: Sandbox;
  readonly config: string;
}

interface Carried {
  readonly planRunId: string;
  readonly digest: string;
  /** The carrying run's result, or the refusal before it started. */
  readonly result: EngineResult | null;
  readonly refusal: { readonly code: string; readonly message: string; readonly category?: string; readonly retryable?: boolean } | null;
  readonly records: readonly JournalRecord[];
  /** `codaryn plan --json`'s status of the plan afterwards. */
  readonly planStatus: unknown;
  readonly exitCode: number | null;
  readonly stderr: string;
  /** U-304: the app layer gave a handle and then the refusal in `done` (false for the CLI, and for a refusal at the start). */
  readonly refusedAfterStart: boolean;
  /** U-304: whether the plan run's records-changed mark was there after the apply. */
  readonly marked: boolean;
}

/** U-304: the plan run's records-changed mark (DR-38: what a state check writes when another hand changed its records). */
const markFileOf = (side: PlanSide, planRunId: string): string => join(runDirOf(side.sb.workspace, planRunId), RECORDS_CHANGED_FILE_NAME);

/** A workspace with the guide, a config whose task type "rewrite" has plan "run", and a task that picks it. */
function planSideOf(t: TestContext): PlanSide {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "docs/guide.md", OLD_GUIDE);
  writeWorkspaceFile(sb, "keep.txt", "untouched\n");
  const config = writeConfigFile(sb, {
    schemaVersion: 1,
    language: "en",
    limits: { maxModelTurns: 8, maxToolCalls: 24, maxTotalTokens: 200_000, maxDurationMs: 60_000 },
    workflows: { rewrite: { tools: ["read_file", "search_files", "write_file", "propose_changes"], plan: "run" } },
  });
  writeGeneralTask(sb, {
    id: "u302-run-plan",
    goal: "rewrite the guide",
    fields: { workflowRef: "rewrite" },
    verifiers: [{ id: "guide", kind: "file_rules", rules: [{ type: "contains", path: "docs/guide.md", text: "new guide" }, { type: "exists", path: "docs/new.md" }] }],
  });
  return { sb, config };
}

const writeScript = (sb: Sandbox, steps: readonly ScriptStep[]): void => writeFileSync(sb.scriptPath, JSON.stringify({ schemaVersion: 1, steps }, null, 2));
const formOf = (side: PlanSide): TaskForm => ({ input: { kind: "task", taskPath: side.sb.taskPath }, configPath: side.config, varsFile: null, profile: null, workflowRef: null });
const cliForm = (side: PlanSide): string[] => ["--task", side.sb.taskPath, "--config", side.config];

function recordsOfRun(sb: Sandbox, runId: string): JournalRecord[] {
  const file = join(runDirOf(sb.workspace, runId), "journal.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as JournalRecord);
}

async function planStatusOf(side: PlanSide, env: NodeJS.ProcessEnv, planRunId: string): Promise<unknown> {
  const run = await startCli(["plan", ...cliForm(side), "--run", planRunId, "--json"], { cwd: side.sb.base, env, timeoutMs: TIMEOUT_MS }).done;
  return (JSON.parse(run.stdout.trim()) as { readonly status?: unknown }).status;
}

interface CarryOptions {
  readonly before?: readonly ScriptStep[];
  /** Done after the plan and before the apply: a person's edit, a lock. Returns its undoing. */
  readonly between?: (side: PlanSide) => (() => void) | void;
  readonly cancel?: boolean;
  /**
   * U-304 (U-1): the plan run's records-changed mark, "before" the apply (apply's own look finds it), or
   * written "atLock", as the apply makes the workspace lock file (mark-at-lock.ts: in the CLI process by
   * its preload, in this process for the app layer), so only the look under the lock can find it.
   */
  readonly mark?: "before" | "atLock";
}

/** (a) The CLI: `run` makes the plan, `apply --digest <12>` carries it out. */
async function carryByCli(side: PlanSide, env: NodeJS.ProcessEnv, options: CarryOptions = {}): Promise<Carried & { readonly plan: RunSide }> {
  writeScript(side.sb, PLAN_STEPS);
  const planned = expectRunResult(await startCli(["run", ...cliForm(side)], { cwd: side.sb.base, env, timeoutMs: TIMEOUT_MS }).done);
  const digest = planDigestOf(planned);
  writeScript(side.sb, carrySteps(options.before));
  const undo = options.between?.(side);
  if (options.cancel === true) writeFileSync(side.sb.cancelFile, "cancel");
  if (options.mark === "before") writeFileSync(markFileOf(side, planned.runId), "{}\n");
  const args = ["apply", ...cliForm(side), "--run", planned.runId, "--digest", shortDigest(digest), ...(options.cancel === true ? ["--cancel-file", side.sb.cancelFile] : [])];
  const atLock = options.mark === "atLock";
  const applyEnv = atLock ? { ...env, [MARK_AT_LOCK_ENV]: `${lockPath(side.sb.workspace)}|${markFileOf(side, planned.runId)}` } : env;
  const run = await startCli(args, { cwd: side.sb.base, env: applyEnv, timeoutMs: TIMEOUT_MS, ...(atLock ? { preload: [MARK_AT_LOCK_MODULE_URL] } : {}) }).done;
  undo?.();
  const output = JSON.parse(run.stdout.trim().split("\n").pop() ?? "{}") as Record<string, unknown>;
  const result = output["kind"] === "run" ? (output as unknown as EngineResult) : null;
  const refusal = output["kind"] === "error" ? { code: String(output["code"]), message: String(output["message"]), category: output["category"] as string, retryable: output["retryable"] as boolean } : null;
  return {
    plan: { result: planned, records: readRunFiles(side.sb.workspace, planned).records },
    planRunId: planned.runId,
    digest,
    result,
    refusal,
    records: result === null ? [] : recordsOfRun(side.sb, result.runId),
    planStatus: await planStatusOf(side, env, planned.runId),
    exitCode: run.exitCode,
    stderr: run.stderr,
    refusedAfterStart: false,
    marked: existsSync(markFileOf(side, planned.runId)),
  };
}

/** (b) The app layer: startRun makes the plan, applyPlan carries it out, as the GUI's main process asks. */
async function carryByApp(side: PlanSide, env: NodeJS.ProcessEnv, options: CarryOptions = {}): Promise<Carried & { readonly plan: RunSide }> {
  const app = await appFor(side.sb, env);
  writeScript(side.sb, PLAN_STEPS);
  const started = await app.startRun({ input: { kind: "task", taskPath: side.sb.taskPath }, configPath: side.config, varsFile: null, profile: null, workflowRef: null, cancelFile: null });
  assert.ok(started.ok, JSON.stringify(started));
  const planDone = await started.handle.done;
  assert.ok(planDone.ok, JSON.stringify(planDone));
  const planned = planDone.result;
  const digest = planDigestOf(planned);
  writeScript(side.sb, carrySteps(options.before));
  const undo = options.between?.(side);
  if (options.cancel === true) writeFileSync(side.sb.cancelFile, "cancel");
  if (options.mark === "before") writeFileSync(markFileOf(side, planned.runId), "{}\n");
  const hook = options.mark === "atLock" ? installMarkAtLock(lockPath(side.sb.workspace), markFileOf(side, planned.runId)) : null;
  let result: EngineResult | null = null;
  let refusal: Carried["refusal"] = null;
  let refusedAfterStart = false;
  try {
    const applying = await app.applyPlan({ settings: formOf(side), planRunId: planned.runId, digest: shortDigest(digest), cancelFile: options.cancel === true ? side.sb.cancelFile : null, unsafeMoveConsent: null });
    if (!applying.ok) refusal = { code: applying.error.code, message: applying.error.message, category: applying.error.category, retryable: applying.error.retryable };
    else {
      const done = await applying.handle.done;
      if (!done.ok) {
        // U-304: a refusal found after the start (under the lock) comes in `done`, after the handle.
        assert.equal(options.mark, "atLock", `the app layer's apply ended with an error: ${JSON.stringify(done)}`);
        refusal = { code: done.error.code, message: done.error.message, category: done.error.category, retryable: done.error.retryable };
        refusedAfterStart = true;
      } else {
        assert.equal(done.output.kind, "run", "a run plan is carried out by a run");
        result = done.output as EngineResult;
      }
    }
  } finally {
    hook?.remove();
  }
  if (hook !== null) assert.ok(hook.made(), "the mark was written as the lock was made");
  undo?.();
  return {
    plan: { result: planned, records: readRunFiles(side.sb.workspace, planned).records },
    planRunId: planned.runId,
    digest,
    result,
    refusal,
    records: result === null ? [] : recordsOfRun(side.sb, result.runId),
    planStatus: await planStatusOf(side, env, planned.runId),
    exitCode: null,
    stderr: "",
    refusedAfterStart,
    marked: existsSync(markFileOf(side, planned.runId)),
  };
}

/** The plan runs, then the carrying runs (result and records, normalized by role), then the plan's claim. */
function assertSameCarry(cli: Carried & { readonly plan: RunSide }, cliSide: PlanSide, app: Carried & { readonly plan: RunSide }, appSide: PlanSide): void {
  assertSameRun(cli.plan, cliSide.sb, app.plan, appSide.sb);
  assert.deepEqual(app.records.map((record) => record.type), cli.records.map((record) => record.type), "the carrying runs record the same kinds in the same order");
  const ids = (carried: Carried): Record<string, string> => ({ PLAN: carried.planRunId, DIGEST: carried.digest, ...(carried.result === null ? {} : { RUN: carried.result.runId }) });
  assert.deepEqual(normalized(app.result, appSide.sb, ids(app)), normalized(cli.result, cliSide.sb, ids(cli)), "the same carrying run's result");
  // The approval channel is the carrying run's run_started's by design, as an apply's (APPROVAL_CHANNELS):
  // `cli-flag` for --digest, `adapter` for an adapter's apply. Each side's is checked, then it is left out.
  const approvalOf = (records: readonly JournalRecord[]): unknown => (records[0] as { readonly approval?: unknown } | undefined)?.approval;
  assert.equal(approvalOf(cli.records), "cli-flag", "the CLI's --digest is its own channel");
  assert.equal(approvalOf(app.records), "adapter", "the app layer's apply is an adapter's");
  assert.deepEqual(normalized(app.records, appSide.sb, ids(app), ["approval"]), normalized(cli.records, cliSide.sb, ids(cli), ["approval"]), "the same carrying run's records (approval aside)");
  assert.equal(app.planStatus, cli.planStatus, "the plan is claimed alike");
}

const readText = (sb: Sandbox, file: string): string | null => (existsSync(join(sb.workspace, ...file.split("/"))) ? readFileSync(join(sb.workspace, ...file.split("/")), "utf8") : null);

test("U-302 run 계획의 정상 수행: CLI의 apply와 앱 계층의 applyPlan이 같은 실행을 만들고 계획을 차지한다", { timeout: TIMEOUT_MS * 3 }, async (t) => {
  const env = cliEnv();
  const cliSide = planSideOf(t);
  const appSide = planSideOf(t);
  const cli = await carryByCli(cliSide, env);
  const app = await carryByApp(appSide, env);
  assert.deepEqual([cli.result?.status, cli.result?.reason, cli.exitCode, cli.result?.planRunId], ["done", "verified", 0, cli.planRunId]);
  assert.deepEqual([readText(cliSide.sb, "docs/guide.md"), readText(appSide.sb, "docs/guide.md")], ["new guide\n", "new guide\n"]);
  assert.equal(cli.planStatus, "applied");
  assertSameCarry(cli, cliSide, app, appSide);
});

test("U-302 run 계획이 낡음(사람이 승인된 파일을 고침): 두 길 모두 모델 전에 failed/plan_stale, 계획은 차지되지 않는다", { timeout: TIMEOUT_MS * 3 }, async (t) => {
  const env = cliEnv();
  const edit = (side: PlanSide): void => writeFileSync(join(side.sb.workspace, "docs", "guide.md"), "changed by a person\n");
  const cliSide = planSideOf(t);
  const appSide = planSideOf(t);
  const cli = await carryByCli(cliSide, env, { between: edit });
  const app = await carryByApp(appSide, env, { between: edit });
  assert.deepEqual([cli.result?.status, cli.result?.reason, cli.exitCode, cli.result?.usage.modelTurns], ["failed", "plan_stale", 1, 0]);
  assert.deepEqual(cli.records.map((record) => record.type), ["run_started", "state_checked", "run_finished"]);
  assert.equal(cli.planStatus, "pending");
  assert.deepEqual([readText(cliSide.sb, "docs/guide.md"), readText(appSide.sb, "docs/guide.md")], ["changed by a person\n", "changed by a person\n"]);
  assertSameCarry(cli, cliSide, app, appSide);
});

test("U-302 run 계획의 수행 때 살아 있는 프로세스가 쥔 잠금: CLI의 오류 JSON과 앱 계층의 거부가 같고, 실행도 차지도 없다", { timeout: TIMEOUT_MS * 3 }, async (t) => {
  const env = cliEnv();
  // One live process holds both workspaces' locks (n03's way: no run of the workspace, so the plan's
  // records stay as they were); the lock files name the same pid, so the two messages are the same.
  const holder = spawn(NODE, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore", windowsHide: true });
  t.after(() => {
    holder.kill();
  });
  const lock = (side: PlanSide): void => writeFileSync(lockPath(side.sb.workspace), JSON.stringify({ pid: holder.pid, runId: "20261114T000000Z-0a0a0a0a", startedAt: "2026-11-14T00:00:00.000Z" }));
  const cliSide = planSideOf(t);
  const appSide = planSideOf(t);
  const cli = await carryByCli(cliSide, env, { between: lock });
  const app = await carryByApp(appSide, env, { between: lock });
  assert.equal(cli.exitCode, 6);
  assert.equal(cli.refusal?.code, "workspace_locked");
  assert.deepEqual(app.refusal, cli.refusal, "the same code, message, category and retryable");
  for (const [side, carried] of [[cliSide, cli], [appSide, app]] as const) {
    assert.equal(readdirSync(join(side.sb.workspace, STATE_DIR_NAME, RUNS_DIR_NAME)).length, 1, "only the plan run");
    assert.equal(carried.planStatus, "pending");
    assert.equal(readText(side.sb, "docs/guide.md"), OLD_GUIDE);
  }
  assertSameRun(cli.plan, cliSide.sb, app.plan, appSide.sb);
});

test("U-302 run 계획 밖의 쓰기: 두 길 모두 거부하고 같은 수로 기록하며, CLI의 끝 요약이 그 수를 말한다", { timeout: TIMEOUT_MS * 3 }, async (t) => {
  const env = cliEnv();
  const cliSide = planSideOf(t);
  const appSide = planSideOf(t);
  const cli = await carryByCli(cliSide, env, { before: [UNPLANNED_WRITE] });
  const app = await carryByApp(appSide, env, { before: [UNPLANNED_WRITE] });
  assert.deepEqual([cli.result?.status, cli.result?.reason, cli.exitCode], ["done", "verified", 0]);
  const refused = (carried: Carried): string[] => carried.records.flatMap((record) => (record.type === "tool_decision" && !record.allowed ? [`${record.permission ?? "?"}/${record.code ?? "?"}`] : []));
  assert.deepEqual(refused(cli), ["path/path_not_writable"]);
  assert.deepEqual(refused(app), refused(cli));
  for (const side of [cliSide, appSide]) assert.equal(readText(side.sb, "docs/other.md"), null, "the unplanned file is not written");
  assert.ok(cli.stderr.split(/\r?\n/).includes("Writes denied because the file is not in the approved plan: 1"), cli.stderr);
  assertSameCarry(cli, cliSide, app, appSide);
});

test("U-302 run 계획의 수행 전부터 있는 취소 파일: 두 길 모두 모델 전에 cancelled, 계획은 차지되지 않는다", { timeout: TIMEOUT_MS * 3 }, async (t) => {
  const env = cliEnv();
  const cliSide = planSideOf(t);
  const appSide = planSideOf(t);
  const cli = await carryByCli(cliSide, env, { cancel: true });
  const app = await carryByApp(appSide, env, { cancel: true });
  assert.deepEqual([cli.result?.status, cli.result?.reason, cli.exitCode, cli.result?.usage.modelTurns], ["cancelled", "cancelled", 5, 0]);
  assert.equal(cli.planStatus, "pending");
  for (const side of [cliSide, appSide]) assert.equal(readText(side.sb, "docs/guide.md"), OLD_GUIDE);
  assertSameCarry(cli, cliSide, app, appSide);
});

// ---------------------------------------------------------------------------------------------
// U-304: the plan run's records-changed mark (U-1): apply's own look, and the look under the lock

/** Neither way left anything: no lock, the plan not claimed, the guide as it was, no run but the plan run. */
function assertNothingLeft(side: PlanSide, carried: Carried): void {
  assert.equal(existsSync(lockPath(side.sb.workspace)), false, "the lock is released");
  assert.equal(carried.planStatus, "pending", "the plan is not claimed");
  assert.equal(readText(side.sb, "docs/guide.md"), OLD_GUIDE, "nothing written");
  assert.deepEqual(readdirSync(join(side.sb.workspace, STATE_DIR_NAME, RUNS_DIR_NAME)), [carried.planRunId], "nothing recorded but the plan run");
  assert.equal(carried.marked, true, "the mark stays");
}

test("U-304 run 계획 실행의 기록 변경 표시가 적용 앞에 있을 때: 두 길 모두 잠금 전에 같은 글로 거부하고 아무것도 남기지 않는다", { timeout: TIMEOUT_MS * 3 }, async (t) => {
  const env = cliEnv();
  const cliSide = planSideOf(t);
  const appSide = planSideOf(t);
  const cli = await carryByCli(cliSide, env, { mark: "before" });
  const app = await carryByApp(appSide, env, { mark: "before" });
  assert.deepEqual([cli.exitCode, cli.refusal?.code], [2, "plan_records_changed"]);
  assert.match(cli.refusal?.message ?? "", /so its plan may not be the one shown; nothing was asked, sent or written/);
  assert.equal(app.refusedAfterStart, false, "the app refuses at the start, before a handle");
  assert.deepEqual(app.refusal, cli.refusal, "the same code, message, category and retryable");
  for (const [side, carried] of [[cliSide, cli], [appSide, app]] as const) assertNothingLeft(side, carried);
  assertSameRun(cli.plan, cliSide.sb, app.plan, appSide.sb);
});

test("U-304 잠금을 만드는 순간에 생긴 기록 변경 표시(U-1): 두 길 모두 잠금 아래에서 같은 글로 거부하고, 잠금을 풀며, 아무것도 남기지 않는다", { timeout: TIMEOUT_MS * 3 }, async (t) => {
  const env = cliEnv();
  const cliSide = planSideOf(t);
  const appSide = planSideOf(t);
  const cli = await carryByCli(cliSide, env, { mark: "atLock" });
  const app = await carryByApp(appSide, env, { mark: "atLock" });
  // The CLI's apply looked before the lock and found nothing; the mark came with the lock, and the look
  // under it refused (run-life.ts), with its own words.
  assert.deepEqual([cli.exitCode, cli.refusal?.code], [2, "plan_records_changed"]);
  assert.match(cli.refusal?.message ?? "", /found under the workspace lock; its plan may not be the one approved, so nothing was recorded, sent or written/);
  // As now: the app layer gives the handle once the run is assembled, so this refusal comes in `done`.
  assert.equal(app.refusedAfterStart, true, "the app's refusal comes after its handle");
  assert.deepEqual(app.refusal, cli.refusal, "the same code, message, category and retryable");
  for (const [side, carried] of [[cliSide, cli], [appSide, app]] as const) assertNothingLeft(side, carried);
  assertSameRun(cli.plan, cliSide.sb, app.plan, appSide.sb);
});

// ---------------------------------------------------------------------------------------------
// U-310: before C-7b, the app's plan, review and checkApply beside the CLI's plan, review and apply

const SECRET_FILE = `inbox/${FAKE_SECRET_A}.txt`;
/** The CLI's and the app's environment: the registered secret's value, and the fake key a review note must not hold. */
const viewEnv = (): NodeJS.ProcessEnv => cliEnv({ fakeApiKey: FAKE_API_KEY, extra: { [FAKE_SECRET_ENV_A]: FAKE_SECRET_A } });

interface ViewSide {
  readonly sb: Sandbox;
  readonly task: string;
  /** Registers the secret too (secretEnv), so the workspace form masks as the task form does. */
  readonly config: string;
  /** Registers nothing: the workspace form with it masks the plan's paths differently (DR-28). */
  readonly plainConfig: string;
}

/**
 * The organize workspace with a file named after the registered secret, a task file that registers it
 * (privacy.secretEnv), a config that registers it too and one that does not, and `steps` as the script.
 */
function viewSideOf(t: TestContext, steps: readonly ScriptStep[]): ViewSide {
  const sb = createSandbox(t);
  writeOrganizeWorkspace(sb);
  writeWorkspaceFile(sb, SECRET_FILE, "named after the secret\n");
  const config = writeConfigFile(sb, {
    schemaVersion: 1,
    secretEnv: [FAKE_SECRET_ENV_A],
    workflows: { checked: { tools: ["read_file", "write_file"], completion: "human_review", humanReview: { checklist: ["the summary is right"] } } },
  });
  const plainConfig = writeConfigFile(sb, { schemaVersion: 1 }, "plain-config.json");
  const task = writeGeneralTask(sb, { id: "u310-view", label: "organize", fields: { workflowRef: "organize", privacy: { secretEnv: [FAKE_SECRET_ENV_A] } }, policy: { planActions: ["move", "discard"] } }, steps);
  return { sb, task, config, plainConfig };
}

/** The plan: a move of the budget table and of the secret-named file. */
const VIEW_PLAN_STEPS: ScriptStep[] = [
  toolStep("propose_plan", { summary: "sort two files", actions: [{ kind: "move", from: "inbox/budget.csv", to: "data/budget.csv" }, { kind: "move", from: SECRET_FILE, to: `sorted/${FAKE_SECRET_A}.txt` }] }),
  textStep("never asked"),
];

async function cliJson(sb: Sandbox, args: readonly string[], env: NodeJS.ProcessEnv): Promise<{ readonly exitCode: number | null; readonly json: Record<string, unknown> }> {
  const run = await startCli(args, { cwd: sb.base, env, timeoutMs: TIMEOUT_MS }).done;
  return { exitCode: run.exitCode, json: JSON.parse(run.stdout.trim().split("\n").pop() ?? "{}") as Record<string, unknown> };
}

/** An error's facts as the CLI's JSON line and the app's AppError both carry them. */
const errorFacts = (error: object): Record<string, unknown> => {
  const given = error as Record<string, unknown>;
  return { code: given["code"], message: given["message"], category: given["category"], retryable: given["retryable"], hint: given["hint"] };
};

test("U-310 계획 보기: CLI와 앱이 task 형식과 작업 공간 형식으로 같은 계획을 같게 보이고, 기록 변경 표시도 같으며, 가릴 값이 다른 형식은 같은 오류로 거부한다", { timeout: TIMEOUT_MS * 3 }, async (t) => {
  const env = viewEnv();
  const side = viewSideOf(t, VIEW_PLAN_STEPS);
  const planned = expectRunResult(await startCli(["run", "--task", side.task, "--config", side.config], { cwd: side.sb.base, env, timeoutMs: TIMEOUT_MS }).done);
  const planRunId = planned.runId;
  const ids = { PLAN: planRunId, DIGEST: planDigestOf(planned) };
  const app = await appFor(side.sb, env);
  const taskForm: TaskForm = { input: { kind: "task", taskPath: side.task }, configPath: side.config, varsFile: null, profile: null, workflowRef: null };
  const workspaceForm = (config: string): TaskForm => ({ input: { kind: "workspace", workspace: side.sb.workspace }, configPath: config, varsFile: null, profile: null, workflowRef: "organize" });
  const cliTaskArgs = ["plan", "--task", side.task, "--config", side.config, "--run", planRunId, "--json"];
  const cliWorkspaceArgs = (config: string): string[] => ["plan", "--workspace", side.sb.workspace, "--workflow", "organize", "--config", config, "--run", planRunId, "--json"];
  const appView = async (form: TaskForm): Promise<unknown> => {
    const outcome = await app.plan({ settings: form, runId: planRunId });
    assert.ok(outcome.ok, JSON.stringify(outcome));
    return outcome.output;
  };

  // The task form and the workspace form, on both ways: one view, its secret-named path masked.
  const cliTask = await cliJson(side.sb, cliTaskArgs, env);
  assert.equal(cliTask.json["status"], "pending");
  const shown = normalized(cliTask.json, side.sb, ids) as { readonly actions: readonly { readonly from: string }[] };
  assert.match(shown.actions[1]?.from ?? "", /^inbox\/<TOKEN1>\.txt$/, "the secret-named path is masked");
  for (const [label, view] of [
    ["app, task form", await appView(taskForm)],
    ["CLI, workspace form", (await cliJson(side.sb, cliWorkspaceArgs(side.config), env)).json],
    ["app, workspace form", await appView(workspaceForm(side.config))],
  ] as const) {
    assert.deepEqual(normalized(view, side.sb, ids), shown, `${label}: the same view as the CLI's task form`);
  }

  // DR-28: a workspace form whose config registers no secret masks the paths otherwise: refused alike.
  const cliRefused = await cliJson(side.sb, cliWorkspaceArgs(side.plainConfig), env);
  const appRefused = await app.plan({ settings: workspaceForm(side.plainConfig), runId: planRunId });
  assert.deepEqual([cliRefused.exitCode, cliRefused.json["code"]], [2, "plan_secrets_differ"]);
  assert.ok(!appRefused.ok, JSON.stringify(appRefused));
  assert.deepEqual(errorFacts(appRefused.error), errorFacts(cliRefused.json), "the same error back from the app");

  // A records-changed mark: both views carry it.
  writeFileSync(join(runDirOf(side.sb.workspace, planRunId), RECORDS_CHANGED_FILE_NAME), "{}\n");
  const cliMarked = await cliJson(side.sb, cliTaskArgs, env);
  assert.equal(cliMarked.json["recordsChanged"], true);
  assert.deepEqual(normalized(await appView(taskForm), side.sb, ids), normalized(cliMarked.json, side.sb, ids), "the same marked view");

  // A run plan (plan "run", U-302's): the same changes view.
  const runSide = planSideOf(t);
  writeScript(runSide.sb, PLAN_STEPS);
  const runPlanned = expectRunResult(await startCli(["run", ...cliForm(runSide)], { cwd: runSide.sb.base, env, timeoutMs: TIMEOUT_MS }).done);
  const runIds = { PLAN: runPlanned.runId, DIGEST: planDigestOf(runPlanned) };
  const cliChanges = await cliJson(runSide.sb, ["plan", ...cliForm(runSide), "--run", runPlanned.runId, "--json"], env);
  assert.equal(cliChanges.json["planKind"], "changes");
  const appChanges = await (await appFor(runSide.sb, env)).plan({ settings: formOf(runSide), runId: runPlanned.runId });
  assert.ok(appChanges.ok, JSON.stringify(appChanges));
  assert.deepEqual(normalized(appChanges.output, runSide.sb, runIds), normalized(cliChanges.json, runSide.sb, runIds), "the same changes view");
});

test("U-310 사람 확인: CLI의 review와 앱의 review가 같은 실행에 같은 판정을 기록하고(가린 메모, latest로 바꿈), 키 값이 든 메모는 같은 오류로 거부한다", { timeout: TIMEOUT_MS * 3 }, async (t) => {
  const env = viewEnv();
  const steps: ScriptStep[] = [toolStep("write_file", createFileArgs("summary.md", "summary\n")), textStep("done, please look")];
  /** A run that waits for a person's review (the config's task type "checked"), made by the CLI on each side. */
  const reviewSideOf = async (): Promise<{ readonly side: ViewSide; readonly runId: string; readonly form: TaskForm; readonly args: readonly string[] }> => {
    const side = viewSideOf(t, steps);
    writeGeneralTask(side.sb, { id: "u310-review", label: "checked", fields: { workflowRef: "checked", privacy: { secretEnv: [FAKE_SECRET_ENV_A] } } }, steps);
    const ran = expectRunResult(await startCli(["run", "--task", side.task, "--config", side.config], { cwd: side.sb.base, env, timeoutMs: TIMEOUT_MS }).done);
    assert.deepEqual([ran.status, ran.reason], ["needs-input", "awaiting_review"]);
    return { side, runId: ran.runId, form: { input: { kind: "task", taskPath: side.task }, configPath: side.config, varsFile: null, profile: null, workflowRef: null }, args: ["--task", side.task, "--config", side.config] };
  };
  const cli = await reviewSideOf();
  const app = await reviewSideOf();
  const appOf = await appFor(app.side.sb, env);
  const recordOf = (side: ViewSide, runId: string): unknown => JSON.parse(readFileSync(join(runDirOf(side.sb.workspace, runId), "review.json"), "utf8"));
  const same = (label: string, appValue: unknown, cliValue: unknown): void =>
    assert.deepEqual(normalized(appValue, app.side.sb, { RUN: app.runId }), normalized(cliValue, cli.side.sb, { RUN: cli.runId }), label);

  // Accepted with a note that holds the registered value: masked in the output and in review.json.
  const note = `looks right ${FAKE_SECRET_A}`;
  const cliAccepted = await cliJson(cli.side.sb, ["review", ...cli.args, "--run", cli.runId, "--accept", "--note", note, "--json"], env);
  const appAccepted = await appOf.review({ settings: app.form, runId: app.runId, decision: "accept", note });
  assert.ok(appAccepted.ok, JSON.stringify(appAccepted));
  assert.deepEqual([cliAccepted.json["verdict"], cliAccepted.json["replaced"]], ["accepted", false]);
  same("the same accepted review", appAccepted.output, cliAccepted.json);
  assert.ok(!JSON.stringify(recordOf(cli.side, cli.runId)).includes(FAKE_SECRET_A), "the note's registered value is masked in review.json");
  same("the same review.json", recordOf(app.side, app.runId), recordOf(cli.side, cli.runId));

  // Rejected by `latest`, the run reference both resolve alike: it replaces the verdict.
  const cliRejected = await cliJson(cli.side.sb, ["review", ...cli.args, "--run", "latest", "--reject", "--note", "on second look, no", "--json"], env);
  const appRejected = await appOf.review({ settings: app.form, runId: "latest", decision: "reject", note: "on second look, no" });
  assert.ok(appRejected.ok, JSON.stringify(appRejected));
  assert.deepEqual([cliRejected.json["verdict"], cliRejected.json["replaced"]], ["rejected", true]);
  same("the same replacing review", appRejected.output, cliRejected.json);

  // A note with the key's value: refused alike, review.json left as it was.
  const keyNote = `the key is ${FAKE_API_KEY}`;
  const cliKey = await cliJson(cli.side.sb, ["review", ...cli.args, "--run", cli.runId, "--accept", "--note", keyNote, "--json"], env);
  const appKey = await appOf.review({ settings: app.form, runId: app.runId, decision: "accept", note: keyNote });
  assert.deepEqual([cliKey.exitCode, cliKey.json["code"]], [2, "key_in_file"]);
  assert.ok(!appKey.ok, JSON.stringify(appKey));
  assert.deepEqual(errorFacts(appKey.error), errorFacts(cliKey.json), "the same error back from the app");
  same("review.json is the rejection still", recordOf(app.side, app.runId), recordOf(cli.side, cli.runId));
  assert.equal((recordOf(cli.side, cli.runId) as { readonly verdict?: unknown }).verdict, "rejected");

  // The workspace form, as the GUI asks (its secrets from the config's secretEnv): the same accepted review.
  const cliWorkspace = await cliJson(cli.side.sb, ["review", "--workspace", cli.side.sb.workspace, "--workflow", "checked", "--config", cli.side.config, "--run", cli.runId, "--accept", "--json"], env);
  const appWorkspace = await appOf.review({
    settings: { input: { kind: "workspace", workspace: app.side.sb.workspace }, configPath: app.side.config, varsFile: null, profile: null, workflowRef: "checked" },
    runId: app.runId,
    decision: "accept",
    note: null,
  });
  assert.ok(appWorkspace.ok, JSON.stringify(appWorkspace));
  assert.deepEqual([cliWorkspace.json["verdict"], cliWorkspace.json["replaced"]], ["accepted", true]);
  same("the same review through the workspace form", appWorkspace.output, cliWorkspace.json);
  same("the same review.json after it", recordOf(app.side, app.runId), recordOf(cli.side, cli.runId));
});

test("U-310 적용 전 점검: 앱의 checkApply가 CLI apply의 사전 점검(plan_checked)과 같은 문제를 찾고, 기록 변경 표시는 같은 코드로 거부한다", { timeout: TIMEOUT_MS * 3 }, async (t) => {
  const env = viewEnv();
  /** A plan made by the CLI; the app's check of it; then the CLI's apply, whose plan_checked is compared. */
  const checkThenApply = async (change: (side: ViewSide, planRunId: string) => void) => {
    const side = viewSideOf(t, VIEW_PLAN_STEPS);
    const planned = expectRunResult(await startCli(["run", "--task", side.task, "--config", side.config], { cwd: side.sb.base, env, timeoutMs: TIMEOUT_MS }).done);
    const digest = planDigestOf(planned);
    change(side, planned.runId);
    const form: TaskForm = { input: { kind: "task", taskPath: side.task }, configPath: side.config, varsFile: null, profile: null, workflowRef: null };
    const check = await (await appFor(side.sb, env)).checkApply({ settings: form, planRunId: planned.runId, digest });
    const applied = await cliJson(side.sb, ["apply", "--task", side.task, "--config", side.config, "--run", planned.runId, "--digest", shortDigest(digest)], env);
    const preflight = applied.json["kind"] === "apply" ? recordsOf(readApplyJournal(side.sb.workspace, String(applied.json["runId"])), "plan_checked")[0] : undefined;
    return { check, applied, preflight };
  };
  const editSource = (side: ViewSide): void => writeFileSync(join(side.sb.workspace, "inbox", "budget.csv"), "changed by a person\n");
  const mark = (side: ViewSide, planRunId: string): void => writeFileSync(join(runDirOf(side.sb.workspace, planRunId), RECORDS_CHANGED_FILE_NAME), "{}\n");

  for (const [label, change, applyEnd, problems] of [
    ["clean", () => undefined, ["done", "verified"], []],
    ["a source changed", editSource, ["failed", "plan_stale"], [{ index: 0, problem: "source_changed" }]],
  ] as const) {
    const { check, applied, preflight } = await checkThenApply(change);
    assert.ok(check.ok, `${label}: ${JSON.stringify(check)}`);
    assert.deepEqual([applied.json["status"], applied.json["reason"]], applyEnd, label);
    assert.ok(preflight !== undefined, `${label}: the apply recorded its preflight`);
    assert.deepEqual(check.output.problems, problems, `${label}: the check's problems`);
    assert.deepEqual(
      { problems: check.output.problems, unsafeMoves: check.output.unsafeMoves, inventoryLimitReached: check.output.inventoryLimitReached },
      { problems: preflight.problems, unsafeMoves: preflight.unsafeMoves ?? [], inventoryLimitReached: preflight.inventoryLimitReached },
      `${label}: the check finds what the apply's preflight found`,
    );
  }

  // A records-changed mark: both refuse with the same code, each in its own words (a check, an apply).
  const { check: markedCheck, applied: markedApply } = await checkThenApply(mark);
  assert.ok(!markedCheck.ok, JSON.stringify(markedCheck));
  assert.deepEqual([markedApply.exitCode, markedApply.json["code"]], [2, "plan_records_changed"]);
  assert.equal(markedCheck.error.code, markedApply.json["code"]);
  assert.match(markedCheck.error.message, /records were changed by something other than the run, so its plan may not be the one shown; nothing was checked$/);
  assert.match(String(markedApply.json["message"]), /^the plan run's records were changed by something other than the run \(a records-changed mark\), so its plan may not be the one shown; nothing was asked, recorded or moved/);
});
