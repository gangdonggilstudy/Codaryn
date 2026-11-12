# R-59 병합 전 검토 — 단위 U-32 (GUI 후속)

```
검토자: w3:pA (이 코드의 구현자가 아님). 읽기 전용: 저장소 파일 수정·커밋 없음
대상: unit/U-32-p5u-gui f507dd6 (main 8ff55f6을 받은 판). git diff 8ff55f6 f507dd6 -- gui: 16파일 +508/-22
      (그 밖에 docs/design/standalone-gui.md 4줄)
결과: 높음 0, 중간 0, 낮음 1, 정보 4

실행 (f507dd6을 git archive로 .codaryn/r59/tree에 풀어 빌드):
  루트 빌드: tsc 0
  GUI npm test: 빌드·lock 검사 통과, GUI 유닛 178건 중 178 통과 (U-32·UXM-24·UXM-14 새 시험 포함)
  연기 시험 두 번: 186건 중 186 통과, 186건 중 186 통과. 두 번 다 app exit 0
    planAgentWords, markedPlan, reportRecordsChangedFirst, revertRecordsChanged 포함
  Electron:
    claude-gui에 설치된 것을 경로로만 썼다. smoke.mjs의 Electron 경로 한 줄만 바꾼 사본(smoke-r59.mjs)으로 돌렸다
    새로 설치하거나 내려받지 않았다
    끝난 뒤 남은 electron.exe 없음
  node_modules:
    루트는 이 worktree의 것을 사본으로 썼다
    gui/node_modules/electron은 claude-gui의 형식 파일만 dist 없이 베꼈다. R-43과 같은 방식이다
  실험 (실제 CLI와 대본 모델, 합성 값, 네트워크 없음): .codaryn/r59/r59-*.test.mjs, 출력은 r59-*-out.txt
실행하지 않은 것: 실제 API, 셸에 명령을 그대로 붙여 넣었을 때의 동작(정보 I-2)
```

## 1. 판단: 병합해도 되는가

**병합해도 된다.**
- 다섯 중점 모두에서 막을 것을 찾지 못했다.
- 낮음 1건은 실행이 시작될 때 쓴 `--config`에 대한 안내가 빠진 것이다(L-1). 막지 않으며, 후속 문구 수정으로 충분하다.
- (4) 앱 계층 경계는 기존 관행 안이다. 앱 계층으로 옮기는 안은 내 몫의 선택 과제로 제안한다(I-1, 3절).

## 2. 중점별 결론

### (1) summary가 가림과 길이 제한을 거치는가, HTML로 해석될 길, 제어·양방향 문자

**결론: 거친다. HTML로 해석되는 길이 없고, 제어·양방향 문자는 남지 않는다.**

요약은 네 단계를 차례로 거친다.

| 단계 | 하는 일 |
|---|---|
| CLI `plan`(`planSummary`, 앱 계층 `plan`이 그대로 넘김) | 등록 값을 가림. `hideKeys`(지금 키와 키 모양), `cleanText`, 2000자 상한(`MAX_PLAN_SUMMARY_CHARS`×4). 도구는 500자에서 받는다 |
| 엔진 호스트 | 모든 키 변수 값으로 `hideAllKeys` → `quoteModelText(…, 20줄, 76열)` → 줄마다 `shown`, 빈 줄 버림, 21줄까지 |
| 주 프로세스 `toPlanView` | 배열, 21줄 이하, 줄마다 짧은 글, 비지 않음, LF·TAB 없음, `UNSAFE_IN_MESSAGE` 없음. 하나라도 어기면 보기 전체가 `host_error` |
| 렌더러 | `el()`이 `textContent`로만 넣는다(`gui/src/renderer/shell/dom.ts:8`). 렌더러에 `innerHTML`류가 없고, CSP가 `default-src 'none'`이다 |

실험 A(`r59-summary.test.mjs`)의 방식:
- 실제 CLI로 계획을 만들었다(organize, 대본 모델의 `propose_plan` summary).
- `plan --json`(앱 계층 `plan`의 출력과 같다)을 받았다.
- 그것을 판의 `planValue`에 넘겼다. 이때 `modelText`는 `main.ts`와 같은 방식으로 짰다.
- 그 결과를 `toPlanView`에 넣었다.

| summary에 넣은 것 | 창에 가는 줄 |
| --- | --- |
| `<img onerror=…><script>…</script>` | 글자 그대로 한 줄. `textContent`라서 태그가 아니다 |
| RLO/PDF, LRI·FSI·PDI, LRE·RLE, LRM·RLM·ALM | CLI의 `cleanText`가 모두 `?`로 바꾼다. 남은 양방향 문자 0 |
| ZWSP·ZWJ·BOM, 보이지 않는 글자만 | `quoteModelText`가 `?`로 바꾼다(`???`) |
| ANSI ESC, BEL, NUL, DEL, NEL, U+2028·2029, TAB, CRLF | `?`. 줄을 나누지 않는다 |
| 480자 한 낱말, 줄바꿈 240개 | 72열로 접힌 7줄. 21줄 상한 안이다 |
| 키 모양(합성, 실행 중에 만듦) | `[key]` |
| 토큰 모양 | 가림이 표지 조각을 다시 가린 토큰 글. 값은 없다 |
| 넓은 한글 120자와 ZWJ 이모지 | 5줄. ZWJ는 `?`가 된다(`👨?👩?👧`, 겉모양만의 문제) |

- 모든 경우에 보기가 열리고(`viewOk`), `UNSAFE_IN_MESSAGE`에 걸리는 줄이 0이다. 가장 긴 줄은 72자다.
- 주 프로세스에 직접 넣어 본 값(호스트가 그리지 않은 줄)도 모두 거부됐다: RLO가 든 줄, LF가 든 줄, 22줄, 빈 줄, 배열이 아닌 값, 문자열이나 1인 `recordsChanged`.
- 그래서 호스트가 고장 나도 주 프로세스가 닫힌 쪽으로 막는다. 모델이 요약으로 계획 보기를 깨뜨리는 길(`host_error`)도 이 사슬에서는 찾지 못했다.

### (2) 표시가 있는 계획에 승인 토큰이 정말 없는가, 주 프로세스가 렌더러를 믿지 않는가

**결론: 그렇다. 마지막 방어는 CLI·엔진에 있다.**

- **토큰 발급:**
  - 승인 토큰은 주 프로세스의 `plan` 처리기만 낸다. `planApprovable(view)`가 참일 때, 곧 `pending`이고 `recordsChanged`가 없을 때만이다(`gui/src/main/ipc.ts:545`).
  - `view`는 엔진 호스트의 값을 주 프로세스가 다시 검사한 것이다. 렌더러가 보낸 값이 아니다.
  - `recordsChanged`가 불리언이 아니면 보기 전체를 거부한다.
- **적용:**
  - `applyPlan`은 토큰만 받는다. 모르는 토큰이면 `unknown_plan`이다(`ipc.ts:555-556`).
  - 실행 목록의 표시(`target.recordsChanged`)는 렌더러의 표시에만 쓰인다. 주 프로세스는 그것을 믿을 근거로 쓰지 않는다.
- **연기 시험 `markedPlan`(두 번):**
  - 표시를 단 계획은 경고가 첫 요소이고, 적용 단추와 요약이 없다.
  - `window.codaryn.plan(...)`을 렌더러에서 직접 불러도 `approval`은 `null`이다. 대화상자는 0번 떴다.
- **실험 C(`r59-mark.test.mjs`): 보인 뒤에 표시가 생긴 계획.** 토큰이 이미 나간 경우와 같다.
  - 실제 CLI `apply`에 그 전에 본 다이제스트를 주었다. 결과는 `plan_records_changed`(종료 2)이고, 아무것도 옮기지 않았다.
  - 앱 계층 `applyPlan`도 이 `runApply`를 돌린다. 엔진은 잠금 아래서 한 번 더 확인한다(`ApplyDeps.planRecordsChanged`).
  - 그래서 창이나 주 프로세스가 놓쳐도 적용되지 않는다.
- **표시가 생긴 뒤의 `plan --json`:** `recordsChanged: true`이고 `summary`가 빠진다. 표시를 읽지 못하면 표시가 있는 것으로 센다(fail closed).

### (3) 안내하는 CLI 명령이 실제 인자 해석기를 통과하는가, 다이제스트 앞 12자

**결론: 통과하고, 12자도 맞다. 실제 CLI로도 적용된다.**

- **유닛 시험:** 두 언어의 두 꼴을 `parseApplyArgs`로 읽는다. `<…>`는 채운 값으로 바꾼다. runId와 `digest === DIGEST.slice(0, 12)`를 본다(`u32-plan-view.test.ts:174`).
- **12자 규칙:**
  - CLI는 12~64자 소문자 hex를 받는다(`MIN_PLAN_DIGEST_PREFIX = 12`).
  - CLI `plan`의 안내 줄도 `digest.slice(0, 12)`를 쓴다(`src/cli/plan-commands.ts:385`).
- **실험 B(`r59-apply.test.mjs`): 판의 `applyCommands`가 낸 글을 실행을 시작한 방식대로 채워 실제 CLI로 돌렸다.**

  | 명령 | 결과 |
  |---|---|
  | 꼴 1 `codaryn apply --task <task file> --run R --digest D12` | 종료 0, `apply` `done`, 파일 옮겨짐 |
  | 꼴 2, 설정 파일 없음 | `invalid_config`: "limits.maxTotalTokens is not set … The quick form of plan, apply and review reads the run settings … from the config". 옮긴 것 없음 |
  | 꼴 2, 그 실행이 쓴 설정 파일(`--config`)을 더함 | 종료 0, `done`, 옮겨짐. L-1을 보라 |
  | 다이제스트 11자 | `invalid_arguments` |
  | 틀린 12자 | `plan_not_approved` |

### (4) quoteModelText를 dist의 CLI 모듈에서 직접 읽어 오는 방식이 앱 계층 경계에 맞는가

**결론: 기존 관행 안이라 이 단위를 막지 않는다. 앱 계층으로 옮기는 안을 내 몫으로 제안한다(I-1).**

- **원칙:** 어댑터 계약 1절 원칙 1은 "어댑터는 입력과 표시만 한다"이고, 원칙 6은 "앱 함수나 CLI 출력만 쓴다"이다. `quoteModelText`는 판단이나 보안 검사가 아니라 표시 함수다. 순수 함수이고, 접기·공백·보이지 않는 글자·키 모양을 다룬다.
- **같은 일이 이미 있다:** 엔진 호스트는 이미 `cli/text-safety.js`(cleanText, hideKeys)와 `cli/human/output.js`(진행 줄)를 같은 방식으로 경로로 읽는다(`gui/src/engine-host/main.ts:153-154`). `standalone-gui.md` 15절도 N-C(`src/cli/human`)의 순수 함수에서 문구를 받는다고 적는다.
- **보안이 이것에 기대지 않는다:**
  - 등록 값 가림은 CLI `plan`이 이미 했다.
  - 호스트는 그 앞에 `hideAllKeys`를, 그 뒤에 `shown`을 다시 거친다.
  - 주 프로세스가 마지막으로 검사한다.
  - 모듈이 없거나 `MODEL_TEXT_PREFIX`가 문자열이 아니면 요약을 아예 보이지 않는다(fail closed).
- **약한 점:**
  - 공개 표면이 아닌 내부 모듈과 이름(`format.js`, `MODEL_TEXT_PREFIX`, `FINAL_MESSAGE_MAX_LINES`)을 형식 없이 읽는다.
  - 그래서 CLI 쪽에서 이름을 바꾸면 GUI의 요약이 조용히 사라진다. 다만 연기 시험 `planAgentWords`가 잡는다.
  - 호스트가 CLI의 따옴표 머리(`"  | "`)를 걷어 내는 일을 직접 한다.

## 3. 결과

### 낮음

**L-1 앱 밖에서 시작한 계획의 적용 안내가 `--config`(와 `--vars-file`)를 말하지 않는다**

- **어디:** `gui/src/renderer/i18n/en.ts`, `ko.ts`의 `plan.formUnknown`. 지금 안내가 더하라고 하는 것은 `--profile`뿐이다("add --profile and the profile's name when the run was started with one").
- **무엇:**
  - CLI의 작업 지정 부분(`TASK_FORM_USAGE`)에는 `[--config <config.json>] [--vars-file <path>]`도 있다.
  - 기본 위치가 아닌 설정 파일로 시작한 실행이면, 꼴 2를 안내대로 채워도 그 설정을 읽지 못한다. 그러면 한도가 없어 `invalid_config`가 된다(실험 B).
- **영향:**
  - 옮기는 것은 없다. CLI의 오류 글이 설정 파일을 말해 준다.
  - 사람이 "안내대로 했는데 안 된다"를 한 번 겪을 수 있다.
  - 바뀌기 전 문구에도 없던 것이라 뒷걸음은 아니다.
- **권고:** 괄호의 "add --profile …"를 "--profile·--config·--vars-file은 실행을 시작할 때 쓴 대로 더함"으로 넓힌다. 두 언어 모두다.

### 정보 (건수에 넣지 않음)

- **I-1 (4)의 제안, 내 몫:** 앱 계층에 모델 글 표시 함수를 두고 엔진 호스트는 그것만 읽게 한다.
  - `src/app/index.ts`가 `modelTextRows(text, maxRows?)`를 낸다. 하는 일:
    - `quoteModelText(text, maxRows ?? FINAL_MESSAGE_MAX_LINES, null)`의 줄을 따옴표 머리 없이 돌려준다.
    - 그 최대 줄 수 상수(`MODEL_TEXT_MAX_ROWS`)도 낸다.
  - 엔진 호스트는 `app/index.js`의 필수 이름 목록에 이것을 더한다. 그러면 `format.js` 경로 읽기와 머리 걷기를 뺄 수 있다.
  - 앱 계층 유닛 시험이 CLI `plan`의 줄과 같음을 고정한다.
  - `adapter-contract.md` 5.4에 "모델이 쓴 글의 표시"를 적는다.
  - `cleanText`·`hideKeys`(text-safety)도 같은 방식으로 옮길 수 있다. 다만 그것은 이 단위 밖이다.
  - 크기는 앱 쪽 30줄 안팎과 시험 하나, GUI 쪽 10줄 안팎으로 본다. 병합 조건이 아니다. PM이 고르면 `unit/<id>-p5a-adapter`로 한다.
- **I-2 `<…>` 자리표시:**
  - 바꾸지 않고 셸에 붙여 넣으면 `<`·`>`가 리디렉션으로 읽힌다. 셸마다 다르고, 실행해 보지는 않았다.
  - 이 표기는 CLI 자신의 사용법(`APPLY_USAGE`의 `<runId>`)과 `plan` 안내 줄과 같은 관례다. 화면은 이것이 채울 "형식"이라고 말한다(R-46 L-2, R-50 (나)).
- **I-3 줄바꿈이 든 요약:**
  - CLI의 `cleanText`가 계획 요약의 줄바꿈을 `?`로 바꾼다. 그래서 `quoteModelText`의 줄 나누기는 계획 요약에 쓰이지 않는다(실험: `a?a?…`).
  - CLI `plan` 화면도 같다. U-14 때부터 그렇고 U-32는 그대로 따랐다.
- **I-4 짝 없는 서로게이트:** 사슬을 그대로 지난다(`x\uD800y`). `textContent`에서는 대체 문자로 보이고 다른 해는 없다.

## 4. (5) U-20·U-27 문구의 뒷걸음

**결론: 없다.**

- **`plan.recordsChanged`(U-20):** 경고(`plan.recordsChanged`)와 할 일(`plan.cannotApply`)로 나뉘었다.
  - 옛 문장의 두 부분, 곧 "계획이 다를 수 있다"와 "적용하지 않는다, 같은 작업 종류로 새로 실행하라"가 모두 남았다.
  - "확인한 뒤 그것을 적용하세요"가 더해졌다.
  - 경고는 이제 적용된 계획에도 먼저 보인다. 할 일은 아직 적용하지 않은 계획에만 보인다. 옛 코드는 적용된 표시 계획에 아무 경고도 없었다.
  - `u20-errors-marks.test.ts`의 단언은 하나가 둘로 나뉘었고 약해지지 않았다.
- **`plan.formUnknown`(U-27, R-46 L-2, R-50 (나)):**
  - 지금 글은 "아래는 … 적용 명령의 형식"이고 "작업 지정 부분은 … 채우세요"이며, "붙여 쓸"이라는 말이 없다. 영어도 "the form of the apply command"다.
  - 그래서 `u27-guide-texts.test.ts:99-102`와 `u20`의 "codaryn plan을 말한다"가 그대로 통과한다.
  - R-46 P-2가 남긴 "붙여 쓸 수 있는 명령"은, 이 계획의 실행과 다이제스트가 든 꼴을 보이는 것으로 한 걸음 나아갔다.
- **용어(DR-50):** 작업 종류 / task type, 다이제스트, 작업 공간 폴더. 옛 "task kind"는 이 판의 바뀐 문구에 없다.
- **보고서 경고:** 요약 탭 안에서 탭 위로 옮겨 모든 탭에서 보인다(`reportRecordsChangedFirst`). 저장한 보고서 본문은 바뀌지 않는다.
- **되돌리기:** 미리보기와 결과에 새 안내 `runs.revertRecordsChanged`가 생겼다. CLI `revert`처럼 되돌리기를 거부하지 않는다(연기 시험 `revertRecordsChanged`, 유닛 UXM-14).

## 5. PM 질문

- **I-1을 할지:** 엔진 호스트가 `format.js`를 경로로 읽는 대신 앱 계층의 `modelTextRows`를 쓰게 하는 안이다. 내 몫 단위(앱 쪽)와 GUI 담당의 작은 후속이 짝이 된다.
  - 가정: 병합을 막지 않는 후속으로 두고, PM이 고르면 내가 앱 쪽을 먼저 올린다.
- **L-1:** 문구 고침(GUI 문구 담당)을 이 단위에 넣을지 후속으로 둘지.
  - 가정: 후속.
