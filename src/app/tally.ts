/**
 * U-293 (the CLI migration's C-6a; PM: the end summary's counts are the app layer's): a run's counts
 * for its end summary, counted as the engine appends each record, from the record as appended (the
 * engine's masking only; its closed words as written, never masked again, unlike a RunEvent's copy).
 * notePrivateData and the journal wrapper (runPrepared's `watched`) moved word for word from
 * src/cli/run.ts; the CLI's own run counts with them from here until it runs through the app layer,
 * and run.ts passes notePrivateData on for its test. tallyOf gives the counts as RunSummaryContext
 * takes them: the same fields under the same rules for leaving one out.
 */

import type { Journal, JournalEvent } from "../contracts/index.js";
import { createFailedCalls } from "./failed-calls.js";
import type { RunNotes } from "./prepare.js";
import { queryTableFacts } from "./query-table-facts.js";
import type { RunTally } from "./types.js";

/**
 * U-210 (U-207's two end summary counts, RunSummaryContext.deniedUnreadable and .hiddenGroups): a
 * denied call at a path the task may not read (`tool_decision`, code `unreadable_path`), and a
 * query_table result that left out groups of fewer than k rows (`tool_result`, read with U-207's
 * queryTableFacts, which reads two counts and nothing of the table). Exported for its test.
 */
export function notePrivateData(notes: RunNotes, event: JournalEvent): void {
  if (event.type === "tool_decision" && !event.allowed && event.code === "unreadable_path") notes.deniedUnreadable = (notes.deniedUnreadable ?? 0) + 1;
  if (event.type !== "tool_result") return;
  const facts = queryTableFacts(event.result);
  // R-108 L-2: a result that left out whole groups, or values from fewer than k cells (V-19), counts.
  if (facts === null || facts.kind !== "groups" || (facts.suppressedGroups === 0 && (facts.hiddenValues ?? 0) === 0)) return;
  const hidden = notes.hiddenGroups;
  notes.hiddenGroups = { results: (hidden?.results ?? 0) + 1, minGroupSize: Math.max(hidden?.minGroupSize ?? 0, facts.minGroupSize) };
}

/**
 * `recorded` with the end summary's counts noted in `notes` after each record is stored. `approved` is
 * the approved run plan a run carries out (U-195), absent for an ordinary run.
 */
export function countingJournal(recorded: Journal, notes: RunNotes, approved: unknown): Journal {
  // U-18: the calls allowed and then failed, counted as the records are written.
  const failed = createFailedCalls();
  const watched: Journal = {
    async append(event) {
      const stored = await recorded.append(event);
      if (failed.observe(event)) notes.failedToolCalls += 1;
      if (event.type === "tool_decision" && !event.allowed) {
        notes.deniedToolCalls += 1;
        if (event.permission === "command") notes.deniedCommandCalls += 1;
        // U-195 (Codex V-14 L-1, U-198): in a run that carries out a plan, every such write is outside
        // the plan's files: before the model the engine judged each planned file at the same gate and
        // ended the run as plan_stale if a writable list left one out (U-187, checkApprovedPlan).
        if (event.code === "path_not_writable") {
          if (approved === undefined) notes.deniedNotWritable = (notes.deniedNotWritable ?? 0) + 1;
          else notes.deniedNotPlanned = (notes.deniedNotPlanned ?? 0) + 1;
        }
      }
      if (event.type === "confirmation_answered" && event.decision === "deny" && (event.by === "user" || event.by === "default" || event.by === "cancelled")) {
        const denied = (notes.confirmationDenied ??= { user: 0, default: 0, cancelled: 0 });
        denied[event.by] += 1;
      }
      notePrivateData(notes, event);
      // U-148 (U-140, UXM-18): the end summary repeats what run_started recorded as left out.
      if (event.type === "run_started" && event.policyNarrowings !== undefined && event.policyNarrowings.length > 0) {
        notes.policyNarrowings = event.policyNarrowings;
      }
      return stored;
    },
    close: () => recorded.close(),
  };
  return watched;
}

/** The counts noted in `notes`, as RunSummaryContext takes them (src/cli/run.ts summaryContext). */
export function tallyOf(notes: RunNotes): RunTally {
  return {
    deniedToolCalls: notes.deniedToolCalls,
    deniedCommandCalls: notes.deniedCommandCalls,
    failedToolCalls: notes.failedToolCalls,
    ...(notes.confirmationDenied === undefined ? {} : { confirmationDenied: { ...notes.confirmationDenied } }),
    ...(notes.policyNarrowings === undefined || notes.policyNarrowings.length === 0 ? {} : { policyNarrowings: notes.policyNarrowings }),
    ...(notes.deniedNotPlanned === undefined ? {} : { deniedNotPlanned: notes.deniedNotPlanned }),
    ...(notes.deniedNotWritable === undefined ? {} : { deniedNotWritable: notes.deniedNotWritable }),
    ...(notes.deniedUnreadable === undefined ? {} : { deniedUnreadable: notes.deniedUnreadable }),
    ...(notes.hiddenGroups === undefined ? {} : { hiddenGroups: { ...notes.hiddenGroups } }),
  };
}
