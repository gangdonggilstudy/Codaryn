/**
 * The GUI wizard's first steps through the app layer (N-2, N-1, S-1, C-1): the config file with
 * the defaults, and the fixed suggestions of a workspace. Fake values only; the key value is not
 * key-shaped.
 */

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV, MODEL_PLACEHOLDER } from "../../../src/contracts/index.js";
import type { InitOutput } from "../../../src/contracts/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, SettingsSuggestions } from "../../../src/app/index.js";
import { appEnvironment, exists, tempDir } from "./support.js";

const FAKE_KEY = "fake-init-key-value-0095";

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}

function code<T>(outcome: AppCallOutcome<T>): string | null {
  return outcome.ok ? null : outcome.error.code;
}

describe("createSettings (init --json, no questions)", () => {
  test("writes the defaults once: model placeholder, no command, no key; a second call leaves the file", async () => {
    const base = await tempDir("codaryn-unit-app-init-");
    const config = path.join(base, "settings", "config.json");
    const app = createCodarynApp(await appEnvironment(base, { env: { [ANTHROPIC_API_KEY_ENV]: FAKE_KEY } }));
    const created = ok<InitOutput>(await app.createSettings({ configPath: config, workspace: null }));
    assert.deepEqual(
      [created.kind, created.status, created.interactive, created.model, created.commands, created.protectedPaths, created.keySet],
      ["init", "created", false, "placeholder", 0, 0, true],
    );
    const text = await readFile(config, "utf8");
    assert.equal(text.includes(FAKE_KEY), false, "C-1: no key in the file");
    const written = JSON.parse(text) as { model: string; policy: { commands: unknown[] } };
    assert.deepEqual([written.model, written.policy.commands], [MODEL_PLACEHOLDER, []]);

    assert.equal(code(await app.createSettings({ configPath: config, workspace: null })), "config_exists");
    assert.equal(await readFile(config, "utf8"), text, "never overwritten");

    const read = ok(await app.readSettings({ configPath: config }));
    assert.equal(read.config?.model, MODEL_PLACEHOLDER, "the same file the settings read sees");
  });

  test("the default location when no path is given; no location at all is an error", async () => {
    const base = await tempDir("codaryn-unit-app-init-");
    const env = process.platform === "win32" ? { APPDATA: base } : { XDG_CONFIG_HOME: base };
    const app = createCodarynApp(await appEnvironment(base, { env }));
    const created = ok<InitOutput>(await app.createSettings({ configPath: null, workspace: null }));
    assert.equal(created.config.source, "default");
    const read = ok(await app.readSettings({ configPath: null }));
    assert.deepEqual([read.file?.source, read.file?.exists], ["default", true]);

    const nowhere = createCodarynApp(await appEnvironment(base, { env: {} }));
    assert.equal(code(await nowhere.createSettings({ configPath: null, workspace: null })), "invalid_config");
  });

  test("S-1: a config file inside the given workspace is refused and nothing is written", async () => {
    const base = await tempDir("codaryn-unit-app-init-");
    const workspace = path.join(base, "work");
    await mkdir(workspace);
    const inside = path.join(workspace, "config.json");
    const app = createCodarynApp(await appEnvironment(base, { env: {} }));
    assert.equal(code(await app.createSettings({ configPath: inside, workspace })), "invalid_config");
    assert.equal(await exists(inside), false);
  });
});

describe("settingsSuggestions", () => {
  test("names only init's fixed scripts and protected paths that are there", async () => {
    const workspace = await tempDir("codaryn-unit-app-init-work-");
    await writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify({ scripts: { test: "node --test", build: "tsc", start: "node .", evil: "rm -rf ~" } }),
      "utf8",
    );
    await mkdir(path.join(workspace, "tests"));
    const app = createCodarynApp(await appEnvironment(workspace, { env: {} }));
    const suggested = ok<SettingsSuggestions>(await app.settingsSuggestions({ workspace }));
    assert.deepEqual(
      suggested.commands.map((entry) => entry.shown),
      ["npm test", "npm run build"],
    );
    assert.deepEqual(suggested.commands[0]?.rule, { executable: "npm", argsPrefix: ["test"], allowExtraArgs: false }, "arguments fixed");
    assert.deepEqual(suggested.protectedPaths, ["tests", "package.json"]);
    assert.equal(JSON.stringify(suggested).includes("rm -rf"), false, "nothing else is taken from the file");
  });

  test("a broken package.json gives no command; a missing workspace is workspace_not_found", async () => {
    const workspace = await tempDir("codaryn-unit-app-init-work-");
    await writeFile(path.join(workspace, "package.json"), "{ not json", "utf8");
    const app = createCodarynApp(await appEnvironment(workspace, { env: {} }));
    const suggested = ok<SettingsSuggestions>(await app.settingsSuggestions({ workspace }));
    assert.deepEqual([suggested.commands, suggested.protectedPaths], [[], ["package.json"]]);
    assert.equal(code(await app.settingsSuggestions({ workspace: path.join(workspace, "absent") })), "workspace_not_found");
  });
});
