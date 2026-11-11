# CLI·공통 계약 (1a, 1b 설정, 2 재수정 반복)

`src/contracts/**`에 있는 타입과 상수를 설명한다. 코드와 다르면 코드가 기준이다. 1a 오프라인 CLI는 구현되어 있다. 1b의 설정 계약과 CLI 처리(11절)는 E1에서 추가했다. Anthropic 제공자(E2)는 CLI에 연결되어 있어, 키·모델·출력 상한·한도가 모두 정해지면 실제로 전송한다. 실제 API로는 아직 검증하지 않았다(10절 "실제 API 미검증"). 단계 2(F1)의 재수정 반복, 새 한도, 보호 경로, 스냅샷과 되돌리기는 12~14절이다. 스냅샷 저장과 `codaryn revert`는 저장소 구현(F3)이 병합된 뒤 조립에 연결한다(14절 "연결 상태").

## 1. import 규칙과 공개 진입점

모든 모듈은 `../contracts/index.js` 하나에서만 가져온다(ESM, NodeNext, 타입은 `import type`). `src/contracts/**`는 읽기 전용이다.

| 경로(후속 작업이 만든다) | export | 계약 타입 |
| --- | --- | --- |
| `src/privacy/index.ts` | `createPrivacyGateway` | `CreatePrivacyGateway` → `PrivacyGateway` |
| `src/policy/index.ts` | `createPolicyGate` | `CreatePolicyGate` → `PolicyGate` |
| `src/workspace/index.ts` | `createWorkspace` | `CreateWorkspace` → `Promise<Workspace>` |
| `src/engine/index.ts` | `runTask` | `RunTask` = `(deps: EngineDeps) => Promise<EngineResult>` |
| `src/model/anthropic/index.ts` (E2) | `createAnthropicProvider` | `CreateAnthropicProvider` = `(settings: ResolvedAnthropicSettings, deps?: AnthropicProviderDeps) => ModelProvider` |
| `src/store/index.ts` (F3) | `createChangeRecorder`, `revertRun` | `CreateChangeRecorder` = `({ workspaceRoot, runId }) => ChangeRecorder`, `RevertRun` = `(request: RevertRequest) => Promise<RevertOutcome>` |
| `src/tools/index.ts` (F4) | `createToolRunner`의 선택 인자 `changeRecorder` | `ChangeRecorder`(14절) |
| `src/cli/main.ts` | CLI 진입 파일 | `package.json`의 `bin.codaryn`이 `dist/src/cli/main.js`를 가리킨다 |

- CLI가 Anthropic 제공자를 가져오는 곳은 `src/cli/provider.ts`의 `anthropicProviderFactory` 하나이며, `createAnthropicProvider`에 연결되어 있다. CLI는 설정을 모두 해석한 뒤에만 이를 호출한다. 1a 자리표시자 `src/model/anthropic.ts`는 제거했다. `provider_not_implemented`는 계약에 남아 있지만 실제 CLI에서는 더 이상 나오지 않는다.

- `PrivacyGateway`: `mask(text)`, `resolveToolArgs(request)`, `rebuildDocument(request)`.
- `PolicyGate`: `checkRequested(call, descriptor)`, `restorableFields(descriptor)`, `checkEffective(call, descriptor)`.
- `Workspace`: `root`, `resolve(path, access)`, `readText(path)`, `list(dir)`, `writeText(request)`.
- 엔진 쪽: `ModelProvider.complete`, `ToolRunner.execute`, `VerifierRunner.run`, `Journal.append/close`, `Clock.now`.

## 2. 실행

```
node dist/src/cli/main.js run --task <task.json> [옵션]
node dist/src/cli/main.js run --workspace <디렉터리> --goal <문장> [옵션]
옵션: --config <config.json>  --env-file <경로>  --cancel-file <경로>
node dist/src/cli/main.js revert --workspace <디렉터리> --run <runId>
```

- `revert`는 14절이다. `--workspace`와 `--run` 둘 다 필요하고 다른 옵션은 받지 않는다. runId는 영숫자로 시작하는 1~128자의 영숫자·`.`·`_`·`-`이며 `..`를 포함할 수 없다. 어기면 `invalid_arguments`다.

- task 파일 형식은 1a와 같다. scripted 모델은 키 없이 실행된다.
- 간편 형식(`--workspace`, `--goal`)은 task 파일 없이 설정 파일의 기본값으로 실행한다. 제공자는 항상 anthropic이다(11절).
- `--task`와 간편 형식은 함께 쓸 수 없다. `--workspace`와 `--goal`은 함께 써야 한다. 같은 옵션을 두 번 쓰거나 모르는 옵션을 쓰면 `invalid_arguments`다.
- task 파일과 설정 파일에는 비밀 값이나 API 키를 넣지 않는다.
- 취소는 `SIGINT`/`SIGTERM`, 또는 `--cancel-file`로 지정한 파일이 생기는 것으로 받는다(P-2). 둘 다 `EngineDeps.signal`을 abort한다.

## 3. task.json (`TaskSpec`)

```json
{
  "schemaVersion": 1, "id": "doc-example", "workflow": "document",
  "goal": "README에 설치 절을 추가한다",
  "workspaceRoot": "./work",
  "model": { "provider": "scripted", "scriptPath": "./script.json" },
  "policy": { "commands": [{ "executable": "node", "argsPrefix": ["--test"], "allowExtraArgs": true }],
              "network": "deny", "destructive": "deny", "restorePathTokens": false,
              "protectedPaths": ["tests"] },
  "privacy": { "secretEnv": ["CODARYN_TEST_SECRET"] },
  "limits": { "maxModelTurns": 8, "maxToolCalls": 16, "maxTotalTokens": null, "maxDurationMs": 60000,
              "maxRepairAttempts": 2, "maxSameFailures": 2 },
  "verifiers": [{ "id": "doc", "kind": "file_rules",
                  "rules": [{ "type": "contains", "path": "README.md", "text": "## 설치" }] }]
}
```

- `workspaceRoot`와 `scriptPath`는 절대 경로이거나 task 파일의 디렉터리 기준 상대 경로다. 허용 루트는 `workspaceRoot` 하나다. `workflow`는 표시용 문자열이며 엔진은 이 값으로 분기하지 않는다.
- `privacy.secretEnv`에는 환경 변수 이름만 적는다. 값은 실행 시 환경에서 읽어 비밀로 등록한다.
- 권한은 경로, 명령(`executable`과 `args`), 네트워크, 파괴적 동작을 각각 판정한다. `network`와 `destructive`는 1a에서 `"deny"`만 있다. 네트워크 차단이 아니라 네트워크를 쓰는 도구가 없다는 뜻이다.
- `model.provider`가 `"anthropic"`이면 `model`에 선택 필드 `model`(모델 ID)과 `maxOutputTokens`(요청당 출력 토큰 상한)를 둘 수 있다. scripted에는 이 필드를 쓸 수 없다. 키, 모델, 출력 상한 중 하나라도 정해지지 않으면 `provider_not_configured`로 전송 없이 끝난다(11절).
- `limits`와 그 필드는 설정 파일이 채울 수 있으면 생략해도 된다. 필드마다 task 값이 우선한다. 예산 한도 넷(`maxModelTurns`, `maxToolCalls`, `maxTotalTokens`, `maxDurationMs`) 중 어디에도 없는 필드가 있으면 `invalid_task`다.
- 재수정 한도 `maxRepairAttempts`(0 이상 정수)와 `maxSameFailures`(1 이상 정수)는 두 파일 모두에서 생략할 수 있고, 그때는 0과 2다(`DEFAULT_MAX_REPAIR_ATTEMPTS`, `DEFAULT_MAX_SAME_FAILURES`). 0이면 단계 1과 같이 첫 검증 실패에서 끝난다(12절).
- `policy.protectedPaths`는 선택이다(13절).
- 파일 형식은 `TaskSpec`, CLI가 해석해 엔진에 넘기는 형은 `ResolvedTaskSpec`(경로는 절대 경로, 한도 여섯 개가 모두 정해짐)이다. `EngineDeps.task`는 `ResolvedTaskSpec`이다.
- task 파일과 설정 파일은 UTF-8이며 BOM이 있어도 읽는다.
- 검증기는 `command`(`executable`, `args`, 선택 `cwd`·`timeoutMs`·`expectExitCode`)와 `file_rules`(`exists`, `absent`, `contains`, `not_contains`) 두 종류다. 결과에는 `outcome`(pass/fail/inconclusive), `evidence`, `checked`, `limits`가 있다.

## 4. scripted 모델 파일 (`ScriptedModelScript`)

```json
{ "schemaVersion": 1, "steps": [
  { "toolCalls": [{ "name": "read_file", "args": { "path": "README.md" } }] },
  { "toolCalls": [{ "name": "write_file", "args": {
      "path": "README.md", "expectedHash": "<read_file이 돌려준 64자리 sha256>",
      "change": { "kind": "replace_text", "oldText": "# 제목\n", "newText": "# 제목\n\n## 설치\n" } } }] },
  { "text": "완료" }
] }
```

- N번째 step이 N번째 모델 요청의 응답이다. 선택 필드: `text`, `toolCalls`, `stop`, `usage`, `delayMs`. 호출 `id`를 생략하면 `call_<step>_<n>`이다.
- 대본의 호출도 제품과 같은 정책·치환 경로를 지난다. `expectedHash`를 건너뛰는 옵션은 없다.
- `{{secret_token:N}}`은 대본이 그때까지 받은 요청에 나온 N번째 치환 토큰으로 바뀐다. 모델이 본 것만 되풀이한다.

## 5. 도구

| 이름 | 인자 | 결과 payload |
| --- | --- | --- |
| `read_file` | `path` | `path`, `content`(BOM 제외), `hash`, `hadBom` |
| `search_files` | `path`, 선택 `nameContains`, `text` | `entries[{path, kind, matches?}]`, `truncated` |
| `write_file` | `path`, `expectedHash`(필수, 새 파일은 `null`), `change` | `path`, `previousHash`, `newHash`, `created` |
| `run_command` | `executable`, `args`, 선택 `cwd`, `timeoutMs` | `exitCode`, `stdout`, `stderr`, `timedOut`, `truncated` |

- `change`는 `{kind:"replace_all", content}` 또는 `{kind:"replace_text", oldText, newText}`다.
- 요구 권한, 복원 가능 필드, 문서 필드는 `BUILTIN_TOOLS`에 고정되어 있다. 모델과 task가 낮출 수 없다. 오류 코드는 `TOOL_ERROR_CODES`, 상한은 `MAX_READ_BYTES` 등 `tool.ts`의 상수를 쓴다. 자식 프로세스 환경은 `CHILD_ENV_ALLOWLIST`만 전달한다.
- 거부된 호출은 실행을 끝내지 않는다. `ok:false`인 `ToolResult`로 모델에 돌아간다.
- 제공자가 모델에 보내는 도구 설명과 입력 JSON Schema는 `TOOL_DEFINITIONS`다. mask를 거치지 않는 고정 문장이므로 토큰 표식을 쓰지 않는다. 스키마는 엔진의 인자 형식 검증과 같은 필드를 가진다(`tests/unit/contracts`가 확인).

## 6. 도구 호출 처리 순서

1. 도구 이름과 인자 형식을 검증한다.
2. `PolicyGate.checkRequested`: 토큰이 든 요청 그대로 요구 권한, 명령, 토큰 없는 경로를 판정한다.
3. `PrivacyGateway.resolveToolArgs`: `PolicyGate.restorableFields`가 허용한 필드만 복원한다. 실제 값이 필요한 다른 필드에 토큰이 남으면 호출 전체를 거부한다(`unresolved_token`, `invalid_token`).
4. `PolicyGate.checkEffective`: 복원된 실효 인자(링크 해석 후 경로, 실제 명령)를 다시 판정한다.
5. `ToolRunner.execute`: 통과한 호출만 실행한다. 결과는 `RawToolOutcome`(로컬 전용)이다.
6. `PrivacyGateway.mask`: 결과 payload의 문자열 값을 직렬화 전에 필드별로(중첩 포함) 치환한 뒤 JSON으로 만들어 `ToolResult`로 만든다. 하나라도 실패하면 기록도 전송도 하지 않는다.
7. `Journal.append` 후 모델에 전달한다. 기록과 모델 요청에는 `MaskedText`만 들어간다.

1·2·3·4단계에서 거부된 호출도 `tool_decision` 뒤에 `ok:false`인 `tool_result`(가림본, `errorCode` 포함)를 기록한다. 모델에 돌려준 모든 도구 결과가 기록에 남는다.

`write_file`은 5단계 안에서 현재 파일을 읽고(`LocalSnapshot`), 가림 상태에서 변경을 적용한 뒤 `rebuildDocument`로 원문을 만든다. LF 기준으로 나눈 줄 중 토큰이 든 줄의 목록이 원본과 내용·순서 모두 같아야 하며, 토큰이 없는 줄은 자유롭게 추가·삭제·변경할 수 있다. 다르면 `protected_span_violation`으로 변경 전체를 거부한다. 이어서 `Workspace.writeText`가 `expectedHash`와 현재 해시를 비교해 다르면 `conflict`로 쓰지 않는다.

## 7. BOM·CRLF 책임

- `Workspace.readText`는 파일 바이트를 그대로 UTF-8로 디코드한다(BOM이 있으면 선두 U+FEFF 포함). `writeText`는 받은 텍스트를 그대로 인코드하고 원자적으로 교체한다. 해시는 파일 바이트의 SHA-256이다.
- BOM을 모델 화면에서 빼고(`hadBom`) 쓸 때 되붙이는 일은 `read_file`/`write_file` 도구(코어) 책임이다. 줄바꿈은 누구도 변환하지 않는다. `replace_text`는 바꾸지 않은 부분의 바이트를 유지하고, `replace_all`은 받은 내용 그대로 쓴다.

## 8. 출력, 종료 코드, 상태 디렉터리

stdout에는 JSON 한 줄만 쓴다. `run`은 `CliOutput`, `revert`는 `RevertOutput` 또는 `CliErrorOutput`이다(합쳐서 `CommandOutput`). 진행 표시는 stderr다.

- 실행 결과 `EngineResult`: `schemaVersion`, `kind:"run"`, `runId`, `taskId`, `status`, `reason`, `exitCode`, `provider`, `verifiers`, `changes`, `usage`, `journalPath`, `notices`.
  - `verifiers`는 마지막 검증 회차의 결과다. 재수정 뒤 검증 전에 한도로 끝나면 직전 회차의 결과가 남는다. 회차마다의 결과는 기록의 `verifier_result`에 모두 있다.
  - `usage.repairAttempts`는 시작한 재수정 수다. 단계 2 엔진은 항상 채운다(단계 1 기록에는 없다).
- 되돌리기 결과 `RevertOutput`: `schemaVersion`, `kind:"revert"`, `runId`, `status`(`complete`/`partial`), `exitCode`, `reverted[{path, action}]`, `skipped[{path, reason}]`(14절).
- 실행 전 오류 `CliErrorOutput`: `schemaVersion`, `kind:"error"`, `code`, `exitCode`, `message`.
- 상태별 종료 코드(`RUN_EXIT_CODES`): `done` 0, `failed` 1, `needs-input` 3, `budget-exhausted` 4, `cancelled` 5.
- 되돌리기 종료 코드(`REVERT_EXIT_CODES`): `complete` 0, `partial` 3.
- 실행 전 오류(`CLI_ERROR_EXIT_CODES`): `invalid_arguments`·`invalid_task`·`invalid_config`·`key_in_file`·`invalid_script`·`secret_env_missing`·`workspace_not_found`·`run_not_found`·`invalid_run_record` 2, `workspace_locked` 6, `provider_not_configured`·`provider_not_implemented` 7, `internal_error` 70.
- 모델 오류(`MODEL_ERROR_KINDS`)는 취소 때문이 아니면 실행을 `failed`/`model_error`로 끝내며 기록의 `model_error.kind`에 남는다. 1b에서 `auth_failed`, `rate_limited`, `overloaded`, `timeout`, `api_error`가 추가되었다.
- 상태 전이는 `RUN_TRANSITIONS`, 이유는 `RunReasonByStatus`를 따른다. 모델의 완료 선언만으로 `done`이 되지 않는다. 검증기가 없으면 `needs-input`/`no_verifier`다. 재수정은 `verifying → running`이다. `failed`의 이유에 `repeated_failure`가 더해졌다(12절).
- 상태 디렉터리는 `<workspaceRoot>/.codaryn/`이다. 도구는 이 안을 읽기, 목록, 쓰기, 실행 위치로 쓸 수 없다(`state_dir`).
  - `runs/<runId>/journal.jsonl`: 한 줄에 `JournalRecord` 하나(`seq`, `at`, `runId`와 이벤트). 가림본만 담는다. `runs/<runId>/result.json`은 stdout과 같은 객체다.
  - `runs/<runId>/snapshots/`(`SNAPSHOTS_DIR_NAME`): 실행이 바꾼 파일의 변경 전 원문(14절). 원문이므로 가림본이 아니다.
  - `lock.json`: 실행 중인 작업 공간 잠금이며 내용은 `{pid, runId, startedAt}`이다. 기록된 pid가 살아 있으면 `workspace_locked`, 살아 있지 않으면 회수한다(P-4). `revert`도 되돌리는 동안 자기 id로 잡는다.
- `runId`는 `<UTC yyyymmddThhmmssZ>-<8자리 16진 난수>`다(P-3). 예: `20261112T031500Z-9f2c41ab`.
- 치환 대응표는 실행 중 메모리에만 둔다. 영구 금고와 재개는 없다. 되돌리기용 원문은 14절의 스냅샷으로 디스크에 남는다.

## 9. 계약 변경 절차

변경이 필요하면 담당자가 사유와 원하는 형태를 PM에 요청한다 → PM이 승인한다 → 역할 1(기반 담당)만 `src/contracts/**`와 이 문서를 수정한다. 다른 담당자는 계약을 직접 고치거나 로컬 사본을 만들지 않는다.

## 10. 미정과 알려진 한계

미정: 없음(1a 결정은 P-1~P-7과 PM 결정으로 고정).

알려진 한계(1a):

- 비밀이 든 줄은 수정할 수 없다. 그 줄의 변경·이동·삭제는 `protected_span_violation`이다(P-6).
- 치환은 등록한 값과 목록의 변형(Base64, URL 인코딩, JSON 이스케이프, 16진)만 가린다. 목록 밖 변형과 UTF-8이 아닌 인코딩(UTF-16, CP949 등)으로 나온 출력은 가려지지 않는다.
- `CommandRule.allowExtraArgs`가 `true`이면 추가 인자 속 경로를 검사하지 않으므로, 명령 허용이 경로 허용을 대신할 수 있다. 가능하면 `false`를 쓴다.
- 이름이나 경로에 `CODARYN_SECRET`이 든 파일은 토큰으로 오인되어 접근할 수 없다. 내용에 이 리터럴이 든 파일도 `write_file`로 수정할 수 없다.
- 해시 비교와 파일 교체 사이에 다른 프로세스가 쓰면 그 변경을 덮어쓸 수 있다(경쟁 구간).
- Windows에서 `.cmd`와 `.bat`은 셸 없이 실행할 수 없다(`spawn_failed`).
- 파일 해시가 모델과 기록에 노출되어 짧은 비밀이 든 파일은 추측 검증이 가능하다(P-7).

알려진 한계(1b 설정):

- 키 값 검사는 Anthropic 키 모양과 현재 `ANTHROPIC_API_KEY` 값만 찾는다. 다른 형식의 키나 잘린 키는 찾지 못한다.
- `--env-file`로 읽은 값은 CLI 프로세스의 환경에 들어간다. 자식 프로세스에는 `CHILD_ENV_ALLOWLIST`만 전달되므로 키는 넘어가지 않는다.

실제 API 미검증(1b 제공자 연결 상태):

- 연결: `codaryn run`은 해석한 `ResolvedAnthropicSettings`로 `createAnthropicProvider`를 만들어 Messages API(`<apiBaseUrl>/v1/messages`)를 Node 내장 `fetch`로 호출한다.
- 검증한 것: 주입한 가짜 `fetch`를 쓴 유닛 테스트(제공자 단위, CLI 조립 단위)뿐이다. 요청 주소, 모델, `max_tokens`, 키가 `x-api-key` 헤더에만 있고 본문·stdout·기록에 없음, 가짜 비밀 가림, 401 처리를 확인했다. 이것은 모의 검증이며 실제 API 검증이 아니다.
- 실제 API에서 확인하지 않은 것:
  - HTTP 503 분류. 제공자는 529와 같은 `overloaded`(재시도 대상)로 본다.
  - `retry-after` 헤더 형식. 제공자는 초(소수 포함)와 HTTP 날짜를 해석하고 60초로 자른다.
  - 빈 `tool_result`. 내용이 빈 문자열인 도구 결과를 API가 받아들이는지 확인하지 않았다.
  - thinking 블록 없이 도구 루프 지속. 제공자는 응답의 thinking 블록을 다음 요청에 되돌려 보내지 않는다. 이 상태로 도구 사용 루프가 계속되는지 확인하지 않았다.
- 실제 호출 검증(1b 완료 판단)은 사용자가 키를 설정하고 직접 실행하거나 Codex가 연다.

알려진 한계(단계 2, R-8 포함):

- 스냅샷은 변경 전 원문이므로 비밀이 들어 있을 수 있다. 작업 공간의 원본 파일과 같은 수준의 로컬 자료로 다룬다. 기록·모델 요청·stdout에는 넣지 않지만 디스크에는 남는다. 보관 기간 자동 관리는 없으며, 지우려면 사용자가 `.codaryn/runs/<runId>/`를 지운다(R-8).
- 보호 경로는 파일 도구의 쓰기만 막는다. 정책이 허용한 명령(`run_command`)과 명령형 검증기는 보호 경로의 파일도 바꿀 수 있다.
- 명령이 바꾼 파일은 `file_changed`와 스냅샷에 남지 않으므로 되돌리기 대상이 아니다.
- 실패 근거에 실행 시간이나 임시 경로처럼 매번 바뀌는 내용이 있으면 서명이 달라져 같은 실패로 판정되지 않는다. 그때는 `maxRepairAttempts`와 예산 한도만 반복을 멈춘다.
- 경로에 등록된 비밀이 든 파일은 기록에 토큰으로 남아 스냅샷과 맞출 수 없다. 되돌리기에서 `missing_snapshot`으로 건너뛴다.
- 같은 실행을 두 번 되돌리면 두 번째에는 현재 해시가 실행이 남긴 해시와 달라 `changed_since_run`으로 보고된다.
- 실행 중 다른 프로세스가 같은 파일을 바꾸면 스냅샷(그 실행이 처음 쓰기 직전에 읽은 원문)과 실제 실행 전 상태가 다를 수 있다.

## 11. 설정 (1b)

### 설정 파일 (`CodarynConfig`)

`--config <경로>` 또는 환경 변수 `CODARYN_CONFIG`로 지정한 파일만 읽는다. 둘 다 있으면 `--config`가 우선한다. 작업 공간 안에서 자동으로 찾지 않는다(C-3). 상대 경로는 현재 디렉터리 기준이다.

```json
{
  "schemaVersion": 1,
  "model": "<모델 ID>",
  "maxOutputTokens": 4096,
  "requestTimeoutMs": 600000,
  "maxRetries": 2,
  "limits": { "maxModelTurns": 20, "maxToolCalls": 40, "maxTotalTokens": 200000, "maxDurationMs": 600000 },
  "policy": { "commands": [{ "executable": "node", "argsPrefix": ["--test"], "allowExtraArgs": false }],
              "network": "deny", "destructive": "deny", "restorePathTokens": false },
  "verifiers": [{ "id": "tests", "kind": "command", "executable": "node", "args": ["--test"] }],
  "secretEnv": ["MY_DB_PASSWORD"]
}
```

- `schemaVersion`만 필수다. 모르는 필드나 잘못된 값은 `invalid_config`다.
- `apiBaseUrl`은 `https:` 주소다. `http:`는 루프백 호스트(`localhost`, `127.0.0.1`, `[::1]`)에만 허용한다(가짜 서버 시험용). 사용자 정보, 쿼리, 조각은 쓸 수 없고 끝의 `/`는 뗀다.
- `maxRetries`는 0~10 정수다. 다른 수는 양의 정수다. `limits`는 task와 같은 규칙이며 일부 필드만 적어도 된다. 재수정 한도 두 필드도 여기에 기본값으로 적을 수 있다.
- `policy`와 `verifiers`는 간편 형식에만 쓴다. task 파일은 자기 값을 적는다. 간편 형식에서 `policy`가 없으면 `DENY_ALL_POLICY`(명령 없음)를 쓰고, `verifiers`가 없으면 `needs-input`/`no_verifier`로 끝난다.
- `secretEnv`는 두 형식 모두에서 task의 `privacy.secretEnv`에 더한다.

### 환경 변수와 env 파일

| 이름 | 뜻 |
| --- | --- |
| `ANTHROPIC_API_KEY` | API 키. 이 환경 변수로만 받는다(C-1) |
| `CODARYN_MODEL` | 모델 ID |
| `CODARYN_CONFIG` | 설정 파일 경로. `--config`가 없을 때 쓴다 |
| `CODARYN_API_BASE_URL` | API 주소. 설정 파일의 `apiBaseUrl`보다 우선한다 |

- 비어 있거나 공백뿐인 값은 설정되지 않은 것으로 본다.
- `--env-file <경로>`를 줄 때만 그 파일을 `process.loadEnvFile`로 읽는다(C-2). `.env`를 자동으로 찾지 않는다. 이미 설정된 환경 변수가 파일 값보다 우선한다.
- BOM이 있는 env 파일은 첫 변수를 조용히 놓치므로 `invalid_config`로 거부한다.
- `.env.example`을 `.env`로 복사해 값을 채우고 `--env-file .env`로 쓴다. `.env`는 Git이 무시한다.

### 우선순위

| 항목 | 순서(왼쪽이 우선) | 어디에도 없을 때 |
| --- | --- | --- |
| 키 | `ANTHROPIC_API_KEY` | `provider_not_configured` |
| 모델 | task `model.model` → `CODARYN_MODEL` → 설정 `model` | `provider_not_configured`. 코드 기본값 없음(C-4) |
| 출력 토큰 상한 | task `model.maxOutputTokens` → 설정 `maxOutputTokens` | `provider_not_configured` |
| API 주소 | `CODARYN_API_BASE_URL` → 설정 `apiBaseUrl` → `https://api.anthropic.com` | task로는 바꿀 수 없다(C-5) |
| 요청 시간 제한, 재시도 | 설정 → `DEFAULT_REQUEST_TIMEOUT_MS`(600000), `DEFAULT_MAX_RETRIES`(2) | 기본값 |
| 한도 | 필드마다 task `limits` → 설정 `limits` | task 형식은 `invalid_task`, 간편 형식은 `invalid_config`(C-6). 재수정 한도 둘은 0과 2 |

해석한 값은 `ResolvedAnthropicSettings`로 제공자에 전달한다. 키는 메모리에만 둔다. 키도 비밀로 등록하므로 파일 내용이나 명령 출력에 나타나면 가려진다.

### 키 거부 (`key_in_file`)

설정 파일과 task 파일을 JSON으로 읽은 직후, 다른 검사보다 먼저 확인한다. 다음이 하나라도 있으면 종료 코드 2로 거부한다. 메시지에는 위치(필드 이름)만 적고 값은 적지 않는다.

- 어느 깊이든 키 필드 이름. 소문자로 바꾸고 영숫자만 남긴 이름이 `KEY_FIELD_NAMES`(`apikey`, `key`, `secret`, `token`, `password` 등)에 있거나 `apikey`를 포함하면 키 필드다. 예: `apiKey`, `api_key`, `x-api-key`, `ANTHROPIC_API_KEY`.
- Anthropic 키 모양의 값(`ANTHROPIC_KEY_PATTERN_SOURCE`).
- 현재 `ANTHROPIC_API_KEY` 값과 같은 문자열(16자 이상일 때).

### 처리 순서

인자 → `--env-file` → 설정·task 파일 읽기 → 키 거부 → 설정 검증 → task 검증(또는 간편 형식 구성) → 작업 공간 확인 → 비밀 값 → 제공자 설정 해석 → 제공자 생성 → 조립과 실행.

### 실행 예시 (PowerShell)

```powershell
# 1) 간편 형식: 키와 모델은 .env, 한도·정책·검증기는 설정 파일
Copy-Item .env.example .env   # 값을 채우고 UTF-8(BOM 없음)으로 저장한다
node dist/src/cli/main.js run --workspace D:\work\notes --goal "README에 설치 절을 추가한다" `
  --config D:\codaryn\config.json --env-file .env

# 2) task 파일: 모델은 환경 변수, 빠진 한도는 설정 파일이 채운다
$env:CODARYN_MODEL = "<모델 ID>"
$env:CODARYN_CONFIG = "D:\codaryn\config.json"
node dist/src/cli/main.js run --task .\task.json --env-file .env

# 3) 로컬 가짜 서버로 시험할 때(E3)
$env:CODARYN_API_BASE_URL = "http://127.0.0.1:8123"
```

## 12. 재수정 반복 (단계 2, R-1~R-4)

모델이 도구 호출 없이 답하면 검증기를 모두 한 번 실행한다(한 회차). 회차 결과에 따라 다음과 같이 정한다.

| 회차 결과 | 결과 |
| --- | --- |
| 모두 `pass` | `done`/`verified` |
| `fail` 없이 `inconclusive`가 있음 | `needs-input`/`verifier_inconclusive`. 재수정하지 않는다 |
| `fail`과 `inconclusive`가 함께 있음 | `failed`/`verifier_failed`. 재수정으로 통과할 수 없으므로 재수정하지 않는다 |
| `fail`만 있음, 재수정 횟수를 다 씀(`maxRepairAttempts`가 0이면 바로 여기) | `failed`/`verifier_failed` |
| `fail`만 있음, 같은 서명이 `maxSameFailures`번 연속 | `failed`/`repeated_failure` |
| `fail`만 있음, 그 밖 | 재수정 |

- 판정 순서는 위에서 아래다. 재수정 횟수 소진이 같은 실패 반복보다 먼저다.
- 실패 서명은 실패한 검증기 id와 가림 근거 전체의 SHA-256이다(task 순서). 직전 회차와 서명이 같으면 연속 횟수가 늘고, 다르면 1부터 다시 센다. `maxSameFailures`가 2면 같은 실패를 한 번만 재수정하고, 1이면 어떤 실패도 재수정하지 않는다.
- 재수정은 이렇게 진행한다: 다음 모델 호출이 예산 한도 안에서 가능한지 먼저 확인한다(불가능하면 그 한도로 `budget-exhausted`, 재수정은 세지 않는다) → 재수정 메시지를 만들어 가린다 → 기록에 `repair_started { attempt, failedVerifiers, feedbackTruncated }` → 상태 `verifying → running` → 대화에 모델의 직전 답과 재수정 메시지(user)를 이어 붙이고 모델을 다시 부른다.
- 기존 한도(턴, 도구 호출, 토큰, 시간)는 재수정을 포함한 실행 전체에 적용한다. 도구 호출 식별자 중복 방지도 실행 전체에 걸친다.
- 재수정 메시지는 고정 머리말, `Repair attempt N of M.`, 그리고 실패한 검증기마다 `Verifier "<id>" outcome: fail`과 `Evidence:` 아래의 근거다. 통과한 검증기는 넣지 않는다. 메시지 전체를 한 번 더 가린 뒤 보낸다. 가리기에 실패하면 보내지도 기록하지도 않고 `failed`/`model_error`다.
- 근거 절단(R-4): 이미 가린 근거를 자른다. 한 메시지의 근거 전체 상한은 `MAX_FEEDBACK_BYTES`(8192 UTF-8 바이트)이고 실패한 검증기가 똑같이 나눈다. 몫을 넘는 근거는 앞부분과 뒷부분을 남기고 가운데를 `[... N bytes omitted ...]`로 바꾼다(생략 표시도 몫에 포함). 치환 토큰이나 한 글자(UTF-8 다중 바이트, 서로게이트 쌍) 중간에서 자르지 않는다. 잘렸으면 `feedbackTruncated`가 `true`다.
- 결과의 `verifiers`는 마지막 회차, `usage.repairAttempts`는 시작한 재수정 수다.

## 13. 보호 경로 (R-5)

`policy.protectedPaths`는 작업 공간 기준 경로 접두 목록이다. 그 아래에 대한 파일 도구의 쓰기를 권한 `path`, 코드 `protected_path`로 거부한다. 읽기와 검색은 허용한다.

- 접두는 경로 조각 단위로 비교한다. `tests`는 `tests`와 `tests/a.ts`를 덮고 `tests2`는 덮지 않는다. `.`은 작업 공간 전체다.
- 링크를 해석한 뒤의 `ResolvedPath.relative`와 비교하므로 링크로 돌아갈 수 없다. Windows에서는 대소문자를 구분하지 않는다.
- 항목은 상대 경로이며 `/`나 `\`로 나눈다. 빈 값, 절대 경로(`/x`, `C:\x`, `C:x`, `\\server\share`), `..` 조각, NUL 문자는 task에서는 `invalid_task`, 설정 파일에서는 `invalid_config`다. CLI는 검증만 하고 적힌 그대로 정책에 넘긴다.
- task 파일이나 설정 파일(간편 형식의 `policy`)만 정할 수 있다. 모델, task의 다른 필드, 작업 공간의 파일로는 풀 수 없다. 생략하거나 빈 목록이면 보호 경로가 없다.
- 판정은 정책(F2) 담당이다. 그 구현이 병합되기 전에는 CLI가 값을 넘겨도 거부가 일어나지 않는다.

## 14. 스냅샷과 되돌리기 (R-6, R-7)

### 스냅샷 (`ChangeRecorder`)

- `write_file`은 검사를 통과한 뒤 쓰기 직전에 `ChangeRecorder.saveOriginal(path, original)`을 부른다. `original`은 읽은 원문 그대로(BOM 포함)이고, 파일이 없었으면 `null`이다. 이 호출이 실패하면 쓰지 않고 `io_error`다.
- 저장 위치는 `<작업 공간>/.codaryn/runs/<runId>/snapshots/`다. 내부 배치는 저장소(F3)가 정한다. 한 실행에서 같은 경로는 첫 원문만 보관한다.
- 스냅샷은 기록(journal), 모델 요청, stdout에 넣지 않는다. 상태 디렉터리 안에 있으므로 도구는 접근할 수 없다.

### 되돌리기 (`codaryn revert --workspace <디렉터리> --run <runId>`)

1. 인자를 확인한다(`invalid_arguments`). 작업 공간이 디렉터리가 아니면 `workspace_not_found`다.
2. `<작업 공간>/.codaryn/runs/<runId>/journal.jsonl`이 없으면 `run_not_found`다. 상태 디렉터리를 새로 만들지 않는다.
3. 작업 공간 잠금을 자기 id로 잡는다. 실행 중인 작업이 있으면 아무것도 바꾸지 않고 `workspace_locked`다.
4. `revertRun({ workspaceRoot, runId })`: journal의 `file_changed`에서 경로별로 처음 나온 순서대로 한 번씩 다룬다. 그 경로의 마지막 `newHash`가 현재 파일 해시와 같을 때만 스냅샷으로 원래 바이트를 복원하고(`restored`), 원문이 `null`이면 파일을 지운다(`deleted`). 다르거나 파일이 없으면 건드리지 않고 `changed_since_run`, 스냅샷이 없으면 `missing_snapshot`, 그 파일의 읽기·쓰기 실패는 `io_error`로 건너뛴다. 한 파일의 실패는 나머지를 막지 않는다.
5. journal을 읽거나 해석할 수 없어 `revertRun`이 거부하면 `invalid_run_record`다. 이때는 아무것도 바꾸지 않았다.
6. 잠금을 놓고 `RevertOutput`을 출력한다. 건너뛴 파일이 없으면 `complete`(종료 0), 있으면 `partial`(종료 3)이다.

- 출력의 `path`는 journal에 기록된 경로(가림본)다. 스냅샷의 원문 경로나 내용은 출력하지 않는다.
- 되돌리기는 journal에 기록을 더하지 않는다.

### 연결 상태

- 엔진의 재수정 반복과 CLI의 새 한도·보호 경로 전달은 연결되어 있다.
- `createChangeRecorder`와 `revertRun`은 저장소 구현(F3)이 병합된 뒤 PM의 알림에 따라 조립(`src/cli/assemble.ts`, `src/cli/main.ts`)에 연결한다. 그 전까지 `write_file`은 스냅샷을 남기지 않고, `codaryn revert`는 아무것도 읽거나 바꾸지 않고 `internal_error`(종료 70)로 끝난다. 잠금과 journal 확인을 포함한 되돌리기 흐름(`createRevertCommand`)은 구현되어 있고 가짜 `revertRun`으로 유닛 검증했다.
