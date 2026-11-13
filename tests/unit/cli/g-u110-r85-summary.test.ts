/**
 * U-110, review R-85 M1 (PM: with U-109 in one unit): a run whose command was denied after a
 * permission question ended with the add-a-rule hint ("add a rule to policy.commands"), though the
 * rule was there and asked first; following it would let the command run without the question. The
 * end summary now learns, from run, how many calls were denied after a question and by whom
 * (RunSummaryContext.confirmationDenied: user, default, cancelled) and whether this run could ask at
 * all (couldAsk), so the renderer can say "denied by the person" or "this run could not ask" and keep
 * the add-a-rule hint for the other denied command calls.
 * `codaryn run` in the quick form with the real assembly, engine, policy and tools; the anthropic
 * provider over an injected fake fetch (a fake host; nothing leaves the process); the terminal is an
 * injected `ask`. The model calls ask.mjs (a rule that asks first) and other.mjs (no rule).
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV } from "../../../src/contracts/index.js";
import type { RunSummaryContext } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runCli } from "../../../src/cli/run.js";
import type { CliEnvironment } from "../../../src/cli/run.js";
import { locateInWorkspace } from "../../../src/cli/security/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

/** Not a real key format; built from parts (G-10). */
const FAKE_KEY = ["fake", "u110", "r85", "0042"].join("-");
const FAKE_MODEL = "fake-model-u110-r85";
const NODE = process.execPath;
const LIMITS = { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 100_000, maxDurationMs: 60_000 };
const POLICY = { commands: [{ executable: NODE, argsPrefix: ["ask.mjs"], allowExtraArgs: false, confirm: true }], network: "deny", destructive: "deny", restorePathTokens: false };

function message(content: unknown[], stopReason: string) {
  return { id: "msg_fake", type: "message", role: "assistant", model: FAKE_MODEL, content, stop_reason: stopReason, usage: { input_tokens: 10, output_tokens: 5 } };
}
function fakeFetch(): typeof fetch {
  const replies = [
    message(
      [
        { type: "tool_use", id: "toolu_a1", name: "run_command", input: { executable: NODE, args: ["ask.mjs"] } },
        { type: "tool_use", id: "toolu_o1", name: "run_command", input: { executable: NODE, args: ["other.mjs"] } },
      ],
      "tool_use",
    ),
    message([{ type: "text", text: "done" }], "end_turn"),
  ];
  let at = 0;
  return (async () => {
    const reply = replies[at++];
    if (reply === undefined) throw new Error("no more fake replies");
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

type Ask = (question: string, signal: AbortSignal) => Promise<string | null>;

/** The summary context run gives for the end summary. */
async function summaryOf(ask: Ask | undefined, options: { readonly quiet?: boolean; readonly cancel?: AbortController } = {}): Promise<RunSummaryContext> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u110-r85-"));
  temporaryDirs.push(base);
  const work = path.join(base, "work");
  await mkdir(work);
  for (const name of ["ask", "other"]) await writeFile(path.join(work, `${name}.mjs`), `import { writeFileSync } from "node:fs";\nwriteFileSync("${name}-ran.txt", "ran\\n");\n`, "utf8");
  const config = { schemaVersion: 1, model: FAKE_MODEL, maxOutputTokens: 321, apiBaseUrl: "https://api.example.test", maxRetries: 0, limits: LIMITS, policy: POLICY };
  await writeFile(path.join(base, "config.json"), JSON.stringify(config), "utf8");
  const cancel = options.cancel ?? new AbortController();
  const io = {
    argv: ["run", "--config", path.join(base, "config.json"), "--workspace", work, "--goal", "run the scripts", ...(options.quiet === true ? ["--quiet"] : [])],
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
    cancelSignal: () => ({ signal: cancel.signal, dispose: () => {} }),
    ...(ask === undefined ? {} : { ask }),
  } as CliEnvironment;
  const outcome = await runCli(io);
  assert.ok(outcome.info !== undefined, JSON.stringify(outcome.output));
  return outcome.info.summary;
}

const answering =
  (line: string | null): Ask =>
  async () =>
    line;

describe("U-110 (R-85 M1): run tells the end summary which denials followed a permission question", () => {
  test("allowed once: no such denial; other.mjs is the one denied command call", async () => {
    const summary = await summaryOf(answering("y"));
    assert.equal(summary.confirmationDenied, undefined);
    assert.equal(summary.deniedCommandCalls, 1);
  });

  test("the person said no: one denied by the user, this run could ask; both among the denied command calls", async () => {
    const summary = await summaryOf(answering("n"));
    assert.deepEqual(summary.confirmationDenied, { user: 1, default: 0, cancelled: 0, couldAsk: true });
    assert.equal(summary.deniedCommandCalls, 2);
  });

  test("the input ended: one denied by default, this run could ask", async () => {
    assert.deepEqual((await summaryOf(answering(null))).confirmationDenied, { user: 0, default: 1, cancelled: 0, couldAsk: true });
  });

  test("no terminal: one denied by default, this run could not ask", async () => {
    assert.deepEqual((await summaryOf(undefined)).confirmationDenied, { user: 0, default: 1, cancelled: 0, couldAsk: false });
  });

  test("--quiet: nothing asked, this run could not ask", async () => {
    assert.deepEqual((await summaryOf(answering("y"), { quiet: true })).confirmationDenied, { user: 0, default: 1, cancelled: 0, couldAsk: false });
  });

  test("cancelled while it waited: one denied as cancelled", async () => {
    const cancel = new AbortController();
    const summary = await summaryOf(
      async (_question, signal) => {
        cancel.abort();
        if (!signal.aborted) await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
        return null;
      },
      { cancel },
    );
    assert.deepEqual(summary.confirmationDenied, { user: 0, default: 0, cancelled: 1, couldAsk: true });
  });
});
