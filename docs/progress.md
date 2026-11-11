# 개발 진행 현황

단계 1a(오프라인 최소 CLI)는 2026-11-12에 임시 PM(Claude, w1:p3, 위임 pm-20261112-01)이 채택했다. 1b(실제 Anthropic API)는 수행하지 않았으므로 단계 1 전체는 완료가 아니다. Codex는 회수 권한을 유지한다. 재수정 반복(단계 2)과 자기 소스 수정(단계 3)은 후속 단계다.

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

각 작업은 별도 worktree를 쓴다. 소유 파일은 배분 문서 1절, 수용 기준은 [작업 지시서](work-orders/phase-1a.md) 4절을 따른다.

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

- 통합 테스트 통과는 검사한 사례의 증거다. 교차 검토에서 그 사례에 없던 결함이 재현되어 회귀 테스트와 함께 고쳤다. 같은 종류의 미발견 결함이 더 없다는 뜻은 아니다.
- 실제 API 검증은 실행하지 않았다(1b 미수행). 모의 모델을 이용한 오프라인 검증을 실제 API 성공으로 표시하지 않는다.

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
- 미도입: AD-01~06(실제 어댑터), PR-04(조각 응답), PR-12(제외 규칙).

## 결정 기록

- 2026-11-12 G2: 기반 계약을 재설계 없이 채택했다. 중단 시점의 파일이 타입 검사를 통과했고 문서 계약과 일치했다.
- 2026-11-12: 작업 B를 B1/B2로, 작업 C를 C1/C2로 나눴다. 디렉터리 단위로 소유가 겹치지 않고 계약 인터페이스로만 연결되므로 병렬 진행이 가능하다. optional 탭의 빈 세션 p5, p6, p7을 사용자 승인에 따라 배정했다.
- 2026-11-12: 사용자 지시에 따라 작업 B2에서 검증기·기록을 B3(p8)로 다시 나눴고, 검증 체계(배분 문서 5절)와 API 키 커밋 배제 수단(6절)을 추가했다.
- 2026-11-12 교차 검토: 구현자와 다른 담당자가 각 모듈을 읽기 전용으로 검토했다(`docs/reviews/`). 재현된 결함은 회귀 테스트를 먼저 추가한 뒤 고쳤다. 원위치 규칙 강화, 가림본 검색, 필드별 가림 등의 결정은 pm-status.md의 PM 결정에 있다.
- 2026-11-12 G4: 1a 오프라인 검증을 채택했다. 1b는 위임 범위 밖이라 열지 않았다.
- 계약의 미정 항목에 대한 PM 결정 P-1~P-7은 배분 문서 3절에 있다.

## 남은 문제

- Windows에서 `.cmd`/`.bat`(예: npm)은 셸 없이 실행되지 않는다. 명령 도구와 명령 검증기는 `node` 같은 실행 파일만 쓸 수 있다.
- 비밀이 든 줄 자체는 수정할 수 없다(원위치 규칙). 목록 밖 변형과 UTF-8이 아닌 출력은 가려지지 않는다.
- `allowExtraArgs:true`인 명령 규칙은 추가 인자의 경로를 검사하지 않는다. 해시 재확인과 교체 사이의 짧은 경쟁 창이 남는다.
- 발급된 토큰 리터럴이 파일에 들어 있는 경우의 줄 대응 모호성(교차 검토 privacy 4번, 낮음)과 이름에 `CODARYN_SECRET`이 든 파일 접근 불가는 고치지 않았다.
- 지원 OS와 Windows에서 자식 프로세스 트리 종료를 검증하는 방법(통합 검증에서 확인).
- 파일 해시가 모델과 기록에 노출되는 점(알려진 한계로 기록).
- 실제 Anthropic 어댑터는 1a에 넣지 않는다. AD-01~06은 "미도입"으로 보고한다.
