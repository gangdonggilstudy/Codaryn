/**
 * GU-4 (docs/design/standalone-gui.md 3.8): the run list and reverting a run, as the window may
 * see them. Built from the app layer's `listRuns` and `revert` outputs:
 * - Run ids go on as they are (the shape of RUN_ID); task ids and every path pass `shown`.
 * - Damaged runs keep their id only (N-23 (b), N-26): no report, changes or revert for them.
 * - App errors go on as their code only.
 */

import { failureOf } from "./settings.js";
import type { HostFailure, Shown } from "./settings.js";

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const RUN_ID = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/;
const WORD = /^[a-z][a-z_-]{0,39}$/;
const MAX_LIST = 1000;

const word = (value: unknown): string | null => (typeof value === "string" && WORD.test(value) ? value : null);
const count = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);

function outputOf(outcome: unknown): Obj | null {
  if (!isObj(outcome) || outcome["ok"] !== true || !isObj(outcome["output"])) return null;
  return outcome["output"];
}

/** `listRuns` → `{ok, runs, omitted}` or a failure. */
export function runsValue(outcome: unknown, shown: Shown): Obj | HostFailure {
  const output = outputOf(outcome);
  if (output === null) return failureOf(outcome);
  const runs: Obj[] = [];
  for (const entry of Array.isArray(output["runs"]) ? output["runs"].slice(0, MAX_LIST) : []) {
    if (!isObj(entry) || typeof entry["runId"] !== "string" || !RUN_ID.test(entry["runId"])) continue;
    if (entry["state"] === "damaged") {
      runs.push({ state: "damaged", runId: entry["runId"] });
      continue;
    }
    const reverted = entry["reverted"];
    runs.push({
      state: "checked",
      runId: entry["runId"],
      kind: entry["kind"] === "apply" ? "apply" : "run",
      startedAt: typeof entry["startedAt"] === "string" ? entry["startedAt"] : null,
      taskId: typeof entry["taskId"] === "string" ? shown(entry["taskId"]) : "",
      status: word(entry["status"]),
      reason: word(entry["reason"]),
      changes: count(entry["changes"]),
      reverted: isObj(reverted) && typeof reverted["at"] === "string" ? { at: reverted["at"], status: reverted["status"] === "partial" ? "partial" : "complete" } : null,
      revertRecordDamaged: entry["revertRecordDamaged"] === true,
      // UXM-14, DR-38: a records-changed mark (absent: false).
      recordsChanged: entry["recordsChanged"] === true,
    });
  }
  return { ok: true, runs, omitted: count(output["omitted"]) ?? 0 };
}

/** `revert` (dry run or not) → `{ok, runId, status, dryRun, reverted, skipped, moveSafetyUnchecked, revertedBefore}` or a failure. */
export function revertValue(outcome: unknown, shown: Shown): Obj | HostFailure {
  const output = outputOf(outcome);
  if (output === null) return failureOf(outcome);
  const reverted: Obj[] = [];
  for (const file of Array.isArray(output["reverted"]) ? output["reverted"].slice(0, MAX_LIST) : []) {
    if (!isObj(file) || typeof file["path"] !== "string" || word(file["action"]) === null) continue;
    reverted.push({ path: shown(file["path"]), action: file["action"], from: typeof file["from"] === "string" ? shown(file["from"]) : null, unsafe: file["unsafe"] === true });
  }
  const skipped: Obj[] = [];
  for (const file of Array.isArray(output["skipped"]) ? output["skipped"].slice(0, MAX_LIST) : []) {
    if (!isObj(file) || typeof file["path"] !== "string" || word(file["reason"]) === null) continue;
    skipped.push({ path: shown(file["path"]), reason: file["reason"] });
  }
  const before = output["revertedBefore"];
  return {
    ok: true,
    runId: typeof output["runId"] === "string" && RUN_ID.test(output["runId"]) ? output["runId"] : null,
    status: output["status"] === "partial" ? "partial" : "complete",
    dryRun: output["dryRun"] === true,
    reverted,
    skipped,
    moveSafetyUnchecked: output["moveSafetyUnchecked"] === true,
    revertedBefore: isObj(before) && typeof before["at"] === "string" ? { at: before["at"], status: before["status"] === "partial" ? "partial" : "complete" } : null,
    // U-32 (UXM-14, DR-38): the run has a records-changed mark; the revert still checked every file.
    ...(output["recordsChanged"] === true ? { recordsChanged: true } : {}),
  };
}
