/**
 * R21-I-3: the provider's API is asked for a model list only when the person presses the button
 * (3.10, Y-2), and never by a test.
 * - The settings screen (src/renderer/settings) with a fake API and a DOM stand-in: showing it asks
 *   nothing; pressing "get the list" asks once.
 * - The main process's limit (src/main/model-entries.ts): one list at a time, a few a minute.
 * - The engine host's test transport (src/engine-host/transport.ts): only this machine is reached.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_LISTS_PER_MINUTE, ModelListLimit } from "../../src/main/model-entries.js";
import { isLoopbackUrl, loopbackOnlyFetch } from "../../src/engine-host/transport.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { settingsScreen } from "../../src/renderer/settings/settings.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const VIEW = {
  ok: true,
  view: {
    file: { display: "CODARYN_CONFIG", source: "environment", exists: true },
    model: "model-a",
    language: null,
    profiles: [],
    workflows: { builtin: ["code"], config: [] },
    keyAvailable: true,
    providers: ["anthropic"],
    env: { model: false, language: false },
  },
};

function fakeApi(calls: string[]): CodarynApi {
  const record =
    (name: string, value: unknown = { ok: false, code: "not_used" }) =>
    async (...args: unknown[]): Promise<unknown> => {
      calls.push(`${name}(${args.map((arg) => JSON.stringify(arg)).join(",")})`);
      return value;
    };
  return new Proxy({} as CodarynApi, {
    get(_target, name: string) {
      if (name === "settings") return record("settings", VIEW);
      if (name === "listModels") return record("listModels", { ok: true, provider: "anthropic", models: [], current: null });
      return record(name);
    },
  });
}

test("model list (R21-I-3): the settings screen asks for the list only when the person presses the button", async () => {
  const restore = installFakeDom();
  try {
    const calls: string[] = [];
    const screen = settingsScreen({ texts: textsFor("en"), api: fakeApi(calls), language: "en", announce: () => undefined });
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    await settle();
    assert.deepEqual(calls, ["settings()"], "showing the screen reads the settings and asks no API");
    // Shown again (the screen is rebuilt): still no list.
    screen.show(root as unknown as HTMLElement);
    await settle();
    assert.equal(calls.filter((call) => call.startsWith("listModels")).length, 0);
    const buttons = root.findAll((element) => element.getAttribute("data-list-models") !== null);
    assert.equal(buttons.length, 1, "one button per provider");
    buttons[0]?.click();
    await settle();
    assert.deepEqual(calls.filter((call) => call.startsWith("listModels")), ['listModels("anthropic")']);
  } finally {
    restore();
  }
});

test("model list (R21-I-3): the main process lets one list run at a time and a few a minute", () => {
  let now = 0;
  const limit = new ModelListLimit(() => now);
  assert.equal(limit.begin(), true);
  assert.equal(limit.begin(), false, "not while one goes on");
  limit.end();
  for (let i = 1; i < MAX_LISTS_PER_MINUTE; i += 1) {
    assert.equal(limit.begin(), true);
    limit.end();
  }
  assert.equal(limit.begin(), false, "no more within the minute");
  now += 60_000;
  assert.equal(limit.begin(), true, "again after a minute");
});

test("model list (R21-I-3): the test transport passes requests to this machine and refuses anything else unsent", async () => {
  const sent: string[] = [];
  let refused = 0;
  const real = (async (input: Parameters<typeof fetch>[0]) => {
    sent.push(String(input));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const guarded = loopbackOnlyFetch(real, () => (refused += 1));
  for (const url of ["http://127.0.0.1:4100/v1/models", "http://localhost:9/v1/messages", "http://[::1]:80/x"]) {
    assert.equal((await guarded(url)).status, 200, url);
  }
  for (const url of ["https://api.anthropic.com/v1/models", "https://api.openai.com/v1/models", "http://192.0.2.1/", "http://127.0.0.1.example.invalid/", "not a url"]) {
    await assert.rejects(guarded(url), TypeError, url);
  }
  assert.deepEqual(sent, ["http://127.0.0.1:4100/v1/models", "http://localhost:9/v1/messages", "http://[::1]:80/x"]);
  assert.equal(refused, 5);
  assert.equal(isLoopbackUrl(new URL("http://127.0.0.1/").href), true);
  assert.equal(await guarded(new Request("https://api.anthropic.com/v1/models")).catch(() => "refused"), "refused");
});
