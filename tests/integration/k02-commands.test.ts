/**
 * Phase 3 commands and run options: U-3 (install directory refused), U-5 `report`, U-6 `doctor`,
 * U-7 `--help`/`--version`, U-8 progress on stderr and `--quiet`.
 * Contracts: src/contracts/commands.ts, engine.ts (`workspace_is_install_dir`), docs/cli-contract.md
 * section 15. U-7 and U-8 have no output format in the contract yet; their cases check behavior
 * only (exit code, where output goes, no leaks), see the K5 report.
 * U-3 is tried against a copy of the built CLI (installCopy) so no run is ever pointed at this
 * repository. Anthropic cases use the local fake server: mock API verification, not the real API.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { ANTHROPIC_API_KEY_ENV, REPORT_EXIT_CODES } from "../../src/contracts/index.js";
import type { CommandVerifierConfig } from "../../src/contracts/index.js";
import {
  ANTHROPIC_LIMITS,
  FAKE_MODEL_CONFIG,
  fakeApiConfig,
  writeAnthropicTask,
  writeConfigFile,
  writeEnvFile,
} from "../fixtures/anthropic.js";
import { createSandbox, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import {
  EDIT_RIGHT_FIX,
  EDIT_WEAKEN_TEST,
  EDIT_WRONG_FIX,
  NOISY_CHECK_PATH,
  PRICE_CHECK_PATH,
  SETTINGS_PATH,
  writeRepairProject,
} from "../fixtures/repair-project.js";
import {
  FAKE_API_KEY,
  FAKE_ENV_FILE_VALUE,
  FAKE_SECRET_ENV_A,
  FRAGMENT_SECRET,
} from "../fixtures/secrets.js";
import { installCopy } from "../fixtures/self-dev.js";
import {
  NODE,
  REPO_ROOT,
  cliEnv,
  expectCliError,
  expectRunResult,
  lockPath,
  readRunFiles,
  runTask,
  startCli,
} from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { checkOf, doctorArgs, expectDoctorOutput, expectReportOutput, runReport } from "../support/commands.js";
import {
  MOCK_LABEL,
  replyText,
  replyTools,
  runGuarded,
  startFakeAnthropic,
  toolUse,
} from "../support/fake-anthropic.js";
import { decodedSource, findLeaks } from "../support/leak.js";
import type { TextSource } from "../support/leak.js";
import { assertProgressClean, assertQuiet } from "../support/progress.js";
import { treeBytes } from "../support/repair-check.js";
import { callStep, editStep, finalStep, readStep } from "../support/repair-script.js";

const CHECK_VERIFIER: CommandVerifierConfig = {
  id: "check",
  kind: "command",
  executable: NODE,
  args: [PRICE_CHECK_PATH],
  timeoutMs: 30_000,
};

function outputSources(run: CliRun): TextSource[] {
  return [
    { label: "stdout", text: run.stdout },
    { label: "stderr", text: run.stderr },
    decodedSource("stdout", run.stdout, true),
  ];
}

// ---------------------------------------------------------------- U-3

test("U-3 작업 공간이 CLI 설치 위치와 같거나 안이거나 그것을 포함하면 실행 전에 거부", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  const outer = join(sb.base, "outer");
  const install = installCopy(sb, outer);
  writeWorkspaceFile(sb, "README.md", "# 연습\n");
  const README_RULE = [{ id: "readme", kind: "file_rules" as const, rules: [{ type: "exists" as const, path: "README.md" }] }];

  for (const [label, workspace] of [
    ["설치 위치 자체", install.root],
    ["설치 위치 안", join(install.root, "dist")],
    ["설치 위치를 포함", outer],
  ] as const) {
    await t.test(label, async () => {
      const taskPath = writeTask(sb, { id: "k02-install", workspaceRoot: workspace, verifiers: README_RULE }, [finalStep("끝")]);
      const run = await startCli(["run", "--task", taskPath], { cwd: sb.base, cliPath: install.cliPath }).done;
      expectCliError(run, "workspace_is_install_dir");
      assert.equal(run.exitCode, 2);
      for (const dir of [outer, install.root, join(install.root, "dist")]) {
        assert.equal(existsSync(join(dir, ".codaryn")), false, `nothing may be written in ${dir}`);
      }
    });
  }
  await t.test("대조군: 같은 복사본으로 설치 위치 밖 작업 공간은 실행된다", async () => {
    const taskPath = writeTask(sb, { id: "k02-install-ok", verifiers: README_RULE }, [finalStep("끝")]);
    const run = await startCli(["run", "--task", taskPath], { cwd: sb.base, cliPath: install.cliPath }).done;
    assert.equal(expectRunResult(run).status, "done");
  });
});

// ---------------------------------------------------------------- U-5

interface ReportedRun {
  readonly sb: Sandbox;
  readonly runId: string;
  readonly resultText: string;
  readonly journalText: string;
}

/** A run that reads a fake secret, fails once, is repaired and passes. */
async function reportedRun(t: TestContext): Promise<ReportedRun> {
  const sb = createSandbox(t);
  writeRepairProject(sb, { secret: FRAGMENT_SECRET });
  const taskPath = writeTask(
    sb,
    { id: "k02-report", secretEnv: [FAKE_SECRET_ENV_A], limits: { maxRepairAttempts: 2 }, verifiers: [CHECK_VERIFIER] },
    [
      readStep("r-settings", SETTINGS_PATH),
      editStep("w-wrong", EDIT_WRONG_FIX),
      finalStep("첫 수정"),
      editStep("w-right", EDIT_RIGHT_FIX),
      finalStep("다시 고쳤다"),
    ],
  );
  const run = await runTask(taskPath, { cwd: sb.base, env: cliEnv({ extra: { [FAKE_SECRET_ENV_A]: FRAGMENT_SECRET } }) });
  const result = expectRunResult(run);
  const files = readRunFiles(sb.workspace, result);
  assert.equal(result.status, "done", "setup run must finish");
  return { sb, runId: result.runId, resultText: files.resultText, journalText: files.journalText };
}

test("U-5 report --json: 결과와 기록 요약, 아무것도 바꾸지 않고 비밀 없음", { timeout: 120_000 }, async (t) => {
  const r = await reportedRun(t);
  const stateBefore = treeBytes(join(r.sb.workspace, ".codaryn"));
  const run = await runReport(r.sb.workspace, r.runId, { cwd: r.sb.base });
  const output = expectReportOutput(run, r.runId);
  const result = JSON.parse(r.resultText) as Record<string, unknown>;

  assert.equal(output.status, "complete");
  assert.equal(run.exitCode, REPORT_EXIT_CODES.complete);
  assert.deepEqual(output.result, result, "result is the run's result.json");
  const journal = output.journal;
  assert.equal(journal.taskId, "k02-report");
  assert.equal(journal.provider, "scripted");
  assert.equal(journal.records, r.journalText.split("\n").filter((line) => line !== "").length);
  assert.equal(journal.modelRequests, 5);
  assert.equal(journal.repairs, 1);
  assert.equal(journal.deniedToolCalls, 0);
  assert.deepEqual(journal.lastRound.map((verifier) => verifier.outcome), ["pass"]);
  assert.deepEqual(journal.changes, output.result?.changes);
  assert.deepEqual(journal.integrityChecks, []);
  assert.deepEqual(journal.finished, { status: "done", reason: "verified" });

  assert.deepEqual(treeBytes(join(r.sb.workspace, ".codaryn")), stateBefore, "report changes nothing");
  assert.equal(existsSync(lockPath(r.sb.workspace)), false, "report takes no lock");
  assert.deepEqual(findLeaks(outputSources(run), [FRAGMENT_SECRET], { extended: true }), []);
});

test("U-5 report 기본 출력(Markdown): 실행 id가 있고 비밀 없음", { timeout: 120_000 }, async (t) => {
  const r = await reportedRun(t);
  const run = await runReport(r.sb.workspace, r.runId, { cwd: r.sb.base, json: false });
  assert.equal(run.exitCode, REPORT_EXIT_CODES.complete);
  assert.ok(run.stdout.includes(r.runId), "the text names the run");
  assert.deepEqual(findLeaks(outputSources(run), [FRAGMENT_SECRET], { extended: true }), []);
});

test("U-5 report incomplete: result.json 없음 → 기록만으로, 쓰는 중인 마지막 줄은 무시", { timeout: 120_000 }, async (t) => {
  const r = await reportedRun(t);
  const runDir = join(r.sb.workspace, ".codaryn", "runs", r.runId);
  rmSync(join(runDir, "result.json"));
  writeFileSync(join(runDir, "journal.jsonl"), `${r.journalText}{"seq":9999,"type":"model_req`);
  const run = await runReport(r.sb.workspace, r.runId, { cwd: r.sb.base });
  const output = expectReportOutput(run, r.runId);
  assert.equal(output.status, "incomplete");
  assert.equal(run.exitCode, REPORT_EXIT_CODES.incomplete);
  assert.equal(output.result, null);
  assert.equal(output.journal.repairs, 1);
  assert.deepEqual(output.journal.finished, { status: "done", reason: "verified" });
});

test("U-5 report 오류: 없는 실행, 없는 작업 공간, 깨진 result.json, 인자 누락", { timeout: 120_000 }, async (t) => {
  const r = await reportedRun(t);
  await t.test("run_not_found", async () => {
    expectCliError(await runReport(r.sb.workspace, "20000101T000000Z-deadbeef", { cwd: r.sb.base }), "run_not_found");
  });
  await t.test("workspace_not_found", async () => {
    expectCliError(await runReport(join(r.sb.base, "missing"), r.runId, { cwd: r.sb.base }), "workspace_not_found");
  });
  await t.test("invalid_arguments", async () => {
    const run = await startCli(["report", "--workspace", r.sb.workspace, "--json"], { cwd: r.sb.base }).done;
    expectCliError(run, "invalid_arguments");
  });
  await t.test("invalid_run_record", async () => {
    writeFileSync(join(r.sb.workspace, ".codaryn", "runs", r.runId, "result.json"), "{ not json");
    expectCliError(await runReport(r.sb.workspace, r.runId, { cwd: r.sb.base }), "invalid_run_record");
  });
});

// ---------------------------------------------------------------- U-6

interface DoctorSetup {
  readonly sb: Sandbox;
  readonly configPath: string;
  readonly varsFile: string;
  readonly taskPath: string;
  readonly requests: () => number;
}

async function doctorSetup(t: TestContext, config: Parameters<typeof fakeApiConfig>[1] = {}): Promise<DoctorSetup> {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 연습\n");
  const api = await startFakeAnthropic(t, [replyText("끝")]);
  const configPath = writeConfigFile(sb, fakeApiConfig(api.url, { model: FAKE_MODEL_CONFIG, limits: ANTHROPIC_LIMITS, ...config }));
  const varsFile = writeEnvFile(join(sb.base, "vars.env"), {
    [ANTHROPIC_API_KEY_ENV]: FAKE_API_KEY,
    CODARYN_IT_SERVICE_TOKEN: FAKE_ENV_FILE_VALUE,
  });
  const taskPath = writeAnthropicTask(sb, {
    id: "k02-doctor",
    verifiers: [{ id: "readme", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] }],
  });
  return { sb, configPath, varsFile, taskPath, requests: () => api.requests.length };
}

function assertDoctorSilent(run: CliRun, s: DoctorSetup): void {
  assert.equal(s.requests(), 0, "doctor sends no request");
  assert.deepEqual(findLeaks(outputSources(run), [FAKE_API_KEY, FAKE_ENV_FILE_VALUE], { extended: true }), []);
  assert.equal(run.stdout.includes(s.sb.base), false, "paths are not echoed");
  assert.equal(existsSync(join(s.sb.workspace, ".codaryn")), false, "doctor writes nothing");
}

test(`${MOCK_LABEL} U-6 doctor --json: 항목별 점검, 키 값·경로 없음, 요청 0건, 쓰기 없음`, { timeout: 60_000 }, async (t) => {
  const s = await doctorSetup(t);
  // `--task` names its own workspace; doctor refuses `--task` with `--workspace` (cli-contract usage).
  const run = await runGuarded(s.sb, doctorArgs({ config: s.configPath, varsFile: s.varsFile, task: s.taskPath }), cliEnv());
  const output = expectDoctorOutput(run);
  assert.equal(checkOf(output, "workspace").status, "ok", checkOf(output, "workspace").message);
  for (const id of ["node_version", "config_file", "vars_file", "task_file", "api_key", "model", "limits"] as const) {
    assert.equal(checkOf(output, id).status, "ok", `${id}: ${checkOf(output, id).message}`);
  }
  assertDoctorSilent(run, s);
});

test(`${MOCK_LABEL} U-6 doctor 기본 출력(글): 키 값·경로 없음, 종료 코드는 --json과 같다`, { timeout: 60_000 }, async (t) => {
  const s = await doctorSetup(t);
  const given = { config: s.configPath, varsFile: s.varsFile, task: s.taskPath };
  const json = expectDoctorOutput(await runGuarded(s.sb, doctorArgs(given), cliEnv()));
  const text = await runGuarded(s.sb, doctorArgs({ ...given, json: false }), cliEnv());
  assert.equal(text.exitCode, json.exitCode);
  assert.ok(text.stdout.trim().length > 0);
  assertDoctorSilent(text, s);
});

test(`${MOCK_LABEL} U-6 doctor가 문제를 항목으로 알린다(값은 쓰지 않음)`, { timeout: 120_000 }, async (t) => {
  await t.test("키 없음 → api_key가 ok가 아님", async (st) => {
    const s = await doctorSetup(st);
    const run = await runGuarded(s.sb, doctorArgs({ config: s.configPath, task: s.taskPath }), cliEnv());
    const output = expectDoctorOutput(run);
    assert.notEqual(checkOf(output, "api_key").status, "ok");
    assertDoctorSilent(run, s);
  });
  await t.test("PATH에서 풀리지 않는 허용 명령 → commands가 ok가 아니고 이름을 쓰지 않음", async (st) => {
    const s = await doctorSetup(st);
    const missing = "cdy-missing-tool-Q7k";
    const taskPath = writeTask(s.sb, { id: "k02-doctor-cmd", commands: [{ executable: missing, argsPrefix: [], allowExtraArgs: true }] }, [
      finalStep("끝"),
    ]);
    const run = await runGuarded(s.sb, doctorArgs({ task: taskPath }), cliEnv());
    const output = expectDoctorOutput(run);
    const commands = checkOf(output, "commands");
    assert.notEqual(commands.status, "ok");
    assert.equal(commands.message.includes(missing), false, "names are not echoed");
  });
  await t.test("없는 integrity.paths → integrity_paths fail, 경로를 쓰지 않음", async (st) => {
    const missing = "C:\\cdy-missing-material-Wq2";
    const s = await doctorSetup(st, { integrity: { paths: [process.platform === "win32" ? missing : "/cdy-missing-material-Wq2"] } });
    const run = await runGuarded(s.sb, doctorArgs({ config: s.configPath, workspace: s.sb.workspace }), cliEnv());
    const output = expectDoctorOutput(run);
    const check = checkOf(output, "integrity_paths");
    assert.equal(check.status, "fail");
    assert.equal(check.message.includes("cdy-missing-material"), false);
  });
  await t.test("볼 대상이 없으면 skipped", async (st) => {
    const sb = createSandbox(st);
    const output = expectDoctorOutput(await startCli(doctorArgs({}), { cwd: sb.base }).done);
    assert.equal(checkOf(output, "node_version").status, "ok");
    for (const id of ["config_file", "vars_file", "task_file"] as const) {
      assert.equal(checkOf(output, id).status, "skipped", id);
    }
  });
  await t.test("설치 위치 안의 작업 공간 → install_dir fail", async (st) => {
    const sb = createSandbox(st);
    const install = installCopy(sb);
    const run = await startCli(doctorArgs({ workspace: install.root }), { cwd: sb.base, cliPath: install.cliPath }).done;
    const output = expectDoctorOutput(run);
    assert.equal(checkOf(output, "install_dir").status, "fail");
    assert.equal(output.status, "fail");
  });
});

// ---------------------------------------------------------------- U-7

test("U-7 --help, --version, 명령별 도움말", { timeout: 60_000 }, async (t) => {
  const sb = createSandbox(t);
  const cli = (args: readonly string[]) => startCli(args, { cwd: sb.base }).done;
  const version = (JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { version: string }).version;

  await t.test("--help", async () => {
    const run = await cli(["--help"]);
    assert.equal(run.exitCode, 0);
    for (const command of ["run", "revert", "report", "doctor"]) {
      assert.ok(run.stdout.includes(command), `--help mentions ${command}`);
    }
  });
  await t.test("--version", async () => {
    const run = await cli(["--version"]);
    assert.equal(run.exitCode, 0);
    assert.ok(run.stdout.includes(version), `--version prints ${version}`);
  });
  for (const command of ["run", "revert", "report", "doctor"]) {
    await t.test(`${command} --help`, async () => {
      const run = await cli([command, "--help"]);
      assert.equal(run.exitCode, 0, run.stdout.slice(0, 300));
      assert.ok(run.stdout.trim().length > 0);
    });
  }
  await t.test("package.json bin.codaryn은 node 실행 줄로 시작하는 빌드 파일", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { bin?: Record<string, string> };
    const entry = pkg.bin?.["codaryn"];
    assert.ok(entry !== undefined, "bin.codaryn is declared");
    const file = join(REPO_ROOT, ...entry.split("/"));
    assert.ok(existsSync(file), "the entry file is built");
    assert.match(readFileSync(file, "utf8").split("\n")[0] ?? "", /^#!.*\bnode\b/);
  });
});

// ---------------------------------------------------------------- U-8

/** A run that reads a secret, prints it from a command, is denied once and sends a repair. */
function progressTask(sb: Sandbox): string {
  writeRepairProject(sb, { secret: FRAGMENT_SECRET });
  return writeTask(
    sb,
    {
      id: "k02-progress",
      secretEnv: [FAKE_SECRET_ENV_A],
      protectedPaths: ["test"],
      commands: [{ executable: NODE, argsPrefix: [NOISY_CHECK_PATH], allowExtraArgs: true }],
      limits: { maxRepairAttempts: 1 },
      verifiers: [{ id: "noisy", kind: "command", executable: NODE, args: [NOISY_CHECK_PATH, "60"], timeoutMs: 30_000 }],
    },
    [
      readStep("r-settings", SETTINGS_PATH),
      callStep("c-noisy", "run_command", { executable: NODE, args: [NOISY_CHECK_PATH, "20"] }),
      editStep("w-test", EDIT_WEAKEN_TEST),
      finalStep("끝났다"),
      finalStep("다시 끝났다"),
    ],
  );
}

test("U-8 진행 표시: stderr에 줄이 나오고 가짜 비밀·변형·조각이 없다, stdout은 JSON 한 줄", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  const taskPath = progressTask(sb);
  const run = await runTask(taskPath, { cwd: sb.base, env: cliEnv({ extra: { [FAKE_SECRET_ENV_A]: FRAGMENT_SECRET } }) });
  const result = expectRunResult(run);
  assert.equal(result.reason, "verifier_failed", "setup: the run went through a repair and failed");
  assertProgressClean(run, { secrets: [FRAGMENT_SECRET], fragmentSecrets: [FRAGMENT_SECRET] }, 3);
});

test("U-8 --quiet: stderr가 비고 결과는 같다", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  const taskPath = progressTask(sb);
  const run = await startCli(["run", "--task", taskPath, "--quiet"], {
    cwd: sb.base,
    env: cliEnv({ extra: { [FAKE_SECRET_ENV_A]: FRAGMENT_SECRET } }),
  }).done;
  const result = expectRunResult(run);
  assert.equal(result.reason, "verifier_failed");
  assertQuiet(run);
});

test(`${MOCK_LABEL} U-8 진행 표시에 가짜 키가 없다(가짜 서버 실행)`, { timeout: 60_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 연습\n");
  const api = await startFakeAnthropic(t, [replyTools([toolUse("toolu_r1", "read_file", { path: "README.md" })]), replyText("읽었다")]);
  const configPath = writeConfigFile(sb, fakeApiConfig(api.url, { model: FAKE_MODEL_CONFIG }));
  const taskPath = writeAnthropicTask(sb, {
    id: "k02-progress-mock",
    verifiers: [{ id: "readme", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] }],
  });
  const run = await runGuarded(sb, ["run", "--task", taskPath, "--config", configPath], cliEnv({ fakeApiKey: FAKE_API_KEY }));
  assert.equal(expectRunResult(run, "anthropic").status, "done");
  // Pieces of the fake key's readable start ("cdy-", "fake", "-api") also occur in ordinary text
  // such as ids and fake model names. Its random tail is the part whose pieces mean a leak.
  assertProgressClean(run, { secrets: [FAKE_API_KEY], fragmentSecrets: [FAKE_API_KEY.slice(-12)] }, 1);
});
