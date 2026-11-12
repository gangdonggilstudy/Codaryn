/**
 * Review R-13 L-3 follow-up (the documentation owner's finding): the inventory checker stops on an
 * aborted signal (cf2029b), but the CLI's apply built it without the apply's cancel signal, so a
 * cancel could not stop a long listing.
 * - The CLI case: the checker the engine receives sees the apply's cancel signal.
 * - The engine case: a cancel during the preflight listing ends the apply as cancelled. The engine
 *   reads the listing's rejection as "the inventory could not be taken" (failed/plan_stale) today;
 *   that is the engine owner's, and the case is todo until it is changed.
 * Real store, tools and inventory; scripted model. Nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { ApplyDeps, ApplyResult, EngineResult } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runApply, runPlan } from "../../../src/cli/plan-commands.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { applyPlan as engineApplyPlan } from "../../../src/engine/index.js";
import { createInventoryChecker } from "../../../src/verify/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 600_000;
const clock = { now: () => (now += 1000) };
let seed = 191;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);

const io = (base: string, argv: readonly string[]) => ({
  argv,
  env: {},
  cwd: base,
  readFile: (file: string) => readFile(file, "utf8"),
  isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
  loadEnvFile: () => {},
  locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
  relatePaths: (target: string, root: string) => relateRealPaths(target, root),
  clock,
  randomBytes,
});

async function planRun(): Promise<{ base: string; ws: string; planned: EngineResult }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-inventory-cancel-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  await writeFile(path.join(ws, "a.txt"), "alpha\n", "utf8");
  const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "s", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] }];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(
    path.join(base, "task.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "g-inventory-cancel",
      goal: "g",
      workflow: "label",
      workspaceRoot: "./ws",
      model: { provider: "scripted", scriptPath: "./script.json" },
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move"] },
      privacy: { secretEnv: [] },
      limits: { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
      verifiers: [],
      workflowRef: "organize",
    }),
    "utf8",
  );
  const run = await runCli({
    ...io(base, ["run", "--task", "task.json", "--quiet"]),
    assemble: assembleRun,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
  });
  assert.equal(run.output.kind, "run", JSON.stringify(run.output));
  return { base, ws, planned: run.output as EngineResult };
}

describe("R-13 L-3: the apply's cancel reaches the inventory listing", () => {
  test("the checker the engine receives stops once the apply is cancelled", async () => {
    const { base, planned } = await planRun();
    const cancel = new AbortController();
    let captured: "listed" | "stopped" | null = null;
    const standIn = async (deps: ApplyDeps): Promise<ApplyResult> => {
      cancel.abort();
      try {
        await deps.inventory.capture();
        captured = "listed";
      } catch (error) {
        captured = (error as { name?: string }).name === "AbortError" ? "stopped" : "listed";
      }
      throw new Error("stand-in stops here");
    };
    await runApply({
      ...io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", (planned.plan?.digest ?? "").slice(0, 12), "--quiet"]),
      applyPlan: standIn,
      cancelSignal: () => ({ signal: cancel.signal, dispose: () => {} }),
    });
    assert.equal(captured, "stopped", "the listing saw the cancel");
  });
});

describe("R-13 L-3: the engine ends a cancel during the listing as cancelled", () => {
  test(
    "a cancel while the preflight lists the workspace is cancelled/cancelled, not plan_stale",
    { todo: "engine owner: applyPlan reads the listing's AbortError as 'inventory could not be taken' (src/engine/apply.ts preflight)" },
    async () => {
      const { base, ws, planned } = await planRun();
      const cancel = new AbortController();
      const real = createInventoryChecker({ workspaceRoot: ws, signal: cancel.signal });
      let first = true;
      const inventory = {
        capture: async () => {
          if (first) {
            first = false;
            cancel.abort();
          }
          return real.capture();
        },
        check: real.check.bind(real),
      };
      const wrapped = async (deps: ApplyDeps): Promise<ApplyResult> => engineApplyPlan({ ...deps, inventory, signal: cancel.signal });
      const outcome = await runApply({
        ...io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", (planned.plan?.digest ?? "").slice(0, 12), "--quiet"]),
        applyPlan: wrapped,
        cancelSignal: () => ({ signal: cancel.signal, dispose: () => {} }),
      });
      assert.ok("output" in outcome && outcome.output.kind === "apply", JSON.stringify(outcome));
      const result = outcome.output as ApplyResult;
      assert.deepEqual([result.status, result.reason], ["cancelled", "cancelled"]);
      assert.equal(await readFile(path.join(ws, "a.txt"), "utf8"), "alpha\n");
    },
  );
});

describe("R-18 L1: apply lists the workspace for the plan view only when it asks", () => {
  /** A factory around the real checker that counts listings and keeps the signals it was given. */
  function counting(): { factory: (options: { workspaceRoot: string; signal?: AbortSignal }) => ReturnType<typeof createInventoryChecker>; listings: number; signals: (AbortSignal | undefined)[] } {
    const state = { listings: 0, signals: [] as (AbortSignal | undefined)[] };
    const factory = (options: { workspaceRoot: string; signal?: AbortSignal }) => {
      state.signals.push(options.signal);
      const real = createInventoryChecker(options);
      return {
        capture: async () => {
          state.listings += 1;
          return real.capture();
        },
        check: real.check.bind(real),
      };
    };
    return Object.assign(state, { factory });
  }

  test("with --digest the CLI makes no listing of its own; the engine lists twice", async () => {
    const { base, planned } = await planRun();
    const count = counting();
    const outcome = await runApply({
      ...io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", (planned.plan?.digest ?? "").slice(0, 12), "--quiet"]),
      createInventoryChecker: count.factory,
      cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    });
    assert.ok("output" in outcome && outcome.output.kind === "apply", JSON.stringify(outcome));
    assert.equal(count.listings, 2, "the engine's two listings, none before them");
  });

  test("at a terminal the plan view's listing gets the apply's cancel signal", async () => {
    const { base, planned } = await planRun();
    const count = counting();
    const cancel = new AbortController();
    const outcome = await runApply({
      ...io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--quiet"]),
      createInventoryChecker: count.factory,
      ask: async () => "",
      cancelSignal: () => ({ signal: cancel.signal, dispose: () => {} }),
    });
    assert.ok("output" in outcome && outcome.output.kind === "error" && outcome.output.code === "plan_not_approved", JSON.stringify(outcome));
    assert.equal(count.listings, 1, "one listing, for the question");
    assert.equal(count.signals[0], cancel.signal);
  });

  test("plan still lists the workspace (it shows the inventory limit)", async () => {
    const { base, planned } = await planRun();
    const count = counting();
    const shown = await runPlan({ ...io(base, ["plan", "--task", "task.json", "--run", planned.runId, "--json"]), createInventoryChecker: count.factory });
    assert.ok("output" in shown || "text" in shown);
    assert.equal(count.listings, 1);
  });
});
