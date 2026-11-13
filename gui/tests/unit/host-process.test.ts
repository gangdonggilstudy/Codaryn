/**
 * GU-1: the engine host as a separate Node process (DR-26) and the main process's client
 * (src/main/engine-client.ts), over stdin and stdout only. Runs under the test's own Node (26+),
 * without Electron: the real host script with the real engine (the root build, dist/src), with
 * fake engines, and fake hosts that break the channel.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import net from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { startEngineHost } from "../../src/main/engine-client.js";
import type { EngineHost, EngineHostOptions } from "../../src/main/engine-client.js";
import { hostEnvironment } from "../../src/main/environment.js";

// This file runs as gui/build/tests/unit/host-process.test.js.
const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const HOST_SCRIPT = path.join(GUI, "build", "src", "engine-host", "main.js");
const ENGINE_DIR = path.join(GUI, "..", "dist", "src");
const ENGINE_BUILT = existsSync(path.join(ENGINE_DIR, "app", "index.js"));

/** The host's environment for tests: no API key, a config file that does not exist, a fixed language. */
function testEnv(dir: string, extra: Record<string, string> = {}): Record<string, string> {
  const env = hostEnvironment(process.env);
  for (const name of Object.keys(env)) {
    // Every provider key and every Codaryn variable (models, addresses, config, language) of this machine stays out.
    if (/^(ANTHROPIC_API_KEY|OPENAI_API_KEY|CODARYN_[A-Z0-9_]+)$/i.test(name)) delete env[name];
  }
  return { ...env, CODARYN_CONFIG: path.join(dir, "no-config.json"), ...extra };
}

async function tempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gui-host-"));
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

/** R21-I-3: every host these tests start reaches this machine only (the test transport). */
function options(dir: string, overrides: Partial<EngineHostOptions> = {}): EngineHostOptions {
  return { nodePath: process.execPath, hostScript: HOST_SCRIPT, engineDir: ENGINE_DIR, env: testEnv(dir), cwd: dir, transport: "loopback-only", ...overrides };
}

async function started(opts: EngineHostOptions): Promise<EngineHost> {
  const outcome = await startEngineHost(opts);
  assert.ok(outcome.ok, `the host started: ${JSON.stringify(outcome)}`);
  return outcome.host;
}

/** PM (a): how many requests to another machine the host's test transport refused. */
async function refusedCount(host: EngineHost): Promise<number> {
  const answer = await host.call("transport", {}, 10_000);
  assert.ok(answer.ok, JSON.stringify(answer));
  const value = answer.value as { mode: string; refused: number };
  assert.equal(value.mode, "loopback-only");
  return value.refused;
}

/** PM (a): a real host's test ends with no refused request, unless the test makes one on purpose. */
async function closeChecked(host: EngineHost, refused = 0): Promise<void> {
  try {
    assert.equal(await refusedCount(host), refused, "requests to another machine the test transport refused");
  } finally {
    await host.close();
  }
}

/**
 * PM (1): an address no test may reach is never another machine. The "outside" address of these
 * tests is 127.0.0.2 on a port nobody listens on: in the loopback block (on Windows routed to the
 * loopback interface), so even without the transport nothing leaves this machine and the system
 * refuses the connection at once; the transport counts only 127.0.0.1, ::1 and localhost as this
 * machine, so it refuses it and counts it.
 */
async function closedLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address !== null ? address.port : 0));
    });
  });
}

/** A fake engine directory with app/index.js and i18n/index.js. */
async function fakeEngine(dir: string, doctorBody: string): Promise<string> {
  const engine = path.join(dir, "engine");
  await fs.mkdir(path.join(engine, "app"), { recursive: true });
  await fs.mkdir(path.join(engine, "i18n"), { recursive: true });
  await fs.writeFile(path.join(engine, "package.json"), '{"type":"module"}');
  await fs.writeFile(
    path.join(engine, "app", "index.js"),
    `export async function createNodeAppEnvironment() { return {}; }
export function createCodarynApp() { return { async doctor(request) { ${doctorBody} } }; }
`,
  );
  await fs.writeFile(
    path.join(engine, "i18n", "index.js"),
    `export function selectMessageLanguage(input) { return input.env === "ko" ? "ko" : "en"; }
export function createMessageCatalog(language) { return { format(id) { if (id === "needs.params") throw new Error("x"); return language + ":" + id; } }; }
`,
  );
  // The host also loads the text safety helpers. U-103: no workspace module any more (the tree is the app layer's).
  await fs.mkdir(path.join(engine, "cli"), { recursive: true });
  await fs.writeFile(
    path.join(engine, "cli", "text-safety.js"),
    `export function cleanText(text) { return text; }
export function hideKeys(text) { return text; }
`,
  );
  await fs.mkdir(path.join(engine, "contracts"), { recursive: true });
  await fs.writeFile(path.join(engine, "contracts", "index.js"), `export const API_PROVIDERS = { anthropic: { keyEnv: "ANTHROPIC_API_KEY" } };
`);
  await fs.mkdir(path.join(engine, "cli", "human"), { recursive: true });
  await fs.writeFile(
    path.join(engine, "cli", "human", "output.js"),
    `export function createHumanOutput() { return { progressLine() { return null; } }; }
`,
  );
  return engine;
}

async function fakeHost(dir: string, name: string, body: string): Promise<string> {
  const file = path.join(dir, `${name}.mjs`);
  await fs.writeFile(file, body);
  return file;
}

test("host process: the real host on this Node answers doctor with and without a workspace", { skip: !ENGINE_BUILT && "the engine is not built (npm run build in the root)" }, async () => {
  const { dir, cleanup } = await tempDir();
  const host = await started(options(dir));
  try {
    assert.ok(Number(host.nodeVersion.split(".")[0]) >= 26, host.nodeVersion);
    for (const workspace of [null, dir]) {
      const response = await host.call("doctor", { workspace }, 60_000);
      assert.ok(response.ok, JSON.stringify(response));
      const outcome = response.value as { ok: boolean; output: { kind: string; status: string; checks: { id: string; status: string; message: string }[] } };
      assert.equal(outcome.ok, true);
      assert.equal(outcome.output.kind, "doctor");
      assert.ok(["ok", "warn", "fail"].includes(outcome.output.status));
      assert.ok(outcome.output.checks.length >= 5);
      assert.ok(outcome.output.checks.every((check) => typeof check.id === "string" && typeof check.message === "string"));
      assert.ok(outcome.output.checks.some((check) => check.id === "workspace"));
    }
    const refused = await host.call("doctor", { workspace: "relative" }, 10_000);
    assert.equal(!refused.ok && refused.error.code, "invalid_args");
  } finally {
    await closeChecked(host);
    await cleanup();
  }
  assert.equal(host.exited, true, "close ends the host");
});

test("host process: messages come from the shared catalog in the language the CLI would choose", { skip: !ENGINE_BUILT && "the engine is not built" }, async () => {
  const { dir, cleanup } = await tempDir();
  const host = await started(options(dir, { env: testEnv(dir, { CODARYN_LANG: "ko" }) }));
  try {
    // Ids every catalog of this stage has; an unknown id is left out, not an error.
    const response = await host.call("messages", { osLocale: "en-US", ids: ["status.done", "status.failed", "no.such.message"] }, 10_000);
    assert.ok(response.ok, JSON.stringify(response));
    const value = response.value as { language: string; texts: Record<string, string> };
    assert.equal(value.language, "ko", "CODARYN_LANG wins over the OS locale");
    assert.deepEqual(Object.keys(value.texts).sort(), ["status.done", "status.failed"]);
    assert.match(value.texts["status.done"] ?? "", /[가-힣]/, "the Korean catalog answered");
    assert.ok(Object.values(value.texts).every((text) => text.length > 0));
  } finally {
    await closeChecked(host);
    await cleanup();
  }
});

test("host process (R21-I-3): with the test transport the real host's model list cannot reach any other machine", { skip: !ENGINE_BUILT && "the engine is not built" }, async () => {
  const { dir, cleanup } = await tempDir();
  try {
    // PM (1): 127.0.0.2 on a closed port (see closedLoopbackPort). The transport refuses the request
    // before it is sent and counts it; without the transport the system would refuse it.
    const port = await closedLoopbackPort();
    const config = path.join(dir, "config.json");
    await fs.writeFile(config, JSON.stringify({ schemaVersion: 1, model: "fake-model", apiBaseUrl: `https://127.0.0.2:${port}`, requestTimeoutMs: 20_000, maxRetries: 0 }));
    const secrets = (await import(pathToFileURL(path.join(GUI, "..", "dist", "tests", "fixtures", "secrets.js")).href)) as { FAKE_API_KEY: string };
    const contracts = (await import(pathToFileURL(path.join(ENGINE_DIR, "contracts", "index.js")).href)) as { ANTHROPIC_API_KEY_ENV: string };
    const env = { ...testEnv(dir), CODARYN_CONFIG: config, [contracts.ANTHROPIC_API_KEY_ENV]: secrets.FAKE_API_KEY };
    const host = await started(options(dir, { env }));
    try {
      const begin = Date.now();
      const answer = await host.call("listModels", { provider: "anthropic" }, 30_000);
      const took = Date.now() - begin;
      assert.equal(answer.ok, true, JSON.stringify(answer));
      assert.equal((answer as { value: { ok: boolean } }).value.ok, false, "the list failed");
      assert.ok(took < 5_000, `refused at once (${took} ms)`);
    } finally {
      // The one request of the list, refused by the transport (not by the system).
      await closeChecked(host, 1);
    }
  } finally {
    await cleanup();
  }
});

test("host process (R21-I-2): the value of every provider's key variable is hidden, not only Anthropic's", { skip: !ENGINE_BUILT && "the engine is not built" }, async () => {
  const { dir, cleanup } = await tempDir();
  try {
    // A fake value (no key shape), set in the second provider's key variable; a file is named after it.
    const value = "fake-second-provider-value-0001";
    const workspace = path.join(dir, "ws");
    await fs.mkdir(workspace);
    await fs.writeFile(path.join(workspace, `${value}.txt`), "x");
    const contracts = (await import(pathToFileURL(path.join(ENGINE_DIR, "contracts", "index.js")).href)) as { API_PROVIDERS: Record<string, { keyEnv: string }> };
    const keyEnvs = Object.values(contracts.API_PROVIDERS).map((spec) => spec.keyEnv);
    const other = keyEnvs.find((name) => name !== "ANTHROPIC_API_KEY");
    assert.ok(other !== undefined, "the contract names a second provider's key variable");
    // U-103: the tree is the app layer's list, which reads the settings: a config file that exists.
    const config = path.join(dir, "config.json");
    await fs.writeFile(config, JSON.stringify({ schemaVersion: 1 }));
    const host = await started(options(dir, { env: { ...testEnv(dir), CODARYN_CONFIG: config, [other]: value } }));
    try {
      const answer = await host.call("tree", { workspace: await fs.realpath(workspace), dir: "", offset: 0 }, 10_000);
      assert.equal(answer.ok, true, JSON.stringify(answer));
      // U-103 (U-89): a masked entry comes without its real name; the window gets `shown` only (3.3).
      const entries = (answer as { value: { entries?: { name: string | null; shown: string; masked: boolean }[] } }).value.entries ?? [];
      const entry = entries.find((item) => item.masked);
      assert.ok(entry !== undefined);
      assert.equal(entry.name, null);
      assert.equal(JSON.stringify(answer).includes(value), false, "the answer does not hold the value");
    } finally {
      await closeChecked(host);
    }
  } finally {
    await cleanup();
  }
});

test("host process (PM, R-21): the value of every key variable the contract knows (API_KEY_ENVS) is hidden in names and config texts", { skip: !ENGINE_BUILT && "the engine is not built" }, async () => {
  const contracts = (await import(pathToFileURL(path.join(ENGINE_DIR, "contracts", "index.js")).href)) as { API_KEY_ENVS: readonly string[] };
  assert.ok(contracts.API_KEY_ENVS.length >= 2, "the contract lists more than one key variable");
  assert.ok(contracts.API_KEY_ENVS.includes("OPENAI_API_KEY"));
  for (const [index, name] of contracts.API_KEY_ENVS.entries()) {
    const { dir, cleanup } = await tempDir();
    try {
      // A fake value without a key shape, so only the value rule can hide it.
      const value = `fake-known-key-value-${String(index).padStart(4, "0")}`;
      const workspace = path.join(dir, "ws");
      await fs.mkdir(workspace);
      await fs.writeFile(path.join(workspace, `${value}.txt`), "x");
      const config = path.join(dir, "config.json");
      await fs.writeFile(config, JSON.stringify({ schemaVersion: 1, model: `model-${value}` }));
      const host = await started(options(dir, { env: { ...testEnv(dir), CODARYN_CONFIG: config, [name]: value } }));
      try {
        const tree = await host.call("tree", { workspace: await fs.realpath(workspace), dir: "", offset: 0 }, 10_000);
        assert.equal(tree.ok, true, JSON.stringify(tree));
        // U-103: the app layer lists with the name masked (no real name), or refuses the config holding
        // the value (key_in_file); either way the value never comes back.
        const listing = (tree as { value: { ok: boolean; code?: string; entries?: { name: string | null; masked: boolean }[] } }).value;
        assert.ok(listing.ok ? listing.entries?.some((item) => item.masked && item.name === null) === true : listing.code === "key_in_file", `${name}: ${JSON.stringify(listing).slice(0, 200)}`);
        assert.equal(JSON.stringify(tree).includes(value), false, `${name}: the tree answer does not hold the value`);
        const settings = await host.call("settings", {}, 10_000);
        assert.equal(settings.ok, true, JSON.stringify(settings));
        const text = JSON.stringify((settings as { value: unknown }).value);
        // Either the app layer refuses a config holding the value (key_in_file), or the host shows the
        // config with the value hidden; the value never comes back.
        assert.ok(/key_in_file/.test(text) || text.includes("model-"), `${name}: ${text.slice(0, 200)}`);
        assert.equal(text.includes(value), false, `${name}: the answer does not hold the value`);
      } finally {
        await closeChecked(host);
      }
    } finally {
      await cleanup();
    }
  }
});

test("host process: engine output on stdout goes to stderr and cannot break the channel", async () => {
  const { dir, cleanup } = await tempDir();
  const engine = await fakeEngine(
    dir,
    `console.log("noise from console"); process.stdout.write("noise from stdout\\n"); console.info("{\\"v\\":1,\\"id\\":99,\\"ok\\":true}"); return { ok: true, output: request.workspace };`,
  );
  const host = await started(options(dir, { engineDir: engine }));
  try {
    const response = await host.call("doctor", { workspace: dir }, 10_000);
    assert.deepEqual(response, { v: 1, id: 1, ok: true, value: { ok: true, output: dir } });
    const texts = await host.call("messages", { osLocale: null, ids: ["a.b", "needs.params"] }, 10_000);
    assert.deepEqual(texts.ok && texts.value, { language: "en", texts: { "a.b": "en:a.b" } });
  } finally {
    await host.close();
    await cleanup();
  }
});

test("host process: a host that dies during a call fails that call and later calls", async () => {
  const { dir, cleanup } = await tempDir();
  const engine = await fakeEngine(dir, "process.exit(5);");
  const host = await started(options(dir, { engineDir: engine }));
  let exits = 0;
  host.onExit(() => (exits += 1));
  try {
    const response = await host.call("doctor", { workspace: null }, 10_000);
    assert.equal(!response.ok && response.error.code, "adapter_host_exited");
    const later = await host.call("doctor", { workspace: null }, 10_000);
    assert.equal(!later.ok && later.error.code, "adapter_host_exited");
    assert.equal(host.exited, true);
    assert.equal(exits, 1);
  } finally {
    await cleanup();
  }
});

test("host process: a host that writes something other than the protocol is stopped", async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const garbage = await fakeHost(dir, "garbage", 'process.stdout.write("hello\\n"); setInterval(() => {}, 1000);');
    assert.deepEqual(await startEngineHost(options(dir, { hostScript: garbage })), { ok: false, failure: "protocol_violation", nodeVersion: null });

    const wrongId = await fakeHost(
      dir,
      "wrong-id",
      `process.stdout.write(JSON.stringify({ v: 1, type: "ready", node: "26.0.0" }) + "\\n");
process.stdin.on("data", () => process.stdout.write(JSON.stringify({ v: 1, id: 777, ok: true, value: 1 }) + "\\n"));`,
    );
    const host = await started(options(dir, { hostScript: wrongId }));
    const response = await host.call("doctor", { workspace: null }, 10_000);
    assert.equal(!response.ok && response.error.code, "adapter_host_exited", "an answer to no request is a violation");
    await new Promise<void>((resolve) => host.onExit(resolve));
  } finally {
    await cleanup();
  }
});

test("host process: a host on Node older than 26, a host that is never ready, and a missing Node are refused", async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const old = await fakeHost(dir, "old", 'process.stdout.write(JSON.stringify({ v: 1, type: "ready", node: "24.22.2" }) + "\\n"); setInterval(() => {}, 1000);');
    assert.deepEqual(await startEngineHost(options(dir, { hostScript: old })), { ok: false, failure: "node_too_old", nodeVersion: "24.22.2" });

    const silent = await fakeHost(dir, "silent", "setInterval(() => {}, 1000);");
    assert.deepEqual(await startEngineHost(options(dir, { hostScript: silent, readyTimeoutMs: 300 })), {
      ok: false,
      failure: "ready_timeout",
      nodeVersion: null,
    });

    const missing = await startEngineHost(options(dir, { nodePath: path.join(dir, "no-node.exe") }));
    assert.equal(missing.ok, false);
    assert.equal(!missing.ok && missing.failure, "host_not_started");
  } finally {
    await cleanup();
  }
});

test("host process: the real host refuses to start without a valid engine directory", async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const outcome = await startEngineHost(options(dir, { engineDir: path.join(dir, "nothing-here") }));
    assert.deepEqual(outcome, { ok: false, failure: "host_exited", nodeVersion: null });
  } finally {
    await cleanup();
  }
});

test("host process: a host that does not end after stdin closes is killed by close", async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const stubborn = await fakeHost(
      dir,
      "stubborn",
      'process.stdout.write(JSON.stringify({ v: 1, type: "ready", node: "26.0.0" }) + "\\n"); process.stdin.resume(); setInterval(() => {}, 1000);',
    );
    const host = await started(options(dir, { hostScript: stubborn, closeTimeoutMs: 200 }));
    const begin = Date.now();
    await host.close();
    assert.equal(host.exited, true);
    assert.ok(Date.now() - begin < 5_000);
  } finally {
    await cleanup();
  }
});

test("host process (R-10 M-1): an answer that comes after its time limit is dropped and the host stays", async () => {
  const { dir, cleanup } = await tempDir();
  try {
    // Answers request 1 after 300 ms and request 2 after 400 ms, every later one at once.
    const slow = await fakeHost(
      dir,
      "slow",
      [
        'process.stdout.write(JSON.stringify({ v: 1, type: "ready", node: "26.0.0" }) + "\\n");',
        'let buffer = "";',
        'process.stdin.setEncoding("utf8");',
        'process.stdin.on("data", (chunk) => {',
        '  buffer += chunk;',
        '  let end;',
        '  while ((end = buffer.indexOf("\\n")) >= 0) {',
        '    const request = JSON.parse(buffer.slice(0, end));',
        '    buffer = buffer.slice(end + 1);',
        '    const delay = request.id === 1 ? 300 : request.id === 2 ? 400 : 0;',
        '    setTimeout(() => process.stdout.write(JSON.stringify({ v: 1, id: request.id, ok: true, value: request.id }) + "\\n"), delay);',
        '  }',
        '});',
      ].join("\n"),
    );
    const host = await started(options(dir, { hostScript: slow }));
    try {
      const first = host.call("doctor", { workspace: null }, 100);
      const second = host.call("doctor", { workspace: null }, 5_000);
      const timedOut = await first;
      assert.equal(!timedOut.ok && timedOut.error.code, "adapter_timeout");
      assert.deepEqual(await second, { v: 1, id: 2, ok: true, value: 2 }, "the other call still gets its answer");
      assert.deepEqual(await host.call("doctor", { workspace: null }, 5_000), { v: 1, id: 3, ok: true, value: 3 });
      assert.equal(host.exited, false, "the late answer did not end the host");
    } finally {
      await host.close();
    }
  } finally {
    await cleanup();
  }
});

test("host process (R10b-L-1): late answers to more than 1000 timed-out calls do not end the host", async () => {
  const { dir, cleanup } = await tempDir();
  try {
    // Answers requests 1 to 1001 after 400 ms, every later one at once.
    const slow = await fakeHost(
      dir,
      "slower",
      [
        'process.stdout.write(JSON.stringify({ v: 1, type: "ready", node: "26.0.0" }) + "\\n");',
        'let buffer = "";',
        'process.stdin.setEncoding("utf8");',
        'process.stdin.on("data", (chunk) => {',
        '  buffer += chunk;',
        '  let end;',
        '  while ((end = buffer.indexOf("\\n")) >= 0) {',
        '    const request = JSON.parse(buffer.slice(0, end));',
        '    buffer = buffer.slice(end + 1);',
        '    const delay = request.id <= 1001 ? 400 : 0;',
        '    setTimeout(() => process.stdout.write(JSON.stringify({ v: 1, id: request.id, ok: true, value: request.id }) + "\\n"), delay);',
        '  }',
        '});',
      ].join("\n"),
    );
    const host = await started(options(dir, { hostScript: slow }));
    try {
      const calls = Array.from({ length: 1001 }, () => host.call("doctor", { workspace: null }, 50));
      const replies = await Promise.all(calls);
      assert.ok(replies.every((reply) => !reply.ok && reply.error.code === "adapter_timeout"), "every call timed out");
      // Every late answer arrives (the last one 400 ms after its request), then one more call.
      await new Promise((resolve) => setTimeout(resolve, 900));
      assert.equal(host.exited, false, "the late answers did not end the host");
      assert.deepEqual(await host.call("doctor", { workspace: null }, 5_000), { v: 1, id: 1002, ok: true, value: 1002 });
    } finally {
      await host.close();
    }
  } finally {
    await cleanup();
  }
});

test("host process (R-10 L-2): a host whose stdin closes during a slow call ends without waiting for it", async () => {
  const { dir, cleanup } = await tempDir();
  const engine = await fakeEngine(dir, "await new Promise((resolve) => setTimeout(resolve, 6000)); return { ok: true, output: 'slow' };");
  const host = await started(options(dir, { engineDir: engine, closeTimeoutMs: 15_000 }));
  try {
    void host.call("doctor", { workspace: null }, 20_000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const begin = Date.now();
    await host.close();
    const took = Date.now() - begin;
    assert.equal(host.exited, true);
    assert.ok(took < 3_000, `the host ended ${took} ms after its stdin closed, not after the 6 s call`);
  } finally {
    await cleanup();
  }
});

test("host process (R21b-I-1): with the test transport a run with the OpenAI provider cannot reach any other machine either", { skip: !ENGINE_BUILT && "the engine is not built" }, async () => {
  const { dir, cleanup } = await tempDir();
  try {
    // Every provider gets the test transport's fetch through the app layer's providerDeps (F-2).
    // PM (1): 127.0.0.2 on a closed port (see closedLoopbackPort); the transport refuses the request
    // before it is sent and counts it.
    const port = await closedLoopbackPort();
    const workspace = path.join(dir, "ws");
    await fs.mkdir(workspace);
    const config = path.join(dir, "config.json");
    await fs.writeFile(
      config,
      JSON.stringify({
        schemaVersion: 1,
        provider: "openai",
        providers: { openai: { model: "fake-model", maxOutputTokens: 64, apiBaseUrl: `https://127.0.0.2:${port}/v1`, requestTimeoutMs: 20_000, maxRetries: 0 } },
        limits: { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 10_000, maxDurationMs: 60_000 },
      }),
    );
    const secrets = (await import(pathToFileURL(path.join(GUI, "..", "dist", "tests", "fixtures", "secrets.js")).href)) as { FAKE_OPENAI_KEY: string };
    const contracts = (await import(pathToFileURL(path.join(ENGINE_DIR, "contracts", "index.js")).href)) as { API_PROVIDERS: { openai: { keyEnv: string } } };
    const env = { ...testEnv(dir), CODARYN_CONFIG: config, [contracts.API_PROVIDERS.openai.keyEnv]: secrets.FAKE_OPENAI_KEY };
    const host = await started(options(dir, { env }));
    try {
      const done = new Promise<unknown>((resolve) =>
        host.onRunMessage((message) => {
          if (message.type === "done") resolve(message.outcome);
        }),
      );
      const begin = Date.now();
      const answer = await host.call("startRun", { workspace: await fs.realpath(workspace), goal: "Say hello.", profile: null, workflowRef: null, language: "en" }, 30_000);
      assert.equal(answer.ok, true, JSON.stringify(answer));
      assert.equal((answer as { value: { ok: boolean } }).value.ok, true, `the run started: ${JSON.stringify(answer)}`);
      const outcome = await Promise.race([done, new Promise((resolve) => setTimeout(() => resolve("timeout"), 40_000))]);
      const took = Date.now() - begin;
      assert.notEqual(outcome, "timeout", "the run ended");
      assert.ok(took < 8_000, `ended at once (${took} ms): ${JSON.stringify(outcome).slice(0, 300)}`);
      assert.match(JSON.stringify(outcome), /model_error/, "the run ended as a model error");
    } finally {
      // The run's one model request, refused by the transport (not by the system).
      await closeChecked(host, 1);
    }
  } finally {
    await cleanup();
  }
});
