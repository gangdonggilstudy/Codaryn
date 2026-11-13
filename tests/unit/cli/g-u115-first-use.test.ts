/**
 * U-115 (UXM-9, PM: the proposal in report section 97, adopted): the first use, at a terminal only.
 * - `codaryn` and `codaryn --help` showed the full help: fourteen usage lines (up to about 240
 *   characters), no order and nothing on what each command does. At a terminal they now show the
 *   short help: the first steps in order, the way to try without a key, one line per command in the
 *   first-use order, and `codaryn help <command>` for the usage. Not at a terminal: as before.
 * - doctor listed its checks and ended with "doctor: failed (exit code 1)"; nothing said, in one
 *   place, what was not set up yet and what to do in which order. At a terminal it now adds that
 *   after its closing line (numbered, from the checks' texts in a fixed order), or the next command
 *   when nothing is left. The check lines and doctor --json are as before.
 * - init at a terminal adds the way to try without a key when the key is not set.
 * - A run that found no config file at all said "config file — limits.maxModelTurns is not valid",
 *   as if a file were there. It now carries the hint config_missing (U-37): the error JSON gains
 *   that hint value only; its message, code and exit code are as before.
 * In process with a stand-in for the terminal flag; fake keys built from parts; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV, DEFAULT_CONFIG_DISPLAY, HELP_COMMANDS } from "../../../src/contracts/index.js";
import type { CliErrorOutput, DefaultConfigLocation, InitOutput, MessageCatalog, MessageId } from "../../../src/contracts/index.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import type { DoctorEnvironment } from "../../../src/cli/doctor.js";
import { helpText } from "../../../src/cli/help.js";
import { renderInit } from "../../../src/cli/init.js";
import { runCli } from "../../../src/cli/run.js";
import type { CliEnvironment } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const english = createMessageCatalog("en");
const korean = createMessageCatalog("ko");
const en = (id: MessageId, params?: Record<string, unknown>): string => (english.format as (id: MessageId, params?: Record<string, unknown>) => string)(id, params);
/** Not real key formats; built from parts (G-10). */
const FAKE_KEY = ["fake", "u115", "key", "0042"].join("-");
const KEY_WITH_SPACE = ["fake", "u115", "key"].join(" ");
const WINDOWS_DEFAULT = DEFAULT_CONFIG_DISPLAY.windows;
const LIMITS = { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 10_000, maxDurationMs: 60_000 };
const READY_CONFIG = { schemaVersion: 1, model: "fake-model-u115", maxOutputTokens: 1000, limits: LIMITS };

/** helpText with U-115's third argument. */
const help = (command: (typeof HELP_COMMANDS)[number] | null, catalog: MessageCatalog, terminal?: boolean): string =>
  (helpText as unknown as (command: unknown, catalog: MessageCatalog, options?: { terminal: boolean }) => string)(command, catalog, terminal === undefined ? undefined : { terminal });

const FIRST_USE_ORDER = ["init", "doctor", "models", "run", "runs", "report", "changes", "revert", "plan", "apply", "review", "cleanup"] as const;

describe("U-115 (A): the short help at a terminal", () => {
  test("English, line by line", () => {
    assert.equal(
      help(null, english, true),
      [
        en("help.intro"),
        "",
        'First time? In this order: codaryn init -> codaryn doctor -> codaryn run "<task>" -> codaryn report --run latest',
        "To try the flow without a key: docs/usage.md section 3 (examples/demo)",
        "",
        en("help.commands_heading"),
        "  init     create the config file",
        "  doctor   check what a run needs (no network access)",
        "  models   list the models and choose one",
        "  run      run one task",
        "  runs     list the runs",
        "  report   show one run's report",
        "  changes  show the files a run changed",
        "  revert   put back what a run changed",
        "  plan     show a plan run's plan",
        "  apply    approve a plan and apply it",
        "  review   record a verdict on a run waiting for review",
        "  cleanup  clean up run records and discarded files",
        "",
        "Options and usage of each command: codaryn help <command> (e.g. codaryn help run). Version: codaryn --version",
        en("help.key"),
        en("help.output"),
        en("help.contract"),
        "",
      ].join("\n"),
    );
  });

  test("every command once, in the first-use order, in Korean too; no usage line", () => {
    assert.deepEqual([...FIRST_USE_ORDER].sort(), [...HELP_COMMANDS].sort());
    const shown = help(null, korean, true);
    const named = shown.split("\n").flatMap((line) => (/^ {2}([a-z]+) {2,}/.exec(line)?.[1] ?? []));
    assert.deepEqual(named, [...FIRST_USE_ORDER]);
    assert.equal(shown.includes("codaryn run ("), false, shown);
    assert.ok(shown.includes("처음이라면 이 순서로: codaryn init -> codaryn doctor"), shown);
  });

  test("not at a terminal, and each command's own help: exactly as before", () => {
    for (const catalog of [english, korean]) {
      assert.equal(help(null, catalog, false), help(null, catalog));
      assert.ok(help(null, catalog).includes('  codaryn run ("<goal>" | --task <task.json>'), "the full usage lines");
      for (const command of HELP_COMMANDS) assert.equal(help(command, catalog, true), help(command, catalog));
    }
  });
});

async function base(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "codaryn-g-u115-"));
  temporaryDirs.push(dir);
  await mkdir(path.join(dir, "work"));
  return dir;
}

function doctorIo(dir: string, argv: readonly string[], extra: Partial<DoctorEnvironment> & { stdoutIsTerminal?: boolean } = {}): DoctorEnvironment {
  return {
    argv: ["doctor", ...argv],
    env: {},
    cwd: dir,
    nodeVersion: "26.13.0",
    readFile: (file) => readFile(file, "utf8"),
    isDirectory: async (target) => (await stat(target).catch(() => null))?.isDirectory() ?? false,
    isFile: async (target) => (await stat(target).catch(() => null))?.isFile() ?? false,
    locateInWorkspace: (file, root) => locateInWorkspace(file, root),
    relatePaths: (target, root) => relateRealPaths(target, root),
    messages: english,
    ...extra,
  } as DoctorEnvironment;
}

/** doctor's text at a terminal and not, and its JSON at a terminal and not. */
async function doctor(dir: string, argv: readonly string[], extra: Partial<DoctorEnvironment> = {}) {
  const text = async (terminal: boolean | undefined) => {
    const outcome = await runDoctor(doctorIo(dir, argv, { ...extra, ...(terminal === undefined ? {} : { stdoutIsTerminal: terminal }) }));
    assert.ok("text" in outcome, JSON.stringify(outcome));
    return outcome.text;
  };
  const json = async (terminal: boolean) => {
    const outcome = await runDoctor(doctorIo(dir, [...argv, "--json"], { ...extra, stdoutIsTerminal: terminal }));
    assert.ok("text" in outcome, JSON.stringify(outcome));
    return outcome.text;
  };
  const plain = await text(undefined);
  const notTerminal = await text(false);
  const terminal = await text(true);
  assert.equal(notTerminal, plain, "not at a terminal: as before");
  assert.ok(terminal.startsWith(plain), "the check lines and the closing line are as before");
  assert.equal(await json(true), await json(false), "doctor --json is as before");
  return terminal.slice(plain.length).split("\n").slice(0, -1);
}

const keyEnv = (key: string) => ({ [ANTHROPIC_API_KEY_ENV]: key });
const KEY = { keyEnv: ANTHROPIC_API_KEY_ENV };

describe("U-115 (B): doctor says, at a terminal, what is not set up yet and what to do next", () => {
  test("nothing set up (no config file at the default location, no key): init, the key, the model, again", async () => {
    const dir = await base();
    const defaultConfig: DefaultConfigLocation = { path: path.join(dir, "home", "config.json"), display: WINDOWS_DEFAULT };
    assert.deepEqual(await doctor(dir, [], { defaultConfig }), [
      en("doctor.next.heading"),
      `  1. ${en("doctor.next.init")}`,
      `  2. ${en("doctor.next.key", KEY)}`,
      `  3. ${en("doctor.next.model_after_key")}`,
      `  4. ${en("doctor.next.again")}`,
      en("first_use.try_without_key"),
    ]);
  });

  test("after init (the model a placeholder, no key): the key, the model, again", async () => {
    const dir = await base();
    await writeFile(path.join(dir, "c.json"), JSON.stringify({ ...READY_CONFIG, model: "<choose a model>" }), "utf8");
    assert.deepEqual(await doctor(dir, ["--config", "c.json"]), [
      en("doctor.next.heading"),
      `  1. ${en("doctor.next.key", KEY)}`,
      `  2. ${en("doctor.next.model_after_key")}`,
      `  3. ${en("doctor.next.again")}`,
      en("first_use.try_without_key"),
    ]);
  });

  test("a key that cannot be sent: check it, again; no line about trying without a key", async () => {
    const dir = await base();
    await writeFile(path.join(dir, "c.json"), JSON.stringify(READY_CONFIG), "utf8");
    assert.deepEqual(await doctor(dir, ["--config", "c.json"], { env: keyEnv(KEY_WITH_SPACE) }), [
      en("doctor.next.heading"),
      `  1. ${en("doctor.next.key_unusable", KEY)}`,
      `  2. ${en("doctor.next.again")}`,
    ]);
  });

  test("another failed check (a command that is not found): counted, again", async () => {
    const dir = await base();
    const policy = { commands: [{ executable: "cdy-missing-tool-u115", argsPrefix: [], allowExtraArgs: false }], network: "deny", destructive: "deny", restorePathTokens: false };
    await writeFile(path.join(dir, "c.json"), JSON.stringify({ ...READY_CONFIG, policy }), "utf8");
    assert.deepEqual(await doctor(dir, ["--config", "c.json"], { env: { ...keyEnv(FAKE_KEY), PATH: "" } }), [
      en("doctor.next.heading"),
      `  1. ${en("doctor.next.other", { count: 1 })}`,
      `  2. ${en("doctor.next.again")}`,
    ]);
  });

  test("ready: the next command, without a heading", async () => {
    const dir = await base();
    await writeFile(path.join(dir, "c.json"), JSON.stringify(READY_CONFIG), "utf8");
    assert.deepEqual(await doctor(dir, ["--config", "c.json"], { env: keyEnv(FAKE_KEY) }), [en("doctor.next.ready")]);
  });

  test("ready with a task file: the run of that task", async () => {
    const dir = await base();
    await writeFile(path.join(dir, "s.json"), JSON.stringify({ schemaVersion: 1, steps: [{ text: "done" }] }), "utf8");
    const task = {
      schemaVersion: 1,
      id: "u115",
      goal: "g",
      workflow: "test",
      workspaceRoot: "./work",
      model: { provider: "scripted", scriptPath: "./s.json" },
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
      privacy: { secretEnv: [] },
      limits: LIMITS,
      verifiers: [],
    };
    await writeFile(path.join(dir, "task.json"), JSON.stringify(task), "utf8");
    assert.deepEqual(await doctor(dir, ["--task", path.join(dir, "task.json")]), [en("doctor.next.ready_task")]);
  });
});

const INIT: InitOutput = {
  schemaVersion: 1,
  kind: "init",
  status: "created",
  exitCode: 0,
  config: { source: "default", display: WINDOWS_DEFAULT },
  interactive: true,
  model: "placeholder",
  language: null,
  commands: 0,
  protectedPaths: 0,
  keySet: false,
  overriddenBy: null,
};
const init = (output: InitOutput, terminal?: boolean): string =>
  (renderInit as unknown as (output: InitOutput, messages: MessageCatalog, platform: NodeJS.Platform, options?: { terminal: boolean }) => string)(
    output,
    english,
    "win32",
    terminal === undefined ? undefined : { terminal },
  );

describe("U-115 (E): init at a terminal adds the way to try without a key", () => {
  test("no key: after its next line; with the key: nothing; not at a terminal: as before", () => {
    assert.equal(init(INIT, true), `${init(INIT)}${en("first_use.try_without_key")}\n`);
    assert.equal(init(INIT, false), init(INIT));
    assert.equal(init({ ...INIT, keySet: true }, true), init({ ...INIT, keySet: true }));
    assert.ok(init(INIT).endsWith(`${en("init.next")}\n`));
  });
});

describe("U-115 (c): a run that finds no config file at all carries the hint config_missing", () => {
  async function run(dir: string, argv: readonly string[], defaultConfig: DefaultConfigLocation | null): Promise<{ output: CliErrorOutput; exitCode: number }> {
    const io = {
      argv: ["run", ...argv],
      env: keyEnv(FAKE_KEY),
      cwd: dir,
      readFile: (file: string) => readFile(file, "utf8"),
      isDirectory: async (target: string) => (await stat(target).catch(() => null))?.isDirectory() ?? false,
      loadEnvFile: () => {},
      locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
      clock: { now: () => Date.now() },
      randomBytes: (size: number) => new Uint8Array(size).fill(7),
      assemble: async () => {
        throw new Error("nothing is assembled in these cases");
      },
      cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
      ...(defaultConfig === null ? {} : { defaultConfig }),
    } as CliEnvironment;
    const outcome = await runCli(io);
    assert.equal(outcome.output.kind, "error", JSON.stringify(outcome.output));
    return { output: outcome.output as CliErrorOutput, exitCode: outcome.exitCode };
  }
  const quick = (dir: string) => ["--workspace", path.join(dir, "work"), "--goal", "add an install section"];

  test("none at the default location: invalid_config, exit 2, the same message, and the hint", async () => {
    const dir = await base();
    const missing = await run(dir, quick(dir), { path: path.join(dir, "home", "config.json"), display: WINDOWS_DEFAULT });
    const noDefault = await run(dir, quick(dir), null);
    assert.deepEqual([missing.output.code, missing.exitCode, missing.output.hint], ["invalid_config", 2, "config_missing"]);
    assert.equal(missing.output.message, noDefault.output.message, "the message is as before");
    assert.deepEqual(missing.output.diagnostic, noDefault.output.diagnostic, "the diagnostic is as before");
  });

  test("a config file that is there but lacks the limits, and no default location at all: no hint", async () => {
    const dir = await base();
    await writeFile(path.join(dir, "c.json"), JSON.stringify({ schemaVersion: 1, model: "fake-model-u115", maxOutputTokens: 1000 }), "utf8");
    const given = await run(dir, [...quick(dir), "--config", "c.json"], null);
    assert.deepEqual([given.output.code, given.output.hint], ["invalid_config", undefined]);
    const atDefault = await run(dir, quick(dir), { path: path.join(dir, "c.json"), display: WINDOWS_DEFAULT });
    assert.deepEqual([atDefault.output.code, atDefault.output.hint], ["invalid_config", undefined]);
    assert.equal((await run(dir, quick(dir), null)).output.hint, undefined);
  });
});
