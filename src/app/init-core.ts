import path from "node:path";
import { DENY_ALL_POLICY, INIT_DEFAULT_LIMITS, INIT_DEFAULT_MAX_OUTPUT_TOKENS, INIT_SUGGESTED_PROTECTED_PATHS } from "../contracts/index.js";
import type { AnthropicProviderDeps, ApiProviderDeps, ApiProviderName, CommandRule, DefaultConfigLocation, InitSuggestedCommand, InitSuggestedProtectedPath, ListAnthropicModels, ListModels, MessageLanguage, ModelInfo } from "../contracts/index.js";
import type { WorkspaceLocation } from "./input/security/index.js";
import type { SettingsEnvironment } from "./input/settings.js";
import { hideKeys } from "./input/text-safety.js";

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

export interface InitPorts {
  readonly env: SettingsEnvironment;
  readonly cwd: string;
  readonly platform?: NodeJS.Platform;
  /** N-1: `findDefaultConfigLocation` in the real CLI. Null: there is none. */
  readonly defaultConfig: DefaultConfigLocation | null;
  /** N-1: a default location exists but is a network or device path. */
  readonly defaultConfigRefused?: boolean;
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
  /** Lists models (a real API request); asked only when the key is set and questions are asked. */
  readonly listModels?: ListAnthropicModels;
  readonly anthropicDeps?: AnthropicProviderDeps;
  /** U-26: the other providers' listers (main.ts passes API_MODEL_LISTERS); anthropic falls back to listModels. */
  readonly listers?: { readonly [P in ApiProviderName]?: ListModels };
  /** U-26: injection points per API provider; anthropic falls back to anthropicDeps. */
  readonly providerDeps?: { readonly [P in ApiProviderName]?: ApiProviderDeps };
}

/** Script names of package.json that are in SUGGESTED_SCRIPTS. Nothing else is taken from the file. */
export async function suggestedScripts(io: Pick<InitPorts, "readFile">, workspace: string): Promise<typeof SUGGESTED_SCRIPTS> {
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

/** Complete writable-id judgment, called synchronously at the original pickModel return. */
export function initModelId(picked: ModelInfo | undefined, key: string): string | null {
  // The same rule as `models --use`: only a plain model id that holds no key is written.
  if (picked === undefined || !WRITABLE_MODEL_ID.test(picked.id) || hideKeys(picked.id, key) !== picked.id) return null;
  return picked.id;
}

/** Same shape `codaryn models --use` accepts for writing (Y-3). */
const WRITABLE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
