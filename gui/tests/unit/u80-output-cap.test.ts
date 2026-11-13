/**
 * U-80 (docs/design/standalone-gui.md 3.10; design gap survey 1): a provider other than anthropic
 * needs its own output cap (`providers.<name>.maxOutputTokens`; the CLI's resolveApiSettings), and
 * the first-run config (init) writes the top-level one only, which is anthropic's. Before U-80 the
 * window had no edit for it, so after choosing openai in the settings every run stopped with
 * provider_not_configured. The settings now show each provider's output cap and change it with one
 * edit, written where that provider reads it.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createHostHandler } from "../../src/engine-host/host.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { settingsScreen } from "../../src/renderer/settings/settings.js";
import { startEngineHost } from "../../src/main/engine-client.js";
import { hostEnvironment } from "../../src/main/environment.js";
import { toSettingsView } from "../../src/shared/ipc.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import type { HostMessage } from "../../src/shared/protocol.js";
import { applySettingsEdit, parseSettingsEdit } from "../../src/shared/settings-edit.js";
import { fakeApp } from "./fake-app.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

// This file runs as gui/build/tests/unit/u80-output-cap.test.js.
const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const HOST_SCRIPT = path.join(GUI, "build", "src", "engine-host", "main.js");
const ENGINE_DIR = path.join(GUI, "..", "dist", "src");
const skip = !existsSync(path.join(ENGINE_DIR, "app", "index.js")) && "the engine is not built";
const same = (text: string): string => text;

/**
 * The config the window leaves: the first-run guide's (createSettings is init's config text: a
 * top-level output cap, which is anthropic's), then provider openai and an openai model.
 */
async function guiConfig(): Promise<Record<string, unknown>> {
  const init = (await import(pathToFileURL(path.join(ENGINE_DIR, "cli", "init.js")).href)) as { initConfigText(choices: unknown): string };
  const config = JSON.parse(init.initConfigText({ model: "claude-x", commands: [], protectedPaths: [], language: null })) as Record<string, unknown>;
  return { ...config, provider: "openai", providers: { openai: { model: "gpt-x" } } };
}

async function startOutcome(config: unknown): Promise<unknown> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gui-u80-"));
  try {
    const file = path.join(dir, "config.json");
    await fs.writeFile(file, JSON.stringify(config));
    const workspace = path.join(dir, "ws");
    await fs.mkdir(workspace);
    const secrets = (await import(pathToFileURL(path.join(GUI, "..", "dist", "tests", "fixtures", "secrets.js")).href)) as { FAKE_OPENAI_KEY: string };
    const env = hostEnvironment(process.env);
    for (const name of Object.keys(env)) if (/^(ANTHROPIC_API_KEY|OPENAI_API_KEY|CODARYN_[A-Z0-9_]+)$/i.test(name)) delete env[name];
    const outcome = await startEngineHost({ nodePath: process.execPath, hostScript: HOST_SCRIPT, engineDir: ENGINE_DIR, env: { ...env, CODARYN_CONFIG: file, OPENAI_API_KEY: secrets.FAKE_OPENAI_KEY }, cwd: dir, transport: "loopback-only" });
    assert.ok(outcome.ok, JSON.stringify(outcome));
    try {
      const response = await outcome.host.call("startRun", { workspace, goal: "write a note", profile: null, workflowRef: null, language: "en" }, 60_000);
      assert.ok(response.ok, JSON.stringify(response));
      if (typeof response.value === "object" && response.value !== null && (response.value as { ok?: unknown }).ok === true) await outcome.host.call("cancelRun", {}, 10_000);
      return response.value;
    } finally {
      await outcome.host.close();
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test("U-80: with the window's config and openai chosen, a run stops for openai's output cap", { skip }, async () => {
  const config = await guiConfig();
  assert.equal(typeof config["maxOutputTokens"], "number", "init writes the top-level cap");
  const value = (await startOutcome(config)) as { ok: boolean; code?: string };
  assert.equal(value.ok, false);
  assert.equal(value.code, "provider_not_configured", "init's top-level cap is anthropic's; openai has none");
});

test("U-80: one edit sets a provider's output cap where that provider reads it", { skip }, async () => {
  const config = await guiConfig();
  const edit = parseSettingsEdit({ op: "outputCap", provider: "openai", value: 4096 });
  assert.deepEqual(edit, { op: "outputCap", provider: "openai", value: 4096 });
  const applied = applySettingsEdit(config, edit as never, same);
  assert.ok(applied.ok, JSON.stringify(applied));
  if (!applied.ok) return;
  const next = applied.next as { maxOutputTokens: number; providers: { openai: Record<string, unknown> } };
  assert.deepEqual(next.providers.openai, { model: "gpt-x", maxOutputTokens: 4096 }, "the entry keeps its model");
  assert.equal(next.maxOutputTokens, config["maxOutputTokens"], "anthropic's stays");
  // anthropic: the top-level field, unless the file keeps providers.anthropic (as models --use writes the model).
  const top = applySettingsEdit({ schemaVersion: 1, model: "m" }, { op: "outputCap", provider: "anthropic", value: 2048 } as never, same);
  assert.ok(top.ok && (top.next as Record<string, unknown>)["maxOutputTokens"] === 2048);
  const kept = applySettingsEdit({ schemaVersion: 1, providers: { anthropic: { model: "m" } } }, { op: "outputCap", provider: "anthropic", value: 2048 } as never, same);
  assert.ok(kept.ok && JSON.stringify((kept.next as { providers: unknown }).providers) === JSON.stringify({ anthropic: { model: "m", maxOutputTokens: 2048 } }));
  const cleared = applySettingsEdit({ schemaVersion: 1, providers: { openai: { model: "g", maxOutputTokens: 9 } } }, { op: "outputCap", provider: "openai", value: null } as never, same);
  assert.ok(cleared.ok && JSON.stringify((cleared.next as { providers: unknown }).providers) === JSON.stringify({ openai: { model: "g" } }), "null removes it");
  for (const bad of [{ op: "outputCap", provider: "openai", value: 0 }, { op: "outputCap", provider: "openai", value: 1.5 }, { op: "outputCap", provider: "Open AI", value: 10 }, { op: "outputCap", provider: "openai", value: 10, extra: 1 }]) {
    assert.equal(parseSettingsEdit(bad), null, JSON.stringify(bad));
  }
});

test("U-80: with the output cap set that way, the run no longer stops for it", { skip }, async () => {
  const applied = applySettingsEdit(await guiConfig(), { op: "outputCap", provider: "openai", value: 4096 } as never, same);
  assert.ok(applied.ok);
  if (!applied.ok) return;
  // A closed port on this machine (G-11): the run's request cannot reach any server.
  const edited = applied.next as { providers: { openai: Record<string, unknown> } };
  const next = { ...edited, providers: { openai: { ...edited.providers.openai, apiBaseUrl: "http://127.0.0.1:9/v1", maxRetries: 0, requestTimeoutMs: 2000 } } };
  const value = (await startOutcome(next)) as { ok: boolean; code?: string };
  assert.ok(value.ok === true || value.code !== "provider_not_configured", JSON.stringify(value));
});

const TABLE = [
  { name: "anthropic", keyEnv: "ANTHROPIC_API_KEY", modelEnv: "CODARYN_MODEL" },
  { name: "openai", keyEnv: "OPENAI_API_KEY", modelEnv: "CODARYN_OPENAI_MODEL" },
];

test("U-80: the settings view says each provider's output cap, and the screen sets it with one edit", async () => {
  const config = { schemaVersion: 1, model: "claude-x", maxOutputTokens: 4096, provider: "openai", providers: { openai: { model: "gpt-x" } } };
  const written: HostMessage[] = [];
  const proposed: unknown[] = [];
  const handler = createHostHandler({
    app: fakeApp({
      readSettings: async () => ({ ok: true, output: { kind: "settings", file: { source: "default", path: "C:\\cfg\\config.json", display: "~/config.json", exists: true }, config, profiles: [], workflows: [], builtinWorkflows: [], keyAvailable: false } }),
      proposeSettingsChange: async (request) => {
        proposed.push(request);
        return { ok: true, output: { kind: "settings_change", baseDigest: "b".repeat(64), digest: "b".repeat(64), changes: [{ field: "providers.openai.maxOutputTokens", change: "added" }], widening: [], file: {}, config: {} } };
      },
    }),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: same,
    envSet: () => false,
    apiProviders: TABLE,
    providers: ["anthropic", "openai"],
    itemsIn: () => () => null,
    token: () => "0".repeat(32),
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
  });
  const call = async (id: number, name: string, args: unknown): Promise<unknown> => {
    await handler.handleLine(JSON.stringify({ v: 1, id, call: name, args }));
    const message = written.find((m) => "id" in m && m.id === id) as { ok: boolean; value?: unknown; error?: { code: string } };
    return message.ok ? message.value : message.error?.code;
  };
  const value = (await call(1, "settings", {})) as { view: { apiProviders: { name: string; outputCap: number | null }[] } };
  assert.deepEqual(value.view.apiProviders.map((entry) => [entry.name, entry.outputCap]), [["anthropic", 4096], ["openai", null]], "init's top-level cap is anthropic's only");
  const checked = toSettingsView(value, { model: false, language: false });
  assert.ok(checked.ok);
  if (!checked.ok) return;
  assert.deepEqual(checked.view.apiProviders.map((entry) => entry.outputCap), [4096, null]);
  assert.equal(toSettingsView({ ...value, view: { ...value.view, apiProviders: [{ ...value.view.apiProviders[0], outputCap: 0 }] } }, { model: false, language: false }).ok, false, "a cap is a whole number from 1");
  assert.equal(await call(2, "proposeSettings", { edit: { op: "outputCap", provider: "nonesuch", value: 10 } }), "invalid_args", "only a provider of the contract's table");
  await call(3, "proposeSettings", { edit: { op: "outputCap", provider: "openai", value: 4096 } });
  const next = (proposed[0] as { next: { providers: { openai: Record<string, unknown> } } }).next;
  assert.deepEqual(next.providers.openai, { model: "gpt-x", maxOutputTokens: 4096 });

  const restore = installFakeDom();
  try {
    const edits: unknown[] = [];
    const api = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => async (arg: unknown) => {
        if (name === "settings") return { ok: true, view: checked.view };
        if (name === "proposeSettings") {
          edits.push(arg);
          return { ok: true, token: "e".repeat(32), changes: [{ field: "providers.openai.maxOutputTokens", change: "added" }], widening: [] };
        }
        return null;
      },
    });
    for (const language of ["en", "ko"] as const) {
      const screen = settingsScreen({ texts: textsFor(language), api, language, announce: () => undefined });
      const root = new FakeElement("main");
      screen.show(root as unknown as HTMLElement);
      await settle();
      const row = root.findAll((e) => e.tagName === "li" && e.getAttribute("data-provider") === "openai")[0];
      const missing = row?.findAll((e) => e.getAttribute("data-output-cap") === "missing")[0];
      assert.ok(missing !== undefined, `${language}: openai's missing cap is said`);
      assert.equal(missing?.textContent, textsFor(language).format("settings.providerNoOutputCap"));
      if (language === "en") {
        assert.ok(missing?.textContent.includes("stops before anything is sent"));
        (root.findAll((e) => e.getAttribute("id") === "settings-output-cap-openai")[0] as FakeElement).value = "4096";
        root.findAll((e) => e.getAttribute("data-output-cap-set") === "openai")[0]?.click();
        await settle();
        assert.deepEqual(edits, [{ op: "outputCap", provider: "openai", value: 4096 }]);
      }
    }
  } finally {
    restore();
  }
});
