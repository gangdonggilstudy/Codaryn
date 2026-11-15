# R-81 검토: U-91 앱 계층의 적용 전 점검 (`checkApply`, adapter-contract 5.14)

- 검토자: 검증 엔지니어 (w3:p4, ne-verify). 읽기 전용. 저장소 수정·커밋 없음.
- 대본(scripted) 모델, OS 임시 폴더, 합성 값만 썼다. 실제 API·네트워크 없음.
- 자식 프로세스는 자기가 띄운 핸들로만 끝냈다(`child.kill()`, pid 번호 없음).

## 검토한 해시

| 대상 | 해시 |
|---|---|
| 고정 판 `pm/unit-U-91` | `1409fa8` |
| 그 아래 main | `82451d3` |
| U-91의 몫 | `git diff pm/unit-U-90(96b3671) 1409fa8`: 6파일 +631 |
| 단위 커밋 | `9f32ee5` (재현 시험), `cb8de9c` (구현) |

U-91의 몫은 `src/app/check-apply.ts`(새 파일, 221줄), `app.ts`의 `checkApply`, `types.ts`의 `CheckApplyRequest`·`PlanCheck`, `index.ts`의 내보내기, 시험 278줄, 계약 5.14다.

## 수치 (고정 판 `1409fa8`, 프로젝트 스크립트)

| 항목 | 결과 | 기록 |
|---|---|---|
| `npm run build` | exit 0 | `.codaryn/r81/build-b.log` |
| `npm run test:unit` | tests 2749, pass 2745, fail 0, skipped 3, todo 1 (exit 0) | `.codaryn/r81/unit-b.log` |
| `npm run test:integration` | tests 559, pass 559, fail 0 (exit 0) | `.codaryn/r81/integration-b.log` |

## 심각도

| 높음 | 중간 | 낮음 | 정보 |
|---|---|---|---|
| 0 | 0 | 1 | 6 |

---

## (1) 아무것도 옮기지 않는가, 끝난 뒤 바이트까지 같은가

- 방법: `.codaryn/r81/check.mjs`, 기록 `CHECK.log`.
  - 사례마다 대본 모델로 계획 실행을 만든다. 작업 공간을 바꾼 뒤 점검 앞뒤로 작업 공간 전체를 찍는다(상태 디렉터리 `.codaryn` 포함).
  - 찍는 것: 항목마다 종류, 크기, sha256, **하드 링크 수(nlink)**.
- 결과: 점검이 끝까지 간 11사례 모두 **완전히 같다**. 1~11번과 잠긴 경우(14)다.
  - 시험 링크와 `lock.json`이 남지 않았다. 원본의 nlink도 1 그대로다.
  - 실행 디렉터리, journal, `plan_checked`, 적용 표시도 생기지 않았다.
  - 1번(하드 링크가 되는 NTFS, 실제 링크 시험)도 같다.
- 실행기가 시험 링크를 거두지 못한 경우(`kill.mjs` C, unlink 거부): 점검이 대신 지워 남는 것이 없다. `probesLeft` 0이다.
- 점검도 지우지 못한 경우(D): `probesLeft: 1`로 알린다. 남는 것은 `.codaryn/.codaryn-link-probe-<pid>-…`(원본과 같은 내용, nlink 2)다.
- 잠금을 풀지 못한 경우(`check.mjs` 15, 해제 두 번 거부): `lockLeft: true`로 알린다.
  - 그 잠금의 주인은 살아 있는 이 프로세스다. 그래서 같은 프로세스의 다음 점검과 apply가 모두 `workspace_locked`다.
  - 프로세스가 끝나기 전에는 죽은 잠금으로 거둘 수도 없다. 알린 대로다.

**도중에 끝나면** (`kill.mjs`, 기록 `KILL.log`)

- **A — 시험 링크를 만든 직후 프로세스가 끝남**
  - 방법: 자식 프로세스가 `checkApply`를 부른다. 링크 함수는 실제 `link`를 한 뒤 멈춘다. 부모가 그 순간 핸들로 끝낸다.
  - 남는 것:
    - `.codaryn/lock.json`(죽은 잠금)
    - `.codaryn/.codaryn-link-probe-<자식 pid>-…`: `a.txt`의 두 번째 이름(nlink 2)
  - 응답은 없다. 프로세스가 죽었으니 말할 수 없다.
  - 다른 프로세스의 다음 점검: 죽은 잠금을 거두고 정상 결과(`probesLeft: 0`, `lockLeft: false`)를 낸다. **남은 시험 링크는 그대로이고 말하지 않는다.**
  - 그 뒤 apply는 `done/verified`다. 옮겨진 `sorted/a.txt`가 여전히 nlink 2이고, 상태 디렉터리의 그 이름과 내용을 함께 가진다(L1).
- **B — 죽은 잠금** (다른 프로세스가 잠금을 잡고 끝남)
  - 점검이 거두고 정상 결과를 낸다.
  - 끝난 뒤 작업 공간과 상태 디렉터리는 그 잠금이 생기기 전과 같다.
- **예외**
  - 실행기 `check`가 던지면 그 행동은 `io_error`다(apply와 같은 처리).
  - 그 밖의 실패는 `internal_error`다. 남긴 것은 문구 "(a probe or the lock was left)"로만 말한다(I1).
- **취소:** `checkApply`에는 취소 인자가 없다(I2).

## (2) 판정을 복사했는가

- **실행기 판정은 그대로 부른다.** `createPlanExecutor(...).check(action)`(`src/tools/plan-executor.ts:164-176`).
  - 원본(`checkSource`: 꼴, 해시), 목적지(`inspectDestination`), DR-21 하드 링크 시험(`hardLinkProblem`)이다.
  - CLI apply가 엔진에 주는 것과 같은 생성 인자다(`{workspace, workspaceRoot, runId}`, `src/cli/plan-commands.ts:711`). 다른 점은 `runId`가 잠금 id라는 것뿐이다. `check`는 `runId`를 쓰지 않는다. `discardedDir`는 `apply`에서만 부른다.
- **정책 판정은 앱 계층에 다시 썼다.** `check-apply.ts`의 `permitted`는 엔진 `src/engine/apply.ts:227-237`의 `permitted`와 줄마다 같다.
  - 같은 것: `planActions` 포함 여부, `PLAN_ACTION_DESCRIPTORS`, `checkRequested`→`checkEffective`, 예외는 거부, 인자 `{from,to}`/`{path}`(apply의 `pathArgs`).
  - 정책 관문은 `createPolicyGate({config: task.policy, workspace})`로 CLI apply(`plan-commands.ts:712`)와 같다. `planActions`도 같은 `task.policy.planActions ?? []`다.
  - 모듈 머리와 계약 5.14가 이 복사를 밝히고, 엔진이 `preflightPlan`을 내보내면 바꾼다고 적었다. 지금 어긋남은 없지만, 엔진 쪽이 바뀌면 함께 바꿔야 하는 곳이다(I3).
- **실제 apply와 비교** (`CHECK.log`): 점검 뒤 같은 다이제스트로 apply를 돌려 그 apply의 `plan_checked` 기록과 비교했다.

| 경우 | 점검 | apply의 `plan_checked` / 끝 | 같은가 |
|---|---|---|---|
| 1 적용 가능 | 문제 없음 | 없음 / `done/verified` | 같음 |
| 2 원본이 바뀜 | `[0 source_changed]` | 같음 / `failed/plan_stale` | 같음 |
| 3 원본 없음 | `[0 source_missing]` | 같음 / `plan_stale` | 같음 |
| 4 대상이 이미 있음 | `[0 destination_exists]` | 같음 / `plan_stale` | 같음 |
| 5 적용 task가 discard를 허용 안 함 | `[1 denied]` | 같음 / `plan_stale` | 같음 |
| 6 행동 넷(정상, 바뀜, 대상 있음, discard) | `[1 source_changed, 2 destination_exists]` | 같음 / `plan_stale` | 같음 |
| 7 하드 링크 없는 볼륨(점검·apply 모두 link가 EPERM) | `unsafeMoves [0, 1]` | 같음 / `needs-input/consent_required` | 같음 |
| 8 기록 변경 표시 | `plan_records_changed` | apply도 `plan_records_changed` | 같음 |
| 9 이미 적용됨 | `plan_already_applied` | apply도 `plan_already_applied` | 같음 |
| 10 다른 다이제스트 | `plan_not_approved` | apply도 `plan_not_approved` | 같음 |
| 11 경로에 등록 비밀 값 | 문제 없음 | 없음 / `done/verified` | 같음 |

- 하드 링크 없는 볼륨은 이 기계에 없다. 그래서 점검에는 `hooks.applyCheck.fileOps.link`로, apply에는 같은 실패를 주는 실행기로 엔진을 감싸(`hooks.applyPlan`) 같은 조건을 만들었다.
- **"괜찮다"인데 apply가 실패하는 경우:**
  - 점검과 apply 사이에 파일이 바뀌는 경우는 계약대로다(12번: 점검은 문제 없음, apply는 `plan_stale`). 점검은 약속이 아니다.
  - 그 밖에 apply가 잠금 아래에서 더 보는 것이 있다. 이것들은 캡처 실패나 경쟁에서만 결과가 갈린다(I4).
- **반대 경우**(점검은 문제, apply는 성공)는 찾지 못했다. 판정 경로가 같다.
- 인벤토리 상한(DR-6, 10만 파일)은 재지 않았다. 점검과 apply가 같은 `createInventoryChecker`를 쓴다는 것은 코드로만 확인했다.

## (3) 잠겨 있을 때와 죽은 잠금

| 경우 | 결과 |
|---|---|
| 도는 실행이 잠금을 잡음 (`check.mjs` 14, 같은 프로세스가 `acquireLock`) | `workspace_locked`, "another run or revert holds the workspace; nothing was checked". 앞뒤 상태가 같다 |
| 죽은 잠금 (`kill.mjs` B) | store의 `acquireLock`이 거두고(T-9) 점검이 정상 결과를 낸다. 끝난 뒤 그 잠금은 없다 |
| 점검이 남긴 죽은 잠금 (`kill.mjs` A) | 다음 점검이 거둔다. 시험 링크는 남는다(L1) |
| 점검이 풀지 못한 잠금 (`check.mjs` 15) | `lockLeft: true`. 주인 프로세스가 살아 있는 동안 그 작업 공간의 점검과 apply는 `workspace_locked`다 |

## (4) 점검이 apply의 승인을 대신하지 않는가

`CHECK.log` 13에서 하드 링크 없는 볼륨으로 쟀다.

| 확인 | 결과 |
|---|---|
| 점검 결과 | `unsafeMoves [0]` |
| 그 뒤 계획 보기 | `status pending`, `appliedBy null` |
| apply, digest `""` | `invalid_arguments` |
| apply, digest `null` | `internal_error`(I6) |
| apply, 맞는 digest, 동의 없음 | `needs-input/consent_required`. `a.txt`는 제자리다 |

- 점검은 동의를 만들지 않는다. apply는 여전히 다이제스트를 요구하고 사전 점검을 다시 한다(12번).
- 1번에서도 점검 뒤 apply가 다이제스트를 받아 옮겼다.

## (5) 응답의 경로 글

- 점검 응답은 순번, 문제 코드, 수, 다이제스트, 시각뿐이다. 경로 글이 없다.
- 11개 사례의 응답 전체에서 작업 공간 경로(두 표기), `a.txt`, `sorted/`, 등록 비밀 값을 찾았다. 0건이다.
  - 11번은 파일 이름에 등록 비밀 값을 넣은 경우다. 응답에 이름이 없고, apply도 정상이다.
- 오류 문구는 모두 고정 글이다. 계획 보기에서 온 오류는 `plan` 호출의 것과 같다.

---

## 결함

### 낮음

- **L1 점검 도중 프로세스가 끝나면 시험 링크(사람 파일의 두 번째 이름)가 상태 디렉터리에 영영 남고, 뒤의 어느 응답도 그것을 말하지 않는다.**
  - 재현: `kill.mjs` A. 실행기가 `.codaryn` 안에 시험 링크를 만든 직후 점검 프로세스가 끝나면, 죽은 잠금과 `a.txt`의 두 번째 이름이 남는다.
  - 다음 점검은 죽은 잠금은 거두지만, 시험 링크는 지우지도 세지도 않는다.
    - 지우는 대상은 이 프로세스의 pid가 붙은 이름이고(`PROBE_PREFIX`, `check-apply.ts:45`), 점검 전에 없던 이름뿐이다(`before`, `:144`, `:181`).
    - 그래서 답은 `probesLeft: 0`이다.
  - 그 뒤 apply가 성공해도 옮겨진 파일(`sorted/a.txt`, nlink 2)의 다른 이름이 `.codaryn`에 남는다.
    - 사람이 그 파일을 고치면 그 이름의 내용도 바뀐다.
    - 사람이 그 파일을 지우거나 다른 계획이 버려도 내용은 상태 디렉터리에 남는다. `cleanup`도 이 이름을 모른다.
  - 같은 구멍이 같은 프로세스 안에도 있다. 점검이 지우지 못해 `probesLeft: 1`로 한 번 알린 이름은 다음 점검에서 `before`에 들어가 건너뛰므로, 다시 0으로 보고된다(`kill.mjs` D).
  - 실행기의 시험 링크 자체는 apply에도 있던 것이다(apply가 같은 순간에 끝나도 같다). 하지만 U-91은 계획 화면을 열 때마다 시험 링크를 만들 수 있는 새 통로다. 계약 5.14는 "남기지 않는다", "숨기지 않는다"고 약속한다.
  - 창(link와 unlink 사이)이 매우 좁아 낮음으로 둔다. 다만 GUI 엔진 호스트가 창 닫기나 다시 시작으로 끝날 때 닿을 수 있다.
  - 제안:
    - 점검(그리고 apply)이 시작할 때 `.codaryn` 바로 아래와 원본 폴더에서 **죽은 pid**의 `.codaryn-link-probe-<pid>-…` 일반 파일을 찾아 지운다. 이름에 pid가 있으므로 잠금의 죽음 판정(T-9)을 그대로 쓸 수 있다.
    - 지운 수와 지우지 못한 수를 응답에 싣는다.
    - 이 프로세스가 앞서 남긴 이름(`before`에 있는 이 pid의 이름)도 다시 지워 본다.

### 정보

- **I1** 점검이 도중에 실패한 경로(`failed`)는 `internal_error`이고, 남긴 것을 문구로만 말한다(`check-apply.ts:206`). 구조화된 `probesLeft`·`lockLeft`가 없어 어댑터가 코드로 알 수 없다. 이 경로는 정책 관문이나 실행기 생성이 던질 때라 밖에서는 거의 닿지 않는다. 그래서 재지 못했고, 코드로만 확인했다.
- **I2** 점검에는 취소 인자가 없다. 실행기 `check`는 신호 없이 원본을 끝까지 해시한다(`checkSource(action, undefined)`). 행동이 많고 큰 파일이면 그동안 잠금을 잡고, 사람이 멈출 수 없다. 계획 화면에서 점검을 자동으로 부르면 그동안 새 실행이 `workspace_locked`가 된다.
- **I3** `permitted`는 엔진 `apply.ts:227-237`의 복사다. 지금은 같다(위 표, 시험 `u91-check-apply` "the same judgement as the apply's preflight record"). 엔진이 `preflightPlan`을 내보내기 전까지 두 곳을 함께 바꿔야 한다. 계약 5.14에 적혀 있다.
- **I4** apply가 잠금 아래에서 더 보는데 점검은 보지 않는 것들이다. 판정이 갈리는 것은 캡처 실패나 경쟁 때뿐이다.
  - 계획 기록 변경 표시를 잠금 아래에서 다시 본다(`apply.ts:378-388`). 점검은 잠금 전 계획 보기의 표시만 본다.
  - 무결성 검사(`inspect("run_start")`)와 상태 디렉터리 검사(`checkState("run_start")`)는 캡처가 실패하면 apply를 끝낸다.
  - DR-28의 두 번째 방어(행동마다 다시 가리기, `apply.ts:417-430`)가 있다. 첫째 방어인 계획 보기의 `plan_secrets_differ`는 점검도 거친다.
  - 인벤토리를 잠금 아래에서 새로 센다. 점검은 잠금 전 계획 보기의 것을 쓴다.
  - 같은 이유로, 계획 보기와 `loadPlan`이 "적용 안 됨"을 본 뒤 잠금을 잡기 전에 apply가 끝나면, 점검은 이미 적용된 계획을 판정한다. 그러면 `source_missing` 같은 문제로 답한다. 잠금을 잡은 뒤 `applied`를 한 번 더 보면 닫힌다.
- **I5** 같은 기계 안에서 이름 공간을 나누는 것은 pid 접두사다. GUI는 실행을 앱 전체에 하나만 두므로 같은 프로세스에서 apply와 점검이 겹칠 일은 드물다. 겹친다면(작업 공간이 다른 작업 공간 안에 있는 경우), 점검이 apply의 시험 링크를 자기 것으로 보고 지울 수 있다. 재지 않았다.
- **I6** 범위 밖: 앱 계층 `applyPlan`에 `digest: null`을 주면 `invalid_arguments`가 아니라 `internal_error`다(`CHECK.log` 13). U-91과 무관한 입력 검사다.

## 방법과 남긴 것

- 사본: `git archive 1409fa8 | tar -x`로 `.codaryn/r81/b`에 풀었다. root `node_modules`(claude-operations)는 junction으로 걸고 `npm run build`를 했다.
- 탐침: `.codaryn/r81/check.mjs`(15사례), `kill.mjs` + `kill-child.mjs`(도중 종료, 죽은 잠금, 거두지 못한 시험 링크). 빌드된 앱 계층(`createCodarynApp`)과 시험 도우미 `appEnvironment`를 불렀다. 임시 폴더는 스크립트가 지운다.
- 기록: `CHECK.log`, `KILL.log`, `build-b.log`, `unit-b.log`, `integration-b.log`, `board.txt`.


---

# R-81b PM 확인(좁게): R-81 뒤의 수정

- 확인한 사람: PM(w3:p1). 구현자가 아니다. 변경분을 읽고 판을 돌렸다.
- 판: `pm/unit-U-91` = `54a2c0c`(main `602da13` 위). R-81 이 본 `1409fa8` 뒤의 수정은 둘이다.
  - `e3444d2`: 점검이 잠금 아래에서, 끝난 점검이나 적용이 남긴 시험 링크 이름을 상태 디렉터리와 계획의 원본 폴더에서 찾아 지우고 그 수(`probesRemoved`)를 응답에 싣는다(R-81 L1).
  - `137bdb0`(PM 지시): 하드 링크 수가 2 이상인 보통 파일일 때만 지운다. 그 이름이 내용의 유일한 이름(nlink 1)이면 지우지 않고 `probesLeft`로 센다. 점검이 사람의 파일 내용을 없애지 않는다는 시험이 있다.
- 수치(판 `54a2c0c`): 타입 검사 통과, 유닛 2,924건 중 2,920 통과·0 실패, 통합 559건 통과, 비밀 검사 통과.
- 실제 CLI·실제 프로세스 종료로 다시 실험하지는 않았다. 유닛 시험으로 확인했다.
