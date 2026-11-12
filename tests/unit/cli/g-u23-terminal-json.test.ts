/**
 * Unit U-23 (DR-49, UXM-17, UXM-9), the CLI's part:
 * - At a terminal the person reads the human text on stderr, so the JSON line after it is left out
 *   of stdout. With `--json`, or when stdout is not a terminal (a pipe or a file), stdout carries
 *   exactly what it did before. `run`, `revert` and `apply` take `--json` for that.
 * - `codaryn` with no arguments shows the help (as `--help`, exit 0) instead of invalid_arguments.
 * The real CLI under the net guard, scripted model, nothing is sent. "At a terminal" is made by a
 * preload that marks the child's stdout as a terminal (process.stdout.isTTY); the product reads no
 * switch of its own for it. The decision itself (guard.ts stdoutText) is tested with the terminal
 * state injected. Fake values only.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, describe, test } from "node:test";

import { RESULT_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { ApplyResult, CliErrorOutput, EngineResult, RevertOutput } from "../../../src/contracts/index.js";
import { APPLY_USAGE, REVERT_USAGE, RUN_USAGE, parseApplyArgs, parseArgs, parseRevertArgs } from "../../../src/cli/args.js";
import { jsonLineLeftOut, renderOutcome, stdoutText } from "../../../src/cli/guard.js";
import type { CommandOutcome } from "../../../src/cli/guard.js";
import { helpRequest, helpText } from "../../../src/cli/help.js";
import { cliError } from "../../../src/cli/run.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const main = path.resolve(here, "..", "..", "..", "src", "cli", "main.js");
const guard = pathToFileURL(path.resolve(here, "..", "..", "support", "net-guard.js")).href;
/** Marks the child's stdout as a terminal before main.js runs. */
const TERMINAL = `data:text/javascript,${encodeURIComponent("Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });")}`;

const RULE = { id: "readme", kind: "file_rules", rules: [{ type: "contains", path: "README.md", text: "# Title" }] };
const LIMITS = { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 };
const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };

interface Workspace {
  readonly base: string;
  /** The CLI in `base`; `terminal`: stdout is marked as a terminal. */
  cli(args: readonly string[], terminal: boolean): { status: number | null; stdout: string; stderr: string };
}

async function workspace(): Promise<Workspace> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u23-"));
  temporaryDirs.push(base);
  await mkdir(path.join(base, "ws"));
  await writeFile(path.join(base, "ws", "README.md"), "# Title\n", "utf8");
  await writeFile(path.join(base, "ws", "a.txt"), "alpha\n", "utf8");
  // The default config location is a test folder (nothing of the host's is read).
  const home = path.join(base, "home");
  await mkdir(home);
  const env: Record<string, string> = { CODARYN_LANG: "en", APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, HOME: home, USERPROFILE: home };
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP"]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return {
    base,
    cli: (args, terminal) => {
      const run = spawnSync(process.execPath, ["--import", guard, ...(terminal ? ["--import", TERMINAL] : []), main, ...args], { cwd: base, env, encoding: "utf8" });
      return { status: run.status, stdout: run.stdout, stderr: run.stderr };
    },
  };
}

/** A run task writing notes.txt, checked by a file rule (done, exit 0). */
async function runTask(ws: Workspace): Promise<void> {
  const steps = [
    { toolCalls: [{ name: "write_file", args: { path: "notes.txt", expectedHash: null, change: { kind: "replace_all", content: "x\n" } } }] },
    { text: "done" },
  ];
  await writeFile(path.join(ws.base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  const task = { schemaVersion: 1, id: "u23", goal: "g", workflow: "test", workspaceRoot: "./ws", model: { provider: "scripted", scriptPath: "./script.json" }, policy: POLICY, privacy: { secretEnv: [] }, limits: LIMITS, verifiers: [RULE] };
  await writeFile(path.join(ws.base, "task.json"), JSON.stringify(task), "utf8");
}

/** A plan task moving a.txt (organize), for apply. */
async function planTask(ws: Workspace): Promise<void> {
  const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] }];
  await writeFile(path.join(ws.base, "plan-script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  const task = {
    schemaVersion: 1,
    id: "u23-plan",
    goal: "g",
    workflow: "label",
    workspaceRoot: "./ws",
    model: { provider: "scripted", scriptPath: "./plan-script.json" },
    policy: { ...POLICY, planActions: ["move"] },
    privacy: { secretEnv: [] },
    limits: LIMITS,
    verifiers: [],
    workflowRef: "organize",
  };
  await writeFile(path.join(ws.base, "plan-task.json"), JSON.stringify(task), "utf8");
}

async function stored(ws: Workspace, runId: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(ws.base, "ws", STATE_DIR_NAME, RUNS_DIR_NAME, runId, RESULT_FILE_NAME), "utf8"));
}

/** stdout is one JSON line (ASCII, N-19) and nothing else. */
function oneJsonLine<T>(stdout: string): T {
  assert.match(stdout, /^[^\n]+\n$/, stdout);
  assert.match(stdout, /^[\x20-\x7e]+\n$/, "ASCII only");
  return JSON.parse(stdout) as T;
}

describe("U-23 (DR-49): at a terminal the JSON line after the human text is left out", () => {
  test("run at a terminal: no JSON line on stdout; the end summary is on stderr; the result is recorded; the exit code is the run's", async () => {
    const ws = await workspace();
    await runTask(ws);
    const run = ws.cli(["run", "--task", "task.json"], true);
    assert.equal(run.stdout, "", run.stdout);
    assert.equal(run.status, 0, run.stderr);
    const runId = /Run id: (\S+)/.exec(run.stderr)?.[1];
    assert.ok(runId !== undefined, run.stderr);
    assert.equal(((await stored(ws, runId)) as EngineResult).status, "done");
  });

  test("run at a terminal with --json: the JSON line as before (the recorded result), nothing else on stdout", async () => {
    const ws = await workspace();
    await runTask(ws);
    const run = ws.cli(["run", "--task", "task.json", "--json"], true);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const result = oneJsonLine<EngineResult>(run.stdout);
    assert.deepEqual(result, await stored(ws, result.runId));
    assert.ok(run.stderr.includes("Run id:"), "the summary is still on stderr");
  });

  test("run through a pipe: the JSON line as before, with or without --json", async () => {
    const ws = await workspace();
    await runTask(ws);
    for (const more of [[], ["--json"]]) {
      const run = ws.cli(["run", "--task", "task.json", ...more], false);
      assert.equal(run.status, 0, run.stdout + run.stderr);
      const result = oneJsonLine<EngineResult>(run.stdout);
      assert.deepEqual(result, await stored(ws, result.runId));
    }
  });

  test("--quiet at a terminal: no human text, so the JSON line stays (otherwise nothing would show)", async () => {
    const ws = await workspace();
    await runTask(ws);
    const run = ws.cli(["run", "--task", "task.json", "--quiet"], true);
    assert.equal(run.stderr, "");
    const result = oneJsonLine<EngineResult>(run.stdout);
    assert.deepEqual(result, await stored(ws, result.runId));
  });

  test("revert at a terminal: no JSON line, the summary on stderr; with --json the RevertOutput line", async () => {
    const ws = await workspace();
    await runTask(ws);
    const first = oneJsonLine<EngineResult>(ws.cli(["run", "--task", "task.json", "--quiet"], false).stdout);
    const dry = ws.cli(["revert", "--workspace", "ws", "--run", first.runId, "--dry-run"], true);
    assert.deepEqual([dry.status, dry.stdout], [0, ""], dry.stderr);
    assert.ok(dry.stderr.length > 0, "the revert summary is on stderr");
    const json = ws.cli(["revert", "--workspace", "ws", "--run", first.runId, "--dry-run", "--json"], true);
    const output = oneJsonLine<RevertOutput>(json.stdout);
    assert.deepEqual([json.status, output.kind, output.dryRun], [0, "revert", true], json.stdout);
    // A pipe without --json: the same line.
    assert.deepEqual(oneJsonLine<RevertOutput>(ws.cli(["revert", "--workspace", "ws", "--run", first.runId, "--dry-run"], false).stdout), output);
  });

  test("apply at a terminal: no JSON line, the summary on stderr; with --json the ApplyResult line", async () => {
    for (const json of [false, true]) {
      const ws = await workspace();
      await planTask(ws);
      const planned = oneJsonLine<EngineResult>(ws.cli(["run", "--task", "plan-task.json", "--quiet"], false).stdout);
      assert.equal(planned.reason, "plan_pending", JSON.stringify(planned));
      const digest = (planned.plan?.digest ?? "").slice(0, 12);
      const apply = ws.cli(["apply", "--task", "plan-task.json", "--run", planned.runId, "--digest", digest, ...(json ? ["--json"] : [])], true);
      assert.equal(apply.status, 0, apply.stdout + apply.stderr);
      assert.ok(apply.stderr.length > 0, "the apply summary is on stderr");
      if (!json) {
        assert.equal(apply.stdout, "");
        continue;
      }
      const result = oneJsonLine<ApplyResult>(apply.stdout);
      assert.deepEqual([result.kind, result.status], ["apply", "done"]);
      assert.deepEqual(result, await stored(ws, result.runId));
    }
  });

  test("an error at a terminal: the explained error on stderr, no JSON line; with --json or through a pipe the CliErrorOutput line", async () => {
    const ws = await workspace();
    const args = ["report", "--workspace", "ws", "--run", "20990101T000000Z-0000abcd"];
    const shown = ws.cli(args, true);
    assert.deepEqual([shown.status, shown.stdout], [2, ""], shown.stderr);
    assert.ok(shown.stderr.includes("run_not_found"), shown.stderr);
    for (const [more, terminal] of [[["--json"], true], [[], false]] as const) {
      const run = ws.cli([...args, ...more], terminal);
      const output = oneJsonLine<CliErrorOutput>(run.stdout);
      assert.deepEqual([run.status, output.kind, output.code], [2, "error", "run_not_found"]);
    }
  });

  test("a text output (help, report) is printed at a terminal as before", async () => {
    const ws = await workspace();
    for (const terminal of [true, false]) {
      const help = ws.cli(["--help"], terminal);
      assert.equal(help.status, 0);
      assert.ok(help.stdout.startsWith("codaryn: "), help.stdout);
    }
  });
});

describe("U-23 (DR-49): stdoutText decides by the injected terminal state", () => {
  const json: CommandOutcome = cliError("run_not_found", "x");
  const text: CommandOutcome = { text: "a text", exitCode: 0 };
  const at = (argv: readonly string[], stdoutIsTerminal: boolean) => ({ argv, stdoutIsTerminal });

  test("a JSON outcome at a terminal is left out; with --json, --quiet or no terminal it is renderOutcome's bytes", () => {
    assert.equal(stdoutText(json, at(["report", "--run", "x"], true)), "");
    assert.equal(jsonLineLeftOut(json, at([], true)), true);
    for (const context of [at(["report", "--json"], true), at(["run", "--quiet"], true), at(["report"], false), at([], false)]) {
      assert.equal(stdoutText(json, context), renderOutcome(json), JSON.stringify(context));
      assert.equal(jsonLineLeftOut(json, context), false);
    }
  });

  test("--json and --quiet count wherever they are, even when the arguments cannot be parsed", () => {
    for (const argv of [["run", "--json", "--task", "t.json"], ["nosuch", "--json"], ["--json"], ["run", "--bogus", "--quiet"]]) {
      assert.equal(stdoutText(json, at(argv, true)), renderOutcome(json), argv.join(" "));
    }
  });

  test("a text outcome is always written", () => {
    for (const terminal of [true, false]) assert.equal(stdoutText(text, at([], terminal)), "a text\n");
  });
});

describe("U-23 (DR-49): run, revert and apply take --json and nothing else changes", () => {
  const RUN_ID = "20261113T000000Z-0000abcd";
  const cases: readonly [readonly string[], (argv: readonly string[]) => unknown][] = [
    [["run", "--task", "t.json"], parseArgs],
    [["run", "a goal"], parseArgs],
    [["revert", "--workspace", "ws", "--run", RUN_ID, "--dry-run"], parseRevertArgs],
    [["apply", "--task", "t.json", "--run", RUN_ID, "--digest", "0123456789ab"], parseApplyArgs],
  ];

  test("with --json the parsed arguments are the ones without it; twice is refused like any repeated switch", () => {
    for (const [argv, parse] of cases) {
      const plain = parse(argv) as { ok: boolean };
      assert.equal(plain.ok, true, JSON.stringify(plain));
      assert.deepEqual(parse([...argv, "--json"]), plain, argv.join(" "));
      const twice = parse([...argv, "--json", "--json"]) as { ok: boolean; message?: string };
      assert.equal(twice.ok, false);
      assert.match(twice.message ?? "", /^unknown or repeated option\. /);
    }
  });

  test("the usage lines (inside invalid_arguments messages) stay as they were: they do not gain --json", () => {
    for (const usage of [RUN_USAGE, REVERT_USAGE, APPLY_USAGE]) assert.equal(usage.includes("--json"), false, usage);
  });

  test("the help of run and revert names --json; apply's help says what it does at a terminal", () => {
    for (const command of ["run", "revert"] as const) assert.ok(helpText(command).includes("--json: "), command);
    assert.ok(helpText("apply").includes("--json"));
  });
});

describe("U-23 (DR-49, UXM-9): codaryn with no arguments shows the help", () => {
  test("helpRequest: no arguments is a help request for the whole CLI", () => {
    assert.deepEqual(helpRequest([]), { kind: "help", command: null });
  });

  test("the real CLI: the same text as --help on stdout, exit 0, nothing on stderr, at a terminal and through a pipe", async () => {
    const ws = await workspace();
    for (const terminal of [true, false]) {
      const bare = ws.cli([], terminal);
      const help = ws.cli(["--help"], terminal);
      assert.deepEqual([bare.status, bare.stdout, bare.stderr], [0, help.stdout, ""], bare.stdout + bare.stderr);
    }
  });
});
