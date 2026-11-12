/**
 * OpenAI settings through the CLI (SP-4, SP-6, DR-34) against local fake servers:
 * - each provider's own model and address variables (CODARYN_OPENAI_MODEL, CODARYN_OPENAI_API_BASE_URL;
 *   CODARYN_MODEL and CODARYN_API_BASE_URL are Anthropic's only)
 * - R-20 D2 and its reverse: a key never goes to another provider's address
 * - SP-I03: with both keys set, each provider's key is hidden from the other provider's run
 * - R-20 E: a short placeholder in another provider's key variable is not a secret (DR-34 (b))
 * - no key for the chosen provider: provider_not_configured, nothing sent, no other key used
 * Every run is behind the network guard. Mock API verification only, not the real API.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  CODARYN_API_BASE_URL_ENV,
  CODARYN_MODEL_ENV,
  CODARYN_OPENAI_API_BASE_URL_ENV,
  CODARYN_OPENAI_MODEL_ENV,
  PRIVACY_TOKEN_PREFIX,
} from "../../src/contracts/index.js";
import { FAKE_MODEL_CATALOG, writeAnthropicTask, writeConfigFile } from "../fixtures/anthropic.js";
import { createSandbox, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import {
  FAKE_OPENAI_MODEL_CATALOG,
  FAKE_OPENAI_MODEL_CONFIG,
  FAKE_OPENAI_MODEL_ENV,
  FAKE_OPENAI_MODEL_TASK,
  openAIConfig,
  writeOpenAITask,
} from "../fixtures/openai.js";
import { FAKE_API_KEY, FAKE_OPENAI_KEY, OTHER_KEY_PLACEHOLDERS } from "../fixtures/secrets.js";
import { NODE, cliEnv, expectCliError, expectRunResult, readRunFiles, sha256Hex } from "../support/cli.js";
import { MOCK_LABEL, bodySources, cliOutputSources, otherHeaderSources, replyText, replyTools, runGuarded, startFakeAnthropic, toolUse } from "../support/fake-anthropic.js";
import {
  assertOpenAIProtocolClean,
  bearerKeysOf,
  fnCall,
  functionCallOutputsOf,
  openAIBodyOf,
  openAIBodySources,
  openAIModelsRequests,
  openAIOtherHeaderSources,
  replyCalls,
  replyFinal,
  repeatOpenAIReply,
  responsesRequests,
  startFakeOpenAI,
} from "../support/fake-openai.js";
import { findLeaks } from "../support/leak.js";
import { callStep, finalStep } from "../support/repair-script.js";

/** A rule the workspace meets from the start, so a run that answers at once ends done/verified. */
const SEED = "seed.txt";
const SEED_RULE = { id: "seed", kind: "file_rules" as const, rules: [{ type: "exists" as const, path: SEED }] };

test(`${MOCK_LABEL} 제공자별 변수: 모델은 task > CODARYN_OPENAI_MODEL > providers.openai.model, 주소는 CODARYN_OPENAI_API_BASE_URL > providers.openai.apiBaseUrl, Anthropic 변수는 OpenAI 실행에 쓰이지 않는다`, { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, SEED, "seed\n");
  const viaEnv = await startFakeOpenAI(t, repeatOpenAIReply(replyFinal("ok"), 4));
  const viaConfig = await startFakeOpenAI(t, repeatOpenAIReply(replyFinal("ok"), 1));
  const anthropic = await startFakeAnthropic(t, []);
  const config = writeConfigFile(sb, openAIConfig(viaConfig.baseUrl, { model: FAKE_OPENAI_MODEL_CONFIG }));
  const withModel = writeOpenAITask(sb, { id: "o02-vars", verifiers: [SEED_RULE] });
  const run = async (task: string, extra: Record<string, string>): Promise<void> => {
    const result = expectRunResult(await runGuarded(sb, ["run", "--task", task, "--config", config], cliEnv({ fakeOpenAiKey: FAKE_OPENAI_KEY, extra })), "openai");
    assert.deepEqual([result.status, result.reason], ["done", "verified"]);
  };
  // Anthropic's two variables are set in every run and must be ignored by an OpenAI run.
  const anthropicVars = { [CODARYN_MODEL_ENV]: "cdy-anthropic-only-model", [CODARYN_API_BASE_URL_ENV]: anthropic.url };

  await run(withModel, { ...anthropicVars, [CODARYN_OPENAI_MODEL_ENV]: FAKE_OPENAI_MODEL_ENV, [CODARYN_OPENAI_API_BASE_URL_ENV]: viaEnv.baseUrl });
  const withoutModel = writeOpenAITask(sb, { id: "o02-vars", model: null, verifiers: [SEED_RULE] });
  await run(withoutModel, { ...anthropicVars, [CODARYN_OPENAI_MODEL_ENV]: FAKE_OPENAI_MODEL_ENV, [CODARYN_OPENAI_API_BASE_URL_ENV]: viaEnv.baseUrl });
  await run(withoutModel, { ...anthropicVars, [CODARYN_OPENAI_API_BASE_URL_ENV]: viaEnv.baseUrl });
  await run(withoutModel, { ...anthropicVars });

  assert.deepEqual(
    responsesRequests(viaEnv).map((request) => openAIBodyOf(request)["model"]),
    [FAKE_OPENAI_MODEL_TASK, FAKE_OPENAI_MODEL_ENV, FAKE_OPENAI_MODEL_CONFIG],
    "task > CODARYN_OPENAI_MODEL > config; CODARYN_MODEL is not OpenAI's",
  );
  assert.deepEqual(responsesRequests(viaConfig).map((request) => openAIBodyOf(request)["model"]), [FAKE_OPENAI_MODEL_CONFIG], "without the variable, the config's address");
  assert.equal(anthropic.requests.length, 0, "CODARYN_API_BASE_URL is Anthropic's address: no OpenAI request goes there");
  assertOpenAIProtocolClean(viaEnv);
  assertOpenAIProtocolClean(viaConfig);
});

test(`${MOCK_LABEL} R-20 D2와 반대 방향: 두 키와 두 주소 변수가 있어도 각 제공자의 키는 자기 주소로만 간다`, { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  const openai = await startFakeOpenAI(t, [], { models: { models: FAKE_OPENAI_MODEL_CATALOG } });
  const anthropic = await startFakeAnthropic(t, [], { models: { pageSize: 10, models: FAKE_MODEL_CATALOG } });
  const env = cliEnv({
    fakeApiKey: FAKE_API_KEY,
    fakeOpenAiKey: FAKE_OPENAI_KEY,
    extra: { [CODARYN_API_BASE_URL_ENV]: anthropic.url, [CODARYN_OPENAI_API_BASE_URL_ENV]: openai.baseUrl },
  });
  // R-20 D2: the config chooses openai; `models` used to send the Anthropic key to CODARYN_API_BASE_URL.
  const config = writeConfigFile(sb, openAIConfig(null));
  const listed = await runGuarded(sb, ["models", "--config", config, "--json"], env);
  assert.equal(listed.exitCode, 0, listed.stdout);
  assert.equal((JSON.parse(listed.stdout.trim()) as { provider?: string }).provider, "openai");
  assert.equal(anthropic.requests.length, 0, "R-20 D2: nothing goes to the Anthropic address");
  assert.equal(openAIModelsRequests(openai).length, 1);

  const anthropicListed = await runGuarded(sb, ["models", "--provider", "anthropic", "--config", config, "--json"], env);
  assert.equal(anthropicListed.exitCode, 0, anthropicListed.stdout);
  assert.ok(anthropic.requests.length >= 1, "--provider anthropic lists from the Anthropic address");
  assert.equal(openAIModelsRequests(openai).length, 1, "and sends nothing to the OpenAI address");

  assert.ok(bearerKeysOf(openai).every((key) => key === FAKE_OPENAI_KEY), "the OpenAI address gets the OpenAI key");
  assert.ok(anthropic.requests.every((request) => request.headers["x-api-key"] === FAKE_API_KEY), "the Anthropic address gets the Anthropic key");
  assert.deepEqual(findLeaks([...openAIBodySources(openai), ...openAIOtherHeaderSources(openai), ...bearerKeysOf(openai).map((key, index) => ({ label: `bearer ${index}`, text: key }))], [FAKE_API_KEY]), [], "no Anthropic key at the OpenAI address");
  assert.deepEqual(findLeaks([...bodySources(anthropic), ...otherHeaderSources(anthropic), ...anthropic.requests.map((request) => ({ label: `x-api-key ${request.index}`, text: request.headers["x-api-key"] ?? "" }))], [FAKE_OPENAI_KEY]), [], "no OpenAI key at the Anthropic address");
  assertOpenAIProtocolClean(openai);
});

test(`${MOCK_LABEL} SP-I03 두 키가 다 있으면 어느 제공자로 실행해도 다른 제공자의 키(20자 이상)가 작업 파일에서 가려진다`, { timeout: 120_000 }, async (t) => {
  // An OpenAI run reads a file holding the Anthropic key.
  const sbOpenAI = createSandbox(t);
  writeWorkspaceFile(sbOpenAI, "keys.txt", `anthropic=${FAKE_API_KEY}\n`);
  writeWorkspaceFile(sbOpenAI, SEED, "seed\n");
  const openai = await startFakeOpenAI(t, [replyCalls([fnCall("call_r1", "read_file", { path: "keys.txt" })]), replyFinal("read")]);
  const anthropicUnused = await startFakeAnthropic(t, []);
  const bothKeys = (extra: Record<string, string>): NodeJS.ProcessEnv => cliEnv({ fakeApiKey: FAKE_API_KEY, fakeOpenAiKey: FAKE_OPENAI_KEY, extra });
  const openaiRun = await runGuarded(
    sbOpenAI,
    ["run", "--task", writeOpenAITask(sbOpenAI, { id: "o02-both-openai", verifiers: [SEED_RULE] })],
    bothKeys({ [CODARYN_OPENAI_API_BASE_URL_ENV]: openai.baseUrl, [CODARYN_API_BASE_URL_ENV]: anthropicUnused.url }),
  );
  const openaiResult = expectRunResult(openaiRun, "openai");
  assert.deepEqual([openaiResult.status, openaiResult.reason], ["done", "verified"]);
  const toolOutput = functionCallOutputsOf(responsesRequests(openai)[1] ?? assert.fail())[0]?.output ?? "";
  assert.ok(toolOutput.includes(PRIVACY_TOKEN_PREFIX), "the Anthropic key in the file is replaced by a token");
  assert.equal(anthropicUnused.requests.length, 0);
  assert.deepEqual(
    findLeaks([...openAIBodySources(openai), ...openAIOtherHeaderSources(openai), ...cliOutputSources(sbOpenAI.workspace, openaiRun)], [FAKE_API_KEY, FAKE_OPENAI_KEY], { extended: true }),
    [],
  );

  // An Anthropic run reads a file holding the OpenAI key.
  const sbAnthropic = createSandbox(t);
  writeWorkspaceFile(sbAnthropic, "keys.txt", `openai=${FAKE_OPENAI_KEY}\n`);
  writeWorkspaceFile(sbAnthropic, SEED, "seed\n");
  const anthropic = await startFakeAnthropic(t, [replyTools([toolUse("toolu_r1", "read_file", { path: "keys.txt" })]), replyText("read")]);
  const openaiUnused = await startFakeOpenAI(t, []);
  const anthropicRun = await runGuarded(
    sbAnthropic,
    ["run", "--task", writeAnthropicTask(sbAnthropic, { id: "o02-both-anthropic", model: "cdy-fake-model-task", maxOutputTokens: 512, verifiers: [SEED_RULE] })],
    bothKeys({ [CODARYN_API_BASE_URL_ENV]: anthropic.url, [CODARYN_OPENAI_API_BASE_URL_ENV]: openaiUnused.baseUrl }),
  );
  const anthropicResult = expectRunResult(anthropicRun, "anthropic");
  assert.deepEqual([anthropicResult.status, anthropicResult.reason], ["done", "verified"]);
  assert.equal(openaiUnused.requests.length, 0);
  assert.deepEqual(
    findLeaks([...bodySources(anthropic), ...otherHeaderSources(anthropic), ...cliOutputSources(sbAnthropic.workspace, anthropicRun)], [FAKE_API_KEY, FAKE_OPENAI_KEY], { extended: true }),
    [],
  );
});

test(`${MOCK_LABEL} R-20 E 다른 제공자 키 변수의 자리표시자(EMPTY, ollama, x)는 비밀이 아니다: 그 단어가 든 파일을 고치고 명령도 돈다`, { timeout: 120_000 }, async (t) => {
  const firstLine = 'client = OpenAI(api_key="EMPTY", base_url="http://localhost:11434/v1")  # ollama';
  const before = `${firstLine}\nmode = "draft"\n`;
  for (const placeholder of OTHER_KEY_PLACEHOLDERS) {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "app.py", before);
    const steps = [
      callStep("c-read", "read_file", { path: "app.py" }),
      callStep("c-write", "write_file", { path: "app.py", expectedHash: sha256Hex(before), change: { kind: "replace_text", oldText: 'mode = "draft"', newText: 'mode = "final"' } }),
      callStep("c-run", "run_command", { executable: NODE, args: ["-e", "process.stdout.write('ran')"] }),
      finalStep("done"),
    ];
    const taskPath = writeTask(
      sb,
      {
        id: "o02-placeholder",
        commands: [{ executable: NODE, argsPrefix: ["-e"], allowExtraArgs: true }],
        verifiers: [{ id: "mode", kind: "file_rules", rules: [{ type: "contains", path: "app.py", text: 'mode = "final"' }] }],
      },
      steps,
    );
    // A scripted run (no network at all) with only the OpenAI variable set to the placeholder.
    const run = await runGuarded(sb, ["run", "--task", taskPath], cliEnv({ fakeOpenAiKey: placeholder }));
    const result = expectRunResult(run);
    assert.deepEqual([result.status, result.reason], ["done", "verified"], `${placeholder}: ${run.stderr.slice(-400)}`);
    assert.equal(readFileSync(join(sb.workspace, "app.py"), "utf8"), `${firstLine}\nmode = "final"\n`, `${placeholder}: the line beside the placeholder is changed`);
    const files = readRunFiles(sb.workspace, result);
    const errors = files.records.flatMap((record) => (record.type === "tool_result" && !record.result.ok ? [record.result.errorCode] : []));
    assert.deepEqual(errors, [], `${placeholder}: no protected_span_violation, no spawn_failed`);
    assert.equal(files.journalText.includes(PRIVACY_TOKEN_PREFIX), false, `${placeholder}: no word of the run became a secret token`);
  }
});

test(`${MOCK_LABEL} OpenAI를 고른 실행에 OPENAI_API_KEY가 없으면 provider_not_configured: 다른 제공자의 키를 쓰지 않고 어디에도 보내지 않는다`, { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, SEED, "seed\n");
  const openai = await startFakeOpenAI(t, [replyFinal("never")]);
  const anthropic = await startFakeAnthropic(t, [replyText("never")]);
  const run = await runGuarded(
    sb,
    ["run", "--task", writeOpenAITask(sb, { id: "o02-no-key", verifiers: [SEED_RULE] })],
    cliEnv({ fakeApiKey: FAKE_API_KEY, extra: { [CODARYN_OPENAI_API_BASE_URL_ENV]: openai.baseUrl, [CODARYN_API_BASE_URL_ENV]: anthropic.url } }),
  );
  expectCliError(run, "provider_not_configured");
  assert.equal(openai.requests.length + anthropic.requests.length, 0, "nothing is sent anywhere");
  assert.deepEqual(findLeaks([{ label: "stdout", text: run.stdout }, { label: "stderr", text: run.stderr }], [FAKE_API_KEY]), []);
});
