# R-9 교차 검토 보고서: G-E 저장·되돌리기 (계획 기록, 적용 기록, 사람 확인, 보관함, 이동·폐기 되돌리기)

## 0. 이해 확인과 대상

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 읽기 전용이며 구현자가 아니다.
- worktree: `D:\project\Codaryn\.worktrees\claude-store`
  - 시작 때 main을 병합했다(`d6e10f5`).
  - 검토 중 PM 공지로 한 번 더 병합했다(`5521f85`). 두 병합 모두 작성자 확인, trailer 없음.
  - 저장소 파일 수정·커밋은 없다(병합 커밋 외).
- **검토 대상(고정)**: `claude/core-tools` = `6b27798`
  - G-E 커밋: `292f8d3`(계획 저장·불러오기·적용 표시), `2a94a44`(review.json), `2275948`(적용 기록 목록과 보관함), `3b0c997`(적용 되돌리기), `6d3943d`(DR-14 원본 내보내기)
  - 모두 작성자 `gangdonggil <gangdonggilstudy@gmail.com>`, trailer 없음
- 기준: `docs/design/general-tasks.md` 6절, DR-5, DR-9, DR-12(DR-18 (b), DR-21 포함), G-A 계약(`src/contracts/plan.ts`, `changes.ts`)
- 실험
  - `git archive` 빌드 사본(`.codaryn/r9/ct`)과 그 아래 임시 작업 공간에서만 했다. 가짜 자료만 썼다.
  - 실제 API, 외부 네트워크, 키 파일은 쓰지 않았다.
- 빌드 사본 상태
  - typecheck 오류 2건: `src/i18n/en.ts:146`, `ko.ts:145`의 `doctor.file.unreadable`. G-E 밖이다.
  - store 유닛 79건 중 79 통과

심각도: 높음(지금 데이터를 잃거나 경계를 넘음, 선행 조건 없음), 중간(재현되는 경계 위반이나 확정 결정과의 충돌, 선행 조건 있음), 낮음, 정보.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 3 (M-1~M-3) |
| 낮음 | 3 (L-1~L-3) |
| 정보 | 5 (I-1~I-5) |

**중점 항목 확인(재현)**

| 항목 | 결과 |
| --- | --- |
| plan.json에 정책·검증기 사본이 없음(DR-5) | 지켜짐. 키는 정확히 `schemaVersion`, `kind`, `runId`, `actions`이고 행동도 키가 정확하다. `policy` 키를 더한 plan.json은 `invalid_run_record`다 |
| 다이제스트 = 파일 바이트 | 지켜짐. `savePlan`의 반환 = 쓴 바이트의 SHA-256. 다이제스트 뒤에 고친 plan.json은 `invalid_run_record`다 |
| applied.json 배타 생성 | 지켜짐. 동시 12회 중 `marked` 1, `already_applied` 11. 손상된 applied.json이면 불러오기 `invalid_run_record`, 표시 `already_applied`다 |
| 보관함이 실행 디렉터리 밖(DR-9) | 지켜짐. 위치는 `.codaryn/discarded/<runId>`이고, `discarded`가 정션이면 거부한다 |
| 원래 자리에 다른 파일이 있으면 덮어쓰지 않음 | 지켜짐(재현). `original_path_taken`이고 두 파일 내용 그대로다. 다만 하드 링크 실패 때의 대체 경로는 M-2 |
| 링크·작업 공간 밖 경로 | 아래 M-1, L-2(재현)의 빈틈. `.codaryn` 자체의 정션은 `isPlainDirectory`의 실경로 비교로 막힌다 |
| 손상·위조 기록 | 다른 실행의 기록이 섞이면 아무것도 바꾸지 않고 `invalid_run_record`다. 별칭 경로 기록은 작업 공간이 거부해 실행되지 않는다(L-1) |

## 2. 중간

### M-1 보관함 저장 이름의 디렉터리 부분을 따라가, 되돌리기가 작업 공간 밖 파일을 옮기고 원래 자리에서 지운다

- 위치(`src/store/apply-revert.ts`)
  - `:42-43`: `STORED_SEGMENT`. `:74-78`의 `stored()`는 `/`로 나뉜 최대 8조각을 허용한다.
  - `:251`: `join(discarded, ...storedName.split("/"))`
  - `:163-170`: `stateOf`가 마지막 조각만 `lstat`한다.
  - `:261`, `:185-213`: `moveWithoutReplacing`이 하드 링크를 만든 뒤 원본을 `rm`한다.
- 계약(`src/contracts/plan.ts`의 `PlanExecutor.apply`)은 "a discard renames the file into the run's discarded directory under a name built from `index` only"다. 한 조각이면 충분하다.
- 재현(`.codaryn/r9/exp9.mjs` R5)
  1. 보관함 `.codaryn/discarded/<적용 runId>/` 안에 정션 `sub` → 작업 공간 밖 폴더를 만든다. 그 폴더에 `precious.doc`이 있다.
  2. 적용 기록의 `file_discarded`를 `stored: "sub/precious.doc"`, `sha256` = 그 파일의 해시로 쓴다.
  3. `revertRun` → `restored_from_discard`. 밖의 `precious.doc`이 **없어지고** 작업 공간에 `b.txt`로 생겼다(`outsideFileStillThere: false`).
- 선행 조건: 상태 디렉터리에 쓸 수 있어야 하고(허용 명령, T-11), 밖 파일의 해시를 알아야 한다.
- 결과: 사용자가 실행한 `revert`가 작업 공간 밖 파일을 지운다. "작업 공간 밖은 건드리지 않는다"는 경계를 되돌리기가 넘는다.
- 권고
  - `stored`를 한 조각(예: `^[0-9]{1,6}$`)으로 좁힌다.
  - 또는 `realpath(dirname(source))`가 `discardedRoot`와 같은지 확인한 뒤에만 읽고 옮긴다.

### M-2 하드 링크가 실패하면 "확인 후 rename"으로 넘어가, 덮어쓰지 않음과 DR-18 (b)·DR-21을 지키지 못한다

- 위치: `src/store/apply-revert.ts:185-213`(`moveWithoutReplacing`)
  - `link`가 `EPERM`, `EXDEV`, `ENOTSUP`, `EOPNOTSUPP`, `ENOSYS`, `EMLINK`로 실패하면 `stateOf(target)`가 `absent`인지 본 뒤 `fs.rename`한다.
  - `rename`은 Windows와 POSIX 모두 이미 있는 대상을 **대신한다**. 확인과 rename 사이에 대상이 생기면 그 파일을 덮어쓴다(시간 창이 있다).
- 결정과의 충돌
  - DR-18 (b): "하드 링크를 쓸 수 없는 볼륨에서는 덮어쓸 위험이 있는 이동을 하지 않고 별도 문제 코드로 멈춘다"
  - DR-21(사용자 확정): "기본으로 옮기지 않는다. … 사용자가 그 적용에 한해 따로 동의한 경우에만 옮긴다"
  - 되돌리기도 이동이다. 동의 확인이나 문제 코드 없이 rename으로 간다.
  - `EPERM`은 NTFS에서 다른 이유(접근 거부 등)로도 나와, 하드 링크를 쓸 수 있는 볼륨에서도 대체 경로로 갈 수 있다 [추정].
- 재현: 하지 않았다. 하드 링크가 실패하는 볼륨(FAT32·exFAT 등)이 없다. 코드 근거다.
- 권고: `EEXIST` 밖의 링크 실패는 건너뜀 사유(새 코드 또는 `io_error`)로 끝낸다. DR-21의 동의가 있는 경우만 옮기도록 G-C 적용기와 같은 규칙을 쓴다.

### M-3 계획 저장과 적용 표시가 하드 링크에 기대어, 하드 링크 없는 드라이브에서는 DR-21의 동의 경로에 닿지 못한다

- 위치: `src/store/common.ts`의 `createExclusive`(임시 파일을 쓰고 `link(temporary, target)`). `EEXIST` 밖의 실패는 reject다.
  - `savePlan`(`src/store/plan.ts:117`)과 `markPlanApplied`(`:236`)가 쓴다.
- 결과: 하드 링크를 지원하지 않는 볼륨에서는 `propose_plan`이 계획을 저장하지 못하고(`io_error`) 적용 표시도 못 한다 [추정, 그런 볼륨에서 재현 안 함]. 그래서 DR-21의 "적용 전 점검에서 위험을 알리고 동의를 받는" 단계까지 가지 못한다.
- 권고: 링크가 지원되지 않으면 `writeFile(target, data, { flag: "wx" })`(배타 생성)로 대신한다.
  - 독자가 덜 쓴 파일을 볼 수 있지만, `loadPlan`은 다이제스트를 대조하므로 그때는 `invalid_run_record`로 안전하게 실패한다.
  - applied.json은 존재만으로 효력이 있으니 배타 생성으로 충분하다.

## 3. 낮음

### L-1 저장 기록의 경로 검사가 작업 공간 규칙보다 느슨하다

- `src/store/plan.ts:60-66`의 `isWorkspaceRelativePath`가 받아들이는 것(R7): `.codaryn./x`, `.codaryn /x`(Windows에서 `.codaryn`의 별칭), `a.txt:hidden`(대체 데이터 스트림), `NUL`
- `loadPlan`은 이런 행동이 든 plan.json을 정상으로 읽는다(P2: `ok`).
- `Workspace.resolve`는 모두 `invalid_path`로 거부한다. 그래서 되돌리기(`resolved()`, R6: `changed_since_run`, 상태 디렉터리에 쓰지 않음)와 적용 사전 점검(정책 게이트)에서는 실행되지 않는다.
- 권고: 기록 검증도 작업 공간의 경로 규칙(`src/workspace/lexical.ts`)을 함께 쓰게 한다.

### L-2 DR-14 원본 내보내기가 `snapshots` 디렉터리의 정션을 따라가 밖 파일 내용을 돌려준다

- 위치: `src/store/changes.ts`의 `readRunOriginals`
  - 실행 디렉터리만 `isPlainDirectory`로 본다.
  - `loadSnapshots`(`:282-291`)와 `originalText`는 `runs/<id>/snapshots`가 링크인지 보지 않는다.
- 재현: `snapshots`를 밖 폴더로 가는 정션으로 바꾸고, 기록의 `previousHash`를 밖 파일의 해시로 쓴다. 결과는 `[{"path":"doc.txt","original":{"text":"OUTSIDE FILE CONTENT"}}]`이다.
- 앱 계층은 이를 지금의 비밀로 가려 비교 화면에 보인다. 선행 조건은 M-1과 같다(상태 디렉터리 쓰기, 해시).
- `revertRun`(모델 실행)도 같은 `loadSnapshots`를 쓴다(기존 코드).
- 권고: `snapshots` 디렉터리도 `isPlainDirectory`로 확인한다.

### L-3 적용 되돌리기가 plan.json의 다이제스트를 확인하지 않고 경로를 그 파일에서 가져온다

- 위치: `src/store/apply-revert.ts:131-144`(`planActions`), `:151-158`(`realPaths`)
  - 행동 번호, 종류, 해시가 맞으면 plan.json의 경로를 쓴다. plan.json 바이트의 다이제스트는 대조하지 않는다.
  - `loadPlan`은 대조한다.
- 적용 기록의 첫 줄 `apply_started.digest`에 승인된 다이제스트가 있으므로 대조할 수 있다.
- 영향은 작다. 경로는 작업 공간 규칙을 지나고, 덮어쓰지 않는다.
- 권고: `sha256(plan.json) === apply_started.digest`일 때만 plan.json 경로를 쓴다.

## 4. 정보

- **I-1 문제 없던 범위(재현)**
  - `savePlan`: 정책 키가 든 행동은 TypeError로 거부하고, 두 번째 저장은 거부하며 파일은 그대로다.
  - 불러오기: 결과의 상태가 `plan_pending`이 아니면 `run_not_plan`이다.
  - 되돌리기
    - 정상 경로(`moved_back`, `restored_from_discard`), 미리보기 무변경, 두 번째 되돌리기 `already_reverted`
    - 바뀐 파일 `changed_since_run`, 원래 자리 점유 `original_path_taken`(덮어쓰기 없음)
    - 다른 실행 id 기록이 섞이면 아무것도 바꾸지 않고 `invalid_run_record`
  - `discarded` 정션은 거부한다. `.codaryn` 정션은 실경로 비교로 막힌다(코드 확인).
  - 적용 실행 목록: 첫 기록 `apply_started`의 필드와 `ApplyResult`의 계획·다이제스트 대조를 코드로 확인했다(`2275948`).
- **I-2** 손상된 applied.json이 있으면 그 계획은 다시 적용할 수 없고 복구 안내도 없다. 보수적인 쪽이라 문제로 보지 않는다.
- **I-3** 8.3 짧은 이름 별칭(`CODARY~1`): 이 볼륨에서는 `.codaryn`의 짧은 이름이 만들어지지 않아 확인하지 못했다. 짧은 이름이 켜진 볼륨에서 `Workspace.resolve`와 기록 검증을 볼 필요가 있다.
- **I-4** 적용기가 파일을 옮긴 직후 `file_moved`를 기록하기 전에 프로세스가 죽으면, 그 항목은 되돌리기 대상에서 빠진다 [추정, 엔진 순서 미확인]. 한계로 문서화가 필요한지 G-B·G-H에 묻는다.
- **I-5 절차 메모(내 이전 작업)**
  - G-D 커밋 `47847a2`와 N-D 2차 커밋 `2e98789`는 검사(`diff --cached --check`, `check-secrets --staged`)와 `git commit`을 한 명령으로 묶어 만들었다. 비밀 검사 단계는 실패해도 커밋을 막지 못하는 형태였다.
  - 두 검사 모두 출력에서 통과(`diff-check ok`, `check-secrets: no findings`)를 확인했으므로 커밋 내용은 그대로다. 7절 새 지침에 따라 이후에는 검사 결과를 읽은 뒤 따로 커밋한다.
  - 이미 보고한 커밋이므로 고치지 않는다.

## 5. 검사하지 않은 범위

- 하드 링크가 실패하는 볼륨(FAT32, exFAT, 일부 네트워크 드라이브)에서의 실제 동작(M-2, M-3)
- G-C 적용기(`PlanExecutor`)와 G-B 엔진의 적용 순서. 이 브랜치에 없거나 이번 범위 밖이다.
- CLI 연결(`plan`, `apply`, `review` 명령)
- macOS·Linux

## 6. PM 판단 필요

- **P-1(M-1)**: 보관함 저장 이름을 한 조각으로 좁힐지(계약 문구와 맞음). 또는 실경로 확인으로 할지.
- **P-2(M-2, M-3)**: 하드 링크가 없는 볼륨에서 되돌리기와 계획 저장이 DR-21을 어떻게 따를지
  - 되돌리기: 건너뜀 사유로 멈춤 또는 동의
  - 계획 저장: 배타 생성으로 대체

사용자에게 물을 질문은 없다.

## 7. 실행한 것

- 읽기: `git show`로 G-E 다섯 커밋의 변경, `src/store/{plan,review,discarded,apply-revert,common,changes,runs}.ts`
- 빌드: 고정 커밋의 `git archive` 사본
- 시험: store 유닛 79건
- 실험: `.codaryn/r9/exp9.mjs`(P1, P2, D1, R1~R7)와 `snapshots` 정션 확인 스크립트
- 저장소 파일 변경과 커밋 없음(main 병합 커밋 외). 실제 API 미실행.
