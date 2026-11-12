/**
 * The append-only JSONL journal of a run (createJournal, createApplyJournal in index.ts). DR-38: made
 * with RunWriteNotes (createRunRecorders), it keeps the SHA-256 of every byte the journal file
 * should hold (what was there when it was opened and each line it appended) and notes it after each
 * append, so the state guard can tell its own lines from lines anyone else added.
 */

import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";

import { JOURNAL_FILE_NAME } from "../contracts/index.js";
import type { Clock } from "../contracts/index.js";
import { assertRunId, ensureStateDir, errorCode, runDir } from "./common.js";
import type { RunWriteNotes } from "./run-writes.js";

export interface JournalOptions {
  /** Real absolute path of the workspace root. */
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly clock: Clock;
}

/**
 * Each line is `{seq, at, runId, ...event}` followed by LF. The file is opened in append mode on the
 * first record. An existing journal of the same run is continued, never rewritten.
 */
export function appendOnlyJournal<E extends { readonly type: string }>(
  options: JournalOptions,
  notes?: RunWriteNotes,
  /** DR-38: called after each record is appended and noted (an apply notes the file a record names). */
  afterAppend?: (event: E) => Promise<void>,
): { append(event: E): Promise<void>; close(): Promise<void> } {
  const { workspaceRoot, runId, clock } = options;
  assertRunId(runId);
  const dir = runDir(workspaceRoot, runId);
  const file = join(dir, JOURNAL_FILE_NAME);

  let handle: FileHandle | null = null;
  let seq = 0;
  let closed = false;
  let queue: Promise<void> = Promise.resolve();
  // DR-38: the bytes the file should hold, as a running SHA-256 and a size.
  const expected = createHash("sha256");
  let expectedSize = 0;

  async function openForAppend(): Promise<FileHandle> {
    await ensureStateDir(workspaceRoot);
    await mkdir(dir, { recursive: true });
    if (notes !== undefined) await notes.dir(dir);
    let existing = "";
    try {
      existing = await readFile(file, "utf8");
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    if (existing.length > 0 && !existing.endsWith("\n")) {
      throw new Error("journal ends with an incomplete line; refusing to append to it");
    }
    seq = existing.length === 0 ? 0 : existing.split("\n").length - 1;
    expected.update(existing, "utf8");
    expectedSize = Buffer.byteLength(existing, "utf8");
    return open(file, "a");
  }

  function enqueue(task: () => Promise<void>): Promise<void> {
    const next = queue.then(task);
    queue = next.catch(() => undefined);
    return next;
  }

  return {
    append(event: E): Promise<void> {
      return enqueue(async () => {
        if (closed) throw new Error("journal is closed");
        handle ??= await openForAppend();
        const record = {
          seq: seq + 1,
          at: new Date(clock.now()).toISOString(),
          runId,
          ...event,
        };
        const line = `${JSON.stringify(record)}\n`;
        await handle.appendFile(line, "utf8");
        seq += 1;
        expected.update(line, "utf8");
        expectedSize += Buffer.byteLength(line, "utf8");
        if (notes !== undefined) await notes.file(file, { sha256: expected.copy().digest("hex"), size: expectedSize });
        if (afterAppend !== undefined) await afterAppend(event);
      });
    },
    close(): Promise<void> {
      return enqueue(async () => {
        closed = true;
        if (handle !== null) {
          const current = handle;
          handle = null;
          await current.close();
        }
      });
    },
  };
}
