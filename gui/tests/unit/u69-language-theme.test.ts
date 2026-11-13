/**
 * U-69 (docs/design/standalone-gui.md 11, 3.10, 10): a written language change makes the window
 * look at its language again (a new one redraws it at once); "show the config file in its folder"
 * goes through the main process, which alone gets the file's path from the engine host; the dark
 * theme follows the OS and gives the comparison's fixed colours dark values.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createHostHandler } from "../../src/engine-host/host.js";
import { configFileValue } from "../../src/engine-host/settings.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { settingsScreen } from "../../src/renderer/settings/settings.js";
import { Shell } from "../../src/renderer/shell/shell.js";
import { IPC_CHANNELS } from "../../src/shared/ipc.js";
import { HOST_CALLS, parseHostMessage } from "../../src/shared/protocol.js";
import { fakeApp } from "./fake-app.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG_PATH = "C:\\Users\\someone\\AppData\\Roaming\\Codaryn\\config.json";

test("U-69: the engine host gives the config file's path to the main process only, by its own call", async () => {
  assert.deepEqual(configFileValue({ ok: true, output: { kind: "settings", file: { source: "default", path: CONFIG_PATH, display: "%APPDATA%\\Codaryn\\config.json", exists: true } } }), { ok: true, path: CONFIG_PATH, exists: true });
  assert.deepEqual(configFileValue({ ok: true, output: { kind: "settings", file: null } }), { ok: false, code: "config_missing" });
  assert.deepEqual(configFileValue({ ok: false, error: { code: "invalid_config", message: "x" } }), { ok: false, code: "invalid_config" });
  assert.deepEqual(configFileValue({ ok: true, output: { kind: "settings", file: { path: "" } } }), { ok: false, code: "host_error" });
  assert.ok((HOST_CALLS as readonly string[]).includes("configFile"));
  assert.equal(IPC_CHANNELS.revealConfig, "codaryn:settings:revealconfig");
  const written: unknown[] = [];
  const handler = createHostHandler({
    app: fakeApp({ readSettings: async () => ({ ok: true, output: { kind: "settings", file: { source: "environment", path: CONFIG_PATH, display: "config.json", exists: false } } }) }),
    itemsIn: () => () => null,
    token: () => "0".repeat(32),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (text) => text,
    providers: [],
    write: (line) => written.push(parseHostMessage(line.trimEnd())),
    log: () => undefined,
  });
  await handler.handleLine(JSON.stringify({ v: 1, id: 1, call: "configFile", args: {} }));
  await handler.handleLine(JSON.stringify({ v: 1, id: 2, call: "configFile", args: { path: "x" } }));
  assert.deepEqual((written[0] as { value: unknown }).value, { ok: true, path: CONFIG_PATH, exists: false });
  assert.equal((written[1] as { ok: boolean; error?: { code: string } }).error?.code, "invalid_args");
});

const VIEW = {
  file: { display: "config.json", source: "environment", exists: true },
  model: null,
  language: null,
  profiles: [],
  workflows: { builtin: [], config: [] },
  keyAvailable: false,
  providers: [],
  env: { model: false, language: false },
  rules: { limits: [], commands: [], protectedPaths: [], secretEnv: [] },
  policyNarrowings: [],
  provider: null,
  defaultProvider: null,
  apiProviders: [],
};

test("U-69: the settings show the config file in its folder through the main process, and a written change makes the window look at its language", async () => {
  const restore = installFakeDom();
  try {
    let revealed = 0;
    let looked = 0;
    const api = {
      async settings() {
        return { ok: true, view: VIEW };
      },
      async revealConfig() {
        revealed += 1;
        return revealed === 1 ? { ok: true } : { ok: false, code: "config_missing" };
      },
      async proposeSettings() {
        return { ok: true, token: "1".repeat(32), changes: [{ field: "language", change: "set" }], widening: [], policyNarrowings: [] };
      },
      async applySettings() {
        return { ok: true, written: true, changes: [{ field: "language", change: "set" }], widening: [] };
      },
    } as unknown as CodarynApi;
    const screen = settingsScreen({ texts: textsFor("en"), api, language: "en", announce: () => undefined, languageChanged: () => (looked += 1) });
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    const byId = (id: string): FakeElement | undefined => root.findAll((e) => e.getAttribute("id") === id)[0];
    assert.equal(byId("settings-reveal-config")?.textContent, "Show the config file in its folder");
    byId("settings-reveal-config")?.click();
    await settle();
    assert.equal(byId("settings-reveal-status")?.getAttribute("data-revealed"), "ok");
    byId("settings-reveal-config")?.click();
    await settle();
    assert.equal(byId("settings-reveal-status")?.getAttribute("data-revealed"), "config_missing");
    byId("settings-language-change")?.click();
    await settle();
    byId("settings-write")?.click();
    await settle();
    await settle();
    assert.equal(looked, 1, "after a write the window looks at its language");
    for (const language of ["ko", "en"] as const) {
      const t = textsFor(language);
      for (const id of ["settings.revealConfig", "settings.revealFailed", "settings.languageNow"]) assert.ok(t.has(id), `${language} ${id}`);
      assert.doesNotMatch(t.format("settings.languageNext"), /starts again|다시 시작하면/, "no restart is needed any more");
    }
  } finally {
    restore();
  }
});

test("U-69: a frame built again stops listening to the document's keys", () => {
  const restore = installFakeDom();
  const doc = (globalThis as unknown as { document: Record<string, unknown> }).document;
  const listeners = new Set<unknown>();
  const before = { add: doc["addEventListener"], remove: doc["removeEventListener"] };
  doc["addEventListener"] = (_type: string, listener: unknown) => listeners.add(listener);
  doc["removeEventListener"] = (_type: string, listener: unknown) => listeners.delete(listener);
  try {
    const shell = new Shell(textsFor("en"), { openWorkspace: () => undefined });
    shell.mount(new FakeElement("div") as unknown as HTMLElement);
    assert.equal(listeners.size, 1);
    shell.destroy();
    assert.equal(listeners.size, 0);
  } finally {
    doc["addEventListener"] = before.add;
    doc["removeEventListener"] = before.remove;
    restore();
  }
});

test("U-69: the dark theme follows the OS and gives each fixed colour of the comparison a dark value", () => {
  const css = readFileSync(path.join(GUI, "src", "renderer", "styles.css"), "utf8");
  assert.match(css, /color-scheme:\s*light dark/);
  const dark = /@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  for (const selector of [".diff-added", ".diff-removed", ".diff .no", ".diff-side td.no", "#palette"]) assert.ok(dark.includes(selector), selector);
  assert.match(css, /forced-colors: active/, "high contrast keeps its own rule");
});
