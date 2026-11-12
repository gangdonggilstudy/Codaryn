/**
 * U-37 (UXM-2, DR-57; the U-19 survey, section 3 G), the CLI's part: the human error of an argument,
 * input or setting error said only "the command arguments are not valid" (or its config, task or key
 * counterpart); the reason was in the English `message` alone. Now each such error carries the
 * contract's hint (CLI_ERROR_HINTS, DETAILED_CLI_ERROR_HINTS, contract 8cb38f1), so the human error
 * tells the reason in the chosen language:
 * - the JSON line gains only `"hint":"<hint>"`; `message` is as before, word for word
 * - a detailed hint's values (unknown_option's position, a key field's place, the missing
 *   settings) travel under CLI_ERROR_HINT_DETAIL, a symbol key the JSON line leaves out.
 * Parsers are called directly; the run's errors come from runCli in this process (nothing is sent:
 * every case stops before a model is made). Fake values only (G-10: a key-shaped value is built
 * from parts).
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { CLI_ERROR_HINT_DETAIL } from "../../../src/contracts/index.js";
import type { CliErrorHintDetail, CliErrorOutput } from "../../../src/contracts/index.js";
import { USAGE, parseApplyArgs, parseArgs, parseRevertArgs, parseReviewArgs } from "../../../src/cli/args.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { parseChangesArgs } from "../../../src/cli/changes.js";
import { parseCleanupArgs } from "../../../src/cli/cleanup.js";
import { jsonLine } from "../../../src/cli/guard.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { MAX_INPUT_FILE_BYTES } from "../../../src/cli/security/keys.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const RUN_ID = "20261113T000000Z-0000abcd";
const DIGEST = "0123456789ab";
/** G-10: a key-shaped fake value, built from parts. */
const FAKE_KEY = ["sk", "ant", "api03", "FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE0000"].join("-");

type Failure = { readonly ok: boolean; readonly message?: string; readonly hint?: string; readonly position?: number };
const failure = (outcome: unknown): Failure => outcome as Failure;
const detailOf = (output: CliErrorOutput): CliErrorHintDetail | undefined => (output as { [CLI_ERROR_HINT_DETAIL]?: CliErrorHintDetail })[CLI_ERROR_HINT_DETAIL];

describe("U-37: argument errors name their reason with a hint", () => {
  test("no command, an unknown command, help of no command: unknown_command; --version with more: version_no_json", () => {
    for (const argv of [[], ["nosuch"], ["help", "nosuch"], ["--json"]]) {
      const parsed = failure(parseArgs(argv));
      assert.deepEqual([parsed.ok, parsed.message, parsed.hint], [false, USAGE, "unknown_command"], argv.join(" "));
    }
    for (const argv of [["--version", "--json"], ["-v", "x"], ["version", "--json"]]) {
      const parsed = failure(parseArgs(argv));
      assert.deepEqual([parsed.message, parsed.hint], [USAGE, "version_no_json"], argv.join(" "));
    }
  });

  test("an unknown or repeated option: unknown_option with its place after the command word, never its name", () => {
    const cases: [readonly string[], (argv: readonly string[]) => unknown, number][] = [
      [["run", "--task", "t.json", "--bogus"], parseArgs, 3],
      // A repeated option: the place of its second use.
      [["run", "--quiet", "--task", "t.json", "--quiet"], parseArgs, 4],
      [["run", "--task", "a.json", "--task", "b.json"], parseArgs, 3],
      [["revert", "--workspace", "w", "--run", RUN_ID, "--nope"], parseRevertArgs, 5],
      [["changes", "--run", RUN_ID, "--bogus", "x"], parseChangesArgs, 3],
      [["changes", "--json", "--json"], parseChangesArgs, 2],
      [["cleanup", "--workspace", "w", "--bogus", "x"], parseCleanupArgs, 3],
      [["cleanup", "--workspace", "w", "--reverted", "--reverted"], parseCleanupArgs, 4],
    ];
    for (const [argv, parse, position] of cases) {
      const parsed = failure(parse(argv));
      assert.deepEqual([parsed.ok, parsed.hint, parsed.position], [false, "unknown_option", position], argv.join(" "));
    }
  });

  test("the other reasons of argument errors", () => {
    const cases: [readonly string[], (argv: readonly string[]) => unknown, string][] = [
      [["run", "--workspace", "w"], parseArgs, "workspace_goal_together"],
      [["run", "--goal", "g"], parseArgs, "workspace_goal_together"],
      [["apply", "--task", "t.json", "--run", "latest", "--digest", DIGEST], parseApplyArgs, "apply_needs_run_id"],
      [["apply", "--task", "t.json", "--run", RUN_ID, "--digest", "XYZ"], parseApplyArgs, "digest_form"],
      [["cleanup", "--workspace", "w", "--confirm", "abc"], parseCleanupArgs, "digest_form"],
      [["review", "--task", "t.json", "--run", RUN_ID], parseReviewArgs, "review_needs_verdict"],
      [["revert", "--workspace", "w", "--run", "../x"], parseRevertArgs, "run_id_form"],
      [["changes", "--run", "a/b"], parseChangesArgs, "run_id_form"],
    ];
    for (const [argv, parse, hint] of cases) {
      const parsed = failure(parse(argv));
      assert.deepEqual([parsed.ok, parsed.hint], [false, hint], argv.join(" "));
    }
  });
});

interface Sandbox {
  readonly base: string;
  run(argv: readonly string[], env?: Record<string, string>): Promise<CliErrorOutput>;
}

async function sandbox(): Promise<Sandbox> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u37-"));
  temporaryDirs.push(base);
  await mkdir(path.join(base, "ws"));
  let now = Date.now() - 600_000;
  let seed = 37;
  return {
    base,
    async run(argv, env = {}) {
      const outcome = await runCli({
        argv,
        env,
        cwd: base,
        readFile: (file: string) => readFile(file, "utf8"),
        isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
        loadEnvFile: () => {},
        locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
        relatePaths: (target: string, root: string) => relateRealPaths(target, root),
        clock: { now: () => (now += 1000) },
        randomBytes: (size: number) => new Uint8Array(size).fill(seed++ % 250),
        cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
        assemble: assembleRun,
      });
      assert.equal(outcome.output.kind, "error", JSON.stringify(outcome.output));
      return outcome.output as CliErrorOutput;
    },
  };
}

const TASK = {
  schemaVersion: 1,
  id: "g-u37",
  goal: "g",
  workflow: "test",
  workspaceRoot: "./ws",
  model: { provider: "scripted", scriptPath: "./script.json" },
  policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
  privacy: { secretEnv: [] },
  limits: { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
  verifiers: [],
};
const CONFIG = { schemaVersion: 1, limits: TASK.limits, policy: TASK.policy };

/** The error's hint, its message as given, and the JSON line with the hint and without the detail. */
function hinted(output: CliErrorOutput, code: string, hint: string, message?: string): void {
  assert.deepEqual([output.code, output.hint], [code, hint], JSON.stringify(output));
  if (message !== undefined) assert.equal(output.message, message);
  const line = jsonLine(output);
  assert.ok(line.endsWith(`,"hint":"${hint}"}\n`), line);
  assert.deepEqual(Object.keys(JSON.parse(line) as object), [...Object.keys(output)], "no other field");
}

describe("U-37: input and setting errors of a run name their reason with a hint", () => {
  test("a task file that cannot be read: task_file_unreadable; the message stays as it was", async () => {
    const box = await sandbox();
    hinted(await box.run(["run", "--task", "missing.json"]), "invalid_task", "task_file_unreadable", "the task file cannot be read as JSON");
  });

  test("a task file larger than the limit: input_too_large", async () => {
    const box = await sandbox();
    await writeFile(path.join(box.base, "big.json"), "x".repeat(MAX_INPUT_FILE_BYTES + 1), "utf8");
    hinted(await box.run(["run", "--task", "big.json"]), "invalid_task", "input_too_large");
  });

  test("a task file inside the workspace: input_inside_workspace", async () => {
    const box = await sandbox();
    await writeFile(path.join(box.base, "ws", "task.json"), JSON.stringify({ ...TASK, workspaceRoot: "." }), "utf8");
    await writeFile(path.join(box.base, "script.json"), JSON.stringify({ schemaVersion: 1, steps: [{ text: "done" }] }), "utf8");
    hinted(await box.run(["run", "--task", "ws/task.json"]), "invalid_task", "input_inside_workspace");
  });

  test("--profile without a config file: profile_needs_config; a profile the file lacks: profile_not_found", async () => {
    const box = await sandbox();
    hinted(await box.run(["run", "--workspace", "ws", "--goal", "g", "--profile", "fast"]), "invalid_config", "profile_needs_config");
    await writeFile(path.join(box.base, "config.json"), JSON.stringify(CONFIG), "utf8");
    hinted(await box.run(["run", "--workspace", "ws", "--goal", "g", "--config", "config.json", "--profile", "fast"]), "invalid_config", "profile_not_found");
  });

  test("a task type neither built in nor in the config: task_type_not_found (invalid_task when the task file names it)", async () => {
    const box = await sandbox();
    await writeFile(path.join(box.base, "script.json"), JSON.stringify({ schemaVersion: 1, steps: [{ text: "done" }] }), "utf8");
    await writeFile(path.join(box.base, "task.json"), JSON.stringify({ ...TASK, workflowRef: "nosuch" }), "utf8");
    hinted(await box.run(["run", "--task", "task.json"]), "invalid_task", "task_type_not_found");
  });

  test("a key in the goal, the task file or the config file: key_in_goal, key_in_task, key_in_config", async () => {
    const box = await sandbox();
    const env = { ANTHROPIC_API_KEY: FAKE_KEY };
    hinted(await box.run(["run", "--workspace", "ws", "--goal", `use ${FAKE_KEY}`], env), "key_in_file", "key_in_goal");
    await writeFile(path.join(box.base, "task.json"), JSON.stringify({ ...TASK, goal: FAKE_KEY }), "utf8");
    hinted(await box.run(["run", "--task", "task.json"], env), "key_in_file", "key_in_task");
    await writeFile(path.join(box.base, "config.json"), JSON.stringify({ ...CONFIG, note: FAKE_KEY }), "utf8");
    hinted(await box.run(["run", "--workspace", "ws", "--goal", "g", "--config", "config.json"], env), "key_in_file", "key_in_config");
  });

  // A key field's name (apiKey, token, ...) is never a schema field name, so toSchemaFieldPath does not
  // take its place: the contract's plain key_in_task / key_in_config, without a field (no detail).
  // key_field_in_* is for a key value found at a schema field path by the JSON scan.
  test("a key field in the task or config file: key_in_task / key_in_config, since its place is no schema field path", async () => {
    const box = await sandbox();
    await writeFile(path.join(box.base, "task.json"), JSON.stringify({ ...TASK, model: { ...TASK.model, apiKey: "x" } }), "utf8");
    const task = await box.run(["run", "--task", "task.json"]);
    hinted(task, "key_in_file", "key_in_task");
    assert.equal(detailOf(task), undefined);
    await writeFile(path.join(box.base, "config.json"), JSON.stringify({ ...CONFIG, apiKey: "x" }), "utf8");
    const config = await box.run(["run", "--workspace", "ws", "--goal", "g", "--config", "config.json"]);
    hinted(config, "key_in_file", "key_in_config");
    assert.equal(detailOf(config), undefined);
  });

  test("settings not set: provider_settings_missing with each missing setting, in order; the message as before", async () => {
    const box = await sandbox();
    await writeFile(path.join(box.base, "task.json"), JSON.stringify({ ...TASK, model: { provider: "anthropic" }, limits: { ...TASK.limits, maxTotalTokens: 100_000 } }), "utf8");
    const output = await box.run(["run", "--task", "task.json"]);
    hinted(
      output,
      "provider_not_configured",
      "provider_settings_missing",
      "not set: ANTHROPIC_API_KEY; the model (task model.model, CODARYN_MODEL or config model); maxOutputTokens (task model.maxOutputTokens or config maxOutputTokens). Nothing was sent",
    );
    assert.deepEqual(detailOf(output), {
      missing: [
        { setting: "key", keyEnv: "ANTHROPIC_API_KEY" },
        { setting: "model", modelEnv: "CODARYN_MODEL", field: "model", placeholder: false },
        { setting: "output_limit", field: "maxOutputTokens" },
      ],
    });
  });

  test("an unknown option of run: the error carries unknown_option and its position under the detail key", async () => {
    const box = await sandbox();
    const output = await box.run(["run", "--task", "t.json", "--bogus"]);
    hinted(output, "invalid_arguments", "unknown_option");
    assert.deepEqual(detailOf(output), { position: 3 });
    assert.equal(jsonLine(output).includes("position"), false, "the position is not in the JSON line");
  });
});
