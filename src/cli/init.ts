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

import { API_PROVIDERS, API_PROVIDER_NAMES, INIT_DEFAULT_LIMITS, INIT_DEFAULT_PROVIDER, INIT_QUESTION_DEFAULTS, MESSAGE_LANGUAGES } from "../contracts/index.js";
import type { ApiProviderName, InitOutput, ListModels, MessageCatalog, MessageLanguage, ModelInfo } from "../contracts/index.js";
import { parseInitArgs } from "./args.js";
import type { CommandOutcome } from "./guard.js";
import { argumentsError } from "../app/prepare.js";
import { resolveListSettings } from "../app/input/settings.js";
import { cleanText, hideKeys } from "../app/input/text-safety.js";
import { MAX_PACKAGE_JSON_BYTES, SUGGESTED_PROTECTED_PATHS, SUGGESTED_SCRIPTS, initConfigText, initModelId } from "../app/init-core.js";
import type { InitPorts } from "../app/init-core.js";
import { initIn } from "../app/init-command.js";

export { MAX_PACKAGE_JSON_BYTES, SUGGESTED_PROTECTED_PATHS, SUGGESTED_SCRIPTS, initConfigText };

export interface InitEnvironment extends InitPorts {
  readonly argv: readonly string[];
  /** U-115 (UXM-9): stdout is a terminal; then the text adds the way to try without a key. */
  readonly stdoutIsTerminal?: boolean;
  readonly messages: MessageCatalog;
  /** Asks one question on stderr and returns the line typed, or null when input ended. Terminal only. */
  readonly ask?: (question: string) => Promise<string | null>;
  /** Writes one line (with its line feed) to stderr. Used only while questions are asked. */
  readonly tell?: (line: string) => void;
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

// The ordinary Promise facade returns the core Promise directly. Pre-core throws still reject.
export function runInit(io: InitEnvironment): Promise<CommandOutcome> {
  try {
    const parsed = parseInitArgs(io.argv);
    if (!parsed.ok) return Promise.resolve(argumentsError(parsed));
    const args = parsed.args;
    const platform = io.platform ?? process.platform;
    const messages = io.messages;
    return initIn(io, args, platform, {
      complete: (result) => args.json ? { output: result, exitCode: result.exitCode } : { text: renderInit(result, messages, platform, { terminal: io.stdoutIsTerminal === true }), exitCode: result.exitCode },
      begin: () => {
        const ask = args.json ? undefined : io.ask;
        if (ask === undefined) return undefined;
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

        return {
          confirm: (display) => question(
            `${messages.format("init.location", { location: display })}\n${messages.format("init.confirm_create")} ${hint("confirm_create")}`,
          ),
          confirmed: (answer) => yesNo(answer, fallback("confirm_create")),
          provider: () => {
            const listed = API_PROVIDER_NAMES.map((name, index) => `  ${index + 1}  ${name}`);
            return ask(`${listed.join("\n")}\n${messages.format("init.provider_pick", { provider: INIT_DEFAULT_PROVIDER })} `);
          },
          providerChoice: (answer) => providerOf(answer?.trim().toLowerCase() ?? ""),
          providerChosen: (provider) => tell(messages.format("init.provider_chosen", { provider })),
          modelNoKey: () => tell(messages.format("init.model_no_key")),
          pickModel: (provider, lister) => pickModel(io, ask, tell, messages, provider, lister),
          limits: () => tell(
            messages.format("init.limits_default", {
              turns: INIT_DEFAULT_LIMITS.maxModelTurns,
              toolCalls: INIT_DEFAULT_LIMITS.maxToolCalls,
              tokens: INIT_DEFAULT_LIMITS.maxTotalTokens,
              minutes: Math.round(INIT_DEFAULT_LIMITS.maxDurationMs / 60_000),
            }),
          ),
          command: (shown) => question(`${messages.format("init.commands_suggest", { command: shown })} ${hint("commands_suggest")}`),
          allowCommand: (answer) => yesNo(answer, fallback("commands_suggest")),
          protect: (name) => question(`${messages.format("init.protected_suggest", { path: name })} ${hint("protected_suggest")}`),
          protectChoice: (answer) => yesNo(answer, fallback("protected_suggest")),
          language: () => question(messages.format("init.language_pick")),
          languageChoice: (answer) => {
            const chosen = answer?.trim().toLowerCase() ?? "";
            return (MESSAGE_LANGUAGES as readonly string[]).includes(chosen) ? chosen as MessageLanguage : null;
          },
        };
      },
    });
  } catch (error) {
    return Promise.reject(error);
  }
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
  return initModelId(picked, key);
}
