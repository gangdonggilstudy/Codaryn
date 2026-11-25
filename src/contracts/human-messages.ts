/**
 * IR-26: the fixed message table (N-4, N-14) and its id types, moved from human.ts as they were.
 * `src/contracts/human.ts` (and so `src/contracts/index.ts`) exports them at the same path; this
 * module takes only the parameter-kind type from it, so nothing here runs anything at load.
 */
import type { MessageParamKind } from "./human.js";

/**
 * Fixed messages and the parameters each one takes (name → kind). A template refers to a
 * parameter as `{name}`; it must use every listed parameter and no other. Words only: the layout
 * (prefixes, separators, line breaks, the code in parentheses) belongs to the renderer.
 * Commands shown in messages are fixed text in the template (for example
 * `codaryn report --workspace <workspace> --run {runId}`); no message takes a typed path, except
 * the `*_typed` hints below (DR-51), whose `{workspace}` is a ShownWorkspace.
 */
export const FIXED_MESSAGES = {
  // Errors (N-5): "<error.label> — <what> (<code>)", the diagnostic line (N-15), the fix line.
  "error.label": {},
  "error.fix_label": {},
  "error.doctor_hint": {},
  // U-228 (draft for nb-i18n): run_not_plan's line with the hint plan_kind_differs, in place of
  // `error.run_not_plan.what`: the run has a plan, of another kind than the task carries out.
  "error.run_not_plan.other_kind": {},
  // U-37: the hints whose line takes a value (DETAILED_CLI_ERROR_HINTS, from CliErrorOutput's
  // CLI_ERROR_HINT_DETAIL); the others are listed (`error.hint.<hint>`). unknown_option names the
  // argument by its position only (DR-57). provider_settings_missing is followed by one item line
  // per setting not set, `error.missing.*`:
  // the key variable; the model (none left, or only a placeholder), with the provider's model
  // variable and the config's field; the output limit, with the config's field.
  "error.hint.unknown_option": { position: "count" },
  "error.hint.key_field_in_task": { field: "field" },
  "error.hint.key_field_in_config": { field: "field" },
  "error.hint.provider_settings_missing": {},
  "error.missing.key": { keyEnv: "keyEnv" },
  "error.missing.model": { variable: "settingEnv", field: "field" },
  "error.missing.model_placeholder": { variable: "settingEnv", field: "field" },
  "error.missing.output_limit": { field: "field" },

  // Input diagnostics (N-15). The file is named by `diagnostic.file.<file>`.
  "diagnostic.json_syntax": { line: "count", column: "count" },
  "diagnostic.unknown_field": { field: "field" },
  "diagnostic.unknown_field_suggest": { field: "field", suggestion: "field" },
  "diagnostic.invalid_value": { field: "field" },
  "diagnostic.missing_field": { field: "field" },
  "diagnostic.too_deep": {},

  // End-of-run summary (N-5, N-17).
  "summary.result": { status: "text", reason: "text" },
  "summary.verifiers": { passed: "count", total: "count" },
  "summary.no_verifiers": {},
  // U-104 (U-99b: UXM-18, AXM-20; PM): after the verifiers line of a run's or an apply's summary, when
  // its protected material was checked and no check found a change: how many checks there were. The
  // progress lines show the first check that found nothing and fold the later ones; a check that
  // found a change is always its own line. The count is the renderer's, of the records it drew.
  "summary.integrity_unchanged": { count: "count" },
  "summary.changes": { count: "count" },
  "summary.denied": { count: "count" },
  // U-18 (AXM-4): RunSummaryContext.failedToolCalls when above 0, right after summary.denied (its
  // hint lines come after both).
  "summary.failed": { count: "count" },
  // U-198 (DR-69 B-4, Codex V-14 L-1; the ids, their counts and order confirmed by the contract,
  // U-219; the words are drafts for nb-i18n): the writes refused as path_not_writable, by the kind
  // of run (RunSummaryContext.deniedNotPlanned, deniedNotWritable), each right after summary.denied
  // when above 0 and followed by its own advice: not one of the files the carried-out plan approved (to
  // change others, make a new plan that names them and approve it), or outside the writablePaths of
  // the settings (add the file to every list). The plan's first.
  "summary.denied_not_planned": { count: "count" },
  "summary.denied_not_planned_hint": {},
  "summary.denied_not_writable": { count: "count" },
  // U-221 (nd-docs): no longer written by runSummary. The CLI writes the same advice in its progress
  // line (progress.not_writable_hint) right before the end summary whenever deniedNotWritable is
  // above 0, so the summary keeps the count only and the advice is said once.
  "summary.denied_not_writable_hint": {},
  // U-207 (bundle A, R-3, R-8; drafts for nb-i18n): RunSummaryContext.deniedUnreadable, the calls refused
  // at a path this task may not read (unreadable_path), after summary.denied and the not-writable
  // lines (summary.denied_not_planned, summary.denied_not_writable, each with its advice), then once what a
  // person can do (the files are kept from the agent on purpose; query_table may still aggregate
  // their tables; to let it read them, take the entry out of unreadablePaths where it was set).
  "summary.denied_unreadable": { count: "count" },
  "summary.denied_unreadable_hint": {},
  // U-207 (DR-70, Q-4; draft for nb-i18n): RunSummaryContext.hiddenGroups, the table results of this
  // run that left out groups of fewer than k rows (QueryTablePayload.suppressedGroups above 0), and k.
  // U-210 (R-108 L-2): or values from fewer than k cells (a shown group's fewCells, Codex V-19).
  // Counts only: never a key, a value or a column. U-246 (R-110 L-2): its last sentence says what the
  // agent got for both: neither those groups nor those values, only how many groups were left out and
  // which values were empty (a value left out is null, its operation's index in fewCells).
  "summary.groups_hidden": { results: "count", k: "count" },
  "summary.denied_hint": {},
  // N-23: the same hint for a task file run, whose policy is the task's own.
  "summary.denied_hint_task": {},
  // U-110 (review R-85 M1): RunSummaryContext.confirmationDenied, in place of the add-a-rule hint for
  // those calls (the rule is there; it asks before running): `{count}` calls denied by the person
  // (`user`), with no answer where this run could not ask (`unasked`: standard input or stderr not a
  // terminal, or --quiet) or where the question went unanswered (`unanswered`: the input ended, or
  // the time limit ended the wait), or because the run was cancelled while it waited (`cancelled`).
  "summary.confirm_denied.user": { count: "count" },
  "summary.confirm_denied.unasked": { count: "count" },
  "summary.confirm_denied.unanswered": { count: "count" },
  "summary.confirm_denied.cancelled": { count: "count" },
  "summary.usage": { turns: "count", toolCalls: "count", seconds: "seconds" },
  "summary.run_id": { runId: "runId" },
  // DR-52 (AXM-17): EngineResult.masking, counts only: `{registered}` values registered for masking,
  // `{masked}` places masked in what was sent to the model. Shown when the result has it.
  "summary.masking": { registered: "count", masked: "count" },
  "summary.next_report": { runId: "runId" },
  "summary.next_report_here": { runId: "runId" },
  "summary.next_revert": { runId: "runId" },
  "summary.next_revert_here": { runId: "runId" },
  // DR-51 (U-38): the same hints with the workspace path the person typed (`{workspace}`, a
  // ShownWorkspace, in place of `<workspace>`), when the summary's context has `workspaceShown`.
  // Without it, the hints above, as before. End summaries only (run and apply; revert passes none,
  // R-70 L-1): not the report, the plan view, cleanup, runs or the errors.
  "summary.next_report_typed": { runId: "runId", workspace: "workspace" },
  "summary.next_revert_typed": { runId: "runId", workspace: "workspace" },
  "summary.config_default": { location: "location" },
  "summary.profile_applied": {},
  // DR-47 (AXM-1): the agent's last message (EngineResult.finalMessage), shown as an item after this
  // label, which says it is the agent's own words and not a verified fact; the second line follows
  // it when the text was cut (`{count}`: MAX_FINAL_MESSAGE_CHARS). The report's section starts with
  // `report.final_message`, which says the same.
  "summary.final_message": {},
  "summary.final_message_truncated": { count: "count" },
  // G-A: plan runs, human review and apply runs. `{form}` is one of `summary.form.*`, chosen by
  // the context's workspaceForm, so a hint repeats the task form the user typed without its value.
  "summary.form.task": {},
  "summary.form.given": {},
  "summary.form.current": {},
  // DR-51 (U-38): `summary.form.given` with the typed workspace, when the context has `workspaceShown`.
  "summary.form.typed": { workspace: "workspace" },
  "summary.plan_ready": { actions: "count" },
  // U-221 (ne-verify's U-217 F-1; draft for nb-i18n): summary.plan_ready for a run plan
  // (EngineResult.plan.kind "changes"): `{count}` the files to write, as plan.changes.heading says it.
  "summary.plan_ready_changes": { count: "count" },
  "summary.next_plan": { form: "text", runId: "runId" },
  "summary.next_apply": { form: "text", runId: "runId" },
  "summary.review_checklist": { count: "count" },
  // U-207 (P-3; draft for nb-i18n): the checklist item analyze-private adds to analyze's two
  // (PRIVATE_REVIEW_ITEM). The renderer shows this text for an entry equal to that constant.
  "review.item.no_identifying_values": {},
  "summary.next_review": { form: "text", runId: "runId" },
  "summary.apply_actions": { applied: "count", total: "count" },
  "summary.apply_plan_run": { runId: "runId" },
  // U-158 (GT-D14), draft for nb-i18n and nc-human: ApplyResult.foldersLeftEmpty, how many folders
  // the actions left without files; they stay. A line of the apply summary when it is present.
  "summary.folders_left_empty": { count: "count" },
  // U-14 (UXM-6, AXM-2, AXM-15): lines of the plan view (`codaryn plan`, the approval screen).
  // records_changed: first, when PlanOutput.recordsChanged (the records were changed outside the run,
  // so this plan may not be the one the run made); cannot_apply: in place of the command to apply it
  // (make the plan again with a new run); summary_label: before the model's summary, shown as an
  // item (the agent's description, not what is approved); digest_guarantee: last (the digest names
  // exactly these actions and the files' contents when the plan was made; apply refuses if the plan,
  // a file or the run's records changed since).
  "plan.records_changed": {},
  "plan.cannot_apply": {},
  "plan.summary_label": {},
  "plan.digest_guarantee": {},
  // U-36 (UXM-7 ③ ④): the rest of `codaryn plan`'s text, which apply's terminal question shows too,
  // apply's two questions, and review's lines.
  // - plan.heading: `{status}` is `plan.status.<status>`. Then plan.digest_label, after which the
  //   renderer puts the digest (PlanOutput.digest, an item as G-A allows).
  // - Each action: `plan.action.<kind>` and its masked paths; a discard ends with plan.discard_kept
  //   (it stays in the discarded-files folder until removed).
  // - plan.inventory_limit when PlanOutput.inventoryLimitReached (an apply would stop as plan_stale).
  // - plan.applied_by ({runId}: the apply run) when the plan was applied. UXM-23: the renderer puts
  //   the apply's time (PlanOutput.appliedBy.at) after it in local wall time, as `runs` shows times;
  //   a time that is not a run timestamp is left out (N-24 (c)). No message takes a time.
  // - plan.next_apply ({runId}: the plan run) while pending and not marked: the command up to
  //   `--digest`, with `<the same task form>` as words; the renderer puts the digest's first
  //   MIN_PLAN_DIGEST_PREFIX characters after it, one space apart (G-A: no message takes a digest).
  // - apply.question before the answer; apply.unsafe_move_question after an apply stopped as
  //   consent_required at a terminal: {count} moves can only be made without the guarantee that
  //   nothing at the destination is replaced, nothing was moved, make them for this apply only
  //   (DR-21). The renderer adds `prompt.yes_no_default_no` after each.
  // - review.recorded, or review.recorded_replaced when an earlier review was replaced
  //   (ReviewOutput.replaced): `{verdict}` is `review.verdict.<verdict>`. The checklist follows as
  //   items, then review.unchanged (the run's result and records are unchanged; `codaryn report`
  //   shows the verdict).
  "plan.heading": { runId: "runId", count: "count", status: "text" },
  "plan.digest_label": {},
  "plan.discard_kept": {},
  "plan.inventory_limit": {},
  "plan.applied_by": { runId: "runId" },
  "plan.next_apply": { runId: "runId" },
  // U-191 (DR-69 B-1, B-3; the ids confirmed by the contract, U-219; the words are drafts for
  // nb-i18n): the plan view of a `run` plan (ChangesPlanOutput),
  // beside the lines above, which it shares (records_changed, cannot_apply, digest_label,
  // plan.status.<status>, applied_by).
  // - plan.changes.heading: as plan.heading, `{count}` the planned files.
  // - plan.change.create, plan.change.modify: each planned file's change, before its masked path.
  // - plan.changes.summary_label: before the summary, when it has text: the plan run's description
  //   of the work, approved with the plan (it is under the digest, R-99 L-1), not the goal or new
  //   instructions (PM; the engine's own label says so to the later run); the summary follows as the
  //   model's words.
  // - plan.changes.next_apply ({runId}: the plan run) while pending and not marked: as
  //   plan.next_apply, the digest's first characters after it.
  // - plan.changes.digest_guarantee: last (the digest names the files, the contents of the files to
  //   modify and the summary; the run stops before its first model request if one changed; its file
  //   tools write only these files, B-8).
  "plan.changes.heading": { runId: "runId", count: "count", status: "text" },
  "plan.change.create": {},
  "plan.change.modify": {},
  "plan.changes.summary_label": {},
  "plan.changes.next_apply": { runId: "runId" },
  "plan.changes.digest_guarantee": {},
  // U-221 (drafts for nb-i18n): a run plan carried out is named as the report names it ("carried out
  // by run …"), in place of plan.status.applied in plan.changes.heading and of plan.applied_by. The
  // JSON keeps `status: "applied"` and `appliedBy`.
  "plan.changes.status_carried_out": {},
  "plan.changes.carried_by": { runId: "runId" },
  "apply.question": {},
  // U-198 (DR-69 B-3, B-8; the ids confirmed by the contract, U-219; the words are drafts for
  // nb-i18n): apply's terminal question for a `run` plan, after its plan view (renderChangesPlan):
  // what approving starts (apply.changes.what: a run whose file tools write only these {count}
  // files), when the view shows a summary that it is the model's description of the work, approved
  // with the plan and not the goal or a new instruction, and that only the files are enforced
  // (apply.changes.summary_note), a line when the run's policy allows commands (a command is not
  // bound to the files, B-8; apply.changes.commands_note), then apply.changes_question and
  // `prompt.yes_no_default_no`.
  "apply.changes.what": { count: "count" },
  "apply.changes.summary_note": {},
  "apply.changes.commands_note": {},
  "apply.changes_question": {},
  "apply.unsafe_move_question": { count: "count" },
  "review.recorded": { runId: "runId", verdict: "text" },
  "review.recorded_replaced": { runId: "runId", verdict: "text" },
  "review.unchanged": {},
  // DR-21: an apply that ended as consent_required: how many moves are unsafe, and the command that
  // gives consent for one apply (UNSAFE_MOVE_CONSENT_ARGUMENT is fixed text in the template).
  "summary.unsafe_moves": { count: "count" },
  "summary.next_apply_unsafe": { form: "text", runId: "runId" },

  // Progress lines (N-5, R-11): words first, the internal code in parentheses after them.
  "progress.run_started": { provider: "provider" },
  "progress.config_default": { location: "location" },
  "progress.turn": { turn: "count" },
  "progress.model_error": { turn: "count", kind: "modelError" },
  "progress.tool_allowed": { tool: "text" },
  "progress.tool_denied": { tool: "text", permission: "permission", code: "denial" },
  // N-22: a call stopped by a check before the policy (validate or restore stage), with no permission.
  "progress.tool_rejected": { tool: "text", code: "denial" },
  // U-18 (AXM-4, PM Q-1 (a), Q-2 (a)): what became of an allowed call (the failed-call rule at
  // RunSummaryContext.failedToolCalls). A result that succeeded has no line.
  // - progress.tool_failed: a failed call, `{code}` its ToolResult.errorCode (a tool error code, which
  //   the `denial` kind takes, as for progress.tool_rejected).
  // - progress.command_exited, progress.command_timed_out: a `run_command` result with `ok: true`
  //   whose content (the masked JSON of RunCommandPayload) has `timedOut: true`, or else an
  //   `exitCode` that is an integer other than 0. Not failed calls. Content that does not parse, or
  //   a null exit code without a timeout (a stopped command), gives no line.
  "progress.tool_failed": { tool: "text", code: "denial" },
  // U-207 (bundle A; drafts for nb-i18n): a query_table result that succeeded, as what was asked only:
  // `{groupColumns}` how many columns it grouped by (`_whole` for none); the renderer puts the operation
  // kinds after it in parentheses as codes (QUERY_TABLE_OPS, each once, in the query's order).
  // describe says only that the shape was asked. No path, column, key or value reaches these lines.
  "progress.query_table": { groupColumns: "count" },
  "progress.query_table_whole": {},
  "progress.query_table_describe": {},
  "progress.command_exited": { exitCode: "count" },
  "progress.command_timed_out": {},
  "progress.file_created": {},
  "progress.file_changed": {},
  "progress.verifier": { number: "count", outcome: "text" },
  "progress.repair": { attempt: "count", count: "count" },
  "progress.integrity_unchanged": { phase: "phase" },
  "progress.integrity_changed": { phase: "phase", count: "count" },
  "progress.finished": { status: "text", reason: "reason" },
  "progress.model_not_found": {},
  // U-182 (DR-69 B-4): after a run whose `{count}` writes were denied as path_not_writable, how to
  // allow a file (every writable list must cover it). A progress line, not in the result.
  // U-195 (Codex V-14 L-1, with U-198): not after a run that carries out a `run` plan, whose refused
  // writes are outside the plan (the end summary's summary.denied_not_planned and its hint say so).
  "progress.not_writable_hint": { count: "count" },
  "progress.unknown_tool": {},
  // G-A: an apply run's records (ApplyJournalEvent). `{approval}` is `approval.<channel>`,
  // `{problem}` is `plan.problem.<problem>`; an action is shown by its number (index + 1).
  "progress.apply_started": { actions: "count", approval: "text" },
  // `{count}` is the number of problems the preflight found: the entries of `plan_checked.problems`
  // (unsafe moves and the inventory limit are not counted; they have their own lines). 0 means every
  // action can be applied. It is not the number of actions (that is `progress.apply_started`).
  "progress.plan_checked": { count: "count" },
  // DR-21: `{count}` moves could only be made unsafely (`plan_checked.unsafeMoves`), and the
  // consent line when `apply_started.unsafeMoveConsent` is set (`{approval}` is `approval.<channel>`).
  "progress.unsafe_moves": { count: "count" },
  "progress.unsafe_move_consent": { approval: "text" },
  "progress.plan_item_problem": { number: "count", problem: "text" },
  "progress.inventory_limit": {},
  "progress.file_moved": { number: "count" },
  "progress.file_discarded": { number: "count" },
  "progress.plan_item_failed": { number: "count", problem: "text" },
  "outcome.pass": {},
  "outcome.fail": {},
  "outcome.inconclusive": {},

  // `--run latest` (N-23): which run was chosen, before anything is done. The start time follows
  // as an item in local time, from the checked `startedAt`.
  "latest.chosen": { runId: "runId" },

  // Revert (N-7).
  "revert.dry_run_title": { count: "count" },
  "revert.done_title": { count: "count" },
  "revert.skipped_title": { count: "count" },
  "revert.action.restored": {},
  "revert.action.deleted": {},
  // G-A: one per RevertAction of an apply run.
  "revert.action.moved_back": {},
  "revert.action.restored_from_discard": {},
  "revert.dry_run_next": {},
  "revert.reverted_before": {},
  // DR-25: `{count}` files were moved back unsafely, with the person's consent (RevertedFile.unsafe).
  // Shown after the reverted list when the count is above 0 (never in a dry run).
  "revert.unsafe_moved": { count: "count" },
  // DR-25: a dry run did not check whether this drive can move the listed files back safely; the
  // real revert checks it and, without consent, skips the ones it cannot (RevertOutput.moveSafetyUnchecked).
  "revert.dry_run_move_unchecked": {},
  // R-16 L-1: `{count}` files the revert moved aside could not be put back and were left in
  // `.codaryn/parked/` (fixed text; SkippedFile.parkedAt). Shown after the skipped list when above 0.
  "revert.parked": { count: "count" },
  // DR-39 (cleanup.ts): the preview, the two confirmations (run records; then people's discarded
  // files), and the outcome. Sizes are byte counts. Parked files are never cleaned.
  // `cleanup.nothing`: a selection that matched nothing (U-86: with nothing selected,
  // cleanup.no_selection instead).
  "cleanup.summary.runs": { count: "count", bytes: "count" },
  "cleanup.summary.discarded": { files: "count", bytes: "count" },
  "cleanup.summary.parked": { files: "count", bytes: "count" },
  "cleanup.nothing": {},
  "cleanup.done": { runs: "count", folders: "count", bytes: "count" },
  // DR-44 (d): folders an earlier cleanup moved aside and could not remove entirely (StateSummary.
  // leftovers, CleanupPlan.totals.leftovers, the removed ones): the summary line (when above 0) and
  // the outcome's line. In a plan they are always in the --confirm alone group (U-86).
  "cleanup.summary.leftovers": { count: "count", bytes: "count" },
  "cleanup.done_leftovers": { count: "count", bytes: "count" },
  // U-13 (UXM-1): after cleanup.done when above 0: how many apply runs' records were kept because
  // their discarded files stay (CleanupOutcome.kept with reason discarded_left); they go once those
  // applies are reverted or their discarded files are deleted too.
  "cleanup.done_discarded_left": { count: "count" },
  // R-34b P-2: folders in the state directory named like a leftover but without a cleanup's mark
  // (StateSummary.unknownFolders): shown when there are any; Codaryn does not remove them.
  "cleanup.summary.unknown_folders": { count: "count", bytes: "count" },
  // U-34 (UXM-7, AXM-22): the lines that were fixed English.
  // - cleanup.size: an item's size after its name in a plan (CleanupItem.size).
  // - cleanup.nothing_removed: first line of a confirmed cleanup that removed nothing
  //   (CleanupStatus nothing_removed); what was kept follows, as after cleanup.done.
  "cleanup.size": { files: "count", bytes: "count" },
  "cleanup.nothing_removed": {},
  // U-86 (UXM-10, the rest of UXM-1; PM, plan B): the preview, grouped by what a person must give
  // for an item to go (CleanupPlan's CLEANUP_ITEM_FATES). The output after a confirmation and
  // `cleanup --json` do not change. It retires cleanup.confirm.runs, .discarded, .not_reverted and
  // .leftovers and the six cleanup.next.* (U-34).
  // - cleanup.summary.discarded_without_records: after cleanup.summary.discarded when above 0:
  //   discarded-files folders whose run has no records left (StateSummary's
  //   STATE_DISCARDED_WITHOUT_RECORDS); no revert can put those files back.
  // - The groups, in this order, each shown only when it has items: cleanup.group.confirm
  //   (removed with --confirm alone; leftovers among them), cleanup.group.include_not_reverted
  //   (only with --include-not-reverted besides), cleanup.group.delete_discarded (only with
  //   --delete-discarded besides), cleanup.group.both (R-76 M-1: only with both flags besides: an
  //   apply run not reverted whose discarded files go with it, its plan run), cleanup.group.kept (no
  //   confirmation removes them in this selection), and last cleanup.group.blocked (R-76 L-1: the
  //   plan's `blocked`, which cannot be removed in this cleanup, each with its
  //   `cleanup.blocked.<code>`). Each group's `{count}` is the number of its items, so with a
  //   confirmation the items that go are the confirm group's and those of each group whose flags it
  //   gives (cleanup.group.both only with both).
  //   PM: not one word weaker than before. cleanup.group.include_not_reverted says at least what
  //   cleanup.confirm.not_reverted said (once their records are removed, those runs can no longer be
  //   reverted or put back by hand); cleanup.group.delete_discarded what cleanup.confirm.discarded
  //   said (they are people's own files and cannot be put back); cleanup.group.both both of them.
  //   `{count}` items, `{files}` and `{bytes}` their sizes.
  // - Under each item (its name and cleanup.size, as before): one line per warning,
  //   `cleanup.warning.<code>`, in place of the "; " list; a kept item's `cleanup.kept.<keptFor>`.
  // - Then the commands (G-A: the renderer puts the options after the text on one line, one space
  //   apart): cleanup.command.confirm when the --confirm alone group has items
  //   (`--confirm <digest prefix>`), cleanup.command.all when an item needs a flag
  //   (`--confirm <digest prefix>` and every flag some item needs, in CLEANUP_CONFIRM_FLAGS order).
  //   Each says nothing was removed and leads into them.
  // - cleanup.no_selection, with nothing selected (no selection option given): then the two example
  //   commands cleanup.example.older_than and cleanup.example.reverted, fixed text with
  //   `<workspace>`. Leftovers still show their group above it.
  "cleanup.summary.discarded_without_records": { count: "count", bytes: "count" },
  "cleanup.group.confirm": { count: "count", bytes: "count" },
  "cleanup.group.include_not_reverted": { count: "count", bytes: "count" },
  "cleanup.group.delete_discarded": { count: "count", files: "count", bytes: "count" },
  "cleanup.group.both": { count: "count", files: "count", bytes: "count" },
  "cleanup.group.kept": { count: "count" },
  "cleanup.group.blocked": { count: "count" },
  "cleanup.command.confirm": {},
  "cleanup.command.all": {},
  "cleanup.no_selection": {},
  "cleanup.example.older_than": {},
  "cleanup.example.reverted": {},
  // DR-25: some files were skipped as `unsafe_move`: the command that reverts again with consent
  // (UNSAFE_MOVE_CONSENT_ARGUMENT is fixed text in the template).
  "summary.next_revert_unsafe": { runId: "runId" },
  // DR-51 (U-38): the same with a typed workspace (RevertSummaryContext). R-70 L-1 (PM): revert
  // knows no registered values and passes none, so its hint says `<workspace>`; the id stays unused.
  "summary.next_revert_unsafe_typed": { runId: "runId", workspace: "workspace" },

  // `codaryn runs` (N-7, N-16).
  "runs.column.run_id": {},
  "runs.column.started": {},
  // U-139 (UXM-23, PM): the runs table's started column header, which says the time is local (the run
  // id header says UTC). runs.column.started stays the word of latestChosen's "(started <time>)".
  "runs.column.started_local": {},
  "runs.column.status": {},
  "runs.column.changes": {},
  "runs.empty": {},
  "runs.incomplete": {},
  // U-158 (AXM-8), drafts for nb-i18n and nc-human: in place of runs.incomplete when the entry has a
  // phase (RunListEntry.phase): still going, or stopped without a result. Without a phase,
  // runs.incomplete as before.
  "runs.running": {},
  "runs.no_result": {},
  "runs.damaged": {},
  "runs.reverted": {},
  // N-23 (g): the run's own records are fine, only its revert record failed the checks.
  "runs.revert_record_damaged": {},
  // DR-38: a run whose records were changed by something other than the run (state.ts).
  "runs.records_changed": {},
  // U-157 (UXM-18, PM): under the runs table, once, when a listed run has a records-changed mark: what
  // the short mark at the end of its result column (runs.records_changed) means, so that row stays short.
  "runs.records_changed_note": {},
  // U-16 (UXM-5): a plan run whose plan was applied (RunListEntry.appliedBy), in place of the
  // needs-input words: applied by `{runId}`.
  "runs.plan_applied": { runId: "runId" },
  // R-55 M-1: the plan run's line by its apply run (planApplyStateOf): not finished (with the apply
  // run's reason), still applying, applied and reverted since, the apply run's records gone.
  "runs.plan_apply_unfinished": { runId: "runId", reason: "reason" },
  "runs.plan_applying": { runId: "runId" },
  "runs.plan_apply_reverted": { runId: "runId" },
  "runs.plan_apply_missing": { runId: "runId" },
  // U-221 (drafts for nb-i18n): the same states for a run plan, whose applier in the list is a run
  // that carried it out (an entry with planRunId whose kind is not "apply"), in the report's words:
  // carried out by `{runId}` (done), carried out and ended as `{reason}` (no_verifier: its work done
  // without checks), being carried out or stopped without a result, carried out then reverted.
  // Without the applier in the list the plan's kind is not known, and runs.plan_apply_missing stays.
  "runs.plan_carried_out": { runId: "runId" },
  "runs.plan_carried_ended": { runId: "runId", reason: "reason" },
  "runs.plan_carrying": { runId: "runId" },
  "runs.plan_carried_reverted": { runId: "runId" },
  // U-129 (1), PM: an apply run's changes cell (RunListEntry.changes, its applied actions) says they
  // are actions, not files: `runs.apply_action_one` when there is one, else `runs.apply_actions`
  // (English "1 action", "{count} actions"; Korean "동작 {count}"). The JSON keeps the number.
  "runs.apply_actions": { count: "count" },
  "runs.apply_action_one": {},
  // U-129 (2), AXM-21: added to the result column of a run with RunListEntry.review: `{verdict}` is
  // `review.verdict.<verdict>`, as review.recorded writes it.
  "runs.review": { verdict: "text" },
  // U-139 (UXM-5, PM; the id confirmed by the contract, U-219; the words a draft for nb-i18n): added
  // to an apply run's result column right after its status words: the plan run it applied
  // (RunListEntry.planRunId), so the row says which plan it is the apply of, as the plan run's row
  // names its apply run (runs.plan_applied).
  "runs.apply_of": { runId: "runId" },
  // U-198 (DR-69 B-3; the id confirmed by the contract, U-219; the words a draft for nb-i18n): a run
  // that carried out a `run` plan (RunListEntry.planRunId on a `kind: "run"` entry) names that plan
  // run after its status words, as runs.apply_of does.
  "runs.carried_plan": { runId: "runId" },
  "report.records_changed": {},
  "report.final_message": {},
  "changes.records_changed": {},
  // U-16 (UXM-4): `changes` of an apply run (ChangesApplyRun) in place of "no file changed": it
  // applied the plan of run `{runId}`, `{count}` actions, which its report lists.
  "changes.apply_run": { count: "count", runId: "runId" },
  // U-36 (UXM-7 ③): the rest of `codaryn changes`'s text.
  // - changes.heading ({runId}): masked with the secrets registered now, not the run's own masking.
  // - changes.no_text_note once when a file has no text for masking_unverified (DR-29).
  // - changes.none when the run changed no file (an apply run has changes.apply_run instead).
  // - Each file: its masked path, changes.file.created or changes.file.changed, and
  //   `changes.state.<state>`. Then `changes.unavailable.<reason>` (the renderer adds the code in
  //   parentheses), or the changed region, or changes.no_difference. A side cut after its first
  //   lines ends with changes.more_lines ({count}: the lines not shown).
  "changes.heading": { runId: "runId" },
  "changes.no_text_note": {},
  "changes.none": {},
  // U-131 (N4, UXM-4, 5): a plan run (plan_pending) in place of changes.none: changes.plan_only, then
  // what became of its plan by the run list's rule (planApplyStateOf): changes.plan_applied when the
  // apply run is done, changes.plan_apply_other otherwise (`{runId}`: that apply run). Text only.
  "changes.plan_only": {},
  "changes.plan_applied": { runId: "runId" },
  "changes.plan_apply_other": { runId: "runId" },
  "changes.file.created": {},
  "changes.file.changed": {},
  "changes.no_difference": {},
  "changes.more_lines": { count: "count" },
  "revert.records_changed": {},
  // U-16, R-55 L-1: `revert` of a plan run: it only made a plan and changed no file (nothing put
  // back, not marked as reverted); then by its apply run (PLAN_APPLY_STATES_TO_REVERT): revert that
  // run to undo its changes, or it is still applying, was reverted already, or its records are gone.
  "revert.plan_only": {},
  "revert.plan_revert_apply": { runId: "runId" },
  "revert.plan_applying": { runId: "runId" },
  "revert.plan_apply_reverted": { runId: "runId" },
  "revert.plan_apply_missing": { runId: "runId" },
  // DR-38: progress lines of the state checks: `{count}` paths changed (the run stops), and a part
  // of the state directory that was too large to check (the run goes on).
  "progress.state_changed": { count: "count" },
  "progress.state_unchecked": {},
  // U-74 (DR-3): the in-run permission question (ConfirmRequest). The question: `{count}` is
  // ConfirmRequest.argumentCount; the renderer puts the masked executable (`subject`) after it as an
  // item and then `prompt.yes_no_default_no` (Enter, end of input or no terminal: no). Then one
  // progress line: allowed for this call once, or `progress.confirmation_denied.<by>`.
  "confirm.question.command": { count: "count" },
  "progress.confirmation_allowed": {},
  // DR-41: lines at the run's start from run_started.policyNarrowings. Counts only. U-140 (UXM-18):
  // the end summary repeats them with the same texts (RunSummaryContext.policyNarrowings).
  "progress.workflow_policy.commands_dropped": { count: "count" },
  "progress.workflow_policy.commands_narrowed": { count: "count" },
  "progress.workflow_policy.plan_actions_dropped": { count: "count" },
  "progress.workflow_policy.restore_path_tokens_off": {},
  "progress.workflow_policy.verifiers_dropped": { count: "count" },
  "runs.omitted": { count: "count" },

  // U-156 (nb-i18n's E group, U-154's table): `codaryn models`' text. The renderer adds the marks and
  // the values the texts end before (G-A): `: `, `* `, the model id and name (outside values, never in
  // a text). `{variable}` is the provider's model variable, `{field}` where --use writes (`model` or
  // `providers.openai.model`). The table's `  #` column head is not a word and stays as it is. The
  // English is the text before U-156, character for character (SP-0 pins it).
  "models.table.id": {},
  "models.table.name": {},
  "models.table.input_tokens": {},
  "models.table.output_tokens": {},
  "models.none_listed": {},
  "models.listed": { count: "count" },
  "models.no_current": { variable: "settingEnv" },
  "models.current_from_config": {},
  "models.current_from_env": { variable: "settingEnv" },
  "models.not_listed": {},
  "models.written_label": {},
  "models.written_place": { field: "field" },
  "models.written_place_created": { field: "field" },
  "models.overridden": { variable: "settingEnv", field: "field" },
  "models.use_prompt": { field: "field" },

  // `codaryn init` (N-2). Questions go to stderr; the final text (src/cli/init.ts) to stdout.
  "init.location": { location: "location" },
  "init.confirm_create": {},
  "init.declined": {},
  "init.not_terminal": {},
  // U-26: after init.confirm_create, the provider question. `{provider}` is INIT_DEFAULT_PROVIDER,
  // which Enter gives; the CLI lists API_PROVIDER_NAMES numbered above it (names are codes, shown as
  // they are, as the model list). Then init.provider_chosen says which one the file is written for,
  // so an unknown answer that fell back to the default is seen before the model question.
  "init.provider_pick": { provider: "provider" },
  "init.provider_chosen": { provider: "provider" },
  "init.model_no_key": {},
  "init.model_pick": {},
  "init.model_list_failed": { kind: "modelError" },
  "init.model_placeholder": {},
  "init.limits_default": { turns: "count", toolCalls: "count", tokens: "count", minutes: "count" },
  "init.commands_suggest": { command: "suggestedCommand" },
  "init.protected_suggest": { path: "suggestedPath" },
  "init.language_pick": {},
  // SP-D12: `{keyEnv}` is the chosen provider's key variable (API_KEY_ENVS).
  "init.key_set": { keyEnv: "keyEnv" },
  "init.key_missing": { keyEnv: "keyEnv" },
  "init.key_hint_windows": { keyEnv: "keyEnv" },
  "init.key_hint_posix": { keyEnv: "keyEnv" },
  "init.saved": { location: "location" },
  "init.next": {},
  "init.overridden_by_env": {},

  // Yes/no prompts (N-20): the hint shows the default answer, as INIT_QUESTION_DEFAULTS says.
  "prompt.yes_no_default_yes": {},
  "prompt.yes_no_default_no": {},
  // U-110 (review R-88 M2): Ctrl+C at a question of apply, revert, models or init: the command stops
  // there (exit code 5) without changing anything more. A run's question is cancelled as the run.
  "prompt.interrupted": {},

  // Language (N-20): where it came from is `language.source.<source>`.
  "language.chosen": { language: "language", source: "text" },
  "language.env_ignored": {},

  // Help (N-21): one line each; usage lines stay English and are printed by the CLI.
  "help.intro": {},
  "help.commands_heading": {},
  "help.output": {},
  "help.key": {},
  "help.contract": {},
  "help.options_heading": {},
  "help.exit_heading": {},
  // U-115 (UXM-9): the short help at a terminal (`codaryn`, `codaryn --help`): help.intro, then
  // help.first_steps and first_use.try_without_key, help.commands_heading with one help.summary.<command>
  // per command in the first-use order, then help.more, help.key, help.output, help.contract. Not
  // at a terminal the full help is as before. U-132 (review R-91 L-2): each line within 100 columns:
  // help.first_steps is the heading and help.first_steps_commands the commands on the next line
  // (indented two); help.version follows help.more on its own line.
  "help.first_steps": {},
  "help.first_steps_commands": {},
  "help.more": {},
  "help.version": {},
  "help.summary.init": {},
  "help.summary.doctor": {},
  "help.summary.models": {},
  "help.summary.run": {},
  "help.summary.runs": {},
  "help.summary.report": {},
  "help.summary.changes": {},
  "help.summary.revert": {},
  "help.summary.plan": {},
  "help.summary.apply": {},
  "help.summary.review": {},
  "help.summary.cleanup": {},
  // U-115: the way to try the flow without a key (docs/usage.md section 3), at a terminal: after
  // the short help, doctor's next steps, init's text and a run's provider_not_configured error.
  "first_use.try_without_key": {},

  // doctor (N-21): one id per outcome; the check id and its status word come from listed ids.
  // A DoctorCheck's `text` is in the JSON, so doctor ids never take `text` (catalog output).
  "doctor.footer": { status: "text", exitCode: "count" },
  "doctor.task_unusable": {},
  "doctor.no_workspace": {},
  "doctor.config_file.unreadable": { location: "location" },
  "doctor.config_file.json_syntax": { location: "location", line: "count", column: "count" },
  "doctor.config_file.key": { location: "location" },
  "doctor.config_file.too_deep": { location: "location" },
  "doctor.config_file.invalid": { location: "location", field: "field" },
  "doctor.config_file.invalid_unlocated": { location: "location" },
  // U-228 (U-224; draft for nb-i18n): a task type of the config file (named by the task or the
  // profile) resolves to a plan mode without its plan tool, which a run refuses (plan_tool_missing).
  "doctor.config_file.plan_tool_missing": { location: "location" },
  "doctor.task_file.unreadable": {},
  "doctor.task_file.json_syntax": { line: "count", column: "count" },
  "doctor.task_file.key": {},
  "doctor.task_file.too_deep": {},
  "doctor.task_file.invalid": { field: "field" },
  "doctor.task_file.invalid_unlocated": {},
  // U-228 (U-224; draft for nb-i18n): the task's own plan mode or tools leave out the plan tool.
  "doctor.task_file.plan_tool_missing": {},
  "doctor.task_file.valid": {},
  "doctor.model.script_unreadable": {},
  "doctor.model.script_json_syntax": { line: "count", column: "count" },
  "doctor.model.script_key": {},
  "doctor.model.script_too_deep": {},
  "doctor.model.script_invalid": { field: "field" },
  "doctor.model.script_invalid_unlocated": {},
  "doctor.node_version.ok": { major: "count", required: "count" },
  "doctor.node_version.fail": { required: "count" },
  "doctor.vars_file.skipped": {},
  "doctor.vars_file.unreadable": {},
  "doctor.vars_file.bom": {},
  "doctor.vars_file.ok": { count: "count" },
  "doctor.config_file.env_not_local": {},
  "doctor.config_file.none": {},
  "doctor.config_file.default_refused": {},
  "doctor.config_file.default_missing": { location: "location" },
  // `valid_at`: the config file at its default location. N-A 32.3: one given by `--config` or
  // CODARYN_CONFIG is `valid_given`, so it is not called the default location.
  "doctor.config_file.valid_at": { location: "location" },
  "doctor.config_file.valid_given": { location: "location" },
  "doctor.config_file.profile_missing": {},
  "doctor.task_file.skipped": {},
  "doctor.api_key.scripted": {},
  // SP-D12: the chosen provider and its key variable.
  "doctor.api_key.ok": { keyEnv: "keyEnv" },
  "doctor.api_key.missing": { keyEnv: "keyEnv", provider: "provider" },
  // U-87 (design gap C-12, architecture.md A-1; PM): the key is set but not of the form a request
  // can carry (S-11: printable ASCII 0x21-0x7E, no space); the check fails. Never the value, its
  // length or which character.
  "doctor.api_key.unusable": { keyEnv: "keyEnv" },
  // U-115 (UXM-9): at a terminal, after doctor's closing line: what is not set up yet and what to do
  // next, numbered in a fixed order (doctor.next.heading, then .init or .config_fix, .key or
  // .key_unusable, .model or .model_after_key, .other, .warnings, and .again), from the checks' texts;
  // with nothing to do, .ready (or .ready_task when doctor was given --task). The check lines and
  // doctor --json are as before; not at a terminal nothing is added.
  // U-132 (review R-91): .init_with_config in place of .init where there is no default config
  // location at all (L-1: init needs --config there); .model_after_key_fix after a key that cannot
  // be sent (L-4); .ready says the run works in the folder it starts in, and .ready_workspace is the
  // quick form for doctor given --workspace (L-3). Every line within 100 columns with its number (L-2).
  "doctor.next.heading": {},
  "doctor.next.init": {},
  "doctor.next.init_with_config": {},
  "doctor.next.config_fix": {},
  "doctor.next.key": { keyEnv: "keyEnv" },
  "doctor.next.key_unusable": { keyEnv: "keyEnv" },
  "doctor.next.model": {},
  "doctor.next.model_after_key": {},
  "doctor.next.model_after_key_fix": {},
  "doctor.next.other": { count: "count" },
  "doctor.next.warnings": { count: "count" },
  "doctor.next.again": {},
  "doctor.next.ready": {},
  "doctor.next.ready_workspace": {},
  "doctor.next.ready_task": {},
  // DR-36 (b), DR-34 (a): the key is set and where `{provider}` requests send it: `{origin}`, set by
  // the provider's address variable `{variable}`, by the config field `{field}`, or the default.
  "doctor.api_key.sends_to_env": { keyEnv: "keyEnv", provider: "provider", origin: "apiOrigin", variable: "settingEnv" },
  "doctor.api_key.sends_to_config": { keyEnv: "keyEnv", provider: "provider", origin: "apiOrigin", field: "field" },
  "doctor.api_key.sends_to_default": { keyEnv: "keyEnv", provider: "provider", origin: "apiOrigin" },
  // DR-36 (b): the key is set, but the address in `{variable}` breaks the address rule, so nothing is sent.
  "doctor.api_key.address_invalid": { keyEnv: "keyEnv", variable: "settingEnv" },
  "doctor.model.scripted_ok": {},
  "doctor.model.ok": {},
  // N-A 33.3: the chosen provider's model variable and the config place to set (`model`, or
  // `providers.<name>.model`), and the place of its output cap (`maxOutputTokens`, or
  // `providers.<name>.maxOutputTokens`).
  "doctor.model.missing": { variable: "settingEnv", field: "field" },
  "doctor.model.placeholder": {},
  "doctor.model.output_cap_missing": { field: "field" },
  "doctor.model.base_url_invalid": {},
  // DR-36 (b), R-19 I-4: a note of the model check (DoctorCheck.notes): `{variable}` is set but is
  // `{owner}`'s model or address variable, so a `{provider}` run does not read it.
  "doctor.model.other_provider_variable": { variable: "settingEnv", owner: "provider", provider: "provider" },
  "doctor.limits.ok": {},
  "doctor.limits.ok_quick": {},
  "doctor.limits.invalid": { field: "field" },
  "doctor.limits.invalid_unlocated": {},
  "doctor.workspace.skipped": {},
  "doctor.workspace.ok": {},
  "doctor.workspace.missing": {},
  "doctor.file_locations.no_input": {},
  "doctor.file_locations.inside": { count: "count" },
  "doctor.file_locations.ok": { count: "count" },
  "doctor.commands.none": {},
  "doctor.commands.ok": { count: "count" },
  "doctor.commands.ok_unchecked": { count: "count" },
  "doctor.commands.problems": { rejected: "count", notFound: "count", notFoundLocally: "count", remote: "count" },
  // G-F (general-tasks.md 7.1, PM answer Q5): `{count}` command rules take any further arguments
  // (`allowExtraArgs: true`) while plans may move or discard files (`policy.planActions`). Codaryn
  // does not check those arguments, so such a command can change files outside an approved plan.
  // A warning in the `commands` check (no new check id).
  "doctor.commands.extra_args_with_plan": { count: "count" },
  // U-182 (DR-69 B-8): `{count}` command rules while a writable list applies (policy.writablePaths of
  // the config, the profile, the task type or the task). The lists bind the file tools only, so such
  // a command can write files outside them. A warning in the `commands` check, or one of its notes
  // when the check says something else (no new check id).
  "doctor.commands.writable_with_commands": { count: "count" },
  // U-195 (DR-69 B-8): `{count}` command rules while the task's plan mode is "run": the approved files
  // bind the file tools only, so such a command can write outside the plan. As the line above (a
  // warning of the `commands` check, or one of its notes).
  "doctor.commands.plan_run_with_commands": { count: "count" },
  // U-210 (bundle A, R-5; draft for nb-i18n): `{count}` command rules and command verifiers while the
  // run has unreadable paths (every source's policy.unreadablePaths). A run refuses them (a command
  // can read any file), so the `commands` check fails with this text (no new check id).
  "doctor.commands.unreadable_with_commands": { count: "count" },
  // U-210 (review R-110 M-1; drafts for nb-i18n): a note of the task file's or the config file's failed
  // check that says why a run refuses it: analyze-private without an unreadable path, or k outside 5
  // to 1000.
  "doctor.private_data.unreadable_paths_required": {},
  "doctor.private_data.min_group_size_range": {},
  // DR-41: notes of the `commands` check (DoctorCheck.notes): what the task type's own rules left out
  // of the configured policy (workflowPolicyNarrowings). Counts only.
  "doctor.workflow_policy.commands_dropped": { count: "count" },
  "doctor.workflow_policy.commands_narrowed": { count: "count" },
  "doctor.workflow_policy.plan_actions_dropped": { count: "count" },
  "doctor.workflow_policy.restore_path_tokens_off": {},
  "doctor.workflow_policy.verifiers_dropped": { count: "count" },
  "doctor.install_dir.unknown_env": {},
  "doctor.install_dir.not_found": {},
  "doctor.install_dir.ok": {},
  "doctor.install_dir.overlap": {},
  "doctor.integrity_paths.skipped": {},
  "doctor.integrity_paths.problems": { missing: "count", inside: "count" },
  "doctor.integrity_paths.ok": { count: "count" },
  "doctor.language.from_env": { language: "language" },
  "doctor.language.from_config": { language: "language" },
  "doctor.language.from_os": { language: "language" },
  "doctor.language.from_default": { language: "language" },
  "doctor.language.env_ignored": { language: "language" },
  "doctor.language.unchecked": {},
  // N-25 (a): the workspace lock. When a lock is held but no Codaryn runs, the user removes it.
  "doctor.lock.none": {},
  "doctor.lock.held": {},
  "doctor.lock.stale": {},
  "doctor.lock.unreadable": {},
  // DR-27 (b), PM notice: `.codaryn/lock.json.reclaim` is left in a state the store never clears
  // (still being written, as an exclusive create on a volume without hard links leaves it when the
  // attempt ends in between; not understood; or its owner still runs). While it stays, a lock left
  // by an ended process is not reclaimed; the text says to remove it when no Codaryn runs here.
  "doctor.lock.reclaim_left": {},
  // R-16 L-1: a warning in the `lock` check (no new check id), which already looks into the state
  // directory: `{count}` files a revert left in `.codaryn/parked/` (ListParkedFiles). The person
  // moves them back or deletes them; nothing removes them on its own.
  "doctor.lock.parked_left": { count: "count" },
  // The hint after `workspace_locked`. Its text names `.codaryn/lock.json` and
  // `.codaryn/lock.json.reclaim` (DR-27 b): both may need removing when no Codaryn runs here.
  "lock.remove_hint": {},
  // U-193 (after U-176): a run, a check or a cleanup finished but the workspace lock could not be
  // released (RunOutcome.lockLeft, PlanCheck.lockLeft, CleanupOutcome.lockLeft). No path: the
  // doctor's lock line names the file. Drafted by p5a from nc-human's line; the id confirmed by the
  // contract (U-219), the words for nb-i18n to confirm.
  // U-201: the run, apply and revert summaries say it when their context's `lockLeft` is true
  // (RunSummaryContext, ApplySummaryContext, RevertSummaryContext), right before their next commands.
  // U-257: and a confirmed cleanup's text (CleanupOutcome.lockLeft), as its last line.
  "lock.release_failed": {},
} as const satisfies { readonly [id: string]: { readonly [param: string]: MessageParamKind } };

export type FixedMessageId = keyof typeof FIXED_MESSAGES;

/** N-21: the fixed ids a DoctorCheck's `text` may use (not the footer, which is rendered only). */
export type DoctorMessageId = Exclude<Extract<FixedMessageId, `doctor.${string}`>, "doctor.footer">;
