# R-110b — re-review of R-110 on U-210's tip, read by nc-human

- Tip: `unit/U-210-na-core` = `2fcc01c42b9b8f50c2fed4de363ef34d7cc5fdad` (git rev-parse). Since R-110's board (28a40ca):
  f1b315cb (tests first) and 2fcc01c4 (the fix: run.ts, task.ts, doctor.ts, plan-commands.ts, contracts engine.ts
  and human.ts, en, ko, cli-contract).
- Ran: the tip's real CLI (`git archive` to the scratchpad, node_modules junction, `tsc`; removed after), the scripted
  model, R-110's workspace (`private/people.csv` under unreadablePaths, values marked `ZQX`), `CODARYN_LANG` en and ko:
  the analyze-private run and `review --accept`; analyze-private without unreadable paths; a command rule with
  unreadable paths under the default task type and under analyze-private; `minGroupSize: 3`; the document task type
  with unreadable paths; the document task type with a command rule and no unreadable path. `doctor --task` on each
  refused task. No network, no key. nc-human's held patch (.codaryn/u246-reasons.patch) is not used.

## R-110's four

| R-110 | Now | What the real CLI shows |
| --- | --- | --- |
| M-1 the refusal's reason in JSON only | **closed** | Each refusal ends with its reason line, both languages: unreadable_paths_required (no list), unreadable_with_commands (a command rule under the default task type, and under analyze-private, where it was "the workflow allows no command"), and the new min_group_size_range (k 3). doctor names the reason for the empty list now (a note under the task file check) and for k; for the commands it did already. A command rule without unreadable paths gets no such hint. |
| L-1 the query_table clause where the task type has none | **open** | Not in 2fcc01c4: the document task type with unreadable paths still says "it can still aggregate their tables with query_table" (ko the same). |
| L-2 the hidden-groups line's last clause | **closed** | "…; the agent got neither those groups nor those values, only how many groups were left out." Korean: "에이전트는 그 묶음도 그 값도 받지 않았고, 뺀 묶음의 개수만 받았습니다." |
| L-3 review's checklist | **closed** for review | `review --accept` (ko) shows item 3 in Korean, as the end summary does. Items 1 and 2 stay English (the user's open question); the GUI does not use builtinReviewItemText (p5u-gui). |

No marker, path or column name in either language's output of the analyze-private run (as in R-110).

## The reasons' words (U-37's form and terms)

All three hints, both languages: one line, no parameter, the cause and then the fix, a full stop at the end (U-37's
test passes on the tip); the terms are the catalog's own (unreadablePaths, "command rule", "command check" /
"명령 규칙", "명령 검증기", "kept from the agent" / "에이전트에게서 감춘", "읽기 제외 표").

## Count

| Level | Count |
| --- | --- |
| R-110 closed | 3 (M-1, L-2, L-3) |
| R-110 open | 1 (L-1) |
| New: high | 0 |
| New: medium | 0 |
| New: low | 1 |
| New: info | 4 |

## New

### Low

- L-a — ko `error.hint.unreadable_paths_required`: "개인정보가 든 표의 폴더를 task 파일, 설정 파일, 프로필 가운데 한
  곳에 두세요." tells the person to put the folder in a file. The English says to put it there, in
  policy.unreadablePaths ("Put the folder of the tables with personal data there, in the task file, the config file or
  a profile."), and doctor's Korean note has the entry as its subject, which reads right. Suggestion: "…폴더를 task 파일,
  설정 파일, 프로필 가운데 한 곳의 policy.unreadablePaths에 넣으세요." (nb-i18n's words).

### Info

- I-1: ko `error.hint.unreadable_with_commands` says a command "reads" the hidden files ("감춘 파일도 읽습니다"); the
  English and doctor's Korean say it "can read" them ("읽을 수 있으므로").
- I-2: the hidden-groups line's "only how many groups were left out" leaves out that the agent sees which values are
  empty (a null at the operation's index); it no longer says anything untrue of a value left out.
- I-3: min_group_size_range's "a source can only raise it" / "어느 곳도 낮출 수는 없고 높이기만 합니다" names "a source"
  (config file, profile, task type, task file) without saying which; clear enough beside the field name.
- I-4: the error's general fix line ("If a field is named, fix that field …") still comes before the reason line, as
  for plan_tool_missing; the reason is the last line, after "Check: codaryn doctor".
