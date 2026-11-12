# R-44 병합 전 검토: 단위 U-8 "확인하지 못함" 알림 (w3:p4, 2026-11-12)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어(보안 검토). 읽기 전용이며 파일 수정·커밋은 없다.
- **검토한 판: `pm/unit-U-8` = `c023719`**(main `d6a1e6d` 위, 13개 파일 319줄). 비교판은 main `d6a1e6d`.
  - 제품 코드: `src/engine/apply.ts`, `src/contracts/plan.ts`, `src/contracts/human.ts`, `src/cli/human/output.ts`, `src/cli/report.ts`, `src/i18n/en.ts`, `src/i18n/ko.ts`
- 사본: `.codaryn/r44/u`(`git archive c023719`), `.codaryn/r44/m`(`git archive d6a1e6d`). 둘 다 `npm run build` 성공.
- 실험: `.codaryn/r44/r44.mjs`(N, X, Y, S). 로그는 `N.log`, `X.log`, `Y.log`, `Y3.log`, `S.log`.
  - 실제 CLI에 대본(scripted) 실행과 정리 예제(`examples/organize-demo`)를 줬다. 주소는 쓰지 않았다.
  - 상한 넘기기: 앞선 실행의 폴더에 빈 파일 20,500개를 만들었다. 그러면 뒤에 만든 계획 실행의 기록은 감시기가 끊는 자리 뒤에 놓인다.
  - main과의 비교는 판마다 새 작업 공간에서 했다. 실행 id, 시각, 소요 시간, 임시 폴더 이름, 해시만 치환했다.

심각도: 높음, 중간(재현되는 결정 위반, 선행 조건 있음), 낮음, 정보.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 1 (R44-L1 앞선 실행이 확인하지 못한 것은 apply가 알리지 않는다) |
| 정보 | 4 (R44-I1~I4) |

| 볼 것 | 결과 |
| --- | --- |
| (1) 상한을 넘는 작업 공간에서 알리는지 | **알린다.** |
| | - apply의 JSON: `notices`에 고정 글 한 줄, `noticeKinds: ["plan_records_unchecked"]` |
| | - apply의 사람용 출력: 요약에 `apply.notice.plan_records_unchecked` 한 줄(영어·한국어) |
| | - 실행·계획 실행·apply의 사람용 진행 줄: `progress.state_unchecked`(영어·한국어) |
| | - 알림 글에 경로, 실행 id, 개수가 없다 |
| | - 정리 안내: apply의 JSON 알림과 사람용 요약 줄에 `cleanup`이 있다. 진행 줄에는 없다(R44-I2) |
| | - apply는 거부되지 않았고(`done`/`verified`), 그 되돌리기도 `complete`였다 |
| | - main은 같은 입력에서 아무 말도 하지 않았다(고침이 맞다) |
| (2) 나와야 하는데 안 나오는 경우 | - 계획 실행은 확인됐고 apply 때 상한을 넘음: **알린다** |
| | - apply 도중에 상한을 넘음(시작 19,999항목): **알린다**(`before_verify`부터 `limited`) |
| | - 실행의 명령이 상한을 넘김: 알림이 아니라 `failed`/`state_changed`로 멈춘다(더 안전한 쪽) |
| | - **계획 실행이나 그 사이의 실행이 확인하지 못했고 apply 때는 상한 아래: 알리지 않는다**(R44-L1) |
| (3) 확인된 평범한 실행·apply가 main과 같은지 | **같다.** 열한 가지 출력 × 두 언어에서 stdout(JSON)과 stderr(사람용)가 모두 같다(4절) |
| (4) 앱 계층·GUI가 받는지(코드) | **받는다.** |
| | - 앱 계층의 `applyPlan`은 CLI의 apply 명령 경로를 그대로 써서 `ApplyResult`를 돌려준다(`src/app/app.ts:635-690`). `notices`와 `noticeKinds`가 그대로 들어 있다. |
| | - GUI 엔진 호스트는 결과의 `notices`를 창에 넘기고(`gui/src/engine-host/runs.ts:89, 143-147`), 실행 화면이 "안내" 목록으로 그린다(`gui/src/renderer/run/run-screen.ts:194-197`). |
| | - GUI의 진행 항목은 엔진의 사람용 렌더러를 쓴다(`gui/src/engine-host/main.ts:86-92, 225`). 그래서 `state_checked` 줄도 이 단위로 함께 나온다. |
| | - 다만 GUI의 알림 글은 영어 고정 글이다(R44-I3). GUI는 돌려 보지 않았다 |

## 2. 낮음

### R44-L1 앞선 실행이 확인하지 못한 것은 apply가 알리지 않는다

- 위치: `src/engine/apply.ts`의 `checkState`. 알림은 apply 자신의 점검이 `limited`일 때만 붙는다(계약 `src/contracts/plan.ts`의 `plan_records_unchecked` 설명도 같다).
- 재현(Y, `Y.log`)

  | 경우 | 사이의 실행 | 계획 실행의 표시 | 뒤의 apply |
  | --- | --- | --- | --- |
  | Y2: 상한 아래 | 명령이 계획 실행 폴더에 파일을 더함 → `failed`/`state_changed` | 붙음 | `plan_records_changed`로 거부(종료 2) |
  | **Y1: 상한 위, 그 뒤 더미를 지움** | 같은 명령 → `done`/`verified`, 네 점검 모두 `limited` | **없음** | **`done`/`verified`, 알림 없음** |

  - X2도 같다: 계획 실행 자신이 `limited`였고 apply 전에 더미를 지우면 apply는 알림이 없다.
- 영향
  - 알림의 뜻은 "계획 실행의 기록이 표시 없이 바뀌었을 수 있고 U-1이 거부하지 못했다"이다. 그 일은 apply 중이 아니라 계획 실행과 apply 사이에 생긴다.
  - apply 때 상태 디렉터리가 다시 작아져 있으면 알림이 없다. 알림이 권하는 `codaryn cleanup`이 바로 그 상태를 만든다. 정리한 뒤 다시 apply하면 조용하다.
  - 사이의 실행은 자기 진행 줄에서 "확인하지 못함"을 말했다(사람용만. R44-I1).
- 판단: 계약이 정한 조건(apply 자신의 점검)은 지켰으므로 결정 위반은 아니다. 고침의 목적에 비추면 남은 틈이다.
- 권고(PM·엔진 담당 판단): 다음 중 하나
  - apply가 계획 실행 뒤의 실행들 journal에서 `state_checked`의 `limited`를 찾아, 있으면 같은 알림을 붙인다.
  - 알려진 한계로 계약의 `plan_records_unchecked` 설명에 적는다.

## 3. 정보

- **R44-I1 실행(apply가 아닌 것)의 JSON 결과는 여전히 말하지 않는다.**
  - 상한을 넘는 문서 실행의 `notices`는 비어 있고, `--quiet`에서는 stderr가 0바이트다. 기록은 journal의 `state_checked`와 사람용 진행 줄뿐이다.
  - 이 단위의 범위는 "실행의 사람용 진행 줄"이므로 결함으로 세지 않았다.
- **R44-I2 진행 줄이 점검마다 되풀이되고 정리 안내가 없다.**
  - apply와 검증이 있는 실행에서 같은 줄이 네 번 나온다(계획 실행은 두 번).
  - apply의 진행 줄도 "the run goes on"이라고 말한다.
  - `cleanup` 안내는 apply의 요약 줄과 JSON 알림에만 있다. 평범한 실행의 사람은 줄이는 법을 듣지 못한다.
- **R44-I3 GUI는 영어 고정 글을 보인다.** 창에 가는 것은 `notices`의 엔진 글이다. `noticeKinds`와 카탈로그의 `apply.notice.*`는 GUI로 가지 않는다. 한국어 화면에서도 이 알림은 영어다. 또 `state_checked` 항목은 실행 화면의 "검증" 거르개 목록(`run-model.ts:29`)에 없다.
- **R44-I4 apply의 사람용 보고서는 알림을 영어 고정 글로 보인다.** 바로 위에 "Workspace too large to check: no"(보호 대상 점검의 줄)가 있어 서로 어긋나 보일 수 있다. `report --json`에는 `noticeKinds`가 있다.

## 4. 실험 표

**상한을 넘는 작업 공간**(N)

| 판/언어 | 문서 실행 | 계획 실행 | apply | apply 보고서 |
| --- | --- | --- | --- | --- |
| 단위/영어 | 진행 줄 4번, JSON 알림 없음 | 진행 줄 2번 | `done`/`verified`, `noticeKinds` 있음, JSON 알림 1, 요약 줄 1, 진행 줄 4번 | JSON `noticeKinds` 있음, 사람용에 고정 글 |
| 단위/한국어 | 같음(한국어 줄) | 같음 | 같음(요약·진행 줄 한국어, JSON 알림은 영어 고정 글) | 같음 |
| main/영어 | 줄 없음 | 줄 없음 | `done`/`verified`, 알림 없음 | 없음 |

- 세 판 모두 journal의 `state_checked`는 `limited`였다.

**알림이 나와야 하는 경우**(X, Y)

| 경우 | 계획 실행의 점검 | apply의 점검 | apply 알림 |
| --- | --- | --- | --- |
| X1 계획 확인됨, apply 전에 상한 넘음 | 완전 | 네 번 모두 `limited` | 있음 |
| X3 apply 시작 때 20,000항목 | 완전 | 네 번 모두 `limited` | 있음 |
| Y3 apply 시작 때 19,999항목 | 완전 | `run_start` 완전, 뒤 세 번 `limited` | 있음 |
| Y3 apply 시작 때 19,998 · 19,996 · 19,992항목 | 완전 | 완전 | 없음(상한을 넘지 않음) |
| X2 계획 `limited`, apply 전에 더미 지움 | `limited` | 완전 | **없음**(R44-L1) |
| Y1 사이의 실행 `limited`, 더미 지움 | 완전 | 완전 | **없음**(R44-L1) |
| X4 실행의 명령이 `.codaryn`에 20,500개 만듦 | | | 실행이 `failed`/`state_changed`(경로 19,992개와 19,999개) |

**main과 같은지**(S, 두 언어 모두 같음)

- 문서 실행, 문서 실행 `--quiet`, 명령이 있는 실행, 계획 실행, apply, 거부되는 두 번째 apply
- 계획 실행의 보고서, apply의 보고서, apply의 보고서 `--json`, `runs`, apply의 되돌리기
- 이때 단위 판의 점검은 `run_start`·`run_end`뿐이고 `noticeKinds`는 없었다.

## 5. 검사하지 않은 범위

- GUI와 앱 계층의 실행(코드로만 봤다)
- 해시 바이트 상한(`MAX_STATE_HASH_BYTES`)으로 `limited`가 되는 경우. 항목 상한만 일으켰다. 두 경우 모두 같은 `limited` 값을 지난다.
- 유닛·통합 시험 재실행(PM이 이 판에서 잰 수치를 받았다)
- macOS·Linux

## 6. PM 판단 필요

- **Q-1(R44-L1)**: 앞선 실행의 "확인하지 못함"도 apply가 알리게 할지, 알려진 한계로 적을지.

사용자에게 물을 질문은 없다.
