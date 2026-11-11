/**
 * 실제 API 점검 (REAL Anthropic API, 모의 아님). Not part of any default npm command.
 *
 * - Runs only when CODARYN_LIVE=1, ANTHROPIC_API_KEY and CODARYN_MODEL are all set in the
 *   environment. Otherwise the test is reported as skipped and nothing is sent.
 * - `npm test`, `test:unit` and `test:integration` never pick it up: the file name does not end in
 *   `.test.ts`, and it compiles to dist/tests/live/. The user runs it on purpose, see README.md.
 * - Small fixed caps: 4 model turns, 4 tool calls, 1 retry per request, 1024 output tokens per
 *   request, 30000 total tokens, 3 minutes. At most 8 HTTP requests.
 * - The key is passed to the CLI process only. It is never printed: outputs are scanned for it
 *   before anything else and only variant names are reported.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  ANTHROPIC_API_KEY_ENV,
  CHILD_ENV_ALLOWLIST,
  CODARYN_MODEL_ENV,
  STATE_DIR_NAME,
} from "../../src/contracts/index.js";
import type { CliOutput, Limits } from "../../src/contracts/index.js";
import { writeAnthropicTask, writeConfigFile } from "../fixtures/anthropic.js";
import { createSandbox, writeWorkspaceFile } from "../fixtures/builders.js";
import { startCli } from "../support/cli.js";
import { findLeaks, readTreeTexts } from "../support/leak.js";

/** Must equal "1" for the live check to run. */
export const LIVE_SWITCH_ENV = "CODARYN_LIVE";

export const LIVE_LIMITS: Limits = { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 30_000, maxDurationMs: 180_000 };
export const LIVE_MAX_OUTPUT_TOKENS = 1024;
export const LIVE_MAX_RETRIES = 1;

function skipReason(): string | false {
  const missing: string[] = [];
  if (process.env[LIVE_SWITCH_ENV] !== "1") missing.push(`${LIVE_SWITCH_ENV}=1`);
  if ((process.env[ANTHROPIC_API_KEY_ENV] ?? "") === "") missing.push(ANTHROPIC_API_KEY_ENV);
  if ((process.env[CODARYN_MODEL_ENV] ?? "") === "") missing.push(CODARYN_MODEL_ENV);
  return missing.length === 0 ? false : `실제 API 점검 건너뜀: ${missing.join(", ")} 없음`;
}

/**
 * CHILD_ENV_ALLOWLIST plus the key and the model. Nothing else is passed: no CODARYN_CONFIG and
 * no CODARYN_API_BASE_URL, so the explicit config file below and the official address are used.
 */
function liveEnv(): NodeJS.ProcessEnv {
  const allow = new Set<string>(CHILD_ENV_ALLOWLIST);
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && allow.has(name.toUpperCase())) env[name] = value;
  }
  env[ANTHROPIC_API_KEY_ENV] = process.env[ANTHROPIC_API_KEY_ENV];
  env[CODARYN_MODEL_ENV] = process.env[CODARYN_MODEL_ENV];
  return env;
}

const README_BEFORE = "# 점검용 문서\n\n소개 문단.\n";

test("실제 API 점검(모의 아님): 작은 문서 작업 하나", { skip: skipReason(), timeout: 300_000 }, async (t) => {
  const key = process.env[ANTHROPIC_API_KEY_ENV] ?? "";
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", README_BEFORE);
  const configPath = writeConfigFile(sb, {
    schemaVersion: 1,
    maxOutputTokens: LIVE_MAX_OUTPUT_TOKENS,
    maxRetries: LIVE_MAX_RETRIES,
    requestTimeoutMs: 120_000,
  });
  const taskPath = writeAnthropicTask(sb, {
    id: "live-check",
    goal:
      "README.md 끝에 '## 점검' 제목과 그 아래 한 줄 설명을 추가한다. " +
      "read_file로 읽고 그 hash를 expectedHash로 넣어 write_file의 replace_text로 바꾼다. 다른 파일은 건드리지 않는다.",
    workflow: "document",
    limits: LIVE_LIMITS,
    verifiers: [{ id: "doc", kind: "file_rules", rules: [{ type: "contains", path: "README.md", text: "## 점검" }] }],
  });

  const run = await startCli(["run", "--task", taskPath, "--config", configPath], {
    cwd: sb.base,
    env: liveEnv(),
    timeoutMs: 240_000,
  }).done;

  // The key check comes first, so a leak is reported by variant name before any output is shown.
  const stateDir = join(sb.workspace, STATE_DIR_NAME);
  const sources = [
    { label: "stdout", text: run.stdout },
    { label: "stderr", text: run.stderr },
    ...(existsSync(stateDir) ? readTreeTexts(stateDir, sb.workspace) : []),
  ];
  assert.deepEqual(findLeaks(sources, [key]), [], "the API key must not appear in any output or record");

  assert.equal(run.timedOut, false, "the CLI must finish within 4 minutes");
  const lines = run.stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
  assert.equal(lines.length, 1, "stdout must be one JSON line");
  const output = JSON.parse(lines[0] ?? "") as CliOutput;
  if (output.kind !== "run") assert.fail(`the CLI stopped before the run: ${output.code} (${output.message})`);
  t.diagnostic(
    `status=${output.status} reason=${output.reason} turns=${output.usage.modelTurns} ` +
      `inputTokens=${String(output.usage.inputTokens)} outputTokens=${String(output.usage.outputTokens)}`,
  );
  assert.equal(output.provider, "anthropic");
  assert.ok(output.usage.modelTurns <= LIVE_LIMITS.maxModelTurns, "the turn cap must hold");
  assert.equal(output.status, "done", "the live document task should be verified");
  assert.ok(readFileSync(join(sb.workspace, "README.md"), "utf8").startsWith(README_BEFORE), "the original text stays");
});
