/**
 * Verifiers decide the final status. A model's "done" never does.
 * Nothing here assumes Git or a test runner.
 */

import type { AppliedPlanAction } from "./plan.js";
import type { MaskedText, RawText } from "./text.js";

/** Runs a user-configured command without a shell. It is task configuration, not a model request. */
export interface CommandVerifierConfig {
  readonly id: string;
  readonly kind: "command";
  readonly executable: string;
  readonly args: readonly string[];
  /** Relative to the workspace root. Defaults to ".". */
  readonly cwd?: string;
  /** Defaults to DEFAULT_COMMAND_TIMEOUT_MS. */
  readonly timeoutMs?: number;
  /** Defaults to 0. */
  readonly expectExitCode?: number;
}

export type FileRule =
  | { readonly type: "exists"; readonly path: string }
  | { readonly type: "absent"; readonly path: string }
  | { readonly type: "contains"; readonly path: string; readonly text: string }
  | { readonly type: "not_contains"; readonly path: string; readonly text: string };

/** Checks files under the workspace root with literal rules. */
export interface FileRulesVerifierConfig {
  readonly id: string;
  readonly kind: "file_rules";
  /** At least one rule. */
  readonly rules: readonly FileRule[];
}

/**
 * G-A (VF-04): literal checks on tables in the workspace, for data analysis. Tables are UTF-8
 * text: `csv` and `tsv` with a header row (RFC 4180 quoting for csv), `jsonl` with one JSON object
 * per line (its keys are the columns). A number is `-?digits[.digits][e|E[+|-]digits]`; anything
 * else in a column that needs numbers is not a number. Empty cells are skipped by every op.
 * - table_shape: the columns (`exact`: the same names in the same order; `includes`: at least
 *   these) and the number of data rows.
 * - aggregate_match: `op` over the source table's `column` (count: non-empty cells), grouped by
 *   `groupBy` when given, compared with the target table's `targetColumn`. With `groupBy` the
 *   target needs `targetKeyColumn` and exactly one row per group, and no other row. Without it the
 *   target has exactly one data row. Values agree when |a - b| <= max(absolute, relative * max(|a|, |b|)).
 * Outcomes: a source table that cannot be read or parsed, or a source value that is not a number,
 * is `inconclusive` (the model cannot fix the input); a target that cannot be parsed, a missing
 * column or row, or a disagreeing value is `fail` (the model can fix its output). Evidence names
 * columns, row numbers and the two numbers compared; it carries no other cell value.
 * Limits: only the listed shapes and aggregates are checked, not the method, the interpretation or
 * any number written in prose.
 */
export interface DataChecksVerifierConfig {
  readonly id: string;
  readonly kind: "data_checks";
  /** At least one rule. */
  readonly rules: readonly DataRule[];
}

export const TABLE_FORMATS = ["csv", "tsv", "jsonl"] as const;
export type TableFormat = (typeof TABLE_FORMATS)[number];

/** A table file, relative to the workspace root. */
export interface TableRef {
  readonly path: string;
  readonly format: TableFormat;
}

export const AGGREGATE_OPS = ["sum", "count", "min", "max", "mean"] as const;
export type AggregateOp = (typeof AGGREGATE_OPS)[number];

/** Number of data rows (the header row not counted). */
export type RowCountRule =
  | { readonly equals: number }
  | { readonly min?: number; readonly max?: number }
  /** The same number of data rows as another table. */
  | { readonly sameAs: TableRef };

export type DataRule =
  | {
      readonly type: "table_shape";
      readonly table: TableRef;
      readonly columns?: readonly string[];
      /** Default "exact". */
      readonly columnsMatch?: "exact" | "includes";
      readonly rows?: RowCountRule;
    }
  | {
      readonly type: "aggregate_match";
      readonly source: TableRef;
      readonly column: string;
      readonly op: AggregateOp;
      readonly groupBy?: string;
      readonly target: TableRef;
      readonly targetColumn: string;
      /** Required with `groupBy`, not allowed without it. */
      readonly targetKeyColumn?: string;
      /** Defaults DEFAULT_DATA_TOLERANCE. Both non-negative. */
      readonly tolerance?: { readonly absolute?: number; readonly relative?: number };
    };

/** Largest table a data check reads (16 MiB). A larger source is `inconclusive`, a larger target `fail`. */
export const MAX_DATA_TABLE_BYTES = 16 * 1024 * 1024;
export const DEFAULT_DATA_TOLERANCE = { absolute: 1e-9, relative: 1e-9 } as const;

export type VerifierConfig = CommandVerifierConfig | FileRulesVerifierConfig | DataChecksVerifierConfig;

/**
 * Verifier kinds. `inventory` (G-A, VF-05) is not configurable: every apply run makes one
 * (plan.ts, InventoryChecker) and records it like any verifier result.
 */
export const VERIFIER_KINDS = ["command", "file_rules", "data_checks", "inventory"] as const;
export type VerifierKind = (typeof VERIFIER_KINDS)[number];
/** The kinds a task or config file may list in `verifiers`. */
export const CONFIGURABLE_VERIFIER_KINDS = ["command", "file_rules", "data_checks"] as const satisfies readonly VerifierConfig["kind"][];

/**
 * pass: every check held. fail: at least one check did not hold.
 * inconclusive: the verifier could not decide (timeout, could not start, unreadable file).
 */
export type VerifierOutcome = "pass" | "fail" | "inconclusive";

/**
 * Upper bound, in UTF-8 bytes, for the evidence of one verifier result as recorded and printed
 * (T-6). The engine cuts after masking, never the verifier on raw text.
 */
export const MAX_EVIDENCE_BYTES = 8192;

/** Local result. It must be masked before it is recorded or printed. */
export interface RawVerifierResult {
  readonly id: string;
  readonly kind: VerifierKind;
  readonly outcome: VerifierOutcome;
  /**
   * Raw evidence. A verifier does not cut it (T-6): command output is passed on as the command
   * runner captured it, up to MAX_COMMAND_OUTPUT_BYTES plus the runner's capture slack per stream.
   */
  readonly evidence: RawText;
  /**
   * True when the command runner dropped output beyond its capture, so `evidence` ends at an
   * arbitrary byte. The engine then masks, drops the trailing slack where a cut secret variant
   * could remain, and only then cuts to MAX_EVIDENCE_BYTES. Absent means false.
   */
  readonly evidenceTruncated?: boolean;
  /** What was checked. Required, at least one entry. */
  readonly checked: readonly string[];
  /** What this verifier does not check. Required. An empty list states "no known limits". */
  readonly limits: readonly string[];
}

export interface VerifierResult {
  readonly id: string;
  readonly kind: VerifierKind;
  readonly outcome: VerifierOutcome;
  readonly evidence: MaskedText;
  readonly checked: readonly MaskedText[];
  readonly limits: readonly MaskedText[];
}

export interface VerifierRunner {
  /** Runs one configured verifier. Never throws for verifier-level failures. */
  run(config: VerifierConfig, signal: AbortSignal): Promise<RawVerifierResult>;
}

/** Id of the inventory result in an apply run's verifiers. */
export const INVENTORY_VERIFIER_ID = "inventory";

/**
 * G-A (VF-05, DR-6): most files and links one inventory lists, over the whole workspace. It reads
 * no content for them (paths and sizes only), so it is independent of MAX_INTEGRITY_FILES and
 * MAX_INTEGRITY_BYTES. Reaching it is found before an apply moves anything (`plan_checked`), and
 * `codaryn plan` reports it.
 */
export const MAX_INVENTORY_FILES = 100_000;

/**
 * One path of an inventory. `path` is local text (relative to the workspace root, `/` separated),
 * masked before it is recorded. `file` and `link` carry their size in bytes (a link: the length of
 * its stored target, not followed); `unchecked` is a path that could not be listed or measured.
 */
export type InventoryEntry =
  | { readonly path: RawText; readonly kind: "file" | "link"; readonly size: number }
  | { readonly path: RawText; readonly kind: "unchecked" };

/** Local-only, never recorded or sent. Directories have no entry of their own. */
export interface InventoryManifest {
  /** Sorted by `path` in code unit order, at most MAX_INVENTORY_FILES. */
  readonly entries: readonly InventoryEntry[];
  /** True when the listing stopped at MAX_INVENTORY_FILES: the manifest is incomplete. */
  readonly limitReached: boolean;
}

/**
 * G-A (VF-05): what the apply run hands the inventory check. `before` is taken in the preflight,
 * `after` once the actions are done.
 */
export interface InventoryCheckInput {
  readonly before: InventoryManifest;
  readonly after: InventoryManifest;
  /** The actions carried out, in order. */
  readonly applied: readonly AppliedPlanAction[];
  /** Real absolute path of the apply run's `.codaryn/discarded/<runId>/`. */
  readonly discardedRoot: string;
}

/**
 * G-A (VF-05, DR-6): the apply run's file inventory (`src/verify`, G-D).
 * - capture: every file and link outside the state directory with its size, links not followed,
 *   up to MAX_INVENTORY_FILES. No content is read.
 * - check: `pass` when `after` equals `before` with exactly the applied actions done, and the plan
 *   targets have their recorded SHA-256: each moved file at its new path (hashed now) with the
 *   plan's SHA-256, each discarded file gone from the workspace and present at
 *   `discardedRoot/<stored>` with the plan's SHA-256, and every other path present with the same
 *   kind and size, nothing added or removed. A difference is `fail`. An `unchecked` entry, a
 *   manifest with `limitReached`, or a target that cannot be read is `inconclusive`. Only the
 *   targets are hashed: a file outside the plan whose content changed but kept its size is not
 *   detected (stated in the result's limits). The result has `id` INVENTORY_VERIFIER_ID and kind
 *   `inventory`; evidence names paths (masked by the engine) and counts.
 */
export interface InventoryChecker {
  capture(): Promise<InventoryManifest>;
  check(input: InventoryCheckInput): Promise<RawVerifierResult>;
}
