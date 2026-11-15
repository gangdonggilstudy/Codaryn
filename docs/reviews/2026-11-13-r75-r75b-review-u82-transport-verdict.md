# R-75 검토: U-82 전송 층의 재시도 판정을 결과에 남김 (DR-68)

- 검토자: 검증 엔지니어 (w3:p4, ne-verify). 읽기 전용. 저장소 수정·커밋 없음.
- 실제 API·외부 네트워크 없음.
  - 가짜 서버와 닫힌 포트는 모두 127.0.0.1이다. 닫힌 포트는 이 스크립트가 묶었다가 닫은 포트다.
  - CLI 호출에는 net guard(`dist/tests/support/net-guard.js`)를 `--import`로 얹었다. 거부 기록은 0이다.
  - 키는 지어낸 값이고 보고서에는 적지 않는다.
- 결론: 판정 자체는 두 제공자 모두 사실과 맞다. 전송 동작(요청 수, 대기)과 retryable 밖의 출력은 main과 같다.
- 다만 `models`의 오류 JSON과 앱 계층(GUI)의 모델 목록 오류는 그 판정을 받지 못한다(M1).

## 검토한 해시

| 대상 | 해시 |
|---|---|
| main | `819d839` |
| 고정 판 `pm/unit-U-82` | `997e866` (`git diff 819d839 997e866`, 10파일 +253 −76) |
| 단위 커밋 | `46df5db` (계약), `c372c33` (어댑터), `07c5e66` (엔진) |

## 수치 (고정 판 `997e866`, 프로젝트 스크립트)

| 항목 | 결과 | 기록 |
|---|---|---|
| `npm run test:unit` | tests 2716, pass 2712, fail 0, skipped 3, todo 1 (exit 0) | `.codaryn/r75/unit-b.log` |
| `npm run test:integration` | tests 559, pass 559, fail 0 (exit 0) | `.codaryn/r75/integration-b.log` |
| 루트 `npm run build` (main, 판) | 둘 다 exit 0 | `build-m.log`, `build-b.log` |

PM의 수치(유닛 2716 중 2712 통과·0 실패, 통합 559)와 같다.

## 심각도

| 높음 | 중간 | 낮음 | 정보 |
|---|---|---|---|
| 0 | 1 | 2 | 5 |

---

## PM이 볼 것 (1)~(6)

### (1)(2) 판정이 사실과 맞는가, 두 제공자 모두

- 방법: `.codaryn/r75/adapters.mjs`, 기록 `ADAPTERS.log`.
  - 두 판(`m`, `b`)의 빌드된 어댑터 모듈을 직접 불렀다. 두 제공자 × 요청(`complete`)과 모델 목록(`list`) = 4묶음, 모두 116사례다.
  - 가짜 서버는 127.0.0.1에 하나 두었다. 응답마다 `connection: close`를 붙였다.
  - `maxRetries`는 2다. `sleep`은 기록만 하고 기다리지 않았다.
- 결과: 기대가 정해진 112사례가 모두 맞다. 나머지 4사례는 아래 "알 수 없는 전송 실패" 줄이다.

| 경우 | Anthropic | OpenAI | 기대 |
|---|---|---|---|
| 닫힌 127.0.0.1 포트(ECONNREFUSED) | true | true | true |
| 응답 없이 끊김(UND_ERR_SOCKET), 주입한 ECONNRESET | true | true | true |
| HTTP 400, 401, 403, 404, 413, 422 | false | false | false |
| HTTP 408, 409, 429, 500, 502, 503, 529 | true | true | true |
| 429 + Retry-After 1 | true | true | true |
| 429 할당량(type `insufficient_quota`, code 4종 `credit_balance_exhausted`·`organization_spend_limit_exceeded`·`project_spend_limit_exceeded`·`organization_usage_limit_exceeded`) | — | false (`quota_exhausted`) | false |
| 429 `slow_down` | — | true | true |
| 200인데 JSON 아님(응답 꼴) | false | false | false |
| 거절(Anthropic `stop_reason refusal`, OpenAI refusal 조각, `incomplete: content_filter`) | false | false | false |
| 시간 초과(서버가 답하지 않음, 300 ms) | true | true | true |
| 주입한 TLS 실패(CERT_HAS_EXPIRED), 형식 거부(TypeError, 코드 없음) | false | false | false |
| 보내는 중 취소, 보내기 전 취소 | 없음 | 없음 | 없음 |
| OpenAI 응답 `failed`, `cancelled`, `incomplete`(다른 이유) | — | 없음 | 없음 |
| 어댑터 자신의 catch("unexpected provider failure", `UNEXPECTED.log`) | 없음 | 없음 | 없음 |
| 알 수 없는 전송 실패(TypeError가 아닌 오류, 코드 없음) | **false** | **false** | PM: 없음 (L2) |

- 목록(`list`)도 요청과 같은 판정이다. 거절과 OpenAI 응답 상태는 요청에만 있는 사례다.

### (3) 결과의 `modelError.retryable`, `models`의 오류 JSON, `config_write_failed`

- 방법: `.codaryn/r75/cli.mjs`, 기록 `CLI.log`, 정규화한 출력 `cli-out/`.
  - 두 판의 CLI를 같은 가짜 서버에 대고 돌렸다(비동기 spawn).
  - 사례: Anthropic 6가지, OpenAI 6가지.
  - 본 출력: `run --json`, `run`(사람용, ko·en), 실행 기록 `result.json`·`journal.jsonl`, `report --json`, `report`(ko), `models --json`, `models`(ko·en), `init`의 `config_write_failed`.

| 사례 | 판 `run --json`의 modelError | main | 판 `models --json` retryable | main |
|---|---|---|---|---|
| Anthropic 닫힌 포트 | `{"kind":"api_error","turn":1,"retryable":true}` | retryable 없음 | **없음** | 없음 |
| Anthropic 500 / 529 | true / true (`overloaded`) | 같음 | true / true | 같음 |
| Anthropic 400 | false | 같음 | false | 같음 |
| Anthropic 200 JSON 아님 | false (`malformed_response`) | 같음 | false | 같음 |
| Anthropic 거절 | `api_error`, **false** | retryable 없음 | — | — |
| OpenAI 닫힌 포트 | true | retryable 없음 | **없음** | 없음 |
| OpenAI 500 / 400 | true / false | 같음 | true / false | 같음 |
| OpenAI 429 할당량 | false (`quota_exhausted`) | 같음 | false | 같음 |
| OpenAI 200 JSON 아님 | false | 같음 | false | 같음 |
| OpenAI 응답 `failed` | `api_error`, 없음 | 같음 | — | — |

- 실행 결과는 판정을 따른다. `run`의 stdout, `result.json`, `report --json`의 `result`가 같다.
- **`models --json`은 따르지 않는다**(M1). 앱 계층의 `listModels`(GUI가 부르는 것)도 같다.
  - `APP-MODELS.log`: 닫힌 포트에서 두 판, 두 제공자 모두 `model_list_failed`, retryable 없음.
  - 같은 앱 계층에서 500은 두 판 모두 true다.
- **`config_write_failed`:** `init --config "<폴더>/bad<name.json"`(시스템이 거부하는 이름)으로 냈다.
  - 판: `{"…","code":"config_write_failed",…,"category":"environment"}`. retryable이 없다.
  - main: 같은 줄 끝에 `"retryable":false`가 있다.
  - 사람용 출력은 두 판이 같다.

### (4) retryable 말고는 main과 같은가

- `CLI.log` 끝 줄 "other differences (not retryable): 0".
- 정규화한 출력을 줄 단위로 비교했다. 정규화 대상은 실행 id, ISO·지역 시각, `durationMs`, 걸린 초, 임시 경로, 포트다.
- 다른 줄 15개는 모두 `"retryable"` 키 하나만 다르다.
  - 닫힌 포트 두 사례: `run --json`, `result.json`, `report --json`, 그리고 사람용 실행이 터미널이 아닐 때 stdout에 내는 결과 JSON
  - Anthropic 거절 사례: 같은 출력들
- 그 밖의 결과 JSON, 오류 JSON, `journal.jsonl`(`model_error` 기록 포함), 사람용 출력(ko·en의 `run`·`report`·`models`), 종료 코드는 모두 main과 같다.
- 어댑터 단에서도 116사례 모두 `retryable`을 뺀 실패 결과(`kind`, `httpStatus`, `message`)가 main과 바이트 단위로 같다.

### (5) 재시도 횟수·대기가 바뀌지 않았는가

- 어댑터 단 116사례 모두, 서버가 본 요청 수와 전송 층이 청한 대기 목록이 main과 같다. 예:
  - 503: 요청 3, 대기 [500, 1000]
  - 429 + Retry-After 1: 요청 3, 대기 [1000, 1000]
  - 400: 요청 1, 대기 없음
  - 시간 초과: 요청 3
  - 닫힌 포트: 대기 [500, 1000]
- CLI 단(설정 `maxRetries: 1`)도 명령마다 센 요청 수가 같다. 500·529는 2, 400·할당량·JSON 아님·거절은 1이다.
- 바뀐 `sendWithRetries`(`src/model/http/index.ts:475-507`)는 돌려주는 값에 `retryable`만 더했다. 재시도 여부를 가르는 조건(`!result.retryable || attempt >= attempts || tooLong`)과 대기 계산은 그대로다.

### (6) 키·주소·응답 원문이 새로 실리는가

- 새로 실리는 것은 참·거짓 `retryable` 하나다. 어댑터의 `fail`은 그 값을 그대로 펼칠 뿐이고(`src/model/anthropic/index.ts:357-363`, `src/model/openai/index.ts:450-456`), `message`의 가림(`redact`)은 그대로다.
- 판의 어댑터 결과 116개와 CLI 출력 전체(`cli-out/*-b.json`)에서 지어낸 키 두 개와 `127.0.0.1`을 찾았다. 0건이다.
- 메시지는 main과 같다(위 (4)). 응답 본문에서 옮기는 것은 예전처럼 JSON 오류 객체의 type·code·message뿐이다.

---

## 결함

### 중간

- **M1 `models`의 오류 JSON과 앱 계층(GUI)의 모델 목록 오류가 전송 층의 판정을 받지 못한다.**
  - `src/cli/models.ts:374`는 `cliErrorFacts("model_list_failed", { kind: listed.kind, ...httpStatus })`로 종류와 상태만 넘긴다. 목록 결과의 `listed.retryable`은 버린다.
  - U-82는 `cliErrorFacts`가 그 값을 먼저 쓰도록 바꿨다(`src/contracts/engine.ts:351-368`, 주석 "its own `retryable`, which comes first"). 그런데 그 값을 넘기는 유일한 호출자가 바뀌지 않았다. `src/cli`는 이 단위의 10파일에 없다.
  - 실패 경우:
    - 닫힌 127.0.0.1 포트(연결 거부)에서 판의 `codaryn models --json`이 retryable 없이 끝난다. Anthropic·OpenAI 모두다(`CLI.log`).
    - 목록 결과 자체는 `retryable: true`다(`ADAPTERS.log` "list | closed port").
    - 앱 계층 `listModels`는 같은 `runModels`(`src/app/app.ts:500`)를 거쳐 같다(`APP-MODELS.log`).
    - 같은 이유로 TLS 실패·형식 거부·쪽수 상한("more than N pages")도 false가 아니라 없음이 된다.
  - DR-68의 목적("HTTP 상태가 없는 연결 실패도 재시도 가능으로 나온다")이 실행 결과에서는 이뤄졌지만 모델 목록에서는 아니다. PM의 (3)이 묻는 바로 그것이다.
  - 유닛 시험 `tests/unit/model/u82-retryable.test.ts`의 마지막 묶음은 `cliErrorFacts`에 retryable을 직접 넣어 본다. 그래서 CLI가 넘기지 않는 것을 잡지 못한다.
  - 제안:
    - `models.ts:374`의 객체에 `...(listed.retryable === undefined ? {} : { retryable: listed.retryable })`를 더한다.
    - 닫힌 포트에 대고 `models --json`의 `retryable: true`를 보는 CLI 단 시험을 하나 둔다.
    - 그러면 `docs/cli-contract.md:231`도 함께 바뀐다(L1).

### 낮음

- **L1 계약 문서가 U-82를 따르지 않는다.** 이 단위는 문서를 바꾸지 않았다.
  - `docs/cli-contract.md:230`: "`workspace_locked`, `run_in_progress`만 true다 … 나머지는 false다". 이제 `config_write_failed`에는 retryable이 없다.
  - `:234`: `modelError.retryable`을 종류만으로 적는다. 이제 결과 자신의 판정이 먼저다. 연결 거부는 true이고, TLS·형식 거부·거절·응답 꼴 오류는 false다. 어댑터의 예상 밖 실패와 OpenAI의 failed·cancelled·incomplete 응답에는 없다.
  - `:238`: "없으면 알 수 없음"의 예 "HTTP 상태가 없는 `api_error`"는 이제 실행 결과에서는 대부분 맞지 않는다.
  - `:231`: `model_list_failed`의 서술은 지금 동작(M1)과는 맞지만 DR-68의 뜻과는 다르다. M1을 고치면 함께 바꿀 곳이다.
  - `docs/pm-status.md:53` 알려진 한계 "연결 실패처럼 HTTP 상태가 없는 모델 오류는 `retryable`이 없다"는 실행 결과에 대해서는 낡았다.
- **L2 "알 수 없는 전송 실패"가 '없음'이 아니라 false다.**
  - 전송 층은 TypeError도 아니고 아는 원인 코드도 없는 오류를 `unknown`으로 분류한다(`src/model/http/index.ts:86-92`, `:408-409`). 그것을 재시도하지 않는다는 뜻의 `retryable: false`를 그대로 결과에 싣는다.
  - PM이 적은 기대("알 수 없는 실패는 '없음'")와 다르다. 같은 파일의 원칙("Absent means unknown, never false", `src/contracts/model.ts:105`, `:142-145`)과도 결이 다르다. 재시도하지 않는 것은 조심스러운 선택이지, 나중에 해도 안 된다는 앎이 아니다.
  - 어댑터 자신의 catch("unexpected provider failure")는 없음이다. PM의 "알 수 없는 실패"가 그것을 뜻했다면 맞다.
  - 구현과 시험은 false를 의도했다. ModelOutcome 주석은 "others no"이고, 유닛 시험은 `unknownFailure` false를 고정한다(`u82-retryable.test.ts:42`). 그래서 결함이라기보다 정할 일이다(Q-1).
  - Node의 fetch는 연결 오류를 TypeError로 던지므로 이 경로는 주입한 fetch나 다른 런타임에서만 닿는다. 그래서 낮음이다.

### 정보

- **I1** Anthropic의 429는 본문을 보지 않고 늘 `rate_limited`, true다. 과금 비슷한 코드를 넣어도 같다. C-5(429의 과금 코드)는 OpenAI의 사실이고, OpenAI만 `quota_exhausted` false로 가른다. main과 같다.
- **I2** OpenAI의 529는 `overloaded`가 아니라 `api_error`(5xx)이고 true다. Anthropic은 `overloaded`다. 판정은 둘 다 true로 같다. main과 같다.
- **I3** CLI 층의 종류 규칙은 `aborted`를 false로 둔다(`modelErrorRetryable` default). 어댑터의 취소 결과에는 판정이 없지만, `models`가 취소되면 오류 JSON은 false가 된다. 실행은 취소되면 모델 오류가 아니라 중단으로 끝나므로(`src/engine/index.ts:1101-1102`) `modelError`가 없다. U-55의 규칙이고 바뀌지 않았다.
- **I4** `config_write_failed`에는 `models --use`의 정해진 실패도 있다. "plain model id 아님"(`src/cli/models.ts:416`)과 "그 모델로는 설정이 유효하지 않음"(`:423`)이다. 다시 해도 같은 결과라 false가 맞지만, 이제 함께 없음이 된다. 없음은 모름이라 틀리지는 않는다. 코드를 나누지 않는 한 R-71 L1의 선택(모름)이 맞다.
- **I5** 범위 밖 관찰: `init --config "<파일>/config.json"`(폴더 자리에 파일)은 두 판 모두 `config_exists`("a file already exists at --config")로 끝난다. 쓰지 못한 것인데 "이미 있다"고 한다. U-82와 무관하다.
- 고정 값 파일 `sp0-golden.ts`는 PM이 확인했다. 나도 거칠게 대조했다. 차이에서 `"retryable"` 키를 지우면, 남는 것은 그 앞 줄 끝에 붙은 쉼표뿐이다.

## PM 질문

- **Q-1 (L2):** 전송 층의 "unknown transport failure"를 false로 둘지, 판정 없음으로 둘지 정해 주세요. 없음으로 하려면 `attemptOnce`의 `unknown` 갈래가 재시도 여부와 따로 "모름"을 돌려줘야 합니다. 시험(`u82-retryable.test.ts:42`)과 고정 값의 그 한 사례가 바뀝니다.
- **Q-2 (M1):** `src/cli/models.ts`는 U-82의 소유 파일이 아닙니다. 한 줄 수정을 U-82에 더할지, 따로 단위를 낼지 정해 주세요.

## 방법과 남긴 것

- 사본: `git archive`로 `.codaryn/r75/m`(819d839)과 `.codaryn/r75/b`(997e866)에 풀었다. root `node_modules`(claude-operations)는 junction으로 걸고 각각 `npm run build`를 했다. 기본 설정 위치(APPDATA, LOCALAPPDATA, XDG_CONFIG_HOME)는 임시 폴더로 돌렸다.
- 탐침: `.codaryn/r75/adapters.mjs`, `cli.mjs`, `app-models.mjs`, `unexpected.mjs`.
  - 자식 프로세스는 자기가 띄운 핸들로만 끝낸다(`child.kill()`, 시간 제한 때만).
  - 임시 폴더는 스크립트가 지운다.
- 기록: `ADAPTERS.log`, `CLI.log`, `cli-out/`, `APP-MODELS.log`, `UNEXPECTED.log`, `unit-b.log`, `integration-b.log`, `build-m.log`, `build-b.log`.
- 탐침에서 고친 것 두 가지(결과에는 영향 없음):
  - 첫 어댑터 실행은 사례마다 서버 소켓을 끊었다. 클라이언트가 죽은 keep-alive 소켓을 다음 사례에 다시 써서, 요청 수와 대기가 한 번씩 어긋났다. 응답에 `connection: close`를 붙이고 다시 쟀고, 그 뒤 어긋남은 0이다.
  - 첫 CLI 실행은 `spawnSync`가 같은 프로세스의 가짜 서버를 막아 모든 요청이 시간 초과였다. 비동기 spawn으로 다시 쟀다. 위 수치는 모두 고친 뒤의 것이다.


---

# R-75b PM 확인(좁게): R-75 의 M1 과 L2 수정

- 확인한 사람: PM(w3:p1). 구현자가 아니다. 변경분을 읽고 판을 돌렸다. 실제 CLI 실험은 다시 하지 않았다.
- 판: `pm/unit-U-82` = `032aabd`(main `92c75b4` 위). R-75 가 본 `997e866` 뒤의 제품 코드 변경은 세 파일뿐이다.
  - `src/cli/models.ts`: 목록 결과의 `retryable`을 `cliErrorFacts`에 넘긴다(M1).
  - `src/model/http/index.ts`, `src/contracts/model.ts`: 알 수 없는 전송 실패는 재시도하지 않되 결과에 판정을 싣지 않는다(L2).
- M1: 닫힌 127.0.0.1 포트에 대고 `models --json`의 `retryable: true`를 보는 CLI 시험이 두 제공자에 있다(`tests/unit/cli/g-u82-models-retryable.test.ts`).
- 고정 값 `sp0-golden.ts`: PM 이 스크립트로 다시 확인했다. `retryable` 줄 31개와 머리 주석 5줄을 빼면 main 의 파일과 남는 차이가 0줄이다.
- 수치(판 `032aabd`): 타입 검사 통과, 유닛 2,718건 중 2,714 통과·0 실패, 통합 559건 통과, 비밀 검사 통과.
- L1(계약 문서)은 이 판에서 `docs/cli-contract.md`를 고쳤는지 보지 않았다. 문서 단위 U-97 에서 맞춘다.
