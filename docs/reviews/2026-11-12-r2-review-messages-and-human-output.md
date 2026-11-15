# R-2 교차 검토 보고서: N-B 문구 카탈로그, N-C 사람용 출력·실행 목록

## 0. 이해 확인

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 읽기 전용이며 구현자가 아니다.
- worktree: `D:\project\Codaryn\.worktrees\claude-store`. 시작 때 main을 fast-forward로 병합했고(`f39593f`) 새 커밋은 없다. 저장소 파일 수정·커밋 없음.
- 대상
  - `claude/security-core`의 `src/i18n`(N-B)
  - `claude/core-tools`의 `src/cli/human`, `src/cli/runs.ts`, `src/store/runs.ts`, `src/store/changes.ts`(dry run)(N-C)
  - 기준 결정: `docs/work-orders/phase-4-usability.md`의 N-4~N-7, N-14~N-17. N-18도 함께 봤다.
- 검토 시점의 고정 커밋
  - N-B `5fbafbb`, N-C `5bc8db8`
  - 검토 중에 PM이 두 커밋을 main에 병합했다(`1ce3b69`의 둘째 부모 `5fbafbb`, `fe98536`의 둘째 부모 `5bc8db8`).
  - `git diff 5fbafbb main -- src/i18n`과 `git diff 5bc8db8 main -- src/cli/human src/cli/runs.ts src/store`가 비어 있으므로 **아래 발견은 지금 main에 그대로 해당한다.**
- 실험
  - `git archive`로 받은 빌드 사본(`.codaryn/r2/nb1`, `.codaryn/r2/nc1`)과 그 아래 작업 공간(`ws1`, `ws2`)에서만 했다.
  - 가짜 값만 썼다. 키 모양 문자열은 `sk-ant-` 뒤에 `FAKE` 반복이다.
  - 실제 API, 외부 네트워크, 키 파일은 쓰지 않았다.
- 빌드 사본 검사: 두 사본 모두 typecheck 통과. 유닛은 N-B 771건 중 770 통과·1 건너뜀, N-C 781건 중 780 통과·1 건너뜀.

심각도: 높음(지금 값이 새거나 사용자 파일을 잃음), 중간(재현되는 누출·오동작 경로, 결정 미충족), 낮음(오해를 부르는 문구, 우회가 어려운 빈틈), 정보.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 3 (M-1~M-3) |
| 낮음 | 5 (L-1~L-5) |
| 정보 | 6 (I-1~I-6) |

**잘 된 점(재현으로 확인)**
- 두 카탈로그
  - 155개 id가 모두 있다. 자리표시자가 계약과 정확히 맞는다.
  - 한국어 문장에 영어가 남은 것, 두 언어가 같은 문장인 것이 0건이다.
- 매개변수 검사
  - 형을 속여 넣은 값(키 모양 실행 id, 모르는 필드 이름, 다른 카탈로그의 글, 음수·거대 숫자, 모르는 코드)은 모두 `?`나 `[key]`가 된다.
  - 프로그래밍 오류 예외 문구에도 값이 없다.
- 렌더러는 적대적 기록에도 값을 내지 않는다(C1).
  - 모델이 쓴 도구 이름(키 모양, ESC 포함)과 검증기 id(키 모양)
  - 제어 문자가 든 경로
  - 잘못된 상태·이유 조합
- 그 밖
  - `missing_record` 경로는 `?`로 가린다.
  - `revert --dry-run`은 작업 공간과 상태 디렉터리를 바꾸지 않는다.
  - N-15의 JSON 위치 스캐너는 무작위 변형 20,000개에서 `JSON.parse`와 판정이 한 번도 다르지 않았다. CRLF, 한글 열, 200,000단 중첩에서도 맞았다.
  - N-18(`latest` 디렉터리가 있으면 오류)은 동작한다.

**문제**
- M-1 `runs --json`이 키 모양을 가리지 않는다.
- M-2 `latest`가 기록의 시각만 믿어, 위조된 미래 시각 실행을 고른다. 그 실행을 되돌리면 사용자 파일이 지워진다.
- M-3 N-15용 도우미 `fieldPath`가 모르는 키·맵 키 이름을 그대로 낸다(잠재).

## 2. 중간

### M-1 `codaryn runs --json`이 키 모양과 현재 키를 가리지 않는다 (N-16)

- 위치
  - `src/cli/runs.ts:162`: `--json`이면 `output`을 그대로 돌려준다.
  - `:163`: 글 출력에만 `hideKeys(…, ANTHROPIC_API_KEY)`를 쓴다.
  - 비교: `report`는 JSON과 글 모두 `hideKeys`를 지난다(`src/cli/report.ts:518-524`).
- N-16은 "report와 같은 수준… 출력 문자열은 제어 문자와 키 모양을 정리한다"이다. 실행 목록의 문자열(`runId`, `taskId`)은 디렉터리 이름과 기록에서 온다.
  - `toRunId`는 `[A-Za-z0-9._-]{1,128}`만 보므로 키 모양을 받는다(`src/contracts/human.ts:154-159`).
- 재현(`.codaryn/r2/exp.mjs` E3, E4)
  1. `ws1/workspace/.codaryn/runs/` 아래에 키 모양 이름의 빈 디렉터리를 만든다.
  2. `runRuns(["runs","--workspace",ws,"--json"])`의 JSON에 그 이름이 그대로 있다(`true`).
  3. 같은 목록의 글 출력에는 `[key]`로 나온다(`false`).
- 그 디렉터리는 실행 중 허용된 명령이나 다른 프로세스가 만들 수 있다. 상태 디렉터리는 파일 도구에만 닫혀 있다.
- 권고: JSON에도 `report`처럼 `hideKeys`를 적용한다. 키 모양 이름을 가진 디렉터리는 `damaged`로 두고 id를 `?`로 내는 방법도 있다.

### M-2 `--run latest`가 기록 속 시각만 믿는다. 위조된 미래 시각 실행이 선택되고, 되돌리면 사용자 파일이 지워진다 (N-7, N-16)

- 위치
  - `src/store/runs.ts:140-163`: 첫 기록에서 `at`의 형식만 본다.
  - `:233-238`: 시작 시각 내림차순으로 정렬한다.
  - `:289-293`: `latest` = 처음 나오는 `checked`
  - `src/cli/runs.ts:112-127`: `resolveRunRef`
- 확인하는 것: `runId` 일치, `seq` 1, `run_started`, 제공자, 작업 id, 시각 형식.
- 확인하지 않는 것
  - 실행 id에 들어 있는 시작 시각(`<UTC>-<hex>`, P-3)과 `at`이 맞는지
  - `at`이 현재보다 미래인지
  - `result.json`이 없는 실행도 `checked`(결과 없음)이므로 `latest`가 될 수 있다. 첫 줄 하나만 있으면 된다.
- 재현(`.codaryn/r2/forge.mjs`, 작업 공간 `ws2`, N-C 빌드본 CLI)
  1. 체험 예시로 정상 실행 하나를 만든다.
  2. `runs/20991231T235959Z-deadbeef/`에 두 줄 기록(`run_started`, `at` 2099년; `file_changed` `notes.md`, `created: true`, `newHash` = 현재 `notes.md` 해시)과 `snapshots/index.json`(`notes.md` `existed: false`)을 쓴다.
  3. `resolveRunRef(ws, "latest")` → `20991231T235959Z-deadbeef`
  4. `node nc1/dist/src/cli/main.js revert --workspace ws2/workspace --run 20991231T235959Z-deadbeef` → `complete`, `reverted: [{path:"notes.md", action:"deleted"}]`. 사용자 원본 `notes.md`가 지워졌다.
  5. `--run latest` 연결(N-A)이 들어가면 4는 `revert --run latest` 한 번이 된다. 사용자는 실행 id를 보지 않는다.
- 선행 조건은 "누군가 상태 디렉터리에 썼다"이다. 허용된 명령이 할 수 있다(사용 안내 10절의 report 한계와 같다).
  - 명시한 id의 되돌리기에서는 지금도 같은 일이 생긴다.
  - `latest`는 사람이 고르지 않은 실행을 자동으로 고른다. 그래서 위험이 커진다.
- 권고
  - 실행 id의 시각 부분과 `at`이 같은 초인지 확인하고, 미래 시각이면 `damaged`로 둔다.
  - `revert --run latest`는 고른 실행 id와 시작 시각을 먼저 보이거나, `--dry-run`을 거치게 한다.
  - `result.json`이 없는 실행은 `latest` 후보에서 빼는 방안도 검토한다.

### M-3 `fieldPath`가 모르는 키와 맵 키 이름을 그대로 낸다 (N-14, N-15, 잠재)

- 위치
  - `src/cli/human/fields.ts:17-22`: `isFieldName` = `/^[A-Za-z_$][A-Za-z0-9_$-]{0,63}$/`. 식별자 모양만 보고, `SCHEMA_FIELD_NAMES`와 대조하지 않는다.
  - `:25-36`: `fieldPath`
  - 머리 주석(`:2-6`)은 "positions are built from names the validator knows (anything else shows as "?")"라고 하지만 동작은 다르다.
- 재현(exp.mjs D1)
  - `fieldPath(["profiles","hunter2-secret","limits","maxModelTurns"])` → `profiles.hunter2-secret.limits.maxModelTurns`
  - `fieldPath(["limits","hunter2Password"])` → `limits.hunter2Password`
  - 같은 글을 `toSchemaFieldPath`에 넣으면 `null`이다.
- 지금 영향
  - 지금은 호출하는 곳이 없다(두 브랜치 `grep`).
  - 사람용 stderr는 `toSchemaFieldPath`로 다시 거르므로 안전하다(C3).
- 위험
  - N-A가 N-15 진단과 영어 `message`(stdout JSON)를 만들 때 이 도우미를 쓰면, 프로필 이름이나 모르는 키 이름(N-14·N-15가 막은 것)이 JSON에 나간다.
- 권고: `fieldPath`가 이름 조각을 `SCHEMA_FIELD_NAMES`로 검사하게 하거나, 호출자가 `toSchemaFieldPath` 결과만 쓰도록 형을 좁힌다. N-A에 이 점을 알린다.

## 3. 낮음

### L-1 실행 끝 요약의 "바뀐 파일 N개"가 파일이 아니라 변경 기록 수다 (N-5)

- 위치: `src/cli/human/output.ts:190`(`changes.length`), `:200-203`(기록마다 한 줄)
- 재현(`.codaryn/r2/real.mjs`, 체험 예시의 실제 결과)
  - `바뀐 파일: 2개` / `Files changed: 2`
  - 목록에 `summary.md (파일 만듦)`과 `summary.md (파일 바꿈)`이 두 줄로 나온다. 실제로 바뀐 파일은 1개다.
- 권고: 서로 다른 경로 수를 세고 경로마다 한 줄로 쓴다. 또는 문구를 "변경 2건"으로 바꾼다.

### L-2 거부 안내가 늘 "설정의 policy.commands"를 가리킨다 (N-17)

- 위치: `output.ts:206`. `summary.denied_hint`는 거부가 하나라도 있으면 나온다.
- 어긋나는 경우
  - task 파일 형식은 설정의 정책이 아니라 task의 `policy`를 쓴다(`src/contracts/config.ts:32`).
  - 거부가 명령이 아닐 수도 있다(경로, 보호 경로, 모르는 도구).
- 재현(real.mjs): task 파일 실행인 체험 예시에 "명령을 허용하려면 설정의 policy.commands에 규칙을 더하세요"가 나온다.
- 권고: `workspaceForm`이 `task`면 "task 파일의 policy.commands"로 쓴다. 명령 거부(`permission: command`)가 있을 때만 이 안내를 낸다. 계약의 매개변수 추가가 필요하면 N-A다.

### L-3 진단 위치가 파일 루트로 바뀌어도 원래 위치의 제안이 붙는다 (N-15)

- 위치: `output.ts:123-139`. `field`가 SchemaFieldPath가 아니면 파일 루트로 내려가는데, `suggestion`은 그대로 쓴다.
- 재현(exp.mjs C3)
  - 진단 `{field: "profiles.hunter2", suggestion: "limits"}`
  - 출력: "설정 파일: config에 모르는 필드가 있습니다. 가까운 이름: limits" / "config has an unknown field. Did you mean limits?"
  - 루트에 `limits`가 이미 있으므로 틀린 안내다.
- 권고: 위치가 내려갔으면 제안을 버린다.

### L-4 손상된 `revert.json` 하나로 정상 실행 전체가 "손상"이 된다

- 위치: `src/store/runs.ts:217-220`. 되돌리기 기록을 못 읽으면 실행 전체가 `damaged`다.
- 재현(exp.mjs E1 `revbad00`)
  - 기록과 결과는 정상인데 `revert.json`이 `{not json`인 실행이 `damaged`로 나온다.
  - 상태가 보이지 않고 `latest`에서도 빠진다.
- N-22에 따라 `revert`는 `readRevertRecord`를 부른다. 이 함수는 손상된 기록에서 예외를 낸다(`:299-305`). N-A의 연결이 이 예외를 오류로 끝내면, 기록 파일 하나 때문에 그 실행을 되돌릴 수 없게 된다 [추정, 연결 전].
- 권고: 목록에는 "되돌리기 기록 손상"을 따로 표시한다. `revert`는 그 기록 없이(`revertedBefore` 없이) 진행하게 한다.

### L-5 제어 문자로 끊긴 키 모양은 가려지지 않는다

- 위치: `src/cli/human/format.ts:24-26`(`finalLine` = `hideKeys(cleanText(…))`), `:12-15`(`shownPath`). 제어 문자를 `?`로 바꾼 뒤에 키 모양을 찾는다.
- 재현
  - 경로 `sk-ant-AB<BEL>CDEF…(30자)` → `created sk-ant-AB?CDEFGHIJKLMNOPQRSTUVWXYZ012345`
  - 같은 길이의 끊기지 않은 키 모양은 `created [key]`
- `report`도 같은 순서라 같은 빈틈이 있다 [추정, report.ts 미재현].
- 가려지지 않은 키 모양 문자열이 경로에 있어야 하므로(등록된 비밀과 현재 키는 이미 토큰) 실제 위험은 낮다.
- 권고: 키 모양을 먼저 가리고 제어 문자를 바꾸거나, 키 검사에서 제어 문자를 건너뛴다.

## 4. 정보

- **I-1 두 언어 누락 없음**(exp.mjs A, real.mjs)
  - `MESSAGE_IDS` 155개 모두 두 카탈로그에 있다. 자리표시자 불일치 0, 남는 키 0, 한글 없는 한국어 문장 0, 두 언어가 같은 문장 0.
  - 실제 실행 기록 22줄을 두 언어로 그려 `?`가 0건이었다.
  - 오류 코드 전체의 `error()`도 두 언어에서 예외 없이 그려졌다.
- **I-2 카탈로그 밖에 남는 영어**
  - N-21로 `doctor`와 `--help`가 카탈로그에 들어온다.
  - `report`의 Markdown과 `models`의 표는 여전히 영어다. N-4의 "사람용 메시지" 범위에 넣을지 PM이 정한다.
- **I-3 한국어 되돌리기 제목의 배치**
  - "되돌린 파일 0개: (partial)", "되돌릴 파일 1개(미리보기, 아무것도 바꾸지 않음): (complete)"
  - 템플릿 끝의 `:` 뒤에 렌더러가 상태를 붙인다. 미리보기에 `complete`가 나오는 것도 어색하다.
- **I-4 실행 id 매개변수는 모양만 본다**(exp.mjs B1)
  - 등록 비밀처럼 생긴 디렉터리 이름(키 모양 아님)은 `runs` 글에 그대로 나온다.
  - `runs`에는 개인정보 게이트가 없다. 정상 실행 id는 생성 규칙을 따르므로 이름이 비밀일 일은 위조뿐이다.
- **I-5 문제 없던 범위**
  - N-15 스캐너: 무작위 변형 20,000개에서 `JSON.parse`와 불일치 0. CRLF와 한글(3줄 8열), 200,000단 `[`도 맞았다.
  - 그 밖에 확인한 것
    - 정션으로 바꾼 실행 디렉터리는 `damaged`다.
    - 결과가 다른 실행의 것이거나, 상태·이유 조합이 틀리거나, 첫 줄이 64 KiB를 넘으면 `damaged`다.
    - `missing_record` 경로는 `?`다.
    - 형을 속여 넣은 매개변수 9종은 모두 `?`나 `[key]`다.
    - `--quiet` 쓰기기는 아무것도 쓰지 않는다.
- **I-6 검토 중 브랜치 상태**
  - 검토 시작 때(11:17~11:21) 두 브랜치의 머리는 계약 `397413a`를 병합만 하고 구현을 맞추기 전이었다. typecheck 오류가 N-B 37건, N-C 22건이었다.
  - 이후 커밋(`775c235`, `5fbafbb`, `53b9236`, `5bc8db8`)이 이를 고쳤고, 병합된 것은 그 커밋이다. 기록용이다.

## 5. 검사하지 않은 범위

- N-17 거부 수 세기, `--run latest` 연결, 사람용 오류의 실제 출력(stderr)은 N-A 연결 전이라 CLI 프로세스로 보지 않았다. 모듈을 직접 불렀다.
- `selectMessageLanguage`의 실제 OS 표시 언어(Intl) 판정. Windows 한국어 표시 언어 환경은 바꾸지 않았다.
- `.codaryn` 자체가 정션인 경우, 파일 심볼릭 링크(Windows 권한 필요)
- 화면 낭독기, 좁은 터미널
- 실제 API

## 6. PM 판단 필요

- **P-1(M-2)**: `latest`를 고를 때 실행 id 시각과 `at` 대조, 미래 시각 거부, 결과 없는 실행 제외를 N-16에 더할지. `revert --run latest`에서 고른 실행을 먼저 보일지.
- **P-2(M-1)**: `runs --json`에도 `hideKeys`를 적용할지(`report`와 같게).
- **P-3(M-3)**: `fieldPath`를 스키마 이름 목록으로 좁힐지. N-A의 N-15 연결 전에 알려야 한다.
- **P-4(L-4)**: 손상된 되돌리기 기록을 실행 전체 손상으로 볼지, 따로 표시할지.

사용자에게 물을 질문은 없다.

## 7. 실행한 것

- 읽기: `git show`/`git diff main...<branch>`. 고정 커밋 `5fbafbb`, `5bc8db8`의 `src/contracts/human.ts`, `src/i18n/*`, `src/cli/human/*`, `src/cli/runs.ts`, `src/store/runs.ts`, `src/store/changes.ts`의 변경분
- 빌드: `git archive` 사본을 worktree의 TypeScript로 컴파일했다(`.codaryn/r2/{nb1,nc1}`)
- 시험: 두 사본의 유닛 전체
- 실험 스크립트: `.codaryn/r2/exp.mjs`, `real.mjs`, `fuzz.mjs`, `forge.mjs`. 출력은 `.codaryn/r2/exp.out`.
- 저장소 파일 변경과 커밋 없음. 실제 API 미실행.
