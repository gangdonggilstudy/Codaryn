/**
 * DR-43 (a), review R-31 L-2: a given list of verifiers is added to a workflow definition's own
 * checks instead of replacing them, in the quick form (the profile's or the config's list) and in a
 * task file that names a workflow (its own list). A given verifier with one of the definition's ids
 * that is not the same check is left out and told (verifiers_dropped), on the task for the record,
 * in doctor's commands check and in the progress lines. Before the change the quick form used the
 * definition's only when the config had none (given ?? definition) and a task file ignored them.
 * Fake values; a stand-in assembly captures the task, so nothing runs and nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV } from "../../../src/contracts/index.js";
import type { DoctorOutput, JournalEvent, ResolvedTaskSpec, VerifierConfig } from "../../../src/contracts/index.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import { narrowingLines } from "../../../src/cli/progress.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const LIMITS = { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 1000, maxDurationMs: 60_000 };
const ANTHROPIC_VALUE = ["fake", "dr43", "anthropic", "value", "0001"].join("-");

const exists = (id: string, file: string): VerifierConfig => ({ id, kind: "file_rules", rules: [{ type: "exists", path: file }] });
const OWN = exists("w1-must", "must.txt");
const OWN_COMMAND: VerifierConfig = { id: "w1-node", kind: "command", executable: "node", args: ["--version"] };
const SEED = exists("seed", "seed.txt");
const CLASH = exists("w1-must", "other.txt");
const workflows = (verifiers: readonly VerifierConfig[]) => ({ w1: { tools: ["read_file", "search_files", "write_file"], verifiers } });

async function base(config: Record<string, unknown>): Promise<{ dir: string; ws: string; configPath: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "codaryn-g-dr43-verifiers-"));
  temporaryDirs.push(dir);
  const ws = path.join(dir, "ws");
  await mkdir(ws);
  const configPath = path.join(dir, "config.json");
  await writeFile(configPath, JSON.stringify({ schemaVersion: 1, model: "claude-x", maxOutputTokens: 100, limits: LIMITS, ...config }), "utf8");
  return { dir, ws, configPath };
}

async function writeTask(dir: string, task: Record<string, unknown>): Promise<string> {
  const file = path.join(dir, "task.json");
  const spec = { schemaVersion: 1, id: "dr43v", goal: "g", workflow: "label", workspaceRoot: "./ws", model: { provider: "anthropic" }, policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false }, privacy: { secretEnv: [] }, limits: LIMITS, verifiers: [], ...task };
  await writeFile(file, JSON.stringify(spec), "utf8");
  return file;
}

/** The task the run would start with: the quick form with --workflow w1, or a task file (`task`). */
async function startedTask(config: Record<string, unknown>, task: Record<string, unknown> | null = null): Promise<ResolvedTaskSpec> {
  const { dir, ws, configPath } = await base(config);
  const argv =
    task === null
      ? ["run", "--workspace", ws, "--goal", "g", "--workflow", "w1", "--config", configPath, "--quiet"]
      : ["run", "--task", await writeTask(dir, task), "--config", configPath, "--quiet"];
  let captured: ResolvedTaskSpec | null = null;
  const outcome = await runCli({
    argv,
    env: { [ANTHROPIC_API_KEY_ENV]: ANTHROPIC_VALUE },
    cwd: dir,
    readFile: (file) => readFile(file, "utf8"),
    isDirectory: async (folder) => (await stat(folder).catch(() => null))?.isDirectory() ?? false,
    loadEnvFile: () => {},
    locateInWorkspace: (file, root) => locateInWorkspace(file, root),
    relatePaths: (target, root) => relateRealPaths(target, root),
    clock: { now: () => Date.now() },
    randomBytes: (size) => new Uint8Array(size).fill(13),
    createAnthropicProvider: () => ({ name: "anthropic", complete: async () => ({ ok: false, kind: "api_error", message: "unused" }) }),
    assemble: async (input) => {
      captured = input.task;
      return { ok: false, code: "internal_error", message: "stopped by the test" };
    },
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
  });
  assert.ok(captured !== null, JSON.stringify(outcome.output));
  return captured;
}

const ids = (task: ResolvedTaskSpec): string[] => task.verifiers.map((verifier) => verifier.id);

describe("DR-43 (a): the quick form adds the config's verifiers to the workflow's own", () => {
  test("R-31 L-2: a configured verifier no longer takes the workflow's check away", async () => {
    const task = await startedTask({ workflows: workflows([OWN]), verifiers: [SEED] });
    assert.deepEqual(ids(task), ["w1-must", "seed"]);
    assert.equal(task.policyNarrowings, undefined);
  });

  test("an empty configured list removes none of the workflow's checks", async () => {
    const task = await startedTask({ workflows: workflows([OWN]), verifiers: [] });
    assert.deepEqual(ids(task), ["w1-must"]);
  });

  test("the profile's list is the given one", async () => {
    const { dir, ws, configPath } = await base({ workflows: workflows([OWN]), verifiers: [exists("config-only", "c.txt")], profiles: { p: { workflowRef: "w1", verifiers: [SEED] } } });
    let captured: ResolvedTaskSpec | null = null;
    await runCli({
      argv: ["run", "--workspace", ws, "--goal", "g", "--profile", "p", "--config", configPath, "--quiet"],
      env: { [ANTHROPIC_API_KEY_ENV]: ANTHROPIC_VALUE },
      cwd: dir,
      readFile: (file) => readFile(file, "utf8"),
      isDirectory: async (folder) => (await stat(folder).catch(() => null))?.isDirectory() ?? false,
      loadEnvFile: () => {},
      locateInWorkspace: (file, root) => locateInWorkspace(file, root),
      relatePaths: (target, root) => relateRealPaths(target, root),
      clock: { now: () => Date.now() },
      randomBytes: (size) => new Uint8Array(size).fill(13),
      createAnthropicProvider: () => ({ name: "anthropic", complete: async () => ({ ok: false, kind: "api_error", message: "unused" }) }),
      assemble: async (input) => {
        captured = input.task;
        return { ok: false, code: "internal_error", message: "stopped by the test" };
      },
      cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    });
    assert.ok(captured !== null);
    assert.deepEqual(ids(captured), ["w1-must", "seed"]);
  });

  test("a configured verifier with the workflow's id and another check is left out and told", async () => {
    const task = await startedTask({ workflows: workflows([OWN]), verifiers: [CLASH, SEED] });
    assert.deepEqual(ids(task), ["w1-must", "seed"]);
    assert.deepEqual(task.verifiers[0], OWN);
    assert.deepEqual(task.policyNarrowings, [{ kind: "verifiers_dropped", count: 1 }]);
  });

  test("the same check under the workflow's id is not counted", async () => {
    const task = await startedTask({ workflows: workflows([OWN]), verifiers: [OWN, SEED] });
    assert.deepEqual(ids(task), ["w1-must", "seed"]);
    assert.equal(task.policyNarrowings, undefined);
  });
});

describe("DR-43 (a): a task file naming a workflow adds its own verifiers to the workflow's", () => {
  test("its own list is added", async () => {
    const task = await startedTask({ workflows: workflows([OWN]) }, { workflowRef: "w1", verifiers: [SEED] });
    assert.deepEqual(ids(task), ["w1-must", "seed"]);
  });

  test("an empty own list keeps the workflow's check", async () => {
    const task = await startedTask({ workflows: workflows([OWN]) }, { workflowRef: "w1", verifiers: [] });
    assert.deepEqual(ids(task), ["w1-must"]);
  });

  test("an id clash is left out and told, with the policy's narrowings in one list", async () => {
    const task = await startedTask({ workflows: workflows([OWN]) }, { workflowRef: "w1", verifiers: [CLASH] });
    assert.deepEqual(ids(task), ["w1-must"]);
    assert.deepEqual(task.verifiers[0], OWN);
    assert.deepEqual(task.policyNarrowings, [{ kind: "verifiers_dropped", count: 1 }]);
  });

  test("a task file naming no workflow keeps its own verifiers as they are (holds today)", async () => {
    const task = await startedTask({ workflows: workflows([OWN]) }, { verifiers: [SEED] });
    assert.deepEqual(ids(task), ["seed"]);
  });
});

describe("DR-43 (a): doctor and the progress lines", () => {
  async function commandsCheck(config: Record<string, unknown>, argv: readonly string[]): Promise<{ status: string; text: unknown; notes: unknown }> {
    const { dir, ws, configPath } = await base(config);
    const outcome = await runDoctor({
      argv: ["doctor", "--config", configPath, "--workspace", ws, ...argv, "--json"],
      env: { [ANTHROPIC_API_KEY_ENV]: ANTHROPIC_VALUE },
      cwd: dir,
      nodeVersion: "26.0.0",
      readFile: (file) => readFile(file, "utf8"),
      isDirectory: async (folder) => (await stat(folder).catch(() => null))?.isDirectory() ?? false,
      isFile: async (file) => (await stat(file).catch(() => null))?.isFile() ?? false,
      locateInWorkspace: (file, root) => locateInWorkspace(file, root),
      relatePaths: (target, root) => relateRealPaths(target, root),
    });
    assert.ok("text" in outcome, JSON.stringify(outcome));
    const check = (JSON.parse(outcome.text) as DoctorOutput).checks.find((entry) => entry.id === "commands");
    return { status: check?.status ?? "", text: check?.text, notes: check?.notes };
  }

  test("doctor checks the workflow's command verifier although the profile gives its own list", async () => {
    const check = await commandsCheck({ workflows: workflows([OWN_COMMAND]), profiles: { p: { workflowRef: "w1", verifiers: [SEED] } } }, ["--profile", "p"]);
    assert.notDeepEqual(check.text, { id: "doctor.commands.none" }, JSON.stringify(check));
  });

  test("doctor notes a verifier left out", async () => {
    const check = await commandsCheck({ workflows: workflows([OWN]), profiles: { p: { workflowRef: "w1", verifiers: [CLASH] } } }, ["--profile", "p"]);
    assert.deepEqual(check.notes, [{ id: "doctor.workflow_policy.verifiers_dropped", params: { count: 1 } }]);
  });

  test("the English progress line names a verifier left out", () => {
    const event = {
      type: "run_started",
      schemaVersion: 1,
      taskId: "t",
      workflow: "w",
      provider: "scripted",
      limits: LIMITS,
      policyNarrowings: [{ kind: "verifiers_dropped", count: 1 }],
    } as unknown as JournalEvent;
    assert.deepEqual(narrowingLines(event), ["the task type's own checks leave out checks given in the config or task with the same id: 1"]);
  });
});
