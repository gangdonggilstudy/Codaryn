/**
 * Run events (adapter-contract 5.2, DR-15): the records the engine handed to the run's journal,
 * delivered after the journal stored them, built in memory. The journal file is never read back:
 * commands allowed during a run can append lines to it (R-4 H-1), and such a line must not reach
 * an observer.
 *
 * - `seq` counts the stored records from 1, as the store numbers a new run's journal.
 * - `at` is read from the run's clock when the record was stored. The store reads the same clock
 *   for its own line, so the two can differ by the time between the readings.
 * - Every string in the record is masked again with the run's gateway (masking text that gateway
 *   already masked leaves it as it is). A tool name outside the built-in set reads "(unknown tool)"
 *   first (R-1 L-1), as the CLI's progress lines do. A record that cannot be masked is not
 *   delivered; the gap in `seq` shows it.
 */

import { TOOL_NAMES } from "../contracts/index.js";
import type { Clock, Journal, JournalRecord, MaskedToolCall, ModelMessage, PrivacyGateway, ToolResult } from "../contracts/index.js";
import type { RunEvent, RunObserver } from "./types.js";

export const UNKNOWN_TOOL_NAME = "(unknown tool)";

/** Delivers one event. An observer's exception or absence never reaches the run. */
export function deliver(observer: RunObserver | undefined, event: RunEvent): void {
  if (observer?.onEvent === undefined) return;
  try {
    observer.onEvent(event);
  } catch {
    // An observer cannot change the run.
  }
}

/** Model-given tool names limited to the built-in set, wherever a record repeats them. */
function limitToolNames(record: JournalRecord): JournalRecord {
  const tool = (name: string): string => ((TOOL_NAMES as readonly string[]).includes(name) ? name : UNKNOWN_TOOL_NAME);
  const call = (item: MaskedToolCall): MaskedToolCall => ({ ...item, name: tool(item.name) });
  const result = (item: ToolResult): ToolResult => ({ ...item, tool: tool(item.tool) });
  const message = (item: ModelMessage): ModelMessage => {
    if (item.role === "assistant") return { ...item, toolCalls: item.toolCalls.map(call) };
    if (item.role === "tool") return { ...item, results: item.results.map(result) };
    return item;
  };
  switch (record.type) {
    case "tool_decision":
      return { ...record, tool: tool(record.tool) };
    case "tool_result":
      return { ...record, result: result(record.result) };
    case "model_response":
      return { ...record, toolCalls: record.toolCalls.map(call) };
    case "model_request":
      return { ...record, newMessages: record.newMessages.map(message) };
    default:
      return record;
  }
}

/**
 * The record as an event may show it: tool names limited, then every string masked with the run's
 * gateway. Null when any string cannot be masked.
 */
export function sanitizeRecord(record: JournalRecord, privacy: PrivacyGateway): JournalRecord | null {
  return maskStrings(limitToolNames(record), privacy);
}

/** `value` with every string masked with `privacy` (idempotent for its own tokens). Null when any string cannot be masked. */
export function maskStrings<T>(value: T, privacy: PrivacyGateway): T | null {
  let failed = false;
  const walk = (item: unknown): unknown => {
    if (failed) return null;
    if (typeof item === "string") {
      try {
        const masked = privacy.mask(item);
        if (masked.ok) return masked.text;
      } catch {
        // Falls through: not masked.
      }
      failed = true;
      return null;
    }
    if (Array.isArray(item)) return item.map(walk);
    if (typeof item === "object" && item !== null) return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, walk(value)]));
    return item;
  };
  const shown = walk(value);
  return failed ? null : (shown as T);
}

/**
 * Wraps the run's journal so that each record the engine appends is delivered to `observer` once
 * the journal stored it. Without an `onEvent` the journal is returned as it is.
 */
export function journalWithEvents(
  journal: Journal,
  runId: string,
  observer: RunObserver | undefined,
  privacy: PrivacyGateway,
  clock: Clock,
): Journal {
  if (observer?.onEvent === undefined) return journal;
  let seq = 0;
  return {
    async append(event) {
      await journal.append(event);
      seq += 1;
      const record = { seq, at: new Date(clock.now()).toISOString(), runId, ...event } as JournalRecord;
      const shown = sanitizeRecord(record, privacy);
      if (shown !== null) deliver(observer, { kind: "record", record: shown });
    },
    close: () => journal.close(),
  };
}
