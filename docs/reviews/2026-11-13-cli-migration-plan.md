# CLI 구조 이행 실행 계획 (U-126, DR-65)

```
작성: w3:pA (앱 계층 담당). 계획서만이고 코드는 없다(PM 지시). 시작은 PM이 따로 알린다(기능이 끝난 뒤)
기준: main 1ad1fa3 (U-111, U-121 병합 뒤). 줄 번호는 모두 이 판의 것이다
근거: adapter-contract 3절(의존 방향), 7.1(바꾸지 않는 것), 7.2(이행 1~5)
      설계 차이 조사 8절 C-1~C-8 (docs/reviews/2026-11-13-adapter-design-gap-survey.md)
표기: "줄"은 바뀌는 줄(더함+뺌)의 어림이다. git이 이름 바꿈으로 알아보는 파일 이동은 "이동"으로 따로 센다
      (내용이 그대로면 검토할 것은 import 줄뿐이다)
```

## 0. 요약

- 지금 앱 계층은 CLI 모듈 **24개**에서 기호 **64개**를 가져온다(`src/app`의 12개 파일). 반대로 CLI는 앱 계층을 **두 곳**에서 부른다(`changes`, `main.ts`).
- 이행은 **선행 둘 + 이행 단위 열**이다. 모두 직렬로 한다(DR-65).
  - P-1 공용 판 비교 도구(제품 코드 아님)
  - P-2 실행 이벤트의 도구 이름 제한 바로잡기(작은 기능 단위. 이행 전에 따로 병합)
  - C-1~C-10 이행. 조사의 C-1~C-8을 다시 재어 셋을 나눴다: 입력 층 이동, `run` 뒤집기, 계획 명령 뒤집기, `doctor`/`models·init` 둘로
- 모든 이행 단위의 완료 기준은 같다. 다섯 가지를 모두 지켜야 병합한다(3절).
  1. 고정 값 파일(sp0)을 건드리지 않는다.
  2. 통합 564건이 통과한다.
  3. U-112의 계약 층 시험 5건이 통과한다.
  4. P-1 도구로 두 판의 실제 CLI 출력을 글자까지 비교해 차이가 0이다.
  5. 옮긴 시험은 import 줄만 바뀐다.
- 위험이 큰 곳은 C-5(`run` 경로를 앱 계층으로 뒤집기)다. 실행 수명, 취소 신호, 진행 줄의 순서, 잠금이 한꺼번에 걸린다(4절).
- 부딪히는 진행 중 작업: U-109, U-110(B-5 CLI 터미널 질문), U-115(첫 사용), U-116(Markdown 규칙)이 `src/cli/config.ts`, `task.ts`, `run.ts`, `main.ts`, `doctor.ts`, `init.ts`를 고치는 중이다(5절). **이것들이 병합된 뒤에 C-3부터 시작해야 한다.**
- 줄 수 어림 합: 바뀌는 줄 약 7,500, 그 밖에 이름만 바뀌는 이동 약 2,900. 각 단위는 1,500줄 이하다.

## 1. 지금의 의존 (main 1ad1fa3)

### 1.1 앱 계층 → CLI: 모듈 24개, 기호 64개

분류의 뜻은 다음과 같다. 분류가 곧 옮기는 방법이다.
- **입력**: 입력 해석·보안 검사 층. 서로만 의존하는 묶음이라 통째로 `src/app/input/`으로 옮긴다(C-3).
- **명령**: 명령의 규칙. 규칙을 앱으로 옮기고 CLI는 그리기만 남긴다.
- **글**: 사람에게 보이는 글의 정리. 앱이 어댑터에게 주는 규칙이라 앱으로 옮긴다.
- **작은**: 작은 상수나 형. 계약이나 앱으로 옮긴다.

| CLI 모듈(줄) | 앱 계층이 쓰는 기호와 정의 위치 | 앱 계층의 사용처 | 분류 → 단위 |
| --- | --- | --- | --- |
| `args.ts`(628) | `RUN_ID_PATTERN` :124, `RunArgs` :50 | `changes.ts`:46, `check-apply.ts`:38, `run-events.ts`:56, `runs.ts`:15, `app.ts`:60 | 작은 → C-3(`RUN_ID_PATTERN`은 계약으로), C-4(`RunArgs` 형은 `prepareTask`와 함께 앱으로. 인자 해석기는 CLI에 남음) |
| `run-id.ts`(9) | `createRunId` :5 | `check-apply.ts`:39 | 작은 → C-3 |
| `install.ts`(49) | `findInstall` :31 | `environment.ts`:17 | 입력 → C-3 |
| `security/*`(650, `index.ts` 39) | `locateInWorkspace`, `relateRealPaths`(paths), `KnownKeys` keys:33, `MAX_KEY_SCAN_DEPTH` :23, `findKeyInJson` :156, `inputFileTooLarge` :137, `inputFileTooLargeMessage` :142, `rawTextHoldsKey` :201 | `app.ts`:61, `settings.ts`:24-25, `runs.ts`:20 | 입력 → C-3 |
| `settings.ts`(315) | `knownKeyValues` :61, `envValue` :89, `providerSettingsOf` :112, `configFieldOf` :127 | `app.ts`:62, `runs.ts`:18, `settings.ts`:26, `settings-change.ts`:26 | 입력 → C-3 |
| `task.ts`(770) | `quickProvider` :761 | `settings.ts`:27, `settings-change.ts`:27 | 입력 → C-3 |
| `config.ts`(355) | `parseConfig` :290 | `settings.ts`:22 | 입력 → C-3 |
| `config-file.ts`(180) | `findDefaultConfigLocation` :49, `defaultLocationRefused` :79, `chooseConfigFile` :107, `isMissingFile` :138 | `app.ts`:47, `settings.ts`:21 | 입력 → C-3 |
| `text-safety.ts`(127) | `REPLACEMENT` :12, `cleanText` :26, `hideKeysInStrings` :49, `hideKeys` :83 | `model-text.ts`:21, `run-events.ts`:58, `runs.ts`:19, `workspace-dir.ts`:40 | 글 → C-3 |
| `human/format.ts`(221) | `MODEL_TEXT_PREFIX` :135, `quoteModelText` :182 | `model-text.ts`:19 | 글 → C-3 |
| `human/output.ts`(818) | `FINAL_MESSAGE_MAX_LINES` :122 | `model-text.ts`:20 | 작은 → C-3(상수만 앱으로, output.ts는 CLI에 남음) |
| `run.ts`(910) | `prepareTask` :459, `PrepareEnvironment` :439, `RunNotes` :170, `positionDiagnostic` :203, `jsonSyntaxError` :213 | `app.ts`:58-59, :383, `settings.ts`:23 | 명령 → C-4 |
| `run.ts` | `runCli` :402, `CliEnvironment` :101, `CliRunOutcome` :183 | `app.ts`:58-59, :224 (`startRun`) | 명령 → C-5 |
| `assemble.ts`(425) | `Assemble` :70 | `app.ts`:45, `assemble.ts`:28 | 명령 → C-5 |
| `cancel.ts`(45) | `createCancelSource` :22 | `app.ts`:46 | 명령 → C-5 |
| `guard.ts`(92) | `CommandOutcome` :24 | `app.ts`:49 | 작은 → C-10(마지막 감싸기가 없어질 때) |
| `plan-commands.ts`(953) | `runPlan` :547, `runApply` :587, `runReview` :895, `PlanCommandEnvironment` :109 | `app.ts`:52-53, :697, :708, :742 | 명령 → C-6 |
| `report.ts`(1096) | `summarizeJournal` :250, `readResult` :358, `summarizeApplyJournal` :654, `readApplyResult` :770, `runReport` :965 | `run-events.ts`:57, `app.ts`:56, :446, :466 | 명령 → C-7 |
| `revert.ts`(201) | `runRevert` :109 | `app.ts`:57, :488 | 명령 → C-8 |
| `assemble.ts` | `createRevertCommand` :205 | `app.ts`:44, :494 | 명령 → C-8 |
| `runs.ts`(166) | `resolveWorkspaceRoot` :91 | `runs.ts`:16 | 명령 → C-8 |
| `run-ref.ts`(129) | `resolveRunReference` :73, `STORE_RUN_REFERENCE_DEPS` :61 | `runs.ts`:17 | 명령 → C-8 |
| `doctor.ts`(984) | `runDoctor` :512 | `app.ts`:48, :538 | 명령 → C-9 |
| `models.ts`(465) | `runModels` :254, `writeConfigAtomic` :178, `ModelsEnvironment` :79 | `app.ts`:51, :54, :569, `settings-change.ts`:25 | 명령 → C-10 |
| `init.ts`(396) | `runInit` :184, `SUGGESTED_SCRIPTS` :55, `SUGGESTED_PROTECTED_PATHS` :63, `MAX_PACKAGE_JSON_BYTES` :66 | `app.ts`:50, :606, `init.ts`:19 | 명령 → C-10 |
| `provider.ts`(28) | `anthropicModelLister` :16, `API_MODEL_LISTERS` :25 | `app.ts`:55 | 명령 → C-10 |

- 입력 묶음은 닫혀 있다. 그래서 통째로 옮길 수 있다.
  - `security/*`는 계약만 본다.
  - `settings`는 security만, `task`는 security·policy만 본다.
  - `config`는 security·task를, `config-file`은 security·settings·task를 본다.
  - `text-safety`는 security를, `human/format`은 security·text-safety를 본다.
  - 이 묶음은 `run.ts`나 `main.ts`를 부르지 않는다.
- `json-position.ts`(166), `human/json-position.ts`(223)는 `run.ts`의 진단(`jsonSyntaxError`)이 쓴다. C-4에서 `prepareTask`와 함께 옮긴다.

### 1.2 CLI → 앱 계층 (목표 방향, 지금 두 곳)

- `src/cli/changes.ts`:31-32: `toCliError`, `ChangesOutput` 등. CLI `changes`가 앱의 `changes`를 부른다.
- `src/cli/main.ts`:27, :211: `createCodarynApp(createNodeAppEnvironment())`를 `changes` 명령에만 쓴다.

### 1.3 앱 계층이 CLI 명령을 감싸는 곳 (거꾸로 된 방향)

| 앱 함수 | 감싸는 CLI 함수 | 위치 |
| --- | --- | --- |
| `startRun` | `runCli` (자체 `assemble`·`runTask` 끼움) | `app.ts`:224, :250-334 |
| `readingSecrets`(`changes`, `listWorkspaceDir`, `listRunEvents`, `checkApply`) | `prepareTask` | `app.ts`:383 |
| `report`, `reportMarkdown` | `runReport` | `app.ts`:446, :466 |
| `revert` | `runRevert` + `createRevertCommand` | `app.ts`:488, :494 |
| `doctor` | `runDoctor` | `app.ts`:538 |
| `listModels`, `selectModel` | `runModels` | `app.ts`:569 |
| `createSettings` | `runInit` | `app.ts`:606 |
| `plan`, `review`, `applyPlan` | `runPlan`, `runReview`, `runApply` | `app.ts`:697, :708, :742 |

## 2. 단위 계획

### 2.1 순서와 의존

```
P-1 판 비교 도구 ─┐
P-2 도구 이름 제한 ┤ (이행 전, 각각 따로 병합)
                  ▼
C-1 계약 형 → C-2 AC-D3 → C-3 입력 층 이동 → C-4 prepareTask → C-5 run 뒤집기(+진행 줄·취소)
   → C-6 계획 명령 뒤집기 → C-7 보고서 → C-8 되돌리기·목록 → C-9 doctor → C-10 models·init (+의존 검사)
```

- 모두 직렬이다(DR-65). 앞 단위가 main에 병합된 뒤 다음을 main에서 시작한다.
- 꼭 지켜야 하는 의존은 다섯이다.
  - C-3 → C-4: `prepareTask`가 입력 층을 쓴다.
  - C-4 → C-5: `run` 경로가 `prepareTask`를 쓴다.
  - P-2 → C-5: 진행 줄이 관찰자 이벤트에서 나오게 된다.
  - C-5 → C-6: 계획 명령도 같은 수명·취소 틀을 쓴다.
  - C-3 → C-7~C-10: 모두 입력 층과 글 정리를 쓴다.
- C-1, C-2는 앞의 무엇에도 기대지 않는다. 그래도 직렬 순서에서 맨 앞에 둔다. 형을 먼저 계약에 두면 C-4 이후의 이동이 계약 형을 바로 쓴다.
- AC-D16(`app → cli`)은 C-10에서 끝난다. 앱이 가져오는 CLI 모듈 수를 단위마다 센다: 지금 24 → C-3 뒤 14 → C-4 뒤 13 → C-5 뒤 11 → C-6 뒤 10 → C-7 뒤 9 → C-8 뒤 5 → C-9 뒤 4 → C-10 뒤 0.
  - `assemble.ts`는 C-5 뒤에도 남는다. `createRevertCommand`가 그 안에 있어 C-8에서야 빠진다.
  - C-10은 "`src/app`이 `src/cli`를 import하지 않는다"는 구조 시험을 더한다. 시험만 더하는 것이고 동작 변경은 아니다.

### 2.2 단위별 내용

각 단위의 담당은 조사 8절대로 "그 모듈의 담당 + p5a"다. CLI 쪽은 na-core, 사람 글은 nc-human, 계약은 p4g, store는 N-C다.

| 단위 | 옮길 것 | 남길 것 | 줄 어림 |
| --- | --- | --- | --- |
| **P-1** 판 비교 도구 | 없음(새 파일: `scripts/compare-cli-boards.mjs`와 장면 목록) | — | 약 500(제품 코드 0) |
| **P-2** 도구 이름 제한 | `events.ts`의 `limitToolNames`가 내장 넷(`TOOL_NAMES`)이 아니라 `ALL_TOOL_NAMES`(작업 종류 도구 포함)를 알게 한다. R-80 I-1 | — | 약 60(시험 포함). **기능 단위다**: GUI의 실행 이벤트에서 `inspect_files`·`propose_plan`이 제 이름으로 보인다. 이행에 섞지 않으려고 따로 둔다 |
| **C-1** 이행 1a | `src/app/types.ts`(827)의 4·5절 형과 `general-tasks.ts`(29)를 `src/contracts/app.ts`로. 계약은 앱·CLI를 import하지 않는다 | `src/app/types.ts`는 다시 내보내기만(약 30줄). GUI가 `src/app/index.js`에서 가져오는 이름은 그대로 | 이동 약 830, 고침 약 80 |
| **C-2** 이행 1b, AC-D3 | `Journal.append`·`ApplyJournal.append`가 저장한 레코드를 돌려준다. 바뀌는 곳은 아래 목록 | 엔진의 기록 순서, 다시 가림 | 약 350 |
| **C-3** 입력 층 이동 | `git mv`로 `security/*`, `settings`, `task`, `config`, `config-file`, `text-safety`, `install`, `run-id`, `human/format`을 `src/app/input/`로. `RUN_ID_PATTERN`은 계약으로, `FINAL_MESSAGE_MAX_LINES`는 `app/model-text.ts`로. CLI와 시험의 import를 새 자리로 고친다 | 파일 내용은 그대로(이름 바꿈 100%) | 이동 약 2,900, 고침 약 200(import 줄) |
| **C-4** 이행 2a | `prepareTask`(`run.ts`:439-768)와 그 도우미를 `src/app/prepare.ts`로. 도우미는 `error`·`cliError`·`withHint`·`argumentsError`·`settingsError`·`positionDiagnostic`·`jsonSyntaxError`·`headDiagnostic`·`underDefinition`·`withWorkflow`·`readText`·`parseJson`·`scrub`·`defaultConfigNotice`, `RunNotes`, `PreparedTask`이고, `json-position` 둘도 함께 간다. CLI `run.ts`·`plan-commands.ts`(`prepareFor` :289)와 앱 `readingSecrets`가 그것을 부른다 | 인자 해석기(`args.ts`의 `parseArgs` :573, `parsePlanArgs` :465 등)는 CLI. `RunArgs` 형과 `PrepareEnvironment`는 앱의 형으로 옮기고, `CliEnvironment`가 `PrepareEnvironment`를 넓힌다 | 이동 약 600, 고침 약 120 |
| **C-5** 이행 2b+3 (`run`) | `runParsed`(`run.ts`:769-910)의 8단계(모델), Y-4(`watchingNotFound` :272, `withModelHint` :283-296), 기본 설정 안내(`defaultConfigNotice`, :875·:889), 결과 저장·잠금 해제를 `startRun` 하나로. `cli/assemble.ts`의 `assembleRun`(:360-425)을 지운다(조립은 앱의 것 하나). `runCli`는 인자 해석 → `app.startRun(관찰자)` → 출력으로. 진행 줄은 `RunObserver.onEvent`에서, Y-4·기본 설정 안내는 `notice`에서, SIGINT·SIGTERM·취소 파일은 `handle.cancel()`로(`main.ts`:324-352) | 끝 요약(`runSummary`)과 진행 줄의 글(`human/output.ts`, `progress.ts`)은 CLI | 약 1,100 |
| **C-6** 이행 2b+3 (계획 명령) | `plan-commands.ts`의 규칙을 앱으로: `prepareFor`(:289), `loadShown`(:338), `planRunMarked`(:472), `planSummary`(:497), `applyOnce`의 조립·잠금(:662-760), `observeApply`(:792), `planTaskIdOf`(:825), `awaitingReview`(:838), `runReview`의 잠금(:919-935). 앱의 `plan`·`applyPlan`·`review`는 CLI를 감싸지 않고 직접 한다. CLI는 앱 함수를 부른다 | 인자 해석, `renderPlan`(:417)·`renderReview`(:877), 터미널 [y/N] 질문(`applyQuestion` :567, `unsafeMoveQuestion` :575)과 두 번째 적용(동의 뒤) | 약 950 |
| **C-7** 이행 4a | `report.ts`의 읽기와 판정을 앱으로: `summarizeJournal` :250, `readResult` :358, `summarizeApplyJournal` :654, `readApplyResult` :770, `failedCallsIn` :237, `fileState` :948, `readRecordFile` :959, `runReport`의 판정 부분 :965. 앱 `report`는 직접 읽는다 | `renderReport` :519, `renderApplyReport` :820, 고정 문구 표(`REPORT_FIXED_LIMITS` :511 등) | 약 800 |
| **C-8** 이행 4b | `createRevertCommand`(`assemble.ts`:77-359)·`revert.ts`의 규칙, `runs.ts`의 `resolveWorkspaceRoot` :91, `run-ref.ts` 전체를 앱으로. 앱 `revert`·`listRuns`·`resolveRun`이 규칙을 갖고 CLI는 출력만 한다 | `revert`·`runs`의 글과 터미널 질문(DR-25, `main.ts`:196) | 약 700 |
| **C-9** 이행 5a | `doctor.ts`의 점검 18개(`DOCTOR_CHECK_IDS`)와 판정을 앱으로 | 점검 글 그리기 | 약 900 |
| **C-10** 이행 5b | `models.ts`(목록·`--use`·`writeConfigAtomic` :178), `init.ts`(`runInit` :184와 제안 상수), `provider.ts`, `guard.ts`의 `CommandOutcome`을 앱으로. 구조 시험 "`src/app` → `src/cli` 없음"을 더한다 | 글, 터미널 질문(`init`의 N-2) | 약 900 |

C-2의 바뀌는 곳(지금 `append`가 `Promise<void>`인 곳):
- 계약: `contracts/journal.ts`:201, `contracts/plan.ts`:630
- store: `store/journal.ts`:34, :74
- 엔진: `engine/index.ts`:488. 돌려준 값은 지금 쓰지 않는다.
- 감싸개: `app/events.ts`:104, `app/apply.ts`:61, `cli/progress.ts`:171, `cli/run.ts`:827, :867, `cli/plan-commands.ts`:801
- 가짜 journal을 쓰는 시험 13파일
- 앱의 실행 이벤트는 스스로 세던 `seq`와 앱 시계의 `at` 대신 저장된 값을 쓴다.
- **C-2는 엄밀히 동작이 바뀐다**: `RunEvent.record.at`이 저장된 `at`과 같아진다(지금은 몇 밀리초 다를 수 있다). CLI 출력과 기록은 그대로다. 이행 1에 들어 있는 계약 항목이라 이행으로 두되, PM이 기능으로 보면 C-1 뒤의 작은 기능 단위로 돌린다(PM 질문 Q-1).

### 2.3 이행 중의 규칙

- **기능 변경을 섞지 않는다.** 한 단위는 옮기기 하나다. 옮기다 찾은 결함은 고치지 않고 적어 두었다가, 이행이 끝난 뒤 기능 단위로 돌린다. 예외는 PM이 미리 정한 것뿐이다(P-2).
- 고정 값 파일은 건드리지 않는다. 대상은 `tests/unit/cli/sp0-expected.ts`, `sp0-pins.ts`, `tests/unit/model/anthropic/sp0-golden.ts`, `sp0-scenarios.ts`다. 단위의 `git diff --stat`에 이 파일이 나오면 그 단위는 멈춘다.
- 통합 시험(`tests/integration/**`)은 바꾸지 않는다. 실제 CLI 프로세스(`dist/src/cli/main.js`)를 돌리므로 import가 없다.
- 유닛 시험은 함께 옮기되 import 줄만 바뀐다. 단위 보고에 "import 줄을 뺀 diff가 비어 있음"을 싣는다. 확인 방법은 `git diff -M base..unit -- tests`에서 import 줄을 걸러 내는 짧은 명령이다.
- 새 시험은 둘만 허용한다. 7.1이 요구한 DR-4 두 경우를 CLI 경로에서 보는 시험(C-5), 그리고 의존 방향 구조 시험(C-10)이다.
- adapter-contract는 단위마다 7.2 표의 상태 열과 3절의 "지금" 문장만 고친다. AC-D16은 C-10에서 "끝남"으로 적는다.

## 3. "동작이 그대로"를 보이는 방법

단위마다 아래 다섯을 모두 지킨다. 단위 보고에 다섯의 결과를 판 해시와 함께 싣는다.

1. **sp0 고정 값**: `tests/unit/cli/sp0-cli.test.ts`(P-7 설정 해석, P-8 doctor·models·init·run의 출력과 요청 본문)와 `tests/unit/model/anthropic/sp0-pins.test.ts`가 통과한다. 고정 파일은 바뀌지 않는다(2.3).
2. **유닛·통합**: typecheck 0, 유닛 실패 0, 통합 564/564. 유닛 수는 이전 판과 같다(옮긴 시험은 그대로 센다). 수가 다르면 설명한다.
3. **U-112 계약 층 시험**: `tests/integration/c01-cli-app-contract.test.ts` 5건(문서 실행, 거부, 재수정, 계획과 적용, 모델 오류)이 통과한다. CLI 경로와 앱 경로의 결과와 기록이 필드까지 같다는 시험이다. C-5·C-6처럼 두 경로가 하나로 합쳐지는 단위에서는 이 시험이 "합친 뒤에도 같다"를 보장한다.
4. **판 비교(P-1)**: 이행 전 판(main)과 이행 판(단위 브랜치를 main에 합친 판)에서 같은 장면을 실제 CLI로 돌린다. stdout, stderr, 종료 코드, 상태 디렉터리와 작업 공간의 파일을 정규화 뒤 글자까지 비교한다. 차이 0이어야 병합한다.
5. **GUI**: 루트를 빌드한 뒤 GUI `npm test`와 `test:smoke`를 돌린다(GUI는 루트의 `dist`를 쓴다). 앱 계층의 공개 이름이 바뀌지 않았음을 본다.

### 3.1 공용 판 비교 도구 (P-1) — 한 번 만들어 모든 이행 단위가 쓴다

- **자리**: `scripts/compare-cli-boards.mjs`, 장면 목록 `scripts/compare-cli/scenarios.mjs`, 정규화 `scripts/compare-cli/normalize.mjs`. Node만 쓰고 새 의존은 없다. 담당은 PM이 정한다(제안: p5a, 또는 검증 담당).
- **입력**: `--base <판 폴더> --head <판 폴더> [--only <장면 이름들>] --out <보고서.md>`.
  - 판 폴더는 `git archive`로 풀고 빌드한 것이다.
  - 판 폴더 뿌리에 `node_modules`가 있어야 한다. k03 예행 시험이 저장소 뿌리의 컴파일러를 쓰기 때문이다(U-108 판에서 확인). 도구는 없으면 worktree의 것을 junction으로 잇고, 끝나면 링크만 지운다.
- **돌리는 법**:
  - 장면마다 새 모래 상자를 만든다. 같은 절대 경로를 두 판이 차례로 쓴다(지우고 다시 만든다). 그래서 경로를 정규화할 필요가 없다.
  - 환경: `APPDATA`·`XDG_CONFIG_HOME`·`HOME`·`USERPROFILE`을 상자 안으로 돌린다(기본 설정 위치를 가둔다). 실제 키는 없다. 가짜 값과 127.0.0.1의 가짜 서버만 쓴다. `CODARYN_LANG`은 en·ko 두 가지다.
  - `node <판>/dist/src/cli/main.js <argv>`를 파이프(TTY 아님)로 돌린다. stdin 내용은 장면이 정한다.
  - stdout·stderr 바이트, 종료 코드, 상태 디렉터리 전체를 모은다. 상태 디렉터리에는 journal, result.json, plan.json, applied.json, review.json, revert.json, 스냅샷, 폐기 보관함이 들고, 잠금이 없어야 한다. 작업 공간의 나무(이름·크기·내용 해시)도 모은다.
- **정규화**: U-112 c01의 규칙을 그대로 가져온다. 두 실행 사이에 늘 다른 값만 바꾼다.
  - 첫 등장 순서로 이름 붙이는 것: 실행 id(`YYYYMMDDTHHMMSSZ-xxxxxxxx`), 가림 토큰(실행마다 무작위), 계획 다이제스트(plan.json이 실행 id를 담으므로)
  - 자리표로 바꾸는 것: ISO 시각, `durationMs`, 잠금의 pid
  - 그 밖은 모두 글자 그대로 비교한다.
- **자기 검사**(도구가 믿을 만한지):
  1. 같은 판을 두 번 돌려 차이가 0이다. 차이가 나면 그 필드가 정규화에 빠진 것이고, 그 장면은 "불안정"으로 따로 보고한다.
  2. main과 main을 비교해 차이가 0이다.
  3. 진행 줄 글자 하나를 일부러 바꾼 판과 비교해 그 장면이 차이로 잡힌다.
  - P-1의 완료 기준은 이 셋이다.
- **장면(처음 약 40개, 단위가 늘릴 수 있음)**:
  - `run`
    - 성공(문서 작업), 검증 실패 → 재수정 → 통과, 도구 거부, 허용 명령, 보호 경로 변경
    - 모델 404(Y-4 안내, 가짜 서버), 실행 중 취소 파일, 시간 한도, `--quiet`, `--json`, 한국어
    - 기본 설정 위치의 안내(N-1)
  - 실행 전 오류(1~7단계마다 하나)
    - 인자, 변수 파일 BOM, 설정·목표에 키, 잘못된 설정, 없는 프로필
    - 없는 작업 공간, 설치 폴더 안의 작업 공간, 작업 공간 안의 설정 파일, 없는 `secretEnv`
  - `plan`, `apply`(`--digest`, `consent_required`, `plan_stale`), `review`(accept, reject, note)
  - `report`(글·JSON·`latest`·적용 실행), `revert`(`--dry-run`, 실제, 다시 되돌리기), `runs`(글·JSON), `changes`
  - `cleanup`(미리보기, `--confirm`)
  - `doctor`(글·JSON), `models`(글·JSON, 가짜 서버), `init --json`
  - 도움말, 버전, 인자 없음, 모르는 명령
- **보고**: 장면마다 PASS·DIFF·불안정. DIFF면 처음 다른 줄과 정규화한 두 글의 diff를 싣는다. DIFF가 하나라도 있으면 종료 코드가 0이 아니다.
- **한계**:
  - 터미널(TTY)에서만 나오는 길은 파이프로 비교할 수 없다: `apply`의 [y/N], `revert`의 unsafe 질문, `init`의 질문, B-5 터미널 권한 질문.
  - 새 의존(node-pty 등)을 들이지 않으므로, 이 길은 지금처럼 `ask`를 주입하는 유닛 시험으로 본다. 해당 단위(C-5, C-6, C-8, C-10)는 그 유닛 시험을 이름으로 적는다.
  - 신호(SIGINT·SIGTERM)도 Windows에서는 보내기 어렵다. 취소는 취소 파일 장면으로 보고, 신호는 유닛 시험(`createCancelSource`)으로 본다.

## 4. 위험한 곳

### 4.1 실행 수명 (C-5, C-6)

- 지금 CLI의 순서(`run.ts`:819-908)는 다음과 같다.
  1. 취소 원천 만들기
  2. 조립과 잠금
  3. 진행 줄 감싸기
  4. 엔진
  5. Y-4·기본 설정 안내를 결과에 더함(:889)
  6. `finish`: result.json을 쓰고 잠금을 푼다(:892)
  7. 끝 요약을 stderr에(:898)
  8. 취소 원천 정리(:908)
  9. `main.ts`가 stdout에 JSON 한 줄
- 앱의 `startRun`은 손잡이를 먼저 주고, 문을 연 뒤 엔진을 시작한다(:250-334). `done`은 `runCli`가 끝난 뒤, 곧 잠금이 풀린 뒤 풀린다.
- 뒤집은 뒤에도 같은 순서가 나와야 한다: stderr의 요약은 잠금 해제 뒤, 그다음 stdout의 JSON.
- CLI는 `done`을 기다린 뒤 요약을 쓴다. Y-4 안내 줄은 요약 앞이어야 한다(지금 `withModelHint`가 결과에 안내를 더하며 진행 줄로 쓴다, `run.ts`:292).
- 내부 예외: 지금은 `internal_error`이고 잠금을 푼다(`finish`의 finally). 앱 경로에서도 같은 출력과 같은 잠금 해제가 나와야 한다.
- 오류 왕복: 앱은 `AppError`로, CLI는 `CliErrorOutput`으로 낸다. `fromCliError`·`toCliError`(`app/errors.ts`:20, :37)가 `hint`·`detail`·`diagnostic`(N-6 진단)을 잃지 않아야 한다. 실행 전 오류 장면 전부를 판 비교에 넣는 까닭이다.

### 4.2 취소 신호 (C-5, C-6)

- CLI는 `createCancelSource`에 `process.on(name, handler)`를 준다(`main.ts`:249, :348). 처리기는 조립 직전(`run.ts`:819)에야 생긴다.
  - 그 전(1~7단계)의 SIGINT는 Node 기본대로 프로세스를 끝낸다. 뒤집은 뒤에도 처리기를 더 일찍 걸지 않는다.
- 앱 경로에서는 앱의 `cancelHandlers` 묶음이 처리기를 갖는다. CLI는 손잡이를 받은 뒤 `process.on`으로 신호를 받아 `handle.cancel()`을 부르고, `done` 뒤에 처리기를 뗀다.
- 손잡이가 오기 전에 온 신호의 처리(지금과 같게)를 장면과 유닛 시험으로 고정한다.
- 취소 파일은 같은 모듈(`cancel.ts`:22, 100 ms 폴링)이 본다. 앱 요청의 `cancelFile`로 넘긴다.
- R-79 I-1: 엔진의 시간 한도 타이머는 `unref()`다. 권한 질문을 기다리는 동안 무언가가 프로세스를 살려 두어야 한다.
  - B-5(U-110) 터미널 질문은 stdin을 쥐어 살린다.
  - C-5에서 질문 중계가 앱의 `RunObserver.confirm`으로 바뀌어도 같아야 한다. "기다리는 동안 프로세스가 산다" 유닛 시험을 C-5에 둔다.

### 4.3 진행 줄의 순서와 글 (C-5)

- 지금 진행 줄은 `withProgress`(`progress.ts`:159)가 journal 저장 직후에 쓴다. 앱의 `journalWithEvents`도 저장 직후에 이벤트를 준다. 그래서 줄의 순서는 같다.
- 다만 글이 달라질 수 있는 곳이 둘이다.
  1. **도구 이름**: 사람 글(`human/output.ts`:504-507)은 `ALL_TOOL_NAMES`를 안다. 실행 이벤트는 `sanitizeRecord`가 내장 넷 밖을 `(unknown tool)`로 바꾼다(`app/events.ts`의 `limitToolNames`). 정리·분석 작업의 진행 줄이 바뀔 수 있다. **P-2를 먼저 병합해야 하는 까닭이다.**
  2. **호출 id**: 사람 글은 거부된 호출 id를 모아(`deniedCalls`, `output.ts`:181, :505) 실패 줄을 거른다. 이벤트는 id를 다시 가린다. 이미 가린 id라 같은 글이어야 한다(R-65 L-1에서 본 길). 판 비교의 "도구 거부" 장면으로 본다.
- 기본 설정 안내 줄(`progress.config_default`, `run.ts`:875)은 `run_started` 줄 바로 뒤에 나온다. 앱 경로에서는 첫 `record` 이벤트를 받은 뒤 CLI가 쓴다.
- 언어: 사람 글은 설정의 언어를 안 뒤에 만든다(`notes.configLanguage`, `run.ts`:853-855). 앱이 이 값을 관찰자에게 알려야 한다(`RunNotes`를 결과나 첫 이벤트와 함께). 형만 더하는 것이지만 C-5의 설계에서 정한다.

### 4.4 잠금 (C-5, C-6, C-8)

- 잠금은 네 군데서 잡는다: 실행(조립), 적용(`plan-commands.ts`:664, 동의 뒤 두 번째 적용 포함), 검토(:919), 되돌리기(`createRevertCommand`).
- 옮긴 뒤에도 세 가지가 같아야 한다.
  - 모든 실행 전 검사 뒤에 잡는다.
  - finally에서 요약 전에 푼다.
  - `workspace_locked`의 문구가 같다. 지금 두 조립의 `lockedMessage`는 글자까지 같다(`cli/assemble.ts`:72, `app/assemble.ts`:30). C-5에서 하나를 지운다.
- 조립의 차이 하나: CLI의 `assembleRun`은 명령 실행기에 `parentEnv`를 주지 않는다(`process.env`, `cli/assemble.ts`:379). 앱의 것은 실행의 환경 사본을 준다(DR-4).
  - C-5에서 CLI가 앱 조립을 쓰게 되면, 자식 명령에 가는 변수가 "변수 파일을 `process.env`에 넣은 값"에서 "사본에 넣은 값"으로 바뀐다. 허용 목록 규칙상 같아야 한다.
  - 7.1이 요구한 DR-4 두 경우(Windows의 대소문자, 변수 파일의 8자 미만 값)를 CLI 경로의 새 시험으로 고정한다.

## 5. 다른 담당의 진행 중 작업과 부딪히는 파일 (main 1ad1fa3 기준)

`git cherry`로 main에 없는 커밋을 가진 브랜치만 골랐다. `pm/batch-*`, `pm/keep-U-22`, `pm/unit-U-13`, `unit/U-8-*`은 내용이 이미 main에 있다.

| 진행 중 단위 | 바꾸는 파일 | 부딪히는 이행 단위 | 처리 |
| --- | --- | --- | --- |
| U-109, U-110 (na-core, nc-human: 설정의 `confirm`, B-5 터미널 질문) | `src/cli/config.ts`, `task.ts`, `confirm.ts`(새), `terminal.ts`(새), `main.ts`, `run.ts`, `human/output.ts`, `contracts/human.ts`, `src/i18n/*` | C-3(config·task 이동), C-4(`run.ts`), C-5(`run.ts`·`main.ts`, 터미널 질문을 `RunObserver.confirm`으로 옮김) | 병합 뒤 시작. C-5는 B-5의 CLI 질문 통로를 관찰자로 옮기는 일을 포함한다 |
| U-115 (na-core: 첫 사용) | `src/cli/doctor.ts`, `help.ts`, `init.ts`, `main.ts`, `run.ts`, `contracts/engine.ts`, `contracts/human.ts` | C-4·C-5(`run.ts`, `main.ts`), C-9(`doctor.ts`), C-10(`init.ts`) | 병합 뒤 시작 |
| U-116 (na-core 외: Markdown 규칙) | `src/cli/task.ts`, `contracts/verify.ts`, `src/verify/*` | C-3(`task.ts` 이동) | 병합 뒤 시작 |
| U-82-na-core (커밋 1개가 main에 없음) | `contracts/model.ts`, `model/http/index.ts` | 없음 | 상태를 PM이 확인(오래된 브랜치로 보임) |
| GUI(p5u-gui) | `gui/src/engine-host/*`는 `src/app/index.js`의 이름을 쓴다 | C-1(형 이동) | 다시 내보내기로 이름 불변. 단위마다 GUI 시험 |

- C-3은 많은 파일의 import 줄을 고친다. 그래서 다른 단위가 그 파일을 동시에 고치면 충돌이 많다. C-3 시작 전 "입력 층 파일을 고치는 열린 단위 없음"을 PM이 확인해 주면 좋다.

## 6. PM 질문

- **Q-1**: C-2(AC-D3)는 실행 이벤트의 `at`을 저장된 값으로 바꾼다(CLI 출력·기록은 그대로). 이행으로 둘지, C-1 뒤의 작은 기능 단위로 돌릴지.
  - 가정: 이행으로 둔다(계약 7.2 이행 1의 항목).
- **Q-2**: P-1 도구의 자리(`scripts/`)와 담당. 가정: `scripts/compare-cli-boards.mjs`, p5a.
- **Q-3**: C-3의 새 자리 이름. 가정: `src/app/input/`(3절의 "입력 해석과 실행 전 보안 검사").
  - 다른 길로 `src/settings/`처럼 앱과 나란한 층을 둘 수 있다. 그러면 의존 방향이 `cli → app → settings`가 되어 3절 그림이 한 칸 늘어난다.
- **Q-4**: P-2(도구 이름 제한)를 이행 전에 기능 단위로 넣을지. 가정: 넣는다. 넣지 않으면 C-5가 정리·분석 작업의 진행 줄을 바꾼다(4.3).
