# H1 교차 검토: Anthropic 제공자 (읽기 전용)

- 페르소나: 보안·개인정보 검토자
- 대상: 관리용 main 0164b10
  - `src/model/anthropic/index.ts`
  - `src/cli/provider.ts`
  - `src/cli/run.ts`의 제공자 조립 부분
  - 관련 확인: `src/cli/config.ts`, `src/cli/settings.ts`, `src/engine/index.ts`
- 파일 수정과 커밋은 없습니다. 실제 API 호출과 외부 네트워크 사용도 없습니다. main과 worktree 모두 변경이 없습니다(clean).
- 실험 위치: `D:\project\Codaryn\.worktrees\claude-workspace\.codaryn\h1\` (Git 무시 대상)
  - main 소스를 `out/`에 빌드하고 `out/exp.mjs`로 실행했습니다.
  - 가짜 fetch와 127.0.0.1 로컬 서버만 썼고, 키는 가짜 값 `fake-codaryn-review-key-…`입니다.
- 실험 사례는 37개입니다. 유닛·통합 테스트는 코드 변경이 없어 실행하지 않았습니다.

## 발견

### 1. 중간(가용성, 키 유출 아님) — 응답 본문 크기 상한이 없음

- **위치:** `src/model/anthropic/index.ts:432` `response.text()`, `:453`
- **입력과 결과:**
  - 상태 400과 64MB 오류 본문: 제공자가 65MB를 전부 읽은 뒤에야 앞 4096자만 씁니다.
  - 상태 200과 끝없는 본문(로컬 서버): `requestTimeoutMs` 3000에서 RSS가 약 3.1GB 늘고 `timeout`으로 끝났습니다.
  - 기본 `requestTimeoutMs`는 600000(10분)이라, 시간 초과보다 메모리 고갈이 먼저 올 가능성이 큽니다. 이 부분은 추측입니다.
- **전제:** 엔드포인트가 잘못 동작해야 합니다. 예를 들어 config나 `CODARYN_API_BASE_URL`로 지정한 https 프록시나 loopback 서버입니다. 기본 주소(api.anthropic.com)는 신뢰 대상입니다.
- **재현:** 가짜 fetch가 N MB짜리 `ReadableStream` 본문을 돌려줄 때, 제공자가 상한(예: 수 MB)을 넘으면 읽기를 멈추고 `malformed_response`나 `api_error`를 돌려주는지 검사합니다. 지금은 끝까지 읽습니다.
- **제안:** `response.body`를 바이트 단위로 읽어 상한에서 중단하고, 오류 응답은 4096바이트만 읽습니다.

### 2. 낮음 — 재시도할 수 없는 오류를 재시도함, 깨진 키의 글자 하나가 메시지에 노출

- **위치:** `index.ts:418`(전송 실패를 모두 `retryable: true`로 분류), `:139-141`(키 문자 검사 없음), `src/cli/settings.ts:27`(앞뒤 공백 제거만 함)
- **입력과 결과:**
  - 키에 제어 문자가 있을 때(`fake-key-0000\u0007…`): 요청을 보내기 전에 fetch가 실패합니다(`invalid x-api-key header`). 그런데도 같은 실패를 백오프 500ms와 1000ms를 두고 3번 시도합니다. 서버 도달은 0회입니다.
  - 키에 한글이 있을 때: `TypeError`가 나서 역시 3번 시도합니다. 메시지에 `character at index 9 has a value of 54620`이 남아 키의 위치 하나와 글자 하나가 노출됩니다. 정상 키는 ASCII뿐이라 실제 영향은 작습니다.
  - 키에 Latin-1 문자가 있을 때(`é`): 헤더로 그대로 전송됩니다.
- **재현:** `apiKey`에 `\u0007`을 넣으면 fetch 호출이 1회여야 하고 메시지에 키 문자나 위치가 없어야 합니다. 지금은 3회이고, 한글이면 위치와 코드값이 남습니다.
- **제안:** 설정 단계에서 키를 헤더에 안전한 ASCII로 제한해 전송 전에 거부하고, fetch의 `TypeError`(형식 오류)는 재시도하지 않습니다.

### 3. 낮음 — 키를 변형해 되돌려 주면 가림 처리를 통과함

- **위치:** `index.ts:98-135`. 8자 조각 검사가 제어 문자 정리(`:131`)보다 먼저 실행됩니다.
- **입력과 결과(401 오류 본문에 키를 다시 넣은 경우):**
  - 키 전체나 공백으로 두 조각: `[redacted]`로 가려집니다.
  - 7자마다 줄바꿈: `fake-co daryn-r eview-k …`처럼 전부 보입니다.
  - 키의 Base64: 가려지지 않습니다.
- **전제:** 엔드포인트가 키를 변형해 돌려줘야 합니다. 공식 API는 그렇게 하지 않을 것으로 봅니다(추측).
- **확인 못 한 점:** 제공자 오류 메시지가 기록이나 CLI 출력 전에 privacy 게이트(키가 비밀로 등록되고 Base64 변형도 가림)를 다시 지나는지는 추적하지 않았습니다.
- **재현:** 401 본문에 `KEY.match(/.{1,7}/g).join("\n")`을 넣으면 결과 메시지에 키 조각이 남습니다.

### 4. 낮음 — `apiBaseUrl` 끝의 `?`나 `#`로 경로가 바뀜 (같은 호스트, 키 유출 아님)

- **위치:** `src/cli/config.ts` `normalizeApiBaseUrl`, `index.ts:168-171`
- **원인:** 단독 `?`, `#`은 `search`와 `hash`가 빈 문자열이라 거부되지 않습니다. 반면 `href`에는 그대로 남습니다.
- **입력과 결과:**
  - `https://api.anthropic.com/x?` → 요청 URL `…/x?/v1/messages`. 경로가 쿼리로 바뀝니다.
  - `…/x#` → fragment가 버려져 `/x`로 POST합니다.
- **재현:** `normalizeApiBaseUrl("https://h.test/x?")`가 `null`이어야 하는데 지금은 값을 돌려줍니다.

### 5. 정보 — 일관되지 않은 성공 응답을 제공자가 ok로 넘김 (엔진이 막음)

- **위치:** `index.ts:317-327`
- **입력과 결과:** 다음 응답이 모두 `ok:true`입니다.
  - `stop_reason: end_turn`인데 `tool_use`가 있음
  - `max_tokens`인데 `tool_use`가 있음(잘린 입력일 수 있음)
  - `role: "user"`
- **판단:** 엔진(`src/engine/index.ts` 약 422-425줄)은 `stop`이 `tool_calls`가 아닌데 도구 호출이 있으면 `malformed`로 끝내므로 도구가 실행되지 않습니다. 방어가 엔진 한 겹에만 있다는 점만 남깁니다.

### 6. 정보 — thinking 블록을 다음 요청에 보내지 않음

- **위치:** `index.ts:9`, `:307-312`
- **판단:** claude-api 스킬 문서(캐시 2026-11-03)에 따르면, 블록을 모두 빼는 것은 서명 검사(400) 대상이 아닙니다. 다만 thinking이 항상 켜진 모델(Opus 5.5, Fable 등)에서 턴 사이 추론이 이어지지 않습니다. 실제 API로는 확인하지 않았습니다. 보안이 아니라 품질 문제입니다.

### 7. 정보 — 시간 초과 뒤 POST를 재시도함

서버가 이미 처리한 요청을 다시 보내 중복 처리나 과금이 생길 수 있습니다. 공식 SDK의 기본 동작과 같습니다.

## 문제 없던 범위 (실험으로 확인)

- **키 위치:** `x-api-key` 헤더에만 있습니다. URL과 요청 본문에는 없습니다. run.ts는 키를 비밀 목록에 추가해 파일이나 명령 출력에 나타나면 가립니다.
- **리디렉션:** 301, 302, 303, 307, 308 모두 따라가지 않았습니다(`redirect: "manual"`). 두 번째 로컬 서버의 수신은 0회였고, 결과는 재시도 없는 `api_error`와 고정 문구입니다.
- **`apiBaseUrl` 검증:** 다음 입력은 모두 거부됐습니다.
  - `http://localhost.evil.test`
  - `http://[::ffff:127.0.0.1]`
  - 사용자 정보 포함 URL

  `http://127.1`은 `127.0.0.1`로 정규화되므로 loopback이라 문제없습니다. 작업 파일은 이 값을 바꿀 수 없습니다. env `CODARYN_API_BASE_URL`, 또는 `--config`나 `CODARYN_CONFIG`로 지정한 설정 파일만 바꿀 수 있고, 작업 공간 안의 설정을 자동으로 찾지 않습니다.
- **재시도:**
  - 시도 횟수는 정확히 `maxRetries+1`입니다.
  - 400, 401, 404, 413은 재시도하지 않습니다.
  - 429의 `Retry-After`는 60초로 상한이 걸립니다.
  - 5xx 전체를 재시도하는데, 스킬 문서의 SDK 기본 동작(408/409/429/5xx와 연결 오류)과 같습니다.
- **시간 초과와 취소:**
  - 시간 초과 타이머는 본문 읽기까지 덮습니다. 끝없는 본문 실험이 3004ms에 `timeout`으로 끝났습니다.
  - 재시도 대기 중 취소하면 `aborted`입니다.
  - 실행 시간 한도는 엔진의 `runSignal`로 전달됩니다.
- **응답 변환:**
  - `usage`가 깨지면(문자열 숫자 등) `null`이 됩니다. 토큰 한도가 있으면 엔진이 `budget-exhausted`(`usage_unknown`)로 끝냅니다.
  - `refusal`은 `api_error`, `pause_turn`과 알 수 없는 블록은 `malformed_response`입니다.
- **예외와 메시지:** 제공자는 예외를 던지지 않습니다(바깥 감싸기). 모든 메시지는 가림 처리와 300자 자르기를 거칩니다. run.ts는 팩토리 예외를 키 없는 고정 문구로 바꿉니다.
- **API 버전:** `anthropic-version: 2026-10-21`은 스킬 문서상 유효한 버전입니다.

## 검사하지 않은 범위

- 실제 API 호출(금지)
- 스트리밍(사용하지 않음)
- 사용자 환경 변수가 바꾸는 동작(추측):
  - `NODE_USE_ENV_PROXY`와 `HTTP(S)_PROXY`: http loopback 기본 주소가 프록시를 거치면 키가 평문으로 나갈 수 있습니다.
  - `NODE_TLS_REJECT_UNAUTHORIZED=0`: TLS 검증이 꺼집니다.
- 제공자 오류 메시지가 privacy 게이트를 거쳐 기록되는 경로(3번의 추가 보호 여부)
