# V-29 — C-4 실행 조립 이동 검증

- 검증자: **codex-audit**, 읽기 전용 검증 엔지니어 / 모듈 경계 검토.
- 일자: 2026-11-14 KST. 실행 자료의 UTC 날짜는 2026-11-13이다.
- 기준: main **c3b76221f9683e212b521b59cd7eb238eda76e33**.
- 후보: pm/unit-C4 **29fe13ff460f799a2cbbf07312473e91834bd2e4**.
- **높음 0건 / 중간 0건 / 낮음 0건.** 지정 범위에서 조립 동작의 변경이나 새 순환·미초기화 바인딩·조립 복제본을 찾지 못했다.
- **54·4·123줄 이동 확인.** 세 블록은 `lockedMessage` 앞의 `export ` 7바이트를 제외하면 같다. 남은 되돌리기 본문도 같다.
- 기준·후보 빌드 모두 **종료 0**. 관련 유닛 **기준 71/71, 후보 75/75 통과**. 실제 CLI 비교 **9사례 통과 / 차이 0**, 두 판 합계 **24회 호출**. 별도 프로세스 import 순서 검사 **5/5 통과**.

## 1. 판·격리·명령

시작 때 관리 저장소는 `main`, 루트는 `D:/project/Codaryn`, `git status --short`에 변경 항목이 없었다. `git rev-parse pm/unit-C4`는 지정 후보와 일치했고, `git merge-base --is-ancestor c3b76221 29fe13ff...`는 **0**이었다. 종료 때도 후보 브랜치는 같은 해시였고 원본 status에 변경 항목이 없었다.

지정된 `v29` 아래 새 자기 폴더에 두 판을 각각 `git archive`로 풀었다.

```text
D:/project/Codaryn/.worktrees/codex-verify/.codaryn/v29/codex-audit-29fe13f/
  base/                   c3b76221 사본
  head/                   29fe13ff 사본
  base.zip, head.zip      git archive
  src.diff                지정 src 차이
  build-base.log, build-head.log
  static-audit.mjs, static-evidence.json, static-summary.log
  import-order.mjs
  run-units.mjs, unit-*.log, unit-*-execution.json
  compare-runs.mjs, compare-final.log
  cases-2026-11-13T18-34-32-392Z/
```

원본 저장소 수정·커밋·push·worktree 추가 없음. 기존 로컬 node_modules를 각 사본에 복사했으며 설치·다운로드는 하지 않았다. 임시·유닛·캐시 경로도 이 검증 폴더 아래다. 합성 비밀값과 합성 vars-file만 사용했다. 실제 키·키 파일·실제 API·외부 네트워크·권한 상승 요청은 없다. 독립 실행과 유닛 실행기에 네트워크 차단 preload를 적용했고, 독립 CLI 자식에도 같은 preload를 주었다. 이번 시험은 127.0.0.1 서버조차 필요하지 않았다.

원본에서 실행한 주요 읽기 전용 명령:

```powershell
git -c safe.directory=D:/project/Codaryn status --short
git -c safe.directory=D:/project/Codaryn branch --show-current
git -c safe.directory=D:/project/Codaryn rev-parse --show-toplevel
git -c safe.directory=D:/project/Codaryn rev-parse pm/unit-C4
git -c safe.directory=D:/project/Codaryn rev-parse c3b76221
git -c safe.directory=D:/project/Codaryn merge-base --is-ancestor c3b76221 29fe13ff460f799a2cbbf07312473e91834bd2e4
git -c safe.directory=D:/project/Codaryn archive --format=zip --output=<검증 폴더>/base.zip c3b76221
git -c safe.directory=D:/project/Codaryn archive --format=zip --output=<검증 폴더>/head.zip 29fe13ff460f799a2cbbf07312473e91834bd2e4
git -c safe.directory=D:/project/Codaryn diff c3b76221 29fe13ff460f799a2cbbf07312473e91834bd2e4 -- src
```

`src` 차이는 **5파일 +229/-211**이다. 전역 ignore 파일 읽기 권한 경고는 있었으나 전역 Git 설정이나 권한은 바꾸지 않았다.

## 2. 이동 블록의 동일성

`static-audit.mjs`로 사본의 원문을 잘라 대조했다. 블록 사이의 빈 줄과 끝 개행은 범위에서 제외했고, 블록 내부의 공백·줄바꿈·주석·코드는 그대로 비교했다. `lockedMessage`에서만 새 `export ` 접두사를 뺀 뒤 비교했다.

| 블록 | 기준 src/cli/assemble.ts 시작 | 후보 src/app/assembly.ts 시작 | 줄 수 | 바이트 수 | 판정 |
| --- | ---: | ---: | ---: | ---: | --- |
| AssemblyInput부터 Assemble 형 별칭까지 | 51 | 31 | 54 | 2751 | 동일 |
| lockedMessage | 106 | 86 | 4 | 211 | export만 추가 |
| AssembleHooks 주석·형, factory, assembleRun, assembleWith | 406 | 91 | 123 | 6432 | 동일 |

각 원문 블록과 후보의 비교용 블록 SHA-256은 각각 같다.

```text
54줄: c2b731f867b1527da0b010cf1b593ac98d8a4eb89297ca726166d8139fa6d058
 4줄: 63181e27e6e1ede18d6bfdff57d2445e8fedd1daf0471d26410c8f5c331582c1
123줄: 01ffef6313fa74b27aedadf102f243384782f99556774a3c26f85ddac5f7d841
```

`RevertCommandInput`부터 `createRevertCommand` 끝까지 남은 본문도 동일했다. 새 모듈의 import 대상은 디렉터리 이동을 반영해 실제 같은 파일로 해석된다. 특히 `runGuards`의 이전 `../app/input/unreadable.js`와 새 `./input/unreadable.js`는 **같은 app/input/unreadable.js**다. 그 모듈 자체의 차이는 조립 위치를 설명하는 주석 한 줄뿐이다.

파일 전체가 그대로 이동한 것은 아니다. 새 파일 머리말·import 구성, 이전 파일의 재내보내기, `main.ts`의 값 import와 `run.ts`의 type import가 바뀐다. “export만 변경”은 위 세 **이동 블록 내부**에 관한 주장으로 확인했다.

## 3. 빠진 import 21개

후보의 `src/cli/assemble.ts`에서 주석을 제외하고 식별자를 검사했다. 아래 21개는 **남은 본문에 참조 0개**이고 모두 새 조립 파일에서 같은 원본 모듈로부터 가져온다.

- 런타임 값 **11개**: createPrivacyGateway, createRunRecorders, stateUncheckedSince, writeResult, createCommandRunner, createPlannedFileProbe, createToolRunner, envValueFreeOfSecrets, createIntegrityChecker, createVerifierRunner, runGuards.
- 형 **10개**: LockInfo, EngineDeps, EngineResult, ModelProvider, PlannedFileProbe, PolicyGate, PrivacyGateway, ResolvedTaskSpec, Workspace, WritablePathSet.

“이전에도 사용되지 않았다”는 뜻은 아니다. 기준에서는 옮긴 코드가 사용했고, **이동 후 이전 파일에 남은 코드에서 불필요해진 import**다. 되돌리기가 계속 쓰는 acquireLock·releaseLock·hasRecordsChangedMark 등은 남는다. 공유하던 lockedMessage는 새 모듈에서 가져온다(`src/cli/assemble.ts:30`, 호출 `:292`).

## 4. 조립 순서·비밀값·관문

후보 `src/app/assembly.ts`의 아래 순서가 기준의 동일 블록과 같다.

| 순서 | 후보 file:line | 확인 내용 |
| --- | --- | --- |
| 작업 공간 열기 | src/app/assembly.ts:118 | 실패하면 workspace_not_found, 잠금·조립 전 반환 |
| 잠금 획득 | src/app/assembly.ts:124 | 실패하면 workspace_locked, 뒤의 gateway/recorders 미생성 |
| privacy 생성 | src/app/assembly.ts:128 | 전달받은 secrets 그대로 등록 |
| runGuards와 policy | src/app/assembly.ts:132 | 합쳐진 unreadablePaths, minGroupSize, writablePathSets 사용 |
| command runner | src/app/assembly.ts:136 | privacy에 근거한 envValueFreeOfSecrets, workspaceRoot, 선택 parentEnv/platform 유지 |
| recorders·state guard | src/app/assembly.ts:148 | 선택 planRunId 전달, 공유 recorder 한 벌 |
| tools·verifiers | src/app/assembly.ts:151 / :154 | tools에 읽기 제외·k, verifiers에 읽기 제외 전달 |
| integrity | src/app/assembly.ts:162 | protected+unreadable 및 외부 integrityPaths에 따른 선택적 구성 |
| 승인 계획 부품 | src/app/assembly.ts:185 | policyFor도 동일 guards에 승인 파일 writable 목록을 적용; claim/probe/state 조회 연결 유지 |
| 앱 callback | src/app/assembly.ts:192 | 위 구성과 잠금 뒤 onAssembled 호출 |
| finish | src/app/assembly.ts:200 / :203 | result 저장 후 finally에서 잠금 해제; 실패 시 lockLeft 반환 |
| 조립 중 예외 | src/app/assembly.ts:210 | 잠금 해제를 시도하되 원래 오류를 다시 던짐 |

비밀값 **수집**은 이번 이동 대상 함수 안에서 새로 이루어지지 않는다. `src/cli/run.ts:954`의 secretEnv/알려진 키/새 vars-file 값 수집과 `:1002`의 prepared.secrets 복사, `:1054`의 전달 경로는 바뀌지 않았다. 이 파일의 유일한 변경은 `:89` type import 경로다. 실제 키는 시험하지 않았으며 해당 수집 코드의 불변과 전달된 합성 값의 처리만 확인했다.

DR-4에서 CLI의 무 hook 조립은 실행 시 프로세스 환경을 사용하고, 앱의 wrapper는 매 실행의 복사 환경과 platform을 넘긴다. `createAssemble()`가 모듈 초기화 때 호출돼도 그때 관문·privacy·환경 복사·잠금을 만들지 않는다. 돌려주는 함수가 실제 input을 받을 때 `assembleWith`를 부른다(`src/app/assembly.ts:107`, `:111`, `:113`). 따라서 이동으로 프로세스 환경을 일찍 고정한 경로도 없다.

## 5. 호출 경로·중복·순환

확인한 값 호출 경로:

```text
CLI main.ts:29, :389
  → app/assembly.ts의 assembleRun
  → 동일 파일의 assembleWith

app/app.ts:310
  → app/assemble.ts:35의 createAppAssemble
  → cli/assemble.ts:36 재내보내기
  → app/assembly.ts:107의 createAssemble
  → 동일 파일의 assembleWith

CLI/app 되돌리기
  → cli/assemble.ts의 기존 createRevertCommand
  → app/assembly.ts:86의 lockedMessage
```

`src/app/assemble.ts`와 `src/app/app.ts`는 기준·후보 파일 전체가 동일하다. 이전 파일의 export는 wrapper 함수나 복사본이 아니라 **ESM 재내보내기**다(`src/cli/assemble.ts:36–37`). CLI용 기본 closure와 앱용 hook closure는 각각 필요한 환경으로 만들어지지만 실제 조립 구현은 한 벌이다. 소스에서 다른 createAssemble/assembleWith 구현은 발견되지 않았다.

빌드된 JS의 정적 import·re-export를 따라 상대 경로를 해석하고 strongly connected components를 검사했다. 형 import는 빌드에서 제거된 뒤다.

| 항목 | 기준 | 후보 |
| --- | ---: | ---: |
| dist/src JS 모듈 | 172 | 173 |
| 정적 상대 import/re-export 간선 | 596 | 601 |
| 조립 모듈에서 닿는 모듈 수(자신 포함) | 69 | 68 |
| 조립 모듈을 포함한 순환 | 없음 | 없음 |

양쪽에 있는 순환은 **store/lock.js ↔ store/review.js ↔ store/runs.js 묶음 하나**로 같았다. 이번 이동으로 만든 순환은 없다. 새 app/assembly의 의존을 따라 app/app·cli/run·cli/main으로 되돌아가는 길도 없다. 새 모듈의 런타임 직계 의존은 privacy, store, tools, verify, workspace의 index와 app/input/unreadable이다.

추가로 별도 Node 프로세스에서 다음 **5가지 최초 import 순서**를 실행했다. `registerHooks.load`로 후보 app/assembly.js 로드 수를 세었다.

```text
new → old → wrapper → facade → run
old → facade → run → wrapper → new
wrapper → old → run → new → facade
facade → run → wrapper → old → new
run → facade → old → new → wrapper

new     = app/assembly.js
old     = cli/assemble.js
wrapper = app/assemble.js
facade  = app/index.js
run     = cli/run.js
```

**5개 모두 load 1회**, old.createAssemble === new.createAssemble, old.assembleRun === new.assembleRun이었다. 공개 함수 바인딩은 모두 function이었다. lockedMessage의 두 분기를 호출하고, 직접 factory와 앱 wrapper 각각을 없는 작업 공간으로 호출해 같은 workspace_not_found 반환도 확인했다. 실제 유닛·CLI 실행은 정상 조립 이후의 함수 호출도 수행했다. 타입 검사만 통과하고 호출 시 undefined가 되는 경로는 재현하지 못했다.

재현: 검증 폴더에서 `node import-order.mjs new,old,wrapper,facade,run` 등 위 다섯 순서. 정적 그래프 전체와 import 21개 상세는 `static-evidence.json`에 있다.

## 6. 기준·후보 실제 CLI 비교

`compare-runs.mjs`는 각 판의 `dist/src/cli/main.js`를 **실제 자식 프로세스**로 실행한다. model은 scripted, 입력·작업 파일·vars는 전부 합성이다. 각 사례는 먼저 기대 동작을 단언한 다음 두 판의 종료 코드·stdout·stderr·JSON 결과·저널·최종 사용자 파일을 대조한다.

| 사례 | 양쪽에서 확인한 결과 | 각 판 CLI 호출 |
| --- | --- | ---: |
| guarded-run-and-revert | 제외 아래 read/write/search/inspect 4건 거부, writable 밖·protected 쓰기까지 합계 6건 거부. 공개 파일만 쓰고 revert로 원복. 잠금 해제 | 2 |
| raised-k-seven | k=7, 7행 묶음 하나만 반환. 작은 묶음·개별 행 표지 없음 | 1 |
| case-folded-secret-names | secretEnv에 대소문자만 다른 두 이름, 환경에는 소문자 이름 하나. 합성 값 2회 읽기가 같은 토큰 2회로 가려짐. 원문은 출력·저널에 없음 | 1 |
| vars-short | vars-file의 5자 LANG가 도구 자식과 command verifier에 도달. 둘 다 기대 결과, verified | 1 |
| vars-eight | 정확히 8자 LANG는 등록된 비밀로 처리돼 도구 자식·검증기 자식에 전달되지 않음. 파일에서 읽어도 원문 대신 토큰, verified | 1 |
| live-lock-refusal | 살아 있는 시험기 PID의 잠금에서 workspace_locked, 종료 6, runs 미생성, 잠금·작업 파일 불변 | 1 |
| missing-secret-refusal | 없는 합성 secretEnv에서 secret_env_missing, 종료 2, 저널·잠금 없음 | 1 |
| verifier-failure | command verifier exit 3 → verifier_failed, CLI 종료 1, 잠금 해제 | 1 |
| run-plan-apply | 계획 생성 plan_pending(종료 3), 승인 뒤 실행에서 unreadable_path·path_not_writable 거부, 승인 파일 쓰기 성공(종료 0), 같은 계획 재적용 plan_already_applied | 3 |
| **합계** | **9/9 일치, 차이 0** | **12씩, 총 24** |

첫 사례의 k=5 표에서는 4행 묶음이 숨겨지고, 5행 중 수치가 4칸인 묶음은 **[5,null,null]**이었다. 승인 계획 적용에서도 동일한 query_table 경로를 실행했다. 실행 계획 생성 저널은 판마다 10건, 적용은 23건이었다. DR-4 이름 사례는 판마다 11건, vars 두 사례는 각각 14건의 저널을 비교했다.

비교에서 바꾼 것은 실행 ID·시각·기간(사람용 Usage의 초 포함)·절대 시험 폴더와 중첩 JSON의 해당 경로·계획 digest·무작위 privacy token 식별자다. 토큰은 첫 등장 순서로 대응시켜 같은 값이 같은 토큰으로 유지되는 관계를 보존했다. 내용 해시·거부 이유·정책 결정·도구 결과·기록 순서·수치·최종 파일은 정규화하지 않았다. stdout/stderr 자체도 비교했으므로 JSON 결과만 본 것은 아니다.

최종 실행:

```powershell
node compare-runs.mjs
```

결과 **종료 0**, `compare-final.log`. 최종 자료는 **cases-2026-11-13T18-34-32-392Z**의 `results.json`, `calls.json`, 각 사례의 `comparison.json`, 두 판의 `.codaryn/runs`에 있다. calls.json에는 실제 argv·종료 코드·원래 stdout/stderr·저널이 남는다.

## 7. 빌드·관련 유닛

각 archive 사본에서 `npm.cmd run build`를 실행했고 모두 **종료 0**이었다. 전체 시험 묶음은 돌리지 않았다. 검증 폴더에서 다음 실행기를 사용했다.

```powershell
node run-units.mjs base
node run-units.mjs head
```

실행기는 시스템 필수 환경만 전달하고 TEMP·홈·설정 위치를 자기 폴더 아래로 둔다. 실제 명령은 각 사본에서 `node --import <검증 폴더>/offline-guard.mjs --test <아래 파일들>`이다.

공통 **11파일**:

```text
dist/tests/unit/cli/assemble.test.js
dist/tests/unit/cli/u280-dist-old-paths.test.js
dist/tests/unit/cli/u220-lock-left-cli.test.js
dist/tests/unit/app/r1-decisions.test.js
dist/tests/unit/app/u71-apply-parent-env.test.js
dist/tests/unit/app/u229-finish-lock-left.test.js
dist/tests/unit/app/u237-app-unreadable.test.js
dist/tests/unit/app/u186-writable-paths-app.test.js
dist/tests/unit/app/u218-run-plan-apply.test.js
dist/tests/unit/app/u193-lock-left.test.js
dist/tests/unit/app/u108-confirm-relay.test.js
```

후보에는 새 `dist/tests/unit/cli/u285-dr4-cli-path.test.js`도 실행했다. 후보의 u280에는 새 assemble 재내보내기 확인 1건이 추가돼 있다. 그래서 후보가 **4건 더 많다**. 기준에 없는 시험을 기준 통과라고 세지 않았다. DR-4의 기준 동작은 위 독립 실제 CLI 사례에서도 별도로 확인했다.

| 판 | 파일 | tests | suites | 통과 | 실패·취소·skip·todo | Node test 시간 | 실행기 시간 |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| 기준 | 11 | 71 | 20 | 71 | 모두 0 | 7796.3619 ms | 7984 ms |
| 후보 | 12 | 75 | 21 | 75 | 모두 0 | 7779.2172 ms | 7917 ms |

이 유닛들은 실제 조립, 마스킹, 앱의 대소문자 환경 조회·vars 자식 환경, 이벤트·권한 질문·취소, writable/unreadable, 승인 계획, 조립/실행 예외의 잠금 해제, lockLeft 전달, CLI 되돌리기와 구 경로의 export를 검사했다. 권한 질문은 일부 엔진 경계 주입이며 lockLeft는 Windows 파일 보유 또는 release 오류 주입이다. 전부 실제 GUI나 실 API 시험인 것처럼 해석하지 않는다. stderr는 두 판 모두 비어 있었다.

## 8. 초기 시험 수정·미수행·판정 한계

- 초기 독립 대본에 usage를 생략해 유한 토큰 예산이 usage_unknown으로 중단됐다. 대본 각 단계에 합성 usage 0을 넣어 실제 요청한 경로를 실행했다. 제품을 고친 것은 아니다.
- 초기 시험 환경에서 LANG=en을 미리 넣어 vars-file의 LANG가 새로 설정되지 않았다. CLI와 앱의 기존 규칙은 **이미 있는 환경값을 유지**한다. 최종 입력에서는 이 값을 미리 주지 않았고 5자 전달·8자 가림/제외를 확인했다. 앞 시험의 기대 실패를 제품 회귀나 비밀값 누출로 세지 않았다.
- 비교기의 시간·privacy token·중첩 JSON 경로 정규화를 보완했다. `compare-pilot.log`, `compare-second.log`와 초기 사례 폴더도 남겨 두었다. 최종 9사례를 다시 모두 실행해 0차이를 확인했다.
- 정적 검사기는 처음에 설치된 TypeScript의 JS parser 경로를 가정했지만 이 로컬 TypeScript 7 배포에는 없었다. 설치·다운로드하지 않고 텍스트 import 추출과 빌드된 정적 ESM 그래프 검사로 바꿨다. archive의 CRLF를 보존하도록 블록 경계 탐색도 맞췄다. 소스 동일성의 SHA는 개행 정규화 후의 값이 아니다.
- 실제 API·키·외부 네트워크·Electron·전체 유닛/통합 묶음·다른 OS 실행·전체 compare-cli-boards 스위트는 **미수행**이다. Linux case-sensitive 환경 분기는 기존 앱 유닛에서 platform 주입으로만 검사했다.
- 알려진 키 종류 전체나 실제 비밀값 수집을 새로 동적 검증하지는 않았다. 이번 이동에 해당 코드 변경이 없음을 확인하고, 합성 secretEnv와 새 vars-file 값이 동일 조립에 도달해 처리되는 범위를 실행했다.

**이 범위에서는 병합을 막을 결함을 발견하지 못했다.** src/app/assembly.ts의 이동된 구현, CLI 재내보내기, 기존 앱 wrapper가 같은 실행 조립을 사용한다는 주장을 뒷받침한다. 변경 파일은 이 검증용 자료와 지정 보고서뿐이며, 제품 수정·커밋·통합은 수행하지 않았다.
