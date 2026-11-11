/**
 * Phase 1b settings: config file, precedence (C-4 to C-6), key rejection (C-1), env file (C-2),
 * the quick form (C-8), and that the key never appears in any output.
 * Fake values only. Nothing here sends a request: the provider factory is a stub.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import {
  DEFAULT_ANTHROPIC_API_BASE_URL,
  DEFAULT_MAX_REPAIR_ATTEMPTS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_SAME_FAILURES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DENY_ALL_POLICY,
  QUICK_TASK_ID,
} from "../../../src/contracts/index.js";
import type {
  CodarynConfig,
  CreateAnthropicProvider,
  EngineResult,
  ResolvedAnthropicSettings,
  RunTask,
} from "../../../src/contracts/index.js";
import { parseArgs } from "../../../src/cli/args.js";
import type { Assemble, AssemblyInput } from "../../../src/cli/assemble.js";
import { parseConfig } from "../../../src/cli/config.js";
import { runCli } from "../../../src/cli/run.js";
import type { CliEnvironment, CliRunOutcome } from "../../../src/cli/run.js";
import { resolveAnthropicSettings } from "../../../src/cli/settings.js";
import { lexicalLocate } from "./locate.js";

const BASE = path.resolve("/tmp/codaryn-config-unit");
/** Not a real key format. */
const FAKE_KEY = "fake-api-key-not-real-0001";
/** Has the shape of an Anthropic key. Built at run time so the file never holds such a literal. */
const KEY_SHAPED = ["sk", "ant", "FAKEfake0000FAKEfake0000"].join("-");
const FAKE_SECRET = "fake-secret-VALUE-0003";

/** S-7: anthropic tasks must have a token limit. */
const LIMITS = { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 10_000, maxDurationMs: 10_000 };

function anthropicTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "doc-1",
    goal: "write the doc",
    workflow: "document",
    workspaceRoot: "./work",
    model: { provider: "anthropic" },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
    privacy: { secretEnv: [] },
    limits: LIMITS,
    verifiers: [],
    ...overrides,
  };
}

function config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { schemaVersion: 1, ...overrides };
}

interface Harness {
  readonly io: CliEnvironment;
  readonly env: Record<string, string | undefined>;
  readonly assembled: AssemblyInput[];
  readonly settings: ResolvedAnthropicSettings[];
  readonly envFiles: string[];
}

function harness(
  files: Record<string, unknown>,
  options: {
    argv?: readonly string[];
    env?: Record<string, string | undefined>;
    envFile?: Record<string, string> | "unreadable";
  } = {},
): Harness {
  const env: Record<string, string | undefined> = { ...(options.env ?? {}) };
  const assembled: AssemblyInput[] = [];
  const settings: ResolvedAnthropicSettings[] = [];
  const envFiles: string[] = [];
  const result: EngineResult = {
    schemaVersion: 1,
    kind: "run",
    runId: "x",
    taskId: "doc-1",
    status: "done",
    reason: "verified",
    exitCode: 0,
    provider: "anthropic",
    verifiers: [],
    changes: [],
    usage: { modelTurns: 1, toolCalls: 0, inputTokens: 1, outputTokens: 1, durationMs: 0 },
    journalPath: ".codaryn/runs/x/journal.jsonl",
    notices: [],
  };
  const assemble: Assemble = async (input) => {
    assembled.push(input);
    return { ok: true, deps: { task: input.task } as never, finish: async () => {} };
  };
  const runTask: RunTask = async () => result;
  const createAnthropicProvider: CreateAnthropicProvider = (resolved) => {
    settings.push(resolved);
    return {
      name: "anthropic",
      complete: async () => ({ ok: false, kind: "api_error", message: "stub: nothing is sent in unit tests" }),
    };
  };
  const io: CliEnvironment = {
    argv: options.argv ?? ["run", "--task", "task.json"],
    env,
    cwd: BASE,
    readFile: async (file) => {
      const key = path.relative(BASE, file).split(path.sep).join("/");
      if (!(key in files)) throw new Error("missing");
      const value = files[key];
      return typeof value === "string" ? value : JSON.stringify(value);
    },
    isDirectory: async (dir) => dir === path.join(BASE, "work"),
    loadEnvFile: (file) => {
      envFiles.push(file);
      if (options.envFile === undefined || options.envFile === "unreadable") throw new Error("cannot read");
      for (const [name, value] of Object.entries(options.envFile)) {
        if (env[name] === undefined) env[name] = value;
      }
    },
    locateInWorkspace: lexicalLocate,
    clock: { now: () => Date.UTC(2026, 10, 12, 3, 15, 0) },
    randomBytes: (size) => new Uint8Array(size).fill(0xcd),
    assemble,
    runTask,
    createAnthropicProvider,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
  };
  return { io, env, assembled, settings, envFiles };
}

function code(outcome: CliRunOutcome): string {
  return outcome.output.kind === "error" ? outcome.output.code : outcome.output.status;
}

function assertNoKey(outcome: CliRunOutcome): void {
  const printed = JSON.stringify(outcome);
  assert.equal(printed.includes(FAKE_KEY), false, "the key must not be printed");
  assert.equal(printed.includes(KEY_SHAPED), false, "a key-shaped value must not be printed");
}

const KEY_ENV = { ANTHROPIC_API_KEY: FAKE_KEY };

describe("parseArgs (phase 1b options)", () => {
  test("quick form and settings options", () => {
    const parsed = parseArgs(["run", "--workspace", "w", "--goal", "fix it", "--config", "c.json", "--vars-file", ".env"]);
    assert.deepEqual(parsed, {
      ok: true,
      args: {
        command: "run",
        input: { kind: "quick", workspace: "w", goal: "fix it" },
        configPath: "c.json",
        varsFile: ".env",
        cancelFile: null,
        quiet: false,
      },
    });
  });

  test("rejects mixed or incomplete forms", () => {
    for (const argv of [
      ["run", "--task", "t.json", "--goal", "g"],
      ["run", "--workspace", "w"],
      ["run", "--goal", "g"],
      ["run", "--config", "c.json"],
      ["run", "--workspace", "w", "--goal", "g", "--config", "a", "--config", "b"],
      ["run", "--workspace", "w", "--goal", "g", "--api-key", "x"],
    ]) {
      assert.equal(parseArgs(argv).ok, false, argv.join(" "));
    }
  });
});

describe("parseConfig", () => {
  test("accepts every field and normalizes the base URL", () => {
    const parsed = parseConfig(
      config({
        model: "fake-model",
        maxOutputTokens: 2048,
        apiBaseUrl: "http://127.0.0.1:8123/",
        requestTimeoutMs: 5000,
        maxRetries: 0,
        limits: { maxModelTurns: 3 },
        policy: DENY_ALL_POLICY,
        verifiers: [{ id: "v", kind: "file_rules", rules: [{ type: "exists", path: "a.md" }] }],
        secretEnv: ["FAKE_ENV"],
      }),
    );
    assert.ok(parsed.ok);
    assert.equal(parsed.config.apiBaseUrl, "http://127.0.0.1:8123");
    assert.deepEqual(parsed.config.limits, { maxModelTurns: 3 });
    assert.equal(parsed.config.maxRetries, 0);
  });

  test("rejects invalid values without echoing them", () => {
    for (const value of [
      {},
      config({ schemaVersion: 2 }),
      config({ unknown: 1 }),
      config({ maxRetries: 11 }),
      config({ maxOutputTokens: 0 }),
      config({ apiBaseUrl: `http://example.com/${FAKE_SECRET}` }),
      config({ limits: { maxModelTurns: -1 } }),
      config({ policy: { commands: [], network: "allow", destructive: "deny", restorePathTokens: false } }),
    ]) {
      const parsed = parseConfig(value);
      assert.equal(parsed.ok, false, JSON.stringify(value));
      assert.equal(JSON.stringify(parsed).includes(FAKE_SECRET), false);
    }
  });

  test("S-9 base URL: https anywhere, http on loopback only, nothing the parser would repair", () => {
    const url = (value: string): string | null => {
      const parsed = parseConfig(config({ apiBaseUrl: value }));
      return parsed.ok ? (parsed.config.apiBaseUrl ?? null) : null;
    };
    assert.equal(url("https://api.example.test/v/"), "https://api.example.test/v");
    assert.equal(url("http://localhost:9000"), "http://localhost:9000");
    assert.equal(url("http://[::1]:9000"), "http://[::1]:9000");
    const bad = [
      "http://10.0.0.1",
      "ftp://x",
      "not a url",
      "https://u:p@x.test",
      "https://x.test?a=1",
      "https://x.test#f",
      // S-9: a bare `?` or `#`, characters the parser rewrites, and a base that already names /v1.
      "https://x.test?",
      "https://x.test/#",
      "https://x.test\\proxy",
      "https://x.test/v1",
    ];
    for (const value of bad) assert.equal(url(value), null, value);
  });

  test("S-7 requestTimeoutMs and verifier timeoutMs fit a Node timer", () => {
    assert.ok(parseConfig(config({ requestTimeoutMs: 2_147_483_647 })).ok);
    assert.equal(parseConfig(config({ requestTimeoutMs: 2_147_483_648 })).ok, false);
    const verifier = (timeoutMs: number) => config({ verifiers: [{ id: "v", kind: "command", executable: "node", args: [], timeoutMs }] });
    assert.ok(parseConfig(verifier(2_147_483_647)).ok);
    assert.equal(parseConfig(verifier(2_147_483_648)).ok, false);
  });

  test("S-3 secretEnv entries must be variable names; the message gives the position only", () => {
    const parsed = parseConfig(config({ secretEnv: ["GOOD_NAME", `fake-db-password-${FAKE_SECRET}`] }));
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok ? "" : parsed.message, "secretEnv[1] is not a valid environment variable name");
  });
});

describe("key detection in runCli (C-1, S-6)", () => {
  const QUICK = ["run", "--workspace", "work", "--goal", "g", "--config", "c.json"];

  test("finds key fields at any depth and names only known fields in the location", async () => {
    // S-6 moved the location rule: only schema field names and plain key field names are written.
    const cases: [Record<string, unknown>, string][] = [
      [{ apiKey: "v" }, "apiKey"],
      [{ model: { provider: "anthropic", api_key: "v" } }, "model.api_key"],
      [{ ANTHROPIC_API_KEY: "" }, "ANTHROPIC_API_KEY"],
      [{ headers: { "x-api-key": "v" } }, "<field>.<field>"],
      [{ verifiers: [{ token: "v" }] }, "verifiers[0].token"],
      [{ password: "v" }, "password"],
    ];
    for (const [extra, where] of cases) {
      const outcome = await runCli(harness({ "c.json": config(extra) }, { argv: QUICK }).io);
      assert.equal(code(outcome), "key_in_file", where);
      assert.ok(outcome.output.kind === "error" && outcome.output.message.includes(` at ${where};`), where);
    }
  });

  test("a key value is found in the raw text first, so no location is given", async () => {
    for (const extra of [{ goal: `use ${KEY_SHAPED}` }, { [KEY_SHAPED]: 1 }, { model: `x ${FAKE_KEY} y` }]) {
      const outcome = await runCli(harness({ "c.json": config(extra) }, { argv: QUICK, env: KEY_ENV }).io);
      assert.equal(code(outcome), "key_in_file");
      assert.ok(outcome.output.kind === "error" && outcome.output.message.startsWith("the config file contains a key value"));
      assertNoKey(outcome);
    }
  });

  test("a short current key is not searched for, and ordinary fields are not keys", async () => {
    const short = await runCli(harness({ "c.json": config({ model: "abc", limits: LIMITS, maxOutputTokens: 1 }) }, { argv: QUICK, env: { ANTHROPIC_API_KEY: "abc" } }).io);
    assert.equal(code(short), "done");
    const ordinary = harness(
      {
        "task.json": anthropicTask({ model: { provider: "anthropic", model: "m", maxOutputTokens: 1 } }),
        "c.json": config({ apiBaseUrl: "https://x.test", maxRetries: 1, requestTimeoutMs: 1, secretEnv: ["A"] }),
      },
      { argv: ["run", "--task", "task.json", "--config", "c.json"], env: { ...KEY_ENV, A: "fake-a-value" } },
    );
    assert.equal(code(await runCli(ordinary.io)), "done");
  });

  test("S-6 nesting deeper than 64 levels is invalid input, not a crash", async () => {
    const deep = `{"schemaVersion":1,"x":${"[".repeat(65)}${"]".repeat(65)}}`;
    const asConfig = await runCli(harness({ "c.json": deep }, { argv: QUICK }).io);
    assert.equal(code(asConfig), "invalid_config");
    const asTask = await runCli(harness({ "task.json": deep }).io);
    assert.equal(code(asTask), "invalid_task");
    assert.ok(asTask.output.kind === "error" && asTask.output.message.includes("nested more than 64 levels"));
  });

  test("S-8 a key in --goal is rejected before any file is read", async () => {
    const shaped = harness({}, { argv: ["run", "--workspace", "work", "--goal", `fix ${KEY_SHAPED}`] });
    const outcome = await runCli(shaped.io);
    assert.equal(code(outcome), "key_in_file");
    assertNoKey(outcome);
    const current = harness({}, { argv: ["run", "--workspace", "work", "--goal", `fix ${FAKE_KEY}`], env: KEY_ENV });
    assert.equal(code(await runCli(current.io)), "key_in_file");
  });
});

describe("resolveAnthropicSettings", () => {
  const env = { ANTHROPIC_API_KEY: FAKE_KEY, CODARYN_MODEL: "env-model" };
  const file = { schemaVersion: 1 as const, model: "config-model", maxOutputTokens: 100 };

  test("C-4 model: task, then CODARYN_MODEL, then config", () => {
    const pick = (model: string | undefined, e: Record<string, string>) => {
      const outcome = resolveAnthropicSettings(
        { provider: "anthropic", ...(model === undefined ? {} : { model }) },
        e,
        file,
      );
      return outcome.ok ? outcome.settings.model : outcome.code;
    };
    assert.equal(pick("task-model", env), "task-model");
    assert.equal(pick(undefined, env), "env-model");
    assert.equal(pick(undefined, { ANTHROPIC_API_KEY: FAKE_KEY, CODARYN_MODEL: "  " }), "config-model");
  });

  test("C-5 and C-6: base URL, output cap, timeout and retries", () => {
    const fromConfig = resolveAnthropicSettings(
      { provider: "anthropic", maxOutputTokens: 7 },
      env,
      { ...file, apiBaseUrl: "https://config.example.test", requestTimeoutMs: 1234, maxRetries: 5 },
    );
    assert.ok(fromConfig.ok);
    assert.deepEqual(fromConfig.settings, {
      apiKey: FAKE_KEY,
      model: "env-model",
      maxOutputTokens: 7,
      apiBaseUrl: "https://config.example.test",
      requestTimeoutMs: 1234,
      maxRetries: 5,
    });

    const envUrl = resolveAnthropicSettings(
      { provider: "anthropic" },
      { ...env, CODARYN_API_BASE_URL: "http://127.0.0.1:9/" },
      { ...file, apiBaseUrl: "https://config.example.test" },
    );
    assert.ok(envUrl.ok);
    assert.equal(envUrl.settings.apiBaseUrl, "http://127.0.0.1:9");
    assert.equal(envUrl.settings.maxOutputTokens, 100);

    const defaults = resolveAnthropicSettings({ provider: "anthropic" }, env, file);
    assert.ok(defaults.ok);
    assert.equal(defaults.settings.apiBaseUrl, DEFAULT_ANTHROPIC_API_BASE_URL);
    assert.equal(defaults.settings.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
    assert.equal(defaults.settings.maxRetries, DEFAULT_MAX_RETRIES);

    const badUrl = resolveAnthropicSettings({ provider: "anthropic" }, { ...env, CODARYN_API_BASE_URL: "http://x.test" }, file);
    assert.equal(badUrl.ok ? "ok" : badUrl.code, "invalid_config");
  });

  test("a missing key, model or output cap is provider_not_configured and names no value", () => {
    const cases: [Record<string, string>, CodarynConfig | null][] = [
      [{ CODARYN_MODEL: "m" }, file],
      [{ ANTHROPIC_API_KEY: FAKE_KEY }, { schemaVersion: 1, maxOutputTokens: 1 }],
      [{ ANTHROPIC_API_KEY: FAKE_KEY, CODARYN_MODEL: "m" }, null],
    ];
    for (const [e, c] of cases) {
      const outcome = resolveAnthropicSettings({ provider: "anthropic" }, e, c);
      assert.equal(outcome.ok ? "ok" : outcome.code, "provider_not_configured");
      assert.equal(JSON.stringify(outcome).includes(FAKE_KEY), false);
    }
  });
});

describe("runCli with settings", () => {
  test("C-1 a key field in the task or config file stops the run first", async () => {
    const cases: Harness[] = [
      harness({ "task.json": anthropicTask({ apiKey: FAKE_KEY, schemaVersion: 2 }) }, { env: KEY_ENV }),
      harness({ "task.json": anthropicTask({ goal: `use ${KEY_SHAPED}` }) }),
      harness({ "task.json": anthropicTask({ goal: `use ${FAKE_KEY}` }) }, { env: KEY_ENV }),
      harness(
        { "task.json": anthropicTask(), "c.json": config({ api_key: FAKE_KEY, unknown: true }) },
        { argv: ["run", "--task", "task.json", "--config", "c.json"], env: KEY_ENV },
      ),
    ];
    for (const h of cases) {
      const outcome = await runCli(h.io);
      assert.equal(code(outcome), "key_in_file");
      assert.equal(outcome.exitCode, 2);
      assert.equal(h.assembled.length, 0);
      assert.equal(h.settings.length, 0);
      assertNoKey(outcome);
    }
  });

  test("C-4 no model anywhere: provider_not_configured, nothing created or sent", async () => {
    const h = harness(
      { "task.json": anthropicTask({ model: { provider: "anthropic", maxOutputTokens: 64 } }) },
      { env: KEY_ENV },
    );
    const outcome = await runCli(h.io);
    assert.equal(code(outcome), "provider_not_configured");
    assert.equal(outcome.exitCode, 7);
    assert.equal(h.settings.length, 0);
    assert.equal(h.assembled.length, 0);
    assertNoKey(outcome);
  });

  test("--config wins over CODARYN_CONFIG; task model wins over both", async () => {
    const files = {
      "task.json": anthropicTask({ model: { provider: "anthropic", model: "task-model" } }),
      "a.json": config({ model: "a-model", maxOutputTokens: 11 }),
      "b.json": config({ model: "b-model", maxOutputTokens: 22 }),
    };
    const viaFlag = harness(files, {
      argv: ["run", "--task", "task.json", "--config", "a.json"],
      env: { ...KEY_ENV, CODARYN_CONFIG: "b.json" },
    });
    assert.equal(code(await runCli(viaFlag.io)), "done");
    assert.equal(viaFlag.settings[0]?.maxOutputTokens, 11);
    assert.equal(viaFlag.settings[0]?.model, "task-model");

    const viaEnv = harness(files, { env: { ...KEY_ENV, CODARYN_CONFIG: "b.json" } });
    assert.equal(code(await runCli(viaEnv.io)), "done");
    assert.equal(viaEnv.settings[0]?.maxOutputTokens, 22);
  });

  test("task and config files may start with a UTF-8 byte order mark", async () => {
    const bom = "﻿";
    const h = harness(
      {
        "task.json": bom + JSON.stringify(anthropicTask({ model: { provider: "anthropic", model: "m" } })),
        "c.json": bom + JSON.stringify(config({ maxOutputTokens: 3 })),
      },
      { argv: ["run", "--task", "task.json", "--config", "c.json"], env: KEY_ENV },
    );
    assert.equal(code(await runCli(h.io)), "done");
    assert.equal(h.settings[0]?.maxOutputTokens, 3);
  });

  test("an unreadable or invalid config file is invalid_config", async () => {
    const missing = harness({ "task.json": anthropicTask() }, { argv: ["run", "--task", "task.json", "--config", "none.json"] });
    assert.equal(code(await runCli(missing.io)), "invalid_config");
    const invalid = harness(
      { "task.json": anthropicTask(), "c.json": config({ maxRetries: -1 }) },
      { argv: ["run", "--task", "task.json", "--config", "c.json"] },
    );
    const outcome = await runCli(invalid.io);
    assert.equal(code(outcome), "invalid_config");
    assert.equal(outcome.exitCode, 2);
  });

  test("C-6, S-7 limits: per field from the task, else from the config; the config is an upper bound", async () => {
    const task = (limits: Record<string, unknown>) =>
      anthropicTask({ limits, model: { provider: "anthropic", model: "m", maxOutputTokens: 5 } });
    const configFile = config({ limits: { maxModelTurns: 10, maxToolCalls: 2, maxTotalTokens: 3000, maxDurationMs: 4000 } });
    const argv = ["run", "--task", "task.json", "--config", "c.json"];
    const merged = harness({ "task.json": task({ maxModelTurns: 9 }), "c.json": configFile }, { argv, env: KEY_ENV });
    assert.equal(code(await runCli(merged.io)), "done");
    assert.deepEqual(merged.assembled[0]?.task.limits, {
      maxModelTurns: 9,
      maxToolCalls: 2,
      maxTotalTokens: 3000,
      maxDurationMs: 4000,
      maxRepairAttempts: DEFAULT_MAX_REPAIR_ATTEMPTS,
      maxSameFailures: DEFAULT_MAX_SAME_FAILURES,
    });

    // S-7: the task may lower a config limit, never raise it or lift the token limit.
    for (const raised of [{ maxModelTurns: 11 }, { maxTotalTokens: null }, { maxTotalTokens: 3001 }]) {
      const over = harness({ "task.json": task(raised), "c.json": configFile }, { argv, env: KEY_ENV });
      const outcome = await runCli(over.io);
      assert.equal(code(outcome), "invalid_task", JSON.stringify(raised));
      assert.equal(over.assembled.length, 0);
    }

    const none = harness({ "task.json": task({ maxModelTurns: 9 }) }, { env: KEY_ENV });
    const outcome = await runCli(none.io);
    assert.equal(code(outcome), "invalid_task");
    assert.equal(outcome.output.kind === "error" && outcome.output.message.includes("limits.maxToolCalls"), true);
  });

  test("S-7 an anthropic run needs a token limit and every limit has an absolute cap", async () => {
    const argv = ["run", "--task", "task.json"];
    const model = { provider: "anthropic", model: "m", maxOutputTokens: 5 };
    const unlimited = harness({ "task.json": anthropicTask({ model, limits: { ...LIMITS, maxTotalTokens: null } }) }, { argv, env: KEY_ENV });
    assert.equal(code(await runCli(unlimited.io)), "invalid_task");
    const fromConfig = harness(
      { "c.json": config({ model: "m", maxOutputTokens: 5, limits: { ...LIMITS, maxTotalTokens: null } }) },
      { argv: ["run", "--workspace", "work", "--goal", "g", "--config", "c.json"], env: KEY_ENV },
    );
    assert.equal(code(await runCli(fromConfig.io)), "invalid_config");
    const huge = harness({ "task.json": anthropicTask({ model, limits: { ...LIMITS, maxModelTurns: 1001 } }) }, { argv, env: KEY_ENV });
    assert.equal(code(await runCli(huge.io)), "invalid_task");
    const repairs = harness({ "task.json": anthropicTask({ model, limits: { ...LIMITS, maxRepairAttempts: 21 } }) }, { argv, env: KEY_ENV });
    assert.equal(code(await runCli(repairs.io)), "invalid_task");
  });

  test("C-8 quick form builds the task from the config file", async () => {
    const policy = { commands: [{ executable: "node", argsPrefix: ["--test"], allowExtraArgs: false }], network: "deny", destructive: "deny", restorePathTokens: false };
    const verifiers = [{ id: "v", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] }];
    const h = harness(
      { "c.json": config({ model: "m", maxOutputTokens: 256, limits: LIMITS, policy, verifiers, secretEnv: ["FAKE_SECRET_ENV"] }) },
      {
        argv: ["run", "--workspace", "work", "--goal", "tidy the notes", "--config", "c.json"],
        env: { ...KEY_ENV, FAKE_SECRET_ENV: FAKE_SECRET },
      },
    );
    const outcome = await runCli(h.io);
    assert.equal(code(outcome), "done");
    const task = h.assembled[0]?.task;
    assert.deepEqual(task, {
      schemaVersion: 1,
      id: QUICK_TASK_ID,
      goal: "tidy the notes",
      workflow: "general",
      workspaceRoot: path.join(BASE, "work"),
      model: { provider: "anthropic" },
      policy,
      privacy: { secretEnv: ["FAKE_SECRET_ENV"] },
      limits: { ...LIMITS, maxRepairAttempts: DEFAULT_MAX_REPAIR_ATTEMPTS, maxSameFailures: DEFAULT_MAX_SAME_FAILURES },
      verifiers,
    });
    assert.equal(h.settings[0]?.model, "m");
    // The key is registered as a secret so it is masked wherever it shows up.
    assert.deepEqual(h.assembled[0]?.secrets, [FAKE_SECRET, FAKE_KEY]);
    assertNoKey(outcome);
  });

  test("C-8 quick form: no config means no limits (rejected); no policy means deny-all", async () => {
    const bare = harness({}, { argv: ["run", "--workspace", "work", "--goal", "g"], env: { ...KEY_ENV, CODARYN_MODEL: "m" } });
    const rejected = await runCli(bare.io);
    assert.equal(code(rejected), "invalid_config");
    assert.equal(bare.assembled.length, 0);

    const h = harness(
      { "c.json": config({ maxOutputTokens: 8, limits: LIMITS }) },
      { argv: ["run", "--workspace", "work", "--goal", "g", "--config", "c.json"], env: { ...KEY_ENV, CODARYN_MODEL: "m" } },
    );
    assert.equal(code(await runCli(h.io)), "done");
    assert.deepEqual(h.assembled[0]?.task.policy, DENY_ALL_POLICY);
    assert.deepEqual(h.assembled[0]?.task.verifiers, []);
  });

  test("C-2 --vars-file is loaded only when given; set variables win; unreadable is invalid_config", async () => {
    const files = {
      "task.json": anthropicTask({ model: { provider: "anthropic", maxOutputTokens: 4 } }),
      "local.env": "# loaded by the fake loader below\n",
      "bom.env": "﻿ANTHROPIC_API_KEY=x\n",
    };
    const loaded = harness(files, {
      argv: ["run", "--task", "task.json", "--vars-file", "local.env"],
      env: { CODARYN_MODEL: "already-set" },
      envFile: { ANTHROPIC_API_KEY: FAKE_KEY, CODARYN_MODEL: "from-file" },
    });
    const outcome = await runCli(loaded.io);
    assert.equal(code(outcome), "done");
    assert.deepEqual(loaded.envFiles, [path.join(BASE, "local.env")]);
    assert.equal(loaded.settings[0]?.apiKey, FAKE_KEY);
    assert.equal(loaded.settings[0]?.model, "already-set");
    assertNoKey(outcome);

    const notGiven = harness(files, { envFile: { ANTHROPIC_API_KEY: FAKE_KEY } });
    assert.equal(code(await runCli(notGiven.io)), "provider_not_configured");
    assert.deepEqual(notGiven.envFiles, []);

    const unreadable = harness(files, { argv: ["run", "--task", "task.json", "--vars-file", "x.env"], envFile: "unreadable" });
    assert.equal(code(await runCli(unreadable.io)), "invalid_config");

    // Node's loader would take the BOM as part of the first name and skip that variable silently.
    const bom = harness(files, { argv: ["run", "--task", "task.json", "--vars-file", "bom.env"], envFile: { ANTHROPIC_API_KEY: FAKE_KEY } });
    const rejected = await runCli(bom.io);
    assert.equal(code(rejected), "invalid_config");
    assert.deepEqual(bom.envFiles, []);
  });

  test("config secretEnv is added to the task's; an unset one is secret_env_missing", async () => {
    const files = {
      "task.json": anthropicTask({ privacy: { secretEnv: ["A_ENV"] }, model: { provider: "anthropic", model: "m", maxOutputTokens: 4 } }),
      "c.json": config({ secretEnv: ["A_ENV", "B_ENV"] }),
    };
    const argv = ["run", "--task", "task.json", "--config", "c.json"];
    const h = harness(files, { argv, env: { ...KEY_ENV, A_ENV: "fake-a-value", B_ENV: "fake-b-value" } });
    assert.equal(code(await runCli(h.io)), "done");
    assert.deepEqual(h.assembled[0]?.task.privacy.secretEnv, ["A_ENV", "B_ENV"]);
    assert.deepEqual(h.assembled[0]?.secrets, ["fake-a-value", "fake-b-value", FAKE_KEY]);

    const missing = harness(files, { argv, env: { ...KEY_ENV, A_ENV: "fake-a-value" } });
    const outcome = await runCli(missing.io);
    assert.equal(code(outcome), "secret_env_missing");
    // S-3: the position in the file it came from, never the name.
    assert.equal(outcome.output.kind === "error" ? outcome.output.message : "", "secretEnv[1] names an environment variable that is not set");

    const ownMissing = harness(files, { argv, env: { ...KEY_ENV, B_ENV: "fake-b-value" } });
    const own = await runCli(ownMissing.io);
    assert.equal(own.output.kind === "error" ? own.output.message : "", "privacy.secretEnv[0] names an environment variable that is not set");
  });

  test("S-4 values the env file newly sets are secrets; settings, short values and set variables are not", async () => {
    const files = { "task.json": anthropicTask({ model: { provider: "anthropic", model: "m", maxOutputTokens: 4 } }), "x.env": "" };
    const h = harness(files, {
      argv: ["run", "--task", "task.json", "--vars-file", "x.env"],
      env: { ALREADY_SET: "fake-already-set-value" },
      envFile: {
        ANTHROPIC_API_KEY: FAKE_KEY,
        OTHER_SERVICE_PASSWORD: "fake-other-password-1",
        SHORT: "1234567",
        CODARYN_MODEL: "fake-model-from-env",
        ALREADY_SET: "fake-ignored-by-loader",
      },
    });
    assert.equal(code(await runCli(h.io)), "done");
    const secrets = h.assembled[0]?.secrets ?? [];
    assert.ok(secrets.includes("fake-other-password-1"));
    assert.ok(secrets.includes(FAKE_KEY));
    for (const value of ["1234567", "fake-model-from-env", "fake-already-set-value", "fake-ignored-by-loader"]) {
      assert.equal(secrets.includes(value), false, value);
    }
  });

  test("the scripted provider rejects anthropic-only model fields", async () => {
    const h = harness({
      "task.json": anthropicTask({ model: { provider: "scripted", scriptPath: "s.json", model: "m" } }),
    });
    assert.equal(code(await runCli(h.io)), "invalid_task");
  });
});
