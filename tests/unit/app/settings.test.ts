/**
 * The GUI's settings read through the app layer (standalone-gui 3.2, 3.6; N-1, N-6, N-8, C-1).
 * The file is chosen and checked by the CLI's own functions; these cases check that the app layer
 * gives their answers. Fake values only; the key value is not key-shaped.
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV, BUILTIN_WORKFLOW_IDS, CODARYN_CONFIG_ENV } from "../../../src/contracts/index.js";
import type { CodarynConfig } from "../../../src/contracts/index.js";
import { createCodarynApp, profileWorkflowsOf } from "../../../src/app/index.js";
import type { AppCallOutcome, SettingsView } from "../../../src/app/index.js";
import { appEnvironment, tempDir } from "./support.js";

const FAKE_KEY = "fake-settings-key-value-0093";

function ok(outcome: AppCallOutcome<SettingsView>): SettingsView {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: SettingsView }).output;
}

async function configFile(dir: string, value: unknown): Promise<string> {
  const file = path.join(dir, "config.json");
  await writeFile(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
}

/** The variable that names the default location on this platform (N-1). */
function defaultLocationEnv(dir: string): Record<string, string> {
  return process.platform === "win32" ? { APPDATA: dir } : { XDG_CONFIG_HOME: dir };
}

describe("readSettings", () => {
  test("no file chosen: no config, no names, whether a key is set but never its value", async () => {
    const base = await tempDir("codaryn-unit-app-settings-");
    const app = createCodarynApp(await appEnvironment(base, { env: { [ANTHROPIC_API_KEY_ENV]: FAKE_KEY } }));
    const view = ok(await app.readSettings({ configPath: null }));
    assert.deepEqual(view, {
      kind: "settings",
      file: null,
      config: null,
      profiles: [],
      workflows: [],
      builtinWorkflows: [...BUILTIN_WORKFLOW_IDS],
      profileWorkflows: [],
      keyAvailable: true,
      // DR-41: no configured policy, so no workflow leaves anything out.
      policyNarrowings: [],
    });
    assert.equal(JSON.stringify(view).includes(FAKE_KEY), false);
  });

  test("the default location: missing means no config yet; once there it is read like any config file", async () => {
    const base = await tempDir("codaryn-unit-app-settings-");
    const app = createCodarynApp(await appEnvironment(base, { env: defaultLocationEnv(base) }));
    const missing = ok(await app.readSettings({ configPath: null }));
    assert.ok(missing.file !== null);
    assert.deepEqual([missing.file.source, missing.file.exists, missing.config, missing.keyAvailable], ["default", false, null, false]);
    assert.equal(missing.file.path.startsWith(base), true);

    await mkdir(path.dirname(missing.file.path), { recursive: true });
    await writeFile(missing.file.path, `${JSON.stringify({ schemaVersion: 1, model: "fake-model-a" })}\n`, "utf8");
    const present = ok(await app.readSettings({ configPath: null }));
    assert.deepEqual([present.file?.source, present.file?.exists, present.config?.model], ["default", true, "fake-model-a"]);
  });

  test("--config wins over CODARYN_CONFIG; profile names come in the file's order", async () => {
    const base = await tempDir("codaryn-unit-app-settings-");
    const fromEnv = await configFile(await tempDir("codaryn-unit-app-settings-env-"), { schemaVersion: 1, model: "fake-model-env" });
    const explicit = await configFile(base, {
      schemaVersion: 1,
      model: "fake-model-a",
      limits: { maxModelTurns: 5 },
      profiles: { doc: { limits: { maxModelTurns: 2 } }, code: { limits: { maxModelTurns: 3 } } },
    });
    const app = createCodarynApp(await appEnvironment(base, { env: { [CODARYN_CONFIG_ENV]: fromEnv } }));
    const byEnv = ok(await app.readSettings({ configPath: null }));
    assert.deepEqual([byEnv.file?.source, byEnv.config?.model], ["environment", "fake-model-env"]);
    const byArgument = ok(await app.readSettings({ configPath: explicit }));
    assert.deepEqual([byArgument.file?.source, byArgument.file?.display, byArgument.config?.model], ["argument", "--config", "fake-model-a"]);
    assert.deepEqual(byArgument.profiles, ["doc", "code"]);
    assert.deepEqual(byArgument.profileWorkflows, [
      { profile: "doc", workflowRef: null },
      { profile: "code", workflowRef: null },
    ]);
    assert.deepEqual(byArgument.builtinWorkflows, [...BUILTIN_WORKFLOW_IDS]);
  });

  test("a file that fails a check is the CLI's error, with its position, and never echoes a value", async () => {
    const base = await tempDir("codaryn-unit-app-settings-");
    const app = createCodarynApp(await appEnvironment(base, { env: { [ANTHROPIC_API_KEY_ENV]: FAKE_KEY } }));

    const keyed = await app.readSettings({ configPath: await configFile(base, { schemaVersion: 1, model: FAKE_KEY }) });
    assert.equal(keyed.ok ? null : keyed.error.code, "key_in_file");
    assert.equal(JSON.stringify(keyed).includes(FAKE_KEY), false);

    const broken = await app.readSettings({ configPath: await configFile(base, '{\n  "schemaVersion": 1,\n  "model": \n}\n') });
    assert.ok(!broken.ok);
    assert.equal(broken.error.code, "invalid_config");
    assert.deepEqual([broken.error.diagnostic?.code, broken.error.diagnostic?.file, broken.error.diagnostic?.line], ["json_syntax", "config", 4]);

    const unknown = await app.readSettings({ configPath: await configFile(base, { schemaVersion: 1, modle: "x-secret-like-value" }) });
    assert.ok(!unknown.ok);
    assert.deepEqual([unknown.error.code, unknown.error.diagnostic?.code, unknown.error.diagnostic?.file], ["invalid_config", "unknown_field", "config"]);
    assert.equal(JSON.stringify(unknown).includes("x-secret-like-value"), false, "N-6: positions, not values");

    const absent = await app.readSettings({ configPath: path.join(base, "absent.json") });
    assert.equal(absent.ok ? null : absent.error.code, "invalid_config", "a named file that is missing is an error, not 'no config'");
  });
});

describe("profileWorkflowsOf", () => {
  test("each profile with the workflow it names, or null; the file's order", () => {
    const config = {
      schemaVersion: 1,
      profiles: { tidy: { workflowRef: "organize" }, plain: {}, notes: { workflowRef: "team-notes" } },
    } as unknown as CodarynConfig;
    assert.deepEqual(profileWorkflowsOf(config), [
      { profile: "tidy", workflowRef: "organize" },
      { profile: "plain", workflowRef: null },
      { profile: "notes", workflowRef: "team-notes" },
    ]);
    assert.deepEqual(profileWorkflowsOf(null), []);
  });
});
