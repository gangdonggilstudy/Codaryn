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
  APPLY_NOTICE_KINDS,
  APPROVAL_CHANNELS,
  CONFIRMATION_BY,
  INTEGRITY_PHASES,
  MODEL_ERROR_KINDS,
  PLAN_ITEM_PROBLEMS,
  PLAN_RECORDS_UNCHECKED_CAUSES,
  PERMISSION_KINDS,
  POLICY_DENIAL_CODES,
  STATE_CHECK_PHASES,
  ALL_TOOL_NAMES,
  TOOL_ERROR_CODES,
  toRunId,
} from "../../contracts/index.js";
import type {
  PolicyNarrowing,
  ApplyJournalEvent,
  ApplyResult,
  ApplySummaryContext,
  CatalogText,
  CliErrorCode,
  CreateHumanOutput,
  HumanOutput,
  JournalEvent,
  MessageCatalog,
  AnyToolName,
} from "../../contracts/index.js";
import "../../store/index.js"; // Preserve module evaluation order.
import { finalLine, shownPath, token } from "../../app/input/format.js";
import "../../app/model-text.js"; // Preserve module evaluation order.
import { queryTableFacts } from "./query-table.js";
import type { QueryTableFacts } from "./query-table.js";
import { APPLIED_ALL_REASONS, DIGEST, OUTCOMES, PLAN_PROBLEMS_SHOWN, PROVIDERS, REVERT_MAX_LISTED, isCount, isOneOf, lines, lockReleaseFailedLine, moreLine, validStatusReason } from "./output-layout.js";
import { createErrorOutput } from "./output-errors.js";
import { createHistoryOutput } from "./output-history.js";
import { createSummaryOutput } from "./output-summary.js";

export { FINAL_MESSAGE_MAX_LINES, HIDDEN_PATH, HUMAN_PREFIX, REVERT_MAX_LISTED, SUMMARY_MAX_PATHS, builtinReviewItemText, lockReleaseFailedLine } from "./output-layout.js";

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
  /** U-201: lock.release_failed when a summary's context says the lock was left. */
  const lockLines = (lockLeft: unknown): string[] => {
    const line = lockReleaseFailedLine(lockLeft, catalog);
    return line === null ? [] : [line];
  };
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
  /** U-207: a table query's line: the operation kinds and the number of group columns, or the shape asked. */
  const queryLine = (query: QueryTableFacts): string => {
    if (query.kind === "describe") return catalog.format("progress.query_table_describe");
    // The operation kinds are codes, in parentheses after the words (the renderer's layout).
    const words = query.groupColumns === 0 ? catalog.format("progress.query_table_whole") : catalog.format("progress.query_table", { groupColumns: query.groupColumns });
    return `${words} (${query.operations.join(", ")})`;
  };
  const resultLine = (told: { readonly callId?: unknown; readonly tool?: unknown; readonly ok?: unknown; readonly content?: unknown; readonly errorCode?: unknown }): string | null => {
    if (told.ok === false) {
      if (deniedCalls.has(String(told.callId))) return null;
      return isOneOf(told.errorCode, TOOL_ERROR_CODES) ? catalog.format("progress.tool_failed", { tool: toolText(String(told.tool)), code: told.errorCode }) : null;
    }
    // U-207 (bundle A): a query_table result that succeeded says what was asked, nothing of the table.
    const query = queryTableFacts(told);
    if (query !== null) return queryLine(query);
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

  const history = createHistoryOutput(catalog, lockLines);

  const errors = createErrorOutput(catalog);

  // G-A, DR-21: what this renderer learned from an apply's progress records, for its summary
  // (one renderer per command). ApplyResult carries neither the plan total nor the unsafe moves.
  let planTotal: number | null = null;
  let unsafeMoveCount: number | null = null;

  const summary = createSummaryOutput(catalog, integritySummary, lockLines);
  const { heading, givenWorkspace, formText, nextCommands, narrowingTexts } = summary;

  const output: HumanOutput = {
    error: errors.error,

    runSummary: summary.runSummary,

    progressLine(event: JournalEvent): string | null {
      // U-52: a run start, or an apply start passed by another reader, begins anew, well formed or not.
      // OFG-2: the GUI host sends apply-only records directly to applyProgressLine.
      const type: unknown = (event as { readonly type?: unknown }).type;
      if (type === "run_started" || type === "apply_started") startAgain();
      let line: string | null;
      switch (event.type) {
        case "run_started": {
          line = isOneOf(event.provider, PROVIDERS) ? catalog.format("progress.run_started", { provider: event.provider }) : null;
          // DR-43 (b), DR-41: kinds and counts only. One line per record (HumanOutput.progressLine), so
          // each narrowing is one more fact of the start line.
          const narrowings = narrowingTexts(event.policyNarrowings);
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
          // U-99a: a verifier is told apart by its kind and its id. An apply's built-in inventory check
          // (kind inventory) and a task verifier named inventory are two checks with two numbers; in a
          // model run a verifier keeps its kind, so its number, from round to round.
          const key = `${String(event.result.kind)}\u0000${String(event.result.id)}`;
          let number = verifierNumbers.get(key);
          if (number === undefined) {
            number = verifierNumbers.size + 1;
            verifierNumbers.set(key, number);
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
        // U-110 (R-85 M1): the permission question (U-74). The question itself has no progress line: at
        // a terminal the CLI asks it on stderr. Its answer has one: allowed for this call once, or denied
        // by the person, by default (no answer, nobody to ask, or the time limit) or as cancelled.
        case "confirmation_requested":
          line = null;
          break;
        case "confirmation_answered":
          if (event.decision === "allow_once" && event.by === "user") line = catalog.format("progress.confirmation_allowed");
          else if (event.decision === "deny" && isOneOf(event.by, CONFIRMATION_BY)) line = catalog.format(`progress.confirmation_denied.${event.by}`);
          else line = null;
          break;
        case "model_response":
          line = null;
          break;
        default:
          // A record this renderer does not know (a later record type) gets no line, never an exception.
          line = null;
      }
      return line === null ? null : finalLine(line);
    },

    revertSummary: history.revertSummary,
    latestChosen: history.latestChosen,
    runsText: history.runsText,

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
      // U-162 (GT-D14, PM): right after the actions, how many folders they left without files (kept).
      if (isCount(result.foldersLeftEmpty, 1)) out.push(catalog.format("summary.folders_left_empty", { count: result.foldersLeftEmpty }));
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
      // U-201: the apply finished but its lock could not be released (ApplySummaryContext.lockLeft).
      out.push(...lockLines(context.lockLeft));
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
