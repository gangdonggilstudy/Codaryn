/**
 * Shared setup for the app layer tests: a temporary base with `work/` (the workspace), a scripted
 * task and its script outside it, and an AppEnvironment on the real modules.
 * Fake values only, no network, no real API.
 */

import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after } from "node:test";
import assert from "node:assert/strict";
import type { EngineResult, JournalRecord } from "../../../src/contracts/index.js";
import { createCodarynApp, readVarsFileSync } from "../../../src/app/index.js";
import type { AppEnvironment, CodarynApp, StartRunRequest, TaskForm } from "../../../src/app/index.js";

/** Registered as a secret through SECRET_ENV. Not key-shaped. */
export const FAKE_SECRET = "fake-secret-APP-VALUE-0031";
export const SECRET_ENV = "CODARYN_APP_SECRET";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

export async function tempDir(prefix = "codaryn-unit-app-"): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

export async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  );
}

export const NOTES_RULE = { id: "notes", kind: "file_rules", rules: [{ type: "contains", path: "NOTES.md", text: "# Notes" }] };

/** A model step that creates NOTES.md with `# Notes`. */
export const WRITE_NOTES = {
  toolCalls: [
    { name: "write_file", args: { path: "NOTES.md", expectedHash: null, change: { kind: "replace_all", content: "# Notes\n" } } },
  ],
};

/** base/work/<files>, base/script.json, base/task.json. Returns the base directory. */
export async function setupRun(
  files: Readonly<Record<string, string>>,
  task: Readonly<Record<string, unknown>>,
  steps: readonly unknown[],
): Promise<string> {
  const base = await tempDir();
  await mkdir(path.join(base, "work"));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(base, "work", name)), { recursive: true });
    await writeFile(path.join(base, "work", name), content, "utf8");
  }
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(
    path.join(base, "task.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "app-task",
      goal: "change the workspace",
      workflow: "test",
      workspaceRoot: "./work",
      model: { provider: "scripted", scriptPath: "./script.json" },
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
      privacy: { secretEnv: [SECRET_ENV] },
      limits: { maxModelTurns: 6, maxToolCalls: 10, maxTotalTokens: null, maxDurationMs: 60_000 },
      verifiers: [NOTES_RULE],
      ...task,
    }),
    "utf8",
  );
  return base;
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/** An install directory apart from every test workspace (U-3 passes). */
export async function installDir(): Promise<string> {
  return tempDir("codaryn-unit-app-install-");
}

export async function appEnvironment(base: string, overrides: Partial<AppEnvironment> = {}): Promise<AppEnvironment> {
  return {
    env: { [SECRET_ENV]: FAKE_SECRET },
    cwd: base,
    installDir: await installDir(),
    nodeVersion: process.versions.node,
    readFile: (file) => readFile(file, "utf8"),
    isDirectory,
    isFile,
    readVarsFile: readVarsFileSync,
    clock: { now: () => Date.now() },
    randomBytes: (size) => randomBytes(size),
    ...overrides,
  };
}

export function taskRequest(base: string, overrides: Partial<StartRunRequest> = {}): StartRunRequest {
  return {
    input: { kind: "task", taskPath: path.join(base, "task.json") },
    configPath: null,
    varsFile: null,
    profile: null,
    workflowRef: null,
    cancelFile: null,
    ...overrides,
  };
}

/** DR-17: the task form of the same task file (plan, apply, review, changes). */
export function taskForm(base: string, overrides: Partial<TaskForm> = {}): TaskForm {
  return { input: { kind: "task", taskPath: path.join(base, "task.json") }, configPath: null, varsFile: null, profile: null, workflowRef: null, ...overrides };
}

export function runDir(base: string, runId: string): string {
  return path.join(base, "work", ".codaryn", "runs", runId);
}

/** Every complete line of the run's journal, parsed. */
export async function readJournal(base: string, runId: string): Promise<JournalRecord[]> {
  const text = await readFile(path.join(runDir(base, runId), "journal.jsonl"), "utf8");
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as JournalRecord);
}

/** G-A: a task on the built-in organize workflow (plan "apply") whose script proposes one move. */
export const PLAN_TASK = {
  workflowRef: "organize",
  policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move"] },
  verifiers: [],
};

export function planSteps(from = "a.txt", to = "sorted/a.txt"): unknown[] {
  return [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from, to }] } }] }];
}

/** A plan run through the app layer that ended as plan_pending, with its digest. */
export async function plannedRun(
  files: Readonly<Record<string, string>> = { "a.txt": "alpha\n" },
  steps: readonly unknown[] = planSteps(),
): Promise<{ base: string; app: CodarynApp; plan: EngineResult; digest: string }> {
  const base = await setupRun(files, PLAN_TASK, steps);
  const app = createCodarynApp(await appEnvironment(base));
  const started = await app.startRun(taskRequest(base));
  assert.ok(started.ok, JSON.stringify(started));
  const ended = await started.handle.done;
  assert.ok(ended.ok, JSON.stringify(ended));
  assert.deepEqual([ended.result.status, ended.result.reason], ["needs-input", "plan_pending"]);
  const digest = ended.result.plan?.digest ?? "";
  assert.match(digest, /^[0-9a-f]{64}$/);
  return { base, app, plan: ended.result, digest };
}
