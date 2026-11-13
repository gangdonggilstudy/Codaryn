# R-78 보안 검토: U-89 작업 공간 목록 `listWorkspaceDir`

- 대상: `pm/unit-U-89` = `67b5de2`(main `92c75b4` 위, `git diff 92c75b4 67b5de2`, 6파일 +491/−3). 검토자 w3:p7(nd-docs). 이 단위의 코드를 쓰지 않았다.
- 기준: `docs/design/adapter-contract.md` 5.12(이 판), `claude-adapter/.codaryn/report-app-functions.md` 1절의 보안 요구 1~6.
- 방법: 읽기 전용. 저장소 파일은 바꾸지 않았다.
  - `67b5de2`를 `git archive`해 빌드하고, 그 앱 계층(`createCodarynApp(...).listWorkspaceDir`)을 같은 프로세스에서 불렀다.
  - 실제 파일 시스템. 작업 공간은 C: 임시 폴더(세션 scratchpad 아래 `x78`)다. 8.3 짧은 이름이 생기는 볼륨이라서다(D:에는 생기지 않음).
  - 합성 값만 썼다: 등록 값(`secretEnv`), 지금 키 값(`OPENAI_API_KEY`에 둔 합성 값), 키 모양(실행 때 조각을 이어 만듦). 네트워크 없음, 키 파일 없음.
  - 스크립트 `.codaryn/r78/r78.mjs`, 출력 `.codaryn/r78/r78-out.txt`.
- 결과: **높음 0, 중간 0, 낮음 2, 정보 4.**

## 1. 요청한 일곱 가지의 답

| # | 볼 것 | 결과 |
| --- | --- | --- |
| (1) | 밖으로 나가는 `dir`이 모두 `refused`나 `invalid_arguments`인지, 바깥 이름이 응답에 없는지 | **그렇다.** 2절의 63가지 값(문자열 58, 문자열이 아닌 것 5) 가운데 밖으로 나가거나 상태 디렉터리에 닿는 것은 모두 둘 중 하나였다. 바깥 폴더에만 있는 이름(`OUTSIDE-ONLY-NAME-4711…`)은 106개 응답 어디에도 없었다 |
| (2) | 디렉터리를 가리키는 링크·정션이 `link`로만 나오고 펼쳐지지 않는지 | **정션은 그렇다.** 안을 가리키는 것, 밖을 가리키는 것, 보호 경로인 것 셋 다 `link`였다. 그 경로와 그 아래 경로는 `refused`다. **심볼릭 링크는 확인하지 못했다**: 이 계정은 만들 권한이 없다(`EPERM`, 개발자 모드 꺼짐) |
| (3) | 등록 값·지금 키 값·키 모양·제어 문자·양방향 문자가 든 이름이 가려지고 `name`이 null인지, 원래 이름이 응답에 없는지 | **그렇다.** 아홉 가지 모두 `masked: true`, `name: null`이고 원래 이름이 어느 응답의 JSON에도 없었다. 다만 영폭 공백과 BOM 같은 보이지 않는 서식 문자는 가리지 않는다(L-2) |
| (4) | 상태 디렉터리가 `state`로만 나오고 그 안을 줄 수 없는지 | **그렇다.** 뿌리의 `.codaryn`은 `state`다. 대소문자만 다른 것, 끝의 점·공백, 짧은 이름 `CODARY~1`, 그 아래 경로 모두 `refused`다. 그 안의 이름(`runs`, `state-inside.txt`)은 응답에 없었다 |
| (5) | 10만 개 상한과 쪽 나눔, 목록 도중 파일이 바뀔 때 | 항목 정확히 100,000개는 `listed`(쪽 끝 `nextOffset` null, 425 ms), 100,001개는 `too_large`였다. 범위 밖 값은 모두 `invalid_arguments`였다(3절). 쪽 사이에 파일이 바뀌면 겹치거나 빠진다(계약의 한계 그대로, I-3) |
| (6) | 아무것도 쓰지 않는지, 실행 중에도 되는지 | **그렇다.** 모든 호출 뒤 작업 공간 나무(이름·크기·수정 시각)와 설정 폴더가 같았다. 상태 디렉터리가 없는 작업 공간에 `.codaryn`이 생기지 않았다. 실행 디렉터리도 생기지 않았다. 살아 있는 프로세스가 잠금을 쥔 동안에도 `listed`였고 잠금 파일은 그대로였다 |
| (7) | 보호 표시가 정책의 판정과 같은지 | **두 경우에 다르다**(L-1). 목록은 글자 기준(`covers`)만 보고, 정책의 쓰기 판정은 실경로 기준(`coversEffective`)도 본다. 목록이 "보호 아님"인데 정책은 쓰기를 막는 쪽으로만 어긋난다 |

## 2. (1)(4) `dir` 값과 결과

| 무리 | 값 | 결과 |
| --- | --- | --- |
| 상위·절대·드라이브·UNC·역슬래시 | `..`, `../outside`, `sub/..`, `sub/../..`, `/`, `/sub`, `C:/`, `C:`, `C:sub`, `\\?\C:\`, `//server/share`, `\\server\share`, `sub\deeper` | `invalid_arguments` |
| 빈 조각·`.`·길이·깊이 | `sub/./deeper`, `sub//deeper`, 256자 조각, 깊이 65 | `invalid_arguments` |
| 대체 데이터 스트림 | `file.txt:stream`, `sub:$DATA`, `sub::$INDEX_ALLOCATION`, `.codaryn::$INDEX_ALLOCATION` | `invalid_arguments` |
| 정션 | `jct-out`(밖), `jct-out/<밖의 디렉터리>`, `jct-in`(안), `jct-in/deeper`, `alias`(보호 경로인 정션) | `refused` |
| 상태 디렉터리 | `.codaryn`, `.CODARYN`, `.Codaryn`, `.codaryn/runs`, `.codaryn.`, `.codaryn `, `.codaryn..`, `.codaryn. .`, `CODARY~1`, `codary~1`, `CODARY~1/runs` | `refused` |
| 끝의 점·공백 | `sub.`, `sub `, `sub./deeper`, `sub /deeper`, `sub..` | `refused` |
| 장치 이름 | `CON`, `NUL`, `aux`, `COM1`, `con.txt` | `refused` |
| 그 밖 | ` sub`(앞 공백), `ｓｕｂ`(전각), `sub／deeper`(전각 빗금), `missing`, `file.txt/x` | `not_found` |
| | `file.txt` | `not_dir` |
| | `dir`이 문자열이 아님(null, 5, 배열, 객체, 없음) | `invalid_arguments` |
| 안쪽(허용) | `""`, `PROTEC~1`(안의 짧은 이름), `dir-<등록 값>`(실제 이름을 알 때) | `listed`. 요청의 `dir`은 응답에 되풀이되지 않는다 |

- 심볼릭 링크 두 가지(`sym-dir-out`, `sym-file-out`)는 만들지 못했다(`EPERM`). 그래서 결과는 `not_found`였고, 심볼릭 링크에 대한 확인은 아니다.

## 3. (5) `offset`·`limit`

| 값 | 결과 |
| --- | --- |
| `limit` 없음, 1, 500 | `listed`(500은 21개 전부, 1은 `nextOffset` 1) |
| `limit` 501, 0, −1, 1.5, NaN, Infinity, 문자열 `"5"`, null | `invalid_arguments` |
| `offset` −1, 0.5, NaN, Infinity, 2^53, 문자열 `"1"`, null, 없음 | `invalid_arguments` |
| `offset` `Number.MAX_SAFE_INTEGER`, 10,000(항목 21개) | `listed`, 빈 쪽, `nextOffset` null, 응답의 `offset`은 21(I-2) |
| `offset` 3, `limit` 2 | 2개, `offset` 3, `nextOffset` 5 |

## 4. (3) 이름 가림(뿌리 목록, 실제 응답)

| 이름(설명) | `name` | `shown` | `masked` |
| --- | --- | --- | --- |
| `report-<등록 값>.txt` | null | `report-[[CODARYN_SECRET:…]].txt` | true |
| `dir-<등록 값>`(디렉터리) | null | `dir-[[CODARYN_SECRET:…]]` | true |
| `k-<지금 키 값>.txt` | null | `k-[key].txt` | true |
| `<키 모양>.txt` | null | `[key].txt` | true |
| `notes-CODARYN_SECRET-x.txt`(표지 조각) | null | `notes-[[CODARYN_SECRET:…]]-x.txt` | true |
| `[[CODARYN_SECRET:<16 hex>]].txt`(토큰 모양) | null | `[[[[CODARYN_SECRET:…]]` | true |
| DEL(U+007F)이 든 이름 | null | `""` | true |
| C1(U+0085)이 든 이름 | null | `""` | true |
| U+202E(오른쪽에서 왼쪽 덮어쓰기)가 든 `invoice‮txt.exe` | null | `invoice?txt.exe` | true |
| U+200B(영폭 공백)가 든 `zero​width.txt` | `zero​width.txt` | 같음 | **false**(L-2) |
| 앞에 U+FEFF가 붙은 `bom.txt` | 같음 | 같음 | **false**(L-2) |
| `보고서.txt` | 같음 | 같음 | false |

- C0 제어 문자(U+0001 등)는 Windows가 파일 이름에 받지 않아 만들 수 없었다. 코드는 C0도 `""`로 둔다.
- 영폭 공백으로 끊은 등록 값·지금 키 값·키 모양은 각각 가려졌다(앱 계층과 같은 `cleanText` → `hideKeys` → `mask` 순서로 따로 확인). L-2는 값의 누출이 아니라 보이는 이름의 속임 문제다.

## 5. (7) 보호 표시와 정책의 판정

정책(`protectedPaths: ["notes.md", "Protected Folder Long", "alias", "sub/deeper"]`, `alias`는 `real-target`을 가리키는 정션)으로 `createPolicyGate`를 만들었다. 각 항목(디렉터리는 그 아래 `x.txt`)에 대한 `write_file`의 `checkRequested`(글자 기준)와 `checkEffective`(실경로 기준)를 목록의 `protected`와 나란히 보았다.

| 목록 | 목록의 `protected` | 정책: 글자 기준 | 정책: 실경로 기준 |
| --- | --- | --- | --- |
| 뿌리의 `notes.md`, `alias`, `Protected Folder Long/…`, `sub/deeper/…` | true | 막음 | 막음 |
| `protected folder long`(대소문자만 다름)/`inner.txt` | true | 막음 | 막음 |
| **`PROTEC~1`(짧은 이름)/`inner.txt`** | **false** | 통과 | **막음** |
| **뿌리의 `real-target`(보호 경로 `alias` 정션의 대상)/`x.txt`, 그 안의 `t.txt`** | **false** | 통과 | **막음** |
| 모두 17가지 비교 가운데 나머지 14가지(보호 6, 보호 아님 8) | 정책과 같음 | | |

## 6. 지적

### L-1(낮음) 보호 표시가 실경로를 보지 않아, 짧은 이름이나 링크인 보호 항목의 대상에서 "보호 아님"으로 나온다

- 재현:
  - `protectedPaths: ["Protected Folder Long", "alias"]`이고 `alias`는 `real-target`을 가리키는 정션이다.
  - `listWorkspaceDir({ dir: "PROTEC~1" })`의 `inner.txt`는 `protected: false`다.
  - `listWorkspaceDir({ dir: "real-target" })`의 `t.txt`도 `protected: false`다.
  - 정책은 둘 다 쓰기를 막는다(`protected_path`, `checkEffective`). 실경로가 보호 경로 아래이고(짧은 이름), 링크인 보호 항목은 그 대상도 보호하기 때문이다(T-13).
- 원인: `workspace-dir.ts`는 `compileProtectedPaths(...).covers(\`${dir}/${name}\`)`만 부른다. 이 판정은 요청된 `dir` 글자 그대로를 본다. 정책은 쓰기 때 `coversEffective`로 실경로도 본다. 계약 5.12의 "정책이 경로를 판정하는 그대로 글자 기준"은 `checkRequested`와만 같고 `checkEffective`와는 다르다.
- 영향: 표시는 안전한 쪽으로만 틀린다. 정책은 여전히 막고, 목록이 "보호"라 한 것을 정책이 허용하는 경우는 없었다. GUI의 [보호] 표시를 믿는 사람이 이 둘을 쓸 수 있는 파일로 볼 수 있다.
  - 짧은 이름은 사람이 GUI 나무로 고르는 경로에서는 생기지 않는다(나무는 긴 이름을 준다). 생기는 것은 어댑터가 짧은 이름으로 부를 때뿐이다.
  - `real-target`은 나무로 고르는 경로에서도 생긴다.
- 고칠 방향(제안): 항목마다 `coversEffective(relative, workspace)`를 쓴다. 비용이 걱정되면 보호 항목의 실경로를 디렉터리마다 한 번 풀어 둔다. 아니면 계약에 "글자 기준이라 링크 대상과 짧은 이름은 표시하지 않는다"를 한계로 적는다.

### L-2(낮음) 보이지 않는 서식 문자(영폭 공백, BOM 등)가 든 이름은 그대로 보인다

- 재현: `zero\u200Bwidth.txt`, `\uFEFFbom.txt`는 `masked: false`이고 `name`과 `shown`에 그 문자가 그대로 있다.
- 원인: `cleanText`가 바꾸는 것은 C0, DEL, C1, U+2028·U+2029, 양방향 제어(U+061C, U+200E·U+200F, U+202A~U+202E, U+2066~U+2069)뿐이다. 그대로 두는 것을 따로 쟀다: U+200B·U+200C·U+200D·U+2060·U+FEFF·U+00AD·U+034F·U+3164·U+115F·U+180E·U+FE0F·U+E0001.
- 영향: 값은 새지 않는다(4절 끝). GUI 나무에서 두 파일이 같은 이름으로 보이게 할 수 있다(예: `report.txt`와 `re\u200Bport.txt`). 고르면 진짜 이름으로 열리므로 다른 파일을 열게 할 수 있다.
  - 계약이 이 경우를 정하지 않았다. 다른 곳(에이전트의 마지막 답 `safeModelText`, 키 구분 문자 `KEY_SEPARATOR_PATTERN_SOURCE`)은 서식 문자(`\p{Cf}`)를 보이지 않는 문자로 다룬다.
- 고칠 방향(제안): 이름에 `\p{Cf}`(와 U+3164, U+115F 같은 채움 문자)가 있으면 양방향 문자처럼 가린 항목(`masked: true`, `name: null`)으로 하거나, 보이는 표식으로 바꾼다.

### 정보

- **I-1 가린 항목의 순서는 진짜 이름으로 정한다.** 예: 키 모양 이름(`[key].txt`로 보임)은 `report-…`와 `zero…` 사이에 놓였다. 진짜 이름이 `sk-`로 시작하기 때문이다. 옆 항목과의 순서로 가린 이름의 첫 글자 범위를 짐작할 수 있다. 값 자체는 나오지 않고, 짐작하려면 이웃 이름을 만들 수 있어야 한다.
- **I-2 끝을 넘은 `offset`.** 응답의 `offset`은 요청값이 아니라 `total`로 줄인 값이다(`10000` → `21`). 계약에 "끝을 넘은 `offset`은 빈 쪽"이라고만 있다.
- **I-3 쪽 사이의 변경**(계약의 한계 그대로): 첫 쪽(`b`, `c`) 뒤에 `a`를 만들자 다음 쪽이 `c`, `d`였다(`c` 겹침, `a` 빠짐). `b`를 지우자 같은 `offset`의 쪽이 `d`, `e`였다(`c` 빠짐).
- **I-4 실제 이름을 아는 호출자는 가린 디렉터리 안도 나열할 수 있다**(`dir-<등록 값>` → `listed`). 어댑터는 그 이름을 받지 못하므로(`name: null`) 나무로는 닿지 않는다. 응답은 요청한 `dir`을 되풀이하지 않는다.

## 7. 판 수치

- 이 검토의 판(`67b5de2`를 `git archive`해 빌드, 키 변수 없음, APPDATA를 임시 폴더로): 타입 검사 통과, 유닛 2,718건 중 2,714 통과·0 실패·3 건너뜀·todo 1, 통합 559건 통과.

## 8. 확인하지 않은 것

- 심볼릭 링크(파일·디렉터리): 만들 권한이 없었다. 코드는 `Dirent.isSymbolicLink()`와 `lstat`의 `isSymbolicLink()`로 정션과 같은 길을 탄다.
- 그 밖의 재해석 지점(OneDrive 자리표시 파일, `AppExecLink` 등), 하드 링크, 네트워크 드라이브, FAT/exFAT.
- GUI 쪽 연결(엔진 호스트의 `tree.ts`가 이 함수를 쓰게 바꾸는 단위 1-b)은 이 판에 없다.
- Linux·macOS.
