/**
 * U-305 (ne-verify's R-116 I-2): the GUI carried out a run plan (a changes plan) only on the way that
 * succeeds in a test (the smoke's runPlanApply). R-116's probe drove the engine host's own run registry
 * with the real app layer, as the window starts things: a plan run, then the apply of its plan. This file
 * pins, through the same registry and the real app (the root build, a local fake API, a sandbox), the
 * ways such an apply ends otherwise:
 * - the plan is stale (a person changed a planned file): failed/plan_stale, nothing written;
 * - the workspace is locked by a live process: the start is refused with workspace_locked, no line;
 * - cancelled while its run waits for the model: cancelled/cancelled, nothing written;
 * - a permission question during it, answered "deny" as the main process passes the answer on: the
 *   command does not run and the run goes on to its end.
 * It asserts what the window gets (the start's answer, the question and done lines, the outcome's
 * status and reason) and the files, not how many progress items there are, so it holds across the
 * migration's switch of the apply to the app's run lifetime (C-6b, U-300). No product code changes.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createRunRegistry } from "../../src/engine-host/runs.js";

// This file runs as gui/build/tests/unit/u305-run-plan-apply-ends.test.js.
const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const DIST = path.join(GUI, "..", "dist");
const load = async <T>(...parts: string[]): Promise<T> => (await import(pathToFileURL(path.join(DIST, ...parts)).href)) as T;

type Reply = unknown;
interface Sandbox {
  readonly base: string;
  readonly workspace: string;
}
const fake = await load<{
  startFakeAnthropic(t: TestContext, steps: readonly Reply[]): Promise<{ readonly url: string; readonly requests: readonly unknown[] }>;
  replyTools(blocks: readonly unknown[]): Reply;
  replyText(text: string): Reply;
  toolUse(id: string, name: string, input: Readonly<Record<string, unknown>>): unknown;
  HANG: Reply;
}>("tests", "support", "fake-anthropic.js");
const cli = await load<{ cliEnv(options: { fakeApiKey?: string; extra?: Record<string, string> }): NodeJS.ProcessEnv; lockPath(workspace: string): string }>("tests", "support", "cli.js");
const builders = await load<{ createSandbox(t: TestContext): Sandbox; writeWorkspaceFile(sandbox: Sandbox, relativePath: string, data: string): string }>("tests", "fixtures", "builders.js");
const anthropic = await load<{ fakeApiConfig(url: string, overrides: Record<string, unknown>): object; writeConfigFile(sandbox: Sandbox, config: object): string }>("tests", "fixtures", "anthropic.js");
const secrets = await load<{ FAKE_API_KEY: string }>("tests", "fixtures", "secrets.js");
const appModule = await load<{
  createCodarynApp(environment: unknown): { startRun(request: unknown, observer: unknown): Promise<unknown>; applyPlan(request: unknown, observer: unknown): Promise<unknown> };
  createNodeAppEnvironment(): Promise<Record<string, unknown>> | Record<string, unknown>;
}>("src", "app", "index.js");

const NODE = process.execPath;
const OLD = "old guide\n";
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const FILES = [{ path: "docs/guide.md", change: "modify" }, { path: "docs/new.md", change: "create" }];
const PLAN_REPLIES = [
  fake.replyTools([fake.toolUse("toolu_read", "read_file", { path: "docs/guide.md" })]),
  fake.replyTools([fake.toolUse("toolu_plan", "propose_changes", { summary: "rewrite the guide, add a page", files: FILES })]),
];
const WRITES = [
  fake.replyTools([fake.toolUse("toolu_guide", "write_file", { path: "docs/guide.md", expectedHash: sha256(OLD), change: { kind: "replace_all", content: "new guide\n" } })]),
  fake.replyTools([fake.toolUse("toolu_new", "write_file", { path: "docs/new.md", expectedHash: null, change: { kind: "replace_all", content: "new page\n" } })]),
  fake.replyText("complete"),
];
const ASKED = fake.replyTools([fake.toolUse("toolu_ask", "run_command", { executable: NODE, args: ["-e", "require('fs').writeFileSync('ran.txt','')"] })]);

type Line = { readonly type: string; readonly run?: string; readonly question?: { readonly id: string }; readonly outcome?: { readonly ok: boolean; readonly code?: string; readonly result?: Record<string, unknown> } };

/** A workspace with a guide, the real app on it (fake API with `carry` after the plan run's replies) and the registry the window's host builds. */
async function setUp(t: TestContext, carry: readonly Reply[]) {
  const sb = builders.createSandbox(t);
  builders.writeWorkspaceFile(sb, "docs/guide.md", OLD);
  const api = await fake.startFakeAnthropic(t, [...PLAN_REPLIES, ...carry]);
  const config = anthropic.writeConfigFile(
    sb,
    anthropic.fakeApiConfig(api.url, {
      language: "en",
      model: "fake-model",
      maxRetries: 0,
      limits: { maxModelTurns: 8, maxToolCalls: 24, maxTotalTokens: 200000, maxDurationMs: 60000 },
      policy: { commands: [{ executable: NODE, argsPrefix: ["-e"], allowExtraArgs: true, confirm: true }], network: "deny", destructive: "deny", restorePathTokens: false },
      workflows: { rewrite: { tools: ["read_file", "search_files", "write_file", "propose_changes", "run_command"], plan: "run" } },
    }),
  );
  const appData = path.join(sb.base, "appdata");
  const env = cli.cliEnv({ fakeApiKey: secrets.FAKE_API_KEY, extra: { CODARYN_CONFIG: config, CODARYN_LANG: "en", APPDATA: appData, XDG_CONFIG_HOME: appData } });
  const app = appModule.createCodarynApp({ ...(await appModule.createNodeAppEnvironment()), env, cwd: sb.base, homeDir: null });
  const lines: Line[] = [];
  const doneFor = new Map<string, (line: Line) => void>();
  let tokens = 0;
  const registry = createRunRegistry({
    startRun: (request, observer) => app.startRun(request, observer),
    applyPlan: (request, observer) => app.applyPlan(request, observer),
    itemOf: (event) => {
      const e = event as { kind?: unknown; record?: { type?: unknown } };
      return e.kind === "record" ? { at: null, kind: String(e.record?.type), text: "" } : null;
    },
    shown: (text) => text,
    token: () => `token${(tokens += 1)}`.padEnd(32, "0"),
    write: (text) => {
      const line = JSON.parse(text) as Line;
      lines.push(line);
      // The person's answer, as the main process passes it on: deny.
      if (line.type === "question" && line.run !== undefined && line.question !== undefined) {
        const { run, question } = line;
        setTimeout(() => registry.answer(run, question.id, "deny"), 10);
      }
      if (line.type === "done" && line.run !== undefined) doneFor.get(line.run)?.(line);
    },
    log: () => undefined,
    flushMs: 5,
  });
  const finished = (token: string): Promise<Line> => new Promise((resolve) => doneFor.set(token, resolve));
  // The plan run, as the window starts it, and its changes plan.
  const planStart = (await registry.start({ workspace: sb.workspace, goal: "rewrite the guide", profile: null, workflowRef: "rewrite" })) as { ok: boolean; run: string };
  assert.ok(planStart.ok, JSON.stringify(planStart));
  const planDone = await finished(planStart.run);
  const result = planDone.outcome?.result ?? {};
  assert.equal(result["reason"], "plan_pending", "the plan run waits for its plan's approval");
  const plan = result["plan"] as { digest: string; kind: string };
  assert.equal(plan.kind, "changes");
  const apply = async (): Promise<{ ok: boolean; run?: string; code?: string }> =>
    (await registry.startApply({ workspace: sb.workspace, profile: null, workflowRef: "rewrite", planRunId: String(result["runId"]), digest: plan.digest.slice(0, 12), consent: false })) as { ok: boolean; run?: string; code?: string };
  const file = (relative: string): string | null => (existsSync(path.join(sb.workspace, relative)) ? readFileSync(path.join(sb.workspace, relative), "utf8") : null);
  return { sb, api, registry, lines, finished, apply, file };
}

test("U-305 (R-116 I-2): a stale run plan's apply ends failed/plan_stale and writes nothing", { timeout: 60_000 }, async (t) => {
  const w = await setUp(t, WRITES);
  writeFileSync(path.join(w.sb.workspace, "docs", "guide.md"), "changed by a person\n");
  const started = await w.apply();
  assert.ok(started.ok && started.run !== undefined, JSON.stringify(started));
  const done = await w.finished(started.run);
  assert.equal(done.outcome?.ok, true, JSON.stringify(done.outcome));
  assert.deepEqual([done.outcome?.result?.["status"], done.outcome?.result?.["reason"]], ["failed", "plan_stale"]);
  assert.equal(w.file("docs/guide.md"), "changed by a person\n", "the person's text stays");
  assert.equal(w.file("docs/new.md"), null, "nothing of the plan was written");
});

test("U-305 (R-116 I-2): a run plan's apply on a workspace another live process locks is refused, with no line", { timeout: 60_000 }, async (t) => {
  const w = await setUp(t, WRITES);
  const holder = spawn(NODE, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore", windowsHide: true });
  try {
    writeFileSync(cli.lockPath(w.sb.workspace), JSON.stringify({ pid: holder.pid, runId: "20261114T000000Z-0a0a0a0a", startedAt: "2026-11-14T00:00:00.000Z" }));
    const before = w.lines.length;
    const started = await w.apply();
    assert.deepEqual(started, { ok: false, code: "workspace_locked" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(w.lines.slice(before), [], "no line goes to the main process for a refused start");
    assert.equal(w.file("docs/guide.md"), OLD);
    assert.equal(w.file("docs/new.md"), null);
  } finally {
    holder.kill();
  }
});

test("U-305 (R-116 I-2): a run plan's apply cancelled while its run waits for the model ends cancelled and writes nothing", { timeout: 60_000 }, async (t) => {
  const w = await setUp(t, [fake.HANG]);
  const asked = w.api.requests.length;
  const started = await w.apply();
  assert.ok(started.ok && started.run !== undefined, JSON.stringify(started));
  // Cancelled once its run's model request reached the fake API (which never answers it).
  for (let waited = 0; w.api.requests.length === asked && waited < 30_000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(w.api.requests.length > asked, "the carrying run asked the model");
  assert.equal(w.registry.cancel(started.run), true);
  const done = await w.finished(started.run);
  assert.equal(done.outcome?.ok, true, JSON.stringify(done.outcome));
  assert.deepEqual([done.outcome?.result?.["status"], done.outcome?.result?.["reason"]], ["cancelled", "cancelled"]);
  assert.equal(w.file("docs/guide.md"), OLD);
  assert.equal(w.file("docs/new.md"), null);
});

test("U-305 (R-116 I-2): a permission question during a run plan's apply, answered deny, keeps the command from running", { timeout: 60_000 }, async (t) => {
  const w = await setUp(t, [ASKED, ...WRITES]);
  const started = await w.apply();
  assert.ok(started.ok && started.run !== undefined, JSON.stringify(started));
  const done = await w.finished(started.run);
  const own = w.lines.filter((line) => line.run === started.run);
  assert.ok(own.some((line) => line.type === "question"), "the host asked the main process");
  assert.ok(own.some((line) => line.type === "questionEnded") || own.some((line) => line.type === "done"), "the question ended");
  assert.equal(w.file("ran.txt"), null, "the denied command did not run");
  assert.equal(done.outcome?.ok, true, JSON.stringify(done.outcome));
  assert.equal(done.outcome?.result?.["status"], "needs-input", "the run went on to its end (no verifier)");
  assert.equal(w.file("docs/guide.md"), "new guide\n", "the planned writes after the question were made");
  assert.equal(w.file("docs/new.md"), "new page\n");
  const confirmations = done.outcome?.result?.["confirmations"] as { user?: number } | undefined;
  assert.equal(confirmations?.user, 1, "the person's deny is counted as the window shows it");
});
