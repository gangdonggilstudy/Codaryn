# V-5 정확성·경계 검증 — U-174/U-184

- 검증자: **codex-audit**, 검증 엔지니어(주), 보안·개인정보 검토자(보조).
- 검토 브랜치: `unit/U-184-p5u-gui`.
- 기준: `21107dc91d9522efbbb694f4da1bf79ffa1495d5`.
- 후보: `96b29fd42ab5087c7b6b182857595f48ecef9780`.
- 관리 저장소: `D:/project/Codaryn`, `main`. 저장소 파일은 읽기 전용.
- 실험 폴더: `D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-audit-v5-96b29fd`.
- 후보 사본은 위 폴더의 `candidate/`에 `git archive`로 풀었다. 새 worktree나 브랜치를 만들지 않았다.
- 기준 문서: DR-72·DR-73, **후보 판의** `docs/design/standalone-gui.md` 3.14, `docs/design/text-editing-ux.md`. UX 문서의 제안보다 3.14의 확정 사항을 적용했다.
- 환경: Windows, Node `v26.13.1`. Electron 모듈·타입·실행 환경 없음.
- **높음 0건 / 중간 2건 / 낮음 0건.** 두 중간 항목의 수정·회귀 검증을 요청한다. 최종 채택은 PM 판단이다.

## 비교 범위와 판의 주의점

요청한 `git diff 21107dc...96b29fd -- gui`를 실행했다. Git은 merge base가 여러 개라고 알리고 `98069b80d3db98181ab847337517c37867cbf9a3`를 선택했다. 이 비교에는 U-163 등도 포함된다(26개 파일, +2,239/-70).

따라서 정확한 두 끝점 비교 `git diff 21107dc 96b29fd -- gui`도 함께 보았다(23개 파일, +2,005/-13). 아래 결함 위치와 실행 수치는 모두 후보 `96b29fd` 기준이다. 원문은 `gui-three-dot.diff`, `gui-two-dot.diff`에 보존했다.

## 중간 M-1 — 토큰·항목 폐기가 진행 중인 읽기와 저장에는 적용되지 않음

**위치**

- `gui/src/main/ipc.ts:263`: `openText`가 작업 공간·항목을 처음 한 번 확인한다. `await host()`와 `await readText` 뒤에는 유효성을 다시 확인하지 않고 281행에서 편집 토큰을 발급한다.
- `gui/src/main/ipc.ts:294`: `saveText`가 토큰에서 꺼낸 `edit`와 작업 공간 경로를 지역 변수에 보관한다. 확인 대화상자·호스트 준비를 기다린 뒤에도 이 값을 그대로 써 308행에서 쓰기를 요청한다.
- `gui/src/main/ipc.ts:333`: 설정 쓰기가 성공하면 `dropTreeIds()`가 항목과 토큰을 모두 지운다. 하지만 이미 진행 중인 요청에는 폐기 세대나 취소 검사가 없다.
- `gui/src/main/text-edits.ts:59`: `replace`는 옛 토큰이 없으면 `null`을 주지만, 이 호출은 파일 쓰기가 끝난 뒤다.

**재현 A: 폐기된 토큰으로 파일을 바꾼 뒤 실패 응답**

1. `a.txt`를 열어 편집 토큰을 받는다.
2. `saveText(token, "saved-after-reset\n")`를 시작하고 메인의 첫 저장 확인 응답을 보류한다.
3. 실제 `applySettings` IPC 처리기를 실행한다. 호스트의 설정 쓰기 성공 응답은 외부 대역으로 주고, 실제 `dropTreeIds()`로 토큰을 폐기한다.
4. 메인 확인에 `true`를 돌려준다.
5. 결과: 실제 사본의 `a.txt`가 `saved-after-reset\n`으로 바뀐다(쓰기 1회). 창에 반환된 값은 `{ok:false, code:"unknown_entry"}`다. 실행 전 폐기된 토큰의 저장이 진행되고, 실제 저장과 실패 안내가 어긋난다.

첫 저장 동의를 우회한 재현은 아니다. 동의를 기다리는 동안 **폐기된 권한을 뒤에서 다시 사용**하는 문제다. 쓰기가 이미 시작된 뒤의 취소 문제와도 다르다. 이 재현에서는 폐기가 끝난 다음에 `writeText`가 처음 호출된다.

**재현 B: 폐기된 항목의 늦은 읽기가 새 토큰 발급**

1. `openText`의 앱 계층 읽기 결과를 만든 뒤 응답을 보류한다.
2. 같은 설정 쓰기 경로로 항목과 토큰을 폐기한다.
3. 읽기 응답을 재개한다.
4. 옛 항목 id의 `TreeIds.resolve` 결과는 `null`인데도 새 편집 토큰이 나온다. 그 토큰의 첫 저장을 확인하면 실제 파일이 `after-reset-token\n`으로 저장된다.

**재현 C: 설정 변경 전 가림 결과가 변경 뒤 전달됨**

1. 합성 텍스트 `private-synthetic-name`이 든 파일의 읽기 결과를 만든 뒤 보류한다.
2. 설정 쓰기 성공을 모의하면서 실제 개인정보 게이트를 이 합성 값을 등록한 새 게이트로 바꾸고 항목·토큰 폐기를 실행한다.
3. 보류한 읽기는 등록 전 원문과 `editable:true`를 창에 반환한다. 새 항목 id로 다시 읽은 결과는 같은 합성 값이 가려지고 `editable:false`다.

이는 변경 후의 새 가림 결과를 창에 보여 주려는 `treeReset` 경계에 오래된 결과가 다시 들어오는 사례다. 실제 개인정보나 API 키는 사용하지 않았다.

**범위와 기대 결과**

- 위 세 재현은 **같은 수명 관리 누락 1건**으로 센다.
- Electron IPC 등록과 OS 대화상자 응답, 호스트 설정 쓰기 성공 및 응답 시점은 대역이다. 메인 IPC 처리기, `TextEdits`, `TreeIds`, 엔진 호스트 처리기, 실제 개인정보 게이트, 앱 계층 `readWorkspaceTextIn`·`writeWorkspaceTextIn` 및 실험 파일의 읽기·쓰기는 후보 구현을 실행했다. 전체 설정 파일 저장이나 실제 Electron 프로세스 통신을 재현한 것은 아니다.
- 엔진 호스트도 요청을 병렬 처리하도록 구현되어 있다(`gui/src/engine-host/host.ts:535`, 549). 탐침은 그 비동기 간격을 결정적으로 만든다.
- 기대: 설정·창 수명의 세대값을 요청에 묶고, 비동기 대기 뒤 결과 전달·토큰 발급·쓰기 요청 전에 다시 확인한다. 폐기 후의 읽기는 버리고, 아직 시작하지 않은 쓰기는 거부해야 한다. 이미 시작된 쓰기는 별도로 추적하여 실제 파일 결과와 응답을 일치시켜야 한다.
- DR-73의 알려진 **파일시스템 정션 경합**과는 별개의 GUI 요청·토큰 수명 문제다.

재현: 실험 폴더에서 `node ./probe.mjs`. 결과는 `probe-results.json`의 `REPRO` 세 항목이다.

## 중간 M-2 — 이전 파일의 늦은 저장 응답이 현재 파일의 미저장 상태를 지움

**위치**

- `gui/src/renderer/text/text-screen.ts:93`: `dirty`는 화면 인스턴스가 공유한다.
- 264행의 `changed()`는 해당 읽기에서 만든 입력란·기준 글로 공유 `dirty`를 바꾼다.
- 276행에서 저장 응답을 기다린 뒤 현재 열린 파일/읽기 세대인지 확인하지 않는다. 282행에서 옛 기준 글을 바꾸고 299행에서 옛 `changed()`를 호출한다.
- 117행의 `leave()`는 공유 `dirty`가 거짓이면 확인 없이 나가게 한다.

**재현**

1. A 파일을 열고 글을 바꿔 저장을 시작한다. 저장 응답은 보류한다.
2. B 파일을 선택한다. A의 미저장 확인에서 `버리고 넘어가기`를 눌러 B로 간다. 저장 중에도 이 이동이 가능하다.
3. B에 `unsaved B`를 입력한다. 이때 `screen.dirty === true`, 메인으로 보낸 마지막 알림도 `textDirty(true)`다.
4. A의 저장 성공 응답을 재개한다.
5. **B의 입력란은 `unsaved B` 그대로인데 `screen.dirty === false`, 마지막 메인 알림은 `textDirty(false)`가 된다.** `leave("home")`도 `true`여서 버리기 확인을 하지 않는다.

현재 파일 B의 미저장 글을 놓치고 화면 이동/창 닫기 확인을 건너뛸 수 있다. 늦은 A의 콜백이 현재 파일 B의 상태를 갱신해서는 안 된다. 파일·읽기 세대별로 저장 결과를 적용하거나 저장 중 이동을 제어하고, 실제 저장 결과는 해당 파일 상태에만 반영해야 한다.

재현: `node ./renderer-probe.mjs`. 결과는 `renderer-results.json`. 후보의 실제 `textScreen`과 프로젝트의 가짜 DOM을 사용했다. API 응답 지연은 외부 대역이며 실제 Electron 화면·OS 닫기 동작·디스크 저장 재현으로 세지 않았다. `leave()`의 확인 생략과 메인에 보내는 잘못된 dirty 알림까지 실행으로 확인했다.

## 문제 없이 확인한 경계

| 항목 | 실행·정적 확인 결과 |
| --- | --- |
| 창의 입력 권한 | 열기는 작업 공간 핸들+항목 id, 저장은 **토큰+글**만 받는다. 경로·작업 공간·다이제스트·동의 여부를 저장 요청에 추가한 입력은 거부된다. |
| 출처 확인 | 메인 창과 같은 webContents id, mainFrame 객체, 앱 origin을 검사한다. 탐침의 다른 frame 객체는 `null`로 거부됐다. |
| 임의·다른 작업 공간·열지 않은 항목 | 추가 경로 필드, 다른 핸들에 원래 항목 id를 조합한 열기, 미발급 저장 토큰을 거부했다. |
| 첫 저장 확인 | 사용자 확인 대역이 취소하면 실제 쓰기 0회. 동의 후 같은 파일의 다음 토큰 저장은 재확인 없이 진행한다. `app.ts:344`에서 실제 대화상자의 기본·취소 id가 1이고 0 응답만 허용함을 읽었다. 실제 OS 상자는 실행하지 않았다. |
| 토큰 한 번 쓰기 | 저장 성공 후 옛 토큰은 제거되며 재사용은 `unknown_entry`. 진행 중 같은 토큰의 두 번째 저장은 `busy`. 폐기를 **완료한 뒤 새로 시작한** 저장은 쓰기 0회로 거부된다. 경합 예외는 M-1이다. |
| 토큰 보관 상한·만료 의미 | 유닛에서 32개 상한, 이전 토큰 제거, `clear`를 확인했다. 시간 기반 TTL은 구현되어 있지 않고 3.14에도 시간값은 없다. 파일 보기 닫기 자체의 폐기 통로도 없다. 현재의 만료는 성공 시 교체, 상한 초과, 설정 쓰기, 창 종료에 의존한다. 이를 시간 만료나 보기 종료 즉시 폐기로 주장하지 않는다. |
| 메시지 형태·크기 | 추가 키/잘못된 형식 6개를 거부. 짝 없는 UTF-16 대리 문자를 거부. 262,145 코드 단위는 확인 대화상자 전에 `too_large`. 90,000자 한글은 글자 수는 한도 이하지만 실제 UTF-8 바이트 한도를 넘으므로 앱 계층에서 거부. |
| 제어 문자 | 기존 U+202E 파일은 `?`로 보이며 읽기 전용. 저장 글의 U+202E는 앱 계층이 `text_refused/control_characters`로 거부하고 파일은 보존했다. LF/TAB 등 전체 문자 조합에 대한 전수 검사는 아니다. |
| 가림 | 실제 개인정보 게이트의 합성 등록 값을 가린 뒤 창에 주며 읽기 전용·토큰 없음. 호스트의 추가 가림·메인 응답 검증은 관련 유닛으로도 확인했다. 설정 변경과 겹친 오래된 결과는 M-1이다. |
| 저장 때 다시 판정 | 열 때 편집 가능했더라도 보호 경로, 지정 설정 파일, 새 등록 값, 하드링크, 읽기 전용 속성, 바뀐 파일 해시, 작업 공간 잠금에 따라 저장이 거부됐다. 실제 파일 바이트 불변도 확인했다. 설정 실효값의 준비 자체는 탐침에서 제공했고 전체 설정 해석기를 실행한 검증은 아니다. |
| 열지 않음·읽기 전용 | 혼합 줄 끝, 제어 문자, 가림은 읽기 전용. 256 KiB 초과·NUL 포함 파일은 본문 없이 거부됐다. |
| BOM·줄 끝 | 실제 BOM+CRLF 파일을 열고 LF 입력으로 저장했을 때 BOM+CRLF 바이트가 유지됐다. |

## 실행 수치와 한계

| 검사 | 결과 |
| --- | --- |
| 후보 루트 `npm.cmd run build` | 종료 0 |
| 후보 GUI `npm.cmd run build` | **종료 1**. Electron 모듈/타입 부재와 그에 따른 타입 오류. 전체 GUI 빌드 통과 아님. |
| GUI 유닛 코드 `tsc -p tsconfig.test.json --pretty false` | 종료 0. Electron 없는 유닛 컴파일 가능. 다른 유닛 파일도 컴파일 대상이지만 실행은 아래 두 파일만. |
| `u174-text-view.test.js`, `u184-text-edit.test.js` | **총 28, 통과 28, 실패 0, 건너뜀 0, todo 0**, 최종 러너 시간 280.7697ms |
| `probe.mjs` | 종료 0, **19개 시나리오**: 기대대로 차단/동작한 16개와 M-1 재현 3개. 종료 0은 재현 관찰용 assertion의 일치이며 제품 무결함을 뜻하지 않음. |
| `renderer-probe.mjs` | 종료 0, M-2 재현 1개 |
| 실제 Electron 연기 시험·OS 확인 상자 | **미실행** |
| 실제 API·외부 네트워크·키/키 파일 조회 | **0회** |

전체 GUI 빌드 실패로 나온 JS 중 메인 IPC 모듈을 탐침에서 불러왔다. `electron` import만 등록기·대화상자 경계 대역으로 치환했다. 메인 전체 타입 검사 성공이나 Electron 런타임 검증으로 간주하지 않는다. 앱 계층 공개 façade의 환경·설정 읽기 대신 합성 source를 제공해 내부 읽기/쓰기 경계를 검증했다. 실제 키 환경이나 전역 설정을 읽는 기본 앱 환경 생성기는 호출하지 않았다.

실제 브라우저 렌더링, IME, 접근성 수동 점검, OS 대화상자의 동작, 전체 GUI·CLI 회귀, 타 OS, 실제 8.3 별칭, DR-73의 반복 정션 바꿔치기는 이번에 실행하지 않았다. 일반 경계의 유한 입력 검증을 모든 입력의 안전성 증명으로 확대하지 않는다.

## 명령과 보존 산출물

관리 저장소에서:

```powershell
git -C D:/project/Codaryn status --short
git -C D:/project/Codaryn branch --show-current
git -C D:/project/Codaryn rev-parse --show-toplevel
git -C D:/project/Codaryn rev-parse 21107dc 96b29fd
git -C D:/project/Codaryn diff 21107dc...96b29fd -- gui
git -C D:/project/Codaryn diff 21107dc 96b29fd -- gui
git -C D:/project/Codaryn archive --format=zip --output="$auditRoot/candidate.zip" 96b29fd
Expand-Archive -LiteralPath "$auditRoot/candidate.zip" -DestinationPath "$auditRoot/candidate"
Copy-Item -LiteralPath D:/project/Codaryn/node_modules -Destination "$auditRoot/candidate/node_modules" -Recurse
```

`$auditRoot`는 이 보고서가 있는 실험 폴더다. 로컬에 설치된 루트 개발 의존성만 사본으로 복사했으며 설치나 내려받기는 하지 않았다. npm 캐시는 `$auditRoot/npm-cache`, TEMP/TMP는 `$auditRoot/tmp`로 한정했다.

후보 사본 루트에서:

```powershell
npm.cmd run build
```

후보 `gui/`에서:

```powershell
npm.cmd run build
node ../node_modules/typescript/bin/tsc -p tsconfig.test.json --pretty false
node --test build/tests/unit/u174-text-view.test.js build/tests/unit/u184-text-edit.test.js
```

실험 폴더에서:

```powershell
node ./probe.mjs
node ./renderer-probe.mjs
```

- `root-build.log`, `gui-build.log`, `gui-unit-compile.log`, `gui-related.tap`에 빌드·관련 시험 결과를 보존했다.
- `probe.mjs`, `probe-results.json`, `probe.log`, `renderer-probe.mjs`, `renderer-results.json`, `renderer-probe.log`와 합성 `fixtures/`를 보존했다. probe는 네트워크 함수를 차단하고 실행한다. 실패 주입·대역과 실제 파일 결과를 구분했다.
- 탐침 준비 때 `treeReset` 이벤트 이름을 잘못 예상한 assertion 1회가 실패했다. 탐침의 이름을 고친 뒤 최종 19개 시나리오를 실행했다. 제품 결함 건수에 추가하지 않았다. 기존 fixture는 지우지 않고 재실행마다 새 하위 폴더를 썼다.
- 파일 glob에 관한 `rg` 조회 오류와 archive cwd에서의 Git 조회 실패가 있었다. 절대 경로/관리 저장소 cwd로 다시 읽었다. 최종 Git 조회 중 소유권 오류는 `git -c safe.directory=D:/project/Codaryn -C D:/project/Codaryn ...`의 **한 명령 옵션**으로 확인했다. 저장소/전역 Git 설정은 수정하지 않았다.
- 시작·종료 관리 저장소 `git status --short`의 변경 출력은 0개였다. 전역 ignore 읽기 권한 경고는 있었고 권한 요청은 하지 않았다.
- 제품·저장소 추적 파일 수정 0, 커밋 0, 푸시 0, worktree 추가 0. 실험 폴더 밖에 산출물을 쓰거나 다른 검증 폴더를 수정하지 않았다.

## PM에게 필요한 판단

M-1의 비동기 요청 폐기와 M-2의 파일별 저장 응답 적용을 수정한 뒤, 위 재현을 실패→통과로 확인하고 관련 유닛을 다시 실행할 필요가 있다. Electron이 있는 검증 환경에서는 실제 설정 변경·저장 확인·파일 이동의 순서를 포함해 연기 시험으로 보완해야 한다.
