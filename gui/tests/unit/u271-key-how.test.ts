/**
 * U-271 (C-23, UXM-13): the GUI said that the key comes from a variable of the environment the app starts
 * in, but not how to register one; the CLI's init and doctor say it for the operating system they run on.
 * Now the main process says which kind of OS the app runs on (the settings view's env.os, checked again
 * by the window), and when the key of the provider in use is not set, the settings and the first-run guide
 * (its model page and its checks) say how on that OS, then to start Codaryn again. No value is asked or
 * shown, and nothing is started from the window (an "environment variables" button is left out).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodarynApi } from "../../src/renderer/api.js";
import { asSettings } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { keyHowLine } from "../../src/renderer/settings/key-how.js";
import { setupScreen } from "../../src/renderer/setup/setup-screen.js";
import type { SettingsView } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

function view(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    file: { display: "%APPDATA%\\Codaryn\\config.json", source: "default", exists: true },
    model: null,
    language: null,
    profiles: [],
    workflows: { builtin: [], config: [] },
    keyAvailable: false,
    providers: ["anthropic"],
    env: { model: false, language: false, os: "windows" },
    rules: { limits: [], commands: [], protectedPaths: [], secretEnv: [] },
    policyNarrowings: [],
    provider: null,
    defaultProvider: "anthropic",
    apiProviders: [{ name: "anthropic", keyEnv: "ANTHROPIC_API_KEY", keySet: false, modelEnv: "CODARYN_MODEL", modelEnvSet: false, model: null, baseUrlEnv: null, baseUrlEnvSet: false, listable: true }],
    ...overrides,
  };
}

const settingsOf = (value: Record<string, unknown>): SettingsView => {
  const reply = asSettings({ ok: true, view: value });
  assert.ok(reply.ok);
  return reply.view;
};

test("U-271 (C-23): the window takes the OS kind the main process gives, and nothing else", () => {
  assert.equal(settingsOf(view()).env.os, "windows");
  assert.equal(settingsOf(view({ env: { model: false, language: false, os: "posix" } })).env.os, "posix");
  assert.equal(settingsOf(view({ env: { model: false, language: false, os: "win32" } })).env.os, undefined);
  assert.equal("os" in settingsOf(view({ env: { model: false, language: false } })).env, false);
});

test("U-271 (C-23): how to register the missing key on this OS, by the variable's name only", () => {
  const restore = installFakeDom();
  try {
    const ko = textsFor("ko");
    const windows = keyHowLine(ko, settingsOf(view()), "k") as unknown as FakeElement;
    assert.equal(windows.textContent, KO["key.how.windows"].replace("{env}", "ANTHROPIC_API_KEY"));
    assert.equal(windows.getAttribute("data-os"), "windows");
    const posix = keyHowLine(textsFor("en"), settingsOf(view({ env: { model: false, language: false, os: "posix" } })), "k") as unknown as FakeElement;
    assert.equal(posix.textContent, EN["key.how.posix"].replaceAll("{env}", "ANTHROPIC_API_KEY"));
    // Set: nothing to register. OS not known: no steps are guessed.
    const set = view({ keyAvailable: true, apiProviders: [{ ...(view()["apiProviders"] as Record<string, unknown>[])[0], keySet: true }] });
    assert.equal(keyHowLine(ko, settingsOf(set), "k"), null);
    assert.equal(keyHowLine(ko, settingsOf(view({ env: { model: false, language: false } })), "k"), null);
    for (const id of ["key.how.windows", "key.how.posix"] as const) {
      assert.ok(KO[id].includes("{env}") && EN[id].includes("{env}"), id);
      assert.ok(/Codaryn/.test(KO[id]) && /again/.test(EN[id]), "start Codaryn again");
    }
  } finally {
    restore();
  }
});

test("U-271 (C-23): the first-run guide's model page and its checks say how on this OS", async () => {
  const restore = installFakeDom();
  try {
    const api = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => async () => {
        if (name === "settings") return { ok: true, view: view() };
        if (name === "settingsSuggestions") return { ok: true, commands: [], protectedPaths: [] };
        if (name === "doctor") return { ok: true, view: { status: "warn", checks: [{ id: "api_key", status: "fail", message: "not set" }] }, labels: {}, workspaceName: "ws" };
        return null;
      },
    });
    const screen = setupScreen({ texts: textsFor("ko"), api, current: () => ({ handle: "1".repeat(32), name: "ws" }), announce: () => undefined, show: () => undefined });
    const root = new FakeElement("main");
    const byId = (id: string) => root.findAll((e) => e.getAttribute("id") === id)[0];
    const next = async (): Promise<void> => {
      byId("setup-next")?.click();
      await settle();
      await settle();
    };
    screen.show(root as unknown as HTMLElement);
    await settle();
    await next();
    assert.equal(byId("setup-key")?.getAttribute("data-key"), "missing");
    assert.equal(byId("setup-key-os")?.getAttribute("data-os"), "windows");
    assert.ok(byId("setup-key-os")?.textContent.includes("ANTHROPIC_API_KEY"));
    assert.equal(root.findAll((e) => e.tagName === "input").length, 0, "no key field");
    await next();
    await next();
    assert.ok(byId("setup-key-how") !== undefined);
    assert.equal(byId("setup-checks-key-os")?.getAttribute("data-os"), "windows");
  } finally {
    restore();
  }
});
