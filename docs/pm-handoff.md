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

## 2026-11-14 Codex로 전수 인계 (임시 PM w3:p1 기록)

사용자가 2026-11-14 오전에 Claude 쪽 토큰이 다했을 것이라며 Codex들에게 전수 인계하라고 지시했다. 임시 PM(w3:p1)은 이 절을 쓰고 푸시한 뒤 새 배정·병합·푸시를 멈춘다. `pm-control.json`은 임시 PM이 바꾸지 않았다: 위의 회수 규칙대로 Codex가 `status`를 `revoked`로(또는 담당을 Codex로) 바꾼다.

### 읽을 것 (이 차례로)

1. [임시 PM 상태](pm-status.md)의 CP-27(인계 시점의 상태), CP-26, CP-25.
2. [CLI 구조 이행 계획](reviews/2026-11-13-cli-migration-plan.md)과 [단계 4·5 설계와 결정 기록](work-orders/phase-4-5-design.md)의 DR-65~DR-74.
3. `docs/reviews/2026-11-14-*`: Codex 검증 V-27~V-36, 검토 R-111~R-119.
4. 각 작업자의 보고서는 그 worktree의 `.codaryn/`(gitignore)에 있다. 다른 worktree의 `.codaryn/`은 읽을 수 있으나 고치지 않는다.

### 지금 상태 한눈에

- main = origin/main = CP-27의 해시 뒤의 이 문서 커밋. 작업 트리는 깨끗하다.
- 병합 대기 중인 판은 없다. 커밋은 있으나 완료 보고 전인 가지: `unit/U-319-na-core`(C-9b), `unit/U-318-p5u-gui`.
- Claude 작업자 여덟(w3:p2 na-core, p4 ne-verify, p5 nb-i18n, p6 nc-human, p7 nd-docs, p9 p4g-general, pA p5a-adapter, pB p5u-gui)은 토큰이 다하면 멈춘다. 멈춘 세션의 한도·크레딧 질문에는 답하지 않는다(사용자 몫). 미커밋 변경은 보존한다.

### 바로 이어갈 순서 (권장)

1. `git -C D:\project\Codaryn status -sb`와 `git worktree list`로 main이 원격과 같고 깨끗한지 확인한다.
2. 기준 수치를 다시 잰다: main에서 `npm ci`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`(CP-27의 수치와 맞는지), 루트 `npm run build` 뒤 `gui`에서 `npm test`, 그리고 Electron이 있는 곳에서 `npm run test:smoke`(227).
3. `unit/U-319-na-core`(C-9b)와 `unit/U-318-p5u-gui`가 끝났는지 본다(담당의 보고 또는 가지의 마지막 커밋과 그 worktree의 `.codaryn` 보고서). 끝났으면 아래 "병합 절차"로 판을 만들어 검증한다. C-9b는 파일을 지우는 명령이라 독립 검증을 거친다.
4. C-7b의 CLI 전환: `src/cli`의 apply가 `src/app/apply-life.ts`(U-313, 아직 부르는 곳 없음)를 부르게 한다. 계획은 na-core의 보고서 `.worktrees/claude-workspace/.codaryn/report-N-A.md` §144와 p5a의 `.worktrees/claude-adapter/.codaryn/c7b-prep-p5a.md`에 있다. 앱의 applyPlan이 이 수명을 부를 때는 관찰자를 두 번 주지 않는다(p5a의 메모).
5. 앱 쪽 손 셋(app.ts를 차례로): C-8의 report, C-9a의 revert, C-7b 뒤의 applyPlan.
6. 남은 이행 단계 C-10, C-11과 정리(다시 내보내기). 그 뒤 고정 출력이 바뀌는 항목들은 사용자 승인 뒤에(질문 정리: `.worktrees/claude-general/.codaryn/report-pin-change-questions.md`).

### 병합 절차 (임시 PM이 쓰던 것)

- 판: 관리용 worktree `D:\project\Codaryn\.worktrees\pm-unit`에서 `git checkout -B pm/unit-<이름> main` 뒤 단위 가지를 `--no-ff`로 병합하고(충돌이면 멈추고 담당이 main을 받는다), `npm ci`, typecheck, `test:unit`, `test:integration`, `node scripts/check-secrets.mjs --tracked`, 고정 파일 셋의 diff(`tests/unit/cli/sp0-expected.ts`, `tests/unit/model/anthropic/sp0-golden.ts`, `tests/unit/cli/human/real-catalog.test.ts`)를 본다. 이행 단계는 `node scripts/compare-cli-boards.mjs --base main --head <판>`으로 모든 사례가 same인지 본다. GUI에 닿으면 루트 `npm run build` 뒤 `gui`에서 `npm test`(통과 수만이 아니라 건너뜀·todo 수도 읽는다).
- **판 결과에서 실패 0을 읽은 뒤, 다른 호출로 병합한다**(한 명령에 묶지 않는다).
- 병합: 관리용 main에서 `git merge --no-ff --no-commit <판>` → 병합 트리가 검증한 판의 트리와 같은지(`git write-tree` 대 `<판>^{tree}`) → `check-secrets --staged` → 작성자 `gangdonggil <gangdonggilstudy@gmail.com>`로 한 줄 제목만의 커밋(본문·trailer 없음) → `git push origin main`.
- 임시 PM의 도우미 스크립트 사본: `D:\project\Codaryn\.codaryn\pm-tools\`(gitignore; `v.sh` 판, `mg.sh` 병합, `wait.sh`·`st.sh`는 Herdr 상태 보기). Git Bash용이다.
- 임시 worktree를 만들지 않는다(`git worktree add`는 관리자 몫, workflow §10). 독립 검증은 `git archive` 사본을 `.worktrees/codex-verify/.codaryn/<이름>/` 아래에 풀어서 한다.

### 지켜 온 규칙 (사용자 지시와 그동안의 교훈)

- 실제 API 호출은 지시가 없어 한 번도 하지 않았다. 키 파일을 읽지 않는다. 외부 네트워크 없이 127.0.0.1만 쓴다.
- force push·이력 재작성·`--no-verify`·amend 금지. 커밋 메시지의 마지막 줄이 trailer로 읽히지 않게 한다.
- 보안·정합에 닿는 단위는 독립 검증 뒤에 병합한다. 시험 통과만으로는 결함을 여러 번 놓쳤다(CP-24의 기록).
- 대기 중인 판이 있으면 같은 파일(특히 `docs/cli-contract.md`, `docs/design/adapter-contract.md`, `scripts/compare-cli/cases.mjs`, 목록 시험 `tests/unit/cli/u280-dist-old-paths.test.ts`)을 건드리는 다른 단위를 먼저 넣지 않는다.
- 이행에서는 출력과 JSON을 한 글자도 바꾸지 않는다. 고정 출력이 바뀌는 일은 사용자에게 묻는다.
- 새 지침은 사용자 확인 뒤에만 더한다. 사용자 결정이 필요한 질문은 모아 두었다가 권장과 함께 하나씩 묻는다(목록은 pm-status의 CP-25~CP-27).

### Codex 회수 확인 (2026-11-14)

사용자 지시에 따라 codex-review(w3:p3)가 이 문서와 CP-27~25, CLI 이행 계획을 읽고 PM·통합을 인수했다. main `b129ebb8`의 깨끗한 상태를 확인한 뒤 `pm-control.json`의 임시 위임을 `revoked`로 바꿨다. 기존 Claude owner 값은 종료한 위임의 이력으로 남긴다. 회수 뒤 현재 배정과 진행은 [CP-28](pm-status.md)을 따른다. 사용자 지시에 따라 남은 구현도 기존 Codex 세션에 배정한다.

### 인계 직후의 덧붙임 (2026-11-14 09:3x)

- 인계 알림을 Codex 여섯(이끄는 것은 codex-review, w3:p3)과 Claude 작업자 일곱에게 보냈다. Claude 작업자에게는 "하던 곳까지 커밋하고 `.codaryn` 보고서에 적은 뒤 새 단위를 시작하지 말 것, 푸시하지 말 것"이라고 했다.
- **na-core(w3:p2)는 09:27에 주간 한도 안내에서 멈췄다**(11/15 21시 재설정; 화면의 선택지는 누르지 않았다 - 사용자 몫). 알림은 전달되지 않았다.
  - `unit/U-319-na-core`(C-9b)는 끝 `7cadaea6`까지 커밋 여섯(판 사례, 글 고정과 목록 시험, 앱 쪽 한 벌, CLI 전환, 한 벌 시험, cli-contract)이 있고 worktree는 깨끗하다. 완료 보고와 수치는 받지 못했다.
  - 멈출 때 빌드된 `dist`에 변이를 넣어 보는 중이었다. 그 worktree(`.worktrees/claude-workspace`)의 `dist`는 믿지 말고 다시 빌드한다. 추적 파일은 바뀌지 않았다.
  - 이 가지는 판을 만들어 처음부터 검증해야 한다(판 비교, 유닛·통합, GUI 유닛, 독립 검증). 담당의 보고서는 `.worktrees/claude-workspace/.codaryn/report-N-A.md`의 끝 절에 일부 있을 수 있다.
