# R-94 검토: U-131 (넘겨주는 글 다섯)

검토자: 검증 엔지니어(ne-verify, w3:p4). 읽기 전용. 저장소를 고치거나 커밋하지 않았다.

## 검토한 것

| 대상 | 해시 |
|---|---|
| 판 `pm/unit-U-131` | `05e6c36` (13:25:01). 검토 끝(13:39)에도 같다 |
| 단위 `unit/U-131-na-core` | `66bfe5f`. 같다 |
| 판의 바탕 main | `56135b0` |

- 단위의 몫(`56135b0` ↔ `05e6c36`)은 9파일 +361 −29다.
  - `src/cli/changes.ts`, `main.ts`, `plan-commands.ts`, `report.ts`
  - `src/contracts/human.ts`(문구 id 셋)
  - `src/i18n/en.ts`·`ko.ts`
  - `docs/cli-contract.md` 18.18
  - `tests/unit/cli/g-u131-handoffs.test.ts`
- 커밋: `a7c8314`(시험), `a66cb83`(고침), `66bfe5f`(문서), 병합 `05e6c36`
- **main이 검토 도중 움직였다:** `56135b0` → `224ada9`(U-135, U-140) → `57d0109`(13:34, U-136 i18n). 판 `05e6c36`은 `57d0109` 위에서도 충돌 없이 합쳐진다(`git merge-tree`). 그 합친 판에서는 시험을 돌리지 않았다.

## 시험 수치 (판 `05e6c36`, `.codaryn/r94/c`)

| 시험 | 결과 |
|---|---|
| `npm run build` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 3083개: 통과 3079, 실패 0, 건너뜀 3, todo 1 |
| `npm run test:integration` | 584/584 통과 |

**판 비교** `scripts/compare-cli-boards.mjs --base 56135b0 --head 05e6c36`
- 쓴 도구는 main 체크아웃(`224ada9`)의 것이다. U-135의 터미널 흉내 사례 9개가 그 판부터 들어 있어서다. 도구 파일을 읽어 실행만 했다.
- 작업 폴더는 `.codaryn/r94/work`이고, 끝나면 도구가 지웠다.
- 결과: **21사례 모두 같다, 차이 0**(`compare.md`)
  - 대상: JSON 줄, 사람용 글, 종료 코드, 실행 기록, 작업 공간 파일, 가짜 API가 받은 요청
- 다만 이 21사례는 바뀐 글 다섯 가운데 어느 것도 지나가지 않는다. 지나갔다면 차이가 났어야 한다. → 정보 I1

## 판정

| 항목 | 높음 | 중간 | 낮음 | 정보 | 판정 |
|---|---|---|---|---|---|
| U-131 | 0 | 0 | 0 | 5 | 받아들일 수 있다 |

---

## 1. JSON 출력과 고정 값

- **코드**
  - 다섯 글은 모두 `--json`이 아닐 때만 계산한다.
    - changes는 `parsed.args.json`이면 `planRunOf`를 부르지 않는다.
    - report는 `!json`일 때만 실행 목록을 읽는다.
    - review의 되돌리기 줄과 apply의 알림은 글과 진행 줄에만 있다.
  - 결과 JSON, 기록, 계약 형은 바뀌지 않았다.
  - `FIXED_MESSAGES`에 `changes.plan_only`, `changes.plan_applied`(`runId`), `changes.plan_apply_other`(`runId`)가 더해졌다. en·ko 카탈로그에 셋 다 있다.
  - 영어 대체 글(`PLAN_TASK_DIFFERS_ENGLISH`)은 카탈로그의 `apply.notice.plan_task_differs` 영어와 글자까지 같다.
- **실행**: `probe.mjs`
  - 계획 실행의 `changes --json`은 적용 전과 후가 같다.
  - `report --json`은 적용 뒤와 되돌린 뒤가 같다.
  - `review --reject --json`의 키는 `schemaVersion,kind,runId,verdict,exitCode,checklist,replaced`로 그대로다.
- 판 비교도 21사례 모두 같다.

## 2. changes의 작업 공간 경계 (N4)

**코드**: `planRunOf`가 작업 공간을 정하는 길은 둘이다.
- 친 `--workspace`(현재 폴더 형식은 `"."`): `path.resolve(cwd, …)`
- task 형식: task 파일을 다시 읽어(BOM을 뗀다) `path.resolve(dirname(task), workspaceRoot)`
  - 앱 계층의 `resolveLocal`과 같은 해석이다. 앱 계층은 그 앞에 `localPathProblem` 검사를 더 한다.
- 어느 쪽이든 그 경로는 앱 계층의 `listRuns` → `workspaceRootOf` → `resolveWorkspaceRoot`를 지난다. 그래서 UNC·장치 경로·설치 위치 규칙이 다시 걸린다.
- `changes` 자체가 성공한 뒤에만 부른다.

**실행**: `probe.mjs`, `PROBE.log`. 판의 실제 CLI, 대본 모델, 네트워크 울타리, 설정 폴더 격리.

| 경우 | 결과 |
|---|---|
| 적용 전: `--task task.json`(상대), `--workspace workspace`(상대), 현재 폴더 | 셋 다 `This run only made a plan and changed no file itself.` |
| 적용 뒤: 같은 셋, en | 위 줄 + `Its plan was applied by run <적용 id>; that run's report lists the moves.` |
| 적용 뒤: 같은 셋, ko | `이 실행은 계획만 만들었고 스스로 바꾼 파일은 없습니다.` + `그 계획을 적용한 실행: <id>. 옮긴 것은 그 실행의 보고서에 있습니다.` |
| 적용을 되돌린 뒤 | 위 첫 줄 + `An apply run took up its plan: <id>; codaryn runs shows how that apply ended.` |
| task 파일이 다른 폴더(`tasks/rel.json`, `workspaceRoot: "../workspace"`) | 계획 줄이 맞게 나온다 |
| BOM과 절대 `workspaceRoot`(`tasks/abs.json`) | 계획 줄이 맞게 나온다 |

**읽지 못할 때 예전 글**: `probe3.mjs`, `PROBE3.log`. 판의 `runChanges`를 실제 앱 계층과 직접 불렀다.
- 실제 `listRuns`이면 새 글이 나온다.
- 다음 경우는 모두 예전 줄 `the run changed no file`, 종료 0이다.
  - `listRuns`가 없다
  - `listRuns`가 `ok:false`를 준다
  - `listRuns`가 예외를 던진다
  - task 파일을 다시 읽지 못한다
  - 다시 읽은 것이 JSON이 아니다
  - 다시 읽은 `workspaceRoot`가 다른 폴더를 가리킨다(그 폴더의 목록에 이 실행이 없다)
- 계획 실행의 `result.json`을 깨면 `changes` 자체가 `invalid_run_record`(종료 2)다. 그래서 그 경우는 이 대체 경로에 닿지 않는다(`PROBE2.log`).

## 3. 글에 나오는 경로와 실행 id의 가림

**changes·report·apply 알림**
- 새 글에 나오는 것은 실행 id와(report의 `unfinished`일 때) 이유 코드뿐이다.
  - 실행 id는 실행 목록(store가 형식을 확인한 것)에서 온다.
  - changes는 `cleanText` 뒤 전체 글에 `hideKeys`를 한다. report는 `code()`를 쓰고, 렌더링 중 키를 숨긴다.
- 경로는 없다. apply 알림은 고정 문구이고, 진행 줄로 낼 때 `privacy.mask`를 거친다.

**review --reject의 되돌리기 줄(N3)**
- 친 `--workspace`는 그 명령의 가릴 값(`prepared.secrets`)으로 가린다. 그 뒤 `toShownWorkspace`(DR-51, R-70)를 지난다. 그래서 다음 경우는 `<workspace>`로만 나온다.
  - 가림이 경로를 바꿨다
  - 80자를 넘는다
  - 허용 목록 밖의 글자가 있다
  - 키 모양이나 토큰 조각이 있다
- 실행 결과

| 경우 | 줄 |
|---|---|
| `--workspace workspace`(상대), en | `Revert: codaryn revert --workspace "workspace" --run <id>` |
| task 형식 | `Revert: codaryn revert --workspace <workspace> --run <id>` |
| `--workspace workspace`, ko | `되돌리기: codaryn revert --workspace "workspace" --run <id>` |
| 등록 값이 든 작업 공간 경로(설정 `secretEnv`) | `Revert: codaryn revert --workspace <workspace> --run <id>`. **값이 출력 어디에도 없다** |

## 4. 다른 작업 id 알림의 차례 (N5)

**실행**: `probe2.mjs`, `PROBE2.log`
- 계획은 task 파일(작업 id `organize-demo`)로 만들었다.
- 적용은 간편 형식(`--config`에 한도, `--workspace`, `--workflow organize`)으로 했다.
- 터미널은 시험의 preload(stdin·stderr의 `isTTY`)로 흉내 냈다.

**터미널, 답 `n`**
- 계획 글 끝의 다이제스트 문단 다음, **`Apply this plan? [y/N]` 바로 앞 줄**에 알림이 있다.
- 결과는 `plan_not_approved`, 종료 2다.
- ko도 같다. `이 계획을 적용할까요? [y/N] …` 바로 앞에 `계획은 이 적용에 준 것과 다른 작업으로 만들었습니다…`가 있다.

**터미널, 답 `y`**
- 알림은 세 번 나온다.
  1. 질문 바로 앞(10행)
  2. `apply started — … approved at the terminal`(12행) 바로 다음(13행)
  3. 끝 요약(28행)
- 종료 0이다. 계약 18.18과 같다.

**`--digest`**
- 진행 줄은 다음 차례다.
  1. `codaryn: apply started — actions: 3, approved by a command-line argument`
  2. `codaryn: The plan was made with another task …`
  3. `codaryn: preflight — problems: 0`
- 결과의 `notices`(`plan_task_differs`)는 그대로다. ko도 같은 차례다.

**같은 task 형식으로 적용하면** 알림 줄이 0이다.

**코드**
- `planTaskIdOf`를 승인 앞으로 옮겼다. 같은 값을 엔진(`planTaskId`)에 준다.
- `observeApply`의 `after`는 `apply_started` 기록 줄 다음에만 한 줄을 더한다.
- `--quiet`이면 진행 줄을 쓰지 않으므로 알림도 없다.

## 5. 두 언어

- changes 셋, review의 되돌리기 줄, apply 알림은 고른 언어로 나온다(위 표의 en·ko).
- report의 새 줄(N1·N2)은 영어다. report의 Markdown은 원래 영어다(사용 안내 16절 "출력 언어"). 그래서 그대로 맞다.
- report 결과: `probe.mjs`
  - N2 적용 뒤: ``- Plan: 3 action(s), applied by run `<id>` (its report: `codaryn report --run <id>`).``
  - N2 되돌린 뒤: `…, then reverted (…)`
  - N1 판정 뒤: `The run waits …` 줄이 없고, `Verdict: **rejected** (…)` 다음에 ``A later review replaces it: `codaryn review --run <id> --accept | --reject`.``가 있다.

---

## 정보

- **I1 판 비교 도구의 21사례는 이 단위의 글 다섯을 지나가지 않는다.**
  - 다섯 글이 바뀌었는데도 차이가 0이다. 그래서 그 결과는 "다른 출력이 바뀌지 않았다"는 뜻일 뿐이다. "새 글이 맞다"는 증거는 아니다.
  - 다음 CLI 이행에서 이 글들을 지키려면 `cases.mjs`에 사례를 더하는 것이 좋다.
    - `plan-apply` 뒤 계획 실행의 `changes`·`report`
    - 분석 실행의 `review --reject`
    - 다른 task 형식의 적용(터미널 하나와 `--digest` 하나)
- **I2 이미 되돌린 실행을 다시 `--reject`하면 되돌리기 명령이 또 나온다.**
  - `changedFiles`는 `result.changes`의 수만 본다(`probe.mjs`: 되돌린 뒤의 두 번째 거부도 `Revert: … "workspace" …`).
  - 그 명령을 쳐도 `already_reverted`로 `complete`, 종료 0이다(사용 안내 3절). 해는 없고 한 번 헛걸음할 뿐이다.
- **I3 계획 실행보다 새 실행이 1,000개(`RUNS_MAX_LIMIT`)를 넘으면 changes는 예전 줄로 돌아갈 수 있다.**
  - `listRunsIn`이 최신 1,000개로 자른다(`runs.slice(0, limit)`). report는 store의 목록 전체를 쓴다.
  - 손상된 빈 실행 폴더 1,000개로는 재현되지 않았다. 계획 실행이 여전히 목록에 있었다. 정상 실행 1,000개는 만들지 않았다. 코드상 가능성이다.
  - 예전 줄은 계약의 "읽지 못하면 예전 글"과 같은 결과라 틀린 말은 아니다.
- **I4 task 파일을 두 번 읽는다.**
  - 앱 계층이 한 번 읽고, `planRunOf`가 글을 위해 한 번 더 읽는다. 두 번째 읽기는 크기 상한(1 MiB)과 키 검사 없이 `JSON.parse`한다.
  - 다만 첫 읽기가 통과해야 두 번째로 간다. 두 번째가 가리키는 작업 공간은 `resolveWorkspaceRoot`를 다시 지난다. 사이에 파일이 바뀌어도 결과는 예전 줄이다(`PROBE3.log`).
  - 앱 계층의 `changes` 출력에 작업 공간을 실어 주면 다시 읽지 않아도 된다. 다만 계약이 바뀐다.
- **I5 사용 안내의 한 문장이 덜 맞게 됐다(범위 밖, 문서 단위 몫).**
  - [사용 안내](../docs/usage.md) 18.9의 "판정 뒤 보고서의 사람 확인 절 끝은 `No verdict yet.` 대신 `Verdict: …`다"를 말한다.
  - 이제 판정 뒤에는 `The run waits …` 줄이 빠지고, 끝에 `A later review replaces it: …`가 붙는다.
  - 다른 예시(판정 전 보고서, `--accept`의 review 출력)는 그대로 맞다. 계획 실행의 changes·report 예시는 사용 안내에 없다.

---

## 실험 파일

`.codaryn/r94/` 아래에 있다.
- `compare.md`, `compare.log`: 판 비교
- `probe.mjs` + `PROBE.log`: changes·report 세 형식과 두 언어, review --reject와 가림
- `probe2.mjs` + `PROBE2.log`: 다른 작업 알림의 차례, `result.json`을 깬 경우
- `probe3.mjs` + `PROBE3.log`: changes가 예전 글로 돌아가는 경우를 직접 부름
- `build.log`, `typecheck.log`, `unit.log`, `integration.log`

공통 조건
- 모든 CLI 호출은 시험의 네트워크 울타리(`net-guard`)를 실었다. 기록에 남은 것이 없다.
- 설정 폴더(APPDATA·LOCALAPPDATA·XDG_CONFIG_HOME·HOME·USERPROFILE)는 임시 폴더로 돌렸다.
- 키는 없다. 등록 값은 지어낸 것이다.
- 판 사본 `.codaryn/r94/c`는 junction을 먼저 끊고 지웠다.
