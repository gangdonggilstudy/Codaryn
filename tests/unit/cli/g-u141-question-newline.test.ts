/**
 * U-141 (review R-88b I1): a question closed without a line (Ctrl+D, Ctrl+C, the input ending, an
 * abort) left the cursor after the prompt, so the next text began on the prompt's line
 * ("… [y/N] codaryn: permission question …"). askLine now ends that line itself, once, when it
 * showed the question and no line came. A question answered with a line is as before (the typed
 * line ends it). Imitated: a preload makes the streams terminals; no real terminal is used.
 * askLine on captured streams, and the real CLI's four questions: the permission question of a
 * run, apply's approval, models' number and init's questions.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, test } from "node:test";
import type { TestContext } from "node:test";
import { askLine } from "../../../src/cli/terminal.js";
import { cliEnv } from "../../support/cli.js";
import { replyText, replyTools, startFakeAnthropic, toolUse } from "../../support/fake-anthropic.js";
import { fakeModel } from "../../support/fake-models.js";
import { ANTHROPIC_LIMITS, fakeApiConfig, writeConfigFile } from "../../fixtures/anthropic.js";
import { createSandbox } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { organizeScript, writeOrganizeTask, writeOrganizeWorkspace } from "../../fixtures/general-tasks.js";
import { FAKE_API_KEY } from "../../fixtures/secrets.js";

/** The text as a terminal shows it: readline's cursor moves (CSI sequences such as ESC[24G) removed. */
const shown = (text: string): string => text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");

/** Streams for askLine: the output's text is kept; `terminal` makes readline read keys. */
function streams(terminal: boolean): { input: PassThrough; output: PassThrough & { isTTY?: boolean }; written: () => string } {
  const input = new PassThrough();
  const output = new PassThrough() as PassThrough & { isTTY?: boolean };
  if (terminal) output.isTTY = true;
  let text = "";
  output.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
  return { input, output, written: () => text };
}

describe("U-141: askLine ends the prompt's line when no line came", () => {
  test("a line typed: the output is the prompt only, as before", async () => {
    const io = streams(false);
    const answer = askLine("question? ", io);
    io.input.write("y\n");
    assert.deepEqual(await answer, { line: "y" });
    assert.equal(io.written(), "question? ");
  });

  test("the input ends: the prompt, then one line end", async () => {
    const io = streams(false);
    const answer = askLine("question? ", io);
    io.input.end();
    assert.deepEqual(await answer, { none: true });
    assert.equal(io.written(), "question? \n");
  });

  test("an input that had ended already: no prompt, nothing written", async () => {
    const io = streams(false);
    io.input.end();
    await askLine("first? ", io);
    const before = io.written();
    assert.deepEqual(await askLine("second? ", io), { none: true });
    assert.equal(io.written(), before);
  });

  for (const [name, key, expected] of [
    ["Ctrl+D", "\u0004", { none: true }],
    ["Ctrl+C", "\u0003", { interrupted: true }],
  ] as const) {
    test(`at a terminal, ${name}: the text written ends with one line end after the prompt`, async () => {
      const io = streams(true);
      const answer = askLine("question? ", io);
      io.input.write(key);
      assert.deepEqual(await answer, expected);
      assert.ok(shown(io.written()).endsWith("question? \n"), JSON.stringify(io.written()));
    });
  }

  test("an aborted question: one line end (readline's own, so none is added)", async () => {
    const io = streams(false);
    const controller = new AbortController();
    const answer = askLine("question? ", io, controller.signal);
    controller.abort();
    assert.deepEqual(await answer, { none: true });
    assert.equal(io.written().replace(/\r/g, ""), "question? \n");
  });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.resolve(here, "..", "..", "..", "src", "cli", "main.js");
const TERMINAL = pathToFileURL(path.join(here, "u115-terminal-preload.js")).href;
const GUARD = pathToFileURL(path.resolve(here, "..", "..", "support", "net-guard.js")).href;

/**
 * Runs the CLI with `terminal` streams, presses Ctrl+D once `prompt` is on `on`, and returns that
 * stream's text: what follows the prompt must start on a line of its own (one line end, no blank).
 */
function closedWithCtrlD(sb: Sandbox, args: readonly string[], env: NodeJS.ProcessEnv, terminal: string, on: "stdout" | "stderr", prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", GUARD, "--import", TERMINAL, MAIN, ...args], {
      cwd: sb.base,
      env: { ...env, CODARYN_TEST_TERMINAL: terminal, CODARYN_IT_NET_GUARD_LOG: path.join(sb.base, "net-guard.log") },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const text = { stdout: "", stderr: "" };
    let pressed = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`no prompt "${prompt}" on ${on}:\n${text.stderr}\n${text.stdout}`));
    }, 30_000);
    for (const name of ["stdout", "stderr"] as const) {
      child[name].on("data", (chunk: Buffer) => {
        text[name] += chunk.toString("utf8");
        if (!pressed && name === on && text[on].includes(prompt)) {
          pressed = true;
          child.stdin.write("\u0004");
        }
      });
    }
    child.once("close", () => {
      clearTimeout(timer);
      child.stdin.destroy();
      resolve(text[on]);
    });
  });
}

function assertOwnLine(raw: string, prompt: string): void {
  const text = shown(raw);
  const at = text.lastIndexOf(prompt);
  assert.ok(at >= 0, text);
  const after = text.slice(at + prompt.length);
  assert.ok(after.startsWith("\n") && !after.startsWith("\n\n"), `after the prompt: ${JSON.stringify(after.slice(0, 80))}`);
}

describe("U-141 on the real CLI: after Ctrl+D at a question, the next text starts on its own line", () => {
  test("a run's permission question", async (t: TestContext) => {
    const sb = createSandbox(t);
    writeFileSync(path.join(sb.workspace, "ask.mjs"), "process.exit(0);\n");
    const api = await startFakeAnthropic(t, [replyTools([toolUse("toolu_a1", "run_command", { executable: process.execPath, args: ["ask.mjs"] })]), replyText("done")]);
    const policy = { commands: [{ executable: process.execPath, argsPrefix: ["ask.mjs"], allowExtraArgs: false, confirm: true }], network: "deny", destructive: "deny", restorePathTokens: false };
    const config = writeConfigFile(sb, fakeApiConfig(api.url, { model: "fake-model-u141", limits: ANTHROPIC_LIMITS, policy } as object));
    const stderr = await closedWithCtrlD(sb, ["run", "--config", config, "--workspace", sb.workspace, "--goal", "g"], cliEnv({ fakeApiKey: FAKE_API_KEY }), "stdin,stderr", "stderr", "[y/N] ");
    assertOwnLine(stderr, "[y/N] ");
  });

  test("apply's approval question", async (t: TestContext) => {
    const sb = createSandbox(t);
    writeOrganizeWorkspace(sb);
    const task = writeOrganizeTask(sb, "u141-organize", organizeScript());
    const env = cliEnv();
    const plan = await new Promise<string>((resolve) => {
      const child = spawn(process.execPath, ["--import", GUARD, MAIN, "run", "--task", task], { cwd: sb.base, env: { ...env, CODARYN_IT_NET_GUARD_LOG: path.join(sb.base, "g.log") }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let out = "";
      child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
      child.once("close", () => resolve((JSON.parse(out.trim()) as { runId: string }).runId));
    });
    const stderr = await closedWithCtrlD(sb, ["apply", "--task", task, "--run", plan], env, "stdin,stderr", "stderr", "Apply this plan? [y/N] ");
    assertOwnLine(stderr, "Apply this plan? [y/N] ");
  });

  test("models' number question (on stdout)", async (t: TestContext) => {
    const sb = createSandbox(t);
    const api = await startFakeAnthropic(t, [], { models: { models: [fakeModel("fake-model-u141", "Fake U141", 1000, 100)] } });
    const config = writeConfigFile(sb, fakeApiConfig(api.url, { model: "fake-model-u141" } as object));
    const prompt = "(Enter to skip): ";
    const stdout = await closedWithCtrlD(sb, ["models", "--config", config], cliEnv({ fakeApiKey: FAKE_API_KEY }), "stdin,stdout,stderr", "stdout", prompt);
    assertOwnLine(stdout, prompt);
  });

  test("init's first question", async (t: TestContext) => {
    const sb = createSandbox(t);
    const home = path.join(sb.base, "home");
    mkdirSync(home);
    const env = { ...cliEnv(), APPDATA: home, LOCALAPPDATA: home, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home };
    const prompt = "Create the config file there? [Y/n] ";
    const stderr = await closedWithCtrlD(sb, ["init"], env, "stdin,stderr", "stderr", prompt);
    assertOwnLine(stderr, prompt);
  });
});
