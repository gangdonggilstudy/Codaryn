# R-51b 병합 전 확인(좁게): 단위 U-22, R-51 지적의 고침

- **대상**: 고정 판 `pm/unit-U-22` **`78e1108e0360746bb89e8959c4e830a72d5f68f5`** (main `590c58d` 위). R-51의 판은 `5350d06`이었다.
- **내 코드**: `src/cli/runs.ts`의 `resolveRunRef`(커밋 `2fb9307`, R-51 M-2의 run list 쪽)는 내가 고친 것이다. 그 한 곳은 검토하지 않고, 아래 확인에서 다른 것과 함께 동작만 봤다.
- **방법**
  - `git archive`로 `.codaryn/r51b/u22`에 풀고 빌드했다(typecheck 0).
  - GUI는 다른 worktree의 `gui/node_modules`를 읽기 전용 정션으로 이어 빌드했다. 단위 시험과 연기 시험을 한 번씩 돌린 뒤 정션을 걷었다.
  - 실제 CLI는 net-guard를 붙여 돌렸다. 모델은 scripted, 작업 공간은 저장소 밖 임시 폴더다(끝나고 지웠다).
  - 스크립트는 `.codaryn/r51b/exp/`에 있다.
    - R-51 것을 그대로 다시 씀: `e.mjs`, `fn.mjs`, `apply-going.mjs`
    - 새로 씀: `app-latest.mjs`, `stuck.mjs`, `doc-cleanup.mjs`
  - 실제 API·외부 네트워크는 쓰지 않았다. 파일 수정과 커밋도 없다.

## 요약

| 심각도 | 건수 |
|---|---|
| 높음 | 0 |
| 중간 | 0 |

R-51의 M-1, M-2, L-1은 이 판에서 고쳐졌다. 높음·중간의 새 문제는 찾지 못했다. 지시대로 낮음 이하는 따로 세지 않았고, 본 것만 끝에 적는다.

## (1) M-2: `--run latest`는 모든 명령과 앱 계층에서 같다

가장 새 실행이 도는 중이고 앞에 끝난 실행이 있을 때:

| 길 | `latest` | 끝난 실행의 id |
|---|---|---|
| CLI `report` | `run_in_progress`(종료 6), 두 언어 문구 | 그 실행(complete) |
| CLI `changes` | **`run_in_progress`**(R-51에서는 앞선 실행) | 그 실행 |
| CLI `revert --dry-run` | `run_in_progress` | 그 실행 |
| CLI `plan` | `run_in_progress` | (계획 실행이 아니면 `run_not_plan`, 전과 같음) |
| CLI `apply` | `invalid_arguments`(원래 실행 id만 받음) | — |
| 도는 적용 실행 뒤의 `report` | `run_in_progress`, 끝나면 그 적용 실행 | — |
| 앱 `resolveRun` | **`run_in_progress`** | 그 실행 |
| 앱 `report` | `run_in_progress` | 그 실행 |
| 앱 `changes` | **`run_in_progress`** | 그 실행 |
| 앱 `revert`(dry run) | `run_in_progress` | 그 실행 |

- 도는 실행이 끝난 뒤 앱의 `resolveRun latest`는 그 실행을 고른다.
- `runs --json`은 도는 실행을 `status: null`로 보인다. `runs`는 `latest`를 받지 않는다.

## (2) M-1: GUI가 정리의 결과를 보인다

- **GUI 시험**: 단위 165/165 통과, 연기 시험 181/181 통과(앱 종료 0).
  - 연기 시험에는 "아무것도 못 지운 정리"가 새로 있다: `cleanupKeepStatus: {"status":"nothing_removed","notice":"nothing_removed"}`, 남김 이유 `not_reverted_not_confirmed`.
- **앱 계층의 실제 출력을 GUI 쪽 함수에 차례로 넣어 봄(`fn.mjs` F3)**: 엔진 호스트 `appliedValue`, 주 프로세스 `cleanupResultOf`, 창의 `asCleanupResult` 순서다.

  | 경우 | R-51(`5350d06`) | 이 판 |
  |---|---|---|
  | 지움 | 결과 | 결과(`status: removed`) |
  | 아무것도 못 지움 | `host_error` | **결과(`status: nothing_removed`, 남긴 것과 이유)** |
  | 일부 실패(ACL로 지우기 거부) | `host_error` | **결과(`status: partly_failed`, `partly_removed`)** |
  | 틀린 다이제스트 | 기본 문구 | `cleanup_plan_changed`, GUI 문구 "The state changed after the preview, so nothing was removed. See the cleanup plan again." |

- **코드**
  - 엔진 호스트는 `outcome.ok`를 읽지 않고, `removed`·`kept`가 있으면 결과로 넘긴다.
  - 주 프로세스와 창은 `status`가 세 값 중 하나일 때만 받는다.
  - 결과 화면은 `removed`가 아니면 맨 앞에 상태 줄(`cleanup.result.status.*`)을 둔다.
- **CLI 쪽(F1·F2)**: R-51과 같다.
  - 세 경우 모두 JSON의 `outcome`은 store 결과와 `ok`만 다르다.
  - 두 계획 사이의 변화는 `cleanup_plan_changed`(종료 2)다.

## (3) L-1: usage.md의 정리 예시

- 문서가 인용한 경우를 이 판의 실제 CLI로 다시 만들었다(`doc-cleanup.mjs`). 폐기 하나를 적용하고 `--older-than 0 --discarded-older-than 0 --confirm … --include-not-reverted`로 확인했다.
  - 종료 3이고, 다섯 줄이 문서 1223~1229행의 블록과 같다(실행 id만 다르다).
  - `--json`은 `kind: cleanup`, `status: nothing_removed`, `exitCode: 3`, `outcome.ok: false`다. 필드는 `schemaVersion, kind, status, exitCode, outcome`이고 `mode`는 없다.
  - `--delete-discarded`까지 더하면 `Removed: run records 2, discarded-files folders 1, … bytes`, 종료 0이다. 바이트 수는 문서가 말한 대로 실행마다 다르다.
- 문서의 나머지 서술도 실제와 같다: 종료 코드 표 606~611행, 문제 해결 표 855~867행, 1198·1218·1234·1237행의 `status`·종료 코드.
- 남은 옛 서술 한 곳(정보): `docs/cli-contract.md` 1144행이 아직 "다르면 … `plan_changed`(종료 3)다"라고 적는다. 바로 아래 1153행의 새 서술과 어긋난다. `adapter-contract.md` 244행의 `plan_changed`는 store의 결과 코드라 맞다.

## (4) 죽은 실행의 흔적과 `latest`

- **영영 `run_in_progress`가 되는 경우는 찾지 못했다.** "도는 중"은 결과 없는 실행이 잠금을 쥐고, 잠금 규칙이 그 보유자를 살아 있다고 볼 때만이다.

  | 흔적 | `latest` |
  |---|---|
  | 우리가 띄운 실행을 끝냄(결과 없음, 잠금 파일 남음) | 앞선 실행. `doctor`는 `ok`, "the lock was left by a process that has ended; the next run reclaims it" |
  | 잠금 없이 결과 없는 실행 | 앞선 실행 |
  | 다른 보유자(정리 같은 것)의 잠금 | 앞선 실행 |
  | 죽은 실행의 잠금에 살아 있는 다른 프로세스의 pid(시작 시각은 그대로) | 앞선 실행(시작 시각이 달라 죽은 것으로 판정) |
  | 같은 pid에 시작 시각 없음 | `run_in_progress`, **그 프로세스가 끝날 때까지** |

- **마지막 경우에 사람이 빠져나올 길(`stuck.mjs`)**: 이때는 `run_in_progress`만이 아니라 새 실행도 `workspace_locked`다. 이 판이 새로 만든 막힘이 아니라 잠금 규칙에서 오는 것이다.
  - `run_in_progress`의 고치는 법 줄: "Try again when the run ends. To see an earlier run, give its id; codaryn runs lists the runs of the workspace." 실행 id를 주면 그 실행을 보인다.
  - `codaryn runs`는 그 실행을 `no result (running or stopped)`로 보인다.
  - `codaryn doctor`는 `warn`, "a process holds .codaryn/lock.json; if no Codaryn is running in this workspace, remove that file".
  - `workspace_locked`의 고치는 법도 같은 파일을 지우라고 한다.
  - 정리 미리보기는 그 실행을 `lock_held`로 막는다(지우지 않음).
  - `lock.json`을 지우면 `latest`가 앞선 실행을 고른다.
- **잠금에 시작 시각이 없거나 읽히지 않는 경우**
  - 이 판의 CLI가 쓰는 잠금에는 시작 시각이 있다(`pid, processStartedAt, runId, startedAt`).
  - Windows에서는 시작 시각을 PowerShell로 읽는다(`src/store/lock.ts`의 `processStartTime`). 읽지 못하면(시간 초과 등) pid만 보고 살아 있다고 판정한다. 그래서 위 마지막 경우는 오래된 잠금 파일이나 그런 일시적 실패에서만 생긴다.
- **정보**: `run_in_progress`의 안내는 "끝난 뒤 다시"를 먼저 말한다. 위 경우에는 그때가 오지 않는데, 잠금이나 `doctor`를 말하지 않는다. 안내에 "도는 실행이 없는데도 그러면 `codaryn doctor`" 한 마디를 더하면 길이 보인다(문구 담당, 다음 단위).
