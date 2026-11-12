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
import { lstat, mkdir, writeFile } from "node:fs/promises";
import type {
  AnthropicProviderDeps,
  CreateAnthropicProvider,
  DefaultConfigLocation,
  DoctorOutput,
  InitOutput,
  ListAnthropicModels,
  ModelsOutput,
  PrivacyGateway,
  ReportOutput,
  RevertOutput,
  RunTask,
  RunsOutput,
} from "../contracts/index.js";
import { runTask as engineRunTask } from "../engine/index.js";
import { createMessageCatalog, explainMessageLanguage } from "../i18n/index.js";
import { createPrivacyGateway } from "../privacy/index.js";
import { inspectRun, listRuns as storeListRuns, readRevertRecord, revertRun, writeRevertRecord } from "../store/index.js";
import { createRevertCommand } from "../cli/assemble.js";
import type { Assemble } from "../cli/assemble.js";
import { createCancelSource } from "../cli/cancel.js";
import { defaultLocationRefused, findDefaultConfigLocation } from "../cli/config-file.js";
import { runDoctor } from "../cli/doctor.js";
import type { CommandOutcome } from "../cli/guard.js";
import { runInit } from "../cli/init.js";
import { runModels } from "../cli/models.js";
import type { ModelsEnvironment } from "../cli/models.js";
import { anthropicModelLister } from "../cli/provider.js";
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
import { modelsArguments } from "./models.js";
import { listRunsIn, resolveRunIn, runIdOf, workspaceRootOf } from "./runs.js";
import { readSettingsIn } from "./settings.js";
import { initArguments, suggestionsFor } from "./init.js";
import type {
  AppCallOutcome,
  AppEnvironment,
  AppError,
  ChangesOutput,
  ChangesRequest,
  CodarynApp,
  DoctorRequest,
  ListModelsRequest,
  ListRunsRequest,
  CreateSettingsRequest,
  ReadSettingsRequest,
  ReportRequest,
  SelectModelRequest,
  SettingsSuggestions,
  SettingsSuggestionsRequest,
  SettingsView,
  ResolvedRun,
  ResolveRunRequest,
  RevertRequest,
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
  readonly runTask?: RunTask;
  /** The model listing (`listAnthropicModels` when absent). Tests give a fake so nothing is sent. */
  readonly listModels?: ListAnthropicModels;
  /** The config writer of `selectModel` (`writeConfigAtomic` when absent). */
  readonly writeConfig?: ModelsEnvironment["writeConfig"];
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

const nextMacrotask = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Stands for "stop here" in the secrets probe; never shown, the probe reports its own outcome. */
const PROBE_STOP = "the settings were resolved; nothing was run";

/**
 * The goal the secrets probe gives `runCli` for the workspace form. The probe never runs anything
 * and no goal decides a secret; the CLI's quick form only needs one to parse (S-8 finds no key in it).
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
    workflowRef: null,
    cancelFile: null,
  };
}

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
      // N-1: the same default config location the CLI reads (main.ts).
      defaultConfig: defaultConfigOf(),
      createAnthropicProvider: hooks.createAnthropicProvider,
      anthropicDeps: hooks.anthropicDeps,
      ...parts,
    }).catch(() => null);
  }

  /** N-1: where the CLI would look for the user's config file now, from this environment. */
  function defaultConfigOf(): DefaultConfigLocation | null {
    return findDefaultConfigLocation(platform, environment.env, environment.homeDir ?? null);
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
      const probe = await probeSecrets(runRequestOf(request.settings));
      if (!probe.ok) return probe;
      const root = await workspaceRootOf(probe.workspaceRoot, environment.cwd);
      if (!root.ok) return root;
      const runId = await runIdOf(root.value, request.runId);
      if (!runId.ok) return runId;
      return await readChanges(root.value, runId.value, createPrivacyGateway({ secrets: probe.secrets }), platform);
    } catch {
      return { ok: false, error: appError("internal_error", "the changes could not be read") };
    }
  }

  async function report(request: ReportRequest): Promise<AppCallOutcome<ReportOutput>> {
    try {
      // N-7: the CLI's report resolves "latest" with the store's rules (N-18, N-23, N-26).
      const outcome = await runReport({
        argv: ["report", "--workspace", request.workspace, "--run", request.runId, "--json"],
        cwd: environment.cwd,
        env: copyEnvironment(environment.env, platform),
        platform,
        listRuns: storeListRuns,
      });
      return jsonOutcome<ReportOutput>(outcome, "report");
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async function revert(request: RevertRequest): Promise<AppCallOutcome<RevertOutput>> {
    try {
      // The CLI's revert with the options main.ts gives it (N-7, N-16, N-26): dry run, "latest",
      // the damage check, and the revert record written under the lock.
      const { output } = await runRevert({
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
          isDamaged: async (workspaceRoot, runId) => (await inspectRun(workspaceRoot, runId)) === "damaged",
        }),
      });
      return output.kind === "revert" ? { ok: true, output } : { ok: false, error: fromCliError(output) };
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

  // plan, applyPlan and review (DR-1, DR-2, DR-17) are left out until the general task commands exist.
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
        anthropicDeps: hooks.anthropicDeps,
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

  return {
    startRun,
    report,
    revert,
    listRuns,
    resolveRun,
    doctor,
    changes,
    listModels,
    selectModel,
    readSettings,
    createSettings,
    settingsSuggestions,
  };
}
