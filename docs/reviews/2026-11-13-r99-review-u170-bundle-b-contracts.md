# R-99 검토: 묶음 B 계약 (U-170)

- 검토자: N-A (CLI 개발자, 수석 아키텍트 보조). 읽기 전용, 커밋 없음.
- 판: `pm/unit-U-170` = `134c2ce` (main `f2a4625` + `unit/U-170-p4g-general` `746ba26`; 커밋 `ae50589`, `746ba26`; 13파일 +653 −23).
- 본 것: 제안서 `docs/reviews/2026-11-13-p1-bundle-proposal.md` 2절·4절(B-1~B-8), DR-69, 계약 diff 전부, p4g 보고(`claude-general/.codaryn/report-second-provider.md` U-170 절), nc-human 보고(`claude-tools/.codaryn/report-N-C.md` "묶음 B 미리 읽기"), 내 보고 114절.
- 실측: 판을 임시 로컬 브랜치로 빌드해 돌렸다(검토 뒤 지움). scripted 모델과 루프백 가짜 서버만 썼고 키는 가짜다. 탐침 스크립트는 `C:\Users\gangd\AppData\Local\Temp\claude\21110c3621286809\2fa8e259-784e-404e-91c9-15b3ccff7e02\scratchpad\r99-probe.test.mjs`(5건 통과, 출력 `r99-probe.txt`).

## 건수

| 높음 | 중간 | 낮음 |
| --- | --- | --- |
| 0 | 3 | 3 |

## 수치(판 134c2ce, 프로젝트 스크립트)

- typecheck 0
- test:unit 3347 (3342 통과, 0 실패, 4 건너뜀, 1 todo)
- test:integration 590/590. organize 요청의 도구 목록을 고정한 GG-F01 포함.
- SP-0 차이 없음("SP0 DIFF DONE"). `run --json`과 실행 요청 본문(시스템 글, 도구 목록) 고정 그대로.
- 판 비교 `scripts/compare-cli-boards.mjs --base f2a4625 --head 134c2ce`: 27사례, 차이 0. plan-apply, terminal-apply-yes/no, handoff 두 사례, errors, errors-ko 포함.

## 물은 것에 대한 답

1. **제안서와 계약:** B-1, B-3, B-5, B-6, B-7, B-8의 계약 몫은 맞다. B-4도 맞는데, 목록을 원천마다 따로 두는 방식은 글자 교집합보다 낫다(링크를 푼 뒤 넓어지는 경우를 막음). 다른 것은 B-2 하나다: 요약을 다이제스트 안에 묶었다(L-1).
2. **기존 apply의 출력·JSON·고정 값:** 그대로다. 판 비교 0, SP-0, 통합 시험 모두 확인했다. 기존 시험 두 파일의 바뀜은 더하기뿐이다. `PLAN_MODES` 기대값과 스키마 부분집합 검사에 `propose_changes`를 더했고, 검사를 늦춘 것은 없다.
3. **지금 `plan: "run"`을 주면:**
   - `run`(가짜 Anthropic): 요청 3번, 매번 도구는 `["read_file","search_files"]`뿐이다. `write_file`과 `propose_changes` 호출은 `unknown_tool`이고 파일은 생기지 않았다. 끝은 `failed`/`model_error`, 종료 1.
   - `apply --run <그 실행>`은 `run_not_plan`(2), `plan --run <그 실행>`도 `run_not_plan`(2)이다.
   - 손으로 만든 `kind: "changes"` plan.json(result.json의 다이제스트도 맞춤)은 `plan`과 `apply` 모두 `invalid_run_record`이고 아무것도 생기지 않았다.
   - 그러니 계획 run 자체로는 쓰기도 적용도 일어나지 않는다. 다만 정의와 함께 쓰면 쓰기가 일어나는 길이 하나 있다(M-1). 아무 일도 못 하는 실행에 모델 요청은 나간다(M-2).
4. **`propose_changes` 도구 정의가 요청에 실리는가:** 안 실린다.
   - 가짜 서버가 받은 모든 요청 본문에 문자열 `propose_changes`가 없다.
   - SP-0 실행 요청과 GG-F01 도구 목록은 그대로다.
   - `src`에서 계약 밖에 `PROPOSE_CHANGES_*`·`writablePathSets`·`PLANNED_FILE_DESCRIPTOR`를 쓰는 곳이 없다. `ALL_TOOL_DEFINITIONS`에도 없다.
5. **지금 `writablePaths`를 주면:** 네 자리 모두 **거부**된다. 조용히 무시되지 않는다.
   - task `policy`: `invalid_task`, `unknown_field`
   - 설정 `policy`: `invalid_config`, `unknown_field`
   - 프로필 `policy`: `invalid_config`
   - 정의 `policy`: `invalid_config`
   - 쓰기는 일어나지 않았다. 진단 꼴이 자리마다 다른 것은 이전부터 있던 것이다(아래 "물려받은 것").
6. **114절과 nc-human의 바람:** 아래 표. 빠진 것 가운데 B-3/B-4가 기대는 것은 M-3이다.

## 중간

### M-1 정의의 `plan: "run"`을 task 파일이 `plan: "none"`으로 풀 수 있고, 그러면 승인 없이 쓴다

- **계약은 막는다고 적는다.** `src/contracts/task.ts`의 `TaskSpec.plan` 주석과 `workflow.ts`의 `plan_weakened`: "a definition's "apply" or "run" never becomes "none"".
- **코드는 `apply`만 본다.** `src/workflows/index.ts:137`: `if (base.plan === "apply" && task.plan === "none")`.
- **이 판에서 처음 닿는 길이다.** 설정 파서가 이제 정의의 `plan: "run"`을 받는다. 판 전에는 `invalid_config`("must be one of none, apply")였다(f2a4625의 `PLAN_MODES`와 `parsePlanMode`로 확인, 실행하지는 않음).
- **실측(P6):**
  - 설정 `workflows.rundef = {tools: [read_file, search_files, write_file], plan: "run"}`
  - task 파일 `{workflowRef: "rundef", plan: "none"}`
  - 결과: `write file — allowed`, `created b.txt`, 종료 3(`no_verifier`). 같은 정의에서 task가 `plan`을 적지 않으면 쓰기는 `unknown_tool`이다(P6b).
- **p4g 보고와 다른 점.** F-1은 "지금은 run이 쓰지 못해 위험 없음, B-3 전"이라고 했다. 그러나 쓰는 것은 풀린 결과인 `plan: "none"`의 보통 실행이다. 정의를 만든 사람은 "승인 뒤에만 쓴다"를 바랐는데, task 파일(저장소에서 올 수 있는 덜 믿을 입력)이 그것을 끈다.
- **권고(병합 전이나 바로 다음):** 둘 중 하나.
  - (가) `src/workflows/index.ts:137`을 `base.plan !== "none" && task.plan === "none"`으로 바꾸고 시험 하나를 더한다. 한 줄이다.
  - (나) M-2의 권고(CLI가 B-4 전까지 `run`을 거부)를 따른다. 그러면 정의의 `run`도 설정에서 거부되어 이 길이 닫힌다.

### M-2 `plan: "run"`이 받아들여져 실제 모델 실행을 시작하지만 성공할 수 없고, 안내가 틀린다

- **판 전:** `plan: "run"`은 요청 전에 `invalid_task`였다(f2a4625의 코드로 확인, 실행하지는 않음).
- **지금:** 실행이 시작된다.
  - 실제 제공자라면 읽기 도구만 가진 모델에게 턴 한도까지 요청이 간다(가짜 서버에서 3번).
  - 끝은 늘 `failed`/`model_error`이고 사람용 글이 맞지 않는다.
    - 진행 줄 "model request failed (malformed_response)"
    - 알림 "the run ended without a plan: propose_plan did not succeed"(run 방식의 도구는 `propose_changes`다)
    - 고치는 법 "Check with codaryn doctor and codaryn models, then try again later."
- **값을 권하는 글이 생겼다.** 잘못된 값의 오류가 이제 `plan must be one of none, apply, run`이라 `run`을 써 보라고 권하는 셈이다.
- **쓰기는 없다.** 실측으로 확인했다.
- **p4g의 F-2는 "그대로 두기"를 권하고 PM 결정으로 남겼다.**
- **권고:** 계약의 `PLAN_MODES`는 두고, CLI의 `parsePlanMode`(`src/cli/task.ts:380`, 내 소유)가 B-4 전까지 `run`을 전용 문구로 거부한다.
  - task 파일, 정의, `--workflow`가 모두 이 함수를 지난다. 앱 계층도 같은 파서를 쓴다.
  - 요청 전에 끝나고, 토큰을 쓰지 않으며, M-1도 함께 닫힌다.
  - 글은 예: "plan \"run\" is not available yet; use none or apply".
  - 요청하면 작은 단위로 하겠다.

### M-3 B-3/B-4가 기댈 계약 몇 가지가 이 단위에도, p4g의 "따라오는 것"(F-1~F-10)에도 없다

다음은 모두 더하기만으로 들일 수 있다. 그래도 담당과 시점이 정해지지 않으면 B-4에서 잘못 보이거나 막힌다.

| 빠진 것 | 왜 필요한가 | 바란 곳 |
| --- | --- | --- |
| `RunListEntry.planRunId`를 `kind: "run"` 항목에도 두고, `planApplyStateOf`가 `planRunId`가 그 계획인 `kind: "run"` 실행을 그 계획의 적용으로 받는 규칙 | 지금 규칙(`kind === "apply"`만)이면 B-4 뒤 run 계획의 적용이 `runs`·`changes`·`report`·되돌리기 안내에서 모두 `record_missing`으로 보인다 | 114절 4-7, nc-human |
| `PlanOutput`의 run 종류(판별 필드와 `files`; apply 종류 JSON은 그대로) | `plan` 보기·`--json`·GUI 승인 화면 | 114절 4-4 |
| `LoadPlanOutcome`의 합집합, `PlanRecorder`의 changes 저장 메서드 | store가 읽고 쓰는 꼴. F-6은 "읽기"만 적고 계약의 모양은 적지 않았다 | nc-human |
| `EngineResult.plan`의 종류(또는 파일 수와 동작 수를 가를 필드) | 끝 요약 "계획을 만들었습니다: 동작 N개"가 run 계획에서 틀린다. 결과만 읽는 GUI도 같다 | nc-human |

- 더해도 되는 것: B-8 doctor 글 id, `writablePaths`의 축소 알림 종류, 문구 id 초안은 B-4 쪽에서 임시 규칙으로 더해도 된다고 본다.

## 낮음

### L-1 요약을 plan.json(다이제스트 안)에 묶었다. 제안서 B-2의 글과 다르다

- 제안서 B-2는 "경로와 계획 때 있던 파일의 해시만 묶는다. 요약은 지시문으로만 쓰고 강제하지 않는다"이다. DR-69는 권고대로 시작한다고 정했다.
- 계약은 `StoredChangesPlan.summary`(가린 조각)를 다이제스트 안에 둔다. 강제하지 않는다는 점은 같다.
- 방향은 더 안전하다. 승인한 지시와 실행이 받는 지시가 같아진다. 내 114절 Q4가 이것을 물었다.
- 다만 p4g 보고는 "권고대로"라고만 적었다. 제안서와 다른 결정으로 PM이 기록해 주기를 권한다(DR 한 줄이나 B-2 보정).

### L-2 정의의 `apply`와 `run`을 task가 서로 바꿀 수 있고, 정의의 계획 도구가 그 방식과 맞는지 보지 않는다

- **실측:**
  - built-in `organize`(`apply`) 아래 task `plan: "run"`이 받아들여졌다. 계획 도구가 없어 실패한다(P6d).
  - 사용자 정의 `plan: "run"`에 `tools`로 `propose_plan`을 적고 task `plan: "apply"`를 준 것도 받아들여졌다(P6c).
- **지금 위험은 없다.**
  - 도구는 좁히기만 하므로 task가 `propose_changes`를 더할 수 없다.
  - 두 방식 모두 승인을 거친다.
- **그래도 계약이 규칙을 말하지 않는다.** 규칙은 "none으로는 못 낮춘다"뿐이다.
- **권고:**
  - task는 정의의 `apply`·`run`을 바꾸지 못한다(`plan_weakened`, 또는 새 문제 없이 같은 문제).
  - 정의의 `tools`에 다른 방식의 계획 도구가 있으면 해석에서 거부한다.
  - B-3에서 `propose_changes`가 `WORKFLOW_TOOL_NAMES`에 들어가기 전에 정하면 싸다(114절 4-1).

### L-3 `SCHEMA_FIELD_NAMES`에 `writablePaths`가 없다

- B-4에서 파서가 이 필드를 받으면 형식 오류의 진단이 필드 자리를 말하지 못한다. `toSchemaFieldPath`가 null이 된다.
- 계약 단위(이번이든 B-4의 계약 몫이든)에서 `writablePaths`를 더하길 권한다. `planActions`도 없다.

## 114절·nc-human의 바람과 이 계약

| 바람 | 이 판 |
| --- | --- |
| 114 4-1 `PLAN_MODES`에 run, `plan_weakened`를 run에도 | 계약 글은 됨, 코드는 안 됨(M-1). apply와 run 서로 바꾸기는 없음(L-2) |
| 114 4-2 / nc 저장된 계획을 종류로 가름 | `StoredChangesPlan`(`kind: "changes"`, `shown` 조각) 됨. 합집합 별칭과 `loadPlan`·`PlanRecorder`는 없음(M-3) |
| 114 4-3 요약을 다이제스트 안에 | 됨(L-1: 제안서 글과 다름을 기록할 것) |
| 114 4-4 `PlanOutput` run 종류 | 없음(M-3) |
| 114 4-5 엔진에 넘길 승인된 계획 | 없음. p4g F-7(B-3, p4g 몫)에 있음 |
| 114 4-6 `run_started`·`EngineResult` 필드 | 됨(`planRunId`, `planDigest`, `approval`) |
| 114 4-7 / nc `RunListEntry.planRunId`, `planApplyStateOf` | 없음(M-3) |
| 114 4-8 `writablePaths` 형식 | 됨(protectedPaths 형식과 맞춤, fail closed). 내 바람의 "100개, 파일만"은 내가 정책 목록과 계획 파일을 섞은 것이다. 계약대로 정책 목록은 접두사(B-4의 `out/` 예), 계획 파일은 정확히 그 파일(B-5)이 맞다. `SCHEMA_FIELD_NAMES`는 없음(L-3) |
| 114 4-9 `[]`의 뜻 | 됨: "Present and empty: no file tool may write" |
| 114 4-10 합치기, 설정 목록이 task 파일에도 | 됨: 목록마다 따로, 설정·프로필 목록이 task 파일 실행에도 걸림(F-8). 축소 알림 종류는 없음(B-4에서 가능) |
| 114 4-11 doctor 글 id | 없음(B-4에서 임시 규칙으로 가능) |
| 114 4-12 새 오류 코드 없음 | 맞음. 정책 거부 코드 `path_not_writable`은 B-2(F-4) |
| 114 4-13 / nc 문구 id 초안 | 없음(B-2~B-5) |
| nc `PlanAppliedRecord` 이름 유지 | 됨(바뀌지 않음) |
| nc `EngineResult.plan` 종류 | 없음(M-3) |

## 물려받은 것(G-8, 고치지 않음, 건수에 넣지 않음)

- 정책의 모르는 필드에 대한 진단이 자리마다 다르다.
  - task와 설정의 `policy`: `diagnostic.code: unknown_field`, 사람용 "has an unknown field"
  - 프로필의 `policy`: `invalid_value`, "has an invalid value"
  - 정의의 `policy`: `diagnostic` 없음
  - f2a4625에서도 같다(이 단위가 만든 것이 아님).
- 계획 실행이 계획 없이 끝날 때의 진행 줄 "model request failed (malformed_response)"와 고치는 법은 apply 방식에서도 이전부터 같다. run 방식에서는 늘 나온다는 점만 새롭다(M-2).
