/**
 * U-26 (UXM-11, DR-46; contract a0fb27a, texts b12a131), the CLI's part: `init` wrote Anthropic's
 * form only, so a second provider meant editing the JSON by hand. At a terminal it now asks the
 * provider right after the location is confirmed (INIT_DEFAULT_PROVIDER on Enter, an unknown answer
 * or the end of input), tells which one the file is for, lists that provider's models with that
 * provider's key and lister, and writes that provider's form: anthropic as before; openai with
 * `"provider": "openai"` and `providers.openai.{model, maxOutputTokens}`. Without a terminal, or with
 * --json, nothing is asked and the output and the file are as before, to the letter.
 * Stand-in questions and listers; nothing is sent.
 */

import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  ANTHROPIC_API_KEY_ENV,
  DEFAULT_CONFIG_DISPLAY,
  INIT_DEFAULT_LIMITS,
  INIT_DEFAULT_MAX_OUTPUT_TOKENS,
  MODEL_PLACEHOLDER,
  OPENAI_API_KEY_ENV,
} from "../../../src/contracts/index.js";
import type { ApiProviderName, DefaultConfigLocation, InitOutput, ListModels, ModelInfo } from "../../../src/contracts/index.js";
import { parseConfig } from "../../../src/cli/config.js";
import { initConfigText, runInit } from "../../../src/cli/init.js";
import type { InitEnvironment } from "../../../src/cli/init.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { lexicalLocate } from "./locate.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

/** Not real key formats; built from parts (G-10). */
const ANTHROPIC_FAKE = ["fake", "u26", "anthropic", "0042"].join("-");
const OPENAI_FAKE = ["fake", "u26", "openai", "0042"].join("-");
const english = createMessageCatalog("en");
const MODEL: ModelInfo = { id: "model-o1", displayName: "O1", createdAt: null, maxInputTokens: null, maxOutputTokens: null };

interface Ran {
  readonly outcome: Awaited<ReturnType<typeof runInit>>;
  readonly written: Record<string, unknown> | null;
  readonly text: string | null;
  readonly asked: string[];
  readonly told: string[];
}

async function init(options: { argv?: readonly string[]; env?: Record<string, string>; answers?: (string | null)[]; listers?: Partial<Record<ApiProviderName, ListModels>>; listModels?: ListModels }): Promise<Ran> {
  const dir = await mkdtemp(path.join(tmpdir(), "codaryn-g-u26-"));
  temporaryDirs.push(dir);
  const target: DefaultConfigLocation = { path: path.join(dir, "appdata", "Codaryn", "config.json"), display: DEFAULT_CONFIG_DISPLAY.windows };
  const asked: string[] = [];
  const told: string[] = [];
  const answers = [...(options.answers ?? [])];
  const io: InitEnvironment = {
    ...(options.answers === undefined
      ? {}
      : {
          ask: async (question: string) => {
            asked.push(question);
            return answers.length === 0 ? "" : (answers.shift() ?? null);
          },
        }),
    argv: options.argv ?? ["init"],
    env: options.env ?? {},
    cwd: dir,
    defaultConfig: target,
    messages: english,
    readFile: (file) => readFile(file, "utf8"),
    isDirectory: async (d) => (await lstat(d).catch(() => null))?.isDirectory() ?? false,
    exists: async (p) => (await lstat(p).catch(() => null)) !== null,
    locateInWorkspace: lexicalLocate,
    makeDirectory: async (d) => {
      await mkdir(d, { recursive: true });
    },
    writeNewFile: (file, text) => writeFile(file, text, { encoding: "utf8", flag: "wx" }),
    tell: (line) => {
      told.push(line);
    },
    ...(options.listModels === undefined ? {} : { listModels: options.listModels }),
    // InitEnvironment.listers (U-26): the other providers' listers, as main.ts passes them.
    ...(options.listers === undefined ? {} : ({ listers: options.listers } as object)),
  };
  const outcome = await runInit(io);
  const raw = await readFile(target.path, "utf8").catch(() => null);
  return { outcome, written: raw === null ? null : (JSON.parse(raw) as Record<string, unknown>), text: raw, asked, told };
}

const chosenLine = (provider: string): string => `${(english.format as (id: string, p: Record<string, string>) => string)("init.provider_chosen", { provider })}\n`;

describe("U-26: init asks the provider at a terminal", () => {
  test("the provider question comes right after the location, with the list and the default", async () => {
    const ran = await init({ answers: ["y", "", ""] });
    const question = ran.asked[1] ?? "";
    assert.ok(question.includes("  1  anthropic\n  2  openai\n"), question);
    assert.ok(question.includes((english.format as (id: string, p: Record<string, string>) => string)("init.provider_pick", { provider: "anthropic" })), question);
  });

  test("openai by number: the file is openai's form; the key line names OPENAI_API_KEY", async () => {
    const ran = await init({ answers: ["y", "2", ""] });
    assert.ok(ran.told.includes(chosenLine("openai")), JSON.stringify(ran.told));
    assert.deepEqual(ran.written?.["provider"], "openai");
    assert.equal(Object.hasOwn(ran.written ?? {}, "model"), false, "no top-level model");
    assert.equal(Object.hasOwn(ran.written ?? {}, "maxOutputTokens"), false, "no top-level output limit");
    assert.deepEqual(ran.written?.["providers"], { openai: { model: MODEL_PLACEHOLDER, maxOutputTokens: INIT_DEFAULT_MAX_OUTPUT_TOKENS } });
    assert.deepEqual(ran.written?.["limits"], INIT_DEFAULT_LIMITS);
    assert.ok(parseConfig(ran.written).ok, "a valid config");
    assert.ok("text" in ran.outcome && ran.outcome.text.includes(OPENAI_API_KEY_ENV), JSON.stringify(ran.outcome));
  });

  test("by name, whatever the case; Enter, an unknown answer and the end of input give anthropic", async () => {
    assert.deepEqual((await init({ answers: ["y", "OpenAI", ""] })).written?.["provider"], "openai");
    for (const answer of ["", "nosuch", "3", null]) {
      const ran = await init({ answers: ["y", answer, ""] });
      assert.ok(ran.told.includes(chosenLine("anthropic")), JSON.stringify([answer, ran.told]));
      assert.equal(Object.hasOwn(ran.written ?? {}, "provider"), false, JSON.stringify(answer));
      assert.equal(ran.written?.["model"], MODEL_PLACEHOLDER);
    }
  });

  test("anthropic at a terminal writes the same file as before", async () => {
    const ran = await init({ answers: ["y", "", ""] });
    assert.equal(ran.text, initConfigText({ model: MODEL_PLACEHOLDER, commands: [], protectedPaths: [], language: null }));
  });

  test("openai's models come from openai's lister with openai's key; anthropic's lister is not called", async () => {
    const calls: { provider: string; apiKey: string }[] = [];
    const lister = (provider: string): ListModels => async (settings) => {
      calls.push({ provider, apiKey: settings.apiKey });
      return { ok: true, models: [MODEL] };
    };
    const ran = await init({
      env: { [ANTHROPIC_API_KEY_ENV]: ANTHROPIC_FAKE, [OPENAI_API_KEY_ENV]: OPENAI_FAKE },
      answers: ["y", "openai", "1", ""],
      listModels: lister("anthropic"),
      listers: { openai: lister("openai") },
    });
    assert.deepEqual(calls, [{ provider: "openai", apiKey: OPENAI_FAKE }]);
    assert.deepEqual(ran.written?.["providers"], { openai: { model: MODEL.id, maxOutputTokens: INIT_DEFAULT_MAX_OUTPUT_TOKENS } });
    assert.ok("text" in ran.outcome);
  });
});

describe("U-26: without a terminal or with --json, init is as before", () => {
  test("no terminal: nothing asked, no provider in the output, anthropic's form", async () => {
    const ran = await init({ argv: ["init", "--json"], env: { [OPENAI_API_KEY_ENV]: OPENAI_FAKE } });
    assert.deepEqual(ran.asked, []);
    assert.ok("output" in ran.outcome);
    const output = ran.outcome.output as InitOutput;
    assert.equal(Object.hasOwn(output, "provider"), false);
    assert.equal(output.keySet, false, "the key is anthropic's, as before");
    assert.equal(ran.text, initConfigText({ model: MODEL_PLACEHOLDER, commands: [], protectedPaths: [], language: null }));
  });

  test("--json at a terminal: nothing asked either", async () => {
    const ran = await init({ argv: ["init", "--json"], answers: ["y", "2", ""] });
    assert.deepEqual(ran.asked, []);
    assert.equal(Object.hasOwn(ran.written ?? {}, "provider"), false);
  });
});
