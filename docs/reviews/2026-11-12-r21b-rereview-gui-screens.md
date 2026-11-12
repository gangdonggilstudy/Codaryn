# R-21b 재검토 보고서: GUI의 R-21 수정

```
검토자: 구현자가 아닌 세션(claude/revert-store), 읽기 전용. 저장소 파일 수정·커밋 없음(작업 시작 때 main 병합 외)
대상: claude/gui-design 445e535(.codaryn/r22b-r21b-pinned.txt), 9c36f5b 이후 gui/** 커밋
  144ac0b merge: 앱 계층 DR-29 변경 보기(claude/adapter-contract 89692ac), 엔진 호스트가 실행의 작업 종류를 실어 보냄(R21-M-1, R21-I-5)
  445e535 fix(gui): 모델 목록은 누를 때만, 시험은 실제 API에 닿지 않음, 최근 폴더는 전체 경로 없이, 모든 제공자의 키 값 숨김(R21-I-1, I-2, I-3)
  (그 사이 c799ab3 main 병합. 작성자는 모두 gangdonggil, trailer 없음)
기준: docs/reviews/2026-11-12-r21-review-gui-screens.md(R-21), docs/design/standalone-gui.md, DR-20·21·26·29
결과: 높음 0, 중간 0, 낮음 1, 정보 6
실행: GUI 빌드·금지 API 검사 통과 / lock 검사 통과 / GUI 유닛 106 중 106 통과
      / 연기 시험 88 중 88 통과(두 번) / 바깥 요청 0건(연기 시험 자체 검사와 별도 감시) / 탐침 7개(4절)
실행하지 않은 것: 실제 API(모두 loopback 가짜 API), 새 설치·내려받기, 루트 유닛·통합 시험(GUI 범위 밖)
```

- 실험은 `git archive 445e535`를 이 worktree의 `.codaryn/r21b/tree`(Git이 무시하는 곳)에 풀어서만 했다.
- `node_modules`는 복사본이다.
  - 루트: 이 worktree의 것
  - `gui`: `claude-gui`의 것에서 `electron/dist`를 뺀 것
  - 새로 설치하거나 내려받은 것은 없다.
- Electron은 `claude-gui/gui/node_modules/electron/dist/electron.exe`를 경로로만 썼다.
  - 연기 시험은 `smoke.mjs`에서 Electron 경로 한 줄만 바꾼 사본(`smoke-r21b.mjs`)으로 돌렸다.
  - `claude-gui` worktree에는 다른 세션의 커밋하지 않은 변경이 있어 아무것도 건드리지 않았다.
- APPDATA는 `.codaryn/r21b/appdata`로 바꿨다. 실행 뒤 이 복사본을 가리키는 프로세스는 0개다.

## 1. R-21 항목별 재확인

| R-21 | 결과 | 근거 |
| --- | --- | --- |
| M-1 계획 보기·적용·사람 확인·변경 보기 실패(`--workflow` 값 없음) | 고쳐짐 | 엔진 호스트의 형식이 앱 계층 `TaskForm`과 필드마다 같은 형(`HostTaskForm`)이 되었다. 빠지면 컴파일 오류다. 실행 화면이 시작 때의 작업 종류를 넘기고, 승인 토큰이 적용까지 그것을 지닌다. 연기 시험에서 R-21 때 실패한 10건(`changesShown`, `changesRows`, `planShown`, `planActions`, `applyByWorkflow`, `consentUnasked`, `applyDone`, `applyMoved`, `reviewRecorded`, `closeGuard`)이 모두 통과했다. 작업 종류를 직접 고른 계획의 적용(`applyByWorkflow`, 파일 이동 확인)도 새로 시험한다. 다만 실행 목록에서 연 계획은 여전히 적용되지 않는다(L-1) |
| I-1 최근 목록의 전체 경로 | 고쳐짐 | 최근 항목은 폴더 이름과 그 위 폴더 이름(`where`)만 지닌다. R-21 탐침(`run-secret`)의 화면 글·API 답에 작업 공간 경로가 없다(R-21에서는 있었다). 연기 시험도 홈 화면에 임시 폴더 경로가 없는지 본다 |
| I-2 다른 제공자의 키 값 | 고쳐짐 | 엔진 호스트가 계약의 제공자 표(`API_PROVIDERS`)가 이름 붙인 모든 키 변수의 값을 숨긴다. 탐침 `host-events-b`: 두 번째 제공자의 키 변수에 가짜 값을 두고 모델이 그 값을 이름으로 하는 파일을 만들게 하면, 진행 항목은 `created [key].txt`이다. 호스트가 보낸 줄 어디에도 그 값, 등록 비밀, 가짜 키, 작업 공간 경로, API 주소가 없다 |
| I-3 `listModels`를 화면이 부르면 확인 없이 실제 API | 고쳐짐 | (1) 설정 화면은 단추로만 묻는다. 탐침에서 설정 화면을 열고 2초 기다려도 목록 요청이 0건이었다(아래 개수로 확인). (2) 메인이 한 번에 하나, 1분에 다섯 번만 허락한다. 오작동하는 화면처럼 부르면, 동시 3건은 1건만 처리되고 2건은 `too_many_requests`다. 이어서 7건을 차례로 부르면 4건이 처리되고 3건은 `too_many_requests`, 다른 순서로는 5건 처리 뒤 거부다. 가짜 API에 간 목록 요청은 어느 쪽이든 5건이다. (3) 시험 전송: 아래 2절 |
| I-4 동의 재적용 때 대화상자 하나 | 그대로(의도) | 연기 시험 `consentUnasked`와 `closeGuard`의 대화상자 목록이 R-21 설명과 같다 |
| I-5 변경 보기가 글을 보이지 않음 | 반영됨 | `144ac0b`가 DR-29 앱 계층(`89692ac`)을 들여왔다. 앱 계층이 실행 때와 같이 가려졌다고 확인한 글만 보인다(정보 I-5) |
| I-6 하드 링크 없는 드라이브의 동의 흐름 | 재현하지 않음 | R-21과 같다 |

## 2. 시험이 실제 API에 닿지 않는가, 연기 시험 중 바깥 요청

- **시험 전송**(`gui/src/engine-host/transport.ts`)
  - 엔진 호스트에 `--transport loopback-only`를 주면, 앱 계층에 주는 `fetch`가 loopback 주소만 통과시킨다. 그 밖은 실제 `fetch`를 부르지 않고 거부한다.
  - 이 인자를 주는 곳은 연기 시험의 세 진입점(`smoke.ts`, `life-entry.ts`, `switch-entry.ts`)과 실제 호스트를 띄우는 유닛 시험뿐이다. 앱의 시작(`src/main/main.ts`)은 `startGui({ guiRoot })`만 부르고 이 값을 주지 않는다.
- **주소 판정** 17가지
  - 통과: `127.0.0.1`, `[::1]`, `localhost`, 그리고 URL 해석이 `127.0.0.1`로 바꾸는 `127.1`, `0x7f.0.0.1`, `2130706433`
  - 거부(더 엄격함): `localhost.`, `127.0.0.2`, `[::ffff:127.0.0.1]`, `0.0.0.0`
  - 거부: `127.0.0.1.nip.io`, 사용자 정보로 위장한 `127.0.0.1@바깥 주소`, 조각으로 위장한 `바깥 주소#@127.0.0.1`, 바깥 https, 잘못된 URL
  - `Request`와 `URL` 입력도 같다. loopback 1건만 실제로 불렸고 바깥 2건은 거부됐다.
  - 리디렉트는 공용 전송이 `redirect: "manual"`로 따르지 않는다. loopback에서 바깥으로 넘겨지는 길도 없다.
- **연기 시험 중 바깥 요청: 0건**
  - 연기 시험 자체 검사: `sockets: {"tcp":0,"udp":0,"outside":0}`, `noDictionaryDownload: []`, 두 번 모두 같다.
  - 별도 감시(`netwatch2.ps1`): 이 복사본을 가리키는 모든 프로세스와 그 자손(Electron 메인·렌더러·GPU·유틸리티, 엔진 호스트, 연기 시험 스크립트)의 소켓을 `netstat -ano`로 1053번 읽었다.
    - loopback이 아닌 상대 주소: 0
    - UDP 끝점: 0
    - 본 것: 가짜 API의 `127.0.0.1` 대기, 엔진 호스트에서 그곳으로 가는 연결 3개, Electron 메인의 `127.0.0.1` 대기 하나
  - Electron 메인의 대기는 연기 시험이 일부러 띄우는 디버깅 스위치 경우(`--inspect-brk`는 시작 검사로 끝나지 않아 시험이 멈춘다. 연기 시험의 NOTE, GU-9 fuses 일)로 보인다 [추정]. 바깥 연결은 아니다.
  - 첫 감시(`netwatch.ps1`, 15번 읽음)도 같은 결과였다.
- 탐침의 가짜 API 요청 8건은 모두 가짜 키만 실었다. 모델에 보낸 본문에 등록 비밀이 없다.

## 3. 결과

### 낮음

#### R21b-L-1 실행 목록에서 연 계획은 적용되지 않는다(작업 종류와 프로필이 빠짐)

- 위치: `gui/src/renderer/runs/runs-screen.ts` 148행
  - 실행 목록의 "계획 보기"와 "변경 보기"는 `deps.openPlan(id, null, null)`·`deps.openChanges(id, null, null)`로 프로필과 작업 종류를 늘 `null`로 넘긴다.
  - `RunListItem`에 그 실행의 프로필·작업 종류가 없다.
  - 실행 화면(`run.last`)에서 열 때만 시작 때의 값이 간다.
- 재현(탐침 `host-plan.mjs`, 실제 엔진 호스트, 시험 전송, loopback 가짜 API)
  - 계획 실행 두 개를 만들었다: 작업 종류 `organize`로 시작한 것, `organize`를 정하는 프로필 `tidy`로 시작한 것. 둘 다 `needs-input/plan_pending`이다.
  - 실행 목록처럼 `plan`을 부르면(`null`, `null`) 실행 화면처럼 부를 때와 같은 다이제스트의 계획이 `pending`으로 보인다.
  - 그 승인으로 `applyPlan`을 부르면 둘 다 `run_not_plan`으로 끝나고 아무 파일도 옮겨지지 않는다.
  - 같은 계획을 실행 화면의 값으로 적용하면 옮겨진다(연기 시험 `applyByWorkflow`, `applyDone`).
- 영향
  - 앱을 다시 열면 화면의 `run.last`가 없어진다. 그러면 기다리는 계획은 실행 목록으로만 열 수 있고, GUI에서 적용할 길이 없다(CLI로는 된다).
  - 사람은 계획 보기와 OS 적용 확인을 거친 뒤에야 `run_not_plan`을 본다.
  - 실패는 실행 전 거부라 아무것도 바뀌지 않는다. 보안 문제는 아니다.
  - 프로필은 `secretEnv`를 바꿀 수 없으므로(`ConfigProfile`: provider, policy, verifiers, limits, workflowRef) 실행 목록 쪽의 가림은 같다.
  - 연기 시험은 실행 화면 경로만 본다.
- 권고(GUI 담당)
  - 실행 목록 항목이 그 실행의 기록에서 프로필·작업 종류를 지니게 한다. 앱 계층의 `listRuns` 값이 필요할 수 있다.
  - 또는 엔진 호스트가 계획 실행의 기록에서 읽는다.
  - 그 전까지는 실행 목록에서 연 계획에 "실행 화면에서 적용" 안내를 두고 적용 단추를 막는다.
  - 연기 시험에 "앱을 다시 연 뒤 실행 목록에서 적용"을 더한다.

### 정보

- **I-1 시험 전송은 Anthropic의 `fetch`만 감싼다**
  - 엔진 호스트는 `{ anthropicDeps: { fetch: loopbackOnlyFetch(...) } }`만 앱 계층에 준다.
  - 이 판의 앱 계층에는 Anthropic 어댑터만 있으므로 지금은 모든 길을 덮는다.
  - OpenAI 어댑터(SP-5, `claude/general-tasks`)가 들어오면 앱 계층의 갈고리와 호스트가 그 `fetch`도 감싸야 한다. 그렇지 않으면 설정이 `openai`인 시험은 실제 `fetch`를 쓴다.
  - 제공자 표의 모든 제공자가 감싸졌는지 확인하는 유닛 시험을 권한다.
- **I-2 앱 계층은 여전히 빠진 `workflowRef`를 `null`로 읽지 않는다**
  - R-21 탐침 `taskform-gap`을 다시 돌린 결과다.
    - 필드가 없는 형식은 `["--workspace","W","--workflow",undefined]`가 된다.
    - `changes`·`plan`은 `invalid_arguments: --workflow needs a value`다.
    - `workflowRef: null`이면 `ok`다.
  - R-21이 앱 계층 쪽 보강(`?? null`)으로 권한 것은 하지 않았다. 호스트가 형으로 늘 넣으므로 지금 이 길로 오는 호출은 없다. 실패도 실행 전 거부다.
- **I-3 `localhost`는 이름 찾기를 거친다**
  - 시험 전송은 `localhost`를 통과시키므로 그 요청은 OS의 이름 찾기를 거친다.
  - [추정] Windows는 `localhost`를 내부에서 답한다. 연기 시험과 가짜 API는 `127.0.0.1`을 쓴다.
  - 머리말의 "어떤 소켓이나 이름 찾기 전에 거부"는 바깥 주소에 대한 말이라 틀리지 않다.
- **I-4 디버깅 스위치 `--inspect-brk`는 시작 검사로 끝나지 않는다(이미 알려짐)**
  - 연기 시험 NOTE 그대로다. 그동안 Electron 메인이 loopback에서 기다린다(감시에서 본 대기). GU-9 fuses의 일이다.
- **I-5 변경 보기의 글(`144ac0b`, DR-29)**
  - 앱 계층이 실행 때와 같이 가려졌다고 확인한 글만 보인다. 아니면 `null`과 이유를 보인다.
  - 엔진 호스트는 줄마다 `shownText`(CRLF→LF, 제어 문자·키 모양·키 값 숨김)를 거친다.
  - 메인은 필드와 길이(한쪽 300,000자, 합 3,000,000자)를 다시 본다.
  - 화면은 HTML 삽입 API를 쓰지 않는다(빌드 검사, 두 파일에서 0건). 줄 비교는 표 칸 4,000,000개 상한이 있다.
  - 탐침에서 변경 보기의 `after`는 `copy [[CODARYN_SECRET:…]]`처럼 가려진 글이었다.
- **I-6 루트 typecheck 오류 11건**
  - R-21의 `9c36f5b`에서는 0건이었다. 이 판은 `src/cli`·`src/i18n`에 11건이 있다(R-22 I-5와 같은 것).
  - 계약 묶음(`f9a708a` 등)을 들여온 결과이고 GUI 코드가 아니다. GUI 빌드는 통과한다.
  - `144ac0b`의 커밋 메시지에 따르면 앱 계층·CLI 유닛 5건도 전제가 바뀌어 실패한다. 루트 유닛은 이번 범위가 아니어서 돌리지 않았다.
  - 병합 순서에서 맞출 일이다.

## 4. 실행 기록(모두 `.codaryn/r21b/`)

- 빌드와 시험
  - 루트 tsc(`root-tsc.txt`, 오류 11), GUI 빌드(`gui-build.txt`), lock(`gui-lock.txt`: 패키지 13개, 개발용, 설치 스크립트 없음)
  - GUI 유닛(`gui-unit.txt`, 106/106)
  - 연기 시험(`smoke.txt`, `smoke2.txt`, 88/88 두 번)
- 감시: `netwatch.ps1`→`net.txt`, `netwatch2.ps1`→`net2.txt`
- 탐침
  - R-21 탐침을 복사해 이 판에 돌렸다(`taskform-gap.mjs`, `host-events-b.mjs`, `run-secret-b.mjs`·`secret-run-b.mjs`, `run-secret-c.mjs`·`secret-run-c.mjs`).
    - Electron 탐침의 사본에는 시험 전송(`loopbackOnly: true`)을 더했다.
    - 화면이 이벤트 수신자를 하나만 두므로(새 것이 옛것을 바꿈), 탐침 자신의 수신자는 앱의 것으로 바뀌었다. 진행 항목은 화면 글(DOM)로 확인했다.
  - 새 탐침 `host-plan.mjs`(L-1), 시험 전송의 주소 판정 검사(명령줄)
- 저장소 파일 변경과 커밋 없음.

## 5. PM 판단 필요

- **P-1(L-1)**: 실행 목록 항목에 실행의 프로필·작업 종류를 실을지(앱 계층 `listRuns` 값 변경 필요 여부), 아니면 엔진 호스트가 기록에서 읽을지

사용자에게 물을 질문은 없다.
