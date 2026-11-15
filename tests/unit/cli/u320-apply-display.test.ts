/** U-320: CLI seams kept while apply delegates its life. Real local plans; no API. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { assembleRun } from "../../../src/app/assembly.js";
import { applyChangesPlan, runApply } from "../../../src/cli/plan-commands.js";
import type { ApplyCommandEnvironment } from "../../../src/cli/plan-commands.js";
import { parseApplyArgs } from "../../../src/cli/args.js";
import { prepareFor } from "../../../src/app/plan-view.js";
import { runCli } from "../../../src/cli/run.js";
import { createHumanOutput } from "../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/app/input/security/index.js";
import { acquireLock, loadAnyPlan, releaseLock } from "../../../src/store/index.js";
import type { EngineResult } from "../../../src/contracts/index.js";
import { installFsFaults } from "../../support/fs-faults.js";

async function fixture(t: TestContext, kind: "moves" | "changes" = "moves", action: "move" | "discard" = "move") {
  const base = await mkdtemp(path.join(os.tmpdir(), "codaryn-u320-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  await mkdir(path.join(base, "work"));
  await writeFile(path.join(base, "work/a.txt"), "alpha\n");
  let now = Date.now() - 600_000;
  let seed = 71;
  const io = {
    cwd: base, env: {}, clock: { now: () => (now += 1000) },
    randomBytes: (size: number) => new Uint8Array(size).fill(seed++ % 250),
    readFile: (file: string) => readFile(file, "utf8"),
    isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
    loadEnvFile: () => {},
    locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
    relatePaths: (target: string, root: string) => relateRealPaths(target, root),
    cancelSignal: () => ({ signal: new AbortController().signal, dispose() {} }),
  };
  const task = {
    schemaVersion: 1, id: "u320-plan", goal: "Make the planned change.", workflow: "u320",
    workflowRef: kind === "moves" ? "organize" : "rewrite", workspaceRoot: "./work",
    model: { provider: "scripted", scriptPath: "./script.json" },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: [action] },
    privacy: { secretEnv: [] },
    limits: { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
    verifiers: [],
  };
  await writeFile(path.join(base, "task.json"), JSON.stringify(task));
  await writeFile(path.join(base, "other.json"), JSON.stringify({ ...task, id: "u320-other" }));
  await writeFile(path.join(base, "config.json"), JSON.stringify({
    schemaVersion: 1, workflows: { rewrite: { tools: ["read_file", "write_file", "propose_changes"], plan: "run" } },
  }));
  const tool = kind === "moves"
    ? { name: "propose_plan", args: { summary: "Sort", actions: [action === "move" ? { kind: "move", from: "a.txt", to: "sorted/a.txt" } : { kind: "discard", path: "a.txt" }] } }
    : { name: "propose_changes", args: { summary: "Write", files: [{ path: "summary.md", change: "create" }] } };
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps: [{ toolCalls: [tool] }, { text: "planned" }] }));
  const config = kind === "moves" ? [] : ["--config", "config.json"];
  const made = await runCli({ ...io, argv: ["run", "--task", "task.json", ...config, "--quiet"], assemble: assembleRun });
  assert.equal(made.output.kind, "run");
  const plan = made.output as EngineResult;
  assert.equal(plan.reason, "plan_pending", JSON.stringify(plan));
  assert.ok(plan.plan?.digest);
  const argv = ["apply", "--task", "task.json", ...config, "--run", plan.runId];
  return { base, io, argv, digest: plan.plan.digest };
}

async function workspaceSnapshot(root: string): Promise<unknown> {
  const entries = await readdir(root, { withFileTypes: true });
  return Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(async (entry) => [
    entry.name, entry.isDirectory()
      ? await workspaceSnapshot(path.join(root, entry.name))
      : (await readFile(path.join(root, entry.name))).toString("hex"),
  ]));
}

test("U-320: direct changes helper refuses moves/discards even with an apply-mode task, without side effects", async (t) => {
  for (const action of ["move", "discard"] as const) {
    const f = await fixture(t, "moves", action);
    const argv = [...f.argv, "--digest", f.digest];
    const parsed = parseApplyArgs(argv);
    assert.ok(parsed.ok);
    const args = parsed.args;
    const ready = await prepareFor(f.io, args.form, args.runId, args.cancelFile, args.quiet);
    assert.ok(ready.ok);
    assert.equal(ready.value.prepared.task.plan, "apply");
    const before = await workspaceSnapshot(path.join(f.base, "work"));
    for (const mode of ["apply", "run"] as const) {
      let reads = 0;
      const unexpected = () => { throw new Error("must refuse before questions, assembly, or run creation"); };
      const out = await applyChangesPlan({
        ...f.io, argv, randomBytes: unexpected, ask: unexpected, writeProgress: unexpected,
        run: { ...f.io, argv: [], assemble: unexpected },
        loadAnyPlan: (input) => { reads++; return loadAnyPlan(input); },
      }, args, { ...ready.value, prepared: { ...ready.value.prepared, task: { ...ready.value.prepared.task, plan: mode } } });
      assert.deepEqual(out, { output: {
        schemaVersion: 1, kind: "error", code: "run_not_plan",
        message: 'that run made a plan of moves and discards (plan "apply"), but the task given to apply resolves to plan "run"; give the task the plan run used; nothing was run',
        exitCode: 2, category: "input", retryable: false, hint: "plan_kind_differs",
      }, exitCode: 2 });
      assert.equal(reads, 1);
      assert.deepEqual(await workspaceSnapshot(path.join(f.base, "work")), before);
    }
  }
});

test("U-320: approval ask rejection propagates unchanged, for moves and run plans", async (t) => {
  for (const kind of ["moves", "changes"] as const) {
    const f = await fixture(t, kind);
    const failure = new Error("synthetic terminal read failure");
    await assert.rejects(runApply({
      ...f.io, argv: f.argv, run: { ...f.io, argv: [], assemble: assembleRun },
      ask: async () => { throw failure; },
    }), (error) => error === failure);
  }
});

test("U-320: consent ask rejection propagates after the first summary, without a second apply", async (t) => {
  const f = await fixture(t);
  const undo = installFsFaults({ noLinksUnder: path.join(f.base, "work") });
  try {
    const failure = new Error("synthetic consent read failure");
    const order: string[] = [];
    const human = createHumanOutput(createMessageCatalog("en"));
    await assert.rejects(runApply({
      ...f.io, argv: [...f.argv, "--digest", f.digest],
      human: { ...human, applySummary(result, context) { order.push(result.reason); return human.applySummary!(result, context); } },
      writeProgress: () => {},
      ask: async () => { order.push("ask"); throw failure; },
    }), (error) => error === failure);
    assert.deepEqual(order, ["consent_required", "ask"]);
  } finally { undo.remove(); }
});

test("U-320: two apply summaries surround consent and each raw start arrives once", async (t) => {
  const f = await fixture(t);
  const undo = installFsFaults({ noLinksUnder: path.join(f.base, "work") });
  try {
    const order: string[] = [];
    const starts: string[] = [];
    const human = createHumanOutput(createMessageCatalog("en"));
    const out = await runApply({
      ...f.io, argv: [...f.argv, "--digest", f.digest],
      human: {
        ...human,
        applyProgressLine(record) { if (record.type === "apply_started") { order.push("start"); starts.push(record.type); } return human.applyProgressLine!(record); },
        applySummary(result, context) { order.push(result.reason); return human.applySummary!(result, context); },
      },
      writeProgress: () => {},
      ask: async () => { order.push("ask"); return "y"; },
    });
    assert.equal(out.exitCode, 0);
    assert.deepEqual(order, ["start", "consent_required", "ask", "start", "verified"]);
    assert.equal(starts.length, 2);
  } finally { undo.remove(); }
});

test("U-320: other-task run notice survives assembly refusal, but not rejected approval", async (t) => {
  const f = await fixture(t, "changes");
  const argv = f.argv.map((arg) => arg === "task.json" ? "other.json" : arg);
  const lines: string[] = [];
  const workspaceRoot = path.join(f.base, "work");
  const lockId = "20261114T000000Z-00000001";
  const lock = await acquireLock({ workspaceRoot, runId: lockId, clock: f.io.clock });
  assert.ok(lock.ok);
  try {
    const input = { ...f.io, run: { ...f.io, argv: [], assemble: assembleRun }, writeProgress: (line: string) => lines.push(line) };
    const refused = await runApply({ ...input, argv: [...argv, "--digest", f.digest] });
    assert.ok("output" in refused && refused.output.kind === "error");
    assert.equal(refused.output.code, "workspace_locked");
    assert.equal(lines.length, 1);
    assert.ok(lines[0]!.startsWith("codaryn: The plan was made with another task"));
    lines.length = 0;
    const badDigest = (f.digest[0] === "a" ? "b" : "a") + f.digest.slice(1);
    const notApproved = await runApply({ ...input, argv: [...argv, "--digest", badDigest] });
    assert.ok("output" in notApproved && notApproved.output.kind === "error");
    assert.equal(notApproved.output.code, "plan_not_approved");
    assert.deepEqual(lines, []);
  } finally { await releaseLock({ workspaceRoot, runId: lockId }); }
});

for (const direct of [false, true]) test(`U-320: ${direct ? "direct helper" : "runApply"} carries once, with one plan read and one drawing of each record/summary`, async (t) => {
  const f = await fixture(t, "changes");
  await writeFile(path.join(f.base, "script.json"), JSON.stringify({ schemaVersion: 1, steps: [
    { toolCalls: [{ name: "write_file", args: { path: "summary.md", expectedHash: null, change: { kind: "replace_all", content: "written\n" } } }] },
    { text: "done" },
  ] }));
  const messages = createMessageCatalog("en");
  const output = createHumanOutput(messages);
  const seen: unknown[] = [];
  let summaries = 0;
  const order: string[] = [];
  const io: ApplyCommandEnvironment = {
    ...f.io, argv: [...f.argv, "--digest", f.digest],
    loadAnyPlan: (input: Parameters<typeof loadAnyPlan>[0]) => { order.push("load"); return loadAnyPlan(input); },
    run: {
      ...f.io, argv: [],
      assemble: (input: Parameters<typeof assembleRun>[0]) => { order.push("assemble"); return assembleRun(input); },
      writeProgress: () => {},
      human: () => ({ messages, output: {
        ...output,
        progressLine(record) { seen.push(record); return output.progressLine(record); },
        runSummary(result, context) { summaries++; return output.runSummary(result, context); },
      } }),
    },
  };
  const parsed = parseApplyArgs(io.argv);
  assert.ok(parsed.ok);
  const args = parsed.args;
  const ready = await prepareFor(io, args.form, args.runId, args.cancelFile, args.quiet);
  assert.ok(ready.ok);
  const out = await (direct ? applyChangesPlan(io, args, ready.value) : runApply(io));
  assert.deepEqual(order, ["load", "assemble"]);
  assert.equal(out.exitCode, 3, JSON.stringify(out));
  assert.ok("output" in out && out.output.kind === "run");
  assert.equal(out.output.reason, "no_verifier");
  const journal = await readFile(path.join(f.base, "work/.codaryn/runs", out.output.runId, "journal.jsonl"), "utf8");
  assert.deepEqual(seen, journal.trim().split("\n").map((line) => JSON.parse(line)));
  assert.equal(summaries, 1);
  assert.equal(await readFile(path.join(f.base, "work/summary.md"), "utf8"), "written\n");
});
