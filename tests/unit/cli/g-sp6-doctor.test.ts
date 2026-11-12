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
import { runDoctor } from "../../../src/cli/doctor.js";
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
