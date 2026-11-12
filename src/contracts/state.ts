/**
 * DR-38 (R-24 L-1, DR-37 (b)): detecting changes to Codaryn's own records during a run. The run's
 * records (journal, snapshots, the `shown` digests, plan and other records) are what `report`,
 * `changes` and `revert` trust. The model's file tools cannot write the state directory, but a
 * command the policy allows, a command verifier, or a child they leave running can. The engine
 * therefore fingerprints the state directory around each command and each verification round and
 * at the end, and stops the run when something other than the run itself changed it. This is
 * detection after the fact (it undoes nothing) and covers the run's own commands only: another
 * process of the same user before or after the run remains a known limit (DR-37 (b)).
 */

import type { MaskedText, RawText } from "./text.js";

/** When the engine checks (EngineDeps.stateGuard). */
export const STATE_CHECK_PHASES = ["run_start", "before_command", "after_command", "before_verify", "after_verify", "run_end"] as const;
export type StateCheckPhase = (typeof STATE_CHECK_PHASES)[number];

/**
 * The two parts of the state directory a fingerprint covers (store design 1.3):
 * - "run": the current run's records: its run directory, its discarded-files folder and the lock
 *   file. Small, so it is checked around every command too.
 * - "state": the rest of the state directory: other runs and their folders, parked files, the
 *   top-level files. The run writes nothing there.
 */
export const STATE_TIERS = ["run", "state"] as const;
export type StateTier = (typeof STATE_TIERS)[number];

/** Most entries one fingerprint lists. */
export const MAX_STATE_ENTRIES = 20_000;
/** Most bytes one fingerprint hashes (the record files whose SHA-256 it takes). */
export const MAX_STATE_HASH_BYTES = 32 * 1024 * 1024;

declare const stateFingerprintBrand: unique symbol;
/**
 * A local-only fingerprint of one tier, made by the store: for each entry below the state directory
 * (links not followed) its path, kind, file id, size and change times, and the SHA-256 of the
 * record files the views trust. Opaque to the engine; never recorded, printed or sent.
 */
export type StateFingerprint = { readonly tier: StateTier; readonly [stateFingerprintBrand]: "stateFingerprint" };

export interface StateComparison {
  /**
   * Paths relative to the state directory, `/` separated, sorted in code unit order, no
   * duplicates, that changed from `before` to `after` other than by the run's own writes. Local
   * text: the engine masks them before they are recorded. For tier "run" a path that could not be
   * fingerprinted is listed too (fail closed, like an `unchecked` integrity entry).
   */
  readonly changed: readonly RawText[];
  /**
   * Tier "state" only: part of it could not be fingerprinted (MAX_STATE_ENTRIES, MAX_STATE_HASH_BYTES
   * or a read error). That part is not a change; the run goes on and the check records it (DR-38).
   */
  readonly limited: boolean;
}

/**
 * Made by the store together with the run's journal and recorders (the same writer), so it knows
 * what the run itself wrote between two fingerprints: the journal lines it appended (their bytes and
 * hash) and the snapshot, `shown`, plan and other record files it created. Those are not changes.
 */
export interface StateGuard {
  /** Fingerprints `tier` as it is now. Never rejects for a file-level problem. */
  capture(tier: StateTier): Promise<StateFingerprint>;
  /** What changed from `before` to `after` (both of one tier) other than by the run. Reads nothing. */
  compare(before: StateFingerprint, after: StateFingerprint): StateComparison;
  /**
   * Marks the current run and every run whose records are among `changed` as records-changed
   * (RECORDS_CHANGED_FILE_NAME). `changed` is masked, as recorded. Rejects only when nothing could
   * be written; the engine then still ends the run as `failed`/`state_changed`.
   */
  markRecordsChanged(changed: readonly MaskedText[]): Promise<void>;
}

/**
 * `runs/<runId>/records-changed.json`: the run's records were changed by something other than the
 * run that wrote them. Created exclusively; a later detection replaces it with the joined list.
 * How the views treat a marked run (DR-38 P-3, DR-39 P-5):
 * - `changes` (readRunOriginals): no `shown`, so no text of the run's files is shown, only paths and
 *   states (R-24 L-1 closed for changes made during a run).
 * - `runs` (listRuns), `report`: a mark on the entry (`recordsChanged`).
 * - `revert`: not refused (its snapshot and digest checks still apply); the output says so.
 * - cleanup: not blocked; a warning (`records_changed`).
 * - A mark file that cannot be read or checked counts as a mark (fail closed).
 */
export const RECORDS_CHANGED_FILE_NAME = "records-changed.json";

export interface RecordsChangedMark {
  readonly schemaVersion: 1;
  readonly kind: "records_changed";
  readonly runId: string;
  /** Oldest first. */
  readonly detections: readonly {
    /** The run whose check found the change. */
    readonly detectedBy: string;
    /** RUN_TIMESTAMP_PATTERN_SOURCE. */
    readonly at: string;
    /** Masked paths relative to the state directory. */
    readonly paths: readonly MaskedText[];
  }[];
}
