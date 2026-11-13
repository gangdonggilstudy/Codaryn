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
  API_KEY_ENVS,
  API_MODEL_ENVS,
  APPLY_NOTICE_KINDS,
  APPROVAL_CHANNELS,
  CLI_ERROR_EXIT_CODES,
  CLI_ERROR_HINT_DETAIL,
  MAX_FINAL_MESSAGE_CHARS,
  CLI_ERROR_HINTS,
  DETAILED_CLI_ERROR_HINTS,
  DOCTOR_HINT_ERROR_CODES,
  INTEGRITY_PHASES,
  MODEL_ERROR_KINDS,
  PLAN_ITEM_PROBLEMS,
  PLAN_RECORDS_UNCHECKED_CAUSES,
  PERMISSION_KINDS,
  POLICY_NARROWING_KINDS,
  PROVIDER_SETTINGS,
  POLICY_DENIAL_CODES,
  REVERT_ACTIONS,
  REVERT_SKIP_REASONS,
  STATE_CHECK_PHASES,
  TERMINAL_RUN_STATUSES,
  ALL_TOOL_NAMES,
  TOOL_ERROR_CODES,
  isReasonOfStatus,
  isShownWorkspace,
  planApplyStateOf,
  toRunId,
  toSchemaFieldPath,
  MODEL_PROVIDER_NAMES,
} from "../../contracts/index.js";
import type {
  PolicyNarrowing,
  ApplyJournalEvent,
  ApplyResult,
  ApplySummaryContext,
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
  PlanApplyState,
  RevertOutput,
  RunId,
  RunListEntry,
  RunReason,
  RunSummaryContext,
  RunsOutput,
  SchemaFieldPath,
  ShownWorkspace,
  TerminalRunStatus,
  AnyToolName,
} from "../../contracts/index.js";
import { isRunTimestamp } from "../../store/index.js";
import { displayWidth, finalLine, formatLocalTime, padEnd, quoteModelText, shownPath, token } from "./format.js";

/** As PROGRESS_PREFIX in ../progress.ts. Error and revert titles start with it. */
export const HUMAN_PREFIX = "codaryn: ";
/** Changed files listed in a run summary. The rest are counted. */
export const SUMMARY_MAX_PATHS = 5;
/** Files listed per group in a revert summary. The rest are counted. */
export const REVERT_MAX_LISTED = 20;
/** Shown in place of a path that may not be printed (a `missing_record` path is unmasked). */
export const HIDDEN_PATH = "?";

/** N-22: the errors after which the error text adds `error.doctor_hint` (the contract's list). */
const DOCTOR_CODES: ReadonlySet<string> = new Set<string>(DOCTOR_HINT_ERROR_CODES);

// SP-1: the contract's provider names, not a list of its own.
const PROVIDERS: readonly ModelProviderName[] = MODEL_PROVIDER_NAMES;
const WORKSPACE_FORMS = ["current", "given", "task"] as const;
/** EngineResult.plan.digest in its only valid form. */
const DIGEST = /^[0-9a-f]{64}$/;
/** Plan problems shown in one preflight line. The rest are counted. */
const PLAN_PROBLEMS_SHOWN = 5;
/** Apply reasons after which every action was applied (verification only runs then). */
const APPLIED_ALL_REASONS: ReadonlySet<string> = new Set(["verified", "verifier_failed", "verifier_inconclusive", "protected_changed"]);
const OUTCOMES = ["pass", "fail", "inconclusive"] as const;

function isOneOf<T extends string>(value: unknown, list: readonly T[]): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

function isCount(value: unknown, min = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}

function validStatusReason(status: unknown, reason: unknown): { status: TerminalRunStatus; reason: RunReason } | null {
  if (!isOneOf(status, TERMINAL_RUN_STATUSES) || typeof reason !== "string") return null;
  // DR-16: the contract's one table of reasons per status (G-A reasons included).
  return isReasonOfStatus(status, reason) ? { status, reason } : null;
}

/** A recorded time in local wall time, or null when it is not a real timestamp (N-24(c)). */
function localTime(at: unknown): string | null {
  return isRunTimestamp(at) ? formatLocalTime(Date.parse(at)) : null;
}

/** DR-47: rows of the agent's last message shown in a run summary (quoteModelText). The rest are counted. */
export const FINAL_MESSAGE_MAX_LINES = 20;

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
  // U-18 (AXM-4): the calls of this run with a decision that was not allowed. Such a call is a denied
  // call only (its decision is its line); its failed result is not told again.
  const deniedCalls = new Set<string>();
  /**
   * U-52 (R-65 L-1, I-1): one renderer may draw several runs and applies (the GUI engine host keeps
   * one per language). What it remembers of one (the verifier numbers, the denied calls) starts
   * again at the next one's start record: call ids are unique within a run only.
   */
  // U-104 (U-99b): this run's protected-material checks: how many, how many found a change, and
  // whether the first one that found nothing was shown (the later ones are folded).
  let integrityChecks = 0;
  let integrityChanged = 0;
  let integrityUnchangedShown = false;
  const startAgain = (): void => {
    verifierNumbers.clear();
    deniedCalls.clear();
    integrityChecks = 0;
    integrityChanged = 0;
    integrityUnchangedShown = false;
  };
  /** U-104: the summary's line of the checks drawn, when there were some and none found a change. */
  const integritySummary = (): string[] =>
    integrityChecks > 0 && integrityChanged === 0 ? [catalog.format("summary.integrity_unchanged", { count: integrityChecks })] : [];

  // G-A: the workflow tools (inspect_files, propose_plan) have names for people too (ALL_TOOL_NAMES).
  const toolText = (name: string): CatalogText =>
    isOneOf<AnyToolName>(name, ALL_TOOL_NAMES) ? catalog.format(`tool.${name}`) : catalog.format("progress.unknown_tool");

  /**
   * U-18 (AXM-4, PM Q-1 (a), Q-2 (a)): what became of a call, by the rule at
   * RunSummaryContext.failedToolCalls. A failed result of a call with no "not allowed" decision is a
   * failed call (`progress.tool_failed`, its tool error code). A `run_command` result that is ok but
   * timed out, or else exited with a code other than 0, has its line; not a failed call. A result
   * that succeeded, content that does not parse, an exit code that is not a count, or a null exit
   * code without a timeout (a stopped command): no line.
   */
  const resultLine = (told: { readonly callId?: unknown; readonly tool?: unknown; readonly ok?: unknown; readonly content?: unknown; readonly errorCode?: unknown }): string | null => {
    if (told.ok === false) {
      if (deniedCalls.has(String(told.callId))) return null;
      return isOneOf(told.errorCode, TOOL_ERROR_CODES) ? catalog.format("progress.tool_failed", { tool: toolText(String(told.tool)), code: told.errorCode }) : null;
    }
    if (told.ok !== true || told.tool !== "run_command" || typeof told.content !== "string") return null;
    let payload: unknown;
    try {
      payload = JSON.parse(told.content);
    } catch {
      return null;
    }
    if (typeof payload !== "object" || payload === null) return null;
    const { exitCode, timedOut } = payload as { readonly exitCode?: unknown; readonly timedOut?: unknown };
    if (timedOut === true) return catalog.format("progress.command_timed_out");
    return isCount(exitCode, 1) ? catalog.format("progress.command_exited", { exitCode }) : null;
  };

  // U-16, R-55b M-1b: a plan run's words in the run list by what became of its apply (planApplyStateOf).
  // An unfinished apply names its reason; without one (the list pairs them, so not expected) it is `?`.
  const planApplyWords = (applyRunId: RunId, reason: RunReason | undefined): { readonly [S in PlanApplyState]: () => CatalogText } => ({
    applied: () => catalog.format("runs.plan_applied", { runId: applyRunId }),
    unfinished: () => catalog.format("runs.plan_apply_unfinished", { runId: applyRunId, reason: reason ?? ("?" as RunReason) }),
    applying: () => catalog.format("runs.plan_applying", { runId: applyRunId }),
    reverted: () => catalog.format("runs.plan_apply_reverted", { runId: applyRunId }),
    record_missing: () => catalog.format("runs.plan_apply_missing", { runId: applyRunId }),
  });

  function diagnosticText(diagnostic: InputDiagnostic): string | null {
    const file = isOneOf(diagnostic.file, ["config", "task", "script"] as const) ? diagnostic.file : null;
    if (file === null) return null;
    const fileText = catalog.format(`diagnostic.file.${file}`);
    const ownField = typeof diagnostic.field === "string" ? toSchemaFieldPath(diagnostic.field) : null;
    const field: SchemaFieldPath | null = ownField ?? toSchemaFieldPath(file);
    let text: CatalogText | null = null;
    switch (diagnostic.code) {
      case "json_syntax":
        if (isCount(diagnostic.line, 1) && isCount(diagnostic.column, 1)) {
          text = catalog.format("diagnostic.json_syntax", { line: diagnostic.line, column: diagnostic.column });
        }
        break;
      case "unknown_field": {
        // N-23(f): a suggestion belongs to the position it was made for; at the file root it misleads.
        const suggestion = ownField !== null && typeof diagnostic.suggestion === "string" ? toSchemaFieldPath(diagnostic.suggestion) : null;
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

  // G-A, DR-21: what this renderer learned from an apply's progress records, for its summary
  // (one renderer per command). ApplyResult carries neither the plan total nor the unsafe moves.
  let planTotal: number | null = null;
  let unsafeMoveCount: number | null = null;

  /** "── <status and reason in words> (status/reason) ──". */
  function heading(pair: { status: TerminalRunStatus; reason: RunReason } | null, status: unknown, reason: unknown): string {
    if (pair === null) return `── ? (${token(status)}/${token(reason)}) ──`;
    const words = catalog.format("summary.result", { status: catalog.format(`status.${pair.status}`), reason: catalog.format(`reason.${pair.reason}`) });
    return `── ${words} (${pair.status}/${pair.reason}) ──`;
  }

  /**
   * DR-51 (U-38): the typed workspace a hint shows: the context's value when it is exactly what
   * toShownWorkspace makes and the line's own cleaning (finalLine) keeps it as it is; otherwise null,
   * and the hint says `<workspace>` as before (fail closed: the path as typed, or not at all).
   */
  function typedWorkspace(value: unknown): ShownWorkspace | null {
    return isShownWorkspace(value) && finalLine(value) === value ? value : null;
  }

  /** DR-51 (U-38): for run and apply, the typed workspace with workspaceForm "given" only. */
  function givenWorkspace(context: { readonly workspaceForm: unknown; readonly workspaceShown?: unknown }): ShownWorkspace | null {
    return context.workspaceForm === "given" ? typedWorkspace(context.workspaceShown) : null;
  }

  /** How the next commands name the task form; DR-51: the typed workspace when there is one. */
  function formText(workspaceForm: unknown, workspace: ShownWorkspace | null): CatalogText {
    if (workspace !== null) return catalog.format("summary.form.typed", { workspace });
    return catalog.format(`summary.form.${isOneOf(workspaceForm, WORKSPACE_FORMS) ? workspaceForm : "given"}`);
  }

  /**
   * U-37 (R-69 M1): the lines of a hint that takes a value (DETAILED_CLI_ERROR_HINTS), from the error's
   * CLI_ERROR_HINT_DETAIL. A detail that is absent or does not fit gives no line (the contract:
   * such a hint's line is left out), and never only part of them.
   */
  function detailedHintLines(output: CliErrorOutput): string[] {
    const hint: unknown = output.hint;
    const detail: unknown = (output as { readonly [CLI_ERROR_HINT_DETAIL]?: unknown })[CLI_ERROR_HINT_DETAIL];
    if (!isOneOf(hint, DETAILED_CLI_ERROR_HINTS) || typeof detail !== "object" || detail === null) return [];
    const { position, field, missing } = detail as { readonly position?: unknown; readonly field?: unknown; readonly missing?: unknown };
    switch (hint) {
      case "unknown_option":
        return isCount(position, 1) ? [`  ${catalog.format("error.hint.unknown_option", { position })}`] : [];
      case "key_field_in_task":
      case "key_field_in_config": {
        const place = typeof field === "string" ? toSchemaFieldPath(field) : null;
        return place === null ? [] : [`  ${catalog.format(`error.hint.${hint}`, { field: place })}`];
      }
      case "provider_settings_missing": {
        const items = missingItems(missing);
        return items === null ? [] : [`  ${catalog.format("error.hint.provider_settings_missing")}`, ...items.map((item) => `    - ${item}`)];
      }
    }
  }

  /**
   * U-37: provider_settings_missing's items, one per setting not set, or null when the list does not
   * fit: not a list, empty, an item that is not one of ProviderSettingMissing's forms, or the
   * settings not in PROVIDER_SETTINGS order, each once.
   */
  function missingItems(missing: unknown): CatalogText[] | null {
    if (!Array.isArray(missing) || missing.length === 0) return null;
    const items: CatalogText[] = [];
    let last = -1;
    for (const entry of missing as readonly unknown[]) {
      if (typeof entry !== "object" || entry === null) return null;
      const { setting, keyEnv, modelEnv, field, placeholder } = entry as Record<string, unknown>;
      const order = isOneOf(setting, PROVIDER_SETTINGS) ? PROVIDER_SETTINGS.indexOf(setting) : -1;
      if (order <= last) return null;
      last = order;
      const place = typeof field === "string" ? toSchemaFieldPath(field) : null;
      if (setting === "key") {
        if (!isOneOf(keyEnv, API_KEY_ENVS)) return null;
        items.push(catalog.format("error.missing.key", { keyEnv }));
      } else if (setting === "model") {
        if (!isOneOf(modelEnv, API_MODEL_ENVS) || place === null || typeof placeholder !== "boolean") return null;
        items.push(catalog.format(placeholder ? "error.missing.model_placeholder" : "error.missing.model", { variable: modelEnv, field: place }));
      } else {
        if (place === null) return null;
        items.push(catalog.format("error.missing.output_limit", { field: place }));
      }
    }
    return items;
  }

  /** The run id, and the report and revert commands for it. DR-51: with the typed workspace when there is one. */
  function nextCommands(id: unknown, here: boolean, revertable: boolean, workspace: ShownWorkspace | null): string[] {
    const runId = toRunId(String(id));
    if (runId === null) return [];
    const report = here
      ? catalog.format("summary.next_report_here", { runId })
      : workspace !== null
        ? catalog.format("summary.next_report_typed", { runId, workspace })
        : catalog.format("summary.next_report", { runId });
    const out = [catalog.format("summary.run_id", { runId }), report];
    if (revertable) {
      out.push(
        here
          ? catalog.format("summary.next_revert_here", { runId })
          : workspace !== null
            ? catalog.format("summary.next_revert_typed", { runId, workspace })
            : catalog.format("summary.next_revert", { runId }),
      );
    }
    return out;
  }

  const output: HumanOutput = {
    error(output: CliErrorOutput): string {
      const label = catalog.format("error.label");
      const code = output.code;
      if (!Object.prototype.hasOwnProperty.call(CLI_ERROR_EXIT_CODES, code)) {
        return lines([`${HUMAN_PREFIX}${label} (${token(code)})`]);
      }
      const out = [`${HUMAN_PREFIX}${label} — ${catalog.format(`error.${code}.what`)} (${code})`];
      const diagnostic = output.diagnostic === undefined ? null : diagnosticText(output.diagnostic);
      if (diagnostic !== null) out.push(`  ${diagnostic}`);
      out.push(`  ${catalog.format("error.fix_label")}: ${catalog.format(`error.${code}.fix`)}`);
      // N-D 4: the hints are the renderer's own indented lines, so the CLI finds them and adds none.
      if (DOCTOR_CODES.has(code)) out.push(`  ${catalog.format("error.doctor_hint")}`);
      if (code === "workspace_locked") out.push(`  ${catalog.format("lock.remove_hint")}`);
      // R-12 L-2: the error's own advice (CliErrorOutput.hint), as one more indented line.
      if (isOneOf(output.hint, CLI_ERROR_HINTS)) out.push(`  ${catalog.format(`error.hint.${output.hint}`)}`);
      // U-37 (R-69 M1): or a hint that takes a value, from the error's detail.
      else out.push(...detailedHintLines(output));
      return lines(out);
    },

    runSummary(result: EngineResult, context: RunSummaryContext): string {
      const pair = validStatusReason(result.status, result.reason);
      const out: string[] = [heading(pair, result.status, result.reason)];
      // G-A: a plan waiting for approval says so first.
      const planReady = pair?.reason === "plan_pending" && result.plan !== undefined && isCount(result.plan.actions);
      if (planReady && result.plan !== undefined) out.push(catalog.format("summary.plan_ready", { actions: result.plan.actions }));
      // One labelled fact per line: the catalog's own texts use " · " inside a fact (usage).
      const verifiers = Array.isArray(result.verifiers) ? result.verifiers : [];
      const changes = Array.isArray(result.changes) ? result.changes : [];
      const passed = verifiers.filter((verifier) => verifier.outcome === "pass").length;
      // DR-5: a plan run runs no checks; the task's checks run when the plan is applied. So it says
      // nothing about checks rather than "none configured" (N-D 5th round).
      if (pair?.reason !== "plan_pending") {
        out.push(
          verifiers.length === 0
            ? catalog.format("summary.no_verifiers")
            : catalog.format("summary.verifiers", { passed, total: verifiers.length }),
        );
      }
      // U-104: the protected-material checks that found nothing, folded in the progress lines.
      out.push(...integritySummary());
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
      if (denied > 0) out.push(catalog.format("summary.denied", { count: denied }));
      // U-18 (AXM-4): the calls that ran and failed, right after the denied ones; the hints after both.
      // The field is optional: absent (a caller that does not count them) is 0, no line.
      const failed = isCount(context.failedToolCalls) ? context.failedToolCalls : 0;
      if (failed > 0) out.push(catalog.format("summary.failed", { count: failed }));
      // N-23(e): the hint is about allowing a command, so it comes only with command denials, and
      // it points where the run's policy came from.
      if (isCount(context.deniedCommandCalls) && context.deniedCommandCalls > 0) {
        out.push(catalog.format(context.policySource === "task" ? "summary.denied_hint_task" : "summary.denied_hint"));
      }
      const usage = result.usage;
      if (isCount(usage?.modelTurns) && isCount(usage.toolCalls) && isCount(usage.durationMs)) {
        // N-20: seconds with one decimal, rounded from the recorded milliseconds.
        const seconds = Math.round(usage.durationMs / 100) / 10;
        out.push(catalog.format("summary.usage", { turns: usage.modelTurns, toolCalls: usage.toolCalls, seconds }));
      }
      // DR-52 (AXM-17): whether masking worked, as two counts (EngineResult.masking): the values
      // registered, and the places masked in what was sent to the model. Never a value, a place or a
      // length. No line when the result has none, or when either is not a count.
      const masking: unknown = result.masking;
      if (typeof masking === "object" && masking !== null) {
        const { registeredValues, maskedPlaces } = masking as { registeredValues?: unknown; maskedPlaces?: unknown };
        if (isCount(registeredValues) && isCount(maskedPlaces)) {
          out.push(catalog.format("summary.masking", { registered: registeredValues, masked: maskedPlaces }));
        }
      }
      if (context.configDefault !== null) out.push(catalog.format("summary.config_default", { location: context.configDefault }));
      if (context.profileApplied) out.push(catalog.format("summary.profile_applied"));
      // DR-47 (AXM-1): the agent's last message, after the facts and before the advice. It is the
      // agent's own words: under its label, each line set apart; not for a plan run.
      const final: unknown = result.finalMessage;
      if (pair?.reason !== "plan_pending" && typeof final === "object" && final !== null) {
        const { text, truncated } = final as { text?: unknown; truncated?: unknown };
        // R-49 R49-L2: the one way text a model wrote is drawn (quoted rows, single spaces, folded here).
        const shown = typeof text === "string" && typeof truncated === "boolean" ? quoteModelText(text, FINAL_MESSAGE_MAX_LINES) : [];
        if (shown.length > 0) {
          out.push(`${catalog.format("summary.final_message")}:`);
          out.push(...shown);
          if (truncated === true) out.push(`  ${catalog.format("summary.final_message_truncated", { count: MAX_FINAL_MESSAGE_CHARS })}`);
        }
      }
      if (pair !== null) out.push(catalog.format(`advice.${pair.reason}`));

      const here = context.workspaceForm === "current";
      // DR-51 (U-38): the typed workspace in the hints, with workspaceForm "given" only.
      const workspace = givenWorkspace(context);
      out.push(...nextCommands(result.runId, here, changes.length > 0, workspace));
      // G-A: a plan waiting for approval, or a run waiting for a person's review.
      const runId = toRunId(String(result.runId));
      const form = formText(context.workspaceForm, workspace);
      if (runId !== null && planReady && result.plan !== undefined) {
        out.push(catalog.format("summary.next_plan", { form, runId }));
        out.push(catalog.format("summary.next_apply", { form, runId }));
        // Printed only in its closed form, so it can be copied into --digest.
        if (typeof result.plan.digest === "string" && DIGEST.test(result.plan.digest)) out.push(`  ${result.plan.digest}`);
      }
      if (runId !== null && pair?.reason === "awaiting_review" && result.review !== undefined && Array.isArray(result.review.checklist)) {
        const checklist = result.review.checklist;
        out.push(catalog.format("summary.review_checklist", { count: checklist.length }));
        for (const entry of checklist.slice(0, REVERT_MAX_LISTED)) out.push(`  - ${shownPath(String(entry))}`);
        out.push(catalog.format("summary.next_review", { form, runId }));
      }
      return lines(out);
    },

    progressLine(event: JournalEvent): string | null {
      // U-52: a run's or an apply's start begins a new one, well formed or not (the GUI host gives
      // every record to progressLine first, an apply's too).
      const type: unknown = (event as { readonly type?: unknown }).type;
      if (type === "run_started" || type === "apply_started") startAgain();
      let line: string | null;
      switch (event.type) {
        case "run_started": {
          line = isOneOf(event.provider, PROVIDERS) ? catalog.format("progress.run_started", { provider: event.provider }) : null;
          // DR-43 (b), DR-41: kinds and counts only. One line per record (HumanOutput.progressLine), so
          // each narrowing is one more fact of the start line.
          const given: readonly PolicyNarrowing[] = Array.isArray(event.policyNarrowings) ? event.policyNarrowings : [];
          const narrowings = given.flatMap((narrowing): string[] => {
            if (!isOneOf(narrowing.kind, POLICY_NARROWING_KINDS)) return [];
            if (narrowing.kind === "restore_path_tokens_off") return [catalog.format("progress.workflow_policy.restore_path_tokens_off")];
            return isCount(narrowing.count) && narrowing.count > 0 ? [catalog.format(`progress.workflow_policy.${narrowing.kind}`, { count: narrowing.count })] : [];
          });
          if (line !== null && narrowings.length > 0) line = [line, ...narrowings].join(" · ");
          break;
        }
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
          if (event.allowed === false) deniedCalls.add(String(event.callId));
          const tool = toolText(event.tool);
          const name = isOneOf<AnyToolName>(event.tool, ALL_TOOL_NAMES) ? event.tool : "?";
          if (event.allowed) {
            line = `${catalog.format("progress.tool_allowed", { tool })} (${name})`;
          } else if (isOneOf(event.permission, PERMISSION_KINDS) && (isOneOf(event.code, POLICY_DENIAL_CODES) || isOneOf(event.code, TOOL_ERROR_CODES))) {
            line = catalog.format("progress.tool_denied", { tool, permission: event.permission, code: event.code });
          } else if (event.permission === null && (isOneOf(event.code, POLICY_DENIAL_CODES) || isOneOf(event.code, TOOL_ERROR_CODES))) {
            // N-22: stopped by a check of the call itself (validate, restore), not by a permission.
            line = catalog.format("progress.tool_rejected", { tool, code: event.code });
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
          } else if (event.changed.length > 0) {
            // A check that found a change is never folded.
            integrityChecks += 1;
            integrityChanged += 1;
            line = catalog.format("progress.integrity_changed", { phase: event.phase, count: event.changed.length });
          } else {
            // U-104: the first check that found nothing is shown, later ones are folded into the summary.
            integrityChecks += 1;
            line = integrityUnchangedShown ? null : catalog.format("progress.integrity_unchanged", { phase: event.phase });
            integrityUnchangedShown = true;
          }
          break;
        case "state_checked":
          // DR-38, U-8 (R-39 L-1): a change (the count only), or a check that could not cover the whole
          // state directory; a complete check that found nothing gets no line.
          if (!isOneOf(event.phase, STATE_CHECK_PHASES) || !Array.isArray(event.changed) || typeof event.limited !== "boolean") line = null;
          else if (event.changed.length > 0) line = catalog.format("progress.state_changed", { count: event.changed.length });
          else line = event.limited ? catalog.format("progress.state_unchecked") : null;
          break;
        case "run_finished": {
          const pair = validStatusReason(event.status, event.reason);
          line = pair === null ? null : catalog.format("progress.finished", { status: catalog.format(`status.${pair.status}`), reason: pair.reason });
          break;
        }
        case "tool_result": {
          const told: unknown = event.result;
          line = typeof told === "object" && told !== null ? resultLine(told) : null;
          break;
        }
        case "model_response":
          line = null;
          break;
        default:
          // A record this renderer does not know (a later record type) gets no line, never an exception.
          line = null;
      }
      return line === null ? null : finalLine(line);
    },

    // R-70 L-1 (PM): revert knows no registered values, so its hints never show a typed workspace,
    // whatever context a caller gives (RevertSummaryContext is not read): `<workspace>` always.
    revertSummary(output: RevertOutput): string {
      const reverted = Array.isArray(output.reverted) ? output.reverted : [];
      const skipped = Array.isArray(output.skipped) ? output.skipped : [];
      const title = output.dryRun === true ? "revert.dry_run_title" : "revert.done_title";
      // Each title is followed by its own list: reverted files, then skipped files.
      const out = [`${HUMAN_PREFIX}${withCode(catalog.format(title, { count: reverted.length }), token(output.status))}`];
      for (const file of reverted.slice(0, REVERT_MAX_LISTED)) {
        const action: unknown = file.action;
        const word = isOneOf(action, REVERT_ACTIONS) ? catalog.format(`revert.action.${action}`) : "?";
        out.push(`  ${shownPath(String(file.path))} — ${word}`);
      }
      if (reverted.length > REVERT_MAX_LISTED) out.push(moreLine(reverted.length - REVERT_MAX_LISTED));
      // DR-25: files moved back unsafely with the person's consent; never in a dry run.
      const unsafeMoved = reverted.filter((file) => file.unsafe === true).length;
      if (output.dryRun !== true && unsafeMoved > 0) out.push(catalog.format("revert.unsafe_moved", { count: unsafeMoved }));
      if (skipped.length > 0) out.push(catalog.format("revert.skipped_title", { count: skipped.length }));
      for (const file of skipped.slice(0, REVERT_MAX_LISTED)) {
        const reason: unknown = file.reason;
        const word = isOneOf(reason, REVERT_SKIP_REASONS) ? catalog.format(`revert.skip.${reason}`) : "?";
        // A missing_record path comes from the snapshot index unmasked (SkippedFile): not printed.
        const shown = reason === "missing_record" ? HIDDEN_PATH : shownPath(String(file.path));
        out.push(`  ${shown} — ${word} (${token(reason)})`);
      }
      if (skipped.length > REVERT_MAX_LISTED) out.push(moreLine(skipped.length - REVERT_MAX_LISTED));
      // R-16 L-1: files the revert moved aside and could not put back (SkippedFile.parkedAt). The line
      // says how many and that they are in .codaryn/parked/ (fixed text); each place is in the JSON.
      const parked = skipped.filter((file) => typeof file.parkedAt === "string").length;
      if (parked > 0) out.push(catalog.format("revert.parked", { count: parked }));
      // DR-25: the preview did not check whether this drive can move the listed files back safely.
      if (output.dryRun === true && output.moveSafetyUnchecked === true) out.push(catalog.format("revert.dry_run_move_unchecked"));

      const before = output.revertedBefore;
      if (before !== undefined) {
        const time = localTime(before.at);
        const status = isOneOf(before.status, ["complete", "partial"] as const) ? before.status : null;
        if (status !== null) out.push(`${catalog.format("revert.reverted_before")} (${status}${time === null ? "" : `, ${time}`})`);
      }
      // DR-25: files skipped as unsafe_move go back on a revert with the person's consent.
      const revertedRun = toRunId(String(output.runId));
      if (output.dryRun !== true && revertedRun !== null && skipped.some((file) => file.reason === "unsafe_move")) {
        out.push(catalog.format("summary.next_revert_unsafe", { runId: revertedRun }));
      }
      // U-57 (UXM-21): only when the preview lists a file to revert. A dry run makes the real revert's
      // decisions and only skips files, so with none listed a real revert would do nothing either.
      if (output.dryRun === true && reverted.length > 0) out.push(catalog.format("revert.dry_run_next"));
      return lines(out);
    },

    latestChosen(entry: Extract<RunListEntry, { readonly state: "checked" }>): string {
      const runId = toRunId(String(entry.runId));
      if (runId === null) return lines([`${HUMAN_PREFIX}?`]);
      const time = localTime(entry.startedAt);
      const chosen = catalog.format("latest.chosen", { runId });
      return lines([`${HUMAN_PREFIX}${chosen}${time === null ? "" : ` (${catalog.format("runs.column.started")} ${time})`}`]);
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
        // U-16 (UXM-5): a plan run whose plan an apply run claimed (appliedBy) is not left as needing
        // input; it names the apply run. R-55b M-1b: and says what became of that apply, by the
        // contract's one rule over this list (planApplyStateOf, as revert's guidance judges it):
        // applied, not finished (with the apply run's reason), still applying or stopped without a
        // result, applied and reverted since, or the apply run's records gone. The code stays.
        const appliedBy: unknown = entry.appliedBy;
        const appliedRunId: unknown = typeof appliedBy === "object" && appliedBy !== null ? (appliedBy as { runId?: unknown }).runId : undefined;
        const claimedBy = pair?.reason === "plan_pending" && typeof appliedRunId === "string" ? toRunId(appliedRunId) : null;
        const judged = claimedBy === null ? null : planApplyStateOf({ ...entry, appliedBy: { runId: claimedBy, at: "" } }, runs);
        const words =
          pair === null
            ? null
            : judged !== null
              ? planApplyWords(judged.applyRunId, judged.reason)[judged.state]()
              : catalog.format(`status.${pair.status}`);
        let status = pair === null ? catalog.format("runs.incomplete") : `${words} (${pair.status}/${pair.reason})`;
        if (entry.reverted !== null && isOneOf(entry.reverted.status, ["complete", "partial"] as const)) {
          status += ` · ${catalog.format("runs.reverted")} (${entry.reverted.status})`;
        }
        if (entry.revertRecordDamaged === true) status += ` · ${catalog.format("runs.revert_record_damaged")}`;
        if (entry.recordsChanged === true) status += ` · ${catalog.format("runs.records_changed")}`;
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

    applyProgressLine(event: ApplyJournalEvent): string | null {
      let line: string | null;
      switch (event.type) {
        case "apply_started": {
          // U-52: the CLI's apply draws with applyProgressLine only.
          startAgain();
          const approval: unknown = event.approval;
          if (!isCount(event.actions, 1) || !isOneOf(approval, APPROVAL_CHANNELS)) {
            line = null;
            break;
          }
          planTotal = event.actions;
          line = catalog.format("progress.apply_started", { actions: event.actions, approval: catalog.format(`approval.${approval}`) });
          // DR-21: the person consented to unsafe moves for this apply.
          const consent: unknown = event.unsafeMoveConsent;
          if (isOneOf(consent, APPROVAL_CHANNELS)) {
            line += ` · ${catalog.format("progress.unsafe_move_consent", { approval: catalog.format(`approval.${consent}`) })}`;
          }
          break;
        }
        case "plan_checked": {
          const problems = Array.isArray(event.problems) ? event.problems : [];
          const parts: string[] = [catalog.format("progress.plan_checked", { count: problems.length })];
          for (const item of problems.slice(0, PLAN_PROBLEMS_SHOWN)) {
            const problem: unknown = item.problem;
            if (!isCount(item.index) || !isOneOf(problem, PLAN_ITEM_PROBLEMS)) continue;
            parts.push(`${catalog.format("progress.plan_item_problem", { number: item.index + 1, problem: catalog.format(`plan.problem.${problem}`) })} (${problem})`);
          }
          if (problems.length > PLAN_PROBLEMS_SHOWN) parts.push(`(+${problems.length - PLAN_PROBLEMS_SHOWN})`);
          // DR-21: moves that could only be made unsafely (not problems; they have their own part).
          const unsafe = Array.isArray(event.unsafeMoves) ? event.unsafeMoves.filter((at) => isCount(at)).length : 0;
          unsafeMoveCount = unsafe;
          if (unsafe > 0) parts.push(catalog.format("progress.unsafe_moves", { count: unsafe }));
          if (event.inventoryLimitReached === true) parts.push(catalog.format("progress.inventory_limit"));
          line = parts.join(" · ");
          break;
        }
        case "file_moved":
          line = isCount(event.index)
            ? `${catalog.format("progress.file_moved", { number: event.index + 1 })} ${shownPath(String(event.from))} → ${shownPath(String(event.to))}`
            : null;
          break;
        case "file_discarded":
          line = isCount(event.index) ? `${catalog.format("progress.file_discarded", { number: event.index + 1 })} ${shownPath(String(event.path))}` : null;
          break;
        case "plan_item_failed": {
          const problem: unknown = event.problem;
          line =
            isCount(event.index) && isOneOf(problem, PLAN_ITEM_PROBLEMS)
              ? `${catalog.format("progress.plan_item_failed", { number: event.index + 1, problem: catalog.format(`plan.problem.${problem}`) })} (${problem})`
              : null;
          break;
        }
        // Records shared with model runs render as in progressLine.
        case "verifier_result":
        case "integrity_checked":
        case "state_checked":
        case "run_finished":
          return output.progressLine(event);
        default:
          // R-9 I-4: plan_item_started is a recovery record, not progress, and any record this
          // renderer does not know gets no line, never an exception.
          line = null;
      }
      return line === null ? null : finalLine(line);
    },

    applySummary(result: ApplyResult, context: ApplySummaryContext): string {
      const pair = validStatusReason(result.status, result.reason);
      const out: string[] = [heading(pair, result.status, result.reason)];
      const applied = Array.isArray(result.applied) ? result.applied : [];
      // The plan total from apply_started when this renderer saw it; otherwise only when
      // verification ran (every action was applied) is "applied of total" known.
      const total = planTotal ?? (pair !== null && APPLIED_ALL_REASONS.has(pair.reason) ? applied.length : null);
      if (total !== null) out.push(catalog.format("summary.apply_actions", { applied: applied.length, total }));
      for (const item of applied.slice(0, REVERT_MAX_LISTED)) {
        if (!isCount(item.index)) continue;
        const action = item.action;
        // The same words as the progress lines, so a move and a discard read apart.
        out.push(
          action.kind === "move"
            ? `  ${catalog.format("progress.file_moved", { number: item.index + 1 })} ${shownPath(String(action.from))} → ${shownPath(String(action.to))}`
            : `  ${catalog.format("progress.file_discarded", { number: item.index + 1 })} ${shownPath(String(action.path))}`,
        );
      }
      if (applied.length > REVERT_MAX_LISTED) out.push(moreLine(applied.length - REVERT_MAX_LISTED));
      const planRunId = toRunId(String(result.planRunId));
      if (planRunId !== null) out.push(catalog.format("summary.apply_plan_run", { runId: planRunId }));
      const verifiers = Array.isArray(result.verifiers) ? result.verifiers : [];
      if (verifiers.length > 0) {
        out.push(catalog.format("summary.verifiers", { passed: verifiers.filter((verifier) => verifier.outcome === "pass").length, total: verifiers.length }));
      }
      // U-104: the protected-material checks that found nothing, folded in the progress lines.
      out.push(...integritySummary());
      if (pair !== null) out.push(catalog.format(`advice.${pair.reason}`));
      // U-8: what the apply tells besides its status (ApplyResult.noticeKinds), each kind once.
      // U-33 (R-56 Q-1 (a)): plan_records_unchecked by its cause. With a cause of the contract (every
      // own check complete, a run since the plan could not check), that cause's line, which advises
      // no cleanup; without one (this apply's own check was limited), U-8's, as before.
      const kinds: readonly unknown[] = Array.isArray(result.noticeKinds) ? result.noticeKinds : [];
      const cause = isOneOf(result.planRecordsUncheckedCause, PLAN_RECORDS_UNCHECKED_CAUSES) ? result.planRecordsUncheckedCause : null;
      for (const kind of APPLY_NOTICE_KINDS) {
        if (!kinds.includes(kind)) continue;
        out.push(kind === "plan_records_unchecked" && cause !== null ? catalog.format(`apply.notice.plan_records_unchecked.${cause}`) : catalog.format(`apply.notice.${kind}`));
      }
      // DR-51 (U-38): the typed workspace in the hints, with workspaceForm "given" only.
      const workspace = givenWorkspace(context);
      out.push(...nextCommands(result.runId, context.workspaceForm === "current", applied.length > 0, workspace));
      // DR-21: stopped for the person's consent to unsafe moves; how to give it for one apply.
      if (pair?.reason === "consent_required" && planRunId !== null) {
        if (unsafeMoveCount !== null && unsafeMoveCount > 0) out.push(catalog.format("summary.unsafe_moves", { count: unsafeMoveCount }));
        out.push(catalog.format("summary.next_apply_unsafe", { form: formText(context.workspaceForm, workspace), runId: planRunId }));
        if (typeof result.digest === "string" && DIGEST.test(result.digest)) out.push(`  ${result.digest}`);
      }
      return lines(out);
    },
  };
  return output;
};
