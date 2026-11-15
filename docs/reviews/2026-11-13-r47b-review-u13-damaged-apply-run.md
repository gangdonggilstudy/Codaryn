# R-47b 병합 전 확인: 단위 U-13, R47-M1의 고침 (w3:p4, 2026-11-13)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어(보안 검토). 읽기 전용이며 파일 수정·커밋은 없다.
- **검토한 판: `pm/unit-U-13` = `ab206de`**(앞서 본 `950c272`에 9개 파일 196줄을 더한 것). 제품 코드의 변화는 `src/store/cleanup.ts`와 `gui/src/main/app.ts`의 주석이다. 나머지는 시험과 문서다.
- 사본: `.codaryn/r47/u`(`git archive ab206de`), `npm run build` 성공. 확인 뒤 지웠다.
- 실험: `.codaryn/r47/r47.mjs`의 E(새로 더함)와 A, B, C(R-47과 같은 것). 로그는 `E.log`, `A2.log`, `B2.log`, `C2.log`, `gui-unit-b.log`, `smoke-b.log`.
  - 실제 CLI, 정리 예제의 대본 실행, 경우마다 새 임시 작업 공간. 주소는 쓰지 않았다.
- 지시대로 높음·중간만 건수로 적는다.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 (R47-M1은 고쳐졌다) |

| 볼 것 | 결과 |
| --- | --- |
| (1) R47-M1의 재현 절차 | **고쳐졌다.** 기록을 확인할 수 없는 적용 실행은 보관함에 파일이 있으면 건너뛰어지고, 그 계획 실행도 남고, 보관함의 `2`도 그대로다. |
| | - 미리보기: 그 실행에 `records_unreadable`과 `discarded_left` 경고가 함께 붙는다. 안내 줄은 "1 apply run(s)"로 **이 실행을 센다.** |
| | - 결과: "남겼습니다 … 1개" 줄과 항목별 이유(`discarded_left`, `used_by_kept_apply`). 영어·한국어. 종료 0 |
| (2) 앞서 막혔다고 본 길 | **그대로다.** A, B, C를 모두 다시 돌렸고, `950c272`의 로그와 다른 것은 B10(고쳐진 경우)뿐이다. |
| (3) GUI | **유닛 150건 중 150 통과, 연기 시험 158건 중 158 통과(한 번), 앱 종료 0** (`ab206de`) |
| | - 연기 시험에 셋째 대화상자의 두 경우가 더해졌다: "보관함은 남김"이면 `discarded_left`로 남고(`discardLeftKept`), "보관함도 지움"이면 둘 다 지워진다(`discardLeftBoth`). R47-I4가 닫혔다. |

## 2. 실험 표(E, `E.log`)

적용 실행의 `journal.jsonl`을 읽을 수 없게 만든 뒤.

| 경우 | 미리보기 | 실제 정리 | 디스크 |
| --- | --- | --- | --- |
| E1·E2 모두 고름, `--include-not-reverted` | `run:apply[records_unreadable,discarded_left]`, `run:plan[]`, 보관함 | 종료 0. 남긴 것: 보관함 `not_confirmed`, 적용 `discarded_left`, 계획 `used_by_kept_apply` | 둘 다 남음, 보관함 `2` |
| E2b 보관함을 고르지 않음 | 같음(보관함 항목 없음) | 적용 `discarded_left`, 계획 `used_by_kept_apply` | 같음 |
| E2c `--include-not-reverted` 없이 | 같음 | 적용 `not_reverted_not_confirmed`, 계획 `used_by_kept_apply` | 같음 |
| E2d 계획 실행만 고름 | `plan_used_by_apply`로 막힘 | 지운 것 없음 | 같음 |
| E2e 적용 실행만 고름 | `[records_unreadable,discarded_left]` | `discarded_left` | 같음 |
| E2f `--delete-discarded`까지 | 같음 | 보관함, 적용, 계획을 모두 지움 | 모두 없음(사람이 확인한 삭제) |
| E5 계획 실행만 손상 | 적용 `[not_reverted,discarded_left]`, 계획 `[records_unreadable]` | 적용 `discarded_left`, 계획 `used_by_kept_apply` | 둘 다 남음 |
| E6 손상된 문서 실행, 되돌린 뒤 손상된 적용(빈 보관함) | 둘 다 `[records_unreadable]`만 | 모두 지움 | 없음(잃을 보관함 파일 없음) |

- 사람용 출력은 E1에서 영어와 한국어로 봤다. 미리보기의 새 안내 줄은 여전히 영어 고정 글이다(R47-I2 그대로).

## 3. 남은 것(건수에 넣지 않음, 참고)

- **계획 실행을 붙잡는 근거는 계획 실행의 `applied.json`이다.** 다음 두 경우에는 손상된 적용 실행과 보관함은 남지만 계획 실행의 기록은 지워진다.
  - E3: 계획 실행의 `applied.json`이 없다.
  - E4: 계획 실행도 손상돼 있다(`--include-not-reverted`를 준 경우).
  - 두 곳이 함께 망가진 상태라 드물고, 보관함이 딸린 실행의 기록은 남으므로 DR-53의 글에는 맞는다. 낮음으로 본다.
- 손상된 적용 실행의 결과 글은 "그 적용을 먼저 되돌리거나"라고 안내하지만, 그 실행은 되돌릴 수 없다(R-47의 B10에서 `revert` 종료 2). 실제로 남은 방법은 `--delete-discarded`이거나 손으로 꺼내는 것이다. 정보.

## 4. 검사하지 않은 범위

- 보관함에 파일이 있는 온전한 적용과 손상된 적용이 한 작업 공간에 함께 있을 때의 개수. 같은 작업 공간에서 두 번째 계획·적용을 만들지 못했다(시험 대본의 한계). 개수는 경고가 붙은 항목으로 세므로(`src/cli/cleanup.ts`) 코드로는 둘 다 센다.
- main과의 출력 비교(D)는 다시 하지 않았다. 이번 변화는 손상된 실행에만 닿는다.
- 실제 Electron 창의 대화상자를 사람이 누르는 것, 루트 유닛·통합 시험 재실행, macOS·Linux

## 5. PM 판단 필요

없다. 사용자에게 물을 질문도 없다.
