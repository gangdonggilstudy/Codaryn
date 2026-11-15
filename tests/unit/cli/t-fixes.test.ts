/**
 * Fix batch T, CLI side: T-1 (assembly command runner), T-12 (revert and cancel file paths),
 * T-13 (one protectedPaths rule), T-14 (maxOutputTokens cap), T-15 (--vars-file).
 * Real assembly on temporary directories, scripted model, fake values only, no network.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { MAX_OUTPUT_TOKENS_LIMIT } from "../../../src/contracts/index.js";
import { parseArgs } from "../../../src/cli/args.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { parseConfig } from "../../../src/cli/config.js";
import { runRevert } from "../../../src/cli/revert.js";
import { runCli } from "../../../src/cli/run.js";
import type { CliEnvironment } from "../../../src/cli/run.js";
import { locateInWorkspace } from "../../../src/cli/security/index.js";
import { parseTask } from "../../../src/cli/task.js";
import { recordedText } from "./locate.js";

const IS_WINDOWS = process.platform === "win32";
const FAKE_SECRET = "fake-secret-T1-VALUE-0042";
const temporaryDirs: string[] = [];

after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

async function newBase(): Promise<string> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-unit-t-"));
  temporaryDirs.push(base);
  await mkdir(path.join(base, "work"));
  return base;
}

async function writeTask(base: string, task: Record<string, unknown>, steps: unknown[]): Promise<string> {
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  const file = path.join(base, "task.json");
  await writeFile(
    file,
    JSON.stringify({
      schemaVersion: 1,
      id: "t-fixes",
      goal: "check the fix batch",
      workflow: "test",
      workspaceRoot: "./work",
      model: { provider: "scripted", scriptPath: "./script.json" },
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
      privacy: { secretEnv: ["CODARYN_UNIT_SECRET"] },
      limits: { maxModelTurns: 6, maxToolCalls: 10, maxTotalTokens: null, maxDurationMs: 60_000 },
      verifiers: [],
      ...task,
    }),
    "utf8",
  );
  return file;
}

function io(base: string, argv: readonly string[], extra: Partial<CliEnvironment> = {}): CliEnvironment {
  return {
    argv,
    env: { CODARYN_UNIT_SECRET: FAKE_SECRET },
    cwd: base,
    readFile: (file) => readFile(file, "utf8"),
    isDirectory: async (dir) => {
      try {
        return (await stat(dir)).isDirectory();
      } catch {
        return false;
      }
    },
    loadEnvFile: () => {
      throw new Error("no vars file in this test");
    },
    locateInWorkspace: (file, root) => locateInWorkspace(file, root),
    clock: { now: () => Date.now() },
    randomBytes: (size) => randomBytes(size),
    assemble: assembleRun,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    ...extra,
  };
}

/** Sets process.env values for one test and puts the old ones back. */
async function withEnv<T>(values: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  Object.assign(process.env, values);
  try {
    return await run();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe("T-1 the assembly builds one command runner with the env check and the workspace root", () => {
  test("a .cmd outside the workspace runs for a tool and for a verifier", { skip: !IS_WINDOWS }, async () => {
    const base = await newBase();
    const bin = path.join(base, "bin");
    await mkdir(bin);
    await writeFile(path.join(bin, "echoargs.cmd"), "@echo off\r\necho %*\r\n", "utf8");
    const task = await writeTask(
      base,
      {
        policy: { commands: [{ executable: "echoargs", argsPrefix: [], allowExtraArgs: true }], network: "deny", destructive: "deny", restorePathTokens: false },
        verifiers: [{ id: "cmd-verifier", kind: "command", executable: "echoargs", args: ["verified"] }],
      },
      [{ toolCalls: [{ name: "run_command", args: { executable: "echoargs", args: ["hello-t1"] } }] }, { text: "done" }],
    );
    const outcome = await withEnv({ PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}` }, () =>
      runCli(io(base, ["run", "--task", task])),
    );
    const recorded = await recordedText(path.join(base, "work"));
    assert.ok(recorded.includes("hello-t1"), "the .cmd tool call ran and its output was recorded");
    assert.ok(!recorded.includes("script_refused"), "the .cmd was not refused for an unknown workspace root");
    assert.equal(outcome.output.kind === "run" ? outcome.output.status : outcome.output.code, "done");
  });

  test("an allow-listed variable whose value holds a registered secret does not reach the child", async () => {
    const base = await newBase();
    const script = "process.stdout.write('HOME=' + (process.env.HOME === undefined ? 'unset' : 'passed'))";
    const task = await writeTask(
      base,
      { policy: { commands: [{ executable: process.execPath, argsPrefix: ["-e"], allowExtraArgs: true }], network: "deny", destructive: "deny", restorePathTokens: false } },
      [{ toolCalls: [{ name: "run_command", args: { executable: process.execPath, args: ["-e", script] } }] }, { text: "done" }],
    );
    await withEnv({ HOME: path.join(base, `home-${FAKE_SECRET}`) }, () => runCli(io(base, ["run", "--task", task])));
    const recorded = await recordedText(path.join(base, "work"));
    assert.ok(recorded.includes("HOME=unset"), "HOME holding a secret was dropped from the child environment");
    assert.ok(!recorded.includes("HOME=passed"));
    assert.ok(!recorded.includes(FAKE_SECRET));
  });

  test("an allow-listed variable without a secret still reaches the child", async () => {
    const base = await newBase();
    const script = "process.stdout.write('HOME=' + (process.env.HOME === undefined ? 'unset' : 'passed'))";
    const task = await writeTask(
      base,
      { policy: { commands: [{ executable: process.execPath, argsPrefix: ["-e"], allowExtraArgs: true }], network: "deny", destructive: "deny", restorePathTokens: false } },
      [{ toolCalls: [{ name: "run_command", args: { executable: process.execPath, args: ["-e", script] } }] }, { text: "done" }],
    );
    await withEnv({ HOME: path.join(base, "plain-home") }, () => runCli(io(base, ["run", "--task", task])));
    assert.ok((await recordedText(path.join(base, "work"))).includes("HOME=passed"));
  });
});

describe("T-12 revert --workspace and --cancel-file", () => {
  test("revert rejects UNC and device workspaces before touching the file system", async () => {
    const paths = IS_WINDOWS ? ["\\\\attacker.invalid\\share", "\\\\.\\pipe\\codaryn", "\\\\?\\C:\\work"] : ["/dev/null"];
    for (const workspace of paths) {
      const seen: string[] = [];
      const outcome = await runRevert({
        argv: ["revert", "--workspace", workspace, "--run", "20261112T000000Z-abcdef12"],
        cwd: tmpdir(),
        isDirectory: async (dir) => {
          seen.push(dir);
          return true;
        },
        clock: { now: () => 0 },
        randomBytes: (size) => new Uint8Array(size),
        revert: async () => ({ ok: false, code: "run_not_found", message: "not reached" }),
      });
      assert.deepEqual(seen, [], workspace);
      assert.equal(outcome.output.kind === "error" ? outcome.output.code : "", "invalid_arguments", workspace);
      assert.ok(!JSON.stringify(outcome.output).includes("attacker"), "the path is not echoed");
    }
  });

  test("a cancel file inside the workspace is rejected before the run starts", async () => {
    const base = await newBase();
    const task = await writeTask(base, {}, [{ text: "done" }]);
    const outcome = await runCli(io(base, ["run", "--task", task, "--cancel-file", path.join(base, "work", "stop.flag")]));
    assert.equal(outcome.output.kind === "error" ? outcome.output.code : "", "invalid_arguments");
    assert.equal(existsSync(path.join(base, "work", ".codaryn")), false, "nothing ran");

    const outside = await runCli(io(base, ["run", "--task", task, "--cancel-file", path.join(base, "stop.flag")]));
    assert.equal(outside.output.kind, "run");
  });
});

describe("T-13 the CLI uses the policy's protectedPaths rule", () => {
  const policy = (protectedPaths: unknown) => ({ commands: [], network: "deny", destructive: "deny", restorePathTokens: false, protectedPaths });
  const taskWith = (protectedPaths: unknown) => ({
    schemaVersion: 1,
    id: "p",
    goal: "g",
    workflow: "test",
    workspaceRoot: "./work",
    model: { provider: "scripted", scriptPath: "./script.json" },
    policy: policy(protectedPaths),
    privacy: { secretEnv: [] },
    limits: { maxModelTurns: 1, maxToolCalls: 1, maxTotalTokens: null, maxDurationMs: 1000 },
    verifiers: [],
  });

  test("entries the gate would treat as unusable are rejected with their position only", () => {
    const entries = IS_WINDOWS ? ["tests ", "tests.", "a|b", "nul"] : ["", "../x", "/abs", "a\0b"];
    for (const entry of entries) {
      const outcome = parseTask(taskWith(["ok", entry]), tmpdir());
      assert.equal(outcome.ok, false, JSON.stringify(entry));
      if (outcome.ok) continue;
      assert.equal(outcome.code, "invalid_task");
      assert.match(outcome.message, /^policy\.protectedPaths\[1\] /);
      if (entry.trim().length > 0) assert.ok(!outcome.message.includes(entry), outcome.message);
    }
    const notList = parseTask(taskWith("tests"), tmpdir());
    assert.ok(!notList.ok && /^policy\.protectedPaths must be/.test(notList.message));
    assert.equal(parseTask(taskWith(["tests", "docs/spec.md", "."]), tmpdir()).ok, true);
  });

  test("the config file's policy follows the same rule", () => {
    const bad = parseConfig({ schemaVersion: 1, policy: policy(["ok", IS_WINDOWS ? "tests." : "../x"]) });
    assert.ok(!bad.ok && /^policy\.protectedPaths\[1\] /.test(bad.message));
  });
});

describe("T-14 maxOutputTokens has an absolute cap", () => {
  const anthropicTask = (maxOutputTokens: unknown) => ({
    schemaVersion: 1,
    id: "m",
    goal: "g",
    workflow: "test",
    workspaceRoot: "./work",
    model: { provider: "anthropic", model: "claude-opus-5-5", maxOutputTokens },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
    privacy: { secretEnv: [] },
    limits: { maxModelTurns: 1, maxToolCalls: 1, maxTotalTokens: 1000, maxDurationMs: 1000 },
    verifiers: [],
  });

  test("task and config accept the cap and reject anything above it without echoing the value", () => {
    assert.equal(MAX_OUTPUT_TOKENS_LIMIT, 200_000);
    assert.equal(parseTask(anthropicTask(MAX_OUTPUT_TOKENS_LIMIT), tmpdir()).ok, true);
    const over = parseTask(anthropicTask(9_007_199_254_740_991), tmpdir());
    assert.ok(!over.ok && over.code === "invalid_task" && over.message.startsWith("model.maxOutputTokens"));
    assert.ok(!over.ok && !over.message.includes("9007199254740991"));
    assert.equal(parseConfig({ schemaVersion: 1, maxOutputTokens: MAX_OUTPUT_TOKENS_LIMIT }).ok, true);
    const config = parseConfig({ schemaVersion: 1, maxOutputTokens: 200_001 });
    assert.ok(!config.ok && config.message.startsWith("maxOutputTokens") && !config.message.includes("200001"));
  });
});

describe("T-15 --vars-file replaces --env-file", () => {
  test("--env-file is refused with a hint, --vars-file is read", () => {
    const refused = parseArgs(["run", "--task", "t.json", "--env-file", "x.vars"]);
    assert.ok(!refused.ok);
    if (!refused.ok) {
      assert.match(refused.message, /--vars-file/);
      assert.match(refused.message, /Node/);
    }
    const parsed = parseArgs(["run", "--task", "t.json", "--vars-file", "x.vars"]);
    assert.ok(parsed.ok && parsed.args.command === "run" && parsed.args.varsFile === "x.vars");
  });

  test("runCli turns --env-file into invalid_arguments before reading anything", async () => {
    const read: string[] = [];
    const outcome = await runCli(
      io(tmpdir(), ["run", "--task", "t.json", "--env-file", "x.vars"], {
        readFile: async (file) => {
          read.push(file);
          throw new Error("not reached");
        },
      }),
    );
    assert.equal(outcome.output.kind === "error" ? outcome.output.code : "", "invalid_arguments");
    assert.deepEqual(read, []);
  });
});
