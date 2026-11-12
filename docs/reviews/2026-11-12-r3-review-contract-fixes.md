# R-3 검토: 계약 수정 커밋 397413a가 N-14~N-18과 검토 합성 입력을 실제로 막는가

## 0. 이해 확인

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 읽기 전용 교차 검토.
- worktree/브랜치: `D:\project\Codaryn\.worktrees\claude-quality` / `claude/security-core`. main `71f4824`을 병합한 상태에서 검토했다(fast-forward). main의 `src/contracts`와 `tests/unit/contracts`는 `397413a`와 차이가 없다(`git diff --stat 397413a HEAD` 빈 결과).
- 대상: `397413a` fix(contracts): N-14~N-18. 기준 검토: `docs/reviews/2026-11-12-n-review-usability-contract.md`(H1, M1, M2, M3, L1).
- 금지 행위를 지켰다: 저장소 파일 수정·커밋 없음. 실험은 `.codaryn/r3/` 안에서만 했다(빌드 사본 `tsc --outDir .codaryn/r3/build/dist`). 작업 디렉터리 밖은 읽지 않았다. 실제 API·네트워크·키 파일 미사용. 자식 프로세스에서는 ANTHROPIC_API_KEY, CODARYN_* 변수를 지우고, APPDATA·XDG_CONFIG_HOME은 `.codaryn/r3/noappdata`로 돌렸다.
- 이해관계 표시: 실행 시간 검사 중 카탈로그(`src/i18n`) 부분은 내가 구현한 N-B 모듈이다. 그 결과는 참고로만 적고, 판단은 계약 함수와 실제 CLI 실행에 둔다. 카탈로그는 다른 세션이 교차 검토해야 한다.

## 1. 결과

- 심각도별 발견: **높음 0 / 중간 1 / 낮음 3 / 정보 4**.
- 타입 수준: 검토의 합성 입력과 그 주변 33건이 모두 컴파일 오류로 막힌다. 줄마다 오류 이유를 확인했다(엉뚱한 오류로 통과한 것 없음). 타입이 막지 못하는 구멍 9건(GAP-1~9)은 실제로 컴파일됨을 확인했다. 이것들은 실행 시간 검사나 구현 의무에 맡겨져 있다.
- 실행: 계약 함수(`toSchemaFieldPath`, `toRunId`, 패턴 상수)와 실제 CLI(빌드 사본) 프로세스를 돌렸다. 설정 오류 경로 7건은 값 유출이 없다. 다만 **현재 main의 CLI는 아직 새 렌더러를 쓰지 않아 진행 줄에 task 파일의 검증기 id가 그대로 나온다**(중간 1).
- N-15 진단, N-16 `listRuns`, N-18 `latest` 처리는 main에 구현이 없어(`git grep listRuns src` 결과 없음, `--dry-run` 미지원) 실행으로 확인할 수 없었다. 계약 문구와 타입만 확인했다.

## 2. 발견

### 중간

#### R3-1. 현재 main의 진행 줄과 `report`가 task 파일의 검증기 id를 출력한다. N-14는 계약에만 있고 실행에는 아직 적용되지 않았다

- 위치: `src/cli/progress.ts:46`(`verifier ${safeToken(event.result.id)}`), `:35`(task id). `src/cli/report.ts:373`(`- \`${verifier.id}\` ...`).
- 재현(빌드 사본, scripted, 키 없음): 검증기 id를 `SYNTHETIC_PRIVATE_VALUE`로 둔 task(`.codaryn/r3/inputs/task-SYNTHETIC_PR.json`)로 `run --task`를 실행했다.
  - stderr: `codaryn: verifier SYNTHETIC_PRIVATE_VALUE: pass`.
  - `report --workspace ws --run <id>`: `` - `SYNTHETIC_PRIVATE_VALUE` (file_rules): **pass** ``.
  - 검토 H1의 예 `customer private memo SYNTHETIC`(공백 포함)는 진행 줄에서는 `safeToken` 덕분에 `?`가 된다. `report`에는 그대로 나온다.
- 근거: N-14는 "검증기 id는 문구에 넣지 않고 순번으로 표시"다. 계약(`HumanOutput.progressLine`)은 그렇게 정했지만 CLI는 기존 `progress.ts`를 쓴다. N-C 렌더러와 N-A 연결이 들어오기 전까지 이 경로는 막히지 않는다. `report`의 Markdown이 N-14 대상인지는 결정 문구로 알 수 없다.
- 영향: 검증기 id에 넣은 문구(파일의 값)가 지금 stderr와 report에 나온다. 계약 결함은 아니고 연결 전까지 남는 잔여 위험이다.
- 권고:
  - N-A 연결 때 이 입력을 통합 사례로 고정한다(진행 줄에 id 대신 `검증 1번`, stderr 전체에 `SYNTHETIC` 없음).
  - `report`에 N-14를 적용할지 PM이 정한다(순번 + id는 `--json`에만 남기는 안).
  - stdout JSON(`verifiers[].id`, `taskId`)은 기계 출력이라 그대로 두는 것이 계약이다(정보).

### 낮음

#### R3-2. "실행 목록 항목에는 키 모양이 들어갈 수 없다"는 계약 문구가 사실과 다르다

- 위치: `src/contracts/commands.ts:274-275`, `docs/cli-contract.md` 17절 N-16 항목("제어 문자나 키 모양이 들어갈 수 없다"). 관련 `src/contracts/human.ts:154`(RUN_ID), `src/contracts/task.ts:14`(TASK_ID_PATTERN_SOURCE).
- 재현(`.codaryn/r3/runtime-probe.ts`): `toRunId("sk-ant-" + 21자)`가 받아들여지고 그 값이 ANTHROPIC_KEY_PATTERN에 맞는다. `TASK_ID_PATTERN_SOURCE`도 같은 키 모양 문자열을 받는다. 두 패턴 모두 `[A-Za-z0-9._-]`로 키 모양을 포함한다. 제어 문자는 실제로 막힌다.
- 조건: 실행 중 허용된 명령이 상태 디렉터리에 그런 이름의 디렉터리를 만들거나 journal을 고친 경우(검토 M2의 전제). task 파일의 키 모양 값은 S-8 검사로 먼저 거부되므로 정상 경로로는 들어오지 않는다.
- 영향: `runs --json`(stdout)과 표의 runId 열에 키 모양 문자열이 그대로 나올 수 있다. 구현자가 계약 문구를 믿고 출력 정리를 생략할 수 있다. 기존 `report`는 키 모양을 가린다(`src/cli/text-safety.ts` hideKeys). 카탈로그는 메시지 안의 키 모양을 `[key]`로 바꾼다(R-3 실행: `Run id: [key]`).
- 권고: 키 모양 runId·taskId를 `damaged`로 보거나 출력 때 가리도록 계약에 적고, 문구를 "제어 문자는 들어갈 수 없다"로 고친다.

#### R3-3. 시각 확인이 없는 날짜를 통과시킨다

- 위치: `src/contracts/commands.ts:257`(RUN_TIMESTAMP_PATTERN_SOURCE)와 "a date `Date.parse` accepts".
- 재현: `2026-13-45T99:99:99Z`는 패턴은 통과하고 `Date.parse`가 NaN이라 손상으로 걸러진다. 그러나 `2026-02-30T00:00:00Z`는 둘 다 통과한다(`Date`가 2026-03-02로 넘긴다).
- 영향: 검토 M2의 "날짜가 실제 UTC 시각인지"를 일부만 충족한다. 문자열 정렬과 실제 시각이 어긋날 수 있다. 값 유출은 아니다.
- 권고: `new Date(s).toISOString()`이 s와 같은지(밀리초를 맞춘 뒤) 확인하는 왕복 검사를 계약에 적는다.

#### R3-4. 스키마 필드 이름 목록에 대본의 `usage` 하위 필드가 없다

- 위치: `src/contracts/human.ts:72-128`(SCHEMA_FIELD_NAMES). `src/contracts/model.ts`의 `ModelUsage.inputTokens`, `outputTokens`.
- 재현: `toSchemaFieldPath("steps[0].usage.inputTokens")`의 결과가 null이다.
- 영향: 대본 파일의 그 위치 오류에 필드 위치를 붙일 수 없다(진단의 field가 null로 떨어진다). 사용성만의 문제이고 유출은 없다.
- 권고: `inputTokens`, `outputTokens`를 목록에 더한다.

### 정보

#### R3-5. 타입이 막지 못하고 실행 시간 검사에 맡겨진 구멍(GAP-1~6)

`.codaryn/r3/types-probe.ts`에서 모두 컴파일됨을 확인했다.
- GAP-1, 2: id가 리터럴이 아닌 `MessageId`/`FixedMessageId`이면 매개변수 없이도, 다른 메시지의 매개변수 묶음으로도 호출된다. 자유 문자열은 여전히 거부된다(H1-x, H1-y).
- GAP-3: 변수로 넘긴 객체의 남는 속성은 타입이 잡지 않는다.
- GAP-4: `as SchemaFieldPath`, `as CatalogText`, `as RunId` 캐스트는 막을 수 없다.
- GAP-5: `toRunId`는 디렉터리 규칙만 보므로 `SYNTHETIC_PRIVATE_VALUE` 같은 이름도 RunId가 된다. 계약상 허용이다.
- GAP-6: line·column·count는 음수·NaN도 타입을 통과한다.

계약은 빠진·남는 매개변수를 실행 중에 던지라고만 정한다. 캐스트된 값을 카탈로그가 다시 검사하라는 요구는 없다. main의 카탈로그(N-B, 내 구현이므로 참고)는 이 경우 모두 던지거나 `?`로 바꾼다(`.codaryn/r3/out-runtime.txt`의 카탈로그 항목). 다른 카탈로그 구현도 같은 성질을 지키게 하려면 **"format은 값의 종류를 실행 중에 다시 확인하고 맞지 않으면 값을 내지 않는다"**를 계약 문구에 넣길 권한다.

#### R3-6. `CliErrorOutput.message`는 여전히 자유 문자열이다(GAP-7)

- 위치: `src/contracts/engine.ts:211`. 주석으로만 "secret·key·파일 내용 없음"을 요구한다.
- 사람용 출력은 이 문구를 보여 주지 않는다(`HumanOutput.error` 주석). stdout JSON에는 남는다.
- 현재 main 실행으로는 모르는 필드, 잘린 JSON, `"limits": ,` 문법 오류, 잘못된 값, `profiles` 이름, doctor 2건을 넣었다. 7건 모두 고정 문구만 나왔다(예: `config has an unknown field`, `the config file cannot be read as JSON`). `SYNTHETIC`이 들어간 줄은 0이었다.

#### R3-7. 확인된 항목의 문자열과 `revertedBefore.at`은 타입상 일반 문자열이다(GAP-8, 9)

`RunListEntry.checked.startedAt`·`taskId`(`commands.ts:282`, `:284`), `RevertOutput.revertedBefore.at`(`engine.ts:272`)는 위조된 값을 타입으로 구분하지 못한다. 확인은 `listRuns`와 revert 구현의 의무로 계약 주석에 적혀 있다. 구현이 아직 없어 실행으로 확인하지 못했다. N-C·N-A 구현 뒤 검토 M2의 합성 조건으로 다시 시험해야 한다. 조건은 첫 journal 기록의 runId를 다른 실행으로 바꾸거나, taskId·at에 `SYNTHETIC_PRIVATE_VALUE`를 넣는 것이다.

#### R3-8. N-15, N-16, N-18은 구현 전이라 실행 확인 불가

- N-15: 현재 설정 오류는 진단 없이 고정 문구다(R3-6). 줄·열 전달은 구현 뒤 확인한다.
- N-16: `listRuns`가 main에 없다.
- N-18: 현재 main에서 `.codaryn/runs/latest`를 만들고 실행했다.
  - `revert --run latest` → `run_not_found`(literal로 해석).
  - `report --run latest` → `run_not_found`.
  - `revert --dry-run` → `invalid_arguments`(옵션 미지원).
  - 계약의 `invalid_arguments`(별칭 충돌) 동작은 아직 없다.

## 3. 결정별 확인 표

| 결정 | 검토 항목 | 타입 수준 | 실행 |
| --- | --- | --- | --- |
| N-14 | H1 | 막힘: 24건(H1-a~y). 문자열 count, 사라진 error.detail, 코드·필드·text·runId 자리의 자유 문자열, RawText·MaskedText, 검증기 id, 프로필 이름, 펼친 위치(DefaultConfigLocation·InitOutput·RunSummaryContext), workspaceForm 경로, init 제안 밖 값, 남는·빠진 매개변수(리터럴) | 계약 함수: `toSchemaFieldPath`가 합성 값, 프로필 이름, 동형 문자, 0으로 시작하는 index, 200자 초과, `__proto__`를 거부한다. 현재 CLI 진행 줄은 아직 미적용(R3-1) |
| N-15 | M1 | 막힘: 4건. 진단 field 자유 문자열, 모르는 코드, message 필드 추가, suggestion 자유 문자열 | 구현 전. 현재 오류 문구 유출 없음 7/7(R3-6) |
| N-16 | M2 | 막힘: 3건. 손상 항목의 taskId·startedAt, runId 자유 문자열. 확인된 항목의 문자열은 타입 미보장(R3-7) | 패턴만 확인: 키 모양 통과(R3-2), 없는 날짜 통과(R3-3). listRuns 구현 전 |
| N-17 | M3 | 막힘: 2건. deniedToolCalls 누락, 문자열 | 구현 전 |
| N-18 | L1 | 계약 문구만 있다 | 구현 전. 현재는 literal(R3-8) |

## 4. 문제 없던 범위

- 계약 자체 시험 `tests/unit/contracts/n14-message-params.test.ts`의 `@ts-expect-error`는 typecheck에 포함되고, 내가 따로 만든 33건과도 결과가 같다.
- 메시지 id 집합에서 `error.detail`, `summary.profile`, 명령 줄 매개변수가 사라졌다. 명령 안내는 고정 문구다.
- `SchemaFieldPath`는 이름 목록과 10진 index만 받는다. 모르는 키는 그 키를 담은 객체 위치로만 가리키게 되어 있다.

## 5. 검사하지 않은 범위

- N-C 렌더러(`createHumanOutput`), N-A 연결, `listRuns`, init, `--profile`, `latest`. 모두 구현 전이다.
- Linux·macOS, PowerShell 5.1 표시, 실제 API.
- 카탈로그(N-B) 자체의 독립 검토. 내 구현이라 제외한다.

## 6. 재현 자료 (`.codaryn/r3/`, Git 추적 제외)

- `types-probe.ts`, `tsconfig.types.json`: `npx tsc -p .codaryn/r3/tsconfig.types.json` → 종료 0.
- `types-raw.ts`, `raw-errors.txt`, `expect-lines.txt`: 지시문을 뗀 사본에서 줄마다 오류 이유를 대조했다.
- `runtime-probe.ts`, `tsconfig.runtime.json`: `npx tsc -p .codaryn/r3/tsconfig.runtime.json` 뒤 `node .codaryn/r3/out/.codaryn/r3/runtime-probe.js`.
- `build/`(빌드 사본), `ws/`(작업 공간), `inputs/`(합성 설정·task·대본), `out-*.stdout|stderr|report`(실행 결과).
