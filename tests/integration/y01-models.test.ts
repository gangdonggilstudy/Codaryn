/**
 * `codaryn models` (Y-1 to Y-4; src/contracts/commands.ts ModelsOutput, model.ts ModelInfo and
 * ListAnthropicModels, docs/cli-contract.md section 16) against the local fake server's
 * GET /v1/models (tests/support/fake-models.ts). Mock API verification, not the real API: every
 * name starts with MOCK_LABEL, every run has the network guard, and only fake keys are used.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import {
  ANTHROPIC_API_KEY_ENV,
  CLI_ERROR_EXIT_CODES,
  CODARYN_API_BASE_URL_ENV,
  CODARYN_CONFIG_ENV,
  CODARYN_MODEL_ENV,
  MAX_MODEL_LIST_PAGES,
  MODELS_EXIT_CODES,
} from "../../src/contracts/index.js";
import type { CodarynConfig, CliErrorCode } from "../../src/contracts/index.js";
import {
  ANTHROPIC_LIMITS,
  FAKE_MODEL_CATALOG,
  KEY_RUN_CHARS,
  LISTED_MODEL_PREFIX,
  fakeApiConfig,
  sharesKeyRun,
  writeAnthropicTask,
  writeEnvFile,
} from "../fixtures/anthropic.js";
import { createSandbox, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { FAKE_API_KEY, FAKE_API_KEY_ENV_FILE } from "../fixtures/secrets.js";
import { cliEnv, expectCliError, expectRunResult, readRunFiles } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import {
  MOCK_LABEL,
  messagesRequests,
  modelsRequests,
  otherHeaderSources,
  replyError,
  replyText,
  runGuarded,
  startFakeAnthropic,
} from "../support/fake-anthropic.js";
import type { FakeAnthropic } from "../support/fake-anthropic.js";
import { fakeModel } from "../support/fake-models.js";
import type { FakeModel, FakeModelsCatalog } from "../support/fake-models.js";
import { decodedSource, findLeaks } from "../support/leak.js";
import {
  assertModelsHeaders,
  assertNoStrayFiles,
  assertOnlyModelChanged,
  assertPagedList,
  expectModelsOutput,
  fileBytes,
  modelsArgs,
  readJsonFile,
} from "../support/models-cli.js";
import type { ModelsArgs } from "../support/models-cli.js";

const IDS = FAKE_MODEL_CATALOG.map((model) => model.id);
const PAGES = [IDS.slice(0, 2), IDS.slice(2, 4), IDS.slice(4)];
const [ALPHA, BETA, GAMMA, DELTA] = IDS as [string, string, string, string, string];

interface Setup {
  readonly sb: Sandbox;
  readonly api: FakeAnthropic;
  /** `<base>/cfg/codaryn-config.json`; its directory holds nothing else. */
  readonly configPath: string;
  readonly configDir: string;
}

/**
 * A fake server with the catalog and a config file pointing at it. `config: null` writes no
 * config file (the address then comes from CODARYN_API_BASE_URL in `envFor`).
 */
async function setup(
  t: TestContext,
  options: { readonly catalog?: Partial<FakeModelsCatalog>; readonly config?: Partial<CodarynConfig> | null; readonly steps?: Parameters<typeof startFakeAnthropic>[1] } = {},
): Promise<Setup> {
  const sb = createSandbox(t);
  const api = await startFakeAnthropic(t, options.steps ?? [], { models: { models: FAKE_MODEL_CATALOG, ...options.catalog } });
  const configDir = join(sb.base, "cfg");
  mkdirSync(configDir);
  const configPath = join(configDir, "codaryn-config.json");
  if (options.config !== null) {
    writeFileSync(configPath, `${JSON.stringify(fakeApiConfig(api.url, { model: GAMMA, ...options.config }), null, 2)}\n`);
  }
  return { sb, api, configPath, configDir };
}

function envFor(s: Setup, extra: Readonly<Record<string, string>> = {}, key: string | null = FAKE_API_KEY): NodeJS.ProcessEnv {
  return key === null ? cliEnv({ extra }) : cliEnv({ fakeApiKey: key, extra });
}

function models(s: Setup, args: ModelsArgs, env: NodeJS.ProcessEnv = envFor(s), stdin?: "ignore" | "pipe"): Promise<CliRun> {
  return runGuarded(s.sb, modelsArgs(args), env, 30_000, stdin);
}

function outputs(run: CliRun) {
  return [
    { label: "stdout", text: run.stdout },
    { label: "stderr", text: run.stderr },
    decodedSource("stdout", run.stdout, true),
  ];
}

/** Stopped with `code` (and its exit code); the config file has exactly `before` (null: absent). */
function assertRefused(run: CliRun, code: CliErrorCode, s: Setup, before: Buffer | null): void {
  expectCliError(run, code);
  assert.equal(run.exitCode, CLI_ERROR_EXIT_CODES[code]);
  assert.deepEqual(fileBytes(s.configPath), before, "the config file is left as it was");
}

test(`${MOCK_LABEL} Y-1 models --json: 모든 쪽을 읽어 번호·이름·한도와 현재 모델을 낸다`, { timeout: 60_000 }, async (t) => {
  const s = await setup(t);
  const run = await models(s, { config: s.configPath, json: true });
  const output = expectModelsOutput(run);

  assert.equal(output.status, "listed");
  assert.equal(run.exitCode, MODELS_EXIT_CODES.listed);
  assert.deepEqual(output.models.map((model) => model.id), IDS, "the API's order");
  for (const [index, model] of FAKE_MODEL_CATALOG.entries()) {
    const entry = output.models[index];
    assert.ok(entry !== undefined);
    assert.equal(entry.displayName, model.display_name);
    assert.equal(entry.maxInputTokens, model.max_input_tokens);
    assert.equal(entry.maxOutputTokens, model.max_tokens);
    assert.equal(entry.createdAt, model.created_at ?? null, "created_at as given, null when missing");
    assert.equal("capabilities" in entry, false, "capabilities is dropped");
  }
  assert.deepEqual(output.current, { id: GAMMA, source: "config", listed: true });
  assert.equal(output.selected, null);
  assertPagedList(s.api, PAGES);
  assert.equal(messagesRequests(s.api).length, 0);
});

test(`${MOCK_LABEL} Y-1 기본 출력(표): 번호와 id가 있고 현재 모델 줄만 표시가 달라진다`, { timeout: 60_000 }, async (t) => {
  const s = await setup(t);
  const lineOf = (run: CliRun, id: string): string => run.stdout.split(/\r?\n/).find((line) => line.includes(id)) ?? "";
  const gammaCurrent = await models(s, { config: s.configPath });
  assert.equal(gammaCurrent.exitCode, 0);
  IDS.forEach((id, index) => {
    assert.ok(lineOf(gammaCurrent, id).includes(String(index + 1)), `${id} is listed with number ${index + 1}`);
  });
  const alphaCurrent = await models(s, { config: s.configPath }, envFor(s, { [CODARYN_MODEL_ENV]: ALPHA }));
  assert.notEqual(lineOf(gammaCurrent, GAMMA), lineOf(alphaCurrent, GAMMA), "the current model's line is marked");
  assert.equal(lineOf(gammaCurrent, BETA), lineOf(alphaCurrent, BETA), "other lines are not");
});

test(`${MOCK_LABEL} Y-1 현재 모델: CODARYN_MODEL 우선, 목록에 없으면 listed false, 없으면 null`, { timeout: 60_000 }, async (t) => {
  await t.test("CODARYN_MODEL이 설정 파일보다 우선", async (st) => {
    const s = await setup(st);
    const output = expectModelsOutput(await models(s, { config: s.configPath, json: true }, envFor(s, { [CODARYN_MODEL_ENV]: DELTA })));
    assert.deepEqual(output.current, { id: DELTA, source: "CODARYN_MODEL", listed: true });
  });
  await t.test("목록에 없는 설정 모델", async (st) => {
    const s = await setup(st, { config: { model: "cdy-fake-model-retired" } });
    const output = expectModelsOutput(await models(s, { config: s.configPath, json: true }));
    assert.deepEqual(output.current, { id: "cdy-fake-model-retired", source: "config", listed: false });
  });
  await t.test("어디에도 없음 → null", async (st) => {
    const s = await setup(st, { config: null });
    const output = expectModelsOutput(await models(s, { json: true }, envFor(s, { [CODARYN_API_BASE_URL_ENV]: s.api.url })));
    assert.equal(output.current, null);
  });
});

test(`${MOCK_LABEL} Y-3 --use 번호와 id: 설정 파일의 model만 바뀌고 다른 필드는 그대로`, { timeout: 60_000 }, async (t) => {
  for (const [label, use, expected] of [
    ["번호 3", "3", GAMMA],
    ["id", DELTA, DELTA],
  ] as const) {
    await t.test(label, async (st) => {
      const s = await setup(st, { config: { model: ALPHA, limits: ANTHROPIC_LIMITS, maxRetries: 1 } });
      const before = readJsonFile(s.configPath);
      const run = await models(s, { config: s.configPath, use, json: true });
      const output = expectModelsOutput(run);
      assert.equal(output.status, "selected");
      assert.equal(run.exitCode, MODELS_EXIT_CODES.selected);
      assert.deepEqual(output.selected, { id: expected, created: false, overriddenBy: null });
      assertOnlyModelChanged(before, readJsonFile(s.configPath), expected);
      assertNoStrayFiles(s.configDir, ["codaryn-config.json"]);
    });
  }
  await t.test("CODARYN_MODEL이 설정되어 있으면 overriddenBy로 알린다", async (st) => {
    const s = await setup(st, { config: { model: ALPHA } });
    const output = expectModelsOutput(await models(s, { config: s.configPath, use: "2", json: true }, envFor(s, { [CODARYN_MODEL_ENV]: DELTA })));
    assert.deepEqual(output.selected, { id: BETA, created: false, overriddenBy: "CODARYN_MODEL" });
    assert.equal(readJsonFile(s.configPath)["model"], BETA);
  });
  await t.test("CODARYN_CONFIG로 준 설정 파일에도 쓴다", async (st) => {
    const s = await setup(st, { config: { model: ALPHA } });
    const output = expectModelsOutput(await models(s, { use: "1", json: true }, envFor(s, { [CODARYN_CONFIG_ENV]: s.configPath })));
    assert.equal(output.selected?.id, ALPHA);
    assert.equal(readJsonFile(s.configPath)["model"], ALPHA);
  });
});

test(`${MOCK_LABEL} Y-3 없는 설정 파일은 schemaVersion과 model만으로 만든다`, { timeout: 60_000 }, async (t) => {
  const s = await setup(t, { config: null });
  const output = expectModelsOutput(
    await models(s, { config: s.configPath, use: "2", json: true }, envFor(s, { [CODARYN_API_BASE_URL_ENV]: s.api.url })),
  );
  assert.deepEqual(output.selected, { id: BETA, created: true, overriddenBy: null });
  assert.deepEqual(readJsonFile(s.configPath), { schemaVersion: 1, model: BETA });
  assertNoStrayFiles(s.configDir, ["codaryn-config.json"]);
});

test(`${MOCK_LABEL} Y-3 잘못된 --use는 invalid_arguments, 아무것도 쓰지 않음`, { timeout: 60_000 }, async (t) => {
  for (const use of ["0", String(IDS.length + 1), "cdy-fake-model-unknown", "-1", "2.5"]) {
    await t.test(`--use ${use}`, async (st) => {
      const s = await setup(st, { config: { model: ALPHA } });
      const before = fileBytes(s.configPath);
      assertRefused(await models(s, { config: s.configPath, use, json: true }), "invalid_arguments", s, before);
    });
  }
  await t.test("--config도 CODARYN_CONFIG도 없이 --use", async (st) => {
    const s = await setup(st, { config: null });
    const before = readdirSync(s.sb.base).sort();
    const run = await models(s, { use: "1", json: true }, envFor(s, { [CODARYN_API_BASE_URL_ENV]: s.api.url }));
    expectCliError(run, "invalid_arguments");
    assert.deepEqual(readdirSync(s.sb.base).sort(), before, "no file is created anywhere");
    assert.deepEqual(readdirSync(s.configDir), []);
  });
});

test(`${MOCK_LABEL} Y-2 키 없음: provider_not_configured, 요청 0건`, { timeout: 60_000 }, async (t) => {
  const s = await setup(t, { config: { model: ALPHA } });
  const before = fileBytes(s.configPath);
  assertRefused(await models(s, { config: s.configPath, json: true }, envFor(s, {}, null)), "provider_not_configured", s, before);
  assertRefused(await models(s, { config: s.configPath, use: "2" }, envFor(s, {}, null)), "provider_not_configured", s, before);
  assert.equal(s.api.requests.length, 0, "nothing is sent without a key");
});

test(`${MOCK_LABEL} Y-2 키는 x-api-key 헤더에만: Messages와 같은 버전, 출력·설정 파일·다른 헤더에 없음`, { timeout: 90_000 }, async (t) => {
  // One Messages request from the same CLI, to compare the anthropic-version header.
  const s = await setup(t, { config: { model: ALPHA }, steps: [replyText("끝")] });
  writeWorkspaceFile(s.sb, "README.md", "# 연습\n");
  const taskPath = writeAnthropicTask(s.sb, {
    id: "y-version",
    verifiers: [{ id: "r", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] }],
  });
  const runResult = await runGuarded(s.sb, ["run", "--task", taskPath, "--config", s.configPath], envFor(s));
  assert.equal(expectRunResult(runResult, "anthropic").status, "done");
  const messagesVersion = messagesRequests(s.api)[0]?.headers["anthropic-version"] ?? "";
  assert.ok(messagesVersion !== "", "test assumption: the run sent a Messages request");

  const listed = await models(s, { config: s.configPath, json: true });
  const selected = await models(s, { config: s.configPath, use: "3", json: true });
  expectModelsOutput(listed);
  expectModelsOutput(selected);
  const before = new Set(messagesRequests(s.api));
  const modelsOnly: FakeAnthropic = { ...s.api, requests: s.api.requests.filter((request) => !before.has(request)) };
  assertModelsHeaders(modelsOnly, FAKE_API_KEY, messagesVersion);

  const sources = [
    ...outputs(listed),
    ...outputs(selected),
    { label: "config file", text: readFileSync(s.configPath, "utf8") },
    ...otherHeaderSources(s.api),
    ...modelsRequests(s.api).map((request) => ({ label: `request ${request.index} path`, text: request.path })),
  ];
  assert.deepEqual(findLeaks(sources, [FAKE_API_KEY], { extended: true }), []);
});

test(`${MOCK_LABEL} Y-2 --vars-file의 키와 CODARYN_API_BASE_URL 우선순위`, { timeout: 60_000 }, async (t) => {
  await t.test("키를 --vars-file에서 읽는다", async (st) => {
    const s = await setup(st);
    const varsFile = writeEnvFile(join(s.sb.base, "vars.env"), { [ANTHROPIC_API_KEY_ENV]: FAKE_API_KEY_ENV_FILE });
    const run = await models(s, { config: s.configPath, varsFile, json: true }, envFor(s, {}, null));
    expectModelsOutput(run);
    for (const request of modelsRequests(s.api)) assert.equal(request.headers["x-api-key"], FAKE_API_KEY_ENV_FILE);
    assert.deepEqual(findLeaks(outputs(run), [FAKE_API_KEY_ENV_FILE], { extended: true }), []);
  });
  await t.test("CODARYN_API_BASE_URL이 설정 파일의 주소보다 우선", async (st) => {
    const s = await setup(st);
    const other = await startFakeAnthropic(st, [], { models: { models: FAKE_MODEL_CATALOG } });
    expectModelsOutput(await models(s, { config: s.configPath, json: true }, envFor(s, { [CODARYN_API_BASE_URL_ENV]: other.url })));
    assert.equal(s.api.requests.length, 0, "the config file's address is not used");
    assert.equal(modelsRequests(other).length, PAGES.length);
  });
});

test(`${MOCK_LABEL} Y-2 목록 요청 실패와 형식 오류는 model_list_failed, 키 없음, 아무것도 쓰지 않음`, { timeout: 60_000 }, async (t) => {
  await t.test("401 → auth_failed", async (st) => {
    const s = await setup(st, { catalog: { failWith: { status: 401, errorType: "authentication_error" } }, config: { model: ALPHA, maxRetries: 0 } });
    const before = fileBytes(s.configPath);
    const run = await models(s, { config: s.configPath, use: "2", json: true });
    assertRefused(run, "model_list_failed", s, before);
    assert.ok(expectCliError(run, "model_list_failed").message.includes("auth_failed"), "the message names the kind");
    assert.deepEqual(findLeaks(outputs(run), [FAKE_API_KEY], { extended: true }), []);
  });
  await t.test("문자열 id가 없는 항목 → malformed_response", async (st) => {
    // Control: the same list without the broken entry is listed, so the refusal comes from it.
    const control = await setup(st, { catalog: { models: FAKE_MODEL_CATALOG.slice(0, 2) } });
    assert.equal(expectModelsOutput(await models(control, { config: control.configPath, json: true })).models.length, 2);

    const broken = { ...fakeModel(`${LISTED_MODEL_PREFIX}x`, "Fake X", 1000, 100), id: 42 } as unknown as FakeModel;
    const s = await setup(st, { catalog: { models: [...FAKE_MODEL_CATALOG.slice(0, 2), broken] } });
    const run = await models(s, { config: s.configPath, json: true });
    assert.ok(expectCliError(run, "model_list_failed").message.includes("malformed_response"));
  });
  await t.test("키 조각이 든 항목 → malformed_response, 그 조각은 출력과 설정 파일에 없음", async (st) => {
    // Control: no listed id shares a run with the key (otherwise every listing above would fail).
    for (const id of IDS) assert.equal(sharesKeyRun(id, FAKE_API_KEY), false, `${id} shares a run with the fake key`);

    const fragment = FAKE_API_KEY.slice(-KEY_RUN_CHARS);
    const variants = [
      fakeModel(`${LISTED_MODEL_PREFIX}${fragment}`, "Fake Leaky Id", 1000, 100),
      fakeModel(`${LISTED_MODEL_PREFIX}zeta`, `Fake ${fragment}`, 1000, 100),
      fakeModel(`${LISTED_MODEL_PREFIX}eta`, "Fake Leaky Date", 1000, 100, { createdAt: `2026-01-01T${fragment}` }),
    ];
    for (const leaky of variants) {
      const s = await setup(st, { catalog: { models: [...FAKE_MODEL_CATALOG.slice(0, 2), leaky] }, config: { model: ALPHA, maxRetries: 0 } });
      const before = fileBytes(s.configPath);
      const run = await models(s, { config: s.configPath, use: "3", json: true });
      assertRefused(run, "model_list_failed", s, before);
      assert.ok(expectCliError(run, "model_list_failed").message.includes("malformed_response"), leaky.display_name);
      assert.deepEqual(findLeaks(outputs(run), [FAKE_API_KEY, fragment], { extended: true }), [], leaky.display_name);
    }
  });
});

test(`${MOCK_LABEL} Y-1 쪽 수 상한: ${MAX_MODEL_LIST_PAGES}쪽은 읽고, 넘으면 api_error`, { timeout: 90_000 }, async (t) => {
  const many = (count: number): FakeModel[] =>
    Array.from({ length: count }, (_, index) => fakeModel(`${LISTED_MODEL_PREFIX}p${String(index + 1).padStart(2, "0")}`, `Fake P${index + 1}`, 1000, 100));
  await t.test(`${MAX_MODEL_LIST_PAGES}쪽`, async (st) => {
    const s = await setup(st, { catalog: { models: many(MAX_MODEL_LIST_PAGES), pageSize: 1 } });
    const output = expectModelsOutput(await models(s, { config: s.configPath, json: true }));
    assert.equal(output.models.length, MAX_MODEL_LIST_PAGES);
    assert.equal(modelsRequests(s.api).length, MAX_MODEL_LIST_PAGES);
  });
  await t.test(`${MAX_MODEL_LIST_PAGES + 1}쪽`, async (st) => {
    const s = await setup(st, { catalog: { models: many(MAX_MODEL_LIST_PAGES + 1), pageSize: 1 } });
    const run = await models(s, { config: s.configPath, json: true });
    assert.ok(expectCliError(run, "model_list_failed").message.includes("api_error"));
    assert.equal(modelsRequests(s.api).length, MAX_MODEL_LIST_PAGES, "it stops at the bound");
  });
});

test(`${MOCK_LABEL} Y-3 입력이 터미널이 아니면 묻지 않는다(--use 없음)`, { timeout: 90_000 }, async (t) => {
  for (const stdin of ["ignore", "pipe"] as const) {
    await t.test(`stdin ${stdin}`, async (st) => {
      const s = await setup(st, { config: { model: ALPHA } });
      const before = fileBytes(s.configPath);
      const run = await models(s, { config: s.configPath }, envFor(s), stdin);
      assert.equal(run.timedOut, false, "the command must not wait for input");
      assert.equal(run.exitCode, MODELS_EXIT_CODES.listed);
      assert.deepEqual(fileBytes(s.configPath), before, "nothing is chosen or written");
    });
  }
});

test(`${MOCK_LABEL} Y-3 작업 공간 안의 설정 파일에 쓰면 그 설정으로는 실행이 거부된다(S-1)`, { timeout: 90_000 }, async (t) => {
  const s = await setup(t, { config: { model: ALPHA }, steps: [replyText("끝")] });
  writeWorkspaceFile(s.sb, "README.md", "# 연습\n");
  const inside = join(s.sb.workspace, "codaryn-config.json");
  writeFileSync(inside, readFileSync(s.configPath));
  // The models command has no workspace (contract): it writes the file it is given.
  const output = expectModelsOutput(await models(s, { config: inside, use: "2", json: true }));
  assert.equal(output.selected?.id, BETA);
  assert.equal(readJsonFile(inside)["model"], BETA);
  // A run that names the workspace refuses a config file inside it (S-1), before any request.
  const taskPath = writeAnthropicTask(s.sb, { id: "y-inside", verifiers: [{ id: "r", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] }] });
  const run = await runGuarded(s.sb, ["run", "--task", taskPath, "--config", inside], envFor(s));
  expectCliError(run, "invalid_config");
  assert.equal(messagesRequests(s.api).length, 0);
  assert.equal(existsSync(join(s.sb.workspace, ".codaryn", "runs")), false);
});

test(`${MOCK_LABEL} Y-4 실행 중 모델이 없다는 404면 오류 문구가 codaryn models를 안내한다`, { timeout: 60_000 }, async (t) => {
  const s = await setup(t, { config: { model: "cdy-fake-model-retired", maxRetries: 0 }, steps: [replyError(404, "not_found_error")] });
  writeWorkspaceFile(s.sb, "README.md", "# 연습\n");
  const taskPath = writeAnthropicTask(s.sb, { id: "y-404", verifiers: [{ id: "r", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] }] });
  const run = await runGuarded(s.sb, ["run", "--task", taskPath, "--config", s.configPath], envFor(s));
  const result = expectRunResult(run, "anthropic");
  // readRunFiles also checks that result.json equals this stdout object, notices included.
  const { records } = readRunFiles(s.sb.workspace, result);
  assert.equal(result.reason, "model_error");
  // cli-contract 16 (Y-4): the hint is one line in the result's notices; the error stays the provider's.
  assert.ok(
    result.notices.some((notice) => notice.includes("codaryn models")),
    `notices: ${JSON.stringify(result.notices)}`,
  );
  const errors = records.flatMap((record) => (record.type === "model_error" ? [record] : []));
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.kind, "api_error", "the provider's error kind is not changed");
  assert.ok(errors[0]?.message.startsWith("HTTP 404"), "the provider's message is kept as it was");
  assert.equal(messagesRequests(s.api).length, 1, "maxRetries 0: one Messages request, no retry");
});
