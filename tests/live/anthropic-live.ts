/**
 * 실제 API 점검 (REAL Anthropic API, 모의 아님). Not part of any default npm command. Never run in
 * this repository so far (only the skip without the variables was checked).
 *
 * - Runs only when CODARYN_LIVE=1, ANTHROPIC_API_KEY and CODARYN_MODEL are all set in the
 *   environment. Otherwise every test is reported as skipped and nothing is sent.
 * - `npm test`, `test:unit` and `test:integration` never pick it up: the file name does not end in
 *   `.test.ts`, and it compiles to dist/tests/live/. The user runs it on purpose, see README.md.
 * - Two small tasks, each with the same fixed caps: 4 model turns, 4 tool calls, 1 retry per
 *   request, 1024 output tokens per request, 30000 total tokens, 3 minutes. At most 8 HTTP requests
 *   each, 16 in all.
 *   1. a document task: add a section to README.md (file_rules verifier);
 *   2. U-101: a code task: fix a small function so a command verifier passes (this Node.js runs
 *      check.mjs, which the policy protects from writes).
 * - The key is passed to the CLI process only. It is never printed: outputs are scanned for it
 *   before anything else and only variant names are reported.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { ANTHROPIC_API_KEY_ENV, CODARYN_MODEL_ENV, STATE_DIR_NAME } from "../../src/contracts/index.js";
import type { Limits } from "../../src/contracts/index.js";
import { writeAnthropicTask, writeConfigFile } from "../fixtures/anthropic.js";
import { createSandbox, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { startCli } from "../support/cli.js";
import { findLeaks, readTreeTexts } from "../support/leak.js";
import { LIVE_SWITCH_ENV, jsonLine, liveEnvWith, liveSkipReason } from "./live-support.js";

/** Must equal "1" for the live check to run (live-support.ts, re-exported for older references). */
export { LIVE_SWITCH_ENV };

export const LIVE_LIMITS: Limits = { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 30_000, maxDurationMs: 180_000 };
export const LIVE_MAX_OUTPUT_TOKENS = 1024;
export const LIVE_MAX_RETRIES = 1;

const NAMES = [ANTHROPIC_API_KEY_ENV, CODARYN_MODEL_ENV] as const;
const skipReason = (): string | false => liveSkipReason("Anthropic", NAMES);
/** No CODARYN_API_BASE_URL is passed: the explicit config file and the official address are used. */
const liveEnv = (): NodeJS.ProcessEnv => liveEnvWith(NAMES);

const CONFIG = {
  schemaVersion: 1,
  maxOutputTokens: LIVE_MAX_OUTPUT_TOKENS,
  maxRetries: LIVE_MAX_RETRIES,
  requestTimeoutMs: 120_000,
};

/** Runs the task through the CLI, checks the key first, then returns the run's JSON output. */
async function liveRun(t: TestContext, sb: Sandbox, taskPath: string) {
  const key = process.env[ANTHROPIC_API_KEY_ENV] ?? "";
  const configPath = writeConfigFile(sb, CONFIG);
  const run = await startCli(["run", "--task", taskPath, "--config", configPath], { cwd: sb.base, env: liveEnv(), timeoutMs: 240_000 }).done;

  // The key check comes first, so a leak is reported by variant name before any output is shown.
  const stateDir = join(sb.workspace, STATE_DIR_NAME);
  const sources = [{ label: "stdout", text: run.stdout }, { label: "stderr", text: run.stderr }, ...(existsSync(stateDir) ? readTreeTexts(stateDir, sb.workspace) : [])];
  assert.deepEqual(findLeaks(sources, [key]), [], "the API key must not appear in any output or record");

  assert.equal(run.timedOut, false, "the CLI must finish within 4 minutes");
  const output = jsonLine(run.stdout);
  if (output.kind !== "run") assert.fail(`the CLI stopped before the run: ${output.code} (${output.message})`);
  t.diagnostic(
    `status=${output.status} reason=${output.reason} turns=${output.usage.modelTurns} ` +
      `inputTokens=${String(output.usage.inputTokens)} outputTokens=${String(output.usage.outputTokens)}`,
  );
  assert.equal(output.provider, "anthropic");
  assert.ok(output.usage.modelTurns <= LIVE_LIMITS.maxModelTurns, "the turn cap must hold");
  return output;
}

const README_BEFORE = "# 점검용 문서\n\n소개 문단.\n";

test("실제 API 점검(모의 아님): 작은 문서 작업 하나", { skip: skipReason(), timeout: 300_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", README_BEFORE);
  const taskPath = writeAnthropicTask(sb, {
    id: "live-check",
    goal:
      "README.md 끝에 '## 점검' 제목과 그 아래 한 줄 설명을 추가한다. " +
      "read_file로 읽고 그 hash를 expectedHash로 넣어 write_file의 replace_text로 바꾼다. 다른 파일은 건드리지 않는다.",
    workflow: "document",
    limits: LIVE_LIMITS,
    verifiers: [{ id: "doc", kind: "file_rules", rules: [{ type: "contains", path: "README.md", text: "## 점검" }] }],
  });
  const output = await liveRun(t, sb, taskPath);
  assert.equal(output.status, "done", "the live document task should be verified");
  assert.ok(readFileSync(join(sb.workspace, "README.md"), "utf8").startsWith(README_BEFORE), "the original text stays");
});

const MATH_BEFORE = "export function add(a, b) {\n  return a - b;\n}\n";
const CHECK = [
  'import { add } from "./math.mjs";',
  "if (add(2, 3) !== 5 || add(-1, 1) !== 0) {",
  '  console.error("add is wrong");',
  "  process.exit(1);",
  "}",
  'console.log("add is right");',
  "",
].join("\n");

test("실제 API 점검(모의 아님): 작은 코드 작업 하나(검증기 통과)", { skip: skipReason(), timeout: 300_000 }, async (t) => {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "math.mjs", MATH_BEFORE);
  writeWorkspaceFile(sb, "check.mjs", CHECK);
  const taskPath = writeAnthropicTask(sb, {
    id: "live-code",
    goal:
      "math.mjs의 add 함수가 두 수를 더하도록 고친다. read_file로 읽고 그 hash를 expectedHash로 넣어 " +
      "write_file의 replace_text로 바꾼다. check.mjs와 다른 파일은 건드리지 않는다. 다 하면 도구 없이 짧게 답한다.",
    workflow: "code",
    limits: LIVE_LIMITS,
    // The verifier is the person's own check; the model cannot write it (protectedPaths).
    verifiers: [{ id: "check", kind: "command", executable: process.execPath, args: ["check.mjs"] }],
    extraTop: { policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, protectedPaths: ["check.mjs"] } },
  });
  const output = await liveRun(t, sb, taskPath);
  assert.equal(output.status, "done", "the live code task should pass its verifier");
  assert.equal(output.verifiers[0]?.outcome, "pass");
  assert.equal(readFileSync(join(sb.workspace, "check.mjs"), "utf8"), CHECK, "the check stays as written");
  assert.match(readFileSync(join(sb.workspace, "math.mjs"), "utf8"), /a\s*\+\s*b/);
});
