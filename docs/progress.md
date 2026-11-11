# 개발 진행 현황

현재 단계는 1a 최소 CLI와 오프라인 검증이다. 사용자가 연속 진행을 지시했다. 2026-11-12부터 임시 PM(Claude, w1:p3, 위임 pm-20261112-01)이 범위·작업 배분·검증·통합을 관리하며 Codex는 회수 권한을 유지한다. 실제 API 호출과 자기 소스 수정은 후속 단계다.

PM 체크포인트는 [임시 PM 상태](pm-status.md), 배분과 PM 결정은 [단계 1a 작업 배분](work-orders/phase-1a-assignments.md)에 있다.

## 작업 현황

| 작업 | 담당 페르소나 | pane | 브랜치 | 상태 |
| --- | --- | --- | --- | --- |
| A 기반과 공통 계약 | 수석 아키텍트, CLI 개발자 | w1:p1 | claude/cli-foundation | 완료. `cba57fa`, main `cc29b50`에 병합 |
| B1 엔진·모의 모델·CLI | CLI 개발자 | w1:p1 | claude/core-engine | 1단계 `b67b620` 검토 통과(유닛 44). 2단계 조립 진행 |
| B2 도구·명령 실행기 | CLI 개발자 | w1:p6 | claude/core-tools | 완료. `9496d14` 병합 |
| B3 검증기·기록·잠금 | CLI 개발자, 검증 엔지니어 | w1:p8 | claude/core-store | 완료. `d3e6350`, `6d35746` 병합 |
| C1 민감정보 게이트 | 보안·개인정보 검토자 | w1:p5 | claude/security-core | 완료. `ec4aa5f` 병합 |
| C2 정책·작업 공간 | 보안·개인정보 검토자 | w1:p7 | claude/workspace-policy | 완료. `ae27dc1`, `063605d`, `bca12d3` 병합 |
| D 독립 통합 검증 | 검증 엔지니어 | w1:p4 | claude/cli-verification | 테스트 작성분 `8b40f46`, `7942bfd` 병합. 실행은 G3b 뒤 |

각 작업은 별도 worktree를 쓴다. 소유 파일은 배분 문서 1절, 수용 기준은 [작업 지시서](work-orders/phase-1a.md) 4절을 따른다.

## 검토 단계

- G0 사용자 개발 지시와 공통 지침 반영: 완료.
- G1 개발 환경: Windows, Node.js 26.13.0, npm 11.20.0, TypeScript 엄격 검사와 Node 기본 테스트 러너. 개발 의존성은 typescript 7.0.2, @types/node 26.6.6이다.
- G2 기반 인수: 완료(2026-11-12, 임시 PM). 계약 11개 파일과 `docs/cli-contract.md`를 검토했다. 타입 검사와 빌드가 통과했고 계약에 Git이나 테스트 러너를 전제로 한 필드가 없다.
- G3 구현 인수: G3a 완료(B2, B3, C1, C2 병합, main `7b39c96`). G3b(B1 조립 병합) 대기.
- G4 채택: 대기.

## 검증 기록

| 시점 | 위치 | 명령 | 결과 |
| --- | --- | --- | --- |
| G2 | main `cc29b50` | `npm ci`, `npm run typecheck`, `npm run build` | 통과 |
| G2 | worktree 6개 | `npm ci`, `npx tsc -p tsconfig.json --noEmit` | 통과 |
| 배분 | main | `node scripts/check-secrets.mjs --tracked` | 발견 없음 |
| 배분 | 임시 저장소 | 가짜 키와 `.env`를 스테이징해 `check-secrets.mjs --staged` 자체 시험 | 두 건 모두 탐지(종료 코드 1) |
| G3a 전 | 작업 브랜치 5개 | `node scripts/review-branch.mjs`, 각 worktree `npm run test:unit` | 모두 PASS. 유닛 C1 22, B2 35, C2 33, B3 18, B1 1단계 44 통과, 실패 0 |
| G3a | main `7b39c96` | `npm run typecheck`, `npm run test:unit`, `check-secrets --tracked` | 통과. 유닛 108건 통과, 실패 0, 건너뜀 0. 비밀 발견 없음 |

- 프로세스 통합 테스트는 작성되어 main에 있으나 CLI가 아직 main에 없어 실행하지 않았다. 유닛 통과를 통합 검증 통과로 보지 않는다.
- 실제 API 검증은 실행하지 않았다(1b 미수행). 모의 모델을 이용한 오프라인 검증을 실제 API 성공으로 표시하지 않는다.

## 결정 기록

- 2026-11-12 G2: 기반 계약을 재설계 없이 채택했다. 중단 시점의 파일이 타입 검사를 통과했고 문서 계약과 일치했다.
- 2026-11-12: 작업 B를 B1/B2로, 작업 C를 C1/C2로 나눴다. 디렉터리 단위로 소유가 겹치지 않고 계약 인터페이스로만 연결되므로 병렬 진행이 가능하다. optional 탭의 빈 세션 p5, p6, p7을 사용자 승인에 따라 배정했다.
- 2026-11-12: 사용자 지시에 따라 작업 B2에서 검증기·기록을 B3(p8)로 다시 나눴고, 검증 체계(배분 문서 5절)와 API 키 커밋 배제 수단(6절)을 추가했다.
- 계약의 미정 항목에 대한 PM 결정 P-1~P-7은 배분 문서 3절에 있다.

## 남은 문제

- `CODARYN_SECRET` 리터럴이 든 파일은 치환 계층이 변형 토큰으로 보아 수정할 수 없다. Codaryn 자신의 소스가 해당하므로 자기 개발 단계 전에 완화 여부를 정해야 한다.
- Windows에서 `.cmd`/`.bat`(예: npm)은 셸 없이 실행되지 않는다. 명령 도구와 명령 검증기는 `node` 같은 실행 파일만 쓸 수 있다.
- 교차 검토(p5, p6, p7) 결과 대기.
- 지원 OS와 Windows에서 자식 프로세스 트리 종료를 검증하는 방법(통합 검증에서 확인).
- 파일 해시가 모델과 기록에 노출되는 점(알려진 한계로 기록).
- 실제 Anthropic 어댑터는 1a에 넣지 않는다. AD-01~06은 "미도입"으로 보고한다.
