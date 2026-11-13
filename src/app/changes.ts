/**
 * DR-7, DR-29: the changes of one run for an adapter's comparison view, masked again.
 *
 * - Secrets: the ones a run with the same settings registers now (secretEnv of the task and the
 *   config file, the current key, values the variables file sets). They come from the CLI's own
 *   steps 1 to 7 as a reading command (see `readingSecrets` in app.ts; U-17: the quick form needs
 *   no key, model or run limits), so nothing here decides what is a secret.
 * - U-16 (UXM-4): an apply run's view carries `applyRun` (its plan run and the actions it applied,
 *   from the run list), since its moves and discards are no file writes of its own.
 * - U-43 (DR-38): a run with a records-changed mark carries `recordsChanged: true`, judged by the
 *   store's hasRecordsChangedMark (as `report` and `revert` judge it); a mark that cannot be checked
 *   counts (fail closed). The store gives such a run no `shown` record, so its files have their path
 *   and state only (`masking_unverified`); the mark says why.
 * - The run: judged first as the run list, `report` and `revert` judge it (R-14 L-1). Its changed
 *   paths, originals and DR-29 record come from the store's `readRunOriginals` (DR-14: it replaced
 *   this module's own reading of the snapshot layout) with the same checks `revertRun` applies.
 * - Current files: read through the workspace (links resolved, root and state directory enforced).
 * - DR-29, DR-32 (c): a file's masked texts are shown only when the secrets registered now mask them
 *   as the run did: the digests of the original and of the current text, masked now, computed as
 *   the run computed them (SHA-256 of maskedPartsEncoding(maskedParts(masked text))), must give
 *   `changeShownMatches` true with the run's record, and the file must still be what the run left.
 *   Otherwise (other secrets, the file changed since, a run from before DR-29 without the record, a
 *   record that fails the store's checks) only its path and state are given (AC-D13), with
 *   `masking_unverified` where a text would otherwise have been shown.
 *
 * Only masked text leaves this module. Reads only; no lock (like `report`).
 */

import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import {
  JOURNAL_FILE_NAME,
  MAX_REPORT_FILE_BYTES,
  PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE,
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
  changeShownMatches,
  maskedParts,
  maskedPartsEncoding,
} from "../contracts/index.js";
import type { ChangeNow, ChangesApplyRun, ContentHash, ListRuns, MaskedText, PrivacyGateway, ReadRunOriginals, RunOriginal, Workspace } from "../contracts/index.js";
import { RevertRunError, hasRecordsChangedMark, inspectRun, listRuns, readRunOriginals } from "../store/index.js";
import type { RunInspection } from "../store/index.js";
import { createWorkspace } from "../workspace/index.js";
import { RUN_ID_PATTERN } from "../cli/args.js";
import { appError } from "./errors.js";
import type { AppCallOutcome, ChangedFileUnavailable, ChangedFileView, ChangesOutput } from "./types.js";

const TOKEN_FRAGMENT = new RegExp(PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE, "i");

/** DR-32 (c): the digest of a masked text's visible parts, as the writing tool computes it. */
export function partsDigest(masked: string): ContentHash {
  return createHash("sha256").update(maskedPartsEncoding(maskedParts(masked)), "utf8").digest("hex") as ContentHash;
}

export interface ReadChangesDeps {
  /** The store's run judgement (R-14 L-1). */
  readonly inspect?: (workspaceRoot: string, runId: string) => Promise<RunInspection>;
  /** The store's originals and DR-29 records. */
  readonly readOriginals?: ReadRunOriginals;
  /** U-16: the store's run list, which says whether the run is an apply run and of which plan run. */
  readonly listRuns?: ListRuns;
  /** U-43: the store's records-changed mark check (hasRecordsChangedMark). */
  readonly recordsChanged?: (workspaceRoot: string, runId: string) => Promise<boolean>;
  /**
   * U-234 (R-107 O-1): the caller's signal, given to every read of a current file. Since U-213 a read
   * in a burst of changes waits between its tries (GUARD_PAUSES_MS); an aborted signal ends the wait
   * and starts no try more, and the file is then unreadable, as a read whose tries ran out.
   */
  readonly signal?: AbortSignal;
  /** Tests only: the workspace of `root` (createWorkspace when absent). */
  readonly createWorkspace?: (root: string) => Promise<Workspace>;
}

/**
 * U-16 (UXM-4): the plan run an apply run applied and how many actions it applied, as the run list
 * gives them (its entry's `kind`, `planRunId` and `changes`, the applied actions). Null for a run
 * that is not an apply run, and for an apply whose result is not there yet.
 */
async function applyRunOf(workspaceRoot: string, runId: string, list: ListRuns): Promise<ChangesApplyRun | null> {
  const listing = await list({ workspaceRoot });
  const entry = listing.runs.find((run) => run.state === "checked" && run.runId === runId);
  if (entry === undefined || entry.state !== "checked" || entry.kind !== "apply") return null;
  if (entry.planRunId === undefined || entry.changes === null) return null;
  return { planRunId: entry.planRunId, actions: entry.changes };
}

/**
 * Builds the changes view for a run whose workspace root (`workspaceRoot`, absolute) and current
 * secrets (`privacy`) are known.
 */
export async function readChanges(
  workspaceRoot: string,
  runId: string,
  privacy: PrivacyGateway,
  deps: ReadChangesDeps = {},
): Promise<AppCallOutcome<ChangesOutput>> {
  if (!RUN_ID_PATTERN.test(runId) || runId.includes("..")) {
    return { ok: false, error: appError("invalid_arguments", "the run id must be 1-128 characters of letters, digits, '.', '_' and '-'") };
  }
  let workspace;
  try {
    workspace = await (deps.createWorkspace ?? ((root: string) => createWorkspace({ root })))(workspaceRoot);
  } catch {
    return { ok: false, error: appError("workspace_not_found", "the workspace is not an existing directory") };
  }
  // R-14 L-1: no entry of exactly that name is run_not_found (N-27 a), a damaged run is
  // invalid_run_record (N-26, N-27 b), and nothing of it is shown.
  let judged: RunInspection;
  try {
    judged = await (deps.inspect ?? inspectRun)(workspace.root, runId);
  } catch {
    judged = "damaged";
  }
  if (judged === "missing") return { ok: false, error: appError("run_not_found", "the workspace has no records for that run id") };
  if (judged === "damaged") {
    return {
      ok: false,
      error: appError("invalid_run_record", "the run's records do not pass the checks (`codaryn runs` shows it as damaged); nothing is shown"),
    };
  }
  try {
    const journal = path.join(workspace.root, STATE_DIR_NAME, RUNS_DIR_NAME, runId, JOURNAL_FILE_NAME);
    if ((await lstat(journal)).size > MAX_REPORT_FILE_BYTES) {
      return { ok: false, error: appError("invalid_run_record", `a run file is larger than ${MAX_REPORT_FILE_BYTES} bytes`) };
    }
  } catch {
    return { ok: false, error: appError("run_not_found", "the workspace has no journal for that run id") };
  }

  let originals: RunOriginal[];
  try {
    originals = await (deps.readOriginals ?? readRunOriginals)({ workspaceRoot: workspace.root, runId });
  } catch (error) {
    if (error instanceof RevertRunError && error.code === "run_not_found") {
      return { ok: false, error: appError("run_not_found", "the workspace has no records for that run id") };
    }
    return { ok: false, error: appError("invalid_run_record", "the run's records cannot be read") };
  }

  const mask = (text: string): MaskedText | null => {
    try {
      const masked = privacy.mask(text);
      return masked.ok ? masked.text : null;
    } catch {
      return null;
    }
  };

  const files: ChangedFileView[] = [];
  for (const change of originals) {
    const shownPath = mask(change.path);
    // A path that cannot be masked is not shown, and no partial list is returned in its place.
    if (shownPath === null) return { ok: false, error: appError("internal_error", "the changes could not be masked") };
    const created = change.created;
    if (TOKEN_FRAGMENT.test(change.path)) {
      files.push({ path: shownPath, created, state: "unknown", before: null, after: null, unavailable: "masked_path" });
      continue;
    }

    let state: ChangedFileView["state"] = "unknown";
    let currentText: string | null = null;
    let currentHash: ContentHash | null = null;
    let unavailable: ChangedFileUnavailable | null = null;
    const resolved = await workspace.resolve(change.path, "read");
    if (resolved.ok) {
      // U-234 (R-107 O-1): the caller's signal ends the waits of a read in a burst (U-213).
      const read = await workspace.readText(resolved.path, deps.signal === undefined ? undefined : { signal: deps.signal });
      if (read.ok) {
        state = read.snapshot.hash === change.after ? "as_run_left" : "changed_since_run";
        currentText = read.snapshot.text;
        currentHash = read.snapshot.hash;
      } else if (read.code === "not_found") {
        state = "missing";
      } else {
        unavailable = read.code === "io_error" ? "unreadable" : read.code;
      }
    } else {
      unavailable = "unreadable";
    }

    const original = change.original;
    if (original !== null && "unavailable" in original) unavailable = original.unavailable;
    const originalText = original !== null && "text" in original ? original.text : null;
    let before = originalText === null ? null : mask(originalText);
    let after = currentText === null ? null : mask(currentText);
    if ((originalText !== null && before === null) || (currentText !== null && after === null)) {
      files.push({ path: shownPath, created, state, before: null, after: null, unavailable: "mask_failed" });
      continue;
    }

    // DR-29: the texts only when masked now as the run masked them.
    const now: ChangeNow = {
      original: before === null ? null : partsDigest(before),
      current: after === null || currentHash === null ? null : { sha256: currentHash, partsDigest: partsDigest(after) },
    };
    if (!changeShownMatches(change.shown, now)) {
      if (before !== null || after !== null) unavailable = "masking_unverified";
      before = null;
      after = null;
    } else {
      unavailable = null;
    }
    files.push({ path: shownPath, created, state, before, after, unavailable });
  }
  let applyRun: ChangesApplyRun | null;
  try {
    applyRun = await applyRunOf(workspace.root, runId, deps.listRuns ?? listRuns);
  } catch {
    return { ok: false, error: appError("invalid_run_record", "the run list cannot be read") };
  }
  // U-43 (DR-38): a mark that cannot be checked counts as one (fail closed), as the store judges it.
  let marked: boolean;
  try {
    marked = await (deps.recordsChanged ?? hasRecordsChangedMark)(workspace.root, runId);
  } catch {
    marked = true;
  }
  return {
    ok: true,
    output: {
      schemaVersion: 1,
      kind: "changes",
      runId,
      exitCode: 0,
      masking: "current_secrets",
      files,
      ...(applyRun === null ? {} : { applyRun }),
      ...(marked ? { recordsChanged: true as const } : {}),
    },
  };
}
