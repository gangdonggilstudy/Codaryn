/**
 * The narrow channel between the renderer (through the preload) and the main process
 * (docs/design/standalone-gui.md 6.4): the channel names and the checks the main process runs on
 * every argument and on what it passes back. Pure: no Node, Electron or DOM API.
 *
 * The preload repeats the channel names because a sandboxed preload cannot load local modules;
 * a unit test keeps the two lists equal.
 */

import { MAX_ITEMS, count, hasOnlyKeys, isHandle, isObj, isRunId, shortText, textList, ERROR_CODE, DIGEST, WORD, hostCodeOf, UNSAFE_IN_MESSAGE, numOrNull, nameOrNull } from "./ipc/primitives.js";
import { copyablePath, toFinalMessage, toPlanActions } from "./ipc/core.js";
import type { RunFormView, FinalMessageView, PlanActionView } from "./ipc/core.js";

export { HANDLE_PATTERN, isHandle, isRunId, hostCodeOf, toStartFailure } from "./ipc/primitives.js";
export { parseDoctorArgs, parseIdArg, MAX_TREE_OFFSET, parseTreeArgs, parseRevealArgs, copyableValue, parseCopyArgs, MAX_COPY_PATH_CHARS, copyablePath, isNoArgs, DOCTOR_CHECK_STATUSES, DOCTOR_STATUSES, toDoctorView, doctorMessageIds, TREE_WIDTH_MIN, TREE_WIDTH_MAX, SCREEN_ID, parseSaveUiArgs, TREE_KINDS, MAX_FINAL_MESSAGE_CHARS } from "./ipc/core.js";
export type { CopyReply, RestartReply, DoctorCheckStatusView, DoctorStatusView, DoctorCheckView, DoctorView, UiMemoryView, InfoView, DoctorReply, OpenFolderReply, RecentView, RunFormView, OpenReply, TreeKind, TreeEntryView, TreeReply, FinalMessageView, PlanActionView } from "./ipc/core.js";

import type { SelectModelReply } from "./ipc/settings.js";

export { PROVIDER_PATTERN, parseProviderArgs, parseEntryArgs, SETTINGS_FILE_SOURCES, toNarrowings, toSettingsView, toHostProposal, toWrittenReply, parseTokenArgs, toHostModelList } from "./ipc/settings.js";
export type { ProfileView, SettingsView, SettingsPrivateDataView, ApiProviderView, SettingsRules, PolicyNarrowingView, SettingsReply, SettingsProposalReply, SettingsWrittenReply, HostModelEntry, ModelCurrentView, HostModelList, ModelEntryView, ModelsReply, SelectModelReply } from "./ipc/settings.js";

import { maskingOf } from "./ipc/run.js";
import type { RunItemView, MaskingView, RunResultView } from "./ipc/run.js";

export { MAX_GOAL_CHARS, parseStartTaskArgs, parseStartRunArgs, RUN_STATUSES, maskingOf, toRunResultView, confirmationsOf, parseCheckPlanArgs, toPlanCheckReply } from "./ipc/run.js";
export type { RunItemView, RunEventsPayload, MaskingView, RunResultView, RunDonePayload, ConfirmationsView, PlanCheckReply } from "./ipc/run.js";

export { TEXT_READ_ONLY_REASONS, TEXT_NOT_OPENED, MAX_TEXT_CHARS, toTextReply, textDigestOf, TEXT_PROBLEMS, TEXT_SAVE_REFUSALS, parseSaveTextArgs, parseTextDirtyArgs, toSaveOutcome } from "./ipc/text.js";
export type { TextReadOnlyReason, TextNotOpened, TextReply, TextProblem, TextSaveRefusal, SaveTextReply } from "./ipc/text.js";

export const IPC_CHANNELS = {
  info: "codaryn:app:info",
  restartEngine: "codaryn:app:restartengine",
  copyText: "codaryn:app:copy",
  copyPath: "codaryn:workspace:copypath",
  revealConfig: "codaryn:settings:revealconfig",
  saveUi: "codaryn:app:saveui",
  runEvents: "codaryn:runs:events",
  checkPlan: "codaryn:plan:check",
  openText: "codaryn:workspace:opentext",
  saveText: "codaryn:workspace:savetext",
  textDirty: "codaryn:workspace:textdirty",
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
  startTaskRun: "codaryn:run:starttask",
  cancelRun: "codaryn:run:cancel",
  listRuns: "codaryn:runs:list",
  previewRevert: "codaryn:runs:previewrevert",
  revert: "codaryn:runs:revert",
  revertConsent: "codaryn:runs:revertconsent",
  plan: "codaryn:plan:read",
  applyPlan: "codaryn:plan:apply",
  review: "codaryn:review:record",
  changes: "codaryn:changes:read",
  report: "codaryn:report:read",
  proposeSettings: "codaryn:settings:propose",
  applySettings: "codaryn:settings:apply",
  stateSummary: "codaryn:state:summary",
  previewCleanup: "codaryn:cleanup:preview",
  applyCleanup: "codaryn:cleanup:apply",
  saveReport: "codaryn:report:save",
  createSettings: "codaryn:settings:create",
  settingsSuggestions: "codaryn:settings:suggestions",
} as const;

/**
 * Main → renderer: a workspace was opened from outside the window (the command line of a second
 * start); GU-3: a run's progress items, and its end.
 */
export const IPC_EVENTS = {
  workspaceOpened: "codaryn:event:workspaceopened",
  runEvents: "codaryn:event:runevents",
  runDone: "codaryn:event:rundone",
  engineState: "codaryn:event:enginestate",
  treeReset: "codaryn:event:treereset",
} as const;

/** U-118: `runEvents` arguments: the run, its form, and the page's offset. */
export function parseRunEventsArgs(value: unknown): { readonly workspace: string; readonly runId: string; readonly profile: string | null; readonly workflow: string | null; readonly offset: number } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["workspace", "runId", "profile", "workflow", "offset"])) return null;
  const { offset, ...rest } = value;
  const run = parsePlanArgs(rest);
  return run !== null && typeof offset === "number" && Number.isSafeInteger(offset) && offset >= 0 && offset <= 10_000_000 ? { ...run, offset } : null;
}

export const RUN_EVENTS_STATUSES = ["complete", "incomplete", "damaged"] as const;

/**
 * U-118 (3.7, adapter-contract 5.13): one page of a run's records as the window shows them: the
 * progress list's lines, the page's state, and how many lines were left out and record numbers are
 * missing. `records` is how many records the page had (`items` are the ones with a line).
 */
export type RunEventsReply =
  | {
      readonly ok: true;
      readonly runId: string;
      readonly runKind: "run" | "apply";
      readonly status: (typeof RUN_EVENTS_STATUSES)[number];
      readonly recordsChanged: boolean;
      readonly items: readonly RunItemView[];
      readonly records: number;
      readonly total: number;
      readonly skipped: number;
      readonly missing: number;
      readonly offset: number;
      readonly nextOffset: number | null;
    }
  | { readonly ok: false; readonly code: string };

/** The engine host's page, checked field by field; nothing else is passed on. */
export function toRunEventsReply(value: unknown, items: (value: unknown) => readonly RunItemView[] | null): RunEventsReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const fail = { ok: false, code: "host_error" } as const;
  const { runId, runKind, status, recordsChanged, records, total, skipped, missing, offset, nextOffset } = value;
  const shown = items(value["items"]);
  if (!isRunId(runId) || (runKind !== "run" && runKind !== "apply") || typeof status !== "string" || !(RUN_EVENTS_STATUSES as readonly string[]).includes(status) || typeof recordsChanged !== "boolean") return fail;
  if (shown === null || !count(records) || shown.length > records || !count(total) || !count(skipped) || !count(missing) || !count(offset) || !(nextOffset === null || count(nextOffset))) return fail;
  return { ok: true, runId, runKind, status: status as (typeof RUN_EVENTS_STATUSES)[number], recordsChanged, items: shown, records, total, skipped, missing, offset, nextOffset };
}

export function parsePlanArgs(value: unknown): { readonly workspace: string; readonly runId: string; readonly profile: string | null; readonly workflow: string | null } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["workspace", "runId", "profile", "workflow"])) return null;
  const { workspace, runId } = value;
  const profile = value["profile"] ?? null;
  const workflow = value["workflow"] ?? null;
  if (!isHandle(workspace) || !isRunId(runId) || !nameOrNull(profile) || !nameOrNull(workflow)) return null;
  return { workspace, runId, profile, workflow };
}

/**
 * GU-5: `applyPlan` arguments: the approval token of a plan view, and whether the person asks to be
 * asked for the DR-21 consent. The window cannot give a consent or a digest: the main process asks
 * the person in its own dialog and makes the consent from that answer only (6.6).
 */
export function parseApplyArgs(value: unknown): { readonly approval: string; readonly askConsent: boolean } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["approval", "askConsent"])) return null;
  const { approval, askConsent } = value;
  return isHandle(approval) && typeof askConsent === "boolean" ? { approval, askConsent } : null;
}

/** GU-5: `review` arguments. A note is at most 500 characters (MAX_REVIEW_NOTE_CHARS); the CLI checks it for keys (S-8). */
export function parseReviewArgs(value: unknown): { readonly workspace: string; readonly runId: string; readonly profile: string | null; readonly workflow: string | null; readonly decision: "accept" | "reject"; readonly note: string | null } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["workspace", "runId", "profile", "workflow", "decision", "note"])) return null;
  const { workspace, runId, decision } = value;
  const profile = value["profile"] ?? null;
  const workflow = value["workflow"] ?? null;
  const note = value["note"] ?? null;
  if (!isHandle(workspace) || !isRunId(runId) || (decision !== "accept" && decision !== "reject")) return null;
  if (!nameOrNull(profile) || !nameOrNull(workflow)) return null;
  if (note !== null && (typeof note !== "string" || note.length > 500 || note.includes("\u0000"))) return null;
  return { workspace, runId, profile, workflow, decision, note: note as string | null };
}

/** U-32: the most rows of a plan's summary: the CLI's FINAL_MESSAGE_MAX_LINES (20) and its "… (+N)" row. */
export const MAX_PLAN_SUMMARY_ROWS = 21;

/** GU-5 (3.9): a plan as the window shows it. `approval` is the token its apply takes (null once applied). */
/** U-206 (U-196, DR-69 B-3): one file of a run plan: its masked path, and whether the later run makes or changes it. */
export interface PlannedFileView {
  readonly path: string;
  readonly change: "create" | "modify";
}

export interface PlanView {
  /**
   * U-206: present for a run plan (the app layer's ChangesPlanOutput): then `files` are what a later
   * run will make or change, `actions` is empty and `inventoryLimitReached` false. Absent: a plan of
   * moves and discards, as before.
   */
  readonly planKind?: "changes";
  readonly files?: readonly PlannedFileView[];
  readonly runId: string;
  readonly status: "pending" | "applied";
  readonly digest: string;
  readonly actions: readonly PlanActionView[];
  readonly inventoryLimitReached: boolean;
  readonly appliedBy: { readonly runId: string; readonly at: string } | null;
  /** U-32 (UXM-14, U-14 AXM-2): the plan run has a records-changed mark (PlanOutput.recordsChanged); absent: none. */
  readonly recordsChanged?: true;
  /**
   * U-32 (U-14 AXM-15): the summary the model wrote for this plan, the agent's words and not what is
   * approved, as rows (the app layer's modelTextRows, engine-host/model-text.ts). Absent when there is none, and
   * for a marked plan run.
   */
  readonly summary?: readonly string[];
}

/** U-32: whether the main process gives a plan view an approval token: a pending plan without a records-changed mark. */
export function planApprovable(view: PlanView): boolean {
  // U-14 (AXM-2), DR-38: the engine refuses a marked plan run (plan_records_changed), so nothing is asked.
  return view.status === "pending" && view.recordsChanged !== true;
}

/** A plan's summary rows as the engine host gives them: null when there are none, "bad" when they do not fit. */
function toSummaryRows(value: unknown): readonly string[] | null | "bad" {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PLAN_SUMMARY_ROWS) return "bad";
  for (const row of value) {
    if (!shortText(row) || row.length === 0 || row.includes("\n") || row.includes("\t") || UNSAFE_IN_MESSAGE.test(row)) return "bad";
  }
  return value as readonly string[];
}

export type PlanReply = { readonly ok: true; readonly view: PlanView; readonly approval: string | null } | { readonly ok: false; readonly code: string };

/** The engine host's plan value, checked field by field. */
export function toPlanView(value: unknown): { readonly ok: true; readonly view: PlanView } | { readonly ok: false; readonly code: string } {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const fail = { ok: false, code: "host_error" } as const;
  const { runId, status, digest, inventoryLimitReached, appliedBy } = value;
  const actions = toPlanActions(value["actions"], 10_000);
  if (!isRunId(runId) || (status !== "pending" && status !== "applied") || typeof digest !== "string" || !DIGEST.test(digest) || actions === null || typeof inventoryLimitReached !== "boolean") return fail;
  let applied: PlanView["appliedBy"] = null;
  if (appliedBy !== null) {
    if (!isObj(appliedBy) || !isRunId(appliedBy["runId"]) || typeof appliedBy["at"] !== "string" || !TIME.test(appliedBy["at"])) return fail;
    applied = { runId: appliedBy["runId"], at: appliedBy["at"] };
  }
  // U-32: the records-changed mark, and the summary rows; a marked plan run's summary is never passed on.
  const recordsChanged = value["recordsChanged"] ?? false;
  const summary = toSummaryRows(value["summary"]);
  if (typeof recordsChanged !== "boolean" || summary === "bad") return fail;
  // U-206: a run plan's files, each a short masked path and create or modify; no actions then.
  const planKind = value["planKind"];
  let files: PlannedFileView[] | null = null;
  if (planKind !== undefined) {
    const given = value["files"];
    if (planKind !== "changes" || !Array.isArray(given) || given.length > 10_000 || actions.length > 0 || inventoryLimitReached) return fail;
    files = [];
    for (const file of given) {
      if (!isObj(file) || !shortText(file["path"]) || file["path"].length === 0 || UNSAFE_IN_MESSAGE.test(file["path"]) || (file["change"] !== "create" && file["change"] !== "modify")) return fail;
      files.push({ path: file["path"], change: file["change"] });
    }
  } else if (value["files"] !== undefined) return fail;
  return {
    ok: true,
    view: {
      ...(files === null ? {} : { planKind: "changes" as const, files }),
      runId,
      status,
      digest,
      actions,
      inventoryLimitReached,
      appliedBy: applied,
      ...(recordsChanged ? { recordsChanged: true as const } : {}),
      ...(summary === null || recordsChanged ? {} : { summary }),
    },
  };
}

export const CHANGE_STATES = ["as_run_left", "changed_since_run", "missing", "unknown"] as const;

/**
 * DR-29, DR-32 (c) (3.4): one changed file as the window shows it: its masked path and state, and
 * its masked texts only when the app layer found them masked now as the run masked them (else null,
 * with `masking_unverified`).
 */
export interface ChangedFileItem {
  readonly path: string;
  readonly created: boolean;
  readonly state: (typeof CHANGE_STATES)[number];
  readonly unavailable: string | null;
  readonly before: string | null;
  readonly after: string | null;
  /**
   * U-66 (3.4): the main process's id for "show in folder" (the tree's ids), or null: given only for a
   * plain path that is there (not missing, not masked, outside the state directory). Not from the host.
   */
  readonly id?: string | null;
}

/**
 * U-66: whether the main process gives a changed file an id for "show in folder": its path is plain
 * (copyablePath), outside the state directory, and the file is not missing or behind a masked path.
 */
export function revealableChange(file: ChangedFileItem): boolean {
  if (file.state === "missing" || file.unavailable === "masked_path" || copyablePath(file.path) === null) return false;
  return (file.path.split("/")[0] ?? "").toLowerCase() !== ".codaryn";
}

/** U-48 (U-43, DR-38): `recordsChanged`, the run has a records-changed mark (its files then have no text). */
export type ChangesReply =
  | { readonly ok: true; readonly runId: string; readonly recordsChanged: boolean; readonly files: readonly ChangedFileItem[] }
  | { readonly ok: false; readonly code: string };

/** The longest file text one side may have (MAX_READ_BYTES of the app layer is 262,144 bytes), and all of them together. */
export const MAX_CHANGE_TEXT_CHARS = 300_000;
export const MAX_CHANGES_TOTAL_CHARS = 3_000_000;

/** The engine host's changes value, checked field by field; no other field is taken. */
export function toChangesReply(value: unknown): ChangesReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const fail = { ok: false, code: "host_error" } as const;
  const { runId, masking, files } = value;
  if (!isRunId(runId) || masking !== "current_secrets" || !Array.isArray(files) || files.length > 10_000) return fail;
  const recordsChanged = value["recordsChanged"] ?? false;
  if (typeof recordsChanged !== "boolean") return fail;
  const items: ChangedFileItem[] = [];
  let total = 0;
  const text = (v: unknown): v is string | null => v === null || (typeof v === "string" && v.length <= MAX_CHANGE_TEXT_CHARS);
  for (const file of files) {
    if (!isObj(file) || !hasOnlyKeys(file, ["path", "created", "state", "unavailable", "before", "after"])) return fail;
    const { path, created, state, unavailable } = file;
    const before = file["before"] ?? null;
    const after = file["after"] ?? null;
    if (!shortText(path) || typeof created !== "boolean" || typeof state !== "string" || !(CHANGE_STATES as readonly string[]).includes(state)) return fail;
    if (!(unavailable === null || (typeof unavailable === "string" && WORD.test(unavailable))) || !text(before) || !text(after)) return fail;
    total += (before?.length ?? 0) + (after?.length ?? 0);
    if (total > MAX_CHANGES_TOTAL_CHARS) return fail;
    items.push({ path, created, state: state as ChangedFileItem["state"], unavailable: unavailable as string | null, before, after });
  }
  return { ok: true, runId, recordsChanged, files: items };
}

/** GU-3 (3.7): one check of a run's last round, by number (N-24 (a)). */
export interface ReportVerifierView {
  readonly number: number;
  readonly kind: string | null;
  readonly outcome: string;
  readonly evidence: string;
  readonly evidenceCut: boolean;
  readonly checked: readonly string[];
  readonly limits: readonly string[];
}

/** GU-3 (3.7): a run's report as the window shows it. Texts are masked and cleaned. */
export interface ReportView {
  readonly runId: string;
  /** UXM-14, DR-38: the run has a records-changed mark; its records are not to be trusted. */
  readonly recordsChanged?: boolean;
  /** U-21 (DR-47): the agent's last message from the run's result; null when there is none. */
  readonly finalMessage?: FinalMessageView | null;
  /** U-40 (DR-52): the masking counts from the run's result; null when there are none or they are not counts. */
  readonly masking?: MaskingView | null;
  /** U-79 (3.7): a run waiting for its review: the workflow's checklist from its result; null otherwise. */
  readonly review?: { readonly checklist: readonly string[] } | null;
  readonly kind: "run" | "apply";
  readonly status: "complete" | "incomplete";
  readonly finished: { readonly status: string; readonly reason: string } | null;
  readonly usage: RunResultView["usage"] | null;
  readonly verifiers: readonly ReportVerifierView[];
  readonly integrity: readonly { readonly phase: string; readonly changed: readonly string[] }[];
  readonly records: number | null;
  readonly taskId: string;
  readonly run: {
    readonly workflow: string;
    readonly provider: string | null;
    readonly modelRequests: number | null;
    readonly deniedToolCalls: number | null;
    readonly repairs: number | null;
    readonly changes: readonly { readonly path: string; readonly created: boolean }[];
    readonly verdict: { readonly verdict: "accepted" | "rejected"; readonly at: string; readonly note: string | null } | null;
  } | null;
  readonly apply: {
    readonly planRunId: string | null;
    readonly digest: string | null;
    readonly approval: string | null;
    readonly unsafeMoveConsent: string | null;
    readonly actions: number | null;
    readonly unsafeMoves: number | null;
    readonly inventoryLimitReached: boolean;
    readonly moved: readonly { readonly from: string; readonly to: string; readonly unsafe: boolean }[];
    readonly discarded: readonly { readonly path: string }[];
    readonly failed: readonly { readonly number: number; readonly problem: string }[];
  } | null;
}

import { cleanupPlanOf, cleanupResultOf, isCleanupTimestamp, parseCleanupSelection, stateSummaryOf } from "./cleanup.js";
import type { CleanupPlanView, CleanupResultView, CleanupSelectionArg, StateSummaryView } from "./cleanup.js";

/** `labels`: the shared catalog's words for the finished status and reason, added by the main process. */
export type ReportReply =
  | { readonly ok: true; readonly view: ReportView; readonly labels?: { readonly status: string; readonly reason: string } | null }
  | { readonly ok: false; readonly code: string };

const wordOrNull = (value: unknown): value is string | null => value === null || (typeof value === "string" && WORD.test(value));
const MAX_EVIDENCE = 5000;

/** The engine host's report value, checked field by field. */
export function toReportReply(value: unknown): ReportReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const fail = { ok: false, code: "host_error" } as const;
  const { runId, kind, status, finished, usage, verifiers, integrity, records, taskId } = value;
  const recordsChanged = value["recordsChanged"] ?? false;
  if (typeof recordsChanged !== "boolean") return fail;
  const finalMessage = toFinalMessage(value["finalMessage"]);
  if (finalMessage === "bad") return fail;
  if (!isRunId(runId) || (kind !== "run" && kind !== "apply") || (status !== "complete" && status !== "incomplete") || !shortText(taskId) || !numOrNull(records)) return fail;
  let finishedView: ReportView["finished"] = null;
  if (finished !== null) {
    if (!isObj(finished) || typeof finished["status"] !== "string" || !WORD.test(finished["status"]) || typeof finished["reason"] !== "string" || !WORD.test(finished["reason"])) return fail;
    finishedView = { status: finished["status"], reason: finished["reason"] };
  }
  let usageView: ReportView["usage"] = null;
  if (usage !== null) {
    if (!isObj(usage)) return fail;
    const { turns, tools, inputTokens, outputTokens, durationMs } = usage;
    if (![turns, tools, inputTokens, outputTokens, durationMs].every(numOrNull)) return fail;
    usageView = { turns: turns as number | null, tools: tools as number | null, inputTokens: inputTokens as number | null, outputTokens: outputTokens as number | null, durationMs: durationMs as number | null };
  }
  if (!Array.isArray(verifiers) || verifiers.length > MAX_ITEMS || !Array.isArray(integrity) || integrity.length > MAX_ITEMS) return fail;
  const verifierViews: ReportVerifierView[] = [];
  for (const verifier of verifiers) {
    if (!isObj(verifier) || !count(verifier["number"]) || !wordOrNull(verifier["kind"]) || typeof verifier["outcome"] !== "string" || !WORD.test(verifier["outcome"])) return fail;
    if (typeof verifier["evidence"] !== "string" || verifier["evidence"].length > MAX_EVIDENCE || typeof verifier["evidenceCut"] !== "boolean" || !textList(verifier["checked"]) || !textList(verifier["limits"])) return fail;
    verifierViews.push({ number: verifier["number"], kind: verifier["kind"] as string | null, outcome: verifier["outcome"], evidence: verifier["evidence"], evidenceCut: verifier["evidenceCut"], checked: verifier["checked"], limits: verifier["limits"] });
  }
  const integrityViews: { phase: string; changed: string[] }[] = [];
  for (const check of integrity) {
    if (!isObj(check) || typeof check["phase"] !== "string" || !WORD.test(check["phase"]) || !textList(check["changed"])) return fail;
    integrityViews.push({ phase: check["phase"], changed: check["changed"] });
  }
  let run: ReportView["run"] = null;
  let apply: ReportView["apply"] = null;
  if (kind === "run") {
    const r = value["run"];
    if (!isObj(r) || !shortText(r["workflow"]) || !wordOrNull(r["provider"]) || ![r["modelRequests"], r["deniedToolCalls"], r["repairs"]].every(numOrNull) || !Array.isArray(r["changes"]) || r["changes"].length > MAX_ITEMS) return fail;
    const changes: { path: string; created: boolean }[] = [];
    for (const change of r["changes"]) {
      if (!isObj(change) || !shortText(change["path"]) || typeof change["created"] !== "boolean") return fail;
      changes.push({ path: change["path"], created: change["created"] });
    }
    let verdict: NonNullable<ReportView["run"]>["verdict"] = null;
    const given = r["verdict"];
    if (given !== null) {
      if (!isObj(given) || (given["verdict"] !== "accepted" && given["verdict"] !== "rejected") || typeof given["at"] !== "string" || !TIME.test(given["at"]) || !(given["note"] === null || shortText(given["note"]))) return fail;
      verdict = { verdict: given["verdict"], at: given["at"], note: given["note"] as string | null };
    }
    run = { workflow: r["workflow"], provider: r["provider"] as string | null, modelRequests: r["modelRequests"] as number | null, deniedToolCalls: r["deniedToolCalls"] as number | null, repairs: r["repairs"] as number | null, changes, verdict };
  } else {
    const a = value["apply"];
    if (!isObj(a) || !(a["planRunId"] === null || isRunId(a["planRunId"])) || !(a["digest"] === null || (typeof a["digest"] === "string" && DIGEST.test(a["digest"])))) return fail;
    if (!wordOrNull(a["approval"]) || !wordOrNull(a["unsafeMoveConsent"]) || !numOrNull(a["actions"]) || !numOrNull(a["unsafeMoves"]) || typeof a["inventoryLimitReached"] !== "boolean") return fail;
    if (!Array.isArray(a["moved"]) || a["moved"].length > MAX_ITEMS || !Array.isArray(a["discarded"]) || a["discarded"].length > MAX_ITEMS || !Array.isArray(a["failed"]) || a["failed"].length > MAX_ITEMS) return fail;
    const moved: { from: string; to: string; unsafe: boolean }[] = [];
    for (const item of a["moved"]) {
      if (!isObj(item) || !shortText(item["from"]) || !shortText(item["to"]) || typeof item["unsafe"] !== "boolean") return fail;
      moved.push({ from: item["from"], to: item["to"], unsafe: item["unsafe"] });
    }
    const discarded: { path: string }[] = [];
    for (const item of a["discarded"]) {
      if (!isObj(item) || !shortText(item["path"])) return fail;
      discarded.push({ path: item["path"] });
    }
    const failed: { number: number; problem: string }[] = [];
    for (const item of a["failed"]) {
      if (!isObj(item) || !count(item["number"]) || typeof item["problem"] !== "string" || !WORD.test(item["problem"])) return fail;
      failed.push({ number: item["number"], problem: item["problem"] });
    }
    apply = {
      planRunId: a["planRunId"] as string | null,
      digest: a["digest"] as string | null,
      approval: a["approval"] as string | null,
      unsafeMoveConsent: a["unsafeMoveConsent"] as string | null,
      actions: a["actions"] as number | null,
      unsafeMoves: a["unsafeMoves"] as number | null,
      inventoryLimitReached: a["inventoryLimitReached"],
      moved,
      discarded,
      failed,
    };
  }
  const masking = maskingOf(value["masking"]);
  const given = value["review"] ?? null;
  if (!(given === null || (isObj(given) && hasOnlyKeys(given, ["checklist"]) && textList(given["checklist"])))) return fail;
  const review = given === null ? null : { checklist: given["checklist"] as string[] };
  return { ok: true, view: { runId, kind, status, recordsChanged, finalMessage, masking, review, finished: finishedView, usage: usageView, verifiers: verifierViews, integrity: integrityViews, records: records as number | null, taskId, run, apply } };
}

export type ReviewReply = { readonly ok: true; readonly verdict: "accepted" | "rejected"; readonly replaced: boolean } | { readonly ok: false; readonly code: string };

/** The engine host's review value, checked. */
export function toReviewReply(value: unknown): ReviewReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const { verdict, replaced } = value;
  if ((verdict !== "accepted" && verdict !== "rejected") || typeof replaced !== "boolean") return { ok: false, code: "host_error" };
  return { ok: true, verdict, replaced };
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
export const REVERT_ACTIONS = ["restored", "deleted", "moved_back", "restored_from_discard"] as const;

/**
 * U-61 (U-16, R-55): what became of a plan run's apply, by the contract's one rule
 * (planApplyStateOf in src/contracts/commands.ts, PLAN_APPLY_STATES there; a unit test compares).
 */
export const PLAN_APPLY_STATES = ["applied", "unfinished", "applying", "reverted", "record_missing"] as const;
export interface PlanApplyView {
  readonly state: (typeof PLAN_APPLY_STATES)[number];
  readonly applyRunId: string;
  /** The apply run's reason, for "unfinished"; null otherwise or when it has none. */
  readonly reason: string | null;
  /** U-226 (U-221): a run plan carried out by a run (not an apply run); the CLI's carried words. */
  readonly carried?: true;
}

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
      /** UXM-14, DR-38: the run has a records-changed mark; its records are not to be trusted. */
      readonly recordsChanged?: boolean;
      /** U-61 (U-16): for a plan run an apply claimed, what became of that apply; null otherwise. */
      readonly planApply?: PlanApplyView | null;
      /** U-271 (C-27, U-155): a run without a result: still going, or stopped without one; null otherwise or unknown. */
      readonly phase?: "running" | "no_result" | null;
      /**
       * U-244 (the CLI's runs.apply_of, runs.carried_plan): the plan run this run applied (an apply run) or
       * carried out (a run that carried out a changes plan); null or absent for any other run.
       */
      readonly planRunId?: string | null;
      /**
       * R21b-L-1: the task form the run was started with, when this app started it (the main process
       * remembers it). Null: unknown (started elsewhere), so a plan of it is shown but not applied here.
       */
      readonly form?: RunFormView | null;
    }
  | { readonly state: "damaged"; readonly runId: string };

export type RunsReply = { readonly ok: true; readonly runs: readonly RunListItem[]; readonly omitted: number } | { readonly ok: false; readonly code: string };

const revertedMark = (value: unknown): { at: string; status: "complete" | "partial" } | null | undefined => {
  if (value === null) return null;
  if (!isObj(value) || typeof value["at"] !== "string" || !TIME.test(value["at"]) || (value["status"] !== "complete" && value["status"] !== "partial")) return undefined;
  return { at: value["at"], status: value["status"] };
};

/** U-61: a row's plan apply state as the engine host gives it: null when absent, "bad" when it does not fit. */
function planApplyOf(value: unknown): PlanApplyView | null | "bad" {
  if (value === undefined || value === null) return null;
  if (!isObj(value) || !hasOnlyKeys(value, ["state", "applyRunId", "reason", "carried"])) return "bad";
  const { state, applyRunId, reason, carried } = value;
  if (typeof state !== "string" || !(PLAN_APPLY_STATES as readonly string[]).includes(state) || !isRunId(applyRunId) || !(reason === null || (typeof reason === "string" && WORD.test(reason)))) return "bad";
  if (carried !== undefined && carried !== true) return "bad";
  return { state: state as PlanApplyView["state"], applyRunId, reason, ...(carried === true ? { carried } : {}) };
}

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
    const recordsChanged = run["recordsChanged"] ?? false;
    if (typeof recordsChanged !== "boolean") return fail;
    const reverted = revertedMark(run["reverted"]);
    if (run["state"] !== "checked" || (kind !== "run" && kind !== "apply") || !(startedAt === null || (typeof startedAt === "string" && TIME.test(startedAt)))) return fail;
    if (!shortText(taskId) || !(status === null || (typeof status === "string" && WORD.test(status))) || !(reason === null || (typeof reason === "string" && WORD.test(reason)))) return fail;
    if (!(changes === null || count(changes)) || reverted === undefined || typeof revertRecordDamaged !== "boolean") return fail;
    const planApply = planApplyOf(run["planApply"]);
    if (planApply === "bad") return fail;
    const planRunId = run["planRunId"] ?? null;
    if (!(planRunId === null || isRunId(planRunId)) || planRunId === run["runId"]) return fail;
    const phase = run["phase"] ?? null;
    if (!(phase === null || ((phase === "running" || phase === "no_result") && status === null))) return fail;
    items.push({ state: "checked", runId: run["runId"], kind, startedAt: startedAt as string | null, taskId, status: status as string | null, reason: reason as string | null, changes: changes as number | null, reverted, revertRecordDamaged, recordsChanged, planApply, planRunId, phase });
  }
  return { ok: true, runs: items, omitted };
}

/** GU-4 (3.8): a revert or its preview. */
export interface RevertView {
  readonly runId: string;
  readonly status: "complete" | "partial";
  readonly dryRun: boolean;
  readonly reverted: readonly { readonly path: string; readonly action: (typeof REVERT_ACTIONS)[number]; readonly from: string | null; readonly unsafe: boolean }[];
  /** U-318 (R-119 L-1): `path` null for a missing_record skip, whose path comes unmasked (the window shows "?"). */
  readonly skipped: readonly { readonly path: string | null; readonly reason: string }[];
  readonly moveSafetyUnchecked: boolean;
  readonly revertedBefore: { readonly at: string; readonly status: "complete" | "partial" } | null;
  /** U-32 (UXM-14, DR-38): the run has a records-changed mark; the revert still checks every file. Absent: none. */
  readonly recordsChanged?: true;
  /** U-271 (U-229): the revert could not release the workspace lock at its end. Absent: released. */
  readonly lockLeft?: true;
}

/**
 * A preview carries the token its revert takes; a revert does not. DR-25: a revert that skipped
 * files as `unsafe_move` carries `consentRetry`, the token to revert once more with the person's
 * consent (asked by the main process).
 */
export type RevertReply =
  | { readonly ok: true; readonly view: RevertView; readonly preview: string | null; readonly consentRetry: string | null }
  | { readonly ok: false; readonly code: string };

/** DR-25: `revertConsent` arguments: `{retry}`, a token a revert's result gave. */
export function parseRetryArgs(value: unknown): { readonly retry: string } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["retry"])) return null;
  return isHandle(value["retry"]) ? { retry: value["retry"] } : null;
}

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
    if (!isObj(file) || typeof file["reason"] !== "string" || !WORD.test(file["reason"])) return fail;
    // U-318 (R-119 L-1): no missing_record path is kept, even one that came; every other skip has its path.
    const hidden = file["reason"] === "missing_record";
    if (hidden ? !(file["path"] === null || shortText(file["path"])) : !shortText(file["path"])) return fail;
    skips.push({ path: hidden ? null : (file["path"] as string), reason: file["reason"] });
  }
  const recordsChanged = value["recordsChanged"] ?? false;
  if (typeof recordsChanged !== "boolean") return fail;
  const lockLeft = value["lockLeft"];
  if (lockLeft !== undefined && lockLeft !== true) return fail;
  return {
    ok: true,
    view: { runId, status, dryRun, reverted: files, skipped: skips, moveSafetyUnchecked, revertedBefore: before, ...(recordsChanged ? { recordsChanged: true as const } : {}), ...(lockLeft === true ? { lockLeft } : {}) },
  };
}

/** The engine host's answer to `selectModel`, checked. */
export function toSelectModelReply(value: unknown): SelectModelReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const selected = value["selected"];
  if (!isObj(selected) || !shortText(selected["id"]) || typeof selected["created"] !== "boolean" || typeof selected["overridden"] !== "boolean") return { ok: false, code: "host_error" };
  return { ok: true, selected: { id: selected["id"], created: selected["created"], overridden: selected["overridden"] } };
}

/** GU-4 (3.8), DR-39: the state summary as the window gets it. */
export type StateSummaryReply = { readonly ok: true; readonly summary: StateSummaryView } | { readonly ok: false; readonly code: string };

/** DR-39, DR-44: a cleanup preview: a token for the plan the main process keeps, and the plan to show. */
export type CleanupPreviewReply = { readonly ok: true; readonly token: string; readonly plan: CleanupPlanView } | { readonly ok: false; readonly code: string };

export type CleanupResultReply = { readonly ok: true; readonly result: CleanupResultView } | { readonly ok: false; readonly code: string };

/** The engine host's summary value, checked. */
export function toStateSummaryReply(value: unknown): StateSummaryReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const summary = stateSummaryOf(value["summary"]);
  return summary === null ? { ok: false, code: "host_error" } : { ok: true, summary };
}

/** The engine host's preview value, checked: the plan and the moment it was counted from (kept by the main process). */
export function toHostCleanupPreview(value: unknown): { readonly ok: true; readonly now: string; readonly plan: CleanupPlanView } | { readonly ok: false; readonly code: string } {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const plan = cleanupPlanOf(value["plan"]);
  return plan === null || !isCleanupTimestamp(value["now"]) ? { ok: false, code: "host_error" } : { ok: true, now: value["now"], plan };
}

/** The engine host's cleanup value, checked. */
export function toCleanupResultReply(value: unknown): CleanupResultReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const result = cleanupResultOf(value["result"]);
  return result === null ? { ok: false, code: "host_error" } : { ok: true, result };
}

/** GU-4: `previewCleanup` arguments: `{workspace, selection}`. */
export function parseCleanupPreviewArgs(value: unknown): { readonly workspace: string; readonly selection: CleanupSelectionArg } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["workspace", "selection"]) || !isHandle(value["workspace"])) return null;
  const selection = parseCleanupSelection(value["selection"]);
  return selection === null ? null : { workspace: value["workspace"], selection };
}

/** GU-3 (3.7): a saved report: the name of the file the person chose (never its folder), or why not (not_saved, ...). */
export type SaveReportReply = { readonly ok: true; readonly name: string } | { readonly ok: false; readonly code: string };

/** The engine host's Markdown value, checked. */
export function toHostReportMarkdown(value: unknown): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly code: string } {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  return typeof value["text"] === "string" && value["text"].length <= 5_000_000 ? { ok: true, text: value["text"] } : { ok: false, code: "host_error" };
}

/** U-11 (3.11): the config file made with the defaults; `config_exists` when one is there (it is used as it is). */
export type CreateSettingsReply =
  | { readonly ok: true; readonly created: boolean; readonly model: "selected" | "placeholder"; readonly keySet: boolean; readonly overridden: boolean }
  | { readonly ok: false; readonly code: string };

/** U-11 (3.11): init's fixed suggestions for the open workspace; a command's arguments are fixed. */
export interface SuggestedCommandView {
  readonly shown: string;
  readonly rule: { readonly executable: string; readonly argsPrefix: readonly string[]; readonly allowExtraArgs: boolean };
}
export type SuggestionsReply = { readonly ok: true; readonly commands: readonly SuggestedCommandView[]; readonly protectedPaths: readonly string[] } | { readonly ok: false; readonly code: string };

/** The engine host's createSettings value, checked. */
export function toCreateSettingsReply(value: unknown): CreateSettingsReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const { created, model, keySet, overridden } = value;
  if (typeof created !== "boolean" || (model !== "selected" && model !== "placeholder") || typeof keySet !== "boolean" || typeof overridden !== "boolean") return { ok: false, code: "host_error" };
  return { ok: true, created, model, keySet, overridden };
}

/** The engine host's suggestions value, checked. */
export function toSuggestionsReply(value: unknown): SuggestionsReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const commands = value["commands"];
  const paths = value["protectedPaths"];
  if (!Array.isArray(commands) || commands.length > 32 || !textList(paths) || paths.length > 32) return { ok: false, code: "host_error" };
  const out: SuggestedCommandView[] = [];
  for (const item of commands) {
    if (!isObj(item) || !shortText(item["shown"]) || !isObj(item["rule"])) return { ok: false, code: "host_error" };
    const { executable, argsPrefix, allowExtraArgs } = item["rule"];
    if (!shortText(executable) || !textList(argsPrefix) || argsPrefix.length > 20 || typeof allowExtraArgs !== "boolean") return { ok: false, code: "host_error" };
    out.push({ shown: item["shown"], rule: { executable, argsPrefix, allowExtraArgs } });
  }
  return { ok: true, commands: out, protectedPaths: paths };
}

/** U-11: `createSettings` arguments: `{workspace}`, a workspace handle or null. */
export function parseCreateSettingsArgs(value: unknown): { readonly workspace: string | null } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["workspace"])) return null;
  const workspace = value["workspace"] ?? null;
  return workspace === null || isHandle(workspace) ? { workspace } : null;
}
