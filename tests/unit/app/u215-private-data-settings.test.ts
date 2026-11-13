/**
 * Unit U-215 (DR-69 bundle A, the app layer's part before the parser, na-core's U-210): what the
 * settings screen needs to show and change the config's unreadable paths and group size k.
 * - readSettings gives `privateData`: the config's `policy.unreadablePaths` in the file's order, and
 *   k as the config sets it (null when it does not), what a run gets from it alone (never below 5,
 *   effectiveMinGroupSize) and the values a source may set (MIN_GROUP_SIZE_LIMITS), so the window
 *   needs no copy of the contract's numbers.
 * - The GUI changes them as it changes protected paths (an edit applied to the config, then
 *   proposeSettingsChange with the whole new config). The proposal judges them with U-204's
 *   wideningOf: adding an entry or raising k narrows and is written without a question; taking an
 *   entry away or lowering k widens and is written only once the person confirmed it.
 * - The parsers refuse both fields until U-210, so the cases that read or write a config file that
 *   holds them are todo until then; privateDataOf is tested on configs built here.
 * Reproduced first (1ff75f3, todo until the view gave them). Temporary folders, fake values only.
 */

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import * as appModule from "../../../src/app/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, CodarynApp, SettingsChangeProposal, SettingsWritten } from "../../../src/app/index.js";
import { ANTHROPIC_API_KEY_ENV } from "../../../src/contracts/index.js";
import type { CodarynConfig } from "../../../src/contracts/index.js";
import { appEnvironment, tempDir } from "./support.js";

const TODO_PARSER = { todo: "U-210: the config parser refuses unreadablePaths and minGroupSize until then" };
const FAKE_KEY = "fake-private-key-value-0215";

type PrivateData = {
  readonly unreadablePaths: readonly string[];
  readonly minGroupSize: { readonly configured: number | null; readonly effective: number; readonly min: number; readonly max: number };
};
const NONE: PrivateData = { unreadablePaths: [], minGroupSize: { configured: null, effective: 5, min: 5, max: 1000 } };

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}
const code = <T>(outcome: AppCallOutcome<T>): string | null => (outcome.ok ? null : outcome.error.code);
const privateDataIn = (view: unknown): PrivateData | undefined => (view as { privateData?: PrivateData }).privateData;
const privateDataOf = (config: CodarynConfig | null): PrivateData => {
  const of = (appModule as unknown as Record<string, unknown>)["privateDataOf"] as ((config: CodarynConfig | null) => PrivateData) | undefined;
  assert.equal(typeof of, "function", "the app layer gives privateDataOf");
  return of!(config);
};

/** A config file made by createSettings (init's defaults), and the app on it. */
async function setup(): Promise<{ app: CodarynApp; config: string; current: () => Promise<Record<string, unknown>> }> {
  const base = await tempDir("codaryn-unit-app-u215-");
  const config = path.join(base, "config.json");
  const app = createCodarynApp(await appEnvironment(base, { env: { [ANTHROPIC_API_KEY_ENV]: FAKE_KEY } }));
  assert.equal(ok(await app.createSettings({ configPath: config, workspace: null })).status, "created");
  return { app, config, current: async () => JSON.parse(await readFile(config, "utf8")) as Record<string, unknown> };
}
/** The config `base` with `extra` in its policy. */
const withPolicy = (base: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> => ({ ...base, policy: { ...(base["policy"] as object), ...extra } });
const widening = (proposal: SettingsChangeProposal): string[] => proposal.widening.map((item) => `${item.kind} ${item.field}`);

describe("U-215: readSettings gives the private data settings", () => {
  test("a config without them: no unreadable path, k 5 from no value, the values k may take", async () => {
    const { app, config } = await setup();
    assert.deepEqual(privateDataIn(ok(await app.readSettings({ configPath: config }))), NONE);
  });

  test("privateDataOf: the config's list in its order and k; a value below 5 gives 5; no config gives none", () => {
    const config = (policy: Record<string, unknown>): CodarynConfig =>
      ({ schemaVersion: 1, model: "fake-model-a", maxOutputTokens: 64, policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, ...policy } }) as unknown as CodarynConfig;
    assert.deepEqual(privateDataOf(config({ unreadablePaths: ["hr", "data/private"], minGroupSize: 8 })), {
      unreadablePaths: ["hr", "data/private"],
      minGroupSize: { configured: 8, effective: 8, min: 5, max: 1000 },
    });
    assert.deepEqual(privateDataOf(config({ minGroupSize: 3 })), { unreadablePaths: [], minGroupSize: { configured: 3, effective: 5, min: 5, max: 1000 } }, "the parsers refuse 3; a run would have 5");
    assert.deepEqual(privateDataOf(config({})), NONE);
    assert.deepEqual(privateDataOf({ schemaVersion: 1, model: "fake-model-a", maxOutputTokens: 64 } as unknown as CodarynConfig), NONE, "no policy");
    assert.deepEqual(privateDataOf(null), NONE);
  });

  test("a config file that holds them: shown as written", TODO_PARSER, async () => {
    const { app, config, current } = await setup();
    await writeFile(config, `${JSON.stringify(withPolicy(await current(), { unreadablePaths: ["data/private", "hr"], minGroupSize: 10 }), null, 2)}\n`);
    assert.deepEqual(privateDataIn(ok(await app.readSettings({ configPath: config }))), {
      unreadablePaths: ["data/private", "hr"],
      minGroupSize: { configured: 10, effective: 10, min: 5, max: 1000 },
    });
  });
});

describe("U-215: changing them through a proposal", () => {
  test("adding an unreadable path and raising k narrow: no question, written", TODO_PARSER, async () => {
    const { app, config, current } = await setup();
    const next = withPolicy(await current(), { unreadablePaths: ["data/private"], minGroupSize: 10 });
    const proposal = ok<SettingsChangeProposal>(await app.proposeSettingsChange({ configPath: config, next }));
    assert.deepEqual(widening(proposal), []);
    assert.deepEqual(proposal.changes.map((change) => `${change.field}:${change.change}`).sort(), ["policy.minGroupSize:added", "policy.unreadablePaths:added"]);
    const written = ok<SettingsWritten>(await app.applySettingsChange({ configPath: config, next, baseDigest: proposal.baseDigest, confirmWidening: false }));
    assert.equal(written.written, true);
    assert.deepEqual(privateDataIn(ok(await app.readSettings({ configPath: config }))), { unreadablePaths: ["data/private"], minGroupSize: { configured: 10, effective: 10, min: 5, max: 1000 } });
  });

  test("taking an unreadable path away widens: refused unconfirmed, written once confirmed", TODO_PARSER, async () => {
    const { app, config, current } = await setup();
    const start = withPolicy(await current(), { unreadablePaths: ["data/private", "hr"] });
    await writeFile(config, `${JSON.stringify(start, null, 2)}\n`);
    const next = withPolicy(start, { unreadablePaths: ["hr"] });
    const proposal = ok<SettingsChangeProposal>(await app.proposeSettingsChange({ configPath: config, next }));
    assert.deepEqual(widening(proposal), ["unreadable_path_removed policy.unreadablePaths"]);
    const before = await readFile(config, "utf8");
    assert.equal(code(await app.applySettingsChange({ configPath: config, next, baseDigest: proposal.baseDigest, confirmWidening: false })), "invalid_arguments");
    assert.equal(await readFile(config, "utf8"), before, "nothing written without the person's answer");
    ok(await app.applySettingsChange({ configPath: config, next, baseDigest: proposal.baseDigest, confirmWidening: true }));
    assert.deepEqual(privateDataIn(ok(await app.readSettings({ configPath: config })))?.unreadablePaths, ["hr"]);
  });

  test("lowering k widens, so does taking a value above 5 away; a value at 5 taken away does not", TODO_PARSER, async () => {
    const { app, config, current } = await setup();
    const start = withPolicy(await current(), { minGroupSize: 10 });
    await writeFile(config, `${JSON.stringify(start, null, 2)}\n`);
    const lowered = ok<SettingsChangeProposal>(await app.proposeSettingsChange({ configPath: config, next: withPolicy(start, { minGroupSize: 8 }) }));
    assert.deepEqual(widening(lowered), ["min_group_size_lowered policy.minGroupSize"]);
    const { minGroupSize: _taken, ...without } = start["policy"] as Record<string, unknown>;
    const removed = ok<SettingsChangeProposal>(await app.proposeSettingsChange({ configPath: config, next: { ...start, policy: without } }));
    assert.deepEqual(widening(removed), ["min_group_size_lowered policy.minGroupSize"]);
    await writeFile(config, `${JSON.stringify(withPolicy(start, { minGroupSize: 5 }), null, 2)}\n`);
    const atFive = ok<SettingsChangeProposal>(await app.proposeSettingsChange({ configPath: config, next: { ...start, policy: without } }));
    assert.deepEqual(widening(atFive), []);
  });

  test("a k outside 5 to 1000 or not whole, and an entry the gate cannot use: invalid_config at that field, nothing written", TODO_PARSER, async () => {
    const { app, config, current } = await setup();
    const base = await current();
    const before = await readFile(config, "utf8");
    const cases = [
      [{ minGroupSize: 3 }, "policy.minGroupSize"],
      [{ minGroupSize: 1001 }, "policy.minGroupSize"],
      [{ minGroupSize: 7.5 }, "policy.minGroupSize"],
      [{ unreadablePaths: ["../outside"] }, "policy.unreadablePaths[0]"],
    ] as const;
    for (const [extra, field] of cases) {
      const next = withPolicy(base, extra);
      const proposed = await app.proposeSettingsChange({ configPath: config, next });
      assert.equal(code(proposed), "invalid_config", JSON.stringify(extra));
      assert.equal((proposed as { error: { diagnostic?: { field?: string } } }).error.diagnostic?.field, field, JSON.stringify(extra));
      assert.equal(code(await app.applySettingsChange({ configPath: config, next, baseDigest: "0".repeat(64), confirmWidening: true })), "invalid_config", JSON.stringify(extra));
    }
    assert.equal(await readFile(config, "utf8"), before);
  });
});
