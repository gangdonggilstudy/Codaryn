/**
 * SP-2 through the app layer: every API provider's key (API_KEY_ENVS) is treated as the CLI treats
 * it (knownKeyValues), not only ANTHROPIC_API_KEY. A config file holding the OpenAI key's value is
 * refused when read and never written by a settings change; the run list hides the value; the
 * settings view says whether the key of the provider a quick run would use is set. Fake values
 * only, not key-shaped.
 */

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV, JOURNAL_FILE_NAME, OPENAI_API_KEY_ENV } from "../../../src/contracts/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, SettingsView } from "../../../src/app/index.js";
import { WRITE_NOTES, appEnvironment, runDir, setupRun, taskRequest, tempDir } from "./support.js";

const ANTHROPIC_VALUE = ["cdy-fake", "appkeys", "anthropic", "value", "0001"].join("-");
const OPENAI_VALUE = ["cdy-fake", "appkeys", "openai", "value", "0001"].join("-");

function code<T>(outcome: AppCallOutcome<T>): string | null {
  return outcome.ok ? null : outcome.error.code;
}

async function configFile(value: Record<string, unknown>): Promise<{ base: string; config: string }> {
  const base = await tempDir("codaryn-unit-app-provider-keys-");
  const config = path.join(base, "config.json");
  await writeFile(config, `${JSON.stringify({ schemaVersion: 1, ...value }, null, 2)}\n`, "utf8");
  return { base, config };
}

describe("every provider's key, as the CLI treats it (SP-2)", () => {
  test("readSettings refuses a config file holding the OpenAI key's value, without echoing it", async () => {
    const { base, config } = await configFile({ model: OPENAI_VALUE });
    const app = createCodarynApp(await appEnvironment(base, { env: { [OPENAI_API_KEY_ENV]: OPENAI_VALUE } }));
    const read = await app.readSettings({ configPath: config });
    assert.equal(code(read), "key_in_file", JSON.stringify(read).replaceAll(OPENAI_VALUE, "<value>"));
    assert.equal(JSON.stringify(read).includes(OPENAI_VALUE), false);
  });

  test("a settings change that would write the OpenAI key's value is refused and nothing is written", async () => {
    const { base, config } = await configFile({ model: "fake-model-a" });
    const before = await readFile(config, "utf8");
    const app = createCodarynApp(await appEnvironment(base, { env: { [OPENAI_API_KEY_ENV]: OPENAI_VALUE } }));
    const proposed = await app.proposeSettingsChange({ configPath: config, next: { schemaVersion: 1, model: OPENAI_VALUE } });
    assert.equal(code(proposed), "key_in_file");
    assert.equal(JSON.stringify(proposed).includes(OPENAI_VALUE), false);
    assert.equal(await readFile(config, "utf8"), before);
  });

  test("the run list hides the OpenAI key's value", async () => {
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const started = await createCodarynApp(await appEnvironment(base)).startRun(taskRequest(base));
    assert.ok(started.ok);
    await started.handle.done;
    // Records that hold the value (a task id of the allowed characters), as no real run writes them:
    // run_started and result.json agree, so the store lists the run as checked.
    const dir = runDir(base, started.handle.runId);
    const journal = path.join(dir, JOURNAL_FILE_NAME);
    const [first = "", ...rest] = (await readFile(journal, "utf8")).split("\n");
    await writeFile(journal, [JSON.stringify({ ...(JSON.parse(first) as object), taskId: OPENAI_VALUE }), ...rest].join("\n"), "utf8");
    const resultFile = path.join(dir, "result.json");
    await writeFile(resultFile, JSON.stringify({ ...(JSON.parse(await readFile(resultFile, "utf8")) as object), taskId: OPENAI_VALUE }), "utf8");

    const app = createCodarynApp(await appEnvironment(base, { env: { [OPENAI_API_KEY_ENV]: OPENAI_VALUE } }));
    const listed = await app.listRuns({ workspace: path.join(base, "work") });
    assert.ok(listed.ok, JSON.stringify(listed).replaceAll(OPENAI_VALUE, "<value>"));
    assert.deepEqual(listed.output.runs.map((run) => run.state), ["checked"], "the store lists the run with its task id");
    assert.equal(JSON.stringify(listed).includes(OPENAI_VALUE), false);
  });

  test("keyAvailable is the key of the provider a quick run would use", async () => {
    const view = async (configValue: Record<string, unknown>, env: Record<string, string>): Promise<SettingsView> => {
      const { base, config } = await configFile(configValue);
      const read = await createCodarynApp(await appEnvironment(base, { env })).readSettings({ configPath: config });
      assert.ok(read.ok, JSON.stringify(read));
      return read.output;
    };
    const openai = { provider: "openai", providers: { openai: { model: "gpt-fake" } } };
    assert.equal((await view(openai, { [OPENAI_API_KEY_ENV]: OPENAI_VALUE })).keyAvailable, true);
    assert.equal((await view(openai, { [ANTHROPIC_API_KEY_ENV]: ANTHROPIC_VALUE })).keyAvailable, false);
    assert.equal((await view({ model: "fake-model-a" }, { [ANTHROPIC_API_KEY_ENV]: ANTHROPIC_VALUE })).keyAvailable, true);
    assert.equal((await view({ model: "fake-model-a" }, { [OPENAI_API_KEY_ENV]: OPENAI_VALUE })).keyAvailable, false);
    const both = await view(openai, { [ANTHROPIC_API_KEY_ENV]: ANTHROPIC_VALUE, [OPENAI_API_KEY_ENV]: OPENAI_VALUE });
    assert.equal(JSON.stringify(both).includes(OPENAI_VALUE) || JSON.stringify(both).includes(ANTHROPIC_VALUE), false);
  });
});
