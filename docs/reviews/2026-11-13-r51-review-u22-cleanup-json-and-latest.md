# R-51 병합 전 검토: 단위 U-22, 정리 JSON을 사실대로, 도는 실행의 `--run latest`

- **대상**
  - 고정 판: `pm/unit-U-22` **`5350d064715ddd867ecc2029b565ec49756e449d`**
  - 비교 기준: main **`abfb20b`**
  - 범위 커밋: `b014d5d`(계약), `584a31c`·`d6907b5`·`edddb2e`(앱 시험), `c59256c`(앱), `80fec27`·`b07286e`(CLI), `b4604d8`(문구)
- **방법**
  - `git archive`로 `.codaryn/r51/u22`, `.codaryn/r51/main`에 풀고 빌드했다(둘 다 typecheck 0).
  - 실제 CLI 프로세스를 net-guard를 붙여 돌렸다. 모델은 scripted, 작업 공간은 저장소 밖 임시 폴더다(끝나고 지웠다).
  - 지우기 실패는 기록 폴더 안 파일 하나에 ACL(지우기 거부)을 걸어 만들었다. 끝나고 ACL을 풀었다.
  - store가 돌려준 결과와의 대조, 그리고 두 계획 사이의 변화는 `runCleanup`에 store의 `applyCleanup`을 감싸 넣어 실제 코드 경로로 봤다.
  - GUI는 두 판을 빌드해 단위 시험을 돌리고, 앱 계층의 실제 출력을 GUI 엔진 호스트(`gui/src/engine-host/cleanup.ts`의 `appliedValue`)와 주 프로세스의 확인(`gui/src/shared/cleanup.ts`의 `cleanupResultOf`)에 넣어 봤다.
    - GUI 빌드에 electron 타입이 필요해, 다른 worktree의 `gui/node_modules`를 읽기 전용 정션으로 이었다가 걷었다.
  - 스크립트는 `.codaryn/r51/exp/`에 있다: `e.mjs`(CLI 정리·latest), `fn.mjs`(store 대조·두 계획 사이·GUI 호스트), `cmp.mjs`(다른 명령 JSON 비교), `apply-going.mjs`.
  - 실제 API·외부 네트워크는 쓰지 않았다. 파일 수정과 커밋도 없다.

## 요약

| 심각도 | 건수 | 항목 |
|---|---|---|
| 높음 | 0 | |
| 중간 | 2 | M-1 GUI가 새 정리 결과를 받지 못한다: 아무것도 못 지운 정리와 일부 실패한 정리가 "요청을 처리하지 못했습니다 (host_error)"로 보인다. M-2 `changes --run latest`(CLI, 앱)와 앱의 `resolveRun`은 옛 규칙이라, 도는 실행을 지나쳐 앞선 실행을 고른다 |
| 낮음 | 1 | L-1 사용 안내(usage.md)가 옛 정리 JSON(`mode`, `plan_changed` 종료 3)을 적는다 |
| 정보 | 5 | I-1~I-5 |

- 정리의 CLI 결과는 모든 경우에 JSON의 꼴, `ok`, 종료 코드, 오류 코드가 서로 맞고, 사람용 출력과도 맞으며, store가 돌려준 결과와 같다(`ok`만 규칙대로 바뀜).
- `report`·`revert`·`plan`은 도는 실행을 `run_in_progress`로 답한다. 죽은 실행이 남긴 흔적은 "도는 중"으로 잡히지 않는다.
- 다른 명령의 JSON은 main과 같다. 바뀐 것은 계약이 말한 정리의 꼴뿐이다.

## 1. 정리의 결과 (실제 CLI, `e.mjs` C1~C9, `fn.mjs` F1·F2)

| 경우 | main | 판 |
|---|---|---|
| 미리보기 | 종료 0, `mode: preview` | 종료 0, `status: preview`(이 필드 이름 말고 JSON 전체가 main과 같음) |
| 전부 지움(되돌린 실행 하나) | 종료 0, `ok: true` | 종료 0, `removed`, `ok: true` |
| 하나 지움, 하나 남김(되돌리지 않음, 확인 없음) | 종료 0 | 종료 0, `removed`, `ok: true`, 남김 `not_reverted_not_confirmed` |
| 아무것도 못 지움(확인 없음) | 종료 0, `ok: true` | **종료 3, `nothing_removed`, `ok: false`**. 사람용 첫 줄 "Nothing was removed." |
| 확인한 빈 계획 | 종료 0 | 종료 3, `nothing_removed`(I-2) |
| 일부 실패(`partly_removed`, ACL) | 종료 1, `ok: true` | 종료 1, `partly_failed`, `ok: false`. 남은 폴더 1개, 다음 요약에 보임 |
| 틀린 다이제스트 | 종료 3, `mode: plan_changed` | **종료 2, 오류 `cleanup_plan_changed`**. 두 언어 문구, 값 없음, 아무것도 지우지 않음 |
| 낡은 다이제스트(미리보기 뒤 실행 추가) | 종료 3 | 종료 2, `cleanup_plan_changed`, 아무것도 지우지 않음 |
| 미리보기와 실제 사이 변화(CLI의 계획 뒤, 잠금 아래 계획 전에 기록이 커짐, F2) | 종료 3, `mode: plan_changed` | 종료 2, `cleanup_plan_changed`, 아무것도 지우지 않음 |
| 잠금이 잡힘(도는 실행) | `workspace_locked` | 종료 6, `workspace_locked`, 두 언어 문구 |

- **store와의 대조(F1)**: removed, nothing_removed, partly_failed 세 경우 모두 JSON의 `outcome`은 store가 돌려준 결과와 `ok`를 빼고 같다. JSON의 `exitCode`도 프로세스의 종료 코드와 같다.
- **종료 코드와 상태의 대응**은 계약 `CLEANUP_EXIT_CODES`와 같다: preview 0, removed 0, nothing_removed 3, partly_failed 1.

## 2. 도는 실행과 `--run latest` (`e.mjs` R1~R5, `apply-going.mjs`)

| 경우 | main | 판 |
|---|---|---|
| 가장 새 실행이 도는 중, 앞에 끝난 실행: `report` | 앞선 실행을 보임 | `run_in_progress`(종료 6), 두 언어 문구 |
| 같은 때 `revert --dry-run` | 앞선 실행 | `run_in_progress` |
| 같은 때 `plan` | `run_not_plan`(앞선 실행) | `run_in_progress` |
| 같은 때 **`changes`** | 앞선 실행 | **앞선 실행(종료 0)** — M-2 |
| `apply --run latest` | `invalid_arguments` | 같음(apply는 원래 실행 id만 받음) |
| 도는 적용 실행(검증기가 기다림)의 `report` | 계획 실행을 보임 | `run_in_progress`. 끝나면 적용 실행 |
| 실행 id를 직접 줌 | 그 실행 | 같음(끝난 것은 complete, 도는 것은 incomplete 종료 3) |
| **죽은 실행**(우리가 띄운 프로세스를 끝냄: 결과 없음, 잠금 파일 남음) | 앞선 실행 | 앞선 실행. `doctor`는 "끝난 프로세스가 남긴 잠금"이라 함 |
| 잠금 없이 결과 없는 실행 | 앞선 실행 | 앞선 실행 |
| 다른 보유자(정리 같은 것)가 잠금을 쥠 | 앞선 실행 | 앞선 실행 |
| 죽은 실행의 잠금에, 살아 있는 다른 프로세스의 pid를 넣음(시작 시각은 그대로) | 앞선 실행 | 앞선 실행(시작 시각이 달라 죽은 것으로 판정) |
| 같은 pid를 넣고 시작 시각을 뺌 | 앞선 실행 | `run_in_progress`. 그 프로세스가 끝나면 앞선 실행(I-4) |

- 죽은 실행이 남긴 흔적 때문에 `latest`를 영영 못 쓰게 되는 경우는 찾지 못했다.
  - "도는 중"은 결과 없는 실행이 잠금을 쥐고 있고, 잠금 규칙으로 그 보유자가 살아 있을 때만이다.
  - 이 판의 CLI가 쓰는 잠금에는 시작 시각이 들어가, pid가 재사용돼도 죽은 것으로 판정된다.

### M-2 (중간) `changes --run latest`(CLI·앱)와 앱의 `resolveRun`은 옛 규칙이다

- **재현(R1)**: 가장 새 실행이 도는 중에 `codaryn changes --task … --run latest --json`이 종료 0으로 앞선 실행의 변경을 보인다. 같은 때 `report`, `revert`, `plan`은 `run_in_progress`다.
- **원인**: `latest`를 푸는 길이 둘이다.
  - 새 규칙: `src/cli/run-ref.ts`의 `resolveRunReference`. `report`, `revert`, `plan`, `apply`, `review`가 쓴다.
  - 옛 규칙: `src/cli/runs.ts`의 `resolveRunRef`(store의 `latestRunId`, 결과 있는 첫 실행).
    - 앱 계층의 `runIdOf`(`src/app/runs.ts`)가 이것을 쓴다.
    - 그래서 앱의 `changes`, 그리고 그것을 그대로 부르는 CLI의 `changes`(`src/cli/main.ts`가 앱 계층으로 넘김)가 옛 규칙이다. 어댑터용 `resolveRun`(N-23(b), "적용 전에 어느 실행인지 보임")도 같다.
  - `resolveRunRef`의 주석은 아직 "`report`와 `revert`용"이라고 적는다.
- **왜 중간인가**
  - 계약의 `run_in_progress` 설명(`src/contracts/engine.ts`)과 DR-48은 `changes`를 명시한다. 그런데 그 명령에서 AXM-8(중간)이 그대로 남는다. 에이전트는 도는 실행의 변경을 본다고 여기며 앞선 실행의 변경을 읽는다.
  - 읽기만 하는 명령이고 JSON에 실행 id가 있어 값으로는 구별할 수 있다. GUI는 `latest`를 쓰지 않는다.
- **고침(앱·CLI 담당)**: `runIdOf`가 `resolveRunReference`를 쓰게 하거나, `resolveRunRef`가 같은 판정을 하게 한다. `changes`와 `resolveRun`의 `latest` 시험을 더한다.

## 3. 다른 명령의 JSON (`cmp.mjs`)

같은 절차를 두 판에서 돌려 정규화해 비교했다. 정규화한 것은 실행 id, 시각, 걸린 시간, 해시, 크기, 경로, 버전이다.

| 명령 | 결과 |
|---|---|
| `run`(일반, 계획), `runs`, `report`(id, latest, 없는 실행, 실행 없는 작업 공간), `changes`(id, latest), `plan`, `revert --dry-run`, `apply`, 다시 `apply`, `revert`, `revert --dry-run --run latest`, `doctor` | 16개 모두 종료 코드와 JSON이 main과 같다 |
| `cleanup` 미리보기 | `mode` → `status` 이름만 다르고 나머지는 같다(계약이 말한 변경) |

- 실행이 끝난 뒤의 `latest`는 두 판이 같다. 이 비교에는 도는 실행이 없다. 도는 실행일 때 달라지는 것은 2절에 있다.

## 4. 앱 계층과 GUI (`fn.mjs` F3, GUI 단위 시험)

- 앱 계층은 새 꼴을 그대로 전한다.
  - 정리를 했으면 `status`가 있고, `outcome.ok`는 removed일 때만 참이다.
  - 틀린 다이제스트는 호출 오류 `cleanup_plan_changed`다.
- GUI 단위 시험: 두 판 모두 162/162 통과. 새 꼴을 다루는 시험이 없다.

### M-1 (중간) GUI가 새 정리 결과를 받지 못한다

- **재현(F3)**: 앱 계층의 실제 출력을 GUI 엔진 호스트의 `appliedValue`에 넣었다.

  | 경우 | main | 판 |
  |---|---|---|
  | 지움 | 결과를 보임 | 결과를 보임 |
  | 아무것도 못 지움 | 남긴 것과 이유를 보임 | **`{ok:false, code:"host_error"}`** |
  | 일부 실패(ACL) | 남긴 것(`partly_removed`)을 보임 | **`host_error`** |
  | 틀린 다이제스트 | `plan_changed`, GUI 문구 "The state changed after the preview…" | `cleanup_plan_changed`. GUI 카탈로그에 이 코드가 없어 기본 문구 "The request could not be handled." |

- **원인**: GUI는 `outcome.ok === false`를 "아무것도 하지 않았고 `code`가 이유"로 읽는다(`gui/src/engine-host/cleanup.ts` `appliedValue`, `gui/src/shared/cleanup.ts` `cleanupResultOf`). 이 판에서 `ok: false`는 "했지만 지우지 못했거나 일부 실패"이고 `code`가 없다. 그래서 확인이 실패해 host_error가 된다.
- **영향**
  - GUI에서 정리를 확인한 사람이, 실제로는 일부가 지워졌거나(partly_failed) 확인이 빠져 남은 경우에 "요청을 처리하지 못했습니다"만 본다. 무엇이 지워졌고 무엇이 왜 남았는지(예: 되돌리지 않은 실행이라 남김, 다 지우지 못한 폴더가 다음 정리에 보임)를 알 수 없다.
  - U-13의 "보관함은 남김" 경로도 다른 것이 지워지지 않으면 이 결과가 된다.
  - 파일이 더 지워지지는 않는다. 다음 미리보기에서 상태를 다시 볼 수 있다.
- **고침(GUI 담당)**: 엔진 호스트와 주 프로세스가 `status`를 읽고, `ok: false`라도 `removed`·`kept`가 있으면 결과로 보인다. `cleanup_plan_changed`의 GUI 문구를 더한다(옛 `error.plan_changed`를 옮김). 이 판은 `gui/`를 건드리지 않으므로 같은 단위에 GUI 몫이 필요하다.

## 5. 낮음, 정보

- **L-1 (낮음) 사용 안내가 옛 꼴을 적는다.** `docs/usage.md`의 세 곳이다.
  - 857행: 문제 해결 표 "`cleanup`의 `plan_changed`(종료 3)"
  - 1189행: "`plan_changed`(종료 3)"
  - 1227행: "`mode` `preview`, `applied`, `plan_changed`"
  - 종료 코드 표(598~603행)도 `nothing_removed`(3)와 `cleanup_plan_changed`(2)를 말하지 않는다.
  - `docs/cli-contract.md`는 고쳐졌다. 문서 담당 몫이다.
- **I-1** 한국어 출력에서 "Nothing was removed."는 영어 고정 글이다. 코드 주석이 말하는 대로 아직 카탈로그 문구가 없다(UXM-7과 같은 종류).
- **I-2** 항목이 없는 계획을 확인하면 `nothing_removed` 종료 3이다. 3은 "사람의 입력이 필요함"인데, 할 일이 없었던 경우다. 미리보기는 이때 확인 명령을 내지 않으니 손으로 만든 확인에서만 생긴다.
- **I-3** 일부 실패한 정리의 사람용 첫 줄은 "Removed: run records 0, … 0 bytes"이고, 아래에 남긴 이유 줄이 온다. 실패했다는 말은 따로 없고 종료 1로만 드러난다. main과 같다.
- **I-4** 잠금 보유자의 시작 시각이 기록에 없으면 잠금 규칙은 pid만 본다. 그 pid를 다른 살아 있는 프로세스가 쓰는 동안 `latest`는 `run_in_progress`다. 그동안 다른 모든 실행도 `workspace_locked`라 이 판이 새로 만든 막힘은 아니다. 이 판의 CLI가 쓰는 잠금에는 시작 시각이 있다.
- **I-5** store가 적용 실행 기록을 지우기 직전에 다시 보다가 보관함에 새 파일을 찾아 남긴 경우(U-13, `discarded_left`)는 문제 이유(`CLEANUP_PROBLEM_KEPT_REASONS`)가 아니다. 그래서 다른 것을 지웠으면 `removed`, `ok: true`다. 확인 뒤에 상태가 바뀐 경우라 `changed`에 가깝다. 드문 경쟁이다.

## PM 질문

1. M-1: GUI 몫을 U-22에 넣어 함께 병합할지, GUI를 고칠 때까지 U-22를 미룰지. 가정: 함께 넣는다. 지금 판을 병합하면 GUI의 정리 결과 화면이 이 경우들에서 오류를 보인다.
2. M-2: `changes`와 `resolveRun`을 이 단위에서 맞출지. 가정: 맞춘다(계약이 `changes`를 명시함).
