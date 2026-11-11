/**
 * 모의 API 검증 (실제 API 아님), E3 (h)(i): API errors, retries and usage against a local fake
 * Messages API server. The fake answers 429 and 529 with `retry-after: 0` so the tests stay fast;
 * how long the provider waits is not checked here. Only a fake key is used.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import type {
  CodarynConfig,
  EngineResult,
  JournalRecord,
  Limits,
  ModelErrorKind,
  VerifierConfig,
} from "../../src/contracts/index.js";
import { FAKE_MODEL_CONFIG, fakeApiConfig, writeAnthropicTask, writeConfigFile } from "../fixtures/anthropic.js";
import { DEFAULT_LIMITS, createSandbox, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { FAKE_API_KEY } from "../fixtures/secrets.js";
import { cliEnv, expectRunResult, readRunFiles } from "../support/cli.js";
import {
  HANG,
  MOCK_LABEL,
  assertProtocolClean,
  cliOutputSources,
  repeatReply,
  replyError,
  replyText,
  replyTools,
  runGuarded,
  startFakeAnthropic,
  toolUse,
} from "../support/fake-anthropic.js";
import type { FakeAnthropic, FakeReply, GuardedRun } from "../support/fake-anthropic.js";
import { findLeaks } from "../support/leak.js";

/** maxRetries in the config file of these runs, unless a case overrides it. */
const RETRIES = 2;

const README_EXISTS: readonly VerifierConfig[] = [
  { id: "readme", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] },
];

interface FakeRunSetup {
  readonly id: string;
  readonly steps: readonly FakeReply[];
  readonly config?: Partial<CodarynConfig>;
  readonly limits?: Partial<Limits>;
  readonly verifiers?: readonly VerifierConfig[];
}

interface FakeRunOutcome {
  readonly sb: Sandbox;
  readonly api: FakeAnthropic;
  readonly run: GuardedRun;
  readonly result: EngineResult;
  readonly records: readonly JournalRecord[];
}

async function fakeRun(t: TestContext, setup: FakeRunSetup): Promise<FakeRunOutcome> {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 문서\n");
  const api = await startFakeAnthropic(t, setup.steps);
  const configPath = writeConfigFile(
    sb,
    fakeApiConfig(api.url, { model: FAKE_MODEL_CONFIG, maxRetries: RETRIES, requestTimeoutMs: 5_000, ...setup.config }),
  );
  const taskPath = writeAnthropicTask(sb, {
    id: setup.id,
    limits: { ...DEFAULT_LIMITS, maxDurationMs: 120_000, ...setup.limits },
    verifiers: setup.verifiers ?? README_EXISTS,
  });
  const run = await runGuarded(sb, ["run", "--task", taskPath, "--config", configPath], cliEnv({ fakeApiKey: FAKE_API_KEY }), 110_000);
  const result = expectRunResult(run, "anthropic");
  const { records } = readRunFiles(sb.workspace, result);
  return { sb, api, run, result, records };
}

/** The run failed with one model_error of `kind`, and the fake key is in no output. */
function assertModelError(outcome: FakeRunOutcome, kind: ModelErrorKind): void {
  assert.equal(outcome.result.status, "failed");
  assert.equal(outcome.result.reason, "model_error");
  assert.equal(outcome.run.exitCode, 1);
  const kinds = outcome.records.flatMap((record) => (record.type === "model_error" ? [record.kind] : []));
  assert.deepEqual(kinds, [kind]);
  assert.deepEqual(findLeaks(cliOutputSources(outcome.sb.workspace, outcome.run), [FAKE_API_KEY]), []);
}

/** A retry sends exactly the body of the first attempt (AD-04). */
function assertSameBodies(api: FakeAnthropic, count: number): void {
  const bodies = new Set(api.requests.slice(0, count).map((request) => request.bodyText));
  assert.equal(bodies.size, 1, "every retry must send the same body as the first attempt");
}

test(`${MOCK_LABEL} E3-h 401·429·529·시간 초과 분류와 재시도 상한`, { timeout: 300_000 }, async (t) => {
  await t.test("401 -> auth_failed, not retried", async (st) => {
    const outcome = await fakeRun(st, { id: "m03-401", steps: repeatReply(replyError(401, "authentication_error"), 5) });
    assertModelError(outcome, "auth_failed");
    assert.equal(outcome.api.requests.length, 1);
    assertProtocolClean(outcome.api);
  });

  await t.test(`429 every time -> rate_limited after exactly ${RETRIES} retries, same body`, async (st) => {
    const outcome = await fakeRun(st, { id: "m03-429", steps: repeatReply(replyError(429, "rate_limit_error", 0), 10) });
    assertModelError(outcome, "rate_limited");
    assert.equal(outcome.api.requests.length, RETRIES + 1);
    assertSameBodies(outcome.api, RETRIES + 1);
    assertProtocolClean(outcome.api);
  });

  await t.test(`529 every time -> overloaded after exactly ${RETRIES} retries, same body`, async (st) => {
    const outcome = await fakeRun(st, { id: "m03-529", steps: repeatReply(replyError(529, "overloaded_error", 0), 10) });
    assertModelError(outcome, "overloaded");
    assert.equal(outcome.api.requests.length, RETRIES + 1);
    assertSameBodies(outcome.api, RETRIES + 1);
    assertProtocolClean(outcome.api);
  });

  await t.test(`no answer within requestTimeoutMs -> timeout after exactly ${RETRIES} retries`, async (st) => {
    const outcome = await fakeRun(st, { id: "m03-timeout", steps: repeatReply(HANG, 10), config: { requestTimeoutMs: 800 } });
    assertModelError(outcome, "timeout");
    assert.equal(outcome.api.requests.length, RETRIES + 1);
    assertSameBodies(outcome.api, RETRIES + 1);
  });

  await t.test("maxRetries 0 -> one attempt only", async (st) => {
    const outcome = await fakeRun(st, {
      id: "m03-no-retry",
      steps: repeatReply(replyError(529, "overloaded_error", 0), 5),
      config: { maxRetries: 0 },
    });
    assertModelError(outcome, "overloaded");
    assert.equal(outcome.api.requests.length, 1);
  });

  await t.test("one 529 then success -> the retry carries on and the run is done", async (st) => {
    const outcome = await fakeRun(st, {
      id: "m03-recover",
      steps: [
        replyError(529, "overloaded_error", 0),
        replyTools([
          toolUse("toolu_w1", "write_file", {
            path: "NOTES.md",
            expectedHash: null,
            change: { kind: "replace_all", content: "# 노트\n" },
          }),
        ]),
        replyText("만들었다"),
      ],
      verifiers: [{ id: "notes", kind: "file_rules", rules: [{ type: "exists", path: "NOTES.md" }] }],
    });
    assert.equal(outcome.result.status, "done");
    assert.ok(existsSync(join(outcome.sb.workspace, "NOTES.md")));
    assert.equal(outcome.api.requests.length, 3);
    assertSameBodies(outcome.api, 2);
    assertProtocolClean(outcome.api);
  });
});

test(`${MOCK_LABEL} E3-i usage 누락과 토큰 한도`, { timeout: 120_000 }, async (t) => {
  const readThenFinish = (usage: { input_tokens: number; output_tokens: number } | null): FakeReply[] => [
    replyTools([toolUse("toolu_r1", "read_file", { path: "README.md" })], usage),
    replyText("끝", usage),
  ];

  await t.test("usage missing with a token limit -> budget-exhausted/usage_unknown before a second request", async (st) => {
    const outcome = await fakeRun(st, { id: "m03-usage-unknown", steps: readThenFinish(null), limits: { maxTotalTokens: 50_000 } });
    assert.equal(outcome.result.status, "budget-exhausted");
    assert.equal(outcome.result.reason, "usage_unknown");
    assert.equal(outcome.run.exitCode, 4);
    assert.equal(outcome.api.requests.length, 1, "no request may follow a response whose usage is unknown");
    assert.equal(outcome.result.usage.inputTokens, null, "unknown usage is never counted as zero");
    assertProtocolClean(outcome.api);
  });

  await t.test("usage missing without a token limit -> the run goes on and totals stay unknown", async (st) => {
    const outcome = await fakeRun(st, { id: "m03-usage-free", steps: readThenFinish(null), limits: { maxTotalTokens: null } });
    assert.equal(outcome.result.status, "done");
    assert.equal(outcome.api.requests.length, 2);
    assert.equal(outcome.result.usage.inputTokens, null);
    assert.equal(outcome.result.usage.outputTokens, null);
    assertProtocolClean(outcome.api);
  });

  await t.test("reported usage over the token limit -> budget-exhausted/max_total_tokens", async (st) => {
    const outcome = await fakeRun(st, {
      id: "m03-usage-over",
      steps: readThenFinish({ input_tokens: 80, output_tokens: 40 }),
      limits: { maxTotalTokens: 100 },
    });
    assert.equal(outcome.result.status, "budget-exhausted");
    assert.equal(outcome.result.reason, "max_total_tokens");
    assert.equal(outcome.api.requests.length, 1);
    assert.equal(outcome.result.usage.inputTokens, 80);
    assert.equal(outcome.result.usage.outputTokens, 40);
  });
});
