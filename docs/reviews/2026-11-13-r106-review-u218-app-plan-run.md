# R-106 — U-218 (p5a: the app carries out a run plan), read by nc-human

- Branch: `unit/U-218-p5a-adapter` at `221fe342f17da00e5d4bb69b0ed182efba024aec` (git rev-parse).
- Read: `git diff f52c228 unit/U-218-p5a-adapter -- src` (merge base f52c228; U-211's commits come with it):
  src/app/app.ts, assemble.ts, check-apply.ts, index.ts, lock-retry.ts, types.ts, workspace-text.ts,
  side by side with the CLI's applyChangesPlan, runPrepared and assembleWith at f52c228, and with main
  cff3c764 (U-220) for the lock.
- Read only. One check run: the merge of main cff3c764 and U-218 as a tree (`git merge-tree
  --write-tree` = e2b32c74, no conflict), archived to the scratchpad with a node_modules junction:
  `npx tsc --noEmit -p .` exit 0. The copy and the junction were removed. No tests run.
- Seen as the store and the human output's owner: the order of the applied record and the lock,
  lockLeft, and the end summary's context (planRunId, writes denied outside the plan).

## Count

| Level | Count |
| --- | --- |
| High | 0 |
| Medium | 0 |
| Low | 2 |
| Info | 6 |

## Low

### L-1 — after main's U-220, the app's apply of moves and its revert drop `lockLeft`

- Where: `src/app/app.ts:900` (`output.kind === "apply"` → `{ ok: true, output }`), `src/app/app.ts:619`
  (revert: `{ ok: true, output }`), `src/app/types.ts:934` (ApplyOutcome's ApplyResult branch has no
  `lockLeft`).
- What: U-220 (main cff3c764) made the CLI's apply and revert keep their result when the lock release
  fails (`src/cli/plan-commands.ts:831` on main; RevertCliOutcome.lockLeft). Before it, the app saw
  those as a throw and said internal_error. Merged with U-218, the app's apply of a plan of moves now
  ends `ok` with no `lockLeft`: the CLI's CommandOutcome carries none (the apply's lockLeft goes only
  to its summary), and the app's revert does not read `RevertCliOutcome.lockLeft`. U-211's later tries
  do not cover these two locks either (the release is the CLI's, not the app's assembly).
- Effect: the workspace stays locked while the app lives (U-176), and nothing said so; the next action
  meets workspace_locked. Within ApplyOutcome the two kinds disagree: a run plan's apply says
  `lockLeft` (U-218), a plan of moves' does not.
- Suggestion: the CLI's runApply returns `lockLeft?: true` on its outcome as U-220 did for the
  revert (src/cli, na-core's, or nc-human with a grant); the app maps it to ApplyOutcome's ApplyResult
  branch (`lockLeft?: true`) and the revert's to its outcome, and may start retryLockRelease for them.
- By reading; not reproduced (U-220's u220 test shows the CLI side; the app side is the lines above).

### L-2 — the GUI host does not take a run plan's apply yet (outside U-218's diff; for the GUI owner)

- Where: `gui/src/engine-host/runs.ts:362-378` (startApply), `runs.ts:185` (applyResultValue).
- What: startApply's observer has `onEvent` only, and `asks` is false, so it has no `confirm`; its
  result is read as an apply's (kind "apply", `applied` list), and `lockLeft` is not read. A config
  workflow with plan "run" makes run plans now (U-218's own test does), and the GUI's plan screen can
  approve one (U-196). Once U-218 is merged, that apply is a model run whose records reach no screen
  (they go to `onRunEvent`), whose permission questions are dismissed (the engine's default deny:
  fails closed), and whose end is shown as an apply of 0 items without its changes or lockLeft.
- Suggestion: a GUI unit after U-218: `onRunEvent` and `confirm` on startApply's observer, and a kind
  "run" branch in the apply's result value (planRunId, planDigest, changes, lockLeft).

## Info

- I-1 (the order of the applied record and the lock; same as the CLI): the app's path is the CLI's
  applyChangesPlan with the app's assembly. Before the lock: the stored plan's kind, `applied.json`
  absent, the records-changed mark, the view's checks, the plan run's goal. Then runPrepared: the
  assembly takes the lock, makes the recorders with `planRunId` (markApplied), and gives
  `approvedPlan`; under the lock the mark is read again (fail closed); the engine checks every
  planned file, then claims the plan (applied.json, `already_applied` → plan_stale), then writes;
  finish stores result.json, then releases. The app's `approvedPlan` (assemble.ts:113-123) is the
  CLI's (assemble.ts:472-481 at f52c228) line for line: the same policyFor, markApplied,
  createPlannedFileProbe, stateUncheckedSince(planRunId, applyRunId) and hasRecordsChangedMark.
- I-2 (lockLeft of the carrying run; same condition as the CLI): the app's finish calls onLockLeft
  when the release answers false or throws; main's CLI finish (U-220) returns `{ lockLeft: true }` on
  the same two. ApplyOutcome gets it through `run.ended` as startRun's RunOutcome does. Only a throw
  starts U-211's later tries (a false answer is another's lock or none), as lock-retry.ts says.
- I-3 (the end summary's context): the app's run has no end summary (`--quiet`, no `human`), as
  startRun has none. planRunId and planDigest are the engine's, in the EngineResult, so they are the
  CLI's values. The CLI's notes (deniedNotPlanned, confirmationDenied, policyNarrowings) are counted
  in runPrepared and not given to the app, as deniedNotWritable never was for startRun. A GUI end view
  can count them from `onRunEvent` records with the CLI's rule: in a run that carries out a plan,
  every `tool_decision` with `allowed: false` and `code: "path_not_writable"` is a write outside the
  plan (run.ts:984-990 at f52c228); the code string is unchanged by the gateway's masking.
- I-4 (refusals under the lock): plan_records_changed under the lock and an assembly without
  `approvedPlan` call finish(null) and end as errors; a lock left there is not told. Main's CLI does
  the same (U-220 reads finish only on the run's own end), so the two agree.
- I-5 (assemble.ts:148-150, context lines, not U-218's change): the app assembly's error path awaits
  releaseLock without a catch, so a release that throws replaces the assembly's own error (the outcome
  is internal_error either way) and starts no later tries. The CLI's took `.catch(() => false)` in
  U-220; the app's could take the same plus retryLockRelease.
- I-6 (cost only): `runObserver` always has `onEvent`, so journalWithEvents masks every record of a
  carrying run even when the caller gave no `onRunEvent`. The cancel channel is one: runApply's
  cancel sources are only on the moves path; runPrepared's comes from `run.parts.cancelSignal`, the
  same handler set as `handle.cancel` (U-218's test covers it).
