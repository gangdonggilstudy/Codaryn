# V-24b — 통합 판의 앱 경로 읽기 제외 재확인

- 검증자: **codex-audit**, 검증 엔지니어 / 앱 실행 경계 검토.
- 일자: 2026-11-14 KST. 실행 로그의 UTC 날짜는 2026-11-13이다.
- 후보: `pm/unit-A7`, **87ddd92be4c55a4bff656418bee699d034ad4bda**.
- 기준 main: **9d435c427212bdf1b90218fe0afcb796549902e1**.
- 판정: **높음 0건 / 중간 0건 / 낮음 0건**. 이번에 실행한 범위에서 새 결함을 재현하지 못했다. 이전 M-1·M-3은 해소됐고, M-2는 PM이 정한 사람용 보기 허용 범위로 재분류했다. 보기의 내용이 후속 모델 요청·기록으로 넘어가지 않는지도 확인했다.
- 독립 검사 **46/46 통과**, 관련 유닛 **39/39 통과**(13 suites, 실패·취소·건너뜀·todo 모두 0), 루트 빌드 종료 **0**.
- Windows / Node **v26.13.1**. Electron·실제 API·외부 네트워크는 사용하지 않았다.

## 1. 판과 작업 경계

시작 때 관리 저장소의 `git status --short`는 변경 항목이 없었고, 브랜치는 `main`, 루트는 `D:/project/Codaryn`이었다. `git rev-parse pm/unit-A7`은 지정 해시와 같았다. `git merge-base --is-ancestor 9d435c42 87ddd92...`는 **종료 0**이었다. 종료 전에도 브랜치 해시가 같고 main 자체가 지정 기준 해시인 것을 확인했으며, `--is-ancestor main 87ddd92...`도 **0**이었다. 이전 V-24의 기준 미포함 문제는 없다.

후보를 `git archive`로 아래 새 폴더에 풀었다.

```text
D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-audit-v24b-87ddd92/
  head/                 지정 해시의 사본과 빌드 산출물
  head.zip              원본 git archive
  src.diff              지정 기준과 후보의 src 차이
  probe.mjs             독립 공개 앱 함수·실제 CLI 재현
  run-units.mjs         관련 유닛 7파일 실행기
  offline-guard.mjs     fetch, net connect, http(s) 요청 차단
```

원본 저장소 파일 수정·커밋·푸시·worktree 추가는 하지 않았다. 의존성은 기존 로컬 `node_modules`를 사본으로 복사했고 설치·다운로드는 하지 않았다. 시험 폴더·TEMP·캐시·보고서는 이 검증 폴더 안에만 썼다. 실제 API 키나 키 파일을 읽거나 출력하지 않았으며 권한 상승도 요청하지 않았다. 종료 전 원본 `git status --short`에도 변경 항목이 없었다. Git의 사용자 전역 ignore 읽기 권한 경고는 있었으나, 전역 설정 변경이나 권한 요청 없이 명령별 `safe.directory`만 지정했다.

지정 `src` 차이는 **26파일, +888/-220**이며 `src.diff`에 보존했다. 제품 소스는 수정하지 않았다.

## 2. 이전 중간 세 건 재확인

### M-1: checkApply의 설정·프로필 목록 누락 — 해소

동일한 재현을 **설정·선택 프로필·작업 종류 정의·task 4출처 × 실행 계획·이동 계획 2종류**로 실행했다.

1. 제외가 없는 상태에서 `private/secret.txt`를 바꾸거나 옮기는 계획을 만든다.
2. 한 출처의 `policy.unreadablePaths`에 `private`를 더한다. 다른 출처에는 넣지 않는다.
3. 같은 공개 앱 인스턴스에서 `checkApply` 후 `applyPlan`을 부른다.

**8개 모두** 점검이 제외된 파일을 문제로 보고했다. 실행 계획은 `[{index:0, problem:"denied"}]`였다. 실제 적용은 **plan_stale**로 거부됐고 작업 파일은 바뀌지 않았다. 실행 계획 적용은 각 경우 **model_request 0건**이었다.

추가로 네 출처에 서로 다른 폴더를 동시에 지정했다. 실행 계획과 이동 계획 모두 **문제 인덱스 [0,1,2,3]**을 돌려주고 실제 적용도 거부했다. 단일 출처를 덮어쓰는 것이 아니라 합친 목록을 쓴다.

각 출처의 마지막 제외 항목을 다시 뺀 경우 **4개 모두** 점검 문제가 사라졌고 실행 계획 적용이 `done/verified`로 파일을 바꿨다. 적용 시점의 설정을 다시 판정하는 결과다.

코드 대조:

- `head/src/app/app.ts:1004`: 해결된 task의 `unreadablePaths`를 실행 계획 점검에 전달.
- `head/src/app/changes-plan.ts`: `runGuards(...).gate(approvedPlanWritablePathSets(...))`와 엔진의 `judgePlannedFile`로 점검.
- `head/src/app/check-apply.ts:185`: 이동 계획 점검도 `runGuards(task, workspace).gate()` 사용.
- `head/src/cli/assemble.ts:447`, `head/src/cli/plan-commands.ts:777`: 실제 실행·이동 적용에 같은 관문 구성 사용.

재현 명령: `node probe.mjs "check"`, `node probe.mjs "all four"`, `node probe.mjs "removing last"`.

### M-3: 앱 실행 계획 적용 미연결 — 해소

네 출처에서 공개 `startRun`으로 `kind: changes` 계획을 만든 뒤 공개 `applyPlan`으로 수행했다. 각 계획은 `docs/guide.md` 하나만 승인했다. 수행 모델은 다음을 순서대로 시도했다.

- 제외 폴더의 `read_file`, `write_file`, `search_files`, `inspect_files`.
- 루트 검색·목록 조회와 제외 CSV의 `query_table`.
- 승인 목록 밖 `docs/outside-plan.txt` 쓰기.
- 승인된 `docs/guide.md` 쓰기.

각 출처에서 **unreadable_path 4건**, 승인 밖 쓰기 **path_not_writable 1건**이 기록됐다. 제외 폴더 내용은 그대로이고 승인 밖 파일은 생기지 않았다. 승인 파일은 새 글로 바뀌고 **done/verified**로 끝났으며 `planRunId`는 계획 생성 실행을 가리켰다. 이벤트는 handle 반환 뒤에 도착했다.

CSV의 4행 묶음은 숨겨졌다. 5행이지만 수치가 4칸인 묶음은 **[5, null, null]**로 나왔고 개별 행 표지·숨겨진 묶음 키·제외 파일명 표지는 모델 요청·기록·이벤트에 없었다. `startRun` 자체에서는 네 출처 각각 k=5와 k=7을 별도로 검증했다. k=5의 희소 묶음은 `fewCells: [1,2]`, k=7에서는 7행 묶음 하나만 반환됐다.

`head/src/app/app.ts:888` 부근에서 `runApply`에 앱 실행 환경을 전달하고, 앱 관찰자·취소·확인 함수를 `appRunHooks`로 구성하는 것을 대조했다. `head/src/app/assemble.ts`는 CLI의 `createAssemble`를 쓰면서 앱의 `onAssembled`·`onLockLeft`를 유지한다.

재현 명령: `node probe.mjs "carried plan app guards"`.

### M-2: 새로 제외된 파일의 사람용 보기 — PM 결정에 따른 허용, 후속 유출 미재현

이전 보고서의 “변경 보기에서 이전 원문을 돌려준다”는 현상은 그대로 있다. **이제 결함으로 세지 않는다.** PM의 이번 지시대로 읽기 제외는 모델에 가는 것을 막으며, 사람이 자신의 변경·파일을 보는 것은 허용된다.

네 출처마다 다음을 검증했다.

1. 제외가 없을 때 합성 표지를 가진 파일을 공개 글로 덮어써 변경 스냅샷을 만든다. 모델은 이전 글을 읽지 않는다.
2. 제외를 더한 뒤 같은 앱 인스턴스의 `changes`에서 이전 글을 보고, `readWorkspaceText`로 제외 아래 다른 표지 파일을 연다.
3. 보기 전후 `.codaryn` 파일 전체를 비교한다. **내용·파일 목록 변경 없음**.
4. 같은 앱에서 다음 실행을 시작해 해당 원문 파일과 이전 실행의 스냅샷 경로를 `read_file`로 요청하고 루트 검색·목록 조회도 한다.

**4개 모두** 사람용 반환에는 원문이 있었고, 후속 두 읽기는 거부됐다. 원래 파일의 거부 코드는 `unreadable_path`였다. 원문·숨긴 묶음 키·파일명 표지가 후속 결과·이벤트·모델 요청이나 기록으로 복사되지 않았다. 가림·치환 변형도 검사했다.

스냅샷 원본 자체는 기존 계약에 따라 로컬 상태 폴더에 남는다. 따라서 “디스크의 모든 파일에 표지가 없다”고 주장하지 않는다. 이 경우 모델·기록 표지 검사는 변경 스냅샷을 제외한 기록 파일과 `model_request`를 대상으로 했다. 사람이 받은 글을 직접 새 goal에 붙여 넣는 별도 행동까지 막는다는 주장도 하지 않는다.

정적 대조에서도 `changes`와 `readWorkspaceText`는 읽기 결과를 반환할 뿐 실행 입력이나 저널에 넣는 연결이 없다(`head/src/app/app.ts:469`, `:516`).

재현 명령: `node probe.mjs "human views"`.

## 3. 이동 계획·CLI 일치·앱 고리

| 검사 | 실제 결과 |
| --- | --- |
| 네 출처의 일반 startRun | 각 출처에서 제외 아래 읽기·쓰기·검색·목록 요청 4건 거부. 루트 조회에서 제외 표지 없음. 공개 쓰기 성공 |
| 네 출처의 정상 이동 적용 | 계획 생성 중 제외 파일 조회 시도를 거부하고 공개 파일 이동만 제안. 점검 문제 없음. 실제로 `docs/guide.md` → `sorted/guide.md` 이동, **done/verified**. 제외 폴더 불변, 적용 이벤트에 표지 없음 |
| 검증기 증거 4출처 | 제외 CSV를 쓰는 aggregate_match 실패·재수정 경로에서 원래 수치 `2345.6789`가 증거·모델 요청·앱 결과에 없음. 실제 repair_started 확인 |
| 무결성 | 첫 모델 요청 이벤트에서 시험기가 제외 파일을 바꾸면 **protected_changed** |
| startRun 취소 | file_changed 이벤트에서 취소, **cancelled**, 잠금 제거 |
| 실행 계획 취소 | 첫 승인 파일 쓰기 직후 취소, **cancelled**. 이미 쓴 파일은 완성된 새 글로 남음. 계획의 applied.json은 해당 적용 실행을 가리키며 재적용은 **plan_already_applied**. 잠금 없음 |
| writablePaths | 설정 `docs`와 task `docs/guide.md`의 교집합 밖 쓰기 2건 거부. 승인 뒤 현재 task 목록이 승인 파일을 제외하도록 좁아지면 점검 denied, 적용 plan_stale, 모델 요청 0 |
| 읽기 제외와 명령 규칙 동시 설정 | 실행 시작 전에 **invalid_task / unreadable_with_commands**, 이벤트 0, runs 폴더 미생성 |
| handle·이벤트 | 독립 startRun·applyPlan에서 handle이 반환되기 전 이벤트 0. 수행 중 실제 이벤트 수신 |
| 권한 질문 | 관련 U-108 유닛에서 실제 엔진에 질문 관문을 주입: allow_once, deny, 누락·예외·잘못된 답 기본 거부, 질문 중 취소와 AbortSignal 통과. U-218은 적용 실행의 confirm 전달 통과 |
| lockLeft | 관련 U-193·U-218 유닛의 Windows 잠금 파일 보유 재현 통과. 결과 유지·lockLeft 전달·잠금 잔존을 확인. checkApply release false/throw 전달도 통과 |

CLI는 `node head/dist/src/cli/main.js`를 실제 자식 프로세스로 **5회** 실행했다. API 제공자는 모두 scripted였다.

| 같은 입력 비교 | 앱·CLI 각각 비교한 저널 수 | 결과 |
| --- | ---: | --- |
| 일반 실행 | 31 | 결과·저널·사용자 파일 일치 |
| 실행 계획 생성 → 적용 | 생성 26 + 적용 31 | 결과·저널·사용자 파일 일치 |
| 이동 계획 생성 → 적용 | 생성 26 + 적용 12 | 결과·저널·사용자 파일 일치 |

비교 시 절대 시험 폴더, 실행 ID, 시각·기간·mtime의 시각 문자열, 계획 digest를 정규화했다. 별도 실행에서 계획의 시간·ID가 달라 digest도 달라지는 부분이다. 파일 내용·해시·거부 코드·도구 결과·순서·수치의 차이는 숨기지 않았다. 적용 승인 출처는 의도된 차이 **앱 adapter / CLI cli-flag**를 각각 먼저 단언한 뒤 비교에서 정규화했다. CLI 승인에는 다이제스트 앞 12자를 사용했다. 계획 생성 두 명령은 `plan_pending`으로 **종료 3**, 나머지 일반 실행·적용 세 명령은 **종료 0**이었다.

증거는 최종 결과 폴더의 `parity.json`, `parity-run.json`, `parity-apply.json`과 `calls.json`이다.

## 4. 실행 명령과 수치

원본 저장소에서 읽기 전용으로 실행:

```powershell
git -c safe.directory=D:/project/Codaryn status --short
git -c safe.directory=D:/project/Codaryn branch --show-current
git -c safe.directory=D:/project/Codaryn rev-parse --show-toplevel
git -c safe.directory=D:/project/Codaryn rev-parse pm/unit-A7
git -c safe.directory=D:/project/Codaryn rev-parse main
git -c safe.directory=D:/project/Codaryn merge-base --is-ancestor 9d435c42 87ddd92be4c55a4bff656418bee699d034ad4bda
git -c safe.directory=D:/project/Codaryn merge-base --is-ancestor main 87ddd92be4c55a4bff656418bee699d034ad4bda
git -c safe.directory=D:/project/Codaryn archive --format=zip --output=<검증 폴더>/head.zip 87ddd92be4c55a4bff656418bee699d034ad4bda
git -c safe.directory=D:/project/Codaryn diff 9d435c42 87ddd92be4c55a4bff656418bee699d034ad4bda -- src
```

사본 `head`에서 `npm.cmd run build`: **종료 0**, `build.log`. 상위 검증 폴더에서:

```powershell
node run-units.mjs
node probe.mjs
node summarize.mjs
```

`run-units.mjs`는 환경 변수를 최소 집합으로 만들고 TEMP·홈·설정 경로를 자기 폴더 아래로 둔 뒤 다음 **7파일만** 실행했다. 실행 명령 원문은 `unit-execution.json`에 있다.

```text
node --import <검증 폴더>/offline-guard.mjs --test
  dist/tests/unit/app/u237-app-unreadable.test.js
  dist/tests/unit/app/u237-app-checks-unreadable.test.js
  dist/tests/unit/app/u237-v24-carry-and-view.test.js
  dist/tests/unit/app/u218-run-plan-apply.test.js
  dist/tests/unit/app/u193-lock-left.test.js
  dist/tests/unit/app/u108-confirm-relay.test.js
  dist/tests/unit/app/u186-writable-paths-app.test.js
```

- 유닛: **39 통과 / 0 실패 / 0 취소 / 0 건너뜀 / 0 todo**, **13 suites**, Node test 시간 **9281.1932 ms**, 실행기 기록 **9570 ms**, 종료 **0**. stderr 비어 있음.
- 독립 최종 검사: **46 통과 / 0 실패**, 종료 **0**. 최종 폴더 **cases-2026-11-13T15-05-35-338Z**.
- 최종 독립 자료에 생성된 실행 디렉터리 **81개**, 저널 레코드 **1229개**, 그중 대본 모델 `model_request` **118개**. 이 숫자는 유닛·초기 시험을 합산하지 않았다.
- API 호출 수 **0**. 시험은 `offline-guard.mjs`를 가져오며 CLI 자식 프로세스에도 같은 preload를 적용했다. 네트워크를 사용하는 시험은 선택하지 않았다.
- 독립 46개는 저장소 테스트를 추가한 것이 아니라 이 검증 폴더의 공개 API 재현이다. 엔진·관문을 대체하는 AppHooks를 사용하지 않는다. 반면 권한·잠금 유닛은 아래와 같이 일부 경계를 주입한다.

최종 핵심 증거:

```text
final-probe.log
evidence-summary.json
cases-2026-11-13T15-05-35-338Z/results.json
cases-2026-11-13T15-05-35-338Z/calls.json
cases-2026-11-13T15-05-35-338Z/parity*.json
unit.log
unit-stderr.log
unit-execution.json
```

초기 시험도 남겼다. `initial-probe.log`는 처음 31개 재확인의 전부 통과다. `expanded-probe.log`, `fixture-pilot.log`, `permission-probe.log`의 실패는 최종 통과로 소급하지 않는다. 이동 성공 시험은 이동 전 경로를 검사하던 시험기의 검증기 경로를 이동 후 경로로 고쳤고, 성공 status를 `awaiting_review`로 잘못 예상한 단언도 실제 계약의 `done/verified`로 고쳤다. 계획의 사람 판정과 terminal status는 별개다. 권한 질문 시험은 읽기 제외+명령의 금지 조건, task 정책의 우선순위, quick 설정의 scripted 미지원 때문에 원하는 질문에 도달하지 못했다. 해당 3개는 최종 독립 검사 수에서 제외하고 기존 관련 유닛으로 확인한 범위를 명시했다. 제품 소스는 손대지 않았고 최종 46개를 한 번에 다시 실행했다.

## 5. 검증 한계와 PM 판단

- **설정만 사용한 scripted 권한 질문 끝에서 끝 시험은 미수행**이다. scripted 제공자는 task 파일용이고, `confirm: true`는 설정·프로필용이며 task 파일은 자신의 명령 정책을 갖는다. U-108은 실제 엔진의 관문을 질문 규칙으로 주입하고 U-218은 실행 계획의 confirm 경계를 주입한다. 그 유닛들이 통과했다는 결과와 독립 공개 함수 검사를 구분한다. 읽기 제외+명령이 차단되는 경로는 독립 검사에서 확인했다.
- 잠금 실패는 관련 유닛에서 Windows 파일을 다른 프로세스가 보유하는 방식으로 실제 재현했으며, checkApply의 release false/throw는 주입 시험이다. 일반 실행·적용 취소와 정상 잠금 해제는 독립 재현이다.
- Electron GUI, OS 권한 대화상자, 실제 API, 외부 네트워크, Linux/macOS, 전체 테스트 묶음은 실행하지 않았다. 이번 판단은 지정 통합 해시의 앱·CLI 오프라인 범위다.
- 사람용 변경·파일 보기의 원문 반환은 **PM이 이미 허용한 범위**다. 이번 시험에서 그 값을 자동으로 후속 모델 입력이나 기록에 넣는 경로는 발견하지 못했다. 이를 다시 결함으로 세거나 별도 승인을 요청하지 않는다.
- 이 범위에서 추가 수정 요청이나 미해결 결함은 없다. 병합·통합 판단은 PM에게 남긴다.
