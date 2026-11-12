/**
 * The app layer (adapter-contract sections 3 to 5): what every adapter calls to run, report,
 * revert and check. It holds no task logic; the engine does.
 *
 * Interim implementation (A-1). The pre-run checks, the assembly and the commands still live in
 * `src/cli`, which this assignment may not change. Rather than copy the security checks (S-1 to
 * S-9, U-1, U-3) and risk two versions drifting apart, the app layer calls the CLI's own,
 * fully injected functions with argument lists built from the request, and receives their output
 * objects unchanged. So `startRun` checks in the same order, with the same codes and messages, as
 * `codaryn run`. This makes `src/app` depend on `src/cli` for now; migration step 2 moves that code
 * into `src/app` and turns the dependency around without changing this module's interface.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { JOURNAL_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME } from "../contracts/index.js";
import type {
  AnthropicProviderDeps,
  CreateAnthropicProvider,
  DoctorOutput,
  ReportOutput,
  RevertOutput,
  RunTask,
} from "../contracts/index.js";
import { runTask as engineRunTask } from "../engine/index.js";
import { revertRun } from "../store/index.js";
import { createWorkspace } from "../workspace/index.js";
import { assembleRun, createRevertCommand } from "../cli/assemble.js";
import type { Assemble } from "../cli/assemble.js";
import { createCancelSource } from "../cli/cancel.js";
import { runDoctor } from "../cli/doctor.js";
import type { CommandOutcome } from "../cli/guard.js";
import { runReport } from "../cli/report.js";
import { runRevert } from "../cli/revert.js";
import { runCli } from "../cli/run.js";
import type { CliRunOutcome } from "../cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../cli/security/index.js";
import { copyEnvironment, loadVarsInto } from "./environment.js";
import { INTERNAL_ERROR, fromCliError } from "./errors.js";
import { deliver, journalWithEvents } from "./events.js";
import type {
  AppCallOutcome,
  AppEnvironment,
  CodarynApp,
  DoctorRequest,
  ReportRequest,
  RevertRequest,
  RunHandle,
  RunObserver,
  RunOutcome,
  StartOutcome,
  StartRunRequest,
} from "./types.js";

/**
 * Replaceable parts, for tests: the Anthropic provider factory and its transport (as the CLI's
 * own tests inject them), and the engine. Leave them out in real use.
 */
export interface AppHooks {
  readonly createAnthropicProvider?: CreateAnthropicProvider;
  readonly anthropicDeps?: AnthropicProviderDeps;
  readonly runTask?: RunTask;
}

/** The `codaryn run` arguments for a request. The CLI parser judges them (values, combinations). */
export function runArguments(request: StartRunRequest): string[] {
  const argv = ["run"];
  if (request.input.kind === "task") argv.push("--task", request.input.taskPath);
  else argv.push("--workspace", request.input.workspace, "--goal", request.input.goal);
  if (request.configPath !== null) argv.push("--config", request.configPath);
  if (request.varsFile !== null) argv.push("--vars-file", request.varsFile);
  if (request.profile !== null) argv.push("--profile", request.profile);
  if (request.cancelFile !== null) argv.push("--cancel-file", request.cancelFile);
  return argv;
}

/** A command printed with `--json`: its text is one JSON object of `kind`, or its output is an error. */
function jsonOutcome<T extends { readonly kind: string }>(outcome: CommandOutcome, kind: T["kind"]): AppCallOutcome<T> {
  if ("output" in outcome) {
    return outcome.output.kind === "error" ? { ok: false, error: fromCliError(outcome.output) } : { ok: false, error: INTERNAL_ERROR };
  }
  try {
    const value = JSON.parse(outcome.text) as { kind?: unknown };
    if (typeof value === "object" && value !== null && value.kind === kind) return { ok: true, output: value as T };
  } catch {
    // Falls through: not the expected object.
  }
  return { ok: false, error: INTERNAL_ERROR };
}

const nextMacrotask = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export function createCodarynApp(environment: AppEnvironment, hooks: AppHooks = {}): CodarynApp {
  const platform = environment.platform ?? process.platform;
  const locate = (file: string, workspaceRoot: string) => locateInWorkspace(file, workspaceRoot);
  const relate = (target: string, base: string) => relateRealPaths(target, base);

  async function startRun(request: StartRunRequest, observer?: RunObserver): Promise<StartOutcome> {
    // A copy per run: the variables file is loaded into it, never into the caller's object.
    const env = copyEnvironment(environment.env, platform);
    const cancelHandlers = new Set<() => void>();

    let reportStart: (value: { runId: string; workspaceRoot: string }) => void = () => {};
    const started = new Promise<{ runId: string; workspaceRoot: string }>((resolve) => {
      reportStart = resolve;
    });
    // The engine starts only after startRun has handed out the handle, so the caller knows the
    // run id before the first event (adapter-contract 5.1).
    let openGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    /** Notices of the engine's own result; the CLI may add more afterwards (Y-4). */
    let engineNotices: number | null = null;

    const assemble: Assemble = async (input) => {
      const assembled = await assembleRun(input);
      if (!assembled.ok) return assembled;
      let journal = assembled.deps.journal;
      let workspaceRoot = input.task.workspaceRoot;
      try {
        workspaceRoot = (await createWorkspace({ root: input.task.workspaceRoot })).root;
        const file = path.join(workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME, input.runId, JOURNAL_FILE_NAME);
        journal = journalWithEvents(journal, file, input.runId, observer);
      } catch {
        // The assembly resolved this root a moment ago. If it cannot be resolved again, the run
        // goes on without events.
      }
      reportStart({ runId: input.runId, workspaceRoot });
      return { ...assembled, deps: { ...assembled.deps, journal } };
    };

    const runTask: RunTask = async (deps) => {
      await gate;
      await nextMacrotask();
      const ended = await (hooks.runTask ?? engineRunTask)(deps);
      engineNotices = ended.notices.length;
      return ended;
    };

    const running: Promise<CliRunOutcome | null> = runCli({
      argv: runArguments(request),
      env,
      cwd: environment.cwd,
      readFile: environment.readFile,
      isDirectory: environment.isDirectory,
      loadEnvFile: (file) => loadVarsInto(env, file, environment.readVarsFile),
      locateInWorkspace: locate,
      relatePaths: relate,
      clock: environment.clock,
      randomBytes: environment.randomBytes,
      assemble,
      runTask,
      installDir: environment.installDir,
      createAnthropicProvider: hooks.createAnthropicProvider,
      anthropicDeps: hooks.anthropicDeps,
      // No signal handlers on the process: the CLI's two signal sources become handle.cancel().
      // The cancel file, when requested, is watched as in the CLI (P-2).
      cancelSignal: (cancelFile) =>
        createCancelSource({
          cancelFile,
          fileExists: (file) => existsSync(file),
          onSignal: (_name, handler) => {
            cancelHandlers.add(handler);
            return () => {
              cancelHandlers.delete(handler);
            };
          },
        }),
    }).catch(() => null);

    const first = await Promise.race([
      started.then((info) => ({ kind: "started" as const, info })),
      running.then((outcome) => ({ kind: "ended" as const, outcome })),
    ]);
    if (first.kind === "ended") {
      const output = first.outcome?.output;
      return { ok: false, error: output?.kind === "error" ? fromCliError(output) : INTERNAL_ERROR };
    }

    const done: Promise<RunOutcome> = running.then((outcome) => {
      const output = outcome?.output;
      if (output === undefined) return { ok: false, error: INTERNAL_ERROR };
      if (output.kind === "error") return { ok: false, error: fromCliError(output) };
      if (engineNotices !== null) {
        for (const text of output.notices.slice(engineNotices)) deliver(observer, { kind: "notice", text });
      }
      return { ok: true, result: output };
    });
    const handle: RunHandle = {
      runId: first.info.runId,
      workspaceRoot: first.info.workspaceRoot,
      cancel() {
        for (const handler of [...cancelHandlers]) handler();
      },
      done,
    };
    openGate();
    return { ok: true, handle };
  }

  async function report(request: ReportRequest): Promise<AppCallOutcome<ReportOutput>> {
    try {
      const outcome = await runReport({
        argv: ["report", "--workspace", request.workspace, "--run", request.runId, "--json"],
        cwd: environment.cwd,
        env: copyEnvironment(environment.env, platform),
        platform,
      });
      return jsonOutcome<ReportOutput>(outcome, "report");
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async function revert(request: RevertRequest): Promise<AppCallOutcome<RevertOutput>> {
    try {
      const { output } = await runRevert({
        argv: ["revert", "--workspace", request.workspace, "--run", request.runId],
        cwd: environment.cwd,
        isDirectory: environment.isDirectory,
        clock: environment.clock,
        randomBytes: environment.randomBytes,
        revert: createRevertCommand(revertRun),
      });
      return output.kind === "revert" ? { ok: true, output } : { ok: false, error: fromCliError(output) };
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async function doctor(request: DoctorRequest): Promise<AppCallOutcome<DoctorOutput>> {
    const argv = ["doctor"];
    if (request.configPath !== null) argv.push("--config", request.configPath);
    if (request.varsFile !== null) argv.push("--vars-file", request.varsFile);
    if (request.taskPath !== null) argv.push("--task", request.taskPath);
    if (request.workspace !== null) argv.push("--workspace", request.workspace);
    argv.push("--json");
    try {
      const outcome = await runDoctor({
        argv,
        env: copyEnvironment(environment.env, platform),
        cwd: environment.cwd,
        nodeVersion: environment.nodeVersion,
        installDir: environment.installDir,
        readFile: environment.readFile,
        isDirectory: environment.isDirectory,
        isFile: environment.isFile,
        locateInWorkspace: locate,
        relatePaths: relate,
        platform,
      });
      return jsonOutcome<DoctorOutput>(outcome, "doctor");
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  return { startRun, report, revert, doctor };
}
