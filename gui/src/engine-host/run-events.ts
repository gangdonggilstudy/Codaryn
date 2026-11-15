/**
 * U-118 (docs/design/standalone-gui.md 3.7 "records" tab; adapter-contract 5.13): one page of a run's
 * stored records from the app layer's `listRunEvents`, as the window shows them. Each record becomes
 * the same one-line item the live progress list has (the CLI's sentences, runItems in main.ts), so the
 * tab shows them and filters them as the run screen does. A record with no line (a model response,
 * for one) is counted, not shown. The page's state is passed on as it came: complete, incomplete or
 * damaged, the records-changed mark, and how many lines were left out (`skipped`) and how many record
 * numbers no line gives (`missing`).
 */

import type { HostRunItem } from "../shared/protocol.js";
import type { RunItemOf } from "./runs.js";

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const CODE = /^[a-z][a-z0-9_]{0,63}$/;
const RUN_ID = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/;
const STATUSES = ["complete", "incomplete", "damaged"] as const;
const HOST_ERROR = { ok: false, code: "host_error" } as const;
/** At most this many records on one page (the app layer's MAX_RUN_EVENTS_PAGE). */
export const MAX_RUN_EVENTS_RECORDS = 1000;

export function runEventsValue(outcome: unknown, itemOf: RunItemOf): Obj {
  if (!isObj(outcome)) return HOST_ERROR;
  if (outcome["ok"] !== true) {
    const code = isObj(outcome["error"]) ? outcome["error"]["code"] : undefined;
    return { ok: false, code: typeof code === "string" && CODE.test(code) ? code : "host_error" };
  }
  const output = outcome["output"];
  if (!isObj(output) || output["kind"] !== "run_events") return HOST_ERROR;
  const { runId, runKind, status, records, total, skipped, missing, offset, nextOffset } = output;
  if (typeof runId !== "string" || !RUN_ID.test(runId) || (runKind !== "run" && runKind !== "apply")) return HOST_ERROR;
  if (typeof status !== "string" || !(STATUSES as readonly string[]).includes(status)) return HOST_ERROR;
  if (!Array.isArray(records) || records.length > MAX_RUN_EVENTS_RECORDS || !count(total) || !count(skipped) || !count(missing) || !count(offset) || !(nextOffset === null || count(nextOffset))) return HOST_ERROR;
  const items: HostRunItem[] = [];
  for (const record of records) {
    let item: HostRunItem | null = null;
    try {
      item = itemOf({ kind: "record", record });
    } catch {
      item = null;
    }
    if (item !== null) items.push(item);
  }
  return {
    ok: true,
    runId,
    runKind,
    status,
    recordsChanged: output["recordsChanged"] === true,
    items,
    records: records.length,
    total,
    skipped,
    missing,
    offset,
    nextOffset,
  };
}
