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
| CP-2 | G2 | 기반 커밋 `cba57fa` 검토·병합, 작업자 worktree와 브랜치 준비, 배분 문서 작성 | `cc29b50`, `35b5102` | 완료 |
| CP-3 | 배분 | 여섯 작업(B1, B2, B3, C1, C2, D)을 Herdr로 전달. 검증 체계와 비밀 검사 스크립트·커밋 전 훅 추가 | 이 문서를 담은 커밋 | 완료 |
| CP-4 | G3a | B2 `9496d14`, B3 `d3e6350` `6d35746`, C1 `ec4aa5f`, C2 `ae27dc1` `063605d` `bca12d3`을 검토·병합. main 유닛 108건 통과. D의 통합 테스트 `8b40f46` `7942bfd` 병합(아직 실행 전). B1 조립과 교차 검토 지시 | `7b39c96`과 이 문서를 담은 커밋 | 완료 |

## 현재 상태 (CP-4)

- 단계 1a. G0, G1, G2, G3a는 열렸다. G3b(B1 조립 병합)와 G4(채택)는 대기다.
- main에는 계약, privacy, policy, workspace, tools, verify, store와 통합 테스트 파일이 있다. 엔진, 모의 모델, CLI는 `claude/core-engine`(`b67b620`)에 있고 아직 main에 없다.
- 실행한 검증: 각 작업 브랜치에서 `scripts/review-branch.mjs` PASS와 유닛 통과(C1 22, B2 35, C2 33, B3 18, B1 1단계 44). 병합 후 main에서 `npm run typecheck`, `npm run test:unit` 108건 통과, `check-secrets --tracked` 발견 없음.
- 실행하지 않은 검증: 프로세스 통합 테스트(CLI가 main에 없어 미실행), 실제 API(1b 미수행).
- 진행 중: p1이 main을 병합해 실제 모듈을 CLI에 조립한다. p5(대상 tools), p6(대상 policy·workspace), p7(대상 privacy)이 읽기 전용 교차 검토를 한다. p4와 p8은 대기다.
- 관찰: p5 세션에서 `/model`로 모델이 Opus 5.5로 바뀌어 있었다. PM이 바꾼 것이 아니며 그대로 두었다.
- 공용 Git 훅: `.git/hooks/pre-commit`과 `.git/hooks/check-secrets.mjs`(추적되지 않음, 모든 worktree에 적용).
- 차단 요인: 없음.

### PM 결정 (CP-4)

- 도구가 `workspace.resolve` 거부를 `policy_denied`로 돌려주는 것을 승인했다. 계약에 도구 전용 코드를 추가하지 않는다.
- 정책의 거부 사유 보고 순서(path, command, network, destructive, restore)와 내장 도구 고정 요구 표와의 합산 판정을 승인했다.
- Workspace 계약에 `exists`/`stat`을 추가하지 않는다.
- 알려진 한계로 기록: 파일 해시가 모델과 기록에 노출됨, `CODARYN_SECRET` 리터럴이 든 파일은 수정할 수 없음(자기 개발 단계 전에 완화 여부를 정해야 한다), Windows에서 `.cmd`/`.bat`은 셸 없이 실행되지 않음.

## 세션

| pane | tab | 작업 | worktree | 브랜치 | 기준 커밋 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| w1:p1 | main | B1 엔진·모의 모델·CLI, 역할 1 | `claude-design` | `claude/core-engine` | `cc29b50` | 2단계 조립 진행 |
| w1:p6 | optional | B2 도구·명령 실행기 | `claude-tools` | `claude/core-tools` | `cc29b50` | 병합됨. 교차 검토 중 |
| w1:p8 | optional | B3 검증기·기록·잠금 | `claude-store` | `claude/core-store` | `cc29b50` | 병합됨. 대기 |
| w1:p5 | optional | C1 민감정보 게이트 | `claude-quality` | `claude/security-core` | `cc29b50` | 병합됨. 교차 검토 중 |
| w1:p7 | optional | C2 정책·작업 공간 | `claude-workspace` | `claude/workspace-policy` | `cc29b50` | 병합됨. 교차 검토 중 |
| w1:p4 | main | D 독립 통합 검증 | `claude-operations` | `claude/cli-verification` | `cc29b50` | 테스트 작성분 병합됨. 최종 실행 대기 |
| w1:p3 | main | PM·통합 | main | `main` | — | 진행 |
| w1:p2 | main | Codex | — | — | — | 대기(회수 권한 보유) |

세션 ID는 바뀔 수 있으므로 `herdr agent list`로 실제 상태를 확인한다. 보존된 이전 브랜치: `claude/cli-foundation`(기반, 병합됨), `claude/quality`, `claude/quality-ready` 등 초안 브랜치는 삭제하지 않았다.

## 다음 행동

1. p1의 조립 보고를 받아 `claude/core-engine`을 검토·병합한다(G3b). main에서 타입 검사와 유닛 전체를 다시 돌린다.
2. main에서 `npm run test:integration`을 실행하고 실패를 모듈 담당자에게 재현 사례로 돌려준다.
3. 교차 검토 결과 중 확인된 결함을 담당자에게 배정하고 회귀 테스트와 함께 고치게 한다.
4. 수용 기준 A1~A12와 대조해 G4를 판단하고 이 문서와 progress.md를 갱신한다.

## 회수 시 인계 방법

1. 이 문서의 마지막 체크포인트와 세션 표를 읽는다.
2. `git -C D:\project\Codaryn worktree list`와 각 worktree의 `status --short`, `log --oneline -3`로 실제 상태를 확인한다.
3. 병합되지 않은 작업 브랜치는 그대로 둔다. 진행 중인 작업자는 `herdr agent read <pane>`으로 마지막 보고를 확인한다.
