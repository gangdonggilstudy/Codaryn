# R-108 검토 — na-core U-210 (묶음 A, A-6 CLI·정의), 계약 담당

- 검토자: w3:p9 p4g-general(계약 담당). 읽기만 했다. U-210 브랜치와 다른 worktree를 고치지 않았다.
- 대상: `unit/U-210-na-core` 끝 `fa4a8a84ede2c79498272d034c4491fce0adbe0e`. 기준은 main `a5790dfb244826b0cc3768c8fa54b25a12057328`(U-208 수용 뒤).
- U-210 자신의 커밋(병합 빼고):
  - 첫째 몫: `0ce26886`(시험), `942770cf`, `88e16766`(문서).
  - 둘째 몫: `078bbec5`·`d3036b81`(시험), `cf801e39`, `6ace7ed0`(문서).
  - 검증기 연결: `8d235734`(시험), `4b91efd8`, `fa4a8a84`(문서).
- 품은 것: U-207 `2361627`, U-208 `cf54cc9`(첫 커밋 `735fa24`), U-223 `832614d`.
- 기준 문서: DR-69·DR-70, 제안서 3.1~3.3(R-1~R-8, P-1~P-3, Q-4), 계약 `src/contracts/query.ts`·`task.ts`·`workflow.ts`·`verify.ts`.
- 방법:
  - 코드 읽기.
  - scratch 빌드(`git archive fa4a8a84` + node_modules 정션, worktree 없음, 끝난 뒤 정션만 지움)에서 재현 시험 두 개를 돌렸다. 저장소에는 넣지 않았다.
  - 합성 값만 썼다. 실제 API·외부 네트워크 없음.

**높음 2 / 중간 0 / 낮음 3.**

## H-1 높음 — 계획을 수행하는 실행의 관문에 실행의 읽기 제외 목록이 없다

- 위치: `src/cli/assemble.ts` 500행. `approvedPlan.policyFor: (writablePathSets) => createPolicyGate({ config: task.policy, workspace, writablePathSets })`.
  - 같은 함수의 448행 관문(일반 실행)에는 `...unreadable`이 있다. 이 줄에는 없다.
  - 이 줄은 U-195(묶음 B)에서 왔다. 그러나 "실행의 관문이 실행의 목록을 받는다"는 U-210의 몫이고, 승인된 계획을 수행하는 실행도 실행이다.
- 결과:
  - 그 실행의 관문은 `task.policy.unreadablePaths`(병합된 정책의 몫)만 본다.
  - task 파일 아래에서 설정 파일이나 프로필이 준 읽기 제외 항목(R-2: 늘 합침)은 `task.policy`에 없다. 그래서 그 아래 파일의 `read_file`이 허용된다.
  - 도구 실행기와 검증기는 같은 조립에서 목록을 받으므로 막힌다. 관문만 빠졌다.
- **재현**(scratch `r108/head/tests/unit/cli/r108-probe-carried.test.ts`, 실제 CLI, scripted 모델):
  1. 설정 파일: `policy.unreadablePaths: ["private"]`, `workflows.rewrite = {tools: [read_file, search_files, write_file, propose_changes], plan: "run"}`.
  2. task 파일: `workflowRef: "rewrite"`, 자기 정책에 읽기 제외 없음. `private/people.csv`에 카나리.
  3. 계획 실행: `read_file private/people.csv` → `unreadable_path`로 거부되고 카나리는 journal에 없다(대조군). 그다음 propose_changes → plan_pending.
  4. `apply --digest`로 수행하는 실행: 같은 `read_file`이 **허용되고 카나리가 journal의 tool_result에 있다**. `unreadable_path` 거부는 0이다. 모델에게 그 칸이 간다.
- 고칠 곳: 500행에 `...unreadable` 한 줄. 시험은 위 재현을 그대로 쓰면 된다.

## H-2 높음 — 앱(GUI)의 실행 조립이 목록과 k를 넘기지 않는다

- 위치: `src/app/assemble.ts` 66~84행(main에도 같다, p5a 파일).
  - 관문: `createPolicyGate({ config: task.policy, workspace, writablePathSets })`. `unreadablePaths`가 없다.
  - 도구 실행기: `createToolRunner({ workspace, privacy, commandRunner, changeRecorder, planRecorder })`. `unreadablePaths`·`minGroupSize`가 없다.
  - 검증기: `createVerifierRunner({ workspace, commandRunner })`. 목록이 없다.
  - 무결성 대상: `integrityPathsOf`가 아니다.
- **U-210이 들어오면 닿는다.** 지금 main에서는 파서가 `unreadablePaths`를 `unknown_field`로 거부하므로 앱 실행이 그 필드를 가질 수 없다. U-210은 파서가 받게 하고 앱도 같은 `prepareTask`를 쓰므로, 병합 즉시 앱 실행이 읽기 제외를 가진 채 이 조립으로 돈다.
- **재현**(scratch `r108/head/tests/unit/app/r108-probe-app.test.ts`, `createCodarynApp(...).startRun`, scripted 모델):
  1. task 파일의 `policy.unreadablePaths: ["private"]`, `private/people.csv`에 카나리 세 줄.
  2. `search_files {path: ".", text: <카나리>}` → **세 줄이 그대로 결과에 나온다**(`private/people.csv`, line 2~4, 값 포함).
  3. 같은 실행의 `read_file private/people.csv`는 `unreadable_path`로 거부된다. task 자신의 정책에 있어서 관문은 그 항목을 안다.
  4. 목록·이름 숨김, k, 검증기 근거 숨김만 없는 상태다.
- **코드로 본 같은 원인의 결과:**
  - `inspect_files`가 그 아래 이름·크기·해시를 준다.
  - `query_table`이 그 표를 일반 표로 본다(k 1, min·max 허용). 한 행 묶음의 값이 그대로 나간다.
  - data_checks가 그 표의 수를 근거에 쓴다.
  - 설정 파일이나 프로필의 목록(R-2)은 관문도 모른다.
- 판단: p5a의 파일이라 U-210이 고칠 곳은 아니다. 그러나 **U-210의 병합을 막는다.** 둘 중 하나가 함께 들어와야 한다.
  - (a) 앱 조립이 CLI처럼 `task.unreadablePaths`를 관문·도구·검증기에, `task.minGroupSize`를 도구에, `integrityPathsOf`를 무결성에 넘긴다. 앱의 계획 수행 실행(U-218/U-226)의 `policyFor`도 H-1처럼 목록을 받아야 한다.
  - (b) 그 전까지 앱이 `unreadablePaths`가 있는 실행을 거부한다(닫힌 쪽).

## 낮음

- **L-1 병합 준비**
  - U-210이 품은 U-208은 첫 커밋 `735fa24`뿐이다. V-19 고침(`9caf507`, main에 있음)은 main을 받으면 들어온다. merge-tree에서 `src/tools/query-table.ts`는 충돌 없이 합쳐진다.
  - U-223의 대상 넓힘 `f7b4b3bd`·`5555e24d`는 U-210에 없다.
  - main `a5790df`과의 충돌은 셋이다:
    - `src/cli/human/output.ts`.
    - `src/contracts/workflow.ts`: U-224의 `plan_tool_missing`과 둘 다 WORKFLOW_PROBLEMS 끝과 그 주석에 더했다. 셋 다 남긴다.
    - `src/i18n/ko.ts`: U-227.
- **L-2 끝 요약이 V-19로 숨긴 값을 세지 않는다**
  - `notePrivateData`와 U-207의 `queryTableFacts`(`src/cli/human/query-table.ts`)는 `suppressedGroups`만 읽는다.
  - V-19 뒤에는 묶음은 보이되 값이 기여 칸 k 미만으로 숨겨지는 결과(`fewCells`)가 있다. 그런 결과만 있는 실행의 끝 요약은 "숨긴 것"을 말하지 않는다. 값은 새지 않으므로 낮음이다.
  - nc-human·na-core 후속: fewCells가 있는 결과도 세거나, 그 줄의 말을 정한다.
- **L-3 계약 주석이 병합 뒤 실제와 어긋난다(내 파일, 병합 뒤 내가 고친다)**
  - `src/contracts/workflow.ts` 머리(U-219, main): "Named here only, not yet part of it: Markdown file rules and the analyze-private definition (A-6)". U-210이 들어오면 analyze-private는 계약의 일부다.
  - `src/contracts/query.ts` 머리(U-210이 고친 문장): "the CLI fills the run's list and k and gives them to the gate and the tool runner". 실제와 다른 점 셋:
    - 계획 수행 실행의 관문은 아니다(H-1).
    - 검증기 실행기도 받는다(U-223).
    - 앱은 아직이다(H-2).

## 문제없던 것

- **R-2 합침:** `runUnreadablePaths`는 설정·프로필·정의·task 순서로 `unreadablePathsOf`를 쓴다. task 파일 아래에서도 설정·프로필의 것을 합친다. 재현의 계획 실행에서 설정 목록만으로 `read_file`이 거부된 것으로 확인했다.
- **Q-4 k:** `parseMinGroupSize`는 5~1000의 정수다(MIN_GROUP_SIZE_LIMITS). `runMinGroupSize`는 `effectiveMinGroupSize(설정, 나머지)`이고 아무도 정하지 않으면 없다(도구 기본 5). 낮추는 원천이 없다.
- **R-5:** 정의 자신 → 주어진 것(task 파일 또는 설정) → 병합된 것의 순서로 `privateDataProblem`을 본다. 명령 규칙과 `command` 검증기를 실행을 기록하기 전에 거부하고, 필드는 쓴 자리를 가리킨다. doctor도 같은 목록으로 실패한다.
- **P-1·P-3 analyze-private:**
  - 도구: read_file, search_files, query_table, write_file. `allowCommands: false`. `human_review`(analyze의 두 항목 + PRIVATE_REVIEW_ITEM).
  - 읽기 제외가 없으면 `unreadable_paths_required`(`policy.unreadablePaths`)다.
  - 해석 순서는 allowCommands 뒤, plan 검사 앞이다. U-224의 `plan_tool_missing`과 부딪히지 않는다(plan "none").
- **P-2 analyze의 query_table:** 일반 표는 k 1이라 전과 같은 값을 준다.
- **이동 계획 적용(`plan-commands.ts`):** 관문·검증기·무결성이 적용 task의 목록을 받는다. 그 아래로 옮기거나 버리는 동작은 관문이 거부한다.
- **일반 실행의 조립(`assemble.ts` 448~478행):** 관문·도구(목록과 k)·검증기·무결성(`integrityPathsOf`)이 모두 받는다.
- **계약 주석(U-210이 고친 query.ts의 P-1·R-5 문장, workflow.ts의 WORKFLOW_PROBLEMS·ResolveWorkflowInput, human.ts의 SCHEMA_FIELD_NAMES와 doctor id)은 코드와 맞는다.** L-3 둘만 다르다.

## 수치

- scratch `fa4a8a84` 빌드: tsc 0.
- 유닛 3,828: 3,823 / 0 / 4 / 1. 통합 610/610. 재현 둘은 빼고 쟀다.
- 재현 시험 2건 모두 실패(위 두 높음). 대조군(계획 실행의 거부, 앱 실행의 read_file 거부)은 기대대로였다.
- `git merge-tree main(a5790df) U-210`: 충돌 셋(L-1).
