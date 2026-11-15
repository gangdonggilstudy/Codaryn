# R-98 좁은 검토 — U-163 GUI 낱말을 CLI 낱말로 (`pm/unit-U-163` 11897f2 = main 38d1792 + `unit/U-163-p5u-gui` f28c21a)

- 검토자: nc-human. 읽기 전용이다. 저장소 수정, 커밋, worktree 없음.
- 기준: nb-i18n 조사 `D:\project\Codaryn\.worktrees\claude-quality\.codaryn\report-U159.md`의 14개념과 그 제안.
- 본 것: `git diff 38d1792 11897f2`(GUI 카탈로그 en·ko, `gui/src/main/dialog-texts.ts`, `runs-screen.ts`, `docs/design/standalone-gui.md`, 시험 둘), 그리고 판의 GUI 카탈로그·대화상자 글 전체에서 옛 낱말 찾기, CLI 카탈로그(판의 `src/i18n`)와 대조.
- GUI 시험은 돌리지 않았다(낱말 검토). 단위의 시험 `u163-cli-words.test.ts`가 한국어 고정 줄을 본다.

## 결론

- **높음 0, 중간 1, 낮음 4, 정보 3.** 병합을 막을 것은 없다.
- 14개념의 **한국어는 조사대로 모두 맞춰졌다**. #6·#13은 CLI 쪽(nb-i18n)이 이미 GUI 말로 맞춰 두 쪽이 같다.
- 남긴 영어 `outcome.fail` "failed"는 조사의 높음 #3이 짚은 혼동을 영어 창에 그대로 남긴다(M-1).
- 새로 어긋난 것은 셋이다: #9의 "동의"가 한 줄 남음(L-1), 정리 확인 대화상자의 "제자리에 두지 못한"(L-2), 몇 영어 글(L-3).
- 한 화면 안의 섞임: 정리 결과 목록에서 "확인하지 않아 남김"과 "…지우기에 동의하세요"가 함께 나온다(L-1).

## 14개념

| # | 개념 | 결과(판) |
| --- | --- | --- |
| 1 | 검토 | 맞음. `review.title` "사람의 검토", `report.tab.review`·`runs.review` "검토", `error.run_not_awaiting_review` "사람의 검토를…", 체크리스트 머리 `run.review` "확인할 항목"(CLI `summary.review_checklist` "확인할 항목"과 같음). GUI 한국어에 "사람 확인"이 없다 |
| 2 | 판정 낱말 | 맞음. 단추 "받아들이기 / 거절하기", 확인 "받아들임으로 남길까요?", 결과 "확인 필요 → 사람이 받아들임". "반려"가 없고, 검토 쪽에 "승인"이 없다(계획 승인에만 남음) |
| 3 | 검증 결과 fail | 한국어 맞음("미통과", 실행 상태 "실패"와 다름). **영어는 "failed"로 남음 → M-1** |
| 4 | 기록 변경 표시 | 맞음(두 언어). 정리 화면 "기록 변경됨(실행이 아닌 것이 바꿈)" / "records changed (not by the run)", 실행 목록은 U-157의 짧은 표시와 목록 아래 한 줄. 보고서·변경·계획·되돌리기 글도 "기록 변경 표시"로 맞음 |
| 5 | 가릴 값 | 맞음. "설정에 등록한 가릴 값뿐", "(가릴 값은 가린 채)" |
| 6 | 경로의 가린 값 되살리기 | 두 쪽이 같음(CLI가 이미 GUI 말로 바꿈) |
| 7 | 작업 지정 방식 | 한국어 맞음(`error.form_unknown`, `report.reviewCli`, `plan.formUnknown`). 영어 `report.reviewCli` "task part"는 남음(L-3) |
| 8 | 한도 없음 | 맞음 |
| 9 | 폐기 보관함 지우기의 확인 | `cleanup.kept.not_confirmed`는 맞음(두 언어). **`cleanup.kept.discarded_left`에 "동의"가 남음 → L-1** |
| 10 | 앞선 정리 | 맞음(summary·plan·warning) |
| 11 | 일반 폴더 | 맞음 |
| 12 | 제자리에 돌려놓다 | 화면 글은 맞음(summary·plan). **메인 대화상자 `cleanup.detail`이 "두지 못한" → L-2** |
| 13 | 실행을 시작할 때 / 검증 뒤 | 한국어는 두 쪽이 같음. 영어는 "at the start"/"after the checks"와 CLI "at start"/"after checks"로 조금 다름(L-3) |
| 14 | 손상 | 한국어 맞음("손상(기록을 확인할 수 없음)"). 영어 `runs.damaged` "records cannot be checked"에 "damaged"가 없음(L-3) |

## 중간

### M-1 영어 `outcome.fail` "failed"를 남긴 판단

- 조사 #3(높음)의 제안은 두 언어 모두 "not passed / 미통과"였다. 한국어만 바뀌었다. 단위의 커밋 설명과 설계 문서에는 영어를 남긴 까닭이 없다.
- 영어 창에서 검증 하나가 안 된 것(`outcome.fail` "failed")과 실행이 실패한 것(`runstatus.failed` "failed")이 같은 낱말이다. 같은 결과 화면에서 "failed" 실행 아래에 "failed" 검증이 보일 수도 있고, 검증이 안 됐는데 실행은 "needs input"인 경우에도 "failed"가 보인다. 조사가 높음으로 둔 혼동이 영어에 그대로 있다.
- CLI 영어는 "passed / not passed"다(`outcome.pass`, `outcome.fail`). ux-design 6절 표도 "검증 미통과"와 실행 "실패"를 나눈다.
- 영어 "failed"를 고정한 GUI 시험은 찾지 못했다(`gui/tests`에서 `outcome.fail`을 보는 것은 `u163`의 한국어 단언뿐).
- 권고: GUI 영어도 "not passed"로 맞춘다(이 단위에서 한 줄, 시험에 영어 단언 하나). 남긴다면 그 까닭(예: 화면 너비)을 설계 문서에 적는다.

## 낮음

### L-1 정리 결과 목록에서 "확인"과 "동의"가 섞인다 (#9의 남은 한 줄)

- `cleanup.kept.not_confirmed`: "폐기 보관함 지우기를 **확인하지** 않아 남김" / "…was not confirmed"(바뀜).
- `cleanup.kept.discarded_left`: "…그 폐기 보관함도 골라 지우기에 **동의하세요**" / "…choose its discarded files too and **agree** to delete them"(그대로).
- 둘 다 정리 결과의 "남김" 줄이라 한 목록에 함께 나온다. "동의"는 DR-25의 덮어쓸 위험이 있는 이동 쪽 낱말이고, 폐기 보관함 지우기는 확인이다(조사 #9, 이 단위의 커밋 설명도 그렇게 말한다).
- 권고: "…그 폐기 보관함도 골라 함께 지우세요" / "…choose its discarded files too and delete them"(또는 "확인하세요"/"confirm").

### L-2 정리 확인 대화상자가 "제자리에 두지 못한"이다 (#12)

- `gui/src/main/dialog-texts.ts` KO `cleanup.detail`: "…되돌리기가 제자리에 **두지** 못한 파일은 지우지 않습니다."
- 화면 글(`cleanup.summary.parked`, `cleanup.plan.parked`)은 이 단위에서 "제자리에 **돌려놓지** 못한"으로 바뀌었다. 대화상자는 정리 계획 화면 바로 뒤에 나온다.
- 영어는 두 곳 다 "could not put back"이라 맞다.
- 권고: 대화상자 한국어를 "돌려놓지 못한"으로.

### L-3 조사 표에 있던 영어 몇 글이 그대로다

- `runs.damaged` "records cannot be checked": CLI "damaged (the record could not be checked)". 한국어는 "손상"을 앞에 두었다(#14).
- `report.reviewCli` "task part": 같은 GUI의 `error.form_unknown`은 "task form"이고, CLI도 "task form"이다(#7). 영어 창에 같은 것을 두 낱말로 쓴다.
- `run.review` "Checklist for a person": CLI "Items to check". 한국어는 CLI 말("확인할 항목")로 바꿨다.
- `phase.*` "at the start" / "after the checks": CLI "at start" / "after checks"(#13, 뜻은 같음).
- 권고: 위 넷을 CLI 영어로(또는 한국어처럼 맞추기로) 정한다. 바꾸면 GUI 영어 고정 시험이 있는지 그 단위에서 먼저 본다.

### L-4 설계 문서의 규칙 문장이 실제 낱말보다 넓다

- `standalone-gui.md`: "'확인'은 권한 확인과 상태 '확인 필요'에만 쓴다."
- 실제로 GUI는 다른 뜻의 "확인"도 쓴다(CLI와 같은 말이라 낱말로는 맞다): `run.review` "확인할 항목", `plan.title` "계획 확인", `runs.damaged` "기록을 확인할 수 없음", `cleanup.kept.not_confirmed` "확인하지 않아".
- 권고: "검토 단계는 '검토', 판정은 '받아들임·거절함'이고 '승인'은 계획 승인에만 쓴다"처럼 실제로 정한 것만 적는다.

## 정보

- **I-1** #6(경로의 가린 값 되살리기)과 #13(한국어 단계 낱말)은 CLI 쪽이 이미 바뀌어 두 쪽이 같다. 이 단위가 할 일은 없었다.
- **I-2** 영어 `settings.providerNotice` "(secrets masked)": CLI 영어도 가릴 값을 "secrets"라 부른다(`changes` 머리 "masked with the secrets registered now"). 한국어만의 문제였다(#5).
- **I-3** 권한 대화상자 단추 "이번 호출에만 허용"은 CLI 진행 줄 "권한 확인 — 사람이 이번 호출에만 허용함"과 같다. 기록 변경 표시의 목록 아래 한 줄(`runs.recordsChangedNote`)은 CLI `runs.records_changed_note`와 글자까지 같다(두 언어).

## 수치

- 바뀐 글: GUI 한국어 약 40줄, 영어 4줄, 대화상자 1줄. 시험 `u163-cli-words.test.ts`(새, 145줄), `u48-model-rows-changes-mark.test.ts` 맞춤.
- GUI 시험은 이 검토에서 돌리지 않았다.
