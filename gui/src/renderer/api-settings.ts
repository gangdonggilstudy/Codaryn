/** Renderer settings replies and their own helpers. Public callers use ./api.js. */
import type {
  ModelsReply,
  ProfileView,
  SelectModelReply,
  SettingsReply,
  SettingsProposalReply,
  SettingsPrivateDataView,
  SettingsRules,
  SuggestedCommandView,
  PolicyNarrowingView,
  ApiProviderView,
  SettingsWrittenReply,
} from "../shared/ipc.js";
import { failed, HEX, isObj, str, strList } from "./api-core.js";

function asProfile(value: unknown): ProfileView | null {
  if (!isObj(value) || !str(value["name"]) || !(value["workflowRef"] === null || str(value["workflowRef"])) || !strList(value["commands"])) return null;
  const limits = Array.isArray(value["limits"])
    ? value["limits"].filter((pair): pair is [string, number | null] => Array.isArray(pair) && str(pair[0]) && (pair[1] === null || typeof pair[1] === "number"))
    : [];
  const n = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);
  return {
    name: value["name"],
    workflowRef: value["workflowRef"] as string | null,
    provider: str(value["provider"]) ? value["provider"] : null,
    limits,
    commands: value["commands"],
    verifiers: n(value["verifiers"]),
    protectedPaths: n(value["protectedPaths"]),
    hasPolicy: value["hasPolicy"] === true,
    unreadablePaths: n(value["unreadablePaths"]),
  };
}

/** GU-6: the settings view, checked again on this side. */
export function asSettings(value: unknown): SettingsReply {
  if (!isObj(value) || value["ok"] !== true || !isObj(value["view"])) return failed(value);
  const view = value["view"];
  const file = view["file"];
  const workflows = isObj(view["workflows"]) ? view["workflows"] : {};
  const env = isObj(view["env"]) ? view["env"] : {};
  const sources = ["argument", "environment", "default"];
  return {
    ok: true,
    view: {
      file:
        isObj(file) && str(file["display"]) && str(file["source"]) && sources.includes(file["source"])
          ? { display: file["display"], source: file["source"] as "argument" | "environment" | "default", exists: file["exists"] === true }
          : null,
      model: str(view["model"]) ? view["model"] : null,
      language: view["language"] === "ko" || view["language"] === "en" ? view["language"] : null,
      profiles: Array.isArray(view["profiles"]) ? view["profiles"].map(asProfile).filter((p): p is ProfileView => p !== null) : [],
      workflows: { builtin: strList(workflows["builtin"]) ? workflows["builtin"] : [], config: strList(workflows["config"]) ? workflows["config"] : [] },
      keyAvailable: view["keyAvailable"] === true,
      providers: strList(view["providers"]) ? view["providers"] : [],
      env: { model: env["model"] === true, language: env["language"] === true, ...(env["os"] === "windows" || env["os"] === "posix" ? { os: env["os"] } : {}) },
      rules: asRules(view["rules"]),
      policyNarrowings: asNarrowings(view["policyNarrowings"]),
      provider: str(view["provider"]) ? view["provider"] : null,
      defaultProvider: str(view["defaultProvider"]) ? view["defaultProvider"] : null,
      apiProviders: Array.isArray(view["apiProviders"]) ? view["apiProviders"].flatMap(asApiProvider) : [],
      privateData: asPrivateData(view["privateData"]),
    },
  };
}

function asApiProvider(value: unknown): ApiProviderView[] {
  if (!isObj(value) || !str(value["name"]) || !str(value["keyEnv"]) || !str(value["modelEnv"])) return [];
  return [
    {
      name: value["name"],
      keyEnv: value["keyEnv"],
      keySet: value["keySet"] === true,
      modelEnv: value["modelEnv"],
      modelEnvSet: value["modelEnvSet"] === true,
      model: str(value["model"]) ? value["model"] : null,
      baseUrlEnv: str(value["baseUrlEnv"]) ? value["baseUrlEnv"] : null,
      baseUrlEnvSet: value["baseUrlEnvSet"] === true,
      listable: value["listable"] === true,
    },
  ];
}

/** U-247: the config's unreadable paths and k (the main process checked them); null when absent. */
function asPrivateData(value: unknown): SettingsPrivateDataView | null {
  if (!isObj(value) || !strList(value["unreadablePaths"]) || !isObj(value["minGroupSize"])) return null;
  const k = value["minGroupSize"];
  const n = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
  const [effective, min, max] = [n(k["effective"]), n(k["min"]), n(k["max"])];
  if (effective === null || min === null || max === null) return null;
  return { unreadablePaths: value["unreadablePaths"], minGroupSize: { configured: n(k["configured"]), effective, min, max } };
}

function asRules(value: unknown): SettingsRules {
  if (!isObj(value)) return { limits: [], commands: [], protectedPaths: [], secretEnv: [] };
  const limits = Array.isArray(value["limits"])
    ? value["limits"].filter((pair): pair is [string, number | null] => Array.isArray(pair) && str(pair[0]) && (pair[1] === null || typeof pair[1] === "number"))
    : [];
  const secretEnv = Array.isArray(value["secretEnv"])
    ? value["secretEnv"].flatMap((item) => (isObj(item) && str(item["name"]) && typeof item["set"] === "boolean" ? [{ name: item["name"], set: item["set"] }] : []))
    : [];
  return { limits, commands: strList(value["commands"]) ? value["commands"] : [], protectedPaths: strList(value["protectedPaths"]) ? value["protectedPaths"] : [], secretEnv };
}

type FieldChange = { readonly field: string; readonly change: string };
type Widening = { readonly kind: string; readonly field: string };

function fields(value: unknown): { changes: FieldChange[]; widening: Widening[] } | null {
  if (!isObj(value) || !Array.isArray(value["changes"]) || !Array.isArray(value["widening"])) return null;
  const changes: FieldChange[] = [];
  for (const item of value["changes"]) {
    if (!isObj(item) || !str(item["field"]) || !str(item["change"])) return null;
    changes.push({ field: item["field"], change: item["change"] });
  }
  const widening: Widening[] = [];
  for (const item of value["widening"]) {
    if (!isObj(item) || !str(item["field"]) || !str(item["kind"])) return null;
    widening.push({ field: item["field"], kind: item["kind"] });
  }
  return { changes, widening };
}

/** DR-41: task kinds' narrowings of the config's policy; entries that do not fit are left out. */
function asNarrowings(value: unknown): PolicyNarrowingView[] {
  return Array.isArray(value)
    ? value.flatMap((item) =>
        isObj(item) && str(item["workflow"]) && str(item["kind"]) && typeof item["count"] === "number" && Number.isSafeInteger(item["count"]) && item["count"] >= 1
          ? [{ workflow: item["workflow"], kind: item["kind"], count: item["count"] }]
          : [],
      )
    : [];
}

/** GU-6: a settings change proposal (a token from the main process, the changed fields, the widening kinds, DR-41's narrowings). */
export function asProposal(value: unknown): SettingsProposalReply {
  if (!isObj(value) || value["ok"] !== true || !str(value["token"]) || !HEX.test(value["token"])) return failed(value);
  const found = fields(value);
  return found === null ? { ok: false, code: "host_error" } : { ok: true, token: value["token"], ...found, policyNarrowings: asNarrowings(value["policyNarrowings"]) };
}

/** GU-6: a written settings change. */
export function asWritten(value: unknown): SettingsWrittenReply {
  if (!isObj(value) || value["ok"] !== true || typeof value["written"] !== "boolean") return failed(value);
  const found = fields(value);
  return found === null ? { ok: false, code: "host_error" } : { ok: true, written: value["written"], ...found };
}

/** GU-6: a model list. Entries without a valid entry id are left out. */
export function asModels(value: unknown): ModelsReply {
  if (!isObj(value) || value["ok"] !== true || !str(value["provider"]) || !Array.isArray(value["models"])) return failed(value);
  const models = value["models"].flatMap((m: unknown) =>
    isObj(m) && str(m["entry"]) && HEX.test(m["entry"]) && typeof m["number"] === "number" && str(m["id"]) && str(m["name"])
      ? [{ entry: m["entry"], number: m["number"], id: m["id"], name: m["name"] }]
      : [],
  );
  const current = value["current"];
  return {
    ok: true,
    provider: value["provider"],
    models,
    current:
      isObj(current) && str(current["id"])
        ? { id: current["id"], source: current["source"] === "CODARYN_MODEL" ? "CODARYN_MODEL" : "config", listed: current["listed"] === true }
        : null,
  };
}

export function asSelectModel(value: unknown): SelectModelReply {
  if (!isObj(value) || value["ok"] !== true || !isObj(value["selected"]) || !str(value["selected"]["id"])) return failed(value);
  const selected = value["selected"];
  return { ok: true, selected: { id: selected["id"] as string, created: selected["created"] === true, overridden: selected["overridden"] === true } };
}

/** U-11: the config file made with the defaults, or why not (config_exists: one is there and is used as it is). */
export function asCreateSettings(value: unknown): { readonly ok: true; readonly created: boolean; readonly model: "selected" | "placeholder"; readonly keySet: boolean; readonly overridden: boolean } | { readonly ok: false; readonly code: string } {
  if (!isObj(value) || value["ok"] !== true || typeof value["created"] !== "boolean") return failed(value);
  return { ok: true, created: value["created"], model: value["model"] === "selected" ? "selected" : "placeholder", keySet: value["keySet"] === true, overridden: value["overridden"] === true };
}

/** U-11: init's suggestions for the open workspace (the main process checked them). */
export function asSuggestions(value: unknown): { readonly ok: true; readonly commands: readonly SuggestedCommandView[]; readonly protectedPaths: readonly string[] } | { readonly ok: false; readonly code: string } {
  if (!isObj(value) || value["ok"] !== true || !Array.isArray(value["commands"]) || !strList(value["protectedPaths"])) return failed(value);
  return { ok: true, commands: value["commands"] as unknown as SuggestedCommandView[], protectedPaths: value["protectedPaths"] };
}
