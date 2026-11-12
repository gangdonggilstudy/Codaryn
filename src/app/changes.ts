/**
 * DR-7: the changes of one run for an adapter's comparison view, masked again.
 *
 * - Secrets: the ones a run with the same settings registers now (secretEnv of the task and the
 *   config file, the current key, values the variables file sets). They come from the CLI's own
 *   pre-run steps (see `probeSecrets` in app.ts), so nothing here decides what is a secret.
 * - Originals: the run's snapshots. Interim: the store does not export a reader yet, so this module
 *   reads the layout the store documents (src/store/changes.ts:1-15) with the same checks
 *   `revertRun` applies: one entry per distinct `file_changed` path, the original only when its hash
 *   is the path's first `previousHash`, UTF-8 text only. Migration step 4 replaces this with a
 *   store export.
 * - Current files: read through the workspace (links resolved, root and state directory enforced).
 *
 * - R-11 (PM order), by the DR-28 principle: a file's text is shown only when the secrets registered
 *   now mask it as the run did. Otherwise only its path and state are given (AC-D13). A run started
 *   with other secrets would otherwise show what it had masked (reproduced: a task form without the
 *   run's secretEnv printed the secret's value from the original and the current file). The run
 *   records how it masked a changed file's path (`file_changed.path`) but not its text, so the text
 *   cannot be checked and is not shown (`masking_unverified`). It comes back once the run keeps that
 *   record (contract and store; proposal in the A-4 report).
 *
 * Only masked text leaves this module. Reads only; no lock (like `report`).
 */

import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  CONTENT_HASH_PATTERN_SOURCE,
  JOURNAL_FILE_NAME,
  MAX_READ_BYTES,
  MAX_REPORT_FILE_BYTES,
  PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE,
  RUNS_DIR_NAME,
  SNAPSHOTS_DIR_NAME,
  STATE_DIR_NAME,
} from "../contracts/index.js";
import type { ContentHash, MaskedText, PrivacyGateway } from "../contracts/index.js";
import { createWorkspace } from "../workspace/index.js";
import { RUN_ID_PATTERN } from "../cli/args.js";
import { appError } from "./errors.js";
import type { AppCallOutcome, ChangedFileUnavailable, ChangedFileView, ChangesOutput } from "./types.js";

const CONTENT_HASH = new RegExp(CONTENT_HASH_PATTERN_SOURCE);
const TOKEN_FRAGMENT = new RegExp(PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE, "i");
const CONTENT_FILE_PATTERN = /^([1-9][0-9]{0,8})\.orig$/;
const INDEX_FILE_NAME = "index.json";

interface ChangedPath {
  readonly path: string;
  readonly before: ContentHash | null;
  after: ContentHash;
}

interface IndexEntry {
  readonly existed: boolean;
  readonly file?: string;
}

class RecordProblem extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(bytes: Uint8Array): ContentHash {
  return createHash("sha256").update(bytes).digest("hex") as ContentHash;
}

/** Distinct `file_changed` paths in order of first appearance, as `revertRun` reads them (T-10 for a cut last line). */
function changedPaths(text: string, runId: string): ChangedPath[] {
  const lines = text.split("\n");
  const last = lines.pop() ?? "";
  const byPath = new Map<string, ChangedPath>();
  const take = (record: unknown): void => {
    if (!isObject(record) || record["runId"] !== runId || typeof record["type"] !== "string") throw new RecordProblem();
    if (record["type"] !== "file_changed") return;
    const { path: recorded, previousHash, newHash } = record;
    const validBefore = previousHash === null || (typeof previousHash === "string" && CONTENT_HASH.test(previousHash));
    if (typeof recorded !== "string" || recorded.length === 0 || !validBefore || typeof newHash !== "string" || !CONTENT_HASH.test(newHash)) {
      throw new RecordProblem();
    }
    const known = byPath.get(recorded);
    if (known === undefined) byPath.set(recorded, { path: recorded, before: previousHash as ContentHash | null, after: newHash as ContentHash });
    else known.after = newHash as ContentHash;
  };
  for (const line of lines) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      throw new RecordProblem();
    }
    take(record);
  }
  if (last.length > 0) {
    let record: unknown;
    try {
      record = JSON.parse(last);
    } catch {
      return [...byPath.values()];
    }
    take(record);
  }
  return [...byPath.values()];
}

/**
 * R-11, DR-28 principle: whether the text the run changed at this path can be compared with how the
 * run masked it. Nothing records that yet (file_changed holds the masked path only, the snapshot
 * index no content), so it never can, and no text is shown.
 */
function textMaskingRecorded(_change: ChangedPath): boolean {
  return false;
}

/** The snapshot index by path, or null when there is none or it is not a valid index. */
async function readIndex(dir: string): Promise<Map<string, IndexEntry> | null> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path.join(dir, INDEX_FILE_NAME), "utf8"));
  } catch {
    return null;
  }
  if (!isObject(value) || value["schemaVersion"] !== 1 || !Array.isArray(value["entries"])) return null;
  const byPath = new Map<string, IndexEntry>();
  for (const item of value["entries"] as unknown[]) {
    if (!isObject(item) || typeof item["path"] !== "string" || typeof item["existed"] !== "boolean") return null;
    if (item["existed"]) {
      const file = item["file"];
      if (typeof file !== "string" || !CONTENT_FILE_PATTERN.test(file)) return null;
      byPath.set(item["path"], { existed: true, file });
    } else {
      byPath.set(item["path"], { existed: false });
    }
  }
  return byPath;
}

type Text = { readonly text: string } | { readonly unavailable: ChangedFileUnavailable };

async function originalOf(change: ChangedPath, index: Map<string, IndexEntry> | null, dir: string): Promise<Text> {
  const entry = index?.get(change.path);
  if (entry === undefined || !entry.existed || entry.file === undefined || change.before === null) return { unavailable: "snapshot_missing" };
  let bytes: Buffer;
  try {
    const file = path.join(dir, entry.file);
    if ((await lstat(file)).size > MAX_READ_BYTES) return { unavailable: "too_large" };
    bytes = await readFile(file);
  } catch {
    return { unavailable: "snapshot_missing" };
  }
  if (sha256(bytes) !== change.before) return { unavailable: "snapshot_missing" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) };
  } catch {
    return { unavailable: "not_text" };
  }
}

/**
 * Builds the changes view for a run whose workspace root (`workspaceRoot`, absolute) and current
 * secrets (`privacy`) are known.
 */
export async function readChanges(
  workspaceRoot: string,
  runId: string,
  privacy: PrivacyGateway,
  platform: NodeJS.Platform,
): Promise<AppCallOutcome<ChangesOutput>> {
  if (!RUN_ID_PATTERN.test(runId) || runId.includes("..")) {
    return { ok: false, error: appError("invalid_arguments", "the run id must be 1-128 characters of letters, digits, '.', '_' and '-'") };
  }
  let workspace;
  try {
    workspace = await createWorkspace({ root: workspaceRoot });
  } catch {
    return { ok: false, error: appError("workspace_not_found", "the workspace is not an existing directory") };
  }
  const runDir = path.join(workspace.root, STATE_DIR_NAME, RUNS_DIR_NAME, runId);
  const fold = (value: string): string => (platform === "win32" ? value.toLowerCase() : value);
  try {
    if (fold(await realpath(runDir)) !== fold(runDir)) {
      return { ok: false, error: appError("invalid_run_record", "the run directory is a link; only the workspace's own records are read") };
    }
  } catch {
    return { ok: false, error: appError("run_not_found", "the workspace has no records for that run id") };
  }

  let journal: string;
  try {
    const file = path.join(runDir, JOURNAL_FILE_NAME);
    if ((await lstat(file)).size > MAX_REPORT_FILE_BYTES) {
      return { ok: false, error: appError("invalid_run_record", `a run file is larger than ${MAX_REPORT_FILE_BYTES} bytes`) };
    }
    journal = await readFile(file, "utf8");
  } catch {
    return { ok: false, error: appError("run_not_found", "the workspace has no journal for that run id") };
  }
  let changes: ChangedPath[];
  try {
    changes = changedPaths(journal, runId);
  } catch {
    return { ok: false, error: appError("invalid_run_record", "the run's journal cannot be read") };
  }

  const snapshots = path.join(runDir, SNAPSHOTS_DIR_NAME);
  const index = await readIndex(snapshots);
  const mask = (text: string): MaskedText | null => {
    try {
      const masked = privacy.mask(text);
      return masked.ok ? masked.text : null;
    } catch {
      return null;
    }
  };

  const files: ChangedFileView[] = [];
  for (const change of changes) {
    const shownPath = mask(change.path);
    // A path that cannot be masked is not shown, and no partial list is returned in its place.
    if (shownPath === null) return { ok: false, error: appError("internal_error", "the changes could not be masked") };
    const created = change.before === null;
    if (TOKEN_FRAGMENT.test(change.path)) {
      files.push({ path: shownPath, created, state: "unknown", before: null, after: null, unavailable: "masked_path" });
      continue;
    }

    let state: ChangedFileView["state"] = "unknown";
    let current: Text | null = null;
    const resolved = await workspace.resolve(change.path, "read");
    if (resolved.ok) {
      const read = await workspace.readText(resolved.path);
      if (read.ok) {
        state = read.snapshot.hash === change.after ? "as_run_left" : "changed_since_run";
        current = { text: read.snapshot.text };
      } else if (read.code === "not_found") {
        state = "missing";
      } else {
        current = { unavailable: read.code === "io_error" ? "unreadable" : read.code };
      }
    } else {
      current = { unavailable: "unreadable" };
    }
    const original: Text | null = created ? null : await originalOf(change, index, snapshots);

    let unavailable: ChangedFileUnavailable | null = null;
    let before: MaskedText | null = null;
    let after: MaskedText | null = null;
    if (original !== null) {
      if ("text" in original) before = mask(original.text);
      else unavailable = original.unavailable;
    }
    if (current !== null) {
      if ("text" in current) after = mask(current.text);
      else unavailable ??= current.unavailable;
    }
    if ((original !== null && "text" in original && before === null) || (current !== null && "text" in current && after === null)) {
      before = null;
      after = null;
      unavailable = "mask_failed";
    }
    if ((before !== null || after !== null) && !textMaskingRecorded(change)) {
      before = null;
      after = null;
      unavailable = "masking_unverified";
    }
    files.push({ path: shownPath, created, state, before, after, unavailable });
  }
  return { ok: true, output: { kind: "changes", runId, masking: "current_secrets", files } };
}
