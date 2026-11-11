/**
 * Contract stand-ins for engine unit tests (PM decision P-5).
 * They replace other modules at the contract boundary only. All secrets are fake.
 */

import { DEFAULT_MAX_REPAIR_ATTEMPTS, DEFAULT_MAX_SAME_FAILURES, asRawText } from "../../../src/contracts/index.js";
import type {
  EffectiveToolCall,
  EngineDeps,
  JournalEvent,
  JsonObject,
  JsonValue,
  Limits,
  MaskedText,
  ModelOutcome,
  ModelRequest,
  ModelResponse,
  PolicyDecision,
  PrivacyGateway,
  RawToolOutcome,
  RawVerifierResult,
  ResolvedTaskSpec,
  ToolCall,
  VerifierConfig,
  VerifierOutcome,
} from "../../../src/contracts/index.js";

/** Clearly not a real key format. */
export const FAKE_SECRET = "fake-secret-VALUE-0001";
export const FAKE_TOKEN = "[[CODARYN_SECRET:00000000000000aa]]";
export const HASH_A = "a".repeat(64);
export const HASH_B = "b".repeat(64);

export type Log = string[];

/** Task fields to override. Limits left out keep their defaults (repairs: 0 and 2, as the CLI resolves). */
export type TaskOverrides = Partial<Omit<ResolvedTaskSpec, "limits">> & { readonly limits?: Partial<Limits> };

export function makeTask(overrides: TaskOverrides = {}): ResolvedTaskSpec {
  const { limits, ...rest } = overrides;
  return {
    schemaVersion: 1,
    id: "unit-task",
    goal: "do the work",
    workflow: "code",
    workspaceRoot: "/work",
    model: { provider: "scripted", scriptPath: "/work/script.json" },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: true },
    privacy: { secretEnv: [] },
    verifiers: [{ id: "v1", kind: "file_rules", rules: [{ type: "exists", path: "a.txt" }] }],
    ...rest,
    limits: {
      maxModelTurns: 10,
      maxToolCalls: 10,
      maxTotalTokens: null,
      maxDurationMs: 600_000,
      maxRepairAttempts: DEFAULT_MAX_REPAIR_ATTEMPTS,
      maxSameFailures: DEFAULT_MAX_SAME_FAILURES,
      ...limits,
    },
  };
}

export class FakeClock {
  t = 0;
  now(): number {
    return this.t;
  }
}

export function response(
  toolCalls: ToolCall[],
  extra: Partial<ModelResponse> = {},
): ModelOutcome {
  return {
    ok: true,
    response: {
      stop: toolCalls.length > 0 ? "tool_calls" : "final",
      text: "",
      toolCalls,
      usage: { inputTokens: 1, outputTokens: 1 },
      ...extra,
    },
  };
}

export const finalAnswer = (text = "finished"): ModelOutcome => response([], { text });

/** Answers request N with step N. Records a JSON copy of every request it receives. */
export class FakeModel {
  readonly name = "scripted" as const;
  readonly requests: ModelRequest[] = [];
  constructor(
    private readonly steps: ((request: ModelRequest) => ModelOutcome)[],
    private readonly log?: Log,
  ) {}
  async complete(request: ModelRequest): Promise<ModelOutcome> {
    this.log?.push("model.complete");
    this.requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest);
    const step = this.steps[this.requests.length - 1];
    if (step === undefined) return { ok: false, kind: "script_exhausted", message: "no step" };
    return step(request);
  }
}

function replaceToken(value: JsonValue, path: string, restore: readonly string[], docs: readonly string[]):
  | { ok: true; value: JsonValue }
  | { ok: false; field: string } {
  if (typeof value === "string") {
    if (!value.includes(FAKE_TOKEN) || docs.includes(path)) return { ok: true, value };
    if (restore.includes(path)) return { ok: true, value: value.split(FAKE_TOKEN).join(FAKE_SECRET) };
    return { ok: false, field: path };
  }
  if (Array.isArray(value)) {
    const out: JsonValue[] = [];
    for (const [index, item] of value.entries()) {
      const next = replaceToken(item, `${path}.${index}`, restore, docs);
      if (!next.ok) return next;
      out.push(next.value);
    }
    return { ok: true, value: out };
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value as JsonObject)) {
      const next = replaceToken(item, path === "" ? key : `${path}.${key}`, restore, docs);
      if (!next.ok) return next;
      out[key] = next.value;
    }
    return { ok: true, value: out };
  }
  return { ok: true, value };
}

/** Replaces FAKE_SECRET with FAKE_TOKEN. `failWhen` makes mask fail for matching text. */
export function fakePrivacy(options: { failWhen?: (text: string) => boolean; log?: Log } = {}): PrivacyGateway {
  return {
    mask(text) {
      if (options.failWhen?.(text) === true) return { ok: false, code: "masking_failed" };
      return { ok: true, text: text.split(FAKE_SECRET).join(FAKE_TOKEN) as MaskedText };
    },
    resolveToolArgs(request) {
      options.log?.push("privacy.resolveToolArgs");
      const next = replaceToken(request.args, "", request.restoreFields, request.documentFields);
      if (!next.ok) return { ok: false, code: "unresolved_token", field: next.field };
      return { ok: true, args: next.value as JsonObject, restoredFields: request.restoreFields };
    },
    rebuildDocument(request) {
      return { ok: true, text: request.original ?? asRawText(request.maskedNext) };
    },
  };
}

export const ALLOW: PolicyDecision = { allowed: true };

export class FakePolicy {
  readonly effectiveCalls: EffectiveToolCall[] = [];
  constructor(
    private readonly options: {
      requested?: (call: ToolCall) => PolicyDecision;
      effective?: (call: EffectiveToolCall) => PolicyDecision;
      restorable?: readonly string[];
      log?: Log;
    } = {},
  ) {}
  checkRequested(call: ToolCall): PolicyDecision {
    this.options.log?.push("policy.checkRequested");
    return this.options.requested?.(call) ?? ALLOW;
  }
  restorableFields(): readonly string[] {
    return this.options.restorable ?? ["path", "cwd"];
  }
  async checkEffective(call: EffectiveToolCall): Promise<PolicyDecision> {
    this.options.log?.push("policy.checkEffective");
    this.effectiveCalls.push(call);
    return this.options.effective?.(call) ?? ALLOW;
  }
}

export class FakeTools {
  readonly executed: EffectiveToolCall[] = [];
  constructor(
    private readonly handler: (call: EffectiveToolCall, signal: AbortSignal) => RawToolOutcome = () => ({
      ok: true,
      payload: { path: "a.txt", content: "plain", hash: HASH_A, hadBom: false },
    }),
    private readonly log?: Log,
  ) {}
  async execute(call: EffectiveToolCall, signal: AbortSignal): Promise<RawToolOutcome> {
    this.log?.push("tools.execute");
    this.executed.push(call);
    return this.handler(call, signal);
  }
}

export class FakeVerifiers {
  readonly runs: string[] = [];
  constructor(private readonly outcomes: Record<string, VerifierOutcome> = {}) {}
  async run(config: VerifierConfig): Promise<RawVerifierResult> {
    this.runs.push(config.id);
    return {
      id: config.id,
      kind: config.kind,
      outcome: this.outcomes[config.id] ?? "pass",
      evidence: asRawText("evidence"),
      checked: ["the configured rule"],
      limits: [],
    };
  }
}

export class FakeJournal {
  readonly events: JournalEvent[] = [];
  closed = false;
  constructor(private readonly log?: Log) {}
  async append(event: JournalEvent): Promise<void> {
    if (event.type === "tool_result") this.log?.push("journal.tool_result");
    this.events.push(event);
  }
  async close(): Promise<void> {
    this.closed = true;
  }
  ofType<T extends JournalEvent["type"]>(type: T): Extract<JournalEvent, { type: T }>[] {
    return this.events.filter((event): event is Extract<JournalEvent, { type: T }> => event.type === type);
  }
}

export interface Harness {
  deps: EngineDeps;
  model: FakeModel;
  policy: FakePolicy;
  tools: FakeTools;
  verifiers: FakeVerifiers;
  journal: FakeJournal;
  clock: FakeClock;
  controller: AbortController;
}

export function harness(parts: {
  steps: ((request: ModelRequest) => ModelOutcome)[];
  task?: TaskOverrides;
  privacy?: PrivacyGateway;
  policy?: FakePolicy;
  tools?: FakeTools;
  verifiers?: FakeVerifiers;
  clock?: FakeClock;
  log?: Log;
}): Harness {
  const model = new FakeModel(parts.steps, parts.log);
  const policy = parts.policy ?? new FakePolicy();
  const tools = parts.tools ?? new FakeTools();
  const verifiers = parts.verifiers ?? new FakeVerifiers();
  const journal = new FakeJournal(parts.log);
  const clock = parts.clock ?? new FakeClock();
  const controller = new AbortController();
  const deps: EngineDeps = {
    task: makeTask(parts.task),
    runId: "20261112T000000Z-0000abcd",
    model,
    privacy: parts.privacy ?? fakePrivacy(),
    policy,
    tools,
    verifiers,
    journal,
    clock,
    signal: controller.signal,
  };
  return { deps, model, policy, tools, verifiers, journal, clock, controller };
}

export const readCall = (id: string, path = "a.txt"): ToolCall => ({ id, name: "read_file", args: { path } });
