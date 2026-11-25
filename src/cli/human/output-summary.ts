/**
 * The human renderer's run summary (IR-26 step 3 O4): the summary's catalog helpers and runSummary.
 * createSummaryOutput reads nothing when it is made: output.ts hands it its catalog, its lockLines and
 * integritySummary, which runSummary calls only when it draws (so the checks drawn by then count), and
 * takes back the helpers its apply summary and progress lines use.
 */

import { CONFIRMATION_BY, MAX_FINAL_MESSAGE_CHARS, POLICY_NARROWING_KINDS, isShownWorkspace, toRunId } from "../../contracts/index.js";
import type { CatalogText, EngineResult, MessageCatalog, RunReason, RunSummaryContext, ShownWorkspace, TerminalRunStatus } from "../../contracts/index.js";
import { finalLine, quoteModelText, shownPath, token } from "../../app/input/format.js";
import { FINAL_MESSAGE_MAX_LINES } from "../../app/model-text.js";
import { DIGEST, REVERT_MAX_LISTED, SUMMARY_MAX_PATHS, WORKSPACE_FORMS, builtinReviewItemText, isCount, isOneOf, lines, moreLine, validStatusReason } from "./output-layout.js";

export function createSummaryOutput(catalog: MessageCatalog, integritySummary: () => string[], lockLines: (lockLeft: unknown) => string[]) {
  /**
   * U-110 (R-85 M1): RunSummaryContext.confirmationDenied as summary lines, in CONFIRMATION_BY order,
   * and how many calls they cover. `default` is `unanswered` where this run could ask (couldAsk) and
   * `unasked` where it could not. A field that is not an object, or a count that is not a whole number
   * of 0 or more, counts as none: the summary is then the one without it.
   */
  const confirmationDenials = (given: unknown): { readonly lines: readonly string[]; readonly total: number } => {
    if (typeof given !== "object" || given === null) return { lines: [], total: 0 };
    const field = given as { readonly user?: unknown; readonly default?: unknown; readonly cancelled?: unknown; readonly couldAsk?: unknown };
    const ids = {
      user: "summary.confirm_denied.user",
      default: field.couldAsk === true ? "summary.confirm_denied.unanswered" : "summary.confirm_denied.unasked",
      cancelled: "summary.confirm_denied.cancelled",
    } as const;
    const lines: string[] = [];
    let total = 0;
    for (const by of CONFIRMATION_BY) {
      const count = field[by];
      if (!isCount(count, 1)) continue;
      lines.push(catalog.format(ids[by], { count }));
      total += count;
    }
    return { lines, total };
  };
  /**
   * DR-41, DR-43 (b): the texts of what a task type's own rules left out of the given policy and checks
   * (run_started.policyNarrowings, RunSummaryContext.policyNarrowings, U-140), in their order: kinds and
   * counts only. A kind outside POLICY_NARROWING_KINDS, or a count below 1 where the kind has one, has no
   * text. The start line joins them to itself; U-146 (UXM-18): the end summary writes one a line.
   */
  const narrowingTexts = (given: unknown): string[] =>
    (Array.isArray(given) ? (given as readonly unknown[]) : []).flatMap((item): string[] => {
      if (typeof item !== "object" || item === null) return [];
      const narrowing = item as { readonly kind?: unknown; readonly count?: unknown };
      if (!isOneOf(narrowing.kind, POLICY_NARROWING_KINDS)) return [];
      if (narrowing.kind === "restore_path_tokens_off") return [catalog.format("progress.workflow_policy.restore_path_tokens_off")];
      return isCount(narrowing.count, 1) ? [catalog.format(`progress.workflow_policy.${narrowing.kind}`, { count: narrowing.count })] : [];
    });

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

  return {
    heading,
    givenWorkspace,
    formText,
    nextCommands,
    narrowingTexts,

    runSummary(result: EngineResult, context: RunSummaryContext): string {
      const pair = validStatusReason(result.status, result.reason);
      const out: string[] = [heading(pair, result.status, result.reason)];
      // G-A: a plan waiting for approval says so first. U-221 (ne-verify's U-217 F-1): a run plan
      // (EngineResult.plan.kind "changes") as its plan view says it: files to write, not actions.
      const planReady = pair?.reason === "plan_pending" && result.plan !== undefined && isCount(result.plan.actions);
      const runPlan = planReady && result.plan?.kind === "changes";
      if (planReady && result.plan !== undefined) {
        out.push(runPlan ? catalog.format("summary.plan_ready_changes", { count: result.plan.actions }) : catalog.format("summary.plan_ready", { actions: result.plan.actions }));
      }
      // U-198 (DR-69 B-3): a run that carried out a `run` plan names that plan run (EngineResult.planRunId),
      // as an apply's summary does; absent in every other run, so no other summary changes.
      const carried: unknown = result.planRunId;
      const carriedPlan = typeof carried === "string" ? toRunId(carried) : null;
      if (carriedPlan !== null) out.push(catalog.format("summary.apply_plan_run", { runId: carriedPlan }));
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
      // U-146 (UXM-18): what the task type's own rules left out (RunSummaryContext.policyNarrowings, filled by
      // run), once more, one a line with the start line's texts; absent or empty: no line.
      out.push(...narrowingTexts(context.policyNarrowings));
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
      // U-198 (B-4, V-14 L-1): of those, the writes refused as not writable, by why: not one of the
      // carried-out plan's files, with its advice (make a new plan), then outside the settings'
      // writablePaths. U-221 (nd-docs): the latter without its advice, which the CLI's progress line
      // (progress.not_writable_hint) gives right before this summary whenever the count is above 0.
      // The fields are optional: absent is 0, no line.
      const notPlanned = isCount(context.deniedNotPlanned) ? context.deniedNotPlanned : 0;
      if (notPlanned > 0) out.push(catalog.format("summary.denied_not_planned", { count: notPlanned }), catalog.format("summary.denied_not_planned_hint"));
      const notWritable = isCount(context.deniedNotWritable) ? context.deniedNotWritable : 0;
      if (notWritable > 0) out.push(catalog.format("summary.denied_not_writable", { count: notWritable }));
      // U-207 (bundle A, R-8): of those, the calls refused at a path this task may not read, and once
      // what a person can do about it, after the not-writable lines. Optional: absent is 0, no line.
      const unreadable = isCount(context.deniedUnreadable) ? context.deniedUnreadable : 0;
      if (unreadable > 0) out.push(catalog.format("summary.denied_unreadable", { count: unreadable }), catalog.format("summary.denied_unreadable_hint"));
      // U-18 (AXM-4): the calls that ran and failed, right after the denied ones; the hints after both.
      // The field is optional: absent (a caller that does not count them) is 0, no line.
      const failed = isCount(context.failedToolCalls) ? context.failedToolCalls : 0;
      if (failed > 0) out.push(catalog.format("summary.failed", { count: failed }));
      // U-110 (R-85 M1): the calls denied after a permission question. Their rule is there and asks
      // first, so each says what became of the question instead of the add-a-rule hint.
      const asked = confirmationDenials(context.confirmationDenied);
      out.push(...asked.lines);
      // N-23(e): the hint is about allowing a command, so it comes only with command denials, and
      // it points where the run's policy came from. U-110: only for the denied command calls that did
      // not follow a question (they are among deniedCommandCalls); a plain rule for a command that asks
      // first would let it run without the question.
      if (isCount(context.deniedCommandCalls) && context.deniedCommandCalls > asked.total) {
        out.push(catalog.format(context.policySource === "task" ? "summary.denied_hint_task" : "summary.denied_hint"));
      }
      // U-207 (DR-70): table results that left out groups of fewer than k rows; counts only, never a value.
      const hidden: unknown = context.hiddenGroups;
      if (typeof hidden === "object" && hidden !== null) {
        const { results, minGroupSize } = hidden as { readonly results?: unknown; readonly minGroupSize?: unknown };
        if (isCount(results, 1) && isCount(minGroupSize, 1)) out.push(catalog.format("summary.groups_hidden", { results, k: minGroupSize }));
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
      // U-152 (AXM-15): a plan run shows the agent's description of its plan (EngineResult.planSummary,
      // U-59) where another run shows its last message: under the plan view's label (plan.summary_label),
      // quoted rows as the plan view draws them. The model's own words, not checked and not what a person
      // approves (not in plan.json or the digest). U-221 (F-1): a run plan's summary is under its digest
      // and approved with its files (R-99 L-1), so it takes the run plan view's label.
      const planSummary: unknown = result.planSummary;
      if (planReady && typeof planSummary === "string") {
        const rows = quoteModelText(planSummary, FINAL_MESSAGE_MAX_LINES);
        if (rows.length > 0) out.push(`${catalog.format(runPlan ? "plan.changes.summary_label" : "plan.summary_label")}:`, ...rows);
      }
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
      // U-201: the run finished but its lock could not be released (RunSummaryContext.lockLeft).
      out.push(...lockLines(context.lockLeft));

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
        // U-207 (P-3): a built-in task type's item in the chosen language; any other entry as recorded.
        for (const entry of checklist.slice(0, REVERT_MAX_LISTED)) out.push(`  - ${builtinReviewItemText(entry, catalog) ?? shownPath(String(entry))}`);
        out.push(catalog.format("summary.next_review", { form, runId }));
      }
      return lines(out);
    },
  };
}
