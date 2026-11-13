# 프로세스 통합 테스트

담당: 검증 엔지니어. 실제 CLI 프로세스, 실제 파일시스템, 실제 자식 프로세스로 단계 1a부터 범용 작업까지의 수용 기준과 결정을 확인한다. 모델은 scripted 대본이거나 로컬 가짜 서버(모의 API)다. 실제 API 키와 실제 API는 쓰지 않는다. 실제 호출 점검은 `tests/live/`에 따로 있다.

실행: `npm run test:integration`(빌드 후 `dist/tests/integration/**`). CLI(`dist/src/cli/main.js`)가 없으면 모든 사례가 실패한다.

| 파일 | 절 |
| --- | --- |
| `a01`~`a10`, `encoding` | 수용 기준 대응 |
| `r01` | 교차 검토 회귀 |
| `m01`~`m03` | 모의 API 검증 |
| `p01`~`p05`, `g01` | 단계 2 재수정 반복 |
| `s01` | 교차 검토 결함 수정 회귀 |
| `t01`, `g01` T-2·T-4 | 단계 2 교차 검토 수정 회귀 |
| `k01`~`k03`, `v01` | 단계 3 자기 개발 |
| `y01` | 모델 목록 |
| `n01`~`n05` | 사용성 |
| `n06`~`n09` | 범용 작업 |
| `n10` | 키 없는 예시 둘(U-128): 사용 안내 18.9 자료 분석(`examples/analyze-demo`), 18.10 사용자 정의 작업 종류(`examples/workflow-demo`)를 사본에서 문서 순서대로 돌려 인용 블록과 실제 출력을 비교 |
| `n11` | Markdown 규칙(U-116)의 상한과 멈춤(U-151, R-89 M-1·L-2): 줄 상한 밑의 약 1 MB `[` 문단이 선형으로 읽혀 `done`, 없는 대상 7만 개의 링크 확인 중에도 시간 한도와 취소 파일이 제때 듣는다. 시간 단언은 넉넉한 한계(15초)이고, 대상 확인이 한도 전에 끝나는 빠른 파일 시스템에서는 끝난 시각만 본다 |
| `n12` | 쓰기 허용 경로 `writablePaths`(U-194, U-182·U-186·U-183, Codex V-6): 네 원천(설정, 프로필, 작업 종류 정의, task)이 함께 다른 목록을 둘 때의 교집합, 한 원천만 좁힐 때와 빈 목록, 원천별 잘못된 목록의 실행 전 거부, Windows 대소문자와 잘못된 쓰기 경로(`invalid_path`), 간편 형식(가짜 API)과 모델에게 가는 거부 힌트, 설정·프로필·정의 목록의 doctor 경고, 적용의 설정 목록, 같은 입력의 CLI와 앱 결정 일치 |
| `n13` | 잠금 풀기(U-194, U-176): 실행이 잠금을 풀 때 다른 프로세스가 잠금 파일을 지우기 공유 없이 쥐면, 잠깐(0.1초)은 다시 시도로 `done`이고 다음 실행이 시작된다. 오래(4초)는 기록은 완전하지만 CLI가 `internal_error`(70)로 끝나고, 남은 잠금은 죽은 잠금으로 doctor가 알리고 다음 실행이 거둔다. Windows 전용(PowerShell이 쥠) |
| `n14` | 앱 계층의 텍스트 편집(U-199, U-172): GUI 엔진 호스트가 만드는 앱(`createNodeAppEnvironment`)과 실제 설정 파일, 환경의 키·가릴 값, 옆에서 도는 실제 CLI 실행으로 `readWorkspaceText`·`writeWorkspaceText`를 본다. 가릴 값·키 값·키 모양이 든 파일은 읽기 전용, 설정·task의 보호 경로, BOM·CRLF 바이트 보존과 섞인 줄 끝, 실행이 쥔 잠금 동안의 저장 거부와 끝난 뒤의 저장(실행 기록 그대로), 실행이 바꾼 파일의 conflict, 새 글의 키 모양·가릴 값·CR 거부, 줄 끝·BOM을 붙여 센 크기 상한 |
| `n15` | 계획 실행(U-217, 묶음 B-4: U-187·U-191·U-195·U-198, Codex V-11·V-14): 작업 종류의 `plan: "run"`을 실제 CLI와 대본 모델로 본다. 끝에서 끝까지(run → plan JSON·글 → 다이제스트 앞 12자로 apply → 결과·runs·두 report·changes → 두 번째 apply 거부 → revert로 처음 바이트), task의 goal을 바꿔도 수행 실행은 계획 실행의 goal을 받음. 승인 없이는 바뀌지 않음(계획 실행의 쓰기, 다이제스트 없음·틀림, 기록 없는 실행 id, 기록 없는 작업 공간). 승인 목록 밖 쓰기의 거부와 끝 요약의 전용 줄·새 계획 안내. 승인 뒤 파일 수정·삭제·생성 자리 선점·길 위의 정션으로 모델 요청 전 `plan_stale`(계획은 쓰이지 않음). 계획 실행의 goal을 읽을 수 없으면 `invalid_run_record`. 승인 뒤 좁힌 `writablePaths`(task·설정)는 모델 전 `plan_stale`, 목록이 허용해도 계획 밖이면 거부. 사용자 파일은 `.codaryn` 밖 전체의 SHA-256, 모델 요청은 모든 실행의 journal로 센다 |
| `n16` | 개인정보 자료 카나리 틀의 자기 시험(U-232, 묶음 A의 A-8을 위해). 아래 "개인정보 자료 카나리 틀" 절 |
| `n17` | 조립한 개인정보 실행(U-236; U-208 `query_table`, U-203 읽기 제외). 아래 "개인정보 자료 카나리 틀" 절의 "조립한 실행" |
| `n18` | 실제 CLI의 개인정보 실행(U-245; U-210 묶음 A의 CLI, 검토 R-108 H-1). 아래 "개인정보 자료 카나리 틀" 절의 "실제 CLI" |
| `o00`~`o05` | OpenAI 모의 API |
| `c01` | GUI 계약 층(U-112): 같은 대본을 CLI와 앱 계층(GUI 엔진 호스트의 길)으로 돌려 결과와 기록 비교 |

## GUI 계약 층 (`c01-cli-app-contract`, U-112)

설계 `docs/design/standalone-gui.md` 8.3·12절의 계약 시험이다. 사례마다 같은 task 파일, 대본, 작업 공간 파일, 환경으로 샌드박스를 둘 만든다. 하나는 CLI 프로세스(`run --task --json`, `apply --task --run --digest`)로, 다른 하나는 GUI 엔진 호스트처럼 만든 앱(`createCodarynApp(createNodeAppEnvironment())`)의 `startRun`·`applyPlan`으로 돌린다. `EngineResult`(`ApplyResult`)와 `journal.jsonl`(사건 종류와 순서, 가림본을 포함한 모든 필드)이 같아야 한다.

- 정규화는 어느 두 실행이든 다른 값만 한다.
  - 실행 id와 계획 다이제스트: 다이제스트는 실행 id를 담은 `plan.json`의 SHA-256이다. 그래서 두 `plan.json`이 실행 id만 빼고 같은 바이트인지를 먼저 본다.
  - 가림 토큰: 계약상 실행마다 무작위다. 처음 나온 순서대로 이름을 붙여, 같은 토큰이 같은 자리에 있는지는 계속 본다.
  - 시각(기록의 `at`, 도구 결과 안의 파일 시각), `durationMs`, 샌드박스 폴더.
- apply 기록의 `approval`은 통로 이름이다(`cli-flag`, `adapter`). 양쪽 값을 따로 확인한 뒤 비교에서 뺀다.
- 사례: 문서 실행(등록한 비밀을 읽고 가림), 거부가 있는 실행(허용되지 않은 명령, 작업 공간 밖 쓰기, 보호 경로 쓰기), 재수정이 있는 실행, 계획 실행 → apply, 모델 오류로 끝난 실행(대본이 다함).
- 어긋남이 나오면 고치지 않고 그 사례를 todo로 두고 무엇이 다른지 보고한다(PM). 처음 작성 때(main `5c931d1`)는 어긋남이 없었다.

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
| A10 실제 호출 경로 거부 | `a09-a10-status-provider` | `provider_not_configured`, 실행 디렉터리 없음. 비밀 변수·대본이 없는 실행 전 오류 |
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
| DR-36 (c) | Anthropic 거부 모양(`sk-ant-` 뒤 32자 이상, 숫자 포함)의 값은 `key_in_file`·요청 0건. 짧은 이름, 숫자 없는 긴 이름, 단어에 붙은 `sk-ant-`는 거부되지 않고 모델까지 감. 키 모양 자료는 `fixtures/anthropic.ts`의 조립식 `ANTHROPIC_REFUSED_SHAPE` 하나를 쓴다 |

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

## 단계 3 자기 개발 (`k01`~`k03`, `v01`)

[작업 지시](../../docs/work-orders/phase-3-self-development.md)의 U 결정과 투입 전 최종 검토(L1) 결함 수정(V)을 확인한다. 연습 프로젝트는 `fixtures/repair-project.ts`, 보호 자료를 바꾸는 허용 명령은 `fixtures/self-dev.ts`의 `tamper.mjs`다.

| 결정 | 파일 | 판정 근거 |
| --- | --- | --- |
| U-1·U-2 보호 자료 | `k01-integrity` | 허용된 명령이나 검증기 자신이 보호 테스트 또는 작업 공간 밖 `integrity.paths`를 고치면 `needs-input`/`protected_changed`. 그 뒤 검증·재수정·모델 요청 없음. 기준은 실행 시작(재수정 뒤의 변경도 잡음), 바뀐 경로는 가림본. 대조군: 그대로면 정상 판정, 보호가 없으면 확인·기록 없음. `integrity.paths`의 형식·위치 위반은 `invalid_config`(경로 미출력), task 파일로는 못 정함 |
| U-3 설치 위치 | `k02-commands` | 작업 공간이 CLI 설치 위치와 같거나, 그 안이거나, 그것을 포함하면 실행 전에 거부. 이 저장소가 아니라 빌드한 CLI의 사본으로 확인 |
| U-5 report | `k02-commands` | `--json`(결과·기록 요약, 무변경, 비밀 없음), Markdown(실행 id), `result.json` 없는 실행은 기록만으로(쓰는 중인 마지막 줄 무시), 오류 4종 |
| U-6 doctor | `k02-commands` | 모의 API. `--json`의 항목별 점검, 글 출력과 같은 종료 코드, 문제는 항목으로. 키 값·경로 없음, 요청 0건, 쓰기 없음 |
| U-7·U-8 | `k02-commands` | `--help`, `--version`, 명령별 도움말. 진행 줄은 stderr에(가짜 비밀·변형·조각·가짜 키 없음), stdout은 JSON 한 줄, `--quiet`이면 stderr가 비고 결과는 같음 |
| 자기 개발 예행 | `k03-self-dev-rehearsal` | 이 저장소 일부(`src/contracts`, `src/privacy`와 그 유닛)의 사본이 후보 작업 공간이다. 작업 공간 밖의 보호된 검증기가 이 저장소의 TypeScript로 컴파일하고 유닛을 돌린다. 작은 변경 통과 → report·revert, 타입 오류 → 재수정 → 통과, 허용 명령이 보호 테스트나 밖의 검증기를 고치면 `protected_changed`, 가짜 서버 모델로 같은 통과 흐름. 이름은 `[예행·모의 모델]`로 시작하며 실제 자기 개발의 증거가 아니다 |
| V-1 실패 서명 | `v01-l1-regress` | 실행마다 바뀌는 숫자(시각·소요 시간·날짜·주소)만 정규화한다. 실제 값이 바뀐 실패(999.9 → 1000.1)는 같은 실패로 묶지 않고 재수정 2회 뒤 `done` |
| V-2 덜 읽은 출력 | `v01-l1-regress` | 부모가 끝난 뒤 분리된 자식이 파이프를 쥐고 있어 실행기가 끝까지 읽지 못한 출력은 `truncated`가 아니다. 마지막 불완전한 줄(끊긴 비밀의 앞부분)만 버리고 완전한 줄은 모두 남는다. 기록 어디에도 비밀 4자 조각 없음 |
| V-3 | `v01-l1-regress` | `--env-file-if-exists`도 `--env-file`처럼 `invalid_arguments`, 값을 읽지 않고 `--vars-file`을 안내 |

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
| 체험 예시 | `n01-demo-walkthrough` | `examples/demo`를 저장소 밖에 복사해 [사용 안내](../../docs/usage.md) 3절의 명령(doctor → run → runs → report → revert --dry-run → revert)을 그대로 실행. 문서의 명령 목록과 옵션, doctor 종료 0·`api_key` 건너뜀 문구, 진행 줄(`codaryn: ` 접두사 줄) 전체, 그 뒤의 끝 요약(실행 id, `codaryn report`·`codaryn revert`, N-5), 결과(`done`/`verified`, 변경 2건, 재수정 1회), 보고서 인용 줄(Markdown 렌더링 기준), 검증기를 id가 아닌 순번으로 보임(N-24 (a), `--json`에는 id), 검증 통과·보호 대상 확인 5회, revert `complete`와 원래 바이트, 두 번째 revert `partial`/`changed_since_run`/종료 3, 되돌리지 않은 재실행의 `conflict`와 빈 `changes`. init으로 만든 기본 설정이 있으면 문서의 두 줄이 더 나오고 결과는 같음. 키 없음, 네트워크 울타리 |
| 처음 쓰는 흐름(E-1), init 세부(E-9) | `n02-first-use` | 샌드박스 안의 기본 설정 위치(`support/usability.ts`)로 init(비대화형 기본값, 자리표시자 모델, 키 없음, 위치는 기호로만) → 다시 init `config_exists` → doctor(기본 설정, 모델·키 실패와 안내) → 체험 예시(기본 설정 사용 알림) → runs → report·revert `--run latest`(고른 실행 id를 stderr에 먼저) → `--dry-run`(파일·기록·잠금 무변경) → revert(원래 바이트, 되돌리기 기록) → 다시 revert(`already_reverted`, `complete`). init의 `--config`, `CODARYN_CONFIG`(`overriddenBy`), 작업 공간 안 거부, 제안 미적용, 키 미기록·미전송, 기본 위치 없음 |
| 실행 목록과 latest(E-6), R-2, R-7 | `n03-runs-latest` | 위조 실행(미래 시각, 시각 불일치, 결과 파일 포함)은 손상으로 표시되고 latest가 되지 않으며 id를 지정해도 `invalid_run_record`(N-26), 사용자 `notes.md` 보존. 결과 파일 없는 실행은 latest 후보 아님. 되돌리기 기록만 손상된 실행은 진행(N-23 g). 기록 없음, `runs/latest` 디렉터리(N-18), `--limit`, 잠금 중 목록. R-7: 손상 실행의 id를 대소문자만 바꿔도 되돌리지 않음(N-27 a), `report --json`도 제어 문자로 끊긴 키 모양을 가림(N-27 c), 손상된 되돌리기 기록이 있어도 runs 글 출력은 종료 0, 살아 있는 잠금의 거부는 stderr에 안내(N-25 a) |
| 설정 순서·자리표시자·프로필·한 줄 실행(E-2, E-3, E-7, E-8) | `n04-config-profiles` | 모의 API. 요청의 모델로 `--config` > `CODARYN_CONFIG` > 기본 위치, 기본 위치 사용 알림, 작업 공간 안 거부, 상대 경로는 없음과 같음. 자리표시자는 다음 단계로, 모두 자리표시자면 `provider_not_configured`. 프로필의 한도·검증기, 상한·이름 오류, task 파일의 `profiles` 거부. 한 줄 실행의 현재 디렉터리, 설치 위치·키 모양 목표·인자 혼용 거부 |
| 언어·사람용 출력(E-4, E-5), R-3 | `n05-language-output` | ko·en에서 stdout 동일·stderr만 다름, 고르는 순서, 잘못된 `language` 값 미출력. JSON 문법 오류의 줄·열, 모르는 필드 이름 미출력(N-15), `--quiet`, ASCII JSON(N-19). 검증기 id(`SYNTHETIC_PRIVATE_VALUE` 등)가 진행 줄·끝 요약·Markdown에 없고 `--json`에만 있음(N-24 a) |

- 실행 전 오류의 stderr는 `assertHumanError`로 모양만 본다(코드 괄호, 스택·예외 문구 없음, 같은 줄 반복 없음, 경로·값 없음). `--quiet`이면 비어 있다(`s01`).

## 범용 작업 (`n06`~`n09`, G-G)

[범용 작업 설계](../../docs/design/general-tasks.md) 10.2절과 G-A 계약(`src/contracts/plan.ts`, `workflow.ts`, `verify.ts`), DR-5·DR-9·DR-12·DR-17·DR-24·DR-28을 실제 CLI 프로세스로 확인한다. 대본 모델이고, F 계열만 가짜 서버(모의 API)다. 기대 배치는 `fixtures/general-tasks.ts`의 `afterActions`, 집계 기대값은 손으로 계산한 `SALES_BY_REGION`이다. 도우미는 `support/general.ts`.

| 사례 | 파일 | 판정 근거 |
| --- | --- | --- |
| 파일 정리(GI-02~05, C05~C10, R-9) | `n06-organize` | 계획 실행 `plan_pending`(작업 공간 무변경) → `plan`(다이제스트·행동·원본 해시) → `apply --digest`(inventory 통과, 판정 기준과 같은 배치, 보관함 이름은 순번, `applied.json`, `apply_started`부터 시작하는 기록) → 다시 적용 `plan_already_applied` → `revert`(역순, 원래 바이트) → 다시 `already_reverted`. 승인 거부 4종, 오래된 계획 5종(`plan_stale`, 무변경), 계획 단계의 쓰기·명령, 거부 계획 14종, 동시 적용, 적용 뒤 사용자 변경, 계획 아닌 실행·변조, 비밀 이름 가림. R-9: 보관함 정션과 적용 뒤 바뀐 `plan.json`으로 밖 파일·다른 경로를 건드리지 않음 |
| 자료 분석(GI-06·07, D03~D05) | `n07-analyze` | `data_checks` 통과 → `awaiting_review` → `review --task`(review.json만, 결과·기록 그대로) → report에 판정 → `--reject`로 교체. 틀린 합계 → 근거는 비교한 수만 → 재수정. 숫자 아닌 원본 → `verifier_inconclusive`. review 오류 4종. 원본 칸의 비밀 |
| 정의·문서·모의 API(GI-01, GI-08, A02~A05, B01·B02, F01·F02) | `n08-workflows` | 사용자 설정에만 등록한 정의로 실행(엔진 변경 없음), 도구 줄이기, 해석 오류 8종(실행 전, 값 미출력), 지시문 비밀 가림, 프로필의 `workflowRef`, 검증기 없는 정의 `no_verifier`, 내장 document, 옛 task의 기록. 모의 API: organize 요청의 도구 묶음과 스키마, 지시문은 system에만 |
| 다른 비밀의 계획(R-11 M-1) | `n09-plan-secrets` | 등록한 비밀이 이름인 폴더가 든 organize 계획. 계획 실행과 같은 task 형식(같은 비밀)이면 plan·apply가 동작하고 `plan.json` 밖에 비밀 없음(대조군). 비밀을 등록하지 않은 task로(변수가 있든 없든) plan·apply하면 `plan_secrets_differ`(종료 2)와 사람용 오류, 무변경, 적용 실행·기록 없음, 비밀 미출력(DR-28). 반대 방향(비밀 없이 만든 계획을 비밀을 등록하고 보거나 적용)도 같은 거부 |

- task 파일은 `policy`와 `verifiers`를 반드시 적으므로 정의의 정책·검증기 기본값은 간편 형식에만 쓰인다. 그래서 organize task는 `planActions`를 직접 적는다(`writeOrganizeTask`).
- 하드 링크가 없는 볼륨에서의 동의 없는 이동 중단(DR-21, `consent_required`)은 이 기계(NTFS)에서 재현할 수 없어 통합 사례로 두지 않는다. 읽기 전용 원본도 정상 이동됨을 확인했다. 도구·store 유닛이 맡는다.

## OpenAI 모의 API (`o00`~`o05`, 두 번째 제공자 SP-5·SP-6)

[두 번째 제공자 설계](../../docs/design/second-provider.md)와 [사실 확인](../../docs/design/second-provider-facts.md)(C-1~C-15)을 따른 가짜 Responses API(`tests/support/fake-openai.ts`)와 값(`tests/fixtures/openai.ts`)이다. **모의 API 검증이며 실제 API 검증이 아니다.** `o01`~`o04`는 main의 CLI(SP-6)로 실행하고, 주소는 `CODARYN_OPENAI_API_BASE_URL`이나 `providers.openai.apiBaseUrl`의 가짜 서버(127.0.0.1)뿐이다.

| 사례 | 파일 | 판정 근거 |
| --- | --- | --- |
| OI-01 도구 호출 왕복 | `o01` | 읽기 → 쓰기 → 최종 답이 `done`/`verified`. 모든 요청이 `store: false`, `strict: false`의 평평한 도구, 대화 사슬, `call_id`로 답함. 사용량은 캐시·추론 토큰을 더하지 않은 합. 키는 Bearer에만 |
| OI-02 추론 항목 | `o01` | 같은 JSON으로 되돌림(2개, 3개), 기록 `model_response.reasoningItems`는 [2, 1, 없음]. 규칙 밖 `call_id`는 기록에 `codaryn-call-1·2`, 요청에는 원래 값. 출력·기록에 추론 내용·원래 id·키 없음 |
| OI-03 실행 기록 읽기 | `o01` | 끝난 OpenAI 실행이 `runs`에서 손상이 아니고 `report`·`changes`·`revert --dry-run`·`revert`가 동작한다. store의 손 목록 결함(`src/store/runs.ts:50`)을 잡았고 `9871716`에서 계약 상수로 고쳐졌다 |
| OI-03b 제공자 검사 대조 | `o01` | 끝난 대본 실행의 기록·결과에서 제공자를 계약 안의 `anthropic`으로 바꾸면 그대로 읽히고 되돌려진다(대조군), 계약 밖 이름이면 손상·`invalid_run_record`·무변경. store가 아무 이름이나 받게 하면 실패함을 확인했다 |
| 제공자별 변수 | `o02` | 모델: task > `CODARYN_OPENAI_MODEL` > `providers.openai.model`. 주소: `CODARYN_OPENAI_API_BASE_URL` > `providers.openai.apiBaseUrl`. `CODARYN_MODEL`·`CODARYN_API_BASE_URL`은 OpenAI 실행에 쓰이지 않음 |
| R-20 D2와 반대 | `o02` | 두 키·두 주소 변수가 있어도 `models`(설정 `provider: openai`)와 `--provider anthropic`이 각자 주소로만, 각자 키로만 |
| SP-I03 | `o02` | 두 키가 있으면 어느 제공자로 실행해도 작업 파일 속 다른 제공자의 키(20자 이상)가 토큰으로 가려짐 |
| R-20 E | `o02` | `OPENAI_API_KEY`가 `EMPTY`·`ollama`·`x`여도 대본 실행이 그 단어 옆 줄을 고치고 명령을 돌림. 기록에 토큰 없음 |
| 키 없음 | `o02` | `provider_not_configured`, 다른 제공자 키를 쓰지 않고 요청 0건 |
| 할당량·빈도·잘림·거부 | `o03` | 할당량 6가지 `quota_exhausted`(1건), 429 반복 `rate_limited`(같은 바이트 3건), `Retry-After: 2`의 서버 쪽 간격 2초 이상, 503 회복, `max_output_tokens` 잘림은 `malformed_response`(stop=length), 거부·내용 필터는 고정 문구(거부 글 없음) |
| OI-40·41 모델 목록 | `o04` | `models --provider openai`(설정이 anthropic이어도): GET 한 번, API 순서, `displayName` = id, 한도 null, 현재 모델 출처 `config`·`CODARYN_OPENAI_MODEL`, `listed`. 글 출력의 현재 모델 줄이 변수 이름을 가리킴 |
| 목록 실패 | `o04` | 키 없음 `provider_not_configured`, 401·형식 오류 `model_list_failed`, 설정 무변경 |
| OI-44 doctor | `o04` | 키 점검이 `doctor.api_key.sends_to_config`·`sends_to_env`(키 변수, 제공자, origin, 필드·변수)로 키가 갈 주소를 알림(DR-36 (b)), 요청 0건 |

빌드 산출물에 회귀를 넣으면 실패함을 확인했다: 다른 제공자 키 길이 기준 0(R-20 E), OpenAI 주소 변수를 `CODARYN_API_BASE_URL`로(R-20 D2), 어댑터 `store: true`.

`o05`는 CLI 없이 어댑터(`src/model/openai`)를 가짜 서버에 직접 붙인다. 어댑터는 Node의 `fetch`로 보내고, 재시도 대기만 기록용으로 주입한다(한 사례는 실제로 기다리고 서버 쪽 간격을 잰다). 엔진처럼 `complete`를 부른다: 호출을 엔진의 id로 되읽고(AC-D15가 바꾼 id), 도구 결과로 답한다.

| 사례 | 판정 근거 |
| --- | --- |
| 한 번의 도구 호출 왕복 | 규칙 밖 `call_id`가 그대로 엔진에 오고, 엔진 id(`codaryn-call-1`)로 되읽어도 원래 `call_id`로 답한다. 추론 항목이 같은 JSON으로 돌아가고 엔진 결과에는 개수만 있다. 사용량은 캐시·추론 토큰을 더하지 않는다. 사슬·규약 위반 0, 키는 Bearer에만 |
| 할당량 소진 6가지 | `quota_exhausted`, HTTP 429, 요청 1건씩, 재시도 대기 없음 |
| 빈도 한도 | 3번 모두 429면 `rate_limited`이고 요청 3건의 본문이 같다. 코드 없는 429 뒤 회복, `Retry-After: 3`이면 대기 3초 이상, 실제 대기에서 서버가 본 간격 1초 이상, 503 `overloaded` |
| 출력 한도 잘림 | `incomplete`/`max_output_tokens`는 `length`. `content_filter`는 "declined" 고정 문구, `max_messages`는 이유만 인용, 재시도 없음 |
| 거부·실패·오류 문구 | 거부 글 없이 고정 문구, `failed`는 code만, 400 문구에서 키·`sk-` 모양 제거와 300자 이하 |
| 모델 목록 | `GET {주소}/models` 한 번(질의 없음), API 순서, `displayName` = id, `createdAt` RFC 3339, 한도 null. 401 `auth_failed`(재시도 없음) |

빌드 산출물의 어댑터에 결함 셋(`store: true`, 추론 항목 빼기, 엔진 id로 답하기)을 넣으면 `o05`가 실패함을 확인했다.

- 가짜 서버
  - `POST /v1/responses`와 `GET /v1/models`만 받는다. CLI 설정의 주소는 `<url>/v1`이다(`baseUrl`).
  - 받은 요청을 모두 기록한다. 서버가 요청을 다 받은 시각도 남겨 Retry-After 최소 대기를 서버 쪽에서 잰다.
- 규칙: 어기면 400과 OpenAI 오류 본문이고, 대본을 쓰지 않는다. 메시지는 필드와 위치만 말하고 값은 싣지 않는다.
  - 사실 문서 규칙(C-n)
    - `Authorization: Bearer`
    - `model`, `input` 목록, `max_output_tokens` 16 이상, `store: false` 명시
    - 평평한 함수 도구, `strict: false`, 이름 `^[a-zA-Z0-9_-]{1,64}$`
    - `function_call_output`의 `call_id`와 문자열 `output`
    - Chat Completions 필드(`messages`, `function` 감싸기)와 `previous_response_id`가 없음
  - 설계 규칙(메시지 끝 `(expected by the design)`)
    - 직전 응답의 출력 항목(추론 항목 포함)을 같은 순서·같은 JSON으로 모두 되돌림
    - `function_call`과 `function_call_output`이 `call_id`로 하나씩 짝
    - 다른 제공자의 헤더와 선택 헤더(`OpenAI-Organization`·`-Project`)를 보내지 않음
    - 모델 목록에 쪽 넘김 질의가 없음
  - 대화 사슬(매 요청이 앞 요청의 입력과 응답 출력으로 시작)은 서버가 막지 않는다. 사례가 `assertContinuation`으로 단언한다(PM 결정).
- 가짜 키
  - `FAKE_OPENAI_KEY`는 `cliEnv({ fakeOpenAiKey })`로만 `OPENAI_API_KEY`에 들어간다.
  - `extra`로는 어느 키 변수도 넣을 수 없다. `sk-`로 시작하는 값은 가짜 키로도 받지 않는다.
  - `sk-` 모양 값은 `skShapedValue`로 실행 중에만 만든다. 소스에 그 모양이 없음을 `o00`이 확인한다. 계약의 두 모양(DR-32 (a))을 따른다.
    - `refused`: 실행을 거부하는 좁은 모양(`OPENAI_KEY_PATTERN_SOURCE`)
    - `masked_only`: 출력에서 가리기만 하는 느슨한 모양(`OPENAI_KEY_LOOSE_PATTERN_SOURCE`)
- `o00`은 CLI 없이 `fetch`로 가짜 서버만 시험한다. 응답 모양, 사실·설계 규칙 위반, 대본 소진, 사슬 검사, 오류·할당량 본문, 모델 목록, 매달림·범람, `cliEnv` 가드, fixture 불변식을 본다.
  - 규칙 셋(`store`, `strict`, 출력 되돌림)을 빌드 산출물에서 하나씩 빼면 `o00`이 실패함을 확인했다.
- 키 변수와 키 모양은 제공자 계약(SP-1)의 상수를 쓴다: `OPENAI_API_KEY_ENV`, `API_KEY_ENVS`, `API_KEY_PATTERN_SOURCES`, `API_KEY_MASK_PATTERN_SOURCES`.
  - 가짜 서버가 지키는 사실 값(`max_output_tokens` 최소 16, 주소의 `/v1`)은 계약과 따로 둔다. 두 쪽이 맞는지는 `o00`이 확인한다.

## 개인정보 자료 카나리 틀 (`n16`, U-232)

묶음 A(읽기 제외 `unreadablePaths`, `query_table`, `analyze-private`)의 통합 카나리 시험(A-8, 제안 `docs/reviews/2026-11-13-p1-bundle-proposal.md` 3.1 "보장을 어떻게 시험하나")이 쓸 틀이다. 지금 main에는 그 기능이 없다. 그래서 `n16`은 틀 자신을 시험한다. 읽기 제외가 없는 실행에서 모델이 비공개 폴더를 그대로 읽게 하고, 틀이 새어 나간 표지를 실제로 찾아내는지 본다.

**표 자료**: `tests/fixtures/private-tables.ts`
- 표지는 실행 때 무작위로 만든다.
  - ASCII 글자·숫자 9자와 한글 음절 3자, 첫 글자는 영문자다.
  - 소스에 적힌 값이 없다. 서로의 일부가 아니다. JSON·CSV·TSV가 이스케이프하거나 따옴표로 싸는 문자는 없다.
- 표는 16행이다. 열은 `person`, `contact`, `memo`, `region`, `team`, `amount`, `age`다.
  - `person`·`contact`·`memo`: 칸마다 그 행만의 표지
  - `region`: 6·5·4·1행 묶음. `team`: 7·5·3·1행 묶음. 키도 표지다.
  - 두 열로 묶으면 5행 묶음 하나(가장 큰 지역 × 가장 큰 팀)이고, 나머지는 더 작다.
  - `amount`·`age`: 행마다 다른 정수
- k = 5(`DEFAULT_MIN_GROUP_SIZE`)
  - 6·5행 묶음의 키는 그 한 열로 묶는 질의가 보인다. 양성 대조다.
  - 4·3·1행 묶음의 키는 어떤 질의도 보이지 않는다. 두 열 묶음은 어느 한 열의 묶음보다 크지 않기 때문이다.
- `writePrivateWorkspace(sb, { dir, k })`가 읽기 제외 폴더(기본 `private`)에 쓰는 것
  - `people.csv`, `people.tsv`, `people.jsonl`: 표마다 다른 표지
  - `notes.txt`: 줄마다 표지
  - 이름이 표지인 파일 하나와 폴더 하나(R-4: 이름도 숨긴다)
  - 그리고 표지 없는 `public/guide.md`
- 돌려주는 것
  - `rowMarkers`: 행·줄의 표지
  - `nameMarkers`
  - `smallKeys`: k 미만 묶음의 키
  - `largeKeys`: 양성 대조
- 오라클 `groupsOf`·`shownKeysOf`·`neverShownKeysOf`는 `src/tabular`와 따로 계산한다. `n16`은 제품의 표 읽기(`queryTable`)가 세 형식 모두에서 이 오라클과 같은지, 계약의 `shownGroups`(k=5)가 같은 키를 보이고 숨기는지 확인한다.

**찾는 도우미**: `tests/support/private-canary.ts`
- `canarySources({ workspace, runs, anthropic, openai, scripted })`가 경로마다 붙인 출처를 모은다.
  - `model`: Codaryn이 모델에게 보낸 것.
    - 가짜 API의 요청마다 system, 도구 정의, 모델 자신의 것이 아닌 메시지·항목이다.
      - Anthropic: role이 user인 메시지(도구 결과 포함)
      - OpenAI: 모델의 메시지·function_call·reasoning이 아닌 입력 항목
    - 대본 모델이면 journal의 `model_request` 기록이다.
    - 모델의 앞선 차례는 대화로 매 요청에 되돌아온다. 그래서 그것은 뺀다. 대본이 도구 인자에 넣은 표지(예: `search_files`의 `text`)가 새어 나간 행으로 잡히지 않게 하기 위해서다. 본문 전체가 필요하면 `modelEchoSources`를 쓴다.
  - `records`: `.codaryn` 아래 모든 파일(변경 스냅숏은 계약상 원본 사본이라 뺀다), JSON은 풀어서도.
  - `output`: CLI 프로세스마다 stdout·stderr(stdout은 풀어서도). `report` 같은 다른 명령의 출력도 `runs`에 이름을 붙여 넣는다.
- `findCanary(sources, canary, { fragments })`가 찾는 꼴
  - 그대로 쓴 꼴, `leak.ts`의 변형(JSON 이스케이프 1~3번, Base64, URL, hex)
  - 한글을 `\uXXXX`로 쓴 JSON(한 번, 두 번): CLI의 stdout JSON이 한글을 그렇게 쓴다(`n16`에서 확인)
  - `fragments`를 주면 그 길이의 조각도 찾는다. 상한에 잘린 표지다.
- 결과를 다루는 함수
  - `leaksOf`: 행·이름·작은 키
  - `foundIn(findings, channel, list)`
  - `describeFindings`: 단언 메시지용

**A-8에서 쓸 때**
- 읽기 제외 폴더에 `writePrivateWorkspace`로 쓰고, 모든 길을 부르는 대본을 둔다.
- 그 뒤 단언한다.
  - `leaksOf(findCanary(canarySources(...), canary))`가 `model` 경로에서 비어야 한다.
  - `largeKeys`는 `query_table` 결과가 간 `model` 경로에서 찾아져야 한다(양성 대조).
  - `records`와 `output`을 어디까지 깨끗해야 한다고 볼지는 A-8이 정한다. 제안 3.2는 "사람에게 보이는 것은 막지 않는다"이고, 모델의 답(`finalMessage`)에 든 것은 사람에게 보인다.
- 대본이 표지를 인자에 쓰면, 그 표지는 `records`(journal의 모델 응답)와 `modelEchoSources`에 나온다. `model` 경로에는 나오지 않는다.
- 틀 자신의 변이 확인(U-232, 빌드한 `dist`의 도우미만 고침): 다음을 넣으면 각각 맞는 사례가 실패했다.
  - `\uXXXX` 꼴을 뺌
  - 모델의 앞선 차례를 `model`에 넣음
  - journal의 `model_request`를 읽지 않음

**U-236에서 바꾼 것**
- 고침: `model_request`의 `newMessages`에는 모델 자신의 차례도 든다(role assistant: 그 글과 도구 호출 인자). U-232는 그것을 `model`에 넣었다. 이제는 가짜 API 본문과 같은 규칙으로 뺀다. `n16`의 대본 사례가 확인한다. 이 고침을 되돌리면 `n16`과 `n17`이 실패한다.
- 표에 `bonus` 열을 더했다.
  - 12행에만 수가 있다.
  - 그래서 k행 이상인데 기여 칸이 k 미만인 묶음이 생긴다. 지역 6행 묶음은 2칸, 팀 7행·5행 묶음은 각 4칸이다(U-208, Codex V-19).
- `amount`는 등차가 아니다. 그래서 묶음의 평균이 한 행의 값과 같아지지 않는다.
- 오라클 `groupsOf`는 열마다 칸 수(`cells`)를 준다.
- `numberFactsOf`는 허용하는 수와 금지하는 수를 준다. 금지하는 수는 행의 수, 그리고 기여 칸이 k 미만인 합·평균이다.
- `writePrivateWorkspace({ markedDirUnder })`: 읽기 제외 폴더의 이름도 표지가 된다.
- 도우미를 더했다: `recordedToolResults`, `numbersIn`, `factsAmong`(상대 오차 1e-9).

**조립한 실행 (`n17`, U-236)**
- 실행을 CLI처럼 조립한다(`src/cli/assemble.ts`).
  - 작업 공간과 잠금, 디스크에 journal·result.json을 쓰는 기록기
  - 가림 관문, 정책 관문, 도구·검증기 실행기, 대본 제공자
- 다른 점은 하나다. 읽기 제외와 k를 관문과 도구 실행기에 직접 준다. 지금 CLI 파서는 그것을 실행에 넣지 않는다(A-6). na-core의 U-210이 오면 같은 대본을 실제 CLI로 잇는다.
- 작업 공간: 틀의 세 표와 파일이 `data/<표지>` 아래 있다. 이 폴더가 읽기 제외이고, 그 이름도 표지다. 옆에 `data/readme.md`를 둔다.
- 대본 모델이 부르는 것
  - 표마다 `query_table` 다섯 번: describe, 전체, 지역별, 팀별, 둘 다. 연산은 `person` 개수와 `amount`·`bonus`의 개수·합·평균이다.
  - 거부되어야 하는 `min`, 글 열의 합
  - 일반 읽기 도구 모두: 폴더 안의 `read_file`·`search_files`·`inspect_files`·`write_file`, 루트와 부모에서의 목록, 이름 찾기(`people`), 글 찾기(`10`: 모든 행의 금액에 있다)
- 단언
  - 모델로 간 것과 기록 어디에도 행의 표지와 k 미만 묶음의 키가 없다.
  - 도구 결과의 어떤 수도 행의 `amount`·`bonus`나 기여 칸 k 미만의 합·평균이 아니다.
  - 일반 읽기 도구의 결과가 폴더 이름, 표 이름(`people.`), 그 아래 이름을 내지 않는다. 루트와 부모 목록은 `withheld`이고 옆 파일은 보인다.
  - 다섯 호출(폴더 안의 읽기 셋, 쓰기, 폴더 안 inspect)이 `unreadable_path`로 거부되고, 표 바이트는 그대로다.
  - 양성 대조: 모든 질의의 묶음이 오라클대로다(보인 묶음, 행 수, 값, 칸 k 미만이면 null과 `fewCells`, `suppressedGroups`). 허용된 합·평균이 모두 있고, k 이상 묶음의 키와 열 이름이 모델로 간다.
  - 실제 CLI의 `report`, `report --json`, `runs` 출력에도 행의 표지와 작은 키가 없다.
- k 5(기본)와 k 6(실행이 올린 k)으로 한 번씩 돈다.
- 변이 확인(빌드한 `dist`만 고침): 다음 넷이 각각 두 사례를 모두 실패시켰다.
  - k 검사를 뺌 → 작은 키가 모델로 감
  - 기여 칸 규칙을 뺌 → 2·4칸 bonus 합·평균
  - 목록 거르기를 뺌 → 글 찾기로 행 표지
  - 관문의 읽기 제외를 뺌 → 거부 목록

**실제 CLI (`n18`, U-245)**
- `n17`을 실제 CLI(U-210)로 이었다. U-210 자신의 시험(`tests/unit/cli/g-u210-*`)이 가지 않는 두 곳에 둔다. 하나는 읽기 제외를 주는 곳이 한 실행에 섞인 경우이고, 다른 하나는 끝에서 끝까지다.
- 곳마다 하나씩, 네 실행
  - 설정 파일(task 파일 실행, 대본 모델)
  - 프로필(간편 형식, 127.0.0.1의 가짜 Anthropic)
  - 설정의 작업 종류 정의(대본 모델). 내장 `analyze-private`는 정책이 없으므로, 그와 같은 정의다.
  - task 파일(127.0.0.1의 가짜 OpenAI)
  - 어느 실행이든 두 표에 지역·팀·둘 다로 `query_table`을 부른다. 연산은 `person` 개수와 `amount`·`bonus`의 개수·합·평균이다. 일반 읽기 도구도 폴더 안팎에서 부른다.
- 네 곳을 한 실행에: 곳마다 자기 폴더를 둔다. k를 기본으로 둔 경우와, 프로필이 6·정의가 7을 둔 경우(가장 큰 7이 걸림)다.
- 위 실행들에서 확인하는 것
  - 행의 표지와 k 미만 묶음의 키가 어디에도 없다. 모델로 간 것, `.codaryn` 아래 기록 전부, stdout, stderr, `report`, `report --json`을 모두 본다.
  - 도구 결과에 행의 수와 기여 칸 k 미만 집계가 없다.
  - 폴더와 그 아래 이름이 모델로 가지 않는다.
  - 질의 결과가 오라클대로다(`expectedGroupsOf`). 양성 대조도 본다.
  - 끝 요약이 `unreadable_path` 거부 수와 묶음·값을 뺀 결과 수를 센다.
- 실행 전 거부(기록 없음)
  - 읽기 제외(설정, 프로필, 정의, task) × 명령(task 규칙, task 검증기, 정의 규칙, 정의 검증기): task 파일 형식 16 조합
  - 간편 형식의 설정·프로필 규칙: 5 조합
  - k 5 미만: 곳마다 하나씩, 그리고 다른 곳의 6·7 옆의 4
- 계획 수행(`plan: "run"`, R-108 H-1)
  - 프로필과 정의의 폴더 아래에서 계획 실행과 수행 실행을 돈다. 두 실행 모두 두 폴더의 읽기가 거부되고, 질의가 작은 묶음을 숨기고, 새는 것이 없다.
  - 승인 뒤 설정이 계획 파일을 덮는 읽기 제외를 더하면, 수행 실행이 모델 요청 전에 `plan_stale`로 멈춘다(`path/unreadable_path`).
- 변이 확인(빌드한 `dist`만 고침): 다음 일곱이 각각 맞는 사례를 실패시켰다.
  - H-1의 고침을 되돌림 → 계획 사례. 정의의 항목은 합친 task 정책에 실려 관문에 남고, 프로필의 항목만 수행 중 풀렸다.
  - 프로필의 항목을 빼거나, 정의의 항목을 뺌 → 그 곳을 쓰는 여섯 사례
  - k의 최댓값을 무시하거나, 도구에 k를 주지 않음 → k 7 사례
  - R-5 판정을 뺌 → 명령 두 사례
  - k 하한을 풂 → k 사례

## 진단 (Z-1)

- 단언 메시지(`parseCliOutput`, `parseCommandOutput`)는 종료 코드, 신호, 소요 시간, pid, stdout·stderr 앞부분을 담는다(`describeRun`).
- `CODARYN_IT_PID_LOG=<작업 디렉터리 밖 파일>`이면 CLI 시작과 `killQuietly`마다 한 줄(`spawn|kill <pid> <ms> ...`)을 덧붙인다. 다른 시험의 CLI pid를 죽이는지 찾는 용도이며 기본은 꺼짐이다.
- pid로 프로세스를 죽이는 정리는 그 시험이 멈춘 것을 확인하지 못한 pid에만 한다. Windows는 놓인 pid를 몇 초 안에 다른 프로세스에 준다(`a08`, `g01` T-2).
- `t.after`는 등록한 순서로 실행된다. 샌드박스 삭제보다 먼저 해야 할 정리는 `createSandbox`보다 먼저 등록한다.
- 분리된 자식의 출력에 기대는 프로그램은 부모가 고정 시간 뒤에 끝나지 않는다. 자식이 쓴 뒤 IPC로 알릴 때 끝난다(`fixtures/repair-project.ts`의 `CUT_AFTER_EXIT`). 부하로 자식 시작이 늦으면, 실행기가 출력이 생기기 전에 부모 종료로 정리해 stdout이 비기 때문이다(`docs/reviews/2026-11-12-z1-investigation.md` 3절, `v01` V-2).
- 주인이 죽은 잠금(`a08`, `t01` T-9)에는 끝난 프로세스의 pid가 아니라 `UNASSIGNABLE_PID`를 쓴다(Z-2). 잠금의 생존 판정은 pid만 보므로(`src/store/lock.ts`, architecture A-6), 부하 중 그 pid가 다른 프로세스에 다시 주어지면 죽은 잠금이 살아 보인다.

## 격리

- 사례마다 `<tmp>/codaryn-it-*/`를 만들고 끝나면 지운다. task와 대본은 작업 공간 밖(base)에 둔다.
- CLI 환경은 `CHILD_ENV_ALLOWLIST`만 상속한다. 개발자 환경의 API 키나 모델 설정은 넘어가지 않고, 테스트 코드가 `extra`로 키 변수를 넣으면 예외가 난다. 모의 API 테스트만 `fakeApiKey`로 가짜 키를 넣는다.
- 기계와 무관한 결과를 위해 `DETERMINISTIC_ENV`를 늘 더한다(`extra`가 우선). `CODARYN_LANG=en`으로 사람용 글을 영어로 고정하고, POSIX에서는 `XDG_CONFIG_HOME`을 만들지 않는 폴더로 두어 개발자의 기본 설정 파일을 읽지 않게 한다. Windows는 `APPDATA`를 상속하지 않으므로 기본 설정 위치가 없다(N-1, N-4).
- 바이트가 중요한 fixture는 실행 중 생성한다. 가짜 비밀은 `tests/fixtures/secrets.ts`에만 있다.

## 입증하지 않는 것

네트워크 차단, OS 격리, 목록 밖 변형이나 최선 노력 탐지의 누락률, 실제 API 동작, 전원 차단 수준의 원자성. 프로세스 정리는 이 테스트가 띄운 손자 프로세스 한 단계까지만 확인한다.
