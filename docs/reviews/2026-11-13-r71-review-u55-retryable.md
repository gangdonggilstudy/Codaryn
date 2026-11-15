# R-71 병합 전 검토: 단위 U-55, 다시 시도해도 되는 실패인지 (AXM-9) (w3:p5, 2026-11-13)

## 0. 대상과 방법

- 페르소나: 보안·개인정보 검토자(보조), 검증. 읽기 전용이다. 저장소 수정·커밋은 없다. 실제 API와 외부 네트워크는 쓰지 않았다.
- **검토한 판: `pm/unit-U-55` = `896d315`.** 비교판은 `57c6673`이다.
  - 범위: `git diff 57c6673 896d315 -- src tests`
  - 크기: 내가 잰 것은 15파일, +588 −14다. 지시의 "17파일 610줄"과 다르다. 문서 커밋이 섞여 센 것으로 보인다.
- 사본: `git archive`로 `.codaryn/r71/base`(`57c6673`)와 `.codaryn/r71/u`(`896d315`)를 풀었다. 둘 다 `tsc` 0이다. 임시 worktree는 쓰지 않았다.
- 실험: 세 스크립트를 썼고, 로그는 `.codaryn/r71/*.log`다.
  - `r71.mjs`: 오류 줄 28가지, 모델 오류로 끝난 실행 9가지, `models` 5가지. 같은 준비를 두 판에서 하고 결과를 견준다.
    - 오류 JSON: `category`·`retryable`을 뺀 stdout
    - 결과 JSON: `modelError`를 뺀 stdout
    - 두 판의 종료 코드와 stderr
  - `r71b.mjs`: `report --json`과 앱 계층이 옮기는지, 손댄 `result.json` 12가지, 1차에서 못 만든 세 경우, timeout
  - `r71c.mjs`: 실제로 도는 실행으로 만든 `run_in_progress`, 연결 거부 때의 출력 원문
- CLI 호출에는 모두 다음을 지켰다.
  - 시험의 네트워크 막이(`dist/tests/support/net-guard.js`)를 `--import`로 얹었다. 막이 기록은 모두 비었다.
  - 모델 요청은 두 곳으로만 갔다: `127.0.0.1`의 가짜 Anthropic 서버(이 스크립트 안의 http 서버), 닫힌 `127.0.0.1` 포트.
  - 키 값은 키 모양이 아닌 가짜 값(`r71-fake-value-not-a-key`)이다.
  - 기본 설정 위치(APPDATA, XDG_CONFIG_HOME)는 사례마다 새 폴더로 돌렸다. stdout은 터미널이 아니다.
- 수치(고정 판 트리 `896d315`, 내 worktree에서 분리 체크아웃해 dist를 지우고 빌드): typecheck 0, 유닛 2667(통과 2663, 실패 0, 건너뜀 3, todo 1), 통합 559/559. PM의 수치와 같다.
  - `git archive` 사본에서 돌린 통합은 557건 중 3건이 실패했다(`k03-self-dev-rehearsal`). 사본에 `node_modules`가 없어 보호된 검증이 후보를 컴파일하지 못한 탓이다. 비교판 사본도 같은 3건이 실패한다. 그래서 수치는 트리에서 잰 것만 쓴다.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 2 (R71-L1, L2) |
| 정보 | 6 (R71-I1~I6) |

| 볼 것 | 결과 |
| --- | --- |
| (1) 기존 필드·값·종료 코드 | **main과 같다.** |
| | - 오류 줄 24코드(실제 CLI로 만든 것): 두 필드를 빼면 stdout이 바이트까지 같다. 종료 코드와 stderr도 같다 |
| | - 1차 스크립트가 32가지(오류 27, `models` 5)를 바이트로 비교했다. 2·3차의 5가지(key_in_file, config_write_failed 둘, 장치 경로, 실제 run_in_progress)는 두 판의 줄을 나란히 찍어 확인했다 |
| | - 모델 오류로 끝난 실행 9가지(1차 스크립트): `modelError`를 빼면 결과 JSON이 같다. timeout은 `modelError`만 보았다 |
| | - 두 필드는 `message`(그리고 `diagnostic`) 뒤, `hint` 앞에 들어간다. 계약 8.2와 같다 |
| (2) 분류 | **사실과 맞는다.** 낮음 하나(R71-L1)가 있다 |
| | - true 둘을 실제로 보았다. `workspace_locked`(살아 있는 잠금), `run_in_progress`(도는 실행). `run_in_progress`는 실행이 끝난 뒤 같은 명령이 종료 0으로 됐다 |
| | - false 가운데 `config_write_failed`는 원인을 가를 수 없는데 false로 박혀 있다(R71-L1) |
| (3) 모델 오류 | **맞다.** |
| | - 연결 거부: `{"kind":"api_error","turn":1}`. `retryable`이 없다(false가 아님) |
| | - 429·529·500·timeout: true. 401·404·400: false |
| | - 대본의 `script_exhausted`(2턴)와 계획 없이 끝난 계획 실행의 `malformed_response`(1턴): false |
| (4) 새는 것 | **새 필드에 없다.** 키 모양, 가짜 키 값, 제공자 응답 본문의 표지, 가릴 값, 주소·포트가 `modelError`와 `category`·`retryable`에 없다 |
| | - `models` 오류의 `message`에 제공자 응답의 글이 실리는 것은 main과 같다(R71-I1) |
| (5) report와 앱 계층 | **그대로 옮긴다.** |
| | - 손댄 `modelError` 열한 가지 가운데 아홉은 `invalid_run_record`(종료 2)다 |
| | - 덧붙인 필드는 버린다 |
| | - 실행의 턴 수보다 큰 `turn`과 `done` 실행의 `modelError`는 받아 옮긴다(R71-L2) |
| (6) 고정 시험 파일 셋 | **main과 같다.** `sp0-expected.ts`, `sp0-golden.ts`, `real-catalog.test.ts`가 `57c6673`, 지금 main `76c5280`과 같다 |
| | - 이 단위가 고친 기존 시험 셋(`app.test.ts`, `sc-regress.test.ts`, `v3.test.ts`)은 정확한 꼴에 두 필드를 더했을 뿐이다. 약해진 단정이 없다 |

## 2. 오류 줄 (E, `r71.log`, `r71b.log`, `r71c.log`)

모두 두 판의 종료 코드가 같고, 두 필드를 빼면 stdout이 같으며, stderr도 같다.

| 코드 | 만든 방법 | category | retryable |
| --- | --- | --- | --- |
| invalid_arguments | `run --bogus`, 인자 없음(파이프), 모르는 명령, `apply --run latest`, `models --provider scripted` | input | false |
| invalid_task | 없는 task 파일, JSON이 아닌 task 파일 | input | false |
| invalid_config | JSON이 아닌 설정 | input | false |
| key_in_file | task 파일의 `apiKey` 필드 | input | false |
| invalid_script | JSON이 아닌 대본 | input | false |
| secret_env_missing | task의 `secretEnv`가 없는 변수 | environment | false |
| workspace_not_found | 없는 폴더 | input | false |
| workspace_is_install_dir | 설치 폴더 | input | false |
| workspace_locked | 살아 있는 pid의 잠금 | state | **true** |
| run_in_progress | 검증이 12초 기다리는 실제 실행 중의 `report --run latest` | state | **true** |
| provider_not_configured | 키 없음 | environment | false |
| model_list_failed | `models`: 연결 거부 / 500 / 429 / 401 / 404 | environment | 없음 / true / true / false / false |
| config_write_failed | `init --config`: Windows가 거부하는 이름, 없는 드라이브 | environment | false |
| config_exists | 있는 파일에 `init` | state | false |
| run_not_found | 없는 실행 id | state | false |
| invalid_run_record | 쓰레기 journal | state | false |
| plan_run_missing | `plan.json`을 지운 계획 실행 | state | false |
| run_not_plan | done 실행의 `plan` | input | false |
| plan_not_approved | 틀린 다이제스트 | input | false |
| plan_already_applied | 두 번 적용 | state | false |
| plan_secrets_differ | 적용 때 다른 가릴 값 | input | false |
| cleanup_plan_changed | 계획의 것이 아닌 다이제스트 | state | false |
| plan_records_changed | 계획 실행에 기록 변경 표시 | state | false |
| run_not_awaiting_review | done 실행의 `review` | state | false |

- 만들지 못한 것
  - `provider_not_implemented`: 이 빌드에서는 두 제공자 모두 연결되어 있다. `--provider`는 `anthropic`·`openai`만 받는다.
  - `internal_error`: 예외가 필요하다. 시험(`sc-regress` S-6)이 `internal`/false를 고정한다.
- 1차에서 준비가 빗나간 둘
  - 목표의 키 모양: 두 판 모두 `provider_not_configured`였다. 간편 형식에서는 제공자 점검이 먼저다. main과 같다.
  - 부모가 파일인 경로: 두 판 모두 `config_exists`였다.
  - 2차에서 각각 맞는 코드로 다시 만들었다.

## 3. 낮음

### R71-L1 `config_write_failed`는 원인을 가를 수 없는데 `retryable: false`로 박혀 있다

- 위치: `src/contracts/engine.ts`의 `CLI_ERROR_RETRYABLE`(`config_write_failed: false`, `internal_error: false`), 계약 8.2.
- 사실(E2, `r71b.log`)
  - 원인이 다른 두 실패가 같은 코드, 같은 `message`다: Windows가 거부하는 이름(`bad|name.json`), 없는 드라이브(`Q:/…`). `"the config file could not be written at --config; nothing was changed"`.
  - 프로그램은 둘을 가를 수 없다. 이 코드에는 다시 하면 될 원인도 섞인다: 다른 프로그램이 파일을 쥐고 있음(EBUSY·EPERM, 백신·색인), 가득 찬 디스크가 나중에 비워짐.
  - 일시적인 경우는 재현하지 않았다.
- DR-61의 원칙은 "가를 수 없으면 `retryable`을 넣지 않는다(없음은 알 수 없음)"다. 모델 오류와 `model_list_failed`에는 지켰다. CLI 코드 표에는 이 원칙 없이 false를 박았다.
  - `internal_error`의 false는 계약 8.2가 "무턱대고 되풀이하지 않게"라고 까닭을 적었다. 그러나 필드의 정의는 "그대로 다시 해도 나중에 될 수 있으면 true"다. 정책("되풀이 말라")과 사실("되지 않는다")이 한 값에 섞였다.
- 영향: `retryable: false`를 믿고 일시적 쓰기 실패를 영구 실패로 다루는 프로그램이 생긴다. 기계가 받는 출력이라 나중에 바꾸면 깨는 변경이다.
- 고칠 방향(제안, PM 판단)
  - `config_write_failed`는 `retryable`을 넣지 않는다(알 수 없음). 또는 원인을 가르는 코드로 나눈다.
  - `internal_error`의 false를 둔다면, 계약 8.2에 "false는 되지 않는다는 뜻 말고 되풀이하지 말라는 뜻도 있다"고 적는다. 아니면 넣지 않는다.

### R71-L2 `report`가 `modelError`를 결과의 다른 값과 맞대지 않는다

- 위치: `src/cli/report.ts`의 `modelErrorOf`.
- 사실(T, `r71b.log`)
  - `status: "done"`, `reason: "verified"`인 결과에 `modelError {rate_limited, 1, true}`를 넣었다. `report --json`이 종료 0으로 옮겼고, 앱 계층(`app.report`)도 같다.
  - 실행의 모델 턴이 2인데 `turn: 9007199254740991`도 받아 옮긴다.
  - 계약(`EngineResult.modelError`, 8.2)은 "reason `model_error`일 때만"이라고 한다. 같은 파일의 `finalMessageOf`는 비슷한 조건(계획 실행에는 없음, `plan_pending`)을 검사해 어기면 `invalid_run_record`로 한다.
- 영향: 손댄 `result.json`이 "다시 하면 된다"는 거짓 신호를 프로그램에 줄 수 있다. 결과 파일을 고쳐야 생기는 일이라 낮음이다.
- 고칠 방향(제안): `modelErrorOf`에 reason을 넘긴다. `model_error`가 아니면 `bad()`한다. `turn`은 `usage.modelTurns` 이하만 받는다.

## 4. 모델 오류 (M, `r71.log`, `r71b.log`)

| 만든 방법 | 결과 | modelError |
| --- | --- | --- |
| 대본이 2단계에서 끝남 | failed/model_error, 종료 1 | `{"kind":"script_exhausted","turn":2,"retryable":false}` |
| 계획 실행이 계획 없이 끝남 | failed/model_error, 종료 1 | `{"kind":"malformed_response","turn":1,"retryable":false}` |
| 닫힌 127.0.0.1 포트(연결 거부) | failed/model_error, 종료 1 | `{"kind":"api_error","turn":1}`(**retryable 없음**) |
| 가짜 API 500 | 위와 같음 | `{"kind":"api_error","turn":1,"retryable":true}` |
| 가짜 API 429 | 위와 같음 | `{"kind":"rate_limited","turn":1,"retryable":true}` |
| 가짜 API 529 | 위와 같음 | `{"kind":"overloaded","turn":1,"retryable":true}` |
| 가짜 API 401 | 위와 같음 | `{"kind":"auth_failed","turn":1,"retryable":false}` |
| 가짜 API 404 | 위와 같음 | `{"kind":"api_error","turn":1,"retryable":false}` |
| 가짜 API 400 | 위와 같음 | `{"kind":"api_error","turn":1,"retryable":false}` |
| 답하지 않는 가짜 API, `requestTimeoutMs` 1000 | 위와 같음 | `{"kind":"timeout","turn":1,"retryable":true}` |

- timeout을 뺀 아홉 경우에 `modelError`를 빼면 결과 JSON이 main과 같다. 종료 코드와 stderr도 같다. timeout은 두 판 모두 failed/model_error, 종료 1이었다.
- `modelErrorRetryable`의 표는 두 어댑터의 `classifyStatus`와 같다(코드 대조: Anthropic 529·503 → overloaded, OpenAI 503 → overloaded, 408·409·5xx → api_error 재시도).
- 가림이 실패해 `model_error`로 끝나는 길(`MASKING_FAILED`, 열세 곳)은 `endedByModelError`를 부르지 않는다. 그래서 `modelError`가 없다. 계약대로다.

## 5. 새는 것 (4)

- 사례마다 stdout과 stderr에서 다섯 가지를 찾았다.
  - 키 모양 값
  - 가짜 키 값
  - 가짜 API 응답 본문의 표지(`R71CANARYBODY`)
  - 가릴 값(`beach`)
  - 연결 거부 때의 포트
- `modelError`, `category`, `retryable`, `result.json`의 `modelError` 어디에도 없다.
- 연결 거부 실행의 stdout과 `result.json`에 포트가 없다. journal의 `model_error` 기록은 예전처럼 가린 메시지(`network error: connection failed (ECONNREFUSED)`)다.

## 6. report와 앱 계층 (5, `r71b.log`)

- `report --json`의 `result.modelError`가 `result.json`과 같다. 비교판은 이 필드를 읽지 않는다. 글 출력(`report`)에는 새 줄이 없다.
- `app.report`도 같은 `modelError`를 준다.
- `app.report`의 없는 실행 → `{"code":"run_not_found",…,"category":"state","retryable":false}`. `toCliError`가 그대로 옮긴다.
- 손댄 `result.json` 열두 가지(두 판)

  | modelError | 비교판 | 이 판 |
  | --- | --- | --- |
  | 모르는 kind, 글자를 실은 kind, 숫자 kind, 글자 turn, turn 0, turn 1e20, 글자 retryable, null retryable, 객체가 아님 | 종료 0, 필드 무시 | 종료 2, `invalid_run_record` |
  | 덧붙인 필드(`extra`) | 종료 0 | 종료 0, 세 필드로 다시 만들어 `extra`를 버림 |
  | turn 2^53−1(실행은 2턴) | 종료 0 | 종료 0, 그대로 옮김(R71-L2) |
  | done 실행에 modelError | — | 종료 0, 그대로 옮김(R71-L2) |

- 표지를 실은 kind도 stdout에 나오지 않는다(오류 `message`에 값을 싣지 않음).

## 7. 정보

- **R71-I1 `models` 오류의 `message`에 제공자 응답의 글이 실린다(main과 같음).**
  - 가짜 API 500·429·404의 `message`에 응답 본문의 표지가 들어 있다.
  - 비교판도 바이트까지 같다(두 필드를 빼고). 이 단위의 것이 아니고, 새 필드에는 없다.
  - 연결 거부 때 `message`는 `connection failed (ECONNREFUSED)`라고 말하지만, `retryable`은 없다. `ModelOutcome`만으로는 가를 수 없다는 DR-61대로다. 전송 층의 판정을 남기는 것은 DR-61이 사용자 질문으로 넘겼다.
- **R71-I2 손상된 `modelError` 하나로 보고서 전체가 `invalid_run_record`가 된다.**
  - 계약 8.2가 적은 대로고, `masking`·`finalMessage`와 같은 규칙이다.
  - 나중 판이 새 모델 오류 종류를 쓰면, 그 결과를 이 판의 `report`가 읽지 못한다. 다른 필드와 같은 앞으로의 호환 문제다.
- **R71-I3 `workspace_locked`의 true에는 드문 예외가 있다.**
  - 예전 꼴(`processStartedAt` 없음)의 잠금은 pid만으로 판정한다. 그 pid를 다른 오래 사는 프로세스가 받으면, 기다려도 풀리지 않는다.
  - `lock.remove_hint`가 그 경우를 안내한다.
- **R71-I4 사람용 글은 바뀌지 않았다.** 1차 스크립트의 42가지(오류 28, 모델 9, `models` 5) 모두 stderr가 같다. `retryable`을 사람에게 알리는 줄은 없다(지시 범위 밖).
- **R71-I5 GUI.**
  - GUI는 앱 계층 오류에서 `code`만 옮긴다(`gui/src/main/ipc.ts`). 그래서 `AppError`에 붙은 두 필드는 영향이 없다.
  - GUI 유닛·연기 시험은 돌리지 못했다. 이 worktree에 `gui/node_modules`가 없다.
- **R71-I6 범위 수치.** `src tests`의 차이는 15파일, +588 −14다.

## 8. 검사하지 않은 범위

- 실제 콘솔(stdout은 파이프였다), Linux·macOS, OpenAI 어댑터의 실제 HTTP 응답(코드 대조만)
- `config_write_failed`의 일시적 원인(파일 잠금 등), `provider_not_implemented`, `internal_error`의 실제 출력
- `quota_exhausted`(OpenAI 429의 특정 본문), `aborted`, HTTP 408·409

## 9. PM 판단 필요

- **Q-1(R71-L1)**: 두 코드의 `retryable`을 어떻게 할지.
  - `config_write_failed`: false로 둘지, 알 수 없음(넣지 않음)으로 할지
  - `internal_error`: false의 뜻을 계약에 적을지, 넣지 않을지
  - 기계가 받는 출력이라 병합 전에 정하는 편이 싸다.
- **Q-2(R71-L2)**: `report`가 `modelError`를 reason과 턴 수에 맞대게 할지. 가정: 한다. `finalMessage`와 같은 꼴이기 때문이다.

사용자에게 물을 질문은 없다.
