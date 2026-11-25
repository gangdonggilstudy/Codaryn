/** Read-only settings context for the app; values are resolved anew by each call. */
import path from "node:path";
import type { DefaultConfigLocation, ResolvedTaskSpec } from "../contracts/index.js";
import { createPrivacyGateway } from "../privacy/index.js";
import { copyEnvironment, loadVarsInto } from "./environment.js";
import { INTERNAL_ERROR, fromCliError } from "./errors.js";
import { chooseConfigFile } from "./input/config-file.js";
import { knownKeyValues } from "./input/settings.js";
import { prepareTask } from "./prepare.js";
import type { PrepareEnvironment, RunArgs, RunNotes } from "./prepare.js";
import { workspaceRootOf } from "./runs.js";
import type { AppEnvironment, AppError, TaskForm } from "./types.js";
import type { WorkspaceTextSource } from "./workspace-text.js";

export function createReadingContext(
  environment: AppEnvironment,
  platform: NodeJS.Platform,
  locate: PrepareEnvironment["locateInWorkspace"],
  relate: NonNullable<PrepareEnvironment["relatePaths"]>,
  defaultConfigOf: () => DefaultConfigLocation | null,
  PROBE_GOAL: string,
) {
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

  return { readingSecrets, workspaceTextSource };
}
