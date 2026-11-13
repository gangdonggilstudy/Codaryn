# 개발 진행 현황

**현재(2026-11-13, main `76c5280`).** 목표는 최종 설계까지 모두 구현하는 것이다. 단위별 배치와 상태는 [임시 PM 상태](pm-status.md)에 있다. 단계별 판정의 근거는 [설계 대조 조사](reviews/2026-11-13-design-gap-survey.md) 3절이다.

- **main에 있는 것(오프라인·모의 API 검증까지):**
  - 단계 1a, 설정과 두 제공자(Anthropic, OpenAI. 1b 구현분), 단계 2 재수정 반복, 단계 3의 오프라인 기구, `codaryn models`
  - 사용성 개선(N-1~N-28. N-28은 시험 수정. N-11은 단계 5로 미루고 N-13은 DR-20이 대체)
  - 단계 4 범용 작업의 P0
  - 단계 5의 독립 GUI(DR-20)
  - 사용성 중간 점검 뒤의 단위들. 새 체계(G-12)의 단위는 병합 커밋 제목 `merge: accept unit …`에 있다.
- **실제 Anthropic API와 실제 OpenAI API는 한 번도 호출하지 않았다.** 1b와 단계 2·3의 실 API 기준은 확인하지 않았다.
- **완료가 아닌 단계:**
  - 1b, 2, 3: 실 API 몫이 남았다.
  - 4: P1 묶음이 없다.
  - 5: 실행 중 권한 확인(DR-3), CLI의 앱 계층 이행, 계약 층 시험, 설치 패키지가 없다.
- 2026-11-12 재개(CP-12)와 그 전의 기록은 아래 표들에 그대로 둔다.

PM 체크포인트는 [임시 PM 상태](pm-status.md), 배분과 PM 결정은 [단계 1a 작업 배분](work-orders/phase-1a-assignments.md)에 있다.

## 작업 현황

| 작업 | 담당 페르소나 | pane | 브랜치 | 상태 |
| --- | --- | --- | --- | --- |
| A 기반과 공통 계약 | 수석 아키텍트, CLI 개발자 | w1:p1 | claude/cli-foundation | 완료. `cba57fa`, main `cc29b50`에 병합 |
| B1 엔진·모의 모델·CLI | CLI 개발자 | w1:p1 | claude/core-engine | 완료. `b67b620`, `e8b5bd2`, `5333feb`, `54e59fd`, `2323ad6`, `2b5167c` 병합 |
| B2 도구·명령 실행기 | CLI 개발자 | w1:p6 | claude/core-tools | 완료. `9496d14`, `df1ceff` 병합 |
| B3 검증기·기록·잠금 | CLI 개발자, 검증 엔지니어 | w1:p8 | claude/core-store | 완료. `d3e6350`, `6d35746` 병합 |
| C1 민감정보 게이트 | 보안·개인정보 검토자 | w1:p5 | claude/security-core | 완료. `ec4aa5f`, `7a74c2c` 병합 |
| C2 정책·작업 공간 | 보안·개인정보 검토자 | w1:p7 | claude/workspace-policy | 완료. `ae27dc1`, `063605d`, `bca12d3`, `7eca0c0` 병합 |
| D 독립 통합 검증 | 검증 엔지니어 | w1:p4 | claude/cli-verification | 완료. `8b40f46`, `7942bfd`, `db1e043` 병합, 76건 통과 |
| E1 설정 계약·CLI·조립 | 수석 아키텍트, CLI 개발자 | w1:p1 | claude/core-engine | 완료. `86f3d62`, `7a2d02d`, `7359cef` 병합 |
| E2 Anthropic 제공자 | CLI 개발자, 보안·개인정보 검토자 | w1:p8 | claude/anthropic-provider | 완료. `a5f62e7` 병합. 실제 API 미실행 |
| E3 가짜 서버 통합 검증 | 검증 엔지니어 | w1:p4 | claude/cli-verification | 완료. `e8dbdb9` 병합, 모의 API 54건 통과. 실제 호출 점검 스크립트는 미실행 |
| F 단계 2 재수정 반복(계약, 엔진, 정책, 스냅샷·되돌리기, 도구 연동) | CLI 개발자, 보안·개인정보 검토자 | p1, p5~p8 | 여러 브랜치 | 완료. main `4074d5c` |
| G1 Windows `.cmd`/`.bat` 실행 | CLI 개발자 | w1:p6 | claude/core-tools | 완료. `2506bff`, `a51002c` 병합 |
| G2 사용 문서와 예시 | 문서·데이터 작업 전문가 | w1:p5 | claude/security-core | 1차 병합(`6df69be`, `9d1eea1`). 단계 2 반영 갱신 진행 |
| S, T 교차 검토 결함 수정(S-1~S-12, T-1~T-15) | 각 모듈 담당 | p1, p5~p8 | 여러 브랜치 | 완료. main `4074d5c` |
| F5 단계 2 통합 검증 | 검증 엔지니어 | w1:p4 | claude/cli-verification | 완료. 통합 273건 통과 |

각 작업은 별도 worktree를 쓴다. 소유 파일은 배분 문서 1절, 수용 기준은 [작업 지시서](work-orders/phase-1a.md) 4절을 따른다.

이 표는 단계 1a~2(w1 세션)의 기록이고, 상태 칸도 그때의 것이다. 그 뒤의 작업은 새 체계(G-12)의 단위로 진행한다. 단위별 내용은 병합 커밋 제목(`merge: accept unit …`)에, 배치와 상태는 [임시 PM 상태](pm-status.md)에 있다.

## 검토 단계

- G0 사용자 개발 지시와 공통 지침 반영: 완료.
- G1 개발 환경: Windows, Node.js 26.13.0, npm 11.20.0, TypeScript 엄격 검사와 Node 기본 테스트 러너. 개발 의존성은 typescript 7.0.2, @types/node 26.6.6이다.
- G2 기반 인수: 완료(2026-11-12, 임시 PM). 계약 11개 파일과 `docs/cli-contract.md`를 검토했다. 타입 검사와 빌드가 통과했고 계약에 Git이나 테스트 러너를 전제로 한 필드가 없다.
- G3 구현 인수: G3a 완료(B2, B3, C1, C2 병합, main `7b39c96`). G3b 완료(B1 조립 병합, main `58dcfde`, 수정 포함 `3982a6c`).
- G4 채택: 완료(2026-11-12, 임시 PM). 1a 오프라인 검증만 채택했다. 근거는 아래 수용 기준 대조다.

## 검증 기록

| 시점 | 위치 | 명령 | 결과 |
| --- | --- | --- | --- |
| G2 | main `cc29b50` | `npm ci`, `npm run typecheck`, `npm run build` | 통과 |
| G2 | worktree 6개 | `npm ci`, `npx tsc -p tsconfig.json --noEmit` | 통과 |
| 배분 | main | `node scripts/check-secrets.mjs --tracked` | 발견 없음 |
| 배분 | 임시 저장소 | 가짜 키와 `.env`를 스테이징해 `check-secrets.mjs --staged` 자체 시험 | 두 건 모두 탐지(종료 코드 1) |
| G3a 전 | 작업 브랜치 5개 | `node scripts/review-branch.mjs`, 각 worktree `npm run test:unit` | 모두 PASS. 유닛 C1 22, B2 35, C2 33, B3 18, B1 1단계 44 통과, 실패 0 |
| G3a | main `7b39c96` | `npm run typecheck`, `npm run test:unit`, `check-secrets --tracked` | 통과. 유닛 108건 통과, 실패 0, 건너뜀 0. 비밀 발견 없음 |
| G3b | main `58dcfde` | `npm run typecheck`, `npm run test:unit`, `npm run test:integration` | 타입 검사 통과, 유닛 156건 통과. 통합 63건 중 50 통과, 13 실패(거부된 호출의 `tool_result` 미기록) |
| G3b 수정 후 | main `3982a6c` | 같은 세 명령, `check-secrets --tracked` | 타입 검사 통과, 유닛 157건 통과, 통합 63건 통과(실패 0, 건너뜀 0), 비밀 발견 없음 |
| 교차 검토 | 임시 폴더의 main 사본 | p5, p6, p7이 가짜 비밀로 재현 실험 | 재현된 결함 13건. 원문은 `docs/reviews/` |
| 수정 병합 후 | main `3ab3388` | 같은 세 명령 | 타입 검사 통과, 유닛 187건 통과. 통합 76건 중 74 통과, 2 실패(R-e. 원인: 엔진 시스템 문장의 토큰 표식 리터럴이 새 가림 규칙과 충돌) |
| G4 | main `db1c55c` | `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `node scripts/check-secrets.mjs --tracked` | 타입 검사 통과, 유닛 189건 통과, 통합 76건 통과(실패 0, 취소 0, 건너뜀 0), 비밀 발견 없음 |
| 설정·제공자 | main `e6532ed` | `npm run typecheck`, `npm run test:unit`, `npm run test:integration` | 타입 검사 통과, 유닛 234건 통과, 통합 76건 통과 |
| 모의 API | main `dd930e2` | 같은 세 명령, `node scripts/check-secrets.mjs --tracked` | 타입 검사 통과, 유닛 234건 통과, 통합 130건 통과(로컬 가짜 서버 사례 54건 포함, 실패 0, 건너뜀 0), 비밀 발견 없음 |
| 단계 2 연결 직후 | `claude/core-engine` `3f3756d` 기준 p4 실행 | 타입 검사, 유닛, 통합 | 유닛 402건 중 401 통과·1 건너뜀. 통합 246건 중 238 통과·8 실패(결함 3건: 명령 실행기 옵션 미전달, 검증기 출력의 원문 절단, Node의 `--env-file` 가로채기) |
| 수정 묶음 T 뒤 | 합친 트리(PM 실행) → main `4074d5c` | `npx tsc --noEmit`, `npm run test:unit`, `npm run test:integration`, `node scripts/check-secrets.mjs --tracked` | 타입 검사 통과, 유닛 472건 중 471 통과·실패 0·건너뜀 1, 통합 273건 통과·실패 0·건너뜀 0, 비밀 발견 없음 |
| 단계 3과 후속 수정 | 합친 트리(PM 실행) → main `a021812`, `349726a` | 타입 검사, 유닛, 통합 | 단계 3 통합 사례 포함 통합 343건 통과. 유닛 684건 중 683 통과·1 건너뜀 |
| 일시 정지 직전 | 합친 트리(PM 실행) → main `39219c8` | `npx tsc --noEmit`, `npm run test:unit`, `npm run test:integration`, `node scripts/check-secrets.mjs --tracked` | 타입 검사 통과, 유닛 726건 중 725 통과·실패 0·건너뜀 1, 통합 343건 통과, 비밀 발견 없음 |
| 재개(CP-12) | 새로 받은 저장소의 main `34393bd`(PM 실행) | `npm ci`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `node scripts/check-secrets.mjs --tracked` | 모두 성공. 유닛 726건 중 725 통과·실패 0·건너뜀 1, 통합 343건 통과, 비밀 발견 없음 |
| 간헐 실패 | main `c8c0d9b` 부근 | 통합 전체 반복 실행 | PM 4회 중 1회 V-2 사례 실패(CLI가 빈 stdout으로 종료). p4의 10회 재실행에서는 재현되지 않음. 원인 미확정 |
| CP-20 | U-22 판 `4eda8d8`(트리는 main `a191a50`과 같음, PM 실행) | 타입 검사, 유닛, 통합, 비밀 검사. GUI 유닛·연기 시험 | 타입 검사 통과, 유닛 2,273건 중 2,269 통과·0 실패·3 건너뜀·todo 1, 통합 559건 통과, 비밀 검사 통과. GUI 유닛 165건·연기 시험 181건 통과(검토 R-51b) |
| CP-21 | U-36 판 `13414fc`(트리는 main `604f9e5`와 같음, PM 실행) | 같은 네 가지 | 타입 검사 통과, 유닛 2,602건 중 2,598 통과·0 실패·3 건너뜀·todo 1, 통합 559건 통과, 비밀 검사 통과. GUI는 main `2ee6c0b`에서 유닛 193건·연기 시험 191건 통과(GUI 담당 측정) |
| 실제 API | — | `node --test dist/tests/live/anthropic-live.js` | **미실행.** 사용자가 키와 모델을 설정하고 직접 실행한다. OpenAI용 실제 호출 점검 스크립트는 없다 |

- 통합 테스트 통과는 검사한 사례의 증거다. 교차 검토에서 그 사례에 없던 결함이 재현되어 회귀 테스트와 함께 고쳤다. 같은 종류의 미발견 결함이 더 없다는 뜻은 아니다.
- 실제 API 검증은 실행하지 않았다(1b 미수행). 모의 모델을 이용한 오프라인 검증을 실제 API 성공으로 표시하지 않는다.
- CP-21 뒤 main(`76c5280`까지)의 판 수치는 각 단위의 보고와 [임시 PM 상태](pm-status.md)에 있다.

## 단계 1a 수용 기준 대조 (main `db1c55c`)

| 번호 | 결과 | 근거 |
| --- | --- | --- |
| A1 | 통과 | 통합 `a01-code-task` |
| A2 | 통과 | 통합 `a02-document-task`(Git, 테스트 러너, PATH 없이), 유닛 VF-01 |
| A3 | 통과 | 통합 `a03-conflict`, 유닛 WS-01과 경쟁 회귀 3건 |
| A4 | 통과 | 통합 `a04-path-escape`(상위 경로, 상태 디렉터리, 정션), 유닛 PO-02 |
| A5 | 통과 | 통합 `a05-permissions`, 유닛 PO-01, 03, 04, 06 |
| A6 | 통과 | 통합 `a06-protected-span`, `r01` R-e·R-e2·R-f, 유닛 PR-06~09 |
| A7 | 통과 | 통합 `a07-masking`, `r01` R-a~R-d·R-g, 유닛 PR-10, 11 |
| A8 | 통과 | 통합 `a08-limits-cancel`(한도 네 종류, 취소, 자식과 손자 프로세스 종료, 잠금), 유닛 EN-03, 05 |
| A9 | 통과 | 통합 `a09-a10-status-provider`, 유닛 EN-02 |
| A10 | 통과 | 통합 `a09-a10-status-provider`(전송 없이 거부), 유닛 AD-07 |
| A11 | 통과 | 유닛 189건, 타입 검사 |
| A12 | 충족 | 이 문서: 오프라인 검증 통과, 실제 API 미실행(1b 미수행) |

- 네트워크는 "네트워크를 쓰는 도구가 없음"까지만 확인했다. 네트워크 차단이나 OS 격리를 확인한 것이 아니다.
- 모든 실행은 Windows, Node.js 26.13.0에서 했다. 다른 OS에서는 실행하지 않았다.
- 미도입: AD-01~06(실제 어댑터), PR-04(조각 응답), PR-12(제외 규칙). AD-01~06은 그 뒤 구현했다(모의 전송·가짜 서버만, [유닛 시험 계획](unit-test-plan.md#40-현재-상태349726a)).

## 결정 기록

- 2026-11-12 G2: 기반 계약을 재설계 없이 채택했다. 중단 시점의 파일이 타입 검사를 통과했고 문서 계약과 일치했다.
- 2026-11-12: 작업 B를 B1/B2로, 작업 C를 C1/C2로 나눴다. 디렉터리 단위로 소유가 겹치지 않고 계약 인터페이스로만 연결되므로 병렬 진행이 가능하다. optional 탭의 빈 세션 p5, p6, p7을 사용자 승인에 따라 배정했다.
- 2026-11-12: 사용자 지시에 따라 작업 B2에서 검증기·기록을 B3(p8)로 다시 나눴고, 검증 체계(배분 문서 5절)와 API 키 커밋 배제 수단(6절)을 추가했다.
- 2026-11-12 교차 검토: 구현자와 다른 담당자가 각 모듈을 읽기 전용으로 검토했다(`docs/reviews/`). 재현된 결함은 회귀 테스트를 먼저 추가한 뒤 고쳤다. 원위치 규칙 강화, 가림본 검색, 필드별 가림 등의 결정은 pm-status.md의 PM 결정에 있다.
- 2026-11-12 G4: 1a 오프라인 검증을 채택했다. 1b는 위임 범위 밖이라 열지 않았다.
- 2026-11-12 설정과 제공자: 사용자의 직접 지시("설정 가능하게 해")를 모델·키·한도의 설정화와 Anthropic 제공자 구현으로 해석했다. 결정 C-1~C-8은 `work-orders/phase-1b-config.md`에 있다. 전송은 SDK 대신 내장 `fetch`를 쓴다.
- 2026-11-12 단계 2: 사용자의 직접 지시로 진행했다. 결정 R-1~R-8, S-1~S-12, T-1~T-15와 근거는 `work-orders/phase-2-repair-loop.md`에 있다. 구현자가 아닌 담당자의 교차 검토를 세 차례(1a, 설정·제공자, 단계 2) 했고 원문은 `docs/reviews/`에 있다.
- 2026-11-12: p1 세션이 주간 사용 한도로 멈춰 PM이 p1의 계약 변경을 검증 후 커밋(`f45959a`)하고 CLI 작업을 p7에, 엔진 작업을 p5에 재배정했다.
- 계약의 미정 항목에 대한 PM 결정 P-1~P-7은 배분 문서 3절에 있다.

## 남은 문제

- 재수정을 켜면 검증기 명령이 모델이 쓴 코드를 실행하고 그 출력이 모델에 돌아간다. 명령 허용 목록이 비어 있어도 같다. OS 격리가 없는 동안의 구조적 한계다.
- 스냅샷(변경 전 원문)은 파일 도구로는 닿을 수 없지만 실행된 명령은 읽을 수 있다. 분리된 자손 프로세스는 실행이 끝난 뒤에도 남을 수 있다.
- 실제 Anthropic API와 실제 OpenAI API 미검증. Anthropic 쪽의 503 분류, `retry-after` 형식, 빈 `tool_result`, thinking 블록 없는 도구 반복은 실제 호출로만 확정된다.
- 비밀이 든 줄 자체는 수정할 수 없다(원위치 규칙). 목록 밖 변형과 UTF-8이 아닌 출력은 가려지지 않는다.
- `allowExtraArgs:true`인 명령 규칙은 추가 인자의 경로를 검사하지 않는다. 해시 재확인과 교체 사이의 짧은 경쟁 창이 남는다.
- 발급된 토큰 리터럴이 파일에 들어 있는 경우의 줄 대응 모호성(교차 검토 privacy 4번, 낮음)과 이름에 `CODARYN_SECRET`이 든 파일 접근 불가는 고치지 않았다.
- 지원 OS와 Windows에서 자식 프로세스 트리 종료를 검증하는 방법(통합 검증에서 확인).
- 파일 해시가 모델과 기록에 노출되는 점(알려진 한계로 기록).
- 그 뒤의 알려진 한계와 열린 사용성 지적은 [임시 PM 상태](pm-status.md)의 진행 요약과 [설계 대조 조사](reviews/2026-11-13-design-gap-survey.md)에 있다.

해소된 것(2026-11-13 main `76c5280` 기준):

- "공식 SDK" 서술과 `fetch` 구현의 차이: architecture.md 6절과 decisions.md(C-7의 설명, M-5)가 내장 `fetch`로 고쳐졌다.
- Windows의 `.cmd`/`.bat`: 조건을 모두 만족하면 `cmd.exe /d /s /c`로 실행한다(G1, [사용 안내](usage.md#13-권한-정책)).
- AD-01~06 미도입: 구현했다. 모의 전송과 가짜 서버로만 확인했고 실제 API는 확인하지 않았다.
- w1 세션 p1의 주간 사용 한도: 작업은 CP-12에서 새 세션 w3로 옮겨 재개했다.
