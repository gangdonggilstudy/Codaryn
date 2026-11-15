import assert from "node:assert/strict";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createCodarynApp } from "../../../src/app/app.js";
import type { AppHooks } from "../../../src/app/app.js";
import type { AppEnvironment, CodarynApp, CreateSettingsRequest } from "../../../src/contracts/app.js";
import { INTERNAL_ERROR } from "../../../src/app/errors.js";
import { tempDir } from "./support.js";

const keyName = ["ANTHROPIC", "API", "KEY"].join("_");
const syntheticValue = "synthetic-u334-value";
const request: CreateSettingsRequest = { configPath: null, workspace: null };
type Result = Awaited<ReturnType<CodarynApp["createSettings"]>>;
function code(result: Result) { return result.ok ? null : result.error.code; }
function environment(cwd: string, overrides: Partial<AppEnvironment> = {}): AppEnvironment {
  const base: AppEnvironment = {
    cwd, env: {}, platform: process.platform, homeDir: null, installDir: null, nodeVersion: "26.0.0",
    readFile: async () => { throw new Error("unexpected reader"); },
    isDirectory: async () => false, isFile: async () => false,
    readVarsFile: () => { throw new Error("unexpected vars reader"); },
    clock: { now: () => 0 }, randomBytes: (size) => new Uint8Array(size),
  };
  return Object.defineProperties(base, Object.getOwnPropertyDescriptors(overrides));
}

test("U334 public borrowed createSettings keeps JSON fields, defaults, and exclusive bytes", async () => {
  const base = await tempDir("codaryn-u334-");
  const file = path.join(base, "new", "config.json");
  const env = { [keyName]: syntheticValue, CODARYN_CONFIG: path.join(base, "read-only.json") };
  const app = createCodarynApp(environment(base, { env }), {
    get listModels(): AppHooks["listModels"] { throw new Error("no listing hook read"); },
    get providerDeps(): AppHooks["providerDeps"] { throw new Error("no transport read"); },
  });
  const borrowed: CodarynApp["createSettings"] = app.createSettings;
  const pending: ReturnType<CodarynApp["createSettings"]> = borrowed.call(undefined, { configPath: file, workspace: null });
  assert.ok(pending instanceof Promise);
  const result = await pending;
  assert.ok(result.ok);
  assert.deepEqual(Object.keys(result), ["ok", "output"]);
  assert.deepEqual(Object.keys(result.output), ["schemaVersion", "kind", "status", "exitCode", "config", "interactive", "model", "language", "commands", "protectedPaths", "keySet", "overriddenBy"]);
  assert.deepEqual(result.output, {
    schemaVersion: 1, kind: "init", status: "created", exitCode: 0,
    config: { source: "argument", display: "--config" }, interactive: false, model: "placeholder",
    language: null, commands: 0, protectedPaths: 0, keySet: true, overriddenBy: "CODARYN_CONFIG",
  });
  assert.deepEqual(Object.keys(result.output.config), ["source", "display"]);
  const bytes = await readFile(file, "utf8");
  assert.equal(bytes.endsWith("\n"), true);
  assert.equal(bytes.includes(syntheticValue), false);
  assert.deepEqual(Object.keys(JSON.parse(bytes)), ["schemaVersion", "model", "maxOutputTokens", "limits", "policy"]);
  assert.equal(code(await borrowed({ configPath: file, workspace: null })), "config_exists");
  assert.equal(await readFile(file, "utf8"), bytes);
  assert.equal(env[keyName], syntheticValue);
});

test("U334 request then full io literal evaluates before canonical argument refusal", async () => {
  const trace: string[] = [];
  let armed = false;
  const note = (name: string) => { if (armed) trace.push(name); };
  const plain = environment(path.resolve("synthetic-u334"));
  const app = createCodarynApp(environment(plain.cwd, {
    get env() { note("env"); return {}; }, get cwd() { note("cwd"); return plain.cwd; },
    get homeDir() { note("homeDir"); return null; },
    get readFile() { note("readFile"); return plain.readFile; },
    get isDirectory() { note("isDirectory"); return plain.isDirectory; },
  }));
  armed = true;
  const result = await app.createSettings({
    get configPath() { trace.push("config"); return "--json"; },
    get workspace() { trace.push("workspace"); return "missing"; },
  });
  assert.equal(code(result), "invalid_arguments");
  assert.deepEqual(trace, ["config", "config", "workspace", "workspace", "env", "cwd", "env", "homeDir", "env", "homeDir", "readFile", "isDirectory"]);
});

test("U334 request and io getter throws stay fulfilled internal errors inside try", async () => {
  const cwd = path.resolve("synthetic-u334");
  for (const fault of [new Error("synthetic getter"), Symbol("synthetic getter"), null, undefined]) {
    const app = createCodarynApp(environment(cwd));
    const pending = app.createSettings({ ...request, get configPath(): string | null { throw fault; } });
    assert.ok(pending instanceof Promise);
    assert.deepEqual(await pending, { ok: false, error: INTERNAL_ERROR });
  }
  for (const member of ["env", "cwd", "homeDir", "readFile", "isDirectory"] as const) {
    let armed = false;
    const overrides = Object.defineProperty({}, member, { enumerable: true, get() { if (armed) throw new Error(member); return environment(cwd)[member]; } });
    const app = createCodarynApp(environment(cwd, overrides));
    armed = true;
    assert.deepEqual(await app.createSettings(request), { ok: false, error: INTERNAL_ERROR });
  }
});

test("U334 deferred workspace check retains receiver, copied env and completion order", { timeout: 3000 }, async () => {
  const base = await tempDir("codaryn-u334-deferred-");
  const file = path.join(base, "not-created", "config.json");
  const trace: string[] = [];
  const gate = Promise.withResolvers<boolean>();
  const env = { [keyName]: syntheticValue };
  let copied: AppEnvironment["env"] | undefined;
  const app = createCodarynApp(environment(base, { env,
    isDirectory: function (this: { readonly env: AppEnvironment["env"] }, dir) {
      assert.equal(dir, path.join(base, "missing"));
      copied = this.env;
      assert.notEqual(copied, env);
      trace.push("directory"); return gate.promise;
    },
  }));
  const pending = app.createSettings({ configPath: file, workspace: path.join(base, "missing") }).then((value) => { trace.push("fulfilled"); return value; });
  trace.push("returned"); queueMicrotask(() => trace.push("queued"));
  await Promise.resolve();
  assert.deepEqual(trace, ["directory", "returned", "queued"]);
  env[keyName] = "changed-after-call";
  assert.equal(copied?.[keyName], syntheticValue);
  trace.push("release"); gate.resolve(false);
  assert.equal(code(await pending), "workspace_not_found");
  assert.deepEqual(trace, ["directory", "returned", "queued", "release", "fulfilled"]);
  await assert.rejects(lstat(path.dirname(file)), { code: "ENOENT" });
});

test("U334 workspace sync throws and rejected ports stay internal errors", async () => {
  const base = await tempDir("codaryn-u334-port-");
  for (const isDirectory of [() => { throw Symbol("sync port"); }, () => Promise.reject(null)]) {
    const app = createCodarynApp(environment(base, { isDirectory }));
    assert.deepEqual(await app.createSettings({ configPath: path.join(base, "not-created", "config.json"), workspace: "work" }), { ok: false, error: INTERNAL_ERROR });
  }
  await assert.rejects(lstat(path.join(base, "not-created")), { code: "ENOENT" });
});

test("U334 workspace refusal precedes existing-file and write errors without side effects", async () => {
  const base = await tempDir("codaryn-u334-refusal-");
  const workspace = path.join(base, "work"); await mkdir(workspace);
  const file = path.join(workspace, "config.json"); await writeFile(file, "original\n");
  const missing = createCodarynApp(environment(base));
  assert.equal(code(await missing.createSettings({ configPath: file, workspace })), "workspace_not_found");
  const inside = createCodarynApp(environment(base, { isDirectory: async () => true }));
  assert.equal(code(await inside.createSettings({ configPath: file, workspace })), "invalid_config");
  assert.equal(await readFile(file, "utf8"), "original\n");
});

test("U334 mkdir failure preserves the original platform error precedence and blocking file", async () => {
  const base = await tempDir("codaryn-u334-write-");
  const blocked = path.join(base, "parent"); await writeFile(blocked, "blocking parent\n");
  const app = createCodarynApp(environment(base));
  assert.equal(code(await app.createSettings({ configPath: path.join(blocked, "config.json"), workspace: null })), process.platform === "win32" ? "config_exists" : "config_write_failed");
  assert.equal(await readFile(blocked, "utf8"), "blocking parent\n");
});

test("U334 failed exclusive write maps to config_write_failed after parent creation", async () => {
  const base = await tempDir("codaryn-u334-long-name-");
  const parent = path.join(base, "new");
  const file = path.join(parent, "x".repeat(300));
  const app = createCodarynApp(environment(base));
  assert.equal(code(await app.createSettings({ configPath: file, workspace: null })), "config_write_failed");
  assert.equal((await lstat(parent)).isDirectory(), true);
});

test("U334 concurrent exclusive creation writes once and the losing call refuses", async () => {
  const base = await tempDir("codaryn-u334-exclusive-");
  const file = path.join(base, "new", "config.json");
  const app = createCodarynApp(environment(base));
  const results = await Promise.all([app.createSettings({ configPath: file, workspace: null }), app.createSettings({ configPath: file, workspace: null })]);
  assert.equal(results.filter((value) => value.ok).length, 1);
  assert.deepEqual(results.filter((value) => !value.ok).map(code), ["config_exists"]);
  assert.equal(JSON.parse(await readFile(file, "utf8")).schemaVersion, 1);
});

test("U334 missing default refuses before touching a target", async () => {
  const base = await tempDir("codaryn-u334-default-");
  assert.equal(code(await createCodarynApp(environment(base)).createSettings(request)), "invalid_config");
  await assert.rejects(lstat(path.join(base, "Codaryn")), { code: "ENOENT" });
});
