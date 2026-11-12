/**
 * V3: the VS Code extension's core without the VS Code API (vscode/src/core): argument lists and
 * the spawn plan, the line protocol, and the run state. Pure functions; no process is started.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  INITIAL_RUN_VIEW,
  LineSplitter,
  MAX_LINE_LENGTH,
  answerLine,
  applyArgs,
  canCancel,
  changesArgs,
  childEnvironment,
  doctorArgs,
  nextScreenOf,
  parseFinalStdout,
  parseProtocolLine,
  planArgs,
  reduceRun,
  revertArgs,
  reviewArgs,
  runArgs,
  runsArgs,
  shutdownSteps,
  spawnPlan,
} from "../../../vscode/src/core/index.js";
import type { ProtocolLine, RunAction, RunView } from "../../../vscode/src/core/index.js";

const RUN_ID = "20261112T010203Z-0a1b2c3d";
const TASK = { input: { kind: "task" as const, taskPath: "C:\\cfg\\task.json" }, configPath: null, varsFile: null, profile: null };

const started = (runId = RUN_ID) => JSON.stringify({ schemaVersion: 1, kind: "started", runId });
const record = (seq: number, runId = RUN_ID) =>
  JSON.stringify({ schemaVersion: 1, kind: "event", event: { kind: "record", record: { seq, at: "2026-11-12T01:02:03.000Z", runId, type: "model_request" } } });
const confirm = (id: string) =>
  JSON.stringify({ schemaVersion: 1, kind: "confirm", request: { kind: "permission", id, callId: "c1", tool: "run_command", permission: "command", subject: "node --test" } });
const result = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ schemaVersion: 1, kind: "run", runId: RUN_ID, status: "done", reason: "verified", exitCode: 0, ...overrides });

function feed(...lines: string[]): RunView {
  return lines.reduce<RunView>((view, line) => reduceRun(view, { type: "line", line: parseProtocolLine(line) }), INITIAL_RUN_VIEW);
}

describe("argument lists", () => {
  test("run: every value after its flag, events always, questions only when the UI can ask", () => {
    const outcome = runArgs({
      input: { kind: "quick", workspace: "D:\\work", goal: "fix it; $(rm -rf /) && \"quoted\"" },
      configPath: "C:\\cfg\\config.json",
      varsFile: null,
      profile: "doc",
      workflowRef: "organize",
      cancelFile: "C:\\store\\cancel-1",
      canAsk: true,
    });
    assert.deepEqual(outcome, {
      ok: true,
      args: [
        "run",
        "--workspace",
        "D:\\work",
        "--goal",
        "fix it; $(rm -rf /) && \"quoted\"",
        "--config",
        "C:\\cfg\\config.json",
        "--profile",
        "doc",
        "--workflow",
        "organize",
        "--cancel-file",
        "C:\\store\\cancel-1",
        "--events",
        "jsonl",
        "--confirm",
        "stdio",
      ],
    });
    const quiet = runArgs({ input: TASK.input, configPath: null, varsFile: null, profile: null, workflowRef: null, cancelFile: "C:\\c", canAsk: false });
    assert.ok(quiet.ok && !quiet.args.includes("--confirm"));
  });

  test("a value the CLI would refuse is refused here with the field's name (R-4 L-1)", () => {
    const base = { configPath: null, varsFile: null, profile: null, workflowRef: null, cancelFile: "C:\\c", canAsk: false };
    assert.deepEqual(runArgs({ ...base, input: { kind: "quick", workspace: "D:\\w", goal: "--help me" } }), { ok: false, field: "goal", reason: "starts_with_dashes" });
    assert.deepEqual(runArgs({ ...base, input: { kind: "quick", workspace: "D:\\w", goal: "" } }), { ok: false, field: "goal", reason: "empty" });
    assert.deepEqual(reviewArgs({ settings: TASK, runId: RUN_ID, decision: "reject", note: "--x" }), { ok: false, field: "note", reason: "starts_with_dashes" });
  });

  test("the task form, apply, plan, review, changes, report, revert, runs and doctor", () => {
    const workspaceForm = { input: { kind: "workspace" as const, workspace: "D:\\w" }, configPath: null, varsFile: "C:\\v.env", profile: "p" };
    assert.deepEqual(applyArgs({ settings: workspaceForm, planRunId: RUN_ID, digest: "abcdef012345", cancelFile: "C:\\c" }), {
      ok: true,
      args: ["apply", "--workspace", "D:\\w", "--profile", "p", "--vars-file", "C:\\v.env", "--run", RUN_ID, "--digest", "abcdef012345", "--cancel-file", "C:\\c", "--events", "jsonl"],
    });
    assert.deepEqual(planArgs({ settings: TASK, runId: "latest" }), { ok: true, args: ["plan", "--task", "C:\\cfg\\task.json", "--run", "latest", "--json"] });
    assert.deepEqual(reviewArgs({ settings: TASK, runId: RUN_ID, decision: "accept", note: "looks fine" }), {
      ok: true,
      args: ["review", "--task", "C:\\cfg\\task.json", "--run", RUN_ID, "--accept", "--note", "looks fine", "--json"],
    });
    assert.deepEqual(changesArgs({ settings: TASK, runId: RUN_ID }), { ok: true, args: ["changes", "--task", "C:\\cfg\\task.json", "--run", RUN_ID, "--json"] });
    assert.deepEqual(revertArgs({ workspace: "D:\\w", runId: "latest", dryRun: true }), { ok: true, args: ["revert", "--workspace", "D:\\w", "--run", "latest", "--dry-run"] });
    assert.deepEqual(runsArgs({ workspace: "D:\\w", limit: 5 }), { ok: true, args: ["runs", "--workspace", "D:\\w", "--limit", "5", "--json"] });
    assert.deepEqual(doctorArgs({ configPath: null, varsFile: null, workspace: "D:\\w" }), { ok: true, args: ["doctor", "--workspace", "D:\\w", "--json"] });
  });
});

describe("spawn plan and child environment (VX-D13)", () => {
  const input = {
    nodePath: "C:\\Program Files\\nodejs\\node.exe",
    cliMain: "C:\\ext\\cli\\dist\\src\\cli\\main.js",
    storageDir: "C:\\Users\\u\\AppData\\Roaming\\Code\\globalStorage\\codaryn",
    workspace: "D:\\work",
    hostEnv: { Path: "C:\\bin", node_options: "--require evil.js", NODE_PATH: "D:\\work\\lib", ANTHROPIC_API_KEY: undefined, LANG: "ko" },
    platform: "win32" as const,
    args: ["runs", "--json"],
  };

  test("no shell, absolute node and CLI, cwd in the extension's storage, Node's own variables removed", () => {
    const outcome = spawnPlan(input);
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.plan, {
      command: input.nodePath,
      args: [input.cliMain, "runs", "--json"],
      cwd: input.storageDir,
      env: { Path: "C:\\bin", LANG: "ko" },
      shell: false,
      windowsHide: true,
    });
    assert.deepEqual(childEnvironment({ NODE_OPTIONS: "x", node_options: "y" }, "linux"), { node_options: "y" }, "case matters elsewhere");
  });

  test("refuses relative paths and a Node or cwd inside the workspace", () => {
    assert.deepEqual(spawnPlan({ ...input, nodePath: "node" }), { ok: false, reason: "node_path_not_absolute" });
    assert.deepEqual(spawnPlan({ ...input, cliMain: "main.js" }), { ok: false, reason: "cli_main_not_absolute" });
    assert.deepEqual(spawnPlan({ ...input, storageDir: "store" }), { ok: false, reason: "storage_dir_not_absolute" });
    assert.deepEqual(spawnPlan({ ...input, nodePath: "d:\\WORK\\tools\\node.exe" }), { ok: false, reason: "node_inside_workspace" });
    assert.deepEqual(spawnPlan({ ...input, storageDir: "D:\\work" }), { ok: false, reason: "storage_inside_workspace" });
    assert.ok(spawnPlan({ ...input, workspace: null, nodePath: "D:\\work\\node.exe" }).ok, "no workspace, nothing to be inside");
    assert.ok(spawnPlan({ ...input, workspace: "D:\\work2" }).ok);
  });
});

describe("line protocol", () => {
  test("parses started, event and confirm lines and ignores anything else", () => {
    assert.deepEqual(parseProtocolLine(started()), { kind: "started", runId: RUN_ID });
    assert.equal(parseProtocolLine(record(1)).kind, "event");
    assert.equal(parseProtocolLine(JSON.stringify({ schemaVersion: 1, kind: "event", event: { kind: "notice", text: "hint" } })).kind, "event");
    assert.equal(parseProtocolLine(confirm("q1")).kind, "confirm");
    const ignored = (line: string) => (parseProtocolLine(line) as Extract<ProtocolLine, { kind: "ignored" }>).reason;
    assert.equal(ignored("(node:123) ExperimentalWarning: something"), "not_json");
    assert.equal(ignored(JSON.stringify({ schemaVersion: 2, kind: "started", runId: RUN_ID })), "malformed");
    assert.equal(ignored(JSON.stringify({ schemaVersion: 1, kind: "started", runId: "../x" })), "malformed");
    assert.equal(ignored(JSON.stringify({ schemaVersion: 1, kind: "event", event: { kind: "record", record: { seq: 0 } } })), "malformed");
    assert.equal(ignored(JSON.stringify({ schemaVersion: 1, kind: "confirm", request: { kind: "plan", id: "q" } })), "malformed", "plan approval is not a question (DR-1)");
    assert.equal(ignored(JSON.stringify({ schemaVersion: 1, kind: "shell", command: "x" })), "unknown_kind");
    assert.equal(ignored("x".repeat(MAX_LINE_LENGTH + 1)), "too_long");
  });

  test("the splitter joins chunks, strips CRLF, keeps the last line for end, and drops over-long lines", () => {
    const splitter = new LineSplitter();
    assert.deepEqual(splitter.push('{"a":'), { lines: [], dropped: 0 });
    assert.deepEqual(splitter.push('1}\r\nnext\npartial'), { lines: ['{"a":1}', "next"], dropped: 0 });
    assert.deepEqual(splitter.end(), { lines: ["partial"], dropped: 0 });
    const long = new LineSplitter();
    assert.deepEqual(long.push("y".repeat(MAX_LINE_LENGTH + 1)), { lines: [], dropped: 1 });
    assert.deepEqual(long.push("more of it\nok\n"), { lines: ["ok"], dropped: 0 }, "the rest of the dropped line is skipped once");
  });

  test("answer lines and the final stdout line", () => {
    assert.equal(answerLine("q1", { decision: "dismissed" }), '{"schemaVersion":1,"kind":"answer","id":"q1","answer":{"decision":"dismissed"}}\n');
    assert.equal(parseFinalStdout(`${result()}\n`, 0).kind, "output");
    assert.equal(parseFinalStdout(`${JSON.stringify({ schemaVersion: 1, kind: "error", code: "invalid_task", exitCode: 2, message: "m" })}\n`, 2).kind, "output");
    assert.deepEqual(parseFinalStdout(`${result()}\n${result()}\n`, 0), { kind: "protocol_error", reason: "not_one_line" });
    assert.deepEqual(parseFinalStdout("", null), { kind: "protocol_error", reason: "not_one_line" });
    assert.deepEqual(parseFinalStdout("{oops\n", 0), { kind: "protocol_error", reason: "not_json" });
    assert.deepEqual(parseFinalStdout(`${JSON.stringify({ schemaVersion: 1, kind: "report", exitCode: 0 })}\n`, 0), { kind: "protocol_error", reason: "unknown_kind" });
    assert.deepEqual(parseFinalStdout(`${result()}\n`, 1), { kind: "protocol_error", reason: "exit_code_mismatch" });
  });
});

describe("run state", () => {
  test("nothing can be cancelled before started; events count gaps; the end is the stdout line", () => {
    const before = feed(record(1));
    assert.deepEqual([before.phase, before.ignoredLines, canCancel(before)], ["starting", 1, false], "an event before started is out of place");
    assert.deepEqual(reduceRun(before, { type: "cancel_requested" }), before);
    assert.deepEqual(shutdownSteps(before), ["close_stdin"], "no cancel file before started (R-1 L-2)");

    const running = feed(started(), record(1), record(2), record(5), record(4), record(6, "20261112T010203Z-ffffffff"));
    assert.deepEqual([running.phase, running.runId, running.lastSeq, running.missedEvents, running.ignoredLines], ["running", RUN_ID, 5, 2, 2]);
    assert.equal(canCancel(running), true);
    assert.deepEqual(shutdownSteps(running), ["create_cancel_file", "close_stdin"]);
    const cancelling = reduceRun(running, { type: "cancel_requested" });
    assert.deepEqual([cancelling.cancelRequested, canCancel(cancelling), shutdownSteps(cancelling)], [true, false, ["close_stdin"]]);

    const finished = reduceRun(running, { type: "exited", outcome: parseFinalStdout(`${result()}\n`, 0) });
    assert.deepEqual([finished.phase, finished.next, shutdownSteps(finished)], ["finished", "result", []]);
    assert.deepEqual(reduceRun(finished, { type: "line", line: parseProtocolLine(record(9)) }), finished, "nothing changes after the end");
  });

  test("one question at a time, answered by its id; the child's end clears it", () => {
    const asked = feed(started(), confirm("q1"), confirm("q2"));
    assert.deepEqual([asked.phase, asked.question?.id, asked.ignoredLines], ["awaiting_answer", "q1", 1]);
    assert.deepEqual(reduceRun(asked, { type: "answered", id: "q2" }), asked);
    assert.deepEqual([reduceRun(asked, { type: "answered", id: "q1" }).phase, reduceRun(asked, { type: "answered", id: "q1" }).question], ["running", null]);
    const gone = reduceRun(asked, { type: "exited", outcome: parseFinalStdout(`${result({ status: "cancelled", reason: "cancelled", exitCode: 5 })}\n`, 5) });
    assert.deepEqual([gone.phase, gone.question, gone.next], ["finished", null, "result"]);
  });

  test("the next screen follows the result: plan, review, error or a transport problem", () => {
    const plan = { schemaVersion: 1, kind: "run", runId: RUN_ID, status: "needs-input", reason: "plan_pending", exitCode: 3 } as never;
    const review = { schemaVersion: 1, kind: "run", runId: RUN_ID, status: "needs-input", reason: "awaiting_review", exitCode: 3 } as never;
    assert.equal(nextScreenOf(plan), "plan");
    assert.equal(nextScreenOf(review), "review");
    const error = feed().phase === "starting" ? reduceRun(INITIAL_RUN_VIEW, { type: "exited", outcome: parseFinalStdout(`${JSON.stringify({ schemaVersion: 1, kind: "error", code: "invalid_task", exitCode: 2, message: "m" })}\n`, 2) }) : INITIAL_RUN_VIEW;
    assert.deepEqual([error.phase, error.next, error.error?.code], ["finished", "error", "invalid_task"]);
    const broken: RunAction = { type: "exited", outcome: parseFinalStdout("", null) };
    assert.deepEqual([reduceRun(feed(started()), broken).phase, reduceRun(feed(started()), broken).next], ["transport_failed", "transport_error"]);
    const other = reduceRun(feed(started()), { type: "exited", outcome: parseFinalStdout(`${result({ runId: "20261112T010203Z-ffffffff" })}\n`, 0) });
    assert.deepEqual([other.phase, other.transportError], ["transport_failed", "run_id_mismatch"]);
  });
});
