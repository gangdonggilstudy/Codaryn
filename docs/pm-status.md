# 임시 PM 상태

Codex가 PM을 다시 인계받을 때 읽는 체크포인트다. 임시 PM이 작업 묶음마다 갱신한다. 작업별 상세는 [개발 진행 현황](progress.md), 배분과 PM 결정은 [단계 1a 작업 배분](work-orders/phase-1a-assignments.md)에 둔다.

## 위임

- 위임 ID: pm-20261112-01. 기준 파일은 main의 `docs/pm-control.json`이다.
- 임시 PM: w1:p3 (session 9e1f6ad3-ed8e-4c37-9a0d-ff5f98137423), 페르소나는 개발 PM 겸 수석 소프트웨어 아키텍트.
- 인수: 2026-11-12 완료(`789733f`). 범위는 단계 1a다.
- 작업 배분, 변경 묶음, 커밋, 병합, 푸시 전에 status와 ID를 확인한다. active가 아니거나 ID가 다르면 새 배분과 변경을 멈추고 이 문서의 마지막 체크포인트를 보고한다.
- 실제 API 호출, 키 파일 조회, 모델 변경, force push, 기존 이력 재작성은 하지 않는다.

## 체크포인트 기록

| 번호 | 시점 | 내용 | main 커밋 | push |
| --- | --- | --- | --- | --- |
| CP-1 | 인수 | 위임 확인, 이 문서 생성 | `789733f` | 완료 |
| CP-2 | G2 | 기반 커밋 `cba57fa` 검토·병합, 작업자 worktree와 브랜치 준비, 배분 문서 작성 | `cc29b50`과 이 문서를 담은 다음 커밋 | 완료 |

## 현재 상태 (CP-2)

- 단계 1a. G0, G1, G2는 열렸다. G3(구현 인수)와 G4(채택)는 대기다.
- main에는 프로젝트 설정과 `src/contracts/**`, `docs/cli-contract.md`만 있다. 엔진, 도구, CLI, 테스트는 아직 없다.
- 실행한 검증: main과 다섯 worktree에서 `npm ci`, `tsc --noEmit` 통과. main에서 `npm run build` 통과.
- 실행하지 않은 검증: 유닛 테스트(0개), 프로세스 통합 테스트, 실제 API(1b 미수행).
- 미커밋 파일: 없음(main과 모든 worktree가 깨끗한 상태에서 배분했다).
- 차단 요인: 없음.

## 세션

| pane | tab | 작업 | worktree | 브랜치 | 기준 커밋 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| w1:p1 | main | B1 엔진·모의 모델·CLI, 역할 1 | `claude-design` | `claude/core-engine` | `cc29b50` | 배정 |
| w1:p6 | optional | B2 도구·검증기·기록 | `claude-tools` | `claude/core-tools` | `cc29b50` | 배정 |
| w1:p5 | optional | C1 민감정보 게이트 | `claude-quality` | `claude/security-core` | `cc29b50` | 배정 |
| w1:p7 | optional | C2 정책·작업 공간 | `claude-workspace` | `claude/workspace-policy` | `cc29b50` | 배정 |
| w1:p4 | main | D 독립 통합 검증 | `claude-operations` | `claude/cli-verification` | `cc29b50` | 배정 |
| w1:p3 | main | PM·통합 | main | `main` | — | 진행 |
| w1:p8 | optional | 예비 | — | — | — | 미배정 |
| w1:p2 | main | Codex | — | — | — | 대기(회수 권한 보유) |

세션 ID는 바뀔 수 있으므로 `herdr agent list`로 실제 상태를 확인한다. 보존된 이전 브랜치: `claude/cli-foundation`(기반, 병합됨), `claude/quality`, `claude/quality-ready` 등 초안 브랜치는 삭제하지 않았다.

## 다음 행동

1. 다섯 작업자에게 배분을 전달하고 이해 확인을 받는다.
2. B2, C1, C2의 커밋을 검토한다(소유 범위, 유닛 P0, 작성자와 메시지). 통과하면 main에 병합한다(G3a).
3. p1이 main을 병합해 조립을 끝내면 B1을 검토·병합한다(G3b).
4. D의 통합 테스트를 실행하고 수용 기준 A1~A12와 대조한다(G4).
5. 각 단계에서 이 문서와 progress.md를 갱신하고 push한다.

## 회수 시 인계 방법

1. 이 문서의 마지막 체크포인트와 세션 표를 읽는다.
2. `git -C D:\project\Codaryn worktree list`와 각 worktree의 `status --short`, `log --oneline -3`로 실제 상태를 확인한다.
3. 병합되지 않은 작업 브랜치는 그대로 둔다. 진행 중인 작업자는 `herdr agent read <pane>`으로 마지막 보고를 확인한다.
