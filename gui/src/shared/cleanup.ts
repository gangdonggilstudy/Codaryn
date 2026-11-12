/**
 * GU-4 (docs/design/standalone-gui.md 3.8), DR-39, DR-44: seeing and cleaning up a workspace's run
 * records and discarded-files folders, as the window sees it. Pure (no Node, Electron or DOM), so
 * the main process and the engine host check the same shapes.
 * - The window sends a selection only (which runs, how old); the main process keeps the plan the
 *   preview made and gives the window a token. Cleaning takes the token only.
 * - Nothing here carries a file name of a person's: run ids, the 16 hex digits of a leftover
 *   folder, counts, sizes and codes.
 */

/** What to remove (the contract's CleanupSelection). */
export interface CleanupSelectionArg {
  readonly runs?: { readonly olderThanDays?: number; readonly runIds?: readonly string[]; readonly reverted?: true };
  readonly discarded?: { readonly olderThanDays?: number; readonly runIds?: readonly string[] };
}

export const MAX_SELECTED_RUNS = 500;
export const MAX_CLEANUP_DAYS = 36_500;
const RUN_ID = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/;
const LEFTOVER_ID = /^[0-9a-f]{16}$/;
/** RUN_TIMESTAMP_PATTERN_SOURCE of the contract. */
const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$/;
const DIGEST = /^[0-9a-f]{64}$/;
const CODE = /^[a-z][a-z_]{0,39}$/;
const MAX_ITEMS = 10_000;

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const only = (value: Obj, keys: readonly string[]): boolean => Object.keys(value).every((key) => keys.includes(key));
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const days = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_CLEANUP_DAYS;

function runIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_SELECTED_RUNS || !value.every((id) => typeof id === "string" && RUN_ID.test(id))) return null;
  return [...new Set(value as string[])];
}

/** The selection the window sent, checked field by field; null when it does not fit. */
export function parseCleanupSelection(value: unknown): CleanupSelectionArg | null {
  if (!isObj(value) || !only(value, ["runs", "discarded"])) return null;
  const out: { runs?: CleanupSelectionArg["runs"]; discarded?: CleanupSelectionArg["discarded"] } = {};
  const runs = value["runs"];
  if (runs !== undefined) {
    if (!isObj(runs) || !only(runs, ["olderThanDays", "runIds", "reverted"])) return null;
    const part: { olderThanDays?: number; runIds?: string[]; reverted?: true } = {};
    if (runs["olderThanDays"] !== undefined) {
      if (!days(runs["olderThanDays"])) return null;
      part.olderThanDays = runs["olderThanDays"];
    }
    if (runs["runIds"] !== undefined) {
      const ids = runIds(runs["runIds"]);
      if (ids === null) return null;
      part.runIds = ids;
    }
    if (runs["reverted"] !== undefined) {
      if (runs["reverted"] !== true) return null;
      part.reverted = true;
    }
    out.runs = part;
  }
  const discarded = value["discarded"];
  if (discarded !== undefined) {
    if (!isObj(discarded) || !only(discarded, ["olderThanDays", "runIds"])) return null;
    const part: { olderThanDays?: number; runIds?: string[] } = {};
    if (discarded["olderThanDays"] !== undefined) {
      if (!days(discarded["olderThanDays"])) return null;
      part.olderThanDays = discarded["olderThanDays"];
    }
    if (discarded["runIds"] !== undefined) {
      const ids = runIds(discarded["runIds"]);
      if (ids === null) return null;
      part.runIds = ids;
    }
    out.discarded = part;
  }
  return out;
}

export interface SizeView {
  readonly files: number;
  readonly bytes: number;
}

/** One run as the state summary shows it (the store's StateRunSummary, its known fields only). */
export interface StateEntryView {
  readonly runId: string;
  readonly kind: "run" | "apply" | null;
  readonly status: string | null;
  readonly startedAt: string | null;
  readonly records: SizeView;
  /** DR-44 (b): its last revert was complete. */
  readonly reverted: boolean;
  /** DR-44 (b): its last revert was partial. */
  readonly partlyReverted: boolean;
  readonly discarded: SizeView | null;
  readonly recordsChanged: boolean;
}

export interface StateSummaryView {
  readonly runs: { readonly count: number; readonly bytes: number; readonly oldest: string | null; readonly newest: string | null };
  readonly entries: readonly StateEntryView[];
  readonly discarded: { readonly runs: number; readonly files: number; readonly bytes: number };
  /** Files a revert could not put back: never cleaned. */
  readonly parked: SizeView;
  /** DR-44 (d): folders an earlier cleanup could not remove entirely. */
  readonly leftovers: { readonly count: number; readonly files: number; readonly bytes: number };
}

function sizeOf(value: unknown): SizeView | null {
  return isObj(value) && count(value["files"]) && count(value["bytes"]) ? { files: value["files"], bytes: value["bytes"] } : null;
}

const timeOrNull = (value: unknown): value is string | null => value === null || (typeof value === "string" && TIMESTAMP.test(value));

/**
 * A state summary (the store's StateSummary, or the engine host's copy of it), its known fields
 * only; null when a field does not fit. Used by the engine host on the app layer's output and by
 * the main process on the host's value.
 */
export function stateSummaryOf(value: unknown): StateSummaryView | null {
  if (!isObj(value) || !isObj(value["runs"]) || !Array.isArray(value["entries"]) || value["entries"].length > MAX_ITEMS || !isObj(value["discarded"])) return null;
  const runs = value["runs"];
  if (!count(runs["count"]) || !count(runs["bytes"]) || !timeOrNull(runs["oldest"] ?? null) || !timeOrNull(runs["newest"] ?? null)) return null;
  const entries: StateEntryView[] = [];
  for (const entry of value["entries"]) {
    if (!isObj(entry) || typeof entry["runId"] !== "string" || !RUN_ID.test(entry["runId"])) return null;
    const kind = entry["kind"];
    const status = entry["status"];
    const records = sizeOf(entry["records"]);
    const discarded = entry["discarded"] === null ? null : sizeOf(entry["discarded"]);
    if (!(kind === "run" || kind === "apply" || kind === null) || !(status === null || (typeof status === "string" && /^[a-z][a-z-]{0,39}$/.test(status)))) return null;
    if (!timeOrNull(entry["startedAt"] ?? null) || records === null || (entry["discarded"] !== null && discarded === null)) return null;
    entries.push({
      runId: entry["runId"],
      kind,
      status: status as string | null,
      startedAt: (entry["startedAt"] ?? null) as string | null,
      records,
      reverted: entry["reverted"] === true,
      partlyReverted: entry["partlyReverted"] === true,
      discarded,
      recordsChanged: entry["recordsChanged"] === true,
    });
  }
  const discarded = value["discarded"];
  const parked = sizeOf(value["parked"]);
  const leftovers = value["leftovers"] === undefined ? { count: 0, files: 0, bytes: 0 } : value["leftovers"];
  const leftoverSize = sizeOf(leftovers);
  if (!count(discarded["runs"]) || !count(discarded["files"]) || !count(discarded["bytes"]) || parked === null || !isObj(leftovers) || !count(leftovers["count"]) || leftoverSize === null) return null;
  return {
    runs: { count: runs["count"], bytes: runs["bytes"], oldest: (runs["oldest"] ?? null) as string | null, newest: (runs["newest"] ?? null) as string | null },
    entries,
    discarded: { runs: discarded["runs"], files: discarded["files"], bytes: discarded["bytes"] },
    parked,
    leftovers: { count: leftovers["count"], ...leftoverSize },
  };
}

/** One item of a cleanup plan: a run's records, its discarded-files folder, or a leftover folder (`id`: run id, or 16 hex digits). */
export interface CleanupItemView {
  readonly target: "run" | "discarded" | "leftover";
  readonly id: string;
  readonly files: number;
  readonly bytes: number;
  /** DR-44 warning codes: not_reverted, partly_reverted, discarded_left, people_files, records_changed, leftover. */
  readonly warnings: readonly string[];
}

export interface CleanupTotalsView {
  /** `notReverted`: of them, records of runs not (or only partly) reverted, asked about apart (DR-44 (a)). */
  readonly runs: { readonly count: number; readonly notReverted: number; readonly files: number; readonly bytes: number };
  readonly discarded: { readonly count: number; readonly files: number; readonly bytes: number };
  readonly leftovers: { readonly count: number; readonly files: number; readonly bytes: number };
}

export interface CleanupPlanView {
  readonly items: readonly CleanupItemView[];
  readonly blocked: readonly { readonly target: "run" | "discarded"; readonly runId: string; readonly code: string }[];
  readonly totals: CleanupTotalsView;
  readonly parked: SizeView;
  readonly digest: string;
}

function idFits(target: unknown, id: unknown): id is string {
  return typeof id === "string" && (target === "leftover" ? LEFTOVER_ID.test(id) : RUN_ID.test(id));
}

function codes(value: unknown): string[] | null {
  return Array.isArray(value) && value.length <= 16 && value.every((code) => typeof code === "string" && CODE.test(code)) ? [...(value as string[])] : null;
}

function totalsOf(value: unknown): CleanupTotalsView | null {
  if (!isObj(value) || !isObj(value["runs"]) || !isObj(value["discarded"])) return null;
  const runs = value["runs"];
  const discarded = value["discarded"];
  const leftovers = value["leftovers"] === undefined ? { count: 0, files: 0, bytes: 0 } : value["leftovers"];
  const runSize = sizeOf(runs);
  const discardedSize = sizeOf(discarded);
  const leftoverSize = sizeOf(leftovers);
  if (runSize === null || discardedSize === null || leftoverSize === null || !isObj(leftovers)) return null;
  if (!count(runs["count"]) || !count(runs["notReverted"] ?? 0) || !count(discarded["count"]) || !count(leftovers["count"])) return null;
  return {
    runs: { count: runs["count"], notReverted: (runs["notReverted"] ?? 0) as number, ...runSize },
    discarded: { count: discarded["count"], ...discardedSize },
    leftovers: { count: leftovers["count"], ...leftoverSize },
  };
}

/** The engine host's plan view, checked; null when it does not fit. */
export function cleanupPlanOf(value: unknown): CleanupPlanView | null {
  if (!isObj(value) || !Array.isArray(value["items"]) || value["items"].length > MAX_ITEMS || !Array.isArray(value["blocked"]) || value["blocked"].length > MAX_ITEMS) return null;
  const items: CleanupItemView[] = [];
  for (const item of value["items"]) {
    if (!isObj(item)) return null;
    const { target, id } = item;
    const warnings = codes(item["warnings"]);
    if (!(target === "run" || target === "discarded" || target === "leftover") || !idFits(target, id) || !count(item["files"]) || !count(item["bytes"]) || warnings === null) return null;
    items.push({ target, id, files: item["files"], bytes: item["bytes"], warnings });
  }
  const blocked: { target: "run" | "discarded"; runId: string; code: string }[] = [];
  for (const entry of value["blocked"]) {
    if (!isObj(entry) || !(entry["target"] === "run" || entry["target"] === "discarded") || typeof entry["runId"] !== "string" || !RUN_ID.test(entry["runId"]) || typeof entry["code"] !== "string" || !CODE.test(entry["code"])) return null;
    blocked.push({ target: entry["target"], runId: entry["runId"], code: entry["code"] });
  }
  const totals = totalsOf(value["totals"]);
  const parked = sizeOf(value["parked"]);
  const digest = value["digest"];
  if (totals === null || parked === null || typeof digest !== "string" || !DIGEST.test(digest)) return null;
  return { items, blocked, totals, parked, digest };
}

export const isCleanupTimestamp = (value: unknown): value is string => typeof value === "string" && TIMESTAMP.test(value);

/**
 * DR-48 (U-22): what a cleanup that was carried out did, the contract's CLEANUP_STATUSES without
 * preview: removed (something removed, nothing kept for a problem), nothing_removed (nothing removed,
 * nothing kept for a problem), partly_failed (something kept for a problem: changed,
 * not_plain_directory, io_error, partly_removed).
 */
export const CLEANUP_RESULT_STATUSES = ["removed", "nothing_removed", "partly_failed"] as const;
export type CleanupResultStatus = (typeof CLEANUP_RESULT_STATUSES)[number];

/**
 * What a cleanup did: removed entirely, kept and why (DR-44 (d): partly_removed is kept, not removed),
 * or why nothing was. `ok: true` is a cleanup that was carried out, whatever its `status`.
 */
export type CleanupResultView =
  | {
      readonly ok: true;
      readonly status: CleanupResultStatus;
      readonly removed: readonly { readonly target: "run" | "discarded" | "leftover"; readonly id: string; readonly files: number; readonly bytes: number }[];
      readonly kept: readonly { readonly target: "run" | "discarded" | "leftover"; readonly id: string; readonly reason: string }[];
      readonly totals: CleanupTotalsView;
    }
  | { readonly ok: false; readonly code: string };

/** The engine host's result view, checked; null when it does not fit. */
export function cleanupResultOf(value: unknown): CleanupResultView | null {
  if (!isObj(value)) return null;
  if (value["ok"] === false) return typeof value["code"] === "string" && CODE.test(value["code"]) ? { ok: false, code: value["code"] } : null;
  if (value["ok"] !== true || !Array.isArray(value["removed"]) || !Array.isArray(value["kept"]) || value["removed"].length > MAX_ITEMS || value["kept"].length > MAX_ITEMS) return null;
  const status = value["status"];
  if (typeof status !== "string" || !(CLEANUP_RESULT_STATUSES as readonly string[]).includes(status)) return null;
  const removed: { target: "run" | "discarded" | "leftover"; id: string; files: number; bytes: number }[] = [];
  for (const item of value["removed"]) {
    if (!isObj(item) || !(item["target"] === "run" || item["target"] === "discarded" || item["target"] === "leftover") || !idFits(item["target"], item["id"]) || !count(item["files"]) || !count(item["bytes"])) return null;
    removed.push({ target: item["target"], id: item["id"], files: item["files"], bytes: item["bytes"] });
  }
  const kept: { target: "run" | "discarded" | "leftover"; id: string; reason: string }[] = [];
  for (const item of value["kept"]) {
    if (!isObj(item) || !(item["target"] === "run" || item["target"] === "discarded" || item["target"] === "leftover") || !idFits(item["target"], item["id"]) || typeof item["reason"] !== "string" || !CODE.test(item["reason"])) return null;
    kept.push({ target: item["target"], id: item["id"], reason: item["reason"] });
  }
  const totals = totalsOf(value["totals"]);
  return totals === null ? null : { ok: true, status: status as CleanupResultStatus, removed, kept, totals };
}

/**
 * DR-44: what the main process asks about a plan before cleaning it, apart from the plan itself:
 * records of runs not (or only partly) reverted (`includeNotReverted`), and the discarded-files
 * folders (`discarded`, people's files). `discardedLeft`: apply runs with discarded files; U-13
 * (DR-53): their records are kept unless those files are deleted in the same cleanup.
 * R-34b P-1: which records need that question is the contract's rule (NOT_REVERTED_WARNINGS), and
 * the store counts them in `totals.runs.notReverted`, runs whose records cannot be checked
 * included. The main process follows that count, with the codes it knows as a floor.
 */
export function cleanupQuestions(plan: CleanupPlanView): {
  readonly hasItems: boolean;
  readonly records: { readonly count: number; readonly bytes: number };
  readonly notReverted: number;
  readonly discarded: { readonly count: number; readonly files: number; readonly bytes: number };
  readonly leftovers: number;
  readonly discardedLeft: number;
} {
  const records = plan.items.filter((item) => item.target === "run");
  const discarded = plan.items.filter((item) => item.target === "discarded");
  return {
    hasItems: plan.items.length > 0,
    records: { count: records.length, bytes: records.reduce((sum, item) => sum + item.bytes, 0) },
    notReverted: Math.max(plan.totals.runs.notReverted, records.filter((item) => item.warnings.includes("not_reverted") || item.warnings.includes("partly_reverted")).length),
    discarded: { count: discarded.length, files: discarded.reduce((sum, item) => sum + item.files, 0), bytes: discarded.reduce((sum, item) => sum + item.bytes, 0) },
    leftovers: plan.items.filter((item) => item.target === "leftover").length,
    discardedLeft: records.filter((item) => item.warnings.includes("discarded_left")).length,
  };
}
