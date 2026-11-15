# L1 투입 전 최종 교차 검토: 수정 묶음 T 결과(engine·tools·cli·policy)

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조)
- 대상: 관리용 main `7d5f0b3`. 수정 묶음 T 중 검토자가 만들지 않은 부분
  - `src/engine/**`: T-3, T-5, T-6 엔진 쪽, T-8
  - `src/tools/**`: T-1 실행기, T-2, T-4
  - `src/cli/**`: T-1 조립, T-12, T-14 연결, T-15
  - `src/policy/**`: T-13
- 기준: `docs/work-orders/phase-2-repair-loop.md`의 S, T 절
- 방법
  - `7d5f0b3`을 `.codaryn/l1/dist`에 빌드했습니다(`tsc --outDir`, 저장소 파일 변경 없음).
  - 실제 CLI 프로세스(`node dist/src/cli/main.js run --task ...`)를 scripted 제공자로 돌렸습니다.
  - 작업 공간과 task는 모두 `.codaryn/l1/cases/` 아래에 두었습니다.
  - 자식 CLI에는 최소 환경(PATH, SystemRoot, TEMP 등)만 넘기고 API 키 변수는 넘기지 않았습니다. 비밀은 가짜 값(`l1fake-...`, 키 모양 아님)만 썼습니다.
  - 실제 API·외부 네트워크 호출은 없었습니다.
- 결과: 높음 0건, 중간 2건, 낮음 1건. 아래 1·2번은 실제 CLI로 재현했습니다.

## 1. 중간: T-5 숫자 정규화 서명이 줄 번호와 값만 다른 서로 다른 실패를 같은 실패로 묶어, 진전이 있는데 `repeated_failure`로 일찍 멈춤

- 위치
  - `src/engine/feedback.ts:155-159`: `TOKEN_OR_NUMBER`, `normalizeNumbers`. 모든 숫자열을 `#`으로 바꿉니다.
  - `src/engine/feedback.ts:167-171`: `failureSignature`.
  - `src/engine/index.ts:569-574`: `decideRepair`. `sameFailures >= maxSameFailures`이면 멈춥니다.
- 깨지는 입력
  - 테스트 하나에 단언이 둘 있는 흔한 형태입니다(`test("cart totals")` 안에 6행과 7행 단언).
  - 첫 수정으로 6행 버그(수량)가 실제로 고쳐지자 7행 단언(할인)이 실패합니다.
  - node --test 근거에서 바뀌는 것은 숫자뿐입니다.
    - 1회차: `300 !== 600`, `calc.test.js:6:10`, `actual: 300`, `expected: 600`
    - 2회차: `999.9 !== 900`, `calc.test.js:7:10`, `actual: 999.9`, `expected: 900`
  - 두 원문은 다르지만 정규화하면 같아서, 기본값 `maxSameFailures` 2에서 두 번째 실패가 "같은 실패 2회"로 계산됩니다.
- 결과
  - 실제 결과: `failed/repeated_failure`, `repairAttempts` 1. `maxRepairAttempts` 3이라 두 번이 남아 있었습니다.
  - 대조(`maxSameFailures` 3, 나머지 동일): 두 번째 수정 뒤 `done/verified`, `repairAttempts` 2.
  - 그러니 실패 지점이 옮겨 가는 진전이 있는 실행을 R-3가 막은 것입니다.
- 영향
  - 계산·수치 결과를 다루는 작업(연습 프로젝트도 가격 계산)에서는 수정이 결과를 바꿔도 근거가 숫자만 다를 때가 많습니다.
  - 테스트 이름에 숫자가 들어 있으면(`case 1`, `case 2`) 서로 다른 테스트의 실패도 하나로 묶입니다(코드 읽기로 확인, 실행하지 않음).
  - 보안 결함은 아니고, 재수정 반복의 판정 결함입니다. 결정표의 "고치지 않고 한계로 기록하는 것"에 들어 있지 않은 새 동작입니다.
- 재현: `node .codaryn/l1/e1-t5-signature.mjs`(결함)와 `node .codaryn/l1/e1-t5-signature.mjs control`(대조). 각각 1초 안팎입니다.
- 권고(결정은 PM)
  - 매번 바뀌는 숫자만 정규화합니다. 예: `(1.23ms)`, `duration_ms`, `# duration`처럼 단위가 붙은 시간과 타임스탬프. 줄·열 번호와 actual/expected 값은 남깁니다.
  - 아니면 숫자만 다른 경우를 "같은 실패"가 아니라 별도 계수로 다룹니다.
  - 회귀 테스트에 이 입력(같은 테스트, 다른 단언 줄)을 넣으면 좋습니다.

## 2. 중간: 시간 한도, 취소, T-2 종료 유예로 끊긴 출력이 `truncated: false`라서 여유 구간 규칙이 적용되지 않고, 등록 비밀의 앞부분이 모델·journal·stdout으로 나감

- 위치
  - `src/tools/command-runner.ts:242`: `truncated`는 캡처 상한 초과만 뜻합니다.
  - `src/tools/command-runner.ts:286-290`: `settleWithoutPipes`가 파이프를 끊어도 표시하지 않습니다.
  - `src/tools/command-runner.ts:331`: T-2 유예 타이머.
  - `src/tools/command-runner.ts:301`: 시간 한도·취소 시 트리 종료.
- 영향받는 곳
  - `src/tools/index.ts:187-198`: `maskOutput`은 `rawTruncated`일 때만 공통 접두 규칙을 씁니다.
  - `src/engine/feedback.ts:149`: `prepareEvidence`는 `runnerCut`일 때만 끝 4096바이트를 버립니다.
  - 검증기(`src/verify/index.ts:127, 181`)는 `ran.truncated`를 그대로 넘깁니다.
- 깨지는 입력 1, T-2 유예(T 묶음이 새로 만든 경로)
  - 명령 프로세스는 곧바로 끝납니다.
  - 파이프를 물려받은 백그라운드 자손이 한 줄을 두 번에 나눠 씁니다. `bg log: token=<비밀 앞 절반>`을 쓰고 1.4초 뒤 나머지를 씁니다.
  - 실행기는 종료 500ms 뒤 파이프를 닫고 정산합니다.
  - 결과(실제 CLI)
    - `run_command` 결과: `stdout: "started background writer\nbg log: token=l1fake-Tq7Rz2Wm9K"`, `truncated: false`, `exitCode: 0`.
    - 같은 명령을 검증기로 쓰면 근거 끝이 같은 앞 절반으로 끝나고, 재수정 메시지(model_request)에도 앞 절반이 들어갑니다.
    - journal과 CLI stdout JSON에 앞 절반이 있습니다. 비밀 전체는 어디에도 없습니다.
- 깨지는 입력 2, 시간 한도(T 이전부터 같은 원인)
  - 명령이 `log: token=<앞 절반>`을 쓰고 멈춥니다. `run_command.timeoutMs` 1500에서 종료됩니다.
  - 결과: `timedOut: true`, `truncated: false`, 모델에 보낸 tool 메시지에 앞 절반이 있습니다.
- 왜 문제인가
  - T-6과 `maskOutput` 주석이 세운 불변식은 "캡처 끝에서 잘린 4096바이트 이하 비밀은 남지 않는다"입니다.
  - 그런데 끊긴 시점이 캡처 상한이 아닐 때는 표시가 없어 이 불변식이 깨집니다. 가림은 비밀 조각을 알아보지 못합니다.
- 발생 조건(추측)
  - 의도치 않은 누출에서도 쓰기 도중 비밀이 둘로 나뉘어야 합니다.
  - 블록 버퍼로 출력하는 백그라운드 프로세스(Python·C stdio의 8KB 플러시, 개발 서버 로그)나, 줄 중간에서 멈춘 명령에서 생길 수 있다고 봅니다.
  - 빈도는 측정하지 않았습니다. 적대적 모델은 다른 방법(변환 출력)으로도 새게 할 수 있습니다(T-7 한계). 이 결함은 우발적 누출 방어의 빈틈입니다.
- 재현: `node .codaryn/l1/e2-t2-grace-cut.mjs`(약 3초), `node .codaryn/l1/e2b-timeout-cut.mjs`(약 3초). 가짜 비밀은 `secretEnv` `L1_FAKE_TOKEN`으로 등록하고, 같은 값을 작업 공간 `data/settings.txt`에 두었습니다.
- 권고(결정은 PM)
  - 실행기가 출력을 끝(end)까지 읽지 못하고 정산하면 "끊김" 표시를 세웁니다(`truncated`이든 새 필드이든). 해당하는 경우는 유예 만료, 종료 대기 만료, 종료 신호 뒤 정산입니다.
  - 그 표시가 있으면 `maskOutput`과 `prepareEvidence`가 같은 여유 구간 규칙을 쓰게 합니다.
  - 검증기 쪽(p8 소유)은 실행기 표시를 그대로 넘기므로 계약만 정해지면 따라갑니다.

## 3. 낮음: Node가 스크립트 이름 뒤의 `--env-file-if-exists`도 스스로 처리하는데, T-15 거부는 `--env-file`만 다룸

- 위치: `src/cli/args.ts:38-42, 102`.
- 깨지는 입력: `codaryn run --env-file-if-exists=<경로> --task ...`
- 결과(실행)
  - Node 26.13이 codaryn보다 먼저 그 경로를 확인하고, stderr에 `<경로> not found. Continuing without it.`을 씁니다. 변수는 불러오지 않았습니다(probe 결과 null).
  - codaryn은 힌트 없이 일반 usage 오류를 냅니다(`invalid_arguments`, 종료 2).
  - UNC 경로라면 S-5 검사보다 먼저 접근하게 됩니다. 이 부분은 추측입니다. UNC로는 실험하지 않았습니다(네트워크 접근 금지).
- 참고: `--env-file` 자체도 여전히 Node가 먼저 접근합니다. T-15는 codaryn 옵션 이름을 바꾸고 안내만 하므로, Node의 접근은 막을 수 없습니다.
- 영향: argv는 사용자가 정하므로 위험은 낮습니다. 문서나 거부 메시지에 `--env-file-if-exists`도 같은 이유로 쓰지 말라고 적는 정도면 됩니다.
- 재현: `.codaryn/l1`에서 `node dist\src\cli\main.js run --env-file-if-exists=no-such.env --task none.json`. 같은 방식으로 `print-env.mjs`에 `--env-file`·`--env-file-if-exists`를 주면 Node 동작을 확인할 수 있습니다.

## 문제 없던 범위(확인한 것)

- **T-1**
  - `assemble.ts:143`가 `allowEnvValue: envValueFreeOfSecrets(privacy)`와 `workspaceRoot`(실경로)로 실행기 하나를 만들고, 도구와 검증기에 같은 실행기를 넘깁니다.
  - 자식 환경은 허용 목록 11개 이름만 받고, 값에 등록 비밀이 있으면 빠집니다. `ANTHROPIC_API_KEY`는 허용 목록에 없습니다.
  - `--vars-file`이 허용 목록 이름(HOME, LANG 등)을 새로 설정하면, 8자 이상 값은 비밀로 등록되어 자식에게서 빠집니다.
- **T-2**: 끝난 자식에는 `taskkill`이나 그룹 신호를 보내지 않습니다(`stop`이 `exited`를 먼저 봄). 종료 코드는 exit 시점 값이 우선합니다.
- **T-3**: `timeoutMs` 600000 초과는 `invalid_args`이고, 게이트 전 검증 단계에서 기록됩니다.
- **T-4**
  - `.exe`/`.com`도 찾은 경로와 실경로를 모두 작업 공간(주어진 루트와 실경로)과 비교해 거부합니다.
  - `fs/promises.realpath`는 네이티브 호출이라 8.3 이름이 풀립니다. 실경로를 풀지 못하면 `NOT_FOUND`로 실행하지 않습니다.
- **T-6 엔진 쪽**
  - 가린 뒤 자릅니다. `prepareEvidence`는 끝에서 고정 바이트를 버리므로, 가림 때문에 길이가 줄거나 늘어도 끝의 조각이 남지 않습니다(코드 읽기).
  - 두 스트림이 모두 잘린 경우 앞 스트림의 잘린 끝은 근거 가운데에 있어 `cutMiddle`(8192)이 버립니다.
  - 재수정 메시지는 기록된 근거로 만들고 다시 가립니다.
- **T-8**: 검증기 루프 뒤 `interrupted()`가 `max_duration`을 돌려줍니다. 통합 테스트 F5-g2가 이를 확인합니다.
- **T-12**: `revert --workspace`의 UNC·장치 경로를 먼저 거부합니다. `--cancel-file`은 없는 파일이어도 가장 깊은 기존 조상의 실경로로 판정하므로, 작업 공간 안이면 거부됩니다.
- **T-13**
  - 형식 검사가 정책 모듈 함수 하나로 통일되었습니다.
  - 링크 항목은 매 쓰기마다 실경로로 다시 풉니다. 작업 공간 밖이거나 끊긴 링크면 모든 쓰기를 거부합니다.
  - 없는 항목은 어휘 경로로 보호합니다.
  - 확인: NTFS는 `ſ`(U+017F)·`ı`(U+0131)를 `s`·`i`와 같은 이름으로 보지 않습니다(실험). 그러므로 `toLowerCase` 접기와 NTFS 대소문자 규칙의 차이를 이용한 우회는 찾지 못했습니다.
- **T-14**
  - 원문 키 검사가 `\u` 이스케이프를 왼쪽부터 풀어서 봅니다. 위치에는 알려진 이름과 숫자 없는 키 필드 이름만 적습니다.
  - 루트 대체 데이터 스트림은 작업 공간 안으로 판정합니다. `maxOutputTokens`는 200000 이하입니다.
- **출력 경로**
  - 엔진이 모델로 보내거나 기록하는 텍스트는 모두 가린 뒤 나갑니다: 시스템 문구, goal, 도구 결과, 도구 호출 반향, 모델 응답, 재수정 메시지, 오류 메시지.
  - CLI 최상위 예외는 문구 없는 `internal_error`입니다. `assemble` 실패 메시지는 `scrub`을 거칩니다.
  - 위 2번의 잘린 조각 말고는 등록 비밀이 stdout/journal로 새는 경로를 찾지 못했습니다.

## 다시 확인한 알려진 한계(결함으로 세지 않음)

- T-2: 분리된 자손이나 파이프를 쥔 백그라운드 자손은 실행과 CLI가 끝난 뒤에도 살아 있습니다.
  - E2의 손자도 CLI가 정산한 뒤 1.4초 더 실행됐습니다.
  - 이런 자손은 잠금이 풀린 뒤 작업 공간을 바꿀 수 있고, 그 변경은 journal과 되돌리기 범위 밖입니다.
- T-7, T-11: 모델이 쓴 코드는 검증기와 `run_command`로 실행되므로, 스냅샷이나 작업 공간 밖 파일을 읽어 변환해 출력할 수 있습니다(OS 격리 없음).
- 서로 다른 실패를 번갈아 내는 경우, 4096바이트보다 긴 비밀 변형의 경계 노출(결정표의 한계).

## 검사하지 않은 범위

- POSIX에서 실행해 보지 않았습니다. T-4의 작업 공간 안 실행 파일 거부는 Windows 경로(`planWindowsLaunch`)에만 있습니다. POSIX의 PATH 상대 항목이나 작업 공간 안 실행 파일은 확인하지 않았습니다.
- `.cmd`/`.bat` 실행의 인자 문자 집합 우회(cmd.exe 해석)는 F6에서 본 뒤 다시 실험하지 않았습니다.
- 작업 공간 안 DLL 탐색(허용된 실행 파일이 cwd에서 DLL을 읽는 경우), 하드 링크로 보호 경로를 쓰는 경우는 실험하지 않았습니다.
- `src/privacy`의 가림 변형(JSON 이스케이프·URL 인코딩 등), Anthropic 제공자(`src/model/anthropic`)는 이번 대상이 아니어서 다시 보지 않았습니다.
- UNC·실제 네트워크 경로, 실제 키, 실제 API는 쓰지 않았습니다.
- 2번의 발생 빈도는 측정하지 않았습니다.

## 실험 파일(`.codaryn/l1`, 저장소 밖)

- `harness.mjs`: 사례 디렉터리 생성과 CLI 실행(최소 환경).
- `e1-t5-signature.mjs`: 1번 재현. 인자 `control`이 대조입니다.
- `e2-t2-grace-cut.mjs`, `e2b-timeout-cut.mjs`: 2번 재현.
- `print-env.mjs`, `vars-probe.env`: 3번에서 Node 동작 확인.
- `ntfs-case/`: T-13 대소문자 접기 확인.
- `dist/`: 7d5f0b3 빌드. `cases/`: 실행 결과(작업 공간, journal).
