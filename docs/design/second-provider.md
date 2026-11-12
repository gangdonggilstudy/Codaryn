# 두 번째 API 제공자 설계 (Codex = OpenAI, DR-22)

- 상태: PM이 OpenAI 쪽 사실을 확인하고([사실 확인 문서](second-provider-facts.md)) 결정 DR-31로 채택했다. 이 문서는 그 사실과 결정에 맞춰 고쳤다. 구현은 9절 순서로 진행 중이다.
- 기준: main `b05da45`(범용 작업 묶음 병합 뒤). [코드] 표기는 이 트리에서 확인한 것이다.
- 바탕: 제공자 중립 조사(65항목, w3:p9 보고서 `report-provider-neutrality.md`, main `8d17daf` 기준). 줄 번호는 이 문서에서 다시 확인했다.
- 표기: [코드] 코드를 읽어 확인함, [확인] 사실 확인 문서에서 확인된 OpenAI 쪽 사실, [미확인] 공식 문서에서 찾지 못한 것(추측하지 않는다), [제안] 이 문서의 안. 결정 번호는 SP-Dn이고, PM 결정은 DR-31이다.
- 관련: [architecture.md](../architecture.md) 6절(모델 어댑터), [privacy.md](../privacy.md), [cli-contract.md](../cli-contract.md), [decisions.md](../decisions.md), [단계 4·5 설계 지시](../work-orders/phase-4-5-design.md) DR-20·DR-22.

## 1. 요약

- 목표: OpenAI를 Anthropic 다음의 두 번째 API 제공자로 더한다(DR-22, DR-31). Anthropic은 계속 첫 제공자이고, 지금 동작은 바이트 단위로 그대로 둔다.
- **모델은 사용자가 고른다.** API에서 쓸 수 있는 현행 "Codex 계열" 모델 id는 없다 [확인]. 남은 `gpt-5.3-codex`도 2027-04-01에 종료된다. 그래서 특정 모델을 전제로 삼지 않는다. Codaryn은 모델의 코드 기본값을 두지 않는다(C-3 그대로). 사용자는 `codaryn models --provider openai` 목록에서 고른다.
- 엔진, 가림 게이트, 정책, 도구 실행기는 이미 제공자 중립이다 [코드]. 바꿀 곳은 다섯 가지다.
  1. 키 취급
  2. 설정·주소 규칙
  3. 공용 HTTP 기반
  4. 오류·사용량의 의미
  5. 도구 정의 형식
- 순서는 셋이다.
  - **동작을 바꾸지 않는 중립화**: 제공자 표, 키 보안 일반화, 공용 HTTP 모듈, 오류의 HTTP 상태 구조화. Anthropic 고정 시험으로 불변을 증명한다.
  - **설정 스키마**: 제공자 선택을 넣는다.
  - **두 번째 어댑터**: OpenAI Responses API(`POST /v1/responses`) [확인]. 가짜 전송 → 가짜 서버 → 사용자가 실행하는 실제 점검. 작업자는 실제 API를 부르지 않는다.
- 새 실행 의존성은 없다(DR-20). 두 번째 어댑터도 Node의 `fetch`로 쓴다. 제공자 SDK를 쓰지 않는다.

## 2. 범위와 전제

- 범위
  - 모델 호출(`ModelProvider.complete`)
  - 모델 목록(`codaryn models`)
  - 키·주소·모델 설정
  - 오류·사용량
  - 사람용 문구와 문서
  - 앱 계층의 제공자 교체점
- 범위 밖
  - Codex CLI와의 연동(Q-9 (b))
  - 제공자 사이 자동 전환
  - 한 실행 안에서 제공자 섞기
  - 비용 계산
- 전제(사용자 확정, DR-22. 사실에 따라 DR-31로 구체화)
  - Codex 지원 = OpenAI를 두 번째 API 제공자로 추가하는 것이다. "Codex 계열" 모델 id는 API에 현행으로 없으므로, 모델은 사용자가 고른다.
  - 그 전까지 Anthropic 전용 가정을 새로 넣지 않는다.
- 보안 전제(바꾸지 않음)
  - 키는 환경 변수에서만 읽고 메모리에만 둔다(S-2). 요청 헤더에만 싣는다.
  - 설정·task 파일에 키 모양이 있으면 거부한다(S-6, S-8).
  - 주소는 https만 받고, 사용자 정보·질의·조각을 거부한다(S-9). 응답 본문은 상한까지만 읽는다(S-10). 제공자 오류 문구에서 키를 지우고 300자로 줄인다(S-12).
  - 자식 프로세스 환경은 허용 목록이다 [코드: `CHILD_ENV_ALLOWLIST`]. 그래서 새 키 변수도 자식에 가지 않는다.

## 3. 지금 상태 [코드]

이미 중립인 것
- `ModelRequest`, `ModelResponse`, `ModelOutcome`, `ModelStop`, `ModelProvider.complete`(`src/contracts/model.ts`)
- 엔진(`src/engine/**`. 제공자 이름만 기록한다)
- 가림·정책 게이트, 도구 실행기, 작업 공간, 대본 제공자(`src/model/scripted.ts`)
- 도구 이름과 호출 id 규칙: `CALL_ID_PATTERN_SOURCE = ^[A-Za-z0-9_-]{1,64}$`, 목록 밖 이름은 `unknown_tool`(AC-D15)

Anthropic에 묶인 것(조사 65항목의 요약, 현재 위치)

| 묶음 | 현재 위치 | 내용 |
| --- | --- | --- |
| 제공자 이름 | `src/contracts/task.ts:66` | `ModelProviderName = "scripted" \| "anthropic"`. 손으로 적은 목록 4곳: `src/cli/human/output.ts:73`, `src/cli/report.ts:111`, `src/i18n/params.ts:41`, `src/store/runs.ts:50` |
| 키 변수 | `src/contracts/config.ts:15` | `ANTHROPIC_API_KEY_ENV` 하나 |
| 키 등록(S-2) | `src/cli/run.ts:653` 근처 | 고른 제공자의 키만 등록한다 |
| 키 해석 | `src/cli/settings.ts:86-91` | `resolveAnthropicSettings`가 그 변수만 읽는다 |
| 키 모양 | `src/contracts/config.ts:258` | `ANTHROPIC_KEY_PATTERN_SOURCE = "sk-ant-[A-Za-z0-9_-]{8,}"`. 쓰는 곳: `src/cli/security/keys.ts:54`, `src/cli/text-safety.ts:80`, `src/i18n/params.ts:39`, `src/model/anthropic/index.ts:189`·`:786`, 커밋 훅 `scripts/check-secrets.mjs:11-12` |
| 주소 | `src/contracts/config.ts:206` | `DEFAULT_ANTHROPIC_API_BASE_URL`. `src/cli/security/url.ts:30-31`이 `/v1`, `/v1/messages`로 끝나는 주소를 거부한다(제공자가 `/v1/messages`를 붙이므로) |
| 설정 | `src/contracts/config.ts:49-63` | `model`, `maxOutputTokens`, `apiBaseUrl`, `requestTimeoutMs`, `maxRetries`가 최상위에 하나뿐. `CODARYN_MODEL`, `CODARYN_API_BASE_URL`도 하나. 간편 형식은 늘 anthropic(`src/cli/task.ts:703`) |
| 해석 결과 | `src/contracts/model.ts:88-151` | `ResolvedAnthropicSettings`, `CreateAnthropicProvider`, `AnthropicListSettings`, `ListAnthropicModels` |
| 출력 상한 | `src/contracts/config.ts:214` | `MAX_OUTPUT_TOKENS_LIMIT = 200_000`(Anthropic 모델 기준) |
| 오류 | `src/contracts/model.ts:55-70` | `overloaded`의 정의가 "HTTP 529 (or 503)". 오류 결과에 HTTP 상태가 없다. 그래서 CLI가 "HTTP 404"를 문구 앞머리로 찾는다(`src/cli/run.ts:195-202`) |
| 사용량 | `src/contracts/model.ts:41-44` | `ModelUsage { inputTokens, outputTokens }`. 캐시 입력을 더한다는 뜻은 어댑터에만 있다 |
| HTTP 기반 | `src/model/anthropic/index.ts`(915줄) | `isUsableApiKey`(`:81`), `readLimited`(`:246`), `classifyStatus`(`:534`), 재시도·리디렉션 거부(`:579-650`), 키 제거가 모두 Anthropic 모듈 안에 있다 |
| 앱 계층 | `src/app/app.ts:111-116`, `:207-208` | 교체점이 `createAnthropicProvider`, `anthropicDeps`, 목록은 `listAnthropicModels` |
| 문구 | `src/i18n/en.ts`, `ko.ts` | `init.key_*`, `error.key_in_file.fix`, `error.provider_not_configured.fix`, `error.provider_not_implemented.fix`에 `ANTHROPIC_API_KEY`나 제공자 이름이 박혀 있다 |

## 4. 제공자 중립 계약 [제안]

### 4.1 제공자 표

계약 상수 하나에 제공자별 사실을 모은다. DR-16의 이유 표와 같은 방식이다. 읽는 곳은 모두 이 표를 쓰고, 손으로 적은 목록 4곳은 없앤다.

```ts
export const API_PROVIDER_NAMES = ["anthropic", "openai"] as const;   // SP-D1: 이름
export type ApiProviderName = (typeof API_PROVIDER_NAMES)[number];
export const MODEL_PROVIDER_NAMES = ["scripted", ...API_PROVIDER_NAMES] as const;
export type ModelProviderName = (typeof MODEL_PROVIDER_NAMES)[number];

export interface ApiProviderSpec {
  /** 키를 읽는 환경 변수. */
  readonly keyEnv: string;
  /** DR-34: task가 모델을 말하지 않을 때 이 제공자의 모델을 정하는 환경 변수. 이 제공자에만 적용. */
  readonly modelEnv: string;
  /** DR-34: 이 제공자의 주소를 바꾸는 환경 변수. 이 제공자에만 적용. */
  readonly baseUrlEnv: string;
  /** 실행 거부용 키 모양(정규식 원문, 4.3). */
  readonly keyPatternSources: readonly string[];
  readonly defaultApiBaseUrl: string;
  /** 주소 경로 규칙(4.4). */
  readonly baseUrlPath: "without_version" | "with_version";
  /** maxOutputTokens 상한(SP-D9). */
  readonly maxOutputTokensLimit: number;
  /** maxOutputTokens 하한(openai 16, 사실 C-10). */
  readonly minOutputTokens: number;
}
export const API_PROVIDERS: { readonly [P in ApiProviderName]: ApiProviderSpec };
```

- `anthropic` 항목은 지금 값과 같다.
  - `keyEnv: "ANTHROPIC_API_KEY"`
  - `modelEnv: "CODARYN_MODEL"`, `baseUrlEnv: "CODARYN_API_BASE_URL"`: 두 번째 제공자 전의 이름과 동작 그대로(DR-34)
  - `keyPatternSources: ["sk-ant-[A-Za-z0-9_-]{8,}"]`
  - `defaultApiBaseUrl: "https://api.anthropic.com"`
  - `baseUrlPath: "without_version"`
  - `maxOutputTokensLimit: 200_000`
- `openai` 항목(SP-5에서 표에 더한다)
  - `keyEnv: "OPENAI_API_KEY"` [확인]
  - `modelEnv: "CODARYN_OPENAI_MODEL"`, `baseUrlEnv: "CODARYN_OPENAI_API_BASE_URL"`(DR-34)
  - `keyPatternSources`: 실행 거부용 두 모양(4.3, DR-33). 키의 접두·길이·문자 집합은 [미확인]이라, 키를 길이·문자로 검증하지 않는다(DR-31 (g)).
  - `defaultApiBaseUrl: "https://api.openai.com/v1"` [확인]
  - `baseUrlPath: "with_version"`
  - `maxOutputTokensLimit`: 공식 상한을 문서에서 찾지 못했다. 표의 값은 SP-5에서 PM이 정한다(최소값 16은 [확인]).
- 표에서 끌어내는 값
  - `API_KEY_ENVS`(모든 키 변수)
  - `API_KEY_PATTERN_SOURCES`(모든 제공자의 실행 거부용 키 모양, 중복 없이)
  - `API_KEY_MASK_PATTERN_SOURCES`(출력 가림용: 거부용 모양과 느슨한 OpenAI 모양, DR-32 (a))
- 제공자 이름을 더하면 컴파일이 빠진 곳을 알려 준다(`{ [P in ApiProviderName]: … }`).

### 4.2 키 환경 변수와 비밀 등록(S-2 일반화)

- 읽기: 실행은 **고른 제공자의 키 변수 하나만** 읽는다. 다른 제공자의 키를 대신 쓰지 않는다.
- 등록(보안, 가장 먼저)
  - **알려진 모든 키 변수(`API_KEY_ENVS`)의 값을, 고른 제공자와 상관없이** 비밀로 등록한다. 대본 실행도 같다. 지금 S-2가 `ANTHROPIC_API_KEY`에 하는 일을 표 전체로 넓힌다.
  - 이유: 두 키를 다 가진 사용자가 Anthropic으로 실행하면, OpenAI 키가 작업 파일에서 읽혀 기록과 모델 문맥에 원문으로 갈 수 있다.
  - 길이(DR-34 (b), R-20 M-2)
    - 고른 제공자의 키 값은 길이와 상관없이 지금처럼 등록한다.
    - 고르지 않은 제공자의 키 값은 `MIN_OTHER_PROVIDER_KEY_LENGTH`(20자) 이상일 때만 등록한다.
    - 이유: 다른 도구를 위해 그 변수에 둔 짧은 자리표시자(`EMPTY`, `ollama`, `x`)가 비밀이 되면 그 낱말이 든 줄을 고칠 수 없고 명령이 시작하지 못한다(재현). 실제 키는 훨씬 길다.
- 출력 정리: `report`·`runs` 등이 지우는 "현재 키"도 모든 키 변수의 값으로 넓힌다(조사 B6).
- 인쇄 가능한 필드 이름의 예외(`src/cli/security/keys.ts:49`)는 키 변수 이름 전체로 넓힌다.
- `doctor`의 `api_key` 점검, `init`의 `keySet`, `models`의 키 안내는 고른 제공자의 키 변수를 쓴다.
  - 계약 `InitOutput`·`ModelsOutput`에 `provider`를 싣는다.
- 문구
  - 키 변수 이름을 문구에 박지 않는다.
  - `keyEnv`를 닫힌 매개변수 종류로 두거나(N-14 규칙: 값은 `API_KEY_ENVS` 중 하나만), 목록 id `key_env.<provider>`를 쓴다. SP-D12에서 정한다.

### 4.3 키 모양 검사

- 모양 목록은 둘이다(DR-32 (a), DR-33).
  - 실행 거부(task·설정·`--goal`의 키 값 검사, S-6, S-8): `API_KEY_PATTERN_SOURCES`. 좁은 모양만 둔다.
  - 출력 가림(사람용 출력 정리, 문구 매개변수 정리, 제공자 오류 문구의 키 제거): `API_KEY_MASK_PATTERN_SOURCES`. 거부용 모양에 느슨한 OpenAI 모양(`\bsk-[A-Za-z0-9_-]{32,}`)을 더한다. 평범한 이름 몇을 가리는 값은 읽기 불편이지 실행 실패가 아니다.
  - 커밋 훅(`scripts/check-secrets.mjs`)은 PM 소유다.
- OpenAI 키의 접두·길이·문자 집합은 공식 문서에 없다 [미확인]. 그래서
  - 키 값을 길이나 문자로 검증하지 않는다(실행은 변수가 비어 있지 않은지만 본다. 출력 가능한 ASCII 검사는 지금처럼 헤더에 넣기 전의 공통 검사다).
  - 실행 거부용 OpenAI 모양은 둘뿐이다(DR-33): 구분되는 접두사 `sk-proj-`·`sk-svcacct-`·`sk-admin-` 뒤 20자 이상, 또는 접두사 없는 예전 모양으로 `sk-` 뒤 영숫자만 40자 이상이고 숫자·대문자·소문자가 모두 있을 때(하이픈·밑줄이 이어지면 아님). 이 접두사와 길이는 문서에 없는 관행이라 거부의 보조로만 쓴다. 남는 오탐과 놓침은 계약 주석(`OPENAI_KEY_PATTERN_SOURCE`)에 적었다.
- 오탐 관리: 두 검토(R-19, Codex)의 평범한 이름 모음을 불일치 회귀 시험으로 고정한다(시험 SP-U03).
- 실제 키 값 자체는 모양과 상관없이 비밀로 등록되어 가려진다(4.2). 모양 검사는 파일·인자·출력에 섞인 **다른** 키 값을 위한 것이다.
- 키 문자 검사 `isUsableApiKey`(출력 가능한 ASCII)는 공용 모듈로 옮긴다. 제공자 중립이다.

### 4.4 API 주소 규칙

- 공통(S-9 그대로): https(루프백만 http), 사용자 정보·질의·조각·공백·역슬래시 거부.
- 경로 규칙은 제공자별(`baseUrlPath`)이다.
  - `without_version`(anthropic): 지금처럼 `/v1`, `/v1/messages`로 끝나는 주소를 거부한다. 어댑터가 `/v1/messages`를 붙인다.
  - `with_version`(openai): 기본 주소가 `https://api.openai.com/v1`이다 [확인]. 어댑터는 `/responses`, `/models`만 붙인다. 주소가 엔드포인트까지 포함하면(`…/responses`, `…/models`) 거부한다.
- 주소 우선순위(지금 규칙을 제공자별로)
  1. 그 제공자의 주소 변수 `baseUrlEnv`(DR-34): anthropic은 `CODARYN_API_BASE_URL`(이전 그대로), openai는 `CODARYN_OPENAI_API_BASE_URL`. 경로 규칙(`baseUrlPath`)이 이 값에도 적용된다.
  2. 설정의 제공자 몫 `apiBaseUrl`
  3. 표의 `defaultApiBaseUrl`
- 키는 언제나 그 제공자의 주소로만 보낸다(DR-34, R-20 M-1). 한 변수가 두 제공자의 주소를 정하면, 다른 제공자용으로 둔 주소로 키가 갈 수 있기 때문이다(재현: 설정의 제공자가 openai인데 `models`가 Anthropic 키를 그 주소로 보냄).
- `models`는 고른 제공자를 따른다. 그 연결(SP-6) 전에는 고른 제공자가 anthropic이 아니면 요청 없이 거부한다. `doctor`는 어느 제공자의 키가 어느 주소로 가는지 보인다(CLI 몫).
- 고른 제공자 밖의 주소로는 요청하지 않는다. privacy.md의 "외부로 나가는 경로는 Anthropic 요청 하나뿐"은 "고른 제공자의 요청 하나뿐"으로 바뀐다.

### 4.5 모델 설정과 해석 결과

```ts
export interface ResolvedApiSettings {
  readonly provider: ApiProviderName;
  readonly apiKey: string;            // 메모리에만
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly apiBaseUrl: string;
  readonly requestTimeoutMs: number;
  readonly maxRetries: number;
}
export type CreateApiProvider = (settings: ResolvedApiSettings, deps?: ApiProviderDeps) => ModelProvider;
/** 옛 이름: 한동안 별칭으로 둔다. */
export type ResolvedAnthropicSettings = ResolvedApiSettings & { readonly provider: "anthropic" };
```

- `ModelConfig`의 API 쪽 멤버를 `{ provider: ApiProviderName; model?; maxOutputTokens? }`로 넓힌다.
- 토큰 한도 필수 규칙(`src/cli/security/limits.ts:102-104`, "maxTotalTokens must be a number for the anthropic provider")은 "API 제공자 실행"으로 바꾼다. 뜻은 같다.
- 제공자 생성은 제공자 표에서 공장(factory)을 고른다(`src/cli/provider.ts`, `src/cli/run.ts`). 앱 계층의 교체점도 `providerFactories: { [P in ApiProviderName]?: CreateApiProvider }` 하나로 바꾼다. 옛 이름은 별칭으로 둔다(A-1 몫).

### 4.6 모델 목록

- `ListModels`(제공자 중립)와 `ListModelsSettings = Pick<ResolvedApiSettings, "provider" | "apiKey" | "apiBaseUrl" | "requestTimeoutMs" | "maxRetries">`
- 쪽 넘김은 어댑터 안에 둔다. 계약 주석에서 Anthropic 필드 이름(`has_more`, `after_id`)을 걷는다.
- `ModelInfo`
  - 필드는 이미 null을 허용하므로 형은 그대로 쓴다.
  - "Anthropic Models API" 서술을 걷고, 각 어댑터가 아는 것만 채운다고 적는다.
  - OpenAI 목록(`GET /v1/models`)은 `{ object: "list", data: [{ id, object, created, owned_by, shutdown_date? }] }`이고 쪽 넘김 매개변수가 없으며 문맥 길이·기능 정보가 없다 [확인]. 그래서 `displayName`은 id, `maxInputTokens`·`maxOutputTokens`는 null이다. `createdAt`은 `created`(유닉스 초)를 RFC 3339로 바꿔 채운다. 종료 예정(`shutdown_date`)을 보일지는 SP-6에서 정한다.
- `codaryn models [--provider <name>]`: 기본은 설정의 `provider`다. `ModelsOutput.provider`를 싣는다.
- 특정 모델(Codex 계열 등)을 전제로 삼지 않는다. 어떤 id를 부를 수 있는지는 조직·프로젝트마다 다르다 [확인]. 사용자가 목록에서 고른다.

### 4.7 오류 종류와 HTTP 상태의 구조화

```ts
export type ModelOutcome =
  | { readonly ok: true; readonly response: ModelResponse }
  | {
      readonly ok: false;
      readonly kind: ModelErrorKind;
      readonly message: string;
      /** 응답을 받았을 때의 HTTP 상태. 연결 실패·시간 초과·취소에는 없다. */
      readonly httpStatus?: number;
    };
```

- `httpStatus`를 더하면(추가 필드) CLI의 Y-4 "HTTP 404면 모델 id를 의심" 안내가 문구 앞머리 대신 `httpStatus === 404`를 본다. 새 종류(`model_not_found`)는 만들지 않는다(SP-D11).
- 종류의 정의를 중립으로 고친다.
  - `overloaded`: "제공자가 과부하라고 알림(anthropic: 529·503, openai: 503)"
  - `rate_limited`: "요청 빈도 제한(429), 재시도 뒤에도"
  - `auth_failed`: 401·403
- 할당량 소진(DR-31 (f))
  - 새 종류 `quota_exhausted`, 재시도하지 않는다. 문구 `modelError.quota_exhausted`(N-B)가 생긴다.
  - OpenAI에서 다음 중 하나면 이 종류다 [확인]: `error.type == "insufficient_quota"`, 또는 `error.code`가 `credit_balance_exhausted`, `organization_spend_limit_exceeded`, `project_spend_limit_exceeded`, `organization_usage_limit_exceeded` 중 하나. 예전 형식 `error.code == "insufficient_quota"`도 함께 맞춘다([미확인]이지만 안전한 쪽).
  - 그 밖의 429(type `rate_limit_error`, code `slow_down`, 또는 code 없음)는 `rate_limited`이고 재시도한다.
  - 재시도 대기는 `Retry-After`(초, 429·503에 올 수 있음)를 **최소** 대기로 쓴다 [확인]. 지금 Anthropic 어댑터의 상한(60초)과 지수 대기 규칙은 그대로 둔다. 공용 모듈은 제공자별로 "retry-after를 그대로 쓸지, 최소로 쓸지"를 받는다(SP-0 고정 시험이 anthropic 쪽 동작을 지킨다).
- 상태 분류는 공용 기본 + 어댑터 보정이다(5절).
  - 공용 기본: 401·403 인증, 429 빈도, 408·409·5xx 재시도
  - 보정: anthropic 529, openai 할당량
- 오류 본문 인용
  - 어댑터별로 고른 짧은 필드만 인용한다(anthropic: `error.type`, `request_id`. openai: `error.type`·`error.code`, 헤더 `x-request-id` [확인]). OpenAI 오류 본문은 `{ "error": { message, type, code, param } }`다 [확인].
  - 인용 값은 짧은 토큰 모양만 받는다. 그 뒤 공용 정리(모든 키 모양과 실제 키 값 제거, 300자)를 거친다.

### 4.8 사용량

- 계약 주석에 뜻을 적는다.
  - `inputTokens`는 캐시에서 읽은 입력과 캐시에 쓴 입력을 **포함한** 입력 전체다.
  - `outputTokens`는 추론 토큰을 **포함한** 출력 전체다.
- anthropic 어댑터는 지금 `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`로 맞춘다 [코드].
- openai는 `usage.input_tokens`(캐시 입력 `input_tokens_details.cached_tokens` 포함)와 `usage.output_tokens`(추론 토큰 `output_tokens_details.reasoning_tokens` 포함)를 그대로 쓴다 [확인: 예시와 과금 서술]. 상세 필드를 더하지 않는다. 이중으로 세지 않음을 시험으로 고정한다(SP-U09).
- 사용량을 모르면 `null`이다(지금 규칙). 토큰 한도 판정은 지금과 같다.

### 4.9 도구 정의 형식

- 계약의 `inputSchema`(`TOOL_DEFINITIONS`, `WORKFLOW_TOOL_DEFINITIONS`)는 JSON Schema다.
- "두 제공자가 함께 받는 부분 집합"을 계약 주석으로 정하고, 모든 도구 정의가 그 안에 있음을 시험으로 고정한다(SP-U10).
  - 후보: `type`, `properties`, `required`, `items`, `enum`, `const`, `anyOf`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `minItems`, `maxItems`, `additionalProperties: false`, `type: [.., "null"]`, `description`
  - 각 키워드를 OpenAI가 받는지는 확인 필요다(C-7).
- strict(SP-D6, DR-31 (d))
  - OpenAI의 함수 도구는 평평한 모양 `{ "type": "function", "name", "description", "parameters", "strict" }`이다 [확인].
  - `strict`를 **생략하면 strict로 맞추려 한다** [확인]. strict는 모든 객체에 `additionalProperties: false`와 모든 속성의 `required`를 요구한다.
  - 우리 도구는 선택 필드가 있으므로 **`strict: false`를 보낸다.** 인자 검증은 지금처럼 우리 검증기(`validate-args`)가 기준이다.
- 도구 이름은 `^[a-zA-Z0-9_-]{1,64}$` 안에 둔다(DR-31 (d)). 참조 문서에 최대 128자가 보이나 최상위 함수 도구의 패턴은 [미확인]이라, 이 범위면 안전하다. 우리 이름은 모두 이 안이다 [코드].
- 호출 id(DR-31 (e))
  - OpenAI의 도구 호출은 `output`의 `{ "type": "function_call", "id", "call_id", "name", "arguments" }` 항목이다. 결과는 다음 요청 `input`에 `{ "type": "function_call_output", "call_id", "output" }`로 보낸다. 짝은 `id`가 아니라 `call_id`로 맞춘다 [확인].
  - `call_id`의 형식·길이는 [미확인]이다. 불투명한 문자열로 다룬다.
  - 어댑터는 `call_id`를 `ToolCall.id`로 넘긴다.
  - AC-D15 규칙(`CALL_ID_PATTERN_SOURCE`, 64자, 비밀 없음, 다른 id가 쓰지 않음)을 통과한 `call_id`는 Anthropic의 tool_use id처럼 **그대로 기록한다**(DR-35 (c), R-22 L-3). 비밀이 아니며 기록과 요청을 맞춰 보는 데 쓴다.
  - 통과하지 못하면 엔진이 안전한 id(`codaryn-call-<n>`)로 바꿔 기록한다. 어댑터는 **실행 중 메모리**에 "기록 id → 원래 `call_id`" 대응을 두고, 다음 요청의 `function_call_output`에는 원래 `call_id`를 싣는다. 이 대응은 기록하지 않는다.
  - 한 응답에 여러 호출이 올 수 있다(`parallel_tool_calls` 기본 true) [확인]. 엔진은 한 응답의 여러 호출을 이미 처리하므로 기본값을 그대로 둔다.

### 4.10 대화 형식, 멈춤, 추론 항목(어댑터 안)

- 엔진의 `ModelMessage`는 중립이다. 어댑터가 제공자 형식으로 바꾼다.
- anthropic(지금, 바꾸지 않음): `tool_use`·`tool_result` 블록, 같은 역할 합치기, thinking 블록 버림 [코드].
- openai(Responses API) [확인]
  - 요청: `model`, `instructions`(시스템 지시문), `input`(항목 목록), `tools`, `max_output_tokens`, `store: false`.
  - 사용자 글과 우리 쪽 대화는 `input`의 메시지 항목으로, 도구 결과는 호출마다 `function_call_output` 항목으로 싣는다.
  - 응답: `status`와 `output[]`. `finish_reason`·`stop_reason`은 없다.
- 멈춤의 제공자 중립 옮김(DR-31 (h))
  - `status: "completed"`이고 `output[]`에 `function_call` 항목이 있으면 `tool_calls`, 없으면 `final`.
  - `status: "incomplete"`이고 `incomplete_details.reason == "max_output_tokens"`면 `length`.
  - `incomplete`의 `content_filter`와, 메시지 안의 거부 조각 `{ "type": "refusal" }`은 Anthropic의 `refusal`과 같게 `api_error`("모델이 요청을 거절함"류의 고정 문구)로 옮긴다. 거부 글은 싣지 않는다.
  - 그 밖의 `incomplete` 이유(`max_messages`, `steered`)와 `status: "failed"`(`error { code, message }`)는 `api_error`로 옮기고, 이유·code는 짧은 토큰 모양일 때만 인용한다.
- 추론 항목과 서버 저장(SP-D8을 DR-31 (c)로 바꿈)
  - `store`를 생략하면 응답이 30일 저장된다 [확인]. **`store: false`로 끈다.**
  - 저장 없이 이어 가려면 **응답의 `output` 항목을 모두(추론 항목의 `encrypted_content` 포함) 다음 요청에 돌려보내야 한다** [확인]. 그래서 처음 설계의 "돌려주지 않는다"는 쓸 수 없다.
  - 어댑터는 그 항목들을 **실행 중 메모리에만** 두고, 같은 실행의 다음 요청에 그대로 다시 보낸다. 엔진의 `ModelMessage`·기록·결과·보고서에는 넣지 않는다.
  - 실행 기록에는 추론 항목이 **있었다는 사실과 개수만** 남긴다(내용은 남기지 않음). 기록 형식(어느 기록에 어떤 필드로)은 SP-5에서 계약으로 정한다.
  - 추론 항목의 `encrypted_content`는 불투명한 암호문이라 가림 게이트가 볼 수 없다. 같은 제공자에 같은 실행 안에서만 되돌려 보낸다는 점, 실행이 끝나면 버린다는 점을 privacy.md에 적는다.
  - 같은 이유로 실행을 이어 가는 기능(같은 대화를 다음 실행에서 계속)은 이 항목을 저장하지 않는 한 할 수 없다. 지금 Codaryn은 실행을 이어 가지 않으므로 문제가 없다.
- 데이터 보존 [확인]: API로 보낸 자료는 기본으로 학습에 쓰이지 않는다. 남용 감시 기록은 최대 30일 보존된다. 보존 없음(ZDR)은 OpenAI의 사전 승인이 필요하다. 사용 문서와 privacy.md에 적는다.

## 5. 공용 HTTP 모듈 [제안]

`src/model/http/`(가칭)에 두고 두 어댑터가 함께 쓴다. **옮길 때 동작은 바뀌지 않는다**(7절로 증명).

| 옮길 것 | 지금 위치 [코드] | 공용 형태 |
| --- | --- | --- |
| 한 번의 요청: 시간 한도, 취소 신호, 리디렉션 거부(`redirect: "manual"`, 3xx·opaqueredirect 거부) | `src/model/anthropic/index.ts:579-650` | `sendOnce({ url, method, headers, body, timeoutMs, signal })` |
| 재시도: 횟수, 대기(지수와 `retry-after`, 상한), 재시도할 상태 | `:686`(`sendWithRetries`) | `sendWithRetries(request, { maxRetries, classify, sleep, now })`. `classify`는 어댑터가 준다 |
| 응답 본문 상한(S-10) | `:246`(`readLimited`) | 그대로 |
| 상태 분류 기본값 | `:534`(`classifyStatus`) | `baseClassify(status)` + 어댑터 보정 |
| 연결 오류 분류(시간 초과, 취소, 네트워크) | 같은 파일 | 그대로 |
| 키 문자 검사 | `:81`(`isUsableApiKey`) | 그대로 |
| 오류 문구 정리: 모든 키 모양과 실제 키 값 제거, 300자(S-12) | `:189`, `:786` | `scrubProviderText(text, { apiKey })`. `API_KEY_PATTERN_SOURCES` 전체를 쓴다 |

어댑터에 남는 것
- 헤더: anthropic은 `x-api-key`, `anthropic-version`. openai는 `Authorization: Bearer <키>` [확인]. 선택 헤더 `OpenAI-Organization`, `OpenAI-Project`는 처음에는 보내지 않는다(필요하면 설정 필드로 따로 정한다).
- 엔드포인트 경로, 요청 본문 만들기, 응답 해석, 멈춤 이유 표
- 상태 보정(529, 할당량), 오류 본문의 인용 필드, 모델 목록의 쪽 넘김

공용 모듈의 불변식(시험으로 고정)
- 키는 헤더에만 있다. 본문, URL, 오류 결과, 기록에 없다.
- 리디렉션을 따라가지 않는다(키가 다른 곳으로 가지 않는다).
- 본문은 상한까지만 읽는다. 오류 문구에는 키 모양과 키 값이 없다.
- 고른 제공자의 주소 밖으로 요청하지 않는다.

## 6. 설정에서 제공자를 고르는 방법 [제안]

```jsonc
{
  "provider": "anthropic",            // 기본 제공자. 없으면 anthropic(하위 호환)
  "model": "…", "maxOutputTokens": 4096, "apiBaseUrl": "…",   // 지금 형식: anthropic 몫으로 읽는다
  "providers": {
    "openai": { "model": "…", "maxOutputTokens": 4096, "apiBaseUrl": "…", "requestTimeoutMs": 60000, "maxRetries": 2 }
  }
}
```

- 최상위 `model`, `maxOutputTokens`, `apiBaseUrl`, `requestTimeoutMs`, `maxRetries`는 anthropic 몫으로 계속 읽는다(하위 호환, SP-D3).
  - `providers.anthropic`과 최상위를 함께 쓰면 `invalid_config`(어느 것인지 모호)로 한다.
- task: `model: { provider: "openai", model?, maxOutputTokens? }`. 제공자 이름은 `API_PROVIDER_NAMES`로 검사한다.
- 간편 형식(`--workspace`): 설정의 `provider`를 쓴다(지금은 늘 anthropic).
- 프로필(N-8)에 `provider`를 둘지는 SP-D10에서 정한다. 두면 "이 프로필은 openai로"가 된다.
- 환경 변수(SP-D5, DR-34)
  - 모델과 주소의 변수는 제공자별이다(표의 `modelEnv`, `baseUrlEnv`).
    - anthropic: `CODARYN_MODEL`, `CODARYN_API_BASE_URL`(이전 이름과 동작 그대로)
    - openai: `CODARYN_OPENAI_MODEL`, `CODARYN_OPENAI_API_BASE_URL`
  - 한 제공자의 변수는 다른 제공자의 설정을 바꾸지 않는다.
  - 제공자를 고르는 환경 변수(`CODARYN_PROVIDER`)는 두지 않는다(설정이나 task에서만 고른다).
- CLI
  - `codaryn models --provider <name>`
  - `doctor`: 고른 제공자의 키 변수·주소·모델을 점검하고 제공자 이름을 보인다.
  - `init`: 고른 제공자를 묻는 질문을 더할지는 UX 담당이 정한다(SP-D13).
- GUI(DR-20 "설정·프로필·모델 선택"): 같은 설정 형식을 앱 계층으로 읽는다. 화면은 GUI 담당이 정한다.

## 7. Anthropic 동작이 바이트 단위로 그대로임을 확인하는 방법

원칙: **고정 시험을 먼저 지금의 main에 넣고 통과시킨 뒤** 리팩터링한다. 리팩터링 커밋에서 고정 시험을 고치지 않는다. 고쳐야 하면 PM 승인을 받고 이유를 기록한다.

| # | 고정할 것 | 방법 |
| --- | --- | --- |
| P-1 | 요청 본문 바이트 | 대표 요청 10여 개(시스템 지시문 유무, 도구 4개, `workflowTools`, 도구 결과, 같은 역할 합치기, 가린 토큰, 긴 대화)의 본문을 가짜 전송으로 받아 SHA-256과 길이를 고정한다. `tests/unit/model/anthropic/g-workflow-tools.test.ts`의 방식을 넓힌다 |
| P-2 | 요청 줄과 헤더 | 메서드, 전체 URL, 헤더 이름·값(키 값은 자리만)과 순서를 고정한다 |
| P-3 | 재시도 순서 | 가짜 전송·가짜 시계로 상태열(429, 529, 503, 500, 408, 연결 끊김, 시간 초과)마다 시도 횟수, 대기 시간, 최종 결과(`kind`, `message`)를 고정한다 |
| P-4 | 오류 결과 문구 | 대표 오류 본문(키 모양 포함, 긴 본문, 형식 아닌 본문)의 `message`를 글자 그대로 고정한다 |
| P-5 | 응답 해석 | 사용량(캐시 필드 포함), 멈춤 이유, 거부, thinking 버림의 결과를 고정한다 |
| P-6 | 모델 목록 | 요청 URL·헤더, 쪽 넘김 순서, `ModelInfo` 결과를 고정한다 |
| P-7 | 설정 해석 | 지금의 설정·환경 변수·task 조합 표(주소·모델·출력 상한의 우선순위 전부)가 같은 해석 결과를 내는지 고정한다. 새 스키마에서도 같은 결과여야 한다 |
| P-8 | CLI 출력 | anthropic 설정의 `doctor`, `models`, `init`, `run`의 JSON과 사람용 출력을 가짜 서버(`tests/support/fake-anthropic.ts`)로 고정한다 |
| P-9 | 기존 시험 | 유닛·통합 전체가 고치지 않은 채로 통과한다 |

- P-1~P-6은 제공자 소유(w3:p9), P-7·P-8은 CLI 담당과 함께 한다.
- 고정값(해시·길이)은 리팩터링 전 main 커밋을 기준으로 시험 파일 머리에 적는다.

## 8. 보안·개인정보 점검 목록

- S-2 일반화가 먼저 들어간다(4.2). 그 전에는 두 번째 제공자를 쓸 수 없게 둔다(제공자 표에 openai가 없음).
- 모든 키 모양 검출이 표를 쓴다(4.3). 커밋 훅도 같이 바꾼다.
- 키는 헤더에만 있다. 오류·기록·출력에 키 모양과 키 값이 없다(공용 모듈 시험, 두 어댑터 각각).
- 리디렉션을 거부하고, 고른 제공자 주소 밖으로 요청하지 않는다.
- 제공자 응답 저장을 끈다(`store: false`). 추론 항목은 같은 실행 안에서 메모리에만 두고 같은 제공자에 다시 보낸다. 기록에는 개수만 남긴다(4.10, privacy.md에 적음).
- 모델에 보내는 내용은 지금처럼 가림 게이트를 거친 것뿐이다. 엔진은 바뀌지 않는다.
- 가짜 서버 통합에 "실제 API 아님" 표기를 붙인다. 실제 점검 스크립트(`tests/live/openai-live.ts`)는 사용자만 실행한다.

## 9. 구현 분할안

작은 단위로 main 기준에서 만들고, 새 모듈과 보안 변경은 교차 검토 뒤 병합한다.

| 단계 | 내용 | 담당(지금 배정 기준) | 상태 | 완료 기준 |
| --- | --- | --- | --- | --- |
| SP-0 | 고정 시험 P-1~P-6을 지금 main에 넣는다(P-7·P-8은 SP-4·SP-6에서 CLI와 함께) | 제공자(w3:p9) | 끝남 `1001e0a` | 고정 시험 통과, 제품 코드 변경 없음 |
| SP-1 | 계약: 제공자 표(anthropic만), 이름 목록 상수, `ResolvedApiSettings`와 별칭, `ModelOutcome.httpStatus`, 사용량·오류 종류 주석 | 계약(w3:p9) | 끝남 `ecc8466`. 손으로 적은 목록 4곳(`src/cli/human/output.ts:73`, `src/cli/report.ts:111`, `src/i18n/params.ts:41`, `src/store/runs.ts:50`)은 각 담당이 `MODEL_PROVIDER_NAMES`로 바꾼다 | typecheck, 고정 시험 그대로 |
| SP-2 | 보안: S-2 일반화(`API_KEY_ENVS` 모두 등록), 키 모양 목록 사용(keys, text-safety, i18n params, 출력 정리), 커밋 훅 | CLI(w3:p2), N-B(w3:p5), 제공자(w3:p9), 훅은 PM | 대기. openai 키 변수 이름은 [확인]. 모양은 실행 거부용 두 모양과 출력 가림용 느슨한 모양(4.3, DR-32 (a), DR-33). 다른 제공자의 키 값은 20자 이상일 때만 등록(DR-34 (b)) | 두 키가 있을 때 둘 다 가려지는 재현 시험, 고정 시험 그대로, 보안 교차 검토 |
| SP-3 | 공용 HTTP 모듈 분리, anthropic 어댑터를 그 위로, `httpStatus` 채움. CLI Y-4가 `httpStatus`를 본다 | 제공자(w3:p9). Y-4는 CLI | 아니오 | 고정 시험 그대로, 공용 모듈 유닛, 교차 검토 |
| SP-4 | 설정·task 스키마(`provider`, `providers`), 해석기 일반화, 간편 형식·프로필·환경 변수 적용, cli-contract 개정 | 계약(w3:p9), CLI(w3:p2), 문서(N-A) | 아니오(openai 항목 값은 SP-5) | P-7 그대로, 새 스키마 유닛, 하위 호환 시험 |
| SP-5 | openai 어댑터(Responses API, 가짜 전송 유닛 → 가짜 서버 통합), 표에 openai 항목, 모델 목록, `quota_exhausted` 종류(문구는 N-B), 추론 항목 개수 기록의 계약 | 제공자(w3:p9), 통합(G-G w3:p4) | 사실 확인됨(11절) | 어댑터 유닛, 가짜 서버 통합, 공용 불변식 시험. 실제 API 호출 없음 |
| SP-6 | 연결: CLI(`models --provider`, doctor, init, run, report, runs, human), 앱 계층 교체점, 문구, 문서 M1~M14, GUI 설정 | CLI, A-1(w3:pA), N-B, N-A, GUI(w3:pB) | 일부 | 통합 회귀, 교차 검토 |
| SP-7 | 실제 점검 스크립트(사용자 실행) | 제공자(w3:p9), 실행은 사용자 | 예 | 사용자 실행 기록 |

- 의존: SP-0 → SP-1 → (SP-2, SP-3 함께 가능) → SP-4 → SP-5 → SP-6 → SP-7.
- 단위마다 main 기준의 작은 커밋으로 만들고, 매 단위에서 SP-0 고정 시험이 그대로 통과해야 한다(DR-31).

## 10. 시험 계획

유닛
| ID | 대상 | 확인 |
| --- | --- | --- |
| SP-U01 | 제공자 표 | 이름 목록 = 표의 키, 손 목록이 없음, 키 변수·모양·기본 주소가 표에서만 온다 |
| SP-U02 | S-2 일반화 | 두 키 변수가 다 있으면 어느 제공자로 실행해도 둘 다 비밀로 등록된다(대본 실행 포함) |
| SP-U03 | 키 모양 | 모든 제공자의 키 모양이 task·설정·`--goal`·출력·문구·오류 문구에서 잡힌다. 일반 글(짧은 `sk-…`)은 오탐하지 않는다 |
| SP-U04 | 주소 규칙 | anthropic은 지금과 같다. openai는 `/v1` 포함 기본 주소를 받고 엔드포인트까지 쓴 주소를 거부한다 |
| SP-U05 | 공용 HTTP | 키는 헤더에만, 리디렉션 거부, 본문 상한, 재시도와 `retry-after`, 연결 오류 분류, 문구 정리 |
| SP-U06 | 오류 상태 | `httpStatus`가 응답 오류에만 있다. Y-4가 404를 상태로 판단한다 |
| SP-U07 | 설정 해석 | 최상위 = anthropic, `providers.<name>`, 모호한 조합 거부, 환경 변수는 고른 제공자에만 |
| SP-U08 | openai 요청 | `POST …/v1/responses`, `Authorization: Bearer`, `instructions`·`input` 항목, 평평한 도구 정의와 `strict: false`, 도구 결과의 `function_call_output`(원래 `call_id`), `max_output_tokens`, `store: false`, 직전 응답의 `output` 항목(추론 항목 포함)을 그대로 다시 보냄 |
| SP-U09 | openai 응답 | `completed`와 `function_call` 유무로 `final`·`tool_calls`, `incomplete`의 `max_output_tokens`는 `length`, `content_filter`와 `refusal`은 거절, `failed`, 사용량(상세를 더하지 않음), 할당량 소진(type 하나와 code 넷, 예전 code), 429의 `rate_limited`, `Retry-After` 최소 대기 |
| SP-U10 | 도구 정의 부분 집합 | 모든 도구의 `inputSchema`가 계약의 공통 부분 집합 안이고, 이름이 `^[a-zA-Z0-9_-]{1,64}$` 안이다 |
| SP-U11 | 호출 id | 규칙을 통과한 `call_id`는 그대로 기록(DR-35 (c)). 규칙 밖 `call_id`는 기록에 대체 id, 다음 요청에는 원래 `call_id`. 대응과 추론 항목은 기록·결과에 없다(기록에는 추론 항목 개수만) |

통합(가짜 서버, "[모의 API·실제 API 아님]")
| ID | 사례 | 기대 |
| --- | --- | --- |
| SP-I01 | anthropic 기존 통합 전체 | 고치지 않은 채 통과 |
| SP-I02 | openai 설정으로 `run`(도구 호출 → 결과 → 완료) | `done`/`verified`. 기록에 키 없음 |
| SP-I03 | 두 키가 다 있는 환경에서 anthropic 실행. 작업 파일에 openai 키 값이 있다 | 기록·결과·출력에 그 값이 없다 |
| SP-I04 | openai 429(빈도)·할당량·503·401 | 재시도와 종류가 표대로 |
| SP-I05 | `models --provider openai`, `doctor`(openai) | 제공자 이름과 키 변수가 맞게 보인다 |

## 11. 확인 결과(OpenAI 쪽 사실)

PM이 공식 문서로 확인했다. 기준은 [사실 확인 문서](second-provider-facts.md)다. 이 문서에 옮긴 내용과 다르면 그 문서가 맞다.

| # | 결과 | 이 문서의 반영 |
| --- | --- | --- |
| C-1 | Responses API(`POST /v1/responses`) [확인] | SP-D2, 4.10 |
| C-2 | `Authorization: Bearer`, 선택 헤더 `OpenAI-Organization`·`OpenAI-Project` [확인] | 5절(선택 헤더는 처음에 보내지 않음) |
| C-3 | `OPENAI_API_KEY` [확인]. 키 접두·길이·문자 집합은 [미확인] | 4.1, 4.3: 길이·문자로 검증하지 않는다. 실행 거부는 DR-33의 두 모양(보조), 출력 가림은 느슨한 모양까지 |
| C-4 | `https://api.openai.com/v1`, `/responses`, `/models` [확인] | 4.4 |
| C-5 | 오류 본문, 상태 목록, 429의 구분(type `insufficient_quota`와 과금·할당량 code 넷) [확인]. 예전 `code == "insufficient_quota"`는 [미확인] | 4.7 |
| C-6 | `Retry-After`(초, 최소 대기), `x-ratelimit-*`, `x-request-id` [확인] | 4.7 |
| C-7 | 평평한 도구 정의, `strict` 생략 시 strict, `strict: false`로 끔 [확인]. 함수 이름 패턴은 일부만 확인 | 4.9 |
| C-8 | `function_call`·`function_call_output`과 `call_id`, 여러 호출 가능 [확인]. id 형식·길이는 [미확인] | 4.9 |
| C-9 | 사용량 필드와 포함 관계 [확인] | 4.8 |
| C-10 | `max_output_tokens`(최소 16), `status`와 `incomplete_details.reason` [확인] | 4.10 |
| C-11 | 추론 항목(`encrypted_content`)을 저장 없이 이어 갈 때 돌려보내야 함, `store` 기본 true와 30일 저장 [확인] | 4.10(SP-D8 바뀜) |
| C-12 | 모델 목록 형식, 쪽 넘김 없음, 한도 정보 없음 [확인]. 현행 Codex 계열 id 없음 [확인] | 4.6, 1절 |
| C-13 | 요청 본문 최대 128 MiB(넘으면 413) [확인]. 서버 시간 상한은 [미확인] | `requestTimeoutMs` 기본값은 지금 규칙 그대로 |
| C-14 | 기본 학습 미사용, 남용 감시 30일, ZDR은 사전 승인 [확인] | 4.10, privacy.md |
| C-15 | 거부 조각 `refusal`, `content_filter`, `failed` [확인] | 4.10 |

## 12. 결정(DR-31)

| # | 결정 | 상태 |
| --- | --- | --- |
| SP-D1 | 제공자 이름 `openai` | 채택(DR-31 (a)) |
| SP-D2 | Responses API(`POST /v1/responses`) | 채택(DR-31 (a)) |
| SP-D3 | 설정 형식: 최상위 = anthropic(하위 호환), `providers.<name>`, 최상위와 `providers.anthropic`을 함께 쓰면 거부 | 채택(DR-31 (i)) |
| SP-D4 | S-2 일반화: 알려진 모든 키 값을 늘 등록, 가장 먼저 | 채택 |
| SP-D5 | 모델·주소 변수는 제공자별이다: anthropic `CODARYN_MODEL`·`CODARYN_API_BASE_URL`(이전 그대로), openai `CODARYN_OPENAI_MODEL`·`CODARYN_OPENAI_API_BASE_URL`. `CODARYN_PROVIDER` 없음 | 바뀜(DR-34). 처음 결정("고른 제공자에만 적용")은 한 변수가 두 제공자의 주소를 정해 키가 다른 제공자용 주소로 갈 수 있었다(R-20 M-1) |
| SP-D6 | `strict: false`를 보낸다(생략하면 strict가 되므로). 인자 검증은 Codaryn | 채택, 바뀜(DR-31 (d)) |
| SP-D7 | `quota_exhausted`(재시도 없음): `error.type == "insufficient_quota"` 또는 과금·할당량 code 넷, 예전 code도. `Retry-After`는 최소 대기 | 채택, 구체화(DR-31 (f)) |
| SP-D8 | `store: false`. 응답의 `output` 항목(추론 항목 포함)은 실행 중 메모리에만 두고 다음 요청에 돌려보낸다. 기록에는 추론 항목의 존재와 개수만 | 바뀜(DR-31 (c)). 처음 권고("돌려주지 않음")는 쓸 수 없다 |
| SP-D9 | 제공자 표의 `maxOutputTokensLimit` | 채택(DR-31 (i)). openai 값은 SP-5에서 |
| SP-D10 | 프로필의 `provider` | 채택(DR-31 (i)) |
| SP-D11 | 404 안내는 `httpStatus`로 | 채택(DR-31 (i)) |
| SP-D12 | 문구의 키 변수 이름은 닫힌 매개변수 `keyEnv` | 채택(DR-31 (i)) |
| SP-D13 | `init`의 제공자 질문은 UX 담당 | 채택(DR-31 (i)) |
| (DR-31 (b)) | 특정 모델(Codex 계열 등)을 전제로 삼지 않는다. 모델의 코드 기본값 없음(C-3) | 채택 |
| (DR-31 (e)) | 호출 짝은 `call_id`. AC-D15를 통과한 원래 `call_id`는 Anthropic과 같이 그대로 기록하고, 통과하지 못한 것만 엔진의 대체 id로 기록하며 원래 값은 실행 중 메모리 대응으로 둔다 | 채택, 문구 맞춤(DR-35 (c)) |
| (DR-31 (g)) | 키는 `OPENAI_API_KEY`로만 받고 길이·문자로 검증하지 않음 | 채택 |
| (DR-31 (h)) | 정상 끝·도구 호출 끝은 `function_call` 유무, `incomplete` 이유와 거부를 중립 결과로 | 채택 |

## 13. 다른 문서와 맞출 점

- [cli-contract.md](../cli-contract.md): 진입 함수 표, 간편 형식의 제공자, 키 검사 한계, 주소 규칙, 환경 변수 표, 해석 결과 이름, 토큰 한도 규칙, `models` 절(조사 M1~M8). SP-4·SP-6에서.
- [architecture.md](../architecture.md): 모듈 표, 실행 전 단계의 S-2, 6절 "Anthropic 모델 어댑터"를 "모델 어댑터와 공용 HTTP"로(M9, M10).
- [privacy.md](../privacy.md): S-2 서술, "키는 헤더에만", "외부 경로는 고른 제공자 하나", 응답 저장 끔과 추론 항목(M11, M12).
- [usage.md](../usage.md): 키·환경 변수 표, task 모델 형식, 간편 형식, doctor 출력 예, `models`(M13, M14).
- `scripts/check-secrets.mjs`(PM), `tests/live/README.md`(실제 점검 절차).
- [설계 문서 색인](README.md)에 이 문서를 더한다(PM).
