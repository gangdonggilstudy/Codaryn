/**
 * G-sec (U-274; GS-7, GS-9, standalone-gui 4.2): the real engine host process (build/src/engine-host,
 * started by the main process's own client) with the real engine (the root build, dist/src), and the
 * real CLI, on scripted task files: no model API, nothing sent anywhere (the host's test transport).
 * The default config locations point into the test folder.
 * - GS-9: the run log the window gets names the task-type tools a run called (inspect_files,
 *   propose_plan) by the engine catalog's labels, one line each, and shows a model-given name that no
 *   tool has as "(unknown tool)", never as given (U-250 kept the task-type names; before, they too
 *   read "(unknown tool)"); the run's events page shows them so too. Every item passes the main
 *   process's own check (parseRunItems), and the run's end its toRunResultView.
 * - GS-7: one workspace, one run: while a run the GUI's host started holds the workspace, the CLI's
 *   run of another task there ends as workspace_locked (exit 6); while a CLI run holds it, the
 *   host's start ends as workspace_locked, and that reaches the window as its code
 *   (toStartFailure). Each holding run is then cancelled through its own channel (the host's
 *   cancelRun, the CLI's cancel file): no process is ended by its pid, and no lock is left.
 * Written by a session that did not implement the GUI.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startEngineHost } from "../../src/main/engine-client.js";
import type { EngineHost } from "../../src/main/engine-client.js";
import { hostEnvironment } from "../../src/main/environment.js";
import { toRunResultView, toStartFailure } from "../../src/shared/ipc.js";
import { parseRunItems } from "../../src/shared/protocol.js";
import type { HostRunItem, HostRunMessage } from "../../src/shared/protocol.js";

const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const HOST_SCRIPT = path.join(GUI, "build", "src", "engine-host", "main.js");
const ENGINE_DIR = path.join(GUI, "..", "dist", "src");
const CLI = path.join(ENGINE_DIR, "cli", "main.js");
const ENGINE_BUILT = existsSync(path.join(ENGINE_DIR, "app", "index.js"));
const skip = !ENGINE_BUILT && "the engine is not built (npm run build in the root)";

/**
 * The host's and the CLI's environment: no key or Codaryn variable of this machine (so no CODARYN_CONFIG:
 * one naming a missing file cannot be read), and the default config locations in `dir`, where there is none.
 */
function isolatedEnv(dir: string): Record<string, string> {
  const env = hostEnvironment(process.env);
  for (const name of Object.keys(env)) if (/^(ANTHROPIC_API_KEY|OPENAI_API_KEY|CODARYN_[A-Z0-9_]+)$/i.test(name)) delete env[name];
  return { ...env, APPDATA: dir, LOCALAPPDATA: dir, XDG_CONFIG_HOME: dir, HOME: dir, USERPROFILE: dir };
}

/** A scripted task over `dir`/work with `steps`; the task file's absolute path. */
async function taskFile(dir: string, name: string, steps: readonly unknown[], extra: Record<string, unknown> = {}): Promise<string> {
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

interface Host {
  readonly host: EngineHost;
  readonly items: HostRunItem[];
  readonly done: Promise<unknown>;
}

/** The real host, with its run messages collected (each events message checked as the main process checks it). */
async function startHost(dir: string): Promise<Host> {
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

const within = <T>(promise: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`gsec: ${what} took more than ${ms} ms`)), ms))]);

async function waitFor(check: () => Promise<boolean>, what: string, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`gsec: ${what} did not happen within ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** The real CLI with the isolated environment; its exit code and stdout's last JSON line. */
function cli(dir: string, args: readonly string[]): { readonly ended: Promise<{ code: number | null; json: Record<string, unknown> | null }> } {
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

const lockFile = (dir: string): string => path.join(dir, "work", ".codaryn", "lock.json");
const exists = async (file: string): Promise<boolean> => (await fs.stat(file).catch(() => null)) !== null;
/** A model step that waits long, until the run is cancelled. */
const WAIT = { text: "waiting", delayMs: 60_000 };
/** A tool name no tool list has, as a model could write it. */
const MADE_UP = "gsec_made_up_tool";

describe("G-sec: the real engine host process and the real CLI", () => {
  test("GS-9: the run log names the task-type tools by their labels, a name no tool has reads (unknown tool), the events page too", { skip, timeout: 120_000 }, async () => {
    const { EN_MESSAGES } = (await import(pathToFileURL(path.join(ENGINE_DIR, "i18n", "en.js")).href)) as { EN_MESSAGES: Record<string, string> };
    const [INSPECT, PROPOSE, UNKNOWN] = ["tool.inspect_files", "tool.propose_plan", "progress.unknown_tool"].map((key) => EN_MESSAGES[key] ?? "");
    assert.deepEqual([INSPECT, PROPOSE, UNKNOWN].map((label) => label!.length > 0), [true, true, true], "the catalog has the three labels");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gsec-host-"));
    const { host, items, done } = await startHost(dir);
    try {
      await fs.mkdir(path.join(dir, "work"), { recursive: true });
      await fs.writeFile(path.join(dir, "work", "a.txt"), "alpha\n", "utf8");
      const steps = [
        { toolCalls: [{ name: "inspect_files", args: { path: "." } }] },
        { toolCalls: [{ name: MADE_UP, args: {} }] },
        { toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] },
        { text: "done" },
      ];
      const task = await taskFile(dir, "organize", steps, { workflowRef: "organize", policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move"] } });
      const answer = await host.call("startTaskRun", { taskPath: task, varsFile: null, language: "en" }, 60_000);
      assert.ok(answer.ok, JSON.stringify(answer));
      const value = answer.value as { ok: boolean; runId?: string };
      assert.equal(value.ok, true, JSON.stringify(value));
      const outcome = await within(done, 60_000, "the run");
      assert.equal(toRunResultView(outcome).ok, true, `the main process takes the run's end: ${JSON.stringify(outcome).slice(0, 300)}`);

      const lines = items.map((item) => item.text);
      const log = lines.join("\n");
      const starting = (from: readonly string[], label: string) => from.filter((line) => line.startsWith(`${label} `));
      // The organize tools were offered and ran: their lines are not unknown_tool refusals.
      for (const label of [INSPECT!, PROPOSE!]) {
        assert.equal(starting(lines, label).length, 1, `one line for ${label}:\n${log}`);
        assert.equal(starting(lines, label)[0]!.includes("unknown_tool"), false, `${label} ran:\n${log}`);
      }
      assert.equal(starting(lines, UNKNOWN!).length, 1, `only the made-up name reads ${UNKNOWN}:\n${log}`);
      assert.equal(log.includes(MADE_UP), false, "the model-given name is never shown as given");

      const page = await host.call("runEvents", { workspace: await fs.realpath(path.join(dir, "work")), profile: null, workflowRef: "organize", runId: value.runId, offset: 0, language: "en" }, 60_000);
      assert.ok(page.ok, JSON.stringify(page));
      const pageValue = page.value as { ok: boolean; items?: unknown };
      assert.equal(pageValue.ok, true, JSON.stringify(pageValue).slice(0, 300));
      const pageItems = parseRunItems(pageValue.items);
      assert.ok(pageItems !== null, `the main process takes the page's items: ${JSON.stringify(pageValue).slice(0, 300)}`);
      const pageLines = pageItems.map((item) => item.text);
      for (const label of [INSPECT!, PROPOSE!, UNKNOWN!]) assert.equal(starting(pageLines, label).length, 1, `the events page: one line for ${label}:\n${pageLines.join("\n")}`);
      assert.equal(JSON.stringify(page.value).includes(MADE_UP), false, "the events page never shows the model-given name");
    } finally {
      await host.close();
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  test("GS-7: a run the GUI's host started holds the workspace: the CLI's run there ends as workspace_locked", { skip, timeout: 120_000 }, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gsec-host-"));
    const { host, done } = await startHost(dir);
    try {
      const holding = await taskFile(dir, "holding", [WAIT]);
      const other = await taskFile(dir, "other", [{ text: "done" }]);
      const answer = await host.call("startTaskRun", { taskPath: holding, varsFile: null, language: "en" }, 60_000);
      const value = (answer as { value?: { ok: boolean; run?: string } }).value;
      assert.equal(value?.ok, true, JSON.stringify(answer));
      await waitFor(() => exists(lockFile(dir)), "the GUI's run taking the lock");

      const refused = await within(cli(dir, ["run", "--task", other, "--json"]).ended, 60_000, "the CLI's run");
      assert.deepEqual([refused.code, refused.json?.["code"]], [6, "workspace_locked"], JSON.stringify(refused));

      const cancelled = await host.call("cancelRun", { run: value!.run }, 10_000);
      assert.deepEqual((cancelled as { value?: unknown }).value, { ok: true });
      const outcome = (await within(done, 60_000, "the GUI's run ending")) as { result?: { status?: string } };
      assert.equal(outcome.result?.status, "cancelled", JSON.stringify(outcome).slice(0, 300));
      await waitFor(async () => !(await exists(lockFile(dir))), "the lock going");
    } finally {
      await host.close();
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  test("GS-7: a CLI run holds the workspace: the host's start ends as workspace_locked, and the window gets that code", { skip, timeout: 120_000 }, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gsec-host-"));
    const { host } = await startHost(dir);
    const cancelFile = path.join(dir, "cancel.flag");
    let running: ReturnType<typeof cli> | null = null;
    try {
      const holding = await taskFile(dir, "holding", [WAIT]);
      const other = await taskFile(dir, "other", [{ text: "done" }]);
      running = cli(dir, ["run", "--task", holding, "--json", "--cancel-file", cancelFile]);
      await waitFor(() => exists(lockFile(dir)), "the CLI's run taking the lock");

      const answer = await host.call("startTaskRun", { taskPath: other, varsFile: null, language: "en" }, 60_000);
      assert.ok(answer.ok, JSON.stringify(answer));
      const value = answer.value as { ok: boolean; code?: string };
      assert.deepEqual([value.ok, value.code], [false, "workspace_locked"], JSON.stringify(value));
      assert.equal(toStartFailure(value).code, "workspace_locked", "the code the window gets");

      await fs.writeFile(cancelFile, "", "utf8");
      const ended = await within(running.ended, 60_000, "the CLI's run ending");
      assert.equal(ended.json?.["status"], "cancelled", JSON.stringify(ended));
      assert.equal(await exists(lockFile(dir)), false, "no lock left");
    } finally {
      // A case that failed before the cancel still ends its CLI run (through the cancel file), so no
      // run outlives the case or holds its folder.
      if (running !== null) {
        await fs.writeFile(cancelFile, "", "utf8").catch(() => undefined);
        await within(running.ended, 60_000, "the CLI's run ending after the case").catch(() => undefined);
      }
      await host.close();
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
