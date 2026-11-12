/**
 * GUI report F-3: a settings change that makes a quick run use another provider, or sends a
 * provider's requests (and its key) to another address, widens where the workspace's text and the
 * key go. It needs the person's confirmation like a top-level apiBaseUrl change. Reproduced first:
 * `provider` and `providers.<name>.apiBaseUrl` were not judged at all. Fake values only.
 */

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import type { CodarynConfig } from "../../../src/contracts/index.js";
import { createCodarynApp, wideningOf } from "../../../src/app/index.js";
import type { AppCallOutcome, SettingsChangeProposal, SettingsWritten } from "../../../src/app/index.js";
import { appEnvironment, tempDir } from "./support.js";

const BASE: CodarynConfig = { schemaVersion: 1, model: "fake-model-a", maxOutputTokens: 64 };
const OPENAI = { providers: { openai: { model: "gpt-fake", maxOutputTokens: 64 } } } as const;
const kinds = (before: CodarynConfig, after: CodarynConfig): string[] => wideningOf(before, after).map((item) => `${item.kind} ${item.field}`);

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}

describe("F-3: the provider and its address are widening changes", () => {
  test("another quick-run provider", () => {
    assert.deepEqual(kinds({ ...BASE, ...OPENAI }, { ...BASE, ...OPENAI, provider: "openai" }), ["provider_changed provider"]);
    assert.deepEqual(kinds({ ...BASE, ...OPENAI, provider: "openai" }, { ...BASE, ...OPENAI }), ["provider_changed provider"], "back to the default anthropic");
    assert.deepEqual(kinds(BASE, { ...BASE, provider: "anthropic" }), [], "naming the provider already used changes nothing");
  });

  test("another address of a provider, wherever the config keeps it", () => {
    const openai = (apiBaseUrl?: string): CodarynConfig => ({ ...BASE, providers: { openai: { model: "gpt-fake", ...(apiBaseUrl === undefined ? {} : { apiBaseUrl }) } } });
    assert.deepEqual(kinds(openai(), openai("https://127.0.0.1/v1")), ["api_base_url_changed providers.openai.apiBaseUrl"], "added");
    assert.deepEqual(kinds(openai("https://127.0.0.1/v1"), openai("https://127.0.0.2/v1")), ["api_base_url_changed providers.openai.apiBaseUrl"], "changed");
    assert.deepEqual(kinds(openai("https://127.0.0.1/v1"), openai()), ["api_base_url_changed providers.openai.apiBaseUrl"], "removed: back to the default address");
    const anthropic = (apiBaseUrl: string): CodarynConfig => ({ ...BASE, providers: { anthropic: { model: "fake-model-a", apiBaseUrl } } });
    assert.deepEqual(kinds(anthropic("https://127.0.0.1"), anthropic("https://127.0.0.2")), ["api_base_url_changed providers.anthropic.apiBaseUrl"]);
    assert.deepEqual(kinds(BASE, { ...BASE, apiBaseUrl: "https://127.0.0.1" }), ["api_base_url_changed apiBaseUrl"], "the top-level address, as before");
  });

  test("a model or an output cap of a provider is not a widening", () => {
    assert.deepEqual(kinds({ ...BASE, ...OPENAI }, { ...BASE, providers: { openai: { model: "gpt-other", maxOutputTokens: 32 } } }), []);
  });

  test("apply refuses a provider change the person did not confirm, and writes it once confirmed", async () => {
    const base = await tempDir("codaryn-unit-app-provider-widening-");
    const config = path.join(base, "config.json");
    await writeFile(config, `${JSON.stringify({ ...BASE, ...OPENAI }, null, 2)}\n`, "utf8");
    const before = await readFile(config, "utf8");
    const app = createCodarynApp(await appEnvironment(base));
    const next = { ...BASE, ...OPENAI, provider: "openai" };
    const proposal = ok<SettingsChangeProposal>(await app.proposeSettingsChange({ configPath: config, next }));
    assert.deepEqual(proposal.widening, [{ kind: "provider_changed", field: "provider" }]);
    const refused = await app.applySettingsChange({ configPath: config, next, baseDigest: proposal.baseDigest, confirmWidening: false });
    assert.equal(refused.ok ? null : refused.error.code, "invalid_arguments");
    assert.equal(await readFile(config, "utf8"), before, "nothing written");
    const written = ok<SettingsWritten>(await app.applySettingsChange({ configPath: config, next, baseDigest: proposal.baseDigest, confirmWidening: true }));
    assert.equal(written.written, true);
    assert.equal((JSON.parse(await readFile(config, "utf8")) as { provider?: string }).provider, "openai");
  });
});
