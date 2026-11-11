/**
 * Regressions for the H2 cross review fixes owned by the CLI (S-C):
 * - S-2 (H2-2): ANTHROPIC_API_KEY is registered as a secret whatever the provider, so a scripted
 *   run that reads a file holding the key leaves no trace of it.
 * - S-6, top level (H2-6): any exception becomes one internal_error JSON object with exit code 70,
 *   without a stack or the error's text.
 * Real assembly on a temporary directory, scripted model, fake values only, no network.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runGuarded } from "../../../src/cli/guard.js";
import { runCli } from "../../../src/cli/run.js";
import type { CliEnvironment } from "../../../src/cli/run.js";

/** Not a real key format. */
const FAKE_KEY = "fake-api-key-not-real-0077";
const temporaryDirs: string[] = [];

after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

function io(base: string, env: Record<string, string | undefined>, extra: Partial<CliEnvironment> = {}): CliEnvironment {
  return {
    argv: ["run", "--task", path.join(base, "task.json")],
    env,
    cwd: base,
    readFile: (file) => readFile(file, "utf8"),
    isDirectory: async (dir) => {
      try {
        return (await stat(dir)).isDirectory();
      } catch {
        return false;
      }
    },
    loadEnvFile: () => {
      throw new Error("no env file in this test");
    },
    clock: { now: () => Date.now() },
    randomBytes: (size) => randomBytes(size),
    assemble: assembleRun,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    ...extra,
  };
}

/** A scripted task whose model reads `keys.env`, a workspace file holding the key. */
async function scriptedKeyReader(): Promise<string> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-unit-sc-"));
  temporaryDirs.push(base);
  await mkdir(path.join(base, "work"));
  await writeFile(path.join(base, "work", "keys.env"), `ANTHROPIC_API_KEY=${FAKE_KEY}\nOTHER=1\n`, "utf8");
  await writeFile(
    path.join(base, "script.json"),
    JSON.stringify({
      schemaVersion: 1,
      steps: [{ toolCalls: [{ id: "r1", name: "read_file", args: { path: "keys.env" } }] }, { text: "read it" }],
    }),
    "utf8",
  );
  await writeFile(
    path.join(base, "task.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "sc-key",
      goal: "look at the env file",
      workflow: "code",
      workspaceRoot: "./work",
      model: { provider: "scripted", scriptPath: "./script.json" },
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
      privacy: { secretEnv: [] },
      limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 },
      verifiers: [{ id: "env", kind: "file_rules", rules: [{ type: "exists", path: "keys.env" }] }],
    }),
    "utf8",
  );
  return base;
}

async function stateText(base: string): Promise<string> {
  const runs = path.join(base, "work", ".codaryn", "runs");
  let text = "";
  for (const runId of await readdir(runs)) {
    for (const name of await readdir(path.join(runs, runId))) text += await readFile(path.join(runs, runId, name), "utf8");
  }
  return text;
}

describe("S-2 the key is a secret whatever the provider", () => {
  test("a scripted run that reads a file holding the key records and prints only a token", async () => {
    const base = await scriptedKeyReader();
    const outcome = await runCli(io(base, { ANTHROPIC_API_KEY: FAKE_KEY }));
    assert.equal(outcome.output.kind === "run" ? outcome.output.status : "", "done");
    assert.equal(outcome.output.kind === "run" ? outcome.output.provider : "", "scripted");

    const recorded = await stateText(base);
    assert.ok(recorded.includes('"type":"tool_result"'));
    assert.equal(recorded.includes(FAKE_KEY), false, "the journal and result must not hold the key");
    assert.ok(recorded.includes("ANTHROPIC_API_KEY=[[CODARYN_SECRET:"), "the key is replaced by a token");
    assert.equal(JSON.stringify(outcome).includes(FAKE_KEY), false);
  });

  test("a key set with surrounding spaces is registered as the trimmed value", async () => {
    const base = await scriptedKeyReader();
    const outcome = await runCli(io(base, { ANTHROPIC_API_KEY: `  ${FAKE_KEY}  ` }));
    assert.equal(outcome.output.kind === "run" ? outcome.output.status : "", "done");
    assert.equal((await stateText(base)).includes(FAKE_KEY), false);
  });

  test("without a key nothing extra is registered and the run is unchanged", async () => {
    const base = await scriptedKeyReader();
    const outcome = await runCli(io(base, { ANTHROPIC_API_KEY: "   " }));
    assert.equal(outcome.output.kind === "run" ? outcome.output.status : "", "done");
    assert.ok((await stateText(base)).includes(`ANTHROPIC_API_KEY=${FAKE_KEY}`), "an unset key is not a secret");
  });
});

describe("S-6 the top level turns any exception into one internal_error object", () => {
  function assertInternalError(outcome: { output: unknown; exitCode: number }, ...hidden: string[]): void {
    assert.equal(outcome.exitCode, 70);
    assert.deepEqual(Object.keys(outcome.output as object).sort(), ["code", "exitCode", "kind", "message", "schemaVersion"]);
    const output = outcome.output as { kind: string; code: string; exitCode: number; message: string };
    assert.equal(output.kind, "error");
    assert.equal(output.code, "internal_error");
    assert.equal(output.exitCode, 70);
    const printed = JSON.stringify(outcome.output);
    assert.equal(printed.includes("\n"), false);
    for (const text of ["    at ", ".ts:", ".js:", ...hidden]) assert.equal(printed.includes(text), false, `must not print ${JSON.stringify(text)}`);
  }

  test("a rejected command prints neither the stack nor the error text", async () => {
    const outcome = await runGuarded(async () => {
      throw new Error(`failed near ${FAKE_KEY} in C:\\work\\secret.txt`);
    });
    assertInternalError(outcome, FAKE_KEY, "secret.txt", "failed near");
  });

  test("a non-Error rejection and a synchronous throw are handled the same way", async () => {
    assertInternalError(await runGuarded(() => Promise.reject(`raw ${FAKE_KEY}`)), FAKE_KEY);
    assertInternalError(
      await runGuarded(() => {
        throw new RangeError("Maximum call stack size exceeded");
      }),
      "Maximum call stack",
    );
  });

  test("a normal outcome passes through unchanged", async () => {
    const outcome = { output: { schemaVersion: 1, kind: "error", code: "invalid_arguments", exitCode: 2, message: "usage" } as const, exitCode: 2 };
    assert.deepEqual(await runGuarded(async () => outcome), outcome);
  });

  test("H2-6: a task nested 20000 deep ends as one JSON error, not a crash", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codaryn-unit-sc-deep-"));
    temporaryDirs.push(base);
    await mkdir(path.join(base, "work"));
    const deep = `${"[".repeat(20_000)}${"]".repeat(20_000)}`;
    await writeFile(path.join(base, "task.json"), `{"schemaVersion":1,"id":"deep","extra":${deep}}`, "utf8");
    const outcome = await runGuarded(() => runCli(io(base, {})));
    // Until the depth limit of S-6 is connected, the key check overflows the stack: internal_error.
    assertInternalError(outcome);
    assert.equal(await stat(path.join(base, "work", ".codaryn")).then(() => true, () => false), false);
  });
});
