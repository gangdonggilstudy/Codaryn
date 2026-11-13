# V-33 — 승인된 실행 계획의 수명 경로 통합 검증

- 검증자: codex-audit / 정확성·실패 경계 검증. 작성일: 2026-11-14 KST.
- 결과: **높음 0 / 중간 0 / 낮음 0**. 검증 범위에서 새 결함이나 base/head의 관찰 가능한 결과 차이를 발견하지 못했다.
- 대상: `pm/unit-C6i` = `e404dc19932bece66c265146e7401a9427fe61c7`.
- 실행 비교 base: `c51bac377bf9b7896131986d314152e2b12ae24a`. 이 base가 대상의 조상임을 확인했다.
- 이전 구현 기준: `36ef7873`의 `src/cli/run.ts`. 이 파일은 실행 비교 base의 같은 파일과 바이트 단위로 같다(SHA-256 `05e0f42102fd39ab774dfc3749c45452c43113c946076981d2c199c44d78027e`). 따라서 base CLI의 승인 계획 시험은 요청한 옛 분기를 실제로 실행한다.
- 작업 사본: `D:/project/Codaryn/.worktrees/codex-verify/.codaryn/v33/codex-audit-e404dc1`(이하 `R`). base/head는 각각 git archive로 추출했다. 이전 기준은 필요한 CLI 파일만 별도 archive로 추출했다. 저장소 소스·브랜치·커밋·다른 작업 폴더는 수정하지 않았다.

## 1. 판정 근거와 소스 위치

위치는 별도 표시가 없으면 head의 파일:줄이다.

| 확인 대상 | 결과 및 근거 |
|---|---|
| U-303의 승인 분기 | `src/app/run-life.ts:173`의 모델 준비 → runId·취소원 → assembly → 승인 부품 확인 → 잠금 아래 표지 재조회 → tally → 승인 엔진 → finish → 취소원 dispose 순서가 옛 CLI와 대응한다. `approvedDeps`, `watchingNotFound`, `headDiagnostic`, `withNotice` 네 함수는 옛 CLI의 본문과 바이트 단위로 같다. |
| U-300의 실제 전환 | `src/cli/run.ts:294`는 approved 유무와 관계없이 `runThroughApp` 한 번을 호출하고, `src/cli/run.ts:251`이 approved를 그대로 `runLife`에 전달한다. CLI의 별도 승인 실행 수명은 제거됐다. `src/cli/run.ts`만 변경됐으며 583줄에서 296줄이다. |
| 인터페이스 소유권 | `src/app/run-life.ts:59`가 앱 자체 `RunLifeEnvironment` 인터페이스이고 `src/cli/run.ts:72`가 이를 extends한다. approved 타입도 앱에 있으며 CLI는 type 재수출한다. 런타임 수명 구현의 이중 복사나 타입 변경에 따른 별도 실행 분기는 없다. |
| 사전 검사·승인 | `src/cli/plan-commands.ts:934`의 계획 로드·종류·이미 적용됨·기록 표지·원래 goal·승인 다이제스트 검사를 유지한다. `:979`부터 다이제스트/승인을 확인하고 `:1006`에서만 runPrepared로 넘긴다. 이 파일은 base/head가 같다. |
| 잠금·표지 재조회 | `src/app/run-life.ts:223`에서 assembly를 기다린 다음 `:246`에서 표지를 재조회한다. 예외는 표지가 있는 것으로 처리한다. `:251`에서 finish(null) 후 `plan_records_changed`로 끝난다. 실제 경계 주입 시험에서 claim·모델 요청·수행 실행의 기록 폴더 없이 잠금이 해제됐다. |
| stale·취소·claim 순서 | `src/engine/index.ts:1641`: 각 계획 파일의 현재 상태 → 취소 확인 → stale 판정 → 쓰기 정책 판정, 이후 다시 취소 확인 → `:1661`의 markApplied 한 번 → recordsUnchecked → 기준 상태 점검 → 모델 요청. 엔진 파일은 base/head가 같다. |
| claim의 배타성 | `src/store/plan.ts:395` → `src/store/common.ts:88`의 배타 생성. 실제 동시 CLI 적용 두 개 중 하나만 claim했고 다른 하나는 workspace_locked였다. 완료 후 같은 계획 재적용도 거부됐다. |
| 계획 밖 쓰기 | `src/app/run-life.ts:262`가 approved를 countingJournal에 넘긴다. `src/app/tally.ts:51`에서 approved가 있으면 deniedNotPlanned로 집계한다. 두 번의 계획 밖 쓰기 모두 거부됐고, 끝 요약에 정확히 2건으로 표시됐다. writablePaths를 넓히라는 잘못된 안내는 없었다. |
| 종료 처리 | `src/app/run-life.ts:280`의 finish(result)와 `:287`의 dispose를 유지한다. 일반 종료·stale·협조적 취소·검증 실패·claim 저장 실패에서 잠금이 남지 않았다. 잠금 해제 자체가 실패하는 경우의 lockLeft는 관련 유닛 시험으로 확인했다. 강제 프로세스 종료는 아래 별도 설명과 같다. |
| 앱의 applyPlan | `src/app/app.ts:925` → runApply → applyChangesPlan → runPrepared → runThroughApp → runLife. `src/app/app.ts:249`는 CLI writeProgress/ask/human을 주지 않는다. `src/cli/run.ts:246`은 CLI confirm이 없으면 기존 confirm을 덮어쓰지 않으며 `src/app/events.ts:110`의 빈 관찰자 경로는 기존 journal을 반환한다. 앱의 관찰자·권한 질문이 CLI 것으로 교체되거나 두 번 전달되는 경로를 찾지 못했다. |
| 앱 시작 게이트 | `src/app/app.ts:334`의 runApprovedPlan 래퍼가 앱 게이트를 기다린 뒤 엔진을 한 번 호출한다. runId 먼저 전달, 취소, 관찰자, lockLeft 관련 기존 시험을 head에서도 통과했다. |

U-303의 app/run-life는 base와 head에서 동일하다. plan-commands, engine, app assembly/app/assemble/tally/prepare/cancel/events, store plan/common/marks/state-guard의 13개 파일도 동일하다. 정적 검사 결과는 `R/static-evidence.json`에 있다.

수치 보충: CLI import의 **삭제된 바인딩은 36개(런타임 17, 타입 19), 추가된 타입 바인딩은 2개**여서 순감소가 34개다. 요청의 “34 imports”는 순감소 수와 일치한다. 빌드 후 남은 참조 누락은 없었다. 앱 run-life에는 기존 `../cli/provider.js` 런타임 import가 여전히 있으므로, 인터페이스 독립을 “모든 CLI import 제거”로 해석하지 않았다.

터미널 표시 준비는 이제 assembly 래퍼 안에서 하므로 잠금 아래 표지 검사보다 앞에 위치한다. 모델 404 안내 같은 종료 표시도 수명 밖으로 옮겨졌다. 따라서 **전체 문장·콜백의 실행 순서까지 바이트 단위로 같다는 판정은 아니다**. 승인·잠금·표지·stale·claim·모델 요청의 안전성 검사 순서는 유지되며, 아래 실행 범위의 stdout/stderr와 기록은 일치했다. 실제 API의 404는 실행하지 않았다.

## 2. 실제 CLI 비교 — 21개 시나리오, 90회 호출

양쪽 모두 실제 `node dist/src/cli/main.js`로 plan: run 계획을 새로 만들고, 그 계획의 다이제스트 앞 12자로 적용했다. 계획은 기존 `docs/guide.md` 수정과 새 `docs/new.md` 생성을 제안한다. 준비 실행은 양쪽 모두 plan_pending/exit 3이었다.

`R/compare-approved.mjs`가 시나리오별 기대 조건을 먼저 assert한 뒤 base/head를 비교한다. 비교 항목은 stdout, stderr, 종료 코드·signal, 모든 수행 기록의 journal.jsonl/result.json/applied.json, 표지 존재 여부, 남은 임시 기록 내용, lock.json, 작업 공간의 파일 경로와 내용이다. 서로 다른 사본에서 필연적으로 달라지는 절대 경로·runId·다이제스트·시각·기간·PID만 정규화했다. 오류 코드·문구·journal 순서·모델 요청 내용·승인 채널·파일 내용은 정규화하지 않았다. 원본 stdout/stderr도 보관했다.

| 시나리오 | 양쪽에서 확인한 결과 |
|---|---|
| 정상 + 계획 밖 쓰기 2회 + goal + 재적용 | verified/0, 승인 파일 두 개만 변경, 거부 2건·요약 2건. 첫 모델 요청은 계획 생성 실행의 원래 goal이고 계획 요약이나 apply 때 바꾼 goal이 아니다. 재적용은 plan_already_applied/2, applied 기록 불변. |
| 승인 없음 | plan_not_approved/2, assembly·claim·모델 요청·파일 변경 없음. |
| 다이제스트 불일치 | plan_not_approved/2, 위와 같음. |
| 승인 후 기존 파일 변경 | plan_stale/1, claim·모델 요청 없음, 외부 변경 보존, 잠금 해제. |
| 생성 예정 파일이 이미 생김 | plan_stale/1, claim·모델 요청 없음, 기존 파일 보존. |
| 적용 때 writablePaths 축소 | plan_stale/1, claim·모델 요청 없음. |
| 잠금 획득 직후 파일 변경 | plan_stale/1, claim·모델 요청 없음. |
| 적용 전 records-changed 표지 | plan_records_changed/2, 잠금 획득 전 거부. |
| 외부 사전 확인 뒤, 잠금 획득 직후 표지 삽입 | plan_records_changed/2, 잠금 아래 검사 문구 동일, claim·모델 요청·수행 실행 기록 없음, 잠금 해제. |
| 잠금 아래 표지 조회 EACCES | 표지가 있는 경우와 동일하게 plan_records_changed/2로 거부, 잠금 해제. |
| 시작 전 취소 파일 | cancelled/5, claim 없음, 모델 요청 0, 파일 변경 없음. |
| claim 직후 취소 | cancelled/5, claim 유지, 모델 요청 0, 파일 변경 없음, 잠금 해제. |
| 첫 파일 쓰기 직후 취소 | cancelled/5, claim 유지, 모델 요청 1, guide 수정은 남고 new 파일은 없음, 잠금 해제. |
| 모델 응답 대기 중 취소 | cancelled/5, claim 유지, 모델 요청 1, 파일 변경 없음, 잠금 해제. |
| 같은 계획 동시 적용 두 개 | 첫 프로세스를 잠금 직후 대기시킨 동안 둘째가 workspace_locked/6. 첫 프로세스만 verified/0, claim 성공 1회, applied.applyRunId는 승자의 실행 ID. |
| claim 직후 첫 모델 요청/쓰기 전 프로세스 강제 종료 | 두 쪽 모두 SIGKILL, 정상 종료 출력·result·run_finished 없음. applied와 stale 잠금 유지, 파일 쓰기 0. 재적용은 plan_already_applied/2. 아래 상세 참고. |
| 대본 JSON 문법 오류 | invalid_script/2, 잠금·claim·모델 요청 없음. |
| 대본 구조 오류 | invalid_script/2, 위와 같음. |
| 원래 goal을 읽을 model_request 기록 제거 | invalid_run_record/2, 잠금·claim·모델 요청 없음. |
| claim 뒤 검증기 실패 | verifier_failed/1, claim·수행한 파일 변경 유지, 잠금 해제. |
| claim 저장 EIO | plan_stale/1, claim 시도 1회·성공 0회, 모델 요청 0, 파일 변경 없음, 잠금 해제. |

각 성공한 claim의 추적에는 실제 lock 파일 존재가 확인된 `lockHeld: true`가 있다. 실제 동시 실행은 두 CLI 프로세스를 겹쳐 실행한 것이며, 순차 재적용 시험으로 대체하지 않았다.

경계 재현에는 `R/race-hook.mjs`를 `--import`로 넣었다. 이 파일은 감사 폴더 아래 자신의 작업 공간만 대상으로 fs의 lock/applied hard-link, 표지 lstat, 파일 rename 경계에 대기·오류·취소를 주입한다. 제품 소스는 수정하지 않았다. 모든 경우에 CLI 파싱, 승인, 실제 assembly, 엔진, 저장소 기록, 파일 쓰기는 제품 구현을 거쳤다.

## 3. claim 뒤 종료의 의미 — 기존 동작, 새 결함 아님

`src/engine/index.ts:1661`의 claim은 실행 성공 표시가 아니라 계획을 한 번 사용했다는 배타 기록이다. claim 뒤 취소·검증 실패에서도 applied.json은 남는다. 첫 파일을 쓴 다음 취소하면 이미 완료된 그 쓰기는 자동으로 되돌리지 않는다. 두 번째 파일은 쓰지 않았다.

강제 종료 시험은 applied.json의 배타 hard-link가 성공한 바로 뒤, 임시 파일 정리와 첫 모델 요청 전에서 자식 프로세스를 멈추고 종료했다. 양쪽 모두 다음이 남았다.

- 계획 실행의 applied.json과 작업 공간 lock.json. inspectLock 결과는 stale.
- apply 실행의 시작 기록. result.json과 run_finished는 없음.
- claim 저장용 임시 파일 한 개. 이 경계에서는 정리 finally도 실행되지 못한다.
- 작업 파일은 원본 그대로이며 모델 요청도 0회.
- 다시 apply하면 plan_already_applied/2. 잠금 해제나 재시도 가능성을 자동으로 약속하지 않는다.

즉 “모든 끝에서 잠금 해제”는 정상·오류·협조적 취소 경로에 관한 것이며, OS가 프로세스를 강제 종료한 경우까지 성립하지 않는다. 이 상태는 옛 분기와 새 분기에서 동일했다. 재현 명령은 아래 비교 실행에 시나리오 이름을 인자로 주면 된다.

## 4. 실행 명령과 수치

저장소 확인 및 diff:

```powershell
git -c safe.directory=D:/project/Codaryn rev-parse pm/unit-C6i
git -c safe.directory=D:/project/Codaryn merge-base --is-ancestor c51bac37 e404dc19932bece66c265146e7401a9427fe61c7
git -c safe.directory=D:/project/Codaryn diff 36ef7873 c51bac37 -- src/app/run-life.ts
git -c safe.directory=D:/project/Codaryn diff c51bac37 e404dc19932bece66c265146e7401a9427fe61c7 -- src
```

base/head archive 추출본 각각에서 `npm.cmd run build`: **둘 다 exit 0**. 기존 로컬 node_modules를 복사해 사용했으며 설치·다운로드하지 않았다. 빌드 로그는 `R/build-base.log`, `R/build-head.log`.

R에서 실행한 관련 시험 래퍼:

```powershell
node run-units.mjs base
node run-units.mjs head
node static-audit.mjs
node compare-approved.mjs
```

run-units는 격리한 환경과 자체 TEMP에서 다음 8개 파일만 `node --import <R/offline-guard.mjs> --test ...`로 실행한다.

```text
dist/tests/unit/app/u303-approved-life.test.js
dist/tests/unit/app/u293-run-life.test.js
dist/tests/unit/app/u218-run-plan-apply.test.js
dist/tests/unit/app/u229-finish-lock-left.test.js
dist/tests/unit/cli/g-u195-apply-run-plan.test.js
dist/tests/unit/cli/g-u195-v14-not-writable.test.js
dist/tests/unit/cli/u220-lock-left-cli.test.js
dist/tests/unit/engine/u187-approved-plan-run.test.js
```

| 실행 | 결과 |
|---|---|
| base 관련 유닛 | 15 suites, 62 tests, 62 pass, 0 fail/cancelled/skipped/todo; 3730.7778 ms; exit 0 |
| head 관련 유닛 | 15 suites, 62 tests, 62 pass, 0 fail/cancelled/skipped/todo; 3722.197 ms; exit 0 |
| 정적 동일성 검사 | exit 0; 4개 함수 본문·옛 CLI와 base·13개 공유 파일 동일성 확인 |
| 최종 실제 CLI 비교 | 21개 시나리오 pass, 0 fail, 총 90 CLI 호출(양쪽 각 45회) |

독립 재현 예:

```powershell
# R에서 실행. base와 head에 새 합성 작업 공간을 만들고 두 결과를 비교한다.
node compare-approved.mjs records-mark-under-lock
node compare-approved.mjs two-overlapping-applies
node compare-approved.mjs process-dies-after-claim-before-first-write
```

그 내부의 실제 호출 형태:

```text
node --import <R/race-hook.mjs> <board/dist/src/cli/main.js> run --task <task.json> --config <config.json>
node --import <R/race-hook.mjs> <board/dist/src/cli/main.js> apply --task <task.json> --config <config.json> --run <planRunId> --digest <앞 12자>
```

최종 증거 폴더는 `R/cases-2026-11-13T22-00-14-087Z`이다. `results.json`에 시나리오별 판정, `calls.json`에 원본 argv/stdout/stderr/exit/signal/추적, 각 시나리오의 `comparison.json`에 정규화한 양쪽 결과가 있다. 각 base/head/work 아래 실제 journal·result·applied·작업 파일도 보존했다. 요약 로그는 `R/compare-final.log`.

초기 pilot에서는 goal을 잘못된 run_started 필드에서 찾는 감사 스크립트 단언 한 건이 실패했다(15 pass/1 fail). 제품 기록 계약대로 첫 model_request의 user content를 검사하도록 감사 스크립트를 수정하고 최종 전체 비교를 다시 수행했다. 또한 import 삭제 수 34를 가정한 초기 정적 단언을 삭제 36/추가 2의 실제 수치로 바로잡았다. 이 두 초기 감사 도구 실패를 제품 통과 결과로 세지 않았다.

## 5. 실행하지 않은 범위와 작업 경계

실제 API, 외부 네트워크, 실제 키·키 파일, Electron, 전체 시험 묶음, 타 OS 시험은 실행하지 않았다. 시험 프로세스는 필요한 OS 실행 변수만 물려받고 사용자 설정 위치와 TEMP를 감사 폴더로 격리했다. offline-guard가 fetch 및 TCP/HTTP(S) 요청을 차단하며 이번 비교에는 로컬 서버도 필요하지 않았다. 권한 상승·한도·크레딧 요청은 하지 않았다.

실제 CLI 취소는 cancel-file로 검증했고 강제 종료는 감사자가 만든 자기 자식 프로세스만 종료했다. 실제 대화형 터미널 승인 입력, 실제 SIGINT/SIGTERM 전달, API 404 출력, 전원 단절·디스크 손상은 실행하지 않았다. 앱의 공개 함수 및 관찰자·승인·취소·lockLeft는 선택한 기존 유닛 시험과 정적 호출 경로로 확인했으며, 별도 GUI 연기 시험으로 기록하지 않는다.

종료 시 저장소 git status --short는 비어 있었다. 수정한 제품 파일, 커밋, push, worktree add는 없다. 관리자에게 필요한 새 결함 판단은 없다. 위 claim 이후 강제 종료·취소 상태는 기존 동작의 실측 결과로 남긴다.
