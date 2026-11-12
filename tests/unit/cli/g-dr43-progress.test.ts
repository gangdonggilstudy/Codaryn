/**
 * DR-43 (b), review R-31 L-1: the run's start says what the workflow's rules left out of the given
 * policy (run_started.policyNarrowings, DR-41). doctor and the record said it; the progress lines
 * did not. withProgress (the CLI's) now writes several lines for one record, and the English
 * progress lines draw one per narrowing under the start line. The human renderer's lines
 * (src/cli/human/output.ts, the output owner's) come with its own change: todo here.
 * Real engine, store and tools for the process case; scripted model; nothing is sent.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";
import type { JournalEvent } from "../../../src/contracts/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { PROGRESS_PREFIX, withProgress } from "../../../src/cli/progress.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const STARTED = {
  type: "run_started",
  schemaVersion: 1,
  taskId: "t",
  workflow: "w",
  provider: "scripted",
  limits: { maxModelTurns: 1, maxToolCalls: 1, maxTotalTokens: null, maxDurationMs: 1 },
  policyNarrowings: [
    { kind: "commands_dropped", count: 2 },
    { kind: "plan_actions_dropped", count: 1 },
    { kind: "restore_path_tokens_off", count: 1 },
  ],
} as unknown as JournalEvent;

async function written(render?: (event: JournalEvent) => string | readonly string[] | null): Promise<string[]> {
  const lines: string[] = [];
  const journal = { append: async () => {}, close: async () => {} };
  const progress = withProgress(journal, createPrivacyGateway({ secrets: [] }), (line) => lines.push(line), render);
  await progress.append(STARTED);
  return lines;
}

describe("DR-43 (b): the run's start names what the workflow's rules left out", () => {
  test("the English lines: the start, then one line per narrowing, each with the prefix", async () => {
    const lines = await written();
    assert.equal(lines.length, 4, JSON.stringify(lines));
    assert.ok(lines.every((line) => line.startsWith(PROGRESS_PREFIX) && line.endsWith("\n")), JSON.stringify(lines));
    assert.equal(lines[1], `${PROGRESS_PREFIX}the workflow's own rules leave out command rules of the configured policy: 2\n`);
    assert.equal(lines[2], `${PROGRESS_PREFIX}the workflow's own rules leave out plan actions of the configured policy: 1\n`);
    assert.equal(lines[3], `${PROGRESS_PREFIX}the workflow's own rules turn off restoring path tokens, which the configured policy allows\n`);
  });

  test("no narrowing: only the start line, as before", async () => {
    const lines: string[] = [];
    const progress = withProgress({ append: async () => {}, close: async () => {} }, createPrivacyGateway({ secrets: [] }), (line) => lines.push(line));
    await progress.append({ ...(STARTED as object), policyNarrowings: undefined } as unknown as JournalEvent);
    assert.equal(lines.length, 1);
  });

  test("a renderer may give several lines for one record; each is written and masked on its own", async () => {
    const secret = ["fake", "dr43", "secret", "value"].join("-");
    const lines: string[] = [];
    const progress = withProgress({ append: async () => {}, close: async () => {} }, createPrivacyGateway({ secrets: [secret] }), (line) => lines.push(line), () => ["first", `second ${secret}`]);
    await progress.append(STARTED);
    assert.equal(lines.length, 2);
    assert.equal(lines[0], `${PROGRESS_PREFIX}first\n`);
    assert.equal(lines[1]?.includes(secret), false, lines[1] ?? "");
  });
});

describe("DR-43 (b): on the real CLI, stderr shows the narrowing at the start (human renderer)", () => {
  test(
    "a task file naming organize with a given plan action kind organize does not list",
    async () => {
      const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-dr43-"));
      temporaryDirs.push(base);
      await mkdir(path.join(base, "ws"));
      // The model's answer does not matter (organize takes it as malformed): the line comes at the start.
      // organize does not restore path tokens, the task's policy does: restore_path_tokens_off.
      await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps: [{ text: "done" }] }), "utf8");
      await writeFile(
        path.join(base, "task.json"),
        JSON.stringify({
          schemaVersion: 1,
          id: "dr43",
          goal: "g",
          workflow: "label",
          workspaceRoot: "./ws",
          workflowRef: "organize",
          model: { provider: "scripted", scriptPath: "./script.json" },
          policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: true, planActions: ["move"] },
          privacy: { secretEnv: [] },
          limits: { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: null, maxDurationMs: 60_000 },
          verifiers: [],
        }),
        "utf8",
      );
      const main = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "cli", "main.js");
      const env: Record<string, string> = { CODARYN_LANG: "en" };
      for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "HOME"]) {
        const value = process.env[name];
        if (value !== undefined) env[name] = value;
      }
      const run = spawnSync(process.execPath, [main, "run", "--task", "task.json"], { cwd: base, env, encoding: "utf8" });
      assert.ok(run.stderr.includes("path tokens"), run.stderr);
    },
  );
});
