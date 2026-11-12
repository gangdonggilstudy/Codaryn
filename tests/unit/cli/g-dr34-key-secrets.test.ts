/**
 * DR-34 (b) (review R-20 M-2): a key variable the run does not use is registered as a secret only
 * from 20 characters, so a placeholder such as EMPTY, ollama or x (local OpenAI-compatible servers)
 * cannot break an unrelated run. The run's own provider's key is registered as before, and a real
 * key of another provider (long) still is. Real engine, store and tools; scripted model; fake
 * values built at run time. Nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV, OPENAI_API_KEY_ENV } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { MIN_OTHER_KEY_SECRET_LENGTH, runKeySecrets } from "../../../src/cli/settings.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

/** Read every file of every run record of the workspace. */
async function stateText(ws: string): Promise<string> {
  const runs = path.join(ws, ".codaryn", "runs");
  let text = "";
  for (const run of await readdir(runs)) {
    for (const file of await readdir(path.join(runs, run))) {
      if ((await stat(path.join(runs, run, file))).isFile()) text += await readFile(path.join(runs, run, file), "utf8");
    }
  }
  return text;
}

async function scriptedRead(fileText: string, env: Record<string, string>): Promise<{ status: string; state: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-dr34b-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  await writeFile(path.join(ws, "app.py"), fileText, "utf8");
  const steps = [{ toolCalls: [{ name: "read_file", args: { path: "app.py" } }] }, { text: "done" }];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(
    path.join(base, "task.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "g-dr34b",
      goal: "read the app",
      workflow: "label",
      workspaceRoot: "./ws",
      model: { provider: "scripted", scriptPath: "./script.json" },
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
      privacy: { secretEnv: [] },
      limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 },
      verifiers: [],
    }),
    "utf8",
  );
  const outcome = await runCli({
    argv: ["run", "--task", "task.json", "--quiet"],
    env,
    cwd: base,
    readFile: (file) => readFile(file, "utf8"),
    isDirectory: async (dir) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
    loadEnvFile: () => {},
    locateInWorkspace: (file, root) => locateInWorkspace(file, root),
    relatePaths: (target, root) => relateRealPaths(target, root),
    clock: { now: () => Date.now() },
    randomBytes: (size) => new Uint8Array(size).fill(6),
    assemble: assembleRun,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
  });
  assert.equal(outcome.output.kind, "run", JSON.stringify(outcome.output));
  return { status: (outcome.output as { status: string }).status, state: await stateText(ws) };
}

describe("DR-34 (b): which key values a run registers", () => {
  const short = "EMPTY";
  const long = ["fake", "dr34b", "openai", "value", "0001"].join("-");

  test("R-20 E: a placeholder in a key variable the run does not use leaves the run's text alone", async () => {
    const line = `client = OpenAI(api_key="${short}", base_url="http://localhost:11434/v1")  # ollama\n`;
    const { state } = await scriptedRead(line, { [OPENAI_API_KEY_ENV]: short });
    // The file text is JSON inside the record's JSON, so the quotes carry several backslashes.
    // Before DR-34 (b) the record held api_key="[[CODARYN_SECRET:…]]" here.
    assert.match(state, new RegExp(`api_key=\\\\*"${short}\\\\*"`), "the placeholder is read as plain text");
    assert.equal(state.includes("CODARYN_SECRET"), false, "nothing was masked");
  });

  test("a long value of a key the run does not use is still a secret (SP-2)", async () => {
    assert.ok(long.length >= MIN_OTHER_KEY_SECRET_LENGTH);
    const { state } = await scriptedRead(`token ${long}\n`, { [OPENAI_API_KEY_ENV]: long });
    assert.equal(state.includes(long), false);
  });

  test("the run's own key counts whatever its length; other keys from 20 characters", () => {
    const env = { [ANTHROPIC_API_KEY_ENV]: "short-own", [OPENAI_API_KEY_ENV]: "x" };
    assert.deepEqual(runKeySecrets(env, "anthropic"), ["short-own"]);
    assert.deepEqual(runKeySecrets(env, "openai"), ["x"]);
    assert.deepEqual(runKeySecrets(env, "scripted"), []);
    const nineteen = "a".repeat(MIN_OTHER_KEY_SECRET_LENGTH - 1);
    const twenty = "b".repeat(MIN_OTHER_KEY_SECRET_LENGTH);
    assert.deepEqual(runKeySecrets({ [ANTHROPIC_API_KEY_ENV]: nineteen, [OPENAI_API_KEY_ENV]: twenty }, "scripted"), [twenty]);
    assert.equal(MIN_OTHER_KEY_SECRET_LENGTH, 20);
  });
});
