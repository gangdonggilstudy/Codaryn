# R-113 검토: U-271 (p5u-gui, GUI 후속 모음)

- 검토: ne-verify (w3:p4). 읽기 전용이고 커밋하지 않았다.
- 판: `pm/unit-G5` = `eb6ce057130106b4871309098a4f3fae907b0147`. main `41957b2d` 위에 15커밋이 있다.
- 범위: `git diff 41957b2d eb6ce057 -- gui tests/unit/tools docs/design`(42파일, +1,478/−139).
- 실제 API, 외부 네트워크, 임시 worktree는 쓰지 않았다. 탐침과 변이는 판 사본에서만 하고 되돌렸다.

## 결론

- **높음 0, 중간 0, 낮음 2, 참고 3.**
- 시험(판 사본 `.codaryn/r113/c` = `eb6ce057`)

| 시험 | 결과 |
|---|---|
| 루트 `npm run build` | exit 0 |
| GUI `npm test`(빌드 포함) | 409개, 통과 409, 실패 0 |
| smoke 조용함 | 227/227, 32초, 시작 때 CPU 17%, node 22개, host 108 ms |
| smoke 부하 1 | 227/227, 45초, CPU 100%, node 86개, host 218 ms |
| smoke 부하 2 | 227/227, 66초, CPU 100%, node 72개, host 111 ms |
| smoke 부하 3 | 227/227, 62초, CPU 94%, node 57개, host 108 ms |

  - 부하: claude-operations worktree의 dist에서 루트 unit·integration을 두 갈래로 돌렸다(R-111c와 같음).
  - host는 hostEndsWhenMainKilled다. 네 번 모두 ok였다. 기록은 `r113/series.log`, `smoke-*.log`.
- PM이 물은 것
  1. **겹침 규칙(332aeaff)**: 남은 경우(다른 까닭으로 거부된 계획 점검)는 받아들일 만하다(I-1). 다만 **텍스트 저장의 잠금 거부는 아직 자기 것으로 센다**(L-1). 응답 모양이 다르기 때문이다.
  2. **R-112 L-1(0d016f2c)**: 정말 빠진 줄을 가리지 않는다. 2만큼 건너뛸 때 빠진 번호는 엔진 순서상 늘 전달되지 않는 `plan_item_started`다. 진짜 빠진 기록이 끼면 3 이상 건너뛰어 틈으로 남는다. 엔진 순서에 기대는 점은 I-2.
  3. **G-sec(2497b76c)**: 바르다. 메인의 `toPlanView`(`shared/ipc.ts:1296`)는 원래 두 상태만 받는다. 엔진 호스트가 모르는 상태를 `pending`으로 바꿔 넘기던 길이 `host_error`로 닫혔다.
  4. **exit-settle 시험 고침 셋**: 실행기 변이 넷을 모두 잡는다(2절).
  5. **GUI 작은 일곱**: 다섯은 문제없다. 보고서 요약의 거부 안내가 L-2, 키 안내의 한국어가 I-3이다.
  6. **GS-3·GS-4**: 담당이 해 본 둘 밖의 변이 셋도 각각 정확히 그 검사 하나로 잡는다(3절).

## 1. 겹침 규칙 (332aeaff, d38df671)

판의 빌드한 `OpenCheck`와 `OwnLockCalls`(`probe/overlap.mjs`)로 쟀다.
- 점검이 작업 공간 A에서 "잡힘"(다른 프로세스의 것이라 하자)을 답하는 동안, 이 창이 잠그는 호출을 하나 한다.
- 응답은 메인 프로세스가 실제로 주는 모양으로 넣었다.

| 점검 사이의 호출(응답) | A의 잠금을 셈(`heldFor`) | 판정 |
|---|---|---|
| 없음 | 참 | 맞음 |
| A의 `saveText`, 잠금 때문에 거부(`{ ok: true, saved: false, status: "workspace_locked" }`) | **거짓** | **L-1** |
| A의 `saveText`, 충돌(`status: "conflict"`) | 거짓 | 맞음(잠금 아래 판정) |
| B를 연 동안의 `saveText`, 잠금 거부 | 참 | 맞음(R-111c L-1 고침) |
| A의 review·startRun·applyCleanup·revert, `{ ok: false, code: "workspace_locked" }` | 참 | 맞음(고침) |
| A를 연 동안 B 핸들의 review, 잠금 거부 | 참 | 맞음 |
| A의 checkPlan, 다른 까닭으로 거부(`plan_stale`) | 거짓 | 받아들일 만함(I-1) |
| A에서 보낸 토큰 호출, 끝나기 전에 B로 바꿈 | 거짓 | 맞음(토큰은 A의 것) |

- 계획 적용은 시작이 답하면 실행 화면이 `running`이 되어 `busy`로 센다. `startRun` 호출 동안은 `overlapped`가 센다. 그래서 "시작 단계는 세지 않음"으로 생기는 빈칸은 없다.

### L-1 (낮음) 텍스트 저장의 잠금 거부는 아직 이 창의 것으로 센다

- `refusedForLock`(`own-lock.ts`)은 `ok === false && code === "workspace_locked"`만 본다.
- 그러나 `saveText`의 거부는 `SaveTextReply`(`shared/ipc.ts`)의 `{ ok: true, saved: false, status: "workspace_locked" }`다.
- 그래서 R-111c L-1의 셋째 경우가 텍스트 저장에서는 그대로 남는다. 다른 프로세스가 쥔 잠금 때문에 A의 저장이 거부되면, 그 시도가 바로 그 잠금을 이 창의 것으로 보이게 한다.
- 커밋 글, 코드 주석, 설계 문서(`standalone-gui.md` 3.2의 U-271 줄: "잠금 때문에 거부된 호출(`workspace_locked`)도 세지 않는다")는 모두 걸러진다고 적었다.
- 새 단위 시험(`u271-own-lock-scope.test.ts`)은 `saveText`에 `{ ok: true }`와 `{ ok: false, code: "text_changed" }`만 준다. 실제 거부 모양은 시험하지 않는다.
- 결과는 R-111c L-1과 같다.
  - 겹침 동안 새 작업 화면의 단추가 켜지고, 홈 카드가 잠금 문제를 빼고 보인다.
  - 누르면 앱이 `workspace_locked`로 거부한다. 안전한 쪽이고, 겹침이 있어야 하므로 드물다.
- 제안(결정은 p5u-gui)
  - `refusedForLock`이 `saved === false && status === "workspace_locked"`도 받게 한다.
  - 시험은 `SaveTextReply`의 실제 모양으로 한다.

### I-1 (참고) 다른 까닭으로 거부된 계획 점검을 세는 것은 받아들일 만하다

- `checkPlan`은 잠금을 잠깐 잡는다(U-119).
  - 다른 까닭의 거부는 잠금 아래에서 날 수도 있고(예: 계획이 낡음) 잠금 전에 날 수도 있다(예: 메인이 모르는 토큰).
  - 응답은 어느 쪽인지 말하지 않는다.
- 세지 않으면 R-111b M-1의 틀림이 돌아올 수 있다. 이 창의 잠금을 다른 프로세스의 것으로 보아 단추를 끄는 틀림이고, 그때 부하 smoke가 11번 중 5번 실패했다.
- 세면 치르는 값은 L-1과 같은 안전한 쪽의 거부뿐이다.
- 더 좁히려면 잠금 전에 정해지는 거부 코드(모르는 토큰 등)의 목록을 따로 두어야 한다. 얻는 것이 작다.

## 2. exit-settle 시험 고침 셋 (31459c08, afd2022e)

판 사본의 빌드한 `dist/src/tools/command-runner.js`에 변이를 하나씩 넣었다. 그때마다 `dist/tests/unit/tools/exit-settle.test.js`를 돌렸다(`probe/mutate-runner.sh`, `probe/mutations.log`).

| 실행기 | 결과 | 실패한 시험 |
|---|---|---|
| 그대로 | 6/6 통과 | — |
| M1 종료 뒤에도 시간 한도를 남김(exit의 `clearTimeout` 뺌) | 실패 1 | 유예 안에 든 시간 한도 |
| M2 종료에서 정리하지 않고 파이프가 닫히기를 기다림 | 실패 2 | 종료에서 정리됨, 종료 직후의 출력 |
| M3 유예 0 | 실패 3 | 위 둘과 유예 안의 시간 한도 |
| M4 유예 2,000 ms(배경의 `late;` 1,500 ms보다 김) | 실패 1 | 종료 직후의 출력(나중 출력은 기다리지 않음) |

- 시간은 이제 실행 시작이 아니라 명령의 종료(표시 파일, 신호 파일)에 묶인다. 그래서 바쁜 기계의 Node 시작 시간이 단언에 들어가지 않는다.
- 남는 흔들림: 셋째 시험은 한도 250 ms 전에 신호 파일을 만든다. 그 사이 명령이 종료하지 못할 만큼 바쁘면 진짜 시간 초과로 실패한다. 이 실패는 실행기의 틀림을 가리는 쪽이 아니라 거짓 실패 쪽이다. 담당은 부하 10번 통과를 적었고, 이번 PM 수치에서도 통과했다.

## 3. GS-3·GS-4 (2a0b88b1)

- 담당의 변이 둘(에이전트의 말을 HTML로, 가릴 값을 `gui-state.json`에)은 다시 하지 않았다.
- 다른 자리 변이 셋을 판 사본의 빌드한 GUI에 하나씩 넣고 smoke를 돌렸다(`probe/mutate-gui.mjs`, `probe/gui-mutations.log`). 빌드 파일은 되돌렸다.

| 변이 | smoke | 실패한 검사 |
|---|---|---|
| GM1 트리의 파일 이름을 `innerHTML`로 넣음 | 226/227 | `gs3`. 엔티티가 글로 풀려 이름이 달라짐. 요소는 생기지 않음(img 0) |
| GM2 계획 B의 요약을 `innerHTML`로 넣음 | 226/227 | `gs3PlanSummary`(img 1, CSP 위반 2, 글 다름) |
| GM3 메인이 가릴 값을 상태 폴더의 새 파일에 UTF-16으로 씀 | 226/227 | `gs4Values`(`build\smoke-state\r113-cache.bin`) |

- GS-3은 요소 수만이 아니라 글이 그대로인지도 본다. 그래서 엔티티 이름처럼 요소가 생기지 않는 틀림도 잡는다.
- GS-4는 상태 폴더와 Chromium 프로필의 파일을 UTF-8·UTF-16 바이트로 찾는다.
  - 렌더러는 `localStorage`·`sessionStorage`·`indexedDB`를 쓰지 않는다(`gui/src`에 없음). 그래서 압축된 저장소에 값이 숨을 길은 지금 없다.
  - OS 알림과 클립보드는 범위 밖이다. 점검표 M-3.18(U-266)이 사람의 점검으로 본다.

## 4. GUI 작은 일곱 (설계 대조)

| 커밋 | 내용 | 판정 |
|---|---|---|
| 7a8779f0 (C-27) | 결과 없는 실행의 자리 | 맞음. 낱말이 CLI `runs.running`·`runs.no_result`와 영·한 모두 같다 |
| a6400154 (U-229) | 되돌리기의 lock left | 맞음. `true`만 받는다 |
| 0808dd02 (C-23) | OS별 키 등록 안내 | 맞음. 값은 묻거나 보이지 않는다. 한국어 한 줄은 I-3 |
| b4a3a440 (3.12) | 오류 카드의 화면 단추 | 맞음. 코드별 고정 표이고, 응답의 글로 만들지 않는다 |
| 50c483c3 (3.7) | 보고서 요약의 거부 | **L-2** |
| 9107500f (3.3) | 적용의 이동 표시, 폐기 수 | 맞음. 가린 경로는 트리와 맞지 않아 표시가 안 붙을 뿐이다 |
| d4c7ef7b (3.6) | 한도 대비 수 | 맞음. 엔진은 한도를 넘는 호출을 기록 없이 끝내므로 `tool_result` 수가 한도를 넘지 않는다 |

### L-2 (낮음) 보고서 요약은 모든 거부에 "권한 규칙을 바꾸라"고 안내한다

- 거부된 호출이 있으면 요약 탭이 `report.deniedHow`를 보인다. 내용: "허용하려면 권한 규칙을 바꾸세요. 설정 › 권한 규칙에서…, task 파일은 그 파일의 policy에서…"
- 거부의 종류는 보지 않는다. 커밋 글도 "종류별 나눔은 창이 읽는 보고서에 없다"고 적었다.
- CLI의 끝 요약은 종류별로 다르게 말한다.
  - 명령: `summary.denied_hint`(policy.commands)
  - 쓰기 목록 밖: `summary.denied_not_writable_hint`(writablePaths)
  - 읽기 제외: `summary.denied_unreadable_hint`("일부러 막은 것", 풀려면 unreadablePaths에서 뺌)
- 그래서 GUI는 다음 거부에도 권한 규칙을 바꾸라고 한다: 읽기 제외(개인정보 실행), 보호 경로, 작업 공간 밖, 쓰기 목록 밖. 그 안내를 따라도 그 거부는 풀리지 않는다.
- 설계 3.7이 "거부 모음과 허용 방법(설정 > 권한 규칙으로)"이라 적었으므로 설계대로이긴 하다.
- 제안(결정은 p5u-gui·PM): 다음 가운데 하나.
  - 안내를 명령의 거부로 한정하는 글로 바꾼다. 예: "명령이 거부됐다면…", 그 밖의 거부는 기록 탭의 까닭을 보라.
  - C-6a의 끝 요약 수(tally: `deniedCommandCalls`, `deniedNotWritable`, `deniedUnreadable`)가 보고서에 오면 CLI처럼 종류별로 나눈다.

### I-3 (참고) Windows 키 안내의 한국어가 두 갈래로 읽힌다

- 원문: `key.how.windows`(ko) "시작 메뉴에서 '계정의 환경 변수 편집'을 열거나(rundll32 …) 사용자 변수 {env}를 더한 뒤…"
- 영어는 "open … and add"다. 한국어는 "열거나 … 더한 뒤"라 "열거나, 더하거나"로도 읽힌다.
- 제안: "시작 메뉴의 '계정의 환경 변수 편집'(또는 rundll32 …)을 열어 사용자 변수 {env}를 더한 뒤…". 글 확인은 nc-human 몫이다.

## 5. 참고 (그 밖)

### I-2 R-112 L-1 고침은 엔진의 기록 순서에 기댄다

- 규칙: 적용에서 `file_moved`·`file_discarded`·`plan_item_failed`가 앞 번호보다 정확히 2 뒤면 틈이 아니다.
- 이 규칙이 맞으려면 엔진이 `plan_item_started`와 그 항목의 기록 사이에 아무것도 쓰지 않아야 한다. 지금 `src/engine/apply.ts`는 그렇다.
- 단위 시험은 다음 둘을 확인한다.
  - 진짜 빠진 `file_moved`(4 뒤)와 빠진 `verifier_result`는 틈이다.
  - 모델 실행의 규칙은 그대로다.
- 담당의 제안에 동의한다: 앱 계층이 적용 기록마다 전달하지 않은 앞 기록의 수를 알려 주면 창이 엔진 순서를 몰라도 된다. 이행 C-7b(적용을 앱으로)에서 그 순서가 바뀌면 이 규칙도 다시 봐야 한다.

## 6. 판정 근거로 본 것

- `git diff 41957b2d eb6ce057 -- gui tests/unit/tools docs/design`. 15커밋의 글을 모두 읽었다.
- 탐침과 변이(커밋하지 않음, 판 사본의 빌드를 씀): `r113/probe/overlap.mjs`, `mutate-runner.sh`, `mutate-gui.mjs`와 각 기록.
- 대조: `src/engine/apply.ts`(적용 순서), `src/engine/index.ts:1474`(도구 호출 한도), `src/i18n/en.ts`(CLI의 runs·init·summary 글), `gui/src/shared/ipc.ts`(`SaveTextReply`, `toPlanView`).
