/**
 * DR-34 (a) (review R-20 M-1): a key goes only to its own provider's address.
 * - CODARYN_MODEL and CODARYN_API_BASE_URL are anthropic's, as before SP-4; OpenAI has
 *   CODARYN_OPENAI_MODEL and CODARYN_OPENAI_API_BASE_URL.
 * - `codaryn models` lists anthropic models only; when the config chooses another provider it
 *   refuses before any request (R-20 D2: the Anthropic key went to the address set for OpenAI).
 * - doctor says which provider's key goes to which address.
 * Fake values built at run time; requests go to a counting stand-in for fetch; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  ANTHROPIC_API_KEY_ENV,
  CODARYN_API_BASE_URL_ENV,
  CODARYN_MODEL_ENV,
  CODARYN_OPENAI_API_BASE_URL_ENV,
  CODARYN_OPENAI_MODEL_ENV,
  DEFAULT_ANTHROPIC_API_BASE_URL,
  DEFAULT_OPENAI_API_BASE_URL,
  OPENAI_API_KEY_ENV,
} from "../../../src/contracts/index.js";
import type { CodarynConfig, DoctorOutput } from "../../../src/contracts/index.js";
import { parseConfig } from "../../../src/cli/config.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import { runModels } from "../../../src/cli/models.js";
import { anthropicModelLister } from "../../../src/cli/provider.js";
import { ENV_FILE_NON_SECRETS, locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { resolveApiSettings, resolveListSettings } from "../../../src/cli/settings.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const OPENAI_MODEL_ENV = CODARYN_OPENAI_MODEL_ENV;
const OPENAI_BASE_URL_ENV = CODARYN_OPENAI_API_BASE_URL_ENV;
const ANTHROPIC_VALUE = ["fake", "dr34", "anthropic", "value", "0001"].join("-");
const OPENAI_VALUE = ["fake", "dr34", "openai", "value", "0001"].join("-");
const KEYS = { [ANTHROPIC_API_KEY_ENV]: ANTHROPIC_VALUE, [OPENAI_API_KEY_ENV]: OPENAI_VALUE };
const LIMITS = { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 1000, maxDurationMs: 60_000 };

function config(value: Record<string, unknown>): CodarynConfig {
  const parsed = parseConfig({ schemaVersion: 1, ...value });
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.message);
  return parsed.config;
}

describe("DR-34 (a): model and address variables per provider", () => {
  const both = config({ model: "claude-file", maxOutputTokens: 100, providers: { openai: { model: "gpt-file", maxOutputTokens: 64 } } });

  test("openai reads CODARYN_OPENAI_MODEL and CODARYN_OPENAI_API_BASE_URL, never anthropic's variables", () => {
    const anthropicOnly = { ...KEYS, [CODARYN_MODEL_ENV]: "claude-env", [CODARYN_API_BASE_URL_ENV]: "https://anthropic-gateway.example" };
    const plain = resolveApiSettings({ provider: "openai" }, anthropicOnly, both);
    assert.ok(plain.ok, plain.ok ? "" : plain.message);
    assert.deepEqual([plain.settings.model, plain.settings.apiBaseUrl], ["gpt-file", DEFAULT_OPENAI_API_BASE_URL]);
    const own = resolveApiSettings({ provider: "openai" }, { ...anthropicOnly, [OPENAI_MODEL_ENV]: "gpt-env", [OPENAI_BASE_URL_ENV]: "https://openai-gateway.example/v1" }, both);
    assert.ok(own.ok, own.ok ? "" : own.message);
    assert.deepEqual([own.settings.model, own.settings.apiBaseUrl], ["gpt-env", "https://openai-gateway.example/v1"]);
  });

  test("anthropic reads CODARYN_MODEL and CODARYN_API_BASE_URL as before, never OpenAI's variables", () => {
    const openaiOnly = { ...KEYS, [OPENAI_MODEL_ENV]: "gpt-env", [OPENAI_BASE_URL_ENV]: "https://openai-gateway.example/v1" };
    const plain = resolveApiSettings({ provider: "anthropic" }, openaiOnly, both);
    assert.ok(plain.ok, plain.ok ? "" : plain.message);
    assert.deepEqual([plain.settings.model, plain.settings.apiBaseUrl], ["claude-file", DEFAULT_ANTHROPIC_API_BASE_URL]);
    const own = resolveApiSettings({ provider: "anthropic" }, { ...openaiOnly, [CODARYN_MODEL_ENV]: "claude-env", [CODARYN_API_BASE_URL_ENV]: "https://anthropic-gateway.example" }, both);
    assert.ok(own.ok);
    assert.deepEqual([own.settings.model, own.settings.apiBaseUrl], ["claude-env", "https://anthropic-gateway.example"]);
    // The listing settings too.
    const listed = resolveListSettings(openaiOnly, both);
    assert.ok(listed.ok);
    assert.equal(listed.settings.apiBaseUrl, DEFAULT_ANTHROPIC_API_BASE_URL);
  });

  test("a missing openai model names CODARYN_OPENAI_MODEL", () => {
    const resolved = resolveApiSettings({ provider: "openai", maxOutputTokens: 64 }, { ...KEYS, [CODARYN_MODEL_ENV]: "claude-env" }, null);
    assert.ok(!resolved.ok && resolved.code === "provider_not_configured");
    assert.ok(resolved.message.includes(OPENAI_MODEL_ENV) && !resolved.message.includes(`${CODARYN_MODEL_ENV} `), resolved.message);
  });

  test("the OpenAI variables in a vars file are settings, not secrets", () => {
    for (const name of [OPENAI_MODEL_ENV, OPENAI_BASE_URL_ENV]) assert.ok(ENV_FILE_NON_SECRETS.includes(name), name);
  });
});

async function workspace(configValue: Record<string, unknown>): Promise<{ base: string; ws: string; configPath: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-dr34-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  const configPath = path.join(base, "config.json");
  await writeFile(configPath, JSON.stringify({ schemaVersion: 1, ...configValue }), "utf8");
  return { base, ws, configPath };
}

describe("DR-34 (a): models lists anthropic only, and refuses before any request otherwise", () => {
  async function models(configValue: Record<string, unknown>, env: Record<string, string>): Promise<{ code: string | null; requests: { url: string; anthropicKey: boolean }[] }> {
    const { base, configPath } = await workspace(configValue);
    const requests: { url: string; anthropicKey: boolean }[] = [];
    const counting: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({ url: String(input), anthropicKey: headers.get("x-api-key") === ANTHROPIC_VALUE });
      return new Response(JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const outcome = await runModels({
      argv: ["models", "--config", configPath, "--json"],
      env,
      cwd: base,
      readFile: (file) => readFile(file, "utf8"),
      loadEnvFile: () => {},
      // The real lister, so a request would really be made (to the counting fetch).
      listModels: anthropicModelLister,
      anthropicDeps: { fetch: counting },
    });
    const parsed = JSON.parse("text" in outcome ? outcome.text : JSON.stringify(outcome.output)) as { kind: string; code?: string };
    return { code: parsed.kind === "error" ? (parsed.code ?? null) : null, requests };
  }

  test("R-20 D2: config provider openai and CODARYN_API_BASE_URL set: no request at all", async () => {
    const { code, requests } = await models({ provider: "openai" }, { ...KEYS, [CODARYN_API_BASE_URL_ENV]: "http://127.0.0.1:9" });
    assert.deepEqual(requests, []);
    assert.equal(code, "provider_not_implemented");
  });

  test("an anthropic config still lists, at anthropic's own address", async () => {
    const { code, requests } = await models({}, { ...KEYS, [OPENAI_BASE_URL_ENV]: "http://127.0.0.1:9/v1" });
    assert.equal(code, null);
    assert.equal(requests.length, 1);
    assert.ok(requests[0]?.url.startsWith(`${DEFAULT_ANTHROPIC_API_BASE_URL}/v1/models`), requests[0]?.url ?? "");
    assert.equal(requests[0]?.anthropicKey, true);
  });
});

describe("DR-34 (a): doctor says where the key goes", () => {
  async function apiKeyMessage(configValue: Record<string, unknown>, env: Record<string, string>): Promise<{ status: string; message: string }> {
    const { base, ws, configPath } = await workspace({ limits: LIMITS, ...configValue });
    const outcome = await runDoctor({
      argv: ["doctor", "--config", configPath, "--workspace", ws, "--json"],
      env,
      cwd: base,
      nodeVersion: "26.13.0",
      readFile: (file) => readFile(file, "utf8"),
      isDirectory: async (dir) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
      isFile: async (file) => (await stat(file).catch(() => null))?.isFile() ?? false,
      locateInWorkspace: (file, root) => locateInWorkspace(file, root),
      relatePaths: (target, root) => relateRealPaths(target, root),
    });
    assert.ok("text" in outcome);
    const check = (JSON.parse(outcome.text) as DoctorOutput).checks.find((entry) => entry.id === "api_key");
    assert.ok(check !== undefined);
    return { status: check.status, message: check.message };
  }

  test("anthropic: its key, its address and where the address comes from", async () => {
    const plain = await apiKeyMessage({}, KEYS);
    assert.equal(plain.status, "ok");
    assert.ok(plain.message.includes(ANTHROPIC_API_KEY_ENV) && plain.message.includes(DEFAULT_ANTHROPIC_API_BASE_URL), plain.message);
    const fromEnv = await apiKeyMessage({}, { ...KEYS, [CODARYN_API_BASE_URL_ENV]: "https://anthropic-gateway.example/path" });
    assert.ok(fromEnv.message.includes("https://anthropic-gateway.example") && fromEnv.message.includes(CODARYN_API_BASE_URL_ENV), fromEnv.message);
    // Only the origin: a path may hold more than an address.
    assert.equal(fromEnv.message.includes("/path"), false, fromEnv.message);
  });

  test("openai: the OpenAI key and OpenAI's address, not the one set for anthropic", async () => {
    const shown = await apiKeyMessage({ provider: "openai" }, { ...KEYS, [CODARYN_API_BASE_URL_ENV]: "https://anthropic-gateway.example" });
    assert.equal(shown.status, "ok");
    assert.ok(shown.message.includes(OPENAI_API_KEY_ENV) && shown.message.includes("https://api.openai.com"), shown.message);
    assert.equal(shown.message.includes("anthropic-gateway"), false, shown.message);
  });
});
