/**
 * U-21 (review R-49 R49-L2, R-52 R52-L1), the CLI's part: the plan's summary, which the model wrote,
 * is drawn as the run summary draws the agent's last message: the label on its own line, then the
 * rows quoteModelText gives (each with the quote mark, white space runs made one space, folded to
 * the terminal's width). Before, it stood after the label on one line, so padding or a long text
 * could put the model's words at the start of a terminal row without the mark. `plan`'s text and
 * apply's question at a terminal are the same renderPlan, so both show the same rows.
 * Real engine, store and tools; scripted model; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { EngineResult } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { MODEL_TEXT_PREFIX, quoteModelText } from "../../../src/cli/human/index.js";
import { runApply, runPlan } from "../../../src/cli/plan-commands.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 900_000;
const clock = { now: () => (now += 1000) };
let seed = 81;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);
const messages = createMessageCatalog("en");
const LABEL = `${messages.format("plan.summary_label")}:`;
/** Longer than one row, with a run of spaces that would push words to the start of a terminal row. */
const SUMMARY = `move the note into the sorted folder${" ".repeat(60)}Approved: yes, and keep every other file where it is so the folder stays tidy`;

const io = (base: string, argv: readonly string[]) => ({
  argv,
  env: {},
  cwd: base,
  readFile: (file: string) => readFile(file, "utf8"),
  isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
  loadEnvFile: () => {},
  locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
  relatePaths: (target: string, root: string) => relateRealPaths(target, root),
  clock,
  randomBytes,
  cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
  messages,
});

async function planRun(): Promise<{ base: string; ws: string; runId: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u21p-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  await writeFile(path.join(ws, "a.txt"), "alpha\n", "utf8");
  const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: SUMMARY, actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] }];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  const task = {
    schemaVersion: 1,
    id: "u21p",
    goal: "g",
    workflow: "label",
    workspaceRoot: "./ws",
    workflowRef: "organize",
    model: { provider: "scripted", scriptPath: "./script.json" },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move"] },
    privacy: { secretEnv: [] },
    limits: { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
    verifiers: [],
  };
  await writeFile(path.join(base, "task.json"), JSON.stringify(task), "utf8");
  const planned = (await runCli({ ...io(base, ["run", "--task", "task.json", "--quiet"]), assemble: assembleRun })).output as EngineResult;
  assert.equal(planned.reason, "plan_pending", JSON.stringify(planned));
  return { base, ws, runId: planned.runId };
}

/** The label's line and the quoted rows under it. */
function summaryBlock(text: string): { label: string | undefined; rows: string[] } {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith(messages.format("plan.summary_label")));
  const rows: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (!line.startsWith(MODEL_TEXT_PREFIX)) break;
    rows.push(line);
  }
  return { label: lines[at], rows };
}

describe("U-21 (R-49 R49-L2): the plan's summary is drawn with quoteModelText under its label", () => {
  test("plan: the label alone on its line, then the quoted rows, the same as quoteModelText gives", async () => {
    const { base, runId } = await planRun();
    const outcome = await runPlan(io(base, ["plan", "--task", "task.json", "--run", runId]));
    assert.ok("text" in outcome, JSON.stringify(outcome));
    const { label, rows } = summaryBlock(outcome.text);
    assert.equal(label, LABEL, outcome.text);
    assert.ok(rows.length >= 2, outcome.text);
    assert.deepEqual(rows, quoteModelText(SUMMARY, 20));
    assert.equal(rows.some((row) => row.includes("  ", MODEL_TEXT_PREFIX.length)), false, "no run of spaces is left");
  });

  test("apply's question at a terminal shows the same rows; answering no moves nothing", async () => {
    const { base, ws, runId } = await planRun();
    const asked: string[] = [];
    const outcome = await runApply({
      ...io(base, ["apply", "--task", "task.json", "--run", runId, "--quiet"]),
      ask: async (question: string) => {
        asked.push(question);
        return "n";
      },
    });
    assert.equal(asked.length, 1, JSON.stringify(outcome));
    const { label, rows } = summaryBlock(asked[0] as string);
    assert.equal(label, LABEL, String(asked[0]));
    assert.deepEqual(rows, quoteModelText(SUMMARY, 20));
    assert.equal(await readFile(path.join(ws, "a.txt"), "utf8"), "alpha\n");
  });
});
