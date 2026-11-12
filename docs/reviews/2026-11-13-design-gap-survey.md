# 설계 대조 조사 — 설계 문서와 지금 main (main `16e4b67`)

- 작성: w3:p7(nd-docs), 2026-11-13. 조사만 했다. 문서·코드는 고치지 않았고 커밋도 없다.
- 범위
  - 설계 문서: `docs/design/general-tasks.md`, `second-provider.md`(사실 문서 `second-provider-facts.md` 참고), `ux-design.md`, `usability-review.md`, `vscode-extension.md`(한 줄)
  - 그 밖의 문서: `docs/architecture.md`, `docs/roadmap.md`(단계 완료 기준)
  - 사용성 점검 두 문서: `docs/design/ux-midpoint-review.md`(UXM), `ax-midpoint-review.md`(AXM)
  - 지시대로 `standalone-gui.md`와 `adapter-contract.md`는 뺐다. GUI 쪽은 PM의 GUI 대조 조사서(`docs/reviews/2026-11-13-gui-design-gap-survey.md`, DR-63)가 따로 있다.
- 상태 낱말: **구현됨**(근거) / **일부** / **없음** / **설계가 낡음** / **확인 불가**(이 환경에서 확인할 수 없음: 실제 API, 다른 OS 등)

## 0. 방법과 기준 판

- 조사는 문서 갈래 다섯으로 나눠 동시에 읽었다(조사 보조 에이전트, 읽기 전용).
  - general-tasks
  - second-provider
  - architecture·roadmap
  - ux-design·usability-review·vscode
  - UXM·AXM
- 갈래가 읽은 판은 `86a9470`이다. 그 사이 main에 세 커밋이 들어왔다.
  - `604f9e5` U-36: plan·apply·review·changes의 본문과 터미널 질문을 카탈로그로
  - `123815a` CP-21: DR-58~DR-64, GUI 대조 조사서
  - `16e4b67` U-58: 사람이 읽는 영어에서 "workflow"를 task type으로
- 이 셋이 바꾸는 칸은 내가 `git show main:…`으로 다시 보고 아래 표에 고쳐 넣었다(7절).
- 근거는 코드, 시험 파일, 문서 절이다. 이번 조사에서는 시험과 CLI를 돌리지 않았다.
  - "구현됨"의 시험 근거는 그 시험이 무엇을 단언하는지 읽은 것까지다.
  - 실행해야만 알 수 있는 것은 "코드 기준"이라고 적었다.
- 갈래가 낸 근거 가운데 결과를 가르는 것은 내가 직접 다시 열어 확인했다(7절 목록).
- 갈래별 전체 표(행 단위): `.codaryn/gap/general-tasks.md`, `second-provider.md`, `ux-design.md`, `uxm-axm.md`. 아래는 줄인 표다. architecture·roadmap은 이 보고서에 다 실었다.

## 1. 한눈에

- **단계(roadmap):**
  - 충족: 0, 1a, 2(오프라인 몫), 4
  - 미충족: 1b, 2의 실 API 몫, 3. 셋 다 실제 API가 있어야 한다. 단계 2의 "연습 과제 묶음과 합격 기준"은 정의조차 없다.
  - 단계 5: GUI 어댑터는 있다(코드 기준). 실행 중 권한 확인(DR-3)이 없고, 앱 계층 이행이 덜 됐고, 패키징이 없다.
  - roadmap과 progress는 단계 4·5와 사용성을 아직 "코드 없음/시작 전"이라고 적는다.
- **설계 가운데 코드가 없는 큰 것:**
  - 실행 중 권한 확인(DR-3, GT-D9, 단계 5)
  - 범용 작업의 P1 묶음(`query_table`·표 스트리밍, `analyze-private`, 읽기 제외 경로, `plan:"run"`·`writablePaths`, `markdown` 규칙)
  - 앱 계층으로의 CLI 이행 2~5(AC-D16). `src/app/app.ts` 하나가 `../cli/`를 18번 import하고, CLI는 `changes`만 앱 계층을 거친다.
- **코드로 본 결함 후보(실행 확인 필요):**
  - GUI 창 언어가 설정 파일의 `language`를 쓰지 않는다. 엔진 호스트가 `selectMessageLanguage({ env, config: null, osLocale })`로 부른다(`gui/src/engine-host/main.ts:203`). 설정 화면은 "다시 시작하면 적용"이라고 말한다.
  - GUI만으로 openai를 설정하면 `providers.openai.maxOutputTokens`를 쓸 방법이 없어 `provider_not_configured`로 멈출 것이다(`gui/src/shared/settings-edit.ts:23-32`).
  - GUI 실행 목록에는 사람 확인을 기다리는 실행(`awaiting_review`)의 단추가 없다(`gui/src/renderer/runs/runs-screen.ts`에 `awaiting_review` 0곳, `plan_pending` 1곳). 앱을 다시 열면 GUI에서 판정할 길이 없다.
- **실제 API가 있어야 닫히는 것:**
  - 1b, 단계 2·3
  - OpenAI 사실 C-1~C-15. 특히 저장 없는 연속 요청에 `include: ["reasoning.encrypted_content"]`가 필요한지 — 틀리면 추론 모델의 둘째 요청부터 실패한다.
  - `tests/live/anthropic-live.ts`는 한 번도 실행되지 않았다. OpenAI 점검 스크립트는 아예 없다.
- **낡은 문서:**
  - architecture.md: 머리 상태 줄, 모듈 표, 명령 표, model·tools·verify·store 행
  - roadmap·progress
  - second-provider 9절 상태 칸
  - ux-design의 "[설계]" 표시들
  - general-tasks 1·2절
  - decisions의 GT-D "확인 대기", testing·unit-test-plan
  - cli-contract 1150줄과 18.9
  - **usage 16절, 내가 쓴 곳 둘:**
    - '출력 언어'가 U-36 뒤로 다시 낡았다. 지금은 승인 질문, plan·changes 머리가 한국어다.
    - "`help run`에 `--workflow`가 없다"는 U-53 뒤로 낡았다.
- **UXM·AXM:**
  - 높음 여섯 가운데 다섯이 닫혔다. 나머지 UXM-1은 핵심이 닫혔다.
  - 중간·낮음에서 열리거나 일부만 닫힌 것은 UXM 15개, AXM 14개다(4절).

## 2. 문서별 대조(줄인 표)

### 2.1 general-tasks.md

| 묶음 | 상태 | 근거 또는 빠진 것 |
| --- | --- | --- |
| 작업 종류 정의·해석, 내장 5개, 사용자 정의, 프로필·`--workflow`·`workflowRef`, 상한, 지시문, E1~E5 | 구현됨 | `src/workflows/index.ts:36-78`, `src/contracts/workflow.ts:289-301`, `g-resolve`·`g-workflows`·`g-workflow-engine`, 통합 n08 |
| 계획 제안·승인·적용·되돌리기(`propose_plan`, `inspect_files`, 다이제스트, `applied.json`, `plan_stale`, `apply_incomplete`, inventory, 보관함, 하드 링크 없는 볼륨의 동의) | 구현됨 | `src/tools/workflow-tools.ts`, `src/engine/apply.ts`, `src/store/apply-revert.ts`, n06, usage 18.2~18.5 |
| 사람 확인(`review`, `review.json`, report 판정, GUI 결과 화면) | 구현됨 | `src/cli/plan-commands.ts:773-830`, `src/store/review.ts`, n07 |
| `data_checks`·`inventory` 검증기, 형식 한계 | 구현됨 | `src/verify/`, `src/contracts/verify.ts:42-104` |
| 1·2절 현재 동작 표, 정책 "뒤 단계가 덮는다", `plan --workspace` 형식, `apply --events jsonl`, VS Code | 설계가 낡음 | E1~E5 뒤 사실이 아님. DR-41·DR-43(합침), DR-17, DR-20·DR-46 |
| 3.6·GT-D8 분석 원자료 고지 | 일부 | usage 18.7에만 있다. 정의의 설명, privacy, GUI 새 작업 화면에는 없다 |
| 5.2 `data_checks` 규칙 형식의 사용자 문서 | 일부 | cli-contract에 한 줄(911)뿐 |
| 5.3 `inspect_files` 해시 노출 확대를 privacy에(R-1 L-6) | 일부 | privacy 13절의 일반 문장(P-7)뿐 |
| GUI 실행 목록에서 사람 확인 | 일부 | 1절 결함 후보 |
| 10.2 GI-09(적용 중 `--cancel-file`), GI-10(인벤토리 상한) | 일부 | 유닛만 있고 프로세스 통합이 없다 |
| 11절 예시(`examples/workflows`) | 일부 | `examples/organize-demo`만 있다. 분석 예시와 사용자 정의 예시가 없다 |
| 13절 상한 실측 | 일부 | 4 GiB 계획 해시, `inspect_files` 64 MiB를 잰 기록이 없다 |
| GT-D14 빈 폴더는 남기고 결과에 알림 | 일부 | 남기기만 한다. 알림이 없다(`src/engine/apply.ts`에 해당 코드 없음, 확인함) |
| P1: `markdown` 규칙, `query_table`·스트리밍, `analyze-private`·읽기 제외 경로·그룹 최소 크기, `plan:"run"`·`writablePaths` | 없음 | 계약에 이름만 있거나 아예 없다 |
| 7.3·GT-D9 실행 중 권한 확인(DR-3) | 없음 | `src/app/types.ts:259-265` "the engine asks from the start of stage 5; until then RunObserver.confirm is never called"(확인함) |
| 7.1 네트워크 도구 조건, 13절 미정들(`remove_empty_dir`, 바이너리 문서 등) | 없음(의도) | 미정(O-10) |
| plan·apply·review 본문의 한국어 | 구현됨(main) | U-36 `604f9e5`. `plan.heading`, `apply.question` "이 계획을 적용할까요?"(확인함) |
| 실제 FAT·exFAT, 실제 두 볼륨(EXDEV), macOS·Linux 대소문자 | 확인 불가 | 시험은 주입한 오류뿐 |

### 2.2 second-provider.md

| 묶음 | 상태 | 근거 또는 빠진 것 |
| --- | --- | --- |
| 제공자 표와 파생 목록, 키 등록·가림, 주소 규칙, 오류 종류·할당량·Retry-After, 요청 형식, `store:false`, 추론 항목, 크기 상한, 도구 정의, call_id, 설정의 provider·providers·프로필·변수, doctor, models, SP-0 고정 시험 | 구현됨 | `src/model/openai/index.ts`, `src/model/http/index.ts`, `src/contracts/config.ts:418-516`, `adapter.test.ts`, o00~o05, `g-sp*`, `sp0-*` |
| SP-D9 openai `maxOutputTokensLimit` | 일부 | 상한이 자리 값 200000이고, 주석이 "PM이 정할 때까지"다(`config.ts:457-483`) |
| 키 안내·InitOutput의 provider, SP-D13·DR-46 init이 제공자를 묻는다 | 일부·없음 | init은 Anthropic만 다룬다(`src/cli/init.ts:161-162` `output.provider ?? "anthropic"`, 확인함). U-26 미병합 |
| 커밋 훅이 OpenAI 키를 잡음 | 일부 | `scripts/check-secrets.mjs`에 `sk-proj-` 꼴 규칙이 없고 `LIVE_ENV = ["ANTHROPIC_API_KEY"]`다(확인함) |
| 앱 계층 `providerFactories`, `ResolvedApiSettings.provider`, 공용 오류 분류 함수, 오류 본문 인용 | 일부(다르게 구현) | 동작은 설계와 같다. 받아들일지 PM 결정 |
| SP-U05 공용 전송 불변식을 OpenAI 경로에서도 시험 | 일부 | 리디렉션·시간 초과·연결 오류·성공 본문 상한, `run`의 401 통합이 OpenAI 쪽에 없다 |
| SP-U10 두 제공자가 받는 도구 스키마의 공통 부분 집합 | 없음 | 도구 이름 시험뿐 |
| `shutdown_date` 표시 여부 | 없음 | 결정이 없다 |
| SP-6 GUI 설정 | 일부 | 1절 결함 후보(출력 상한) |
| OpenAI가 앞 응답 항목을 가림 없이 다시 보냄 | 일부(한계로 적힘) | privacy 10절. 사용자 질문 대기 |
| SP-7 `tests/live/openai-live.ts`, 그 README | 없음 | `tests/live`에는 `anthropic-live.ts`와 README뿐(확인함) |
| usage 4절의 보존 사실(C-14) | 일부 | privacy 10절에만 있다 |
| 9절 상태 칸, "연결 전 anthropic이 아니면 models 거부", DR-36 (d) | 설계가 낡음 | SP-2~4가 병합됐다(`c20c51d`). SP-6과 DR-46이 대체했다 |
| 계약 주석 | 설계가 낡음 | `config.ts:6` "The key comes only from ANTHROPIC_API_KEY."(확인함), `model.ts:84, 100-103, 116, 122, 162-169` |
| cli-contract 1150, architecture 6절(M9·M10) | 일부·없음 | 없는 `PROVIDER_SETTING_ENVS`를 가리킨다. architecture는 OpenAI를 말하지 않는다 |
| C-1~C-15의 실제 동작 | 확인 불가 | 실제 OpenAI API가 필요하다 |

### 2.3 ux-design.md, usability-review.md, vscode-extension.md

| 묶음 | 상태 | 근거 또는 빠진 것 |
| --- | --- | --- |
| 원칙, 진행 줄, 끝 요약, 마지막 답, 오류 설명·진단, 상태 낱말, 되돌리기·정리·계획 확인, 언어 선택(CLI), 색 없이 뜻, 첫 사용 흐름(init·doctor·체험) | 구현됨 | `src/cli/human/output.ts`, `src/i18n/*`, n01~n07 |
| 3·4절의 "[설계]/[CLI 연결 전]" 표시(init, profile, 한 줄 실행, runs, latest, `--dry-run`, plan·apply·review, N-3, N-5 등) | 구현됨(표시 낡음) | 위와 같다 |
| VS Code 열, 4.5·4.6·7·8절의 VS Code 항목, UX-D1, vscode-extension.md 전체 | 설계가 낡음 | DR-20. `vscode/src/core/**`와 `tests/unit/vscode/**`가 남아 있다(정리 여부 미정) |
| 4.3 [제안] 가릴 값 이름과 설정 여부 | 일부 | GUI에는 있다. CLI doctor에 secretEnv 점검이 없다 |
| 4.4·7 Git도 사본도 아닌 작업 공간 경고, 넓은 폴더 경고 | 없음 | |
| 4.6·7 실행 중 권한 확인 | 없음 | DR-3 |
| 4.7 다음 명령에 실제 경로 | 일부 | U-38(DR-51, DR-60) 미병합 |
| 4.7·4.9 GUI의 기록 탭, "폴더에서 보기", 오류 카드의 이동 단추, 엔진 쪽 오류 카드 | 일부 | GUI 조사서와 겹칠 수 있다(DR-63) |
| 5 용어 | 일부 | 내장 작업 종류의 표시 이름이 없다(id 그대로). CLI 보고서의 보호 대상 절에 "사후 탐지"가 없다 |
| 8 언어 선택 순서 | 일부 | 1절 결함 후보(GUI) |
| 8 한국어에 남은 영어 | 일부(main) | U-36 뒤 남은 것: `report` Markdown, `models` 표(재지 못함), 사용법 줄과 옵션 이름 |
| 8 줄 너비 100자 | 일부 | 정책 축소 알림이 한 줄 229자. 한국어 doctor 표는 `padEnd`로 글자 수를 세서 열이 어긋난다(`src/cli/doctor.ts`, 확인함) |
| 8 키보드·낭독기·WCAG 2.2 AA | 일부 / 확인 불가 | aria-live, F6 등은 있다. AA는 사람 점검이 필요하다 |
| 9 독립 앱 | 일부 | 설치 패키지와 코드 서명이 없다(GU-9) |
| UX-D2(어댑터가 한 계약) | 일부 | CLI는 `changes`만 앱 계층을 거친다 |
| UX-D5 | 일부 | N-4(GUI 언어), N-10(doctor의 키 등록 안내) |
| usability-review R-4·A7 키 없음 안내 | 일부 | `doctor.api_key.missing`에 등록 명령이 없다 |
| R-7·A11 설정 오류를 한 번에 | 일부 | 진단 하나만 보고한다(N-6이 채택하지 않음) |
| R-8 task 작성 | 일부 | `codaryn task new`가 없고 결정도 없다 |
| R-16 기록 정리 | 설계가 낡음 | `cleanup`(DR-39·44·53) |
| A12·D-5 실행 중 권한 확인 | 없음 | DR-3 |

### 2.4 architecture.md

| 항목 | 상태 | 근거 또는 빠진 것 |
| --- | --- | --- |
| 머리 상태 줄(main `1d23dda`, "CLI 연결 아직", "단계 4·5 코드 없음") | 설계가 낡음 | 그 뒤 사용성 CLI, 범용 작업, 앱 계층, GUI가 병합됐다 |
| §1 TS 엄격·ESM·실행 의존성 0, 공통 엔진이 Git·테스트를 전제하지 않음, 통과의 뜻 | 구현됨 | tsconfig, package.json, a02, `cli/report.ts:486` |
| §1 DR-8 조건, 엔진 전용 프로세스, vscode/ 매니페스트, gui/ 배치, "CLI만 구현" | 설계가 낡음 | DR-20·DR-26, `gui/src/engine-host/` |
| §1 실행 준비를 src/app으로(AC-D1, 이행 1~7) | 일부 | `src/app` 있음. `app.ts`가 `../cli/`를 18번 import(확인함). CLI `run`은 앱 계층을 거치지 않는다 |
| §2 모듈 표(11개+예정 3), cli·model·tools·verify·store·app·i18n·workflows·tabular 행 | 설계가 낡음 | `src/`에 14개. openai, `model/http`, 새 도구·검증기·store 파일, 연결된 명령들이 빠졌다 |
| §2 다른 모듈은 index.ts로만 | 일부 | 깊은 import가 있다(app→cli 등) |
| §2 의존 방향 "이행 뒤" | 일부 | app→cli 역방향 |
| §3 단계 0 계약, 권한별 검사, 허용·거부 판정, 범용 작업 계약 | 구현됨 | `src/contracts/*` |
| §3 `src/contracts/app.ts` | 일부 | 타입은 `src/app/types.ts`에 있다 |
| §3 AC-D3 `Journal.append`가 저장한 레코드를 돌려줌 | 없음 | `append(event: JournalEvent): Promise<void>`(확인함) |
| §3 confirmation 사건, `ask` 판정 | 없음 | DR-3(단계 5) |
| §3·§4.4 plan_proposed 등 사건, R-1 뒤 추가분, 파괴적 동작 "결정만", N-A "연결 아직" | 설계가 낡음 | 두지 않기로 함 / 구현됨 |
| §4.1~4.3 실행 전 단계, 조립, 엔진 흐름 | 구현됨 | `cli/run.ts`, `cli/assemble.ts`, `engine/index.ts`. 문서에 DR-38·47·52, 모든 제공자 키 등록, `app/assemble.ts`가 없다 |
| §4.3 "stdout은 항상 JSON 한 줄" | 설계가 낡음 | DR-49·DR-56(U-23, U-45) |
| §4.4 앱 계층의 startRun·이벤트·취소·계획 승인 | 일부 | 앱 쪽은 구현됨. CLI는 거치지 않는다 |
| §4.4 줄 프로토콜 `--events jsonl --confirm stdio` | 설계가 낡음 | DR-20. `src/cli/protocol/*`는 `main.ts`에 연결되지 않는다(`protocol` 0회, 확인함) |
| §4.4 `plan.json`은 행동과 해시만(DR-5), 적용 취소 끝 상태 [미정] | 설계가 낡음 | DR-28의 `shown`. GT-U15로 정함 |
| §5 명령 표, doctor 12개, init·runs·latest·`--dry-run`·profile·한 줄 실행·workflow·plan·apply·review "결정만/계약만", changes·cleanup 누락, 상태 디렉터리 배치 | 설계가 낡음 | 모두 구현됨. doctor는 14개 |
| §6 Anthropic 연결(fetch, 헤더, 리디렉션, 응답·시간·재시도·키 규칙, 대본 제공자) | 구현됨 | `model/anthropic`, `model/http`, `transport.test.ts` |
| §6 두 번째 제공자 | 설계가 낡음(누락) | DR-31 |
| §6 실제 API에서의 동작 | 확인 불가 | |
| §7 문맥 상한, write_file 해시·스냅샷, 민감정보 게이트, 명령 실행기, 보호 경로 | 구현됨 | |
| §7 단계 4 이동·폐기, 어댑터 결정, 분석 개인정보 "Q-4 대기" | 설계가 낡음 | 구현됨. AC-D15·DR-15·DR-23으로 정함 |
| §7 긴 대화 압축, OS 격리 | 없음(미정) | |
| §8 설치 위치 거부, 후보 스크립트, 무결성 확인, 사람이 채택 | 구현됨 | `run.ts:648-656`, `new-candidate.test.ts`, k01 |
| §8 실제 모델로 자기 소스 개발 | 확인 불가 | k03은 대본 예행뿐 |
| §9 journal·충돌·취소, 적용 취소 | 구현됨 | a03, a08, p01 |
| §9 잠금 pid 재배정 한계, §11 A-6 | 설계가 낡음 | N-25(b) `processStartedAt` |
| §9 모든 취소가 handle.cancel로 | 일부 | 앱 계층·GUI만 그렇다 |
| §10 범용 계약·GUI "구현 없음" | 설계가 낡음 | n06·n07, `gui/` |
| §11 A-1 키 형식 검사를 실행 전으로 | 없음 | 여전히 제공자 안 |
| §11 A-2 무결성 run_end, A-3 계약 주석 | 없음 | `contracts/integrity.ts` |
| §11 A-4 workspace-id 헤더 | 확인 불가 | |
| §11 A-5 스냅샷 수명 | 일부 | cleanup은 있다. report·doctor의 크기·위치 안내가 없다 |

## 3. 단계별 완료 기준(roadmap.md)

| 단계 | 완료 기준 | 충족 | 근거 |
| --- | --- | --- | --- |
| 0 | 문서 충돌 해결, 확정·선택·미정 구분, 단계 1 범위, 유닛 우선순위 | 충족(당시 기준) | roadmap 20-26, unit-test-plan |
| 1a | 코드·문서 작업이 모의 모델로 끝까지 | 충족 | a01, a02 |
| 1a | 문서 작업이 Git·테스트 없이 | 충족 | a02 |
| 1a | 루트 밖·목록 밖·파괴적 동작 거부(네트워크는 "도구 없음"만) | 충족 | a04, a05 |
| 1a | 가린 뒤 기록, 허용 밖 필드 복원 안 함, 복원 뒤 재검사 | 충족 | a06, a07, r01 |
| 1a | 읽은 뒤 바뀐 파일은 덮어쓰지 않음, 검증 실패면 failed | 충족 | a03, a09 |
| 1a | 키·모델이 없으면 호출 없이 거부 | 충족 | a09-a10 |
| 1b | 1a의 두 작업을 실제 API로 실행해 기록 | **미충족·확인 불가** | `tests/live/anthropic-live.ts`는 문서 작업 하나뿐이고 실행된 적이 없다 |
| 2 | 오프라인: 실패 → 재수정 → 통과, 한도로 중단 | 충족 | p01 F5-a, F5-b |
| 2 | 실 API 연습 과제 묶음(과제 수·합격 기준은 testing.md에서) | **미충족, 정의도 없음** | testing.md 4절 |
| 2 | 한도·취소·명령 시간 초과의 끝 상태 | 충족(오프라인) | a08, p01 |
| 2 | 보호 경로로 테스트·검증 설정 보호 | 충족 | p03 |
| 2 | 보고서가 "지정한 테스트 통과"만 말함 | 충족 | `cli/report.ts:486` |
| 3 | 입력: 단계 2 실 API를 통과한 실행본 | **미충족** | 실 API 미수행 |
| 3 | 실행본·검증기·정책 쓰기 거부, 보호 대상이 바뀌면 검증 무효 | 충족(오프라인) | p03, k01, k02 |
| 3 | 과제 하나 이상에서 후보 → 보호된 검증 → 보고서 | 일부 | k03 대본 예행만 |
| 3 | 채택·반려를 Codex가 결정·기록, 과제별 한도 값 | **미충족·일부** | 실제 후보가 없다. 한도 기구만 있다 |
| 4 | 문서·정리·분석 작업 종류, 실행 전 계획 확인 | 충족 | `workflows/index.ts`, n06, n07 |
| 4 | 네트워크·파괴적 동작의 확인·기록 절차 | 일부 | 파괴적 동작은 항목마다 기록한다. 네트워크 도구는 설계상 없다. 실행 중 확인(ask)이 없다 |
| 4 | 엔진 변경 없이 작업 종류 추가 | 충족 | n08 GI-01 |
| 4 | 계획 확인 없이 이동·삭제하지 않음 | 충족 | n06 GI-03, GI-04 |
| 4 | 자동 검증이 없으면 "검증 없음" 또는 사람 확인 | 충족 | n08 GI-08, n07 GI-06 |
| 4 | P1 다음 묶음 | 없음 | 2.1 |
| 5 | 입력: 어댑터 경계가 지켜진 엔진 | 일부 | 엔진은 contracts만 쓴다. app→cli 역방향, 이행 2~5 미완 |
| 5 | 입력: GUI 형태·지원 OS 결정 | 충족 | DR-20, DR-26 |
| 5 | GUI 어댑터 | 충족(코드 기준) | `gui/`. 패키징·서명 없음 |
| 5 | VS Code 어댑터 | 설계가 낡음 | DR-20 |
| 5 | 어댑터가 CLI와 같은 엔진·정책·기록 | 일부 | GUI는 앱 계층 안의 CLI 함수를 쓴다. CLI와 비교하는 계약 층 시험이 없다 |
| 5 | 어댑터에 작업 논리 없음 | 충족(코드 기준) | `gui/src/engine-host/host.ts` |
| 5 | 확인 질문과 취소가 CLI와 같은 뜻 | 일부 | 취소는 같다. 확인 질문은 어디에도 없다 |
| 사용성 | 키 없이 타입 검사·유닛·통합 전체 통과 | 코드 기준 | 이번 조사에서는 재지 않았다. 내 마지막 측정은 U-56 판(main `4010905` + 문서)의 유닛 2549개 중 2545 통과, 통합 559개 중 559 통과다. pm-status의 마지막 기록은 CP-20 `a191a50`이다 |
| 사용성 | 문서만 보고 init → doctor → 체험 → report → revert | 충족(시험 기준) | n01, n02 |
| 사용성 | 교차 검토 한 번 | 충족 | docs/reviews |

- roadmap·progress 서술:
  - 0~3은 맞다. 다만 1b live 점검이 두 작업 가운데 하나만 다룬다는 점은 어디에도 적혀 있지 않다.
  - 4·5와 사용성은 틀렸다. "코드 없음", "시작 전", "VS Code 먼저"라고 적혀 있다.
  - progress의 기준판은 `39219c8`이고, 그 "남은 문제" 가운데 이미 해소된 것들이 있다.

## 4. UXM·AXM에서 열린 것(main `16e4b67`)

- 닫힘(단위):
  - UXM-3(U-17), 12(U-20, U-27), 14(U-20, U-32, U-48), 17(U-23, U-45), 19(U-17), 24(U-20, U-32, U-44), 25(U-31)
  - AXM-1(U-21), 2(U-14, U-32), 3(U-22), 5(U-15), 6(U-15, U-50), 7(U-15), 14(U-17), 22(U-34)
- 하지 않기로 함: AXM-13의 이벤트 연결(DR-46·DR-20). 최소안은 아래에 남겼다.
- 열림·일부 닫힘(심각도는 문서 그대로):

| id | 심각도 | 상태 | 닫은 몫 | 남은 것(코드 기준) |
| --- | --- | --- | --- | --- |
| UXM-1 | 높음 | 일부(핵심 닫힘) | U-13, DR-53 | 요약에 "기록 없는 보관함 N개"가 없다 |
| UXM-2 | 중간 | 일부 | U-19 | 사람용 이유 줄(U-37 진행 중) |
| UXM-4 | 중간 | 일부 | U-16, U-36(한국어) | `runs`의 열 이름이 적용 실행에서도 "변경" |
| UXM-5 | 중간 | 일부 | U-16 | 적용 실행 줄이 어느 계획인지 말하지 않음. GUI 목록 |
| UXM-6 | 중간 | 일부 | U-14 | `revert` 사람용 글에 기록 변경 표시가 없음(`revert.records_changed`를 쓰지 않음). `.codaryn`을 바꾼 주체를 살피라는 안내 |
| UXM-7 | 중간 | 일부 | U-34, U-35, U-36 | `report` Markdown, `models` 표 |
| UXM-8 | 중간 | 열림 | (U-38 진행 중, DR-60) | 경로 말고도 `<task.json>`, `<다이제스트>`, `changes` 줄 |
| UXM-9 | 중간 | 일부 | U-23 | `--help` 위층 안내, doctor의 "다음:" 줄, 한도 실패 줄의 init 안내 |
| UXM-10 | 중간 | 일부 | U-22, U-34 | 미리보기의 세 묶음, 예시 명령, 경고를 한 줄씩 |
| UXM-11 | 중간 | 열림 | (U-26 진행 중) | init의 제공자 질문, `models --use`가 provider를 바꾸지 않음 |
| UXM-13 | 중간 | 일부 | U-11, U-27 | GUI의 키 등록 방법 안내 |
| UXM-15 | 중간 | 일부 | U-16 | 다른 형식 알림이 시작 줄과 승인 질문 앞에는 없다 |
| UXM-16 | 중간 | 일부 | U-24, U-28, U-58 | GUI "실패" / CLI "미통과" |
| UXM-18 | 낮음 | 열림 | — | 정책 축소 알림이 시작 줄에 붙음, "보호 대상 확인" 반복, `runs` 표시 줄 |
| UXM-20 | 낮음 | 일부 | U-53 | 사용법 묶음에 `changes`·`cleanup`이 없음, 한국어 doctor 표의 열(`padEnd`) |
| UXM-21 | 낮음 | 열림 | (U-57 진행 중) | `revert.dry_run_next` "되돌리려면 --dry-run 없이 다시 실행하세요." 그대로(확인함) |
| UXM-22 | 낮음 | 열림 | — | `error.plan_already_applied.fix` 그대로(확인함) |
| UXM-23 | 낮음 | 일부 | U-36(plan의 `Applied by`, DR-59) | `report`·`runs`의 UTC 안내 |
| AXM-4 | 중간 | 일부 | U-18, DR-58 | 요약의 코드별 내역(`report --json` 개수는 하지 않기로 함) |
| AXM-8 | 중간 | 일부 | U-22 | `runs`에 `phase`가 없다 |
| AXM-9 | 중간 | 열림 | (U-55 진행 중, DR-61) | `retryable`·`category` 없음(계약에 0회, 확인함) |
| AXM-10 | 중간 | 열림 | — | 맡기기 전 권한 요약 |
| AXM-11 | 중간 | 열림 | — | 오류 코드 표 한 곳, 안정성 약속 |
| AXM-12 | 중간 | 일부 | U-22 | `review`·`changes`의 status, 필드 규칙 |
| AXM-13 | 중간 | 하지 않기로 함 / 최소안 열림 | DR-46 | 시작 줄 runId, `src/cli/protocol` 머리말의 "connect it" |
| AXM-15 | 중간 | 일부 | U-14, U-32 | 계획 실행의 끝 요약에 요약(summary)이 없다 |
| AXM-16 | 중간 | 일부 | U-15 | organize 지시문에 "summary에 이유를" 지시가 없다 |
| AXM-17 | 중간 | 일부 | U-25, U-39, U-40 | `report` 본문의 가림 줄, 등록 0개일 때, "Not checked"의 가림 한계 |
| AXM-18 | 낮음 | 열림 | (U-37 진행 중) | 무엇이 틀렸는지 |
| AXM-19 | 낮음 | 열림 | — | `--version --json`, `--goal-file` |
| AXM-20 | 낮음 | 열림 | — | 진행 줄의 대상, 반복 |
| AXM-21 | 낮음 | 일부 | U-14 | `plan_run_missing` 힌트, 설정 없음을 invalid_value로, 판정 뒤 "waits for verdict", `runs`에 review 필드 |

## 5. 단위 제안(갈래들의 제안을 합치고 겹침을 뺐다)

### 5.1 이미 진행 중(미병합)

U-26(init 제공자, UXM-11) · U-37(사람용 오류 이유, UXM-2·AXM-18) · U-38(다음 명령의 경로, DR-60) · U-55(AXM-9, DR-61) · U-57(UXM-21) · U-60~U-70(GUI, DR-63)

### 5.2 결정이 먼저인 것(PM 또는 사용자)

| 무엇 | 누가 | 메모 |
| --- | --- | --- |
| OpenAI가 다시 보내는 앞 응답 항목의 가림: 한계로 받아들일지, 가릴지 | 사용자 | 가리면 실제 API가 그 항목을 받는지 확인해야 한다 |
| openai `maxOutputTokensLimit`의 값 | PM | 지금은 자리 값 200000 |
| `shutdown_date`를 보일지 | PM | |
| second-provider의 다르게 구현한 네 곳을 받아들일지(provider 필드, 공용 분류, 앱 `providerFactories`, `error.message` 인용) | PM | 문서만 고치면 된다 |
| 설정·task 오류를 모아서 보고할지 | PM | N-6이 채택하지 않았다 |
| `codaryn task new`를 둘지 | PM | 권고: 두지 않음 |
| doctor가 가릴 값 변수의 이름을 보여도 되는지(N-14 예외) | PM | |
| `src/cli/protocol`과 `vscode/src/core`의 잔재를 지울지 | PM | |
| 문맥 압축, OS 격리, `remove_empty_dir`, 바이너리 문서, 네트워크 도구(O-10) | PM | 모두 미정 |
| GUI 패키징(GU-9: 새 의존성과 내려받기) | 사용자 | DR-63도 사용자 승인 사항으로 둔다 |
| 단계 3의 과제별 한도 값, 단계 2 연습 과제 묶음과 합격 기준 | PM | 실 API 점검 전에 |

### 5.3 코드 단위(결정 하나 = 단위 하나)

| 단위 | 담당 | 크기 | 끝났다는 증거 |
| --- | --- | --- | --- |
| C-1 실행 중 권한 확인(DR-3): `ask` 판정, `EngineDeps.confirm`, 답 뒤 재판정, `confirmation_*` 사건, 대기 시간을 한도에 포함 → CLI 터미널 질문 → GUI 대화상자 | contracts·policy·engine·store, 그다음 CLI, GUI | L(둘~셋으로 나눔) | task 파일 규칙은 묻지 못한다. 묻지 못하면 `by:"default"`로 거부한다. 대기 중에도 `max_duration`이 적용된다 |
| C-2 앱 계층 이행 2~5(run → 진행·취소 → report·revert·runs → doctor·models), 그 뒤 깊은 import 금지 시험, `contracts/app.ts`, AC-D3 | app·cli | L(넷으로 나눔) | `src/app`에서 `../cli/` import 0건. sp0와 통합 고정 출력이 그대로 |
| C-3 GUI 창 언어가 설정 `language`를 따름 | GUI(engine-host) | S | OS en, 설정 ko → ko. `CODARYN_LANG`이 이긴다. 먼저 실행으로 결함인지 확인 |
| C-4 GUI 실행 목록에서 사람 확인 | GUI | S~M | 앱을 다시 연 뒤 목록에서 판정하면 보고서에 판정이 보인다(GUI 조사서와 대조) |
| C-5 GUI에서 고른 제공자의 출력 상한 쓰기 | GUI·app | M | openai만으로 설정 → 루프백 가짜 서버로 doctor 통과 |
| C-6 빈 폴더 알림(GT-D14) | contracts·engine·i18n·CLI | S | 폴더 하나를 비우는 계획의 알림 1개 시험 |
| C-7 OpenAI 경로의 전송 불변식 시험(SP-U05, run 401) | 제공자·통합 | S | 3xx를 따르지 않음, 시간 초과·연결 오류 재시도, 8 MiB 상한, `run` 401 |
| C-8 커밋 훅이 OpenAI 키를 잡음 | PM(스크립트) | S | 규칙과 `LIVE_ENV` 추가. 시험 표본은 실행 중에 조립 |
| C-9 도구 스키마 공통 부분 집합을 계약으로(SP-U10) | 계약 | S | 정의를 훑는 시험 |
| C-10 doctor: 키 등록 명령 안내(N-10) | CLI·i18n | S | 두 OS 경우 |
| C-11 doctor: 가릴 값 점검(5.2 결정 뒤) | contracts·CLI·i18n | S | 값은 나오지 않음 |
| C-12 키 형식 검사를 실행 전과 doctor로(A-1) | cli/security·doctor | S | 형식이 틀린 키 → 오류 JSON, `.codaryn/runs` 안 생김 |
| C-13 무결성 run_end(A-2), 계약 주석(A-3) | contracts·engine | S | |
| C-14 Git 아닌 작업 공간 경고, 넓은 폴더 경고 | contracts·CLI·i18n·GUI | M, S~M | 막지 않고 알림 |
| C-15 내장 작업 종류의 표시 이름 | i18n·GUI·CLI | S | JSON은 그대로 |
| C-16 `report` Markdown 한국어(+ 보호 대상 절 "사후 탐지"), `models` 표 한국어 | contracts·i18n·CLI | L(절마다), S | DR-57 순서 |
| C-17 표시 폭 정렬(한국어 doctor 표)과 긴 알림 나누기, 진행 줄 정리(UXM-18, AXM-20, AXM-4 내역) | CLI human | S, M | 고정 값이 넓게 바뀌므로 PM 승인 |
| C-18 정리 미리보기 다시 짜기(UXM-10, UXM-1 나머지) | CLI·store·i18n | M | |
| C-19 계획↔적용 표시 마무리(UXM-5·4·15) | CLI·GUI·app | M | |
| C-20 상황별 고치는 법(UXM-6 나머지, UXM-22, AXM-21) | i18n·CLI | S~M | U-37 뒤 |
| C-21 판정 반영(AXM-21의 보고서·runs) | CLI·store·GUI | S | |
| C-22 CLI 첫 시작 안내(UXM-9) | CLI help·doctor | M | |
| C-23 GUI 키 등록 안내(UXM-13) | GUI | S | |
| C-24 맡기기 전 권한 요약(AXM-10) | CLI·contracts·GUI | M~L | |
| C-25 가림 보고 마무리(AXM-17) | CLI report | S | 보안 검토 |
| C-26 기계용 계약 한 곳(AXM-11·12) | 계약 문서·contracts | M | U-55 뒤 |
| C-27 `runs`의 phase(AXM-8) | contracts·store·app·GUI | M | 더하기만 |
| C-28 계획 실행의 설명(AXM-15·16) | engine·CLI | S~M | 고정 값 승인 |
| C-29 `--version --json`, `--goal-file`(AXM-19) | CLI | M | |
| C-30 시각 표기(UXM-23 나머지), 용어(UXM-16 나머지), 다음 명령 마무리(UXM-8, U-38 뒤), `models --use`의 provider(UXM-11, U-26 뒤) | CLI·GUI | 각 S | |
| C-31 GI-09 통합 사례, GI-10 결정, 상한 실측(4 GiB 해시, `inspect_files` 64 MiB) | tests | M, S, S | |
| C-32 GUI 계약 층 시험(같은 대본을 CLI와 엔진 호스트로) | 검증 | M | |
| C-33 P1 묶음: `query_table`·스트리밍, 읽기 제외 경로, `analyze-private`, `plan:"run"`·`writablePaths`, `markdown` 규칙 | 범용 작업 | L·M·S·L·S | 값은 PM이 먼저 정함 |

### 5.4 실제 API가 필요한 점검(스크립트는 이 환경에서 만들고, 실행은 사용자)

- A-1 OpenAI 실제 점검 스크립트 `tests/live/openai-live.ts`와 README 절차
  - 변수가 없으면 건너뛴다.
  - 1순위 확인: 도구 호출 → 결과 → `done`. 저장 없는 연속 요청에서 추론 항목을 다시 보내도 받는지다.
- A-2 1b 점검에 코드 작업을 더한다. 지금은 문서 작업 하나뿐이다.
- A-3 단계 2의 연습 과제 묶음과 합격 기준(5.2 결정 뒤), 단계 3의 실제 후보 예행 지시서
- A-4 사용자가 `tests/live/anthropic-live.ts`를 처음 실행한다. 실행된 적이 한 번도 없다.

### 5.5 문서 단위

| 단위 | 대상 | 담당 |
| --- | --- | --- |
| D-1 architecture.md를 지금 main에 맞춰 다시 씀(2.4의 낡은 행 전부, OpenAI와 `model/http`, 명령 표, 상태 디렉터리) | architecture.md | 소유자 |
| D-2 roadmap·progress 갱신, 지금 main의 실측 수치(GUI 시험·연기 시험 포함, 판 해시 적음) | roadmap.md, progress.md | PM·문서 |
| D-3 usage 다시 맞춤: 16절 '출력 언어'(U-36 뒤 다시 잼), 16절 UXM-20 줄(U-53 뒤 `help run` `--workflow`와 DR-59의 사용법 줄 `[--json]`), 4절의 C-14 | usage.md | 나(w3:p7) |
| D-4 privacy의 범용 작업 몫: 분석 원자료 노출(GT-D8), `plan.json`·보관함이 로컬 원문, `inspect_files` 해시 확대(R-1 L-6) | privacy.md | 나 |
| D-5 `data_checks` 규칙 형식(usage 18.6과 cli-contract) | usage(나), cli-contract(na-core) | |
| D-6 분석 예시와 사용자 정의 작업 종류 예시(`examples/analyze-demo` 등) | examples, usage | |
| D-7 설계 문서의 표시 정리: second-provider 9절, ux-design "[설계]" 표시, general-tasks 1·2절, decisions GT-D "확인 대기", testing 8절, unit-test-plan, cli-contract 1150·18.9 | 각 소유자 | |
| D-8 계약 주석의 낡은 곳: `config.ts:6`, `model.ts`의 여러 줄 | 계약(na-core) | |
| D-9 AGENTS.md "현재 개발 순서" 5번의 "GUI와 VS Code 연동"이 DR-20과 어긋남 | 사용자 확인 | |

## 6. 이 환경에서 확인할 수 없는 것

- 실제 Anthropic·OpenAI API의 모든 것
  - C-1~C-15, 503 분류, Retry-After, thinking, anthropic-version, workspace-id
  - 도구 스키마 수락, 모델 목록
  - 1b·2·3 단계의 실 API 몫
- 다른 OS: macOS·Linux의 XDG 위치, OS 언어 판정, `/proc` 시작 시각, POSIX 프로세스 그룹, 대소문자를 가리는 경로
- 실제 FAT32·exFAT 드라이브(DR-21·DR-25), 실제 두 볼륨의 `EXDEV`
- GUI를 띄워야 아는 것
  - 대화상자 기본 단추와 포커스, 낭독기 알림, 창 언어
  - 1절의 결함 후보 셋도 코드로만 봤다.
- 사람의 점검: WCAG 2.2 AA, 고대비, 200% 확대
- OS 격리 수준의 보장: 분리된 자손 프로세스, 자식의 파일·네트워크 접근
- 큰 상한의 시간(4 GiB, 10만 파일), 좁은 터미널의 줄 접힘
- 시험 통과 여부: 이번 조사는 실행하지 않았다(3절의 마지막 측정 참고).

## 7. 내가 다시 확인한 근거와, 86a9470 뒤에 바뀐 칸

- **직접 열어 확인한 것(main `16e4b67`):**
  - 커밋 훅:
    - `scripts/check-secrets.mjs`에 `sk-proj-` 꼴 규칙이 없다(`generic-sk-key`는 `sk-` 뒤 영숫자 32자 이상).
    - `LIVE_ENV = ["ANTHROPIC_API_KEY"]`다.
  - 실제 점검 스크립트: `tests/live`에는 `anthropic-live.ts`와 `README.md`뿐이다.
  - 계약과 init의 주석·코드:
    - `src/cli/init.ts:161-162` `API_PROVIDERS[output.provider ?? "anthropic"]`
    - `src/contracts/config.ts:6` "The key comes only from ANTHROPIC_API_KEY."
  - GUI:
    - `gui/src/engine-host/main.ts:203` `selectMessageLanguage({ env: …, config: null, osLocale })`
    - 창 언어는 이 `texts()`가 정한다(`gui/src/renderer/app.ts:30-31`).
    - `gui/src/renderer/runs/runs-screen.ts`에는 `awaiting_review`가 0곳, `plan_pending`이 1곳이다.
  - 실행 중 권한 확인: `src/app/types.ts:259-265` "the engine asks from the start of stage 5; until then RunObserver.confirm is never called"
  - 앱 계층 이행:
    - `src/contracts/journal.ts` `append(event: JournalEvent): Promise<void>`
    - `src/app/app.ts`의 `from "../cli/` 18회
    - `src/cli/main.ts`의 `protocol` 0회
  - 아직 그대로인 문구:
    - 한국어 `error.plan_already_applied.fix` "결과는 codaryn report로 보고, 되돌리려면 codaryn revert를 쓰세요."
    - `revert.dry_run_next` "되돌리려면 --dry-run 없이 다시 실행하세요."
    - `src/cli/doctor.ts`의 표 줄이 `padEnd`로 글자 수를 센다.
  - 아직 없는 것:
    - `src/contracts/engine.ts`에 `retryable`이 0회다.
    - `src/engine/apply.ts`에 빈 폴더 알림이 없다.
  - `src/cli/help.ts:87` run 옵션에 `workflow`가 있다(U-53).
- **86a9470 뒤 바뀐 칸:**
  - U-36: `plan.heading` "실행 {runId}의 계획: …", `apply.question` "이 계획을 적용할까요?", `changes.heading` 한국어. 그래서 plan·apply·review·changes 본문과 승인 질문의 "남은 영어" 행은 닫힘으로 바꿨다. UXM-7에 남은 것은 report와 models다.
  - U-58: `src/cli/report.ts`에 `(workflow ` 0회, `task type` 1회. 그래서 UXM-16의 CLI 몫은 닫힘으로 바꿨다.
  - CP-21의 결정:
    - DR-60(경로는 허용 목록, `revert`는 늘 자리표시). R-70의 M-1·L-1에 대한 답이다.
    - DR-61(AXM-9를 U-55로)
    - DR-63(GUI는 U-60~U-70의 순서로)
  - 이 결정들은 5.1에 반영했다.
- 갈래들은 모두 읽기 전용으로 일했다. 파일을 만들거나 고친 것은 없다(내 `.codaryn/gap/*.md`와 이 보고서만 내가 썼다).

## 8. PM 판단 필요

- **P-1:** 1절의 GUI 결함 후보 셋(창 언어, openai 출력 상한, 실행 목록의 사람 확인)이 GUI 조사서(DR-63, U-60~U-70)에 이미 들어 있는지 대조해 주세요. 없으면 C-3~C-5로 나눕니다. C-3은 먼저 실행으로 결함인지 확인해야 합니다.
- **P-2:** 내 usage 문서의 두 곳이 U-36·U-53 뒤로 다시 낡았습니다. D-3을 다음 문서 단위로 할지 정해 주세요.
- **P-3:** 단계 1b·2·3은 실제 API 없이는 닫히지 않습니다. 5.4의 스크립트 준비(A-1, A-2)를 먼저 할지, 사용자에게 `anthropic-live` 실행부터 부탁할지 정해 주세요.
- **P-4:** C-1(DR-3)과 C-2(앱 계층 이행)는 L 크기라 나눠야 합니다. 어느 쪽을 먼저 할지 정해 주세요. 단계 5의 완료 기준은 둘 다에 걸려 있습니다.
