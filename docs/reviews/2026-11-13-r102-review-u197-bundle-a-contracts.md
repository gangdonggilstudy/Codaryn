# R-102 검토: 묶음 A 계약 (U-197)

- 검토자: N-A (CLI 개발자, 수석 아키텍트 보조). 읽기 전용, 커밋 없음. 뒤에 할 A-6(CLI 파서, 실효 k, 명령 금지, analyze-private)의 눈으로 봤다.
- 판: `pm/unit-U-197` = `4adad57` (main `71437e2` + `unit/U-197-p4g-general` `f9298ae`, 14파일 +535 −4).
- 본 것: 제안서 `docs/reviews/2026-11-13-p1-bundle-proposal.md` 3절(Q-1~Q-9, R-1~R-8, P-1~P-4), DR-69·DR-70, 계약 diff 전부, p4g 보고(`claude-general/.codaryn/report-second-provider.md` U-197 절).
- 실측: 판을 임시 로컬 브랜치로 빌드해 돌렸다(검토 뒤 지움). scripted 모델과 루프백 가짜 서버만 썼고 키는 가짜다. 탐침 `C:\Users\gangd\AppData\Local\Temp\claude\21110c3621286809\2fa8e259-784e-404e-91c9-15b3ccff7e02\scratchpad\r102-probe.test.mjs`(3건 통과, 출력 `r102-probe.txt`).

## 건수

| 높음 | 중간 | 낮음 |
| --- | --- | --- |
| 0 | 1 | 5 |

## 수치(판 4adad57, 프로젝트 스크립트)

- typecheck 0
- test:unit 3513(3508 통과, 0 실패, 4 건너뜀, 1 todo)
- test:integration 610/610
- SP-0 차이 없음(실행 요청의 도구 정의 포함)
- 판 비교 `scripts/compare-cli-boards.mjs --base 71437e2 --head 4adad57`: 27사례, 차이 0
- 바뀐 기존 시험 셋은 더하기와 자리 맞춤뿐이다.
  - `g-u175-denial-code`: "맨 끝"을 "confirmation_required 다음 자리"로
  - `u50-failure-hints`: 목록에 too_many_groups
  - `g-u143`: query_table 정의를 스키마 부분집합 검사에 더함

## 물은 것에 대한 답

1. **제안서와 계약:** 맞는다.
   - Q-2: 읽기 제외 표는 count·sum·mean만, 일반 표는 다섯.
   - Q-3: 묶음 열 0~2, 걸러내기 없음.
   - Q-4: k 기본 5, 2~1000, 설정이 바탕이고 다른 원천은 올리기만, 읽기 제외 밖은 1. `suppressedGroups`는 개수만이고 숨긴 행 수는 주지 않는다.
   - Q-5: 64 MiB, 10,000, 200, 8. Q-6: describe와 k 미만 숨김. Q-7·R-6: 적어 둠(A-2, A-7). Q-9: 반올림 없음.
   - R-1: 형식과 판정이 protectedPaths와 같다. R-2: 합집합, task 파일 실행에도 설정의 것. R-3: `aggregate` 접근. R-4: 이름째 뺌. R-5: 문제 `unreadable_with_commands`. R-8: `unreadable_path`.
   - P-1: id와 `unreadable_paths_required`.
   - DR-70의 "합친다"를 "개수 하나로"로 읽은 것은 p4g도 PM 결정으로 올렸다. 제안서 Q-4와 같은 쪽이다.
   - 하나 걸리는 것은 실효 k와 읽기 제외 합집합이 **어디에 놓이는지**다(M-1).
2. **파서(A-6)가 기댈 형식·상수·오류 코드:**
   - 형식: unreadablePaths는 `checkProtectedPaths`를 그대로 쓴다.
   - 상수: `MIN_GROUP_SIZE_LIMITS`, `DEFAULT_MIN_GROUP_SIZE`, `effectiveMinGroupSize`.
   - 해석 문제: `PRIVATE_DATA_WORKFLOW_PROBLEMS`.
   - 새 CLI 오류 코드는 필요 없다(`invalid_task`·`invalid_config`와 해석 문제).
   - 빠진 것은 M-1(실효 값의 자리), L-3(정수), L-4(진단 필드 이름)다.
   - 해석 문제를 `WORKFLOW_PROBLEMS`에 합치는 것, `resolveWorkflow`의 입력(명령 검증기, 읽기 제외 유무), analyze-private 정의와 `BUILTIN_WORKFLOW_IDS`는 p4g 보고의 F-5대로 A-6 몫이다. 결함은 아니다.
3. **기존 출력·JSON:** 그대로다. 판 비교 0, SP-0, 통합 610/610, 정책 모르는 필드 오류의 "allowed fields" 목록도 그대로다.
4. **지금 누가 주면:** 모두 **거부**되고 조용히 무시되지 않는다. 실행 기록도 만들지 않는다.

   | 무엇을 | 결과 |
   | --- | --- |
   | task `policy.unreadablePaths` | `invalid_task`(`unknown_field`) |
   | task `policy.minGroupSize` | `invalid_task`(`unknown_field`) |
   | 설정·프로필·정의의 `policy.unreadablePaths` | `invalid_config` |
   | task `tools`에 `query_table` | `invalid_task`("tools[1] must be one of …") |
   | 설정 정의의 `tools`에 `query_table` | `invalid_config` |
   | task `workflowRef: "analyze-private"` | `invalid_task`, 힌트 `task_type_not_found` |
   | `--workflow analyze-private`(간편 형식) | `invalid_config`, 힌트 `task_type_not_found` |
   | 모델이 `query_table`을 부름(가짜 Anthropic) | `unknown_tool`. 모든 요청의 도구는 `["read_file","search_files","write_file","run_command"]`이고 query_table은 실리지 않는다 |

## 중간

### M-1 실효 k와 읽기 제외 합집합이 놓일 자리가 없고, `mergeWorkflowPolicy`의 k가 그 규칙과 다르다

- **계약의 규칙**(`effectiveMinGroupSize`, `PolicyConfig.minGroupSize` 주석): k는 **설정 파일의 값**(없으면 5)을 바탕으로 하고, 프로필·정의·task 파일은 **올리기만** 한다.
- **같은 계약의 `mergeWorkflowPolicy`:** 정의의 값과 "주어진 정책"의 값 중 큰 쪽을 합친 정책의 `minGroupSize`로 싣는다. 그런데 주어진 정책은 다음과 같다.
  - task 파일이면 **task 파일 자신의 정책**이다(설정 정책을 대신함, 18.1.1).
  - 간편 형식이면 프로필의 정책, 없으면 설정의 정책이다.
  - 그래서 합친 값에는 설정의 바탕(과 기본 5)이 빠진다.
- **예:**
  - 설정이 k=10, task 파일이 `minGroupSize: 2` → 규칙은 10이다. task 파일에 정의가 없으면 그 자신의 정책이 그대로 실행의 정책이 되어 2다.
  - 설정이 k를 두지 않고 task 파일이 2 → 규칙은 5인데 정책은 2다.
- **놓일 자리가 없다.** 쓰기 목록은 `ResolvedTaskSpec.writablePathSets`라는 해석된 자리가 있다(U-170, U-182). 실효 k와 읽기 제외 합집합은 그런 자리가 없다.
  - A-5(도구에 k를 넘김)와 A-3(게이트가 unreadablePaths를 읽음)이 `task.policy`의 값을 읽으면 위의 낮아진 k와 빠진 항목을 쓰게 된다.
  - 프로필의 정책이 설정 정책을 대신하는 간편 형식에서도 설정 자신의 읽기 제외가 빠진다. 계약 글("the config file … may each add entries")은 맞지만, 그것을 누가 어디에 모으는지가 없다.
- **지금 위험은 없다:** 파서가 두 필드를 거부한다. 그러나 A-3·A-5·A-6이 따로 구현하면서 엇갈리기 쉬운 자리다.
- **권고(계약, A-3·A-5 전에):**
  - (가) `ResolvedTaskSpec`에 해석된 값을 둔다. 예: `minGroupSize`(실효 k)와 `unreadablePaths`(모든 원천의 합집합). 게이트와 도구는 그것만 읽는다고 적는다. CLI(A-6)가 원천마다 따로 모아 채운다(writablePathSetsOf처럼, 설정 파일 자신의 정책은 `--profile` 전에).
  - (나) `mergeWorkflowPolicy`는 `minGroupSize`를 합치지 않거나, "실행이 읽는 값이 아니다"를 writablePaths처럼 적는다. 읽기 제외의 합집합은 정의와 주어진 정책만이라 설정 자신의 것이 빠질 수 있다는 것도 함께 적는다.

## 낮음

### L-1 `next`도 결과의 자유 문자열인데 꼴이 정해져 있지 않다

- `QueryTablePayload` 주석은 "the only free text in it is column names and the keys of the groups shown"이라고 하는데, `next: string | null`도 문자열이다.
- 구현(A-5)이 다음 묶음의 키나 칸 값을 넣으면 그 약속과 어긋난다. 숨긴 묶음의 키를 넣으면 DR-70을 넘는다.
- **권고:** `next`는 보인 묶음과 질의만으로 만든 불투명한 값(예: 쪽 번호와 질의 digest)이라고 계약에 적고, 계약 시험의 "자유 문자열" 목록에 넣는다.

### L-2 숨긴 행 수를 주지 않는 까닭의 글이 실제와 맞지 않는다

- 주석은 숨긴 묶음의 행 수를 주지 않는다고 하고, 까닭을 "it would follow from the totals"로 든다.
- 그런데 총계는 이미 나온다. describe의 `rows`(행이 k 이상일 때)와, `groupBy` 없는 질의의 한 묶음(행 수·count)이다. 그래서 총계에서 보인 묶음의 행을 빼면 숨긴 행 수가 나온다.
- 보호가 줄지는 않는다. Q-8이 차감을 한계로 적었다. 다만 글이 "막는다"로 읽힌다.
- **권고:** "숨긴 행 수를 따로 주지는 않지만 총계에서 뺄 수 있다(Q-8)"로 고친다.

### L-3 `minGroupSize`가 정수라는 것이 계약에 없다

- `MIN_GROUP_SIZE_LIMITS`는 범위만 말한다. 파서(A-6)는 정수(`Number.isSafeInteger`)로 거르겠지만, 계약 주석에 "정수"를 적어 두면 앱 계층(설정 화면)과 판정이 같아진다.

### L-4 `SCHEMA_FIELD_NAMES`에 `unreadablePaths`·`minGroupSize`가 없다

- 파서가 받을 때 진단이 필드 자리를 말하지 못한다(R-99 L-3과 같음). p4g 보고 F-9가 이것을 적었다.
- 다만 F-9의 "writablePaths도 없다"는 낡았다. U-182가 더했고 이 판에도 있다(`src/contracts/human.ts` 212줄).
- A-6에서 함께 넣으면 된다.

### L-5 `invalid_table`에는 모델에게 주는 다음 행동 안내가 없다

- `TOOL_FAILURE_HINTS`는 부분 표라서 `too_many_groups`에만 안내를 더했다.
- `invalid_table`의 문제 가운데 `unknown_column`·`duplicate_column`은 "describe로 열을 보라"가 바로 다음 행동이다.
- 시험(`u50-failure-hints`)에 같이 더하기를 권한다.

## A-6 준비로 적어 둘 것(건수에 넣지 않음)

- **R-5 판정의 입력:** 지금 `resolveWorkflow`는 task 자신의 명령 규칙 수만 받는다. 명령 검증기(설정·task·정의의 합친 것)와 실효 읽기 제외 유무가 필요하다. 계약의 `ResolveWorkflowRequest`가 바뀐다(p4g, F-5).
- **설정 넓히기(R-7, p5a):** k를 낮추는 것과 읽기 제외 항목을 빼는 것. 정의의 목록과 k도 원천마다 따로 비교해야 한다(writablePaths 때 U-182에 적은 것과 같은 함정).
- **doctor:** R-5 문제와 실효 k를 보이는 줄의 문구 id(A-6, 임시 규칙의 문구 id).
- **`QUERY_TABLE_DEFINITION`:** `describe`가 boolean이라 `false`도 스키마를 지난다. 인자 검사(A-5)에서 `describe: false`를 어떻게 볼지(없는 것과 같음, 또는 `invalid_args`) 정하면 된다.
