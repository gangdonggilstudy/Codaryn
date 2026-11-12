# AX 중간 점검 (에이전트 경험)

페르소나: AX(에이전트 경험) 전문가. 읽기 전용 점검이며 이 파일 하나만 썼다.

## 0. 머리말

- **점검한 판**: 문서와 코드는 worktree `pm-docs`(브랜치 `unit/U-12-pm`, `a7f3a2f`). 실행한 빌드는 `pm-integration`의 `dist`(`e0e1180`, 코드 동일).
- **두 방향**: (가) 사람이 에이전트에게 일을 맡기는 경험, (나) 다른 프로그램·에이전트가 Codaryn을 부품으로 쓰는 경험.
- **방법**
  - 문서: `docs/cli-contract.md`, `docs/usage.md`(해당 절), `docs/design/adapter-contract.md`(6절 근처), 결정 색인의 해당 행.
  - 코드: `src/contracts/**`(결과·오류·도구 정의), `src/engine/index.ts`(시스템 지시문, 도구 오류 문구), `src/model/anthropic`, `src/model/openai`(도구 결과가 모델에 가는 꼴), `src/cli/progress.ts`, `src/cli/cleanup.ts`, `src/cli/protocol/**`, `src/workflows/index.ts`.
  - 실행: 빌드된 CLI를 scripted 제공자로 약 80가지 경우(호출 약 105회) 돌렸다. 작업 공간은 모두 scratchpad의 `ax/` 아래 임시 폴더다. 표준 입력은 비워(터미널 없음) 돌렸다. 메시지 언어는 OS 표시 언어(ko)였다.
- **한계**
  - 실제 모델은 부르지 않았다. 모델에게 주는 지시와 오류 문구가 실제 모델의 행동을 어떻게 바꾸는지는 **추측**이다. 본 것은 "모델이 무엇을 받는가"까지다.
  - 실제 API 오류(`model_error`의 종류별 경우)는 돌리지 못했다. 그 부분은 코드와 계약만 읽었다.
  - Electron GUI는 띄우지 않았다. GUI가 같은 문제를 가졌는지는 보지 못했다.
  - 터미널이 있을 때의 질문(예: `apply`의 예/아니오, `init` 대화)은 보지 못했다.
  - `partly_removed`는 만들지 못했다. 같은 시도에서 `io_error`가 나왔다(4절 표).
  - 종료 코드 9(Node의 `--env-file`), 70(`internal_error`), 8(`model_list_failed`)은 만들지 않았다.

## 1. 한 쪽 요약

가장 중요한 문제와 방향이다. 번호는 3절의 id다.

1. **에이전트의 마지막 말이 사람에게 닿지 않는다(AXM-1, 높음).** 모델이 "보호 경로라 못 바꿨다, 확인해 달라"고 답해도 끝 요약, 결과 JSON, 보고서 어디에도 없다. `journal.jsonl`에만 있다. 못 한 것을 말할 통로가 사실상 없다. → 결과에 `finalMessage`(가림본, 길이 상한)를 더하고 끝 요약과 보고서에 "에이전트의 말(검증된 사실 아님)"로 보인다.
2. **`plan`이 기록 변경 표시가 있는 계획을 아무 경고 없이 보이고 승인 명령까지 권한다(AXM-2, 높음).** `apply`는 `plan_records_changed`로 막지만, 사람이 판단하는 화면은 "이 계획은 본래 것과 다를 수 있다"를 말하지 않는다. JSON에도 표시가 없다. → `plan` 출력에 `recordsChanged`와 경고 줄, 승인 안내 줄 제거.
3. **`cleanup`의 JSON이 스스로 어긋난다(AXM-3, 높음).** 아무것도 지우지 못했는데 `mode:"applied"`, `outcome.ok:true`, `exitCode:1`이 함께 나온다. digest 불일치는 오류 꼴이 아닌 `mode:"plan_changed"`(종료 3)인데, `apply`의 같은 상황은 오류 `plan_not_approved`(종료 2)다. → `cleanup`에 `status`를 두고 두 확인 흐름의 규칙을 하나로.
4. **"허용"이 "됐다"로 읽힌다(AXM-4, 중간).** 진행 줄은 정책 판정만 보인다. 허용된 뒤 실패한 도구 호출(`conflict`, `no_match`, `protected_span_violation`)은 진행 줄, 끝 요약, 보고서 어디에도 없다. → 실패한 결과에 한 줄, 요약과 보고서에 "실패한 호출 N건".
5. **모델이 받는 오류가 다음 행동을 알려 주지 않는다(AXM-5, AXM-6, AXM-7, 중간).** `invalid arguments for this tool`은 어느 필드인지 말하지 않는다. `denied by policy: restore/restore_denied`는 코드뿐이다. OpenAI에는 "이것은 오류"라는 표시도 가지 않는다. 시스템 지시문에는 "못 한 것을 마지막 답에 적어라"가 없다. → 오류 문구에 필드와 다음 행동을, 내용 앞에 고정 접두를, 지시문에 세 줄을.
6. **기계가 실행 상태를 코드로 알 수 없다(AXM-8, AXM-9, 중간).** 실행 중에 `--run latest`는 `run_not_found`다. `runs --json`의 진행 중 실행은 `status:null`이라 죽은 실행과 같다. 모델 오류의 종류(다시 시도해도 되는지)는 결과 JSON에 없다. → `runs`에 `phase`, 결과에 `modelError.kind`, 오류 JSON에 `retryable`.
7. **맡기기 전에 "무엇을 할 수 있는 에이전트인지"가 한눈에 안 보인다(AXM-10, 중간).** 시작 줄은 제공자뿐이다. `doctor`는 설정의 건강만 본다. → 시작 줄과 `doctor`에 권한 요약(도구, 보호 경로 수, 허용 명령 수, 한도, 등록된 비밀 수).
8. **기계용 계약이 한 곳에 없다(AXM-11~AXM-14, 중간).** 오류 코드는 계약 문서 여섯 군데에 나뉘어 "더해졌다"로 적혀 있다. 상태 필드 이름이 명령마다 다르다(`status`, `verdict`, `mode`, 없음). 진행 이벤트를 기계가 받는 길(`--events jsonl`)은 코드만 있고 연결돼 있지 않다. → 오류 코드 표 하나, 필드 규칙 한 절, 진행 이벤트는 사용자 결정(6절).

## 2. 잘 된 것 (유지할 것)

실제로 돌려 확인한 것만 적는다.

- **정직한 상태.** 검증기가 없으면 `needs-input`/`no_verifier`(종료 3)이고 `done`이 아니다. 끝 요약은 "검증: 1개 중 1개 통과(지정한 검증 범위에서)"라고 범위를 붙인다. 보고서의 `Not checked` 절은 "A pass means the configured verifiers passed. It is not a review of the change."를 말한다.
- **거부는 무엇이 일어나지 않았는지 말한다.** 오류 문구가 "nothing was moved", "nothing was changed", "Nothing was sent"로 끝난다. 기계와 사람 모두 부작용 여부를 안다.
- **질문으로 멈추지 않는다.** 터미널 없이 돌린 모든 경우가 바로 끝났다. `apply`는 `--digest`가 없으면 `plan_not_approved`, `init`은 `"interactive":false`로 만들고 끝, `review`는 `--accept|--reject`가 없으면 `invalid_arguments`.
- **승인이 계획 하나를 가리킨다.** `apply --run latest`는 거부된다("latest is not accepted, so the approval names one plan"). 짧은 digest(4자)도 거부된다. 손으로 고친 `plan.json`은 `plan`과 `apply` 모두 `invalid_run_record`로 막았다.
- **한 줄 JSON의 뼈대.** 돌려 본 모든 JSON에 `schemaVersion`, `kind`, `exitCode`가 있고 `exitCode`는 실제 종료 코드와 같았다. 글이 기본인 명령도 오류는 stdout에 JSON 한 줄이다. 사람용 글은 stderr로 가고 `--quiet`로 꺼진다.
- **취소.** `--cancel-file`로 취소하면 `cancelled`(종료 5), `changes`에 이미 한 변경이 남고, 요약이 "이미 한 변경은 남아 있습니다. codaryn revert로 되돌릴 수 있습니다."라고 말한다.
- **되돌리기 미리보기.** `revert --dry-run`이 같은 꼴에 `dryRun:true`를 붙이고, 확인하지 못한 것(`moveSafetyUnchecked:true`)을 따로 말한다.
- **scripted 표시.** 결과의 `provider:"scripted"`, 보고서의 "scripted model; no API was called".
- **doctor JSON의 `text.id`와 `params`.** 문구가 아니라 id로 분기할 수 있다.
- **잠금 오류의 종료 코드가 따로다(6).** 다시 시도할 수 있는 유일한 실행 전 오류가 코드로 구별된다.

## 3. 문제 목록

심각도: **높음** = 사람이 잘못된 신뢰를 갖게 되거나 기계가 결과를 잘못 판정함. **중간** = 이해·통합에 추가 노력이 듦. **낮음** = 다듬기.

"호환" 줄은 기존 출력에 미치는 영향이다. "더함"은 필드나 줄을 더하기만 한다는 뜻이다. 그래도 한 줄 출력을 통째로 비교하는 고정 시험 값은 바뀐다.

### AXM-1 에이전트의 마지막 말이 사람에게 닿지 않는다

- 방향: (가) · 심각도: **높음**
- 어디: `src/contracts/engine.ts`의 `EngineResult`(289~327줄), `src/cli/progress.ts` 93~95줄, 끝 요약, `report`
- 실제로 본 것
  - 대본의 마지막 답을 `"I could not change a.txt because it is protected. Please confirm."`로 두고 돌렸다(`run --task nov/task.json`).
  - stdout 결과: `"status":"needs-input","reason":"no_verifier"`, `"notices":["no automatic verification: no verifier is configured for this task"]`. 마지막 답은 없다.
  - stderr 끝 요약: `검증: 지정한 검증 없음 / 바뀐 파일: 0개 / 거부된 호출: 4건 / … / 설정이나 task에 검증을 더하세요.` 마지막 답은 없다.
  - `report`(글과 `--json`): `could not`으로 찾으면 없다. 기록에는 있다: `{"type":"model_response","turn":2,"stop":"final","text":"I could not change a.txt because it is protected. Please confirm.",…}`.
  - `progress.ts` 93~95줄: `case "model_response": case "tool_result": return null;`
- 왜 문제인가
  - 에이전트가 "못 했다", "이 부분은 확인해 달라", "가정을 이렇게 두었다"를 말할 자리는 마지막 답뿐이다. 그 답을 사람이 못 본다.
  - 검증기가 통과하면 사람은 "완료"만 본다. 에이전트가 남긴 유보가 사라진다. 이것이 과신으로 이어진다.
  - 기계도 같다. 상위 에이전트가 Codaryn의 답을 받아 다음 단계를 정할 수 없다.
- 개선안
  - `EngineResult`에 선택 필드를 더한다: `finalMessage?: { text: MaskedText; truncated: boolean }`. 마지막 `stop:"final"` 응답의 글이다. 길이 상한(제안: 2,000자)을 넘으면 자르고 `truncated:true`. 비어 있으면 필드를 싣지 않는다.
  - 끝 요약(검증 줄 아래): `에이전트의 말(검증된 사실이 아님): <글>`.
  - 보고서: `## Agent's last message` 절. 첫 줄에 "This is what the model said. It was not verified."
  - 계획 실행과 적용 실행에는 싣지 않는다(계획은 AXM-15의 `summary`가 그 자리다).
- 영향 범위: 계약(`engine.ts`), 엔진, CLI(요약·보고서), 앱 계층(결과를 그대로 넘기므로 형만), GUI(보일 자리), 문서
- 예상 크기: 400~600줄(시험 포함)
- 호환: 더함. 마지막 답이 빈 실행의 출력은 그대로다. 마지막 답이 있는 고정 시험 값(예: 체험 예시의 결과 JSON, 끝 요약)은 바뀐다.

### AXM-2 `plan`이 기록 변경 표시가 있는 계획을 경고 없이 보인다

- 방향: (가)(나) · 심각도: **높음**
- 어디: `src/cli/plan-commands.ts`(표시 확인은 `apply` 경로 372~382줄에만 있다), `PlanOutput`, `docs/cli-contract.md` 18.12절
- 실제로 본 것
  - 계획 실행 폴더에 `records-changed.json`을 두고 돌렸다.
  - `plan --task … --run <id>` → 종료 0:
    ```
    Plan of run 20261112T135930Z-3e745daf: 3 action(s), pending
    Digest: cc305dee7973…
    …
    To apply it: codaryn apply <the same task form> --run 20261112T135930Z-3e745daf --digest cc305dee7973
    ```
  - `plan … --json` → `"status":"pending","exitCode":0,…,"appliedBy":null`. `recordsChanged`가 없다.
  - 같은 실행의 `apply` → 종료 2, `plan_records_changed`: "…so its plan may not be the one shown; nothing was asked, recorded or moved."
  - 같은 실행의 `report`는 말한다: "This run has a records-changed mark…". `runs --json`도 `"recordsChanged":true`.
  - 계약 18.12절은 표시를 다루는 명령으로 `report`, `revert`, `apply`만 적는다. `plan`은 없다.
- 왜 문제인가
  - `plan`은 사람이 승인 여부를 판단하는 화면이다. 바로 그 화면이 "보이는 계획이 실행이 만든 것과 다를 수 있다"를 말하지 않고, 승인 명령을 권한다.
  - `apply`가 막으므로 파일 피해는 없다. 그러나 사람은 믿을 수 없는 계획을 읽고 판단하는 데 시간을 쓰고, 거부의 이유를 뒤늦게 안다. 기계는 `status:"pending"`만 보고 승인 단계로 간다.
- 개선안
  - `PlanOutput`에 `recordsChanged?: true`(표시가 있을 때만, 다른 명령과 같은 규칙).
  - 사람용 글: 첫 줄 아래에 경고 한 줄, 마지막의 `To apply it:` 줄 대신 "This plan cannot be applied. Make the plan again with a new run."
  - 종료 코드는 0 대신 3을 권한다(확인 필요). 6절 질문 2.
  - 계약 18.12절에 `plan`을 더한다.
- 영향 범위: 계약(`plan.ts`), CLI, 앱 계층(`plans.ts`의 계획 보기), GUI(승인 화면), 문서
- 예상 크기: 200~350줄
- 호환: 표시가 없는 계획의 출력은 그대로다. 표시가 있는 경우의 글과 종료 코드가 바뀐다(그 경우의 고정 값이 있으면 바뀐다).

### AXM-3 `cleanup`의 JSON이 스스로 어긋나고 다른 명령과 규칙이 다르다

- 방향: (나) · 심각도: **높음**
- 어디: `src/cli/cleanup.ts` 71~96줄, 238~255줄. 계약 18.13절("지금은 `src/cli/cleanup.ts`의 형. 계약으로 옮길 제안")
- 실제로 본 것
  - 실행 폴더의 파일을 다른 프로세스가 열어 둔 채 `cleanup --run <id> --confirm <digest> --include-not-reverted --json` → 종료 1:
    ```
    {"schemaVersion":1,"kind":"cleanup","mode":"applied","exitCode":1,"outcome":{"ok":true,"removed":[],"kept":[{"target":"run","runId":"…","reason":"io_error"}],…}}
    ```
    아무것도 지우지 못했는데 `mode`는 `applied`, `outcome.ok`는 `true`, 종료는 1이다.
  - `--include-not-reverted` 없이 확인 → 종료 0, `"mode":"applied"`, `"removed":[]`, `"kept":[{"…","reason":"not_reverted_not_confirmed"}]`. 지운 것이 없어도 `applied`/0이다(계약대로다).
  - 틀린 digest → 종료 3: `{"schemaVersion":1,"kind":"cleanup","mode":"plan_changed","exitCode":3}`. `kind:"error"`도 `code`도 없다.
  - `apply`의 틀린 digest → 종료 2: `{"kind":"error","code":"plan_not_approved",…}`.
- 왜 문제인가
  - `ok`만 보는 기계는 실패를 성공으로 읽는다. `mode:"applied"`만 보는 기계도 같다.
  - "digest로 확인한다"는 같은 약속이 두 명령에서 다른 꼴과 다른 종료 코드로 거부된다. 한쪽을 배운 통합자가 다른 쪽에서 틀린다.
  - 다른 명령은 `status`인데 여기만 `mode`다.
- 개선안
  - `status`를 더한다: `preview` | `removed` | `nothing_removed` | `partly_failed` | `plan_changed`. `mode`는 한동안 함께 싣는다(6절 질문 1).
  - `outcome.ok`는 "문제로 남긴 것이 없음"과 같게 한다. 즉 `exitCode===0`일 때만 `true`. (store의 `ok`가 다른 뜻이면 CLI 출력에서 이름을 `completed` 등으로 바꾼다.)
  - digest 불일치는 한 규칙으로: 두 명령 모두 "확인 필요"(종료 3)로 하거나 두 명령 모두 오류(종료 2)로 한다. 권장은 오류 JSON에 새 코드 `cleanup_plan_changed`(종료 2)를 두는 쪽이다. 6절 질문 2.
  - `CleanupOutput`을 계약으로 옮긴다(계약 18.13절의 자기 제안).
- 영향 범위: 계약(`cleanup.ts`, `engine.ts`의 오류 코드), CLI, 앱 계층(`cleanup.ts`), GUI(정리 화면이 `mode`를 읽는다면), 문서
- 예상 크기: 400~700줄
- 호환: `status` 더함은 호환. `outcome.ok`의 값과 digest 불일치의 꼴·종료 코드는 **깨는 변경**이다. `cleanup` 고정 값이 바뀐다.

### AXM-4 "허용"이 "됐다"로 읽힌다: 실패한 도구 호출이 보이지 않는다

- 방향: (가) · 심각도: 중간
- 어디: `src/cli/progress.ts` 73~75줄, 93~95줄. 끝 요약의 "거부된 호출", 보고서의 `Tool calls`
- 실제로 본 것(`run --task sec/task.json`, 쓰기 다섯 번 중 세 번이 실행 단계에서 실패)
  ```
  codaryn: 2턴
  codaryn: 파일 쓰기 — 허용 (write_file)
  codaryn: 3턴
  codaryn: 파일 쓰기 — 허용 (write_file)
  codaryn: 4턴
  codaryn: 파일 쓰기 — 허용 (write_file)
  codaryn: 파일 쓰기 — 거부 (restore/restore_denied)
  codaryn: 5턴
  codaryn: 파일 쓰기 — 허용 (write_file)
  codaryn: 파일 바꿈 app.conf
  ```
  - 기록의 결과는 차례로 `protected_span_violation`, `conflict`, `no_match`, `policy_denied`, 성공이다.
  - 끝 요약: `거부된 호출: 1건`. 보고서: `Tool calls: 5 of 8 (denied: 1)`. 실패 세 건은 어디에도 없다.
- 왜 문제인가
  - 사람은 "허용"을 "했다"로 읽는다. 성공은 뒤의 "파일 바꿈" 줄로만 구별된다. 읽기·검색·명령은 그런 뒤 줄이 없다.
  - 비밀이 든 줄을 바꾸려다 막힌 일(`protected_span_violation`)은 보호 장치가 동작한 순간이다. 사람에게 알릴 가치가 가장 큰데 보이지 않는다.
  - 에이전트가 헤매는지(같은 실패 반복) 사람이 알 수 없다.
- 개선안
  - `tool_result`가 `ok:false`이고 정책 거부가 아니면 한 줄: `파일 쓰기 — 실패 (conflict)`. 성공한 결과는 지금처럼 줄이 없다.
  - 끝 요약: `실패한 호출: 3건 (conflict 1, no_match 1, protected_span_violation 1)`.
  - 보고서: `Tool calls: 5 of 8 (denied: 1, failed: 3)`. `ReportOutput.journal`에 `failedToolCalls`.
  - "허용"이라는 낱말은 "정책 통과"로 바꾸는 것을 UX 검토와 함께 정한다.
- 영향 범위: 문구(카탈로그), CLI, 계약(`commands.ts`의 보고서 형), GUI(진행 목록), 문서(usage 3절의 고정 출력)
- 예상 크기: 300~500줄
- 호환: 더함. 실패한 호출이 있는 실행의 stderr 고정 값과 보고서 고정 값이 바뀐다.

### AXM-5 `invalid_args`가 어느 인자인지 말하지 않는다

- 방향: (가, 모델) · 심각도: 중간
- 어디: `src/engine/index.ts` 147줄(`INVALID_ARGS_MESSAGE`), 654줄, 853줄. `src/engine/validate-args.ts`. `src/model/openai/index.ts` 175줄(`strict: false`)
- 실제로 본 것
  - `write_file`에 `path`만 주었다. 모델이 받는 결과: `{"ok":false,"content":"invalid arguments for this tool","errorCode":"invalid_args"}`.
  - 없는 도구 이름: `"content":"unknown tool"`.
  - OpenAI 어댑터는 도구를 `strict: false`로 보낸다. 제공자가 스키마를 강제하지 않는다.
- 왜 문제인가
  - 모델은 무엇을 고쳐야 할지 모른다. 같은 호출을 조금씩 바꿔 되풀이하며 턴과 도구 호출 한도를 쓴다(실제 모델의 행동은 추측).
  - 스키마를 강제하지 않는 제공자에서 더 자주 일어날 수 있다(추측).
- 개선안(before → after)
  - `invalid arguments for this tool` → `invalid arguments: <field>: <rule>`. 예: `invalid arguments: expectedHash: required (64 lowercase hex characters, or null for a new file)`, `invalid arguments: change.kind: must be "replace_all" or "replace_text"`, `invalid arguments: unknown field "mode"`.
  - 필드 이름은 스키마의 이름만 쓴다(모델이 준 값은 넣지 않는다. 가림을 한 번 더 거친다).
  - `unknown tool` → `unknown tool. Available tools: read_file, search_files, write_file`(그 실행이 내준 이름).
- 영향 범위: 엔진(`validate-args.ts`가 첫 문제의 위치와 규칙을 돌려주게), 문서
- 예상 크기: 300~450줄(시험 포함)
- 호환: 기록의 `tool_result.content`가 바뀐다. 결과 JSON과 종료 코드는 그대로다. 이 문구를 고정한 시험 값이 바뀐다. `FIXED_MODEL_TEXTS`에 새 문구를 더해야 한다.

### AXM-6 거부·실패 문구가 코드뿐이라 모델이 다음 행동을 모른다

- 방향: (가, 모델) · 심각도: 중간
- 어디: `src/engine/index.ts` 586줄, 729줄, 754줄, 811줄. `src/tools/index.ts`의 실패 문구
- 실제로 본 것(기록의 `tool_result.content`, 모델이 받는 글 그대로)
  - `denied by policy: path/protected_path`
  - `denied by policy: path/outside_root`
  - `denied by policy: restore/restore_denied` (경로에 가려진 자리표시자를 넣은 호출)
  - `change rejected: protected_span_violation`
  - 잘 된 예: `file state differs from expectedHash; read the file again`, `oldText was not found in the file`
- 왜 문제인가
  - 뒤의 두 문구는 "무엇이 틀렸고 다음에 무엇을 하라"를 말한다. 앞의 넷은 내부 코드다. 모델은 `restore_denied`가 "경로에 자리표시자를 쓸 수 없다"는 뜻임을 알 길이 없다.
  - 시스템 지시문은 "A denied tool call is final for that request. Do not try to work around it."만 말한다. 거부 뒤에 무엇을 하라는 말이 없다.
- 개선안(코드는 그대로 두고 한 문장을 붙인다)
  - `denied by policy: path/protected_path. This path is protected in this task; do not write to it. Say so in your final reply.`
  - `denied by policy: path/outside_root. Paths must stay inside the workspace.`
  - `denied by policy: restore/restore_denied. A protected placeholder cannot be used in this field.`
  - `change rejected: protected_span_violation. A line that holds a protected placeholder must stay exactly as it is; change other lines only.`
  - 코드별 한 문장을 계약의 표(`TOOL_DENIAL_HINTS`)로 두고 엔진이 붙인다.
- 영향 범위: 계약(`tool.ts` 또는 `policy.ts`), 엔진, 도구, 문서
- 예상 크기: 250~400줄
- 호환: AXM-5와 같다(기록의 `content`만 바뀐다).

### AXM-7 오류 표시와 오류 코드가 모델에 가는 길이 제공자마다 다르다

- 방향: (가, 모델) · 심각도: 중간
- 어디: `src/model/anthropic/index.ts` 141~146줄, `src/model/openai/index.ts` 219줄
- 실제로 본 것(코드)
  - Anthropic: `{ type: "tool_result", tool_use_id, content: result.content, is_error: !result.ok }`.
  - OpenAI: `{ type: "function_call_output", call_id, output: result.content }`. 오류 표시가 없다.
  - 두 곳 모두 `errorCode`는 보내지 않는다. 정책 거부는 글에 코드가 있지만 `conflict`, `no_match`, `not_found` 등은 글만 간다.
- 왜 문제인가
  - 같은 실패가 한 제공자에서는 "오류"로, 다른 제공자에서는 평범한 출력 글로 간다. 성공 결과는 JSON 글이고 실패는 짧은 문장이라 구별은 되지만(추측), 제공자 둘에서 같은 경험이라고 말할 수 없다.
- 개선안
  - 엔진이 실패 결과의 내용을 한 꼴로 만든다: `error (<errorCode>): <message>`. 예: `error (conflict): file state differs from expectedHash; read the file again`.
  - 그러면 제공자 형식과 무관하게 모델이 같은 글을 받는다. Anthropic의 `is_error`는 그대로 둔다.
- 영향 범위: 엔진(`errorResult`와 실행 실패 경로), 문서(adapter·second-provider 문서의 "같은 경험" 항목)
- 예상 크기: 150~250줄. AXM-5·6과 한 단위로 묶는다.
- 호환: 기록의 `content`가 바뀐다.

### AXM-8 실행 중인 실행을 코드로 알 수 없다

- 방향: (나) · 심각도: 중간
- 어디: `src/cli/run-ref.ts`, `runs`의 `RunsOutput`
- 실제로 본 것(40초짜리 실행이 도는 동안)
  - `report --run latest --json` → 종료 2: `{"code":"run_not_found","message":"the workspace has no finished run whose records could be checked; nothing was changed"}`
  - `changes --run latest --json` → 종료 2: `{"code":"run_not_found","message":"the workspace has no runs yet, so --run latest names none",…}`. 실행이 하나 돌고 있는데 "no runs yet"이다.
  - `runs --json` → `{"state":"checked","runId":"…","status":null,"reason":null,"changes":null,…}`
  - `report --run <id> --json` → 종료 3, `"status":"incomplete","result":null`
  - `revert --run <id>` → 종료 6, `workspace_locked`
  - `run` → 종료 6, `workspace_locked … (pid 61860)`
  - `doctor` → 종료 3(주의): "실행 중인 프로세스가 작업 공간을 잠그고 있습니다…"
- 왜 문제인가
  - `status:null`은 "아직 도는 중"과 "결과 없이 죽음"을 같이 뜻한다. 기계는 기다릴지 포기할지 정할 수 없다.
  - `latest`의 `run_not_found`는 "실행이 없다"와 "끝난 실행이 없다"를 같은 코드로 준다. 문구로만 갈린다.
  - 정상으로 도는 실행 때문에 `doctor`가 주의(3)가 된다.
- 개선안
  - `runs` 항목에 `phase`: `running`(잠금의 runId와 같고 주인이 살아 있음) | `finished` | `no_result`. `status:null`은 그대로 둔다.
  - `--run latest`가 도는 실행만 있을 때는 새 오류 코드 `run_in_progress`(종료 6, 잠금과 같은 "다시 시도" 부류).
  - 실행 상태 조회 명령은 따로 만들지 않는다. `runs --json --limit 1`의 `phase`로 충분하다.
- 영향 범위: 계약(`commands.ts`, `engine.ts` 오류 코드), store(`listRuns`가 잠금을 본다), CLI, 앱 계층(`runs.ts`), GUI(목록), 문서
- 예상 크기: 400~600줄
- 호환: `phase` 더함은 호환(`runs --json` 고정 값은 바뀐다). `run_not_found` → `run_in_progress`는 그 경우의 코드와 종료 코드를 바꾼다.

### AXM-9 다시 시도해도 되는 실패인지 결과에서 알 수 없다

- 방향: (나) · 심각도: 중간
- 어디: `EngineResult`(`src/contracts/engine.ts`), `journal.ts` 83~87줄(`model_error.kind`), `CliErrorOutput`
- 실제로 본 것
  - 대본이 모자란 실행 → `"status":"failed","reason":"model_error","exitCode":1`. 종류가 없다. `notices`도 비어 있다.
  - 계약 8절: 모델 오류의 종류(`auth_failed`, `rate_limited`, `overloaded`, `timeout`, `api_error` 등)는 "기록의 `model_error.kind`에 남는다". 결과에는 자리가 없다(`commands.ts`, `engine.ts`에서 찾아도 없다).
  - 실행 전 오류는 종료 2에 "입력을 고쳐야 함"(`invalid_task`)과 "지금 상태로는 안 됨"(`plan_already_applied`, `run_not_found`)이 함께 있다.
  - 실제 API 오류는 돌리지 못했다. 위는 코드와 계약에서 읽은 것이다.
- 왜 문제인가
  - 상위 프로그램은 `rate_limited`(기다렸다 다시)와 `auth_failed`(다시 해도 소용없음)를 구별해야 한다. 지금은 `journal.jsonl`을 직접 읽어야 한다.
- 개선안
  - `EngineResult`에 선택 필드 `modelError?: { kind: ModelErrorKind; turn: number }`. `reason:"model_error"`일 때만.
  - `CliErrorOutput`에 선택 필드 `retryable?: boolean`. 표를 계약에 둔다: `workspace_locked`·`model_list_failed`(종류에 따라)는 `true`, 나머지는 `false`.
  - 오류 코드 표에 "부류" 열: 입력(`input`) / 상태(`state`) / 환경(`environment`) / 내부(`internal`). 종료 코드는 바꾸지 않는다.
- 영향 범위: 계약, 엔진, CLI, 앱 계층(`AppError`), 문서
- 예상 크기: 300~500줄
- 호환: 더함. 모델 오류로 끝난 실행과 오류 JSON의 고정 값이 바뀐다(필드가 더해지는 경우만).

### AXM-10 맡기기 전에 에이전트의 권한이 한눈에 보이지 않는다

- 방향: (가) · 심각도: 중간
- 어디: 진행 줄 `progress.run_started`(`src/i18n/ko.ts` 53줄), `doctor`(`src/cli/doctor.ts`)
- 실제로 본 것
  - 시작 줄: `codaryn: 실행 시작 — 모델 제공자 scripted`. 작업 공간, 작업 종류, 도구, 보호 경로, 한도가 없다.
  - `doctor --task demo1/task.json`: 열네 줄 모두 설정의 건강이다. 이 task는 `protectedPaths: ["notes.md"]`를 갖는데 `[건너뜀] 보호 대상 경로 integrity.paths가 설정되지 않았습니다`가 나온다(다른 기능인 무결성 경로를 말한다). `[건너뜀] 허용 명령 허용한 명령도 명령 검증기도 없습니다`.
  - 끝 줄: `doctor: 정상 (종료 코드 0). 네트워크에 접속하지 않았고 아무것도 바꾸지 않았습니다.`
  - 정책이 좁혀졌을 때의 줄(`narrowingLines`, DR-41)은 코드에 있다. 좁혀지는 경우는 돌리지 않았다.
- 왜 문제인가
  - 사람은 "이 에이전트가 무엇을 바꿀 수 있고 무엇은 못 하는지"를 task 파일과 설정 파일을 직접 읽어야 안다.
  - "보호 대상 경로 — 건너뜀"은 보호 경로를 둔 사람에게 "보호가 꺼져 있다"로 읽힐 수 있다.
- 개선안
  - 시작 줄 아래에 요약 한 줄(진행 표시, `--quiet`면 없음):
    `codaryn: 권한 — 도구 read_file·search_files·write_file · 쓰기 금지 경로 1개 · 허용 명령 0개 · 등록된 비밀 0개 · 검증 1개 · 한도 8턴/도구 8회`
  - `doctor`에 `permissions` 항목(상태는 항상 `ok`, 글은 위와 같은 요약). JSON에는 숫자와 이름 목록을 `params`로.
  - `doctor`의 "보호 대상 경로" 항목 이름을 "무결성 확인 경로"로 바꾸고, 쓰기 금지 경로(`policy.protectedPaths`)는 `permissions`에서 말한다.
  - 값은 싣지 않는다(경로 문자열은 가림을 거친다, 명령은 개수만).
- 영향 범위: 문구, CLI(`doctor.ts`, 진행), 계약(`human.ts`의 문구 id, doctor 항목 id), GUI(실행 전 화면), 문서(usage 3절·7절)
- 예상 크기: 400~600줄
- 호환: 더함. 모든 실행의 stderr 고정 값과 `doctor` 고정 값이 바뀐다(줄·항목이 하나씩 는다).

### AXM-11 오류 코드가 한 곳에 없다

- 방향: (나) · 심각도: 중간
- 어디: `docs/cli-contract.md` 8절 172줄, 15절, 16절, 17.7절, 18.8절, 18.13절. 코드는 `CLI_ERROR_EXIT_CODES` 한 곳(`src/contracts/engine.ts` 181~250줄)
- 실제로 본 것
  - 계약 8절: "…단계 3에서 `workspace_is_install_dir` 2가 더해졌다(15절). 모델 목록(16절)에서 `model_list_failed` 8, `config_write_failed` 2가 더해졌다. `init`(17절)에서 `config_exists` 2가 더해졌다. 범용 작업 명령(18절)에서 …가 더해졌다."
  - `plan_records_changed`는 8절의 목록에 없다(18.12절에만 있다).
  - `cleanup`의 `plan_changed`, 도구 오류 코드(`TOOL_ERROR_CODES`), 되돌리기의 건너뜀 이유, 정리의 남긴 이유는 각각 다른 곳에 있다.
- 왜 문제인가
  - 통합자가 "가능한 `code` 전부"를 얻으려면 문서 여섯 군데나 소스를 읽어야 한다. 코드가 안정적인지(없어지거나 뜻이 바뀌지 않는지)에 대한 약속도 문서에 없다.
- 개선안
  - 계약 문서에 "오류 코드" 절 하나: 코드, 종료 코드, 부류(AXM-9), 나오는 명령, 다시 시도 여부, 부작용("nothing was changed" 여부).
  - 안정성 약속 한 줄: "코드는 지우거나 뜻을 바꾸지 않는다. 더하기만 한다. 문구(`message`)는 바뀔 수 있다."
  - 유닛 시험 하나: 문서의 표와 `CLI_ERROR_EXIT_CODES`의 키가 같은지.
  - (선택) `codaryn help codes --json`으로 같은 표를 낸다. AXM-16과 함께 정한다.
- 영향 범위: 문서, 시험 하나
- 예상 크기: 150~250줄
- 호환: 출력 변화 없음.

### AXM-12 상태 필드의 이름과 "값 없음"의 규칙이 명령마다 다르다

- 방향: (나) · 심각도: 중간
- 어디: 각 명령의 출력 형(`src/contracts/commands.ts`, `plan.ts`, `workflow.ts`, `changes.ts`, `src/cli/cleanup.ts`)
- 실제로 본 것(4절 표와 같은 실행)
  - `run`, `apply`, `revert`, `report`, `doctor`, `init`, `runs`, `plan`: `status`
  - `review`: `status` 없음, `verdict`(`accepted`/`rejected`)
  - `cleanup`: `status` 없음, `mode`
  - `changes`: 둘 다 없음(`kind`, `runId`, `exitCode`, `masking`, `files`)
  - 값 없음: `runs`는 `"profile":null,"workflowRef":null,"reverted":null`. `run`은 `stateChanged`를 비면 싣지 않고 `protectedChanged`는 빈 배열로 싣는다(무결성 확인이 있었을 때). `plan`은 `"appliedBy":null`. `revert`는 `dryRun`을 `true`일 때만 싣는다.
  - 오류 JSON의 키 순서: 대부분 `code, exitCode, message`. `changes`의 오류는 `code, message, (diagnostic,) exitCode`.
- 왜 문제인가
  - "먼저 `status`를 본다"는 한 규칙으로 모든 명령을 다룰 수 없다.
  - null과 생략이 섞여 있어, 통합자가 필드마다 "없을 수 있는가, null일 수 있는가"를 문서에서 찾아야 한다. 규칙 자체는 문서에 없다(18.12절 등에 필드별로 흩어져 있다).
- 개선안
  - 규칙을 계약 문서에 한 절로 적는다(새 필드부터 적용, 기존 필드는 표로 나열).
    1. 모든 성공 출력은 `schemaVersion`, `kind`, `status`, `exitCode`를 이 순서로 먼저 싣는다.
    2. "그 종류의 실행에는 해당 없음"은 **생략**, "해당하지만 값이 없음"은 **null**, "목록이 비었음"은 **빈 배열**.
    3. 불리언 표시(`dryRun`, `recordsChanged`)는 `true`일 때만 싣는다.
  - `review`에 `status:"recorded"`를, `changes`에 `status:"shown"`을, `cleanup`에 `status`(AXM-3)를 더한다.
  - 기존 필드(`stateChanged` 생략, `protectedChanged` 빈 배열)는 바꾸지 않는다. 표에 "예외"로 적는다.
- 영향 범위: 계약, CLI, 문서
- 예상 크기: 250~400줄
- 호환: 더함. `review`, `changes`, `cleanup`의 JSON 고정 값이 바뀐다.

### AXM-13 기계가 진행 이벤트를 받을 길이 없다(코드는 있으나 연결되지 않음)

- 방향: (나) · 심각도: 중간
- 어디: `src/cli/protocol/**`(쓰는 곳 없음. 시험 `tests/unit/cli/protocol/**`만 가져온다), `docs/design/adapter-contract.md` 514~515줄, 571줄, 635줄
- 실제로 본 것
  - `run --task … --events jsonl` → 종료 2: `{"code":"invalid_arguments","message":"unknown or repeated option. usage: …"}`
  - `src/cli/protocol/index.ts`의 머리말: "`main.ts` and `run.ts` connect it". 그러나 `src` 안에서 `takeProtocolOptions`를 부르는 곳은 없다.
  - 어댑터 계약 571줄과 635줄은 "DR-20으로 추진하지 않음"이라고 적는다. 514~515줄은 옵션을 현재형으로 설명한다. 결정 색인 521줄도 이 어긋남을 적어 두었다.
  - `--help`, `docs/cli-contract.md`, `docs/usage.md`에는 `--events`가 없다(옳다).
- 왜 문제인가
  - 지금 기계가 진행을 보는 길은 둘이다. stderr의 사람용 줄(언어에 따라 바뀌므로 분기에 쓸 수 없다)과 `.codaryn/runs/<id>/journal.jsonl`을 따라 읽는 것. 뒤쪽은 가능하지만 runId를 실행이 끝나기 전에 알 방법이 없다(결과 JSON은 끝에 나온다).
  - 연결되지 않은 코드와 현재형 문서가 "있는 기능"으로 읽힌다.
- 개선안(셋 중 하나, 6절 질문 3)
  - (가) 연결한다: `run`·`apply`에 `--events jsonl`. `--confirm stdio`는 권한 질문(단계 5)이 생길 때까지 연결하지 않는다.
  - (나) 연결하지 않고 최소한만: 진행 줄 첫 줄에 runId를 싣는다(`codaryn: 실행 시작 — 실행 id <id> …`). 기록을 따라 읽는 방법을 문서에 적는다. `src/cli/protocol/**`은 "연결되지 않음"을 머리말에 적는다.
  - (다) 지금대로 두고 문서만 맞춘다.
  - 권장: (나). 독립 GUI는 앱 계층을 직접 쓰므로 줄 프로토콜이 필요 없고(DR-20), 다른 에이전트는 끝 결과만으로 대부분 충분하다.
- 영향 범위: (가)는 CLI(`main.ts`, `run.ts`, `plan-commands.ts`), 문서. (나)는 문구, 문서
- 예상 크기: (가) 500~800줄, (나) 100~200줄
- 호환: (나)는 시작 줄 고정 값이 바뀐다. (가)는 새 옵션이라 기존 출력에 영향 없음.

### AXM-14 읽기만 하는 명령이 실행용 설정을 요구한다

- 방향: (나)(가) · 심각도: 중간
- 어디: `changes`, `plan`, `review`의 작업 형식 해석(`src/cli/task.ts`, `src/cli/changes.ts`, `src/cli/plan-commands.ts`)
- 실제로 본 것
  - `changes --workspace sec/workspace --run latest`(설정 파일 없음) → 종료 2:
    `{"code":"invalid_config","message":"limits.maxModelTurns is not set in the task or the config file","diagnostic":{…"file":"config","field":"limits.maxModelTurns"…}}`
  - 같은 작업 공간에 `report --workspace … --run latest`는 설정 없이 된다.
- 왜 문제인가
  - 변경을 보는 일에 모델 턴 한도는 쓰이지 않는다. 이 명령들이 작업 형식을 받는 이유는 비밀 등록(가림)과 계획 표시의 대조 때문이다(DR-28).
  - 다른 에이전트가 "무엇이 바뀌었나"를 물으려면 실행 때와 같은 설정 전체를 갖고 있어야 한다. 오류는 그 이유를 말하지 않는다.
- 개선안
  - 읽기 명령(`changes`, `plan`, `review`)의 간편 형식은 한도·모델·검증기를 요구하지 않는다. 비밀 목록(`secretEnv`)과 작업 종류만 해석한다.
  - 그래도 실패하면 문구에 이유를 붙인다: "…this command reads the task form only to register the same secrets as the run."
- 영향 범위: CLI(해석 경로에 "읽기 전용" 모드), 앱 계층(같은 경로를 쓰면), 문서
- 예상 크기: 300~500줄
- 호환: 실패하던 경우가 성공으로 바뀐다. 성공하던 경우의 출력은 그대로다.

### AXM-15 계획이 "왜"를 말하지 않고, 승인의 보장을 설명하지 않는다

- 방향: (가) · 심각도: 중간
- 어디: `src/contracts/plan.ts` 99~104줄(`ProposePlanArgs.summary`), `plan` 출력, 계획 실행의 끝 요약
- 실제로 본 것
  - 대본의 `propose_plan`에 `"summary":"사진과 영수증을 연도 폴더로 옮기고 임시 파일을 폐기한다"`를 주었다.
  - `plan` 출력(글과 `--json`)에 그 글이 없다. `plan.json`에도 없다. 계약 주석: "Masked and recorded with the tool call; not part of plan.json, so it is not what a person approves."
  - `plan` 출력은 `Digest: 55c331df…` 한 줄과 `To apply it: … --digest 55c331df036c`를 보인다. digest가 무엇을 보장하는지는 말하지 않는다.
  - 폐기 줄은 잘 말한다: `3. discard  inbox/old-draft.tmp  (kept in .codaryn/discarded/ until removed)`.
- 왜 문제인가
  - 모델은 사람을 위해 한 줄을 쓰라고 요구받는다(필수 인자). 그 줄은 사람에게 가지 않는다.
  - 사람은 동작 목록만 보고 의도를 짐작해야 한다. 동작이 수십 개면 판단하기 어렵다.
  - "승인한 것과 적용되는 것이 같다"는 이 제품의 핵심 보장인데, 승인 화면에 한 문장도 없다.
- 개선안
  - `plan` 출력에 `summary`를 "에이전트의 설명(승인 대상 아님)"으로 보인다. `PlanOutput.summary?: MaskedText`. 승인 대상이 아니라는 원칙(digest에 넣지 않음)은 그대로 둔다.
  - 글 끝에 두 줄:
    `The digest names exactly these actions and the files' contents at plan time.`
    `apply refuses if the plan, a file or the run's records changed since.`
  - 계획 실행의 끝 요약에도 `summary` 한 줄.
- 영향 범위: 계약(`plan.ts`), store(계획 실행의 기록에서 읽어 오기), CLI, 앱 계층, GUI(승인 화면), 문서
- 예상 크기: 300~500줄
- 호환: 더함. `plan` 고정 값(글과 JSON)이 바뀐다.

### AXM-16 시스템 지시문에 빠진 것

- 방향: (가, 모델) · 심각도: 중간
- 어디: `src/engine/index.ts` 124~132줄(`SYSTEM_PROMPT`), `src/workflows/index.ts` 44~66줄
- 실제로 본 것(지시문 전문)
  ```
  You are Codaryn, a local task agent working inside one workspace directory.
  Use the tools to read, search, change files and run allowed commands.
  Before changing a file, read it and pass the returned hash as expectedHash. Use null only for a new file.
  Some text is replaced by protected placeholders: an uppercase label, a colon and 16 hex digits inside double square brackets.
  Keep each placeholder exactly where it is. Never copy, move, alter or remove it. A line that holds a placeholder cannot be changed.
  A denied tool call is final for that request. Do not try to work around it.
  When the work is finished, reply without tool calls. Verifiers decide whether the task succeeded.
  ```
- 잘 된 점: 자리표시자의 모양과 다루는 법을 표식 없이 말로 설명한다. 해시 규칙과 거부의 뜻이 분명하다. 짧다.
- 빠진 것
  1. **사람에게 물을 수 없다는 것.** 실행 중에 사람에게 묻는 통로는 없다(앱 계층의 `ConfirmRequest`는 권한 질문뿐이고 "Stage 5 (DR-3). Not called yet"). 모델은 이것을 모른다. 질문을 마지막 답으로 내면 그 답은 버려진다(AXM-1).
  2. **못 한 것을 어떻게 알릴지.** 거부되거나 할 수 없는 일이 있을 때 마지막 답에 적으라는 말이 없다.
  3. **도구 목록이 실행마다 다르다는 것.** 첫 줄은 "run allowed commands"를 말하지만 문서 작업에는 `run_command`가 없다.
  4. **검증 실패 뒤의 흐름.** 재수정 메시지가 온다는 것은 그때 가서 안다. 이것은 충분할 수 있다(추측).
- 개선안(after, 더하는 줄만)
  ```
  You cannot ask the person questions during the run. If something is unclear, choose the most careful reading of the goal and say which reading you chose.
  End with a short final reply for the person: what you changed, what you could not do and why, and what they should check. Do not claim success; verifiers decide.
  Only the tools offered in this run exist.
  ```
  - 둘째 줄은 AXM-1(마지막 답을 사람에게 보임)과 함께 넣는다. 보이지 않는 답을 쓰라고 하면 토큰만 쓴다.
  - 계획 실행에는 둘째 줄 대신 "Put the reason for the plan in propose_plan's summary."(AXM-15와 함께).
- 영향 범위: 엔진, 문서. 가림을 거치는 고정 문구 시험(`FIXED_MODEL_TEXTS`)
- 예상 크기: 100~200줄
- 호환: 기록의 `model_request`(시스템 글)가 바뀐다. 결과 JSON과 종료 코드는 그대로다. 시스템 글을 고정한 시험 값과 가짜 API 시험의 요청 본문 고정 값이 바뀐다. 실제 모델의 행동 변화는 확인할 수 없다(실제 호출 점검 때 볼 것).

### AXM-17 보호 장치가 동작했는지가 결과에 없다

- 방향: (가) · 심각도: 중간
- 어디: 끝 요약, 보고서의 `Not checked` 절, `docs/privacy.md` 13절, `docs/usage.md` 16절
- 실제로 본 것
  - 비밀 하나를 등록하고 그 값이 든 파일을 읽힌 실행(`sec`): 모델이 받은 내용은 `password=[[CODARYN_SECRET:3d320f1fdbb6d281]]`로 가려졌다. 끝 요약과 보고서에는 가림에 대한 줄이 없다(`secret`, `mask`로 찾아도 없다).
  - 비밀을 하나도 등록하지 않은 실행(`demo1`)도 요약과 보고서가 같다. "가릴 것이 등록되지 않았다"는 말이 없다.
  - 보고서의 `Not checked`는 검증, 명령이 바꾼 파일, OS 격리, 기록의 신뢰를 말한다. 가림의 한계(등록한 값과 목록의 변형만 가린다, UTF-8이 아닌 출력은 가려지지 않는다)는 문서(계약 10절, privacy 13절)에만 있다.
  - `changes`는 잘 말한다: "masked with the secrets registered now (not the run's own masking)".
- 왜 문제인가
  - 사람은 "가림이 켜져 있었고 몇 번 동작했다"와 "가릴 것이 없었다"와 "등록을 안 했다"를 구별할 수 없다. 셋은 신뢰의 뜻이 다르다.
  - 알려진 한계가 사람이 결과를 보는 자리에 없다.
- 개선안
  - 결과에 `privacy?: { registeredSecrets: number; maskedTexts: number }`(개수만). 엔진이 가림에서 토큰이 생긴 글의 수를 센다.
  - 끝 요약 한 줄: `가림: 등록된 비밀 1개, 가린 글 3건` 또는 `가림: 등록된 비밀 없음(가리지 않음)`.
  - 보고서 `Not checked`에 한 줄: "Masking covers registered values and listed variants only; other encodings are not masked."
- 영향 범위: 계약(`engine.ts`, `privacy.ts`), 엔진, privacy, CLI, GUI, 문서
- 예상 크기: 400~600줄
- 호환: 더함. 모든 실행의 결과 JSON·끝 요약·보고서 고정 값이 바뀐다(범위가 넓다). AXM-10의 "등록된 비밀 N개"와 한 단위로 묶을 수 있다.

### AXM-18 `invalid_arguments`가 무엇이 틀렸는지 말하지 않는다

- 방향: (나)(가) · 심각도: 낮음
- 실제로 본 것
  - `run --task … --bogus` → `"message":"unknown or repeated option. usage: codaryn run (…) | codaryn revert … | codaryn report … | …"`. 어느 옵션인지 없고, 모든 명령의 사용법이 한 문자열로 붙는다.
  - `frobnicate`(없는 명령), 인자 없음, `help bogus` → 같은 전체 사용법.
  - `run --task nope.json`(없는 파일) → `invalid_task`, "the task file cannot be read as JSON". 없는 파일과 깨진 JSON이 같은 문구다.
  - 잘 된 예: `--run ../x` → "--run must be a run id (1-128 characters …) or \"latest\"".
- 개선안: `unknown option: --bogus`(옵션 이름은 고정 목록과 비교해 `--`로 시작하는 꼴만 그대로 적는다), `unknown command`에는 명령 이름 목록만, 없는 파일은 `diagnostic.code:"not_found"`.
- 영향 범위: CLI(`args.ts`, `main.ts`), 문서 · 예상 크기: 150~300줄
- 호환: `message` 글이 바뀐다. `code`와 종료 코드는 그대로다.

### AXM-19 버전·기능을 기계가 물을 수 없고, 목표를 표준 입력으로 줄 수 없다

- 방향: (나) · 심각도: 낮음
- 실제로 본 것
  - `--version` → `codaryn 0.1.0`(글). `--version --json` → `invalid_arguments`.
  - 목표는 인자로만 준다. `--goal -`는 인자 검사를 통과했다(그 뒤 `provider_not_configured`로 끝나 실제로 어떻게 쓰이는지는 보지 못했다. 코드상 표준 입력을 읽는 곳은 찾지 못했다).
- 왜 문제인가: 다른 에이전트는 "이 판이 `plan`을 아는가, 어떤 `schemaVersion`인가"를 미리 알 수 없다. 긴 목표나 따옴표가 든 목표는 셸 인자로 주기 어렵다(Windows에서 특히).
- 개선안
  - `codaryn --version --json` → `{"schemaVersion":1,"kind":"version","status":"ok","exitCode":0,"version":"0.1.0","resultSchemaVersion":1,"commands":[…],"providers":["anthropic","openai","scripted"],"workflows":["code","document","analyze","organize"]}`.
  - `--goal-file <작업 공간 밖 파일>`. 표준 입력보다 기존 규칙(파일 위치 검사, 키 검사)에 맞는다.
- 영향 범위: 계약, CLI, 문서 · 예상 크기: 300~450줄
- 호환: 새 옵션과 새 출력. 기존 출력 변화 없음.

### AXM-20 진행 줄에 대상이 없고, 같은 확인 줄이 되풀이된다

- 방향: (가) · 심각도: 낮음
- 실제로 본 것(체험 예시)
  - `codaryn: 파일 읽기 — 허용 (read_file)`: 어느 파일인지 없다. 쓰기는 `파일 만듦 summary.md`로 나온다.
  - `codaryn: 명령 실행 — 거부 (command/command_not_allowed)`: 어느 명령인지 없다.
  - 22줄 가운데 5줄이 `보호 대상 확인 — 바뀌지 않음 (…)`이다.
- 개선안: 읽기·검색 줄에 가린 경로를 붙인다(`파일 읽기 — 정책 통과 notes.md`). 거부된 명령은 실행 파일 이름만. "바뀌지 않음" 확인 줄은 첫 번째만 보이고 나머지는 끝 요약의 한 줄(`보호 대상 확인 5회: 바뀌지 않음`)로 모은다. UX 중간 점검과 겹치면 그쪽을 따른다.
- 영향 범위: 문구, CLI, GUI · 예상 크기: 200~350줄
- 호환: stderr 고정 값이 넓게 바뀐다(usage 3절의 예시 포함).

### AXM-21 오류의 "고치는 법"이 상황과 맞지 않는 경우

- 방향: (가) · 심각도: 낮음
- 실제로 본 것
  - `plan`에서 난 `plan_run_missing`의 힌트: "적용을 되돌리려면 그 계획 실행을 남겨 두어야 합니다. 지운 실행 폴더가 있으면 되살리세요." 사람은 되돌리기가 아니라 계획 보기를 했다. `message`는 맞다("Make the plan again").
  - `plan_records_changed`의 힌트: "codaryn plan으로 계획을 새로 만들고…". `plan`은 계획을 보이는 명령이다. 계획은 `run`이 만든다. `message`는 맞다("Make the plan again with a new run").
  - 간편 형식에 설정 파일이 없을 때: `invalid_config`, "설정 파일 — limits.maxModelTurns 값이 올바르지 않습니다". 파일이 없는 것인데 "값이 올바르지 않다"고 한다.
  - 판정을 기록한 뒤의 보고서: `Verdict: **rejected**` 위에 "The run waits for a person's verdict"가 그대로 있다. `runs --json`에는 판정이 없다(여전히 `awaiting_review`).
- 개선안: 힌트를 명령별로 나눈다(`error.hint.plan_run_missing.plan` / `.revert`). `plan_records_changed`의 힌트는 "codaryn run으로". 설정 없음은 `diagnostic.code:"missing"`. 판정이 있으면 기다림 줄을 뺀다. `runs` 항목에 `review?: "accepted"|"rejected"`.
- 영향 범위: 문구, CLI, 계약(`runs` 항목) · 예상 크기: 200~350줄
- 호환: 사람용 글이 바뀐다. `runs --json`에 필드 더함.

### AXM-22 사람용 글의 언어가 섞인다

- 방향: (가) · 심각도: 낮음
- 실제로 본 것: 진행 줄과 끝 요약은 한국어다. `report`, `plan`, `changes`의 글은 영어다. `cleanup`은 요약이 한국어이고 끝 두 줄이 영어다("Nothing was removed. To remove the run records, run the same command with --confirm …"). 계약 18.13절이 "아직 카탈로그 id가 없어 영어로 둔다"고 적는다.
- 왜 문제인가: 지우기의 확인 방법과 "지우면 되돌릴 수 없다"는 경고가 영어다. 가장 조심해야 할 줄이 가장 읽기 어렵다.
- 개선안: UX 중간 점검의 몫이다. AX 쪽 요구는 하나다: **되돌릴 수 없는 일을 확인하는 줄부터** 카탈로그로 옮긴다.
- 영향 범위: 문구(카탈로그), CLI · 예상 크기: UX 점검에 따름
- 호환: 사람용 글만 바뀐다.

## 4. 종료 코드·JSON 꼴 실측 표

모두 빌드 `e0e1180`, 터미널 없음(표준 입력 비움), scripted 제공자, 키 환경 변수를 지운 채 돌렸다. `kind`는 stdout JSON의 값이다. "글"은 stdout이 JSON이 아닌 경우다.

### 4.1 실행(`run`)

| 경우 | 명령 | 종료 | `kind` | `status`/`reason` 또는 `code` |
| --- | --- | --- | --- | --- |
| 검증 통과(재수정 1회) | `run --task demo1/task.json` | 0 | run | done / verified |
| 검증기 없음 | `run --task nov/task.json` | 3 | run | needs-input / no_verifier |
| 검증 실패 | `run --task vfail/task.json --quiet` | 1 | run | failed / verifier_failed |
| 턴 한도 | `run --task budget/task.json --quiet` | 4 | run | budget-exhausted / max_model_turns |
| 사용량 없음 | `run --task nousage/task.json --quiet` | 4 | run | budget-exhausted / usage_unknown |
| 대본이 모자람 | `run --task short/task.json --quiet` | 1 | run | failed / model_error |
| 취소 파일 | `run --task slow/task.json --cancel-file …` | 5 | run | cancelled / cancelled |
| 계획 만듦 | `run --task org1/task.json` | 3 | run | needs-input / plan_pending |
| 사람 검토 대기 | `run --task rev/task.json` | 3 | run | needs-input / awaiting_review |
| 비밀 가림, 쓰기 실패 3건 뒤 성공 | `run --task sec/task.json` | 0 | run | done / verified |
| 다른 실행이 잠금 | `run --task slow/task.json` | 6 | error | workspace_locked |
| 대본 형식 오류 | `run --task badscript/task.json` | 2 | error | invalid_script |
| task에 키 필드 | `run --task keytask.json` | 2 | error | key_in_file |
| task JSON 문법 오류 | `run --task badtask.json` | 2 | error | invalid_task (`diagnostic.code` json_syntax) |
| 없는 task 파일 | `run --task nope.json` | 2 | error | invalid_task |
| 비밀 변수 없음 | `run --task sec/task.json`(변수 없이) | 2 | error | secret_env_missing |
| 모르는 옵션 | `run --task … --bogus` | 2 | error | invalid_arguments |
| `--events jsonl` | `run --task … --events jsonl` | 2 | error | invalid_arguments |
| 한 줄 실행, 설정 없음 | `run "hello"` | 2 | error | invalid_config |
| 간편 형식, 설정 없음 | `run --workspace … --goal x` | 2 | error | invalid_config |
| 간편 형식, 설정 있음·키 없음 | `run --workspace … --goal x --config …` | 7 | error | provider_not_configured |

### 4.2 계획·적용·검토

| 경우 | 명령 | 종료 | `kind` | `status` 또는 `code` |
| --- | --- | --- | --- | --- |
| 계획 보기 | `plan --task … --run latest` | 0 | 글 | — |
| 계획 보기 JSON | `plan … --json` | 0 | plan | pending |
| 적용 뒤 계획 보기 | `plan … --run <id>` | 0 | 글 | ("applied") |
| 표시가 있는 계획 보기 | `plan … --run <id>`(`records-changed.json` 있음) | 0 | plan | pending (경고 없음, AXM-2) |
| 고친 `plan.json` 보기 | `plan … --run <id>` | 2 | error | invalid_run_record |
| `plan.json` 없음 | `plan … --json` | 2 | error | plan_run_missing |
| 계획이 아닌 실행 | `plan --task demo1/task.json --run latest` | 2 | error | run_not_plan |
| digest 없이 적용 | `apply … --run <id>` | 2 | error | plan_not_approved |
| 틀린 digest | `apply … --digest 000000000000` | 2 | error | plan_not_approved |
| 짧은 digest | `apply … --digest 55c3` | 2 | error | invalid_arguments |
| `--run latest` | `apply … --run latest --digest …` | 2 | error | invalid_arguments |
| 적용 성공 | `apply … --run <id> --digest <12자>` | 0 | apply | done / verified |
| 두 번째 적용 | 같은 명령 | 2 | error | plan_already_applied |
| 고친 `plan.json` 적용 | `apply …` | 2 | error | invalid_run_record |
| 표시가 있는 계획 적용 | `apply …` | 2 | error | plan_records_changed |
| 판정 없이 검토 | `review … --run latest` | 2 | error | invalid_arguments |
| 수락 | `review … --accept --note ok --json` | 0 | review | (`verdict` accepted, `replaced` false) |
| 다시 거절 | `review … --reject --json` | 0 | review | (`verdict` rejected, `replaced` true) |
| 검토 대기가 아닌 실행 | `review --task demo1/task.json … --accept` | 2 | error | run_not_awaiting_review |

### 4.3 기록 읽기·되돌리기·정리

| 경우 | 명령 | 종료 | `kind` | `status` 또는 `code` |
| --- | --- | --- | --- | --- |
| 목록 | `runs --workspace … --json` | 0 | runs | listed |
| 목록, 없는 작업 공간 | `runs --workspace nope` | 2 | error | workspace_not_found |
| 보고서 | `report … --run latest` | 0 | 글 | — |
| 보고서 JSON | `report … --json` | 0 | report | complete |
| 도는 실행의 보고서(id) | `report … --run <id> --json` | 3 | report | incomplete (`result` null) |
| 도는 실행뿐, `latest` | `report … --run latest --json` | 2 | error | run_not_found |
| 없는 실행 | `report … --run 20200101T000000Z-aaaaaaaa` | 2 | error | run_not_found |
| 보고서에 `--events` | `report … --events jsonl` | 2 | error | invalid_arguments |
| 변경 보기 | `changes --task … --run latest` | 0 | 글 | — |
| 변경 보기 JSON | `changes … --json` | 0 | changes | (`status` 없음) |
| 변경 보기, 설정 없는 간편 형식 | `changes --workspace … --run latest` | 2 | error | invalid_config (AXM-14) |
| 도는 실행뿐, `latest` | `changes … --run latest --json` | 2 | error | run_not_found ("no runs yet") |
| 되돌리기 미리보기(적용) | `revert … --run latest --dry-run` | 0 | revert | complete (`dryRun`, `moveSafetyUnchecked`) |
| 적용 되돌리기 | `revert … --run latest` | 0 | revert | complete |
| 바꾼 것이 없는 실행 되돌리기 | `revert … --run <계획 실행>` | 0 | revert | complete (`reverted` 빈 배열) |
| 취소된 실행 되돌리기 | `revert … --run latest` | 0 | revert | complete |
| 도는 실행 되돌리기(id) | `revert … --run <id>` | 6 | error | workspace_locked |
| 도는 실행뿐, `latest` | `revert … --run latest` | 2 | error | run_not_found |
| 잘못된 run id | `revert … --run ../x` | 2 | error | invalid_arguments |
| 정리 요약 | `cleanup --workspace … --json` | 0 | cleanup | `mode` preview |
| 정리 미리보기 | `cleanup … --older-than 0 --json` | 0 | cleanup | `mode` preview |
| 틀린 확인 | `cleanup … --confirm 000000000000` | 3 | cleanup | `mode` plan_changed (`code` 없음) |
| 확인, 되돌리지 않은 실행 남김 | `cleanup … --confirm <d>` | 0 | cleanup | `mode` applied (`removed` 빈 배열) |
| 확인하고 지움 | `cleanup … --confirm <d> --include-not-reverted` | 0 | cleanup | `mode` applied |
| 파일이 열려 있어 못 지움 | 같은 꼴 | 1 | cleanup | `mode` applied, `outcome.ok` true, `kept[].reason` io_error |
| 도는 실행 고르기 | `cleanup … --older-than 0 --json` | 0 | cleanup | `mode` preview (`blocked[].code` lock_held) |

### 4.4 점검·설정·도움말

| 경우 | 명령 | 종료 | `kind` | `status` 또는 `code` |
| --- | --- | --- | --- | --- |
| 점검, 모두 정상 | `doctor --task demo1/task.json` | 0 | 글 / doctor | ok |
| 점검, 깨진 task | `doctor --task badtask.json` | 1 | 글 | (fail) |
| 점검, 설정 없음 | `doctor --workspace … --json` | 1 | doctor | fail |
| 점검, 키·모델 없음 | `doctor --config … --workspace …` | 1 | 글 | (fail) |
| 점검, 실행이 도는 중 | `doctor --task slow/task.json` | 3 | 글 | (warn: 잠금) |
| 모델 목록, 키 없음 | `models --json` | 7 | error | provider_not_configured |
| 설정 만들기(터미널 없음) | `init --config <새 파일> --json` | 0 | init | created (`interactive` false) |
| 설정이 이미 있음 | 같은 명령 | 2 | error | config_exists |
| 버전 | `--version` | 0 | 글 | — |
| 버전 JSON | `--version --json` | 2 | error | invalid_arguments |
| 도움말 | `--help`, `help run` | 0 | 글 | — |
| 없는 명령의 도움말 | `help bogus` | 2 | error | invalid_arguments |
| 인자 없음 | (없음) | 2 | error | invalid_arguments |
| 없는 명령 | `frobnicate` | 2 | error | invalid_arguments |

### 4.5 표에서 읽히는 것

- 종료 3은 일관되게 "사람이 볼 것이 남음"이다: `needs-input`, 불완전한 보고서, `doctor`의 주의, `cleanup`의 `plan_changed`. 문서의 `partial` 되돌리기와 `init`의 `declined`도 3이다(돌리지 않음).
- 종료 1은 두 뜻이다: 실행의 `failed`, `doctor`의 `fail`, `cleanup`의 "문제로 남김". 명령이 다르므로 섞이지는 않는다.
- 종료 2는 넓다. 입력 오류와 상태 오류가 함께다(AXM-9).
- 문서와 어긋난 종료 코드는 찾지 못했다. 어긋난 것은 꼴이다(AXM-3, AXM-12).
- `review`는 수락과 거절 모두 0이다. 계약대로다. 거절을 실패로 다루려는 기계는 `verdict`를 읽어야 한다.

## 5. 개선 단위 제안

"결정 하나 = 한 단위, 약 1,500줄 이하"(G-12)로 묶었다. 순서는 우선순위다. 크기는 시험과 문서를 포함한 어림이다.

| 순서 | 단위 | 담는 것 | 결정 하나 | 어림 크기 | 깨는 변경 |
| --- | --- | --- | --- | --- | --- |
| 1 | **AX-U1 승인 화면의 신뢰** | AXM-2, AXM-15 | 계획 보기는 믿을 수 없는 계획을 그렇게 말하고, 에이전트의 설명과 digest의 뜻을 보인다 | 500~850줄 | 표시가 있는 계획의 종료 코드(질문 2) |
| 2 | **AX-U2 에이전트의 마지막 말** | AXM-1, AXM-16 | 마지막 답을 결과에 싣고 사람에게 "검증되지 않은 말"로 보이며, 지시문이 그 답을 쓰게 한다 | 500~800줄 | 없음(더함). 시스템 글 고정 값 바뀜 |
| 3 | **AX-U3 정리 출력의 꼴** | AXM-3 | `cleanup`의 출력을 계약으로 옮기고 `status`·`ok`·digest 불일치를 한 규칙으로 | 400~700줄 | 있음(질문 1, 2) |
| 4 | **AX-U4 모델이 받는 오류** | AXM-5, AXM-6, AXM-7 | 도구 오류는 `error (<code>): <무엇이> <다음 행동>` 한 꼴로 모델에 간다 | 700~1,100줄 | 없음. 기록의 `content` 고정 값 바뀜 |
| 5 | **AX-U5 실패한 호출 보이기** | AXM-4 | 정책 통과 뒤 실패한 호출을 진행·요약·보고서에 센다 | 300~500줄 | 없음(더함) |
| 6 | **AX-U6 실행 상태와 다시 시도** | AXM-8, AXM-9 | 기계는 `phase`, `modelError.kind`, `retryable`로 기다릴지·다시 할지·포기할지를 정한다 | 700~1,100줄 | `latest`의 `run_not_found` → `run_in_progress`(그 경우만) |
| 7 | **AX-U7 기계용 계약 한 곳** | AXM-11, AXM-12 | 오류 코드 표 하나와 필드 규칙 한 절. 빠진 `status` 셋 더함 | 400~650줄 | 없음(더함) |
| 8 | **AX-U8 맡기기 전 권한 요약과 가림 보고** | AXM-10, AXM-17 | 실행 전에는 "할 수 있는 것", 끝에는 "보호 장치가 한 일"을 숫자로 보인다 | 800~1,200줄 | 없음(더함). 고정 값이 가장 넓게 바뀜 |
| 9 | **AX-U9 읽기 명령의 가벼운 형식** | AXM-14 | 읽기만 하는 명령은 비밀과 작업 종류만 해석한다 | 300~500줄 | 없음(실패가 성공으로) |
| 10 | **AX-U10 진행 이벤트의 길** | AXM-13 | 질문 3의 답에 따름. 권장안이면 시작 줄의 runId와 문서 정리 | 100~200줄(권장안) | 없음 |
| 11 | **AX-U11 다듬기** | AXM-18, AXM-19, AXM-20, AXM-21 | 인자 오류의 문구, `--version --json`, `--goal-file`, 진행 줄의 대상, 힌트 | 850~1,450줄. 넘으면 둘로 | 없음 |

- AXM-22(언어 섞임)는 UX 중간 점검의 단위에 맡긴다.
- 1~3은 "높음"을 닫는다. 4~6은 모델과 기계의 판단을 돕는다. 7 뒤부터는 통합 비용을 줄인다.
- AX-U2, AX-U4는 실제 모델의 행동을 바꾸려는 것이다. 효과는 실제 호출 점검에서만 확인된다. 오프라인에서는 "모델이 받는 글이 바뀌었다"까지만 시험할 수 있다.
- AX-U8은 stderr와 결과 JSON의 고정 값을 가장 많이 바꾼다. usage 문서의 예시 출력도 다시 찍어야 한다. 다른 단위와 겹치지 않게 마지막 쪽에 둔다.

## 6. 사용자 결정이 필요한 것

1. **기존 JSON 계약을 깨는 변경을 허용하는가?**
   - 대상: `cleanup`의 `outcome.ok`의 뜻과 digest 불일치의 꼴(AXM-3), `latest`가 도는 실행만 있을 때의 코드(AXM-8).
   - 권장: **허용한다. 단 `cleanup`과 "도는 실행" 두 곳에 한정한다.** `cleanup`의 출력은 아직 계약 밖에 있다(18.13절 "계약으로 옮길 제안"). 지금 고치는 값이 가장 싸다. 나머지 모든 변경은 더하기만 한다. `schemaVersion`은 1로 둔다(필드를 더하는 것은 판을 올리지 않는다는 규칙을 계약에 적는다).
2. **"digest가 맞지 않음"과 "믿을 수 없는 계획"을 어느 종료 코드로 모으는가?**
   - 지금: `apply`의 틀린 digest는 오류/2, `cleanup`의 틀린 digest는 3, 표시가 있는 계획의 `plan`은 0, 그 `apply`는 2.
   - 권장: **거부는 모두 오류 JSON, 종료 2**(`cleanup`도 `cleanup_plan_changed`/2). **계획 보기는 표시가 있으면 3**(보이기는 하되 "확인 필요").
3. **기계용 진행 이벤트(`--events jsonl`)를 연결하는가?**(AXM-13)
   - 권장: **연결하지 않는다.** 시작 줄에 runId를 싣고, 기록 파일을 따라 읽는 법을 문서에 적는다. DR-20(독립 GUI는 앱 계층을 직접 쓴다)과 맞는다. 다른 에이전트가 Codaryn을 긴 작업의 부품으로 쓰는 일이 실제 요구가 되면 그때 연결한다. 코드와 시험은 남긴다.
4. **에이전트의 마지막 말을 사람에게 보이는가?**(AXM-1)
   - 걱정: 모델의 말은 검증되지 않았다. "완료했습니다" 같은 말이 과신을 부를 수 있다.
   - 권장: **보인다. 항상 "에이전트의 말(검증된 사실이 아님)"이라는 머리말과 함께, 검증 결과 줄 아래에.** 보이지 않으면 "못 했다"는 말도 사라진다. 그쪽 피해가 더 크다.
5. **모델에게 주는 지시문과 오류 문구를 지금 바꾸는가, 실제 호출 점검 뒤에 바꾸는가?**(AXM-5, 6, 7, 16)
   - 권장: **지금 바꾼다.** 실제 호출 점검은 바뀐 글로 하는 편이 낫다. 점검을 먼저 하면 같은 점검을 두 번 한다.
6. **가림 통계(등록된 비밀 수, 가린 글 수)를 결과에 싣는가?**(AXM-17)
   - 걱정: 개수도 정보다(비밀이 몇 개 있는지).
   - 권장: **싣는다. 개수만.** 값도 이름도 위치도 싣지 않는다. 보안·개인정보 검토자의 확인을 단위의 완료 조건에 넣는다.

## 7. 확인하지 못한 것

- **실제 모델의 행동.** scripted 제공자만 썼다. 지시문과 오류 문구에 대한 판단(AXM-5, 6, 7, 16)은 "모델이 받는 글"을 본 것이고, 그 글이 행동을 어떻게 바꾸는지는 추측이다.
- **실제 API 오류.** `model_error`의 종류별 결과, 재시도, `model_list_failed`(8)는 돌리지 않았다. AXM-9의 "결과에 종류가 없다"는 계약과 코드에서 읽었고, 대본이 모자란 경우 하나로만 실측했다.
- **제공자별 실측.** Anthropic과 OpenAI 어댑터의 차이(AXM-7)는 코드만 읽었다. 가짜 서버로도 돌리지 않았다.
- **GUI와 앱 계층.** Electron을 띄우지 않았다. 앱 계층은 `src/app/types.ts`의 이벤트와 질문 형만 읽었다. GUI의 승인 화면이 AXM-2, AXM-15와 같은 문제를 갖는지는 모른다.
- **터미널이 있을 때.** `apply`의 예/아니오 질문, `init`의 대화, 위험한 이동의 동의 질문은 보지 못했다.
- **만들지 못한 경우.** `partly_removed`, 되돌리기의 `partial`(3), `protected_changed`, `state_changed`(실행 중 기록 변경), `consent_required`, `plan_stale`, `apply_incomplete`, `plan_secrets_differ`, `internal_error`(70), `SIGINT`로의 취소.
- **정책 좁힘 줄(DR-41).** 좁혀지는 설정을 만들지 않아 그 진행 줄은 코드로만 보았다.
- **영어 출력.** 메시지 언어가 ko인 환경에서만 돌렸다.
- **문서 전체.** `docs/usage.md`, `docs/privacy.md`, `docs/design/general-tasks.md`, `docs/design/ux-design.md`는 해당 절과 목차만 읽었다. 이 문서들이 이미 적어 둔 한계를 내가 "문서에 없다"고 잘못 적었을 수 있는 곳은 AXM-17 하나다(계약 10절과 privacy 13절에 있음은 확인했고, 결과 화면에 없음은 실측했다).
