/**
 * U-110, review R-88 (PM: fix, then merge), the terminal question's three faults, imitated: stdin is
 * a pipe that readline reads as a terminal (stderr's isTTY true), so a key is a byte (Ctrl+C 0x03,
 * Ctrl+D 0x04). No real terminal (Windows console, pty) is used; R-88 could not use one either.
 * - M2: Ctrl+C at a question did not cancel. readline took it as a key, closed the question and the
 *   CLI read "no answer": a run went on (more model turns, more questions), init went on asking and
 *   wrote its file. Now askLine tells an interrupt apart; a run is cancelled the CLI's own way (as
 *   SIGINT: recorded `cancelled`, exit 5), and init, models, apply and revert end without changing
 *   anything more, exit 5.
 * - L2: a question asked after the input had ended never settled: exit 13, no result, the lock left.
 *   Now askLine answers "none" at once on an input that has ended.
 * - L1: after a question closed with Ctrl+D or Ctrl+C the process did not end while the input stayed
 *   open. Now askLine stops reading and unrefs the input after each question.
 * askLine in a child process, and the real CLI against the loopback fake Anthropic server under the
 * network guard; fake key.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, test } from "node:test";
import type { TestContext } from "node:test";
import type { JournalRecord } from "../../../src/contracts/index.js";
import { cliEnv } from "../../support/cli.js";
import { replyText, replyTools, startFakeAnthropic, toolUse } from "../../support/fake-anthropic.js";
import { ANTHROPIC_LIMITS, fakeApiConfig, writeConfigFile } from "../../fixtures/anthropic.js";
import { createSandbox } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { FAKE_API_KEY } from "../../fixtures/secrets.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.resolve(here, "..", "..", "..", "src", "cli", "main.js");
const TERMINAL = pathToFileURL(path.join(here, "u110-terminal-preload.js")).href;
const GUARD = pathToFileURL(path.resolve(here, "..", "..", "support", "net-guard.js")).href;
const ASK_LINE = pathToFileURL(path.resolve(here, "..", "..", "..", "src", "cli", "terminal.js")).href;
const CTRL_C = "\u0003";
const CTRL_D = "\u0004";

interface Running {
  readonly child: ChildProcessWithoutNullStreams;
  readonly out: () => string;
  readonly err: () => string;
  /** Resolves with the exit code once the process ends, or "running" after `ms`. */
  readonly exited: (ms: number) => Promise<number | null | "running">;
  /** Resolves once stderr holds `text` (or fails after 20 s). */
  readonly asked: (text: string, times?: number) => Promise<void>;
}

function start(args: readonly string[], env: NodeJS.ProcessEnv, cwd: string): Running {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
  const done = new Promise<number | null>((resolve) => child.once("close", (code) => resolve(code)));
  return {
    child,
    out: () => out,
    err: () => err,
    exited: (ms) => Promise.race([done, new Promise<"running">((resolve) => setTimeout(() => resolve("running"), ms))]),
    asked: async (text, times = 1) => {
      const until = Date.now() + 20_000;
      while (err.split(text).length - 1 < times) {
        if (Date.now() > until) throw new Error(`no question "${text}" (${times}) in:\n${err}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
  };
}

/** A child asking `count` questions with askLine, stderr seen as a terminal; prints the answers as JSON. */
function askingChild(count: number): Running {
  const script =
    `Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });\n` +
    `const { askLine } = await import(${JSON.stringify(ASK_LINE)});\n` +
    `const answers = [];\n` +
    `for (let i = 0; i < ${count}; i++) answers.push(await askLine("question " + i + "? ", { input: process.stdin, output: process.stderr }));\n` +
    `process.stdout.write(JSON.stringify(answers));\n`;
  return start(["--input-type=module", "-e", script], process.env, here);
}

describe("U-110 (R-88): askLine at a terminal", () => {
  test("M2: Ctrl+C is an interrupt, not a missing answer", async () => {
    const asking = askingChild(1);
    await asking.asked("question 0? ");
    asking.child.stdin.write(CTRL_C);
    const code = await asking.exited(5_000);
    asking.child.stdin.end();
    assert.deepEqual([code, asking.out()], [0, '[{"interrupted":true}]']);
  });

  test("L2: after the input ended, the next question answers none at once (no exit 13)", async () => {
    const asking = askingChild(2);
    await asking.asked("question 0? ");
    asking.child.stdin.end();
    assert.deepEqual([await asking.exited(5_000), asking.out()], [0, '[{"none":true},{"none":true}]']);
  });

  for (const [name, key] of [
    ["Ctrl+D", CTRL_D],
    ["Ctrl+C", CTRL_C],
  ] as const) {
    test(`L1: a question closed with ${name} lets the process end while the input stays open`, async () => {
      const asking = askingChild(1);
      await asking.asked("question 0? ");
      asking.child.stdin.write(key);
      const code = await asking.exited(3_000);
      asking.child.stdin.end();
      assert.equal(code, 0, `still running with the input open:\n${asking.err()}`);
    });
  }

  test("a line typed is still the answer", async () => {
    const asking = askingChild(2);
    await asking.asked("question 0? ");
    asking.child.stdin.write("y\n");
    await asking.asked("question 1? ");
    asking.child.stdin.write("no\n");
    const code = await asking.exited(5_000);
    asking.child.stdin.end();
    assert.deepEqual([code, asking.out()], [0, '[{"line":"y"},{"line":"no"}]']);
  });
});

/** The CLI in the sandbox with stdin and stderr seen as terminals (stdout is not: its JSON line is read). */
function cli(sb: Sandbox, args: readonly string[]): Running {
  const env = { ...cliEnv({ fakeApiKey: FAKE_API_KEY }), CODARYN_TEST_TERMINAL: "stdin,stderr", CODARYN_IT_NET_GUARD_LOG: path.join(sb.base, "net-guard.log") };
  return start(["--import", GUARD, "--import", TERMINAL, MAIN, ...args], env, sb.base);
}

const NODE = process.execPath;
const POLICY = { commands: [{ executable: NODE, argsPrefix: ["ask.mjs"], allowExtraArgs: false, confirm: true }], network: "deny", destructive: "deny", restorePathTokens: false };
const QUESTION = "Allow a command for this one call?";

/** A workspace with ask.mjs, a config whose rule asks first, and a model that calls ask.mjs in two turns. */
async function asking(t: TestContext): Promise<{ sb: Sandbox; args: readonly string[]; requests: () => number }> {
  const sb = createSandbox(t);
  writeFileSync(path.join(sb.workspace, "ask.mjs"), 'import { appendFileSync } from "node:fs";\nappendFileSync("ask-ran.txt", "ran\\n");\n');
  const api = await startFakeAnthropic(t, [
    replyTools([toolUse("toolu_a1", "run_command", { executable: NODE, args: ["ask.mjs"] })]),
    replyTools([toolUse("toolu_a2", "run_command", { executable: NODE, args: ["ask.mjs"] })]),
    replyText("done"),
  ]);
  const configPath = writeConfigFile(sb, fakeApiConfig(api.url, { model: "fake-model-r88", limits: ANTHROPIC_LIMITS, policy: POLICY } as object));
  return { sb, args: ["run", "--config", configPath, "--workspace", sb.workspace, "--goal", "run the script twice"], requests: () => api.requests.length };
}

function journalOf(sb: Sandbox, stdout: string): JournalRecord[] {
  const result = JSON.parse(stdout.trim()) as { runId: string };
  return readFileSync(path.join(sb.workspace, ".codaryn", "runs", result.runId, "journal.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as JournalRecord);
}

describe("U-110 (R-88) on the real CLI", () => {
  test("M2: Ctrl+C at a run's question cancels the run: recorded cancelled, exit 5, no second question, no more model turns", async (t) => {
    const { sb, args, requests } = await asking(t);
    const run = cli(sb, args);
    await run.asked(QUESTION);
    run.child.stdin.write(CTRL_C);
    const code = await run.exited(20_000);
    run.child.stdin.end();
    assert.equal(code, 5, run.err());
    assert.equal(run.err().split(QUESTION).length - 1, 1, "asked once");
    assert.equal(requests(), 1, "the model was not asked again");
    const answered = journalOf(sb, run.out()).flatMap((record) => (record.type === "confirmation_answered" ? [[record.decision, record.by]] : []));
    assert.deepEqual(answered, [["deny", "cancelled"]]);
    assert.equal(existsSync(path.join(sb.workspace, "ask-ran.txt")), false);
    assert.equal(existsSync(path.join(sb.workspace, ".codaryn", "lock.json")), false, "the lock is released");
  });

  test("L2: the input ends at the first question: the second is denied at once; the run ends with its result and no lock", async (t) => {
    const { sb, args } = await asking(t);
    const run = cli(sb, args);
    await run.asked(QUESTION);
    run.child.stdin.end();
    const code = await run.exited(20_000);
    assert.equal(code, 3, run.err());
    const answered = journalOf(sb, run.out()).flatMap((record) => (record.type === "confirmation_answered" ? [[record.decision, record.by]] : []));
    assert.deepEqual(answered, [
      ["deny", "default"],
      ["deny", "default"],
    ]);
    assert.equal(existsSync(path.join(sb.workspace, ".codaryn", "lock.json")), false);
  });

  test("L1: Ctrl+D at the question (the input left open): the run goes on and the process ends", async (t) => {
    const { sb, args } = await asking(t);
    const run = cli(sb, args);
    await run.asked(QUESTION);
    run.child.stdin.write(CTRL_D);
    await run.asked(QUESTION, 2);
    run.child.stdin.write(CTRL_D);
    const code = await run.exited(20_000);
    run.child.stdin.end();
    assert.equal(code, 3, `still running with the input open:\n${run.err()}`);
  });

  test("M2: Ctrl+C at init's second question: init stops, writes nothing, exit 5", async (t) => {
    const sb = createSandbox(t);
    const home = path.join(sb.base, "home");
    mkdirSync(home);
    const env = {
      ...cliEnv(),
      APPDATA: home,
      LOCALAPPDATA: home,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: home,
      CODARYN_TEST_TERMINAL: "stdin,stderr",
      CODARYN_IT_NET_GUARD_LOG: path.join(sb.base, "net-guard.log"),
    };
    const init = start(["--import", GUARD, "--import", TERMINAL, MAIN, "init"], env, sb.base);
    await init.asked("Create the config file there?");
    init.child.stdin.write("\n");
    await init.asked("Choose the provider by number or name");
    init.child.stdin.write(CTRL_C);
    const code = await init.exited(10_000);
    init.child.stdin.end();
    assert.equal(code, 5, init.err());
    const written = [path.join(home, "Codaryn", "config.json"), path.join(home, "codaryn", "config.json")].filter((file) => existsSync(file));
    assert.deepEqual(written, [], "no config file was written");
  });
});
