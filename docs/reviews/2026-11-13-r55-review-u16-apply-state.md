# R-55 병합 전 검토: 단위 U-16 — 상태를 사실대로(UXM-4·5·15)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어(주), 보안·개인정보 검토자(보조). 이 코드는 내 것이 아니다. 읽기 전용이며, 저장소 파일 수정과 커밋은 없다.
- **검토한 판(고정)**: `pm/unit-U-16` = `aaabfd7f425c429c91b74d6b12fbef276e5f1e3e`
  - 기준은 main `b2dad78`이다. `git diff b2dad78...pm/unit-U-16`: 25개 파일, 753줄 더함, 11줄 뺌.
  - 범위 커밋(작성자 모두 `gangdonggil`)
    - 계약: `a9e8761`
    - 엔진: `f24a239`
    - CLI: `066d6ce`, `cc1cf8d`, `53fdac8`, `804ec3a`
    - 앱: `0987bcb`
    - 문구: `9085b29`
    - 시험: `2bc1b3a`, `be5848f`, `417ecb2`, `2e537ea`, `4f7d1dc`
- 빌드: `git archive`로 `aaabfd7`은 `.codaryn/r55/b`에, `b2dad78`은 `.codaryn/r55/m`에 풀었다. 둘 다 tsc 오류 0이다.
- 실험
  - 실제 CLI를 임시 폴더(`%TEMP%`)에서, 같은 스크립트로 두 판에 돌려 맞대었다. 모델은 대본 모델이고, API 주소는 닫힌 포트 `127.0.0.1:9`, 키 변수는 없앴다. 실제 API와 외부 네트워크는 쓰지 않았다.
  - `exp.mjs`
    - UXM-4·5: 점검의 재현 절차 그대로(파일 정리 체험의 계획 → 적용 → `runs` → 적용 실행의 `changes` → 계획 실행의 `revert`), 한국어와 영어
    - UXM-15: task 파일로 만든 계획을 간편 형식으로 적용. 변형 넷 포함
    - 경계: 적용 전 취소, 도는 적용, 검증 중 취소, 적용 되돌림, 적용 실행 기록의 정리
    - 평범한 실행의 비교
  - `exp2.mjs`: 중간에 실패한 적용(`apply_incomplete`), 두 번 시도한 적용
  - 지우기·폴더 만들기 거부는 ACL로 만들었고 끝나고 풀었다(남은 거부 항목 0).
  - 출력은 `.codaryn/r55/exp-b.txt`, `exp-m.txt`, `exp2-b.txt`, `exp2-m.txt`에 있다.
- PM이 이 판에서 잰 수치(typecheck 0, 유닛 2202건 중 2198 통과·실패 0, 통합 559 통과)는 받았고 다시 돌리지 않았다. GUI 시험은 돌리지 않았다. 이 판은 `gui/`를 바꾸지 않는다.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 1 (M-1) |
| 낮음 | 3 (L-1, L-2, L-3) |
| 정보 | 4 (I-1 ~ I-4) |

| 확인할 것 | 결과 |
| --- | --- |
| (1) 세 가지가 사실대로 나오는지(재현 절차 그대로, 두 언어) | **이 절차에서는 그렇다.** (가) 적용이 끝난 계획 실행: `계획 적용됨(적용 실행 <id>)` / `plan applied by run <id>`, JSON에 `appliedBy`. 계획 실행을 되돌리면 되돌리기 기록을 쓰지 않고, 적용 실행을 되돌리라는 안내가 붙는다. (나) 적용 실행의 `changes`: `the run is an apply run: it applied 3 action(s) of the plan of run <id> …`, JSON에 `applyRun`. (다) 다른 task로 적용: 막지 않고 알린다(두 언어, `noticeKinds: ["plan_task_differs"]`) |
| (2) 새 상태가 거짓이 되는 경우 | **있다.** 계획 줄의 "적용됨"이 적용 실행의 결과를 보지 않는다. 중간에 실패한 적용(3개 중 1개), 검증 중 취소, 아직 도는 적용, 되돌린 적용, 정리로 기록이 지워진 적용에서도 같은 말이다(M-1). 되돌리기 안내는 없는 실행을 가리킬 수 있다(L-1). 도는 적용의 `changes`는 "바꾼 파일 없음"이다(L-2). 적용 전 취소와 사전 점검 실패는 "확인 필요"로 맞게 남는다. 두 번 시도는 맞게 보인다 |
| (3) 평범한 실행의 출력 | **main과 같다.** 3절 체험 실행의 `runs`(글·JSON), `changes`(글·JSON), 적용하지 않은 계획 실행의 `runs --json`, 같은 task로 한 `apply`(JSON·stderr)가 정규화 뒤 같다. 적용된 계획 실행의 `runs --json`은 `appliedBy`만 더해졌고, 적용 실행의 `changes --json`은 `applyRun`만 더해졌다 |
| (4) 검증이 빠졌다는 알림 | **값은 싣지 않는다. 개수는 말하지 않는다.** 알림은 task id가 다르다는 것만 말한다. task 파일로 만든 계획(검증 2)을 간편 형식으로 적용하면 `Checks passed: 1 of 1`과 알림이 나오고, 하나가 빠졌다는 말은 없다. task id만 보므로 id가 같으면(간편 형식끼리, id `quick`) 빠져도 조용하고, id만 다르면 같은 검증이어도 알린다(L-3) |

## 2. 확인 결과

### 2.1 UXM-4·5 재현 절차(파일 정리 체험, 한국어)

| 단계 | main `b2dad78` | U-16 `aaabfd7` |
| --- | --- | --- |
| `runs`의 계획 줄 | `확인 필요 (needs-input/plan_pending)` | `계획 적용됨(적용 실행 <적용 id>) (needs-input/plan_pending)` |
| `runs --json`의 계획 항목 | 그대로 | 같은 필드에 `appliedBy {runId, at}`를 더함 |
| 적용 실행의 `changes` | `the run changed no file` | `the run is an apply run: it applied 3 action(s) of the plan of run <계획 id> (moves and discards, not file writes); codaryn report lists them` |
| 적용 실행의 `changes --json` | `files: []` | `files: []`, `applyRun {planRunId, actions: 3}` |
| 계획 실행의 `revert`(·`--dry-run`) | `되돌린 파일 0개 (complete)`, `revert.json`을 씀. 목록에 `· 되돌림 (complete)` | 같은 첫 줄과 JSON에 안내 한 줄: `Run <계획 id> only made a plan and changed no file itself, … revert that run (--run <적용 id>).` `revert.json`을 쓰지 않음. 목록에 "되돌림"이 붙지 않음. 파일은 그대로 |

- 영어도 같다(`plan applied by run <id>`).
- `changes`의 글과 되돌리기 안내는 한국어 출력에서도 영어다(I-1).

### 2.2 UXM-15와 그 변형(`exp.mjs` 2)

| 경우 | main | U-16 |
| --- | --- | --- |
| task 파일로 계획, 간편 형식(`--workspace … --workflow organize`)으로 적용 | `Checks passed: 1 of 1`, 알림 없음 | `Checks passed: 1 of 1` + 알림(영어·한국어), JSON `noticeKinds: ["plan_task_differs"]`, `notices`에 고정 영어 한 줄 |
| 같은 task 파일로 적용 | `2 of 2` | 같음, 알림 없음 |
| id만 바꾼 task 파일(검증은 같음) | `2 of 2` | `2 of 2` + 알림 |
| 같은 id, 계획 뒤에 task 파일의 검증을 지움 | `1 of 1` | 같음, 알림 없음 |
| id가 `quick`인 task 파일로 계획, 간편 형식으로 적용(검증 2 → 1) | `1 of 1` | 같음, 알림 없음 |

- 알림 글: `The plan was made with another task than the one given to this apply (for example a task file, and the quick form now): the checks and rules used are this apply's, not those of the plan's task. …` / `계획은 이 적용에 준 것과 다른 작업으로 만들었습니다(예: 계획은 task 파일, 적용은 간편 형식). …`
- 명령, 경로, 검증 id 같은 값은 없다.

### 2.3 경계 경우(`exp.mjs` 3, `exp2.mjs`)

| 경우 | 적용 실행 | 계획 줄(U-16) | 계획 줄(main) |
| --- | --- | --- | --- |
| 사전 점검 실패(원본 지우기 거부) | `failed/plan_stale`, 아무것도 안 옮김 | `needs input` (맞음, 다시 적용 가능) | 같음 |
| 적용 전 취소 파일 | `cancelled`, `applied.json` 없음 | `needs input` (맞음) | 같음 |
| 중간 실패(두 번째 이동의 폴더를 만들 수 없음) | `failed/apply_incomplete`, 3개 중 1개 옮김 | **`plan applied by run <적용 id>`** | `needs input` |
| 그 계획을 다시 적용 | `plan_already_applied`(종료 2) | 같음 | 같음 |
| 적용이 도는 중(검증기가 기다림, 세 파일은 이미 옮김) | `no result (running or stopped)` | **`plan applied by run <적용 id>`** | — |
| 검증 중 취소 | `cancelled`, 변경 3 | **`plan applied by run <적용 id>`** | — |
| 적용을 되돌림 | `done · reverted (complete)` | **`plan applied by run <적용 id>`** | `needs input` |
| 되돌린 적용 실행의 기록을 정리로 지움 | 목록에 없음 | **`plan applied by run <없는 id>`** | `needs input` |
| 거부된 시도 뒤 다시 적용해 성공 | 첫째 `plan_stale`, 둘째 `done` | `plan applied by run <둘째 id>` (맞음) | `needs input` |
| 성공 뒤 다시 적용 | `plan_already_applied` | 첫 적용 id (맞음) | `needs input` |

## 3. 중간

### M-1 계획 실행의 "적용됨"이 적용의 결과와 상관없이 붙는다

- 원인: `src/store/runs.ts`의 `appliedByOf`·`appliedByAt`는 계획 폴더의 `applied.json`만 본다.
  - `applied.json`은 적용이 사전 점검을 통과한 뒤 이동을 시작하기 직전에 쓴다(`src/engine/apply.ts`의 3단계 `markApplied`).
  - 그래서 적용이 그 뒤에 어떻게 끝났는지(실패, 취소, 아직 도는 중), 나중에 되돌렸는지, 그 적용 실행의 기록이 아직 있는지를 보지 않는다. 사람용 글(`runs.plan_applied`, `src/cli/human/output.ts`)도 그 항목만 본다.
- 재현: 2.3. 가장 흔할 경우는 중간 실패다.
  - 권한이나 다른 프로그램 때문에 이동 하나가 실패하면 적용은 `failed/apply_incomplete`이고 일부만 옮겨졌다.
  - 그런데 계획 줄은 `plan applied by run <id>`(`계획 적용됨`)이다. 다시 적용하면 `plan_already_applied`로 막힌다.
- 영향
  - 이 단위의 목적(DR-46, UXM-5)은 "적용이 끝난 계획"을 "적용됨"으로 보이는 것이다. 이 경우들에서는 그 말이 사실보다 크다.
  - 목록만 보는 사람은 계획이 다 적용됐다고 여기기 쉽다. 실제로는 반쯤 옮긴 상태를 되돌리거나(`revert --run <적용 id>`) 새 계획을 만들어야 한다.
  - 바로 윗줄의 적용 실행이 `failed`를 보이고, 계획 보기도 전부터 `applied`라고 해 왔으므로(main도 `Plan of run …: 3 action(s), applied`), 완전히 숨지는 않는다.
  - 기록이 지워진 경우는 목록에 없는 실행 id를 가리킨다.
- 권고(store·CLI): 계획 줄의 말을 그 적용 실행의 상태에서 고른다.
  - 적용 실행이 `done`이면 지금처럼 "적용됨".
  - `failed`·`cancelled`면 "적용이 끝나지 않음(적용 실행 <id>, apply_incomplete 등)".
  - 결과가 아직 없으면 "적용 중".
  - 적용 실행이 되돌려졌으면 "적용했다가 되돌림".
  - 그 적용 실행이 목록에 없으면 "적용 실행 <id>의 기록 없음".
  - JSON의 `appliedBy`는 그대로 두고, 이 구분은 적용 실행 항목(`planRunId`)과 맞춰 읽으면 된다.

## 4. 낮음

### L-1 계획 실행을 되돌릴 때의 안내가 없는 실행이나 이미 되돌린 적용을 가리킨다

- 어디: `src/cli/revert.ts`의 `appliedPlanHint`, `src/cli/assemble.ts`의 `appliedPlanOf`. `loadPlan`의 `applied.applyRunId`만 본다.
- 재현(`exp.mjs` 3 d)
  - 적용을 되돌리고, 그 적용 실행의 기록을 `cleanup --run <적용 id>`로 지웠다.
  - 그 뒤 계획 실행을 `revert`하면 `… Its plan was applied by run <적용 id>: to undo those changes, revert that run (--run <적용 id>).`가 나온다.
  - 그대로 `revert --run <적용 id>`를 하면 `run_not_found`(종료 2)다.
  - 기록을 지우기 전(되돌린 뒤)에도 같은 안내가 나온다. 되돌릴 변경은 이미 없다.
- 영향: 따를 수 없거나 할 필요가 없는 안내다. 해는 없다(되돌리기는 안전하게 실패한다).
- 권고: 안내를 고르기 전에 적용 실행이 목록에 있는지와 되돌림 기록을 본다. 없으면 "그 적용 실행의 기록이 없다", 되돌렸으면 "그 적용은 이미 되돌렸다"로 바꾼다. M-1과 같은 판정을 쓰면 된다.

### L-2 도는 적용 실행의 `changes`는 여전히 "바꾼 파일 없음"이다

- 어디: `src/app/changes.ts`의 `applyRunOf`. 적용 실행의 결과가 아직 없으면 `null`이라 옛 글로 돌아간다. 계약 주석이 말한 대로다.
- 재현(`exp.mjs` 3 c): 적용이 세 파일을 옮기고 검증기가 기다리는 동안 `changes --run <적용 id>`가 `the run changed no file`이다. 같은 때 계획 줄은 이미 `plan applied by run <id>`다.
- 영향: 고친 거짓 문장(UXM-4)이 적용이 도는 동안에는 그대로 남는다. 잠깐이고 드물다.
- 권고: 목록 항목이 적용 실행(`kind: "apply"`)이면 결과가 없어도 적용 실행이라고 말한다. 개수 대신 "아직 끝나지 않음"이라고 하면 된다.

### L-3 다른 task 알림은 빠진 검증의 수를 말하지 않고, task id만 비교한다

- 어디: `src/engine/apply.ts`(`deps.planTaskId !== taskId`), `src/cli/plan-commands.ts`의 `planTaskIdOf`. 간편 형식의 id는 늘 `QUICK_TASK_ID = "quick"`이다(`src/contracts/config.ts:268`).
- 재현: 2.2
  - 빠진 수: 검증 2개짜리 task 파일로 만든 계획을 간편 형식으로 적용하면 끝 요약은 `Checks passed: 1 of 1 (within the configured checks)`이다. 알림은 "쓰인 검증과 규칙은 이 적용의 것"이라고만 한다. 몇 개가 빠졌는지 알 수 없다.
  - 조용한 경우
    - id가 같으면 알리지 않는다. 간편 형식끼리(id `quick`)는 프로필이나 작업 종류가 달라도 같다. 시험은 id `quick`인 task 파일로 했고, 검증이 2개에서 1개가 됐는데 알림이 없었다.
    - 같은 id의 task 파일을 계획 뒤에 고친 경우도 알리지 않는다(이것은 "다른 형식"이 아니다).
  - 지나친 경우: id만 바꾼 같은 내용의 task 파일이면 검증이 그대로(2 of 2)인데도 알린다.
- 값: 알림 글과 JSON `notices`에는 명령, 경로, 검증 id가 없다. 맞다.
- 권고
  - 계획 실행의 `run_started`에 남은 검증 수(또는 id 목록의 해시)와 이 적용의 검증 수를 비교해, 줄었으면 "계획의 task에는 검증 N개, 이 적용에는 M개"를 알린다. 수만 싣는다.
  - 간편 형식은 프로필 이름까지 비교한다. 이름은 이미 기록에 싣지 않으므로, 프로필의 지문을 쓰거나 "간편 형식끼리는 비교하지 못함"을 문서에 적는다.

## 5. 정보

- **I-1 한국어 출력의 영어 조각**: `changes`의 적용 실행 줄과 계획 실행 되돌리기 안내는 고정 영어다.
  - `changes`의 다른 줄도 원래 영어다.
  - 카탈로그에는 `changes.apply_run`(영어·한국어)이 새로 있지만, CLI도 GUI도 쓰지 않는다.
- **I-2 계획 줄의 상태 쌍**: 결과 칸은 `계획 적용됨(…) (needs-input/plan_pending)`이다. 사람 말과 괄호 안 코드가 서로 다른 것을 말한다(코드는 그대로 두기로 한 계약대로).
  - UXM-5가 제안한 적용 실행 줄의 "계획 <id>의 적용"은 없다. JSON의 `planRunId`로는 알 수 있다.
- **I-3 GUI는 그대로다**: 엔진 호스트(`gui/src/engine-host/history.ts`)는 아는 필드만 옮기므로 새 필드 때문에 깨지지는 않는다(코드로 확인, GUI 시험은 돌리지 않음). 그러나 GUI에는 옛 말이 남는다.
  - 실행 목록은 `reason === "plan_pending"`이면 적용 여부와 상관없이 "View plan" 단추를 붙인다(`runs-screen.ts:88`).
  - 적용 실행의 변경 화면은 `files`가 비면 `No file was changed.`다(`changes.empty`).
  - UXM-4·5의 GUI 몫이 남아 있다.
- **I-4 되돌리기 JSON**: 계획 실행 되돌리기의 안내는 stderr에만 있다. JSON은 main과 같다(`complete`, `reverted: []`). 에이전트가 JSON만 읽으면 되돌렸다고 여길 수 있다(되돌리기 기록을 쓰지 않으므로 `runs`는 맞다).

## 6. PM 판단 필요

- **P-1(M-1)**: 계획 줄의 "적용됨"을 적용 실행의 상태로 나눌지, 지금처럼 "적용을 시작함(claim)"의 뜻으로 두고 문구만 바꿀지(예: "적용 실행 <id>가 이 계획을 씀")
- **P-2(L-3)**: 알림을 task id 비교로 둘지, 검증 수 비교로 바꿀지. 간편 형식의 프로필 차이를 알릴지
- **P-3(I-3)**: GUI의 UXM-4·5 몫을 이 단위에 넣을지, 따로 둘지

사용자에게 물을 질문은 없다.

## 7. 실행한 것

- 읽기: `git diff b2dad78...pm/unit-U-16 -- src`, 점검 문서의 UXM-4·5·15
- 빌드: `aaabfd7`, `b2dad78`(둘 다 tsc 0)
- 실험: `exp.mjs`(두 판), `exp2.mjs`(두 판). 출력은 `.codaryn/r55/`
- ACL 해제 확인(임시 폴더 4개, 남은 거부 항목 0). 저장소 파일 변경과 커밋 없음. 실제 API·외부 네트워크 미사용.
