# V-13b 재확인 — 읽기 제외 경로

- 검증자: codex-review, 보안·개인정보 검토자. worktree: `D:/project/Codaryn/.worktrees/codex-verify`(detached HEAD).
- 기준: `79e1a3f1676d04e2d40280676dd790d785710752`. 후보: `pm/unit-A3`, `8f221179d6bfee1c96ac5a9125c8ad8f77b7b263`.
- **높음 0 / 중간 0 / 낮음 1. V-13 M-1·M-2의 기존 재현은 차단됐다.** 새 회귀는 빈 목록 `[]`에서 일부 링크 이름이 사라지는 것이다.
- 환경: Windows, Node `v26.13.1`. 기준·후보 archive, 스크립트, 결과는 보고서 옆 `codex-review-v13b-8f22117`에 있다. 실제 Workspace·정책 관문·도구·가림 구현을 연결했다. 오류·큰 나열 목록만 명시적으로 파일시스템 경계에서 모의했다.

## L-1 낮음 — 제외 목록이 비어도 검색에서 일부 링크 이름을 숨김

- 위치: 후보 `src/tools/index.ts:293`, `:305`; `src/tools/visible-list.ts:37`, `:62`.
- 재현: 실험 폴더에서 `node ./probe.mjs`. 결과 `results.json/parity` 중 `option=empty`, `equal=false` 두 행.
  1. 같은 실제 작업공간에 내부 일반 폴더로 향하는 정션 2개, 끊어진 정션 `dangling-alias`, 작업공간 밖으로 향하는 정션 `outside-alias`를 만든다. 밖의 대상도 새 실험 폴더 내부에만 만든다.
  2. 기준·후보 각각의 createToolRunner에 `unreadablePaths: []`를 전달한다.
  3. `search_files({path:'.',nameContains:'alias'})`와 `search_files({path:'.'})`를 비교한다.

| 옵션 | 기준 판의 별칭 이름 검색 | 후보 판 | 결과 |
| --- | --- | --- | --- |
| unreadablePaths 생략 | 내부 2개 + dangling-alias + outside-alias | 같은 4개 | 동일 |
| unreadablePaths=[] | 같은 4개 | 내부 2개만 | 두 이름 누락 |

- 별칭 이름 검색의 전체 반환 JSON은 기준 **210바이트**, 후보 **131바이트**다. 후보에서도 `withheld`는 없고 `truncated=false`라서 누락 표시가 없다. 전체 이름 검색에서도 같은 두 항목이 빠진다.
- 빈 배열은 제외 항목이 0개인데, `undefined`만 기존 workspace.list 경로를 사용한다. `[]`는 빈 snapshot을 만든 뒤 새 listVisible로 들어가며, 이 경로는 해석할 수 없거나 작업공간 밖으로 향하는 링크를 무조건 숨긴다.
- **영향은 기존 이름 검색 결과의 누락이며, 보호 자료 내용 노출은 재현되지 않았다.** 따라서 낮음 1건으로 셌다. 유효한 빈 목록도 목록 생략과 같은 기존 나열 경로를 사용하도록 구분할 필요가 있다. 쓸 수 없는 목록의 보수적 거부는 유지해야 한다.

## V-13 M-1 재확인 — 수·상한·오류·동시 추가

- 재현: `node ./probe.mjs`, `node ./errors.mjs`.
- 같은 실제 작업공간과 공개 파일을 유지하고, 제외 폴더의 존재·파일 수 또는 그 안의 오류만 바꿨다. 아래 6개 호출의 **전체 반환값**을 JSON.stringify → UTF-8 Buffer로 바꾸어 `Buffer.equals`로 비교했다. 키 정렬, 시각 삭제, 오류 필드 삭제 등 정규화는 하지 않았다.
  - search_files: 기본 나열, text 검색, nameContains 검색.
  - inspect_files: 일반 나열, hash=true, hash=true와 after 지정.

| 변경 조건 | 조건 수 × 호출 수 | 바이트 차이 |
| --- | ---: | ---: |
| 제외 폴더 없음, 파일 0·1·497·498·499·500·1,001개 | 8 × 6 = 48 | 0 |
| 제외 폴더 readdir가 99,998·99,999·100,001개 항목을 반환하도록 모의 | 3 × 6 = 18 | 0 |
| 제외 폴더/하위 경로의 readdir·lstat·open에 EACCES·EIO·ENOENT 주입 | 3 × 6 = 18 | 0 |
| readdir·lstat·open **각각에 따로** EACCES·EIO·ENOENT 주입 | 9 × 6 = 54 | 0 |
| 루트 readdir 중 제외 폴더 안에 실제 파일 추가 | 6회 호출·6회 추가 | 0 |

- 첫 세 행의 각 6개 반환값 묶음은 모두 **1,045바이트**, SHA-256 `b11760af31d0ccab5b909e82a92275471014f989bcfe9e219ef082f5370711c6`이다. 결과: `results.json/counts`, `faults`.
- 개별 오류 주입과 나열 중 추가는 별도 동일 작업공간에서 비교했다. 묶음 **1,033바이트**, SHA-256 `1eb6d236899222ff0de69fb6162b9df48bbe0cffdf0799cfbaabe5881b03f5e0`. 결과: `error-results.json`.
- 제외가 켜진 오류·상한 시험에서 제외 폴더/하위 경로의 **readdir 0 / lstat 0 / open 0회**였다. 큰 Dirent 배열을 반환하는 모의 함수도 호출되지 않았다. 10만 개 실파일을 만들거나 읽은 시험은 아니다.
- 제외를 끈 양성 대조에서는 같은 주입 지점이 실제 호출됐다. 공개 검색의 `truncated` 또는 `io_error`, inspect의 `too_large`를 확인했다. 개별 open/ENOENT 대조는 숨긴 파일을 찾지 못한 것으로 처리되어 오류·truncated 대신 항목이 빠졌다. 주입이 동작하지 않아 결과가 같았던 것은 아니다.
- 공개 항목·일치 줄·개수, 크기·해시·시각, `truncated`, `next`, `hashesIncomplete`, `withheld`, 오류 여부까지 동일했다. **기존 M-1의 수·상한·오류 재현은 닫혔다.**

## V-13 M-2 재확인 — 정션 이름

- 실제 정션 4종을 사용했다: 제외 폴더의 하위 폴더, 읽을 수 있는 내부 폴더, 끊어진 대상, 작업공간 밖 대상.
- 제외 목록 `[private]`를 준 검색에서 제외 대상·끊어진 대상·밖의 대상 별칭은 모두 빠졌다. `nameContains:'alias'` 결과는 읽을 수 있는 내부 별칭 **1개**였다.
- 내용 검색에서 카나리 결과 **0개**, inspect에서 링크 이름 **0개**. 제외 별칭을 시작 경로로 검색하거나 그 아래 파일을 읽는 두 호출은 모두 effective 관문에서 `unreadable_path`였다. 대조 **6회**, 결과 `results.json/links`.
- 링크 resolve가 합성 예외를 던지는 추가 시험에서도 별칭·예외 원문이 나오지 않았다. 관계없는 제외 경로를 둔 추가 시험에서는 읽을 수 있는 내부 별칭 2개가 남고 끊어진/밖의 별칭은 빠졌다. **기존 M-2는 닫혔다.**

## 읽기 제외 없는 실행과 기준 판 비교

- 같은 실제 트리를 두 판에서 읽었다. 검색 3종·링크 이름 검색·하위 폴더 검색·없는 경로 오류, inspect 일반/해시/이어 읽기/없는 경로 오류, Workspace.list를 비교했다. 별도 공개 파일 502개 트리에서 검색 상한과 inspect 이어 읽기도 대조했다.
- 목록 생략: **15/15쌍 전체 반환 바이트 동일**. 끊어진 링크와 작업공간 밖 링크 이름도 예전처럼 나타났다.
- 빈 목록 `[]`: **13/15쌍 동일, 2쌍 불일치**. 두 불일치는 L-1의 기본 이름 검색·별칭 이름 검색이다. Workspace.list 자체와 inspect는 같았다.
- 전체 **30쌍 중 28쌍 동일**. 각 바이트 길이·SHA-256 및 불일치 원문은 `results.json/parity`에 있다.
- 걸린 시간에 따른 정보 차이는 별도로 측정·판정하지 않았으며 결함 건수에서 제외했다.

## 명령·관련 시험·한계

- 기준·후보 TypeScript 컴파일 **2/2 통과**.
- 관련 유닛 파일 **8개**, suite **12개**, 시험 **80건: 통과 79 / 실패 0 / 건너뜀 1**, **1,690.1022 ms**. 건너뜀은 실제 8.3 이름 생성 시험이며 이 볼륨에서 이름이 생성되지 않았다. 원문: `unit-tests.tap`.
- AGENTS.md를 먼저 읽고 두 저장소의 status·branch·toplevel을 확인했다. 아래 `$v13broot`는 새 실험 폴더다. 지정 worktree에서 두 판을 git archive로 추출했다.

```powershell
git archive --format=tar --output=.codaryn/codex-review-v13b-8f22117/candidate.tar 8f221179d6bfee1c96ac5a9125c8ad8f77b7b263
tar -xf .codaryn/codex-review-v13b-8f22117/candidate.tar -C .codaryn/codex-review-v13b-8f22117/candidate
git archive --format=tar --output=.codaryn/codex-review-v13b-8f22117/base.tar 79e1a3f
tar -xf .codaryn/codex-review-v13b-8f22117/base.tar -C .codaryn/codex-review-v13b-8f22117/base
git diff 79e1a3f 8f221179d6bfee1c96ac5a9125c8ad8f77b7b263 -- src/policy src/tools src/workspace src/workflows src/engine
```

base·candidate 각각에서:

```powershell
node 'D:\project\Codaryn\node_modules\typescript\bin\tsc' -p tsconfig.json --pretty false
```

실험 폴더에서:

```powershell
node .\probe.mjs > .\probe-output.json
node .\errors.mjs
node .\run-tests.mjs
```

- 래퍼: `node --import <guard.mjs의 file URL> --test --test-reporter=tap`. `dist/tests/unit/` 아래 `tools/u203-v13-hidden-count`, `tools/u203-unreadable-listing`, `policy/u203-unreadable-gate`, `tools/read-search-run`, `tools/g-inspect-files`, `tools/u189-v10b-search`, `workspace/workspace`, `workspace/u189-v10-races`의 `.test.js`만 실행했다. 명령 도구 시험은 대역이다.
- TEMP/TMP는 새 실험 폴더 아래로 지정하고, 삭제 guard로 절대·실효 대상 경로가 그 안인지 검사했다. 전체 시험 묶음, CLI/app 연결, Linux, 실제 파일 심볼릭 링크, 모든 동시 바꿔치기 조합은 실행하지 않았다.
- 관리 저장소에서 `git diff --check 79e1a3f 8f221179d6bfee1c96ac5a9125c8ad8f77b7b263 -- src/policy src/tools src/workspace src/workflows src/engine` 통과. 종료 시 추적 변경 없음.
- 저장소 추적 파일 수정 0, 커밋 0, 푸시 0, worktree 추가 0, 실제 API 0, 네트워크 0, 실제 키 조회 0, 권한 요청 0. 과거 실험은 읽기만 했으며 새 실험 폴더와 이 보고서만 작성했다.
