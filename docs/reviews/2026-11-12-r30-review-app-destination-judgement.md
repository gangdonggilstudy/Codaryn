# R-30 병합 전 검토: 앱 계층의 추가 수정 (pm/bundle-4)

## 0. 대상과 방법

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 읽기 전용이다. 저장소 파일 수정과 커밋은 없다.
- **검토 대상(고정)**: `pm/bundle-4` = `700fa3524e443dbd8dc393253b422ba6af1f6a61`
  - main `5701ebe`에 claude/gui-design `25ca5af`, claude/adapter-gui-findings `cf6d910`, claude/revert-store `1adb605`를 합친 판이다.
- 범위(`git log main..pm/bundle-4 --no-merges -- src/app tests/unit`)
  - `cf6d910` fix(app): judge an address by where runs send, and name a profile's provider change (R-27 I1, I4)
  - `9106daa` fix(app): the GUI's settings reading has the CLI's config file size cap (DR-42 (d))
  - 담당 보고 `claude-adapter/.codaryn/report-A-9.md`를 대조했다.
- 중점
  - "목적지가 바뀌지 않는다"는 판정(`wideningOf`의 `api_base_url_changed`, `provider_changed`)이 CLI의 실제 주소 해석과 정확히 같은지
  - 크기 상한이 CLI와 같은 값·같은 거부 코드인지, 거부 문구에 값이 없는지
- 빌드: `git archive 700fa35` → 내 worktree의 `.codaryn/r30/b`, `tsc`(오류 0).
- 실험
  - `.codaryn/r30/exp30.mjs`: 차등 실험(순수 함수)
  - `exp30-e2e.test.mjs`: 그 판의 실제 CLI, net-guard, 127.0.0.1 가짜 서버
  - `exp30-size.mjs`: 크기 상한
  - `exp30-mutant.mjs`: 방어를 지운 판정으로 실험의 검출력을 확인. 순수 함수뿐이라 바깥으로 나갈 수 없다.
- 실제 API·외부 네트워크는 쓰지 않았다.
  - 요청은 127.0.0.1의 가짜 서버로만 갔다.
  - 닿지 않는 주소는 닫힌 포트 `127.0.0.1:9`를 썼다.
  - `proxy.example` 같은 이름은 순수 함수의 문자열로만 썼고, 그 주소로 실행하지 않았다.

## 1. 요약

- 높음 0, 중간 0, 낮음 1, 정보 4.
- **앱 계층이 "목적지 그대로"라고 판정하는데 CLI가 다른 곳으로 보내는 경우는 찾지 못했다**(차등 실험 0건, 2.1).
  - 앱의 판정은 CLI 자신의 함수를 쓴다: `providerSettingsOf`, 계약의 `defaultApiBaseUrl`, `parseConfig`의 주소 정규화.
  - 실제 CLI의 요청도 해석한 주소에 닿았다(2.2).
- 크기 상한은 앱·CLI `run`·`doctor`가 같은 값, 같은 코드(`invalid_config`), 같은 고정 문구다. 문구에 파일의 값이 없다(2.3).
- 낮음 1건은 앱이 아니라 CLI `models`(내 코드)다. 정확히 상한인 파일에 BOM이 붙으면 `models`만 거부한다.

## 2. 재현 결과

### 2.1 차등 실험 (`exp30.mjs`)

- 설정을 다섯 축으로 조합했다. 2,688개 모두 `parseConfig`를 지났다.
  - Anthropic 주소 28가지
    - 없음
    - 최상위의 기본 주소: 그대로, 끝 `/`, 대문자, `:443`
    - 사용자 주소: 끝 `/`, 대소문자와 `:443`, 다른 포트, `08443`, 경로, 경로 대소문자, 경로 끝 `/`·`//`, `./`·`../`, `%70`, 끝 점, IDN과 그 punycode
    - 루프백: `127.0.0.1`, `localhost`, `[::1]`
    - `providers.anthropic`: 주소, 대소문자, 기본, 빈 항목, 경로
  - OpenAI 주소 8가지
    - 없음
    - 기본 주소: 그대로, 끝 `/`, 대문자와 `:443`
    - 게이트웨이: 그대로, `/V1`, 버전 없음
    - 루프백
  - 설정의 `provider` 3가지(없음, anthropic, openai)
  - 프로필 4가지(없음, `p` openai, `p` anthropic, `p` 제공자 없음)
- 모든 순서쌍 7,222,656개에서 앱의 `wideningOf`를 CLI의 실제 해석과 비교했다.
  - CLI의 해석: 세 가지 환경(주소 변수 없음, `CODARYN_API_BASE_URL`, `CODARYN_OPENAI_API_BASE_URL`)마다 제공자별 `resolveConnection`의 주소를 본다.
  - 간편 실행의 제공자: `quickProvider`, 그리고 `--profile p`일 때 `selectProfile` 뒤의 `quickProvider`
- 결과

  | 구분 | 쌍 |
  | --- | --- |
  | 앱이 모든 주소가 그대로라고 본 쌍 | 325,632 |
  | **그중 CLI가 다른 곳으로 보내는 쌍(위험)** | **0** |
  | 앱이 제공자 그대로라고 보는데 CLI 간편 실행의 제공자가 다른 쌍(프로필 포함) | 0 |
  | 앱이 바뀜이라 했는데 CLI가 모든 환경에서 같은 곳으로 보내는 쌍 | 0 |

- 검출력(`exp30-mutant.mjs`): 방어를 지운 두 판정은 같은 방법으로 위험을 낸다.
  - M1: 최상위 주소만 비교 → 26쌍
  - M2: 프로필의 제공자를 보지 않음, R-27 I4 이전 → 2쌍

### 2.2 실제 CLI (`exp30-e2e.test.mjs`, 3건 통과)

- Anthropic: 앱이 같다고 보는 다섯 표기가 모두 가짜 서버 A의 `/v1/messages`에 닿았다.
  - 표기: `http://127.0.0.1:P`, 끝 `/`, 대문자 스킴, `/x/../`, `providers.anthropic`의 끝 `//`
  - 다른 서버 B로는 0건, net-guard 기록 없음.
  - 경로나 포트가 다르면 앱은 바뀜이라 하고, 요청은 B의 `/proxy/v1/messages`에 닿았다.
- 주소 변수는 자기 제공자에만 이긴다: 설정은 A, `CODARYN_API_BASE_URL`은 B → B에 1건, A에 0건.
- OpenAI: 가짜 서버 주소 그대로와 끝 `/`가 모두 `/v1/responses`에 닿았다.

### 2.3 크기 상한 (`exp30-size.mjs`)

| 파일 | 앱 `readSettings` | CLI `run` | CLI `doctor` | CLI `models` |
| --- | --- | --- | --- | --- |
| 정확히 1,048,576바이트 | 읽음 | 읽음(그 뒤 한도 없음으로 멈춤) | 읽음 | 읽음(키 없음으로 멈춤) |
| 1바이트 넘음 | 거부 | 거부 | 거부(fail) | 거부 |
| 바이트로 넘고 글자로는 절반(2바이트 é) | 거부 | 거부 | 거부 | 거부 |
| 정확히 상한 + BOM | 읽음 | 읽음 | 읽음 | **거부** |

- 거부는 모두 `invalid_config`이고 같은 고정 문구다: "the config file is larger than 1048576 bytes (1 MiB); nothing in it was used". 파일의 값은 어느 문구에도 없었다.
- 상한을 넘는 설정 변경(`proposeSettingsChangeIn`): `invalid_config`, 같은 문구. 아무 파일도 쓰지 않았다.
- 앱은 CLI의 `inputFileTooLarge`·`inputFileTooLargeMessage`를 그대로 불러 쓴다. 값과 문구가 같은 이유다.
- 묶음의 시험(`settings-widening-precision`, `settings-size`와 다른 settings 시험): 29건 통과.

## 3. 낮음

### R30-L-1 CLI `models`만 BOM을 빼기 전에 크기를 재서, 정확히 상한인 설정 파일에 BOM이 붙으면 거부한다 (내 코드 `d202122`)

- 위치: `src/cli/models.ts`. `configText`에 `inputFileTooLarge`를 적용한 뒤 BOM을 뺀다.
  - `run.ts`, `doctor.ts`(`loadJson`), 앱(`readSettingsIn`)은 BOM을 먼저 뺀다.
- 재현: 2.3 표의 마지막 줄. 같은 파일을 `run`·`doctor`·앱은 읽는데 `models`만 `invalid_config`다.
- 영향: 상한 바로 아래의 설정 파일에서만 나는 명령 간 불일치다. 값 노출은 없다. 앱 계층의 판정과는 무관하다(앱은 `run`과 같다).
- 권고(담당: CLI, 나): `models`도 BOM을 뺀 글로 잰다. 재현 시험을 먼저 넣는다.

## 4. 정보

- **I-1 환경 변수는 판정 밖이다.**
  - 앱의 판정은 설정 파일만 본다(R-27 I3, 계약 서술). 주소 변수가 있으면 설정 주소를 바꿔도 실제 목적지는 그대로라 "바뀜"은 보수적 판정이다.
  - 반대 방향(그대로라 했는데 다른 곳)은 차등 실험의 세 환경 모두에서 0건이었다.
- **I-2 같은 호스트의 다른 표기는 "바뀜"이다.**
  - 예: `localhost`와 `127.0.0.1`, 끝 점, `%70`.
  - CLI도 다른 문자열로 보내므로 판정은 CLI와 같다. 네트워크에서 같은 곳일 수는 있지만 보수적인 쪽이다.
- **I-3 R-27 I4(프로필의 제공자)**: `--profile p`의 간편 실행 제공자가 바뀌는 쌍은 모두 `provider_changed`였다(2.1, 위험 0). 프로필 제공자를 보지 않는 판정은 2쌍을 놓친다(M2).
- **I-4 빌드**: 이 판은 `tsc` 오류 0이다. GUI 유닛·연기 시험은 범위 밖이라 돌리지 않았다.

## 5. 실행한 것

- 읽기
  - `git -C D:\project\Codaryn diff main...pm/bundle-4 -- src/app`
  - `git show cf6d910`, `git show 9106daa`
  - `pm/bundle-4:src/app/settings.ts`, `settings-change.ts`
  - `report-A-9.md`
- 빌드: `.codaryn/r30/b`(`700fa35`)
- 실험(모두 `.codaryn/r30/`): `exp30.mjs`(35 s), `exp30-e2e.test.mjs`(3건), `exp30-size.mjs`, `exp30-mutant.mjs`
- 묶음의 settings 시험 29건
- 저장소 파일 수정·커밋 없음. 실제 API·외부 네트워크 미사용.
