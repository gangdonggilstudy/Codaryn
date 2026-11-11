# F6 교차 검토 보고: 도구 계층 (읽기 전용)

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 이 모듈의 구현자가 아닙니다. 제 구현은 F3 저장소이고, 이 보고서에서는 기록기 호출 쪽만 다룹니다.
- 대상: 관리용 main `8e1a166`의 `src/tools/**`(`windows-launch.ts`, `command-runner.ts`, `index.ts`). 원인이 조립에 있는 경우 `src/cli/assemble.ts`도 인용합니다.
- 방법:
  - `git archive main`으로 트리를 `.codaryn/f6/repo`에 풀고, worktree의 typescript로 그 안에 빌드했습니다.
  - 실험 스크립트는 `.codaryn/f6/exp/`, 임시 작업 공간은 `.codaryn/f6/tmp/`, 작업 공간 밖 스크립트는 `.codaryn/f6/bin/`에 두었습니다. TEMP와 TMP도 `.codaryn/f6/tmp`로 바꿨습니다.
  - 저장소 파일 수정과 커밋은 없습니다. 실제 API, 외부 네트워크, 키 파일은 쓰지 않았고 값은 모두 가짜입니다. CLI 프로세스 실험은 통합 테스트의 net-guard를 걸고 실행했습니다.
- 기준 문서: `docs/work-orders/phase-2-repair-loop.md`(R-1~R-8, G1, S-1~S-12), `docs/cli-contract.md`, `src/contracts`.

## 기준선 (main 8e1a166 빌드, .codaryn 안에서 실행)

| 범위 | 결과 |
| --- | --- |
| 유닛 | 388개 중 통과 384, 실패 0, 건너뜀 4(이 볼륨에 8.3 이름이 없음 등 환경 사유) |
| 통합 | 130개 중 통과 130, 실패 0 |

## 발견 사항

### F6-1 [높음] 실제 CLI 조립이 옵션 없는 명령 실행기를 넘겨 `.cmd`/`.bat` 실행(G1)과 자식 환경의 비밀 값 필터가 꺼져 있다

- 위치:
  - `src/cli/assemble.ts:128-130`: `createCommandRunner()`를 옵션 없이 만들어 도구와 검증기에 함께 넘깁니다.
  - 비교: `src/tools/index.ts:60-63`, `:137-139`. 기본값이라면 `allowEnvValue: envValueFreeOfSecrets(privacy)`와 `workspaceRoot: workspace.root`가 들어갑니다.
  - `src/tools/windows-launch.ts:163-165`: `workspaceRoot`가 없으면 모든 `.cmd`/`.bat`을 거부합니다.
- 깨지는 입력:
  - 작업 공간 밖의 `.cmd`(`.codaryn/f6/bin/echoargs.cmd`)를 PATH에 두었습니다.
  - task 정책은 `{"executable":"echoargs","argsPrefix":[],"allowExtraArgs":true}`이고, scripted 모델이 `run_command echoargs ["a=b"]`를 요청합니다.
- 결과(재현함, 실제 CLI 프로세스): journal의 `tool_result`가 `spawn_failed`, "could not start process (script_refused): the workspace root is not known, so .cmd and .bat files are not run"이었습니다. 같은 스크립트를 `workspaceRoot`를 준 실행기로 돌리면 정상 실행됩니다(C1 `equals`).
- 영향:
  - Windows 실제 CLI에서 `npm`, `npx`처럼 `.cmd`인 도구와 검증기(예: `npm test`)는 항상 `spawn_failed`입니다. 투입 조건 (3) "G1 병합"이 병합만 되고 효과가 없습니다.
  - 자식 환경 값 검사(`envValueFreeOfSecrets`)가 빠져, 허용 목록 변수(PATH, TEMP, HOME 등)에 등록된 비밀이 있어도 자식에게 넘어갑니다. 예를 들어 S-4로 비밀이 된 env 파일 값이 해당합니다. 이 부분은 코드 판독이고 실행하지 않았습니다.
  - 문서도 어긋납니다. `docs/cli-contract.md:161`은 아직 "Windows에서 `.cmd`와 `.bat`은 셸 없이 실행할 수 없다(`spawn_failed`)"라고 적고 있습니다.
- 재현: `node .codaryn/f6/exp/e2e.mjs`의 E1-journal 줄.
- 권고:
  - 조립에서 `createCommandRunner({ allowEnvValue: envValueFreeOfSecrets(privacy), workspaceRoot })`로 만들거나, `commandRunner`를 넘기지 말고 도구 기본값을 씁니다. 검증기에도 같은 실행기를 넘깁니다.
  - 실제 조립(`assembleRun`)으로 `.cmd`가 실행되는지 보는 회귀 테스트를 둡니다.

### F6-2 [중간, 문서화된 미연결] 실제 CLI에서 `write_file`이 원문 없이 쓴다

- 위치: `src/cli/assemble.ts:129`(`createToolRunner`에 `changeRecorder` 없음), `src/tools/index.ts:312-319`(없으면 보관 없이 씀). 계약 `src/contracts/changes.ts:23-26`은 "The CLI always passes one."이라고 합니다.
- 결과(재현함, 실제 CLI 프로세스, E1):
  - 기존 파일 수정과 새 파일 생성이 성공하고 journal에 `file_changed` 2건이 남았습니다.
  - 실행 폴더에는 `journal.jsonl`, `result.json`만 있고 `snapshots/`가 없습니다.
  - `codaryn revert`는 `internal_error` "revert is not connected in this build"였습니다.
- 성격: `docs/cli-contract.md:3`, `:327`에 "F3 병합 뒤 PM 알림에 따라 연결, 그 전까지 스냅샷 없음"으로 문서화된 상태입니다. F3은 `5989d79`에서 병합됐지만 아직 연결되지 않았습니다. 이 상태에서 실행한 변경은 나중에 연결해도 되돌릴 수 없습니다(원문이 없음).
- 권고: 투입 전에 `createChangeRecorder({ workspaceRoot, runId })`를 조립에 연결하고 `revert`를 연결합니다. 통합 테스트로 스냅샷 존재와 되돌리기를 확인합니다.

### F6-3 [중간] 파이프를 쥔 손자 프로세스가 있으면 정상 종료가 시간 초과로 보고되고, 손자는 실행과 CLI가 끝난 뒤에도 남는다

- 위치: `src/tools/command-runner.ts:173-188`(Windows는 `taskkill /PID <자식> /T /F`), `:256-266`, `:269-272`, `:286-288`. 정산은 `close`를 기다리고, 시간 초과 때만 트리를 끊습니다.
- 깨지는 입력:
  - 작업 공간 밖 스크립트 `bgstart.cmd`가 `start "" /b node -e "setTimeout(()=>{},20000)"`를 실행하고 곧바로 `exit /b 0`합니다. timeoutMs는 2000입니다.
  - 예: 테스트 스크립트가 서버를 배경으로 띄우는 경우. 모델은 작업 공간의 `package.json` scripts로도 이런 명령을 만들 수 있습니다.
- 결과(재현함, K2):
  - 실행기는 7041 ms 뒤 `exitCode: null`, `timedOut: true`를 돌려줍니다. 시간 제한 2초에 종료 대기 5초가 더해진 값이고, 스크립트는 즉시 0으로 끝났는데도 이렇습니다. 검증기라면 시간 초과로 판정합니다.
  - `taskkill`은 이미 끝난 cmd.exe의 PID를 대상으로 하므로 손자에 닿지 않습니다. 손자는 정산 뒤에도, CLI 역할의 호스트 프로세스가 끝난 뒤에도 살아 있었습니다(확인 후 직접 종료).
  - Node `detached` 손자도 정상 종료 뒤와 호스트 종료 뒤 모두 살아 있었습니다.
  - 대조군: 부모가 살아 있는 상태의 시간 초과(K1 timeout-live-tree)에서는 트리 종료가 손자까지 끝냈습니다.
- 추측(미재현): 자식이 이미 끝난 뒤 `taskkill /PID <pid> /T /F`를 실행하므로, 그 PID가 재사용되었다면 무관한 프로세스 트리를 강제 종료할 수 있습니다.
- 성격: 코드 주석(`command-runner.ts:18-20`)에 "트리를 벗어난 자손은 닿지 않는다"는 한계가 있습니다. 시간 초과 오보고와 CLI 종료 뒤 잔존은 cli-contract에 없습니다.
- 권고:
  - Windows에서는 명령마다 Job Object(종료 시 함께 끝내기)에 넣고, 정상 종료 때도 job을 끝냅니다.
  - 또는 `exit` 시점에 종료 코드를 확정하고, 파이프는 짧은 유예 뒤 닫아 정산합니다.
  - 잔존 가능성을 문서에 적습니다.

### F6-4 [낮음, 문서화됨] 원문 보관과 쓰기 사이에 파일이 바뀌면 이후 성공한 쓰기는 쓸 수 있는 원문 없이 진행된다

- 위치: `src/tools/index.ts:312-328`. `saveOriginal` 뒤 `writeText`가 충돌하면 그 원문이 첫 원문으로 남습니다(경로별 첫 원문만).
- 깨지는 입력: 첫 `saveOriginal` 직후 다른 프로세스가 파일을 저장합니다(기록기 대역으로 재현). 첫 쓰기는 `conflict`, 다시 읽은 뒤 두 번째 쓰기는 성공합니다.
- 결과(재현함, W1):
  - 보관된 원문은 "before the run"이고, 두 번째 쓰기가 대체한 상태는 "the user's save"입니다.
  - `revertRun`은 F3의 `previousHash` 대조 덕분에 사용자 저장을 덮지 않고 `missing_snapshot`으로 건너뜁니다. 그 파일의 실행 변경은 되돌릴 수 없습니다.
  - `docs/cli-contract.md:188`에 같은 취지의 한계가 있습니다.
- 권고(계약 변경): 기록기가 경로별로 해시가 다른 원문을 여러 개 보관하고, 되돌리기가 첫 `previousHash`와 맞는 것을 고르게 합니다. 또는 쓰기 성공 후 확정하는 2단계 API를 둡니다.

### F6-5 [낮음] slack(4096바이트)보다 긴 비밀 변형은 자르는 경계에서 앞부분이 원문으로 남는다

- 위치: `src/tools/index.ts:147-165`, `src/tools/command-runner.ts:83-85`. 주석은 "a cut secret of at most COMMAND_CAPTURE_SLACK_BYTES never survives"라고 합니다.
- 깨지는 입력: 2500바이트 가짜 비밀의 hex 변형(5000자)이 64 KiB 상한 50자 앞에서 시작해 캡처 한도에서 잘린 출력(`truncated: true`).
- 결과(재현함, M1):
  - 출력에 hex 앞부분이 남았습니다(`leaksHexPrefix=true`).
  - 비밀 자체는 2500바이트로 주석의 4096 이하인데, 목록 변형(hex 2배, base64 4/3배, URL 인코딩 최대 3배)이 slack을 넘는 경우를 보장하지 못합니다.
  - 4096바이트를 넘는 비밀 자체도 같은 방식으로 앞부분이 남습니다(주석의 범위 밖, 문서화 수준은 주석뿐).
  - 같은 실험에서 slack 이하 비밀이 상한이나 캡처 한도에 걸친 경우는 새지 않았습니다.
- 전제: 2049바이트 이상인 등록 비밀(인증서, 개인 키 등)과 그 변형을 64 KiB 넘게 출력하는 명령. 드뭅니다.
- 권고: 캡처 slack을 등록된 비밀의 가장 긴 목록 변형 길이 이상으로 정합니다. 또는 문서에 한계를 적습니다.

### F6-6 [낮음] 모델이 주는 `timeoutMs`에 상한이 없어 2^31-1을 넘으면 명령이 즉시 끊긴다

- 위치: `src/engine/validate-args.ts:70-74`, `src/contracts/tool.ts:334`(`minimum: 1`만 있음). 사용처는 `src/tools/index.ts:354`, `src/tools/command-runner.ts:269-272`.
- 결과(재현함, K1 timeout-overflow): `timeoutMs: 3000000000`이면 `TimeoutOverflowWarning`이 CLI stderr에 찍힙니다. 타이머가 1 ms로 바뀌어 500 ms짜리 명령이 `timedOut: true`로 끊겼습니다.
- S-7 "모든 시간 값은 2,147,483,647ms 이하"가 도구 인자에는 적용되지 않습니다. 모델 자신의 호출만 실패하므로 영향은 작습니다.
- 권고: 스키마와 인자 검사에 `maximum: 2147483647`을 둡니다(또는 실행기에서 자름).

### F6-7 [낮음] 작업 공간 안의 PATH 항목에 있는 `.exe`/`.com`은 그대로 실행된다 (`.cmd`/`.bat`은 거부)

- 위치: `src/tools/windows-launch.ts:155-157`(실행 파일은 위치 검사 없음), 비교 `:174-184`.
- 깨지는 입력: 사용자 PATH에 작업 공간 안의 절대 경로가 있는 경우입니다. 예: 활성화한 `.venv\Scripts`, 프로젝트 `bin`. 그 안에 허용된 이름의 `.exe`가 있습니다.
- 결과(재현함, P1, 가짜 파일 시스템으로 계획만 확인):
  - `npm` 요청이 `D:\work\proj\tools\npm.exe`로 풀려 셸 없이 실행 대상이 됩니다.
  - 같은 위치의 `npm.cmd`는 `script_refused`입니다.
- 추측: `write_file`은 UTF-8 텍스트만 써서 모델이 실행 가능한 PE를 직접 만들기는 어렵습니다. 허용된 명령(node, python 등)이 바이너리를 만들거나, 작업 공간 venv의 python이 모델이 쓴 `site-packages`를 읽는 경로는 원래부터 있습니다. 확대 정도는 작다고 봅니다.
- 권고: 실행 파일에도 같은 작업 공간 검사를 적용하거나, PATH 항목 중 작업 공간 안에 있는 것을 건너뜁니다. 정책 판단 이름과 실제 파일의 위치 관계를 문서에 적습니다.

### F6-8 [정보] 디렉터리가 있는 실행 이름은 모델이 고른 cwd 기준이다

- 위치: `src/tools/windows-launch.ts:123-126`.
- 결과(재현함, P1 dir-name-cwd-a/b): 정책이 승인한 같은 문자열 `bin\tool.exe`가 cwd에 따라 `D:\work\proj\bin\tool.exe`와 `D:\work\proj\sub\bin\tool.exe`로 갈립니다.
- 사용자가 상대 경로 이름을 허용했을 때만 해당합니다. 문서화를 권합니다.

### F6-9 [정보] 그 밖의 관찰

- `=`가 들어간 인자는 통과하고, 배치의 `%1`/`%2`에서 갈라집니다(C1: `ONE=[a] TWO=[b]`). `command-runner.ts:15`에 문서화돼 있습니다. `allowExtraArgs: false`이면 인자 목록이 정확히 같아야 하므로 정책 우회로 이어지지 않습니다.
- PATHEXT 순서상 같은 디렉터리에서 지원하지 않는 종류(예: `.JS`)가 먼저 잡히면, 뒤의 `.exe`로 넘어가지 않고 `unsupported_type`으로 거부합니다(P1 pathext-js-first). 거부일 뿐 다른 파일이 실행되지는 않습니다.
- 8191자를 넘는 명령줄은 cmd.exe가 실행 전체를 거부합니다(종료 1, 잘린 명령 실행 없음, C1 long 8200/20000). 이때 cmd의 메시지는 CP949라 UTF-8 디코딩에서 깨집니다. 문서화된 "UTF-8이 아닌 출력" 한계의 예입니다.

## 문제 없던 범위 (확인한 것)

- cmd.exe 인자 필터(C1, 실제 `.cmd` 실행): 다음은 모두 `script_refused`입니다.
  - `& ^ % ! " ( ) , ; | < > * ?`, 공백, 탭, 줄바꿈, 빈 인자
  - 전각 `＆`, `＂`, 한글
  - `@x`, `:eof`, `~#+@`, `abc\`는 그대로 전달되고 셸 동작이 없었습니다.
- 긴 인자는 cmd가 실행 전에 거부합니다. 잘린 명령은 실행되지 않습니다.
- PATH 탐색(P1): 상대 PATH 항목(`.`, `tools`)과 현재 디렉터리는 찾지 않습니다. 작업 공간 안의 `.cmd`는 PATH로 찾아도 거부합니다.
- 시간 초과 때 부모가 살아 있으면 트리 종료가 자손까지 끝냅니다(K1).
- `write_file`:
  - `expectedHash`가 다르면 원문 보관 전에 `conflict`입니다.
  - `saveOriginal`이 실패하면 쓰지 않습니다(코드 판독, main의 `tests/unit/tools/change-recorder.test.ts` 존재 확인).
- 출력 가림과 자르기(M1):
  - slack 이하의 비밀이 64 KiB 상한이나 캡처 한도에 걸쳐도 앞부분이 남지 않습니다.
  - 다중 바이트 경계에서 깨진 문자가 없고, 토큰 중간에서 자르지 않습니다(코드 판독).

## 검사하지 않은 범위

- POSIX 동작. 추측: 비Windows에서는 이름을 `spawn`에 그대로 넘기므로, PATH의 빈 항목이나 `.`이 작업 공간 파일을 고를 수 있습니다.
- 링크, 정션, 8.3 짧은 이름을 쓴 우회. 이 시스템은 디렉터리 링크를 만들 수 없고 8.3 이름이 생성되지 않아, 해당 유닛도 건너뛰어졌습니다.
- 레지스트리 설정의 영향. `DelayedExpansion`과 AutoRun을 바꾼 환경은 시험하지 않았습니다(`/d`와 `!` 거부로 막힌다고 코드상 판단).
- cmd.exe 안에서의 `NoDefaultCurrentDirectoryInExePath` 효과(코드 판독만), 다른 코드 페이지에서의 best-fit 변환.
- PID 재사용으로 무관한 트리가 종료되는 경우(F6-3 추측).
- 유효한 UTF-8만으로 된 실행 가능한 PE(F6-7 추측).
- 실제 Anthropic API와 외부 네트워크.

## PM 판단 필요

1. F6-1·F6-2: 조립 연결(실행기 옵션, `changeRecorder`, `revert`)을 투입 전 필수로 둘지. 담당은 `src/cli/**`의 p1입니다.
2. F6-3: Windows Job Object 도입 같은 잔존 프로세스 대책을 단계 2 범위에 넣을지, 한계로 문서화할지.
3. F6-4: 기록기 계약을 "해시별 다중 원문" 또는 "쓰기 후 확정"으로 바꿀지(계약 변경).
4. F6-5·F6-6·F6-7: 소규모 수정(slack 계산, `timeoutMs` 상한, 실행 파일 위치 검사)의 배정.
