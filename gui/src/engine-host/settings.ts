/**
 * GU-6 (docs/design/standalone-gui.md 3.10): the settings, a provider's model list and a model
 * choice, as the window may see them. Built in the engine host from the app layer's outputs
 * (`readSettings`, `listModels`, `selectModel`):
 * - The config file's full path stays here; only its display form (N-14) goes on.
 * - Every text from the config file or the API passes `shown` (control characters replaced, key
 *   shapes hidden) before it leaves the host. A model id also goes on as given, because choosing
 *   it must name exactly that id; the main process keeps it and the window gets `shown`.
 * - App errors go on as their code only. Messages can hold paths or values and are not passed on.
 */

import { commandText } from "../shared/settings-edit.js";

/** Text as the window may show it: cleaned of control characters and key shapes. */
export type Shown = (text: string) => string;

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const CODE = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_LIST = 500;
const MAX_MODEL_ID_CHARS = 200;

export type HostFailure = { readonly ok: false; readonly code: string };

/** An AppCallOutcome that is not ok, as its code only. */
export function failureOf(outcome: unknown): HostFailure {
  const error = isObj(outcome) ? outcome["error"] : undefined;
  const code = isObj(error) ? error["code"] : undefined;
  return { ok: false, code: typeof code === "string" && CODE.test(code) ? code : "host_error" };
}

/** The output of an ok AppCallOutcome, or null. */
function outputOf(outcome: unknown): Obj | null {
  if (!isObj(outcome) || outcome["ok"] !== true) return null;
  const output = outcome["output"];
  return isObj(output) ? output : null;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, MAX_LIST) : []);

function own(record: unknown, key: string): unknown {
  return isObj(record) && Object.hasOwn(record, key) ? record[key] : undefined;
}

const LIMIT_KEY = /^[A-Za-z]{1,40}$/;

function profileView(name: string, profile: unknown, workflowRef: string | null, shown: Shown): Obj {
  const limits: [string, number | null][] = [];
  const given = own(profile, "limits");
  if (isObj(given)) {
    for (const [key, value] of Object.entries(given)) {
      if (LIMIT_KEY.test(key) && (value === null || (typeof value === "number" && Number.isFinite(value)))) limits.push([key, value]);
    }
  }
  const policy = own(profile, "policy");
  const rules = own(policy, "commands");
  const commands = Array.isArray(rules)
    ? rules.slice(0, MAX_LIST).flatMap((rule) => (typeof own(rule, "executable") === "string" ? [shown(own(rule, "executable") as string)] : []))
    : [];
  const protectedPaths = own(policy, "protectedPaths");
  const verifiers = own(profile, "verifiers");
  const provider = own(profile, "provider");
  return {
    name: shown(name),
    workflowRef: workflowRef === null ? null : shown(workflowRef),
    // SP-D10: a profile's provider wins over the config's for runs with that profile.
    provider: typeof provider === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(provider) ? provider : null,
    limits,
    commands,
    verifiers: Array.isArray(verifiers) ? verifiers.length : 0,
    protectedPaths: Array.isArray(protectedPaths) ? protectedPaths.length : 0,
  };
}

/**
 * GU-6: the config file's own rules as the window shows them (3.10 permission rules, secret
 * names): limits, command rules as text, protected paths, secret variable names and whether each is
 * set now (never its value).
 */
function rulesView(config: Obj | null, shown: Shown, envSet: (name: string) => boolean): Obj {
  const policy = own(config, "policy");
  const limits: [string, number | null][] = [];
  const given = own(config, "limits");
  if (isObj(given)) {
    for (const [key, value] of Object.entries(given)) {
      if (LIMIT_KEY.test(key) && (value === null || (typeof value === "number" && Number.isFinite(value)))) limits.push([key, value]);
    }
  }
  const commands = own(policy, "commands");
  const paths = own(policy, "protectedPaths");
  const names = own(config, "secretEnv");
  return {
    policySet: isObj(policy),
    limits,
    commands: Array.isArray(commands) ? commands.slice(0, MAX_LIST).map((rule) => commandText(rule, shown)) : [],
    protectedPaths: Array.isArray(paths) ? paths.slice(0, MAX_LIST).map((item) => (typeof item === "string" ? shown(item) : "?")) : [],
    secretEnv: Array.isArray(names) ? names.slice(0, MAX_LIST).flatMap((name) => (typeof name === "string" ? [{ name: shown(name), set: envSet(name) }] : [])) : [],
  };
}

/** One API provider of the contract's table (API_PROVIDERS): its name and its variables' names. */
export interface ApiProviderEntry {
  readonly name: string;
  readonly keyEnv: string;
  readonly modelEnv: string;
}

/** Where the config keeps a provider's model (as `codaryn models --use` writes it): anthropic's top-level unless `providers.anthropic` is given. */
function providerModel(config: Obj | null, name: string): string | null {
  const entry = own(own(config, "providers"), name);
  const model = isObj(entry) ? entry["model"] : name === "anthropic" ? own(config, "model") : undefined;
  return typeof model === "string" && model.trim().length > 0 ? model : null;
}

/**
 * Each provider of the table as the settings screen shows it: the key variable's name and whether
 * it is set now (never its value), the model the config keeps for it and whether its model
 * variable overrides that, and whether the app layer lists its models (CONNECTED_MODEL_PROVIDERS).
 */
function apiProvidersView(config: Obj | null, table: readonly ApiProviderEntry[], listable: readonly string[], shown: Shown, envSet: (name: string) => boolean): Obj[] {
  return table.map((entry) => {
    const model = providerModel(config, entry.name);
    return {
      name: entry.name,
      keyEnv: entry.keyEnv,
      keySet: envSet(entry.keyEnv),
      modelEnv: entry.modelEnv,
      modelEnvSet: envSet(entry.modelEnv),
      model: model === null ? null : shown(model),
      listable: listable.includes(entry.name),
    };
  });
}

/** `readSettings` → `{ok, view}` (see SettingsView in src/shared/ipc.ts) or a failure. */
export function settingsValue(
  outcome: unknown,
  shown: Shown,
  providers: readonly string[],
  envSet: (name: string) => boolean = () => false,
  table: readonly ApiProviderEntry[] = [],
): Obj | HostFailure {
  const view = outputOf(outcome);
  if (view === null) return failureOf(outcome);
  const file = view["file"];
  const config = isObj(view["config"]) ? view["config"] : null;
  const profiles = own(config, "profiles");
  const workflowRefs = new Map<string, string | null>();
  if (Array.isArray(view["profileWorkflows"])) {
    for (const item of view["profileWorkflows"]) {
      const profile = own(item, "profile");
      const ref = own(item, "workflowRef");
      if (typeof profile === "string") workflowRefs.set(profile, typeof ref === "string" ? ref : null);
    }
  }
  const model = own(config, "model");
  const language = own(config, "language");
  return {
    ok: true,
    view: {
      file: isObj(file)
        ? { display: shown(typeof file["display"] === "string" ? file["display"] : ""), source: file["source"], exists: file["exists"] === true }
        : null,
      model: typeof model === "string" ? shown(model) : null,
      language: language === "ko" || language === "en" ? language : null,
      profiles: strings(view["profiles"]).map((name) => profileView(name, own(profiles, name), workflowRefs.get(name) ?? null, shown)),
      workflows: { builtin: strings(view["builtinWorkflows"]).map(shown), config: strings(view["workflows"]).map(shown) },
      keyAvailable: view["keyAvailable"] === true,
      providers: [...providers],
      rules: rulesView(config, shown, envSet),
      // SP-D3: the config's provider when it names one of the table; null: none (the CLI then uses anthropic).
      provider: typeof own(config, "provider") === "string" && table.some((entry) => entry.name === own(config, "provider")) ? (own(config, "provider") as string) : null,
      defaultProvider: table.some((entry) => entry.name === "anthropic") ? "anthropic" : (table[0]?.name ?? null),
      apiProviders: apiProvidersView(config, table, providers, shown, envSet),
    },
  };
}

const CHANGE = ["added", "removed", "changed"];

/**
 * GU-6: a settings change proposal → `{ok, next, baseDigest, changes, widening}`. `next` (the whole
 * new config) goes to the main process only, which keeps it for the apply; the window gets the
 * changed fields and the widening kinds (never values).
 */
export function proposalValue(outcome: unknown, next: Obj, shown: Shown): Obj | HostFailure {
  const output = outputOf(outcome);
  if (output === null) return failureOf(outcome);
  const baseDigest = output["baseDigest"];
  if (typeof baseDigest !== "string" || !/^[0-9a-f]{64}$/.test(baseDigest)) return { ok: false, code: "host_error" };
  return { ok: true, next, baseDigest, ...fieldsOf(output, shown) };
}

function fieldsOf(output: Obj, shown: Shown): Obj {
  return {
    changes: (Array.isArray(output["changes"]) ? output["changes"].slice(0, MAX_LIST) : []).flatMap((item) =>
      isObj(item) && typeof item["field"] === "string" && typeof item["change"] === "string" && CHANGE.includes(item["change"]) ? [{ field: shown(item["field"]), change: item["change"] }] : [],
    ),
    widening: (Array.isArray(output["widening"]) ? output["widening"].slice(0, MAX_LIST) : []).flatMap((item) =>
      isObj(item) && typeof item["kind"] === "string" && /^[a-z][a-z_]{0,39}$/.test(item["kind"]) && typeof item["field"] === "string" ? [{ kind: item["kind"], field: shown(item["field"]) }] : [],
    ),
  };
}

/** GU-6: a written settings change → `{ok, written, changes, widening}`. */
export function writtenValue(outcome: unknown, shown: Shown): Obj | HostFailure {
  const output = outputOf(outcome);
  if (output === null) return failureOf(outcome);
  return { ok: true, written: output["written"] === true, ...fieldsOf(output, shown) };
}

/** `listModels` → `{ok, provider, models: [{number, id, shown, name}], current}` or a failure. */
export function modelsValue(provider: string, outcome: unknown, shown: Shown): Obj | HostFailure {
  const output = outputOf(outcome);
  if (output === null) return failureOf(outcome);
  const models: Obj[] = [];
  if (Array.isArray(output["models"])) {
    for (const entry of output["models"].slice(0, MAX_LIST)) {
      const id = own(entry, "id");
      const number = own(entry, "number");
      const name = own(entry, "displayName");
      if (typeof id !== "string" || id.length === 0 || id.length > MAX_MODEL_ID_CHARS || typeof number !== "number") continue;
      models.push({ number, id, shown: shown(id), name: shown(typeof name === "string" ? name : id) });
    }
  }
  const current = output["current"];
  const currentId = own(current, "id");
  return {
    ok: true,
    provider,
    models,
    current:
      typeof currentId === "string"
        ? { id: shown(currentId), source: own(current, "source") === "CODARYN_MODEL" ? "CODARYN_MODEL" : "config", listed: own(current, "listed") === true }
        : null,
  };
}

/** `selectModel` → `{ok, selected: {id, created, overridden}}` or a failure. */
export function selectedValue(outcome: unknown, shown: Shown): Obj | HostFailure {
  const output = outputOf(outcome);
  if (output === null) return failureOf(outcome);
  const selected = output["selected"];
  const id = own(selected, "id");
  if (typeof id !== "string") return { ok: false, code: "model_not_selected" };
  return { ok: true, selected: { id: shown(id), created: own(selected, "created") === true, overridden: own(selected, "overriddenBy") === "CODARYN_MODEL" } };
}
