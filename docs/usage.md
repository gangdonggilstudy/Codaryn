# Codaryn 사용 안내

Codaryn CLI를 실제 작업에 쓰는 방법이다. 설명은 현재 코드 동작 기준이며 세부 규칙은 [CLI·공통 계약](cli-contract.md)이 기준이다.

> 실제 Anthropic API로는 아직 검증하지 않았다. 오프라인 검증과 모의 API 검증만 통과했다. 처음에는 [실제 호출 점검](#8-실제-호출-점검)부터 한다.

## 1. 요구 사항

- Node.js 26 이상(`package.json`의 `engines`). 새 런타임 의존성은 없다.
- 검증은 Windows에서 했다. 다른 OS에서의 동작은 확인하지 않았다.
- 실제 호출에는 Anthropic API 키와 모델 ID가 필요하다.

## 2. 설치와 빌드

```powershell
npm ci
npm run build                     # dist/ 에 컴파일
node dist/src/cli/main.js run ... # 실행 형식은 4절
```

## 3. 키와 모델 설정

- 키는 환경 변수 `ANTHROPIC_API_KEY`로만 받는다. 두 가지 방법 중 하나를 쓴다.
  - Windows 사용자 환경 변수에 등록한다.
  - `.env`에 적고 `--env-file .env`로 읽는다.
- 키를 task 파일, 설정 파일, 명령줄 인자에 적지 않는다. task·설정 파일에 키 이름의 필드(`apiKey`, `token`, `password` 등)나 Anthropic 키 모양의 값이 있으면 `key_in_file`로 바로 멈춘다.
- `.env` 만들기:
  - `Copy-Item .env.example .env` 후 편집기에서 값을 채운다. `.env`는 Git이 무시한다.
  - BOM 없는 UTF-8로 저장한다. BOM이 있으면 `invalid_config`다. 메모장의 "UTF-8"은 BOM이 없다. PowerShell 5.1의 `Set-Content -Encoding utf8`은 BOM을 붙이므로 쓰지 않는다.
- `.env`는 `--env-file`을 줄 때만 읽고 자동으로 찾지 않는다. 이미 설정된 환경 변수가 파일 값보다 우선한다.
- 환경 변수:

| 이름 | 뜻 |
| --- | --- |
| `ANTHROPIC_API_KEY` | API 키 |
| `CODARYN_MODEL` | 모델 ID. 우선순위는 task `model.model` → 이 변수 → 설정 파일 `model`. 코드 기본값은 없다 |
| `CODARYN_CONFIG` | 설정 파일 경로. `--config`가 없을 때 쓴다 |
| `CODARYN_API_BASE_URL` | API 주소. 기본은 공식 주소. `https`만 허용하며 `http`는 루프백 시험용이다 |

키, 모델, 요청당 출력 토큰 상한(`maxOutputTokens`) 중 하나라도 없으면 `provider_not_configured`(종료 코드 7)로 끝나고 아무것도 전송하지 않는다.

## 4. 설정 파일과 task 파일

예시는 [`examples/`](../examples)에 있고 키가 없다. `config.example.json`(모델 자리표시자, 보수적 한도, `node --test` 규칙, 테스트 검증기), `doc-task.json`(`workspaces/notes/README.md`에 절 추가), `code-task.json`(`workspaces/calc`의 실패하는 테스트 수정).

설정 파일은 `--config` 또는 `CODARYN_CONFIG`로 지정한 것만 읽는다. `schemaVersion`(1)만 필수이고, 모르는 필드나 잘못된 값은 `invalid_config`다.

| 항목 | 뜻 |
| --- | --- |
| `model` | 모델 ID. `<모델 ID>`를 실제 값으로 바꾼다 |
| `maxOutputTokens` | 요청당 출력 토큰 상한(양의 정수) |
| `requestTimeoutMs`, `maxRetries` | HTTP 요청 시간 제한(기본 600000)과 재시도 횟수(0~10, 기본 2) |
| `apiBaseUrl` | API 주소. 보통 비워 둔다 |
| `limits` | 기본 한도. task의 `limits`가 필드마다 우선한다 |
| `policy`, `verifiers` | 간편 형식에서만 쓴다. task 파일은 자기 값을 쓴다 |
| `secretEnv` | 비밀로 등록할 환경 변수 이름. task의 것에 더해진다 |

**task 파일 필드:** 모르는 필드가 있으면 `invalid_task`다. task·설정 파일은 BOM이 있어도 읽는다.

- `schemaVersion`(1), `id`(영문·숫자·`.`·`_`·`-`, 1~64자), `goal`(작업 목표), `workflow`(표시용 문자열).
- `workspaceRoot`: task 파일 위치 기준 상대 경로 또는 절대 경로. 도구가 접근할 수 있는 루트는 이 하나뿐이다.
- `model`: `{"provider":"anthropic"}`에 선택 필드 `model`, `maxOutputTokens`. 그리고 `policy`, `privacy.secretEnv`, `limits`, `verifiers`.

**한도(`limits`):** `maxModelTurns`, `maxToolCalls`, `maxTotalTokens`(`null`이면 제한 없음), `maxDurationMs`. 어디에도 정해지지 않은 필드가 있으면 task 형식은 `invalid_task`, 간편 형식은 `invalid_config`다. 토큰 한도는 모든 요청의 입력과 출력 토큰을 더한 값과 비교한다. 처음에는 낮게 두고 결과의 `usage`를 보며 올린다.

**검증기(`verifiers`):** `command`(`executable`, `args`, 선택 `cwd`, `timeoutMs` 기본 60000, `expectExitCode` 기본 0)와 `file_rules`(`exists`, `absent`, `contains`, `not_contains`). 모든 검증기가 통과해야 `done`이다. 모델의 완료 선언만으로는 성공하지 않고, 검증기가 없으면 `needs-input`으로 끝난다.

## 5. 실행

```powershell
# 간편 형식: 정책·한도·검증기는 설정 파일에서, 제공자는 항상 anthropic
node dist/src/cli/main.js run --workspace D:\work\notes --goal "README에 설치 절을 추가한다" `
  --config D:\codaryn\config.json --env-file .env

# task 파일 형식
node dist/src/cli/main.js run --task D:\codaryn\tasks\fix-sum.json --config D:\codaryn\config.json --env-file .env
```

- 예시를 직접 돌릴 때는 `examples` 폴더를 다른 곳에 복사한 뒤 그 사본의 task를 실행한다. 모델이 예시 파일을 실제로 고치고, 작업 공간에 `.codaryn/`가 생긴다.
- 옵션은 `--config`, `--env-file`, `--cancel-file`이다. `--task`와 간편 형식은 함께 쓸 수 없다.
- 취소는 Ctrl+C로 하거나, `--cancel-file`로 지정한 파일을 만들어서 한다. 상태는 `cancelled`(5)가 되고 이미 적용한 변경은 남는다.
- 모델은 허용 명령 목록을 따로 받지 않는다. 실행할 명령을 `goal`에 정확히 적는다(예: `code-task.json`).

## 6. 결과 읽기

stdout에는 JSON 한 줄만 나온다.

- **실행이 시작되었으면 `kind:"run"`:**
  - `status`, `reason`, `exitCode`.
  - `verifiers`: 검증기별 `outcome`, `evidence`, `checked`, `limits`.
  - `changes`: 적용한 파일 변경과 해시.
  - `usage`: 턴, 도구 호출, 토큰, 시간.
  - `journalPath`, `notices`.
- **시작 전에 멈췄으면 `kind:"error"`:** `code`, `exitCode`, `message`. 메시지에는 값 대신 필드 이름만 적힌다.

| 종료 코드 | 뜻 |
| --- | --- |
| 0 | `done`: 모든 검증기 통과 |
| 1 | `failed`: 검증기 실패(`verifier_failed`) 또는 모델 오류(`model_error`) |
| 2 | 입력 오류: `invalid_arguments`, `invalid_task`, `invalid_config`, `key_in_file`, `secret_env_missing`, `workspace_not_found` 등 |
| 3 | `needs-input`: `no_verifier`, `verifier_inconclusive`, `unknown_tool_outcome` |
| 4 | `budget-exhausted`: `max_model_turns`, `max_tool_calls`, `max_total_tokens`, `max_duration`, `usage_unknown` |
| 5 | `cancelled` |
| 6 | `workspace_locked`: 같은 작업 공간에서 다른 실행이 진행 중 |
| 7 | `provider_not_configured`: 키·모델·출력 상한 미설정. 전송 없음 |
| 70 | `internal_error` |

작업 공간의 `.codaryn/` 폴더:

- `runs/<runId>/journal.jsonl`: 한 줄에 사건 하나. 사건 종류는 `run_started`, `model_request`, `model_response`, `model_error`, `tool_decision`, `tool_result`, `file_changed`, `verifier_result`, `run_finished`. 가림본만 담는다.
- `runs/<runId>/result.json`: stdout과 같은 객체.
- `lock.json`: 실행 중 잠금. 기록된 프로세스가 이미 끝났으면 다음 실행이 회수한다.

도구는 `.codaryn/` 안을 읽거나 쓸 수 없다. 거부된 도구 호출은 `tool_result`의 `errorCode`(`policy_denied`, `protected_span_violation`, `conflict` 등)로 남는다.

## 7. 비밀 등록과 가려지는 범위

- `privacy.secretEnv`(task)나 `secretEnv`(설정)에는 환경 변수 **이름**만 적는다. 값은 실행할 때 환경에서 읽는다(`--env-file`로 읽은 값 포함). 값이 없으면 `secret_env_missing`이다.
- API 키는 자동으로 비밀로 등록된다.
- **가리는 범위:** 모델에 보내는 내용과 실행 기록 전체. 목표, 파일 내용, 경로, 명령 출력, 오류 문구가 모두 해당한다.
- **가리는 형태:** 원문, Base64(패딩 유무, URL 문자 집합), URL 인코딩(대·소문자), JSON 이스케이프, 16진(대·소문자), 여러 줄 비밀의 LF와 CRLF 표기.
- 가려진 자리는 토큰으로 보인다. 대응표는 실행 중 메모리에만 있다.
- 비밀이 든 줄을 모델이 고치거나 옮기는 변경은 전체가 거부된다(`protected_span_violation`). 다른 줄은 고칠 수 있다.
- 실행하는 명령의 환경에는 `PATH`, `PATHEXT`, `SYSTEMROOT`, `WINDIR`, `COMSPEC`, `TEMP`, `TMP`, `TMPDIR`, `HOME`, `USERPROFILE`, `LANG`만 넘어간다. 키는 넘어가지 않는다.

## 8. 권한 정책

```json
"policy": { "commands": [{ "executable": "node", "argsPrefix": ["--test"], "allowExtraArgs": false }],
            "network": "deny", "destructive": "deny", "restorePathTokens": false }
```

- **`executable`:** 모델이 요청한 문자열과 정확히 같아야 허용된다. 셸 없이 실행한다.
- **`allowExtraArgs: false`(권장):** 인자가 `argsPrefix`와 정확히 같을 때만 허용한다. `true`면 접두가 같을 때 뒤의 인자를 무엇이든 허용하며, 그 인자 속 경로는 검사하지 않는다.
- **규칙 작성 요령:** 필요한 명령마다 규칙을 하나씩 만든다. 인자까지 고정한다(예: `["--test"]`). `node -e`처럼 임의 코드를 실행하는 형태는 넣지 않는다.
- **`network`, `destructive`:** `"deny"`만 있다. 네트워크 도구가 없다는 뜻일 뿐이며, 허용한 명령의 네트워크 사용을 막지는 않는다.
- **`restorePathTokens`:** 경로 인자 속 토큰을 원래 값으로 바꿔 쓸지 여부다. 보통 `false`로 둔다.
- **파일 접근:** 경로는 `workspaceRoot` 안만 허용한다. 링크를 따라 밖으로 나가는 경로는 거부한다.
- **검증기 명령:** 사용자가 정한 것이므로 이 허용 목록과 따로 실행된다.

## 9. 실제 호출 점검

자세한 내용은 [tests/live/README.md](../tests/live/README.md)를 본다. 키는 미리 사용자 환경 변수에 등록해 둔다.

```powershell
npm run build
$env:CODARYN_LIVE = "1"
$env:CODARYN_MODEL = "<모델 ID>"
node --test dist/tests/live/anthropic-live.js
```

- 임시 폴더 문서에 절 하나를 추가하는 작업을 실행하고 `done`인지 확인한다.
- 고정 상한: 턴 4, 도구 호출 4, 출력 1024토큰/요청, 총 30000토큰, 3분, HTTP 요청 최대 8건.
- stdout, stderr, 기록에 키가 남지 않았는지 검사한다.
- 세 변수 중 하나라도 없으면 아무것도 보내지 않고 "건너뜀"으로 끝난다.

## 10. 투입 전 점검표

- [ ] `npm run build`가 성공하고 Node 26 이상이다.
- [ ] 키가 사용자 환경 변수나 `.env`(BOM 없음)에만 있다. task·설정 파일과 명령 기록에는 없다.
- [ ] 9절 실제 호출 점검이 `done`이다.
- [ ] 작업 공간이 Git으로 커밋되어 있거나 사본이다. Codaryn에는 되돌리기 명령이 없다.
- [ ] 작업 공간 안의 비밀 값을 `secretEnv`로 등록했다.
- [ ] 명령 규칙이 필요한 것만 담고 `allowExtraArgs`가 `false`다.
- [ ] 검증기가 성공 조건을 실제로 확인한다(테스트 명령, 파일 규칙).
- [ ] 한도를 낮게 시작했다. 실행 뒤 `changes`와 `journal.jsonl`을 확인한다.

## 11. 알려진 한계

- **비밀이 든 줄:** 수정, 이동, 삭제할 수 없다. 사람이 직접 고친다.
- **보호 줄 주변:** 그 줄 앞뒤의 다른 줄을 바꿔 여러 줄에 걸친 식의 의미가 달라지는 것은 막지 못한다.
- **OS 격리 없음:** 허용한 명령은 사용자 권한으로 실행된다. 작업 공간 밖 파일 접근과 네트워크 사용을 OS 수준에서 막지 않는다.
- **목록 밖 변형:** 7절 목록 밖의 변형, 다른 값과 함께 인코딩된 Base64, UTF-16·CP949 출력, 그 밖의 임의 변환은 가려지지 않는다. 아주 짧은 비밀은 엉뚱한 곳까지 가려질 수 있다.
- **`.cmd`·`.bat` 실행:** Windows에서 실행할 수 없다(`spawn_failed`). `npm`, `npx` 대신 `node`를 직접 쓴다. 지원은 작업 중이다.
- **보호 경로 설정 없음:** 정책에 보호 경로 설정이 없어 모델이 테스트 파일도 고칠 수 있다. 검증기와 `changes`로 확인한다.
- **파일 해시 노출:** 파일 해시가 모델과 기록에 남는다. 짧은 비밀이 든 파일은 추측 검증이 가능하다.
- **쓰기 경합:** 해시 비교와 파일 교체 사이에 다른 프로그램이 쓰면 그 변경을 덮어쓸 수 있다.

## 12. 문제 해결

| 코드 | 뜻과 조치 |
| --- | --- |
| `invalid_arguments` | 옵션 오류. 같은 옵션 반복, 모르는 옵션, `--workspace`·`--goal` 한쪽만 쓴 경우다 |
| `invalid_task`, `invalid_config` | 메시지에 적힌 필드를 고친다. `--env-file`의 BOM이나 읽기 실패도 `invalid_config`다 |
| `key_in_file` | task·설정 파일에서 키 필드나 키 값을 지우고 환경 변수로 옮긴다 |
| `secret_env_missing` | `secretEnv`에 적은 환경 변수가 없다 |
| `workspace_not_found` | `workspaceRoot`나 `--workspace`가 있는 디렉터리가 아니다 |
| `workspace_locked` | 다른 실행이 끝나기를 기다린다 |
| `provider_not_configured` | 메시지에 적힌 항목(키, 모델, `maxOutputTokens`)을 설정한다 |
| `failed`/`model_error` | 기록의 `model_error.kind`를 본다. `auth_failed`는 키 확인, `rate_limited`·`overloaded`는 잠시 뒤 재시도, `timeout`은 `requestTimeoutMs` 확인 |
| `needs-input`/`no_verifier` | 검증기를 추가한다 |
| `budget-exhausted` | `reason`의 한도를 올리거나 목표를 작게 나눈다 |
| 도구 `policy_denied` | 명령이나 경로가 정책 밖이다. 규칙과 `goal`의 명령이 정확히 같은지 본다 |
| 도구 `spawn_failed` | 실행 파일을 찾지 못했거나 `.cmd`·`.bat`이다 |

## 13. 준비 중

실패 결과를 이용한 재수정 반복(단계 2)과 되돌리기(revert) 명령은 구현 중이다.
