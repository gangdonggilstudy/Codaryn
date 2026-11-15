# R-41 병합 뒤 검토: 단위 U-4의 문서 변경 (읽기 전용)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어(주), 보안·개인정보 검토자(보조). 문서의 작성자가 아닌 세션이다.
  - 다만 문서가 인용하는 정리 문구(`cleanup.*`)와 가림 코드(`src/privacy`)는 내가 쓴 것이다. 문서와 실제 출력의 대조에는 영향이 없다.
  - 저장소 파일 수정과 커밋은 없다.
- **검토한 판**: main **`5396225`**(U-4 병합). 변경은 `git diff 93dfbd3 5396225 -- README.md docs/privacy.md docs/usage.md`(3개 파일, +112 −44).
- 실험: `5396225`의 `git archive` 사본(`.codaryn/r41/src`, 빌드 종료 0)의 **실제 CLI**를 임시 작업 공간(`%TEMP%/codaryn-r41-*`)에서 돌렸다.
  - 모델은 scripted다. API 주소는 닫힌 포트 `127.0.0.1:9`이고 실제 API와 외부 네트워크는 쓰지 않았다.
  - 키 변수에는 실행 때 조립한 가짜 값만 넣었다.
  - 스크립트: `.codaryn/r41/a1.mjs`(정리), `a2.mjs`(다 지우지 못한 경우), `b1.mjs`·`b2.mjs`(기록 변조), `c1.mjs`(검증기 합치기와 시작 줄), `d1.mjs`(끊긴 비밀), `e1.mjs`(보고서 기록 수), `f1.mjs`(나머지 표본).
- 비밀 검사: `node scripts/check-secrets.mjs --range 93dfbd3...5396225`는 발견 없음(종료 0).

## 요약

| 심각도 | 건수 | 항목 |
| --- | --- | --- |
| 높음 | 0 | |
| 중간 | 0 | |
| 낮음 | 3 | L-1 "기록이 고쳐진 다른 실행에는 표시가 없다"가 실제와 다르다(표시가 붙는다). L-2 종료 코드 표와 문제 해결 표에 `state_changed`와 정리의 종료 코드가 없다. L-3 16절 "스냅샷" 줄이 아직 "직접 지운다(11절)"라고 해 11절의 "손으로 지우지 않는다"와 어긋난다 |
| 정보 | 6 | I-1~I-6 |

- 인용한 출력 예시는 표본 모두 실제 출력과 글자 그대로 같았다(실행 id·시각·digest만 다름).
- 아직 없는 기능을 있다고 적은 곳은 찾지 못했다. 있는 동작을 없다고 적은 곳이 하나다(L-1).
- 키 모양 예시 문제는 없다.

## 1. 낮음

### L-1 "기록이 고쳐진 다른 실행에는 표시가 없다"는 실제와 다르다

- 위치: `docs/usage.md` 16절 "실행 기록 변조"의 "표시가 붙는 것은 그때 돌던 실행이다. 기록이 고쳐진 다른 실행에는 표시가 없다." `docs/privacy.md` 8절도 "그 실행에 기록이 바뀐 표시를 남긴다"라고만 한다.
- 재현(`b2.mjs`)
  - 실행 A가 끝난 뒤, 실행 B의 허용한 `node` 명령이 A의 `result.json` 끝에 공백을 붙였다.
  - B는 `failed`/`state_changed`(종료 1)로 끝났다.
  - A의 실행 폴더에도 `records-changed.json`이 생겼다(전: `journal.jsonl`, `result.json`, `snapshots`).
  - `runs`는 두 줄 모두에 `· records changed (…)`를 붙였다. `runs --json`은 둘 다 `recordsChanged: true`다. A의 `report`도 표시 줄을 냈다.
- 영향
  - 문서보다 실제가 더 많이 알린다(안전한 쪽). 그러나 사람이 "다른 실행의 기록은 표시가 없어도 고쳐졌을 수 있다"고 읽고, 표시가 붙은 끝난 실행을 "그 실행이 돌 때 생긴 일"로 잘못 읽을 수 있다.
  - 병합 뒤 U-1(표시가 있는 계획 실행의 적용 거부)이 들어오면 이 표시는 더 중요해진다.
- 권고(문서 담당): "표시는 그때 돌던 실행과, 기록이 바뀐 것으로 드러난 다른 실행에 붙는다"로 고친다. 어느 경우에 다른 실행에 붙는지(실행 폴더 안의 변경)는 store 담당에게 확인해 적는다. `privacy.md` 8절도 같이 고친다.

### L-2 종료 코드 표와 문제 해결 표에 새 결과가 없다

- 위치: `docs/usage.md` 10절 종료 코드 표(598~600행 부근)와 17절 문제 해결 표. 이번 변경이 건드리지 않은 줄이다.
- 사실
  - 종료 1 행은 `verifier_failed`, `repeated_failure`, `model_error`, `plan_stale`, `apply_incomplete`만 든다. `failed`/`state_changed`(종료 1, 16절이 설명함)가 없다.
  - 종료 3 행에 정리의 `plan_changed`(실제 종료 3, `a1.mjs`)가 없다. 종료 1 행에 정리의 `partly_removed`(실제 종료 1, `a2.mjs`)도 없다.
  - 17절 표에 `failed`/`state_changed` 행이 없다. `state_changed`는 `usage.md`에서 16절에만 나온다.
- 영향: 실행이 `state_changed`로 끝난 사람이 먼저 찾는 두 표에서 답을 찾지 못한다.
- 권고: 두 표에 행을 더하고 16절 "실행 기록 변조"와 18.8절을 가리킨다.

### L-3 16절 "스냅샷" 줄이 11절과 어긋난다

- 위치: `docs/usage.md` 775행 "보관 기간 관리가 없으므로 직접 지운다(지워도 되는 폴더는 11절)". 이번 변경이 건드리지 않은 줄이다.
- 사실: 11절은 이번에 "`codaryn cleanup`으로 미리 본 뒤 지운다(18.8절). 손으로 지우지 않는다."로 바뀌었고, 지워도 되는 폴더 목록은 없어졌다.
- 영향: 같은 문서가 스냅숏을 손으로 지우라고도, 손으로 지우지 말라고도 한다. 손으로 지우면 계획 실행을 잃어 적용을 되돌릴 수 없게 될 수 있다(18.8절 끝 줄이 경고하는 일).
- 권고: "보관 기간 관리가 없으므로 `cleanup`으로 지운다(18.8절)"로 고친다.

## 2. 확인한 것 (문서와 실제가 같음)

| 주제 | 문서의 말 | 실제(main `5396225`) |
| --- | --- | --- |
| 정리 미리보기(18.8절 출력 예시) | 3절 체험 두 번, 처음 것만 되돌림, `--older-than 0` | 줄마다 글자 그대로 같다. 크기도 같다(30151, 14977, 15174바이트). 되돌리지 않은 실행이 먼저 나온다 |
| `--confirm`만 | `Removed: run records 1, discarded-files folders 0, 15174 bytes`, 남긴 이유 문구 | 같다. 종료 0 |
| `--include-not-reverted` | 새 미리보기의 digest로 더하면 지워진다. `--confirm` 없이는 받지 않는다 | 옛 digest는 `plan_changed`(종료 3). 새 digest로 지워졌다. 단독은 `invalid_arguments`. `--delete-discarded` 단독, `--run latest`도 `invalid_arguments` |
| 보관함을 남길 때의 경고 | 적용 실행 줄의 조건 문구, 보관함 줄, 끝의 `People's discarded files …` | 세 문구 모두 글자 그대로 같다. 보관함을 고르지 않아도 적용 줄에 경고가 붙는다 |
| `--delete-discarded` 없이 확인 | 보관함은 남는다 | `deleting the discarded files was not confirmed`로 남았고 폴더가 그대로다 |
| 다 지우지 못한 경우 | `partly_removed`, 종료 1, `cleanup-<16자리>`에 표지와 함께 남고 다음 미리보기에 `Leftover folders to remove` | 같다(ACL로 지우기를 막아 재현). 기록에는 지운 것 0으로 남는다. 다음 `--confirm`으로 지워졌다 |
| 표지 없는 같은 이름 폴더 | 지우지 않고, 요약에도 나오지 않는다 | 같다. 요약과 `--json` 요약에 없고, 정리 뒤에도 남았다 |
| `cleanup.jsonl` | 개수와 바이트만 | 같다(이름·경로 없음) |
| `--reverted` | 마지막 되돌리기가 완전했던 실행만 | 완전 1개만 골랐다(일부만 되돌린 실행, 되돌리지 않은 실행 제외) |
| 한국어 출력의 영어 | 크기 조각과 끝의 안내 줄 | 같다. 적용 뒤 줄의 이름표 `run`도 영어다(I-3) |
| 실행 중 변조 감지 | 자기 기록, 다른 실행의 `result.json`, `.codaryn`의 새 파일 → `failed`/`state_changed`(종료 1) | 셋 모두 그렇게 끝났다. 명령형 검증기가 고쳐도 같다 |
| 끝 요약 문구 | `the state directory was changed by something other than the run, or could not be checked (failed/state_changed)`와 안내 | 글자 그대로 같다 |
| `runs`의 표시(출력 예시) | 영어 줄, 한국어 문구, 155자 | 글자 그대로 같고 영어 줄은 155자다. `--json`에 `recordsChanged: true` |
| 표시가 있는 실행 | `report` 한 줄, `changes`는 `masking_unverified`만, `revert`는 막지 않고 JSON에 `recordsChanged: true`, 사람용 글에는 없음 | 모두 같다(미리보기와 실제 되돌리기 둘 다) |
| journal에 엉뚱한 줄 | `report`·`changes`가 `invalid_run_record` | 같다. `revert`도 `invalid_run_record`다 |
| **끝난 뒤의 변조(한계)** | 감지되지 않는다. 스냅숏을 고치면 `runs`는 그대로, `revert`는 `snapshot missing (missing_snapshot)`으로 건너뜀 | 같다. `runs` 출력이 바이트까지 같았고 파일은 쓰이지 않았다. 끝난 실행의 `result.json`을 고친 뒤 새 실행을 해도 표시가 없다 |
| 검증기 합치기(18.1절) | 정의의 것이 늘 실행, id가 같은 것만 빠짐, `[]`도 지우지 않음 | `has-summary`(정의)와 `a-kept`가 실행됐다. `[]`에서도 정의의 것이 실행됐다. `run_started`에 `verifiers_dropped` 1 |
| `doctor --task`의 줄 | `a run of this workflow leaves out checks given in the config or task with the same id as its own: 1` | 글자 그대로 같다 |
| 실행 시작 줄(출력 예시) | 영어 줄, 한국어 줄, 227자 | 둘 다 글자 그대로 같고 영어 줄은 227자다. 끝 요약과 `report`에는 없다 |
| `doctor`에 `--workflow` 없음 | 미리 볼 수 없다 | `invalid_arguments` |
| `plan --workspace`의 안내(출력 예시) | 오류 설명 끝의 한 줄 | 다섯 줄 모두 글자 그대로 같다(stderr, 종료 2) |
| 끊긴 비밀의 가림 | 키 같은 20자 값은 다섯 끊김 모두 토큰. `summer2026winter`는 공백·줄바꿈·영폭 공백만 토큰, `.`·U+FE0F는 그대로 | 같다(대본 모델이 읽은 도구 결과의 기록으로 확인) |
| 끊긴 키의 거부(`--goal`) | 키 같은 값은 `.`·U+FE0F도 거부. 키 같지 않은 값은 영폭 공백만 거부. 자리표시자 낱말은 통과 | 같다(`key_in_file`이거나, 키 검사를 지나 다음 오류) |
| `report`의 기록 수(18.2절) | 적용 실행 `Report: complete (13 journal records)` | 13이다(journal 13줄) |
| README | `cleanup … --older-than 30` 미리보기 뒤 `--confirm <digest>`, 두 별도 확인 | 실제와 같다. 두 절 링크의 닻도 맞다 |

## 3. 정보

- **I-1** `docs/privacy.md`에 `cleanup`이 없다. 13절은 "스냅샷은 평문으로 남고 자동 삭제되지 않는다"까지만 말한다. 지우는 길(`cleanup`)과, 다 지우지 못하면 `cleanup-<…>` 폴더에 평문 스냅숏이 남을 수 있다는 것은 적지 않았다.
- **I-2** `usage.md` 10절 "실행 목록"은 `· reverted (complete)`만 말하고 기록 변경 표시는 16절에만 있다. 10절에 한 줄 가리킴이 있으면 찾기 쉽다.
- **I-3** 한국어 정리 출력에서 적용 뒤 줄의 이름표 `run`·`discarded`도 영어다. 18.8절은 크기 조각과 끝의 안내 줄만 든다.
- **I-4** 끝난 뒤 스냅숏을 고친 예에서 `revert`는 `partial`, 종료 3이다. 문서는 건너뛴다는 것만 적고 종료 코드는 적지 않았다.
- **I-5** 문구 id `revert.records_changed`와 `cleanup.summary.unknown_folders`는 카탈로그에 글이 있지만 CLI가 쓰지 않는다. 문서는 둘 다 "아직 없다"고 맞게 적었다. 연결되면 문서를 고쳐야 한다.
- **I-6** 확인하지 않은 범위
  - 기록을 확인할 수 없는 실행의 별도 확인, `lock_held`·`no_result`·`workspace_locked`, 링크를 따라가지 않는 것(R-34·R-34b·R-34c에서 확인된 것으로 문서가 밝힘).
  - `shown-<n>.json` 다이제스트를 바꿔 넣는 변조(DR-37 (b)).
  - 등록되지 않은 키의 거부, 문자 참조로 끊긴 키(문서가 main `23daf6b` 확인이라고 밝힘).
  - GUI, Linux·macOS, 실제 API.

## 4. PM 질문

없다. 세 낮음은 모두 문서 고침이고, L-1의 정확한 조건만 store 담당 확인이 필요하다.
