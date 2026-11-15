/**
 * Usability (N-1 to N-3, N-8, N-9, N-15, N-18): unit P0 for the CLI core.
 * Fake values only. Nothing here sends a request: the provider factory is a stub and the model
 * list is a fake. Synthetic values follow the contract review (SYNTHETIC_PRIVATE_VALUE).
 */

import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { DEFAULT_CONFIG_DISPLAY, INIT_DEFAULT_LIMITS, MODEL_PLACEHOLDER, toRunId } from "../../../src/contracts/index.js";
import type {
  CatalogText,
  CreateAnthropicProvider,
  DefaultConfigLocation,
  EngineResult,
  ListRuns,
  MessageCatalog,
  RevertOutcome,
  RevertRun,
  RunTask,
} from "../../../src/cli/../contracts/index.js";
import { parseArgs } from "../../../src/cli/args.js";
import type { Assemble, AssemblyInput } from "../../../src/cli/assemble.js";
import { createRevertCommand } from "../../../src/cli/assemble.js";
import { parseConfig } from "../../../src/cli/config.js";
import { chooseConfigFile, defaultLocationRefused, findDefaultConfigLocation, selectProfile } from "../../../src/cli/config-file.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import { runInit } from "../../../src/cli/init.js";
import type { InitEnvironment } from "../../../src/cli/init.js";
import { jsonErrorOffset, lineAndColumn } from "../../../src/cli/json-position.js";
import { runReport } from "../../../src/cli/report.js";
import { runRevert } from "../../../src/cli/revert.js";
import { defaultConfigNotice, runCli } from "../../../src/cli/run.js";
import type { CliEnvironment, CliRunOutcome } from "../../../src/cli/run.js";
import { isModelPlaceholder, resolveModelId } from "../../../src/cli/settings.js";
import { readRevertRecord, writeRevertRecord } from "../../../src/store/index.js";
import { lexicalLocate } from "./locate.js";

const SYNTHETIC = "SYNTHETIC_PRIVATE_VALUE";
const BASE = path.resolve("/tmp/codaryn-n-unit");
const DEFAULT: DefaultConfigLocation = { path: path.resolve("/tmp/codaryn-n-appdata/Codaryn/config.json"), display: DEFAULT_CONFIG_DISPLAY.windows };
/** Not a real key format. */
const FAKE_KEY = "fake-api-key-not-real-0042";
const LIMITS = { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 10_000, maxDurationMs: 10_000 };
const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

function missing(): Error {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

interface Harness {
  readonly io: CliEnvironment;
  readonly assembled: AssemblyInput[];
  readonly read: string[];
  readonly providers: number[];
}

/** Files by absolute path; a value of null is a file that exists but cannot be read. */
function harness(
  files: Record<string, unknown>,
  options: { argv: readonly string[]; env?: Record<string, string>; defaultConfig?: DefaultConfigLocation | null; cwd?: string } & Partial<CliEnvironment>,
): Harness {
  const assembled: AssemblyInput[] = [];
  const read: string[] = [];
  const providers: number[] = [];
  const result: EngineResult = {
    schemaVersion: 1,
    kind: "run",
    runId: "x",
    taskId: "t",
    status: "done",
    reason: "verified",
    exitCode: 0,
    provider: "scripted",
    verifiers: [],
    changes: [],
    usage: { modelTurns: 1, toolCalls: 0, inputTokens: 1, outputTokens: 1, durationMs: 0 },
    journalPath: ".codaryn/runs/x/journal.jsonl",
    notices: [],
  };
  const assemble: Assemble = async (input) => {
    assembled.push(input);
    const privacy = { mask: (text: string) => ({ ok: true, text }) };
    const journal = { append: async () => {}, close: async () => {} };
    return { ok: true, deps: { task: input.task, privacy, journal } as never, finish: async () => {} };
  };
  const runTask: RunTask = async () => result;
  const createAnthropicProvider: CreateAnthropicProvider = () => {
    providers.push(1);
    return { name: "anthropic", complete: async () => ({ ok: false, kind: "api_error", message: "stub" }) };
  };
  const io: CliEnvironment = {
    env: { ...(options.env ?? {}) },
    cwd: options.cwd ?? BASE,
    readFile: async (file) => {
      read.push(file);
      const key = path.resolve(file);
      if (!(key in files)) throw missing();
      const value = files[key];
      if (value === null) throw Object.assign(new Error("denied"), { code: "EACCES" });
      return typeof value === "string" ? value : JSON.stringify(value);
    },
    isDirectory: async (dir) => dir === path.join(BASE, "work") || dir === BASE,
    loadEnvFile: () => {
      throw new Error("not used");
    },
    locateInWorkspace: lexicalLocate,
    clock: { now: () => Date.UTC(2026, 10, 12, 3, 15, 0) },
    randomBytes: (size) => new Uint8Array(size).fill(0xab),
    assemble,
    runTask,
    createAnthropicProvider,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    defaultConfig: options.defaultConfig === undefined ? DEFAULT : options.defaultConfig,
    ...options,
  };
  return { io, assembled, read, providers };
}

function codeOf(outcome: CliRunOutcome): string {
  return outcome.output.kind === "error" ? outcome.output.code : outcome.output.status;
}

function scriptedTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "n-task",
    goal: "g",
    workflow: "w",
    workspaceRoot: "./work",
    model: { provider: "scripted", scriptPath: "./script.json" },
    policy: POLICY,
    privacy: { secretEnv: [] },
    verifiers: [],
    ...overrides,
  };
}

const TASK_FILES = {
  [path.join(BASE, "task.json")]: scriptedTask(),
  [path.join(BASE, "script.json")]: { schemaVersion: 1, steps: [{ text: "done" }] },
};

describe("N-1 default config location", () => {
  test("Windows uses %APPDATA%\\Codaryn\\config.json; other systems XDG_CONFIG_HOME, else ~/.config", () => {
    assert.deepEqual(findDefaultConfigLocation("win32", { APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, "C:\\Users\\u"), {
      path: "C:\\Users\\u\\AppData\\Roaming\\Codaryn\\config.json",
      display: DEFAULT_CONFIG_DISPLAY.windows,
    });
    assert.deepEqual(findDefaultConfigLocation("win32", { appdata: "D:\\r" }, null)?.path, "D:\\r\\Codaryn\\config.json");
    assert.deepEqual(findDefaultConfigLocation("linux", { XDG_CONFIG_HOME: "/x/cfg" }, "/home/u"), {
      path: "/x/cfg/codaryn/config.json",
      display: DEFAULT_CONFIG_DISPLAY.xdg,
    });
    // A relative XDG_CONFIG_HOME is ignored, as the XDG specification says.
    assert.deepEqual(findDefaultConfigLocation("linux", { XDG_CONFIG_HOME: "rel" }, "/home/u"), {
      path: "/home/u/.config/codaryn/config.json",
      display: DEFAULT_CONFIG_DISPLAY.home,
    });
    assert.equal(findDefaultConfigLocation("linux", {}, null), null);
    assert.equal(findDefaultConfigLocation("win32", {}, "C:\\Users\\u"), null);
  });

  test("a network or device default location is not used, and doctor can tell", () => {
    const env = { APPDATA: "\\\\server\\share\\Roaming" };
    assert.equal(findDefaultConfigLocation("win32", env, null), null);
    assert.equal(defaultLocationRefused("win32", env, null), true);
    assert.equal(defaultLocationRefused("win32", { APPDATA: "C:\\r" }, null), false);
  });

  test("precedence: --config, then CODARYN_CONFIG, then the default location", () => {
    const choose = (argument: string | null, env: Record<string, string>) =>
      chooseConfigFile({ argument, env, cwd: BASE, defaultLocation: DEFAULT });
    const both = choose("a.json", { CODARYN_CONFIG: "b.json" });
    assert.ok(both.ok && both.candidate?.source === "argument" && both.candidate.path === path.join(BASE, "a.json"));
    const env = choose(null, { CODARYN_CONFIG: "b.json" });
    assert.ok(env.ok && env.candidate?.source === "environment" && env.candidate.path === path.join(BASE, "b.json"));
    const fallback = choose(null, {});
    assert.ok(fallback.ok && fallback.candidate?.source === "default" && fallback.candidate.optional);
    const none = chooseConfigFile({ argument: null, env: {}, cwd: BASE, defaultLocation: null });
    assert.ok(none.ok && none.candidate === null);
  });

  test("run reads the default file only when neither --config nor CODARYN_CONFIG is given", async () => {
    const files = { ...TASK_FILES, [DEFAULT.path]: { schemaVersion: 1, limits: LIMITS }, [path.join(BASE, "c.json")]: { schemaVersion: 1, limits: LIMITS } };
    const viaDefault = harness(files, { argv: ["run", "--task", "task.json"] });
    const outcome = await runCli(viaDefault.io);
    assert.equal(codeOf(outcome), "done");
    assert.ok(viaDefault.read.includes(DEFAULT.path));
    // The fact is noted in the result, with the symbolic location only.
    assert.ok(outcome.output.kind === "run" && outcome.output.notices.includes(defaultConfigNotice(DEFAULT.display) as never));
    assert.equal(JSON.stringify(outcome.output).includes(DEFAULT.path), false);
    assert.equal(outcome.info?.summary.configDefault, DEFAULT_CONFIG_DISPLAY.windows);

    for (const options of [{ argv: ["run", "--task", "task.json", "--config", "c.json"] }, { argv: ["run", "--task", "task.json"], env: { CODARYN_CONFIG: "c.json" } }]) {
      const h = harness(files, options);
      assert.equal(codeOf(await runCli(h.io)), "done");
      assert.equal(h.read.includes(DEFAULT.path), false, "the default file is not read");
    }
  });

  test("no file at the default location means no config file, as before; an unreadable one stops the run", async () => {
    // The task has no limits, so without a config the run stops as before N-1 (limits not set).
    const absent = await runCli(harness(TASK_FILES, { argv: ["run", "--task", "task.json"] }).io);
    assert.equal(codeOf(absent), "invalid_task");
    const unreadable = harness({ ...TASK_FILES, [DEFAULT.path]: null }, { argv: ["run", "--task", "task.json"] });
    const outcome = await runCli(unreadable.io);
    assert.equal(codeOf(outcome), "invalid_config");
    assert.ok(outcome.output.kind === "error" && outcome.output.message.includes(DEFAULT_CONFIG_DISPLAY.windows));
    assert.equal(unreadable.assembled.length, 0);
  });

  test("S-1: a default file inside the workspace stops the run before assembly", async () => {
    const inside: DefaultConfigLocation = { path: path.join(BASE, "work", "cfg", "config.json"), display: DEFAULT_CONFIG_DISPLAY.home };
    const h = harness({ ...TASK_FILES, [inside.path]: { schemaVersion: 1, limits: LIMITS } }, { argv: ["run", "--task", "task.json"], defaultConfig: inside });
    const outcome = await runCli(h.io);
    assert.equal(codeOf(outcome), "invalid_config");
    assert.equal(h.assembled.length, 0);
  });
});

describe("N-3 model placeholders", () => {
  test("blank and <...> values count as not set at every level", () => {
    for (const value of ["", "  ", MODEL_PLACEHOLDER, "<모델 ID>", " <x> "]) assert.equal(isModelPlaceholder(value), true, value);
    for (const value of ["claude-x", "<a>b", "a<b>"]) assert.equal(isModelPlaceholder(value), false, value);
    assert.equal(resolveModelId("<model id>", { CODARYN_MODEL: "env-model" }, null), "env-model");
    assert.equal(resolveModelId(undefined, { CODARYN_MODEL: "<x>" }, { schemaVersion: 1, model: "cfg-model" }), "cfg-model");
    assert.equal(resolveModelId(undefined, {}, { schemaVersion: 1, model: "<모델 ID>" }), null);
  });

  test("run: a placeholder model stops as provider_not_configured and nothing is created", async () => {
    const files = {
      [path.join(BASE, "c.json")]: { schemaVersion: 1, model: "<모델 ID>", maxOutputTokens: 100, limits: LIMITS },
    };
    const h = harness(files, { argv: ["run", "--workspace", "work", "--goal", "g", "--config", "c.json"], env: { ANTHROPIC_API_KEY: FAKE_KEY } });
    const outcome = await runCli(h.io);
    assert.equal(codeOf(outcome), "provider_not_configured");
    assert.ok(outcome.output.kind === "error" && outcome.output.message.includes("placeholder"));
    assert.deepEqual(h.providers, []);
    assert.equal(h.assembled.length, 0);
    assert.equal(JSON.stringify(outcome).includes(FAKE_KEY), false);
  });

  test("doctor: a placeholder model fails the model check", async () => {
    const outcome = await runDoctor({
      argv: ["doctor", "--config", "c.json", "--json"],
      env: { ANTHROPIC_API_KEY: FAKE_KEY },
      cwd: BASE,
      nodeVersion: "26.0.0",
      readFile: async (file) => {
        if (path.resolve(file) === path.join(BASE, "c.json")) return JSON.stringify({ schemaVersion: 1, model: MODEL_PLACEHOLDER, maxOutputTokens: 10, limits: LIMITS });
        throw missing();
      },
      isDirectory: async () => false,
      isFile: async () => false,
      locateInWorkspace: lexicalLocate,
      relatePaths: async () => "separate",
    });
    assert.ok("text" in outcome);
    const output = JSON.parse(outcome.text) as { kind: string; checks: { id: string; status: string; message: string }[] };
    assert.equal(output.kind, "doctor");
    const model = output.checks.find((check) => check.id === "model");
    assert.equal(model?.status, "fail");
    assert.ok(model?.message.includes("placeholder"));
  });
});

describe("N-8 profiles", () => {
  const top = { maxModelTurns: 10, maxToolCalls: 10, maxTotalTokens: 1000, maxDurationMs: 10_000 };

  test("a profile limit above the top-level one, or null where it is a number, is invalid_config", () => {
    for (const limits of [{ maxModelTurns: 11 }, { maxTotalTokens: null }]) {
      const outcome = parseConfig({ schemaVersion: 1, limits: top, profiles: { work: { limits } } });
      assert.equal(outcome.ok, false, JSON.stringify(limits));
      // N-14: the profile is named by its position, never by its name.
      assert.ok(!outcome.ok && outcome.message.startsWith("profiles[0].limits."));
      assert.ok(!outcome.ok && !outcome.message.includes("work"));
    }
    assert.ok(parseConfig({ schemaVersion: 1, limits: top, profiles: { work: { limits: { maxModelTurns: 3 } } } }).ok);
    assert.equal(parseConfig({ schemaVersion: 1, profiles: { "bad name": {} } }).ok, false);
    assert.equal(parseConfig({ schemaVersion: 1, profiles: { work: { extra: 1 } } }).ok, false);
  });

  test("--profile overlays policy, verifiers and limits; an unknown name or no config is invalid_config", async () => {
    const parsed = parseConfig({
      schemaVersion: 1,
      limits: top,
      policy: POLICY,
      profiles: { doc: { limits: { maxModelTurns: 2 }, verifiers: [{ id: "v", kind: "file_rules", rules: [{ type: "exists", path: "a" }] }] } },
    });
    assert.ok(parsed.ok);
    const selected = selectProfile(parsed.config, "doc");
    assert.ok(selected.ok);
    assert.deepEqual(selected.config.limits, { ...top, maxModelTurns: 2 });
    assert.equal(selected.config.verifiers?.length, 1);
    assert.equal(selectProfile(parsed.config, "other").ok, false);
    assert.equal(selectProfile(null, "doc").ok, false);

    const files = { ...TASK_FILES, [path.join(BASE, "c.json")]: { schemaVersion: 1, limits: top, profiles: { doc: { limits: { maxModelTurns: 2 } } } } };
    const h = harness(files, { argv: ["run", "--task", "task.json", "--config", "c.json", "--profile", "doc"] });
    assert.equal(codeOf(await runCli(h.io)), "done");
    assert.equal(h.assembled[0]?.task.limits.maxModelTurns, 2, "the profile's limit bounds the task");
    const unknown = await runCli(harness(files, { argv: ["run", "--task", "task.json", "--config", "c.json", "--profile", "nope"] }).io);
    assert.equal(codeOf(unknown), "invalid_config");
    assert.equal(parseArgs(["run", "--task", "t.json", "--profile", "../x"]).ok, false);
  });
});

describe("N-9 one-line run", () => {
  test("the goal is the positional argument and the current directory is the workspace", () => {
    const parsed = parseArgs(["run", "README에 설치 절을 추가한다", "--quiet"]);
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.args.input, { kind: "quick", workspace: ".", goal: "README에 설치 절을 추가한다", oneLine: true });
    for (const argv of [["run", "a", "b"], ["run", "a", "--task", "t.json"], ["run", "a", "--workspace", "w", "--goal", "g"], ["run", " "]]) {
      assert.equal(parseArgs(argv).ok, false, argv.join(" "));
    }
  });

  test("U-3: a one-line run in the install directory is refused before anything is assembled", async () => {
    const files = { [path.join(BASE, "c.json")]: { schemaVersion: 1, model: "m", maxOutputTokens: 10, limits: LIMITS } };
    const h = harness(files, {
      argv: ["run", "fix it", "--config", "c.json"],
      env: { ANTHROPIC_API_KEY: FAKE_KEY },
      installDir: BASE,
      relatePaths: async (target, base) => (path.resolve(target) === path.resolve(base) ? "same" : "separate"),
    });
    const outcome = await runCli(h.io);
    assert.equal(codeOf(outcome), "workspace_is_install_dir");
    assert.equal(h.assembled.length, 0);
    assert.equal(outcome.info?.summary.workspaceForm, "current");
  });

  test("S-8: a key in the one-line goal stops before any file is read", async () => {
    const h = harness({}, { argv: ["run", `use ${FAKE_KEY} please`], env: { ANTHROPIC_API_KEY: FAKE_KEY } });
    const outcome = await runCli(h.io);
    assert.equal(codeOf(outcome), "key_in_file");
    assert.deepEqual(h.read, []);
    assert.equal(JSON.stringify(outcome).includes(FAKE_KEY), false);
  });
});

describe("N-15 input diagnostics", () => {
  test("a JSON syntax error gives the line and column, never the parser's text", async () => {
    const text = '{\n  "schemaVersion": 1,\n  "limits": ,\n  "x": "SYNTHETIC_PRIVATE_VALUE"\n}';
    const outcome = await runCli(harness({ [path.join(BASE, "c.json")]: text }, { argv: ["run", "--workspace", "work", "--goal", "g", "--config", "c.json"] }).io);
    assert.equal(codeOf(outcome), "invalid_config");
    assert.ok(outcome.output.kind === "error");
    assert.deepEqual(outcome.output.diagnostic, { code: "json_syntax", file: "config", field: null, line: 3, column: 13 });
    assert.ok(outcome.output.message.endsWith("(line 3, column 13)"));
    assert.equal(JSON.stringify(outcome.output).includes(SYNTHETIC), false);
  });

  test("an unknown field names its object and the closest allowed name, never the key", async () => {
    const files = { [path.join(BASE, "c.json")]: { schemaVersion: 1, modle: "x", [SYNTHETIC]: 1 } };
    const typo = await runCli(harness({ [path.join(BASE, "c.json")]: { schemaVersion: 1, modle: "x" } }, { argv: ["run", "--workspace", "work", "--goal", "g", "--config", "c.json"] }).io);
    assert.ok(typo.output.kind === "error");
    assert.deepEqual(typo.output.diagnostic, { code: "unknown_field", file: "config", field: "config", line: null, column: null, suggestion: "model" });
    assert.ok(typo.output.message.includes("did you mean model?"));
    assert.equal(typo.output.message.includes("modle"), false);
    const synthetic = await runCli(harness(files, { argv: ["run", "--workspace", "work", "--goal", "g", "--config", "c.json"] }).io);
    assert.equal(JSON.stringify(synthetic.output).includes(SYNTHETIC), false);
    assert.equal(JSON.stringify(synthetic.output).includes("modle"), false);
  });

  test("a value error names its schema field; a profile is named by position", async () => {
    const files = { ...TASK_FILES, [path.join(BASE, "task.json")]: scriptedTask({ limits: { ...LIMITS, maxToolCalls: "many" } }) };
    const outcome = await runCli(harness(files, { argv: ["run", "--task", "task.json"] }).io);
    assert.ok(outcome.output.kind === "error");
    assert.deepEqual(outcome.output.diagnostic, { code: "invalid_value", file: "task", field: "limits.maxToolCalls", line: null, column: null });
    const profile = await runCli(
      harness({ [path.join(BASE, "c.json")]: { schemaVersion: 1, profiles: { [SYNTHETIC]: { limits: { maxModelTurns: 0 } } } } }, {
        argv: ["run", "--workspace", "work", "--goal", "g", "--config", "c.json"],
      }).io,
    );
    assert.ok(profile.output.kind === "error");
    assert.equal(profile.output.diagnostic?.field, "profiles[0].limits.maxModelTurns");
    assert.equal(JSON.stringify(profile.output).includes(SYNTHETIC), false);
  });

  test("the syntax scan agrees with JSON.parse and counts code points", () => {
    for (const text of ['{"a":1}', "[1,2,{\"b\":[true,false,null]}]", '"x"', "-0.5e+3", " {} "]) assert.equal(jsonErrorOffset(text), null, text);
    for (const text of ["", "{", '{"a":}', "[1,]", '{"a" 1}', "01", '"\u0001"', "tru", "{}x", '"\\x"']) {
      assert.throws(() => JSON.parse(text));
      assert.notEqual(jsonErrorOffset(text), null, JSON.stringify(text));
    }
    assert.deepEqual(lineAndColumn("😀😀x", 4), { line: 1, column: 3 });
    assert.deepEqual(lineAndColumn("a\r\nb\rc", 6), { line: 3, column: 2 });
    // Deep nesting does not overflow the stack.
    assert.notEqual(jsonErrorOffset("[".repeat(200_000)), null);
  });
});

/** A message catalog that records ids and parameters; the text is the id. */
function idCatalog(): MessageCatalog & { readonly seen: string[] } {
  const seen: string[] = [];
  const catalog = {
    language: "en" as const,
    seen,
    format(id: string, params?: Record<string, unknown>) {
      seen.push(`${id} ${JSON.stringify(params ?? {})}`);
      return id as CatalogText;
    },
  };
  return catalog as unknown as MessageCatalog & { readonly seen: string[] };
}

describe("N-2 init", () => {
  async function initEnv(overrides: Partial<InitEnvironment> & { answers?: (string | null)[] } = {}) {
    const dir = await mkdtemp(path.join(tmpdir(), "codaryn-unit-init-"));
    temporaryDirs.push(dir);
    const target: DefaultConfigLocation = { path: path.join(dir, "appdata", "Codaryn", "config.json"), display: DEFAULT_CONFIG_DISPLAY.windows };
    const asked: string[] = [];
    const told: string[] = [];
    const written: { file: string; text: string }[] = [];
    const answers = [...(overrides.answers ?? [])];
    const messages = idCatalog();
    const ask =
      overrides.answers === undefined
        ? undefined
        : async (question: string): Promise<string | null> => {
            asked.push(question);
            return answers.length === 0 ? "" : (answers.shift() ?? null);
          };
    const io: InitEnvironment = {
      ...(ask === undefined ? {} : { ask }),
      argv: ["init", "--json"],
      env: {},
      cwd: dir,
      defaultConfig: target,
      messages,
      readFile: (file) => readFile(file, "utf8"),
      isDirectory: async (d) => (await lstat(d).catch(() => null))?.isDirectory() ?? false,
      exists: async (p) => (await lstat(p).catch(() => null)) !== null,
      locateInWorkspace: lexicalLocate,
      makeDirectory: async (d) => {
        await mkdir(d, { recursive: true });
      },
      writeNewFile: async (file, text) => {
        written.push({ file, text });
        await writeFile(file, text, { encoding: "utf8", flag: "wx" });
      },
      tell: (line) => {
        told.push(line);
      },
      ...overrides,
    };
    return { dir, target, io, asked, told, written, messages };
  }

  test("without a terminal it writes the defaults with a placeholder model and asks nothing", async () => {
    const { io, target, asked } = await initEnv({ env: { ANTHROPIC_API_KEY: FAKE_KEY } });
    const outcome = await runInit(io);
    assert.ok("output" in outcome && outcome.output.kind === "init");
    assert.deepEqual(outcome.output, {
      schemaVersion: 1,
      kind: "init",
      status: "created",
      exitCode: 0,
      config: { source: "default", display: DEFAULT_CONFIG_DISPLAY.windows },
      interactive: false,
      model: "placeholder",
      language: null,
      commands: 0,
      protectedPaths: 0,
      keySet: true,
      overriddenBy: null,
    });
    assert.deepEqual(asked, []);
    const written = JSON.parse(await readFile(target.path, "utf8")) as Record<string, unknown>;
    assert.equal(written["model"], MODEL_PLACEHOLDER);
    assert.deepEqual(written["limits"], INIT_DEFAULT_LIMITS);
    assert.deepEqual((written["policy"] as { commands: unknown[] }).commands, []);
    const parsed = parseConfig(written);
    assert.ok(parsed.ok, "init writes a valid config");
  });

  test("an existing file is never overwritten", async () => {
    const { io, target, written } = await initEnv();
    await mkdir(path.dirname(target.path), { recursive: true });
    await writeFile(target.path, "user content", "utf8");
    const outcome = await runInit(io);
    assert.ok("output" in outcome && outcome.output.kind === "error" && outcome.output.code === "config_exists");
    assert.equal(await readFile(target.path, "utf8"), "user content");
    assert.deepEqual(written, []);
    // A file that appears between the check and the write is not overwritten either.
    const race = await initEnv({
      writeNewFile: async () => {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      },
    });
    const raced = await runInit(race.io);
    assert.ok("output" in raced && raced.output.kind === "error" && raced.output.code === "config_exists");
  });

  test("the key is never asked for, read or written, even when it is set", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "codaryn-unit-init-ws-"));
    temporaryDirs.push(workspace);
    // A script body holding a synthetic secret: only the fixed script name may be shown.
    await writeFile(path.join(workspace, "package.json"), JSON.stringify({ scripts: { test: `node t.js ${SYNTHETIC}`, [SYNTHETIC]: "x" } }), "utf8");
    await mkdir(path.join(workspace, "tests"));
    const listed: unknown[] = [];
    const run = await initEnv({
      argv: ["init", "--workspace", workspace],
      env: { ANTHROPIC_API_KEY: FAKE_KEY },
      // create, the provider (Enter: anthropic, U-26), model 1, allow npm test, protect tests
      // (default yes), not package.json, language.
      answers: ["y", "", "1", "y", "", "n", "ko"],
      listModels: async (settings) => {
        listed.push(settings);
        return { ok: true, models: [{ id: "model-a", displayName: "A", createdAt: null, maxInputTokens: null, maxOutputTokens: null }] };
      },
    });
    const outcome = await runInit(run.io);
    assert.ok("text" in outcome && outcome.exitCode === 0);
    const everything = [...run.asked, ...run.told, ...run.messages.seen, outcome.text].join("\n");
    assert.equal(everything.includes(FAKE_KEY), false, "the key is never shown");
    assert.equal(everything.includes(SYNTHETIC), false, "nothing from package.json but the fixed name is shown");
    assert.equal(/api[_ ]?key\??\s*$/im.test(run.asked.join("\n")), false, "no question asks for the key");
    const text = await readFile(run.target.path, "utf8");
    assert.equal(text.includes(FAKE_KEY), false, "the key is never written");
    const config = JSON.parse(text) as { model: string; language: string; policy: { commands: unknown[]; protectedPaths: string[] } };
    assert.equal(config.model, "model-a");
    assert.equal(config.language, "ko");
    assert.deepEqual(config.policy.commands, [{ executable: "npm", argsPrefix: ["test"], allowExtraArgs: false }]);
    assert.deepEqual(config.policy.protectedPaths, ["tests"]);
    assert.equal(listed.length, 1);
  });

  test("declining at the terminal writes nothing; a target inside --workspace is refused (S-1)", async () => {
    const declined = await initEnv({ argv: ["init"], answers: ["n"] });
    const outcome = await runInit(declined.io);
    assert.equal(outcome.exitCode, 3);
    assert.deepEqual(declined.written, []);
    const inside = await initEnv();
    const ws = path.dirname(path.dirname(inside.target.path));
    await mkdir(ws, { recursive: true });
    const refused = await runInit({ ...inside.io, argv: ["init", "--workspace", ws, "--json"] });
    assert.ok("output" in refused && refused.output.kind === "error" && refused.output.code === "invalid_config");
    assert.deepEqual(inside.written, []);
  });
});

describe("N-7, N-18 --run latest and revert --dry-run", () => {
  const RUN = "20261112T020000Z-0a0b0c0d";
  const runId = toRunId(RUN);
  assert.ok(runId !== null);
  const complete: RevertOutcome = { reverted: [{ path: "a.txt", action: "restored" }], skipped: [] };

  async function workspace(extraRuns: string[] = []): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "codaryn-unit-n7-"));
    temporaryDirs.push(dir);
    for (const id of [RUN, ...extraRuns]) {
      await mkdir(path.join(dir, ".codaryn", "runs", id), { recursive: true });
      await writeFile(path.join(dir, ".codaryn", "runs", id, "journal.jsonl"), "", "utf8");
    }
    return dir;
  }
  const revertEnv = (dir: string, argv: string[], revert: ReturnType<typeof createRevertCommand>) => ({
    argv,
    cwd: dir,
    isDirectory: async () => true,
    clock: { now: () => Date.UTC(2026, 10, 12, 3, 15, 0) },
    randomBytes: (size: number) => new Uint8Array(size).fill(0xab),
    revert,
  });
  const listRuns: ListRuns = async () => ({ runs: [{ state: "damaged", runId: toRunId("20261112T090000Z-ffffffff") ?? runId }, { state: "checked", runId, startedAt: "2026-11-12T02:00:00.000Z", taskId: "t", status: "done", reason: "verified", changes: 1, reverted: null, revertRecordDamaged: false }] });

  test("N-18: a run directory named latest makes the alias an error and nothing changes", async () => {
    const dir = await workspace(["latest"]);
    const calls: unknown[] = [];
    const revertRun: RevertRun = async (request) => {
      calls.push(request);
      return complete;
    };
    const outcome = await runRevert(revertEnv(dir, ["revert", "--workspace", dir, "--run", "latest"], createRevertCommand(revertRun, { listRuns })));
    assert.ok(outcome.output.kind === "error" && outcome.output.code === "invalid_arguments");
    assert.deepEqual(calls, []);
    assert.equal(await lstat(path.join(dir, ".codaryn", "lock.json")).then(() => true, () => false), false);
    const report = await runReport({ argv: ["report", "--workspace", dir, "--run", "latest"], cwd: dir, env: {}, listRuns });
    assert.ok("output" in report && report.output.kind === "error" && report.output.code === "invalid_arguments");
  });

  test("latest is the first checked run; damaged runs are never chosen", async () => {
    const dir = await workspace();
    const calls: { runId: string }[] = [];
    const revertRun: RevertRun = async (request) => {
      calls.push(request);
      return complete;
    };
    const outcome = await runRevert(revertEnv(dir, ["revert", "--workspace", dir, "--run", "latest"], createRevertCommand(revertRun, { listRuns })));
    assert.ok(outcome.output.kind === "revert" && outcome.output.runId === RUN);
    assert.equal(calls[0]?.runId, RUN);
    const none = await runRevert(
      revertEnv(dir, ["revert", "--workspace", dir, "--run", "latest"], createRevertCommand(revertRun, { listRuns: async () => ({ runs: [] }) })),
    );
    assert.ok(none.output.kind === "error" && none.output.code === "run_not_found");
  });

  test("--dry-run changes nothing: no lock, no revert record, and only the dry-run store function is called", async () => {
    const dir = await workspace();
    const real: unknown[] = [];
    const dry: unknown[] = [];
    const command = createRevertCommand(
      async (request) => {
        real.push(request);
        return complete;
      },
      {
        dryRun: async (request) => {
          dry.push(request);
          return complete;
        },
      },
    );
    const outcome = await runRevert(revertEnv(dir, ["revert", "--workspace", dir, "--run", RUN, "--dry-run"], command));
    assert.ok(outcome.output.kind === "revert");
    assert.equal(outcome.output.dryRun, true);
    assert.deepEqual(real, []);
    assert.equal((dry[0] as { dryRun?: boolean }).dryRun, true);
    for (const name of ["lock.json", path.join("runs", RUN, "revert.json")]) {
      assert.equal(await lstat(path.join(dir, ".codaryn", name)).then(() => true, () => false), false, name);
    }
    // A build whose store does not honour dryRun refuses before anything is read.
    const unsupported = await runRevert(revertEnv(dir, ["revert", "--workspace", dir, "--run", RUN, "--dry-run"], createRevertCommand(async () => {
      throw new Error("must not be called");
    })));
    assert.ok(unsupported.output.kind === "error" && unsupported.output.code === "internal_error");
  });

  test("a real revert writes the record; the next revert reports it, and a forged record is ignored", async () => {
    const dir = await workspace();
    // N-22: the store's record functions.
    const command = createRevertCommand(async () => complete, { readRecord: readRevertRecord, writeRecord: writeRevertRecord });
    const first = await runRevert(revertEnv(dir, ["revert", "--workspace", dir, "--run", RUN, "--quiet"], command));
    assert.ok(first.output.kind === "revert" && first.output.revertedBefore === undefined);
    assert.equal(first.quiet, true);
    const record = JSON.parse(await readFile(path.join(dir, ".codaryn", "runs", RUN, "revert.json"), "utf8")) as Record<string, unknown>;
    // DR-25: the record also says how the person consented to unsafe moves (none here) and how many went back so.
    assert.deepEqual(record, {
      schemaVersion: 1,
      kind: "revert_record",
      runId: RUN,
      at: "2026-11-12T03:15:00.000Z",
      status: "complete",
      reverted: 1,
      skipped: 0,
      unsafeMoveConsent: null,
      unsafeMoves: 0,
    });
    const second = await runRevert(revertEnv(dir, ["revert", "--workspace", dir, "--run", RUN], command));
    assert.ok(second.output.kind === "revert");
    assert.deepEqual(second.output.revertedBefore, { at: "2026-11-12T03:15:00.000Z", status: "complete" });
    for (const forged of [{ ...record, runId: "other" }, { ...record, at: SYNTHETIC }, { ...record, status: SYNTHETIC }]) {
      await writeFile(path.join(dir, ".codaryn", "runs", RUN, "revert.json"), JSON.stringify(forged), "utf8");
      // N-23: a record that fails the checks is ignored, never an error.
      const third = await runRevert(
        revertEnv(dir, ["revert", "--workspace", dir, "--run", RUN, "--dry-run"], createRevertCommand(async () => complete, { dryRun: async () => complete, readRecord: readRevertRecord })),
      );
      assert.ok(third.output.kind === "revert");
      assert.equal(third.output.revertedBefore, undefined, JSON.stringify(forged));
      assert.equal(JSON.stringify(third.output).includes(SYNTHETIC), false);
    }
  });
});
