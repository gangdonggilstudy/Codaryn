/**
 * G-sec (U-274, U-284): what the host-process cases share (gsec-host-process.test.ts, and the
 * fixture of gsec-temp-folders.test.ts): the real engine host the main process's own client starts,
 * the real CLI, scripted task files, and an environment with no key, no Codaryn variable of this
 * machine and the default config locations in the case's folder.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startEngineHost } from "../../src/main/engine-client.js";
import type { EngineHost } from "../../src/main/engine-client.js";
import { hostEnvironment } from "../../src/main/environment.js";
import { parseRunItems } from "../../src/shared/protocol.js";
import type { HostRunItem, HostRunMessage } from "../../src/shared/protocol.js";

const GUI = fileURLToPath(new URL("../../../", import.meta.url));
export const HOST_SCRIPT = path.join(GUI, "build", "src", "engine-host", "main.js");
export const ENGINE_DIR = path.join(GUI, "..", "dist", "src");
export const CLI = path.join(ENGINE_DIR, "cli", "main.js");
export const ENGINE_BUILT = existsSync(path.join(ENGINE_DIR, "app", "index.js"));
export const skip = !ENGINE_BUILT && "the engine is not built (npm run build in the root)";

/**
 * The host's and the CLI's environment: no key or Codaryn variable of this machine (so no CODARYN_CONFIG:
 * one naming a missing file cannot be read), and the default config locations in `dir`, where there is none.
 */
export function isolatedEnv(dir: string): Record<string, string> {
  const env = hostEnvironment(process.env);
  for (const name of Object.keys(env)) if (/^(ANTHROPIC_API_KEY|OPENAI_API_KEY|CODARYN_[A-Z0-9_]+)$/i.test(name)) delete env[name];
  return { ...env, APPDATA: dir, LOCALAPPDATA: dir, XDG_CONFIG_HOME: dir, HOME: dir, USERPROFILE: dir };
}

/** A scripted task over `dir`/work with `steps`; the task file's absolute path. */
export async function taskFile(dir: string, name: string, steps: readonly unknown[], extra: Record<string, unknown> = {}): Promise<string> {
  await fs.mkdir(path.join(dir, "work"), { recursive: true });
  // A token limit needs each step's usage (the engine stops a run whose usage is unknown).
  const counted = steps.map((step) => ({ usage: { inputTokens: 1, outputTokens: 1 }, ...(step as Record<string, unknown>) }));
  await fs.writeFile(path.join(dir, `${name}-script.json`), JSON.stringify({ schemaVersion: 1, steps: counted }), "utf8");
  const file = path.join(dir, `${name}.json`);
  await fs.writeFile(
    file,
    JSON.stringify({
      schemaVersion: 1,
      id: `gsec-${name}`,
      goal: "g",
      workflow: "test",
      workspaceRoot: "./work",
      model: { provider: "scripted", scriptPath: `./${name}-script.json` },
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
      privacy: { secretEnv: [] },
      limits: { maxModelTurns: 6, maxToolCalls: 10, maxTotalTokens: 50_000, maxDurationMs: 90_000 },
      verifiers: [],
      ...extra,
    }),
    "utf8",
  );
  return file;
}

export interface Host {
  readonly host: EngineHost;
  readonly items: HostRunItem[];
  readonly done: Promise<unknown>;
}

/** The real host, with its run messages collected (each events message checked as the main process checks it). */
export async function startHost(dir: string): Promise<Host> {
  const outcome = await startEngineHost({ nodePath: process.execPath, hostScript: HOST_SCRIPT, engineDir: ENGINE_DIR, env: isolatedEnv(dir), cwd: dir, transport: "loopback-only" });
  assert.ok(outcome.ok, `the host started: ${JSON.stringify(outcome)}`);
  const items: HostRunItem[] = [];
  let ended: (value: unknown) => void = () => undefined;
  const done = new Promise<unknown>((resolve) => (ended = resolve));
  outcome.host.onRunMessage((message: HostRunMessage) => {
    if (message.type === "events") {
      const checked = parseRunItems(message.items);
      assert.ok(checked !== null, `the main process takes the run items: ${JSON.stringify(message.items).slice(0, 300)}`);
      items.push(...checked);
    }
    if (message.type === "done") ended(message.outcome);
  });
  return { host: outcome.host, items, done };
}

export const within = <T>(promise: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`gsec: ${what} took more than ${ms} ms`)), ms))]);

export async function waitFor(check: () => Promise<boolean>, what: string, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`gsec: ${what} did not happen within ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** The real CLI with the isolated environment; its exit code and stdout's last JSON line. */
export function cli(dir: string, args: readonly string[]): { readonly ended: Promise<{ code: number | null; json: Record<string, unknown> | null }> } {
  const child = spawn(process.execPath, [CLI, ...args], { cwd: dir, env: isolatedEnv(dir), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
  child.stderr.on("data", () => undefined);
  const ended = new Promise<{ code: number | null; json: Record<string, unknown> | null }>((resolve) =>
    child.once("close", (code) => {
      const last = stdout.trim().split("\n").filter((line) => line.startsWith("{")).pop();
      let json: Record<string, unknown> | null = null;
      try {
        json = last === undefined ? null : (JSON.parse(last) as Record<string, unknown>);
      } catch {
        json = null;
      }
      resolve({ code, json });
    }),
  );
  return { ended };
}

export const lockFile = (dir: string): string => path.join(dir, "work", ".codaryn", "lock.json");
export const exists = async (file: string): Promise<boolean> => (await fs.stat(file).catch(() => null)) !== null;
/** A model step that waits long, until the run is cancelled. */
export const WAIT = { text: "waiting", delayMs: 60_000 };
