# Anthropic 고정값 변경 검토

- 범위: `git diff --stat main...pm/bundle-3`에서 고른 `tests/unit/cli/sp0-expected.ts`, `tests/unit/model/anthropic/sp0-golden.ts`의 diff만 읽었다. 해당 디렉터리에서 이름에 pin이 든 별도 변경 파일은 stat에 없었다.
- 줄 번호: `pm/bundle-3` 쪽 diff 기준. 집계는 변경된 기대값 항목 하나를 1곳으로 계산한다. 한 JSON 기대값 안의 관련 필드 변경은 아래에 모두 풀어 썼다.
- 결과: **(가) 3곳, (나) 2곳, (다) 0곳**.

| 분류 | 파일:줄 | 기대값 항목 | 옛 값 → 새 값의 요지 |
| --- | --- | --- | --- |
| (가) | `tests/unit/model/anthropic/sp0-golden.ts:208` | `p3Retries.unauthorized.outcome.message` | `HTTP 401 authentication_error: invalid x-api-key` → `HTTP 401: the key or its access was refused; the provider's message is not shown`. 기존 request id 접미사는 유지. |
| (가) | `tests/unit/model/anthropic/sp0-golden.ts:218` | `p3Retries.forbidden.outcome.message` | `HTTP 403 permission_error: no` → 위와 같은 고정 문구의 HTTP 403 버전. 기존 request id 접미사는 유지. |
| (가) | `tests/unit/model/anthropic/sp0-golden.ts:723` | `p6Models.errorOnSecondPage.outcome.message` | `HTTP 401 authentication_error: bad` → 위와 같은 고정 문구의 HTTP 401 버전. request id와 `(page 2)` 접미사는 유지. |
| (나) | `tests/unit/cli/sp0-expected.ts:301` | `p8["doctor --json"]`의 api_key 점검 | `text.id`: `doctor.api_key.ok` → `doctor.api_key.sends_to_default`. `text.params`: 기존 `{ keyEnv: "ANTHROPIC_API_KEY" }`에 `provider: "anthropic"`, `origin: "https://api.anthropic.com"` 추가. keyEnv 자체는 이미 있었으며 바뀌지 않았다. 키 전송 주소를 나타내는 구조화 문구로 변경된 경우다. |
| (나) | `tests/unit/cli/sp0-expected.ts:302` | `p8["doctor text"]`의 API key 행 | `ANTHROPIC_API_KEY is set (its value is not looked at)` → `ANTHROPIC_API_KEY is set; anthropic requests send it to https://api.anthropic.com, the default address`. 기존 괄호 설명을 기본 전송 주소 설명으로 교체. |

JSON doctor의 api_key `message`에는 기존부터 `anthropic requests send it only to https://api.anthropic.com (the default address)`가 들어 있었고 이번 diff에서 이 문자열은 변경되지 않았다. 그 밖의 doctor 점검 항목·상태·종료 코드도 해당 diff에서 동일하다. 인증 오류의 `ok`, `kind: auth_failed`, `httpStatus` 역시 그대로다.

`sp0-golden.ts:11`에 세 인증 오류 문구의 의도적 변경을 설명하는 주석이 추가되었으나, 동작 기대값 변경이 아니므로 별도 장소로 집계하지 않았다. **(다)에 해당하는 고정값 변경은 없다.**

검증 한계: diff의 기대값 변경만 확인했다. 구현 동작과 테스트 통과 여부는 확인하지 않았으며 테스트·실제 API·외부 네트워크는 실행하지 않았다. 요청된 보고서 외 파일 수정과 커밋은 하지 않았다.
