/** Settings, proposals and model selection IPC checks. Public callers use ../ipc.js. */
import { MAX_ITEMS, count, hasOnlyKeys, isHandle, isObj, shortText, textList } from "./primitives.js";

/** A model provider name as the app layer gives it (DR-22). */
export const PROVIDER_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;

/** The code of an engine host value that is not ok, or "host_error". */
export function hostCodeOf(value: unknown): string {
  const code = isObj(value) ? value["code"] : undefined;
  return typeof code === "string" && ERROR_CODE.test(code) ? code : "host_error";
}

const HINT_ID = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * U-212 (bundle A): a start the engine host refused: its code, and the CLI's hint id when the app layer
 * gave one (error.hint.<hint>, e.g. unreadable_paths_required for analyze-private without an unreadable
 * path). An id only; the window shows a hint it has words for.
 */
export function toStartFailure(value: unknown): { readonly ok: false; readonly code: string; readonly hint?: string } {
  const hint = isObj(value) ? value["hint"] : undefined;
  return { ok: false, code: hostCodeOf(value), ...(typeof hint === "string" && HINT_ID.test(hint) ? { hint } : {}) };
}

/** `listModels` arguments: `{provider}`. */
export function parseProviderArgs(value: unknown): { readonly provider: string } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["provider"])) return null;
  const provider = value["provider"];
  return typeof provider === "string" && PROVIDER_PATTERN.test(provider) ? { provider } : null;
}

/** `selectModel` arguments: `{entry}`, an id the last model list gave out. */
export function parseEntryArgs(value: unknown): { readonly entry: string } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["entry"])) return null;
  return isHandle(value["entry"]) ? { entry: value["entry"] } : null;
}

export const SETTINGS_FILE_SOURCES = ["argument", "environment", "default"] as const;

/** One profile (N-8) as the settings screen shows it: what it changes, never a value to edit. */
export interface ProfileView {
  readonly name: string;
  readonly workflowRef: string | null;
  /** SP-D10: the provider the profile names (it wins over the config's), or null. */
  readonly provider: string | null;
  /** Limit name and value (null: no limit), as the profile sets them. */
  readonly limits: readonly (readonly [string, number | null])[];
  /** Executables the profile allows to run. */
  readonly commands: readonly string[];
  readonly verifiers: number;
  readonly protectedPaths: number;
  /** U-247 (R-111): the profile has its own policy (it takes the config's place in a quick run, commands too). */
  readonly hasPolicy?: boolean;
  /** U-247 (R-111): how many unreadable paths the profile's policy lists (added to the config's). */
  readonly unreadablePaths?: number;
}

/**
 * GU-6 (3.10): what the settings screen shows. No full path of the config file (only its display
 * form), no key value (only whether one is available), no secret value.
 */
export interface SettingsView {
  readonly file: { readonly display: string; readonly source: (typeof SETTINGS_FILE_SOURCES)[number]; readonly exists: boolean } | null;
  readonly model: string | null;
  readonly language: "ko" | "en" | null;
  readonly profiles: readonly ProfileView[];
  readonly workflows: { readonly builtin: readonly string[]; readonly config: readonly string[] };
  readonly keyAvailable: boolean;
  readonly providers: readonly string[];
  /**
   * Whether CODARYN_MODEL and CODARYN_LANG are set (never their values). U-271 (C-23): `os`, the kind of
   * operating system the app runs on, for the steps that register a key; absent when it is not known.
   */
  readonly env: { readonly model: boolean; readonly language: boolean; readonly os?: "windows" | "posix" };
  /** GU-6: the config file's own rules (3.10): limits, command rules as text, protected paths, secret names. */
  readonly rules: SettingsRules;
  /** DR-41: what each task kind's own rules leave out of these rules. */
  readonly policyNarrowings: readonly PolicyNarrowingView[];
  /** SP-D3: the provider the config names (null: none, so `defaultProvider` is used). */
  readonly provider: string | null;
  readonly defaultProvider: string | null;
  /** The contract's API providers, in its order (DR-22: no name is written into the screens). */
  readonly apiProviders: readonly ApiProviderView[];
  /** U-247 (U-215): the config's unreadable paths and k; null when the app layer gave none. */
  readonly privateData?: SettingsPrivateDataView | null;
}

/** U-247 (bundle A, U-215): the config's policy.unreadablePaths (cleaned, file order) and its k. */
export interface SettingsPrivateDataView {
  readonly unreadablePaths: readonly string[];
  /** As configured (null: none), the k a run gets from the config alone (never below min), and the contract's range. */
  readonly minGroupSize: { readonly configured: number | null; readonly effective: number; readonly min: number; readonly max: number };
}

/** U-247: privateData as the engine host gives it; undefined when it does not fit. */
function toPrivateData(value: unknown): SettingsPrivateDataView | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isObj(value) || !textList(value["unreadablePaths"]) || !isObj(value["minGroupSize"])) return undefined;
  const { configured, effective, min, max } = value["minGroupSize"];
  if (!count(effective) || !count(min) || !count(max) || min > max || effective < min || effective > max || !(configured === null || count(configured))) return undefined;
  return { unreadablePaths: value["unreadablePaths"], minGroupSize: { configured: configured as number | null, effective, min, max } };
}

export interface ApiProviderView {
  readonly name: string;
  /** The key variable's name and whether it is set now; never its value (C-1, N-10). */
  readonly keyEnv: string;
  readonly keySet: boolean;
  /** The model variable's name and whether it is set now (it overrides the config's model). */
  readonly modelEnv: string;
  readonly modelEnvSet: boolean;
  /** The model the config keeps for this provider. */
  readonly model: string | null;
  /** U-80: the output cap the config keeps for this provider (`maxOutputTokens`); null: none, so its runs stop. */
  readonly outputCap?: number | null;
  /** R27-I3: the address variable's name and whether it is set now (then runs send there, not to the config's address). */
  readonly baseUrlEnv: string | null;
  readonly baseUrlEnvSet: boolean;
  /** Whether the app layer lists this provider's models (CONNECTED_MODEL_PROVIDERS). */
  readonly listable: boolean;
}

const PROVIDER_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const ENV_NAME_TEXT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

function toApiProviders(value: unknown): ApiProviderView[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) return null;
  const out: ApiProviderView[] = [];
  for (const item of value) {
    if (!isObj(item) || !hasOnlyKeys(item, ["name", "keyEnv", "keySet", "modelEnv", "modelEnvSet", "model", "outputCap", "baseUrlEnv", "baseUrlEnvSet", "listable"])) return null;
    const outputCap = item["outputCap"] ?? null;
    if (!(outputCap === null || (count(outputCap) && outputCap >= 1))) return null;
    const { name, keyEnv, keySet, modelEnv, modelEnvSet, model, listable } = item;
    const baseUrlEnv = item["baseUrlEnv"] ?? null;
    const baseUrlEnvSet = item["baseUrlEnvSet"] ?? false;
    if (!(baseUrlEnv === null || (typeof baseUrlEnv === "string" && ENV_NAME_TEXT.test(baseUrlEnv))) || typeof baseUrlEnvSet !== "boolean") return null;
    if (typeof name !== "string" || !PROVIDER_NAME.test(name) || typeof keyEnv !== "string" || !ENV_NAME_TEXT.test(keyEnv) || typeof modelEnv !== "string" || !ENV_NAME_TEXT.test(modelEnv)) return null;
    if (typeof keySet !== "boolean" || typeof modelEnvSet !== "boolean" || typeof listable !== "boolean" || !(model === null || shortText(model))) return null;
    out.push({ name, keyEnv, keySet, modelEnv, modelEnvSet, model: model as string | null, outputCap: outputCap as number | null, baseUrlEnv: baseUrlEnv as string | null, baseUrlEnvSet, listable });
  }
  return out;
}

export interface SettingsRules {
  readonly limits: readonly (readonly [string, number | null])[];
  readonly commands: readonly string[];
  readonly protectedPaths: readonly string[];
  /** Names only, and whether each is set now; never a value (S-3). */
  readonly secretEnv: readonly { readonly name: string; readonly set: boolean }[];
}

const EMPTY_RULES: SettingsRules = { limits: [], commands: [], protectedPaths: [], secretEnv: [] };

function toRules(value: unknown): SettingsRules | null {
  if (value === undefined) return EMPTY_RULES;
  if (!isObj(value) || !Array.isArray(value["limits"]) || value["limits"].length > 32 || !textList(value["commands"]) || !textList(value["protectedPaths"]) || !Array.isArray(value["secretEnv"])) return null;
  const limits: (readonly [string, number | null])[] = [];
  for (const pair of value["limits"]) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || !/^[A-Za-z]{1,40}$/.test(pair[0]) || !(pair[1] === null || (typeof pair[1] === "number" && Number.isFinite(pair[1])))) return null;
    limits.push([pair[0], pair[1] as number | null]);
  }
  const secretEnv: { name: string; set: boolean }[] = [];
  for (const item of value["secretEnv"]) {
    if (!isObj(item) || !shortText(item["name"]) || typeof item["set"] !== "boolean") return null;
    secretEnv.push({ name: item["name"], set: item["set"] });
  }
  return { limits, commands: value["commands"], protectedPaths: value["protectedPaths"], secretEnv };
}

/** DR-41: what a task kind's own rules leave out of the config's policy (kinds and counts only). */
export interface PolicyNarrowingView {
  readonly workflow: string;
  readonly kind: string;
  readonly count: number;
}

/** The host's narrowings, checked; undefined (an older host) is none. */
export function toNarrowings(value: unknown): PolicyNarrowingView[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return null;
  const out: PolicyNarrowingView[] = [];
  for (const item of value) {
    if (!isObj(item) || !hasOnlyKeys(item, ["workflow", "kind", "count"]) || !shortText(item["workflow"]) || typeof item["kind"] !== "string" || !WORD.test(item["kind"]) || !count(item["count"]) || item["count"] < 1) return null;
    out.push({ workflow: item["workflow"], kind: item["kind"], count: item["count"] });
  }
  return out;
}

export type SettingsReply = { readonly ok: true; readonly view: SettingsView } | { readonly ok: false; readonly code: string };

function toProfileView(value: unknown): ProfileView | null {
  if (!isObj(value)) return null;
  const { name, workflowRef, limits, commands, verifiers, protectedPaths } = value;
  const provider = value["provider"] ?? null;
  if (!shortText(name) || !(workflowRef === null || shortText(workflowRef)) || !textList(commands) || !count(verifiers) || !count(protectedPaths)) return null;
  const hasPolicy = value["hasPolicy"] ?? false;
  const unreadablePaths = value["unreadablePaths"] ?? 0;
  if (typeof hasPolicy !== "boolean" || !count(unreadablePaths)) return null;
  if (!(provider === null || (typeof provider === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(provider)))) return null;
  if (!Array.isArray(limits) || limits.length > 32) return null;
  const pairs: (readonly [string, number | null])[] = [];
  for (const pair of limits) {
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    const [key, limit] = pair as unknown[];
    if (typeof key !== "string" || !/^[A-Za-z]{1,40}$/.test(key)) return null;
    if (!(limit === null || (typeof limit === "number" && Number.isFinite(limit)))) return null;
    pairs.push([key, limit as number | null]);
  }
  return { name, workflowRef: workflowRef as string | null, provider: provider as string | null, limits: pairs, commands, verifiers, protectedPaths, hasPolicy, unreadablePaths };
}

/** The engine host's settings value, checked field by field. `env` is added by the main process. */
export function toSettingsView(value: unknown, env: SettingsView["env"]): SettingsReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const fail: SettingsReply = { ok: false, code: "host_error" };
  const view = value["view"];
  if (!isObj(view)) return fail;
  const { file, model, language, profiles, workflows, keyAvailable, providers } = view;
  const rules = toRules(view["rules"]);
  if (rules === null) return fail;
  const apiProviders = toApiProviders(view["apiProviders"]);
  const policyNarrowings = toNarrowings(view["policyNarrowings"]);
  if (policyNarrowings === null) return fail;
  const provider = view["provider"] ?? null;
  const defaultProvider = view["defaultProvider"] ?? null;
  if (apiProviders === null || !(provider === null || (typeof provider === "string" && PROVIDER_NAME.test(provider))) || !(defaultProvider === null || (typeof defaultProvider === "string" && PROVIDER_NAME.test(defaultProvider)))) return fail;
  let fileView: SettingsView["file"] = null;
  if (file !== null) {
    if (!isObj(file) || !shortText(file["display"]) || typeof file["exists"] !== "boolean") return fail;
    const source = file["source"];
    if (typeof source !== "string" || !(SETTINGS_FILE_SOURCES as readonly string[]).includes(source)) return fail;
    fileView = { display: file["display"], source: source as (typeof SETTINGS_FILE_SOURCES)[number], exists: file["exists"] };
  }
  if (!(model === null || shortText(model)) || !(language === null || language === "ko" || language === "en")) return fail;
  if (!Array.isArray(profiles) || profiles.length > MAX_ITEMS || !isObj(workflows) || !textList(workflows["builtin"]) || !textList(workflows["config"])) return fail;
  if (typeof keyAvailable !== "boolean" || !textList(providers) || !providers.every((name) => PROVIDER_PATTERN.test(name))) return fail;
  const profileViews: ProfileView[] = [];
  for (const profile of profiles) {
    const checked = toProfileView(profile);
    if (checked === null) return fail;
    profileViews.push(checked);
  }
  const privateData = toPrivateData(view["privateData"]);
  if (privateData === undefined) return fail;
  return {
    ok: true,
    view: {
      file: fileView,
      model: model as string | null,
      language: language as "ko" | "en" | null,
      profiles: profileViews,
      workflows: { builtin: workflows["builtin"], config: workflows["config"] },
      privateData,
      keyAvailable,
      providers,
      env,
      rules,
      policyNarrowings,
      provider: provider as string | null,
      defaultProvider: defaultProvider as string | null,
      apiProviders,
    },
  };
}

/** GU-6: a settings change proposal as the window sees it: a token, the changed fields, the widening kinds. */
export type SettingsProposalReply =
  | {
      readonly ok: true;
      readonly token: string;
      readonly changes: readonly { readonly field: string; readonly change: string }[];
      readonly widening: readonly { readonly kind: string; readonly field: string }[];
      /** DR-41: what each task kind's own rules would leave out of the new policy. */
      readonly policyNarrowings: readonly PolicyNarrowingView[];
    }
  | { readonly ok: false; readonly code: string };

export type SettingsWrittenReply =
  | { readonly ok: true; readonly written: boolean; readonly changes: readonly { readonly field: string; readonly change: string }[]; readonly widening: readonly { readonly kind: string; readonly field: string }[] }
  | { readonly ok: false; readonly code: string };

function fieldList(value: unknown, key: "change" | "kind"): { field: string; change: string }[] | { kind: string; field: string }[] | null {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return null;
  const out: Record<string, string>[] = [];
  for (const item of value) {
    if (!isObj(item) || !shortText(item["field"]) || typeof item[key] !== "string" || !WORD.test(item[key] as string)) return null;
    out.push({ field: item["field"], [key]: item[key] as string });
  }
  return out as never;
}

/** The engine host's proposal, checked; the new config is kept by the main process only. */
export function toHostProposal(
  value: unknown,
):
  | { readonly ok: true; readonly next: Record<string, unknown>; readonly baseDigest: string; readonly changes: { field: string; change: string }[]; readonly widening: { kind: string; field: string }[]; readonly policyNarrowings: PolicyNarrowingView[] }
  | { readonly ok: false; readonly code: string } {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const { next, baseDigest } = value;
  const changes = fieldList(value["changes"], "change") as { field: string; change: string }[] | null;
  const widening = fieldList(value["widening"], "kind") as { kind: string; field: string }[] | null;
  const policyNarrowings = toNarrowings(value["policyNarrowings"]);
  if (!isObj(next) || typeof baseDigest !== "string" || !DIGEST.test(baseDigest) || changes === null || widening === null || policyNarrowings === null) return { ok: false, code: "host_error" };
  return { ok: true, next, baseDigest, changes, widening, policyNarrowings };
}

/** The engine host's written change, checked. */
export function toWrittenReply(value: unknown): SettingsWrittenReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const changes = fieldList(value["changes"], "change") as { field: string; change: string }[] | null;
  const widening = fieldList(value["widening"], "kind") as { kind: string; field: string }[] | null;
  if (typeof value["written"] !== "boolean" || changes === null || widening === null) return { ok: false, code: "host_error" };
  return { ok: true, written: value["written"], changes, widening };
}

/** GU-6: `applySettings` arguments: `{token}`, a proposal the main process made. */
export function parseTokenArgs(value: unknown): { readonly token: string } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["token"])) return null;
  return isHandle(value["token"]) ? { token: value["token"] } : null;
}

/** One listed model as the engine host gives it: `id` exactly as listed (kept by the main process), `shown` for the window. */
export interface HostModelEntry {
  readonly number: number;
  readonly id: string;
  readonly shown: string;
  readonly name: string;
}

export interface ModelCurrentView {
  readonly id: string;
  readonly source: "CODARYN_MODEL" | "config";
  readonly listed: boolean;
}

export type HostModelList =
  | { readonly ok: true; readonly provider: string; readonly models: readonly HostModelEntry[]; readonly current: ModelCurrentView | null }
  | { readonly ok: false; readonly code: string };

/** The engine host's model list, checked field by field. */
export function toHostModelList(value: unknown): HostModelList {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const fail: HostModelList = { ok: false, code: "host_error" };
  const { provider, models, current } = value;
  if (typeof provider !== "string" || !PROVIDER_PATTERN.test(provider) || !Array.isArray(models) || models.length > MAX_ITEMS) return fail;
  const entries: HostModelEntry[] = [];
  for (const entry of models) {
    if (!isObj(entry)) return fail;
    const { number, id, shown, name } = entry;
    if (!count(number) || typeof id !== "string" || !/^[!-~]{1,200}$/.test(id) || !shortText(shown) || !shortText(name)) return fail;
    entries.push({ number, id, shown, name });
  }
  let currentView: ModelCurrentView | null = null;
  if (current !== null) {
    if (!isObj(current) || !shortText(current["id"]) || (current["source"] !== "CODARYN_MODEL" && current["source"] !== "config") || typeof current["listed"] !== "boolean") {
      return fail;
    }
    currentView = { id: current["id"], source: current["source"], listed: current["listed"] };
  }
  return { ok: true, provider, models: entries, current: currentView };
}

/** One listed model as the window sees it: an entry id to choose it by, never the id that is sent. */
export interface ModelEntryView {
  readonly entry: string;
  readonly number: number;
  readonly id: string;
  readonly name: string;
}

export type ModelsReply =
  | { readonly ok: true; readonly provider: string; readonly models: readonly ModelEntryView[]; readonly current: ModelCurrentView | null }
  | { readonly ok: false; readonly code: string };

export type SelectModelReply =
  | { readonly ok: true; readonly selected: { readonly id: string; readonly created: boolean; readonly overridden: boolean } }
  | { readonly ok: false; readonly code: string };

const DIGEST = /^[0-9a-f]{64}$/;
const WORD = /^[a-z][a-z_-]{0,39}$/;

// Shared with the remaining facade checks; these names are internal, not facade exports.
export { ERROR_CODE, DIGEST, WORD };
