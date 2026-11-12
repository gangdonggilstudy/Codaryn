/**
 * DR-38, the CLI's part (store 70c8516, 93eed67):
 * - the run's journal, change and plan recorders come from createRunRecorders, and its stateGuard
 *   is EngineDeps.stateGuard, so the guard knows what the run wrote: the run's own journal line is
 *   no change, a line added by anything else is
 * - `report` says a run has a records-changed mark (ReportOutput.recordsChanged, and a line in the
 *   human report); `revert` still reverts a marked run and says so (RevertOutput.recordsChanged)
 * - a mark that cannot be read counts as a mark (fail closed, state.ts)
 * Real assembly, store and tools; scripted model; nothing is sent.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { JOURNAL_FILE_NAME, RECORDS_CHANGED_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { EngineDeps, JournalEvent, ReportOutput, RevertOutput } from "../../../src/contracts/index.js";
import { assembleRun, createRevertCommand } from "../../../src/cli/assemble.js";
import { runReport } from "../../../src/cli/report.js";
import { runRevert } from "../../../src/cli/revert.js";
import { runCli } from "../../../src/cli/run.js";
import type { CliEnvironment } from "../../../src/cli/run.js";
import { locateInWorkspace } from "../../../src/cli/security/index.js";
import { revertRun } from "../../../src/store/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const sha = (text: string): string => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
const ORIGINAL = "one\n";

async function setup(steps: unknown[]): Promise<string> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-dr38-"));
  temporaryDirs.push(base);
  await mkdir(path.join(base, "work"));
  await writeFile(path.join(base, "work", "a.txt"), ORIGINAL, "utf8");
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(
    path.join(base, "task.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "dr38",
      goal: "change a.txt",
      workflow: "test",
      workspaceRoot: "./work",
      model: { provider: "scripted", scriptPath: "./script.json" },
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
      privacy: { secretEnv: [] },
      limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 },
      verifiers: [],
    }),
    "utf8",
  );
  return base;
}

function io(base: string, extra: Partial<CliEnvironment> = {}): CliEnvironment {
  return {
    argv: ["run", "--task", path.join(base, "task.json"), "--quiet"],
    env: {},
    cwd: base,
    readFile: (file) => readFile(file, "utf8"),
    isDirectory: async (dir) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
    loadEnvFile: () => {
      throw new Error("no env file in this test");
    },
    locateInWorkspace: (file, root) => locateInWorkspace(file, root),
    clock: { now: () => Date.now() },
    randomBytes: (size) => randomBytes(size),
    assemble: assembleRun,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    ...extra,
  };
}

const WRITE_STEPS = [
  { toolCalls: [{ name: "write_file", args: { path: "a.txt", expectedHash: sha(ORIGINAL), change: { kind: "replace_text", oldText: "one", newText: "two" } } }] },
  { text: "done" },
];

async function onlyRunId(base: string): Promise<string> {
  const runs = await readdir(path.join(base, "work", STATE_DIR_NAME, RUNS_DIR_NAME));
  assert.equal(runs.length, 1, JSON.stringify(runs));
  return runs[0] as string;
}

async function report(base: string, runId: string, json: boolean): Promise<{ text: string; exitCode: number }> {
  const outcome = await runReport({ argv: ["report", "--workspace", path.join(base, "work"), "--run", runId, ...(json ? ["--json"] : [])], cwd: base, env: {} });
  assert.ok("text" in outcome, JSON.stringify(outcome));
  return { text: outcome.text, exitCode: outcome.exitCode };
}

async function revert(base: string, runId: string): Promise<RevertOutput> {
  const outcome = await runRevert({
    argv: ["revert", "--workspace", path.join(base, "work"), "--run", runId, "--quiet"],
    cwd: base,
    isDirectory: async (dir) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
    clock: { now: () => Date.now() },
    randomBytes: (size) => randomBytes(size),
    revert: createRevertCommand(revertRun),
  });
  assert.equal(outcome.output.kind, "revert", JSON.stringify(outcome.output));
  return outcome.output as RevertOutput;
}

const markFile = (base: string, runId: string): string => path.join(base, "work", STATE_DIR_NAME, RUNS_DIR_NAME, runId, RECORDS_CHANGED_FILE_NAME);

describe("DR-38: the run's state guard is the engine's", () => {
  test("EngineDeps.stateGuard knows the run's own journal lines and finds a foreign one", async () => {
    const base = await setup([{ text: "done" }]);
    let checked = false;
    const outcome = await runCli(
      io(base, {
        assemble: async (input) => {
          const assembled = await assembleRun(input);
          if (!assembled.ok) return assembled;
          try {
            const deps: EngineDeps = assembled.deps;
            const guard = deps.stateGuard;
            assert.ok(guard !== undefined, "the CLI passes no stateGuard to the engine");
            const before = await guard.capture("run");
            await deps.journal.append({ type: "model_request", turn: 1, system: null, messages: [], tools: [] } as unknown as JournalEvent);
            const own = await guard.capture("run");
            assert.deepEqual(guard.compare(before, own).changed, [], "the run's own journal line is no change");
            const journalPath = path.join(input.task.workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME, input.runId, JOURNAL_FILE_NAME);
            await appendFile(journalPath, "{\"type\":\"foreign\"}\n", "utf8");
            const foreign = await guard.capture("run");
            assert.deepEqual(guard.compare(own, foreign).changed, [`${RUNS_DIR_NAME}/${input.runId}/${JOURNAL_FILE_NAME}`]);
            checked = true;
          } finally {
            await assembled.deps.journal.close();
            await assembled.finish(null);
          }
          return { ok: false, code: "internal_error", message: "stopped by the test" };
        },
      }),
    );
    assert.ok(checked, JSON.stringify(outcome.output));
  });
});

describe("DR-38: report and revert say a run has a records-changed mark", () => {
  test("report --json: recordsChanged only for a marked run; the human report says it", async () => {
    const base = await setup(WRITE_STEPS);
    await runCli(io(base));
    const runId = await onlyRunId(base);
    const plain = JSON.parse((await report(base, runId, true)).text) as ReportOutput;
    assert.equal(plain.recordsChanged, undefined);
    assert.equal((await report(base, runId, false)).text.includes("records-changed mark"), false);

    await writeFile(markFile(base, runId), "{}", "utf8");
    const marked = JSON.parse((await report(base, runId, true)).text) as ReportOutput;
    assert.equal(marked.recordsChanged, true);
    assert.equal(marked.status, "complete", "the report is still shown");
    const human = (await report(base, runId, false)).text;
    assert.ok(human.includes("This run has a records-changed mark"), human);
  });

  test("a mark that is a directory, not a file, counts as a mark (fail closed)", async () => {
    const base = await setup(WRITE_STEPS);
    await runCli(io(base));
    const runId = await onlyRunId(base);
    await mkdir(markFile(base, runId));
    const marked = JSON.parse((await report(base, runId, true)).text) as ReportOutput;
    assert.equal(marked.recordsChanged, true);
  });

  test("revert reverts a marked run as before and says it is marked", async () => {
    const base = await setup(WRITE_STEPS);
    await runCli(io(base));
    const runId = await onlyRunId(base);
    assert.equal(await readFile(path.join(base, "work", "a.txt"), "utf8"), "two\n");
    await writeFile(markFile(base, runId), "{}", "utf8");
    const output = await revert(base, runId);
    assert.equal(output.status, "complete", JSON.stringify(output));
    assert.equal(output.recordsChanged, true);
    assert.equal(await readFile(path.join(base, "work", "a.txt"), "utf8"), ORIGINAL);
  });

  test("revert of an unmarked run has no recordsChanged", async () => {
    const base = await setup(WRITE_STEPS);
    await runCli(io(base));
    const output = await revert(base, await onlyRunId(base));
    assert.equal(output.status, "complete", JSON.stringify(output));
    assert.equal(output.recordsChanged, undefined);
  });
});

describe("DR-38 on the real assembly: a run whose records change during the run", () => {
  test("a command verifier that adds a file to the run's records ends the run failed/state_changed; report shows it", async () => {
    const base = await setup([{ text: "done" }]);
    // The verifier is task configuration (no model request): it adds a file to every run's records.
    const tamper = "const fs=require('fs');const d='.codaryn/runs';for(const r of fs.readdirSync(d))fs.writeFileSync(d+'/'+r+'/extra.txt','x')";
    const task = JSON.parse(await readFile(path.join(base, "task.json"), "utf8")) as Record<string, unknown>;
    task["verifiers"] = [{ id: "tamper", kind: "command", executable: process.execPath, args: ["-e", tamper] }];
    await writeFile(path.join(base, "task.json"), JSON.stringify(task), "utf8");
    const outcome = await runCli(io(base));
    const result = outcome.output as { status?: string; reason?: string; stateChanged?: readonly string[] };
    assert.deepEqual([result.status, result.reason], ["failed", "state_changed"], JSON.stringify(outcome.output));
    const runId = await onlyRunId(base);
    assert.deepEqual(result.stateChanged, [`${RUNS_DIR_NAME}/${runId}/extra.txt`]);

    const shown = JSON.parse((await report(base, runId, true)).text) as ReportOutput;
    assert.equal(shown.recordsChanged, true, "the engine marked the run");
    assert.deepEqual(shown.result?.stateChanged, result.stateChanged, "the report keeps the recorded list");
    assert.deepEqual([shown.result?.status, shown.result?.reason], ["failed", "state_changed"]);
  });
});
