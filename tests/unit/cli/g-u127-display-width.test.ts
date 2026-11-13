/**
 * U-127 (PM, after U-125): doctor's table and the models table lined up their columns by counting
 * characters, so Korean (two terminal columns per character) pushed every column after it: the
 * Korean doctor table's labels and texts, and the lines indented under a check, did not line up;
 * a model whose name holds wide characters pushed the token columns. Now both use the one terminal
 * width (src/cli/human displayWidth, padEnd, padStart). English (and every ASCII text) is the same
 * to the character, as before: displayWidth of ASCII is its length. The JSON is not touched.
 * The renderers on made-up and real doctor outputs; nothing is read or sent.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { DEFAULT_CONFIG_DISPLAY, DOCTOR_CHECK_IDS } from "../../../src/contracts/index.js";
import type { DoctorOutput, MessageCatalog, MessageId, ModelsOutput } from "../../../src/contracts/index.js";
import { renderDoctor, runDoctor } from "../../../src/cli/doctor.js";
import type { DoctorEnvironment } from "../../../src/cli/doctor.js";
import { displayWidth } from "../../../src/cli/human/index.js";
import { renderModels } from "../../../src/cli/models.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";

const dirs: string[] = [];
after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

const korean = createMessageCatalog("ko");
const english = createMessageCatalog("en");

/** A doctor output with nothing set up (no config at the default location, no key), as JSON. */
async function doctorOutput(): Promise<DoctorOutput> {
  const dir = await mkdtemp(path.join(tmpdir(), "codaryn-g-u127-"));
  dirs.push(dir);
  const io: DoctorEnvironment = {
    argv: ["doctor", "--json"],
    env: {},
    cwd: dir,
    nodeVersion: "26.13.0",
    readFile: (file) => readFile(file, "utf8"),
    isDirectory: async (target) => (await stat(target).catch(() => null))?.isDirectory() ?? false,
    isFile: async (target) => (await stat(target).catch(() => null))?.isFile() ?? false,
    locateInWorkspace: (file, root) => locateInWorkspace(file, root),
    relatePaths: (target, root) => relateRealPaths(target, root),
    defaultConfig: { path: path.join(dir, "home", "config.json"), display: DEFAULT_CONFIG_DISPLAY.windows },
  };
  const outcome = await runDoctor(io);
  assert.ok("text" in outcome);
  return JSON.parse(outcome.text) as DoctorOutput;
}

/** For each check line: the terminal column where its label starts and where its text starts. */
function columns(text: string, catalog: MessageCatalog): { label: number[]; body: number[]; indented: number[] } {
  const lines = text.split("\n");
  const label: number[] = [];
  const body: number[] = [];
  for (const id of DOCTOR_CHECK_IDS) {
    const name = (catalog.format as (id: MessageId) => string)(`doctor.check.${id}` as MessageId);
    const line = lines.find((entry) => entry.startsWith("[") && entry.includes(`${name} `) && entry.indexOf(name) <= 16);
    assert.ok(line !== undefined, `${id}:\n${text}`);
    const at = line.indexOf(name);
    label.push(displayWidth(line.slice(0, at)));
    let start = at + name.length;
    while (line[start] === " ") start++;
    body.push(displayWidth(line.slice(0, start)));
  }
  const indented = lines.filter((line) => line.startsWith("   ")).map((line) => line.length - line.trimStart().length);
  return { label, body, indented };
}

const same = (values: readonly number[]): boolean => values.every((value) => value === values[0]);

describe("U-127: doctor's table lines up by terminal width", () => {
  test("Korean: every label starts at one column, every text at one column, the indented lines under it", async () => {
    const shown = renderDoctor(await doctorOutput(), korean, "win32");
    const { label, body, indented } = columns(shown, korean);
    assert.ok(same(label), `labels: ${label.join(",")}\n${shown}`);
    assert.ok(same(body), `texts: ${body.join(",")}\n${shown}`);
    assert.ok(indented.length > 0 && indented.every((column) => column === body[0]), `indented: ${indented.join(",")} (texts at ${body[0]})\n${shown}`);
  });

  test("English: the same columns by length, and the text as before (the status column is ten, then the widest label and two spaces)", async () => {
    const output = await doctorOutput();
    const shown = renderDoctor(output, english, "win32");
    const { label, body } = columns(shown, english);
    assert.ok(same(label) && label[0] === 10, shown);
    const widest = Math.max(...DOCTOR_CHECK_IDS.map((id) => (english.format as (id: MessageId) => string)(`doctor.check.${id}` as MessageId).length));
    assert.ok(same(body) && body[0] === 10 + widest + 2, shown);
  });
});

const MODELS: ModelsOutput = {
  schemaVersion: 1,
  kind: "models",
  status: "listed",
  exitCode: 0,
  models: [
    { number: 1, id: "fake-model-a", displayName: "Fake A", createdAt: null, maxInputTokens: 200000, maxOutputTokens: 8192 },
    { number: 2, id: "fake-model-b", displayName: "가짜 모델 비", createdAt: null, maxInputTokens: 1000, maxOutputTokens: 64000 },
  ],
  current: { id: "fake-model-a", source: "config", listed: true },
  selected: null,
};

describe("U-127: the models table lines up by terminal width", () => {
  test("a name with wide characters: the token columns end at the same column in every row", () => {
    const rows = renderModels(MODELS, true).split("\n").slice(2, 5);
    const ends = rows.map((row) => displayWidth(row));
    assert.ok(same(ends), `row widths ${ends.join(",")}:\n${rows.join("\n")}`);
  });

  test("ASCII names: the table as before, by length", () => {
    const ascii: ModelsOutput = { ...MODELS, models: MODELS.models.map((model) => ({ ...model, displayName: `Fake ${model.number}` })) };
    const rows = renderModels(ascii, true).split("\n").slice(2, 5);
    assert.deepEqual(rows, [
      "  #  id            name    input tokens  output tokens",
      "* 1  fake-model-a  Fake 1        200000           8192",
      "  2  fake-model-b  Fake 2          1000          64000",
    ]);
  });
});
