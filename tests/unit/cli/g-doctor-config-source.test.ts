/**
 * The integration owner's finding: doctor's config_file check uses doctor.config_file.valid_at for
 * every source, and its text says "at the default location {location}", so a config given with
 * --config or CODARYN_CONFIG reads "the config file at the default location --config is valid"
 * (both languages). The text must follow the source.
 *
 * The cases for --config and CODARYN_CONFIG are todo: the contract has no message id for a config
 * file given by an option or a variable (requested of the contract owner, after the third bundle).
 * Real files and the real catalogs; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { CODARYN_CONFIG_ENV, DEFAULT_CONFIG_DISPLAY } from "../../../src/contracts/index.js";
import type { DoctorOutput, MessageLanguage } from "../../../src/contracts/index.js";
import { renderDoctor, runDoctor } from "../../../src/cli/doctor.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { lexicalLocate } from "./locate.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

type Source = "--config" | "CODARYN_CONFIG" | "default";

/** The human config_file line of doctor in `language`, for a valid config file named by `source`. */
async function configLine(source: Source, language: MessageLanguage): Promise<string> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-doctor-config-source-"));
  temporaryDirs.push(base);
  const file = path.join(base, "config.json");
  await writeFile(file, JSON.stringify({ schemaVersion: 1 }), "utf8");
  const display = DEFAULT_CONFIG_DISPLAY.windows;
  const outcome = await runDoctor({
    argv: ["doctor", ...(source === "--config" ? ["--config", file] : []), "--json"],
    env: source === "CODARYN_CONFIG" ? { [CODARYN_CONFIG_ENV]: file } : {},
    cwd: base,
    nodeVersion: "26.0.0",
    readFile: (name) => readFile(name, "utf8"),
    isDirectory: async (dir) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
    isFile: async (name) => (await stat(name).catch(() => null))?.isFile() ?? false,
    locateInWorkspace: lexicalLocate,
    relatePaths: async () => "separate",
    defaultConfig: source === "default" ? { path: file, display } : null,
  });
  assert.ok("text" in outcome, JSON.stringify(outcome));
  const output = JSON.parse(outcome.text) as DoctorOutput;
  assert.equal(output.checks.find((check) => check.id === "config_file")?.status, "ok", outcome.text);
  const catalog = createMessageCatalog(language);
  const label = catalog.format("doctor.check.config_file");
  const line = renderDoctor(output, catalog).split("\n").find((entry) => entry.includes(label));
  assert.ok(line !== undefined);
  return line;
}

/** The config_file check's catalog text for a valid config file named by `source`. */
async function configText(source: Source): Promise<unknown> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-doctor-config-source-"));
  temporaryDirs.push(base);
  const file = path.join(base, "config.json");
  await writeFile(file, JSON.stringify({ schemaVersion: 1 }), "utf8");
  const outcome = await runDoctor({
    argv: ["doctor", ...(source === "--config" ? ["--config", file] : []), "--json"],
    env: source === "CODARYN_CONFIG" ? { [CODARYN_CONFIG_ENV]: file } : {},
    cwd: base,
    nodeVersion: "26.0.0",
    readFile: (name) => readFile(name, "utf8"),
    isDirectory: async (dir) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
    isFile: async (name) => (await stat(name).catch(() => null))?.isFile() ?? false,
    locateInWorkspace: lexicalLocate,
    relatePaths: async () => "separate",
    defaultConfig: source === "default" ? { path: file, display: DEFAULT_CONFIG_DISPLAY.windows } : null,
  });
  assert.ok("text" in outcome);
  return (JSON.parse(outcome.text) as DoctorOutput).checks.find((check) => check.id === "config_file")?.text;
}

describe("N-A 32.3 (0d38bfa): doctor picks the config file's text by its source", () => {
  test("the default location: valid_at with its display", async () => {
    assert.deepEqual(await configText("default"), { id: "doctor.config_file.valid_at", params: { location: DEFAULT_CONFIG_DISPLAY.windows } });
  });
  for (const source of ["--config", "CODARYN_CONFIG"] as const) {
    test(`${source}: valid_given with the option or the variable`, async () => {
      assert.deepEqual(await configText(source), { id: "doctor.config_file.valid_given", params: { location: source } });
    });
  }
});

const DEFAULT_WORDS: { readonly [L in MessageLanguage]: string } = { en: "default location", ko: "기본 위치" };

describe("doctor names where the config file came from", () => {
  for (const language of ["en", "ko"] as const) {
    test(`${language}: a config at the default location says so`, async () => {
      assert.ok((await configLine("default", language)).includes(DEFAULT_WORDS[language]));
    });

    for (const source of ["--config", "CODARYN_CONFIG"] as const) {
      test(
        `${language}: a config given by ${source} is not called the default location`,
        async () => {
          const line = await configLine(source, language);
          assert.equal(line.includes(DEFAULT_WORDS[language]), false, line);
          assert.ok(line.includes(source), line);
        },
      );
    }
  }
});
