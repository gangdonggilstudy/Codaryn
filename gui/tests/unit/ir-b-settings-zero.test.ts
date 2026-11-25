/**
 * IR-B4 (improvement review B): the engine takes `maxRepairAttempts: 0` (no repair; its lowest value is 0
 * and every other limit's is 1, src/app/input/security/limits.ts MINIMUM; docs/usage.md 6절 "0 이상, 기본 0"),
 * so the settings screen and the shared edit check take 0 for that field only. A negative or broken
 * value is still refused, and every other limit still needs 1 or more.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodarynApi } from "../../src/renderer/api.js";
import { errorText, textsFor } from "../../src/renderer/i18n/catalog.js";
import { settingsScreen } from "../../src/renderer/settings/settings.js";
import { LIMIT_KEYS, applySettingsEdit, parseSettingsEdit } from "../../src/shared/settings-edit.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const same = (text: string): string => text;
const OTHERS = LIMIT_KEYS.filter((key) => key !== "maxRepairAttempts");

test("IR-B4: the edit check takes maxRepairAttempts 0, and refuses below 0 and 0 for every other limit", () => {
  assert.deepEqual(parseSettingsEdit({ op: "limit", key: "maxRepairAttempts", value: 0 }), { op: "limit", key: "maxRepairAttempts", value: 0 });
  assert.deepEqual(parseSettingsEdit({ op: "limit", key: "maxRepairAttempts", value: 1 }), { op: "limit", key: "maxRepairAttempts", value: 1 });
  for (const value of [-1, 0.5, -0.5, Number.NaN]) {
    assert.equal(parseSettingsEdit({ op: "limit", key: "maxRepairAttempts", value }), null, `maxRepairAttempts ${value}`);
  }
  assert.equal(OTHERS.length, 5);
  for (const key of OTHERS) {
    assert.equal(parseSettingsEdit({ op: "limit", key, value: 0 }), null, `${key} 0 is still refused`);
    assert.deepEqual(parseSettingsEdit({ op: "limit", key, value: 1 }), { op: "limit", key, value: 1 }, `${key} 1 is still taken`);
  }
});

test("IR-B4: a 0 repair limit is written as 0, not dropped", () => {
  const outcome = applySettingsEdit({ schemaVersion: 1 }, { op: "limit", key: "maxRepairAttempts", value: 0 }, same);
  assert.ok(outcome.ok, JSON.stringify(outcome));
  assert.deepEqual(outcome.ok ? outcome.next : null, { schemaVersion: 1, limits: { maxRepairAttempts: 0 } });
});

test("IR-B4: both catalogs have the 0-or-more words under the same id", () => {
  for (const language of ["en", "ko"] as const) {
    const texts = textsFor(language);
    assert.equal(texts.has("error.bad_repair_number"), true, `${language}: error.bad_repair_number`);
    const words = errorText(texts, "bad_repair_number");
    assert.notEqual(words, texts.format("error.default"), `${language}: its own words, not the default`);
    assert.match(words, /0/, `${language}: names 0`);
    assert.match(errorText(texts, "bad_number"), /1/, `${language}: bad_number still names 1`);
  }
});

test("IR-B4: the screen's repair limit input takes 0, says bad_repair_number below it, and the others keep 1", async () => {
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
      // The same view as u93-output-cap-range.test.ts, which this screen is known to render.
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
    const byId = (id: string): FakeElement => root.findAll((e) => e.getAttribute("id") === id)[0] as FakeElement;
    const setOf = (key: string): FakeElement => root.findAll((e) => e.getAttribute("data-limit-set") === key)[0] as FakeElement;
    const proposal = (): string | null => byId("settings-proposal").getAttribute("data-proposal");

    assert.equal(byId("settings-limit-maxRepairAttempts").getAttribute("min"), "0");
    for (const key of OTHERS) assert.equal(byId(`settings-limit-${key}`).getAttribute("min"), "1", key);

    const repair = byId("settings-limit-maxRepairAttempts");
    for (const value of ["", "-1", "1.5", "lots"]) {
      repair.value = value;
      setOf("maxRepairAttempts").click();
      await settle();
      assert.equal(proposal(), "bad_repair_number", JSON.stringify(value));
    }
    const tools = byId("settings-limit-maxToolCalls");
    tools.value = "0";
    setOf("maxToolCalls").click();
    await settle();
    assert.equal(proposal(), "bad_number", "another limit at 0 is still refused");
    assert.deepEqual(edits, [], "nothing proposed for a refused value");

    repair.value = "0";
    setOf("maxRepairAttempts").click();
    await settle();
    assert.deepEqual(edits, [{ op: "limit", key: "maxRepairAttempts", value: 0 }], "0 is proposed");
  } finally {
    restore();
  }
});
