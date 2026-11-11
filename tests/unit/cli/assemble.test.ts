/**
 * The CLI with the real assembly: real workspace, privacy, policy, tools, verifiers and store
 * on a temporary directory. The model is scripted. No network, no real secret, no API key.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { RunTask } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runCli } from "../../../src/cli/run.js";
import type { CliEnvironment } from "../../../src/cli/run.js";

const FAKE_SECRET = "fake-secret-VALUE-0001";
const temporaryDirs: string[] = [];

after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const sha = (text: string): string => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

async function setup(files: Record<string, string>, task: Record<string, unknown>, steps: unknown[]): Promise<string> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-unit-cli-"));
  temporaryDirs.push(base);
  await mkdir(path.join(base, "work"));
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(base, "work", name), content, "utf8");
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(
    path.join(base, "task.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "assembled",
      goal: "change the workspace",
      workflow: "test",
      workspaceRoot: "./work",
      model: { provider: "scripted", scriptPath: "./script.json" },
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
      privacy: { secretEnv: ["CODARYN_UNIT_SECRET"] },
      limits: { maxModelTurns: 6, maxToolCalls: 10, maxTotalTokens: null, maxDurationMs: 60_000 },
      verifiers: [],
      ...task,
    }),
    "utf8",
  );
  return base;
}

function io(base: string, extra: Partial<CliEnvironment> = {}): CliEnvironment {
  return {
    argv: ["run", "--task", path.join(base, "task.json")],
    env: { CODARYN_UNIT_SECRET: FAKE_SECRET },
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

async function stateFiles(base: string): Promise<string> {
  const runs = path.join(base, "work", ".codaryn", "runs");
  let text = "";
  for (const runId of await readdir(runs)) {
    for (const name of await readdir(path.join(runs, runId))) text += await readFile(path.join(runs, runId, name), "utf8");
  }
  return text;
}

describe("runCli with the real assembly", () => {
  test("a document task without Git runs to done, keeps the protected span and records only masked text", async () => {
    const readme = `# Title\r\nkey=${FAKE_SECRET}\r\n`;
    const base = await setup(
      { "README.md": readme },
      { verifiers: [{ id: "doc", kind: "file_rules", rules: [{ type: "contains", path: "README.md", text: "## Install" }] }] },
      [
        { toolCalls: [{ name: "read_file", args: { path: "README.md" } }] },
        {
          toolCalls: [
            {
              name: "write_file",
              args: {
                path: "README.md",
                expectedHash: sha(readme),
                change: { kind: "replace_text", oldText: "# Title\r\n", newText: "# Title\r\n\r\n## Install\r\n" },
              },
            },
          ],
        },
        { text: "done" },
      ],
    );
    const outcome = await runCli(io(base));
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.output.kind === "run" ? outcome.output.status : "", "done");

    const written = await readFile(path.join(base, "work", "README.md"), "utf8");
    assert.equal(written, `# Title\r\n\r\n## Install\r\nkey=${FAKE_SECRET}\r\n`);
    assert.equal(existsSync(path.join(base, "work", ".git")), false);

    const recorded = await stateFiles(base);
    assert.ok(recorded.includes('"type":"run_finished"'));
    assert.equal(recorded.includes(FAKE_SECRET), false);
    assert.equal(JSON.stringify(outcome).includes(FAKE_SECRET), false);
    assert.equal(existsSync(path.join(base, "work", ".codaryn", "lock.json")), false);
  });

  test("a failing command verifier ends as failed with exit code 1", async () => {
    const base = await setup(
      { "check.mjs": "process.exit(3);\n" },
      { verifiers: [{ id: "check", kind: "command", executable: process.execPath, args: ["check.mjs"] }] },
      [{ text: "nothing to do" }],
    );
    const outcome = await runCli(io(base));
    assert.equal(outcome.exitCode, 1);
    assert.equal(outcome.output.kind === "run" ? outcome.output.reason : "", "verifier_failed");
  });

  test("a live lock held by another run stops the CLI with workspace_locked and changes nothing", async () => {
    const base = await setup({ "a.txt": "keep\n" }, {}, [{ text: "done" }]);
    await mkdir(path.join(base, "work", ".codaryn"));
    const lockFile = path.join(base, "work", ".codaryn", "lock.json");
    const lock = JSON.stringify({ pid: process.pid, runId: "other-run", startedAt: new Date(0).toISOString() });
    await writeFile(lockFile, lock, "utf8");
    const outcome = await runCli(io(base));
    assert.equal(outcome.exitCode, 6);
    assert.equal(outcome.output.kind === "error" ? outcome.output.code : "", "workspace_locked");
    assert.equal(await readFile(lockFile, "utf8"), lock);
  });

  test("a run that throws still releases the workspace lock", async () => {
    const base = await setup({}, {}, [{ text: "done" }]);
    const failing: RunTask = async () => {
      throw new Error("boom");
    };
    const outcome = await runCli(io(base, { runTask: failing }));
    assert.equal(outcome.exitCode, 70);
    assert.equal(existsSync(path.join(base, "work", ".codaryn", "lock.json")), false);
  });
});
