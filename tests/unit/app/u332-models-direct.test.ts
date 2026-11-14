/** U332: public app boundary fixtures fixed on the actual OLD; synthetic ports only. */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { createCodarynApp, INTERNAL_ERROR } from "../../../src/app/index.js";
import type { AppEnvironment, AppHooks, ListModelsRequest, SelectModelRequest } from "../../../src/app/index.js";

const KEY = "synthetic-private-value-u332";
const request: ListModelsRequest = { provider: "anthropic", configPath: null, varsFile: null };
const config = path.resolve("D:/synthetic-u332/config.json");
const before = '{"schemaVersion":1,"model":"model-a"}';
type Listing = NonNullable<AppHooks["listModels"]>;
type Listed = Awaited<ReturnType<Listing>>;
const models = ["model-a", "model-b"].map((id) => ({ id, displayName: id, createdAt: null, maxInputTokens: null, maxOutputTokens: null }));
const listed = { ok: true, models } as const;
const list: Listing = async () => listed;
function environment(overrides: Partial<AppEnvironment> = {}): AppEnvironment {
  const base: AppEnvironment = {
    env: { ANTHROPIC_API_KEY: KEY }, cwd: "D:/synthetic-u332", platform: "win32", homeDir: null,
    nodeVersion: "26.0.0", installDir: null, osLocale: null,
    readFile: async () => { throw new Error("unexpected synthetic read"); },
    isDirectory: async () => false, isFile: async () => false,
    readVarsFile: () => { throw new Error("unexpected synthetic vars reader"); },
    clock: { now: () => 0 }, randomBytes: (size) => new Uint8Array(size),
  };
  return Object.defineProperties(base, Object.getOwnPropertyDescriptors(overrides));
}
function output(value: Awaited<ReturnType<ReturnType<typeof createCodarynApp>["listModels"]>>) {
  assert.ok(value.ok, JSON.stringify(value));
  return value.output;
}

test("U332 borrowed list method keeps request/io getter order and optional hook reads", async () => {
  const trace: string[] = [];
  let armed = false;
  const note = (name: string) => { if (armed) trace.push(name); };
  const env = environment();
  const app = createCodarynApp(environment({
    get env() { note("env"); return env.env; }, get cwd() { note("cwd"); return env.cwd; },
    get readFile() { note("readFile"); return env.readFile; }, get homeDir() { note("homeDir"); return null; },
  }), {
    get listModels() { note("listModels"); return list; },
    get anthropicDeps() { note("anthropicDeps"); return undefined; },
    get providerDeps() { note("providerDeps"); return {}; },
    get writeConfig() { note("writeConfig"); return async () => { throw new Error("unexpected writer"); }; },
  });
  const input: ListModelsRequest = {
    get provider() { trace.push("provider"); return "anthropic"; },
    get configPath() { trace.push("config"); return null; }, get varsFile() { trace.push("vars"); return null; },
  };
  armed = true;
  const borrowed = app.listModels;
  assert.equal(output(await borrowed.call(undefined, input)).status, "listed");
  assert.deepEqual(trace, ["provider", "provider", "config", "vars", "env", "cwd", "readFile", "listModels", "anthropicDeps", "providerDeps", "providerDeps", "env", "homeDir", "writeConfig", "writeConfig"]);
});

test("U332 request refusal precedes environment and all ports", async () => {
  let armed = false, reads = 0;
  const app = createCodarynApp(environment({ get env() { if (armed) reads++; return {}; } }), { listModels: async () => { throw new Error("unexpected listing"); } });
  armed = true;
  for (const input of [{ ...request, provider: "unknown" }, { ...request, model: "--json" }]) {
    const refused = await app.selectModel({ ...input, model: "model" in input ? input.model : "model-a" });
    assert.equal(refused.ok ? null : refused.error.code, "invalid_arguments");
  }
  assert.equal(reads, 0);
});

test("U332 pre-try request and environment throws remain identical Promise rejections", async () => {
  const app = createCodarynApp(environment(), { listModels: list });
  for (const fault of [new Error("synthetic request"), Symbol("synthetic request"), null]) {
    const pending = app.listModels({ ...request, get configPath(): string | null { throw fault; } });
    assert.ok(pending instanceof Promise);
    await pending.then(() => assert.fail("expected rejection"), (error: unknown) => assert.equal(error, fault));
  }
  let armed = false;
  const envApp = createCodarynApp(environment({ get env() { if (armed) throw undefined; return {}; } }));
  armed = true;
  await envApp.listModels(request).then(() => assert.fail("expected env rejection"), (error: unknown) => assert.equal(error, undefined));
});

test("U332 io literal getter throws are fulfilled internal errors", async () => {
  let armed = false;
  const cwd = createCodarynApp(environment({ get cwd() { if (armed) throw new Error("synthetic cwd"); return "D:/synthetic-u332"; } }));
  const hooks = createCodarynApp(environment(), { get providerDeps(): AppHooks["providerDeps"] { throw new Error("synthetic hook"); } });
  armed = true;
  assert.deepEqual(await cwd.listModels(request), { ok: false, error: INTERNAL_ERROR });
  assert.deepEqual(await hooks.listModels(request), { ok: false, error: INTERNAL_ERROR });
});

test("U332 deferred listing retains copied env, lister receiver and completion order", { timeout: 2000 }, async () => {
  const gate = Promise.withResolvers<Listed>();
  const trace: string[] = [];
  const env = { ANTHROPIC_API_KEY: KEY, CODARYN_MODEL: "model-a" };
  const app = createCodarynApp(environment({ env }), { listModels: function (this: unknown) { assert.equal(this, undefined); trace.push("list"); return gate.promise; } });
  const pending = app.listModels(request).then((value) => { trace.push("fulfilled"); return value; });
  trace.push("returned");
  queueMicrotask(() => trace.push("queued"));
  await Promise.resolve();
  assert.deepEqual(trace, ["list", "returned", "queued"]);
  env.CODARYN_MODEL = "model-b";
  trace.push("release"); gate.resolve(listed);
  assert.deepEqual(output(await pending).current, { id: "model-a", source: "CODARYN_MODEL", listed: true });
  assert.deepEqual(trace, ["list", "returned", "queued", "release", "fulfilled"]);
  assert.equal(env.CODARYN_MODEL, "model-b");
});

test("U332 deferred select number 2 preserves borrowed read receiver and writer options", { timeout: 2000 }, async () => {
  const entered = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>();
  const trace: string[] = [], reads: string[] = [];
  const app = createCodarynApp(environment({ readFile: async function (this: unknown, file) {
    const io = this as { argv: readonly string[]; env: Readonly<Record<string, string | undefined>> };
    assert.equal(io.env["ANTHROPIC_API_KEY"], KEY); assert.ok(io.argv.includes("--json")); assert.equal(file, config);
    return before;
  } }), { listModels: list, writeConfig: function (this: unknown, file, text, options) {
    assert.equal(this, undefined); assert.equal(file, config);
    assert.deepEqual(options, { exclusive: false, expected: before });
    assert.deepEqual(JSON.parse(text), { schemaVersion: 1, model: "model-b" });
    trace.push("write"); entered.resolve(); return gate.promise;
  } });
  const input: SelectModelRequest = {
    get provider() { reads.push("provider"); return "anthropic"; },
    get configPath() { reads.push("config"); return config; }, get varsFile() { reads.push("vars"); return null; },
    get model() { reads.push("model"); return "2"; },
  };
  const pending = app.selectModel(input).then((value) => { trace.push("fulfilled"); return value; });
  trace.push("returned"); queueMicrotask(() => trace.push("queued"));
  await entered.promise;
  assert.deepEqual(reads, ["provider", "provider", "config", "config", "vars", "model", "model", "model"]);
  assert.deepEqual(trace, ["returned", "queued", "write"]);
  trace.push("release"); gate.resolve();
  assert.deepEqual(output(await pending).selected, { id: "model-b", created: false, overriddenBy: null });
  assert.deepEqual(trace, ["returned", "queued", "write", "release", "fulfilled"]);
});

test("U332 vars reader is late, unbound, and changes only the per-call env copy", async () => {
  const env = {}, vars = path.resolve("D:/synthetic-u332/vars.env");
  let read = false, getters = 0, listings = 0;
  const app = createCodarynApp(environment({ env,
    readFile: async (file) => { assert.equal(file, vars); read = true; return "SYNTHETIC=value"; },
    get readVarsFile() { assert.equal(read, true); getters++; return function (this: unknown, file: string) { assert.equal(this, undefined); assert.equal(file, vars); return { ANTHROPIC_API_KEY: KEY }; }; },
  }), { listModels: async (settings) => { listings++; assert.equal(settings.apiKey, KEY); return listed; } });
  assert.equal(output(await app.listModels({ ...request, varsFile: vars })).status, "listed");
  assert.equal(getters, 1); assert.equal(listings, 1); assert.deepEqual(env, {});
});

test("U332 JSON completion masks a registered value inside a closed word", async () => {
  const app = createCodarynApp(environment(), { listModels: async () => ({ ok: true, models: [{ ...models[0]!, displayName: `prefix${KEY}suffix 한글` }] }) });
  const result = output(await app.listModels(request));
  assert.equal(result.models[0]?.displayName, "prefix[secret]suffix 한글");
  assert.deepEqual(Object.keys(result), ["schemaVersion", "kind", "status", "exitCode", "models", "current", "selected"]);
  assert.equal(JSON.stringify(result).includes(KEY), false);
});

test("U332 whole-JSON masking retains the existing structure-boundary internal error", async () => {
  const app = createCodarynApp(environment({ env: { ANTHROPIC_API_KEY: '\"kind\":\"models\"' } }), { listModels: list });
  assert.deepEqual(await app.listModels(request), { ok: false, error: INTERNAL_ERROR });
});

test("U332 OpenAI uses its injected fetch rather than the anthropic list hook", async () => {
  let calls = 0;
  const app = createCodarynApp(environment({ env: { OPENAI_API_KEY: KEY, CODARYN_OPENAI_API_BASE_URL: "http://127.0.0.1:1/v1" } }), {
    listModels: async () => { throw new Error("anthropic must not be selected"); },
    providerDeps: { openai: { fetch: async (input) => {
      calls++; assert.equal(new URL(String(input)).hostname, "127.0.0.1");
      return new Response(JSON.stringify({ object: "list", data: [{ id: "model-b", object: "model", created: 0, owned_by: "synthetic" }] }), { status: 200, headers: { "content-type": "application/json" } });
    } } },
  });
  assert.equal(output(await app.listModels({ ...request, provider: "openai" })).models[0]?.id, "model-b");
  assert.equal(calls, 1);
});
