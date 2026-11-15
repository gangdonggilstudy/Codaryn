# R-79 보안 검토 — U-74 실행 중 권한 확인 (`pm/unit-U-74` beaf105, main 59e0203 위)

- 검토자: p5u-gui (정책 관문 `src/policy`의 원래 소유자).
- 읽기 전용이다. 저장소 수정·커밋·worktree 없음.
- 두 판은 `git archive`로 스크래치 폴더에 풀고, 같은 `node_modules`를 이어 각각 빌드했다(오류 0).
- 대본 모델·로컬 가짜 API(127.0.0.1, 저장소의 시험 서버)·임시 폴더·합성 값만 썼다.
- 스크립트(모두 스크래치):
  - `C:\Users\gangd\AppData\Local\Temp\claude\21110c3621286809\770ccfc5-b6b0-4477-a62e-c37fb87a457b\scratchpad\r79\drive.mjs`(1)
  - `...\scratchpad\r79\schema.mjs`(2)
  - `...\scratchpad\r79\probe.mjs`(3)~(7)

## 결론

- **병합을 막는 결함은 없다.**
- 확인 규칙이 없으면 판정·기록·출력·모델 요청이 main과 글자까지 같다.
- 확인 규칙에 맞는 명령은 통로 없이 실행되지 않고, 설정이 거부한 것은 묻지 않는다.
- 답 뒤 재판정·취소·시간 한도·이상한 답이 모두 거부로 끝난다(아래 L-3 한 경우는 거부지만 실행이 비정상 종료).
- 낮음 셋(L-1~L-3)과, 설정이 `confirm`을 받기 시작하기 **전에** 해야 할 앞일 하나(F-1)가 있다.

## 항목별 결과

### (1) 확인 규칙이 없는 설정·프로필에서 main과 같은가 — **같음, 11/11**

- 실제 CLI, 같은 모래 상자. 비교한 것:
  - 종료 코드, stdout, stderr
  - `.codaryn` 아래 모든 파일(journal, result, plan, snapshots)
  - 작업 공간 바이트
  - 가짜 API가 받은 요청 본문 전부
- 맞추기 전에 정규화한 것: 실행 id, 시각, 시간 값, 모래 상자 경로, 64자 해시(시각이 든 사슬 해시).
- 영어 6사례:
  - `quickDocument`: 간편 형식, 읽기·쓰기·허용 명령 → done
  - `quickDenials`: `command_not_allowed`, `args_not_allowed`, `outside_root`, `protected_path`, `state_dir`, 그 뒤 허용 명령 하나 → done
  - `profileRun`: 설정은 모두 거부, 프로필 정책
  - `planApply`: organize 계획 실행 exit 3(plan_pending) → `apply --digest` exit 0
  - `taskFile`: 대본 모델, 허용·거부
  - `workflowMerge`: 설정에 정의한 작업 종류의 명령 규칙과 설정 규칙의 교집합
- 한국어 5사례(workflowMerge 뺀 같은 것)도 모두 같다.
- 거부 사례가 실제로 다섯 거부와 허용 하나를 기록한 것을 journal에서 확인했다(빈 비교가 아님).

### (2) `confirm: true`를 어디서 받나 — **task 파일·작업 종류는 거부(설계대로), 설정·프로필도 거부(설계와 다름 → L-1)**

| 넣은 곳 | main | beaf105 |
| --- | --- | --- |
| task 파일 `policy.commands[0]` | `invalid_task` / `unknown_field` | 같음 |
| 설정에 정의한 작업 종류 `workflows[0].policy.commands[0]` | `invalid_config`(unknown field 문장) | 같음 |
| 설정 `policy.commands[0]` | `invalid_config` / `unknown_field` | **같음(받지 않음)** |
| 프로필 `profiles[0].policy.commands[0]` | `invalid_config` / `invalid_value` | **같음(받지 않음)** |
| `confirm: false` | `unknown_field` | 같음 |

- 모두 요청 0건으로 실행 전에 거부한다.
- 같은 정의에서 `confirm`만 빼면 정상 실행된다(거부 까닭이 `confirm`임을 확인).

### (3) 통로 없이는 실행되지 않음, 묻지 않는 거부, 어느 규칙이 이기나 — **모두 맞음**

- 실제 관문·작업 공간·가림·도구 실행기로 돌렸다. 명령이 돌면 작업 공간의 `ran.txt`에 한 줄을 남기게 해서, "실행 안 됨"을 디스크에서 확인했다.
- (3a) 확인 규칙, 통로 없음: `command/confirmation_required`, `deny/default`, 실행 안 됨.
- (3b) 같은 실행 파일의 규칙 없음, 다른 인자: 질문 없이 1차에서 `command_not_allowed` / `args_not_allowed`.
- (3c) 확인 규칙이지만 `cwd`가 `..`이거나 밖으로 가는 정션이면 질문 없이 `path/…`로 거부한다. 밖의 파일은 실행되지 않았다.
- (3d) 같은 실행 파일에 confirm 없는 규칙(`mark.mjs`만)과 confirm 규칙(아무 인자)이 함께 있을 때:
  - confirm 없는 규칙에 맞는 호출은 묻지 않고 실행된다.
  - 나머지는 묻는다.
  - 확인 규칙은 "물으면 허용"이라, 그 규칙 없이는 거부였던 호출만 질문으로 바뀐다.
- (3e) 정확히 맞는 일반 규칙과 여분 인자를 받는 확인 규칙이 함께 있을 때, 여분 인자 호출은 묻는다. 일반 규칙을 넓히는 길이 없다.

### (4) 가짜 통로 — **모두 거부로 끝남(L-3 하나)**

- (4a) `allow_once`면 그 호출 하나만 실행된다. 다음 턴의 같은 명령은 다시 묻는다(q2). 거기서 거부하면 실행되지 않는다.
- (4a') 한 턴에 두 호출이면 각각 묻는다(q1, q2).
- (4b) 실제 TOCTOU: 질문하는 동안 `cwd` 폴더 `sub`를 작업 공간 밖으로 가는 정션으로 바꿨다.
  - `allow_once` 뒤 재판정이 `path/…`로 거부하고, 밖의 스크립트는 실행되지 않았다.
  - 답 뒤 재판정이 실제로 창을 닫는다.
- (4c) 아래 답은 모두 `deny/default`이고 실행되지 않는다:
  - 던짐, 늦게 거절(rejected promise), 모르는 결정(`always`), `null`, 문자열, `dismissed`
- (4c) 사람이 거부하면 `deny/user`다.
- (4c') 답 객체의 `decision` getter가 던지면 `runTask` 자체가 던진다 → **L-3**.
  - 명령은 실행되지 않는다(안전 쪽).
  - 그러나 `confirmation_answered`·`run_finished`가 없다.
- 프로토타입에만 `decision: "allow_once"`가 있는 객체도 허용으로 읽는다(L-3에 포함).
- (4d) 기다리는 동안 취소하면 `deny/cancelled`, 실행은 `cancelled`다. 그 뒤 도착한 `allow_once`로도 실행되지 않았다(디스크 확인).
- (4e) 신호를 무시하고 영영 답하지 않는 통로: maxDurationMs 1500에서 1506 ms에 `budget-exhausted/max_duration`, `deny/default`로 끝났다.

### (5) 질문과 두 기록 사건의 글 — **인자·경로 글 없음, 등록 값 가림. 키 모양은 가리지 않음 → L-2**

- 질문 객체의 키는 `argumentCount, callId, id, kind, permission, subject, tool`뿐이다.
- 인자 카나리와 `cwd` 글은 질문·`confirmation_requested`·`confirmation_answered`·진행 줄 어디에도 없었다. `argumentCount`는 2로 맞다.
- 실행 파일 이름에 **등록 값**이 들면 네 곳 모두에서 가려진다.
- 실행 파일 이름에 **키 모양**(합성 값, 보고서에는 적지 않음)이 들면:
  - 질문, `confirmation_requested.subject`, 영어 진행 줄(`progressLine`)에 그대로 남는다.
  - CLI 터미널 출력은 `writeHuman`이 `hideKeys`로 가리므로 화면에는 안 나온다.
  - journal에는 남는다.
  - 이것은 기존 기록 방식과 같다: 모델 응답의 도구 인자도 관문은 등록 값만 가린다.
- `callId`도 모델이 쓴 글이지만 `[A-Za-z0-9_-]{1,64}`로 묶인다. 키 모양은 들어갈 수 있다(기존 `tool_decision`과 같음, I-2).

### (6) 작업 종류와 합칠 때 — **묻기가 허용으로 바뀌지 않음**

- 정의가 넓고 설정 규칙이 좁을 때: 교집합에 `confirm`이 남는다.
- 정의가 좁고 설정 규칙이 넓을 때: 좁힌 규칙에 `confirm`이 남는다.
- 정의가 명령을 막으면 확인 규칙도 빠진다.
- 합친 정책으로 실제 엔진을 돌리면 묻고(통로 없음) 거부한다.
- main의 `commandRuleIntersection`은 `confirm`을 떨어뜨렸으므로 이 고침은 필요하다.

### (7) 기다린 시간이 maxDurationMs에 드나 — **듦**

- 1500 ms 한도, 첫 `allow_once`가 1.2 s 걸림 → 첫 호출은 실행되었다.
- 두 번째 질문은 남은 0.3 s 뒤 `deny/default`로 끊겼고, 실행은 1508 ms에 `budget-exhausted/max_duration`으로 끝났다.

### 수치

- `probe.mjs` 22/22, `drive.mjs` 11/11 같음, `schema.mjs` 5사례 × 2판.
- beaf105 유닛 중 U-74 파일 다섯과 `tests/unit/policy`·`tests/unit/engine` 전부: 391건, 389 통과 / 0 실패 / 1 건너뜀.

## 지적

### L-1 (낮음, 계약과 CLI 불일치) 설정·프로필이 `confirm`을 받지 않는다

- **실제**: CLI의 `parsePolicy`(`src/cli/task.ts:306`)가 task 파일·설정·프로필·정의에서 한 함수로 쓰이고, `executable, argsPrefix, allowExtraArgs`만 받는다.
- **계약과 설계는 다르다**:
  - 계약 `CodarynConfig.policy`·`ConfigProfile.policy`는 `ConfirmablePolicyConfig`다.
  - 설계 Q-2는 "설정과 프로필에서만 받는다"고 한다.
- 지금은 안전 쪽(어떤 파일로도 질문을 만들 수 없음)이다. 엔진 경로는 `EngineDeps`를 직접 짠 시험에서만 닿는다.
- 고칠 때(na-core, B-5 즈음):
  - `parsePolicy`가 출처를 받아 설정·프로필에서만 `confirm: true`를 받게 한다.
  - task 파일과 정의는 계속 `unknown_field`로 거부한다.
  - `confirm: false`는 받지 않는다.
- 그 단위는 F-1이 먼저다.

### L-2 (낮음, 표시용 글) 질문의 `subject`가 키 모양을 가리지 않는다

- `subject`는 관문이 등록 값만 가린 글이다. 그래서 키 모양이 든 실행 파일 경로가 질문·기록·영어 진행 줄에 남는다.
- CLI 터미널은 `writeHuman`에서 가리므로, 지금 사람에게 보이는 길은 없다.
- 질문은 앞으로 앱(B-4)·CLI 질문(B-5)·GUI(B-6)에서 **화면에 그대로 보일 글**이다. 정할 것은 둘 중 하나다:
  - 렌더러마다 키를 가린다. GUI는 엔진 호스트의 `shown`, 메인의 글 검사로 가린다.
  - 엔진이 `final-message.ts`처럼 `HIDDEN_KEY_MARKER`로 가려 싣는다.
- p4g-general 또는 PM이 정할 몫이다.

### L-3 (낮음, 견고함) 답 객체를 읽다 던지면 엔진이 던진다

- `askPermission`은 `answer.decision`을 `try` 밖에서 두 번 읽고, 프로토타입까지 본다.
- 그래서 getter가 던지는 답이면 `runTask`가 예외로 끝난다. 명령은 돌지 않지만 `confirmation_answered`와 `run_finished`가 없다.
- 계약(`ConfirmPermission` 주석)은 "던짐은 `dismissed`"라 한다.
- 고치는 법:
  - 답을 받은 직후 `try` 안에서 한 번만 읽는다.
  - 자기 속성(`Object.hasOwn`)만 본다.
  - 실패하면 `dismissed`로 친다.
- 지금 통로는 프로세스 안 코드뿐이라 낮음이다. 앞으로 통로가 IPC로 받은 값을 `Object.assign`으로 옮기면 `__proto__`로 허용을 만들 수 있으니 B-4 전에 고치길 권한다.

### F-1 (앞일, 설정이 `confirm`을 받기 전에 반드시) 설정 변경의 넓히기 판정이 `confirm` 빼기를 보지 못한다

- `src/app/settings-change.ts`의 `ruleKey`는 `[executable, argsPrefix, allowExtraArgs]`라 `confirm`을 보지 않는다.
- 그래서 설정이 `confirm`을 받게 되면 문제가 생긴다. 규칙에서 `confirm: true`만 지운 제안(묻던 명령을 묻지 않고 허용)이 넓히기로 잡히지 않는다.
- 그러면 GUI의 OS 확인(넓히면 메인이 묻는 대화상자)도 없이 쓰인다.
- `policyWidening`(작업 종류·프로필 쪽)도 같다.
- p5a-adapter 몫이다: `confirm_removed` 같은 넓히기 종류와 시험을 L-1과 같은 묶음에, 그보다 먼저 넣는다.
- GUI의 설정 화면이 규칙을 글로 보일 때 `confirm`을 보이게 하는 일은 내 몫으로 뒤따른다.

### 참고

- **I-1**
  - 엔진의 시간 한도 타이머는 `unref()`다(main부터 같음).
  - 그래서 손잡이(stdin 읽기, 파이프)를 쥐지 않은 통로는 기다리는 동안 프로세스를 살려 두지 못한다. 시험에서 이벤트 고리가 비어 실행이 끝나지 않은 채 프로세스가 나갔다.
  - 터미널 질문(B-5)과 GUI 통로(B-4/B-6)는 손잡이를 쥐므로 문제없다. 통로 단위의 시험에 "기다리는 동안 프로세스가 산다"를 넣길 권한다.
  - probe는 실제 통로처럼 손잡이 하나를 쥐고 돌렸다.
- **I-2**: `callId`는 모델이 쓴 글이다(패턴으로 묶임). 기존 `tool_decision`·`tool_result`와 같은 정도로만 남는다.
- **I-3**
  - `subject`는 사용자 규칙의 실행 파일 글 그대로다(절대 경로면 사용자 폴더가 든다).
  - 사람에게 묻는 화면에는 필요한 글이고, 모델 글이 아니다.
