# R-47 병합 전 검토: 단위 U-13 보관함에 파일이 남은 적용 실행의 기록을 남긴다 (w3:p4, 2026-11-13)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어(보안 검토). 읽기 전용이며 파일 수정·커밋은 없다.
- **검토한 판: `pm/unit-U-13` = `950c272`**(main `a9a98fd` 위, 27개 파일 811줄). 비교판은 main `a9a98fd`.
  - 제품 코드: `src/store/cleanup.ts`, `src/contracts/cleanup.ts`, `src/contracts/human.ts`, `src/cli/cleanup.ts`, `src/app/cleanup.ts`, `src/i18n/*`, `gui/src/main/dialog-texts.ts`, `gui/src/renderer/runs/cleanup-screen.ts`, `gui/src/renderer/i18n/*`, `gui/src/shared/cleanup.ts`
- 사본: `.codaryn/r47/u`(`git archive 950c272`), `.codaryn/r47/m`(`git archive a9a98fd`). 둘 다 `npm run build` 성공. 검토 뒤 지웠다.
- 실험: `.codaryn/r47/r47.mjs`(A, B, C, D), `.codaryn/r47/gui-cleanup.mjs`. 로그는 `A.log`, `B.log`, `Bm.log`, `C.log`, `Du.log`, `Dm.log`, `gui-cleanup.log`, `gui-unit.log`, `smoke-1.log`.
  - 실제 CLI에 정리 예제(`examples/organize-demo`: 옮기기 2, 폐기 1)의 대본 실행을 줬다. 주소는 쓰지 않았다.
  - 경우마다 새 임시 작업 공간을 썼고 끝에 지웠다.
  - GUI는 메인 프로세스의 실제 처리기(`registerIpc`), 실제 엔진 호스트, 실제 앱 계층, 실제 정리 화면(가짜 DOM)을 실제 작업 공간에 붙이고, OS 대화상자의 답만 대본으로 줬다.

심각도: 높음, 중간(재현되는 결정 위반, 선행 조건 있음), 낮음, 정보.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 1 (R47-M1 기록을 확인할 수 없는 적용 실행은 건너뛰지 않는다) |
| 낮음 | 0 |
| 정보 | 5 (R47-I1~I5) |

| 볼 것 | 결과 |
| --- | --- |
| (1) UXM-1의 절차 | **고쳐졌다.** |
| | - `--confirm`과 `--include-not-reverted`만 주면 적용 실행과 그 계획 실행의 기록이 남는다(`discarded_left`, `used_by_kept_apply`). 보관함도 그대로다. |
| | - 그 뒤 `revert`는 `complete`였고, `inbox/old-draft.tmp`가 원래 이름과 자리에 원래 바이트로 돌아왔다. 보관함은 비었다. |
| | - 되돌린 뒤 같은 정리는 두 기록을 지웠다. |
| | - main은 같은 절차에서 두 기록을 지우고 보관함에 `2`를 남겼다. |
| (2) 건너뛰기를 빠져나가는 길 | **한 가지가 남았다**(R47-M1: 적용 실행의 기록을 확인할 수 없을 때). 나머지는 막혔다(4절). |
| | - 숨김·시스템 속성 파일, 하위 폴더 안의 파일, `Discarded`, 소문자 보관함 이름, 정션: 모두 남긴다 |
| | - 미리보기와 실제 사이에 보관함에 파일이 생김: `plan_changed`(종료 3)이거나 `discarded_left`로 남긴다 |
| | - 계획 실행만 고름: `plan_used_by_apply`로 막힌다 |
| | - 여러 적용이 한 계획을 쓰는 경우: 만들 수 없었다. 되돌린 뒤에도 같은 계획의 두 번째 apply는 `plan_already_applied`(종료 2)다 |
| (3) 요약·종료 코드·문구 | **말한다.** |
| | - 완료 출력: 지운 수 줄, "남겼습니다" 줄(몇 개, 왜, 지우는 두 방법), 항목별 이유 줄. 영어·한국어 |
| | - 종료 코드: 사람의 선택으로 남긴 것뿐이면 0, 보관함을 지우지 못해 남긴 경우(`io_error`)는 1 |
| | - 미리보기의 새 안내 줄은 한국어에서도 영어다(R47-I2) |
| (4) main과 같은지 | **글과 수는 같고, 순서가 다르다**(R47-I1). |
| | - `--delete-discarded`를 준 정상 경로: 지운 것과 합계가 같다. `removed`·`kept`의 항목 순서가 바뀌었다 |
| | - 보관함이 없는 실행의 정리, 보관함만 지우기, 틀린 다이제스트, 요약: 같다 |
| | - 의도된 차이: 경고 글, 미리보기의 새 안내 줄, 되돌려서 빈 보관함의 적용 실행에는 `discarded_left` 경고가 더는 없다 |
| (5) GUI | - **유닛 150건 중 150 통과, 연기 시험 155건 중 155 통과(한 번), 앱 종료 0** (`950c272`) |
| | - 셋째 대화상자에서 "보관함은 남김": **그 실행이 건너뛰어진다.** 내 하니스에서 `run:apply:discarded_left`, `run:plan:used_by_kept_apply`, 디스크에 둘 다 남음 |
| | - 연기 시험에는 이 경우가 없다(R47-I4) |

## 2. 중간

### R47-M1 기록을 확인할 수 없는 적용 실행은 건너뛰지 않아, 보관함의 파일이 주인 없이 남는다

- 위치: `src/store/cleanup.ts`의 `applyCleanupWith`. 건너뛰기 조건이 `itemFacts?.kind === "apply"`다. 기록을 확인할 수 없는 실행은 `kind`가 `null`이라 이 조건을 지나친다. 미리보기의 `discarded_left` 경고(`cleanupRecordWarnings`)도 같은 이유로 붙지 않는다.
- 재현(B10, `B.log`)
  1. 정리 예제를 적용만 한다. 보관함에 `2`가 있다.
  2. 적용 실행의 `journal.jsonl`을 읽을 수 없게 만든다(첫 줄을 JSON이 아닌 글로).
  3. `cleanup --older-than 0 --discarded-older-than 0 --confirm <digest> --include-not-reverted`

  | 판 | 미리보기 | 결과 | 디스크 |
  | --- | --- | --- | --- |
  | 단위 `950c272` | `run:apply[records_unreadable]`, `run:plan[]`, `discarded[people_files]` | 종료 0, 두 기록 지움, 남긴 것은 `discarded:not_confirmed`뿐 | 계획·적용 기록 없음, 보관함에 `2` |
  | main `a9a98fd` | 같음 | 같음 | 같음 |

- 영향
  - 끝 상태가 UXM-1과 같다. 사람의 파일이 번호 이름으로 남고, 원래 이름과 자리를 적은 것이 없다. 완료 출력은 "남겼습니다" 줄도 `discarded_left` 이유도 내지 않는다.
  - 그 적용 실행은 되돌리기가 이미 안 된다(`revert` 종료 2). 그래도 정리 전에는 멀쩡한 계획 실행의 기록에 원래 이름이 있었다. 정리가 그것까지 지웠다. 손상된 적용 실행은 `planRunId`를 모르므로 계획 실행을 붙잡지 못한다.
  - 선행 조건: 적용 실행의 기록이 손상돼 있고, 사람이 `--include-not-reverted`를 준다. 미리보기는 `records_unreadable`("마지막 사본도 지워질 수 있음")로 경고한다.
- 판단: DR-53의 글("보관함에 파일이 남아 있는 적용 실행의 기록은 … 지우지 않는다")에 어긋나고 재현되므로 중간으로 적었다. main에도 있던 틈이고 이 단위가 만든 것은 아니다.
- 권고(store 담당)
  - 건너뛰기 조건을 "적용 실행"이 아니라 "일반 실행으로 확인된 것이 아님"으로 넓힌다(`kind !== "run"`). 같은 id의 보관함에 파일이 있으면 남긴다.
  - 경고도 같은 조건으로 붙인다.
  - 계획 실행은 여전히 붙잡지 못한다. 손상된 적용 실행이 남을 때 그 작업 공간의 계획 실행을 어떻게 할지는 따로 정해야 한다(Q-1).

## 3. 정보

- **R47-I1 `removed`와 `kept`의 순서가 main과 다르다.** 보관함을 먼저 처리하게 되어, JSON 배열과 사람용 항목 줄에서 보관함이 실행 기록보다 앞에 온다. 개수, 크기, 합계, 종료 코드는 같다. 순서에 기대는 소비자가 있으면 영향이 있다.
- **R47-I2 미리보기의 새 안내 줄은 영어 고정 글이다.** "The records of N apply run(s) whose discarded files are still kept stay unless …"가 한국어 출력에도 영어로 나온다. 옆의 확인 방법 안내 줄들도 영어라 지금 방식과는 맞다(계약 문서에 적힌 한계, UXM-7). 항목의 경고 글과 완료 출력은 두 언어다.
- **R47-I3 정리가 보관함을 보지 못해도 실제 정리는 남긴다. 다만 미리보기는 경고하지 않는다.**
  - 보관함 폴더 이름이 소문자이거나, 보관함 또는 `discarded` 폴더가 정션이면 미리보기에 `discarded_left` 경고와 보관함 항목이 없다.
  - 실제 정리는 지우기 직전에 다시 보고 `discarded_left`로 남긴다. 안전한 쪽이다.
  - 반대로 보관함에 파일이 없고 정션만 있으면(B9) 파일이 없는 것으로 세어 기록을 지운다. 적용이 만드는 상태가 아니라 사람이 만든 상태다.
- **R47-I4 연기 시험에 "보관함은 남김"의 경우가 없다.** 연기 시험의 정리 확인은 되돌리지 않은 실행을 남기는 경우(`not_reverted_not_confirmed`)와 일반 실행 하나를 지우는 경우다. 대화상자도 첫째·둘째만 뜬다. 셋째 대화상자의 경로는 유닛 시험(`u13-cleanup.test.ts`)과 내 하니스로만 봤다.
- **R47-I5 문구의 작은 것**
  - 모두 남긴 정리의 첫 줄은 "지웠습니다: 실행 기록 0개 …"이고 종료 0이다. 바로 아래 줄이 이유를 말한다.
  - GUI 영어 글 "1 apply runs". 수에 따른 꼴이 없다.
  - GUI 한국어 글에 "보관함"과 "폐기 보관함"이 한 대화상자 안에 섞여 있다(UXM-16).
  - 요약만 보는 `cleanup`은 보관함에 파일이 있는 적용 실행을 따로 말하지 않는다. 이제 기록이 남으므로 필요가 줄었다.

## 4. 실험 표

**UXM-1의 절차**(A, 두 언어에서 같음)

| 단계 | 결과 |
| --- | --- |
| 적용 뒤 | 보관함 `2`, `inbox` 빔 |
| 미리보기 | `run:apply[not_reverted,discarded_left]`, `run:plan[]`, `discarded:apply[people_files]`, 새 안내 줄 |
| `--confirm … --include-not-reverted` | 종료 0, 지운 것 0, 남긴 것 셋(`not_confirmed`, `discarded_left`, `used_by_kept_apply`) |
| `runs` | 두 실행이 그대로 보임 |
| 보관함을 고르지 않고 `--older-than 0`만 | 같음(남긴 것 둘) |
| `revert` | `complete`, 종료 0. `inbox`에 세 파일, `old-draft.tmp`의 바이트가 원본과 같음, 보관함 빔 |
| 되돌린 뒤 같은 정리 | 두 기록 지움 |

**빠져나가는 길**(B, C. 모두 `--include-not-reverted`를 주고 `--delete-discarded`는 주지 않음)

| 경우 | 미리보기의 경고 | 실제 정리 | 기록 |
| --- | --- | --- | --- |
| B1 보관함의 파일에 숨김·시스템 속성 | 있음 | `discarded_left` | 남음 |
| B2 파일을 하위 폴더로 옮김 | 있음 | `discarded_left` | 남음 |
| B3 `discarded` → `Discarded` | 있음 | `discarded_left` | 남음 |
| B4 보관함 폴더 이름을 소문자로 | 없음 | `discarded_left` | 남음 |
| B5 보관함이 정션 | 없음 | `discarded_left` | 남음 |
| B6 `discarded`가 정션 | 없음 | `discarded_left` | 남음 |
| B7 사람이 보관함을 비움 | 없음 | 지움 | 없음(잃을 파일 없음) |
| B8 빈 하위 폴더만 | 없음 | 지움 | 없음(잃을 파일 없음) |
| B9 파일 대신 정션만 | 없음 | 지움 | 없음(R47-I3) |
| **B10 적용 실행의 journal 손상** | `records_unreadable`만 | **지움** | **없음, 보관함에 `2`**(R47-M1) |
| B11 적용 실행의 `result.json` 없음 | 항목 없음 | `no_result`로 막힘 | 남음 |
| C1 되돌린 적용, 미리보기 뒤 보관함에 파일 생김 | | `plan_changed`, 종료 3 | 남음 |
| C2 보관함도 고르고 `--delete-discarded`, 미리보기 뒤 파일 더함 | | `plan_changed`, 종료 3 | 남음 |
| C3 보관함을 고르지 않음, 미리보기 뒤 파일 더함 | 있음 | `discarded_left` | 남음 |
| C4 계획 실행만 고름 | | `plan_used_by_apply`로 막힘 | 남음 |
| C4b 계획과 적용을 id로 고름 | 있음 | `discarded_left`, `used_by_kept_apply` | 남음 |
| C4d `--delete-discarded`를 줬지만 보관함을 고르지 않음 | 있음 | `discarded_left` | 남음 |
| C5 같은 계획을 되돌린 뒤 다시 apply | | `plan_already_applied`, 종료 2 | |
| C6 일부만 되돌려 보관함에 파일이 남음 | `partly_reverted`, `discarded_left` | `discarded_left` | 남음 |
| C7 `--delete-discarded`, 보관함의 파일을 다른 손이 열고 있음 | 있음 | 보관함 `io_error`, 적용 `discarded_left`, 종료 1 | 남음, 보관함 그대로 |
| C9 두 적용 중 하나만 되돌림 | 되돌리지 않은 쪽만 | 되돌린 쪽과 그 계획만 지움 | 되돌리지 않은 쪽과 그 계획 남음 |

- C4e(`--reverted`와 보관함 선택, `--delete-discarded`): 보관함만 지우고 기록은 남는다. main과 같고, 사람이 확인한 삭제다.

**main과 같은지**(D, 두 언어 × 사람용·JSON, 실행 id·다이제스트·시각만 치환)

| 경우 | 차이 |
| --- | --- |
| D1 요약 | 없음 |
| D1 미리보기(보관함 있는 적용) | 경고 글이 바뀜, 안내 줄 하나 더함(의도) |
| D1 `--delete-discarded`까지 준 정리 | `removed`의 순서(보관함이 앞). 지운 것·합계·종료 코드 같음 |
| D1 정리 뒤 요약 | 없음 |
| D2 미리보기(일반 실행 둘, 되돌린 적용) | 되돌린 적용의 `discarded_left` 경고가 없어짐(의도: 빈 보관함) |
| D2 정리(`--include-not-reverted` 없이) | `kept`의 순서(보관함이 앞) |
| D2 정리(`--include-not-reverted`) | 없음 |
| D3 보관함만 미리보기·정리 | 없음 |
| D4 틀린 다이제스트 | 없음 |

**GUI**(`gui-cleanup.log`)

| 경우 | 물은 대화상자 | 결과 | 디스크 |
| --- | --- | --- | --- |
| G1 한국어 화면: 정리 예, 되돌리지 않은 것 예, **보관함은 남김** | 셋 | 지운 것 0. 남긴 것: 보관함 `not_confirmed`, 적용 `discarded_left`, 계획 `used_by_kept_apply`. 결과 화면에 이유 글과 안내 줄 | 둘 다 남음, 보관함 `2` |
| G2 영어 화면: 같은 답 | 셋 | 같음(영어 글) | 같음 |
| G3 CLI로 되돌림 | | `complete`, `inbox`에 세 파일 | |
| G4 되돌린 뒤: 정리 예, 보관함은 남김 | 둘(첫째, 셋째) | 두 기록 지움 | 기록 없음 |

- 셋째 대화상자의 설명 글(두 언어)은 "남기면 그 적용 실행의 기록도 남긴다"고 말한다. 기본 단추는 "보관함은 남김"이다.
- 코드: 대화상자의 답은 `confirmation.discarded`로만 가고(`gui/src/main/app.ts:319-325`), 건너뛰기는 store가 정한다. GUI에 따로 든 판단은 없다.

## 5. 검사하지 않은 범위

- 실제 Electron 창에서 셋째 대화상자를 누르는 것. OS 대화상자의 답은 대본이었다.
- 루트 유닛·통합 시험 재실행(PM이 이 판에서 잰 수치를 받았다)
- 보관함 지우기가 중간에 실패해 `partly_removed`가 되는 경우. 유닛 시험(`u13-cleanup-discarded-left.test.ts`)이 다루고, 실제 CLI로는 옮기기 실패(`io_error`)만 일으켰다.
- 대소문자를 가리는 파일 시스템, macOS·Linux

## 6. PM 판단 필요

- **Q-1(R47-M1)**: 기록을 확인할 수 없는 실행에 딸린 보관함도 같은 규칙으로 남길지. 남긴다면 그 작업 공간의 계획 실행(어느 것이 그 적용의 계획인지 알 수 없다)을 어떻게 할지.

사용자에게 물을 질문은 없다.
