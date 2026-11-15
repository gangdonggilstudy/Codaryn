# R-23 병합 전 보안 검토: CLI의 두 번째 제공자 연결 (SP-2, SP-4, SP-6, DR-34)

## 0. 이해 확인과 대상

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 읽기 전용이다.
  - 저장소 파일 수정·커밋은 없다.
  - 실험은 이 worktree의 `.codaryn/r23/` 안에서만 했다.
- **검토 대상(고정)**: `pm/bundle-2` = **`47756b4549c258fa00e9d3d7dc9d782bec57f739`**(9개 브랜치를 합친 PM 통합 트리, `.codaryn/r23/pinned.txt`)
  - 비교 기준: main = `eb3eeeb`(`.codaryn/r23/main-pinned.txt`)
- 범위의 CLI 커밋(`git log main..47756b4 -- src/cli`)
  - `d480434` SP-2 키 등록·가림
  - `89e65db` DR-32 (a)·DR-33 거부 모양
  - `f699599` SP-4 설정의 제공자
  - `6f35f03` SP-5 계약 맞춤
  - `ca485ac` DR-34 (a) 제공자별 주소·모델 변수
  - `1ae832c` DR-34 (b) 다른 제공자 키는 20자부터
  - `687e8f3` 계약에서 변수·길이 읽기
  - `5e7081d` DR-34 (c) openai 주소 규칙
  - `afa8a47` run의 OpenAI 연결
  - `e28ae9d` models의 제공자 따르기
  - `18614eb` doctor의 다른 제공자 변수 안내
- 읽은 결정과 검토: DR-31~DR-36(`docs/work-orders/phase-4-5-design.md`), R-20(`docs/reviews/2026-11-12-r20-review-provider-keys-and-urls.md`의 D2·E·F)
- 방법
  - 빌드 사본: `git -C D:\project\Codaryn archive 47756b4`를 `.codaryn/r23/src`에, `archive eb3eeeb`를 `.codaryn/r23/main`에 풀었다. `node_modules`는 이 worktree 것을 정션으로 이었다. tsc로 빌드했다(5절 I-1).
  - 실험 파일: `.codaryn/r23/exp/r23.test.mjs`(`node:test`). 결과는 `.codaryn/r23/exp/out/*.json`. 작업 공간은 `.codaryn/r23/work/`.
  - 서버: 빌드 사본의 시험 지원 가짜 서버(`fake-anthropic`, `fake-openai`, 루프백 127.0.0.1)만 썼다.
  - 키: 가짜 값만 썼다. `ANTHROPIC_API_KEY` = `cdy-fake-anth-…`(48자), `OPENAI_API_KEY` = `cdy-fake-oai-…`(47자). 키 모양이 아니다.
  - **네트워크 울타리**: 모든 CLI 프로세스에 `node --import dist/tests/support/net-guard.js`를 넣었다. 루프백이 아닌 `fetch`는 거부하고 그 origin만 기록한다. 제품의 전송은 모두 `fetch`다(`src/model/http`, `src/model/openai`, `src/model/anthropic`, `node:http(s)` 사용 없음).
  - 자식 환경: 허용 목록(PATH, PATHEXT, SystemRoot, WINDIR, ComSpec, TEMP, TMP)과 실험 변수만 넘겼다. `APPDATA`·`LOCALAPPDATA`·`USERPROFILE`·`HOME`은 빈 폴더로 돌려 기본 설정을 읽지 않게 했다.
  - 실제 API·외부 네트워크는 쓰지 않았다. 울타리 기록에 남은 `https://api.openai.com`, `https://api.anthropic.com`, `https://h.example`은 모두 연결 전에 거부된 시도다.

## 1. 요약

| 구분 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 2 (L-1, L-2) |
| 정보 | 5 (I-1~I-5) |

**PM이 짚은 점**

| 항목 | 결과 |
| --- | --- |
| 한 제공자의 키가 다른 제공자의 주소로 가는 경로(run, models, doctor) | **찾지 못했다** |
| task 파일이 제공자를 골라 사람이 다른 제공자용으로 둔 주소로 키를 보내게 할 수 있는가 | **없다** |
| OpenAI 실행에서 Anthropic 키 값이 출력·기록·요청·자식 환경에 나가는가 | **나가지 않는다** |
| 기존 Anthropic 전용 설정(provider 없음)의 동작 | **그대로다** |
| models가 설정 파일의 다른 제공자 자리를 망가뜨리는가 | **망가뜨리지 않는다** |

- **키가 다른 제공자의 주소로 가는 경로**: 실험 A·C·D·G·J.
  - run: 키는 언제나 고른 제공자의 변수 → 설정 → 기본 주소로만 간다(`resolveConnection`).
  - models: `--provider`나 설정의 provider를 따른다. 키·주소·목록기가 모두 그 제공자 것이다.
  - doctor: 요청을 보내지 않는다(가짜 서버 두 곳 모두 0건).
- **task가 제공자를 고르는 경우**: 실험 G. 네 가지 모두 키는 고른 제공자 자신의 주소(기본 주소, 울타리에서 거부)로만 갔고, 다른 제공자용 주소(가짜 서버)에는 0건이었다. `providerSettingsOf`는 다른 제공자의 설정 항목을 읽지 않는다. top-level 설정은 anthropic에만 쓰인다.
- **OpenAI 실행에서 Anthropic 키**: 실험 A.
  - 요청 3건 모두 `Authorization: Bearer <OpenAI 값>`이었다. `x-api-key`·`anthropic-version`은 없다.
  - 본문, 출력, `.codaryn`, report, runs, doctor 어디에도 두 값이 없다.
  - 명령과 검증기의 자식 환경에 키 변수 이름도 값도 없다.
- **Anthropic 전용 설정**: 실험 B·B2. main과 묶음이 같다.
  - run 요청의 머리글과 본문이 같다(토큰 id와 실행 id를 정규화한 뒤).
  - models 목록과 `--use`의 출력·요청·고친 파일이 같다.
  - doctor의 점검 id와 상태가 같다. 키 메시지에 도착 주소가 더해진 것만 다르다(DR-34 (a)의 의도된 변경).
- **models의 설정 파일**: 실험 H. 고른 제공자의 `model` 한 칸만 바뀐다. 다른 제공자의 설정, 필드 순서, CRLF는 그대로이고 키는 파일에 들어가지 않는다.

## 2. 실험 결과

### A. OpenAI task 실행, 두 키와 두 주소 변수를 모두 설정

- 대본(가짜 OpenAI): `read_file notes.txt`(두 키 값이 든 파일) → `run_command node -e <환경 탐침>` → 끝
- 검증기: `node -e <환경 탐침>`
- 환경: `CODARYN_API_BASE_URL` = 가짜 Anthropic, `CODARYN_OPENAI_API_BASE_URL` = 가짜 OpenAI

| 확인 | 결과 |
| --- | --- |
| 실행 | `done/verified`, 종료 0 |
| 가짜 OpenAI 요청 | `POST /v1/responses` 3건, 모두 `Bearer <OpenAI 값>`. Anthropic 머리글 없음 |
| 가짜 Anthropic 요청 | 0건 |
| 요청 본문, 그 밖의 머리글, stdout·stderr, `.codaryn` 전체, `report --json`, `runs --json`, `doctor --task --json` | 두 값 모두 없음 |
| 탐침 5건(명령의 도구 결과, 기록, 검증기 증거) | 키 변수 이름 없음, 가짜 키 값 없음 |

### B·B2. Anthropic 전용 설정(provider 없음), main(`eb3eeeb`)과 비교

- 설정: `{ schemaVersion, model, maxOutputTokens, apiBaseUrl }`. Anthropic 키만 설정했다(main은 OpenAI 변수를 모른다).

| 확인 | 결과 |
| --- | --- |
| run 요청 3건의 머리글·본문 | 같음 |
| run 결과 | 둘 다 `done/verified` |
| models 목록 요청(`GET /v1/models?limit=1000`, `x-api-key`, `anthropic-version`)과 `--json` 출력 | 같음 |
| `models --use 2`의 출력과 고친 설정 파일 | 같음 |
| doctor 점검 id·상태 | 같음. `api_key` 메시지만 "… send it only to http://127.0.0.1:<port> (config apiBaseUrl)"가 더해짐 |

- B의 상태 디렉터리에 `notes.txt`의 OpenAI 모양 값이 보이는 것은 B에서 그 변수를 설정하지 않았기 때문이다. 그 값은 키가 아닌 일반 글이다.

### C. R-20 D2 재실행: 설정 `provider: "openai"` + `CODARYN_API_BASE_URL`(가짜 Anthropic) + models

| 경우 | 가짜 Anthropic | 가짜 OpenAI | 울타리 |
| --- | --- | --- | --- |
| C1 설정에 `providers.openai.apiBaseUrl` | 0 | `GET /v1/models`, `Bearer <OpenAI>` | 없음 |
| C2 OpenAI 주소 없음 | 0 | 0 | `https://api.openai.com`(OpenAI 기본 주소 시도, 거부) |
| C3 `--provider anthropic` | `GET /v1/models?limit=1000`, `x-api-key` = Anthropic | 0 | 없음 |
| C4 run 간편 형식, provider openai, Anthropic 주소만 | 0 | — | `https://api.openai.com` |

- R-20 M-1(Anthropic 키가 OpenAI용 설정에서 Anthropic 주소로 감)은 재현되지 않는다.

### D. doctor

| 경우 | 결과 |
| --- | --- |
| D1 두 주소 변수 | JSON `api_key`: "OPENAI_API_KEY is set; openai requests send it only to http://127.0.0.1:<port> (CODARYN_OPENAI_API_BASE_URL)". 사람용 글: "OPENAI_API_KEY is set (its value is not looked at)" — **도착 주소 없음**(L-1) |
| D2 Anthropic 주소만 | JSON: "… only to https://api.openai.com (the default address)". 사람용 글은 D1과 같음 |
| D3 `--task`(anthropic) + 설정 provider openai | JSON: "ANTHROPIC_API_KEY is set; anthropic requests send it only to http://127.0.0.1:<port> (CODARYN_API_BASE_URL)". task의 제공자를 따른다 |
| 요청 | 가짜 서버 두 곳 모두 0건. 출력에 키 값 없음 |

### E. R-20 E 재실행: 다른 제공자 키 변수의 자리표시자

- `app.py` 첫 줄: `client = OpenAI(api_key="EMPTY", base_url="http://localhost:11434/v1")  # ollama`
- Anthropic 실행: 대본은 읽기 → 둘째 줄 `mode` 바꾸기(`replace_all`) → `node -e` 탐침.

| `OPENAI_API_KEY` | 결과 |
| --- | --- |
| `EMPTY` | `done/verified`. 파일이 바뀜. 기록의 토큰 0. `protected_span_violation` 없음. 명령 시작 정상 |
| `ollama` | 같음 |
| `x` | 같음 |
| E2(반대): OpenAI 실행, `ANTHROPIC_API_KEY` = `x` | 토큰 0, 명령 정상(검증기 실패는 내 시험 파일 규칙 탓이라 판정에 쓰지 않음) |

- R-20 M-2는 재현되지 않는다(DR-34 (b) `1ae832c`).

### F. R-20 F 재실행: task `goal`의 평범한 이름(S-8). 각 이름 하나씩 Anthropic 실행

| 입력 | 결과 |
| --- | --- |
| R-20 F에서 거부되던 OpenAI 쪽 평범한 이름 7개(`sk-` + `learn-pipeline…`, `sk-` + `feature-branch…`, `sk-` + 소문자 UUID, `release/sk-` + `dashboard…`, `my-task-sk-` + 영소문자 34자, `sk-` + `cube-grid…`, `docs/sk-` + `telecom…`) | 모두 통과(`needs-input/no_verifier`, 요청 1) |
| 더한 것: `feature/sk-` + 대문자·숫자 32자 + `-v2`, `build-SK-` + 대문자·숫자 32자 | 통과 |
| R-20에서 통과하던 것: `sk-learn`, `SK-HYNIX-…` | 통과 |
| **`sk-ant-` + `design-system`**(평범한 이름, "Ant Design" 라이브러리) | **`key_in_file` 거부, 요청 0**(L-2) |
| 대조: `sk-` + `proj-` + 영숫자 24자 | `key_in_file` 거부(맞음) |
| 대조: `sk-` + `ant-` + `api03-` + 영숫자 36자 | 거부(맞음) |
| 대조: `sk-` + 접두사 없는 영숫자 40자(숫자·대소문자) | 거부(맞음) |

### G. task가 다른 제공자를 고름(사람은 한 제공자용 주소만 둠)

| 경우 | 가짜 Anthropic | 가짜 OpenAI | 울타리 |
| --- | --- | --- | --- |
| G1 설정 top-level `apiBaseUrl`(anthropic) + task `openai` | 0 | 0 | `https://api.openai.com` |
| G2 `CODARYN_API_BASE_URL` + task `openai` | 0 | 0 | `https://api.openai.com` |
| G3 설정 `providers.openai.apiBaseUrl` + task `anthropic` | 0 | 0 | `https://api.anthropic.com` |
| G4 `CODARYN_OPENAI_API_BASE_URL` + task `anthropic` | 0 | 0 | `https://api.anthropic.com` |

- 키는 다른 제공자용으로 둔 주소에 한 번도 가지 않았다. 고른 제공자 자신의 기본 주소로만 가려 했다(I-3).

### H. models `--use`와 설정 파일(각 경우 `--use 1`)

| 경우 | 바뀐 칸 | 그 밖 |
| --- | --- | --- |
| H1 provider openai, top-level anthropic 칸 + `providers.openai`, CRLF | `providers.openai.model`만 | top-level anthropic 칸·`limits`·순서 그대로, CRLF 유지 |
| H2 같은 파일(4칸 들여쓰기), `--provider anthropic` | top-level `model`만 | `providers.openai` 그대로 |
| H3 `providers.anthropic` + `providers.openai`, `--provider anthropic` | `providers.anthropic.model`만 | `providers.openai` 그대로 |
| 세 경우 모두 | 파일에 키 값 없음 | |

- 다른 자리 보호 장치
  - `withModel`은 고른 자리 한 칸만 바꾼다.
  - 쓰기 전에 `parseConfig`로 검증하고, 모든 키 값(`knownKeyValues`)이 파일 글에 없는지 본다.
  - 모델 id는 `WRITABLE_MODEL_ID`이고 키를 담지 않아야 한다.

### J. 주소 규칙의 환경 변수 경로(DR-34 (c))

| 변수와 값 | 결과 |
| --- | --- |
| `CODARYN_OPENAI_API_BASE_URL` = `https://h.example/v1/responses` | `invalid_config`, 시도 없음 |
| … = `http://h.example/v1`(루프백 아님) | `invalid_config` |
| … = `https://user:pw@h.example/v1` | `invalid_config` |
| … = `…/v1?x=1`, `…/v1#f` | `invalid_config` |
| … = `https://h.example/v1` | 받아들임(울타리에서 거부) |
| … = `https://h.example`(버전 경로 없음) | 받아들임(I-4) |
| … = `http://127.0.0.1:9/v1` | 받아들임(닫힌 포트) |
| `CODARYN_API_BASE_URL` = `https://h.example/v1` | `invalid_config` |
| … = `http://h.example` | `invalid_config` |
| … = `https://h.example` | 받아들임 |

### K. 사람용 doctor(묶음에 문구가 없는 id가 쓰일 자리)

- 설정 provider openai + `CODARYN_API_BASE_URL`·`CODARYN_MODEL` 설정
  - 사람용 글(en·ko)은 예외 없이 나온다. 모델 줄은 `doctor.model.ok` 글 그대로다.
  - "CODARYN_MODEL is set but is anthropic's; an openai run does not read it" 같은 안내는 JSON 메시지에만 있다(L-1).

### I. 다른 제공자 키 값이 16~19자일 때(정보 I-2)

- Anthropic 실행, `OPENAI_API_KEY` = 18자 가짜 값, 그 값이 든 파일을 읽음
  - 요청 본문과 기록에 그대로 있다. 실행의 비밀로 등록하지 않으므로 DR-34 (b)대로다.
  - run의 stdout과 report 글에서는 가려진다(출력 가림은 16자부터).

## 3. 낮음

### L-1 doctor의 사람용 글이 "키가 어느 주소로 가는지"와 "다른 제공자의 변수는 읽지 않는다"를 보이지 않는다

- 위치
  - `src/cli/doctor.ts:600-608`: JSON 메시지에는 도착 origin과 출처를 넣는다. 사람용 글의 id는 여전히 `doctor.api_key.ok`(`{keyEnv}`만)이다.
  - 모델 줄도 `doctor.model.ok`를 쓴다. 다른 제공자 변수 안내(`18614eb`)는 JSON 메시지에만 붙는다.
- 계약과 카탈로그: 묶음의 계약(`src/contracts/human.ts:543-547`)에는 `doctor.api_key.sends_to_env`·`sends_to_config`·`sends_to_default`(origin 매개변수), `address_invalid`, `doctor.model.other_provider_variable`가 있다. 그러나 카탈로그(`src/i18n/en.ts`·`ko.ts`)에 글이 없다(I-1). CLI는 그 id를 쓰지 않는다.
- 재현: D1·D2·K
  - JSON에는 "… send it only to http://127.0.0.1:<port> (CODARYN_OPENAI_API_BASE_URL)"이 있다.
  - 사람용 글은 "OPENAI_API_KEY is set (its value is not looked at)"뿐이다.
- 영향
  - 키가 다른 주소로 가지는 않는다. 그러나 DR-34 (a)("doctor는 어느 제공자의 키가 어느 주소로 가는지 보인다")와 DR-36 (b)가 사람이 보는 글에는 아직 닿지 않았다.
  - 다른 제공자용으로 둔 주소·모델 변수가 이번 실행에 쓰이지 않는다는 것도 글로는 알 수 없다. 사람이 주소를 잘못 둔 것을 doctor로 알아채기 어렵다.
- 권고
  - N-B가 다섯 id의 글을 채운다.
  - CLI가 `doctor.api_key.sends_to_*`·`address_invalid`·`doctor.model.other_provider_variable`를 사람용 글에 쓴다.
  - 같은 설정으로 글과 JSON을 대조하는 시험을 둔다.

### L-2 Anthropic의 실행 거부 모양이 아직 넓어 평범한 이름을 거부한다(DR-36 (c) 미반영)

- 위치: `src/contracts/config.ts:297` `ANTHROPIC_KEY_PATTERN_SOURCE = "sk-ant-[A-Za-z0-9_-]{8,}"`를 그대로 실행 거부(`API_KEY_PATTERN_SOURCES`, `src/cli/security/keys.ts` `KEY_REFUSAL_SHAPE_SOURCE`)에 쓴다.
- 재현(F): goal에 `sk-ant-` + `design-system`(20자)을 둔 task가 `key_in_file`로 거부되고 요청 0이다. 같은 묶음에서 OpenAI 쪽 평범한 이름 9개는 모두 통과한다(DR-33 `89e65db` 반영).
- 결정: DR-36 (c)는 거부용 모양을 "`sk-ant-` 뒤 32자 이상이고 숫자가 들어 있을 때"로 좁히고, 출력 가림용은 그대로 두기로 했다. 이 묶음에는 아직 없다.
- 영향: 잃거나 드러나는 것은 없다(거부 쪽). "Ant Design" 같은 이름을 쓰는 작업이 시작되지 않는다.
- 권고: DR-36 (c)를 반영한다. 고정 시험에서 바뀌는 곳을 커밋 메시지에 적는 조건(DR-36 (c))도 함께 지킨다.

## 4. 정보

- **I-1 이 고정 판은 typecheck가 실패한다(병합 조건).**
  - `src/i18n/en.ts`·`ko.ts`(MessageTexts에 없는 id 5개: `doctor.api_key.address_invalid`, `doctor.api_key.sends_to_config`, `doctor.api_key.sends_to_default`, `doctor.api_key.sends_to_env`, `doctor.model.other_provider_variable`)
  - `src/i18n/params.ts`(새 매개변수 종류 `apiOrigin` 등의 표본)
  - 빌드 산출물은 나오고 실험은 그 산출물로 했다. main 병합 전에 N-B 글이 필요하다.
- **I-2 다른 제공자 키의 두 기준이 다르다.**
  - 실행 비밀 등록은 20자부터다(`MIN_OTHER_PROVIDER_KEY_LENGTH`, DR-34 (b)).
  - 파일 거부(S-6)·출력 가림의 값 대조는 16자부터다(`MIN_CURRENT_KEY_LENGTH`).
  - 그래서 16~19자 값은 출력에서는 가려지고 파일에 있으면 거부되지만, 실행의 요청과 기록에는 평문으로 간다(실험 I).
  - 실제 키는 이보다 훨씬 길어 실질 위험은 낮다. 기준을 하나로 맞추거나 계약 주석에 두 기준을 적을 것을 권한다.
- **I-3 task가 제공자를 고르면 그 제공자로 간다.**
  - 주소는 그 제공자 것만 쓰이므로 키가 다른 곳으로 가지 않는다(G).
  - 그러나 사람이 다른 도구용으로 둔 키(예: `OPENAI_API_KEY`)가 있으면, 남이 만든 task 하나로 작업 공간 내용이 그 제공자에게 간다.
  - 사람이 보는 것은 진행 줄의 "run started — provider openai"와 `doctor --task`뿐이다.
  - 설계(SP-D10, task의 `model.provider`)대로이며, 확인 질문이나 허용 목록을 둘지는 PM 판단이다.
- **I-4** OpenAI 주소 변수가 버전 경로 없이(`https://h.example`) 들어와도 받아들인다(J). 같은 호스트이므로 키가 다른 곳으로 가지는 않는다. 이 경우 요청 경로는 `/responses`가 된다. 의도(OpenAI 호환 서버)인지 확인만 필요하다.
- **I-5 R-20 재현의 현재 상태**
  - D2(M-1): 막힘(C)
  - E(M-2): 막힘(E·E2)
  - F: OpenAI 쪽 막힘, Anthropic 쪽 1건 남음(L-2)
  - L-2(R-20, openai 주소 규칙의 환경 변수 경로): 막힘(J)

## 5. PM 판단 필요

- P-1(I-1, L-1): N-B 글이 들어온 판으로 병합할지, 지금 판을 병합하고 L-1을 뒤로 둘지
- P-2(I-3): task가 고른 제공자가 설정의 제공자와 다를 때 사람에게 묻거나 막을지(지금은 진행 줄과 doctor로만 보인다)
- P-3(I-2): 16자·20자 두 기준을 하나로 할지

## 6. 실행한 것

- 읽기
  - `src/cli/settings.ts`(`knownKeyValues`, `runKeySecrets`, `providerSettingsOf`, `resolveApiSettings`, `resolveConnection`, `keyDestination`, `resolveListSettings`)
  - `src/cli/run.ts`(비밀 등록 650행 부근, 제공자 생성 670행 부근, 파일 위치 확인 610행 부근)
  - `src/cli/models.ts`(제공자 선택, `withModel`, 쓰기 검사)
  - `src/cli/doctor.ts`(키·모델 점검)
  - `src/cli/security/keys.ts`, `src/cli/text-safety.ts`
  - `src/contracts/config.ts`(`API_PROVIDERS`, 키 모양, 두 길이 기준), `src/contracts/human.ts`의 doctor id
- 시험 파일: `.codaryn/r23/exp/r23.test.mjs`. 마지막 전체 실행에서 A~K 각 경우를 돌렸고 결과는 `out/A.json`~`out/K.json`, `E2-I.json`이다.
- 확인하지 않은 범위
  - 실제 OpenAI·Anthropic API: 규칙대로 부르지 않았다.
  - OpenAI 어댑터 내부(401·403 문구, 추론 항목, 크기 상한): R-22 범위
  - `init`(DR-36 (d), Anthropic 설정만)
  - 터미널 질문 경로(`models`의 대화형 고르기)
  - macOS·Linux

## 7. 정리

- 저장소 파일 변경과 커밋 없음.
- 실험물: `.codaryn/r23/`(빌드 사본 `src`·`main`, 실험 `exp`, 작업 공간 `work`)
- 지울 때는 정션 `src/node_modules`, `main/node_modules`를 먼저 `rmdir`로 끊고 폴더를 지운다(정션을 따라 이 worktree의 `node_modules`를 지우지 않게).
