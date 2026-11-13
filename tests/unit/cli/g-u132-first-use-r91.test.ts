/**
 * U-132 (review R-91, the four low findings on U-115's first-use lines), at a terminal only:
 * - L-1: with no default config location at all, doctor said "codaryn init", which fails there; now
 *   it says to make the file with --config and to give it to each run (doctor.next.init_with_config).
 * - L-2: four new lines were wider than 100 columns: the first steps are now a heading and an
 *   indented command line, the version leaves help.more for its own line, and the key line is
 *   shorter. Every new line fits 100 columns in both languages, with either key variable.
 * - L-3: "Next: codaryn run ..." did not say the run works in the folder it starts in, and doctor
 *   given --workspace checked another folder than that run would use: now the line says where, and
 *   after --workspace it is the quick form with --workspace (doctor.next.ready_workspace).
 * - L-4: after a key that cannot be sent, the model step said "once the key is registered"; now
 *   "once the key value is fixed" (doctor.next.model_after_key_fix).
 * Not at a terminal, and every JSON, as before. In process; fake keys built from parts.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV, OPENAI_API_KEY_ENV } from "../../../src/contracts/index.js";
import type { MessageCatalog, MessageId } from "../../../src/contracts/index.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import type { DoctorEnvironment } from "../../../src/cli/doctor.js";
import { helpText } from "../../../src/cli/help.js";
import { displayWidth } from "../../../src/cli/human/index.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";

const dirs: string[] = [];
after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

const english = createMessageCatalog("en");
const korean = createMessageCatalog("ko");
const say = (catalog: MessageCatalog, id: string, params?: Record<string, unknown>): string =>
  (catalog.format as (id: MessageId, params?: Record<string, unknown>) => string)(id as MessageId, params);
const en = (id: string, params?: Record<string, unknown>): string => say(english, id, params);
const KEY_WITH_SPACE = ["fake", "u132", "key"].join(" ");
const LIMITS = { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 10_000, maxDurationMs: 60_000 };

describe("U-132 (R-91 L-2): the short help's new lines fit 100 columns", () => {
  test("the first steps: a heading, then the commands indented two; help.more, then the version", () => {
    const lines = helpText(null, english, { terminal: true }).split("\n");
    const at = lines.indexOf(en("help.first_steps"));
    assert.ok(at > 0, lines.join("\n"));
    assert.deepEqual(lines.slice(at, at + 3), [en("help.first_steps"), `  ${en("help.first_steps_commands")}`, en("first_use.try_without_key")]);
    const more = lines.indexOf(en("help.more"));
    assert.deepEqual(lines.slice(more, more + 2), [en("help.more"), en("help.version")]);
    assert.ok(en("help.first_steps").includes("current folder"), "L-3: where a run works");
  });

  test("every line the short help adds, in both languages, is at most 100 columns", () => {
    for (const catalog of [english, korean]) {
      const shown = helpText(null, catalog, { terminal: true }).split("\n");
      // help.intro, help.key, help.output and help.contract come from the full help as they were.
      const kept = new Set(["help.intro", "help.key", "help.output", "help.contract"].map((id) => say(catalog, id)));
      for (const line of shown.filter((entry) => !kept.has(entry))) assert.ok(displayWidth(line) <= 100, `${displayWidth(line)}: ${line}`);
    }
  });
});

describe("U-132 (R-91 L-2): every next-step line of doctor fits 100 columns", () => {
  test("in both languages, numbered, with either key variable", () => {
    const steps = ["init", "init_with_config", "config_fix", "key", "key_unusable", "model", "model_after_key", "model_after_key_fix", "other", "warnings", "again"];
    const lines = ["heading", "ready", "ready_workspace", "ready_task"];
    for (const catalog of [english, korean]) {
      for (const keyEnv of [ANTHROPIC_API_KEY_ENV, OPENAI_API_KEY_ENV]) {
        for (const id of steps) {
          const params = id === "key" || id === "key_unusable" ? { keyEnv } : id === "other" || id === "warnings" ? { count: 99 } : undefined;
          const line = `  9. ${say(catalog, `doctor.next.${id}`, params)}`;
          assert.ok(displayWidth(line) <= 100, `${displayWidth(line)}: ${line}`);
        }
      }
      for (const id of lines) {
        const line = say(catalog, `doctor.next.${id}`);
        assert.ok(displayWidth(line) <= 100, `${displayWidth(line)}: ${line}`);
      }
      const keyless = say(catalog, "first_use.try_without_key");
      assert.ok(displayWidth(keyless) <= 100, keyless);
    }
  });
});

async function base(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "codaryn-g-u132-"));
  dirs.push(dir);
  await mkdir(path.join(dir, "work"));
  return dir;
}

/** doctor's lines after its closing line at a terminal; the text not at a terminal must be the same up to there. */
async function nextSteps(dir: string, argv: readonly string[], extra: Partial<DoctorEnvironment> = {}): Promise<string[]> {
  const io = (terminal: boolean): DoctorEnvironment =>
    ({
      argv: ["doctor", ...argv],
      env: {},
      cwd: dir,
      nodeVersion: "26.13.0",
      readFile: (file: string) => readFile(file, "utf8"),
      isDirectory: async (target: string) => (await stat(target).catch(() => null))?.isDirectory() ?? false,
      isFile: async (target: string) => (await stat(target).catch(() => null))?.isFile() ?? false,
      locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
      relatePaths: (target: string, root: string) => relateRealPaths(target, root),
      messages: english,
      stdoutIsTerminal: terminal,
      ...extra,
    }) as DoctorEnvironment;
  const plain = await runDoctor(io(false));
  const shown = await runDoctor(io(true));
  assert.ok("text" in plain && "text" in shown);
  assert.ok(shown.text.startsWith(plain.text), "the check lines are as before");
  return shown.text.slice(plain.text.length).split("\n").slice(0, -1);
}

describe("U-132 (R-91 L-1, L-3, L-4): doctor's next steps", () => {
  test("L-1: no default config location at all: make the file with --config, not codaryn init", async () => {
    const dir = await base();
    const steps = await nextSteps(dir, []);
    assert.equal(steps[1], `  1. ${en("doctor.next.init_with_config")}`, steps.join("\n"));
    assert.equal(steps.includes(`  1. ${en("doctor.next.init")}`), false);
  });

  test("L-4: a key that cannot be sent and a placeholder model: the model once the key value is fixed", async () => {
    const dir = await base();
    await writeFile(path.join(dir, "c.json"), JSON.stringify({ schemaVersion: 1, model: "<choose a model>", maxOutputTokens: 1000, limits: LIMITS }), "utf8");
    assert.deepEqual(await nextSteps(dir, ["--config", "c.json"], { env: { [ANTHROPIC_API_KEY_ENV]: KEY_WITH_SPACE } }), [
      en("doctor.next.heading"),
      `  1. ${en("doctor.next.key_unusable", { keyEnv: ANTHROPIC_API_KEY_ENV })}`,
      `  2. ${en("doctor.next.model_after_key_fix")}`,
      `  3. ${en("doctor.next.again")}`,
    ]);
  });

  test("L-3: ready without --workspace: the run in the folder to work in; with --workspace: the quick form", async () => {
    const dir = await base();
    await writeFile(path.join(dir, "c.json"), JSON.stringify({ schemaVersion: 1, model: "fake-model-u132", maxOutputTokens: 1000, limits: LIMITS }), "utf8");
    const env = { [ANTHROPIC_API_KEY_ENV]: ["fake", "u132", "key", "0042"].join("-") };
    assert.deepEqual(await nextSteps(dir, ["--config", "c.json"], { env }), [en("doctor.next.ready")]);
    assert.ok(en("doctor.next.ready").includes("folder"), "it says where the run works");
    assert.deepEqual(await nextSteps(dir, ["--config", "c.json", "--workspace", "work"], { env }), [en("doctor.next.ready_workspace")]);
  });
});
