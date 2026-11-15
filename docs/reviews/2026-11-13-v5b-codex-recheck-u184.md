# V-5b 재확인 — U-184, bbeb2ce

- 검증자: **codex-audit**, 검증 엔지니어(주), 보안·개인정보 검토자(보조).
- 브랜치: `unit/U-184-p5u-gui`.
- 기준: `96b29fd42ab5087c7b6b182857595f48ecef9780`.
- 후보: **`bbeb2ce9b21ff59e4096da49d52552c08bda8011`**.
- 관리 저장소: `D:/project/Codaryn`, `main`, 읽기 전용.
- 실험 폴더: `D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-audit-v5b-bbeb2ce`. `candidate/`는 지정 커밋의 `git archive` 사본이며 별도 브랜치/worktree가 아니다.
- 환경: Windows, Node v26.13.1. Electron 모듈·타입·런타임 없음.
- 앞선 `3b14a2e` 검증은 **잘못된 해시**였으며, 이 보고서가 올바른 수정 판의 V-5b 결과를 대체한다.

**높음 0건 / 중간 1건 / 낮음 0건. 기존 V-5의 중간 두 항목과 네 재현은 해소됐으나, 보기 번호 검사와 늦은 읽기 응답이 결합한 새 중간 회귀 M-3을 발견했다. 수정 후 재확인이 필요하다.**

## 기존 네 재현: 4/4 해소

| 재현 | 후보에서 관찰한 결과 |
| --- | --- |
| M-1 A: 저장 확인을 기다리는 동안 설정 쓰기로 토큰 폐기 | `unknown_entry`. 호스트 쓰기 요청 **0회**, 실제 파일 `old\n` 유지. |
| M-1 B: 읽기 결과를 기다리는 동안 항목·토큰 폐기 | `unknown_entry`만 반환. 글·편집 토큰 없음, 쓰기 0회. |
| M-1 C: 읽기 결과 보류 중 합성 값을 가림 대상으로 등록하고 폐기 | 오래된 결과는 `unknown_entry`로 거부. 새 id로 다시 읽으면 합성 값이 가려지고 편집 불가. |
| M-2: A 저장 응답 보류 → B 열기·수정 → A 응답 도착 | B의 `unsaved B` 유지, `dirty:true`, 마지막 메인 알림 `textDirty(true)`, `leave("home") === false`로 확인 유지. |

실행: `node ./probe.mjs`의 `FIXED A/B/C`, `node ./renderer-probe.mjs`. 기존 V-5의 같은 재현 순서를 사용하고 판정 assertion을 요구 결과로 바꾸었다. 제품 코드는 수정하지 않았다.

## 중간 M-3 — 역순으로 도착한 읽기 결과로 연 입력란의 저장 완료 응답을 버림

**위치**

- `gui/src/renderer/text/text-screen.ts:199`: 읽기를 시작할 때마다 `current`를 올리고 `mine`에 저장한다.
- **204행**: `await api.openText(...)` 뒤에 `mine === current`인지 검사하지 않는다. 옛 읽기 응답도 현재 보기의 본문·입력란·저장 콜백을 만든다.
- **288행**: 그 입력란에서 저장한 뒤에는 `mine !== current`이면 곧바로 반환한다. 289행의 `saving = false`, 완료 표시, dirty 갱신, 다음 토큰 수신에 도달하지 않는다.

**재현 순서**

1. 내용이 `base\n`인 같은 파일을 연다. 첫 `openText` 응답을 창에 전달하기 전에 보류한다.
2. 읽기가 끝나기 전에 활성화된 `다시 읽기` 단추를 누른다. 두 번째 읽기도 완료 결과를 보류한다.
3. 두 번째 응답부터 전달해 본문을 그린 뒤, 첫 번째 응답을 뒤늦게 전달한다. 두 응답은 같은 파일·같은 글이며 메인이 각각 실제로 발급한 유효 토큰을 가진다. 설정 변경이나 외부 파일 변경은 없다.
4. 현재 보이는 입력란을 `committed\n`으로 고치고 저장한다.
5. 실제 메인 IPC·엔진 호스트·앱 계층을 통해 저장이 성공한다. 파일은 `committed\n`, 저장 응답은 `saved:true`와 새 토큰이다.
6. 그러나 늦은 첫 읽기로 만들어진 입력란의 `mine`은 최신 `current`와 다르다. **창은 `Saving.`에 머물고 읽기 전용, `dirty:true`, 마지막 메인 알림도 `textDirty(true)`로 남는다.**

파일이 저장되었는데 완료 안내와 새 토큰을 받지 못한다. 계속 편집할 수 없고, 다시 열거나 떠날 때 이미 저장한 글을 미저장 상태로 취급한다.

**대조 실험**

| 렌더러와 응답 순서 | 실제 파일·저장 응답 | dirty | 읽기 전용 | 결과 표시 |
| --- | --- | --- | --- | --- |
| 후보, 첫 읽기 → 두 번째 읽기 | `committed\n`, `saved:true` | false | false | `Saved.` |
| **후보, 두 번째 읽기 → 첫 읽기** | `committed\n`, `saved:true` | **true** | **true** | **`Saving.`** |
| 이전 `96b29fd` 렌더러, 두 번째 읽기 → 첫 읽기 | `committed\n`, `saved:true` | false | false | `Saved.` |

대조는 렌더러만 바꾸고 메인·호스트·앱 계층은 같은 후보 구현을 사용했다. 이전 판 전체의 검증이라고 주장하지 않는다. 이전 렌더러에도 늦은 읽기 결과를 버리지 않는 부분은 있지만, **이번에 추가한 저장 응답의 보기 번호 검사 때문에 현재 보이는 입력란의 저장 완료를 버리는 현상은 새 회귀**다.

**재현·범위**

- 실험 폴더에서 `node ./probe.mjs`.
- `probe-results.json`의 `case: "read delivery order and save reporting"` 세 항목. `candidate-reversed`가 결함, 나머지가 대조다.
- 실제 `textScreen`과 프로젝트 가짜 DOM을 사용한다. API 응답을 창에 전달하는 순서와 메인 확인 대화상자 응답은 대역이다. 파일 읽기·토큰 발급·저장 및 최종 파일 바이트는 후보 구현을 실행했다.
- 같은 파일·같은 글을 쓰므로 외부 변경에 따른 해시 충돌과 구분된다. 실제 Electron 화면의 마우스 조작을 실행한 것은 아니다.

**권고**

204행의 읽기 응답 직후에도 보기 번호를 검사하여 오래된 응답이 본문·입력란·콜백을 설치하지 못하게 해야 한다. 성공뿐 아니라 오류·열지 못함 응답에도 같은 처리가 필요하다. 현재 보기의 저장 응답은 처리하되, 떠난 보기의 저장 응답은 기존 M-2 수정처럼 차단해야 한다. 위 역순 읽기→실제 저장 재현을 회귀 시험으로 추가할 필요가 있다.

## 추가로 확인한 수정 경계

| 항목 | 결과 |
| --- | --- |
| 마지막 호스트 준비 대기 중 폐기 | 새 토큰/이미 동의한 토큰 × 설정 폐기/창 종료와 같은 핸들 폐기 **4조합** 모두 `unknown_entry`, 쓰기 요청 0회, 파일 불변. |
| 요청을 보낸 쓰기의 결과 | 실제 쓰기 직전/파일 쓰기 완료 뒤의 응답 보류 × 설정 폐기/핸들 폐기 **4조합**에서 실제 파일 저장을 완료 결과로 보고하고 `editToken:null`. 옛 토큰은 부활하지 않음. |
| 이미 보낸 쓰기의 읽기 전용 재판정 | 호스트 요청 뒤 실제 쓰기 전에 보호 경로 조건을 바꾸고 토큰 폐기. 실제 앱 계층이 `not_editable/protected`로 거부, 파일 불변. |
| 완료 상태와 잠금 정보 | 토큰 폐기와 겹친 `unchanged`, 파일 해시 `conflict`, 잠금 반환 실패 `lockLeft:true` **3사례**의 결과를 그대로 유지. 잠금 반환 실패는 앱 계층의 외부 `releaseLock` 경계를 실패로 주입. |
| 다음 토큰 없는 성공의 화면 | 추가 유닛에서 저장 완료 안내·다시 열기 안내, 읽기 전용 전환, `dirty:false` 확인. |
| 일반 경계 회귀 | V-5의 추가 키·잘못된 형식 6개, 발급하지 않은 토큰, 다른 작업 공간 항목, 다른 frame, 첫 저장 취소, 크기, 제어 문자, 가림, 보호·설정 파일·하드링크·읽기 전용·잠금·해시, BOM/CRLF 등을 기존 탐침으로 다시 확인. |

쓰기 직전 검사에 대해서는 `main/text-files.ts:82`의 토큰·작업 공간 확인부터 `host.call("writeText", ...)`까지 `await`가 없음을 읽었다. 실제 `main/engine-client.ts:179`의 `call`도 메시지를 구성하고 191행에서 `child.stdin.write`를 호출할 때까지 대기하지 않는다. 따라서 메인 이벤트 처리의 비동기 중간 지점은 마지막 호스트 준비 대기까지이며 위 4조합으로 확인했다. 호스트에 보낸 뒤의 파일시스템·설정 변화는 이미 보낸 요청의 결과와 앱 계층 재판정으로 다루었다. 프로세스 밖의 모든 경합을 없앴다는 주장은 아니다.

## 실행 수치

| 검사 | 결과 |
| --- | --- |
| 루트 `npm.cmd run build` | 종료 0 |
| GUI `npm.cmd run build` | **종료 1**, Electron 모듈·타입 부재. 전체 GUI 빌드 통과 아님. |
| GUI 유닛 `tsc -p tsconfig.test.json --pretty false` | 종료 0 |
| 관련 GUI 유닛 3파일 | **34건 중 34 통과, 실패 0, 건너뜀 0, todo 0**, 러너 시간 274.2751ms |
| `probe.mjs` | 종료 0, **34시나리오**: 기대 동작 확인 32개, 후보 M-3 결함 관찰 1개, 이전 렌더러 대조 1개 |
| `renderer-probe.mjs` | 종료 0, 기존 M-2의 요구 결과 확인 1개 |
| 기존 네 재현 제거 | **4/4** |

탐침의 종료 0은 각각의 기대 결과 또는 결함 관찰 assertion이 일치했다는 뜻이다. M-3까지 제품 통과로 센 것이 아니다. 관련 유닛 통과와 별도로 M-3이 재현된다.

## 명령·산출물

관리 저장소에서 시작 상태·브랜치·루트를 확인하고 다음을 실행했다. Git은 명령별 `safe.directory` 옵션만 사용했으며 전역·저장소 설정을 바꾸지 않았다.

```powershell
git -c safe.directory=D:/project/Codaryn -C D:/project/Codaryn diff 96b29fd bbeb2ce -- gui
git -c safe.directory=D:/project/Codaryn -C D:/project/Codaryn archive --format=zip --output="$auditRoot/candidate.zip" bbeb2ce
Expand-Archive -LiteralPath "$auditRoot/candidate.zip" -DestinationPath "$auditRoot/candidate"
Copy-Item -LiteralPath D:/project/Codaryn/node_modules -Destination "$auditRoot/candidate/node_modules" -Recurse
```

`$auditRoot`는 이 보고서가 있는 새 실험 폴더다. TEMP/TMP는 `tmp/`, npm 캐시는 `npm-cache/`로 지정했다. 기존 루트 개발 의존성만 복사했으며 설치·내려받기는 하지 않았다.

후보 루트:

```powershell
npm.cmd run build
```

후보 `gui/`:

```powershell
npm.cmd run build
node ../node_modules/typescript/bin/tsc -p tsconfig.test.json --pretty false
node --test build/tests/unit/u174-text-view.test.js build/tests/unit/u184-text-edit.test.js build/tests/unit/u184-v5-lifetimes.test.js
```

실험 폴더:

```powershell
node ./probe.mjs
node ./renderer-probe.mjs
```

- 보존: `gui.diff`, `root-build.log`, `gui-build.log`, `gui-unit-compile.log`, `gui-related.tap`, `probe.mjs`·`probe-results.json`·`probe.log`, `renderer-probe.mjs`·`renderer-results.json`·`renderer-probe.log`, 사본 및 합성 `fixtures/`.
- V-5의 탐침은 읽어 새 폴더로 복사했다. 이전 렌더러 대조는 기존 `codex-audit-v5-96b29fd/candidate/gui/build/src/renderer/text/text-screen.js`를 읽기 전용으로 불러왔다. 이전 사본·다른 검증 폴더는 수정하지 않았다.
- 추가 경계 시나리오를 작성하며 탐침을 확장해 재실행했다. 최종 수치는 마지막 JSON의 34개 시나리오다. 매 실행의 실제 파일은 새 하위 폴더에 만들었고 기존 fixture를 삭제하지 않았다.

## 한계·경계 준수

- 실제 Electron 연기 시험, OS 확인 상자, 실제 브라우저/IME/접근성, 전체 CLI·GUI 회귀, 다른 OS는 **미실행**.
- 메인 IPC 탐침은 Electron이 없어 실패한 GUI 전체 빌드가 내보낸 JS를 사용하고 Electron 경계만 대역으로 치환했다. 관련 유닛의 별도 컴파일은 성공했으나 메인 전체 타입 검사·Electron 실행 성공으로 간주하지 않는다.
- 실제 메인·호스트·개인정보 게이트·앱 계층 읽기/쓰기 함수를 사용했지만, 설정 쓰기 성공과 앱 환경/설정 source 준비는 대역이다. 전역 설정·키를 읽는 기본 앱 환경 생성기는 호출하지 않았다.
- 실제 API 0, 외부 네트워크 0, 키·키 파일 조회 0, 권한 요청 0. 탐침은 네트워크 함수를 차단한다.
- DR-73의 알려진 정션 바꿔치기를 재실험하지 않았다. 새 M-3은 그것과 무관한 렌더러 응답 수명 회귀다.
- 저장소 제품·추적 파일 수정 0, 커밋 0, 푸시 0, worktree 추가 0. 시작 관리 저장소 변경 출력은 0개. 전역 ignore 읽기 권한 경고는 있었고 설정 변경·권한 요청은 하지 않았다.

## PM 판단 요청

기존 V-5 M-1·M-2는 검증한 네 재현 범위에서 닫을 수 있다. 새 M-3을 수정하고 역순 읽기 뒤 저장 결과가 정상 반영되는지 확인한 뒤 채택해야 한다. Electron이 있는 환경의 실제 화면 검증은 별도로 남는다.
