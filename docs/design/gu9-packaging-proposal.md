# GU-9 꾸러미 승인 제안서 (초안)

- 상태: **초안, 승인 전.** 아무것도 설치·내려받기·빌드·실행하지 않았다.
  - 사용자가 2026-11-23에 승인한 것은 아래 주소의 메타데이터 읽기뿐이다.
  - 설치, 꾸러미 만들기, 서명, 게시는 여전히 미승인이다(DR-67 `docs/decision-register.md:597`, [인계 문서](../operations/pm-handoff-2026-11-15.md):65).
- 작업: gu9-proposal-claude-01(claude-worker). 기준은 main `a91cf12a`, 조회일은 2026-11-23이다.
- 보완: gu9-fix-claude-01(claude-worker), 2026-11-23, 기준 main `a82f8a19`. 독립 검토(gu9-review-codex-01)의 M1·L1·L2, 정보 I1~I4, D-6의 순서를 반영하고 인용 줄을 이 판에 맞췄다. 보완 때는 웹 조회를 하지 않았고, 설치된 `gui/node_modules`를 읽기만 했다.
- 근거 원문
  - 조회 응답은 원문 그대로 `.codaryn/session-comms/gu9-proposal-claude-01/raw/`(Git 제외)에 있다. 아래에서는 `raw/<이름>`으로 적는다.
  - 각 파일의 SHA-256은 부록 A와 작업 보고서에 있다. 저장소 근거는 `경로:줄`(보완 기준 main `a82f8a19`)로 적는다.
- 표기
  - **[추정]**: 조회 원문, 저장소, 설치된 `gui/node_modules` 소스 어디에도 근거가 없는 외부 사실이다.
  - **미확인**: 근거를 찾지 못한 값이다.
  - **[설계 제안]**: 이 제안서가 고른 선택이다.
  - **사용자 결정 필요**, **기준 필요**: 아직 정해지지 않은 것이다.
  - 버전 범위(`^`)는 해석하지 않았다.

## 1. 목적과 범위

GU-9는 GUI를 Windows x64에서 풀어 바로 실행할 수 있는 묶음으로 만든다(`docs/design/standalone-gui.md:961`, `:1079`, `:1105`). 할 일은 다음 넷이다.

- packager로 `gui/out/Codaryn-win32-x64/`를 만든다(`standalone-gui.md:961`). 산출 폴더는 Git에서 제외되어 있다(`:951`).
- 6.7의 fuses를 적용한다(`:818`~`:819`).
- 엔진 호스트용 Node 26을 함께 묶는다. DR-26이 정했고(`decision-register.md:84`), 묶는 방법은 배포 전에 정한다(`standalone-gui.md:888`, E-2 `:1042`).
- zip으로 묶는다. 첫 배포는 zip이다(GUI-D9 `:1192`).

이 제안이 승인을 구하는 것은 다음과 같고, 11절에서 하나씩 묻는다.

1. 개발 의존성 두 개(`@electron/packager` 20.3.0, `@electron/fuses` 2.1.3)를 더하는 것.
2. 간접 의존성까지 lock을 해석하는 것(D-3a), 그리고 해석된 판을 검토한 뒤 설치하는 것(D-3b).
3. Node 26.13.1 win-x64 배포물을 내려받아 라이선스를 확인하는 것(D-5a), 그리고 그 뒤에 묶는 것(D-5b).
4. 기존 Electron 45.3.1 zip의 위치와 SHA-256을 확인하는 것(D-4a). 다시 받거나 자동으로 받을 수 있는 실행은 5.2의 승인 전 확인 뒤에 따로 묻는다(D-4b, D-8b).
5. fuses 값, zip 형식, 꾸러미 앱이 엔진을 찾는 방식.

구하지 않는 것은 GUI-D9 배포 결정으로 미룬다(`:1192`, E-6 `:1046`): 설치 파일(NSIS, MSI 등, `:890`), 코드 서명, SmartScreen, 외부 게시, 자동 업데이트, 충돌 보고(`:823`). 조사하지 않은 비용, 예를 들어 인증서 가격은 적지 않는다.

### 1.1 먼저 알아야 할 점

- **꾸러미만 만들어서는 앱이 엔진을 띄우지 못한다.**
  - 꾸러미 앱에서는 `nodePath`가 `null`이 되어(`gui/src/main/app.ts:122`) `node_not_found`로 끝난다(`:123`).
  - 엔진 위치도 개발 배치인 `guiRoot/../dist/src`로 고정되어 있다(`:121`). `gui/src/main/node-path.ts:3`~`:4`도 "until then a packaged build finds none"이라고 적는다.
  - 고치려면 `gui/src/main/**`를 바꿔야 하는데, 그곳은 GU-1 소유다(`standalone-gui.md:1071`). GU-9 소유는 `gui/scripts/package/**`와 `docs/gui-usage.md`뿐이다(`:1079`). 그래서 GU-1 소유자의 변경이 먼저 필요하다(D-7).
- **엔진 호스트와 엔진은 asar 밖에 두어야 한다[추정].**
  - 별도 Node 26 프로세스는 Electron의 asar 묶음 안 파일을 읽지 못한다.
  - 지금 호스트 진입점은 앱 폴더 안의 `build/src/engine-host/main.js`다(`app.ts:127`).
  - asar 무결성 fuse가 asar 밖의 파일(Node, 엔진)까지 지키는지는 미확인이다(D-7).
- **asar 무결성 fuse가 Windows에서 효과가 있는지 미확인이다.** fuses README의 해당 주석은 "validation of the app.asar archive on macOS"다(`raw/fuses-v2.1.3-README.md:27`). E-4(`standalone-gui.md:1044`)는 일부만 풀린다.

## 2. 개발 의존성 표

두 패키지 모두 `latest` 문서와 정확한 버전 문서가 바이트까지 같다(cmp 일치, 부록 A의 SHA-256이 같다).

| 항목 | `@electron/packager` | `@electron/fuses` |
| --- | --- | --- |
| 제안 판(정확 고정) | **20.3.0** (`raw/packager-latest.json` `version`) | **2.1.3** (`raw/fuses-latest.json` `version`) |
| 게시일 | 2026-08-11T20:24:53Z [추정] | 2026-06-29T18:04:19Z [추정] |
| 라이선스 | BSD-2-Clause | MIT |
| `dist.integrity` | `sha512-3MvgJgy6YJ5ti0oGGBKrWKdYwpTaoRrhranMDgHSQ6i5t56yZV9IRDyoXTuqBp97LiKqnZeAMe2wTcF/9+fP5g==` | `sha512-LoKJUXNiJ4JM8IIrUltSHI+8pkogaGj5wmJx81jE/Wk3g2w1/kfMbTEKNoY5kitGE8hiC12h32R/1SlywFtxXg==` |
| `dist.shasum` | `9072b669a82785a708cc72018386b8e2c82f5cc2` | `9a63a0ab88da9433417b3d5a3a95487e461488d6` |
| `dist.tarball` | `https://registry.npmjs.org/@electron/packager/-/packager-20.3.0.tgz` | `https://registry.npmjs.org/@electron/fuses/-/fuses-2.1.3.tgz` |
| 설치 스크립트 | 없음 | 없음 |
| `engines.node` | `>= 22.12.0` | `>=22.12.0` |
| 직접 의존성 | 17개(3절) | **없음**(`dependencies` 키 없음) |
| `bin` | `electron-packager` → `bin/electron-packager.mjs` | `electron-fuses` → `dist/bin.js` |
| 출처 증명 | `dist.attestations`(SLSA provenance v1), 레지스트리 서명 2개 | `dist.attestations`(SLSA provenance v1), 레지스트리 서명 1개 |
| 게시자 | `_npmUser` GitHub Actions | `_npmUser` GitHub Actions |
| 풀린 크기 | 282,000 bytes(`dist.unpackedSize`) | 40,898 bytes |

- 근거는 행 이름이 없는 한 각각 `raw/packager-20.3.0.json`, `raw/fuses-2.1.3.json`의 같은 이름 필드다.
- 게시일: 허용 주소의 버전 문서에는 `time` 필드가 없다. 위 값은 `_npmOperationalInternal.tmp` 안의 13자리 밀리초 값을 UTC로 바꾼 것이라 [추정]이다.
- 설치 스크립트: 두 문서 모두 `scripts`에 `preinstall`, `install`, `postinstall`이 없고 `hasInstallScript`도 없다.
  - `prepare`(husky)와 `prepack`은 있다. 레지스트리 tarball로 설치할 때는 이 둘이 돌지 않는다[추정: npm 문서와 대조하지 않음].
- `engines.node`: GUI 패키지는 `>=26.0.0`이다(`gui/package.json:10`). 두 도구의 하한은 그보다 낮아 맞는다.
- `@electron/fuses`의 `resolutions` 필드(`fsevents` 대체)는 yarn이 그 저장소 안에서만 쓰는 값이고, npm으로 이 패키지를 받는 쪽에는 적용되지 않는다[추정].
- 서명과 출처 증명은 존재만 확인했다. 검증은 설치 단계에서 한다(8절).

## 3. 직접 의존성 표

`@electron/packager` 20.3.0의 직접 의존성 17개다. `@electron/fuses`는 0개다.

- 범위는 `raw/packager-20.3.0.json` `dependencies`에서 가져왔다.
- latest, 라이선스, 설치 스크립트는 각 `raw/dep-<이름>-latest.json`에서 가져왔다(이름의 `@`는 빼고 `/`는 `__`로 바꿈).
- "없음"은 `scripts`에 `preinstall`, `install`, `postinstall`이 없고 `hasInstallScript`와 `gypfile`도 없다는 뜻이다.

| 이름 | 범위 | latest | 라이선스 | 설치 스크립트 | 비고 |
| --- | --- | --- | --- | --- | --- |
| `junk` | `^4.0.1` | 4.0.1 | MIT | 없음 | |
| `debug` | `^4.4.1` | 4.4.3 | MIT | 없음 | 지금 lock에 4.4.3(`gui/package-lock.json:60`) |
| `plist` | `^3.1.0` | 5.1.2 | MIT | 없음 | **latest의 주 버전이 범위와 다름** |
| `semver` | `^7.7.2` | 7.8.6 | ISC | 없음 | lock 7.8.6(`:134`) |
| `resedit` | `^2.0.3` | 3.1.1 | MIT | 없음 | **주 버전 다름** |
| `galactus` | `^2.0.2` | 2.0.2 | MIT | 없음 | |
| `filenamify` | `^6.0.0` | 7.0.3 | MIT | 없음 | **주 버전 다름** |
| `graceful-fs` | `^4.2.11` | 4.2.12 | **BlueOak-1.0.0** | 없음 | lock은 4.2.11, ISC(`:110`, `:114`) |
| `yargs-parser` | `^22.0.0` | 22.0.0 | ISC | 없음 | |
| `@electron/get` | `^5.0.0` | 5.1.0 | MIT | 없음 | lock 5.1.0(`:29`) |
| `@electron/asar` | `^4.0.1` | 4.3.2 | MIT | 없음 | |
| `@electron/notarize` | `^3.1.0` | 3.1.2 | MIT | 없음 | macOS용[추정] |
| `@electron/osx-sign` | `^2.2.0` | 2.7.2 | BSD-2-Clause | 없음 | macOS용[추정] |
| `@electron/universal` | `^3.0.1` | 3.0.6 | MIT | 없음 | macOS용[추정] |
| `@electron/windows-sign` | `^2.0.2` | 2.1.0 | BSD-2-Clause | 없음 | 그 의존성 `postject`의 범위가 시험판(`^1.0.0-alpha.6`), 미조회 |
| `@malept/cross-spawn-promise` | `^2.0.0` | 2.0.0 | Apache-2.0 | 없음 | |
| `@electron-internal/extract-zip` | `^1.0.1` | 1.0.8 | MIT | 없음 | lock 1.0.8(`:19`) |

- **"주 버전 다름" 세 행**(`plist`, `resedit`, `filenamify`): latest가 `^` 범위 밖이다. 이 행의 라이선스와 설치 스크립트 값은 실제로 해석될 판의 값이 아닐 수 있다.
- **`graceful-fs`**
  - latest 4.2.12의 라이선스는 BlueOak-1.0.0이다. DR-75 허용 목록(`docs/development-workflow.md:120`, `scripts/check-licenses.mjs:8`)에 없으니 처음 보는 식별자로 원문을 먼저 확인해야 한다(`development-workflow.md:123`).
  - 지금 lock의 4.2.11은 ISC다. lock 해석이 어느 판을 고를지는 해석해 봐야 안다.
- **간접 의존성은 조회하지 않았다.** 위 latest 문서 17개의 `dependencies` 이름을 모으면, 지금 GUI lock에 없는 것은 13개다. 그 가운데 `plist`, `@electron/asar`는 직접 의존성이기도 하다(위 표). 나머지 11개는 `glob`, `minimatch`, `promise-retry`, `isbinaryfile`, `postject`, `filename-reserved-regex`, `flora-colossus`, `cross-spawn`, `xmlbuilder`, `@xmldom/xmldom`, `pe-library`다. latest 메타데이터끼리의 비교이고, 앞으로 해석될 lock의 실제 패키지 수가 아니다. 실제로 해석될 판의 의존성은 이와 다를 수 있고, 셋째 단계 이하는 모른다.

### 3.1 lock 해석은 별도 승인 단계다

전체 lock(간접 의존성 포함)은 해석해야 정해진다. 그래서 의존성 추가 승인(D-1, D-2)과 설치 승인(D-3b) 사이에 이 단계(D-3a)를 둔다.

- 명령(제안, 실행 안 함): `gui/package.json`에 두 줄을 더한 뒤 `gui`에서 `npm install --package-lock-only --ignore-scripts`를 실행한다.
  - 레지스트리 메타데이터를 읽으므로 네트워크를 쓴다.
  - 이 명령이 `node_modules`를 만들지 않고 lock만 쓴다는 것은 [추정]이다. npm 문서와 대조하지 않았다.
- 해석한 뒤 PM이 볼 것
  - `check-lock.mjs`의 네 규칙: 설치 스크립트 없음(`gui/scripts/build/check-lock.mjs:35`), npm 레지스트리 출처(`:15`, `:36`), sha512 무결성(`:37`), 개발 전용(`:38`). 새로 들어온 패키지 전부가 대상이다.
  - 라이선스: 저장소 루트에서 `node scripts/check-licenses.mjs --json`. GUI lock도 읽는다(`check-licenses.mjs:7`). review나 deny로 나온 항목은 DR-75대로 처리한다.
  - 새 패키지 수와 이름 목록, 그리고 `graceful-fs`의 판.
- `APPROVED` 변경
  - `check-lock.mjs:14`의 `{ electron: "45.3.1" }`는 세 항목이 되어야 한다.
  - 비교가 `JSON.stringify` 문자열 비교라서(`:23`, `:26`) **키 순서도 `package.json`과 같아야 한다.** npm이 `devDependencies`를 이름 순으로 쓴다면 `@electron/fuses`, `@electron/packager`, `electron` 순서다[추정].
- 소유: `gui/package.json`, `gui/package-lock.json`, `gui/scripts/build/**`는 GU-1 소유다(`standalone-gui.md:1071`, `:1083`). 그래서 이 단계의 변경도 GU-1 소유자가 한다.

## 4. Node 26 배포물

| 항목 | 값 | 근거 |
| --- | --- | --- |
| 판 | **v26.13.1**(2026-11-10, `lts` "Lithium", `security` true) | `raw/node-dist-index.json`: v26.x 21개 가운데 가장 높다 |
| 함께 든 것 | npm 11.20.0, OpenSSL 3.5.9, V8 14.6.202.34 | 같은 항목 |
| 파일 | `node-v26.13.1-win-x64.zip` | `raw/node-v26.13.1-SHASUMS256.txt:25`, index의 `files`에 `win-x64-zip` |
| 주소 | `https://nodejs.org/dist/v26.13.1/node-v26.13.1-win-x64.zip` | 조회한 SHASUMS가 있는 디렉터리에 위 파일 이름을 붙인 것 |
| SHA-256 | `e2edda75bfb089654705cf65a13b58933bfd5f57148e8ebda916f58a2474f1f7` | SHASUMS256.txt:25 |
| 대안: `node.exe`만 | `https://nodejs.org/dist/v26.13.1/win-x64/node.exe`, SHA-256 `f5109dc868ec38703ad8f305e0aceece717cb60d4889873f434017af4e96cccb` | SHASUMS256.txt:31 |
| 크기 | 미확인(index와 SHASUMS에 크기가 없다) | — |
| 라이선스 | 미확인(허용 주소에 원문이 없다) | 10절 |
| 기존 사용 | CP-54 패킷이 이미 Node 26.13.1 실행 파일을 핀으로 고정해 썼다 | `docs/pm-status.md` CP-54 |

- 권고[설계 제안]: zip을 받아 `node.exe`와 `LICENSE`만 묶는다. 라이선스 원문을 확인하기 전에는 묶지 않는다(D-5a → D-5b).
  - zip에는 라이선스 원문이 함께 있다[추정]. `node.exe`만 받으면 라이선스 원문을 따로 구해야 한다.
  - zip에 든 npm 등은 꾸러미에 넣지 않는다.
- 검증 방법(방법만 적고 실행하지 않음)
  1. 받은 zip을 `Get-FileHash -Algorithm SHA256`으로 재서 위 `e2edda75…`와 같은지 본다.
  2. SHASUMS 자체가 진본인지는 같은 디렉터리의 서명된 목록 `SHASUMS256.txt.asc`를 Node 릴리스 담당자의 공개 키로 `gpg --verify`해 확인한다[추정: `.asc`가 있는지와 공개 키 목록의 위치는 이번에 조회하지 않았다].
     - 이번 조회는 HTTPS 전송만 믿었고, 서명은 확인하지 않았다.
  3. 묶은 뒤 엔진 호스트의 `ready`가 알리는 판이 26.13.1인지 본다. 판은 `ready`로 확인한다(`node-path.ts:4`).

## 5. Electron 실행 파일 zip

- 기준 SHA-256: `electron-v45.3.1-win32-x64.zip` → `d92d1aa4700e3a7e7f174731f5086ebd9c21f9773e642b260160fe0a6ebe12d2`(`gui/node_modules/electron/checksums.json:40`, 이미 설치된 파일을 읽기만 함).
- 지금 있는 것: GU-1이 승인된 설치 단계로 받은 실행 파일이 `gui/node_modules/electron/dist/`에 있다(`standalone-gui.md:879`). 크기는 374,391,699 bytes이고, `LICENSE`와 `LICENSES.chromium.html`이 있다(로컬에서 읽기만 함).

### 5.1 `electron` 설치 경로의 사실 (오프라인, 설치된 소스를 읽기만 함)

`electron`의 `install.js`가 `@electron/get` 5.1.0(`gui/package-lock.json:29`)으로 받는 경로다. 근거는 `gui/node_modules/` 아래 파일이고, `@electron/get/dist/`는 `get/`으로 줄여 적는다.

- **기본 주소:** `https://github.com/electron/electron/releases/download/v45.3.1/electron-v45.3.1-win32-x64.zip`
  - 기본 바탕 주소(`get/artifact-utils.js:2`)에 판, `/`, 파일 이름을 붙여 만든다(`:36`~`:50`). 파일 이름은 `electron-<판>-<플랫폼>-<아키텍처>.zip`이고(`:12`~`:18`), 판 앞에는 `v`가 붙는다(`get/utils.js:38`~`:43`).
  - 이 주소는 소스에서 조립한 것이고, 이번 작업에서 열어 보지 않았다.
- **주소를 바꾸는 값:** `ELECTRON_MIRROR`, `npm_config_electron_mirror` 같은 환경 변수와 npm 설정이 기본값보다 먼저 쓰인다. 경로(`customDir`)와 파일 이름(`customFilename`)도 같다(`get/artifact-utils.js:20`~`:35`, `:38`~`:43`). 호출자가 `resolveAssetURL`을 주면 그 결과를 쓴다(`:45`~`:48`).
- **캐시 위치**
  - `cacheRoot`가 없으면 `env-paths`의 `electron` cache 폴더를 쓴다(`get/Cache.js:8`~`:10`). Windows에서는 `%LOCALAPPDATA%\electron\Cache`다(`env-paths/index.js:23`, `:29`, env-paths 3.0.0).
  - 파일은 `<cacheRoot>\<주소에서 파일 이름을 뺀 부분의 SHA-256>\<파일 이름>`에 둔다(`get/Cache.js:16`~`:25`). 기본 주소라면 가운데 폴더는 `15705763c2a501c8e55079067f73292eede184576305647a01ddc80f4e1b1e17`이다. `https://github.com/electron/electron/releases/download/v45.3.1`의 SHA-256을 이번에 오프라인으로 계산한 값이다.
  - `install.js`는 환경 변수 `electron_config_cache`를 `cacheRoot`로 넘긴다(`electron/install.js:44`). 기본 캐시 방식은 읽고 쓰기라서(`get/utils.js:132`~`:133`) 받은 zip이 캐시에 남는다(`get/index.js:166`).
  - GU-1 때 그 변수나 미러 값이 있었는지, 지금 그 파일이 있는지는 보지 않았다(사용자 폴더라 읽지 않음). 그래서 미확인이다.
- **체크섬 대조**
  - 호출자가 `checksums`를 주면 그 값으로 `SHASUMS256.txt`를 만들어 SHA-256을 대조한다(`get/index.js:29`~`:39`, `:65`~`:67`).
  - `install.js`는 패키지의 `checksums.json`을 준다(`electron/install.js:45`~`:48`). 다만 `electron_use_remote_checksums`나 `npm_config_electron_use_remote_checksums`가 있으면 주지 않는다(같은 줄).
  - `checksums`가 없으면 같은 주소 규칙으로 그 릴리스의 `SHASUMS256.txt`를 캐시 없이 받아 대조한다(`get/index.js:40`~`:53`). 이때는 zip과 체크섬 목록이 같은 출처에서 온다.
  - 캐시에 있는 파일도 대조하고, 맞지 않으면 다시 받는다(`get/index.js:114`~`:141`). `unsafelyDisableChecksums`가 있으면 대조하지 않는다(`:25`).
- 뜻[설계 제안]: 꾸러미를 만들기 전에 위의 주소·캐시·체크섬 환경 변수가 비어 있는지 확인한다. 미러 값은 주소를 바꾸고, `checksums`가 없는 호출에서는 체크섬 목록도 그 미러에서 온다.

### 5.2 packager의 경로 (미확인) — 승인 전 확인 단계

- packager 20.3.0은 `@electron/get` `^5.0.0`에 의존한다(`raw/packager-20.3.0.json`). README에 있는 것은 두 가지뿐이다.
  - "Find or download the correct release of Electron"(`raw/packager-v20.3.0-README.md:82`).
  - macOS 예의 "cache the downloads in `~/.electron`"(`:149`).
- packager 소스가 설치되어 있지 않아 다음 셋은 **미확인**이다.
  - `downloadArtifact`에 어떤 인자(`checksums`, `cacheRoot`, `mirrorOptions`, `unsafelyDisableChecksums`)를 넘기는지. `checksums`를 넘기지 않으면 5.1의 원격 `SHASUMS256.txt` 경우가 된다.
  - 이미 있는 zip이나 폴더를 지정하는 옵션이 있는지.
  - GU-1 설치 때의 캐시를 다시 쓰는지.
- **승인 전 확인 단계(새 조회, 별도 승인 필요):** packager 20.3.0의 정확한 판의 소스나 API 문서를 읽어 위 셋을 `path:줄`로 확인한다. 조회 주소와 요청 수는 그 승인 때 정한다.
- **이 확인 전에는 꾸러미 만들기(6절 5단계)의 실행 승인을 묻지 않는다.**
  - 지금 물을 수 있는 것은 기존 zip의 명시 위치와 SHA-256 확인까지다(D-4a).
  - 다시 받기나 자동 내려받기가 일어날 수 있는 실행(D-4b, D-8b)은 정확한 주소와 동작을 확인한 뒤 다시 묻는다.

## 6. 명령 순서 (제안, 실행 안 함)

| # | 단계 | 명령(제안) | 위치 | 네트워크 | 승인 |
| --- | --- | --- | --- | --- | --- |
| 1 | 의존성 추가 | `gui/package.json` `devDependencies`에 `"@electron/fuses": "2.1.3"`, `"@electron/packager": "20.3.0"`을 정확한 판으로 추가(GU-1 소유자) | `gui` | 아니요 | D-1, D-2 |
| 2 | lock 해석 | `npm install --package-lock-only --ignore-scripts` → 3.1의 검사 → PM 보고 | `gui` | **예**(메타데이터) | D-3a |
| 3 | check-lock 갱신과 설치 | `check-lock.mjs:14` `APPROVED`를 세 항목으로 바꿈(키 순서 맞춤) → `npm ci --ignore-scripts` → `npm test` | `gui` | **예**(`npm ci`가 tarball을 받고 lock의 sha512와 대조[추정]) | D-3b |
| 4 | 엔진 찾기 변경 | `app.ts:121`(엔진 경로), `:122`(`nodePath`), `:127`(`hostScript`)을 정한 배치로 바꿈(GU-1 소유) | `gui/src/main` | 아니요 | D-7 |
| 5 | 꾸러미 만들기 | 루트 `npm run build` → `gui`에서 `npm run build` → `npm run package`(새 `gui/scripts/package/*.mjs`가 packager API를 부름: 이름 `Codaryn`, `win32`, `x64`, Electron `45.3.1`, `out`, asar, `ignore`) | 루트, `gui` | **미확인**(5.2. 캐시가 없거나 맞지 않으면 받을 수 있다) | 5.2 확인 뒤 D-4b, D-8b |
| 6 | Node·엔진 복사 | Node zip 내려받기 → SHA-256 대조(4절) → `node.exe`와 `LICENSE`를 `resources/node/`에, 엔진 호스트 산출과 루트 `dist/src`를 `resources/engine/`에, 고지 파일을 7절의 자리에 복사[설계 제안] | `gui` | **예**(Node zip 한 번) | D-5a, D-5b, D-7 |
| 7 | fuses 적용·확인 | `flipFuses(<exe>, {...})`(`raw/fuses-v2.1.3-README.md:19`~`:33`) → `node node_modules/@electron/fuses/dist/bin.js read --app <exe>`(같은 README `:41`) | `gui` | 아니요[추정] | D-6 |
| 8 | zip | Windows에 들어 있는 도구로 `out/Codaryn-win32-x64/`를 묶고 SHA-256을 기록 | `gui` | 아니요 | D-8a |

- fuses(7단계)를 Node·엔진 복사(6단계) 뒤에 둔다. 초안은 5단계 바로 뒤였다.
  - 근거: fuses README는 "after your app has been packaged (all files in place) but before code signing"이라고 적는다(`raw/fuses-v2.1.3-README.md:16`~`:18`).
  - 그래서 모든 파일을 둔 뒤 fuse를 바꾸고, 바로 읽어 확인한 다음 zip으로 묶는다. 읽은 값이 곧 묶는 exe의 값이다.
- `<exe>`는 `out/Codaryn-win32-x64/Codaryn.exe`다[추정]. README의 예가 `Foo Bar-win32-x64/Foo Bar.exe`다(`raw/packager-v20.3.0-README.md:170`).
  - `read --app`에 Windows exe 경로를 주는 것도 [추정]이다. README의 예는 macOS `.app`이다.
- 6단계의 배치(`resources/node/`, `resources/engine/`)는 이 제안서의 선택이다. packager에 그런 복사 옵션이 있는지는 README에 없어 미확인이다. 그래서 GU-9 스크립트가 packager가 끝난 뒤에 복사한다.
- 8단계의 도구: Windows에 들어 있는 `tar.exe -a -c -f` 또는 PowerShell `Compress-Archive`를 쓴다[추정]. 둘 다 새 의존성이 없다.
- 표의 네트워크 칸은 이 명령 순서의 각 단계만 말한다. 2·3·5·6단계 말고는 네트워크를 쓰지 않는다.
  - 8절의 검증 명령은 따로다. 예를 들어 `npm audit signatures`가 네트워크를 쓰는지와 그 주소는 [추정]이다. 주소, 시점, 허용 범위는 D-3b에서 정한다.
- 키, 실제 API, 사용자 설정은 어느 단계도 쓰지 않는다.

## 7. 산출물

- 경로: `gui/out/Codaryn-win32-x64/`(`standalone-gui.md:961`), 그리고 그것을 묶은 zip 하나. 둘 다 Git 제외다(`:951`).
- 넣는 것
  - **asar 안:** `package.json`, `build/src/{main,preload,renderer,shared}`.
  - **packager가 넣는 Electron 런타임 파일과 `LICENSE`**: README에 "LICENSE [the Electron license]"가 있다(`raw/packager-v20.3.0-README.md:160`). `LICENSES.chromium.html`이 함께 들어가는지는 미확인이다.
  - **asar 밖[설계 제안]:** `resources/node/node.exe`와 `resources/node/LICENSE`, `resources/engine/`(엔진 호스트 산출 `build/src/engine-host`와 그것이 쓰는 `build/src/shared`, 루트 `dist/src`). 루트 `dist/src`는 실행 의존성이 0개다(DR-20).
  - **고지 파일[설계 제안]**
    - packager는 산출 맨 위에 Electron의 `LICENSE`를 둔다(`raw/packager-v20.3.0-README.md:160`).
    - 그래서 Codaryn의 고지는 같은 이름으로 덮어쓰지 않게 `licenses/Codaryn/LICENSE`(Apache-2.0, `gui/package.json:6`)와 `licenses/Codaryn/NOTICE`에 둔다. `NOTICE`는 저장소 루트의 파일 그대로다("Codaryn", "Copyright 2026 gangdonggil", `NOTICE:1`~`:2`).
    - 근거: Apache-2.0 4(d)는 배포하는 파생물에 NOTICE의 귀속 고지를 읽을 수 있게 넣으라고 한다(`LICENSE:106`~`:119`). DR-75도 NOTICE 조건을 지키라고 한다(`development-workflow.md:120`, `:124`).
    - Node의 `LICENSE`는 `resources/node/LICENSE`, Electron의 `LICENSE`와 `LICENSES.chromium.html`은 packager가 둔 자리 그대로다. 세 고지가 서로 다른 경로에 있어 덮어쓰지 않는다.
- 빼는 것
  - `build/tests`: 연기 시험 진입점이고 OS 대화상자에 자동으로 답한다(`standalone-gui.md:817`, R29-I4).
  - `src/`, `tests/`, `scripts/`, `tsconfig*.json`, `package-lock.json`, `out/`.
  - 빼는 수단은 packager의 `--ignore`다. 정규식을 받는다(`raw/packager-v20.3.0-README.md:113`~`:115`).
  - `devDependencies`의 모듈은 기본으로 복사되지 않는다(`:109`~`:112`). GUI 패키지에는 `devDependencies`만 있다(`gui/package.json:19`~`:21`).
- 크기[추정]: 이 작업 공간의 기존 산출을 로컬에서 쟀다. 그 산출의 판은 확인하지 않았다.
  - Electron `dist` 374,391,699 bytes, `gui/build/src` 1,634,792 bytes, 루트 `dist/src` 3,539,978 bytes.
  - 그래서 압축 전 약 380 MB에 Node가 더해진다. Node 크기는 미확인이다.
  - zip 크기: README는 최소 앱의 zip이 Electron zip과 크기가 비슷하다고 적는다(`:33`~`:36`). 그러나 Electron zip의 크기 자체가 미확인이다.

## 8. 검증

1. **fuses 읽기**
   - `electron-fuses read`로 6.7의 여섯 값을 확인한다. 끔이 `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`, `GrantFileProtocolExtraPrivileges`이고, 켬이 `EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`다(`standalone-gui.md:818`~`:819`).
   - 여섯 이름은 모두 README의 `FuseV1Options`에 있다(`raw/fuses-v2.1.3-README.md:23`~`:31`).
   - README에는 6.7에 없는 fuse가 셋 더 있다: `EnableCookieEncryption`, `LoadBrowserProcessSpecificV8Snapshot`, `WasmTrapHandlers`. 이 셋의 값도 기록한다(D-6).
   - 기본값은 README에 없어 미확인이다(E-4).
2. **꾸러미 앱 확인(기준 필요, D-9)**
   - 지금 연기 시험은 제품 진입을 쓰지 않고(`standalone-gui.md:971`), 그 진입점(`build/tests`)은 꾸러미에서 빠진다. 그래서 꾸러미 앱을 확인하는 기준을 새로 정해야 한다.
   - 제안하는 확인 항목과 방법
     - 제품 진입: 시험 진입점 없이 꾸러미의 `<exe>`를 직접 시작한다. 키 없는 환경에서 점검 표시가 나오면 엔진 호스트가 준비된 것이다. 호스트가 알린 Node 판을 사람이 볼 곳이 있는지는 미확인이다.
     - `ELECTRON_RUN_AS_NODE`를 켜고 시작해도 Node로 동작하지 않는지.
     - `--inspect`, `--inspect-brk`, `NODE_OPTIONS`의 검사기가 열리지 않는지. 이것은 fuses만 막는 한계 항목이다(`:820`~`:822`).
     - `--remote-debugging-port`와 `--remote-debugging-pipe`를 주면 시작 검사가 끝내는지(`:820`, 거부 목록 `gui/src/main/security-policy.ts:49`~`:50`). Chromium 스위치가 fuses로 막히는지는 미확인이다(E-4).
     - 파일 제외: zip 목록과 `app.asar` 목록에 `build/tests`가 없는지. asar 목록을 읽는 도구와 방법은 미확인이다(packager가 데려오는 `@electron/asar`가 후보다[추정]).
     - 소켓: 앱의 모든 프로세스에 TCP 대기 소켓과 UDP 끝점이 0개이고 바깥 연결이 없는지. 연기 시험과 같은 방법, 곧 `Get-NetTCPConnection`과 `Get-NetUDPEndpoint`를 앱 프로세스 id로 거르는 방법(`gui/tests/smoke/smoke.ts:83`~`:103`)을 사람이 PowerShell에서 쓴다[설계 제안].
3. **lock 검사**: `gui`에서 `npm test`. 빌드, `check-lock`, 유닛을 한 번에 돈다(`standalone-gui.md:970`, `gui/package.json:15`).
4. **asar 무결성**
   - 바깥 연결이 없는 조건에서 `app.asar`를 1바이트 바꾼 사본으로 시작해 거부되는지 본다[설계 제안]. README 주석이 macOS라고 적으므로 Windows 결과는 이 확인으로만 안다.
   - asar 밖 파일(`resources/node`, `resources/engine`)이 바뀌었을 때 어떻게 할지는 D-7에서 정한다.
5. **공급망**
   - 설치 뒤 레지스트리 서명과 출처 증명을 `npm audit signatures`로 확인한다[추정: 이 명령이 서명과 출처 증명을 검증한다는 것은 npm 문서와 대조하지 않았다]. 이 명령이 네트워크를 쓰는지와 그 주소도 [추정]이다. 실행 전에 주소, 시점, 허용 범위를 D-3b에서 정한다.
   - Node zip과 Electron zip은 4·5절의 SHA-256과 대조한다.
6. **교차 검토**: GU-9(fuses, Node 묶기)는 구현자가 아닌 보안·개인정보 검토자의 교차 검토를 거친 뒤 main에 병합한다(`standalone-gui.md:1084`, `development-workflow.md:145`).
7. **수동 확인**
   - 다른 Windows 계정이나 PC에서 zip을 풀어 실행해 본다. 서명이 없는 상태에서 OS가 무엇을 보이는지도 관찰해 기록한다(서명 결정은 GUI-D9).
   - 산출에 든 `LICENSE`·`NOTICE` 파일을 7절의 자리와 10절의 표에 대조한다(`development-workflow.md:124`).
   - zip의 SHA-256을 기록한다.

## 9. 비용

- **금전 비용:** 조회한 원문 어디에도 가격 정보가 없다. 그래서 적지 않는다(미확인). 라이선스 조건은 10절에 있다.
- **내려받는 양**
  - 두 도구의 풀린 크기는 합해서 322,898 bytes다(2절의 `dist.unpackedSize`). tarball 크기가 아니고, 간접 의존성은 빠져 있다.
  - Node zip 크기: 미확인.
  - Electron zip: GU-1에서 이미 받았다. 다시 받는지와 그 크기는 미확인이다(5.2).
- **디스크:** `out/`이 약 380 MB에 Node를 더한 크기이고, 그 위에 zip이 있다[추정, 7절].
- **조사하지 않아 적지 않는 것:** 코드 서명 인증서, 게시 비용, 유료 도구.

## 10. 라이선스 (DR-75)

| 구성 | 라이선스 | DR-75 판정 | 배포물에 들어가나 | 고지 |
| --- | --- | --- | --- | --- |
| `@electron/packager` 20.3.0 | BSD-2-Clause | 허용(`development-workflow.md:120`) | 아니다, 빌드 도구다[산출 대조 필요] | 기록만 한다(`:124`) |
| `@electron/fuses` 2.1.3 | MIT | 허용 | 아니다 | 기록만 한다 |
| 직접 의존성(3절) | MIT, ISC, BSD-2-Clause, Apache-2.0. `graceful-fs` latest만 BlueOak-1.0.0 | BlueOak은 허용 목록 밖이라 원문을 먼저 확인한다(`:123`). 해석된 판에 들어오면 D-3b에서 판단하고, 그 전에 설치 허가로 넘기지 않는다 | 아니다 | 기록만 한다 |
| 간접 의존성 | 미확인 | lock 해석 뒤 `check-licenses.mjs`로 본다 | 아니다 | 기록만 한다 |
| Electron 45.3.1 | MIT(`gui/node_modules/electron/package.json`). Chromium 등은 `dist/LICENSES.chromium.html` | 소급하지 않음, 실제 번들 조건은 따로 확인(`:123`) | **들어간다** | `LICENSE`, `LICENSES.chromium.html`을 산출에 둔다 |
| Node 26.13.1 | 미확인(허용 주소에 원문 없음) | lock 밖이라 따로 확인(`:125`, `check-licenses.mjs:9`) | **들어간다** | `resources/node/LICENSE`에 원문 그대로 둔다[설계 제안]. 원문 확인(D-5a) 전에는 묶기(D-5b)를 허가하지 않는다 |
| Codaryn GUI | Apache-2.0(`gui/package.json:6`) | — | **들어간다** | `licenses/Codaryn/LICENSE`와 `licenses/Codaryn/NOTICE`[설계 제안]. Apache-2.0 4(d)(`LICENSE:106`~`:119`) |

- "배포물에 들어가지 않는다"의 근거는 packager가 `devDependencies`를 복사하지 않는다는 점이다(`raw/packager-v20.3.0-README.md:109`~`:112`). 실제 산출 목록과 대조한다(`development-workflow.md:124`).
- 고지 의무의 범위는 실제로 배포하는 파일로 정한다. 빌드 도구는 배포하지 않으면 고지할 대상이 없다[추정]. 다만 DR-75는 이름, 판, 출처, 라이선스를 기록하라고 한다(`:124`).

## 11. 사용자 결정 필요 목록

| 번호 | 결정 | PM 권고(초안) | 근거 |
| --- | --- | --- | --- |
| D-1 | `@electron/packager` 20.3.0 추가 | 승인. 직접 의존성 17개를 함께 데려온다는 점을 알고 승인한다 | BSD-2-Clause, 설치 스크립트 없음, 출처 증명 있음(2절). 7절이 이미 고른 도구다(`standalone-gui.md:886`) |
| D-2 | `@electron/fuses` 2.1.3 추가 | 승인 | MIT, 의존성 0, 설치 스크립트 없음(2절) |
| D-3a | lock 해석 | 승인. `--package-lock-only`로 lock만 만든다. 결과(새 패키지 목록, 실제 라이선스, 네 규칙)는 PM이 보고한다 | 간접 의존성과 실제 판은 해석 전에는 정해지지 않는다(3·3.1절) |
| D-3b | 해석된 판의 검토 결과와 설치(`npm ci`) | D-3a 보고를 보고 다시 묻는다. 허용 목록 밖 라이선스(예: `graceful-fs`가 4.2.12로 해석되면 BlueOak-1.0.0)는 DR-75 판단 없이 넘기지 않는다. 검증 명령(`npm audit signatures` 등)의 네트워크 주소·시점·허용 범위도 함께 정한다 | `development-workflow.md:123`, 3절, 8절 5항 |
| D-4a | 기존 Electron zip의 명시 위치와 SHA-256 확인 | 사용자가 5.1의 기본 캐시 경로(또는 GU-1 때 쓴 `electron_config_cache`)에서 `electron-v45.3.1-win32-x64.zip`을 찾아 `Get-FileHash -Algorithm SHA256`으로 재고, `d92d1aa4…`와 같은지 알린다. 지금 물을 수 있다 | 5.1(`get/Cache.js:8`~`:25`, `env-paths/index.js:29`), `checksums.json:40` |
| D-4b | 다시 받기, 자동 내려받기가 일어날 수 있는 실행 | 지금 묻지 않는다. 5.2의 승인 전 확인으로 packager의 인자와 주소를 정한 뒤 다시 묻는다 | 5.2, 인계 문서 65줄 |
| D-5a | Node 26.13.1 zip 내려받기와 라이선스 확인 | 승인. 주소와 SHA-256은 4절 값으로 고정한다. 받은 뒤 `LICENSE` 원문을 DR-75대로 판단한다. `.asc` 서명 확인을 할지도 정한다 | 4절. 같은 판이 이미 CP-54 핀이다(`pm-status.md` CP-54) |
| D-5b | Node 묶기 | D-5a 결과를 보고 다시 묻는다. 라이선스가 미확인인 채로 묶기를 허가하지 않는다 | 10절, `development-workflow.md:125` |
| D-6 | fuses 값과 순서 | 6.7의 여섯 값은 그대로. `strictlyRequireAllFuses: true`로 빠진 fuse를 막고, 나머지 셋은 하나씩 정한다: `LoadBrowserProcessSpecificV8Snapshot`은 끔, `EnableCookieEncryption`과 `WasmTrapHandlers`는 사용자 결정. 순서는 Node·엔진 복사(6단계) 뒤에 바꾸고 바로 읽은 다음 zip으로 묶는다 | `strictlyRequireAllFuses`(`raw/fuses-v2.1.3-README.md:64`~`:71`), "all files in place"(`:16`~`:18`). 로컬 `dist`에는 `browser_v8_context_snapshot.bin`이 없다(그 fuse를 켰을 때 영향은 [추정]) |
| D-7 | 꾸러미 앱의 엔진 배치와 asar 밖 파일의 보호 | GU-1 소유자가 `app.ts`의 세 값(엔진 경로 `:121`, `nodePath` `:122`, `hostScript` `:127`)을 asar 밖 배치(`resources/engine`, `resources/node`)에 맞춘다. SHA-256 목록을 확인한다면 목록을 둘 신뢰 위치와, 맞지 않을 때 호스트 시작을 거부할지를 함께 정한다. asar 안에 두면 asar 무결성 fuse에 기대는데, Windows에서의 효과는 미확인이다. 목록과 파일을 함께 바꿀 수 있으면 악의적 변조를 막는다고 입증하지 못한다. 이것은 남는 경계로 기록한다 | 1.1절, `app.ts:121`~`:127`, `standalone-gui.md:1071` |
| D-8a | zip 형식 | Windows에 들어 있는 도구로 zip 하나를 만들고 SHA-256을 기록한다. 새 의존성은 넣지 않는다 | GUI-D9 첫 배포 zip(`:1192`), GUI-D15 의존성 줄이기(`:1198`) |
| D-8b | 꾸러미 만들기 실행 | 지금 묻지 않는다. 5.2 확인 뒤, 정확한 주소·동작과 7절의 포함·제외 목록, 고지 배치를 함께 놓고 묻는다 | 5.2, 7절 |
| D-9 | 꾸러미 앱 확인 기준 | 8절 2항의 항목과 방법을 수동 점검 항목으로 정한다(기준 필요). 관찰하지 못한 것은 미확인으로 남긴다 | `:971`, `:820`, `gui/tests/smoke/smoke.ts:83`~`:103` |
| D-10 | GUI-D9로 미루는 것 | 그대로 미룬다: 설치 파일, 코드 서명, SmartScreen, 외부 게시, 자동 업데이트, 충돌 보고 | `:823`, `:890`, `:1192` |

- 승인은 하나씩 받는다(인계 문서 65줄).
  - 6절의 명령 순서로는 D-1·D-2 → D-3a → D-3b → D-7 → D-4a → (5.2 확인) → D-4b·D-8b → D-5a → D-5b → D-6 → D-8a → D-9 차례다.
  - D-4b와 D-8b는 5.2 확인 전에는 묻지 않는다. D-3b와 D-5b는 앞 단계 결과를 본 뒤에 묻는다.
- 이 제안의 값은 2026-11-23 조회 기준이다. 승인 시점에 latest가 바뀌었으면 그 판은 다시 조회해 표를 고친다.

## 부록 A. 근거 원문 (raw, Git 제외)

조회 요청은 25회이고 모두 curl의 종료 코드가 0이었다. 직접 의존성 문서 17개의 SHA-256은 작업 보고서에 있다.

| 파일 | 받은 주소 | SHA-256 |
| --- | --- | --- |
| `packager-latest.json` | `https://registry.npmjs.org/@electron/packager/latest` | `f71764a710821a39769b7d6cdd5f757c011b4feb8f1511f694bed695332f71a2` |
| `packager-20.3.0.json` | `https://registry.npmjs.org/@electron/packager/20.3.0` | 위와 같음 |
| `fuses-latest.json` | `https://registry.npmjs.org/@electron/fuses/latest` | `45e52efbdcef9ca6a57f42659ae342cdee6fb0d66caec59820eeda012cc06519` |
| `fuses-2.1.3.json` | `https://registry.npmjs.org/@electron/fuses/2.1.3` | 위와 같음 |
| `node-dist-index.json` | `https://nodejs.org/dist/index.json` | `cb36ee534b08ef30f63c0c8e1bff66ec143fb2ceedb26b331b58309165a4451d` |
| `node-v26.13.1-SHASUMS256.txt` | `https://nodejs.org/dist/v26.13.1/SHASUMS256.txt` | `41f4c8ff7c0634558469d6f6c8744cecf417d3fd0aed5c57b3c2c571335a62dc` |
| `packager-v20.3.0-README.md` | `https://raw.githubusercontent.com/electron/packager/v20.3.0/README.md` | `db9a1d67c47a4798a20f355aee60ae099213024b6586cdbb5e329e280bcd6769` |
| `fuses-v2.1.3-README.md` | `https://raw.githubusercontent.com/electron/fuses/v2.1.3/README.md` | `92f80f1558abb5189f5694d54f380a565dc2f67c73d217adac6d2c11ac373809` |
