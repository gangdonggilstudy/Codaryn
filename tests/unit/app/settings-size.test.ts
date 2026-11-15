/**
 * DR-42 (d): the GUI's settings reading has the CLI's size cap for a config file (DR-40 (b),
 * MAX_INPUT_FILE_BYTES, after the BOM is dropped as the CLI does). A larger file is refused with the
 * CLI's fixed message before any check reads it, and a settings change never writes one (the CLI
 * would then refuse every run). Fake values only.
 */

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { MAX_INPUT_FILE_BYTES, inputFileTooLargeMessage } from "../../../src/cli/security/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome } from "../../../src/app/index.js";
import { appEnvironment, tempDir } from "./support.js";

const HEAD = '{"schemaVersion":1,"model":"fake-model-a"}';
/** A valid config of exactly `bytes` UTF-8 bytes: the object, then spaces. */
const configOf = (bytes: number): string => HEAD + " ".repeat(bytes - HEAD.length);
const failure = (outcome: AppCallOutcome<unknown>): [string, string] | null => (outcome.ok ? null : [outcome.error.code, outcome.error.message]);

async function setup(text: string) {
  const base = await tempDir("codaryn-unit-app-settings-size-");
  const config = path.join(base, "config.json");
  await writeFile(config, text, "utf8");
  return { config, app: createCodarynApp(await appEnvironment(base)) };
}

describe("DR-42 (d): the config file size cap in the app layer", () => {
  test("readSettings reads a file of exactly the cap and refuses one byte more, with the CLI's message", async () => {
    const at = await setup(configOf(MAX_INPUT_FILE_BYTES));
    assert.equal((await at.app.readSettings({ configPath: at.config })).ok, true, "exactly the cap");
    const withBom = await setup(`﻿${configOf(MAX_INPUT_FILE_BYTES)}`);
    assert.equal((await withBom.app.readSettings({ configPath: withBom.config })).ok, true, "the BOM is dropped first, as the CLI does");
    const over = await setup(configOf(MAX_INPUT_FILE_BYTES + 1));
    assert.deepEqual(failure(await over.app.readSettings({ configPath: over.config })), ["invalid_config", inputFileTooLargeMessage("config file")]);
  });

  test("the cap counts UTF-8 bytes, as the CLI does", async () => {
    // Fewer characters than the cap, more bytes: a two-byte character in a valid string field.
    const text = `{"schemaVersion":1,"model":"${"é".repeat(Math.ceil(MAX_INPUT_FILE_BYTES / 2))}"}`;
    assert.ok(text.length < MAX_INPUT_FILE_BYTES && Buffer.byteLength(text, "utf8") > MAX_INPUT_FILE_BYTES);
    const big = await setup(text);
    assert.deepEqual(failure(await big.app.readSettings({ configPath: big.config })), ["invalid_config", inputFileTooLargeMessage("config file")]);
  });

  test("a settings change whose new file would be over the cap is refused and nothing is written", async () => {
    const { config, app } = await setup(`${HEAD}\n`);
    const before = await readFile(config, "utf8");
    const next = { schemaVersion: 1, model: "fake-model-a", secretEnv: Array.from({ length: 70_000 }, (_, i) => `FAKE_SECRET_NAME_${i}`) };
    const proposed = await app.proposeSettingsChange({ configPath: config, next });
    assert.deepEqual(failure(proposed), ["invalid_config", inputFileTooLargeMessage("config file")]);
    const applied = await app.applySettingsChange({ configPath: config, next, baseDigest: "0".repeat(64), confirmWidening: true });
    assert.equal(applied.ok, false);
    assert.equal(await readFile(config, "utf8"), before);
  });
});
