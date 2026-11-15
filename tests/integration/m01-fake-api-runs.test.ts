/**
 * 모의 API 검증 (실제 API 아님), E3 (a)(b)(c)(k).
 * The CLI runs with provider "anthropic" against a local fake Messages API server
 * (tests/support/fake-anthropic.ts) named by CODARYN_API_BASE_URL or the config file's apiBaseUrl.
 * Only a fake key and fake secrets are used. The network guard lets the CLI reach 127.0.0.1 only.
 * Passing says nothing about the real Anthropic API.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  CODARYN_API_BASE_URL_ENV,
  CODARYN_MODEL_ENV,
  PRIVACY_TOKEN_PREFIX,
  QUICK_TASK_ID,
} from "../../src/contracts/index.js";
import type { ModelErrorKind } from "../../src/contracts/index.js";
import {
  ANTHROPIC_LIMITS,
  FAKE_MODEL_CONFIG,
  FAKE_MODEL_ENV,
  FAKE_MODEL_TASK,
  fakeApiConfig,
  writeAnthropicTask,
  writeConfigFile,
} from "../fixtures/anthropic.js";
import { createSandbox, nodeCommand, writeWorkspaceFile } from "../fixtures/builders.js";
import { writeProgram } from "../fixtures/programs.js";
import {
  FAKE_API_KEY,
  FAKE_SECRET_A,
  FAKE_SECRET_B,
  FAKE_SECRET_ENV_A,
  FAKE_SECRET_ENV_B,
} from "../fixtures/secrets.js";
import { NODE, cliEnv, expectRunResult, readRunFiles, sha256Hex } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import {
  MOCK_LABEL,
  assertProtocolClean,
  assertToolDefinitions,
  bodySources,
  cliOutputSources,
  otherHeaderSources,
  replyError,
  replyText,
  replyTools,
  requestAt,
  runGuarded,
  sentMaxTokens,
  sentModels,
  startFakeAnthropic,
  text,
  toolResultText,
  toolUse,
} from "../support/fake-anthropic.js";
import type { FakeAnthropic } from "../support/fake-anthropic.js";
import { decodedSource, findLeaks } from "../support/leak.js";

const MATH_BUG = "export function add(a, b) {\n  return a - b;\n}\n";
const MATH_FIXED = "export function add(a, b) {\n  return a + b;\n}\n";

const DOC_BEFORE = "# 안내서\n\n소개 문단.\n";
const DOC_AFTER = "# 안내서\n\n소개 문단.\n\n## 설치\n\nnpm install 로 설치한다.\n";

/** The fake key is only in `x-api-key` of every request, and nowhere in bodies, headers or outputs. */
function assertKeyOnlyInHeader(api: FakeAnthropic, workspace: string, run: CliRun): void {
  assert.ok(api.requests.length > 0, "the fake server must have received requests");
  for (const request of api.requests) {
    assert.ok(request.headers["x-api-key"] === FAKE_API_KEY, `request ${request.index}: x-api-key must carry the fake key`);
  }
  const sources = [...otherHeaderSources(api), ...bodySources(api), ...cliOutputSources(workspace, run)];
  assert.deepEqual(findLeaks(sources, [FAKE_API_KEY]), [], "the fake key may appear in x-api-key only");
}

test(`${MOCK_LABEL} E3-a 코드 작업: 가짜 서버로 읽기·수정·명령 -> done, 사용량 합계`, { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "src/math.mjs", MATH_BUG);
  writeProgram(sb, "check-add.mjs");
  const usage = [
    { input_tokens: 120, output_tokens: 30 },
    { input_tokens: 150, output_tokens: 40 },
    { input_tokens: 180, output_tokens: 25 },
    { input_tokens: 200, output_tokens: 10 },
  ] as const;
  const api = await startFakeAnthropic(t, [
    replyTools([text("파일을 먼저 읽는다"), toolUse("toolu_r1", "read_file", { path: "src/math.mjs" })], usage[0]),
    replyTools(
      [
        toolUse("toolu_w1", "write_file", {
          path: "src/math.mjs",
          expectedHash: sha256Hex(MATH_BUG),
          change: { kind: "replace_text", oldText: "return a - b;", newText: "return a + b;" },
        }),
      ],
      usage[1],
    ),
    replyTools([toolUse("toolu_c1", "run_command", { executable: NODE, args: ["check-add.mjs"] })], usage[2]),
    replyText("수정하고 확인 명령을 실행했다", usage[3]),
  ]);
  const taskPath = writeAnthropicTask(sb, {
    id: "m01-code",
    goal: "src/math.mjs의 add 버그를 고친다",
    workflow: "code",
    model: FAKE_MODEL_TASK,
    maxOutputTokens: 800,
    commands: [nodeCommand("check-add.mjs")],
    verifiers: [{ id: "check", kind: "command", executable: NODE, args: ["check-add.mjs"], expectExitCode: 0 }],
  });

  const run = await runGuarded(
    sb,
    ["run", "--task", taskPath],
    cliEnv({ fakeApiKey: FAKE_API_KEY, extra: { [CODARYN_API_BASE_URL_ENV]: api.url } }),
  );
  const result = expectRunResult(run, "anthropic");
  const files = readRunFiles(sb.workspace, result);

  await t.test("the run is done and the file is fixed", () => {
    assert.equal(run.exitCode, 0);
    assert.equal(result.status, "done");
    assert.equal(result.reason, "verified");
    assert.equal(readFileSync(join(sb.workspace, "src", "math.mjs"), "utf8"), MATH_FIXED);
    assert.equal(result.changes.length, 1);
  });

  await t.test("requests follow the Messages API shape and the resolved settings", () => {
    assertProtocolClean(api);
    assert.equal(api.requests.length, 4);
    assert.deepEqual(sentModels(api), Array(4).fill(FAKE_MODEL_TASK));
    assert.deepEqual(sentMaxTokens(api), Array(4).fill(800));
    assertToolDefinitions(requestAt(api, 0), ["read_file", "write_file", "run_command"]);
  });

  await t.test("each tool result goes back paired with its tool_use id", () => {
    assert.ok(toolResultText(requestAt(api, 1), "toolu_r1").includes(sha256Hex(MATH_BUG)), "read result carries the hash");
    toolResultText(requestAt(api, 2), "toolu_w1");
    toolResultText(requestAt(api, 3), "toolu_c1");
  });

  await t.test("usage is the sum of the reported usage", () => {
    assert.equal(result.usage.modelTurns, 4);
    assert.equal(result.usage.toolCalls, 3);
    assert.equal(result.usage.inputTokens, 650);
    assert.equal(result.usage.outputTokens, 105);
    const recorded = files.records.flatMap((record) => (record.type === "model_response" ? [record.usage] : []));
    assert.deepEqual(
      recorded,
      usage.map((u) => ({ inputTokens: u.input_tokens, outputTokens: u.output_tokens })),
    );
  });
});

test(`${MOCK_LABEL} E3-a 문서 작업: Git·PATH 없이 가짜 서버로 -> done`, { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", DOC_BEFORE);
  const api = await startFakeAnthropic(t, [
    replyTools([toolUse("toolu_r1", "read_file", { path: "README.md" })]),
    replyTools([
      toolUse("toolu_w1", "write_file", {
        path: "README.md",
        expectedHash: sha256Hex(DOC_BEFORE),
        change: { kind: "replace_text", oldText: "소개 문단.\n", newText: "소개 문단.\n\n## 설치\n\nnpm install 로 설치한다.\n" },
      }),
    ]),
    replyText("설치 절을 추가했다"),
  ]);
  const configPath = writeConfigFile(sb, fakeApiConfig(api.url, { maxOutputTokens: 600 }));
  const taskPath = writeAnthropicTask(sb, {
    id: "m01-doc",
    goal: "README.md에 설치 절을 추가한다",
    workflow: "document",
    verifiers: [{ id: "doc", kind: "file_rules", rules: [{ type: "contains", path: "README.md", text: "## 설치" }] }],
  });

  const run = await runGuarded(
    sb,
    ["run", "--task", taskPath, "--config", configPath],
    cliEnv({ fakeApiKey: FAKE_API_KEY, omitPath: true, extra: { [CODARYN_MODEL_ENV]: FAKE_MODEL_ENV } }),
  );
  const result = expectRunResult(run, "anthropic");
  readRunFiles(sb.workspace, result);

  assert.equal(run.exitCode, 0);
  assert.equal(result.status, "done");
  assert.equal(readFileSync(join(sb.workspace, "README.md"), "utf8"), DOC_AFTER);
  assert.equal(existsSync(join(sb.workspace, ".git")), false);
  assertProtocolClean(api);
  assert.equal(api.requests.length, 3);
  assert.deepEqual(sentModels(api), Array(3).fill(FAKE_MODEL_ENV));
  assert.deepEqual(sentMaxTokens(api), Array(3).fill(600));
});

test(`${MOCK_LABEL} E3-b 가짜 키는 x-api-key 헤더에만 있다(성공 실행과 401 실행)`, { timeout: 90_000 }, async (t) => {
  await t.test("successful run", async (st) => {
    const sb = createSandbox(st);
    writeWorkspaceFile(sb, "README.md", DOC_BEFORE);
    const api = await startFakeAnthropic(st, [
      replyTools([toolUse("toolu_r1", "read_file", { path: "README.md" })]),
      replyText("읽었다"),
    ]);
    const configPath = writeConfigFile(sb, fakeApiConfig(api.url, { model: FAKE_MODEL_CONFIG }));
    const taskPath = writeAnthropicTask(sb, {
      id: "m01-key-ok",
      verifiers: [{ id: "doc", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] }],
    });
    const run = await runGuarded(sb, ["run", "--task", taskPath, "--config", configPath], cliEnv({ fakeApiKey: FAKE_API_KEY }));
    const result = expectRunResult(run, "anthropic");
    readRunFiles(sb.workspace, result);
    assert.equal(result.status, "done");
    assertProtocolClean(api);
    assertKeyOnlyInHeader(api, sb.workspace, run);
  });

  await t.test("run that ends with HTTP 401", async (st) => {
    const sb = createSandbox(st);
    writeWorkspaceFile(sb, "README.md", DOC_BEFORE);
    const api = await startFakeAnthropic(st, [
      replyTools([toolUse("toolu_r1", "read_file", { path: "README.md" })]),
      replyError(401, "authentication_error"),
    ]);
    const configPath = writeConfigFile(sb, fakeApiConfig(api.url, { model: FAKE_MODEL_CONFIG }));
    const taskPath = writeAnthropicTask(sb, { id: "m01-key-401" });
    const run = await runGuarded(sb, ["run", "--task", taskPath, "--config", configPath], cliEnv({ fakeApiKey: FAKE_API_KEY }));
    const result = expectRunResult(run, "anthropic");
    const files = readRunFiles(sb.workspace, result);
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "model_error");
    const expected: ModelErrorKind = "auth_failed";
    const kinds = files.records.flatMap((record) => (record.type === "model_error" ? [record.kind] : []));
    assert.deepEqual(kinds, [expected]);
    assertKeyOnlyInHeader(api, sb.workspace, run);
  });

  await t.test("key value inside a workspace file is masked like a secret (cli-contract 11)", async (st) => {
    const sb = createSandbox(st);
    writeWorkspaceFile(sb, "notes/keys.txt", `메모: ${FAKE_API_KEY}\n`);
    const api = await startFakeAnthropic(st, [
      replyTools([toolUse("toolu_r1", "read_file", { path: "notes/keys.txt" })]),
      replyText("읽었다"),
    ]);
    const configPath = writeConfigFile(sb, fakeApiConfig(api.url, { model: FAKE_MODEL_CONFIG }));
    const taskPath = writeAnthropicTask(sb, {
      id: "m01-key-in-file",
      verifiers: [{ id: "keys", kind: "file_rules", rules: [{ type: "exists", path: "notes/keys.txt" }] }],
    });
    const run = await runGuarded(sb, ["run", "--task", taskPath, "--config", configPath], cliEnv({ fakeApiKey: FAKE_API_KEY }));
    const result = expectRunResult(run, "anthropic");
    readRunFiles(sb.workspace, result);
    assert.equal(result.status, "done");
    assertProtocolClean(api);
    assert.ok(toolResultText(requestAt(api, 1), "toolu_r1").includes(PRIVACY_TOKEN_PREFIX), "the key is masked, not dropped");
    assertKeyOnlyInHeader(api, sb.workspace, run);
  });
});

test(`${MOCK_LABEL} E3-c 요청 본문에 가짜 비밀 원문과 정해진 변형이 없다`, { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "data/secret-source.txt", `A=${FAKE_SECRET_A}\nB=${FAKE_SECRET_B}\n`);
  writeProgram(sb, "print-secret.mjs");
  const api = await startFakeAnthropic(t, [
    // Model output that repeats a secret must be masked before it is echoed back.
    replyTools([text(`확인 중 ${FAKE_SECRET_A}`), toolUse("toolu_r1", "read_file", { path: "data/secret-source.txt" })]),
    replyTools([toolUse("toolu_c1", "run_command", { executable: NODE, args: ["print-secret.mjs"] })]),
    replyTools([toolUse("toolu_m1", "read_file", { path: `missing-${FAKE_SECRET_A}.txt` })]),
    replyText("끝"),
  ]);
  const configPath = writeConfigFile(sb, fakeApiConfig(api.url, { model: FAKE_MODEL_CONFIG }));
  const taskPath = writeAnthropicTask(sb, {
    id: "m01-canary",
    goal: `카나리 확인 ${FAKE_SECRET_A}`,
    secretEnv: [FAKE_SECRET_ENV_A, FAKE_SECRET_ENV_B],
    commands: [nodeCommand("print-secret.mjs")],
    verifiers: [{ id: "source", kind: "file_rules", rules: [{ type: "exists", path: "data/secret-source.txt" }] }],
  });
  const run = await runGuarded(
    sb,
    ["run", "--task", taskPath, "--config", configPath],
    cliEnv({ fakeApiKey: FAKE_API_KEY, extra: { [FAKE_SECRET_ENV_A]: FAKE_SECRET_A, [FAKE_SECRET_ENV_B]: FAKE_SECRET_B } }),
  );
  const result = expectRunResult(run, "anthropic");
  readRunFiles(sb.workspace, result);

  await t.test("no raw value or listed variant in any request body (as sent and decoded)", () => {
    assert.equal(api.requests.length, 4);
    assert.deepEqual(findLeaks(bodySources(api), [FAKE_SECRET_A, FAKE_SECRET_B]), []);
  });

  await t.test("no raw value or listed variant in headers, stdout, stderr or the state directory", () => {
    const sources = [...otherHeaderSources(api), ...cliOutputSources(sb.workspace, run)];
    assert.deepEqual(findLeaks(sources, [FAKE_SECRET_A, FAKE_SECRET_B]), []);
  });

  await t.test("secrets were masked, not dropped: goal, file content and command output carry tokens", () => {
    const decoded = (index: number): string => {
      const request = requestAt(api, index);
      return decodedSource("body", request.bodyText, false).text;
    };
    assert.ok(decoded(0).includes(PRIVACY_TOKEN_PREFIX), "the goal reaches the model masked");
    assert.ok(toolResultText(requestAt(api, 1), "toolu_r1").includes(PRIVACY_TOKEN_PREFIX), "file content masked");
    assert.ok(toolResultText(requestAt(api, 2), "toolu_c1").includes(PRIVACY_TOKEN_PREFIX), "command output masked");
  });

  await t.test("the run ends verified and every request was well formed", () => {
    assertProtocolClean(api);
    assert.equal(result.status, "done");
  });
});

test(`${MOCK_LABEL} E3-k 간편 형식 --workspace --goal 실행 -> done`, { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  const goal = "NOTES.md 파일을 만들고 요약 절을 쓴다";
  const notes = "# 노트\n\n## 요약\n\n간편 형식으로 만든 파일.\n";
  const api = await startFakeAnthropic(t, [
    replyTools([
      toolUse("toolu_w1", "write_file", {
        path: "NOTES.md",
        expectedHash: null,
        change: { kind: "replace_all", content: notes },
      }),
    ]),
    replyText("NOTES.md를 만들었다"),
  ]);
  const configPath = writeConfigFile(
    sb,
    fakeApiConfig(api.url, {
      model: FAKE_MODEL_CONFIG,
      maxOutputTokens: 700,
      // S-7: no anthropic run without a token limit.
      limits: ANTHROPIC_LIMITS,
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
      verifiers: [{ id: "notes", kind: "file_rules", rules: [{ type: "contains", path: "NOTES.md", text: "## 요약" }] }],
    }),
  );

  const run = await runGuarded(
    sb,
    ["run", "--workspace", sb.workspace, "--goal", goal, "--config", configPath],
    cliEnv({ fakeApiKey: FAKE_API_KEY }),
  );
  const result = expectRunResult(run, "anthropic");
  const files = readRunFiles(sb.workspace, result);

  assert.equal(run.exitCode, 0);
  assert.equal(result.status, "done");
  assert.equal(result.taskId, QUICK_TASK_ID);
  assert.equal(readFileSync(join(sb.workspace, "NOTES.md"), "utf8"), notes);
  const started = files.records[0];
  assert.ok(started?.type === "run_started" && started.provider === "anthropic");
  assertProtocolClean(api);
  assert.equal(api.requests.length, 2);
  assert.deepEqual(sentModels(api), [FAKE_MODEL_CONFIG, FAKE_MODEL_CONFIG]);
  assert.deepEqual(sentMaxTokens(api), [700, 700]);
  const firstBody = decodedSource("body", requestAt(api, 0).bodyText, false).text;
  assert.ok(firstBody.includes(goal), "the goal from --goal reaches the model");
});
