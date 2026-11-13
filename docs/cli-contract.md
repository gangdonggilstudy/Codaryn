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
- `privacy.secretEnv`에는 환경 변수 이름만 적는다(`^[A-Za-z_][A-Za-z0-9_]*$`, S-3). 값은 실행 시 환경에서 읽어 가릴 값으로 등록한다. 오류 메시지는 `privacy.secretEnv[i]`처럼 위치만 적고 항목을 적지 않는다.
- 권한은 경로, 명령(`executable`과 `args`), 네트워크, 파괴적 동작을 각각 판정한다. `network`와 `destructive`는 1a에서 `"deny"`만 있다. 네트워크 차단이 아니라 네트워크를 쓰는 도구가 없다는 뜻이다.
- `model.provider`가 `"anthropic"`이면 `model`에 선택 필드 `model`(모델 ID)과 `maxOutputTokens`(요청당 출력 토큰 상한, `MAX_OUTPUT_TOKENS_LIMIT` 200,000 이하, T-14)를 둘 수 있다. scripted에는 이 필드를 쓸 수 없다. 키, 모델, 출력 상한 중 하나라도 정해지지 않으면 `provider_not_configured`로 전송 없이 끝난다(11절).
- `limits`와 그 필드는 설정 파일이 채울 수 있으면 생략해도 된다. 설정 파일의 한도는 상한이다. task는 필드마다 그 값 이하로만 정할 수 있다(11절 "한도", S-7). 예산 한도 넷(`maxModelTurns`, `maxToolCalls`, `maxTotalTokens`, `maxDurationMs`) 중 어디에도 없는 필드가 있으면 `invalid_task`다. anthropic 제공자에서는 `maxTotalTokens: null`을 쓸 수 없다.
- 재수정 한도 `maxRepairAttempts`(0 이상 정수)와 `maxSameFailures`(1 이상 정수)는 두 파일 모두에서 생략할 수 있고, 그때는 0과 2다(`DEFAULT_MAX_REPAIR_ATTEMPTS`, `DEFAULT_MAX_SAME_FAILURES`). 0이면 단계 1과 같이 첫 검증 실패에서 끝난다(12절).
- `policy.protectedPaths`는 선택이다(13절).
- 파일 형식은 `TaskSpec`, CLI가 해석해 엔진에 넘기는 형은 `ResolvedTaskSpec`(경로는 절대 경로, 한도 여섯 개가 모두 정해짐)이다. `EngineDeps.task`는 `ResolvedTaskSpec`이다.
- task 파일과 설정 파일은 UTF-8이며 BOM이 있어도 읽는다.
- 검증기는 `command`(`executable`, `args`, 선택 `cwd`·`timeoutMs`·`expectExitCode`)와 `file_rules`(`exists`, `absent`, `contains`, `not_contains`, `markdown_headings`, `markdown_links`) 두 종류다. `timeoutMs`는 1~2,147,483,647ms다(S-7). 결과에는 `outcome`(pass/fail/inconclusive), `evidence`, `checked`, `limits`가 있다.
  - U-116(P1 묶음 C, 계약 `MarkdownFileRule`): `markdown_headings`는 `path`, `headings`(1~`MAX_MARKDOWN_RULE_HEADINGS` 50개; 항목마다 `text`는 앞뒤 공백을 뗀 뒤 1~`MAX_MARKDOWN_HEADING_CHARS` 200자(코드 포인트)이고 뗀 글로 저장, 선택 `level`은 1~6 정수), 선택 `order`(`any` 기본, `in_order`)만 받는다. `markdown_links`는 `path`만 받는다. 그 밖의 필드나 값은 `invalid_task`(설정의 검증기면 `invalid_config`)다.
  - 이 오류의 진단(`diagnostic.field`)은 그 규칙(`verifiers[i].rules[j]`)을 가리킨다. 메시지는 정확한 자리(`…headings[k].text` 등)를 말한다. `headings`·`level`·`order`가 계약의 `SCHEMA_FIELD_NAMES`에 아직 없어서다.
  - 파일을 읽고 판정하는 것은 검증기다(제목은 ATX·Setext를 앞뒤 공백과 닫는 `#`를 뗀 글자로 정확히 비교, 링크는 상대 경로의 대상이 작업 공간 안에 있는지, 파일 1 MiB까지, 네트워크 없음). CLI는 모양만 검사한다.
  - 읽는 규칙과 한계(U-150, main의 `src/verify/markdown.ts`대로; R-89의 고침 U-116):
    - 줄 끝은 LF, CR LF, 홀로 있는 CR이다(CommonMark). 앞의 BOM은 버린다.
    - 펜스 코드(``` 또는 ~~~)는 통째로, 블록 안의 코드 스팬도 건너뛴다. 들여 쓴 코드 블록은 알아보지 않고 보통 글로 읽는다.
    - HTML은 CommonMark의 HTML 블록 일곱 가지와 블록 안의 HTML 주석(`<!-- … -->`)을 건너뛴다. 그 안의 것은 제목도 링크도 아니다. 일곱 가지: `<script`·`<pre`·`<style`·`<textarea`부터 그 닫는 태그까지, `<!--`부터 `-->`까지, `<?`부터 `?>`까지, `<!X`부터 `>`까지, `<![CDATA[`부터 `]]>`까지, 블록 수준 태그나 한 줄을 차지한 여는·닫는 태그부터 다음 빈 줄까지. 그 밖의 인라인 HTML은 글로 읽는다.
    - 링크 대상의 괄호는 CommonMark처럼 32단까지다. 괄호로 싼 제목 안에 탈출하지 않은 `(`가 있으면 링크가 아니다.
    - 상한 둘(R-89 M-1, PM 결정)을 넘으면 그 규칙은 실패가 아니라 판정 불가(검증기 결과 `inconclusive`)다. 근거에 까닭을 적는다.
      - 줄: `MAX_MARKDOWN_LINE_CHARS`(100,000자, UTF-16 단위)보다 긴 줄. 두 규칙 모두 판정 불가다(`line N is longer than 100000 characters, not read`). 펜스 코드와 HTML 블록 안의 줄은 해석하지 않으므로 세지 않는다.
      - 대괄호: 한 블록에서 짝이 맞은 `[` `]`의 중첩이 `MAX_MARKDOWN_BRACKET_DEPTH`(32)보다 깊으면 `markdown_links`만 판정 불가다(`brackets nested deeper than 32 levels at line N, not read`). `markdown_headings`는 대괄호를 읽지 않으므로 같은 문서에서도 판정한다. 짝 없는 `[`(예: 구간 표기 `[0, 1)`)는 글이라 세지 않는다.
      - 두 상수는 지금 `src/verify/markdown.ts`에 있다. 계약으로 옮길지는 p4g-general이 정한다.
    - 실행의 신호(취소, 시간 한도)로 멈추면 그 규칙은 판정 불가다: 문서를 읽기 전이면 `cancelled before the document was read`, 대상을 보는 중이면 `cancelled while the link targets were checked`.

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
  - 기본은 글이고 `--json`이면 JSON 한 줄: `report`(`AnyReportOutput`: 실행은 `RunReportOutput`, 적용 실행은 `ApplyReportOutput`), `doctor`(`DoctorOutput`), `models`(`ModelsOutput`), `init`(`InitOutput`), `runs`(`RunsOutput`), `plan`(`PlanOutput`), `review`(`ReviewOutput`), `changes`(`ChangesOutput`)
  - 사람용 글(오류 설명, 진행 줄, 끝 요약, 터미널 질문)은 stderr다(17.4). `run`, `revert`, `apply`는 `--quiet`로 끈다.

- 명령 밖으로 새어 나온 예외는 최상위(`src/cli/guard.ts`의 `runGuarded`)에서 잡아 `internal_error`(종료 70) 한 줄로 바꾼다. 예외 문구와 스택은 경로·파일 내용·비밀 값을 담을 수 있으므로 stdout과 stderr 어디에도 출력하지 않는다(S-6).

- 실행 결과 `EngineResult`: `schemaVersion`, `kind:"run"`, `runId`, `taskId`, `status`, `reason`, `exitCode`, `provider`, `verifiers`, `changes`, `usage`, `journalPath`, `notices`.
  - DR-47(U-21, AXM-1): 선택 `finalMessage`(`{text, truncated}`): 에이전트의 마지막 답. 실행의 마지막 모델 응답이 도구 호출 없는 마지막 답(`stop: "final"`)일 때만 있고, 맨 끝 필드다. 등록된 가릴 값은 가려지고 키 모양은 `[key]`, 줄 바꿈은 LF, 탭 말고 제어·보이지 않는 문자는 빠진다. `MAX_FINAL_MESSAGE_CHARS`(2000자)를 넘으면 잘리고 `truncated`가 true다. 계획 실행(`plan_pending`)과 답 없이 끝난 실행, DR-47 전에 쓴 결과에는 없다. 모델의 말이지 검증된 사실이 아니며, 사람용 끝 요약은 `summary.final_message` 머리말 뒤에 인용 줄로 보인다. 필드를 더하기만 한다(DR-48).
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
- 실행 전 오류(`CLI_ERROR_EXIT_CODES`): `invalid_arguments`·`invalid_task`·`invalid_config`·`key_in_file`·`invalid_script`·`secret_env_missing`·`workspace_not_found`·`run_not_found`·`invalid_run_record` 2, `workspace_locked` 6, `provider_not_configured`·`provider_not_implemented` 7, `internal_error` 70. 단계 3에서 `workspace_is_install_dir` 2가 더해졌다(15절). 모델 목록(16절)에서 `model_list_failed` 8, `config_write_failed` 2가 더해졌다. `init`(17절)에서 `config_exists` 2가 더해졌다. 범용 작업 명령(18절)에서 `run_not_plan`, `plan_not_approved`, `plan_already_applied`, `run_not_awaiting_review`, `plan_secrets_differ`(DR-28), `plan_run_missing`(R-9c C-1)(모두 2)가 더해졌다. 그 뒤 `run_in_progress` 6(U-22, DR-48, 17.3의 `--run latest`), `plan_records_changed` 2(U-1, 18.4의 `apply`), `cleanup_plan_changed` 2(U-22, DR-48, 18.13)가 더해졌다(main `1e54ca9`의 실제 CLI로 세 종료 코드를 확인했다).
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
    - `discarded/<적용 runId>/`(`DISCARDED_DIR_NAME`): 폐기한 파일을 동작 번호 이름으로 보관
  - `lock.json`: 작업 공간 잠금.
    - 내용은 `{pid, runId, startedAt}`에, N-25 (b)의 `processStartedAt`과 Linux의 N-27 (d) `processStartTicks`·`bootId`가 더해진다.
    - 주인이 살아 있으면 `workspace_locked`, 끝났으면 회수한다(P-4, T-9). 같은 pid라도 시작 시각이 다르면 끝난 것으로 본다.
    - 회수는 `lock.json.reclaim`을 쥔 한 프로세스만 한다.
    - 하드 링크가 없는 볼륨에서는 두 파일을 배타 생성으로 만든다(DR-27 b). 그래서 도중에 끝난 시도가 빈 파일을 남길 수 있고, 그 파일은 자동으로 지워지지 않는다. `doctor`의 `lock` 점검이 알린다(17.6).
    - `revert`, `apply`, `review`도 자기 id로 잡는다.
- `runId`는 `<UTC yyyymmddThhmmssZ>-<8자리 16진 난수>`다(P-3). 예: `20261112T031500Z-9f2c41ab`.
- 치환 대응표는 실행 중 메모리에만 둔다. 영구 금고와 재개는 없다. 되돌리기용 원문은 14절의 스냅샷으로 디스크에 남는다.

### 8.1 가림 개수 (U-25, DR-52, AXM-17)

- `EngineResult`의 선택 필드 `masking`(`{registeredValues, maskedPlaces}`)은 가림이 일했는지를 개수로만 말한다. 가릴 값, 그 값이 있던 곳, 길이는 담지 않는다.
  - `registeredValues`: 실행이 등록한 서로 다른 가릴 값의 수다. task의 `secretEnv` 값만이 아니라 키와 변수 파일 값도 세고, 같은 값은 하나로 센다(8.1.1의 "등록 개수에 드는 값").
  - `maskedPlaces`: 엔진이 모델에 보낸 글(시스템 글, 작업 메시지, 도구 결과, 재수정 메시지)에서 가린 곳의 수다. 글마다 처음 보낼 때 한 번 센다. 모델이 돌려준 글은 세지 않는다. 등록 값이 아닌 표지 글을 가린 곳도 센다(8.1.1).
  - 등록된 가릴 값이 없으면 필드가 없다. DR-52 전에 쓴 결과와 개수를 말하지 않는 가림(시험용 가짜)에도 없다. 등록했지만 가린 곳이 없으면 `maskedPlaces`가 0이어서, 필드가 없는 경우와 구별된다.
  - `run`의 stdout과 `result.json`이 같은 객체를 담는다. 필드를 더하기만 한다(DR-48).
- `report --json`의 `result`는 `result.json`의 `masking`을 기록된 대로 담는다. 두 개수만 다시 짓고, 그 필드의 다른 내용은 옮기지 않는다. 개수가 아니면(객체가 아님, 정수가 아님, `registeredValues`가 1보다 작음, `maskedPlaces`가 음수) 다른 손상된 필드처럼 `invalid_run_record`다. 보고서의 글 본문은 바뀌지 않는다.
- 사람용 끝 요약은 문구 `summary.masking`으로 두 개수를 보인다(출력 담당의 몫).
- SP-0: `run --json` 고정 값에 `"masking":{"registeredValues":1,"maskedPlaces":0}`이 더해졌다(PM 승인, 더하기만).
- 보안 검토 R-57을 거쳐 합쳤다(DR-52). 두 개수 말고는 값, 위치, 길이, 해시가 결과, 보고서, 끝 요약, 기록(journal), 앱 계층 어디로도 나가지 않는다. 모델은 이 개수를 보지 못한다. 검토가 남긴 낮음 셋(L-1~L-3)은 8.1.1에 적는다.

#### 8.1.1 개수가 알리는 것 (U-39, DR-54, 검토 R-57)

- **추측한 값이 맞는지 (L-1, DR-54).** `maskedPlaces`는 모델이 받은 글에 등록 값 전체, 또는 가림이 찾는 그 변형(Base64, 16진, 구분자로 나눈 것 등, DR-40, DR-42)과 같은 글이 있었는지를 알린다.
  - 그래서 모델이 읽을 파일에 글을 넣을 수 있고 실행의 출력(stdout JSON, 끝 요약, `report --json`)도 보는 사람은, 짧은 값(PIN, 짧은 암호, 작은 집합에서 고른 값)의 추측이 맞는지를 이 개수로 확인할 수 있다.
  - 한 파일에 추측을 여럿 넣으면 맞은 수만큼 는다. 추측을 반씩 나눠 가며 돌리면 N개 가운데 맞은 것을 약 log2(N)번의 실행으로 가려낼 수 있다.
  - 값의 일부만 맞으면(글자 하나가 빠지거나 다르거나 앞부분만 같으면) 개수는 바뀌지 않는다. 그러니 글자를 하나씩 맞혀 가는 길은 없고, 키처럼 긴 무작위 값에는 쓸 수 없다.
  - 같은 사실은 기록에도 이미 있다. 도구 결과에서 값이 있던 자리에 토큰이 남고, 그쪽은 위치까지 알린다. 새로 생긴 것은 이 사실이 기록을 보지 않아도 stdout과 끝 요약에 나온다는 점이다. 파일 해시로 하는 추측 확인(10절, P-7)과 같은 종류다.
  - 안내: 짧은 비밀을 가릴 값으로 쓰는 실행의 출력(stdout, stderr의 끝 요약, `report --json`)은 공개 CI 로그처럼 남이 보는 곳에 남기지 않는다.
- **표지 글도 가린 곳으로 센다 (L-2).** 모델이 받은 글에 토큰 표지 `CODARYN_SECRET`이 있으면(대소문자를 가리지 않고, 토큰 모양이 아닌 조각이어도), 가림은 그 조각을 보호 구간으로 보고 토큰으로 가린다(10절). 그 토큰도 `maskedPlaces`에 든다.
  - 그래서 `maskedPlaces`는 "등록 값이 그 수만큼 나왔다"는 뜻이 아니다. 예를 들어 Codaryn 자신의 소스나 문서처럼 표지 글이 든 파일을 모델이 읽으면, 등록 값이 어디에도 없어도 개수가 0보다 크다.
  - 개수를 줄여 진짜 가림을 숨기는 길은 없다. 가린 값은 늘 토큰이 되어 세어진다.
  - 모델은 표지 글을 써서 개수를 부풀리지 못한다. `write_file`에 토큰 모양을 넣으면 `invalid_token`으로 거부된다. 부풀리는 것은 작업 공간에 이미 있는 글이나 허용된 명령의 출력뿐이다.
- **등록 개수에 드는 값 (L-3).** `registeredValues`는 11절 "처리 순서" 7단계가 등록하는 값을 모두 센다.
  - task의 `secretEnv` 값(S-3)
  - 실행의 제공자 자신의 키(길이와 상관없이), 그리고 환경에 있는 다른 제공자 키 변수의 값 가운데 20자 이상인 것(S-2, DR-34 (b))
  - `--vars-file`이 새로 설정한 8자 이상의 값(S-4). 앞뒤 공백이 있는 값은 두 형태를 모두 등록하므로 둘로 셀 수 있다.
  - 같은 값은 하나로 센다. 줄 바꿈만 다른 값(CRLF와 LF)도 하나다.
  - 그래서 출력을 보는 사람은 실행 설정에 없는 다른 제공자의 키가 그 환경에 있는지, 그리고 설정한 두 값(예: `secretEnv` 하나와 키)이 같은지를 알 수 있다. 값과 길이는 알리지 않는다.

### 8.2 다시 시도해도 되는 실패인지 (U-55, AXM-9)

- 프로그램이 기록(journal)을 읽지 않고도, 같은 명령을 나중에 다시 해도 될지 가르게 한다. 필드를 더하기만 한다(DR-48).
- **오류 JSON(`CliErrorOutput`)**: CLI가 만드는 모든 오류에 `category`와 `retryable`이 붙는다(`cliErrorFacts`). 순서는 `message`(그리고 `diagnostic`) 뒤다.
  - `category`: `input`(준 것을 고쳐야 함), `state`(작업 공간이나 기록이 명령이 바라는 상태가 아님), `environment`(키·설정이 없음, 제공자, 모델 목록 실패, 설정 파일을 쓰지 못함), `internal`(Codaryn 자신의 실패). 코드마다 하나다(`CLI_ERROR_CATEGORY`).
  - `retryable`: 그대로 다시 해도 나중에 될 수 있으면 true. `workspace_locked`, `run_in_progress`만 true다(잠금이나 실행이 끝나면 됨). 나머지는 false다(`CLI_ERROR_RETRYABLE`). `cleanup_plan_changed`는 새 미리보기가 먼저라 false, `internal_error`는 무턱대고 되풀이하지 않게 false다.
  - `model_list_failed`의 `retryable`은 목록 요청의 실패로 정한다(`modelErrorRetryable`, 아래). 목록 함수가 던졌거나 판정할 수 없으면(HTTP 상태가 없는 `api_error`) `retryable`이 **없다**.
- **실행 결과(`EngineResult.modelError`)**: 모델 오류가 실행을 끝냈을 때만 `{kind, turn, retryable?}`이 있다(reason `model_error`). `run`의 stdout, `result.json`, `report --json`의 `result`에 같다.
  - `kind`: 모델 오류 종류(`MODEL_ERROR_KINDS`). `turn`: 실패한 요청의 모델 턴(1부터, journal의 `model_error.turn`과 같음).
  - `retryable`(`modelErrorRetryable`): true는 `rate_limited`, `overloaded`, `timeout`, HTTP 408·409·5xx의 `api_error`. false는 `auth_failed`, `quota_exhausted`, `not_configured`, `not_implemented`, `script_exhausted`, `malformed_response`, `aborted`, 그 밖의 HTTP 상태의 `api_error`.
  - 가림이 실패해 `model_error`로 끝난 실행은 모델 오류가 아니므로 `modelError`가 없다. U-55 전에 쓴 결과에도 없다.
  - 키, 요청 본문, 제공자의 응답은 들어가지 않는다. journal의 `model_error` 기록이 가린 메시지를 그대로 가진다.
  - `report --json`은 아는 꼴(`kind`가 모델 오류 종류, `turn`이 1 이상의 정수, `retryable`이 있으면 참·거짓)일 때만 옮긴다. 다른 꼴이면 다른 손상된 필드처럼 `invalid_run_record`다.
- **없으면 알 수 없음**: `retryable`이 없는 것은 "다시 하면 안 된다"가 아니라 "알 수 없다"는 뜻이다(HTTP 상태가 없는 `api_error`, 던진 목록 함수, U-55 전의 출력). 프로그램은 없음을 false로 읽지 않는다. `category`가 없는 오류도 U-55 전의 출력이다.
- true는 나중에 될 수 있다는 뜻이지 된다는 약속이 아니다. 제공자 어댑터는 이미 할 수 있는 만큼 다시 시도했다(`maxRetries`, `Retry-After`).
- 고정 값(SP-0)은 바뀌지 않았다.

## 9. 계약 변경 절차

변경이 필요하면 담당자가 사유와 원하는 형태를 PM에 요청한다 → PM이 승인한다 → 역할 1(기반 담당)만 `src/contracts/**`와 이 문서를 수정한다. 다른 담당자는 계약을 직접 고치거나 로컬 사본을 만들지 않는다.

## 10. 미정과 알려진 한계

미정: 없음(1a 결정은 P-1~P-7과 PM 결정으로 고정).

알려진 한계(1a):

- 가릴 값이 든 줄은 수정할 수 없다. 그 줄의 변경·이동·삭제는 `protected_span_violation`이다(P-6).
- 치환은 등록한 값과 목록의 변형(Base64, URL 인코딩, JSON 이스케이프, 16진)만 가린다. 목록 밖 변형과 UTF-8이 아닌 인코딩(UTF-16, CP949 등)으로 나온 출력은 가려지지 않는다.
- `CommandRule.allowExtraArgs`가 `true`이면 추가 인자 속 경로를 검사하지 않으므로, 명령 허용이 경로 허용을 대신할 수 있다. 가능하면 `false`를 쓴다.
- 이름이나 경로에 `CODARYN_SECRET`이 든 파일은 토큰으로 오인되어 접근할 수 없다. 내용에 이 리터럴이 든 파일도 `write_file`로 수정할 수 없다.
- 해시 비교와 파일 교체 사이에 다른 프로세스가 쓰면 그 변경을 덮어쓸 수 있다(경쟁 구간).
- Windows의 `.cmd`·`.bat`(G1, T-1): 이름은 자식이 받는 환경의 `PATH`와 `PATHEXT`로 찾는다(작업 디렉터리와 상대 `PATH` 항목은 찾지 않는다). 스크립트가 작업 공간 밖에 있고 스크립트 경로와 모든 인자가 좁은 문자 집합 안일 때만 `cmd.exe /d /s /c`로 실행한다. 그 밖에는 `spawn_failed`(`script_refused`)다. 실행 조립이 명령 실행기에 작업 공간 루트를 넘기므로 실제 CLI에서도 동작한다(T-1).
- 파일 해시가 모델과 기록에 노출되어 짧은 비밀이 든 파일은 추측 검증이 가능하다(P-7).

알려진 한계(1b 설정):

- 키 값 검사는 Anthropic 키 모양과 현재 `ANTHROPIC_API_KEY` 값만 찾는다. 다른 형식의 키나 잘린 키는 찾지 못한다.
- `--vars-file`로 읽은 값은 CLI 프로세스의 환경에 들어간다. 자식 프로세스에는 `CHILD_ENV_ALLOWLIST`만 전달되므로 키는 넘어가지 않는다. 허용 목록의 변수라도 값에 등록된 가릴 값이 들어 있으면 넘기지 않는다(T-1, `envValueFreeOfSecrets`).

실제 API 미검증(1b 제공자 연결 상태):

- 연결: `codaryn run`은 해석한 `ResolvedAnthropicSettings`로 `createAnthropicProvider`를 만들어 Messages API(`<apiBaseUrl>/v1/messages`)를 Node 내장 `fetch`로 호출한다.
- 검증한 것: 주입한 가짜 `fetch`를 쓴 유닛 테스트(제공자 단위, CLI 조립 단위)뿐이다. 요청 주소, 모델, `max_tokens`, 키가 `x-api-key` 헤더에만 있고 본문·stdout·기록에 없음, 가짜 가릴 값의 가림, 401 처리를 확인했다. 이것은 모의 검증이며 실제 API 검증이 아니다.
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
- 가림은 출력 끝의 여유 구간(4096바이트) 안에서 잘린 가릴 값의 변형까지 다룬다. 그보다 긴 변형이 경계에서 잘리면 일부가 가려지지 않을 수 있다.
- 보호 경로는 파일 도구의 쓰기만 막는다. 정책이 허용한 명령(`run_command`)과 명령형 검증기는 보호 경로의 파일도 바꿀 수 있다.
- 명령이 바꾼 파일은 `file_changed`와 스냅샷에 남지 않으므로 되돌리기 대상이 아니다.
- 실패 근거에 실행 시간이나 임시 경로처럼 매번 바뀌는 내용이 있으면 서명이 달라져 같은 실패로 판정되지 않는다. 그때는 `maxRepairAttempts`와 예산 한도만 반복을 멈춘다.
- 경로에 등록된 가릴 값이 든 파일은 기록에 토큰으로 남아 스냅샷과 맞출 수 없다. 되돌리기에서 `missing_snapshot`으로 건너뛴다.
- 같은 실행을 두 번 되돌리면 두 번째에는 이미 원래대로인 파일이 `already_reverted`로 건너뛰어지고, `partial`로 세지 않는다(N-22). 실행 뒤 다시 바뀐 파일만 `changed_since_run`이다.
- 실행 중 다른 프로세스가 같은 파일을 바꾸면 스냅샷(그 실행이 처음 쓰기 직전에 읽은 원문)과 실제 실행 전 상태가 다를 수 있다.

알려진 한계(교차 검토 수정 S-1~S-9):

- 파일 위치 확인과 파일 읽기 사이에 링크를 바꿔치기하면 막지 못한다(확인과 사용 사이의 경쟁).
- 작업 공간 밖의 하드 링크가 작업 공간 안 파일과 같은 내용을 가리키면 밖으로 판정된다. 파일 도구는 이름을 새 파일로 교체하므로 그 링크를 바꾸지 못하지만, 허용된 명령은 제자리에서 고칠 수 있다.
- 키 모양 검사는 Anthropic 키 형식(`sk-ant-`)과 현재 키(16자 이상)뿐이다. 다른 서비스 토큰과 키의 인코딩 변형은 잡지 않는다.
- env 파일이 새로 설정한 8자 이상 값은 모두 가릴 값으로 등록하므로 `postgres` 같은 흔한 값도 가려질 수 있다(S-4의 부작용).
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
| `OPENAI_API_KEY` | OpenAI API 키(19절). 이 환경 변수로만 받는다 |
| `CODARYN_OPENAI_MODEL`, `CODARYN_OPENAI_API_BASE_URL` | OpenAI의 모델 ID와 주소(19.3, DR-34 (a)) |

- `CODARYN_MODEL`, `CODARYN_API_BASE_URL`은 anthropic 전용이다(DR-34 (a)). 다른 제공자의 실행에는 쓰이지 않는다.

- 비어 있거나 공백뿐인 값은 설정되지 않은 것으로 본다.
- `--vars-file <경로>`를 줄 때만 그 파일을 `process.loadEnvFile`로 읽는다(C-2, T-15). `.env`를 자동으로 찾지 않는다. 이미 설정된 환경 변수가 파일 값보다 우선한다. 형식은 env 파일과 같다.
- BOM이 있는 변수 파일은 첫 변수를 조용히 놓치므로 `invalid_config`로 거부한다.
- 변수 파일이 새로 설정한 변수의 값은 가릴 값으로 등록된다(S-4). 그래서 파일 내용이나 명령 출력에 나타나면 가려진다. 다음은 등록하지 않는다.
  - 이미 설정돼 있던 변수. Windows에서는 대소문자를 무시해 비교한다.
  - `CODARYN_MODEL`, `CODARYN_CONFIG`, `CODARYN_API_BASE_URL`, `CODARYN_OPENAI_MODEL`, `CODARYN_OPENAI_API_BASE_URL`
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

해석한 값은 `ResolvedAnthropicSettings`로 제공자에 전달한다. 키는 메모리에만 둔다. 알려진 키 변수(`API_KEY_ENVS`)의 값(앞뒤 공백을 뗀 값)은 scripted 실행에서도 가릴 값으로 등록하므로, 파일 내용이나 명령 출력에 나타나면 가려진다(S-2, SP-2). 실행의 제공자 자신의 키는 길이와 상관없이, 그 밖의 키는 20자 이상일 때만 등록한다(DR-34 (b)). `EMPTY`, `ollama`, `x` 같은 자리표시자가 관계없는 실행을 깨뜨리지 않게 하기 위해서다. `CODARYN_API_BASE_URL`에도 설정 파일의 `apiBaseUrl`과 같은 엄격한 규칙을 적용한다(S-9).

### 한도 (S-7)

- **설정 파일의 한도는 상한이다.**
  - task 값이 설정 값보다 크면 `invalid_task`다.
  - 설정이 숫자인데 task가 `maxTotalTokens: null`이면 상한을 푸는 것이므로 `invalid_task`다.
  - 설정이 `null`이면 그 필드는 절대 상한만 적용한다.
  - 설정에 없는 필드는 task 값을 쓴다.
- **API 제공자(anthropic, openai)는 `maxTotalTokens: null`을 쓸 수 없다**(19.2). task가 준 `null`이면 `invalid_task`, 설정이 준 `null`이면 `invalid_config`다. scripted는 `null`을 허용한다.
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
6. **끊긴 키(DR-40 (a), 검토 R-25 M-1).**
   - 등록된 키 값(알려진 모든 키 변수의 값, 16자 이상)은 원문에서도, 키를 끊을 수 있는 문자를 뺀 글에서도 찾는다.
   - 뺄 문자(`KEY_SPLITTER_SOURCE`): 공백류(줄바꿈, 탭, no-break space), 제어 문자, 유니코드 서식 문자(`\p{Cf}`: 영폭 공백, word joiner, soft hyphen, BOM).
   - 그래서 그런 문자 하나로 끊긴 등록 키도 `key_in_file`이다.
   - 거부용 모양을 그 글에도 적용하는 것(등록되지 않은 끊긴 키)은 계약의 공용 함수와 선형 모양이 오면 연결한다.
   - 출력 가림(`hideKeys`)
     - 등록 값은 같은 문자를 뺀 글에서 찾는다.
     - 모양은 제어·서식 문자만 뺀 글에서 찾는다. 보이는 공백을 빼면 키가 앞 낱말에 붙어 모양의 단어 시작을 잃기 때문이다.
7. **크기 상한(DR-40 (b), 검토 R-25 L-2).**
   - task 파일과 설정 파일이 1 MiB(`MAX_INPUT_FILE_BYTES`, UTF-8 바이트)를 넘으면 어떤 검사도 읽기 전에 거부한다.
     - task는 `invalid_task`, 설정은 `invalid_config`다.
     - 글은 "the task file is larger than 1048576 bytes (1 MiB); nothing in it was used"처럼 고정이고 파일의 내용을 담지 않는다.
   - `run`·`plan`·`apply`·`review`, `doctor`, `models`가 같다. doctor는 읽을 수 없는 파일로 보인다.
   - 계약이 상수를 내면 그것으로 바꾼다.

### 처리 순서

1. 인자. 명령줄 경로가 로컬 경로인지 확인한다(S-5).
2. `--vars-file`. 읽기 → BOM 거부 → 적재 → 새로 설정된 값을 고른다(S-4). `--env-file`과 `--env-file-if-exists`는 1단계에서 거부한다(T-15, V-3).
3. 현재 키, `CODARYN_CONFIG` 경로 확인(S-5), `--goal` 키 검사(S-8).
4. 설정·task 파일. 읽기 → 원문 키 검사 → 파싱 → 파싱 뒤 키 검사와 깊이 상한(S-6).
5. 설정 검증(S-3, S-7, S-9) → task 검증(S-3, S-5, S-7) 또는 간편 형식 구성.
6. 작업 공간 확인 → 설치 위치와 겹치지 않는지(U-3) → 파일 위치 확인(S-1, 취소 파일 포함 T-12) → `integrity.paths`의 존재와 위치(U-1).
7. 가릴 값: `secretEnv`(S-3), 키(S-2), 변수 파일 값(S-4).
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
  - 옮긴 파일은 제자리로(`moved_back`), 폐기한 파일은 폐기 보관함에서(`restored_from_discard`) 되돌린다.
  - 원래 자리에 무언가 있으면 `original_path_taken`이다.
  - 시작 기록만 있는 동작(R-9 I-4, `plan_item_started`)도 같은 순서로 다룬다.
- 계획 실행이나 그 `plan.json`이 사라진 적용 실행의 되돌리기는 `plan_run_missing`(종료 2)이고 아무것도 바꾸지 않는다. 적용한 파일의 실경로는 그 계획에만 있기 때문이다(R-9c C-1, DR-24 f).
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

- `codaryn report [--workspace <디렉터리>] --run <runId> [--json]`은 `.codaryn/runs/<runId>/`의 `result.json`과 `journal.jsonl`만 읽어(가림본) 사람이 읽는 Markdown 요약을 stdout에 낸다. `--json`이면 `ReportOutput` 한 줄이다. 아무것도 바꾸지 않고 잠금도 잡지 않는다. `--workspace`가 없으면 현재 폴더를 쓴다(18.14, main `1e54ca9`의 실제 CLI로 확인).
- 상태(`REPORT_EXIT_CODES`): `complete`(0)는 둘 다 읽음, `incomplete`(3)는 `result.json`이 없음(실행 중이거나 쓰지 못하고 멈춤)이다. `incomplete`는 기록만으로 만들고, 줄바꿈 없는 마지막 줄은 아직 쓰는 중으로 보고 무시한다.
- 오류(`CliErrorOutput`): `invalid_arguments`, `workspace_not_found`, `run_not_found`(그 실행의 기록이 없음), `invalid_run_record`(읽기·해석 실패, `MAX_REPORT_FILE_BYTES`(256 MiB) 초과, 다른 실행의 파일).
- `ReportOutput`: `schemaVersion`, `kind:"report"`, `runId`, `status`, `exitCode`, `result`(`EngineResult` 또는 null), `journal`(`ReportJournalSummary`: 작업 id, 작업 종류, 제공자, 한도, 기록 수, 모델 요청 수, 거부된 도구 호출 수, 재수정 수, 마지막 검증 회차, 변경 목록, 무결성 확인, 종료 기록).
  - DR-47(U-21): `result`는 `result.json`의 `finalMessage`를 그대로 담는다(계획 실행에 있으면 `invalid_run_record`). 본문에는 그 답이 있으면 `## The agent's last message` 절이 `## Changes` 뒤에 붙는다: 머리말(`report.final_message`의 영어), 끝 요약과 같은 인용 줄(출력 담당의 `quoteModelText`, 최대 `FINAL_MESSAGE_MAX_LINES`줄)을 담은 코드 블록, 잘렸으면 잘린 줄.
- 한계: 보고서는 이 두 파일만큼만 믿을 수 있다. 상태 디렉터리는 파일 도구에만 닫혀 있으므로 실행 중 허용된 명령이 바꿀 수 있다.

### doctor (U-6)

- `codaryn doctor [--config <파일>] [--vars-file <파일>] [--task <task.json> | --workspace <디렉터리>] [--json]`은 네트워크 접속, 모델 요청, 쓰기 없이 점검한다. 기본 출력은 항목마다 한 줄의 글이고, `--json`이면 `DoctorOutput` 한 줄이다.
  - U-100(설계 공백 C-10, N-10): `api_key` 점검이 키 변수가 없다고 하면(`doctor.api_key.missing`) 그 줄 아래에 `init`이 쓰는 등록 안내 한 줄을 메시지 자리에 맞춰 들여 쓴다. Windows는 `init.key_hint_windows`, 그 밖은 `init.key_hint_posix`이고 `{keyEnv}`는 그 점검의 키 변수다. 어느 쪽도 명령에 값을 넣지 않는다. 사람용 글에만 있고 `--json`은 그대로다.
  - U-115(UXM-9): stdout이 터미널이면 끝 줄 다음에 '아직 안 한 설정과 다음에 할 일'이 온다("처음 시작 안내" 절). 터미널이 아니면 그대로다.
  - U-127: 표의 열은 글자 수가 아니라 터미널 칸으로 맞춘다(`src/cli/human`의 `displayWidth`, `padEnd`; 한글 같은 넓은 글자는 2칸). 상태 칸은 10칸, 이름 칸은 가장 넓은 이름의 칸 수, 그 뒤 두 칸에 글이 온다. 점검 아래 들여 쓴 줄(notes, 키 등록 줄)도 그 칸에서 시작한다. ASCII는 칸 수가 글자 수와 같아 영어 출력은 그대로다. `models`의 표도 같은 함수로 맞춘다.
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
- 출력 글의 제어 문자(ESC, CR, 양방향 제어 문자 등)는 `?`로 바꾸고, 인라인 코드와 코드 블록은 내용 속 백틱보다 긴 울타리를 쓴다. 키 모양 문자열과 현재 `ANTHROPIC_API_KEY` 값은 `[key]`로 가린다. 기록이 실행 중 명령으로 바뀌었을 경우를 위한 방어이며, 등록된 다른 가릴 값은 report가 알지 못한다.

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

### 터미널의 JSON 줄과 인자 없는 실행 (U-23, DR-49, UXM-17, UXM-9)

- 8절의 stdout 규칙(N-5)에 더한다. stdout과 stderr가 둘 다 터미널이면 그 뒤의 JSON 한 줄을 내지 않는다. 사람용 글(끝 요약, 설명한 오류)이 stderr로 화면에 나오기 때문이다(U-45, 검토 R-58 Q-1: 예전에는 stdout만 보았다).
  - 대상은 JSON을 내는 출력 모두다. `run`·`revert`·`apply`의 결과와 모든 명령의 `CliErrorOutput`이다.
  - 글 출력(도움말, 버전, `report` 등의 기본 글)은 그대로 낸다.
- 다음 경우에는 지금과 바이트까지 똑같이 낸다.
  - `--json`을 주었을 때. `run`·`revert`·`apply`도 `--json`을 받는다. 받기만 하고 다른 것은 바꾸지 않으며, 한 번만 줄 수 있다.
  - stdout이 터미널이 아닐 때(파이프, 파일).
  - stderr가 터미널이 아닐 때(U-45). 예: 화면에서 `codaryn run ... 2> log.txt`. 사람용 글이 화면에 없으므로 JSON 줄을 낸다.
  - `--quiet`일 때. 사람용 글이 없으므로 JSON 줄을 낸다.
- `--json`과 `--quiet`는 인자 어디에 있어도 센다. 인자를 해석하지 못한 경우도 같다(`--quiet`의 규칙과 같음).
- 터미널인지는 `process.stdout.isTTY`와 `process.stderr.isTTY`로 본다. 판정은 `src/cli/guard.ts`의 `stdoutText`가 하고, 시험은 그 상태를 주입한다.
- 종료 코드와 기록(`result.json`)은 바뀌지 않는다.
- 사용법 줄은 바꾸지 않았다. 사용법 줄이 `invalid_arguments` 메시지에 들어 있어서다. `--json`은 `run`·`revert`·`apply` 도움말의 옵션 목록에 적었다(U-35 전에는 `apply` 도움말의 문장).
- stdout은 터미널인데 stderr만 파일로 돌리면 JSON 한 줄을 stdout에 낸다(U-45, R58-L1). U-23 판에서는 이때 화면에 아무것도 나오지 않았다.
- 인자 없이 `codaryn`만 치는 경우(PM 답)
  - stdout이 터미널이면 `codaryn --help`와 같은 글을 stdout에 내고 종료 0이다(위 "도움말, 버전, 설치"와 같음). stderr에는 아무것도 내지 않는다.
  - 터미널이 아니면(파이프, 파일) 예전 그대로 `invalid_arguments`(종료 2)다. stdout의 글자도 같다. 기계가 받는 출력은 바꾸지 않는다(DR-48).
  - 판정은 `src/cli/help.ts`의 `helpRequest`가 터미널 여부를 받아서 하고, 시험은 그 값을 주입한다.
  - 도움말은 stdout에 내므로 stdout만 본다. stderr는 보지 않는다(U-45에서도 그대로).
- 문구 `help.output`은 문구 담당이 이 규칙에 맞춰 고쳤다(검토 R-58 I1). 그 첫 문장을 `run`·`revert`·`apply`와 오류로 좁히고 stderr 조건(U-45)을 더하는 것은 문구 담당의 몫이다.

### 다섯 명령의 도움말 (U-35, UXM-7)

- `plan`, `apply`, `review`, `changes`, `cleanup`도 `HELP_COMMANDS`에 든다. 그래서 다른 명령처럼 사용법 줄, 설명(`help.command.<명령>`), 옵션(`help.option.<옵션>`), 종료 코드(`help.exit.<명령>`)를 고른 언어로 보인다. 전에는 사용법 줄과 영어 한 문장이었다.
- 옵션은 사용법 줄의 순서로 적는다. `apply`의 `--run`은 계획 실행의 정확한 id만 받으므로 `plan_run`이고, `cleanup`의 `--run`은 `run_ids`다. 둘 다 `latest`를 받지 않는다. `apply`는 `--json`도 적는다(U-23).
- 도움말에는 결정 번호를 적지 않는다.
- 사용법 줄은 바꾸지 않았다(`invalid_arguments` 메시지에 들어 있다). `codaryn --help`의 사용법 목록도 순서와 글자가 같다.

### 처음 시작 안내 (U-115, UXM-9)

- 모두 **터미널일 때만** 더한다. 터미널이 아닐 때의 글과 모든 JSON 줄, 종료 코드는 바이트까지 그대로다(아래 config_missing만 예외, PM 결정). 터미널 여부는 그 글이 가는 곳의 `isTTY`다(도움말·`doctor`·`init`은 stdout, 오류 설명은 stderr). 렌더러마다 기본값이 거짓인 선택 인자(`terminal`)로 받으므로, 그 인자를 주지 않는 호출(시험, SP-0 고정, 앱 계층)은 전과 같다.
- 짧은 도움말: 터미널의 `codaryn`과 `codaryn --help`(`helpText(null, catalog, { terminal: true })`)는 `help.intro`, `help.first_steps`(제목: 실행은 현재 폴더에서 일한다)와 두 칸 들여 쓴 `help.first_steps_commands`(처음 순서: init -> doctor -> run -> report), `first_use.try_without_key`(docs/usage.md 3절의 키 없는 체험), `help.commands_heading`과 명령마다 `help.summary.<명령>` 한 줄(첫 사용 순서: init, doctor, models, run, runs, report, changes, revert, plan, apply, review, cleanup), `help.more`(`codaryn help <명령>`), `help.version`, `help.key`, `help.output`, `help.contract`다. 이 단위가 더한 줄은 모두 100칸 안이다(U-132, R-91 L-2; `help.intro`·`help.key`·`help.output`·`help.contract`는 전체 도움말에서 그대로 옮긴 줄). 명령마다의 도움말(`codaryn help <명령>`)과 터미널이 아닐 때의 `--help`는 전과 같다(사용법 줄 전체).
- `doctor`: 터미널이면 끝 줄 다음에 '아직 안 한 설정과 다음에 할 일'(`doctor.next.heading`)을 번호로 낸다. 점검의 text id로 정해진 순서로 뽑는다.
  1. 설정 파일이 없고(`doctor.config_file.default_missing`) 한도나 모델 점검이 실패하면 `doctor.next.init`. 기본 위치가 아예 없으면(`.none`, 서비스 계정·컨테이너 등) `init`도 거기서는 실패하므로 `doctor.next.init_with_config`(`codaryn init --config <파일>` 뒤 실행마다 `--config`)다(U-132, R-91 L-1). 그 한도 실패는 다시 세지 않는다. task 파일로 점검하면(자기 설정을 가짐) 설정 파일이 없어도 단계가 아니다. 설정 파일이 실패하면 `doctor.next.config_fix`.
  2. 키가 없으면(`doctor.api_key.missing`) `doctor.next.key`, 보낼 수 없는 글자가 있으면(`doctor.api_key.unusable`) `doctor.next.key_unusable`(`{keyEnv}`).
  3. 모델이 없거나 자리표시자면 `doctor.next.model`, 키가 없으면 `doctor.next.model_after_key`, 키 값을 보낼 수 없으면 `doctor.next.model_after_key_fix`(키 값을 고친 뒤, U-132, R-91 L-4).
  4. 위에 들지 않은 실패 수 `doctor.next.other`, 경고 수 `doctor.next.warnings`, 끝에 `doctor.next.again`. 키가 없으면 그 뒤에 `first_use.try_without_key`.
  - 할 일이 없으면 제목 없이 다음 명령 한 줄: `--task`면 `doctor.next.ready_task`, `--workspace`면 그 폴더로 도는 간편 형식 `doctor.next.ready_workspace`(`codaryn run --workspace <dir> --goal "<task>"`), 그 밖에는 `doctor.next.ready`(작업할 폴더에서 한 줄 실행; 한 줄 실행은 현재 폴더가 작업 공간이다, U-132, R-91 L-3). 경고가 있으면 그 앞에 `doctor.next.warnings`.
  - 이 줄들은 번호를 붙여도 100칸 안이다(두 언어, 두 키 변수, U-132, R-91 L-2).
  - 점검 줄, 끝 줄, `doctor --json`은 그대로다.
- `init`: 터미널이고 키가 없으면 `init.next` 뒤에 `first_use.try_without_key`.
- `run`의 오류: stderr가 터미널이고 `provider_not_configured`이면 오류 설명 끝에 `first_use.try_without_key`.
- 설정 파일이 아예 없을 때(`--config`도 `CODARYN_CONFIG`도 없고 기본 위치에 파일이 없음) 간편 형식·한 줄 실행의 설정 오류(`invalid_config`)는 힌트 `config_missing`(U-37 방식, `CLI_ERROR_HINTS`)을 단다. 사람용 줄은 `error.hint.config_missing`(설정 파일이 아직 없다, `codaryn init`으로 만든다)이다. 이것만은 터미널 여부와 상관없다. 오류 JSON에 `hint` 값이 하나 더 생길 뿐 `message`·`diagnostic`·`code`·종료 코드는 그대로다. `--config`로 준 파일이나 기본 위치의 파일이 있으면, 기본 위치가 아예 없으면 힌트가 없다.
- 시험: `tests/unit/cli/g-u115-first-use.test.ts`(렌더러와 실행, 터미널이 아니면 그대로), `tests/unit/cli/g-u115-terminal.test.ts`(실제 CLI, `u115-terminal-preload`로 흐름을 터미널로 보임), `tests/unit/cli/g-u132-first-use-r91.test.ts`(R-91의 넷).

### init이 제공자를 묻는다 (U-26, UXM-11, DR-46)

- 터미널에서(질문을 할 때만) 위치를 확인한 바로 뒤에 제공자를 묻는다. 목록은 `API_PROVIDER_NAMES` 순서로 `  1  anthropic`, `  2  openai`이고, 질문은 `init.provider_pick`(`{provider}`는 기본값 `INIT_DEFAULT_PROVIDER`)이다.
  - 답: 번호나 이름(대소문자 무시). Enter, 목록에 없는 답, 입력 끝이면 기본값(anthropic)이다. 고른 결과를 `init.provider_chosen`으로 알린다.
- 고른 제공자로 나머지를 한다.
  - 키: 그 제공자의 키 변수(`API_PROVIDERS[provider].keyEnv`)가 있는지(`keySet`), 끝 글의 키 줄도 그 변수다.
  - 모델 목록: 그 제공자의 키가 있고 목록 함수가 있을 때만 그 제공자의 목록 함수(`API_MODEL_LISTERS`)로 묻는다(실제 API 요청). 없으면 지금처럼 `init.model_no_key`다.
  - 파일: anthropic이면 지금과 바이트까지 같다(최상위 `model`, `maxOutputTokens`). openai면 `schemaVersion` 다음에 `"provider": "openai"`, 그리고 `providers.openai.{model, maxOutputTokens}`이다. 나머지(`limits`, `policy`, `language`)는 같다. `codaryn models --use`는 설정의 `provider`를 따르므로 그대로 쓴다.
  - `InitOutput.provider`: 물었을 때만 있다(고른 것).
- 터미널이 아니거나 `--json`이면 묻지 않는다. 출력과 파일은 U-26 전과 글자까지 같다(`provider`가 없고 anthropic 꼴). 앱 계층의 `createSettings`(`init --json`)도 그대로다.
- `run --provider`는 두지 않는다(DR-46). `models --provider openai --use`가 설정의 `provider`도 바꿀지 안내하는 것은 이 단위에 없다.

### 진행 표시 (U-8)

- `run`은 실행이 시작된 뒤 기록마다 stderr에 `codaryn: `로 시작하는 한 줄을 쓴다. 실행 시작, 턴 번호, 도구 허용·거부(권한/코드), 만들거나 바꾼 파일, 검증기 결과, 재수정 회차, 보호 대상 확인, 종료 상태가 대상이다. 모델 응답과 도구 결과는 쓰지 않는다.
- 줄은 기록(가림본)에서만 만들고, 실행의 개인정보 게이트로 다시 가린 뒤 제어 문자를 바꾼다. 내장 도구가 아닌 도구 이름은 `(unknown tool)`, 형식에 맞지 않는 id는 `?`로 쓴다.
- DR-43 (b), R-31 L-1: 기록 하나가 여러 줄을 낼 수 있다(`withProgress`는 렌더러가 준 줄마다 따로 가리고 쓴다).
  - 실행 시작(`run_started`)에 `policyNarrowings`가 있으면 시작 줄 아래에 하나씩 쓴다(종류와 수만, `progress.workflow_policy.*`).
  - 영어 줄(`progressLines`, 렌더러가 없을 때)은 카탈로그의 영어 글과 같다. 사람용 렌더러(`HumanOutput.progressLine`, N-C)의 줄은 그쪽 변경을 기다린다.
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
  - U-156(nb-i18n의 E 묶음): 표의 열 머리, 목록·현재 모델·기록·덮어씀 줄, `--use` 질문은 고른 언어의 카탈로그 글(`models.*`)이다. 모델 id와 이름 같은 바깥 값과 `: `, `* `는 그리는 쪽이 붙인다. `  #` 열 머리는 낱말이 아니라 그대로다. 영어는 U-156 전과 글자까지 같다(SP-0 고정). 열은 터미널 칸(U-127)으로 맞추므로 한국어 머리도 줄이 맞는다. JSON은 그대로다.
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
codaryn report [--workspace <디렉터리>] --run <runId|latest> [--json]
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
  - U-22(DR-48, AXM-8, PM 결정): `latest`는 가장 새 실행이다. 결과가 아직 없는 `checked` 실행이 고를 끝난 실행보다 새것이고(또는 끝난 실행이 없고) 살아 있는 프로세스로 작업공간 잠금을 쥐고 있으면, 앞의 끝난 실행을 고르지 않고 `run_not_found`도 아닌 `run_in_progress`(종료 6, 끝난 뒤 다시 시도하거나 실행 id를 준다)다. 아무것도 바꾸지 않는다. 결과 없이 멈춘(잠금이 살아 있지 않은) 더 새 실행은 지금처럼 건너뛴다. 실행 id를 직접 주면 그 실행을 그대로 보인다. 이 규칙은 `latest`를 받는 모든 명령과 앱 계층에 하나다(R-51 M-2): 공용 함수 `resolveRunReference`(`src/cli/run-ref.ts`), 다른 함수가 없는 호출자는 store의 함수를 담은 `STORE_RUN_REFERENCE_DEPS`와 함께 쓴다. `report`, `revert`, `plan`, `review`, `changes`가 쓰고, `apply`는 실행 id만 받는다. `changes`와 앱 계층의 `resolveRun`은 앱 계층의 `runIdOf`(`src/app/runs.ts`)를 거쳐 이 함수를 쓰고, 실행 목록의 `resolveRunRef`(`src/cli/runs.ts`)도 이 함수를 쓴다(코드로 확인). 확인(main `1e54ca9`의 실제 CLI): 가장 새 실행이 도는 동안 `report`, `changes`(`--task`와 `--workspace` 생략), `revert --dry-run`, `plan`, `review`의 `--run latest`가 모두 `run_in_progress`(종료 6)였고, 앞선 실행의 id를 준 `changes`는 종료 0이었다.
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
  - doctor는 store의 `inspectLock`으로 판정한다. 실행과 같은 규칙이다: Linux의 부팅 뒤 틱(`processStartTicks`, `bootId`, N-27 d), 시작 시각, pid 순서.
  - reclaim 파일(DR-27 b)
    - `.codaryn/lock.json.reclaim`이 store가 지우지 않는 상태면 `reclaim_left`(`warn`)다.
      - 쓰는 중으로 보이는 글(끝 줄바꿈이 없고 온전한 JSON이 아님)
      - 읽을 수 없음
      - 주인이 살아 있음
    - 그동안은 끝난 잠금도 회수되지 않는다. 안내는 Codaryn이 돌지 않으면 그 파일(그리고 `lock.json`)을 지우라고 한다.
    - 주인이 끝난 reclaim 파일과, 온전하지만 이해할 수 없는 reclaim 파일은 다음 실행이 지우므로 `lock.json`의 판정을 따른다(store 규칙).
    - `lock.remove_hint` 문구도 reclaim 파일을 가리킨다(N-B 문구).
- **doctor `commands` 점검(G-F, Q5)**: `allowExtraArgs: true` 명령 규칙과 `policy.planActions`가 함께 있으면 `warn`이다. 다른 문제가 있으면 그 글을 두고 경고를 메시지에 붙인다. 문구는 `doctor.commands.extra_args_with_plan`이다.

### 17.7 오류 코드 추가

- `config_exists`(종료 2): `init`의 대상 위치에 파일이 이미 있다. 아무것도 쓰지 않았다.
- `config_write_failed`(종료 2)는 `init`에서도 쓴다.

## 18. 범용 작업 명령 (G-F: 작업 종류, plan, apply, review, changes)

계약 원문은 `src/contracts/workflow.ts`, `plan.ts`, `changes.ts`, `engine.ts`이고, 설계는 `docs/design/general-tasks.md`, 결정은 `docs/work-orders/phase-4-5-design.md`(DR-1~DR-25)다. 이 절은 CLI가 그 계약을 어떻게 받는지 적는다.

### 18.1 작업 종류 해석 (DR-2, DR-3)

- 실행이 쓰는 작업 종류는 다음 순서로 처음 있는 것이다.
  1. task 파일의 `workflowRef`
  2. 간편 형식의 `--workflow <id>`
  3. 프로필의 `workflowRef`
- 셋 다 없으면 단계 1~3의 실행과 같다(작업 종류 설정 없음).
- 간편 형식에서는 `--workflow`의 id가 이름표(`workflow`)도 된다.
- 내장 작업 종류 다섯 개는 `src/workflows`에 있다. 설정 파일의 `workflows`는 새 id만 정의할 수 있고, 내장 id를 다시 정의하면 거부된다.

  | id | 도구 | 계획 | 완료 |
  | --- | --- | --- | --- |
  | `general` | 전체 | 없음 | 검증기 |
  | `code` | 전체 | 없음 | 검증기 |
  | `document` | 읽기·찾기·쓰기 | 없음 | 검증기 |
  | `analyze` | 읽기·찾기·쓰기 | 없음 | 사람 검토(확인 목록 2개) |
  | `organize` | 읽기·찾기·`inspect_files`·`propose_plan` | `apply`, 명령 금지 | 계획 승인 |

- 해석 규칙(`resolveWorkflow`)
  - 도구는 작업 종류가 허용한 것 안에서만 좁힐 수 있다.
  - `plan: "apply"`는 약하게 바꿀 수 없다.
  - U-177(검토 R-99 M-2): 계약의 `PLAN_MODES`에는 `run`이 있지만(U-170, DR-69) 그것을 실행하는 것이 아직 없다(묶음 B의 B-3, B-4). 그래서 CLI의 파서(`parsePlanMode`)는 B-4 전까지 `plan: "run"`을 모델 요청 전에 거부한다.
    - task 파일의 것은 `invalid_task`, 설정 파일 작업 종류 정의의 것은 `invalid_config`이고, 힌트는 `plan_run_not_available`(사람용 줄 `error.hint.plan_run_not_available`)이다. 실행도 기록도 만들지 않는다.
    - 그 밖의 틀린 값은 지금처럼 `plan must be one of none, apply`다(받지 않는 `run`을 권하지 않는다).
    - 앱 계층도 같은 파서를 쓴다. 다만 설정 화면(`src/app/settings.ts`)의 오류에는 힌트를 붙이지 않는다(`message`가 같은 것을 말한다).
  - `allowCommands: false`인 작업 종류에서는 `policy.commands`를 쓸 수 없다.
    - 이 금지는 모델이 부를 수 있는 명령(정책의 명령 규칙)에 대한 것이다(GT-D10). 사람이 task나 설정에 둔 `command` 검증기는 막지 않는다(설계 4.3). 그 검증기는 적용 뒤, 인벤토리 점검 다음에 실행되므로, 거기서 바꾼 파일은 인벤토리가 보지 않는다(검토 R-11 L-3, PM 판단 P-3 대기).
  - 사람 검토 작업 종류에는 확인 목록이 있어야 한다.
- 정의의 `limits`는 기본값이다(검토 R-11 L-1).
  - task 파일이 비운 칸을 채우고, 설정 파일의 값보다 크면 그 값까지만 쓴다.
  - 상한은 설정 파일만 정한다(S-7). 정의 값이 상한이 되지는 않는다.
  - 간편 형식에서는 설정 파일의 한도가 그 실행의 한도이고, 정의 값은 설정에 없는 칸만 채운다.
- 간편 형식의 `plan`·`apply`·`review`도 실행 설정(한도 포함)을 설정 파일에서 읽는다. 빠지면 `invalid_config`이고, 계획 실행의 task를 `--task`로 주라고 안내한다(검토 R-11 L-2).
- task 필드 `tools`, `completion`, `humanReview`, `policy.planActions`는 해석된 작업 종류의 상한 안에서만 받는다. 상한을 넘으면 `invalid_task`이고, 진단은 필드 위치를 가리킨다.
- 검증기 종류 `data_checks`(표 참조, 행 수, 값 규칙)를 task와 설정에서 받는다(`src/contracts/verify.ts`).
- `prepareTask`(1~7단계: 설정, 변수 파일, 프로필, 키 거부, 위치 규칙, 작업 종류, 가릴 값 등록)는 `run`, `plan`, `apply`, `review`, `changes`가 함께 쓴다(DR-17).

#### 18.1.1 정책 합치기 (DR-41)

- 작업 종류 정의가 적용되면(간편 형식의 `--workflow`나 프로필의 `workflowRef`, task 파일의 `workflowRef`) 주어진 정책을 정의의 정책과 합친다(`mergeWorkflowPolicy`). 정의의 규칙은 그 작업 종류의 안전 규칙이라, 어떤 정책도 그것을 풀지 못한다.
  - 주어진 정책: 간편 형식은 프로필의 정책, 없으면 설정의 정책. task 파일은 그 자신의 정책.
  - 보호 경로는 합집합이다. 명령은 양쪽이 모두 허용한 명령 줄만 남는다. 계획 동작은 주어진 정책이 말하면 양쪽이 모두 가진 것만 남고, 말하지 않으면 정의의 것 그대로다. `restorePathTokens`는 둘 다 허용할 때만 참이다.
  - 정의가 명령을 허용하지 않을 때(`organize`): task 파일 자신의 명령 규칙은 먼저 `invalid_task`로 거부한다(GT-D10, 합치기 전에 센다). 프로필·설정의 규칙은 빠진다.
  - 정의가 없는 task 파일은 자기 정책을 그대로 쓴다.
- 검증기도 같다(DR-43 (a), R-31 L-2). 주어진 검증기는 정의의 검증기를 대체하지 않고 더해진다(`mergeWorkflowVerifiers`).
  - 정의의 검증기가 먼저이고, 그다음 id가 정의의 것과 겹치지 않는 주어진 검증기다. 주어진 목록이 비어도 정의의 검사는 남는다.
  - 정의의 id를 쓰면서 검사가 다른 주어진 검증기는 빠지고 알린다(`verifiers_dropped`). 같은 검사(키 순서만 다른 것 포함)는 세지 않는다.
  - 정의가 없는 task 파일은 자기 검증기를 그대로 쓴다.
- 합치기에서 빠진 것(`workflowPolicyNarrowings`, `workflowVerifierNarrowings`: 종류와 수만)은 실행할 task의 `policyNarrowings`에 싣는다. 엔진이 `run_started`에 기록한다.
- doctor의 `commands` 점검은 합친 정책을 보고, 빠진 것을 notes(`doctor.workflow_policy.*`)로 적는다.

### 18.2 task 형식 (DR-17)

`plan`, `apply`, `review`는 `run`과 같은 형식을 받는다. `changes`도 같지만 `--workflow`는 받지 않는다(앱 계층의 `TaskForm`과 같은 인자 해석, `src/cli/changes.ts`).

```
(--task <task.json> | --workspace <dir> [--profile <name>] [--workflow <id>]) [--config <config.json>] [--vars-file <path>]
```

그 설정이 가리는 값은 지금 실행을 시작했다면 등록될 가릴 값이다. 그 값으로 계획·기록을 다시 가려서 보여 준다(DR-5). 이 명령들은 모델을 부르지 않는다.

### 18.3 `codaryn plan`

```
codaryn plan <task 형식> --run <runId|latest> [--json]
```

- 대상: `needs-input`/`plan_pending`으로 끝난 실행의 `plan.json`. 다른 실행이면 `run_not_plan`이다.
- 출력
  - `PlanOutput`: 동작 목록(지금 가릴 값으로 가린 경로), 다이제스트, 적용 여부(`appliedBy`)
  - U-14(UXM-6, AXM-2, AXM-15): 계획 실행에 기록 변경 표시가 있으면(읽을 수 없는 표시도) 그래도 보이되(종료 0) `recordsChanged: true`를 넣고, 글은 경고 줄(`plan.records_changed`)로 시작하며 적용 명령 대신 적용할 수 없다는 줄(`plan.cannot_apply`: 새 `codaryn run`으로 계획을 다시 만든다)을 적는다. 모델이 쓴 요약(`summary`)은 계획 실행 journal의 `propose_plan` 호출(결과가 이 다이제스트를 가리키는 것)에서 읽어 넣고, 글에서는 `plan.summary_label` 뒤에 에이전트의 설명으로 보인다(승인 대상이 아님). 찾지 못하거나 읽지 못하면, 그리고 표시가 있으면 뺀다. 글의 마지막 줄은 다이제스트가 보장하는 것(`plan.digest_guarantee`)이다. `apply`의 터미널 질문도 같은 글을 쓴다. 네 문구 id는 카탈로그에 있어 한국어로도 나온다(main `1e54ca9`의 실제 CLI, `CODARYN_LANG=ko`). 계획의 머리 줄, 다이제스트 줄, 동작 줄, 적용 명령 줄은 아직 영어다(DR-57의 U-36).
  - R-49 R49-M1: 요약은 읽는 자리에서 지금의 가릴 값, 현재 키와 키 모양, 제어 문자를 차례로 거친다. 그래서 글과 `--json`, 앱 계층, `apply`의 질문이 같은 글을 싣는다. 동작의 경로는 기계가 쓰는 자료라 키 모양 가림을 걸지 않는다(PM 답, DR-48이 깨는 변경을 두 곳으로 한정함).
  - 인벤토리 상한 도달 여부
  - 글 출력의 마지막 줄은 적용 명령(`--digest`에 다이제스트 앞 12자)이다.
- 기록의 사본은 보여 주지 않는다. `plan.json`을 다시 가린다(DR-5).
- 같은 가릴 값인지 확인(DR-28, 검토 R-11 M-1)
  - `plan.json`의 각 동작은 계획 실행이 가린 표기의 보이는 조각(`shown`)을 함께 담는다. 가릴 값이나 그 해시는 담지 않는다.
  - `plan`과 `apply`는 지금 형식이 등록한 가릴 값으로 다시 가린 결과를 `planActionShownMatches`로 그 조각과 비교한다.
  - 하나라도 다르거나 `shown`이 없는 계획(DR-28 전)이면, 계획을 읽은 직후 `plan_secrets_differ`(종료 2)로 끝난다. 아무것도 보이거나 묻거나 기록하거나 옮기지 않고, 적용 실행도 만들지 않는다.
  - 계획 실행과 같은 task 형식(`--task`)으로 다시 하거나 계획을 새로 만든다. 엔진의 같은 검사는 두 번째 방어로 남는다.

### 18.4 `codaryn apply`

```
codaryn apply <task 형식> --run <runId> --digest <앞 12자 이상의 16진수> [--allow-unsafe-move] [--cancel-file <path>] [--quiet]
```

- `--run latest`는 받지 않는다. 승인이 계획 하나를 가리켜야 하기 때문이다.
- 거부 조건(모두 종료 2, 아무것도 옮기지 않는다)
  - task가 `plan: "apply"` 작업 종류로 해석되지 않으면 `run_not_plan`
  - 이미 적용된 계획이면 `plan_already_applied`
- 승인
  - `--digest`가 저장된 다이제스트의 앞부분이어야 한다(`MIN_PLAN_DIGEST_PREFIX` = 12자 이상).
  - stdin과 stderr가 터미널이고 `--digest`가 없으면 계획을 보이고 `[y/N]`을 묻는다. 기본은 아니오다.
    - 이때만 계획 보기의 인벤토리 상한 줄을 위해 작업 공간 목록을 한 번 만든다. 그 목록은 적용의 취소 신호를 받고, 취소되면 아무것도 옮기지 않고 `plan_not_approved`로 끝난다. `--digest`나 앱 계층의 적용은 엔진의 목록(동작 앞뒤 두 번)만 만든다(검토 R-18 L1).
  - 어느 쪽도 아니면 `plan_not_approved`(종료 2)다.
- 적용
  - 잠금을 잡고 적용 실행을 새로 만든다. 첫 기록은 `apply_started`다.
  - 지금 task의 정책·검증기·가릴 값으로 적용한다(DR-5).
  - 폐기한 파일은 `.codaryn/discarded/<적용 runId>/`에 동작 번호 이름으로 남는다(DR-9).
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
  - 나머지는 지금 가릴 값으로 가려서 저장한다.

### 18.6 `codaryn changes` (DR-7, DR-14, DR-29)

```
codaryn changes [--task <task.json> | --workspace <dir> [--profile <name>]] [--config <config.json>] [--vars-file <path>] --run <runId|latest> [--json]
```

- 인자: `--workflow`는 받지 않는다(앱 계층 `TaskForm`과 같다, 18.2). `--task`와 `--workspace`가 모두 없으면 현재 폴더를 쓴다(18.14, main `1e54ca9`의 실제 CLI로 확인). CLI의 사용법 줄(`codaryn help changes`)은 아직 `(--task <task.json> | --workspace <dir> [--profile <name>])` 꼴이다.
- 실행이 바꾼 파일마다 아래를 보인다.
  - 경로: 실행의 기록에 남은 가린 경로를 지금 가릴 값으로 한 번 더 가린 것(`masking: "current_secrets"`)
  - 실행이 만든 파일인지
  - 상태: `as_run_left`, `changed_since_run`, `missing`, `unknown`
- DR-29(검토 R-11과 같은 구조)
  - 파일 글(실행 전후 내용과 바뀐 구역)은 실행이 그 글을 어떻게 가렸는지 기록했을 때만 보인다. 지금은 실행이 그것을 기록하지 않으므로 글을 내지 않는다.
  - `--json`에서는 `before`·`after`가 `null`이고 `unavailable: "masking_unverified"`다.
  - 글 출력은 그 이유를 한 번 말하고, 파일마다 경로와 상태만 보인다.
  - 다른 이유(`masked_path`: 경로에 가림 토큰이 있음, `snapshot_missing`, `not_text`, `too_large` 등)는 파일마다 보인다.
  - 실행이 글의 가림을 기록하게 되면(계약·store) 바뀐 구역(`-`/`+` 줄)을 다시 보인다.
- 실행 id는 18.7의 규칙을 따른다(앱 계층이 store의 `inspectRun`으로 판정). 그 이름 그대로인 실행 디렉터리가 없으면 `run_not_found`, 실행 목록이 손상으로 보는 실행은 `invalid_run_record`(종료 2)이고, 경로도 내지 않는다.
- 읽기만 한다. 잠금도, 요청도 하지 않는다.
- `--json`은 `ChangesOutput` ASCII 한 줄이다(N-19). 키 모양은 JSON으로 만들기 전에 문자열마다 가린다(N-27 (c)).

### 18.7 기록을 읽는 명령의 공통 규칙

- 실행 id(N-27 (a))
  - 명시한 `--run <id>`는 store의 `inspectRun` 판정을 따른다. 그 이름 그대로인 항목이 없으면 `run_not_found`다. 대소문자만 다른 id도 여기에 걸린다.
  - 목록이 "손상"으로 보는 실행은 `revert`(N-26), `report`(N-27 (b)), `plan`, `apply`, `review`, `changes`(검토 R-14 L-1, 앱 계층 `0363b69`)가 모두 `invalid_run_record`로 거부한다.
- 상태별 이유 표(DR-16)
  - 실행과 적용 실행의 이유는 `RUN_REASONS_BY_STATUS`(`isReasonOfStatus`) 하나로 판정한다. CLI는 따로 목록을 두지 않는다.
  - 적용 실행의 이유는 그 부분집합인 `APPLY_REASONS_BY_STATUS`를 쓴다.
- `report`
  - 계획 실행은 동작 수, 다이제스트, `plan` 명령을 보여 준다.
  - 검토 대기 실행은 확인 목록과 사람의 판정을 보여 준다.
    - `--json`에서는 `verdict`(`review.json`의 `ReviewRecord`)다. 판정 전이나 기록을 읽을 수 없으면 `null`이다.
    - 검토 대기가 아닌 실행에는 이 필드가 없다.
  - 검증기 종류는 계약의 `VERIFIER_KINDS`(`data_checks`, `inventory` 포함)를 따른다. 제공자와 검증 결과 목록은 계약 형과 컴파일 때 대조한다(통합 사례 n07).
  - 적용 실행(첫 기록 `apply_started`, DR-12)은 적용 실행 보고서다.
    - `--json`: `ApplyReportOutput`(`kind: "report"`, `runKind: "apply"`, `result`는 `ApplyResult` 또는 null, `journal`은 `ApplyReportJournalSummary`)
    - `ApplyReportJournalSummary`의 필드
      - 계획 실행, 다이제스트, 승인 경로, 동의 경로, 동작 수
      - 사전 점검(문제 수, 인벤토리 상한, 위험한 이동 수)
      - 시작한 동작 수, 옮긴·폐기한·실패한 동작
      - 검증 결과(인벤토리 먼저), 무결성 점검, 끝 기록
    - `result.json`이 기록과 다른 계획·task·다이제스트를 가리키면 `invalid_run_record`다.
    - Markdown은 동작마다 무엇을 했는지와 되돌리는 명령을 보여 준다.
  - 형은 계약의 것이다: `RunReportOutput`(`verdict`), `ApplyReportOutput`(`runKind: "apply"`), `ApplyReportJournalSummary`, 둘을 합친 `AnyReportOutput`(`src/contracts/commands.ts`).
  - `--json`은 문자열마다 키를 가린 뒤에 만든다(N-27 (c)).
- 기록의 도구 이름과 호출 id(AC-D15)
  - 목록 밖의 도구 이름은 `unknown_tool`로 기록한다.
  - 호출 id는 `[A-Za-z0-9_-]{1,64}`이고 비밀이 없어야 한다. 아니면 `codaryn-call-<n>`으로 기록한다.

### 18.8 오류 코드 추가 (G-A)

- 모두 종료 2이고, 아무것도 바꾸지 않는다.
- `run_not_plan`, `plan_not_approved`, `plan_already_applied`, `run_not_awaiting_review`
- `plan_secrets_differ`(DR-28, 18.3): 지금 가릴 값이 계획 실행과 다르게 가린다. 계획을 읽은 직후에 확인한다.
- `plan_run_missing`(R-9c C-1): 계획 실행이 `plan_pending`으로 끝났는데 `plan.json`이 없다(`plan`, `apply`). 적용 실행의 되돌리기에서는 그 계획 실행이나 계획이 사라졌다(14절).
- 뜻은 `src/contracts/engine.ts`의 `CLI_ERROR_EXIT_CODES` 주석과 위 절을 따른다.

### 18.9 아직 없는 것

- 간편 형식 `plan`·`apply`·`review`의 설정 안내(R-11 L-2)는 JSON `message`에만 있다. 사람용 stderr에는 일반 고치는 법만 나온다(검토 R-12 L-2). 안내 문구 id(계약 담당)와 두 언어 글(N-B)이 생기면 stderr에도 붙인다. 재현은 `tests/unit/cli/g-r12.test.ts`에 `todo`로 있다.
- 영어 고정 글
  - `plan`·`review`의 글 출력과 질문 세 개(`Apply this plan?`, 적용과 되돌리기의 위험한 이동 동의)는 아직 영어 고정 글이다. 문구 id가 생기면 카탈로그로 옮긴다.

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

## 19. 제공자 선택과 설정 해석 (SP-4, DR-31)

계약: `CodarynConfig.provider`·`providers`, `ConfigProfile.provider`, `ProviderSettings`, `API_PROVIDERS`(`src/contracts/config.ts`). 11절의 anthropic 규칙은 그대로이고, 아래는 다른 API 제공자를 고를 때 더해지는 규칙이다.

### 19.1 설정 파일

```jsonc
{
  "schemaVersion": 1,
  "provider": "openai",                       // 간편 형식의 제공자. 없으면 anthropic
  "model": "…", "maxOutputTokens": 4096,      // 최상위 제공자 설정은 anthropic 몫(예전 그대로)
  "providers": {
    "openai": { "model": "…", "maxOutputTokens": 4096, "apiBaseUrl": "…", "requestTimeoutMs": 60000, "maxRetries": 2 }
  },
  "profiles": { "fast": { "provider": "anthropic" } }
}
```

- `provider`, `profiles.<이름>.provider`: `API_PROVIDER_NAMES` 중 하나다. scripted는 task 파일에서만 고른다. 다른 값은 `invalid_config`다.
- `providers`: 키는 `API_PROVIDER_NAMES` 중 하나다. 다른 키는 그 이름을 되풀이하지 않고 `invalid_config`로 거부한다.
  - 항목의 필드는 `model`, `maxOutputTokens`, `apiBaseUrl`, `requestTimeoutMs`, `maxRetries`뿐이다. 규칙은 최상위 필드와 같고, 아래 둘은 그 제공자의 것을 쓴다.
    - 출력 토큰: `API_PROVIDERS[<이름>].minOutputTokens` 이상, `maxOutputTokensLimit` 이하(openai는 16 이상).
    - 주소의 경로 규칙: `baseUrlPath`. 공통 규칙(S-9, https, 루프백만 http, 사용자 정보·질의·조각·공백·역슬래시 없음)은 같다.
      - `without_version`(anthropic): `/v1`, `/v1/messages`로 끝나면 거부한다. 어댑터가 `/v1/messages`를 붙인다.
      - `with_version`(openai): `/responses`, `/models`로 끝나면 거부한다. 기본 주소는 `https://api.openai.com/v1`이다.
  - 오류 글은 위치를 `providers.<이름>.<필드>`로 적는다.
- `providers.anthropic`과 최상위 제공자 설정(`model`, `maxOutputTokens`, `apiBaseUrl`, `requestTimeoutMs`, `maxRetries`)을 함께 쓰면 `invalid_config`다. 둘은 같은 설정이라 어느 쪽인지 모호하다.

### 19.2 제공자 고르기

| 실행 형식 | 제공자 |
| --- | --- |
| task 파일 | `model.provider`(scripted 또는 `API_PROVIDER_NAMES`). 설정의 `provider`는 쓰지 않는다 |
| 간편 형식(`run`, `doctor`) | `--profile`의 `provider` → 설정 `provider` → anthropic |

- task 파일의 `model: { provider: "openai", model?, maxOutputTokens? }`의 출력 토큰은 그 제공자의 범위로 검사한다.
- 고른 제공자가 API 제공자이면 `limits.maxTotalTokens`는 숫자여야 한다(11절 "한도"의 anthropic 규칙과 같다). 오류 글은 제공자 이름을 적는다.

### 19.3 해석 (`resolveApiSettings`, `src/cli/settings.ts`)

모두 고른 제공자 몫으로 해석한다. 그 제공자의 설정은 `providers.<이름>`이고, anthropic은 그것이 없으면 최상위 필드다(`providerSettingsOf`). 다른 제공자의 항목은 읽지 않는다.

| 값 | 순서 |
| --- | --- |
| 키 | `API_PROVIDERS[<이름>].keyEnv`만(anthropic `ANTHROPIC_API_KEY`, openai `OPENAI_API_KEY`). 다른 제공자의 키는 대신하지 않는다 |
| 모델 | task `model.model` → 제공자의 모델 변수 → 제공자 설정 `model` |
| 출력 토큰 | task `model.maxOutputTokens` → 제공자 설정 `maxOutputTokens` |
| API 주소 | 제공자의 주소 변수(그 제공자의 경로 규칙으로 검사) → 제공자 설정 `apiBaseUrl` → `defaultApiBaseUrl` |
| 요청 시간 한도, 재시도 | 제공자 설정 → `DEFAULT_REQUEST_TIMEOUT_MS`, `DEFAULT_MAX_RETRIES` |

- 모델과 주소의 환경 변수는 제공자마다 따로다(DR-34 (a), 검토 R-20 M-1). 키는 언제나 그 제공자의 주소로만 간다.

  | 제공자 | 모델 변수 | 주소 변수 |
  | --- | --- | --- |
  | anthropic | `CODARYN_MODEL` | `CODARYN_API_BASE_URL` |
  | openai | `CODARYN_OPENAI_MODEL` | `CODARYN_OPENAI_API_BASE_URL` |

  - `CODARYN_MODEL`, `CODARYN_API_BASE_URL`은 SP-4 전과 같이 anthropic 전용이다. SP-4에서 "고른 제공자에 적용"이라 했던 규칙은 이것으로 바뀌었다. 그래서 한 제공자용 값이 다른 제공자로 가지 않는다(R-19 I-4도 해소).
  - OpenAI 변수 이름은 계약 담당이 상수로 낼 때까지 CLI(`PROVIDER_SETTING_ENVS`, `src/cli/security/env.ts`)에 적어 둔다.
  - 변수 파일이 새로 설정한 이 네 변수의 값은 가릴 값으로 등록하지 않는다(설정 값이다).
- 빠진 키·모델·출력 토큰은 `provider_not_configured`이고, 글은 그 제공자의 키 변수와 설정 위치(`providers.openai.model` 등)를 적는다.
- `resolveAnthropicSettings`, `resolveListSettings`, `resolveConnection`은 예전 이름과 인자로 남는다. 제공자를 주지 않으면 anthropic이고, 결과는 SP-4 전과 같다(고정 시험 SP-0 P-7).

### 19.4 명령

- `run`(SP-6): API 제공자는 먼저 그 제공자의 설정(키, 모델, 출력 토큰, 주소, 시간)을 모두 해석한 뒤, 그 제공자의 공장(`API_PROVIDER_FACTORIES`, `src/cli/provider.ts`)으로 만든다. openai는 Responses API 어댑터(`src/model/openai`)다. 공장은 그 제공자의 해석 결과만 받으므로, 키는 그 제공자의 주소로만 간다.
- `doctor`: `api_key`, `model` 점검은 고른 제공자의 키 변수(`doctor.api_key.ok {keyEnv}`, `doctor.api_key.missing {keyEnv, provider}`), 모델·주소 변수, 설정, 주소 규칙으로 한다.
  - 키가 있으면 `api_key`의 `message`가 그 키가 가는 주소의 origin(스킴·호스트·포트)과 그 주소의 출처(주소 변수, 설정 필드, 기본 주소)를 적는다(DR-34 (a)). 경로는 적지 않는다. 경로에 주소 말고 다른 것이 들어 있을 수 있어서다.
    - 예: `ANTHROPIC_API_KEY is set; anthropic requests send it only to https://api.anthropic.com (the default address)`
    - 설정 파일이 검사를 지나지 못하면(`config_file` 실패) 주소 변수가 정하는 경우가 아니면 목적지를 말하지 않는다. 글은 `doctor.api_key.ok`, 메시지는 "where it is sent is not known until the config file passes its checks"다(검토 R-26 L-1). 설정이 주소와 간편 형식의 제공자를 정하는데, 검사에 걸린 설정은 쓰이지 않기 때문이다.
    - 사람용 글(DR-36 (b)): `doctor.api_key.sends_to_default`, `sends_to_env`(`{variable}`), `sends_to_config`(`{field}`)가 `{keyEnv}`, `{provider}`, `{origin}`(`toApiOrigin`)을 받는다. 주소 변수가 규칙에 어긋나면 `doctor.api_key.address_invalid`다. origin이 계약의 모양이 아니면 주소를 적지 않고 `doctor.api_key.ok`로 둔다.
  - 다른 제공자의 모델·주소 변수가 설정돼 있으면 `model`의 `message`가 그 변수 이름을 들어, 이 실행이 읽지 않는다고 적는다(SP-6, R-19 I-4). 값은 적지 않는다.
    - 예: `CODARYN_MODEL is set but is anthropic's; an openai run does not read it`
    - 사람용 글(DR-36 (b)): 변수마다 `model` 점검의 `notes`에 `doctor.model.other_provider_variable {variable, owner, provider}`를 하나씩 싣는다. 사람용 출력은 그 점검 줄 아래에 한 줄씩 보인다.
- `models [--provider <name>]`(SP-6): 제공자는 `--provider`, 없으면 설정의 `provider`, 없으면 anthropic이다. `--provider`의 값은 `API_PROVIDER_NAMES` 중 하나여야 하고, 아니면 아무것도 보내지 않고 `invalid_arguments`다.
  - 그 제공자의 키 변수, 주소(주소 변수 → 제공자 설정 → 기본 주소), 목록 함수(`API_MODEL_LISTERS`)만 쓴다. 다른 제공자의 키나 주소는 쓰지 않는다(DR-34 (a), R-20 D2).
  - 목록 함수는 `main.ts`가 넘길 때만 연결된다(`listModels`, `listers`). 넘기지 않으면 아무것도 보내지 않고 `provider_not_implemented`다.
  - 키가 거부되면(`auth_failed`) 안내는 그 제공자의 키 변수(`check OPENAI_API_KEY` 등)를 적는다.
  - 현재 모델: 그 제공자의 모델 변수 → 그 제공자의 설정 `model`.
    - `current.source`와 `selected.overriddenBy`는 그 제공자의 모델 변수 이름(`ApiModelEnv`: `CODARYN_MODEL`, `CODARYN_OPENAI_MODEL`)이나 `config`다(DR-36 (a)).
  - `--use`가 쓰는 자리: anthropic은 최상위 `model`이다. 설정이 `providers.anthropic`을 쓰면 `providers.anthropic.model`, 다른 제공자는 `providers.<이름>.model`이다.
    - 다른 필드와 그 순서는 그대로 둔다. 없는 `providers`나 항목은 끝에 더한다.
    - 설정 파일이 없으면 `schemaVersion`과 그 자리의 모델만으로 만든다. `provider`는 쓰지 않는다. 간편 형식의 제공자를 바꾸는 것은 사람이 정한다.
  - `ModelsOutput.provider`: anthropic이 아닌 제공자를 보일 때 싣는다. anthropic에도 싣는 것은 SP-0 고정 값(P-8 `models --json`) 변경이라 PM 승인 뒤에 한다.
- `init`: 지금처럼 anthropic 설정을 쓴다. 키 안내 글은 `{keyEnv}`를 받는다.

### 18.11 되돌리기가 제자리에 놓지 못한 파일 (R-16 L-1, DR-37 (c))

- 되돌리기가 옮겨 둔 파일을 제자리에 다시 놓지 못하면(그 사이 같은 이름의 파일이 생김) 그 파일은 `.codaryn/parked/<runId>/<행동 번호>-<무작위>`에 남는다. 경로에는 사람의 파일 이름이 없고, Codaryn은 이 파일을 지우지 않는다.
- 알리는 곳
  - 되돌리기 결과: `skipped[].parkedAt`(JSON)에 그 경로가 있다. 사람용 요약은 수만 적는다(`revert.parked {count}`).
  - `doctor`의 `lock` 점검(`listParkedFiles`)
    - 잠금이 ok이면 점검이 `warn`이 되고 글은 `doctor.lock.parked_left {count}`다.
    - 잠금이 다른 상태(`held`, `unreadable`, `reclaim_left`)이면 그 상태의 글은 그대로 두고, `doctor.lock.parked_left {count}`를 그 점검의 `notes`에 싣는다. 사람용 출력은 잠금 줄 아래에 한 줄로 보인다(DR-37 (c), 검토 R-24 L-2). 전에는 JSON `message`에만 있었다.


### 18.12 실행 기록이 바뀐 실행 (DR-38)

- 실행의 기록(journal·snapshots·plan 등)은 `createRunRecorders`(store)가 만든다. 같이 나오는 `stateGuard`를 엔진에 `EngineDeps.stateGuard`로 넘긴다. 엔진의 점검은 실행이 쓴 것 말고 바뀐 것만 변화로 센다(엔진 92e0812). 바뀌면 실행은 `failed`/`state_changed`로 끝나고 결과의 `stateChanged`에 경로(가림본)가 남는다. `report`는 그 목록을 그대로 보인다. `stateChanged`는 바뀐 것이 있을 때만 싣는다(PM, bf04750 뒤): 엔진이 준 빈 목록은 `run`·`apply`의 출력과 `result.json`에서 빼고, `report`도 읽을 때 뺀다. 그래서 기록이 바뀌지 않은 실행의 출력은 DR-38 전과 바이트가 같다.
- 적용 실행(`codaryn apply`)의 저널, 계획의 적용 표시, 폐기 보관함 폴더는 `createApplyRecorders`(store)가 만들고, 그 `stateGuard`를 `ApplyDeps.stateGuard`로 넘긴다. 적용 중 기록이 바뀌면 적용은 `failed`/`state_changed`로 끝나고, 이미 한 이동은 되돌리기를 위해 남는다.
- 표시(`runs/<runId>/records-changed.json`이 있는 실행. 읽을 수 없는 표시도 표시로 본다):
  - `report`: 보고서는 그대로 보이고 JSON의 `recordsChanged: true`, 사람용 보고서에 한 줄(`report.records_changed`의 영어 글)을 더한다. 적용 실행의 보고서(`ApplyReportOutput`)는 계약에 자리가 없어 아직 말하지 않는다.
  - `revert`: 막지 않는다(스냅샷·다이제스트 확인은 그대로). 결과에 `recordsChanged: true`(미리보기 포함). 사람용 줄은 렌더러(N-C) 몫이다.
  - 표시가 없으면 두 필드 모두 없다.
  - `apply`(U-1, R-33 R33-L3): 표시가 있는 계획 실행(읽을 수 없는 표시도)은 적용하지 않는다. 계획을 불러온 직후, 아무것도 묻기 전에 `plan_records_changed`(종료 2)로 거부한다. 묻거나 기록하거나 옮긴 것이 없고 적용 실행도 만들지 않는다. 계획을 새 실행으로 다시 만든다. 엔진에는 같은 확인(`ApplyDeps.planRecordsChanged`, store의 `hasRecordsChangedMark`)을 넘겨 잠금 아래에서 다시 본다.
  - U-29(R-44 R44-L1), U-33(DR-55, 검토 R-56, R-56b): `apply`는 store의 `stateUncheckedSince`를 `ApplyDeps.planRecordsUnchecked`로 엔진에 넘긴다. 요청에는 이 적용의 실행 id(`applyRunId`)가 든다.
    - 보는 실행: 계획 실행, 그리고 계획 실행의 초(실행 id의 앞 16자) 또는 그 뒤에 시작한 모든 실행과 적용 실행. 같은 초에 시작한 실행은 id의 무작위 부분과 상관없이 계획보다 앞이든 뒤든 모두 센다. 실행 id 모양이지만 시각을 알 수 없는 이름도 센다(fail closed). 그보다 앞선 초의 실행은 세지 않는다.
    - 그 가운데 하나라도 상태 디렉터리를 다 확인하지 못했거나(`state_checked`의 `limited: true`), 기록을 읽을 수 없거나, 끝 기록(`run_finished`)이 없으면(확인 전에 끝남) 알린다. 묻는 적용 자신은 뺀다. 그 기록은 아직 쓰는 중이어서다.
    - 적용은 계속한다. 적용 자신의 상태 점검이 하나라도 다 하지 못했으면 알림과 결과는 아래 U-8 그대로다. 자기 점검이 모두 온전할 때만 이 답을 알린다: `noticeKinds: ["plan_records_unchecked"]`, `planRecordsUncheckedCause: "run_since_plan"`, 그 까닭의 고정 알림 한 줄. 사람용 줄은 `apply.notice.plan_records_unchecked.run_since_plan`이고, cleanup을 권하지 않는다(지금은 상태 디렉터리가 작을 수 있다).
    - `report --json`의 적용 결과는 `planRecordsUncheckedCause`를 기록된 대로 싣는다(U-46, 검토 R-56b L1). 아는 까닭(`PLAN_RECORDS_UNCHECKED_CAUSES`)이 아니면 다른 손상된 필드처럼 `invalid_run_record`다. 없으면 없다. 사람용 `report`는 `notices`의 글을 그대로 싣는다.
  - `apply`(U-8, R-39 L-1): 상태 디렉터리가 너무 커서 다 확인하지 못한 적용은 거부하지 않고 알린다. 결과의 `noticeKinds`에 `plan_records_unchecked`가 있고 `notices`에 고정 알림 한 줄이 있다. `report`는 둘을 그대로 싣는다. 확인이 다 된 적용은 `noticeKinds`가 없고 출력이 전과 같다.


### 18.13 상태 디렉터리 정리 `codaryn cleanup` (DR-39)

- 모양: `codaryn cleanup --workspace <dir> [--older-than <days>] [--run <id>[,<id>...]] [--reverted] [--discarded-older-than <days>] [--discarded-run <id>[,<id>...]] [--confirm <digest 12자 이상> [--delete-discarded]] [--json]`
- 기본은 미리보기다. `summarizeState`의 요약과 `planCleanup`의 계획(항목·경고·막힌 것·합계·`parked`·다이제스트)을 보이고 아무것도 지우지 않는다.
- 확인은 둘이다(DR-39 P-4).
  - `--confirm <digest>`: 지금 만든 계획의 다이제스트와 앞부분이 같아야 한다. 다르면 아무것도 지우지 않고 `cleanup_plan_changed`(종료 2)다. store가 잠금 아래에서 계획을 다시 만들어 다이제스트가 같을 때만 지운다.
  - `--delete-discarded`: `--confirm`과 함께일 때만. 사람의 파일인 폐기 보관함 폴더는 이것이 있을 때만 지운다. 없으면 `not_confirmed`로 남는다.
  - `--include-not-reverted`(DR-44 (가)): `--confirm`과 함께일 때만. 되돌리지 않은 실행과 일부만 되돌린 실행(`not_reverted`)의 기록은 이것이 있어야 지운다. 막지는 않는다. 미리보기의 확인 머리줄에 그런 실행의 수를 적는다. 이것 없이 확인하면 store가 그 기록을 `not_reverted_not_confirmed`로, 남는 적용이 쓰는 계획 실행을 `used_by_kept_apply`로 남기고 나머지를 지운다(사람의 선택이라 종료 0). 남은 `cleanup-…` 폴더(DR-44 (라))는 모든 계획에 `leftover` 항목으로 들어가 요약·미리보기·완료 줄에 보이고, 확인하면 지운다. 옮긴 뒤 다 지우지 못하면 `partly_removed`(종료 1)이고 지웠다고 보고·기록하지 않는다.
  - 끝 줄(U-86, R-34 I-3을 대신함)은 붙여 쓸 명령을 둘까지 말한다. 둘 다 "아무것도 지우지 않았다"로 시작하고, 옵션은 같은 줄 끝에 한 칸 띄어 붙는다.
    - `cleanup.command.confirm`: `--confirm`만으로 지우는 묶음에 항목이 있을 때. `--confirm <digest 앞 12자>`.
    - `cleanup.command.all`: 다른 옵션이 필요한 항목이 있을 때. `--confirm <digest 앞 12자>`와, 어떤 항목이 필요로 하는 옵션을 모두 `CLEANUP_CONFIRM_FLAGS` 순서(`--include-not-reverted`, `--delete-discarded`)로.
    - 모든 항목이 남는 것이면 명령이 없다.
  - 권하는 명령에 `--include-not-reverted`가 들어갈 수 있다. R-34b P-3(넣지 않고 따로 한 줄로 알림)을 U-86이 바꿨다. 그 옵션이 필요한 항목은 `--include-not-reverted`만 필요한 묶음이나 두 옵션이 다 필요한 묶음에 들고, 그 묶음의 머리 줄이 잃는 것을 말한다(되돌리지 않은 실행, 일부만 되돌린 실행, 기록을 확인할 수 없는 실행. 지우면 되돌릴 수도 손으로 되살릴 수도 없음). 기록을 확인할 수 없는 실행의 경고는 `records_unreadable`이다.
  - U-3: 남은 폴더 이름 꼴이지만 정리의 표지가 없는 폴더는 `StateSummary.unknownFolders`가 있을 때 요약에 `cleanup.summary.unknown_folders` 한 줄로 보이기만 한다. 항목이 아니고, 어떤 확인으로도 지우지 않는다.
- 지우지 않는 것(store가 막음): `parked`, 잠금, `.gitignore`, 진행 중인 실행(`lock_held`), 결과가 없는 실행(`no_result`), 선택되지 않은 적용 실행이 쓰는 계획 실행(`plan_used_by_apply`: 그 적용의 되돌리기에 필요하다). 변경 표시가 있는 실행은 막지 않고 경고한다(P-5).
- 고르기: 실행 기록은 `--older-than`, `--run`, `--reverted`. 폐기 보관함은 `--discarded-older-than`, `--discarded-run`. 한 부분의 조건을 모두 만족해야 고른다. 조건이 없는 부분은 아무것도 고르지 않는다. 실행 id는 정확한 이름이다(`latest` 없음).
- 출력(계약의 `CleanupOutput`, U-22·DR-48·AXM-3): `status`가 일어난 일을 말하고 종료 코드는 `CLEANUP_EXIT_CODES`를 따른다. `preview`(종료 0, `summary`·`plan`), `removed`(0: 지운 것이 있고 문제로 남긴 것이 없음), `nothing_removed`(3: 지운 것이 없고 문제로 남긴 것도 없음. 확인을 주지 않았거나 규칙으로 남긴 것뿐), `partly_failed`(1: `CLEANUP_PROBLEM_KEPT_REASONS`의 이유로 남긴 것이 있음). 뒤의 셋은 `outcome`을 담고 `outcome.ok`는 `removed`일 때만 true다. 예전의 `mode` 필드는 없다. 확인한 다이제스트가 계획의 것이 아니면 `CleanupOutput`이 아니라 오류 `cleanup_plan_changed`(종료 2)이고 아무것도 지우지 않는다. 지운 것이 없으면 글은 "Nothing was removed."로 시작한다. U-13(UXM-1): 폐기 보관함에 파일이 남는 적용 실행의 기록은 그 폐기 보관함을 같은 정리에서 지우지 않으면(`--delete-discarded`와 폐기 보관함 선택) 남긴다(`discarded_left`, 그 적용이 쓰는 계획 실행은 `used_by_kept_apply`). 미리보기는 그런 적용의 수를 안내 줄로, 완료 출력은 `cleanup.done_discarded_left` 줄과 항목별 이유로 알린다. 다른 프로세스가 잠금을 쥐면 `workspace_locked`(6) 오류다.
- 사람용 글은 카탈로그의 `cleanup.*` 문구와 실행 id·크기다. 확인 방법 안내 한 줄은 아직 카탈로그 id가 없어 영어로 둔다.
- 기록: store가 `.codaryn/cleanup.jsonl`에 개수와 크기만 남긴다.

### 18.14 읽기 명령의 가벼운 형식과 `--workspace` 생략 (U-17, UXM-3, UXM-19, AXM-14, DR-46)

- `plan`과 `review`는 모델도 검증기도 돌리지 않으므로 간편 형식에서 실행 한도를 요구하지 않는다(설정 파일에 한도가 없어도 됨. 준 한도는 그대로 검사). 가릴 값의 이름과 작업 종류만 해석한다. `apply`는 검증기를 그 설정으로 돌리므로 지금처럼 요구한다.
- 읽기 명령 `report`, `plan`, `changes`는 `--workspace`(와 `--task`)가 없으면 현재 폴더를 쓴다. 바꾸는 명령 `revert`, `cleanup`, `apply`, `review`는 지금처럼 명시를 요구하고, 오류에 `--workspace .`를 주면 현재 폴더라는 안내를 붙인다.
- `changes`의 간편 형식이 제공자 설정을 요구하지 않게 하는 것은 앱 계층 몫이다.

### 18.15 적용된 계획 실행의 되돌리기 (U-16, UXM-5, R-55 L-1)

- 계획 실행은 스스로 파일을 바꾸지 않는다. 그 계획을 적용한 실행이 있고 이번 되돌리기가 되돌린 것도 건너뛴 것도 없으면 되돌리기 기록을 쓰지 않는다(목록에 "되돌림"이 붙지 않음). JSON 줄은 그대로다.
- stderr의 안내는 `revert.plan_only` 한 줄과, 그 적용 실행을 계약의 규칙 `planApplyStateOf`(실행 목록)로 판정한 상태의 줄이다. `PLAN_APPLY_STATES_TO_REVERT`(`applied`, `unfinished`)일 때만 그 실행을 되돌리라고 한다(`revert.plan_revert_apply`, `--run <적용 실행>`). `applying`(결과가 아직 없음), `reverted`(마지막 되돌리기가 complete), `record_missing`(목록에 없거나 손상)은 그렇다고만 말한다(`revert.plan_applying`, `revert.plan_apply_reverted`, `revert.plan_apply_missing`). 목록을 읽지 못하면 그렇다고 말한다. 다섯 문구 id는 카탈로그에 있다. main `1e54ca9`의 실제 CLI(`CODARYN_LANG=ko`)로 `revert.plan_only`, `revert.plan_revert_apply`, `revert.plan_apply_reverted`가 한국어로 나오는 것을 확인했다. `revert.plan_applying`, `revert.plan_apply_missing`은 카탈로그에서만 확인했다. `--dry-run`도 같다.

### 18.16 묻고 실행하는 명령 규칙 `confirm` (U-109, R-79 L-1, 설계 Q-2)

- 어디서 받나: 설정 파일의 `policy.commands[i]`와 프로필의 `profiles.<이름>.policy.commands[i]`에서만 `confirm: true`를 받는다(계약 `ConfirmableCommandRule`; `parsePolicy(value, "settings")`). 사람의 설정이기 때문이다.
- 그 밖에서는 지금처럼 알 수 없는 필드다. task 파일의 `policy.commands[i]`는 `invalid_task`, 설정의 작업 종류 정의 `workflows.<id>.policy.commands[i]`는 `invalid_config`이고 둘 다 `unknown_field`다. 작업과 함께 오는 파일이 질문을 만들 수 없게 한다.
- 값은 `true`뿐이다. 없으면 묻지 않는 보통 규칙이다. `false`나 다른 값은 `invalid_config`(`invalid_value`)이고 메시지는 `policy.commands[i].confirm must be true when it is given`이다. 진단의 `field`는 그 규칙(`policy.commands[i]`, 프로필이면 `profiles[n].policy.commands[i]`)이다. `confirm`이 계약의 `SCHEMA_FIELD_NAMES`에 아직 없어서다.
- 뜻(U-74, 엔진): 그 규칙에만 맞는 명령 호출은 물어서 허락받으면 그 한 번만 실행된다. 같은 실행 파일이라도 `confirm`이 없는 규칙에 맞는 호출은 묻지 않고 실행된다. 작업 종류 정의와 합칠 때(`mergeWorkflowPolicy`) 남는 규칙에도 `confirm`이 남는다.
- 물을 수 없을 때(U-110 전의 CLI, 그리고 U-110 뒤에도 터미널이 아니거나 `--quiet`일 때)는 엔진이 질문(`confirmation_requested`)과 기본 답(`confirmation_answered`, `deny`, `default`)을 기록한 뒤 `command/confirmation_required`로 거부하고, 명령은 돌지 않는다. 모델은 그 거부를 도구 결과로 받는다. 터미널에서 묻는 것은 18.17(U-110)이다.
- `doctor`는 그런 설정을 유효하게 읽는다(`config_file` `ok`). 묻는 규칙이 있다는 알림은 아직 없다(문안은 보고서에 제안).
- 앱 계층의 설정 바꾸기에서 규칙의 `confirm`을 지우는 제안은 넓히기다(`confirm_removed`, U-107).
- 시험: `tests/unit/cli/g-u109-confirm-rules.test.ts`(실제 CLI, 루프백 가짜 서버).

### 18.17 터미널에서 묻는 권한 질문 (U-110, B-5, DR-3, DR-10)

- `run`은 표준 입력과 stderr가 둘 다 터미널이고 `--quiet`이 아닐 때만 엔진에 질문 통로(`EngineDeps.confirm`)를 준다(`src/cli/confirm.ts`의 `terminalConfirm`). 그 밖에는 통로가 없고 18.16대로 기본 거부다. `run`에는 `--json` 옵션이 없다. stdout이 터미널이 아니어서 JSON 한 줄을 쓰는 경우도 위 조건만 본다.
- 질문은 stderr에 한 줄이다: `confirm.question.command`(`{count}` = 인자 개수), `: `, 가린 실행 파일(`ConfirmRequest.subject`, 제어 문자는 바꿈), 한 칸, `prompt.yes_no_default_no`, 한 칸. 고른 언어로 쓰고, 렌더러가 없으면 영어다. 인자 자체는 보이지 않는다. 다른 사람용 글처럼 키 모양과 지금의 키 값을 가리고 제어 문자를 바꾼 뒤 쓴다.
- 답은 한 줄이고 `apply`의 질문과 같은 규칙이다. 앞뒤 공백을 떼고 소문자로 바꿔 `y`, `yes`, `예`, `네`면 이번 호출 한 번만 허용(`allow_once`, `user`)한다. 그 밖의 줄(Enter 포함)은 그 사람의 거부(`deny`, `user`)다.
- 줄이 오지 않으면 답이 없는 것이다(`dismissed`, 기록은 `deny`, `default`). 입력 끝, 터미널의 Ctrl+D(질문을 닫음), Enter 없는 마지막 줄, 묻다가 난 실패가 그렇다. 실행이 취소되거나 시간이 다 되면 엔진의 신호가 질문을 끝내고, 기록은 엔진이 정한다(`cancelled` 또는 `default`).
  - Windows의 Ctrl+Z(R-88 I3): Node의 readline은 터미널 방식의 Windows에서 Ctrl+Z 키를 무시한다(소스로 읽음). 그래서 Ctrl+Z 뒤 Enter는 빈 줄, 곧 그 사람의 거부(`deny`, `user`)일 것이다. 결정은 같은 거부이고 `by`만 다르다.
- 질문 중의 Ctrl+C(R-88 M2): 터미널에서 readline은 표준 입력을 raw로 두어 Ctrl+C를 신호가 아니라 키로 받는다. `askLine`은 그것을 readline의 'SIGINT'로 듣고 '끊음'으로 돌려준다(줄이나 답 없음과 다름).
  - `run`의 권한 질문: CLI의 취소 통로(`cancel.ts`가 듣는 SIGINT)와 같은 길로 실행 전체를 취소한다. 엔진의 신호가 질문을 끝내고 기록은 `deny`, `cancelled`, 실행은 `cancelled`(종료 5)로 끝난다. 모델은 다시 부르지 않는다.
  - `apply`·`revert`·`models`·`init`의 질문: `prompt.interrupted` 한 줄을 stderr에 쓰고 종료 5로 끝난다. 이 질문들은 바꾸기 전(또는 더 바꾸기 전)에 묻는다. 그래서 아무것도 더 바뀌지 않는다(`init`은 설정을 쓰지 않는다). `apply`의 위험한 이동 동의와 `revert`의 질문은 첫 번은 이미 끝난 뒤다(그 결과는 기록에 있다). 끝 요약은 내지 않는다.
- 명령 권한만 묻는다. 다른 권한의 질문은 글이 없어 묻지 않고 답이 없는 것으로 돌려준다.
- 모든 질문의 한 줄 읽기(`src/cli/terminal.ts`의 `askLine`, 답은 줄 · 답 없음 · 끊음)는 입력이 끝나면 답 없음으로 끝난다. readline의 `question()`만으로는 입력 끝에서 끝나지 않아, `apply`·`revert`·`models`·`init`의 질문도 입력 끝에서 멈춰 있었다. 이제 그 질문들도 입력 끝을 '아니오'(또는 답 없음)로 받는다.
  - 이미 끝난 입력(R-88 L2): 입력이 한 번 끝났으면 그 뒤의 질문은 묻지 않고 곧 답 없음이다. 예전에는 끝나지 않아 종료 13으로 끝났고(결과·`result.json` 없음, 잠금 남음), 이제 실행은 결과를 내고 잠금을 푼다.
  - 질문이 끝난 뒤(R-88 L1): 묻는 동안만 표준 입력이 프로세스를 붙잡고, 끝나면 읽기를 멈추고 놓는다(`pause`, `unref`). 예전에는 Ctrl+D·Ctrl+C로 질문을 닫으면 명령이 끝나도 입력이 열린 동안 프로세스가 끝나지 않았다(main의 `apply`도 같았다).
  - 줄 없이 끝난 질문(U-141, R-88b I1): 입력 끝, 터미널의 Ctrl+D·Ctrl+C면 질문을 쓴 흐름에 줄 끝 하나를 써서 다음 글(진행 줄, 오류 설명, 다음 출력)이 제 줄에서 시작한다. 줄을 친 경우(그 줄이 끝냄), 질문이 취소된 경우(readline이 줄을 지우며 스스로 끝냄), 묻기 전에 이미 끝난 입력(묻지 않음)에는 쓰지 않는다. 권한 질문·`apply`·`models`·`init`의 질문을 흉내 낸 터미널로 시험했다(`tests/unit/cli/g-u141-question-newline.test.ts`).
- **실제 터미널로는 확인하지 못했다.** Windows 콘솔과 Unix pty로 돌려 보지 않았다. 시험과 검토 R-88은 흉내다: 미리 읽는 모듈이 흐름의 `isTTY`를 참으로 두고, 표준 입력은 파이프여서 readline이 터미널 방식으로 읽는다(Ctrl+C는 0x03, Ctrl+D는 0x04 바이트). 실제 터미널의 raw 방식(`setRawMode`)과 신호는 그대로 재현되지 않는다. 판단은 Node 소스와 이 흉내에 기댄다.
- 진행 줄: 질문 기록마다 영어 진행 줄(`progressLine`, U-74)이 있다. 고른 언어의 진행 줄(사람용 렌더러 `src/cli/human`)은 `confirmation_answered`마다 `progress.confirmation_allowed` 또는 `progress.confirmation_denied.<by>`다(R-85 M1, nc-human 몫).
- 끝 요약(R-85 M1): `run`은 질문 뒤 거부된 호출을 누가 정했는지(`user`, `default`, `cancelled`)와 이 실행이 물을 수 있었는지(`couldAsk`)를 `RunSummaryContext.confirmationDenied`로 렌더러에 넘긴다. 그런 거부가 없으면 필드가 없다. 그 호출은 `deniedCommandCalls`에도 들어 있다.
  - 렌더러는 그 호출에 '규칙을 더하라'(`summary.denied_hint`)를 내지 않는다. 그 안내는 나머지 거부된 명령 호출이 있을 때만이다.
  - 대신 0보다 큰 것마다 한 줄: `summary.confirm_denied.user`(사람이 거부), `.cancelled`(기다리는 동안 취소), `default`는 `couldAsk`면 `.unanswered`(입력 끝이나 시간 한도), 아니면 `.unasked`(이 실행은 물을 수 없었다: 터미널이 아니거나 `--quiet`).
  - 앱 계층의 실행(GUI)은 이 필드를 아직 채우지 않는다(선택 필드라 지금 출력 그대로).
- 시험: `tests/unit/cli/g-u110-r88-terminal.test.ts`(R-88: 끊음, 끝난 입력, 놓음; 실제 CLI의 실행 취소와 init의 멈춤, `u110-terminal-preload`로 흉내), `tests/unit/cli/g-u110-terminal-confirm.test.ts`(실행 안의 질문과 답, `--quiet`, 통로 없음), `tests/unit/cli/g-u110-terminal-line.test.ts`(한 줄 읽기, 질문 글, 답 규칙, 파이프로 넣은 `y`는 답이 되지 않음).

### 18.18 기록과 맞게 고친 글 다섯 (U-131, U-129의 넘김)

- 모두 사람용 글만 바꾼다. `report --json`, `review --json`, `changes --json`, 적용 결과(JSON)는 그대로다.
- `report`의 사람 확인 절(N1, AXM-21): 판정이 없을 때만 "The run waits for a person's verdict (…)"를 낸다. 판정이 있으면 그 줄이 없고, 판정 줄 뒤에 ``A later review replaces it: `codaryn review --run <id> --accept | --reject`.``가 온다.
- `report`의 계획 줄(N2, UXM-5): 계획 실행의 적용을 실행 목록의 규칙(`planApplyStateOf`, `runs`와 계획 보기와 같음)으로 본다. 적용이 없으면 예전처럼 "waiting for approval"이다. `applied`면 ``- Plan: N action(s), applied by run `<id>` (its report: `codaryn report --run <id>`).``이고, `unfinished`·`applying`·`reverted`·`record_missing`은 `runs.plan_*`와 같은 뜻의 영어다. 글을 낼 때만 실행 목록을 읽는다(`--json`이면 읽지 않는다).
- `review --reject`(N3, AXM-21): 그 실행이 바꾼 파일이 있으면(`result.changes`가 1건 이상) 끝에 되돌리는 명령(`summary.next_revert`, `--workspace`를 쳤으면 `summary.next_revert_typed`, DR-51)을 낸다. 받아들였거나 바꾼 파일이 없으면 예전 그대로다. 그 실행의 되돌리기 기록이 `complete`이면(이미 완전히 되돌림) 내지 않는다(U-153, R-94 I2).
- 계획 실행의 `changes`(N4, UXM-4·5): `changes.none` 대신 `changes.plan_only`(계획만 만들고 스스로 바꾼 파일은 없음), 적용이 있으면 이어서 `changes.plan_applied`(그 적용 실행이 끝났으면) 또는 `changes.plan_apply_other`(`codaryn runs`가 그 끝을 보여 줌). 실행 목록은 앱 계층의 `listRuns`로 그 실행의 작업 공간(친 `--workspace`, 또는 task 파일의 `workspaceRoot`)에서 읽는다. 읽지 못하면 예전 글(`changes.none`)이다. task 파일을 다시 읽을 때도 첫 읽기와 같은 크기 검사(DR-40 (b))를 거친다(U-153, R-94 I4).
- 다른 작업으로 만든 계획의 적용(N5, UXM-15): 계획 실행의 작업 id(`planTaskIdOf`)가 이 적용의 것과 다르면, `apply.notice.plan_task_differs`를 적용 시작 줄 바로 다음 진행 줄로, 터미널이면 승인 질문(`apply.question`) 바로 앞에도 낸다. 끝 요약의 알림(결과의 `notices`)은 그대로다. 같은 작업 id를 엔진(`ApplyDeps.planTaskId`)에 준다. 기록과 계약은 바뀌지 않는다.
- 시험: `tests/unit/cli/g-u131-handoffs.test.ts`(실제 CLI, 대본 모델, net guard; 터미널 질문은 `u115-terminal-preload`로 흉내).
