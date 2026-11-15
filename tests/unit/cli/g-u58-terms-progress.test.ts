/**
 * U-58, the CLI's part:
 * (1) DR-50 (the U-28 survey, "남의 소유" (가)): the CLI's own English for people still said
 *     "workflow" for a task type: the English progress lines of the policy narrowings (a copy of the
 *     catalog's English, which says "task type") and the run report's task line. Machine-read text
 *     keeps it: the errors' `message` (JSON) and `report --json`.
 * (2) Review R-65 I-2: without a renderer, the English progress lines (englishProgressLines, the
 *     default of withProgress) told a failed call but not a command that exited with a code other
 *     than 0 or timed out, which the renderer tells. Now both give a line for the same records.
 * In this process; scripted model; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { EngineResult, JournalEvent, MessageId } from "../../../src/contracts/index.js";
import { parseArgs } from "../../../src/cli/args.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { createHumanOutput } from "../../../src/cli/human/index.js";
import { englishProgressLines, narrowingLines } from "../../../src/cli/progress.js";
import { runReport } from "../../../src/cli/report.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const english = createMessageCatalog("en");
const en = (id: MessageId, params?: Record<string, number>): string => (english.format as (id: MessageId, params?: Record<string, number>) => string)(id, params);

describe("U-58 (1): the CLI's English for people says task type", () => {
  test("the narrowing lines are the catalog's English, word for word", () => {
    const event = {
      type: "run_started",
      policyNarrowings: [
        { kind: "commands_dropped", count: 2 },
        { kind: "commands_narrowed", count: 1 },
        { kind: "plan_actions_dropped", count: 3 },
        { kind: "restore_path_tokens_off" },
        { kind: "verifiers_dropped", count: 4 },
      ],
    } as unknown as JournalEvent;
    assert.deepEqual(narrowingLines(event), [
      en("progress.workflow_policy.commands_dropped", { count: 2 }),
      en("progress.workflow_policy.commands_narrowed", { count: 1 }),
      en("progress.workflow_policy.plan_actions_dropped", { count: 3 }),
      en("progress.workflow_policy.restore_path_tokens_off"),
      en("progress.workflow_policy.verifiers_dropped", { count: 4 }),
    ]);
  });

  test("the run report's task line names the task type; report --json keeps its fields", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u58-"));
    temporaryDirs.push(base);
    await mkdir(path.join(base, "ws"));
    await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps: [{ text: "done" }] }), "utf8");
    const task = {
      schemaVersion: 1,
      id: "u58",
      goal: "g",
      workflow: "test",
      workspaceRoot: "./ws",
      model: { provider: "scripted", scriptPath: "./script.json" },
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
      privacy: { secretEnv: [] },
      limits: { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
      verifiers: [],
    };
    await writeFile(path.join(base, "task.json"), JSON.stringify(task), "utf8");
    let now = Date.now() - 600_000;
    const ran = await runCli({
      argv: ["run", "--task", "task.json", "--quiet"],
      env: {},
      cwd: base,
      readFile: (file: string) => readFile(file, "utf8"),
      isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
      loadEnvFile: () => {},
      locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
      relatePaths: (target: string, root: string) => relateRealPaths(target, root),
      clock: { now: () => (now += 1000) },
      randomBytes: (size: number) => new Uint8Array(size).fill(58),
      cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
      assemble: assembleRun,
    });
    const runId = (ran.output as EngineResult).runId;
    const text = await runReport({ argv: ["report", "--workspace", path.join(base, "ws"), "--run", runId], cwd: base, env: {} });
    assert.ok("text" in text, JSON.stringify(text));
    assert.ok(text.text.includes("- Task: `u58` (task type `test`)\n"), text.text);
    const json = await runReport({ argv: ["report", "--workspace", path.join(base, "ws"), "--run", runId, "--json"], cwd: base, env: {} });
    assert.ok("text" in json);
    assert.equal((JSON.parse(json.text) as { journal: { workflow: string } }).journal.workflow, "test");
  });

  test("an error's message, read by machines, keeps its words (DR-48)", () => {
    const parsed = parseArgs(["run", "--workspace", "w", "--goal", "g", "--workflow", "-bad"]);
    assert.ok(!parsed.ok && parsed.message.startsWith("--workflow must be a workflow id"), JSON.stringify(parsed));
  });
});

describe("U-58 (2): without a renderer the English progress tells what the renderer tells of a call's result", () => {
  const decision = (callId: string, tool: string, allowed: boolean): JournalEvent =>
    ({ type: "tool_decision", callId, tool, stage: "policy_requested", allowed, permission: allowed ? null : "command", code: allowed ? null : "command_not_allowed" }) as unknown as JournalEvent;
  const result = (callId: string, tool: string, ok: boolean, content: string, errorCode: string | null = null): JournalEvent =>
    ({ type: "tool_result", result: { callId, tool, ok, content, errorCode } }) as unknown as JournalEvent;
  const payload = (exitCode: number | null, timedOut: boolean): string => JSON.stringify({ exitCode, stdout: "", stderr: "", timedOut, truncated: false });

  const events: readonly JournalEvent[] = [
    decision("c1", "run_command", true),
    result("c1", "run_command", true, payload(3, false)),
    decision("c2", "run_command", true),
    result("c2", "run_command", true, payload(null, true)),
    decision("c3", "run_command", true),
    result("c3", "run_command", true, payload(0, false)),
    decision("c4", "run_command", true),
    result("c4", "run_command", true, payload(null, false)),
    decision("c5", "run_command", true),
    result("c5", "run_command", true, "not json"),
    decision("c6", "read_file", true),
    result("c6", "read_file", false, "error (not_found): x", "not_found"),
    decision("c7", "run_command", false),
    result("c7", "run_command", false, "error (policy_denied): x", "policy_denied"),
  ];

  test("an exit code other than 0 and a time-out each give a line; 0, a stopped command and bad content none", () => {
    const lines = englishProgressLines();
    // Every record in order (the denials come first), the lines of the results kept.
    const told = events.flatMap((event) => {
      const drawn = lines(event);
      return event.type === "tool_result" ? [drawn] : [];
    });
    assert.deepEqual(told, [
      [en("progress.command_exited", { exitCode: 3 })],
      [en("progress.command_timed_out")],
      [],
      [],
      [],
      ["tool read_file: failed (not_found)"],
      [],
    ]);
  });

  test("the same records give a line as with the renderer", () => {
    const renderer = createHumanOutput(english);
    const lines = englishProgressLines();
    for (const event of events) {
      assert.equal(lines(event).length > 0, renderer.progressLine(event) !== null, JSON.stringify(event));
    }
  });
});
