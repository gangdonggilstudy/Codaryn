/**
 * U-110 (review R-85 M1), what a person reads: `codaryn run` in the quick form, in process, with the
 * real assembly, engine, policy, tools and human renderer, in both languages. The config has one
 * command rule that asks first (U-109); the model calls it (and, in one case, a command with no rule).
 * The terminal is an injected `ask` (na-core's U-110); without it the run cannot ask.
 * The progress lines and the end summary written on stderr must say what became of the question,
 * and the add-a-rule hint must come only for the call with no rule.
 * The anthropic provider runs over an injected fetch: nothing leaves the process (the configured
 * address is a closed loopback port that is never reached). Fake values only.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV, MESSAGE_LANGUAGES } from "../../../../src/contracts/index.js";
import type { CatalogText, MessageCatalog, MessageLanguage } from "../../../../src/contracts/index.js";
import { assembleRun } from "../../../../src/cli/assemble.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { runCli } from "../../../../src/cli/run.js";
import type { CliEnvironment } from "../../../../src/cli/run.js";
import { locateInWorkspace } from "../../../../src/cli/security/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

/** Not a key format; built from parts (G-10). */
const FAKE_KEY = ["fake", "u110", "nc", "0007"].join("-");
const FAKE_MODEL = "fake-model-u110-nc";
const NODE = process.execPath;
const LIMITS = { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 100_000, maxDurationMs: 60_000 };
const POLICY = { commands: [{ executable: NODE, argsPrefix: ["ask.mjs"], allowExtraArgs: false, confirm: true }], network: "deny", destructive: "deny", restorePathTokens: false };
/** A closed loopback port: the injected fetch answers, so it is never reached. */
const UNREACHED = "http://127.0.0.1:9";

const message = (content: unknown[], stopReason: string) => ({
  id: "msg_fake", type: "message", role: "assistant", model: FAKE_MODEL, content, stop_reason: stopReason, usage: { input_tokens: 10, output_tokens: 5 },
});
const call = (id: string, script: string) => ({ type: "tool_use", id, name: "run_command", input: { executable: NODE, args: [script] } });

function fakeFetch(scripts: readonly string[]): typeof fetch {
  const replies = [message(scripts.map((script, index) => call(`toolu_${index + 1}`, script)), "tool_use"), message([{ type: "text", text: "done" }], "end_turn")];
  let at = 0;
  return (async () => {
    const reply = replies[at++];
    if (reply === undefined) throw new Error("no more fake replies");
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

type Ask = (question: string, signal: AbortSignal) => Promise<string | null>;

interface Seen {
  /** stderr lines: progress (without the `codaryn: ` prefix) and the end summary. */
  readonly lines: readonly string[];
  readonly ran: { readonly ask: boolean; readonly other: boolean };
  readonly questions: readonly string[];
}

async function run(language: MessageLanguage, scripts: readonly string[], answer?: string | null): Promise<Seen> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-u110-nc-"));
  temporaryDirs.push(base);
  const work = path.join(base, "work");
  await mkdir(work);
  for (const name of ["ask", "other"]) await writeFile(path.join(work, `${name}.mjs`), `import { writeFileSync } from "node:fs";\nwriteFileSync("${name}-ran.txt", "ran\\n");\n`, "utf8");
  const config = { schemaVersion: 1, model: FAKE_MODEL, maxOutputTokens: 321, apiBaseUrl: UNREACHED, maxRetries: 0, limits: LIMITS, policy: POLICY };
  await writeFile(path.join(base, "config.json"), JSON.stringify(config), "utf8");
  const catalog = createMessageCatalog(language);
  const output = createHumanOutput(catalog);
  const written: string[] = [];
  const questions: string[] = [];
  const ask: Ask | undefined =
    answer === undefined
      ? undefined
      : async (question) => {
          questions.push(question);
          return answer;
        };
  const io = {
    argv: ["run", "--config", path.join(base, "config.json"), "--workspace", work, "--goal", "run the scripts"],
    env: { [ANTHROPIC_API_KEY_ENV]: FAKE_KEY },
    cwd: base,
    readFile: (file: string) => readFile(file, "utf8"),
    isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
    loadEnvFile: () => {},
    locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
    clock: { now: () => Date.now() },
    randomBytes: (size: number) => randomBytes(size),
    assemble: assembleRun,
    anthropicDeps: { fetch: fakeFetch(scripts), sleep: async () => {} },
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    writeProgress: (line: string) => {
      written.push(line);
    },
    human: () => ({ output, messages: catalog }),
    ...(ask === undefined ? {} : { ask }),
  } as unknown as CliEnvironment;
  const outcome = await runCli(io);
  assert.ok(outcome.info !== undefined, JSON.stringify(outcome.output));
  const lines = written.join("").split(/\r?\n/).filter((line) => line !== "").map((line) => line.replace(/^codaryn: /, ""));
  return { lines, ran: { ask: existsSync(path.join(work, "ask-ran.txt")), other: existsSync(path.join(work, "other-ran.txt")) }, questions };
}

for (const language of MESSAGE_LANGUAGES) {
  const catalog: MessageCatalog = createMessageCatalog(language);
  const t = catalog.format as (id: string, ...rest: unknown[]) => CatalogText;
  const ruleHint = t("summary.denied_hint");
  const confirmLines = (count: number): string[] => ["user", "unasked", "unanswered", "cancelled"].map((kind) => t(`summary.confirm_denied.${kind}`, { count }));

  describe(`U-110 (${language}): what stderr says about a command whose rule asks first`, () => {
    test("no terminal: the question is denied by default; the summary says this run could not ask, not to add a rule", async () => {
      const seen = await run(language, ["ask.mjs"]);
      assert.equal(seen.ran.ask, false);
      assert.ok(seen.lines.includes(t("progress.confirmation_denied.default")), seen.lines.join("\n"));
      assert.ok(seen.lines.includes(t("summary.confirm_denied.unasked", { count: 1 })), seen.lines.join("\n"));
      assert.equal(seen.lines.includes(ruleHint), false, "the rule is there: no add-a-rule hint");
    });

    test("at a terminal the person says no: denied by the person, in the progress line and the summary", async () => {
      const seen = await run(language, ["ask.mjs"], "n");
      assert.equal(seen.questions.length, 1);
      assert.equal(seen.ran.ask, false);
      assert.ok(seen.lines.includes(t("progress.confirmation_denied.user")), seen.lines.join("\n"));
      assert.ok(seen.lines.includes(t("summary.confirm_denied.user", { count: 1 })), seen.lines.join("\n"));
      assert.equal(seen.lines.includes(ruleHint), false);
    });

    test("at a terminal the input ends: no answer, so unanswered (this run could ask)", async () => {
      const seen = await run(language, ["ask.mjs"], null);
      assert.equal(seen.ran.ask, false);
      assert.ok(seen.lines.includes(t("progress.confirmation_denied.default")), seen.lines.join("\n"));
      assert.ok(seen.lines.includes(t("summary.confirm_denied.unanswered", { count: 1 })), seen.lines.join("\n"));
      assert.equal(seen.lines.includes(ruleHint), false);
    });

    test("at a terminal the person says yes: allowed for this call, it runs, and the summary has no denial lines", async () => {
      const seen = await run(language, ["ask.mjs"], language === "ko" ? "예" : "y");
      assert.equal(seen.ran.ask, true);
      assert.ok(seen.lines.includes(t("progress.confirmation_allowed")), seen.lines.join("\n"));
      for (const line of [...confirmLines(1), ruleHint]) assert.equal(seen.lines.includes(line), false, line);
    });

    test("a command with no rule besides: its add-a-rule hint stays, after the question's line", async () => {
      const seen = await run(language, ["ask.mjs", "other.mjs"]);
      assert.deepEqual(seen.ran, { ask: false, other: false });
      const unasked = seen.lines.indexOf(t("summary.confirm_denied.unasked", { count: 1 }));
      assert.ok(unasked > 0 && seen.lines[unasked + 1] === ruleHint, seen.lines.join("\n"));
    });
  });
}
