# R-7 검토: N-23 (a)~(h), N-24 (c), N-25 (b), N-26 (읽기 전용)

## 0. 이해 확인

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 구현자가 아닌 세션의 교차 검토다(개발 절차 9절).
- worktree: `D:\project\Codaryn\.worktrees\claude-gui`(내 작업 브랜치 `claude/gui-design`). 이 검토로는 저장소 파일을 고치지 않고 커밋하지 않는다.
  - 실험은 `.codaryn/r7/` 안에서만, 빌드 사본(`git archive`)으로 한다.
  - 실제 API, 외부 네트워크, 키 파일은 쓰지 않는다. 가짜 값만 쓴다.
  - 작업 디렉터리 밖은 읽지 않는다. 시험용 임시 폴더는 `.codaryn/r7/` 아래에 만든다.
- 대상: `claude/core-tools` `2a94a44`(2026-11-12 12:08:50 +0900, "feat(store): keep a person's review verdict in review.json")에 있는 다음 수정.
  - N-23 (a)~(h), N-24 (c), N-25 (b), N-26.
- 대조 기준
  - 결정: `docs/work-orders/phase-4-usability.md`(N-23~N-26), `docs/work-orders/phase-4-5-design.md`(DR-19).
  - 재현 입력: 검토 원문 R-2 `docs/reviews/2026-11-12-r2-review-messages-and-human-output.md`.
- 중점
  1. 2099년 위조 실행이 `latest`와 명시 id 모두에서 막히는지
  2. 10분 허용(DR-19)의 경계
  3. 옛 형식 잠금의 호환
  4. pid 재사용 상황의 죽은 잠금 회수
  5. 실행 목록 JSON의 키 가림
- 보고: 이 파일. 심각도별 발견, 파일:줄, 깨지는 입력과 결과, 재현 방법, 문제 없던 범위, 검사하지 않은 범위. 대화에는 건수 두 줄.

## 1. 요약

- 검토한 커밋: `2a94a44`. 검토 중에 브랜치가 `6d3943d`로 3커밋 나아갔다(G-E 적용 실행). 5절에 적었다.
- 건수: 높음 0, 중간 1, 낮음 3, 정보 2.
- 중점 5개 중 4개는 실제 입력으로 기대대로 동작했다(2절 문제 없던 범위).
- 깨진 곳
  - 중점 1의 명시 id: 대소문자를 구분하지 않는 볼륨에서 실행 id의 대소문자만 바꾸면 N-26 거부를 지나간다. 위조 실행이 사용자 파일을 지웠다(M-1).
  - N-25 (b)의 Linux 경로: 벽시계가 5초 넘게 바뀌면 살아 있는 잠금을 죽었다고 본다(L-1, 읽어서 판단, 재현 못 함).
  - `report --json`은 제어 문자로 끊긴 키 모양을 가리지 않는다. `runs --json`은 가린다(L-2).
  - 메시지 목록이 계약보다 뒤져 있다. 그래서 `runs` 글 출력이 `internal_error`로 끝나고, `workspace_locked`의 사람용 안내가 비어 나온다(L-3, N-B 병합 순서 조건).
- 브랜치의 store·cli 유닛: 365개 중 통과 365, 실패 0.

## 2. 중간

### M-1 대소문자만 바꾼 실행 id로 손상 실행을 되돌릴 수 있다. N-26 거부를 지나 사용자 파일이 지워진다

- 위치
  - `src/cli/assemble.ts:120-123` `damagedByListing`: 실행 목록에서 `entry.runId === runId`인 항목이 `damaged`인지만 본다. 문자열 비교는 대소문자를 구분한다.
  - `src/cli/assemble.ts:192-193`: `isDamaged`가 없으면 `damagedByListing`을 쓴다.
  - `src/cli/main.ts:172-179`: `createRevertCommand`에 `isDamaged`를 넘기지 않는다. store의 `inspectRun`(`src/store/runs.ts:351`)은 아직 연결되지 않았다(assemble.ts 주석 "until the store's own function is passed").
  - 그다음 `revertRun`은 `.codaryn/runs/<요청한 id>`를 연다. Windows(NTFS)와 macOS(APFS 기본)에서는 대소문자가 다른 디렉터리가 열린다. 기록 속 `runId`가 요청한 id와 같으면 그대로 되돌린다.
- 깨지는 입력(`exp/case.mjs`, 작업 공간 `wK-0`, `wK-1`, 빌드본 CLI)
  1. 체험 예시로 정상 실행 하나를 만든 작업 공간 사본을 쓴다.
  2. 디렉터리 `runs/20991231T235957Z-0c0ffee0/`에 R-2 M-2와 같은 두 줄 기록과 `snapshots/index.json`을 쓴다(`notes.md` `created: true`, `existed: false`). 단, 기록의 `runId`는 소문자 `20991231t235957z-0c0ffee0`이다.
  3. `codaryn runs --json` → 대문자 id가 `damaged`. 소문자 id는 목록에 없다.
  4. `revert --run 20991231T235957Z-0c0ffee0 --dry-run` → `invalid_run_record`(N-26대로).
  5. `revert --run 20991231t235957z-0c0ffee0 --dry-run` → `complete`, `reverted: [{path:"notes.md", action:"deleted"}]`
  6. 같은 명령을 `--dry-run` 없이 실행 → `complete`, exit 0. 사용자 원본 `notes.md`가 지워졌다.
  7. 과거 시각(`20261111T000000Z-0c0ffee1`)으로도 같다. 되돌리기 경로에는 시각 검사(DR-19)도 없다.
- 같은 변형에 `inspectRun`을 부르면 모두 `damaged`다(`exp/inspect.out`). `CLI_RUN_ID`(`src/store/runs.ts:52`)가 대문자 `T`·`Z`와 소문자 16진수만 받기 때문이다.
  - 함께 시험한 것: 끝에 점을 붙인 id는 `run_not_found`로 끝났다. Node가 `\\?\` 경로를 쓰므로 점이 지워지지 않는다.
  - 기록이 원래 id를 담은 경우, 대소문자만 바꾼 요청은 `invalid_run_record`("journal cannot be read")로 끝났다.
- 선행 조건과 영향
  - 상태 디렉터리에 쓸 수 있어야 한다. R-2 M-2와 같다(허용된 명령이 할 수 있다).
  - 사용자가 Codaryn이 보여 주지 않는 id를 직접 입력해야 한다. 목록에는 대문자 id만 "손상"으로 나온다. 작업 공간 안 문서나 메시지로 그 명령을 따라 하게 하는 식이다.
  - N-26의 목적("위조된 기록으로 사용자 파일이 지워지는 경로를 명시 id에서도 막는다")이 이 경로에서는 지켜지지 않는다. 그래서 중간으로 둔다. 선행 조건을 더 무겁게 보면 낮음으로 내릴 수 있다.
- 권고
  - `main.ts`에서 `isDamaged: async (root, id) => (await inspectRun(root, id)) === "damaged"`를 넘긴다(연결 N-A). 같은 판정을 쓰는 `--dry-run`에도 적용된다.
  - 방어를 한 겹 더 두려면 store의 되돌리기가 `readdir`로 디렉터리 이름이 요청한 id와 정확히 같은지 확인한다.
  - 회귀 시험: `inspectRun`에 대소문자 변형 id를 넣으면 `damaged`가 나온다. 대소문자를 구분하지 않는 볼륨에서는 CLI로 위 1~6을 고정한다. Linux CI라면 판정 함수를 주입하는 시험으로 대신한다.

## 3. 낮음

### L-1 Linux에서 벽시계가 5초 넘게 바뀌면 살아 있는 잠금 주인을 죽었다고 보고 회수한다 (N-25 (b))

- 위치
  - `src/store/lock.ts:337`: 잠금에 적는 시작 시각은 `performance.timeOrigin`(시작할 때의 벽시계)이다.
  - `:179-184`: Windows가 아닌 곳에서는 `asked - elapsed * 1000`(지금 벽시계 − `ps -o etime=`)으로 시작 시각을 구한다.
  - `:320`: 두 값의 차가 5초를 넘으면 다른 프로세스로 보고 회수한다.
- 원인: Linux procps의 `etime`은 부팅 후 경과 시간(`/proc/uptime`)으로 센다. 벽시계와 다르게 흐른다. 실행 중에 벽시계가 Δ만큼 옮겨지면 계산한 시작 시각도 Δ만큼 옮겨진다(NTP 계단 보정, 수동 변경, VM 재개 뒤 맞춤). Δ가 5초를 넘으면 다른 Codaryn이 그 잠금을 죽은 것으로 보고 회수한다. 같은 작업 공간에서 두 실행이 함께 돈다.
- Windows는 `Get-Process`의 `StartTime`(커널 생성 시각)을 쓰므로 영향이 없다. macOS의 `ps`는 확인하지 않았다.
- 재현: 못 했다(Windows 호스트). 판정: 그럴 법함(PLAUSIBLE), 코드를 읽어서 내렸다.
- 권고
  - Linux에서는 `/proc/<pid>/stat`의 22번째 필드(부팅 후 시작 틱)를 잠금에 그대로 적고 정확히 같은지 비교한다. 재부팅을 가르려면 `/proc/sys/kernel/random/boot_id`를 함께 적는다. 이 값은 벽시계와 무관하다.
  - 이 방식을 못 쓰는 곳은 지금처럼 pid만으로 판정한다.
  - architecture A-6의 알려진 한계에 "벽시계 변경"을 한 줄 더한다.

### L-2 `report --json`은 제어 문자로 끊긴 키 모양을 가리지 않는다 (R-2 L-5의 JSON 쪽 잔여, N-23 (a)·(h))

- 위치: `src/cli/report.ts:570`, `:576`. JSON을 문자열로 만든 뒤에 `hideKeys`를 쓴다. JSON 안에서 BEL은 6글자 `\u0007`이 되므로, 제어 문자를 건너뛰는 키 검사가 이를 끊긴 키로 보지 못한다.
  - 비교: `runs --json`은 문자열로 만들기 전에 값마다 `hideKeys`를 쓴다(`src/cli/runs.ts:165`, `hideKeysInStrings`). 그래서 이제는 `runs`가 `report`보다 더 가린다.
- 깨지는 입력(`exp/human.mjs` `wH`, `exp/h2.out`)
  - 기록의 `file_changed.path`를 `sk-ant-AB<BEL>CDEFGHIJKLMNOPQRSTUVWXYZ012345`(가짜 모양)로 바꾼다.
  - `report --run <id>`(글) → 가려진다.
  - `report --run <id> --json` → `"sk-ant-AB\u0007CDEFGH…"`가 그대로 있다.
  - 모듈 확인: `hideKeys(디코드한 문자열)` → `[key]`, `hideKeys(JSON 글)` → 그대로.
- 영향: JSON을 읽고 제어 문자를 지우는 소비자(GUI 등)는 키 모양 전체를 보인다. 기록에 가려지지 않은 키 모양이 있어야 하므로 R-2 L-5처럼 실제 위험은 낮다.
- 권고: `report`도 `runs`처럼 객체의 문자열마다 키를 가린 뒤 JSON으로 만든다(N-A). 회귀 시험은 위 입력이다.

### L-3 메시지 목록이 계약보다 뒤져 있다. `runs` 글 출력이 `internal_error`로 끝나고 `workspace_locked` 안내가 비어 나온다 (N-23 (g), 병합 순서 조건)

- 위치
  - `src/cli/human/output.ts:378`: `runs.revert_record_damaged`를 쓴다.
  - `src/cli/main.ts:121`: `lock.remove_hint`를 쓴다.
  - 두 id는 계약(`src/contracts/human.ts:367`, `:486`)에는 있다. `src/i18n/ko.ts`·`en.ts`에는 없다. 계약의 고정 메시지 중 30개가 두 언어 모두에서 빠져 있다(`exp/catalog.out`). 예: `doctor.config_file.*`, `doctor.lock.*`, `doctor.language.from_*`.
  - 지금의 tsc 오류 2개(남는 키 `doctor.file.unreadable`)가 이 누락 오류를 가린다. 객체 리터럴의 남는 속성 오류가 먼저 나기 때문이다.
- 깨지는 입력
  - `revert.json`이 `{not json`인 실행이 있는 작업 공간(`wG`)에서 `codaryn runs`(글) → `internal_error`, exit 70(`exp/g-text.out`). 같은 목록의 `--json`은 exit 0이고 `revertRecordDamaged: true`를 낸다.
  - 결과적으로 N-23 (g)의 "목록에 따로 표시"가 글 출력에서는 목록 전체 실패가 된다. 손상된 `revert.json` 하나로 R-2 L-4와 비슷한 결과가 다시 생긴다.
  - 살아 있는 잠금으로 `codaryn run` → stdout JSON은 `workspace_locked`(exit 6)인데 stderr가 비었다. `explainError`(`src/cli/main.ts:114-126`)가 힌트 하나의 형식화 실패를 잡으면서 설명 전체를 버리기 때문이다. N-25 (a)의 범위라 이 검토의 대상은 아니다.
- 원인은 core-tools 코드가 아니라 N-B 메시지 목록의 미병합이다. 이미 알려진 tsc 오류와 같은 뿌리다. core-tools를 N-B보다 먼저 main에 넣으면 위 두 증상이 main에 생긴다.
- 권고
  - core-tools를 N-B 메시지 목록과 함께 또는 그 뒤에 병합한다.
  - 실제 메시지 목록으로 `runsText`(`revertRecordDamaged`)와 `workspace_locked` 오류를 그리는 시험을 둔다. 지금의 `real-catalog` 시험은 이 둘을 지나지 않는다.
  - `explainError`는 힌트를 못 만들어도 본문은 내도록 하는 편이 낫다.

## 4. 정보

### I-1 시계가 앞서 있다가 뒤로 맞춰지면 방금 한 실행이 "손상"이 되고 `latest`는 그 전 실행을 고른다 (DR-19의 결과)

- 위치: `src/store/runs.ts:253` `started > now`
- 재현(`exp/runs.mjs` B): id와 첫 기록이 60초 뒤인 실행, id는 과거인데 첫 기록이 120초 뒤인 실행 → 둘 다 `damaged`
- 이 상태에서 `revert --run latest`는 그 전 실행을 고른다. 명시 id 되돌리기는 `invalid_run_record`다. 목록의 사유는 "기록을 확인할 수 없음"뿐이라 미래 시각 때문인지 알 수 없다.
- 고른 실행을 먼저 보이고(N-23 (b) 확인함), 되돌리기는 이후 바뀐 파일을 건너뛰므로 피해는 제한된다. 결정대로의 동작이다. 미래 시각에 몇 분의 여유를 두거나 사유를 따로 보이는 방안은 PM 판단이다.

### I-2 `report`는 목록이 "손상"으로 본 실행도 정상 보고서로 보인다

- 재현(`exp/runs.mjs` A): `report --run 20991231T235959Z-deadbeef --json` → exit 0, `status: "complete"`. 위조 실행의 내용이 경고 없이 보고서로 나온다.
- N-26은 되돌리기만 다룬다. `report`는 읽기만 하므로 정보로 둔다. 보고서에 "목록 검사 실패"를 표시할지는 PM 판단이다.

## 5. 문제 없던 범위

모두 `2a94a44` 빌드본(`.codaryn/r7/ct`, `tsc` 산출. 알려진 i18n tsc 오류 2개 있음)과 실제 프로세스·파일로 확인했다. 출력 원문은 `.codaryn/r7/exp/*.out`에 있다.

- 중점 1, 2099년 위조 실행(`exp/runs.mjs` A)
  - R-2 M-2의 두 줄 기록 그대로인 것과 정상 실행을 통째로 복사해 시각만 2099년으로 바꾼 것 모두 `damaged`이고 `latest`가 되지 않는다.
  - 원래 id로 `revert`(`--dry-run` 있음·없음) → `invalid_run_record`, exit 2. `notes.md`의 해시가 그대로다.
  - `revert --run latest --dry-run`과 `report --run latest`는 정상 실행을 골랐다. stderr 첫 줄에 "가장 최근 실행을 골랐습니다: <id> (시작 …)"이 나온다(N-23 (b)).
  - 실행 디렉터리를 정션으로 바꾸면 `invalid_run_record`다(N-26).
- 중점 2, DR-19 경계(`exp/runs.mjs` B, id 초 `T`)
  - `T`, `T+999ms`, `T+599 999ms`는 `checked`, `T+600 000ms`와 `T−1ms`는 `damaged`
  - 미래 시각 두 경우는 `damaged`(I-1)
  - 되돌리기: `+600 000ms`는 거부, `+599 999ms`는 진행(`--dry-run`)
- 중점 3, 옛 형식 잠금(`exp/lock.mjs`, 실제 프로세스, 주입 없음)
  - `{pid, runId, startedAt}`에 살아 있는 pid → `workspace_locked`. 시작 시각은 묻지 않았다(7 ms).
  - 죽은 pid → 회수하고 새 형식(`processStartedAt` 포함)으로 쓴다.
  - CLI: 살아 있는 옛 잠금이면 exit 6, 죽은 옛 잠금이면 실행이 끝까지 돈다.
- 중점 4, pid 재사용(`exp/lock.mjs`)
  - 살아 있는 다른 Node 프로세스의 pid를 쓰고 기록된 시작 시각만 다르게 했다.
    - 60초 차 → 회수
    - ±6초 → 회수
    - −4초 → 유지
    - 같은 시각 → 유지
  - `Get-Process` 시작 시각과 그 프로세스의 `timeOrigin` 차는 −14.6 ms였다. 질의 시간은 186~217 ms다.
  - 이 프로세스의 pid인데 시작 시각이 다른 잠금(같은 pid를 썼던 이전 프로세스가 남긴 것) → 회수. 시작 시각이 같으면 유지한다.
  - 시작 시각을 읽을 수 없는 pid 4(System) → pid만으로 판정해 유지한다.
  - `processStartedAt`이 실제 날짜가 아니면(`2026-02-30…`) 이해할 수 없는 잠금으로 보아 회수하지 않는다(`holder: null`).
- 중점 5, 실행 목록 JSON의 키 가림(`exp/runs.mjs` C)
  - 키 모양 이름의 빈 디렉터리, 키 모양 작업 id, 현재 키(가짜 값을 환경 변수에 둠)를 작업 id로 쓴 실행을 만들었다. `runs --json`과 글 출력 모두 원문이 없고, `[key]`가 3번 나온다.
  - 제어 문자로 끊긴 키 모양: 작업 id에 넣으면 `TASK_ID` 형식 검사로 실행이 손상이 되어 거기까지 가지 않는다. `hideKeys` 모듈은 디코드한 문자열에서 그것을 가린다.
- N-23 (c): R-2 M-3 입력 → `profiles.?.limits.maxModelTurns`, `limits.?`. 실제 설정 파일의 프로필 이름은 출력 어디에도 없다(`profiles[0]`로 나온다).
- N-23 (d): 깨끗한 체험 예시 → "바뀐 파일: 1개 / summary.md (파일 만듦)", 영어도 같다. 변경 기록은 2건이다.
- N-23 (e)(`exp/e.out`)
  - 경로 거부만 있으면 안내가 없다.
  - 명령 거부가 있으면 task 실행은 "task 파일의 policy.commands", 설정 실행은 "설정의 policy.commands"를 가리킨다. 한국어와 영어 모두 같다.
- N-23 (f)(`exp/f.out`): R-2 L-3 입력 `{field:"profiles.hunter2", suggestion:"limits"}` → 제안 없이 "config에 모르는 필드가 있습니다(이름은 표시하지 않습니다)". 제자리 제안은 유지된다(실제 실행에서 `profiles[0].limits`).
- N-23 (g): 손상된 `revert.json` → JSON에서 `checked`와 `revertRecordDamaged: true`. `revert --dry-run`은 진행한다. 글 출력은 L-3.
- N-23 (h): R-2 L-5 입력 → `shownPath`·`finalLine` 모두 `[key]`. `report` 글도 가린다. JSON은 L-2.
- N-24 (c): `…53.373Z`, `…53Z`, `…53.37Z`는 참이다. `2026-02-30`, `T24:00`, `+002026-…`는 거짓이다.
- 브랜치 유닛: `node --test dist/tests/unit/store/*.test.js dist/tests/unit/cli/*.test.js dist/tests/unit/cli/human/*.test.js` → 365개, 통과 365, 실패 0.
- G-5(TypeScript 7의 U+2028 정규식 함정): 검토한 원본(`src/store/runs.ts`, `lock.ts`, `src/cli/runs.ts`, `report.ts`, `text-safety.ts`, `assemble.ts`, `main.ts`, `src/cli/human/*.ts`)에 ` ` 이스케이프가 없다. 산출물(`dist/src/cli`, `dist/src/store`)에도 U+2028 원문자가 없다. 컴파일러는 TypeScript 7.0.2다.

## 6. 검사하지 않은 범위

- Linux·macOS의 `ps` 경로: 실행하지 않았다(Windows 호스트). L-1은 코드를 읽고 내린 판단이다.
- `6d3943d`까지 나아간 3커밋(2275948, 3b0c997, 6d3943d, G-E 적용 실행): 다시 돌리지 않았다.
  - `src/store/runs.ts` 차이만 읽었다. `apply_started` 첫 기록도 `checkStartTime`을 지난다.
  - `lock.ts`와 CLI 파일은 바뀌지 않았다.
  - `apply-revert.ts`가 N-26 판정을 쓰는지는 보지 않았다.
- 통합 시험과 전체 유닛: 이 검토에서는 store·cli만 돌렸다.
- PowerShell 제한 언어 모드처럼 시작 시각 질의가 막힌 환경: 코드상으로는 `null`이 되고 pid만으로 판정한다. 실행하지는 않았다.
- 시작 시각 판정이 있는 상태에서 여러 프로세스가 동시에 회수를 다투는 경우: 따로 부하를 주지 않았다. 브랜치의 `lock-reclaim` 유닛은 통과했다.
- `report`의 다른 출력 필드 전체에 대한 키 가림 순서: 경로 하나로만 확인했다.

## 7. PM 판단 필요

- PQ-R7-1 (M-1): 고치는 자리
  - 가정: N-A가 `main.ts`에서 `inspectRun`을 `isDamaged`로 연결하는 것을 우선한다. store 쪽 디렉터리 이름 정확 일치 검사는 추가 방어로 둔다.
  - 심각도는 선행 조건(사용자가 보이지 않는 id를 입력)을 보고 중간과 낮음 사이에서 정해 달라.
- PQ-R7-2 (L-3): core-tools와 N-B 메시지 목록의 병합 순서. 가정: 한 묶음 또는 N-B 먼저.
- PQ-R7-3 (I-1, I-2): 미래 시각 손상에 여유나 사유 표시를 둘지, `report`가 손상 실행을 표시할지.

## 8. 실행한 것

- 빌드본: `git archive 2a94a44` → `.codaryn/r7/ct`. `node_modules`를 복사하고 `tsc`로 산출했다(i18n 오류 2개는 알려진 것).
- 정상 실행: `.codaryn/r7/d1`(체험 예시, scripted 모델, 키 없음) → `20261112T031153Z-cb952697`
- 실험 스크립트(모두 `.codaryn/r7/exp/`, 출력은 같은 이름의 `.out`)
  - `runs.mjs`: 위조, DR-19 경계, JSON 가림
  - `human.mjs`, `f.mjs`, `e.mjs`: N-23 (c)~(h), N-24 (c)
  - `lock.mjs`: 옛 형식 잠금, pid 재사용
  - `case.mjs`, `inspect.out`: M-1
  - `h2.out`: L-2
  - `catalog.out`, `g-text.out`: L-3
  - `unit.out`: 브랜치 유닛
- 가짜 값만 썼다. 키 모양은 `sk-ant-` + `FAKE` 반복이나 알파벳 나열이고, 현재 키 자리에는 `fake-current-key-value-r7-0001`을 썼다. 실제 API, 네트워크, 키 파일은 쓰지 않았다.
- 저장소 파일은 고치지 않았고 검토 커밋은 만들지 않았다(`git status` 깨끗함).
- 검토를 마친 뒤 PM 공지(작업 지침 G-1~G-6)에 따라 `git merge main`으로 지침을 받았다. 병합 커밋은 `86361f8`(gangdonggil, trailer 없음)이다. 개발 절차 7·8·9절을 읽었고 이 보고서는 9절 형식을 따른다.
