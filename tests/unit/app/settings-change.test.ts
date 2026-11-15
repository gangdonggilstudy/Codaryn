/**
 * The GUI's settings change through the app layer (standalone-gui 3.6, UX 7, M-9): propose writes
 * nothing; apply writes only the proposed file, only widening that a person confirmed, and never
 * over a change made in between. Fake values only; the key value is not key-shaped.
 */

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV } from "../../../src/contracts/index.js";
import type { CodarynConfig } from "../../../src/contracts/index.js";
import { createCodarynApp, wideningOf } from "../../../src/app/index.js";
import type { AppCallOutcome, CodarynApp, SettingsChangeProposal, SettingsWritten } from "../../../src/app/index.js";
import { appEnvironment, tempDir } from "./support.js";

const FAKE_KEY = "fake-change-key-value-0097";
const NPM_TEST = { executable: "npm", argsPrefix: ["test"], allowExtraArgs: false };

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}

function code<T>(outcome: AppCallOutcome<T>): string | null {
  return outcome.ok ? null : outcome.error.code;
}

/** A config file made by createSettings (init's defaults), and the app on it. */
async function setup(): Promise<{ app: CodarynApp; config: string; current: () => Promise<Record<string, unknown>> }> {
  const base = await tempDir("codaryn-unit-app-change-");
  const config = path.join(base, "config.json");
  const app = createCodarynApp(await appEnvironment(base, { env: { [ANTHROPIC_API_KEY_ENV]: FAKE_KEY } }));
  assert.equal(ok(await app.createSettings({ configPath: config, workspace: null })).status, "created");
  return { app, config, current: async () => JSON.parse(await readFile(config, "utf8")) as Record<string, unknown> };
}

describe("proposeSettingsChange and applySettingsChange", () => {
  test("a widening change: proposed without writing, refused unconfirmed, written once confirmed", async () => {
    const { app, config, current } = await setup();
    const before = await readFile(config, "utf8");
    const base = await current();
    const next = { ...base, language: "ko", policy: { ...(base["policy"] as object), commands: [NPM_TEST], protectedPaths: ["tests"] } };

    const proposal = ok<SettingsChangeProposal>(await app.proposeSettingsChange({ configPath: config, next }));
    assert.deepEqual(
      proposal.changes.map((change) => `${change.field}:${change.change}`).sort(),
      ["language:added", "policy.commands:changed", "policy.protectedPaths:added"],
    );
    assert.deepEqual(proposal.widening, [{ kind: "command_added", field: "policy.commands[0]" }]);
    assert.equal(await readFile(config, "utf8"), before, "propose writes nothing");

    const unconfirmed = await app.applySettingsChange({ configPath: config, next, baseDigest: proposal.baseDigest, confirmWidening: false });
    assert.equal(code(unconfirmed), "invalid_arguments");
    assert.equal(await readFile(config, "utf8"), before);

    const written = ok<SettingsWritten>(await app.applySettingsChange({ configPath: config, next, baseDigest: proposal.baseDigest, confirmWidening: true }));
    assert.deepEqual([written.written, written.digest], [true, proposal.digest]);
    const read = ok(await app.readSettings({ configPath: config }));
    assert.deepEqual([read.config?.language, read.config?.policy?.commands, read.config?.policy?.protectedPaths], ["ko", [NPM_TEST], ["tests"]]);
  });

  test("a narrowing change needs no confirmation; an unchanged config writes nothing", async () => {
    const { app, config, current } = await setup();
    const base = await current();
    const limits = base["limits"] as Record<string, number>;
    const next = { ...base, limits: { ...limits, maxModelTurns: (limits["maxModelTurns"] ?? 2) - 1 }, secretEnv: ["CODARYN_APP_SECRET"] };
    const proposal = ok<SettingsChangeProposal>(await app.proposeSettingsChange({ configPath: config, next }));
    assert.deepEqual(proposal.widening, []);
    ok(await app.applySettingsChange({ configPath: config, next, baseDigest: proposal.baseDigest, confirmWidening: false }));
    assert.equal((await current())["secretEnv"] !== undefined, true);

    const again = await current();
    const unchanged = ok<SettingsChangeProposal>(await app.proposeSettingsChange({ configPath: config, next: again }));
    const result = ok<SettingsWritten>(await app.applySettingsChange({ configPath: config, next: again, baseDigest: unchanged.baseDigest, confirmWidening: false }));
    assert.deepEqual([result.written, result.changes], [false, []]);
  });

  test("a file changed after the proposal is never overwritten", async () => {
    const { app, config, current } = await setup();
    const next = { ...(await current()), language: "en" };
    const proposal = ok<SettingsChangeProposal>(await app.proposeSettingsChange({ configPath: config, next }));
    const edited = `${JSON.stringify({ ...(await current()), model: "fake-model-edited" }, null, 2)}\n`;
    await writeFile(config, edited, "utf8");
    const refused = await app.applySettingsChange({ configPath: config, next, baseDigest: proposal.baseDigest, confirmWidening: true });
    assert.equal(code(refused), "config_write_failed");
    assert.equal(await readFile(config, "utf8"), edited, "the other edit stays");
  });

  test("the new config gets the checks a file read from disk gets, and never echoes a value", async () => {
    const { app, config, current } = await setup();
    const base = await current();
    const keyed = await app.proposeSettingsChange({ configPath: config, next: { ...base, model: FAKE_KEY } });
    assert.equal(code(keyed), "key_in_file");
    assert.equal(JSON.stringify(keyed).includes(FAKE_KEY), false);

    const unknown = await app.proposeSettingsChange({ configPath: config, next: { ...base, modle: "x-value-not-echoed" } });
    assert.ok(!unknown.ok);
    assert.deepEqual([unknown.error.code, unknown.error.diagnostic?.code], ["invalid_config", "unknown_field"]);
    assert.equal(JSON.stringify(unknown).includes("x-value-not-echoed"), false);

    assert.equal(code(await app.proposeSettingsChange({ configPath: config, next: { ...base, big: 1n } })), "invalid_config");
    assert.equal(code(await app.proposeSettingsChange({ configPath: path.join(path.dirname(config), "absent.json"), next: base })), "invalid_config");
  });
});

describe("wideningOf", () => {
  const policy = { commands: [NPM_TEST], network: "deny", destructive: "deny", restorePathTokens: false, protectedPaths: ["tests"] } as const;
  const before = {
    schemaVersion: 1,
    apiBaseUrl: "https://api.example.invalid",
    limits: { maxModelTurns: 5, maxToolCalls: 10, maxTotalTokens: 1000, maxDurationMs: 60_000 },
    policy,
    verifiers: [{ id: "v", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] }],
    secretEnv: ["A_SECRET"],
    integrity: { paths: ["C:\\guard"] },
  } as unknown as CodarynConfig;
  const kinds = (after: object) => wideningOf(before, { ...before, ...after } as CodarynConfig).map((item) => `${item.kind}@${item.field}`);

  test("names each kind of widening by field, never by value", () => {
    assert.deepEqual(kinds({}), []);
    assert.deepEqual(kinds({ policy: { ...policy, commands: [NPM_TEST, { ...NPM_TEST, argsPrefix: ["run"], allowExtraArgs: true }] } }), [
      "command_added@policy.commands[1]",
      "extra_args_allowed@policy.commands[1]",
    ]);
    assert.deepEqual(kinds({ limits: { maxModelTurns: 6, maxToolCalls: 10, maxTotalTokens: null } }), [
      "limit_raised@limits.maxModelTurns",
      "limit_raised@limits.maxTotalTokens",
      "limit_raised@limits.maxDurationMs",
    ]);
    assert.deepEqual(kinds({ policy: { ...policy, protectedPaths: [] } }), ["protected_path_removed@policy.protectedPaths"]);
    assert.deepEqual(kinds({ integrity: undefined }), ["integrity_path_removed@integrity.paths"]);
    assert.deepEqual(kinds({ secretEnv: [] }), ["secret_env_removed@secretEnv"]);
    assert.deepEqual(kinds({ verifiers: [] }), ["verifier_removed@verifiers"]);
    assert.deepEqual(kinds({ policy: { ...policy, restorePathTokens: true } }), ["restore_path_tokens_enabled@policy.restorePathTokens"]);
    assert.deepEqual(kinds({ policy: { ...policy, planActions: ["move"] } }), ["plan_action_allowed@policy.planActions"]);
    assert.deepEqual(kinds({ apiBaseUrl: "https://other.example.invalid" }), ["api_base_url_changed@apiBaseUrl"]);
    assert.deepEqual(kinds({ profiles: { doc: {} } }), ["profile_changed@profiles"]);
    assert.deepEqual(kinds({ limits: { maxModelTurns: 4, maxToolCalls: 10, maxTotalTokens: 500, maxDurationMs: 60_000 } }), [], "lower limits narrow");
  });
});
