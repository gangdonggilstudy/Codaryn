# R-66 병합 전 검토: 단위 U-36, plan·apply·review·changes의 사람용 글을 카탈로그로 (w3:p4, 2026-11-13)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어. 읽기 전용이며 저장소 수정·커밋은 없다.
- **검토한 판: `pm/unit-U-36` = `86b2a0f`**(main `022a400` 위, 10파일 1070줄). 비교판은 main `022a400`.
  - 고친 곳
    - `src/cli/plan-commands.ts`: `renderPlan`의 줄, `applyQuestion`, `unsafeMoveQuestion`, `renderReview`
    - `src/cli/changes.ts`: `renderChanges`의 말(`ChangesWords`)
    - `src/contracts/*`
    - `src/i18n/en.ts`·`ko.ts`: 새 문구 id 35개씩
  - `src/cli/main.ts`는 고치지 않았다.
- 사본: `.codaryn/r66/u`(`86b2a0f`), `r66/m`(`022a400`). 둘 다 `npm run build` 성공. 확인 뒤 지웠다.
- 실험
  - `r66/r66.mjs`(구역 S, Q, U): 같은 순서의 명령을 판 둘 × 언어 둘로 돌렸다.
    - 계획 보기(적용 전, 적용됨, 표시 있음)
    - 검토 받아들임·거절(바꿈), 각각 `--json`
    - 문서 실행의 `changes`: 상태 넷 가운데 셋, 보이지 않는 이유 셋, 250줄 파일, 바뀐 파일, 표시 있음
    - 적용 실행의 `changes`, 적용과 그 거부, `runs`
  - `r66/cj.mjs`·`cj2.mjs`: `changes --json` 전체 비교
  - `r66/rd.mjs`: 판의 렌더러에 실제 JSON을 넣고 한국어 카탈로그로 그림
  - 로그는 `r66/*.log`.
  - 모든 CLI 호출에 시험의 네트워크 막이를 얹었다. 대본(scripted) 모델과 예시만 썼고, 주소는 쓰지 않았다.
  - 가릴 값은 합성 값 하나(`R66SECRETVALUE1`, 키 모양이 아님)를 task의 `secretEnv`로 등록했다.
  - 터미널 질문: R-58의 미리 읽기(`r58/tty.mjs`)로 stdin·stdout·stderr를 터미널로 표시하고, 답을 파이프로 줬다.
  - 위험한 이동 동의 질문은 하드 링크가 없는 드라이브가 있어야 나온다. 그래서 판의 `unsafeMoveQuestion`을 직접 불렀다.
  - 비교는 실행 id, 시각, 해시, 다이제스트, 소요 시간, 임시 폴더 이름, 가린 값 토큰의 16진수만 치환했다.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 1 (R66-M1) |
| 낮음 | 4 (R66-L1~L4) |
| 정보 | 5 (R66-I1~I5) |

| 볼 것 | 결과 |
| --- | --- |
| (1) 모든 `--json`과 `apply`의 JSON | **main과 같다**(S, 두 언어) |
| | - 같은 것: `plan --json` 넷(적용 전, 적용됨, 표시 있음 둘), `review --json` 둘, `apply`의 결과 JSON(완료, `plan_stale`), 거부 둘(틀린 다이제스트, 두 번째 적용) |
| | - `changes --json`은 적용 실행이 같고, 문서 실행·간편 형식·표시 있음이 다르다. 다른 곳은 가릴 값이 든 경로의 토큰 하나뿐이다 |
| | - 그 토큰의 16진수 두 조각은 같은 판에서도 실행마다 달라진다(`CJ2.log`). 16진수를 치환하면 바이트까지 같다(`CJ.log`) |
| (2) 영어 사람용 출력에서 달라진 줄 | **PM이 받아들인 세 가지는 실제 CLI에 나오지 않는다**(R66-M1). 대신 받아들이지 않은 세 가지가 바뀌었다 |
| | - `plan`(적용됨): `Applied by run <id> at <UTC 시각>.` → `Applied by run <id> (<지역 시각>)`(R66-L1) |
| | - `changes`(표시 있는 실행): 새 줄 `This run has a records-changed mark, so no file text is shown; only paths and states.`(R66-L2) |
| | - 위험한 이동 동의 질문: 글이 바뀌었다(R66-L3, 직접 부름) |
| | - 그 밖에 같은 것: 계획 보기(적용 전, 표시 있음), `review` 둘, 나머지 `changes`, `apply`의 사람용 요약과 `[y/N]` 질문(`Apply this plan? [y/N] `), `runs` |
| (3) 한국어의 뜻 | **실제 CLI에서 한국어로 나오는 것(계획 보기, 두 질문)은 뜻이 맞다.** `review`와 `changes`는 실제 CLI에서 영어다(R66-M1). 카탈로그로 그리면(`RD.log`) 뜻이 맞다 |
| | - 계획 머리 줄 `실행 <id>의 계획: 동작 3개, 적용 전`(적용되면 `적용됨`), `다이제스트: …` |
| | - 동작 줄 `1. 이동  …  ->  …`, `3. 폐기  … (지울 때까지 폐기 보관함 .codaryn/discarded/에 남음)`. 화면 폭에 맞춰 칸을 맞췄다 |
| | - `적용하려면: codaryn apply <같은 task 형식> --run <id> --digest <앞 12자>` |
| | - `적용됨(적용 실행 <id>) (2026-11-13 07:46:11)`: 시각 꼴이 `runs`와 같다(지역 시각, 초까지). 괄호가 두 번 겹친다(R66-L1) |
| | - 질문: `이 계획을 적용할까요? [y/N] (Enter: 아니오)`. 위험한 이동 동의 질문의 한국어 글(R66-L3의 표)도 뜻이 맞다 |
| | - `review`: `실행 <id>의 검토: 받아들임.`, `… 거절함(앞선 검토를 바꿈).`, `실행의 결과와 기록은 바뀌지 않았습니다. …` |
| | - `changes` 머리 줄: `실행 <id>의 변경. 지금 등록된 가릴 값으로 가렸습니다(실행이 가린 것이 아님)` |
| | - `changes` 상태 넷: `실행이 남긴 그대로`, `실행 뒤에 다시 바뀜`, `이제 없음`, `지금 읽을 수 없음` |
| | - `changes` 이유: 예 `내용을 보이지 않음: 원본이나 지금 파일이 UTF-8 글이 아님 (not_text)` |
| | - `changes` 나머지: `… 50줄 더 있음`, 기록 변경 표시 줄, 적용 실행 줄, `실행이 바꾼 파일이 없습니다` |
| (4) 질문에 한국어로 답하기 | **`예`, `네`를 받는다**(Q, 두 언어 같음). 공백은 무시된다 |
| | - 승인: `y`, `Y`, `yes`, `YES`, `예`, `네`, ` 네 ` |
| | - 거절: `응`, `ㅇ`, `ㅛ`(한글 입력 상태에서 y 키), `n`, `아니오`, `아니요`, Enter |
| | - 질문 줄에는 카탈로그 글과 개수만 있다. 그 위의 계획 보기에는 모델의 설명(`  | ` 줄)과 계획의 경로가 있다. main과 같은 처리다(R66-I2) |
| (5) 한국어 출력에 남은 영어 | `review`·`changes` 전부(R66-M1). 고친 뒤에도 남을 것은 R66-I3 |

## 2. 중간

### R66-M1 실제 CLI에서 `review`와 `changes`가 한국어로 나오지 않는다

- 위치: `src/cli/main.ts`(이 판에서 고치지 않음).
  - 209행 `runChanges({ argv, env: process.env, app: … })`: `messages`를 넘기지 않는다.
  - 234행 `runReview(shared)`: 217행의 `shared`에는 `messages`가 없다. `plan`(233행)과 `apply`에는 `messages: human.messages`를 넘긴다.
  - `renderChanges`와 `renderReview`는 카탈로그가 없으면 U-36 전의 영어를 그대로 낸다(`changes.ts`의 `ENGLISH_WORDS`, `plan-commands.ts`의 `catalogLine`).
- 재현(S, `S.log`, `CODARYN_LANG=ko`)
  1. 18.2의 파일 정리 예시에 내장 `analyze` 작업 실행을 더하고 `codaryn review --task … --run <id> --accept`를 한다.
     - 출력은 `Review of run <id>: accepted.` … `The run's result and records are unchanged; …`이다. main과 바이트까지 같다.
  2. 문서 실행 뒤 `codaryn changes --task … --run <id>`를 한다.
     - 출력은 `changes of run <id>, masked with …`, `== kept.md: created by the run; as the run left it` 등 전부 영어다. main과 같다(토큰 제외).
     - 적용 실행, 바꾼 파일이 없는 실행, 표시 있는 실행도 같다.
  3. 같은 JSON을 판의 `renderChanges(…, 한국어 카탈로그)`와 `renderReview(…)`로 그리면 한국어가 나온다(`rd.mjs`, `RD.log`). 렌더러와 문구는 됐고, CLI가 카탈로그를 주지 않을 뿐이다.
- 영향
  - 이 단위의 목표 가운데 `review`와 `changes`의 한국어(UXM-7 ③)가 사람에게 닿지 않는다. 한국어 사용자에게는 두 명령이 그대로 영어다.
  - PM이 받아들인 영어의 바뀜도 나오지 않는다: `changes`의 보이지 않는 이유 줄과 적용 실행 줄. 영어 카탈로그에만 있다.
  - 유닛 시험은 이 빈 곳을 잡지 못한다. 이 단위의 시험 `tests/unit/cli/u36-plan-texts.test.ts`와 `tests/unit/cli/changes.test.ts`의 새 부분은 렌더러(`renderPlan`, `renderReview`, `renderChanges`, 두 질문 함수)에 카탈로그를 넣어 직접 부른다. 실제 CLI를 띄우지는 않는다(코드로 봄).
- 고칠 방향(제안)
  - `main.ts`에서 `runChanges`에 `messages: human.messages`를 넘긴다.
  - `runReview`에 `{ ...shared, messages: human.messages }`를 넘긴다.
  - 실제 CLI로 `CODARYN_LANG=ko`의 `review`·`changes`를 보는 시험을 하나 더한다.
  - 고치면 영어 출력도 영어 카탈로그로 바뀐다(이유 줄, 적용 실행 줄. R66-L4의 `(DR-29)`도 함께 본다).

## 3. 낮음

### R66-L1 영어 `Applied by` 줄이 바뀌었다(받아들인 목록에 없음)

- 위치: `src/cli/plan-commands.ts`의 `renderPlan`, `plan.applied_by`(`en.ts:62`)
- 재현(S): 적용한 계획의 `codaryn plan`
  - main: `Applied by run 20261112T224604Z-02bca7db at 2026-11-12T22:46:04.310Z.`
  - 판: `Applied by run 20261112T224559Z-92b3ad3f (2026-11-13 07:45:59)`. 지역 시각이고, `at`과 마침표가 없다.
  - 표시가 있는 적용된 계획도 같다.
- 영향: 사람이 읽기에는 나아졌고 `runs`의 시각 꼴과 맞는다(UXM-23으로 보인다). 그러나 PM이 받아들인 영어 변화 목록에 없다. 이 줄을 읽는 스크립트가 있으면 깨진다(JSON의 `appliedBy.at`은 그대로다).
- 한국어 `적용됨(적용 실행 <id>) (<시각>)`은 괄호가 두 번 이어진다. `적용 실행 <id>가 적용함(<시각>)`처럼 한 번이면 읽기 쉽다.
- 고칠 방향: PM이 받아들이거나, 영어는 예전 꼴로 둔다.

### R66-L2 영어 `changes`에 기록 변경 표시 줄이 새로 생겼다(받아들인 목록에 없음)

- 위치: `src/cli/changes.ts:147`(`ENGLISH_WORDS.recordsChanged`)과 `renderChanges`. 카탈로그가 없을 때도 나오므로 실제 CLI에 보인다.
- 재현(S): 문서 실행 폴더에 `records-changed.json`을 두고 `codaryn changes --task … --run <id>`
  - 판에는 머리 줄 다음에 `This run has a records-changed mark, so no file text is shown; only paths and states.`가 있다. main에는 없다(두 언어. 한국어도 이 영어 줄이 나온다, R66-M1).
- 영향: 이유를 말해 주므로 나은 바뀜이다. 그러나 받아들인 목록 밖이고, 주석은 "카탈로그가 없으면 U-36 전 그대로"(`changes.ts:15-17`)라고 했다.
- 고칠 방향: PM이 받아들이고 주석을 고친다. 또는 카탈로그가 있을 때만 낸다.

### R66-L3 위험한 이동 동의 질문의 영어 글이 바뀌었다

- 위치: `apply.unsafe_move_question`(`en.ts:65`). 실제 CLI의 `apply`는 카탈로그를 넘기므로 이 글이 쓰인다.
- 재현(U, `U.log`, 판의 `unsafeMoveQuestion`을 직접 부름)

  | | main(판의 카탈로그 없는 글과 같음) | 판의 영어 카탈로그 |
  | --- | --- | --- |
  | 1개 | `1 move of this plan can only be made without the guarantee that nothing at the destination is replaced (the drive has no hard links). Nothing was moved. Apply again and make it anyway, for this apply only? [y/N]` | `1 move(s) of this plan could replace a file at the destination, since the drive has no hard links. Nothing was moved. Apply again and make them anyway, for this apply only? [y/N]` |
  | 2개 | `2 moves … make them anyway …` | `2 move(s) … make them anyway …` |
  | 한국어 | | `이 계획의 이동 1개는 이 드라이브에 하드 링크가 없어 대상 자리의 파일을 덮어쓸 수 있습니다. 아무것도 옮기지 않았습니다. 이번 적용에서만 그래도 옮기도록 다시 적용할까요? [y/N] (Enter: 아니오)` |

- 영향: 받아들인 목록 밖의 영어 변화다. 1개일 때 `move(s) … them`으로 단수가 없어졌다. 뜻("덮어쓸 수 있다")은 예전("덮어쓰지 않는다는 보장 없이")보다 직접적이다.
- 실제 터미널 질문으로는 보지 못했다(하드 링크가 없는 드라이브가 필요하다).
- 고칠 방향: PM이 받아들이거나 예전 영어로 둔다. 단수·복수를 나누려면 문구 id를 둘로 둔다.

### R66-L4 영어 카탈로그의 `changes.no_text_note`에 `(DR-29)`가 남았다

- 위치: `en.ts:174`. 한국어(`ko.ts`)에는 없다.
- 영향: PM이 받아들인 "결정 번호 (DR-29) 제거"가 영어에서는 되지 않았다. 지금은 R66-M1 때문에 카탈로그를 안 쓰므로 실제 출력은 main과 같다. 하지만 M1을 고치면 영어 출력에 `(DR-29)`가 그대로 남는다. 카탈로그 없는 영어(`ENGLISH_WORDS`)에도 남는다.
- 고칠 방향: 영어 카탈로그에서 `(DR-29)`를 뺀다. 카탈로그 없는 영어는 U-36 전과 같게 두는 원칙이면 그대로 둔다.

## 4. 정보

- **R66-I1 한글 입력 상태의 `y`(`ㅛ`)는 거절이다.** 답 목록은 `y`, `yes`, `예`, `네`다(`plan-commands.ts:563`). 한국어 질문은 `[y/N] (Enter: 아니오)`라고만 하고, `예`·`네`를 받는다는 말은 없다. 거절 쪽이라 안전하지만, 한글 입력으로 y를 누른 사람은 그냥 거절된다.
- **R66-I2 질문 글에 섞이는 글.** 두 질문 줄은 카탈로그 글과 개수뿐이다. `[y/N]` 질문 위의 계획 보기에는 모델의 설명(quoteModelText의 `  | ` 줄, 키 모양은 `[key]`)과 계획 경로(정리하고 키를 숨김)가 들어간다. main과 같다(R-52b에서 봤다).
- **R66-I3 M1을 고쳐도 한국어에 남을 영어.**
  - `review`: 내장 `analyze`의 확인 항목(`The report's interpretation matches the result table.` 등, 작업 종류 정의의 영어)
  - `changes`: 괄호 속 이유 코드(`(not_text)`), `@@ -1,0 +1,1 @@`, 파일 글 자체
  - 계획 보기: 명령 줄과 경로, `->`
  - 질문: `[y/N]`
- **R66-I4 가린 값이 든 경로는 토큰이 두 겹으로 보인다.** `path-[[[[CODARYN_SECRET:…]]:…]].md`이고 상태는 `could not be read now`다. main도 같아 이 단위의 것은 아니다.
- **R66-I5 보지 않은 줄.**
  - `plan.inventory_limit`: 인벤토리 상한이 필요하다
  - `changes.state.unknown`의 다른 원인
  - `masked_path` 말고 `snapshot_missing`·`too_large`·`unreadable`·`mask_failed`의 실제 출력. 카탈로그 글은 읽어 봤다

## 5. 검사하지 않은 범위

- 실제 콘솔 창(미리 읽기로 흉내 냈다), 하드 링크가 없는 드라이브의 동의 질문(직접 부름으로 대신), GUI(이 단위는 GUI를 고치지 않았다)
- 루트 유닛·통합 시험 재실행(PM이 이 판에서 잰 수치를 받았다)

## 6. PM 판단 필요

- **Q-1(R66-M1)**: `main.ts`를 고쳐 `review`·`changes`에 카탈로그를 넘길지. 고치면 영어 출력도 영어 카탈로그의 글(받아들인 이유 줄과 적용 실행 줄)로 바뀐다. 가정: 고친다. 이 단위의 목표이기 때문이다.
- **Q-2(R66-L1~L3)**: 받아들인 목록 밖의 영어 변화 셋을 받아들일지.
  - `Applied by`의 지역 시각
  - `changes`의 표시 줄
  - 동의 질문 글

사용자에게 물을 질문은 없다.


---

# R-66b 좁은 확인: 단위 U-36 고친 판 (w3:p4, 2026-11-13)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어. 읽기 전용이며 저장소 수정·커밋은 없다.
- **검토한 판: `pm/unit-U-36` = `cb8e17d`**(main `9411575` 위). 비교판은 main `9411575`.
- R-66(`86b2a0f`) 뒤의 U-36 수정(`git log --oneline --no-merges 86b2a0f..cb8e17d` 가운데 U-36의 것)
  - `68648af`: `main.ts`가 `review`·`changes`에 카탈로그를 넘긴다. 시험은 `ba90a7a`
  - `c71da18`: 영어 `changes.no_text_note`에서 `(DR-29)`를 뺐다. 한국어 `plan.applied_by`를 괄호 한 쌍으로 바꿨다. 영어 동의 질문을 개수와 상관없는 꼴로 바꿨다. 한국어 `[y/N]`에 받는 답을 적었다.
  - `52dce57`: 주석. `1d91f86`, `9a161d6`: 시험의 기대값
  - 그 밖의 커밋(U-48, U-51, U-52, U-53)은 main에서 받아 온 것이다.
- 사본: `.codaryn/r66b/u`(`cb8e17d`), `r66b/m`(`9411575`). 둘 다 `npm run build` 성공. 확인 뒤 지웠다.
- 실험: R-66의 `r66.mjs`를 그대로 썼다(구역 S, Q, U, 로그 `r66b/*.log`). 하나만 바꿨다: 가린 값 토큰의 16진수 16자를 모두 치환해, 실행마다 달라지는 토큰 조각(R-66에서 확인)을 비교에서 뺐다.
  - 터미널 질문은 R-58의 미리 읽기로 흉내 냈다. 동의 질문은 하드 링크가 없는 드라이브가 있어야 나오므로 판의 `unsafeMoveQuestion`을 직접 불렀다.
  - 시험의 네트워크 막이를 얹었다. 대본(scripted) 모델만 썼고 주소는 쓰지 않았다.

## 1. 요약

| 심각도(새로 찾은 것) | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 0 |
| 정보 | 2 (R66b-I1, I2) |

| 볼 것 | 결과 |
| --- | --- |
| **M1** 실제 CLI의 한국어 `review`·`changes` | **닫혔다**(S, `CODARYN_LANG=ko`) |
| | - `review`: `실행 <id>의 검토: 받아들임.`, `… 거절함(앞선 검토를 바꿈).`, `실행의 결과와 기록은 바뀌지 않았습니다. 판정은 codaryn report가 보여 줍니다.` |
| | - `changes`(문서 실행): 머리 줄, 안내 줄, `실행이 만듦`·`실행이 바꿈`, 상태 넷, 이유 셋(`masking_unverified`, `not_text`, `masked_path`), `… 50줄 더 있음`, `원본과 다른 곳이 없음` |
| | - `changes`의 나머지: 바꾼 파일이 없는 실행, 적용 실행 줄, 기록 변경 표시 줄 |
| | - 모두 한국어다. main은 같은 경우 모두 영어였다 |
| 영어 출력에서 달라진 줄 | **PM이 받아들인 것뿐이다**(S). 영어 사람용 출력 12가지 가운데 다른 것은 아래 다섯 종류뿐이다 |
| | - `changes`의 안내 줄: 끝의 `(DR-29)`가 빠짐 |
| | - `changes`의 이유 줄: `the text is not shown: the original or the file now is not UTF-8 text (not_text)`, `… its recorded path has a masked part (masked_path)`. `masking_unverified`는 예전 그대로 `the text is not shown (masking_unverified)` |
| | - `changes`의 적용 실행 줄: `This run applied the plan of run <id>; actions applied: 3. …` |
| | - `changes`의 기록 변경 표시 줄: `This run has a records-changed mark, so no file text is shown; only paths and states.` |
| | - `plan`의 `Applied by run <id> (<지역 시각>)`(적용된 계획 둘) |
| | - 동의 질문의 글(U, 아래 L3) |
| | - 같은 것: 계획 보기(적용 전, 표시 있는 적용 전), `review` 둘, 바꾼 파일이 없는 실행의 `changes`, `apply`의 요약과 `Apply this plan? [y/N]`, `runs` |
| **L1** 한국어 `Applied by` | **닫혔다.** `적용 실행 <id>에서 적용함 (2026-11-13 08:08:50)`으로 괄호가 한 번이다. 같은 작업 공간의 `runs`도 `2026-11-13 08:08:50` 꼴이다(지역 시각, 초까지, `S.log`의 `Applied by times`) |
| **L3** 동의 질문, 개수 1 | **닫혔다**(U) |
| | - 영어: `Moves of this plan that could replace a file at the destination, since the drive has no hard links: 1. Nothing was moved. Apply again and make such moves anyway, for this apply only? [y/N]`. 1과 2 모두 문법이 맞다 |
| | - 한국어: `이 계획의 이동 1개는 이 드라이브에 하드 링크가 없어 대상 자리의 파일을 덮어쓸 수 있습니다. …`. 1개도 자연스럽다 |
| **L4** `(DR-29)` | **닫혔다.** 영어 카탈로그와 실제 영어 출력 모두에 없다. 한국어에도 없다 |
| **I1** 질문이 받는 답을 알리는지 | **알린다(한국어).** `이 계획을 적용할까요? [y/N] (y·예·네: 예, Enter: 아니오)`. 동의 질문도 같은 꼴이다. 영어는 `[y/N]` 그대로다 |
| | - 받는 답은 R-66과 같다: 승인 `y`·`Y`·`yes`·`YES`·`예`·`네`(공백 무시), 거절 `응`·`ㅇ`·`ㅛ`·`n`·`아니오`·`아니요`·Enter(Q, 두 언어) |
| 모든 `--json` | **main과 같다**(S, 26가지, 두 언어). `plan --json` 넷, `review --json` 둘, `changes --json` 넷, `apply`의 결과 JSON(완료, `plan_stale`), 거부 둘. 종료 코드도 모두 같다 |

## 2. 정보

- **R66b-I1 한국어 `review`의 확인 항목은 영어다.** 내장 `analyze` 작업 종류 정의의 글(`The report's interpretation matches the result table.` 등)이다. R-66의 R66-I3과 같고, 이 단위의 범위 밖이다.
- **R66b-I2 사라진 파일에는 "원본과 다른 곳이 없음"이 나온다.** 실행 뒤에 지운 파일(`이제 없음`)의 줄 아래에 `원본과 다른 곳이 없음`(영어 `no difference to the original`)이 붙는다. 기록 변경 표시가 있어 "파일 글을 보이지 않는다"는 실행에서도 그렇다. main의 영어도 같아서 이 단위가 만든 것은 아니다. "지금 파일이 없어 비교하지 않음" 같은 글이 더 맞다.

## 3. 검사하지 않은 범위

- 하드 링크가 없는 드라이브에서의 실제 동의 질문(함수를 직접 불러 대신했다), 실제 콘솔 창
- `plan.inventory_limit`와 이유 넷(`snapshot_missing`, `too_large`, `unreadable`, `mask_failed`)의 실제 출력
- 루트 유닛·통합 시험 재실행(PM이 이 판에서 잰 수치를 받았다)

## 4. PM 판단 필요

- 없음.

사용자에게 물을 질문은 없다.
