# 단계 1a 프로세스 통합 테스트

담당: 검증 엔지니어(작업 D). 실제 CLI 프로세스, 실제 파일시스템, 실제 자식 프로세스로 수용 기준을 확인한다. 모델은 scripted 대본이고 API 키는 쓰지 않는다. 실제 API 검증(1b)은 여기에 없다.

실행: `npm run test:integration`(빌드 후 `dist/tests/integration/**`). CLI(`dist/src/cli/main.js`)가 없으면 모든 사례가 실패한다. 최종 실행은 G3b 뒤 PM이 지시한다.

## 수용 기준 대응

| 기준 | 파일 | 판정 근거 |
| --- | --- | --- |
| A1 코드 작업 완주 | `a01-code-task` | 종료 코드 0, 파일 바이트, 변경 해시, 명령 검증기 |
| A2 Git 없는 문서 작업 | `a02-document-task` | PATH 없이 실행, `.git` 부재, file_rules |
| A3 충돌 쓰기 거절 | `a03-conflict` | 읽기 후 외부 수정과 오래된 해시 모두 `conflict`, 사용자 바이트 동일 |
| A4 실효 경로 | `a04-path-escape` | `..`, 절대 경로, 정션(못 만들면 건너뜀), 상태 디렉터리 |
| A5 독립 권한 | `a05-permissions` | 명령·인자·cwd 각각 거부, 무버전 덮어쓰기와 삭제 도구 없음, 허용 명령 1회 |
| A6 원위치 보존·새 위치 거절 | `a06-protected-span` | `{{secret_token:1}}` 복제·새 파일·명령 인자·경로 거절 |
| A7 치환 후 기록 | `a07-masking` | 카나리 원문과 변형 0건, 토큰 존재, 자식 환경 필터 |
| A8 한도·취소·자식 정리 | `a08-limits-cancel` | 네 가지 한도, cancel-file, 자식·손자 종료, 잠금 |
| A9 완료 선언만으로 성공 아님 | `a09-a10-status-provider` | `failed`, `needs-input`(no_verifier, inconclusive) |
| A10 실제 호출 경로 거부 | `a09-a10-status-provider` | `provider_not_configured`, 실행 디렉터리 없음 |
| A11 유닛 P0·타입 검사 | (각 모듈 유닛 테스트) | `npm run typecheck`, `npm run test:unit` 결과 |
| A12 보고 구분 | (보고서) | 모든 결과의 `provider`가 `scripted`인지 확인, 1b 미수행 명시 |
| T9 인코딩 | `encoding` | CRLF·BOM·한글 경로 바이트 보존 |

## 교차 검토 회귀 (`r01-privacy-regress`)

2026-11-12 교차 검토(`docs/reviews/2026-11-12-cross-review-*.md`)에서 재현된 결함의 기대 동작이다. 담당 모듈이 고치기 전에는 실패하는 것이 정상이며, 삭제·건너뛰기·약화하지 않는다.

| 사례 | 기대 동작 | 출처 |
| --- | --- | --- |
| R-a | `search_files.text`가 비밀 접두사여도 없는 문자열과 같은 결과 | tools #1 |
| R-b | 검색 줄 1000자, 명령 출력 65,536바이트 경계에서 비밀 4자 조각도 없음 | tools #2, #3 |
| R-c | JSON을 출력하는 명령의 기록에 이스케이프된 비밀 없음(3중 이스케이프와 디코드까지 검사) | tools #4 |
| R-d | 겹치는 두 비밀의 어느 쪽 4자 조각도 없음 | privacy #2 |
| R-e | 토큰 줄의 문맥을 바꾸면 `protected_span_violation`, 파일 바이트 그대로 | privacy #1 |
| R-e2 | 토큰 없는 옆 줄 수정은 허용(과잉 차단 방지) | privacy #1 |
| R-f | `CODARYN_SECRET` 문자열이 든 파일의 다른 줄 수정 허용 | privacy #3 |
| R-g | 패딩 없는 Base64, base64url, 소문자 퍼센트 인코딩도 가림 | privacy #6 |

## 모의 API 검증 (`m01`~`m03`, 실제 API 아님)

단계 1b 작업 E3. 로컬 HTTP 서버(`tests/support/fake-anthropic.ts`, `127.0.0.1` 임의 포트)를 Anthropic 주소로 지정하고 provider `anthropic`으로 실제 CLI 프로세스를 실행한다. 서버는 대본대로 Messages API 형식(`tool_use`, 최종 `text`, 오류 상태 코드, `usage`)으로 답하고 받은 요청의 헤더와 본문을 기록한다. **모의 API 검증이며 실제 API 검증이 아니다.** 테스트 이름은 모두 `[모의 API·실제 API 아님]`으로 시작한다. 실제 호출 점검은 `tests/live/`에 따로 있다.

| 사례 | 파일 | 판정 근거 |
| --- | --- | --- |
| a 코드·문서 작업 완료 | `m01-fake-api-runs` | 종료 코드 0, 파일 바이트, 요청 형식, `tool_use` id와 결과 짝, 사용량 합계 |
| b 키는 `x-api-key`에만 | `m01-fake-api-runs` | 성공 실행, 401 실행, 작업 공간 파일에 키 값이 든 실행 모두 다른 헤더, 요청 본문, journal, result, stdout, stderr에 키 원문·변형 0건 |
| c 요청 본문에 비밀 없음 | `m01-fake-api-runs` | 파일·명령 출력·목표·모델 출력에 심은 카나리의 원문·정해진 변형 0건(디코드 포함), 토큰은 존재 |
| d 키·모델·상한·한도 없음 | `m02-fake-api-settings` | 실행 전 오류(`provider_not_configured`, 한도는 task 형식 `invalid_task`·간편 형식 `invalid_config`), 서버 요청 0건, 실행 디렉터리 없음. 설정 파일 한도만으로는 실행됨(대조군) |
| e 파일 속 키 | `m02-fake-api-settings` | task·설정 파일의 키 필드(정규화, 중첩)와 현재 키 값 → `key_in_file`, 요청 0건 |
| f 모델 우선순위 | `m02-fake-api-settings` | 요청 본문 `model`: task > `CODARYN_MODEL` > 설정 파일. `max_tokens`와 주소 우선순위도 확인 |
| g task의 주소 | `m02-fake-api-settings` | task의 `apiBaseUrl`은 거부(`invalid_task`) 또는 무시, 다른 서버 요청 0건. 주변 설정 모양 파일과 `.env`는 읽지 않음 |
| h 오류와 재시도 | `m03-fake-api-errors` | 401 `auth_failed`(재시도 없음), 429 `rate_limited`, 529 `overloaded`, 시간 초과 `timeout`, 요청 수 = 1 + `maxRetries`, 재시도 본문 동일, 1회 실패 후 회복 |
| i 사용량 누락 | `m03-fake-api-errors` | 토큰 한도가 있으면 `usage_unknown`, 두 번째 요청 없음. 한도가 없으면 계속하고 합계는 `null`. 보고된 사용량은 한도에 반영 |
| j `--vars-file` | `m02-fake-api-settings` | 임시 폴더의 가짜 값 파일에서 키·모델·주소를 읽음. BOM이 있는 파일은 `invalid_config`, 요청 0건. `--env-file`은 `invalid_arguments`(T-15) |
| k 간편 형식 | `m01-fake-api-runs` | `--workspace`·`--goal`·`--config`로 `done`, `taskId`는 `QUICK_TASK_ID` |

- 가짜 서버는 실제 API 규칙 일부를 흉내 내 요청을 검사한다(필수 헤더, `max_tokens`, 빈 텍스트 블록, `tool_use`/`tool_result` 짝, 마지막 메시지 역할). 어기면 400으로 답하고 위반으로 기록한다. 실제 API의 모든 규칙은 아니다.
- 네트워크 울타리: 모의 API 테스트는 CLI 프로세스에 `tests/support/net-guard.ts`를 `--import`로 미리 올린다. 전역 `fetch`가 루프백 밖으로 나가려 하면 막고 기록하며 테스트가 실패한다. 설정이 무시되는 결함이 있어도 가짜 키가 실제 주소로 가지 않는다. `fetch`만 감싼다.
- 가짜 키는 `tests/fixtures/secrets.ts`의 `FAKE_API_KEYS`뿐이다. `cliEnv({ fakeApiKey })`는 이 값만 받고 실제 키 모양이면 예외를 던진다.

## 단계 2 재수정 반복 (`p01`~`p05`, 작업 F5)

[작업 지시](../../docs/work-orders/phase-2-repair-loop.md) R-1~R-8과 `src/contracts`(main `d16d372`)가 기준이다. 연습 프로젝트는 `tests/fixtures/repair-project.ts`(Git 없음, `node --test`로 실패하는 작은 코드와 테스트)이고, 대본은 `tests/support/repair-script.ts`의 시도 단위로 쓴다(첫 수정은 틀리고, 실패 근거를 받은 다음 요청에서 고친다). 대본 끝의 여분 최종 답은 멈춰야 할 때 요청되지 않았는지를 `usage.modelTurns`로 보여 준다.

| 사례 | 파일 | 판정 근거 |
| --- | --- | --- |
| F5-a 실패 → 재수정 → 통과 | `p01-repair-loop` | `done`, 검증 회차 fail→pass, `repair_started` 1건, 기록 순서(검증 → 재수정 → 요청), 재수정 메시지에 실패한 테스트 이름, 변경 해시 사슬 |
| F5-b 재수정 한도 소진 | `p01-repair-loop` | `failed`/`verifier_failed`, 재수정 2건, 한도 뒤 요청 없음, 적용한 변경 유지 |
| F5-c 한도 생략 | `p01-repair-loop` | 기본 0으로 단계 1과 같음, `run_started.limits`에 기본값 2개 기록 |
| F5-d·d2 같은 실패 반복 | `p01-repair-loop` | 결정적 검사기로 같은 근거 연속 → `repeated_failure`. 기본 2는 1번, 3은 2번 재수정 |
| F5-e 연속 아닌 같은 실패 | `p01-repair-loop` | A, B, A 뒤 통과(`done`, 재수정 3건) |
| F5-f inconclusive | `p01-repair-loop` | 검증 명령 시간 초과 → `needs-input`/`verifier_inconclusive`, 재수정 0건 |
| F5-g 기존 한도 | `p01-repair-loop` | 재수정이 남아도 `maxModelTurns`에서 `budget-exhausted` |
| F5-h 취소 | `p01-repair-loop` | `repair_started` 뒤 cancel-file → `cancelled`, 지연된 수정 미적용 |
| F5-i 실패 근거 절단 | `p02-repair-feedback` | `feedbackTruncated`, 가린 근거의 앞뒤 보존·가운데 생략, 원문·변형·4자 조각 0건, 토큰 온전, U+FFFD 없음 |
| F5-j 검증기 출력 끝 절단 | `p02-repair-feedback` | 검증기가 출력 끝 2000자를 남기는 경계에 비밀을 걸쳐도 근거·기록·재수정 메시지에 4자 조각 0건 |
| F5-k 스냅샷 | `p02-repair-feedback` | 원문은 `snapshots/`에만 있고 journal·결과·모델 요청·검색 결과에 없다 |
| F5-l 보호 경로 | `p03-protected-paths` | 테스트 파일 쓰기 `protected_path`, 읽기 허용, 목표 문장으로 풀리지 않음, 코드 수정으로 통과 |
| F5-m 경로 변형 | `p03-protected-paths` | `./`, `..`, 새 파일, 폴더 자체, 대소문자·`\`(Windows), 정션 모두 거부. `test-data/`, `src/test/`는 허용 |
| F5-n·o | `p03-protected-paths` | `"."`는 전체 보호. `..`·절대 경로 항목은 `invalid_task` |
| F5-p 되돌리기 | `p04-revert` | BOM·CRLF·한글 원문(두 번 고친 파일은 첫 원문), 비밀 원문 바이트 복원, 새 파일 삭제, 사용자 변경·삭제 보존, journal 불변, 출력에 비밀 없음 |
| F5-q·q2 | `p04-revert` | 두 번째 되돌리기는 아무것도 바꾸지 않음(`partial`), 변경 없는 실행은 `complete` |
| F5-r 오류 | `p04-revert` | `run_not_found`, runs 밖을 가리키는 id 거부, `workspace_locked`, 깨진 journal `invalid_run_record`, 모두 무변경 |
| F5-s·t 모의 API | `p05-repair-fake-api` | 가짜 서버로 실패 → 재수정 → 통과(요청 형식, 재수정 요청의 user 메시지, 본문에 스냅샷 원문 없음). 간편 형식에서 설정 파일의 `protectedPaths`·`maxRepairAttempts` 적용 |
| G1-a~d `.cmd` | `g01-windows-cmd` | PATH의 `.cmd`·`.bat` 실행과 인자 보존, 메타문자 인자 미실행, 작업 공간의 같은 이름 `.cmd` 미실행, 작업 공간 안으로 풀리면 거부(Windows만) |

## 교차 검토 결함 수정 회귀 (`s01-security-regress`, 작업 S-D)

[작업 지시](../../docs/work-orders/phase-2-repair-loop.md)의 S-1~S-11 결정을 실제 CLI 프로세스로 확인한다. anthropic이 필요한 사례는 가짜 서버(모의 API, 실제 API 아님)와 네트워크 울타리로 돌린다.

| 결정 | 판정 근거 |
| --- | --- |
| S-1 | 작업 공간 안의 task(`invalid_task`)·대본(`invalid_script`)·설정과 `CODARYN_CONFIG`(`invalid_config`)·env 파일(`invalid_config`) 거부, 밖에 두면 실행(대조군). 가짜 서버 2개: 모델이 작업 공간에 쓴 설정·`.env`를 다음 실행에 줘도 거부되고 그 주소로 요청 0건 |
| S-2 | scripted 실행에서도 환경의 키를 읽은 결과가 가려지고 journal·결과·출력에 키 없음 |
| S-3 | `secretEnv`에 값을 적은 실수(task, 설정 파일, 미설정 이름): 오류 출력에 값 없음 |
| S-4 | env 파일이 새로 설정한 8자 이상 값은 가려지고 8자 미만 값은 그대로 |
| S-5 | UNC·`\\?\UNC`·장치 경로를 `--task`·`--config`·`--vars-file`·`--cancel-file`·`--workspace`·`CODARYN_CONFIG`·`workspaceRoot`·`scriptPath`에 주면 정해진 코드로 즉시 거부(루프백 주소만 쓰고 net-guard로 fetch 차단 확인). 없는 변수 파일도 CLI JSON 오류 |
| S-6 | 깊이 20000 JSON의 task·설정 → `invalid_task`·`invalid_config` 한 줄, stderr 없음 |
| S-7 | task 한도 > 설정 한도 거부(같으면 실행), 절대 상한 4종, 검증기 `timeoutMs` 2^31 거부·2^31-1 허용, 설정의 상한 초과·`requestTimeoutMs` 2^31 거부(요청 0건) |
| S-8 | `--goal`의 키 모양 값과 현재 키 값 → `key_in_file`, 요청 0건 |
| S-10 | 끝없는 성공 본문 → `malformed_response`, 끝없는 오류 본문 → `api_error`. 요청 시간 한도(60초)가 아니라 본문 상한으로 빨리 끝나고 클라이언트가 먼저 끊는다 |
| S-11 | 가운데 공백, ASCII 밖 문자가 든 키 → 요청 0건 |

## 단계 2 교차 검토 수정 회귀 (수정 묶음 T)

| 결정 | 파일 | 판정 근거 |
| --- | --- | --- |
| T-1 | `g01-windows-cmd`, `s01` | PATH의 `.cmd`·`.bat` 실행. 메타문자 인자와 작업 공간 안 스크립트는 **이유까지** 확인(`script_refused` 문구, "workspace root is not known"이면 실패). 작업 공간의 같은 이름 `.cmd`가 아니라 PATH의 것이 실행됨. 비밀이 든 허용 변수(LANG)가 자식에 가지 않음 |
| T-2 | `g01-windows-cmd` | 분리된 배경 프로세스를 남기고 끝나는 명령과 검증기가 시간 초과가 아님 |
| T-3 | `t01-fix-regress` | `run_command.timeoutMs` 600001 → `invalid_args`, 600000 허용 |
| T-4 | `g01-windows-cmd` | 작업 공간 안 `.exe`(이름, 상대 경로, 절대 경로) → `executable_refused`, 실행 흔적 없음 |
| T-5 | `p01-repair-loop` F5-d3 | `node --test`의 같은 실패(숫자만 다름) → `repeated_failure` |
| T-6 | `p02-repair-feedback` F5-i·j·j2 | 기록 근거 ≤ `MAX_EVIDENCE_BYTES`, 이전 2000자 경계와 실행기 캡처 한계에 걸친 비밀의 조각 0건 |
| T-8 | `p01-repair-loop` F5-g2 | 검증 도중 시간 한도 → `budget-exhausted`/`max_duration` |
| T-9 | `t01-fix-regress` | 죽은 잠금에 6개 프로세스가 동시에 시작 → 하나만 실행, 나머지 `workspace_locked` |
| T-10 | `t01-fix-regress` | 스냅샷은 있고 기록이 잘린 경로 → `missing_record`·`partial`. 잘린 마지막 줄만 있으면 `complete` |
| T-12 | `t01-fix-regress` | `revert --workspace` UNC, 작업 공간 안 `--cancel-file` → `invalid_arguments` |
| T-13 | `t01-fix-regress` | 링크 항목은 실경로도 보호. 밖을 가리키는 링크 항목이 있으면 실행은 시작되고 모든 쓰기가 `policy_denied`(fail closed, 확정 결정). 작업 공간과 링크 너머에 쓰기 0건 |
| T-14 | `t01-fix-regress` | 이스케이프한 키를 앞선 중복 필드에 둠 → `key_in_file`, 위치에 모르는 필드 이름 없음, 작업 공간 루트의 대체 데이터 스트림 설정 거부, `maxOutputTokens` 200000 초과 거부·200000 허용 |
| T-15 | `m02`, `s01` | `--vars-file`로 바꿈. `--env-file`은 있는 파일이어도 `invalid_arguments`, 값을 읽지 않음 |

단계 2 결정으로 기존 사례의 기대값을 옮긴 곳: anthropic task·설정 한도에 숫자 토큰 한도(`ANTHROPIC_LIMITS`, S-7), E3-i의 "토큰 한도 없음" 사례는 `invalid_task`·요청 0건으로(S-7), 기록 검사에서 `snapshots/` 제외(R-8).

- `node --test`는 소요 시간을 출력하므로 같은 코드라도 출력 바이트가 매번 다르다. 같은 실패 반복 사례는 출력이 코드에만 달린 `checks/price-check.mjs`를 쓴다.
- 기록 검사에서 `runs/<runId>/snapshots/`는 뺀다(`stateRecordTexts`). 계약상 스냅샷은 작업 공간 파일과 같은 원문 자료다(R-8). 그 밖의 상태 디렉터리 파일은 모두 검사한다.

## 모델 목록 (`y01-models`, 모의 API·실제 API 아님)

[CLI·공통 계약](../../docs/cli-contract.md) 16절(Y-1~Y-4)을 가짜 서버의 `GET /v1/models`(`tests/support/fake-models.ts`, 쪽당 2개)로 확인한다. 모든 실행에 네트워크 울타리를 쓴다.

| 결정 | 판정 근거 |
| --- | --- |
| Y-1 | 모든 쪽을 API 순서로 읽고 번호·이름·한도·`createdAt`을 낸다. 미확인 필드가 없어도 된다. 표 출력에서 현재 모델 줄. `MAX_MODEL_LIST_PAGES`쪽은 읽고 넘으면 `api_error` |
| Y-1 현재 모델 | `CODARYN_MODEL` > 설정 파일, 목록에 없으면 `listed: false`, 없으면 `null` |
| Y-2 | 키 없으면 `provider_not_configured`·요청 0건. 키는 `x-api-key`에만(Messages와 같은 `anthropic-version`), 출력·설정 파일·다른 헤더에 없음. `--vars-file`의 키, `CODARYN_API_BASE_URL` 우선 |
| Y-2 실패 | 401 → `model_list_failed`(`auth_failed`). 문자열 id가 없는 항목(대조군 포함), 키의 8자 조각이 든 id·이름·`created_at` → `malformed_response`, 아무것도 쓰지 않고 조각을 출력하지 않음 |
| Y-3 | `--use` 번호·id는 설정 파일의 `model`만 바꾼다. 없는 파일은 `schemaVersion`과 `model`로 만든다. 잘못된 값은 `invalid_arguments`·무변경. 터미널이 아니면 묻지 않는다. 작업 공간 안에 쓴 설정은 `run`이 거부(S-1) |
| Y-4 | Messages 404로 끝난 실행: 결과 `notices`(= `result.json`)에 `codaryn models` 안내, 기록의 오류는 제공자의 `api_error`·`HTTP 404` 문구 그대로 |

- 목록에 나오는 가짜 모델 id는 `cdy-listed-model-`로 시작한다. 가짜 키가 모두 `cdy-fake`(8자)로 시작하는데, 목록 조회는 키의 8자 조각이 든 항목을 거부하기 때문이다(`src/model/anthropic/index.ts`의 `KEY_FRAGMENT_CHARS`). 새 가짜 값은 `tests/fixtures/anthropic.ts`의 `sharesKeyRun`으로 확인한다.

## 사용성 (`n01`~, N-E)

[사용성 작업 지시](../../docs/work-orders/phase-4-usability.md) 완료 기준 2(처음 쓰는 사람이 문서만 보고 따라 함)를 확인한다. 문서가 출력에 대해 말하는 것은 두 번 확인한다: 문서가 아직 그렇게 말하는지, CLI가 아직 그렇게 하는지. 한쪽만 바뀌면 실패한다.

| 사례 | 파일 | 판정 근거 |
| --- | --- | --- |
| 체험 예시 | `n01-demo-walkthrough` | `examples/demo`를 저장소 밖에 복사해 [사용 안내](../../docs/usage.md) 3절의 명령(doctor → run → report → revert)을 그대로 실행. 문서의 명령 목록과 옵션, doctor 종료 0·`api_key` 건너뜀 문구, 진행 줄(`codaryn: ` 접두사 줄) 전체, 그 뒤의 끝 요약(실행 id, `codaryn report`·`codaryn revert`, N-5), 결과(`done`/`verified`, 변경 2건, 재수정 1회), 보고서 인용 줄(Markdown 렌더링 기준), 검증기를 id가 아닌 순번으로 보임(N-24 (a), `--json`에는 id), 검증 통과·보호 대상 확인 5회, revert `complete`와 원래 바이트, 두 번째 revert `partial`/`changed_since_run`/종료 3, 되돌리지 않은 재실행의 `conflict`와 빈 `changes`. 키 없음, 네트워크 울타리 |

| 처음 쓰는 흐름(E-1), init 세부(E-9) | `n02-first-use` | 샌드박스 안의 기본 설정 위치(`support/usability.ts`)로 init(비대화형 기본값, 자리표시자 모델, 키 없음, 위치는 기호로만) → 다시 init `config_exists` → doctor(기본 설정, 모델·키 실패와 안내) → 체험 예시(기본 설정 사용 알림) → runs → report·revert `--run latest`(고른 실행 id를 stderr에 먼저) → `--dry-run`(파일·기록·잠금 무변경) → revert(원래 바이트, 되돌리기 기록) → 다시 revert(`already_reverted`, `complete`). init의 `--config`, `CODARYN_CONFIG`(`overriddenBy`), 작업 공간 안 거부, 제안 미적용, 키 미기록·미전송, 기본 위치 없음 |
| 실행 목록과 latest(E-6), R-2 | `n03-runs-latest` | 위조 실행(미래 시각, 시각 불일치, 결과 파일 포함)은 손상으로 표시되고 latest가 되지 않으며 id를 지정해도 `invalid_run_record`(N-26), 사용자 `notes.md` 보존. 결과 파일 없는 실행은 latest 후보 아님. 되돌리기 기록만 손상된 실행은 진행(N-23 g). 기록 없음, `runs/latest` 디렉터리(N-18), `--limit`, 잠금 중 목록 |
| 설정 순서·자리표시자·프로필·한 줄 실행(E-2, E-3, E-7, E-8) | `n04-config-profiles` | 모의 API. 요청의 모델로 `--config` > `CODARYN_CONFIG` > 기본 위치, 기본 위치 사용 알림, 작업 공간 안 거부, 상대 경로는 없음과 같음. 자리표시자는 다음 단계로, 모두 자리표시자면 `provider_not_configured`. 프로필의 한도·검증기, 상한·이름 오류, task 파일의 `profiles` 거부. 한 줄 실행의 현재 디렉터리, 설치 위치·키 모양 목표·인자 혼용 거부 |
| 언어·사람용 출력(E-4, E-5), R-3 | `n05-language-output` | ko·en에서 stdout 동일·stderr만 다름, 고르는 순서, 잘못된 `language` 값 미출력. JSON 문법 오류의 줄·열, 모르는 필드 이름 미출력(N-15), `--quiet`, ASCII JSON(N-19). 검증기 id(`SYNTHETIC_PRIVATE_VALUE` 등)가 진행 줄·끝 요약·Markdown에 없고 `--json`에만 있음(N-24 a) |

- 실행 전 오류의 stderr는 `assertHumanError`로 모양만 본다(코드 괄호, 스택·예외 문구 없음, 같은 줄 반복 없음, 경로·값 없음). `--quiet`이면 비어 있다(`s01`).

## 범용 작업 (`n06`~`n08`, G-G)

[범용 작업 설계](../../docs/design/general-tasks.md) 10.2절과 G-A 계약(`src/contracts/plan.ts`, `workflow.ts`, `verify.ts`), DR-5·DR-9·DR-12·DR-17·DR-24를 실제 CLI 프로세스로 확인한다. 대본 모델이고, F 계열만 가짜 서버(모의 API)다. 기대 배치는 `fixtures/general-tasks.ts`의 `afterActions`, 집계 기대값은 손으로 계산한 `SALES_BY_REGION`이다. 도우미는 `support/general.ts`.

| 사례 | 파일 | 판정 근거 |
| --- | --- | --- |
| 파일 정리(GI-02~05, C05~C10, R-9) | `n06-organize` | 계획 실행 `plan_pending`(작업 공간 무변경) → `plan`(다이제스트·행동·원본 해시) → `apply --digest`(inventory 통과, 판정 기준과 같은 배치, 보관함 이름은 순번, `applied.json`, `apply_started`부터 시작하는 기록) → 다시 적용 `plan_already_applied` → `revert`(역순, 원래 바이트) → 다시 `already_reverted`. 승인 거부 4종, 오래된 계획 5종(`plan_stale`, 무변경), 계획 단계의 쓰기·명령, 거부 계획 14종, 동시 적용, 적용 뒤 사용자 변경, 계획 아닌 실행·변조, 비밀 이름 가림. R-9: 보관함 정션과 적용 뒤 바뀐 `plan.json`으로 밖 파일·다른 경로를 건드리지 않음 |
| 자료 분석(GI-06·07, D03~D05) | `n07-analyze` | `data_checks` 통과 → `awaiting_review` → `review --task`(review.json만, 결과·기록 그대로) → report에 판정 → `--reject`로 교체. 틀린 합계 → 근거는 비교한 수만 → 재수정. 숫자 아닌 원본 → `verifier_inconclusive`. review 오류 4종. 원본 칸의 비밀 |
| 정의·문서·모의 API(GI-01, GI-08, A02~A05, B01·B02, F01·F02) | `n08-workflows` | 사용자 설정에만 등록한 정의로 실행(엔진 변경 없음), 도구 줄이기, 해석 오류 8종(실행 전, 값 미출력), 지시문 비밀 가림, 프로필의 `workflowRef`, 검증기 없는 정의 `no_verifier`, 내장 document, 옛 task의 기록. 모의 API: organize 요청의 도구 묶음과 스키마, 지시문은 system에만 |

- task 파일은 `policy`와 `verifiers`를 반드시 적으므로 정의의 정책·검증기 기본값은 간편 형식에만 쓰인다. 그래서 organize task는 `planActions`를 직접 적는다(`writeOrganizeTask`).
- 하드 링크가 없는 볼륨에서의 동의 없는 이동 중단(DR-21, `consent_required`)은 이 기계(NTFS)에서 재현할 수 없어 통합 사례로 두지 않는다. 읽기 전용 원본도 정상 이동됨을 확인했다. 도구·store 유닛이 맡는다.

## 진단 (Z-1)

- 단언 메시지(`parseCliOutput`, `parseCommandOutput`)는 종료 코드, 신호, 소요 시간, pid, stdout·stderr 앞부분을 담는다(`describeRun`).
- `CODARYN_IT_PID_LOG=<작업 디렉터리 밖 파일>`이면 CLI 시작과 `killQuietly`마다 한 줄(`spawn|kill <pid> <ms> ...`)을 덧붙인다. 다른 시험의 CLI pid를 죽이는지 찾는 용도이며 기본은 꺼짐이다.
- pid로 프로세스를 죽이는 정리는 그 시험이 멈춘 것을 확인하지 못한 pid에만 한다. Windows는 놓인 pid를 몇 초 안에 다른 프로세스에 준다(`a08`, `g01` T-2).
- `t.after`는 등록한 순서로 실행된다. 샌드박스 삭제보다 먼저 해야 할 정리는 `createSandbox`보다 먼저 등록한다.
- 주인이 죽은 잠금(`a08`, `t01` T-9)에는 끝난 프로세스의 pid가 아니라 `UNASSIGNABLE_PID`를 쓴다(Z-2). 잠금의 생존 판정은 pid만 보므로(`src/store/lock.ts`, architecture A-6), 부하 중 그 pid가 다른 프로세스에 다시 주어지면 죽은 잠금이 살아 보인다.

## 격리

- 사례마다 `<tmp>/codaryn-it-*/`를 만들고 끝나면 지운다. task와 대본은 작업 공간 밖(base)에 둔다.
- CLI 환경은 `CHILD_ENV_ALLOWLIST`만 상속한다. 개발자 환경의 API 키나 모델 설정은 넘어가지 않고, 테스트 코드가 `extra`로 키 변수를 넣으면 예외가 난다. 모의 API 테스트만 `fakeApiKey`로 가짜 키를 넣는다.
- 기계와 무관한 결과를 위해 `DETERMINISTIC_ENV`를 늘 더한다(`extra`가 우선). `CODARYN_LANG=en`으로 사람용 글을 영어로 고정하고, POSIX에서는 `XDG_CONFIG_HOME`을 만들지 않는 폴더로 두어 개발자의 기본 설정 파일을 읽지 않게 한다. Windows는 `APPDATA`를 상속하지 않으므로 기본 설정 위치가 없다(N-1, N-4).
- 바이트가 중요한 fixture는 실행 중 생성한다. 가짜 비밀은 `tests/fixtures/secrets.ts`에만 있다.

## 입증하지 않는 것

네트워크 차단, OS 격리, 목록 밖 변형이나 최선 노력 탐지의 누락률, 실제 API 동작, 전원 차단 수준의 원자성. 프로세스 정리는 이 테스트가 띄운 손자 프로세스 한 단계까지만 확인한다.
