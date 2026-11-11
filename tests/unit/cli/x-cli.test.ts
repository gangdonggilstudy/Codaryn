/**
 * X-1 to X-3 (CLI command review, docs/reviews/2026-11-12-m-review-cli-commands.md).
 * X-1: executables and verifier cwd get the S-5 check; doctor never touches a network or device
 *      path (the file access is injected, so no UNC path is ever opened here).
 * X-2: a report on records changed after the run ends as invalid_run_record, not internal_error.
 * X-3: doctor judges commands by the run's rules.
 * Fake values only, no network.
 */

import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { JOURNAL_FILE_NAME, RESULT_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { DoctorOutput, EngineResult } from "../../../src/contracts/index.js";
import { parseConfig } from "../../../src/cli/config.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import type { DoctorEnvironment } from "../../../src/cli/doctor.js";
import type { CommandOutcome } from "../../../src/cli/guard.js";
import { runReport } from "../../../src/cli/report.js";
import { runCli } from "../../../src/cli/run.js";
import { checkLocalPathSyntax, locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { parseTask } from "../../../src/cli/task.js";
import { IS_WINDOWS, cliIo, isDirectory, setupRun, tempDir } from "./k-support.js";

const SEP = String.fromCharCode(92);
const UNC_TOOL = `${SEP}${SEP}attacker.invalid${SEP}share${SEP}tool.exe`;
const PIPE_TOOL = `${SEP}${SEP}.${SEP}pipe${SEP}probe.exe`;
const UNC_SHARE = `${SEP}${SEP}attacker.invalid${SEP}share`;
const UNC_PATH_ENTRY = `${SEP}${SEP}attacker.invalid${SEP}tools`;
const DEVICE_PATH_ENTRY = `${SEP}${SEP}.${SEP}pipe`;

const POLICY = { network: "deny", destructive: "deny", restorePathTokens: false };
const LIMITS = { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 10_000, maxDurationMs: 60_000 };

function isRemote(file: string): boolean {
  return !checkLocalPathSyntax(file).ok;
}

describe("X-1 executables and verifier cwd are local paths", { skip: !IS_WINDOWS }, () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["a UNC command", { policy: { ...POLICY, commands: [{ executable: UNC_TOOL, argsPrefix: [], allowExtraArgs: false }] } }, "policy.commands[0].executable is a network or device path"],
    ["a device command", { policy: { ...POLICY, commands: [{ executable: PIPE_TOOL, argsPrefix: [], allowExtraArgs: false }] } }, "policy.commands[0].executable is a network or device path"],
    ["a UNC verifier cwd", { verifiers: [{ id: "v", kind: "command", executable: `bin${SEP}check.exe`, args: [], cwd: UNC_SHARE }] }, "verifiers[0].cwd is a network or device path"],
    ["a UNC verifier executable", { verifiers: [{ id: "v", kind: "command", executable: UNC_TOOL, args: [] }] }, "verifiers[0].executable is a network or device path"],
  ];
  for (const [name, fields, message] of cases) {
    test(`${name} is refused by the config and task checks, naming the field only`, () => {
      assert.deepEqual(parseConfig({ schemaVersion: 1, ...fields }), { ok: false, message });
      const task = {
        schemaVersion: 1,
        id: "x1",
        goal: "g",
        workflow: "w",
        workspaceRoot: "C:/work",
        model: { provider: "scripted", scriptPath: "C:/s.json" },
        policy: { ...POLICY, commands: [] },
        privacy: { secretEnv: [] },
        limits: LIMITS,
        verifiers: [],
        ...fields,
      };
      assert.deepEqual(parseTask(task, "C:/"), { ok: false, code: "invalid_task", message });
      assert.equal(message.includes("attacker"), false);
    });
  }

  test("local names, relative paths and drive paths stay accepted", () => {
    const outcome = parseConfig({
      schemaVersion: 1,
      policy: { ...POLICY, commands: [{ executable: "npm", argsPrefix: ["test"], allowExtraArgs: false }] },
      verifiers: [
        { id: "a", kind: "command", executable: `bin${SEP}check.exe`, args: [], cwd: "sub" },
        { id: "b", kind: "command", executable: "C:/tools/node.exe", args: [], cwd: ".." },
      ],
    });
    assert.ok(outcome.ok);
  });
});

// ---------------------------------------------------------------------------------------------

/** Doctor with recorded file access: every isFile and realpath call is kept. */
function recordingDoctor(base: string, argv: readonly string[], env: Record<string, string>, extra: Partial<DoctorEnvironment> = {}) {
  const touched: string[] = [];
  const io: DoctorEnvironment = {
    argv: ["doctor", ...argv, "--json"],
    env,
    cwd: base,
    nodeVersion: "26.13.0",
    readFile: (file) => readFile(file, "utf8"),
    isDirectory,
    isFile: async (file) => {
      touched.push(file);
      if (isRemote(file)) return false;
      try {
        return (await stat(file)).isFile();
      } catch {
        return false;
      }
    },
    realpath: async (file) => {
      touched.push(file);
      if (isRemote(file)) throw new Error("remote");
      const { realpath } = await import("node:fs/promises");
      return realpath(file);
    },
    locateInWorkspace: (file, root) => locateInWorkspace(file, root),
    relatePaths: (target, root) => relateRealPaths(target, root),
    ...extra,
  };
  return { io, touched };
}

async function doctorChecks(io: DoctorEnvironment): Promise<{ output: DoctorOutput; status: Record<string, string>; message: Record<string, string> }> {
  const outcome = await runDoctor(io);
  assert.ok("text" in outcome, JSON.stringify(outcome));
  const output = JSON.parse(outcome.text) as DoctorOutput;
  const status: Record<string, string> = {};
  const message: Record<string, string> = {};
  for (const check of output.checks) {
    status[check.id] = check.status;
    message[check.id] = check.message;
  }
  return { output, status, message };
}

async function writeJson(file: string, value: unknown): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
  return file;
}

describe("X-1 doctor does not touch network or device paths", { skip: !IS_WINDOWS }, () => {
  test("the review's config: refused as a config error, and nothing remote is touched", async () => {
    const base = await tempDir();
    const work = path.join(base, "work");
    await mkdir(work);
    const config = await writeJson(path.join(base, "config.json"), {
      schemaVersion: 1,
      policy: {
        ...POLICY,
        commands: [
          { executable: UNC_TOOL, argsPrefix: [], allowExtraArgs: false },
          { executable: PIPE_TOOL, argsPrefix: [], allowExtraArgs: false },
        ],
      },
      verifiers: [{ id: "v", kind: "command", executable: `bin${SEP}check.exe`, args: [], cwd: UNC_SHARE }],
    });
    const { io, touched } = recordingDoctor(base, ["--config", config, "--workspace", work], { PATH: `C:${SEP}Windows${SEP}System32;${UNC_PATH_ENTRY}` });
    const checks = await doctorChecks(io);
    assert.deepEqual(touched.filter(isRemote), []);
    assert.equal(checks.status["config_file"], "fail");
    assert.equal(checks.message["config_file"], "policy.commands[0].executable is a network or device path");
  });

  test("network and device PATH entries are reported as not checked and never touched", async () => {
    const base = await tempDir();
    const work = path.join(base, "work");
    const bin = path.join(base, "bin");
    await mkdir(work);
    await mkdir(bin);
    const config = await writeJson(path.join(base, "config.json"), {
      schemaVersion: 1,
      policy: { ...POLICY, commands: [{ executable: "x1fakeprog", argsPrefix: [], allowExtraArgs: false }] },
    });
    const env = { PATH: [UNC_PATH_ENTRY, DEVICE_PATH_ENTRY, bin].join(";"), PATHEXT: ".EXE" };
    const missing = recordingDoctor(base, ["--config", config, "--workspace", work], env);
    const first = await doctorChecks(missing.io);
    assert.deepEqual(missing.touched.filter(isRemote), []);
    assert.equal(first.status["commands"], "warn");
    const firstMessage = first.message["commands"] ?? "";
    assert.ok(firstMessage.includes("2 network or device PATH entries not checked"), firstMessage);

    await writeFile(path.join(bin, "x1fakeprog.exe"), "");
    const found = recordingDoctor(base, ["--config", config, "--workspace", work], env);
    const second = await doctorChecks(found.io);
    assert.deepEqual(found.touched.filter(isRemote), []);
    assert.equal(second.status["commands"], "warn", "a run would still look in the remote entries first");
    assert.ok(second.message["commands"]?.includes("not checked"));
    assert.equal(JSON.stringify(second.output).includes("attacker"), false);
  });
});

describe("X-3 doctor judges commands by the run's rules", { skip: !IS_WINDOWS }, () => {
  test("the review's task: an executable inside the workspace and a cwd outside it are rejected", async () => {
    const base = await tempDir();
    const work = path.join(base, "work");
    await mkdir(path.join(work, "bin"), { recursive: true });
    await mkdir(path.join(base, "tools"));
    await writeFile(path.join(work, "bin", "check.exe"), "");
    await writeFile(path.join(base, "tools", "outside.exe"), "");
    await writeFile(path.join(base, "tools", "run.cmd"), "@echo off\r\n");
    await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps: [{ text: "done" }] }));
    const task = await writeJson(path.join(base, "task.json"), {
      schemaVersion: 1,
      id: "x3",
      goal: "g",
      workflow: "w",
      workspaceRoot: "./work",
      model: { provider: "scripted", scriptPath: "./script.json" },
      policy: { ...POLICY, commands: [] },
      privacy: { secretEnv: [] },
      limits: LIMITS,
      verifiers: [
        { id: "inside", kind: "command", executable: `bin${SEP}check.exe`, args: [] },
        { id: "outside-cwd", kind: "command", executable: `tools${SEP}outside.exe`, args: [], cwd: ".." },
        { id: "script-arg", kind: "command", executable: path.join(base, "tools", "run.cmd"), args: ["a b"] },
        { id: "fine", kind: "command", executable: path.join(base, "tools", "outside.exe"), args: [] },
      ],
    });
    const { io } = recordingDoctor(base, ["--task", task], { PATH: "" });
    const checks = await doctorChecks(io);
    assert.equal(checks.status["commands"], "fail");
    const message = checks.message["commands"] ?? "";
    assert.ok(message.includes("rejected at run time"), message);
    assert.ok(message.includes("verifiers[0] (executable_refused)"), message);
    assert.ok(message.includes("verifiers[1].cwd (outside_root)"), message);
    assert.ok(message.includes("verifiers[2] (script_refused)"), message);
    assert.equal(message.includes("verifiers[3]"), false, message);
    assert.equal(checks.output.status, "fail");
  });
});

// ---------------------------------------------------------------------------------------------

async function finishedRun(): Promise<{ work: string; runId: string }> {
  const base = await setupRun(
    { "README.md": "# Title\n" },
    { verifiers: [{ id: "readme", kind: "file_rules", rules: [{ type: "contains", path: "README.md", text: "never there" }] }] },
    [{ text: "done" }],
  );
  const outcome = await runCli(cliIo(base));
  assert.equal(outcome.output.kind, "run");
  return { work: path.join(base, "work"), runId: (outcome.output as EngineResult).runId };
}

async function rewriteResult(work: string, runId: string, change: (result: Record<string, unknown>) => void): Promise<void> {
  const file = path.join(work, STATE_DIR_NAME, RUNS_DIR_NAME, runId, RESULT_FILE_NAME);
  const result = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  change(result);
  await writeFile(file, JSON.stringify(result));
}

async function report(work: string, runId: string, json = false): Promise<CommandOutcome> {
  return runReport({ argv: ["report", "--workspace", work, "--run", runId, ...(json ? ["--json"] : [])], cwd: path.dirname(work), env: {} });
}

function code(outcome: CommandOutcome): string {
  return "output" in outcome && outcome.output.kind === "error" ? outcome.output.code : "text";
}

function setEvidence(evidence: string): (result: Record<string, unknown>) => void {
  return (result) => {
    const verifiers = result["verifiers"] as Record<string, unknown>[];
    (verifiers[0] as Record<string, unknown>)["evidence"] = evidence;
  };
}

describe("X-2 a report on changed or broken records ends as invalid_run_record", () => {
  test("200,000 backtick runs in the evidence (review input)", async () => {
    const run = await finishedRun();
    await rewriteResult(run.work, run.runId, setEvidence("` ".repeat(200_000)));
    for (const json of [false, true]) {
      const outcome = await report(run.work, run.runId, json);
      assert.equal(code(outcome), "invalid_run_record", `json=${json}`);
      assert.equal(outcome.exitCode, 2);
    }
  });

  test("150,000 short lines in the evidence (review input)", async () => {
    const run = await finishedRun();
    await rewriteResult(run.work, run.runId, setEvidence("x\n".repeat(150_000)));
    assert.equal(code(await report(run.work, run.runId)), "invalid_run_record");
  });

  test("evidence over MAX_EVIDENCE_BYTES in the journal is refused too", async () => {
    const run = await finishedRun();
    const file = path.join(run.work, STATE_DIR_NAME, RUNS_DIR_NAME, run.runId, JOURNAL_FILE_NAME);
    const lines = (await readFile(file, "utf8")).split("\n");
    const edited = lines.map((line) => {
      if (!line.includes('"verifier_result"')) return line;
      const record = JSON.parse(line) as { result: Record<string, unknown> };
      record.result["evidence"] = "y".repeat(9000);
      return JSON.stringify(record);
    });
    await writeFile(file, edited.join("\n"));
    assert.equal(code(await report(run.work, run.runId)), "invalid_run_record");
  });

  test("other long recorded text with many backtick runs is printed without a crash", async () => {
    const run = await finishedRun();
    await rewriteResult(run.work, run.runId, (result) => {
      result["notices"] = ["` ".repeat(200_000)];
    });
    const outcome = await report(run.work, run.runId);
    assert.equal(code(outcome), "text");
    assert.equal(outcome.exitCode, 0);
  });
});
