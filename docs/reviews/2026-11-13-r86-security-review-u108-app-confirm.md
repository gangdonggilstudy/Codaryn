# R-86 보안 검토 — U-108 실행 중 권한 확인의 앱 연결 (B-4) (`pm/unit-U-108` c1c21ba, main 81f8978 위)

- 검토자: nc-human. 읽기 전용이다. 저장소 수정, 커밋, worktree 없음.
- 두 판(c1c21ba, 81f8978)을 `git archive`로 스크래치에 풀었다. 같은 `node_modules`를 junction으로 이어 각각 `tsc`로 빌드했다(오류 0, 0).
- 앱 계층(`createCodarynApp().startRun`)을 직접 불렀다. 대본 모델, 임시 폴더, 합성 값만 썼다. 네트워크는 쓰지 않았다.
- 설정 파일은 아직 `confirm`을 받지 않는다(U-74, R-79 L-1). 그래서 u108 시험과 같이 `AppHooks.runTask`로 실제 엔진에 묻는 규칙의 정책 관문을 줬다.
- 명령이 실행되면 작업 공간의 `ran.txt`에 `x`를 하나 덧붙인다. "실행되지 않음"은 디스크에서 그 길이로 확인했다.
- 스크립트(모두 스크래치, `C:\Users\gangd\AppData\Local\Temp\claude\21110c3621286809\5b7900db-80c9-408f-9e9b-76ab71d0546a\scratchpad\r86\`):
  - `probe.mjs`: (1)~(4), (6)
  - `probe2.mjs`: (3)의 키 모양, L-1
  - `compare.mjs`: (5)
  - `probe3.mjs`: I-1

## 결론

- **병합을 막는 결함은 없다.** 높음 0, 중간 0, 낮음 1(L-1), 참고 3.
- 답이 아닌 것은 모두 `deny/default`로 끝나고 명령은 실행되지 않는다. 21가지 꼴과 늦은 답 모두 그렇다.
- `allow_once`는 그 호출 하나만 실행한다. 답 뒤에는 다시 판정한다.
- 질문에는 인자 글, `cwd`, 등록 값, 키 모양이 없다. 두 사건은 가림본 이벤트로 온다.
- 취소와 시간 한도는 `confirm`이 받은 신호를 끊는다.
- 확인 규칙이 없는 실행은 이벤트, journal, 결과가 main과 같다(12/12).
- 실행 사이에 답이 새지 않는다.
- 지금 제품 경로에서는 질문이 생기지 않는다. 설정이 `confirm`을 받지 않고, GUI 엔진 호스트의 관찰자(`gui/src/engine-host/runs.ts`)에는 `onEvent`만 있다. 이 단위의 동작은 시험 hook으로만 닿는다.

## 항목별 결과

### (1) 물을 수 없거나 답이 아닌 것은 거부 — **모두 `deny/default`, 실행 0 (22/22)**

아래 21가지 모두 `confirmation_answered`가 `deny/default`이고 `ran.txt`가 없다.

| 꼴 | 결과 |
| --- | --- |
| 관찰자 없음, `confirm` 없는 관찰자(`onEvent`만), 빈 관찰자 `{}` | deny/default |
| `confirm`이 바로 던짐, 200 ms 뒤 거부(rejected promise) | deny/default |
| 답이 문자열 `"allow_once"`, `null`, `undefined` | deny/default |
| `decision`이 프로토타입에만 있음 | deny/default |
| IPC 복사 흉내: `Object.assign({}, JSON.parse('{"__proto__":{"decision":"allow_once"}}'))` | deny/default |
| `decision` getter(한 번도 불리지 않음, 0회) | deny/default |
| `"ALLOW_ONCE"`, `"always"`, `["allow_once"]`, `new String("allow_once")` | deny/default |
| 설명자 trap이 던지는 Proxy | deny/default |
| `confirm` 자리가 던지는 getter, `confirm`이 함수가 아님(문자열) | deny/default |
| `{ decision: "dismissed" }` | deny/default |

- 사람이 고른 `deny`는 `deny/user`이고 실행되지 않는다(대조).
- **늦은 답:** 신호를 무시하고 2.5 s 뒤 `allow_once`를 주는 통로, 한도 `maxDurationMs` 1500.
  - 1518 ms에 `budget-exhausted/max_duration`, `deny/default`로 끝났다.
  - `confirm`이 받은 신호는 한도에서 끊겼다.
  - 늦은 `allow_once`가 도착한 뒤(1.8 s 더 기다림)에도 `ran.txt`는 없다.

### (2) `allow_once`는 그 호출 하나만 — **맞음**

- 대본: 1턴 명령, 2턴 같은 명령, 3턴 같은 명령 두 개.
  - 답 순서는 allow_once, deny, allow_once, dismissed이다.
  - 네 호출 모두 따로 물었다(q1~q4).
  - 기록: `allow_once/user, deny/user, allow_once/user, deny/default`
  - `ran.txt` 길이 2. 허용한 두 호출만 실행됐다.
  - `policy_effective` 판정: `true, false:confirmation_required, true, false:confirmation_required`
- **답 뒤 재판정**: 묻는 동안 호출의 `cwd`인 `sub`를 작업 공간 밖으로 가는 정션으로 바꿨다.
  - `allow_once/user` 뒤 2차 판정이 `path/outside_root`로 거부했다.
  - 밖에도 안에도 `ran.txt`가 없다.
- 대조: main(81f8978)에 같은 묻는 규칙을 주면 관찰자에게 묻지 않고 넷 다 `deny/default`, 실행 0이다. 이것이 이 단위가 바꾼 것이다.

### (3) 질문과 두 사건의 글 — **인자·경로 글 없음, 실행 파일 이름 가림, 두 사건이 가림본 이벤트로 옴**

- 질문 객체의 키는 `argumentCount, callId, id, kind, permission, subject, tool`뿐이다. `argumentCount`는 3으로 맞다.
- 다섯 곳을 같은 기준으로 봤다:
  - 질문 객체
  - `confirmation_requested` 이벤트, `confirmation_answered` 이벤트
  - journal의 두 기록
- 다섯 곳 모두에 인자 카나리, `cwd` 카나리, 인자에 넣은 등록 값, 키 모양이 없다.
- 실행 파일 이름:
  - 등록 값이 들면 `C:\tools\[[CODARYN_SECRET:…]]\tool.exe`로 가려진다(질문, 이벤트, 기록).
  - 키 모양(합성, 보고서에는 적지 않음)이 들면 `C:\tools\[key]\tool.exe`로 가려진다. 질문, 이벤트, 기록 셋 다 그렇다(U-106 반영 확인).
  - 이 경우의 규칙은 hook이 실행 때 넣었다. task 파일에 넣으면 실행 전에 `key_in_file`로 거부된다(설계대로).
- 대본이 호출 id를 등록 값으로 줘도 질문과 이벤트의 `callId`는 `codaryn-call-1`이다. 모델의 id가 들어오지 않는다.
- 두 사건 모두 관찰자에게 이벤트로 온다.
  - 순서는 `confirmation_requested` → `confirm` 부름 → `confirmation_answered`이다(u108 시험과 (4a)에서 확인).
- `subject`는 규칙의 실행 파일과 글자까지 같아야 맞으므로(`src/policy/index.ts:127`), 모델이 고를 수 있는 글은 사용자 규칙의 실행 파일뿐이다.

### (4) 취소와 시간 한도 — **질문이 끊기고, 관찰자는 신호로 안다**

- (4a) 묻는 중 100 ms에 `handle.cancel()`. 통로는 신호를 무시하고 600 ms에 `allow_once`를 준다.
  - 신호는 cancel 뒤 0 ms에 끊겼다. reason은 `AbortError`이다.
  - 실행은 답을 기다리지 않고 124 ms에 끝났다. `cancelled/cancelled`, `deny/cancelled`.
  - 관찰자도 `confirmation_answered {deny, cancelled}` 이벤트를 받았다.
  - journal은 `run_finished`로 끝난다.
  - 늦은 `allow_once`로도 실행되지 않았다.
- (4b) 한도 1500 ms에서 신호를 무시하고 영영 답하지 않는 통로.
  - 질문 뒤 1509 ms에 신호가 끊겼다.
  - 1517 ms에 `budget-exhausted/max_duration`, `deny/default`로 끝났다. 실행 0.
- (4c) 질문 전 모델 턴 중에 취소하면 `confirm`은 불리지 않는다(0회). `cancelled`, 실행 0.

### (5) 확인 규칙이 없는 실행은 main과 같다 — **12/12 같음**

- 두 판의 앱 계층을 한 프로세스에서 같은 장면으로 돌렸다. hook 없이 CLI 자체 조립을 썼다.
- 비교한 것: 실행 결과(`done`의 값 전체), 모든 이벤트, journal 전부, `ran.txt`.
- 맞추기 전에 정규화한 것: 실행 id, ISO 시각, ms 값, 64자 해시, 임시 경로, 실행마다 다른 가림 토큰 id.
- 장면 넷 × 관찰자 셋(`confirm` 있음, 이벤트만, 없음):
  - 허용 명령, 쓰기, 통과
  - 거부 넷(`command_not_allowed`, `args_not_allowed`, 작업 공간 밖 쓰기, 보호 경로) 뒤 쓰기
  - 검증 실패로 끝남(`failed/verifier_failed`)
  - 작업 공간에서 등록 값 읽기(가림본 이벤트)
- `confirm`은 두 판 모두 0회 불렸다.

### (6) 한 실행의 답이 다른 실행으로 새지 않음 — **맞음**

- 같은 앱 인스턴스, 같은 작업 공간에서 차례로 두 실행을 했다.
- (6a) 실행 A는 질문 중 취소되어 `deny/cancelled`로 끝났다.
  - 실행 B의 질문 중에 A의 통로가 늦게 `allow_once`로 풀렸다.
  - B는 자기 `q1`을 물었고, 자기 답 `deny/user`로 끝났다.
  - A의 `confirm`은 한 번만 불렸고, 둘 다 실행 0이다.
  - B의 이벤트는 모두 B의 실행 id다.
- (6b) 같은 관찰자 객체를 두 실행에 줬다. 첫 실행의 `allow_once`(1회 실행)는 기억되지 않는다.
  - 둘째 실행도 `q1`을 묻고, `dismissed`로 `deny/default`가 되어 실행되지 않았다.
- 앱 계층의 중계(`confirmThrough`)는 상태가 없다. 엔진의 질문 번호는 실행마다 새로 센다.

## 지적

### L-1 (낮음, 기록의 온전함) 어댑터가 받은 질문 객체를 바꾸면 journal의 답 기록이 바뀐다

- **실제**:
  - `confirmThrough`(`src/app/permission.ts`)는 엔진이 만든 `ConfirmRequest` 객체를 그대로 넘긴다. 객체는 얼려 있지 않다(`Object.isFrozen` false).
  - 엔진은 답을 받은 뒤 `confirmation_answered`를 쓸 때 그 객체의 `request.id`를 다시 읽는다(`src/engine/index.ts`의 `askPermission`, `answered`).
  - 그래서 어댑터가 `request.id`를 바꾸면 그 값이 그대로 기록된다. 판정은 바뀌지 않고, 명령은 돌지 않고, `report`는 읽는다.

| 어댑터가 넣은 `id` | journal `confirmation_answered.id` | 이벤트의 `id` |
| --- | --- | --- |
| 다른 낱말 | 그대로(`q1`과 짝이 안 맞고 `CONFIRM_ID_PATTERN_SOURCE`에도 안 맞음) | 그대로 |
| 등록 값 | **가리지 않은 값 그대로** | 가림 토큰 |
| 키 모양 | 그대로 | 그대로 |

- **왜 낮음인가**:
  - 통로는 프로세스 안의 신뢰하는 코드다. 화면으로 가는 IPC는 복사본을 보내므로, 렌더러는 이 객체에 닿지 않는다.
  - 다만 엔진 호스트가 표시용으로 질문을 제자리에서 고치는 실수(예: `subject`를 다듬거나 `id`에 실행 접두를 붙임)만으로도 기록이 깨진다. journal의 "등록 값은 가린 채로만 남는다"는 약속도 어긋난다.
- **고치는 법**(작다):
  - `confirmThrough`가 어댑터에 얼린 사본을 넘긴다(`Object.freeze({ ...request })`). p5a-adapter, U-108 파일 안에서 한 줄이다.
  - 그리고/또는 엔진이 답 기록에 자기 지역 값(`const id`)을 쓴다(엔진 소유자).
  - 시험: 어댑터가 질문 객체의 `id`, `subject`를 바꿔도 `confirmation_answered.id`가 `q1`이다.

## 참고

- **I-1 (R-79 I-1, 앱 계층에서 재현)**: 손잡이를 쥐지 않은 통로(아무도 풀지 않는 promise)는 기다리는 동안 프로세스를 살려 두지 못한다.
  - `probe3.mjs`: 질문 21 ms 뒤 이벤트 고리가 비어 프로세스가 나갔다(종료 13, unsettled top-level await).
  - journal은 `confirmation_requested`에서 멈췄고, `run_finished`가 없다. `.codaryn/lock.json`이 남았다.
  - 실제 통로(터미널의 stdin, GUI의 IPC)는 손잡이를 쥐므로 지금은 문제가 아니다. 5.9가 이미 B-5·B-6 시험에 넣기로 했다.
  - 권고: 앱 계층이 기다리는 동안만 ref된 손잡이 하나를 쥐면 어댑터와 관계없이 한도가 지켜진다. 답이나 신호가 오면 푼다. 신호로 끝날 때도 풀어야 한다. 어댑터의 promise가 영영 안 풀릴 수 있기 때문이다.
- **I-2**: `confirm`은 질문마다 관찰자에서 다시 읽는다. 실행 중에 관찰자가 `confirm`을 바꿀 수 있다. 신뢰하는 코드라 문제 아님.
- **I-3**: 이벤트의 `confirmation_requested`는 게이트로 다시 가린다. 키 모양은 엔진이 이미 `[key]`로 바꿨다. 같은 이벤트의 다른 글은 기존 기록과 같은 정도로만 가린다(R-79 L-2의 결정 범위).

## 수치

- `probe.mjs`(c1c21ba) 91건 중 90 통과.
  - 1건은 시험 설계 문제였다: task 파일의 키 모양이 실행 전에 `key_in_file`로 거부됨.
  - 그 건은 `probe2.mjs`의 (3k)로 대신했고 3/3 통과.
  - (4)는 이벤트 확인을 더해 다시 돌렸다: 11/11.
- `probe2.mjs` (3y) 3건 실패 = L-1.
- `compare.mjs` 12/12 같음.
- 대조: `probe.mjs`의 (2)를 main 판에 돌리면 묻지 않고 `deny/default`만 나온다(6건 중 5건 "실패", 의도된 차이).
- `probe3.mjs`: I-1 재현.
- c1c21ba 시험:
  - `tests/unit/app/u108-confirm-relay.test.ts` 7/7
  - `tests/unit/app`·`engine`·`policy` 전부: 612건 중 610 통과, 0 실패, 1 건너뜀(대소문자), todo 1
