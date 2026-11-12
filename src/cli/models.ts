/**
 * `codaryn models [--config <config.json>] [--vars-file <path>] [--json] [--use <number|id>]`
 * (Y-1 to Y-3): lists the models the key can use and can write one into the config file's `model`.
 *
 * - The key, the API address, the time limit and retries come from the same functions `run` uses
 *   (`resolveListSettings` → `resolveConnection` in settings.ts). The variables file and the config
 *   file go through the same checks as in `run` (S-5 paths, BOM, key check before parsing).
 * - The list comes from `listAnthropicModels` (src/model/anthropic, p5), injected as `listModels`.
 *   The key reaches it in `settings` only, and the printed text never holds it.
 * - `--use` (or the answer at a terminal prompt) writes the config file's `model` and nothing else
 *   (see `withModel` for what is kept), atomically: a temporary file next to the target, then a
 *   rename. A missing config file is created with `schemaVersion` and `model` only.
 * No workspace is needed and nothing else is written.
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ANTHROPIC_API_KEY_ENV,
  CODARYN_CONFIG_ENV,
  CODARYN_MODEL_ENV,
  MODELS_EXIT_CODES,
} from "../contracts/index.js";
import type {
  DefaultConfigLocation,
  AnthropicProviderDeps,
  CodarynConfig,
  ListAnthropicModels,
  ModelsListEntry,
  ModelsOutput,
} from "../contracts/index.js";
import { parseModelsArgs } from "./args.js";
import { parseConfig } from "./config.js";
import { chooseConfigFile } from "./config-file.js";
import { jsonLine } from "./guard.js";
import type { CommandOutcome } from "./guard.js";
import { cliError, jsonSyntaxError, positionDiagnostic } from "./run.js";
import { MAX_KEY_SCAN_DEPTH, findKeyInJson, goalHoldsKey, rawTextHoldsKey, selectEnvFileSecrets } from "./security/index.js";
import { envValue, knownKeyValues, providerSettingsOf, realModel, resolveListSettings } from "./settings.js";
import type { SettingsEnvironment } from "./settings.js";
import { localPathProblem, quickProvider } from "./task.js";
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
export function withModel(text: string, id: string): string {
  const bom = text.startsWith(BOM) ? BOM : "";
  const body = bom === "" ? text : text.slice(1);
  const eol = body.includes(`${CR}${LF}`) ? `${CR}${LF}` : LF;
  const value = JSON.parse(body) as Record<string, unknown>;
  let next: Record<string, unknown>;
  if (Object.hasOwn(value, "model")) {
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

export function renderModels(output: ModelsOutput, withTable: boolean): string {
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
    lines.push("No current model: none is set in CODARYN_MODEL or the config file. Choose one with --use <number|id> --config <config.json>.");
  } else {
    const from = current.source === "config" ? "the config file" : "CODARYN_MODEL";
    lines.push(`* current model (from ${from}): ${cleanText(current.id)}${current.listed ? "" : " (not in this list)"}`);
  }
  const selected = output.selected;
  if (selected !== null) {
    lines.push(`Written: ${cleanText(selected.id)} is now the config file's model${selected.created ? " (the file was created)" : ""}.`);
    if (selected.overriddenBy !== null) {
      lines.push(`Note: ${selected.overriddenBy} is set and is used instead of the config file's model until it is unset.`);
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
      if (rawTextHoldsKey(body, currentKey)) {
        return cliError("key_in_file", `the config file contains a key value; keys are read only from the ${ANTHROPIC_API_KEY_ENV} environment variable`);
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
        return cliError("key_in_file", `the config file has a key field or key value at ${found.location}; keys are read only from the ${ANTHROPIC_API_KEY_ENV} environment variable`);
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

  // DR-34 (a) (review R-20 M-1): models lists anthropic's models only until another provider is
  // connected (SP-6). A config that chooses another provider is refused before anything is sent,
  // so the Anthropic key never goes to an address meant for that provider.
  const provider = quickProvider(config);
  if (provider !== "anthropic") {
    return cliError(
      "provider_not_implemented",
      `the config file chooses the ${provider} provider, and codaryn models lists anthropic models only until that provider is connected; nothing was sent`,
    );
  }
  const resolved = resolveListSettings(io.env, config);
  if (!resolved.ok) return cliError(resolved.code, resolved.message);
  const secrets = [resolved.settings.apiKey, ...envSecrets];
  if (io.listModels === undefined) {
    return cliError("provider_not_implemented", "listing models is not connected in this build; nothing was sent");
  }

  let listed: Awaited<ReturnType<ListAnthropicModels>>;
  try {
    listed = await io.listModels(resolved.settings, io.anthropicDeps, io.signal);
  } catch {
    return cliError("model_list_failed", "the model list request failed (api_error); nothing was written");
  }
  if (!listed.ok) {
    const hint = listed.kind === "auth_failed" ? `; check ${ANTHROPIC_API_KEY_ENV}` : "";
    const message = scrub(cleanText(listed.message), secrets);
    return cliError("model_list_failed", `the model list request failed (${listed.kind}): ${message}${hint}; nothing was written`);
  }
  const models: ModelsListEntry[] = listed.models.map((model, index) => ({ number: index + 1, ...model }));

  // The choice: --use, or the answer at a terminal (never with --json).
  let choice = args.use;
  let prompted = false;
  const modelFromEnv = envValue(io.env, CODARYN_MODEL_ENV);
  if (choice === null && !args.json && io.ask !== undefined && configPath !== null && models.length > 0) {
    prompted = true;
    const before: ModelsOutput = {
      schemaVersion: 1,
      kind: "models",
      status: "listed",
      exitCode: MODELS_EXIT_CODES.listed,
      models,
      current: currentModel(modelFromEnv, providerSettingsOf(config, "anthropic").model ?? null, models),
      selected: null,
    };
    const shown = hideKeys(scrub(renderModels(before, true), secrets), currentKey);
    const answer = await io.ask(`${shown}Number or id to write into the config file's model (Enter to skip): `);
    choice = answer === null || answer.trim() === "" ? null : answer.trim();
  }

  let selected: ModelsOutput["selected"] = null;
  // SP-4: anthropic's model, at the top level or in providers.anthropic (models lists anthropic until SP-6).
  let writtenModel = providerSettingsOf(config, "anthropic").model ?? null;
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
    const text = created ? `${JSON.stringify({ schemaVersion: 1, model: picked.id }, null, 2)}${LF}` : withModel(configText as string, picked.id);
    const check = parseConfig(JSON.parse(text.startsWith(BOM) ? text.slice(1) : text));
    if (!check.ok || rawTextHoldsKey(text, currentKey)) {
      return cliError("config_write_failed", "the config file would not be valid with that model; it was left as it was");
    }
    try {
      await (io.writeConfig ?? writeConfigAtomic)(configPath, text, { exclusive: created, expected: configText });
    } catch {
      return cliError("config_write_failed", "the config file could not be written, or it changed while models ran; it was left as it was");
    }
    selected = { id: picked.id, created, overriddenBy: modelFromEnv !== null ? "CODARYN_MODEL" : null };
    writtenModel = picked.id;
  }

  const status = selected === null ? "listed" : "selected";
  const output: ModelsOutput = {
    schemaVersion: 1,
    kind: "models",
    status,
    exitCode: MODELS_EXIT_CODES[status],
    models,
    current: currentModel(modelFromEnv, writtenModel, models),
    selected,
  };
  const printed = args.json ? jsonLine(output) : renderModels(output, !prompted);
  return { text: hideKeys(scrub(printed, secrets), currentKey), exitCode: output.exitCode };
}

/**
 * The model a run without a task `model.model` would use: CODARYN_MODEL, else the config file's.
 * N-3: a placeholder (blank or `<...>`) counts as not set.
 */
function currentModel(fromEnv: string | null, fromConfig: string | null, models: readonly ModelsListEntry[]): ModelsOutput["current"] {
  const env = realModel(fromEnv);
  const id = env ?? realModel(fromConfig);
  if (id === null) return null;
  return { id, source: env !== null ? "CODARYN_MODEL" : "config", listed: models.some((model) => model.id === id) };
}
