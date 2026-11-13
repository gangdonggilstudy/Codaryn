# V-5c 재확인 — U-184

- 검증자: **codex-audit**, 검증 엔지니어(주), 보안·개인정보 검토자(보조).
- 브랜치: `unit/U-184-p5u-gui`.
- 기준: `bbeb2ce9b21ff59e4096da49d52552c08bda8011`.
- 후보: **`25ad0858b571bd5d710dd0973e91517fe9652676`**.
- 관리 저장소: `D:/project/Codaryn`, `main`, 읽기 전용.
- 실험 폴더: `D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-audit-v5c-25ad0858`. `candidate/`는 후보의 `git archive` 사본이다. 새 worktree·브랜치를 만들지 않았다.
- 환경: Windows, Node v26.13.1. Electron 모듈·타입·런타임 없음.

**높음 0건 / 중간 0건 / 낮음 0건. M-3 재현이 해소되었고 앞선 네 재현도 계속 차단된다. 추가로 확인한 응답 순서·수명 경계에서 새 결함을 발견하지 못했다. 이번 오프라인 검증 범위에서는 M-3을 닫을 수 있다.**

## 수정 확인

요청한 `git log bbeb2ce..25ad0858b571bd5d710dd0973e91517fe9652676 -- gui`에서 GUI 고침은 다음 한 커밋이다.

```text
25ad085 gui: a read reply that comes back after a newer read is dropped (U-184, Codex V-5b M-3)
```

GUI 끝점 차이는 2개 파일, +75/-1이다.

- `gui/src/renderer/text/text-screen.ts`: `openText` 응답 직후 보기 번호를 검사한다. 저장 응답의 지역 `saving` 해제는 오래된 보기인지 확인하기 앞으로 옮겼다.
- `gui/tests/unit/u184-v5b-read-order.test.ts`: 역순 읽기 뒤 최신 토큰으로 저장하고 완료 표시·dirty·편집 가능 상태가 정상인지 확인하는 회귀 시험을 추가했다.

## M-3: 고치기 전 실패·고친 뒤 성공 대조

재현 절차는 V-5b와 같다.

1. 같은 파일 `base\n`을 읽고 창으로 보낼 응답을 보류한다.
2. 첫 읽기가 끝나기 전에 `다시 읽기`를 눌러 두 번째 응답도 준비한다.
3. 두 번째 응답을 먼저, 첫 번째 응답을 뒤에 전달한다.
4. 보이는 입력란을 `committed\n`으로 바꾸고 저장한다.

| 렌더러·응답 순서 | 실제 파일·메인 저장 결과 | dirty | 읽기 전용 | 화면 결과 |
| --- | --- | --- | --- | --- |
| 후보 `25ad0858`, 정순 | `committed\n`, `saved:true` | false | false | `Saved.` |
| **후보 `25ad0858`, 역순** | `committed\n`, `saved:true` | **false** | **false** | **`Saved.`** |
| 이전 `bbeb2ce` 렌더러, 역순 | `committed\n`, `saved:true` | true | true | `Saving.` |

후보의 역순 경우에도 메인에 마지막으로 알린 값은 `textDirty(false)`다. 저장 단추가 비활성인 것은 미저장 고침이 없기 때문이며 입력란은 다시 편집 가능하다.

대조에서는 **렌더러만 이전 `bbeb2ce` 것으로 바꾸고 메인·엔진 호스트·앱 계층은 후보 구현을 동일하게 사용**했다. 이전 전체 판의 검증이라고 주장하지 않는다. 실제 사본 파일의 바이트와 메인 저장 응답을 확인했으며, 실제 Electron 브라우저 화면에서 클릭한 시험은 아니다.

재현 명령: 실험 폴더에서 `node ./probe.mjs`. 원문: `probe-results.json`의 `read delivery order and save reporting` 세 항목.

## 앞선 네 재현: 계속 해소됨

| 재현 | 후보의 결과 |
| --- | --- |
| M-1 A: 첫 저장 확인 대기 중 토큰 폐기 | `unknown_entry`, 호스트 쓰기 요청 **0회**, 파일 `old\n` 유지. |
| M-1 B: 읽기 결과 대기 중 항목·토큰 폐기 | `unknown_entry`만 반환. 글·편집 토큰 없음, 쓰기 0회. |
| M-1 C: 보류한 읽기 뒤 합성 값 등록·폐기 | 옛 결과는 `unknown_entry`로 거부. 새 항목으로 읽은 글은 가려지고 편집 불가. |
| M-2: A 저장 응답이 B 수정 뒤 도착 | B의 `unsaved B`, `dirty:true`, 마지막 알림 `textDirty(true)` 유지. `leave("home") === false`. |

실행: `probe.mjs`의 `FIXED A/B/C`, `renderer-probe.mjs`. 결과 원문은 `probe-results.json`, `renderer-results.json`이다.

## 이번 고침의 추가 경계 확인

`read-matrix.mjs`에서 **36조합 전부 통과**했다.

- 전환 두 종류: 같은 파일 다시 읽기 / 다른 파일 열기.
- 오래된 결과 세 종류 × 최신 결과 세 종류: 열기 성공 / 너무 커서 열지 못함 / 오류.
- 응답 순서 두 종류: 옛 응답 먼저 / 최신 응답 먼저.
- 최신 읽기가 아직 기다리는 동안 옛 응답이 도착하면 로딩 상태를 유지하며 옛 입력란을 설치하지 않는다.
- 최신 결과가 성공이면, 그 결과를 받은 뒤 입력한 `unsaved current\n`이 오래된 성공·실패 응답에 덮이지 않는다. dirty와 메인 알림도 유지된다.
- 최신 결과가 실패 또는 열지 못함이면 오래된 성공 결과로 바뀌지 않는다. 본문·저장 호출이 없다.
- 실행 상태 알림이 최신 입력란의 읽기 전용 여부를 계속 제어한다. 오래된 보기의 콜백이 최신 알림을 가로채지 않는다.
- 성공 조합 12개에서는 최신 읽기의 토큰으로 첫 저장하고, 반환받은 새 토큰으로 두 번째 저장까지 확인했다. 두 번 모두 완료 표시와 dirty 해제가 정상이다.

이 시험은 실제 렌더러 코드와 프로젝트 가짜 DOM을 사용하며 API 결과는 대역이다. 파일 저장까지 연결한 M-3 재현은 앞 절의 `probe.mjs`에서 별도로 실행했다.

**메인·앱 경계도 이전 탐침으로 재확인했다.**

- 마지막 호스트 준비 대기 중 폐기: 새 토큰/이미 동의한 토큰 × 설정 폐기/핸들 폐기 4조합에서 쓰기 요청 0회.
- 이미 요청한 쓰기: 실제 쓰기 전/완료 후 응답 보류 × 설정 폐기/핸들 폐기 4조합에서 저장 결과 유지, 다음 토큰 없음.
- 요청 뒤 보호 조건이 바뀐 파일은 실제 앱 계층이 `not_editable/protected`로 거부.
- 토큰 폐기 중 `unchanged`, 해시 `conflict`, 잠금 반환 실패의 `lockLeft:true` 정보를 유지. 잠금 반환 실패만 앱 계층 외부 `releaseLock` 경계에 실패를 주입했다.
- 기존 메시지 검증·첫 확인 취소·토큰 교체·작업 공간 경계·크기·가림·제어 문자·읽기 전용 조건·잠금·BOM/CRLF 검사를 다시 실행했다.

## 실행 수치

| 실행 | 결과 |
| --- | --- |
| 루트 `npm.cmd run build` | 종료 0 |
| GUI `npm.cmd run build` | **종료 1**. Electron 모듈·타입 부재와 그에 따른 타입 오류. 전체 GUI 빌드 통과 아님. |
| GUI 유닛 `tsc -p tsconfig.test.json --pretty false` | 종료 0 |
| 관련 GUI 유닛 4파일 | **35건 중 35 통과, 실패 0, 건너뜀 0, todo 0**, 러너 시간 255.6529ms |
| `probe.mjs` | 종료 0, **34시나리오**: 후보 기대 결과 33개, 이전 `bbeb2ce` 렌더러의 M-3 재현 대조 1개 |
| `renderer-probe.mjs` | 종료 0, 기존 M-2 요구 결과 확인 1개 |
| `read-matrix.mjs` | 종료 0, **36/36** 조합 통과 |
| 기존 요청 재현 | M-3 해소 1/1, 앞선 네 재현 해소 유지 4/4 |

탐침의 종료 0에는 **이전 렌더러에서 결함이 재현됨을 확인한 assertion**도 포함된다. 이전 판이 통과했다는 뜻이 아니다. 위 수치는 서로 다른 검증 층이므로 한 개의 제품 테스트 합계로 합치지 않았다.

## 실행 명령과 보존 산출물

관리 저장소에서 상태·브랜치·루트를 먼저 확인했다. Git 명령의 `safe.directory`는 명령별 옵션이며 전역·저장소 설정을 수정하지 않았다.

```powershell
git -c safe.directory=D:/project/Codaryn -C D:/project/Codaryn log --oneline bbeb2ce..25ad0858b571bd5d710dd0973e91517fe9652676 -- gui
git -c safe.directory=D:/project/Codaryn -C D:/project/Codaryn diff bbeb2ce 25ad0858 -- gui
git -c safe.directory=D:/project/Codaryn -C D:/project/Codaryn archive --format=zip --output="$auditRoot/candidate.zip" 25ad0858b571bd5d710dd0973e91517fe9652676
Expand-Archive -LiteralPath "$auditRoot/candidate.zip" -DestinationPath "$auditRoot/candidate"
Copy-Item -LiteralPath D:/project/Codaryn/node_modules -Destination "$auditRoot/candidate/node_modules" -Recurse
```

`$auditRoot`는 이 보고서가 있는 새 실험 폴더다. TEMP/TMP는 `tmp/`, npm 캐시는 `npm-cache/`로 지정했다. 기존 루트 개발 의존성만 복사했고 설치·내려받기는 하지 않았다.

후보 루트에서 `npm.cmd run build`, 후보 `gui/`에서 다음을 실행했다.

```powershell
npm.cmd run build
node ../node_modules/typescript/bin/tsc -p tsconfig.test.json --pretty false
node --test build/tests/unit/u174-text-view.test.js build/tests/unit/u184-text-edit.test.js build/tests/unit/u184-v5-lifetimes.test.js build/tests/unit/u184-v5b-read-order.test.js
```

실험 폴더에서:

```powershell
node ./probe.mjs
node ./renderer-probe.mjs
node ./read-matrix.mjs
```

보존한 파일:

- 판과 빌드: `candidate.zip`, `candidate/`, `gui.diff`, `root-build.log`, `gui-build.log`, `gui-unit-compile.log`, `gui-related.tap`.
- 탐침: 위 세 `.mjs`, `probe-results.json`, `renderer-results.json`, `read-matrix-results.json`, 각 `.log`, 합성 `fixtures/`.
- 이전 렌더러는 기존 `codex-audit-v5b-bbeb2ce/candidate/gui/build/src/renderer/text/text-screen.js`를 읽기 전용으로 불러왔다. 이전 사본·다른 검증 폴더에는 쓰지 않았다.

## 한계와 경계 준수

- 실제 Electron 연기 시험, OS 확인 상자·창 닫기, 실제 브라우저·IME·접근성, 전체 CLI/GUI 회귀, 다른 OS는 **미실행**이다.
- Electron이 없어 실패한 GUI 전체 빌드에서 나온 메인 IPC JS를 탐침에 사용했다. Electron import 경계는 등록기·대화상자 대역으로 치환했다. 유닛의 별도 컴파일은 성공했지만 메인 전체 타입 검사·Electron 실행 성공으로 기록하지 않는다.
- 메인·호스트·개인정보 게이트·앱 계층 읽기/쓰기와 실제 실험 파일을 사용했다. 설정 쓰기 성공·앱 환경과 설정 source 준비·응답 전달 지연은 대역이다. 기본 앱 환경 생성기나 실제 키 설정을 읽지 않았다.
- 실제 API 0, 외부 네트워크 0, 키·키 파일 조회 0, 권한 요청 0. 실험 파일은 새 실험 폴더 아래에만 만들었다. `probe.mjs`는 네트워크 함수를 차단한다.
- DR-73의 알려진 정션 바꿔치기는 재실험하지 않았다. 이번 결과를 모든 파일시스템 경합이나 모든 입력의 안전성 보장으로 확대하지 않는다.
- 저장소 제품·추적 파일 수정 0, 커밋 0, 푸시 0, worktree 추가 0. 시작·종료 관리 저장소의 `git status --short` 변경 출력 0개. 전역 ignore 읽기 권한 경고는 있었고 권한 요청·설정 변경은 하지 않았다.

## PM에게 필요한 판단

이번에 요청된 오프라인 재검증 범위에서는 미해결 결함이 없다. V-5 M-1·M-2와 V-5b M-3의 검증한 재현을 닫고 채택 판단의 근거로 사용할 수 있다. 실제 Electron 환경의 연기 시험과 전체 회귀는 이 보고서가 대신하지 않는다.
