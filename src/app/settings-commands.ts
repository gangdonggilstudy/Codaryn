/** App diagnostics, model selection and settings commands; ports are read when a command runs. */
import { lstat, mkdir, writeFile } from "node:fs/promises";
import type { DefaultConfigLocation, DoctorOutput, InitOutput, MessageCatalog, ModelsOutput } from "../contracts/index.js";
import { createMessageCatalog, explainMessageLanguage } from "../i18n/index.js";
import { jsonLine } from "../presentation/json.js";
import type { AppHooks } from "./app-hooks.js";
import type { CommandOutcome } from "./command-outcome.js";
import { checkDoctor } from "./doctor.js";
import { copyEnvironment, loadVarsInto } from "./environment.js";
import { INTERNAL_ERROR } from "./errors.js";
import { initIn } from "./init-command.js";
import type { InitPorts } from "./init-core.js";
import { initArguments, suggestionsFor } from "./init.js";
import { parseDoctorArgs, parseInitArgs, parseModelsArgs } from "./input/args.js";
import { defaultLocationRefused } from "./input/config-file.js";
import { hideKeys } from "./input/text-safety.js";
import { runModelsIn, scrub } from "./models-command.js";
import type { ModelsCommandEnvironment } from "./models-command.js";
import { modelsArguments } from "./models.js";
import { argumentsError } from "./prepare.js";
import type { PrepareEnvironment } from "./prepare.js";
import { API_MODEL_LISTERS, anthropicModelLister } from "./provider.js";
import { workspaceRootOf } from "./runs.js";
import { applySettingsChangeIn, proposeSettingsChangeIn } from "./settings-change.js";
import { readSettingsIn } from "./settings.js";
import type { AppCallOutcome, AppEnvironment, ApplySettingsChangeRequest, CreateSettingsRequest, DoctorRequest, ListModelsRequest, ReadSettingsRequest, SelectModelRequest, SettingsChangeProposal, SettingsChangeRequest, SettingsSuggestions, SettingsSuggestionsRequest, SettingsView, SettingsWritten } from "./types.js";

/** The app's init --json facade; returns the original core Promise without another await. */
function appInitCommand(io: InitPorts & { readonly argv: readonly string[]; readonly messages: MessageCatalog }): Promise<CommandOutcome> {
  try {
    const parsed = parseInitArgs(io.argv);
    if (!parsed.ok) return Promise.resolve(argumentsError(parsed));
    const platform = io.platform ?? process.platform;
    // Retain catalog acquisition after platform, even though JSON completion needs no text.
    const messages = io.messages;
    return initIn(io, parsed.args, platform, {
      complete: (result) => ({ output: result, exitCode: result.exitCode }),
      begin: () => undefined,
    });
  } catch (error) {
    return Promise.reject(error);
  }
}

/** The app's models command: no question, with the existing JSON and whole-text masking. */
function appModelsCommand(io: ModelsCommandEnvironment & { readonly argv: readonly string[] }): Promise<CommandOutcome> {
  try {
    const parsed = parseModelsArgs(io.argv);
    if (!parsed.ok) return Promise.resolve(argumentsError(parsed));
    return runModelsIn(io, parsed.args, {
      ask: () => Promise.resolve(null),
      choice: () => null,
      complete(output, _prompted, _places, secrets, currentKey) {
        const printed = jsonLine(output);
        return { text: hideKeys(scrub(printed, secrets), currentKey), exitCode: output.exitCode };
      },
    });
  } catch (error) {
    return Promise.reject(error);
  }
}

export function createSettingsCommands(
  environment: AppEnvironment,
  platform: NodeJS.Platform,
  hooks: Pick<AppHooks, "listModels" | "anthropicDeps" | "providerDeps" | "writeConfig">,
  locate: PrepareEnvironment["locateInWorkspace"],
  relate: NonNullable<PrepareEnvironment["relatePaths"]>,
  defaultConfigOf: () => DefaultConfigLocation | null,
  jsonOutcome: <T extends { readonly kind: string }>(outcome: CommandOutcome, kind: T["kind"]) => AppCallOutcome<T>,
) {
  async function doctor(request: DoctorRequest): Promise<AppCallOutcome<DoctorOutput>> {
    const argv = ["doctor"];
    if (request.configPath !== null) argv.push("--config", request.configPath);
    if (request.varsFile !== null) argv.push("--vars-file", request.varsFile);
    if (request.taskPath !== null) argv.push("--task", request.taskPath);
    if (request.workspace !== null) argv.push("--workspace", request.workspace);
    argv.push("--json");
    try {
      const io = {
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
      };
      const checking = (): Promise<CommandOutcome> => {
        try {
          const parsed = parseDoctorArgs(io.argv);
          if (!parsed.ok) return Promise.resolve(argumentsError(parsed));
          return checkDoctor(parsed.args, io, (checked): CommandOutcome => {
            if (!checked.ok) return checked.outcome;
            const { output, currentKey } = checked;
            return { text: hideKeys(jsonLine(output), currentKey), exitCode: output.exitCode };
          });
        } catch (failure) {
          return Promise.reject(failure);
        }
      };
      const outcome = await checking();
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
      const outcome = await appModelsCommand({
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
      const outcome = await appInitCommand({
        argv: initArguments(request),
        env: copyEnvironment(environment.env, platform),
        cwd: environment.cwd,
        platform,
        defaultConfig: defaultConfigOf(),
        defaultConfigRefused: defaultLocationRefused(platform, environment.env, environment.homeDir ?? null),
        // --json prints no text; retain the catalog's original evaluation position.
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

  return { doctor, listModels, selectModel, readSettings, createSettings, settingsSuggestions, proposeSettingsChange, applySettingsChange };
}
