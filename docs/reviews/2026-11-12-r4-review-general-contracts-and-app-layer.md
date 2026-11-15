# R-4 교차 검토 보고서: 범용 작업 계약(G-A)과 앱 계층(A-1)

## 0. 이해 확인과 검토 대상

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 읽기 전용이며 구현자가 아니다.
- worktree: `D:\project\Codaryn\.worktrees\claude-store`. 시작 때 main을 fast-forward로 병합했고(`5a6c64b`) 새 커밋은 없다. 저장소 파일 수정·커밋 없음.
- **검토한 커밋(고정)**
  - `claude/general-tasks` = `287b392`
    - G-A 계약 `f53fb16`
    - 설계 문서 `4264d89`, `287b392`
  - `claude/adapter-contract` = `850626e`
    - A-1 `f1e796b`, `850626e`
  - 두 커밋 모두 작성자 `gangdonggil <gangdonggilstudy@gmail.com>`, trailer 없음.
- 고정 뒤에 올라온 커밋(11:41 기준, 검토하지 않음)
  - general-tasks `2cbd8e6`: 정책 게이트의 워크플로 도구·단일 계획 행동 판정
  - adapter-contract `98434f9`: 가정 타입을 G-A 계약에 맞춤. 바뀐 파일은 `src/app/types.ts`, `index.ts`뿐이고 `events.ts`는 그대로다
  - adapter-contract `6aa3f44`: 문서
  - main `2fcc85b`: DR-10~DR-12
  - 이 커밋들이 영향을 줄 수 있는 항목은 각 발견에 적었다.
- 기준 결정: `docs/work-orders/phase-4-5-design.md`의 AC-D, GT-D, DR-1~DR-9. 고정 뒤에 생긴 DR-10~DR-12는 참고로만 대조했다.
- 실험
  - `git archive` 빌드 사본만 썼다(`.codaryn/r4/`).
    - `g1` = G-A
    - `a1` = A-1
    - `ga` = G-A에 A-1의 `src/app`을 얹은 것
    - `mg2` = 지금 main에 `f53fb16` 패치를 적용한 것
  - 가짜 값만 썼다. 실제 API, 외부 네트워크, 키 파일은 쓰지 않았다.

| 사본 | typecheck | 유닛 |
| --- | --- | --- |
| g1 | 통과 | 771 중 770 통과·1 건너뜀 |
| a1 | 통과 | 755 중 754 통과·1 건너뜀 |
| ga (G-A + A-1) | 통과 | 800 중 799 통과·1 건너뜀 |
| mg2 (main + G-A) | **오류 2** | **864 중 856 통과·7 실패**·1 건너뜀 |

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 1 (H-1) |
| 중간 | 3 (M-1~M-3) |
| 낮음 | 4 (L-1~L-4) |
| 정보 | 6 (I-1~I-6) |

**맞는 것(재현·대조로 확인)**
- DR-1: 실행 중 질문은 권한 확인뿐이다(G-A 계약 주석, A-1 `ConfirmRequest`).
- DR-3: G-A는 `ask`와 `EngineDeps.confirm`을 넣지 않았다.
- DR-4: 대소문자를 무시하는 환경 조회와 앱 환경의 자식 부모 환경을 실제 실행으로 확인했다.
- DR-5: `plan.json`에는 행동과 원본 해시만 있고, 적용의 정책·검증기는 적용 때의 task에서 온다.
- DR-6: `MAX_INVENTORY_FILES` 100,000, 내용 읽기 없음.
- DR-7: 변경 비교를 앱 계층이 지금의 비밀로 다시 가린다.
- DR-9: `.codaryn/discarded/<runId>/`
- 기존 task의 해석: 두 브랜치를 합친 트리에서 기존 유닛 전체가 그대로 통과한다(I-3).

**문제**
- H-1: A-1의 진행 이벤트가 작업 공간의 journal 파일을 다시 읽어 만들어진다. 그래서 실행 중 명령(모델이 쓴 테스트를 실행하는 검증기 포함)이 끼워 넣은 줄이, 등록된 비밀을 원문 그대로 담은 채 어댑터에 전달된다(재현).
- M-1: G-A의 새 이유(`plan_pending` 등)를 main의 실행 목록·보고서가 모른다. 계획 실행이 "손상"·`invalid_run_record`가 된다. typecheck로 잡히지 않는다(재현).

## 2. 높음

### H-1 이벤트가 journal 파일을 다시 읽어 만들어져, 끼워 넣은 기록이 다시 가리지 않은 채 어댑터에 간다 (AC 5.2, DR-1 원칙 "가림본만")

- 위치(A-1 `850626e`, `6aa3f44`에서도 그대로)
  - `src/app/events.ts:12-14`: `Journal.append`가 기록을 돌려주지 않으므로(AC-D3 전) 매 append 뒤 파일에서 새 줄을 다시 읽는다.
  - `:75-85` `isRecord`: `seq` 숫자, `at` 문자열, `runId` 일치, `type` 문자열만 확인한다.
  - `:98-122`: 다시 읽기
  - `:41-73` `sanitizeRecord`: 도구 이름과 호출 id만 다시 가리고 나머지 글 필드는 그대로 둔다.
  - `:146-155`: 관찰자에게 전달
- 문제
  - 상태 디렉터리는 파일 도구에만 닫혀 있다. 실행 중 허용된 명령과 명령형 검증기는 `journal.jsonl`에 줄을 더할 수 있다(T-11, 사용 안내의 report 한계).
  - 엔진이 기록하지 않은 줄이 이벤트로 나가고, 그 글은 가림을 거치지 않는다.
  - 지금 CLI 진행 줄은 메모리의 사건으로 만들고 다시 가리므로 이 통로가 없다(`src/cli/progress.ts:65-81`).
- 재현(`.codaryn/r4/exp4.mjs` E1, 작업 공간 `wsE`)
  1. 작업 공간 `config.txt`에 `db_password=<가짜 비밀>`을 둔다. 같은 값을 task의 `privacy.secretEnv`(`r4_secret`)로 등록한다.
  2. task의 검증기는 `node --test`다. 명령 허용 목록은 비어 있다. 재수정 반복에서 흔한 구성이다(사용 안내 9절).
  3. 대본 모델이 `write_file`로 `inject.test.mjs`를 만든다. 이 시험은 실행될 때 `.codaryn/lock.json`에서 runId를 읽고, `config.txt`를 원문으로 읽어, `{"seq":99,…,"type":"model_response","text":"forged:<값>"}` 한 줄을 그 실행의 `journal.jsonl`에 덧붙인다. 모델은 비밀을 몰라도 된다.
  4. A-1 `createCodarynApp(...).startRun(...)`의 관찰자가 받은 이벤트 16개 중 1개가 그 줄이다.
     - 글: `"forged:db_password=r4-registered-secret-value-123"`(가짜 값)
     - **등록된 비밀이 원문으로 이벤트에 있다(`true`).**
  5. 같은 실행에서 모델이 `read_file`로 읽은 키 값은 기록에서 가려졌다(`true`). 엔진 경로의 가림은 정상이다.
- 영향
  - VS Code·GUI가 이벤트를 화면, 출력 채널, 로그에 그리면 비밀이 그대로 보인다.
  - 위조한 `run_finished`(상태 `done`)로 화면이 실제 결과와 다르게 보일 수도 있다. 실제 결과는 `done` 약속이 나중에 준다.
- 권고
  - 이벤트는 `append`에 넘긴 메모리의 사건으로 만든다. `seq`는 래퍼가 1부터 센다. 저장소는 기록마다 1부터 하나씩 매기므로 값이 같다. `at`은 같은 시계로 만든다.
  - 또는 AC-D3대로 `append`가 저장한 기록을 돌려주게 한다.
  - 다시 읽기를 유지한다면 기대한 `seq`와 다른 줄을 버리고, 모든 글 필드를 실행의 게이트로 다시 가린다.

## 3. 중간

### M-1 G-A의 새 이유를 main의 실행 목록·보고서·사람용 출력이 하드코딩 표로 막는다. typecheck는 잡지 못한다

- G-A는 `RunReasonByStatus`와 `RUN_REASONS`에 `plan_pending`, `awaiting_review`(needs-input), `plan_stale`, `apply_incomplete`(failed)를 더했다(`f53fb16`의 `src/contracts/engine.ts`).
- main의 읽는 쪽은 이유 목록을 손으로 적은 표로 검사한다. 표의 형이 부분 집합을 허용하므로 컴파일 오류가 나지 않는다.
  - `src/store/runs.ts:57-63`(`runs`, `--run latest`)
  - `src/cli/human/output.ts:77-83`(실행 끝 요약, 진행 줄, `runs` 글)
  - `src/cli/report.ts:69` 부근
- 재현(`.codaryn/r4/planrun.mjs`, `mg2` = main + G-A 빌드)
  - `needs-input`/`no_verifier` 실행은 `checked`, `report` `complete`다.
  - `needs-input`/`plan_pending` 실행(같은 형식에 `plan` 필드)은 `runs`에서 **`damaged`**, `report --json`은 **`invalid_run_record`(종료 2)**다.
  - 그래서 `plan --run latest`가 계획 실행을 고르지 못한다. 보고서로 결과를 읽어 계획 화면을 여는 어댑터 흐름(DR-1)도 막힌다.
- 함께 확인한 것: main + G-A는 typecheck 오류 2건이다(`src/i18n/ko.ts`, `en.ts`).
  - 두 카탈로그에 새 id 19개가 없다.
    - `reason.`·`advice.` × 4
    - `error.<code>.what/.fix` × 4(`run_not_plan`, `plan_not_approved`, `plan_already_applied`, `run_not_awaiting_review`)
    - `revert.action.moved_back`, `revert.action.restored_from_discard`, `revert.skip.original_path_taken`
  - 유닛 7건(카탈로그 완전성)이 실패한다.
  - 이것은 DR-12("G-A는 N-B 문구와 같은 묶음으로 병합")가 다룬다.
  - **하드코딩 표는 DR-12의 "읽는 코드가 두 종류(실행·적용) 기록을 구분"에 들어 있지 않다.** 위 실패는 적용 기록이 아니라 실행 기록에서 난다.
- 권고: 상태별 이유 표를 계약 상수(예: `REASONS_BY_STATUS`)로 하나 두고, report·runs·human output이 그것을 쓰게 한다. G-A 병합 묶음에 N-C·N-A의 해당 줄 수정을 넣는다.

### M-2 A-1의 계획·적용·사람 확인 가정 타입이 G-A 계약과 다르다 (고정 커밋 기준)

- 위치: A-1 `850626e`의 `src/app/types.ts:212-280`. G-A `f53fb16`의 `src/contracts/plan.ts`, `workflow.ts`와 비교했다.

| 항목 | A-1 | G-A | 결과 |
| --- | --- | --- | --- |
| 계획 보기 | `PlanView { digest: string; actions: MaskedText[] }` | `PlanOutput { status, digest: ContentHash, actions: MaskedPlanAction[], inventoryLimitReached, appliedBy }` | DR-6의 "상한에 닿으면 적용 전에 알린다"를 어댑터가 보일 수 없다. 이미 적용됨도 보이지 않는다 |
| 적용 결과 | `ApplyResultView { runId, planRunId, status, exitCode }` | `ApplyResult { reason, applied[], verifiers, digest, … }` | `plan_stale`·`apply_incomplete`·`verifier_failed`를 구분하지 못한다 |
| 사람 확인 | `decision: "accept"\|"reject"` | `verdict: "accepted"\|"rejected"`, `replaced`, `checklist` | 이름과 필드가 다르다 |
| 적용 이벤트(DR-2) | `ApplyHandle`이 `RunObserver`를 받고 `RunEvent.record`는 `JournalRecord`다 | 적용 기록은 `ApplyJournalRecord`(`apply_started`, `file_moved` 등)다 | 적용 이벤트를 이 타입으로 실을 수 없다 |

- 고정 뒤 `98434f9`가 "가정 타입을 G-A 계약에 맞춤"이므로 표의 앞 세 줄은 고쳐졌을 수 있다. 검토하지 않았다. 적용 이벤트의 타입(넷째 줄)이 맞춰졌는지 확인이 필요하다.

### M-3 계획 보기가 "run과 같이 다시 가린다"고 하면서 그 비밀을 알 입력이 없다 (DR-5, DR-7 대비)

- G-A
  - `codaryn plan --workspace <dir> --run <runId|latest> [--json]`은 "plan.json을 run과 같이 등록하는 비밀(S-2~S-4)로 다시 가린다"(`src/contracts/plan.ts:483-489`).
  - 그런데 `--task`, `--config`, `--vars-file`이 없다.
  - 그래서 task의 `privacy.secretEnv`(S-3)와 변수 파일 값(S-4)을 등록할 수 없다. 설정은 `CODARYN_CONFIG`·기본 위치뿐이다.
- A-1의 `plan?(request: ReportRequest)`도 설정 입력이 없다(`types.ts:277`).
- 비교: DR-7의 `changes(request: { run: StartRunRequest, runId })`(`types.ts:166-170`)는 실행 설정을 받아 같은 비밀을 다시 만든다(`app.ts:228-256`).
- `plan.json`은 "토큰을 복원한 실경로"를 담는다(`plan.ts:96-103`). `restorePathTokens: true`인 정책에서 비밀이 든 경로가 계획에 들어가면, 계획 보기가 그 경로를 가리지 못하고 원문으로 보인다.
  - 기본값 `false`에서는 토큰 경로를 복원하지 못해 계획이 거부되므로 선행 조건이 있다. 재현하지 않았다(적용기 미구현).
- 권고: `plan`도 `apply`처럼 task 형식(`--task` 또는 간편 형식, `--config`, `--vars-file`)을 받고, 앱 계층 `plan`도 `StartRunRequest`를 받게 한다.

## 4. 낮음

### L-1 앱 계층이 요청을 CLI 인자로 바꿔 넘겨, `--`로 시작하는 목표를 받지 못한다

- 위치: `src/app/app.ts:73-83` `runArguments`. 요청을 `argv`로 만들어 `runCli`에 넘긴다(임시 구현, `:5-12`).
- 재현(exp4.mjs E2): 간편 형식 목표 `"--config"`, `"--help"`, `"--goal x"`는 모두 `invalid_arguments` "--goal needs a value"이고, `"-h"`는 시작된다.
- 인자 주입은 아니다. 값은 늘 플래그 뒤에 따로 들어가고 파서가 거부한다.
- GUI·VS Code 사용자가 이런 목표를 입력하면 이유를 알기 어려운 오류가 된다. 이행 2에서 함수 호출로 바꾸면 없어진다.

### L-2 A-1의 되돌리기에 미리보기(`dryRun`)가 없다 (고정 커밋 기준)

- `RevertRequest`에 `dryRun`이 없다(`types.ts:148-151`). `revert`는 `--dry-run` 없이만 부른다(`app.ts:272-286`).
- N-7(`revert --dry-run`)은 main에 있고 AC 5.5와 UX-D4(미리보기 → 확인)는 이것을 전제한다.
- 고정 뒤 `6aa3f44`가 "the merged N-7"을 문서에 반영했다. 코드 반영 여부는 보지 않았다.

### L-3 `changes`가 실행 전 검사 전체를 통과해야 하고, 스냅샷 파일의 링크를 따라간다

- `probeSecrets`는 CLI 실행 전 검사 1~8단계를 다 돌리고 조립에서 멈춘다(`app.ts:228-246`).
  - anthropic task는 키·모델·출력 상한이 없으면 `provider_not_configured`가 되어, 네트워크가 필요 없는 변경 비교도 못 본다.
  - 설정이 그 사이 바뀌어도 마찬가지다.
- 스냅샷 원문은 `lstat`(크기)을 본 뒤 `readFile`로 읽는다(`src/app/changes.ts:130-132`). 링크를 따라간다.
  - 해시가 기록의 `previousHash`와 같아야 하므로, 기록과 링크를 함께 바꿔야 한다(상태 디렉터리에 쓸 수 있는 명령이면 가능).
  - 그러면 작업 공간 밖 파일 내용이 (지금의 비밀로 가려져) 비교 화면에 나올 수 있다 [추정, 재현 안 함].
  - 권고: 스냅샷 파일이 일반 파일이고 링크가 아닌지 확인한다.

### L-4 사람 확인 메모가 원문으로 저장된다

- `ReviewRecord.note`는 "As typed, cleaned of control characters"이고, 키 모양 검사(S-8)만 거친다(`src/contracts/workflow.ts:192-216`).
- 사람이 등록 비밀을 메모에 적으면 `review.json`에 원문으로 남는다. `report`가 메모를 보일 때 가릴지 계약에 없다.
- 권고: `report`·어댑터는 메모를 보일 때 실행 설정의 비밀로 가린다. 또는 메모에 등록 비밀이 있으면 거부한다.

## 5. 정보

- **I-1 DR-4 확인**(exp4.mjs E1, exp4b.mjs, `wsF`)
  - Windows 형식(`platform: "win32"`)에서 확인한 것
    - 이름 `Anthropic_Api_Key`로 준 키는 S-2로 등록되어 기록에서 가려졌다.
    - 소문자 `secretEnv: ["r4_secret"]`가 `R4_SECRET`을 찾았다.
    - 변수 파일의 짧은 값(`TMPDIR=r4tmp`)은 명령형 검증기 자식에 전달됐다.
    - `process.env`는 바뀌지 않았다.
  - 같은 입력을 CLI(같은 빌드, `TMPDIR`·`LANG`을 비운 환경)로도 실행해 결과가 같았다: 짧은 값 pass, 8자 이상 값 fail.
  - 다만 **8자 이상인 변수 파일 값은 S-4로 비밀이 되어 두 경로 모두 자식 환경에서 빠진다**(`envValueFreeOfSecrets`). DR-4 근거와 `src/app/assemble.ts:6-9` 주석의 예("PATH, TEMP")는 실제로는 일어나지 않는다(긴 PATH는 빠진다). 문서를 고치거나, S-4 등록과 자식 전달 규칙을 따로 정할지 PM이 본다.
- **I-2 DR-1·DR-3·DR-10**
  - G-A `policy.ts`는 `ask`가 없다는 주석만 바꿨다.
  - A-1 `ConfirmRequest`는 `permission` 하나다. `ConfirmAnswer`의 `dismissed`는 `by: "default"`로 기록한다(`types.ts:108-112`). R-1 L-2와 DR-10을 미리 반영한 셈이다.
- **I-3 기존 task 해석**
  - 해석 규칙
    - `workflowSettingsOf`는 빠진 필드를 `LEGACY_WORKFLOW_SETTINGS`(내장 도구 넷, 지시 없음, 계획 없음, 검증기 판정)로 채운다(`workflow.ts:86-107`).
    - `run_started`의 새 필드는 워크플로 설정이 있을 때만 있다(`journal.ts` 변경).
    - `ModelRequest.workflowTools`는 선택이다.
    - `TOOL_NAMES`는 그대로다.
  - 확인한 것
    - `ga` 사본에서 기존 유닛 전체와 G-A의 `g-legacy-interpretation` 시험이 통과했다.
    - 이름표 `workflow: "organize"`만 있는 task는 정의를 고르지 않는다(GT-D2).
  - task 파서는 아직 새 필드를 모르므로, `workflowRef`를 쓴 task 파일은 G-F 전까지 `invalid_task`다.
- **I-4 적용 기록의 읽기**
  - 적용 실행의 첫 기록은 `apply_started`다(`plan.ts:326-379`).
  - main의 `runs`는 첫 기록이 `run_started`가 아니면 손상으로 본다(`src/store/runs.ts:156`). `report`도 같다(X-2).
  - DR-12가 G-E·G-F에 배정했다. M-1의 이유 표와 같은 곳을 고치므로 함께 하면 된다.
- **I-5 실행 요청의 `workflowRef`·`profile`**
  - A-1 트리의 CLI는 `--workflow`와 `--profile` 둘 다 `invalid_arguments`다(exp4.mjs E3).
  - `workflowRef`는 A-1이 그렇게 적었다(`types.ts:71-76`). `profile`은 N-A의 CLI 연결이 main에 오면 풀린다.
- **I-6 검토 방법상 주의(다른 검토자용)**
  - 처음에 main 사본에 패치를 `git apply`로 적용했을 때, 사본이 worktree 안(`.codaryn/`)에 있어 Git이 저장소 하위 디렉터리로 보고 바깥 경로의 변경을 모두 건너뛰었다. 종료 코드는 0이었다.
  - 그 결과(`mg`)는 버렸다. `GIT_CEILING_DIRECTORIES`로 저장소 탐색을 막고 다시 적용한 `mg2`만 썼다.
  - worktree 변경은 없었다(`git status` 확인).

## 6. 검사하지 않은 범위

- 고정 뒤 커밋(`2cbd8e6`, `98434f9`, `6aa3f44`)의 내용
- 아직 구현이 없는 적용기, 계획 기록기, `inventory`, `data_checks`, `codaryn plan/apply/review`. 계약 대조만 했다.
- `--events jsonl`·`--confirm stdio` 줄 프로토콜(미구현)
- macOS·Linux에서의 환경 조회(POSIX는 대소문자 구분 경로)
- 실제 API

## 7. PM 판단 필요

- **P-1(H-1)**: A-1 이벤트를 파일 다시 읽기 대신 메모리 사건과 자체 `seq`로 만들지. 다시 읽기를 유지한다면 `seq` 연속 검사와 전체 재가림을 넣을지.
- **P-2(M-1)**: 상태별 이유 표를 계약 상수로 올리고 runs·report·human output이 쓰게 할지. G-A 병합 묶음(DR-12)에 이 수정을 넣을지.
- **P-3(M-3)**: `codaryn plan`과 앱 계층 `plan`이 실행 설정을 받게 할지.
- **P-4(I-1)**: 변수 파일의 8자 이상 값이 자식 환경에서 빠지는 현재 규칙을 유지하고 DR-4 근거 문장만 고칠지.

사용자에게 물을 질문은 없다.

## 8. 실행한 것

- 읽기: `git log/show/diff`(`main...287b392`, `main...850626e`, `f53fb16`, `850626e`), 결정 표
- 빌드
  - `git archive` 사본 4개(`g1`, `a1`, `ga`, `mg2`)를 worktree의 TypeScript로 컴파일했다.
  - `mg2`는 main 사본에 `git show f53fb16` 패치를 적용했다.
- 시험: 네 사본의 유닛 전체
- 실험 스크립트(`.codaryn/r4/`): `exp4.mjs`(H-1, DR-4, L-1, I-5), `exp4b.mjs`(DR-4 자식 환경), `planrun.mjs`(M-1)
- 실행: CLI 비교 실행 1회(a1 빌드 `run`)
- 저장소 파일 변경과 커밋 없음. 실제 API 미실행.
