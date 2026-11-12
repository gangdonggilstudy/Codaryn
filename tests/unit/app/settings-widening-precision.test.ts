/**
 * Review R-27 I1 and I4 on the widening judgment of a settings change.
 * - I1: a change whose requests still go to the same address asked for a confirmation: naming the
 *   provider's default address, or moving the top-level address into providers.anthropic unchanged.
 *   The judgment now compares each provider's address as a run reads it (providerSettingsOf, the
 *   provider's default when none is set), as src/cli/settings.ts resolveConnection does.
 * - I4: a profile that sends its quick runs to another provider was only `profile_changed`; now it
 *   is also `provider_changed` at `profiles.<name>.provider`.
 * Reproduced first. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { API_PROVIDERS } from "../../../src/contracts/index.js";
import type { CodarynConfig } from "../../../src/contracts/index.js";
import { wideningOf } from "../../../src/app/index.js";

const BASE: CodarynConfig = { schemaVersion: 1, model: "fake-model-a", maxOutputTokens: 64 };
const kinds = (before: CodarynConfig, after: CodarynConfig): string[] => wideningOf(before, after).map((item) => `${item.kind} ${item.field}`);

describe("R-27 I1: the same address is not a widening", () => {
  test("naming a provider's default address", () => {
    assert.deepEqual(kinds(BASE, { ...BASE, apiBaseUrl: API_PROVIDERS.anthropic.defaultApiBaseUrl }), []);
    const openai: CodarynConfig = { ...BASE, providers: { openai: { model: "gpt-fake" } } };
    assert.deepEqual(kinds(openai, { ...BASE, providers: { openai: { model: "gpt-fake", apiBaseUrl: API_PROVIDERS.openai.defaultApiBaseUrl } } }), []);
  });

  test("moving the top-level address into providers.anthropic unchanged", () => {
    const before: CodarynConfig = { ...BASE, apiBaseUrl: "https://127.0.0.1" };
    const after: CodarynConfig = { schemaVersion: 1, providers: { anthropic: { model: "fake-model-a", maxOutputTokens: 64, apiBaseUrl: "https://127.0.0.1" } } };
    assert.deepEqual(kinds(before, after), []);
  });

  test("a top-level address that runs do not read (providers.anthropic is there)", () => {
    const before: CodarynConfig = { ...BASE, providers: { anthropic: { model: "fake-model-a", apiBaseUrl: "https://127.0.0.1" } } };
    assert.deepEqual(kinds(before, { ...before, apiBaseUrl: "https://127.0.0.2" }), []);
  });

  test("still widening: another address, a custom address back to the default, the default to a custom one", () => {
    assert.deepEqual(kinds(BASE, { ...BASE, apiBaseUrl: "https://127.0.0.1" }), ["api_base_url_changed apiBaseUrl"]);
    assert.deepEqual(kinds({ ...BASE, apiBaseUrl: "https://127.0.0.1" }, BASE), ["api_base_url_changed apiBaseUrl"]);
    assert.deepEqual(kinds({ ...BASE, apiBaseUrl: "https://127.0.0.1" }, { ...BASE, apiBaseUrl: "https://127.0.0.1:8443" }), ["api_base_url_changed apiBaseUrl"]);
    const anthropic = (apiBaseUrl: string): CodarynConfig => ({ ...BASE, providers: { anthropic: { model: "fake-model-a", apiBaseUrl } } });
    assert.deepEqual(kinds(anthropic("https://127.0.0.1"), anthropic("https://127.0.0.2")), ["api_base_url_changed providers.anthropic.apiBaseUrl"]);
    // A providers.anthropic entry without an address: runs stop reading the top-level one and use the default.
    const custom: CodarynConfig = { ...BASE, apiBaseUrl: "https://127.0.0.1" };
    assert.deepEqual(kinds(custom, { ...custom, providers: { anthropic: { model: "fake-model-a" } } }), ["api_base_url_changed apiBaseUrl"]);
  });
});

describe("R-27 I4: a profile's provider", () => {
  test("a profile that now names another provider", () => {
    const before: CodarynConfig = { ...BASE, profiles: { p: { workflowRef: "general" } } };
    const after: CodarynConfig = { ...BASE, profiles: { p: { workflowRef: "general", provider: "openai" } } };
    assert.deepEqual(kinds(before, after), ["profile_changed profiles", "provider_changed profiles.p.provider"]);
  });

  test("a new profile that names another provider than quick runs use", () => {
    assert.deepEqual(kinds(BASE, { ...BASE, profiles: { q: { provider: "openai" } } }), ["profile_changed profiles", "provider_changed profiles.q.provider"]);
    assert.deepEqual(kinds(BASE, { ...BASE, profiles: { q: { provider: "anthropic" } } }), ["profile_changed profiles"], "the same provider");
  });

  test("a profile that keeps its provider while the config's changes is not named again", () => {
    const before: CodarynConfig = { ...BASE, profiles: { p: { provider: "anthropic" } } };
    assert.deepEqual(kinds(before, { ...before, provider: "openai" }), ["provider_changed provider"]);
  });
});
