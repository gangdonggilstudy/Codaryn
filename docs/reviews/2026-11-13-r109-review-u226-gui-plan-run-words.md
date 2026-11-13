# R-109 — U-226 (p5u-gui: the GUI carries out a run plan), read by nc-human

- Branch tip: `unit/U-226-p5u-gui` = `d5c59c5b4194a70708fc842ecf8be8675613c356` (git rev-parse). Merge base with
  main a5790dfb (it has U-221 and U-227, not U-228 or U-230).
- Compared with the CLI's present texts on main `529fceaa7e6a80ad3873d4b72166b0ec01c09909` (U-221, U-227, U-228,
  U-230), both languages: src/i18n/en.ts and ko.ts, and the run plan's apply question as plan-commands.ts asks it
  since U-228 (renderChangesPlan, then changesApprovalText, then changesApplyQuestion).
- Read: `git diff a5790dfb unit/U-226-p5u-gui -- gui` (19 files): renderer/i18n en·ko, plan-screen.ts, run-screen.ts,
  runs-screen.ts, main/dialog-texts.ts, main/app.ts (confirmApply), main/ipc.ts, engine-host/runs.ts, history.ts.
  The app-layer commits in the same branch (U-211, U-218, U-229) are not part of this reading.
- Read only; nothing run.

## Count

| Level | Count |
| --- | --- |
| High | 0 |
| Medium | 1 |
| Low | 2 |
| Info | 6 |

## Medium

### M-1 — the approval dialog says only the listed files can be written; the CLI says file tools, and that allowed commands are not bound

- Where: gui/src/main/dialog-texts.ts `applyRun.message`, `applyRun.detail` (en and ko); main/app.ts confirmApply.
- GUI: "Apply this run plan? A new run writes the plan's {files} files" and "… may write only the files in the list
  (writes to others are refused)." Korean the same ("목록의 파일만 쓸 수 있습니다(다른 파일 쓰기는 거부됩니다)").
- CLI (U-198, asked since U-228): "Approving starts a run whose file tools can write only these {count} file(s)."
  and, when the task's policy has a command rule, "This task also allows commands, and a command the policy allows
  is not limited to these files." (B-8; apply.changes.commands_note).
- Effect: under a policy that allows commands, a person approves in the GUI believing nothing outside the list can
  change, while an allowed command can write any file. The dialog also says the run "writes" the files, where the
  CLI says it "can write only" them.
- Suggestion: the dialog's words as the CLI's: the run's file tools write only these files, and the commands note
  when the run's policy allows a command (the engine host can tell it from the task it resolves for the check), or
  always in a conditional form ("If the task allows commands, a command is not limited to these files").

## Low

### L-1 — the dialog leaves out that the summary is approved with the plan and is not an instruction

- GUI dialog: "The summary is the words of the model that made the plan, not checked. The new run gets that summary
  and the file list …". It does not say that the summary is approved with the plan (under the digest), that it is a
  description of the work and not the goal or a new instruction, or that nothing checks the run against it.
- CLI before its question: apply.changes.summary_note ("The summary above is the model's description of the work,
  approved with the plan. It is not the goal or a new instruction, and nothing checks the run against it; only the
  file list is enforced."). The GUI's plan screen label (plan.runSummaryLabel) does say "approved together" and "not
  as new instructions", but the dialog is what the person confirms, and "the new run gets that summary" alone can
  read as an instruction to the run.
- Suggestion: the dialog's detail carries the CLI's three points in short form.

### L-2 — one thing, two words: the plan screen calls the summary a "description", the dialog and the CLI a "summary"

- GUI plan.runSummaryLabel: "this plan's description … This description and the file list …" (ko "이 계획의 설명").
- GUI applyRun.detail and the CLI (plan.changes.summary_label "The plan's summary", apply.changes.summary_note "The
  summary above"): "summary" (ko "요약", "계획 요약").
- Suggestion: "summary"/"요약" on the plan screen too (it can still say it is a description of the work).

## Info

- I-1 (the same words): the GUI's new texts equal main's CLI texts in both languages:
  plan.carriedOut/carriedBy = plan.changes.status_carried_out/carried_by; runs.planCarried.* = runs.plan_carried_out,
  _ended, runs.plan_carrying, runs.plan_carried_reverted; run.deniedNotPlanned/Hint = summary.denied_not_planned/_hint
  (U-227's final words); plan.runId = summary.apply_plan_run ("Plan run:"/"계획 실행:").
- I-2 (the same rule): the runs list marks a plan run as carried out when the entry that took its plan up is a run, not
  an apply run, and keeps the apply's words for record_missing (history.ts carriedMark, runs-screen.ts), as the CLI's
  runs table does since U-221. The run screen counts deniedNotPlanned from the carrying run's records
  (tool_decision, allowed false, code path_not_writable), the CLI's rule (run.ts); only for a result with planRunId.
- I-3: run.planChanges "A plan was made: {count} files to write" vs the CLI's summary.plan_ready_changes "A plan is
  ready: {count} file(s) to write …"; Korean starts the same ("계획을 만들었습니다: 쓸 파일 {count}개"). The GUI's own
  plan of moves line also says "A plan was made", so the GUI is consistent with itself.
- I-4: the GUI shows the term "run plan"/"실행 계획" ("Apply this run plan?", "Run plan: …"), as docs/usage.md names it
  (18.11); the CLI's shown texts do not use the term ("Plan of run …", "Start the run that makes these changes?").
  Not a disagreement in meaning.
- I-5: R-106 L-2 is closed here: startApply gives the carrying run's observer `onRunEvent` and `confirm` (asks), and
  a run plan's end is read as a run's result with planRunId (applyOutcomeValue).
- I-6 (outside this reading's question): the engine host does not read `lockLeft` of an apply's outcome (nor of a
  run's); a run plan's apply whose lock is left is shown without the line (R-106 L-1's GUI side).
