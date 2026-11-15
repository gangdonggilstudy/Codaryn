# 단계 1a 작업 배분 (G2 이후)

임시 PM(w1:p3, 위임 pm-20261112-01)이 2026-11-12에 확정한 배분이다. 범위와 수용 기준은 [작업 지시서](phase-1a.md), 타입과 CLI 형식은 [CLI·공통 계약](../cli-contract.md)과 `src/contracts/**`를 따른다. 이 문서는 지시서 3절의 [제안] 소유 범위를 확정하고 작업 B와 C를 나눈다.

기준 커밋은 main `cc29b50`(기반 병합)이다. 모든 작업 브랜치는 이 커밋에서 시작했고, 각 worktree에서 `npm ci`와 타입 검사가 통과하는 것을 PM이 확인했다. 제품 테스트는 아직 0개다.

## 1. 세션과 소유 범위

| 작업 | pane (tab) | 페르소나 | worktree (`D:\project\Codaryn\.worktrees\` 아래) | 브랜치 | 소유 파일 |
| --- | --- | --- | --- | --- | --- |
| B1 엔진·모의 모델·CLI | w1:p1 (main) | CLI 개발자(주), 수석 아키텍트(보조) | `claude-design` | `claude/core-engine` | `src/engine/**`, `src/model/**`, `src/cli/**`, `src/workflows/**`, `tests/unit/{engine,model,cli}/**`, 그리고 역할 1로서 `src/contracts/**`, `docs/cli-contract.md`, `package.json`, lock, `tsconfig.json` |
| B2 도구·명령 실행기 | w1:p6 (optional) | CLI 개발자 | `claude-tools` | `claude/core-tools` | `src/tools/**`, `tests/unit/tools/**` |
| B3 검증기·기록·잠금 | w1:p8 (optional) | CLI 개발자(주), 검증 엔지니어(보조) | `claude-store` | `claude/core-store` | `src/verify/**`, `src/store/**`, `tests/unit/{verify,store}/**` |
| C1 민감정보 게이트 | w1:p5 (optional) | 보안·개인정보 검토자(주), CLI 개발자(보조) | `claude-quality` | `claude/security-core` | `src/privacy/**`, `tests/unit/privacy/**` |
| C2 정책·작업 공간 | w1:p7 (optional) | 보안·개인정보 검토자(주), CLI 개발자(보조) | `claude-workspace` | `claude/workspace-policy` | `src/policy/**`, `src/workspace/**`, `tests/unit/{policy,workspace}/**` |
| D 독립 통합 검증 | w1:p4 (main) | 검증 엔지니어 | `claude-operations` | `claude/cli-verification` | `tests/integration/**`, `tests/fixtures/**`, `tests/support/**` |
| PM·통합 | w1:p3 (main) | 개발 PM 겸 수석 아키텍트 | `D:\project\Codaryn` (main) | `main` | `docs/progress.md`, `docs/pm-status.md`, `docs/pm-handoff.md`, `docs/work-orders/**`, `scripts/**`, `.gitignore`, `.env.example`, 병합 |

- 사용자가 열어 둔 세션에 모듈을 나눠 배정해 속도를 높이라고 지시했다. optional 탭의 네 세션을 모두 배정했고 예비 세션은 없다.
- B2와 B3는 같은 `CommandRunner` 모양(요청: executable, args, cwdAbsolute, timeoutMs / 결과: `RunCommandPayload` 또는 `{ spawnFailed, message }`)을 쓴다. 실제 구현은 `src/tools`의 `createCommandRunner()`이고 `src/verify`는 같은 모양을 주입받는다.
- 한 파일은 한 작업만 소유한다. 다른 작업의 디렉터리, main, 다른 worktree는 읽기만 한다.
- `src/contracts/**`와 `package.json`을 바꿔야 하면 PM에 요청한다. PM이 승인하면 p1(역할 1)만 수정한다.

## 2. 의존과 통합 순서

1. B2, B3, C1, C2는 서로 독립이다. 다른 모듈은 계약 인터페이스로만 호출하고, 유닛 테스트에서 필요한 상대 모듈은 계약을 구현한 작은 대역으로 대신한다.
2. B1은 엔진, 모의 모델, CLI 인자 처리를 먼저 만든다. 실제 모듈을 묶는 조립 코드(`src/cli`)는 3번 뒤에 완성한다.
3. PM이 B2, B3, C1, C2를 검토해 main에 병합한다(G3a). p1이 main을 자기 브랜치에 병합하고 조립을 끝낸다. PM이 B1을 병합한다(G3b).
4. D는 지금부터 fixture와 통합 테스트를 작성하고, G3b 뒤에 최종 실행한다. 제품 결함은 고치지 않고 재현 사례로 보고한다.
5. PM이 전체 유닛·통합 실행 결과와 수용 기준 A1~A12를 대조해 G4를 판단한다.

## 3. PM 결정 (계약의 미정 항목)

| 번호 | 결정 | 근거 |
| --- | --- | --- |
| P-1 | 유닛 테스트는 `tests/unit/<모듈>/*.test.ts`에 둔다. Node 기본 테스트 러너와 `node:assert`만 쓴다 | `package.json`의 `test:unit`이 `dist/tests/unit/**`를 실행한다 |
| P-2 | 취소는 두 경로로 받는다. `SIGINT`/`SIGTERM`, 그리고 `--cancel-file <경로>`(파일이 생기면 취소) | Windows에서 다른 프로세스가 보낸 신호는 처리기 없이 프로세스를 끝내므로 통합 테스트가 취소 경로를 검증할 수 없다 |
| P-3 | `runId`는 `<UTC yyyymmddThhmmssZ>-<8자리 16진 난수>`다 | 정렬 가능하고 충돌 가능성이 낮다 |
| P-4 | `lock.json`은 `{pid, runId, startedAt}`이다. 기록된 pid가 살아 있지 않으면 회수하고, 살아 있으면 `workspace_locked`다 | architecture 8절 |
| P-5 | 병렬 개발 중 유닛 테스트는 상대 모듈을 계약 대역으로 대신할 수 있다. 실제 모듈 조합은 통합 테스트(D)와 조립 후 유닛에서 확인한다 | 모듈 간 병렬 작업을 위해서다. 대역은 계약 인터페이스 경계에만 둔다 |
| P-6 | 보호 구간 삭제는 1a에서 거부한다(계약의 `rebuildDocument` 규칙 그대로) | 계약 10절 |
| P-7 | 파일 해시가 모델과 기록에 노출되는 점은 1a의 알려진 한계로 보고서에 적는다. 계약은 바꾸지 않는다 | 계약 10절. 해결은 후속 단계에서 판단한다 |

P-2, P-3, P-4는 p1이 `docs/cli-contract.md`에 반영한다. 타입 계약 변경은 필요 없다.

## 4. 공통 규칙 요약

- 시작 전 지정 worktree에서 `git -C <경로> status --short`, `branch --show-current`, `rev-parse --show-toplevel`을 확인한다.
- 유닛 P0는 구현과 같은 커밋 묶음에 넣는다. 외부 경계(모델, 시계, 난수, 명령 실행기, 오류 주입용 파일 계층)만 대신한다. 테스트를 삭제하거나 약화해 통과시키지 않는다.
- 가짜 비밀만 쓴다. 키 파일을 읽지 않고 실제 API를 호출하지 않는다. 허용 의존성은 `typescript`, `@types/node`뿐이다.
- 커밋 작성자는 `gangdonggil <gangdonggilstudy@gmail.com>`이고 trailer를 붙이지 않는다. 자기 브랜치에만 커밋하고 push와 병합은 PM이 한다.
- 완료 보고는 지시서 6절 형식으로 10줄 이내다. 실행한 명령과 통과·실패·건너뜀 수, 실행하지 않은 검증, 알려진 한계를 적는다.
- 유닛 테스트 통과만으로 OS 격리, 프로세스 정리, 파일 원자성, 네트워크 차단을 입증했다고 적지 않는다.

## 5. 검증 체계

사용자가 검증 체계를 잘 갖추라고 지시했다. 층마다 담당과 근거를 나눈다.

| 층 | 담당 | 수단 | 근거로 쓰는 곳 |
| --- | --- | --- | --- |
| 유닛 P0 | 각 모듈 담당자 | `npm run test:unit`. 구현과 같은 커밋에 넣는다 | G3 |
| 브랜치 검토 | PM | `node scripts/review-branch.mjs <브랜치> <소유 경로>...`: 작성자, trailer, 소유 범위, 공백 오류, 비밀 검사 | 병합 전마다 |
| 병합 후 회귀 | PM | main에서 `npm run typecheck`, `npm run test:unit` 전체 | G3a, G3b |
| 프로세스 통합 | D(구현자와 독립) | `npm run test:integration`. 실제 CLI 프로세스, 파일 바이트, 실행 기록으로 판정 | G4 |
| 비밀 유출 방지 | PM, 전원 | 커밋 전 훅과 `node scripts/check-secrets.mjs --tracked` | 커밋과 push 전마다 |

- 병합 조건: 브랜치 검토 PASS, 담당 worktree에서 타입 검사와 유닛 통과, PM의 변경 내용 검토. 하나라도 빠지면 병합하지 않는다.
- 통합 테스트의 삭제, 건너뛰기, 기대값 완화는 PM 검토 없이 통합하지 않는다. 제품 결함은 D가 재현 사례로 보고하고 해당 모듈 담당자가 고친다.
- 실제 API 검증은 이 체계에 없다(1b). 각 층의 통과는 검사한 범위의 증거이며 보안이나 정확성 전체의 보장이 아니다.

## 6. API 키와 비밀의 커밋 배제

사용자 지시: API 키가 노출되지 않게 커밋에서 배제한다.

- `.gitignore`가 `.env`, `.env.*`(`.env.example` 제외), `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, `.npmrc`, `secrets/`, `*.local.json`, `.codaryn/`를 제외한다.
- `.env.example`에는 변수 이름만 있고 값이 없다. 키는 프로세스 환경 변수로만 읽으며 task 파일, 코드, fixture, 기록에 넣지 않는다.
- 커밋 전 훅(`.git/hooks/pre-commit`)이 모든 worktree에서 스테이징된 변경을 검사한다. 키 형태의 값, 개인 키 블록, 금지 경로, 그리고 현재 환경의 `ANTHROPIC_API_KEY` 값과 같은 문자열이 있으면 커밋을 거부한다. 일치한 값은 출력하지 않는다.
- 훅은 Git이 추적하지 않는다. 저장소를 새로 받으면 `scripts/check-secrets.mjs`를 `.git/hooks/check-secrets.mjs`로 복사하고 같은 내용의 `pre-commit`을 다시 만든다. `--no-verify`로 건너뛰지 않는다.
- 이 검사는 알려진 형식과 현재 환경의 값만 잡는다. 임의 형식의 비밀을 모두 찾는다고 보장하지 않는다.
