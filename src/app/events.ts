/**
 * Run events (adapter-contract 5.2): every record the run's journal stored, delivered after it
 * was written, as the stored line says it (`seq`, `at`, `runId` included), except for the fields
 * the journal does not mask (R-1 L-1).
 *
 * Model-given names and call ids are recorded as the model sent them (`src/engine/index.ts:403-412`,
 * `:573`, and again inside the next `model_request`'s messages): they are plain strings, not
 * MaskedText. Before an event leaves the app layer, a tool
 * name outside the built-in set becomes "(unknown tool)" (as the CLI's progress lines do) and every
 * call id is masked with the run's gateway. All other fields are delivered as stored.
 *
 * Interim: `Journal.append` does not return the stored record yet (AC-D3), so the records are read
 * back from the journal file after each append resolves. The store writes each record as one
 * complete line before `append` resolves, so the new bytes are always whole lines.
 */

import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { TOOL_NAMES } from "../contracts/index.js";
import type { Journal, JournalRecord, MaskedToolCall, ModelMessage, PrivacyGateway, ToolResult } from "../contracts/index.js";
import type { RunEvent, RunObserver } from "./types.js";

export const UNKNOWN_TOOL_NAME = "(unknown tool)";
/** Shown for a call id that could not be masked. */
export const UNSHOWN_CALL_ID = "(not shown)";

/** Delivers one event. An observer's exception or absence never reaches the run. */
export function deliver(observer: RunObserver | undefined, event: RunEvent): void {
  if (observer?.onEvent === undefined) return;
  try {
    observer.onEvent(event);
  } catch {
    // An observer cannot change the run.
  }
}

/**
 * The record as an event may show it: model-given tool names limited to the built-in set and call
 * ids masked. Records without such fields are returned as they are.
 */
export function sanitizeRecord(record: JournalRecord, privacy: PrivacyGateway): JournalRecord {
  const tool = (name: string): string => ((TOOL_NAMES as readonly string[]).includes(name) ? name : UNKNOWN_TOOL_NAME);
  const id = (value: string): string => {
    try {
      const masked = privacy.mask(value);
      return masked.ok ? masked.text : UNSHOWN_CALL_ID;
    } catch {
      return UNSHOWN_CALL_ID;
    }
  };
  const call = (item: MaskedToolCall): MaskedToolCall => ({ ...item, id: id(item.id), name: tool(item.name) });
  const result = (item: ToolResult): ToolResult => ({ ...item, tool: tool(item.tool), callId: id(item.callId) });
  const message = (item: ModelMessage): ModelMessage => {
    if (item.role === "assistant") return { ...item, toolCalls: item.toolCalls.map(call) };
    if (item.role === "tool") return { ...item, results: item.results.map(result) };
    return item;
  };
  switch (record.type) {
    case "tool_decision":
      return { ...record, tool: tool(record.tool), callId: id(record.callId) };
    case "tool_result":
      return { ...record, result: result(record.result) };
    case "file_changed":
      return { ...record, callId: id(record.callId) };
    case "model_response":
      return { ...record, toolCalls: record.toolCalls.map(call) };
    // The conversation sent back to the model repeats the calls and their results.
    case "model_request":
      return { ...record, newMessages: record.newMessages.map(message) };
    default:
      return record;
  }
}

function isRecord(value: unknown, runId: string): value is JournalRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as { seq?: unknown; at?: unknown; runId?: unknown; type?: unknown };
  return (
    typeof record.seq === "number" &&
    Number.isSafeInteger(record.seq) &&
    typeof record.at === "string" &&
    record.runId === runId &&
    typeof record.type === "string"
  );
}

/** Reads the lines appended to the journal file since the previous read. */
class JournalTail {
  private handle: FileHandle | null = null;
  private offset = 0;
  private carry: Buffer = Buffer.alloc(0);

  constructor(
    private readonly file: string,
    private readonly runId: string,
  ) {}

  async read(): Promise<JournalRecord[]> {
    this.handle ??= await open(this.file, "r");
    const { size } = await this.handle.stat();
    if (size <= this.offset) return [];
    const chunk = Buffer.alloc(size - this.offset);
    const { bytesRead } = await this.handle.read(chunk, 0, chunk.length, this.offset);
    this.offset += bytesRead;
    const bytes = Buffer.concat([this.carry, chunk.subarray(0, bytesRead)]);
    const end = bytes.lastIndexOf(0x0a);
    if (end < 0) {
      this.carry = bytes;
      return [];
    }
    this.carry = Buffer.from(bytes.subarray(end + 1));
    const records: JournalRecord[] = [];
    for (const line of bytes.subarray(0, end).toString("utf8").split("\n")) {
      try {
        const value: unknown = JSON.parse(line);
        if (isRecord(value, this.runId)) records.push(value);
      } catch {
        // Not a record line; the journal itself stays the reference.
      }
    }
    return records;
  }

  async close(): Promise<void> {
    const handle = this.handle;
    this.handle = null;
    await handle?.close();
  }
}

/**
 * Wraps the run's journal so that each stored record is delivered to `observer`, sanitized with
 * the run's gateway. Without an `onEvent` the journal is returned as it is. Reading or delivery
 * problems are ignored: events are a view of the journal, never a condition of the run.
 */
export function journalWithEvents(
  journal: Journal,
  file: string,
  runId: string,
  observer: RunObserver | undefined,
  privacy: PrivacyGateway,
): Journal {
  if (observer?.onEvent === undefined) return journal;
  const tail = new JournalTail(file, runId);
  return {
    async append(event) {
      await journal.append(event);
      let records: JournalRecord[];
      try {
        records = await tail.read();
      } catch {
        return;
      }
      for (const record of records) deliver(observer, { kind: "record", record: sanitizeRecord(record, privacy) });
    },
    async close() {
      try {
        await journal.close();
      } finally {
        await tail.close().catch(() => undefined);
      }
    },
  };
}
