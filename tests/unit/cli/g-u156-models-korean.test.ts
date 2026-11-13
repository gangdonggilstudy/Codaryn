/**
 * U-156 (nb-i18n's E group, U-154's table): `codaryn models`' text came from fixed English, so a
 * Korean person read an English table and question. Now its lines come from the catalog (models.*);
 * the English is the text before U-156, character for character (SP-0 and y-models pin it, and this
 * test compares the English catalog's lines with the renderer without one). The JSON is not touched.
 * renderModels on made-up outputs, and the real CLI against the loopback fake server (models
 * catalog) with CODARYN_LANG=ko, the question at an imitated terminal; fake key.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, test } from "node:test";
import type { TestContext } from "node:test";
import type { MessageCatalog, MessageId, ModelsOutput } from "../../../src/contracts/index.js";
import { displayWidth } from "../../../src/cli/human/index.js";
import { renderModels } from "../../../src/cli/models.js";
import type { ModelsTextPlaces } from "../../../src/cli/models.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { cliEnv } from "../../support/cli.js";
import { startFakeAnthropic } from "../../support/fake-anthropic.js";
import { fakeModel } from "../../support/fake-models.js";
import { fakeApiConfig, writeConfigFile } from "../../fixtures/anthropic.js";
import { createSandbox } from "../../fixtures/builders.js";
import { FAKE_API_KEY } from "../../fixtures/secrets.js";

const english = createMessageCatalog("en");
const korean = createMessageCatalog("ko");
const ko = (id: string, params?: Record<string, unknown>): string => (korean.format as (id: MessageId, params?: Record<string, unknown>) => string)(id as MessageId, params);
/** renderModels with U-156's fourth argument. */
const render = (output: ModelsOutput, withTable: boolean, places?: ModelsTextPlaces, messages?: MessageCatalog): string =>
  (renderModels as unknown as (output: ModelsOutput, withTable: boolean, places?: ModelsTextPlaces, messages?: MessageCatalog) => string)(output, withTable, places, messages);

const BASE: ModelsOutput = {
  schemaVersion: 1,
  kind: "models",
  status: "listed",
  exitCode: 0,
  models: [
    { number: 1, id: "fake-model-a", displayName: "Fake A", createdAt: null, maxInputTokens: 200000, maxOutputTokens: 8192 },
    { number: 2, id: "fake-model-b", displayName: "Fake B", createdAt: null, maxInputTokens: null, maxOutputTokens: 64000 },
  ],
  current: { id: "fake-model-a", source: "config", listed: true },
  selected: null,
};
const OPENAI: ModelsTextPlaces = { modelEnv: "CODARYN_OPENAI_MODEL", field: "providers.openai.model" };
const CASES: readonly (readonly [string, ModelsOutput, boolean, ModelsTextPlaces | undefined])[] = [
  ["the table, the current model from the config", BASE, true, undefined],
  ["none listed, no current model", { ...BASE, models: [], current: null }, true, undefined],
  ["no table, the current model from the variable, not listed", { ...BASE, current: { id: "fake-model-z", source: "CODARYN_MODEL", listed: false } }, false, undefined],
  ["written into a new file", { ...BASE, status: "selected", selected: { id: "fake-model-b", created: true, overriddenBy: null } }, true, undefined],
  ["written, overridden by the variable (openai)", { ...BASE, status: "selected", selected: { id: "fake-model-b", created: false, overriddenBy: "CODARYN_OPENAI_MODEL" } }, true, OPENAI],
];

describe("U-156: the English text of models is as before", () => {
  for (const [name, output, withTable, places] of CASES) {
    test(`${name}: the English catalog gives the same text as no catalog`, () => {
      assert.equal(render(output, withTable, places, english), render(output, withTable, places));
    });
  }
});

describe("U-156: the Korean text of models", () => {
  test("the table: the heads in Korean, the columns lined up by terminal width; the listed line", () => {
    const lines = render(BASE, true, undefined, korean).split("\n");
    assert.equal(lines[0], `${ko("models.listed", { count: 2 })}:`);
    const head = lines[2] ?? "";
    for (const id of ["models.table.id", "models.table.name", "models.table.input_tokens", "models.table.output_tokens"]) assert.ok(head.includes(ko(id)), head);
    const rows = lines.slice(2, 5);
    assert.ok(rows.every((row) => displayWidth(row) === displayWidth(rows[0] ?? "")), rows.join("\n"));
    assert.equal(lines[6], `* ${ko("models.current_from_config")}: fake-model-a`);
  });

  test("the other lines", () => {
    assert.ok(render({ ...BASE, models: [], current: null }, true, undefined, korean).startsWith(`${ko("models.none_listed")}\n${ko("models.no_current", { variable: "CODARYN_MODEL" })}\n`));
    assert.ok(render(CASES[2]?.[1] as ModelsOutput, false, undefined, korean).startsWith(`* ${ko("models.current_from_env", { variable: "CODARYN_MODEL" })}: fake-model-z ${ko("models.not_listed")}\n`));
    const written = render(CASES[3]?.[1] as ModelsOutput, true, undefined, korean);
    assert.ok(written.includes(`${ko("models.written_label")}: fake-model-b ${ko("models.written_place_created", { field: "model" })}\n`), written);
    const overridden = render(CASES[4]?.[1] as ModelsOutput, true, OPENAI, korean);
    assert.ok(overridden.includes(`${ko("models.written_label")}: fake-model-b ${ko("models.written_place", { field: "providers.openai.model" })}\n`), overridden);
    assert.ok(overridden.endsWith(`${ko("models.overridden", { variable: "CODARYN_OPENAI_MODEL", field: "providers.openai.model" })}\n`), overridden);
  });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.resolve(here, "..", "..", "..", "src", "cli", "main.js");
const TERMINAL = pathToFileURL(path.join(here, "u115-terminal-preload.js")).href;
const GUARD = pathToFileURL(path.resolve(here, "..", "..", "support", "net-guard.js")).href;

/** The question models asks at a terminal, in Korean (the config file's `model`). */
const QUESTION = `${ko("models.use_prompt", { field: "model" })}: `;
/** The imitated terminal's readline writes cursor moves (`ESC[1G`, `ESC[0J`, `ESC[nG`) around the question. */
const shown = (text: string): string => text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");

/**
 * The real CLI's `models --config <config>` in Korean; `terminal` names the streams seen as terminals.
 * At a terminal it answers the question once with Enter, after the whole question is shown. Before
 * the R-97 note it ended stdin again on every later stdout chunk; when stdin was ending but not yet
 * destroyed, that second end raised ERR_STREAM_WRITE_AFTER_END with no listener and failed the test
 * now and then (1 in 50 runs). The streams are read as UTF-8 by a decoder, so a Hangul character
 * split across two chunks stays whole.
 */
async function models(t: TestContext, terminal: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const sb = createSandbox(t);
  const api = await startFakeAnthropic(t, [], { models: { models: [fakeModel("fake-model-u156", "Fake U156", 1000, 100)] } });
  const config = writeConfigFile(sb, fakeApiConfig(api.url, { model: "fake-model-u156" } as object));
  const env = { ...cliEnv({ fakeApiKey: FAKE_API_KEY }), CODARYN_LANG: "ko", CODARYN_TEST_TERMINAL: terminal, CODARYN_IT_NET_GUARD_LOG: path.join(sb.base, "net-guard.log") };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", GUARD, "--import", TERMINAL, MAIN, "models", "--config", config], { cwd: sb.base, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let answered = false;
    let stdinError: Error | undefined;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`no question "${QUESTION}" (stdin: ${stdinError?.message ?? "no error"}):\n${stderr}\n${shown(stdout)}`));
    }, 30_000);
    // A failed write to the child's stdin is shown in the timeout's message, not thrown at the test.
    child.stdin.on("error", (error: Error) => (stdinError = error));
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!answered && terminal !== "" && shown(stdout).includes(QUESTION)) {
        answered = true;
        child.stdin.end("\n");
      }
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    if (terminal === "") child.stdin.end();
  });
}

describe("U-156 on the real CLI: models in Korean", () => {
  test("not at a terminal: the table and the current model in Korean", async (t) => {
    const { stdout, code } = await models(t, "");
    assert.equal(code, 0, stdout);
    assert.ok(stdout.includes(`${ko("models.listed", { count: 1 })}:`), stdout);
    assert.ok(stdout.includes(ko("models.table.input_tokens")), stdout);
    assert.ok(stdout.includes(`* ${ko("models.current_from_config")}: fake-model-u156`), stdout);
  });

  test("at a terminal: the question in Korean", async (t) => {
    const { stdout, stderr, code } = await models(t, "stdin,stdout,stderr");
    assert.ok(shown(stdout).includes(QUESTION), `${stderr}\n${shown(stdout)}`);
    assert.equal(code, 0, `${stderr}\n${shown(stdout)}`);
  });
});
