# R-39 병합 전 보안 검토: 단위 U-1, 기록 변경 표시가 있는 계획 실행의 apply 거부

- **대상**
  - 고정 판: `pm/unit-U-1` **`3d0e94c07e3309ae1f1a307feec72a8600838a18`**
  - 비교 기준: main **`93dfbd3`**
  - 범위 커밋: `3ac7c4f`(계약), `1ce2f9e`(엔진), `ab4f882`(문구), `2e3cd07`(CLI), `c17b353`(시험)
- **방법**
  - `git archive`로 `.codaryn/r39/u1`, `.codaryn/r39/main`에 풀고 빌드했다(둘 다 typecheck 0).
  - 실제 CLI 프로세스를 net-guard를 붙여 실행했다. 모델은 scripted이고, 작업 공간은 `.codaryn/r39/work` 아래 임시 폴더다.
  - 터미널 승인과 앱 계층 호출은 프로세스로 만들 수 없어 `runApply`를 직접 불렀다(`exp/ask.mjs`).
  - 실제 API·외부 네트워크는 쓰지 않았다. 파일 수정과 커밋도 없다.
  - 스크립트는 `.codaryn/r39/exp/`(`e.mjs`, `c8.mjs`, `ask.mjs`)에 있다.

## 요약

| 심각도 | 건수 | 항목 |
|---|---|---|
| 높음 | 0 | |
| 중간 | 0 | |
| 낮음 | 1 | L-1 상태 디렉터리가 커서 감시기가 "확인하지 못함"이면 계획 실행이 바뀌어도 표시가 없어 거부가 일어나지 않고, 사람에게 그 말도 나오지 않는다 |
| 정보 | 3 | I-1 표시는 지우면 사라진다(손으로, 또는 실행이 남긴 자식이), I-2 `plan` 보기는 표시를 말하지 않는다, I-3 GUI에는 새 오류 코드의 문구가 없어 기본 문구로 나온다 |

- 표시가 있는 계획 실행의 apply는 모든 승인 경로에서 거부되고, 아무것도 바뀌지 않는다.
- 표시가 없는 계획의 apply는 main과 같다.
- 이미 적용된 계획, 되돌리기, 변경 보기, 보고는 영향이 없다.

## 1. 거부 (실제 CLI, `exp/e.mjs` C1~C3, C5)

| 경우 | main | 고정 판 |
|---|---|---|
| 표시(`{}`) + `--digest`(12자, 전체) | 적용됨(done/verified) | `plan_records_changed`, 종료 2 |
| 표시의 꼴: 제대로 된 JSON, 빈 파일, 디렉터리, 대문자 이름 | 적용됨 | 모두 `plan_records_changed` |
| 다른 실행에만 표시 | 적용됨 | 적용됨(그 계획 실행의 표시만 본다) |
| `--digest` 없이, 터미널 아님: 표시 없음 / 있음 | `plan_not_approved` / `plan_not_approved` | `plan_not_approved` / `plan_records_changed` |
| 뒤 실행의 검증기가 모든 실행 기록에 파일을 씀(R-33 절차): 뒤 실행 `failed/state_changed`, 계획 실행에 표시 | 그 뒤 apply가 적용됨 | 그 뒤 apply는 `plan_records_changed` |

- 거부된 뒤의 상태
  - 작업 공간 파일은 그대로다(이름과 내용 해시 비교).
  - 상태 디렉터리 파일 목록도 그대로다: 적용 실행 없음, `applied.json` 없음, 잠금 파일 없음.
- 문구(두 언어, stderr)
  - 영어: "the plan run has a records-changed mark: something other than the run changed its records, so its plan may not be the one you read; nothing was asked or changed (plan_records_changed)"와 고치는 법 줄
  - 한국어: "계획 실행에 기록 변경 표시가 있습니다. …아무것도 묻거나 바꾸지 않았습니다 (plan_records_changed)"와 고치는 법 줄. 뜻이 같다.
  - 출력(JSON, 두 언어 stderr)에 실행 id, 다이제스트, 작업 공간 경로, 계획의 파일 이름이 없다.
- 승인 경로(`exp/ask.mjs`)
  - 터미널 승인: 묻기 전에 거부한다(질문 0번).
  - 앱 계층의 호출(adapter): 같은 거부다. `src/app/app.ts`는 `runApply`를 그대로 부른다.
  - 두 경우 모두 엔진은 불리지 않았다.
- 잠금 아래의 두 번째 확인
  - 엔진 코드(`src/engine/apply.ts`)를 읽고 그 단위의 시험으로 확인했다. CLI 확인 뒤에 쓰인 표시는 `failed/plan_stale`로 끝나고 아무것도 옮기지 않는다.
  - Codaryn이 쓰는 표시는 잠금을 쥔 실행만 쓴다. 그래서 적용이 잠금을 쥔 뒤에는 새 표시가 생기지 않는다.

## 2. 빠져나가는 길

### L-1 (낮음) 감시기가 "확인하지 못함"이면 표시가 없어 거부가 일어나지 않고, 사람에게 그 말이 나오지 않는다

- 재현(`e.mjs` C7b)
  - `.codaryn/parked` 아래에 항목 20,001개를 두었다(2층 지문의 항목 상한은 20,000).
  - 뒤 실행의 검증기가 계획 실행의 기록에만 파일을 썼다.

  | 상태 디렉터리 | 뒤 실행 | 계획 실행의 표시 | 그 뒤 apply |
  |---|---|---|---|
  | 작음 | `failed/state_changed` | 있음 | `plan_records_changed` |
  | 항목 20,001개 | **`done/verified`** | **없음** | **적용됨** |

- 원인
  - 2층 지문은 이름순으로 걷다가 상한에서 멈춘다. `parked`가 `runs`보다 앞이라 다른 실행의 기록은 비교되지 않는다. 결정 DR-38 P-2대로 멈추지 않고 `limited`만 기록한다.
  - 저널에는 `state_checked … "limited":true`가 남는다. 그러나 사람용 진행 줄에는 아무 말도 없다.
    - 문구 `progress.state_unchecked`는 카탈로그에 있다.
    - 사람용 렌더러(`src/cli/human/output.ts`의 `progressLine`)가 `state_checked` 기록을 그리지 않는다. 영어 기본 줄(`src/cli/progress.ts`)만 그린다.
    - 이 렌더러는 내 소유 모듈이다. U-1의 변경이 아니고 main도 같다.
- 영향: 상태 디렉터리가 큰 작업 공간에서는 U-1의 거부가 기대는 표시가 생기지 않는다. 그런데 사람은 확인이 빠졌다는 것을 모른다.
- 낮음으로 두는 까닭: 조건이 항목 20,000개 이상이다. 현재 실행 자신의 기록(1층)은 그대로 감시된다.
- 제안
  - 출력 단위에서 `progressLine`이 `state_checked`를 그리게 한다: `limited`면 `progress.state_unchecked`, 변경이 있으면 `progress.state_changed`. 내 몫으로 할 수 있다.
  - 걷는 순서에서 `runs`를 먼저 보게 하면 상한에 걸려도 실행 기록은 본다(store, 후속).

### I-1 (정보) 표시는 지우면 사라진다

- 표시는 `runs/<계획 실행 id>/records-changed.json` 한 곳에만 있다. 그 이름에 무엇이든 있으면 표시로 본다.
- 재현
  - 손으로 지우거나 이름을 바꾸면 apply가 적용된다(C4).
  - 뒤 실행의 검증기가 떼어 놓은 자식이, 실행이 끝난 뒤 표시를 지웠다. 그 뒤 apply가 적용됐다(C6).
- DR-38의 알려진 한계(실행 밖의 같은 사용자 프로세스, 실행이 끝난 뒤의 분리된 자식)와 같은 것이다.
- 남는 흔적: 감지한 실행의 저널(`state_checked`의 바뀐 경로)과 결과(`failed/state_changed`). 다만 C6에서는 그 실행 자신의 표시도 지워졌다.
- 계획 내용 자체가 바뀐 경우는 따로 막힌다. `plan.json`이 바뀌면 다이제스트가 달라져, 사람이 전에 본 다이제스트로는 승인되지 않는다.

### I-2 (정보) `codaryn plan` 보기는 표시를 말하지 않는다

- 표시가 있는 계획 실행의 `plan` 보기는 종료 0이고, 표시에 대한 말이 없다(C3). main도 같다.
- 사람은 계획을 읽고 승인하려 할 때에야 거부를 본다. 보기에서 미리 알리면 좋다(CLI·계약, 후속).

### I-3 (정보) GUI에는 새 오류 코드의 문구가 없다

- 앱 계층은 오류를 그대로 넘긴다(`fromCliError`). GUI 카탈로그(`gui/src/renderer/i18n`)에는 `error.plan_records_changed`가 없다.
- 그래서 기본 오류 문구와 괄호 안의 코드로 나온다(`errorText`). 거부 자체는 된다.
- GUI는 실행해 보지 않았다. 코드로만 확인했다.

## 3. 표시가 없는 평범한 계획 (C8, `exp/c8.mjs`)

- 같은 절차를 두 판에서 돌려, 다음을 정규화해 비교했다: stdout, stderr, 적용 실행의 저널과 `result.json`, 계획 실행의 `applied.json`, 상태 디렉터리 파일 목록.
  - 정규화한 것: 실행 id, 시각, 걸린 시간, 다이제스트(계획에 실행 id가 들어 있어 실행마다 다르다).
- **모두 같다.** 저널의 기록 순서도 같다: `apply_started`, `state_checked`, `plan_checked`, `plan_item_started`, `file_moved`, `verifier_result`, `state_checked`, `run_finished`.
- 같은 판을 두 번 돌린 것끼리도 같아, 비교가 흔들리지 않음을 확인했다.

## 4. 이미 적용된 계획, 되돌리기, 변경 보기 (C9)

적용한 뒤에 계획 실행에 표시를 붙였다. 두 판의 결과가 같다.

| 명령 | 결과(두 판 같음) |
|---|---|
| apply 다시 | `plan_already_applied`(이 확인이 표시 확인보다 먼저다) |
| 적용 실행의 `report` | 종료 0 |
| `changes`(계획 실행, 적용 실행) | 종료 0 |
| 적용 실행의 `revert --dry-run`, `revert` | 종료 0, complete. 파일이 제자리로 돌아왔다 |

## PM 질문

1. L-1의 사람용 줄(`state_checked` 그리기)을 다음 출력 단위에 넣을지. 가정: 넣는다(내 몫). R-37의 줄 나누기와 같은 단위로 묶을 수 있다.
2. U-1 병합: 높음·중간이 없고 L-1은 U-1의 코드가 아니므로, 보안 면에서 병합을 막을 이유는 없다.
