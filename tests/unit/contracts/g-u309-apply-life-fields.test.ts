/**
 * U-309 (C-7b, the CLI migration, DR-65): the apply life's hooks and facts are types of the app
 * layer's contract (src/contracts/app.ts). ApplyLifeHooks holds the approval question, the consent
 * to unsafe moves, the observer and the masking; ApplyFacts, ApplyRunEnd, ApplyApprovalView and
 * RunFacts are what they hand over. None of their names reaches an apply's result, result.json, its
 * error JSON or `codaryn apply --json`:
 * - By type: the lists of names are complete. The names the outputs already use for their own (kind,
 *   plan, runId) are the only overlap, and no other new name is a field of ApplyResult, EngineResult,
 *   CliErrorOutput or AppError. ApplyRunEnd's result is the apply's result itself.
 *   CodarynApp.applyPlan takes an observer and never the hooks, so an adapter's apply asks nothing
 *   (DR-1, DR-3, DR-21).
 * - On a plan of moves: the CLI's `apply --json` line (as main.ts writes it) and result.json hold none
 *   of them at any depth; a refused apply's error JSON neither. The app's applyPlan outcome holds
 *   `ok` and `output` only (no lockLeft, PM) and its output is result.json's.
 * These stay true when the app's apply life gives the hooks (the migration's next step), and fail if
 * a name is spread into an output. Fake values only; a scripted model; no network and no real API.
 */

import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { RESULT_FILE_NAME } from "../../../src/contracts/index.js";
import type { ApplyResult, CliErrorOutput, EngineResult } from "../../../src/contracts/index.js";
import type { AppError, ApplyApprovalView, ApplyFacts, ApplyLifeHooks, ApplyObserver, ApplyRunEnd, CodarynApp, RunFacts } from "../../../src/contracts/app.js";
import { stdoutText } from "../../../src/cli/guard.js";
import { runApply } from "../../../src/cli/plan-commands.js";
import type { ApplyCommandEnvironment } from "../../../src/cli/plan-commands.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { FAKE_SECRET, SECRET_ENV, plannedRun, runDir, taskForm } from "../app/support.js";

type Never<T> = [T] extends [never] ? true : false;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Every key of every member of a union. */
type KeysOf<T> = T extends unknown ? keyof T : never;

const HOOKS = ["observer", "ready", "approve", "applyEnded", "consentToUnsafeMoves", "runReady"] as const;
const STORED = ["onStoredRecord", "onStoredRunRecord"] as const;
const FACTS = ["planKind", "otherTask", "mask"] as const;
const RUN_END = ["result", "lockLeft"] as const;
const RUN_FACTS = ["runId", "configLanguage", "defaultConfig", "mask"] as const;
const VIEW = ["kind", "plan", "commandsAllowed"] as const;
/** Names the outputs already have for their own: not looked for in them. */
const OUTPUT_OWN = ["kind", "plan", "runId"] as const;

type NewName =
  | (typeof HOOKS)[number]
  | (typeof STORED)[number]
  | (typeof FACTS)[number]
  | (typeof RUN_END)[number]
  | (typeof RUN_FACTS)[number]
  | (typeof VIEW)[number];
type Looked = Exclude<NewName, (typeof OUTPUT_OWN)[number]>;

// Each must be `true`, or this file does not compile.
const TYPE_FACTS: [
  // The lists are complete.
  Same<keyof ApplyLifeHooks, (typeof HOOKS)[number]>,
  Same<Extract<keyof ApplyObserver, `onStored${string}`>, (typeof STORED)[number]>,
  Same<keyof ApplyFacts, (typeof FACTS)[number]>,
  Same<keyof ApplyRunEnd, (typeof RUN_END)[number]>,
  Same<keyof RunFacts, (typeof RUN_FACTS)[number]>,
  Same<KeysOf<ApplyApprovalView>, (typeof VIEW)[number]>,
  // The outputs' own names, and only those, are shared.
  "kind" | "runId" extends keyof ApplyResult ? true : false,
  "plan" extends keyof EngineResult ? true : false,
  Never<Extract<Looked, keyof ApplyResult | keyof EngineResult | keyof CliErrorOutput | keyof AppError>>,
  // ApplyRunEnd's result is the apply's result itself.
  Same<ApplyRunEnd["result"], ApplyResult>,
  // CodarynApp.applyPlan takes an observer, never the hooks, and the observer has no question.
  Same<Parameters<CodarynApp["applyPlan"]>[1], ApplyObserver | undefined>,
  Never<Extract<keyof ApplyObserver, (typeof HOOKS)[number]>>,
] = [true, true, true, true, true, true, true, true, true, true, true, true];

const LOOKED: readonly string[] = [...new Set<string>([...HOOKS, ...STORED, ...FACTS, ...RUN_END, ...RUN_FACTS, ...VIEW])].filter(
  (name) => !(OUTPUT_OWN as readonly string[]).includes(name),
);

/** The names among LOOKED that `value` holds as a key, at any depth. */
function looked(value: unknown, found = new Set<string>()): string[] {
  if (Array.isArray(value)) for (const item of value) looked(item, found);
  else if (typeof value === "object" && value !== null) {
    for (const [key, inner] of Object.entries(value)) {
      if (LOOKED.includes(key)) found.add(key);
      looked(inner, found);
    }
  }
  return [...found];
}

function applyIo(base: string, argv: readonly string[]): ApplyCommandEnvironment {
  return {
    argv,
    env: { [SECRET_ENV]: FAKE_SECRET },
    cwd: base,
    readFile: (file: string) => readFile(file, "utf8"),
    isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
    loadEnvFile: () => {},
    locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
    relatePaths: (target: string, root: string) => relateRealPaths(target, root),
    clock: { now: () => Date.now() },
    randomBytes: (size: number) => crypto.getRandomValues(new Uint8Array(size)),
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
  };
}

const lineOf = (outcome: Awaited<ReturnType<typeof runApply>>, argv: readonly string[]): string => stdoutText(outcome, { argv, stdoutIsTerminal: false, stderrIsTerminal: false });

describe("U-309: the apply life's hooks and facts stay out of an apply's outputs", () => {
  test("by type: the lists are complete, only the outputs' own names are shared, and applyPlan takes no hook", () => {
    assert.deepEqual(TYPE_FACTS, Array.from({ length: TYPE_FACTS.length }, () => true));
    assert.equal(LOOKED.includes("lockLeft") && LOOKED.includes("mask") && LOOKED.includes("onStoredRunRecord"), true);
  });

  test("codaryn apply --json: neither a refusal's error JSON nor the apply's JSON line nor its result.json holds a new name", async () => {
    const { base, plan, digest } = await plannedRun();
    const task = path.join(base, "task.json");

    const wrong = ["apply", "--task", task, "--run", plan.runId, "--digest", "0".repeat(12), "--json"];
    const refusedLine = lineOf(await runApply(applyIo(base, wrong)), wrong);
    const refused = JSON.parse(refusedLine) as CliErrorOutput;
    assert.deepEqual([refused.kind, refused.code], ["error", "plan_not_approved"], refusedLine);
    assert.deepEqual(looked(refused), [], refusedLine);

    const argv = ["apply", "--task", task, "--run", plan.runId, "--digest", digest.slice(0, 12), "--json"];
    const line = lineOf(await runApply(applyIo(base, argv)), argv);
    const printed = JSON.parse(line) as ApplyResult;
    assert.deepEqual([printed.kind, printed.status, printed.planRunId], ["apply", "done", plan.runId], line);
    const stored = JSON.parse(await readFile(path.join(runDir(base, printed.runId), RESULT_FILE_NAME), "utf8")) as ApplyResult;
    assert.deepEqual(Object.keys(printed).sort(), Object.keys(stored).sort());
    assert.deepEqual(looked(printed), [], line);
    assert.deepEqual(looked(stored), []);
  });

  test("the app's applyPlan: the outcome holds ok and output only, and the output is result.json's", async () => {
    const { base, app, plan, digest } = await plannedRun();
    const started = await app.applyPlan({ settings: taskForm(base), planRunId: plan.runId, digest: digest.slice(0, 12), cancelFile: null, unsafeMoveConsent: null });
    assert.ok(started.ok, JSON.stringify(started));
    const outcome = await started.handle.done;
    assert.ok(outcome.ok, JSON.stringify(outcome));
    assert.deepEqual(Object.keys(outcome).sort(), ["ok", "output"]);
    assert.equal(outcome.output.kind, "apply");
    assert.deepEqual(looked(outcome.output), []);
    const stored = JSON.parse(await readFile(path.join(runDir(base, outcome.output.runId), RESULT_FILE_NAME), "utf8")) as unknown;
    assert.deepEqual(JSON.parse(JSON.stringify(outcome.output)), stored);
  });
});
