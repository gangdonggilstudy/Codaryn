/**
 * G-A, GT-E1: the Anthropic provider offers `ModelRequest.workflowTools` with
 * WORKFLOW_TOOL_DEFINITIONS, after the built-in tools. A request without workflow tools (every run
 * without workflowRef) must keep its body byte for byte.
 *
 * The pinned SHA-256 values and lengths were computed before this change, with the same scenario
 * on two builds that agreed: this branch before the provider change, and main `f130a4c` (the engine
 * before G-B, no G-A contract). Fake transport only; no real API request.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";

import { TOOL_DEFINITIONS, TOOL_NAMES, WORKFLOW_TOOL_DEFINITIONS, asRawText } from "../../../../src/contracts/index.js";
import type {
  EffectiveWorkflowToolCall,
  EngineDeps,
  JournalEvent,
  MaskedText,
  ModelRequest,
  RawWorkflowToolOutcome,
  ResolvedAnthropicSettings,
  ResolvedTaskSpec,
  WorkflowToolName,
} from "../../../../src/contracts/index.js";
import { SYSTEM_PROMPT, runTask } from "../../../../src/engine/index.js";
import { createAnthropicProvider } from "../../../../src/model/anthropic/index.js";
import { createPrivacyGateway } from "../../../../src/privacy/index.js";

const FAKE_KEY = "codaryn-fake-key-0123456789abcdef-not-a-credential";
const SETTINGS: ResolvedAnthropicSettings = {
  apiKey: FAKE_KEY,
  model: "test-model-id",
  maxOutputTokens: 1024,
  apiBaseUrl: "http://127.0.0.1:9",
  requestTimeoutMs: 5_000,
  maxRetries: 0,
};

const masked = (text: string): MaskedText => text as MaskedText;
const sha = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

type Reply = Record<string, unknown>;
function transport(replies: readonly Reply[]): { fetch: typeof fetch; bodies: string[] } {
  const bodies: string[] = [];
  const fetchImpl = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    bodies.push(typeof init?.body === "string" ? init.body : "");
    const reply = replies[Math.min(bodies.length - 1, replies.length - 1)];
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetchImpl as typeof fetch, bodies };
}

function message(content: unknown[], stopReason: string): Reply {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "test-model-id",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

const FINAL = message([{ type: "text", text: "done" }], "end_turn");

function provider(replies: readonly Reply[]) {
  const sent = transport(replies);
  return { provider: createAnthropicProvider(SETTINGS, { fetch: sent.fetch, sleep: async () => {} }), bodies: sent.bodies };
}

const LEGACY_REQUEST: ModelRequest = {
  system: masked("You are a test agent."),
  messages: [
    { role: "user", content: masked("Add a heading to README.md") },
    {
      role: "assistant",
      text: masked("Reading first."),
      toolCalls: [{ id: "toolu_A", name: "read_file", argsJson: masked('{"path":"README.md"}') }],
    },
    {
      role: "tool",
      results: [{ callId: "toolu_A", tool: "read_file", ok: true, content: masked('{"path":"README.md","content":"# T\n"}'), errorCode: null }],
    },
  ],
  tools: TOOL_NAMES,
};

/** A run without workflowRef: the task, deps and transport the pinned values were computed with. */
function legacyRun(): { deps: EngineDeps; bodies: string[]; events: JournalEvent[] } {
  const sent = transport([
    message(
      [
        { type: "text", text: "Reading." },
        { type: "tool_use", id: "toolu_01", name: "read_file", input: { path: "a.txt" } },
      ],
      "tool_use",
    ),
    message([{ type: "text", text: "finished" }], "end_turn"),
  ]);
  const events: JournalEvent[] = [];
  const task: ResolvedTaskSpec = {
    schemaVersion: 1,
    id: "legacy",
    goal: "add a line to a.txt",
    workflow: "document",
    workspaceRoot: "/work",
    model: { provider: "anthropic", maxOutputTokens: 1024 },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
    privacy: { secretEnv: [] },
    limits: { maxModelTurns: 5, maxToolCalls: 5, maxTotalTokens: null, maxDurationMs: 600_000, maxRepairAttempts: 0, maxSameFailures: 2 },
    verifiers: [{ id: "v1", kind: "file_rules", rules: [{ type: "exists", path: "a.txt" }] }],
  };
  const deps: EngineDeps = {
    task,
    runId: "20261112T000000Z-0000abcd",
    model: createAnthropicProvider(SETTINGS, { fetch: sent.fetch, sleep: async () => {} }),
    privacy: createPrivacyGateway({ secrets: [] }),
    policy: { checkRequested: () => ({ allowed: true }), restorableFields: () => [], checkEffective: async () => ({ allowed: true }) },
    tools: {
      execute: async () => ({ ok: true, payload: { path: "a.txt", content: "plain", hash: "a".repeat(64), hadBom: false } }),
    },
    verifiers: {
      run: async (config) => ({ id: config.id, kind: config.kind, outcome: "pass", evidence: asRawText("ok"), checked: ["x"], limits: [] }),
    },
    journal: {
      append: async (event) => {
        events.push(event);
        return { seq: events.length, at: new Date(0).toISOString(), runId: "model-run", ...event };
      },
      close: async () => {},
    },
    clock: { now: () => 0 },
    signal: new AbortController().signal,
  };
  return { deps, bodies: sent.bodies, events };
}

describe("requests without workflow tools keep their bytes", () => {
  test("a provider request with built-in tools only is the pinned body", async () => {
    const run = provider([FINAL]);
    await run.provider.complete(LEGACY_REQUEST, new AbortController().signal);
    const [body] = run.bodies;
    assert.ok(body !== undefined);
    assert.equal(Buffer.byteLength(body), 2974);
    assert.equal(sha(body), "814adb23a4222dd65d9e041d59659ed76f048c22856e99d3c9446a28f00ac343");
  });

  test("an empty workflowTools list sends the same bytes as none", async () => {
    const none = provider([FINAL]);
    const empty = provider([FINAL]);
    await none.provider.complete(LEGACY_REQUEST, new AbortController().signal);
    await empty.provider.complete({ ...LEGACY_REQUEST, workflowTools: [] }, new AbortController().signal);
    assert.equal(empty.bodies[0], none.bodies[0]);
  });

  test("a run without workflowRef sends the pinned bodies on both turns (engine and provider together)", async () => {
    const run = legacyRun();
    const result = await runTask(run.deps);
    assert.equal(result.status, "done");
    assert.deepEqual(
      run.bodies.map((body) => [Buffer.byteLength(body), sha(body)]),
      [
        [3601, "a5119910af99535d47b3ff34a0ad1cadbf8d8a8456f77da7da52b1b61cb473dc"],
        [3991, "c17b5a2170d722e25f543f02724436459de9814758d0f0e692e537cd7fbc9f4f"],
      ],
    );
    // U-15 (AXM-16, approved): only the system text changed. With the prompt before U-15 put back,
    // the bodies are the ones pinned before, byte for byte (tool definitions, messages and the rest).
    const lines = SYSTEM_PROMPT.split("\n");
    const previous = lines
      .filter((line) => line !== "Only the tools offered in this run exist." && !line.startsWith("You cannot ask the person anything during the run."))
      .map((line) => (line.startsWith("When the work is finished, reply without tool calls:") ? "When the work is finished, reply without tool calls. Verifiers decide whether the task succeeded." : line))
      .join("\n");
    assert.equal(lines.length - previous.split("\n").length, 2, "two lines added, one replaced");
    assert.deepEqual(
      run.bodies.map((body) => {
        const before = body.replace(JSON.stringify(SYSTEM_PROMPT), JSON.stringify(previous));
        return [Buffer.byteLength(before), sha(before)];
      }),
      [
        [3328, "e4da25050289e3c867a69f1573abacb99e2009ba4a95742add7b9266145f04a0"],
        [3718, "141ca5a0fffc0d4a762d81f5844e06b1e499e598acd7a08595550d4cfcecd582"],
      ],
    );
    for (const body of run.bodies) assert.equal(body.includes(FAKE_KEY), false);
  });
});

describe("workflow tools in the request", () => {
  function toolsOf(body: string | undefined): { name: string; description: string; input_schema: unknown }[] {
    assert.ok(body !== undefined);
    return (JSON.parse(body) as { tools: { name: string; description: string; input_schema: unknown }[] }).tools;
  }

  test("they follow the built-in tools with their own definitions, each once", async () => {
    const run = provider([FINAL]);
    await run.provider.complete(
      { ...LEGACY_REQUEST, tools: ["read_file", "search_files"], workflowTools: ["inspect_files", "propose_plan", "inspect_files"] },
      new AbortController().signal,
    );
    const tools = toolsOf(run.bodies[0]);
    assert.deepEqual(tools.map((tool) => tool.name), ["read_file", "search_files", "inspect_files", "propose_plan"]);
    for (const tool of tools) {
      const definition =
        tool.name === "inspect_files" || tool.name === "propose_plan"
          ? WORKFLOW_TOOL_DEFINITIONS[tool.name]
          : TOOL_DEFINITIONS[tool.name as "read_file" | "search_files"];
      assert.equal(tool.description, definition.description, tool.name);
      assert.deepEqual(tool.input_schema, definition.inputSchema, tool.name);
    }
  });

  test("a workflow tool without a definition is refused before anything is sent", async () => {
    const run = provider([FINAL]);
    const outcome = await run.provider.complete(
      { ...LEGACY_REQUEST, workflowTools: ["delete_everything" as WorkflowToolName] },
      new AbortController().signal,
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok ? "" : outcome.kind, "api_error");
    assert.equal(run.bodies.length, 0);
  });

  test("a plan run through the provider offers the plan tools and gets the model's proposal to the engine", async () => {
    const run = legacyRun();
    const sent = transport([
      message(
        [{ type: "tool_use", id: "toolu_p1", name: "propose_plan", input: { summary: "tidy", actions: [{ kind: "move", from: "a.txt", to: "docs/a.txt" }] } }],
        "tool_use",
      ),
    ]);
    const proposals: EffectiveWorkflowToolCall[] = [];
    const deps: EngineDeps = {
      ...run.deps,
      task: {
        ...run.deps.task,
        workflowRef: "organize",
        tools: ["read_file", "search_files", "write_file", "inspect_files", "propose_plan"],
        plan: "apply",
        policy: { ...run.deps.task.policy, planActions: ["move"] },
      },
      model: createAnthropicProvider(SETTINGS, { fetch: sent.fetch, sleep: async () => {} }),
      tools: {
        ...run.deps.tools,
        async executeWorkflowTool(call): Promise<RawWorkflowToolOutcome> {
          proposals.push(call);
          return { ok: true, payload: { digest: "c".repeat(64), actions: [] } };
        },
      },
    };
    const result = await runTask(deps);
    assert.deepEqual(toolsOf(sent.bodies[0]).map((tool) => tool.name), ["read_file", "search_files", "inspect_files", "propose_plan"]);
    assert.equal(proposals[0]?.name, "propose_plan");
    assert.deepEqual([result.status, result.reason], ["needs-input", "plan_pending"]);
  });
});
