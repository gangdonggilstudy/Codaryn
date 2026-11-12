/**
 * GU-3 (3.5), SP-D3, SP-D10: the new task screen names the provider a run will use (the chosen
 * profile's, else the config's, else the default) and that provider's model, and follows the
 * profile choice. Screen with a DOM stand-in.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { newTaskScreen } from "../../src/renderer/run/new-task.js";
import { RunModel } from "../../src/renderer/run/run-model.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

test("new task: the notice names the provider in use and follows the chosen profile's provider", async () => {
  const restore = installFakeDom();
  try {
    const view = {
      file: { display: "~/config.json", source: "default", exists: true },
      model: "claude-x",
      language: null,
      profiles: [
        { name: "plain", workflowRef: null, provider: null, limits: [], commands: [], verifiers: 0, protectedPaths: 0 },
        { name: "other", workflowRef: null, provider: "openai", limits: [], commands: [], verifiers: 0, protectedPaths: 0 },
      ],
      workflows: { builtin: [], config: [] },
      keyAvailable: true,
      providers: ["anthropic"],
      env: { model: false, language: false },
      rules: { limits: [], commands: [], protectedPaths: [], secretEnv: [] },
      provider: null,
      defaultProvider: "anthropic",
      apiProviders: [
        { name: "anthropic", keyEnv: "ANTHROPIC_API_KEY", keySet: true, modelEnv: "CODARYN_MODEL", modelEnvSet: false, model: "claude-x", listable: true },
        { name: "openai", keyEnv: "OPENAI_API_KEY", keySet: true, modelEnv: "CODARYN_OPENAI_MODEL", modelEnvSet: false, model: "gpt-x", listable: false },
      ],
    };
    const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "settings" ? { ok: true, view } : null) });
    const screen = newTaskScreen({ texts: textsFor("en"), api, run: new RunModel(), current: () => ({ handle: "1".repeat(32), name: "ws" }), open: () => undefined, showRun: () => undefined });
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    const byId = (id: string) => root.findAll((e) => e.getAttribute("id") === id)[0];
    assert.equal(byId("task-notice")?.getAttribute("data-provider"), "anthropic");
    assert.ok(byId("task-model")?.textContent.includes("claude-x"));

    const profile = byId("task-profile") as FakeElement;
    profile.value = "other";
    profile.dispatch("change");
    assert.equal(byId("task-notice")?.getAttribute("data-provider"), "openai", "the profile's provider wins");
    assert.ok(byId("task-notice")?.textContent.includes("openai API"));
    assert.ok(byId("task-model")?.textContent.includes("gpt-x"), "that provider's model");

    profile.value = "plain";
    profile.dispatch("change");
    assert.equal(byId("task-notice")?.getAttribute("data-provider"), "anthropic");
  } finally {
    restore();
  }
});
