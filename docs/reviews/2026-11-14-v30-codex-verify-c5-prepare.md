# V-30 — U-287 / C-5 준비 단계 이동 검증

- 검증자: **codex-probe**, 검증 엔지니어. Windows / Node v26.13.1.
- 기준: `6269909cb947a29d2e4405632fad87c70cc191ba` → 후보: `86fe4bd1bfb830ab4c8ce92364d2d267a3679878`.
- `git rev-parse pm/unit-C5`가 후보와 일치함을 시작·종료 시 확인했다. 두 판은 서로 다르다.
- **높음 0건 / 중간 0건 / 낮음 0건.** 검사 범위에서 동작 차이를 발견하지 못했다.
- 사용자 지정 `v30/compare/{base,head}`에 `git archive` 사본을 만들었다. 저장소 수정·커밋·푸시·worktree 추가 없음. 종료 시 관리용 저장소 `git status --short`는 비어 있었다.

| 검사 | 수치 | 결과 |
| --- | ---: | --- |
| 두 판 TypeScript 빌드 | 2회 | 모두 종료 0; 기준 2,143ms / 후보 3,351ms |
| 이동 선언 원문 대조 | 26개 | 지정된 export·readText 타입 변경 외 차이 0 |
| run.ts 잔존 선언 대조 | 16개 | 차이 0 |
| json-position 전체 파일 | 1쌍 | 바이트 동일 |
| PrepareEnvironment | 9필드 | 키·타입·선택 여부·readonly 일치, 타입 검사 종료 0 |
| 실제 CLI | 28사례 × 2판 = 56프로세스 | 201개 산출물 쌍 차이 0 |
| 시작 전 거부 | 24쌍 | stdout·stderr·종료 코드 **정규화 없이** 동일; 저널 0개 |
| 대본 정상 실행 | 2쌍 | 모두 `done`, 종료 0; 출력 파일·저널 일치 |
| 추가 실행: vars / 넓은 쓰기 목록 | 2쌍 | 같은 `needs-input`, 종료 3; 저널 일치 |
| 새 프로세스 모듈 로드 순서 | 판마다 6순서, 총 12회 | import/재수출 함수 신원/앱 생성 실패 0 |
| 관련 기존 시험 | 7파일, 84시험 | 통과 84 / 실패·건너뜀 0; 2,671ms |

## 코드 이동·타입·의존성

- 후보 `src/app/prepare.ts:82`, `:86`, `:407`: RunInput·RunArgs와 준비 단계의 선언을 기준 run.ts/args.ts에서 찾아 원문 대조했다. 함수 내부 주석도 대조에 포함했다. 준비 함수의 검사 순서·문자열·오류 코드 변경 없음. 새 본문의 모든 줄도 원래 두 파일의 줄 또는 아래 허용 변경에 해당했다.
- 후보 `src/app/prepare.ts:330`, `:338`, `:347`: readText·parseJson·scrub의 export 추가, readText의 `Pick<CliEnvironment, "readFile">` → `Pick<PrepareEnvironment, "readFile">` 외 함수 내용 차이 없음.
- 후보 `src/app/prepare.ts:361`, `src/cli/run.ts:73`: 기존 Pick과 새 interface의 9필드는 `env, cwd, readFile, isDirectory, loadEnvFile, locateInWorkspace, relatePaths, installDir, defaultConfig`. 펼친 타입의 동등성, 양방향 할당, 필수 readFile 누락 거부, 추가 필드 리터럴 거부, readonly 유지까지 컴파일 확인했다. 선택 필드는 기존과 같은 installDir·relatePaths·defaultConfig 3개다.
- 후보 `src/cli/run.ts:64`, `:70`, `src/cli/args.ts:29`, `src/cli/json-position.ts:2`: 이전 경로의 재수출 유지. json-position 본문은 `src/app/input/json-position.ts:1`로 그대로 옮겼다. 나머지 CLI 변경은 import 대상 정리다. **줄 수 표현만 보충:** `git diff --numstat`은 run.ts **13줄 추가 / 725줄 삭제**이며, 추가된 비어 있지 않은 줄은 **12줄**이다. 순증 12줄이라는 뜻은 아니다.
- 후보 `src/app/app.ts:64`는 CLI의 prepareTask 재수출을 계속 사용한다. 후보 `src/cli/run.ts:64` → app/prepare의 정적 의존 경로는 CLI로 돌아오지 않는다. 실제 빌드 JS의 정적 import/export 그래프는 기준 158모듈·589간선, 후보 159모듈·594간선. 순환은 양쪽 모두 기존 `store/lock.js ↔ store/review.js ↔ store/runs.js` 묶음 하나뿐이며 새 순환은 없다. prepare/run/app 순서 6개씩을 별도 프로세스로 로드해 재수출 8함수의 동일 신원과 앱 생성을 확인했다. args의 타입 import는 JS에서 사라진다.

## 실제 CLI 입력·관찰

모든 입력은 합성 자료이며 모델은 scripted다. 공통 `run --task task.json`에서 사례별 config·vars·profile 옵션을 추가했다. 정확한 입력 생성기와 argv는 [v30/cli-compare.mjs](v30/cli-compare.mjs), 사례별 수치는 [v30/cli-results.json](v30/cli-results.json), 원본 stdout·stderr·종료 코드·파일·저널은 `v30/artifacts/`에 있다.

| 입력 | 두 판에서 같은 결과 |
| --- | --- |
| 없는 task, 잘못된 task JSON | `invalid_task`, 종료 2 |
| task/config 안의 합성 키 모양 | `key_in_file`, 종료 2 |
| vars로 설정한 합성 키 값이 task에 재등장 | `key_in_file`, 종료 2 |
| 잘못된 config JSON/schema | `invalid_config`, 종료 2 |
| 설치 폴더 아래 workspace, task·quick 각 1개 | `workspace_is_install_dir`, 종료 2 |
| 없는 workspace | `workspace_not_found`, 종료 2 |
| task의 unreadablePaths+명령, config의 unreadablePaths+task 명령 | `invalid_task`, 종료 2; 명령 허용 목록 거부 메시지 동일 |
| 없는 secret env | `secret_env_missing`, 종료 2 |
| 없는 workflowRef | `invalid_task`, 종료 2 |
| 상위 maxModelTurns=5, profile=6 | `invalid_config`, 종료 2 |
| config writablePaths=[allowed], profile=[allowed,outside] | 허용 밖 쓰기 `path_not_writable`; 두 판 모두 outside/result.txt 미생성 |
| 일반 읽기·쓰기·file_rules 검증 | `done`, 종료 0; summary.md와 저널 동일 |
| config+vars+profile+한글 출력+secretEnv를 동반한 정상 실행 | `done`, 종료 0; summary.md와 저널 동일 |

복합 오류 10개로 우선순위도 비교했다: vars 읽기 실패/BOM → task, config 읽기 실패 → task 키, task 읽기 실패 → config 키, task 키 → config JSON, config 키 → task JSON, config 검증 → task 검증, unreadable+명령 → workspace 검사, workspace → secret env, quick 설치 폴더 거부 → 없는 config. 모두 같은 선행 오류와 원문 메시지였다. 근거 위치는 후보 `src/app/prepare.ts:407`, `:443`, `:452`, `:514`, `:520`, `:562`, `:679`, `:699`, `:752`다.

**vars 파일의 키 모양은 단독 거부 대상이 아니었다.** `V30_SYNTHETIC=<합성 키 모양>`만 vars에 두면 두 판 모두 준비 단계를 통과하고 대본 실행 후 검증기 부재로 `needs-input`/3이 됐다. 이는 기존 동작과 같다. 별도로 vars의 합성 키를 task에서 사용한 입력은 양쪽 모두 시작 전에 거부됐다. 두 경우를 혼동해 vars 단독 입력을 `key_in_file` 통과로 집계하지 않았다.

실행한 4쌍의 저널은 저장소의 `compare-cli/normalize.mjs`로 실행 ID·시각·소요시간·무작위 가림 토큰·실험/판 경로 등 실행마다 달라지는 값만 정규화해 비교했다. 내용·오류·판정·순서는 남겼다. 거부 24쌍의 표준 출력/오류와 종료 코드는 정규화 전에도 모두 같았다. 네트워크 가드 기록은 56프로세스 모두 비어 있었다.

## 실행 명령·범위

작업 디렉터리 `D:/project/Codaryn`. 아래 `R`은 `.worktrees/codex-verify/.codaryn/v30`을 뜻한다.

```text
git rev-parse pm/unit-C5 6269909c
git diff 6269909c 86fe4bd1bfb830ab4c8ce92364d2d267a3679878 -- src
node R/setup.mjs
node R/source-audit.mjs
node node_modules/typescript/bin/tsc -p R/tsconfig.audit.json
node R/cli-compare.mjs
node R/validate-results.mjs
node R/module-audit.mjs
node R/test-runner.mjs
git status --short
```

`setup.mjs`가 수행한 git archive·tar·두 판 tsc의 정확한 인자·종료 코드·시간은 [v30/setup-results.json](v30/setup-results.json)에 있다. 같은 폴더의 사본을 덮어쓰지 않도록 재실행은 거부한다. CLI 비교기는 기존 `scripts/compare-cli-boards.mjs`의 runCase와 정규화기를 사용하며, 기본 전체 사례 묶음을 실행한 것은 아니다. 시험 러너는 후보의 cli/cli, cli/config, cli/security/keys, cli/security/env, cli/g-u210-unreadable-cli, app/settings, app/settings-workflow-rules만 `node --test --test-concurrency=1`로 실행했다. 상세 명령은 `v30/test-command.json`, 원문 결과는 `v30/unit-tests.tap`이다.

실제 API·외부 네트워크·실제 키/키 파일 조회·권한 요청·전체 시험 묶음은 수행하지 않았다. API 제공자의 실호출 동등성은 이번 결과에 포함하지 않는다. 별도 제품 수정이나 미해결 결함 재현 입력은 없다.
