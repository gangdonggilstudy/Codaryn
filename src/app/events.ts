/**
 * Run events (adapter-contract 5.2, DR-15): the records the engine handed to the run's journal,
 * delivered after the journal stored them, built in memory. The journal file is never read back:
 * commands allowed during a run can append lines to it (R-4 H-1), and such a line must not reach
 * an observer.
 *
 * - `seq` and `at` are the stored record's own (AC-D3, the CLI migration's C-2, U-262): the journal
 *   resolves with the record as it wrote it, so an event and its stored line are the same record.
 *   Before, the app counted `seq` itself and read `at` from the run's clock a moment after the store.
 * - Every string in the record is masked again with the run's gateway (masking text that gateway
 *   already masked leaves it as it is). A tool name in no tool list reads "(unknown tool)" first
 *   (R-1 L-1). U-250 (the migration plan's P-2, R-80 I-1): the list is every tool a run can be
 *   offered (ALL_TOOL_NAMES: the four built-in ones and the task-type tools), as the CLI's progress
 *   lines name them; before, only the four were kept and the task-type tools read "(unknown tool)".
 *   A record that cannot be masked is not delivered; the gap in `seq` shows it.
 */

import { ALL_TOOL_NAMES } from "../contracts/index.js";
import type { Journal, JournalRecord, MaskedToolCall, ModelMessage, PrivacyGateway, ToolResult } from "../contracts/index.js";
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

/** Model-given tool names limited to the tools a run can be offered (ALL_TOOL_NAMES), wherever a record repeats them. */
function limitToolNames(record: JournalRecord): JournalRecord {
  const tool = (name: string): string => ((ALL_TOOL_NAMES as readonly string[]).includes(name) ? name : UNKNOWN_TOOL_NAME);
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
    // U-74: the permission question names the tool of the call it asks about.
    case "confirmation_requested":
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
 * U-292, U-293 (C-6a): gives `observer` a record as the journal stored it (RunObserver.onStoredRecord),
 * a copy, so neither the observer's changes nor its exception or absence reach the run.
 */
export function deliverStored(observer: RunObserver | undefined, record: JournalRecord): void {
  if (observer?.onStoredRecord === undefined) return;
  try {
    observer.onStoredRecord(structuredClone(record));
  } catch {
    // An observer cannot change the run.
  }
}

/**
 * Wraps the run's journal so that each record the engine appends is delivered to `observer` once
 * the journal stored it: U-293 (C-6a, U-292), first as stored (onStoredRecord), then masked again as
 * an event (onEvent). A record that cannot be masked again is no event, but is still given as stored,
 * as the CLI draws its line from it. Without either the journal is returned as it is.
 */
export function journalWithEvents(journal: Journal, observer: RunObserver | undefined, privacy: PrivacyGateway): Journal {
  if (observer?.onEvent === undefined && observer?.onStoredRecord === undefined) return journal;
  return {
    async append(event) {
      const record = await journal.append(event);
      deliverStored(observer, record);
      if (observer.onEvent !== undefined) {
        const shown = sanitizeRecord(record, privacy);
        if (shown !== null) deliver(observer, { kind: "record", record: shown });
      }
      return record;
    },
    close: () => journal.close(),
  };
}
