/**
 * SP-6: `codaryn run` makes the OpenAI provider (src/model/openai, the Responses API) for an openai
 * task or quick form, with the settings the CLI resolved: OPENAI_API_KEY only, sent only to the
 * OpenAI address. Checked only against the integration owner's fake server
 * (tests/support/fake-openai.ts) on 127.0.0.1; the real API is never called.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV, CODARYN_API_BASE_URL_ENV, CODARYN_OPENAI_API_BASE_URL_ENV, OPENAI_API_KEY_ENV } from "../../../src/contracts/index.js";
import type { EngineResult } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { assertOpenAIProtocolClean, bearerKeysOf, replyFinal, responsesRequests, startFakeOpenAI } from "../../support/fake-openai.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const ANTHROPIC_VALUE = ["cdy-fake", "sp6", "anthropic", "value", "0001"].join("-");
const OPENAI_VALUE = ["cdy-fake", "sp6", "openai", "value", "0001"].join("-");
const LIMITS = { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 10_000, maxDurationMs: 60_000 };

async function setup(configValue: Record<string, unknown>, taskModel: Record<string, unknown> | null): Promise<{ base: string; ws: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-sp6-run-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  await writeFile(path.join(base, "config.json"), JSON.stringify({ schemaVersion: 1, ...configValue }), "utf8");
  if (taskModel !== null) {
    await writeFile(
      path.join(base, "task.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "g-sp6",
        goal: "say done",
        workflow: "label",
        workspaceRoot: "./ws",
        model: taskModel,
        policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
        privacy: { secretEnv: [] },
        limits: LIMITS,
        verifiers: [],
      }),
      "utf8",
    );
  }
  return { base, ws };
}

async function run(base: string, argv: readonly string[], env: Record<string, string>): Promise<EngineResult> {
  const outcome = await runCli({
    argv: ["run", ...argv, "--config", "config.json", "--quiet"],
    env,
    cwd: base,
    readFile: (file) => readFile(file, "utf8"),
    isDirectory: async (dir) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
    loadEnvFile: () => {},
    locateInWorkspace: (file, root) => locateInWorkspace(file, root),
    relatePaths: (target, root) => relateRealPaths(target, root),
    clock: { now: () => Date.now() },
    randomBytes: (size) => new Uint8Array(size).fill(11),
    assemble: assembleRun,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
  });
  assert.equal(outcome.output.kind, "run", JSON.stringify(outcome.output));
  return outcome.output as EngineResult;
}

describe("SP-6: run with the openai provider", () => {
  test("an openai task talks to the OpenAI address with the OpenAI key only", async (t) => {
    const api = await startFakeOpenAI(t, [replyFinal("done")]);
    const { base } = await setup({ providers: { openai: { apiBaseUrl: api.baseUrl } } }, { provider: "openai", model: "gpt-fake", maxOutputTokens: 64 });
    // Anthropic's address variable points at the same fake server: it must not be used for openai,
    // and the Anthropic key must never reach it.
    const result = await run(base, ["--task", "task.json"], { [ANTHROPIC_API_KEY_ENV]: ANTHROPIC_VALUE, [OPENAI_API_KEY_ENV]: OPENAI_VALUE, [CODARYN_API_BASE_URL_ENV]: api.url });
    assert.equal(result.reason === "model_error", false, JSON.stringify(result));
    assert.equal(responsesRequests(api).length, 1);
    assert.deepEqual(bearerKeysOf(api), [OPENAI_VALUE]);
    assertOpenAIProtocolClean(api);
    for (const request of api.requests) {
      assert.equal(JSON.stringify(request.headers).includes(ANTHROPIC_VALUE), false);
      assert.equal(request.bodyText.includes(ANTHROPIC_VALUE), false);
    }
  });

  test("an openai quick form uses providers.openai and CODARYN_OPENAI_API_BASE_URL", async (t) => {
    const api = await startFakeOpenAI(t, [replyFinal("done")]);
    const { base, ws } = await setup({ provider: "openai", providers: { openai: { model: "gpt-fake", maxOutputTokens: 64 } }, limits: LIMITS }, null);
    const result = await run(base, ["--workspace", ws, "--goal", "say done"], { [OPENAI_API_KEY_ENV]: OPENAI_VALUE, [CODARYN_OPENAI_API_BASE_URL_ENV]: api.baseUrl });
    assert.equal(result.reason === "model_error", false, JSON.stringify(result));
    assert.deepEqual(bearerKeysOf(api), [OPENAI_VALUE]);
    const body = responsesRequests(api)[0]?.body as { model?: string; max_output_tokens?: number };
    assert.deepEqual([body.model, body.max_output_tokens], ["gpt-fake", 64]);
    assertOpenAIProtocolClean(api);
  });
});
