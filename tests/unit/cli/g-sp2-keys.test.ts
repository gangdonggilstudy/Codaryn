/**
 * SP-2 (docs/design/second-provider.md 4.2, 4.3; DR-31 g): every key Codaryn knows is a secret in
 * every run and is hidden in every output, whatever provider runs; every known key shape is refused
 * in files and arguments. Before SP-2 only the Anthropic key and shape were. Real engine, store and
 * tools; scripted model; fake values built at run time. Nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { OPENAI_API_KEY_ENV } from "../../../src/contracts/index.js";
import type { EngineResult } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runReport } from "../../../src/cli/report.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

/** The OpenAI key value as a person would have it set: not key-shaped, so only S-2 can hide it. */
const OPENAI_VALUE = ["fake", "openai", "sp2", "value", "0001"].join("-");
/**
 * An OpenAI-shaped key under every refusal shape of the contract (DR-32 (a), DR-33): a distinct
 * prefix, then upper- and lower-case letters and digits.
 */
const OPENAI_SHAPED = `${"sk"}-${"proj"}-${"Ab3x".repeat(10)}`;

const io = (base: string, argv: readonly string[], env: Record<string, string>) => ({
  argv,
  env,
  cwd: base,
  readFile: (file: string) => readFile(file, "utf8"),
  isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
  loadEnvFile: () => {},
  locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
  relatePaths: (target: string, root: string) => relateRealPaths(target, root),
  clock: { now: () => Date.now() },
  randomBytes: (size: number) => new Uint8Array(size).fill(9),
  assemble: assembleRun,
  cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
});

async function setup(files: Record<string, string>, extra: Record<string, unknown> = {}): Promise<{ base: string; ws: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-sp2-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(ws, name), text, "utf8");
  const steps = [{ toolCalls: [{ name: "read_file", args: { path: "notes.md" } }] }, { text: "done" }];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(
    path.join(base, "task.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "g-sp2",
      goal: "read the notes",
      workflow: "label",
      workspaceRoot: "./ws",
      model: { provider: "scripted", scriptPath: "./script.json" },
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
      privacy: { secretEnv: [] },
      limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 },
      verifiers: [],
      ...extra,
    }),
    "utf8",
  );
  return { base, ws };
}

async function stateText(ws: string): Promise<string> {
  const runs = path.join(ws, ".codaryn", "runs");
  let text = "";
  for (const run of await readdir(runs)) {
    for (const file of await readdir(path.join(runs, run))) {
      const info = await stat(path.join(runs, run, file));
      if (info.isFile()) text += await readFile(path.join(runs, run, file), "utf8");
    }
  }
  return text;
}

describe("SP-2: the OpenAI key is a secret in every run (S-2 for every known key)", () => {
  test("a scripted run that reads a file holding the OpenAI key value records no plain value", async () => {
    const { base, ws } = await setup({ "notes.md": `token ${OPENAI_VALUE}\n` });
    const outcome = await runCli(io(base, ["run", "--task", "task.json", "--quiet"], { [OPENAI_API_KEY_ENV]: OPENAI_VALUE }));
    assert.equal(outcome.output.kind, "run", JSON.stringify(outcome.output));
    assert.equal(JSON.stringify(outcome.output).includes(OPENAI_VALUE), false, "the result");
    assert.equal((await stateText(ws)).includes(OPENAI_VALUE), false, "the run's records");
  });
});

describe("SP-2: every known key is hidden in output", () => {
  test("report hides the OpenAI key value found in older records", async () => {
    const { base, ws } = await setup({ "notes.md": "plain\n" });
    const outcome = await runCli(io(base, ["run", "--task", "task.json", "--quiet"], {}));
    const runId = (outcome.output as EngineResult).runId;
    // An older record that holds the value (written before the key was set, say).
    const journal = path.join(ws, ".codaryn", "runs", runId, "journal.jsonl");
    const text = await readFile(journal, "utf8");
    await writeFile(journal, text.replace('"workflow":"label"', `"workflow":"label ${OPENAI_VALUE}"`), "utf8");
    for (const extra of [[], ["--json"]]) {
      const report = await runReport({ argv: ["report", "--workspace", ws, "--run", runId, ...extra], cwd: base, env: { [OPENAI_API_KEY_ENV]: OPENAI_VALUE }, isDamaged: async () => false });
      assert.ok("text" in report, JSON.stringify(report));
      assert.equal(report.text.includes(OPENAI_VALUE), false, `report ${extra.join(" ")}`);
    }
  });
});

describe("SP-2: every known key shape and value is refused in files and arguments (S-6, S-8)", () => {
  test("an OpenAI-shaped key in the config file is key_in_file", async () => {
    const { base, ws } = await setup({ "notes.md": "x\n" });
    await writeFile(path.join(base, "config.json"), JSON.stringify({ schemaVersion: 1, model: OPENAI_SHAPED }), "utf8");
    const outcome = await runCli(io(base, ["run", "--task", "task.json", "--config", "config.json", "--quiet"], {}));
    assert.ok(outcome.output.kind === "error" && outcome.output.code === "key_in_file", JSON.stringify(outcome.output));
    void ws;
  });

  test("an OpenAI-shaped key in the goal is key_in_file", async () => {
    const { base, ws } = await setup({ "notes.md": "x\n" });
    // The quick form needs the config's limits to reach the goal's key check (S-8).
    const limits = { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 1000, maxDurationMs: 60_000 };
    await writeFile(path.join(base, "config.json"), JSON.stringify({ schemaVersion: 1, limits }), "utf8");
    const outcome = await runCli(io(base, ["run", "--workspace", ws, "--goal", `use ${OPENAI_SHAPED}`, "--config", "config.json", "--quiet"], {}));
    assert.ok(outcome.output.kind === "error" && outcome.output.code === "key_in_file", JSON.stringify(outcome.output));
  });

  test("the OpenAI key's value in the task file is key_in_file", async () => {
    const { base } = await setup({ "notes.md": "x\n" }, { goal: `read the notes ${OPENAI_VALUE}` });
    const outcome = await runCli(io(base, ["run", "--task", "task.json", "--quiet"], { [OPENAI_API_KEY_ENV]: OPENAI_VALUE }));
    assert.ok(outcome.output.kind === "error" && outcome.output.code === "key_in_file", JSON.stringify(outcome.output));
    assert.equal(JSON.stringify(outcome.output).includes(OPENAI_VALUE), false);
  });

  test("a field named after the OpenAI key variable is named in the message, as the Anthropic one is", async () => {
    const { base } = await setup({ "notes.md": "x\n" });
    await writeFile(path.join(base, "config.json"), JSON.stringify({ schemaVersion: 1, OPENAI_API_KEY: "x" }), "utf8");
    const outcome = await runCli(io(base, ["run", "--task", "task.json", "--config", "config.json", "--quiet"], {}));
    assert.ok(outcome.output.kind === "error" && outcome.output.code === "key_in_file", JSON.stringify(outcome.output));
    assert.ok(outcome.output.message.includes("OPENAI_API_KEY"), outcome.output.message);
  });
});
