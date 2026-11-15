# V-31 — U-293 / C-6a 앱 실행 수명 검증

- 담당: codex-review, 읽기 전용 독립 보안·정확성 검증.
- **높음 0 / 중간 0 / 낮음 1**. 낮음 1건은 어댑터의 신호 등록·해제 콜백이 예외를 던지는 조건에서만 재현. 일반 신호 등록·해제에서는 잔류 0.
- 대상 `pm/unit-C6e`: `ebad6566dc5f4a4ee1156b377ca5f694fa2f6d60` 확인. 고정 비교 기준 `05ad033e3d5878c6bd0bc8eec9018a30b74dd8b2`.
- archive 사본·스크립트·증거는 `.codaryn/v31/` 안. Node `v26.13.1`, Windows. 저장소 추적 파일 수정·커밋·푸시·worktree 추가·실제 API·실제 키 조회·외부 네트워크·권한 요청 0.

## L-1 — 신호 등록·해제 콜백 예외 시 다른 핸들러가 남음

위치: **`src/app/app.ts:348`, `src/app/app.ts:351`, `src/app/run-life.ts:141`, `src/app/run-life.ts:175`**. 직접 원인은 공유 도우미 **`src/cli/cancel.ts:25`, `src/cli/cancel.ts:42`**.

재현: [boundaries.mjs](v31/boundaries.mjs)의 `second-registration`, `first-remover`. 실제 `process.on/off`를 쓰고 지정한 콜백 경계에만 합성 예외를 넣었다. 남은 자체 핸들러는 관측 후 시험 스크립트가 제거했다.

1. `onSignal('SIGINT', fn)`은 등록·해제 함수를 정상 반환하고, 두 번째 `onSignal('SIGTERM', fn)`이 throw하도록 설정한다. `app.startRun`은 `internal_error`로 거부되지만 **SIGINT 1개가 남는다**. 호출 순서는 on SIGINT → on SIGTERM; off 호출 0. cancel source 생성이 `runLife`의 try/finally 밖이고, 도우미도 부분 등록을 되돌리지 않는다.
2. 두 신호 모두 정상 등록한다. 첫 remover가 SIGINT를 제거한 뒤 throw하도록 설정한다. 실행 종료 시 **SIGTERM 1개가 남고**, `handle.done`은 `internal_error`가 된다. 호출 순서는 on SIGINT → on SIGTERM → off SIGINT; off SIGTERM 호출 0. dispose의 순차 루프가 첫 예외에서 중단된다.

두 경우 작업 공간 잠금 잔류는 **0**. 남은 리스너는 완료·거부된 실행의 AbortController만 붙잡으며, 해당 신호에 대한 Node의 기본 종료 동작을 가로막을 수 있다. 입력 파일·모델 응답만으로 유발한 문제가 아니며, 정상적인 Node 등록/해제에서는 재현하지 못했다. 이 때문에 낮음으로 분류한다.

`src/cli/cancel.ts`는 기준 판과 변경 **0**: 기존 CLI 도우미의 예외 안전성 한계다. 이번 커밋에서 앱이 외부 `AppEnvironment.onSignal`과 remover를 실제로 호출하면서 앱의 새 경로에도 노출됐다. 모든 throw 경로의 정리를 보장하려면 부분 등록 롤백 및 remover별 독립 정리가 필요하다.

## 요청별 확인 결과

| 확인 항목 | 결과·근거 |
|---|---|
| 코드 이동의 동일성 | `git diff --color-moved --color-moved-ws=allow-indentation-change` 및 [moved.mjs](v31/moved.mjs) 대조. failed-calls **47줄**, query-table-facts **77줄**, result-fields **17줄**은 원본과 동일(query-table의 상대 import 깊이만 정규화). notePrivateData 함수 **9줄** 동일, countingJournal의 이동된 본문 **30줄**은 들여쓰기 외 동일. |
| 수명 코드의 의도적 차이 | headDiagnostic·watchingNotFound·withNotice·defaultConfigNotice 함수 본문 동일. `withModelHint`는 터미널용 인자와 writeMasked 호출만 제외; notice를 만드는 본문 동일. run-life 전체를 단순 텍스트 이동이라고 판정하지 않음: 터미널 출력·질문·요약과 승인 계획 실행 분기는 CLI에 남아 있음. |
| 집계와 결과 분리 | `src/app/app.ts:403`의 done 객체는 result 옆에 tally를 붙임. `src/app/tally.ts:72`의 counts, handle의 configLanguage/defaultConfig/mask가 result.json이나 마스킹 RunEvent에 새 필드로 들어가지 않음. 실제 CLI stdout JSON과 각 실행의 result.json도 동일. |
| 오류 JSON·404 표시 | 관련 U-293 시험에서 시작 거부 **5종**, 모든 CLI 오류 코드의 fromCliError/runErrorOutput 역변환, HTTP 404 합성 제공자의 modelNotFound·notice를 확인. `src/app/errors.ts:54`. 오류/결과 내부에 tally나 mask 추가 없음. 실제 HTTP 요청 없음. |
| GUI·IPC | `gui/src/engine-host/runs.ts:281`은 onEvent/confirm만 등록하며 onStoredRecord 없음. `runs.ts:94`에서 결과를 허용 필드로 새로 만들고 `runs.ts:364`를 거쳐 인코딩. handle 반환은 `runs.ts:376`의 run 토큰·runId만. 실제 host registry에 내부 canary와 mask/tally getter를 넣은 시험: IPC done **1개**, canary 노출 **0**, mask 읽기 **0**, tally 읽기 **0**. 현재 GUI가 새 앱 tally를 사용하지 않는 것도 확인. |
| 저장 기록과 마스킹 이벤트 | `src/app/events.ts:115`에서 append 완료 후 `:116`의 저장 콜백, 이후 `:118`의 재마스킹. `:99`의 structuredClone으로 관찰자의 수정·예외를 격리. 네 실제 실행에서 저장 콜백 **52기록 모두 journal.jsonl의 파싱 결과와 동일**. 모든 전달 이벤트는 해당 저장 콜백 뒤에 옴. |
| 재마스킹 실패로 빠지는 기록 | 실제 파일 journal + 재마스킹 실패 주입: 저장 **2**, 콜백 **2**, 이벤트 **1**. 콜백에 journal에 없던 필드·값 **0**. 관찰자의 message 수정 및 throw가 저장 내용·후속 이벤트에 미친 영향 **0**. 닫힌 단어 안의 등록 합성값은 저장 채널에 그대로 있는 경우가 있으나 기존 journal에도 동일하게 있음. |
| 일반 종료의 신호 정리 | 성공, 엔진 throw, task/script 거부, 살아 있는 잠금 거부, SIGINT, SIGTERM, handle.cancel: 종료 뒤 핸들러 **0**. 조립 throw·finish throw 직접 경계 시험도 dispose 각각 **1회**. L-1은 등록/해제 훅 자체의 예외에 한정. |
| 한 프로세스의 실행 간 분리 | 같은 앱의 병렬 두 실행: 핸들러 수 **4→2→0**, 첫 handle.cancel은 두 번째를 취소하지 않음. 프로세스 신호 방송은 활성 실행 둘을 모두 취소(의도된 전역 신호). 같은 앱·작업 공간의 연속 **3회**에서 on **6** / off **6**, 잔류 **0**. |
| 준비 중 신호 | task 읽기를 일시 정지한 동안 등록 핸들러 **0**. 앱의 `run-life.ts:141`과 CLI의 `run.ts:320` 모두 준비·스크립트 검사 후 cancel source를 생성. 준비 중에는 이번 실행이 신호를 포착하지 않는 순서가 유지된다. Node/OS의 실제 기본 종료 동작 자체는 아래 미실행 범위 참고. |

## 실제 CLI와 앱 실행 대조

[compare.mjs](v31/compare.mjs)는 각 입력마다 별도 동일 fixture를 만들고 **실제 CLI 자식 프로세스**, **app.startRun**, **기존 runCli 직접 호출**을 실행했다. 모든 모델은 scripted. 실제 CLI는 `--json --quiet --config <합성 파일> --cancel-file <자체 폴더>` 사용. 집계는 CLI JSON에 없으므로 세 번째 실행의 info.summary와 앱 done.tally를 비교했다.

| 입력 | CLI exit | result status / reason | 기록 수(한 실행) | 앱 tally |
|---|---:|---|---:|---|
| 정상 NOTES.md 생성 | 0 | done / verified | 12 | denied 0 / command 0 / failed 0 |
| writablePaths 밖 other.md 쓰기 후 정상 작업 | 0 | done / verified | 16 | denied 1 / command 0 / failed 0 / deniedNotWritable 1 |
| 모델 요청 중 cancel 파일 생성 | 5 | cancelled / cancelled | 5 | denied 0 / command 0 / failed 0 |
| 합성 등록값 `not_writable`, `before_verify`가 닫힌 코드·phase에 포함 | 0 | done / verified | 19 | denied 1 / command 0 / failed 0 / deniedNotWritable 1 |

**4입력 × 3경로 = 12실행**. journal 및 result는 시간(at/durationMs), 실행 ID, fixture 절대 경로, 실행마다 무작위인 개인정보 토큰을 정규화한 뒤 **차이 0**. 이외 필드를 빼서 비교하지 않았다. 각 실행 내부의 저장 콜백과 journal 파싱 결과, 반환 result와 result.json, CLI JSON과 result.json은 정규화 없이 비교했다. 닫힌 단어 합성값은 마스킹 RunEvent에 남지 않았다. [compare-results.json](v31/compare-results.json)에 fixture 경로·수치 기록.

## 명령·시험 수치

주요 명령(저장소 조회는 `D:/project/Codaryn`, 시험은 `.codaryn/v31`, 빌드는 `v31/candidate`를 cwd로 지정):

```powershell
Get-Content AGENTS.md -Encoding UTF8
git status --short
git branch --show-current
git rev-parse --show-toplevel
git rev-parse pm/unit-C6e main
git diff --color-moved --color-moved-ws=allow-indentation-change 05ad033e ebad6566dc5f4a4ee1156b377ca5f694fa2f6d60 -- src
git diff --color=always --color-moved --color-moved-ws=allow-indentation-change 05ad033e ebad6566dc5f4a4ee1156b377ca5f694fa2f6d60 -- src
git diff 05ad033e ebad6566dc5f4a4ee1156b377ca5f694fa2f6d60 -- src/cli/cancel.ts
git archive --format=tar --output=.worktrees/codex-verify/.codaryn/v31/candidate.tar ebad6566dc5f4a4ee1156b377ca5f694fa2f6d60
git archive --format=tar --output=.worktrees/codex-verify/.codaryn/v31/base.tar 05ad033e src/cli/run.ts src/cli/failed-calls.ts src/cli/human/query-table.ts src/cli/result-fields.ts
tar -xf candidate.tar -C candidate
tar -xf base.tar -C base
node D:/project/Codaryn/node_modules/typescript/bin/tsc -p tsconfig.json --pretty false
node D:/project/Codaryn/node_modules/typescript/bin/tsc -p gui/tsconfig.host.json --typeRoots D:/project/Codaryn/node_modules/@types --pretty false
node ./moved.mjs
node --import ./guard.mjs ./compare.mjs
node --import ./guard.mjs ./signals-records.mjs
node --import ./guard.mjs ./boundaries.mjs
node ./run-units.mjs
```

- 두 빌드 exit **0**. 이동 동일성 검사 [moved-results.json](v31/moved-results.json); 신호·기록 경계 **13사례** [signals-records-results.json](v31/signals-records-results.json); 추가 경계 **5사례** [boundaries-results.json](v31/boundaries-results.json). 추가 경계 중 **2개가 L-1의 두 재현**, 나머지 3개 정상.
- 관련 시험 **5파일 / 30 tests / 30 pass / 0 fail / 0 skipped / 0 TODO**, **4790.3633 ms**. [unit-tests.tap](v31/unit-tests.tap).
- 실행 파일: `app/u293-run-life`, `app/r4-events`, `cli/human/u291-stored-record-lines`, `cli/u291-real-cli-pins`, `contracts/g-u18-failed-calls`의 `.test.js`. 전체 시험 묶음 미실행.
- 처음 이동 비교 스크립트가 withModelHint도 완전히 동일하다고 가정해 assertion 실패 1회. diff를 확인해 터미널 출력 제거라는 의도된 차이를 명시하고, 남은 notice 본문을 따로 비교한 최종 실행은 통과. 제품 코드는 수정하지 않았다.
- 시험 환경은 필요한 OS 경로와 합성값만 제공. TEMP/TMP와 재귀 정리 대상은 v31 안으로 제한. 끝의 main 조회는 다른 통합으로 `801709bab6ed79859ec45cb43d98b04eeb6cfe2f`를 가리켰으나 대상 브랜치 해시는 동일; 모든 검증은 지정된 고정 두 판으로 수행했다. main의 마지막 status 출력 0행.

미실행 범위: 실제 API, 실제 키, Electron 창·OS IPC 종단 실행, Windows 외 플랫폼, Windows OS에서 준비 중인 프로세스에 실제 Ctrl+C/SIGTERM 전송. 신호는 앱 주입 경계에서 시험했고, L-1은 실제 process.on/off 리스너로 확인했다. GUI 전달 검증은 실제 host registry의 protocol 문자열 생성까지이며, 화면 표시를 실행한 것은 아니다.
