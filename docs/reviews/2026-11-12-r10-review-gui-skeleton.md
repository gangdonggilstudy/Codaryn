# R-10 검토 보고서: GU-1 (`claude/gui-design` c28d524, `gui/**`)

```
검토자: w3:pA (구현자가 아닌 세션), 읽기 전용
대상: claude/gui-design c28d524 "feat(gui): GU-1 skeleton with an isolated window and a Node 26 engine host"
기준: docs/design/standalone-gui.md (main f6a3dbc 판), DR-8, DR-20, DR-26
결과: 높음 0, 중간 1, 낮음 6, 참고 5
실행한 것: GUI 유닛 35건 통과, lock 검사 통과, 연기 시험 14/14 통과, 직접 만든 탐침 8개(아래 4절)
실행하지 않은 것: 실제 API, 새 설치·내려받기, 패키지 빌드(GU-9 전)
```

- 기준 문서 주의: main의 `standalone-gui.md`는 DR-26 전 판이다(엔진 호스트를 utilityProcess로 적음). 프로세스 구조는 DR-26(별도 Node 26 이상, 표준 입출력만)을 기준으로 봤다. 브랜치의 문서 갱신 `8c594e7`은 main에 없다.
- 실행 장소
  - 커밋 트리를 `git archive`로 scratchpad에 꺼내 빌드했다. 다른 세션의 worktree에는 쓰지 않았다.
  - TypeScript는 내 worktree의 루트 것(7.0.2, 같은 판)을 복사해 썼다.
  - Electron은 `claude-gui/gui/node_modules/electron`에 이미 설치된 실행 파일을 경로로만 실행했다. 타입 검사용으로 `dist` 없는 패키지 파일만 복사했다.
- 엔진 빌드에는 `src/i18n/en.ts`, `ko.ts` 타입 오류 2개가 있다(문구 담당, GU-1과 무관). 산출물은 만들어졌다.

## 1. 중점 항목별 결론

| 중점 | 결론 | 근거 |
| --- | --- | --- |
| 렌더러 격리 | 맞음 | `security-policy.ts`: `contextIsolation`, `sandbox`, `nodeIntegration*` 끔, `webviewTag` 끔, 메모리 세션. `app.enableSandbox()`를 준비 전에 부른다. 연기 시험: 화면에 `process`·`require`·`ipcRenderer`·`module` 없음. 내 탐침: `window`에 `codaryn` 말고 Node·IPC 이름 없음 |
| preload 통로 | 좁음 | 함수 세 개(`info`, `openFolder`, `doctor`)에 채널은 상수다. `doctor`는 문자열 아닌 인자를 null로 바꾼다. 메인은 보낸 쪽(창, 주 프레임, `app://codaryn/`)과 인자(핸들 형식, 모르는 필드 거부)를 본다. 경로 문자열은 `invalid_args`, 모르는 핸들은 `unknown_workspace`(연기 시험) |
| 바깥 요청·원격 콘텐츠 | 막힘 | 두 세션 모두 `app://codaryn/` 밖 요청 취소, 탐색·새 창·webview·내려받기·권한 거부, 맞춤법 사전 끔. CSP 헤더와 meta. 연기 시험: http·file 요청, `window.open`, 탐색 모두 막힘, 사전 내려받기 없음. 참고 I-2 |
| 듣는 소켓 | 없음(TCP·UDP) | 연기 시험과 다시 돌린 결과 모두 앱 프로세스 5개(Browser, GPU, Tab, NetworkService, 엔진 호스트)에서 TCP 0, UDP 0. 이름 있는 파이프는 재지 않는다(L-6). 디버깅 인자·환경 변수 예외는 L-1 |
| 엔진 호스트의 수명 | 대체로 맞음 | 정상 종료(`app.quit`)와 메인만 강제 종료(`taskkill /F`, 자식 제외) 모두 직후 호스트가 없었다(stdin EOF). 진행 중인 호출이 있으면 그만큼 더 산다(L-2). 연기 시험은 이것을 보지 않는다(L-5) |
| 메시지 통로의 견딤 | 호스트 쪽 맞음, 메인 쪽 결함 1 | 실제 호스트에 잘못된 JSON, 다른 판, 음수 id, 모르는 호출, 남는 필드, 상대 경로, NUL, `__proto__`, 20만 단계 중첩, 9 MiB 줄, U+2028을 보냈다. 모두 거부·기록만 하고 계속 답했다. `Object.prototype` 오염 없음. 메인은 늦게 온 정상 답을 위반으로 보고 호스트를 죽인다(M-1) |
| 키·환경 변수가 렌더러로 | 안 감 | 가짜 키·가짜 비밀 변수를 넣고 Electron으로 실행했다. `info`·`doctor` 응답과 화면 HTML·제목에 그 값과 홈 경로가 없었다. 키는 "있음"만 보인다. 메인은 환경을 복사만 하고 키를 읽지 않는다(코드 확인) |
| 엔진 호스트의 Node 경로 | 작업 공간·저장소가 못 바꿈 | `npm_node_execpath`(절대 경로 파일) → PATH의 절대 경로 항목만. 상대 항목과 cwd는 쓰지 않고, 절대 경로로 `shell: false` 실행한다. 호스트는 작업 공간을 열기 전에 뜬다. 버전은 `ready`로 26 이상을 확인한다. 바꿀 수 있는 것은 사용자 환경뿐이다. 다만 원격·장치 PATH 항목을 건드린다(L-3) |

## 2. 결과

### 중간

#### M-1 제한 시간이 지난 호출의 늦은 답이 엔진 호스트를 죽이고, 함께 기다리던 호출도 실패시킨다

- 위치
  - `gui/src/shared/protocol.ts` `PendingCalls.wait`: 시간이 다 되면 id를 지운다.
  - `gui/src/main/engine-client.ts:126`: `pending.settle`이 false면 `violation()`을 부른다.
- 재현(탐침 `late-answer.mjs`, 가짜 호스트가 300 ms 뒤 답)
  - 첫 호출 제한 100 ms → `adapter_timeout`.
  - 그 사이 5초 제한의 두 번째 호출이 기다리는 중이었다.
  - 첫 호출의 늦은 답이 오자 `host.exited = true`가 됐다.
  - 두 번째 호출은 `adapter_host_exited`("broke the message channel")로 끝났다. 이후 호출도 모두 실패했다.
- 영향
  - `doctor`(60초)나 `messages`(10초)가 한 번 늦으면 엔진 호스트가 죽는다. 큰 작업 공간이나 느린 드라이브에서 생길 수 있다.
  - GU-1에는 다시 띄우는 길(4.4의 "엔진 다시 시작")이 아직 없어 앱을 다시 켜야 한다. 긴 호출이 들어오는 다음 단위(실행, 적용)에서는 더 자주 생긴다.
- 권고
  - 시간이 지난 id를 기억해 그 늦은 답은 조용히 버린다(개수 상한).
  - 모르는 id(발급하지 않은 id)만 위반으로 본다.
  - "제한 시간 뒤 늦은 답에도 호스트가 살아 있고 다른 호출이 답을 받는다" 시험을 더한다.

### 낮음

#### L-1 Node 검사기 인자와 `NODE_OPTIONS`는 시작 때의 스위치 검사보다 먼저 듣는 소켓을 연다 (개발 실행)

- 내 탐침(`run-switch.mjs`, loopback, 20 ms 간격 접속 시도)
  - `--remote-debugging-port`: 96 ms에 종료 코드 2. 포트는 열리지 않았다. 의도대로다.
  - `--inspect=127.0.0.1:p`: 45 ms에 포트가 열리고 73 ms에 종료 코드 2.
  - `--inspect-brk=…`: 35 ms에 포트가 열리고 앱이 끝나지 않았다. Node가 앱 코드 전에 멈춰 검사가 돌지 않는다.
  - `NODE_OPTIONS=--inspect=…`: 44 ms에 포트가 열리고 앱이 그대로 동작했다. 검사가 환경 변수를 보지 않는다.
- 평가
  - 사람이 직접 준 실행 인자·환경이고 패키지하지 않은 개발 실행이라 낮음이다.
  - 그러나 커밋 설명 "forbidden debug switches end the app"과 GS-15("듣는 소켓이 없다")는 시작 검사만으로는 성립하지 않는다. fuses(6.7, GU-9)가 있어야 한다.
- 권고
  - GU-9의 GS-15 시험에 `--inspect`, `--inspect-brk`, `NODE_OPTIONS` 세 형태를 넣는다.
  - 그 전에는 시작 때 `inspector.url()`이 있으면 끝내는 검사를 더하면 `--inspect`와 `NODE_OPTIONS`의 열린 시간이 줄어든다. `--inspect-brk`는 fuses만 막는다.
  - 코드 주석과 커밋 설명의 범위를 이에 맞춘다.

#### L-2 메인이 사라져도 진행 중인 호출이 끝날 때까지 엔진 호스트가 남는다 (DR-8)

- 위치: `gui/src/engine-host/host.ts` `serve`. 입력이 끝나도 `await Promise.all(running)`으로 진행 중인 호출을 기다린다.
- 재현(탐침 `eof-during-call.mjs`): 3초 걸리는 가짜 `doctor` 요청 직후 입력을 닫자 `serve`가 3,009 ms 뒤에 끝났다. 답은 닫힌 통로에 쓰였다.
- 영향
  - GU-1의 `doctor`는 짧다.
  - 실행(GU-3)이 들어오면 앱이 비정상 종료한 뒤에도 실행 시간만큼 호스트가 남는다. 그 사이 엔진이 파일을 바꾸며 계속 일할 수 있다.
- 권고: 입력 끝(EOF)을 앱 종료로 보고 진행 중인 실행을 취소(`handle.cancel()`)한다. 정한 시간 안에 끝나지 않으면 스스로 끝난다. 실행 단위의 시험에 넣는다.

#### L-3 Node를 찾을 때 PATH의 네트워크·장치 경로를 건드린다

- 위치: `gui/src/main/node-path.ts:37-41`. `isAbsolute`만 보므로 `\\server\share`, `\\.\pipe\…`도 후보가 되고 `statSync`가 불린다.
- 재현(탐침 `node-path-unc.mjs`): PATH가 `\\files.example.invalid\tools;\\.\pipe\x;.;relative\bin;C:\Program Files\nodejs`일 때 `isFile` 호출 순서는 다음과 같았다.
  1. `\\files.example.invalid\tools\node.exe`
  2. `\\.\pipe\x\node.exe`
  3. `C:\…\node.exe`
- 영향
  - PATH에 원격 항목이 있으면 앱 시작마다 SMB 접속이 생긴다. Windows 자격 증명이 오갈 수 있다.
  - CLI `doctor`는 같은 경우 "remote paths are not accessed"로 그 항목을 건드리지 않는다(`src/cli/doctor.ts:128-137`, `:262`). 같은 저장소 안에서 규칙이 다르다.
  - 사용자 환경에서만 생기므로 낮음이다.
- 권고: CLI의 PATH 항목 분류(로컬·원격)를 같이 쓰고, 원격·장치 항목은 건너뛴다. `npm_node_execpath`도 같은 규칙으로 본다.

#### L-4 앱 프로토콜의 실제 경로 확인이 다른 드라이브를 놓친다

- 위치: `gui/src/main/protocol.ts:36-37`
  - `relative(base, real)` 결과를 `..`로만 본다.
  - Windows에서 다른 드라이브면 `relative`가 절대 경로(`C:\other\x.js`)를 돌려줘 통과한다(확인함).
  - `app-url.ts:54`는 `isAbsolute`도 보는데 이 두 번째 확인에는 없다.
- 영향
  - 빌드 디렉터리(`gui/build/src/renderer`) 안에 다른 드라이브를 가리키는 링크·정션이 있으면 그쪽의 `.html`, `.js`, `.css`를 앱 출처로 내준다.
  - 빌드 디렉터리에 쓸 수 있으면 코드도 바꿀 수 있으므로 낮음이다. 끝에서 끝까지 재현하지는 않았다(정션을 만들지 않음).
- 권고: `isAbsolute(inside)`를 더해 `app-url.ts`와 같은 조건으로 맞추고, 시험을 둔다.

#### L-5 연기 시험이 DR-8 수명과 GS-15를 보지 않고, 소켓 측정 실패를 통과로 셀 수 있다

- 설계 14.3의 GU-1 완료 기준은 연기 시험에 "스위치 검사(GS-15)"를 넣는다. `smoke.ts`는 스위치를 주고 실행하지 않는다. 유닛은 `forbiddenSwitch` 순수 함수만 본다.
- 앱 종료 뒤 엔진 호스트가 끝났는지(DR-8)를 보는 시험이 없다. 내 탐침으로는 통과했다(1절).
- `smoke.mjs:53`의 `listening` 기대는 `typeof v === "string"`이면 통과다.
  - 지금은 Windows가 아닐 때만 문자열이 나온다.
  - 그러나 `Get-NetTCPConnection`·`Get-NetUDPEndpoint`를 `-ErrorAction SilentlyContinue`로 불러, 명령이 실패하면 0개로 세어진다.
- 권고: 연기 시험에 세 가지를 더한다.
  - 종료 뒤 호스트 PID 확인(정상 종료와 메인 강제 종료)
  - 스위치 실행(L-1의 형태 포함)
  - 측정 실패를 실패로 세기

#### L-6 설계 6.1의 "이름 있는 파이프 없음"을 재지 않으며, Electron은 파이프를 만든다

- 탐침(`run-pipes.mjs`): 앱이 떠 있는 동안 새로 생긴 `\\.\pipe\` 이름 12개 중 7개가 앱 PID를 담았다.
  - Chromium 내부 IPC의 `LOCAL\mojo.<pid>.<tid>.<임의값>`
  - 엔진 호스트 표준 입출력의 libuv `uv\…-<메인 PID>`
- 이 파이프들은 임의 이름이거나 한 번만 연결되는 것으로 보이지만 [추정], 다른 프로세스가 열 수 없는지(ACL)는 확인하지 않았다.
- 설계 6.1은 "다른 프로세스가 열 수 있는 이름 있는 파이프를 열지 않는다"이고 GS-1은 TCP·UDP만 잰다. Electron을 쓰는 한 Chromium 내부 파이프는 없앨 수 없다.
- 권고: 규칙을 다시 정하고, 정한 범위를 연기 시험에 넣는다(6절 질문 1).
  - 예: "Chromium·libuv 내부 파이프는 제외하고, 앱 코드가 만드는 듣는 파이프는 없다"
  - 또는 ACL 확인을 E-9와 함께 한다

### 참고 (건수에 넣지 않음)

- I-1 GU-1 범위
  - 설계 14.3의 preload 일곱 개 중 `onEvents`, `recent`, `openRecent`, `forgetRecent`가 없다. `gui-state.json`(최근 폴더)도 없다.
  - 커밋 설명은 세 개라고 밝힌다. 줄인 범위를 받을지는 PM이 정한다.
  - E-1(내장 Node 호환)은 DR-26으로 대상이 바뀌어 해당 없다.
- I-2 `security.ts:27`은 `devtools://` 요청을 개발자 도구를 켰는지와 상관없이 허용한다. 패키지 빌드에서는 도구가 꺼져 쓰이지 않지만, 켰을 때만 허용하면 목록이 더 좁다.
- I-3 `engine-client.ts` `close()`는 시간이 지나면 `kill()`하지만, 종료 사건이 오지 않으면 끝나지 않는다. `before-quit`이 이를 기다리므로 그 경우 앱 종료가 멈춘다. 보지 못한 경우이며, 상한 시간 뒤 그냥 끝내는 길을 두면 된다.
- I-4 엔진 호스트 환경
  - 설계 4.3대로 `NODE_OPTIONS`, `NODE_PATH`, `ELECTRON_RUN_AS_NODE`만 뺀다.
  - `NODE_TLS_REJECT_UNAUTHORIZED`, `NODE_EXTRA_CA_CERTS`, `NODE_REDIRECT_WARNINGS`, `NODE_V8_COVERAGE`는 그대로 간다. CLI와 같은 노출이라 GUI만의 결함은 아니다.
  - Node 26의 설정 파일은 `--experimental-default-config-file`을 줄 때만 읽으므로 cwd(홈)에서 자동으로 읽는 파일은 없다(`node --help` 확인).
- I-5 `shared/ipc.ts`의 "DoctorCheck.message: never a value from a file or the environment"
  - CLI `doctor` 문구는 고정 글, 개수, 위치(필드·항목 번호)로 이루어져 대체로 맞다.
  - `config_file` 실패 문구는 `parseConfig`의 메시지(필드 위치)를 그대로 싣는다. 값이 들어가지 않는다는 보장은 CLI 쪽 규칙(S-6)에 기댄다.

## 3. 설계와의 대조 (중점 밖)

- 6.2: 목록의 설정이 모두 있다. `devTools`는 패키지 빌드에서 꺼지고, 개발 때 `CODARYN_GUI_DEVTOOLS=1`로만 켜진다(원격 포트 없음).
- 6.3: 프로토콜 처리기(GET만, 허용 형식 세 개, 인코딩·`..`·질의·포트·사용자 정보 거부, 실제 경로 확인), CSP, `userData`(`%LOCALAPPDATA%\Codaryn\gui-profile`) 모두 맞다. L-4만 예외.
- 6.4~6.5: 보낸 쪽 확인, 손으로 쓴 검사기, 128비트 핸들, 창을 닫으면 핸들 비우기, 개수 상한 1000.
- 6.7: 시작 때 스위치 검사 있음(L-1). fuses는 GU-9.
- 6.9: 단일 인스턴스, 호스트 stderr 버림(개발 옵션에서만 넘김), 기록 파일 없음.
- 4.4: 자동으로 다시 띄우지 않는다. 다시 띄우는 단추는 아직 없다(M-1과 함께 볼 것).
- DR-20: Electron 45.3.1 고정, 개발 의존성만 있다. 루트 `package.json`·lock은 바뀌지 않는다(diff 확인).
- DR-26: 별도 Node 26 이상, 표준 입출력만, 버전 확인(양쪽), 앱과 함께 종료(L-2 예외).

## 4. 실행 기록

- GUI 빌드(`scripts/build/build.mjs`): 화면 금지 API 검사 통과, tsc 네 벌 오류 없음.
- `check-lock.mjs`: "13 packages, development only, registry, sha512, no install scripts".
- GUI 유닛: 35건 중 35 통과(1.1초).
- 연기 시험(브랜치의 `smoke.mjs` 그대로, Electron 경로만 설치본으로): 14/14 통과. 열기 전·후 모두 TCP 0, UDP 0. 사전 내려받기 없음. 호스트 Node 26.13.1.
- 탐침: 모두 `C:\Users\gangd\AppData\Local\Temp\claude\21110c3621286809\45ddd008-6a22-4799-a00f-c1b65f4da7e7\scratchpad\r10-probes\` 아래에 있다.
  - `late-answer.mjs` + `slow-host.mjs`: M-1
  - `hostile-lines.mjs`, `two-lines.mjs`: 1절 "메시지 통로"
  - `life.mjs` + `run-life.mjs`: 수명(quit, kill)과 렌더러 노출
  - `run-switch.mjs`: L-1
  - `eof-during-call.mjs`: L-2
  - `node-path-unc.mjs`: L-3
  - `run-pipes.mjs`: L-6
- 탐침 실행 뒤 `electron.exe` 프로세스가 남지 않았음을 매번 확인했다. 열린 포트는 모두 loopback의 시험 포트다.

## 5. 고친 것

없음(읽기 전용 검토).

## 6. PM 질문

1. 설계 6.1의 "이름 있는 파이프" 규칙을 Electron의 내부 파이프(mojo, libuv)에 어떻게 적용할지 정해야 한다(L-6).
   - 가정: 앱 코드가 만드는 듣는 파이프만 금지로 보고 L-6을 낮음으로 둔다.
2. GU-1의 줄인 preload 범위(세 함수, 최근 폴더 없음)를 이 단위의 완료로 받을지(I-1).
   - 가정: 받는다. 다음 단위에서 채운다.
