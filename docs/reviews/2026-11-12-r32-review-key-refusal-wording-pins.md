# R-32 병합 전 검토: DR-42 (a)(b) 키 거부, CLI 문구, 고정 시험 값 (`pm/bundle-5` ab31417)

```
검토자: w3:pA (이 코드의 구현자가 아님. 범위 밖인 내 a5a3f8d 는 보지 않음). 읽기 전용: 파일 수정·커밋 없음
대상: pm/bundle-5 ab31417 (main 18128f4 + 8개 브랜치). 범위 안의 커밋:
  (가) cd44cb9 계약: 등록 값을 글자·숫자로도 비교, 모양 재검사는 보이지 않는 문자만 뺌
       d09b2a4 CLI 출력 가림도 글자·숫자로
  (나) 753b761 doctor 설정 출처·모델 자리, c48e444 그 고정 값
       368d5cd key_in_file 의 제공자 변수, f38bfdd 설정 실패 때 키 목적지 없음
       cbf70d8 models 의 BOM, 2ee69e6 한국어 되돌리기 미리보기
       12f0ef9·3543301 문구
  (다) tests/unit/cli/sp0-expected.ts, tests/unit/model/anthropic/sp0-golden.ts, tests/unit/cli/human/real-catalog.test.ts
결과: 높음 0, 중간 0, 낮음 1, 참고 3
빌드: ab31417 과 main 18128f4 를 .codaryn/r32/{bundle,main} 에 풀어 빌드. 둘 다 빌드 0, bundle typecheck 0
수치(bundle 사본, 직접 실행):
  루트 유닛 1879건: 통과 1865, 실패 0, 건너뜀 3, todo 11
  통합 559건 중 559 통과 (PM 수치와 같음)
  GUI(PM 이 돌리지 않은 것; claude-gui 의 설치된 Electron 경로만 바꿈):
    빌드·lock 통과, GUI 유닛 134건 중 134 통과, 연기 시험 131건 중 131 통과
    끝난 뒤 electron.exe 없음
실험(.codaryn/r32/exp):
  - 실제 CLI(dist/src/cli/main.js)를 그 판의 net-guard 를 붙여 돌렸다
  - 서버는 127.0.0.1 의 가짜 서버, 닿지 않는 주소는 닫힌 포트 127.0.0.1:9 뿐이다
  - 루프백 밖 기록 0건
  - 가짜 키는 실행 때 조각을 이어 만든다. 아래 "접두사"는 `sk-` 다음 `ant-`다
  - R-25b 검토자의 스크립트(e2e.mjs, fp-corpus.mjs, time-b3b.mjs)를 내 사본으로 복사해 그대로 썼다
실행하지 않은 것: 실제 API, 외부 네트워크
```

## 1. 중점별 결론

| 중점 | 결론 | 근거(실제 CLI, `e2e.txt`) |
| --- | --- | --- |
| R-25b L-1의 문자로 끊긴 등록 키 | **거부, 요청 0** | 아래 2.1. main에서 빠져나가던 경우를 모두 거부한다. 남은 둘은 계약 주석에 적힌 놓침이다(I-1) |
| L-2의 오탐 글(F1~F5, R-20 이름 목록) | **더는 거부하지 않음** | 아래 2.2. R-20 번호 목록만 남는다(주석에 적음, I-2) |
| R-25 원래 재현 입력 8개 | **모두 거부, 요청 0** | A2, A3, A16, A10, A4, A9, A11, A6 |
| 1 MiB에서의 시간 | **선형** | 최대 89 ms(bundle) / 64 ms(main), 아래 2.3 |
| 글자·숫자 비교의 새 오탐 | **있음 → R32-L-1** | 구절 모양의 등록 키 값이 평범한 글에서 잡힌다. 출력도 지나치게 가린다 |
| (나) CLI 문구 | **의도대로, 두 언어 뜻 같음, 값 없음** | 3절 |
| (다) 고정 값 | **승인된 세 곳뿐** | 4절 |

## 2. (가) 키 거부

### 2.1 R-25b L-1의 문자: 키의 26번째 자리에 넣고, 같은 키를 환경에 등록

| 경우 | main 18128f4 | bundle ab31417 |
| --- | --- | --- |
| S1 U+FE0F(Mn), S2 U+E0100(Mn, BMP 밖), S4 U+034F, S5 U+3164(Lo), S6 U+2800(So) | 실행, 요청 1 | **`key_in_file`, 요청 0** |
| S12 역슬래시와 줄바꿈, S13 가운뎃점 U+00B7 | 실행 | **거부** |
| T2 task, 짝 없는 대리 문자 이스케이프, T3 task, U+FE0F 그대로 | 실행 | **거부** |
| V3 변수 파일로 등록, U+FE0F | 실행 | **거부** |
| C2 설정 파일 필드, U+FE0F | `invalid_config` | **`key_in_file`** |
| S3, S7, S8, S9, S10, S11, T1, T4, C1, V1, V2, U2~U4 | 거부 | 거부(그대로) |
| S14 HTML 문자 참조 `&#8203;` | 실행 | 실행(I-1) |
| U1 미등록, U+FE0F | 실행 | 실행(I-1) |

- R-25 원래 입력 8개(A2, A3, A16, A10, A4, A9, A11, A6)는 두 판 모두 `key_in_file`, 요청 0이다.
- A1, A5, A7, A8, A12~A15도 거부다.
- 401·403 경우(B1~B7)의 결과는 두 판이 같다.

### 2.2 L-2의 오탐 (키 없음)

- 실제 CLI(openai 실행, 가짜 서버는 401로 답함)

  | 글 | main | bundle |
  | --- | --- | --- |
  | F1 goal이 `sk-`+`SK` 로캘로 시작 | `key_in_file` | 실행(요청 1) |
  | F2 `Locales:` 다음 줄에 같은 로캘 | 거부 | 실행 |
  | F3 콜론 뒤 `sk-`+`admin-dashboard …` | 거부 | 실행 |
  | F4 콜론 뒤 접두사+`design-system` | 거부 | 실행 |
  | F5 task, R-20 이름을 글머리표 목록으로 | 거부 | 실행 |
  | F6 같은 로캘 goal이 단어 뒤 | 실행 | 실행 |

- 함수 수준 말뭉치(`fp-corpus.txt`, goal 검사와 task 파일 검사)
  - R-20 이름 14개
    - 글머리표 목록: main 거부 → bundle 통과
    - 한 줄에 하나, 이어서, 문장과 함께, 역순: 두 판 모두 통과
    - 번호 목록: 두 판 모두 거부(I-2)
  - 콜론 뒤·글 처음·마침표 다음 줄의 접두사 이름, 글머리표, `sk-`+`admin`·`proj`·`Learn`·`Tools`: main 거부 → bundle 통과
  - 코드(Python, CSS, shell, package.json), 한국어, base64·base64url·sha256·UUID·JWT 모양: 두 판 모두 통과
  - 무작위 base64url 30 KiB 300개: 두 판 모두 0개 거부

### 2.3 시간 (`time.txt`, 등록 키 하나, goal 검사 / 파일 글 검사)

| 1 MiB 공격 글 | bundle | main |
| --- | --- | --- |
| 접두사 반복 | 24 / 43 ms | 13 / 13 ms |
| 접두사와 영폭 공백 | 41 / 48 ms | 26 / 35 ms |
| 글자와 영폭 공백 | 33 / **89** ms | 27 / 64 ms |
| 옛 형식 시작과 띄운 글자 | 15 / 29 ms | 15 / 36 ms |
| 나머지 6가지 | 3~20 ms | 1~16 ms |

- 글자·숫자 비교가 한 번 더 도는 만큼 늘었지만 선형이고 100 ms 아래다.
- 256 KiB는 모두 그 1/4쯤이다.

### R32-L-1 (낮음) 구절 모양의 등록 키 값이, 같은 낱말을 띄어 쓴 평범한 글에서 잡힌다 (main은 받음)

- **원인**
  - DR-42 (a)의 글자·숫자 비교(`keyLettersAndDigits`, `MIN_KEY_SKELETON_LENGTH` 16)는 등록 값과 글 모두에서 영숫자 밖을 다 뺀다.
  - 등록 값이 무작위 키가 아니라 낱말을 이은 구절이면 같은 낱말이 든 평범한 글과 맞는다.
  - 비교 대상은 `knownKeyValues`(모든 제공자 키 변수의 16자 이상 값)다.
  - main은 공백류만 빼고 하이픈·밑줄은 남겨 맞지 않았다.
- **언제 생기나**: 로컬 OpenAI 호환 서버를 쓰는 사람은 `OPENAI_API_KEY`에 아무 구절을 넣는다. Anthropic 실행에서도 모든 키 변수가 비교된다.
- **재현(함수, `fp-skeleton.txt`)**

  | 등록 값(`OPENAI_API_KEY`) | 글 | main | bundle |
  | --- | --- | --- | --- |
  | `your-api-key-goes-here` | `Add a line to the README: your api key goes here, in the .env file.` | 통과 | **거부**(goal·task) |
  | `no-key-needed-for-local-llm` | `Document that no key needed for local llm servers …` | 통과 | **거부** |
  | `placeholder_for_local_server` | `Fix the docs: placeholder (for) local, server.` | 통과 | **거부** |
  | 위 첫째, 글은 `Your API key goes here`(대소문자 다름) | | 통과 | 통과 |
  | `sk-`+`no-key-required`(영숫자 15자) | 같은 낱말 | 통과 | 통과 |
  | 실제 형식 키, 1 MiB 영어 글 / 600 KiB 무작위 base64url | | 통과 | 통과 |

- **재현(실제 CLI, `fp-cli.mjs`)**: Anthropic 실행, 주소는 닫힌 포트, 같은 두 값과 goal.
  - bundle: `key_in_file`(종료 2), "the goal contains a key value; keys are read only from the OPENAI_API_KEY environment variable"
  - main: 거부 없이 실행해 닫힌 포트로 `model_error`(종료 1)
- **출력 가림도 같다** (`d09b2a4`의 `hideKeys`)
  - 등록 값이 `your-api-key-goes-here`이면 `Step 2: your api key goes here, then save.`가 `Step 2: [key], then save.`로 나온다(main은 그대로).
  - 키는 나가지 않으나 평범한 글이 지워진다.
- **낮음으로 두는 까닭**
  - 안전한 쪽(거부·가림)이다.
  - 구절 모양의 값을 키 변수에 둔 사람에게만 생긴다.
  - 문장을 바꾸면 피할 수 있다. 다만 거부 문구가 "goal에 키가 있다"고 말해 사람이 까닭을 알기 어렵다.
- **제안(계약 w3:p9, CLI 가림 w3:p2)**
  - 글자·숫자 비교를 생성된 키로 보이는 값에만 한다. 예: 영숫자 16자 이상이면서 숫자와 대·소문자가 모두 든 값, 또는 키 모양(거부·가림 모양)에 맞는 값.
  - 실제 키(`sk-`+`ant-api03-…`, `sk-`+`proj-…`)는 모두 그 조건에 맞는다. 위 구절들은 맞지 않는다.
  - `hideKeys`의 글자·숫자 가림도 같은 조건을 쓴다.
  - L-1의 고침(이체 선택자 등)은 등록된 실제 키에 그대로 남는다.

## 3. (나) CLI 문구 (실제 CLI, 두 언어, `wording.txt`)

| 확인 | bundle (en / ko) | main | 판단 |
| --- | --- | --- | --- |
| doctor, `--config`로 준 설정 | `the config file given by --config is valid` / `--config에서 지정한 설정 파일이 올바릅니다` | `… at the default location --config …` / `기본 위치 --config의 …` | 고침 맞음, 뜻 같음 |
| doctor, `CODARYN_CONFIG` | `given by CODARYN_CONFIG` / `CODARYN_CONFIG에서 지정한` | `at the default location CODARYN_CONFIG` | 고침 맞음(R-26 I-5) |
| doctor, 기본 위치 | `at the default location %APPDATA%\Codaryn\config.json` (두 판 같음) | 같음 | 맞음 |
| doctor, openai 설정에 출력 상한 없음 | `… or config providers.openai.maxOutputTokens` / `… 또는 설정 providers.openai.maxOutputTokens` | `… or config maxOutputTokens` | 자리 맞음 |
| doctor, openai 설정에 모델 없음 | `… CODARYN_OPENAI_MODEL or config providers.openai.model` / 같은 뜻 | 일반 문구 | 맞음 |
| doctor, anthropic 설정에 출력 상한 없음 | `config maxOutputTokens` (두 판 같음) | 같음 | 맞음 |
| doctor, 설정이 검사에 걸림(한도 틀림, 프록시 주소) — R-26 L-1 | `ANTHROPIC_API_KEY is set (its value is not looked at)` / `…(값은 보지 않습니다)` | 기본 주소로 보낸다고 말함 | 고침 맞음 |
| doctor, openai 설정이 검사에 걸림 | 위와 같음(목적지 말하지 않음) | 틀린 제공자·주소를 말함 | 고침 맞음(I-3) |
| doctor, 설정이 맞고 주소 변수 있음 | 목적지(`http://127.0.0.1:8449`, `CODARYN_API_BASE_URL`)를 그대로 말함 | 같음 | 맞음 |
| `run`, 설정 파일에 OpenAI 키 값(anthropic 실행) | `… read only from the OPENAI_API_KEY environment variable` | `ANTHROPIC_API_KEY`라고 말함 | 고침 맞음 |
| `run`, 설정 파일에 Anthropic 키 값 | `ANTHROPIC_API_KEY` | 같음 | 맞음 |
| `models`, BOM + 정확히 1 MiB | 설정을 받고 목록 단계로(닫힌 포트로 `model_list_failed`, 종료 8) | `invalid_config` 크기 거부 | 고침 맞음(R-30 L-1) |
| `models`, BOM 없이 정확히 1 MiB / 1 MiB + 1바이트 | 받음 / 크기 거부(고정 문구, 내용 없음) | 같음 | 맞음 |
| `revert --dry-run` 다음 줄 | `Run again without --dry-run to revert.` / `되돌리려면 --dry-run 없이 다시 실행하세요.` | ko `실행하려면 …` | 고침 맞음(R-26 L-2) |

- **문구의 뜻과 값**
  - 이 묶음이 더하거나 바꾼 카탈로그 문구를 두 언어로 나란히 대조했다.
    - 범위 안: `doctor.config_file.valid_given`, `doctor.model.missing`·`output_cap_missing`, `doctor.workflow_policy.*`, `progress.workflow_policy.*`, `revert.dry_run_next`
    - 같은 문구 커밋의 DR-38·39 문구: `cleanup.*`, `*.records_changed`, `*.state_changed`
  - 모두 뜻이 같다.
  - 매개변수는 개수·바이트 수·변수 이름·필드 이름·위치 표시뿐이다. 실험 출력 어디에도 키 값이 없었다.
- **방법 메모**: 닫힌 포트 9는 fetch가 막는 포트라 전송 단계에서 "nothing was sent"로 끝난다. 설정과 키 판정은 그 앞에서 끝나므로 위 결과에는 영향이 없다.

## 4. (다) 고정 시험 값 (main 18128f4 대 ab31417)

- `git diff main pm/bundle-5`와 빌드한 값의 잎 단위 비교(165잎, `exp/pin-words.mjs`)
- **`tests/unit/cli/sp0-expected.ts`**: 두 곳만 바뀌었다. 둘 다 승인됨.
  - `p8 / doctor --json`: `doctor.config_file.valid_at` → `doctor.config_file.valid_given`. 이 글 id 말고 같은 줄의 다른 글자는 같다.
  - `p8 / doctor text`: config file 줄 `at the default location` → `given by`. 나머지 줄은 같다.
- **`tests/unit/model/anthropic/sp0-golden.ts`**: 바뀐 곳 없음.
- **`tests/unit/cli/human/real-catalog.test.ts`**: 한 줄만 바뀌었다. 승인됨.
  - 한국어 되돌리기 미리보기의 다음 줄 `실행하려면 …` → `되돌리려면 --dry-run 없이 다시 실행하세요.`
- 그 밖의 고정 값 파일(`sp0`, `golden`, `pin`, `expected`가 이름에 든 시험 파일)에 바뀐 곳 없음.
- **승인되지 않은 변경은 없다.**

## 5. 참고 (건수에 넣지 않음)

- **I-1** 남은 놓침(계약 주석에 적힘)
  - HTML 문자 참조 `&#8203;`로 끊긴 등록 키(S14). 참조 안의 숫자가 이어짐을 끊는다.
  - 미등록 키가 U+FE0F로 끊긴 경우(U1).
  - 두 판 모두 실행된다. 새 회귀는 아니다.
- **I-2** R-20 이름의 번호 목록은 두 판 모두 거부한다. 이름이 다음 줄 번호와 이어진다. 계약 주석의 남은 오탐이다.
- **I-3** 설정이 검사에 걸리면 doctor는 설정의 `provider`를 모른다. 그래서 openai 설정이어도 `ANTHROPIC_API_KEY`를 점검한다. 이제 목적지를 말하지 않으므로 틀린 주장은 없다.
  - 더 고치려면 그때 키 줄에 "설정 파일을 고친 뒤 다시 점검하세요"를 둘 수 있다(CLI w3:p2).

## 6. PM 질문

- **Q-1 (R32-L-1)**: 글자·숫자 비교를 생성된 키 모양의 값(숫자와 대·소문자가 모두 든 값 등)에만 둘지.
  - 이번 묶음에 넣을지, 다음으로 미룰지 정해야 한다.
  - 높음·중간이 아니므로 병합을 막을 이유는 아니다.
- 사용자에게 물을 질문은 없다.
