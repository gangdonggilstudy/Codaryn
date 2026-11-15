import path from "node:path";
import { API_PROVIDERS, INIT_DEFAULT_PROVIDER, INIT_EXIT_CODES, MODEL_PLACEHOLDER, RESULT_SCHEMA_VERSION } from "../contracts/index.js";
import type { ApiProviderName, CommandRule, DefaultConfigDisplay, InitOutput, InitSuggestedCommand, InitSuggestedProtectedPath, InitStatus, ListModels, MessageLanguage } from "../contracts/index.js";
import type { CommandOutcome } from "./command-outcome.js";
import type { InitArgs } from "./input/args.js";
import { chooseConfigFile } from "./input/config-file.js";
import { envValue } from "./input/settings.js";
import { localPathProblem } from "./input/task.js";
import { cliError } from "./prepare.js";
import { SUGGESTED_PROTECTED_PATHS, initConfigText, suggestedScripts } from "./init-core.js";
import type { InitPorts } from "./init-core.js";

/** Internal CLI interaction. Question callbacks return the original question/ask/model Promise. */
export interface InitInteraction {
  readonly confirm: (display: DefaultConfigDisplay | "--config") => Promise<string | null>;
  readonly confirmed: (answer: string | null) => boolean;
  readonly provider: () => Promise<string | null>;
  readonly providerChoice: (answer: string | null) => ApiProviderName;
  readonly providerChosen: (provider: ApiProviderName) => void;
  readonly modelNoKey: () => void;
  readonly pickModel: (provider: ApiProviderName, lister: ListModels) => Promise<string | null>;
  readonly limits: () => void;
  readonly command: (shown: InitSuggestedCommand) => Promise<string | null>;
  readonly allowCommand: (answer: string | null) => boolean;
  readonly protect: (name: InitSuggestedProtectedPath) => Promise<string | null>;
  readonly protectChoice: (answer: string | null) => boolean;
  readonly language: () => Promise<string | null>;
  readonly languageChoice: (answer: string | null) => MessageLanguage | null;
}

export interface InitCommandAdapter {
  readonly begin: () => InitInteraction | undefined;
  readonly complete: (output: InitOutput) => CommandOutcome;
}

function isExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "EEXIST";
}

/** Init creation rules; completion runs synchronously at the original return positions. */
export async function initIn(io: InitPorts, args: InitArgs, platform: NodeJS.Platform, adapter: InitCommandAdapter): Promise<CommandOutcome> {
  // S-5 for the command line paths.
  for (const [value, option] of [
    [args.configPath, "--config"],
    [args.workspace, "--workspace"],
  ] as const) {
    if (value === null) continue;
    const problem = localPathProblem(value, io.cwd);
    if (problem !== null) return cliError("invalid_arguments", `the path given by ${option} ${problem}`);
  }

  // The target: --config, else the default location. CODARYN_CONFIG names a file to read, not
  // where init writes; when it is set, runs read that file instead (overriddenBy).
  let target: { readonly path: string; readonly source: "argument" | "default"; readonly display: DefaultConfigDisplay | "--config" };
  if (args.configPath !== null) {
    target = { path: path.resolve(io.cwd, args.configPath), source: "argument", display: "--config" };
  } else if (io.defaultConfig !== null) {
    target = { path: io.defaultConfig.path, source: "default", display: io.defaultConfig.display };
  } else {
    return cliError(
      "invalid_config",
      io.defaultConfigRefused === true
        ? "the default config location is a network or device path and is not used; give --config <file>"
        : "there is no default config location (APPDATA, XDG_CONFIG_HOME or the home directory is not available); give --config <file>",
    );
  }
  const readTarget = chooseConfigFile({ argument: null, env: io.env, cwd: io.cwd, defaultLocation: null });
  const fromEnv = readTarget.ok && readTarget.candidate !== null ? readTarget.candidate.path : null;
  const sameFile = (a: string, b: string): boolean => (platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
  const overriddenBy = fromEnv !== null && !sameFile(path.resolve(fromEnv), path.resolve(target.path)) ? "CODARYN_CONFIG" : null;

  // --workspace: suggestions come from it, and the target must lie outside it (S-1).
  let workspace: string | null = null;
  if (args.workspace !== null) {
    workspace = path.resolve(io.cwd, args.workspace);
    if (!(await io.isDirectory(workspace))) return cliError("workspace_not_found", "the workspace is not an existing directory");
    if ((await io.locateInWorkspace(target.path, workspace)) !== "outside") {
      return cliError(
        "invalid_config",
        "the config file would be inside the workspace or its location cannot be confirmed; keep it outside so a run cannot change it",
      );
    }
  }

  if (await io.exists(target.path)) {
    return cliError("config_exists", `a file already exists at ${target.display}; it was left as it was. Edit it, or remove it and run init again`);
  }

  // U-26 (UXM-11, DR-46): the provider is asked at a terminal; otherwise anthropic, as before.
  let provider: ApiProviderName = INIT_DEFAULT_PROVIDER;
  let keySet = envValue(io.env, API_PROVIDERS[provider].keyEnv) !== null;
  const interaction = adapter.begin();
  const interactive = interaction !== undefined;
  let model = MODEL_PLACEHOLDER;
  let modelChosen = false;
  const commands: CommandRule[] = [];
  const protectedPaths: InitSuggestedProtectedPath[] = [];
  let language: MessageLanguage | null = null;
  const output = (status: InitStatus): InitOutput => ({
    schemaVersion: RESULT_SCHEMA_VERSION,
    kind: "init",
    // U-26: only when it was asked, so an output without questions is as before.
    ...(interactive ? { provider } : {}),
    status,
    exitCode: INIT_EXIT_CODES[status],
    config: { source: target.source, display: target.display },
    interactive,
    model: modelChosen ? "selected" : "placeholder",
    language,
    commands: commands.length,
    protectedPaths: protectedPaths.length,
    keySet,
    overriddenBy,
  });
  const finish = (status: InitStatus): CommandOutcome => adapter.complete(output(status));

  if (interaction !== undefined) {
    const confirmed = await interaction.confirm(target.display);
    if (!interaction.confirmed(confirmed)) return finish("declined");

    // U-26: the provider, by number or name; Enter, an unknown answer or the end of input give the
    // default. The file, the key and the model list are that provider's.
    const answer = await interaction.provider();
    provider = interaction.providerChoice(answer);
    interaction.providerChosen(provider);
    keySet = envValue(io.env, API_PROVIDERS[provider].keyEnv) !== null;

    // Model: listed only with a key, through `codaryn models`' listing (a real API request).
    const lister: ListModels | undefined = provider === "anthropic" ? (io.listModels ?? io.listers?.anthropic) : io.listers?.[provider];
    if (!keySet || lister === undefined) {
      interaction.modelNoKey();
    } else {
      const picked = await interaction.pickModel(provider, lister);
      if (picked !== null) {
        model = picked;
        modelChosen = true;
      }
    }

    interaction.limits();

    if (workspace !== null) {
      // Allowing a command widens the policy: the default answer is no.
      for (const entry of await suggestedScripts(io, workspace)) {
        const answer = await interaction.command(entry.shown);
        if (interaction.allowCommand(answer)) {
          commands.push(entry.rule);
        }
      }
      // Protecting a path narrows it: the default answer is yes.
      for (const name of SUGGESTED_PROTECTED_PATHS) {
        if (!(await io.exists(path.join(workspace, name)))) continue;
        const answer = await interaction.protect(name);
        if (interaction.protectChoice(answer)) {
          protectedPaths.push(name);
        }
      }
    }

    const chosen = await interaction.language();
    language = interaction.languageChoice(chosen);
  }

  try {
    await io.makeDirectory(path.dirname(target.path));
    await io.writeNewFile(target.path, initConfigText({ model, commands, protectedPaths, language, provider }));
  } catch (error) {
    if (isExists(error)) {
      return cliError("config_exists", `a file already exists at ${target.display}; it was left as it was`);
    }
    return cliError("config_write_failed", `the config file could not be written at ${target.display}; nothing was changed`);
  }
  return finish("created");
}
