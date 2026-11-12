/**
 * DR-40 (review R-25), the CLI's part, with the review's reproduction inputs on the real CLI process
 * (dist/src/cli/main.js, the network guard preloaded, loopback fake servers only):
 * (a) a key split by a line break or an invisible character within its first 38 characters is
 *     refused like the whole key (main refused it; the narrowed shape alone does not): the
 *     registered value and the refusal shapes are also compared on the text without separators
 *     and format characters (\p{Cf}). In the goal, a task file, a config file, with the key
 *     registered from the environment or a variables file, and on an openai run without the
 *     Anthropic key (A10). Every case: key_in_file, no request.
 * (b) task and config files have a size cap; a larger one is refused with a fixed message.
 * (c) the 256 KiB task file of R-25 L-2 ends quickly (main 157 ms, the narrowed shape 13.6 s): todo
 *     until the contract's linear refusal shape is connected.
 * The fake key has the real format and is assembled at run time; nothing leaves the machine.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { TestContext } from "node:test";
import { ANTHROPIC_API_KEY_ENV, CODARYN_API_BASE_URL_ENV, CODARYN_OPENAI_API_BASE_URL_ENV, OPENAI_API_KEY_ENV } from "../../../src/contracts/index.js";
import { cliEnv, startCli } from "../../support/cli.js";
import { replyText, startFakeAnthropic } from "../../support/fake-anthropic.js";
import { replyFinal, startFakeOpenAI } from "../../support/fake-openai.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const char = (code: number): string => String.fromCharCode(code);
/** A key of the real Anthropic format (prefix, `api03-`, 93 characters ending in AA), assembled at run time. */
const BODY = `${"Qx7_Lm2-Pz9vRt4".repeat(6)}`.slice(0, 91);
const KEY = `${["sk", "ant", "api03"].join("-")}-${BODY}AA`;
/** R-25: the split goes after the 18th character after the prefix (the key's 26th place). */
const AT = 25;
const split = (with_: string): string => `${KEY.slice(0, AT)}${with_}${KEY.slice(AT)}`;
const SPLITTERS: readonly (readonly [string, string])[] = [
  ["zero-width space (A2)", char(0x200b)],
  ["line feed (A3)", char(0x0a)],
  ["CRLF", `${char(0x0d)}${char(0x0a)}`],
  ["soft hyphen (A16)", char(0x00ad)],
  ["no-break space", char(0x00a0)],
  ["word joiner", char(0x2060)],
  ["tab", char(0x09)],
];
const OPENAI_VALUE = ["fake", "dr40", "openai", "value", "0001"].join("-");
const LIMITS = { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 10_000, maxDurationMs: 60_000 };

interface Run {
  readonly code: string | null;
  readonly message: string;
  readonly guard: string;
  readonly durationMs: number;
}

async function base(): Promise<{ dir: string; ws: string; guard: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "codaryn-g-dr40-"));
  temporaryDirs.push(dir);
  const ws = path.join(dir, "ws");
  await mkdir(ws);
  return { dir, ws, guard: path.join(dir, "net-guard.log") };
}

async function cli(dir: string, guard: string, args: readonly string[], env: Record<string, string>): Promise<Run> {
  // The harness's own environment helper refuses key-shaped values on purpose; this case needs
  // one, so the environment is the harness's base with the keys added here.
  const run = await startCli(args, { cwd: dir, env: { ...cliEnv(), ...env }, netGuardLog: guard, timeoutMs: 60_000 }).done;
  let code: string | null = null;
  let message = "";
  try {
    const output = JSON.parse(run.stdout) as { kind?: string; code?: string; message?: string };
    code = output.kind === "error" ? (output.code ?? null) : null;
    message = output.message ?? "";
  } catch {
    message = run.stdout + run.stderr;
  }
  const logged = await readFile(guard, "utf8").catch(() => "");
  return { code, message, guard: logged, durationMs: run.durationMs };
}

/** An anthropic quick-form setup whose requests go to a fake server on 127.0.0.1. */
async function anthropicSetup(t: TestContext): Promise<{ dir: string; ws: string; guard: string; requests: () => number; env: Record<string, string> }> {
  const api = await startFakeAnthropic(t, [replyText("done")]);
  const { dir, ws, guard } = await base();
  await writeFile(path.join(dir, "config.json"), JSON.stringify({ schemaVersion: 1, model: "claude-fake", maxOutputTokens: 100, limits: LIMITS }), "utf8");
  return { dir, ws, guard, requests: () => api.requests.length, env: { [CODARYN_API_BASE_URL_ENV]: api.url } };
}

function refused(run: Run, requests: number): void {
  assert.equal(run.code, "key_in_file", run.message);
  assert.equal(requests, 0, "no request was made");
  assert.equal(run.guard, "", "nothing tried to leave the machine");
  assert.equal(run.message.includes(KEY.slice(AT)), false, "the message holds no part of the key");
}

describe("DR-40 (a): a split key is refused like the whole key (R-25 M-1)", () => {
  for (const [name, splitter] of SPLITTERS) {
    test(`--goal, ${name}, the key registered from the environment`, async (t) => {
      const setup = await anthropicSetup(t);
      const run = await cli(setup.dir, setup.guard, ["run", "--workspace", setup.ws, "--goal", `use ${split(splitter)} please`, "--config", "config.json", "--quiet"], {
        ...setup.env,
        [ANTHROPIC_API_KEY_ENV]: KEY,
      });
      refused(run, setup.requests());
    });
  }

  test("a task file's goal holds the split key (zero-width space)", async (t) => {
    const setup = await anthropicSetup(t);
    await writeFile(
      path.join(setup.dir, "task.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "dr40",
        goal: `use ${split(char(0x200b))}`,
        workflow: "label",
        workspaceRoot: "./ws",
        model: { provider: "anthropic" },
        policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
        privacy: { secretEnv: [] },
        limits: LIMITS,
        verifiers: [],
      }),
      "utf8",
    );
    const run = await cli(setup.dir, setup.guard, ["run", "--task", "task.json", "--config", "config.json", "--quiet"], { ...setup.env, [ANTHROPIC_API_KEY_ENV]: KEY });
    refused(run, setup.requests());
  });

  test("a config file holds the split key (line feed, written as \\n in JSON)", async (t) => {
    const setup = await anthropicSetup(t);
    await writeFile(path.join(setup.dir, "keyed.json"), JSON.stringify({ schemaVersion: 1, model: split(char(0x0a)), maxOutputTokens: 100, limits: LIMITS }), "utf8");
    const run = await cli(setup.dir, setup.guard, ["run", "--workspace", setup.ws, "--goal", "g", "--config", "keyed.json", "--quiet"], { ...setup.env, [ANTHROPIC_API_KEY_ENV]: KEY });
    refused(run, setup.requests());
  });

  test("the key registered from a variables file, split in the goal (soft hyphen)", async (t) => {
    const setup = await anthropicSetup(t);
    await writeFile(path.join(setup.dir, "vars.env"), `${ANTHROPIC_API_KEY_ENV}=${KEY}\n`, "utf8");
    const run = await cli(setup.dir, setup.guard, ["run", "--workspace", setup.ws, "--goal", `use ${split(char(0x00ad))}`, "--config", "config.json", "--vars-file", "vars.env", "--quiet"], setup.env);
    refused(run, setup.requests());
  });

  test("A10: an openai run without the Anthropic key; the split Anthropic key in the goal", { todo: "contract: the refusal shapes on the joined text, with the shared function and the linear shapes (DR-40 (a)(c)); no registered value to compare here" }, async (t) => {
    const api = await startFakeOpenAI(t, [replyFinal("done")]);
    const { dir, ws, guard } = await base();
    await writeFile(path.join(dir, "config.json"), JSON.stringify({ schemaVersion: 1, provider: "openai", providers: { openai: { model: "gpt-fake", maxOutputTokens: 64 } }, limits: LIMITS }), "utf8");
    const run = await cli(dir, guard, ["run", "--workspace", ws, "--goal", `use ${split(char(0x200b))}`, "--config", "config.json", "--quiet"], {
      [OPENAI_API_KEY_ENV]: OPENAI_VALUE,
      [CODARYN_OPENAI_API_BASE_URL_ENV]: api.baseUrl,
    });
    refused(run, api.requests.length);
  });
});

describe("DR-40 (b), (c): task and config file size (R-25 L-2)", () => {
  test("a task file over the cap is refused with a fixed message, nothing read from it shown", async (t) => {
    const setup = await anthropicSetup(t);
    const filler = `{"schemaVersion":1,"goal":"${"q".repeat(2 * 1024 * 1024)}"}`;
    await writeFile(path.join(setup.dir, "big.json"), filler, "utf8");
    const run = await cli(setup.dir, setup.guard, ["run", "--task", "big.json", "--config", "config.json", "--quiet"], { ...setup.env, [ANTHROPIC_API_KEY_ENV]: KEY });
    assert.equal(run.code, "invalid_task", run.message);
    assert.ok(run.message.includes("larger than") && !run.message.includes("qqqq"), run.message);
    assert.equal(setup.requests(), 0);
  });

  test("a config file over the cap is refused with a fixed message", async (t) => {
    const setup = await anthropicSetup(t);
    await writeFile(path.join(setup.dir, "big.json"), `{"schemaVersion":1,"model":"${"q".repeat(2 * 1024 * 1024)}"}`, "utf8");
    const run = await cli(setup.dir, setup.guard, ["run", "--workspace", setup.ws, "--goal", "g", "--config", "big.json", "--quiet"], { ...setup.env, [ANTHROPIC_API_KEY_ENV]: KEY });
    assert.equal(run.code, "invalid_config", run.message);
    assert.ok(run.message.includes("larger than") && !run.message.includes("qqqq"), run.message);
    assert.equal(setup.requests(), 0);
  });

  test(
    "R-25 L-2: the 256 KiB task file of repeated prefixes ends quickly and is refused, no request",
    { todo: "contract: the linear refusal shape (DR-40 (c)) on claude/general-tasks, then connected here" },
    async (t) => {
      const setup = await anthropicSetup(t);
      const prefix = `${["sk", "ant"].join("-")}-`;
      await writeFile(path.join(setup.dir, "slow.json"), prefix.repeat(Math.floor((256 * 1024) / prefix.length)), "utf8");
      const run = await cli(setup.dir, setup.guard, ["run", "--task", "slow.json", "--config", "config.json", "--quiet"], { ...setup.env, [ANTHROPIC_API_KEY_ENV]: KEY });
      assert.ok(run.code === "key_in_file" || run.code === "invalid_task", run.message);
      assert.ok(run.durationMs < 3000, `took ${run.durationMs} ms`);
      assert.equal(setup.requests(), 0);
    },
  );
});

describe("DR-40 (a): the CLI's output hiding finds split keys too (hideKeys)", () => {
  const REGISTERED = ["fake", "registered", "value", "not", "shaped", "0001"].join("-");
  for (const [name, splitter] of SPLITTERS) {
    test(`${name}: a split registered value and a split key shape leave nothing behind`, async () => {
      const { hideKeys } = await import("../../../src/cli/text-safety.js");
      const value = hideKeys(`a ${REGISTERED.slice(0, 10)}${splitter}${REGISTERED.slice(10)} b`, [REGISTERED]);
      assert.equal(value.includes(REGISTERED.slice(10)), false, JSON.stringify(value));
      const shaped = hideKeys(`a ${split(splitter)} b`, []);
      // Whitespace inside a shape is a visible break; only control and format characters are skipped for shapes.
      if (!/\s/u.test(splitter)) assert.equal(shaped.includes(KEY.slice(AT)), false, JSON.stringify(shaped));
    });
  }

  test("a key written plainly after a word is still hidden by its shape (no gluing to the word before)", async () => {
    const { hideKeys } = await import("../../../src/cli/text-safety.js");
    const hidden = hideKeys(`use ${KEY} now`, []);
    assert.equal(hidden, "use [key] now");
  });
});
