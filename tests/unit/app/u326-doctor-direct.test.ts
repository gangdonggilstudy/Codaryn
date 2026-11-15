/** U-326: public app adapter boundaries fixed on adopted OLD before wiring. Synthetic ports only. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppEnvironment, DoctorRequest } from "../../../src/app/index.js";

const empty: DoctorRequest = { configPath: null, varsFile: null, taskPath: null, workspace: null };
const internal = { ok: false, error: { code: "internal_error", message: "the call stopped because of an internal error" } };
function environment(overrides: Partial<AppEnvironment> = {}): AppEnvironment {
  return {
    env: {}, cwd: "D:/synthetic-u326-doctor", nodeVersion: "26.0.0", installDir: null,
    readFile: async () => { throw new Error("unexpected synthetic read"); },
    isDirectory: async () => false, isFile: async () => false, readVarsFile: () => { throw new Error("unexpected vars reader"); },
    clock: { now: () => 0 }, randomBytes: (size) => new Uint8Array(size),
    platform: "win32", homeDir: null, osLocale: null, ...overrides,
  };
}
function observeEnvironment(trace: string[], failureAt?: keyof AppEnvironment) {
  let armed = false;
  let ioCalls = 0;
  const failure = new Error("synthetic environment getter failure");
  const values = environment({
    env: { get U326_MARK() { if (armed) trace.push("env.value"); return "synthetic"; } },
    readFile: async () => { ioCalls++; throw new Error("unexpected read"); },
    isDirectory: async () => { ioCalls++; return false; }, isFile: async () => { ioCalls++; return false; },
  });
  const port = { ...values };
  for (const name of ["platform", "env", "cwd", "nodeVersion", "installDir", "readFile", "isDirectory", "isFile", "homeDir", "osLocale"] as const) {
    Object.defineProperty(port, name, { get() {
      if (armed) { trace.push(name); if (name === failureAt) throw failure; }
      return values[name];
    } });
  }
  const app = createCodarynApp(port);
  return { app, arm() { armed = true; trace.length = 0; }, ioCalls: () => ioCalls, failure };
}

test("U-326: request getters keep order, null once/non-null twice, before all io construction", async () => {
  for (const present of [false, true]) {
    const trace: string[] = [];
    const probe = observeEnvironment(trace);
    const request: DoctorRequest = {
      get configPath() { trace.push("request.config"); return present ? "c.json" : null; },
      get varsFile() { trace.push("request.vars"); return present ? "v.env" : null; },
      get taskPath() { trace.push("request.task"); return present ? "t.json" : null; },
      get workspace() { trace.push("request.workspace"); return present ? "work" : null; },
    };
    probe.arm();
    const out = await probe.app.doctor(request);
    const prefix = ["request.config", "request.vars", "request.task", "request.workspace"].flatMap((name) => present ? [name, name] : [name]);
    assert.deepEqual(trace.slice(0, prefix.length), prefix);
    assert.equal(trace[prefix.length], "env");
    assert.equal(probe.ioCalls(), 0);
    if (present) assert.ok(!out.ok && out.error.code === "invalid_arguments"); else assert.ok(out.ok);
  }
});

test("U-326: second request getter throw rejects with its original value before try and later reads", async () => {
  const names = ["configPath", "varsFile", "taskPath", "workspace"] as const;
  const thrown = [undefined, null, new Error("synthetic request failure"), Symbol("synthetic-request")];
  for (let index = 0; index < names.length; index++) {
    const trace: string[] = [];
    const probe = observeEnvironment(trace);
    const request = { ...empty };
    for (const [i, name] of names.entries()) {
      let reads = 0;
      Object.defineProperty(request, name, { get() {
        trace.push(name);
        if (i === index && ++reads === 2) throw thrown[index];
        return "synthetic";
      } });
    }
    probe.arm();
    const pending = probe.app.doctor(request);
    assert.ok(pending instanceof Promise);
    const result = await pending.then(() => ({ rejected: false, value: null }), (value: unknown) => ({ rejected: true, value }));
    assert.ok(result.rejected);
    assert.equal(result.value, thrown[index]);
    assert.deepEqual(trace, names.slice(0, index + 1).flatMap((name) => [name, name]));
    assert.equal(probe.ioCalls(), 0);
  }
});

const ioOrder = ["env", "env.value", "cwd", "nodeVersion", "installDir", "readFile", "isDirectory", "isFile", "env", "homeDir", "env", "homeDir", "osLocale"];
test("U-326: whole original io literal/default observations precede parser refusal", async () => {
  const trace: string[] = [];
  const probe = observeEnvironment(trace);
  probe.arm();
  const out = await probe.app.doctor({ ...empty, taskPath: "task.json", workspace: "work" });
  assert.ok(!out.ok && out.error.code === "invalid_arguments");
  assert.deepEqual(trace, ioOrder);
  assert.equal(probe.ioCalls(), 0);
});

test("U-326: supported io getter failures beat invalid argv and map to outer internal_error", async () => {
  for (const name of ["env", "cwd", "nodeVersion", "installDir", "readFile", "isDirectory", "isFile", "homeDir", "osLocale"] as const) {
    const trace: string[] = [];
    const probe = observeEnvironment(trace, name);
    probe.arm();
    assert.deepEqual(await probe.app.doctor({ ...empty, taskPath: "task.json", workspace: "work" }), internal);
    assert.deepEqual(trace, ioOrder.slice(0, ioOrder.indexOf(name) + 1));
    assert.equal(probe.ioCalls(), 0);
  }
});

type Scenario = "no-io" | "parse-refusal" | "path-refusal" | "deferred-read" | "core-throw" | "io-getter-throw";
const expected: Record<Scenario, string[]> = {
  "no-io": ["returned", "queued", "fulfilled", "after-await"],
  "parse-refusal": ["returned", "queued", "fulfilled", "after-await"],
  "path-refusal": ["returned", "queued", "fulfilled", "after-await"],
  "deferred-read": ["read", "returned", "queued", "tick1", "tick2", "fulfilled", "after-await"],
  "core-throw": ["directory", "returned", "queued", "fulfilled", "after-await"],
  "io-getter-throw": ["readFile.get", "returned", "fulfilled", "queued", "after-await"],
};
for (const scenario of Object.keys(expected) as Scenario[]) test(`U-326 public Promise trace: ${scenario}`, async (t) => {
  const trace: string[] = [];
  let release!: (text: string) => void;
  const deferred = new Promise<string>((resolve) => { release = resolve; });
  let armed = false;
  const env = environment({
    readFile: () => { trace.push("read"); return deferred; },
    isDirectory: async () => { trace.push("directory"); throw new Error("synthetic core failure"); },
  });
  if (scenario === "io-getter-throw") Object.defineProperty(env, "readFile", { get() { if (armed) { trace.push("readFile.get"); throw new Error("synthetic port failure"); } return async () => ""; } });
  const app = createCodarynApp(env);
  armed = true;
  trace.length = 0;
  const request = scenario === "parse-refusal" ? { ...empty, taskPath: "t.json", workspace: "work" }
    : scenario === "path-refusal" ? { ...empty, configPath: "//127.0.0.1/share/c.json" }
      : scenario === "deferred-read" ? { ...empty, varsFile: "synthetic.env" }
        : scenario === "core-throw" ? { ...empty, workspace: "work" } : empty;
  const pending = app.doctor(request);
  assert.ok(pending instanceof Promise);
  trace.push("returned");
  const observed = pending.then((out) => { trace.push("fulfilled"); return out; });
  queueMicrotask(() => trace.push("queued"));
  if (scenario === "deferred-read") {
    release("");
    queueMicrotask(() => { trace.push("tick1"); queueMicrotask(() => trace.push("tick2")); });
  }
  const outcome = await observed;
  trace.push("after-await");
  const bytes = JSON.stringify(outcome);
  t.diagnostic(JSON.stringify({ scenario, trace, bytes: Buffer.byteLength(bytes), sha256: createHash("sha256").update(bytes).digest("hex") }));
  assert.deepEqual(trace, expected[scenario]);
  if (scenario === "core-throw" || scenario === "io-getter-throw") assert.deepEqual(outcome, internal);
  else if (scenario.endsWith("refusal")) assert.ok(!outcome.ok && outcome.error.code === "invalid_arguments");
  else assert.ok(outcome.ok);
});

test("U-326: unknown extra sentinel getters are not supported ports and are not newly spread", async () => {
  const port = environment();
  // Unknown extra properties are sentinels for accidental spreading, not additions to AppEnvironment.
  for (const name of ["inspectLock", "listParkedFiles", "messages", "stdoutIsTerminal", "realpath"]) {
    Object.defineProperty(port, name, { enumerable: true, get() { throw new Error("unknown sentinel property must not be read"); } });
  }
  const outcome = await createCodarynApp(port).doctor(empty);
  assert.ok(outcome.ok);
  assert.deepEqual(Object.keys(outcome), ["ok", "output"]);
});

test("U-326: reused E4 string-mask and serialized-field cases retain final JSON/error behavior", async () => {
  // Two existing E4 boundary inputs, not a replacement for the frozen 141-observation oracle.
  for (const registered of ["doctor." + "node_version.ok", '"id":' + '"node_version"']) {
    const outcome = await createCodarynApp(environment({ env: { ANTHROPIC_API_KEY: registered } })).doctor(empty);
    if (registered.startsWith('"')) assert.deepEqual(outcome, internal);
    else {
      assert.ok(outcome.ok);
      assert.equal(outcome.output.checks[0]!.text?.id, "[key]");
      assert.equal(JSON.stringify(outcome).includes(registered), false);
      assert.deepEqual(Object.keys(outcome), ["ok", "output"]);
    }
  }
});
