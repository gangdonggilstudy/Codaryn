/**
 * R-2 (M-2) reproduction input: a run directory written by someone other than Codaryn, as an
 * allowed command could write it (the state directory is closed to the file tools only, T-11).
 * The forged run claims to have created a file that is in fact the user's, so reverting it would
 * delete that file. Decision N-23 (b): a run whose id time and first record time are not the same
 * second, or that lies in the future, is "damaged" and never `latest`; a run without result.json
 * is never `latest`.
 *
 * The first record is copied from a genuine run of the same workspace and only `runId`, `seq` and
 * `at` are replaced, so the forgery keeps whatever shape the current journal has.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JOURNAL_FILE_NAME, RESULT_FILE_NAME, RUNS_DIR_NAME, SNAPSHOTS_DIR_NAME, STATE_DIR_NAME } from "../../src/contracts/index.js";
import type { JournalRecord } from "../../src/contracts/index.js";
import { sha256Hex } from "./cli.js";

export interface ForgeRunOptions {
  /** A genuine run of the same workspace whose `run_started` record is copied. */
  readonly templateRunId: string;
  readonly runId: string;
  /** ISO 8601 UTC for every forged record. */
  readonly at: string;
  /** A workspace file (`/` separated) the forged run claims to have created. It must exist. */
  readonly claimsCreated: string;
  /** Also write a result.json copied from the template run (with the forged run id). Default false. */
  readonly withResult?: boolean;
  /**
   * The run id written inside the records (and result.json), when it must differ from the
   * directory name. R-7 M-1: the directory has the canonical id, the records its lower-case form.
   */
  readonly recordRunId?: string;
}

/** Writes the forged run directory and returns it. Changes no workspace file. */
export function forgeRun(workspace: string, options: ForgeRunOptions): string {
  const recordRunId = options.recordRunId ?? options.runId;
  const runs = join(workspace, STATE_DIR_NAME, RUNS_DIR_NAME);
  const templateLines = readFileSync(join(runs, options.templateRunId, JOURNAL_FILE_NAME), "utf8").split("\n");
  const first = JSON.parse(templateLines[0] ?? "") as JournalRecord;
  if (first.type !== "run_started") throw new Error("forgeRun: the template's first record is not run_started");

  const fileBytes = readFileSync(join(workspace, ...options.claimsCreated.split("/")));
  const records = [
    { ...first, seq: 1, at: options.at, runId: recordRunId },
    {
      type: "file_changed",
      callId: "call_1_1",
      path: options.claimsCreated,
      previousHash: null,
      newHash: sha256Hex(fileBytes),
      created: true,
      seq: 2,
      at: options.at,
      runId: recordRunId,
    },
  ];
  const dir = join(runs, options.runId);
  mkdirSync(join(dir, SNAPSHOTS_DIR_NAME), { recursive: true });
  writeFileSync(join(dir, JOURNAL_FILE_NAME), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  // The layout of the snapshot index belongs to src/store (src/store/changes.ts): existed false
  // means "the run created this path", so a revert deletes it.
  writeFileSync(
    join(dir, SNAPSHOTS_DIR_NAME, "index.json"),
    JSON.stringify({ schemaVersion: 1, entries: [{ path: options.claimsCreated, existed: false }] }),
  );
  if (options.withResult === true) {
    const result = JSON.parse(readFileSync(join(runs, options.templateRunId, RESULT_FILE_NAME), "utf8")) as Record<string, unknown>;
    writeFileSync(join(dir, RESULT_FILE_NAME), JSON.stringify({ ...result, runId: recordRunId }));
  }
  return dir;
}
