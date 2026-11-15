# R-36 병합 전 검토: 검증기 합치기와 실행 시작 줄의 알림 (DR-43 (a)(b))

## 0. 대상과 방법

- 페르소나: 검증 엔지니어(주, 검증 모듈 소유자로서), 보안·개인정보 검토자(보조). 읽기 전용이다. 이번 범위의 코드는 내 것이 아니다. 저장소 파일 수정과 커밋은 없다(작업 시작 때 `merge main`은 "Already up to date").
- **검토 대상(고정)**: `pm/bundle-6` = `05f3b7c9209b66d199958661dc62bd019e9a111b`. 기준은 main `23daf6b`(병합 기준점도 같다).
- 범위의 커밋
  - `53b6def` 계약: `mergeWorkflowVerifiers`, `workflowVerifierNarrowings`, 알림 종류 `verifiers_dropped`
  - `ee9376c` CLI: 간편 형식과 task 파일에 적용
  - `f323ce1` 진행 줄: 한 기록에 여러 줄, 영어 줄로 알림
  - `c6b34a8` 앱 계층: 넓히기 판정과 설정 보기
  - 함께 본 파일: `src/cli/run.ts`, `src/cli/doctor.ts`, `src/cli/progress.ts`, `src/app/settings.ts`, `src/app/settings-change.ts`, `src/contracts/workflow.ts`, `src/contracts/human.ts`, 카탈로그
- 빌드
  - `git archive 05f3b7c`를 이 worktree의 `.codaryn/r36/b`에 풀었다. 루트 node_modules는 사본이고, `tsc` 오류는 0이다.
  - 비교용 main `23daf6b`는 `.codaryn/docs20` 빌드다.
- 실험(`.codaryn/r36-exp.mjs`, 출력 `.codaryn/r36-exp.txt`)
  - 실제 CLI 프로세스(`run`, `doctor`, `report`, `plan`, `apply`)를 썼다.
  - 모델은 task 파일에서 대본 모델, 간편 형식에서 저장소의 가짜 Anthropic 서버(127.0.0.1)다.
  - 키는 키 모양이 아닌 가짜 값이다. 실제 API와 외부 네트워크는 쓰지 않았다. 작업 공간은 모두 scratch 폴더다.
- 실험용 설정 파일의 워크플로 `checked`에는 자기 검증기 둘이 있다.
  - `own-file`: `must.txt`에 `OK`가 든다.
  - `own-cmd`: `node -e` 명령. `must.txt`가 있으면 종료 0이다.
- 단위 시험: `g-workflow-verifiers-merge`, `g-dr43-verifiers`, `g-dr43-progress`, `g-dr43-key-like`, `settings-workflow-rules` 35건 중 34 통과, todo 1(4절).

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 3 (L-1~L-3) |
| 정보 | 6 (I-1~I-6) |

**PM 중점 항목**

| # | 항목 | 결과 |
| --- | --- | --- |
| 1 | 합친 뒤 작업 종류 자신의 검사가 사라지거나 약해지는 길 | **찾지 못했다.** 2절 표의 모든 경우에 정의의 검증기가 그대로 실행됐고, 결과는 정의의 검증기가 판정했다 |
| 2 | 작업 종류가 없는 실행과 기존 사례가 main과 같은가 | **같다.** task 파일(대본 모델)과 간편 형식(가짜 서버)의 작업 종류 없는 실행, `examples/demo`와 `examples/organize-demo`(계획 → 적용)의 결과와 stderr가 main과 글자까지 같았다(실행 id·시각·다이제스트만 바꿔 비교) |
| 3 | 합쳐진 검증기가 모두 실행되고 결과·보고에 모두 나오는가 | **그렇다.** 경우마다 결과 JSON의 `verifiers`, 기록의 `verifier_result`, `report`의 "Verification" 줄 수가 같다(예: A10은 넷 모두 4). 순서는 정의의 것 다음 준 것이다 |
| 4 | 알림에 값이 없고 개수가 서로 같은가 | **값은 없다**(종류와 개수만). doctor와 `run_started`의 개수는 프로필과 task 파일 경로에서 모두 같았다. 다만 실행 시작 줄은 사람용 출력에 그려지지 않는다(todo, L-1). `run --workflow`는 doctor로 미리 볼 수 없어 개수가 0과 1로 다르다(L-3) |

## 2. 재현 결과

### 2.1 task 파일(대본 모델, `workflowRef: "checked"`)

| # | task의 `verifiers` | `must.txt` | 결과 | 실행된 검증기 | `run_started` 알림 | doctor 알림 |
| --- | --- | --- | --- | --- | --- | --- |
| A2 | `[]` | 없음 | `failed/verifier_failed` | own-file:fail, own-cmd:fail | 없음 | 없음 |
| A3 | `[extra]` | 있음 | `done/verified` | own-file, own-cmd, extra 모두 pass | 없음 | 없음 |
| A4 | `own-file`을 더 느슨한 규칙(`a.txt` 있음)으로 | 없음 | `failed/verifier_failed` | own-file:fail, own-cmd:fail(준 것은 빠짐) | `verifiers_dropped` 1 | 1줄 |
| A5 | `own-cmd`를 다른 인자와 `expectExitCode: 3`으로 | 없음 | `failed/verifier_failed` | own-file:fail, own-cmd:fail | 1 | 1줄 |
| A6 | `own-cmd`를 다른 종류(`file_rules`)로 | 없음 | `failed/verifier_failed` | 정의의 둘 | 1 | 1줄 |
| A7 | `own-file` 그대로(키 순서만 다름) | 있음 | `done/verified` | 정의의 둘 | 없음(같은 검사) | 없음 |
| A8 | 같은 명령을 다른 id(`my-cmd`)로, 느슨하게 | 없음 | `failed/verifier_failed` | own-file:fail, own-cmd:fail, my-cmd:pass | 없음 | 없음 |
| A9 | `[extra, extra]` | 있음 | `invalid_task`("verifier ids must be unique"), main과 같은 거부 | - | - | - |
| A10 | `[extra, own-file 느슨, extra2]` | 있음 | `done/verified` | own-file, own-cmd, extra, extra2(순서대로) | 1 | 1줄 |
| A11 | 워크플로 `bare`(자기 검증기 없음), `[extra]` | - | `done/verified` | extra | 없음 | 없음 |
| A13 | `workflowRef` 없음, `[own-file 느슨]` | - | main과 같음 | own-file:pass | 없음 | 없음 |
| A14 | A4와 같은 입력 | 없음 | bundle은 `failed/verifier_failed`(정의의 둘), main은 `done/verified`(준 것 하나만) | - | bundle 1 | bundle 1줄 |

- A14가 DR-43 (a)가 고친 차이다. main에서는 설정·task의 검증기가 정의의 검사를 대체해 느슨한 검사만 돌았다.
- `verifiers`를 생략한 task 파일은 bundle과 main 모두 `invalid_task`("verifiers must be an array")다. 그래서 "생략"은 간편 형식에만 있다(B8).

### 2.2 간편 형식(가짜 Anthropic 서버 127.0.0.1)

| # | 설정 | 결과 | 실행된 검증기 | `run_started` | doctor |
| --- | --- | --- | --- | --- | --- |
| B1 | `--workflow checked`, 설정 `verifiers: [own-file 느슨]`, `must.txt` 없음 | `failed/verifier_failed` | 정의의 둘 | 1 | 알림 없음(doctor에 `--workflow`가 없다, L-3) |
| B2 | 프로필 `p`(checked)에 자기 `verifiers: [extra]`, 설정에 `[own-file 느슨]` | `done/verified` | 정의의 둘 + extra | 없음 | 없음(일치) |
| B3 | 프로필 `p2`(checked), 자기 검증기 없음, 설정 `[own-file 느슨, extra]` | `done/verified` | 정의의 둘 + extra | 1 | 1줄(일치) |
| B4 | 프로필 `p3`(checked)에 `verifiers: []`, 설정 `[extra]` | `done/verified` | 정의의 둘(프로필의 빈 목록이 설정의 것을 덮는 것은 main과 같은 규칙) | 없음 | 없음 |
| B5 | B3과 같고 `CODARYN_LANG=ko` | 같음 | 같음 | 1 | 한국어 1줄 "이 작업 종류(workflow)로 실행하면, 자체 검증과 id가 같은 설정·task의 검증 1개가 빠집니다" |
| B6 | 작업 종류 없음, 설정 `[own-file 느슨]` | main과 같음 | own-file:pass | 없음 | 없음 |
| B8 | `--workflow checked`, 설정에 `verifiers` 없음 | `done/verified` | 정의의 둘 | 없음 | 없음 |
| B9 | 프로필 `s`(정의 `strict`: 명령 금지, 자기 검증기 `own-file`), 설정에 명령 규칙 하나, `restorePathTokens: true`, `[own-file 느슨, extra]` | `done/verified` | own-file, extra | `commands_dropped` 1, `restore_path_tokens_off` 1, `verifiers_dropped` 1 | 같은 세 줄(일치) |

### 2.3 계획 워크플로의 적용(대본 모델)

- 설정의 워크플로 `tidy`: `plan: "apply"`, 자기 검증기 `own-moved`(`moved/a.txt`가 있다).
- task 파일 `[extra]`: 적용 결과 `failed/verifier_failed`, 검증기 `inventory:pass, own-moved:pass, extra:fail`.
  - extra는 이동된 `a.txt`가 있는지 보는 검사라, 이동 뒤에 실패하는 것이 맞다.
  - 엔진의 `inventory`와 정의의 검사가 모두 돌았다.
- task 파일에 같은 id `own-moved`를 느슨하게 주면: 적용 결과 `done/verified`. 정의의 `own-moved`가 돌았고 준 것은 빠졌다.
  - 계획 실행의 `run_started`에는 `verifiers_dropped` 1이 남았다.
  - 적용 실행의 `apply_started`에는 알림이 없다(L-2).

## 3. 낮음

### L-1 실행 시작 줄의 알림이 실제 CLI 출력에 나오지 않는다 (DR-43 (b), todo)

- 위치
  - `src/cli/run.ts:776`: 사람용 출력이 있으면(보통의 CLI) 진행 줄을 `human.output.progressLine(event)` 하나로 그린다.
  - 새 `narrowingLines`(`src/cli/progress.ts`)는 사람용 출력이 없을 때의 기본 렌더러에서만 쓰인다.
  - `src/cli/human/output.ts`는 `run_started.policyNarrowings`를 그리지 않는다.
  - `tests/unit/cli/g-dr43-progress.test.ts:77`이 todo로 남아 있다: "output owner (N-C): src/cli/human/output.ts draws run_started.policyNarrowings…".
- 재현: 알림이 있는 실행 모두(A4~A6, A10, A14, B1, B3, B5, B7, B9)에서 stderr에 알림 줄이 없다. 영어와 한국어 모두 같다. 예: B9는 `run_started`에 세 종류가 기록됐는데 stderr는 `run started — provider anthropic` 다음 바로 `turn 1`이다.
- 영향
  - 실행 중에 사람이 보는 곳에는 알림이 없다. 볼 수 있는 곳은 `doctor`(프로필·task 파일)와 실행 기록뿐이다.
  - GUI 엔진 호스트도 진행 항목을 `human.progressLine(record)` 한 줄로 만든다(`gui/src/engine-host/main.ts:86`). 그래서 실행 화면에도 없다 [코드]. GUI 설정 화면은 설정 수준의 알림을 보인다(I-6).
- 권고: 출력 담당이 `human/output.ts`에서 그린다(todo대로). 그 전까지는 사용 문서의 한계(16절 "정책에서 빠진 것의 알림")가 맞다.

### L-2 적용 실행은 합쳐진 검증기를 돌리지만, 그 실행의 기록과 출력에는 빠진 검증기의 알림이 없다

- 재현(2.3): 계획 실행의 `run_started`에는 `verifiers_dropped` 1이 있다. 그러나 계획 실행에서는 검증기가 돌지 않는다. 검증기가 실제로 도는 적용 실행의 `apply_started`에는 `policyNarrowings`가 없고, `apply`의 출력에도 없다.
- 원인: `apply_started` 계약에 그 필드가 없다(main도 없다). DR-41의 정책 알림도 같다. 적용은 명령을 돌리지 않으므로 정책 쪽은 영향이 작았지만, 검증기는 적용 때 도는 것이라 이번 변경으로 의미가 생겼다.
- 영향: 적용 결과를 보는 사람은 자기가 준 검증기 하나가 빠졌다는 것을 그 기록에서 알 수 없다. 정의의 검사는 돌았으므로 약해지는 것은 아니다.
- 권고: `apply_started`에도 같은 종류·개수를 남기거나, 적용 출력에서 계획 실행의 알림을 옮겨 보인다.

### L-3 `run --workflow`의 알림을 doctor로 미리 볼 수 없다

- 재현: B1·B7·B8은 `run --workflow checked`다. `doctor`에는 `--workflow` 옵션이 없어(`invalid_arguments`) 같은 조건으로 점검할 수 없다. 프로필 없이 돌린 doctor는 알림 0개이고, 실행의 `run_started`는 B1·B7에서 1이다.
- 영향: L-1과 겹쳐, `--workflow`로 고른 실행에서 빠진 검증기는 실행 기록에만 남는다.
- 권고: doctor가 `--workflow`를 받거나, L-1이 고쳐질 때 실행 시작 줄로 갈음한다고 문서에 적는다.

## 4. 정보

- **I-1 약해지는 길을 찾지 못한 경우(중점 1)**
  - 같은 id와 다른 인자·기대값·종류: 빠지고 정의의 것이 판정한다(A4~A6).
  - 같은 명령과 다른 id: 더해지기만 하고 정의의 것도 돈다(A8).
  - 빈 목록: 정의의 것을 지우지 않는다(A2, B4).
  - 같은 id의 같은 검사(키 순서만 다름): 조용히 하나로 본다(A7).
  - 준 목록 안의 id 중복: main과 같이 `invalid_task`(A9).
  - 순서: 정의의 것 다음 준 것이고, 준 것끼리는 준 순서다(A10).
  - 계획 적용: 엔진의 `inventory`와 정의의 검사가 모두 돈다(2.3).
  - 프로필의 `verifiers`는 설정의 것을 덮은 뒤(main과 같은 규칙) 정의와 합쳐진다(B2, B4). 간편 형식에서 알림을 세는 목록과 합치는 목록은 같다: 프로필을 입힌 설정(`src/cli/run.ts:563`, `underDefinition`).
- **I-2 작업 종류 없는 실행은 main과 같다(중점 2)**: A13, B6, `demo`, `organize-demo`(계획과 적용)의 결과 JSON과 사람용 stderr가 같다.
- **I-3 결과·기록·보고가 같은 수를 보인다(중점 3)**: 2.1의 모든 경우. `report`는 검증기를 id 없이 순번과 종류로 보인다(N-24).
- **I-4 알림에 값이 없다(중점 4)**
  - doctor 줄, `run_started.policyNarrowings`, 카탈로그 문구 모두 종류와 개수만 있다.
  - 한국어 doctor 줄도 같다(B5).
  - 개수는 doctor와 `run_started`가 프로필·task 파일 경로에서 일치했다(A4~A6, A10, A14, B3, B9).
- **I-5 영어 기본 렌더러의 문구가 카탈로그와 다르다**: `src/cli/progress.ts`의 `verifiers_dropped` 줄은 "the workflow's own checks leave out configured verifiers that take their ids: N"이다. 카탈로그 `progress.workflow_policy.verifiers_dropped`는 "the workflow's own checks leave out checks given in the config or task with the same id: {count}"이다. 다른 네 종류는 카탈로그와 같다. 지금 이 렌더러는 시험에서만 쓰인다(L-1).
- **I-6 앱 계층의 설정 보기는 설정 최상위의 검증기만 세고, 프로필의 것은 보지 않는다**
  - `src/app/settings.ts` `policyNarrowingsOf`의 머리말대로다("A profile's own policy and verifiers are not looked at here").
  - B2처럼 프로필이 자기 검증기를 두면 실행의 알림은 0인데, 설정 보기는 그 워크플로에 1을 보일 수 있다 [코드].
  - DR-41의 정책 알림도 같은 방식이라 이번 변경만의 것은 아니다. 넓히기 판정(`settings-change.ts:121`)은 합친 목록으로 비교한다 [코드, 시험 `settings-workflow-rules` 통과].

## 5. PM 판단 필요

- **P-1(L-1)**: 실행 시작 줄을 이번 묶음에 넣을지(출력 담당의 todo), 다음 묶음으로 미루고 사용 문서의 한계로 둘지
- **P-2(L-2)**: 적용 실행의 기록(`apply_started`)에 알림을 둘지

사용자에게 물을 질문은 없다.

## 6. 실행한 것

- 읽기: 위 커밋의 차이(`git diff main...pm/bundle-6`), `run.ts` 합치기 적용부(`underDefinition`, 560~630행), doctor의 같은 부분, `progress.ts`, 앱 계층 두 파일, 단위 시험 이름과 todo
- 빌드: `05f3b7c`(tsc 0). 단위 시험 35건(34 통과, todo 1)
- 실험: `r36-exp.mjs` A(task 파일 17건), B(간편 형식 10건), C(계획 적용 2건), D(예시 2개를 main과 비교), 계획·적용 기록 확인
- 저장소 파일 변경과 커밋 없음. 실제 API·외부 네트워크 미사용(가짜 서버는 127.0.0.1).
