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
| CP-10 | 단계 2 병합 | 수정 묶음 T(p5 `b807001`, p6 `a51002c`, p7 `c3d9865`, p8 `2f014a4` `c748821` `1677b1c`, 계약 `f45959a`)와 p4의 통합 테스트 `52a634d` `2410686`를 합친 뒤 PM이 병합 전에 전체를 실행해 통과를 확인하고 main `4074d5c`로 병합 | `4074d5c`와 이 문서를 담은 커밋 | 완료 |
| CP-11 | 일시 정지 | 사용자 지시로 전체 작업을 멈췄다. 단계 3 구현(무결성 확인, 설치 위치 거부, report, doctor, 후보 스크립트), 수정 V·W·X, `models` 명령, 사용성·UX 설계, 문서화 누락 보완을 main `39219c8`까지 병합. 작업 브랜치를 원격에 올림 | `39219c8`과 이 문서를 담은 커밋 | 완료 |

## 사용자 상시 지시 (2026-11-12)

사용자가 임시 PM에게 직접 지시했다: "GUI 등 최종 모든 설계를 중간에 멈추지 말고 내 지시가 없으면 끝까지 연속 진행하고 있어." PM은 이를 다음과 같이 적용한다.

- roadmap의 남은 단계(단계 3 마무리, 단계 4 범용 작업 확장, 단계 5 GUI·IDE)를 사용자의 추가 지시 없이 차례로 설계·구현·검증한다. 미정 항목은 PM이 정하고 근거를 작업 지시서에 남긴다.
- 그대로 지키는 한계: PM과 작업자는 실제 Anthropic API를 호출하지 않고 키 파일을 읽지 않는다. 과금이 걸린 선택(세션 사용 한도 창 등)과 force push, 이력 재작성은 하지 않는다. `docs/pm-control.json`이 active가 아니면 멈춘다.
- 실제 API 검증이 필요한 완료 판단(1b, 단계 2·3의 실 API 기준)은 "미수행"으로 적고 다음 단계의 오프라인 작업을 계속한다.

- 추가 지시(같은 날): 편의성을 확보하게 설계한다. 설계 전문가를 다시 붙여 사용성 개선을 협의하고 추가 설계한다. UX 설계도 진행하고 모두 문서화한다. 문서화 없이 진행된 부분은 다 문서화한다. 모델명을 외워 치지 않도록 모델 목록을 불러와 고를 수 있게 한다(결정 Y-1~Y-5, `work-orders/phase-3-self-development.md`).
- 적용: p6이 사용성 검토와 UX 설계 문서(`docs/design/usability-review.md`, `docs/design/ux-design.md`)를, p8이 문서화 누락 점검과 설계 문서 보완(`architecture.md`, `decisions.md`, `privacy.md`, `testing.md`, `unit-test-plan.md`, `development-workflow.md`, `personas.md`, `docs/design/implementation-map.md`)을 맡았다. 선택지는 각 문서의 "결정 필요"에 권고안과 함께 올라오고 PM이 정해 작업 지시서에 기록한다.

## 현재 상태 (CP-11, 일시 정지)

**사용자가 2026-11-12에 "지금까지 작업된 부분들 커밋 푸시하고 작업 재개할 수 있도록 정리 후 일시 정지"라고 지시했다. 모든 작업자를 멈췄고 재개 지시를 기다린다.**

- main `39219c8`(원격과 같음)에 다음이 들어 있다: 단계 1a, 설정과 Anthropic 제공자, 단계 2(재수정 반복, 보호 경로, 스냅샷과 `revert`, `.cmd` 실행), 단계 3 오프라인 기구(무결성 확인, 설치 위치 거부, `report`, `doctor`, 후보 준비 스크립트), `codaryn models`, 교차 검토 결함 수정(S, T, V, W, X), 사용성·UX 설계 문서, 구현에 맞춘 설계 문서.
- 실행한 검증(병합 직전의 합친 트리, PM 실행): `npx tsc --noEmit` 통과, `npm run test:unit` 726건 중 725 통과·실패 0·건너뜀 1(대소문자를 구분하는 파일 시스템 전용 사례), `npm run test:integration` 343건 통과·실패 0, `node scripts/check-secrets.mjs --tracked` 발견 없음.
- 실행하지 않은 검증: **실제 Anthropic API 호출은 한 번도 하지 않았다.** `tests/live` 점검, 실제 `npm test` 실행, Windows 외 OS, OS 수준 격리, 실제 모델로 하는 자기 개발은 모두 미수행이다. `codaryn models`의 실제 목록 조회도 가짜 서버로만 확인했다.
- 미해결 문제:
  - 통합 전체 4회 중 1회, V-2 사례에서 CLI가 빈 stdout으로 끝났다(약 235ms). p4가 진단을 보강하고 10회 재실행했으나 재현되지 않았다. 원인 미확정이다. 진단 보강 커밋 `688a918`(wip)은 `claude/cli-verification`에 있고 main에는 없다.
  - `models` 명령의 통합 사례(`dd638a3`, `832168d`)는 `claude/cli-verification`에 있고 main에는 없다. `models` 연결(`b380410`)이 병합됐으므로 재개하면 먼저 실행해 통과를 확인한 뒤 병합한다.
  - w1:p1은 주간 사용 한도로 멈춰 있다(11월 15일 오전 3시 초기화). 화면의 선택 창에 PM은 답하지 않았다. 선택 표시는 2번에 가 있다.
- 진행 중이던 작업(코드 변경 없이 멈춤): 사용성 개선 N-A(p7, 계약 준비 단계), N-B(p5, 고정 문구 조사), N-C(p6, 설계). 세 작업 모두 소유 파일을 아직 만들지 않았다. 조사·설계 메모는 각 worktree의 `.codaryn/`에 있다(Git 무시, 로컬에만 있음).
- 모든 worktree는 깨끗하다(미커밋 변경 없음). 공용 Git 훅(`.git/hooks/pre-commit`)은 그대로 있다.

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

## 세션 (CP-11, 모두 정지)

| pane | tab | 마지막 작업 | worktree | 브랜치 | 상태 | 정지 보고 |
| --- | --- | --- | --- | --- | --- | --- |
| w1:p1 | main | (역할 1) | `claude-design` | `claude/core-engine` | 주간 사용 한도로 정지, 선택 창 대기 | 없음 |
| w1:p4 | main | 간헐 실패 조사 Z-1, `models` 통합 사례 | `claude-operations` | `claude/cli-verification` | 정지. main보다 앞선 커밋 있음(미병합) | `.codaryn/report-pause.md` |
| w1:p5 | optional | N-B 문구 카탈로그(조사 단계) | `claude-quality` | `claude/security-core` | 정지. main과 같음 | `.codaryn/report-pause.md` |
| w1:p6 | optional | N-C 사람용 출력·실행 목록(설계 단계) | `claude-tools` | `claude/core-tools` | 정지. main과 같음 | `.codaryn/report-pause.md` |
| w1:p7 | optional | N-A 계약과 CLI 핵심(준비 단계). 역할 1 | `claude-workspace` | `claude/workspace-policy` | 정지. 병합됨 | `.codaryn/report-pause.md` |
| w1:p8 | optional | D2 문서화 보완(완료). 다음은 N-D | `claude-store` | `claude/revert-store` | 정지. 병합됨 | `.codaryn/report-pause.md` |
| w1:p3 | main | PM·통합 | main | `main` | 정지 | 이 문서 |
| w1:p2 | main | Codex | — | — | 대기(회수 권한 보유) | — |

세션 ID는 바뀔 수 있으므로 `herdr agent list`로 실제 상태를 확인한다. 보존된 이전 브랜치: `claude/cli-foundation`(기반, 병합됨), `claude/quality`, `claude/quality-ready` 등 초안 브랜치는 삭제하지 않았다.

## 재개 방법

재개 지시가 오면 다음 순서로 한다. 누가 재개하든(임시 PM, Codex) 같다.

1. `docs/pm-control.json`의 status와 위임 ID를 확인한다.
2. `git -C D:\project\Codaryn status -sb`와 `git worktree list`로 main이 원격과 같고 worktree가 깨끗한지 확인한다. `herdr agent list`로 세션 상태를 확인한다(세션이 닫혔으면 새 세션에 아래 문서를 읽혀 배정한다).
3. main에서 `npm ci`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`을 돌려 기준 상태를 확인한다.
4. `claude/cli-verification`을 main과 합쳐 `models` 통합 사례와 진단 보강을 실행하고, 통과하면 병합한다. 간헐 실패(Z-1)는 진단이 보강된 상태로 다시 나타나면 종료 코드와 stderr로 원인을 찾는다.
5. 사용성 개선을 이어 간다(`work-orders/phase-4-usability.md`): p7이 계약을 먼저 커밋 → p5(N-B), p6(N-C) 병렬 → p7 연결 → p8(N-D 체험 예시와 사용 문서) → p4 통합 → 교차 검토.
6. 그다음 순서: 단계 4 범용 작업 확장 설계와 구현, 어댑터 계약 정의, VS Code 확장(결정 N-13), 독립 GUI 설계 문서. 사용자의 상시 지시(추가 지시가 없으면 끝까지 연속 진행)는 재개 뒤에도 유효하다.
7. 사용자가 직접 해야 하는 것: 실제 호출 점검(`tests/live/README.md`), p1 세션의 사용 한도 선택.

## 회수 시 인계 방법

1. 이 문서의 마지막 체크포인트와 세션 표를 읽는다.
2. `git -C D:\project\Codaryn worktree list`와 각 worktree의 `status --short`, `log --oneline -3`로 실제 상태를 확인한다.
3. 병합되지 않은 작업 브랜치는 그대로 둔다. 진행 중인 작업자는 `herdr agent read <pane>`으로 마지막 보고를 확인한다.
