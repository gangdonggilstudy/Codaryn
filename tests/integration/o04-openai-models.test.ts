/**
 * OpenAI model listing and checks through the CLI (SP-6, DR-34, DR-36 (a), (b)) against the fake
 * Responses API's models list: `models --provider openai`, the current model's source, the key's
 * absence, list failures, and what `doctor` says about where the OpenAI key goes. Every command runs
 * behind the network guard. Mock API verification only, not the real API.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CODARYN_API_BASE_URL_ENV,
  CODARYN_MODEL_ENV,
  CODARYN_OPENAI_API_BASE_URL_ENV,
  CODARYN_OPENAI_MODEL_ENV,
  OPENAI_API_KEY_ENV,
} from "../../src/contracts/index.js";
import type { DoctorOutput, ModelsOutput } from "../../src/contracts/index.js";
import { writeConfigFile } from "../fixtures/anthropic.js";
import { createSandbox } from "../fixtures/builders.js";
import { FAKE_OPENAI_MODEL_CATALOG, openAIConfig } from "../fixtures/openai.js";
import { FAKE_API_KEY, FAKE_OPENAI_KEY } from "../fixtures/secrets.js";
import { cliEnv, expectCliError } from "../support/cli.js";
import { MOCK_LABEL, runGuarded, startFakeAnthropic } from "../support/fake-anthropic.js";
import { assertOpenAIProtocolClean, bearerKeysOf, openAIModelsRequests, startFakeOpenAI } from "../support/fake-openai.js";
import { findLeaks } from "../support/leak.js";

const [ALPHA, BETA, GAMMA] = FAKE_OPENAI_MODEL_CATALOG.map((model) => model.id);
const NOT_LISTED = "cdy-oai-not-listed";

function models(stdout: string): ModelsOutput {
  const output = JSON.parse(stdout.trim()) as ModelsOutput;
  assert.equal(output.kind, "models", stdout.slice(0, 300));
  return output;
}

test(`${MOCK_LABEL} OI-40 models --provider openai: 목록 한 번(Bearer, 질의 없음), API 순서, id·생성 시각, 한도 null, 현재 모델의 출처`, { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  const openai = await startFakeOpenAI(t, [], { models: { models: FAKE_OPENAI_MODEL_CATALOG } });
  const anthropic = await startFakeAnthropic(t, []);
  // The config chooses anthropic; --provider openai must list OpenAI's models all the same.
  const config = writeConfigFile(sb, openAIConfig(openai.baseUrl, { model: BETA }, { provider: "anthropic" }));
  const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv =>
    cliEnv({ fakeOpenAiKey: FAKE_OPENAI_KEY, extra: { [CODARYN_API_BASE_URL_ENV]: anthropic.url, [CODARYN_MODEL_ENV]: "cdy-anthropic-only-model", ...extra } });
  const list = (extra?: Record<string, string>) => runGuarded(sb, ["models", "--provider", "openai", "--config", config, "--json"], env(extra));

  const fromConfig = await list();
  assert.equal(fromConfig.exitCode, 0, fromConfig.stdout);
  const output = models(fromConfig.stdout);
  assert.equal(output.provider, "openai");
  assert.equal(output.status, "listed");
  assert.deepEqual(output.models.map((model) => model.id), [ALPHA, BETA, GAMMA], "API order");
  for (const model of output.models) {
    assert.equal(model.displayName, model.id, "4.6: no display name in the list");
    assert.equal(model.maxInputTokens, null);
    assert.equal(model.maxOutputTokens, null);
  }
  assert.equal(output.models[0]?.createdAt, "2026-01-01T00:00:00Z", "created (Unix seconds) as RFC 3339");
  assert.deepEqual(output.current, { id: BETA, source: "config", listed: true }, "CODARYN_MODEL is Anthropic's, not OpenAI's");
  assert.equal(output.selected, null);

  assert.deepEqual(models((await list({ [CODARYN_OPENAI_MODEL_ENV]: GAMMA ?? "" })).stdout).current, { id: GAMMA, source: CODARYN_OPENAI_MODEL_ENV, listed: true });
  assert.deepEqual(models((await list({ [CODARYN_OPENAI_MODEL_ENV]: NOT_LISTED })).stdout).current, { id: NOT_LISTED, source: CODARYN_OPENAI_MODEL_ENV, listed: false });

  assert.equal(openAIModelsRequests(openai).length, 3, "one GET /v1/models per command");
  assertOpenAIProtocolClean(openai);
  assert.ok(bearerKeysOf(openai).every((key) => key === FAKE_OPENAI_KEY));
  assert.equal(anthropic.requests.length, 0, "nothing goes to the Anthropic address");
  assert.deepEqual(findLeaks([{ label: "stdout", text: fromConfig.stdout }, { label: "stderr", text: fromConfig.stderr }], [FAKE_OPENAI_KEY]), []);
});

test(`${MOCK_LABEL} OI-41 models 글 출력(설정의 provider가 openai): 표와 현재 모델 줄이 CODARYN_OPENAI_MODEL을 가리킨다`, { timeout: 60_000 }, async (t) => {
  const sb = createSandbox(t);
  const openai = await startFakeOpenAI(t, [], { models: { models: FAKE_OPENAI_MODEL_CATALOG } });
  const config = writeConfigFile(sb, openAIConfig(openai.baseUrl, { model: BETA }));
  const run = await runGuarded(sb, ["models", "--config", config], cliEnv({ fakeOpenAiKey: FAKE_OPENAI_KEY, extra: { [CODARYN_OPENAI_MODEL_ENV]: GAMMA ?? "" } }));
  assert.equal(run.exitCode, 0, run.stderr);
  for (const id of [ALPHA, BETA, GAMMA]) assert.ok(run.stdout.includes(id ?? ""), `${id} is listed`);
  assert.ok(run.stdout.includes(CODARYN_OPENAI_MODEL_ENV), "the current-model line names the variable (DR-36 (a))");
  assert.equal(openAIModelsRequests(openai).length, 1);
});

test(`${MOCK_LABEL} models --provider openai: 키가 없으면 provider_not_configured(다른 키를 쓰지 않음), 목록 실패는 model_list_failed이고 설정을 쓰지 않는다`, { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  const openai = await startFakeOpenAI(t, [], { models: { models: FAKE_OPENAI_MODEL_CATALOG } });
  const configBody = openAIConfig(openai.baseUrl, { model: BETA });
  const config = writeConfigFile(sb, configBody);
  const noKey = await runGuarded(sb, ["models", "--provider", "openai", "--config", config, "--json"], cliEnv({ fakeApiKey: FAKE_API_KEY }));
  expectCliError(noKey, "provider_not_configured");
  assert.equal(openai.requests.length, 0);

  for (const [label, catalog, kind] of [
    ["401", { models: [], failWith: { status: 401, type: "invalid_request_error", code: "invalid_api_key" } }, "auth_failed"],
    ["data is not a list", { models: FAKE_OPENAI_MODEL_CATALOG, malformed: "data_not_list" as const }, "malformed_response"],
  ] as const) {
    const failing = await startFakeOpenAI(t, [], { models: catalog });
    const failingConfig = writeConfigFile(sb, openAIConfig(failing.baseUrl, { model: BETA }), `config-${kind}.json`);
    const before = readFileSync(failingConfig, "utf8");
    const run = await runGuarded(sb, ["models", "--provider", "openai", "--config", failingConfig, "--json"], cliEnv({ fakeOpenAiKey: FAKE_OPENAI_KEY }));
    const error = expectCliError(run, "model_list_failed");
    assert.ok(error.message.includes(kind), `${label}: ${error.message}`);
    assert.equal(readFileSync(failingConfig, "utf8"), before, `${label}: nothing written`);
    assert.deepEqual(findLeaks([{ label: "stdout", text: run.stdout }, { label: "stderr", text: run.stderr }], [FAKE_OPENAI_KEY]), [], label);
  }
});

test(`${MOCK_LABEL} OI-44 doctor(provider openai): 키 변수는 OPENAI_API_KEY, 키가 갈 주소를 글과 JSON으로 알리고(DR-36 (b)), 요청은 보내지 않는다`, { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  const openai = await startFakeOpenAI(t, [], { models: { models: FAKE_OPENAI_MODEL_CATALOG } });
  const config = writeConfigFile(sb, openAIConfig(openai.baseUrl, { model: BETA }));
  const env = cliEnv({ fakeOpenAiKey: FAKE_OPENAI_KEY });
  const json = await runGuarded(sb, ["doctor", "--config", config, "--workspace", sb.workspace, "--json"], env);
  const doctor = JSON.parse(json.stdout.trim()) as DoctorOutput;
  const key = doctor.checks.find((check) => check.id === "api_key");
  assert.ok(key !== undefined, json.stdout.slice(0, 300));
  assert.equal(key.status, "ok");
  const sent = key.text as { readonly id: string; readonly params?: Readonly<Record<string, unknown>> } | undefined;
  assert.equal(sent?.id, "doctor.api_key.sends_to_config", "DR-36 (b): which address the key goes to");
  assert.deepEqual(sent?.params, { keyEnv: OPENAI_API_KEY_ENV, provider: "openai", origin: openai.url, field: "providers.openai.apiBaseUrl" });
  const text = await runGuarded(sb, ["doctor", "--config", config, "--workspace", sb.workspace], env);
  assert.ok(text.stdout.includes(`${OPENAI_API_KEY_ENV} is set; openai requests send it to ${openai.url}`), text.stdout.slice(0, 1200));

  // With the address variable, the check names the variable instead of the config field.
  const viaEnv = await runGuarded(
    sb,
    ["doctor", "--config", config, "--workspace", sb.workspace, "--json"],
    cliEnv({ fakeOpenAiKey: FAKE_OPENAI_KEY, extra: { [CODARYN_OPENAI_API_BASE_URL_ENV]: openai.baseUrl } }),
  );
  const envKey = (JSON.parse(viaEnv.stdout.trim()) as DoctorOutput).checks.find((check) => check.id === "api_key");
  assert.deepEqual(envKey?.text, { id: "doctor.api_key.sends_to_env", params: { keyEnv: OPENAI_API_KEY_ENV, provider: "openai", origin: openai.url, variable: CODARYN_OPENAI_API_BASE_URL_ENV } });

  assert.equal(openai.requests.length, 0, "doctor sends nothing");
  assert.deepEqual(
    findLeaks([json, text, viaEnv].flatMap((one, index) => [{ label: `stdout ${index}`, text: one.stdout }, { label: `stderr ${index}`, text: one.stderr }]), [FAKE_OPENAI_KEY]),
    [],
  );
});
