/**
 * `codaryn run` with the real assembly and the real anthropic provider, over an injected fake
 * `fetch`. Real workspace, privacy, policy, tools, verifiers and store on a temporary directory.
 * Nothing leaves the process: the global `fetch` is replaced by one that fails the test.
 * Fake key, fake secret and a fake host only. This is not a check against the real API.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runCli } from "../../../src/cli/run.js";
import type { CliEnvironment, CliRunOutcome } from "../../../src/cli/run.js";

const FAKE_KEY = "fake-api-key-not-real-0042";
const FAKE_SECRET = "fake-secret-VALUE-0042";
const FAKE_MODEL = "fake-model-wire";
const BASE_URL = "https://api.example.test";
const MESSAGES_URL = `${BASE_URL}/v1/messages`;
const temporaryDirs: string[] = [];

const originalFetch = globalThis.fetch;
let globalFetchCalls = 0;
beforeEach(() => {
  globalFetchCalls = 0;
  globalThis.fetch = (async () => {
    globalFetchCalls += 1;
    throw new Error("network use is not allowed in unit tests");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  assert.equal(globalFetchCalls, 0, "the global fetch must never be used");
});
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

interface SentRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string;
}

/** Answers each request with the next reply. Records what was sent. */
function fakeTransport(replies: readonly { status?: number; body: unknown }[]) {
  const sent: SentRequest[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : "",
    });
    const reply = replies[sent.length - 1];
    if (reply === undefined) throw new Error("no more fake replies");
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetch: fakeFetch, sent };
}

function message(content: unknown[], stopReason: string, usage = { input_tokens: 10, output_tokens: 5 }) {
  return { body: { id: "msg_fake", type: "message", role: "assistant", model: FAKE_MODEL, content, stop_reason: stopReason, usage } };
}

async function setup(options: {
  files?: Record<string, string>;
  task?: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
}): Promise<string> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-unit-wire-"));
  temporaryDirs.push(base);
  await mkdir(path.join(base, "work"));
  for (const [name, content] of Object.entries(options.files ?? {})) {
    await writeFile(path.join(base, "work", name), content, "utf8");
  }
  if (options.config !== null) {
    const config = options.config ?? { schemaVersion: 1, model: FAKE_MODEL, maxOutputTokens: 321, apiBaseUrl: BASE_URL, maxRetries: 0 };
    await writeFile(path.join(base, "config.json"), JSON.stringify(config), "utf8");
  }
  if (options.task !== null) {
    await writeFile(
      path.join(base, "task.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "wired",
        goal: "summarize the notes",
        workflow: "document",
        workspaceRoot: "./work",
        model: { provider: "anthropic" },
        policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
        privacy: { secretEnv: ["CODARYN_UNIT_SECRET"] },
        limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 },
        verifiers: [{ id: "notes", kind: "file_rules", rules: [{ type: "exists", path: "notes.md" }] }],
        ...(options.task ?? {}),
      }),
      "utf8",
    );
  }
  return base;
}

function io(base: string, transport: ReturnType<typeof fakeTransport>, extra: Partial<CliEnvironment> = {}): CliEnvironment {
  return {
    argv: ["run", "--task", path.join(base, "task.json"), "--config", path.join(base, "config.json")],
    env: { ANTHROPIC_API_KEY: FAKE_KEY, CODARYN_UNIT_SECRET: FAKE_SECRET },
    cwd: base,
    readFile: (file) => readFile(file, "utf8"),
    isDirectory: async (dir) => {
      try {
        return (await stat(dir)).isDirectory();
      } catch {
        return false;
      }
    },
    loadEnvFile: () => {
      throw new Error("no env file in this test");
    },
    clock: { now: () => Date.now() },
    randomBytes: (size) => randomBytes(size),
    assemble: assembleRun,
    anthropicDeps: { fetch: transport.fetch, sleep: async () => {} },
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    ...extra,
  };
}

async function stateFiles(base: string): Promise<string> {
  const runs = path.join(base, "work", ".codaryn", "runs");
  let text = "";
  for (const runId of await readdir(runs)) {
    for (const name of await readdir(path.join(runs, runId))) text += await readFile(path.join(runs, runId, name), "utf8");
  }
  return text;
}

function assertNowhere(value: string, where: string, ...texts: string[]): void {
  for (const text of texts) assert.equal(where.includes(text), false, `${value} must not contain ${JSON.stringify(text)}`);
}

function code(outcome: CliRunOutcome): string {
  return outcome.output.kind === "error" ? outcome.output.code : outcome.output.status;
}

describe("runCli with the anthropic provider over a fake transport", () => {
  test("requests go to the configured address and model; the key is only in the header", async () => {
    // The workspace file holds both a registered secret and the key itself.
    const base = await setup({ files: { "notes.md": `# Notes\nkey=${FAKE_SECRET}\napi=${FAKE_KEY}\n` } });
    const transport = fakeTransport([
      message([{ type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "notes.md" } }], "tool_use"),
      message([{ type: "text", text: "Read the notes." }], "end_turn", { input_tokens: 30, output_tokens: 7 }),
    ]);
    const outcome = await runCli(io(base, transport));

    assert.equal(code(outcome), "done");
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.output.kind === "run" ? outcome.output.provider : "", "anthropic");
    assert.deepEqual(outcome.output.kind === "run" ? outcome.output.usage.inputTokens : null, 40);

    assert.equal(transport.sent.length, 2);
    for (const request of transport.sent) {
      assert.equal(request.url, MESSAGES_URL);
      assert.equal(request.method, "POST");
      assert.equal(request.headers.get("x-api-key"), FAKE_KEY);
      const body = JSON.parse(request.body) as { model: string; max_tokens: number; tools: { name: string }[] };
      assert.equal(body.model, FAKE_MODEL);
      assert.equal(body.max_tokens, 321);
      assert.deepEqual(body.tools.map((tool) => tool.name).sort(), ["read_file", "run_command", "search_files", "write_file"]);
      assertNowhere("a request body", request.body, FAKE_KEY, FAKE_SECRET);
    }
    // The file content reached the model, masked.
    assert.ok(transport.sent[1]?.body.includes("tool_result"));
    assert.ok(transport.sent[1]?.body.includes("# Notes"));

    assertNowhere("stdout", JSON.stringify(outcome.output), FAKE_KEY, FAKE_SECRET);
    const recorded = await stateFiles(base);
    assert.ok(recorded.includes('"type":"run_finished"'));
    assertNowhere("the journal and result", recorded, FAKE_KEY, FAKE_SECRET);
  });

  test("the quick form runs with the config defaults", async () => {
    const base = await setup({
      task: null,
      config: {
        schemaVersion: 1,
        model: FAKE_MODEL,
        maxOutputTokens: 99,
        apiBaseUrl: "http://127.0.0.1:9/",
        maxRetries: 0,
        limits: { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 1000, maxDurationMs: 60_000 },
      },
    });
    const transport = fakeTransport([message([{ type: "text", text: "Nothing to change." }], "end_turn")]);
    const argv = ["run", "--workspace", "work", "--goal", "look around", "--config", "config.json"];
    const outcome = await runCli(io(base, transport, { argv }));

    // No verifier in the config: the run cannot be done.
    assert.equal(code(outcome), "needs-input");
    assert.equal(outcome.exitCode, 3);
    assert.equal(transport.sent[0]?.url, "http://127.0.0.1:9/v1/messages");
    assert.equal((JSON.parse(transport.sent[0]?.body ?? "{}") as { max_tokens: number }).max_tokens, 99);
    assertNowhere("stdout", JSON.stringify(outcome), FAKE_KEY);
  });

  test("an API error ends the run as failed and its message is recorded without the key", async () => {
    const base = await setup({ files: { "notes.md": "# Notes\n" } });
    const transport = fakeTransport([
      { status: 401, body: { type: "error", error: { type: "authentication_error", message: `invalid x-api-key ${FAKE_KEY}` } } },
    ]);
    const outcome = await runCli(io(base, transport));

    assert.equal(code(outcome), "failed");
    assert.equal(outcome.output.kind === "run" ? outcome.output.reason : "", "model_error");
    assert.equal(transport.sent.length, 1);
    const recorded = await stateFiles(base);
    assert.ok(recorded.includes('"kind":"auth_failed"'));
    assertNowhere("stdout", JSON.stringify(outcome), FAKE_KEY);
    assertNowhere("the journal and result", recorded, FAKE_KEY);
  });

  test("a missing key, model, output cap or limit is rejected before anything is sent", async () => {
    const limitsMissing = { limits: { maxModelTurns: 4, maxToolCalls: 4, maxDurationMs: 60_000 } };
    const cases: [string, Record<string, unknown> | undefined, Record<string, unknown> | undefined, Record<string, string>, string][] = [
      ["no key", undefined, undefined, { CODARYN_UNIT_SECRET: FAKE_SECRET }, "provider_not_configured"],
      ["no model", undefined, { schemaVersion: 1, maxOutputTokens: 5, apiBaseUrl: BASE_URL }, {}, "provider_not_configured"],
      ["no output cap", undefined, { schemaVersion: 1, model: FAKE_MODEL, apiBaseUrl: BASE_URL }, {}, "provider_not_configured"],
      ["no total-token limit", limitsMissing, undefined, {}, "invalid_task"],
    ];
    for (const [label, task, config, env, expected] of cases) {
      const base = await setup({ task: task ?? {}, ...(config === undefined ? {} : { config }) });
      const transport = fakeTransport([]);
      const runEnv = label === "no key" ? env : { ANTHROPIC_API_KEY: FAKE_KEY, CODARYN_UNIT_SECRET: FAKE_SECRET, ...env };
      const outcome = await runCli(io(base, transport, { env: runEnv }));
      assert.equal(code(outcome), expected, label);
      assert.equal(transport.sent.length, 0, `${label}: nothing may be sent`);
      assertNowhere(`${label} stdout`, JSON.stringify(outcome), FAKE_KEY);
    }
  });
});
