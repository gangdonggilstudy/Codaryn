# R-15 병합 전 검토: 엔진의 늦은 변경 (읽기 전용)

```
페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조)
worktree/브랜치: D:\project\Codaryn\.worktrees\claude-gui / claude/gui-design (수정·커밋 없음)
검토한 커밋: pm/bundle-1 7de824a84c5a529332991a3ad661ff2aa65e6fae (비교 기준 main 4f6d3f4)
커밋: 없음
검사: 빌드 사본 typecheck 0 오류(7de824a, 4f6d3f4 둘 다) / 탐침 9개 실행(아래 4절) / DR-28 앱 시험 1건 직접 실행(todo, 단언 실패) / 전체 유닛·통합은 다시 돌리지 않음(PM 수치 사용) / 실제 API 미실행
결과: 높음 0, 중간 1, 낮음 1 (정보 3)
다른 담당자 확인: CLI(w3:p2)·앱 계층(w3:pA) — M-1 / store(w3:p6) — L-1
```

## 0. 이해 확인

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 구현자가 아닌 세션의 교차 검토다(개발 절차 9절).
- 대상: PM 통합 트리 고정 판 `pm/bundle-1` `7de824a`(2026-11-12 14:08:40 +0900, "Merge branch 'claude/cli-verification' into pm/integration", 10개 브랜치 합침).
- 범위(내 코드가 아닌 것)
  - `applyPlan`의 DR-21 동의 경로
  - 행동 시작 기록(R-9 I-4)
  - DR-28 비교
  - 계획 저장 중 취소(DR-18 c)
  - AC-D15(도구 이름·호출 id 기록)
  - 제공자의 workflowTools 전송(`src/model/anthropic`)
- 중점
  1. 동의 없이 위험한 이동이 실행되는 경로
  2. 동의가 다른 실행·다른 계획에 재사용되는 경로
  3. 시작 기록과 끝 기록 사이에서 끊겼을 때의 상태
  4. workflowRef 없는 실행의 요청 본문과 기록이 바뀌지 않았는지
  5. 취소 뒤 남은 계획이 적용되지 않는지
- 규칙: 저장소 파일을 고치거나 커밋하지 않는다. 읽기는 `git -C D:\project\Codaryn archive/show/diff`로 한다. 실험은 `.codaryn/r15/` 안의 빌드 사본에서만 한다. 실제 API·네트워크·키 파일은 쓰지 않고 가짜 값만 쓴다.
- 보고: 이 파일. 대화에는 심각도별 건수 두 줄.

## 1. 결론

| 중점 | 판정 | 근거(4절 탐침) |
| --- | --- | --- |
| 1 동의 없는 위험한 이동 | 경로 없음 | A1, U1, U4 |
| 2 동의의 재사용 | 경로 없음 | A2, A5, U2, U3b, 코드 읽기 |
| 3 시작·끝 기록 사이의 끊김 | 대부분 맞음. 링크와 지우기 사이의 끊김만 남는다 | C1~C5 → **L-1** |
| 4 workflowRef 없는 실행 | 요청 본문·기록·결과가 main과 바이트 단위로 같다 | P5 |
| 5 취소 뒤 남은 계획 | 보이지도 적용되지도 않는다 | K1~K4 |
| DR-28 비교 | 엔진의 두 번째 방어는 맞다. 계획 보기는 비교하지 않는다 | D1~D6 → **M-1** |
| AC-D15 | 맞다. main의 기록 누출을 막는다 | I1, P5b |

M-1은 이 묶음 위에 이미 고친 커밋이 있다(`claude/workspace-policy` `2f6d5c8`). main 병합에 그 커밋을 함께 넣고, 앱 계층의 DR-28 시험에서 todo 표시를 지워야 닫힌다(5절 PQ-1).

## 2. 발견

### M-1 (중간) 계획 보기가 DR-28 비교 없이 지금 비밀로 다시 가린다: 계획 실행이 가렸던 비밀 값이 평문으로 나온다

- 위치
  - `src/cli/plan-commands.ts:258-289` `loadShown`: 지금 비밀로 다시 가리기만 한다. 저장된 `shown`과 비교하지 않는다.
  - 이 함수를 쓰는 곳
    - `codaryn plan`(`:306-316`, 글과 `--json` 둘 다)
    - 단말의 적용 질문(`:362`, 계획을 그려 보인 뒤 [y/N]를 묻는다)
    - 앱 계층의 계획 보기(`src/app/app.ts:570` → `runPlan`). 따라서 GUI의 계획 화면도 같다.
  - 묶음의 `src/cli`·`src/app`에는 `planActionShownMatches`나 `plan_secrets_differ`를 부르는 곳이 없다. `src/engine/apply.ts:295`에만 있다.
- 기준
  - DR-28: "계획 보기와 적용은 … 같을 때만 진행한다. 다르면 아무것도 보여 주거나 옮기지 않고 전용 오류로 끝낸다"(`docs/work-orders/phase-4-5-design.md:115`).
  - 계약 `src/contracts/engine.ts:228-235`: `plan_secrets_differ`는 `codaryn plan`, `codaryn apply`, 앱 계층에서 계획을 읽은 직후 확인한다. 아무것도 보이지도, 묻지도, 기록하지도, 옮기지도 않는다.
- 재현(`exp/dr28.mjs`, 묶음 CLI, scripted 제공자, 가짜 비밀 `fakeR15secretAlpha42`)
  1. `inbox/<비밀>-notes.txt`를 옮기는 계획을 `secretEnv: ["R15_SECRET"]` 작업으로 만든다. `plan.json`의 `shown`은 `{"from":["inbox/","-notes.txt"],…}`이고 맞게 저장된다.
  2. D1, 같은 비밀: `from`이 `inbox/[[CODARYN_SECRET:…]]-notes.txt`로 가려진다.
  3. D2, 같은 작업 파일에서 환경 변수 값만 바뀜: `codaryn plan --json`이 exit 0이고 `from: "inbox/fakeR15secretAlpha42-notes.txt"`로 **평문**이다.
  4. D3, 비밀을 등록하지 않는 작업 형태: D2와 같은 평문이다. D3b 글 출력에도 `1. move inbox/fakeR15secretAlpha42-notes.txt -> done/…`이 나온다.
  5. 앱 계층: `tests/unit/app/plan-review.test.ts:54-77`의 DR-28 시험이 `todo`로 표시되어 있다. 묶음에서 직접 돌리면 `AssertionError: no plaintext of the plan run's secret (actual: true)`로 실패한다. todo라서 PM 수치의 "실패 0"에 잡히지 않았다.
- 엔진 쪽(두 번째 방어)은 맞다. D4, 비밀 없이 `apply --digest`
  - `failed/plan_stale`, exit 1
  - 파일 그대로, `applied.json` 없음
  - 출력과 모든 실행 기록에 비밀 0건(D6, `plan.json` 제외)
  - D5, 같은 비밀로 적용: `done/verified`, 기록에 비밀 0건
  - 다만 전용 오류(`plan_secrets_differ`, exit 2)가 아니라 `plan_stale`(exit 1)로 끝난다. CLI의 첫 방어가 없어서 생기는 차이다.
- 영향: R-11 M-1과 같은 종류다. 적용과 적용 기록은 막혔다. 남은 경로는 보기 화면, CLI `--json`, 단말 질문, GUI 계획 화면이다.
- 고침
  - `claude/workspace-policy`의 `2f6d5c8`("fix(cli): show or apply a plan only when the secrets now mask it as the plan run did")과 `2948744`(문서)가 7de824a 위에 있다. 바뀐 파일은 `src/cli/plan-commands.ts`와 `tests/unit/cli/g-r11.test.ts` 두 개다.
  - 이 커밋들은 **검토 대상 밖이라 읽거나 실행해 보지 않았다.**
  - 이 커밋은 앱 시험의 todo를 지우지 않는다. 병합 뒤 앱 계층 담당(w3:pA)이 todo를 지워 위 시험이 실제로 통과하는지 확인해야 이 항목이 닫힌다.
  - 확인 입력으로 `exp/dr28.mjs`의 D2·D3·D3b·D4를 그대로 쓸 수 있다.

### L-1 (낮음) 링크와 원본 지우기 사이에서 끊긴 적용은 한 파일의 두 이름을 남기고, 되돌리기가 이를 풀지 못한다

- 위치
  - 적용기는 링크를 만든 뒤 원본을 지운다(`src/tools/plan-files.ts:329` `moveNoReplace`).
  - 되돌리기는 시작 기록만 있는 행동을 `src/store/apply-revert.ts:366-370`에서 판정한다. 규칙 `:21-25`("그 밖은 changed_since_run, 손대지 않음")에 따른다.
- 재현(`exp/crash.mjs`): 실제 엔진 `applyPlan`, 실제 적용기, store 적용 기록과 계획 점유를 쓰고, 자식 프로세스를 해당 지점에서 `process.exit`로 끊는다.
  - C2 이동이 링크 뒤·지우기 전에 끊김
    - 기록: `apply_started, plan_checked, plan_item_started`
    - `a.txt`와 `x/a.txt`가 둘 다 있고, **같은 파일**이다(dev·ino 같음, nlink 2).
    - `revert --dry-run`과 실제 `revert` 모두 `skipped: changed_since_run`이고, 파일은 그대로다.
    - 계획은 점유되어 다시 적용할 수 없다(`already_applied`).
  - C4 폐기가 같은 지점에서 끊김: 원본과 `.codaryn/discarded/<run>/0`이 같은 파일로 남는다. 되돌리기는 `changed_since_run`이다.
- 영향
  - 잃는 데이터나 드러나는 비밀은 없다.
  - 그러나 Codaryn으로는 되돌릴 수 없는 중복이 남는다.
  - 두 이름이 하드 링크라서, 사람이 한쪽을 고치면 다른 쪽도 바뀐다.
  - 이동 자체가 만드는 유일한 중간 상태이므로 "변경됨"으로 볼 이유가 약하다.
- 제안(store 담당 판단): 다음 조건을 모두 만족하면, 되돌리기가 적용이 더한 이름(이동의 목적지, 또는 폐기의 보관본) 하나만 지우는 방안이다.
  - 시작 기록만 있다.
  - 원본과 목적지가 모두 행동의 해시를 가진다.
  - 둘이 **같은 파일**(dev·ino)이다.

  남은 이름이 내용을 가지므로 잃는 것이 없다. 고치지 않는다면 `report`/`revert`가 "두 이름이 한 파일"임을 알려 주는 정도라도 필요하다.

## 3. 정보(조치 불필요하거나 담당 판단)

- I-1 끊긴 적용 뒤의 안내
  - 링크 전에 끊기면(C1) 아무것도 옮겨지지 않았지만 계획은 점유된다.
  - `apply`는 `plan_already_applied`("Revert the apply run to undo it", `src/cli/plan-commands.ts:335`)로 거절하고, 되돌리기는 빈 결과다.
  - 이 실행은 실행 목록에 `status: null`로 나온다.
  - 결국 계획을 다시 만들어야 한다. 행동 전에 점유하는 것은 G-E 설계(부분 적용 위에 다시 적용 방지)다. 이 경우에만 안내 문구가 맞지 않는다.
- I-2 엔진은 동의의 채널 값을 검사하지 않는다(A6에서 `channel: "model"`도 통한다).
  - 호출자를 보면 CLI는 `cli-flag`/`cli-tty`만 만든다(`plan-commands.ts:457-458, 470`). 앱은 `adapter`로 고정하고 CLI가 한 번 더 확인한다(`src/app/consent.ts`, `plan-commands.ts:346-349`).
  - 작업·설정·모델에서 이 값에 닿는 경로는 없다.
  - store의 되돌리기는 `APPROVAL_CHANNELS`를 검사한다(`src/store/changes.ts:428-431`). 엔진도 같게 하면 방어가 한 겹 늘어난다.
- I-3 한 응답 안에서 같은 호출 id가 두 번 오면 한 번만 답한다(7호출, 6결과). main과 같고, 설계대로다("a repeated call is still answered once", `src/engine/index.ts:337-345`).

## 4. 실행한 탐침과 결과

모두 `.codaryn/r15/exp/`에 있다. 빌드 사본은 다음과 같다.
- `.codaryn/r15/b`: `git archive 7de824a`, tsc 0
- `.codaryn/r15/m`: `git archive main`(4f6d3f4), tsc 0

`node_modules`는 worktree 것을 junction으로 연결했다. 출력은 같은 이름의 `.out` 파일에 있다. 값은 모두 가짜다(키는 시험 고정값 `FAKE_API_KEY`, 비밀은 `fakeR15…`).

### 4.1 동의 경로 (`consent.mjs`: 엔진 `applyPlan` + 가짜 적용기, `unsafe.mjs`: 실제 적용기·기록·점유)

| 입력 | 결과 |
| --- | --- |
| A1 동의 없음, 행동 0이 unsafe | `consent_required`, `executor.apply` 0회, 점유 0회 |
| A2 다른 계획의 digest | `consent_required`, 적용 0회, "다른 계획" 알림 |
| A3 이 계획의 digest | 목록에 있는 행동 0에만 `allowUnsafeMove: true`, 나머지는 false. 결과 `unsafe` 표시는 0번만 |
| A4 동의 있음, unsafe 없음 | 모든 행동 `allowUnsafeMove: false` |
| A5 digest 앞부분만 | 다른 계획으로 처리, `consent_required` |
| A7 폐기 행동이 unsafe | 그 행동에만 허용 |
| U1 점검의 링크 시험은 됨, 실제 링크는 ENOTSUP, 동의 없음 | `plan_item_failed`, 원본 그대로, 이름 바꾸기 없음 |
| U2 U1과 같고 이 계획의 동의 있음(점검 목록에 없음) | U1과 같음. 목록 밖 행동에는 동의가 쓰이지 않는다 |
| U4 하드 링크 없음, 동의 없음 | `consent_required`, 파일 그대로, **점유 안 됨** |
| U3 이어서 같은 계획을 동의와 함께 다시 적용 | `done/verified`, `unsafe` 1, 기록 `plan_item_started → file_moved` |
| U3b 같은 동의로 한 번 더 | `plan_stale`(이미 점유), 바뀜 없음 |

코드 읽기로 확인한 것
- 엔진은 digest 전체가 같을 때만 동의로 센다(`src/engine/apply.ts:137`). 다른 계획의 동의를 알리고(`:278`), unsafe가 있고 동의가 없으면 점유 전에 멈춘다(`:340`). 허용은 행동별로 준다(`:361`).
- 적용기는 허용이 없으면 이름 바꾸기 전에 멈춘다(`src/tools/plan-executor.ts:215-221`).
- 계획 파일은 자기 실행 id를 담는다(`src/store/plan.ts:146-147`). 같은 행동이라도 다른 계획 실행의 digest는 다르다.
- 동의는 적용 기록에 채널만 남는다. 어디에도 저장되지 않아 다음 실행에 쓰일 수 없다.

### 4.2 시작·끝 기록 사이의 끊김 (`crash.mjs`, `crash-child.mjs`)

| 끊긴 곳 | 남은 파일 | 되돌리기(미리보기 = 실제) |
| --- | --- | --- |
| C1 이동, 링크 전 | 원본만 | 목록 없음(맞음) |
| C2 이동, 링크 뒤·지우기 전 | 두 이름, 같은 파일 | `changed_since_run` → **L-1** |
| C3 이동, 끝 기록(`file_moved`) 전 | 목적지만 | `moved_back`, 원래 자리로 돌아옴 |
| C4 폐기, 링크 뒤·지우기 전 | 원본 + 보관본, 같은 파일 | `changed_since_run` → L-1 |
| C5 폐기, 끝 기록 전 | 보관본만 | `restored_from_discard`, 돌아옴 |

- 다섯 경우 모두 기록은 `apply_started, plan_checked, plan_item_started`로 끝난다. 계획은 점유되었고(두 번째 점유는 `already_applied`), 실행 목록에는 `checked`, `status: null`, `kind: apply`로 나온다.
- 기록 쓰기가 예외를 던지는 경우(디스크 가득 참 등)
  - CLI는 잠금을 풀고 `internal_error`로 "report와 revert가 한 일에 대해 동작한다"고 알린다(`plan-commands.ts:430-438`).
  - 남는 상태는 C3과 같다.
- 탐침의 계획 실행에는 기록이 없어 `loadPlan`이 `run_not_found`였다. 이는 탐침을 만든 방식 때문이고, 발견이 아니다.

### 4.3 workflowRef 없는 실행 (`provider.mjs`)

- 같은 문서 작업을 main CLI와 묶음 CLI로 실행했다.
  - 제공자 `anthropic`, 로컬 루프백 가짜 API(`tests/support/fake-anthropic`)
  - 자식 환경은 시험의 허용 목록(`cliEnv`), 키는 가짜 고정값
- P5 결과
  - 두 판 모두 요청 2건, 프로토콜 위반 0, `done/verified`
  - **요청 본문 2건이 바이트 단위로 같다.** 도구 목록 `read_file, search_files, write_file, run_command`
  - 기록 9건도 시각·실행 id를 빼면 같다. CLI 결과도 같다.
  - 키는 출력·기록에 0건
- P5b(묶음): 응답의 `"bad id"`와 없는 도구 이름 `no_such_tool`
  - 다음 요청의 되돌린 `tool_use`/`tool_result`가 `codaryn-call-1`로 짝을 이룬다. `unknown_tool`로 바뀐 이름도 짝이 맞다.
  - 위반 0
- P5c(묶음, `workflowRef: organize`)
  - 보낸 도구는 `read_file, search_files, inspect_files, propose_plan`이다. 워크플로 도구가 기본 도구 뒤에 붙는다.
  - 계획 없이 끝내면 `model_error`("propose_plan did not succeed")로 끝난다. 설계대로다.
- 코드 읽기: 정의가 없는 워크플로 도구 이름은 요청 오류다. `Object.hasOwn`이라 프로토타입 키는 통하지 않는다(`src/model/anthropic/index.ts:395`).

### 4.4 AC-D15 (`call-ids.mjs`: 실제 CLI, scripted 제공자, `secretEnv`로 가짜 비밀 등록)

| 모델이 준 id / 이름 | 묶음 기록 | main 기록 |
| --- | --- | --- |
| `toolu_A1` | 그대로 | 그대로 |
| `bad id with space` | `codaryn-call-2` | 그대로 |
| 비밀 값 그 자체 | `codaryn-call-3` | **비밀 평문** |
| `codaryn-call-1`(모델이 준 것) | 그대로. 대체 번호가 피해 간다 | 그대로 |
| 이름 `<비밀>_tool` | `unknown_tool` | **비밀 평문** |
| 이름에 제어 문자(U+0007) | `unknown_tool` | **제어 문자 기록** |

- 묶음에서는 비밀이 출력·기록 어디에도 0건이다.
- 결과 짝도 맞다(4.3 P5b).

### 4.5 계획 저장 중 취소 (`plan-cancel.mjs`)

- 구성
  - 실제 도구 실행기의 `propose_plan`, 실제 store 계획 기록기·기록·결과 쓰기·`loadPlan`
  - 끼어들기는 `plan.json`을 쓴 직후, 도구가 답하기 전에 한다.
  - 이어서 묶음 CLI의 `plan`과 `apply --digest`를 실행한다.

| 경우 | 엔진 결과 | `loadPlan` | CLI plan / apply | 파일 |
| --- | --- | --- | --- | --- |
| K1 끼어들기 없음 | `plan_pending`, digest 제시 | 성공 | `pending` / `done/verified` | 옮겨짐 |
| K2 취소 | `cancelled`, `plan` 없음 | `run_not_plan` | `run_not_plan` / `run_not_plan` | 그대로 |
| K3 시간 한도 | `budget-exhausted/max_duration`, `plan` 없음 | `run_not_plan` | 같음 | 그대로 |
| K4 `result.json` 전에 프로세스가 끝남 | (결과 없음) | `run_not_plan` | 같음 | 그대로 |

세 경우 모두 `plan.json`이 남지만 보이지도 적용되지도 않는다. 근거는 `src/engine/index.ts:999`와 store의 결과 확인이다.

### 4.6 DR-28 (`dr28.mjs`): 2절 M-1의 D1~D6

## 5. PM 질문

- PQ-1(M-1): main 병합에 `claude/workspace-policy`의 `2f6d5c8`·`2948744`를 함께 넣는가?
  - 가정: 넣는다. 그러면 CLI·앱의 계획 보기와 적용이 `plan_secrets_differ`로 먼저 멈출 것이다(그 커밋은 검토하지 않았다).
  - 7de824a만 병합하면 DR-28은 "적용만 막힘" 상태로 main에 들어간다.
  - 어느 쪽이든 `tests/unit/app/plan-review.test.ts:58`의 todo를 지우는 일을 앱 계층에 배정해야, 회귀 시험이 실제로 지킨다.
- PQ-2(L-1): 끊긴 이동의 "한 파일 두 이름"을 되돌리기가 풀게 할지, 안내만 할지 store 담당이 정하는가?
  - 가정: 병합을 막을 일은 아니고, 다음 store 작업으로 둔다.

## 6. 검사하지 않은 범위

- 되돌리기(DR-25)의 위험한 이동 경로: `revertRun`에는 파일 연산 주입 고리가 없어, 하드 링크 없는 드라이브를 흉내 내지 못했다(U3c~e는 실제 하드 링크로 돌아가 판정에 쓰지 않았다). 동의가 실행 id·사람 채널에 묶이는 것은 코드로만 확인했다.
- 실제 하드 링크 없는 드라이브(FAT·exFAT)와 네트워크 드라이브: 적용기의 `fileOps` 주입으로만 흉내 냈다.
- 단말 질문 경로(`[y/N]`, 동의 질문): 이 환경에서 TTY를 띄울 수 없어 코드로만 읽었다(`plan-commands.ts:362, 459-470`).
- `2f6d5c8`·`2948744`: 검토 대상 밖이다.
- 실제 Anthropic API: 규칙대로 부르지 않았다. 루프백 가짜 서버만 썼다.
- 전체 유닛·통합: 다시 돌리지 않았다(PM 수치 1505/516). 흔들린 V-2도 보지 않았다.
- GUI: 묶음에 GUI가 없다.

## 7. 정리

- 저장소 파일 변경 없음, 커밋 없음.
- 실험물은 `.codaryn/r15/`(빌드 사본 `b`·`m`, 탐침 `exp`)에 있다.
- 탐침의 임시 작업 공간은 각 탐침이 OS 임시 폴더에 만들고 지웠다.
- 빌드 사본은 PM 확인 뒤 지운다. 지울 때는 junction(`b/node_modules`, `m/node_modules`)을 먼저 `rmdir`로 끊고 나서 폴더를 지운다.
