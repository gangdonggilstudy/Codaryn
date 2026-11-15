import path from "node:path";
import { API_KEY_ENVS, API_PROVIDERS, API_PROVIDER_NAMES, CODARYN_CONFIG_ENV, MODELS_EXIT_CODES, cliErrorFacts, toSchemaFieldPath } from "../contracts/index.js";
import type { DefaultConfigLocation, AnthropicProviderDeps, ApiModelEnv, ApiProviderDeps, ApiProviderName, CodarynConfig, ListAnthropicModels, ListModels, ModelsListEntry, ModelsOutput } from "../contracts/index.js";
import type { CommandOutcome } from "./command-outcome.js";
import type { ModelsArgs } from "./input/args.js";
import { parseConfig } from "./input/config.js";
import { chooseConfigFile } from "./input/config-file.js";
import { cliError, jsonSyntaxError, positionDiagnostic, settingsError, withHint } from "./prepare.js";
import { MAX_KEY_SCAN_DEPTH, findKeyInJson, goalHoldsKey, inputFileTooLarge, inputFileTooLargeMessage, rawTextHoldsKey, selectEnvFileSecrets } from "./input/security/index.js";
import { envValue, knownKeyValues, providerSettingsOf, realModel, resolveListSettings } from "./input/settings.js";
import type { SettingsEnvironment } from "./input/settings.js";
import { isApiProviderName, localPathProblem, quickProvider, quotedChoices } from "./input/task.js";
import { cleanText } from "./input/text-safety.js";
import { BOM, LF, withModel, writeConfigAtomic } from "./config-write.js";
import type { ConfigWriteOptions } from "./config-write.js";

export interface ModelsCommandEnvironment {
  /** Read after `loadEnvFile`, so it reflects what that call loaded. */
  readonly env: SettingsEnvironment;
  readonly cwd: string;
  /** Reads a UTF-8 file. Rejects when it cannot be read (`code` "ENOENT" when it is missing). */
  readonly readFile: (file: string) => Promise<string>;
  /** Loads `--vars-file` into `env` (process.loadEnvFile in the real CLI). */
  readonly loadEnvFile: (file: string) => void;
  /**
   * `anthropicModelLister` (provider.ts, i.e. `listAnthropicModels`); main.ts always passes it.
   * Absent: listing is not connected, and nothing is sent. It is never filled in by default, so a
   * test that leaves it out cannot reach the network.
   */
  readonly listModels?: ListAnthropicModels;
  /** Passed to `listModels`. Tests inject `fetch` here. */
  readonly anthropicDeps?: AnthropicProviderDeps;
  /** SP-6: the other providers' listers (main.ts passes API_MODEL_LISTERS). Absent: not connected, nothing is sent. */
  readonly listers?: { readonly [P in ApiProviderName]?: ListModels };
  /** SP-6: injection points per API provider; anthropic falls back to `anthropicDeps`. */
  readonly providerDeps?: { readonly [P in ApiProviderName]?: ApiProviderDeps };
  /**
   * Shows `question` and returns the line typed, or null. Present only when stdin and stdout are
   * both terminals: the prompt is never shown otherwise (Y-3).
   */
  readonly ask?: (question: string) => Promise<string | null>;
  /** Writes the config file (`writeConfigAtomic` when absent). Rejects on failure; the file is unchanged then. */
  readonly writeConfig?: (file: string, text: string, options: ConfigWriteOptions) => Promise<void>;
  readonly signal?: AbortSignal;
  /** N-1: the default config location, used when neither --config nor CODARYN_CONFIG is given. */
  readonly defaultConfig?: DefaultConfigLocation | null;
}

/** Internal same-process callbacks: raw masking context never enters a command outcome. */
export interface ModelsCommandPlaces {
  readonly modelEnv: string;
  readonly field: string;
}

export interface ModelsCommandAdapter {
  readonly ask: (before: ModelsOutput, places: ModelsCommandPlaces, secrets: readonly string[], currentKey: readonly string[]) => Promise<string | null>;
  readonly choice: (answer: string | null) => string | null;
  readonly complete: (output: ModelsOutput, prompted: boolean, places: ModelsCommandPlaces, secrets: readonly string[], currentKey: readonly string[]) => CommandOutcome;
}

/** A model id that may be written into a config file: printable ASCII of the shapes model ids use. */
const WRITABLE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** Removes secret values from text that is printed (error messages from the provider, the output). */
export function scrub(text: string, secrets: readonly string[]): string {
  return secrets.reduce((current, secret) => (secret.length >= 8 ? current.split(secret).join("[secret]") : current), text);
}

export async function runModelsIn(io: ModelsCommandEnvironment, args: ModelsArgs, adapter: ModelsCommandAdapter): Promise<CommandOutcome> {
  // S-5: nothing given on the command line may reach another machine or a device.
  for (const [given, option] of [
    [args.configPath, "--config"],
    [args.varsFile, "--vars-file"],
  ] as const) {
    if (given === null) continue;
    const problem = localPathProblem(given, io.cwd);
    if (problem !== null) return cliError("invalid_config", `the path given by ${option} ${problem}`);
  }

  // The variables file, as in `run` (S-4: values it newly set are secrets).
  let envSecrets: readonly string[] = [];
  if (args.varsFile !== null) {
    const varsPath = path.resolve(io.cwd, args.varsFile);
    let text: string;
    try {
      text = await io.readFile(varsPath);
    } catch {
      return cliError("invalid_config", "the file given by --vars-file cannot be read");
    }
    if (text.startsWith(BOM)) {
      return cliError("invalid_config", "the file given by --vars-file starts with a byte order mark; save it as UTF-8 without BOM");
    }
    const before = { ...io.env };
    try {
      io.loadEnvFile(varsPath);
    } catch {
      return cliError("invalid_config", "the file given by --vars-file cannot be read");
    }
    envSecrets = selectEnvFileSecrets(before, { ...io.env });
  }

  const currentKey = knownKeyValues(io.env);
  // N-1: --config, CODARYN_CONFIG, then the default location (optional: a missing file means none).
  const chosen = chooseConfigFile({ argument: args.configPath, env: io.env, cwd: io.cwd, defaultLocation: io.defaultConfig ?? null });
  if (!chosen.ok) return cliError("invalid_config", chosen.message);
  const candidate = chosen.candidate;

  // The config file: same order of checks as `run` (C-1, S-6). Missing is allowed only with --use.
  let config: CodarynConfig | null = null;
  let configText: string | null = null;
  let configPath: string | null = null;
  if (candidate !== null) {
    configPath = candidate.path;
    try {
      configText = await io.readFile(configPath);
    } catch (error) {
      if (candidate.optional && isMissing(error)) {
        // No file at the default location: no config. `--use` does not create one there.
        configPath = null;
      } else if (!(isMissing(error) && args.use !== null)) {
        return cliError("invalid_config", "the config file cannot be read as JSON");
      }
    }
    if (configText !== null) {
      const body = configText.startsWith(BOM) ? configText.slice(1) : configText;
      // DR-40 (b): a file over the cap is refused before any check reads it; measured without the
      // byte order mark, as run and doctor do (review R-30 L-1).
      if (inputFileTooLarge(body)) return withHint(cliError("invalid_config", inputFileTooLargeMessage("config file")), "input_too_large");
      if (rawTextHoldsKey(body, currentKey)) {
        return withHint(cliError("key_in_file", `the config file contains a key value; keys are read only from environment variables (${API_KEY_ENVS.join(", ")})`), "key_in_config");
      }
      let value: unknown;
      try {
        value = JSON.parse(body);
      } catch {
        const syntax = jsonSyntaxError("config file", "config", body);
        return cliError("invalid_config", syntax.message, syntax.diagnostic);
      }
      const found = findKeyInJson(value, currentKey);
      if (found.kind === "key") {
        const keyError = cliError("key_in_file", `the config file has a key field or key value at ${found.location}; keys are read only from environment variables (${API_KEY_ENVS.join(", ")})`);
        // U-37: the place when it is a schema field path.
        const field = toSchemaFieldPath(found.location);
        return field === null ? withHint(keyError, "key_in_config") : withHint(keyError, "key_field_in_config", { field });
      }
      if (found.kind === "too_deep") return cliError("invalid_config", `the config file is nested more than ${MAX_KEY_SCAN_DEPTH} levels deep`);
      const outcome = parseConfig(value);
      if (!outcome.ok) {
        const failed = cliError("invalid_config", outcome.message, positionDiagnostic("config", outcome.position));
        // U-177: a parser's hint (a definition's plan "run"), as run gives it.
        return outcome.hint === undefined ? failed : withHint(failed, outcome.hint);
      }
      config = outcome.config;
    }
  }
  if (args.use !== null && configPath === null) {
    return cliError(
      "invalid_arguments",
      `--use writes the config file's model, so it needs --config, ${CODARYN_CONFIG_ENV} or a config file at the default location (\`codaryn init\` creates one); nothing was sent`,
    );
  }

  // SP-6 (DR-34 (a)): the chosen provider's key, address and lister only, so a key never goes to an
  // address set for another provider.
  let provider: ApiProviderName;
  if (args.provider === null) provider = quickProvider(config);
  else if (isApiProviderName(args.provider)) provider = args.provider;
  else return cliError("invalid_arguments", `--provider must be ${quotedChoices(API_PROVIDER_NAMES)}; nothing was sent`);
  const resolved = resolveListSettings(io.env, config, provider);
  if (!resolved.ok) return settingsError(resolved);
  const secrets = [resolved.settings.apiKey, ...envSecrets];
  const lister: ListModels | undefined = provider === "anthropic" ? (io.listModels ?? io.listers?.anthropic) : io.listers?.[provider];
  if (lister === undefined) {
    return cliError("provider_not_implemented", "listing models is not connected in this build; nothing was sent");
  }

  let listed: Awaited<ReturnType<ListAnthropicModels>>;
  try {
    listed = await lister(resolved.settings, io.providerDeps?.[provider] ?? (provider === "anthropic" ? io.anthropicDeps : undefined), io.signal);
  } catch {
    return cliError("model_list_failed", "the model list request failed (api_error); nothing was written");
  }
  if (!listed.ok) {
    const hint = listed.kind === "auth_failed" ? `; check ${API_PROVIDERS[provider].keyEnv}` : "";
    const message = scrub(cleanText(listed.message), secrets);
    const failed = cliError("model_list_failed", `the model list request failed (${listed.kind}): ${message}${hint}; nothing was written`);
    // U-55 (AXM-9): retryable by the listing's failure; left out when it cannot be told. A thrown
    // listing (above) has no failure to judge by, so it says the category only.
    // U-82 (review R-75 M1): the listing's own verdict goes first (a refused connection: true).
    const facts = cliErrorFacts("model_list_failed", {
      kind: listed.kind,
      ...(listed.httpStatus === undefined ? {} : { httpStatus: listed.httpStatus }),
      ...(listed.retryable === undefined ? {} : { retryable: listed.retryable }),
    });
    return { ...failed, output: { ...failed.output, ...facts } };
  }
  const models: ModelsListEntry[] = listed.models.map((model, index) => ({ number: index + 1, ...model }));

  // The choice: --use, or the answer at a terminal (never with --json).
  let choice = args.use;
  let prompted = false;
  // SP-6: the provider's own model variable and config place.
  const modelEnv = API_PROVIDERS[provider].modelEnv;
  const modelFromEnv = envValue(io.env, modelEnv);
  // DR-36 (a): `current.source` and `selected.overriddenBy` name that variable (ApiModelEnv).
  const writePlace: ApiProviderName | null = provider === "anthropic" && config?.providers?.anthropic === undefined ? null : provider;
  const field = writePlace === null ? "model" : `providers.${writePlace}.model`;
  const places: ModelsCommandPlaces = { modelEnv, field };
  const configModel = providerSettingsOf(config, provider).model ?? null;
  if (choice === null && !args.json && io.ask !== undefined && configPath !== null && models.length > 0) {
    prompted = true;
    const before: ModelsOutput = {
      schemaVersion: 1,
      kind: "models",
      status: "listed",
      exitCode: MODELS_EXIT_CODES.listed,
      models,
      current: currentModel(modelEnv, modelFromEnv, configModel, models),
      selected: null,
      ...(provider === "anthropic" ? {} : { provider }),
    };
    const answer = await adapter.ask(before, places, secrets, currentKey);
    choice = adapter.choice(answer);
  }

  let selected: ModelsOutput["selected"] = null;
  let writtenModel = configModel;
  if (choice !== null && configPath !== null) {
    const asNumber = /^[1-9][0-9]*$/.test(choice) ? Number(choice) : null;
    const picked = asNumber !== null ? models[asNumber - 1] : models.find((model) => model.id === choice);
    if (picked === undefined) {
      return cliError("invalid_arguments", `${prompted ? "the answer" : "--use"} names no listed model (a number from 1 to ${models.length} or a listed id); nothing was written`);
    }
    if (!WRITABLE_MODEL_ID.test(picked.id) || goalHoldsKey(picked.id, currentKey)) {
      return cliError("config_write_failed", "the chosen model id is not a plain model id; the config file was left as it was");
    }
    const created = configText === null;
    const fresh = writePlace === null ? { schemaVersion: 1, model: picked.id } : { schemaVersion: 1, providers: { [writePlace]: { model: picked.id } } };
    const text = created ? `${JSON.stringify(fresh, null, 2)}${LF}` : withModel(configText as string, picked.id, writePlace);
    const check = parseConfig(JSON.parse(text.startsWith(BOM) ? text.slice(1) : text));
    if (!check.ok || rawTextHoldsKey(text, currentKey)) {
      return cliError("config_write_failed", "the config file would not be valid with that model; it was left as it was");
    }
    try {
      await (io.writeConfig ?? writeConfigAtomic)(configPath, text, { exclusive: created, expected: configText });
    } catch {
      return cliError("config_write_failed", "the config file could not be written, or it changed while models ran; it was left as it was");
    }
    selected = { id: picked.id, created, overriddenBy: realModel(modelFromEnv) !== null ? modelEnv : null };
    writtenModel = picked.id;
  }

  const status = selected === null ? "listed" : "selected";
  const output: ModelsOutput = {
    schemaVersion: 1,
    kind: "models",
    status,
    exitCode: MODELS_EXIT_CODES[status],
    models,
    current: currentModel(modelEnv, modelFromEnv, writtenModel, models),
    selected,
    // SP-6: the listed provider; for anthropic it waits for the PM's approval of the SP-0 pin change.
    ...(provider === "anthropic" ? {} : { provider }),
  };
  return adapter.complete(output, prompted, places, secrets, currentKey);
}

/**
 * The model a run of the listed provider without a task `model.model` would use: its model
 * variable (`modelEnv`, DR-34, DR-36 (a)), else the config file's model for that provider.
 * N-3: a placeholder (blank or `<...>`) counts as not set.
 */
function currentModel(modelEnv: ApiModelEnv, fromEnv: string | null, fromConfig: string | null, models: readonly ModelsListEntry[]): ModelsOutput["current"] {
  const env = realModel(fromEnv);
  const id = env ?? realModel(fromConfig);
  if (id === null) return null;
  return { id, source: env !== null ? modelEnv : "config", listed: models.some((model) => model.id === id) };
}
