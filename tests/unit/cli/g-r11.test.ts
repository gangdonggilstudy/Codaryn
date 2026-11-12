/**
 * Review R-11 (general task CLI) reproductions. Real engine, store and tools on a temporary
 * workspace; scripted model; the secret is a fake value built at run time. Nothing is sent.
 *
 * - M-1 (DR-28): plan and apply with other secrets than the plan run's showed and recorded what the
 *   plan run had masked. They must stop before anything is shown or moved. Until plan.json carries
 *   the plan run's masked notation (contract w3:p9, store w3:p6) these tests are `todo`.
 * - L-1: a workflow definition's limits are defaults, not caps; the cap is the config's (S-7).
 * - L-2: the quick form of plan, apply and review says why it needs the config's run settings.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { EngineResult } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runApply, runPlan } from "../../../src/cli/plan-commands.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 600_000;
const clock = { now: () => (now += 1000) };
let seed = 101;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);

/** A fake secret value, built at run time; a folder of the workspace is named after it. */
const SECRET = ["zz", "r11", "fake", "secret", "value", "zz"].join("-");
const ENV = { R11_SECRET: SECRET };
const LIMITS = { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 };

const io = (base: string, argv: readonly string[]) => ({
  argv,
  env: ENV,
  cwd: base,
  readFile: (file: string) => readFile(file, "utf8"),
  isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
  loadEnvFile: () => {},
  locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
  relatePaths: (target: string, root: string) => relateRealPaths(target, root),
  clock,
  randomBytes,
  cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
});

function task(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "r11",
    goal: "sort",
    workflow: "label",
    workspaceRoot: "./ws",
    model: { provider: "scripted", scriptPath: "./script.json" },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move"] },
    privacy: { secretEnv: ["R11_SECRET"] },
    limits: LIMITS,
    verifiers: [],
    workflowRef: "organize",
    ...extra,
  };
}

/** A plan run that moves `<SECRET>/a.txt`, with the secret registered by the task. */
async function planRun(): Promise<{ base: string; ws: string; planned: EngineResult }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-r11-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(path.join(ws, SECRET), { recursive: true });
  await writeFile(path.join(ws, SECRET, "a.txt"), "alpha\n", "utf8");
  const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: `${SECRET}/a.txt`, to: "sorted/a.txt" }] } }] }];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(path.join(base, "task.json"), JSON.stringify(task()), "utf8");
  // A config without the secret: what the quick form of plan and apply would read.
  await writeFile(path.join(base, "config.json"), JSON.stringify({ schemaVersion: 1, limits: LIMITS }), "utf8");
  const outcome = await runCli({ ...io(base, ["run", "--task", "task.json", "--quiet"]), assemble: assembleRun });
  assert.equal(outcome.output.kind, "run", JSON.stringify(outcome.output));
  const planned = outcome.output as EngineResult;
  assert.equal(planned.reason, "plan_pending");
  return { base, ws, planned };
}

const shows = (outcome: unknown): string => JSON.stringify(outcome);
const DR28 = "DR-28: needs the plan run's masked notation in plan.json (contract w3:p9, store w3:p6)";

describe("R-11 M-1: plan and apply with the plan run's secrets", () => {
  test("plan with the plan run's task shows the plan masked", async () => {
    const { base, planned } = await planRun();
    for (const extra of [[], ["--json"]]) {
      const shown = await runPlan(io(base, ["plan", "--task", "task.json", "--run", planned.runId, ...extra]));
      assert.ok("text" in shown || ("output" in shown && shown.output.kind === "plan"), shows(shown));
      assert.equal(shows(shown).includes(SECRET), false);
    }
  });
});

describe("R-11 M-1 (DR-28): plan and apply with other secrets stop before anything is shown or moved", () => {
  test("plan in the quick form with a config that does not register the secret", { todo: DR28 }, async () => {
    const { base, ws, planned } = await planRun();
    for (const extra of [[], ["--json"]]) {
      const argv = ["plan", "--workspace", ws, "--config", "config.json", "--workflow", "organize", "--run", planned.runId, ...extra];
      const shown = await runPlan(io(base, argv));
      assert.equal(shows(shown).includes(SECRET), false, "the value the plan run masked is not shown");
      assert.ok("output" in shown && shown.output.kind === "error", shows(shown));
    }
  });

  test("apply in that form moves nothing and records nothing", { todo: DR28 }, async () => {
    const { base, ws, planned } = await planRun();
    const runsBefore = await readdir(path.join(ws, ".codaryn", "runs"));
    const digest = (planned.plan?.digest ?? "").slice(0, 12);
    const argv = ["apply", "--workspace", ws, "--config", "config.json", "--workflow", "organize", "--run", planned.runId, "--digest", digest, "--quiet"];
    const applied = await runApply(io(base, argv));
    assert.equal(shows(applied).includes(SECRET), false);
    assert.ok("output" in applied && applied.output.kind === "error", shows(applied));
    assert.equal(await readFile(path.join(ws, SECRET, "a.txt"), "utf8"), "alpha\n", "nothing moved");
    assert.deepEqual(await readdir(path.join(ws, ".codaryn", "runs")), runsBefore, "no apply run was recorded");
  });
});

describe("R-11 L-1: a workflow definition's limits are defaults, not caps", () => {
  async function planWith(limits: Record<string, unknown>, config: Record<string, unknown> | null): Promise<EngineResult | { code: string; message: string }> {
    const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-r11-l1-"));
    temporaryDirs.push(base);
    await mkdir(path.join(base, "ws"));
    const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "nothing", actions: [] } }] }, { text: "done" }];
    await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
    await writeFile(path.join(base, "task.json"), JSON.stringify(task({ limits, privacy: { secretEnv: [] } })), "utf8");
    const argv = ["run", "--task", "task.json", "--quiet"];
    if (config !== null) {
      await writeFile(path.join(base, "config.json"), JSON.stringify({ schemaVersion: 1, ...config }), "utf8");
      argv.push("--config", "config.json");
    }
    const outcome = await runCli({ ...io(base, argv), assemble: assembleRun });
    return outcome.output.kind === "run" ? (outcome.output as EngineResult) : (outcome.output as unknown as { code: string; message: string });
  }

  test("without a config a task may ask more turns than organize's default (8)", async () => {
    const outcome = await planWith({ ...LIMITS, maxModelTurns: 20 }, null);
    assert.ok("runId" in outcome, shows(outcome));
  });

  test("the config's limits stay the cap, and its error names the config file", async () => {
    const outcome = await planWith({ ...LIMITS, maxModelTurns: 20 }, { limits: { maxModelTurns: 10 } });
    assert.ok("code" in outcome && outcome.code === "invalid_task" && outcome.message.includes("config file"), shows(outcome));
  });

  test("a task without maxModelTurns gets the definition's default, kept under the config's cap", async () => {
    const { maxModelTurns: _drop, ...rest } = LIMITS;
    for (const [config, turns] of [[null, 8], [{ limits: { maxModelTurns: 5 } }, 5], [{ limits: { maxModelTurns: 30 } }, 8]] as const) {
      const outcome = await planWith(rest, config);
      assert.ok("runId" in outcome, shows(outcome));
      const base = path.dirname(path.dirname(path.join(outcome.journalPath)));
      void base;
      const journal = await findJournal(outcome);
      const started = JSON.parse(journal.split("\n")[0] ?? "{}") as { limits?: { maxModelTurns?: number } };
      assert.equal(started.limits?.maxModelTurns, turns, shows(config));
    }
  });
});

/** The run's journal, found through the temporary directories (the result's path is relative). */
async function findJournal(result: EngineResult): Promise<string> {
  for (const dir of temporaryDirs) {
    const file = path.join(dir, "ws", result.journalPath);
    const text = await readFile(file, "utf8").catch(() => null);
    if (text !== null) return text;
  }
  throw new Error("journal not found");
}

describe("R-11 L-2: the quick form of plan, apply and review explains its config need", () => {
  test("without the config's limits the error says the quick form reads the run settings from the config", async () => {
    const { base, ws, planned } = await planRun();
    await writeFile(path.join(base, "empty.json"), JSON.stringify({ schemaVersion: 1 }), "utf8");
    const argv = ["plan", "--workspace", ws, "--config", "empty.json", "--workflow", "organize", "--run", planned.runId];
    const shown = await runPlan(io(base, argv));
    assert.ok("output" in shown && shown.output.kind === "error" && shown.output.code === "invalid_config", shows(shown));
    assert.ok(shown.output.message.includes("quick form") && shown.output.message.includes("--task"), shown.output.message);
  });
});

describe("DR-4 (app layer hand-over): apply's verifier commands get the caller's environment copy", () => {
  test("a command verifier sees LANG from the environment given to apply, not from process.env", async () => {
    const marker = ["codaryn", "env", "copy"].join("-");
    assert.notEqual(process.env["LANG"], marker);
    const { base, planned } = await planRun();
    const check = `process.exit(process.env.LANG === ${JSON.stringify(marker)} ? 0 : 1)`;
    const verifier = { id: "env", kind: "command", executable: process.execPath, args: ["-e", check], cwd: "." };
    await writeFile(path.join(base, "task.json"), JSON.stringify(task({ verifiers: [verifier] })), "utf8");
    const digest = (planned.plan?.digest ?? "").slice(0, 12);
    const env = { ...process.env, ...ENV, LANG: marker };
    const applied = await runApply({ ...io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", digest, "--quiet"]), env });
    assert.ok("output" in applied && applied.output.kind === "apply", shows(applied));
    const result = applied.output as unknown as { status: string; reason: string; verifiers: { id: string; outcome: string }[] };
    assert.equal(result.verifiers.find((item) => item.id === "env")?.outcome, "pass", shows(result.verifiers));
    assert.deepEqual([result.status, result.reason], ["done", "verified"]);
  });
});
