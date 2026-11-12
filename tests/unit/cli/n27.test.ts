/**
 * N-27 (review R-7): (a) a run id that differs from the directory's name only in case is refused
 * (M-1); (b) report refuses a run the run list judges damaged (I-2); (c) report --json hides key
 * shapes broken by a control character, as the text does (L-2). Real store and files; scripted
 * model; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { EngineResult, RevertOutcome } from "../../../src/contracts/index.js";
import { assembleRun, createRevertCommand } from "../../../src/cli/assemble.js";
import { runReport } from "../../../src/cli/report.js";
import { runRevert } from "../../../src/cli/revert.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { inspectRun } from "../../../src/store/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Key-shaped, built at run time so the file never holds such a literal; BEL breaks it after "AB". */
const BROKEN_KEY_TAIL = "CDEFGHIJKLMNOPQRSTUVWXYZ012345";
const BROKEN_KEY = `${["sk", "ant", "AB"].join("-")}\u0007${BROKEN_KEY_TAIL}`;

async function finishedRun(): Promise<{ base: string; ws: string; runId: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-n27-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  const steps = [
    { toolCalls: [{ name: "write_file", args: { path: "notes.md", expectedHash: null, change: { kind: "replace_all", content: "notes\n" } } }] },
    { text: "done" },
  ];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  const task = {
    schemaVersion: 1,
    id: "n27",
    goal: "write notes",
    workflow: "document",
    workspaceRoot: "./ws",
    model: { provider: "scripted", scriptPath: "./script.json" },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
    privacy: { secretEnv: [] },
    limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 },
    verifiers: [{ id: "notes", kind: "file_rules", rules: [{ type: "exists", path: "notes.md" }] }],
  };
  await writeFile(path.join(base, "task.json"), JSON.stringify(task), "utf8");
  const outcome = await runCli({
    argv: ["run", "--task", "task.json", "--quiet"],
    env: {},
    cwd: base,
    readFile: (file) => readFile(file, "utf8"),
    isDirectory: async (dir) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
    loadEnvFile: () => {},
    locateInWorkspace: (file, root) => locateInWorkspace(file, root),
    relatePaths: (target, root) => relateRealPaths(target, root),
    clock: { now: () => Date.now() },
    randomBytes: (size) => new Uint8Array(size).fill(7),
    assemble: assembleRun,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
  });
  assert.equal(outcome.output.kind, "run");
  return { base, ws, runId: (outcome.output as EngineResult).runId };
}

describe("N-27 (a), R-7 M-1: a case variant of a run id is refused before anything is read", () => {
  test("revert with the lower-case id of a forged run changes nothing", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codaryn-n27a-"));
    temporaryDirs.push(base);
    const runId = "20991231T235957Z-0c0ffee0";
    await mkdir(path.join(base, ".codaryn", "runs", runId), { recursive: true });
    await writeFile(path.join(base, ".codaryn", "runs", runId, "journal.jsonl"), "", "utf8");
    const calls: string[] = [];
    const reverting = async (request: { runId: string }): Promise<RevertOutcome> => {
      calls.push(request.runId);
      return { reverted: [], skipped: [] };
    };
    const command = createRevertCommand(reverting, {
      dryRun: reverting,
      isDamaged: async (root, id) => (await inspectRun(root, id)) === "damaged",
    });
    for (const extra of [[], ["--dry-run"]]) {
      const outcome = await runRevert({
        argv: ["revert", "--workspace", base, "--run", runId.toLowerCase(), ...extra],
        cwd: base,
        isDirectory: async () => true,
        clock: { now: () => 0 },
        randomBytes: (size) => new Uint8Array(size).fill(3),
        revert: command,
      });
      // A case-insensitive volume finds the directory and the store judges the id damaged; a
      // case-sensitive one has no such run. Either way nothing is reverted.
      assert.ok(outcome.output.kind === "error" && ["invalid_run_record", "run_not_found"].includes(outcome.output.code), JSON.stringify(outcome.output));
    }
    assert.deepEqual(calls, []);
  });
});

describe("N-27 (b), R-7 I-2: report refuses a run the run list judges damaged", () => {
  test("a damaged run is invalid_run_record; a checked one reports as before", async () => {
    const { base, ws, runId } = await finishedRun();
    const damaged = await runReport({ argv: ["report", "--workspace", ws, "--run", runId, "--json"], cwd: base, env: {}, isDamaged: async () => true });
    assert.ok("output" in damaged && damaged.output.kind === "error" && damaged.output.code === "invalid_run_record");
    const fine = await runReport({ argv: ["report", "--workspace", ws, "--run", runId, "--json"], cwd: base, env: {} });
    assert.ok("text" in fine && fine.exitCode === 0, JSON.stringify(fine));
  });
});

describe("N-27 (c), R-7 L-2: report --json hides keys before the JSON is written", () => {
  test("a key shape broken by BEL in a recorded path is hidden in the JSON as in the text", async () => {
    const { base, ws, runId } = await finishedRun();
    const journal = path.join(ws, ".codaryn", "runs", runId, "journal.jsonl");
    const lines = (await readFile(journal, "utf8")).split("\n");
    const changed = lines.map((line) => {
      if (!line.includes('"file_changed"')) return line;
      const record = JSON.parse(line) as Record<string, unknown>;
      return JSON.stringify({ ...record, path: BROKEN_KEY });
    });
    await writeFile(journal, changed.join("\n"), "utf8");
    // The run list must not judge the edited run damaged for this check; report reads it as before.
    const options = { cwd: base, env: {}, isDamaged: async () => false };
    const text = await runReport({ argv: ["report", "--workspace", ws, "--run", runId], ...options });
    assert.ok("text" in text);
    assert.equal(text.text.includes(BROKEN_KEY_TAIL), false, "the text hides it");
    const json = await runReport({ argv: ["report", "--workspace", ws, "--run", runId, "--json"], ...options });
    assert.ok("text" in json, JSON.stringify(json));
    assert.equal(json.text.includes(BROKEN_KEY_TAIL), false, "the JSON hides it too");
    assert.ok(json.text.includes("[key]"));
  });
});
