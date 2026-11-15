# 어댑터 계약 대 앱 계층 구현: 차이 조사

```
조사자: w3:pA (앱 계층 담당). 조사만 했다: 코드·문서 수정 없음
기준: main 86a9470. git archive로 .codaryn/gap/main에 풀어 읽었다
대상 문서: docs/design/adapter-contract.md(672줄, 내 소유). 앱 계층 쪽만 보았고, GUI 쪽은 GUI 담당의 standalone-gui.md 조사다
대상 코드: src/app/**(19파일, 3,201줄)
대상 시험: tests/unit/app/**(37파일, test() 177개)
상태 표기:
  구현됨 = 코드와 시험이 있다
  일부 = 코드나 시험 중 하나만, 또는 항목의 일부만
  없음 = 코드가 없다
  낡음 = 문서가 지금 코드와 다르다(코드가 맞다)
  추진 안 함 = 결정(DR-20)으로 하지 않는 것
근거의 파일:줄은 86a9470 기준이다. 시험은 tests/unit/app/<파일>:<줄>로 적는다
```

## 요약

- 아래 표의 줄은 70개다. 줄마다 첫 상태로 세면 다음과 같다.

  | 상태 | 수 |
  |---|---|
  | 구현됨 | 45 |
  | 일부 | 7 |
  | 없음 | 11 |
  | 낡음 | 4 |
  | 추진 안 함 | 2 |
  | 유효(임시 결정 AC-D16) | 1 |

  - 6절(이행 표)은 다른 절의 항목과 겹친다. 이행 1과 AC-D3·`src/contracts/app.ts`, 이행 8과 5.9가 같은 것을 가리킨다. 그래서 "없음"의 서로 다른 일은 다음 셋이다.
    - 5.9 질문
    - 이행 1~2
    - 의존 방향
  - "구현됨"이지만 문서가 낡은 곳이 9곳 더 있다(표에 "구현됨 / 낡음"으로 적음). 고칠 문서 자리는 9절에 10곳으로 모았다.
- **기능으로 빠진 것은 하나다: 5.9 실행 중 권한 확인 질문(DR-3).**
  - 계약, 정책, 엔진, 앱 계층, CLI, GUI 어디에도 없다. `confirmation_requested`·`confirmation_answered` 사건이 없고, 정책에 `confirm`이 없다.
  - `RunObserver.confirm`은 타입만 있고 불리지 않는다(`src/app/types.ts:281-289`).
  - 1절의 단계 5 완료 기준 "확인 질문과 취소가 CLI와 같은 의미로 동작한다" 가운데 질문 쪽이 여기에 걸린다. roadmap은 N-11을 단계 5 시작으로 미뤘다(`docs/roadmap.md:109`).
- **구조로 빠진 것은 CLI 이행 계획(7.2)의 이행 1~5다.**
  - 앱 계층이 CLI 모듈 23개를 부르고, CLI 일부가 다시 앱 계층을 부른다. 3절의 목표 방향(`cli → app → 엔진들`)과 반대다. AC-D16이 "이행 2까지" 임시로 허용한 상태가 그대로다.
  - 동작은 바뀌지 않는 이동이다(7.1). 그러니 "최종 설계"에 넣을지는 PM 질문으로 둔다.
- **작은 빈틈:** 적용 경로의 DR-4(명령의 부모 환경)는 코드로 지켜지는데 시험이 없다.
- **문서 낡음 10곳:** 대부분 지난 단위(U-17, R-66 등)가 고친 것을 문서가 아직 "남은 차이·todo·한계"로 적고 있다. 내 문서이므로 한 단위로 정리할 수 있다.

## 1. 원칙과 목표 (1절)

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 단계 5 기준 1: 두 어댑터가 CLI와 같은 엔진·정책·기록 | 구현됨 | `startRun`이 CLI `runCli`를 부르고(`src/app/app.ts:208`), 조립은 CLI와 같은 순서다(`src/app/assemble.ts`). 시험 `app.test.ts:43`, `r4-events.test.ts:86` |
| 단계 5 기준 2: 어댑터에 작업 논리 없음 | 구현됨(앱 쪽) | 실행 전 검사·조립·수명·저장이 앱 계층에 있다. GUI 쪽은 GUI 조사 |
| 단계 5 기준 3: 확인 질문과 취소가 같은 의미 | 일부 | 취소는 구현됨(`app.test.ts:114`, `:141`). 확인 질문은 없음(5.9) |
| DR-8 단일 프로세스: 듣는 소켓 없음, 오래 사는 프로세스 없음 | 구현됨 | `src/app`에 `createServer`·`listen`·`net`·`http`가 없다 |
| 원칙 1: 어댑터는 입력과 표시만 | 구현됨 | 위 기준 2. 다만 실행 전 검사는 아직 CLI 함수 호출이다(7.2 이행 2) |
| 원칙 2: CLI 외부 계약 그대로 | 구현됨 | sp0 고정 시험, 통합 559 |
| 원칙 3: 기록된 것만 알리고 다시 가림 | 구현됨 | `src/app/events.ts`. 시험 `r4-events.test.ts:63`(끼워 넣은 줄은 이벤트가 아님), `r1-decisions.test.ts`(모르는 도구 이름) |
| 원칙 4: 요청에 키·주소·확대 필드 없음 | 구현됨 | `StartRunRequest`(`types.ts:228-245`), `TaskForm`. 권한 질문 부분은 5.9 |
| 원칙 5: 같은 의미(취소·질문) | 일부 | 취소만. 질문은 5.9 |
| 원칙 6: 어댑터는 저장 형식을 읽지 않음 | 구현됨(앱 쪽) | 비교는 store `readRunOriginals`, 계획은 CLI `runPlan`. 앱 계층은 스냅샷·plan.json 형식을 직접 읽지 않는다 |

## 2. 계층과 환경 (3·4절)

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 이름 `src/app`(AC-D1) | 구현됨 | |
| 의존 방향 목표 `cli → app → 엔진들 → contracts` | 없음 | `src/app`이 `src/cli`의 23개 모듈을 import한다(`run.js`, `assemble.js`, `plan-commands.js`, `report.js` 등). 거꾸로 `src/cli/changes.ts`, `main.ts`, `protocol/*`가 `src/app`을 import한다. AC-D16(이행 2까지 허용)이 그대로다 |
| "앱 계층이 쓰는 파일은 지금 실행이 쓰는 것뿐"(3절) | 낡음 | 앱 계층은 설정 파일도 쓴다(5.11 `applySettingsChange`, `createSettings`, `selectModel`). 정리로 기록도 지운다(5.4). 3절 문장을 5.11·5.4와 맞추어야 한다 |
| `AppEnvironment` 필드(4절) | 구현됨 / 낡음 | `types.ts:41-73`에 문서의 필드가 모두 있다. 문서에 없는 `homeDir`(N-1)과 `osLocale`(N-4, doctor)도 있다 |
| 4절 타입을 `src/contracts/app.ts`로 옮김(이행 1) | 없음 | `src/contracts/app.ts`가 없다. 타입은 `src/app/types.ts`에 있다 |
| 사본 환경과 변수 파일 | 구현됨 | `src/app/environment.ts`. 시험 `app.test.ts:212`, `environment.test.ts:50-90` |
| 대소문자 무시 조회 DR-4 | 구현됨 | `copyEnvironment`, `lookupEnv`. 시험 `environment.test.ts:15`, `:39`, `r1-decisions.test.ts` |
| 명령의 부모 환경 DR-4, 실행 | 구현됨 | `assemble.ts:62-65`. 시험 `r1-decisions.test.ts`(변수 파일의 LANG) |
| 명령의 부모 환경 DR-4, 적용 | 일부 | 코드로는 지켜진다. 앱의 `planCommandEnvironment`가 사본 `env`를 주고(`app.ts:606-623`), `runApply`가 `io.parentEnv ?? io.env`를 쓴다(`src/cli/plan-commands.ts:574-577`). 이것을 보는 앱 시험은 없다(`apply.test.ts`에 LANG·부모 환경 시험 없음). 5.6의 "남은 차이" 문장은 낡음(아래 4절) |

## 3. 앱 함수 (5.1~5.8, 5.10, 5.11)

| 절 | 항목 | 상태 | 근거 |
| --- | --- | --- | --- |
| 5.1 | `StartRunRequest`·`RunHandle`·`RunOutcome`·`StartOutcome` | 구현됨 | `types.ts:228-290` |
| 5.1 | 실행 전 오류는 아무것도 만들지 않음 | 구현됨 | `app.test.ts:176` |
| 5.1 | 핸들 뒤에 엔진 시작 | 구현됨 | `app.test.ts:70` |
| 5.1 | 잠금, 다른 작업 공간은 병행 | 구현됨 | `app.test.ts:155` |
| 5.1 | `workflowRef` | 구현됨 / 낡음(코드 주석) | `r14-l3-workflow.test.ts`. `types.ts:238-242`의 주석 "until then a value is `invalid_arguments`"는 낡았다. CLI가 `--workflow`를 받는다 |
| 5.2 | 메모리의 기록으로 만든 이벤트(DR-15) | 구현됨 | `r4-events.test.ts:63` |
| 5.2 | `seq`·`at` | 구현됨 | `r4-events.test.ts:86` |
| 5.2 | `done`이 result.json·잠금 해제 뒤에 풀림 | 구현됨 | `app.test.ts:86` |
| 5.2 | 관찰자 예외가 결과를 바꾸지 않음 | 구현됨 | `app.test.ts:99` |
| 5.2 | 다시 가림, `(unknown tool)` | 구현됨 | `events.ts`, `r1-decisions.test.ts`. 엔진도 기록할 때 바꾼다(AC-D15 (b), `src/engine/index.ts` `recordableCalls`) |
| 5.2 | Y-4 안내 `notice` | 구현됨 | `app.test.ts:236` |
| 5.2 | AC-D3: `Journal.append`가 저장한 레코드를 돌려줌 | 없음 | `src/contracts/journal.ts:158`은 `Promise<void>`. 앱 계층이 스스로 센 `seq`로 대신하고, 시험으로 store의 번호와 같음을 본다 |
| 5.3 | `cancel()`, 취소 파일, 끝난 뒤 무효 | 구현됨 | `app.test.ts:114`, `:141` |
| 5.4 | `report`, `reportMarkdown` | 구현됨 | `app.test.ts:269`, `report-markdown.test.ts` |
| 5.4 | `masking` 개수(U-25), 마지막 답(U-21) | 구현됨 | `u25-masking-counts.test.ts`, `u21-final-message.test.ts` |
| 5.4 | `modelTextRows`(U-42) | 구현됨 | `u42-model-text-rows.test.ts` |
| 5.4 | `latest`, `listRuns`, `resolveRun` | 구현됨 | `n7-runs.test.ts:47-93`, `u22-cleanup-output.test.ts`(run_in_progress) |
| 5.4 | `stateSummary`·`previewCleanup`·`applyCleanup`(DR-39, DR-44, R-34b, U-13, U-22) | 구현됨 | `cleanup.test.ts`, `cleanup-dr44.test.ts`, `cleanup-r34b.test.ts`, `cleanup-u13.test.ts`, `u22-cleanup-output.test.ts` |
| 5.5 | `revert`(미리보기, `latest`, 기록) | 구현됨 | `n7-runs.test.ts:95`, `:125`, `app.test.ts:287` |
| 5.5 | DR-25 되돌리기 동의 | 구현됨 | `apply.test.ts:143`, `:160` |
| 5.6 | `plan`, `review` | 구현됨 | `plan-review.test.ts:25-117` |
| 5.6 | `applyPlan`, 핸들 먼저, 시작 기록 제외, `plan_item_started` 제외 | 구현됨 | `apply.test.ts:76`, `src/app/apply.ts:64` |
| 5.6 | DR-21 동의(`unsafeMoveConsentOf`) | 구현됨 | `apply.test.ts:100`, `:117`, `consent.test.ts` |
| 5.6 | DR-28 `plan_secrets_differ` | 구현됨 / 낡음 | `plan-review.test.ts:54`은 todo가 아닌 시험이다. 문서 333-335줄의 "앱 경유 재현 시험은 todo, 지금은 평문으로 보인다"는 낡았다 |
| 5.7 | `changes`(DR-29, R-11, R-14 L-1, U-16, U-17, U-43) | 구현됨 | `dr29-changes.test.ts`, `r11-changes.test.ts`, `r14-l1-changes.test.ts`, `u16-changes-apply.test.ts`, `u17-read-changes.test.ts`, `u43-changes-records-changed.test.ts` |
| 5.7 | 한계 R-4 L-3(anthropic task는 키·모델·출력 상한이 풀려야 함) | 낡음 | U-17부터 앱은 CLI의 1~7단계(`prepareTask`, `app.ts:355`)만 돌린다. 8단계(모델)는 돌리지 않는다. 398줄은 지울 한계다 |
| 5.7 | CLI `changes`의 `main.ts` 연결은 N-A 몫 | 낡음 | `src/cli/main.ts:210`이 연결했고, 카탈로그도 넘긴다(R-66 R66-M1) |
| 5.8 | `doctor` | 구현됨 / 낡음 | `app.test.ts:305`. 8절의 "12개 항목"은 낡았다. 지금 점검 id는 18개다 |
| 5.8 | `listModels`·`selectModel`, 요청의 제공자(DR-22) | 구현됨 | `models.test.ts:46-110`, `provider.test.ts:52-110` |
| 5.10 | `AppError`, `diagnostic`, `toCliError`·`fromCliError` | 구현됨 | `types.ts:77-83`, `app.test.ts:329` |
| 5.11 | `readSettings`·`createSettings`·`settingsSuggestions`·`proposeSettingsChange`·`applySettingsChange`(넓히기, `policyNarrowings`, 크기 상한, 제공자) | 구현됨 | `settings.test.ts`, `init.test.ts`, `settings-change.test.ts`, `r14-l2-widening.test.ts`, `settings-provider-widening.test.ts`, `settings-widening-precision.test.ts`, `settings-workflow-rules.test.ts`, `settings-size.test.ts`, `provider-keys.test.ts` |

## 4. 권한 확인 질문 (5.9, DR-1·DR-3·DR-10)

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| `ConfirmRequest`·`ConfirmAnswer` 타입 | 일부(타입만) | `src/app/types.ts`. 계약에는 없다 |
| 질문을 만들 수 있는 것은 사용자 설정·프로필뿐 | 없음 | 정책 판정에 "확인" 결과가 없다(허용·거부 둘뿐) |
| 물을 수 없으면 거부(`by: "default"`), `dismissed` | 없음 | |
| 답 한 번만, 답 뒤 정책 2차 판정 다시 | 없음 | |
| 기다림이 `maxDurationMs`에 듦, 취소면 `by: "cancelled"` | 없음 | |
| 새 사건 `confirmation_requested`·`confirmation_answered` | 없음 | `src/` 어디에도 없다 |

## 5. 줄 프로토콜 (6절)

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| `--events jsonl`, `--confirm stdio`, 줄 형식 | 추진 안 함(DR-20) | 코드는 남아 있다: `src/cli/protocol/*.ts`, `vscode/src/core/*.ts`와 시험. 합계 1,451줄. `src/cli/protocol`은 연결되지 않았지만 `src/app`을 import한다. 처리는 PM이 GUI 묶음 때 정한다고 적혀 있다(머리말) |

## 6. CLI 이행 계획 (7.2)

| 이행 | 상태 | 지금 |
| --- | --- | --- |
| 1 계약: `src/contracts/app.ts`, AC-D3, 질문 사건 타입 | 없음 | 위 2절·3절 5.2·4절 |
| 2 앱 계층 추출: `run.ts` 2~8단계를 `src/app`으로, `runCli`는 인자 → `startRun` → 출력 | 없음 | `startRun`이 `runCli`를 부른다(`app.ts:208`). 조립(DR-4)만 앱 계층의 것이다 |
| 3 이벤트와 취소: CLI 진행 줄을 관찰자로, Y-4를 `notice`로, 신호를 `cancel()`로 | 일부 | 앱 쪽은 됨. CLI는 자기 `withProgress`·`cancel.ts`를 쓴다 |
| 4 읽기 명령: report·revert·runs·changes를 앱 함수로 | 일부 / 낡음 | CLI `changes`만 앱 함수를 부른다(`src/cli/changes.ts`). report·revert·runs는 거꾸로 앱이 CLI 함수를 감싼다. 표의 "store의 스냅샷 읽기는 N-C 몫"은 낡았다(`readRunOriginals`가 있다) |
| 5 점검·모델을 앱 계층으로 | 일부 / 낡음 | 앱이 CLI `runDoctor`·`runModels`를 감싼다. 표의 "`doctor` 감싸기만"은 낡았다(`models`도 감싼다) |
| 6 줄 프로토콜 | 추진 안 함 | 위 5절 |
| 7 범용 작업: plan·applyPlan·review | 구현됨 / 낡음 | 표의 "함수는 G-B~G-F 뒤"는 낡았다. 모두 있다(위 5.6) |
| 8 권한 질문 | 없음 | 위 4절 |

## 7. 시험 계획과 결정 (8·10절)

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 8절 시험 표의 대상(시작·이벤트·실행 목록·취소·결과·환경·비교·조립·읽기) | 구현됨 | 위 표들의 시험. 조립의 무결성 사건은 `r1-decisions.test.ts` |
| 8절 머리의 수("38건, changes 7건, vscode 11건"), doctor "12개 항목" | 낡음 | 지금(86a9470)은 app 시험 파일 37개에 test() 177개, `tests/unit/cli/changes.test.ts` 10개(U-36 브랜치에서는 18개, main에 아직 없음), `tests/unit/vscode/core.test.ts` 파일 1개, doctor 점검 18개 |
| 10.2 AC-D13 (a), AC-D14 (a) | 구현됨 / 낡음 | 권고대로 구현했다. "결정 필요"에서 10.1로 옮길 것 |
| 10.2 AC-D15 (b), (a)는 남김 | 구현됨 / 낡음 | 엔진이 기록할 때 바꾸고(`recordableCalls`), 앱 계층의 다시 가림도 남았다. 10.1로 옮길 것 |
| 10.2 AC-D16 임시 의존 `app → cli` | 유효 | 이행 2를 하지 않는 동안 그대로다 |

## 8. 단위 제안 (없음·일부, 각 1,500줄 이하)

줄 수는 바뀌는 줄(더함+뺌)의 어림이고 시험을 포함한다. 담당은 지금 소유 기준이다.

### A. 작은 것 (먼저)

| 단위 | 내용 | 담당 | 줄 |
| --- | --- | --- | --- |
| A-1 적용 경로 DR-4 시험 | 앱 계층 `applyPlan`의 검증기 명령이 실행의 환경 사본(변수 파일의 8자 미만 `LANG` 포함)을 받고, 호출자의 env와 `process.env`를 받지 않음을 고정한다. 재현이 통과하면 시험만 남는다 | p5a | ~150 |
| A-2 문서 정리 | adapter-contract.md의 낡음 10곳(아래 9절 목록)과 `src/app/types.ts:238-242` 주석 | p5a | ~250 |

### B. 5.9 권한 확인 질문 (DR-3): 기능

- 의존 순서: B-1 → (B-2, B-3) → (B-4, B-5) → B-6.

| 단위 | 내용 | 담당 | 줄 |
| --- | --- | --- | --- |
| B-1 계약 | `ConfirmRequest`·`ConfirmAnswer`를 계약으로. `JournalEvent`에 `confirmation_requested {id, kind, subject}`·`confirmation_answered {id, decision, by}`. `PolicyDecision`의 "확인" 결과. 설정·프로필 규칙의 `confirm: true`(task 파일 규칙은 못 둠). `EngineDeps.confirm`. 사람용 문구 id | p4g(계약) | ~450 |
| B-2 정책 | 사용자 설정·프로필에서 온 규칙에만 "확인"을 낸다. task 파일의 `policy`와 작업 종류의 규칙은 낼 수 없다. 설정이 거부한 것은 묻지 않고 거부한다. 합침(DR-41)과의 관계를 시험한다 | 정책 담당 | ~400 |
| B-3 엔진 | "확인"이면 `deps.confirm`을 기다린다. 기다림을 `maxDurationMs`에 넣고, 한도에 닿으면 `budget-exhausted`로 끝낸다. 취소면 `by: "cancelled"`로 끝낸다. 답 뒤 정책 2차 판정을 다시 하고 통과할 때만 실행한다. 두 사건을 기록한다. `confirm`이 없으면 묻지 않고 `by: "default"` 거부(DR-10) | 엔진 담당 | ~650 |
| B-4 앱 계층 | `EngineDeps.confirm`을 `RunObserver.confirm`에 잇는다. 관찰자가 없거나, 던지거나, 형식이 틀린 답이면 `dismissed`(`by: "default"`)로 바꾼다. 실행 신호를 넘기고, 질문 글은 가림본 그대로 둔다. 이벤트에 두 사건이 실리는지 본다. adapter-contract 5.9를 [구현]으로 고친다 | p5a | ~450 |
| B-5 CLI 터미널 질문(AC-D10) | 터미널일 때만 stderr에 묻고 stdin에서 한 줄 읽는다. 터미널이 아니거나 EOF면 거부한다. 문구 카탈로그 | na-core·nc-human | ~500 |
| B-6 GUI 질문 대화상자 | 메인 프로세스 대화상자(기본 거부). 엔진 호스트가 질문을 중계한다 | p5u-gui(GUI 조사 쪽) | ~500 |

### C. CLI 이행 1~5: 구조, 동작 불변(7.1)

- PM 질문 1에서 하기로 하면 이 순서로 한다.
- 각 단위는 7.1의 완료 기준을 지킨다: 같은 입력에 같은 stdout·종료 코드·stderr(sp0, 통합 559, R-65 식의 글자 비교).

| 단위 | 내용 | 담당 | 줄 |
| --- | --- | --- | --- |
| C-1 이행 1a | `src/app/types.ts`의 4·5절 타입을 `src/contracts/app.ts`로 옮긴다. `src/app/types.ts`는 re-export만 한다 | p4g + p5a | ~700(대부분 이동) |
| C-2 이행 1b, AC-D3 | `Journal.append`가 저장한 `JournalRecord`를 돌려준다(store). 앱 계층의 이벤트 `seq`·`at`을 그 값으로 바꾼다. 다시 가림은 그대로 | 계약·store + p5a | ~350 |
| C-3 이행 2a | `prepareTask`(1~7단계)와 `RunNotes`를 `src/app/prepare.ts`로 옮긴다. CLI `run.ts`·`plan-commands.ts`가 그것을 부른다 | na-core + p5a | ~900 |
| C-4 이행 2b | 8단계(모델)와 조립을 앱 계층 하나로 한다(`src/cli/assemble.ts`의 실행 조립을 없앤다). `runCli`는 인자 → `startRun` → 출력만 한다 | na-core + p5a | ~1,100 |
| C-5 이행 3 | CLI 진행 줄을 `RunObserver`로, Y-4를 `notice`로, SIGINT·SIGTERM·취소 파일을 `handle.cancel()`로 한다(`progress.ts`, `cancel.ts`, `main.ts`) | na-core + p5a | ~500 |
| C-6 이행 4a | 보고서 읽기(`readResult`·`summarizeJournal`·`failedCallsIn`)를 앱 계층으로 옮긴다. CLI `report`는 그것을 그리기만 한다 | na-core + p5a | ~800 |
| C-7 이행 4b | `revert`·`runs`를 앱 함수 기준으로 뒤집는다(앱이 규칙, CLI는 출력) | na-core + p5a | ~600 |
| C-8 이행 5 | `doctor`(점검 18개)·`models`를 앱 계층으로 옮긴다. 둘로 나눌 수 있다 | na-core + p5a | ~900 / ~500 |

- C-4를 마치면 AC-D16(`app → cli`)이 끝나고 의존 방향이 3절 목표가 된다. C-6~C-8은 CLI에서 남은 규칙을 걷어 낸다.

### D. 6절의 남은 코드

| 단위 | 내용 | 담당 | 줄 |
| --- | --- | --- | --- |
| D-1 (PM 결정 뒤) | 연결되지 않은 줄 프로토콜 코드를 지운다: `src/cli/protocol/**`, `tests/unit/cli/protocol/**`, `vscode/src/core/**`, `tests/unit/vscode/**`. `docs/design/vscode-extension.md`에 지웠다고 적는다. 지우지 않기로 하면 하지 않는다 | p5a | −1,451 + 문서 ~30 |

## 9. A-2가 고칠 문서 낡음 (adapter-contract.md)

1. 머리말 11~16줄: 기준 판·"src/contracts는 바꾸지 않았다"를 지금 상태로(역사 기록과 지금 기준을 나눔).
2. 2절 표: 줄 번호가 b386166 기준이다. "현재 경계"를 지금 판으로 고치거나, "설계 당시의 경계(역사)"라고 표시한다.
3. 3절: "쓰는 파일은 지금 실행이 쓰는 것뿐"을 설정 파일 쓰기(5.11)와 정리 삭제(5.4)와 맞춘다.
4. 4절: `AppEnvironment`에 `homeDir`·`osLocale`을 더한다.
5. 5.6 333-336줄: DR-28 todo와 `runApply`의 `parentEnv` "남은 차이"를 지운다. 둘 다 고쳐졌다. A-1이 시험을 더한다.
6. 5.7 398줄: R-4 L-3 한계를 지운다(U-17).
7. 5.7 399줄: `main.ts` 연결 문장을 지금 상태로 고친다(연결됨, 카탈로그 R66-M1).
8. 7.2 표: 이행 4·5·7 행의 상태 문장.
9. 8절: 시험 수, doctor 점검 수.
10. 10.2: AC-D13·D14·D15를 10.1로 옮긴다(구현됨).
- 같은 단위에서 `src/app/types.ts:238-242`의 `workflowRef` 주석도 고친다.

## PM 질문

1. **이행 1~5(C-1~C-8)를 "최종 설계까지"에 넣는가?**
   - 동작이 바뀌지 않는 구조 이동이다. 3절의 목표 의존 방향과 AC-D16("이행 2까지 허용")은 이것을 설계로 정해 두었다.
   - 하면 약 6,000줄, 단위 8~9개다. 각 단위가 CLI 담당 파일을 함께 바꾼다.
   - 가정: 넣는다. 다만 5.9(B)와 A 뒤에 한다.
2. **5.9(B)를 먼저 하는가?**
   - 단계 5 완료 기준(1절)과 N-11의 남은 기능이다.
   - 가정: A-1·A-2 다음으로 B-1부터 한다.
3. **6절의 남은 코드(D-1)를 지우는가?**
   - 머리말은 "처리는 PM이 GUI 묶음 때 정한다"고 적었다. GUI가 들어온 지금 정할 때다.
   - 가정: 지운다. 다만 결정 전에는 손대지 않는다.
