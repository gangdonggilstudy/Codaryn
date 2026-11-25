/**
 * The app layer (adapter-contract sections 3 to 5): what every adapter calls to run, report,
 * revert, check and compare. It holds no task logic; the engine does.
 *
 * Interim implementation (A-1). A run's life from step 8 on (runCli) and the commands still live in
 * `src/cli`. Rather than copy the security checks (S-1 to S-9, U-1, U-3) and risk two versions
 * drifting apart, the app layer calls the CLI's own, fully injected functions with argument lists
 * built from the request, and receives their output objects unchanged. So `startRun` checks in the
 * same order, with the same codes and messages, as `codaryn run`. This makes `src/app` depend on
 * `src/cli` for now; the CLI migration (docs/reviews/2026-11-13-cli-migration-plan.md) moves that
 * code into `src/app` step by step and turns the dependency around without changing this module's
 * interface. Already here: the input layer (./input/, C-3a and C-3b), the run's steps 1 to 7
 * (prepareTask, ./prepare.ts, C-5) and the run's assembly (./assembly.ts, C-4), which the CLI's runs
 * use too; the app's hooks for the assembly are ./assemble.ts (DR-4).
 */

import "node:fs/promises"; // Preserve module evaluation order.
import path from "node:path";
import type {
  PlanOutput,
  DefaultConfigLocation,
  RevertOutput,
  RunApprovedPlan,
  RunTask,
} from "../contracts/index.js";
import "../contracts/index.js"; // Preserve module evaluation order.
import "../engine/index.js"; // Preserve module evaluation order.
import "../i18n/index.js"; // Preserve module evaluation order.
import "../privacy/index.js"; // Preserve module evaluation order.
import "../store/index.js"; // Preserve module evaluation order.
import "./revert-command.js"; // Preserve module evaluation order.
import { findDefaultConfigLocation } from "./input/config-file.js";
import "./doctor.js"; // Preserve module evaluation order.
import type { CommandOutcome } from "./command-outcome.js";
import "./init-command.js"; // Preserve module evaluation order.
import "./models-command.js"; // Preserve module evaluation order.
import "./apply-life.js"; // Preserve module evaluation order.
import "./provider.js"; // Preserve module evaluation order.
import "../presentation/report-localized.js"; // Preserve module evaluation order.
import "../presentation/json.js"; // Preserve module evaluation order.
import { parseArgs } from "./input/args.js";
import { locateInWorkspace, relateRealPaths } from "./input/security/index.js";
import { argumentsError, cliError, prepareTask } from "./prepare.js";
import "./report-read.js"; // Preserve module evaluation order.
import "./input/text-safety.js"; // Preserve module evaluation order.
import "./plan-view.js"; // Preserve module evaluation order.
import type { PrepareEnvironment, RunArgs, RunNotes } from "./prepare.js";
import { runLife } from "./run-life.js";
import type { RunLifeEnd, RunLifeEnvironment } from "./run-life.js";
import { tallyOf } from "./tally.js";
import { knownKeyValues } from "./input/settings.js";
import "./apply.js"; // Preserve module evaluation order.
import "./plans.js"; // Preserve module evaluation order.
import "./consent.js"; // Preserve module evaluation order.
import "./changes.js"; // Preserve module evaluation order.
import "./workspace-dir.js"; // Preserve module evaluation order.
import "./run-events.js"; // Preserve module evaluation order.
import "./check-apply.js"; // Preserve module evaluation order.
import "./changes-plan.js"; // Preserve module evaluation order.
import "./workspace-text.js"; // Preserve module evaluation order.
import { copyEnvironment, loadVarsInto } from "./environment.js";
import { INTERNAL_ERROR, appError, fromCliError } from "./errors.js";
import { appRunHooks } from "./run-hooks.js";
import "./models.js"; // Preserve module evaluation order.
import "./runs.js"; // Preserve module evaluation order.
import { applyCleanupIn, previewCleanupIn, stateSummaryIn } from "./cleanup.js";
import "./settings.js"; // Preserve module evaluation order.
import "./init.js"; // Preserve module evaluation order.
import "./settings-change.js"; // Preserve module evaluation order.
import type {
  AppCallOutcome,
  AppEnvironment,
  AppError,
  CodarynApp,
  ApplyCleanupRequest,
  CleanupPreviewRequest,
  StateSummaryRequest,
  RunHandle,
  RunObserver,
  RunOutcome,
  StartOutcome,
  StartRunRequest,
  TaskForm,
} from "./types.js";
import { createReadingContext } from "./reading-context.js";
import { createReadingCommands } from "./reading-commands.js";
import type { AppHooks } from "./app-hooks.js";
import { createReportCommands } from "./report-commands.js";
import { createSettingsCommands } from "./settings-commands.js";
import { createPlanCommands } from "./plan-commands.js";
import { createApplyCommands } from "./apply-commands.js";

export type { AppHooks } from "./app-hooks.js";

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

/**
 * A command run with `--json`: either its output object (some commands, such as `init`, return it
 * as an object) or its text, one JSON object of `kind`; an error output is the CLI's error.
 */
function jsonOutcome<T extends { readonly kind: string }>(outcome: CommandOutcome, kind: T["kind"]): AppCallOutcome<T> {
  if ("output" in outcome) {
    if (outcome.output.kind === "error") return { ok: false, error: fromCliError(outcome.output) };
    return outcome.output.kind === kind ? { ok: true, output: outcome.output as unknown as T } : { ok: false, error: INTERNAL_ERROR };
  }
  try {
    const value = JSON.parse(outcome.text) as { kind?: unknown };
    if (typeof value === "object" && value !== null && value.kind === kind) return { ok: true, output: value as T };
  } catch {
    // Falls through: not the expected object.
  }
  return { ok: false, error: INTERNAL_ERROR };
}

/** A command's refusal as the app's error, as jsonOutcome reads it: the CLI's error output, else an internal error. */
function commandError(outcome: CommandOutcome): AppError {
  return "output" in outcome && outcome.output.kind === "error" ? fromCliError(outcome.output) : INTERNAL_ERROR;
}

const nextMacrotask = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * The goal the reading commands' settings give the CLI's steps for the workspace form. Nothing is
 * run and no goal decides a secret; the CLI's quick form only needs one to parse (S-8 finds no key
 * in it).
 */
export const PROBE_GOAL = "codaryn: resolve the settings only";

/** DR-17: the run settings that register the same secrets as a task form. */
export function runRequestOf(settings: TaskForm): StartRunRequest {
  return {
    input:
      settings.input.kind === "task"
        ? { kind: "task", taskPath: settings.input.taskPath }
        : { kind: "quick", workspace: settings.input.workspace, goal: PROBE_GOAL },
    configPath: settings.configPath,
    varsFile: settings.varsFile,
    profile: settings.profile,
    workflowRef: settings.workflowRef,
    cancelFile: null,
  };
}

export function createCodarynApp(environment: AppEnvironment, hooks: AppHooks = {}): CodarynApp {
  const platform = environment.platform ?? process.platform;
  const locate = (file: string, workspaceRoot: string) => locateInWorkspace(file, workspaceRoot);
  const relate = (target: string, base: string) => relateRealPaths(target, base);
  const { readingSecrets, workspaceTextSource } = createReadingContext(environment, platform, locate, relate, defaultConfigOf, PROBE_GOAL);
  const { changes, listWorkspaceDir, readWorkspaceText, writeWorkspaceText, listRunEvents } = createReadingCommands(readingSecrets, workspaceTextSource, environment, hooks);
  const { report, reportMarkdown, revert, listRuns, resolveRun } = createReportCommands(environment, platform, jsonOutcome, commandError);
  const { doctor, listModels, selectModel, readSettings, createSettings, settingsSuggestions, proposeSettingsChange, applySettingsChange } = createSettingsCommands(environment, platform, hooks, locate, relate, defaultConfigOf, jsonOutcome);
  const { plan, review, planCommandEnvironment } = createPlanCommands(environment, platform, locate, relate, defaultConfigOf, readingSecrets, commandError);
  const { applyPlan, checkApply } = createApplyCommands(environment, platform, hooks, appRunHooks, nextMacrotask, cliEnvironmentOf, planCommandEnvironment, plan, readingSecrets, commandError);

  /**
   * The CLI's run environment with this environment's parts. `env` is the call's own copy; the
   * variables file is loaded into it, never into the caller's object or `process.env`. U-218: also
   * the `run` environment of an apply that carries out a run plan, on the apply's own copy, so the
   * variables file its preparation loaded is the run's.
   */
  function cliEnvironmentOf(
    argv: readonly string[],
    env: Record<string, string | undefined>,
    parts: Pick<RunLifeEnvironment, "assemble" | "cancelSignal"> & { readonly runTask?: RunTask; readonly runApprovedPlan?: RunApprovedPlan },
  ): PrepareEnvironment & RunLifeEnvironment & { readonly argv: readonly string[] } {
    return {
      argv,
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
      // N-1: the same default config location the CLI reads (main.ts).
      defaultConfig: defaultConfigOf(),
      createAnthropicProvider: hooks.createAnthropicProvider,
      anthropicDeps: hooks.anthropicDeps,
      ...(hooks.providerDeps === undefined ? {} : { providerDeps: hooks.providerDeps }),
      ...parts,
    };
  }

  /** N-1: where the CLI would look for the user's config file now, from this environment. */
  function defaultConfigOf(): DefaultConfigLocation | null {
    return findDefaultConfigLocation(platform, environment.env, environment.homeDir ?? null);
  }

  /**
   * adapter-contract 5.1. U-293 (the CLI migration's C-6a): the run's life is the app layer's own
   * (run-life.ts), no longer the CLI's runCli: the arguments as `codaryn run` parses them
   * (runArguments, parseArgs), its steps 1 to 7 (prepareTask), then steps 8 on, in the CLI's order
   * with its codes and messages. Refused before the run is assembled: the error, beside it the
   * config's language once it was read. Assembled: the handle, with what an adapter that draws its
   * own text needs (the config's language, the default location shown, the run's mask); the outcome
   * carries the end summary's counts (tally) and whether the Y-4 hint was added.
   */
  async function startRun(request: StartRunRequest, observer?: RunObserver): Promise<StartOutcome> {
    const env = copyEnvironment(environment.env, platform);
    const run = appRunHooks(env, observer, environment, platform, hooks, nextMacrotask);
    const io = cliEnvironmentOf(runArguments(request), env, run.parts);
    const notes: RunNotes = { configLanguage: null, configDefault: null, deniedToolCalls: 0, deniedCommandCalls: 0, failedToolCalls: 0 };
    const living: Promise<RunLifeEnd | null> = (async (): Promise<RunLifeEnd | null> => {
      const parsed = parseArgs(io.argv);
      if (!parsed.ok) return { kind: "refused", output: argumentsError(parsed).output };
      const ready = await prepareTask(io, parsed.args, notes);
      if (!("prepared" in ready)) return ready.output.kind === "error" ? { kind: "refused", output: ready.output } : null;
      return runLife(io, parsed.args, notes, ready.prepared);
    })().catch(() => null);

    const first = await Promise.race([
      run.started.then((info) => ({ kind: "started" as const, info })),
      living.then((end) => ({ kind: "ended" as const, end })),
    ]);
    if (first.kind === "ended") {
      const error = first.end?.kind === "refused" ? fromCliError(first.end.output) : INTERNAL_ERROR;
      return { ok: false, error, ...(notes.configLanguage === null ? {} : { configLanguage: notes.configLanguage }) };
    }

    const done: Promise<RunOutcome> = living.then((end): RunOutcome => {
      if (end === null) return { ok: false, error: INTERNAL_ERROR };
      if (end.kind === "refused") return { ok: false, error: fromCliError(end.output) };
      // The notices the life added after the engine (Y-4, N-1) are delivered; whether the lock was left.
      const { lockLeft } = run.ended(end.result);
      return {
        ok: true,
        result: end.result,
        ...(lockLeft ? { lockLeft: true as const } : {}),
        tally: tallyOf(notes),
        ...(end.modelNotFound ? { modelNotFound: true as const } : {}),
      };
    });
    const { privacy } = first.info;
    const handle: RunHandle = {
      runId: first.info.runId,
      workspaceRoot: first.info.workspaceRoot,
      cancel: run.cancel,
      done,
      configLanguage: notes.configLanguage,
      defaultConfig: notes.configDefault,
      mask(text) {
        try {
          const masked = privacy.mask(text);
          return masked.ok ? masked.text : null;
        } catch {
          return null;
        }
      },
    };
    run.open();
    return { ok: true, handle };
  }

  // DR-39: the store's summary, plan and cleanup with the app layer's checks (cleanup.ts).
  const stateSummary = (request: StateSummaryRequest) => stateSummaryIn(environment, request);
  const previewCleanup = (request: CleanupPreviewRequest) => previewCleanupIn(environment, request);
  const applyCleanup = (request: ApplyCleanupRequest) => applyCleanupIn(environment, request, hooks.cleanupOperations);

  return {
    startRun,
    report,
    reportMarkdown,
    revert,
    listRuns,
    resolveRun,
    stateSummary,
    previewCleanup,
    applyCleanup,
    doctor,
    changes,
    listWorkspaceDir,
    readWorkspaceText,
    writeWorkspaceText,
    listRunEvents,
    listModels,
    selectModel,
    readSettings,
    createSettings,
    settingsSuggestions,
    proposeSettingsChange,
    applySettingsChange,
    plan,
    applyPlan,
    checkApply,
    review,
  };
}
