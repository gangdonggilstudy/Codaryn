/**
 * PM task (2), SP-D3, DR-22: the provider choice in the settings screen. The edit
 * (src/shared/settings-edit.ts), the engine host's view of the contract's provider table, the main
 * process's check, and the screen with a DOM stand-in. No key value is ever read or shown.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createHostHandler } from "../../src/engine-host/host.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { settingsScreen } from "../../src/renderer/settings/settings.js";
import { toSettingsView } from "../../src/shared/ipc.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import type { HostMessage } from "../../src/shared/protocol.js";
import { applySettingsEdit, parseSettingsEdit } from "../../src/shared/settings-edit.js";
import { fakeApp } from "./fake-app.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const TABLE = [
  { name: "anthropic", keyEnv: "ANTHROPIC_API_KEY", modelEnv: "CODARYN_MODEL" },
  { name: "openai", keyEnv: "OPENAI_API_KEY", modelEnv: "CODARYN_OPENAI_MODEL" },
];
const CONFIG = { schemaVersion: 1, provider: "openai", model: "claude-x", providers: { openai: { model: "gpt-x" } } };
const DIGEST = "b".repeat(64);

test("provider choice: the edit names a provider or none; the config's provider is set or removed", () => {
  assert.deepEqual(parseSettingsEdit({ op: "provider", value: "openai" }), { op: "provider", value: "openai" });
  assert.deepEqual(parseSettingsEdit({ op: "provider", value: null }), { op: "provider", value: null });
  for (const value of ["OpenAI", "", "a b", 1]) assert.equal(parseSettingsEdit({ op: "provider", value }), null, String(value));
  assert.equal(parseSettingsEdit({ op: "provider", value: "openai", apiBaseUrl: "https://x" }), null, "nothing else rides along");
  const set = applySettingsEdit({ schemaVersion: 1 }, { op: "provider", value: "openai" }, (text) => text);
  assert.equal(set.ok && set.next["provider"], "openai");
  const cleared = applySettingsEdit(CONFIG, { op: "provider", value: null }, (text) => text);
  assert.equal(cleared.ok && "provider" in cleared.next, false);
});

function host(envSet: (name: string) => boolean, proposed: unknown[]) {
  const written: HostMessage[] = [];
  const handler = createHostHandler({
    app: fakeApp({
      readSettings: async () => ({
        ok: true,
        output: { kind: "settings", file: { source: "default", path: "C:\\cfg\\config.json", display: "~/config.json", exists: true }, config: CONFIG, profiles: [], workflows: [], builtinWorkflows: [], keyAvailable: false },
      }),
      proposeSettingsChange: async (request) => {
        proposed.push(request);
        return { ok: true, output: { kind: "settings_change", baseDigest: DIGEST, digest: DIGEST, changes: [{ field: "provider", change: "changed" }], widening: [], file: {}, config: {} } };
      },
    }),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (text) => text,
    envSet,
    apiProviders: TABLE,
    providers: ["anthropic"],
    itemsIn: () => () => null,
    token: () => "0".repeat(32),
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
  });
  return async (id: number, call: string, args: unknown): Promise<unknown> => {
    await handler.handleLine(JSON.stringify({ v: 1, id, call, args }));
    const message = written.find((m) => "id" in m && m.id === id) as { ok: boolean; value?: unknown; error?: { code: string } };
    return message.ok ? message.value : message.error?.code;
  };
}

test("provider choice: the host shows each provider of the table with its key variable set or not, its model and whether it is listed", async () => {
  const asked: string[] = [];
  const proposed: unknown[] = [];
  const call = host((name) => {
    asked.push(name);
    return name === "OPENAI_API_KEY";
  }, proposed);
  const value = (await call(1, "settings", {})) as { view: Record<string, unknown> };
  assert.equal(value.view["provider"], "openai");
  assert.equal(value.view["defaultProvider"], "anthropic");
  assert.deepEqual(value.view["apiProviders"], [
    { name: "anthropic", keyEnv: "ANTHROPIC_API_KEY", keySet: false, modelEnv: "CODARYN_MODEL", modelEnvSet: false, model: "claude-x", listable: true },
    { name: "openai", keyEnv: "OPENAI_API_KEY", keySet: true, modelEnv: "CODARYN_OPENAI_MODEL", modelEnvSet: false, model: "gpt-x", listable: false },
  ]);
  assert.ok(asked.includes("OPENAI_API_KEY"), "asked whether it is set, by name");
  const checked = toSettingsView(value, { model: false, language: false });
  assert.equal(checked.ok && checked.view.apiProviders.length, 2);

  assert.equal(await call(2, "proposeSettings", { edit: { op: "provider", value: "other" } }), "invalid_args", "a name outside the table");
  assert.equal(proposed.length, 0);
  await call(3, "proposeSettings", { edit: { op: "provider", value: "anthropic" } });
  assert.equal((proposed[0] as { next: { provider: string } }).next.provider, "anthropic");
});

test("provider choice: the main process refuses a provider view with values or odd names", () => {
  const base = {
    file: null,
    model: null,
    language: null,
    profiles: [],
    workflows: { builtin: [], config: [] },
    keyAvailable: false,
    providers: [],
    rules: { policySet: false, limits: [], commands: [], protectedPaths: [], secretEnv: [] },
    provider: null,
    defaultProvider: "anthropic",
  };
  const entry = { name: "openai", keyEnv: "OPENAI_API_KEY", keySet: true, modelEnv: "CODARYN_OPENAI_MODEL", modelEnvSet: false, model: null, listable: false };
  const env = { model: false, language: false };
  assert.equal(toSettingsView({ ok: true, view: { ...base, apiProviders: [entry] } }, env).ok, true);
  assert.equal(toSettingsView({ ok: true, view: { ...base, apiProviders: [{ ...entry, keyValue: "x" }] } }, env).ok, false, "no other field");
  assert.equal(toSettingsView({ ok: true, view: { ...base, apiProviders: [{ ...entry, keyEnv: "A=B" }] } }, env).ok, false);
  assert.equal(toSettingsView({ ok: true, view: { ...base, provider: "Open AI", apiProviders: [entry] } }, env).ok, false);
});

test("provider choice: the screen shows the providers, a model list for each listed one, and proposes a choice", async () => {
  const restore = installFakeDom();
  try {
    let provider: string | null = null;
    const calls: unknown[] = [];
    const view = () => ({
      file: { display: "~/config.json", source: "default", exists: true },
      model: "claude-x",
      language: null,
      profiles: [],
      workflows: { builtin: [], config: [] },
      keyAvailable: true,
      providers: ["anthropic"],
      env: { model: false, language: false },
      rules: { policySet: false, limits: [], commands: [], protectedPaths: [], secretEnv: [] },
      provider,
      defaultProvider: "anthropic",
      apiProviders: [
        { name: "anthropic", keyEnv: "ANTHROPIC_API_KEY", keySet: true, modelEnv: "CODARYN_MODEL", modelEnvSet: false, model: "claude-x", listable: true },
        { name: "openai", keyEnv: "OPENAI_API_KEY", keySet: false, modelEnv: "CODARYN_OPENAI_MODEL", modelEnvSet: true, model: null, listable: false },
      ],
    });
    const api = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => async (arg: unknown) => {
        if (name === "settings") return { ok: true, view: view() };
        if (name === "proposeSettings") {
          calls.push(arg);
          return { ok: true, token: "e".repeat(32), changes: [{ field: "provider", change: "added" }], widening: [] };
        }
        return null;
      },
    });
    const screen = settingsScreen({ texts: textsFor("en"), api, language: "en", announce: () => undefined });
    const root = new FakeElement("main");
    const show = async (): Promise<void> => {
      screen.show(root as unknown as HTMLElement);
      await settle();
    };
    const byId = (id: string) => root.findAll((e) => e.getAttribute("id") === id)[0];
    await show();
    const rows = root.findAll((e) => e.tagName === "li" && e.hasAttribute("data-provider"));
    assert.deepEqual(
      rows.map((row) => [row.getAttribute("data-provider"), row.getAttribute("data-key"), row.getAttribute("aria-current")]),
      [
        ["anthropic", "set", "true"],
        ["openai", "missing", null],
      ],
    );
    assert.ok(rows[1]?.textContent.includes("CODARYN_OPENAI_MODEL overrides"));
    assert.equal(byId("settings-provider-current")?.getAttribute("data-provider"), "anthropic");
    assert.deepEqual(
      root.findAll((e) => e.hasAttribute("data-list-models")).map((e) => e.getAttribute("data-list-models")),
      ["anthropic"],
    );

    (byId("settings-provider-choice") as FakeElement).value = "openai";
    byId("settings-provider-change")?.click();
    await settle();
    assert.deepEqual(calls, [{ op: "provider", value: "openai" }]);

    // With openai in use: the provider the app layer lists keeps its button; openai, not listed in
    // this view, has none, and the screen says how to choose its model.
    provider = "openai";
    await show();
    assert.equal(byId("settings-provider-current")?.getAttribute("data-provider"), "openai");
    assert.deepEqual(
      root.findAll((e) => e.hasAttribute("data-list-models")).map((e) => e.getAttribute("data-list-models")),
      ["anthropic"],
    );
    assert.ok(byId("settings-model-no-list")?.textContent.includes("codaryn models --provider openai"));
    assert.equal(byId("settings-model-current")?.textContent, textsFor("en").format("settings.modelNone"), "openai's model, not anthropic's");
  } finally {
    restore();
  }
});
