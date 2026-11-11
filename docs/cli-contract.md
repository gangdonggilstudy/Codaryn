# 단계 1a CLI·공통 계약

`src/contracts/**`에 있는 타입과 상수를 설명한다. 코드와 다르면 코드가 기준이다. 현재 구현된 것은 계약 파일뿐이며 엔진, 도구, CLI, 테스트는 아직 없다. 실제 API는 호출하지 않는다.

## 1. import 규칙과 공개 진입점

모든 모듈은 `../contracts/index.js` 하나에서만 가져온다(ESM, NodeNext, 타입은 `import type`). `src/contracts/**`는 읽기 전용이다.

| 경로(후속 작업이 만든다) | export | 계약 타입 |
| --- | --- | --- |
| `src/privacy/index.ts` | `createPrivacyGateway` | `CreatePrivacyGateway` → `PrivacyGateway` |
| `src/policy/index.ts` | `createPolicyGate` | `CreatePolicyGate` → `PolicyGate` |
| `src/workspace/index.ts` | `createWorkspace` | `CreateWorkspace` → `Promise<Workspace>` |
| `src/engine/index.ts` | `runTask` | `RunTask` = `(deps: EngineDeps) => Promise<EngineResult>` |
| `src/cli/main.ts` | CLI 진입 파일 | `package.json`의 `bin.codaryn`이 `dist/src/cli/main.js`를 가리킨다 |

- `PrivacyGateway`: `mask(text)`, `resolveToolArgs(request)`, `rebuildDocument(request)`.
- `PolicyGate`: `checkRequested(call, descriptor)`, `restorableFields(descriptor)`, `checkEffective(call, descriptor)`.
- `Workspace`: `root`, `resolve(path, access)`, `readText(path)`, `list(dir)`, `writeText(request)`.
- 엔진 쪽: `ModelProvider.complete`, `ToolRunner.execute`, `VerifierRunner.run`, `Journal.append/close`, `Clock.now`.

## 2. 실행

```
node dist/src/cli/main.js run --task <task.json> [--cancel-file <경로>]
```

입력은 task 파일 하나다. 키 없이 실행된다. task에는 비밀 값이나 API 키를 넣지 않는다. 취소는 `SIGINT`/`SIGTERM`, 또는 `--cancel-file`로 지정한 파일이 생기는 것으로 받는다(P-2). 둘 다 `EngineDeps.signal`을 abort한다.

## 3. task.json (`TaskSpec`)

```json
{
  "schemaVersion": 1, "id": "doc-example", "workflow": "document",
  "goal": "README에 설치 절을 추가한다",
  "workspaceRoot": "./work",
  "model": { "provider": "scripted", "scriptPath": "./script.json" },
  "policy": { "commands": [{ "executable": "node", "argsPrefix": ["--test"], "allowExtraArgs": true }],
              "network": "deny", "destructive": "deny", "restorePathTokens": false },
  "privacy": { "secretEnv": ["CODARYN_TEST_SECRET"] },
  "limits": { "maxModelTurns": 8, "maxToolCalls": 16, "maxTotalTokens": null, "maxDurationMs": 60000 },
  "verifiers": [{ "id": "doc", "kind": "file_rules",
                  "rules": [{ "type": "contains", "path": "README.md", "text": "## 설치" }] }]
}
```

- `workspaceRoot`와 `scriptPath`는 절대 경로이거나 task 파일의 디렉터리 기준 상대 경로다. 허용 루트는 `workspaceRoot` 하나다. `workflow`는 표시용 문자열이며 엔진은 이 값으로 분기하지 않는다.
- `privacy.secretEnv`에는 환경 변수 이름만 적는다. 값은 실행 시 환경에서 읽어 비밀로 등록한다.
- 권한은 경로, 명령(`executable`과 `args`), 네트워크, 파괴적 동작을 각각 판정한다. `network`와 `destructive`는 1a에서 `"deny"`만 있다. 네트워크 차단이 아니라 네트워크를 쓰는 도구가 없다는 뜻이다.
- `model.provider`가 `"anthropic"`이면 `ANTHROPIC_API_KEY`나 `CODARYN_MODEL`이 없을 때 `provider_not_configured`, 있어도 `provider_not_implemented`로 전송 없이 끝난다.
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

stdout에는 JSON 한 줄(`CliOutput`)만 쓴다. 진행 표시는 stderr다.

- 실행 결과 `EngineResult`: `schemaVersion`, `kind:"run"`, `runId`, `taskId`, `status`, `reason`, `exitCode`, `provider`, `verifiers`, `changes`, `usage`, `journalPath`, `notices`.
- 실행 전 오류 `CliErrorOutput`: `schemaVersion`, `kind:"error"`, `code`, `exitCode`, `message`.
- 상태별 종료 코드(`RUN_EXIT_CODES`): `done` 0, `failed` 1, `needs-input` 3, `budget-exhausted` 4, `cancelled` 5.
- 실행 전 오류(`CLI_ERROR_EXIT_CODES`): `invalid_arguments`·`invalid_task`·`invalid_script`·`secret_env_missing`·`workspace_not_found` 2, `workspace_locked` 6, `provider_not_configured`·`provider_not_implemented` 7, `internal_error` 70.
- 상태 전이는 `RUN_TRANSITIONS`, 이유는 `RunReasonByStatus`를 따른다. 모델의 완료 선언만으로 `done`이 되지 않는다. 검증기가 없으면 `needs-input`/`no_verifier`다.
- 상태 디렉터리는 `<workspaceRoot>/.codaryn/`이다. 도구는 이 안을 읽기, 목록, 쓰기, 실행 위치로 쓸 수 없다(`state_dir`).
  - `runs/<runId>/journal.jsonl`: 한 줄에 `JournalRecord` 하나(`seq`, `at`, `runId`와 이벤트). 가림본만 담는다. `runs/<runId>/result.json`은 stdout과 같은 객체다.
  - `lock.json`: 실행 중인 작업 공간 잠금이며 내용은 `{pid, runId, startedAt}`이다. 기록된 pid가 살아 있으면 `workspace_locked`, 살아 있지 않으면 회수한다(P-4).
- `runId`는 `<UTC yyyymmddThhmmssZ>-<8자리 16진 난수>`다(P-3). 예: `20261112T031500Z-9f2c41ab`.
- 치환 대응표와 원문 스냅샷은 실행 중 메모리에만 둔다. 영구 금고, 재개, 되돌리기 명령은 없다.

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
