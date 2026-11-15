/**
 * U-93 (review R-73, U-80 L1, I2): the output cap's range is the contract's (MAX_OUTPUT_TOKENS_LIMIT,
 * 200,000), in the edit check and on the screen; a value out of range or an empty field says
 * bad_number, as the limits do, instead of nothing or the config file's error; removing a cap leaves
 * no empty provider entry (and no empty `providers`).
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { MAX_OUTPUT_CAP as SCREEN_MAX, settingsScreen } from "../../src/renderer/settings/settings.js";
import { MAX_OUTPUT_CAP, applySettingsEdit, parseSettingsEdit } from "../../src/shared/settings-edit.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const CONTRACTS = path.join(GUI, "..", "dist", "src", "contracts", "index.js");
const same = (text: string): string => text;

test("U-93: the window's largest output cap is the contract's", { skip: !existsSync(CONTRACTS) && "the engine is not built" }, async () => {
  const contracts = (await import(pathToFileURL(CONTRACTS).href)) as { MAX_OUTPUT_TOKENS_LIMIT: number };
  assert.equal(MAX_OUTPUT_CAP, contracts.MAX_OUTPUT_TOKENS_LIMIT);
  assert.equal(SCREEN_MAX, contracts.MAX_OUTPUT_TOKENS_LIMIT);
  assert.deepEqual(parseSettingsEdit({ op: "outputCap", provider: "openai", value: MAX_OUTPUT_CAP }), { op: "outputCap", provider: "openai", value: MAX_OUTPUT_CAP });
  assert.equal(parseSettingsEdit({ op: "outputCap", provider: "openai", value: MAX_OUTPUT_CAP + 1 }), null, "past the contract: refused before the app layer");
});

test("U-93: removing a cap leaves no empty entry, and no entry is made for it", () => {
  const removed = (config: unknown, provider: string): unknown => {
    const outcome = applySettingsEdit(config, { op: "outputCap", provider, value: null }, same);
    assert.ok(outcome.ok, JSON.stringify(outcome));
    return outcome.ok ? outcome.next : null;
  };
  assert.deepEqual(removed({ schemaVersion: 1, providers: { openai: { maxOutputTokens: 9 } } }, "openai"), { schemaVersion: 1 }, "the entry and providers go");
  assert.deepEqual(removed({ schemaVersion: 1, providers: { openai: { maxOutputTokens: 9 }, anthropic: { model: "m" } } }, "openai"), { schemaVersion: 1, providers: { anthropic: { model: "m" } } });
  assert.deepEqual(removed({ schemaVersion: 1, providers: { openai: { model: "g", maxOutputTokens: 9 } } }, "openai"), { schemaVersion: 1, providers: { openai: { model: "g" } } }, "an entry with other fields stays");
  assert.deepEqual(removed({ schemaVersion: 1 }, "openai"), { schemaVersion: 1 }, "R-73 I2: no providers: {openai: {}}");
  assert.deepEqual(removed({ schemaVersion: 1, providers: { anthropic: { model: "m" } } }, "openai"), { schemaVersion: 1, providers: { anthropic: { model: "m" } } });
  assert.deepEqual(removed({ schemaVersion: 1, maxOutputTokens: 5 }, "anthropic"), { schemaVersion: 1 }, "anthropic's top-level");
});

test("U-93: the screen's input takes 1 to 200,000 and says bad_number otherwise", async () => {
  const restore = installFakeDom();
  try {
    const edits: unknown[] = [];
    const view = {
      file: { display: "~/config.json", source: "default", exists: true },
      model: "m",
      language: null,
      profiles: [],
      workflows: { builtin: [], config: [] },
      keyAvailable: true,
      providers: ["anthropic", "openai"],
      env: { model: false, language: false },
      rules: { limits: [], commands: [], protectedPaths: [], secretEnv: [] },
      policyNarrowings: [],
      provider: "openai",
      defaultProvider: "anthropic",
      apiProviders: [{ name: "openai", keyEnv: "OPENAI_API_KEY", keySet: true, modelEnv: "CODARYN_OPENAI_MODEL", modelEnvSet: false, model: "g", outputCap: null, baseUrlEnv: null, baseUrlEnvSet: false, listable: true }],
    };
    const api = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => async (arg: unknown) => {
        if (name === "settings") return { ok: true, view };
        if (name === "proposeSettings") {
          edits.push(arg);
          return { ok: true, token: "e".repeat(32), changes: [], widening: [] };
        }
        return null;
      },
    });
    const screen = settingsScreen({ texts: textsFor("en"), api, language: "en", announce: () => undefined });
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    const input = root.findAll((e) => e.getAttribute("id") === "settings-output-cap-openai")[0] as FakeElement;
    assert.equal(input.getAttribute("max"), "200000");
    const set = root.findAll((e) => e.getAttribute("data-output-cap-set") === "openai")[0] as FakeElement;
    const proposal = () => root.findAll((e) => e.getAttribute("id") === "settings-proposal")[0];
    for (const value of ["", "0", "200001", "1.5", "lots"]) {
      input.value = value;
      set.click();
      await settle();
      assert.equal(proposal()?.getAttribute("data-proposal"), "bad_number", JSON.stringify(value));
    }
    assert.deepEqual(edits, [], "nothing proposed for a value out of range");
    input.value = "200000";
    set.click();
    await settle();
    assert.deepEqual(edits, [{ op: "outputCap", provider: "openai", value: 200000 }]);
  } finally {
    restore();
  }
});
