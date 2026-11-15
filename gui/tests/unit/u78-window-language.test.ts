/**
 * U-78 (N-4, docs/design/standalone-gui.md 11; design gap survey 1): the window's language is chosen
 * as the CLI chooses it: CODARYN_LANG, then the config file's `language`, then the OS display
 * language, then English (src/cli/main.ts `language`). Before U-78 the engine host passed no config
 * language, so a config file's `language` never reached the window, though the settings screen
 * writes it and says it applies at the next start.
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

// This file runs as gui/build/tests/unit/u78-window-language.test.js.
const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const HOST_SCRIPT = path.join(GUI, "build", "src", "engine-host", "main.js");
const ENGINE_DIR = path.join(GUI, "..", "dist", "src");
const skip = !existsSync(path.join(ENGINE_DIR, "app", "index.js")) && "the engine is not built";

/** The host's environment: no provider key and no Codaryn variable of this machine, the config file given. */
function env(config: string, extra: Record<string, string> = {}): Record<string, string> {
  const out = hostEnvironment(process.env);
  for (const name of Object.keys(out)) if (/^(ANTHROPIC_API_KEY|OPENAI_API_KEY|CODARYN_[A-Z0-9_]+)$/i.test(name)) delete out[name];
  return { ...out, CODARYN_CONFIG: config, ...extra };
}

async function languageWith(configText: string | null, osLocale: string, extra: Record<string, string> = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gui-u78-"));
  const config = path.join(dir, "config.json");
  if (configText !== null) await fs.writeFile(config, configText);
  const options: EngineHostOptions = { nodePath: process.execPath, hostScript: HOST_SCRIPT, engineDir: ENGINE_DIR, env: env(config, extra), cwd: dir, transport: "loopback-only" };
  const outcome = await startEngineHost(options);
  assert.ok(outcome.ok, JSON.stringify(outcome));
  const host: EngineHost = outcome.host;
  try {
    const response = await host.call("messages", { osLocale, ids: ["status.done"] }, 10_000);
    assert.ok(response.ok, JSON.stringify(response));
    return (response.value as { language: string }).language;
  } finally {
    await host.close();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const withLanguage = (language: string): string => JSON.stringify({ schemaVersion: 1, model: "fake-model", language });

test("U-78: the config file's language wins over the OS display language", { skip }, async () => {
  assert.equal(await languageWith(withLanguage("ko"), "en-US"), "ko");
  assert.equal(await languageWith(withLanguage("en"), "ko-KR"), "en");
});

test("U-78: CODARYN_LANG still wins over the config file", { skip }, async () => {
  assert.equal(await languageWith(withLanguage("ko"), "ko-KR", { CODARYN_LANG: "en" }), "en");
});

test("U-78: without a language in the config, or without a config that can be read, the OS decides", { skip }, async () => {
  assert.equal(await languageWith(JSON.stringify({ schemaVersion: 1, model: "fake-model" }), "ko-KR"), "ko");
  assert.equal(await languageWith("{ not json", "ko-KR"), "ko", "a broken config file");
  assert.equal(await languageWith(null, "ko-KR"), "ko", "no config file");
  assert.equal(await languageWith(null, "fr-FR"), "en", "neither: English");
});
