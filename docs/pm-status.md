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
| CP-6 | G4 | 교차 검토 수정 `7a74c2c`(privacy), `df1ceff`(tools), `7eca0c0`(workspace), `54e59fd` `2323ad6` `2b5167c`(engine, 계약 문서), 회귀 통합 테스트 `db1e043` 병합. main `db1c55c`에서 유닛 189건, 통합 76건 통과. 수용 기준 A1~A12 대조 후 1a 오프라인 검증을 채택 | `db1c55c`와 이 문서를 담은 커밋 | 완료 |

## 현재 상태 (CP-6)

- 단계 1a 오프라인 검증을 임시 PM이 채택했다(G4, 2026-11-12). 1b(실제 API)는 수행하지 않았으며 위임 범위 밖이다. 단계 1 전체는 완료가 아니다.
- main `db1c55c`: `node dist/src/cli/main.js run --task <task.json>`이 모의 모델로 코드 작업과 Git 없는 문서 작업을 끝까지 실행한다.
- 실행한 검증(main `db1c55c`): `npm run typecheck` 통과, `npm run test:unit` 189건 통과, `npm run test:integration` 76건 통과(실패 0, 건너뜀 0), `node scripts/check-secrets.mjs --tracked` 발견 없음.
- 실행하지 않은 검증: 실제 Anthropic API(1b), Windows 외 OS, OS 수준 격리와 네트워크 차단, 강제 종료 시 파일 원자성. AD-01~06과 PR-04, PR-12는 1a 미도입이다.
- 교차 검토에서 재현된 결함 13건 중 수정 대상 11건을 회귀 테스트와 함께 고쳤다. 나머지는 알려진 한계로 `docs/cli-contract.md` 10절과 progress.md에 적었다.
- 모든 작업자(p1, p4, p5, p6, p7, p8)는 대기 중이고 각 worktree는 깨끗하다. 작업 브랜치는 모두 main에 병합됐고 삭제하지 않았다.
- 권한 창 처리: p1, p4, p5에서 "작업 디렉터리 밖 읽기 허용" 창이 떴을 때 PM이 3번(아니오, 다음에 다시 묻기)으로 닫았다. 사용자 설정은 바꾸지 않았다.
- 관찰: p5 세션의 모델이 Opus 5.5로 바뀌어 있었다. PM이 바꾼 것이 아니며 그대로 두었다.
- 공용 Git 훅: `.git/hooks/pre-commit`과 `.git/hooks/check-secrets.mjs`(추적되지 않음, 모든 worktree에 적용).
- 차단 요인: 다음 단계(1b)는 범위 결정이 필요하다.

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
| w1:p1 | main | B1 엔진·모의 모델·CLI, 역할 1 | `claude-design` | `claude/core-engine` | `cc29b50` | 병합됨. 대기 |
| w1:p6 | optional | B2 도구·명령 실행기 | `claude-tools` | `claude/core-tools` | `cc29b50` | 병합됨. 대기 |
| w1:p8 | optional | B3 검증기·기록·잠금 | `claude-store` | `claude/core-store` | `cc29b50` | 병합됨. 대기 |
| w1:p5 | optional | C1 민감정보 게이트 | `claude-quality` | `claude/security-core` | `cc29b50` | 병합됨. 대기 |
| w1:p7 | optional | C2 정책·작업 공간 | `claude-workspace` | `claude/workspace-policy` | `cc29b50` | 병합됨. 대기 |
| w1:p4 | main | D 독립 통합 검증 | `claude-operations` | `claude/cli-verification` | `cc29b50` | 76건 통과. 대기 |
| w1:p3 | main | PM·통합 | main | `main` | — | 진행 |
| w1:p2 | main | Codex | — | — | — | 대기(회수 권한 보유) |

세션 ID는 바뀔 수 있으므로 `herdr agent list`로 실제 상태를 확인한다. 보존된 이전 브랜치: `claude/cli-foundation`(기반, 병합됨), `claude/quality`, `claude/quality-ready` 등 초안 브랜치는 삭제하지 않았다.

## 다음 행동

위임 범위(단계 1a)의 작업은 끝났다. 아래는 PM을 인계받는 쪽이나 범위를 넓힌 뒤에 할 일이다.

1. 1b 결정: 실제 Anthropic 어댑터 구현과 호출을 열지 정한다. 필요한 것은 모델 결정(O-1), 로컬 `ANTHROPIC_API_KEY`와 `CODARYN_MODEL`, 호출·비용 한도다. 어댑터 유닛 AD-01~06을 구현과 함께 넣는다.
2. 개발 도구로 쓰기 위한 최소 추가: 실제 모델 연결(1b), 검증 실패를 반영한 재수정 반복(단계 2), Windows에서 `npm` 같은 `.cmd` 실행 방법.
3. 알려진 한계 중 우선 판단할 것: 비밀이 든 줄은 수정할 수 없음, `allowExtraArgs:true` 규칙의 추가 인자 경로 미검사, 파일 해시 노출.
4. 작업 브랜치와 worktree 정리 여부는 Codex가 정한다. PM은 삭제하지 않았다.

## 회수 시 인계 방법

1. 이 문서의 마지막 체크포인트와 세션 표를 읽는다.
2. `git -C D:\project\Codaryn worktree list`와 각 worktree의 `status --short`, `log --oneline -3`로 실제 상태를 확인한다.
3. 병합되지 않은 작업 브랜치는 그대로 둔다. 진행 중인 작업자는 `herdr agent read <pane>`으로 마지막 보고를 확인한다.
