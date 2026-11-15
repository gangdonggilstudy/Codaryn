# R-115 검토: U-296 (na-core, C-6a의 넷째 커밋: CLI 뒤집기) — 통합 쪽

- 검토: ne-verify (w3:p4). 읽기 전용이고 커밋하지 않았다. src 쪽은 Codex V-32가 본다.
- 판: `pm/unit-C6g` = `fa65290d03e015270895635e163de46dfe45940f`. main `f503fffb` 위다.
- 담당 보고: claude-workspace의 `report-N-A.md` §139(139.2 "startRun이 아니라 runLife를 부른 까닭" 포함).
- 실제 API, 외부 네트워크, 임시 worktree는 쓰지 않았다. 판 사본 둘(base = main `f503fffb`, head = `fa65290d`)의 빌드로 쟀다.

## 결론

- **높음 0, 중간 0, 낮음 0, 참고 2.**
- (1) 실제 CLI로 base와 head를 맞댄 **29쌍이 모두 같다**: 16가지 길, 영·한. stdout, stderr의 줄과 차례, 종료 코드, 기록(journal 전부), 잠금 파일이다. 판 비교 도구가 덮지 않는 길을 넣었다.
  - 실행 중 SIGINT·SIGTERM
  - 같은 작업 공간에 넷이 동시에 시작
  - 실행 도중 프로세스가 죽은 뒤의 잠금
  - 신호를 거는 때
- (2) "직접 부름"은 C-6a에서는 받아들일 만하다. C-6b에서는 두 감싸개가 다시 만나므로 c01에 run 계획 사례를 더하기를 권한다(I-1). 앱이 CLI의 형에 기대는 것은 C-11 전에 뒤집어야 한다(I-2).
- (3) head에서 GUI 시험과 smoke가 통과했다.

| 시험(head `fa65290d`) | 결과 |
|---|---|
| 루트 `npm run build` | exit 0(base `f503fffb`도 exit 0) |
| GUI `npm test` | 420개, 통과 420, 실패 0 |
| smoke | 227/227, 29초, 시작 때 CPU 18%·node 22개(조용함), hostEndsWhenMainKilled 107 ms |
| n20 + c01 + n19 | 29개, 통과 27, 건너뜀 1(n19의 4 GiB), todo 1(n20의 U-295), 실패 0 |

## 1. base와 head의 실제 CLI 비교 (`probe/compare.mjs`)

- 같은 사례를 base CLI와 head CLI로 한 번씩 돌렸다. 둘 다 네트워크 가드를 불렀다.
- 바꾼 것은 다음뿐이다: 실행 id(나온 차례로), 상자 폴더, 시각, `durationMs`·pid, 가림 토큰(나온 차례로), 사용 줄의 초.
- 그 뒤 글자로 비교했다. 결과는 `probe/out/<사례>-<언어>-{base,head}.json`에 있다.

| 길 | 언어 | 끝(head) | base와 |
|---|---|---|---|
| 보통 실행(쓰기, 검증 통과) | en, ko | 0 done/verified | 같음 |
| `--quiet` | en | 0 | 같음(stderr 빔) |
| 거부(명령, 작업 공간 밖, 보호 경로) | en, ko | 0 done/verified | 같음 |
| 터미널 없는 권한 질문(모의 API) | en, ko | 3 needs-input/no_verifier | 같음 |
| 시작 전 취소 파일 | en, ko | 5 cancelled | 같음 |
| 실행 중 취소 파일 | en, ko | 5 cancelled | 같음 |
| 실행 중 SIGINT(아래) | en, ko | 5 cancelled | 같음 |
| 실행 중 SIGTERM(아래) | en | 5 cancelled | 같음 |
| 잠금: 쥔 실행이 있는 동안 둘째 실행(둘째는 en, 설정 ko) | en, ko | 둘째 6 workspace_locked, 첫째 5 | 같음 |
| 같은 작업 공간에 넷 동시 시작 | en | 하나 0 done, 셋 6 workspace_locked, 실행 디렉터리 하나, 잠금 없음 | 같음 |
| 실행 도중 프로세스 죽임 → 다음 실행 → doctor | en, ko | 잠금이 남음(죽은 pid) → 다음 실행 0 done(회수) → doctor의 lock ok, 잠금 없음 | 같음 |
| 404(Y-4, 모의 API) | en, ko | 1 failed/model_error | 같음 |
| 기본 설정 위치(N-1) | en, ko | 0 done | 같음 |
| JSON이 아닌 대본 | en, ko | 2 invalid_script | 같음 |
| analyze-private, 읽기 제외 없음 | en, ko | 2 invalid_task | 같음 |
| analyze-private, 읽기 제외 거부 뒤 사람 확인 | en, ko | 3 needs-input/awaiting_review | 같음 |

- **신호:** Windows에서는 자식에게 POSIX 신호를 보낼 수 없다. Node의 `kill('SIGINT')`는 곧바로 끝내 버린다.
  - 그래서 preload(`probe/sig-preload.mjs`)가 CLI 프로세스 안에서 `process.emit`으로 신호를 낸다. 신호를 내는 때는 표시 파일이 생길 때다.
  - 이는 CLI가 건 처리기를 부르는지를 보는 것이고, 진짜 콘솔 Ctrl+C의 기본 동작은 보지 않는다.
- **신호를 거는 때**(`probe/sig-log.mjs`, `sig-when.mjs`): preload가 `process.on`·`off`의 SIGINT·SIGTERM 호출을 적었다. 두 판이 같았다.
  - 보통 실행: 조립 앞(runs 폴더가 생기기 전)에 둘을 걸고, 끝에 둘을 뗀다.
  - 설정 오류·대본 오류(실행 전 검사, 8단계): 걸지 않는다.
  - 잠금 거부: 걸고(조립 앞) 뗀다.
  - 끝날 때 남은 처리기: 모두 0개.
  - 계획 6.2 "실행 전 검사 중에는 처리기를 걸지 않는다"가 그대로다.
- **시점의 차이(글은 같음):** 뒤집은 뒤 Y-4 줄과 writablePaths 줄은 `runLife`가 잠금을 푼 뒤에 쓴다. 전에는 일부가 해제 앞이었다(p5a 준비 3절).
  - stderr의 글과 차례는 같다. 위 비교와 판 비교가 그렇다.
  - 그 사이에 다른 실행이 잠금을 잡을 수 있는 틈이 조금 앞당겨질 뿐이다.

## 2. 통합 시험이 이 판에서 지키는 것과 못 지키는 것

- **n20**(U-295): CLI가 `runLife`로 돈 뒤에도 사람용 출력의 기대값이 그대로임을 지킨다. 지키는 길은 권한 질문, 취소 둘, Y-4, N-1, 한국어 잠금·대본 오류다.
  - 이 커밋이 n20이 만들어진 바로 그 경우다. 13개(todo 하나)가 통과했다.
  - 담당의 변이 M2·M3(기본 설정 줄·Y-4 줄을 빼면 n20이 잡음)도 이것을 보인다.
- **c01**: 뒤집은 뒤에는 CLI(`runThroughApp` → `runLife`)와 앱(`startRun` → `runLife`)이 같은 수명을 쓴다.
  - 그래서 c01은 이제 두 감싸개가 같은 결과·기록을 주는지를 본다. 감싸개의 차이는 CLI의 `io`·조립·`process.env` 대 앱의 환경 사본·훅, 이벤트, 질문 통로다.
  - `runLife` 안의 틀림은 양쪽에 똑같이 나서 c01에는 보이지 않는다. 그것은 n20, U-291, 판 비교(base 대 head), u293가 잡는다.
- **n19**: 이동 계획의 적용은 이 커밋이 바꾸지 않았다. 다만 취소 도우미가 앱의 `createRunCancelSource`로 바뀌었으므로(d7b68b1), GI-09의 `apply --cancel-file` 두 사례가 바뀐 도우미를 지난다. 통과했다.
- **그 밖(PM 수치 659: 통과 657)**: a08(한도·취소·잠금), p01(재수정 중 취소), n11(검증기 중 취소), n13(lock left, Windows), k02·n05(진행 줄·--quiet·언어), n01·n10(문서 블록의 stderr)이 run의 길을 지난다.
- **통합이 못 지키는 것**
  - 진짜 신호(Windows), 이른 SIGINT의 Node 기본 동작
  - stdout과 stderr 사이의 순서, 잠금 해제와 줄 쓰기의 선후
  - 승인 계획의 실행(apply의 run 계획): 아직 옛 수명이고, n15가 지킨다.

## 3. "직접 부름"(startRun 대신 runLife)에 대한 의견

- 이 커밋에서는 받아들일 만하다.
  - 담당이 든 까닭(시험 주입이 CLI의 `io`로 닿음, DR-4의 `process.env`, 취소 원천의 자리)은 사실이다.
  - 동작이 같음은 판 비교 65·차이 0, 위 29쌍, n20·c01이 보인다.
- 뒤 단계에서 생길 수 있는 문제
  - **C-6b(승인 계획의 실행):** `runLife`가 승인 분기를 얻으면 두 감싸개가 다시 만난다. CLI의 `apply`(run 계획)는 직접 부르고, 앱의 `applyPlan`(U-218)은 `startRun`과 비슷한 감싸개로 부른다.
    - 계획 claim 한 번, 잠금 아래 기록 변경의 재확인(U-1), 계획 밖 거부의 수(`deniedNotPlanned`)가 감싸개가 아니라 `runLife` 안에 있어야 두 길이 어긋나지 않는다.
    - 지금 c01의 계획 사례는 이동 계획(organize)뿐이다. run 계획을 CLI `apply`와 앱 `applyPlan`으로 맞대는 사례가 없다. I-1에서 제안한다.
  - **C-7a(계획 보기·사람 확인):** 실행 수명이 아니므로 직접 닿지 않는다.
    - 다만 같은 꼴(CLI가 앱 API가 아니라 앱 내부 함수를 자기 `io`로 부름)이 이어지면, 어댑터 계약의 한 이음매(`CodarynApp`)가 CLI에는 아니게 된다. 그 단계에서 PM이 정할 일이다.
  - **C-11(의존 구조 시험):** `RunLifeEnvironment`가 `Pick<CliEnvironment, …>`라서 앱이 CLI의 형에 기댄다(`src/app/run-life.ts`의 `import type { CliEnvironment } from "../cli/run.js"`). I-2에서 다룬다.

## 4. 참고

### I-1 C-6b에서 c01에 run 계획 사례를 더하기를 권한다

- 뒤집은 뒤 c01은 감싸개만 맞댄다(2절). C-6b에서 승인 분기가 `runLife`에 들어오면 run 계획 수행이 다음 만나는 곳이다.
  - CLI: `codaryn apply`가 `runLife`를 직접 부른다.
  - 앱: `applyPlan`의 감싸개를 거친다.
- 제안(담당 ne-verify, C-6b 앞의 시험 단위로): c01에 다음 사례를 더한다.
  - run 계획(`plan: "run"`)을 CLI `run` → `apply --digest`와 앱 `startRun` → `applyPlan`으로 돌린다.
  - 결과·기록을 맞댄다. 계획 밖 쓰기 거부 하나를 넣는다.
  - 계획 claim과 두 번째 apply의 거부를 본다.
  - 판 비교의 handoff-plan-applied·workflow-tools-run-plan과 겹치지만, 그것들은 CLI만 본다.

### I-2 앱의 실행 수명이 CLI의 형에 기댄다 (src 쪽, 참고로만)

- `RunLifeEnvironment = Pick<CliEnvironment, "env" | "cwd" | …>`이고, `run-life.ts`가 `../cli/run.js`의 형을 가져온다.
- 형만의 의존이라 동작에는 닿지 않는다. 그러나 C-11의 "앱 → CLI 의존 없음"을 막는다.
- 형을 앱 쪽에 두고 CLI의 `CliEnvironment`가 그것을 넓히는 꼴로 뒤집는 것이 C-11 전에 필요하다. 담당이 말한 "그 형의 필드가 줄면 CLI가 깨진다"는 위험도 그때 시험으로 고정할 수 있다.
- Codex V-32가 src를 보므로, 결정은 그쪽과 PM의 것이다.

## 5. 판정 근거로 본 것

- `git diff f503fffb fa65290d`: `src/cli/run.ts`(`runThroughApp`, `runPrepared`의 갈래), `src/cli/cancel.ts`, `src/cli/progress.ts`(`writeProgressLines`), 시험 세 파일
- `src/app/run-life.ts`(U-293), 담당 보고 §139
- 탐침(커밋하지 않음): `r115/probe/compare.mjs`, `sig-preload.mjs`, `sig-log.mjs`, `sig-when.mjs`, 결과 `r115/probe/out/`
