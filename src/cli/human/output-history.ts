/**
 * The human renderer's run history (IR-26 step 3 O3): a plan run's words by what became of its apply,
 * the revert summary, the latest run chosen and the run list. createHistoryOutput reads nothing when it
 * is made: output.ts hands it its catalog and its lockLines.
 */

import { REVERT_ACTIONS, REVERT_SKIP_REASONS, REVIEW_VERDICTS, planApplyStateOf, toRunId } from "../../contracts/index.js";
import type { CatalogText, HumanOutput, MessageCatalog, PlanApplyState, RevertOutput, RevertSummaryContext, RunId, RunListEntry, RunReason, RunsOutput } from "../../contracts/index.js";
import { displayWidth, finalLine, padEnd, shownPath, token } from "../../app/input/format.js";
import { HIDDEN_PATH, HUMAN_PREFIX, REVERT_MAX_LISTED, isCount, isOneOf, lines, localTime, moreLine, validStatusReason, withCode } from "./output-layout.js";

export function createHistoryOutput(catalog: MessageCatalog, lockLines: (lockLeft: unknown) => string[]): Pick<HumanOutput, "revertSummary" | "latestChosen" | "runsText"> {
  // U-16, R-55b M-1b: a plan run's words in the run list by what became of its apply (planApplyStateOf).
  // An unfinished apply names its reason; without one (the list pairs them, so not expected) it is `?`.
  const planApplyWords = (applyRunId: RunId, reason: RunReason | undefined): { readonly [S in PlanApplyState]: () => CatalogText } => ({
    applied: () => catalog.format("runs.plan_applied", { runId: applyRunId }),
    unfinished: () => catalog.format("runs.plan_apply_unfinished", { runId: applyRunId, reason: reason ?? ("?" as RunReason) }),
    applying: () => catalog.format("runs.plan_applying", { runId: applyRunId }),
    reverted: () => catalog.format("runs.plan_apply_reverted", { runId: applyRunId }),
    record_missing: () => catalog.format("runs.plan_apply_missing", { runId: applyRunId }),
  });
  // U-221 (ne-verify, nd-docs): a run plan's plan run by the same rule, in the report's words (carried out
  // by run …; a run that ended otherwise than done names how, as no_verifier when it had no checks).
  // record_missing is not reached with a carrying run in the list, and keeps its words.
  const planCarriedWords = (carryRunId: RunId, reason: RunReason | undefined): { readonly [S in PlanApplyState]: () => CatalogText } => ({
    applied: () => catalog.format("runs.plan_carried_out", { runId: carryRunId }),
    unfinished: () => catalog.format("runs.plan_carried_ended", { runId: carryRunId, reason: reason ?? ("?" as RunReason) }),
    applying: () => catalog.format("runs.plan_carrying", { runId: carryRunId }),
    reverted: () => catalog.format("runs.plan_carried_reverted", { runId: carryRunId }),
    record_missing: () => catalog.format("runs.plan_apply_missing", { runId: carryRunId }),
  });

  return {
    // R-70 L-1 (PM): revert knows no registered values, so its hints never show a typed workspace,
    // whatever context a caller gives (RevertSummaryContext is not read): `<workspace>` always.
    revertSummary(output: RevertOutput, context?: RevertSummaryContext): string {
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
      // U-139 (UXM-6): a run with a records-changed mark (RevertOutput.recordsChanged, DR-38) says so after
      // its lists, as runs and report do: the revert goes on and checks every file.
      if (output.recordsChanged === true) out.push(catalog.format("revert.records_changed"));
      // DR-25: the preview did not check whether this drive can move the listed files back safely.
      if (output.dryRun === true && output.moveSafetyUnchecked === true) out.push(catalog.format("revert.dry_run_move_unchecked"));

      const before = output.revertedBefore;
      if (before !== undefined) {
        const time = localTime(before.at);
        const status = isOneOf(before.status, ["complete", "partial"] as const) ? before.status : null;
        if (status !== null) out.push(`${catalog.format("revert.reverted_before")} (${status}${time === null ? "" : `, ${time}`})`);
      }
      // U-201: the revert finished but its lock could not be released (RevertSummaryContext.lockLeft).
      out.push(...lockLines(context?.lockLeft));
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
          // U-139 (UXM-23): the header says the time is local; the run id header says UTC.
          catalog.format("runs.column.started_local"),
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
        // U-221: the plan was a run plan when the entry that took it up (the one planApplyStateOf read) is
        // a run that carried it out, not an apply run; a plan of moves' words are as before.
        const taker = judged === null ? undefined : runs.find((other) => other.state === "checked" && other.runId === judged.applyRunId && other.planRunId === entry.runId);
        const carried = taker !== undefined && taker.state === "checked" && taker.kind !== "apply";
        const words =
          pair === null
            ? null
            : judged !== null
              ? (carried ? planCarriedWords : planApplyWords)(judged.applyRunId, judged.reason)[judged.state]()
              : catalog.format(`status.${pair.status}`);
        // U-162 (AXM-8): a run without a result says what its phase is when the list knows it.
        const phase: unknown = entry.phase;
        const noResult = phase === "running" ? "runs.running" : phase === "no_result" ? "runs.no_result" : "runs.incomplete";
        let status = pair === null ? catalog.format(noResult) : `${words} (${pair.status}/${pair.reason})`;
        // U-139 (UXM-5): an apply run names the plan run it applied, right after its status words.
        const appliedPlan = entry.kind === "apply" && typeof entry.planRunId === "string" ? toRunId(entry.planRunId) : null;
        if (appliedPlan !== null) status += ` · ${catalog.format("runs.apply_of", { runId: appliedPlan })}`;
        // U-198 (DR-69 B-3): a run that carried out a `run` plan names that plan run in the same place
        // (RunListEntry.planRunId on a run that is not an apply run; absent on every other run).
        const carriedPlan = entry.kind !== "apply" && typeof entry.planRunId === "string" ? toRunId(entry.planRunId) : null;
        if (carriedPlan !== null) status += ` · ${catalog.format("runs.carried_plan", { runId: carriedPlan })}`;
        // U-129 (2), AXM-21: a person's verdict on a run that waited for review (the store reads its
        // review.json); the time is in the JSON only. Before the marks of what came after the run.
        const review: unknown = entry.review;
        const verdict: unknown = typeof review === "object" && review !== null ? (review as { readonly verdict?: unknown }).verdict : undefined;
        if (isOneOf(verdict, REVIEW_VERDICTS)) status += ` · ${catalog.format("runs.review", { verdict: catalog.format(`review.verdict.${verdict}`) })}`;
        if (entry.reverted !== null && isOneOf(entry.reverted.status, ["complete", "partial"] as const)) {
          status += ` · ${catalog.format("runs.reverted")} (${entry.reverted.status})`;
        }
        if (entry.revertRecordDamaged === true) status += ` · ${catalog.format("runs.revert_record_damaged")}`;
        if (entry.recordsChanged === true) status += ` · ${catalog.format("runs.records_changed")}`;
        // U-129 (1), UXM-4: an apply run's number is its applied actions, not files; the cell says so.
        const changes = !isCount(entry.changes)
          ? "-"
          : entry.kind !== "apply"
            ? String(entry.changes)
            : entry.changes === 1
              ? catalog.format("runs.apply_action_one")
              : catalog.format("runs.apply_actions", { count: entry.changes });
        rows.push([runId, localTime(entry.startedAt) ?? "?", changes, status]);
      }
      // Every column but the last is padded to its widest cell (Hangul counts two columns).
      const widths = [0, 1, 2].map((column) => Math.max(...rows.map((row) => displayWidth(finalLine(row[column] ?? "")))));
      const out = rows.map((row) =>
        row
          .map((cell, column) => (column < 3 ? padEnd(finalLine(cell), widths[column] ?? 0) : finalLine(cell)))
          .join("  ")
          .trimEnd(),
      );
      // U-157 (UXM-18): a row carries only the short records-changed mark; what it means is one line under
      // the table, once, when a listed run has the mark.
      if (runs.some((entry) => entry.state === "checked" && entry.recordsChanged === true)) out.push(catalog.format("runs.records_changed_note"));
      if (omitted > 0) out.push(catalog.format("runs.omitted", { count: omitted }));
      return lines(out);
    },
  };
}
