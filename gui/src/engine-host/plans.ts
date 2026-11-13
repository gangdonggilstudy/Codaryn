/**
 * GU-5 (docs/design/standalone-gui.md 3.9, 3.7): a plan and a person's review, as the window may
 * see them. Built from the app layer's `plan` and `review` outputs. The plan's actions are masked
 * by the app layer with the task form's secrets (and refused as `plan_secrets_differ` when those
 * mask it otherwise than the plan run did, DR-28); every path passes `shown` here as well. The
 * digest goes on in full: the apply names it (DR-1), and the window shows its first 12 characters.
 */

import { failureOf } from "./settings.js";
import { MAX_CHANGE_TEXT_CHARS, MAX_PLAN_SUMMARY_ROWS } from "../shared/ipc.js";
import type { HostFailure, Shown } from "./settings.js";
import type { ModelText } from "./model-text.js";

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const DIGEST = /^[0-9a-f]{64}$/;
const RUN_ID = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/;
const MAX_ACTIONS = 10_000;

function outputOf(outcome: unknown): Obj | null {
  if (!isObj(outcome) || outcome["ok"] !== true || !isObj(outcome["output"])) return null;
  return outcome["output"];
}

/**
 * U-32 (U-14 AXM-15): the plan's summary (PlanOutput.summary, masked by the app layer) as rows, by
 * the app layer's modelTextRows (`modelText`, U-48), each row through `shown` as well. Null when there is
 * none, it is not text, it leaves no row, or there is no `modelText` (the model's words are not shown
 * without the CLI's own handling).
 */
function summaryRows(value: unknown, shown: Shown, modelText: ModelText | undefined): string[] | null {
  if (modelText === undefined || typeof value !== "string") return null;
  const rows = modelText(value)
    .slice(0, MAX_PLAN_SUMMARY_ROWS)
    .map((row) => shown(row))
    .filter((row) => row.length > 0);
  return rows.length === 0 ? null : rows;
}

/**
 * `plan` → `{ok, runId, status, digest, actions, inventoryLimitReached, appliedBy, recordsChanged?,
 * summary?}` or a failure. U-32: `recordsChanged` (U-14 AXM-2) as the app layer gives it; a marked
 * plan run has no summary (its journal may have been changed too), as in the CLI.
 */
export function planValue(outcome: unknown, shown: Shown, modelText?: ModelText): Obj | HostFailure {
  const output = outputOf(outcome);
  if (output === null) return failureOf(outcome);
  const marked = output["recordsChanged"] === true;
  const summary = marked ? null : summaryRows(output["summary"], shown, modelText);
  const digest = output["digest"];
  if (typeof digest !== "string" || !DIGEST.test(digest)) return { ok: false, code: "host_error" };
  if (output["planKind"] === "changes") return changesPlanValue(output, digest, marked, summary, shown);
  const actions: Obj[] = [];
  for (const action of Array.isArray(output["actions"]) ? output["actions"].slice(0, MAX_ACTIONS) : []) {
    if (!isObj(action)) continue;
    if (action["kind"] === "move" && typeof action["from"] === "string" && typeof action["to"] === "string") actions.push({ kind: "move", from: shown(action["from"]), to: shown(action["to"]) });
    else if (action["kind"] === "discard" && typeof action["path"] === "string") actions.push({ kind: "discard", from: shown(action["path"]), to: null });
  }
  // U-271 (G-sec, U-274): only the contract's statuses (PLAN_STATUSES); any other is not shown as one to approve.
  const status = output["status"];
  if (status !== "pending" && status !== "applied") return { ok: false, code: "host_error" };
  const applied = output["appliedBy"];
  return {
    ok: true,
    runId: typeof output["runId"] === "string" && RUN_ID.test(output["runId"]) ? output["runId"] : null,
    status,
    digest,
    actions,
    inventoryLimitReached: output["inventoryLimitReached"] === true,
    appliedBy: isObj(applied) && typeof applied["runId"] === "string" && RUN_ID.test(applied["runId"]) && typeof applied["at"] === "string" ? { runId: applied["runId"], at: applied["at"] } : null,
    ...(marked ? { recordsChanged: true } : {}),
    ...(summary === null ? {} : { summary }),
  };
}

/**
 * U-206 (U-196, DR-69 B-3): a run plan (ChangesPlanOutput, `planKind: "changes"`): the files a later
 * run will make or change, each path masked by the app layer and passed through `shown` here, and
 * whether it makes or changes it. The summary is part of what is approved (it is in plan.json and
 * the digest) and passes the model text rows as an apply plan's does. A file that does not fit makes
 * the whole value host_error: a plan shown with a file left out would not be the plan approved.
 */
function changesPlanValue(output: Obj, digest: string, marked: boolean, summary: string[] | null, shown: Shown): Obj | HostFailure {
  const given = output["files"];
  if (!Array.isArray(given) || given.length > MAX_ACTIONS) return { ok: false, code: "host_error" };
  const files: Obj[] = [];
  for (const file of given) {
    if (!isObj(file) || typeof file["path"] !== "string" || (file["change"] !== "create" && file["change"] !== "modify")) return { ok: false, code: "host_error" };
    files.push({ path: shown(file["path"]), change: file["change"] });
  }
  // U-271 (G-sec, U-274): only the contract's statuses (PLAN_STATUSES); any other is not shown as one to approve.
  const status = output["status"];
  if (status !== "pending" && status !== "applied") return { ok: false, code: "host_error" };
  const applied = output["appliedBy"];
  return {
    ok: true,
    planKind: "changes",
    runId: typeof output["runId"] === "string" && RUN_ID.test(output["runId"]) ? output["runId"] : null,
    status,
    digest,
    actions: [],
    files,
    inventoryLimitReached: false,
    appliedBy: isObj(applied) && typeof applied["runId"] === "string" && RUN_ID.test(applied["runId"]) && typeof applied["at"] === "string" ? { runId: applied["runId"], at: applied["at"] } : null,
    ...(marked ? { recordsChanged: true } : {}),
    ...(summary === null ? {} : { summary }),
  };
}

const CHANGE_STATES = ["as_run_left", "changed_since_run", "missing", "unknown"];
const WORD = /^[a-z][a-z_]{0,39}$/;

/** All file texts of one changes value together, in characters: the channel's line limit is 8 MiB. */
export const MAX_CHANGES_TEXT_CHARS = 3_000_000;

/**
 * DR-29, DR-32 (c) (3.4): `changes` → `{ok, runId, masking, files: [{path, created, state,
 * unavailable, before, after}]}`. The app layer gives a file's masked texts only when the secrets
 * registered now mask them as the run did (`changeShownMatches`); otherwise they are null with
 * `masking_unverified`. Texts given pass `shownText` (line breaks kept, other control characters and
 * key shapes hidden). Past MAX_CHANGES_TEXT_CHARS the remaining files go without text (`too_large`).
 * U-48 (U-43, DR-38): `recordsChanged: true` when the app layer says the run has a records-changed
 * mark (its files then come without text); absent otherwise.
 */
export function changesValue(outcome: unknown, shown: Shown, shownText: Shown): Obj | HostFailure {
  const output = outputOf(outcome);
  if (output === null) return failureOf(outcome);
  const files: Obj[] = [];
  let budget = MAX_CHANGES_TEXT_CHARS;
  for (const file of Array.isArray(output["files"]) ? output["files"].slice(0, MAX_ACTIONS) : []) {
    if (!isObj(file) || typeof file["path"] !== "string") continue;
    const state = typeof file["state"] === "string" && CHANGE_STATES.includes(file["state"]) ? file["state"] : "unknown";
    let unavailable = typeof file["unavailable"] === "string" && WORD.test(file["unavailable"]) ? file["unavailable"] : null;
    let before = typeof file["before"] === "string" ? shownText(file["before"]) : null;
    let after = typeof file["after"] === "string" ? shownText(file["after"]) : null;
    const size = (before?.length ?? 0) + (after?.length ?? 0);
    // Per file: a side longer than the main process takes (masking can lengthen a text) or past the
    // budget leaves this file without text; the other files keep theirs.
    const sideTooLong = (before?.length ?? 0) > MAX_CHANGE_TEXT_CHARS || (after?.length ?? 0) > MAX_CHANGE_TEXT_CHARS;
    if (sideTooLong || size > budget) {
      before = null;
      after = null;
      unavailable = "too_large";
    } else {
      budget -= size;
    }
    files.push({ path: shown(file["path"]), created: file["created"] === true, state, unavailable, before, after });
  }
  return {
    ok: true,
    runId: typeof output["runId"] === "string" && RUN_ID.test(output["runId"]) ? output["runId"] : null,
    masking: output["masking"] === "current_secrets" ? "current_secrets" : null,
    files,
    ...(output["recordsChanged"] === true ? { recordsChanged: true } : {}),
  };
}

/** `review` → `{ok, runId, verdict, replaced}` or a failure. */
export function reviewValue(outcome: unknown): Obj | HostFailure {
  const output = outputOf(outcome);
  if (output === null) return failureOf(outcome);
  const verdict = output["verdict"];
  return {
    ok: true,
    runId: typeof output["runId"] === "string" && RUN_ID.test(output["runId"]) ? output["runId"] : null,
    verdict: verdict === "accepted" || verdict === "rejected" ? verdict : null,
    replaced: output["replaced"] === true,
  };
}
