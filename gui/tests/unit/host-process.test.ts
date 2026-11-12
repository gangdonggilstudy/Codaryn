/**
 * GU-1: the engine host as a separate Node process (DR-26) and the main process's client
 * (src/main/engine-client.ts), over stdin and stdout only. Runs under the test's own Node (26+),
 * without Electron: the real host script with the real engine (the root build, dist/src), with
 * fake engines, and fake hosts that break the channel.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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
    if (/^(ANTHROPIC_API_KEY|CODARYN_CONFIG|CODARYN_LANG|CODARYN_MODEL)$/i.test(name)) delete env[name];
  }
  return { ...env, CODARYN_CONFIG: path.join(dir, "no-config.json"), ...extra };
}

async function tempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gui-host-"));
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

function options(dir: string, overrides: Partial<EngineHostOptions> = {}): EngineHostOptions {
  return { nodePath: process.execPath, hostScript: HOST_SCRIPT, engineDir: ENGINE_DIR, env: testEnv(dir), cwd: dir, ...overrides };
}

async function started(opts: EngineHostOptions): Promise<EngineHost> {
  const outcome = await startEngineHost(opts);
  assert.ok(outcome.ok, `the host started: ${JSON.stringify(outcome)}`);
  return outcome.host;
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
  // GU-2: the host also loads the workspace rules and the text safety helpers for the file tree.
  await fs.mkdir(path.join(engine, "workspace"), { recursive: true });
  await fs.mkdir(path.join(engine, "cli"), { recursive: true });
  await fs.writeFile(
    path.join(engine, "workspace", "index.js"),
    `export async function createWorkspace(options) { return { root: options.root, async resolve() { return { ok: false, code: "invalid_path" }; } }; }
`,
  );
  await fs.writeFile(
    path.join(engine, "cli", "text-safety.js"),
    `export function cleanText(text) { return text; }
export function hideKeys(text) { return text; }
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
    await host.close();
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
    await host.close();
    await cleanup();
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
