/**
 * Run events (adapter-contract 5.2): every record the run's journal stored, delivered after it
 * was written, as the stored line says it (`seq`, `at`, `runId` included).
 *
 * Interim: `Journal.append` does not return the stored record yet (AC-D3), so the records are read
 * back from the journal file after each append resolves. The store writes each record as one
 * complete line before `append` resolves, so the new bytes are always whole lines. When AC-D3 is
 * made, `append`'s return value replaces this reading and the delivered events stay the same.
 */

import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { Journal, JournalRecord } from "../contracts/index.js";
import type { RunEvent, RunObserver } from "./types.js";

/** Delivers one event. An observer's exception or absence never reaches the run. */
export function deliver(observer: RunObserver | undefined, event: RunEvent): void {
  if (observer?.onEvent === undefined) return;
  try {
    observer.onEvent(event);
  } catch {
    // An observer cannot change the run.
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
 * Wraps the run's journal so that each stored record is delivered to `observer`. Without an
 * `onEvent` the journal is returned as it is. Reading or delivery problems are ignored: events are
 * a view of the journal, never a condition of the run.
 */
export function journalWithEvents(journal: Journal, file: string, runId: string, observer: RunObserver | undefined): Journal {
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
      for (const record of records) deliver(observer, { kind: "record", record });
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
