# 단계 2 재수정 반복 작업 지시

사용자가 2026-11-12에 임시 PM(w1:p3)에게 직접 "단계 2 재수정 반복도 이어서 진행해"라고 지시했다. 범위는 [단계별 계획](../roadmap.md)의 단계 2다. `docs/pm-control.json`의 범위는 PM이 바꾸지 않으며, 이 작업은 사용자의 직접 지시를 근거로 한다.

기준은 main `14f30f3`이다(유닛 234건, 통합 130건 통과, 실제 API 미실행).

## 범위

- 포함: 검증 실패 근거를 문맥에 넣어 다시 수정하는 반복, 재수정 횟수 한도와 같은 실패 반복 시 중단, 실패 출력의 절단 규칙, 보호 경로 정책, 실행별 변경 집합과 되돌리기 명령, 이들의 유닛과 프로세스 통합 검증(모의 모델과 가짜 서버).
- 제외: 실제 Anthropic API 호출(PM과 작업자는 하지 않는다), 자기 소스 수정(단계 3), 여러 저장소 동시 작업, 자동 커밋·push, Windows `.cmd` 실행 지원.

## 설계 결정 (PM)

| 번호 | 결정 | 근거 |
| --- | --- | --- |
| R-1 | 모델이 완료를 선언하면 검증기를 실행한다. `fail`이 하나라도 있고 재수정 횟수가 남았으면 상태를 `verifying → running`으로 되돌리고, 실패한 검증기의 근거를 가림본으로 새 메시지에 넣어 모델을 다시 호출한다. `inconclusive`는 재수정하지 않고 `needs-input`이다 | architecture 4절 8단계. 판단 불가는 모델이 고칠 수 있는 실패가 아니다 |
| R-2 | 한도 `maxRepairAttempts`(0 이상의 정수)를 둔다. task 파일과 설정 파일에서 생략하면 0이며 단계 1과 같이 `failed`로 끝난다. 횟수를 다 쓰고도 실패면 `failed`/`verifier_failed`다. 기존 한도(턴, 도구 호출, 토큰, 시간)는 반복 전체에 그대로 적용한다 | 기존 task 파일과 테스트가 그대로 동작해야 한다. 한도 없는 반복을 만들지 않는다 |
| R-3 | 같은 실패가 연속되면 멈춘다. 실패 서명은 실패한 검증기 id와 가림 근거의 해시다. 직전 재수정 뒤의 서명이 그 전과 같으면 `failed`/`repeated_failure`로 끝낸다. 허용 횟수는 `maxSameFailures`(기본 2: 같은 서명이 연속 2번 나오면 중단) | unit-test-plan EN-04. 진전 없는 반복으로 토큰을 쓰지 않는다 |
| R-4 | 실패 근거는 가린 뒤에 자른다. 상한(8192바이트)을 넘으면 앞부분과 뒷부분을 남기고 가운데를 생략 표시로 바꾼다. 토큰 중간에서 자르지 않는다 | EN-08. 테스트 출력의 끝에 요약이 있는 경우가 많다 |
| R-5 | 정책에 `protectedPaths`(작업 공간 기준 경로 접두 목록)를 둔다. 그 아래에 대한 쓰기는 `protected_path`로 거부한다. 읽기는 허용한다. 모델, task의 다른 필드, 프로젝트 문서로는 풀 수 없다 | PO-07. 테스트나 검증 설정을 고쳐 통과시키는 경로를 막는다 |
| R-6 | 쓰기 전에 변경 전 원문을 `<작업 공간>/.codaryn/runs/<runId>/snapshots/`에 저장한다. 실행 기록(journal)에는 넣지 않는다. 도구는 상태 디렉터리에 접근할 수 없다. 한 실행에서 같은 파일을 여러 번 고치면 첫 원문만 보관한다 | architecture 6절 "변경", privacy 7절. 되돌리기에 프로세스 종료 뒤에도 원문이 필요하다 |
| R-7 | 되돌리기 명령 `codaryn revert --workspace <디렉터리> --run <runId>`를 둔다. 파일마다 현재 해시가 그 실행의 마지막 `newHash`와 같을 때만 원문으로 되돌린다(새로 만든 파일은 삭제). 다르면 그 파일은 건드리지 않고 건너뛴 것으로 보고한다 | WS-06. 실행 뒤의 사용자 변경을 덮어쓰지 않는다 |
| R-8 | 스냅샷은 원문이므로 비밀이 들어 있을 수 있다. 작업 공간의 원본 파일과 같은 수준의 로컬 자료로 다루고, 삭제는 사용자가 실행 디렉터리를 지우는 방식이다. 보관 기간 자동 관리는 두지 않는다 | privacy 7절의 미정 항목. 한계로 문서에 적는다 |

## 작업

| 작업 | pane | worktree / 브랜치 | 소유 파일 | 선행 |
| --- | --- | --- | --- | --- |
| F1 계약, 엔진 반복, CLI | w1:p1 | `claude-design` / `claude/core-engine` | `src/contracts/**`, `tests/unit/contracts/**`, `docs/cli-contract.md`, `src/engine/**`, `src/cli/**`, `tests/unit/{engine,cli}/**` | 없음. 계약을 먼저 커밋한다 |
| F2 보호 경로 정책 | w1:p7 | `claude-workspace` / `claude/workspace-policy` | `src/policy/**`, `tests/unit/policy/**` | F1 계약 병합 |
| F3 스냅샷 저장과 되돌리기 | w1:p8 | `claude-store` / `claude/anthropic-provider`에서 새 브랜치 `claude/revert-store` | `src/store/**`, `tests/unit/store/**` | F1 계약 병합 |
| F4 쓰기 전 스냅샷 호출 | w1:p6 | `claude-tools` / `claude/core-tools` | `src/tools/**`, `tests/unit/tools/**` | F1 계약 병합 |
| F5 프로세스 통합 검증 | w1:p4 | `claude-operations` / `claude/cli-verification` | `tests/integration/**`, `tests/support/**`, `tests/fixtures/**` | F1 계약 병합 후 작성, 전체 병합 후 실행 |
| F6 교차 검토 | w1:p5 | 읽기 전용 | 없음(보고서만) | F1~F4 병합 |

- 유닛 P0: EN-04, EN-08, PO-07, WS-06과 반복의 상태 전이, 한도 소진, `inconclusive` 비재수정을 구현과 같은 커밋에 넣는다.
- 통합: 실패 → 재수정 → 통과, 재수정 한도 소진, 같은 실패 반복 중단, 보호 경로 쓰기 거부, 되돌리기(원문 바이트 복원, 사용자 변경 보존, 새 파일 삭제), 실패 근거에 가짜 비밀 원문이 없음, 스냅샷이 journal과 모델 요청에 없음. 가짜 서버로도 한 사례를 돌린다.
- 커밋 작성자, trailer 금지, 병합 전 검토(`scripts/review-branch.mjs`), 비밀 검사 훅은 이전과 같다.

## 완료 기준

1. 키 없이 타입 검사, 유닛, 통합 전체가 통과한다. 기존 테스트를 약화하지 않는다.
2. 모의 모델로 실패 → 재수정 → 통과와 한도 초과 중단이 각각 재현된다(roadmap 단계 2 오프라인 기준).
3. 보고서가 "지정한 검증 통과"라고만 말하고, 실제 API 미실행을 적는다.
4. 연습 과제 묶음을 실제 API로 돌리는 검증은 이 지시에 없다. 사용자가 키를 설정한 뒤 별도로 연다.

## 투입 준비 병행 작업 (2026-11-12 추가)

사용자가 "세션들 최대한 활용해서 진행해줘 투입 가능하게"라고 지시했다. 단계 2와 소유 파일이 겹치지 않는 작업을 같은 시간에 진행한다.

| 작업 | pane | worktree / 브랜치 | 소유 파일 | 내용 |
| --- | --- | --- | --- | --- |
| G1 Windows `.cmd`/`.bat` 실행 | w1:p6 | `claude-tools` / `claude/core-tools` | `src/tools/**`, `tests/unit/tools/**` | PATH와 PATHEXT로 실행 파일을 찾는다. `.cmd`/`.bat`은 `cmd.exe /d /s /c`로 실행하되 경로나 인자에 cmd 메타문자가 있으면 실행하지 않는다. 작업 공간 안의 스크립트로 풀리면 거부한다. G1 뒤에 F4를 이어서 한다 |
| G2 사용 문서와 예시 | w1:p5 | `claude-quality` / `claude/security-core` | `README.md`, `docs/usage.md`, `examples/**` | 설치, 키와 모델 설정, 설정 파일, 실행 예, 결과 읽는 법, 투입 전 점검표, 알려진 한계. 예시 파일은 실제 CLI 검증을 통과해야 한다 |
| H1 교차 검토: Anthropic 제공자 | w1:p7 | 읽기 전용 | 보고서만 | 키가 헤더 밖으로 나가는 경로, 리디렉션, 재시도 상한, 형식이 깨진 응답. 끝나면 F2를 한다 |
| H2 교차 검토: CLI 설정 처리 | w1:p8 | 읽기 전용 | 보고서만 | 키 거부 우회, 경로 처리, task로 권한을 넓히는 경로, 한도 병합. 끝나면 F3을 한다 |

- F6(단계 2 교차 검토)은 F1~F4 병합 뒤 손이 비는 세션에 배정한다. 구현자가 자기 모듈을 검토하지 않게 한다.
- 투입 조건: (1) 사용자가 `tests/live` 실제 호출 점검을 직접 실행해 통과, (2) 단계 2 병합과 통합 통과, (3) G1 병합, (4) H1·H2에서 재현된 결함 수정. PM과 작업자는 실제 API를 호출하지 않는다.

## 교차 검토 H1·H2 결함 수정 (2026-11-12 추가)

검토 원문은 `docs/reviews/2026-11-12-cross-review-anthropic-provider.md`(H1)와 `docs/reviews/2026-11-12-cross-review-cli-config.md`(H2)다. 실제 키를 넣기 전에 고친다.

| 번호 | 결정 | 대상 결함 |
| --- | --- | --- |
| S-1 | env 파일, 설정 파일, task 파일, 대본 파일의 실경로가 작업 공간 실경로 안에 있으면 실행 전에 거부한다. 모델이 다음 실행의 API 주소, 정책, 검증기, 한도를 바꾸는 경로를 없앤다. 문서 예시의 `.env`는 작업 공간 밖에 두는 것으로 고친다 | H2-1(높음), H2-4 |
| S-2 | `ANTHROPIC_API_KEY`가 환경에 있으면 제공자와 관계없이 비밀로 등록한다 | H2-2 |
| S-3 | `secretEnv` 이름은 `^[A-Za-z_][A-Za-z0-9_]*$`만 허용한다. 오류 메시지에는 위치만 적고 항목 내용을 적지 않는다 | H2-3 |
| S-4 | `--env-file`이 새로 설정한 변수의 값은 비밀로 등록한다. `CODARYN_MODEL`, `CODARYN_CONFIG`, `CODARYN_API_BASE_URL`과 8자 미만 값은 제외한다 | H2-4 |
| S-5 | `workspaceRoot`, `scriptPath`, `--task`, `--config`, `--env-file`, `CODARYN_CONFIG`의 UNC와 장치 경로는 파일 시스템 접근 전에 거부한다 | H2-5 |
| S-6 | 키 검사는 재귀 대신 반복으로 하고 깊이 64를 넘으면 `invalid_task` 또는 `invalid_config`다. `JSON.parse` 전 원문에도 키 모양과 현재 키 검사를 적용한다. 위치 문자열에는 알려진 필드 이름만 적는다. CLI 최상위에서 예외를 잡아 `internal_error` JSON을 출력한다 | H2-6, H2-10, H2-11 |
| S-7 | 설정 파일의 한도는 상한이다. task 값은 설정 값 이하여야 하고 넘으면 `invalid_task`다. anthropic 제공자에서는 `maxTotalTokens: null`을 허용하지 않는다. 코드의 절대 상한: 턴 1000, 도구 호출 5000, 총 토큰 50,000,000, 실행 시간 24시간. 모든 시간 값은 2,147,483,647ms 이하다 | H2-7, H2-8 |
| S-8 | `--goal`에도 키 모양과 현재 키 검사를 적용해 거부한다. goal이 전송·기록된다는 점을 문서에 적는다 | H2-9 |
| S-9 | `apiBaseUrl`은 끝의 단독 `?`나 `#`도 거부한다 | H1-4 |
| S-10 | 제공자는 응답 본문을 상한까지만 읽는다(성공 응답 8MB, 오류 응답 4096바이트). 넘으면 `malformed_response` 또는 `api_error`다 | H1-1 |
| S-11 | 키는 출력 가능한 ASCII만 허용하고 아니면 전송 전에 거부한다. 전송 계층의 형식 오류(`TypeError`)는 재시도하지 않고, 그 오류 문구를 메시지에 옮기지 않는다 | H1-2 |
| S-12 | 오류 본문을 메시지에 옮길 때 제어 문자와 공백을 먼저 정리한 뒤 키 조각을 지운다 | H1-3 |

고치지 않고 기록만 하는 것: thinking 블록을 다음 요청에 보내지 않는 점(H1-6)과 시간 초과 뒤 POST 재시도(H1-7)는 실제 호출 점검에서 확인한다. 키 필드 이름 목록의 빈틈(H2-12)은 닫힌 스키마가 다른 오류로 막는다.

| 작업 | pane | worktree / 브랜치 | 소유 파일 |
| --- | --- | --- | --- |
| S-A CLI 보안 검사 모듈(S-1, S-3~S-9의 순수 함수와 유닛) | w1:p7 | `claude-workspace` / `claude/workspace-policy` | `src/cli/security/**`, `tests/unit/cli/security/**` (신규 디렉터리) |
| S-B 제공자 수정(S-10~S-12) | w1:p5 | `claude-quality` / `claude/security-core` | `src/model/anthropic/**`, `tests/unit/model/anthropic/**` (p8에서 이관) |
| S-C CLI 연결(S-2 포함)과 문서 | w1:p1 | `claude-design` / `claude/core-engine` | `src/cli/**`(security 제외), `docs/cli-contract.md` — F1 뒤에 한다 |
| S-D 통합 회귀 | w1:p4 | `claude-operations` / `claude/cli-verification` | `tests/integration/**` — F5와 함께 |

## 단계 2 교차 검토(F6) 결함 수정 (2026-11-12 추가)

검토 원문은 `docs/reviews/2026-11-12-f6-review-*.md` 다섯 건이다. 높음 1건, 중간 9건이 재현됐다. 기준 브랜치는 p1의 연결 커밋 `3f3756d`(`claude/core-engine`)다.

| 번호 | 결정 | 대상 결함 | 담당 |
| --- | --- | --- | --- |
| T-1 | 조립에서 명령 실행기를 자식 환경 값 검사(`envValueFreeOfSecrets`)와 작업 공간 루트를 넣어 만들고, 도구와 검증기가 같은 실행기를 쓴다. 지금은 옵션 없이 만들어 `.cmd` 실행이 항상 거부되고 환경 값 검사가 꺼져 있다 | tools F6-1(높음) | p1 |
| T-2 | 자식이 끝나면 종료 코드를 그때 확정하고, 파이프는 짧은 유예(500ms) 뒤 닫는다. 트리 종료는 자식이 살아 있을 때만 한다(끝난 PID에 `taskkill`을 쓰지 않는다). 분리된 자손이 남을 수 있다는 점은 문서에 적는다 | tools F6-3 | p6 |
| T-3 | 모델이 주는 `run_command.timeoutMs`는 `MAX_COMMAND_TIMEOUT_MS`(600000) 이하만 받는다. 넘으면 `invalid_args`다 | tools F6-6, wiring 3 | p5 |
| T-4 | 실행 파일이 작업 공간 안으로 풀리면 확장자와 관계없이 실행하지 않는다 | tools F6-7 | p6 |
| T-5 | 실패 서명은 검증기 id, 결과, 그리고 숫자를 정규화한 가림 근거로 만든다(연속한 숫자와 소수는 한 기호로 바꾼다). 실행 시간처럼 매번 바뀌는 숫자 때문에 같은 실패 감지가 무력화되지 않게 한다 | engine 1 | p5 |
| T-6 | 검증기는 근거를 원문 상태에서 자르지 않는다. 실행기가 준 출력을 그대로 넘기고 잘렸는지 표시한다(`evidenceTruncated`). 엔진이 가린 뒤에 자르며, 잘린 출력이면 끝의 여유 구간을 버린 다음 자른다. 기록용 근거 상한은 `MAX_EVIDENCE_BYTES`(8192)다 | engine 2 | p8(검증기), p5(엔진), p1(계약) |
| T-7 | 재수정을 켜면 검증기 명령이 모델이 쓴 코드를 실행하고 그 출력이 모델에 돌아간다. 코드는 바꾸지 않고 알려진 한계로 문서에 적는다. OS 격리가 없는 동안의 한계다 | engine 3 | p1(문서) |
| T-8 | 실행 시간 한도가 검증 도중 끝나면 `budget-exhausted`/`max_duration`이다 | engine 4 | p5 |
| T-9 | 죽은 잠금 회수를 원자적으로 한다(고유 이름으로 옮긴 뒤 내용 확인). `EPERM`과 `EBUSY`는 `workspace_locked`로 처리한다 | store 1 | p8 |
| T-10 | 스냅샷 색인에는 있는데 journal에 `file_changed`가 없는 경로는 되돌리기에서 `skipped`(`missing_record`)로 보고해 `partial`이 되게 한다. journal의 잘린 마지막 줄은 무시하고 계속한다 | store 2, 4 | p8, p1(계약) |
| T-11 | 스냅샷은 파일 도구로는 닿을 수 없지만 실행된 명령은 읽을 수 있다. 계약 주석과 문서를 그렇게 고치고, 쓰고 난 실행 디렉터리를 지우라고 안내한다 | store 3 | p1(문서) |
| T-12 | `revert`의 `--workspace`에도 UNC와 장치 경로 검사를 적용한다. `--cancel-file`이 작업 공간 안이면 거부한다 | wiring 1, 4 | p1 |
| T-13 | `protectedPaths` 형식 검사를 정책 모듈의 함수 하나로 통일해 CLI와 게이트가 같은 판정을 한다. 항목이 링크이면 실경로도 보호 목록에 넣고, 실경로가 작업 공간 밖이면 형식 오류다 | wiring 2, policy M1, L4 | p7, p1(연결) |
| T-14 | 키 검사: 이스케이프한 키를 중복 필드에 둔 경우를 잡고, 오류 위치에는 알려진 필드 이름만 적는다. 작업 공간 루트의 대체 데이터 스트림은 작업 공간 안으로 판정한다. `maxOutputTokens`에 절대 상한을 둔다 | policy L1~L3, wiring 5 | p7, p1(연결) |
| T-15 | env 파일 옵션 이름을 `--env-file`에서 `--vars-file`로 바꾼다. Node 26이 스크립트 이름 뒤의 `--env-file`도 스스로 확인해, 없는 파일이면 CLI보다 먼저 종료 9로 끝나고 UNC 경로면 CLI의 검사보다 먼저 접근하기 때문이다. `--env-file`은 받지 않는다 | p4 통합 검증의 결함 후보 3 | p1, p5(문서), p4(테스트) |

고치지 않고 한계로 기록하는 것: 여유 구간(4096바이트)보다 긴 비밀 변형의 경계 노출, 상태 디렉터리를 조작한 경우의 되돌리기, 삭제 직전의 짧은 경쟁, 서로 다른 실패를 번갈아 내는 경우.

순서: p1이 계약 추가분을 먼저 커밋한다 → p5(엔진), p6(도구), p7(정책과 보안 모듈), p8(검증기와 저장소)이 `claude/core-engine`을 병합해 병렬로 고친다 → p1이 연결한다 → p4의 통합 테스트와 함께 병합한다.
