# 임시 PM 인수인계

사용자가 토큰 사용을 줄이기 위해 Claude 한 세션에 PM을 임시 위임했다. 임시 PM은 w1:p3이고 위임 식별자는 pm-20261112-01이다. 사용자가 방향을 정하고 Codex는 언제든 관리 권한을 회수할 수 있다.

## 권한과 회수

- 권한의 기준 파일은 관리용 main의 D:\project\Codaryn\docs\pm-control.json이다. worktree의 복사본을 기준으로 삼지 않는다.
- 임시 PM은 작업 배분 전, 각 작업 묶음 시작 전, 커밋·병합·푸시 전에 이 파일의 status와 delegation_id를 확인한다. active가 아니거나 식별자가 다르면 새 지시와 변경을 중단하고 진행 상태를 보고한다.
- 활성 범위는 단계 1a의 코드·테스트·지정 의존성 설치·리뷰·통합·커밋·푸시다. 임시 PM은 관리용 main에서 문서와 검토된 변경을 통합할 수 있다. 실제 기능 코딩은 별도 작업 worktree에서 한다.
- 실제 API 호출, 키 파일 조회, 모델 변경, force push, 기존 이력 재작성은 허용하지 않는다. 1a 완료 후 검증 결과와 다음 단계 조건을 보고한다.
- 사용자가 PM 회수를 요청하면 Codex가 기준 파일을 revoked로 변경하고 Claude PM과 진행 중 작업을 중단시킨 뒤 체크포인트를 인수한다. 미커밋 변경과 초안 브랜치를 보존한다.
- 이 파일과 상태 값은 운영상의 회수 규칙이며 OS 수준 접근 통제는 아니다. 임시 PM이 회수 규칙이나 자신의 위임 범위를 임의로 바꾸지 않는다.

## 현재 상태

- main은 1cffbce까지 개발 전환·진행 문서를 기록했다. 이 인수인계 커밋은 그 뒤에 추가한다.
- 단계 0 완료, 단계 1a 기반 작업 A 진행 중. 실제 CLI와 제품 테스트는 아직 완성·검증되지 않았다.
- 개발 환경은 Windows, Node.js 26.13.0, npm 11.20.0, TypeScript 엄격 검사와 Node 기본 테스트 러너다. 설치 허용 개발 의존성은 typescript와 @types/node다.
- 기반 세션 w1:p1은 설계가 길어져 Codex가 Esc로 중단했다. 생성한 파일을 보존했으며 현재 후속 지시를 기다린다. 이를 삭제하거나 처음부터 다시 생성하지 않는다.
- claude-design worktree에 package.json, package-lock.json, tsconfig.json, src/contracts 아래 미커밋 파일이 있다. 설치된 개발 의존성은 node_modules에 있다. 타입 계약이 미완성일 수 있으므로 실제 파일을 읽어 빌드로 확인한다.
- cli-contract.md는 중단 시점에 아직 없다. 최소 계약·공개 CLI 형식을 먼저 완성해 검토한 뒤 후속 구현을 연다.

## 세션과 작업 공간

| 세션 | 역할과 상태 | worktree | 브랜치 |
| --- | --- | --- | --- |
| w1:p1 | 기반 구현 중단, 파일 보존 | D:\project\Codaryn\.worktrees\claude-design | claude/cli-foundation |
| w1:p3 | 임시 PM, 기존 보안 선행 검토 완료 | D:\project\Codaryn\.worktrees\claude-quality | claude/security-core |
| w1:p4 | 독립 검증 선행 검토 완료, 기반 인수 대기 | D:\project\Codaryn\.worktrees\claude-operations | claude/cli-verification |

세션 ID는 재로그인이나 종료 후 바뀔 수 있으므로 Herdr에서 실제 상태를 조회한다. 원래 터미널 cwd는 main일 수 있다. 파일과 Git 명령에 지정 worktree의 절대 경로를 쓴다.

## 바로 이어갈 순서

1. 공통 지침과 설계, 단계 1a 작업 지시서, 세션·Git 상태를 읽는다. Herdr 제어는 herdr --skill을 읽고 HERDR_ENV를 확인한 뒤 수행한다.
2. 남아 있는 기반 타입을 작게 완성하고 typecheck와 build를 통과시킨다. 기반 단계의 테스트 0개를 제품 테스트 통과로 보고하지 않는다.
3. 기반을 검토해 통합하고 후속 worktree를 그 기준에 맞춘 뒤 코어·보안 구현과 독립 통합 검증을 배분한다. 소유 파일은 겹치지 않게 한다.
4. 단위 P0와 실제 CLI 프로세스 검증을 수행한다. 코드 작업 하나와 Git 없는 문서 작업 하나를 모의 모델로 완주한다. 실제 API 미실행을 명시한다.
5. author는 gangdonggil <gangdonggilstudy@gmail.com>, trailer 없이 논리적 단위로 커밋한다. 기존 인증으로 origin/main 푸시가 성공한 상태다. SSH 키를 새로 만들 필요가 없다.
6. docs/progress.md에 실제 변경과 검증, 남은 문제, 커밋을 기록하고 다음 단계로 넘길 조건을 보고한다. Codex의 추가 응답을 기다리며 작업을 불필요하게 멈추지 않는다.

## 인계 이후 갱신 (임시 PM 기록)

위의 "현재 상태"와 "세션과 작업 공간"은 2026-11-12 인계 시점의 기록이다. 그 뒤의 실제 상태는 아래 문서가 기준이다. 권한과 회수 규칙은 바뀌지 않았다.

- [임시 PM 상태](pm-status.md): 체크포인트, 세션·pane·worktree·브랜치·기준 커밋, 실행한 검증과 미실행 검증, 다음 행동, 회수 시 인계 방법.
- [단계 1a 작업 배분](work-orders/phase-1a-assignments.md): 작업별 소유 파일, 의존과 통합 순서, PM 결정과 근거.
- [개발 진행 현황](progress.md): 작업 상태, 검토 단계, 검증 기록.

사용자가 optional 탭(w1:t2)의 추가 Claude 세션 사용을 승인했다. 빈 세션 p5, p6, p7을 배정했고 p8은 예비다.

2026-11-12 일시 정지 뒤 사용자가 새 Herdr 세션 w3의 w3:p1에 오케스트레이터(임시 PM)를 맡겼다. 위임 ID, 범위, 회수 규칙은 그대로이며 `pm-control.json`의 담당 pane과 세션만 바꿨다. 세션 배치와 사용자 지시는 [임시 PM 상태](pm-status.md)의 CP-12를 따른다.
