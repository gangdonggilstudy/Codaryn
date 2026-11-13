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
  ChangedFileItem,
  ChangesReply,
  PlanReply,
  ReportReply,
  RunFormView,
  ReportView,
  PlanView,
  RecentView,
  ReviewReply,
  RevertReply,
  RevertView,
  RunDonePayload,
  PlanApplyView,
  CopyReply,
  RestartReply,
  RunListItem,
  RunsReply,
  RunEventsPayload,
  RunItemView,
  RunResultView,
  SelectModelReply,
  SettingsReply,
  SettingsProposalReply,
  SettingsRules,
  SuggestedCommandView,
  PolicyNarrowingView,
  ApiProviderView,
  SettingsWrittenReply,
  TreeEntryView,
  TreeReply,
  RunEventsReply,
  PlanCheckReply,
  TextReadOnlyReason,
  TextNotOpened,
  TextReply,
  SaveTextReply,
  TextProblem,
  TextSaveRefusal,
} from "../shared/ipc.js";
import type { CleanupPlanView, CleanupResultView, StateSummaryView } from "../shared/cleanup.js";

export interface CodarynApi {
  info(): Promise<unknown>;
  openFolder(): Promise<unknown>;
  recent(): Promise<unknown>;
  openRecent(id: string): Promise<unknown>;
  forgetRecent(id: string): Promise<unknown>;
  tree(workspace: string, node: string | null, offset: number): Promise<unknown>;
  reveal(workspace: string, node: string): Promise<unknown>;
  /** U-174 (DR-72, 3.14): the text view of a tree or changes entry, by its id (the main process resolves and checks it). */
  openText(workspace: string, node: string): Promise<unknown>;
  /** U-184 (DR-72, 3.14): saves the text view's text with its edit token (the main process asks once per opened file and the app layer judges). */
  saveText(token: string, text: string): Promise<unknown>;
  /** U-184: tells the main process whether the text view holds an unsaved edit (closing the window asks then). */
  textDirty(dirty: boolean): Promise<unknown>;
  /** U-62: copies a run id or a digest's first 12 characters (the main process takes nothing else). */
  copyText(text: string): Promise<unknown>;
  /** U-103 (3.3): copies a tree entry's relative path, by its id (the main process resolves and checks it). */
  copyPath(workspace: string, node: string): Promise<unknown>;
  /** U-69 (3.10): shows the config file in the file manager (the main process has its path; the page does not). */
  revealConfig(): Promise<unknown>;
  /** U-70 (4.5): keeps the screen shown or the file panel's width (the main process checks both). */
  saveUi(change: { readonly screen?: string; readonly treeWidth?: number }): Promise<unknown>;
  doctor(workspace: string | null): Promise<unknown>;
  settings(): Promise<unknown>;
  listModels(provider: string): Promise<unknown>;
  selectModel(entry: string): Promise<unknown>;
  proposeSettings(edit: Readonly<Record<string, unknown>>): Promise<unknown>;
  applySettings(token: string): Promise<unknown>;
  stateSummary(workspace: string): Promise<unknown>;
  previewCleanup(workspace: string, selection: Readonly<Record<string, unknown>>): Promise<unknown>;
  applyCleanup(token: string): Promise<unknown>;
  startRun(workspace: string, goal: string, profile: string | null, workflow: string | null): Promise<unknown>;
  /** U-63: a run of a task file the main process's OS dialog chooses (and a variables file when `withVars`). */
  startTaskRun(workspace: string, withVars: boolean): Promise<unknown>;
  cancelRun(): Promise<unknown>;
  onRunEvents(listener: (payload: unknown) => void): void;
  onRunDone(listener: (payload: unknown) => void): void;
  /** U-64: starts the engine again after it ended. */
  restartEngine(): Promise<unknown>;
  /** U-64: the engine's state when it changes ("ready", or an error code). */
  onEngineState(listener: (payload: unknown) => void): void;
  /** U-123: the main process dropped the tree's ids (settings written). */
  onTreeReset(listener: () => void): void;
  listRuns(workspace: string): Promise<unknown>;
  previewRevert(workspace: string, runId: string): Promise<unknown>;
  revert(preview: string): Promise<unknown>;
  revertConsent(retry: string): Promise<unknown>;
  report(workspace: string, runId: string): Promise<unknown>;
  saveReport(workspace: string, runId: string): Promise<unknown>;
  createSettings(workspace: string | null): Promise<unknown>;
  settingsSuggestions(workspace: string): Promise<unknown>;
  plan(workspace: string, runId: string, profile: string | null, workflow: string | null): Promise<unknown>;
  applyPlan(approval: string, askConsent: boolean): Promise<unknown>;
  review(workspace: string, runId: string, profile: string | null, workflow: string | null, decision: "accept" | "reject", note: string | null): Promise<unknown>;
  changes(workspace: string, runId: string, profile: string | null, workflow: string | null): Promise<unknown>;
  /** U-119 (3.9): the check before an apply of the plan a view showed, by its approval token. */
  checkPlan(approval: string): Promise<unknown>;
  /** U-118 (3.7): one page of a run's records as the progress list's lines. */
  runEvents(workspace: string, runId: string, profile: string | null, workflow: string | null, offset: number): Promise<unknown>;
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
  /** R21b-L-1: the form of the last run started here from this app, or null. */
  readonly lastForm?: RunFormView | null;
}

/** A remembered task form, or null when it does not fit. */
export function asForm(value: unknown): RunFormView | null {
  if (!isObj(value)) return null;
  const name = (v: unknown): v is string | null => v === null || (str(v) && v.length > 0 && v.length <= 200);
  return name(value["profile"]) && name(value["workflow"]) ? { profile: value["profile"], workflow: value["workflow"] } : null;
}

export function asWorkspace(value: unknown): Workspace | null {
  if (!isObj(value) || !str(value["handle"]) || !HEX.test(value["handle"]) || !str(value["name"])) return null;
  return { handle: value["handle"], name: value["name"], lastForm: asForm(value["lastForm"]) };
}

export function asInfo(value: unknown): InfoView {
  const info = isObj(value) ? value : {};
  return {
    language: info["language"] === "ko" ? "ko" : "en",
    engine: str(info["engine"]) ? info["engine"] : "host_error",
    initialWorkspace: asWorkspace(info["initialWorkspace"]),
    ui: asUi(info["ui"]),
  };
}

/** U-70: the remembered screen (a plain id) and file panel width (160 to 800), each dropped when it does not fit. */
function asUi(value: unknown): { readonly screen: string | null; readonly treeWidth: number | null } {
  const ui = isObj(value) ? value : {};
  const screen = ui["screen"];
  const width = ui["treeWidth"];
  return {
    screen: str(screen) && /^[a-z]{1,20}$/.test(screen) ? screen : null,
    treeWidth: typeof width === "number" && Number.isSafeInteger(width) && width >= 160 && width <= 800 ? width : null,
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
    isObj(item) && str(item["id"]) && HEX.test(item["id"]) && str(item["name"]) && str(item["where"]) && typeof item["exists"] === "boolean"
      ? [{ id: item["id"], name: item["name"], where: item["where"], exists: item["exists"] }]
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
    views.push({ id: str(id) && HEX.test(id) ? id : null, name: entry["name"], kind: entry["kind"] as TreeEntryView["kind"], masked: entry["masked"], protected: entry["protected"] === true });
  }
  return { ok: true, entries: views, total, offset, nextOffset };
}

/**
 * U-174: the text view's reply (the main process checked it already). The page loads nothing from
 * outside its directory, so the known reasons are repeated here; one it does not know is dropped and
 * the file counts as not editable.
 */
const TEXT_REASONS: readonly string[] = ["masked", "control_characters", "mixed_line_endings", "protected", "settings_file", "read_only", "hard_link", "workspace_locked"];
const TEXT_NOT_OPENED: readonly string[] = ["not_found", "not_file", "refused", "too_large", "not_text", "unreadable", "mask_failed"];

export function asText(value: unknown): TextReply {
  if (!isObj(value) || value["ok"] !== true) return failed(value);
  if (value["opened"] === false) return str(value["reason"]) && TEXT_NOT_OPENED.includes(value["reason"]) ? { ok: true, opened: false, reason: value["reason"] as TextNotOpened } : { ok: false, code: "host_error" };
  const { text, lines } = value;
  if (value["opened"] !== true || !str(text) || typeof lines !== "number" || !Number.isSafeInteger(lines) || lines < 1) return { ok: false, code: "host_error" };
  const given: unknown[] = Array.isArray(value["readOnlyReasons"]) ? value["readOnlyReasons"] : [];
  const reasons = given.filter((reason: unknown): reason is TextReadOnlyReason => str(reason) && TEXT_REASONS.includes(reason));
  const masked = value["masked"] === true;
  return {
    ok: true,
    opened: true,
    text,
    masked,
    protected: value["protected"] === true,
    editable: value["editable"] === true && given.length === 0 && !masked && str(value["editToken"]) && HEX.test(value["editToken"]),
    readOnlyReasons: reasons,
    lines,
    editToken: str(value["editToken"]) && HEX.test(value["editToken"]) ? value["editToken"] : null,
  };
}

const TEXT_PROBLEMS: readonly string[] = ["masked", "control_characters", "too_large"];
const SAVE_REFUSALS: readonly string[] = ["conflict", "workspace_locked", "not_editable", "text_refused", "path_changed", "write_failed", ...TEXT_NOT_OPENED];

/** U-184: a save's reply (the main process checked it already); unknown reasons or problems are dropped. */
export function asSaveText(value: unknown): SaveTextReply {
  if (!isObj(value) || value["ok"] !== true) return failed(value);
  const lockLeft = value["lockLeft"] === true;
  if (value["saved"] === true) {
    const token = value["editToken"];
    // V-5 M-1: a write that ended after its token was dropped is saved with no next token.
    if (token === null) return { ok: true, saved: true, unchanged: value["unchanged"] === true, lockLeft, editToken: null };
    return str(token) && HEX.test(token) ? { ok: true, saved: true, unchanged: value["unchanged"] === true, lockLeft, editToken: token } : { ok: false, code: "host_error" };
  }
  const status = value["status"];
  if (value["saved"] !== false || !str(status) || !SAVE_REFUSALS.includes(status)) return { ok: false, code: "host_error" };
  const list = (field: string, known: readonly string[]): string[] => (Array.isArray(value[field]) ? (value[field] as unknown[]).filter((item): item is string => str(item) && known.includes(item)) : []);
  return {
    ok: true,
    saved: false,
    status: status as TextSaveRefusal,
    readOnlyReasons: list("readOnlyReasons", TEXT_REASONS) as TextReadOnlyReason[],
    textProblems: list("textProblems", TEXT_PROBLEMS) as TextProblem[],
    lockLeft,
  };
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
  return {
    name: value["name"],
    workflowRef: value["workflowRef"] as string | null,
    provider: str(value["provider"]) ? value["provider"] : null,
    limits,
    commands: value["commands"],
    verifiers: n(value["verifiers"]),
    protectedPaths: n(value["protectedPaths"]),
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
      env: { model: env["model"] === true, language: env["language"] === true },
      rules: asRules(view["rules"]),
      policyNarrowings: asNarrowings(view["policyNarrowings"]),
      provider: str(view["provider"]) ? view["provider"] : null,
      defaultProvider: str(view["defaultProvider"]) ? view["defaultProvider"] : null,
      apiProviders: Array.isArray(view["apiProviders"]) ? view["apiProviders"].flatMap(asApiProvider) : [],
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

/** GU-4: the run list. Rows that do not fit are left out. */
/** U-61: a row's plan apply state (the main process checked it; the window takes the known states only). */
function asPlanApply(value: unknown): PlanApplyView | null {
  if (!isObj(value) || !str(value["applyRunId"]) || !RUN_ID.test(value["applyRunId"])) return null;
  const state = value["state"];
  if (state !== "applied" && state !== "unfinished" && state !== "applying" && state !== "reverted" && state !== "record_missing") return null;
  return { state, applyRunId: value["applyRunId"], reason: str(value["reason"]) ? value["reason"] : null, ...(value["carried"] === true ? { carried: true as const } : {}) };
}

export function asRuns(value: unknown): RunsReply {
  if (!isObj(value) || value["ok"] !== true || !Array.isArray(value["runs"])) return failed(value);
  const runs: RunListItem[] = value["runs"].flatMap((run: unknown): RunListItem[] => {
    if (!isObj(run) || !str(run["runId"]) || !RUN_ID.test(run["runId"])) return [];
    if (run["state"] === "damaged") return [{ state: "damaged", runId: run["runId"] }];
    if (run["state"] !== "checked" || (run["kind"] !== "run" && run["kind"] !== "apply") || !str(run["taskId"])) return [];
    const reverted = isObj(run["reverted"]) && str(run["reverted"]["at"]) ? { at: run["reverted"]["at"], status: run["reverted"]["status"] === "partial" ? ("partial" as const) : ("complete" as const) } : null;
    return [
      {
        state: "checked",
        runId: run["runId"],
        kind: run["kind"],
        startedAt: str(run["startedAt"]) ? run["startedAt"] : null,
        taskId: run["taskId"],
        status: str(run["status"]) ? run["status"] : null,
        reason: str(run["reason"]) ? run["reason"] : null,
        changes: typeof run["changes"] === "number" ? run["changes"] : null,
        reverted,
        revertRecordDamaged: run["revertRecordDamaged"] === true,
        recordsChanged: run["recordsChanged"] === true,
        planApply: asPlanApply(run["planApply"]),
        planRunId: str(run["planRunId"]) && RUN_ID.test(run["planRunId"]) ? run["planRunId"] : null,
        form: asForm(run["form"]),
      },
    ];
  });
  return { ok: true, runs, omitted: typeof value["omitted"] === "number" ? value["omitted"] : 0 };
}

/** GU-4: a revert or its preview (the main process checked the view already). */
export function asRevert(value: unknown): RevertReply {
  if (!isObj(value) || value["ok"] !== true || !isObj(value["view"])) return failed(value);
  const view = value["view"];
  if (!str(view["runId"]) || !Array.isArray(view["reverted"]) || !Array.isArray(view["skipped"])) return failed(value);
  const preview = str(value["preview"]) && HEX.test(value["preview"]) ? value["preview"] : null;
  const consentRetry = str(value["consentRetry"]) && HEX.test(value["consentRetry"]) ? value["consentRetry"] : null;
  return { ok: true, view: view as unknown as RevertView, preview, consentRetry };
}

/** GU-5: a plan view (the main process checked it already) and the approval token its apply takes. */
export function asPlan(value: unknown): PlanReply {
  if (!isObj(value) || value["ok"] !== true || !isObj(value["view"])) return failed(value);
  const view = value["view"];
  if (!str(view["runId"]) || !str(view["digest"]) || !Array.isArray(view["actions"]) || (view["status"] !== "pending" && view["status"] !== "applied")) return failed(value);
  // U-206: a run plan names its kind and lists its files (the main process checked each).
  if (view["planKind"] !== undefined && (view["planKind"] !== "changes" || !Array.isArray(view["files"]))) return failed(value);
  const approval = str(value["approval"]) && HEX.test(value["approval"]) ? value["approval"] : null;
  return { ok: true, view: view as unknown as PlanView, approval };
}

/** U-64: the answer to restartEngine. */
export function asRestart(value: unknown): RestartReply {
  return isObj(value) && value["ok"] === true ? { ok: true } : failed(value);
}

/** U-64: an engine state event: "ready", or an error code; null when it does not fit. */
export function asEngineState(value: unknown): string | null {
  const state = isObj(value) ? value["state"] : null;
  return typeof state === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(state) ? state : null;
}

/** U-62: a copy's answer. */
export function asCopy(value: unknown): CopyReply {
  return isObj(value) && value["ok"] === true ? { ok: true } : failed(value);
}

/** GU-5: a recorded review. */
export function asReview(value: unknown): ReviewReply {
  if (!isObj(value) || value["ok"] !== true || (value["verdict"] !== "accepted" && value["verdict"] !== "rejected")) return failed(value);
  return { ok: true, verdict: value["verdict"], replaced: value["replaced"] === true };
}

/** DR-29: a run's changed files, by path and state. Rows that do not fit are left out. U-48: the run's records-changed mark. */
export function asChanges(value: unknown): ChangesReply {
  if (!isObj(value) || value["ok"] !== true || !str(value["runId"]) || !Array.isArray(value["files"])) return failed(value);
  const files: ChangedFileItem[] = value["files"].flatMap((file: unknown): ChangedFileItem[] =>
    isObj(file) && str(file["path"]) && typeof file["created"] === "boolean" && str(file["state"])
      ? [
          {
            path: file["path"],
            created: file["created"],
            state: file["state"] as ChangedFileItem["state"],
            unavailable: str(file["unavailable"]) ? file["unavailable"] : null,
            before: str(file["before"]) ? file["before"] : null,
            after: str(file["after"]) ? file["after"] : null,
            // U-66: the main process's id for "show in folder", or null.
            id: str(file["id"]) && HEX.test(file["id"]) ? file["id"] : null,
          },
        ]
      : [],
  );
  return { ok: true, runId: value["runId"], recordsChanged: value["recordsChanged"] === true, files };
}

/** U-119: the check before an apply (the main process checked it already). */
export function asPlanCheck(value: unknown): PlanCheckReply {
  if (!isObj(value) || value["ok"] !== true || !Array.isArray(value["problems"]) || !Array.isArray(value["unsafeMoves"])) return failed(value);
  const n = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);
  return {
    ok: true,
    ...(value["planKind"] === "changes" ? { planKind: "changes" as const } : {}),
    problems: value["problems"].flatMap((item: unknown) => (isObj(item) && typeof item["index"] === "number" && str(item["problem"]) ? [{ index: n(item["index"]), problem: item["problem"] }] : [])),
    unsafeMoves: value["unsafeMoves"].filter((index: unknown): index is number => typeof index === "number" && Number.isSafeInteger(index) && index >= 0),
    inventoryLimitReached: value["inventoryLimitReached"] === true,
    probesLeft: n(value["probesLeft"]),
    probesRemoved: n(value["probesRemoved"]),
    lockLeft: value["lockLeft"] === true,
  };
}

/** U-118: a page of a run's records (the main process checked it already). Items that do not fit are left out. */
export function asRunEventsPage(value: unknown): RunEventsReply {
  if (!isObj(value) || value["ok"] !== true || !str(value["runId"]) || !Array.isArray(value["items"])) return failed(value);
  const status = value["status"];
  if (status !== "complete" && status !== "incomplete" && status !== "damaged") return failed(value);
  const n = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);
  const items = value["items"].flatMap((item: unknown) => (isObj(item) && str(item["kind"]) && str(item["text"]) ? [{ at: str(item["at"]) ? item["at"] : null, kind: item["kind"], text: item["text"] }] : []));
  const next = value["nextOffset"];
  return {
    ok: true,
    runId: value["runId"],
    runKind: value["runKind"] === "apply" ? "apply" : "run",
    status,
    recordsChanged: value["recordsChanged"] === true,
    items,
    records: n(value["records"]),
    total: n(value["total"]),
    skipped: n(value["skipped"]),
    missing: n(value["missing"]),
    offset: n(value["offset"]),
    nextOffset: typeof next === "number" && Number.isSafeInteger(next) && next >= 0 ? next : null,
  };
}

/** GU-3: a run's report (the main process checked it already). */
export function asReport(value: unknown): ReportReply {
  if (!isObj(value) || value["ok"] !== true || !isObj(value["view"])) return failed(value);
  const view = value["view"];
  if (!str(view["runId"]) || (view["kind"] !== "run" && view["kind"] !== "apply") || !Array.isArray(view["verifiers"]) || !Array.isArray(view["integrity"])) return failed(value);
  const labels = value["labels"];
  return {
    ok: true,
    view: view as unknown as ReportView,
    labels: isObj(labels) && str(labels["status"]) && str(labels["reason"]) ? { status: labels["status"], reason: labels["reason"] } : null,
  };
}

/** GU-4: the state summary (the main process checked it). */
export function asStateSummary(value: unknown): { readonly ok: true; readonly summary: StateSummaryView } | { readonly ok: false; readonly code: string } {
  if (!isObj(value) || value["ok"] !== true || !isObj(value["summary"])) return failed(value);
  const summary = value["summary"];
  if (!Array.isArray(summary["entries"]) || !isObj(summary["runs"]) || !isObj(summary["discarded"]) || !isObj(summary["parked"]) || !isObj(summary["leftovers"])) return failed(value);
  return { ok: true, summary: summary as unknown as StateSummaryView };
}

/** GU-4: a cleanup preview: the main process's token and the plan to show. */
export function asCleanupPreview(value: unknown): { readonly ok: true; readonly token: string; readonly plan: CleanupPlanView } | { readonly ok: false; readonly code: string } {
  if (!isObj(value) || value["ok"] !== true || !str(value["token"]) || !HEX.test(value["token"]) || !isObj(value["plan"])) return failed(value);
  const plan = value["plan"];
  if (!Array.isArray(plan["items"]) || !Array.isArray(plan["blocked"]) || !isObj(plan["totals"]) || !isObj(plan["parked"]) || !str(plan["digest"])) return failed(value);
  return { ok: true, token: value["token"], plan: plan as unknown as CleanupPlanView };
}

/** GU-4: a cleanup's result, or why the main process did not clean (not_confirmed, unknown_preview, ...). */
export function asCleanupResult(value: unknown): { readonly ok: true; readonly result: CleanupResultView } | { readonly ok: false; readonly code: string } {
  if (!isObj(value) || value["ok"] !== true || !isObj(value["result"])) return failed(value);
  const result = value["result"];
  if (result["ok"] === false) return { ok: true, result: { ok: false, code: str(result["code"]) ? result["code"] : "host_error" } };
  if (result["ok"] !== true || !Array.isArray(result["removed"]) || !Array.isArray(result["kept"]) || !isObj(result["totals"])) return failed(value);
  // DR-48: CLEANUP_RESULT_STATUSES of src/shared/cleanup.ts (the page loads nothing from there).
  if (!["removed", "nothing_removed", "partly_failed"].includes(result["status"] as string)) return failed(value);
  return { ok: true, result: result as unknown as CleanupResultView };
}

/** GU-3: a saved report: the chosen file's name, or why it was not saved (not_saved: the dialog was cancelled). */
export function asSaveReport(value: unknown): { readonly ok: true; readonly name: string } | { readonly ok: false; readonly code: string } {
  if (!isObj(value) || value["ok"] !== true) return failed(value);
  return str(value["name"]) && value["name"].length <= 260 ? { ok: true, name: value["name"] } : failed(value);
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
