# R-25 보안 검토: 기존 Anthropic 동작을 바꾸는 변경 (pm/bundle-3)

- **대상**
  - 고정 판: `pm/bundle-3` **`005e10b72c878cf0a453f08526815fd66a427517`**
  - 비교 기준: main **`e75726e`**
- **범위 커밋**
  - `ec170c0`: 계약, 좁힌 거부 모양, DR-36 (c)
  - `3e7fc8d`, `c44786f`: CLI 시험 고정 값
  - `bd50e66`: 401·403 고정 문구, DR-37 (a)
  - `12c795a`: 키 재료 검사 길이 상한, DR-36 (d)
  - `8f4de51`, `2bffd6f`: P-8 고정 값, DR-36 (b)
- **대조 결정**: DR-36 (c)(d), DR-37 (a) (`docs/work-orders/phase-4-5-design.md`)
- **방법**
  - `git archive`로 두 판을 `.codaryn/r25/main`, `.codaryn/r25/src`에 풀고 각각 빌드했다(typecheck 0).
  - 실제 CLI(`dist/src/cli/main.js`)를 그 판의 net-guard(`--import dist/tests/support/net-guard.js`)를 붙여 실행했다.
  - 가짜 서버는 127.0.0.1만 썼다. 모든 경우에 net-guard의 루프백 밖 기록은 0건이었다.
  - 가짜 키는 실행 때 조각을 이어 만들었다. 실제 형식 길이를 썼다: 접두사, `api03-`, 93자(끝 `AA`).
  - 실제 API·외부 네트워크·키 파일은 쓰지 않았다. 저장소 파일 수정과 커밋도 없다.
  - 실험 스크립트는 `.codaryn/r25/exp/`에 있다. 아래 표기에서 "접두사"는 `sk-` 다음에 `ant-`가 붙은 것이다(키 모양을 피하려고 나눠 적는다).

## 요약

| 심각도 | 건수 | 항목 |
|---|---|---|
| 높음 | 0 | |
| 중간 | 1 | M-1 끊긴 키가 등록돼 있어도 거부를 빠져나간다 (main 대비 회귀) |
| 낮음 | 2 | L-1 앞 글자에 붙은 키(등록 값이 없을 때), L-2 좁힌 거부 모양의 제곱 시간 |
| 정보 | 3 | I-1 모델 목록의 긴 display_name, I-2 요청 id의 짧은 조각, I-3 실행 인증 실패 문구가 journal에만 있음(기존) |

- 401·403 고정 문구(DR-37 (a))는 의도대로 동작한다. 제공자 문구, 오류 종류, 키의 어떤 조각도 출력·기록에 남지 않는다. 요청 id는 남는다.
- 출력 가림용 넓은 모양은 그대로다.
- 고정 값은 담당자가 밝힌 다섯 곳만 바뀌었다.

## 발견

### M-1 (중간) 줄바꿈이나 보이지 않는 문자로 끊긴 키는 환경에 등록돼 있어도 거부를 빠져나간다. 제공자에게 보내지고 기록에 남는다 (main은 거부)

**재현.** `--goal`에 키를 넣고 키의 26번째 자리(접두사 뒤 18자째 다음)에 문자 하나를 넣었다. 환경의 `ANTHROPIC_API_KEY`는 같은 키다.

| 경우 | main `e75726e` | 고정 판 `005e10b` |
|---|---|---|
| A2 영폭 공백(U+200B) | `key_in_file`, 요청 0건 | 실행됨(needs-input), 요청 1건 |
| A3 줄바꿈(LF) | `key_in_file`, 요청 0건 | 실행됨, 요청 1건 |
| A16 soft hyphen(U+00AD) | `key_in_file`, 요청 0건 | 실행됨, 요청 1건 |
| A10 openai 실행, Anthropic 키 없음, 영폭 공백 | `key_in_file`, 요청 0건 | 실행됨: OpenAI 요청(가짜 서버)에 Anthropic 키 조각 |
| A13 openai, 줄바꿈이 45번째 자리 | `key_in_file` | `key_in_file` (앞 조각이 32자 이상이라 모양에 맞음) |
| A15 openai, 줄바꿈이 12번째(`api03` 안) | 통과 | 통과 (두 판 모두 놓치는 기존 한계) |

- 고정 판에서 실행된 경우, 요청 본문과 journal의 `model_request.newMessages[0].content`에 남은 것:
  - 키의 8자 조각들
  - 끝 7자와 끝 4자
  - 끊긴 뒤 81자(106자 중)
- stdout·stderr에는 없다. 출력 가림이 동작한다.

**원인.**
- 좁힌 거부 모양은 한 덩어리 안에서 접두사 뒤 32자 이상을 요구한다. 끊긴 앞 조각은 18자라서 맞지 않는다. main의 넓은 모양은 8자로 잡았다.
- 등록 값 대조(`src/cli/security/keys.ts`의 `keyMatcher`)는 `text.includes(value)`다. 구분 문자를 빼지 않고 그대로 비교한다.
  - 그래서 계약 주석(`src/contracts/config.ts` 307~311행, "the registered value still finds them")의 전제가 끊긴 글에는 맞지 않는다.
- 실행의 비밀 가림도 등록 값의 정확한 일치만 본다. 그래서 끊긴 키가 요청과 기록에 그대로 간다.
  - 이 기제는 원래 있던 것이다. 이번 변경으로 거기까지 오는 입력이 늘었다.
- 놓치는 범위: 끊긴 자리가 접두사 뒤 32자 안(실제 형식에서 키 앞 38자 안)일 때.

**DR 대조.**
- DR-36 (c)는 평범한 이름의 오탐을 줄이는 것이 목적이고, 등록 값이 주 방어라는 전제에 선다.
- 그 전제가 끊긴 글에서 성립하지 않아 main보다 약해졌다.

**제안** (계약 w3:p9, CLI w3:p2)
1. `keyMatcher`의 등록 값 비교를 구분 문자를 뺀 글에서도 한다(`src/model/http`의 `SEPARATOR_RUN`과 같은 방식).
   - 16자 이상 값의 비교라 오탐 걱정이 거의 없다.
   - 실험(`exp/compact-check.mjs`): 영폭 공백·LF·CRLF·NBSP·word joiner·탭은 이 방식으로 잡힌다.
   - **soft hyphen(U+00AD)은 `SEPARATOR_RUN`에 없어 못 잡는다.** 구분 문자 집합에 U+00AD를 더한다(가능하면 서식 문자 `\p{Cf}` 전체).
2. 등록되지 않은 끊긴 키(A10)도 잡을지는 PM 질문 1.
3. 재현 시험: A2, A3, A16, A10. 실험의 입력 그대로 쓸 수 있다.

### L-1 (낮음) 앞 글자·숫자·`_`에 붙은 키는 등록 값이 없으면 키 전체가 제공자에게 가고 기록에 남는다 (main은 거부)

| 경우 | main | 고정 판 |
|---|---|---|
| A4 goal `x`+키, 환경엔 다른 Anthropic 키 | `key_in_file` | 실행됨: 요청과 journal에 키 전체 |
| A9 openai 실행, Anthropic 키 없음, goal `x`+키 | `key_in_file` | 실행됨: OpenAI 요청과 journal에 키 전체 |
| A11 openai, goal에 글자 그대로의 `\n`(두 글자) 뒤 키 | `key_in_file` | 실행됨: 키 전체 |
| A6 task 파일 goal `MY_`+키, 환경엔 다른 키 | `key_in_file` | 실행됨: 키 전체 |
| A5 goal `x`+키, 환경에 같은 키 | `key_in_file` | `key_in_file` (등록 값이 잡음) |
| A12 한글 바로 뒤 키(`키는`+키) | `key_in_file` | `key_in_file` (한글은 단어 문자가 아님) |

**원인.**
- 단어 시작 조건 `\b` 때문이다. R-20 F의 `ri`+접두사+`colony-…-2024-…` 오탐을 없애려고 넣었다.
- 계약 주석과 시험(`g-provider-table` "glued to a letter: no word start (a miss left to the registered value)")이 이를 알려진 한계로 고정했다.
- 그러나 등록 값이 없는 경우가 실제로 있다. 그때는 주 방어가 없고, 결과는 키 전체의 제3자 전송과 평문 기록이다.
  - OpenAI 실행에 Anthropic 키를 설정하지 않은 경우
  - 환경 키와 다른 Anthropic 키(옛 키, 남의 키)를 넣은 경우
- DR-36 (c)의 문구는 "32자 이상이고 숫자가 들어 있을 때"다. 단어 시작 조건은 커밋 메시지와 주석에만 있다.
- 붙는 일은 드물다(글자 그대로의 `\n`·`\t`, `MY_` 같은 이름). 그래서 낮음으로 둔다.

**제안.** 단어 시작 조건 없는 두 번째 갈래로 실제 키의 형식 부분을 잡는다.
- 형태: 접두사, 소문자 2~8자, 숫자 2자, `-`, 32자 이상. 정규식은 `exp/format-branch.mjs`에 있다.
- 실험 결과:
  - R-20 F의 평범한 이름 14개(`g-provider-table`의 목록)에는 하나도 맞지 않는다.
  - `api03-`·`admin01-`·`oat01-` 형식의 붙은 키 세 가지(`x`, `MY_`, 글자 그대로의 `\n` 뒤)는 모두 잡는다.
  - 256 KiB 공격 글에서 0.4 ms다.
- 판단은 PM 질문 2.

### L-2 (낮음) 좁힌 거부 모양의 검사 시간이 입력 길이의 제곱으로 는다 (main은 선형)

**재현 1. 모양 단독** (`exp/regex-time.mjs`, 접두사를 숫자 없이 반복한 글)

| 크기 | main 거부 모양 | 고정 판 거부 모양 | 고정 판 `rawTextHoldsKey` |
|---|---|---|---|
| 16 KiB | 0 ms | 27 ms | 52 ms |
| 64 KiB | 0 ms | 420 ms | 846 ms |
| 256 KiB | 2 ms | 6,694 ms | 13,497 ms |

**재현 2. 실제 CLI.** 같은 글 256 KiB를 task 파일로 주고 `codaryn run --task`를 실행했다.
- 고정 판: **13.6 s** 뒤 `invalid_task`
- main: **157 ms**(`key_in_file`)
- CLI는 task·설정 파일을 크기 상한 없이 읽는다(`src/cli/main.ts:79`). 1 MiB면 약 16배(수 분) 걸린다.

**영향을 받지 않는 곳.**
- 출력 가림(`KEY_MASK_SHAPE_SOURCE`, i18n 매개변수): 넓은 모양이 먼저 맞아서 0 ms다.
- 모델 쪽 redactor와 키 재료 검사: 4096자로 묶여 있다.

**원인.** 전방 탐색 `(?=[A-Za-z0-9_-]*[0-9])`이 접두사 시작마다 덩어리 끝까지 훑는다. `-` 뒤라서 7자마다 단어 시작이 된다.

**영향.** 가용성만 해친다. 키 노출은 없다. 남이 만든 task·설정 파일을 실행할 때, 또는 GUI 설정 화면이 그런 설정을 읽을 때(`src/app/settings.ts`의 `rawTextHoldsKey`) 멈춘다.

**제안.** 같은 답을 내는 선형 형태가 있다.
- 방식: 단어 시작 접두사 뒤 32자 이상 덩어리를 전역으로 한 번씩 찾고, 찾은 덩어리에 숫자가 있는지 코드에서 본다.
- 실험(`exp/linear-candidate.mjs`):
  - 무작위 글 200,000개에서 고정 판 모양과 답이 다른 경우 0건
  - 1 MiB 공격 글 6.6 ms
- 계약은 정규식 원문(`API_KEY_PATTERN_SOURCES`)을 내보낸다. 그래서 형태는 계약 담당과 CLI 담당이 정한다. 선택으로 task·설정 파일 읽기에 크기 상한을 둔다.

### I-1 (정보) 12c795a: Anthropic 모델 목록의 `display_name`·`created_at`이 4096자를 넘으면 목록 전체가 "holds key material"로 실패한다. 커밋에 밝히지 않은 변화다

- 재현(`exp/material-cap.mjs`, 실제 어댑터와 가짜 서버). display_name 길이별:
  - 300자, 4096자: 두 판 모두 성공
  - 4097자, 20,000자: 고정 판은 `malformed_response: entry 0 holds key material`, main은 성공
- 커밋 메시지는 "callers (Anthropic cursors and model ids, OpenAI model ids) check 256 characters first, so nothing they accept changes"라고 적었다.
  - id와 커서에는 맞다.
  - `src/model/anthropic/index.ts` 437행의 display_name·created_at에는 256자 검사가 없다.
- 안전한 쪽(거부)이다. main의 느려짐(구분 문자 65,536자에 항목당 2.9 s)도 없앤다. 실제 이름은 짧아 영향이 적다.
- 제안(제공자 w3:p9): 두 값에 길이 검사와 맞는 문구("too long")를 둔다. 그렇게 하지 않으면 커밋·주석의 설명을 고치고 시험을 더한다.

### I-2 (정보) 401·403의 요청 id가 키의 8자 미만 조각을 실어 나를 수 있다

- 재현 B3: 본문의 `request_id`를 `req_`+키 끝 7자로 줬더니 고정 판 journal에 끝 7자와 끝 4자가 남았다.
  - 형식 검사(`[A-Za-z0-9_-]{1,64}`)를 통과한다.
  - 8자 미만이라 가림 대상이 아니다.
- 이렇게 하려면 응답하는 쪽(기본 주소를 바꾼 경우의 프록시 등)이 이미 키 전체를 받은 상태다. 남는 위험은 로컬 기록을 나중에 공유할 때뿐이다.
- OpenAI(DR-35 (a), `x-request-id` 헤더)와 같은 설계다. 조치는 필요 없고, 알려진 한계로 적어 두면 충분하다.

### I-3 (정보, 기존 동작) 실행이 401·403으로 끝나면 문구와 요청 id는 journal에만 있다

- `run`(JSON·사람용)과 `report`는 `failed / model_error`만 보인다. 문구와 요청 id는 보이지 않는다(main도 같다). `models`는 보인다.
- 지원 문의에 요청 id가 필요하면 사람이 journal을 직접 열어야 한다. CLI 담당 참고.

## 확인한 것 (문제 없음)

1. **실제 형식 키는 그대로 거부된다.** 환경 키 없이 모양만으로 거부했다(`exp/shape-cases.mjs`, 요청 0건).
   - `--goal`과 task 파일 모두 해당한다.
   - 대상 형식: `api03-`·`admin01-`·`oat01-`, 106~108자.
   - 둘러싼 것: 큰따옴표·작은따옴표 안, `ANTHROPIC_API_KEY=` 뒤, 줄 앞뒤의 LF·CRLF, 한글 바로 뒤.
   - task 파일 안의 `\u` 이스케이프도 잡는다. `rawTextHoldsKey`가 이스케이프를 푼 글도 보기 때문이다.
2. **등록 값 대조.**
   - 환경에 키가 있으면 붙은 형태(A5)도 잡는다.
   - 변수 파일로 `ANTHROPIC_API_KEY`를 주면 등록돼 거부된다(A7).
   - 변수 파일의 다른 이름(예: `OTHER_TOKEN`)에 든 키는 거부되지 않는다. 대신 요청과 기록에서 가려진다(A8: 요청·기록에 조각 없음). main은 A8을 모양으로 거부했다.
3. **출력 가림용 넓은 모양은 그대로다.**
   - `ANTHROPIC_KEY_PATTERN_SOURCE` 값이 같다(접두사 뒤 8자 이상).
   - `API_KEY_MASK_PATTERN_SOURCES`는 main의 3개를 그대로 담고 좁힌 거부 모양을 더해 4개다.
   - Anthropic 어댑터의 가림(`ANTHROPIC_KEY_SHAPES`)은 넓은 모양 그대로다.
   - 모든 경우에 stdout·stderr에 키 조각이 없었다.
   - 제공자 표의 `anthropic.keyPatternSources`는 좁힌 모양으로 바뀌었다. 하지만 `src`에서 이것을 읽는 곳이 없다(계약과 시험만).
4. **401·403 (DR-37 (a)).**
   - 실행(journal `model_error`)과 모델 목록(stdout) 모두 다음 형태다: `HTTP 401: the key or its access was refused; the provider's message is not shown (request req_…)`.
   - 남지 않는 것: 제공자 문구, 오류 종류, 키 전체, 끝 7자, 끝 4자. 출력과 기록 어디에도 없다.
   - HTML 본문이면 고정 문구만 남는다.
   - main은 목록 출력과 실행 journal에 제공자 문구, 오류 종류, 끝 7자·4자를 남겼다.
   - `kind`(`auth_failed`)와 `httpStatus`는 그대로다.
   - 어댑터는 예외를 던지지 않고 결과를 돌려준다. stderr에 스택이 없었다.
   - 요청 id는 목록 출력과 실행 journal에 남는다.
5. **길이 상한 (DR-36 (d)).**
   - 4096자까지 읽는다(12~13 ms). 4097자부터 읽지 않고 true를 낸다.
   - 구분 문자가 섞인 65,536자: main 2,869 ms → 0 ms.
6. **고정 값.** main과 고정 판의 SP-0 고정 모듈을 불러 잎 단위로 비교했다(`exp/pin-diff.mjs`).

   | 바뀐 값 | 커밋 |
   |---|---|
   | `SP0_GOLDEN.p3Retries.unauthorized.outcome.message` | `bd50e66` |
   | `SP0_GOLDEN.p3Retries.forbidden.outcome.message` | `bd50e66` |
   | `SP0_GOLDEN.p6Models.errorOnSecondPage.outcome.message` | `bd50e66` |
   | `SP0_EXPECTED.p8["doctor --json"]` (api_key 줄) | `8f4de51` |
   | `SP0_EXPECTED.p8["doctor text"]` (api_key 줄) | `2bffd6f` |

   - 바뀐 값은 위 5개뿐이고, 모두 담당자가 밝힌 곳이다. 추가·삭제는 0건이다.
   - `sp0-pins`와 `sp0-scenarios`는 바뀌지 않았다.
   - 고정 시험 27건이 모두 통과했다(건너뜀·todo 0).
   - `ec170c0`과 `12c795a`의 "SP-0 pins unchanged"와 맞다.
7. **시험 변경.**
   - 거부 모양을 쓰던 고정 값은 접두사 뒤 32자 이상이고 숫자가 있는 값으로 길어졌을 뿐이다. 단언은 그대로다.
   - 지운 단언은 이름이 바뀌었거나 새 값으로 대체된 것뿐이다.
   - 새 todo 9건은 이 범위 밖이다(제공자별 문구, doctor 설정 위치).

## PM 질문

1. **M-1의 고침 범위.** 등록되지 않은 끊긴 키(OpenAI 실행에 Anthropic 키가 없을 때)까지 모양으로 잡을지 정해야 한다.
   - 구분 문자를 뺀 글에 거부 모양을 한 번 더 적용하면 잡힌다.
   - 대신 줄로 나뉜 평범한 낱말이 이어 붙어 오탐이 늘 수 있다.
   - 가정: 등록 값 비교만 구분 문자를 무시하게 고치고(오탐 없음, U+00AD 포함), 모양은 그대로 둔다.
2. **L-1.** 단어 시작 조건 없는 "실제 키 형식" 갈래를 더할지 정해야 한다.
   - 가정: 더한다. R-20 F의 이름 14개에 맞지 않음을 위에서 확인했다.
3. **병합 시점.**
   - M-1은 main 대비 회귀다. 그래서 1번의 등록 값 비교 고침을 병합 전에 넣기를 권한다. 고침은 작다(`keyMatcher` 한 줄과 구분 문자 집합).
   - L-1, L-2, I-1은 후속으로 해도 된다. 가정: 이 순서다.

## 실험 위치

- 빌드: `.codaryn/r25/src`(`005e10b`), `.codaryn/r25/main`(`e75726e`)
- 스크립트: `.codaryn/r25/exp/`
  - `shape-cases.mjs`: 모양 비교
  - `e2e.mjs`: 실제 CLI와 127.0.0.1 가짜 서버, A·B 경우
  - `regex-time.mjs`, `linear-candidate.mjs`, `format-branch.mjs`: 거부 모양의 시간과 고침 후보
  - `material-cap.mjs`, `compact-check.mjs`: 길이 상한, 구분 문자
  - `pin-diff.mjs`: 고정 값 비교
- 키 모양 가짜 값이 든 실행 작업 공간(`.codaryn/r25/work/`)은 보고 뒤 지웠다. 스크립트를 다시 실행하면 다시 만들어진다.
