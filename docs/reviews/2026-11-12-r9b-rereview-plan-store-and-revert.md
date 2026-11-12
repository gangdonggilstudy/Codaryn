# R-9b 재검토 보고서: DR-24 (a)~(f) 수정 확인과 새 문제

## 0. 이해 확인과 대상

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 읽기 전용이다.
- worktree: `D:\project\Codaryn\.worktrees\claude-store`
  - 저장소 파일 변경은 이번 지시 (1)의 문서 커밋 `32fcbde`뿐이다(8절).
- **검토 대상(고정)**: `claude/core-tools` = `b5bc346`(`.codaryn/r9b-pinned.txt`)
  - 검토 중 브랜치가 `19fdc9e`에서 `b5bc346`으로 움직였다. 그 시점의 끝을 고정했다.
  - 수정 커밋
    - `9246836` fix(store) DR-24 (a)~(f)
    - `d32aae2` contracts DR-24·DR-21
    - `c378759` engine 동의 경로(DR-21)
    - `d42e9e5`, `565ac15` 적용 행동 시작 기록(R-9 I-4)
    - `4ee8f09` contracts(실행 목록의 적용 실행)
  - 모두 작성자 `gangdonggil <gangdonggilstudy@gmail.com>`, trailer 없음
- 실험
  - `git archive` 빌드 사본 `.codaryn/r9b/ct2`와 그 아래 임시 작업 공간에서만 했다.
  - 가짜 파일과 scripted 모델만 썼고 실제 API·네트워크·키 파일은 쓰지 않았다. APPDATA는 scratchpad의 빈 폴더로 돌렸다.
  - 이 컴퓨터에는 NTFS 볼륨만 있다. 하드 링크가 없는 경우는 같은 프로세스 안에서 `fs/promises.link`를 EPERM으로 바꿔(`module.syncBuiltinESMExports`) 흉내 냈다.
    - 바꾼 `link`가 store 모듈까지 닿는 것은 0번 탐침으로 먼저 확인했다.
    - CLI 프로세스에는 `--import nolink.mjs`로 같은 것을 적용했다.
- 빌드 사본 상태
  - typecheck 오류 6건(I-1). G-E·DR-24 파일 밖이다.
  - 유닛
    - store, executor, propose_plan, plan-cancel: 131건 중 129 통과, 2 건너뜀(파일 링크 권한)
    - engine `g-apply`, `g-real-combination`, `g-workflow-engine`: 65/65 통과
  - 계획·적용의 통합 시험은 아직 없다(`tests/integration`에 해당 파일 없음).

## 1. 요약

| 구분 | 건수 |
| --- | --- |
| R-9 재현 입력의 막힘 | **6건 중 6건**(M-1~M-3, L-1~L-3 = DR-24 (a)~(f)) |
| 새 발견 | 5건: 중간 2(N-1, N-2), 낮음 3(N-3~N-5) |
| 정보 | 6건(I-1~I-6) |

**PM이 짚은 점**

| 항목 | 결과 |
| --- | --- |
| 정상 되돌리기 | 깨지지 않음 |
| 정상 적용 | 깨지지 않음 |
| 하드 링크 없는 경우의 배타 생성 대체가 두 번 적용을 막는가 | 함수 단위로는 막는다(1/16, 1/12). 다만 실제 CLI에서는 잠금이 먼저 막혀 이 경로에 닿지 못한다(N-2) |

정상 경로(실제 CLI, `e2e.mjs`)의 근거:

1. 실제 계획 실행: scripted 모델이 `inspect_files`, `propose_plan`을 호출해 `plan_pending`으로 끝나고, plan.json 다이제스트가 바이트와 같다.
2. `apply`(적용): `done/verified`
   - 기록: `apply_started` → … → `plan_item_started` → `file_moved` → `plan_item_started` → `file_discarded` → … → `run_finished`
   - 폐기 파일은 `.codaryn/discarded/<id>/1`에 있다.
3. 같은 계획을 다시 `apply`: `plan_already_applied`(종료 2), 파일 변화 없음
4. `runs`: 두 실행 모두 `checked`, 적용 실행 changes 2
5. `revert --dry-run`: 변화 없음
6. `revert`: `complete`, 두 파일이 원래 자리로 돌아오고 보관함이 비었다.
7. 다시 `revert`: 두 파일 모두 `already_reverted`

## 2. R-9 재현 입력 재실행(`.codaryn/r9b/exp9b.mjs`)

| R-9 | DR-24 | 입력 | R-9 결과 | 지금 결과 | 판정 |
| --- | --- | --- | --- | --- | --- |
| M-1 | (a) | 보관함 안 정션 `sub` → 밖 폴더, `stored: "sub/precious.doc"` | 밖 파일이 옮겨지고 지워짐 | `invalid_run_record`, 아무것도 바꾸지 않음, 밖 파일 그대로 | 막힘 |
| (보강) | (a) | 실행의 보관함 디렉터리 자체가 정션 | 확인 안 함 | 그 항목 `io_error`, 밖 파일 그대로 | 막힘 |
| M-2 | (b) | 되돌리기 중 `link` 실패(EPERM 주입) | 확인 후 rename(코드 근거) | 두 항목 모두 건너뜀, 이름 바꾸기 없음, 두 파일 제자리 | 막힘(사유 코드는 N-3) |
| M-3 | (c) | `link` 실패 상태에서 `savePlan`, `loadPlan`, `markPlanApplied` 동시 12회 | 저장 불가 [추정] | 저장됨(다이제스트=바이트), 두 번째 저장 거부, 표시 1회, 나머지 11회 `already_applied` | 막힘(함수 단위) |
| (보강) | (c) | `createExclusive` 동시 16회, EPERM 주입 | — | 1회 생성, 15회 거부, 임시 파일 0개 | 막힘 |
| (보강) | (c) | 지원 안 됨이 아닌 실패(EACCES) | — | reject, 파일 생성 없음 | 기대대로 |
| L-1 | (d) | `.codaryn./x`, `.codaryn /x`, `a.txt:hidden`, `a.txt::$DATA`, `NUL`, `con.txt`, `x/LPT1.log`, `trail./x`, `trail /x` | 기록 검증 통과 | 모두 거부. 이런 경로가 든 plan.json은 `invalid_run_record` | 막힘 |
| L-2 | (e) | `runs/<id>/snapshots`를 밖 폴더로 가는 정션으로 바꿈 | 밖 파일 내용 반환 | 원본 `unavailable: "unreadable"`, 모델 실행 되돌리기는 `io_error`, 파일 그대로 | 막힘 |
| L-3 | (f) | 기록 경로가 가린 토큰이고, plan.json을 다른 원래 경로(`victim.txt`)로 바꾼 뒤 result.json 다이제스트도 맞춤(`loadPlan`은 ok) | 바뀐 plan.json의 경로 사용 | 승인된 plan.json이면 `moved_back`, 바뀐 것이면 `missing_snapshot`. `victim.txt` 생성 없음 | 막힘 |

**잘못 거부하지 않는지(정상 경로 보존)**

- (d): 다음 정상 경로는 기록 검증과 `Workspace.resolve`가 모두 받아들인다. 어긋남이 없다.
  - `회의/메모.md`, `a b/c d.txt`, `v1.2/x.txt`, `.gitignore`, `a..b.txt`, `~tmp/x`
  - `.codaryn-notes/x`, `Codaryn/x`, `dir/.codaryn/x`, `é/ñ.txt`, `a#b/[1].txt`
- R-9의 나머지 입력은 그대로 지켜진다: P1, P2, D1, R1(정상, 미리보기 무변경, 두 번째 `already_reverted`), R2(`original_path_taken`, 덮어쓰기 없음), R3, R4.
- R1은 `apply_started.digest`가 plan.json과 같을 때와 다를 때 모두 정상 되돌리기가 됐다(다를 때는 기록의 경로를 쓴다).

## 3. 새 발견: 중간

### N-1 적용이 행동을 한 뒤 기록 전에 멈추면, 되돌리기가 그 행동을 빼고 `complete`(종료 0)라고 한다

- 계약(`src/contracts/changes.ts:198`, `d42e9e5`): `plan_item_started`만 있고 끝 기록이 없는 행동을 되돌리기가 처리한다고 정했다.
  - 해 놓은 경우: `moved_back`, `restored_from_discard`
  - 하지 않은 경우: 목록에서 뺀다.
  - 그 밖: `changed_since_run`
- 구현: 엔진은 시작 기록을 남긴다(`src/engine/apply.ts:352`). 그런데 store의 `applyRecords`(`src/store/apply-revert.ts:100`, `:128`)는 `file_moved`와 `file_discarded`만 읽고 시작 기록은 건너뛴다.
- 재현 1(실제 CLI, `e2e.mjs` I-4)
  1. 실제 `apply` 뒤 기록을 `file_discarded` 앞에서 자르고 result.json을 지운다. 폐기는 끝났지만 기록 전에 멈춘 상태다.
  2. `revert` 결과: 종료 0, `status: "complete"`, "Files reverted: 1"(사진만 되돌림).
  3. `old/b.tmp`는 `.codaryn/discarded/<id>/1`에 남고, 결과 어디에도 나오지 않는다.
- 재현 2(`exp9b.mjs` R10b): 이동을 하고 기록 전에 멈춘 경우 `revert`는 `reverted: []`, `skipped: []`를 돌려준다. 파일은 옮겨진 자리에 그대로 있다.
- 결과
  - 파일은 사라지지 않는다(보관함이나 새 자리에 있다).
  - 그러나 사람은 "다 되돌렸다"는 답을 받는다. I-4가 막으려던 상황이 그대로이고, 계약과 구현이 어긋난다.
- 권고
  - store가 계약대로 시작 기록을 읽게 한다. 재현 입력 2개를 실패하는 시험으로 먼저 넣는다.
  - 그 전까지는 시작 기록만 있는 행동을 `changed_since_run`으로 보고해 `partial`이 되게 하는 것이 최소 조치다.

### N-2 하드 링크가 없는 볼륨에서는 작업 공간 잠금이 먼저 실패해, DR-24 (c)와 DR-21의 동의 단계에 닿지 못하고 안내도 틀리다

- 위치
  - `src/store/lock.ts:309-326`(`guarded`, `tryLink`): 잠금도 하드 링크로 만든다. EPERM은 일시 오류로 보고 재시도한 뒤 포기한다.
  - `src/cli/assemble.ts:69`: 그 결과를 "an unreadable lock file"이 잡고 있다고 쓴다.
- 재현(`e2e-nolink.mjs`): CLI 프로세스 전체에서 `link`가 EPERM으로 실패하게 하고 계획 실행을 시작한다.
  - 결과: 종료 6, `workspace_locked`, "the workspace is locked by an unreadable lock file"
  - 고치는 법으로 "delete .codaryn/lock.json"을 안내하지만, 그 파일은 만들어지지도 않았다(`.codaryn`에는 `.gitignore`뿐).
- 결과
  - 그런 볼륨에서는 실행, 계획, 적용이 하나도 시작되지 않는다.
  - DR-24 (c)의 커밋 설명("so … DR-21's consent step can be reached")과 사용자 확정 DR-21("점검에서 위험을 알리고 동의를 받는다")에 실제로 닿지 못한다. 잠금은 수정 전부터 있던 코드이고 이번 수정이 만든 것은 아니다.
  - 사람은 지울 파일이 없는 안내를 받는다. 사용 안내에도 하드 링크 요구가 없다.
- [추정] 실제 FAT32·exFAT에서 Windows가 내는 오류 코드는 확인하지 못했다(NTFS만 있음).
  - libuv는 `ERROR_INVALID_FUNCTION`을 `EISDIR`로 바꾼다.
  - 그 코드가 나오면 `LINK_UNSUPPORTED`(`src/store/common.ts:65`)에 없어 (c)의 대체도, 실행기의 하드 링크 없음 판정도 지나친다.
- 권고
  - 잠금과 `createExclusive`가 하드 링크 없는 볼륨을 같은 규칙으로 알아보게 한다(예: 링크 실패 뒤 배타 생성으로 대체).
  - 안내 문구가 실제 원인(하드 링크 없음)을 말하게 한다.
  - 실제 exFAT 볼륨(USB나 관리자가 만든 VHD)에서 한 번 확인한다.

## 4. 새 발견: 낮음

### N-3 하드 링크를 만들 수 없을 때 되돌리기 사유가 계약의 `unsafe_move`가 아니라 `io_error`다

- 계약
  - `src/contracts/changes.ts:114`: "unsafe_move (DR-24 b, DR-21): … it is not moved. A revert has no consent path"
  - 같은 파일 196행: "skipped as `unsafe_move`"
- 구현: `src/store/apply-revert.ts:215`는 `"failed"`를 돌려주고, 이것이 `io_error`가 된다.
- 재현(`exp9b.mjs` R9): `b.txt:io_error`, `a.txt:io_error`. 파일은 안전하게 그대로다.
- 영향: 사람과 GUI가 "읽기·쓰기 실패"로 보게 되어, 드라이브 때문이라는 이유와 손으로 옮기라는 안내를 줄 수 없다.

### N-4 실행 목록이 적용 실행에 `kind: "apply"`와 `planRunId`를 넣지 않는다

- 계약: `src/contracts/commands.ts:313-315`(`4ee8f09`, G-A, N-C 요청)
- 구현: `src/store/runs.ts:326-335`의 항목에 두 필드가 없다.
- 재현: 실제 `runs --json`에서 적용 실행 항목에 `kind`와 `planRunId`가 없다. 사람용 표에서도 모델 실행과 구별되지 않는다.
- 같은 계약을 쓰는 `tests/unit/contracts/g-plan-contracts.test.ts:138,150`도 typecheck에서 실패한다(I-1).

### N-5 보관함 이름 규칙이 계약 상수와 따로 있다

- 계약: `DISCARDED_STORED_NAME_PATTERN_SOURCE` = 최대 6자리(`src/contracts/plan.ts:302`)와 `discardedStoredName`
- 구현: store가 자체 정규식 `STORED_INDEX`(최대 9자리, `src/store/apply-revert.ts:46`)를 쓴다. 기록의 `index`를 `apply_started.actions`나 `MAX_PLAN_ACTIONS`(1000)와 대조하지도 않는다.
- 재현(R11): `index: 1234567`, `stored: "1234567"` 기록이 `invalid_run_record` 없이 받아들여져 `changed_since_run`이 된다.
  - 계약은 "Readers accept nothing else"다.
  - 한 조각의 숫자뿐이라 밖으로 나갈 길은 없다.
- 권고: 계약 상수를 가져다 쓴다(DR-16의 "사본 대신 계약의 표"와 같은 원칙).

## 5. 정보

- **I-1** 고정 커밋의 typecheck 오류 6건
  - `src/i18n/en.ts:11`, `ko.ts:10`: 문구 누락. DR-21 동의 문구 `summary.unsafe_moves`, `progress.unsafe_move_consent` 등이다.
  - `src/i18n/params.ts:54`: `digest` 누락
  - `tests/unit/contracts/g-plan-contracts.test.ts:138,150`
  - `tests/unit/i18n/support.ts:19`
  - 빌드 산출물은 나와 시험은 돌았다. 통합 담당 확인이 필요하다.
- **I-2** 사람용 진행 줄이 새 도구 `inspect_files`와 `propose_plan`을 "(unknown tool) — allowed (?)"로 쓴다. 출력 담당에 전달할 일이다.
- **I-3** `"workflow": "organize"`만 쓰고 `workflowRef`가 없는 task는 예전 방식으로 실행된다.
  - 계획 도구가 `unknown_tool`로 거부되고 `no_verifier`로 끝난다. `apply`는 `run_not_plan`이다.
  - 조용히 다르게 동작하므로 점검(`doctor`) 안내나 문서가 필요하다. 사용 안내에 계획·적용 절을 쓸 때 반영한다.
- **I-4** 계약상 되돌리기에는 동의 경로가 없다. 그래서 하드 링크 없는 드라이브에서 DR-21 동의로 옮긴 적용은 `revert`로 되돌릴 수 없다. 동의 문구가 이 사실을 알려야 하는지는 PM 판단이다(P-2).
- **I-5** 확인하지 못한 것
  - 보관함 파일 자체가 파일 링크인 경우(R5b): 파일 링크 만들기에 권한이 필요해 재현하지 못했다.
  - 실제 FAT32·exFAT 볼륨
  - 실행기의 DR-21 동의 이동(`c378759`)의 동작: 이번 범위는 store다.
- **I-6** R-9 R6(`.codaryn./…`)의 사유가 `changed_since_run`에서 `missing_snapshot`으로 바뀌었다. 상태 디렉터리에 쓰지 않는다. 문제 없다.

## 6. PM 판단 필요

- **P-1(N-1)**: 시작 기록 처리(계약대로)를 이번 DR-24 후속으로 store에 배정할지
- **P-2(N-2, N-3, I-4)**: 하드 링크 없는 볼륨에 대해
  - 잠금 대체를 넣을지
  - 안내 문구를 고칠지
  - 동의 문구에 "이 적용은 revert로 되돌릴 수 없다"를 넣을지
  - 사용 안내 16절(알려진 한계)에 "하드 링크가 있는 볼륨(NTFS 등)에서만 동작"을 적을지(문서 담당인 내가 할 수 있다)

사용자에게 물을 질문은 없다.

## 7. 실행한 것

- 읽기: `git show 9246836` 등 수정 커밋, `src/store/{apply-revert,common,plan,changes,runs,lock}.ts`, `src/engine/apply.ts`, `src/tools/plan-executor.ts`, 계약 `changes.ts`·`plan.ts`·`commands.ts`
- 빌드: `git archive b5bc346`와 worktree의 tsc
- 시험: 유닛 131건(129 통과, 2 건너뜀)과 engine 65건(65 통과)
- 실험(`.codaryn/r9b/`)
  - `exp9b.mjs`: R-9 입력 전부와 링크 실패 주입
  - `e2e.mjs`: 실제 CLI로 계획 → 적용 → 다시 적용 → 목록 → 미리보기 → 되돌리기 → 다시 되돌리기, 그리고 I-4
  - `e2e-nolink.mjs`와 `nolink.mjs`: 하드 링크 없는 CLI 프로세스

## 8. 지시 (1) 문서

- 커밋 `32fcbde` docs: show the run list's changes as distinct files (N-D 5)
  - `docs/usage.md` 3절: `runs` 표의 changes를 2에서 1로 고쳤다.
  - 설명을 "실행이 바꾼 서로 다른 파일 수"로 바꿨다. 결과 JSON의 `changes`에는 두 건이 있다는 것과, 끝 요약의 `Files changed`와 같다는 것도 적었다.
- 확인
  - 같은 고정 빌드 `b5bc346`로 3절 블록 전부(run stderr, runs, report, dry-run, revert, 두 번째 revert)를 `CODARYN_LANG=en` 실제 출력과 비교해 같았다.
  - `runs --json`도 `changes: 1`이고, run JSON의 `changes`는 2건이다.
- 검사: `diff --cached --check` exit 0, `check-secrets --staged` "no findings". 결과를 확인한 뒤 따로 커밋했다.
- 커밋 메타: 작성자 확인, trailer 없음
