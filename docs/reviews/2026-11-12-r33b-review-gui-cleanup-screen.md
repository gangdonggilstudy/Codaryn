# R-33b 확인: GUI 정리 화면과 GUI 시험 (w3:p4, 2026-11-12)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어(보안 검토). 읽기 전용이며 파일 수정·커밋은 없다.
- **고정 판: `pm/bundle-6c` = `39df2ba`**
  - `pm/bundle-6b` `d6b735a`에 이어진 판이다. main은 `23daf6b`다.
  - GUI 정리 화면 커밋: `90eae16`(GU-4, DR-39, DR-44), `417f2f9`(R-34b P-1)
- 읽은 곳(`git diff main...pm/bundle-6c -- gui` 중 정리 관련)
  - `gui/src/renderer/runs/cleanup-screen.ts`
  - `gui/src/main/cleanup-previews.ts`
  - `gui/src/main/ipc.ts`(`stateSummary`, `previewCleanup`, `applyCleanup`)
  - `gui/src/main/app.ts`(`confirmCleanup*`, `ask`)
  - `gui/src/main/dialog-texts.ts`, `gui/src/shared/cleanup.ts`
  - `gui/src/engine-host/cleanup.ts`, `gui/src/engine-host/host.ts`
  - `gui/src/preload/preload.cts`
- 사본: `.codaryn/r33b/b`(`git archive 39df2ba`)
  - 루트 `npm run build` 성공. 루트 `node_modules`는 내 작업 트리로 정션.
  - `gui/node_modules`는 이미 설치된 `.worktrees/claude-gui/gui/node_modules`(Electron)로 정션했다. 새로 내려받은 것은 없다.
- 실험: `.codaryn/r33b/gui-cleanup.mjs`, `gui-cleanup2.mjs`. 로그는 `gui-cleanup.log`, `gui-cleanup2.log`, `gui-cleanup2r.log`.
  - 진짜인 것: 주 프로세스의 `registerIpc`(gui build), 엔진 호스트의 `createHostHandler`(gui build), 앱 계층(`createCodarynApp`, dist)
  - 대신한 것은 둘뿐이다.
    - Electron의 `ipcMain`: 모듈 훅으로 바꿨다.
    - OS 대화상자의 답: 정해 둔 답을 썼다. 답을 묻는 문구는 `app.ts`와 같은 조각(`cleanupQuestions`, `dialogText`)으로 다시 만들어 기록했다.
  - 작업 공간은 실제 CLI의 대본 실행(주소 없음)과 정리 예제로 만들었다.
  - 화면 확인은 실제 `cleanupScreen`을 유닛 시험의 가짜 DOM에 그리고, 그 API를 위의 진짜 처리기로 이었다.

심각도: 높음, 중간(재현되는 결정 위반, 선행 조건 있음), 낮음, 정보.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 0 |
| 정보 | 4 (R33b-I1~I4) |

| 할 것 | 결과 |
| --- | --- |
| (1) GUI 시험 | **유닛 `npm test` 141건 중 141 통과**, 실패·건너뜀·todo 0. **연기 시험 두 번 모두 150건 중 150 통과**, 앱 종료 0 |
| (2a) 되돌리지 않은·일부만 되돌린·손상된 실행을 따로 묻는가 | **묻는다.** 세 가지를 한 질문으로 따로 묻는다: "Also remove the records of 5 runs that were not reverted, only partly, or whose records cannot be checked?", 기본은 남김. |
| | - 남기면 그 기록은 모두 `not_reverted_not_confirmed`로 남는다. |
| | - 그 계획 실행은 `used_by_kept_apply`로 남는다. |
| | - 첫 질문에서 "정리하지 않음"을 고르면 아무것도 지우지 않는다(`not_confirmed`) |
| (2b) 보관함을 남기면 되돌릴 수 없음을 알리는가 | **알린다.** 화면 계획과 첫 대화상자에 "If their discard boxes stay, a revert can no longer put those files back."가 나온다. 다만 그 상태를 만드는 셋째 대화상자의 "보관함은 남김"(기본) 옆에는 그 말이 없다(R33b-I1) |
| (2c) 일부만 지워진 것을 지웠다고 하는가 | **하지 않는다.** 지우기 거부 권한을 건 파일이 든 실행 폴더는 결과의 `kept`에 `partly_removed`로 나왔다. 화면의 "Removed" 수와 알림 수(6)에 들지 않았고, 따로 안내 줄이 붙었다. 다음 요약에 남은 폴더 1개로 보인다 |
| (2d) 확인 없이 지워지는 길 | **찾지 못했다.** |
| | - 두 번 연속 클릭: 버튼이 첫 클릭에 꺼지고, 대화상자는 한 번씩만 떴다. |
| | - 한 토큰으로 동시 두 번과 한 번 더: `not_confirmed`, `unknown_preview`, `unknown_preview`이고 대화상자는 한 번이었다. |
| | - 지어낸 토큰: `unknown_preview` |
| | - 대화상자 닫기·Esc: 세 대화상자 모두 `cancelId`가 기본값과 같은 "남김"(1)이고, 답이 0일 때만 진행한다(코드 확인. 실제 OS 대화상자는 띄우지 않았다). |
| | - 미리보기 뒤에 생긴 실행: 남았다. |
| | - 대화상자를 건너뛰는 갈고리(`answerDialog`)는 시험 진입점에만 있고, 제품 진입점(`gui/src/main/main.ts`)은 넘기지 않는다 |

## 2. 실험 결과

작업 공간의 실행(정리 예제의 작업 공간 하나)

| 이름 | 만든 법 | 요약의 상태 | 계획의 경고 |
| --- | --- | --- | --- |
| reverted1, reverted2 | 문서 실행 → 되돌리기 `complete` | reverted | 없음 |
| notReverted | 문서 실행 | run · done | `not_reverted` |
| partly | 파일 둘 → 하나를 사람이 고친 뒤 되돌리기 `partial` | partly reverted | `partly_reverted` |
| damaged | journal 전체를 깨진 한 줄로 | records cannot be checked | `not_reverted` |
| plan, apply | 정리 예제 계획 → 적용(폐기 1개) | apply · box | apply: `not_reverted`, `discarded_left`; 보관함: `people_files` |

정리(선택: 실행 기록 0일 이상, 보관함 0일 이상)

| 회차 | 답(계획 / 되돌리지 않은 것 / 보관함) | 물은 대화상자 | 결과 |
| --- | --- | --- | --- |
| R1 | 정리하지 않음 | 계획 | `not_confirmed`, 모두 남음 |
| R2 | 한 토큰으로 동시 두 번 + 한 번 더 | 계획(1번) | `not_confirmed`, `unknown_preview`, `unknown_preview` |
| R3 | 정리 / 남김 / 남김(reverted2에는 지우기 거부 권한) | 셋 다 | reverted1과 계획만 있던 실행이 지워졌다. 되돌리지 않은 5개(reverted2는 기록을 읽지 못해 여기에 듦)는 `not_reverted_not_confirmed`, plan은 `used_by_kept_apply`, 보관함은 `not_confirmed` |
| R4(화면) | 모두 지움, Clean 두 번 클릭 | 셋 다 한 번씩 | 지운 것 6(기록 5, 보관함 1). reverted2는 `partly_removed`로 kept에 들었고 안내 줄이 붙었다. 알림 "6 items were cleaned up." 다음 요약에 남은 폴더 1 |
| R5 | 정리 / 지움 / 남김(새 작업 공간: 적용 하나) | 셋 다 | apply·plan 기록 지움, 보관함 남음. 요약은 실행 0개, 보관함 1개(파일 1) |
| R6 | 남은 보관함만(보관함 0일 이상) | 계획, 보관함 | 계획에 그 보관함이 있다(`people_files`) |
| R7 | 미리보기 뒤에 문서 실행 하나를 만들고 모두 지움 | 계획, 보관함 | 새 실행은 남았다(미리보기 시각 기준) |
| R5′ | 적용을 되돌린(`complete`) 뒤 R5와 같게 | 계획, 보관함 | apply 경고는 `discarded_left`만 있고 되돌리지 않은 것 질문은 없었다. 보관함은 파일 0개로 남았다 |

## 3. 정보

- **R33b-I1 보관함을 남기는 선택 옆에는 그 결과가 적혀 있지 않다.**
  - "기록이 지워지고 보관함이 남으면 되돌리기로 되살릴 수 없다"는 말은 화면 계획과 첫 대화상자에만 있다.
  - 셋째 대화상자("Also delete … discard boxes?")의 설명은 지우면 영구히 사라진다는 것뿐이다. 그 기본값 "Keep the discard boxes"가 바로 그 상태를 만든다(R5).
  - 결과의 kept 줄도 `not_confirmed`라고만 한다.
  - 첫 대화상자에서 이미 알렸으므로 결함으로 보지는 않는다.
  - 셋째 대화상자 설명에 "남기면, 기록이 지워지는 적용 실행 n개의 파일은 되돌리기로 되살릴 수 없다"를 더하는 것을 권한다(GUI 담당).
- **R33b-I2 기록이 지워지고 남은 보관함은 화면에서 하나씩 고를 수 없다.** 선택 칸은 요약의 실행 줄마다 생기는데, 기록이 없으면 줄이 없다(R5 뒤 요약: 실행 0, 보관함 1). "보관함 n일 이상"으로는 고를 수 있다(R6).
- **R33b-I3 요약 목록은 되돌리지 않은 실행에 표시가 없다.** "reverted", "partly reverted", "records cannot be checked"만 붙는다. 되돌리지 않은 실행은 계획 목록의 경고(`not reverted`)로만 보인다.
- **R33b-I4 손상된 실행의 경고는 `not_reverted`로 나온다.**
  - store가 기록을 확인할 수 없는 실행에 `not_reverted`를 준다(`src/store/cleanup.ts:322-325`, R-34b P-1). 계약 함수 `cleanupRecordWarnings`는 같은 경우에 `records_unreadable`을 준다.
  - GUI의 질문은 store의 개수(`totals.runs.notReverted`)를 따르므로 묻는 데는 문제가 없다. 다만 계획 목록의 그 줄에는 "records cannot be checked"가 아니라 "not reverted"가 보인다.
  - 지우기 거부 권한을 건 reverted2도 기록을 읽지 못해 같은 길로 물어졌다(안전한 쪽).

## 4. 검사하지 않은 범위

- 실제 Electron 창에서 OS 대화상자를 띄워 Esc·닫기·창 닫기를 누르는 것. 코드는 세 대화상자 모두 `defaultId`와 `cancelId`가 "남김"(1)이고, 답이 0일 때만 진행한다.
  - 연기 시험은 `answerDialog`로 답한다.
- macOS·Linux
- 대화상자 문구의 한국어판(영어판만 기록에 남겼다. 한국어 카탈로그는 diff로 읽었다)

## 5. PM 판단 필요

- **Q-1(R33b-I1)**: 셋째 대화상자 설명에 남긴 보관함의 결과를 더할지.

사용자에게 물을 질문은 없다.
