/**
 * `codaryn models [--provider <name>] [--config <config.json>] [--vars-file <path>] [--json] [--use <number|id>]`
 * (Y-1 to Y-3, SP-6): lists the models the chosen provider's key can use and can write one where the
 * config file keeps that provider's model.
 *
 * - SP-6: the provider is `--provider`, else the config's `provider`, else anthropic. Its key, its
 *   address, its lister and its model variable are used, never another provider's.
 * - The key, the API address, the time limit and retries come from the same functions `run` uses
 *   (`resolveListSettings` → `resolveConnection` in settings.ts). The variables file and the config
 *   file go through the same checks as in `run` (S-5 paths, BOM, key check before parsing).
 * - The list comes from the provider's lister, injected: `listModels` (anthropic's) or `listers`
 *   (main.ts passes API_MODEL_LISTERS). Without one nothing is sent. The key reaches it in
 *   `settings` only, and the printed text never holds it.
 * - `--use` (or the answer at a terminal prompt) writes that provider's model and nothing else (see
 *   `withModel` for what is kept): anthropic's top-level `model`, or `providers.<name>.model` for
 *   another provider and for anthropic when the file keeps `providers.anthropic`. Atomically: a
 *   temporary file next to the target, then a rename. A missing config file is created with
 *   `schemaVersion` and that model only.
 * No workspace is needed and nothing else is written.
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  API_KEY_ENVS,
  API_PROVIDERS,
  API_PROVIDER_NAMES,
  CODARYN_CONFIG_ENV,
  CODARYN_MODEL_ENV,
  MODELS_EXIT_CODES,
} from "../contracts/index.js";
import type {
  DefaultConfigLocation,
  AnthropicProviderDeps,
  ApiModelEnv,
  ApiProviderDeps,
  ApiProviderName,
  CodarynConfig,
  ListAnthropicModels,
  ListModels,
  ModelsListEntry,
  ModelsOutput,
} from "../contracts/index.js";
import { parseModelsArgs } from "./args.js";
import { parseConfig } from "./config.js";
import { chooseConfigFile } from "./config-file.js";
import { jsonLine } from "./guard.js";
import type { CommandOutcome } from "./guard.js";
import { cliError, jsonSyntaxError, positionDiagnostic } from "./run.js";
import {
  MAX_KEY_SCAN_DEPTH,
  findKeyInJson,
  goalHoldsKey,
  inputFileTooLarge,
  inputFileTooLargeMessage,
  rawTextHoldsKey,
  selectEnvFileSecrets,
} from "./security/index.js";
import { configFieldOf, envValue, knownKeyValues, providerSettingsOf, realModel, resolveListSettings } from "./settings.js";
import type { SettingsEnvironment } from "./settings.js";
import { isApiProviderName, localPathProblem, quickProvider, quotedChoices } from "./task.js";
import { cleanText, hideKeys } from "./text-safety.js";

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const BOM = String.fromCharCode(0xfeff);

/** Options for writing the config file. */
export interface ConfigWriteOptions {
  /** True: the file must not exist yet (it is created). False: it is replaced. */
  readonly exclusive: boolean;
  /** The text read before; the write is refused when the file holds something else now. */
  readonly expected: string | null;
}

export interface ModelsEnvironment {
  readonly argv: readonly string[];
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

/** A model id that may be written into a config file: printable ASCII of the shapes model ids use. */
const WRITABLE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** Removes secret values from text that is printed (error messages from the provider, the output). */
function scrub(text: string, secrets: readonly string[]): string {
  return secrets.reduce((current, secret) => (secret.length >= 8 ? current.split(secret).join("[secret]") : current), text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The leading spaces or tabs of the first indented line, or two spaces. */
function detectIndent(text: string): string {
  for (const line of text.split(LF).slice(1)) {
    let end = 0;
    while (end < line.length && (line[end] === " " || line[end] === "\t")) end += 1;
    if (end > 0 && end < line.length && line[end] !== CR) return line.slice(0, Math.min(end, 10));
  }
  return "  ";
}

/**
 * The config text with `model` set to `id` (Y-3). What is kept: every field and value, the order
 * of the fields (`model` stays where it was, or follows `schemaVersion`), a byte order mark, the
 * line ending (CRLF or LF), the indentation of the first indented line, and a final line feed.
 * What is written anew: the layout of whitespace, number spelling (`1e3` becomes `1000`), string
 * escapes, and duplicate fields (the last value stays).
 */
export function withModel(text: string, id: string, place: ApiProviderName | null = null): string {
  const bom = text.startsWith(BOM) ? BOM : "";
  const body = bom === "" ? text : text.slice(1);
  const eol = body.includes(`${CR}${LF}`) ? `${CR}${LF}` : LF;
  const value = JSON.parse(body) as Record<string, unknown>;
  let next: Record<string, unknown>;
  if (place !== null) {
    // SP-6: providers.<place>.model; the entry and `providers` keep their fields and order, and are
    // added at the end when missing.
    const providers = isRecord(value["providers"]) ? value["providers"] : {};
    const entry = isRecord(providers[place]) ? providers[place] : {};
    next = { ...value, providers: { ...providers, [place]: { ...entry, model: id } } };
  } else if (Object.hasOwn(value, "model")) {
    next = { ...value, model: id };
  } else {
    next = {};
    for (const [key, item] of Object.entries(value)) {
      next[key] = item;
      if (key === "schemaVersion") next["model"] = id;
    }
    if (!Object.hasOwn(next, "model")) next["model"] = id;
  }
  const printed = JSON.stringify(next, null, detectIndent(body)).split(LF).join(eol);
  return `${bom}${printed}${body.endsWith(LF) ? eol : ""}`;
}

/**
 * The default writer: replaces the file through a temporary file in the same directory and a
 * rename, after checking that the file still holds `expected`. A link is followed: the file it
 * points at is replaced, the link stays. On any failure the temporary file is removed and the
 * target is left as it was. `exclusive` creates the file and fails if it exists.
 */
export async function writeConfigAtomic(file: string, text: string, options: ConfigWriteOptions): Promise<void> {
  if (options.exclusive) {
    await fs.writeFile(file, text, { encoding: "utf8", flag: "wx" });
    return;
  }
  const target = await fs.realpath(file);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(6).toString("hex")}.tmp`);
  await fs.writeFile(temporary, text, { encoding: "utf8", flag: "wx" });
  try {
    const { mode } = await fs.stat(target);
    await fs.chmod(temporary, mode & 0o777);
    const current = await fs.readFile(target, "utf8");
    if (current !== options.expected) throw new Error("the config file changed while models ran");
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

function tokens(value: number | null): string {
  return value === null ? "-" : String(value);
}

function table(models: readonly ModelsListEntry[], currentId: string | null): string[] {
  const rows = models.map((model) => [
    `${model.id === currentId ? "*" : " "} ${model.number}`,
    cleanText(model.id),
    cleanText(model.displayName),
    tokens(model.maxInputTokens),
    tokens(model.maxOutputTokens),
  ]);
  const header = ["  #", "id", "name", "input tokens", "output tokens"];
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => (row[column] ?? "").length)));
  const format = (row: readonly string[]): string =>
    row
      .map((cell, column) => (column >= 3 ? cell.padStart(widths[column] ?? 0) : cell.padEnd(widths[column] ?? 0)))
      .join("  ")
      .trimEnd();
  return [format(header), ...rows.map(format)];
}

/** SP-6: how the text names the provider's model variable and where `--use` writes. */
export interface ModelsTextPlaces {
  readonly modelEnv: string;
  readonly field: string;
}

const ANTHROPIC_PLACES: ModelsTextPlaces = { modelEnv: CODARYN_MODEL_ENV, field: "model" };

export function renderModels(output: ModelsOutput, withTable: boolean, places: ModelsTextPlaces = ANTHROPIC_PLACES): string {
  const lines: string[] = [];
  if (withTable) {
    if (output.models.length === 0) {
      lines.push("No model was listed for this key.");
    } else {
      lines.push(`Models this key can use (${output.models.length}):`, "", ...table(output.models, output.current?.id ?? null), "");
    }
  }
  const current = output.current;
  if (current === null) {
    lines.push(`No current model: none is set in ${places.modelEnv} or the config file. Choose one with --use <number|id> --config <config.json>.`);
  } else {
    const from = current.source === "config" ? "the config file" : current.source;
    lines.push(`* current model (from ${from}): ${cleanText(current.id)}${current.listed ? "" : " (not in this list)"}`);
  }
  const selected = output.selected;
  if (selected !== null) {
    lines.push(`Written: ${cleanText(selected.id)} is now the config file's ${places.field}${selected.created ? " (the file was created)" : ""}.`);
    if (selected.overriddenBy !== null) {
      lines.push(`Note: ${selected.overriddenBy} is set and is used instead of the config file's ${places.field} until it is unset.`);
    }
  }
  return `${lines.join(LF)}${LF}`;
}

export async function runModels(io: ModelsEnvironment): Promise<CommandOutcome> {
  const parsed = parseModelsArgs(io.argv);
  if (!parsed.ok) return cliError("invalid_arguments", parsed.message);
  const args = parsed.args;

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
      if (inputFileTooLarge(body)) return cliError("invalid_config", inputFileTooLargeMessage("config file"));
      if (rawTextHoldsKey(body, currentKey)) {
        return cliError("key_in_file", `the config file contains a key value; keys are read only from environment variables (${API_KEY_ENVS.join(", ")})`);
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
        return cliError("key_in_file", `the config file has a key field or key value at ${found.location}; keys are read only from environment variables (${API_KEY_ENVS.join(", ")})`);
      }
      if (found.kind === "too_deep") return cliError("invalid_config", `the config file is nested more than ${MAX_KEY_SCAN_DEPTH} levels deep`);
      const outcome = parseConfig(value);
      if (!outcome.ok) return cliError("invalid_config", outcome.message, positionDiagnostic("config", outcome.position));
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
  if (!resolved.ok) return cliError(resolved.code, resolved.message);
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
    return cliError("model_list_failed", `the model list request failed (${listed.kind}): ${message}${hint}; nothing was written`);
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
  const places: ModelsTextPlaces = { modelEnv, field };
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
    const shown = hideKeys(scrub(renderModels(before, true, places), secrets), currentKey);
    const answer = await io.ask(`${shown}Number or id to write into the config file's ${field} (Enter to skip): `);
    choice = answer === null || answer.trim() === "" ? null : answer.trim();
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
  const printed = args.json ? jsonLine(output) : renderModels(output, !prompted, places);
  return { text: hideKeys(scrub(printed, secrets), currentKey), exitCode: output.exitCode };
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
