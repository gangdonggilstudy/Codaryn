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
| CP-5 | G3b와 교차 검토 | B1 조립 `e8b5bd2` 병합(`58dcfde`). 첫 통합 실행에서 13건 실패, 원인은 거부된 호출의 `tool_result` 미기록. 엔진 수정 `5333feb` 병합(`3982a6c`) 뒤 유닛 157건, 통합 63건 통과. 교차 검토 보고 3건을 `docs/reviews/`에 기록(`e70b827`)하고 결함 수정과 회귀 테스트를 배정 | `3982a6c`, `e70b827`과 이 문서를 담은 커밋 | 완료 |

## 현재 상태 (CP-5)

- 단계 1a. G0, G1, G2, G3a, G3b는 열렸다. G4(채택)는 교차 검토 결함 수정 뒤에 판단한다.
- main `3982a6c`에 계약, privacy, policy, workspace, tools, verify, store, engine, model, cli와 통합 테스트가 모두 있다. `node dist/src/cli/main.js run --task <task.json>`이 모의 모델로 끝까지 실행된다.
- 실행한 검증(main `3982a6c`): `npm run typecheck` 통과, `npm run test:unit` 157건 통과, `npm run test:integration` 63건 통과(실패 0, 건너뜀 0), `check-secrets --tracked` 발견 없음.
- 실행하지 않은 검증: 실제 API(1b 미수행). 통합 통과는 검사한 사례의 증거이며 아래 교차 검토 결함은 그 사례에 없던 경로다.
- 교차 검토 결과(`docs/reviews/2026-11-12-cross-review-*.md`): 재현된 결함은 privacy 6건(높음 1), tools 5건(높음 1)과 엔진 경계 1건, workspace 1건이다. 설계 한계로 분류한 것은 문서에 기록한다.
- 진행 중인 수정: p5(privacy: 원위치 규칙 강화, 겹치는 비밀, 토큰 조각 리터럴, 재가림 안정성, 변형 목록 확장), p6(tools: 가림본 검색, 가린 뒤 자르기, 출력 상한 경계, 자식 환경 값 검사), p7(workspace: 새 파일 덮어쓰기 경쟁), p1(engine: 직렬화 전 필드별 가림, 계약 주석과 알려진 한계 문서), p4(위 결함의 프로세스 수준 회귀 테스트). p8은 대기다.
- 권한 창 처리: p1, p4, p5에서 "작업 디렉터리 밖 읽기 허용" 창이 떴다. 사용자 설정을 바꾸지 않도록 PM이 3번(아니오, 다음에 다시 묻기)으로 닫고, 검토 원문을 저장소 `docs/reviews/`에 커밋해 그 경로를 읽게 했다. 작업자 보고서는 각 worktree의 `.codaryn/`(Git 무시)에 저장하게 했다.
- 관찰: p5 세션의 모델이 Opus 5.5로 바뀌어 있었다. PM이 바꾼 것이 아니며 그대로 두었다.
- 공용 Git 훅: `.git/hooks/pre-commit`과 `.git/hooks/check-secrets.mjs`(추적되지 않음, 모든 worktree에 적용).
- 차단 요인: 없음.

### PM 결정 (CP-4, CP-5)

- 도구가 `workspace.resolve` 거부를 `policy_denied`로 돌려주는 것을 승인했다. 계약에 도구 전용 코드를 추가하지 않는다.
- 정책의 거부 사유 보고 순서(path, command, network, destructive, restore)와 내장 도구 고정 요구 표와의 합산 판정을 승인했다.
- Workspace 계약에 `exists`/`stat`을 추가하지 않는다.
- 실행 기록에는 모델에 돌려준 모든 도구 결과를 `tool_result`로 남긴다. 거부된 호출도 `tool_decision` 뒤에 `ok:false` 결과를 기록한다.
- 원위치 규칙을 강화한다: `mask(original)`과 `maskedNext`를 줄로 나눠, 토큰이 든 줄의 목록이 내용과 순서 모두 같아야 한다. 토큰이 없는 줄만 자유롭게 바꿀 수 있다. 비밀이 든 줄 자체는 수정할 수 없다.
- 겹치는 비밀 일치는 구간을 합쳐 하나의 보호 구간으로 만든다. 원문의 `CODARYN_SECRET` 조각은 거부하지 않고 보호 구간으로 가린다(자기 소스 수정이 가능해지도록).
- 검색은 가림본을 대상으로 한다. 자르기는 가린 뒤 토큰 경계에서 한다. 엔진은 직렬화 전에 문자열 필드별로 가린다.
- `allowExtraArgs:true`인 명령 규칙은 추가 인자의 경로를 검사하지 않는다. 코드는 바꾸지 않고 알려진 한계로 문서화한다.
- 알려진 한계로 기록: 파일 해시가 모델과 기록에 노출됨, `CODARYN_SECRET` 리터럴이 든 파일은 수정할 수 없음(자기 개발 단계 전에 완화 여부를 정해야 한다), Windows에서 `.cmd`/`.bat`은 셸 없이 실행되지 않음.

## 세션

| pane | tab | 작업 | worktree | 브랜치 | 기준 커밋 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| w1:p1 | main | B1 엔진·모의 모델·CLI, 역할 1 | `claude-design` | `claude/core-engine` | `cc29b50` | 병합됨. 엔진 수정 진행 |
| w1:p6 | optional | B2 도구·명령 실행기 | `claude-tools` | `claude/core-tools` | `cc29b50` | 병합됨. 결함 수정 진행 |
| w1:p8 | optional | B3 검증기·기록·잠금 | `claude-store` | `claude/core-store` | `cc29b50` | 병합됨. 대기 |
| w1:p5 | optional | C1 민감정보 게이트 | `claude-quality` | `claude/security-core` | `cc29b50` | 병합됨. 결함 수정 진행 |
| w1:p7 | optional | C2 정책·작업 공간 | `claude-workspace` | `claude/workspace-policy` | `cc29b50` | 병합됨. 결함 수정 진행 |
| w1:p4 | main | D 독립 통합 검증 | `claude-operations` | `claude/cli-verification` | `cc29b50` | 63건 통과. 회귀 테스트 추가 진행 |
| w1:p3 | main | PM·통합 | main | `main` | — | 진행 |
| w1:p2 | main | Codex | — | — | — | 대기(회수 권한 보유) |

세션 ID는 바뀔 수 있으므로 `herdr agent list`로 실제 상태를 확인한다. 보존된 이전 브랜치: `claude/cli-foundation`(기반, 병합됨), `claude/quality`, `claude/quality-ready` 등 초안 브랜치는 삭제하지 않았다.

## 다음 행동

1. 수정 브랜치 다섯 개(`claude/security-core`, `claude/core-tools`, `claude/workspace-policy`, `claude/core-engine`, `claude/cli-verification`)의 보고를 받아 `scripts/review-branch.mjs`와 유닛으로 검토하고 병합한다. 모듈 수정을 먼저, 회귀 통합 테스트를 나중에 병합한다.
2. main에서 타입 검사, 유닛, 통합 전체를 다시 돌린다. 남는 실패는 담당자에게 재현 사례로 돌려준다.
3. 수용 기준 A1~A12와 대조해 G4를 판단하고 결과와 알려진 한계를 progress.md에 기록한다.
4. 1a 완료를 보고한다. 실제 API 연결(1b)은 위임 범위 밖이므로 범위 확대 여부를 사용자와 Codex가 정한다.

## 회수 시 인계 방법

1. 이 문서의 마지막 체크포인트와 세션 표를 읽는다.
2. `git -C D:\project\Codaryn worktree list`와 각 worktree의 `status --short`, `log --oneline -3`로 실제 상태를 확인한다.
3. 병합되지 않은 작업 브랜치는 그대로 둔다. 진행 중인 작업자는 `herdr agent read <pane>`으로 마지막 보고를 확인한다.
