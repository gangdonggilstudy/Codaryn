/**
 * What the page may call (the preload's `window.codaryn`) and checks on what comes back. The page
 * trusts nothing it receives: every reply is checked before use, and text goes in as textContent.
 * Types only come from src/shared (erased at build time); the page loads nothing outside its own
 * directory.
 */

import type {
  DoctorReply,
  InfoView,
  ModelsReply,
  OpenReply,
  ProfileView,
  RecentView,
  RunDonePayload,
  RunEventsPayload,
  RunItemView,
  RunResultView,
  SelectModelReply,
  SettingsReply,
  TreeEntryView,
  TreeReply,
} from "../shared/ipc.js";

export interface CodarynApi {
  info(): Promise<unknown>;
  openFolder(): Promise<unknown>;
  recent(): Promise<unknown>;
  openRecent(id: string): Promise<unknown>;
  forgetRecent(id: string): Promise<unknown>;
  tree(workspace: string, node: string | null, offset: number): Promise<unknown>;
  reveal(workspace: string, node: string): Promise<unknown>;
  doctor(workspace: string | null): Promise<unknown>;
  settings(): Promise<unknown>;
  listModels(provider: string): Promise<unknown>;
  selectModel(entry: string): Promise<unknown>;
  startRun(workspace: string, goal: string, profile: string | null, workflow: string | null): Promise<unknown>;
  cancelRun(): Promise<unknown>;
  onRunEvents(listener: (payload: unknown) => void): void;
  onRunDone(listener: (payload: unknown) => void): void;
  onWorkspaceOpened(listener: (payload: unknown) => void): void;
}

declare global {
  interface Window {
    readonly codaryn: CodarynApi;
  }
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): value is string => typeof value === "string";
const HEX = /^[0-9a-f]{32}$/;
const KINDS = ["dir", "file", "link", "state", "other"];

export interface Workspace {
  readonly handle: string;
  readonly name: string;
}

export function asWorkspace(value: unknown): Workspace | null {
  if (!isObj(value) || !str(value["handle"]) || !HEX.test(value["handle"]) || !str(value["name"])) return null;
  return { handle: value["handle"], name: value["name"] };
}

export function asInfo(value: unknown): InfoView {
  const info = isObj(value) ? value : {};
  return {
    language: info["language"] === "ko" ? "ko" : "en",
    engine: str(info["engine"]) ? info["engine"] : "host_error",
    initialWorkspace: asWorkspace(info["initialWorkspace"]),
  };
}

export function asOpen(value: unknown): OpenReply {
  if (isObj(value) && value["ok"] === true) {
    const workspace = asWorkspace(value);
    if (workspace !== null) return { ok: true, ...workspace };
  }
  return { ok: false, code: isObj(value) && str(value["code"]) ? value["code"] : "host_error" };
}

export function asRecent(value: unknown): RecentView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): RecentView[] =>
    isObj(item) && str(item["id"]) && HEX.test(item["id"]) && str(item["name"]) && str(item["path"]) && typeof item["exists"] === "boolean"
      ? [{ id: item["id"], name: item["name"], path: item["path"], exists: item["exists"] }]
      : [],
  );
}

export function asTree(value: unknown): TreeReply {
  if (!isObj(value)) return { ok: false, code: "host_error" };
  if (value["ok"] !== true) return { ok: false, code: str(value["code"]) ? value["code"] : "host_error" };
  const { entries, total, offset, nextOffset } = value;
  const count = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  if (!Array.isArray(entries) || !count(total) || !count(offset) || !(nextOffset === null || count(nextOffset))) return { ok: false, code: "host_error" };
  const views: TreeEntryView[] = [];
  for (const entry of entries) {
    if (!isObj(entry) || !str(entry["name"]) || !str(entry["kind"]) || !KINDS.includes(entry["kind"]) || typeof entry["masked"] !== "boolean") {
      return { ok: false, code: "host_error" };
    }
    const id = entry["id"];
    views.push({ id: str(id) && HEX.test(id) ? id : null, name: entry["name"], kind: entry["kind"] as TreeEntryView["kind"], masked: entry["masked"] });
  }
  return { ok: true, entries: views, total, offset, nextOffset };
}

export function asDoctor(value: unknown): DoctorReply {
  if (!isObj(value)) return { ok: false, code: "host_error" };
  if (value["ok"] !== true) return { ok: false, code: str(value["code"]) ? value["code"] : "host_error" };
  return value as unknown as DoctorReply;
}

const failed = (value: unknown): { readonly ok: false; readonly code: string } => ({ ok: false, code: isObj(value) && str(value["code"]) ? value["code"] : "host_error" });
const strList = (value: unknown): value is string[] => Array.isArray(value) && value.every(str);

function asProfile(value: unknown): ProfileView | null {
  if (!isObj(value) || !str(value["name"]) || !(value["workflowRef"] === null || str(value["workflowRef"])) || !strList(value["commands"])) return null;
  const limits = Array.isArray(value["limits"])
    ? value["limits"].filter((pair): pair is [string, number | null] => Array.isArray(pair) && str(pair[0]) && (pair[1] === null || typeof pair[1] === "number"))
    : [];
  const n = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);
  return { name: value["name"], workflowRef: value["workflowRef"] as string | null, limits, commands: value["commands"], verifiers: n(value["verifiers"]), protectedPaths: n(value["protectedPaths"]) };
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
      env: { model: env["model"] === true, language: env["language"] === true },
    },
  };
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

const RUN_ID = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/;

/** GU-3: the answer to startRun. */
export function asStartRun(value: unknown): { readonly ok: true; readonly runId: string } | { readonly ok: false; readonly code: string } {
  if (isObj(value) && value["ok"] === true && str(value["runId"]) && RUN_ID.test(value["runId"])) return { ok: true, runId: value["runId"] };
  return failed(value);
}

/** GU-3: a batch of progress items; null when it does not fit. */
export function asRunEvents(value: unknown): RunEventsPayload | null {
  if (!isObj(value) || !str(value["runId"]) || !Array.isArray(value["items"]) || !isObj(value["counts"])) return null;
  const items: RunItemView[] = value["items"].flatMap((item: unknown) =>
    isObj(item) && str(item["kind"]) && str(item["text"]) && (item["at"] === null || str(item["at"])) ? [{ at: item["at"] as string | null, kind: item["kind"], text: item["text"] }] : [],
  );
  const n = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);
  return { runId: value["runId"], items, counts: { turns: n(value["counts"]["turns"]), tools: n(value["counts"]["tools"]) } };
}

/** GU-3: a run's end; null when it does not fit. The main process checked the result already. */
export function asRunDone(value: unknown): RunDonePayload | null {
  if (!isObj(value) || !str(value["runId"])) return null;
  if (value["ok"] !== true) return { runId: value["runId"], ok: false, code: str(value["code"]) ? value["code"] : "host_error" };
  const result = value["result"];
  const labels = value["labels"];
  if (!isObj(result) || !str(result["status"]) || !str(result["reason"]) || !isObj(labels) || !str(labels["status"]) || !str(labels["reason"])) return null;
  return { runId: value["runId"], ok: true, result: result as unknown as RunResultView, labels: { status: labels["status"], reason: labels["reason"] } };
}
