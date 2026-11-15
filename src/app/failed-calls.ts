/**
 * U-18 (AXM-4): the failed-call rule of RunSummaryContext.failedToolCalls, the one the end summary's
 * count (run.ts), the English progress line (progress.ts) and the report's text (report.ts) share:
 * a `tool_result` record with `ok: false` whose `callId` has no `tool_decision` with
 * `allowed: false` in the run. A call the policy denied or a check rejected is a denied call only.
 * A command that ran and exited with a code other than 0, or timed out, has an ok result and is not
 * a failed call (PM Q-2 (a)).
 *
 * Records are given in journal order, as they are appended or as a journal is read back; a record
 * that is not of that shape (a damaged journal read by the report) is ignored here.
 */

export interface FailedCalls {
  /** Takes the next record; true when it is a failed call's result. */
  observe(record: unknown): boolean;
  /** The failed calls seen so far. */
  readonly count: number;
}

type Fields = Record<string, unknown>;

function fields(value: unknown): Fields | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : null;
}

export function createFailedCalls(): FailedCalls {
  const denied = new Set<string>();
  let count = 0;
  return {
    observe(record) {
      const rec = fields(record);
      if (rec === null) return false;
      if (rec["type"] === "tool_decision") {
        if (rec["allowed"] === false && typeof rec["callId"] === "string") denied.add(rec["callId"]);
        return false;
      }
      if (rec["type"] !== "tool_result") return false;
      const result = fields(rec["result"]);
      if (result === null || result["ok"] !== false || typeof result["callId"] !== "string" || denied.has(result["callId"])) return false;
      count += 1;
      return true;
    },
    get count() {
      return count;
    },
  };
}
