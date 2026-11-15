# R-18 읽기 전용 검토: R-13 낮음 수정, 사용 문서 재캡처, 적용 목록의 취소 연결 (w3:p4, 2026-11-12)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어. 읽기 전용이며 저장소 파일과 다른 브랜치는 바꾸지 않았다.
- **대상(고정)**
  - `claude/revert-store` = **`ccb44b6`**(main `207d36e` 이후). 시작할 때 3개였던 커밋에 검토 중 `68a524b`(main 병합)와 `ccb44b6`이 더해졌다.

    | 커밋 | 내용 | 파일 |
    | --- | --- | --- |
    | `a0bf411` | R-13 L-1·L-2 | `src/tabular/aggregate.ts`, `src/verify/data-checks.ts`, 유닛 `g-r13-data` |
    | `cf2029b` | R-13 L-3 | `src/verify/inventory.ts`, 유닛 `g-r13-inventory` |
    | `106f7f0` | 사용 문서 재캡처 | `docs/usage.md`(18절 재캡처, 10절 `changes`, 16절 한계 모음, 17절) |
    | `ccb44b6` | 문서 색인 | `docs/README.md`, `docs/design/README.md`(사실 문서 행) |

  - (PM 알림으로 범위 확대) `claude/workspace-policy`의 **`f3e3919`**
    - 적용의 인벤토리 검사기에 적용의 취소 신호를 넘긴다(`src/cli/plan-commands.ts:434`).
    - 유닛 `tests/unit/cli/g-inventory-cancel.test.ts`: 2건 중 1건 통과, 1건은 엔진 담당 todo.
    - `cf2029b`를 병합한 위에 있다.
- 기준: `docs/reviews/2026-11-12-r13-review-verifiers-and-tabular.md`(L-1~L-3, P-1·P-2). `docs/usage.md`의 18.3 취소 서술과 17절.
- 빌드 사본(`git archive`, `node_modules` 정션, 모두 tsc 오류 0)
  - `.codaryn/r18/rs` = `ccb44b6`
  - `.codaryn/r18/wp` = `f3e3919`
  - `.codaryn/r18/main` = `207d36e`(수정 전 비교용)
- 사본 검사

  | 사본 | 유닛 | 통합 |
  | --- | --- | --- |
  | `ccb44b6` | 1517건 중 1512 통과·0 실패·3 건너뜀·2 todo | 519건 중 519 통과 |
  | `f3e3919` | 1523건 중 1516 통과·0 실패·3 건너뜀·4 todo(`g-inventory-cancel`의 엔진 todo 포함) | 519건 중 519 통과 |

- 재현 스크립트(모두 내 작업 트리 `.codaryn/r18/`)
  - `exp18.mjs`: 검증기와 목록. 같은 입력을 수정 전·후에 넣는다.
  - `doc18.mjs`: 문서 출력 블록 대조
  - `cancel18.mjs`: 실제 CLI `apply`의 목록 중 취소
  - preload `no-link.mjs`(하드 링크 없는 볼륨 흉내), `slow-readdir.mjs`(표지 디렉터리의 목록을 늦춤)
  - 로그 `*.log`
- 실제 API, 외부 네트워크, 키 파일은 쓰지 않았다. 임시 작업 공간(TEMP `codaryn-r18*`)은 모두 지웠다.

심각도: 높음(지금 틀린 통과나 원자료 유출, 선행 조건 없음), 중간(재현되는 결정 위반, 선행 조건 있음), 낮음, 정보.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 1 (R18-M1, `f3e3919`) |
| 낮음 | 1 (R18-L1) |
| 정보 | 5 (R18-I1~I5) |

| 항목 | 결과 |
| --- | --- |
| L-1 넘침 | **해소.** 수정 전 `fail`이던 넘침 사례 7건이 모두 `inconclusive`(원본 사유)다. 손계산 표 6건은 그대로 통과한다. 근거에 값과 묶음 값이 없다 |
| L-2 빈 묶음 | **PM 결정대로 유지하고 명시했다.** 판정은 수정 전과 같고, `DATA_CHECKS_LIMITS` 넷째 줄이 통과 결과에도 실린다. count는 영향이 없다 |
| L-3 목록(검사기) | **해소.** 목록 결과가 상한 10가지에서 수정 전과 글자까지 같다. 평평한 12,000개는 약 4배 빠르다. 취소 신호에는 0~8 ms 안에 `AbortError`다 |
| **실제 CLI `apply`의 목록 중 취소(`f3e3919`)** | **아무것도 옮기지 않는다. 그러나 엔진 사전 점검 목록 중 취소는 `cancelled`가 아니다.** 목록은 136 ms 만에 멈추지만 결과가 `failed`/`plan_stale`(종료 1)이고 "새 계획을 만들라"고 안내한다. `f3e3919`가 없는 `ccb44b6`에서는 같은 취소가 목록이 끝난 뒤 `cancelled`(5)였다(R18-M1). 행동 뒤 목록 중 취소는 123 ms 만에 `cancelled`(5)이고, CLI 자체 목록(`loadShown`) 중 취소는 그 목록이 끝난 뒤 `cancelled`(5)다(R18-L1) |
| 문서 출력 블록 | **비교한 10개 모두 실제 출력과 같다.** 8개는 그대로(앞부분 블록 포함)이고, 2개 "일부" 블록은 순서를 지킨 부분집합이다. 문서 서술 25건도 확인했다 |

## 2. 중간

### R18-M1 `f3e3919`: 사전 점검 목록 중 취소가 `failed`/`plan_stale`(종료 1)로 끝나고 "새 계획을 만들라"고 안내한다

- 재현: `cancel18.mjs`(실제 CLI, `--cancel-file`, organize-demo 사본에 표지 디렉터리)
  - 엔진 사전 점검 목록이 시작되고 300 ms 뒤 취소 파일을 만들었다.
  - `f3e3919`에서 결과는 다음과 같다.

    ```
    codaryn: apply started — actions: 3, approved by a command-line argument
    codaryn: finished — failed (plan_stale)
    ── Result: failed — the plan no longer fits the workspace, so nothing was applied (failed/plan_stale) ──
    Actions applied: 0 of 3
    Plan run: <계획 실행 id>
    Check the workspace, then run the same task again to make a new plan.
    ```

  - 종료 1이다. 결과 `notices`는 `["the workspace inventory could not be taken; nothing was moved"]`이고, 기록은 `apply_started > run_finished`다.
  - 목록 자체는 취소 136 ms 뒤 멈췄다(lstat 늦춤 방식).
- 같은 시점의 취소를 `f3e3919`가 없는 `ccb44b6`에서 하면, 목록이 끝까지 돈 뒤 `cancelled`/`cancelled`(종료 5)였다. 그러니 **`f3e3919` 혼자서는 취소의 결과가 나빠진다.**
- 원인: `src/engine/apply.ts:301-307`이 `inventory.capture()`의 모든 예외(이제 AbortError 포함)를 `INVENTORY_FAILED_NOTICE`와 `plan_stale`로 바꾼다.
  - `f3e3919`의 todo 유닛("the engine ends a cancel during the listing as cancelled")이 바로 이것이다. 커밋 메시지도 엔진 담당 몫으로 적었다.
- 어긋나는 결정·문서
  - 사용 문서 18.3: "취소: … 상태는 `cancelled`(5)다. 행동을 시작하기 전에 취소되면 아무것도 옮기지 않고 계획도 적용되지 않은 채로 남아, 다시 `apply`할 수 있다."
  - 17절의 `failed`/`plan_stale` 행과 출력의 안내("계획 실행부터 다시 한다", "make a new plan")는 이 경우 틀린 조치다. 실제로는 같은 계획을 다시 `apply`하면 `done`/`verified`다(재현).
- 안전에는 문제가 없다.
  - 아무것도 옮기지 않았다.
  - 계획은 소모되지 않았다(`applied.json` 없음, 다시 적용 성공).
  - 비밀·기록에 이상이 없다.
- 선행 조건: 사전 점검 목록 동안의 취소. 큰 작업 공간이면 적용 앞부분 시간의 대부분이 이 목록이다.
- 권고(담당: 엔진, CLI)
  - 엔진 `apply.ts:301-307`에서 예외를 바꾸기 전에 `interrupted()`(또는 신호)를 먼저 보고 `CANCELLED`를 돌려준다. 그러면 todo 유닛이 풀린다.
  - **`f3e3919`는 그 엔진 수정과 함께 병합한다.**
  - 행동 뒤 목록(`:400-406`)은 지금도 결과가 `cancelled`다. inventory 검증이 `inconclusive`("the verifier could not be run")로 기록될 뿐이다.

## 3. 낮음

### R18-L1 적용 한 번에 작업 공간 목록이 세 번이고, 첫 목록은 취소할 수 없다

- `apply`는 `plan` 보기와 같은 `loadShown`(`src/cli/plan-commands.ts:345` → `:287`)을 거쳐, 엔진보다 먼저 작업 공간 전체를 신호 없이 한 번 나열한다. 그다음 엔진이 행동 앞뒤로 두 번 나열한다.
  - 재현: 표지 디렉터리 목록이 적용 한 번에 세 번 시작된다(`ccb44b6`, `f3e3919` 모두).
- `apply`에서 그 첫 목록의 결과(`inventoryLimitReached`)를 쓰는 곳은 터미널 질문의 계획 보기(`:375`)뿐이다. `--digest`로 승인하면 쓰이지 않는다.
- 결과
  - 상한 근처의 큰 작업 공간에서 적용 시간의 약 3분의 1이 더해진다.
  - 그 목록 동안의 취소는 `f3e3919`에서도 목록이 끝난 뒤 반영된다(재현: 남은 목록을 다 돌고 775 ms 뒤 `cancelled`).
  - 사용 문서 16절 "적용은 파일 목록을 앞뒤로 두 번 만든다"와 다르다.
- 권고(담당: CLI): 아래 둘 중 하나를 하고, 16절을 고친다.
  - `apply`에서는 질문을 할 때만 그 목록을 만든다.
  - 그 목록에도 적용의 취소 신호를 넘긴다.

## 4. 정보

- **R18-I1 넘침 판정이 행 순서에 달려 있다.** 값 집합이 같아도 결과가 다르다.

  | 원본 순서 | 결과 표 1e308 | 이유 |
  | --- | --- | --- |
  | `1e308, -1e308, 1e308` | `pass` | 중간 합이 범위 안에 머문다 |
  | `1e308, 1e308, -1e308` | `inconclusive` | 중간 합이 넘친다 |

  - 틀린 통과는 없다. 보수적인 쪽이다.
- **R18-I2 한계 문구가 min·max까지 묶어 말한다.**
  - 문구: `DATA_CHECKS_LIMITS` 넷째 줄과 사용 문서 16절. "sum, min, max and mean cannot be checked … or when the sum goes beyond a double's range"
  - min·max는 합을 쓰지 않는다. 1e308 두 개의 min·max는 `pass`다.
  - mean은 참값이 범위 안이어도(1e308 두 개) `inconclusive`다. 이것은 문구대로다.
  - 넘침 부분은 "sum and mean"이 정확하다.
- **R18-I3 동시 처리의 이득은 디렉터리 안에서만 난다.** 측정은 따뜻한 상태, 다른 세션 시험 0, 두 번 했다.

  | 형태 | 수정 전 | 수정 후 | 비율 |
  | --- | --- | --- | --- |
  | 한 디렉터리에 12,000개 | 265~315 ms | 65~88 ms | 약 4배 |
  | 6개짜리 디렉터리 2,000개 | 411~559 ms | 230~435 ms | 1.3~2배 |

  - R-13의 "만든 직후 차가운 상태 23.7~104초"는 재현하지 못했다.
- **R18-I4 "일부" 출력 블록 두 개는 연속 발췌가 아니다.**
  - 18.5 `consent_required`: 4줄을 뺐다.
  - 18.6 `awaiting_review`: 7줄을 뺐다.
  - 둘 다 생략 표시 없이 붙였다. 남은 줄과 순서는 실제와 같다.
  - 생략 자리에 `…`를 두면 좋다(문서 담당).
- **R18-I5 작은 문구 차이**
  - 18.2의 runs 인용 `3  done (done/verified)`는 공백이 2칸이다. 실제는 열 맞춤으로 8칸이다.
  - 새 data_checks 한계는 사용 문서 16절과 `DATA_CHECKS_LIMITS`에만 있다. `docs/design/general-tasks.md` 5.2와 `docs/cli-contract.md`에는 없다.

## 5. 실제 CLI `apply`의 목록 중 취소(`cancel18.mjs`)

- organize-demo 사본에 표지 디렉터리(`r18-slow`)를 두었다. 그 목록이 시작되고 300 ms 뒤 `--cancel-file`을 만들었다.
- 늦추는 방식은 둘이다.
  - readdir: 표지 디렉터리의 readdir 한 번이 4초 멈춘다. 목록이 중간에 끊길 수 없다.
  - lstat: 그 안의 320개 항목마다 lstat이 100 ms 멈춘다. 묶음 사이에서 끊길 수 있다.
- 목록 번호: 1 = CLI `loadShown`, 2 = 엔진 사전 점검, 3 = 행동 뒤

| 사본 | 방식 | 취소 시점 | 결과(종료) | 취소 뒤 끝날 때까지 | 옮김 | 이후 |
| --- | --- | --- | --- | --- | --- | --- |
| `ccb44b6` | readdir | 1 | `cancelled`(5) | 3716 ms | 없음 | 다시 적용 `done` |
| `ccb44b6` | readdir | 2 | `cancelled`(5) | 3691 ms | 없음 | 다시 적용 `done` |
| `ccb44b6` | readdir | 3 | `cancelled`(5), 행동 3건 남음 | 3698 ms | 3건 | 되돌리기 `complete`(3) |
| `ccb44b6` | lstat | 3 | `cancelled`(5), inventory `pass` | 780 ms | 3건 | 되돌리기 `complete`(3) |
| `f3e3919` | readdir | 1 | `cancelled`(5) | 3704 ms | 없음 | 다시 적용 `done` |
| `f3e3919` | readdir | 2 | **`failed`/`plan_stale`(1)** | 3681 ms | 없음 | 다시 적용 `done` |
| `f3e3919` | readdir | 3 | `cancelled`(5) | 3695 ms | 3건 | 되돌리기 `complete`(3) |
| `f3e3919` | lstat | 1 | `cancelled`(5) | 775 ms(신호 없는 목록을 끝까지) | 없음 | 다시 적용 `done` |
| `f3e3919` | lstat | 2 | **`failed`/`plan_stale`(1)** | **136 ms** | 없음 | 다시 적용 `done` |
| `f3e3919` | lstat | 3 | `cancelled`(5), inventory `inconclusive` | **123 ms** | 3건 | 되돌리기 `complete`(3) |

- `f3e3919`는 엔진의 두 목록을 실제로 빨리 멈춘다(136·123 ms 대 신호 없는 목록의 775·780 ms).
- 결과의 상태는 사전 점검에서 R18-M1, CLI 자체 목록에서 R18-L1이다.
- 되돌리기 뒤 작업 공간의 파일 목록 비교는 처음과 달랐다. 만든 폴더(`photos/2025` 등)가 남은 것으로 보이지만 이번 범위에서 따지지 않았다(6절).

## 6. R-13 재현(수정 전 `207d36e` → 수정 후 `ccb44b6`)

| 사례 | 수정 전 | 수정 후 |
| --- | --- | --- |
| R-13 손계산 표: 묶지 않은 합 115.35, 묶은 sum·count·min·max·mean | pass ×6 | pass ×6 |
| L-1 sum 1e308+1e308 대 5 | fail | inconclusive ("the computation over source column "v" is out of range of a double") |
| L-1 mean 1e308,1e308 대 5 / 대 1e308 | fail / fail | inconclusive / inconclusive |
| L-1 sum 1e308,1e308,−1e308,−1e308 대 0 | fail | inconclusive |
| L-1 sum −1e308,−1e308 대 5 | fail | inconclusive |
| L-1 순서 1e308,1e308,−1e308 대 1e308 | fail | inconclusive |
| L-1 순서 1e308,−1e308,1e308 대 1e308 | pass | pass (I1) |
| L-1 묶음 하나만 넘침 | fail | inconclusive. 근거는 "group first seen at source data row 1"이고 묶음 값·수는 없다(표지 `PII-KEY-MARK` 미출력) |
| L-1 min·max 1e308,1e308 대 1e308 | pass | pass (I2) |
| L-2 묶음 b가 모두 빈 칸, 결과 표 b=0 / b 빈 칸 | inconclusive / inconclusive | 같음(유지 결정) |
| L-2 같은 자료의 count, b=0 | pass | pass |
| L-2 열 전체가 빈 칸인 sum | inconclusive | inconclusive |
| 한계 목록(통과 결과) | 3줄 | 4줄 |
| L-3 목록 동일성: 평평 70, 섞인 40, 깊은 트리, 빈 폴더, 밖을 가리키는 정션, 상태 디렉터리 | — | 상한 1·5·31·32·33·64·65·100·150·100,000에서 entries와 `limitReached`가 수정 전과 같다 |
| L-3 미리 취소된 신호 | (옵션 없음: 다 나열) | 즉시 `AbortError`, 부분 목록 없음 |
| L-3 나열 중 취소(5·20·50 ms 뒤, 12,000개, 전체 498 ms) | — | 취소 뒤 0·8·0 ms에 `AbortError` |
| L-3 실행 경로 | — | `ccb44b6`: 신호 없음. `f3e3919`: 엔진의 두 목록에 신호, `loadShown` 목록에는 없음(5절) |

## 7. 사용 문서 출력 블록 대조(`ccb44b6`의 `docs/usage.md`)

방법(`doc18.mjs`)

- 예시를 TEMP에 복사해 문서의 명령을 사본 CLI로 실행했다. 환경은 허용 목록 변수와 `CODARYN_LANG=en`이다.
- 실행 id, 다이제스트, 비밀 토큰은 블록 안에서 나온 순서대로 기호로 바꾼다. 같은 id가 같은 자리에 있어야 같다고 본다.
  - 다이제스트 앞 12자는 전체 다이제스트와 이어지는지도 본다.
  - 사용 시간의 초와 시각은 자리표시자로 바꾼다.
- 18.6은 n07의 분석 task(검증기 `data_checks` 하나)로 만들었다.
- 18.5는 `no-link.mjs`로 흉내 냈다. `node:fs/promises`의 모든 `link()`가 `ENOTSUP`이다.
  - 처음에는 상태 디렉터리를 예외로 두었다. 그러자 사전 점검의 탐침(같은 볼륨이면 상태 디렉터리 안에 만든다, `src/tools/plan-executor.ts:97-115`)이 성공했고, 실제 이동에서 `apply_incomplete`가 났다.
  - 실제 FAT32에서는 상태 디렉터리도 링크가 안 되므로 예외 없이 다시 돌렸다. 내 흉내의 잘못이었다.

| 블록(문서 줄) | 명령 | 비교 | 결과 |
| --- | --- | --- | --- |
| 10절 변경 보기(524) | `changes --run latest`(3절 체험 뒤) | 전체 | 같음 |
| 18.2 계획 실행 끝 요약(757) | `run` stderr | 전체 | 같음 |
| 18.2 계획 보기(781) | `plan` stdout | 전체 | 같음 |
| 18.2 적용(792) | `apply --digest <12자>` stderr | 전체 | 같음 |
| 18.2 적용 실행 보고서(820) | `report --run <적용 실행>` | 앞부분 | 같음. 뒤에 Verification / Protected material / Usage / Undo / Not checked가 이어진다 |
| 18.2 되돌리기 미리보기(847) | `revert --dry-run` stderr | 전체 | 같음 |
| 18.3 `plan_secrets_differ`(877) | 비밀을 등록하고 만든 계획을 원래 task로 `plan`, 그리고 `apply --allow-unsafe-move` | 전체(두 명령 모두) | 같음 |
| 18.4 `plan_run_missing`(911) | 계획 실행 폴더를 지우고 `revert` | 전체 | 같음 |
| 18.5 `consent_required` "일부"(924) | 하드 링크 없음 흉내로 `apply` | 순서 보존 부분집합 | 같음(I4) |
| 18.6 `awaiting_review` "일부"(945) | 분석 `run` | 순서 보존 부분집합 | 같음(I4) |

확인한 서술(25건 모두 맞음)

- 종료 코드 8가지: run 3, plan 0, apply 0, revert 0, `plan_run_missing` 2, `plan_secrets_differ` 2, `consent_required` 3, `awaiting_review` 3
- 적용 실행
  - stdout은 `kind:"apply"`이고 `planRunId`·`digest`가 맞다.
  - 폐기 파일은 `discarded/<적용 실행 id>/2`에 있다.
  - runs에서 적용 실행이 맨 위에 나온다.
  - plan을 다시 보면 `applied`이고 `Applied by run …`가 붙는다.
- 되돌리기
  - `Files reverted: 3 (complete)`이고, 세 파일이 돌아오며 보관함 폴더가 빈다.
  - 다시 되돌리면 `skipped` 3건이 모두 `already_reverted`이고 `complete`다.
- `plan_run_missing`이면 작업 공간이 바뀌지 않는다.
- `plan_secrets_differ`: 값이 출력에 없다. `--allow-unsafe-move`를 줘도 같고, 적용 실행이 생기지 않고 아무것도 옮기지 않는다.
- report와 review
  - 판정 전 `No verdict yet.`이 나온다.
  - `--reject` 뒤 `Verdict: **rejected** (`<ISO>`)`가 나온다.
  - 다시 판정하면 `(an earlier review was replaced)`가 붙는다.
- 토큰 예시의 모양이 실제와 같다.

3절 블록은 통합 `n01`이 늘 비교하며 두 사본에서 통과했다.
- 16절 data_checks 한계는 I2의 문구 범위만 다르다.
- 16절 "그동안의 취소는 목록이 끝난 뒤 반영된다"는 `ccb44b6`에서 맞다. `f3e3919`를 병합하면 R18-M1과 R18-L1에 맞춰 고쳐야 한다.

## 8. 검사하지 않은 범위

- 실제 FAT32·exFAT, 실제 콘솔의 `[y/N]`, macOS·Linux
- 차가운 상태의 큰 목록 시간(I3), 10만 개 작업 공간
- Ctrl+C 취소(`--cancel-file`만 썼다)
- 출력 블록이 없는 서술(18.1, 18.7, 18.8 등)의 전부
- 되돌리기 뒤 남는 빈 폴더(5절 끝)

## 9. PM 판단 필요

- **Q-1(R18-M1)**: `f3e3919`를 엔진 수정(`apply.ts:301-307`, todo 유닛 해제)과 함께 병합할지. 따로 먼저 병합하면 사전 점검 목록 중 취소가 `failed`/`plan_stale`로 바뀐다.
- **Q-2(R18-L1)**: `apply`의 `loadShown` 목록(질문할 때만, 또는 신호 연결)을 CLI 담당에게 맡길지, 16절에 세 번이라고 적을지.
- **Q-3(R18-I2, I4)**: 한계 문구를 "sum and mean"으로 좁히는 것과 "일부" 블록의 생략 표시를 맡길지.

사용자에게 물을 질문은 없다.
