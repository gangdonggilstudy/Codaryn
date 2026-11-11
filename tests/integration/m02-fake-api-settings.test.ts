/**
 * 모의 API 검증 (실제 API 아님), E3 (d)(e)(f)(g)(j): settings decided before anything is sent.
 * Every case starts a local fake Messages API server and counts what reaches it. A refused run
 * must leave the server with zero requests and the workspace without a run directory.
 * Decisions C-1 to C-6 of docs/work-orders/phase-1b-config.md. Only fake keys and fake values.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import {
  ANTHROPIC_API_KEY_ENV,
  CLI_ERROR_EXIT_CODES,
  CODARYN_API_BASE_URL_ENV,
  CODARYN_CONFIG_ENV,
  CODARYN_MODEL_ENV,
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
} from "../../src/contracts/index.js";
import type { CliErrorCode, CliErrorOutput, EngineResult, VerifierConfig } from "../../src/contracts/index.js";
import {
  FAKE_MODEL_CONFIG,
  FAKE_MODEL_DECOY,
  FAKE_MODEL_ENV,
  FAKE_MODEL_ENV_FILE,
  FAKE_MODEL_TASK,
  fakeApiConfig,
  writeAnthropicTask,
  writeConfigFile,
  writeEnvFile,
} from "../fixtures/anthropic.js";
import { ANTHROPIC_LIMITS } from "../fixtures/anthropic.js";
import type { AnthropicTaskOptions } from "../fixtures/anthropic.js";
import { DEFAULT_LIMITS, createSandbox, withBom, writeAt, writeWorkspaceFile } from "../fixtures/builders.js";
import { FAKE_API_KEY, FAKE_API_KEY_DECOY, FAKE_API_KEY_ENV_FILE } from "../fixtures/secrets.js";
import { cliEnv, expectRunResult, parseCliOutput, readRunFiles } from "../support/cli.js";
import {
  MOCK_LABEL,
  assertProtocolClean,
  bodySources,
  cliOutputSources,
  otherHeaderSources,
  replyText,
  runGuarded,
  sentMaxTokens,
  sentModels,
  startFakeAnthropic,
} from "../support/fake-anthropic.js";
import type { FakeAnthropic, GuardedRun } from "../support/fake-anthropic.js";
import { findLeaks } from "../support/leak.js";

const README_EXISTS: readonly VerifierConfig[] = [
  { id: "readme", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] },
];

/** The CLI stopped before any run: an error object, no request at any server, no run directory. */
function assertRefusedBeforeSending(
  run: GuardedRun,
  servers: readonly FakeAnthropic[],
  workspace: string,
  codes: readonly CliErrorCode[],
  mustNotMention: readonly string[] = [],
): CliErrorOutput {
  const output = parseCliOutput(run);
  if (output.kind !== "error") {
    assert.fail(`expected a CLI error before any request, got a run that ended ${output.status}/${output.reason}`);
  }
  assert.ok(codes.includes(output.code), `error code ${output.code} is not one of ${codes.join(", ")}`);
  assert.equal(output.exitCode, CLI_ERROR_EXIT_CODES[output.code]);
  for (const server of servers) assert.equal(server.requests.length, 0, "no request may reach the server");
  assert.equal(existsSync(join(workspace, STATE_DIR_NAME, RUNS_DIR_NAME)), false, "no run directory may be created");
  for (const value of [FAKE_API_KEY, ...mustNotMention]) {
    assert.ok(!output.message.includes(value) && !run.stderr.includes(value), "the error must not repeat a key value");
  }
  return output;
}

test(`${MOCK_LABEL} E3-d 키·모델·출력 상한·한도가 없으면 요청 0건으로 거부`, { timeout: 120_000 }, async (t) => {
  await t.test("no ANTHROPIC_API_KEY -> provider_not_configured", async (st) => {
    const sb = createSandbox(st);
    const api = await startFakeAnthropic(st, [replyText("끝")]);
    const configPath = writeConfigFile(sb, fakeApiConfig(api.url, { model: FAKE_MODEL_CONFIG }));
    const taskPath = writeAnthropicTask(sb, { id: "m02-no-key" });
    const run = await runGuarded(sb, ["run", "--task", taskPath, "--config", configPath], cliEnv());
    assertRefusedBeforeSending(run, [api], sb.workspace, ["provider_not_configured"]);
  });

  await t.test("no model in task, CODARYN_MODEL or config -> provider_not_configured", async (st) => {
    const sb = createSandbox(st);
    const api = await startFakeAnthropic(st, [replyText("끝")]);
    const configPath = writeConfigFile(sb, fakeApiConfig(api.url));
    const taskPath = writeAnthropicTask(sb, { id: "m02-no-model" });
    const run = await runGuarded(sb, ["run", "--task", taskPath, "--config", configPath], cliEnv({ fakeApiKey: FAKE_API_KEY }));
    assertRefusedBeforeSending(run, [api], sb.workspace, ["provider_not_configured"]);
  });

  await t.test("no output token cap in task or config -> provider_not_configured", async (st) => {
    const sb = createSandbox(st);
    const api = await startFakeAnthropic(st, [replyText("끝")]);
    const configPath = writeConfigFile(sb, fakeApiConfig(api.url, {}, ["maxOutputTokens"]));
    const taskPath = writeAnthropicTask(sb, { id: "m02-no-cap", model: FAKE_MODEL_TASK });
    const run = await runGuarded(sb, ["run", "--task", taskPath, "--config", configPath], cliEnv({ fakeApiKey: FAKE_API_KEY }));
    assertRefusedBeforeSending(run, [api], sb.workspace, ["provider_not_configured"]);
  });

  await t.test("no limits in task or config -> invalid_task", async (st) => {
    const sb = createSandbox(st);
    const api = await startFakeAnthropic(st, [replyText("끝")]);
    const configPath = writeConfigFile(sb, fakeApiConfig(api.url, { model: FAKE_MODEL_CONFIG }));
    const taskPath = writeAnthropicTask(sb, { id: "m02-no-limits", limits: "omit" });
    const run = await runGuarded(sb, ["run", "--task", taskPath, "--config", configPath], cliEnv({ fakeApiKey: FAKE_API_KEY }));
    assertRefusedBeforeSending(run, [api], sb.workspace, ["invalid_task"]);
  });

  await t.test("maxTotalTokens set in neither file (not even null) -> invalid_task", async (st) => {
    const sb = createSandbox(st);
    const api = await startFakeAnthropic(st, [replyText("끝")]);
    const configPath = writeConfigFile(sb, fakeApiConfig(api.url, { model: FAKE_MODEL_CONFIG }));
    const { maxModelTurns, maxToolCalls, maxDurationMs } = DEFAULT_LIMITS;
    const taskPath = writeAnthropicTask(sb, { id: "m02-no-token-limit", limits: { maxModelTurns, maxToolCalls, maxDurationMs } });
    const run = await runGuarded(sb, ["run", "--task", taskPath, "--config", configPath], cliEnv({ fakeApiKey: FAKE_API_KEY }));
    assertRefusedBeforeSending(run, [api], sb.workspace, ["invalid_task"]);
  });

  await t.test("quick form without limits in the config -> invalid_config", async (st) => {
    const sb = createSandbox(st);
    const api = await startFakeAnthropic(st, [replyText("끝")]);
    const configPath = writeConfigFile(sb, fakeApiConfig(api.url, { model: FAKE_MODEL_CONFIG }));
    const run = await runGuarded(
      sb,
      ["run", "--workspace", sb.workspace, "--goal", "한도 없이 실행해 본다", "--config", configPath],
      cliEnv({ fakeApiKey: FAKE_API_KEY }),
    );
    assertRefusedBeforeSending(run, [api], sb.workspace, ["invalid_config"]);
  });

  await t.test("control: limits from the config file alone are enough to run", async (st) => {
    const sb = createSandbox(st);
    writeWorkspaceFile(sb, "README.md", "# 문서\n");
    const api = await startFakeAnthropic(st, [replyText("끝")]);
    // S-7: config limits for anthropic carry a numeric token limit.
    const configPath = writeConfigFile(sb, fakeApiConfig(api.url, { model: FAKE_MODEL_CONFIG, limits: ANTHROPIC_LIMITS }));
    const taskPath = writeAnthropicTask(sb, { id: "m02-config-limits", limits: "omit", verifiers: README_EXISTS });
    const run = await runGuarded(sb, ["run", "--task", taskPath, "--config", configPath], cliEnv({ fakeApiKey: FAKE_API_KEY }));
    const result = expectRunResult(run, "anthropic");
    readRunFiles(sb.workspace, result);
    assert.equal(result.status, "done");
    assert.equal(api.requests.length, 1);
    assertProtocolClean(api);
  });
});

test(`${MOCK_LABEL} E3-e task·설정 파일의 키 필드와 키 값은 key_in_file, 요청 0건`, { timeout: 120_000 }, async (t) => {
  interface KeyCase {
    readonly name: string;
    readonly task?: Partial<AnthropicTaskOptions>;
    readonly config?: Readonly<Record<string, unknown>>;
    /** Values that the error message must not repeat. */
    readonly values: readonly string[];
  }
  const cases: readonly KeyCase[] = [
    { name: "task model.apiKey", task: { extraModel: { apiKey: "cdy-field-value-1" } }, values: ["cdy-field-value-1"] },
    {
      name: "task nested Access-Token (normalised name, depth 2)",
      task: { extraTop: { metadata: { "Access-Token": "cdy-field-value-2" } } },
      values: ["cdy-field-value-2"],
    },
    { name: "config apiKey", config: { apiKey: "cdy-field-value-3" }, values: ["cdy-field-value-3"] },
    {
      name: "config nested X-Api-Key",
      config: { headers: { "X-Api-Key": "cdy-field-value-4" } },
      values: ["cdy-field-value-4"],
    },
    { name: "task holds the current key value in another field", task: { goal: `설정 확인 ${FAKE_API_KEY}` }, values: [] },
    { name: "config holds the current key value in another field", config: { model: FAKE_API_KEY }, values: [] },
  ];
  for (const keyCase of cases) {
    await t.test(keyCase.name, async (st) => {
      const sb = createSandbox(st);
      const api = await startFakeAnthropic(st, [replyText("끝")]);
      const configPath = writeConfigFile(sb, { ...fakeApiConfig(api.url, { model: FAKE_MODEL_CONFIG }), ...keyCase.config });
      const taskPath = writeAnthropicTask(sb, { id: "m02-key-in-file", ...keyCase.task });
      const run = await runGuarded(sb, ["run", "--task", taskPath, "--config", configPath], cliEnv({ fakeApiKey: FAKE_API_KEY }));
      assertRefusedBeforeSending(run, [api], sb.workspace, ["key_in_file"], keyCase.values);
    });
  }
});

interface OneTurnSetup {
  readonly id: string;
  readonly taskModel?: string;
  readonly taskMaxOutputTokens?: number;
  /** Extra environment besides the fake key, given the fake server's URL. */
  readonly env?: (apiUrl: string) => Readonly<Record<string, string>>;
  readonly config: (apiUrl: string) => object;
  /** Name the config file with CODARYN_CONFIG instead of `--config`. */
  readonly configByEnv?: boolean;
}

/** One request, one final answer, verifier passes. Returns the server and the result. */
async function oneTurnRun(t: TestContext, setup: OneTurnSetup): Promise<{ api: FakeAnthropic; result: EngineResult }> {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 문서\n");
  const api = await startFakeAnthropic(t, [replyText("끝")]);
  const configPath = writeConfigFile(sb, setup.config(api.url));
  const taskPath = writeAnthropicTask(sb, {
    id: setup.id,
    model: setup.taskModel,
    maxOutputTokens: setup.taskMaxOutputTokens,
    verifiers: README_EXISTS,
  });
  const extra: Record<string, string> = { ...setup.env?.(api.url) };
  const args = ["run", "--task", taskPath];
  if (setup.configByEnv === true) extra[CODARYN_CONFIG_ENV] = configPath;
  else args.push("--config", configPath);
  const run = await runGuarded(sb, args, cliEnv({ fakeApiKey: FAKE_API_KEY, extra }));
  const result = expectRunResult(run, "anthropic");
  readRunFiles(sb.workspace, result);
  assert.equal(result.status, "done");
  assertProtocolClean(api);
  assert.equal(api.requests.length, 1);
  return { api, result };
}

test(`${MOCK_LABEL} E3-f 모델 우선순위 task > CODARYN_MODEL > 설정 파일(요청 본문 model)`, { timeout: 120_000 }, async (t) => {
  await t.test("task model wins over CODARYN_MODEL and config; task output cap wins", async (st) => {
    const { api } = await oneTurnRun(st, {
      id: "m02-model-task",
      taskModel: FAKE_MODEL_TASK,
      taskMaxOutputTokens: 700,
      env: () => ({ [CODARYN_MODEL_ENV]: FAKE_MODEL_ENV }),
      config: (url) => fakeApiConfig(url, { model: FAKE_MODEL_CONFIG, maxOutputTokens: 900 }),
      configByEnv: true,
    });
    assert.deepEqual(sentModels(api), [FAKE_MODEL_TASK]);
    assert.deepEqual(sentMaxTokens(api), [700]);
  });

  await t.test("CODARYN_MODEL wins over config; config output cap applies", async (st) => {
    const { api } = await oneTurnRun(st, {
      id: "m02-model-env",
      env: () => ({ [CODARYN_MODEL_ENV]: FAKE_MODEL_ENV }),
      config: (url) => fakeApiConfig(url, { model: FAKE_MODEL_CONFIG, maxOutputTokens: 900 }),
    });
    assert.deepEqual(sentModels(api), [FAKE_MODEL_ENV]);
    assert.deepEqual(sentMaxTokens(api), [900]);
  });

  await t.test("config model is used when nothing else names one", async (st) => {
    const { api } = await oneTurnRun(st, {
      id: "m02-model-config",
      config: (url) => fakeApiConfig(url, { model: FAKE_MODEL_CONFIG, maxOutputTokens: 900 }),
    });
    assert.deepEqual(sentModels(api), [FAKE_MODEL_CONFIG]);
  });

  await t.test("CODARYN_API_BASE_URL wins over the config file's apiBaseUrl", async (st) => {
    const decoy = await startFakeAnthropic(st, [replyText("다른 주소")]);
    await oneTurnRun(st, {
      id: "m02-address-env",
      env: (url) => ({ [CODARYN_API_BASE_URL_ENV]: url }),
      config: () => fakeApiConfig(decoy.url, { model: FAKE_MODEL_CONFIG }),
    });
    assert.equal(decoy.requests.length, 0, "the config address must not be used when the variable is set");
  });
});

test(`${MOCK_LABEL} E3-g task 파일의 apiBaseUrl과 자동 탐색 파일로는 전송 주소가 바뀌지 않는다`, { timeout: 120_000 }, async (t) => {
  const attempts: readonly { name: string; task: (decoyUrl: string) => Partial<AnthropicTaskOptions> }[] = [
    { name: "top-level apiBaseUrl", task: (decoyUrl) => ({ extraTop: { apiBaseUrl: decoyUrl } }) },
    { name: "model.apiBaseUrl", task: (decoyUrl) => ({ extraModel: { apiBaseUrl: decoyUrl } }) },
  ];
  for (const attempt of attempts) {
    await t.test(`task file ${attempt.name} is rejected or ignored`, async (st) => {
      const sb = createSandbox(st);
      writeWorkspaceFile(sb, "README.md", "# 문서\n");
      const api = await startFakeAnthropic(st, [replyText("끝")]);
      const decoy = await startFakeAnthropic(st, [replyText("다른 주소")]);
      const configPath = writeConfigFile(sb, fakeApiConfig(api.url, { model: FAKE_MODEL_CONFIG }));
      const taskPath = writeAnthropicTask(sb, { id: "m02-task-address", verifiers: README_EXISTS, ...attempt.task(decoy.url) });
      const run = await runGuarded(sb, ["run", "--task", taskPath, "--config", configPath], cliEnv({ fakeApiKey: FAKE_API_KEY }));
      assert.equal(decoy.requests.length, 0, "the address in the task file must never receive a request");
      const output = parseCliOutput(run);
      if (output.kind === "error") {
        assert.equal(output.code, "invalid_task");
        assert.equal(api.requests.length, 0);
      } else {
        assert.equal(output.provider, "anthropic");
        assert.ok(api.requests.length >= 1, "an ignored field leaves the configured address in use");
        assertProtocolClean(api);
      }
      st.diagnostic(`task ${attempt.name}: ${output.kind === "error" ? `rejected (${output.code})` : "ignored"}`);
    });
  }

  await t.test("config-like files and .env files near the task or in the workspace are never read", async (st) => {
    const sb = createSandbox(st);
    writeWorkspaceFile(sb, "README.md", "# 문서\n");
    const api = await startFakeAnthropic(st, [replyText("끝")]);
    const decoy = await startFakeAnthropic(st, [replyText("다른 주소")]);
    const decoyConfig = { schemaVersion: 1, apiBaseUrl: decoy.url, model: FAKE_MODEL_DECOY, maxOutputTokens: 64 };
    for (const name of ["codaryn.config.json", ".codaryn.json", "codaryn.json", ".codarynrc"]) {
      writeAt(sb.base, name, JSON.stringify(decoyConfig));
      writeAt(sb.workspace, name, JSON.stringify(decoyConfig));
    }
    const decoyVars = {
      [ANTHROPIC_API_KEY_ENV]: FAKE_API_KEY_DECOY,
      [CODARYN_MODEL_ENV]: FAKE_MODEL_DECOY,
      [CODARYN_API_BASE_URL_ENV]: decoy.url,
      [CODARYN_CONFIG_ENV]: join(sb.base, "codaryn.config.json"),
    };
    writeEnvFile(join(sb.base, ".env"), decoyVars);
    writeEnvFile(join(sb.workspace, ".env"), decoyVars);

    const configPath = writeConfigFile(sb, fakeApiConfig(api.url));
    const taskPath = writeAnthropicTask(sb, { id: "m02-no-discovery", verifiers: README_EXISTS });
    const run = await runGuarded(
      sb,
      ["run", "--task", taskPath, "--config", configPath],
      cliEnv({ fakeApiKey: FAKE_API_KEY, extra: { [CODARYN_MODEL_ENV]: FAKE_MODEL_ENV } }),
    );
    const result = expectRunResult(run, "anthropic");
    readRunFiles(sb.workspace, result);
    assert.equal(decoy.requests.length, 0, "no discovered file may redirect requests");
    assertProtocolClean(api);
    assert.deepEqual(sentModels(api), [FAKE_MODEL_ENV]);
    for (const request of api.requests) assert.ok(request.headers["x-api-key"] === FAKE_API_KEY, "the decoy key must not be used");
  });
});

test(`${MOCK_LABEL} E3-j --env-file로 준 임시 파일의 변수로 실행`, { timeout: 90_000 }, async (t) => {
  await t.test("key, model and address come from the named env file", async (st) => {
    const sb = createSandbox(st);
    writeWorkspaceFile(sb, "README.md", "# 문서\n");
    const api = await startFakeAnthropic(st, [replyText("끝")]);
    // A temporary file inside the sandbox, with fake values only. Nothing is stored in the repository.
    const envFile = writeEnvFile(join(sb.base, "fake-vars.env"), {
      [ANTHROPIC_API_KEY_ENV]: FAKE_API_KEY_ENV_FILE,
      [CODARYN_MODEL_ENV]: FAKE_MODEL_ENV_FILE,
      [CODARYN_API_BASE_URL_ENV]: api.url,
    });
    const taskPath = writeAnthropicTask(sb, { id: "m02-env-file", maxOutputTokens: 500, verifiers: README_EXISTS });

    const run = await runGuarded(sb, ["run", "--task", taskPath, "--env-file", envFile], cliEnv());
    const result = expectRunResult(run, "anthropic");
    readRunFiles(sb.workspace, result);

    assert.equal(result.status, "done");
    assertProtocolClean(api);
    assert.equal(api.requests.length, 1);
    assert.deepEqual(sentModels(api), [FAKE_MODEL_ENV_FILE]);
    assert.deepEqual(sentMaxTokens(api), [500]);
    for (const request of api.requests) {
      assert.ok(request.headers["x-api-key"] === FAKE_API_KEY_ENV_FILE, "the key comes from the env file");
    }
    const sources = [...otherHeaderSources(api), ...bodySources(api), ...cliOutputSources(sb.workspace, run)];
    assert.deepEqual(findLeaks(sources, [FAKE_API_KEY_ENV_FILE]), [], "the env file key may appear in x-api-key only");
  });

  await t.test("an env file with a byte order mark -> invalid_config, nothing sent", async (st) => {
    const sb = createSandbox(st);
    const api = await startFakeAnthropic(st, [replyText("끝")]);
    const envText = [
      `${ANTHROPIC_API_KEY_ENV}=${FAKE_API_KEY_ENV_FILE}`,
      `${CODARYN_MODEL_ENV}=${FAKE_MODEL_ENV_FILE}`,
      `${CODARYN_API_BASE_URL_ENV}=${api.url}`,
      "",
    ].join("\n");
    const envFile = writeAt(sb.base, "bom-vars.env", withBom(envText));
    const taskPath = writeAnthropicTask(sb, { id: "m02-env-bom", maxOutputTokens: 500 });
    const run = await runGuarded(sb, ["run", "--task", taskPath, "--env-file", envFile], cliEnv());
    assertRefusedBeforeSending(run, [api], sb.workspace, ["invalid_config"], [FAKE_API_KEY_ENV_FILE]);
  });
});
