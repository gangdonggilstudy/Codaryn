/**
 * The narrow channel between the renderer (through the preload) and the main process
 * (docs/design/standalone-gui.md 6.4): the channel names and the checks the main process runs on
 * every argument and on what it passes back. Pure: no Node, Electron or DOM API.
 *
 * The preload repeats the channel names because a sandboxed preload cannot load local modules;
 * a unit test keeps the two lists equal.
 */

export const IPC_CHANNELS = {
  info: "codaryn:app:info",
  openFolder: "codaryn:workspace:open",
  recent: "codaryn:workspace:recent",
  openRecent: "codaryn:workspace:openrecent",
  forgetRecent: "codaryn:workspace:forgetrecent",
  tree: "codaryn:workspace:tree",
  reveal: "codaryn:workspace:reveal",
  doctor: "codaryn:doctor:run",
  settings: "codaryn:settings:read",
  listModels: "codaryn:models:list",
  selectModel: "codaryn:models:select",
  startRun: "codaryn:run:start",
  cancelRun: "codaryn:run:cancel",
  listRuns: "codaryn:runs:list",
  previewRevert: "codaryn:runs:previewrevert",
  revert: "codaryn:runs:revert",
} as const;

/**
 * Main → renderer: a workspace was opened from outside the window (the command line of a second
 * start); GU-3: a run's progress items, and its end.
 */
export const IPC_EVENTS = {
  workspaceOpened: "codaryn:event:workspaceopened",
  runEvents: "codaryn:event:runevents",
  runDone: "codaryn:event:rundone",
} as const;

/** A workspace handle the main process issued: 128 random bits as lowercase hex. */
export const HANDLE_PATTERN = /^[0-9a-f]{32}$/;

export function isHandle(value: unknown): value is string {
  return typeof value === "string" && HANDLE_PATTERN.test(value);
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Obj, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

/** `doctor` arguments: `{workspace: handle | null}` and nothing else. Null when they do not fit. */
export function parseDoctorArgs(value: unknown): { readonly workspace: string | null } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["workspace"])) return null;
  const workspace = value["workspace"];
  if (workspace === null || workspace === undefined) return { workspace: null };
  return isHandle(workspace) ? { workspace } : null;
}

/** `openRecent`, `forgetRecent`: one id the recent list gave out. */
export function parseIdArg(args: readonly unknown[]): string | null {
  return args.length === 1 && isHandle(args[0]) ? args[0] : null;
}

/** Largest offset a tree page may start at (MAX_TREE_ENTRIES in the engine host). */
export const MAX_TREE_OFFSET = 100_000;

/** `tree` arguments: `{workspace, node, offset}`; `node` null is the workspace root. */
export function parseTreeArgs(value: unknown): { readonly workspace: string; readonly node: string | null; readonly offset: number } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["workspace", "node", "offset"])) return null;
  const { workspace, node, offset } = value;
  if (!isHandle(workspace)) return null;
  if (node !== null && node !== undefined && !isHandle(node)) return null;
  const start = offset ?? 0;
  if (typeof start !== "number" || !Number.isSafeInteger(start) || start < 0 || start > MAX_TREE_OFFSET) return null;
  return { workspace, node: (node ?? null) as string | null, offset: start };
}

/** `reveal` arguments: `{workspace, node}`. */
export function parseRevealArgs(value: unknown): { readonly workspace: string; readonly node: string } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["workspace", "node"])) return null;
  const { workspace, node } = value;
  return isHandle(workspace) && isHandle(node) ? { workspace, node } : null;
}

/** A call that takes no arguments gets `undefined` from `ipcRenderer.invoke(channel)`. */
export function isNoArgs(args: readonly unknown[]): boolean {
  return args.length === 0 || (args.length === 1 && args[0] === undefined);
}

export const DOCTOR_CHECK_STATUSES = ["ok", "warn", "fail", "skipped"] as const;
export type DoctorCheckStatusView = (typeof DOCTOR_CHECK_STATUSES)[number];
export const DOCTOR_STATUSES = ["ok", "warn", "fail"] as const;
export type DoctorStatusView = (typeof DOCTOR_STATUSES)[number];

const CHECK_ID = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_CHECKS = 64;
const MAX_MESSAGE = 1000;

export interface DoctorCheckView {
  readonly id: string;
  readonly status: DoctorCheckStatusView;
  /** Fixed English text from the engine (DoctorCheck.message): never a value from a file or the environment. */
  readonly message: string;
}

export interface DoctorView {
  readonly status: DoctorStatusView;
  readonly checks: readonly DoctorCheckView[];
}

/**
 * The parts of a DoctorOutput (src/contracts/commands.ts) the window shows, checked field by
 * field. Anything else in the output is not passed on. Null when the shape does not fit.
 */
export function toDoctorView(output: unknown): DoctorView | null {
  if (!isObj(output) || output["kind"] !== "doctor") return null;
  const status = output["status"];
  if (typeof status !== "string" || !(DOCTOR_STATUSES as readonly string[]).includes(status)) return null;
  const checks = output["checks"];
  if (!Array.isArray(checks) || checks.length > MAX_CHECKS) return null;
  const views: DoctorCheckView[] = [];
  for (const check of checks) {
    if (!isObj(check)) return null;
    const { id, status: checkStatus, message } = check;
    if (typeof id !== "string" || !CHECK_ID.test(id)) return null;
    if (typeof checkStatus !== "string" || !(DOCTOR_CHECK_STATUSES as readonly string[]).includes(checkStatus)) return null;
    if (typeof message !== "string") return null;
    views.push({ id, status: checkStatus as DoctorCheckStatusView, message: message.slice(0, MAX_MESSAGE) });
  }
  return { status: status as DoctorStatusView, checks: views };
}

/** Message ids of the shared catalog (src/i18n) the doctor view needs, for the given checks. */
export function doctorMessageIds(view: DoctorView): string[] {
  const ids = new Set<string>();
  for (const check of view.checks) {
    ids.add(`doctor.check.${check.id}`);
    ids.add(`doctor.status.${check.status}`);
  }
  return [...ids];
}

/** What `info` answers. */
export interface InfoView {
  /** "ko" or "en", chosen by the engine host as the CLI chooses (CODARYN_LANG, then the OS). */
  readonly language: "ko" | "en";
  /** "ready", or the code of why the engine host is not available. */
  readonly engine: string;
  /** A workspace named on the command line, already opened by the main process. */
  readonly initialWorkspace: { readonly handle: string; readonly name: string } | null;
}

/** What `doctor` answers. Errors carry a code only; the window turns it into its own text. */
export type DoctorReply =
  | { readonly ok: true; readonly view: DoctorView; readonly labels: Readonly<Record<string, string>>; readonly workspaceName: string | null }
  | { readonly ok: false; readonly code: string };

/**
 * What `openFolder` answers: null when nothing was chosen, else what opening the chosen folder
 * answers (OpenReply), so the window can say why a folder was refused (R10b-L-2: a network
 * location is `workspace_not_local`).
 */
export type OpenFolderReply = OpenReply | null;

/** One remembered workspace. `path` is the folder the person chose; it is shown in the recent list only. */
export interface RecentView {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly exists: boolean;
}

/** What opening a remembered or command-line workspace answers. */
export type OpenReply = { readonly ok: true; readonly handle: string; readonly name: string } | { readonly ok: false; readonly code: string };

/**
 * dir, file: a plain directory or file. link: a link or junction, never followed. state: the
 * workspace's own `.codaryn`. other: anything else. A masked entry's name hid something (a key
 * shape or control characters); it has no id and cannot be opened.
 */
export const TREE_KINDS = ["dir", "file", "link", "state", "other"] as const;
export type TreeKind = (typeof TREE_KINDS)[number];

export interface TreeEntryView {
  /** Present for directories that can be expanded and files that can be shown in the file manager. */
  readonly id: string | null;
  /** The name as shown: control characters replaced and key shapes hidden. */
  readonly name: string;
  readonly kind: TreeKind;
  readonly masked: boolean;
}

export type TreeReply =
  | { readonly ok: true; readonly entries: readonly TreeEntryView[]; readonly total: number; readonly offset: number; readonly nextOffset: number | null }
  | { readonly ok: false; readonly code: string };

/** A model provider name as the app layer gives it (DR-22). */
export const PROVIDER_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_TEXT = 1000;
const MAX_ITEMS = 500;
const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;

const shortText = (value: unknown): value is string => typeof value === "string" && value.length <= MAX_TEXT;
const textList = (value: unknown): value is string[] => Array.isArray(value) && value.length <= MAX_ITEMS && value.every(shortText);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** The code of an engine host value that is not ok, or "host_error". */
export function hostCodeOf(value: unknown): string {
  const code = isObj(value) ? value["code"] : undefined;
  return typeof code === "string" && ERROR_CODE.test(code) ? code : "host_error";
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
  /** Limit name and value (null: no limit), as the profile sets them. */
  readonly limits: readonly (readonly [string, number | null])[];
  /** Executables the profile allows to run. */
  readonly commands: readonly string[];
  readonly verifiers: number;
  readonly protectedPaths: number;
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
  /** Whether CODARYN_MODEL and CODARYN_LANG are set (never their values). */
  readonly env: { readonly model: boolean; readonly language: boolean };
}

export type SettingsReply = { readonly ok: true; readonly view: SettingsView } | { readonly ok: false; readonly code: string };

function toProfileView(value: unknown): ProfileView | null {
  if (!isObj(value)) return null;
  const { name, workflowRef, limits, commands, verifiers, protectedPaths } = value;
  if (!shortText(name) || !(workflowRef === null || shortText(workflowRef)) || !textList(commands) || !count(verifiers) || !count(protectedPaths)) return null;
  if (!Array.isArray(limits) || limits.length > 32) return null;
  const pairs: (readonly [string, number | null])[] = [];
  for (const pair of limits) {
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    const [key, limit] = pair as unknown[];
    if (typeof key !== "string" || !/^[A-Za-z]{1,40}$/.test(key)) return null;
    if (!(limit === null || (typeof limit === "number" && Number.isFinite(limit)))) return null;
    pairs.push([key, limit as number | null]);
  }
  return { name, workflowRef: workflowRef as string | null, limits: pairs, commands, verifiers, protectedPaths };
}

/** The engine host's settings value, checked field by field. `env` is added by the main process. */
export function toSettingsView(value: unknown, env: SettingsView["env"]): SettingsReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const fail: SettingsReply = { ok: false, code: "host_error" };
  const view = value["view"];
  if (!isObj(view)) return fail;
  const { file, model, language, profiles, workflows, keyAvailable, providers } = view;
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
  return {
    ok: true,
    view: {
      file: fileView,
      model: model as string | null,
      language: language as "ko" | "en" | null,
      profiles: profileViews,
      workflows: { builtin: workflows["builtin"], config: workflows["config"] },
      keyAvailable,
      providers,
      env,
    },
  };
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

/** GU-3: the longest goal the window sends (the CLI's own checks still run in startRun). */
export const MAX_GOAL_CHARS = 20_000;
const NAME = /^[^\u0000-\u001f\u007f]{1,200}$/;

/** `startRun` arguments: the workspace handle, the goal, and the profile and task kind chosen, or null. */
export function parseStartRunArgs(value: unknown): { readonly workspace: string; readonly goal: string; readonly profile: string | null; readonly workflow: string | null } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["workspace", "goal", "profile", "workflow"])) return null;
  const { workspace, goal } = value;
  const profile = value["profile"] ?? null;
  const workflow = value["workflow"] ?? null;
  if (!isHandle(workspace) || typeof goal !== "string" || goal.trim().length === 0 || goal.length > MAX_GOAL_CHARS || goal.includes("\u0000")) return null;
  if (profile !== null && (typeof profile !== "string" || !NAME.test(profile))) return null;
  if (workflow !== null && (typeof workflow !== "string" || !NAME.test(workflow))) return null;
  return { workspace, goal, profile: profile as string | null, workflow: workflow as string | null };
}

export const RUN_STATUSES = ["done", "failed", "needs-input", "cancelled", "budget-exhausted"] as const;
const REASON = /^[a-z][a-z_]{0,39}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const RUN_ID = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/;

export function isRunId(value: unknown): value is string {
  return typeof value === "string" && RUN_ID.test(value);
}

export interface RunItemView {
  /** ISO time of the record, or null. */
  readonly at: string | null;
  /** The record type, "notice", or "gap" (items went missing: the report has them all). */
  readonly kind: string;
  readonly text: string;
}

export interface RunEventsPayload {
  readonly runId: string;
  readonly items: readonly RunItemView[];
  readonly counts: { readonly turns: number; readonly tools: number };
}

/** GU-3 (3.7 summary): what the window shows of a finished run. Texts are masked and cleaned. */
export interface RunResultView {
  readonly runId: string;
  readonly status: (typeof RUN_STATUSES)[number];
  readonly reason: string;
  readonly exitCode: number | null;
  readonly changes: readonly { readonly path: string; readonly created: boolean }[];
  readonly verifiers: readonly { readonly number: number; readonly outcome: string }[];
  readonly usage: {
    readonly turns: number | null;
    readonly tools: number | null;
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly durationMs: number | null;
  };
  readonly notices: readonly string[];
  readonly plan: { readonly digest: string; readonly actions: number | null } | null;
  readonly review: { readonly checklist: readonly string[] } | null;
  readonly protectedChanged: number | null;
}

export type RunDonePayload =
  | { readonly runId: string; readonly ok: true; readonly result: RunResultView; readonly labels: { readonly status: string; readonly reason: string } }
  | { readonly runId: string; readonly ok: false; readonly code: string };

const numOrNull = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);

/** The engine host's `done` outcome, checked field by field. */
export function toRunResultView(value: unknown): { readonly ok: true; readonly result: RunResultView } | { readonly ok: false; readonly code: string } {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const fail = { ok: false, code: "host_error" } as const;
  const result = value["result"];
  if (!isObj(result)) return fail;
  const { runId, status, reason, exitCode, changes, verifiers, usage, notices, plan, review, protectedChanged } = result;
  if (!isRunId(runId) || typeof status !== "string" || !(RUN_STATUSES as readonly string[]).includes(status) || typeof reason !== "string" || !REASON.test(reason)) return fail;
  if (!numOrNull(exitCode) || !numOrNull(protectedChanged) || !textList(notices)) return fail;
  if (!Array.isArray(changes) || changes.length > MAX_ITEMS || !Array.isArray(verifiers) || verifiers.length > MAX_ITEMS || !isObj(usage)) return fail;
  const changeViews: { path: string; created: boolean }[] = [];
  for (const change of changes) {
    if (!isObj(change) || !shortText(change["path"]) || typeof change["created"] !== "boolean") return fail;
    changeViews.push({ path: change["path"], created: change["created"] });
  }
  const verifierViews: { number: number; outcome: string }[] = [];
  for (const verifier of verifiers) {
    if (!isObj(verifier) || !count(verifier["number"]) || typeof verifier["outcome"] !== "string" || !REASON.test(verifier["outcome"])) return fail;
    verifierViews.push({ number: verifier["number"], outcome: verifier["outcome"] });
  }
  const { turns, tools, inputTokens, outputTokens, durationMs } = usage;
  if (![turns, tools, inputTokens, outputTokens, durationMs].every(numOrNull)) return fail;
  let planView: RunResultView["plan"] = null;
  if (plan !== null) {
    if (!isObj(plan) || typeof plan["digest"] !== "string" || !DIGEST.test(plan["digest"]) || !numOrNull(plan["actions"])) return fail;
    planView = { digest: plan["digest"], actions: plan["actions"] as number | null };
  }
  let reviewView: RunResultView["review"] = null;
  if (review !== null) {
    if (!isObj(review) || !textList(review["checklist"])) return fail;
    reviewView = { checklist: review["checklist"] };
  }
  return {
    ok: true,
    result: {
      runId,
      status: status as RunResultView["status"],
      reason,
      exitCode: exitCode as number | null,
      changes: changeViews,
      verifiers: verifierViews,
      usage: {
        turns: turns as number | null,
        tools: tools as number | null,
        inputTokens: inputTokens as number | null,
        outputTokens: outputTokens as number | null,
        durationMs: durationMs as number | null,
      },
      notices,
      plan: planView,
      review: reviewView,
      protectedChanged: protectedChanged as number | null,
    },
  };
}

/** GU-4: `listRuns` arguments: `{workspace}`. */
export function parseWorkspaceArgs(value: unknown): { readonly workspace: string } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["workspace"])) return null;
  return isHandle(value["workspace"]) ? { workspace: value["workspace"] } : null;
}

/** GU-4: `previewRevert` arguments: `{workspace, runId}`, a run id from the list (never "latest"). */
export function parseRunArgs(value: unknown): { readonly workspace: string; readonly runId: string } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["workspace", "runId"])) return null;
  const { workspace, runId } = value;
  return isHandle(workspace) && isRunId(runId) ? { workspace, runId } : null;
}

/** GU-4: `revert` arguments: `{preview}`, the token of a preview the main process made. */
export function parsePreviewArgs(value: unknown): { readonly preview: string } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["preview"])) return null;
  return isHandle(value["preview"]) ? { preview: value["preview"] } : null;
}

const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,9})?Z$/;
const WORD = /^[a-z][a-z_-]{0,39}$/;
export const REVERT_ACTIONS = ["restored", "deleted", "moved_back", "restored_from_discard"] as const;

/** GU-4 (3.8): one row of the run list. A damaged run has its id only. */
export type RunListItem =
  | {
      readonly state: "checked";
      readonly runId: string;
      readonly kind: "run" | "apply";
      readonly startedAt: string | null;
      readonly taskId: string;
      readonly status: string | null;
      readonly reason: string | null;
      readonly changes: number | null;
      readonly reverted: { readonly at: string; readonly status: "complete" | "partial" } | null;
      readonly revertRecordDamaged: boolean;
    }
  | { readonly state: "damaged"; readonly runId: string };

export type RunsReply = { readonly ok: true; readonly runs: readonly RunListItem[]; readonly omitted: number } | { readonly ok: false; readonly code: string };

const revertedMark = (value: unknown): { at: string; status: "complete" | "partial" } | null | undefined => {
  if (value === null) return null;
  if (!isObj(value) || typeof value["at"] !== "string" || !TIME.test(value["at"]) || (value["status"] !== "complete" && value["status"] !== "partial")) return undefined;
  return { at: value["at"], status: value["status"] };
};

/** The engine host's run list, checked field by field. */
export function toRunsReply(value: unknown): RunsReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const fail = { ok: false, code: "host_error" } as const;
  const { runs, omitted } = value;
  if (!Array.isArray(runs) || runs.length > 1000 || !count(omitted)) return fail;
  const items: RunListItem[] = [];
  for (const run of runs) {
    if (!isObj(run) || !isRunId(run["runId"])) return fail;
    if (run["state"] === "damaged") {
      items.push({ state: "damaged", runId: run["runId"] });
      continue;
    }
    const { kind, startedAt, taskId, status, reason, changes, revertRecordDamaged } = run;
    const reverted = revertedMark(run["reverted"]);
    if (run["state"] !== "checked" || (kind !== "run" && kind !== "apply") || !(startedAt === null || (typeof startedAt === "string" && TIME.test(startedAt)))) return fail;
    if (!shortText(taskId) || !(status === null || (typeof status === "string" && WORD.test(status))) || !(reason === null || (typeof reason === "string" && WORD.test(reason)))) return fail;
    if (!(changes === null || count(changes)) || reverted === undefined || typeof revertRecordDamaged !== "boolean") return fail;
    items.push({ state: "checked", runId: run["runId"], kind, startedAt: startedAt as string | null, taskId, status: status as string | null, reason: reason as string | null, changes: changes as number | null, reverted, revertRecordDamaged });
  }
  return { ok: true, runs: items, omitted };
}

/** GU-4 (3.8): a revert or its preview. */
export interface RevertView {
  readonly runId: string;
  readonly status: "complete" | "partial";
  readonly dryRun: boolean;
  readonly reverted: readonly { readonly path: string; readonly action: (typeof REVERT_ACTIONS)[number]; readonly from: string | null; readonly unsafe: boolean }[];
  readonly skipped: readonly { readonly path: string; readonly reason: string }[];
  readonly moveSafetyUnchecked: boolean;
  readonly revertedBefore: { readonly at: string; readonly status: "complete" | "partial" } | null;
}

/** A preview carries the token its revert takes; a revert does not. */
export type RevertReply = { readonly ok: true; readonly view: RevertView; readonly preview: string | null } | { readonly ok: false; readonly code: string };

/** The engine host's revert value, checked field by field. */
export function toRevertView(value: unknown): { readonly ok: true; readonly view: RevertView } | { readonly ok: false; readonly code: string } {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const fail = { ok: false, code: "host_error" } as const;
  const { runId, status, dryRun, reverted, skipped, moveSafetyUnchecked } = value;
  const before = revertedMark(value["revertedBefore"]);
  if (!isRunId(runId) || (status !== "complete" && status !== "partial") || typeof dryRun !== "boolean" || typeof moveSafetyUnchecked !== "boolean" || before === undefined) return fail;
  if (!Array.isArray(reverted) || reverted.length > 1000 || !Array.isArray(skipped) || skipped.length > 1000) return fail;
  const files: RevertView["reverted"][number][] = [];
  for (const file of reverted) {
    if (!isObj(file) || !shortText(file["path"]) || typeof file["action"] !== "string" || !(REVERT_ACTIONS as readonly string[]).includes(file["action"])) return fail;
    if (!(file["from"] === null || shortText(file["from"])) || typeof file["unsafe"] !== "boolean") return fail;
    files.push({ path: file["path"], action: file["action"] as (typeof REVERT_ACTIONS)[number], from: file["from"] as string | null, unsafe: file["unsafe"] });
  }
  const skips: RevertView["skipped"][number][] = [];
  for (const file of skipped) {
    if (!isObj(file) || !shortText(file["path"]) || typeof file["reason"] !== "string" || !WORD.test(file["reason"])) return fail;
    skips.push({ path: file["path"], reason: file["reason"] });
  }
  return { ok: true, view: { runId, status, dryRun, reverted: files, skipped: skips, moveSafetyUnchecked, revertedBefore: before } };
}

/** The engine host's answer to `selectModel`, checked. */
export function toSelectModelReply(value: unknown): SelectModelReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const selected = value["selected"];
  if (!isObj(selected) || !shortText(selected["id"]) || typeof selected["created"] !== "boolean" || typeof selected["overridden"] !== "boolean") return { ok: false, code: "host_error" };
  return { ok: true, selected: { id: selected["id"], created: selected["created"], overridden: selected["overridden"] } };
}
