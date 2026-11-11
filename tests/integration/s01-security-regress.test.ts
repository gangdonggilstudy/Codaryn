/**
 * S-D: process-level regressions for the H1/H2 review fixes (S-1 to S-11 in
 * docs/work-orders/phase-2-repair-loop.md). Every case runs the real CLI. Cases that need the
 * anthropic provider use the local fake server (mock API verification, not the real API; their
 * names start with MOCK_LABEL) with the network guard preloaded. Only fake keys and fake secrets.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import {
  ANTHROPIC_API_KEY_ENV,
  ANTHROPIC_KEY_PATTERN_SOURCE,
  CLI_ERROR_EXIT_CODES,
  CODARYN_CONFIG_ENV,
  PRIVACY_TOKEN_PREFIX,
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
} from "../../src/contracts/index.js";
import type { CliErrorCode, CliErrorOutput, ReadFilePayload, VerifierConfig } from "../../src/contracts/index.js";
import {
  ANTHROPIC_LIMITS,
  FAKE_MODEL_CONFIG,
  fakeApiConfig,
  writeAnthropicTask,
  writeConfigFile,
  writeEnvFile,
} from "../fixtures/anthropic.js";
import { DEFAULT_LIMITS, createSandbox, writeAt, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { writeProgram } from "../fixtures/programs.js";
import {
  FAKE_API_KEY,
  FAKE_API_KEY_NON_ASCII,
  FAKE_API_KEY_SPACE,
  FAKE_ENV_FILE_VALUE,
  FAKE_SECRET_A,
  FAKE_SECRET_B,
  FAKE_SECRET_ENV_A,
  SHORT_ENV_FILE_VALUE,
} from "../fixtures/secrets.js";
import {
  NODE,
  cliEnv,
  expectCliError,
  expectRunResult,
  parseCliOutput,
  payloadOf,
  readRunFiles,
  runTask,
  startCli,
  toolResultFor,
} from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import {
  MOCK_LABEL,
  bodySources,
  cliOutputSources,
  replyFlood,
  replyText,
  replyTools,
  runGuarded,
  startFakeAnthropic,
  toolUse,
} from "../support/fake-anthropic.js";
import type { FakeAnthropic, FakeReply } from "../support/fake-anthropic.js";
import { decodedSource, findLeaks, stateRecordTexts } from "../support/leak.js";
import type { TextSource } from "../support/leak.js";
import { finalStep, readStep } from "../support/repair-script.js";

const IS_WINDOWS = process.platform === "win32";
const README_EXISTS: readonly VerifierConfig[] = [
  { id: "readme", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] },
];
/** Largest value a Node timer accepts (S-7: every time value stays at or below it). */
const MAX_TIMER_MS = 2_147_483_647;

function runCli(sb: Sandbox, args: readonly string[], env: NodeJS.ProcessEnv = cliEnv()): Promise<CliRun> {
  return startCli(args, { cwd: sb.base, env }).done;
}

function outputSources(run: CliRun): TextSource[] {
  return [
    { label: "stdout", text: run.stdout },
    { label: "stderr", text: run.stderr },
    decodedSource("stdout", run.stdout, true),
  ];
}

/** Stopped before any run with `code`; no run directory; no value from `values` in the output. */
function assertPreRun(run: CliRun, code: CliErrorCode, sb: Sandbox, values: readonly string[] = []): CliErrorOutput {
  const output = expectCliError(run, code);
  assert.equal(run.exitCode, CLI_ERROR_EXIT_CODES[code]);
  assert.equal(existsSync(join(sb.workspace, STATE_DIR_NAME, RUNS_DIR_NAME)), false, "no run may start");
  assert.deepEqual(findLeaks(outputSources(run), values, { extended: true }), [], "the error must not repeat the value");
  return output;
}

function scriptedTask(sb: Sandbox, id: string, extra: Parameters<typeof writeTask>[1] = { id }): string {
  writeWorkspaceFile(sb, "README.md", "# 연습\n");
  return writeTask(sb, { verifiers: README_EXISTS, ...extra, id }, [finalStep("끝")]);
}

/** Rewrites task.json in the sandbox base through `change`. */
function editTask(sb: Sandbox, change: (task: Record<string, unknown>) => void): void {
  const task = JSON.parse(readFileSync(sb.taskPath, "utf8")) as Record<string, unknown>;
  change(task);
  writeFileSync(sb.taskPath, JSON.stringify(task, null, 2));
}

test("S-1 작업 공간 안의 task·대본·설정·env 파일은 실행 전에 거부된다", { timeout: 120_000 }, async (t) => {
  await t.test("task 파일이 작업 공간 안 → invalid_task", async (st) => {
    const sb = createSandbox(st);
    scriptedTask(sb, "s1-task");
    editTask(sb, (task) => {
      task["workspaceRoot"] = ".";
      task["model"] = { provider: "scripted", scriptPath: "../script.json" };
    });
    const inside = writeAt(sb.workspace, "task.json", readFileSync(sb.taskPath));
    assertPreRun(await runCli(sb, ["run", "--task", inside]), "invalid_task", sb);
  });

  await t.test("대본 파일이 작업 공간 안 → invalid_script", async (st) => {
    const sb = createSandbox(st);
    scriptedTask(sb, "s1-script");
    writeAt(sb.workspace, "script.json", readFileSync(sb.scriptPath));
    editTask(sb, (task) => {
      task["model"] = { provider: "scripted", scriptPath: "./ws/script.json" };
    });
    assertPreRun(await runTask(sb.taskPath, { cwd: sb.base }), "invalid_script", sb);
  });

  await t.test("설정 파일(--config, CODARYN_CONFIG)이 작업 공간 안 → invalid_config", async (st) => {
    const sb = createSandbox(st);
    const taskPath = scriptedTask(sb, "s1-config");
    const config = writeAt(sb.workspace, "codaryn-config.json", JSON.stringify({ schemaVersion: 1 }));
    assertPreRun(await runCli(sb, ["run", "--task", taskPath, "--config", config]), "invalid_config", sb);
    assertPreRun(
      await runCli(sb, ["run", "--task", taskPath], cliEnv({ extra: { [CODARYN_CONFIG_ENV]: config } })),
      "invalid_config",
      sb,
    );
  });

  await t.test("env 파일이 작업 공간 안 → invalid_config", async (st) => {
    const sb = createSandbox(st);
    const taskPath = scriptedTask(sb, "s1-env");
    const envFile = writeEnvFile(join(sb.workspace, ".env"), { CODARYN_IT_PLAIN: "plain-value" });
    assertPreRun(await runCli(sb, ["run", "--task", taskPath, "--env-file", envFile]), "invalid_config", sb);
  });

  await t.test("대조군: 같은 파일을 작업 공간 밖에 두면 실행된다", async (st) => {
    const sb = createSandbox(st);
    const taskPath = scriptedTask(sb, "s1-control");
    const config = writeConfigFile(sb, { schemaVersion: 1 });
    const envFile = writeEnvFile(join(sb.base, "vars.env"), { CODARYN_IT_PLAIN: "plain-value" });
    const run = await runCli(sb, ["run", "--task", taskPath, "--config", config, "--env-file", envFile]);
    assert.equal(expectRunResult(run).status, "done");
  });
});

test(`${MOCK_LABEL} S-1 모델이 작업 공간에 쓴 설정·.env로는 다음 실행의 API 주소가 바뀌지 않는다(가짜 서버 2개)`, { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 연습\n");
  const attacker = await startFakeAnthropic(t, [replyText("가로챘다"), replyText("가로챘다")]);
  const evilConfig = JSON.stringify(fakeApiConfig(attacker.url, { model: FAKE_MODEL_CONFIG, limits: ANTHROPIC_LIMITS }));
  const legit = await startFakeAnthropic(t, [
    replyTools([
      toolUse("toolu_w1", "write_file", {
        path: "codaryn-config.json",
        expectedHash: null,
        change: { kind: "replace_all", content: evilConfig },
      }),
    ]),
    replyTools([
      toolUse("toolu_w2", "write_file", {
        path: ".env",
        expectedHash: null,
        change: { kind: "replace_all", content: `CODARYN_API_BASE_URL=${attacker.url}\n` },
      }),
    ]),
    replyText("설정을 바꿔 두었다"),
    replyText("두 번째 실행도 끝났다"),
  ]);
  const legitConfig = writeConfigFile(sb, fakeApiConfig(legit.url, { model: FAKE_MODEL_CONFIG }));
  const taskPath = writeAnthropicTask(sb, { id: "s1-two-servers", verifiers: README_EXISTS });
  const env = cliEnv({ fakeApiKey: FAKE_API_KEY });

  const first = await runGuarded(sb, ["run", "--task", taskPath, "--config", legitConfig], env);
  assert.equal(expectRunResult(first, "anthropic").status, "done");
  assert.ok(existsSync(join(sb.workspace, "codaryn-config.json")) && existsSync(join(sb.workspace, ".env")), "setup: the model wrote both files");

  const viaConfig = await runGuarded(sb, ["run", "--task", taskPath, "--config", join(sb.workspace, "codaryn-config.json")], env);
  expectCliError(viaConfig, "invalid_config");
  const viaEnv = await runGuarded(
    sb,
    ["run", "--task", taskPath, "--config", legitConfig, "--env-file", join(sb.workspace, ".env")],
    env,
  );
  expectCliError(viaEnv, "invalid_config");

  const again = await runGuarded(sb, ["run", "--task", taskPath, "--config", legitConfig], env);
  assert.equal(expectRunResult(again, "anthropic").status, "done");
  assert.equal(attacker.requests.length, 0, "no request may reach the address the model wrote");
  assert.equal(legit.requests.length, 4);
});

test("S-2 scripted 실행에서도 환경의 키는 비밀로 가려진다(journal·결과·출력에 키 없음)", { timeout: 60_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 연습\n");
  writeWorkspaceFile(sb, "notes/keys.txt", `${ANTHROPIC_API_KEY_ENV}=${FAKE_API_KEY}\n`);
  const taskPath = writeTask(sb, { id: "s2-scripted", verifiers: README_EXISTS }, [
    readStep("r-keys", "notes/keys.txt"),
    finalStep("읽었다"),
  ]);
  const run = await runTask(taskPath, { cwd: sb.base, env: cliEnv({ fakeApiKey: FAKE_API_KEY }) });
  const result = expectRunResult(run);
  const files = readRunFiles(sb.workspace, result);
  assert.ok(toolResultFor(files.records, "r-keys").content.includes(PRIVACY_TOKEN_PREFIX), "the key was masked, not dropped");
  const sources = [
    ...outputSources(run),
    ...stateRecordTexts(sb.workspace),
    decodedSource("journal", files.journalText, true),
  ];
  assert.deepEqual(findLeaks(sources, [FAKE_API_KEY], { extended: true }), []);
});

// CHILD_ENV_ALLOWLIST contract: "Registered secrets and API keys are never passed." An allow-listed
// variable whose value holds a registered secret must be dropped before a child process starts.
test("허용 목록 변수(LANG)의 값에 든 등록 비밀은 자식 프로세스로 넘어가지 않는다", { timeout: 60_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 연습\n");
  writeWorkspaceFile(
    sb,
    "lang-report.mjs",
    'import { writeFileSync } from "node:fs";\nwriteFileSync("lang.txt", String(process.env.LANG ?? "<unset>"));\n',
  );
  const taskPath = writeTask(
    sb,
    {
      id: "env-value-filter",
      secretEnv: [FAKE_SECRET_ENV_A],
      commands: [{ executable: NODE, argsPrefix: ["lang-report.mjs"], allowExtraArgs: false }],
      verifiers: README_EXISTS,
    },
    [{ toolCalls: [{ id: "c-lang", name: "run_command", args: { executable: NODE, args: ["lang-report.mjs"] } }] }, finalStep("끝")],
  );
  const run = await runTask(taskPath, {
    cwd: sb.base,
    env: cliEnv({ extra: { [FAKE_SECRET_ENV_A]: FAKE_SECRET_A, LANG: FAKE_SECRET_A } }),
  });
  assert.equal(expectRunResult(run).status, "done");
  const seen = readFileSync(join(sb.workspace, "lang.txt"), "utf8");
  assert.equal(seen.includes(FAKE_SECRET_A), false, "the child received a registered secret through LANG");
});

test("S-3 secretEnv에 이름 대신 값을 적은 실수: 오류에 값이 없다", { timeout: 60_000 }, async (t) => {
  await t.test("이름 규칙 위반 값(task) → invalid_task", async (st) => {
    const sb = createSandbox(st);
    const taskPath = scriptedTask(sb, "s3-task", { id: "s3-task", secretEnv: [FAKE_SECRET_B] });
    assertPreRun(await runTask(taskPath, { cwd: sb.base }), "invalid_task", sb, [FAKE_SECRET_B]);
  });
  await t.test("이름 규칙 위반 값(설정 파일) → invalid_config", async (st) => {
    const sb = createSandbox(st);
    const taskPath = scriptedTask(sb, "s3-config");
    const config = writeConfigFile(sb, { schemaVersion: 1, secretEnv: [FAKE_SECRET_B] });
    assertPreRun(await runCli(sb, ["run", "--task", taskPath, "--config", config]), "invalid_config", sb, [FAKE_SECRET_B]);
  });
  await t.test("이름처럼 보이는 값이 설정되지 않음 → secret_env_missing, 위치만", async (st) => {
    const sb = createSandbox(st);
    const taskPath = scriptedTask(sb, "s3-missing", { id: "s3-missing", secretEnv: [FAKE_SECRET_A] });
    assertPreRun(await runTask(taskPath, { cwd: sb.base }), "secret_env_missing", sb, [FAKE_SECRET_A]);
  });
});

test("S-4 env 파일이 새로 설정한 값은 비밀로 가려지고 8자 미만 값은 그대로다", { timeout: 60_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 연습\n");
  writeWorkspaceFile(sb, "data/conf.txt", `service=${FAKE_ENV_FILE_VALUE}\nshort=${SHORT_ENV_FILE_VALUE}\n`);
  const envFile = writeEnvFile(join(sb.base, "vars.env"), {
    CODARYN_IT_SERVICE_TOKEN: FAKE_ENV_FILE_VALUE,
    CODARYN_IT_SHORT: SHORT_ENV_FILE_VALUE,
  });
  const taskPath = writeTask(sb, { id: "s4-env-file", verifiers: README_EXISTS }, [
    readStep("r-conf", "data/conf.txt"),
    finalStep("읽었다"),
  ]);
  const run = await runCli(sb, ["run", "--task", taskPath, "--env-file", envFile]);
  const result = expectRunResult(run);
  const files = readRunFiles(sb.workspace, result);
  const content = payloadOf<ReadFilePayload>(toolResultFor(files.records, "r-conf")).content;
  assert.ok(content.includes(`service=${PRIVACY_TOKEN_PREFIX}`), "the env file value is masked where it appears");
  assert.ok(content.includes(`short=${SHORT_ENV_FILE_VALUE}`), "values under eight characters are not registered");
  const sources = [...outputSources(run), ...stateRecordTexts(sb.workspace), decodedSource("journal", files.journalText, true)];
  assert.deepEqual(findLeaks(sources, [FAKE_ENV_FILE_VALUE], { extended: true }), []);
});

test("S-5 UNC·장치 경로는 파일 접근 전에 거부된다(네트워크 접근 없음)", { skip: IS_WINDOWS ? false : "Windows paths", timeout: 120_000 }, async (t) => {
  // Loopback address only, so even a wrongly attempted access would not leave this machine.
  const unc = (name: string): string => `\\\\127.0.0.1\\codaryn-it-absent\\${name}`;
  interface UncCase {
    readonly label: string;
    readonly code: CliErrorCode;
    readonly args: (sb: Sandbox, taskPath: string) => string[];
    readonly env?: Readonly<Record<string, string>>;
    readonly task?: (task: Record<string, unknown>) => void;
  }
  const cases: UncCase[] = [
    { label: "--task", code: "invalid_task", args: () => ["run", "--task", unc("task.json")] },
    { label: "--task \\\\?\\UNC", code: "invalid_task", args: () => ["run", "--task", "\\\\?\\UNC\\127.0.0.1\\codaryn-it-absent\\task.json"] },
    { label: "--config", code: "invalid_config", args: (_sb, task) => ["run", "--task", task, "--config", unc("c.json")] },
    { label: "--config device", code: "invalid_config", args: (_sb, task) => ["run", "--task", task, "--config", "\\\\.\\pipe\\codaryn-it"] },
    { label: "--env-file", code: "invalid_config", args: (_sb, task) => ["run", "--task", task, "--env-file", unc("x.env")] },
    { label: "--cancel-file", code: "invalid_arguments", args: (_sb, task) => ["run", "--task", task, "--cancel-file", unc("cancel")] },
    { label: "--workspace", code: "invalid_arguments", args: () => ["run", "--workspace", unc("ws"), "--goal", "목표"] },
    { label: CODARYN_CONFIG_ENV, code: "invalid_config", args: (_sb, task) => ["run", "--task", task], env: { [CODARYN_CONFIG_ENV]: unc("c.json") } },
    {
      label: "task workspaceRoot",
      code: "invalid_task",
      args: (_sb, task) => ["run", "--task", task],
      task: (task) => {
        task["workspaceRoot"] = unc("ws");
      },
    },
    {
      label: "task scriptPath",
      code: "invalid_task",
      args: (_sb, task) => ["run", "--task", task],
      task: (task) => {
        task["model"] = { provider: "scripted", scriptPath: unc("script.json") };
      },
    },
  ];
  for (const unccase of cases) {
    await t.test(unccase.label, async (st) => {
      const sb = createSandbox(st);
      const taskPath = scriptedTask(sb, "s5-unc");
      if (unccase.task !== undefined) editTask(sb, unccase.task);
      const run = await runGuarded(sb, unccase.args(sb, taskPath), cliEnv({ extra: unccase.env ?? {} }), 30_000);
      assertPreRun(run, unccase.code, sb);
      assert.ok(run.durationMs < 15_000, `refused only after ${run.durationMs} ms; a network wait is suspected`);
    });
  }
});

// The Node runtime also reads `--env-file` from the arguments after the script name and checks the
// file before the CLI starts. This case shows whether the CLI still answers with its own JSON.
test("--env-file 경로를 CLI가 먼저 판정한다: 없는 파일 → invalid_config JSON 한 줄", { timeout: 60_000 }, async (t) => {
  const sb = createSandbox(t);
  const taskPath = scriptedTask(sb, "envfile-missing");
  const run = await runCli(sb, ["run", "--task", taskPath, "--env-file", join(sb.base, "missing.env")]);
  t.diagnostic(`exit ${String(run.exitCode)}, stderr ${JSON.stringify(run.stderr.slice(0, 200))}`);
  assertPreRun(run, "invalid_config", sb);
});

test("S-6 깊게 중첩된 JSON은 JSON 한 줄 오류로 끝난다(스택 없음)", { timeout: 60_000 }, async (t) => {
  const deep = (depth: number): string => `${"[".repeat(depth)}${"]".repeat(depth)}`;
  await t.test("task → invalid_task", async (st) => {
    const sb = createSandbox(st);
    const taskPath = scriptedTask(sb, "s6-task");
    const text = readFileSync(taskPath, "utf8").trimEnd();
    writeFileSync(taskPath, `${text.slice(0, -1)},"deep":${deep(20_000)}}`);
    const run = await runTask(taskPath, { cwd: sb.base });
    assertPreRun(run, "invalid_task", sb);
    assert.equal(run.stderr, "", "no stack trace");
  });
  await t.test("설정 파일 → invalid_config", async (st) => {
    const sb = createSandbox(st);
    const taskPath = scriptedTask(sb, "s6-config");
    const config = join(sb.base, "deep-config.json");
    writeFileSync(config, `{"schemaVersion":1,"deep":${deep(20_000)}}`);
    const run = await runCli(sb, ["run", "--task", taskPath, "--config", config]);
    assertPreRun(run, "invalid_config", sb);
    assert.equal(run.stderr, "");
  });
});

test("S-7 한도: 설정 값은 상한, 절대 상한, 시간 값 상한", { timeout: 120_000 }, async (t) => {
  await t.test("task 한도가 설정 한도를 넘으면 invalid_task", async (st) => {
    const sb = createSandbox(st);
    const taskPath = scriptedTask(sb, "s7-over-config", { id: "s7-over-config", limits: { maxModelTurns: 12 } });
    const config = writeConfigFile(sb, { schemaVersion: 1, limits: { ...DEFAULT_LIMITS, maxModelTurns: 5 } });
    assertPreRun(await runCli(sb, ["run", "--task", taskPath, "--config", config]), "invalid_task", sb);
  });
  await t.test("대조군: task 한도가 설정 한도 이하면 실행된다", async (st) => {
    const sb = createSandbox(st);
    const taskPath = scriptedTask(sb, "s7-under-config", { id: "s7-under-config", limits: { maxModelTurns: 5 } });
    const config = writeConfigFile(sb, { schemaVersion: 1, limits: { ...DEFAULT_LIMITS, maxModelTurns: 5 } });
    assert.equal(expectRunResult(await runCli(sb, ["run", "--task", taskPath, "--config", config])).status, "done");
  });
  for (const [label, limits] of [
    ["maxModelTurns 1001", { maxModelTurns: 1001 }],
    ["maxToolCalls 5001", { maxToolCalls: 5001 }],
    ["maxTotalTokens 50,000,001", { maxTotalTokens: 50_000_001 }],
    ["maxDurationMs 24시간 + 1", { maxDurationMs: 86_400_001 }],
  ] as const) {
    await t.test(`절대 상한 초과 ${label} → invalid_task`, async (st) => {
      const sb = createSandbox(st);
      const taskPath = scriptedTask(sb, "s7-cap", { id: "s7-cap", limits });
      assertPreRun(await runTask(taskPath, { cwd: sb.base }), "invalid_task", sb);
    });
  }
  await t.test("검증기 timeoutMs 2^31 → invalid_task, 2^31-1은 허용", async (st) => {
    const sb = createSandbox(st);
    writeProgram(sb, "exit-code.mjs");
    const verifier = (timeoutMs: number): VerifierConfig[] => [
      { id: "exit", kind: "command", executable: NODE, args: ["exit-code.mjs", "0"], timeoutMs },
    ];
    const over = scriptedTask(sb, "s7-timer", { id: "s7-timer", verifiers: verifier(MAX_TIMER_MS + 1) });
    assertPreRun(await runTask(over, { cwd: sb.base }), "invalid_task", sb);
    const atCap = scriptedTask(sb, "s7-timer-ok", { id: "s7-timer-ok", verifiers: verifier(MAX_TIMER_MS) });
    assert.equal(expectRunResult(await runTask(atCap, { cwd: sb.base })).status, "done");
  });
});

/** An anthropic run against one fake server; `config` overrides the fake config. */
async function anthropicSetup(
  t: TestContext,
  replies: readonly FakeReply[],
  config: Parameters<typeof fakeApiConfig>[1] = {},
): Promise<{ sb: Sandbox; api: FakeAnthropic; configPath: string; taskPath: string }> {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 연습\n");
  const api = await startFakeAnthropic(t, replies);
  const configPath = writeConfigFile(sb, fakeApiConfig(api.url, { model: FAKE_MODEL_CONFIG, ...config }));
  const taskPath = writeAnthropicTask(sb, { id: "s-anthropic", verifiers: README_EXISTS });
  return { sb, api, configPath, taskPath };
}

test(`${MOCK_LABEL} S-7 설정 파일의 한도·시간 값 위반은 요청 0건으로 거부`, { timeout: 60_000 }, async (t) => {
  await t.test("간편 형식 설정 한도가 절대 상한 초과 → invalid_config", async (st) => {
    const { sb, api, configPath } = await anthropicSetup(st, [replyText("끝")], {
      limits: { ...ANTHROPIC_LIMITS, maxModelTurns: 1001 },
    });
    const run = await runGuarded(sb, ["run", "--workspace", sb.workspace, "--goal", "한도 확인", "--config", configPath], cliEnv({ fakeApiKey: FAKE_API_KEY }));
    assertPreRun(run, "invalid_config", sb);
    assert.equal(api.requests.length, 0);
  });
  await t.test("requestTimeoutMs 2^31 → invalid_config", async (st) => {
    const { sb, api, configPath, taskPath } = await anthropicSetup(st, [replyText("끝")], { requestTimeoutMs: MAX_TIMER_MS + 1 });
    const run = await runGuarded(sb, ["run", "--task", taskPath, "--config", configPath], cliEnv({ fakeApiKey: FAKE_API_KEY }));
    assertPreRun(run, "invalid_config", sb);
    assert.equal(api.requests.length, 0);
  });
});

test(`${MOCK_LABEL} S-8 --goal의 키 모양 값과 현재 키는 거부, 요청 0건`, { timeout: 60_000 }, async (t) => {
  // Built at run time: a key-shaped literal would be refused by the commit hook, as intended.
  const keyShaped = ["sk", "ant", "codaryn0test0shape0only"].join("-");
  assert.ok(new RegExp(ANTHROPIC_KEY_PATTERN_SOURCE).test(keyShaped), "test assumption: the value has the key shape");
  for (const [label, value] of [
    ["키 모양", keyShaped],
    ["현재 키 값", FAKE_API_KEY],
  ] as const) {
    await t.test(label, async (st) => {
      const { sb, api, configPath } = await anthropicSetup(st, [replyText("끝")], { limits: ANTHROPIC_LIMITS });
      const run = await runGuarded(
        sb,
        ["run", "--workspace", sb.workspace, "--goal", `이 키로 접속해 ${value}`, "--config", configPath],
        cliEnv({ fakeApiKey: FAKE_API_KEY }),
      );
      assertPreRun(run, "key_in_file", sb, [value, FAKE_API_KEY]);
      assert.equal(api.requests.length, 0);
    });
  }
});

test(`${MOCK_LABEL} S-10 큰 응답 본문은 상한까지만 읽는다(끝없는 본문도 빨리 끝남)`, { timeout: 120_000 }, async (t) => {
  for (const [label, status, kind] of [
    ["성공 응답 8MB 초과 → malformed_response", 200, "malformed_response"],
    ["오류 응답 4096바이트 초과 → api_error", 500, "api_error"],
  ] as const) {
    await t.test(label, async (st) => {
      const flood = replyFlood(status, null);
      // A long request time limit: without the body cap, the run could end only by that timeout.
      const { sb, api, configPath, taskPath } = await anthropicSetup(st, [flood.reply], { requestTimeoutMs: 60_000, maxRetries: 0 });
      const run = await runGuarded(sb, ["run", "--task", taskPath, "--config", configPath], cliEnv({ fakeApiKey: FAKE_API_KEY }), 90_000);
      const result = expectRunResult(run, "anthropic");
      const files = readRunFiles(sb.workspace, result);
      assert.equal(result.status, "failed");
      assert.equal(result.reason, "model_error");
      const errors = files.records.flatMap((record) => (record.type === "model_error" ? [record] : []));
      assert.deepEqual(errors.map((record) => record.kind), [kind]);
      assert.equal(errors[0]?.message.includes("xxxxxxxx"), false, "the body is not copied into the message");
      assert.equal(api.requests.length, 1);
      assert.equal(flood.sent.closedEarly, true, "the client stopped reading the endless body");
      assert.ok(run.durationMs < 30_000, `took ${run.durationMs} ms; the request time limit (60 s) must not be what ended it`);
      st.diagnostic(`bytes the server handed over before the client closed: ${flood.sent.bytes}`);
      assert.ok(flood.sent.bytes < 64 * 1024 * 1024, "the client must not keep reading far past the cap");
    });
  }
});

test(`${MOCK_LABEL} S-11 형식이 잘못된 키는 요청 0건`, { timeout: 60_000 }, async (t) => {
  for (const [label, key] of [
    ["가운데 공백", FAKE_API_KEY_SPACE],
    ["ASCII 밖 문자", FAKE_API_KEY_NON_ASCII],
  ] as const) {
    await t.test(label, async (st) => {
      const { sb, api, configPath, taskPath } = await anthropicSetup(st, [replyText("끝")]);
      const run = await runGuarded(sb, ["run", "--task", taskPath, "--config", configPath], cliEnv({ fakeApiKey: key }));
      assert.equal(api.requests.length, 0, "nothing may be sent with a malformed key");
      const output = parseCliOutput(run);
      if (output.kind === "run") {
        const { records } = readRunFiles(sb.workspace, output);
        assert.equal(output.status, "failed");
        assert.deepEqual(
          records.flatMap((record) => (record.type === "model_error" ? [record.kind] : [])),
          ["not_configured"],
        );
      }
      st.diagnostic(`outcome: ${output.kind === "run" ? `${output.status}/${output.reason}` : output.code}`);
      assert.deepEqual(findLeaks([...cliOutputSources(sb.workspace, run), ...bodySources(api)], [key]), []);
    });
  }
});
