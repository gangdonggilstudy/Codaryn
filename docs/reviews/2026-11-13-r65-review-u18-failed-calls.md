# R-65 병합 전 검토 — 단위 U-18 (실패한 도구 호출을 사람에게 보이기, AXM-4)

```
검토자: w3:pA (이 코드의 구현자가 아님). 읽기 전용: 저장소 파일 수정·커밋 없음
대상: pm/unit-U-18 4b8e4f8 (main 9934a9a 위). git diff 9934a9a 4b8e4f8: 18파일 +640/-17
      src는 9파일. src/app/app.ts 한 줄은 na-core의 것
결과: 높음 0, 중간 0, 낮음 1, 정보 3
판(git archive로 .codaryn/r65/에 각각 풀어 빌드):
  board = 4b8e4f8, main = 9934a9a. 두 판 모두 tsc 0
실행:
  같은 대본 실행 7가지를 두 판의 실제 CLI로 돌렸다(.codaryn/r65/r65-runs.test.mjs)
    성공만 4: 영어, 한국어, 영어 --quiet, 한국어 --quiet
    실패 섞임 2: 영어, 한국어
    모델이 만든 글 1
  실행마다 7개 파일을 남겼다: stdout, stderr, result.json, journal, report 글, report --json, 종료 코드
  run id, 시각, 시간(ms·초), 토큰 id만 바꿔 놓고 글자까지 비교했다(out-main/, out-board/)
  공유 렌더러·도구 한도 실험: r65-shared.test.mjs
  GUI(그 판): npm test 187/187, 연기 시험 1번 188/188, 끝난 뒤 남은 electron.exe 없음
  Electron은 claude-gui에 설치된 것을 경로로만 썼다(smoke-r65.mjs, 경로 한 줄만 바꾼 사본)
  실제 API 없음. 네트워크를 쓰는 실험 없음(대본 모델)
PM 수치(유닛 2516 중 2512, 통합 559)는 다시 재지 않았다. 위 실행들은 실제 CLI 비교다
```

## 판단: 병합해도 된다

- CLI 쪽 여섯 중점은 모두 맞다.
- 낮음 1건(L-1)은 GUI 엔진 호스트처럼 렌더러 하나로 여러 실행을 그릴 때만 생긴다. 다음 실행의 실패 줄이 빠질 수 있다. CLI에는 영향이 없다.
- 병합을 막지 않지만 후속으로 고치기를 권한다.

## 중점별 결론

### (1) 허용됐지만 실패한 호출: 진행 줄, 끝 요약의 수, 거부와 겹쳐 세지 않음

실패 섞인 대본 10턴(f1~f11)의 결과(board, 영어). 한국어도 같은 자리에 같은 줄이 나온다("파일 읽기 — 실패 (not_found)", "실패한 호출: 4건").

| 호출 | 진행 줄(새로 생긴 것) | 실패 수 | 거부 수 |
| --- | --- | --- | --- |
| f1 없는 파일 읽기 | `read file — failed (not_found)` | 1 | |
| f2 정책 안의 쓰기, 틀린 해시 | `write file — failed (conflict)` | 1 | |
| f3 허용된 실행 파일이 없음 | `run command — failed (spawn_failed)` | 1 | |
| f4 종료 코드 3 | `command ran — exit code 3` | (안 셈) | |
| f5 시간 초과(400 ms) | `command ran — stopped at its time limit` | (안 셈) | |
| f6 정책 밖 명령 | (기존) `denied (command/args_not_allowed)` | | 1 |
| f7 작업 공간 밖 경로 | (기존) `denied (path/outside_root)` | | 1 |
| f8 인자 없음 | (기존) `rejected by a check of the call (invalid_args)` | | 1 |
| f9 없는 도구 | (기존) `(unknown tool) — rejected … (unknown_tool)` | | 1 |
| f10 없는 파일 읽기(한 턴에 둘 중 첫째) | `read file — failed (not_found)` | 1 | |
| f11 같은 턴의 성공한 읽기 | 줄 없음 | | |

- **끝 요약:** "Denied calls: 4" 다음 줄이 "Failed calls: 4"이고, 그 뒤에 거부 힌트가 온다.
- **겹치지 않음:** 거부·검사 거부(f6~f9)의 `tool_result`(ok: false)는 실패로 세지 않는다. 진행 줄도 거부 줄 하나뿐이다.
- **도구 호출 한도에 걸린 호출:** `maxToolCalls` 1에 한 턴 세 호출을 주면, 둘째와 셋째는 기록 자체가 없다(`tool_decision`·`tool_result` 없음). 실패 수에 들지 않는다(실험 B).

### (2) 0이 아닌 종료 코드·시간 초과

- 줄 하나씩이고(위 f4, f5) 실패 수에 들지 않는다. 결과가 `ok: true`이기 때문이다(PM Q-2 (a)).
- 줄은 내용(JSON)의 `exitCode`가 1 이상의 정수이거나 `timedOut`이 참일 때만 나온다. 명령의 출력은 JSON의 문자열 안에 있으므로 이 키를 만들어 낼 수 없다.

### (3) 성공만 있는 실행: main과 글자까지 같은가

- **같다.**
  - 영어·한국어 각각, `--quiet` 있고 없고, 터미널이 아닌 자식 프로세스의 네 실행을 비교했다.
  - 실행마다 7개 파일이 main 9934a9a와 같다: stdout JSON, stderr(진행 줄·끝 요약), result.json, journal, report 글, report --json, 종료 코드.
  - 실행 시각과 시간, 토큰 id만 바꿔 놓고 비교했다.
- **실패 섞인 실행:** stdout JSON, result.json, journal, report --json은 main과 같다. 다른 것은 stderr(위 새 줄과 "Failed calls")와 report 글의 한 줄뿐이다.

### (4) 실패 줄에 모델·파일이 만든 글이 섞이는가

- **섞이지 않는다.**
  - 도구 이름은 카탈로그의 이름(`tool.<name>`)이거나 "(unknown tool)"이다. 엔진이 모르는 이름은 `unknown_tool`로 기록한다.
  - 코드는 `TOOL_ERROR_CODES`(닫힌 목록)에 있을 때만 쓰고, 없으면 줄이 없다.
  - 종료 코드는 개수(정수)만 쓴다.
  - 영어 대체 줄(`englishProgressLines`)은 `toolName`과 `safeToken`을 쓴다.
- **실험(evil-en):**
  - 제어 문자, 등록 값, 300자를 넣은 도구 이름은 "(unknown tool) — rejected …"이다.
  - 경로에 등록 값을 넣은 없는 파일 읽기는 `read file — failed (not_found)`다. 경로가 줄에 나오지 않는다.
  - 등록 값은 stdout, stderr, report 글에 0번 나온다.

### (5) 보고서 글의 실패 수, report --json

- **보고서 글:**
  - `- Tool calls: 7 of 24 (denied: 4, failed: 4)`. 4는 journal의 실패 규칙(`failedCallsIn`)과 진행 줄, 끝 요약의 수와 같다.
  - 실패가 0이면 ", failed"를 붙이지 않는다. 그래서 성공 실행의 보고서 글이 main과 같다.
- **report --json:** 실패 섞인 실행에서도 main과 같다. 개수를 싣지 않는다(PM Q-3).
- 결과가 없는 실행(`- Failed tool calls: N` 줄)은 이번에 돌리지 않았다.

### (6) 앱 계층·GUI에 영향이 있는가

- **앱 계층:** 없다.
  - 바뀐 것은 `readingSecrets`의 `RunNotes`에 필드가 더해진 한 줄뿐이다(na-core).
  - 앱의 실행은 진행 줄을 쓰지 않는다(`writeProgress` 없음).
  - 실행 이벤트(RunEvent)는 journal 레코드 그대로다. EngineResult와 보고서 JSON도 같다.
- **GUI:** 영향이 있다.
  - GUI 엔진 호스트는 진행 항목을 CLI의 `createHumanOutput(…).progressLine`으로 만든다(`gui/src/engine-host/main.ts:244` `itemsIn`). 그래서 이 판부터 GUI 진행 목록에도 실패·종료 코드·시간 초과 줄이 나온다(항목 종류는 `tool_result`).
  - 이것은 CLI와 같은 줄이라 그 자체는 문제가 아니다.
  - 다만 그 렌더러를 실행 하나에 하나씩 쓰지 않는다. 아래 L-1이다.
  - GUI 시험은 그대로 통과한다(187/187, 188/188).

## 낮음

### L-1 렌더러 하나로 여러 실행을 그리면 앞 실행의 거부가 다음 실행의 실패 줄을 지운다(GUI 엔진 호스트)

- **어디:**
  - `src/cli/human/output.ts`의 `createHumanOutput`이 새로 가진 `deniedCalls`(callId 집합)는 지우는 곳이 없다. `run_started`·`apply_started`에서도 비우지 않는다.
  - GUI 엔진 호스트는 언어마다 렌더러 하나를 호스트가 사는 동안 모든 실행과 적용에 쓴다(`gui/src/engine-host/host.ts:241` `items`, `:246-252` `itemOf`).
  - 호출 id는 실행 안에서만 겹치지 않는다. 엔진은 지킬 수 없는 id를 실행마다 `codaryn-call-1`, `-2`, …로 바꾼다(`REPLACED_CALL_ID_PREFIX`, `src/engine/index.ts` `recordableCalls`). 모델이 주는 id(로컬 모델의 `call_0` 같은 것)도 실행마다 같을 수 있다.
- **재현(실험 B, 실제 CLI 두 실행):**
  1. 실행 A: 공백이 든 id("bad id")로 정책 밖 명령을 부른다. id가 `codaryn-call-1`로 바뀌고 거부된다.
  2. 실행 B: 같은 id로 없는 파일을 읽는다. id가 `codaryn-call-1`로 바뀌고 not_found로 실패한다.
  3. B의 CLI stderr와, B만 그린 새 렌더러에는 `read file — failed (not_found)`가 있다.
  4. A를 그린 렌더러로 B를 그리면(GUI 호스트가 하는 대로) 그 줄이 없다.
- **영향:**
  - GUI에서 같은 세션의 다음 실행이 실패한 호출을 진행 목록에 보이지 않을 수 있다.
  - 결과, 기록, 보고서, CLI 출력은 맞다. 비밀이 새지는 않는다. 다만 AXM-4가 보이려는 것이 빠진다.
- **권고:** 둘 중 하나. 연기 시험은 이것을 보지 않는다.
  - (가) `progressLine`이 `run_started`·`apply_started`에서 `deniedCalls`를 비운다(출력 담당). 이 경우 정보 I-1의 `verifierNumbers`도 함께 비우는 것이 맞다.
  - (나) GUI 엔진 호스트가 실행 토큰마다 렌더러를 새로 만든다(GUI 담당).

## 정보 (건수에 넣지 않음)

- **I-1 (기존):** 같은 렌더러의 `verifierNumbers`도 실행마다 비우지 않는다. 그래서 GUI에서 검증 id가 다른 다음 실행은 번호가 이어질 수 있다. U-18 전부터 그렇다. 코드로만 보았고 실험하지 않았다.
- **I-2:** 영어 대체 줄(`englishProgressLines`, 렌더러가 없을 때 `withProgress`의 기본값)은 실패 줄만 더한다. 종료 코드·시간 초과 줄은 없다.
  - `main.ts`는 언제나 렌더러를 넘기므로 CLI 출력에는 영향이 없다.
  - 렌더러 없이 `withProgress`를 쓰는 호출자에게만 두 줄 모음이 다르다.
- **I-3:** 성공 실행 비교에서 report 글의 `Duration`과 토큰 id는 실행마다 달라 바꿔 놓고 비교했다. 그 밖의 글자는 모두 같다.

## PM 질문

- **L-1을 어느 쪽에서 고칠지:** (가) 출력 담당의 `run_started` 초기화, 또는 (나) GUI 호스트의 실행마다 렌더러.
  - 가정: (가). CLI와 GUI 둘 다에 맞고, 기존 `verifierNumbers`도 같이 고쳐진다.
  - 병합은 막지 않는 후속으로 둔다.
