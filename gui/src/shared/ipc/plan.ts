/** Run-event pages, plan, changes and review IPC checks. Public callers use ../ipc.js. */
import { count, hasOnlyKeys, isHandle, isObj, isRunId, shortText, hostCodeOf, nameOrNull, DIGEST, TIME, UNSAFE_IN_MESSAGE, WORD } from "./primitives.js";
import { copyablePath, toPlanActions } from "./core.js";
import type { RunItemView, PlanActionView } from "./core.js";

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

export type ReviewReply = { readonly ok: true; readonly verdict: "accepted" | "rejected"; readonly replaced: boolean } | { readonly ok: false; readonly code: string };

/** The engine host's review value, checked. */
export function toReviewReply(value: unknown): ReviewReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const { verdict, replaced } = value;
  if ((verdict !== "accepted" && verdict !== "rejected") || typeof replaced !== "boolean") return { ok: false, code: "host_error" };
  return { ok: true, verdict, replaced };
}
