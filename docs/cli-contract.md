# CLI·공통 계약 (1a, 1b 설정, 2 재수정 반복, 3 준비)

`src/contracts/**`에 있는 타입과 상수를 설명한다. 코드와 다르면 코드가 기준이다. 1a 오프라인 CLI는 구현되어 있다. 1b의 설정 계약과 CLI 처리(11절)는 E1에서 추가했다. Anthropic 제공자(E2)는 CLI에 연결되어 있어, 키·모델·출력 상한·한도가 모두 정해지면 실제로 전송한다. 실제 API로는 아직 검증하지 않았다(10절 "실제 API 미검증"). 단계 2(F1)의 재수정 반복, 새 한도, 보호 경로, 스냅샷과 되돌리기는 12~14절이며 모두 조립에 연결되어 있다. 교차 검토(H1·H2) 결함 수정 S-1~S-9의 CLI 처리는 8·11절이다.

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
| `src/verify/index.ts` (K2) | `createIntegrityChecker` | `CreateIntegrityChecker` = `({ workspace, protectedPaths, externalPaths }) => IntegrityChecker`(15절) |
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
옵션: --config <config.json>  --vars-file <경로>  --cancel-file <경로>  --quiet
node dist/src/cli/main.js revert --workspace <디렉터리> --run <runId>
node dist/src/cli/main.js report --workspace <디렉터리> --run <runId> [--json]
node dist/src/cli/main.js doctor [--config <파일>] [--vars-file <파일>] [--task <task.json> | --workspace <디렉터리>] [--json]
node dist/src/cli/main.js --help | help <명령> | <명령> --help | --version
```

- `revert`는 14절이다. `--workspace`와 `--run` 둘 다 필요하고 다른 옵션은 받지 않는다. runId는 영숫자로 시작하는 1~128자의 영숫자·`.`·`_`·`-`이며 `..`를 포함할 수 없다. 어기면 `invalid_arguments`다. `--workspace`가 UNC나 장치 경로이면 파일 시스템에 닿기 전에 `invalid_arguments`다(T-12).
- `report`, `doctor`, 도움말, 버전, `--quiet`은 15절이다. `npm run build` 뒤 `npm link`를 하면 `node dist/src/cli/main.js` 대신 `codaryn`으로 실행할 수 있다.

- task 파일 형식은 1a와 같다. scripted 모델은 키 없이 실행된다.
- 간편 형식(`--workspace`, `--goal`)은 task 파일 없이 설정 파일의 기본값으로 실행한다. 제공자는 항상 anthropic이다(11절).
- `--task`와 간편 형식은 함께 쓸 수 없다. `--workspace`와 `--goal`은 함께 써야 한다. 같은 옵션을 두 번 쓰거나 모르는 옵션을 쓰면 `invalid_arguments`다.
- task 파일과 설정 파일에는 비밀 값이나 API 키를 넣지 않는다.
- 취소는 `SIGINT`/`SIGTERM`, 또는 `--cancel-file`로 지정한 파일이 생기는 것으로 받는다(P-2). 둘 다 `EngineDeps.signal`을 abort한다. 취소 파일은 작업 공간 밖이어야 한다. 실행이 그 파일을 만들어 스스로 취소하지 못하게 하기 위해서이며, 안이면 `invalid_arguments`다(T-12).
- `--env-file`은 받지 않는다(`invalid_arguments`, T-15). Node 26은 스크립트 이름 뒤의 `--env-file`도 스스로 읽어서, 없는 파일이면 CLI보다 먼저 종료 9로 끝나고 UNC 경로면 CLI의 검사보다 먼저 접근한다. 변수 파일은 `--vars-file`로 준다.

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

- `workspaceRoot`와 `scriptPath`는 절대 경로이거나 task 파일의 디렉터리 기준 상대 경로다. 네트워크·장치 경로는 쓸 수 없다(11절 "파일 위치 규칙", S-5). 허용 루트는 `workspaceRoot` 하나다. task 파일과 대본 파일은 작업 공간 밖에 둔다(S-1). `workflow`는 표시용 문자열이며 엔진은 이 값으로 분기하지 않는다.
- `privacy.secretEnv`에는 환경 변수 이름만 적는다(`^[A-Za-z_][A-Za-z0-9_]*$`, S-3). 값은 실행 시 환경에서 읽어 비밀로 등록한다. 오류 메시지는 `privacy.secretEnv[i]`처럼 위치만 적고 항목을 적지 않는다.
- 권한은 경로, 명령(`executable`과 `args`), 네트워크, 파괴적 동작을 각각 판정한다. `network`와 `destructive`는 1a에서 `"deny"`만 있다. 네트워크 차단이 아니라 네트워크를 쓰는 도구가 없다는 뜻이다.
- `model.provider`가 `"anthropic"`이면 `model`에 선택 필드 `model`(모델 ID)과 `maxOutputTokens`(요청당 출력 토큰 상한, `MAX_OUTPUT_TOKENS_LIMIT` 200,000 이하, T-14)를 둘 수 있다. scripted에는 이 필드를 쓸 수 없다. 키, 모델, 출력 상한 중 하나라도 정해지지 않으면 `provider_not_configured`로 전송 없이 끝난다(11절).
- `limits`와 그 필드는 설정 파일이 채울 수 있으면 생략해도 된다. 설정 파일의 한도는 상한이다. task는 필드마다 그 값 이하로만 정할 수 있다(11절 "한도", S-7). 예산 한도 넷(`maxModelTurns`, `maxToolCalls`, `maxTotalTokens`, `maxDurationMs`) 중 어디에도 없는 필드가 있으면 `invalid_task`다. anthropic 제공자에서는 `maxTotalTokens: null`을 쓸 수 없다.
- 재수정 한도 `maxRepairAttempts`(0 이상 정수)와 `maxSameFailures`(1 이상 정수)는 두 파일 모두에서 생략할 수 있고, 그때는 0과 2다(`DEFAULT_MAX_REPAIR_ATTEMPTS`, `DEFAULT_MAX_SAME_FAILURES`). 0이면 단계 1과 같이 첫 검증 실패에서 끝난다(12절).
- `policy.protectedPaths`는 선택이다(13절).
- 파일 형식은 `TaskSpec`, CLI가 해석해 엔진에 넘기는 형은 `ResolvedTaskSpec`(경로는 절대 경로, 한도 여섯 개가 모두 정해짐)이다. `EngineDeps.task`는 `ResolvedTaskSpec`이다.
- task 파일과 설정 파일은 UTF-8이며 BOM이 있어도 읽는다.
- 검증기는 `command`(`executable`, `args`, 선택 `cwd`·`timeoutMs`·`expectExitCode`)와 `file_rules`(`exists`, `absent`, `contains`, `not_contains`) 두 종류다. `timeoutMs`는 1~2,147,483,647ms다(S-7). 결과에는 `outcome`(pass/fail/inconclusive), `evidence`, `checked`, `limits`가 있다.

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

stdout에는 출력 하나만 쓴다. `run`과 `revert`는 JSON 한 줄이다(`run`은 `CliOutput`, `revert`는 `RevertOutput` 또는 `CliErrorOutput`). `report`와 `doctor`는 기본이 사람이 읽는 글이고, `--json`이면 `ReportOutput`·`DoctorOutput` JSON 한 줄이다. 어느 명령이든 오류는 `CliErrorOutput` JSON 한 줄이다(이 JSON들을 합쳐 `CommandOutput`). `--help`와 `--version`은 글이다. `run`의 진행 표시는 stderr다(15절 U-8).

- 명령 밖으로 새어 나온 예외는 최상위(`src/cli/guard.ts`의 `runGuarded`)에서 잡아 `internal_error`(종료 70) 한 줄로 바꾼다. 예외 문구와 스택은 경로·파일 내용·비밀 값을 담을 수 있으므로 stdout과 stderr 어디에도 출력하지 않는다(S-6).

- 실행 결과 `EngineResult`: `schemaVersion`, `kind:"run"`, `runId`, `taskId`, `status`, `reason`, `exitCode`, `provider`, `verifiers`, `changes`, `usage`, `journalPath`, `notices`.
  - `verifiers`는 마지막 검증 회차의 결과다. 재수정 뒤 검증 전에 한도로 끝나면 직전 회차의 결과가 남는다. 회차마다의 결과는 기록의 `verifier_result`에 모두 있다.
  - `usage.repairAttempts`는 시작한 재수정 수다. 단계 2 엔진은 항상 채운다(단계 1 기록에는 없다).
- 되돌리기 결과 `RevertOutput`: `schemaVersion`, `kind:"revert"`, `runId`, `status`(`complete`/`partial`), `exitCode`, `reverted[{path, action}]`, `skipped[{path, reason}]`(14절).
- 실행 전 오류 `CliErrorOutput`: `schemaVersion`, `kind:"error"`, `code`, `exitCode`, `message`.
- 상태별 종료 코드(`RUN_EXIT_CODES`): `done` 0, `failed` 1, `needs-input` 3, `budget-exhausted` 4, `cancelled` 5.
- 되돌리기 종료 코드(`REVERT_EXIT_CODES`): `complete` 0, `partial` 3.
- 실행 전 오류(`CLI_ERROR_EXIT_CODES`): `invalid_arguments`·`invalid_task`·`invalid_config`·`key_in_file`·`invalid_script`·`secret_env_missing`·`workspace_not_found`·`run_not_found`·`invalid_run_record` 2, `workspace_locked` 6, `provider_not_configured`·`provider_not_implemented` 7, `internal_error` 70. 단계 3에서 `workspace_is_install_dir` 2가 더해졌다(15절).
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
- Windows의 `.cmd`·`.bat`(G1, T-1): 이름은 자식이 받는 환경의 `PATH`와 `PATHEXT`로 찾는다(작업 디렉터리와 상대 `PATH` 항목은 찾지 않는다). 스크립트가 작업 공간 밖에 있고 스크립트 경로와 모든 인자가 좁은 문자 집합 안일 때만 `cmd.exe /d /s /c`로 실행한다. 그 밖에는 `spawn_failed`(`script_refused`)다. 실행 조립이 명령 실행기에 작업 공간 루트를 넘기므로 실제 CLI에서도 동작한다(T-1).
- 파일 해시가 모델과 기록에 노출되어 짧은 비밀이 든 파일은 추측 검증이 가능하다(P-7).

알려진 한계(1b 설정):

- 키 값 검사는 Anthropic 키 모양과 현재 `ANTHROPIC_API_KEY` 값만 찾는다. 다른 형식의 키나 잘린 키는 찾지 못한다.
- `--vars-file`로 읽은 값은 CLI 프로세스의 환경에 들어간다. 자식 프로세스에는 `CHILD_ENV_ALLOWLIST`만 전달되므로 키는 넘어가지 않는다. 허용 목록의 변수라도 값에 등록된 비밀이 들어 있으면 넘기지 않는다(T-1, `envValueFreeOfSecrets`).

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

- 스냅샷은 변경 전 원문이므로 비밀이 들어 있을 수 있다. 작업 공간의 원본 파일과 같은 수준의 로컬 자료로 다룬다. 기록·모델 요청·stdout에는 넣지 않지만 디스크에는 남는다. 보관 기간 자동 관리는 없다(R-8).
- 스냅샷은 파일 도구로는 닿을 수 없지만, 정책이 허용한 명령은 사용자 권한으로 실행되므로 읽을 수 있다(T-11). 되돌릴 필요가 없어진 실행은 `.codaryn/runs/<runId>/`를 지운다.
- 재수정을 켜면(`maxRepairAttempts` > 0) 명령형 검증기가 모델이 쓴 코드를 실행하고, 그 출력(가린 뒤)이 재수정 메시지로 모델에 돌아간다(T-7). OS 격리가 없는 동안의 한계다. 모델이 쓴 코드를 실행해도 되는 작업 공간에서만 켠다.
- 명령이 끝난 뒤에도 분리된 자손 프로세스(예: 백그라운드로 띄운 서버)는 남을 수 있다. 트리 종료는 자식이 살아 있을 때만 한다(T-2).
- 가림은 출력 끝의 여유 구간(4096바이트) 안에서 잘린 비밀 변형까지 다룬다. 그보다 긴 변형이 경계에서 잘리면 일부가 가려지지 않을 수 있다.
- 보호 경로는 파일 도구의 쓰기만 막는다. 정책이 허용한 명령(`run_command`)과 명령형 검증기는 보호 경로의 파일도 바꿀 수 있다.
- 명령이 바꾼 파일은 `file_changed`와 스냅샷에 남지 않으므로 되돌리기 대상이 아니다.
- 실패 근거에 실행 시간이나 임시 경로처럼 매번 바뀌는 내용이 있으면 서명이 달라져 같은 실패로 판정되지 않는다. 그때는 `maxRepairAttempts`와 예산 한도만 반복을 멈춘다.
- 경로에 등록된 비밀이 든 파일은 기록에 토큰으로 남아 스냅샷과 맞출 수 없다. 되돌리기에서 `missing_snapshot`으로 건너뛴다.
- 같은 실행을 두 번 되돌리면 두 번째에는 현재 해시가 실행이 남긴 해시와 달라 `changed_since_run`으로 보고된다.
- 실행 중 다른 프로세스가 같은 파일을 바꾸면 스냅샷(그 실행이 처음 쓰기 직전에 읽은 원문)과 실제 실행 전 상태가 다를 수 있다.

알려진 한계(교차 검토 수정 S-1~S-9):

- 파일 위치 확인과 파일 읽기 사이에 링크를 바꿔치기하면 막지 못한다(확인과 사용 사이의 경쟁).
- 작업 공간 밖의 하드 링크가 작업 공간 안 파일과 같은 내용을 가리키면 밖으로 판정된다. 파일 도구는 이름을 새 파일로 교체하므로 그 링크를 바꾸지 못하지만, 허용된 명령은 제자리에서 고칠 수 있다.
- 키 모양 검사는 Anthropic 키 형식(`sk-ant-`)과 현재 키(16자 이상)뿐이다. 다른 서비스 토큰과 키의 인코딩 변형은 잡지 않는다.
- env 파일이 새로 설정한 8자 이상 값은 모두 비밀로 등록하므로 `postgres` 같은 흔한 값도 가려질 수 있다(S-4의 부작용).
- 작업 디렉터리가 UNC 경로이면 모든 상대 경로가 거부된다. POSIX에서는 `/dev/` 아래만 장치 경로로 본다.

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
- `apiBaseUrl`(S-9): `https:` 주소이고, `http:`는 루프백 호스트(`localhost`, `127.0.0.1`, `[::1]`)에만 허용한다(가짜 서버 시험용). 다음은 쓸 수 없다.
  - 사용자 정보
  - `?`와 `#`. 끝에 홀로 있는 것도 포함한다.
  - 제어 문자, 공백, 백슬래시
  - `/v1`, `/v1/messages`로 끝나는 경로. 제공자가 `/v1/messages`를 붙이기 때문이다.
  - 끝의 `/`는 뗀다.
- `maxRetries`는 0~10 정수다. `requestTimeoutMs`는 1~2,147,483,647ms다(S-7). 다른 수는 양의 정수다.
- `limits`는 상한이다(아래 "한도"). 일부 필드만 적어도 되고, 재수정 한도 두 필드도 적을 수 있다.
- `policy`와 `verifiers`는 간편 형식에만 쓴다. task 파일은 자기 값을 적는다. 간편 형식에서 `policy`가 없으면 `DENY_ALL_POLICY`(명령 없음)를 쓰고, `verifiers`가 없으면 `needs-input`/`no_verifier`로 끝난다.
- `secretEnv`는 두 형식 모두에서 task의 `privacy.secretEnv`에 더한다. 이름 규칙은 `^[A-Za-z_][A-Za-z0-9_]*$`다(S-3). 미설정 메시지는 `secretEnv[i]`나 `privacy.secretEnv[i]`처럼 그 이름이 나온 파일의 위치만 적는다.

### 파일 위치 규칙 (S-1, S-5)

- **네트워크·장치 경로 금지(S-5).** 다음 값은 파일 시스템에 접근하기 전에 적힌 그대로와 절대 경로로 바꾼 뒤 모두 검사한다.
  - 대상: `--task`, `--config`, `--vars-file`, `--cancel-file`, 간편 형식 `--workspace`, `CODARYN_CONFIG`, task의 `workspaceRoot`와 `scriptPath`, `revert --workspace`(T-12)
  - 거부하는 것: UNC(`\\server\share`), 장치 이름공간(`\\?\`, `\\.\`), DOS 장치 이름(`NUL`, `CON`, `COM1` 등), POSIX의 `/dev/` 아래
  - 오류 코드:
    - `--task`, `workspaceRoot`, `scriptPath`: `invalid_task`
    - `--config`, `--vars-file`, `CODARYN_CONFIG`: `invalid_config`
    - `--workspace`(run과 revert), `--cancel-file`: `invalid_arguments`
- **작업 공간 밖에 둘 것(S-1, T-12).** 작업 공간을 확인한 직후, 변수 파일, 설정 파일, task 파일, 대본 파일, 취소 파일의 실경로가 작업 공간 실경로 안에 있으면 실행 전에 거부한다.
  - 실경로는 링크, 정션, 8.3 이름을 푼 경로다.
  - 위치를 확인할 수 없는 경우(끊긴 링크, 권한 오류)도 거부한다.
  - Windows에서 작업 공간 루트 디렉터리의 대체 데이터 스트림(`<작업 공간>:cfg`)도 작업 공간 안이다(T-14).
  - 오류 코드: 변수·설정 파일은 `invalid_config`, task 파일은 `invalid_task`, 대본 파일은 `invalid_script`, 취소 파일은 `invalid_arguments`
  - 이유: 모델이 작업 공간 안 파일을 고쳐 다음 실행의 API 주소, 정책, 검증기, 한도를 바꾸지 못하게 한다.

### 환경 변수와 변수 파일 (`--vars-file`)

| 이름 | 뜻 |
| --- | --- |
| `ANTHROPIC_API_KEY` | API 키. 이 환경 변수로만 받는다(C-1) |
| `CODARYN_MODEL` | 모델 ID |
| `CODARYN_CONFIG` | 설정 파일 경로. `--config`가 없을 때 쓴다 |
| `CODARYN_API_BASE_URL` | API 주소. 설정 파일의 `apiBaseUrl`보다 우선한다 |

- 비어 있거나 공백뿐인 값은 설정되지 않은 것으로 본다.
- `--vars-file <경로>`를 줄 때만 그 파일을 `process.loadEnvFile`로 읽는다(C-2, T-15). `.env`를 자동으로 찾지 않는다. 이미 설정된 환경 변수가 파일 값보다 우선한다. 형식은 env 파일과 같다.
- BOM이 있는 변수 파일은 첫 변수를 조용히 놓치므로 `invalid_config`로 거부한다.
- 변수 파일이 새로 설정한 변수의 값은 비밀로 등록된다(S-4). 그래서 파일 내용이나 명령 출력에 나타나면 가려진다. 다음은 등록하지 않는다.
  - 이미 설정돼 있던 변수. Windows에서는 대소문자를 무시해 비교한다.
  - `CODARYN_MODEL`, `CODARYN_CONFIG`, `CODARYN_API_BASE_URL`
  - 8자 미만 값
  - 앞뒤 공백을 떼면 값이 달라지는 경우에는 두 형태를 모두 등록한다.
- 변수 파일은 작업 공간 밖에 둔다(S-1). `.env.example`을 작업 공간 밖의 폴더(예: `D:\codaryn\.env`)로 복사해 값을 채우고 `--vars-file`로 그 경로를 준다. 이 저장소의 `.env`는 Git이 무시한다.

### 우선순위

| 항목 | 순서(왼쪽이 우선) | 어디에도 없을 때 |
| --- | --- | --- |
| 키 | `ANTHROPIC_API_KEY` | `provider_not_configured` |
| 모델 | task `model.model` → `CODARYN_MODEL` → 설정 `model` | `provider_not_configured`. 코드 기본값 없음(C-4) |
| 출력 토큰 상한 | task `model.maxOutputTokens` → 설정 `maxOutputTokens` | `provider_not_configured` |
| API 주소 | `CODARYN_API_BASE_URL` → 설정 `apiBaseUrl` → `https://api.anthropic.com` | task로는 바꿀 수 없다(C-5) |
| 요청 시간 제한, 재시도 | 설정 → `DEFAULT_REQUEST_TIMEOUT_MS`(600000), `DEFAULT_MAX_RETRIES`(2) | 기본값 |
| 한도 | 필드마다 task `limits` → 설정 `limits`. 설정 값은 상한이다(아래) | task 형식은 `invalid_task`, 간편 형식은 `invalid_config`(C-6). 재수정 한도 둘은 0과 2 |

해석한 값은 `ResolvedAnthropicSettings`로 제공자에 전달한다. 키는 메모리에만 둔다. `ANTHROPIC_API_KEY`가 설정되어 있으면(앞뒤 공백을 뗀 값) 제공자와 관계없이 scripted 실행에서도 비밀로 등록하므로, 파일 내용이나 명령 출력에 나타나면 가려진다(S-2). `CODARYN_API_BASE_URL`에도 설정 파일의 `apiBaseUrl`과 같은 엄격한 규칙을 적용한다(S-9).

### 한도 (S-7)

- **설정 파일의 한도는 상한이다.**
  - task 값이 설정 값보다 크면 `invalid_task`다.
  - 설정이 숫자인데 task가 `maxTotalTokens: null`이면 상한을 푸는 것이므로 `invalid_task`다.
  - 설정이 `null`이면 그 필드는 절대 상한만 적용한다.
  - 설정에 없는 필드는 task 값을 쓴다.
- **anthropic 제공자는 `maxTotalTokens: null`을 쓸 수 없다.** task가 준 `null`이면 `invalid_task`, 설정이 준 `null`이면 `invalid_config`다. scripted는 `null`을 허용한다.
- **코드의 절대 상한(`ABSOLUTE_LIMITS`):**
  - 턴 1000
  - 도구 호출 5000
  - 총 토큰 50,000,000
  - 실행 시간 86,400,000ms(24시간)
  - `maxRepairAttempts` 20, `maxSameFailures` 10. 이 둘은 PM 승인 대기 중인 제안값이다.
- 모든 시간 값은 2,147,483,647ms 이하다(`requestTimeoutMs`, 검증기 `timeoutMs`).
- 메시지에는 필드와 규칙만 적고 파일의 숫자는 적지 않는다.

### 키 거부 (`key_in_file`)

설정 파일과 task 파일은 다른 검사보다 먼저 확인한다(C-1, S-6). 다음이 하나라도 있으면 종료 코드 2로 거부한다.

1. **원문 검사.** 두 파일의 원문(`JSON.parse` 전)에 키 모양 값이나 현재 키가 있으면 거부한다. 이 경우 메시지에 위치를 적지 않는다. 중복 필드처럼 파싱하면 사라지는 값도 잡는다. JSON 문자열의 `\uXXXX` 같은 이스케이프를 푼 원문에도 같은 검사를 한다(T-14).
2. **파싱 뒤 검사.** 반복 순회로 다음을 찾는다.
   - 어느 깊이든 키 필드 이름. NFKC 정규화 뒤 소문자로 바꾸고 영숫자만 남긴 이름이 `KEY_FIELD_NAMES`(`apikey`, `key`, `secret`, `token`, `password` 등)에 있거나 `apikey`를 포함하면 키 필드다. 예: `apiKey`, `api_key`, `x-api-key`, `ANTHROPIC_API_KEY`, 전각 `ａｐｉＫｅｙ`.
   - Anthropic 키 모양의 값(`ANTHROPIC_KEY_PATTERN_SOURCE`)
   - 현재 `ANTHROPIC_API_KEY` 값과 같은 문자열(16자 이상일 때)
3. **위치 문자열.** task·설정 스키마의 필드 이름, 키 필드 이름과 정확히 같은 이름(영문자·`_`·`-`만, 예: `apiKey`, `api_key`, `token`), `ANTHROPIC_API_KEY`만 그대로 적고, 나머지는 `<field>`로 적는다(예: `<field>.<field>`). `apikeyAbc123`처럼 키 필드 이름에 다른 문자가 붙은 이름도 `<field>`다(T-14).
4. **깊이 상한.** 컨테이너가 64단계(`MAX_KEY_SCAN_DEPTH`)보다 깊으면 키가 아니라 형식 오류다. task 파일은 `invalid_task`, 설정 파일은 `invalid_config`다.
5. **`--goal`(S-8).** 간편 형식의 `--goal`에 키 모양 값이나 현재 키가 있으면 파일을 읽기 전에 `key_in_file`로 거부한다. goal은 모델에 전송되고 기록에 남기 때문이다(가린 뒤).

### 처리 순서

1. 인자. 명령줄 경로가 로컬 경로인지 확인한다(S-5).
2. `--vars-file`. 읽기 → BOM 거부 → 적재 → 새로 설정된 값을 고른다(S-4). `--env-file`은 1단계에서 거부한다(T-15).
3. 현재 키, `CODARYN_CONFIG` 경로 확인(S-5), `--goal` 키 검사(S-8).
4. 설정·task 파일. 읽기 → 원문 키 검사 → 파싱 → 파싱 뒤 키 검사와 깊이 상한(S-6).
5. 설정 검증(S-3, S-7, S-9) → task 검증(S-3, S-5, S-7) 또는 간편 형식 구성.
6. 작업 공간 확인 → 설치 위치와 겹치지 않는지(U-3) → 파일 위치 확인(S-1, 취소 파일 포함 T-12) → `integrity.paths`의 존재와 위치(U-1).
7. 비밀 값: `secretEnv`(S-3), 키(S-2), 변수 파일 값(S-4).
8. 제공자 설정 해석과 제공자 생성(S-9) → 조립과 실행.

명령 밖으로 새어 나온 예외는 `internal_error`(종료 70) 한 줄이 된다(8절).

### 실행 예시 (PowerShell)

env 파일, 설정 파일, task 파일은 작업 공간(`D:\work\notes`) 밖의 폴더(`D:\codaryn`)에 둔다(S-1).

```powershell
# 1) 간편 형식: 키와 모델은 작업 공간 밖의 변수 파일, 한도·정책·검증기는 설정 파일
Copy-Item .env.example D:\codaryn\.env   # 값을 채우고 UTF-8(BOM 없음)으로 저장한다
node dist/src/cli/main.js run --workspace D:\work\notes --goal "README에 설치 절을 추가한다" `
  --config D:\codaryn\config.json --vars-file D:\codaryn\.env

# 2) task 파일: 모델은 환경 변수, 빠진 한도는 설정 파일이 채운다(설정 값보다 크게 둘 수 없다)
$env:CODARYN_MODEL = "<모델 ID>"
$env:CODARYN_CONFIG = "D:\codaryn\config.json"
node dist/src/cli/main.js run --task D:\codaryn\task.json --vars-file D:\codaryn\.env

# 3) 로컬 가짜 서버로 시험할 때(E3)
$env:CODARYN_API_BASE_URL = "http://127.0.0.1:8123"

# 4) 실행이 바꾼 파일을 되돌린다(runId는 실행 결과의 runId)
node dist/src/cli/main.js revert --workspace D:\work\notes --run 20261112T031500Z-9f2c41ab
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
- 항목 형식은 정책 모듈의 `checkProtectedPaths` 하나가 정한다(T-13). CLI와 게이트가 같은 판정을 한다. 문제가 있으면 task에서는 `invalid_task`, 설정 파일에서는 `invalid_config`이고, 메시지는 `policy.protectedPaths[i]`처럼 위치만 적는다.
  - 상대 경로이며 `/`나 `\`로 나눈다.
  - 거부: 배열이 아님, 문자열이 아님, 빈 값(공백뿐 포함), 절대 경로(`/x`, `C:\x`, `C:x`, `\\server\share`), `..` 조각, Windows에서 일반 파일 이름이 될 수 없는 이름(끝의 점·공백, `|` 같은 금지 문자, `:`, `nul` 같은 장치 이름), NUL 문자
  - CLI는 검증만 하고 적힌 그대로 정책에 넘긴다. 게이트는 같은 함수가 거부하는 값을 받으면 모든 쓰기를 거부한다(fail closed).
- 항목 자체가 링크(정션, 심볼릭 링크)이면 그 실경로도 보호한다. 판정할 때마다 항목을 실경로로 풀므로 실행 중에 생긴 링크도 반영된다. 항목의 실경로가 작업 공간 밖이면(끊긴 링크 포함) 그 항목은 쓸 수 없는 것으로 보고 모든 쓰기를 거부한다(T-13). 이 확인은 실행 중 정책 단계에서만 하므로, 그런 항목은 실행 전에 알리지 않고 쓰기마다 `protected_path`가 된다.
- task 파일이나 설정 파일(간편 형식의 `policy`)만 정할 수 있다. 모델, task의 다른 필드, 작업 공간의 파일로는 풀 수 없다. 생략하거나 빈 목록이면 보호 경로가 없다.
- 판정은 정책(`src/policy`, F2)이 한다. CLI는 검증한 값을 `task.policy`로 넘기고, 조립이 그 값으로 `createPolicyGate`를 만든다.

## 14. 스냅샷과 되돌리기 (R-6, R-7)

### 스냅샷 (`ChangeRecorder`)

- `write_file`은 검사를 통과한 뒤 쓰기 직전에 `ChangeRecorder.saveOriginal(path, original)`을 부른다. `original`은 읽은 원문 그대로(BOM 포함)이고, 파일이 없었으면 `null`이다. 이 호출이 실패하면 쓰지 않고 `io_error`다.
- 저장 위치는 `<작업 공간>/.codaryn/runs/<runId>/snapshots/`다. 내부 배치는 저장소(F3)가 정한다. 한 실행에서 같은 경로는 첫 원문만 보관한다.
- 스냅샷은 기록(journal), 모델 요청, stdout에 넣지 않는다. 상태 디렉터리 안에 있으므로 파일 도구는 접근할 수 없다. 정책이 허용한 명령은 읽을 수 있다(T-11). 되돌릴 필요가 없어진 실행은 `.codaryn/runs/<runId>/`를 지운다.

### 되돌리기 (`codaryn revert --workspace <디렉터리> --run <runId>`)

1. 인자를 확인한다(`invalid_arguments`). 작업 공간이 디렉터리가 아니면 `workspace_not_found`다.
2. `<작업 공간>/.codaryn/runs/<runId>/journal.jsonl`이 없으면 `run_not_found`다. 상태 디렉터리를 새로 만들지 않는다.
3. 작업 공간 잠금을 자기 id로 잡는다. 실행 중인 작업이 있으면 아무것도 바꾸지 않고 `workspace_locked`다.
4. `revertRun({ workspaceRoot, runId })`: journal의 `file_changed`에서 경로별로 처음 나온 순서대로 한 번씩 다룬다. 그 경로의 마지막 `newHash`가 현재 파일 해시와 같을 때만 스냅샷으로 원래 바이트를 복원하고(`restored`), 원문이 `null`이면 파일을 지운다(`deleted`). 다르거나 파일이 없으면 건드리지 않고 `changed_since_run`, 스냅샷이 없으면 `missing_snapshot`, 그 파일의 읽기·쓰기 실패는 `io_error`로 건너뛴다. 한 파일의 실패는 나머지를 막지 않는다.
5. `revertRun`은 아무것도 바꾸기 전에만 `RevertRunError`로 거부한다. 코드가 `run_not_found`면 `run_not_found`, 그 밖(journal을 읽거나 해석할 수 없음)은 `invalid_run_record`다. 오류 문구는 출력에 옮기지 않는다.
6. 잠금을 놓고 `RevertOutput`을 출력한다. 건너뛴 파일이 없으면 `complete`(종료 0), 있으면 `partial`(종료 3)이다.

- 출력의 `path`는 journal에 기록된 경로(가림본)다. 스냅샷의 원문 경로나 내용은 출력하지 않는다.
- 되돌리기는 journal에 기록을 더하지 않는다.

### 연결 상태 (연결 완료)

- 엔진의 재수정 반복과 CLI의 새 한도·보호 경로 전달은 연결되어 있다.
- 실행 조립(`src/cli/assemble.ts`의 `assembleRun`)은 실행마다 `createChangeRecorder({ workspaceRoot, runId })`를 만들어 `createToolRunner`의 `changeRecorder`로 넘긴다. 따라서 `write_file`은 쓰기 전에 원문을 스냅샷으로 남긴다.
- `src/cli/main.ts`는 `revert` 명령에 `createRevertCommand(revertRun)`을 넘긴다. 이 함수는 journal 확인, 잠금, `revertRun` 호출, 잠금 해제를 한다.
- 유닛 검증(`tests/unit/cli/sc-wire.test.ts`)에서 실제 저장소로 실행하고 되돌려 다음을 확인했다.
  - 원래 바이트가 복원된다.
  - 실행이 만든 파일이 지워진다.
  - 실행 뒤 사용자가 바꾼 파일은 건너뛰고 `partial`(종료 3)이다.
  - 스냅샷은 원문을 담고, journal과 result에는 비밀이 없다.
  - 모르는 runId는 `run_not_found`다.
- `revert`는 `RevertEnvironment.revert`가 없는 빌드에서만 `internal_error`(종료 70)로 아무것도 하지 않고 끝난다. 실제 CLI에는 해당하지 않는다.

## 15. 단계 3 계약 (U-1~U-3, U-5, U-6)

단계 3 준비(`docs/work-orders/phase-3-self-development.md`)의 계약과 CLI 처리다. K1은 계약(1단계)과 CLI 처리(2단계: U-3 검사, `integrity.paths` 검증, `report`, `doctor`, 도움말·버전, 진행 표시)를 구현했다. 무결성 모듈은 K2(`src/verify`), 엔진 연동은 K3(`src/engine`)다.

- 조립 연결: K1 커밋 시점의 조립은 무결성 확인기를 아직 만들지 않는다(`src/cli/assemble.ts`의 `INTEGRITY_CONNECTED`가 false). 그동안 `integrity.paths`가 있는 실행은 잠금 전에 `invalid_config`로 멈춘다. 설정한 확인이 조용히 빠지지 않게 하기 위해서다. `protectedPaths`만 있는 실행은 단계 2처럼 확인 없이 돈다.

### 보호 대상 무결성 (U-1, U-2)

- 설정 파일의 `integrity.paths`(`IntegrityConfig`)는 작업 공간 밖 검증 자료(기준 테스트, 검증 설정 등)의 절대 경로 목록이다. 간편 형식과 task 형식 모두에 적용되고, task 파일로는 정할 수 없다.
  - 최대 `MAX_INTEGRITY_PATHS`(64)개다. 배열이 아님, 빈 문자열, NUL, 상대 경로, UNC·장치 경로는 파일을 읽을 때 `invalid_config`다.
  - 실행 시작 전(잠금 전)에 각 경로가 있어야 하고, 실경로가 작업 공간 루트와 같거나, 그 안에 있거나, 그것을 포함하면 안 된다. 어기면 `invalid_config`이고 메시지는 `integrity.paths[i]`처럼 위치만 적는다.
- 모듈: `src/verify/index.ts`가 `createIntegrityChecker({ workspace, protectedPaths, externalPaths })`(`CreateIntegrityChecker`)를 export한다. `capture()`는 그 순간의 `IntegrityManifest`, `compare(before, after)`는 바뀐 표시 경로 목록(`RawText[]`)이다. 목록은 로컬 전용이며 기록·출력·전송하지 않는다.
- 항목(`IntegrityEntry`): `file`(바이트의 SHA-256), `link`(보호 항목 아래의 링크. 따라가지 않고 대상 문자열의 SHA-256), `absent`(없는 보호 항목), `unchecked`(`unreadable`은 읽거나 나열할 수 없음, `limit`은 상한 도달). 디렉터리는 자기 항목이 없고 그 아래 항목의 집합이다. 경로의 코드 단위 순으로 정렬하고 중복이 없다.
- 표시 경로: `protectedPaths` 항목과 그 아래는 작업 공간 기준 `/` 구분이며 정규화한 항목으로 시작한다(`./tests/`는 `tests`, `.`은 루트 내용). `integrity.paths` 항목과 그 아래는 `/` 구분 절대 경로다. 루트의 상태 디렉터리 `.codaryn`에는 들어가지 않는다. 보호 항목 자체가 링크면 실경로를 따라간다(T-13).
- 상한: 한 번 계산할 때 파일(링크 포함) `MAX_INTEGRITY_FILES`(10,000)개, `MAX_INTEGRITY_BYTES`(256 MiB)다. 도달하면 나열 중이던 항목과 그 뒤의 항목을 각각 `unchecked`/`limit` 항목 하나로 남긴다. `compare`는 어느 쪽에서든 `unchecked`인 경로를 바뀐 것으로 내므로, 보호 대상이 너무 많으면 실행은 첫 모델 요청 전에 `needs-input`/`protected_changed`로 끝난다(fail closed). 보호 대상을 줄여야 한다.
- 비교: 한쪽에만 있는 경로, 종류나 해시가 다른 경로, 어느 쪽에서든 `unchecked`인 경로를 정렬해 중복 없이 낸다. `compare(m, m)`은 `m`의 `unchecked` 경로다.
- 엔진(`EngineDeps.integrity`, 선택): CLI는 `policy.protectedPaths`나 `integrity.paths`에 항목이 있을 때만 넘긴다. 없으면 확인도 기록도 없다(단계 2와 같다). 있으면 다음과 같이 확인한다.
  - `run_start`: `run_started` 뒤, 첫 모델 요청 전. 기준 목록 = `capture()`, `changed = compare(기준, 기준)`.
  - `before_verify`: 검증 회차마다 검증기 실행 전. `changed = compare(기준, capture())`. 비어 있지 않으면 그 회차의 검증기를 실행하지 않는다.
  - `after_verify`: 그 회차의 검증기를 실행한 뒤. 같은 비교다.
  - 확인마다 기록 `integrity_checked { phase, changed }`(가림본)를 남긴다. `changed`가 비어 있지 않으면 검증 결과와 관계없이 바로 `needs-input`/`protected_changed`(종료 3)로 끝난다. 재수정하지 않고 모델 요청도 더 하지 않는다. 비교 기준은 항상 `run_start`의 목록이다.
- 결과: `EngineResult.protectedChanged`(선택)는 `integrity_checked`가 하나라도 기록된 실행에만 있고, 마지막 확인의 `changed`다. 바뀐 것이 없으면 빈 목록이며, 비어 있지 않으면 이유는 `protected_changed`다.
- 한계: 사후 탐지다. 변경을 막지 못하고, 바뀐 자료 위에서 한 검증을 믿지 않을 뿐이다. 두 확인 사이에 바뀌었다가 다음 확인 전에 되돌려진 변경과, 검증기 프로세스 안에서 일어나는 일(후보 코드가 이미 읽힌 테스트를 바꾸는 것 등)은 탐지하지 못한다. OS 격리가 아니다.

### 실행본 자기 보호 (U-3)

- `workspace_is_install_dir`(종료 2): 작업 공간의 실경로가 실행 중인 CLI의 설치 위치(진입 파일이 속한 패키지 루트)와 같거나, 그 안에 있거나, 그것을 포함하면 실행 전(잠금 전)에 거부한다. 아무것도 쓰지 않는다. 후보 작업 공간은 설치 위치 밖에 둔다.

### report (U-5)

- `codaryn report --workspace <디렉터리> --run <runId> [--json]`은 `.codaryn/runs/<runId>/`의 `result.json`과 `journal.jsonl`만 읽어(가림본) 사람이 읽는 Markdown 요약을 stdout에 낸다. `--json`이면 `ReportOutput` 한 줄이다. 아무것도 바꾸지 않고 잠금도 잡지 않는다.
- 상태(`REPORT_EXIT_CODES`): `complete`(0)는 둘 다 읽음, `incomplete`(3)는 `result.json`이 없음(실행 중이거나 쓰지 못하고 멈춤)이다. `incomplete`는 기록만으로 만들고, 줄바꿈 없는 마지막 줄은 아직 쓰는 중으로 보고 무시한다.
- 오류(`CliErrorOutput`): `invalid_arguments`, `workspace_not_found`, `run_not_found`(그 실행의 기록이 없음), `invalid_run_record`(읽기·해석 실패, `MAX_REPORT_FILE_BYTES`(256 MiB) 초과, 다른 실행의 파일).
- `ReportOutput`: `schemaVersion`, `kind:"report"`, `runId`, `status`, `exitCode`, `result`(`EngineResult` 또는 null), `journal`(`ReportJournalSummary`: 작업 id, 워크플로, 제공자, 한도, 기록 수, 모델 요청 수, 거부된 도구 호출 수, 재수정 수, 마지막 검증 회차, 변경 목록, 무결성 확인, 종료 기록).
- 한계: 보고서는 이 두 파일만큼만 믿을 수 있다. 상태 디렉터리는 파일 도구에만 닫혀 있으므로 실행 중 허용된 명령이 바꿀 수 있다.

### doctor (U-6)

- `codaryn doctor [--config <파일>] [--vars-file <파일>] [--task <task.json>] [--workspace <디렉터리>] [--json]`은 네트워크 접속, 모델 요청, 쓰기 없이 점검한다. 기본 출력은 항목마다 한 줄의 글이고, `--json`이면 `DoctorOutput` 한 줄이다.
- 항목(`DOCTOR_CHECK_IDS` 순서): `node_version`, `config_file`, `vars_file`, `task_file`, `api_key`, `model`, `limits`, `file_locations`, `commands`, `workspace`, `install_dir`, `integrity_paths`. 상태는 `ok`/`warn`/`fail`/`skipped`(볼 대상이 없음)다.
- 종료(`DOCTOR_EXIT_CODES`): 가장 나쁜 항목에 따라 `ok` 0, `warn` 3, `fail` 1이다(`skipped`는 `ok`로 센다). 인자 오류는 `invalid_arguments`(`CliErrorOutput`)다.
- 메시지는 고정 문구, 필드 위치(`policy.commands[2]` 등), 개수로만 만든다. 파일이나 환경에서 읽은 값은 내지 않으며, 키는 있음·없음만 적는다.

### 실행본 자기 보호의 세부 (U-3)

- 설치 위치는 진입 파일(`dist/src/cli/main.js`)에서 위로 올라가며 처음 만나는, `name`이 `codaryn`인 `package.json`의 디렉터리다. `npm link`와 전역 설치 모두 이 배치를 유지한다. 찾지 못하면 확인할 수 없으므로 모든 실행을 `workspace_is_install_dir`로 거부한다(fail closed).
- 비교는 실경로(링크, 정션, 8.3 이름을 푼 뒤)로 하고 Windows에서는 대소문자를 구분하지 않는다. 처리 순서는 11절 6단계다.
- 후보 작업 공간은 설치 위치 밖에 둔다. 예를 들어 `D:/project/Codaryn`에서 빌드한 CLI로는 그 아래 `.worktrees/...`를 작업 공간으로 쓸 수 없다.

### report의 세부 (U-5)

- Markdown 절: 실행 요약(실행 id, 작업, 제공자, 결과), 검증(마지막 회차, 통과하지 않은 검증기의 증거), 보호 대상, 변경, 사용량, 검사하지 않은 범위(검증기마다의 한계와 고정 문구), 알림.
- 실행 디렉터리가 링크(정션 포함)이면 따라가지 않고 `invalid_run_record`다. 기록은 모두 그 실행의 것이어야 하고(`runId`, 1부터 연속인 `seq`, 첫 기록 `run_started`), 보고서가 쓰는 필드는 형식을 확인한다. 모르는 종류의 기록은 건너뛴다. `result.json`은 확인한 필드만으로 다시 만든다.
- 출력 글의 제어 문자(ESC, CR, 양방향 제어 문자 등)는 `?`로 바꾸고, 인라인 코드와 코드 블록은 내용 속 백틱보다 긴 울타리를 쓴다. 키 모양 문자열과 현재 `ANTHROPIC_API_KEY` 값은 `[key]`로 가린다. 기록이 실행 중 명령으로 바뀌었을 경우를 위한 방어이며, 등록된 다른 비밀 값은 report가 알지 못한다.

### doctor의 세부 (U-6)

- 변수 파일은 `util.parseEnv`로 해석만 하고 프로세스 환경에 적재하지 않는다. 이미 있는 변수가 우선한다(`run`과 같다).
- 설정·task 파일은 `run`과 같은 순서(원문 키 검사 → 파싱 → 키 검사 → 검증)로 본다. 실패 메시지는 검증기의 필드 위치 문구다.
- `commands`: 정책의 `commands[i].executable`과 명령 검증기의 `executable`을 PATH의 절대 항목과 PATHEXT(Windows)로 찾는다. 디렉터리가 붙은 이름은 작업 공간(검증기는 그 `cwd`) 기준이다. 실제 실행 때의 추가 거부(작업 공간 안의 실행 파일, `.cmd`·`.bat`의 문자 제한 등)는 점검하지 않는다.
- `integrity_paths`: 무결성 확인이 연결되지 않은 빌드에서는 `fail`이다.
- 현재 `warn`을 내는 항목은 없다. 계약에는 남겨 둔다.

### 도움말, 버전, 설치 (U-7)

- `codaryn --help`(`-h`, `help`), `codaryn help <명령>`, `codaryn <명령> --help`, `codaryn --version`(`-v`, `version`)은 stdout에 글을 쓰고 종료 0이다. 버전은 설치 위치의 `package.json`에서 읽는다. 모르는 명령의 도움말 요청은 `invalid_arguments`다.
- `package.json`: `bin.codaryn`은 `dist/src/cli/main.js`(첫 줄 `#!/usr/bin/env node`), `files`는 `dist/src`, `README.md`, `LICENSE`다. 설치 절차는 `npm ci` → `npm run build` → `npm link`다.
- K1에서는 `npm link`를 실행하지 않았다(작업 디렉터리 밖의 전역 위치에 쓰기 때문). 유닛은 `bin`, `files`, shebang, 진입 파일에서 설치 위치와 버전을 찾는 것까지만 확인한다.

### 진행 표시 (U-8)

- `run`은 실행이 시작된 뒤 기록마다 stderr에 `codaryn: `로 시작하는 한 줄을 쓴다. 실행 시작, 턴 번호, 도구 허용·거부(권한/코드), 만들거나 바꾼 파일, 검증기 결과, 재수정 회차, 보호 대상 확인, 종료 상태가 대상이다. 모델 응답과 도구 결과는 쓰지 않는다.
- 줄은 기록(가림본)에서만 만들고, 실행의 개인정보 게이트로 다시 가린 뒤 제어 문자를 바꾼다. 내장 도구가 아닌 도구 이름은 `(unknown tool)`, 형식에 맞지 않는 id는 `?`로 쓴다.
- 실행 전 오류에는 진행 표시가 없다. `--quiet`이면 쓰지 않는다. stderr 쓰기 실패는 실행에 영향을 주지 않는다. stdout은 그대로 JSON 한 줄이다.
