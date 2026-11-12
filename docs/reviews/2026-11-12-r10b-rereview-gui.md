# R-10b 재검토 보고서: GU-1의 R-10 수정과 GU-2 (`pm/bundle-1` 7de824a, `gui/**`)

```
검토자: w3:pA (구현자가 아닌 세션), 읽기 전용. 파일 수정·커밋 없음
대상: pm/bundle-1 7de824a (10개 브랜치를 합친 고정 판)
  GUI 커밋: 4520449 GU-2 / 044df15 M-1 / 955ce12 L-1 / 7c498e0 L-2 / 6fa0ae0 L-3 / 77db6e3 L-4 / 4a6955f L-5
  (앞 검토 R-10의 대상 c28d524 이후)
기준: docs/design/standalone-gui.md (7de824a 판), DR-8, DR-20, DR-26, R-10 문서와 PM 결정(L-6, I-1)
결과: 높음 0, 중간 0, 낮음 2, 참고 5. R-10의 M-1, L-1~L-5는 모두 막혔다(L-1은 문서에 적은 한계 그대로)
실행: 루트 typecheck 오류 0 / GUI 유닛 69건 중 69 통과 / lock 검사 통과 / 연기 시험 33/33 통과
      / 직접 만든 탐침 9개(아래 4절)
실행하지 않은 것: 실제 API, 새 설치·내려받기, 패키지 빌드(GU-9 전)
```

- 읽기: `git -C D:\project\Codaryn archive 7de824a`를 내 worktree의 `.codaryn/r10b/tree`(git이 무시하는 곳)에 풀어 빌드했다.
  - TypeScript는 루트와 같은 7.0.2를 복사했다. Electron은 타입용으로 `dist` 없는 패키지 파일만 복사했다.
  - 실행은 `claude-gui/gui/node_modules/electron/dist/electron.exe`(이미 설치된 것)를 경로로만 불렀다.
  - 탐침과 그 작업 파일은 모두 `.codaryn/r10b/probes` 안에 있다. 실행 뒤 `electron.exe`가 남지 않았음을 매번 확인했다.
- 연기 시험은 브랜치의 `smoke.mjs` 그대로이고, Electron 경로 한 줄만 바꾼 사본(`smoke-r10b.mjs`)으로 돌렸다.

## 1. R-10 결과의 재현을 다시 돌림

| R-10 | 수정 | 다시 돌린 결과 | 판정 |
| --- | --- | --- | --- |
| M-1 늦은 답이 호스트를 죽임 | `044df15` 시간이 지난 id를 최대 1000개 기억하고 그 늦은 답은 버림 | `late-answer.mjs`: 100 ms 제한 호출이 시간 초과 → 300 ms 뒤 늦은 답. 호스트는 살아 있고, 함께 기다리던 5초 호출과 다음 호출 모두 답을 받았다 | 막힘. 새 한계는 R10b-L-1 |
| L-1 검사기·`NODE_OPTIONS` | `955ce12` `NODE_OPTIONS`의 스위치와 이미 열린 검사기(`inspector.url()`)도 보고 닫은 뒤 종료 2 | `run-switch.mjs`: 아래 목록. 연기 시험도 같은 네 가지를 본다 | 막힘(한계는 문서대로, I-4) |
| L-2 입력이 끝나도 호출을 기다림 | `7c498e0` `onInputEnd`를 부르고 진행 중 호출은 최대 1초만 기다림 | `eof-during-call.mjs`: 6초 호출 중 입력이 끝나면 `serve`가 1,178 ms에 끝났고 `onInputEnd`가 불렸다. Electron에서 메인만 강제 종료하면 호스트는 0 ms에는 있고 1.5초 뒤에는 없었다 | 막힘 |
| L-3 Node 찾기의 원격 경로 | `6fa0ae0` CLI 규칙의 사본 `isLocalPathSyntax`(일치 시험 있음) | `node-path-unc.mjs`: UNC·`\\.\pipe` 항목은 건드리지 않고 `C:\Program Files\nodejs\node.exe`만 봤다 | 막힘. 같은 규칙이 GU-2의 새 경로에는 없다(R10b-L-2) |
| L-4 다른 드라이브 링크 | `77db6e3` `isInsideRoot`로 URL 대응과 실제 경로 확인을 같게 함 | 코드 확인. 연기 시험의 `linkedScript`(빌드 디렉터리 안 정션 너머 스크립트)는 `blocked` | 막힘 |
| L-5 연기 시험의 빈 곳 | `4a6955f` 종료 뒤 호스트 확인(정상·메인 강제 종료), 스위치 네 가지, 측정 실패는 실패 | 연기 시험 `hostEndsWithQuit`, `hostEndsWhenMainKilled`, `switch …` 통과. `sockets`는 Windows에서 문자열이면 실패한다 | 막힘 |
| L-6 이름 있는 파이프 | PM 결정: Electron 내부 파이프 제외 | 앱 코드에 파이프를 여는 곳이 없다(코드 확인). TCP 0, UDP 0, 바깥 연결 0(연기 시험) | 해당 없음 |

L-1을 다시 잰 것(loopback, 20 ms 간격 접속 시도)
- `--remote-debugging-port`: 포트가 열리지 않음, 종료 2.
- `--inspect`: 480 ms에 열림, 종료 2.
- `NODE_OPTIONS=--inspect`: 1,561 ms에 열림, 종료 2. R-10에서는 앱이 계속 돌았다.
- `--inspect-brk`: 697 ms에 열림, 앱이 끝나지 않음. fuses(GU-9)만 막는다. 설계 6.7과 연기 시험 NOTE가 적은 한계다.
- 부하 때문에 시간이 R-10 측정보다 길다.

## 2. 새 결과

### 낮음

#### R10b-L-1 M-1 수정의 기억 상한(1000)을 넘으면 늦은 답이 다시 호스트를 죽인다

- 위치: `gui/src/shared/protocol.ts` `PendingCalls`(`MAX_LATE_IDS = 1000`)와 `gui/src/main/engine-client.ts:128`의 `"unknown"` → `violation()`.
- 재현(`late-beyond-limit.mjs`, 가짜 호스트가 400 ms 뒤 답, 제한 50 ms)
  - 1000건: 모두 시간 초과. 늦은 답 뒤에도 호스트가 살아 있고 다음 호출이 답을 받았다.
  - **1001건: 가장 오래된 id가 기억에서 빠져, 그 늦은 답이 "unknown"으로 위반 처리되어 호스트가 끝났다.** 다음 호출은 `adapter_host_exited`.
- 영향
  - 동시에 1001건 넘게 시간 초과가 나야 한다. 실제 제한은 `doctor` 60초, `tree` 30초, `messages` 10초다.
  - 침해된 화면이 `tree`·`doctor`를 쏟아 호스트를 느리게 하면 생길 수 있다(서비스 거부). 다시 띄우는 단추는 아직 없다.
- 권고: id는 1부터 늘기만 하므로 "발급한 적 있고(`id < nextId`) 기다리는 것이 없는 id"는 개수와 상관없이 늦은 답으로 버린다. 발급한 적 없는 id만 위반으로 본다.

#### R10b-L-2 GU-2의 작업 공간 경로는 원격·장치 경로인지 보지 않고 파일 시스템에 묻는다(L-3과 같은 종류)

- 위치
  - `gui/src/main/cli-args.ts` `folderArgument`(첫 시작과 두 번째 시작의 명령줄)
  - `gui/src/main/workspaces.ts` `open`·`recent`의 `isDirectory`(`app.ts:58`, `stat`)
  - `gui/src/main/gui-state.ts` `isRecent`는 절대 경로면 UNC도 받는다
- 재현(`gu2-network-paths.mjs`, 빌드된 모듈, 기록만 하는 `isDirectory`)
  - 두 번째 시작 `electron <app> \\files.example.invalid\share\work`의 폴더 인자가 그대로 나온다. L-3 규칙(`isLocalPathSyntax`)은 이것을 로컬이 아니라고 본다.
  - `open`은 `isDirectory("\\files.example.invalid\share\work")`를 불렀다. `\\.\pipe\x`도 불렀다.
  - `gui-state.json`에 UNC 경로가 있으면 `recent()`가 부를 때마다 그 경로에 `isDirectory`를 불렀다.
- 영향
  - 실제 `stat`이면 SMB 접속과 Windows 자격 증명 교환이 생길 수 있다. `\\.\pipe\…`는 다른 프로세스의 파이프 서버에 연결한다.
  - 두 번째 시작의 인자는 사람이 고른 대화상자 경로가 아니다(만든 바로 가기나 다른 로컬 프로세스).
  - CLI는 같은 입력을 파일 시스템을 건드리기 전에 거부한다(S-5, T-12 `localPathProblem`).
  - 사용자 쪽 동작이 있어야 하므로 낮음이다(L-3과 같은 판정).
- 권고: `isLocalPathSyntax`를 `folderArgument`의 결과, 최근 목록 읽기(`isRecent`), `open`·`recent`의 `isDirectory` 앞에 둔다. 원격·장치 경로는 건드리지 않고 거부한다(예: `workspace_not_local`). 대화상자가 돌려준 원격 폴더도 CLI·엔진이 쓰지 못하므로 같이 거부하는 편이 맞다.

### 참고 (건수에 넣지 않음)

- I-1 파일 트리는 설정에 등록한 가릴 값(`secretEnv`)을 가리지 않는다.
  - 설계 3.3에 "[GU-2 임시]"로 적힌 한계다. 재현(`run-life.mjs`): 설정의 `secretEnv`로 등록한 값이 이름인 파일이 화면의 트리에 평문으로 보였다.
  - 키 모양 이름은 `[key].txt — 가린 이름`으로 가려지고 열 수 없었다. 가짜 키 값은 화면 어디에도 없었다.
  - 앱 계층의 작업 공간 목록 함수(계약 필요, A-4 보고서 11절 표)가 생기면 없어진다.
- I-2 `recent()`는 폴더의 전체 경로(`path`)를 화면에 준다(재현에서 `D:\…\ws`).
  - 설계 4.2는 "사용자가 고른 폴더의 표시 이름과 그 대화상자에서 받은 경로"를 허용한다.
  - 두 번째 시작으로 들어온 폴더는 대화상자에서 받은 것이 아니다. 화면에 이름만 주거나 가린 경로를 주는 편이 원칙에 더 맞다.
- I-3 엔진 호스트의 트리는 `src/workspace`와 `src/cli/text-safety`를 직접 불러 쓴다. 설계 5절은 "GUI가 `src/store`, `src/cli`를 직접 부르지 않는다"인데, 3.3이 GU-2 임시로 밝혔다.
- I-4 `--inspect`와 `NODE_OPTIONS=--inspect`는 종료 전 잠깐 포트를 연다(480 ms, 1,561 ms). `--inspect-brk`는 막지 못한다. 설계 6.7과 연기 시험 NOTE에 적힌 한계이고 fuses(GU-9)가 막는다.
- I-5 메인이 강제 종료되면 엔진 호스트는 최대 약 1.5초(유예 1초 + 종료 0.5초) 더 산다. L-2 수정의 의도 범위다.
  - 지금 `main.ts`는 `serve`에 `onInputEnd`를 넘기지 않는다. GU-3이 실행을 붙일 때 여기서 실행을 취소해야 한다(코드 주석과 같음).

## 3. GU-2 추가분에서 본 것(문제 없음)

- 격리
  - 화면 코드에 `fetch`, `XMLHttpRequest`, `WebSocket`, `location` 변경, `window.open`, HTML 삽입, `eval` 류가 없다.
  - 속성은 `class`, `id`, `type`, `role`, `lang`, `data-*`, `aria-*`만 쓰고, 깊이는 CSSOM 숫자로만 쓴다.
  - 빌드의 금지 API 검사가 통과했다. 연기 시험에서 화면에 `process`, `require`, `ipcRenderer`, `module`이 없다.
- 통로
  - preload 함수는 8개와 이벤트 1개다(`onWorkspaceOpened`). 채널은 상수다.
  - 인자는 preload에서 문자열·0 이상 정수로 바꾸고, 메인이 보낸 쪽(창, 주 프레임, 앱 출처)과 형식(핸들·id 16진수, 모르는 필드 거부, 쪽 상한)을 본다.
  - 이벤트 객체는 화면에 가지 않는다. 연기 시험에서 경로 문자열은 `invalid_args`, 모르는 항목은 `unknown_entry`, 모르는 `reveal`은 `false`였다.
- 트리
  - 메인은 가리지 않은 디렉터리·파일에만 id를 주고 실제 이름은 메인에 둔다.
  - `hostile-tree.mjs`: 엔진 호스트에 보낸 잘못된 요청이 모두 거부되었고 호스트는 계속 답했다.
    - 상대 작업 공간, `..`, `sub/../..`, 역슬래시, 절대 경로, 스트림 이름, 음수 쪽, 남는 필드 → `invalid_args`/`invalid_path`
    - `.codaryn` → `state_dir`
    - 큰 쪽 번호는 빈 쪽이었다.
  - `gu2-tree-swap.mjs`: 나열한 폴더를 펼치기 전에 작업 공간 밖을 가리키는 정션으로 바꾸면 `outside_root`로 거부했다. 안쪽을 가리키는 정션은 이름으로 부르면 나열되지만, 메인이 링크에는 id를 주지 않아 화면이 펼칠 수 없다.
  - 연기 시험: 정션은 "링크, 따라가지 않음", `.codaryn`은 "Codaryn 기록, 열지 않음".
- `reveal`은 id로 정한 경로에 `shell.showItemInFolder`만 쓴다. 열거나 실행하지 않는다.
- 바깥 요청: 연기 시험에서 TCP 0, UDP 0, 바깥 연결 0, 사전 내려받기 없음.
- `gui-state.json`: N-1 설정 디렉터리. 임시 파일과 이름 바꾸기로 쓰고, 모양이 틀리면 빈 상태다. 키·권한·목표는 담지 않는다. 다만 UNC 경로를 받는다(R10b-L-2).

## 4. 실행 기록

- 루트 `tsc -p tsconfig.json`: 오류 0.
- GUI 빌드: 금지 API 검사 통과, tsc 네 벌 오류 없음.
- `check-lock.mjs`: "13 packages, development only, registry, sha512, no install scripts".
- GUI 유닛: 69건 중 69 통과.
- 연기 시험: 33/33 통과. NOTE 1건(`--inspect-brk`, GU-9 fuses 필요).
- 탐침: `D:\project\Codaryn\.worktrees\claude-adapter\.codaryn\r10b\probes\` 아래에 있다.
  - `late-answer.mjs`·`slow-host.mjs`: M-1
  - `late-beyond-limit.mjs`: R10b-L-1
  - `eof-during-call.mjs`: L-2
  - `node-path-unc.mjs`: L-3
  - `run-switch.mjs`·`life.mjs`: L-1
  - `run-life.mjs`·`life.mjs`: 수명(quit, kill), 화면 노출, I-1, I-2
  - `gu2-network-paths.mjs`: R10b-L-2
  - `gu2-tree-swap.mjs`, `hostile-tree.mjs`: 트리

## 5. 고친 것

없음(읽기 전용 검토).
