/**
 * G-G: workflow definitions and document writing (docs/design/general-tasks.md 4 and 5.1,
 * src/contracts/workflow.ts, GT-D1 to GT-D3). A definition registered only in the user's config
 * file runs without engine changes (GI-01); the task narrows but never widens it; resolution errors
 * name a field and no value; the built-in `document` offers no command tool; tasks without
 * `workflowRef` run as before stage 4. The last cases run against the local fake server (mock API,
 * not the real API) to show what a model is offered. Scripted model otherwise; no key; every
 * command behind the network guard.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { STATE_DIR_NAME } from "../../src/contracts/index.js";
import type { CliErrorCode, JournalRecord, JsonObject } from "../../src/contracts/index.js";
import { ANTHROPIC_LIMITS, fakeApiConfig, writeAnthropicTask, writeConfigFile } from "../fixtures/anthropic.js";
import { createSandbox, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import {
  MEMO_INSTRUCTIONS,
  MEMO_PATH,
  MEMO_TEXT,
  MEMO_WORKFLOW,
  ORGANIZE_ACTIONS,
  ORGANIZE_PLAN_ACTIONS,
  createFileArgs,
  memoScript,
  proposePlanArgs,
  textStep,
  toolStep,
  writeGeneralTask,
  writeOrganizeWorkspace,
} from "../fixtures/general-tasks.js";
import { FAKE_API_KEY, FAKE_SECRET_A, FAKE_SECRET_ENV_A } from "../fixtures/secrets.js";
import { cliEnv, expectCliError, expectRunResult, readRunFiles } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { MOCK_LABEL, bodyOf, messagesRequests, replyText, replyTools, runGuarded, startFakeAnthropic, toolUse } from "../support/fake-anthropic.js";
import { decodedSource, findLeaks } from "../support/leak.js";
import { assertNotPrinted } from "../support/usability.js";

const README_EXISTS = [{ id: "readme", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] }];
const MEMO_VERIFIERS = MEMO_WORKFLOW["verifiers"] as JsonObject[];

function cli(sb: Sandbox, args: readonly string[], env: NodeJS.ProcessEnv = cliEnv()): Promise<CliRun> {
  return runGuarded(sb, args, env);
}

function started(records: readonly JournalRecord[]): Extract<JournalRecord, { type: "run_started" }> {
  const first = records[0];
  if (first?.type !== "run_started") assert.fail("the journal starts with run_started");
  return first;
}

function firstSystem(records: readonly JournalRecord[]): string {
  const request = records.find((record) => record.type === "model_request");
  if (request?.type !== "model_request") assert.fail("the run made a model request");
  return request.system ?? "";
}

function refusedBeforeRunning(sb: Sandbox, run: CliRun, code: CliErrorCode): void {
  expectCliError(run, code);
  assert.equal(run.exitCode, 2);
  assert.equal(existsSync(join(sb.workspace, STATE_DIR_NAME)), false, "no state directory, no run");
}

/** A sandbox with README.md and a config file that registers `workflows`. */
function withConfig(sb: Sandbox, workflows: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  writeWorkspaceFile(sb, "README.md", "# 연습\n");
  return writeConfigFile(sb, { schemaVersion: 1, workflows, ...extra }, "user-config.json");
}

test("G-G GI-01 사용자 설정에만 등록한 정의(memo)로 실행: 엔진 변경 없이 등록만으로 된다", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  const config = withConfig(sb, { memo: MEMO_WORKFLOW });
  // A task file states its own verifiers (required), so a definition's verifiers apply to the quick
  // form only; the definition still decides the tools and the instructions.
  const task = writeGeneralTask(sb, { id: "gg-memo", label: "memo", goal: "회의 메모를 만든다", fields: { workflowRef: "memo" }, verifiers: MEMO_VERIFIERS }, memoScript());
  const run = await cli(sb, ["run", "--task", task, "--config", config]);
  const result = expectRunResult(run);
  assert.deepEqual([result.status, result.reason, run.exitCode], ["done", "verified", 0]);
  assert.equal(readFileSync(join(sb.workspace, ...MEMO_PATH.split("/")), "utf8"), MEMO_TEXT);
  const records = readRunFiles(sb.workspace, result).records;
  const first = started(records);
  assert.deepEqual([first.workflowRef, first.tools, first.plan, first.completion], ["memo", ["read_file", "write_file"], "none", "verifiers"]);
  const system = firstSystem(records);
  assert.ok(system.endsWith(MEMO_INSTRUCTIONS), "the definition's instructions follow the fixed system prompt (GT-D3)");
  const firstRequest = records.find((record) => record.type === "model_request");
  assert.ok(firstRequest?.type === "model_request" && !JSON.stringify(firstRequest.newMessages).includes(MEMO_INSTRUCTIONS), "the instructions are not mixed into the goal");
});

test("G-G GG-A02 task는 정의의 도구를 줄일 수만 있다: 줄인 묶음 밖 호출은 unknown_tool", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 연습\n");
  const task = writeGeneralTask(sb, { id: "gg-narrow", label: "document", fields: { workflowRef: "document", tools: ["read_file"] }, verifiers: README_EXISTS }, [
    toolStep("write_file", createFileArgs("notes/x.md", "x\n")),
    textStep("끝"),
  ]);
  const result = expectRunResult(await cli(sb, ["run", "--task", task]));
  const records = readRunFiles(sb.workspace, result).records;
  assert.deepEqual(started(records).tools, ["read_file"]);
  const refused = records.find((record) => record.type === "tool_result" && record.result.tool === "write_file");
  assert.ok(refused?.type === "tool_result" && refused.result.errorCode === "unknown_tool");
  assert.equal(existsSync(join(sb.workspace, "notes", "x.md")), false);
});

test("G-G GG-A03 정의 해석 오류는 실행 전에 멈추고 필드 위치만 알린다", { timeout: 180_000 }, async (t) => {
  const canary = "cdy-unknown-workflow-canary";
  const cases: readonly { label: string; fields?: Record<string, unknown>; policy?: Record<string, unknown>; workflows?: Record<string, unknown>; code: CliErrorCode }[] = [
    { label: "모르는 workflowRef", fields: { workflowRef: canary }, code: "invalid_task" },
    { label: "정의보다 넓은 tools", fields: { workflowRef: "document", tools: ["read_file", "run_command"] }, code: "invalid_task" },
    { label: "organize 아래 plan none", fields: { workflowRef: "organize", plan: "none" }, policy: { planActions: [...ORGANIZE_PLAN_ACTIONS] }, code: "invalid_task" },
    {
      label: "organize 아래 명령 규칙",
      fields: { workflowRef: "organize" },
      policy: { planActions: [...ORGANIZE_PLAN_ACTIONS], commands: [{ executable: "node", argsPrefix: ["x.js"], allowExtraArgs: false }] },
      code: "invalid_task",
    },
    { label: "human_review에 확인 목록 없음", fields: { workflowRef: "document", completion: "human_review" }, code: "invalid_task" },
    { label: "task 파일의 workflows", fields: { workflows: { mine: MEMO_WORKFLOW } }, code: "invalid_task" },
    { label: "설정의 내장 id", workflows: { document: MEMO_WORKFLOW }, code: "invalid_config" },
    { label: "설정의 id 형식", workflows: { "../x": MEMO_WORKFLOW }, code: "invalid_config" },
  ];
  for (const item of cases) {
    await t.test(item.label, async (st) => {
      const sb = createSandbox(st);
      const config = withConfig(sb, item.workflows ?? {});
      const task = writeGeneralTask(sb, { id: "gg-resolve", fields: (item.fields ?? {}) as JsonObject, ...(item.policy === undefined ? {} : { policy: item.policy as JsonObject }) }, [textStep("끝")]);
      const run = await cli(sb, ["run", "--task", task, "--config", config]);
      refusedBeforeRunning(sb, run, item.code);
      assertNotPrinted(run, [canary], "the unknown id");
    });
  }
});

test("G-G GG-A04 정의 지시문의 등록 비밀은 가려져 모델 요청과 기록에 들어간다", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  const config = withConfig(sb, { memo: { ...MEMO_WORKFLOW, instructions: `${MEMO_INSTRUCTIONS} Reference: ${FAKE_SECRET_A}.` } });
  const task = writeGeneralTask(sb, { id: "gg-secret-instructions", fields: { workflowRef: "memo" } }, memoScript());
  const taskJson = JSON.parse(readFileSync(task, "utf8")) as Record<string, unknown>;
  writeFileSync(task, JSON.stringify({ ...taskJson, privacy: { secretEnv: [FAKE_SECRET_ENV_A] } }));
  const run = await cli(sb, ["run", "--task", task, "--config", config], cliEnv({ extra: { [FAKE_SECRET_ENV_A]: FAKE_SECRET_A } }));
  const result = expectRunResult(run);
  const files = readRunFiles(sb.workspace, result);
  assert.ok(firstSystem(files.records).includes(MEMO_INSTRUCTIONS), "the instructions are sent");
  const sources = [
    { label: "journal", text: files.journalText },
    decodedSource("journal", files.journalText, true),
    { label: "stdout", text: run.stdout },
    { label: "stderr", text: run.stderr },
  ];
  assert.deepEqual(findLeaks(sources, [FAKE_SECRET_A], { extended: true }), []);
});

test("G-G GG-A05 task가 정의를 고르지 않으면 --profile의 workflowRef를 쓴다", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  const config = withConfig(sb, { memo: MEMO_WORKFLOW }, { profiles: { notes: { workflowRef: "memo" } } });
  const task = writeGeneralTask(sb, { id: "gg-profile", label: "memo" }, memoScript());
  const result = expectRunResult(await cli(sb, ["run", "--task", task, "--config", config, "--profile", "notes"]));
  const first = started(readRunFiles(sb.workspace, result).records);
  assert.deepEqual([first.workflowRef, first.tools], ["memo", ["read_file", "write_file"]]);
});

test("G-G GI-08 검증기 없는 등록 정의는 no_verifier(검증 없음)로 끝난다", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  const { verifiers: _dropped, ...free } = MEMO_WORKFLOW as { verifiers?: unknown } & Record<string, unknown>;
  const config = withConfig(sb, { free });
  const task = writeGeneralTask(sb, { id: "gg-free", fields: { workflowRef: "free" } }, memoScript());
  const run = await cli(sb, ["run", "--task", task, "--config", config]);
  const result = expectRunResult(run);
  assert.deepEqual([result.status, result.reason, run.exitCode], ["needs-input", "no_verifier", 3]);
  assert.ok(result.notices.some((notice) => notice.includes("no automatic verification")));
});

test("G-G GG-B01 내장 document: 명령 도구가 없고 문서만 쓴다", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "sources/notes.md", "# 원본\n");
  const task = writeGeneralTask(
    sb,
    { id: "gg-document", label: "document", fields: { workflowRef: "document" }, policy: { protectedPaths: ["sources"] }, verifiers: [{ id: "doc", kind: "file_rules", rules: [{ type: "contains", path: "docs/guide.md", text: "# 안내" }] }] },
    [toolStep("run_command", { executable: "node", args: ["--version"] }), toolStep("write_file", createFileArgs("docs/guide.md", "# 안내\n")), textStep("끝")],
  );
  const result = expectRunResult(await cli(sb, ["run", "--task", task]));
  assert.deepEqual([result.status, result.reason], ["done", "verified"]);
  const records = readRunFiles(sb.workspace, result).records;
  assert.deepEqual(started(records).tools, ["read_file", "search_files", "write_file"]);
  const command = records.find((record) => record.type === "tool_result" && record.result.tool === "run_command");
  assert.ok(command?.type === "tool_result" && command.result.errorCode === "unknown_tool");
});

test("G-G GG-B02 workflowRef가 없는 옛 task는 단계 4 이전과 같다(기록에 워크플로 필드 없음)", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 연습\n");
  const task = writeGeneralTask(sb, { id: "gg-legacy", label: "document", verifiers: README_EXISTS }, [textStep("끝")]);
  const result = expectRunResult(await cli(sb, ["run", "--task", task]));
  const first = started(readRunFiles(sb.workspace, result).records) as Record<string, unknown>;
  for (const field of ["workflowRef", "tools", "plan", "completion"]) assert.equal(field in first, false, `run_started has no ${field}`);
  assert.equal(result.status, "done");
});

test(`${MOCK_LABEL} GG-F01 organize의 모델 요청에는 읽기 도구와 inspect_files·propose_plan만 있다`, { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  const original = writeOrganizeWorkspace(sb);
  const api = await startFakeAnthropic(t, [
    replyTools([toolUse("toolu_i1", "inspect_files", { path: ".", hash: true })]),
    replyTools([toolUse("toolu_p1", "propose_plan", proposePlanArgs(ORGANIZE_ACTIONS))]),
    replyText("이 응답은 요청되면 안 된다"),
  ]);
  const config = writeConfigFile(sb, fakeApiConfig(api.url, { model: "cdy-n08-model", maxOutputTokens: 700, limits: ANTHROPIC_LIMITS }));
  const task = writeAnthropicTask(sb, {
    id: "gg-organize-api",
    limits: { ...ANTHROPIC_LIMITS, maxModelTurns: 8 },
    extraTop: { workflowRef: "organize", policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: [...ORGANIZE_PLAN_ACTIONS] } },
  });
  const run = await cli(sb, ["run", "--task", task, "--config", config], cliEnv({ fakeApiKey: FAKE_API_KEY }));
  const result = expectRunResult(run, "anthropic");
  assert.equal(result.reason, "plan_pending");
  const requests = messagesRequests(api);
  assert.equal(requests.length, 2, "the run ends at propose_plan");
  for (const request of requests) {
    const tools = (bodyOf(request)["tools"] as { name: string; input_schema?: unknown }[]).map((tool) => tool.name);
    assert.deepEqual(tools, ["read_file", "search_files", "inspect_files", "propose_plan"]);
  }
  const definitions = bodyOf(requests[0] ?? assert.fail("no request"))["tools"] as { name: string; input_schema?: unknown }[];
  assert.ok(definitions.every((tool) => typeof tool.input_schema === "object"), "every tool has its input schema");
  const filesNow = new Map([...original].map(([path]) => [path, readFileSync(join(sb.workspace, ...path.split("/")))]));
  assert.deepEqual(filesNow, original, "nothing moved before approval");
});

test(`${MOCK_LABEL} GG-F02 정의의 지시문은 요청의 system에 있고 user 메시지에는 없다`, { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 연습\n");
  const api = await startFakeAnthropic(t, [
    replyTools([toolUse("toolu_w1", "write_file", createFileArgs(MEMO_PATH, MEMO_TEXT) as Record<string, unknown>)]),
    replyText("메모를 만들었다"),
  ]);
  const config = writeConfigFile(sb, fakeApiConfig(api.url, { model: "cdy-n08-model", maxOutputTokens: 700, limits: ANTHROPIC_LIMITS, workflows: { memo: MEMO_WORKFLOW } } as never));
  const task = writeAnthropicTask(sb, { id: "gg-memo-api", verifiers: MEMO_VERIFIERS as never, extraTop: { workflowRef: "memo" } });
  const result = expectRunResult(await cli(sb, ["run", "--task", task, "--config", config], cliEnv({ fakeApiKey: FAKE_API_KEY })), "anthropic");
  assert.equal(result.status, "done");
  const body = bodyOf(messagesRequests(api)[0] ?? assert.fail("no request"));
  assert.ok(JSON.stringify(body["system"]).includes(MEMO_INSTRUCTIONS), "the instructions are in system");
  assert.ok(!JSON.stringify(body["messages"]).includes(MEMO_INSTRUCTIONS), "and not in the messages");
  assert.deepEqual((body["tools"] as { name: string }[]).map((tool) => tool.name), ["read_file", "write_file"]);
});
