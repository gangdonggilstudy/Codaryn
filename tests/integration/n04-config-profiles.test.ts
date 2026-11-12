/**
 * N-E E-2, E-3, E-7, E-8 (docs/cli-contract.md 17.1 to 17.3) against the local fake server: the
 * config file order with the default location (N-1), the model placeholder (N-3), profiles (N-8)
 * and the one-line run (N-9). Mock API verification, not the real API: every name starts with
 * MOCK_LABEL, every run has the network guard, and only fake keys are used.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import {
  ANTHROPIC_KEY_REFUSAL_PATTERN_SOURCE,
  CODARYN_CONFIG_ENV,
  CODARYN_MODEL_ENV,
  MODEL_PLACEHOLDER,
  QUICK_TASK_ID,
  STATE_DIR_NAME,
} from "../../src/contracts/index.js";
import type { CliErrorCode } from "../../src/contracts/index.js";
import { ANTHROPIC_LIMITS, ANTHROPIC_REFUSED_SHAPE, fakeApiConfig, writeAnthropicTask, writeConfigFile } from "../fixtures/anthropic.js";
import { createSandbox, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { installCopy } from "../fixtures/self-dev.js";
import { FAKE_API_KEY } from "../fixtures/secrets.js";
import { cliEnv, expectCliError, expectRunResult, readRunFiles, startCli } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { checkOf, expectDoctorOutput } from "../support/commands.js";
import { MOCK_LABEL, messagesRequests, replyText, runGuarded, sentModels, startFakeAnthropic } from "../support/fake-anthropic.js";
import type { FakeAnthropic } from "../support/fake-anthropic.js";
import { assertNotPrinted, userConfigLocation, writeUserConfig } from "../support/usability.js";
import type { UserConfigLocation } from "../support/usability.js";

const README_EXISTS = [{ id: "readme", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] }];
const NEVER = [{ id: "never", kind: "file_rules", rules: [{ type: "contains", path: "README.md", text: "이 문구는 없다" }] }];
const DENY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };
const MODEL_ARG = "cdy-n04-model-argument";
const MODEL_ENV_FILE = "cdy-n04-model-environment";
const MODEL_DEFAULT = "cdy-n04-model-default";

interface Setup {
  readonly sb: Sandbox;
  readonly api: FakeAnthropic;
  readonly user: UserConfigLocation;
}

/** A sandbox with README.md, a fake server that answers `replies` times with text, and its user config location. */
async function setup(t: TestContext, replies = 1): Promise<Setup> {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 연습\n");
  const api = await startFakeAnthropic(t, Array.from({ length: replies }, () => replyText("끝")));
  return { sb, api, user: userConfigLocation(sb) };
}

/** A quick-form config for the fake server. */
function quickConfig(s: Setup, model: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return fakeApiConfig(s.api.url, { model, maxOutputTokens: 700, limits: ANTHROPIC_LIMITS, policy: DENY, verifiers: README_EXISTS, ...extra } as never);
}

function env(s: Setup, extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  return cliEnv({ fakeApiKey: FAKE_API_KEY, extra: { ...s.user.env, ...extra } });
}

function quick(s: Setup, extraArgs: readonly string[] = [], extraEnv: Readonly<Record<string, string>> = {}): Promise<CliRun> {
  return runGuarded(s.sb, ["run", "--workspace", s.sb.workspace, "--goal", "README를 확인한다", ...extraArgs], env(s, extraEnv));
}

function refusedBeforeSending(s: Setup, run: CliRun, code: CliErrorCode): void {
  expectCliError(run, code);
  assert.equal(messagesRequests(s.api).length, 0, "nothing is sent");
  assert.equal(existsSync(join(s.sb.workspace, STATE_DIR_NAME)), false, "no run directory");
}

/** Like runGuarded, but in `cwd` (the one-line run takes the current directory as its workspace). */
async function runIn(s: Setup, cwd: string, args: readonly string[], processEnv: NodeJS.ProcessEnv, cliPath?: string): Promise<CliRun> {
  const log = join(s.sb.base, "net-guard.log");
  const run = await startCli(args, { cwd, env: processEnv, netGuardLog: log, timeoutMs: 60_000, ...(cliPath === undefined ? {} : { cliPath }) }).done;
  const blocked = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((line) => line !== "") : [];
  assert.deepEqual(blocked, [], "the CLI tried to reach a host other than the local fake server");
  return run;
}

test(`${MOCK_LABEL} E-2 설정 파일 순서: --config > CODARYN_CONFIG > 기본 위치, 기본 위치를 쓰면 알린다`, { timeout: 90_000 }, async (t) => {
  const s = await setup(t, 3);
  const argPath = writeConfigFile(s.sb, quickConfig(s, MODEL_ARG), "arg.json");
  const envPath = writeConfigFile(s.sb, quickConfig(s, MODEL_ENV_FILE), "env.json");
  writeUserConfig(s.user, quickConfig(s, MODEL_DEFAULT));

  expectRunResult(await quick(s, ["--config", argPath], { [CODARYN_CONFIG_ENV]: envPath }), "anthropic");
  expectRunResult(await quick(s, [], { [CODARYN_CONFIG_ENV]: envPath }), "anthropic");
  const third = await quick(s);
  const result = expectRunResult(third, "anthropic");
  assert.deepEqual(sentModels(s.api), [MODEL_ARG, MODEL_ENV_FILE, MODEL_DEFAULT]);
  assert.ok(result.notices.some((notice) => notice.includes(s.user.display)), "the result says the default config was used");
  assert.ok(third.stderr.includes(s.user.display), "so does a progress line");
  assertNotPrinted(third, [s.user.root], "the expanded default location");
});

test(`${MOCK_LABEL} E-2 기본 위치의 거부와 부재`, { timeout: 90_000 }, async (t) => {
  await t.test("기본 위치가 작업 공간 안이면 invalid_config(S-1), 요청 0건", async (st) => {
    const s = await setup(st);
    const user = userConfigLocation(s.sb, join(s.sb.workspace, "appdata"));
    writeUserConfig(user, quickConfig(s, MODEL_DEFAULT));
    const run = await runGuarded(s.sb, ["run", "--workspace", s.sb.workspace, "--goal", "x"], cliEnv({ fakeApiKey: FAKE_API_KEY, extra: user.env }));
    expectCliError(run, "invalid_config");
    assert.equal(messagesRequests(s.api).length, 0);
  });

  await t.test("기본 위치 변수가 상대 경로면 기본 위치가 없는 것과 같다", async (st) => {
    const s = await setup(st);
    const relative: Record<string, string> = process.platform === "win32" ? { APPDATA: "relative\\appdata" } : { XDG_CONFIG_HOME: "relative/xdg", HOME: "" };
    const none = await runGuarded(s.sb, ["run", "--workspace", s.sb.workspace, "--goal", "x"], cliEnv({ fakeApiKey: FAKE_API_KEY, extra: relative }));
    const absent = await quick(s);
    const code = (run: CliRun): string => JSON.parse(run.stdout.trim()).code as string;
    assert.equal(code(none), code(absent), "a relative variable is treated as no default location");
    assert.equal(messagesRequests(s.api).length, 0);
  });
});

test(`${MOCK_LABEL} E-3 모델 자리표시자는 설정되지 않은 것으로 보고 다음 단계로 넘어간다(N-3)`, { timeout: 90_000 }, async (t) => {
  await t.test("CODARYN_MODEL이 자리표시자나 공백이면 설정 파일의 모델을 쓴다", async (st) => {
    const s = await setup(st, 2);
    writeUserConfig(s.user, quickConfig(s, MODEL_DEFAULT));
    expectRunResult(await quick(s, [], { [CODARYN_MODEL_ENV]: MODEL_PLACEHOLDER }), "anthropic");
    expectRunResult(await quick(s, [], { [CODARYN_MODEL_ENV]: "   " }), "anthropic");
    assert.deepEqual(sentModels(s.api), [MODEL_DEFAULT, MODEL_DEFAULT]);
  });

  await t.test("모두 자리표시자면 provider_not_configured, 요청 0건, doctor의 model은 fail", async (st) => {
    const s = await setup(st);
    writeUserConfig(s.user, quickConfig(s, MODEL_PLACEHOLDER));
    refusedBeforeSending(s, await quick(s, [], { [CODARYN_MODEL_ENV]: "<other placeholder>" }), "provider_not_configured");
    const doctor = expectDoctorOutput(await runGuarded(s.sb, ["doctor", "--json"], env(s)));
    assert.equal(checkOf(doctor, "model").status, "fail");
  });

  await t.test("task 파일의 자리표시자도 넘어간다", async (st) => {
    const s = await setup(st);
    const configPath = writeConfigFile(s.sb, quickConfig(s, MODEL_DEFAULT));
    const taskPath = writeAnthropicTask(s.sb, { id: "n04-task-placeholder", model: MODEL_PLACEHOLDER, verifiers: README_EXISTS as never });
    expectRunResult(await runGuarded(s.sb, ["run", "--task", taskPath, "--config", configPath], env(s)), "anthropic");
    assert.deepEqual(sentModels(s.api), [MODEL_DEFAULT]);
  });
});

test(`${MOCK_LABEL} E-7 프로필(N-8): 정책·검증기를 대신하고 한도를 덮는다, 상한과 이름 검사`, { timeout: 120_000 }, async (t) => {
  const profiles = {
    tight: { limits: { maxModelTurns: 1 } },
    strict: { verifiers: NEVER },
  };

  await t.test("--profile의 한도가 기록되고, 검증기는 프로필의 것이 쓰인다", async (st) => {
    const s = await setup(st, 2);
    writeUserConfig(s.user, quickConfig(s, MODEL_DEFAULT, { profiles }));
    const tight = expectRunResult(await quick(s, ["--profile", "tight"]), "anthropic");
    const started = readRunFiles(s.sb.workspace, tight).records[0];
    assert.ok(started?.type === "run_started" && started.limits.maxModelTurns === 1, "the profile's limit is the run's");
    const strict = expectRunResult(await quick(s, ["--profile", "strict"]), "anthropic");
    assert.deepEqual(strict.verifiers.map((verifier) => [verifier.id, verifier.outcome]), [["never", "fail"]]);
  });

  await t.test("쓰지 않는 프로필이라도 한도가 최상위보다 크면 invalid_config(S-7), 요청 0건", async (st) => {
    const s = await setup(st);
    const over = { loose: { limits: { maxModelTurns: ANTHROPIC_LIMITS.maxModelTurns + 1 } } };
    writeUserConfig(s.user, quickConfig(s, MODEL_DEFAULT, { profiles: over }));
    refusedBeforeSending(s, await quick(s), "invalid_config");
  });

  await t.test("없는 프로필은 invalid_config, 형식이 틀린 이름은 invalid_arguments", async (st) => {
    const s = await setup(st);
    writeUserConfig(s.user, quickConfig(s, MODEL_DEFAULT, { profiles }));
    refusedBeforeSending(s, await quick(s, ["--profile", "nope"]), "invalid_config");
    refusedBeforeSending(s, await quick(s, ["--profile", "../x"]), "invalid_arguments");
  });

  await t.test("task 파일은 프로필을 가질 수 없다(invalid_task), task 실행에는 프로필의 한도만 쓴다", async (st) => {
    const s = await setup(st);
    const configPath = writeConfigFile(s.sb, quickConfig(s, MODEL_DEFAULT, { profiles }));
    const bad = writeAnthropicTask(s.sb, { id: "n04-task-profiles", verifiers: README_EXISTS as never, extraTop: { profiles } });
    refusedBeforeSending(s, await runGuarded(s.sb, ["run", "--task", bad, "--config", configPath], env(s)), "invalid_task");
    const withProfiles = writeAnthropicTask(s.sb, { id: "n04-task-profiles", verifiers: README_EXISTS as never });

    const result = expectRunResult(await runGuarded(s.sb, ["run", "--task", withProfiles, "--config", configPath, "--profile", "strict"], env(s)), "anthropic");
    assert.deepEqual(result.verifiers.map((verifier) => verifier.id), ["readme"], "the task keeps its own verifiers");
  });
});

test(`${MOCK_LABEL} E-8 한 줄 실행(N-9): 현재 디렉터리가 작업 공간, 설치 위치·키·인자 거부`, { timeout: 120_000 }, async (t) => {
  await t.test("기본 설정으로 run \"<목표>\" → done, 목표가 모델에 간다", async (st) => {
    const s = await setup(st);
    writeUserConfig(s.user, quickConfig(s, MODEL_DEFAULT));
    const goal = "한 줄 실행으로 README를 확인한다";
    const run = await runIn(s, s.sb.workspace, ["run", goal], env(s));
    const result = expectRunResult(run, "anthropic");
    assert.equal(result.status, "done");
    assert.equal(result.taskId, QUICK_TASK_ID);
    readRunFiles(s.sb.workspace, result);
    assert.ok(messagesRequests(s.api)[0]?.bodyText.includes(JSON.stringify(goal).slice(1, -1)), "the goal reaches the model");
  });

  await t.test("현재 디렉터리가 설치 위치면 workspace_is_install_dir, 요청 0건", async (st) => {
    const s = await setup(st);
    writeUserConfig(s.user, quickConfig(s, MODEL_DEFAULT));
    const install = installCopy(s.sb);
    const run = await runIn(s, install.root, ["run", "설치 위치에서 실행"], env(s), install.cliPath);
    expectCliError(run, "workspace_is_install_dir");
    assert.equal(messagesRequests(s.api).length, 0);
  });

  await t.test("목표에 키 모양 값이 있으면 key_in_file, 요청 0건", async (st) => {
    const s = await setup(st);
    writeUserConfig(s.user, quickConfig(s, MODEL_DEFAULT));
    const keyShaped = ANTHROPIC_REFUSED_SHAPE;
    assert.ok(new RegExp(ANTHROPIC_KEY_REFUSAL_PATTERN_SOURCE).test(keyShaped), "test assumption: the value has the key shape");
    const run = await runIn(s, s.sb.workspace, ["run", `이 값을 쓴다 ${keyShaped}`], env(s));
    expectCliError(run, "key_in_file");
    assertNotPrinted(run, [keyShaped], "the key-shaped value");
    assert.equal(messagesRequests(s.api).length, 0);
  });

  await t.test("위치 인자와 --task·--workspace·--goal을 함께 쓰면 invalid_arguments", async (st) => {
    const s = await setup(st);
    writeUserConfig(s.user, quickConfig(s, MODEL_DEFAULT));
    const taskPath = writeAnthropicTask(s.sb, { id: "n04-mixed", verifiers: README_EXISTS as never });
    for (const extra of [["--task", taskPath], ["--workspace", s.sb.workspace], ["--goal", "y"]]) {
      expectCliError(await runIn(s, s.sb.workspace, ["run", "목표", ...extra], env(s)), "invalid_arguments");
    }
    assert.equal(messagesRequests(s.api).length, 0);
  });
});
