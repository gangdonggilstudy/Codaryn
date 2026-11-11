/**
 * Shared setup for the K1 tests: a temporary base with `work/` (the workspace), a scripted task
 * and its script, and a CliEnvironment on the real assembly. Fake values only, no network.
 */

import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after } from "node:test";
import { assembleRun } from "../../../src/cli/assemble.js";
import type { CliEnvironment } from "../../../src/cli/run.js";
import { locateInWorkspace } from "../../../src/cli/security/index.js";

export const IS_WINDOWS = process.platform === "win32";
/** Registered as a secret through CODARYN_K1_SECRET. Not key-shaped. */
export const FAKE_SECRET = "fake-secret-K1-VALUE-0007";
export const SECRET_ENV = "CODARYN_K1_SECRET";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

export async function tempDir(prefix = "codaryn-unit-k1-"): Promise<string> {
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

export const README_RULE = { id: "readme", kind: "file_rules", rules: [{ type: "contains", path: "README.md", text: "# Title" }] };

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
      id: "k1-task",
      goal: "change the workspace",
      workflow: "test",
      workspaceRoot: "./work",
      model: { provider: "scripted", scriptPath: "./script.json" },
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
      privacy: { secretEnv: [SECRET_ENV] },
      limits: { maxModelTurns: 6, maxToolCalls: 10, maxTotalTokens: null, maxDurationMs: 60_000 },
      verifiers: [README_RULE],
      ...task,
    }),
    "utf8",
  );
  return base;
}

export async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** `run --task <base>/task.json` on the real assembly. */
export function cliIo(base: string, extra: Partial<CliEnvironment> = {}): CliEnvironment {
  return {
    argv: ["run", "--task", path.join(base, "task.json")],
    env: { [SECRET_ENV]: FAKE_SECRET },
    cwd: base,
    readFile: (file) => readFile(file, "utf8"),
    isDirectory,
    loadEnvFile: () => {
      throw new Error("no variables file in this test");
    },
    locateInWorkspace: (file, root) => locateInWorkspace(file, root),
    clock: { now: () => Date.now() },
    randomBytes: (size) => randomBytes(size),
    assemble: assembleRun,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    ...extra,
  };
}
