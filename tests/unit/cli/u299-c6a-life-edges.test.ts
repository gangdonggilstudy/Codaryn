/**
 * Unit U-299 (the CLI migration's C-6a, its fifth commit; plan 5.5's two new tests for C-6a, "the
 * process's survival and an early signal", and 6.2): what codaryn run's life does at its two time
 * edges now that its steps 8 on are the app layer's run life (runLife, U-296).
 * A. An early signal: the cancel source, which hooks SIGINT and SIGTERM (main.ts: process.on), is
 *    made only after the pre-run checks and the model step, right before the assembly, once; so a
 *    SIGINT during the checks still ends the process the Node way, as before. A refusal in steps 1 to
 *    7 or in step 8 makes none. It is removed once the run has ended, the workspace lock released.
 * B. The process's survival: at a terminal permission question nothing but the question's input
 *    keeps the process alive (the engine's time limit timer and the cancel file's poll are unref'd,
 *    R-79 I-1). While no answer comes the run waits, the process does not end; a typed answer goes on.
 *    The real CLI with stdin and stderr seen as terminals (the U-110 preload), against the loopback
 *    fake Anthropic server under the network guard.
 * Temporary folders, scripted model or fake API, fake values only; nothing is sent elsewhere.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, test } from "node:test";
import type { Assemble } from "../../../src/app/assembly.js";
import { assembleRun } from "../../../src/app/assembly.js";
import type { JournalRecord } from "../../../src/contracts/index.js";
import { runCli } from "../../../src/cli/run.js";
import { cliEnv } from "../../support/cli.js";
import { replyText, replyTools, startFakeAnthropic, toolUse } from "../../support/fake-anthropic.js";
import { ANTHROPIC_LIMITS, fakeApiConfig, writeConfigFile } from "../../fixtures/anthropic.js";
import { createSandbox } from "../../fixtures/builders.js";
import { FAKE_API_KEY } from "../../fixtures/secrets.js";
import { cliIo, setupRun } from "./k-support.js";

/** A run's cancel source and assembly that record when they are made, used and removed. */
function recording(base: string): { readonly calls: string[]; readonly extra: { readonly cancelSignal: () => { signal: AbortSignal; dispose(): void }; readonly assemble: Assemble } } {
  const calls: string[] = [];
  const lock = path.join(base, "work", ".codaryn", "lock.json");
  return {
    calls,
    extra: {
      cancelSignal: () => {
        calls.push("cancel source made");
        return {
          signal: new AbortController().signal,
          dispose: () => calls.push(`cancel source removed (lock ${existsSync(lock) ? "held" : "released"})`),
        };
      },
      assemble: async (input) => {
        calls.push("assembly");
        return assembleRun(input);
      },
    },
  };
}

describe("U-299 A: the cancel source is made right before the assembly, never during the pre-run checks", () => {
  test("a refusal in steps 1 to 7 (no workspace) makes no cancel source", async () => {
    const base = await setupRun({}, { workspaceRoot: "./nowhere" }, [{ text: "done" }]);
    const { calls, extra } = recording(base);
    const outcome = await runCli(cliIo(base, extra));
    assert.equal((outcome.output as { code?: unknown }).code, "workspace_not_found", JSON.stringify(outcome.output));
    assert.deepEqual(calls, []);
  });

  test("a refusal in step 8 (the script file is missing) makes no cancel source", async () => {
    const base = await setupRun({}, { model: { provider: "scripted", scriptPath: "./missing-script.json" } }, [{ text: "done" }]);
    const { calls, extra } = recording(base);
    const outcome = await runCli(cliIo(base, extra));
    assert.equal((outcome.output as { code?: unknown }).code, "invalid_script", JSON.stringify(outcome.output));
    assert.deepEqual(calls, []);
  });

  test("a run: one cancel source before the assembly, removed after the run ended and the lock was released", async () => {
    const base = await setupRun({ "README.md": "# Title\n" }, {}, [{ text: "done" }]);
    const { calls, extra } = recording(base);
    const outcome = await runCli(cliIo(base, extra));
    assert.deepEqual([outcome.exitCode, (outcome.output as { status?: unknown }).status], [0, "done"], JSON.stringify(outcome.output));
    assert.deepEqual(calls, ["cancel source made", "assembly", "cancel source removed (lock released)"]);
  });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.resolve(here, "..", "..", "..", "src", "cli", "main.js");
const TERMINAL = pathToFileURL(path.join(here, "u110-terminal-preload.js")).href;
const GUARD = pathToFileURL(path.resolve(here, "..", "..", "support", "net-guard.js")).href;
const NODE = process.execPath;
const POLICY = { commands: [{ executable: NODE, argsPrefix: ["ask.mjs"], allowExtraArgs: false, confirm: true }], network: "deny", destructive: "deny", restorePathTokens: false };
const QUESTION = "Allow a command for this one call?";

describe("U-299 B: at a terminal question the process waits for the answer", () => {
  test("no answer for 1.5 s: the run waits and the process lives; a typed yes goes on, the command runs once, the lock is released", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    writeFileSync(path.join(sb.workspace, "ask.mjs"), 'import { appendFileSync } from "node:fs";\nappendFileSync("ask-ran.txt", "ran\\n");\n');
    const api = await startFakeAnthropic(t, [replyTools([toolUse("toolu_u299", "run_command", { executable: NODE, args: ["ask.mjs"] })]), replyText("done")]);
    const configPath = writeConfigFile(sb, fakeApiConfig(api.url, { model: "fake-model-u299", limits: ANTHROPIC_LIMITS, policy: POLICY } as object));
    const env = { ...cliEnv({ fakeApiKey: FAKE_API_KEY }), CODARYN_TEST_TERMINAL: "stdin,stderr", CODARYN_IT_NET_GUARD_LOG: path.join(sb.base, "net-guard.log") };
    const child = spawn(NODE, ["--import", GUARD, "--import", TERMINAL, MAIN, "run", "--config", configPath, "--workspace", sb.workspace, "--goal", "run the script"], {
      cwd: sb.base,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
    const closed = new Promise<number | null>((resolve) => child.once("close", (code) => resolve(code)));
    const exited = (ms: number) => Promise.race([closed, new Promise<"running">((resolve) => setTimeout(() => resolve("running"), ms))]);
    try {
      const until = Date.now() + 20_000;
      while (!err.includes(QUESTION)) {
        if (Date.now() > until) throw new Error(`no question in:\n${err}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(await exited(1_500), "running", `the process ended at the question:\n${err}`);
      assert.equal(api.requests.length, 1, "the model is not asked again while the question waits");
      child.stdin.write("y\n");
      const code = await exited(20_000);
      assert.notEqual(code, "running", `the run did not go on after the answer:\n${err}`);
      const result = JSON.parse(out.trim()) as { runId: string; status: string };
      const records = readFileSync(path.join(sb.workspace, ".codaryn", "runs", result.runId, "journal.jsonl"), "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as JournalRecord);
      const answered = records.flatMap((record) => (record.type === "confirmation_answered" ? [[record.decision, record.by]] : []));
      assert.deepEqual(answered, [["allow_once", "user"]]);
      assert.equal(readFileSync(path.join(sb.workspace, "ask-ran.txt"), "utf8"), "ran\n", "the command ran once");
      assert.equal(existsSync(path.join(sb.workspace, ".codaryn", "lock.json")), false, "the lock is released");
      assert.equal(api.requests.length, 2);
    } finally {
      child.stdin.end();
      if (child.exitCode === null) child.kill();
    }
  });
});
