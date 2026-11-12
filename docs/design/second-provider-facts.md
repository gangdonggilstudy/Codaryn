# 두 번째 제공자: OpenAI API 사실 확인

PM(w3:p1)이 2026-11-12에 OpenAI 공식 문서로 확인한 내용이다. [두 번째 제공자 설계](second-provider.md)의 "확인 필요" C-1~C-15에 대한 답이다. 작업자는 네트워크를 쓰지 않으므로 이 문서를 사실의 기준으로 삼는다.

- 확인 방법: 공식 문서(`developers.openai.com/api/docs`, `developers.openai.com/api/reference`, 공식 Node SDK 소스)를 요약 도구로 읽었다. 긴 참조 쪽은 일부만 읽었다.
- 표기: **[확인]** 공식 문서에서 확인, **[미확인]** 공식 문서에서 찾지 못함(추측하지 않는다).
- 실제 API는 호출하지 않았다. 아래는 문서의 서술이며 동작을 실행으로 확인한 것이 아니다.

## 가장 중요한 사실

- **[확인] API에서 쓸 수 있는 현행 "Codex 계열" 모델 id는 없다.** 이름에 codex가 든 id는 모두 지원 종료되었거나 종료 예정이다. 아직 부를 수 있는 것은 `gpt-5.3-codex` 하나이고 2027-04-01에 종료된다(대체 `gpt-6-sol`).
- **[확인] Codex 제품이 지금 권하는 모델은 일반 모델이다**(`gpt-6-astra`, `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-luna`). 어떤 id를 실제로 부를 수 있는지는 조직·프로젝트에 따라 다르며 `GET /v1/models`로 확인한다([미확인] 특정 조직의 가용 여부).
- 따라서 "Codex 지원"은 **OpenAI 제공자(Responses API)를 더하고 모델 id는 사용자가 고르게 하는 것**으로 구현한다. Codaryn은 모델의 코드 기본값을 두지 않으므로(C-3) 특정 모델 이름을 코드에 넣지 않는다.

## 항목별

| # | 사실 | 표기 |
| --- | --- | --- |
| C-1 | Responses API(`POST /v1/responses`)를 쓴다. 새 프로젝트에 권장되고, `gpt-5.3-codex`는 Chat Completions를 지원하지 않으며, GPT-6 계열은 도구 호출에 Responses가 필요하다 | 확인 |
| C-2 | `Authorization: Bearer <키>`. 선택 헤더 `OpenAI-Organization`, `OpenAI-Project` | 확인 |
| C-3 | 환경 변수 `OPENAI_API_KEY` | 확인 |
| C-3 | 키 접두사(`sk-proj-`, `sk-svcacct-`, `sk-admin-`, 예전 `sk-`), 길이, 문자 집합 | 미확인(공식 문서에 없음). 길이·문자로 키를 검증하지 않는다. 가림과 커밋 검사에는 느슨한 `sk-` 모양만 쓴다 |
| C-4 | `https://api.openai.com/v1`, `POST /v1/responses`, `GET /v1/models` | 확인 |
| C-5 | 오류 본문 `{ "error": { message, type, code, param } }`. 상태 400, 401, 403, 404, 409, 413, 422, 429, 500, 503 | 확인 |
| C-5 | 429의 구분: 재시도할 수 있는 한도 초과는 type `rate_limit_error`(code `slow_down`)이거나 code가 없다. 재시도해도 풀리지 않는 과금·할당량은 `error.code`가 `credit_balance_exhausted`, `organization_spend_limit_exceeded`, `project_spend_limit_exceeded`, `organization_usage_limit_exceeded` 중 하나이거나 `error.type`이 `insufficient_quota`다 | 확인 |
| C-5 | `error.code == "insufficient_quota"` | 미확인(지금 문서는 type으로 적는다). 예전 형식으로만 함께 맞춘다 |
| C-6 | `Retry-After`(초, 최소 대기. 429와 503에 올 수 있다), `x-ratelimit-limit-*`, `x-ratelimit-remaining-*`, `x-ratelimit-reset-*`(requests, tokens, project-tokens), `x-request-id` | 확인 |
| C-7 | 도구 정의는 평평한 모양이다: `{ "type": "function", "name", "description", "parameters", "strict" }`. `strict`를 생략하면 스키마를 strict로 맞추려 한다. `strict: false`로 끈다. strict는 모든 객체에 `additionalProperties: false`와 모든 속성의 `required`를 요구한다 | 확인 |
| C-7 | 함수 이름 규칙: 참조 문서에 최대 128자가 보이나 최상위 함수 도구의 패턴은 직접 확인하지 못했다 | 일부 확인. `^[a-zA-Z0-9_-]{1,64}$` 안에 두면 안전하다 |
| C-8 | 도구 호출은 `output`의 항목이다: `{ "type": "function_call", "id", "call_id", "name", "arguments"(JSON 문자열) }`. 결과는 다음 요청 `input`에 `{ "type": "function_call_output", "call_id", "output"(문자열) }`로 보낸다. 짝은 `id`가 아니라 `call_id`로 맞춘다 | 확인 |
| C-8 | 한 응답에 여러 호출이 올 수 있다. `parallel_tool_calls: false`로 0개 또는 1개로 제한한다(기본 true) | 확인 |
| C-8 | 호출 id의 형식과 길이 | 미확인. 불투명한 문자열로 다룬다 |
| C-9 | `usage`: `input_tokens`, `input_tokens_details.cached_tokens`, `output_tokens`, `output_tokens_details.reasoning_tokens`, `total_tokens`. 추론 토큰은 출력 토큰으로 과금되고 예시에서 `output_tokens` 안에 들어 있다 | 확인(포함 관계는 예시와 과금 서술에서 읽음) |
| C-10 | 출력 상한은 `max_output_tokens`(추론 토큰 포함, 최소 16). 응답 `status`는 `completed`, `failed`, `in_progress`, `cancelled`, `queued`, `incomplete`. `incomplete_details.reason`은 `max_output_tokens`, `max_messages`, `content_filter`, `steered` | 확인 |
| C-10 | `finish_reason`·`stop_reason`은 없다. 정상 끝과 도구 호출 끝 모두 `status: "completed"`이고, `output[]`에 `function_call` 항목이 있는지로 가른다 | 확인(구조상) |
| C-11 | 추론은 `type: "reasoning"` 항목으로 온다(원문 글은 오지 않고 `encrypted_content`가 온다). **저장 없이 이어 가는 요청에서는 응답의 `output` 항목을 모두(추론 항목 포함) 다음 요청에 돌려보내야 한다** | 확인 |
| C-11 | `store`는 생략하면 true이고 응답이 30일 저장된다. `store: false`로 끈다. `encrypted_content`는 기본으로 온다(`include`는 호환용으로만 받는다) | 확인 |
| C-12 | `GET /v1/models`는 `{ "object": "list", "data": [{ id, object, created, owned_by, shutdown_date? }] }`. 쪽 넘김 매개변수는 문서에 없다. 문맥 길이·기능은 이 응답에 없다 | 확인 |
| C-13 | 요청 본문은 최대 128 MiB이고 넘으면 413이다. 서버 쪽 시간 상한은 찾지 못했다(공식 SDK의 클라이언트 기본은 10분) | 확인 / 시간 상한은 미확인 |
| C-14 | API로 보낸 자료는 기본으로 학습에 쓰이지 않는다. 남용 감시 기록은 최대 30일 보존된다. 보존 없음(ZDR)은 OpenAI의 사전 승인이 필요하다 | 확인 |
| C-15 | 거부는 메시지 안의 내용 조각 `{ "type": "refusal", "refusal": "..." }`다. 내용 필터로 멈추면 `status: "incomplete"`, 이유 `content_filter`다. 실패한 응답은 `status: "failed"`와 `error { code, message }` | 확인 |

## 설계의 가정과 다른 점

1. **추론 항목을 돌려보내지 않는다는 권고(SP-D8)는 쓸 수 없다.** 저장을 끄고(`store: false`) 요청마다 대화를 다시 보내는 방식에서는 추론 항목을 돌려보내야 한다.
2. **할당량 소진의 구분**은 `code == "insufficient_quota"` 하나가 아니다. 위 C-5의 네 code와 `type == "insufficient_quota"`로 가른다.
3. **Codex 계열 모델 id를 전제로 삼을 수 없다.** 모델은 사용자가 `models` 목록에서 고른다.
4. `strict`를 쓰지 않으려면 생략이 아니라 `strict: false`를 보내야 한다.

## 출처

- `developers.openai.com/api/docs/guides/migrate-to-responses`, `.../models/all`, `.../deprecations`, `.../guides/function-calling`, `.../guides/structured-outputs`, `.../guides/reasoning`, `.../guides/conversation-state`, `.../guides/error-codes`, `.../guides/rate-limits`, `.../guides/your-data`, `.../guides/production-best-practices`
- `developers.openai.com/api/reference/overview`, `.../resources/responses/methods/create`, `.../resources/responses/methods/retrieve`, `.../resources/models/methods/list`
- 공식 Node SDK `src/core/error.ts`
