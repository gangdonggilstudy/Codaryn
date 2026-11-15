# R-55b 병합 전 확인(좁게): 단위 U-16 — R-55 M-1·L-1 수정

## 0. 대상과 방법

- 페르소나: 검증 엔지니어(주). 이 코드는 내 것이 아니다. 읽기 전용이며, 저장소 파일 수정과 커밋은 없다.
- **확인한 판(고정)**: `pm/unit-U-16` = `f104af2e4b68daf77bbdc2f5a7017d6ebdd2d95a`
  - main `5647704932214e130c5f3f34e44e5b5784aee2e1` 위다. R-55에서 본 `aaabfd7`에 다음 수정이 더해졌다.
    - `43751e5`(계약): `PLAN_APPLY_STATES`, `planApplyStateOf`
    - `3a2de5e`(CLI): 실행 목록
    - `0acc3bb`, `455fd47`(CLI): 되돌리기 안내
    - `1f8dce7`(문구)
  - 작성자는 모두 `gangdonggil`이다.
- 빌드: `git archive`로 `f104af2`는 `.codaryn/r55b/b`에, `5647704`는 `.codaryn/r55b/m`에 풀었다. 둘 다 tsc 오류 0이다.
- 실험
  - 실제 CLI, 대본 모델, 임시 폴더(`%TEMP%`)에서 돌렸다. API 주소는 닫힌 포트 `127.0.0.1:9`이고 키 변수는 없앴다. 실제 API와 외부 네트워크는 쓰지 않았다.
  - `exp3.mjs`(새로 씀): 파일 정리 체험의 계획 하나를 적용 실행의 다섯 상태로 만들었다. 상태마다 다음을 두 판에서 맞대었다.
    - `runs`의 계획 줄(영어·한국어)과 `runs --json`의 그 항목
    - 계획 실행의 `revert --dry-run` 안내(영어·한국어)
  - 다섯 상태를 만든 방법
    - `done`
    - `failed/apply_incomplete`: 두 번째 이동의 폴더를 ACL로 만들 수 없게 함
    - 결과 없음: 명령 검증기가 기다리는 동안
    - `cancelled`: 기다리는 동안 취소 파일
    - 되돌림, 그리고 되돌린 적용 실행의 기록을 정리로 지움(목록에 없음)
  - `exp.mjs`(R-55의 것): 평범한 실행의 비교를 이 두 판으로 다시 했다.
  - ACL은 끝나고 풀었다(임시 폴더 8개, 남은 거부 항목 0). 출력은 `.codaryn/r55b/`에 있다.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 1 (M-1b) |

| 확인할 것 | 결과 |
| --- | --- |
| M-1: 계획 줄의 말이 적용 실행의 상태에서 골라지는지(다섯 경우, 두 언어) | **거짓은 닫혔다. 다섯 상태의 말은 표에 없다.** "적용됨"은 이제 적용 실행이 `done`이고 되돌리지 않았을 때만 나온다. 나머지 넷(끝나지 않음, 적용 중, 되돌림, 기록 없음)은 main과 같은 `확인 필요`/`needs input`으로 돌아간다(M-1b) |
| JSON의 `appliedBy` | **그대로다.** 다섯 경우 모두 계획 항목에 `appliedBy {runId, at}`가 있고, 다른 필드는 main과 같다 |
| L-1: 계획 실행을 되돌릴 때의 안내 | **닫혔다.** 다섯 경우 모두 상태에 맞는 말이고(2.2), 없는 실행이나 이미 되돌린 적용을 되돌리라고 하지 않는다. 한국어 출력도 이제 한국어다 |
| 평범한 실행의 출력 | **main `5647704`와 같다.** 3절 체험 실행의 `runs`(글·JSON), `changes`(글·JSON), 적용하지 않은 계획의 `runs --json`, 같은 task의 `apply`(JSON·stderr)가 정규화 뒤 같다. 적용된 계획 실행에 `appliedBy`, 적용 실행의 `changes`에 `applyRun`이 더해진 것뿐이다 |

## 2. 확인 결과

### 2.1 `runs`의 계획 줄(`exp3.mjs`)

| 적용 실행의 상태 | 적용 실행 줄 | 계획 줄(U-16, en / ko) | 계획 줄(main) | 지시의 기대 |
| --- | --- | --- | --- | --- |
| `done` | `done (done/verified)` | `plan applied by run <적용 id>` / `계획 적용됨(적용 실행 <적용 id>)` | `needs input` | 적용됨 ✔ |
| `failed/apply_incomplete`(3개 중 1개 옮김) | `failed (failed/apply_incomplete)` | `needs input` / `확인 필요` | `needs input` | 적용이 끝나지 않음(이유 코드) ✘ |
| 결과 없음(도는 중) | `no result (running or stopped)` | `needs input` / `확인 필요` | 같음 | 적용 중 ✘ |
| `cancelled`(검증 중 취소, 세 파일은 옮김) | `cancelled (cancelled/cancelled)` | `needs input` / `확인 필요` | 같음 | 적용이 끝나지 않음 ✘ |
| 되돌림 | `done (done/verified) · reverted (complete)` | `needs input` / `확인 필요` | 같음 | 적용했다가 되돌림 ✘ |
| 목록에 없음(정리로 지움) | 없음 | `needs input` / `확인 필요` | 같음 | 적용 실행의 기록 없음 ✘ |

- 모든 줄의 괄호 안은 `(needs-input/plan_pending)`이다(계약대로).

### 2.2 계획 실행의 `revert --dry-run` 안내(`exp3.mjs`, 종료 모두 0)

| 상태 | 안내의 둘째 문장(영어. 한국어도 같은 뜻) |
| --- | --- |
| `done` | `To undo the changes of its plan, revert the run that applied it (--run <적용 id>).` |
| `failed/apply_incomplete` | 같음 |
| `cancelled` | 같음 |
| 결과 없음 | `The run that applies its plan (<적용 id>) has no result yet: it is still going, or it stopped. Look at that run before you revert anything.` |
| 되돌림 | `… has already been reverted: nothing of it is left to undo.` |
| 목록에 없음 | `… has no readable records in this workspace any more, so Codaryn cannot revert it.` |

- 첫 문장은 모두 `This run only made a plan and changed no file itself, …`(한국어 `이 실행은 계획만 만들었고 …`)다.
- 목록에 없는 경우 그 적용 실행을 `revert`하면 `run_not_found`(종료 2)다. 안내는 그것을 권하지 않는다.

## 3. 중간

### M-1b 실행 목록은 다섯 상태 가운데 "적용됨"만 말하고, 나머지 넷은 옛 "확인 필요"로 돌아간다

- 어디: `src/cli/human/output.ts`(`f104af2`의 472~486행)
  - 계획 줄은 적용 실행이 `done`이고 되돌리지 않았을 때만 `runs.plan_applied`를 쓴다.
  - 그 밖에는 `status.${pair.status}`(`needs input`/`확인 필요`)다.
  - 계약의 `planApplyStateOf`(`src/contracts/commands.ts`)는 `src/cli/assemble.ts`(되돌리기 안내)에서만 쓰인다.
  - 카탈로그의 `runs.plan_apply_unfinished`, `runs.plan_applying`, `runs.plan_apply_reverted`, `runs.plan_apply_missing`(영어·한국어)은 CLI와 GUI 어디에서도 쓰지 않는다(`src`, `gui/src` 검색).
- 재현: 2.1
- 왜 중간인가
  - R-55 M-1의 거짓("적용됨")은 없어졌다.
  - 그러나 이 수정의 기대(지시의 다섯 경우)와 계약 자신의 설명이 그대로 남아 있다. 계약의 `planApplyStateOf` 주석은 "the one rule for the runs table, the GUI and revert's guidance"라고 하고, `appliedBy` 주석은 "how it ended is the apply run's own entry (planApplyStateOf), which the views show"라고 한다. 그 넷이 표에 나오지 않는다.
  - 그 넷에서 계획 줄은 UXM-5가 문제 삼은 말 그대로다.
    - 특히 되돌림과 기록 없음에서는 그 계획을 다시 적용할 수 없는데(`plan_already_applied`) `확인 필요`라 한다. 할 일이 남은 계획처럼 보인다.
    - 실패와 취소에서는 반쯤 옮긴 상태인데, 계획 줄만으로는 그것을 알 수 없다(적용 실행 줄은 보인다).
- 권고(CLI): 표의 계획 줄도 `planApplyStateOf`를 쓴다.
  - `applied` → `runs.plan_applied`
  - `unfinished` → `runs.plan_apply_unfinished`(이유 코드)
  - `applying` → `runs.plan_applying`
  - `reverted` → `runs.plan_apply_reverted`
  - `record_missing` → `runs.plan_apply_missing`
  - 되돌리기 안내와 같은 규칙이 되고, 이미 있는 문구를 쓰게 된다. 이 다섯 경우를 표의 시험으로 더한다.

## 4. 참고(건수에 넣지 않음)

- 되돌리기 안내의 `unfinished`(실패·취소)는 카탈로그의 `revert.plan_revert_apply`를 쓰므로 이유 코드가 나오지 않는다(영어 대체 글에만 있다). 되돌리라는 권고 자체는 맞다.
- R-55의 L-2(도는 적용의 `changes`가 `the run changed no file`)와 L-3(다른 task 알림은 task id만 비교)은 이 판에서도 그대로다. 이번 확인 범위 밖이라 건수에 넣지 않았다.

## 5. PM 판단 필요

- **P-1(M-1b)**: 표의 계획 줄을 다섯 상태로 나눌지(계약·문구는 이미 있음), 지금처럼 "적용됨"만 두고 계약 주석과 쓰지 않는 문구를 고칠지

사용자에게 물을 질문은 없다.

## 6. 실행한 것

- 읽기: `git diff aaabfd7 pm/unit-U-16 -- src`(U-16 수정 커밋 다섯)
- 빌드: `f104af2`, `5647704`(둘 다 tsc 0)
- 실험: `exp3.mjs`(두 판, 다섯 상태), `exp.mjs`(두 판, 평범한 실행의 비교). 출력은 `.codaryn/r55b/`
- ACL 해제 확인(남은 거부 항목 0). 저장소 파일 변경과 커밋 없음. 실제 API·외부 네트워크 미사용.
