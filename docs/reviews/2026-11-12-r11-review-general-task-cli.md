# R-11 교차 검토 보고서: 범용 작업 CLI(G-F) — plan, apply, review, 워크플로 해석, 동의 입력, changes

## 0. 이해 확인과 대상

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 읽기 전용이다. 저장소 파일 수정·커밋은 없다(main 병합 커밋 `332af9b` 외).
- **검토 대상(고정)**: `claude/workspace-policy` = `61bde82`(`.codaryn/r11-pinned.txt`)
  - G-F 주요 커밋
    - `72f9e56` 내장 워크플로와 `resolveWorkflow`
    - `31e8cb9` 워크플로 해석
    - `383dead` plan·apply·review
    - `9abdf8b` changes 연결과 도움말
    - `a1fee2c`, `fa8ab29`, `84a661c` DR-21 동의와 어댑터 승인
    - `79beabd`, `ffa0fca` DR-25 되돌리기 동의
    - `61bde82` doctor Q5
  - 표본으로 확인한 작성자는 모두 `gangdonggil <gangdonggilstudy@gmail.com>`이고 trailer가 없다.
- 기준: `docs/design/general-tasks.md` 4·5.3·6절, GT-D1~D14, DR-1~DR-27(`docs/work-orders/phase-4-5-design.md`)
- **보조 빌드**
  - 실행기의 DR-21 판정(`claude/gui-design`의 `1216a43`, `847dcf4`)이 이 브랜치에 없다.
  - 그래서 동의 흐름은 `61bde82` + `claude/gui-design`의 병합 트리 `61aea8c`(충돌 없음)로 확인했다.
  - `git merge-tree --write-tree`가 공용 객체 저장소에 참조 없는 트리 객체를 남겼다. 브랜치·인덱스·작업 트리 변경은 없다.
  - 비교용으로 `main`(`f6a3dbc` 이후 병합분)도 빌드했다.
- 실험
  - 모든 재현은 **실제 CLI 프로세스**로 했다(`.codaryn/r11/cli11.mjs`, `cli11b.mjs`, `cli11c.mjs`).
  - 가짜 파일, scripted 모델, 가짜 비밀 `R11_FAKE_SECRET`(키 모양 아님)을 썼다. 계획의 이동 대상 폴더 이름에 비밀 값이 들어가게 했다.
  - 설정 파일은 작업 공간 밖에 두었고, APPDATA는 빈 폴더로 돌렸다.
  - 하드 링크 없는 경우는 R-9b·R-9c의 preload로 흉내 냈다. 실제 API·네트워크·키 파일은 쓰지 않았다.
- 빌드와 시험(`61bde82`)
  - typecheck 오류 2건(I-1)
  - 유닛: 1364건 중 1349 통과, 12 실패, 3 건너뜀
  - 통합: 385건 중 374 통과, 11 실패
  - `main`: 유닛 850건 중 849 통과, 0 실패. 통합 385건 중 382 통과, 3 실패
  - 이 브랜치에서만 실패하는 시험은 I-1·I-2에 정리했다.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 1 (M-1) |
| 낮음 | 3 (L-1~L-3) |
| 정보 | 8 (I-1~I-8) |

**PM 중점 항목**

| 항목 | 결과(실제 CLI) |
| --- | --- |
| 사람이 승인하지 않은 계획이 적용되는 경로 | 찾지 못함(2절 A). 다음 경우 모두 파일이 그대로였다. 다른 계획의 다이제스트·다른 작업 공간의 실행 id·plan 실행이 아닌 실행은 `plan_not_approved`, `run_not_found`, `run_not_plan`이었고, 이미 적용된 계획은 `plan_already_applied`, 그 밖의 잘못된 인자는 `invalid_arguments`였다 |
| 동의를 task·설정·환경 변수·모델이 줄 수 있는 경로 | 없음(2절 B). 동의는 `--allow-unsafe-move`, 터미널 답, 어댑터 요청뿐이다. `apply_started.unsafeMoveConsent`와 되돌리기 기록에 통로가 남는다 |
| apply가 실행 id를 필수로 받는가 | 예. `--run`이 없으면 `invalid_arguments`, `latest`도 거부한다 |
| plan 보기가 같은 비밀로 다시 가리는가 | 계획 실행과 같은 task로 보면 가린다. **다른 형식(간편 형식이나 비밀을 등록하지 않는 task)으로 보면 그대로 드러나고, 그 형식으로 apply하면 적용 기록에 평문으로 남는다(M-1)** |
| 작업 공간 안의 파일이 워크플로 정의나 상한을 바꿀 수 있는가 | 없음. `--config`, `CODARYN_CONFIG`, 기본 위치(APPDATA)가 작업 공간 안이면 `invalid_config`, task 파일이 안이면 `invalid_task`다. 작업 공간 안의 설정 모양 파일은 읽지 않는다. task는 워크플로를 정의할 수 없다(`invalid_task`) |
| 파일 정리 워크플로에서 명령이 금지되는가 | 모델 쪽은 금지된다: task 정책의 명령, `tools`의 `run_command`, 간편 형식·프로필로 들어온 명령 규칙은 모두 거부되고, 사용자 정의의 `allowCommands:false`는 `run_command`를 빼서 호출이 `unknown_tool`이 된다. task의 `command` 검증기는 적용 때 돈다(L-3) |
| 기존 task의 동작 변화 | `workflowRef`가 없는 task는 예전과 같다(도구 4개, `run_command`는 정책 판정). 데모 task의 실제 출력은 내 브랜치의 사용 안내 3절 블록 전부와 같다. 브랜치에서만 실패하는 시험은 옛 기대값이다(I-2) |

## 2. 재현 결과

### A. 승인(`cli11.mjs` A, `cli11b.mjs` A15)

| 경우 | 결과 | 파일 |
| --- | --- | --- |
| A0 계획 실행 | `plan_pending`. stdout과 기록은 가려짐, plan.json은 실제 경로(DR-5) | 그대로 |
| A1 `--digest` 없음(터미널 아님) | `plan_not_approved` | 그대로 |
| A2~A5 11자, 대문자, 65자, 빈 값 | `invalid_arguments` | 그대로 |
| A6 다른 계획의 다이제스트 앞 12자 | `plan_not_approved` | 그대로 |
| A7 `--run` 없음, A8 `--run latest` | `invalid_arguments` | 그대로 |
| A9 다른 작업 공간의 실행 id | `run_not_found` | 그대로 |
| A10 `--digest` 두 번(두 번째가 맞음) | `invalid_arguments` | 그대로 |
| A11 실행 뒤 plan.json과 result.json을 함께 바꿈(허용 명령이 할 수 있는 일) | `plan` 보기는 새 계획과 새 다이제스트를 보인다. 원래 승인한 다이제스트로는 `plan_not_approved`. 새 다이제스트로는 정책이 보호 경로를 거부해 `plan_stale` | 보호 파일 그대로 |
| A12 64자 전체 | `done/verified`. stdout·stderr·적용 기록에 비밀 없음 | 적용됨 |
| A13 같은 계획 다시 | `plan_already_applied` | 변화 없음 |
| A14 plan 실행이 아닌 실행 | `run_not_plan` | — |
| A15 `workflowRef` 없는 task로 apply | `run_not_plan` | — |
| A16 organize task에 `plan: "none"` | `invalid_task`(plan_weakened) | — |

### B. 동의(조합 빌드, 하드 링크 없음)

| 경우 | 결과 | 기록된 동의 |
| --- | --- | --- |
| B1 동의 없음 | `consent_required`, 이동 없음 | 없음 |
| B2 `--allow-unsafe-move` | `done/verified` | `cli-flag` |
| B3 동의처럼 보이는 환경 변수 3개 | `consent_required` | 없음 |
| B4~B6 task의 `allowUnsafeMove`, `unsafeMoveConsent`, `policy.allowUnsafeMove` | task 파일 점검 실패(알 수 없는 필드) | — |
| B7~B9 설정, 프로필, 사용자 워크플로의 동의 필드 | `invalid_config` | — |
| B10 모델의 `propose_plan`에 동의 필드 | 계획이 저장되지 않음(`model_error`) | — |
| B11 되돌리기(DR-25) | `--dry-run`과 함께면 `invalid_arguments`. 환경 변수만 있으면 `unsafe_move` 두 건(partial). `--allow-unsafe-move`이면 `:unsafe`로 되돌리고 되돌리기 기록에 `cli-flag` | — |

### C. 가림

| 경우 | 결과 |
| --- | --- |
| C1·C2 `plan --task`(계획 실행의 task), 글과 `--json` | `[[CODARYN_SECRET:…]]/a.jpg`. 비밀 없음 |
| C3' `plan --workspace --config <비밀 없는 설정>` | **비밀 값이 그대로 보인다** |
| C4' 같은 형식 `--json` | **비밀 값 포함** |
| C5' 같은 형식 `apply --workflow organize` | `done/verified`. **stdout, stderr, 적용 실행의 journal.jsonl, result.json에 비밀 값.** 계획 실행의 기록은 가려진 채다 |
| C6 그 적용의 `revert --dry-run` | **stdout에 비밀 값**(적용 기록의 경로를 그대로 보임) |
| C3·C4·C5(설정 없음) | `invalid_config`: 간편 형식은 설정의 한도 전부를 요구한다(L-2) |

### D·E는 1절 표와 같다. 한도 관련 세부는 L-1, 명령 검증기는 L-3이다.

## 3. 중간

### M-1 계획 실행과 다른 비밀로 `plan`·`apply`를 하면 계획 실행이 가린 값이 보이고 적용 기록에 평문으로 남는다

- 위치
  - `src/cli/plan-commands.ts:241-249`(`loadShown`): 지금 형식의 비밀로만 가린다.
  - `:356`: 적용의 privacy도 그 비밀이다.
  - `run`과 같은 task 형식(`--workspace`, `--profile`, `--workflow` 포함)을 받는다(`APPLY_USAGE`).
- 결정
  - DR-17: "계획 보기도 apply처럼 task 형식을 받아 **같은 비밀로** 다시 가린다"
  - DR-5: 적용 때의 정책·검증기는 그때 설정에서 읽는다
  - 같은 비밀인지 확인하는 장치는 없다.
- 재현(`cli11b.mjs` C3'~C6)
  1. 비밀을 등록한 task로 계획 실행을 한다. 기록은 가려져 있다.
  2. 한도만 있는 설정으로 `plan --workspace`를 하면 이동 대상 `zz-r11-fake-secret-value-zz/a.jpg`가 그대로 보인다(`--json`도).
  3. 같은 형식으로 `apply --workflow organize`를 하면 적용 실행의 stdout·stderr·`journal.jsonl`·`result.json`에 비밀 값이 남는다.
  4. 그 적용의 `revert --dry-run`도 stdout에 보인다.
- 영향
  - 계획 실행이 보호한 값이 상태 디렉터리의 적용 기록에 평문으로 영구히 남는다. 어댑터(GUI)가 stdout을 기록하거나 보여 주면 거기에도 남는다.
  - 사용 안내의 apply 예시가 task 형식이 아니면 쉽게 생긴다. 선행 조건은 비밀 값이 경로에 들어 있는 것(예: 거래처 이름 폴더)이다.
  - `changes`도 "masked with the current secrets"로 같은 구조다. 오프라인에서는 간편 형식에 모델 제공자 설정이 필요해 재현하지 못했다 [추정].
- 권고: 계획 실행이 가린 것을 지금 형식이 가리지 못하면 보이거나 적용하기 전에 멈춘다(`secrets_differ` 같은 오류).
  - 방법 1: 계획 실행 기록에 남은 가린 행동 경로(`propose_plan` 인자의 가림본)에 토큰이 있는데, 지금 비밀로 plan.json을 가린 결과의 같은 자리에 토큰이 없으면 거부한다. 토큰은 실행마다 무작위라 값끼리 비교할 수는 없지만, 자리의 유무는 비교할 수 있다.
  - 방법 2: 계획 실행 결과에 등록한 비밀 **이름**(값이 아님)을 남기고, plan·apply·changes가 그 이름을 모두 등록했을 때만 진행한다.
  - 사용 안내의 apply·plan 예시는 계획 실행과 같은 task 형식으로 쓴다(문서 담당인 내가 할 일).

## 4. 낮음

### L-1 워크플로 정의의 한도가 설정이 없을 때만 상한이 되고, 오류는 설정 파일 탓으로 나온다

- 위치: `src/cli/run.ts:237`(`underDefinition`): `{ ...definition.limits, ...base.limits }`. 설정에 같은 키가 있으면 정의의 값이 사라진다.
- 재현
  - D7: organize(정의 `maxModelTurns` 8)에서 task가 20을 요청하고 설정이 없으면 `invalid_task`, "must not exceed **the config file's** limits.maxModelTurns"라고 나온다. 설정 파일은 없었다.
  - D9: 설정이 50을 허용하면 같은 task가 받아들여져 `plan_pending`이다.
- 설계 4.1은 정의의 `limits`를 "기본값"이라 하고 상한 규칙은 S-7을 따른다고 한다.
- 지금은 같은 task가 설정의 유무에 따라 상한이 달라지고, 사람은 없는 설정 파일을 고치라는 안내를 받는다.
- 권고: 정의의 한도를 기본값으로만 쓰거나, 상한이면 `min(정의, 설정)`으로 하고 오류에 "workflow definition"을 적는다.

### L-2 간편 형식의 plan·apply·changes가 모델을 쓰지 않는데도 모델용 설정을 요구한다

- `plan --workspace`: 설정이 없으면 `invalid_config` "limits.maxModelTurns is not set"
- `changes --workspace`: 한도 있는 설정에서도 `provider_not_configured`(종료 7)
- 보기 명령이 모델 턴 한도나 키를 요구하는 이유가 안내에 없다. 사람은 무엇을 고쳐야 할지 알기 어렵다.
- 권고: 모델을 쓰지 않는 명령은 그 검사를 건너뛰거나, 오류에 "the quick form reads the run settings from the config"를 적는다.

### L-3 organize의 "명령 금지"가 task의 `command` 검증기에는 미치지 않는다

- 재현(E6b): organize task에 `command` 검증기(작업 공간에 파일을 쓰는 `node -e`)를 두면 apply가 그것을 실행한다. 파일이 생기고 결과는 `done/verified`다.
- 엔진은 inventory 검증 뒤에 task 검증기를 돌린다. 그래서 검증기가 바꾼 파일은 inventory가 보지 못한 채 "verified"로 끝난다.
- GT-D10의 상한은 정책의 명령 규칙이고, 검증기는 사람이 둔 것이다(설계 4.3 "command 검증기는 지금처럼 남는다"). 그래서 결함이라기보다 경계가 문서에 없는 문제다.
- 권고: 둘 중 하나를 정한다.
  - `allowCommands:false`인 워크플로에서 `command` 검증기를 거부한다.
  - 사용 안내와 doctor에서 "organize의 명령 금지는 모델 쪽이며, command 검증기는 적용 뒤 실행된다"고 알린다.

## 5. 정보

- **I-1** typecheck 오류 2건과 i18n 유닛 9건 실패
  - 계약이 문구 id `doctor.commands.extra_args_with_plan`(`e6a4289`), `doctor.lock.reclaim_left`(`0bd6f31`)를 더했다.
  - `en.ts`·`ko.ts`에 문구가 아직 없다. 고정 직전(13:27~13:29) 커밋이라 진행 중으로 보인다.
- **I-2** 이 브랜치에서만 실패하는 옛 기대값
  - 통합 6건
    - `s01` 3건: 오류 때 stderr가 빈 줄이기를 기대한다. 지금은 사람용 오류 줄이 나온다.
    - `p04` 1건, `n01` 1건: 두 번째 되돌리기를 `partial`로 기대한다. N-22로 `already_reverted`다.
    - `n01` 1건: 진행 줄이 브랜치의 옛 `docs/usage.md`와 다르다. 내 문서 커밋(`2e98789`, `32fcbde`)의 3절과는 블록 전부가 같음을 실제로 확인했다.
  - 유닛 3건: app의 doctor 점검 수 12→14, `n7-runs`의 `already_reverted`, 도구 이름 표시
  - 계획 기능의 회귀가 아니라 기대값 갱신이 필요하다.
- **I-3** 실행기의 DR-21 판정이 `claude/gui-design`에만 있다(R-9c C-3와 같은 통합 조건). 이 브랜치 단독에서는 하드 링크 없는 볼륨의 첫 apply가 동의 단계 없이 계획을 소모한다.
- **I-4** 터미널 승인(`[y/N]`, 기본값 거절)은 TTY가 없어 실행하지 못했다. 코드로 확인했다.
  - stdin과 stderr가 모두 터미널일 때만 묻는다(`src/cli/main.ts:187` 등).
  - 계획은 다시 가려 보이고, 제어·줄 구분·방향 바꿈 문자는 바꿔서 보인다(`text-safety.ts:13-19`).
- **I-5** A11: `.codaryn`을 쓸 수 있는 허용 명령은 plan.json과 result.json을 함께 바꿔 `plan` 보기를 바꿀 수 있다.
  - 계획 실행 결과의 다이제스트로 승인하면 막힌다.
  - 사람이 `plan` 보기만 보고 승인하는 흐름이면 바뀐 계획을 승인하게 된다. 정책은 여전히 판정한다.
  - 계획 실행의 다이제스트를 사용 안내의 승인 기준으로 적는 것이 좋다(문서 담당).
- **I-6** `review`는 설계대로 동작한다.
  - 비밀이 든 메모는 가려 저장한다.
  - 다시 하면 `replaced: true`, 끝난 실행은 `run_not_awaiting_review`, `--accept --reject`는 `invalid_arguments`다.
  - result.json은 그대로다.
  - `--run latest`를 받으므로 사람이 본 실행과 다른 최신 실행을 판정할 수 있다. 고른 실행은 stderr에 나온다.
- **I-7** 기존 task의 `workflow` 이름표(예: `document`)는 정의를 고르지 않는다(GT-D2).
  - `"workflow": "organize"`만 쓰고 `workflowRef`가 없으면 예전 방식이고 apply는 `run_not_plan`이다(R-9b I-3).
  - 사용 안내에 계획 기능을 쓸 때 반영한다.
- **I-8** 계획 기능의 사람용 진행 줄(R-9b I-2의 "(unknown tool)")은 이번 빌드에서 다시 보지 않았다.

## 6. PM 판단 필요

- **P-1(M-1)**: 비밀이 다른 형식의 `plan`·`apply`·`changes`를 막을 방법(계획 실행 기록의 가림 자리 비교, 또는 비밀 이름 기록)을 정해 CLI 담당에 배정할지
  - 그 전까지 사용 안내에 "계획 실행과 같은 task 형식으로 plan·apply한다"를 내가 적을지
- **P-2(L-1)**: 워크플로 정의 한도의 뜻(기본값인지 상한인지)
- **P-3(L-3)**: `allowCommands:false`에서 `command` 검증기를 거부할지, 문서로 알릴지
- **P-4(I-3)**: `claude/gui-design`의 실행기 DR-21 커밋을 이 브랜치와 같은 묶음으로 병합할지(R-9c P-1과 같음)

사용자에게 물을 질문은 없다.

## 7. 실행한 것

- 읽기
  - `src/cli/plan-commands.ts` 전체, `src/workflows/index.ts`, `src/cli/run.ts`의 워크플로 해석과 입력 위치 검사, `src/cli/args.ts`의 apply·revert 인자, `src/cli/changes.ts`, `src/engine/apply.ts`의 동의 처리, `src/cli/text-safety.ts`, 프라이버시 토큰 생성
  - 설계 4·5.3·6절과 결정 표
- 빌드: `61bde82`, 조합 `61aea8c`, `main`
- 시험: 세 빌드 중 둘(`61bde82`, `main`)의 전체 유닛·통합. 실패 이름을 비교했다.
- 실험: 실제 CLI 프로세스로 A1~A16, B1~B11, C1~C7, D1~D10, E1~E6b, `changes`와 `review` 확인, 데모 task 출력과 사용 안내 3절 비교
