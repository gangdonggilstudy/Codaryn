# R-93 검토: GUI 단위 U-123 (R-87·R-82의 낮음 셋)

검토자: 검증 엔지니어(ne-verify, w3:p4). 읽기 전용. 저장소를 고치거나 커밋하지 않았다.

## 검토한 것

| 대상 | 해시 |
|---|---|
| U-123 `unit/U-123-p5u-gui` | `2b5e539` (12:56:30). 검토 끝(13:15)에도 같다 |
| base | `68df965` |
| main(지시) | `8cb5340` |
| 합친 판 | `15bd6751baee2fb8b4ddd8e213a2569b7d21fa39` = main `8cb5340` + U-123 `2b5e539` (`git merge-tree --write-tree` + `git commit-tree`, 참조 없음). 충돌 없음 |

- 단위 커밋은 `2b5e539`와 병합 `80ab2fe`다.
- 단위의 몫(main ↔ main+U-123)은 12파일 +155 −10이다.
  - `gui/src/main/ipc.ts`(+26)
  - 새 파일 `gui/src/main/on-disk.ts`(20)
  - preload, `renderer/api.ts`, `renderer/app.ts`, i18n en/ko, `shared/ipc.ts`
  - smoke.ts, smoke.mjs, `gui/tests/unit/u123-review-lows.test.ts`
- **main이 검토 도중 움직였다:** `8cb5340` → `118338d`(13:14:48). U-129, U-137, CP-23이 들어왔다.
  - gui 파일은 바뀌지 않았다. U-123은 `118338d` 위에서도 충돌 없이 합쳐진다.
  - U-129는 `RunListEntry`에 선택 필드 `review`를 더했다. GUI의 `toRunsReply`는 모르는 키를 거부하지 않으므로 무시된다.
  - 시험 수치는 지시대로 `8cb5340` 판에서 쟀다. `118338d` 판에서는 돌리지 않았다.

## 시험 수치 (판 `15bd675`)

| 시험 | 결과 |
|---|---|
| 루트 `npm run build` | exit 0 |
| GUI `npm test` | 257/257 통과(실패 0, 건너뜀 0) |
| GUI `npm run test:smoke` | 215/215 통과, 앱 종료 0 |

- 새 연기 확인 결과
  - `treeIdsDropped {"taken":true,"old":"unknown_entry","fresh":"copied","reread":"ok"}`
  - `startsBlocked []`
  - `treeProtected {"before":1,"marked":"package.json","note":true}`
- 기록: `.codaryn/r93/build-root.log`, `gui-unit.log`, `smoke.log`

## 판정

| 항목 | 높음 | 중간 | 낮음 | 정보 | 판정 |
|---|---|---|---|---|---|
| U-123 | 0 | 0 | 0 | 6 | 받아들일 수 있다 |

세 재현이 모두 닫혔다. 연기 시험의 고정 값 두 가지는 약해지지 않았다(아래 4절).

---

## 1. R-82 U-103 L1: 나열 뒤 등록한 값이 이전 id로 복사됨 → 닫힘

**변경:**
- 주 프로세스의 `applySettings`는 답이 `written: true`일 때 `dropTreeIds()`를 부른다. `createSettings`는 `ok`일 때 부른다.
- `dropTreeIds()`는 `workspaces.treeIds.clear()`를 한다. 트리 id와 변경 화면 id가 같은 표에 있으므로 둘 다 지워진다. 그 다음 창에 `codaryn:event:treereset`를 보낸다.
- 창은 `onTreeReset`을 받으면 `tree.refresh()`로 트리를 다시 읽는다.

**재현:** `.codaryn/r93/tree.mjs`, 기록은 `TREE.log`.
- 판의 실제 엔진 호스트에서 트리를 받고, 주 프로세스의 `Workspaces`로 id를 발급했다.
- 그 뒤 설정 화면이 보내는 꼴(`proposeSettings {edit:{op:"addSecretEnv", name}}` → `applySettings`)로 secretEnv 이름을 등록했다.
- `registerIpc`는 Electron 밖에서 돌지 않는다. 그래서 처리기의 두 줄(`toWrittenReply`, 그 다음 `treeIds.clear()`)을 그대로 따라 했다.

| 단계 | 결과 |
|---|---|
| 쓰기 전, `later-<값>.txt` id의 copyPath | `later-<값>.txt` |
| 등록 쓰기의 답 | `{"ok":true,"written":true,"changes":[{"field":"secretEnv","change":"changed"}],"widening":[]}`. 설정 파일은 `["R93_LATER"]` |
| id를 버리지 않았다면(U-123 전) | **지금 등록한 값이 든 이름을 복사한다**(R-82 재현과 같음) |
| 처리기가 버린 뒤, 이전 id의 copyPath | `unknown_entry` |
| 새로 나열 | `later-[[CODARYN_SECRET:…]].txt`, masked, **id 없음**. 답 어디에도 값이 없다 |
| 같은 이름을 다시 등록 | `proposeSettings`가 `already_present`. 쓰기가 없으므로 버릴 것도 없다 |

- 실제 창의 배선은 연기 `treeIdsDropped`가 확인한다. 언어 쓰기 뒤 이전 id는 `unknown_entry`, 새 id는 `copied`, 트리는 다시 읽혔다.
- 단위 시험(`u123-review-lows.test.ts`)은 `TreeIds.clear()`와 사건 이름만 본다. secretEnv 쓰기가 `written: true`를 돌려 버리기가 실제로 일어난다는 것은 위 탐침이 확인했다.

## 2. R-87 U-66 L1: 키 모양으로 가린 경로에 탐색기 보기 id → 닫힘

**변경:** 변경 화면의 id는 `revealableChange(file) && pathOnDisk(root, file.path)`일 때만 준다. `on-disk.ts`는 작업 공간 안의 상대 경로를 `lstat`해서 파일이나 폴더일 때만 참이다.

**재현:** `.codaryn/r93/changes.mjs`, 기록은 `CHANGES.log`.
- 대본 모델 실행이 파일을 만들고, 판의 실제 엔진 호스트에 `changes`를 물었다.
- 만든 파일: 보통 파일, 하위 폴더 파일, 등록 값 이름, 키 모양 이름, 보이지 않는 글자 이름, 상태 폴더 파일. 그리고 실행 뒤 지운 파일 하나.

| changes 경로 | state / unavailable | id(U-123 전) | id(U-123 뒤) |
|---|---|---|---|
| `made.txt` | as_run_left / null | 있음 | 있음(copy `made.txt`) |
| `sub/deep.txt` | as_run_left / null | 있음 | 있음 |
| `n-[[[[CODARYN_SECRET:…]]:…]].txt` | unknown / masked_path | 없음 | 없음 |
| **`k-[key].txt`** | as_run_left / null | **있음** | **없음** |
| `zw<U+200B>name.txt` | as_run_left / null | 없음(copyablePath) | 없음 |
| `gone.txt` | missing / null | 없음 | 없음 |

- 등록 값과 키 모양은 changes 답 어디에도 없었다.
- 상태 폴더 파일(`.codaryn/odd.txt`)은 실행이 만들지 못했다. R-87 때와 같다.

## 3. R-87 U-68 L1: 잠금이 풀려도 F5 전까지 새 작업이 꺼짐 → 닫힘

**변경:**
- 다른 프로세스의 잠금이 보이는 동안 "home"이나 "newtask" 화면을 보이면(`shell.show` → `shown`) 점검(`openCheck.run`)을 다시 한다.
  - `shell.show`는 같은 화면 단추를 다시 눌러도 불린다.
- 문구에 "F5를 누르거나 이 화면을 다시 열어 다시 확인"을 더했다(en/ko 각각 `open.locked`, `task.locked`).
- 이 문구는 R-87의 제안 첫째를 따랐다. 새 작업 화면에 머물러 있으면 여전히 저절로 켜지지 않지만, 문구가 그것을 말한다.

**확인:**
- 연기 `openCheck`는 잠금 파일을 지운 뒤 F5 대신 새 작업 단추를 다시 눌렀다. 안내가 숨고 실행 단추가 켜졌다(통과).
- `.codaryn/r93/lock.mjs`(기록 `LOCK.log`)는 판의 빌드된 `OpenCheck`로, 잠금이 **그대로인** 채 화면을 다시 보인 경우를 따라 했다. 규칙은 app.ts의 `lockedByOther`와 new-task.ts의 `applyLock`이다.
  - 열 때(잠금 있음): `noteHidden:false, runButtonOff:true`
  - 다시 보인 직후(점검 중): **`noteHidden:true, runButtonOff:false`**
  - 점검 답(잠금 그대로) 뒤: `noteHidden:false, runButtonOff:true`
  - 실제 엔진 호스트의 `doctor`는 작은 작업 공간에서 2~7ms 걸렸다(`DOCTOR-TIME.log`). → 정보 I5

## 4. 연기 시험의 고정 값 둘

- **API 목록에 `onTreeReset`**
  - 쪽 함수 목록은 정확히 같은지 비교하는 검사다. 함수 하나가 늘었으니 목록에 하나를 더한 것이다. 검사 자체는 그대로 엄격하다.
  - `onTreeReset`은 듣는 함수 하나를 받는다. 받은 사건의 내용은 넘기지 않는다(`() => treeResetListener?.()`). 경로나 값이 창으로 가는 길이 아니다.
- **`treeProtected`의 `before` 0 → 1**: 약해지지 않았다.
  - 전에는 "설정 쓰기 뒤에도 트리가 옛 상태(0)이고 F5가 새로 읽어 표시한다"를 보였다.
  - 이제 설정 쓰기가 트리를 다시 읽게 하므로 F5 전에 이미 1이다. 이것은 새 동작(`treereset` → 다시 읽기)을 직접 확인하는 값이다. 그 동작이 깨지면 0이 되어 실패한다.
  - F5 뒤의 `marked`도 여전히 다시 읽기를 거친다. F5는 트리 모형을 동기로 비우므로, `waitFor`는 새 답이 표시를 다시 그릴 때까지 기다린다.
  - "F5가 트리를 다시 읽는다" 자체는 U-67 연기(F5 뒤 `b.txt`)와 U-65 단위 시험(F5에 호출 2번)이 따로 확인한다.
  - 다만 `before`는 기다림 없이 읽는다. → 정보 I6
- 더한 것
  - `treeIdsDropped`
  - `startsBlocked`(실행 단추가 꺼진 채 시작하려 한 경우를 모은다; `[]`)
  - 잠금 단계는 F5 대신 화면 다시 보이기다.

---

## 정보

- **I1 설정 쓰기와 엇갈린 트리 답: 주 프로세스는 그 id를 남기고, 창은 그 답을 버린다.**
  - 엔진 호스트는 줄을 동시에 처리한다(`host.ts` `serve`의 `running`).
  - `tree.mjs` 3단계: 3,000개 항목 폴더의 `tree`를 먼저 보내고 곧 `applySettings`(R93_RACE 등록)를 보냈다.
    - 첫 시도에서 답은 **apply가 먼저, tree가 뒤**에 왔다.
    - tree 답은 옛 설정으로 만든 것이라 500개 모두 가려지지 않은 이름(지금 등록한 값이 든 이름)이었다.
  - 주 프로세스의 `tree` 처리기는 그 답을 `dropTreeIds()` 뒤에 받아 id를 발급한다. 그래서 그 id들은 버려지지 않고 copyPath에 쓸 수 있다.
  - 창은 `treereset` 사건을 같은 IPC 순서로 먼저 받는다. 그래서 `refresh()`가 세대를 올리고, 늦게 온 답은 `generation !== this.generation`으로 버려진다. 그 id를 가진 화면 요소가 없으므로 사람이 그 이름을 복사할 길은 없다.
  - 남은 것은 쪽 코드가 이미 받은 답의 id로 copyPath를 부르는 경우뿐이다. 클립보드는 쪽이 읽지 못한다.
  - 제안(방어 한 겹): `tree`·`changes` 처리기가 호스트 호출 전에 버리기 횟수를 기억한다. 호출 뒤에 그 수가 바뀌었으면 id를 발급하지 않는다(또는 `stale`로 답한다).
- **I2 앱 밖에서 설정을 바꾸면 id를 버리지 않는다.**
  - 예: CLI `codaryn init`이나 손으로 고친 설정 파일. 엔진 호스트는 다음 나열부터 새 설정으로 가리지만, 그 전에 받은 id는 copyPath가 그대로 받는다.
  - copyPath는 복사할 때 지금의 등록 값으로 다시 확인하지 않는다(`copyablePath`는 꼴과 키 모양 글자만 본다).
  - 지시에서 범위 밖으로 둔 경우다.
- **I3 `pathOnDisk`는 중간 폴더의 junction을 따라간다.**
  - `junc`가 바깥 폴더를 가리키는 junction이면 `pathOnDisk("junc")`는 거짓이지만 `pathOnDisk("junc/deep.txt")`는 **참**이다(`CHANGES.log`). lstat은 마지막 이름만 따라가지 않는다.
  - 주석의 "nothing is followed"는 마지막 부분에만 맞다.
  - U-123 전에는 아무 확인도 없었으므로 넓어진 것은 아니다. 실행이 바꾼 폴더를 실행 뒤에 junction으로 바꾸면, 그 변경의 "탐색기에서 보기"가 바깥 파일을 고른다.
  - 단위 시험의 junction 경우는 마지막 이름(`jump`)만 본다.
- **I4 이름이 `..`로 시작하는 파일(`..dots.txt`)은 id를 받지 못한다.**
  - `inside.startsWith("..")`가 `..dots.txt`도 거른다. `copyablePath`와 `revealableChange`는 그 이름을 받는다.
  - 같은 검사가 U-66부터 `reveal` 처리기에 있었다. 그래서 그런 파일의 "탐색기에서 보기"는 전에도 실패했다. 이제 변경 화면에서는 id가 없어 copyPath도 없다.
  - 제안: `inside === ".." || inside.startsWith(".." + sep)`.
- **I5 다시 점검하는 동안 잠금 판정이 '없음'으로 떨어진다. 연기 잠금 단계는 그 중간 상태에서도 통과할 수 있다.**
  - `openCheck.run`은 동기로 `checking`을 설정한다. `lockedByOther()`는 `phase === "done"`일 때만 참이다.
  - 그래서 잠금이 그대로여도 화면을 다시 보인 직후에는 안내가 숨고 실행 단추가 켜진다. 점검 답이 오면 다시 꺼진다(`LOCK.log`).
    - 사람에게는 2~7ms의 깜빡임이다.
    - 그 사이 실행을 눌러도 앱 계층이 `workspace_locked`로 막는다(R-87 확인).
    - U-123 전에는 F5와 열기 때만 이랬고, 이제는 잠금이 보이는 동안 home·newtask를 보일 때마다 그렇다.
  - 연기 `openCheck`의 `freed`(안내 숨김)는 클릭 직후 첫 평가에서 이 중간 상태로 통과할 수 있다. 이어 읽는 `runOn`도 점검 답 전이면 참이다. 그래서 이 단계는 "다시 점검해서 풀린 것을 봤다"를 확실히 가르지 못한다.
    - F5를 쓰던 전과 같은 약점이다. 새로 약해진 것은 아니다.
  - 제안(둘 다 가능)
    - 같은 작업 공간을 다시 점검하는 동안에는 직전의 `lockHeld`를 유지한다.
    - 연기 시험이 점검이 끝난 것(예: 점검 단계를 알리는 속성)을 기다린 뒤 읽는다.
- **I6 `treeProtected.before`는 설정 쓰기가 일으킨 다시 읽기가 끝났는지 기다리지 않고 읽는다.**
  - 그 사이에 설정 단계의 점검 화면 등 여러 기다림이 있어 이번에는 1이었다.
  - 다시 읽기가 늦으면 0이 되어 거짓 실패가 날 수 있다. `data-tree-ready`를 먼저 기다리면 확실하다.

---

## 실험 파일

`.codaryn/r93/` 아래에 있다.
- `tree.mjs` + `TREE.log`: R-82 U-103 L1 재현, I1
- `changes.mjs` + `CHANGES.log`: R-87 U-66 L1 재현, I3, I4
- `lock.mjs` + `LOCK.log`: R-87 U-68 L1, I5
- `doctor-time.mjs` + `DOCTOR-TIME.log`: 점검 시간

공통 조건
- 값은 모두 지어낸 것이고, 키 모양은 쪼개 만들었다.
- 설정 폴더(APPDATA·LOCALAPPDATA·XDG_CONFIG_HOME)는 임시 폴더로 돌렸다.
- 엔진 호스트는 `transport: "loopback-only"`로 띄웠다.
- 실제 API와 외부 네트워크는 쓰지 않았다.
- 판 사본 `.codaryn/r93/c`는 junction을 먼저 끊고 지웠다.
