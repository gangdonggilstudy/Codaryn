# R-90 검토: U-70 창 상태 기억과 끌어서 바꾸는 경계

- 검토자: 검증 엔지니어 (w3:p4, ne-verify). 읽기 전용. 저장소 수정·커밋 없음.
- 실제 API·외부 네트워크 없음.

## 검토한 해시

| 대상 | 해시 |
|---|---|
| main | `29c5df4` |
| U-70 `unit/U-70-p5u-gui` (검토 시작 때의 끝) | **`bb1973b`** (11:45:54, base `b65fe75`, U-69 `4f4209b`를 품음) |
| 합친 판 = main + U-70 | **`b042873eca95e3f0e30686df8198658f421b7f29`** |

- 합친 판은 `git merge-tree --write-tree`와 `git commit-tree`로 만들었다. 충돌은 없었다.
- U-70의 몫은 main ↔ main+U-70의 17파일(+490 −17)이다. 주요 파일은 `gui-state.ts`, 새 파일 `window-bounds.ts`, `workspaces.ts`, `app.ts`, `ipc.ts`, `shell.ts`, 유닛 시험 `u70-window-state.test.ts`다.
- 검토가 끝날 때까지 브랜치 끝은 바뀌지 않았다.
- 검토 시작 때 `unit/U-118-p5u-gui`와 `unit/U-119-p5u-gui`는 아직 없었다.

## 합친 판 수치

| 항목 | 결과 | 기록 |
|---|---|---|
| 루트 `npm run build` | exit 0 | `.codaryn/r90/build-root.log` |
| GUI `npm test` | tests 246, pass 246, fail 0, skipped 0 | `.codaryn/r90/gui-unit.log` |
| GUI `npm run test:smoke` | 211 of 211 checks passed, app exit 0 | `.codaryn/r90/smoke.log` |

- Electron은 `claude-gui`의 `gui/node_modules`를 junction으로 걸어 경로로만 썼다.
- U-70의 연기 검사 둘이 ok다.
  - `windowState`: Home으로 최소 160, 오른쪽 화살표로 +16, 끌기로 +100. 패널 너비가 같고, `gui-state.json`에 `screen: "checks"`, `treeWidth: 276`이 쓰였다.
  - `windowRemembered`: 앱을 끝낸 뒤 `gui-state.json`에 크기가 남고, `treeWidth` 276, `screen`이 문자열이다.

## 판단

| 높음 | 중간 | 낮음 | 정보 |
|---|---|---|---|
| 0 | 0 | 1 | 3 |

받아들일 수 있다.

---

## 볼 것별 결과

**변경 요약**
- `gui-state.json`에 `window`가 더해진다. 칸은 `bounds {x, y, width, height}`, `maximized`, `screen`, `treeWidth`다(`gui/src/main/gui-state.ts`의 `WindowMemory`, `windowOf`).
- 크기·위치·최대화는 주 프로세스가 창에서 직접 읽는다(`getNormalBounds()`, `isMaximized()`). 바뀐 뒤 500ms, 최대화·복원 때, 닫을 때 저장한다(`app.ts`).
- 마지막 화면과 트리 너비는 화면이 `saveUi`로 보내고, 주 프로세스가 `parseSaveUiArgs`로 거른다(`shared/ipc.ts`).
- 앱이 끝날 때 `before-quit`에서 저장 중인 쓰기를 기다린다(`workspaces.flush()`).

### (1) 더해진 것이 창 크기·위치·탭·트리 너비뿐인가

**그렇다.**
- 연기 실행이 남긴 실제 `gui-state.json`(`build/smoke-state`)의 최상위 키는 `schemaVersion`, `recentWorkspaces`, `workspaceMemory`, `window` 넷이다. `window`는 `{"bounds":{"x":303,"y":129,"width":1101,"height":761},"maximized":false,"screen":"run","treeWidth":276}`이다. 작업 공간 기억의 칸(`path`, `lastForm`, `runs`)은 전과 같다.
- 화면은 크기·위치·최대화를 보낼 수 없다. `parseSaveUiArgs`는 `screen`과 `treeWidth` 두 키만 받는다. 아래 경우는 모두 거부된다(`STATE.log`).
  - 경로(`C:\work\a.txt`)나 목표(`fix the bug`)를 `screen`으로 보냄
  - `bounds`나 `maximized`를 보냄
  - 범위 밖 너비, 키 하나 더, 빈 객체
- `screen`은 `/^[a-z]{1,20}$/`이라 경로·목표·파일 이름 같은 글(대문자, 공백, `\`, `:`, `.`)은 들어갈 수 없다. 다만 고정된 화면 id 목록보다는 넓다(I1).
- 읽을 때 `windowOf`가 네 칸만 다시 만든다. 다른 칸(`goal`, `path`)이 파일에 있어도 버린다.

### (2) 깨진 값·범위 밖 값을 읽을 때 닫힌 쪽으로 가는가

**그렇다(위치 하나는 L1).** 빌드된 `parseGuiState`·`windowOf`로 쟀다(`.codaryn/r90/state.mjs`, `STATE.log`, 모두 기대와 같음).

| 읽은 값 | 결과 |
|---|---|
| `window`가 객체가 아님, null | 빈 기억(기본값) |
| `bounds`: 음수 크기, 199 이하, 20,001 이상, 좌표 ±50,001, 글자 `"10"`, 소수 `10.5`, null, 빠진 칸, `1e300` | `bounds`만 null. 같은 줄의 `maximized`·`screen`·`treeWidth`는 지킨다 |
| `bounds`의 음수 좌표(주 화면 왼쪽의 다른 디스플레이) | 지킨다(정당한 값) |
| `maximized`가 `"yes"` | false(`=== true`만 참) |
| `screen`: `Checks`, 경로, `a b`, 빈 글, 21자, 숫자 | null |
| `treeWidth`: 159, 801, −1, 300.5, `"300"`, 1e9 | null(160~800 정수만) |
| JSON이 아닌 파일 | 빈 상태(전과 같음) |

**어디에 여는가**(`fitBounds`, `window-bounds.ts`): 지금 디스플레이들의 작업 영역과 비교한다.

| 경우 | 결과 |
|---|---|
| 완전히 화면 밖(없어진 디스플레이), 99px만 보임, 디스플레이 없음 | 기본 크기 1100×760 |
| 영역보다 큼 | 크기를 영역에 맞춘다 |
| 두 번째 디스플레이 위 | 그대로 |
| 100px 이상 보임 | 위치를 옮기지 않는다(L1) |

창 화면도 닫힌 쪽이다. 마지막 화면은 되살리는 목록(`RESTORED`: home, newtask, runs, cleanup, checks, settings)에 있을 때만 쓴다. 아니면 home이다(`renderer/app.ts:246-247`). 연기 실행이 남긴 `screen: "run"`도 다음 시작 때는 home이 된다.

### (3) 원자적 쓰기가 그대로인가

**그렇다.**
- `writeGuiState`는 전처럼 같은 폴더의 임시 파일(`<파일>.<6바이트 hex>.tmp`, `flag: "wx"`)에 쓴 뒤 `rename`한다. 바뀐 것은 쓰는 JSON에 `window`를 더한 것뿐이다.
- 빌드된 함수로 쓰고 다시 읽었다. 키 넷, `window` 그대로, 임시 파일이 남지 않았다(`STATE.log`).
- 저장 순서: 창 기억의 바뀜은 자기 줄(`remembering`)로, 파일 쓰기는 기존 줄(`writing`)로 차례를 지킨다.
- 앱이 끝날 때 `before-quit`이 한 번 막고 `flush()`(두 줄 모두)를 기다린 뒤 끝낸다. 엔진 호스트가 있으면 그 닫기와 함께 기다린다.
- `writeGuiState` 자체는 받은 `window` 객체를 거르지 않고 쓴다. 거르는 곳은 쓰기 전(`rememberWindow`의 `windowOf`)과 읽을 때다. 지금 부르는 길은 `rememberWindow` 하나라 문제없다(I2).

---

## 결함

### 낮음

- **L1 기억한 위치가 100px만 화면에 걸쳐 있으면 그대로 되살린다. 제목 표시줄이 화면 밖에 있을 수 있다.**
  - `fitBounds`는 한 디스플레이의 작업 영역과 가로·세로로 100px 이상 겹치면 x·y를 그대로 둔다. 영역보다 크면 크기만 줄인다.
  - 재현(`STATE.log`):
    - 1920×1040 영역에서 `{x: 100, y: -600, width: 1100, height: 760}`은 160px만 보이고 제목 표시줄은 화면 위에 있다. 그런데도 그대로 연다.
    - `{x: 1820, …}`처럼 오른쪽 끝에 100px만 걸친 창도 그대로다.
    - 영역보다 큰 창 `{x: -50, y: -50, 5000×3000}`은 크기만 영역에 맞고 위치는 −50, −50이다.
  - 실패 경우: 디스플레이 배치나 배율이 바뀐 뒤 앱을 열면, 창 대부분이나 제목 표시줄이 화면 밖에 걸린 채 열린다. 사람이 끌어 옮기기 어렵다(Windows에서는 Win+화살표로만 옮길 수 있다). 앱을 못 쓰게 되지는 않으므로 낮음이다.
  - 제안(둘 중 하나):
    - 제목 표시줄 띠(창 위쪽 수십 px 전체)가 작업 영역 안에 있을 때만 위치를 쓴다.
    - 받아들인 영역 안으로 x·y를 당긴다(`x = clamp(x, area.x, area.x + area.width − width)`, y도 같게).

### 정보

- **I1** 마지막 화면은 고정된 화면 id 목록이 아니라 "소문자 1~20자"면 무엇이든 저장된다(`SCREEN_ID`, `parseSaveUiArgs`, `windowOf`. 예: `anylowercaseword`가 남음). 되살릴 때 목록(`RESTORED`)으로 거르므로 동작은 안전하다. 다만 손상된 화면이 소문자 단어를 `gui-state.json`에 남길 수 있는 작은 통로다. 저장 때도 화면 id 목록으로 거르면 설계의 "탭"과 정확히 맞는다.
- **I2** `writeGuiState`는 `state.window`를 받은 그대로 쓴다(`extra` 칸을 넣어 주면 그대로 쓰인다). 지금은 `rememberWindow`가 `windowOf`를 거친 값만 넘기고, 읽을 때도 `windowOf`가 다시 거른다. 나중에 다른 길이 `save`를 부를 때를 위해, 쓰기 직전에 `windowOf`를 한 번 더 대면 쓰는 쪽도 닫힌다.
- **I3** 저장 줄이 둘(`remembering`, `writing`)이다. 다른 작업(최근 목록, 실행 형태)과 창 기억은 각각 "읽기 → 고친 상태 저장"을 한다. 상태를 한 번 읽은 뒤에는 `load()`가 기다림 없이 같은 `this.state`를 돌려주고 저장도 같은 이어짐에서 곧바로 일어나므로, IPC 처리기 사이에 덮어쓸 틈은 사실상 없다(코드로 확인). 앱 시작 직후 파일을 아직 읽지 않은 사이에 둘이 동시에 읽는 경우만 남는데, 이것은 U-70 전부터 있던 꼴이다.

## 방법과 남긴 것

- 사본: `git archive b042873 | tar -x`로 `.codaryn/r90/c`에 풀었다. root `node_modules`(claude-operations)와 GUI `node_modules`(claude-gui)는 junction으로 걸었다.
- 시험은 프로젝트 스크립트로 돌렸다. 루트 `npm run build`, `gui`의 `npm test`, `npm run test:smoke`.
- 탐침: `.codaryn/r90/state.mjs`. 합친 판 빌드의 `parseGuiState`, `windowOf`, `fitBounds`, `parseSaveUiArgs`, `writeGuiState`를 직접 불렀다. Electron은 쓰지 않았고, 임시 폴더는 스크립트가 지운다.
- 기록: `STATE.log`, `build-root.log`, `gui-unit.log`, `smoke.log`, `combined-commit.txt`.
- 이어서 볼 것: U-118(기록 탭), U-119(적용 전 점검). GUI 담당이 올리면 알림을 받고 본다.
