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
| CP-7 | 설정과 제공자 | 사용자 직접 지시("설정 가능하게 해")에 따라 설정 계약 `86f3d62`, CLI 설정 처리 `7a2d02d`, Anthropic 제공자 `a5f62e7`, 조립 `7359cef`, 가짜 서버 통합 테스트와 실제 호출 점검 스크립트 `e8dbdb9`를 병합. main `dd930e2`에서 유닛 234건, 통합 130건 통과. 실제 API 미실행 | `dd930e2`와 이 문서를 담은 커밋 | 완료 |
| CP-8 | 단계 2 착수 | 사용자 직접 지시("단계 2 재수정 반복도 이어서 진행해", "세션들 최대한 활용해서 진행해줘 투입 가능하게")에 따라 작업 지시서 `docs/work-orders/phase-2-repair-loop.md` 작성. F1(p1), F5 준비(p4), G1(p6), G2(p5), H1(p7), H2(p8) 배정. 작업자 브랜치를 main `0164b10`에 맞춤 | `0164b10`과 이 문서를 담은 커밋 | 완료 |
| CP-9 | 단계 2 구현과 검토 | 재수정 반복 엔진, 보호 경로, 스냅샷·되돌리기, `.cmd` 실행, 제공자 수정, CLI 보안 모듈, 사용 문서를 main에 병합(`5989d79`까지). 교차 검토 H1·H2·F6와 결정 S-1~S-12, T-1~T-15를 기록(`1037593`). p1의 연결 커밋 `3f3756d`는 통합 8건 실패가 남아 main 미병합. p1이 주간 사용 한도로 멈춰 PM이 p1의 계약 변경을 검증 후 `f45959a`로 커밋하고 나머지를 p5~p8에 재배정 | `1037593`과 이 문서를 담은 커밋 | 완료 |

## 현재 상태 (CP-9)

- 사용자 직접 지시로 단계 2와 투입 준비를 진행 중이다. `docs/pm-control.json`의 범위는 PM이 바꾸지 않았다.
- main(`1037593`)은 통과 상태다: 유닛 388건 중 387 통과·1 건너뜀, 통합 130건 통과(`5989d79`에서 실행. 그 뒤 main에는 스크립트와 문서 커밋만 있다). 실제 API는 호출한 적이 없다.
- main에 없는 것: 단계 2 조립과 보안 검사 S-1~S-9의 실행 경로 연결. 로컬 브랜치 `claude/core-engine`(`3f3756d`, 계약 추가 `f45959a`)에 있다. 이 브랜치 기준으로 p4가 돌린 통합은 246건 중 238 통과·8 실패이며, 실패는 제품 결함 3건(T-1, T-6, T-15)에서 나온다.
- **차단 요인: w1:p1이 주간 사용 한도에 걸려 멈췄다(11월 15일 오전 3시 초기화).** 화면에 선택 창이 떠 있다: 1) 멈추고 초기화를 기다림 2) 여기서 기다렸다가 자동으로 계속 3) 사용 크레딧으로 전환. 과금이 걸린 선택이라 PM은 답하지 않았다. 창 내용을 읽으려고 PM이 Down 키를 네 번 눌러 선택 표시가 2번으로 옮겨져 있다(확정하지 않음). 다른 세션도 같은 한도에 걸릴 수 있다.
- p1의 worktree `claude-design`(브랜치 `claude/core-engine`)은 `f45959a`에서 깨끗한 상태로 멈춰 있다. p1이 쓰고 커밋하지 못한 계약 변경은 PM이 타입 검사와 유닛(405건 중 404 통과·1 건너뜀)을 확인한 뒤 그대로 커밋했다. p1이 다시 움직이면 다른 세션과 겹치지 않게 먼저 지시를 갱신해야 한다.
- 재배정(수정 묶음 T): p5 엔진(`src/engine`), p6 도구(`src/tools`), p7 정책·보안 모듈·CLI(`src/policy`, `src/cli`, `docs/cli-contract.md`), p8 검증기·저장소(`src/verify`, `src/store`). 모두 `claude/core-engine`을 자기 브랜치에 병합해 작업한다. p4는 통합 재실행 대기다.
- 공용 Git 훅(`.git/hooks/pre-commit`)이 모든 worktree에서 비밀을 검사한다. 검토 보고서의 가짜 키 대입 문장도 막으므로 문서에는 값 없이 적는다.

### PM 결정 (CP-4, CP-5)

- 도구가 `workspace.resolve` 거부를 `policy_denied`로 돌려주는 것을 승인했다. 계약에 도구 전용 코드를 추가하지 않는다.
- 정책의 거부 사유 보고 순서(path, command, network, destructive, restore)와 내장 도구 고정 요구 표와의 합산 판정을 승인했다.
- Workspace 계약에 `exists`/`stat`을 추가하지 않는다.
- 실행 기록에는 모델에 돌려준 모든 도구 결과를 `tool_result`로 남긴다. 거부된 호출도 `tool_decision` 뒤에 `ok:false` 결과를 기록한다.
- 원위치 규칙을 강화한다: `mask(original)`과 `maskedNext`를 줄로 나눠, 토큰이 든 줄의 목록이 내용과 순서 모두 같아야 한다. 토큰이 없는 줄만 자유롭게 바꿀 수 있다. 비밀이 든 줄 자체는 수정할 수 없다.
- 겹치는 비밀 일치는 구간을 합쳐 하나의 보호 구간으로 만든다. 원문의 `CODARYN_SECRET` 조각은 거부하지 않고 보호 구간으로 가린다(자기 소스 수정이 가능해지도록).
- 검색은 가림본을 대상으로 한다. 자르기는 가린 뒤 토큰 경계에서 한다. 엔진은 직렬화 전에 문자열 필드별로 가린다.
- `allowExtraArgs:true`인 명령 규칙은 추가 인자의 경로를 검사하지 않는다. 코드는 바꾸지 않고 알려진 한계로 문서화한다.
- 설정 결정 C-1~C-8(`docs/work-orders/phase-1b-config.md`): 키는 환경 변수로만, 설정·env 파일은 명시했을 때만, 모델과 출력 상한에 코드 기본값 없음, API 주소는 task로 바꿀 수 없음, 한도 없이는 호출하지 않음.
- 전송은 SDK 대신 Node 내장 `fetch`를 쓴다. 허용 의존성을 넓히지 않기 위해서이며 architecture와 decisions의 "공식 SDK" 선택과 다르다. 두 문서의 갱신은 Codex 판단에 맡긴다.
- 1a 자리표시자 `src/model/anthropic.ts`와 그 유닛 2건은 실제 제공자로 대체되어 삭제했다. 같은 동작은 `tests/unit/cli/anthropic-wire.test.ts`와 통합 m02가 확인한다.
- 알려진 한계로 기록: 파일 해시가 모델과 기록에 노출됨, `CODARYN_SECRET` 리터럴이 든 파일은 수정할 수 없음(자기 개발 단계 전에 완화 여부를 정해야 한다), Windows에서 `.cmd`/`.bat`은 셸 없이 실행되지 않음.

## 세션 (CP-9)

| pane | tab | 현재 작업 | worktree | 브랜치 | 상태 |
| --- | --- | --- | --- | --- | --- |
| w1:p1 | main | (역할 1, CLI) | `claude-design` | `claude/core-engine` | **주간 사용 한도로 정지. 선택 창 대기** |
| w1:p4 | main | 통합 검증 | `claude-operations` | `claude/cli-verification` | 수정 병합 뒤 재실행 대기 |
| w1:p5 | optional | 수정 T 엔진 | `claude-quality` | `claude/security-core` | 진행 |
| w1:p6 | optional | 수정 T 도구 | `claude-tools` | `claude/core-tools` | 진행 |
| w1:p7 | optional | 수정 T 정책·보안·CLI | `claude-workspace` | `claude/workspace-policy` | 진행 |
| w1:p8 | optional | 수정 T 검증기·저장소 | `claude-store` | `claude/revert-store` | 진행 |
| w1:p3 | main | PM·통합 | main | `main` | 진행 |
| w1:p2 | main | Codex | — | — | 대기(회수 권한 보유) |

세션 ID는 바뀔 수 있으므로 `herdr agent list`로 실제 상태를 확인한다. 보존된 이전 브랜치: `claude/cli-foundation`(기반, 병합됨), `claude/quality`, `claude/quality-ready` 등 초안 브랜치는 삭제하지 않았다.

## 다음 행동

1. p5~p8의 수정 커밋을 `scripts/review-branch.mjs`(기준이 main이므로 `claude/core-engine`의 커밋도 함께 보인다. 각 브랜치 자체 커밋의 파일을 확인한다)와 유닛으로 검토한다.
2. `claude/core-engine`과 네 수정 브랜치를 p4 브랜치에 모아 통합을 다시 돌린다. 통과하면 main에 병합하고 전체를 다시 실행한다.
3. 사용 문서(`docs/usage.md`, `examples/`)를 `--vars-file`, 재수정 반복, `revert`, 새 한계에 맞게 갱신한다.
4. 투입 조건 대조: 실제 호출 점검(사용자 실행), 단계 2 통합 통과, `.cmd` 실행이 실제 CLI에서 동작, 검토 결함 수정.
5. p1의 사용 한도 선택은 사용자가 정한다.

## 회수 시 인계 방법

1. 이 문서의 마지막 체크포인트와 세션 표를 읽는다.
2. `git -C D:\project\Codaryn worktree list`와 각 worktree의 `status --short`, `log --oneline -3`로 실제 상태를 확인한다.
3. 병합되지 않은 작업 브랜치는 그대로 둔다. 진행 중인 작업자는 `herdr agent read <pane>`으로 마지막 보고를 확인한다.
