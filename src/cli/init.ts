/**
 * `codaryn init [--config <file>] [--workspace <dir>] [--json]` (N-2, N-10): creates a config file
 * at the default location (N-1), or at `--config`. It never overwrites (`config_exists`) and never
 * asks for, reads or writes a key (C-1).
 *
 * Questions are asked only through `ask`, which the entry point passes when stdin and stderr are
 * terminals; they go to stderr. Without it (or with `--json`) nothing is asked and only the
 * defaults are written. Suggestions come from `--workspace` only and are matched against fixed
 * name lists, so nothing read from a file is ever shown. Text comes from the message catalog.
 */

import path from "node:path";
import {
  API_PROVIDERS,
  API_PROVIDER_NAMES,
  DENY_ALL_POLICY,
  INIT_DEFAULT_LIMITS,
  INIT_DEFAULT_MAX_OUTPUT_TOKENS,
  INIT_DEFAULT_PROVIDER,
  INIT_EXIT_CODES,
  INIT_QUESTION_DEFAULTS,
  INIT_SUGGESTED_PROTECTED_PATHS,
  MESSAGE_LANGUAGES,
  MODEL_PLACEHOLDER,
  RESULT_SCHEMA_VERSION,
} from "../contracts/index.js";
import type {
  AnthropicProviderDeps,
  ApiProviderDeps,
  ApiProviderName,
  CommandRule,
  DefaultConfigDisplay,
  DefaultConfigLocation,
  InitOutput,
  InitSuggestedCommand,
  InitSuggestedProtectedPath,
  InitStatus,
  ListAnthropicModels,
  ListModels,
  MessageCatalog,
  MessageLanguage,
  ModelInfo,
} from "../contracts/index.js";
import { parseInitArgs } from "./args.js";
import { chooseConfigFile } from "./config-file.js";
import type { CommandOutcome } from "./guard.js";
import { argumentsError, cliError } from "./run.js";
import type { WorkspaceLocation } from "./security/index.js";
import { envValue, resolveListSettings } from "./settings.js";
import type { SettingsEnvironment } from "./settings.js";
import { localPathProblem } from "./task.js";
import { cleanText, hideKeys } from "./text-safety.js";

/** package.json scripts that may be offered as allowed commands, and the rule each becomes. */
export const SUGGESTED_SCRIPTS: readonly { readonly script: string; readonly rule: CommandRule; readonly shown: InitSuggestedCommand }[] = [
  { script: "test", rule: { executable: "npm", argsPrefix: ["test"], allowExtraArgs: false }, shown: "npm test" },
  { script: "build", rule: { executable: "npm", argsPrefix: ["run", "build"], allowExtraArgs: false }, shown: "npm run build" },
  { script: "lint", rule: { executable: "npm", argsPrefix: ["run", "lint"], allowExtraArgs: false }, shown: "npm run lint" },
  { script: "typecheck", rule: { executable: "npm", argsPrefix: ["run", "typecheck"], allowExtraArgs: false }, shown: "npm run typecheck" },
];

/** Workspace entries that may be offered as protected paths when they exist (fixed list, N-14). */
export const SUGGESTED_PROTECTED_PATHS: readonly InitSuggestedProtectedPath[] = INIT_SUGGESTED_PROTECTED_PATHS;

/** Largest package.json read for suggestions. A larger one gives no suggestion. */
export const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;

export interface InitEnvironment {
  readonly argv: readonly string[];
  readonly env: SettingsEnvironment;
  readonly cwd: string;
  readonly platform?: NodeJS.Platform;
  /** U-115 (UXM-9): stdout is a terminal; then the text adds the way to try without a key. */
  readonly stdoutIsTerminal?: boolean;
  /** N-1: `findDefaultConfigLocation` in the real CLI. Null: there is none. */
  readonly defaultConfig: DefaultConfigLocation | null;
  /** N-1: a default location exists but is a network or device path. */
  readonly defaultConfigRefused?: boolean;
  readonly messages: MessageCatalog;
  /** Reads a UTF-8 file (package.json for suggestions). */
  readonly readFile: (file: string) => Promise<string>;
  readonly isDirectory: (dir: string) => Promise<boolean>;
  /** True when something (file, directory, link) exists at `target`. Never throws. */
  readonly exists: (target: string) => Promise<boolean>;
  /** S-1: where `file` really is relative to `workspaceRoot` (it need not exist yet). */
  readonly locateInWorkspace: (file: string, workspaceRoot: string) => Promise<WorkspaceLocation>;
  /** Creates the directory and its parents when missing. */
  readonly makeDirectory: (dir: string) => Promise<void>;
  /** Creates `file` with `text`; rejects with `code` "EEXIST" when it already exists. */
  readonly writeNewFile: (file: string, text: string) => Promise<void>;
  /** Asks one question on stderr and returns the line typed, or null when input ended. Terminal only. */
  readonly ask?: (question: string) => Promise<string | null>;
  /** Writes one line (with its line feed) to stderr. Used only while questions are asked. */
  readonly tell?: (line: string) => void;
  /** Lists models (a real API request); asked only when the key is set and questions are asked. */
  readonly listModels?: ListAnthropicModels;
  readonly anthropicDeps?: AnthropicProviderDeps;
  /** U-26: the other providers' listers (main.ts passes API_MODEL_LISTERS); anthropic falls back to listModels. */
  readonly listers?: { readonly [P in ApiProviderName]?: ListModels };
  /** U-26: injection points per API provider; anthropic falls back to anthropicDeps. */
  readonly providerDeps?: { readonly [P in ApiProviderName]?: ApiProviderDeps };
}

const YES = new Set(["y", "yes", "예", "네", "ㅇ"]);
const NO = new Set(["n", "no", "아니오", "아니요", "ㄴ"]);

/** A yes/no answer; an empty line or anything unknown gives the default. */
function yesNo(answer: string | null, fallback: boolean): boolean {
  if (answer === null) return false;
  const word = answer.trim().toLowerCase();
  if (YES.has(word)) return true;
  if (NO.has(word)) return false;
  return fallback;
}

function isExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "EEXIST";
}

/** Script names of package.json that are in SUGGESTED_SCRIPTS. Nothing else is taken from the file. */
async function suggestedScripts(io: InitEnvironment, workspace: string): Promise<typeof SUGGESTED_SCRIPTS> {
  let text: string;
  try {
    text = await io.readFile(path.join(workspace, "package.json"));
  } catch {
    return [];
  }
  if (Buffer.byteLength(text, "utf8") > MAX_PACKAGE_JSON_BYTES) return [];
  let scripts: unknown;
  try {
    scripts = (JSON.parse(text.replace(/^﻿/, "")) as { scripts?: unknown } | null)?.scripts;
  } catch {
    return [];
  }
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) return [];
  return SUGGESTED_SCRIPTS.filter((entry) => typeof (scripts as Record<string, unknown>)[entry.script] === "string");
}

/**
 * The config file init writes, as JSON text with a final line feed. U-26 (UXM-11): in the form of
 * `provider` (anthropic when absent): anthropic's model and output limit at the top level, as
 * before; another provider's under `providers.<provider>`, with `provider` naming it.
 */
export function initConfigText(choices: {
  readonly model: string;
  readonly commands: readonly CommandRule[];
  readonly protectedPaths: readonly InitSuggestedProtectedPath[];
  readonly language: MessageLanguage | null;
  readonly provider?: ApiProviderName;
}): string {
  const provider = choices.provider ?? "anthropic";
  const settings = { model: choices.model, maxOutputTokens: INIT_DEFAULT_MAX_OUTPUT_TOKENS };
  const config = {
    schemaVersion: 1,
    ...(provider === "anthropic" ? settings : { provider, providers: { [provider]: settings } }),
    limits: { ...INIT_DEFAULT_LIMITS },
    policy: {
      ...DENY_ALL_POLICY,
      commands: choices.commands.map((rule) => ({ ...rule, argsPrefix: [...rule.argsPrefix] })),
      ...(choices.protectedPaths.length === 0 ? {} : { protectedPaths: [...choices.protectedPaths] }),
    },
    ...(choices.language === null ? {} : { language: choices.language }),
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * The stdout text of init without `--json`. Built from catalog messages only. U-115 (UXM-9): with
 * `terminal` (stdout is a terminal) and the key not set, the way to try without a key ends it.
 */
export function renderInit(output: InitOutput, messages: MessageCatalog, platform: NodeJS.Platform, options: { readonly terminal?: boolean } = {}): string {
  const lines: string[] = [];
  if (output.status === "declined") {
    lines.push(messages.format("init.declined"));
    return `${lines.join("\n")}\n`;
  }
  if (!output.interactive) lines.push(messages.format("init.not_terminal"));
  lines.push(messages.format("init.saved", { location: output.config.display }));
  if (output.model === "placeholder") lines.push(messages.format("init.model_placeholder"));
  // SP-D12: the key variable of the provider the written config uses (anthropic until SP-6 sets it).
  const keyEnv = API_PROVIDERS[output.provider ?? "anthropic"].keyEnv;
  lines.push(messages.format(output.keySet ? "init.key_set" : "init.key_missing", { keyEnv }));
  if (!output.keySet) lines.push(messages.format(platform === "win32" ? "init.key_hint_windows" : "init.key_hint_posix", { keyEnv }));
  if (output.overriddenBy !== null) lines.push(messages.format("init.overridden_by_env"));
  lines.push(messages.format("init.next"));
  if (options.terminal === true && !output.keySet) lines.push(messages.format("first_use.try_without_key"));
  return `${lines.join("\n")}\n`;
}

export async function runInit(io: InitEnvironment): Promise<CommandOutcome> {
  const parsed = parseInitArgs(io.argv);
  if (!parsed.ok) return argumentsError(parsed);
  const args = parsed.args;
  const platform = io.platform ?? process.platform;
  const messages = io.messages;

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
  const ask = args.json ? undefined : io.ask;
  const interactive = ask !== undefined;
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
  const finish = (status: InitStatus): CommandOutcome => {
    const result = output(status);
    return args.json ? { output: result, exitCode: result.exitCode } : { text: renderInit(result, messages, platform, { terminal: io.stdoutIsTerminal === true }), exitCode: result.exitCode };
  };
  const question = async (text: string): Promise<string | null> => (ask === undefined ? null : ask(`${text} `));
  const tell = (text: string): void => {
    try {
      io.tell?.(`${text}\n`);
    } catch {
      // stderr is best effort.
    }
  };
  // N-20: each question shows its own default (INIT_QUESTION_DEFAULTS); widening ones default to no.
  const hint = (question: keyof typeof INIT_QUESTION_DEFAULTS): string =>
    messages.format(INIT_QUESTION_DEFAULTS[question] === "yes" ? "prompt.yes_no_default_yes" : "prompt.yes_no_default_no");
  const fallback = (question: keyof typeof INIT_QUESTION_DEFAULTS): boolean => INIT_QUESTION_DEFAULTS[question] === "yes";

  if (ask !== undefined) {
    const confirmed = await question(
      `${messages.format("init.location", { location: target.display })}\n${messages.format("init.confirm_create")} ${hint("confirm_create")}`,
    );
    if (!yesNo(confirmed, fallback("confirm_create"))) return finish("declined");

    // U-26: the provider, by number or name; Enter, an unknown answer or the end of input give the
    // default. The file, the key and the model list are that provider's.
    const listed = API_PROVIDER_NAMES.map((name, index) => `  ${index + 1}  ${name}`);
    const answer = (await ask(`${listed.join("\n")}\n${messages.format("init.provider_pick", { provider: INIT_DEFAULT_PROVIDER })} `))?.trim().toLowerCase() ?? "";
    provider = providerOf(answer);
    tell(messages.format("init.provider_chosen", { provider }));
    keySet = envValue(io.env, API_PROVIDERS[provider].keyEnv) !== null;

    // Model: listed only with a key, through `codaryn models`' listing (a real API request).
    const lister: ListModels | undefined = provider === "anthropic" ? (io.listModels ?? io.listers?.anthropic) : io.listers?.[provider];
    if (!keySet || lister === undefined) {
      tell(messages.format("init.model_no_key"));
    } else {
      const picked = await pickModel(io, ask, tell, messages, provider, lister);
      if (picked !== null) {
        model = picked;
        modelChosen = true;
      }
    }

    tell(
      messages.format("init.limits_default", {
        turns: INIT_DEFAULT_LIMITS.maxModelTurns,
        toolCalls: INIT_DEFAULT_LIMITS.maxToolCalls,
        tokens: INIT_DEFAULT_LIMITS.maxTotalTokens,
        minutes: Math.round(INIT_DEFAULT_LIMITS.maxDurationMs / 60_000),
      }),
    );

    if (workspace !== null) {
      // Allowing a command widens the policy: the default answer is no.
      for (const entry of await suggestedScripts(io, workspace)) {
        const answer = await question(`${messages.format("init.commands_suggest", { command: entry.shown })} ${hint("commands_suggest")}`);
        if (yesNo(answer, fallback("commands_suggest"))) {
          commands.push(entry.rule);
        }
      }
      // Protecting a path narrows it: the default answer is yes.
      for (const name of SUGGESTED_PROTECTED_PATHS) {
        if (!(await io.exists(path.join(workspace, name)))) continue;
        const answer = await question(`${messages.format("init.protected_suggest", { path: name })} ${hint("protected_suggest")}`);
        if (yesNo(answer, fallback("protected_suggest"))) {
          protectedPaths.push(name);
        }
      }
    }

    const chosen = (await question(messages.format("init.language_pick")))?.trim().toLowerCase() ?? "";
    if ((MESSAGE_LANGUAGES as readonly string[]).includes(chosen)) language = chosen as MessageLanguage;
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

/** U-26: the provider an answer names, by number (1-based, API_PROVIDER_NAMES order) or name; else the default. */
function providerOf(answer: string): ApiProviderName {
  const byNumber = /^[0-9]{1,2}$/.test(answer) ? API_PROVIDER_NAMES[Number(answer) - 1] : undefined;
  if (byNumber !== undefined) return byNumber;
  return (API_PROVIDER_NAMES as readonly string[]).includes(answer) ? (answer as ApiProviderName) : INIT_DEFAULT_PROVIDER;
}

/**
 * Lists `provider`'s models with its key and `lister`, and asks for a number or an id. Null: none
 * chosen (the placeholder stays).
 */
async function pickModel(
  io: InitEnvironment,
  ask: (question: string) => Promise<string | null>,
  tell: (text: string) => void,
  messages: MessageCatalog,
  provider: ApiProviderName,
  lister: ListModels,
): Promise<string | null> {
  const resolved = resolveListSettings(io.env, null, provider);
  if (!resolved.ok) return null;
  let listed: Awaited<ReturnType<ListModels>>;
  try {
    listed = await lister(resolved.settings, io.providerDeps?.[provider] ?? (provider === "anthropic" ? io.anthropicDeps : undefined));
  } catch {
    tell(messages.format("init.model_list_failed", { kind: "api_error" }));
    return null;
  }
  if (!listed.ok) {
    tell(messages.format("init.model_list_failed", { kind: listed.kind }));
    return null;
  }
  const models: readonly ModelInfo[] = listed.models;
  if (models.length === 0) return null;
  const key = resolved.settings.apiKey;
  const table = models.map((info, index) => `  ${index + 1}  ${hideKeys(cleanText(info.id), key)}  ${hideKeys(cleanText(info.displayName), key)}`);
  const answer = (await ask(`${table.join("\n")}\n${messages.format("init.model_pick")} `))?.trim() ?? "";
  if (answer.length === 0) return null;
  const byNumber = /^[0-9]{1,4}$/.test(answer) ? models[Number(answer) - 1] : undefined;
  const picked = byNumber ?? models.find((info) => info.id === answer);
  // The same rule as `models --use`: only a plain model id that holds no key is written.
  if (picked === undefined || !WRITABLE_MODEL_ID.test(picked.id) || hideKeys(picked.id, key) !== picked.id) return null;
  return picked.id;
}

/** Same shape `codaryn models --use` accepts for writing (Y-3). */
const WRITABLE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
