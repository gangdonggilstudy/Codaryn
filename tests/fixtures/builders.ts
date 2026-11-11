/**
 * Builds an isolated sandbox per test:
 *   <tmp>/codaryn-it-XXXX/          base: task.json, script.json, cancel file, outside files
 *   <tmp>/codaryn-it-XXXX/ws/       workspace root (no Git, no package.json unless a test adds one)
 * Byte-exact fixtures (CRLF, BOM, Korean) are generated at run time so Git line ending
 * conversion can never alter them.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";
import type {
  CommandRule,
  Limits,
  ModelConfig,
  ScriptStep,
  ScriptedModelScript,
  TaskSpec,
  VerifierConfig,
} from "../../src/contracts/index.js";

export interface Sandbox {
  readonly base: string;
  readonly workspace: string;
  readonly taskPath: string;
  readonly scriptPath: string;
  readonly cancelFile: string;
}

export function createSandbox(t: TestContext): Sandbox {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "codaryn-it-")));
  const workspace = join(base, "ws");
  mkdirSync(workspace);
  t.after(() => {
    try {
      rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
      t.diagnostic(`sandbox cleanup failed (a process may still hold a file): ${String(error)}`);
    }
  });
  return {
    base,
    workspace,
    taskPath: join(base, "task.json"),
    scriptPath: join(base, "script.json"),
    cancelFile: join(base, "cancel.flag"),
  };
}

export function writeAt(root: string, relativePath: string, data: string | Uint8Array): string {
  const full = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  return full;
}

export function writeWorkspaceFile(sandbox: Sandbox, relativePath: string, data: string | Uint8Array): string {
  return writeAt(sandbox.workspace, relativePath, data);
}

export const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function withBom(text: string): Buffer {
  return Buffer.concat([UTF8_BOM, Buffer.from(text, "utf8")]);
}

export const DEFAULT_LIMITS: Limits = {
  maxModelTurns: 12,
  maxToolCalls: 24,
  maxTotalTokens: null,
  maxDurationMs: 60_000,
};

export interface TaskOptions {
  readonly id: string;
  readonly goal?: string;
  readonly workflow?: string;
  readonly commands?: readonly CommandRule[];
  readonly restorePathTokens?: boolean;
  /** Written to `policy.protectedPaths` only when given. */
  readonly protectedPaths?: readonly string[];
  readonly secretEnv?: readonly string[];
  readonly limits?: Partial<Limits>;
  readonly verifiers?: readonly VerifierConfig[];
  /** Defaults to the scripted provider with `./script.json`. */
  readonly model?: ModelConfig;
}

/**
 * Writes task.json (and script.json when steps are given) into the sandbox base.
 * Paths in the task are relative to the task file, which also exercises that rule.
 */
export function writeTask(sandbox: Sandbox, options: TaskOptions, steps?: readonly ScriptStep[]): string {
  const model: ModelConfig = options.model ?? { provider: "scripted", scriptPath: "./script.json" };
  const task: TaskSpec = {
    schemaVersion: 1,
    id: options.id,
    goal: options.goal ?? "통합 테스트 작업",
    workflow: options.workflow ?? "code",
    workspaceRoot: "./ws",
    model,
    policy: {
      commands: options.commands ?? [],
      network: "deny",
      destructive: "deny",
      restorePathTokens: options.restorePathTokens ?? false,
      ...(options.protectedPaths === undefined ? {} : { protectedPaths: options.protectedPaths }),
    },
    privacy: { secretEnv: options.secretEnv ?? [] },
    limits: { ...DEFAULT_LIMITS, ...options.limits },
    verifiers: options.verifiers ?? [],
  };
  if (steps !== undefined) {
    const script: ScriptedModelScript = { schemaVersion: 1, steps };
    writeFileSync(sandbox.scriptPath, JSON.stringify(script, null, 2));
  }
  writeFileSync(sandbox.taskPath, JSON.stringify(task, null, 2));
  return sandbox.taskPath;
}

/** Allows `node <script>` with exactly that script and, optionally, extra arguments. */
export function nodeCommand(script: string, allowExtraArgs = false): CommandRule {
  return { executable: process.execPath, argsPrefix: [script], allowExtraArgs };
}
