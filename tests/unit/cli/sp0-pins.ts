/**
 * SP-0 (docs/design/second-provider.md 7, P-7 and P-8, CLI part): the outputs the provider work
 * must leave byte for byte as they are, collected from one place so the pin test and a re-capture
 * produce them the same way. Volatile parts (the temporary directory, run ids, durations, the
 * fake server's port) are replaced by fixed marks.
 */

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import type { CodarynConfig, ModelInfo } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { renderDoctor, runDoctor } from "../../../src/cli/doctor.js";
import { runInit } from "../../../src/cli/init.js";
import { runModels } from "../../../src/cli/models.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { resolveAnthropicSettings, resolveConnection, resolveListSettings } from "../../../src/cli/settings.js";
import { createHumanOutput } from "../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { replyText, startFakeAnthropic } from "../../support/fake-anthropic.js";

/** Key-shaped only by name; built at run time so no file holds a key-like literal. */
export const PIN_KEY = ["fake", "sp0", "pin", "key", "value", "0001"].join("-");

// ---------------------------------------------------------------------------------------------
// P-7: settings resolution

type Env = Readonly<Record<string, string | undefined>>;
const KEY = { ANTHROPIC_API_KEY: PIN_KEY };

/** The cases: task model, environment, config. Each covers one precedence of model, address or output cap. */
export const P7_CASES: readonly { readonly name: string; readonly model: { provider: "anthropic"; model?: string; maxOutputTokens?: number }; readonly env: Env; readonly config: CodarynConfig | null }[] = [
  { name: "task model and cap, defaults", model: { provider: "anthropic", model: "claude-task", maxOutputTokens: 100 }, env: KEY, config: null },
  { name: "env model over config model", model: { provider: "anthropic" }, env: { ...KEY, CODARYN_MODEL: "claude-env" }, config: { schemaVersion: 1, model: "claude-config", maxOutputTokens: 200 } },
  { name: "task model over env model", model: { provider: "anthropic", model: "claude-task" }, env: { ...KEY, CODARYN_MODEL: "claude-env" }, config: { schemaVersion: 1, maxOutputTokens: 200 } },
  { name: "config model, task cap over config cap", model: { provider: "anthropic", maxOutputTokens: 50 }, env: KEY, config: { schemaVersion: 1, model: "claude-config", maxOutputTokens: 200 } },
  { name: "placeholder model in config", model: { provider: "anthropic" }, env: KEY, config: { schemaVersion: 1, model: "<model id>", maxOutputTokens: 200 } },
  { name: "no key, no model, no cap", model: { provider: "anthropic" }, env: {}, config: null },
  { name: "env address over config address", model: { provider: "anthropic", model: "m", maxOutputTokens: 1 }, env: { ...KEY, CODARYN_API_BASE_URL: "https://env.example/api/" }, config: { schemaVersion: 1, apiBaseUrl: "https://config.example" } },
  { name: "config address, timeout and retries", model: { provider: "anthropic", model: "m", maxOutputTokens: 1 }, env: KEY, config: { schemaVersion: 1, apiBaseUrl: "https://config.example", requestTimeoutMs: 1234, maxRetries: 0 } },
  { name: "env address ending in /v1 refused", model: { provider: "anthropic", model: "m", maxOutputTokens: 1 }, env: { ...KEY, CODARYN_API_BASE_URL: "https://env.example/v1" }, config: null },
  { name: "env address over http refused", model: { provider: "anthropic", model: "m", maxOutputTokens: 1 }, env: { ...KEY, CODARYN_API_BASE_URL: "http://env.example" }, config: null },
  { name: "loopback http address", model: { provider: "anthropic", model: "m", maxOutputTokens: 1 }, env: { ...KEY, CODARYN_API_BASE_URL: "http://127.0.0.1:9" }, config: null },
];

/** Each case through the three resolvers, the key value replaced by a mark. */
export function p7Outcomes(): Record<string, unknown> {
  const hide = (value: unknown): unknown => JSON.parse(JSON.stringify(value).split(PIN_KEY).join("<key>"));
  const out: Record<string, unknown> = {};
  for (const item of P7_CASES) {
    const key = item.env["ANTHROPIC_API_KEY"] ?? null;
    out[item.name] = hide({
      run: resolveAnthropicSettings(item.model, item.env, item.config),
      list: resolveListSettings(item.env, item.config),
      connection: key === null ? null : resolveConnection(key, item.env, item.config),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// P-8: CLI outputs with an Anthropic config

/** Replaces what changes between runs. */
export function normalize(text: string, base: string, extra: readonly (readonly [RegExp, string])[] = []): string {
  let out = text.split(base).join("<base>").split(base.replace(/\\/g, "\\\\")).join("<base>").split(PIN_KEY).join("<key>");
  out = out.replace(/\d{8}T\d{6}Z-[0-9a-f]{8}/g, "<runId>");
  for (const [pattern, mark] of extra) out = out.replace(pattern, mark);
  return out;
}

const CONFIG: CodarynConfig = {
  schemaVersion: 1,
  model: "claude-pin-model",
  maxOutputTokens: 512,
  limits: { maxModelTurns: 3, maxToolCalls: 3, maxTotalTokens: 10_000, maxDurationMs: 60_000 },
};

const MODELS: readonly ModelInfo[] = [
  { id: "claude-pin-model", displayName: "Pin Model", createdAt: "2026-01-01T00:00:00Z", maxInputTokens: 200_000, maxOutputTokens: 64_000 },
  { id: "claude-other", displayName: "claude-other", createdAt: null, maxInputTokens: null, maxOutputTokens: null },
];

async function base(name: string): Promise<{ base: string; ws: string; config: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), `codaryn-sp0-${name}-`));
  const ws = path.join(dir, "ws");
  await mkdir(ws);
  const config = path.join(dir, "config.json");
  await writeFile(config, `${JSON.stringify(CONFIG, null, 2)}\n`, "utf8");
  return { base: dir, ws, config, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const fsIo = {
  readFile: (file: string) => readFile(file, "utf8"),
  isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
  isFile: async (file: string) => (await stat(file).catch(() => null))?.isFile() ?? false,
  locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
  relatePaths: (target: string, root: string) => relateRealPaths(target, root),
};

/** doctor, models and init with an Anthropic config; run against the fake server. */
export async function p8Outputs(t: TestContext): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const messages = createMessageCatalog("en");

  {
    const b = await base("doctor");
    const env = { ANTHROPIC_API_KEY: PIN_KEY };
    const outcome = await runDoctor({ argv: ["doctor", "--config", b.config, "--workspace", b.ws, "--json"], env, cwd: b.base, nodeVersion: "26.0.0", ...fsIo, inspectLock: async () => "none" });
    const json = "text" in outcome ? outcome.text : JSON.stringify(outcome);
    out["doctor --json"] = normalize(json, b.base);
    out["doctor text"] = normalize(renderDoctor(JSON.parse(json), messages), b.base);
    await b.cleanup();
  }

  {
    const b = await base("models");
    const env = { ANTHROPIC_API_KEY: PIN_KEY };
    const listModels = async () => ({ ok: true as const, models: MODELS });
    for (const json of [true, false]) {
      const outcome = await runModels({ argv: ["models", "--config", b.config, ...(json ? ["--json"] : [])], env, cwd: b.base, readFile: fsIo.readFile, loadEnvFile: () => {}, listModels: listModels as never });
      out[`models${json ? " --json" : " text"}`] = normalize("text" in outcome ? outcome.text : JSON.stringify(outcome), b.base);
    }
    await b.cleanup();
  }

  {
    const b = await base("init");
    const target = path.join(b.base, "new-config.json");
    const outcome = await runInit({
      argv: ["init", "--config", target, "--json"],
      env: { ANTHROPIC_API_KEY: PIN_KEY },
      cwd: b.base,
      defaultConfig: null,
      messages,
      readFile: fsIo.readFile,
      isDirectory: fsIo.isDirectory,
      exists: async (file: string) => (await stat(file).catch(() => null)) !== null,
      locateInWorkspace: fsIo.locateInWorkspace,
      makeDirectory: async (dir: string) => {
        await mkdir(dir, { recursive: true });
      },
      writeNewFile: (file: string, text: string) => writeFile(file, text, { encoding: "utf8", flag: "wx" }),
    } as never);
    out["init --json"] = normalize("text" in outcome ? outcome.text : JSON.stringify("output" in outcome ? outcome.output : outcome), b.base);
    out["init file"] = normalize(await readFile(target, "utf8"), b.base);
    await b.cleanup();
  }

  {
    const b = await base("run");
    const api = await startFakeAnthropic(t, [replyText("done")]);
    const env = { ANTHROPIC_API_KEY: PIN_KEY, CODARYN_API_BASE_URL: api.url };
    const lines: string[] = [];
    const human = () => ({ output: createHumanOutput(messages), messages });
    const outcome = await runCli({
      argv: ["run", "--workspace", b.ws, "--goal", "say done", "--config", b.config],
      env,
      cwd: b.base,
      ...fsIo,
      loadEnvFile: () => {},
      clock: { now: () => Date.now() },
      randomBytes: (size: number) => new Uint8Array(size).fill(5),
      assemble: assembleRun,
      cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
      writeProgress: (line: string) => lines.push(line),
      human,
    } as never);
    const port = new URL(api.url).port;
    const extra = [
      [/"durationMs":\d+/g, '"durationMs":<ms>'],
      [new RegExp(`127\\.0\\.0\\.1:${port}`, "g"), "127.0.0.1:<port>"],
    ] as const;
    out["run --json"] = normalize(JSON.stringify(outcome.output), b.base, extra);
    out["run request"] = normalize(JSON.stringify(api.requests.map((request) => ({ method: request.method, path: request.path, body: request.bodyText }))), b.base, extra);
    await b.cleanup();
  }
  return out;
}
