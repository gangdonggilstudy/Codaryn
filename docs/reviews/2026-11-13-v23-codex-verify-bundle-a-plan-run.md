# V-23 — 계획 실행과 읽기 제외

- 검증자: **codex-audit**, 검증 엔지니어 / 실행 경계 검토.
- 대상: `pm/unit-A6`, **`13bd8a7cdce9410dd60a64d12bf2290dab34b703`**. 시작 시 `git rev-parse pm/unit-A6`가 지정 해시와 일치했다.
- 기준: `bd7f0cc0`. R-108 H-1 관련 조립·계획 적용·읽기 제외 합집합 경로를 검토했다.
- **높음 0건 / 중간 0건 / 낮음 0건.** R-108의 계획 수행 중 읽기 우회는 이번 실제 CLI 입력에서 재현되지 않았다.
- 독립 검사 **23개 관찰·기대 결과 일치**, 실제 CLI **49회**, 관련 유닛 **30개 통과 / 실패 0 / 건너뜀 0**, 후보 빌드 종료 **0**.
- **별도 관찰:** `revert`에는 현재 읽기 제외 설정을 적용하지 않는다. 새로 제외한 경로도 복구한다. 이는 후보 문서에 명시된 기존 복구 경로와 일치하며, ‘revert에서도 읽기 제외를 차단했다’고 판정하지 않았다.
- Windows / Node `v26.13.1`. 새 `git archive` 사본은 이 폴더의 `head/`. 기존 로컬 개발 의존성을 복사했고 설치·다운로드하지 않았다. 저장소 파일 수정·커밋·푸시·worktree 추가·권한 요청 없음. 시작·종료의 main `git status --short` 출력은 비어 있었다.

## 재현 구성과 검사 기준

`probe.mjs`가 합성 작업 공간과 task/config/script를 새 시각 폴더에 생성한다. 공개 CLI `node head/dist/src/cli/main.js`를 별도 프로세스로 실행했고 제품 모듈·엔진·정책을 대체하지 않았다. 모든 모델은 `scripted`다.

- task 파일의 policy에는 **unreadablePaths가 없다**. 설정 파일의 policy에만 `['private']`를 둔 경우와, 선택한 프로필 `p`의 policy에만 둔 경우를 각각 실행했다. 프로필 사례는 `--task ... --config ... --profile p`를 사용했다.
- 작업 종류는 사용자 정의 `plan: "run"` 또는 이동용 `plan: "apply"`다. 사용자 파일은 공개 `docs/guide.md`, `public.txt`, 비공개 `private/seed.txt`와 이름 표지가 든 비공개 파일이다.
- 내용 표지와 파일명 표지는 실행 시 생성한 서로 다른 합성 문자열이다. 내용 표지는 비공개 파일에만 넣고, 파일명 표지가 든 경로는 목표·대본·제안에 넣지 않았다. 검색어는 표지가 아닌 공통 단어 `needle`이다.
- 대본은 비공개 파일 읽기, 기존 파일 덮어쓰기, 새 파일 생성, 비공개 경로를 시작점으로 한 검색·나열, 루트에서 검색·해시 포함 나열을 요청한다. 공개 파일이 결과에 남는 양성 대조도 확인했다.
- 표지 검사는 CLI stdout/stderr 및 `.codaryn` 아래 모든 생성 파일의 내용을 대상으로 한다. 저널의 `model_request`에 재전달되는 도구 결과도 포함한다. 비공개 사용자 파일이 검사 전후 동일한지도 비교했다.

## R-108 H-1 재확인과 단계별 결과

| 단계·조건 | 실제 관찰 |
| --- | --- |
| 계획 생성: 비공개 read_file | 설정·프로필 모두 `unreadable_path`로 거부 |
| 계획 생성: 비공개 write_file 2회 | 쓰기 도구가 계획 생성 실행에 제공되지 않아 `unknown_tool`로 거부. 파일 변화 없음. 이 경로를 unreadable_path 판정 성공으로 세지 않음 |
| 계획 생성: 비공개 경로 검색·나열 | search_files, inspect_files 모두 `unreadable_path` |
| 계획 생성: 루트 검색·나열 | 공개 파일은 보임. 비공개 디렉터리와 그 아래 항목은 이름째 제외, `withheld: true` |
| 승인 계획 수행: 비공개 읽기·쓰기·검색·나열 | 설정·프로필 모두 read 1회, write 2회, search 1회, inspect 1회가 각각 `unreadable_path`로 거부. 공개 계획 파일의 쓰기는 성공 |
| 승인 계획 수행: 루트 검색·나열 | 비공개 이름·내용·해시 항목 없음, 공개 항목 있음, `withheld: true` |
| 비공개 파일 modify/create 제안 | 두 소스 × 두 종류 총 4개. propose_changes가 `policy_denied`, 세부 `file 0: path/unreadable_path`. 뒤의 공개 파일 제안만 저장된 plan.json에 남음 |
| 비공개 원본 이동 제안 | 두 소스 모두 propose_plan이 `policy_denied`, 세부 `action 0: path/unreadable_path` |
| 이동 계획을 만든 뒤 원본 경로 제외 | 두 소스 모두 apply가 `failed/plan_stale`, 파일 변화 없음 |
| 이동 계획을 만든 뒤 목적지 경로 제외 | 두 소스 모두 apply가 `failed/plan_stale`, 파일 변화 없음 |
| 비공개 파일과 무관한 공개 이동 | 두 소스 모두 apply `done`, revert `complete`. 사용자 파일 전체가 원래 내용으로 복구 |
| 정상 공개 계획 수행 뒤 revert | 두 소스 모두 공개 파일만 복구. 비공개 파일 변화 없음 |

보호가 유지된 위 검사들의 stdout/stderr·상태 기록에서 내용 표지와 숨긴 파일명 표지는 **0건**이었다. 보호 중인 `read_file` 결과가 후속 모델 요청으로 넘어가는 R-108 현상도 없었다.

이동 apply에는 모델이나 read_file/search_files/inspect_files 호출이 없다. 이 단계에서는 원본·목적지의 동작 차단과 결과·인벤토리 관련 기록의 표지 비노출을 검사했다. 내부 무결성·인벤토리 검사가 파일 시스템을 전혀 읽지 않는다는 뜻은 아니다.

수정 근거:

- `head/src/cli/unreadable.ts:24`: 설정·선택 프로필·정의·task의 읽기 제외를 합친다.
- `head/src/cli/assemble.ts:445`: `runGuards`로 실행의 관문·도구·검증기·무결성 대상을 구성한다.
- `head/src/cli/assemble.ts:499`: 승인 계획의 `policyFor`도 `guards.gate(writablePathSets)`를 사용한다. 계획의 정확한 쓰기 목록을 더하면서 읽기 제외가 빠지지 않는다.
- `head/src/cli/plan-commands.ts:777`: 이동 계획 적용도 같은 guards로 판정한다.

## 적용 시점의 설정 변경

설정 파일과 프로필 각각에 대해 다음을 실제 CLI로 확인했다.

| 변경 | 결과 |
| --- | --- |
| 계획을 만든 뒤 비공개 읽기 제외를 추가, 계획 대상은 공개 파일 | 계획 실행은 `done`. 새로 제외한 파일의 읽기·쓰기·검색·나열은 차단되고 표지 비노출 |
| 계획을 만든 뒤 **계획 대상 docs 자체**를 제외 | apply가 `failed/plan_stale`, `modelTurns: 0`, `toolCalls: 0`, 파일 변화 0. 모델 요청 전에 중단 |
| 계획을 만들 때의 private 제외를 적용 전에 제거 | private 읽기·루트 검색·나열이 허용됨. 내용 표지가 read_file 결과와 뒤의 model_request에 나타남. 현재 설정을 완화한 결과이며 보호 중 누출로 세지 않음 |
| 설정과 프로필 둘 다 private 제외 → 설정의 제외만 제거 | 프로필의 제외가 계속 적용돼 읽기·쓰기·나열 차단, 표지 비노출 |

다이제스트가 승인하는 계획을 유지한 채 apply 직전에 설정 파일을 바꿔 실행했다. 따라서 **계획 생성 때의 제외 목록을 고정하는 것이 아니라 적용 시점의 모든 소스의 합집합으로 판단**함을 확인했다. GUI 승인 화면에서 설정을 바꾸는 흐름은 시험하지 않았다.

## revert는 현재 제외 정책을 적용하지 않음 — 별도 관찰

이 항목은 요청의 ‘각각에서 거부되는지’를 문자 그대로 전부 충족한 결과가 아니다. 후보 계약 `head/docs/cli-contract.md:645`는 `runGuards`의 네 구성 요소를 **revert는 만들지 않는다**고 명시한다. CLI revert는 작업 공간·실행 ID로 기록을 되돌리는 명령이고 task/config/profile 옵션을 받지 않는다(`head/src/cli/revert.ts:1`, `head/src/cli/args.ts:228`).

두 재현 모두 차단 대신 복구했다.

1. 제외가 없는 상태에서 docs 파일의 변경 계획을 적용한다. 그 후 config에 `private`, `docs`를 제외로 넣는다. `revert --dry-run`은 docs 복구를 나열하고, 실제 revert는 `complete`로 원문을 복구한다. `--config`를 주면 `invalid_arguments`다.
2. 제외가 없는 상태에서 `private/seed.txt → stash/seed.txt` 이동을 계획·적용한다. 그 후 원본·목적지 양쪽을 읽기 제외로 설정한다. dry-run은 복구 동작을 나열하고 실제 revert는 `complete`, 파일 전체가 처음 상태와 같다. 비공개 내용 표지와 모델에게 알려주지 않은 파일명 표지는 새 출력·기록에서 발견되지 않았다.

revert에는 모델 요청이 없다. 또한 기록에 이미 알려진 작업 대상 경로는 복구 목록에 표시된다. **현재 읽기 제외가 revert의 파일 복구나 기존 경로 표시까지 막는 보장은 없다.** 이번 후보가 새로 만든 회귀로는 집계하지 않았으며, 이 범위까지 차단하려는 요구라면 별도 계약 판단이 필요하다.

## 명령과 산출물

`R`은 이 보고서가 있는 절대 경로다. 생성·빌드·시험·로그 쓰기는 모두 R 아래에서 수행했다.

```text
git -c safe.directory=D:/project/Codaryn -C D:/project/Codaryn status --short
git -c safe.directory=D:/project/Codaryn -C D:/project/Codaryn branch --show-current
git -c safe.directory=D:/project/Codaryn -C D:/project/Codaryn rev-parse --show-toplevel
git -c safe.directory=D:/project/Codaryn -C D:/project/Codaryn rev-parse pm/unit-A6
git -c safe.directory=D:/project/Codaryn -C D:/project/Codaryn archive --format=zip --output=<R>/head.zip 13bd8a7cdce9410dd60a64d12bf2290dab34b703
git -c safe.directory=D:/project/Codaryn -C D:/project/Codaryn diff bd7f0cc0 13bd8a7 -- src/cli/assemble.ts src/cli/plan-commands.ts src/cli/unreadable.ts
npm.cmd run build                        [cwd: <R>/head]
node probe.mjs                           [cwd: <R>]
node probe.mjs "move revert now"
node probe.mjs "removing config"
node run-units.mjs
```

- 빌드: 종료 0, `build.log`.
- 첫 독립 묶음: **21개 / 실패 0 / 실제 CLI 43회**. `probe.log`, `cases-2026-11-13T14-28-48-240Z/results.json`, `calls.json`.
- 추가 이동 revert: **1개 / 실패 0 / CLI 4회**. `move-revert-probe.log`, `cases-2026-11-13T14-29-49-046Z/`.
- 추가 설정·프로필 합집합: **1개 / 실패 0 / CLI 2회**. `union-probe.log`, `cases-2026-11-13T14-29-48-899Z/`.
- 합계 **23개 / CLI 49회**. 이 중 2개는 revert가 제외 정책을 적용하지 않는다는 관찰 검사다. 23개 모두를 ‘읽기 제외에 의한 차단 성공’으로 세지 않는다.
- 각각의 calls.json에 실제 명령 인자, 종료 코드, 시간, stdout/stderr를 보존했다. 각 사례의 task/config/script 및 `.codaryn/runs` 기록도 남겼다. 다시 실행하면 새 시각 폴더를 만든다.
- 실제 호출 형태는 `node --import <R>/offline-guard.mjs <R>/head/dist/src/cli/main.js <명령> ...`다. 대본은 순수 합성 입력이며 네트워크 연결을 차단했다.

관련 유닛의 실행 명령(cwd `<R>/head`):

```text
node --import <R>/offline-guard.mjs --test dist/tests/unit/cli/g-u210-r108-carried-plan.test.js dist/tests/unit/cli/g-u210-unreadable-cli.test.js dist/tests/unit/policy/u203-unreadable-gate.test.js dist/tests/unit/tools/u203-unreadable-listing.test.js
```

- **4개 파일 / 시험 30 / 통과 30 / 실패 0 / 취소 0 / 건너뜀 0**, 약 **1.95초**, 종료 0.
- 원문: `unit.log`, `unit-stderr.log`, `unit-execution.json`. 시험의 임시 경로도 R의 `unit-tmp`로 고정했다.

## 미실행과 판정 범위

- 실제 API·외부 네트워크·키 파일 조회·권한 상승 요청 없음. 시험 프로세스는 허용한 환경 변수만 받으며 실제 키를 전달하지 않았다.
- GUI/Electron, 앱 계층, 실제 모델, 전체 시험 묶음은 실행하지 않았다.
- query_table의 집계 개인정보 기준은 이번 계획 실행 관문 검사의 범위가 아니다.
- 동시 설정 변경·정션 바꿔치기·파일 시스템의 모든 경쟁 시점은 독립 CLI 시험으로 재현하지 않았다.
- R-108 원인 판을 역으로 빌드하여 실패를 재현하지는 않았다. 지정 후보의 실제 CLI 결과와 수정 경로로 재확인했다.
- 후보의 계획 생성·승인 계획 수행·이동 적용에서 설정/프로필 읽기 제외가 유지되는 것은 확인했다. revert의 기존 복구 의미는 위 별도 관찰대로이며, 채택과 범위 판단은 PM 몫이다.
