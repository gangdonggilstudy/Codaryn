# F6 교차 검토: 보호 경로 정책과 CLI 보안 검사 모듈

- 검토자: p1(w1:p1). 대상 두 모듈의 구현자가 아니다. 단, 이 두 모듈을 부르는 CLI 연결(`src/cli/run.ts`, `src/cli/task.ts`)은 내가 구현했다. 그 연결에서 나온 발견(L4)은 그 사실을 밝혀 둔다.
- 대상:
  - `src/policy/**`: `protected.ts`, `index.ts`의 `protectedPaths` 판정
  - `src/cli/security/**`: `paths.ts`, `keys.ts`, `env.ts`, `limits.ts`, `url.ts`
  - 판정이 기대는 `src/workspace/lexical.ts`, `workspace.ts`의 `resolve`는 읽기만 했다.
- 기준: main `8e1a166`. 내 worktree의 대상 파일은 main과 같다(`git diff main HEAD -- src/policy src/cli/security` 0줄).
- 방법:
  - 코드를 읽었다.
  - 실험은 worktree의 `.codaryn` 안에서만 했다. 빌드 출력은 `.codaryn/f6-build`, 임시 작업 공간은 `.codaryn/f6/*-ws`다.
  - 저장소 파일은 수정하거나 커밋하지 않았다(`git status` 깨끗함).
  - 가짜 값만 썼고, 실제 API, 외부 네트워크, 키 파일은 쓰지 않았다.
- 환경: Windows 11, Node 26, NTFS 볼륨 D:. 이 볼륨은 8.3 짧은 이름을 만들지 않는다. 파일 심볼릭 링크 생성은 권한 부족(EPERM)이다. 정션과 하드 링크는 만들 수 있다.

## 요약

| 심각도 | 수 | 항목 |
| --- | --- | --- |
| 높음 | 0 | |
| 중간 | 1 | M1 링크인 보호 경로 항목은 그 대상을 보호하지 않는다 |
| 낮음 | 4 | L1 이스케이프한 키를 중복 필드에 두면 두 키 검사를 모두 통과한다. L2 키 필드 이름의 임의 문자열(현재 키 조각 포함)이 오류 위치로 출력된다. L3 작업 공간 루트 디렉터리의 대체 스트림이 "밖"으로 판정된다. L4 CLI가 받아들인 보호 경로 항목을 정책이 형식 오류로 보고 모든 쓰기를 거부한다 |
| 정보 | 8 | I1~I8 |

## 발견

### M1 [중간] 보호 경로 항목이 링크(정션·심볼릭 링크)이면 그 실제 대상은 보호되지 않는다

- **위치:**
  - `src/policy/protected.ts:31-37, 54-60`: 항목을 어휘로만 해석하고 실경로로 풀지 않는다.
  - `src/policy/index.ts:177-183`: `checkEffective`는 쓰기 대상만 실경로(`outcome.path.relative`)로 비교한다.
- **깨지는 입력:** 작업 공간에 `fixtures`가 `shared/fixtures`를 가리키는 정션이고, `protectedPaths: ["fixtures"]`이다.
- **결과(재현함, `exp2.mjs` A):**

  | 쓰기 대상 | `checkRequested` | `checkEffective` |
  | --- | --- | --- |
  | `fixtures/expected.txt` | 거부(`protected_path`) | 허용(실경로 `shared/fixtures/...`가 항목과 맞지 않음) |
  | `shared/fixtures/expected.txt` | 허용 | 허용 |
  | `SHARED/FIXTURES/expected.txt` | 허용 | 허용 |

  `shared/fixtures/expected.txt`에 실제로 쓴 뒤 보호 이름 `fixtures/expected.txt`로 읽으면 `tampered`다. 검증기가 `fixtures/` 아래를 기준 자료로 읽으면 모델이 그 기준을 바꿀 수 있다. R-5 목적(테스트나 검증 설정을 고쳐 통과시키는 경로를 막는다)을 어긴다.
- **조건:** 사용자가 링크인 경로를 보호 항목으로 적어야 한다. 모노레포처럼 공유 폴더를 링크로 둔 저장소에서 생긴다. 특권은 필요 없다(정션).
- **기존 테스트와의 관계:** `tests/unit/policy/protected-paths.test.ts:124`는 보호 디렉터리 안을 가리키는 링크(`alias` → `tests`)만 시험한다. 항목 자체가 링크인 경우는 다루지 않는다.
- **제안:** 게이트를 만들 때 각 항목을 `workspace.resolve`로 실경로로 풀어 그 relative도 보호 목록에 넣는다(어휘 형과 실경로 형 둘 다). 항목이 아직 없으면 어휘 형만 쓴다. 항목 실경로가 작업 공간 밖이면 형식 오류로 막는다.
- **재현:** `node_modules\.bin\tsc.cmd -p tsconfig.json --outDir .codaryn/f6-build` 다음 `node .codaryn/f6/exp2.mjs` → `protectedJunctionEntry`

### L1 [낮음] `\u` 이스케이프한 키를 중복 필드의 앞 값에 두면 원문 검사와 구조 검사를 모두 통과한다

- **위치:**
  - `src/cli/security/keys.ts:89-91`: 원문 검사는 이스케이프한 키 모양을 보지 못한다.
  - `keys.ts:53-83`: 구조 검사는 `JSON.parse`가 버린 앞 값을 보지 못한다.
- **깨지는 입력:**
  - task: `{"goal":"\u0073k-ant-FAKE…","goal":"g2", …}`
  - 설정: `{"schemaVersion":1,"model":"\u0073k-ant-FAKE…","model":"m"}`
  - 현재 키를 같은 방식으로 이스케이프해도 같다.
- **결과(재현함, `exp.mjs` keyChecks와 `exp2.mjs` B):** `raw:false`, `parsed:none`이다. `runCli`가 키 검사를 모두 지나 조립 단계까지 갔다(`reachedAssembly: true`). 이스케이프하지 않은 중복 필드는 원문 검사가 잡는다(`raw:true`).
- **영향:** 버려지는 값이라 전송·기록·출력되지 않는다. "키를 파일에 두지 않는다"(C-1)는 규칙의 검출만 빠진다. 두 검사를 함께 쓰면 메울 수 있다고 한 p7 보고서의 설명은 중복 필드에서는 성립하지 않는다.
- **제안:** 원문 검사 전에 JSON 문자열 안의 `\uXXXX`만 풀어 본 텍스트에도 같은 검사를 하거나, 중복 필드 자체를 형식 오류로 거부한다.

### L2 [낮음] 키 필드 이름에 붙인 임의 문자열이 오류 위치로 그대로 출력된다. 현재 키의 조각도 나온다

- **위치:**
  - `src/cli/security/keys.ts:26`: `PLAIN_ASCII_NAME`이 영문·숫자·밑줄 40자까지 허용한다.
  - `keys.ts:55-58`: 키 필드 이름이면 그대로 쓴다.
- **깨지는 입력:**
  - task에 `"apikeyHunter2Secret": "x"`
  - 환경 `ANTHROPIC_API_KEY`에 가짜 키 값(문서에서는 생략)이고 task에 `"apikeyAbCdEfGhIjKlMnOpQrSt": "x"`
- **결과(재현함, `exp2.mjs` B):** stdout은 다음과 같다.
  - `"…key field or key value at apikeyHunter2Secret; …"`
  - `"… at apikeyAbCdEfGhIjKlMnOpQrSt; …"`: 현재 키의 20자 조각이 그대로 나왔다(`fragmentPrinted: true`).
  - `holdsKey(name)`는 현재 키 전체만 찾으므로 조각은 거르지 못한다.
- **영향:** 사용자가 키 재료를 필드 이름에 넣은 경우에만 생긴다. 출력은 stdout뿐(CI 로그 포함)이고 기록은 없다.
- **제안:** 키 필드 이름은 `KEY_FIELD_NAMES`와 정확히 같을 때만 그대로 쓰고, `apikey`를 포함만 한 이름은 `<key field>`로 쓴다.

### L3 [낮음] 작업 공간 루트 디렉터리의 대체 데이터 스트림이 "밖"으로 판정된다 (S-1)

- **위치:** `src/cli/security/paths.ts:104-111`. 루트 뒤 첫 글자가 구분자일 때만 안으로 본다. `:`는 고려하지 않는다.
- **깨지는 입력:** `--config "<작업 공간>:cfg"`(루트 디렉터리의 대체 스트림)
- **결과(재현함, `exp.mjs` locateInWorkspace):**
  - `realpath.native`는 `…\loc-ws:cfg`를 돌려주고, 판정은 `"outside"`다.
  - 같은 방식의 파일 스트림(`…\loc-ws\c.json:cfg`)은 `"inside"`다.
  - `checkLocalPathSyntax`도 `:`를 막지 않는다(`"C:\\work\\c.json:stream"` → `ok`).
- **영향:** 루트 디렉터리 스트림은 작업 공간 디렉터리 객체의 일부다. `write_file`은 `:`를 거부하므로 모델은 쓸 수 없고, 허용된 명령만 쓸 수 있다. 사용자가 그 경로를 설정 경로로 주어야 하므로 현실성은 낮다.
- **제안:** Windows에서 실경로의 마지막 조각에 `:`가 있으면 `unknown`으로 본다. 또는 CLI 경로 검사(S-5)에서 드라이브 문자 뒤의 `:`를 거부한다.

### L4 [낮음] CLI가 받아들인 `protectedPaths` 항목을 정책이 형식 오류로 보고, 관계없는 파일까지 모든 쓰기를 거부한다

- **위치:**
  - CLI: `src/cli/task.ts:139`의 `parseProtectedPaths`(내가 구현함). 빈 값, 절대 경로, `..`, NUL만 거부한다.
  - 정책: `src/policy/protected.ts:31-50`. `isValidPathInput` 실패를 형식 오류로 보고 모든 쓰기를 거부한다(fail closed).
- **깨지는 입력:** `protectedPaths: ["tests "]`, `["tests."]`, `["a|b"]`, `["nul"]`(Windows)
- **결과(재현함, `exp.mjs` cliVsPolicyEntries):** CLI 검증은 통과하고(`cliAccepts: true`), 관계없는 `free.txt` 쓰기가 `path/protected_path`로 거부된다. `["a:b"]`는 CLI도 거부한다.
- **영향:** 안전한 쪽 실패다. 사용자는 "보호 경로" 오류만 보고 원인 항목을 알 수 없으며, 모델은 아무 파일도 쓰지 못한다.
- **제안:** CLI가 정책과 같은 규칙(`parseProtectedEntry`)으로 검증해 `invalid_task`/`invalid_config`로 위치를 알린다. 이것은 CLI 쪽(p1) 수정이다.

## 정보

- **I1 명령은 보호 경로 밖이다.** 정책 범위 밖이며, 확인하고 한계로 기록한다.
  - `run_command`(`node -e "…writeFileSync('tests/a.txt',…)"`, `cwd: "tests"`)는 `protectedPaths: ["tests"]`에서도 두 단계 모두 허용된다(`exp.mjs` runCommandOnProtected).
  - 명령형 검증기도 같다.
  - cli-contract 10절 단계 2 한계에 이미 적혀 있다.
- **I2 하드 링크.**
  - 작업 공간 안의 하드 링크(`hard.txt` ↔ `tests/a.txt`)로 `write_file`을 하면 정책은 허용하지만, 쓰기가 이름을 새 파일로 바꾸므로 보호 파일은 그대로다(`protectedFileAfter: "protected original\n"`).
  - S-1에서 작업 공간 밖 하드 링크는 `"outside"`다. 명령의 제자리 수정은 막지 못한다. p7 보고서와 cli-contract에 기록되어 있다.
- **I3 S-5는 어휘 검사다.**
  - 매핑된 네트워크 드라이브(`Z:\…`)는 `ok`다.
  - 로컬 경로에 놓인 UNC 대상 심볼릭 링크는 문자열만 보므로 통과하고, `readFile`이 따라간다. 이 읽기는 S-1의 실경로 확인보다 먼저 일어난다.
  - 추측이다. 네트워크 금지와 심볼릭 링크 권한(EPERM) 때문에 실행하지 않았다.
- **I4 끝에 `:`가 붙은 장치 이름.**
  - `C:\work\con:`은 `checkLocalPathSyntax`를 통과한다.
  - 이 OS에서는 디렉터리 안의 `nul`, `nul:`, `nul:.json`이 모두 보통 이름(ENOENT)이라 장치가 열리지 않는다(`probe.mjs`).
  - 이전 Windows에서 콘솔이 열리는지는 확인하지 않았다(추측).
- **I5 apiBaseUrl.**
  - 무해한 경로는 통과한다(`/v1;x`, `/%76%31`, `/%E3%80%80v1`).
  - 정상 프록시 경로 `/proxy/v1`은 거부된다(설계 선택, PM 판단 대기).
  - 비루프백 http는 하나도 통과하지 않았다(`exp.mjs` apiBaseUrl 29가지).
- **I6 대문자 키 모양.** `SK-ANT-…`은 키 모양 패턴(대소문자 구분)에 걸리지 않는다.
- **I7 `-0`.** `maxRepairAttempts: -0`은 0으로 받아들여진다. 무해하다.
- **I8 8.3 짧은 이름.** 이 볼륨에서는 만들어지지 않아 시험하지 못했다. 코드는 native `realpath`를 써서 짧은 이름을 긴 이름으로 바꾼다. `protected-paths.test.ts:140`도 같은 조건에서 건너뛴다.

## 문제 없던 범위 (재현 시도에서 막힘)

**보호 경로(`protectedPaths: ["tests", "verify/config.json", "docs/spec.md"]`)**

다음 쓰기는 모두 두 단계에서 거부됐다(`exp.mjs` protectedWrites).

| 대상 | 판정 |
| --- | --- |
| 대소문자(`TESTS/A.TXT`, `VERIFY/CONFIG.JSON`, `DOCS/SPEC.MD`), `\` 구분자 | `protected_path` |
| `..` 우회(`./x/../tests/a.txt`, `docs/sub/../spec.md`), 작업 공간 절대 경로 | `protected_path` |
| 아직 없는 하위 경로(`tests/sub/new.txt`, `Tests/Sub/New.txt`), 아직 없는 보호 파일(`docs/spec.md`) | `protected_path` |
| 보호 디렉터리를 가리키는 정션(`jlink/a.txt`, `jlink/new.txt`) | 실효 단계에서 `protected_path` |
| 끝의 점·공백(`tests./a.txt`, `tests /a.txt`, `tests/a.txt.`, `verify/config.json.`) | `invalid_path` |
| 대체 스트림(`tests/a.txt::$DATA`, `tests/a.txt:ads`, `tests:ads`), `\\?\` 접두 | `invalid_path` |

- 이름이 접두만 같은 경로(`tests2/a.txt`, `verify/config.json.bak`)는 허용된다(정상).

**유니코드 대소문자**

- 이 NTFS 볼륨은 `ſ`/`s`, `ı`/`i`, `ς`/`σ`, 켈빈 기호/`k`를 다른 이름으로 다룬다(`probe.mjs`).
- JS `toLowerCase` 접기와 어긋나 생길 수 있는 우회는 이 볼륨에서는 없다. 켈빈 기호는 JS 쪽이 더 넓게 보호한다.

**S-1 `locateInWorkspace`**

| 경우 | 판정 |
| --- | --- |
| 작업 공간 밖 정션을 거쳐 들어오는 경로 | 안 |
| 대소문자, 끝의 점·공백, `..` | 안 |
| 없는 파일 | 안 |
| 파일 스트림 | 안 |
| 이름만 비슷한 형제 폴더 | 밖 |
| 끊긴 정션 | `unknown` |

**S-6 키 검사**

- 이스케이프한 키 값(중복이 아님)은 구조 검사가 잡는다(`location: "model"`).
- 64단계 중첩은 통과하고, 65단계는 `too_deep`이다(경계 정확).
- 위치가 알 수 없는 필드면 `<field>`다.

**S-7 한도 경계**

| 경우 | 결과 |
| --- | --- |
| task = 설정 | 허용 |
| 설정 + 1 | `invalid_task` |
| 설정 null일 때 토큰 50,000,000 / 50,000,001 | 허용 / 거부 |
| 재수정 20 / 21, 같은 실패 10 / 0 | 허용 / 거부, 허용 / 거부 |
| 24시간 + 1ms | 거부 |
| 설정 재수정 0과 task 1 | `invalid_task` |
| anthropic, 설정에서 이어받은 null | `invalid_config` |
| 문자열 숫자 | 거부 |
| `1e3`, `1.0` | 정수로 허용 |

**S-9 `normalizeApiBaseUrlStrict`**

- 거부: `/v1` 변형(`/V1/`, `/v1/.`, `/v1/%2e`, `/v1/%2E/`, `/v1/messages/`), 사용자 정보로 루프백을 흉내 내기(`http://localhost@evil.test`), 비루프백 http, 경로의 `@`, 호스트의 전각 공백
- 루프백 표기 변형(`127.1`, `0x7f000001`, `2130706433`, `[0:…:1]`, 전각 `ｌｏｃａｌｈｏｓｔ`, `loc%61lhost`)은 실제 루프백으로 정규화되어 허용된다(정상).

**메시지에 값이 실리는지**

- `normalizeApiBaseUrlStrict`, `checkTimerMs`, `validateSecretEnvNames`, `resolveBoundedLimits`의 메시지에 입력값(가짜 키, 파일의 숫자)이 없다(`exp.mjs` messages).
- 예외는 L2의 위치 문자열뿐이다.

**S-5 UNC·장치 접두**

- UNC(`\\server\share`, `//server/share`, 섞인 구분자), `\\?\UNC\`, `\\?\C:`, `\\.\pipe\`, `\??\`, DOS 장치 이름 조각(`nul`, `con.json`)은 원문이나 resolve 결과에서 거부된다.
- 중간의 이중 구분자(`C:\work\..\..\\server\share`)는 resolve 뒤 로컬 경로가 된다(정상).

## 검사하지 않은 범위

- 8.3 짧은 이름(볼륨에서 비활성), 파일 심볼릭 링크(EPERM), 디렉터리별 대소문자 구분 설정(`fsutil setCaseSensitiveInfo`)
- POSIX와 macOS 동작. POSIX 분기는 코드만 읽었다. macOS의 대소문자 무시 파일 시스템에서 POSIX 분기가 대소문자를 구분하는 점은 추측으로만 지적한다.
- 실제 UNC, 매핑 드라이브, subst 드라이브 접근(네트워크 금지, 시스템 상태 변경 회피)
- 확인과 사용 사이 경쟁(TOCTOU) 재현
- S-4 `selectEnvFileSecrets`를 실제 `process.loadEnvFile`과 함께 실행하는 것. 코드만 읽었고 유닛 테스트에 의존했다.
- 정책의 토큰 경로 복원(`restorePathTokens: true`)과 보호 경로의 결합
- 이전 Windows 버전의 장치 이름 해석

## 재현 파일

- `.codaryn/f6/probe.mjs`: 볼륨 성질(유니코드 대소문자, 8.3, 대체 스트림, 장치 이름)
- `.codaryn/f6/exp.mjs` → `exp-out.json`: 보호 경로, `locateInWorkspace`, 키 검사, 한도, apiBaseUrl, 경로 구문, 메시지
- `.codaryn/f6/exp2.mjs` → `exp2-out.json`: M1, L1·L2의 `runCli` 재현(조립 단계는 가짜로 막음)
- 빌드: `node_modules\.bin\tsc.cmd -p tsconfig.json --outDir .codaryn/f6-build`
