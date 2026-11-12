# 두 번째 API 제공자 설계 (Codex = OpenAI, DR-22)

- 상태: [제안]. 구현 없음. 구현은 PM이 11절의 사실을 확인하고 12절을 결정한 뒤 시작한다.
- 기준: main `b05da45`(범용 작업 묶음 병합 뒤). [코드] 표기는 이 트리에서 확인한 것이다.
- 바탕: 제공자 중립 조사(65항목, w3:p9 보고서 `report-provider-neutrality.md`, main `8d17daf` 기준). 줄 번호는 이 문서에서 다시 확인했다.
- 표기: [코드] 코드를 읽어 확인함, [추정] 확인하지 않음(특히 OpenAI 쪽 사실 전부), [제안] 이 문서의 안. 결정 번호는 SP-Dn이다.
- 관련: [architecture.md](../architecture.md) 6절(모델 어댑터), [privacy.md](../privacy.md), [cli-contract.md](../cli-contract.md), [decisions.md](../decisions.md), [단계 4·5 설계 지시](../work-orders/phase-4-5-design.md) DR-20·DR-22.

## 1. 요약

- 목표: OpenAI의 Codex 계열 모델을 Anthropic 다음의 두 번째 API 제공자로 쓸 수 있게 한다(DR-22). Anthropic은 계속 첫 제공자이고, 지금 동작은 바이트 단위로 그대로 둔다.
- 엔진, 가림 게이트, 정책, 도구 실행기는 이미 제공자 중립이다 [코드]. 바꿀 곳은 다섯 가지다.
  1. 키 취급
  2. 설정·주소 규칙
  3. 공용 HTTP 기반
  4. 오류·사용량의 의미
  5. 도구 정의 형식
- 순서는 셋이다.
  - **동작을 바꾸지 않는 중립화**: 제공자 표, 키 보안 일반화, 공용 HTTP 모듈, 오류의 HTTP 상태 구조화. Anthropic 고정 시험으로 불변을 증명한다.
  - **설정 스키마**: 제공자 선택을 넣는다.
  - **두 번째 어댑터**: 가짜 전송 → 가짜 서버 → 사용자가 실행하는 실제 점검.
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
- 전제(사용자 확정, DR-22)
  - Codex 지원 = OpenAI Codex 계열 모델을 두 번째 API 제공자로 추가하는 것이다.
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
  /** 키 모양(검출용 정규식 원문). 가장 구체적인 것부터. */
  readonly keyPatternSources: readonly string[];
  readonly defaultApiBaseUrl: string;
  /** 주소 경로 규칙(4.4). */
  readonly baseUrlPath: "without_version" | "with_version";
  /** maxOutputTokens 상한(SP-D9). */
  readonly maxOutputTokensLimit: number;
}
export const API_PROVIDERS: { readonly [P in ApiProviderName]: ApiProviderSpec };
```

- `anthropic` 항목은 지금 값과 같다.
  - `keyEnv: "ANTHROPIC_API_KEY"`
  - `keyPatternSources: ["sk-ant-[A-Za-z0-9_-]{8,}"]`
  - `defaultApiBaseUrl: "https://api.anthropic.com"`
  - `baseUrlPath: "without_version"`
  - `maxOutputTokensLimit: 200_000`
- `openai` 항목의 값은 모두 [추정]이고 11절에서 확인한다.
  - `keyEnv: "OPENAI_API_KEY"`
  - 키 모양 `sk-proj-…`, `sk-svcacct-…`, `sk-…`
  - `defaultApiBaseUrl: "https://api.openai.com/v1"`
  - `baseUrlPath: "with_version"`
- 표에서 끌어내는 값
  - `API_KEY_ENVS`(모든 키 변수)
  - `API_KEY_PATTERN_SOURCES`(모든 제공자의 키 모양, 중복 없이)
- 제공자 이름을 더하면 컴파일이 빠진 곳을 알려 준다(`{ [P in ApiProviderName]: … }`).

### 4.2 키 환경 변수와 비밀 등록(S-2 일반화)

- 읽기: 실행은 **고른 제공자의 키 변수 하나만** 읽는다. 다른 제공자의 키를 대신 쓰지 않는다.
- 등록(보안, 가장 먼저)
  - **알려진 모든 키 변수(`API_KEY_ENVS`)의 값을, 고른 제공자와 상관없이** 비밀로 등록한다. 대본 실행도 같다. 지금 S-2가 `ANTHROPIC_API_KEY`에 하는 일을 표 전체로 넓힌다.
  - 이유: 두 키를 다 가진 사용자가 Anthropic으로 실행하면, OpenAI 키가 작업 파일에서 읽혀 기록과 모델 문맥에 원문으로 갈 수 있다.
- 출력 정리: `report`·`runs` 등이 지우는 "현재 키"도 모든 키 변수의 값으로 넓힌다(조사 B6).
- 인쇄 가능한 필드 이름의 예외(`src/cli/security/keys.ts:49`)는 키 변수 이름 전체로 넓힌다.
- `doctor`의 `api_key` 점검, `init`의 `keySet`, `models`의 키 안내는 고른 제공자의 키 변수를 쓴다.
  - 계약 `InitOutput`·`ModelsOutput`에 `provider`를 싣는다.
- 문구
  - 키 변수 이름을 문구에 박지 않는다.
  - `keyEnv`를 닫힌 매개변수 종류로 두거나(N-14 규칙: 값은 `API_KEY_ENVS` 중 하나만), 목록 id `key_env.<provider>`를 쓴다. SP-D12에서 정한다.

### 4.3 키 모양 검사

- 다음 다섯 곳이 `API_KEY_PATTERN_SOURCES` 전체를 쓴다.
  - task·설정·`--goal`의 키 값 검사(S-6, S-8)
  - 사람용 출력 정리
  - 문구 매개변수 정리
  - 제공자 오류 문구의 키 제거
  - 커밋 훅(`scripts/check-secrets.mjs`, PM 소유)
- 오탐 관리
  - 일반 `sk-` 접두는 흔한 글자일 수 있다.
  - 제공자 항목의 모양은 접두와 최소 길이를 함께 둔다. 예: `sk-proj-[A-Za-z0-9_-]{20,}` [추정]
  - 커밋 훅의 `\bsk-[A-Za-z0-9]{32,}\b`는 중간에 `-`가 있는 키(`sk-proj-…`)를 놓칠 수 있다 [추정]. 표의 모양을 함께 쓴다.
- 키 문자 검사 `isUsableApiKey`(출력 가능한 ASCII)는 공용 모듈로 옮긴다. 제공자 중립이다.

### 4.4 API 주소 규칙

- 공통(S-9 그대로): https(루프백만 http), 사용자 정보·질의·조각·공백·역슬래시 거부.
- 경로 규칙은 제공자별(`baseUrlPath`)이다.
  - `without_version`(anthropic): 지금처럼 `/v1`, `/v1/messages`로 끝나는 주소를 거부한다. 어댑터가 `/v1/messages`를 붙인다.
  - `with_version`(openai [추정]): 기본 주소가 `/v1`을 포함하는 관례다. 어댑터는 엔드포인트 경로만 붙인다(예: `/responses` 또는 `/chat/completions`, SP-D2). 주소가 엔드포인트까지 포함하면(`…/responses`) 거부한다.
- 주소 우선순위(지금 규칙을 제공자별로)
  1. `CODARYN_API_BASE_URL`(고른 제공자에만 적용, SP-D5)
  2. 설정의 제공자 몫 `apiBaseUrl`
  3. 표의 `defaultApiBaseUrl`
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
  - OpenAI 목록은 `id`, `created`(유닉스 초), `owned_by`만 있고 한도 정보가 없는 것으로 안다 [추정]. 그러면 `displayName`, `maxInputTokens`, `maxOutputTokens`는 null이다.
- `codaryn models [--provider <name>]`: 기본은 설정의 `provider`다. `ModelsOutput.provider`를 싣는다.
- Codex 계열 모델이 목록 API에 나오는지, 어떤 이름인지는 확인 필요다(11절 C-1, C-12).

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
  - `overloaded`: "제공자가 과부하라고 알림(anthropic: 529·503, openai: 503 [추정])"
  - `rate_limited`: "요청 빈도 제한(429), 재시도 뒤에도"
  - `auth_failed`: 401·403
- 할당량 소진
  - OpenAI는 429 안에 "quota 소진"(재시도해도 소용없음)을 따로 알리는 것으로 안다(본문의 `error.code` 등) [추정].
  - 새 종류 `quota_exhausted`(재시도 없음)를 둘지는 SP-D7에서 정한다. 두면 문구 `modelError.quota_exhausted`(N-B)가 생긴다.
- 상태 분류는 공용 기본 + 어댑터 보정이다(5절).
  - 공용 기본: 401·403 인증, 429 빈도, 408·409·5xx 재시도
  - 보정: anthropic 529, openai 할당량
- 오류 본문 인용
  - 어댑터별로 고른 짧은 필드만 인용한다(anthropic: `error.type`, `request_id`. openai: `error.type`·`error.code`, `x-request-id` [추정]).
  - 인용 값은 짧은 토큰 모양만 받는다. 그 뒤 공용 정리(모든 키 모양과 실제 키 값 제거, 300자)를 거친다.

### 4.8 사용량

- 계약 주석에 뜻을 적는다.
  - `inputTokens`는 캐시에서 읽은 입력과 캐시에 쓴 입력을 **포함한** 입력 전체다.
  - `outputTokens`는 추론 토큰을 **포함한** 출력 전체다.
- anthropic 어댑터는 지금 `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`로 맞춘다 [코드].
- openai는 캐시 입력이 입력 안에 이미 포함되고, 추론 토큰이 출력 안에 포함된 값으로 오는 것으로 안다 [추정]. 어댑터가 이중으로 세지 않음을 시험으로 고정한다(SP-U09).
- 사용량을 모르면 `null`이다(지금 규칙). 토큰 한도 판정은 지금과 같다.

### 4.9 도구 정의 형식

- 계약의 `inputSchema`(`TOOL_DEFINITIONS`, `WORKFLOW_TOOL_DEFINITIONS`)는 JSON Schema다.
- "두 제공자가 함께 받는 부분 집합"을 계약 주석으로 정하고, 모든 도구 정의가 그 안에 있음을 시험으로 고정한다(SP-U10).
  - 후보: `type`, `properties`, `required`, `items`, `enum`, `const`, `anyOf`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `minItems`, `maxItems`, `additionalProperties: false`, `type: [.., "null"]`, `description`
  - 각 키워드를 OpenAI가 받는지는 확인 필요다(C-7).
- strict 모드(SP-D6)
  - OpenAI의 strict 함수 호출은 `additionalProperties: false`와 "모든 필드 필수(선택 필드는 null 합집합)"를 요구하고, 일부 키워드를 받지 않는 것으로 안다 [추정].
  - 우리 도구는 선택 필드가 있다(예: `write_file`의 일부).
  - 권고: **strict를 쓰지 않는다.** 인자 검증은 지금처럼 우리 검증기(`validate-args`)가 기준이다. 제공자의 형식 보장에 기대지 않는다.
- 도구 이름은 `^[a-zA-Z0-9_-]{1,64}$` 안이다 [코드: 우리 이름]. OpenAI의 이름 규칙과 맞는지 확인한다(C-7).
- 호출 id
  - 어댑터가 받은 id를 그대로 `ToolCall.id`로 쓴다.
  - 엔진이 기록할 때 AC-D15 규칙(`CALL_ID_PATTERN_SOURCE`, 64자)을 적용한다. OpenAI id가 이 규칙 밖이면 엔진이 대체 id를 쓰고, 어댑터는 다음 요청에 **원래 id**를 돌려줘야 한다.
  - 그래서 어댑터가 원래 id와 기록 id의 짝을 한 실행 동안 기억할지 정해야 한다. id 형식·길이 확인(C-8)에 따라 필요 여부가 갈린다.

### 4.10 대화 형식과 추론 항목(어댑터 안)

- 엔진의 `ModelMessage`는 중립이다. 어댑터가 제공자 형식으로 바꾼다.
- anthropic(지금)
  - `tool_use`·`tool_result` 블록을 쓴다.
  - 같은 역할이 이어지면 하나로 합친다.
  - thinking 블록은 버린다.
- openai [추정]
  - 도구 호출 결과는 호출마다 따로 싣는다(Chat Completions의 `tool` 메시지, Responses API의 `function_call_output` 항목).
  - 멈춤 이유: `stop`/`length`/`tool_calls`/`content_filter`, 또는 Responses의 `status`·`incomplete_details`
  - 거부: `refusal` 필드
- 추론 항목(SP-D8)
  - Responses API는 추론 항목(암호화된 내용 포함)을 다음 요청에 돌려주는 방식이 있다고 안다 [추정].
  - 권고: **돌려주지 않는다.** 엔진에 저장하지도 기록하지도 않는다. 가림 게이트를 거치지 않은 불투명한 내용을 다시 보내는 것을 피한다.
  - 성능 손실이 확인되면 그때 정한다.
- 저장 옵션: 제공자 쪽 응답 저장(Responses API의 `store` [추정])은 끈다(`store: false`). privacy.md에 적는다.

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
- 헤더: anthropic은 `x-api-key`, `anthropic-version`. openai는 `Authorization: Bearer` [추정].
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
- 환경 변수(SP-D5)
  - `CODARYN_MODEL`, `CODARYN_API_BASE_URL`은 고른 제공자에만 적용한다.
  - 제공자를 고르는 환경 변수(`CODARYN_PROVIDER`)는 지금 두지 않는 것을 권고한다(설정이나 task에서만 고른다).
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
- 제공자 응답 저장을 끄고, 추론 항목을 돌려주지 않는다(4.10. 확인 뒤 privacy.md에 적음).
- 모델에 보내는 내용은 지금처럼 가림 게이트를 거친 것뿐이다. 엔진은 바뀌지 않는다.
- 가짜 서버 통합에 "실제 API 아님" 표기를 붙인다. 실제 점검 스크립트(`tests/live/openai-live.ts`)는 사용자만 실행한다.

## 9. 구현 분할안 [제안]

작은 단위로 main 기준에서 만들고, 새 모듈과 보안 변경은 교차 검토 뒤 병합한다.

| 단계 | 내용 | 담당(지금 배정 기준) | 사실 확인 필요 | 완료 기준 |
| --- | --- | --- | --- | --- |
| SP-0 | 고정 시험 P-1~P-8을 지금 main에 넣는다 | 제공자(w3:p9), CLI(w3:p2) | 아니오 | 고정 시험 통과, 제품 코드 변경 없음 |
| SP-1 | 계약: 제공자 표(anthropic만), 이름 목록 상수, `ResolvedApiSettings`와 별칭, `ModelOutcome.httpStatus`, 사용량·오류 종류 주석. 손으로 적은 목록 4곳이 상수를 쓴다 | 계약(w3:p9). 목록 4곳은 각 담당 | 아니오 | typecheck, 고정 시험 그대로 |
| SP-2 | 보안: S-2 일반화, 키 모양 목록 사용(keys, text-safety, i18n params, 출력 정리), 커밋 훅 | CLI(w3:p2), N-B(w3:p5), 제공자(w3:p9), 훅은 PM | openai 키 변수 이름·모양(C-3) | 두 키가 있을 때 둘 다 가려지는 재현 시험, 고정 시험 그대로, 보안 교차 검토 |
| SP-3 | 공용 HTTP 모듈 분리, anthropic 어댑터를 그 위로, `httpStatus` 채움. CLI Y-4가 `httpStatus`를 본다 | 제공자(w3:p9). Y-4는 CLI | 아니오 | 고정 시험 그대로, 공용 모듈 유닛, 교차 검토 |
| SP-4 | 설정·task 스키마(`provider`, `providers`), 해석기 일반화, 간편 형식·프로필·환경 변수 적용, cli-contract 개정 | 계약(w3:p9), CLI(w3:p2), 문서(N-A) | 아니오(openai 항목 값은 SP-5) | P-7 그대로, 새 스키마 유닛, 하위 호환 시험 |
| SP-5 | openai 어댑터(가짜 전송 유닛 → 가짜 서버 통합), 표에 openai 항목, 모델 목록 | 제공자(w3:p9), 통합(G-G w3:p4) | 예(11절 전부) | 어댑터 유닛, 가짜 서버 통합, 공용 불변식 시험 |
| SP-6 | 연결: CLI(`models --provider`, doctor, init, run, report, runs, human), 앱 계층 교체점, 문구, 문서 M1~M14, GUI 설정 | CLI, A-1(w3:pA), N-B, N-A, GUI(w3:pB) | 일부 | 통합 회귀, 교차 검토 |
| SP-7 | 실제 점검 스크립트(사용자 실행) | 제공자(w3:p9), 실행은 사용자 | 예 | 사용자 실행 기록 |

- 의존: SP-0 → SP-1 → (SP-2, SP-3 함께 가능) → SP-4 → SP-5 → SP-6 → SP-7.
- SP-0~SP-4는 OpenAI 사실 확인을 기다리지 않아도 된다. SP-2의 openai 항목만 C-3 확인 뒤에 넣는다.

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
| SP-U08 | openai 요청 | 본문 형식, 도구 정의, 도구 결과의 호출별 싣기, 출력 상한 매개변수, `store: false`, 추론 항목 미전송 |
| SP-U09 | openai 응답 | 멈춤 이유, 거부, 도구 호출, 사용량의 이중 계산 없음, 할당량 소진 |
| SP-U10 | 도구 정의 부분 집합 | 모든 도구의 `inputSchema`가 계약의 공통 부분 집합 안이다 |
| SP-U11 | 호출 id | 규칙 밖 id에서 기록은 대체 id, 다음 요청에는 원래 id(C-8 결과에 따라) |

통합(가짜 서버, "[모의 API·실제 API 아님]")
| ID | 사례 | 기대 |
| --- | --- | --- |
| SP-I01 | anthropic 기존 통합 전체 | 고치지 않은 채 통과 |
| SP-I02 | openai 설정으로 `run`(도구 호출 → 결과 → 완료) | `done`/`verified`. 기록에 키 없음 |
| SP-I03 | 두 키가 다 있는 환경에서 anthropic 실행. 작업 파일에 openai 키 값이 있다 | 기록·결과·출력에 그 값이 없다 |
| SP-I04 | openai 429(빈도)·할당량·503·401 | 재시도와 종류가 표대로 |
| SP-I05 | `models --provider openai`, `doctor`(openai) | 제공자 이름과 키 변수가 맞게 보인다 |

## 11. 확인 필요(OpenAI 쪽 사실, 모두 [추정])

PM이 공식 문서로 확인해 기록한다. 작업자는 네트워크를 쓰지 않는다.

| # | 확인할 것 | 지금의 추정 | 쓰는 곳 |
| --- | --- | --- | --- |
| C-1 | 어느 API를 쓰는가: Responses API(`/v1/responses`)와 Chat Completions(`/v1/chat/completions`). "Codex 계열" 모델이 어느 쪽에서 되는가 | Codex 계열 일부는 Responses API에서만 된다 | SP-D2, 어댑터 형식 전체 |
| C-2 | 인증 헤더와 추가 헤더 | `Authorization: Bearer <key>`. 조직·프로젝트 헤더(`OpenAI-Organization`, `OpenAI-Project`)는 선택 | 공용 전송 "헤더에만 키", 4.2 |
| C-3 | 키 변수 이름과 키 형식·길이 | `OPENAI_API_KEY`. `sk-proj-…`, `sk-svcacct-…`, 예전 `sk-…`. 길이 수십~백여 자 | 4.1, 4.3, 커밋 훅 |
| C-4 | 기본 주소와 경로 | `https://api.openai.com/v1` + 엔드포인트 | 4.4 |
| C-5 | 오류 본문과 상태 | `{"error":{"message","type","param","code"}}`. 401·403·404·429·500·503. 할당량 소진은 429와 `code: "insufficient_quota"` | 4.7, SP-D7 |
| C-6 | 재시도 관련 헤더 | `retry-after`(있을 때), `x-ratelimit-*`, `x-request-id` | 공용 재시도, 오류 인용 |
| C-7 | 도구 정의 스키마 | 함수 정의에 JSON Schema. strict 모드는 `additionalProperties: false`·전 필드 필수·일부 키워드 미지원. 이름 `^[a-zA-Z0-9_-]{1,64}$` | 4.9, SP-D6 |
| C-8 | 도구 호출 id 형식·길이, 한 응답의 여러 호출 | `call_…` 같은 형식, 64자 안. 한 응답에 여러 호출 가능 | 4.9, AC-D15 대응 |
| C-9 | 사용량 필드와 포함 관계 | Chat: `prompt_tokens`·`completion_tokens`·`prompt_tokens_details.cached_tokens`·`completion_tokens_details.reasoning_tokens`. Responses: `input_tokens`·`output_tokens`와 같은 상세. 캐시·추론은 이미 포함 | 4.8 |
| C-10 | 출력 상한 매개변수와 멈춤 이유 | Chat: `max_completion_tokens`(추론 모델), `finish_reason`. Responses: `max_output_tokens`, `status`·`incomplete_details.reason` | 어댑터, 출력 상한 |
| C-11 | 추론 항목과 응답 저장 | Responses는 추론 항목을 돌려줄 수 있다(`include`로 암호화 내용). `store` 기본값은 켜짐 | 4.10, SP-D8, privacy.md |
| C-12 | 모델 이름과 목록 API | `GET /v1/models` → `{"object":"list","data":[{"id","object","created","owned_by"}]}`, 쪽 넘김 없음. Codex 계열 모델 id는 확인 필요 | 4.6, 기본 모델 안내 |
| C-13 | 요청 크기·시간 상한 | 큰 요청의 상한과 긴 응답 시간 | `requestTimeoutMs` 기본값 |
| C-14 | 제공자 쪽 데이터 보존 | API 요청 자료의 보존·학습 사용 정책(계정 설정 포함) | privacy.md, 사용 문서 |
| C-15 | 거부와 내용 필터 표시 | `refusal` 필드, `content_filter` 멈춤 | 응답 해석 |

## 12. 결정 필요

| # | 결정 | 권고 |
| --- | --- | --- |
| SP-D1 | 제공자 이름 | `openai`. "codex"는 모델 계열 이름이라 제공자 이름으로 쓰지 않는다 |
| SP-D2 | 쓸 API(C-1 뒤) | Codex 계열이 되는 쪽. 둘 다 되면 Responses API(도구·추론 형식이 앞으로의 기준이라 [추정]) |
| SP-D3 | 설정 형식 | 6절. 최상위 = anthropic(하위 호환), `providers.<name>`, 최상위와 `providers.anthropic`을 함께 쓰면 거부 |
| SP-D4 | S-2 일반화 | 알려진 모든 키 값을 늘 등록한다. 가장 먼저 한다 |
| SP-D5 | 환경 변수 | `CODARYN_MODEL`·`CODARYN_API_BASE_URL`은 고른 제공자에만. `CODARYN_PROVIDER`는 두지 않는다 |
| SP-D6 | strict 도구 스키마 | 쓰지 않는다. 우리 인자 검증이 기준 |
| SP-D7 | 할당량 소진 | 새 종류 `quota_exhausted`(재시도 없음). C-5 확인 뒤 |
| SP-D8 | 추론 항목과 응답 저장 | 돌려주지 않고, 저장을 끈다 |
| SP-D9 | 출력 상한 | 제공자 표의 `maxOutputTokensLimit`. 공통 절대 상한은 두지 않는다 |
| SP-D10 | 프로필의 `provider` | 둔다(GUI의 "모델 선택"과 맞음). SP-4에서 |
| SP-D11 | 404 안내 | `httpStatus`로 판단. 새 종류 없음 |
| SP-D12 | 문구의 키 변수 이름 | 닫힌 매개변수 종류 `keyEnv`(값은 `API_KEY_ENVS`만). N-14 규칙 안 |
| SP-D13 | `init`의 제공자 질문 | UX 담당이 정한다. 기본은 anthropic 그대로 |

## 13. 다른 문서와 맞출 점

- [cli-contract.md](../cli-contract.md): 진입 함수 표, 간편 형식의 제공자, 키 검사 한계, 주소 규칙, 환경 변수 표, 해석 결과 이름, 토큰 한도 규칙, `models` 절(조사 M1~M8). SP-4·SP-6에서.
- [architecture.md](../architecture.md): 모듈 표, 실행 전 단계의 S-2, 6절 "Anthropic 모델 어댑터"를 "모델 어댑터와 공용 HTTP"로(M9, M10).
- [privacy.md](../privacy.md): S-2 서술, "키는 헤더에만", "외부 경로는 고른 제공자 하나", 응답 저장 끔과 추론 항목(M11, M12).
- [usage.md](../usage.md): 키·환경 변수 표, task 모델 형식, 간편 형식, doctor 출력 예, `models`(M13, M14).
- `scripts/check-secrets.mjs`(PM), `tests/live/README.md`(실제 점검 절차).
- [설계 문서 색인](README.md)에 이 문서를 더한다(PM).
