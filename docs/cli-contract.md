# CLI·공통 계약 (1a, 1b 설정, 2 재수정 반복, 3 준비, 모델 목록, 사용성)

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
| `src/model/anthropic/index.ts` (Y, p5) | `listAnthropicModels` | `ListAnthropicModels` = `(settings: AnthropicListSettings, deps?: AnthropicProviderDeps, signal?: AbortSignal) => Promise<ListModelsOutcome>`(16절) |
| `src/store/index.ts` (F3) | `createChangeRecorder`, `revertRun` | `CreateChangeRecorder` = `({ workspaceRoot, runId }) => ChangeRecorder`, `RevertRun` = `(request: RevertRequest) => Promise<RevertOutcome>` |
| `src/tools/index.ts` (F4) | `createToolRunner`의 선택 인자 `changeRecorder` | `ChangeRecorder`(14절) |
| `src/verify/index.ts` (K2) | `createIntegrityChecker` | `CreateIntegrityChecker` = `({ workspace, protectedPaths, externalPaths }) => IntegrityChecker`(15절) |
| `src/store/index.ts` (N-C) | `listRuns` | `ListRuns` = `(request: ListRunsRequest) => Promise<RunListing>`(17절) |
| `src/i18n/index.ts` (N-B) | `selectMessageLanguage`, `createMessageCatalog` | `SelectMessageLanguage`, `CreateMessageCatalog` → `MessageCatalog`(17.4절) |
| `src/cli/human/index.ts` (N-C) | `createHumanOutput` | `CreateHumanOutput` = `(messages: MessageCatalog) => HumanOutput`(17.4절) |
| `src/cli/main.ts` | CLI 진입 파일 | `package.json`의 `bin.codaryn`이 `dist/src/cli/main.js`를 가리킨다 |

- CLI가 Anthropic 제공자를 가져오는 곳은 `src/cli/provider.ts`의 `anthropicProviderFactory` 하나이며, `createAnthropicProvider`에 연결되어 있다. CLI는 설정을 모두 해석한 뒤에만 이를 호출한다. 1a 자리표시자 `src/model/anthropic.ts`는 제거했다. `provider_not_implemented`는 계약에 남아 있지만 실제 CLI에서는 더 이상 나오지 않는다.

- `PrivacyGateway`: `mask(text)`, `resolveToolArgs(request)`, `rebuildDocument(request)`.
- `PolicyGate`: `checkRequested(call, descriptor)`, `restorableFields(descriptor)`, `checkEffective(call, descriptor)`.
- `Workspace`: `root`, `resolve(path, access)`, `readText(path)`, `list(dir)`, `writeText(request)`.
- 엔진 쪽: `ModelProvider.complete`, `ToolRunner.execute`, `VerifierRunner.run`, `Journal.append/close`, `Clock.now`.

## 2. 실행

```
node dist/src/cli/main.js run "<목표>" [옵션]
node dist/src/cli/main.js run --task <task.json> [옵션]
node dist/src/cli/main.js run --workspace <디렉터리> --goal <문장> [옵션]
옵션: --config <config.json>  --vars-file <경로>  --cancel-file <경로>  --quiet  --profile <이름>
node dist/src/cli/main.js revert --workspace <디렉터리> --run <runId|latest> [--dry-run] [--quiet]
node dist/src/cli/main.js report --workspace <디렉터리> --run <runId|latest> [--json]
node dist/src/cli/main.js doctor [--config <파일>] [--vars-file <파일>] [--task <task.json> | --workspace <디렉터리>] [--profile <이름>] [--json]
node dist/src/cli/main.js models [--config <config.json>] [--vars-file <경로>] [--json] [--use <번호|id>]
node dist/src/cli/main.js init [--config <config.json>] [--workspace <디렉터리>] [--json]
node dist/src/cli/main.js runs [--workspace <디렉터리>] [--limit <n>] [--json]
node dist/src/cli/main.js --help | help <명령> | <명령> --help | --version
```

- `revert`는 14절이다. `--workspace`와 `--run` 둘 다 필요하고 다른 옵션은 받지 않는다. runId는 영숫자로 시작하는 1~128자의 영숫자·`.`·`_`·`-`이며 `..`를 포함할 수 없다. 어기면 `invalid_arguments`다. `--workspace`가 UNC나 장치 경로이면 파일 시스템에 닿기 전에 `invalid_arguments`다(T-12).
- 한 줄 실행 `run "<목표>"`, `init`, `runs`, `--profile`, `--run latest`, `revert --dry-run`·`--quiet`은 17절이다(사용성, 계약 추가분).
- `report`, `doctor`, 도움말, 버전, `--quiet`은 15절이다. `npm run build` 뒤 `npm link`를 하면 `node dist/src/cli/main.js` 대신 `codaryn`으로 실행할 수 있다.

- task 파일 형식은 1a와 같다. scripted 모델은 키 없이 실행된다.
- 간편 형식(`--workspace`, `--goal`)은 task 파일 없이 설정 파일의 기본값으로 실행한다. 제공자는 항상 anthropic이다(11절).
- `--task`와 간편 형식은 함께 쓸 수 없다. `--workspace`와 `--goal`은 함께 써야 한다. 같은 옵션을 두 번 쓰거나 모르는 옵션을 쓰면 `invalid_arguments`다.
- task 파일과 설정 파일에는 비밀 값이나 API 키를 넣지 않는다.
- 취소는 `SIGINT`/`SIGTERM`, 또는 `--cancel-file`로 지정한 파일이 생기는 것으로 받는다(P-2). 둘 다 `EngineDeps.signal`을 abort한다. 취소 파일은 작업 공간 밖이어야 한다. 실행이 그 파일을 만들어 스스로 취소하지 못하게 하기 위해서이며, 안이면 `invalid_arguments`다(T-12).
- `--env-file`과 `--env-file-if-exists`는 쓰지 않는다. 두 이름 모두 어느 명령에서든(`=값` 형식 포함) 같은 안내와 함께 `invalid_arguments`다(T-15, V-3). 변수 파일은 `--vars-file`로 준다.
  - Node 26은 스크립트 이름 뒤의 두 옵션도 스스로 처리한다. `--env-file`은 파일이 없으면 CLI보다 먼저 종료 9로 끝나고, `--env-file-if-exists`는 없는 파일을 stderr에 알리고 계속한다. 어느 쪽이든 경로가 UNC면 CLI의 검사(S-5)보다 먼저 접근할 수 있다.
  - CLI의 거부는 안내일 뿐이다. Node가 먼저 그 경로에 접근하는 것은 CLI가 막을 수 없으므로, 명령줄에 두 이름을 아예 쓰지 않는다.

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

- N-19: stdout의 JSON 한 줄(모든 명령의 JSON 출력과 `--json`)은 U+007F보다 큰 문자를 모두 `\uXXXX`로 쓴다(BMP 밖 문자는 서로게이트 쌍). JSON으로 읽으면 값은 같다. Windows PowerShell 5.1의 기본 코드 페이지에서도 깨지지 않게 하기 위해서다. `report`·`doctor`·`models`의 기본 글 출력은 그대로다.

- 명령별 stdout(17절, 18절까지 반영)
  - JSON 한 줄만: `run`(`CliOutput`), `revert`(`RevertOutput`), `apply`(`ApplyResult`)
  - 기본은 글이고 `--json`이면 JSON 한 줄: `report`(`ReportOutput`), `doctor`(`DoctorOutput`), `models`(`ModelsOutput`), `init`(`InitOutput`), `runs`(`RunsOutput`), `plan`(`PlanOutput`), `review`(`ReviewOutput`), `changes`(`ChangesOutput`)
  - 사람용 글(오류 설명, 진행 줄, 끝 요약, 터미널 질문)은 stderr다(17.4). `run`, `revert`, `apply`는 `--quiet`로 끈다.

- 명령 밖으로 새어 나온 예외는 최상위(`src/cli/guard.ts`의 `runGuarded`)에서 잡아 `internal_error`(종료 70) 한 줄로 바꾼다. 예외 문구와 스택은 경로·파일 내용·비밀 값을 담을 수 있으므로 stdout과 stderr 어디에도 출력하지 않는다(S-6).

- 실행 결과 `EngineResult`: `schemaVersion`, `kind:"run"`, `runId`, `taskId`, `status`, `reason`, `exitCode`, `provider`, `verifiers`, `changes`, `usage`, `journalPath`, `notices`.
  - `verifiers`는 마지막 검증 회차의 결과다. 재수정 뒤 검증 전에 한도로 끝나면 직전 회차의 결과가 남는다. 회차마다의 결과는 기록의 `verifier_result`에 모두 있다.
  - `usage.repairAttempts`는 시작한 재수정 수다. 단계 2 엔진은 항상 채운다(단계 1 기록에는 없다).
  - 선택 필드
    - `protectedChanged`: 바뀐 보호 대상(15절 U-1)
    - `plan`: `plan_pending`일 때만, `{ digest, actions }`(G-A, 18.3)
    - `review`: `awaiting_review`일 때만, `{ checklist }`(G-A, 18.5)
- 되돌리기 결과 `RevertOutput`: `schemaVersion`, `kind:"revert"`, `runId`, `status`(`complete`/`partial`), `exitCode`, `reverted[{path, action}]`, `skipped[{path, reason}]`(14절).
  - `reverted`의 `action`: `restored`, `deleted`, 적용 실행의 `moved_back`·`restored_from_discard`(G-A)
    - `from`: 옮겨진 자리. 적용 실행만 있다.
    - `unsafe: true`: 동의를 받아 안전 보장 없이 옮긴 경우(DR-25)
  - `skipped`의 `reason`(`REVERT_SKIP_REASONS`): `changed_since_run`, `missing_snapshot`, `io_error`, `missing_record`, `already_reverted`(N-22, `partial`로 세지 않음), `original_path_taken`(G-A), `unsafe_move`(DR-24 b)
  - 선택 필드
    - `dryRun: true`(N-7)
    - `moveSafetyUnchecked: true`: 드라이 런이 옮길 파일을 나열할 때(DR-25)
    - `revertedBefore`: 이전 되돌리기 기록의 시각과 상태(N-7)
- 실행 전 오류 `CliErrorOutput`: `schemaVersion`, `kind:"error"`, `code`, `exitCode`, `message`.
- 상태별 종료 코드(`RUN_EXIT_CODES`): `done` 0, `failed` 1, `needs-input` 3, `budget-exhausted` 4, `cancelled` 5.
- 되돌리기 종료 코드(`REVERT_EXIT_CODES`): `complete` 0, `partial` 3.
- 실행 전 오류(`CLI_ERROR_EXIT_CODES`): `invalid_arguments`·`invalid_task`·`invalid_config`·`key_in_file`·`invalid_script`·`secret_env_missing`·`workspace_not_found`·`run_not_found`·`invalid_run_record` 2, `workspace_locked` 6, `provider_not_configured`·`provider_not_implemented` 7, `internal_error` 70. 단계 3에서 `workspace_is_install_dir` 2가 더해졌다(15절). 모델 목록(16절)에서 `model_list_failed` 8, `config_write_failed` 2가 더해졌다. `init`(17절)에서 `config_exists` 2가 더해졌다. 범용 작업 명령(18절)에서 `run_not_plan`, `plan_not_approved`, `plan_already_applied`, `run_not_awaiting_review`(모두 2)가 더해졌다.
- 모델 오류(`MODEL_ERROR_KINDS`)는 취소 때문이 아니면 실행을 `failed`/`model_error`로 끝내며 기록의 `model_error.kind`에 남는다. 1b에서 `auth_failed`, `rate_limited`, `overloaded`, `timeout`, `api_error`가 추가되었다.
- 상태 전이는 `RUN_TRANSITIONS`, 이유는 `RunReasonByStatus`를 따른다. 상태별 이유 목록은 `RUN_REASONS_BY_STATUS` 하나이고(`isReasonOfStatus`, DR-16), 읽는 쪽이 자기 목록을 두지 않는다(18.7). G-A가 `failed`에 `plan_stale`·`apply_incomplete`를, `needs-input`에 `plan_pending`·`awaiting_review`·`consent_required`를 더했다. 적용 실행은 그 부분집합 `APPLY_REASONS_BY_STATUS`를 쓴다. 모델의 완료 선언만으로 `done`이 되지 않는다. 검증기가 없으면 `needs-input`/`no_verifier`다. 재수정은 `verifying → running`이다. `failed`의 이유에 `repeated_failure`가 더해졌다(12절).
- 상태 디렉터리는 `<workspaceRoot>/.codaryn/`이다. 도구는 이 안을 읽기, 목록, 쓰기, 실행 위치로 쓸 수 없다(`state_dir`).
  - `runs/<runId>/journal.jsonl`: 한 줄에 `JournalRecord` 하나(`seq`, `at`, `runId`와 이벤트). 가림본만 담는다. `runs/<runId>/result.json`은 stdout과 같은 객체다.
  - `runs/<runId>/snapshots/`(`SNAPSHOTS_DIR_NAME`): 실행이 바꾼 파일의 변경 전 원문(14절). 원문이므로 가림본이 아니다.
  - `runs/<runId>/revert.json`(`REVERT_RECORD_FILE_NAME`, N-7): 마지막 되돌리기의 기록. DR-25부터 동의 경로(`unsafeMoveConsent`)와 위험하게 옮긴 수(`unsafeMoves`)도 담는다.
  - G-A
    - `runs/<runId>/plan.json`(`PLAN_FILE_NAME`): 계획 실행의 계획
    - `runs/<runId>/applied.json`(`PLAN_APPLIED_FILE_NAME`): 그 계획을 적용한 실행
    - `runs/<runId>/review.json`(`REVIEW_FILE_NAME`): 사람의 검토 판정
    - `discarded/<적용 runId>/`(`DISCARDED_DIR_NAME`): 폐기한 파일을 행동 번호 이름으로 보관
  - `lock.json`: 작업 공간 잠금.
    - 내용은 `{pid, runId, startedAt}`에, N-25 (b)의 `processStartedAt`과 Linux의 N-27 (d) `processStartTicks`·`bootId`가 더해진다.
    - 주인이 살아 있으면 `workspace_locked`, 끝났으면 회수한다(P-4, T-9). 같은 pid라도 시작 시각이 다르면 끝난 것으로 본다.
    - 회수는 `lock.json.reclaim`을 쥔 한 프로세스만 한다.
    - 하드 링크가 없는 볼륨에서는 두 파일을 배타 생성으로 만든다(DR-27 b). 그래서 도중에 끝난 시도가 빈 파일을 남길 수 있고, 그 파일은 자동으로 지워지지 않는다. `doctor`의 `lock` 점검이 알린다(17.6).
    - `revert`, `apply`, `review`도 자기 id로 잡는다.
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
- 같은 실행을 두 번 되돌리면 두 번째에는 이미 원래대로인 파일이 `already_reverted`로 건너뛰어지고, `partial`로 세지 않는다(N-22). 실행 뒤 다시 바뀐 파일만 `changed_since_run`이다.
- 실행 중 다른 프로세스가 같은 파일을 바꾸면 스냅샷(그 실행이 처음 쓰기 직전에 읽은 원문)과 실제 실행 전 상태가 다를 수 있다.

알려진 한계(교차 검토 수정 S-1~S-9):

- 파일 위치 확인과 파일 읽기 사이에 링크를 바꿔치기하면 막지 못한다(확인과 사용 사이의 경쟁).
- 작업 공간 밖의 하드 링크가 작업 공간 안 파일과 같은 내용을 가리키면 밖으로 판정된다. 파일 도구는 이름을 새 파일로 교체하므로 그 링크를 바꾸지 못하지만, 허용된 명령은 제자리에서 고칠 수 있다.
- 키 모양 검사는 Anthropic 키 형식(`sk-ant-`)과 현재 키(16자 이상)뿐이다. 다른 서비스 토큰과 키의 인코딩 변형은 잡지 않는다.
- env 파일이 새로 설정한 8자 이상 값은 모두 비밀로 등록하므로 `postgres` 같은 흔한 값도 가려질 수 있다(S-4의 부작용).
- 작업 디렉터리가 UNC 경로이면 모든 상대 경로가 거부된다. POSIX에서는 `/dev/` 아래만 장치 경로로 본다.

## 11. 설정 (1b)

### 설정 파일 (`CodarynConfig`)

`--config <경로>` 또는 환경 변수 `CODARYN_CONFIG`로 지정한 파일, 둘 다 없으면 기본 위치의 파일(N-1, 17.1절)을 읽는다. 순서는 `--config` → `CODARYN_CONFIG` → 기본 위치다. 작업 공간 안에서 자동으로 찾지 않는다(C-3, N-1로 개정). 상대 경로는 현재 디렉터리 기준이다. `language`, `profiles` 필드와 모델 자리표시자는 17.2절이다.

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
  - 명령 규칙과 검증기(X-1): `policy.commands[i].executable`, 명령 검증기의 `executable`과 `cwd`는 적힌 그대로 같은 검사를 한다. task에서는 `invalid_task`, 설정 파일에서는 `invalid_config`이고, 메시지는 필드 위치만 적는다(`policy.commands[0].executable is a network or device path`). 그래서 `run`도 `doctor`도 이 값으로 다른 기계에 닿지 않는다. 인자(`argsPrefix`, `args`)는 대상이 아니다.
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
2. `--vars-file`. 읽기 → BOM 거부 → 적재 → 새로 설정된 값을 고른다(S-4). `--env-file`과 `--env-file-if-exists`는 1단계에서 거부한다(T-15, V-3).
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

### 이후에 바뀐 점 (위 단계에 더해짐)

- `--run latest`, `--dry-run`, 되돌리기 기록 `revert.json`(N-7): 17.3
- 실행 id 판정(N-26, N-27): 18.7
  - 그 이름 그대로인 실행 디렉터리가 없으면 `run_not_found`다. 대소문자만 다른 id도 여기에 걸린다.
  - 실행 목록이 손상으로 보는 실행은 id로 불러도 `invalid_run_record`로 거부한다.
- `already_reverted`(N-22): 이미 원래대로인 파일은 건너뛰되 `partial`로 세지 않는다.
- `missing_record`(T-10): 원문은 있는데 기록이 없는 파일은 건드리지 않는다.
- 적용 실행(첫 기록 `apply_started`, G-A·DR-24)
  - 옮긴 파일은 제자리로(`moved_back`), 폐기한 파일은 보관함에서(`restored_from_discard`) 되돌린다.
  - 원래 자리에 무언가 있으면 `original_path_taken`이다.
  - 시작 기록만 있는 행동(R-9 I-4, `plan_item_started`)도 같은 순서로 다룬다.
- 하드 링크 없는 볼륨의 되돌리기(DR-24 (b), DR-25)
  - 기본은 `unsafe_move`로 건너뛴다.
  - 그 되돌리기에 대한 사람의 동의가 있으면 옮긴다: 18.10

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

- 조립 연결(V-3과 함께, 연결 완료): `assembleRun`은 `policy.protectedPaths`나 설정의 `integrity.paths`에 항목이 있으면 `createIntegrityChecker({ workspace, protectedPaths, externalPaths })`를 만들어 `EngineDeps.integrity`로 넘긴다. 둘 다 비어 있으면 넘기지 않으므로 기록에 `integrity_checked`가 없고 결과에 `protectedChanged`도 없다(단계 2와 같다).
  - K1 2단계 커밋(`b39f945`)에서는 연결 전이라 `integrity.paths`가 있는 실행을 잠금 전에 `invalid_config`로 멈췄다. 연결과 함께 그 거부를 없앴다.
  - 유닛(`tests/unit/cli/v3.test.ts`)에서 실제 조립으로 확인했다.
    - 보호 경로만 있는 실행은 시작, 검증 전, 검증 후에 확인하고 `protectedChanged`가 빈 목록이다.
    - 검증기 명령이 보호 파일을 바꾸면 `needs-input`/`protected_changed`(종료 3)이다.
    - 작업 공간 밖 `integrity.paths`의 파일이 바뀌어도 같다.
    - 보호 대상이 없으면 확인 기록이 없다.

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

- `codaryn doctor [--config <파일>] [--vars-file <파일>] [--task <task.json> | --workspace <디렉터리>] [--json]`은 네트워크 접속, 모델 요청, 쓰기 없이 점검한다. 기본 출력은 항목마다 한 줄의 글이고, `--json`이면 `DoctorOutput` 한 줄이다.
- `--task`와 `--workspace`는 함께 쓸 수 없다(`invalid_arguments`, W-5). task 파일이 자기 작업 공간(`workspaceRoot`)을 정하기 때문이다. 작업 공간을 보는 항목(`workspace`, `file_locations`, `install_dir`, `integrity_paths`의 위치 판정)은 task의 `workspaceRoot`나 `--workspace`를 쓰고, 둘 다 없으면 `skipped`다.
- 항목(`DOCTOR_CHECK_IDS` 순서): `node_version`, `config_file`, `vars_file`, `task_file`, `api_key`, `model`, `limits`, `file_locations`, `commands`, `workspace`, `install_dir`, `integrity_paths`, `language`(N-20). 상태는 `ok`/`warn`/`fail`/`skipped`(볼 대상이 없음)다.
- 종료(`DOCTOR_EXIT_CODES`): 가장 나쁜 항목에 따라 `ok` 0, `warn` 3, `fail` 1이다(`skipped`는 `ok`로 센다). 인자 오류는 `invalid_arguments`(`CliErrorOutput`)다.
- 메시지는 고정 문구, 필드 위치(`policy.commands[2]` 등), 개수로만 만든다. 파일이나 환경에서 읽은 값은 내지 않으며, 키는 있음·없음만 적는다.

### 실행본 자기 보호의 세부 (U-3)

- 설치 위치는 진입 파일(`dist/src/cli/main.js`)에서 위로 올라가며 처음 만나는, `name`이 `codaryn`인 `package.json`의 디렉터리다. `npm link`와 전역 설치 모두 이 배치를 유지한다. 찾지 못하면 확인할 수 없으므로 모든 실행을 `workspace_is_install_dir`로 거부한다(fail closed).
- 비교는 실경로(링크, 정션, 8.3 이름을 푼 뒤)로 하고 Windows에서는 대소문자를 구분하지 않는다. 처리 순서는 11절 6단계다.
- 후보 작업 공간은 설치 위치 밖에 둔다. 예를 들어 `D:/project/Codaryn`에서 빌드한 CLI로는 그 아래 `.worktrees/...`를 작업 공간으로 쓸 수 없다.

### report의 세부 (U-5)

- Markdown 절: 실행 요약(실행 id, 작업, 제공자, 결과), 검증(마지막 회차, 통과하지 않은 검증기의 증거), 보호 대상, 변경, 사용량, 검사하지 않은 범위(검증기마다의 한계와 고정 문구), 알림.
- 실행 디렉터리가 링크(정션 포함)이면 따라가지 않고 `invalid_run_record`다. 기록은 모두 그 실행의 것이어야 하고(`runId`, 1부터 연속인 `seq`, 첫 기록 `run_started`), 보고서가 쓰는 필드는 형식을 확인한다. 모르는 종류의 기록은 건너뛴다. `result.json`은 확인한 필드만으로 다시 만든다.
- 실행이 남기지 않는 기록은 `invalid_run_record`다(X-2). 검증기 근거가 `MAX_EVIDENCE_BYTES`(8192바이트)보다 길면 거부한다. 엔진은 그보다 길게 기록하지 않으므로, 실행 뒤에 바뀐 기록이다. 그리기가 실패해도 내부 오류(70)가 아니라 `invalid_run_record`로 끝난다.
  - 그리기는 인자를 펼치지 않고 반복으로 한다. 그래서 백틱 묶음이 많거나 줄이 많은 다른 기록 문자열도 스택을 넘기지 않고 출력된다.
- 출력 글의 제어 문자(ESC, CR, 양방향 제어 문자 등)는 `?`로 바꾸고, 인라인 코드와 코드 블록은 내용 속 백틱보다 긴 울타리를 쓴다. 키 모양 문자열과 현재 `ANTHROPIC_API_KEY` 값은 `[key]`로 가린다. 기록이 실행 중 명령으로 바뀌었을 경우를 위한 방어이며, 등록된 다른 비밀 값은 report가 알지 못한다.

### doctor의 세부 (U-6)

- 변수 파일은 `util.parseEnv`로 해석만 하고 프로세스 환경에 적재하지 않는다. 이미 있는 변수가 우선한다(`run`과 같다).
- 설정·task 파일은 `run`과 같은 순서(원문 키 검사 → 파싱 → 키 검사 → 검증)로 본다. 실패 메시지는 검증기의 필드 위치 문구다.
- `commands`(X-1, X-3): 정책의 `commands[i]`(`argsPrefix`와 함께)와 명령 검증기(`args`, `cwd`와 함께)를 `run`과 같은 규칙으로 판정한다.
  - 자식 환경은 명령 실행기처럼 `buildChildEnv`로 만든다. 검증기 `cwd`는 검증기 실행기처럼 작업 공간이 푼다. `outside_root`, `state_dir`, `invalid_path`면 실행 때 거부되므로 `fail`이다.
  - Windows에서는 실행기의 `planWindowsLaunch`로 판정한다. 다음은 "rejected at run time"으로 `fail`이다.
    - 작업 공간 안으로 풀리는 실행 파일(`executable_refused`)
    - 작업 공간 안에 있거나 허용 문자 밖 인자를 받는 `.cmd`·`.bat`(`script_refused`)
    - 그 밖의 형식(`unsupported_type`)
  - POSIX의 실행기는 이름을 `spawn`에 넘기므로 doctor도 존재만 본다.
  - PATH의 UNC·장치 항목은 stat도 하지 않는다. 개수만 "not checked: remote paths are not accessed"로 알리고 `warn`이다. 로컬 항목에서 찾지 못한 이름은 "not found in local PATH entries"로 `warn`이다. 실행 때는 실행기가 그 원격 항목을 찾아볼 수 있기 때문이다.
  - 작업 공간이 없으면 존재만 보고, 실행 규칙은 보지 않았다고 적는다.
  - 마지막 줄의 "No network access was made"는 이 규칙과 X-1의 입력 검사로 지킨다. 설정·task·변수·대본 파일, `integrity.paths`, 작업 공간은 S-5 검사를 거친 로컬 경로만 읽는다.
- `integrity_paths`: 각 경로가 있는지, 작업 공간이 주어지면 그 밖에 있는지 본다. 위치만 적고 경로는 내지 않는다.
- `warn`은 지금 `commands`에서만 나온다(원격 PATH 항목).

### 도움말, 버전, 설치 (U-7)

- `codaryn --help`(`-h`, `help`), `codaryn help <명령>`, `codaryn <명령> --help`, `codaryn --version`(`-v`, `version`)은 stdout에 글을 쓰고 종료 0이다. 버전은 설치 위치의 `package.json`에서 읽는다. 모르는 명령의 도움말 요청은 `invalid_arguments`다.
- `package.json`: `bin.codaryn`은 `dist/src/cli/main.js`(첫 줄 `#!/usr/bin/env node`), `files`는 `dist/src`, `README.md`, `LICENSE`다. 설치 절차는 `npm ci` → `npm run build` → `npm link`다.
- K1에서는 `npm link`를 실행하지 않았다(작업 디렉터리 밖의 전역 위치에 쓰기 때문). 유닛은 `bin`, `files`, shebang, 진입 파일에서 설치 위치와 버전을 찾는 것까지만 확인한다.

### 진행 표시 (U-8)

- `run`은 실행이 시작된 뒤 기록마다 stderr에 `codaryn: `로 시작하는 한 줄을 쓴다. 실행 시작, 턴 번호, 도구 허용·거부(권한/코드), 만들거나 바꾼 파일, 검증기 결과, 재수정 회차, 보호 대상 확인, 종료 상태가 대상이다. 모델 응답과 도구 결과는 쓰지 않는다.
- 줄은 기록(가림본)에서만 만들고, 실행의 개인정보 게이트로 다시 가린 뒤 제어 문자를 바꾼다. 내장 도구가 아닌 도구 이름은 `(unknown tool)`, 형식에 맞지 않는 id는 `?`로 쓴다.
- 실행 전 오류에는 진행 표시가 없다. `--quiet`이면 쓰지 않는다. stderr 쓰기 실패는 실행에 영향을 주지 않는다. stdout은 그대로 JSON 한 줄이다.

## 16. 모델 목록 조회와 선택 (Y-1~Y-4)

결정은 `docs/work-orders/phase-3-self-development.md`의 "모델 목록 조회와 선택"이다. Y 1단계 커밋은 계약을, Y 2단계 커밋은 `codaryn models` 명령(p7)을 추가했다. 목록 조회 함수 `listAnthropicModels`는 p5(`src/model/anthropic`)가 구현한다.

- 연결 상태(연결 완료):
  - 진입 파일은 `src/cli/provider.ts`의 `anthropicModelLister`(= `listAnthropicModels`)를 `codaryn models`에 넘긴다. 키와 주소를 정한 뒤에만 부르고, 전송은 전역 `fetch`다.
  - Y 2단계 커밋(`3d0eadd`)에서는 연결 전이라 `provider_not_implemented`로 멈췄다.
  - `ModelsEnvironment.listModels`를 넘기지 않은 호출(시험 등)은 지금도 연결되지 않은 것으로 보고 아무것도 보내지 않는다. 기본값으로 채우지 않으므로 시험이 네트워크에 닿을 수 없다.
  - 유닛 `tests/unit/cli/y-wire.test.ts`가 실제 목록 함수와 주입한 가짜 `fetch`로 다음을 확인한다.
    - 요청이 설정한 주소(`CODARYN_API_BASE_URL`, 없으면 설정 파일 `apiBaseUrl`)의 `/v1/models`로 가고, 모든 쪽을 읽는다(`after_id`).
    - 키는 `x-api-key` 헤더에만 있다. URL, 다른 헤더, 출력에는 없다.
    - 401은 `model_list_failed`(`auth_failed`)이며 재시도하지 않는다.

### 목록 조회 함수 (`ListAnthropicModels`)

- `src/model/anthropic/index.ts`가 `listAnthropicModels(settings, deps?, signal?)`를 export한다.
  - `settings`(`AnthropicListSettings`): `apiKey`, `apiBaseUrl`, `requestTimeoutMs`, `maxRetries`
  - `deps`: `AnthropicProviderDeps`(가짜 `fetch` 주입)
- 요청: `GET <apiBaseUrl>/v1/models`. 헤더는 Messages 요청과 같은 `x-api-key`와 `anthropic-version`이다.
- 페이지 나눔: `has_more`가 참이면 직전 `last_id`를 `after_id`로 넘겨 다음 쪽을 읽는다. 최대 `MAX_MODEL_LIST_PAGES`(20)쪽이며, 넘으면 `api_error`다. 모델 순서는 API가 준 순서다.
- 결과:
  - 성공은 `{ ok: true, models: ModelInfo[] }`다.
  - 실패는 `{ ok: false, kind: ModelErrorKind, message }`다. 종류와 재시도, 시간 제한은 Messages 요청과 같다. API나 네트워크 실패로 throw하지 않는다.
  - 키는 헤더에만 넣는다. 메시지, URL, 기록에는 넣지 않는다.
- `ModelInfo`: API 객체에서 다음만 남긴다. `capabilities`와 그 밖의 필드는 버린다.
  - `id`
  - `displayName`: `display_name`. 없으면 `id`다.
  - `createdAt`: `created_at` 문자열. 없거나 문자열이 아니면 null이다.
  - `maxInputTokens`: `max_input_tokens`. 양의 정수가 아니면 null이다.
  - `maxOutputTokens`: `max_tokens`. 양의 정수가 아니면 null이다.
- 문자열 `id`가 없는 항목이 하나라도 있으면 목록 전체가 `malformed_response`다.
- API 형식 확인 범위(claude-api 스킬 문서 기준, 실제 API는 호출하지 않음):
  - 확인함: `GET /v1/models/{id}`, 헤더 `x-api-key`·`anthropic-version`, 모델 필드 `id`·`display_name`·`max_input_tokens`·`max_tokens`·`capabilities`, Models 목록의 `after_id`·`before_id` 매개변수와 `has_more`·`first_id`·`last_id` 응답 필드
  - 미확인: `created_at`의 정확한 형식, 목록 응답의 항목 배열 이름(같은 방식의 다른 목록은 `data`), `limit` 매개변수의 최댓값

### `codaryn models`

```
codaryn models [--config <config.json>] [--vars-file <경로>] [--json] [--use <번호|id>]
```

- 작업 공간은 필요 없다. 실제 API에 접속하므로 키가 필요하다.
  - 키와 주소는 `run`과 같은 규칙으로 정한다: `ANTHROPIC_API_KEY`, `--vars-file`, `--config` 또는 `CODARYN_CONFIG`, `CODARYN_API_BASE_URL`.
  - 키가 없으면 `provider_not_configured`(종료 7)이고 아무것도 보내지 않는다.
- 출력:
  - 기본은 번호가 붙은 표다. `--json`이면 `ModelsOutput` 한 줄이다.
  - `ModelsOutput`의 필드: `schemaVersion`, `kind:"models"`, `status`(`listed`/`selected`), `exitCode`, `models`(`number`가 붙은 `ModelInfo`), `current`, `selected`
  - `current`: 지금 실행이 쓸 모델(`CODARYN_MODEL`, 없으면 설정 파일 `model`), 그 출처, 그 모델이 목록에 있는지
  - `selected`: 쓴 모델, 설정 파일을 새로 만들었는지, `CODARYN_MODEL`이 덮어쓰는지
- 종료(`MODELS_EXIT_CODES`): `listed` 0, `selected` 0
- 오류(`CliErrorOutput`):
  - `invalid_arguments`, `invalid_config`, `key_in_file`: 종료 2
  - `provider_not_configured`: 종료 7
  - `model_list_failed`: 종료 8. API 요청이 실패했고, 메시지에 종류가 있다. 아무것도 쓰지 않았다.
  - `config_write_failed`: 종료 2. 설정 파일을 쓰지 못했고, 파일은 그대로다.
- `--use <번호|id>`: 목록의 번호(1부터)나 목록에 있는 id만 받는다. 그 밖은 `invalid_arguments`이고 아무것도 쓰지 않는다.
  - `--config`(또는 `CODARYN_CONFIG`)나 기본 위치의 설정 파일(N-1)이 필요하다. 셋 다 없으면 요청을 보내기 전에 `invalid_arguments`다. 기본 위치에는 새 파일을 만들지 않는다(`codaryn init`이 만든다).
  - 쓰기 전에 설정 파일을 `run`과 같은 순서로 검사한다(원문 키 검사, 파싱, 키 필드 검사, `parseConfig`). 키 필드나 키 값이 있으면 지금처럼 `key_in_file`이고, 요청도 쓰기도 하지 않는다.
  - 고른 id가 일반 모델 id 형식(영숫자로 시작, 영숫자와 `._:-`, 200자 이하)이 아니거나 키를 담고 있으면 `config_write_failed`이고 쓰지 않는다.
  - 원자적 쓰기: 같은 디렉터리의 임시 파일에 쓰고 이름을 바꾼다. 바꾸기 직전에 파일이 읽었을 때와 같은지 확인하고, 다르면 쓰지 않는다(`config_write_failed`). 링크면 가리키는 파일을 바꾸고 링크는 그대로 둔다. POSIX에서는 원래 파일의 권한을 옮긴다. 실패하면 임시 파일을 지우고 원래 파일은 그대로다.
  - 설정 파일이 없으면 `{ "schemaVersion": 1, "model": <id> }`만 있는 파일을 새로 만든다(배타 생성). `--use` 없이 설정 파일이 없으면 `run`과 같이 `invalid_config`다.
  - 보존하는 것: 모든 필드와 값, 필드 순서(`model`은 원래 자리, 없으면 `schemaVersion` 다음), BOM, 줄 끝(CRLF/LF), 첫 들여쓰기 줄의 들여쓰기(공백 또는 탭), 끝 줄바꿈
  - 새로 쓰는 것: 공백 배치, 숫자 표기(`1e3`은 `1000`), 문자열 이스케이프 형태, 중복 필드(마지막 값만 남음)
  - `CODARYN_MODEL`이 설정되어 있으면 쓰기는 하되, 그 변수가 우선한다고 출력에 적는다(`selected.overriddenBy`).
- 터미널에서 번호 묻기(Y-3): `--use`와 `--json`이 없고, 설정 파일 경로가 있고, 표준 입력과 출력이 모두 터미널일 때만 표와 함께 번호나 id를 묻는다. 빈 줄이면 쓰지 않는다. 터미널이 아니면 묻지 않는다.
- 출력의 이름과 id는 제어 문자를 바꾸고(`cleanText`), 키 값과 변수 파일에서 온 값은 가린다.

### 모델 없음 안내와 doctor (Y-4)

- 실행이 모델 오류로 끝났고, 그 모델 요청이 HTTP 404로 응답받았으면(제공자 문구가 `HTTP 404`로 시작) CLI가 결과의 `notices`에 안내 한 줄을 더한다: `codaryn models`로 목록을 보라는 내용이다. `result.json`에도 같은 안내가 들어가고, 진행 표시가 켜져 있으면 stderr에도 한 줄을 쓴다. 오류 종류(`api_error`)와 분류는 제공자(p5)의 것이며 바꾸지 않는다.
- `doctor`는 네트워크에 접속하지 않으므로 모델이 있는지 확인하지 않는다. `model` 항목의 메시지에 그 사실과 `codaryn models` 안내를 적는다. 모델이 설정되지 않았을 때의 `fail` 메시지에도 같은 안내를 붙인다.

## 17. 사용성 계약 (N-1~N-9, N-14~N-18)

결정은 `docs/work-orders/phase-4-usability.md`의 N-1~N-13과, 계약 검토(`docs/reviews/2026-11-12-n-review-usability-contract.md`) 뒤의 N-14~N-19다. 이 절은 역할 1(N-A)의 계약 추가분이다. 계약 커밋(`9735b5f`, N-14~N-18 수정 커밋) 시점에는 계약만 있었다. 지금은 표의 담당이 모두 구현해 연결했다(N-A 연결은 `.codaryn/report-N-A.md` 1~19절). 아래 각 항목은 현재 동작이다.

| 영역 | 계약 위치 | 구현 담당 |
| --- | --- | --- |
| 기본 설정 위치(N-1), 자리표시자(N-3), 프로필(N-8), `language` 필드 | `config.ts` | N-A(`src/cli/**`) |
| `codaryn init`(N-2) | `commands.ts`의 `InitOutput` | N-A(`src/cli/init.ts`) |
| 한 줄 실행(N-9), `--profile`, `--run latest`, `revert --dry-run`·`--quiet`의 인자와 연결 | 이 절 | N-A |
| 언어 선택과 문구 카탈로그(N-4) | `human.ts`의 `SelectMessageLanguage`, `CreateMessageCatalog`, `MESSAGE_IDS` | N-B(`src/i18n/**`) |
| 사람용 출력(N-5), 실행 목록(N-7) | `human.ts`의 `HumanOutput`, `commands.ts`의 `RunsOutput`·`ListRuns`, `changes.ts`의 `RevertRequest.dryRun` | N-C(`src/cli/human/**`, `src/cli/runs.ts`, `src/store/**`의 목록 조회와 dry run) |

### 17.1 설정 파일 위치 (N-1, C-3 개정)

- 읽는 설정 파일은 하나다. 순서: `--config` → `CODARYN_CONFIG` → 기본 위치. 앞의 것이 있으면 뒤의 것은 보지 않는다(`ConfigSource`: `argument`, `environment`, `default`).
- C-3 개정: "명시한 것과 작업 공간 밖 고정 위치 한 곳만 읽는다". 작업 공간 안을 찾아보는 일은 여전히 없다.
- 기본 위치(`DefaultConfigLocation`, `FindDefaultConfigLocation`):
  - Windows: `%APPDATA%\Codaryn\config.json`. `APPDATA`가 없거나 공백이거나 완전한 절대 경로가 아니면 기본 위치가 없다.
  - 그 밖: `XDG_CONFIG_HOME`이 절대 경로이면 `$XDG_CONFIG_HOME/codaryn/config.json`, 아니면 `<홈>/.config/codaryn/config.json`. 상대 `XDG_CONFIG_HOME`은 무시한다(XDG 규격). 홈을 모르면 없다.
- 기본 위치에 파일이 없으면(ENOENT) 설정 파일이 없는 것과 같다(N-1 이전과 같은 동작). 그 밖의 읽기 실패는 `invalid_config`다.
- 기본 위치도 S-5 검사를 한다. 네트워크·장치 경로면 쓰지 않고(없는 것과 같다) `doctor`가 `warn`으로 알린다.
- 기본 위치의 파일도 S-1을 따른다. 실경로가 그 실행의 작업 공간 안이면 `invalid_config`다.
- 문구와 출력에는 펼친 경로를 쓰지 않고 `DEFAULT_CONFIG_DISPLAY`의 기호 표기(`%APPDATA%\Codaryn\config.json` 등)만 쓴다. 환경 값이 문구에 들어가지 않게 하기 위해서다.
- 기본 위치를 쓴 실행은 진행 줄과 결과의 `notices`에 그 사실을 한 줄 남긴다(D-1 권고).

### 17.2 설정 필드 추가 (N-3, N-4, N-8)

- `model`의 자리표시자(N-3): 앞뒤 공백을 뗀 값이 빈 문자열이거나 `MODEL_PLACEHOLDER_PATTERN_SOURCE`(`<...>` 모양)이면 그 단계에서 설정되지 않은 것으로 본다. task `model.model`, `CODARYN_MODEL`, 설정 `model` 모두 같다. 다음 단계로 넘어가고, 남은 것이 없으면 `run`은 `provider_not_configured`(전송 없음), `doctor`의 `model`은 `fail`이다. `init`은 키가 없으면 `MODEL_PLACEHOLDER`(`<model id>`)를 쓴다.
- `language`(N-4): `"ko"` 또는 `"en"`. 그 밖은 `invalid_config`. 선택 순서는 `CODARYN_LANG`(ko·en만, 대소문자 무시, 그 밖의 값은 무시) → 설정 `language` → OS 표시 언어(주 태그가 `ko`면 ko) → en.
- `profiles`(N-8): 이름 → `ConfigProfile`(`policy`, `verifiers`, `limits`, 모두 선택). 이름은 `PROFILE_NAME_PATTERN_SOURCE`, 최대 `MAX_PROFILES`(32)개. 모르는 필드는 `invalid_config`다.
  - `--profile <이름>`(run의 모든 형식과 doctor): 프로필의 `policy`·`verifiers`가 있으면 설정의 것을 대신한다(간편 형식과 한 줄 실행에서만 쓰인다). `limits`는 설정 `limits` 위에 필드별로 덮는다.
  - 한도 상한(S-7) 그대로: 프로필의 한도 필드는 설정 최상위의 같은 필드보다 클 수 없고, 최상위가 숫자인데 `null`일 수 없다. 파일을 읽을 때 모든 프로필을 검사해 `invalid_config`로 거부한다. 합친 한도는 task의 상한이 되고 절대 상한과 anthropic의 토큰 규칙도 그대로 적용한다.
  - task 파일 실행에 `--profile`을 주면 프로필의 한도만(상한으로) 쓴다. task는 자기 정책과 검증기를 적는다.
  - 오류: 이름 형식이 틀리면 `invalid_arguments`, 설정 파일이 없거나 그 이름의 프로필이 없으면 `invalid_config`. 프로필은 사용자 설정 파일에만 있고 task 파일은 프로필을 가질 수 없다.

### 17.3 명령 추가와 변경

```
codaryn run "<목표>" [--config <파일>] [--vars-file <경로>] [--cancel-file <경로>] [--quiet] [--profile <이름>]
codaryn run (--task <task.json> | --workspace <디렉터리> --goal <문장>) [위 옵션]
codaryn init [--config <파일>] [--workspace <디렉터리>] [--json]
codaryn runs [--workspace <디렉터리>] [--limit <n>] [--json]
codaryn revert --workspace <디렉터리> --run <runId|latest> [--dry-run | --allow-unsafe-move] [--quiet]
codaryn report --workspace <디렉터리> --run <runId|latest> [--json]
codaryn doctor [...기존] [--profile <이름>]
```

`run`의 `--workflow <id>`와 `plan`, `apply`, `review`, `changes`는 18절에 있다.

- **한 줄 실행(N-9)**: 위치 인자 하나가 목표다. 현재 디렉터리를 작업 공간으로 쓰는 간편 형식과 같다(`--workspace <cwd> --goal <목표>`). 출력은 `run`과 같은 `CliOutput`이다.
  - 위치 인자는 하나만 받는다. `--task`, `--workspace`, `--goal`과 함께 쓰면 `invalid_arguments`다. `--`로 시작하는 목표는 옵션으로 읽힌다.
  - 현재 디렉터리가 설치 위치와 겹치면 `workspace_is_install_dir`(U-3), 목표에 키가 있으면 `key_in_file`(S-8)다.
- **`init`(N-2, N-10)**: `InitOutput`(`commands.ts`)의 주석이 기준이다. 요점:
  - 기본 위치(또는 `--config`)에 배타 생성한다. 이미 있으면 `config_exists`(종료 2)로 아무것도 쓰지 않는다.
  - stdin과 stderr가 모두 터미널일 때만 묻는다. 질문은 stderr로 낸다. 터미널이 아니면 묻지 않고 기본값(`INIT_DEFAULT_LIMITS`, `INIT_DEFAULT_MAX_OUTPUT_TOKENS`, `DENY_ALL_POLICY`, 자리표시자 모델)만 쓴다.
  - 키를 묻거나 읽거나 쓰지 않는다. 키가 설정됐는지와 사용자 환경 변수 등록 방법만 알린다.
  - 명령·보호 경로 제안은 `--workspace`가 있을 때만, 고정된 이름 목록과 비교해 만든다. 파일 내용은 출력하지 않는다. 제안은 하나씩 승인하고 명령 규칙은 `allowExtraArgs: false`다.
  - 키가 있고 묻는 중이면 모델 목록을 요청한다(실제 API 요청). 실패하면 자리표시자를 남긴다.
  - 종료: `created` 0, `declined` 3(터미널에서 거절).
- **`runs`(N-7)**: `RunsOutput`. `--workspace`가 없으면 현재 디렉터리다. `--limit`은 1~`RUNS_MAX_LIMIT`(1000), 기본 `RUNS_DEFAULT_LIMIT`(20). 상태 디렉터리를 만들지 않고 잠금도 잡지 않는다. 기록이 없으면 빈 목록(종료 0)이다.
- **실행 기록 확인(N-16, 검토 M2)**: `listRuns`는 `report`와 같은 수준으로 기록을 확인한다. 세부는 `RunListEntry` 주석이 기준이다.
  - 확인: 실행 디렉터리가 링크가 아님, journal 첫 기록이 `seq` 1의 `run_started`이고 `runId`가 디렉터리 이름과 같음, `taskId`가 task id 형식, 시각이 `RUN_TIMESTAMP_PATTERN_SOURCE`(UTC `Z`) 형식, result.json의 `kind`·`runId`·상태와 이유의 조합·`exitCode`, revert.json의 `kind`·`runId`·시각·상태.
  - 통과한 실행은 `state: "checked"`다. 하나라도 실패하면 `state: "damaged"`이고 실행 id만 가진다. 손상된 실행은 목록 뒤쪽에 "손상"으로만 표시하고 `latest`로 고르지 않는다.
  - result.json이나 revert.json이 없는 것은 손상이 아니다(해당 필드가 null). 있는데 읽기·해석·확인에 실패하면 손상이다.
  - 항목에 들어가는 문자열은 위 형식을 통과한 것뿐이라 제어 문자나 키 모양이 들어갈 수 없다. 사람용 표에는 `taskId`를 쓰지 않는다(N-14).
- **`--run latest`(N-7, N-18)**: `report`, `revert`, 그리고 18절의 `plan`, `review`, `changes`에서 `listRuns`의 첫 `checked` 실행을 뜻한다. `apply`는 받지 않는다(승인이 계획 하나를 가리켜야 한다). 그런 실행이 없으면 `run_not_found`다. 이름이 정확히 `latest`인 실행 디렉터리(`.codaryn/runs/latest`)가 실제로 있으면 별칭으로 해석하지 않고 `invalid_arguments`로 끝나며 아무것도 바꾸지 않는다(검토 L1).
- **`revert --dry-run`(N-7)**: `RevertRequest.dryRun`. 실제 되돌리기와 같은 판정을 하고 아무것도 바꾸지 않는다. 잠금을 잡지 않고 되돌리기 기록도 쓰지 않는다. 출력은 `dryRun: true`인 `RevertOutput`이고 상태·종료 코드는 실제 되돌리기와 같다(`complete` 0, `partial` 3).
- **되돌리기 기록(N-7)**: 실제 되돌리기는 끝난 뒤 잠금을 쥔 채 `runs/<runId>/revert.json`(`RevertRecord`)을 쓴다. 이전 기록이 N-16의 확인을 통과하면 출력의 `revertedBefore`에 그 시각과 상태를 담는다(두 번째 되돌리기가 `changed_since_run`인 이유를 알려 준다). 동작과 종료 코드는 바뀌지 않는다.
- **`--quiet`**: `run`, `revert`, `apply`가 받는다. stderr의 사람용 출력(오류 설명, 끝 요약, 진행 줄)을 모두 생략한다. 인자 해석이 실패해도 인자에 `--quiet`가 있으면 생략한다.

### 17.4 사람용 출력과 문구 (N-4, N-5)

- stdout 계약은 그대로다. 사람용 글은 stderr에 쓴다.
  - 오류: 모든 명령이 `CliErrorOutput`을 낼 때 `HumanOutput.error`의 글(무엇이, 자세히, 고치는 법, 코드)
  - `run` 끝 요약: `HumanOutput.runSummary`
  - 진행 줄: `PROGRESS_PREFIX` 뒤에 `HumanOutput.progressLine`. 사람 표현을 먼저 쓰고 내부 코드는 괄호에 둔다.
  - `revert` 요약: `HumanOutput.revertSummary`
  - `apply`(G-A): 진행 줄 `HumanOutput.applyProgressLine`, 끝 요약 `HumanOutput.applySummary`
    - 시작 기록(`plan_item_started`, R-9 I-4)은 저장만 하고 진행 줄로 넘기지 않는다.
  - 터미널 질문(`[y/N]`, 기본 아니오): `init`, `apply`의 승인, `apply`·`revert`의 위험한 이동 동의(18.4, 18.10)
- 언어는 `SelectMessageLanguage`로 정한다. 오류 코드, JSON 필드, 종료 코드, 명령 이름은 영어로 고정한다.
- 문구는 `MESSAGE_IDS`의 id로만 만든다. 두 카탈로그는 모든 id를 가지고, 템플릿은 `FIXED_MESSAGES`가 정한 매개변수를 모두 쓰고 다른 것은 쓰지 않는다.
- **매개변수 타입(N-14, 검토 H1)**: `MessageCatalog.format(id, params)`의 `params`는 id마다 타입이 정해진다(`MessageParamsOf`). 종류(`MessageParamTypeByKind`)와 타입:
  - 숫자(`count`): 개수, 턴, 회차, 줄·열, 시간(ms)
  - 고정 코드: 상태, 이유, 권한 종류, 거부 코드, 모델 오류 종류, 무결성 단계, 제공자(모두 닫힌 합집합 타입)
  - 스키마 필드 위치(`SchemaFieldPath`): `toSchemaFieldPath`만 만든다. 이름 조각은 `SCHEMA_FIELD_NAMES`에 있는 것뿐이고 나머지는 `[숫자]`다. 프로필은 `profiles[3]`처럼 순번으로 쓰고, 모르는 키는 그 키를 가진 객체의 위치로 쓴다.
  - 실행 id(`RunId`, `toRunId`), 다른 문구(`CatalogText`, `format`의 반환값만), 설정 위치 표기(`ConfigLocationDisplay`: `DEFAULT_CONFIG_DISPLAY`의 값, `--config`, `CODARYN_CONFIG`), `init` 제안 목록(`INIT_SUGGESTED_COMMANDS`, `INIT_SUGGESTED_PROTECTED_PATHS`)
  - 자유 문자열을 받는 매개변수는 없다. 검증기는 id 대신 순번(그 실행의 `verifier_result`에 처음 나온 순서)으로, 프로필은 적용 여부로만, 작업 공간은 `<작업 공간>` 또는 `.`로만 보여 준다. 명령 안내는 템플릿의 고정 글이고 매개변수는 실행 id뿐이다.
  - `DefaultConfigLocation.display`, `InitOutput.config.display`도 같은 고정 상수 타입으로 좁혔다.
- **경로**: 문구는 경로를 받지 않는다. 렌더러는 출력과 기록에 이미 있는 가림 경로(`changes[].path`, `reverted[].path`, `skipped[].path`, `file_changed.path`)만 문구 뒤의 항목으로 쓸 수 있고, `report`처럼 제어 문자를 바꾸고 키 모양을 가리고 길이를 자른다.
- **오류 설명(N-15)**: `HumanOutput.error`는 `error.<code>.what`, 진단(있을 때), `error.<code>.fix`, 코드를 쓴다. 영어 `message`는 JSON에만 남고 stderr 설명에는 쓰지 않는다.
- **실행 끝 요약(N-17, 검토 M3)**: `RunSummaryContext`는 `workspaceForm`(`current`, `given`, `task`), `configDefault`(기본 위치 표기 또는 null), `profileApplied`, `deniedToolCalls`를 넘긴다. `deniedToolCalls`는 그 실행에서 `allowed: false`인 `tool_decision` 기록 수로, `ReportJournalSummary.deniedToolCalls`와 같은 뜻이다. CLI가 기록을 따라가며 센다.
- CLI는 렌더링된 글을 실행의 개인정보 게이트로 가리고(있을 때) 제어 문자를 바꾼 뒤 쓴다. stderr 쓰기 실패는 결과에 영향을 주지 않는다.
- 모듈 경계: `src/i18n/index.ts`가 `selectMessageLanguage`, `createMessageCatalog`를, `src/cli/human/index.ts`가 `createHumanOutput`을 export한다. CLI는 진입 파일에서 이것들을 만들어 각 명령에 넘긴다. `init`의 글은 `src/cli/init.ts`가 카탈로그로 직접 만든다.

### 17.5 입력 진단 (N-15, 검토 M1)

- `CliErrorOutput.diagnostic`(선택, `InputDiagnostic`): `invalid_config`, `invalid_task`, `invalid_script`에서 위치를 안전하게 말할 수 있을 때만 둔다. 기존 `message`는 그대로다.
- 필드: `code`(`INPUT_DIAGNOSTIC_CODES`: `json_syntax`, `unknown_field`, `invalid_value`, `missing_field`, `too_deep`), `file`(`config`, `task`, `script`), `field`(`SchemaFieldPath` 또는 null), `line`·`column`(`json_syntax`만, 1부터, 열은 유니코드 코드 포인트 단위, BOM 제외), `suggestion`(`unknown_field`만, 가까운 허용 필드 이름).
- 내보내지 않는 것: JSON 파서의 예외 문구(원문 조각을 담을 수 있다), 값, 모르는 키의 이름. 모르는 키는 그 키를 가진 객체의 위치(`config`, `limits`, `policy.commands[0]`)로만 말한다.
- 문구는 `diagnostic.<code>`와 `diagnostic.file.<file>`이다. 구현은 N-A(검증기와 CLI)다.

### 17.6 문구·출력 계약 추가 (N-20~N-23)

N-B·N-C 보고의 계약 보완이다. 이 계약 커밋 시점에는 계약만 있고, 카탈로그 글(N-B)과 렌더러(N-C)는 이 계약에 맞춰야 컴파일된다(새 id가 `MessageTexts`에 필요하고 `summary.usage`의 매개변수가 바뀌었다).

- **코드의 사람 말(N-20)**: 목록 id `denial.<거부·도구 오류 코드>`, `permission.<권한 종류>`, `phase.<무결성 단계>`, `modelError.<모델 오류 종류>`를 더했다. 진행 줄과 요약은 사람 말을 먼저 쓰고 코드는 괄호에 둔다.
- **초 단위 시간(N-20)**: 매개변수 종류 `seconds`(0 이상, 소수 한 자리까지)를 더했다. `summary.usage`는 `{ turns, toolCalls, seconds }`다. 렌더러가 ms를 0.1초 단위로 반올림한다.
- **예·아니오 기본 답(N-20)**: `init.yes_no`를 없애고 `prompt.yes_no_default_yes`, `prompt.yes_no_default_no`를 두었다. 질문별 기본은 `INIT_QUESTION_DEFAULTS`다: 파일 만들기 예, 명령 허용 제안 아니오(실행 권한을 넓히는 질문은 Enter로 바뀌지 않는다), 보호 경로 제안 예. 분명한 예·아니오가 아니면 기본 답, 입력이 끝나면 아니오다.
- **언어 출처(N-20)**: `explainMessageLanguage`(`ExplainMessageLanguage`)가 `{ language, source, envIgnored }`를 돌려준다(`source`: `env`, `config`, `os`, `default`). 입력 값은 담지 않는다. 문구는 `language.chosen`, `language.source.<출처>`, `language.env_ignored`다. `doctor`에 `language` 점검을 마지막 항목으로 더했다(CODARYN_LANG이 ko·en이 아니면 `warn`).
- **help와 doctor 문구(N-21)**: 한 줄짜리 고정 id(`help.*`, `doctor.*`)와 목록 id(`help.command.<명령>`, `help.option.<옵션>`, `help.exit.<명령>`, `doctor.check.<점검 id>`, `doctor.status.<상태>`)를 더했다. 사용법 줄(명령 문법)은 영어로 CLI가 찍는다. `DoctorCheck.text`(`DoctorText`, 선택)가 같은 결과를 문구 id와 매개변수로 담고, JSON의 영어 `message`는 그대로 둔다. 점검 id와 상태 값은 영어다.
- **진행 줄 `progress.tool_rejected`(N-22)**: 권한 판정 전 단계(형식 검사, 복원)에서 멈춘 호출이다. `permission`이 없으므로 `{ tool, code }`만 받는다.
- **`already_reverted`(N-22)**: 되돌리기 건너뜀 사유에 더했다. 현재 해시가 그 파일의 첫 `previousHash`와 같거나, 실행이 만든 파일이 이미 없을 때다. 할 일이 없으므로 `partial`로 세지 않는다(`complete`가 될 수 있다).
- **되돌리기 기록(N-22, N-23)**: store의 `readRevertRecord`·`writeRevertRecord`(`ReadRevertRecord`, `WriteRevertRecord`)를 쓴다. 읽기가 실패하거나 기록이 확인을 통과하지 못하면 오류로 끝내지 않고 그 기록 없이 진행한다(`revertedBefore` 없음). 쓰기 실패는 결과를 바꾸지 않는다.
- **`runs` 오류(N-22)**: `invalid_run_record`(`.codaryn`이나 `runs`가 링크이거나 나열할 수 없음)를 더했다. `--run latest`의 목록 실패도 같다. `parseRunsArgs`와 `RUNS_USAGE`는 `src/cli/runs.ts`에 있다. 실행 목록 확인은 `report`만큼 엄격하다(`RunListEntry` 주석).
- **`doctor` 안내(N-22)**: `DOCTOR_HINT_ERROR_CODES`(`invalid_config`, `invalid_task`, `key_in_file`, `secret_env_missing`, `workspace_is_install_dir`, `provider_not_configured`, `model_list_failed`)의 오류에만 `error.doctor_hint`를 붙인다.
- **요약의 notices(N-22)**: 실행 끝 요약은 `notices`를 보이지 않는다. 모델 404 안내는 진행 줄(`progress.model_not_found`)이 맡고, notices는 JSON과 보고서에 남는다.
- **거부 안내의 정책 위치(N-23)**: `RunSummaryContext.policySource`(`task`, `config`)와 `deniedCommandCalls`(권한이 `command`인 거부 수)를 더했다. 안내는 `deniedCommandCalls`가 1 이상일 때만 낸다. task 파일 실행이면 `summary.denied_hint_task`(task의 `policy.commands`), 간편 형식과 한 줄 실행이면 `summary.denied_hint`(설정 파일이나 프로필)를 쓴다.
- **`--run latest`가 고른 실행(N-23)**: `revert`와 `report`는 `latest`를 풀면 무엇을 하기 전에 stderr에 고른 실행 id와 시작 시각을 먼저 쓴다(`HumanOutput.latestChosen`, 문구 `latest.chosen`, 시각은 확인된 `startedAt`을 지역 시간으로). `--quiet`이면 쓰지 않는다.

- **N-24(검토 R-3)**
  - (a) `report`의 Markdown과 진행 줄은 검증기를 id 대신 순번으로 쓴다. id는 `--json`에만 남는다.
  - (b) 실행 목록 항목의 실행 id·작업 id는 패턴을 통과해도 키 모양일 수 있다. 그래서 JSON과 표 모두 키 모양을 가린다(`report`와 같다).
  - (d) `SCHEMA_FIELD_NAMES`에 대본의 `usage` 하위 필드 `inputTokens`, `outputTokens`를 더했다.
  - (e) 문구 함수는 값의 종류를 실행 중에 다시 확인한다. 맞지 않는 값은 내지 않고 고정 대체 글로 둔다(`MessageCatalog` 주석).
- **N-25(a) 작업 공간 잠금**
  - `workspace_locked`의 사람용 오류에 `lock.remove_hint`("이 작업 공간에서 실행 중인 Codaryn이 없으면 `.codaryn/lock.json`을 지우세요")를 붙인다.
  - `doctor`에 `lock` 점검을 마지막 항목으로 더했다. `.codaryn/lock.json`을 바꾸지 않고 읽는다.
  - 결과: 없음(`ok`), 살아 있는 프로세스가 쥠(`warn`, 안내 포함), 끝난 프로세스가 남김(`ok`, 다음 실행이 회수), 읽을 수 없음(`warn`). 작업 공간이 없으면 `skipped`다.
  - pid가 다른 프로세스에 다시 주어질 수 있어 "쥠" 판정은 틀릴 수 있다(architecture A-6).
  - N-25 (b), 검토 R-6 L-1: store와 같이 프로세스 시작 시각으로 판정한다. 같은 pid라도 시작 시각이 `PROCESS_START_TOLERANCE_MS`보다 다르면 끝난 것이다.
  - **알려진 차이**: Linux에서 store는 부팅 뒤 틱(`processStartTicks`, `bootId`, N-27 d)으로 판정하지만 doctor는 아직 시작 시각만 본다. 벽시계를 크게 바꾼 뒤에는 둘의 판정이 다를 수 있다.
  - reclaim 파일(DR-27 b)
    - `.codaryn/lock.json.reclaim`이 store가 지우지 않는 상태면 `reclaim_left`(`warn`)다.
      - 쓰는 중으로 보이는 글(끝 줄바꿈이 없고 온전한 JSON이 아님)
      - 이해할 수 없는 글
      - 주인이 살아 있음
    - 그동안은 끝난 잠금도 회수되지 않는다. 안내는 Codaryn이 돌지 않으면 그 파일(그리고 `lock.json`)을 지우라고 한다.
    - 주인이 끝난 reclaim 파일은 다음 실행이 지우므로 `lock.json`의 판정을 따른다.
    - `lock.remove_hint` 문구도 reclaim 파일을 가리킨다(N-B 문구).
- **doctor `commands` 점검(G-F, Q5)**: `allowExtraArgs: true` 명령 규칙과 `policy.planActions`가 함께 있으면 `warn`이다. 다른 문제가 있으면 그 글을 두고 경고를 메시지에 붙인다. 계약 기준에 문구 id가 아직 없어 영어 글로 나온다(18.9).

### 17.7 오류 코드 추가

- `config_exists`(종료 2): `init`의 대상 위치에 파일이 이미 있다. 아무것도 쓰지 않았다.
- `config_write_failed`(종료 2)는 `init`에서도 쓴다.

## 18. 범용 작업 명령 (G-F: 워크플로, plan, apply, review, changes)

계약 원문은 `src/contracts/workflow.ts`, `plan.ts`, `changes.ts`, `engine.ts`이고, 설계는 `docs/design/general-tasks.md`, 결정은 `docs/work-orders/phase-4-5-design.md`(DR-1~DR-25)다. 이 절은 CLI가 그 계약을 어떻게 받는지 적는다.

### 18.1 워크플로 해석 (DR-2, DR-3)

- 실행이 쓰는 워크플로는 다음 순서로 처음 있는 것이다.
  1. task 파일의 `workflowRef`
  2. 간편 형식의 `--workflow <id>`
  3. 프로필의 `workflowRef`
- 셋 다 없으면 단계 1~3의 실행과 같다(워크플로 설정 없음).
- 간편 형식에서는 `--workflow`의 id가 이름표(`workflow`)도 된다.
- 내장 워크플로 다섯 개는 `src/workflows`에 있다. 설정 파일의 `workflows`는 새 id만 정의할 수 있고, 내장 id를 다시 정의하면 거부된다.

  | id | 도구 | 계획 | 완료 |
  | --- | --- | --- | --- |
  | `general` | 전체 | 없음 | 검증기 |
  | `code` | 전체 | 없음 | 검증기 |
  | `document` | 읽기·찾기·쓰기 | 없음 | 검증기 |
  | `analyze` | 읽기·찾기·쓰기 | 없음 | 사람 검토(확인 목록 2개) |
  | `organize` | 읽기·찾기·`inspect_files`·`propose_plan` | `apply`, 명령 금지 | 계획 승인 |

- 해석 규칙(`resolveWorkflow`)
  - 도구는 워크플로가 허용한 것 안에서만 좁힐 수 있다.
  - `plan: "apply"`는 약하게 바꿀 수 없다.
  - `allowCommands: false`인 워크플로에서는 `policy.commands`를 쓸 수 없다.
    - 이 금지는 모델이 부를 수 있는 명령(정책의 명령 규칙)에 대한 것이다(GT-D10). 사람이 task나 설정에 둔 `command` 검증기는 막지 않는다(설계 4.3). 그 검증기는 적용 뒤, 인벤토리 점검 다음에 실행되므로, 거기서 바꾼 파일은 인벤토리가 보지 않는다(검토 R-11 L-3, PM 판단 P-3 대기).
  - 사람 검토 워크플로에는 확인 목록이 있어야 한다.
- 정의의 `limits`는 기본값이다(검토 R-11 L-1).
  - task 파일이 비운 칸을 채우고, 설정 파일의 값보다 크면 그 값까지만 쓴다.
  - 상한은 설정 파일만 정한다(S-7). 정의 값이 상한이 되지는 않는다.
  - 간편 형식에서는 설정 파일의 한도가 그 실행의 한도이고, 정의 값은 설정에 없는 칸만 채운다.
- 간편 형식의 `plan`·`apply`·`review`도 실행 설정(한도 포함)을 설정 파일에서 읽는다. 빠지면 `invalid_config`이고, 계획 실행의 task를 `--task`로 주라고 안내한다(검토 R-11 L-2).
- task 필드 `tools`, `completion`, `humanReview`, `policy.planActions`는 해석된 워크플로의 상한 안에서만 받는다. 상한을 넘으면 `invalid_task`이고, 진단은 필드 위치를 가리킨다.
- 검증기 종류 `data_checks`(표 참조, 행 수, 값 규칙)를 task와 설정에서 받는다(`src/contracts/verify.ts`).
- `prepareTask`(1~7단계: 설정, 변수 파일, 프로필, 키 거부, 위치 규칙, 워크플로, 비밀 등록)는 `run`, `plan`, `apply`, `review`, `changes`가 함께 쓴다(DR-17).

### 18.2 task 형식 (DR-17)

`plan`, `apply`, `review`는 `run`과 같은 형식을 받는다. `changes`도 같지만 `--workflow`는 받지 않는다(앱 계층의 `TaskForm`과 같은 인자 해석, `src/cli/changes.ts`).

```
(--task <task.json> | --workspace <dir> [--profile <name>] [--workflow <id>]) [--config <config.json>] [--vars-file <path>]
```

그 설정이 가리는 비밀은 지금 실행을 시작했다면 등록될 비밀이다. 그 비밀로 계획·기록을 다시 가려서 보여 준다(DR-5). 이 명령들은 모델을 부르지 않는다.

### 18.3 `codaryn plan`

```
codaryn plan <task 형식> --run <runId|latest> [--json]
```

- 대상: `needs-input`/`plan_pending`으로 끝난 실행의 `plan.json`. 다른 실행이면 `run_not_plan`이다.
- 출력
  - `PlanOutput`: 행동 목록(지금 비밀로 가린 경로), 다이제스트, 적용 여부(`appliedBy`)
  - 인벤토리 상한 도달 여부
  - 글 출력의 마지막 줄은 적용 명령(`--digest`에 다이제스트 앞 12자)이다.
- 기록의 사본은 보여 주지 않는다. `plan.json`을 다시 가린다(DR-5).
- 같은 비밀인지 확인(DR-28, 검토 R-11 M-1)
  - `plan.json`의 각 행동은 계획 실행이 가린 표기의 보이는 조각(`shown`)을 함께 담는다. 비밀 값이나 그 해시는 담지 않는다.
  - `plan`과 `apply`는 지금 형식이 등록한 비밀로 다시 가린 결과를 `planActionShownMatches`로 그 조각과 비교한다.
  - 하나라도 다르거나 `shown`이 없는 계획(DR-28 전)이면, 계획을 읽은 직후 `plan_secrets_differ`(종료 2)로 끝난다. 아무것도 보이거나 묻거나 기록하거나 옮기지 않고, 적용 실행도 만들지 않는다.
  - 계획 실행과 같은 task 형식(`--task`)으로 다시 하거나 계획을 새로 만든다. 엔진의 같은 검사는 두 번째 방어로 남는다.

### 18.4 `codaryn apply`

```
codaryn apply <task 형식> --run <runId> --digest <앞 12자 이상의 16진수> [--allow-unsafe-move] [--cancel-file <path>] [--quiet]
```

- `--run latest`는 받지 않는다. 승인이 계획 하나를 가리켜야 하기 때문이다.
- 거부 조건(모두 종료 2, 아무것도 옮기지 않는다)
  - task가 `plan: "apply"` 워크플로로 해석되지 않으면 `run_not_plan`
  - 이미 적용된 계획이면 `plan_already_applied`
- 승인
  - `--digest`가 저장된 다이제스트의 앞부분이어야 한다(`MIN_PLAN_DIGEST_PREFIX` = 12자 이상).
  - stdin과 stderr가 터미널이고 `--digest`가 없으면 계획을 보이고 `[y/N]`을 묻는다. 기본은 아니오다.
  - 어느 쪽도 아니면 `plan_not_approved`(종료 2)다.
- 적용
  - 잠금을 잡고 적용 실행을 새로 만든다. 첫 기록은 `apply_started`다.
  - 지금 task의 정책·검증기·비밀로 적용한다(DR-5).
  - 폐기한 파일은 `.codaryn/discarded/<적용 runId>/`에 행동 번호 이름으로 남는다(DR-9).
  - stdout에는 `ApplyResult` 한 줄이 나오고, 같은 내용이 적용 실행의 `result.json`이 된다.
  - 되돌리기: `codaryn revert --run <적용 runId>`
- 위험한 이동에 대한 동의(DR-21)
  - 하드 링크가 없는 드라이브에서는 대상에 생긴 파일을 덮지 않는다는 보장 없이만 옮길 수 있다. 기본은 옮기지 않는다. 적용 전 점검이 그 이동을 `plan_checked.unsafeMoves`에 적고, 적용은 `needs-input`/`consent_required`로 끝난다(아무것도 옮기지 않음).
  - 동의는 사람의 입력으로만 받는다.
    - `--allow-unsafe-move`(`cli-flag`)
    - 터미널에서 그 적용이 `consent_required`로 끝난 뒤 한 번 묻는 `[y/N]`(`cli-tty`). 예이면 동의를 붙여 적용 실행을 하나 더 한다.
  - task·설정·프로필·계획·모델에는 동의 필드가 없다. task에 그런 필드가 있으면 `invalid_task`다.
  - 동의는 그 계획의 다이제스트에 대해 그 적용 한 번만 유효하다. `apply_started.unsafeMoveConsent`에 기록되고, 그렇게 옮긴 이동에는 `unsafe: true`가 붙는다.
- 앱 계층의 적용(DR-1, DR-21, PM 결정: 앱 계층 질문 A-4 1)
  - 앱 계층은 GUI의 적용에 같은 `runApply`를 부르고, `ApplyCommandEnvironment.adapter`(`AdapterApply`, `src/cli/plan-commands.ts`)를 넘긴다. CLI 자기 프로세스는 이 필드를 쓰지 않는다.
  - 승인은 `adapter`로 기록된다. GUI의 적용이 `cli-flag`로 기록되지 않는다. 승인할 계획은 여전히 `--digest`로 가리킨다. 없으면 `plan_not_approved`다.
  - 터미널 질문은 하지 않는다. `--allow-unsafe-move`는 `invalid_arguments`로 거부한다.
  - `adapter.unsafeMoveConsent`는 **호출자가 사람의 입력으로 받은 것만** 넘긴다. 사람이 화면에서 그 적용 한 번에 동의한 것이어야 한다. task·설정·프로필·계획·모델이나 이전 적용에서 온 값을 넘기지 않는다.
  - 그 동의의 경로는 `adapter`, 다이제스트는 적용하는 계획의 전체 다이제스트여야 한다. 아니면 실행 전에 `invalid_arguments`다. 동의가 null이면 `consent_required`로 끝나고 다시 묻지 않는다. GUI가 사람에게 묻고 다시 부른다.
- 검증기 명령의 부모 환경(DR-4): `runApply`는 받은 환경(`parentEnv`, 없으면 `env`)을 명령 실행기에 넘기고 `CHILD_ENV_ALLOWLIST`로 거른다. 앱 계층은 변수 파일을 읽어 넣은 실행의 환경 사본을 넘긴다. CLI 자기 프로세스에서는 `process.env`다.

### 18.5 `codaryn review`

```
codaryn review <task 형식> --run <runId|latest> (--accept | --reject) [--note <text>] [--json]
```

- 대상: `needs-input`/`awaiting_review`로 끝난 실행. 다른 실행이면 `run_not_awaiting_review`(종료 2)다.
- 판정을 `review.json`에 쓴다(`ReviewRecord`). 다시 판정하면 이전 판정을 바꾸고 출력에 `replaced`가 나온다. `result.json`은 바뀌지 않는다. 검토로 실행이 `done`이 되지는 않는다.
- 메모
  - `MAX_REVIEW_NOTE_CHARS`(500)자 이하
  - 키 모양이 있으면 `key_in_file`
  - 나머지는 지금 비밀로 가려서 저장한다.

### 18.6 `codaryn changes` (DR-7, DR-14)

```
codaryn changes <task 형식> --run <runId|latest> [--json]
```

- 실행이 바꾼 파일마다 상태, 실행 전후 내용, 바뀐 구역(`-`/`+` 줄)을 보여 준다. 지금 비밀로 가린다(`masking: "current_secrets"`).
- 읽기만 한다. 잠금도, 요청도 하지 않는다.
- `--json`은 `ChangesOutput` ASCII 한 줄이다(N-19). 키 모양은 JSON으로 만들기 전에 문자열마다 가린다(N-27 (c)).

### 18.7 기록을 읽는 명령의 공통 규칙

- 실행 id(N-27 (a))
  - 명시한 `--run <id>`는 store의 `inspectRun` 판정을 따른다. 그 이름 그대로인 항목이 없으면 `run_not_found`다. 대소문자만 다른 id도 여기에 걸린다.
  - 목록이 "손상"으로 보는 실행은 `revert`(N-26), `report`(N-27 (b)), `plan`, `apply`, `review`가 모두 `invalid_run_record`로 거부한다.
- 상태별 이유 표(DR-16)
  - 실행과 적용 실행의 이유는 `RUN_REASONS_BY_STATUS`(`isReasonOfStatus`) 하나로 판정한다. CLI는 따로 목록을 두지 않는다.
  - 적용 실행의 이유는 그 부분집합인 `APPLY_REASONS_BY_STATUS`를 쓴다.
- `report`
  - 계획 실행은 행동 수, 다이제스트, `plan` 명령을 보여 준다.
  - 검토 대기 실행은 확인 목록과 사람의 판정을 보여 준다.
    - `--json`에서는 `verdict`(`review.json`의 `ReviewRecord`)다. 판정 전이나 기록을 읽을 수 없으면 `null`이다.
    - 검토 대기가 아닌 실행에는 이 필드가 없다.
  - 검증기 종류는 계약의 `VERIFIER_KINDS`(`data_checks`, `inventory` 포함)를 따른다. 제공자와 검증 결과 목록은 계약 형과 컴파일 때 대조한다(통합 사례 n07).
  - 적용 실행(첫 기록 `apply_started`, DR-12)은 적용 실행 보고서다.
    - `--json`: `ApplyReportOutput`(`kind: "report"`, `runKind: "apply"`, `result`는 `ApplyResult` 또는 null, `journal`은 `ApplyReportJournalSummary`)
    - `ApplyReportJournalSummary`의 필드
      - 계획 실행, 다이제스트, 승인 경로, 동의 경로, 행동 수
      - 사전 점검(문제 수, 인벤토리 상한, 위험한 이동 수)
      - 시작한 행동 수, 옮긴·폐기한·실패한 행동
      - 검증 결과(인벤토리 먼저), 무결성 점검, 끝 기록
    - `result.json`이 기록과 다른 계획·task·다이제스트를 가리키면 `invalid_run_record`다.
    - Markdown은 행동마다 무엇을 했는지와 되돌리는 명령을 보여 준다.
  - `runKind`, `verdict`, `ApplyReportOutput`은 CLI 쪽 형(`src/cli/report.ts`)이다. 계약(`ReportOutput`)에 들어가면 그 형을 따른다.
  - `--json`은 문자열마다 키를 가린 뒤에 만든다(N-27 (c)).
- 기록의 도구 이름과 호출 id(AC-D15)
  - 목록 밖의 도구 이름은 `unknown_tool`로 기록한다.
  - 호출 id는 `[A-Za-z0-9_-]{1,64}`이고 비밀이 없어야 한다. 아니면 `codaryn-call-<n>`으로 기록한다.

### 18.8 오류 코드 추가 (G-A)

- 모두 종료 2이고, 아무것도 바꾸지 않는다.
- `run_not_plan`, `plan_not_approved`, `plan_already_applied`, `run_not_awaiting_review`
- 뜻은 `src/contracts/engine.ts`의 `CLI_ERROR_EXIT_CODES` 주석과 위 절을 따른다.

### 18.9 아직 없는 것

- 도움말: `plan`, `apply`, `review`, `changes`는 사용법 줄과 영어 한 문장만 나온다. `HELP_COMMANDS`와 `help.*` 문구 id가 계약에 들어오면 두 언어로 바꾼다(w3:p9, N-B).
- 영어 고정 글
  - `plan`·`review`의 글 출력과 질문 세 개(`Apply this plan?`, 적용과 되돌리기의 위험한 이동 동의)는 아직 영어 고정 글이다. 문구 id가 생기면 카탈로그로 옮긴다.
- `report`의 적용 실행 형태와 `verdict` 필드는 계약에 아직 없다(18.7, 계약 담당에 제안).
- doctor의 Q5 경고는 계약 기준(`b89ee16`)에 `doctor.commands.extra_args_with_plan`이 없어 영어 글로만 나온다. 계약 소유자가 그 id를 더하면 두 언어로 바꾼다.
- 도움말의 옵션 설명에 `--allow-unsafe-move`(`HelpOption`)가 없다. 사용법 줄에만 나온다.

### 18.10 되돌리기의 위험한 이동에 대한 동의 (DR-25)

```
codaryn revert --workspace <dir> --run <runId|latest> [--dry-run | --allow-unsafe-move] [--quiet]
```

- 하드 링크가 없는 드라이브에서는 적용 실행이 옮긴 파일을, 원래 자리에 생긴 파일을 덮지 않는다는 보장 없이만 되돌릴 수 있다. 기본은 옮기지 않고 `unsafe_move`로 건너뛴다(DR-24 (b)). 안전하게 되돌릴 수 있는 파일은 언제나 안전하게 되돌린다.
- 동의는 apply(18.4)와 같이 사람의 입력으로만 받는다.
  - `--allow-unsafe-move`(`cli-flag`)
    - 그 명령이 되돌리는 실행(`--run latest`이면 고른 실행)에 대한 동의다.
    - `--dry-run`과 함께 줄 수 없다. 드라이 런은 아무것도 옮기지 않고 볼륨을 판정하지도 않는다.
  - 터미널에서 되돌리기가 `unsafe_move`로 건너뛴 파일이 있으면 그 수를 넣어 `[y/N]`을 한 번 묻는다(`cli-tty`).
    - 예이면 그 실행만 동의를 붙여 다시 되돌린다.
    - 이미 되돌린 파일은 `already_reverted`로 건드리지 않는다.
  - 앱 계층: `RevertEnvironment.adapter`(`AdapterRevert`, `src/cli/revert.ts`)
    - 호출자가 사람의 화면 입력으로 그 되돌리기 한 번에 받은 동의만 넘긴다. 경로는 `adapter`, `runId`는 되돌리는 실행이어야 한다. 아니면 실행 전에 `invalid_arguments`다.
    - 터미널 질문은 하지 않고, `--allow-unsafe-move`는 거부한다.
- store에는 `RevertRequest.unsafeMoveConsent { channel, runId }`로 넘긴다. 그렇게 옮긴 파일은 `reverted`에 `unsafe: true`로 나온다.
- `revert.json`(RevertRecord)에는 동의 경로(`unsafeMoveConsent`, 없으면 null)와, `reverted` 중 `unsafe`인 항목 수(`unsafeMoves`)를 쓴다.
- 드라이 런이 옮길 파일을 나열하면 출력에 `moveSafetyUnchecked: true`가 붙는다. 사람용 요약은 `revert.dry_run_move_unchecked`로 그 사실을 알린다.
