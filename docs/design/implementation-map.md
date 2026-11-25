# 구현 위치표

## 현재 위치 보완 (2026-11-15, CP53; C11 기준 CP51)

현재 상태는 [최신 CP53](../pm-status.md)과 [어댑터 계약 7.2절](adapter-contract.md)이 기준이다. 아래는 전체 위치표를 다시 측정한 목록이 아니라, `b55ef4a`에서 확인한 공통 core와 models의 보완이다.

| 대상 | 현재 구현 위치 | 확인 근거 |
| --- | --- | --- |
| 모델 목록·선택 | [app/models-command.ts](../../src/app/models-command.ts), CLI와 앱이 같은 core 사용 | [y01-models](../../tests/integration/y01-models.test.ts): 목록·선택·키 없음·모의 API. 실제 API는 미실행 |
| 실행·조립·적용 수명 | [app/run-life.ts](../../src/app/run-life.ts), [app/assembly.ts](../../src/app/assembly.ts), [app/apply-life.ts](../../src/app/apply-life.ts) | [c01-cli-app-contract](../../tests/integration/c01-cli-app-contract.test.ts): 실제 CLI↔인프로세스 앱 결과·기록·거부·취소 |
| 보고서 읽기와 표시 | [app/report-read.ts](../../src/app/report-read.ts), [presentation/json.ts](../../src/presentation/json.ts), [presentation/report.ts](../../src/presentation/report.ts) | [공개 renderer 회귀](../../tests/unit/presentation/report.test.ts), CP50·CP51. 기존 CLI binding·형 유지 |
| 점검·초기 설정 | [app/doctor.ts](../../src/app/doctor.ts), [app/init-command.ts](../../src/app/init-command.ts) | [어댑터 계약 7.2절](adapter-contract.md): CLI/앱 공유 core. 질문·사람용 표시는 CLI에 남음 |

IR-26 분할 뒤의 위치(현재 상태 2026-11-26, main `1d42acc6`). 아래 원본 위치표의 `engine/index`는 2026-11-12 당시 위치이고, 지금은 다음 모듈에 있다. 구조는 [architecture.md](../architecture.md) 4.3·4.4절에 있다.

| 대상 | 현재 구현 위치 |
| --- | --- |
| 취소(엔진 쪽) | 중단 판정 [engine/run-helpers.ts](../../src/engine/run-helpers.ts)(`interrupted`). 기한·취소 신호의 연결은 [engine/index.ts](../../src/engine/index.ts)(`runWith`) |
| 상태 기계, 모델↔도구 반복, 한도, 결과를 모르는 호출 | [engine/state.ts](../../src/engine/state.ts), 반복·한도 [engine/run-converse.ts](../../src/engine/run-converse.ts), 도구 호출 [engine/run-tools.ts](../../src/engine/run-tools.ts), 실행·결과를 모르는 호출 [engine/run-helpers.ts](../../src/engine/run-helpers.ts), 회차 반복 `runLoop`은 `engine/index.ts` |
| 재수정 반복(판단, 메시지, 서명) | [engine/run-verify.ts](../../src/engine/run-verify.ts), [engine/feedback.ts](../../src/engine/feedback.ts) |
| 무결성·상태 디렉터리 점검 시점과 종료 점검 | [engine/run-checks.ts](../../src/engine/run-checks.ts)(`checkPoint`·`checkState`·`checkAtEnd`·`checkStateAtEnd`), 목록·비교는 `verify/integrity` |
| 엔진의 가림 적용(JSON 가림, 고정 문구) | [engine/run-helpers.ts](../../src/engine/run-helpers.ts)(`mask`·`maskJson`), [engine/model-texts.ts](../../src/engine/model-texts.ts) |
| 앱 명령 | [app/app.ts](../../src/app/app.ts)(조립·facade), `app/*-commands.ts`, `app/reading-context.ts`, `app/run-hooks.ts` |
| 사람용 고정 문구 표 | [contracts/human-messages.ts](../../src/contracts/human-messages.ts)(`contracts/human.ts`가 같은 이름으로 다시 내보냄) |

C11은 지정 source union/fresh runtime 모델의 app→CLI0 검증 완료이며 모든 CLI parser·질문·출력을 옮기거나 단계5 전체를 완료했다는 뜻은 아니다. 기존 인프로세스 앱/GUI bridge·잠금/취소 시험과 별도로 [cli-host-parity.test.ts](../../gui/tests/unit/cli-host-parity.test.ts)·[support](../../gui/tests/unit/cli-host-parity-support.ts)는 실제 CLI와 별도 host의 한 문서 대본 전체 저장물·독립 IPC·비교기 controls를 검증한다([CP53 검토](../reviews/2026-11-15-cli-host-parity-probe.md)). 모든 모델/시나리오/OS의 동등성으로 확대하지 않는다.
문서 보완 자체는 시험·빌드를 실행하지 않았다. CP53 추가 시험의 실제 실행과 기존 CP51 전체 검사 기록은 구분하며 아래 684/343 등은 원래 판의 측정으로 유지한다.

## 349726a 기준 원본 위치표·실측 기록

이하 표와 9절의 “없음”·“결정만”은 2026-11-12 스냅샷이다. models의 현재 구현 부재를 뜻하지 않으며 위 현재 위치 보완이 그 상태를 대체한다. 과거 표의 경로·결정·시험·수치는 그대로 보존한다.

기능마다 구현 파일, 결정 번호, 검증 사례(유닛·통합 파일)를 잇는다.

- 기준: main `349726a`(2026-11-12)
- 당시 수치(실측): typecheck 통과, 유닛 684건 중 683 통과·0 실패·1 건너뜀, 통합 343건 통과
- **실제 Anthropic API 시험은 실행하지 않았다.** "모의 API"는 127.0.0.1의 가짜 서버다.
- 구조 설명: [architecture.md](../architecture.md). 결정 요약: [decisions.md](../decisions.md). 원문: `docs/work-orders/`. 시험 전략: [testing.md](../testing.md).

표기
- 구현 경로는 `src/` 기준, 유닛은 `tests/unit/` 기준, 통합은 `tests/integration/` 기준이다. 파일 이름에서 `.ts`·`.test.ts`를 뺐다.
- 결정 번호는 decisions.md 3절의 계열(P, C, R, S, T, U(단계 3), V, W, X, Y)이다. "1a"는 단계 1a 기본 설계(작업 지시서 phase-1a.md)다.
- 상태
  - **구현**: 코드와 시험이 있다.
  - **구현(시험 없음)**: 코드만 있다.
  - **결정만**: 작업 지시서에만 있고 코드가 없다.
  - **설계만**: 설계 문서에만 있다.

## 1. 명령과 입력(CLI)

| 기능 | 구현 위치 | 결정 | 유닛 | 통합 | 상태 |
| --- | --- | --- | --- | --- | --- |
| 명령 분기, 도움말, 버전, 최상위 예외 | `cli/main`, `cli/args`, `cli/help`, `app/input/install`, `cli/guard` | C-8, S-6, U-7(단계 3), W-5 | `cli/cli`, `cli/k-cli`, `contracts/w5-doctor-usage` | `k02-commands`, `a09-a10-status-provider` | 구현 |
| `--env-file`·`--env-file-if-exists` 거부 | `cli/args` | T-15, V-3 | `cli/v3`, `cli/t-fixes` | `m02-fake-api-settings` | 구현 |
| 설정 파일, 모델·주소·시간·재시도 해석, 간편 형식 | `cli/config`, `cli/settings`, `cli/task`, `cli/run` | C-1~C-6, C-8, S-7, S-9 | `cli/config`, `cli/anthropic-wire`, `cli/security/limits`, `cli/security/url` | `m01-fake-api-runs`, `m02-fake-api-settings` | 구현 |
| 변수 파일(`--vars-file`) | `cli/run`, `cli/main`, `app/input/security/env` | C-2, S-4, T-15 | `cli/security/env`, `cli/config` | `m02-fake-api-settings`, `s01-security-regress` | 구현 |
| 키 검사(설정·task 원문과 값, `--goal`) | `app/input/security/keys`, `cli/run` | C-1, S-6, S-8, T-14 | `cli/security/keys`, `cli/sc-regress` | `m02-fake-api-settings`, `s01-security-regress` | 구현 |
| 경로 검사(UNC·장치, 작업 공간 밖 파일, 취소 파일, 실행 파일·cwd) | `app/input/security/paths`, `cli/task`, `cli/run`, `cli/revert` | S-1, S-5, T-12, T-14, X-1 | `cli/security/paths`, `cli/t-fixes`, `cli/x-cli` | `s01-security-regress`, `t01-fix-regress` | 구현 |
| 한도 상한과 절대 상한, `maxOutputTokens` 상한 | `app/input/security/limits`, `cli/task` | C-6, S-7, T-14 | `cli/security/limits`, `cli/t-fixes` | `m02-fake-api-settings` | 구현 |
| 설치 위치 거부 | `app/input/install`, `cli/run`, `app/input/security/paths` | U-3(단계 3) | `cli/k-cli` | `k02-commands` | 구현 |
| 비밀 등록(secretEnv, 환경의 키, 변수 파일 값) | `cli/run`, `app/input/security/env` | S-2, S-3, S-4 | `cli/security/env`, `cli/sc-regress`, `cli/config` | `s01-security-regress`, `m01-fake-api-runs` | 구현 |
| 취소(신호, 취소 파일) | `cli/cancel`, `cli/run`, `engine/index` | P-2, T-12 | `cli/cli`, `cli/t-fixes`, `engine/run-task`(EN-05) | `a08-limits-cancel`, `p01-repair-loop`(F5-h) | 구현 |
| 진행 표시(stderr, `--quiet`) | `cli/progress`, `cli/run` | U-8(단계 3) | `cli/k-cli` | `k02-commands` | 구현 |
| `codaryn models`(목록, 선택, 404 안내) | 없음 | Y-1~Y-5 | 없음 | 없음 | 결정만 |

## 2. 조립과 엔진

| 기능 | 구현 위치 | 결정 | 유닛 | 통합 | 상태 |
| --- | --- | --- | --- | --- | --- |
| 조립(잠금, journal, 공유 명령 실행기, 무결성 검사기 연결) | `cli/assemble` | T-1, U-1(단계 3) | `cli/assemble`, `cli/t-fixes`(T-1), `cli/sc-wire` | `a07-masking`, `k01-integrity` | 구현 |
| 상태 기계, 모델↔도구 반복, 한도, 결과를 모르는 호출 | `engine/index`, `engine/state`, `engine/validate-args` | 1a, T-3, T-8 | `engine/run-task`, `engine/state`, `engine/review-fixes` | `a08-limits-cancel`, `a09-a10-status-provider` | 구현 |
| 재수정 반복(판단, 메시지, 서명) | `engine/index`, `engine/feedback` | R-1~R-4, T-5, V-1 | `engine/repair`, `engine/signature`, `engine/fixed-text` | `p01-repair-loop`, `p02-repair-feedback`, `p05-repair-fake-api`, `v01-l1-regress` | 구현 |
| 무결성 확인(목록, 비교, 점검 시점, 종료 점검, 링크 대상) | `verify/integrity`, `engine/index`, `cli/run`(`integrity.paths` 검사) | U-1, U-2(단계 3), W-1, W-2 | `verify/integrity`, `engine/integrity` | `k01-integrity`, `k03-self-dev-rehearsal` | 구현 |

## 3. 모델

| 기능 | 구현 위치 | 결정 | 유닛 | 통합 | 상태 |
| --- | --- | --- | --- | --- | --- |
| Anthropic 제공자(내장 `fetch`, 재시도, 응답 상한, 키 정리, thinking 블록 처리) | `model/anthropic/index`, `cli/provider` | C-4, C-5, C-7, S-9~S-12 | `model/anthropic/provider`(AD-01~06), `cli/anthropic-wire`, `cli/cli`(AD-07) | `m01`~`m03`, `p05-repair-fake-api`, `s01-security-regress`(모의 API) | 구현. 실제 API 미실행(`tests/live/anthropic-live`) |
| 대본 제공자 | `model/scripted` | 1a | `model/scripted` | `a01`~`a10`, `p01`~`p04`, `k01`~`k03` 등 | 구현 |

## 4. 도구와 실행

| 기능 | 구현 위치 | 결정 | 유닛 | 통합 | 상태 |
| --- | --- | --- | --- | --- | --- |
| 내장 도구 4개(읽기, 검색, 쓰기, 명령) | `tools/index`, `contracts/tool` | 1a, P-6, P-7 | `tools/read-search-run`, `tools/write-file`, `contracts/tool-definitions` | `a01-code-task`, `a02-document-task`, `a03-conflict`, `a05-permissions` | 구현 |
| 명령 실행기(허용 환경과 값 검사, 종료 확정, 트리 종료, 끝까지 못 읽은 출력) | `tools/command-runner` | T-1, T-2, V-2 | `tools/exit-settle`, `tools/cut-output`, `tools/review-fixes` | `a08-limits-cancel`, `v01-l1-regress`, `t01-fix-regress` | 구현 |
| Windows 실행 파일 해석(PATH·PATHEXT, 작업 공간 안 거부, `.cmd`·`.bat`, UNC) | `tools/windows-launch`, `tools/command-runner` | T-4, X-1 | `tools/windows-launch`, `tools/windows-cmd-real` | `g01-windows-cmd` | 구현 |
| 정책 게이트(권한별 판정, 2단계 판정) | `policy/index` | 1a | `policy/policy`(PO-01~06) | `a05-permissions` | 구현 |
| 보호 경로(어휘·실경로, 링크 항목, fail closed) | `policy/protected`, `policy/index` | R-5, T-13 | `policy/protected-paths`(PO-07) | `p03-protected-paths`, `t01-fix-regress` | 구현 |
| 작업 공간 경로 해석과 원자적 쓰기 | `workspace/workspace`, `workspace/lexical`, `workspace/file-layer` | 1a | `workspace/workspace`(WS-01~04) | `a04-path-escape`, `encoding` | 구현 |
| 검증기(`command`, `file_rules`)와 근거 원문 전달 | `verify/index` | 1a, T-6 | `verify/verify`(VF-01~03), `verify/evidence` | `a01-code-task`, `a02-document-task`, `a09-a10-status-provider` | 구현 |

## 5. 민감정보

| 기능 | 구현 위치 | 결정 | 유닛 | 통합 | 상태 |
| --- | --- | --- | --- | --- | --- |
| 가림 게이트(토큰, 변형 목록, 겹침 합치기, 표지 조각) | `privacy/index`, `contracts/text`, `contracts/privacy` | 1a(C1-F 규칙) | `privacy/gateway`(PR-01~03, 05, 10, 11) | `a07-masking`, `r01-privacy-regress`, `m01-fake-api-runs` | 구현 |
| 필드 복원과 원위치(보호 줄) 규칙 | `privacy/index`, `tools/index`, `policy/index` | 1a, P-6 | `privacy/gateway`(PR-06~09), `tools/write-file`, `policy/policy` | `a06-protected-span`, `r01-privacy-regress` | 구현 |
| 엔진의 가림 적용(JSON 가림, 고정 문구) | `engine/index` | 1a | `engine/masking`, `engine/run-task`, `engine/fixed-text` | `a07-masking`, `m01-fake-api-runs` | 구현 |
| 가린 뒤 자르기(명령 출력, 검증 근거, 검색 줄) | `tools/index`, `tools/command-runner`, `engine/feedback`, `verify/index` | R-4, T-6, V-2 | `tools/cut-output`, `tools/review-fixes`, `verify/evidence`, `engine/review-fixes` | `p02-repair-feedback`, `v01-l1-regress` | 구현 |
| 자식 환경 허용 목록과 값 검사 | `tools/command-runner`, `tools/index` | T-1 | `tools/review-fixes`, `cli/t-fixes` | `a07-masking` | 구현 |
| 최선 노력 탐지, 공개 해시 제외, 읽기 제외 경로 | 없음 | 단계 0 설계 | 없음(PR-12) | 없음 | 설계만 |

## 6. 저장과 되돌리기

| 기능 | 구현 위치 | 결정 | 유닛 | 통합 | 상태 |
| --- | --- | --- | --- | --- | --- |
| journal(추가 전용), result.json, 상태 디렉터리 `.gitignore` | `store/index`, `store/common` | 1a, P-3 | `store/store` | `a01-code-task` 등 전부 | 구현 |
| 작업 공간 잠금(원자적 생성·회수, EPERM·EBUSY, pid 재사용 대역) | `store/lock` | P-4, T-9, W-4 | `store/lock-errors`, `store/lock-reclaim`, `store/store` | `a08-limits-cancel`, `t01-fix-regress` | 구현 |
| 쓰기 전 스냅샷 | `store/changes`, `tools/index` | R-6, R-8, T-11 | `store/changes`, `tools/change-recorder` | `p02-repair-feedback`(F5-k) | 구현 |
| 되돌리기(`codaryn revert`, 기록 없는 스냅샷, 잘린 마지막 줄) | `store/changes`, `cli/revert`, `cli/assemble` | R-7, T-10, T-12 | `store/changes`(WS-06), `cli/t-fixes` | `p04-revert` | 구현 |

## 7. 단계 3 명령과 스크립트

| 기능 | 구현 위치 | 결정 | 유닛 | 통합 | 상태 |
| --- | --- | --- | --- | --- | --- |
| `codaryn report`(Markdown·JSON, 깨진 기록 거부) | `cli/report` | U-5(단계 3), X-2 | `cli/k-report-doctor`, `cli/x-cli` | `k02-commands` | 구현 |
| `codaryn doctor`(12개 항목, 네트워크 없음, 키 값 미출력) | `cli/doctor` | U-6(단계 3), W-5, X-1, X-3 | `cli/k-report-doctor`, `cli/x-cli`, `contracts/w5-doctor-usage` | `k02-commands` | 구현 |
| 후보 준비 스크립트 | `scripts/new-candidate.mjs` | U-4(단계 3), W-3 | `scripts/new-candidate` | `k03-self-dev-rehearsal` | 구현 |
| 자기 개발 예행(대본 모델) | 위 기능의 조합 | U-1~U-5(단계 3) | 없음 | `k03-self-dev-rehearsal` | 구현. 실제 자기 개발의 증거가 아님 |
| 계약 상수와 단계 3 계약 | `contracts/*` | 단계별 계약 | `contracts/t-constants`, `contracts/k-contracts` | 없음 | 구현 |

## 8. 개발 도구

| 기능 | 구현 위치 | 결정 | 유닛 | 통합 | 상태 |
| --- | --- | --- | --- | --- | --- |
| 비밀 검사(`--staged`, `--range`, `--tracked`)와 pre-commit 훅 | `scripts/check-secrets.mjs`, 공용 `.git/hooks/pre-commit`(추적 안 됨) | 사용자 지시 U-13(decisions.md 1절) | 없음 | 없음 | 구현(시험 없음) |
| 병합 전 검토(작성자, trailer, 소유, 충돌, 공백, 비밀) | `scripts/review-branch.mjs` | 단계 1a 배정 | 없음 | 없음 | 구현(시험 없음) |
| 실제 API 점검 | `tests/live/anthropic-live.ts` | 사용자가 직접 실행 | — | — | 작성됨, 미실행 |

## 9. 알려진 빈칸

- 시험 없는 구현
  - `scripts/check-secrets.mjs`, `scripts/review-branch.mjs`: 병합 절차에서 실제로 쓰지만 자동 시험이 없다.
- 결정만 있는 기능: `codaryn models`(Y-1~Y-5).
- 설계만 있는 기능
  - 자료 분석·파일 정리 검증기(VF-04, 05)
  - 최선 노력 탐지
  - 이미지·구조 문서 처리
  - GUI·IDE
- 미검증 시나리오: 쓰기 도중 강제 종료(testing.md T7), 실제 API 전부.

## 10. 결정 필요

| 번호 | 선택지 | 권고 |
| --- | --- | --- |
| IM-D1 | 개발 도구 스크립트에 시험을 둘지 | `check-secrets`의 가짜 값 탐지와 `review-branch`의 trailer·소유 검사에 유닛을 둔다(`tests/unit/scripts/`, 담당은 스크립트 소유자) |
| IM-D2 | 이 표의 갱신 책임 | 결정 묶음을 병합할 때 PM이 갱신을 배정한다. 아니면 작업 지시서의 "검증 사례" 열에 파일을 적게 해 이 표를 그 열에서 모은다 |
