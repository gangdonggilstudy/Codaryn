/**
 * The app layer (adapter-contract sections 3 to 5): what every adapter calls to run, report,
 * revert, check and compare. It holds no task logic; the engine does.
 *
 * Interim implementation (A-1). The pre-run checks and the commands still live in `src/cli`, which
 * this assignment may not change. Rather than copy the security checks (S-1 to S-9, U-1, U-3) and
 * risk two versions drifting apart, the app layer calls the CLI's own, fully injected functions
 * with argument lists built from the request, and receives their output objects unchanged. So
 * `startRun` checks in the same order, with the same codes and messages, as `codaryn run`.
 * The run's assembly is the app layer's own (./assemble.ts, DR-4). This makes `src/app` depend on
 * `src/cli` for now; migration step 2 moves that code into `src/app` and turns the dependency
 * around without changing this module's interface.
 */

import { existsSync } from "node:fs";
import type {
  AnthropicProviderDeps,
  CreateAnthropicProvider,
  DoctorOutput,
  PrivacyGateway,
  ReportOutput,
  RevertOutput,
  RunTask,
} from "../contracts/index.js";
import { runTask as engineRunTask } from "../engine/index.js";
import { createPrivacyGateway } from "../privacy/index.js";
import { revertRun } from "../store/index.js";
import { createRevertCommand } from "../cli/assemble.js";
import type { Assemble } from "../cli/assemble.js";
import { createCancelSource } from "../cli/cancel.js";
import { runDoctor } from "../cli/doctor.js";
import type { CommandOutcome } from "../cli/guard.js";
import { runReport } from "../cli/report.js";
import { runRevert } from "../cli/revert.js";
import { runCli } from "../cli/run.js";
import type { CliEnvironment, CliRunOutcome } from "../cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../cli/security/index.js";
import { createAppAssemble } from "./assemble.js";
import { readChanges } from "./changes.js";
import { copyEnvironment, loadVarsInto } from "./environment.js";
import { INTERNAL_ERROR, appError, fromCliError } from "./errors.js";
import { deliver, journalWithEvents } from "./events.js";
import type {
  AppCallOutcome,
  AppEnvironment,
  AppError,
  ChangesOutput,
  ChangesRequest,
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
  if (request.workflowRef !== null) argv.push("--workflow", request.workflowRef);
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

/** Stands for "stop here" in the secrets probe; never shown, the probe reports its own outcome. */
const PROBE_STOP = "the settings were resolved; nothing was run";

export function createCodarynApp(environment: AppEnvironment, hooks: AppHooks = {}): CodarynApp {
  const platform = environment.platform ?? process.platform;
  const locate = (file: string, workspaceRoot: string) => locateInWorkspace(file, workspaceRoot);
  const relate = (target: string, base: string) => relateRealPaths(target, base);

  /**
   * The CLI's `run` with this environment. `env` is the call's own copy; the variables file is
   * loaded into it, never into the caller's object or `process.env`.
   */
  function cliRun(
    request: StartRunRequest,
    env: Record<string, string | undefined>,
    parts: Pick<CliEnvironment, "assemble" | "cancelSignal"> & { readonly runTask?: RunTask },
  ): Promise<CliRunOutcome | null> {
    return runCli({
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
      installDir: environment.installDir,
      createAnthropicProvider: hooks.createAnthropicProvider,
      anthropicDeps: hooks.anthropicDeps,
      ...parts,
    }).catch(() => null);
  }

  async function startRun(request: StartRunRequest, observer?: RunObserver): Promise<StartOutcome> {
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

    let assembledRun: { readonly privacy: PrivacyGateway; readonly workspaceRoot: string } | null = null;
    const ownAssemble = createAppAssemble(env, platform, (assembled) => {
      assembledRun = assembled;
    });
    const assemble: Assemble = async (input) => {
      const assembled = await ownAssemble(input);
      if (!assembled.ok || assembledRun === null) return assembled;
      const { privacy, workspaceRoot } = assembledRun;
      // DR-15: events from the records the engine appends, in memory, masked again with this gateway.
      const journal = journalWithEvents(assembled.deps.journal, input.runId, observer, privacy, input.clock);
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

    const running = cliRun(request, env, {
      assemble,
      runTask,
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
    });

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

  /**
   * The secrets and the workspace a run with these settings would have, from the CLI's own pre-run
   * steps 1 to 8. The assembly is replaced by a stop, so no lock, journal or file is made and
   * nothing is sent. Used by `changes` (DR-7).
   */
  async function probeSecrets(
    request: StartRunRequest,
  ): Promise<{ readonly ok: true; readonly secrets: readonly string[]; readonly workspaceRoot: string } | { readonly ok: false; readonly error: AppError }> {
    const env = copyEnvironment(environment.env, platform);
    const seen: { secrets?: readonly string[]; workspaceRoot?: string } = {};
    const outcome = await cliRun({ ...request, cancelFile: null }, env, {
      assemble: async (input) => {
        seen.secrets = input.secrets;
        seen.workspaceRoot = input.task.workspaceRoot;
        return { ok: false, code: "internal_error", message: PROBE_STOP };
      },
      cancelSignal: () => ({ signal: new AbortController().signal, dispose() {} }),
    });
    if (seen.secrets !== undefined && seen.workspaceRoot !== undefined) {
      return { ok: true, secrets: seen.secrets, workspaceRoot: seen.workspaceRoot };
    }
    const output = outcome?.output;
    return { ok: false, error: output?.kind === "error" ? fromCliError(output) : INTERNAL_ERROR };
  }

  async function changes(request: ChangesRequest): Promise<AppCallOutcome<ChangesOutput>> {
    try {
      const probe = await probeSecrets(request.run);
      if (!probe.ok) return probe;
      return await readChanges(probe.workspaceRoot, request.runId, createPrivacyGateway({ secrets: probe.secrets }), platform);
    } catch {
      return { ok: false, error: appError("internal_error", "the changes could not be read") };
    }
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

  // plan, applyPlan and review (DR-1, DR-2) are left out until the general task commands exist.
  return { startRun, report, revert, doctor, changes };
}
