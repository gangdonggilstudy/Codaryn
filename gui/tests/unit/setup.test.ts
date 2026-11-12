/**
 * U-11 (3.11): the first-run guide. The engine host's two calls with a fake app, the main process's
 * checks, and the four pages with a DOM stand-in.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { createHostHandler } from "../../src/engine-host/host.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { setupScreen } from "../../src/renderer/setup/setup-screen.js";
import { parseCreateSettingsArgs, toCreateSettingsReply, toSuggestionsReply } from "../../src/shared/ipc.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import type { HostMessage } from "../../src/shared/protocol.js";
import { fakeApp } from "./fake-app.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const WS = path.resolve("ws-for-setup");
const SUGGESTIONS = {
  kind: "settings_suggestions",
  commands: [
    { shown: "npm test", rule: { executable: "npm", argsPrefix: ["test"], allowExtraArgs: false } },
    { shown: "broken", rule: { executable: 3, argsPrefix: [], allowExtraArgs: false } },
  ],
  protectedPaths: ["package.json"],
};

function host(app: Parameters<typeof fakeApp>[0]) {
  const written: HostMessage[] = [];
  const handler = createHostHandler({
    app: fakeApp(app),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (text) => text,
    providers: [],
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

test("setup: the engine host makes the config file with the defaults (or says it exists) and passes the suggestions", async () => {
  const made: unknown[] = [];
  let exists = false;
  const call = host({
    createSettings: async (request) => {
      made.push(request);
      if (exists) return { ok: false, error: { code: "config_exists", message: "C:\\x" } };
      return { ok: true, output: { kind: "init", status: "created", model: "placeholder", keySet: false, overriddenBy: null, config: { source: "default", display: "%APPDATA%" } } };
    },
    settingsSuggestions: async () => ({ ok: true, output: SUGGESTIONS }),
  });
  assert.equal(await call(1, "createSettings", { workspace: "relative" }), "invalid_args");
  assert.deepEqual(toCreateSettingsReply(await call(2, "createSettings", { workspace: null })), { ok: true, created: true, model: "placeholder", keySet: false, overridden: false });
  assert.deepEqual(made, [{ configPath: null, workspace: null }]);
  exists = true;
  assert.deepEqual(toCreateSettingsReply(await call(3, "createSettings", { workspace: WS })), { ok: false, code: "config_exists" });
  assert.deepEqual(made[1], { configPath: null, workspace: WS }, "the config file is checked against the open workspace (S-1)");
  const suggestions = toSuggestionsReply(await call(4, "settingsSuggestions", { workspace: WS }));
  assert.deepEqual(suggestions, { ok: true, commands: [{ shown: "npm test", rule: { executable: "npm", argsPrefix: ["test"], allowExtraArgs: false } }], protectedPaths: ["package.json"] }, "a rule that does not fit is left out");
  assert.deepEqual(parseCreateSettingsArgs({ workspace: null }), { workspace: null });
  assert.equal(parseCreateSettingsArgs({ workspace: "C:\\x" }), null, "a handle, never a path");
  assert.equal(toSuggestionsReply({ ok: true, commands: [{ shown: "x", rule: { executable: "npm", argsPrefix: "test", allowExtraArgs: false } }], protectedPaths: [] }).ok, false);
});

function view(overrides: Record<string, unknown> = {}) {
  return {
    file: { display: "%APPDATA%\\Codaryn\\config.json", source: "default", exists: false },
    model: null,
    language: null,
    profiles: [],
    workflows: { builtin: [], config: [] },
    keyAvailable: false,
    providers: ["anthropic"],
    env: { model: false, language: false },
    rules: { limits: [], commands: [], protectedPaths: [], secretEnv: [] },
    policyNarrowings: [],
    provider: null,
    defaultProvider: "anthropic",
    apiProviders: [{ name: "anthropic", keyEnv: "ANTHROPIC_API_KEY", keySet: false, modelEnv: "CODARYN_MODEL", modelEnvSet: false, model: null, baseUrlEnv: null, baseUrlEnvSet: false, listable: true }],
    ...overrides,
  };
}

test("setup: four pages: the file made, the key's state by name, suggestions off by default and applied through proposals, the checks", async () => {
  const restore = installFakeDom();
  try {
    let settingsView = view();
    const calls: [string, unknown[]][] = [];
    const shown: string[] = [];
    const api = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => async (...args: unknown[]) => {
        calls.push([name, args]);
        if (name === "settings") return { ok: true, view: settingsView };
        if (name === "createSettings") return { ok: true, created: true, model: "placeholder", keySet: false, overridden: false };
        if (name === "settingsSuggestions") return { ok: true, commands: [{ shown: "npm test", rule: { executable: "npm", argsPrefix: ["test"], allowExtraArgs: false } }], protectedPaths: ["package.json"] };
        if (name === "proposeSettings") return { ok: true, token: "e".repeat(32), changes: [{ field: "policy", change: "added" }], widening: [], policyNarrowings: [] };
        if (name === "applySettings") return calls.filter(([n]) => n === "applySettings").length === 1 ? { ok: false, code: "not_confirmed" } : { ok: true, written: true, changes: [], widening: [] };
        if (name === "doctor") return { ok: true, view: { status: "warn", checks: [{ id: "api_key", status: "fail", message: "not set" }] }, labels: {}, workspaceName: "ws" };
        return null;
      },
    });
    const screen = setupScreen({ texts: textsFor("en"), api, current: () => ({ handle: "1".repeat(32), name: "ws" }), announce: () => undefined, show: (id) => shown.push(id) });
    const root = new FakeElement("main");
    const byId = (id: string) => root.findAll((e) => e.getAttribute("id") === id)[0];
    const next = async (): Promise<void> => {
      byId("setup-next")?.click();
      await settle();
      await settle();
    };
    screen.show(root as unknown as HTMLElement);
    await settle();
    // 1. No file yet: made with the defaults, against the open workspace.
    assert.equal(byId("setup-config")?.getAttribute("data-config"), "missing");
    byId("setup-create")?.click();
    await settle();
    assert.deepEqual(calls.find(([n]) => n === "createSettings")?.[1], ["1".repeat(32)]);
    assert.equal(byId("setup-create-outcome")?.getAttribute("data-created"), "yes");
    settingsView = view({ file: { display: "%APPDATA%\\Codaryn\\config.json", source: "default", exists: true } });
    // 2. No key: by its variable's name, never a field.
    await next();
    assert.equal(byId("setup-key")?.getAttribute("data-key"), "missing");
    assert.ok(byId("setup-key")?.textContent.includes("ANTHROPIC_API_KEY"));
    assert.equal(root.findAll((e) => e.tagName === "input").length, 0, "no key field");
    // 3. Suggestions, all off; nothing chosen means documents only.
    await next();
    assert.ok(byId("setup-documents-only") !== undefined);
    const boxes = root.findAll((e) => e.hasAttribute("data-suggest"));
    assert.deepEqual(boxes.map((b) => [b.getAttribute("data-suggest"), (b as unknown as { checked?: boolean }).checked === true]), [["command", false], ["protect", false]]);
    for (const box of boxes) (box as unknown as { checked: boolean }).checked = true;
    byId("setup-apply")?.click();
    await settle();
    await settle();
    assert.deepEqual(
      calls.filter(([n]) => n === "proposeSettings").map(([, args]) => args[0]),
      [{ op: "addCommand", executable: "npm", argsPrefix: ["test"], allowExtraArgs: false }, { op: "addProtectedPath", path: "package.json" }],
      "the suggestion's fixed arguments",
    );
    assert.deepEqual(root.findAll((e) => e.hasAttribute("data-result")).map((e) => e.getAttribute("data-result")), ["not_confirmed", "written"]);
    // 4. The checks, and how to register the key.
    await next();
    assert.ok(byId("setup")?.textContent.includes("not set"));
    assert.ok(byId("setup-key-how")?.textContent.includes("ANTHROPIC_API_KEY"));
    assert.equal(byId("setup-next"), undefined, "the last page");
  } finally {
    restore();
  }
});

test("setup: an existing file is used as it is; with a key the model page leads to Settings > Model", async () => {
  const restore = installFakeDom();
  try {
    const settingsView = view({
      file: { display: "CODARYN_CONFIG", source: "environment", exists: true },
      apiProviders: [{ name: "anthropic", keyEnv: "ANTHROPIC_API_KEY", keySet: true, modelEnv: "CODARYN_MODEL", modelEnvSet: false, model: "m", baseUrlEnv: null, baseUrlEnvSet: false, listable: true }],
    });
    const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "settings" ? { ok: true, view: settingsView } : null) });
    const shown: string[] = [];
    const screen = setupScreen({ texts: textsFor("en"), api, current: () => null, announce: () => undefined, show: (id) => shown.push(id) });
    const root = new FakeElement("main");
    const byId = (id: string) => root.findAll((e) => e.getAttribute("id") === id)[0];
    screen.show(root as unknown as HTMLElement);
    await settle();
    assert.equal(byId("setup-config")?.getAttribute("data-config"), "exists");
    assert.equal(byId("setup-create"), undefined, "never over an existing file");
    byId("setup-next")?.click();
    await settle();
    assert.equal(byId("setup-key")?.getAttribute("data-key"), "set");
    byId("setup-choose-model")?.click();
    assert.deepEqual(shown, ["settings"]);
    byId("setup-next")?.click();
    await settle();
    assert.ok(byId("setup")?.textContent.includes("Open a workspace"), "suggestions need an open workspace");
  } finally {
    restore();
  }
});
