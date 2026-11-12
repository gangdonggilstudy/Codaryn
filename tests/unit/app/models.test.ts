/**
 * The GUI's model list and choice through the app layer (Y-1 to Y-4, DR-22). The listing function
 * is a fake standing for listAnthropicModels: nothing leaves the process. Fake values only; the key
 * value is not key-shaped.
 */

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV } from "../../../src/contracts/index.js";
import type { AnthropicListSettings, ListAnthropicModels, ModelInfo, ModelsOutput } from "../../../src/contracts/index.js";
import { createCodarynApp, modelsArguments } from "../../../src/app/index.js";
import type { AppCallOutcome } from "../../../src/app/index.js";
import { appEnvironment, tempDir } from "./support.js";

const FAKE_KEY = "fake-models-key-value-0091";
const MODELS: ModelInfo[] = [
  { id: "fake-model-a", displayName: "Fake A", createdAt: null, maxInputTokens: 1000, maxOutputTokens: 100 },
  { id: "fake-model-b", displayName: "Fake B", createdAt: null, maxInputTokens: 2000, maxOutputTokens: 200 },
];

function fakeLister(outcome: Awaited<ReturnType<ListAnthropicModels>> = { ok: true, models: MODELS }): { list: ListAnthropicModels; calls: AnthropicListSettings[] } {
  const calls: AnthropicListSettings[] = [];
  return {
    calls,
    list: async (settings) => {
      calls.push(settings);
      return outcome;
    },
  };
}

function ok(outcome: AppCallOutcome<ModelsOutput>): ModelsOutput {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: ModelsOutput }).output;
}

async function setup(model = "fake-model-a"): Promise<{ base: string; config: string }> {
  const base = await tempDir("codaryn-unit-app-models-");
  const config = path.join(base, "config.json");
  await writeFile(config, `${JSON.stringify({ schemaVersion: 1, model }, null, 2)}\n`, "utf8");
  return { base, config };
}

describe("listModels and selectModel (Y-1 to Y-3)", () => {
  test("lists with the key from the environment, marks the current model, writes nothing", async () => {
    const { base, config } = await setup();
    const lister = fakeLister();
    const app = createCodarynApp(await appEnvironment(base, { env: { [ANTHROPIC_API_KEY_ENV]: FAKE_KEY } }), { listModels: lister.list });
    const before = await readFile(config, "utf8");
    const output = ok(await app.listModels({ provider: "anthropic", configPath: config, varsFile: null }));
    assert.deepEqual([output.kind, output.status, output.exitCode], ["models", "listed", 0]);
    assert.deepEqual(output.models.map((model) => [model.number, model.id]), [[1, "fake-model-a"], [2, "fake-model-b"]]);
    assert.deepEqual(output.current, { id: "fake-model-a", source: "config", listed: true });
    assert.equal(output.selected, null);
    assert.equal(lister.calls.length, 1);
    assert.equal(await readFile(config, "utf8"), before);
    assert.equal(JSON.stringify(output).includes(FAKE_KEY), false);
  });

  test("selecting writes only the config file's model, atomically, when the list holds the id", async () => {
    const { base, config } = await setup();
    const app = createCodarynApp(await appEnvironment(base, { env: { [ANTHROPIC_API_KEY_ENV]: FAKE_KEY } }), { listModels: fakeLister().list });
    const output = ok(await app.selectModel({ provider: "anthropic", configPath: config, varsFile: null, model: "fake-model-b" }));
    assert.deepEqual([output.status, output.selected], ["selected", { id: "fake-model-b", created: false, overriddenBy: null }]);
    assert.deepEqual(JSON.parse(await readFile(config, "utf8")), { schemaVersion: 1, model: "fake-model-b" });

    const unknown = await app.selectModel({ provider: "anthropic", configPath: config, varsFile: null, model: "fake-model-z" });
    assert.equal(unknown.ok ? null : unknown.error.code, "invalid_arguments");
    assert.deepEqual(JSON.parse(await readFile(config, "utf8")), { schemaVersion: 1, model: "fake-model-b" }, "unchanged");
  });

  test("the key may come from a variables file, loaded into a copy only", async () => {
    const { base, config } = await setup();
    const vars = path.join(base, "vars.env");
    await writeFile(vars, `${ANTHROPIC_API_KEY_ENV}=${FAKE_KEY}\n`, "utf8");
    const lister = fakeLister();
    const environment = await appEnvironment(base, { env: {} });
    const app = createCodarynApp(environment, { listModels: lister.list });
    ok(await app.listModels({ provider: "anthropic", configPath: config, varsFile: vars }));
    assert.equal(lister.calls[0]?.apiKey, FAKE_KEY);
    assert.deepEqual(environment.env, {}, "the caller's environment is not changed");
    assert.equal(process.env[ANTHROPIC_API_KEY_ENV] === FAKE_KEY, false);
  });

  test("no key: nothing is sent; a failed listing is model_list_failed; another provider is refused", async () => {
    const { base, config } = await setup();
    const lister = fakeLister();
    const noKey = createCodarynApp(await appEnvironment(base, { env: {} }), { listModels: lister.list });
    const refused = await noKey.listModels({ provider: "anthropic", configPath: config, varsFile: null });
    assert.equal(refused.ok ? null : refused.error.code, "provider_not_configured");
    assert.equal(lister.calls.length, 0, "nothing was sent");

    const failing = createCodarynApp(await appEnvironment(base, { env: { [ANTHROPIC_API_KEY_ENV]: FAKE_KEY } }), {
      listModels: fakeLister({ ok: false, kind: "auth_failed", message: `HTTP 401 invalid x-api-key ${FAKE_KEY}` }).list,
    });
    const failed = await failing.listModels({ provider: "anthropic", configPath: config, varsFile: null });
    assert.equal(failed.ok ? null : failed.error.code, "model_list_failed");
    assert.equal(JSON.stringify(failed).includes(FAKE_KEY), false, "S-12: the key is not in the message");

    const other = await failing.listModels({ provider: "openai", configPath: config, varsFile: null });
    assert.equal(other.ok ? null : other.error.code, "invalid_arguments", "DR-22: only connected providers");
  });

  test("the arguments are the CLI's, and a flag-like model id is refused before anything is read", () => {
    assert.deepEqual(modelsArguments({ provider: "anthropic", configPath: "c.json", varsFile: "v.env" }), {
      ok: true,
      argv: ["models", "--config", "c.json", "--vars-file", "v.env", "--json"],
    });
    assert.deepEqual(modelsArguments({ provider: "anthropic", configPath: null, varsFile: null, model: "m" }), { ok: true, argv: ["models", "--json", "--use", "m"] });
    const flag = modelsArguments({ provider: "anthropic", configPath: null, varsFile: null, model: "--json" });
    assert.equal(flag.ok ? null : flag.error.code, "invalid_arguments");
  });
});
