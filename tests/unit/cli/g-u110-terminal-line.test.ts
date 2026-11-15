/**
 * U-110 (B-5): the parts of the terminal question.
 * - askLine (src/cli/terminal.ts), in a child process reading its piped standard input: it waits
 *   for the line (the process stays alive while the question is open) and gives null at the end of
 *   input. readline's question() alone never settled there: the CLI's questions (apply, revert,
 *   models, init) were left waiting when the person pressed Ctrl+D or Ctrl+Z.
 * - The question line in both languages, the answers as apply's question reads them, and no
 *   question for a permission other than a command.
 * - The real CLI with `y` piped into standard input: not a terminal, so nothing is asked and the
 *   command is refused by default; piped input never answers a permission question.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, test } from "node:test";
import type { ConfirmRequest, MaskedText } from "../../../src/contracts/index.js";
import { confirmAnswerOf, confirmQuestion, terminalConfirm } from "../../../src/cli/confirm.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { cliEnv, startCli } from "../../support/cli.js";
import { replyText, replyTools, startFakeAnthropic, toolUse } from "../../support/fake-anthropic.js";
import { ANTHROPIC_LIMITS, fakeApiConfig, writeConfigFile } from "../../fixtures/anthropic.js";
import { createSandbox } from "../../fixtures/builders.js";
import { FAKE_API_KEY } from "../../fixtures/secrets.js";

const terminal = pathToFileURL(fileURLToPath(new URL("../../../src/cli/terminal.js", import.meta.url))).href;
/** A child that asks once on stderr and prints the answer as JSON on stdout. */
const CHILD = `import { askLine } from ${JSON.stringify(terminal)};\nconst answer = await askLine("question? ", { input: process.stdin, output: process.stderr });\nprocess.stdout.write(JSON.stringify(answer));\n`;

/** Runs the child; `feed` gets its standard input after `delayMs`. Its stdout and exit code. */
function child(feed: (stdin: NodeJS.WritableStream) => void, delayMs: number): Promise<{ out: string; code: number | null; waitedMs: number }> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const proc = spawn(process.execPath, ["--input-type=module", "-e", CHILD], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const out: Buffer[] = [];
    proc.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    proc.once("error", reject);
    proc.once("close", (code) => resolve({ out: Buffer.concat(out).toString("utf8"), code, waitedMs: Date.now() - started }));
    setTimeout(() => feed(proc.stdin), delayMs);
  });
}

describe("U-110: askLine waits for the line and ends at the end of input", () => {
  test("a line typed later: the process waited for it and gives it", async () => {
    const done = await child((stdin) => stdin.end("y\n"), 400);
    assert.deepEqual([done.out, done.code], ['{"line":"y"}', 0]);
    assert.ok(done.waitedMs >= 400, `it waited (${done.waitedMs} ms)`);
  });

  test("the input ends without a line: none, and the process ends normally", async () => {
    const done = await child((stdin) => stdin.end(), 200);
    assert.deepEqual([done.out, done.code], ['{"none":true}', 0]);
  });

  test("a last line without Enter is no line: null", async () => {
    const done = await child((stdin) => stdin.end("y"), 200);
    assert.deepEqual([done.out, done.code], ['{"none":true}', 0]);
  });
});

const REQUEST: ConfirmRequest = { kind: "permission", id: "q1", callId: "c1", tool: "run_command", permission: "command", subject: "npm" as MaskedText, argumentCount: 2 };

describe("U-110: the question and the answers", () => {
  test("the question line in both languages: the text, the executable, the [y/N] text", () => {
    assert.equal(
      confirmQuestion(REQUEST, createMessageCatalog("en")),
      "Allow a command for this one call? With no answer it is denied. Only its executable and its number of arguments (2) are shown, not the arguments themselves. Executable: npm [y/N] ",
    );
    assert.ok(confirmQuestion(REQUEST, createMessageCatalog("ko")).endsWith("인자 자체는 보이지 않습니다. 실행 파일: npm [y/N] (y·예·네: 예, Enter: 아니오) "));
  });

  test("control characters in the executable are replaced, not printed", () => {
    const question = confirmQuestion({ ...REQUEST, subject: "np\u001b[2Jm" as MaskedText }, createMessageCatalog("en"));
    assert.equal(question.includes("\u001b"), false, question);
  });

  test("yes as apply reads it allows once; anything else denies; no line is no answer", () => {
    for (const line of ["y", "Y", "yes", "YES", " yes ", "예", "네"]) assert.deepEqual(confirmAnswerOf(line), { decision: "allow_once" }, line);
    for (const line of ["", " ", "n", "no", "아니오", "yess", "y y", "ㅇ"]) assert.deepEqual(confirmAnswerOf(line), { decision: "deny" }, line);
    assert.deepEqual(confirmAnswerOf(null), { decision: "dismissed" });
  });

  test("a permission other than a command is not asked; an asking that throws is no answer", async () => {
    const asked: string[] = [];
    const confirm = terminalConfirm(async (question) => {
      asked.push(question);
      throw new Error("the terminal went away");
    }, createMessageCatalog("en"));
    const signal = new AbortController().signal;
    assert.deepEqual(await confirm({ ...REQUEST, permission: "network" }, signal), { decision: "dismissed" });
    assert.deepEqual(asked, []);
    assert.deepEqual(await confirm(REQUEST, signal), { decision: "dismissed" });
    assert.equal(asked.length, 1);
  });
});

describe("U-110: piped input never answers", () => {
  test("the real CLI with y on a piped standard input: nothing asked, refused by default, the command does not run", async (t) => {
    const sb = createSandbox(t);
    writeFileSync(join(sb.workspace, "ask.mjs"), 'import { writeFileSync } from "node:fs";\nwriteFileSync("ask-ran.txt", "ran\\n");\n');
    const api = await startFakeAnthropic(t, [replyTools([toolUse("toolu_a1", "run_command", { executable: process.execPath, args: ["ask.mjs"] })]), replyText("done")]);
    const policy = { commands: [{ executable: process.execPath, argsPrefix: ["ask.mjs"], allowExtraArgs: false, confirm: true }], network: "deny", destructive: "deny", restorePathTokens: false };
    const configPath = writeConfigFile(sb, fakeApiConfig(api.url, { model: "fake-model-u110", limits: ANTHROPIC_LIMITS, policy } as object));
    const log = join(sb.base, "net-guard.log");
    const started = startCli(["run", "--config", configPath, "--workspace", sb.workspace, "--goal", "run the script"], { cwd: sb.base, env: cliEnv({ fakeApiKey: FAKE_API_KEY }), netGuardLog: log, stdin: "pipe" });
    started.child.stdin?.end("y\ny\n");
    const run = await started.done;
    assert.equal(existsSync(log) ? readFileSync(log, "utf8") : "", "", "no host but the local fake server");
    assert.equal(run.stderr.includes("Allow a command"), false, run.stderr);
    assert.equal(existsSync(join(sb.workspace, "ask-ran.txt")), false, "the command did not run");
    const result = JSON.parse(run.stdout.trim()) as { runId: string };
    const journal = readFileSync(join(sb.workspace, ".codaryn", "runs", result.runId, "journal.jsonl"), "utf8");
    assert.ok(journal.includes('"type":"confirmation_answered","id":"q1","decision":"deny","by":"default"'), journal.slice(0, 3000));
  });
});
