# R-117 검토: U-306 (na-core, 이행 C-7a: 계획 보기·사람 확인을 앱으로) — GUI·통합 쪽

- 검토: ne-verify (w3:p4). 읽기 전용이고 커밋하지 않았다. src 쪽은 Codex V-34가 본다.
- 판: `pm/unit-C7a` = `3ef9a59cd50a0a60e99222210bcf03eda358547c`. main `601eabe4` 위다.
  - 계획 보기와 사람 확인의 준비·점검이 `src/app/plan-view.ts`로, 실행 지정 해석이 `src/app/input/run-ref.ts`로 옮겨졌다.
  - 옛 자리는 다시 내보낸다.
- 판 사본 둘(base = main `601eabe4`, head = `3ef9a59c`)의 빌드로 쟀다. 실제 API, 외부 네트워크, 임시 worktree는 쓰지 않았다.

## 결론

- **높음 0, 중간 0, 낮음 0, 참고 1.**
- 시험

| 시험(head) | 결과 |
|---|---|
| 루트 `npm run build` | exit 0(base도 exit 0) |
| GUI `npm test` | 424개, 통과 424, 실패 0 |
| smoke 조용함 | 227/227, 31초, 시작 때 CPU 7%, node 22개, host 108 ms |
| smoke 부하 1 | 227/227, 53초, CPU 100%, node 78개, host 872 ms |
| smoke 부하 2 | 227/227, 50초, CPU 100%, node 70개, host 116 ms |
| c01 + n06 + n07 + n09 + n15 + n20 | 80개, 통과 79, todo 1(n20의 U-295), 실패 0 |

- 부하: head 사본 자신의 dist에서 루트 unit·integration을 두 갈래로 돌렸다.
- 세 번 모두 GUI의 계획·사람 확인 점검 16개가 통과했다: `planCheck`, `planShown`, `planFromList`, `planActions`, `planForged`, `planApplyInList`, `directPlanShown`, `runPlanApply`, `changesRecordsChanged`, `reviewRun`, `reviewAsked`, `reviewRecorded`, `reportVerdict`, `reviewGuard`, `reviewTaskRun`, `reviewFromList`. host(hostEndsWhenMainKilled)도 모두 ok였다.

## 1. GUI가 보는 계획 보기·사람 확인·적용 전 점검: base와 head가 같다 (`probe/gui-plans.mjs`)

- 엔진 호스트가 부르는 그대로 했다. 작업 공간 형식(`taskForm(workspace, profile, workflowRef)`)으로 `app.plan`·`app.review`·`app.checkApply`를 불렀다.
- 결과는 head의 GUI 빌드에 있는 호스트의 읽기 함수(`planValue`, `reviewValue`, `planCheckValue`)를 거쳤다. GUI 코드는 두 판이 같다.
- 계획과 확인할 실행은 앱의 `startRun`과 모의 API로 만들었다.
- 설정은 등록한 가릴 값(`secretEnv`)을 두고, 그 값이 이름인 파일을 작업 공간에 두었다.
- 실행 id, 가림 토큰, 시각, 해시(나온 차례로), 상자 폴더만 바꾸고 글자로 비교했다.

| 경우 | head(창이 받는 것) | base와 |
|---|---|---|
| 이동 계획 보기 | pending, 가린 경로 `inbox/<TOKEN>.txt` → `sorted/<TOKEN>.txt` | 같음 |
| 기록 변경 표시가 있는 계획 보기 | pending, `recordsChanged: true`(경고) | 같음 |
| 계획 방식이 없는 작업 형식으로 보기 | 계획은 보임(pending) | 같음 |
| 적용한 뒤의 보기·점검 | 보기 `applied`(적용 불가), 점검은 같은 거부 | 같음 |
| run 계획 보기·점검 | `planKind: "changes"`, 파일 목록, 점검 clean | 같음 |
| 적용 전 점검: 깨끗함 | problems [], unsafeMoves [] | 같음 |
| 적용 전 점검: 원본 바뀜 | problems `[{ index: 0, problem: "source_changed" }]` | 같음 |
| 적용 전 점검: 기록 변경 표시 | `{ ok: false, code: "plan_records_changed" }` | 같음 |
| 사람 확인 | 수락(메모의 등록 값은 가림, review.json에도) → `latest`로 거부(replaced: true) → 키 값이 든 메모는 `key_in_file`, review.json 그대로 | 같음 |
| `latest` 실행 지정으로 보기 | pending | 같음 |

## 2. 통합이 이 판에서 지키는 것

옮겨진 것은 CLI의 `plan`·`review`와 앱의 `plan`·`review`·`checkApply`가 함께 쓰는 규칙이다. 기대값은 다음이 지킨다.

| 시험 | 지키는 것 |
|---|---|
| n06(실제 CLI) | 이동 계획의 `plan` JSON·글(다이제스트, 동작, 원본 해시), 적용 뒤 applied, 승인 거부 넷, 낡은 계획 다섯, 두 번째 적용 거부, 동시 적용 |
| n07(실제 CLI) | `review`: review.json만 쓰고 결과·기록은 그대로, report의 판정, `--reject`의 교체, review 오류 넷, 원본 칸의 비밀 |
| n09(실제 CLI) | DR-28: 다른 비밀로 만든 계획을 보거나 적용하면 `plan_secrets_differ`, 무변경, 값 미출력 |
| n15(실제 CLI) | run 계획의 `plan` JSON·글, 승인·낡은 계획·두 번째 적용 |
| n03(실제 CLI) | 실행 지정(`latest`, 없는 실행, `latest`라는 디렉터리)의 거부와 고름 |
| c01 열다섯 | 실행과 적용의 CLI 대 앱. 계획 상태는 양쪽 모두 CLI `plan --json`으로 읽는다 |
| smoke | GUI의 계획 화면, 적용 전 점검, 위조 토큰, 사람 확인 묻기·기록·판정·막기(위 16개) |
| 판 비교(73) | U-306이 첫 커밋으로 더한 계획 보기·사람 확인의 사례 포함, CLI 출력의 판 사이 같음 |

## 3. 참고

### I-1 앱의 `plan`·`review`·`checkApply`를 CLI의 `plan`·`review`와 맞대는 통합 사례가 없다

- c01은 실행과 적용만 CLI 대 앱으로 맞댄다. GUI가 쓰는 앱의 계획 보기·사람 확인은 기대값을 smoke(정상 길)와 GUI 단위 시험(가짜 앱)이 지킨다.
- CLI와 같은 계획·실행에 대해 같은 것을 주는지는 아무 시험도 보지 않는다. 이번 탐침은 판 사이(base 대 head)의 같음만 보였다.
- C-7a 뒤 두 길은 같은 규칙(`showPlan`, `recordReview`)을 쓴다. 그래서 그런 사례가 지키는 것은 감싸개다.
  - 작업 형식의 번역: 작업 공간 형식 대 task 형식, `workflowRef`
  - DR-28의 가릴 값이 어디서 오는지
  - 오류의 왕복(`fromCliError`)
- 적용 전 점검(`checkApply`, U-91)은 CLI에 짝이 없다. 그래서 앱 쪽 기대값만 있다.
- 제안(담당 ne-verify, C-7b 앞의 시험 단위로, 결정은 PM): c01에 셋을 더한다.
  - 같은 이동 계획과 run 계획을 CLI `plan --json`과 앱 `plan`으로 본다. 기록 변경 표시가 있는 것 하나를 넣는다.
  - 같은 실행을 CLI `review --json`과 앱 `review`로 수락·거부·키 메모 거부한다.
  - 같은 계획의 적용 전 점검을 앱 `checkApply`로 보고, CLI `apply`의 사전 점검(`plan_checked`의 problems)과 맞댄다.

## 4. 판정 근거로 본 것

- `git diff 601eabe4 3ef9a59c`의 계획 보기·사람 확인 길: `src/app/plan-view.ts`, `src/app/input/run-ref.ts`, `src/app/command-outcome.ts`, `src/cli/plan-commands.ts`(−470), `scripts/compare-cli/cases.mjs`(+101)
- GUI: `gui/src/engine-host/host.ts`(`app.plan`·`app.review`·`app.checkApply`를 부르는 곳), `plans.ts`(`planValue`, `reviewValue`), `plan-check.ts`(`planCheckValue`), `gui/scripts/build/smoke.mjs`
- 탐침(커밋하지 않음): `r117/probe/gui-plans.mjs`와 결과 json
