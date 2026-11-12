# R-56b 확인: 단위 U-33, R-56 낮음 넷의 고침 (w3:p4, 2026-11-13)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어. 읽기 전용이며 저장소 수정·커밋은 없다. 범위는 지시대로 좁게 잡았다.
- **검토한 판: `pm/unit-U-33` = `5081d3f`**(main `0ad28bc` 위, 17파일 624줄). 기준은 R-56의 R56-L1~L4와 DR-55(`docs/work-orders/phase-4-5-design.md:152`)다.
- 비교판
  - main `0ad28bc`: 이 판의 바탕, U-29까지 들어 있다
  - main `a191a50`: U-29 전, L2의 기준
- 사본: `.codaryn/r56b/u`(`5081d3f`), `m`(`0ad28bc`), `a`(`a191a50`). 셋 다 `npm run build` 성공. 확인 뒤 지웠다.
- 실험: `r56b/r56b.mjs`(구역 Q, L2, L3, K, S, R, D). 로그는 `r56b/*.log`.
  - 모든 CLI 호출에 시험의 네트워크 막이(`dist/tests/support/net-guard.js`)를 얹었다. 대본(scripted) 모델만 썼고 주소는 쓰지 않았다.
  - 기본 설정 위치는 시험 폴더로 돌렸다. 상태 디렉터리를 `limited`로 만드는 방법은 R-56과 같다(1 MiB보다 큰 파일 하나, E5만 항목 20,500개).
  - K는 내가 띄운 CLI 자식을 그 핸들로 끝냈다. 그 자식이 띄운 명령은 3초 뒤 스스로 끝났다.
- 시험 파일: 판의 U-29·U-33 시험 여덟 파일(135건)을 세 번 돌려 세 번 모두 135건 통과했다(`T.log`).

## 1. 요약

| 심각도(새로 찾은 것) | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 1 (R56b-L1) |
| 정보 | 5 (R56b-I1~I5) |

| 볼 것 | 결과 |
| --- | --- |
| R56-L1 같은 초 | **닫혔다.** Q를 다시 돌렸다(16번 × 두 순서). 같은 초에 든 30번은 무작위 부분의 순서와 상관없이 모두 알렸다(`cause: run_since_plan`) |
| | - 계획 뒤에 시작한 실행 15번(id가 앞섬 6, 뒤 9) |
| | - 계획 앞에 시작한 실행 15번(DR-55대로 셈, R56b-I1) |
| | - 초가 갈린 두 번: 다른 실행이 계획보다 뒤 초면 알렸고, 앞 초면 알리지 않았다 |
| R56-L2 U-8의 경우 | **닫혔다.** 아래 두 경우 × 두 언어에서 출력 넷이 **a191a50과 같다**: apply의 stdout(JSON)과 stderr, `result.json`, `report --json`, `report` |
| | - 상태 디렉터리가 내내 너무 큼 |
| | - 계획 실행은 온전하고, 뒤의 실행과 apply가 `limited` |
| | - `notices`는 U-8 글 한 줄이고 `planRecordsUncheckedCause`는 없다. `0ad28bc`와는 다르다(그쪽은 R-56의 새 글) |
| R56-L3 사람용 줄 | **닫혔다.** 새 까닭(apply 자신의 점검은 온전, 계획 실행이나 그 뒤 실행이 확인 못 함)에는 `apply.notice.plan_records_unchecked.run_since_plan`이 나온다. 두 언어 모두 cleanup을 권하지 않는다 |
| | - 확인한 경우: 뒤 실행 `limited`, 계획 실행 자신이 `limited`, R-44 Y1, K, 터미널 질문에 `y`로 답한 apply |
| | - U-8의 경우는 예전 줄(cleanup 권함) 그대로다 |
| R56-L4 끝 기록이 없는 실행 | **닫혔다.** K를 다시 돌렸다. 계획 실행 폴더에 쓰고 확인 전에 끝난 실행 뒤의 apply가, 두 언어에서 `noticeKinds: ["plan_records_unchecked"]`와 새 사람용 줄로 알린다(`0ad28bc`는 말이 없다) |
| | - 묻는 apply 자신은 빠진다: 문서 실행, 계획 실행, apply가 한 초 안에 들어간 6번 모두 알림이 없다(R4) |
| | - store를 직접 부르면(D) 끝나지 않은 실행을 `applyRunId`로 넘길 때만 `false`다. 계획 실행은 그 이름으로 넘겨도 센다 |
| 평범한 apply가 괜히 알리지 않는지 | **알리지 않는다.** S 열한 가지 × 두 언어가 `0ad28bc`와 바이트까지 같고, `noticeKinds`가 없다 |
| | - S 열한 가지: 문서 실행, 계획 실행, apply, 거부되는 두 번째 apply, 보고서 둘, `runs`, 되돌리기, `--quiet` apply, 터미널 `y`, 앞 초의 `limited` 실행 |
| | - 실행이 끝나는 여섯 가지 뒤에도 앞 계획의 apply는 알리지 않는다: 완료, 검증 실패, 턴 한도, 검증기 없음, 취소, 대본 소진(모델 오류). 모두 `run_finished`가 있다(R1, main과 같음) |
| 새 뒷걸음 | **없다.** 아래 셋 모두 |
| | - 계획 실행 자신의 journal에서 `run_finished`를 지움: apply는 거부 없이 알린다(R2, R56b-I4) |
| | - 두 번째 apply와 되돌린 뒤의 apply: `plan_already_applied`(종료 2), main과 같음 |
| | - 되돌린 뒤 새로 만든 계획: 알림 없이 적용됨(R3) |
| 새로 본 것 | `report --json`이 `planRecordsUncheckedCause`를 싣지 않는다(R56b-L1) |

## 2. 낮음

### R56b-L1 `report --json`에 알림의 까닭(`planRecordsUncheckedCause`)이 없다

- 위치: `src/cli/report.ts:727-748`. apply 보고서는 `result.json`을 정해진 필드만 골라 다시 만든다. `noticeKinds`(`noticeKindsOf`)는 옮기지만 새 필드는 옮기지 않는다. 이 판은 `report.ts`를 고치지 않았다.
- 재현(L3, `L3.log`, 세 경우 × 두 언어 모두 같음)
  1. 계획 실행을 한다. 다음 초에 큰 파일을 두고 문서 실행을 하고, 큰 파일을 지운다.
  2. apply를 한다. 결과와 `result.json`에 `noticeKinds: ["plan_records_unchecked"]`, `planRecordsUncheckedCause: "run_since_plan"`이 있다.
  3. `codaryn report --workspace <ws> --run <apply id> --json`의 `result`에는 `noticeKinds`만 있고 `planRecordsUncheckedCause`는 없다.
- 영향
  - 보고서 JSON만 읽는 쪽은 그 알림이 U-8의 것(지금 너무 큼, cleanup)인지 새 까닭인지 고정 알림 글로만 가를 수 있다.
  - 사람용 줄을 까닭으로 고르는 규칙(`src/contracts/human.ts`의 `apply.notice.plan_records_unchecked.<cause>`)을 보고서 결과에는 쓸 수 없다.
  - 사람용 `report`는 `notices`의 글을 그대로 싣으므로 까닭에 맞는 글이 보인다.
- 고칠 방향(제안): `noticeKindsOf`처럼 아는 값(`PLAN_RECORDS_UNCHECKED_CAUSES`)일 때만 옮긴다. 다만 `report --json`의 출력이 바뀌므로, 고정 출력 시험이 있으면 함께 본다.

## 3. 정보

- **R56b-I1 같은 초에 계획 앞에 시작한 실행도 센다.** DR-55대로다. Q에서 계획보다 먼저 시작한 `limited` 실행 15번 모두에 알림이 붙었다(fail closed 쪽).
- **R56b-I2 시각을 말하지 않는 실행 이름은 언제나 센다.** `runs` 아래의 `notes`, `0notes`처럼 실행 id 모양이지만 시각이 아닌 이름은 이제 계획과 상관없이 센다(D). journal이 없으면 모든 apply가 알린다. R-56 판에서 `0notes`는 세지 않았다.
  - cleanup이 남기는 폴더는 `runs/`가 아니라 `.codaryn/cleanup-<hex>`이므로 해당하지 않는다(`src/contracts/cleanup.ts:60`).
  - 사람이 손으로 만든 폴더만 해당한다.
- **R56b-I3 `run_finished`는 마지막 줄이 아니어도 된다.** journal 가운데에 있어도 "끝남"으로 본다(D). 손으로 고친 경우에만 생긴다.
- **R56b-I4 계획 실행 자신의 끝 기록이 없으면 알린다.** journal에서 `run_finished` 줄을 지운 계획 실행이 있다. apply는 그 계획을 거부하지 않고 `done`/`verified`로 옮긴 뒤 새 까닭의 알림을 붙인다(R2). main은 말이 없다. 계획을 불러오는 쪽이 journal의 끝 기록을 보지 않는 것은 예전 그대로다.
- **R56b-I5 계약 문서가 DR-55를 아직 싣지 않았다.** `docs/cli-contract.md:1150`은 아직 U-29의 규칙이다("계획 실행보다 앞선 실행은 세지 않는다"). 이 판은 계약 문서를 고치지 않았다(17파일에 없음). 다음 셋이 문서에 없다.
  - 같은 초는 모두 셈
  - 끝 기록이 없는 실행도 셈
  - `planRecordsUncheckedCause`와 사람용 줄 `…run_since_plan`
- 참고: S의 `runs` 출력은 `a191a50`과 다르지만 `0ad28bc`와는 같다. 사이에 들어온 다른 단위 때문이고 U-33과는 관계가 없다.

## 4. 검사하지 않은 범위

- 자기 점검이 run_start가 아닌 뒤 단계에서만 `limited`가 되는 apply. 엔진 유닛 시험(`tests/unit/engine/g-apply.test.ts`)이 다룬다.
- GUI와 앱 계층의 실행. 이 판은 GUI를 고치지 않았고, 앱 계층은 CLI의 `runApply`를 그대로 쓴다(R-56에서 코드로 봄).
- 루트 유닛·통합 시험 전체 재실행(PM이 이 판에서 잰 수치를 받았다)

## 5. PM 판단 필요

- **Q-1(R56b-L1)**: `report --json`의 결과에 `planRecordsUncheckedCause`를 실을지. 가정: 싣는다. 결과의 나머지 필드처럼 기록된 값을 그대로 옮기면 된다.

사용자에게 물을 질문은 없다.
