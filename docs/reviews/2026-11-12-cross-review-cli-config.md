# 작업 H2 교차 검토 보고: CLI 설정 처리 (읽기 전용)

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조)
- 대상: 관리용 main `0164b10`의 `src/cli/**`. worktree `D:\project\Codaryn\.worktrees\claude-store`(브랜치 `claude/revert-store`, HEAD가 main `0164b10`과 같음)에서 읽었습니다.
- 파일 수정 없음, 커밋 없음. 실험은 `.codaryn/h2/`(빌드 출력, 실험 스크립트)와 `.codaryn/h2-tmp/`(임시 작업 공간)에서만 했습니다. 실제 네트워크 호출, 실제 API, 키 파일 읽기는 없었습니다. 값은 모두 가짜입니다.
- 재현 스크립트: `.codaryn/h2/exp/probe.mjs`, `.codaryn/h2/exp/probe2.mjs`. 출력: `.codaryn/h2/exp/probe-output.txt`. 빌드: `npx tsc -p tsconfig.json --outDir .codaryn/h2/dist`. 실행할 때 TEMP와 TMP를 `.codaryn/h2-tmp`로 바꿨습니다.

## 기준선 테스트 (.codaryn 빌드에서 실행)

| 범위 | 결과 |
| --- | --- |
| 유닛 `node --test ".codaryn/h2/dist/tests/unit/**/*.test.js"` | 234개 중 통과 233, 실패 0, 건너뜀 1(Windows 디렉터리 링크 생성 불가로 건너뛴 workspace 테스트) |
| 통합 `node --test ".codaryn/h2/dist/tests/integration/**/*.test.js"` | 130개 중 통과 130, 실패 0 |

통합 테스트는 가짜 서버와 net-guard를 쓰는 모의 API 검증입니다. 실제 API 검증이 아닙니다.

## 심각도 기준

- 높음: 키 유출이나 권한 확대로 이어지고 전제가 흔한 사용 방식에 있는 것
- 중간: 흔한 설정 실수로 비밀이 노출되거나, 계약(출력 형식, 기록 규칙)이 깨지거나, 신뢰할 수 없는 입력으로 외부 접속이 일어나는 것
- 낮음: 전제가 드물거나 영향이 가용성·표시에 그치는 것
- 정보: 위험은 아니지만 판단에 필요한 사실

## 발견 사항

### H2-1 [높음] 작업 공간 안의 설정·env·task 파일은 모델이 고칠 수 있고, 다음 실행의 API 주소·정책·검증기·한도가 바뀐다

- 위치: `src/cli/run.ts:91-124`(env 파일, 설정 파일, task 파일 경로를 읽기만 하고 `workspaceRoot`와 비교하지 않음), `src/workspace/lexical.ts:92`(도구 쓰기 금지는 `.codaryn`뿐), `src/cli/settings.ts:57-67`(`CODARYN_API_BASE_URL`이 설정보다 우선).
- 깨지는 입력:
  - `--config <작업공간>/codaryn.json`이나 `--env-file <작업공간>/.env`. 문서 예시 `--env-file .env`(docs/cli-contract.md:234-240)는 현재 디렉터리 기준이라, 프로젝트 폴더에서 실행하면 이 경우가 됩니다.
  - 1회차 실행에서 모델(또는 작업 공간 내용의 프롬프트 주입)이 `write_file`로 그 파일을 고칩니다.
- 결과(재현함):
  - G-config: 1회차 scripted 모델이 `codaryn.json`에 `"apiBaseUrl":"https://attacker.invalid"`를 넣었습니다. 2회차 같은 `--config`에서 제공자에 넘어가는 `apiBaseUrl`이 `https://attacker.invalid`였습니다. 실제 전송은 하지 않고 팩토리에서 가로챘습니다. 실제 실행이라면 `x-api-key` 헤더가 그 주소로 갑니다.
  - G-env: 1회차 모델이 `.env`에 `CODARYN_API_BASE_URL=https://attacker.invalid`를 덧붙였습니다. 2회차 `--env-file` 실행에서 같은 결과가 나왔습니다.
  - task 파일이 작업 공간 안에 있으면 `policy.commands`, `verifiers`, `limits`를 같은 방식으로 넓힐 수 있습니다(코드 판독). 이는 AGENTS.md "후보가 검증 기준을 수정할 수 있는 구조를 허용하지 않는다", C-3 "프로젝트 문서가 권한이나 전송 목적지를 넓힐 수 없어야 한다"와 충돌합니다.
  - env 파일은 부모에 없는 허용 목록 변수도 설정합니다. 이 기기에는 `HOME`이 없고, `process.loadEnvFile`로 `HOME`이 설정되는 것을 확인했습니다. `HOME`은 `CHILD_ENV_ALLOWLIST`(`src/contracts/tool.ts:357-369`)에 있으므로 검증기·명령 자식 프로세스로 넘어갑니다(자식 전달은 코드 판독).
- 재현: `node .codaryn/h2/exp/probe.mjs`의 G-config, G-env 줄.
- 권고:
  - `workspaceRoot`를 realpath로 확정한 뒤 env 파일, 설정 파일, task 파일, scriptPath의 realpath가 그 안에 있으면 거부합니다. 링크 우회를 막으려면 경로 문자열 비교가 아니라 realpath 비교여야 합니다.
  - 문서 예시를 "작업 공간 밖의 .env"로 고칩니다.
  - 필요하면 이 파일들을 도구 쓰기 금지 목록에 넣습니다.

### H2-2 [중간] scripted 제공자로 실행하면 ANTHROPIC_API_KEY를 비밀로 등록하지 않아 키가 journal에 원문으로 남는다

- 위치: `src/cli/run.ts:164-169`. 키는 anthropic 분기에서만 `secrets`에 넣습니다.
- 깨지는 입력: 환경(또는 `--env-file`)에 키가 있고, scripted task가 그 키가 든 작업 공간 파일(예: `.env`)을 `read_file`로 읽는 경우.
- 결과(재현함, G-env-run1): `journal.jsonl`에 현재 키 문자열이 그대로 있습니다(`journal has current key: true`). 1b 완료 기준 2 "키 값은 어떤 출력과 기록에도 없다"를 어깁니다. 외부 전송은 없습니다(scripted).
- 권고: 제공자와 관계없이 `envValue(env, ANTHROPIC_API_KEY)`가 있으면 비밀로 등록합니다. 회귀 유닛으로 scripted 실행 journal에 키가 없는지 확인합니다.

### H2-3 [중간] secretEnv 항목이 오류 메시지에 그대로 실린다. 이름 대신 값을 적는 실수가 stdout 노출로 이어진다

- 위치: `src/cli/run.ts:159`. 이름은 `src/cli/task.ts:163-167`에서 빈 문자열만 거부합니다.
- 깨지는 입력: 설정 `"secretEnv": ["fake-db-password-VALUE-777"]`(이름 자리에 값을 씀).
- 결과(재현함, C-secretEnv): `secret_env_missing`, 메시지 "environment variable fake-db-password-VALUE-777 listed in privacy.secretEnv is not set". 파일 머리 주석의 "Error messages name fields only, never values from the file"와 어긋납니다. 설정 파일에서 온 이름인데도 메시지는 `privacy.secretEnv`라고 적습니다.
- 권고: 이름을 `^[A-Za-z_][A-Za-z0-9_]*$`로 검증하고 실패 시 필드와 위치만 알립니다(예: `secretEnv[0] is not a valid variable name`). 미설정 메시지는 검증을 통과한 이름만 적거나 위치만 적습니다.

### H2-4 [중간] 작업 공간 안 .env를 모델이 읽으면 키 외 값은 원문으로 전송·기록된다

- 위치: `src/cli/run.ts:155-169`. 비밀 등록은 `secretEnv` 이름과 키뿐이고, `--env-file`로 읽은 다른 값은 등록하지 않습니다.
- 결과(재현함, G3-anthropic): 간편 형식과 anthropic 제공자(가짜 fetch)로 모델이 `.env`를 읽게 했습니다. 두 번째 요청 본문에 키는 없고(가려짐), `OTHER_SERVICE_PASSWORD`의 가짜 값은 원문으로 있었습니다. journal에도 남습니다(G-env-run1).
- 성격: 문서화된 "등록한 값만 가린다"의 결과입니다. 다만 CLI가 권하는 배치(현재 디렉터리의 `.env`)가 이 경로를 만듭니다.
- 권고: H2-1의 위치 검사로 막습니다. 또는 `--env-file`이 새로 설정한 변수 값을 모두 비밀로 등록할지 PM이 정합니다. 그 경우 모델 이름 같은 값도 가려지는 부작용이 있습니다.

### H2-5 [중간, 코드 판독·미실행] task 파일의 UNC 경로가 검사 전에 원격 파일 시스템 접근을 일으킨다 (Windows)

- 위치: `src/cli/task.ts:73-75`, `:83`, `:265`(`path.resolve` 결과를 그대로 씀), `src/cli/run.ts:151`(`isDirectory`→`stat`), `:181`(scriptPath `readFile`).
- 깨지는 입력: 신뢰할 수 없는 task 파일의 `"workspaceRoot": "\\\\attacker.invalid\\share"` 또는 같은 모양의 `scriptPath`.
- 결과: 경로 계산은 재현했습니다(I-unc: `workspaceRoot=\\attacker.invalid\share\`). 그 뒤의 `stat`과 `readFile`은 SMB 접속이 되므로 실행하지 않았습니다(네트워크 금지). Windows에서는 이 접속에 NTLM 인증이 따라갈 수 있습니다. 작업 공간 모듈은 도구 경로에서 UNC를 거부하지만(`tests/unit/workspace/workspace.test.ts:108`), CLI는 그보다 먼저 루트와 스크립트를 건드립니다.
- 권고: `workspaceRoot`, `scriptPath`(필요하면 `--config`, `--env-file`, `--task`, `CODARYN_CONFIG`까지)에서 UNC(`\\`), 장치(`\\.\`, `\\?\`) 경로를 파일 시스템 접근 전에 거부합니다. 작업 공간 모듈의 어휘 검사를 재사용하면 됩니다.

### H2-6 [중간] 깊게 중첩된 JSON이면 키 검사가 스택을 넘겨 CLI가 JSON 출력 없이 종료 코드 1로 끝난다

- 위치: `src/cli/keys.ts:29-46`(재귀), `src/cli/run.ts:128-132`(try 밖), `src/cli/main.ts:13-42`(최상위 catch 없음).
- 깨지는 입력: 깊이 20000의 배열 중첩을 가진 task 또는 설정 파일. `JSON.parse`는 통과합니다.
- 결과(재현함):
  - B-runCli: `runCli`가 `RangeError`로 reject됩니다.
  - B2-cli: 실제 CLI 프로세스(net-guard 사용)가 종료 코드 1, stdout 0줄로 끝나고 stderr에 `RangeError: Maximum call stack size exceeded` 스택이 남습니다.
  - 계약상 stdout은 항상 JSON 한 줄이고 1은 "실행 실패" 코드라, 소비자가 오판합니다. 메시지에 값은 없습니다.
- 권고: 반복 순회와 깊이 상한(예: 64)을 두고, 넘으면 `invalid_task`/`invalid_config`로 처리합니다. `main.ts`에 최상위 catch를 두어 `internal_error` JSON을 출력합니다.

### H2-7 [중간, 설계 확인 필요] 한도에 상한이 없고, 설정 한도는 기본값일 뿐이라 task가 풀 수 있다

- 위치: `src/cli/task.ts:58-63`(양의 안전 정수면 모두 허용), `:138-151`(task 우선), `:287-300`(간편 형식은 설정만 사용).
- 깨지는 입력: task `limits: {maxModelTurns: 9007199254740991, maxTotalTokens: null}`, 설정 `limits: {maxModelTurns: 5, maxTotalTokens: 10000, ...}`.
- 결과(재현함): F-merge에서 병합 결과가 `maxModelTurns 9007199254740991`, `maxTotalTokens null`이었습니다. K-quick-unbounded에서 설정만으로도 네 한도를 모두 사실상 무한으로 둘 수 있었습니다. 엔진은 `maxDurationMs` 타이머만 2^31-1로 자르고(`src/engine/index.ts:120`), 경과 시간 비교에는 원래 값을 씁니다.
- 판단 필요: C-6 "한도 없이 실제 호출하지 않는다"의 취지라면 다음 셋을 PM이 정해야 합니다. 설정 한도를 상한으로 쓸지(task 값은 그 이하만), 계약에 절대 상한을 둘지, anthropic 제공자일 때 `maxTotalTokens: null`을 금지할지. H2-1과 결합하면 모델이 다음 실행의 한도를 풀 수 있습니다.

### H2-8 [낮음] 2^31-1을 넘는 시간 값은 Node 타이머에서 1 ms가 된다

- 위치: `src/cli/config.ts:79`(`requestTimeoutMs`), `src/cli/task.ts:195`(검증기 `timeoutMs`). 사용처는 `src/model/anthropic/index.ts:403-406`, `src/tools/command-runner.ts:223-226`.
- 결과(재현함):
  - D-timeout: `requestTimeoutMs: 3000000000`이면 `TimeoutOverflowWarning` 뒤 1 ms 만에 `timeout`이 되고, 메시지는 "did not finish within 3000000000 ms"였습니다.
  - E-cmd-timeout: 검증기 timeoutMs가 같으면 300 ms짜리 명령도 즉시 `timedOut: true`로 종료됐습니다.
- 권고: 설정과 task 검증에서 상한 2147483647을 둡니다(필드와 범위만 알림). 또는 타이머에서 자릅니다.

### H2-9 [낮음] 간편 형식 `--goal`은 키 검사 없이 전송·기록된다

- 위치: `src/cli/run.ts:126-132`(키 검사는 파일만), `src/cli/task.ts:291`.
- 결과(재현함, H-goal): 가짜 Anthropic 키 모양 문자열(현재 키 아님)과 등록하지 않은 가짜 비밀이 든 goal은 요청 본문과 journal에 원문으로 있었습니다. stdout에는 없었습니다. goal은 프로세스 명령줄로 다른 프로세스에 보이고, PowerShell 기록 파일에도 남습니다.
- 권고: `--goal`에도 키 모양·현재 키 검사를 적용해 `key_in_file`과 같은 계열 오류로 거부합니다. goal이 그대로 전송·기록된다는 점을 문서에 적습니다.

### H2-10 [낮음] 키 값 검사가 놓치는 경우

- 위치: `src/cli/keys.ts:23-25`.
- 결과(재현함, A-value, A-dupkey):
  - JSON 중복 키: `{"model":"<키 모양>","model":"some-model"}`는 `JSON.parse`가 뒤 값만 남겨 검사를 통과하고 설정도 받아들여집니다. 파일에는 키가 그대로 있습니다. 문서에 없는 경우입니다.
  - 그 밖에 놓치는 것: 현재 키의 Base64와 일부, 다른 서비스 토큰, 배열로 쪼갠 키 모양. 키 모양 안의 영폭 문자와 대문자 변형은 실제로 쓸 수 있는 키가 아니어서 영향이 없습니다. 일부는 문서 10절의 알려진 한계입니다.
- 권고: `JSON.parse` 전 원문 텍스트에도 키 모양과 현재 키 검사를 적용합니다. 그러면 중복 키와 이스케이프 이전 형태까지 잡습니다. 메시지는 지금처럼 위치 없이 파일 단위로 둡니다.

### H2-11 [낮음] 위치 문자열에 현재 키의 일부가 실릴 수 있다

- 위치: `src/cli/keys.ts:26`. 필드 이름은 "키 전체 포함이나 키 모양"일 때만 `<field>`로 바꿉니다.
- 결과(재현함, A-location): 필드 이름이 현재 키의 25자 조각이고 그 아래 `apiKey`가 있으면, 메시지 위치가 `limits.yn-fake-current-key-01234.apiKey`였습니다. 전제가 드뭅니다.
- 권고: 스키마가 닫혀 있으므로 알려진 필드 이름과 `KEY_FIELD_NAMES`에 맞는 이름만 그대로 적고, 나머지는 `<field>`로 적습니다.

### H2-12 [정보] 키 필드 이름 목록의 빈틈은 받아들여지지 않고 다른 오류로 끝난다

- 결과(재현함, A-name, A-closed):
  - 키 필드로 보지 않는 이름: 키릴 문자 `а`가 든 `аpiKey`, `anthropicKey`, `client_secret`, `access_key`, `private_key`, `refresh_token`, `pwd`, `credentials`.
  - 키 필드로 잡는 이름: 대소문자 변형, 전각 문자, 영폭 문자, U+0130(`APİKEY`).
  - 설정과 task의 모든 객체는 닫힌 스키마라, 위 이름은 `config has an unknown field`/`invalid_task`로 거부됩니다. 이름과 값은 메시지에 없습니다. 실행이 진행되지 않으므로 우회는 오류 코드와 안내 문구 차이에 그칩니다.

### H2-13 [정보] 그 밖의 관찰

- env 파일을 두 번 읽습니다(`run.ts:95`의 BOM 검사와 `:104` `loadEnvFile`). 그 사이에 바뀔 수 있고, 영향은 BOM 검사 우회뿐입니다.
- task 형식에서 설정의 `policy`와 `verifiers`는 조용히 무시됩니다(문서화됨).
- `--goal`이 `--`로 시작하면 값 누락으로 거부됩니다(사용성).
- `apiBaseUrl`에 `/v1`을 붙이면 `/v1/v1/messages`가 됩니다(J-url).
- 모든 https 호스트를 허용하는 것은 C-5 설계대로입니다. H2-1이 이 설계의 전제(설정 파일은 사용자만 쓴다)를 깹니다.

## 문제 없던 범위 (확인한 것)

- 키 거부 순서: 설정·task 파일을 JSON으로 읽은 직후, 검증보다 먼저 검사합니다.
  - 필드 이름은 대소문자, 전각, 영폭, U+0130 변형을 잡습니다.
  - 값은 키 모양이 문장 안 어디에 있어도, JSON `\u` 이스케이프여도, 필드 이름 안에 있어도 잡습니다. 현재 키(16자 이상) 정확 일치도 잡습니다.
  - 메시지에 값이 없습니다(H2-11 예외).
- 설정·task의 모든 객체가 닫힌 스키마이고, 모르는 필드 이름은 메시지에 없습니다. `__proto__` 키도 모르는 필드로 거부됩니다(코드 판독).
- task 파일로는 `apiBaseUrl`, `requestTimeoutMs`, `maxRetries`를 바꿀 수 없습니다(`parseModel` 허용 필드 판독). anthropic 전용 필드는 scripted에서 거부합니다.
- 우선순위가 계약(C-4~C-6)과 같습니다: `--config`가 `CODARYN_CONFIG`보다, `CODARYN_API_BASE_URL`이 설정보다 우선하고, 빈 값은 미설정으로 봅니다(코드 판독과 기존 유닛).
- `apiBaseUrl` 정규화(J-url):
  - 거부: 사용자 정보, 쿼리, 프래그먼트, `file:`, 비루프백 http, 끝점 `localhost.`, IPv4 매핑 IPv6.
  - 루프백으로 정규화되는 `127.1`과 `0x7f000001`은 허용하며 의도와 맞습니다.
- 한도 숫자 검증(F-limit): 0, 음수, 소수, 문자열 숫자, 2^53 이상, Infinity, -0을 거부합니다. `maxRetries`는 0~10만 받습니다.
- env 파일:
  - 명시했을 때만 읽고, BOM은 거부하고, 오류 메시지에 내용이 없습니다.
  - 실제 `process.loadEnvFile`로 이미 설정된 변수가 이긴다는 것을 확인했습니다(가짜 값).
  - 키는 자식 환경 허용 목록에 없습니다.
- `provider_not_configured`와 `CODARYN_API_BASE_URL` 오류 메시지에 값이 없습니다. 간편 형식 goal은 stdout에 없습니다(H-goal).

## 검토하지 못한 범위

- UNC 경로의 실제 접속과 인증 동작(네트워크 금지로 미실행, H2-5는 코드 판독).
- 심볼릭 링크와 정션으로 설정 파일이 작업 공간을 가리키는 경우(H2-1 권고의 realpath 근거는 추론).
- Windows 장치 이름(`CON`, `NUL`)을 `--config`로 줄 때의 동작, 매우 큰 파일의 메모리 사용.
- `process.loadEnvFile`의 따옴표, 여러 줄, `export` 접두 처리.
- 실제 Anthropic API(미실행).
- worktree는 보안 샌드박스가 아니며, 이 검토는 "안전함"을 보증하지 않습니다.

## 범위 밖 관찰 (PM 배정 판단용)

- 도구 쓰기 금지는 `.codaryn`뿐이라 모델이 `.git/config`, `.git/hooks/*`, `package.json` scripts, 테스트 파일을 고칠 수 있습니다.
- `node --test` 같은 허용 명령과 검증기는 모델이 쓴 코드를 실행합니다. 명령 허용 목록은 실행되는 코드를 제한하지 않습니다.
- H2-1과 같은 계열(검증 기준과 권한의 자기 수정)이므로 작업 공간·정책 담당 검토가 필요합니다.

## PM 판단 필요

1. H2-1·H2-4: 설정·env·task·script 파일이 작업 공간 안에 있으면 거부할지, 경고할지, 쓰기 금지 목록으로 막을지.
2. H2-7: 설정 한도를 상한으로 바꿀지, 계약에 절대 상한을 둘지, anthropic에서 `maxTotalTokens: null`을 금지할지.
3. H2-4: `--env-file`이 설정한 값을 모두 비밀로 등록할지.
4. 수정 담당: `src/cli/**`, `src/contracts/**`는 p1(E1) 소유입니다. H2-8의 제공자 쪽 상한은 `src/model/anthropic/**`, 명령 실행기는 `src/tools/**` 담당입니다.
