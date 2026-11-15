# R-116 검토: U-300 (na-core, C-6b 전환) — GUI·통합 쪽

- 검토: ne-verify (w3:p4). 읽기 전용이고 커밋하지 않았다. src 쪽은 Codex V-33이 본다.
- 판: `pm/unit-C6i` = `e404dc19932bece66c265146e7401a9427fe61c7`. main `c51bac37` 위에 2커밋(cdf06243, 66875fa9)이 있다. 바뀐 파일은 `src/cli/run.ts`(+44 −331)와 `docs/cli-contract.md`뿐이다.
- 판 사본 둘(base = main `c51bac37`, head = `e404dc19`)의 빌드로 쟀다. 실제 API, 외부 네트워크, 임시 worktree는 쓰지 않았다.

## 결론

- **높음 0, 중간 0, 낮음 0, 참고 2.**
- 시험

| 시험(head) | 결과 |
|---|---|
| 루트 `npm run build` | exit 0(base도 exit 0) |
| GUI `npm test` | 420개, 통과 420, 실패 0 |
| smoke 조용함 | 227/227, 31초, 시작 때 CPU 10%, node 22개, host 109 ms |
| smoke 부하 1 | 227/227, 40초, CPU 100%, node 80개, host 135 ms |
| smoke 부하 2 | 227/227, 56초, CPU 94%, node 122개, host 215 ms |
| smoke 부하 3 | 227/227, 55초, CPU 96%, node 70개, host 107 ms |
| c01 + n15 + n20 | 32개, 통과 31, todo 1(n20의 U-295), 실패 0 |
| u303 + u293(유닛) | 19개, 통과 19 |

  - 부하: head 사본 자신의 dist에서 루트 unit·integration을 두 갈래로 돌렸다.
  - 네 번 모두 GUI의 run 계획 수행 점검(`runPlanApply`, `planRun`, `planShown`)이 통과했다. host는 hostEndsWhenMainKilled로, 모두 ok였다.

- PM이 물은 것
  1. **GUI의 계획 실행: 이벤트·질문·문이 그대로다.**
     - 코드: 앱의 `applyPlan`은 `appRunHooks`의 조립 감싸개(`journalWithEvents`, `confirmThrough`, 시작 보고)와 문 감싸개(`runApprovedPlan`)를 `cliEnvironmentOf`로 넘긴다. 이것이 CLI의 `runThroughApp`을 거쳐 `runLife`의 승인 분기(`io.runApprovedPlan ?? engine`)에 닿는다.
     - 앱 환경에는 `writeProgress`·`ask`가 없다. 그래서 `runThroughApp`의 관찰자는 비어 있다. `journalWithEvents`는 그때 journal을 그대로 돌려주고, `confirm`도 덧붙이지 않는다. 담당 말과 같다.
     - 실측(`probe/gate.mjs`, base와 head):
       - `applyPlan`이 답하기 전의 run 이벤트는 0개다.
       - 수행 실행의 권한 질문은 관찰자의 `confirm`으로 간다. 도구 `run_command`, 권한 `command`, 신호는 아직 끊기지 않음이었다.
       - 이벤트 17개의 차례가 같다.
  2. **적용 대화상자 뒤의 수행·낡은 계획·잠금·취소: 창으로 가는 줄이 전과 같다**(1절).
  3. **c01 열셋과 runLife 안의 틀림을 잡는 시험**(2절)
     - c01은 이제 CLI와 앱을 같은 `runLife`로 맞대므로 두 감싸개의 같음만 본다. 다만 U-302 사례의 기대값 단언(상태·종료 코드·계획 상태·파일)은 남는다.
     - `runLife` 안의 틀림은 다음이 잡는다: n15, smoke의 `runPlanApply`, u303의 기대값 단언, 판 비교(base 대 head).
     - 빈 곳 둘은 I-2에 적었다.

## 1. base와 head의 맞댐

### 1.1 GUI 엔진 호스트를 지나는 run 계획 수행 (`probe/gui-apply.mjs`, `flatten.mjs`)

- head의 GUI 빌드에 있는 실제 run registry(`createRunRegistry`)를 썼다. GUI 코드는 두 판이 같다.
- 거기에 base와 head의 실제 앱(`createCodarynApp(createNodeAppEnvironment())`)을 각각 꽂았다.
- 창처럼 차례를 밟았다: 계획 실행(`registry.start`, 작업 공간 형식, 모의 API) → `registry.startApply`.
- 비교한 것은 호스트가 메인으로 쓰는 줄 전부다. 진행 항목에는 기록 내용을 그대로 실었다.
- 묶음 타이머(5 ms)가 항목을 나누는 방식은 때마다 달라서, 항목을 펼친 차례와 그 밖의 줄의 차례로 비교했다.

| 경우 | head의 끝 | 항목 | 그 밖의 줄 | base와 |
|---|---|---|---|---|
| 정상 수행 | needs-input/no_verifier(검증 없음) | 16 | done | 같음 |
| 수행 중 권한 질문(registry로 deny) | needs-input/no_verifier, 명령 안 돎 | 22 | question, done | 같음 |
| 낡은 계획(사람이 승인된 파일을 고침) | failed/plan_stale | 3 | done | 같음 |
| 잠금(살아 있는 프로세스) | 시작 답 `{ ok: false, code: "workspace_locked" }` | 0 | — | 같음 |
| 시작 직후 취소(`registry.cancel`) | cancelled/cancelled | 3 | done | 같음 |

### 1.2 CLI의 run 계획 수행 (`probe/cli-apply.mjs`)

같은 task·설정·대본으로 base CLI와 head CLI가 각각 `run`에서 `apply --digest`까지 갔다. apply의 stdout·stderr·종료 코드, 수행 실행의 기록, 그 뒤의 계획 상태를 맞댔다.

| 경우 | head | base와 |
|---|---|---|
| 정상 수행 | 0, 계획 applied | 같음 |
| 계획 밖 쓰기 | 0, 계획 applied | 같음 |
| 낡은 계획 | 1, 계획 pending | 같음 |
| 잠금 | 6, 계획 pending | 같음 |
| 수행 전 취소 파일 | 5, 계획 pending | 같음 |

## 2. runLife 안의 틀림을 어디서 잡나

C-6b 뒤에는 CLI의 `apply`(run 계획)와 앱의 `applyPlan`이 같은 `runLife`의 승인 분기를 지난다. 그래서 두 길을 맞대는 시험은 그 분기 안의 틀림을 보지 못한다. 기대값이나 판 사이의 비교만 잡는다.

| 시험 | 종류 | 승인 분기에서 보는 것 |
|---|---|---|
| n15(통합, 실제 CLI) | 기대값 | 끝에서 끝까지, 승인 없는 적용, 계획 밖 쓰기의 거부·끝 요약 줄·안내, 낡은 계획 셋, 계획 실행의 목표, writablePaths와 두 목록, 두 번째 apply 거부 |
| c01의 U-302 다섯(통합) | 두 감싸개의 같음 + 기대값 | 상태·이유·종료 코드, 계획 상태(applied/pending), 파일, 계획 밖 거부 1, 잠금의 코드·글 |
| smoke `runPlanApply`(GUI) | 기대값 | 창에서의 점검 clean, 수행, 계획 밖 거부 1과 안내, 두 번째 적용 거부, 뒤의 applied, 행의 계획 이름 |
| u303(유닛) | 기대값 일부 | `deniedNotPlanned` 1(writablePaths 아님), 잠금 아래의 기록 변경 표시 → `plan_records_changed`·잠금 해제·미차지·무변경, 조립이 계획을 못 차지하면 `internal_error` |
| 판 비교(69, base 대 head) | 판 사이의 같음 | handoff-plan-applied, workflow-tools-run-plan, run-plan-refusals 등 CLI 출력 |
| n20 | 기대값 | 보통 실행만(승인 분기 아님) |

## 3. 참고

### I-1 u303(그리고 u293)의 "두 수명" 비교는 이제 자기 비교다

- u303은 `runPrepared(옛 CLI 수명, approved)`와 `runLife(approved)`를 맞대려고 만들어졌다(머리 주석: "Until the CLI's apply is turned to it (na-core), the CLI's runPrepared keeps its own branch").
- U-300 뒤 `runPrepared`는 `runThroughApp` → `runLife`로 넘긴다. 그래서 결과·기록·`applied.json`·수의 같음 단언은 같은 코드끼리의 비교가 되어 틀림을 잡지 못한다.
- 기대값 단언은 여전히 뜻이 있다: `planRunId`, `deniedNotPlanned` 1, `plan_records_changed`, 잠금 해제, 미차지, 무변경, `internal_error`.
- u293(U-296 뒤 `runCli` 대 `runLife`)도 같은 처지다. p5a는 준비 보고서 9.2에서 "그때부터 CLI의 감싸개가 앱의 수·오류를 그대로 내보냄의 회귀 시험으로 남는다, 이름은 그 뜻으로"라고 적었다.
- 제안(결정은 p5a·na-core): 이행 커밋 5(시험·문서)에서 두 파일의 머리 주석과 시험 이름을 지금 뜻으로 고친다. 같음 단언 가운데 뜻이 없어진 것은 기대값으로 바꾼다.

### I-2 승인 분기에서 기대값으로 고정되지 않은 것 둘

1. **잠금 아래의 기록 변경 표시(U-1, U-195)를 실제 프로세스로 보는 사례가 없다.**
   - u303만 같은 프로세스에서 본다.
   - n15에는 이 사례가 없다. n06의 것은 이동 계획이다.
   - 제안(담당 ne-verify, 시험만): c01이나 n15에 사례를 더한다. run 계획 실행 뒤 그 실행 디렉터리에 기록 변경 표시를 두고 CLI `apply`와 앱 `applyPlan`을 돌린다. 기대값은 `plan_records_changed`, 잠금 해제, 미차지, 무변경이다.
2. **GUI에서 run 계획 수행이 낡은 계획·잠금·취소로 끝나는 경우를 고정하는 시험이 없다.**
   - smoke `runPlanApply`는 정상 길만 본다. 1.1의 탐침은 지금 같음을 보였을 뿐이다.
   - 화면의 낱말은 GUI 단위 시험이 가짜 앱으로 본다.
   - 제안(결정은 p5u-gui): smoke에 낡은 계획 하나를 더하거나, 엔진 호스트 단위 시험 하나를 둔다. 후자는 1.1처럼 실제 앱으로 registry를 돌린다.

## 4. 판정 근거로 본 것

- `git diff c51bac37 e404dc19`: `src/cli/run.ts`(옛 수명 걷음, `CliEnvironment extends RunLifeEnvironment` — R-115 I-2가 고쳐짐), `docs/cli-contract.md`
- head의 `src/app/run-life.ts`(승인 분기, `approvedDeps`), `src/app/app.ts`(`appRunHooks`의 `runApprovedPlan` 문 감싸개, `applyPlan`)
- GUI: `gui/src/engine-host/runs.ts`(`startApply`, `launch`), `host.ts`(registry에 `app.startRun`·`app.applyPlan`), `gui/scripts/build/smoke.mjs`(`runPlanApply`)
- `tests/unit/app/u303-approved-life.test.ts`, `tests/integration/n15-plan-run.test.ts`, c01의 U-302
- 탐침(커밋하지 않음): `r116/probe/gui-apply.mjs`, `flatten.mjs`, `gate.mjs`, `cli-apply.mjs`와 결과 json
