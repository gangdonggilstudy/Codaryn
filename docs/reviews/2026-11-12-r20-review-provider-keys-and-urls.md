# R-20 보안 검토 보고서: SP-2(모든 알려진 키의 비밀 등록과 출력 지움)와 SP-4의 주소·출력 토큰 규칙

## 0. 이해 확인과 대상

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 읽기 전용이며 구현자가 아니다. 저장소 파일 수정·커밋은 없다(main 병합 커밋 `af3be27` 외).
- **검토 대상(고정)**: `claude/workspace-policy` = `f699599`(`.codaryn/r20-pinned.txt`)
  - `d480434` feat(cli): SP-2. 알려진 키 변수의 값을 제공자와 상관없이 비밀로 등록하고, 키 모양 검사 세 곳(S-6 파일, S-8 목표, 출력 정리)이 모든 알려진 모양과 값을 본다.
  - `f699599` feat(cli): SP-4. 설정의 `provider`, `providers.<name>`. 검토 범위는 `src/cli/security/url.ts`, `limits.ts`이고, 해석은 `settings.ts`에서 읽었다.
  - 표본으로 확인한 작성자는 `gangdonggil`이고 trailer가 없다.
- 기준: `docs/design/second-provider-facts.md`(C-1~C-15), 결정 DR-31~DR-33(`docs/work-orders/phase-4-5-design.md`), 기존 C·S 규칙(cli-contract, decisions)
- 빌드: `git archive f699599`(`.codaryn/r20/b`). typecheck 오류 4건(I-5).
- 실험
  - **실제 CLI 프로세스**(`.codaryn/r20/exp20.mjs`, `exp20e.mjs`와 주소 확인 스크립트)로 했다. 가짜 값만 썼다.
    - Anthropic 변수 값: 키 모양이 아닌 가짜 문자열
    - `OPENAI_API_KEY` 값: 키 모양이 아닌 가짜 문자열. 모양이 아니라 값으로 지우는지 보기 위해서다.
  - 모델 요청은 127.0.0.1에 띄운 Messages API 가짜 서버로만 갔다. 요청의 경로·머리글·본문을 모두 기록했다.
  - 외부 네트워크, 실제 API, 키 파일은 쓰지 않았다. 주소 확인의 남은 경우는 `127.0.0.1:9`(닫힌 포트)로만 했다.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 2 (M-1, M-2) |
| 낮음 | 2 (L-1, L-2) |
| 정보 | 6 (I-1~I-6) |

**PM 중점 항목**

| 항목 | 결과(실제 CLI, 가짜 값) |
| --- | --- |
| Anthropic 실행에서 `OPENAI_API_KEY` 값이 나가는 경로(반대도) | **찾지 못함**(I-1). 다음 어디에도 두 값이 없었다: 모델 요청 머리글(`x-api-key`는 Anthropic 값만)과 본문(파일에 든 두 값 모두 토큰), stdout·stderr, `.codaryn` 기록 전체, `report`·`report --json`·`runs --json`·`changes --json`. 명령과 명령형 검증기의 자식 환경에는 두 키 변수가 모두 없다. `openai` 실행은 어댑터 미연결로 `provider_not_implemented`(종료 7)이고 아무것도 보내지 않으며, 기록에도 두 값이 없다 |
| 키를 그 제공자의 변수에서만 읽는가 | 예. Anthropic 실행에 `OPENAI_API_KEY`만 있으면 `provider_not_configured`이고 요청은 0건이다. `doctor`의 키 항목도 `fail`이다(I-2) |
| API 주소를 task·작업 공간이 바꿀 수 없는가(C-규칙) | 지켜짐(I-3). task의 `apiBaseUrl`, `model.apiBaseUrl`, `providers`는 `invalid_task`. 작업 공간 안의 설정은 `invalid_config`. 이 넷에서 가짜 서버에 간 요청은 0건 |
| 한 제공자의 키가 다른 제공자의 주소로 가는 경로 | **있음(M-1).** `CODARYN_API_BASE_URL`이 제공자를 가리지 않는다. 설정의 제공자가 `openai`일 때도 `models`가 Anthropic 키를 그 주소로 보낸다(재현) |
| 평범한 이름이 거부되는 정도 | 12개 중 8개가 `key_in_file`(L-1). DR-32 (a)가 "SP-2 연결 전에 좁힌다"고 정한 모양이 아직 느슨하다. DR-33으로 다시 바뀔 예정임을 감안해 낮음으로 둔다 |

새로 생긴 가용성 문제도 하나 있다(M-2). 다른 제공자의 키 변수에 흔한 자리표시자 값이 있으면 관계없는 실행이 깨진다.

## 2. 재현 결과

### A. Anthropic 실행, 두 키를 모두 설정

- 대본: `read_file notes.txt` → `run_command node -e <환경 기록>` → 끝
  - `notes.txt`에 두 값이 모두 있다.
  - 검증기는 `node -e <환경 기록>`이다.

| 확인 | 결과 |
| --- | --- |
| 실행 | `done/verified`, 요청 3건 |
| 요청 머리글 | 3건 모두 `x-api-key` = Anthropic 값. 어디에도 OpenAI 값 없음 |
| 요청 본문 | 두 값 모두 없음(토큰으로 가려짐) |
| stdout·stderr·`.codaryn` 전체 | 두 값 모두 없음 |
| `report`(글·JSON), `runs --json`, `changes --json` | 두 값 모두 없음 |
| 모델 명령의 자식 환경 | `OPENAI_API_KEY`·`ANTHROPIC_API_KEY` 둘 다 없음(변수 15개만 넘어감) |
| 검증기 명령의 자식 환경 | 둘 다 없음 |

### B·C·D

| 경우 | 결과 |
| --- | --- |
| B1 Anthropic 실행, `OPENAI_API_KEY`만 | `provider_not_configured`(7), 요청 0 |
| B2 같은 조건의 `doctor` 키 항목 | `fail` |
| B3 `openai` task, 두 키, `providers.openai.apiBaseUrl` = 가짜 서버 | `provider_not_implemented`(7), 요청 0, 출력·기록에 두 값 없음 |
| C1~C3 task의 `apiBaseUrl`, `model.apiBaseUrl`, `providers` | 모두 `invalid_task` |
| C4 작업 공간 안의 설정 파일 | `invalid_config` |
| C5 작업 공간 밖 변수 파일의 `CODARYN_API_BASE_URL` | 받아들여져 그 주소로 요청한다. 사람이 고른 입력이므로 설계대로다(I-3) |
| D1 `openai` task + `CODARYN_API_BASE_URL` | `provider_not_implemented`, 요청 0 |
| **D2 설정 `provider: "openai"` + `CODARYN_API_BASE_URL` + `models`** | **가짜 서버에 `GET /v1/models` 1건, `x-api-key` = Anthropic 값**(M-1) |

### E. 다른 제공자 키 변수의 자리표시자 값(scripted 실행, 네트워크 없음)

- 파일 `app.py`의 첫 줄은 `client = OpenAI(api_key="EMPTY", base_url="http://localhost:11434/v1")  # ollama`이다.
- 대본은 둘째 줄(`mode`)만 바꾸고, `node -e`로 자식 환경을 기록한다.

| `OPENAI_API_KEY` | 결과 |
| --- | --- |
| `EMPTY` | `write_file`이 `protected_span_violation`(첫 줄에 "비밀"이 있음) → 파일 그대로, `failed/verifier_failed` |
| `ollama` | 같음 |
| `x` | 기록 곳곳의 `x`가 토큰(기록에 17개). `run_command`는 `spawn_failed`(값이 든 `PATH`가 자식에게 넘어가지 않은 것으로 보임) |

### F. 평범한 이름(task `goal`에 넣음, S-8)

- 거부(`key_in_file`) 8개
  - `sk-learn-pipeline-for-customer-churn-model-v2`
  - `sk-feature-branch-add-payment-gateway-integration`
  - `sk-0f8fad5b-d9cb-469f-a165-70867728950e`
  - `release/sk-dashboard-components-and-layout-helpers-v3`
  - `my-task-sk-(영소문자 34자, 합성한 평범한 이름이며 키가 아니다. 커밋 비밀 검사에 걸려 원문 대신 설명으로 적는다)`
  - `sk-cube-grid-animation-container-wrapper-large`
  - `docs/sk-telecom-network-migration-runbook-final`
  - `sk-ant-design-system`(Anthropic 모양)
- 통과 4개: `sk-learn`, `risk-assessment-…`, `sk_live_…`, `SK-HYNIX-…`

### 주소·출력 토큰 규칙(SP-4, url.ts·limits.ts)

| 경우 | 결과 |
| --- | --- |
| anthropic 주소가 `/v1`로 끝남 | 거부 |
| anthropic `https://h.example` | 받음 |
| openai 주소 `https://h.example/v1` | 받음 |
| openai 주소가 `/v1/responses`로 끝남 | 거부 |
| openai 주소 `http://`(루프백 아님) | 거부 |
| openai `maxOutputTokens` 15 | 거부("16 to 200000") |
| openai `maxOutputTokens` 16 | 받음 |
| anthropic `maxOutputTokens` 0 | 거부 |
| top-level 설정과 `providers.anthropic`을 함께 줌 | 거부(같은 설정 두 번) |
| anthropic 실행 + `CODARYN_API_BASE_URL`이 `/v1`로 끝남 | `invalid_config` |
| openai 실행 + `CODARYN_API_BASE_URL`이 `/v1/responses`로 끝남 | `provider_not_implemented`가 먼저라 주소 규칙에 닿지 않는다(L-2) |

## 3. 중간

### M-1 `CODARYN_API_BASE_URL`이 제공자를 가리지 않아, 한 제공자용 주소로 다른 제공자의 키가 간다

- 위치
  - `src/cli/settings.ts`(SP-4): "CODARYN_MODEL and CODARYN_API_BASE_URL apply to the chosen provider"
  - `src/cli/models.ts`: `models`는 Anthropic 설정만 읽는다("the current model is read from anthropic's settings")
- 재현(D2): 다음 조건에서 `models`를 실행했다.
  - 설정 파일의 `provider: "openai"`
  - `CODARYN_API_BASE_URL` = 가짜 서버
  - 두 키 변수 설정
  - 결과: 가짜 서버가 `GET /v1/models`를 받았고, 머리글 `x-api-key`가 **Anthropic 키**였다.
- 왜 문제인가
  - 사람은 설정의 제공자를 `openai`로 두었으므로, 환경 변수의 주소를 OpenAI용(예: OpenAI 호환 게이트웨이)으로 넣었을 수 있다. 그 주소로 Anthropic 키가 간다.
  - `run`도 같다. 주소는 환경 변수 하나인데 제공자는 task 파일(`model.provider`)이 고른다. 그래서 다른 사람이 준 task 하나가, 사람이 다른 제공자용으로 둔 주소로 어느 키를 보낼지 정한다.
  - 지금은 `openai` 어댑터가 연결되지 않아 반대 방향(OpenAI 키가 Anthropic용 주소로)은 일어나지 않는다. SP-6에서 연결되면 같은 경로가 열린다.
- 결정과의 관계: C-규칙(주소는 사용자 설정과 환경에서만)은 지켜진다. 그러나 "제공자마다 주소" 원칙(설계 4.4, SP-4의 `providers.<name>.apiBaseUrl`)과 환경 변수 하나가 어긋난다.
- 권고(하나 이상)
  - 환경 변수를 제공자별로 나눈다(예: `CODARYN_ANTHROPIC_API_BASE_URL`, `CODARYN_OPENAI_API_BASE_URL`). 지금의 `CODARYN_API_BASE_URL`은 anthropic 전용으로 고정한다(이전 동작과 같음).
  - `models`는 설정이 고른 제공자가 anthropic이 아니면 거부하거나 그 제공자 설정을 따른다.
  - `doctor`가 "이 주소로 이 제공자의 키가 간다"를 보인다.

### M-2 다른 제공자의 키 변수에 든 짧은 자리표시자 값까지 비밀로 등록돼 관계없는 실행이 깨진다

- 위치: `src/cli/run.ts`의 7단계. `currentKey.forEach(addSecret)`는 모든 알려진 키 변수의 값을 길이와 상관없이 등록한다(`value.length > 0`).
  - 비교: 파일·목표 검사(`keyValuesOf`)는 16자 미만을 찾지 않는다(`MIN_CURRENT_KEY_LENGTH`).
- 재현(E)
  - `OPENAI_API_KEY`가 `EMPTY`(vLLM 문서의 자리표시자)나 `ollama`(Ollama 문서의 자리표시자)이면, OpenAI와 관계없는 scripted 실행이 그 단어가 든 줄이 있는 파일을 고치지 못하고(`protected_span_violation`) 실패한다.
  - `x`이면 기록 곳곳의 `x`가 토큰이 되고, 허용 명령이 `spawn_failed`로 시작조차 못 한다. 값이 든 환경 변수(아마 `PATH`)를 자식에게 넘기지 않는 규칙 때문으로 보인다.
- 영향
  - 데이터 유출은 아니다. 그러나 로컬 OpenAI 호환 서버를 쓰는 개발자 환경에서 Anthropic 실행까지 이유 없이 실패한다.
  - 원인이 안내되지 않는다.
  - SP-2가 만든 새 실패 방식이다. 전에는 실행에 쓰는 키만 등록됐다.
- 권고
  - 실행의 제공자가 아닌 키 변수의 값은 `MIN_CURRENT_KEY_LENGTH`(16자) 이상일 때만 등록한다(검사와 같은 기준). 실행 자신의 키는 지금처럼 등록한다.
  - `doctor`는 다른 제공자의 키 변수에 짧은 값이 있으면 알린다.

## 4. 낮음

### L-1 실행 거부(S-6·S-8)가 아직 느슨한 OpenAI 모양을 쓴다(DR-32 (a) 순서)

- `OPENAI_KEY_PATTERN_SOURCE` = `\bsk-[A-Za-z0-9_-]{32,}`가 파일·목표 거부에 그대로 쓰인다.
- DR-32 (a)는 "모양 대조는 좁히고 느슨한 모양은 출력 가림에만 쓴다. 키 등록·가림(SP-2) 연결 전에 고친다"였다. SP-2(`d480434`)가 먼저 연결됐다.
- 재현(F): 평범한 이름 12개 중 8개 거부. 하이픈 뒤의 `sk-`(`my-task-sk-…`)와 대문자 UUID형도 걸린다.
- Anthropic 모양(`sk-ant-` 뒤 8자)도 `sk-ant-design-system` 같은 이름을 잡는다.
- DR-33의 새 모양(구분 접두사 또는 하이픈 없는 40자 이상)으로 바뀔 예정이므로 낮음으로 둔다. 바뀐 뒤 같은 12개로 다시 확인하기를 권한다.
- 출력 정리(`hideKeys`)도 같은 느슨한 모양을 써서, 보고서나 요약에 이런 이름이 나오면 지워진다. 가림 쪽이라 문제는 작다.

### L-2 `openai`의 주소 규칙이 환경 변수 경로에서 확인되지 않는다

- `openai` 실행은 `provider_not_implemented`가 주소 해석보다 먼저라, `CODARYN_API_BASE_URL`이 `/v1/responses`로 끝나도 그 규칙의 거부가 나오지 않는다.
- 설정 파일 쪽(`providers.openai.apiBaseUrl`)은 규칙대로 거부된다.
- 지금 결함은 아니다. SP-6에서 연결할 때 환경 변수 경로의 `with_version` 규칙을 시험으로 고정하기를 권한다.

## 5. 정보

- **I-1 누출 경로 없음(A)**
  - 비밀 등록과 출력 정리가 값으로 동작한다. 키 모양이 아닌 가짜 값도 모든 출구에서 지워졌다.
  - 자식 환경은 허용 목록(변수 15개) 방식이라 키 변수가 넘어가지 않는다.
- **I-2 키 읽기(B)**: `resolveApiSettings`는 그 제공자의 `keyEnv`만 읽는다(DR-31 (g)). 길이·문자로 검증하지 않는다(facts C-3).
- **I-3 주소의 출처(C)**
  - task와 작업 공간은 주소를 정할 수 없다.
  - 작업 공간 밖 변수 파일의 `CODARYN_API_BASE_URL`은 받아들인다. 사람이 고른 입력이고 S-1(작업 공간 밖)을 지키므로 설계대로다.
  - 주소 규칙은 https면 어느 호스트든 받는다(사용자 설정이므로 설계대로).
- **I-4 SP-4 설정 규칙**: 제공자별 주소 경로 규칙, 출력 토큰 범위(openai 16~), `providers.anthropic`과 top-level의 중복 거부가 계약대로 동작한다.
- **I-5 고정 커밋의 typecheck 오류 4건**
  - `src/i18n/en.ts:11`, `ko.ts:10`: 문구 누락
  - `src/i18n/params.ts:43,54`: `keyEnv` 매개변수
  - 빌드 산출물로 실험은 됐다. 병합 전에 CLI·문구 담당이 맞출 일로 보인다.
- **I-6 오류 안내 문구**: `provider_not_configured`의 고치는 법이 이 커밋에서도 `ANTHROPIC_API_KEY`를 이름으로 말한다. `openai` 실행에서도 그렇다면 잘못된 안내가 된다. 문구 담당이 중립 문구를 준비 중이라고 들었고, 사용 문서는 그 병합 뒤 다시 캡처한다(내 할 일 목록).

## 6. PM 판단 필요

- **P-1(M-1)**: 주소 환경 변수를 제공자별로 나눌지(권고), `models`의 제공자 기준을 정할지
- **P-2(M-2)**: 실행 제공자가 아닌 키 값을 16자 이상일 때만 등록할지(권고)
- **P-3(L-1)**: DR-33의 모양 변경이 SP-2보다 늦게 들어오는 순서를 받아들일지. 병합 묶음에서 DR-33을 같이 넣을지

사용자에게 물을 질문은 없다.

## 7. 실행한 것

- 읽기
  - `git show d480434`, `f699599`(요약과 diff)
  - `src/cli/security/{keys,url,limits}.ts`, `src/cli/settings.ts`의 `knownKeyValues`, `src/cli/run.ts`의 비밀 등록, `src/contracts/config.ts`의 `API_PROVIDERS`·키 모양
  - 사실 확인 문서, DR-31~DR-33
- 빌드: `git archive f699599`
- 실험(`.codaryn/r20/`)
  - `exp20.mjs`(A~F)
  - `exp20e.mjs`(자리표시자 값)
  - 주소 규칙 확인 두 개(`doctor --json`, 루프백 닫힌 포트의 `run`)
- 저장소 파일 변경과 커밋 없음(main 병합 커밋 외). 실제 API·외부 네트워크 미사용.
