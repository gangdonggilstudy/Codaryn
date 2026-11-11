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
| j `--env-file` | `m02-fake-api-settings` | 임시 폴더의 가짜 값 파일에서 키·모델·주소를 읽음. BOM이 있는 env 파일은 `invalid_config`, 요청 0건 |
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

- `node --test`는 소요 시간을 출력하므로 같은 코드라도 출력 바이트가 매번 다르다. 같은 실패 반복 사례는 출력이 코드에만 달린 `checks/price-check.mjs`를 쓴다.
- 기록 검사에서 `runs/<runId>/snapshots/`는 뺀다(`stateRecordTexts`). 계약상 스냅샷은 작업 공간 파일과 같은 원문 자료다(R-8). 그 밖의 상태 디렉터리 파일은 모두 검사한다.

## 격리

- 사례마다 `<tmp>/codaryn-it-*/`를 만들고 끝나면 지운다. task와 대본은 작업 공간 밖(base)에 둔다.
- CLI 환경은 `CHILD_ENV_ALLOWLIST`만 상속한다. 개발자 환경의 API 키나 모델 설정은 넘어가지 않고, 테스트 코드가 `extra`로 키 변수를 넣으면 예외가 난다. 모의 API 테스트만 `fakeApiKey`로 가짜 키를 넣는다.
- 바이트가 중요한 fixture는 실행 중 생성한다. 가짜 비밀은 `tests/fixtures/secrets.ts`에만 있다.

## 입증하지 않는 것

네트워크 차단, OS 격리, 목록 밖 변형이나 최선 노력 탐지의 누락률, 실제 API 동작, 전원 차단 수준의 원자성. 프로세스 정리는 이 테스트가 띄운 손자 프로세스 한 단계까지만 확인한다.
