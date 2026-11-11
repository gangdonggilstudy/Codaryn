/**
 * K1: `codaryn report` (U-5) and `codaryn doctor` (U-6).
 * Reports are built from real runs (real assembly, scripted model) on temporary directories.
 * P0: doctor never prints the key value. Fake values only, no network.
 */

import assert from "node:assert/strict";
import { appendFile, readFile, readdir, rename, stat, symlink, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import {
  ANTHROPIC_API_KEY_ENV,
  DOCTOR_CHECK_IDS,
  JOURNAL_FILE_NAME,
  RESULT_FILE_NAME,
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
} from "../../../src/contracts/index.js";
import type { DoctorOutput, EngineResult, ReportOutput } from "../../../src/contracts/index.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import type { DoctorEnvironment } from "../../../src/cli/doctor.js";
import type { CommandOutcome } from "../../../src/cli/guard.js";
import { runReport } from "../../../src/cli/report.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { FAKE_SECRET, IS_WINDOWS, cliIo, isDirectory, setupRun, tempDir } from "./k-support.js";

const ESC = String.fromCharCode(27);
const SEP = String.fromCharCode(92);
/** Fake key-shaped text, assembled at run time. */
const KEY_SHAPED = ["sk", "ant", "k1fake0fake0fake01"].join("-");
/** A fake, not key-shaped value set as the API key variable. */
const FAKE_DOCTOR_KEY = "fake-doctor-key-value-0001";

/** An environment whose key variable holds the fake value. */
function keyEnv(): Record<string, string> {
  return { [ANTHROPIC_API_KEY_ENV]: FAKE_DOCTOR_KEY };
}

function text(outcome: CommandOutcome): string {
  assert.ok("text" in outcome, `expected text, got ${JSON.stringify(outcome)}`);
  return outcome.text;
}

function errorCode(outcome: CommandOutcome): string {
  assert.ok("output" in outcome, "expected a JSON error");
  return outcome.output.kind === "error" ? outcome.output.code : outcome.output.kind;
}

/** A finished scripted run with one created file. */
async function finishedRun(): Promise<{ base: string; work: string; runId: string; result: EngineResult }> {
  const base = await setupRun(
    { "README.md": "# Title\n" },
    {},
    [
      { toolCalls: [{ name: "write_file", args: { path: "notes.txt", expectedHash: null, change: { kind: "replace_all", content: "x\n" } } }] },
      { toolCalls: [{ name: "run_command", args: { executable: "nope", args: [] } }] },
      { text: "done" },
    ],
  );
  const outcome = await runCli(cliIo(base));
  assert.equal(outcome.output.kind, "run");
  const result = outcome.output as EngineResult;
  return { base, work: path.join(base, "work"), runId: result.runId, result };
}

function report(work: string, runId: string, extra: readonly string[] = [], env: Record<string, string> = {}): Promise<CommandOutcome> {
  return runReport({ argv: ["report", "--workspace", work, "--run", runId, ...extra], cwd: path.dirname(work), env });
}

function runDir(work: string, runId: string): string {
  return path.join(work, STATE_DIR_NAME, RUNS_DIR_NAME, runId);
}

async function snapshotTree(dir: string): Promise<string> {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(`${full}:${(await stat(full)).mtimeMs}:${(await readFile(full)).toString("base64")}`);
    }
  };
  await walk(dir);
  return out.sort().join("\n");
}

describe("U-5 report", () => {
  test("a finished run: Markdown summary, exit 0, nothing changed", async () => {
    const run = await finishedRun();
    const before = await snapshotTree(run.work);
    const outcome = await report(run.work, run.runId);
    assert.equal(outcome.exitCode, 0);
    const markdown = text(outcome);
    for (const part of [
      "# Codaryn run report",
      `- Run: \`${run.runId}\``,
      "- Task: `k1-task` (workflow `test`)",
      "(scripted model; no API was called)",
      "- Result: `done` / `verified`, exit code 0",
      "- Report: complete",
      "## Verification",
      "- `readme` (file_rules): **pass**",
      "## Protected material",
      "Not checked: the run had no integrity check",
      "## Changes (1)",
      "- `notes.txt` created (",
      "## Usage",
      "- Tool calls: 1 of 10 (denied: 1)",
      "## Not checked",
      "- `readme`: `",
      "There is no OS isolation",
    ]) {
      assert.ok(markdown.includes(part), part);
    }
    assert.equal(markdown.includes(FAKE_SECRET), false);
    assert.equal(await snapshotTree(run.work), before, "the report changes nothing");
  });

  test("--json prints ReportOutput with the result as recorded", async () => {
    const run = await finishedRun();
    const outcome = await report(run.work, run.runId, ["--json"]);
    const parsed = JSON.parse(text(outcome)) as ReportOutput;
    assert.equal(text(outcome).trimEnd().includes("\n"), false);
    assert.equal(parsed.kind, "report");
    assert.equal(parsed.status, "complete");
    assert.equal(parsed.exitCode, 0);
    assert.deepEqual(parsed.result, run.result);
    assert.equal(parsed.journal.taskId, "k1-task");
    assert.equal(parsed.journal.deniedToolCalls, 1);
    assert.equal(parsed.journal.changes.length, 1);
    assert.deepEqual(parsed.journal.finished, { status: "done", reason: "verified" });
    assert.deepEqual(parsed.journal.integrityChecks, []);
  });

  test("without result.json the report is incomplete (exit 3) and ignores a half-written last line", async () => {
    const run = await finishedRun();
    const dir = runDir(run.work, run.runId);
    await rename(path.join(dir, RESULT_FILE_NAME), path.join(run.base, "result.moved"));
    await appendFile(path.join(dir, JOURNAL_FILE_NAME), '{"seq":99,"type":"model_req');
    const outcome = await report(run.work, run.runId);
    assert.equal(outcome.exitCode, 3);
    const markdown = text(outcome);
    assert.ok(markdown.includes("- Result: none. The run has no result.json"));
    assert.ok(markdown.includes("- The journal's end record: `done` / `verified`"));
    assert.ok(markdown.includes("- Report: incomplete"));
    const json = JSON.parse(text(await report(run.work, run.runId, ["--json"]))) as ReportOutput;
    assert.equal(json.result, null);
    assert.equal(json.status, "incomplete");
  });

  test("records that do not belong to the run are refused as invalid_run_record", async () => {
    const tamper = async (change: (lines: string[]) => string[]): Promise<string> => {
      const run = await finishedRun();
      const file = path.join(runDir(run.work, run.runId), JOURNAL_FILE_NAME);
      const lines = (await readFile(file, "utf8")).split("\n").filter((line) => line.length > 0);
      await writeFile(file, `${change(lines).join("\n")}\n`);
      return errorCode(await report(run.work, run.runId));
    };
    const edit = (line: string, apply: (record: Record<string, unknown>) => void): string => {
      const record = JSON.parse(line) as Record<string, unknown>;
      apply(record);
      return JSON.stringify(record);
    };
    assert.equal(await tamper((lines) => lines.map((line, index) => (index === 2 ? edit(line, (r) => (r["runId"] = "other")) : line))), "invalid_run_record");
    assert.equal(await tamper((lines) => [lines[0] as string, ...lines.slice(2)]), "invalid_run_record");
    assert.equal(await tamper((lines) => lines.slice(1).map((line, index) => edit(line, (r) => (r["seq"] = index + 1)))), "invalid_run_record");
    assert.equal(
      await tamper((lines) => lines.map((line) => (line.includes('"verifier_result"') ? edit(line, (r) => ((r["result"] as Record<string, unknown>)["outcome"] = "maybe")) : line))),
      "invalid_run_record",
    );
    assert.equal(await tamper((lines) => [...lines.slice(0, -1), "not json"]), "invalid_run_record");

    // With result.json present, a last line without its line feed is an error.
    const run = await finishedRun();
    await appendFile(path.join(runDir(run.work, run.runId), JOURNAL_FILE_NAME), '{"seq":');
    assert.equal(errorCode(await report(run.work, run.runId)), "invalid_run_record");

    const other = await finishedRun();
    const resultFile = path.join(runDir(other.work, other.runId), RESULT_FILE_NAME);
    const result = JSON.parse(await readFile(resultFile, "utf8")) as Record<string, unknown>;
    await writeFile(resultFile, JSON.stringify({ ...result, runId: "20260101T000000Z-00000000" }));
    assert.equal(errorCode(await report(other.work, other.runId)), "invalid_run_record");
  });

  test("argument, workspace and run errors", async () => {
    const run = await finishedRun();
    assert.equal(errorCode(await report(run.work, "20260101T000000Z-00000000")), "run_not_found");
    assert.equal(errorCode(await report(run.work, "../x")), "invalid_arguments");
    assert.equal(errorCode(await report(path.join(run.base, "missing"), run.runId)), "workspace_not_found");
    const unc = await runReport({ argv: ["report", "--workspace", `${SEP}${SEP}server${SEP}share`, "--run", "r1"], cwd: run.base, env: {} });
    assert.equal(errorCode(unc), IS_WINDOWS ? "invalid_arguments" : "workspace_not_found");
  });

  test("a run directory that is a junction is not followed", { skip: !IS_WINDOWS }, async () => {
    const run = await finishedRun();
    const elsewhere = await tempDir();
    const moved = path.join(elsewhere, "moved");
    await rename(runDir(run.work, run.runId), moved);
    await symlink(moved, runDir(run.work, run.runId), "junction");
    assert.equal(errorCode(await report(run.work, run.runId)), "invalid_run_record");
  });

  test("printed text has control characters replaced, fences that hold, and keys hidden", async () => {
    const run = await finishedRun();
    const dir = runDir(run.work, run.runId);
    const resultFile = path.join(dir, RESULT_FILE_NAME);
    const result = JSON.parse(await readFile(resultFile, "utf8")) as Record<string, unknown>;
    const evil = `a${ESC}[2J${String.fromCharCode(0x202e)}b\`\`\`c`;
    await writeFile(
      resultFile,
      JSON.stringify({
        ...result,
        status: "failed",
        reason: "verifier_failed",
        exitCode: 1,
        verifiers: [{ id: "v`1", kind: "command", outcome: "fail", evidence: "line1\n```\nline3", checked: [evil], limits: [] }],
        changes: [{ path: evil, previousHash: null, newHash: "0".repeat(64), created: true }],
        notices: [`leaked ${KEY_SHAPED} and ${FAKE_DOCTOR_KEY}`],
      }),
    );
    const markdown = text(await report(run.work, run.runId, [], keyEnv()));
    assert.equal(markdown.includes(ESC), false);
    assert.equal(markdown.includes(String.fromCharCode(0x202e)), false);
    assert.ok(markdown.includes("a?[2J?b"));
    assert.ok(markdown.includes("- ``v`1`` (command): **fail**"));
    assert.ok(markdown.includes("  ````\n  line1\n  ```\n  line3\n  ````"));
    assert.ok(markdown.includes("````a?[2J?b```c````"));
    assert.equal(markdown.includes(KEY_SHAPED), false);
    assert.equal(markdown.includes(FAKE_DOCTOR_KEY), false);
    assert.ok(markdown.includes("leaked [key] and [key]"));
  });
});

// ---------------------------------------------------------------------------------------------

async function doctorBase(): Promise<{ base: string; work: string }> {
  const base = await setupRun({ "README.md": "# Title\n" }, {}, [{ text: "done" }]);
  return { base, work: path.join(base, "work") };
}

function doctorIo(base: string, argv: readonly string[], extra: Partial<DoctorEnvironment> = {}): DoctorEnvironment {
  return {
    argv: ["doctor", ...argv],
    env: {},
    cwd: base,
    nodeVersion: "26.13.0",
    readFile: (file) => readFile(file, "utf8"),
    isDirectory,
    isFile: async (file) => {
      try {
        return (await stat(file)).isFile();
      } catch {
        return false;
      }
    },
    locateInWorkspace: (file, root) => locateInWorkspace(file, root),
    relatePaths: (target, root) => relateRealPaths(target, root),
    integrityConnected: false,
    ...extra,
  };
}

async function doctorJson(io: DoctorEnvironment): Promise<{ output: DoctorOutput; status: Record<string, string>; message: Record<string, string>; raw: string; exitCode: number }> {
  const outcome = await runDoctor({ ...io, argv: [...io.argv, "--json"] });
  const raw = text(outcome);
  const output = JSON.parse(raw) as DoctorOutput;
  const status: Record<string, string> = {};
  const message: Record<string, string> = {};
  for (const check of output.checks) {
    status[check.id] = check.status;
    message[check.id] = check.message;
  }
  return { output, status, message, raw, exitCode: outcome.exitCode };
}

async function writeConfig(base: string, config: Record<string, unknown>): Promise<string> {
  const file = path.join(base, "config.json");
  await writeFile(file, JSON.stringify({ schemaVersion: 1, ...config }));
  return file;
}

const QUICK_CONFIG = {
  model: "fake-model-id",
  maxOutputTokens: 1000,
  limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 10_000, maxDurationMs: 60_000 },
};

describe("U-6 doctor", () => {
  test("P0: the key value is never printed, in text or JSON, from the environment or a variables file", async () => {
    const { base, work } = await doctorBase();
    const config = await writeConfig(base, QUICK_CONFIG);
    const fromEnv = doctorIo(base, ["--config", config, "--workspace", work], { env: keyEnv() });
    const plain = text(await runDoctor(fromEnv));
    const json = await doctorJson(fromEnv);
    assert.equal(json.status["api_key"], "ok");
    assert.equal(json.message["api_key"], "ANTHROPIC_API_KEY is set");
    for (const printed of [plain, json.raw]) {
      assert.equal(printed.includes(FAKE_DOCTOR_KEY), false);
      assert.equal(printed.includes(FAKE_DOCTOR_KEY.slice(0, 8)), false);
    }

    const vars = path.join(base, "doctor.vars");
    await writeFile(vars, `${ANTHROPIC_API_KEY_ENV}=${FAKE_DOCTOR_KEY}\nOTHER=1\n`);
    const env: Record<string, string> = {};
    const fromFile = doctorIo(base, ["--config", config, "--vars-file", vars, "--workspace", work], { env });
    const second = await doctorJson(fromFile);
    assert.equal(second.status["vars_file"], "ok");
    assert.equal(second.message["vars_file"], "the file given by --vars-file defines 2 variable(s)");
    assert.equal(second.status["api_key"], "ok");
    assert.equal(second.raw.includes(FAKE_DOCTOR_KEY), false);
    assert.deepEqual(env, {}, "the environment object is not changed");
    assert.equal(process.env[ANTHROPIC_API_KEY_ENV] === FAKE_DOCTOR_KEY, false, "the process environment is not changed");
  });

  test("a ready quick form passes; a missing key fails with exit 1", async () => {
    const { base, work } = await doctorBase();
    const config = await writeConfig(base, QUICK_CONFIG);
    const ready = await doctorJson(doctorIo(base, ["--config", config, "--workspace", work], { env: keyEnv() }));
    assert.deepEqual(ready.output.checks.map((check) => check.id), [...DOCTOR_CHECK_IDS]);
    assert.equal(ready.output.status, "ok");
    assert.equal(ready.exitCode, 0);
    for (const id of ["node_version", "config_file", "api_key", "model", "limits", "file_locations", "workspace"]) {
      assert.equal(ready.status[id], "ok", id);
    }
    assert.equal(ready.status["install_dir"], "skipped");

    const missing = await doctorJson(doctorIo(base, ["--config", config, "--workspace", work]));
    assert.equal(missing.status["api_key"], "fail");
    assert.equal(missing.output.status, "fail");
    assert.equal(missing.exitCode, 1);
  });

  test("a scripted task: no key needed, script and limits checked, files located", async () => {
    const { base } = await doctorBase();
    const json = await doctorJson(doctorIo(base, ["--task", path.join(base, "task.json")]));
    assert.equal(json.status["task_file"], "ok");
    assert.equal(json.status["api_key"], "skipped");
    assert.equal(json.status["model"], "ok");
    assert.equal(json.status["limits"], "ok");
    assert.equal(json.status["file_locations"], "ok");
    assert.equal(json.message["file_locations"], "2 input file(s) are outside the workspace");
    assert.equal(json.output.status, "ok");
  });

  test("problems are reported by position, never by value", async () => {
    const { base, work } = await doctorBase();
    const marker = "zz-doctor-marker";
    const config = await writeConfig(base, {
      ...QUICK_CONFIG,
      policy: {
        commands: [
          { executable: process.execPath, argsPrefix: [], allowExtraArgs: true },
          { executable: `${marker}-no-such-tool`, argsPrefix: [], allowExtraArgs: false },
        ],
        network: "deny",
        destructive: "deny",
        restorePathTokens: false,
      },
      verifiers: [{ id: "v", kind: "command", executable: `${marker}-missing`, args: [] }],
      integrity: { paths: [path.join(base, `${marker}-nowhere`)] },
    });
    const json = await doctorJson(doctorIo(base, ["--config", config, "--workspace", work], { env: { ...keyEnv(), PATH: "" } }));
    assert.equal(json.status["commands"], "fail");
    assert.equal(json.message["commands"], "not found: policy.commands[1], verifiers[0]");
    assert.equal(json.status["integrity_paths"], "fail");
    assert.ok(json.message["integrity_paths"]?.includes("does not check it yet"));
    assert.equal(json.raw.includes(marker), false);

    const connected = await doctorJson(
      doctorIo(base, ["--config", config, "--workspace", work], { env: keyEnv(), integrityConnected: true }),
    );
    assert.equal(connected.message["integrity_paths"], "integrity.paths[0] does not exist");

    const insideConfig = path.join(work, "inside-config.json");
    await writeFile(insideConfig, JSON.stringify({ schemaVersion: 1, ...QUICK_CONFIG, integrity: { paths: [work] } }));
    const inside = await doctorJson(
      doctorIo(base, ["--config", insideConfig, "--workspace", work], { env: keyEnv(), integrityConnected: true }),
    );
    assert.equal(inside.status["file_locations"], "fail");
    assert.equal(inside.message["integrity_paths"], "integrity.paths[0] is not outside the workspace");
  });

  test("invalid and key-holding files fail their check without echoing content", async () => {
    const { base, work } = await doctorBase();
    const bad = await writeConfig(base, { limits: { maxModelTurns: -1 } });
    const json = await doctorJson(doctorIo(base, ["--config", bad, "--workspace", work]));
    assert.equal(json.status["config_file"], "fail");
    assert.ok(json.message["config_file"]?.startsWith("limits.maxModelTurns"));

    const keyed = path.join(base, "keyed.json");
    await writeFile(keyed, JSON.stringify({ schemaVersion: 1, model: KEY_SHAPED }));
    const second = await doctorJson(doctorIo(base, ["--config", keyed]));
    assert.equal(second.status["config_file"], "fail");
    assert.equal(second.message["config_file"], "the config file contains a key value");
    assert.equal(second.raw.includes(KEY_SHAPED), false);
  });

  test("install directory, Node.js version and argument errors", async () => {
    const { base, work } = await doctorBase();
    const config = await writeConfig(base, QUICK_CONFIG);
    const same = await doctorJson(doctorIo(base, ["--config", config, "--workspace", work], { installDir: base }));
    assert.equal(same.status["install_dir"], "fail");
    const apart = await doctorJson(doctorIo(base, ["--config", config, "--workspace", work], { installDir: await tempDir() }));
    assert.equal(apart.status["install_dir"], "ok");
    const unknown = await doctorJson(doctorIo(base, ["--config", config, "--workspace", work], { installDir: null }));
    assert.equal(unknown.status["install_dir"], "fail");

    const old = await doctorJson(doctorIo(base, [], { nodeVersion: "24.1.0" }));
    assert.equal(old.status["node_version"], "fail");

    const both = await runDoctor(doctorIo(base, ["--task", "t.json", "--workspace", work]));
    assert.equal(errorCode(both), "invalid_arguments");
    assert.equal(both.exitCode, 2);
    if (IS_WINDOWS) {
      const unc = await runDoctor(doctorIo(base, ["--config", `${SEP}${SEP}server${SEP}share${SEP}c.json`]));
      assert.equal(errorCode(unc), "invalid_arguments");
    }
  });

  test("text output: one line per check and a closing line", async () => {
    const { base } = await doctorBase();
    await mkdir(path.join(base, "empty"));
    const printed = text(await runDoctor(doctorIo(base, [])));
    const lines = printed.trimEnd().split("\n");
    assert.equal(lines.length, DOCTOR_CHECK_IDS.length + 2);
    assert.ok(lines[0]?.startsWith("[ok]") && lines[0].includes("node_version"));
    assert.ok(lines[lines.length - 1]?.startsWith("doctor: fail (exit code 1). No network access was made"));
  });
});
