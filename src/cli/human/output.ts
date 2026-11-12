/**
 * `createHumanOutput` (CreateHumanOutput, cli-contract 17.4): command outputs as text for people.
 * The words come from the MessageCatalog (N-B); this module owns only the layout: the prefix,
 * separators, line breaks, the code in parentheses after the words, list limits and columns.
 *
 * N-14: a message parameter is only ever a number, a closed code, a schema field position, a run
 * id, the fixed config display, or text of the same catalog. Every value taken from an output or
 * a record is checked against its list or pattern before it becomes a parameter, so a changed
 * record cannot put free text into a message. Masked paths that outputs and records already carry
 * are printed as items after a message (as `report` prints them); nothing else is.
 *
 * Every line passes through `finalLine` (control characters replaced, key shapes hidden). The CLI
 * masks the text again with the run's privacy gateway where it has one, and writes it best effort.
 * One renderer per command: `progressLine` numbers the verifiers it has seen.
 */

import {
  CLI_ERROR_EXIT_CODES,
  INTEGRITY_PHASES,
  MODEL_ERROR_KINDS,
  PERMISSION_KINDS,
  POLICY_DENIAL_CODES,
  REVERT_SKIP_REASONS,
  RUN_REASONS,
  RUN_TIMESTAMP_PATTERN_SOURCE,
  TERMINAL_RUN_STATUSES,
  TOOL_ERROR_CODES,
  TOOL_NAMES,
  toRunId,
  toSchemaFieldPath,
} from "../../contracts/index.js";
import type {
  CatalogText,
  CliErrorCode,
  CliErrorOutput,
  CreateHumanOutput,
  EngineResult,
  HumanOutput,
  InputDiagnostic,
  JournalEvent,
  MessageCatalog,
  ModelProviderName,
  RevertOutput,
  RunListEntry,
  RunReason,
  RunSummaryContext,
  RunsOutput,
  SchemaFieldPath,
  TerminalRunStatus,
  ToolName,
} from "../../contracts/index.js";
import { displayWidth, finalLine, formatLocalTime, padEnd, shownPath, token } from "./format.js";

/** As PROGRESS_PREFIX in ../progress.ts. Error and revert titles start with it. */
export const HUMAN_PREFIX = "codaryn: ";
/** Changed files listed in a run summary. The rest are counted. */
export const SUMMARY_MAX_PATHS = 5;
/** Files listed per group in a revert summary. The rest are counted. */
export const REVERT_MAX_LISTED = 20;
/** Shown in place of a path that may not be printed (a `missing_record` path is unmasked). */
export const HIDDEN_PATH = "?";

const DOCTOR_COMMAND = "codaryn doctor";

/** Errors whose cause `codaryn doctor` can check (N-22). */
const DOCTOR_CODES: ReadonlySet<CliErrorCode> = new Set<CliErrorCode>([
  "invalid_config",
  "invalid_task",
  "key_in_file",
  "secret_env_missing",
  "workspace_is_install_dir",
  "provider_not_configured",
  "model_list_failed",
]);

const RUN_TIMESTAMP = new RegExp(RUN_TIMESTAMP_PATTERN_SOURCE);
const PROVIDERS: readonly ModelProviderName[] = ["scripted", "anthropic"];
const OUTCOMES = ["pass", "fail", "inconclusive"] as const;
const REASONS_BY_STATUS: { readonly [S in TerminalRunStatus]: readonly RunReason[] } = {
  done: ["verified"],
  failed: ["verifier_failed", "model_error", "repeated_failure"],
  "needs-input": ["verifier_inconclusive", "no_verifier", "unknown_tool_outcome", "protected_changed"],
  cancelled: ["cancelled"],
  "budget-exhausted": ["max_model_turns", "max_tool_calls", "max_total_tokens", "max_duration", "usage_unknown"],
};

function isOneOf<T extends string>(value: unknown, list: readonly T[]): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

function isCount(value: unknown, min = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}

function validStatusReason(status: unknown, reason: unknown): { status: TerminalRunStatus; reason: RunReason } | null {
  if (!isOneOf(status, TERMINAL_RUN_STATUSES) || !isOneOf(reason, RUN_REASONS)) return null;
  return REASONS_BY_STATUS[status].includes(reason) ? { status, reason } : null;
}

function localTime(at: unknown): string | null {
  if (typeof at !== "string" || !RUN_TIMESTAMP.test(at)) return null;
  const time = Date.parse(at);
  return Number.isFinite(time) ? formatLocalTime(time) : null;
}

/** "(+3)" after a cut list. */
function moreLine(count: number): string {
  return `  … (+${count})`;
}

/**
 * The code in parentheses after a title. A title that introduces a list ends with a colon in some
 * languages; the code then goes before the colon, so the colon still leads into the list.
 */
function withCode(title: string, code: string): string {
  return title.endsWith(":") ? `${title.slice(0, -1)} (${code}):` : `${title} (${code})`;
}

function lines(out: readonly string[]): string {
  return `${out.map(finalLine).join("\n")}\n`;
}

export const createHumanOutput: CreateHumanOutput = (catalog: MessageCatalog): HumanOutput => {
  const verifierNumbers = new Map<string, number>();

  const toolText = (name: string): CatalogText =>
    isOneOf<ToolName>(name, TOOL_NAMES) ? catalog.format(`tool.${name}`) : catalog.format("progress.unknown_tool");

  function diagnosticText(diagnostic: InputDiagnostic): string | null {
    const file = isOneOf(diagnostic.file, ["config", "task", "script"] as const) ? diagnostic.file : null;
    if (file === null) return null;
    const fileText = catalog.format(`diagnostic.file.${file}`);
    const field: SchemaFieldPath | null =
      (typeof diagnostic.field === "string" ? toSchemaFieldPath(diagnostic.field) : null) ?? toSchemaFieldPath(file);
    let text: CatalogText | null = null;
    switch (diagnostic.code) {
      case "json_syntax":
        if (isCount(diagnostic.line, 1) && isCount(diagnostic.column, 1)) {
          text = catalog.format("diagnostic.json_syntax", { line: diagnostic.line, column: diagnostic.column });
        }
        break;
      case "unknown_field": {
        const suggestion = typeof diagnostic.suggestion === "string" ? toSchemaFieldPath(diagnostic.suggestion) : null;
        if (field !== null) {
          text =
            suggestion === null
              ? catalog.format("diagnostic.unknown_field", { field })
              : catalog.format("diagnostic.unknown_field_suggest", { field, suggestion });
        }
        break;
      }
      case "invalid_value":
        if (field !== null) text = catalog.format("diagnostic.invalid_value", { field });
        break;
      case "missing_field":
        if (field !== null) text = catalog.format("diagnostic.missing_field", { field });
        break;
      case "too_deep":
        text = catalog.format("diagnostic.too_deep");
        break;
    }
    // A dash, not a colon: the diagnostic text often has a colon of its own.
    return text === null ? null : `${fileText} — ${text}`;
  }

  return {
    error(output: CliErrorOutput): string {
      const label = catalog.format("error.label");
      const code = output.code;
      if (!Object.prototype.hasOwnProperty.call(CLI_ERROR_EXIT_CODES, code)) {
        return lines([`${HUMAN_PREFIX}${label} (${token(code)})`]);
      }
      const out = [`${HUMAN_PREFIX}${label} — ${catalog.format(`error.${code}.what`)} (${code})`];
      const diagnostic = output.diagnostic === undefined ? null : diagnosticText(output.diagnostic);
      if (diagnostic !== null) out.push(`  ${diagnostic}`);
      const fix = catalog.format(`error.${code}.fix`);
      out.push(`  ${catalog.format("error.fix_label")}: ${fix}`);
      // Command names are English in every catalog, so a fix that already names doctor is enough.
      if (DOCTOR_CODES.has(code) && !fix.includes(DOCTOR_COMMAND)) out.push(`  ${catalog.format("error.doctor_hint")}`);
      return lines(out);
    },

    runSummary(result: EngineResult, context: RunSummaryContext): string {
      const pair = validStatusReason(result.status, result.reason);
      const out: string[] = [];
      if (pair !== null) {
        const heading = catalog.format("summary.result", {
          status: catalog.format(`status.${pair.status}`),
          reason: catalog.format(`reason.${pair.reason}`),
        });
        out.push(`── ${heading} (${pair.status}/${pair.reason}) ──`);
      } else {
        out.push(`── ? (${token(result.status)}/${token(result.reason)}) ──`);
      }

      // One labelled fact per line: the catalog's own texts use " · " inside a fact (usage).
      const verifiers = Array.isArray(result.verifiers) ? result.verifiers : [];
      const changes = Array.isArray(result.changes) ? result.changes : [];
      const passed = verifiers.filter((verifier) => verifier.outcome === "pass").length;
      out.push(
        verifiers.length === 0
          ? catalog.format("summary.no_verifiers")
          : catalog.format("summary.verifiers", { passed, total: verifiers.length }),
      );
      // N-23(d): files, not change records. A path's first record says whether the run created it.
      const files = new Map<string, boolean>();
      for (const change of changes) {
        const key = String(change.path);
        if (!files.has(key)) files.set(key, change.created === true);
      }
      out.push(catalog.format("summary.changes", { count: files.size }));
      for (const [file, created] of [...files].slice(0, SUMMARY_MAX_PATHS)) {
        const word = catalog.format(created ? "progress.file_created" : "progress.file_changed");
        out.push(`  ${shownPath(file)} (${word})`);
      }
      if (files.size > SUMMARY_MAX_PATHS) out.push(moreLine(files.size - SUMMARY_MAX_PATHS));

      const denied = isCount(context.deniedToolCalls) ? context.deniedToolCalls : 0;
      if (denied > 0) {
        out.push(catalog.format("summary.denied", { count: denied }));
        out.push(catalog.format("summary.denied_hint"));
      }
      const usage = result.usage;
      if (isCount(usage?.modelTurns) && isCount(usage.toolCalls) && isCount(usage.durationMs)) {
        out.push(catalog.format("summary.usage", { turns: usage.modelTurns, toolCalls: usage.toolCalls, durationMs: usage.durationMs }));
      }
      if (context.configDefault !== null) out.push(catalog.format("summary.config_default", { location: context.configDefault }));
      if (context.profileApplied) out.push(catalog.format("summary.profile_applied"));
      if (pair !== null) out.push(catalog.format(`advice.${pair.reason}`));

      const runId = toRunId(result.runId);
      if (runId !== null) {
        const here = context.workspaceForm === "current";
        out.push(catalog.format("summary.run_id", { runId }));
        out.push(catalog.format(here ? "summary.next_report_here" : "summary.next_report", { runId }));
        if (changes.length > 0) out.push(catalog.format(here ? "summary.next_revert_here" : "summary.next_revert", { runId }));
      }
      return lines(out);
    },

    progressLine(event: JournalEvent): string | null {
      let line: string | null;
      switch (event.type) {
        case "run_started":
          line = isOneOf(event.provider, PROVIDERS) ? catalog.format("progress.run_started", { provider: event.provider }) : null;
          break;
        case "model_request":
          line = isCount(event.turn) ? catalog.format("progress.turn", { turn: event.turn }) : null;
          break;
        case "model_error":
          line =
            isCount(event.turn) && isOneOf(event.kind, MODEL_ERROR_KINDS)
              ? catalog.format("progress.model_error", { turn: event.turn, kind: event.kind })
              : null;
          break;
        case "tool_decision": {
          const tool = toolText(event.tool);
          const name = isOneOf<ToolName>(event.tool, TOOL_NAMES) ? event.tool : "?";
          if (event.allowed) {
            line = `${catalog.format("progress.tool_allowed", { tool })} (${name})`;
          } else if (isOneOf(event.permission, PERMISSION_KINDS) && (isOneOf(event.code, POLICY_DENIAL_CODES) || isOneOf(event.code, TOOL_ERROR_CODES))) {
            line = catalog.format("progress.tool_denied", { tool, permission: event.permission, code: event.code });
          } else {
            line = `${tool} (${token(event.permission ?? "check")}/${token(event.code ?? "none")})`;
          }
          break;
        }
        case "file_changed":
          line = `${catalog.format(event.created ? "progress.file_created" : "progress.file_changed")} ${shownPath(String(event.path))}`;
          break;
        case "verifier_result": {
          const id = String(event.result.id);
          let number = verifierNumbers.get(id);
          if (number === undefined) {
            number = verifierNumbers.size + 1;
            verifierNumbers.set(id, number);
          }
          const outcome = event.result.outcome;
          line = isOneOf(outcome, OUTCOMES)
            ? `${catalog.format("progress.verifier", { number, outcome: catalog.format(`outcome.${outcome}`) })} (${outcome})`
            : null;
          break;
        }
        case "repair_started":
          line =
            isCount(event.attempt, 1) && Array.isArray(event.failedVerifiers)
              ? catalog.format("progress.repair", { attempt: event.attempt, count: event.failedVerifiers.length })
              : null;
          break;
        case "integrity_checked":
          if (!isOneOf(event.phase, INTEGRITY_PHASES) || !Array.isArray(event.changed)) {
            line = null;
          } else {
            line =
              event.changed.length === 0
                ? catalog.format("progress.integrity_unchanged", { phase: event.phase })
                : catalog.format("progress.integrity_changed", { phase: event.phase, count: event.changed.length });
          }
          break;
        case "run_finished": {
          const pair = validStatusReason(event.status, event.reason);
          line = pair === null ? null : catalog.format("progress.finished", { status: catalog.format(`status.${pair.status}`), reason: pair.reason });
          break;
        }
        case "model_response":
        case "tool_result":
          line = null;
          break;
      }
      return line === null ? null : finalLine(line);
    },

    revertSummary(output: RevertOutput): string {
      const reverted = Array.isArray(output.reverted) ? output.reverted : [];
      const skipped = Array.isArray(output.skipped) ? output.skipped : [];
      const title = output.dryRun === true ? "revert.dry_run_title" : "revert.done_title";
      // Each title is followed by its own list: reverted files, then skipped files.
      const out = [`${HUMAN_PREFIX}${withCode(catalog.format(title, { count: reverted.length }), token(output.status))}`];
      for (const file of reverted.slice(0, REVERT_MAX_LISTED)) {
        const action: unknown = file.action;
        const word = isOneOf(action, ["restored", "deleted"] as const) ? catalog.format(`revert.action.${action}`) : "?";
        out.push(`  ${shownPath(String(file.path))} — ${word}`);
      }
      if (reverted.length > REVERT_MAX_LISTED) out.push(moreLine(reverted.length - REVERT_MAX_LISTED));
      if (skipped.length > 0) out.push(catalog.format("revert.skipped_title", { count: skipped.length }));
      for (const file of skipped.slice(0, REVERT_MAX_LISTED)) {
        const reason: unknown = file.reason;
        const word = isOneOf(reason, REVERT_SKIP_REASONS) ? catalog.format(`revert.skip.${reason}`) : "?";
        // A missing_record path comes from the snapshot index unmasked (SkippedFile): not printed.
        const shown = reason === "missing_record" ? HIDDEN_PATH : shownPath(String(file.path));
        out.push(`  ${shown} — ${word} (${token(reason)})`);
      }
      if (skipped.length > REVERT_MAX_LISTED) out.push(moreLine(skipped.length - REVERT_MAX_LISTED));

      const before = output.revertedBefore;
      if (before !== undefined) {
        const time = localTime(before.at);
        const status = isOneOf(before.status, ["complete", "partial"] as const) ? before.status : null;
        if (status !== null) out.push(`${catalog.format("revert.reverted_before")} (${status}${time === null ? "" : `, ${time}`})`);
      }
      if (output.dryRun === true) out.push(catalog.format("revert.dry_run_next"));
      return lines(out);
    },

    runsText(output: RunsOutput): string {
      const runs: readonly RunListEntry[] = Array.isArray(output.runs) ? output.runs : [];
      const omitted = isCount(output.omitted) ? output.omitted : 0;
      if (runs.length === 0 && omitted === 0) return lines([catalog.format("runs.empty")]);

      const rows: string[][] = [
        [
          catalog.format("runs.column.run_id"),
          catalog.format("runs.column.started"),
          catalog.format("runs.column.changes"),
          catalog.format("runs.column.status"),
        ],
      ];
      for (const entry of runs) {
        const runId = toRunId(String(entry.runId)) ?? "?";
        if (entry.state !== "checked") {
          rows.push([runId, "-", "-", catalog.format("runs.damaged")]);
          continue;
        }
        const pair = validStatusReason(entry.status, entry.reason);
        let status = pair === null ? catalog.format("runs.incomplete") : `${catalog.format(`status.${pair.status}`)} (${pair.status}/${pair.reason})`;
        if (entry.reverted !== null && isOneOf(entry.reverted.status, ["complete", "partial"] as const)) {
          status += ` · ${catalog.format("runs.reverted")} (${entry.reverted.status})`;
        }
        rows.push([runId, localTime(entry.startedAt) ?? "?", isCount(entry.changes) ? String(entry.changes) : "-", status]);
      }
      // Every column but the last is padded to its widest cell (Hangul counts two columns).
      const widths = [0, 1, 2].map((column) => Math.max(...rows.map((row) => displayWidth(finalLine(row[column] ?? "")))));
      const out = rows.map((row) =>
        row
          .map((cell, column) => (column < 3 ? padEnd(finalLine(cell), widths[column] ?? 0) : finalLine(cell)))
          .join("  ")
          .trimEnd(),
      );
      if (omitted > 0) out.push(catalog.format("runs.omitted", { count: omitted }));
      return lines(out);
    },
  };
};
