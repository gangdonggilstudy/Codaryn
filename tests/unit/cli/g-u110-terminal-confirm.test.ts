/**
 * U-110 (B-5, DR-3, DR-10): the permission question at a terminal. With a command rule that asks
 * first (`confirm: true` in the user's settings, U-109), the CLI gave the engine no way to ask, so
 * the call was always refused (confirmation_required, deny by default). Now, when standard input and
 * stderr are terminals (the CLI then has `ask`) and --quiet is not given, `run` asks on stderr and
 * reads one line: confirm.question.command, the masked executable and prompt.yes_no_default_no, the
 * same yes answers as apply's question (y, yes, 예, 네; Enter or anything else: no). End of input
 * is no answer (denied by default). With --quiet, or without a terminal, nothing is asked.
 * `codaryn run` in the quick form with the real assembly, engine, policy and tools; the model is the
 * anthropic provider over an injected fake fetch (a fake host, nothing leaves the process); the
 * terminal is an injected `ask`. The command writes a marker file into the workspace if it runs.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV } from "../../../src/contracts/index.js";
import type { EngineResult, JournalRecord } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runCli } from "../../../src/cli/run.js";
import type { CliEnvironment } from "../../../src/cli/run.js";
import { locateInWorkspace } from "../../../src/cli/security/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

/** Not a real key format; built from parts (G-10). */
const FAKE_KEY = ["fake", "u110", "key", "0042"].join("-");
const FAKE_MODEL = "fake-model-u110";
const NODE = process.execPath;
const LIMITS = { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 100_000, maxDurationMs: 60_000 };
const POLICY = { commands: [{ executable: NODE, argsPrefix: ["ask.mjs"], allowExtraArgs: false, confirm: true }], network: "deny", destructive: "deny", restorePathTokens: false };

function message(content: unknown[], stopReason: string) {
  return { id: "msg_fake", type: "message", role: "assistant", model: FAKE_MODEL, content, stop_reason: stopReason, usage: { input_tokens: 10, output_tokens: 5 } };
}
/** The model calls ask.mjs once, then ends. */
function fakeFetch(): typeof fetch {
  const replies = [message([{ type: "tool_use", id: "toolu_a1", name: "run_command", input: { executable: NODE, args: ["ask.mjs"] } }], "tool_use"), message([{ type: "text", text: "done" }], "end_turn")];
  let at = 0;
  return (async () => {
    const reply = replies[at++];
    if (reply === undefined) throw new Error("no more fake replies");
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

type Ask = (question: string, signal: AbortSignal) => Promise<string | null>;

/** Runs the quick form with `ask` as the terminal (or none); what was asked and what happened. */
async function run(ask: Ask | undefined, extraArgs: readonly string[] = []) {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u110-"));
  temporaryDirs.push(base);
  const work = path.join(base, "work");
  await mkdir(work);
  await writeFile(path.join(work, "ask.mjs"), 'import { writeFileSync } from "node:fs";\nwriteFileSync("ask-ran.txt", "ran\\n");\n', "utf8");
  const config = { schemaVersion: 1, model: FAKE_MODEL, maxOutputTokens: 321, apiBaseUrl: "https://api.example.test", maxRetries: 0, limits: LIMITS, policy: POLICY };
  await writeFile(path.join(base, "config.json"), JSON.stringify(config), "utf8");
  const io = {
    argv: ["run", "--config", path.join(base, "config.json"), "--workspace", work, "--goal", "run the script", ...extraArgs],
    env: { [ANTHROPIC_API_KEY_ENV]: FAKE_KEY },
    cwd: base,
    readFile: (file: string) => readFile(file, "utf8"),
    isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
    loadEnvFile: () => {},
    locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
    clock: { now: () => Date.now() },
    randomBytes: (size: number) => randomBytes(size),
    assemble: assembleRun,
    anthropicDeps: { fetch: fakeFetch(), sleep: async () => {} },
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    ...(ask === undefined ? {} : { ask }),
  } as CliEnvironment;
  const outcome = await runCli(io);
  const result = outcome.output as EngineResult;
  assert.equal(result.kind, "run", JSON.stringify(outcome.output));
  const journal = (await readFile(path.join(work, ".codaryn", "runs", result.runId, "journal.jsonl"), "utf8"))
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as JournalRecord);
  const answered = journal.flatMap((record) => (record.type === "confirmation_answered" ? [[record.decision, record.by]] : []));
  const decision = journal.filter((record) => record.type === "tool_decision" && record.callId === "toolu_a1").at(-1);
  return { ran: existsSync(path.join(work, "ask-ran.txt")), answered, decision: decision?.type === "tool_decision" ? [decision.allowed, decision.code] : null };
}

/** A terminal that answers `line` and keeps each question. */
function terminal(line: string | null): { ask: Ask; questions: string[] } {
  const questions: string[] = [];
  return {
    questions,
    ask: async (question) => {
      questions.push(question);
      return line;
    },
  };
}

describe("U-110 (B-5): run asks at a terminal before a command that a rule allows only when asked", () => {
  for (const answer of ["y", "yes", " Y ", "예", "네"]) {
    test(`${JSON.stringify(answer)}: allowed for this call once, the command runs`, async () => {
      const tty = terminal(answer);
      const done = await run(tty.ask);
      assert.equal(tty.questions.length, 1, "asked once");
      assert.deepEqual(done.answered, [["allow_once", "user"]]);
      assert.deepEqual(done.decision, [true, null]);
      assert.equal(done.ran, true);
    });
  }

  test("the question: the text, the executable, the [y/N] text; never the arguments", async () => {
    const tty = terminal("n");
    await run(tty.ask);
    assert.equal(tty.questions.length, 1, "asked once");
    const question = tty.questions[0] ?? "";
    assert.ok(question.startsWith("Allow a command for this one call? With no answer it is denied. Only its executable and its number of arguments (1) are shown, not the arguments themselves. Executable: "), question);
    assert.ok(question.endsWith(" [y/N] "), question);
    assert.equal(question.includes("ask.mjs"), false, "no argument is shown");
  });

  for (const answer of ["", "n", "no", "아니오", "yess"]) {
    test(`${JSON.stringify(answer)}: denied by the person, the command does not run`, async () => {
      const done = await run(terminal(answer).ask);
      assert.deepEqual(done.answered, [["deny", "user"]]);
      assert.deepEqual(done.decision, [false, "confirmation_required"]);
      assert.equal(done.ran, false);
    });
  }

  test("end of input: no answer, denied by default", async () => {
    const done = await run(terminal(null).ask);
    assert.deepEqual(done.answered, [["deny", "default"]]);
    assert.deepEqual(done.decision, [false, "confirmation_required"]);
    assert.equal(done.ran, false);
  });

  test("--quiet: nothing is asked, denied by default", async () => {
    const tty = terminal("y");
    const done = await run(tty.ask, ["--quiet"]);
    assert.deepEqual(tty.questions, []);
    assert.deepEqual(done.answered, [["deny", "default"]]);
    assert.equal(done.ran, false);
  });

  test("no terminal (no ask): denied by default, as before", async () => {
    const done = await run(undefined);
    assert.deepEqual(done.answered, [["deny", "default"]]);
    assert.equal(done.ran, false);
  });
});
