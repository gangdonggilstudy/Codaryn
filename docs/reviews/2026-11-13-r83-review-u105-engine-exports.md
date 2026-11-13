# R-83 병합 전 검토: 단위 U-105, 엔진 쪽 빈 곳 메우기 (w3:p5, 2026-11-13)

## 0. 대상과 방법

- 페르소나: 검증. 읽기 전용이다. 저장소 수정·커밋은 없다. 실제 API는 쓰지 않았다(대본 모델).
- **검토한 판: `pm/unit-U-105` = `c391a85`**(main `f7b878a` 위, 13파일 +869 −49)
  - 제품 코드 9파일: `src/engine/apply.ts`, `src/engine/preflight.ts`(새), `src/engine/index.ts`, `src/contracts/journal.ts`, `src/contracts/plan.ts`, `src/policy/index.ts`, `src/tools/index.ts`, `src/tools/plan-executor.ts`, `src/tools/plan-files.ts`
  - 새 시험 4파일. 기존 시험 파일은 하나도 고치지 않았다.
- 사본: `git archive`로 `.codaryn/r83/base`(`f7b878a`)와 `.codaryn/r83/u`(`c391a85`)를 풀었다. 둘 다 `tsc` 0이다.
- 실험(`.codaryn/r83/r83.mjs`, 로그 `r83.log`)
  - A: organize 예시(대본 모델)로 계획 실행 → `apply`를 두 판에서 같은 준비로 돌렸다. 아홉 경우다.
    - 견준 것: 종료 코드, stdout, stderr, 적용 실행의 `result.json`과 journal, 작업 공간 전체(파일 내용 해시, 폐기 보관함 포함)
    - 정규화: 실행 id, 시각, 시간(ms), 64자리 16진수(계획 다이제스트는 계획 실행을 담아 판마다 다르다. 파일 내용은 작업 공간 비교로 따로 본다)
  - B: `preflightPlan`(u)을 실제 작업 공간·실제 정책 관문·도구의 실행기로 직접 불렀다. 다른 프로세스가 잠금을 쥔 채였다.
  - 모든 CLI 호출에 시험의 네트워크 막이를 얹었다. 기본 설정 위치는 사례마다 새 폴더로 돌렸다.
- 수치(고정 판 트리 `c391a85`, 내 worktree에서 분리 체크아웃해 dist를 지우고 빌드): typecheck 0, 유닛 2879(통과 2875, 실패 0, 건너뜀 3, todo 1), 통합 559/559. PM의 수치와 같다.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 0 |
| 정보 | 4 (R83-I1~I4) |

| 볼 것 | 결과 |
| --- | --- |
| (1) apply의 동작 | **main과 같다.** 아홉 경우 모두 다섯 가지가 같다: 종료 코드, stdout, stderr, result.json·journal, 작업 공간 |
| (2) 떼어 낸 판정 | **순서까지 같다**(코드 대조, 3절) |
| (3) `preflightPlan` | **아무것도 옮기거나 기록하지 않고, 잠금을 잡지 않는다** |
| | - 잠금을 쥔 작업 공간에서 불러도 파일·`.codaryn`·`lock.json`이 그대로다. 남긴 시험 링크도 0이다 |
| | - 멈춤(`stop`)이 참이면 곧 `{stopped: true}`로 돌아온다 |
| | - 잠금은 부르는 쪽(applyPlan을 부르는 CLI·앱 계층) 몫이다 |
| (4) 시험 링크 수 | **지우기 동작은 그대로다.** `probeHardLink`의 답은 전과 같고, 세기만 더했다. 센 값은 아직 어디에도 쓰이지 않는다(출력 변화 없음) |
| (5) 고정 시험 파일 | **그대로다.** `sp0-expected.ts`, `sp0-golden.ts`, `real-catalog.test.ts`가 `f7b878a`와 같다. 기존 시험 파일도 고치지 않았다 |

## 2. apply 아홉 경우 (A, `r83.log`)

| 경우 | 결과(두 판) | 종료 | 같은 것 | `plan_checked`(u) |
| --- | --- | --- | --- | --- |
| 정상 | done/verified | 0/0 | 다섯 가지 모두 | 문제 없음 |
| 계획 뒤 원본이 바뀜 | failed/plan_stale | 1/1 | 모두 | `[{index 0, source_changed}]` |
| 원본이 없어짐 | failed/plan_stale | 1/1 | 모두 | `[{index 1, source_missing}]` |
| 대상이 이미 있음 | failed/plan_stale | 1/1 | 모두 | `[{index 0, destination_exists}]` |
| 적용 task가 폐기를 허용하지 않음(정책 거부) | failed/plan_stale | 1/1 | 모두 | `[{index 2, denied}]` |
| 두 번째 apply | 오류 `plan_already_applied` | 2/2 | 모두 | — |
| 계획 실행에 기록 변경 표시 | 오류 `plan_records_changed` | 2/2 | 모두. 적용 실행을 만들지 않음(실행 폴더 1/1) | — |
| 취소(취소 파일이 이미 있음) | cancelled/cancelled | 5/5 | 모두 | 점검 전에 멈춤(두 판 같음) |
| 옮긴 뒤 검증 실패 | failed/verifier_failed | 1/1 | 모두 | 문제 없음 |

## 3. 떼어 낸 판정의 대조 (코드)

| | main `apply.ts` | U-105 `preflight.ts` + `apply.ts` |
| --- | --- | --- |
| 허용 판정 `permitted` | ① task의 `planActions`에 없으면 거부 ② `checkRequested`가 거부하면 거부 ③ `checkEffective`가 거부하면 거부 ④ 던지면 거부 | 같은 순서, 같은 글(`preflight.ts:20-30`) |
| 부르는 값 | `{id: action-<i>, name: descriptor.name, args: pathArgs}` | 같음 |
| 동작마다 | `interrupted()`를 먼저 봄 → 허용 안 되면 `denied` → `executor.check`(던지면 `io_error`) → `unsafe_move`는 동의 목록, 나머지는 문제 | `stop()`을 먼저 봄(apply는 `halt.end = interrupted()`) → 같은 순서 |
| 멈춤 | `return stop`(그 End) | `preflight.stopped`이면 `halt.end ?? CANCELLED`. `stop`이 참일 때 `halt.end`가 늘 채워지므로 같은 End |
| 기록 | `plan_checked {problems, inventoryLimitReached, unsafeMoves}` | 같은 줄, 같은 값(위 표의 journal 비교) |
| 인자 | 닫힌 변수 `planActions`, `policy`, `executor` | 같은 변수를 넘김 |

## 4. 정보

- **R83-I1 점검 도중의 취소는 CLI로 만들지 못했다.**
  - 취소 파일이 처음부터 있으면 두 판 모두 점검 전에 멈춘다.
  - 점검 안의 멈춤 길은 두 곳으로 확인했다: 코드 대조(3절), `preflightPlan`을 직접 부른 B(두 번째에 참을 주면 두 번 보고 멈춤).
  - 단위의 시험(`tests/unit/engine/u105-preflight.test.ts`)도 그 길을 본다.
- **R83-I2 `preflightPlan`은 디스크에 아무것도 남기지 않지만, 읽기만 하는 것은 아니다.**
  - 실행기의 `check`가 하드 링크 시험을 상태 디렉터리(같은 볼륨이 아니면 원본 옆)에 만들었다가 바로 지운다.
  - B에서 남은 것은 0이다. 그러나 잠금 없이 부르는 쪽(앞으로 앱 계층의 `checkApply`)은 다른 실행이 잠금을 쥔 동안에도 `.codaryn`에 그 이름을 잠깐 만든다.
  - 계약 주석("moves, records and claims nothing")과 맞다. 잠금을 잡을지는 그 단위가 정할 일이다.
- **R83-I3 `probesLeft`는 세기만 하고 아직 아무도 읽지 않는다.** 출력이 바뀌지 않는 까닭이다. `isMissing`/`errorCode`는 어떤 값에도 던지지 않는다. 그래서 `catch` 안의 새 줄이 답("unknown")을 바꾸지 않는다.
- **R83-I4 런타임 기록 종류 목록은 빠짐이 없다.** 세 목록이 `satisfies Record<…Type, true>`라 타입에서 하나라도 빠지면 컴파일되지 않는다. U-74의 두 종류(`confirmation_requested`, `confirmation_answered`)는 `9073303`에서 들어갔다.

## 5. 검사하지 않은 범위

- 하드 링크가 없는 드라이브의 위험한 이동(동의 경로), 인벤토리 상한(10만 파일): 코드가 같은 것으로 대신했다
- 점검 도중의 실제 취소와 시간 한도(I1)
- Linux·macOS, GUI(이 단위는 GUI를 고치지 않았다)

## 6. PM 판단 필요

없다. 사용자에게 물을 질문도 없다.
