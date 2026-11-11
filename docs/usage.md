# Codaryn 사용 안내

Codaryn CLI를 실제 작업에 쓰는 방법이다. 설명은 현재 코드 동작 기준이며 세부 규칙은 [CLI·공통 계약](cli-contract.md)이 기준이다.

> 오프라인 검증(유닛, 프로세스 통합)과 로컬 가짜 서버를 쓴 모의 API 검증만 통과했다. 실제 Anthropic API로는 아직 검증하지 않았다. 처음에는 [실제 호출 점검](#12-실제-호출-점검)부터 한다.

## 1. 요구 사항

- Node.js 26 이상(`package.json`의 `engines`). 검증은 Windows에서 했고 다른 OS는 확인하지 않았다.
- 실제 호출에는 Anthropic API 키와 모델 ID가 필요하다.

## 2. 설치와 빌드

```powershell
npm ci
npm run build                     # dist/ 에 컴파일
node dist/src/cli/main.js run ... # 실행 형식은 6절
```

## 3. 키, 모델, 변수 파일

- 키는 환경 변수 `ANTHROPIC_API_KEY`로만 받는다. Windows 사용자 환경 변수에 등록하거나, 작업 공간 밖의 변수 파일에 적고 `--vars-file <경로>`로 읽는다. 변수 파일은 이 옵션을 줄 때만 읽고 자동으로 찾지 않으며, 이미 설정된 환경 변수가 파일 값보다 우선한다.
- **`--env-file`은 쓰지 않는다.** Node 26이 그 이름을 스스로 먼저 읽는다. 파일이 없으면 CLI가 시작되기 전에 Node 오류(종료 코드 9)로 끝나고, 있으면 Node가 읽은 뒤 CLI가 `invalid_arguments`로 거부한다.
- 변수 파일 만들기: `New-Item -ItemType Directory -Force D:\codaryn-settings`와 `Copy-Item .env.example D:\codaryn-settings\.env`로 만들고 편집기에서 값을 채운다. BOM 없는 UTF-8로 저장한다(BOM이 있으면 `invalid_config`). 메모장의 "UTF-8"은 BOM이 없고, PowerShell 5.1의 `Set-Content -Encoding utf8`은 BOM을 붙인다.
- **변수 파일이 새로 설정한 값은 비밀로 등록되어** 파일 내용, 명령 출력, 기록에 나타나면 가려진다. 예외는 이미 설정돼 있던 변수(Windows는 이름의 대소문자 무시), `CODARYN_MODEL`·`CODARYN_CONFIG`·`CODARYN_API_BASE_URL`, 8자 미만 값이다.
- 키를 task 파일, 설정 파일, 명령줄 인자에 적지 않는다. task·설정 파일에 키 이름의 필드(`apiKey`, `token`, `password` 등)나 Anthropic 키 모양의 값이 있으면 `key_in_file`로 바로 멈춘다. 간편 형식의 `--goal`도 같은 검사를 한다.

| 환경 변수 | 뜻 |
| --- | --- |
| `ANTHROPIC_API_KEY` | API 키 |
| `CODARYN_MODEL` | 모델 ID. 우선순위는 task `model.model` → 이 변수 → 설정 파일 `model`. 코드 기본값은 없다 |
| `CODARYN_CONFIG` | 설정 파일 경로. `--config`가 없을 때 쓴다 |
| `CODARYN_API_BASE_URL` | API 주소. 기본은 공식 주소. `https`만 허용하며 `http`는 루프백 시험용이다 |

키, 모델, 요청당 출력 토큰 상한(`maxOutputTokens`) 중 하나라도 없으면 `provider_not_configured`(종료 코드 7)로 끝나고 아무것도 전송하지 않는다.

## 4. 파일 위치 규칙

- 변수 파일, 설정 파일, task 파일, 대본 파일(scripted 모델), 취소 파일은 **작업 공간 밖**에 둔다. 모델이 작업 공간 안 파일을 고쳐 다음 실행의 API 주소, 정책, 검증기, 한도를 바꾸지 못하게 하기 위해서다.
- 실경로(링크, 정션, 8.3 이름을 푼 경로)가 작업 공간 안이거나 위치를 확인할 수 없으면 실행 전에 거부한다. 변수·설정 파일은 `invalid_config`, task 파일은 `invalid_task`, 대본 파일은 `invalid_script`, 취소 파일은 `invalid_arguments`다.
- 네트워크·장치 경로(UNC `\\server\share`, `\\?\`, `\\.\`, `NUL`·`CON`·`COM1` 같은 장치 이름)는 쓸 수 없다.

## 5. 설정 파일과 task 파일

예시는 [`examples/`](../examples)에 있고 키가 없다. `config.example.json`(모델 자리표시자, 보수적 한도와 재수정 한도, `node --test` 규칙, `test`·`tests` 보호, 테스트 검증기), `doc-task.json`(`workspaces/notes/README.md`에 절 추가, `file_rules` 검증기, 재수정 1회), `code-task.json`(`workspaces/calc`의 실패하는 테스트 수정, `sum.test.mjs` 보호, 재수정 2회).

설정 파일은 `--config` 또는 `CODARYN_CONFIG`로 지정한 것만 읽는다. `schemaVersion`(1)만 필수이고, 모르는 필드나 잘못된 값은 `invalid_config`다.

| 항목 | 뜻 |
| --- | --- |
| `model` | 모델 ID. `<모델 ID>`를 실제 값으로 바꾼다 |
| `maxOutputTokens` | 요청당 출력 토큰 상한(1~200,000) |
| `requestTimeoutMs`, `maxRetries` | HTTP 요청 시간 제한(기본 600000)과 재시도 횟수(0~10, 기본 2) |
| `apiBaseUrl` | API 주소. 보통 비워 둔다 |
| `limits` | 한도의 **상한**. task가 비운 필드에는 이 값을 쓴다 |
| `policy`, `verifiers` | 간편 형식에서만 쓴다. task 파일은 자기 값을 쓴다 |
| `secretEnv` | 비밀로 등록할 환경 변수 이름. task의 것에 더해진다 |

**task 파일 필드:** 모르는 필드가 있으면 `invalid_task`다. task·설정 파일은 BOM이 있어도 읽는다.

- `schemaVersion`(1), `id`(영문·숫자·`.`·`_`·`-`, 1~64자), `goal`(작업 목표), `workflow`(표시용 문자열).
- `workspaceRoot`: task 파일 위치 기준 상대 경로 또는 절대 경로. 도구가 접근할 수 있는 루트는 이 하나뿐이다.
- `model`: `{"provider":"anthropic"}`에 선택 필드 `model`, `maxOutputTokens`. 그리고 `policy`(`protectedPaths` 포함, 11절), `privacy.secretEnv`, `limits`, `verifiers`.

**한도(`limits`):**

- 예산 한도 넷은 재수정을 포함한 실행 전체에 적용한다: `maxModelTurns`, `maxToolCalls`, `maxTotalTokens`(모든 요청의 입력과 출력 토큰 합), `maxDurationMs`. 처음에는 낮게 두고 결과의 `usage`를 보며 올린다.
- 재수정 한도 둘(7절): `maxRepairAttempts`(0 이상, 기본 0)와 `maxSameFailures`(1 이상, 기본 2). 두 파일 모두에서 생략할 수 있다.
- **설정 파일의 한도는 상한이다.** task는 필드마다 그 값 이하만 정할 수 있고, 넘으면 `invalid_task`다. 설정이 숫자인데 task가 `maxTotalTokens: null`을 주어도 `invalid_task`다. 예산 한도가 어디에도 없으면 task 형식은 `invalid_task`, 간편 형식은 `invalid_config`다.
- **anthropic에서는 총 토큰 한도가 필수다.** `maxTotalTokens: null`은 task에 있으면 `invalid_task`, 설정에 있으면 `invalid_config`다.
- **절대 상한(코드):** 턴 1000, 도구 호출 5000, 총 토큰 50,000,000, 실행 시간 86,400,000ms(24시간), `maxRepairAttempts` 20, `maxSameFailures` 10. 넘으면 그 값을 적은 파일의 오류다.
- 다른 시간 값(`requestTimeoutMs`, 검증기 `timeoutMs`)은 2,147,483,647ms 이하다. 모델이 `run_command`에 주는 `timeoutMs`는 600000ms 이하이며, 넘으면 그 호출이 `invalid_args`로 거부된다.

**검증기(`verifiers`):** `command`(`executable`, `args`, 선택 `cwd`, `timeoutMs` 기본 60000, `expectExitCode` 기본 0)와 `file_rules`(`exists`, `absent`, `contains`, `not_contains`). 모든 검증기가 통과해야 `done`이다. 모델의 완료 선언만으로는 성공하지 않고, 검증기가 없으면 `needs-input`으로 끝난다.

## 6. 실행

```powershell
# 간편 형식: 정책·한도·검증기는 설정 파일에서, 제공자는 항상 anthropic
node dist/src/cli/main.js run --workspace D:\work\notes --goal "README에 설치 절을 추가한다" `
  --config D:\codaryn-settings\config.json --vars-file D:\codaryn-settings\.env
# task 파일 형식 (task 파일도 작업 공간 밖에 둔다)
node dist/src/cli/main.js run --task D:\codaryn-settings\tasks\fix-sum.json `
  --config D:\codaryn-settings\config.json --vars-file D:\codaryn-settings\.env
```

- 예시를 직접 돌릴 때는 `examples` 폴더를 다른 곳에 복사한 뒤 그 사본의 task를 실행한다. 모델이 예시 파일을 실제로 고치고, 작업 공간에 `.codaryn/`가 생긴다.
- 옵션은 `--config`, `--vars-file`, `--cancel-file`이다. `--task`와 간편 형식은 함께 쓸 수 없다.
- 취소는 Ctrl+C로 하거나, `--cancel-file`로 지정한 파일(작업 공간 밖)을 만들어서 한다. 상태는 `cancelled`(5)가 되고 이미 적용한 변경은 남는다.
- 모델은 허용 명령 목록을 따로 받지 않는다. 실행할 명령을 `goal`에 정확히 적는다(예: `code-task.json`).

## 7. 재수정 반복

모델이 도구 호출 없이 답하면 검증기를 모두 한 번 실행한다(한 회차). 실패하면 그 근거를 모델에 돌려보내 다시 고치게 할 수 있다. `maxRepairAttempts`가 0(기본)이면 첫 실패에서 끝난다. 판정은 아래 표의 위에서 아래 순서다.

| 회차 결과 | 결과 |
| --- | --- |
| 모두 `pass` | `done`/`verified` |
| `fail` 없이 `inconclusive`가 있음 | `needs-input`/`verifier_inconclusive`. 재수정하지 않는다 |
| `fail`과 `inconclusive`가 함께 있음 | `failed`/`verifier_failed`. 재수정하지 않는다 |
| `fail`만 있음, 재수정을 `maxRepairAttempts`번 다 씀 | `failed`/`verifier_failed` |
| `fail`만 있음, 같은 실패가 `maxSameFailures`번 연속 | `failed`/`repeated_failure` |
| `fail`만 있음, 그 밖 | 재수정 |

- **같은 실패:** 실패한 검증기의 id, 결과, 근거가 직전 회차와 같으면 같은 실패다. 근거 속 숫자(연속한 숫자와 소수)는 비교에서 무시하므로 실행 시간이나 실패 개수만 다르면 같은 실패다. 테스트 이름이나 메시지 단어가 바뀌면 다른 실패다. `maxSameFailures`가 1이면 어떤 실패도 재수정하지 않는다.
- **예시**(`maxRepairAttempts` 2, `maxSameFailures` 2). 어느 회차든 모두 통과하면 `done`이다.
  - 1회차 실패 A → 재수정 1. 2회차도 실패 A → `failed`/`repeated_failure`.
  - 2회차가 다른 실패 B → 재수정 2. 3회차가 실패 → 재수정 횟수를 다 써서 `failed`/`verifier_failed`.
- 재수정 메시지에는 실패한 검증기의 id, 결과, 가린 근거가 들어간다. 근거는 검증기마다 8192바이트, 메시지 전체 8192바이트 안에서 앞뒤를 남기고 가운데를 생략한다.
- 재수정 전에 다음 모델 호출이 예산 한도 안인지 확인하고, 아니면 그 한도로 `budget-exhausted`다. 검증 도중 실행 시간 한도가 지나도 `budget-exhausted`/`max_duration`이다. 기록에는 `repair_started`(`attempt`, `failedVerifiers`, `feedbackTruncated`)가 남는다. 결과의 `verifiers`는 마지막 회차, `usage.repairAttempts`는 시작한 재수정 수다.
- **주의:** 명령형 검증기는 모델이 고친 코드를 실행한다(예: `node --test`). 재수정을 켜면 그 출력(가린 뒤)이 모델에 돌아간다. 명령 허용 목록이 비어 있어도 마찬가지다. 모델이 쓴 코드를 실행해도 되는 작업 공간에서만 켠다. `file_rules`만 쓰는 문서 작업은 코드를 실행하지 않는다.

## 8. 결과 읽기

stdout에는 JSON 한 줄만 나온다.

- **실행이 시작되었으면 `kind:"run"`:** `runId`, `status`, `reason`, `exitCode`, `journalPath`, `notices`, `verifiers`(검증기별 `outcome`, `evidence`, `checked`, `limits`), `changes`(적용한 파일 변경과 해시), `usage`(턴, 도구 호출, 토큰, 시간, 재수정 수).
- **되돌리기는 `kind:"revert"`**(9절). **시작 전에 멈췄으면 `kind:"error"`:** `code`, `exitCode`, `message`. 메시지에는 값 대신 필드 이름만 적힌다.

| 종료 코드 | 뜻 |
| --- | --- |
| 0 | `done`: 모든 검증기 통과. 되돌리기 `complete` |
| 1 | `failed`: `verifier_failed`, `repeated_failure`, `model_error` |
| 2 | 입력 오류: `invalid_arguments`, `invalid_task`, `invalid_config`, `invalid_script`, `key_in_file`, `secret_env_missing`, `workspace_not_found`, `run_not_found`, `invalid_run_record` |
| 3 | `needs-input`: `no_verifier`, `verifier_inconclusive`, `unknown_tool_outcome`. 되돌리기 `partial` |
| 4 | `budget-exhausted`: `max_model_turns`, `max_tool_calls`, `max_total_tokens`, `max_duration`, `usage_unknown` |
| 5 | `cancelled` |
| 6 | `workspace_locked`: 같은 작업 공간에서 다른 실행이나 되돌리기가 진행 중 |
| 7 | `provider_not_configured`: 키·모델·출력 상한 미설정. 전송 없음 |
| 70 | `internal_error` |

작업 공간의 `.codaryn/` 폴더:

- `runs/<runId>/journal.jsonl`: 한 줄에 사건 하나. `run_started`, `model_request`, `model_response`, `model_error`, `tool_decision`, `tool_result`, `file_changed`, `verifier_result`, `repair_started`, `run_finished`. 가림본만 담는다.
- `runs/<runId>/result.json`: stdout과 같은 객체.
- `runs/<runId>/snapshots/`: 실행이 파일 도구로 바꾼 파일의 변경 전 원문(9절). **가림본이 아니다.**
- `lock.json`: 실행 중 잠금. 기록된 프로세스가 이미 끝났으면 다음 실행이 회수한다.

도구는 `.codaryn/` 안을 읽거나 쓸 수 없다. 거부된 도구 호출은 `tool_result`의 `errorCode`(`policy_denied`, `protected_span_violation`, `conflict` 등)와 `tool_decision`의 `code`(`protected_path` 등)로 남는다.

## 9. 되돌리기

```powershell
node dist/src/cli/main.js revert --workspace D:\work\notes --run 20261112T031500Z-9f2c41ab
```

- `--run`에는 실행 결과의 `runId`를 준다. 두 옵션 모두 필요하다.
- **대상:** 그 실행이 파일 도구(`write_file`)로 바꾼 파일. 현재 파일이 실행이 남긴 상태와 같을 때만 원래 바이트로 복원하고(`restored`), 실행이 새로 만든 파일은 지운다(`deleted`).
- **건너뛴 이유(`skipped[].reason`):** 한 파일의 실패는 나머지를 막지 않는다.
  - `changed_since_run`: 실행 뒤 파일이 다시 바뀌었거나 없어졌다. 같은 실행을 두 번 되돌릴 때도 이렇게 나온다.
  - `missing_snapshot`: 원문이 없다. 경로에 등록된 비밀이 든 파일도 여기에 해당한다.
  - `missing_record`: 원문은 있는데 기록에 변경이 없다(실행이 그 사이에 멈춤). 이 경로는 가리지 않은 경로다.
  - `io_error`: 그 파일을 읽거나 쓰지 못했다.
- **결과:** 건너뛴 파일이 없으면 `complete`(종료 0), 하나라도 있으면 `partial`(종료 3). **오류:** 그 runId의 기록이 없으면 `run_not_found`, 기록을 읽을 수 없으면 `invalid_run_record`, 실행 중이면 `workspace_locked`다. 이때는 아무것도 바꾸지 않는다.
- **되돌리지 않는 것:** 명령(`run_command`, 명령형 검증기)이 바꾼 파일. 그래서 작업 공간은 Git 커밋이나 사본으로도 보존한다.
- **스냅샷:** `<작업 공간>\.codaryn\runs\<runId>\snapshots\`에 변경 전 원문 그대로 남아 비밀이 들어 있을 수 있다. 파일 도구로는 닿지 않지만 허용한 명령은 읽을 수 있고, 자동으로 지우지 않는다. 되돌릴 필요가 없어진 실행은 폴더째 지운다(예: `Remove-Item -Recurse -Force D:\work\notes\.codaryn\runs\<runId>`).

## 10. 비밀 등록과 가려지는 범위

- `privacy.secretEnv`(task)나 `secretEnv`(설정)에는 환경 변수 **이름**만 적는다. 값은 실행할 때 환경에서 읽는다(`--vars-file`로 읽은 값 포함). 값이 없으면 `secret_env_missing`이다.
- API 키와 변수 파일이 새로 설정한 값(3절)은 자동으로 비밀로 등록된다.
- **가리는 범위:** 모델에 보내는 내용과 실행 기록 전체. 목표, 파일 내용, 경로, 명령 출력, 검증 근거, 오류 문구가 모두 해당한다.
- **가리는 형태:** 원문, Base64(패딩 유무, URL 문자 집합), URL 인코딩(대·소문자), JSON 이스케이프, 16진(대·소문자), 여러 줄 비밀의 LF와 CRLF 표기. 가려진 자리는 토큰으로 보이고, 대응표는 실행 중 메모리에만 있다.
- 비밀이 든 줄을 모델이 고치거나 옮기는 변경은 전체가 거부된다(`protected_span_violation`). 다른 줄은 고칠 수 있다.
- 실행하는 명령의 환경에는 `PATH`, `PATHEXT`, `SYSTEMROOT`, `WINDIR`, `COMSPEC`, `TEMP`, `TMP`, `TMPDIR`, `HOME`, `USERPROFILE`, `LANG`만 넘어간다. 키는 넘어가지 않고, 값에 등록된 비밀이 든 변수도 넘기지 않는다.

## 11. 권한 정책

```json
"policy": { "commands": [{ "executable": "node", "argsPrefix": ["--test"], "allowExtraArgs": false }],
            "network": "deny", "destructive": "deny", "restorePathTokens": false,
            "protectedPaths": ["tests"] }
```

- **`executable`:** 모델이 요청한 문자열과 정확히 같아야 허용된다. 실행 방식은 아래 "Windows 실행 규칙"이다.
- **`allowExtraArgs: false`(권장):** 인자가 `argsPrefix`와 정확히 같을 때만 허용한다. `true`면 접두가 같을 때 뒤의 인자를 무엇이든 허용하며, 그 인자 속 경로는 검사하지 않는다.
- **규칙 작성 요령:** 필요한 명령마다 규칙을 하나씩 만들고 인자까지 고정한다(예: `["--test"]`). `node -e`처럼 임의 코드를 실행하는 형태는 넣지 않는다.
- **`network`, `destructive`:** `"deny"`만 있다. 네트워크 도구가 없다는 뜻일 뿐이며, 허용한 명령의 네트워크 사용을 막지는 않는다. **`restorePathTokens`**(경로 인자 속 토큰을 원래 값으로 바꿔 쓸지)는 보통 `false`로 둔다.
- **파일 접근:** 경로는 `workspaceRoot` 안만 허용한다. 링크를 따라 밖으로 나가는 경로는 거부한다. **검증기 명령**은 사용자가 정한 것이므로 이 허용 목록과 따로 실행된다.

**보호 경로(`protectedPaths`):** 작업 공간 기준 상대 경로 목록이다. 그 아래에 대한 파일 도구의 쓰기를 거부한다(`tool_decision.code`가 `protected_path`). 읽기와 검색은 된다.

- **권고:** 테스트와 검증 설정을 보호한다. 테스트 폴더, 테스트 파일, 검증기가 읽는 설정 파일(예: `npm test`를 쓴다면 `package.json`)이 대상이다. 모델이 테스트를 고쳐 검증을 통과시키는 길을 막는다.
- 경로 조각 단위로 비교한다. `tests`는 `tests/a.ts`를 덮고 `tests2`는 덮지 않는다. `.`은 작업 공간 전체다. Windows에서는 대소문자를 무시한다.
- 링크를 푼 경로로 비교한다. 항목이 작업 공간 밖을 가리키는 링크(끊긴 링크 포함)이면 모든 쓰기를 거부한다.
- task 파일이나 설정 파일(간편 형식)만 정할 수 있고 모델은 풀 수 없다. 절대 경로, `..`, 빈 값, Windows 파일 이름이 될 수 없는 값은 task에서 `invalid_task`, 설정에서 `invalid_config`다.
- **한계:** 파일 도구만 막는다. 허용한 명령과 명령형 검증기는 보호 경로의 파일도 바꿀 수 있다. 명령 허용 목록을 좁게 두고, `file_rules` 검증기(예: `code-task.json`의 `test-kept`)와 결과의 `changes`로 함께 확인한다.

**Windows 실행 규칙:** 도구 명령과 검증기 명령에 똑같이 적용한다.

- 이름은 자식에게 넘기는 `PATH`와 `PATHEXT`로 찾는다. 작업 디렉터리와 상대 `PATH` 항목은 찾지 않는다. `.exe`, `.com`, `.cmd`, `.bat`만 실행한다.
- **작업 공간 안으로 풀리는 실행 파일과 스크립트는 실행하지 않는다**(`spawn_failed`, 사유 `executable_refused`·`script_refused`). 경로로 부르든 `PATH`로 찾든 같다.
- `.exe`·`.com`은 셸 없이 실행한다. `.cmd`·`.bat`은 `cmd.exe /d /s /c`로 실행하되 다음을 모두 만족할 때만 실행하고, 아니면 `script_refused`다.
  - 모든 인자가 영문, 숫자, `_ - . : / \ = + @ ~ #`만으로 이루어져 있다. 공백, 따옴표, `& | < > ^ % ! ( )`, 쉼표, 세미콜론, `*`, `?`, 한글 등 ASCII 밖 문자, 빈 인자는 안 된다.
  - 스크립트의 실경로가 `C:\...` 형태이고 영문, 숫자, 공백, `_ - . \ = + @ ~ #`만 쓴다.
- 정책 판정은 모델이 요청한 이름(예: `npm`)으로 한다. 이 규칙은 가짜 `.cmd`로 검증했고, 실제 `npm` 실행은 점검하지 않았다.

## 12. 실제 호출 점검

자세한 내용은 [tests/live/README.md](../tests/live/README.md)를 본다. 키는 미리 사용자 환경 변수에 등록해 둔다(이 점검은 변수 파일을 쓰지 않는다).

```powershell
npm run build
$env:CODARYN_LIVE = "1"
$env:CODARYN_MODEL = "<모델 ID>"
node --test dist/tests/live/anthropic-live.js
```

- 임시 폴더 문서에 절 하나를 추가하는 작업을 실행하고 `done`인지, stdout·stderr·기록에 키가 없는지 확인한다. 세 변수 중 하나라도 없으면 아무것도 보내지 않고 "건너뜀"으로 끝난다. 고정 상한: 턴 4, 도구 호출 4, 출력 1024토큰/요청, 총 30000토큰, 3분, HTTP 요청 최대 8건.

## 13. 투입 전 점검표

- [ ] 12절 실제 호출 점검을 **먼저** 실행했고 `done`이다.
- [ ] 처음 몇 번은 중요하지 않은 저장소(사본, 연습용)에서 실행한다.
- [ ] `npm run build`가 성공하고 Node 26 이상이다.
- [ ] 키가 사용자 환경 변수나 변수 파일(BOM 없음, `--vars-file`)에만 있고, 변수·설정·task 파일이 작업 공간 밖에 있다.
- [ ] 작업 공간이 Git으로 커밋되어 있거나 사본이다. `revert`는 파일 도구의 변경만 되돌린다.
- [ ] `protectedPaths`로 테스트와 검증 설정을 보호했다.
- [ ] 명령 허용 목록이 필요한 명령만 담고 `allowExtraArgs`가 `false`다.
- [ ] 작업 공간 안의 비밀 값을 `secretEnv`로 등록했다.
- [ ] 검증기가 성공 조건을 실제로 확인한다(테스트 명령, 파일 규칙).
- [ ] 재수정은 모델이 쓴 코드를 실행해도 되는 작업 공간에서만 켰다.
- [ ] 한도를 낮게 시작했다. 실행 뒤 `changes`와 `journal.jsonl`을 확인하고, 필요 없어진 실행 폴더를 지운다.

## 14. 알려진 한계

- **검증기와 재수정:** 재수정을 켜면 명령형 검증기가 모델이 쓴 코드를 실행하고 그 출력(가린 뒤)이 모델에 돌아간다. 명령 허용 목록이 비어 있어도 마찬가지다.
- **OS 격리 없음:** 허용한 명령과 검증기 명령은 사용자 권한으로 실행된다. 작업 공간 밖 파일 접근과 네트워크 사용을 OS 수준에서 막지 않는다.
- **비밀이 든 줄:** 수정, 이동, 삭제할 수 없다. 사람이 직접 고친다. 그 줄 앞뒤의 다른 줄을 바꿔 여러 줄에 걸친 식의 의미가 달라지는 것은 막지 못한다.
- **남는 자손 프로세스:** 명령이 끝난 뒤에도 분리되어 떠 있는 자손 프로세스(예: 백그라운드로 띄운 서버)는 남을 수 있다.
- **스냅샷:** 원문이라 비밀이 있을 수 있고, 실행된 명령이 읽을 수 있다. 보관 기간 관리가 없으므로 직접 지운다.
- **보호 경로:** 파일 도구만 막는다. 명령으로 고치는 것은 막지 못한다.
- **되돌리기:** 명령이 바꾼 파일은 대상이 아니다. 실행 중 다른 프로그램이 같은 파일을 바꾸면 스냅샷이 실제 실행 전 상태와 다를 수 있다.
- **같은 실패 판정:** 숫자만 바뀌는 진전(실패 3건 → 1건)도 같은 실패로 보아 `maxSameFailures`에서 멈춘다. 임시 경로처럼 숫자가 아닌 내용이 매번 바뀌면 다른 실패로 보아 `maxRepairAttempts`와 예산 한도만 반복을 멈춘다.
- **가림의 빈틈:** 10절 목록 밖의 변형, 다른 값과 함께 인코딩된 Base64, UTF-16·CP949 출력은 가려지지 않는다. 출력 끝에서 4096바이트보다 긴 변형이 잘리면 일부가 남을 수 있다. 아주 짧은 비밀이나 변수 파일의 흔한 값(예: `postgres`)은 엉뚱한 곳까지 가릴 수 있다.
- **파일 해시 노출:** 파일 해시가 모델과 기록에 남는다. 짧은 비밀이 든 파일은 추측 검증이 가능하다.
- **쓰기 경합:** 해시 비교와 파일 교체 사이에 다른 프로그램이 쓰면 그 변경을 덮어쓸 수 있다.

## 15. 문제 해결

| 코드 | 뜻과 조치 |
| --- | --- |
| `invalid_arguments` | 옵션 오류. 같은 옵션 반복, 모르는 옵션, `--env-file`, `--workspace`·`--goal` 한쪽만, 작업 공간 안의 취소 파일 |
| Node 오류, 종료 9 | `--env-file`의 파일이 없다. `--vars-file`로 바꾼다 |
| `invalid_task`, `invalid_config` | 메시지의 필드를 고친다. 설정 상한보다 큰 task 한도, anthropic의 `maxTotalTokens: null`, 작업 공간 안의 파일, 변수 파일의 BOM도 여기다 |
| `key_in_file` | task·설정 파일이나 `--goal`에서 키 필드나 키 값을 지우고 환경 변수로 옮긴다 |
| `secret_env_missing` | `secretEnv`에 적은 환경 변수가 없다 |
| `workspace_not_found` | `workspaceRoot`나 `--workspace`가 있는 디렉터리가 아니다 |
| `workspace_locked` | 다른 실행이나 되돌리기가 끝나기를 기다린다 |
| `provider_not_configured` | 메시지에 적힌 항목(키, 모델, `maxOutputTokens`)을 설정한다 |
| `failed`/`model_error` | 기록의 `model_error.kind`를 본다. `auth_failed`는 키 확인, `rate_limited`·`overloaded`는 잠시 뒤 재시도, `timeout`은 `requestTimeoutMs` 확인 |
| `failed`/`repeated_failure` | 같은 실패가 반복됐다. 근거를 보고 목표나 검증기를 고친다 |
| `needs-input`/`no_verifier` | 검증기를 추가한다 |
| `budget-exhausted` | `reason`의 한도를 올리거나(설정 상한 이내) 목표를 작게 나눈다 |
| `run_not_found` | 그 작업 공간에 그 runId의 기록이 없다. 경로와 runId를 확인한다 |
| 도구 `policy_denied` | 명령이나 경로가 정책 밖이거나 보호 경로 쓰기다. `tool_decision.code`를 본다 |
| 도구 `invalid_args` | 인자 형식 오류. `run_command.timeoutMs`가 600000을 넘는 경우도 여기다 |
| 도구 `spawn_failed` | `PATH`에서 찾지 못함(`ENOENT`), 지원하지 않는 형식, 작업 공간 안의 실행 파일(`executable_refused`)이나 스크립트·허용 문자 밖 인자(`script_refused`) |
