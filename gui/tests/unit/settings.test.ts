/**
 * GU-6: settings, the model list and a model choice. The engine host's calls with a fake app
 * (src/engine-host/host.ts, settings.ts), the main process's checks on what the host gives back
 * (src/shared/ipc.ts) and the entry ids a model is chosen by (src/main/model-entries.ts).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createHostHandler } from "../../src/engine-host/host.js";
import type { HostApp, HostModelsRequest } from "../../src/engine-host/host.js";
import { ModelEntries } from "../../src/main/model-entries.js";
import { parseEntryArgs, parseProviderArgs, toHostModelList, toSelectModelReply, toSettingsView } from "../../src/shared/ipc.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import { fakeApp } from "./fake-app.js";
import type { HostMessage } from "../../src/shared/protocol.js";

const CONFIG_PATH = "C:\\Users\\someone\\private-place\\config.json";
const SETTINGS = {
  ok: true,
  output: {
    kind: "settings",
    file: { source: "environment", path: CONFIG_PATH, display: "%APPDATA%\\codaryn\\config.json", exists: true },
    config: {
      schemaVersion: 1,
      model: "model-a",
      language: "ko",
      apiBaseUrl: "https://api.example.invalid",
      profiles: {
        doc: {
          workflowRef: "organize",
          limits: { maxModelTurns: 5, maxTotalTokens: null },
          policy: { commands: [{ executable: "node\u0007", args: [] }], protectedPaths: ["a", "b"] },
          verifiers: [{ id: "v" }],
        },
      },
    },
    profiles: ["doc", "__proto__"],
    workflows: ["mine"],
    builtinWorkflows: ["code", "document"],
    profileWorkflows: [{ profile: "doc", workflowRef: "organize" }],
    keyAvailable: true,
  },
};

const ENV = { model: false, language: true };

function host(app: Partial<HostApp>) {
  const written: HostMessage[] = [];
  const calls: HostModelsRequest[] = [];
  const handler = createHostHandler({
    app: fakeApp({
      readSettings: async () => SETTINGS,
      listModels: async (request) => {
        calls.push(request);
        return { ok: false, error: { code: "missing_api_key", message: "a message with a path C:\\Users\\someone" } };
      },
      selectModel: async (request) => {
        calls.push(request);
        return { ok: true, output: { selected: { id: request.model, created: false, overriddenBy: "CODARYN_MODEL" } } };
      },
      ...app,
    }),
    itemsIn: () => () => null,
    token: () => "0".repeat(32),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (text) => `<${text.replace(/[\u0000-\u001f]/g, "?")}>`,
    providers: ["anthropic"],
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
  });
  const call = async (id: number, name: string, args: unknown): Promise<unknown> => {
    await handler.handleLine(JSON.stringify({ v: 1, id, call: name, args }));
    const message = written.find((m) => "id" in m && m.id === id) as HostMessage & { ok: boolean; value?: unknown; error?: { code: string } };
    return message.ok ? message.value : { channelError: message.error?.code };
  };
  return { call, calls };
}

test("settings (GU-6): the host sends the display form only, and every config text passes the cleaning", async () => {
  const { call } = host({});
  const value = await call(1, "settings", {});
  const text = JSON.stringify(value);
  assert.equal(text.includes("private-place"), false, "the config file's full path stays in the host");
  assert.equal(text.includes("api.example.invalid"), false, "config fields the screen does not show are not sent");
  const reply = toSettingsView(value, ENV);
  assert.equal(reply.ok, true);
  if (!reply.ok) return;
  assert.deepEqual(reply.view.file, { display: "<%APPDATA%\\codaryn\\config.json>", source: "environment", exists: true });
  assert.equal(reply.view.model, "<model-a>");
  assert.equal(reply.view.language, "ko");
  assert.deepEqual(reply.view.profiles[0], {
    name: "<doc>",
    workflowRef: "<organize>",
    provider: null,
    limits: [
      ["maxModelTurns", 5],
      ["maxTotalTokens", null],
    ],
    commands: ["<node?>"],
    verifiers: 1,
    protectedPaths: 2,
    // U-247 (R-111): its own policy (it takes the config's place in a quick run) and its unreadable paths.
    hasPolicy: true,
    unreadablePaths: 0,
  });
  // A profile name that is an object key of every object does not reach into the prototype.
  assert.deepEqual(reply.view.profiles[1], { name: "<__proto__>", workflowRef: null, provider: null, limits: [], commands: [], verifiers: 0, protectedPaths: 0, hasPolicy: false, unreadablePaths: 0 });
  assert.deepEqual(reply.view.workflows, { builtin: ["<code>", "<document>"], config: ["<mine>"] });
  assert.deepEqual(reply.view.providers, ["anthropic"]);
  assert.deepEqual(reply.view.env, ENV);
  assert.equal(reply.view.keyAvailable, true);
});

test("settings (GU-6): arguments are checked before the app is called; errors travel as codes only", async () => {
  const { call, calls } = host({});
  assert.deepEqual(await call(1, "settings", { configPath: "C:\\x.json" }), { channelError: "invalid_args" });
  assert.deepEqual(await call(2, "listModels", { provider: "other" }), { channelError: "invalid_args" });
  assert.deepEqual(await call(3, "listModels", { provider: "anthropic", configPath: "C:\\x.json" }), { channelError: "invalid_args" });
  assert.deepEqual(await call(4, "selectModel", { provider: "anthropic", model: "two words" }), { channelError: "invalid_args" });
  assert.deepEqual(await call(5, "selectModel", { provider: "anthropic" }), { channelError: "invalid_args" });
  assert.equal(calls.length, 0, "no refused call reached the app");
  assert.deepEqual(await call(6, "listModels", { provider: "anthropic" }), { ok: false, code: "missing_api_key" });
  assert.deepEqual(calls, [{ provider: "anthropic", configPath: null, varsFile: null }]);
  const chosen = await call(7, "selectModel", { provider: "anthropic", model: "model-b" });
  assert.deepEqual(calls[1], { provider: "anthropic", configPath: null, varsFile: null, model: "model-b" });
  assert.deepEqual(toSelectModelReply(chosen), { ok: true, selected: { id: "<model-b>", created: false, overridden: true } });
});

test("settings (GU-6): a listed model keeps its exact id for the main process and a cleaned one for the window", async () => {
  const { call } = host({
    listModels: async () => ({
      ok: true,
      output: {
        models: [
          { number: 1, id: "model-a", displayName: "Model\u0007A", createdAt: null, maxInputTokens: null },
          { number: 2, id: "has space", displayName: "Bad", createdAt: null, maxInputTokens: null },
        ],
        current: { id: "model-a", source: "config", listed: true },
      },
    }),
  });
  const value = await call(1, "listModels", { provider: "anthropic" });
  // The host passes both entries; the main process refuses an id that no API would give.
  assert.equal(toHostModelList(value).ok, false);
  const one = { ...(value as Record<string, unknown>), models: [(value as { models: unknown[] }).models[0]] };
  assert.deepEqual(toHostModelList(one), {
    ok: true,
    provider: "anthropic",
    models: [{ number: 1, id: "model-a", shown: "<model-a>", name: "<Model?A>" }],
    current: { id: "<model-a>", source: "config", listed: true },
  });
});

test("settings (GU-6): a model is chosen by an entry id of the last list only", () => {
  let n = 0;
  const entries = new ModelEntries((size) => Uint8Array.from({ length: size }, () => n++ & 0xff));
  const first = entries.issue("anthropic", [{ number: 1, id: "model-a", shown: "<model-a>", name: "A" }]);
  assert.equal(first.length, 1);
  const entry = first[0]!.entry;
  assert.match(entry, /^[0-9a-f]{32}$/);
  assert.deepEqual(first[0], { entry, number: 1, id: "<model-a>", name: "A" });
  assert.deepEqual(entries.resolve(entry), { provider: "anthropic", id: "model-a" });
  entries.issue("anthropic", [{ number: 1, id: "model-b", shown: "<model-b>", name: "B" }]);
  assert.equal(entries.resolve(entry), null, "a new list makes the old entry ids stop working");
  assert.deepEqual(parseEntryArgs({ entry }), { entry });
  assert.equal(parseEntryArgs({ entry: "model-a" }), null, "a model id is no entry id");
  assert.equal(parseEntryArgs({ entry, model: "x" }), null);
  assert.deepEqual(parseProviderArgs({ provider: "anthropic" }), { provider: "anthropic" });
  assert.equal(parseProviderArgs({ provider: "Anthropic API" }), null);
});

test("settings (GU-6): the main process refuses a settings value that does not fit", () => {
  const good = { ok: true, view: { file: null, model: null, language: null, profiles: [], workflows: { builtin: [], config: [] }, keyAvailable: false, providers: [] } };
  assert.equal(toSettingsView(good, ENV).ok, true);
  for (const bad of [
    { ...good, view: { ...good.view, file: { display: "x", source: "elsewhere", exists: true } } },
    { ...good, view: { ...good.view, keyAvailable: "yes" } },
    { ...good, view: { ...good.view, providers: ["Bad Name"] } },
    { ...good, view: { ...good.view, profiles: [{ name: "p", workflowRef: null, limits: [["max turns", 1]], commands: [], verifiers: 0, protectedPaths: 0 }] } },
    { ...good, view: { ...good.view, model: "x".repeat(5000) } },
  ]) {
    assert.deepEqual(toSettingsView(bad, ENV), { ok: false, code: "host_error" });
  }
  assert.deepEqual(toSettingsView({ ok: false, code: "invalid_config" }, ENV), { ok: false, code: "invalid_config" });
  assert.deepEqual(toSettingsView({ ok: false, code: "Not A Code" }, ENV), { ok: false, code: "host_error" });
});
