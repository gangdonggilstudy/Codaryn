/**
 * Output objects of `codaryn report` (U-5) and `codaryn doctor` (U-6). Both print human-readable
 * text on stdout by default and these objects as one JSON line with `--json`. Errors that stop
 * either command print CliErrorOutput as one JSON line, as `run` and `revert` do.
 */

import type { FileChangeRecord, EngineResult, RunReason, TerminalRunStatus } from "./engine.js";
import type { IntegrityPhase } from "./integrity.js";
import type { Limits, ModelProviderName } from "./task.js";
import type { MaskedText } from "./text.js";
import type { VerifierResult } from "./verify.js";

/**
 * `codaryn report --workspace <dir> --run <runId> [--json]` reads
 * `<root>/.codaryn/runs/<runId>/result.json` and `journal.jsonl` and nothing else. Both hold
 * masked text only, and the report uses nothing but them. It changes nothing and takes no lock.
 *
 * - complete: result.json and the journal were both read.
 * - incomplete: the run has no result.json (it is still running, or it stopped without writing
 *   one). The report is built from the journal alone, and a last journal line without its line
 *   feed is ignored as not yet written.
 *
 * Errors: `invalid_arguments`; `workspace_not_found`; `run_not_found` (no journal for that run);
 * `invalid_run_record` (a file cannot be read or parsed, is larger than MAX_REPORT_FILE_BYTES, or
 * names another run). The report is only as reliable as these files: commands allowed during the
 * run could have changed them, since the state directory is closed to the file tools only.
 */
export const REPORT_EXIT_CODES = { complete: 0, incomplete: 3 } as const;
export type ReportStatus = keyof typeof REPORT_EXIT_CODES;

/** Largest result.json or journal.jsonl the report reads (256 MiB). Larger is `invalid_run_record`. */
export const MAX_REPORT_FILE_BYTES = 256 * 1024 * 1024;

/** What the report takes from the run's journal. Every text field is masked as recorded. */
export interface ReportJournalSummary {
  /** From `run_started`. */
  readonly taskId: string;
  readonly workflow: MaskedText;
  readonly provider: ModelProviderName;
  readonly limits: Limits;
  /** Number of records read. */
  readonly records: number;
  /** `model_request` records. */
  readonly modelRequests: number;
  /** `tool_decision` records with `allowed: false`. */
  readonly deniedToolCalls: number;
  /** `repair_started` records. */
  readonly repairs: number;
  /** `verifier_result` records after the last `repair_started` (all of them when there was no repair). */
  readonly lastRound: readonly VerifierResult[];
  /** `file_changed` records in order, without `callId`. */
  readonly changes: readonly FileChangeRecord[];
  /** `integrity_checked` records in order. Empty when the run had no integrity check. */
  readonly integrityChecks: readonly { readonly phase: IntegrityPhase; readonly changed: readonly MaskedText[] }[];
  /** From `run_finished`, or null when the journal has none. */
  readonly finished: { readonly status: TerminalRunStatus; readonly reason: RunReason } | null;
}

/** Printed by `codaryn report --json`. Without `--json` the same content is printed as Markdown. */
export interface ReportOutput {
  readonly schemaVersion: 1;
  readonly kind: "report";
  readonly runId: string;
  readonly status: ReportStatus;
  readonly exitCode: number;
  /** The run's result.json, or null when it has none (`incomplete`). */
  readonly result: EngineResult | null;
  readonly journal: ReportJournalSummary;
}

/**
 * `codaryn doctor [--config <file>] [--vars-file <file>] [--task <task.json>] [--workspace <dir>] [--json]`
 * checks what a run would need without running one: no network access, no model request, no
 * write. One check per id, in this order. A check that has nothing to look at is `skipped`.
 */
export const DOCTOR_CHECK_IDS = [
  "node_version",
  "config_file",
  "vars_file",
  "task_file",
  "api_key",
  "model",
  "limits",
  "file_locations",
  "commands",
  "workspace",
  "install_dir",
  "integrity_paths",
] as const;
export type DoctorCheckId = (typeof DOCTOR_CHECK_IDS)[number];

export const DOCTOR_CHECK_STATUSES = ["ok", "warn", "fail", "skipped"] as const;
export type DoctorCheckStatus = (typeof DOCTOR_CHECK_STATUSES)[number];

export interface DoctorCheck {
  readonly id: DoctorCheckId;
  readonly status: DoctorCheckStatus;
  /**
   * One line built from fixed text, field positions (such as `policy.commands[2]`) and counts.
   * Never a value read from a file or the environment: the API key is reported as present or
   * absent only, and paths, names and contents are not echoed.
   */
  readonly message: string;
}

/** `warn`: a run may work but something needs attention. `fail`: a run would stop. */
export const DOCTOR_EXIT_CODES = { ok: 0, warn: 3, fail: 1 } as const;
export type DoctorStatus = keyof typeof DOCTOR_EXIT_CODES;

/** Printed by `codaryn doctor --json`. Without `--json` one text line per check. */
export interface DoctorOutput {
  readonly schemaVersion: 1;
  readonly kind: "doctor";
  /** The worst check: `fail` over `warn` over `ok`. `skipped` counts as `ok`. */
  readonly status: DoctorStatus;
  readonly exitCode: number;
  /** One per DOCTOR_CHECK_IDS entry, in that order. */
  readonly checks: readonly DoctorCheck[];
}
