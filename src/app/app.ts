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

import { existsSync } from "node:fs";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AnthropicProviderDeps,
  ApiProviderDeps,
  ApiProviderName,
  ApplyPlan,
  ApplyResult,
  AnyPlanOutput,
  ChangesPlanOutput,
  PlanOutput,
  ReviewOutput,
  CreateAnthropicProvider,
  DefaultConfigLocation,
  DoctorOutput,
  EngineResult,
  InitOutput,
  ListAnthropicModels,
  ModelsOutput,
  PrivacyGateway,
  ReportOutput,
  ResolvedTaskSpec,
  RevertOutput,
  RunApprovedPlan,
  RunTask,
  RunsOutput,
} from "../contracts/index.js";
import { workflowSettingsOf } from "../contracts/index.js";
import { applyPlan as engineApplyPlan, runApprovedPlan as engineRunApprovedPlan, runTask as engineRunTask } from "../engine/index.js";
import { createMessageCatalog, explainMessageLanguage } from "../i18n/index.js";
import { createPrivacyGateway } from "../privacy/index.js";
import { inspectRun, listRuns as storeListRuns, readRevertRecord, revertRun, writeRevertRecord } from "../store/index.js";
import type { CleanupOperations } from "../store/index.js";
import { createRevertCommand } from "../cli/assemble.js";
import type { Assemble } from "./assembly.js";
import { createRunCancelSource } from "./cancel.js";
import { chooseConfigFile, defaultLocationRefused, findDefaultConfigLocation } from "./input/config-file.js";
import { runDoctor } from "../cli/doctor.js";
import type { CommandOutcome } from "./command-outcome.js";
import { runInit } from "../cli/init.js";
import { runModels } from "../cli/models.js";
import { runApply } from "../cli/plan-commands.js";
import type { PlanCommandEnvironment } from "../cli/plan-commands.js";
import type { ModelsEnvironment } from "../cli/models.js";
import { API_MODEL_LISTERS, anthropicModelLister } from "./provider.js";
import { renderApplyReport, renderReport } from "../cli/report.js";
import { jsonLine } from "../cli/guard.js";
import { runRevert } from "../cli/revert.js";
import { parseArgs, parsePlanArgs, parseReportArgs, parseReviewArgs } from "../cli/args.js";
import type { CliEnvironment } from "../cli/run.js";
import { locateInWorkspace, relateRealPaths } from "./input/security/index.js";
import { argumentsError, cliError, prepareTask } from "./prepare.js";
import { readReport } from "./report-read.js";
import { hideKeys, hideKeysInStrings } from "./input/text-safety.js";
import { recordReview, showPlan } from "./plan-view.js";
import type { PrepareEnvironment, RunArgs, RunNotes } from "./prepare.js";
import { runLife } from "./run-life.js";
import type { RunLifeEnd } from "./run-life.js";
import { tallyOf } from "./tally.js";
import { knownKeyValues } from "./input/settings.js";
import { applyArguments, applyJournalWithEvents } from "./apply.js";
import { planArguments, reviewArguments } from "./plans.js";
import { createAppAssemble } from "./assemble.js";
import { revertConsentOf, unsafeMoveConsentOf } from "./consent.js";
import { readChanges } from "./changes.js";
import type { ReadChangesDeps } from "./changes.js";
import { listWorkspaceDirIn, workspaceDirArguments } from "./workspace-dir.js";
import { listRunEventsIn, runEventsArguments } from "./run-events.js";
import { checkApplyArguments, checkApplyIn } from "./check-apply.js";
import { changesPlanViewIn, checkChangesPlanFiles, storedPlanKindOf } from "./changes-plan.js";
import type { ApplyCheckOperations } from "./check-apply.js";
import { readWorkspaceTextArguments, readWorkspaceTextIn, writeWorkspaceTextArguments, writeWorkspaceTextIn } from "./workspace-text.js";
import type { WorkspaceTextOperations, WorkspaceTextSource } from "./workspace-text.js";
import { copyEnvironment, loadVarsInto } from "./environment.js";
import { INTERNAL_ERROR, appError, fromCliError } from "./errors.js";
import { deliver, journalWithEvents } from "./events.js";
import { confirmThrough } from "./permission.js";
import { modelsArguments } from "./models.js";
import { listRunsIn, resolveRunIn, runIdOf, workspaceRootOf } from "./runs.js";
import { applyCleanupIn, previewCleanupIn, stateSummaryIn } from "./cleanup.js";
import { readSettingsIn } from "./settings.js";
import { initArguments, suggestionsFor } from "./init.js";
import { applySettingsChangeIn, proposeSettingsChangeIn } from "./settings-change.js";
import type {
  AppCallOutcome,
  RevertCallOutcome,
  AppEnvironment,
  AppError,
  ApplyHandle,
  ApplyObserver,
  ApplyOutcome,
  ApplyPlanRequest,
  CheckApplyRequest,
  ChangesOutput,
  PlanCheck,
  PlanRequest,
  ReviewRequest,
  ChangesOptions,
  ChangesRequest,
  CodarynApp,
  DoctorRequest,
  ListModelsRequest,
  ApplyCleanupRequest,
  CleanupPreviewRequest,
  ListRunsRequest,
  ListRunEventsRequest,
  ListWorkspaceDirRequest,
  StateSummaryRequest,
  ApplySettingsChangeRequest,
  CreateSettingsRequest,
  ReadSettingsRequest,
  ReportMarkdown,
  ReportRequest,
  SelectModelRequest,
  SettingsChangeProposal,
  SettingsChangeRequest,
  WorkspaceDirListing,
  ReadWorkspaceTextRequest,
  WorkspaceText,
  WorkspaceTextWritten,
  WriteWorkspaceTextRequest,
  SettingsSuggestions,
  SettingsSuggestionsRequest,
  SettingsView,
  SettingsWritten,
  ResolvedRun,
  ResolveRunRequest,
  RevertRequest,
  RunEventsPage,
  RunHandle,
  RunObserver,
  RunOutcome,
  StartOutcome,
  StartRunRequest,
  TaskForm,
} from "./types.js";

/**
 * Replaceable parts, for tests: the Anthropic provider factory and its transport (as the CLI's
 * own tests inject them), and the engine. Leave them out in real use.
 */
export interface AppHooks {
  readonly createAnthropicProvider?: CreateAnthropicProvider;
  readonly anthropicDeps?: AnthropicProviderDeps;
  /**
   * GUI F-2 (R21b-I-1): each API provider's injection points (its `fetch`, its `sleep`), as the CLI's
   * runCli and runModels take them. For anthropic an entry here is used instead of `anthropicDeps`.
   * Absent: the provider uses the global fetch.
   */
  readonly providerDeps?: { readonly [P in ApiProviderName]?: ApiProviderDeps };
  readonly runTask?: RunTask;
  /** U-218: the engine of a run that carries out an approved run plan (runApprovedPlan of src/engine when absent). Tests only. */
  readonly runApprovedPlan?: RunApprovedPlan;
  /** The apply engine (`applyPlan` of src/engine when absent). Tests give a stand-in to see what it was given. */
  readonly applyPlan?: ApplyPlan;
  /** The model listing (`listAnthropicModels` when absent). Tests give a fake so nothing is sent. */
  readonly listModels?: ListAnthropicModels;
  /** The config writer of `selectModel` (`writeConfigAtomic` when absent). */
  readonly writeConfig?: ModelsEnvironment["writeConfig"];
  /** The store's cleanup operations (its removal, its mark writer). Tests give a removal that refuses. */
  readonly cleanupOperations?: CleanupOperations;
  /** U-91: the check's executor file operations, probe removal and lock release. Tests give ones that fail. */
  readonly applyCheck?: ApplyCheckOperations;
  /** U-172: writeWorkspaceText's lock release, and a pause at each check (V-1's races). Tests only. */
  readonly workspaceText?: WorkspaceTextOperations;
  /** U-234: the changes view's reads (a wrapped workspace). Tests only; the signal comes from the call. */
  readonly changesRead?: Pick<ReadChangesDeps, "createWorkspace">;
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

  /**
   * The CLI's run environment with this environment's parts. `env` is the call's own copy; the
   * variables file is loaded into it, never into the caller's object or `process.env`. U-218: also
   * the `run` environment of an apply that carries out a run plan, on the apply's own copy, so the
   * variables file its preparation loaded is the run's.
   */
  function cliEnvironmentOf(
    argv: readonly string[],
    env: Record<string, string | undefined>,
    parts: Pick<CliEnvironment, "assemble" | "cancelSignal"> & { readonly runTask?: RunTask; readonly runApprovedPlan?: RunApprovedPlan },
  ): CliEnvironment {
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
   * The hooks of a run through the app, for the CLI's run environment: startRun's, and since U-218
   * those of the run that carries out an approved run plan (applyPlan).
   * - The assembly (createAppAssemble): DR-15's events from the records the engine appends, masked
   *   again with the run's gateway, to `observer`; U-108's permission questions to `observer.confirm`;
   *   U-193's lockLeft.
   * - The start gate (adapter-contract 5.1): `started` gives the run id and workspace once the run
   *   is assembled; the engine (runTask, or runApprovedPlan for an approved plan) waits for `open`,
   *   which the caller calls after it handed out the handle, so the id is known before the first event.
   * - The cancel channel: no signal handler on the process; the CLI's two signal sources become
   *   `cancel`, and the cancel file, when requested, is watched as in the CLI (P-2).
   */
  function appRunHooks(env: Record<string, string | undefined>, observer: RunObserver | undefined) {
    const cancelHandlers = new Set<() => void>();
    let reportStart: (value: { runId: string; workspaceRoot: string; privacy: PrivacyGateway }) => void = () => {};
    const started = new Promise<{ runId: string; workspaceRoot: string; privacy: PrivacyGateway }>((resolve) => {
      reportStart = resolve;
    });
    let openGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    /** Notices of the engine's own result; the CLI may add more afterwards (Y-4). */
    let engineNotices: number | null = null;
    let assembledRun: { readonly privacy: PrivacyGateway; readonly workspaceRoot: string } | null = null;
    /** U-193: the run's lock could not be released at its end (told in the outcome, the result kept). */
    let lockLeft = false;
    const ownAssemble = createAppAssemble(
      env,
      platform,
      (assembled) => {
        assembledRun = assembled;
      },
      () => {
        lockLeft = true;
      },
    );
    const assemble: Assemble = async (input) => {
      const assembled = await ownAssemble(input);
      if (!assembled.ok || assembledRun === null) return assembled;
      const { privacy, workspaceRoot } = assembledRun;
      // DR-15: events from the records the engine appends, in memory, masked again with this gateway.
      const journal = journalWithEvents(assembled.deps.journal, observer, privacy);
      reportStart({ runId: input.runId, workspaceRoot, privacy });
      // U-108 (B-4, DR-3): the engine's permission questions go to the observer (permission.ts).
      return { ...assembled, deps: { ...assembled.deps, journal, confirm: confirmThrough(observer) } };
    };
    const runTask: RunTask = async (deps) => {
      await gate;
      await nextMacrotask();
      const ended = await (hooks.runTask ?? engineRunTask)(deps);
      engineNotices = ended.notices.length;
      return ended;
    };
    const runApprovedPlan: RunApprovedPlan = async (deps) => {
      await gate;
      await nextMacrotask();
      const ended = await (hooks.runApprovedPlan ?? engineRunApprovedPlan)(deps);
      engineNotices = ended.notices.length;
      return ended;
    };
    const cancelSignal: CliEnvironment["cancelSignal"] = (cancelFile) =>
      createRunCancelSource({
        cancelFile,
        fileExists: (file) => existsSync(file),
        onSignal: (name, handler) => {
          // U-293 (C-6a, 6.2): the process's signals too, when the adapter listens to them (AppEnvironment.onSignal, the CLI).
          // Codex V-31 L-1: kept for handle.cancel only once that registration worked, and taken out
          // before the adapter's removal is called (cancel.ts tries each removal on its own).
          const off = environment.onSignal?.(name, handler);
          cancelHandlers.add(handler);
          return () => {
            cancelHandlers.delete(handler);
            off?.();
          };
        },
      });
    return {
      parts: { assemble, runTask, runApprovedPlan, cancelSignal },
      started,
      open: (): void => openGate(),
      cancel: (): void => {
        for (const handler of [...cancelHandlers]) handler();
      },
      /** The run's end, from the CLI's result: the notices the CLI added are delivered; whether the lock was left. */
      ended: (output: EngineResult): { readonly lockLeft: boolean } => {
        if (engineNotices !== null) {
          for (const text of output.notices.slice(engineNotices)) deliver(observer, { kind: "notice", text });
        }
        return { lockLeft };
      },
    };
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
    const run = appRunHooks(env, observer);
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

  /**
   * The secrets and the workspace of these settings for a reading command (DR-7, DR-17): the CLI's
   * own steps 1 to 7 (prepareTask), the ones `run`, `plan`, `apply` and `review` share, so the
   * secrets are the ones a run with these settings registers now. U-17 (DR-46): as a command that
   * runs nothing (`readOnly`), so the quick form needs no key, model or run limits. No lock,
   * journal or file is made and nothing is sent. Used by `changes`, `listWorkspaceDir` and `listRunEvents`. U-89: also
   * the effective policy's protected paths and every API key value set now (with the variables file).
   */
  async function readingSecrets(
    settings: TaskForm,
  ): Promise<
    | {
        readonly ok: true;
        readonly secrets: readonly string[];
        readonly workspaceRoot: string;
        readonly protectedPaths: readonly string[] | undefined;
        readonly keys: readonly string[];
        readonly task: ResolvedTaskSpec;
        /** U-172: the config, task and variables files these settings name, absolute (the config as prepareTask chose it). */
        readonly settingsFiles: readonly string[];
      }
    | { readonly ok: false; readonly error: AppError }
  > {
    const env = copyEnvironment(environment.env, platform);
    const args: RunArgs = {
      command: "run",
      input: settings.input.kind === "task" ? { kind: "task", taskPath: settings.input.taskPath } : { kind: "quick", workspace: settings.input.workspace, goal: PROBE_GOAL, oneLine: false },
      configPath: settings.configPath,
      varsFile: settings.varsFile,
      cancelFile: null,
      quiet: true,
      profile: settings.profile,
      workflow: settings.workflowRef,
    };
    const io: PrepareEnvironment = {
      env,
      cwd: environment.cwd,
      readFile: environment.readFile,
      isDirectory: environment.isDirectory,
      loadEnvFile: (file) => loadVarsInto(env, file, environment.readVarsFile),
      locateInWorkspace: locate,
      relatePaths: relate,
      installDir: environment.installDir,
      // N-1: the same default config location the CLI reads (main.ts).
      defaultConfig: defaultConfigOf(),
    };
    const notes: RunNotes = { configLanguage: null, configDefault: null, deniedToolCalls: 0, deniedCommandCalls: 0, failedToolCalls: 0 };
    const ready = await prepareTask(io, args, notes, { readOnly: true });
    if (!("prepared" in ready)) return { ok: false, error: ready.output.kind === "error" ? fromCliError(ready.output) : INTERNAL_ERROR };
    // U-172: with the variables file loaded, as prepareTask chose the config.
    const settingsFiles: string[] = [];
    if (settings.input.kind === "task") settingsFiles.push(path.resolve(environment.cwd, settings.input.taskPath));
    if (settings.varsFile !== null) settingsFiles.push(path.resolve(environment.cwd, settings.varsFile));
    const config = chooseConfigFile({ argument: settings.configPath, env, cwd: environment.cwd, defaultLocation: defaultConfigOf() });
    if (config.ok && config.candidate !== null) settingsFiles.push(config.candidate.path);
    return {
      ok: true,
      secrets: ready.prepared.secrets,
      workspaceRoot: ready.prepared.task.workspaceRoot,
      protectedPaths: ready.prepared.task.policy.protectedPaths,
      keys: knownKeyValues(env),
      task: ready.prepared.task,
      settingsFiles,
    };
  }

  /** DR-7, DR-29: a run's changes. U-234 (R-107 O-1): `options.signal` is given to the reads of the current files. */
  async function changes(request: ChangesRequest, options: ChangesOptions = {}): Promise<AppCallOutcome<ChangesOutput>> {
    try {
      const probe = await readingSecrets(request.settings);
      if (!probe.ok) return probe;
      const root = await workspaceRootOf(probe.workspaceRoot, environment.cwd);
      if (!root.ok) return root;
      const runId = await runIdOf(root.value, request.runId);
      if (!runId.ok) return runId;
      return await readChanges(root.value, runId.value, createPrivacyGateway({ secrets: probe.secrets }), {
        ...hooks.changesRead,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch {
      return { ok: false, error: appError("internal_error", "the changes could not be read") };
    }
  }

  /** U-89 (GUI 3.3, adapter-contract 5.12): one directory of the workspace (workspace-dir.ts). */
  async function listWorkspaceDir(request: ListWorkspaceDirRequest): Promise<AppCallOutcome<WorkspaceDirListing>> {
    // The request first: nothing is read for one that does not fit.
    const checked = workspaceDirArguments(request);
    if (!checked.ok) return checked;
    try {
      const probe = await readingSecrets(request.settings);
      if (!probe.ok) return probe;
      const root = await workspaceRootOf(probe.workspaceRoot, environment.cwd);
      if (!root.ok) return root;
      const source = { workspaceRoot: root.value, privacy: createPrivacyGateway({ secrets: probe.secrets }), keys: probe.keys, protectedPaths: probe.protectedPaths };
      return await listWorkspaceDirIn(source, checked.dir, checked.offset, checked.limit);
    } catch {
      return { ok: false, error: appError("internal_error", "the directory could not be listed") };
    }
  }

  /** U-172: what the settings resolve to for a workspace text file. */
  async function workspaceTextSource(settings: TaskForm): Promise<{ readonly ok: true; readonly source: WorkspaceTextSource } | { readonly ok: false; readonly error: AppError }> {
    const probe = await readingSecrets(settings);
    if (!probe.ok) return probe;
    const root = await workspaceRootOf(probe.workspaceRoot, environment.cwd);
    if (!root.ok) return root;
    return {
      ok: true,
      source: { workspaceRoot: root.value, privacy: createPrivacyGateway({ secrets: probe.secrets }), keys: probe.keys, protectedPaths: probe.protectedPaths, settingsFiles: probe.settingsFiles },
    };
  }

  /** U-172 (DR-72, adapter-contract 5.15): a workspace text file for a person, and whether it can be edited here (workspace-text.ts). */
  async function readWorkspaceText(request: ReadWorkspaceTextRequest): Promise<AppCallOutcome<WorkspaceText>> {
    // The request first: nothing is read for one that does not fit.
    const checked = readWorkspaceTextArguments(request);
    if (!checked.ok) return checked;
    try {
      const ready = await workspaceTextSource(request.settings);
      if (!ready.ok) return ready;
      return await readWorkspaceTextIn(ready.source, checked.path, hooks.workspaceText);
    } catch {
      return { ok: false, error: appError("internal_error", "the file could not be read") };
    }
  }

  /** U-172 (DR-72, adapter-contract 5.15): a person's edit, judged again under the workspace lock; no run record (workspace-text.ts). */
  async function writeWorkspaceText(request: WriteWorkspaceTextRequest): Promise<AppCallOutcome<WorkspaceTextWritten>> {
    // The request first: nothing is read or locked for one that does not fit.
    const checked = writeWorkspaceTextArguments(request);
    if (!checked.ok) return checked;
    try {
      const ready = await workspaceTextSource(request.settings);
      if (!ready.ok) return ready;
      return await writeWorkspaceTextIn(
        { ...ready.source, clock: environment.clock, randomBytes: environment.randomBytes },
        { path: checked.path, text: checked.text, baseDigest: checked.baseDigest },
        hooks.workspaceText,
      );
    } catch {
      return { ok: false, error: appError("internal_error", "the file could not be written") };
    }
  }

  /** U-90 (GUI 3.7, adapter-contract 5.13): one page of a run's stored records (run-events.ts). */
  async function listRunEvents(request: ListRunEventsRequest): Promise<AppCallOutcome<RunEventsPage>> {
    // The request first: nothing is read for one that does not fit.
    const checked = runEventsArguments(request);
    if (!checked.ok) return checked;
    try {
      const probe = await readingSecrets(request.settings);
      if (!probe.ok) return probe;
      const root = await workspaceRootOf(probe.workspaceRoot, environment.cwd);
      if (!root.ok) return root;
      const source = { workspaceRoot: root.value, privacy: createPrivacyGateway({ secrets: probe.secrets }), keys: probe.keys };
      return await listRunEventsIn(source, checked.runId, checked.offset, checked.limit, checked.types);
    } catch {
      return { ok: false, error: appError("internal_error", "the run's records could not be listed") };
    }
  }

  async function report(request: ReportRequest): Promise<AppCallOutcome<ReportOutput>> {
    try {
      // U-316: keep parsing and final masking, while the app reader owns the stored-record rules.
      const io = {
        argv: ["report", "--workspace", request.workspace, "--run", request.runId, "--json"],
        cwd: environment.cwd,
        env: copyEnvironment(environment.env, platform),
        platform,
        listRuns: storeListRuns,
      };
      const parsed = parseReportArgs(io.argv);
      if (!parsed.ok) return { ok: false, error: fromCliError(argumentsError(parsed).output) };
      const read = await readReport(io, { workspace: parsed.args.workspace, run: parsed.args.runId, planApplyLine: false });
      if (!read.ok) return { ok: false, error: commandError(read.outcome) };
      const currentKey = knownKeyValues(io.env);
      let text: string;
      try {
        text = jsonLine(hideKeysInStrings(read.report, currentKey));
      } catch {
        return { ok: false, error: fromCliError(cliError("invalid_run_record", "the run's records cannot be shown").output) };
      }
      // Preserve the second, whole-text masking pass and JSON parsing failure behavior.
      return jsonOutcome<ReportOutput>({ text: hideKeys(text, currentKey), exitCode: read.report.exitCode }, "report");
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /** GU-3: `codaryn report` without `--json`, as main.ts prints it. */
  async function reportMarkdown(request: ReportRequest): Promise<AppCallOutcome<ReportMarkdown>> {
    // The values go after their flags; one that starts with "-" could be read as a flag instead.
    if (request.workspace.startsWith("-") || request.runId.startsWith("-")) {
      return { ok: false, error: appError("invalid_arguments", "the workspace and the run id cannot start with '-'") };
    }
    try {
      const io = {
        argv: ["report", "--workspace", request.workspace, "--run", request.runId],
        cwd: environment.cwd,
        env: copyEnvironment(environment.env, platform),
        platform,
        listRuns: storeListRuns,
      };
      const parsed = parseReportArgs(io.argv);
      if (!parsed.ok) return { ok: false, error: fromCliError(argumentsError(parsed).output) };
      const read = await readReport(io, { workspace: parsed.args.workspace, run: parsed.args.runId, planApplyLine: true });
      if (!read.ok) return { ok: false, error: commandError(read.outcome) };
      const currentKey = knownKeyValues(io.env);
      let text: string;
      try {
        text = "runKind" in read.report
          ? renderApplyReport(read.report, currentKey)
          : renderReport(read.report, currentKey, read.failedToolCalls, read.planApply);
      } catch {
        return { ok: false, error: fromCliError(cliError("invalid_run_record", "the run's records cannot be shown").output) };
      }
      return { ok: true, output: { kind: "report_markdown", markdown: hideKeys(text, currentKey), exitCode: read.report.exitCode } };
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async function revert(request: RevertRequest): Promise<RevertCallOutcome> {
    // DR-25: only the consent the person gave on screen for this run, as the adapter's consent.
    const consent = revertConsentOf(request);
    if (!consent.ok) return consent;
    try {
      // The CLI's revert with the options main.ts gives it (N-7, N-16, N-26, N-27 a): dry run,
      // "latest", the store's judgement of one run, and the revert record written under the lock.
      // As an adapter (AdapterRevert): no terminal question, the consent only from the request.
      const { output, lockLeft } = await runRevert({
        argv: ["revert", "--workspace", request.workspace, "--run", request.runId, ...(request.dryRun === true ? ["--dry-run"] : [])],
        cwd: environment.cwd,
        isDirectory: environment.isDirectory,
        clock: environment.clock,
        randomBytes: environment.randomBytes,
        revert: createRevertCommand(revertRun, {
          dryRun: revertRun,
          listRuns: storeListRuns,
          readRecord: readRevertRecord,
          writeRecord: writeRevertRecord,
          inspect: inspectRun,
        }),
        adapter: { unsafeMoveConsent: consent.consent },
      });
      if (output.kind !== "revert") return { ok: false, error: fromCliError(output) };
      // U-229 (R-106 L-1, after U-220): a lock the revert could not release is told beside its output.
      return lockLeft === true ? { ok: true, output, lockLeft: true } : { ok: true, output };
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async function listRuns(request: ListRunsRequest): Promise<AppCallOutcome<RunsOutput>> {
    try {
      return await listRunsIn(environment, request);
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  // DR-39: the store's summary, plan and cleanup with the app layer's checks (cleanup.ts).
  const stateSummary = (request: StateSummaryRequest) => stateSummaryIn(environment, request);
  const previewCleanup = (request: CleanupPreviewRequest) => previewCleanupIn(environment, request);
  const applyCleanup = (request: ApplyCleanupRequest) => applyCleanupIn(environment, request, hooks.cleanupOperations);

  async function resolveRun(request: ResolveRunRequest): Promise<AppCallOutcome<ResolvedRun>> {
    try {
      return await resolveRunIn(environment, request);
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
        // As main.ts: the default config location (N-1), whether it is refused, and where the
        // language comes from (N-20). The messages stay English: the app returns codes and fields.
        defaultConfig: defaultConfigOf(),
        defaultConfigRefused: defaultLocationRefused(platform, environment.env, environment.homeDir ?? null),
        osLocale: environment.osLocale ?? null,
        explainLanguage: explainMessageLanguage,
      });
      return jsonOutcome<DoctorOutput>(outcome, "doctor");
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /** `codaryn models` as main.ts calls it, with this environment and no terminal question. */
  async function models(request: ListModelsRequest | SelectModelRequest): Promise<AppCallOutcome<ModelsOutput>> {
    const args = modelsArguments(request);
    if (!args.ok) return args;
    const env = copyEnvironment(environment.env, platform);
    try {
      const outcome = await runModels({
        argv: args.argv,
        env,
        cwd: environment.cwd,
        readFile: environment.readFile,
        loadEnvFile: (file) => loadVarsInto(env, file, environment.readVarsFile),
        listModels: hooks.listModels ?? anthropicModelLister,
        // SP-6: each provider's lister, as main.ts gives them; `--provider` (modelsArguments) picks one.
        listers: API_MODEL_LISTERS,
        anthropicDeps: hooks.anthropicDeps,
        ...(hooks.providerDeps === undefined ? {} : { providerDeps: hooks.providerDeps }),
        defaultConfig: defaultConfigOf(),
        ...(hooks.writeConfig === undefined ? {} : { writeConfig: hooks.writeConfig }),
      });
      return jsonOutcome<ModelsOutput>(outcome, "models");
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  const listModels = (request: ListModelsRequest) => models(request);
  const selectModel = (request: SelectModelRequest) => models(request);

  async function readSettings(request: ReadSettingsRequest): Promise<AppCallOutcome<SettingsView>> {
    try {
      return await readSettingsIn(
        { env: copyEnvironment(environment.env, platform), cwd: environment.cwd, readFile: environment.readFile, defaultConfig: defaultConfigOf() },
        request,
      );
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /** `codaryn init --json` as main.ts calls it, without questions (no `ask`). */
  async function createSettings(request: CreateSettingsRequest): Promise<AppCallOutcome<InitOutput>> {
    try {
      const outcome = await runInit({
        argv: initArguments(request),
        env: copyEnvironment(environment.env, platform),
        cwd: environment.cwd,
        platform,
        defaultConfig: defaultConfigOf(),
        defaultConfigRefused: defaultLocationRefused(platform, environment.env, environment.homeDir ?? null),
        // --json prints no text; the catalog is only what runInit needs to exist.
        messages: createMessageCatalog("en"),
        readFile: environment.readFile,
        isDirectory: environment.isDirectory,
        exists: async (target) => {
          try {
            await lstat(target);
            return true;
          } catch {
            return false;
          }
        },
        locateInWorkspace: locate,
        makeDirectory: async (dir) => {
          await mkdir(dir, { recursive: true });
        },
        writeNewFile: (file, text) => writeFile(file, text, { encoding: "utf8", flag: "wx" }),
      });
      return jsonOutcome<InitOutput>(outcome, "init");
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async function settingsSuggestions(request: SettingsSuggestionsRequest): Promise<AppCallOutcome<SettingsSuggestions>> {
    try {
      const root = await workspaceRootOf(request.workspace, environment.cwd);
      if (!root.ok) return root;
      return { ok: true, output: await suggestionsFor(root.value) };
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  const settingsIo = () => ({
    env: copyEnvironment(environment.env, platform),
    cwd: environment.cwd,
    readFile: environment.readFile,
    defaultConfig: defaultConfigOf(),
  });

  async function proposeSettingsChange(request: SettingsChangeRequest): Promise<AppCallOutcome<SettingsChangeProposal>> {
    try {
      return await proposeSettingsChangeIn(settingsIo(), request);
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async function applySettingsChange(request: ApplySettingsChangeRequest): Promise<AppCallOutcome<SettingsWritten>> {
    try {
      return await applySettingsChangeIn(settingsIo(), request, hooks.writeConfig);
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /**
   * The task form's environment for `plan`, `apply` and `review` (G-F), as main.ts builds it, with
   * this call's own environment copy: the variables file is loaded into it, never into the
   * caller's object or `process.env`.
   */
  function planCommandEnvironment(argv: readonly string[]): PlanCommandEnvironment & { readonly env: Record<string, string | undefined> } {
    const env = copyEnvironment(environment.env, platform);
    return {
      argv,
      env,
      cwd: environment.cwd,
      readFile: environment.readFile,
      isDirectory: environment.isDirectory,
      loadEnvFile: (file) => loadVarsInto(env, file, environment.readVarsFile),
      locateInWorkspace: locate,
      relatePaths: relate,
      installDir: environment.installDir,
      defaultConfig: defaultConfigOf(),
      clock: environment.clock,
      randomBytes: environment.randomBytes,
      listRuns: storeListRuns,
    };
  }

  /** DR-5, DR-17: `codaryn plan --json`: the stored plan masked again with this task form's secrets. Reads only. */
  async function plan(request: PlanRequest): Promise<AppCallOutcome<AnyPlanOutput>> {
    try {
      // U-196: a run plan is shown by the app until the CLI's plan view chooses by kind (U-195).
      const changes = await runPlanView(request);
      if (changes !== null) return changes;
      // U-308 (C-7a's app side): the plan view's rules are the app layer's (showPlan, plan-view.ts), no
      // longer the CLI's runPlan around them; the request is still judged by the CLI's parser, as before.
      const argv = planArguments(request);
      const parsed = parsePlanArgs(argv);
      if (!parsed.ok) return { ok: false, error: fromCliError(argumentsError(parsed).output) };
      const shown = await showPlan(planCommandEnvironment(argv), parsed.args.form, parsed.args.runId);
      if (!shown.ok) return { ok: false, error: commandError(shown.outcome) };
      // As jsonOutcome judged runPlan's JSON line: only a plan of mode apply is this call's output here.
      return shown.kind === "plan" ? { ok: true, output: shown.output } : { ok: false, error: INTERNAL_ERROR };
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /** GT-D6, R-4 L-4: `codaryn review --json`: the person's verdict, the note masked before it is stored. */
  async function review(request: ReviewRequest): Promise<AppCallOutcome<ReviewOutput>> {
    const args = reviewArguments(request);
    if (!args.ok) return args;
    try {
      // U-308 (C-7a's app side): the review's rules are the app layer's (recordReview, plan-view.ts), no
      // longer the CLI's runReview around them; the request is still judged by the CLI's parser, as before.
      const parsed = parseReviewArgs(args.argv);
      if (!parsed.ok) return { ok: false, error: fromCliError(argumentsError(parsed).output) };
      const review = parsed.args;
      const recorded = await recordReview(planCommandEnvironment(args.argv), { form: review.form, run: review.runId, verdict: review.verdict, note: review.note, revertLine: !review.json });
      if (!recorded.ok) return { ok: false, error: commandError(recorded.outcome) };
      return { ok: true, output: recorded.output };
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /**
   * DR-1, DR-2, DR-21: the CLI's `apply` as an adapter (AdapterApply): the approval is recorded as
   * `adapter` and the consent comes only from the request. The CLI chooses by the task's plan setting.
   * - A plan of moves (plan "apply"): the engine is the same `applyPlan`; only its journal is
   *   wrapped so the apply's events reach `observer.onEvent` (start records left out).
   * - U-218 (DR-69 B-4, after U-195): a run plan (plan "run") is carried out by a model run, the
   *   CLI's applyChangesPlan with the `run` environment: the hooks of a run through the app
   *   (appRunHooks), whose events reach `observer.onRunEvent` and permission questions
   *   `observer.confirm`. The outcome is that run's EngineResult (planRunId, planDigest) with
   *   lockLeft as a run's.
   * Either way the handle, with the id of the run that applies, comes before the first event, and
   * handle.cancel() is the one cancel channel.
   */
  async function applyPlan(
    request: ApplyPlanRequest,
    observer?: ApplyObserver,
  ): Promise<{ readonly ok: true; readonly handle: ApplyHandle } | { readonly ok: false; readonly error: AppError }> {
    const consent = unsafeMoveConsentOf(request);
    if (!consent.ok) return consent;
    const argv = applyArguments(request);
    const io = planCommandEnvironment(argv);
    // U-218: the carrying run's observer: its events and permission questions, read from `observer` when they come.
    const runObserver: RunObserver | undefined =
      observer === undefined
        ? undefined
        : {
            onEvent: (event) => observer.onRunEvent?.(event),
            confirm: (question, signal) => {
              const ask = observer.confirm;
              return typeof ask === "function" ? ask.call(observer, question, signal) : Promise.resolve({ decision: "dismissed" });
            },
          };
    const run = appRunHooks(io.env, runObserver);
    let reportMoves: (runId: string) => void = () => {};
    const movesStarted = new Promise<string>((resolve) => {
      reportMoves = resolve;
    });
    let openMoves: () => void = () => {};
    const movesGate = new Promise<void>((resolve) => {
      openMoves = resolve;
    });
    const wrapped: ApplyPlan = async (deps) => {
      const journal = applyJournalWithEvents(deps.journal, observer, deps.privacy);
      reportMoves(deps.runId);
      await movesGate;
      await nextMacrotask();
      return (hooks.applyPlan ?? engineApplyPlan)({ ...deps, journal });
    };
    const running = runApply({
      ...io,
      applyPlan: wrapped,
      adapter: { unsafeMoveConsent: consent.consent },
      cancelSignal: run.parts.cancelSignal,
      run: cliEnvironmentOf(argv, io.env, run.parts),
    }).catch(() => null);

    const first = await Promise.race([
      movesStarted.then((runId) => ({ kind: "started" as const, runId })),
      run.started.then((info) => ({ kind: "started" as const, runId: info.runId })),
      running.then((outcome) => ({ kind: "ended" as const, outcome })),
    ]);
    if (first.kind === "ended") {
      const output = first.outcome !== null && "output" in first.outcome ? first.outcome.output : undefined;
      return { ok: false, error: output?.kind === "error" ? fromCliError(output) : INTERNAL_ERROR };
    }
    const done: Promise<ApplyOutcome> = running.then((outcome): ApplyOutcome => {
      const output = outcome !== null && "output" in outcome ? outcome.output : undefined;
      if (output?.kind === "apply") return { ok: true, output: output as ApplyResult };
      if (output?.kind === "run") {
        const result = output as EngineResult;
        return run.ended(result).lockLeft ? { ok: true, output: result, lockLeft: true } : { ok: true, output: result };
      }
      return { ok: false, error: output?.kind === "error" ? fromCliError(output) : INTERNAL_ERROR };
    });
    const handle: ApplyHandle = {
      runId: first.runId,
      cancel: run.cancel,
      done,
    };
    openMoves();
    run.open();
    return { ok: true, handle };
  }

  /**
   * U-91 (GUI 3.9, DR-21, adapter-contract 5.14): the apply's preflight for a pending plan, under
   * the workspace lock, with nothing moved or recorded (check-apply.ts). The refusals first, as
   * `apply` makes them: the apply task's plan setting, the plan view's own (run, plan, DR-28), the
   * plan already applied, a records-changed mark, the digest.
   */
  async function checkApply(request: CheckApplyRequest): Promise<AppCallOutcome<PlanCheck>> {
    const checked = checkApplyArguments(request);
    if (!checked.ok) return checked;
    try {
      const probe = await readingSecrets(request.settings);
      if (!probe.ok) return probe;
      const planRoot = await workspaceRootOf(probe.workspaceRoot, environment.cwd);
      if (!planRoot.ok) return planRoot;
      // Review R-103 L-1: a plan that cannot be read is refused with the store's code first, as the
      // plan view refuses it (the same store, the same codes), not taken for a plan of mode apply.
      const stored = await storedPlanKindOf(planRoot.value, checked.planRunId);
      if (!stored.ok) return { ok: false, error: appError(stored.code, `run ${checked.planRunId} has no plan that can be checked (${stored.code}); nothing was checked`) };
      // U-196 (DR-69 B-3, B-4): a run plan is checked as its run will judge it (changes-plan.ts).
      if (stored.kind === "changes") return await checkRunPlan(probe, planRoot.value, checked.planRunId, checked.digest);
      if (workflowSettingsOf(probe.task).plan !== "apply") {
        return { ok: false, error: appError("run_not_plan", 'the task given to the check does not resolve to a workflow with plan "apply"; nothing was checked') };
      }
      const shown = await plan({ settings: request.settings, runId: checked.planRunId });
      if (!shown.ok) return shown;
      if ("planKind" in shown.output) return { ok: false, error: appError("internal_error", "the plan changed its kind while it was checked; nothing was checked") };
      const view = { output: shown.output };
      if (view.output.appliedBy !== null) return { ok: false, error: appError("plan_already_applied", "that plan was already applied; nothing was checked") };
      if (view.output.recordsChanged === true) {
        return { ok: false, error: appError("plan_records_changed", "the plan run's records were changed by something other than the run, so its plan may not be the one shown; nothing was checked") };
      }
      if (!view.output.digest.startsWith(checked.digest)) {
        return { ok: false, error: appError("plan_not_approved", "the digest does not match the plan's digest; nothing was checked") };
      }
      return await checkApplyIn(
        {
          workspaceRoot: planRoot.value,
          task: probe.task,
          planRunId: checked.planRunId,
          digest: view.output.digest,
          inventoryLimitReached: view.output.inventoryLimitReached,
          clock: environment.clock,
          randomBytes: environment.randomBytes,
        },
        hooks.applyCheck,
      );
    } catch {
      return { ok: false, error: appError("internal_error", "the plan could not be checked; nothing was moved") };
    }
  }

  /**
   * U-196 (DR-69 B-3, B-4): checkApply on a run plan. The apply task must resolve to plan "run" (no
   * setting can before B-4, U-177); then the view's refusals as for a plan of mode apply (DR-28,
   * already carried out, records-changed mark, digest), then each planned file judged by the gate
   * the run will have (checkChangesPlanFiles). No lock, no probe, no move: those fields are empty.
   */
  async function checkRunPlan(
    probe: { readonly secrets: readonly string[]; readonly keys: readonly string[]; readonly task: ResolvedTaskSpec },
    workspaceRoot: string,
    planRunId: string,
    digest: string,
  ): Promise<AppCallOutcome<PlanCheck>> {
    if (workflowSettingsOf(probe.task).plan !== "run") {
      return { ok: false, error: appError("run_not_plan", 'the plan is a run plan: the task given to the check must resolve to a workflow with plan "run"; nothing was checked') };
    }
    const view = await changesPlanViewIn({ workspaceRoot, privacy: createPrivacyGateway({ secrets: probe.secrets }), keys: probe.keys }, planRunId);
    if (!view.ok) return view;
    const shown = view.output.output;
    if (shown.appliedBy !== null) return { ok: false, error: appError("plan_already_applied", "that plan was already carried out; nothing was checked") };
    if (shown.recordsChanged === true) {
      return { ok: false, error: appError("plan_records_changed", "the plan run's records were changed by something other than the run, so its plan may not be the one shown; nothing was checked") };
    }
    if (!shown.digest.startsWith(digest)) return { ok: false, error: appError("plan_not_approved", "the digest does not match the plan's digest; nothing was checked") };
    const problems = await checkChangesPlanFiles(
      {
        workspaceRoot,
        policy: probe.task.policy,
        ...(probe.task.writablePathSets === undefined ? {} : { writablePathSets: probe.task.writablePathSets }),
        // U-237 (R-108 H-2): the run's unreadable paths, as the carried-out run's gate has them.
        ...(probe.task.unreadablePaths === undefined ? {} : { unreadablePaths: probe.task.unreadablePaths }),
      },
      view.output.files,
    );
    return {
      ok: true,
      output: {
        kind: "plan_check",
        planKind: "changes",
        planRunId,
        digest: shown.digest,
        checkedAt: new Date(environment.clock.now()).toISOString(),
        problems: problems.map((item) => ({ index: item.index, problem: item.problem })),
        unsafeMoves: [],
        inventoryLimitReached: false,
        probesLeft: 0,
        probesRemoved: 0,
        lockLeft: false,
      },
    };
  }

  /** U-196: a run plan's view (changes-plan.ts), or null for any other request (the CLI's plan view then). */
  async function runPlanView(request: PlanRequest): Promise<AppCallOutcome<ChangesPlanOutput> | null> {
    if (typeof request !== "object" || request === null || typeof request.runId !== "string") return null;
    const probe = await readingSecrets(request.settings);
    if (!probe.ok) return null;
    const root = await workspaceRootOf(probe.workspaceRoot, environment.cwd);
    if (!root.ok) return null;
    const runId = await runIdOf(root.value, request.runId);
    if (!runId.ok) return null;
    const stored = await storedPlanKindOf(root.value, runId.value);
    // Not a run plan, or none that can be read: the CLI's plan view, which gives the store's code.
    if (!stored.ok || stored.kind !== "changes") return null;
    const view = await changesPlanViewIn({ workspaceRoot: root.value, privacy: createPrivacyGateway({ secrets: probe.secrets }), keys: probe.keys }, runId.value);
    return view.ok ? { ok: true, output: view.output.output } : view;
  }

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
