# R-114 검토: U-293 (p5a, C-6a의 셋째 커밋: 앱의 실행 수명) — GUI·통합 쪽

- 검토: ne-verify (w3:p4). 읽기 전용이고 커밋하지 않았다. src 쪽은 Codex V-31이 본다.
- 판: `pm/unit-C6e` = `ebad6566dc5f4a4ee1156b377ca5f694fa2f6d60`. main `05ad033e` 위에 2커밋(36d83f7d, a973b15c)이 있다.
- 범위: U-293이 GUI 파일을 바꾸지 않았으므로, GUI의 실행이 새 앱 수명을 지날 때의 동작을 봤다(smoke, 탐침, 엔진 호스트 코드). 통합은 c01 여덟과 n20이다.
- 실제 API, 외부 네트워크, 임시 worktree는 쓰지 않았다. 탐침은 판 사본의 빌드를 썼다.

## 결론

- **높음 0, 중간 0, 낮음 0, 참고 2.**
- 시험(판 사본 `.codaryn/r114/c` = `ebad6566`)

| 시험 | 결과 |
|---|---|
| 루트 `npm run build` | exit 0 |
| GUI `npm test`(빌드 포함) | 409개, 통과 409, 실패 0 |
| smoke "조용함" | 227/227, 35초. 시작 때 다른 세션의 부하로 CPU 100%, node 85개였다. host 108 ms |
| smoke 부하 1 | 227/227, 51초, CPU 100%, node 94개, host 1,461 ms |
| smoke 부하 2 | 227/227, 47초, CPU 100%, node 72개, host 217 ms |
| smoke 부하 3 | 227/227, 77초, CPU 99%, node 68개, host 2,101 ms |

  - host는 hostEndsWhenMainKilled다. 네 번 모두 ok다(5초 기준 안).
    - 부하 아래 1.5~2.1초는 R-113(108~218 ms)보다 길다.
    - R-111c에서도 부하 아래 19초(NOTE)가 한 번 있었고, 이 길은 신호를 쓰지 않는다(2절). 그래서 부하 탓으로 본다.
  - 부하: claude-operations worktree의 dist에서 루트 unit·integration을 두 갈래로 돌렸다. 기록은 `r114/series.log`, `smoke-*.log`.
  - 창에서의 취소(`cancelDone: "cancelled"`), 실행 중 닫기(`closeRequestArrived`, `closeGuard`)도 네 번 모두 통과했다.

- PM이 물은 것
  1. **새로 생긴 것이 창·IPC로 가는가: 가지 않는다.**
     - 엔진 호스트(`gui/src/engine-host/runs.ts`)는 손잡이에서 `runId`·`cancel`·`done`만 읽는다.
     - 결과는 `runResultValue`가 필드를 골라 적고, 거부는 `failureOf`가 code·hint만 적는다.
     - 그래서 손잡이의 `configLanguage`·`defaultConfig`·`mask`, 결과 옆의 `tally`·`modelNotFound`, 거부 옆의 `configLanguage`는 메인 프로세스로 가는 줄에 없다. 탐침으로 확인했다(1절).
     - 저장 기록 통로(`onStoredRecord`)는 쓰지 않는다. 호스트의 관찰자는 `onEvent`와 `confirm`뿐이다.
     - 계약 주석과 맞다: `mask`는 "엔진 호스트가 창이나 IPC로 넘기지 않는다", `onStoredRecord`는 "창·IPC로 넘기는 호스트는 쓰지 않는다". `tally`·`modelNotFound`는 막지 않지만, 지금 GUI는 넘기지 않는다.
  2. **신호 고리: GUI 호스트 프로세스에는 걸리지 않는다.**
     - 앱은 `AppEnvironment.onSignal`이 있을 때만 프로세스 신호를 건다(`app.ts`의 취소 원천).
     - GUI 호스트는 `createNodeAppEnvironment()`를 그대로 쓰고, 이 환경에는 `onSignal`이 없다(`src/app/environment.ts`, `gui/src/engine-host/main.ts:164`, `gui/src`에 `onSignal` 없음).
     - 그래서 창 닫기(메인 → 호스트의 취소 → `handle.cancel()`)와 메인이 죽으면 호스트가 끝나는 길은 신호와 무관하게 전과 같다. smoke 네 번 모두 `hostEndsWhenMainKilled` ok, 닫기 확인 단계 통과였다.
  3. **한 호스트에서 실행 둘이 이어질 때 남는 고리가 없다.** GUI 환경과 `onSignal`을 준 환경 모두 그렇다(2절).
  4. **c01 여덟과 n20**: 이 판에서 21개, 통과 20, todo 1(알려진 것), 실패 0이다(3절).

## 1. 새 필드가 엔진 호스트를 지나는가 (`probe/host-fields.mjs`)

판의 빌드한 `createRunRegistry`(gui/build)에 가짜 `startRun`을 줬다.
- 시작 쪽: 손잡이에 `configLanguage: "ko"`, `defaultConfig`(표지 값 포함), `mask`(표지를 붙이는 함수)를 넣었다. `done`에 `tally`(표지 포함)와 `modelNotFound: true`를 넣었다.
- 거부 쪽: `configLanguage: "ko"`를 실은 거부를 줬다.

| 경우 | 호출의 답 | 메인으로 쓴 줄 | 찾은 것 |
|---|---|---|---|
| 시작 | `{ ok, run, runId }` | `done` 한 줄 | 없음(`"mask"`, 표지, `tally`, `deniedToolCalls`, `modelNotFound`, `configLanguage`, `defaultConfig`, `"ko"` 모두 0) |
| 거부 | `{ ok: false, code: "workspace_locked" }` | 없음 | 없음 |

- 호스트의 관찰자 키: `onEvent`, `confirm`.

## 2. 신호 고리와 남는 것 (`probe/signals.mjs`)

판의 빌드한 앱 계층으로 같은 프로세스에서 실행을 잇따라 돌리며 SIGINT·SIGTERM의 처리기 수와 살아 있는 자원을 쟀다.

| 환경 | 실행 1 중 / 뒤 | 실행 2 중 / 뒤 | 잠금 거부 뒤 | 대본 오류 뒤 | 실행 중 SIGINT |
|---|---|---|---|---|---|
| GUI 호스트(`onSignal` 없음) | 0·0 / 0·0 | 0·0 / 0·0 | 0·0 | 0·0 | — |
| `onSignal`(process.on/off, CLI가 커밋 4에서 줄 꼴) | 1·1 / 0·0 | 1·1 / 0·0 | 0·0 | 0·0 | `cancelled/cancelled`, 뒤 0·0 |

- 살아 있는 자원(`process.getActiveResourcesInfo`)은 실행마다 늘지 않았다.
- 대본 오류(8단계)는 취소 원천을 만들기 전에 거부되므로 처리기가 걸리지 않는다. 계획 6.2의 "실행 전 검사 중에는 걸지 않는다"와 맞다.
- 잠금 거부는 조립에서 나므로 취소 원천을 만든 뒤다. 그래도 `finally`의 `dispose`로 떼어진다.

## 3. c01 여덟과 n20 (이 판의 빌드)

- 이 커밋에서 CLI는 아직 제 수명(`runPrepared`)이고, 앱은 새 수명(`runLife`)이다. 그래서 c01이 두 수명을 맞대는 유일한 통합 점검이다(p5a 9.2). 여덟 모두 결과와 기록이 필드까지 같았다.
  - 문서 실행, 거부, 재수정, 계획과 적용, 모델 오류
  - 시작 전 취소 파일, 물을 수 없는 권한 질문(모의 API), 잠금 거부
- n20 열셋(todo 하나)은 CLI의 지금 출력을 고정한다. 이 커밋은 CLI를 바꾸지 않으므로 그대로 통과한다. 커밋 4(CLI 뒤집기)에서 지키는 것이 n20의 몫이다.

## 4. 참고

### I-1 c01에는 Y-4·N-1·lock left 사례가 없다

- 새 앱 수명이 결과에 더하는 Y-4 안내와 N-1 안내, lock left는 c01에서 두 수명을 맞대지 않는다.
- U-293의 유닛 시험(`tests/unit/app/u293-run-life.test.ts`)이 같은 프로세스에서 옛 `runCli`와 맞댄다(modelNotFound, 손잡이의 기본 설정 위치). 그래서 지금 빈 곳은 아니다.
- 커밋 4 뒤에는 두 수명이 하나가 되므로 c01에 더해도 얻는 것이 작다. 더하지 않아도 된다.

### I-2 엔진 호스트가 새 필드를 넘기지 않음을 GUI 시험이 고정하지 않는다

- 지금은 호스트가 필드를 골라 적는 구조로 막혀 있다(1절). `mask`는 함수라 JSON으로 나갈 수도 없다.
- 그러나 U-292의 `onStoredRecord`처럼 이를 고정하는 GUI 시험은 없다. 뒷날 누가 `...outcome`을 펼쳐 쓰면 `tally`나 거부의 `configLanguage`가 창으로 갈 수 있다. 그 둘은 계약이 막지 않아 해가 없을 수도 있다.
- 제안(결정은 p5u-gui): 1절 탐침과 같은 단위 시험 하나를 둔다. 새 필드를 실은 손잡이와 결과가 호스트의 줄에 나가지 않음을 본다.

## 5. 판정 근거로 본 것

- `git diff 05ad033e ebad6566`: `src/app/app.ts`(startRun), `run-life.ts`, `events.ts`(`deliverStored`), `types.ts`; 계약 `src/contracts/app.ts`(RunOutcome, RunHandle, StartOutcome, AppEnvironment.onSignal)
- GUI: `gui/src/engine-host/runs.ts`(launch, runResultValue), `settings.ts`(failureOf), `main.ts`(앱 만들기)
- 탐침(커밋하지 않음): `r114/probe/host-fields.mjs`, `signals.mjs`
