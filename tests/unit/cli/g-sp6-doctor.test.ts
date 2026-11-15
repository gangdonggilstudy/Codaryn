/**
 * SP-6, review R-19 I-4 with DR-34 (a): each provider reads only its own model and address
 * variables. When the other provider's variable is set, doctor says that the chosen provider's run
 * does not read it (a model id or address left for one provider is not silently ignored), and the
 * api_key check says where the chosen provider's key goes. Fake values; nothing is sent.
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
  OPENAI_API_KEY_ENV,
} from "../../../src/contracts/index.js";
import type { DoctorOutput } from "../../../src/contracts/index.js";
import { renderDoctor, runDoctor } from "../../../src/cli/doctor.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const KEYS = {
  [ANTHROPIC_API_KEY_ENV]: ["fake", "sp6d", "anthropic", "value", "0001"].join("-"),
  [OPENAI_API_KEY_ENV]: ["fake", "sp6d", "openai", "value", "0001"].join("-"),
};
const LIMITS = { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 1000, maxDurationMs: 60_000 };

async function checks(configValue: Record<string, unknown>, env: Record<string, string>): Promise<Record<string, { status: string; message: string }>> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-sp6-doctor-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  const configPath = path.join(base, "config.json");
  await writeFile(configPath, JSON.stringify({ schemaVersion: 1, limits: LIMITS, ...configValue }), "utf8");
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
  return Object.fromEntries((JSON.parse(outcome.text) as DoctorOutput).checks.map((check) => [check.id, { status: check.status, message: check.message }]));
}

describe("SP-6 (R-19 I-4): doctor names the other provider's variables the run does not read", () => {
  test("openai chosen, CODARYN_MODEL and CODARYN_API_BASE_URL set: both named as anthropic's", async () => {
    const found = await checks(
      { provider: "openai", providers: { openai: { model: "gpt-x", maxOutputTokens: 64 } } },
      { ...KEYS, [CODARYN_MODEL_ENV]: "claude-x", [CODARYN_API_BASE_URL_ENV]: "https://anthropic-gateway.example" },
    );
    const model = found["model"];
    assert.equal(model?.status, "ok");
    for (const name of [CODARYN_MODEL_ENV, CODARYN_API_BASE_URL_ENV]) {
      assert.ok(model?.message.includes(`${name} is set but is anthropic's`), model?.message);
    }
    assert.ok(model?.message.includes("an openai run does not read"), model?.message);
  });

  test("anthropic chosen, CODARYN_OPENAI_MODEL set: named as openai's; nothing else changes", async () => {
    const found = await checks({ model: "claude-x", maxOutputTokens: 100 }, { ...KEYS, [CODARYN_OPENAI_MODEL_ENV]: "gpt-x" });
    assert.ok(found["model"]?.message.includes(`${CODARYN_OPENAI_MODEL_ENV} is set but is openai's`), found["model"]?.message ?? "");
    const plain = await checks({ model: "claude-x", maxOutputTokens: 100 }, KEYS);
    assert.equal(plain["model"]?.message.includes(" is set but is "), false, plain["model"]?.message ?? "");
  });

  test("a missing openai model names its own variable, and the anthropic one as not read", async () => {
    const found = await checks({ provider: "openai", providers: { openai: { maxOutputTokens: 64 } } }, { ...KEYS, [CODARYN_MODEL_ENV]: "claude-x" });
    const model = found["model"];
    assert.equal(model?.status, "fail");
    assert.ok(model?.message.includes(CODARYN_OPENAI_MODEL_ENV) && model.message.includes(`${CODARYN_MODEL_ENV} is set but is anthropic's`), model?.message);
  });

  test("the api_key check names where the openai key goes when its address variable is set", async () => {
    const found = await checks(
      { provider: "openai", providers: { openai: { model: "gpt-x", maxOutputTokens: 64 } } },
      { ...KEYS, [CODARYN_OPENAI_API_BASE_URL_ENV]: "https://openai-gateway.example/v1" },
    );
    assert.ok(found["api_key"]?.message.includes(`https://openai-gateway.example (${CODARYN_OPENAI_API_BASE_URL_ENV})`), found["api_key"]?.message ?? "");
  });
});

describe("DR-36 (b): doctor's key destination and the other provider's variables as catalog texts", () => {
  async function doctorJson(configValue: Record<string, unknown>, env: Record<string, string>): Promise<DoctorOutput> {
    const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-dr36b-"));
    temporaryDirs.push(base);
    const ws = path.join(base, "ws");
    await mkdir(ws);
    const configPath = path.join(base, "config.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: 1, limits: LIMITS, ...configValue }), "utf8");
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
    return JSON.parse(outcome.text) as DoctorOutput;
  }
  const check = (output: DoctorOutput, id: string) => output.checks.find((entry) => entry.id === id);
  const OPENAI_CONFIG = { provider: "openai", providers: { openai: { model: "gpt-x", maxOutputTokens: 64 } } };

  test("the api_key text names where the key goes: the default, a variable, a config field, or a bad address", async () => {
    const plain = await doctorJson({ model: "claude-x", maxOutputTokens: 100 }, KEYS);
    assert.deepEqual(check(plain, "api_key")?.text, {
      id: "doctor.api_key.sends_to_default",
      params: { keyEnv: ANTHROPIC_API_KEY_ENV, provider: "anthropic", origin: "https://api.anthropic.com" },
    });
    const fromEnv = await doctorJson(OPENAI_CONFIG, { ...KEYS, [CODARYN_OPENAI_API_BASE_URL_ENV]: "https://openai-gateway.example:8443/v1" });
    assert.deepEqual(check(fromEnv, "api_key")?.text, {
      id: "doctor.api_key.sends_to_env",
      params: { keyEnv: OPENAI_API_KEY_ENV, provider: "openai", origin: "https://openai-gateway.example:8443", variable: CODARYN_OPENAI_API_BASE_URL_ENV },
    });
    const fromConfig = await doctorJson({ provider: "openai", providers: { openai: { model: "gpt-x", maxOutputTokens: 64, apiBaseUrl: "https://proxy.example/v1" } } }, KEYS);
    assert.deepEqual(check(fromConfig, "api_key")?.text, {
      id: "doctor.api_key.sends_to_config",
      params: { keyEnv: OPENAI_API_KEY_ENV, provider: "openai", origin: "https://proxy.example", field: "providers.openai.apiBaseUrl" },
    });
    const bad = await doctorJson(OPENAI_CONFIG, { ...KEYS, [CODARYN_OPENAI_API_BASE_URL_ENV]: "https://openai-gateway.example/v1/responses" });
    assert.deepEqual(check(bad, "api_key")?.text, { id: "doctor.api_key.address_invalid", params: { keyEnv: OPENAI_API_KEY_ENV, variable: CODARYN_OPENAI_API_BASE_URL_ENV } });
  });

  test("the model check carries one note per variable of the other provider that is set", async () => {
    const output = await doctorJson(OPENAI_CONFIG, { ...KEYS, [CODARYN_MODEL_ENV]: "claude-x", [CODARYN_API_BASE_URL_ENV]: "https://anthropic-gateway.example" });
    assert.deepEqual(check(output, "model")?.notes, [
      { id: "doctor.model.other_provider_variable", params: { variable: CODARYN_MODEL_ENV, owner: "anthropic", provider: "openai" } },
      { id: "doctor.model.other_provider_variable", params: { variable: CODARYN_API_BASE_URL_ENV, owner: "anthropic", provider: "openai" } },
    ]);
    const none = await doctorJson({ model: "claude-x", maxOutputTokens: 100 }, KEYS);
    assert.equal(check(none, "model")?.notes, undefined);
  });

  test("the human text prints each note on its own line under the check", async () => {
    const output = await doctorJson(OPENAI_CONFIG, { ...KEYS, [CODARYN_MODEL_ENV]: "claude-x" });
    const catalog = { language: "en", format: (id: string, params?: Record<string, unknown>) => `<${id}${params === undefined ? "" : ` ${JSON.stringify(params)}`}>` };
    const text = renderDoctor(output, catalog as never);
    const lines = text.split("\n");
    const modelAt = lines.findIndex((line) => line.includes("<doctor.model.ok"));
    assert.ok(modelAt >= 0, text);
    assert.ok(lines[modelAt + 1]?.trimStart().startsWith("<doctor.model.other_provider_variable"), text);
    assert.ok(lines[modelAt + 1]?.startsWith(" "), "indented under the check");
  });
});
