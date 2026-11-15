/**
 * U-194 (DR-69 B-4, B-8; U-182, U-186, U-183; Codex V-6, docs/reviews/2026-11-13-v6-codex-verify-u182.md):
 * policy writablePaths in the real CLI, where the unit tests (tests/unit/cli/g-u182-writable-paths,
 * tests/unit/app/u186-writable-paths-app) do not reach. Each place that gives a list (config file,
 * profile, task type definition, task file) is its own list and a write must be covered by all of
 * them. Scripted model or a fake API on 127.0.0.1, no key, every command behind the network guard.
 * - the four places at once with different lists: only the file all of them cover is written;
 * - one place narrowing while the other three are wide, and an empty list in one place;
 * - a bad list in any place: refused before the run, nothing made;
 * - Windows case, a trailing slash, and a bad write path (invalid_path, not path_not_writable);
 * - the quick form (no task list): the config's, the profile's and the definition's lists, the
 *   refusal hint the model receives and the line that tells the person how to allow a file;
 * - doctor's warning for a list in the config, a profile or a definition with a command rule;
 * - an apply judged by the apply's config list;
 * - the same input through the CLI and through the app (the GUI engine host's way, U-186).
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createCodarynApp, createNodeAppEnvironment } from "../../src/app/index.js";
import { REFUSAL_HINTS } from "../../src/contracts/index.js";
import type { JournalRecord, JsonObject, MessageCatalog } from "../../src/contracts/index.js";
import { createMessageCatalog } from "../../src/i18n/index.js";
import { ANTHROPIC_LIMITS, FAKE_MODEL_CONFIG, fakeApiConfig, writeConfigFile } from "../fixtures/anthropic.js";
import { createSandbox, nodeCommand } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { createFileArgs, organizeScript, textStep, toolStep, writeGeneralTask, writeOrganizeTask, writeOrganizeWorkspace } from "../fixtures/general-tasks.js";
import { FAKE_API_KEY } from "../fixtures/secrets.js";
import { cliEnv } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { replyText, replyTools, runGuarded, startFakeAnthropic, toolResultText, toolUse } from "../support/fake-anthropic.js";

const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };
const LIMITS = { maxModelTurns: 8, maxToolCalls: 24, maxTotalTokens: 1000, maxDurationMs: 60_000 };
/** A task type definition with the file tools (and only them) and the given policy fields. */
const definition = (policy: JsonObject): JsonObject => ({ tools: ["read_file", "search_files", "write_file"], policy: { ...POLICY, ...policy } });
const hintLine = (catalog: MessageCatalog, count: number): string => (catalog.format as (id: string, params: object) => string)("progress.not_writable_hint", { count });

/** Writes each path in turn (a new file each), then ends. */
function writes(...paths: readonly string[]): ReturnType<typeof toolStep>[] {
  return [...paths.map((file) => toolStep("write_file", createFileArgs(file, "x\n"))), textStep("done")];
}

interface CliOutput {
  readonly kind: string;
  readonly runId?: string;
  readonly code?: string;
  readonly message?: string;
  readonly status?: string;
  readonly reason?: string;
  readonly plan?: { readonly digest: string };
}

function outputOf(run: CliRun): CliOutput {
  const last = run.stdout.trim().split("\n").pop() ?? "";
  assert.notEqual(last, "", `no output; stderr: ${run.stderr}`);
  return JSON.parse(last) as CliOutput;
}

/** The run's tool decisions in order: "allowed", or "<permission>/<code>". */
function decisionsOf(workspace: string, runId: string): string[] {
  return readFileSync(path.join(workspace, ".codaryn", "runs", runId, "journal.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as JournalRecord)
    .flatMap((record) => (record.type === "tool_decision" ? [record.allowed ? "allowed" : `${record.permission ?? "?"}/${record.code ?? "?"}`] : []));
}

/** Runs and expects a run result; returns its decisions and the CLI run. */
async function runCli(sb: Sandbox, args: readonly string[], env: NodeJS.ProcessEnv = cliEnv({ extra: { CODARYN_LANG: "en" } })): Promise<{ run: CliRun; decisions: string[]; output: CliOutput }> {
  const run = await runGuarded(sb, args, env);
  const output = outputOf(run);
  assert.equal(output.kind, "run", `${output.code ?? ""} ${output.message ?? ""}\n${run.stderr}`);
  return { run, decisions: decisionsOf(sb.workspace, output.runId ?? ""), output };
}

const exists = (sb: Sandbox, file: string): boolean => existsSync(path.join(sb.workspace, ...file.split("/")));

type Place = "config" | "profile" | "definition" | "task";
const PLACES: readonly Place[] = ["config", "profile", "definition", "task"];

/**
 * A task file run whose four places give the lists in `lists` (a place left out gives none). The
 * profile is "p" and the definition "d"; the task names "d" and the run gives --profile p.
 */
function fourPlaces(sb: Sandbox, lists: Partial<Record<Place, unknown>>, steps: ReturnType<typeof writes>): string[] {
  const listed = (place: Place): JsonObject => (lists[place] === undefined ? {} : { writablePaths: lists[place] as JsonObject[string] });
  const config = writeConfigFile(sb, {
    schemaVersion: 1,
    limits: LIMITS,
    policy: { ...POLICY, ...listed("config") },
    profiles: { p: { policy: { ...POLICY, ...listed("profile") } } },
    workflows: { d: definition(listed("definition")) },
  });
  const task = writeGeneralTask(sb, { id: "u194-four", fields: { workflowRef: "d" }, policy: listed("task") }, steps);
  return ["run", "--task", task, "--config", config, "--profile", "p"];
}

test("U-194: the four places at once with different lists: only the file every list covers is written", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  const files = ["a/sub/yes.txt", "a/no.txt", "c/no.txt", "b/no.txt", "d/no.txt", "e/no.txt"];
  const args = fourPlaces(sb, { config: ["a", "c"], profile: ["a/sub", "b"], definition: ["a/sub/yes.txt", "d"], task: ["a", "e"] }, writes(...files));
  const { decisions, run } = await runCli(sb, args);
  assert.deepEqual(decisions, ["allowed", ...Array.from({ length: 5 }, () => "path/path_not_writable")]);
  assert.deepEqual(files.map((file) => exists(sb, file)), [true, false, false, false, false, false]);
  assert.ok(run.stderr.includes(hintLine(createMessageCatalog("en"), 5)), run.stderr);
});

test("U-194: one place narrowing while the other three are wide; an empty list in one place stops every write", { timeout: 180_000 }, async (t) => {
  for (const place of PLACES) {
    const wide = Object.fromEntries(PLACES.map((other) => [other, ["."]])) as Record<Place, unknown>;
    const narrow = createSandbox(t);
    const ran = await runCli(narrow, fourPlaces(narrow, { ...wide, [place]: ["a"] }, writes("a/yes.txt", "ab/no.txt")));
    assert.deepEqual(ran.decisions, ["allowed", "path/path_not_writable"], `${place} ['a']`);
    assert.deepEqual([exists(narrow, "a/yes.txt"), exists(narrow, "ab/no.txt")], [true, false], `${place} ['a']`);
    const empty = createSandbox(t);
    const none = await runCli(empty, fourPlaces(empty, { ...wide, [place]: [] }, writes("a/yes.txt", "ab/no.txt")));
    assert.deepEqual(none.decisions, ["path/path_not_writable", "path/path_not_writable"], `${place} []`);
    assert.deepEqual([exists(empty, "a/yes.txt"), exists(empty, "ab/no.txt")], [false, false], `${place} []`);
  }
});

test("U-194: a bad list in any of the four places is refused before the run; nothing is made", { timeout: 240_000 }, async (t) => {
  // Every platform: not a list, not a string, empty, absolute, a parent segment. On Windows also the
  // names that cannot address an ordinary file (a device name, a colon, a trailing dot or space).
  const bad: unknown[] = ["a", [5], [""], ["/abs"], ["../x"], ...(process.platform === "win32" ? [["NUL"], ["a:b"], ["a."], ["a "]] : [])];
  for (const place of PLACES) {
    for (const value of bad) {
      const sb = createSandbox(t);
      const run = await runGuarded(sb, fourPlaces(sb, { [place]: value }, writes("a/yes.txt")), cliEnv());
      const output = outputOf(run);
      const label = `${place} ${JSON.stringify(value)}`;
      assert.equal(output.kind, "error", `${label}: ${run.stdout}`);
      assert.equal(output.code, place === "task" ? "invalid_task" : "invalid_config", label);
      assert.equal(run.exitCode, 2, label);
      assert.ok((output.message ?? "").includes("writablePaths"), `${label}: ${output.message}`);
      assert.equal(existsSync(path.join(sb.workspace, ".codaryn")), false, `${label}: no run was made`);
      assert.equal(exists(sb, "a/yes.txt"), false, label);
    }
  }
});

test("U-194: Windows case and a trailing slash; a bad write path is invalid_path, not path_not_writable", { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  const task = writeGeneralTask(sb, { id: "u194-case", policy: { writablePaths: ["A/"] } }, writes("a/yes.txt", "Ab/no.txt", "a./bad.txt", "a/bad.txt."));
  const { decisions } = await runCli(sb, ["run", "--task", task]);
  // An entry covers itself and what is under it, by path segment; Windows does not tell case apart.
  const windows = process.platform === "win32";
  assert.equal(decisions[0], windows ? "allowed" : "path/path_not_writable", "a/yes.txt under 'A/'");
  assert.equal(decisions[1], "path/path_not_writable", "Ab/no.txt is not under 'A/'");
  for (const [index, file] of [[2, "a./bad.txt"], [3, "a/bad.txt."]] as const) {
    if (windows) assert.match(decisions[index] ?? "", /\/invalid_path$/, `${file}: a name Windows cannot make is invalid_path`);
    else assert.notEqual(decisions[index], "allowed", file);
  }
  assert.equal(exists(sb, "a/yes.txt"), windows);
  for (const file of ["Ab/no.txt", "a./bad.txt", "a/bad.txt."]) assert.equal(existsSync(path.join(sb.workspace, ...file.split("/"))), false, file);
});

test("U-194: the quick form takes the config's, the profile's and the definition's lists; the model gets the refusal hint", { timeout: 120_000 }, async (t) => {
  const cases: readonly { readonly name: string; readonly config: JsonObject; readonly extra: readonly string[] }[] = [
    { name: "config", config: { policy: { ...POLICY, writablePaths: ["a"] } }, extra: [] },
    { name: "profile", config: { policy: POLICY, profiles: { p: { policy: { ...POLICY, writablePaths: ["a"] } } } }, extra: ["--profile", "p"] },
    { name: "definition", config: { policy: POLICY, workflows: { d: definition({ writablePaths: ["a"] }) } }, extra: ["--workflow", "d"] },
  ];
  for (const one of cases) {
    await t.test(one.name, async (st) => {
      const sb = createSandbox(st);
      const write = (id: string, file: string) => toolUse(id, "write_file", createFileArgs(file, "x\n"));
      const api = await startFakeAnthropic(st, [replyTools([write("w1", "a/yes.txt"), write("w2", "ab/no.txt")]), replyText("done")]);
      const config = writeConfigFile(sb, fakeApiConfig(api.url, { model: FAKE_MODEL_CONFIG, limits: ANTHROPIC_LIMITS, ...one.config } as never));
      const { decisions, run } = await runCli(
        sb,
        ["run", "--workspace", sb.workspace, "--goal", "a/yes.txt와 ab/no.txt를 만든다", "--config", config, ...one.extra],
        cliEnv({ fakeApiKey: FAKE_API_KEY, extra: { CODARYN_LANG: "en" } }),
      );
      assert.deepEqual(decisions, ["allowed", "path/path_not_writable"]);
      assert.deepEqual([exists(sb, "a/yes.txt"), exists(sb, "ab/no.txt")], [true, false]);
      assert.ok(run.stderr.includes(hintLine(createMessageCatalog("en"), 1)), run.stderr);
      // The model's tool result for the refused write carries the contract's hint for it (U-175).
      const second = api.requests[1];
      assert.ok(second !== undefined, "the model was asked again after the tools");
      assert.ok(toolResultText(second, "w2").includes(REFUSAL_HINTS.path_not_writable), toolResultText(second, "w2"));
    });
  }
});

test("U-194: doctor warns when a list in the config, a profile or a definition comes with a command rule", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  const script = path.join(sb.base, "tool.js");
  writeFileSync(script, "process.exit(0)\n");
  const rule = { ...nodeCommand(script), argsPrefix: [script] } as unknown as JsonObject;
  for (const place of ["config", "profile", "definition"] as const) {
    const config = writeConfigFile(
      sb,
      {
        schemaVersion: 1,
        limits: LIMITS,
        policy: { ...POLICY, ...(place === "config" ? { writablePaths: ["out"] } : {}) },
        profiles: { p: { policy: { ...POLICY, ...(place === "profile" ? { writablePaths: ["out"] } : {}) } } },
        // The definition's own command rules narrow the task's (an empty list would drop the rule), so it has the same rule.
        workflows: { d: definition({ commands: [rule], ...(place === "definition" ? { writablePaths: ["out"] } : {}) }) },
      },
      `doctor-${place}.json`,
    );
    const task = writeGeneralTask(sb, { id: "u194-doctor", fields: { workflowRef: "d" }, policy: { commands: [rule] } }, writes("out/a.txt"));
    const run = await runGuarded(sb, ["doctor", "--task", task, "--config", config, "--profile", "p", "--json"], cliEnv());
    const checks = (JSON.parse(run.stdout.trim()) as { checks: { id: string; status: string; text?: { id: string } }[] }).checks;
    const commands = checks.find((check) => check.id === "commands");
    assert.ok(commands !== undefined, run.stdout);
    assert.equal(commands.status, "warn", `${place}: ${JSON.stringify(commands)}`);
    assert.equal(commands.text?.id, "doctor.commands.writable_with_commands", place);
  }
});

test("U-194: an apply is judged by the apply's config list: the move it leaves out is refused, nothing moves", { timeout: 120_000 }, async (t) => {
  const sb = createSandbox(t);
  writeOrganizeWorkspace(sb);
  const task = writeOrganizeTask(sb, "u194-organize", organizeScript());
  const made = outputOf(await runGuarded(sb, ["run", "--task", task], cliEnv()));
  assert.equal(made.reason, "plan_pending", JSON.stringify(made));
  // The plan moves into docs/, data/ and images/; the apply's config list leaves out data/.
  const config = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, policy: { ...POLICY, writablePaths: ["inbox", "docs", "images"] } }, "apply.json");
  const applied = outputOf(await runGuarded(sb, ["apply", "--task", task, "--config", config, "--run", made.runId ?? "", "--digest", (made.plan?.digest ?? "").slice(0, 12)], cliEnv()));
  assert.equal(applied.kind, "apply", JSON.stringify(applied));
  assert.equal(`${applied.status}/${applied.reason}`, "failed/plan_stale");
  const checked = readFileSync(path.join(sb.workspace, ".codaryn", "runs", applied.runId ?? "", "journal.jsonl"), "utf8")
    .split("\n")
    .find((line) => line.includes('"type":"plan_checked"'));
  assert.ok(checked !== undefined, "the apply checked the plan first");
  assert.deepEqual((JSON.parse(checked) as { problems: unknown }).problems, [{ index: 1, problem: "denied" }]);
  assert.equal(exists(sb, "data/budget.csv"), false, "nothing moved into data/");
  assert.ok(exists(sb, "inbox/budget.csv"), "the source stays");
});

test("U-194: the same input through the CLI and the app (the engine host's way): both refuse the write outside the config's list", { timeout: 120_000 }, async (t) => {
  // V-6's known omission before U-186: the config says ['a'], the task ['.'], and ab/no.txt is written.
  const prepare = (sb: Sandbox): { task: string; config: string } => ({
    config: writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, policy: { ...POLICY, writablePaths: ["a"] } }),
    task: writeGeneralTask(sb, { id: "u194-parity", policy: { writablePaths: ["."] } }, writes("a/yes.txt", "ab/no.txt")),
  });
  const cliSide = createSandbox(t);
  const viaCli = prepare(cliSide);
  const cli = await runCli(cliSide, ["run", "--task", viaCli.task, "--config", viaCli.config]);

  const appSide = createSandbox(t);
  const viaApp = prepare(appSide);
  const app = createCodarynApp({ ...(await createNodeAppEnvironment()), env: cliEnv(), cwd: appSide.base, homeDir: null });
  const started = await app.startRun({ input: { kind: "task", taskPath: viaApp.task }, configPath: viaApp.config, varsFile: null, profile: null, workflowRef: null, cancelFile: null });
  assert.ok(started.ok, JSON.stringify(started));
  const done = await started.handle.done;
  assert.ok(done.ok, JSON.stringify(done));

  assert.deepEqual(cli.decisions, ["allowed", "path/path_not_writable"]);
  assert.deepEqual(decisionsOf(appSide.workspace, done.result.runId), cli.decisions, "the app decides as the CLI does");
  for (const [side, sb] of [["cli", cliSide], ["app", appSide]] as const) {
    assert.deepEqual([exists(sb, "a/yes.txt"), exists(sb, "ab/no.txt")], [true, false], side);
  }
  assert.equal(done.result.status, cli.output.status);
  assert.equal(done.result.reason, cli.output.reason);
});

