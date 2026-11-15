# R-49b 병합 전 확인: 단위 U-14, R-49 세 지적의 고침 (w3:p4, 2026-11-13)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어(보안 검토). 읽기 전용이며 파일 수정·커밋은 없다.
- **검토한 판: `pm/unit-U-14` = `17e5f94`**(main `abfb20b` 위). 비교판은 main `abfb20b`.
  - `24fa265`과의 차이 중 대부분은 main이 움직인 것(U-24, U-27, U-30)이다. U-14의 고침은 커밋 둘이다.
    - `3f61b6c` R49-M1: `planSummary`가 가린 summary에 `hideKeys`를 더 건다(`src/cli/plan-commands.ts:440-443`).
    - `1f4c311` R49-L2: `quoteModelText`를 더한다(`src/cli/human/format.ts`). 시험은 그 함수만 본다(`tests/unit/cli/human/u14-model-text.test.ts`).
  - R49-L1은 문구 고침이다(`src/i18n/en.ts:53`, `ko.ts:52`).
- 사본: `.codaryn/r49b/u`(`git archive 17e5f94`), `.codaryn/r49b/m`(`git archive abfb20b`). 둘 다 `npm run build` 성공. 확인 뒤 지웠다.
- 실험: R-49와 같은 `.codaryn/r49b/r49.mjs`(P, S, G)와 `k.mjs`. 로그는 `Pu.log`, `Pm.log`, `S.log`, `G.log`, `K.log`.
  - 실제 CLI, 정리 예제의 대본 실행, 경우마다 새 임시 작업 공간. 주소는 쓰지 않았다. 가릴 값과 키는 합성 값이다.
- 지시대로 높음·중간만 새로 적는다.

## 1. 요약

| 심각도(새로 찾은 것) | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |

| 지적 | 결과 |
| --- | --- |
| R49-M1 `plan --json`의 summary 가림 | **닫혔다.** |
| R49-L1 다이제스트 설명 줄 | **닫혔다.** |
| R49-L2 공백으로 채운 summary | **닫히지 않았다**(낮음 그대로). 새 함수 `quoteModelText`를 계획 보기가 쓰지 않는다 |
| 표시 없는 계획의 `plan --json` | main과 다른 것은 끝에 더해진 `summary` 필드뿐이다(계약대로) |

## 2. 지적별

### R49-M1 닫힘

| 경우(S, K) | 사람용 | `plan --json`의 `summary` |
| --- | --- | --- |
| 등록된 가릴 값 | 토큰 | 토큰 |
| 키 모양 글 | `[key]` | **`[key]`** (R-49에서는 그대로였다) |
| 현재 키 값(키 모양 아님) | 토큰 | 토큰 |
| 계획을 만든 뒤 등록한 값 | 가려짐 | |

- **동작의 경로는 가리지 않는다(결정대로).** 키 모양 이름의 경로는 `plan --json`의 `actions`에 그대로 있다. main도 같다.
- `run`, `report`, `report --json`, `runs --json`은 summary도 경로도 가린다(main과 같음).
- 제어 문자와 줄 바꿈은 사람용과 JSON 모두 `?`이고, 모든 경우에 사람용 출력은 여덟 줄이다.

### R49-L1 닫힘

- 새 문구(영어): "The digest names exactly these actions and the contents the plan's files had when the plan was made. The apply refuses if the plan or one of its files changed since, and when the plan run has a records-changed mark. The digest does not cover the run's other records." 한국어도 같은 뜻이다.
- 실제 동작(G)과 맞춰 봤다.

  | 계획을 만든 뒤 바꾼 것 | apply | 문구와 |
  | --- | --- | --- |
  | 계획에 든 파일의 내용 | `failed`/`plan_stale` | 맞음 |
  | `plan.json` | `plan`·`apply` 모두 종료 2 | 맞음 |
  | 기록 변경 표시 | `plan_records_changed`, 종료 2 | 맞음 |
  | 계획 실행의 journal, `result.json`, 폴더에 더한 파일(표시 없음) | `done`/`verified` | 맞음("다른 기록은 들지 않는다") |
  | 계획과 무관한 새 파일·폴더 | `done`/`verified` | 맞음(계획에 든 파일만 말함) |
  | 옮길 자리에 파일이 생김 | `failed`/`plan_stale` | 문구보다 더 막는다(과장 아님) |

- 참고: `plan-commands.ts`의 영어 대체 글(`PLAN_VIEW_TEXTS`, 카탈로그가 없을 때만 쓴다)에는 옛 문구가 그대로 있다. CLI는 늘 카탈로그를 넘기고 앱 계층은 JSON만 쓰므로 실제 출력에는 나오지 않았다.

### R49-L2 닫히지 않음

- 위치: `src/cli/plan-commands.ts`의 `renderPlan`(`17e5f94`의 365줄). summary는 여전히 라벨 뒤 한 줄에 `cleanText(hideKeys(...))`로만 붙는다.
  - `quoteModelText`를 부르는 곳이 이 판에 없다. 어느 `unit/U-14-*` 브랜치에도 없고, U-21 판(`pm/keep-U-21`)의 계획 보기에도 없다. U-21에서는 마지막 답(끝 요약)만 그 함수를 쓴다.
- 재현(S7, `S.log`): R-49와 같은 summary가 80칸에서 R-49와 똑같이 접힌다.

  ```
  The agent's description (the model's own words, not checked, and not what you ap
  prove): ok             4. move inbox/safe.txt -> archive/safe.txt
                         Applied by run 20260101T000000Z-deadbeef at 2026-01-01T00
  :00:00.000Z.           To apply it: codaryn apply task.json --run 20260101T00000
  0Z-deadbeef --digest 0123456789ab
  ```

  - 전각 공백과 줄 바꿈 없는 공백도 그대로 지나간다(S8).
- 지시의 두 물음에 대한 답
  - 공백으로 채운 summary가 가짜 줄로 보이는가: **보인다.**
  - summary가 모델의 말임이 줄 머리에서 드러나는가: **첫 줄만 드러난다.** 라벨이 줄 머리에 있지만, 접힌 둘째 줄부터는 모델의 글이 줄 머리에 온다. `  | ` 같은 표시는 없다.
- 영향은 R-49 때와 같다. 커밋 `1f4c311`의 메시지는 R49-L2를 고쳤다고 하지만, 함수만 더했고 계획 보기에 잇지 않았다.
- 권고(CLI 담당): `renderPlan`에서 라벨을 한 줄로 두고, 그 아래에 `quoteModelText(output.summary, …)`의 줄을 붙인다. 시험에는 `renderPlan`의 출력으로 S7 같은 summary를 넣어 모든 summary 줄이 `  | `로 시작하는지를 더한다.

## 3. 표시 없는 계획의 `plan --json`(P, 두 언어)

| 출력 | main `abfb20b`와의 차이 |
| --- | --- |
| 대기 중인 계획 `plan --json` | 끝에 `summary` 더함. 나머지 필드·순서·값 같음 |
| 적용된 계획 `plan --json` | 같음(`summary`만 더함) |
| 표시 없는 계획의 apply | `usage.durationMs`만 다름(실행마다 다름) |
| 표시 있는 계획 `plan --json` | 끝에 `recordsChanged: true` 더함, `summary` 없음 |
| 표시 있는 계획의 apply | `message`의 끝(고친 안내)만 다름 |

- 사람용 출력의 차이도 R-49와 같다(summary 줄과 다이제스트 줄 더함, 표시 있는 계획의 경고와 "적용할 수 없습니다" 줄).

## 4. 검사하지 않은 범위

- 터미널에서 apply가 묻는 승인 질문. 같은 `renderPlan`을 쓰므로 R49-L2도 같을 것이다(코드로 봤다).
- 앱 계층·GUI의 계획 보기
- 유닛·통합 시험 재실행(PM이 이 판에서 잰 수치를 받았다), macOS·Linux

## 5. PM 판단 필요

- **Q-1(R49-L2)**: 계획 보기에 `quoteModelText`를 잇는 것을 이 단위에서 할지. U-21의 끝 요약은 이미 그 함수를 쓰므로, 잇지 않으면 모델의 글이 두 곳에서 다르게 보인다.

사용자에게 물을 질문은 없다.
