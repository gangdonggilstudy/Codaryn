# CLI 구조 이행 실행 계획 (U-248 개정판, DR-65)

```
작성: na-core (U-248). 계획서만이고 코드는 없다. 시작은 PM이 단계마다 알린다(기능 뒤 직렬, DR-65)
기준: main 9d435c42 (U-242 병합 뒤). 줄 번호는 모두 이 판의 것이다
      곧 들어올 판: pm/unit-A6(U-210 묶음 A의 CLI)과 p5a U-237(앱이 CLI의 createAssemble을 씀).
      그 판에서 바뀌는 수는 "(A6 판)"으로 따로 적는다
이전 판: U-126(w3:pA, main 1ad1fa3). 이 판이 그것을 대신한다. 그 판의 C-1~C-10을 다시 재어 나눴다
근거: adapter-contract 3절(의존 방향), 7.1(바꾸지 않는 것), 7.2(이행 1~5)
      설계 차이 조사 8절 C-1~C-8 (docs/reviews/2026-11-13-adapter-design-gap-survey.md)
PM 답(이전 판의 Q-1~Q-4): 첫 단계는 P-2. C-2(AC-D3)는 이행에 넣는다. 입력 층의 새 자리는 src/app/input/
표기: "고침"은 바뀌는 줄(더함+뺌)의 어림이다. 내용이 그대로인 파일 이동(git이 이름 바꿈으로 알아봄)은
      "이름 바꿈"으로, 한 파일에서 다른 파일로 옮기는 덩어리는 "옮김"으로 따로 센다.
      검토는 고침과, 옮김이 글자 그대로인지(git diff --color-moved)를 본다
```

## 0. 요약

- 지금 앱 계층은 CLI 모듈 **25개**에서 기호 **66개**를 가져온다(`src/app`의 파일 14개). A6 판에서는 **26개**다(`src/cli/unreadable.ts`가 더해진다). 반대로 CLI가 앱 계층을 부르는 곳은 `changes` 명령 하나다(`src/cli/changes.ts`, `main.ts`).
- **이전 판 뒤로 의존 방향이 더 거꾸로 됐다.** 실행의 조립은 설계(adapter-contract 3절)에서 앱 계층의 것인데, 지금은 `src/cli/assemble.ts`의 `createAssemble` 한 벌이다.
  - 계획 실행을 수행하는 실행(U-195)과 앱의 run 계획 적용(U-218)이 그 조립을 쓴다.
  - A6 판의 U-237에서는 앱의 실행 조립 자체가 그것이 된다(`src/app/assemble.ts`가 `createAssemble`을 감싼다).
  - 앱의 점검도 CLI의 `runGuards`(`src/cli/unreadable.ts`)를 쓴다.
  - 그래서 이 판은 조립을 앱으로 옮기는 단계(C-4)를 새로 둔다.
- 이행은 **선행 하나 + 이행 단위 열다섯**이다. 모두 직렬이다(DR-65).
  - P-1 공용 판 비교 도구는 이미 있다(`scripts/compare-cli-boards.mjs`, 27사례). 단계마다 사례를 늘린다.
  - **P-2(첫 단계):** 실행 이벤트의 도구 이름 제한을 바로잡는다. 작은 기능 단위이고, 이행 전에 따로 병합한다.
  - C-1~C-11은 이전 판의 열 단위를 지금 크기로 다시 나눈 것이다. 입력 층은 둘로(C-3a, C-3b), `run` 뒤집기는 둘로(C-6a, C-6b), 계획 명령은 둘로(C-7a, C-7b) 나눴다. 조립 이동(C-4)과 `cleanup`의 한 벌(C-9b)을 새로 둔다.
- 모든 이행 단위의 완료 기준은 같다(5절). 출력과 JSON은 한 글자도 바뀌지 않는다.
  - 고정 값 파일(sp0) 그대로.
  - 판 비교 도구에서 차이 0.
  - 유닛·통합 실패 0, U-112 계약 층 시험 통과.
  - 옮긴 시험은 import 줄만 바뀐다.
- 위험이 가장 큰 곳은 C-6a(`run` 경로를 앱 계층으로 뒤집기)다. 실행 수명, 취소, 진행 줄과 끝 요약의 수, 잠금, 터미널 권한 질문이 한꺼번에 걸린다(6절).
- 줄 수 어림 합(4.1의 표): 고침 약 5,000, 옮김 약 5,600, 이름 바꿈 약 3,300. 한 단위는 검토 1건(약 1,500줄) 안이다.
- 시작 전에 들어와야 할 것: A6 판(U-210, U-237)과 그 뒤를 잇는 U-245, U-246. 진행 줄을 접을지에 대한 사용자 답(U-243, U-233)은 C-6a 전에 받는다(7절).

## 1. 이전 판(main 1ad1fa3) 뒤에 바뀐 것

| 바뀐 것 | 단위 | 이행에 주는 영향 |
| --- | --- | --- |
| 조립 한 벌: `createAssemble(hooks)`(`cli/assemble.ts`:422), `AssemblyInput.planRunId`, `ApprovedPlanParts`(:78) | U-195, U-218, U-237(A6 판) | 앱이 CLI 조립을 쓴다. 이전 판의 "조립은 앱의 것 하나로(C-5에서 CLI의 `assembleRun`을 지움)"와 반대 방향으로 합쳐졌다. 이 판은 그 한 벌을 그대로 앱으로 옮긴다(C-4) |
| 계획 실행(plan run, B-1~B-8) | U-170~U-198, U-218, U-228 | `plan-commands.ts`가 953줄에서 1,219줄로 늘었다(`changesView`, `applyChangesPlan` :927, `planRunGoal` :893, 종류 불일치 글). 앱의 `changes-plan.ts`가 CLI의 `human/changes-plan.ts`를 쓴다. 계획 명령을 둘로 나눈다(C-7a, C-7b) |
| `writablePaths` | U-182, U-186, U-194 | `cli/writable.ts`(36줄, `writablePathSetsOf`)를 `run.ts`와 `doctor.ts`가 쓴다. 입력 층에 넣는다(C-3b) |
| 읽기 제외와 k(묶음 A) | U-203, U-208, U-210·U-237(A6 판) | `cli/unreadable.ts`(87줄)에 원천 합치기(`runUnreadablePaths`, `runMinGroupSize`)와 부분별 전달(`runGuards`)이 있다. 앞은 입력 층(C-3b), 뒤는 조립(C-4)으로 간다 |
| 잠금을 풀지 못한 끝(lock left) | U-201, U-220 | `RunSummaryContext.lockLeft`. 실행·적용·되돌리기의 끝 요약이 한 줄을 더 낸다. 수명을 옮기는 단계(C-6a, C-7b, C-9a)에서 같은 줄이 나와야 한다 |
| 터미널 권한 질문(B-5), 첫 사용 | U-110, U-115 | `cli/confirm.ts`, `cli/terminal.ts`. C-6a에서 질문 통로를 앱의 `RunObserver.confirm`으로 옮긴다 |
| `cleanup` 명령 | U-22 외 | CLI `cleanup.ts`(422줄)와 앱 `cleanup.ts`(159줄)가 store를 따로 부른다(두 벌). 한 벌로 합친다(C-9b) |
| 판 비교 도구(P-1) | 이전 판의 P-1 | `scripts/compare-cli-boards.mjs`(393줄)와 `scripts/compare-cli/`(사례, 정규화, 가짜 서버, 터미널 흉내). 27사례이고 터미널 사례도 있다. 이전 판의 "터미널 길은 비교할 수 없다"는 한계가 줄었다 |

## 2. 지금의 의존 (main 9d435c42)

### 2.1 앱 계층 → CLI: 모듈 25개, 기호 66개 (A6 판 26개)

분류가 곧 옮기는 방법이다.
- **입력**: 입력 해석·보안 검사 층. 서로만 의존하는 묶음이라 통째로 `src/app/input/`으로 옮긴다(C-3a, C-3b).
- **조립**: 한 번의 실행에 엔진의 의존을 묶는 곳. 앱으로 옮기고 CLI는 앱의 것을 부른다(C-4).
- **명령**: 명령의 규칙. 규칙을 앱으로 옮기고 CLI는 인자 해석과 그리기만 남긴다.
- **글**: 사람에게 보이는 글의 정리. 앱이 어댑터에게 주는 규칙이라 앱으로 옮긴다.
- **작은**: 작은 상수나 형. 계약이나 앱으로 옮긴다.

| CLI 모듈(줄) | 앱이 쓰는 기호 | 앱의 사용처 | 분류 → 단위 |
| --- | --- | --- | --- |
| `security/*`(646, `index.ts` 39) | `KnownKeys`, `MAX_KEY_SCAN_DEPTH`, `findKeyInJson`, `inputFileTooLarge`, `inputFileTooLargeMessage`, `locateInWorkspace`, `rawTextHoldsKey`, `relateRealPaths` | `app.ts`, `runs.ts`, `settings.ts` | 입력 → C-3a |
| `text-safety.ts`(127) | `REPLACEMENT`, `cleanText`, `hideKeys`, `hideKeysInStrings` | `model-text.ts`, `run-events.ts`, `runs.ts`, `workspace-dir.ts`, `workspace-text.ts` | 글 → C-3a |
| `human/format.ts`(259) | `MODEL_TEXT_PREFIX`, `quoteModelText` | `model-text.ts` | 글 → C-3a |
| `human/output.ts`(975) | `FINAL_MESSAGE_MAX_LINES` | `model-text.ts` | 작은 → C-3a(상수만 `app/model-text.ts`로) |
| `install.ts`(49) | `findInstall` | `environment.ts` | 입력 → C-3a |
| `run-id.ts`(9) | `createRunId` | `check-apply.ts`, `workspace-text.ts` | 작은 → C-3a |
| `settings.ts`(315) | `configFieldOf`, `envValue`, `knownKeyValues`, `providerSettingsOf` | `app.ts`, `runs.ts`, `settings-change.ts`, `settings.ts` | 입력 → C-3b |
| `task.ts`(859, A6 판 880) | `quickProvider` | `settings-change.ts`, `settings.ts` | 입력 → C-3b |
| `config.ts`(374) | `parseConfig` | `settings.ts` | 입력 → C-3b |
| `config-file.ts`(180) | `chooseConfigFile`, `defaultLocationRefused`, `findDefaultConfigLocation`, `isMissingFile` | `app.ts`, `settings.ts` | 입력 → C-3b |
| `unreadable.ts`(A6 판 87) | `runGuards` | `check-apply.ts`, `changes-plan.ts`(A6 판) | 조립 → C-4(원천 합치기는 C-3b) |
| `assemble.ts`(520, A6 판 528) | `Assemble`, `ApprovedPlanParts`(main), `createAssemble`(A6 판), `createRevertCommand` | `app.ts`, `assemble.ts` | 조립 → C-4, 되돌리기 명령 → C-9a |
| `args.ts`(628) | `RUN_ID_PATTERN`, `RunArgs` | `app.ts`, `changes.ts`, `check-apply.ts`, `run-events.ts`, `runs.ts` | 작은 → C-3a(`RUN_ID_PATTERN`은 계약으로), C-5(`RunArgs` 형은 `prepareTask`와 함께) |
| `run.ts`(1,115, A6 판 1,214) | `prepareTask`, `PrepareEnvironment`, `RunNotes`, `positionDiagnostic`, `jsonSyntaxError` | `app.ts`, `settings.ts` | 명령 → C-5 |
| `run.ts` | `runCli`, `CliEnvironment`, `CliRunOutcome` | `app.ts`(`startRun` :275) | 명령 → C-6a |
| `cancel.ts`(45) | `createCancelSource` | `app.ts` | 명령 → C-6a |
| `plan-commands.ts`(1,219) | `runPlan`, `runApply`, `runReview`, `PlanCommandEnvironment` | `app.ts`(:823, :834, :888) | 명령 → C-7a, C-7b |
| `human/changes-plan.ts`(188) | `changesPlanOutput` | `changes-plan.ts` | 글 → C-7a |
| `report.ts`(1,186) | `readApplyResult`, `readResult`, `runReport`, `summarizeApplyJournal`, `summarizeJournal` | `app.ts`(:567, :587), `run-events.ts` | 명령 → C-8 |
| `revert.ts`(208) | `runRevert` | `app.ts`(:609) | 명령 → C-9a |
| `runs.ts`(166) | `resolveWorkspaceRoot` | `runs.ts` | 명령 → C-9a |
| `run-ref.ts`(129) | `STORE_RUN_REFERENCE_DEPS`, `resolveRunReference` | `runs.ts` | 명령 → C-9a |
| `doctor.ts`(1,125, A6 판 1,168) | `runDoctor` | `app.ts`(:661) | 명령 → C-10 |
| `models.ts`(552) | `ModelsEnvironment`, `runModels`, `writeConfigAtomic` | `app.ts`(:692), `settings-change.ts` | 명령 → C-11 |
| `init.ts`(402) | `runInit`, `SUGGESTED_SCRIPTS`, `SUGGESTED_PROTECTED_PATHS`, `MAX_PACKAGE_JSON_BYTES` | `app.ts`(:729), `init.ts` | 명령 → C-11 |
| `provider.ts`(28) | `API_MODEL_LISTERS`, `anthropicModelLister` | `app.ts` | 명령 → C-11 |
| `guard.ts`(92) | `CommandOutcome` | `app.ts` | 작은 → C-11(마지막 감싸기가 없어질 때) |

- 입력 묶음은 여전히 닫혀 있다(이 판에서 import를 다시 셌다). 그래서 통째로 옮길 수 있다.
  - `security/*`는 계약만 본다.
  - `settings`는 security만 본다. `task`는 security·policy를, `config`는 security·task를, `config-file`은 security·settings·task를 본다.
  - `text-safety`는 security를, `human/format`은 security·text-safety를, `writable`은 계약만 본다.
  - `unreadable`(A6 판)의 원천 합치기는 계약과 `writable`의 형만 본다. `runGuards`는 policy를 더 본다.
  - 이 묶음은 `run.ts`나 `main.ts`를 부르지 않는다.
- `json-position.ts`(166), `human/json-position.ts`(223)는 `run.ts`의 진단(`jsonSyntaxError`)과 doctor가 쓴다. C-5에서 `prepareTask`와 함께 옮긴다.
- 조립(`createAssemble` :422, `assembleWith` :428~520, 형 :51~104)은 CLI 모듈을 하나만 본다. 되돌리기 명령을 위한 `run-ref`이고, 조립 자체는 아니다. A6 판에서는 `unreadable`(`runGuards`)을 더 본다.

### 2.2 CLI → 앱 계층 (목표 방향, 지금 한 곳)

- `src/cli/changes.ts`, `src/cli/main.ts`:26, :243: `createCodarynApp(createNodeAppEnvironment())`를 `changes` 명령에만 쓴다.

### 2.3 앱 계층이 CLI 명령을 감싸는 곳 (거꾸로 된 방향)

| 앱 함수 | 감싸는 CLI 함수 | 위치(`src/app/app.ts`) |
| --- | --- | --- |
| `startRun`(:372) | `runCli`(앱의 `assemble`·`runTask`·`runApprovedPlan`을 끼움) | :275(`runCli` 호출), :286~356(끼우는 조립) |
| `readingSecrets`(`changes`, `listWorkspaceDir`, `listRunEvents`, `checkApply`, 텍스트 파일) | `prepareTask`(`readOnly`) | :449 |
| `report`, `reportMarkdown` | `runReport` | :567, :587 |
| `revert` | `runRevert` + `createRevertCommand` | :609, :615 |
| `doctor` | `runDoctor` | :661 |
| `listModels`, `selectModel` | `runModels` | :692 |
| `createSettings` | `runInit` | :729 |
| `plan`, `review` | `runPlan`, `runReview` | :823, :834 |
| `applyPlan`(이동 계획, run 계획) | `runApply`(run 계획은 앱의 조립으로 수행) | :888 |

## 3. 순서와 의존

```
P-2 도구 이름 제한 (기능 단위, 이행 전)
  ▼
C-1 계약 형 → C-2 AC-D3 → C-3a 보안·글 정리 이동 → C-3b 설정·task 해석 이동 → C-4 조립을 앱으로
  → C-5 prepareTask → C-6a run 뒤집기 → C-6b 계획 수행 실행 → C-7a 계획 보기·검토 → C-7b 적용
  → C-8 보고서 → C-9a 되돌리기·목록 → C-9b cleanup 한 벌 → C-10 doctor → C-11 models·init (+의존 구조 시험)
```

- 모두 직렬이다(DR-65). 앞 단위가 main에 병합된 뒤 다음을 main에서 시작한다.
- 꼭 지켜야 하는 의존:
  - P-2 → C-6a: CLI 진행 줄이 앱의 실행 이벤트에서 나오게 된다. 이벤트가 작업 종류 도구를 `(unknown tool)`로 바꾸면 진행 줄이 바뀐다.
  - C-3a → C-3b: 설정·task 해석이 security를 쓴다.
  - C-3b → C-4: `runGuards`가 `writable`의 형과 원천 합치기를 쓴다.
  - C-3b → C-5: `prepareTask`가 입력 층을 쓴다.
  - C-4, C-5 → C-6a: `run` 경로가 앱의 조립과 `prepareTask`를 쓴다.
  - C-6a → C-6b, C-7b: 계획 수행과 적용도 같은 수명·취소 틀을 쓴다.
  - C-3a → C-7~C-11: 모두 글 정리를 쓴다.
- C-1, C-2는 앞의 무엇에도 기대지 않는다. 그래도 맨 앞에 둔다. 형을 먼저 계약에 두면 뒤의 이동이 계약 형을 바로 쓴다.
- 앱이 가져오는 CLI 모듈 수(A6 판 기준): 26 → C-3a 뒤 20 → C-3b 뒤 16 → C-4 뒤 15 → C-5 뒤 14 → C-6a 뒤 12 → C-7a·C-7b 뒤 10 → C-8 뒤 9 → C-9a 뒤 5 → C-10 뒤 4 → C-11 뒤 0.
  - C-4 뒤에도 `assemble.ts`는 남는다. `createRevertCommand`가 그 안에 있어 C-9a에서야 빠진다.
  - C-11이 "`src/app`은 `src/cli`를 import하지 않는다"는 구조 시험을 더한다. 시험만 더하는 것이고 동작 변경은 아니다. AC-D16이 끝난다.

## 4. 단계별 계획

모든 단계에 공통인 것:
- 담당은 조사 8절대로 "그 모듈의 담당 + p5a"다. CLI 쪽은 na-core, 사람 글(렌더러)은 nc-human, 계약은 p4g, store는 N-C, 앱은 p5a다. 아래 "담당"은 주 담당이다.
- 깨질 시험은 "import 줄만 바뀌는 유닛 시험"이다. 동작을 단언하는 시험은 바뀌지 않아야 한다. 수는 그 모듈을 가져오는 시험 파일 수(main 9d435c42)다.
- 고정 값은 모든 단계에서 그대로다(5절). 단계에 따로 적는 것은 "그 단계에서 특히 걸리기 쉬운 고정 값과 판 비교 사례"다.

### P-2 실행 이벤트의 도구 이름 제한 (첫 단계, 기능 단위)

- **옮길 것:** 옮기는 것은 없다. `src/app/events.ts`의 `limitToolNames`(:33)가 내장 넷(`TOOL_NAMES`) 대신 `ALL_TOOL_NAMES`(작업 종류 도구 포함)를 알게 한다(R-80 I-1).
- **줄:** 고침 약 80(시험 포함).
- **앞선 단계:** 없음.
- **바뀌는 것(기능):** GUI의 실행 이벤트에서 `inspect_files`, `propose_plan`, `propose_changes`, `query_table`이 `(unknown tool)` 대신 제 이름으로 보인다. CLI 출력과 JSON은 그대로다(CLI는 이벤트를 쓰지 않는다).
- **깨질 시험:** `tests/unit/app/`의 이벤트 시험 가운데 작업 종류 도구를 `(unknown tool)`로 단언하는 것. GUI 시험 가운데 같은 것이 있으면 함께 바뀐다(p5u-gui 확인).
- **담당:** p5a.
- **위험:** 낮음. 이름 아닌 다른 값을 거르지 않게 되는지(가린 값, 모르는 이름은 그대로 `(unknown tool)`)를 시험으로 지킨다.

### C-1 계약 형 (이행 1a)

- **옮길 것:** `src/app/types.ts`(1,034)의 4·5절 형과 `src/app/general-tasks.ts`(29)를 `src/contracts/app.ts`로. 계약은 앱·CLI를 import하지 않는다.
- **남길 것:** `src/app/types.ts`는 다시 내보내기만(약 40줄). GUI가 `src/app/index.js`에서 가져오는 이름은 그대로다.
- **줄:** 옮김 약 1,000, 고침 약 100.
- **앞선 단계:** 없음.
- **깨질 시험:** 없음(이름은 다시 내보낸다). `src/contracts` 쪽 계약 시험에 "app.ts는 앱·CLI를 import하지 않는다" 한 건을 더할 수 있다(p4g 판단).
- **고정 값:** sp0와 판 비교는 닿지 않는다(형만).
- **담당:** p4g(계약), p5a.
- **위험:** 낮음. GUI의 형 검사(`gui` 빌드)가 그대로인지 GUI 시험으로 본다. U-247(p5u-gui)이 `src/app/types.ts`를 고치는 중이다(7절).

### C-2 AC-D3: `append`가 저장한 레코드를 돌려줌 (이행 1b, PM 답: 이행에 넣음)

- **옮길 것:** `Journal.append`(`contracts/journal.ts`:214)와 `ApplyJournal.append`(`contracts/plan.ts`:881)가 저장한 레코드(`seq`, `at` 포함)를 돌려준다.
  - store의 두 journal, 엔진의 기록, 감싸개(`app/events.ts`, `app/apply.ts`, `cli/progress.ts`의 `withProgress`, `cli/run.ts`의 관찰 감싸개 둘, `cli/plan-commands.ts`의 `observeApply`)가 따른다.
  - 앱의 실행 이벤트는 스스로 세던 `seq`와 앱 시계의 `at` 대신 저장된 값을 쓴다.
- **줄:** 고침 약 450(가짜 journal을 쓰는 유닛 시험의 반환형 포함).
- **앞선 단계:** 없음(C-1 뒤).
- **바뀌는 것:** 실행 이벤트의 `record.at`이 저장된 `at`과 같아진다(지금은 몇 밀리초 다를 수 있다). CLI 출력·JSON·기록은 그대로다. PM 답대로 이행으로 둔다.
- **깨질 시험:** 가짜 journal을 만드는 유닛 시험(이전 판 13파일, 지금은 더 많다. 단계 시작 때 센다). 반환형만 바뀐다.
- **고정 값:** 기록 파일이 그대로인지 판 비교의 상태 디렉터리 비교로 본다.
- **담당:** p4g(계약), N-C(store), p5a.
- **위험:** 중간. `seq`를 두 곳에서 세던 것을 한 곳으로 바꾸므로, 이벤트 순서와 다시 가림이 같은지 c01과 앱 이벤트 시험으로 본다.

### C-3a 보안·글 정리 이동 (입력 층 앞쪽)

- **옮길 것(이름 바꿈, `git mv`):** `security/*`(646), `text-safety.ts`(127), `install.ts`(49), `run-id.ts`(9), `human/format.ts`(259)를 `src/app/input/`로.
  - `RUN_ID_PATTERN`(`args.ts`)은 계약으로, `FINAL_MESSAGE_MAX_LINES`(`human/output.ts`)는 `app/model-text.ts`로 옮긴다.
  - CLI와 시험의 import를 새 자리로 고친다. `human/index.ts`는 `format`의 이름을 다시 내보내 렌더러 쪽 import를 줄인다.
- **줄:** 이름 바꿈 약 1,090, 고침 약 250(import 줄).
- **앞선 단계:** C-1, C-2.
- **깨질 시험(import만):** `security/index`를 가져오는 시험 73파일, `text-safety` 5, `run-id` 4, `human/format` 4, `install` 1.
- **고정 값:** sp0의 키 검사(P-7)와 오류 문구가 이 모듈들에서 나온다. 내용이 그대로라 닿지 않아야 한다.
- **담당:** na-core, nc-human(`human/format`), p5a.
- **위험:** 낮음(이름 바꿈). 다만 import를 고치는 파일이 많아, 같은 파일을 고치는 열린 단위와 충돌한다. 시작 전 PM이 "입력 층과 그 사용처를 고치는 열린 단위 없음"을 확인한다.

### C-3b 설정·task 해석 이동 (입력 층 뒤쪽)

- **옮길 것(이름 바꿈):** `settings.ts`(315), `task.ts`(880, A6 판), `config.ts`(374), `config-file.ts`(180), `writable.ts`(36)를 `src/app/input/`로.
  - `unreadable.ts`의 원천 합치기(`runUnreadablePaths`, `runMinGroupSize`, `privateAnalysisWithoutData`, `UNREADABLE_PATHS_REQUIRED_TEXT`)를 `src/app/input/unreadable.ts`로(옮김). `runGuards`는 C-4까지 `cli/unreadable.ts`에 남아 앱의 것을 import한다.
- **줄:** 이름 바꿈 약 1,790, 옮김 약 50, 고침 약 150.
- **앞선 단계:** C-3a. A6 판(U-210, U-237)과 U-245, U-246이 main에 있어야 한다(`task.ts`, `unreadable.ts`를 고친다).
- **깨질 시험(import만):** `config` 15파일, `task` 14, `settings` 6, `config-file` 2.
- **고정 값:** sp0의 P-7(설정 해석 결과). 판 비교의 `errors`, `errors-ko`(설정·task 오류 문구와 진단).
- **담당:** na-core, p5a.
- **위험:** 낮음. `writablePathSetsOf`와 원천 합치기가 doctor와 실행에서 같은 목록을 주는지는 기존 시험(g-u182, g-u210)이 지킨다.

### C-4 조립을 앱으로 (새 단계)

- **옮길 것:** `cli/assemble.ts`의 조립 전부를 `src/app/assemble.ts`로.
  - 대상: `AssemblyInput`, `ApprovedPlanParts`, `AssemblyOutcome`, `Assemble`, `AssembleHooks`, `createAssemble`, `assembleWith`(:51~104, :415~520), `lockedMessage`(:106). A6 판의 `runGuards`(`cli/unreadable.ts`)도 함께 간다.
  - 앱의 `createAppAssemble`(A6 판에서 `createAssemble`을 감싸는 49줄)과 하나로 합친다.
  - CLI의 `assembleRun`은 앱의 `createAssemble()`을 부른다(CLI → 앱 방향). `cli/assemble.ts`는 `createRevertCommand`와 그 형만 남기고, 옮긴 이름을 다시 내보내 시험의 import를 그대로 둔다.
- **줄:** 옮김 약 250, 고침 약 120.
- **앞선 단계:** C-3b.
- **깨질 시험:** 없음을 목표로 한다(`cli/assemble.ts`가 다시 내보냄). `assemble`을 가져오는 시험은 58파일이다. 다시 내보내기를 C-9a에서 걷을 때 import 줄만 바뀐다.
- **고정 값:** 판 비교의 모든 `run`·`apply` 사례(조립이 모두 지난다). c01(CLI 경로와 앱 경로의 결과·기록이 필드까지 같음).
- **담당:** na-core, p5a.
- **위험:** 중간.
  - DR-4: CLI의 `assembleRun`은 명령 실행기에 `parentEnv`를 주지 않는다(`process.env`). 앱은 실행의 환경 사본을 훅으로 준다. 옮긴 뒤에도 CLI는 훅 없이 부르므로 같다. 7.1의 DR-4 두 경우를 CLI 경로에서 보는 시험을 이 단계에 더한다.
  - 계획 수행의 `policyFor`가 `runGuards`의 관문을 쓰는지(R-108 H-1)는 g-u210-r108 시험이 지킨다.

### C-5 `prepareTask`를 앱으로 (이행 2a)

- **옮길 것:** `prepareTask`(`run.ts`:526~876)와 도우미를 `src/app/prepare.ts`로.
  - 도우미: `error`, `cliError`, `withHint`, `argumentsError`, `settingsError`, `positionDiagnostic`, `jsonSyntaxError`, `headDiagnostic`(:225~306), `workflowProblemText`·`planWeakenedText`·`WORKFLOW_PROBLEM_TEXT`(:359~391), `underDefinition`, `withWorkflow`, `readText`, `parseJson`, `scrub`, `defaultConfigNotice`(:392~479).
  - A6 판의 `unreadableWithCommands`와 R-5·P-1의 거부와 그 힌트(R-110).
  - 형: `RunNotes`, `PreparedTask`, `PrepareEnvironment`, `RunArgs`.
  - `json-position.ts` 둘은 이름 바꿈.
  - CLI의 `run.ts`, `plan-commands.ts`(`prepareFor` :309), doctor·models·init·report·runs·cleanup·changes(`cliError`, `argumentsError`)와 앱의 `readingSecrets`가 새 자리를 부른다.
- **남길 것:** 인자 해석기(`args.ts`의 `parseArgs`, `parsePlanArgs` 등)는 CLI에 남는다. `CliEnvironment`가 `PrepareEnvironment`를 넓힌다.
- **줄:** 옮김 약 650, 이름 바꿈 389, 고침 약 200.
- **앞선 단계:** C-3b, C-4.
- **깨질 시험(import만):** `prepareTask`, `positionDiagnostic`, `cliError`를 `src/cli/run.js`에서 가져오는 시험(`run`을 가져오는 73파일 가운데 이 이름을 쓰는 것). `runCli`만 쓰는 시험은 그대로다. `args`의 `RunArgs`를 쓰는 시험 19파일 가운데 형을 쓰는 것.
- **고정 값:** 실행 전 검사의 순서와 오류 코드·문구(adapter-contract 7.1). 판 비교의 `errors`, `errors-ko`, `read-commands`. sp0의 실행 전 오류 출력.
- **담당:** na-core, p5a.
- **위험:** 중간. 묶음 A와 계획 실행이 해석 단계에 거부를 더했다(`plan_tool_missing`, `unreadable_paths_required`, R-5, 힌트). 순서가 하나라도 바뀌면 오류 코드가 바뀐다. R-110·U-228·U-224·U-210의 실제 CLI 시험이 지킨다.

### C-6a `run`을 앱 계층으로 뒤집기 (이행 2b+3)

- **옮길 것:** `runParsed`·`runPrepared`(`run.ts`:877~, A6 판 약 340줄)의 수명을 앱의 `startRun` 하나로 옮긴다.
  - 수명: 취소 원천, 조립과 잠금, 엔진(`runTask`), Y-4 안내(`watchingNotFound`, `withModelHint`), 기본 설정 안내, 결과 저장, 잠금 해제와 lock left.
  - 앱의 `startRun`은 `runCli`를 감싸지 않고 직접 한다.
  - CLI의 `runCli`는 인자 해석 → `app.startRun(관찰자)` → 출력이 된다.
    - 진행 줄은 `RunObserver.onEvent`에서 쓴다(`progress.ts`의 렌더러는 CLI에 남음).
    - Y-4·기본 설정 안내는 `notice`에서 쓴다.
    - 끝 요약의 수(`RunNotes`: 거부·실패, 확인 질문 거부, writablePaths·계획 밖 거부, 읽기 제외 거부·숨긴 묶음)는 CLI 관찰자가 이벤트로 센다.
    - B-5 터미널 질문은 `RunObserver.confirm`으로 받는다.
    - SIGINT·SIGTERM·취소 파일은 `handle.cancel()`로 넘긴다(`main.ts`).
- **남길 것:** 끝 요약(`runSummary`)과 진행 줄의 글(`human/output.ts`, `progress.ts`), 터미널 질문의 글과 입력(`confirm.ts`, `terminal.ts`).
- **줄:** 고침 약 1,250(새 시험 약 150 포함). 이 계획에서 가장 큰 단위다.
- **앞선 단계:** P-2, C-4, C-5. 진행 줄을 접을지에 대한 사용자 답(U-243)을 받은 뒤 시작한다.
- **깨질 시험:** `runCli`를 주입한 환경으로 부르는 유닛 시험(`tests/unit/cli/`의 k-support 계열). 주입점(`assemble`, `runTask`)의 자리가 앱으로 옮겨 가므로, 시험이 주는 환경의 필드 이름만 바뀌게 한다. 바뀌는 시험 파일은 단위 보고에 이름으로 싣는다.
- **고정 값:** 판 비교의 모든 `run` 사례와 터미널 사례(`terminal-run`, `terminal-permission`, `terminal-permission-ctrl-c`), `document-run-quiet`, `denials`, `repair`, `secret-masked`. sp0 P-8의 `run` 출력. 통합 n01(`docs/usage.md`의 블록과 비교), n12, n13(lock left).
- **담당:** na-core, p5a. 진행 줄·끝 요약의 글은 nc-human이 확인한다.
- **위험:** 높음(6절의 넷이 모두 걸린다).

### C-6b 계획을 수행하는 실행을 앱으로

- **옮길 것:** `applyChangesPlan`(`plan-commands.ts`:927)이 부르는 실행 경로(`io.run`, 곧 `runPrepared`에 승인된 계획)를 앱의 `startRun`(승인된 계획, U-218의 `runApprovedPlan`)으로 바꾼다. 계획 밖 거부의 수(`deniedNotPlanned`)도 C-6a의 관찰자가 센다.
- **줄:** 고침 약 400.
- **앞선 단계:** C-6a.
- **깨질 시험:** `applyChangesPlan`에 실행 환경을 주입하는 유닛 시험(U-195, V-14 계열).
- **고정 값:** 판 비교의 `handoff-plan-applied`, 계획 실행의 실제 CLI 시험(g-u195-run-plan-cli, g-u195-v14, g-u210-r108-carried-plan, g-u228).
- **담당:** na-core, p5a.
- **위험:** 중간. 잠금 아래 기록 변경 표시의 재확인(PM, U-1과 같게)과 claim 한 번이 앱 경로에서도 같아야 한다.

### C-7a 계획 보기와 사람 확인을 앱으로 (이행 2b+3)

- **옮길 것:** `prepareFor`(:309), `loadAny`(:362), `changesView`(:372), `loadShown`(:388), `planRunMarked`(:520), `readPlanJournal`(:528), `planSummary`(:545), `runPlan`의 규칙(:595), `awaitingReview`(:1073), `runReview`의 잠금(:1151~)을 앱으로. `human/changes-plan.ts`의 `changesPlanOutput`도 앱으로 간다.
  - 앱의 `plan`·`review`는 CLI를 감싸지 않고 직접 한다. CLI는 앱 함수를 부른다.
- **남길 것:** 인자 해석, `renderPlan`(:465), `renderChangesPlan`, `renderReview`(:1116, U-210의 `builtinReviewItemText` 포함).
- **줄:** 옮김 약 500, 고침 약 250.
- **앞선 단계:** C-6a.
- **깨질 시험:** `plan-commands`를 가져오는 시험 28파일 가운데 보기·검토 쪽(import만).
- **고정 값:** 판 비교의 `plan-apply`(보기 부분), `handoff-review-reject`, `read-commands`. 계획 보기의 글(U-36, U-221).
- **담당:** na-core, nc-human(보기의 글), p5a.
- **위험:** 중간. 가린 값이 다른 계획(`plan_secrets_differ`)과 기록 변경 표시를 보는 순서가 같아야 한다.

### C-7b 적용(이동 계획, run 계획)을 앱으로

- **옮길 것:** `runApply`의 규칙(:643~892), `applyOnce`의 조립·잠금, `observeApply`(:1012), `planTaskIdOf`(:1060), `planRunGoal`(:893), `applyChangesPlan`의 실행 전 거부(:927~1011: 이미 수행, 기록 변경 표시, 동의 거부, goal, U-228의 종류 불일치)를 앱으로. 앱의 `applyPlan`은 직접 한다.
- **남길 것:** 인자 해석, 터미널 [y/N] 질문과 그 글(`applyQuestion` :623, `unsafeMoveQuestion` :631, U-228의 `changesApprovalText`·`changesApplyQuestion`), 동의 뒤 두 번째 적용의 질문.
- **줄:** 옮김 약 550, 고침 약 350.
- **앞선 단계:** C-6b, C-7a.
- **깨질 시험:** `plan-commands`를 가져오는 나머지 시험(import만). 동의(g-consent)·종류 불일치(g-u228) 시험은 동작을 단언하므로 그대로여야 한다.
- **고정 값:** 판 비교의 `plan-apply`, `terminal-apply-yes`, `terminal-apply-no`, `handoff-other-task`, `revert`(적용 실행 되돌리기). 통합 n10(`docs/usage.md` 18.9·18.10과 비교).
- **담당:** na-core, p5a.
- **위험:** 높음에 가까운 중간. 동의 뒤 두 번째 적용, 잠금, lock left, 다른 task 알림의 줄 순서(시작 줄 바로 뒤, 질문 앞)가 모두 같아야 한다.

### C-8 보고서를 앱으로 (이행 4a)

- **옮길 것:** `report.ts`의 읽기와 판정을 앱으로: `failedCallsIn`(:239), `summarizeJournal`(:252), `readResult`(:360), `summarizeApplyJournal`(:731), `readApplyResult`(:847), `runReport`의 판정 부분(:1042~). 앱 `report`는 직접 읽는다.
- **남길 것:** `renderReport`(:545), `renderApplyReport`(:897), 고정 문구 표.
- **줄:** 옮김 약 650, 고침 약 200.
- **앞선 단계:** C-3a(글 정리), C-7b.
- **깨질 시험(import만):** `report`를 가져오는 시험 20파일.
- **고정 값:** 판 비교의 `read-commands`(report 글·JSON·latest·적용 실행). 앱의 실행 사건 목록(`run-events.ts`)이 같은 요약 함수를 쓰므로 GUI 시험.
- **담당:** na-core, p5a.
- **위험:** 낮음(읽기만). 보고서의 가림 한도(`REPORT_FIXED_LIMITS`)가 그리기와 판정 사이에서 나뉘지 않게 한다.

### C-9a 되돌리기와 실행 목록을 앱으로 (이행 4b)

- **옮길 것:** `createRevertCommand`(`cli/assemble.ts`:245~414)와 형, `revert.ts`의 규칙(`runRevert` :114의 판정, `appliedPlanHint` :87), `runs.ts`의 `resolveWorkspaceRoot`(:91)·`resolveRunRef`(:111), `run-ref.ts` 전체(129)를 앱으로. 앱 `revert`·`listRuns`·`resolveRun`이 규칙을 갖고 CLI는 출력만 한다. C-4의 다시 내보내기를 걷는다.
- **남길 것:** `revert`·`runs`의 글, 되돌리기의 터미널 질문(DR-25).
- **줄:** 옮김 약 550, 고침 약 250.
- **앞선 단계:** C-8.
- **깨질 시험(import만):** `revert` 19파일, `assemble` 58파일(다시 내보내기를 걷으며 import 줄만), `runs` 3, `run-ref` 3.
- **고정 값:** 판 비교의 `revert`, `read-commands`(runs). 되돌리기의 lock left 줄(U-220).
- **담당:** na-core, N-C(store의 되돌리기 기록), p5a.
- **위험:** 중간. 되돌리기는 지금의 읽기 제외를 보지 않는다(Codex V-23의 참고, cli-contract 13.2). 옮긴 뒤에도 그대로다.

### C-9b `cleanup`을 한 벌로

- **옮길 것:** CLI `cleanup.ts`(422)의 판정(store의 `planCleanup`·`applyCleanup`·`summarizeState`를 부르는 부분)을 앱 `cleanup.ts`(159)로 합친다. CLI의 `runCleanup`은 인자 해석 → 앱 → 출력이 된다.
- **남길 것:** 인자 해석(`parseCleanupArgs`), `renderCleanup`, `itemName`.
- **줄:** 고침 약 400.
- **앞선 단계:** C-9a.
- **깨질 시험(import만):** `cleanup`을 가져오는 시험 13파일.
- **고정 값:** 판 비교의 `cleanup-preview`. 정리 명령의 JSON(DR-48이 한 번 바꾼 것)이 글자까지 같아야 한다.
- **담당:** na-core, N-C, p5a.
- **위험:** 중간. 두 벌이 지금 같은 판정을 내는지 먼저 잰다. 다르면 이행을 멈추고 기능 단위로 돌린다(2.3의 규칙: 결함은 이행에 섞지 않는다).

### C-10 doctor를 앱으로 (이행 5a)

- **옮길 것:** `doctor.ts`(A6 판 1,168)의 점검(`DOCTOR_CHECK_IDS`, `runDoctor` :593의 판정, `inspectLockFile` :405)을 앱으로.
  - 오늘 늘어난 점검이 함께 간다: `commands` 점검의 writablePaths·plan run·읽기 제외 경고와 실패, 작업 종류 해석(`plan_tool_missing`), analyze-private의 빈 목록, k의 까닭 노트.
- **남길 것:** 점검 글 그리기(`renderDoctor` :448).
- **줄:** 옮김 약 800, 고침 약 200.
- **앞선 단계:** C-5(해석 도우미), C-9b.
- **깨질 시험(import만):** `doctor`를 가져오는 시험 23파일.
- **고정 값:** sp0 P-8의 doctor 출력. 판 비교의 `terminal-doctor`.
- **담당:** na-core, p5a.
- **위험:** 중간. 점검마다 run.ts와 같은 목록(`runUnreadablePaths`, `writablePathSetsOf`)과 같은 해석을 쓰는지가 지금 시험의 몫이다. 옮겨도 같은 함수를 부른다.

### C-11 models·init과 의존 구조 시험 (이행 5b)

- **옮길 것:** `models.ts`(목록·`--use`·`writeConfigAtomic` :183), `init.ts`(`runInit` :190과 제안 상수), `provider.ts`, `guard.ts`의 `CommandOutcome`을 앱으로. 구조 시험 "`src/app` → `src/cli` 없음"을 더한다.
- **남길 것:** 글(`renderModels` :313, `renderInit` :171), 터미널 질문(`init`의 N-2).
- **줄:** 옮김 약 600, 고침 약 300.
- **앞선 단계:** C-10.
- **깨질 시험(import만):** `models` 9, `init` 4, `provider` 3, `guard` 11.
- **고정 값:** sp0 P-8의 models·init 출력. 판 비교의 `models-list-use`, `models-list-use-ko`, `terminal-models`, `terminal-init`, `terminal-init-declined`.
- **담당:** na-core, p5a.
- **위험:** 낮음. 설정 파일 쓰기(`writeConfigAtomic`)를 앱의 `selectModel`·`applySettingsChange`가 이미 쓴다.

### 4.1 단계 표 (줄 어림)

| 단계 | 고침 | 옮김 | 이름 바꿈 | 앞선 단계 | 주 담당 | 위험 |
| --- | --- | --- | --- | --- | --- | --- |
| P-2 | 80 | — | — | — | p5a | 낮음 |
| C-1 | 100 | 1,000 | — | — | p4g | 낮음 |
| C-2 | 450 | — | — | C-1 | p4g, N-C | 중간 |
| C-3a | 250 | — | 1,090 | C-2 | na-core | 낮음 |
| C-3b | 150 | 50 | 1,790 | C-3a, A6 판 | na-core | 낮음 |
| C-4 | 120 | 250 | — | C-3b | na-core, p5a | 중간 |
| C-5 | 200 | 650 | 389 | C-4 | na-core | 중간 |
| C-6a | 1,250 | — | — | P-2, C-5, U-243 답 | na-core, p5a | 높음 |
| C-6b | 400 | — | — | C-6a | na-core | 중간 |
| C-7a | 250 | 500 | — | C-6a | na-core | 중간 |
| C-7b | 350 | 550 | — | C-6b, C-7a | na-core | 중간(높음에 가까움) |
| C-8 | 200 | 650 | — | C-7b | na-core | 낮음 |
| C-9a | 250 | 550 | — | C-8 | na-core, N-C | 중간 |
| C-9b | 400 | — | — | C-9a | na-core, N-C | 중간 |
| C-10 | 200 | 800 | — | C-9b | na-core | 중간 |
| C-11 | 300 | 600 | — | C-10 | na-core | 낮음 |

- 한 단계의 고침과 옮김을 더해도 1,500줄을 넘지 않는다. C-1은 옮김이 크지만 형만이라, 옮김이 글자 그대로인지를 기계로 본다(`git diff --color-moved`).

## 5. "동작이 그대로"를 보이는 방법 (완료 기준)

단위마다 아래를 모두 지킨다. 단위 보고에 결과를 판 해시(`git rev-parse` 출력)와 함께 싣는다.

1. **sp0 고정 값:** `tests/unit/cli/sp0-cli.test.ts`(P-7 설정 해석, P-8 doctor·models·init·run의 출력과 요청 본문)와 `tests/unit/model/anthropic/sp0-pins.test.ts`가 통과한다. 고정 파일 넷(`tests/unit/cli/sp0-expected.ts`, `sp0-pins.ts`, `tests/unit/model/anthropic/sp0-golden.ts`, `sp0-scenarios.ts`)은 바뀌지 않는다. 단위의 `git diff --stat`에 이 파일이 나오면 그 단위는 멈춘다.
2. **판 비교:** `node scripts/compare-cli-boards.mjs --base <main> --head <단위 끝>`에서 27사례(단계마다 늘림) 모두 차이 0이다. stdout, stderr, 종료 코드, 상태 디렉터리와 작업 공간의 파일을 정규화 뒤 글자까지 비교한다. 터미널 흉내 사례도 포함된다.
   - 단계마다 그 단계가 지나는 길의 사례를 먼저 늘린다. 예: C-3b와 C-5에 읽기 제외·analyze-private의 거부 오류, C-6a에 writablePaths 안내 줄·읽기 제외 거부 요약·lock left, C-7b에 run 계획 적용과 종류 불일치, C-9b에 `cleanup --confirm`.
   - 사례를 늘리는 일은 그 단계의 첫 커밋으로 하고, main과 main을 비교해 차이 0을 확인한 뒤 옮기기를 시작한다.
3. **유닛·통합:** typecheck 0, 유닛 실패 0, 통합 실패 0. 유닛 수는 이전 판과 같다(옮긴 시험은 그대로 센다). 수가 다르면 설명한다. 통합 시험(`tests/integration/**`)은 바꾸지 않는다. 실제 CLI 프로세스를 돌리므로 import가 없다. n01·n10은 `docs/usage.md`의 블록과 비교하므로 출력이 한 글자라도 바뀌면 여기서 잡힌다.
4. **U-112 계약 층 시험:** `tests/integration/c01-cli-app-contract.test.ts` 5건(문서 실행, 거부, 재수정, 계획과 적용, 모델 오류)이 통과한다. CLI 경로와 앱 경로의 결과·기록이 필드까지 같다는 시험이다. C-4, C-6a, C-7b처럼 두 경로가 하나로 합쳐지는 단위에서 "합친 뒤에도 같다"를 보장한다.
5. **옮긴 시험은 import 줄만:** 단위 보고에 "import 줄을 뺀 시험 diff가 비어 있음"을 싣는다(`git diff -M <base>..<끝> -- tests`에서 import 줄을 걸러 내는 짧은 명령). 예외는 단계에 이름으로 적은 새 시험뿐이다(C-4의 DR-4, C-6a의 프로세스 생존과 이른 신호, C-11의 구조 시험).
6. **GUI:** 루트를 빌드한 뒤 GUI `npm test`와 `test:smoke`를 돌린다(GUI는 루트의 `dist`를 쓴다). 앱 계층의 공개 이름이 바뀌지 않았음을 본다. GUI의 `node_modules`가 없는 worktree에서는 GUI 담당이 돌린다.

### 5.1 이행 중의 규칙

- **기능 변경을 섞지 않는다.** 한 단위는 옮기기 하나다. 옮기다 찾은 결함은 고치지 않고 적어 두었다가 기능 단위로 돌린다. 예외는 PM이 미리 정한 것뿐이다(P-2).
- 새 시험은 5절 5에 적은 것만 허용한다.
- adapter-contract는 단위마다 7.2 표의 상태 열과 3절의 "지금" 문장만 고친다. AC-D16은 C-11에서 "끝남"으로 적는다. cli-contract는 함수의 자리가 적힌 곳만 고친다(예: 13.2의 `runGuards`, `src/cli/unreadable.ts`).

## 6. 위험한 곳

### 6.1 실행 수명 (C-6a, C-6b, C-7b)

- 지금 CLI의 순서(`runPrepared`, `run.ts`:902~):
  1. 취소 원천 만들기
  2. 조립과 잠금
  3. 진행 줄 감싸기(기록 저장 직후 줄을 씀)와 끝 요약의 수 세기
  4. 엔진(`runTask`, 또는 승인된 계획의 `runApprovedPlan`)
  5. Y-4·기본 설정 안내를 결과에 더함
  6. 결과 저장과 잠금 해제. 풀지 못하면 lock left
  7. writablePaths 안내 진행 줄(계획 없는 실행만), 끝 요약을 stderr에
  8. 취소 원천 정리
  9. `main.ts`가 stdout에 JSON 한 줄
- 앱의 `startRun`은 손잡이를 먼저 주고, 문을 연 뒤 엔진을 시작한다. `done`은 지금 `runCli`가 끝난 뒤, 곧 잠금이 풀린 뒤 풀린다.
- 뒤집은 뒤에도 같은 순서가 나와야 한다. stderr의 진행 줄 → 안내 줄 → 끝 요약은 잠금 해제 뒤이고, 그다음이 stdout의 JSON이다.
- 내부 예외: 지금은 `internal_error`이고 잠금을 푼다. 잠금을 풀지 못하면 결과는 그대로이고 끝 요약에 한 줄이 붙는다(U-220). 앱 경로에서도 같아야 한다.
- 오류 왕복: 앱은 `AppError`로, CLI는 `CliErrorOutput`으로 낸다. `fromCliError`·`toCliError`(`app/errors.ts`)가 `hint`·`detail`·`diagnostic`을 잃지 않아야 한다. 오늘 힌트가 늘었다(`plan_kind_differs`, `plan_tool_missing`, A6 판의 묶음 A 셋). 실행 전 오류 사례를 판 비교에 늘리는 까닭이다.

### 6.2 취소 신호 (C-6a, C-7b)

- CLI는 `createCancelSource`에 `process.on(name, handler)`를 준다(`main.ts`). 처리기는 조립 직전에야 생긴다.
  - 그 전(실행 전 검사)의 SIGINT는 Node 기본대로 프로세스를 끝낸다. 뒤집은 뒤에도 처리기를 더 일찍 걸지 않는다.
- 앱 경로에서는 앱의 취소 묶음이 처리기를 갖는다. CLI는 손잡이를 받은 뒤 신호를 받아 `handle.cancel()`을 부르고, `done` 뒤에 처리기를 뗀다.
- 취소 파일은 같은 모듈(`cancel.ts`, 100 ms 폴링)이 본다. 앱 요청의 `cancelFile`로 넘긴다.
- R-79 I-1: 엔진의 시간 한도 타이머는 `unref()`다. B-5 터미널 질문이 stdin을 쥐어 프로세스를 살린다. 질문 통로가 `RunObserver.confirm`으로 바뀌어도 같아야 한다. 판 비교의 `terminal-permission-ctrl-c` 사례와 유닛 시험 하나로 본다.

### 6.3 진행 줄과 끝 요약의 수 (C-6a, C-6b)

- 지금 진행 줄은 `withProgress`(`progress.ts`)가 journal 저장 직후에 쓴다. 앱의 `journalWithEvents`도 저장 직후에 이벤트를 준다. 그래서 줄의 순서는 같다.
- 글이 달라질 수 있는 곳:
  1. **도구 이름:** 사람 글은 `ALL_TOOL_NAMES`를 안다. 실행 이벤트는 내장 넷 밖을 `(unknown tool)`로 바꾼다(`app/events.ts`의 `limitToolNames`). 정리·분석·계획·표 집계의 진행 줄이 바뀐다. **P-2를 첫 단계로 두는 까닭이다.**
  2. **호출 id:** 사람 글은 거부된 호출 id를 모아 실패 줄을 거른다. 이벤트는 id를 다시 가린다. 이미 가린 id라 같은 글이어야 한다(판 비교의 `denials`).
  3. **끝 요약의 수:** 지금은 실행의 journal 감싸개가 원래 레코드로 센다(`RunNotes`: 거부 코드별 수, `notePrivateData`의 `queryTableFacts`). 이벤트로 셀 때 다시 가림이 코드와 `query_table` 결과의 내용(`suppressedGroups`, `fewCells`)을 바꾸지 않아야 한다. 바뀐다면 앱이 수를 결과와 함께 주는 쪽으로 정한다(C-6a 설계에서 정함).
- 기본 설정 안내 줄은 `run_started` 줄 바로 뒤에 나온다. 앱 경로에서는 첫 레코드 이벤트를 받은 뒤 CLI가 쓴다.
- 언어: 사람 글은 설정의 언어를 안 뒤에 만든다(`notes.configLanguage`). 앱이 이 값을 관찰자에게 알려야 한다.
- 진행 줄을 100칸에서 접을지(U-243, U-233)는 사용자 질문이다. C-6a 전에 답이 나와야, 진행 줄을 쓰는 자리를 옮기는 일과 줄 꼴을 바꾸는 일이 한 단위에 섞이지 않는다.

### 6.4 잠금과 조립 (C-4, C-6a, C-7b, C-9a)

- 잠금은 네 군데서 잡는다: 실행(조립), 적용(동의 뒤 두 번째 적용 포함), 검토, 되돌리기(`createRevertCommand`).
- 옮긴 뒤에도 세 가지가 같아야 한다.
  - 모든 실행 전 검사 뒤에 잡는다.
  - finally에서 요약 전에 푼다. 풀지 못하면 lock left 한 줄이다.
  - `workspace_locked`의 문구가 같다. A6 판에서 조립이 한 벌이 되며 `lockedMessage`도 하나가 된다.
- DR-4: CLI의 조립은 명령 실행기에 `parentEnv`를 주지 않는다(`process.env`). 앱은 실행의 환경 사본을 훅으로 준다. C-4 뒤에도 CLI는 훅 없이 부르므로 같다. C-6a에서 CLI가 앱의 `startRun`을 쓰게 되면, 자식 명령에 가는 변수가 "변수 파일을 `process.env`에 넣은 값"에서 "사본에 넣은 값"으로 바뀐다. 허용 목록 규칙상 같아야 하고, 7.1의 DR-4 두 경우를 CLI 경로의 시험으로 고정한다(C-4에서 더함).

## 7. 진행 중 작업과 부딪히는 파일 (main 9d435c42 기준)

| 진행 중 단위 | 바꾸는 파일 | 부딪히는 단계 | 처리 |
| --- | --- | --- | --- |
| A6 판: U-210(na-core), U-237(p5a) | `src/cli/run.ts`, `doctor.ts`, `assemble.ts`, `plan-commands.ts`, `task.ts`, `unreadable.ts`(새), `human/output.ts`, `human/query-table.ts`, `src/app/assemble.ts`, `check-apply.ts`, `changes-plan.ts`, `app.ts`, 계약 | C-3b, C-4, C-5, C-6a, C-7a·b, C-10 | 병합 뒤 시작. 이 계획의 A6 판 수는 그 판의 것이다 |
| U-245(ne-verify), U-246(nc-human) | A6 판 위의 같은 CLI 파일과 `contracts/human.ts`, `query.ts`, `workflow.ts` | 위와 같음 | 병합 뒤 시작 |
| U-247(p5u-gui) | `src/app/index.ts`, `settings.ts`, `settings-change.ts`, `types.ts` | C-1(형 이동) | 병합 뒤 C-1 시작 |
| U-249(nb-i18n) | `src/i18n/en.ts`, `ko.ts` | 없음(글은 옮기지 않는다) | — |
| U-243·U-233의 사용자 질문(진행 줄과 렌더러 줄 접기) | 답에 따라 `progress.ts`, `run.ts`, `plan-commands.ts`, `human/*` | C-6a, C-7b | 답과 그 단위를 C-6a 전에 끝낸다 |

- C-3a, C-3b는 많은 파일의 import 줄을 고친다. 다른 단위가 그 파일을 동시에 고치면 충돌이 많다. 시작 전 "입력 층과 그 사용처를 고치는 열린 단위 없음"을 PM이 확인해 주면 좋다.
- 오래된 브랜치(`unit/U-8-p4g-general`, `unit/U-18-na-core`, `unit/U-65-p5u-gui-interim`, `unit/U-82-na-core` 등)는 main에 없는 커밋이 남아 있지만 진행 중으로 보이지 않는다. 상태는 PM이 확인한다.

## 8. PM에게 물을 것

- **Q-5:** C-4(조립을 앱으로)를 C-5(`prepareTask`) 앞에 둘지. 가정: 앞에 둔다. 조립은 닫힌 덩어리이고, 앱이 지금 CLI의 조립을 쓰는 거꾸로 된 의존을 가장 먼저 끊는다.
- **Q-6:** C-9b(`cleanup` 한 벌)에서 두 벌의 판정이 다르면 어떻게 할지. 가정: 이행을 멈추고 차이를 기능 단위로 돌린다. 이행에서는 CLI의 지금 출력이 기준이다.
- **Q-7:** C-6a의 끝 요약 수(6.3의 3): 이벤트로 셀 수 없는 수가 있으면 앱이 결과와 함께 주는 형을 계약(p4g)에 더할지. 가정: 더한다. 그 형 추가는 C-6a의 계약 확인 항목으로 보고한다.
- **Q-8:** 단계마다 판 비교 사례를 늘리는 일(5절 2)의 담당. 가정: 그 단계의 담당이 첫 커밋으로 한다. 도구 자체(`scripts/compare-cli/`)는 지금처럼 PM이 정한 담당이 고친다.
