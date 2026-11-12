# R-62 병합 전 검토 — 단위 U-34 (cleanup 사람용 안내를 카탈로그로, UXM-7, AXM-22)

- 검토자: w3:p7(nd-docs). 내 코드가 아니다. 읽기 전용이며 저장소의 파일은 고치지 않았다.
- 고정 판: `pm/unit-U-34` = `5800754`(main `1e54ca9` 위). `git diff 1e54ca9 5800754`는 10파일, 678줄 더함·72줄 뺌이다. 제품 코드는 `src/cli/cleanup.ts`, `src/contracts/cleanup.ts`, `src/contracts/human.ts`, `src/i18n/en.ts`, `src/i18n/ko.ts`다.
- 사본: `.codaryn/r62/u`(`git archive 5800754`)와 `.codaryn/r62/m`(`git archive 1e54ca9`). 둘 다 `npm run build`가 종료 0이었다.
- 실험: `.codaryn/r62/r62.mjs`. 출력은 `r62-out.txt`와 `direct.txt`다.
  - 실제 CLI, 대본(scripted) 모델, 임시 폴더를 썼다. 주소 변수는 닫힌 `127.0.0.1:9`이고, 키 변수는 없다. 실제 API는 쓰지 않았다.
  - 일부 실패는 한 파일에 삭제 거부 ACL을 걸어 만들었다(그 파일과, 그 실행 폴더의 하위 삭제). ACL은 그 경우가 끝날 때마다 `icacls /reset /T`로 풀었다. 임시 폴더는 이름을 정확히 지정해 지웠다.

## 건수

- 높음 0 · 중간 0 · 낮음 0
- 정보 5 (I-1~I-5). U-34가 새로 만든 것은 I-1뿐이고, 나머지는 main에도 있는 것이다.

## 판단

- **병합해도 된다.** 영어 글과 `--json`이 볼 수 있었던 모든 경우에서 main과 같다. 한국어 글은 뜻이 맞고, 경고와 확인 방법이 빠지지 않았다.

## 방법

- **A. 실제 CLI, 같은 상태의 사본:** 기본 상태 여섯을 main의 CLI로 한 번 만들었다.
  - w1: 되돌린 실행 하나, 되돌리지 않은 실행 하나
  - w5: 되돌리지 않은 실행 둘(둘째는 바꾼 파일이 없음)
  - w2: 계획 실행과, 폐기 보관함에 파일이 남은 적용 실행
  - w6: w1에 표지 없는 `cleanup-…` 폴더를 더함
  - w8: w1에서 실행 하나의 `result.json`을 뺌
  - w9: 실행이 없음

  경우마다 그 상태를 사본 여섯으로 떴다: main/en, U-34/en, main/ko, U-34/ko, main/`--json`, U-34/`--json`. 같은 인자를 차례로 주고 stdout, stderr, 종료 코드를 그대로 비교했다. 확인 단계의 다이제스트는 그 사본에서 그 판으로 미리 본 것을 썼다.
- 정규화한 것은 셋뿐이다. 다이제스트는 사본마다 다르다(경로와 파일 시각). 그래서 다이제스트, 작업 공간 경로, 남은 폴더의 16자리 hex만 바꿔 놓았다.
  - 그 정규화가 무엇을 가리지 않는지 따로 확인했다. 정규화 없이 같은 상태 하나에 두 판을 돌린 미리보기 일곱 가지(`direct.txt`)도 글과 JSON이 모두 같았다.
- **B. 렌더러:** 두 판의 `renderCleanup`과 영어 카탈로그에 같은 출력을 주었다.
  - U-34의 시험 픽스처(`tests/unit/cli/u34-cleanup-fixtures.ts`)에서 나온 출력 열 가지를 썼다.
  - 그리고 각 출력에서 항목, 막힌 것, 지운 것, 남긴 것, 요약의 개수를 모두 두 배로 늘린 열 가지를 더했다.

## (1) 영어 출력이 main과 같은가 — 같다

| 경우 | 상태(종료) | 영어 | `--json` |
| --- | --- | --- | --- |
| w1 미리보기(되돌린 것과 되돌리지 않은 것) | preview(0) | 같음 | 같음 |
| w1 확인, `--include-not-reverted` 없음 | removed(0), 하나는 남김 | 같음 | 같음 |
| w1 되돌리지 않은 실행만 골라 확인 | nothing_removed(3) | 같음 | 같음 |
| w1 확인, `--include-not-reverted` 있음 | removed(0) | 같음 | 같음 |
| w5 미리보기와 확인 | preview(0), removed(0) | 같음 | 같음 |
| w2 미리보기(계획·적용, 보관함이 남은 적용) | preview(0) | 같음 | 같음 |
| w2 폐기 보관함만 미리보기 | preview(0) | 같음 | 같음 |
| w2 보관함 확인, `--delete-discarded` 없음 | nothing_removed(3) | 같음 | 같음 |
| w2 보관함 확인, `--delete-discarded` 있음 | removed(0) | 같음 | 같음 |
| w2 실행과 보관함을 함께 미리보기 | preview(0) | 같음 | 같음 |
| w2 실행 확인, `--include-not-reverted`(보관함 남김) | nothing_removed(3), `done_discarded_left` 줄 | 같음 | 같음 |
| w2 둘 다 확인 뒤 다시 미리보기 | removed(0), "Nothing to clean up." | 같음 | 같음 |
| w2 계획 실행만(적용이 씀) | preview(0) 막힘, nothing_removed(3) | 같음 | 같음 |
| w1 ACL: 지우기 실패 | partly_failed(1), `partly_removed` | 같음 | 같음 |
| 그 뒤 미리보기 | 남은 폴더 요약, 남은 폴더 항목 | 같음 | 같음 |
| ACL을 푼 뒤 확인 | removed(0), "Also removed: leftover folders 1, …" | 같음 | 같음 |
| w6 알 수 없는 폴더 | preview(0), Unknown folders 줄 | 같음 | 같음 |
| w8 결과 없는 실행 | preview(0), 막힘 `no_result` | 같음 | 같음 |
| w9 실행 없음 | preview(0), "Nothing to clean up." | 같음 | 같음 |

- B는 20개 출력이 모두 같았다. 실제 CLI로 만들지 못한 것도 여기서 맞대었다.
  - 막힘 `lock_held`
  - 남은 폴더만 있는 미리보기의 `cleanup.next.confirm_leftovers`
  - 개수 2인 모든 줄
- 모든 경우에서 stderr는 비었다. 정리의 글은 stdout에 나온다.

## (2) `cleanup --json`이 main과 같은가 — 같다

- 위 표의 모든 경우가 같다.
- U-34는 JSON을 바꾸지 않는다. `renderCleanup`은 `--json`이 아닐 때만 불린다(`runCleanup`의 `json ? jsonLine(output) : renderCleanup(…)`).
- 계약 쪽의 바뀐 것은 `CleanupTarget`을 `CLEANUP_TARGETS` 배열에서 만든 것뿐이다. 값은 같다(`run`, `discarded`, `leftover`).

## (3) 한국어: 뜻, 경고와 확인 방법, DR-50 용어, 남은 영어

- **경고가 빠지지 않는다.** 한국어 출력에 다음이 모두 있다.
  - 미리보기의 머리 줄: "지우면 그 실행을 더는 되돌릴 수 없고 손으로 되살릴 수도 없습니다"
  - 보관함 줄: "사람의 파일이며 되살릴 수 없습니다"
  - 다음 단계 줄: "지우면 그 실행은 더는 되돌릴 수 없습니다"
  - 그리고 보관함이 남은 적용 실행에 대한 "그 파일이 무엇이었는지는 이 기록에만 있습니다"
- **확인 방법이 빠지지 않는다.** 다음 단계 줄은 세 갈래 모두 `… 다음을 붙여 다시 실행하세요: --confirm <앞 12자>.`로 끝난다. 보관함만 있을 때는 `--confirm <앞 12자> --delete-discarded.`다.
  - 렌더러가 옵션을 글 뒤에 붙인다(`${text} ${confirm}.`). 그래서 옵션은 두 언어에서 같은 꼴로 복사할 수 있다.
  - `--include-not-reverted`와 `--delete-discarded`를 직접 붙여야 한다는 줄도 한국어로 나온다.
- **뜻:** 영어 문장과 맞는다. 개수, 바이트, 폴더 수는 영어 출력과 같은 값이다.
  - 예: `지웠습니다: 실행 기록 1개, 폐기 보관함 폴더 0개, 15671바이트`, `함께 지운 남은 폴더: 1개, 13827바이트`.
- **DR-50 용어:** 한국어는 "폐기 보관함"을 쓴다. 대상 이름 `cleanup.target.*`(실행 기록, 폐기 보관함, 남은 폴더)는 GUI 한국어 카탈로그(`gui/src/renderer/i18n/ko.ts` 432~434행)와 글자까지 같다. "다이제스트"라는 낱말은 새 글에 없다(옵션만 보인다).
- **남은 영어:**
  - 카탈로그의 한국어 `cleanup.*` 글 42개 가운데, 옵션 이름·경로·자리표시자를 빼고 영어 낱말이 남은 것은 0개다.
  - 출력에 남는 영어는 실행 id, `cleanup-<hex>`, `.codaryn/parked/`, 옵션 이름뿐이다.
  - main의 한국어 출력에서 영어였던 줄은 모두 한국어가 되었다: 크기 `4 file(s), 15474 bytes`, "Nothing was removed." 줄 넷, 대상 이름 `run`.

## (4) 대체 글을 지운 것이 빈 출력을 만들지 않는가 — 만들지 않는다

- `textOr`(카탈로그가 던지면 영어 대체 글)를 8곳에서 지웠다.
- `createMessageCatalog`의 `format`이 던지는 때는 둘뿐이다. 모르는 id, 그리고 빠지거나 남는 인자다. 값이 범위 밖이면(음수, 정수 아님) 던지지 않고 `?`로 바꾼다(`src/i18n/params.ts`의 `formatParam`).
- 두 카탈로그를 직접 확인했다.
  - `cleanup.ts`가 쓰는 고정 id 21개와 목록 id 21개(남긴 이유 8, 경고 7, 막힘 3, 대상 3)가 en·ko 모두에 있다.
  - 빈 글은 없다(`cleanup.*` 42개).
  - 형(`MessageTexts`)도 모든 id를 요구한다.
- 그래서 정상 빌드에서는 던지는 길이 없고, 출력이 비는 경우도 없다. 정보 I-1을 보라.

## (5) 개수가 1일 때와 여럿일 때

- 영어는 main의 꼴 그대로다(`{count} run(s)`, `{count} apply run(s)`, `{files} file(s)`). B에서 개수 1과 2 모두 main과 같았다.
- 한국어는 `{count}개`라 1과 2가 모두 자연스럽다. 확인한 것:
  - `실행 1개의 기록은` / `실행 2개의 기록은`
  - `적용 실행 1개의 기록은` / `2개의 기록은`
  - `남은 폴더: 2개(60바이트)`
  - `파일 1개, 17바이트`
- 실제 CLI로는 되돌리지 않은 실행 둘을 만들지 못했다. w5의 둘째 실행은 바꾼 파일이 없어 그 경고가 붙지 않았다. 개수 2는 B로만 보았다.

## 정보

- **I-1 (U-34): 카탈로그가 던지면 이제 그대로 올라간다.**
  - `renderCleanup`은 확인한 정리가 끝난 뒤 `runCleanup`의 try 밖에서 불린다. 그래서 던지면 `main.ts`가 `internal_error`(종료 70)로 바꾼다. 그때는 이미 지운 뒤이고, JSON도 사람용 글도 나오지 않는다.
  - 예전에는 8곳이 영어 대체 글로 넘어갔고, 나머지 `format` 호출(`cleanup.done` 등)은 이미 지금과 같았다.
  - 위 (4)대로 정상 빌드에서는 일어나지 않는다. 카탈로그에 id를 빠뜨리는 실수는 형 검사와 카탈로그 시험이 막는다.
- **I-2 (한국어 문체, 고칠 것은 아님):**
  - 대상 이름 뒤에 이유가 같은 말을 되풀이한다: `- 폐기 보관함 <id>: 폐기 보관함 삭제를 확인하지 않음`.
  - 항목 줄의 경고 사이 구분은 영어처럼 `; `다.
- **I-3 (main과 같음):** 영어 대상 이름은 main과 같게 `run`, `discarded`, `leftover`로 두었다. 영어를 바꾸지 않기 위해서다. GUI의 영어는 `run records`, `discarded files`, `leftover folder`라 CLI와 다르다. DR-50의 영어 용어는 "discarded files"다.
- **I-4 (main과 같음, U-34가 만든 것이 아님):**
  - 막힌 계획 실행만 고른 미리보기에는 다음 단계 줄이 없다. 그 확인은 이유 줄 없이 "Nothing was removed."(종료 3)뿐이다.
  - 실행 기록과 남은 폴더가 함께 있는 미리보기의 다음 단계 줄은 "실행 기록을 지우려면"이라고만 한다. 확인하면 남은 폴더도 함께 지워진다.
  - 다음 단계 줄은 옵션 바로 뒤에 마침표가 붙는다(`--confirm abcdef012345.`). 영어도 원래 그렇다.
- **I-5 (보지 못한 것):**
  - 출력으로 보지 못한 글: 경고 `partly_reverted`, `records_unreadable`, `records_changed`, 남긴 이유 `changed`, `not_plain_directory`, `io_error`. 이 글이 두 카탈로그에 있다는 것만 확인했고, 같은 대응(`warningText`, `keptText`)을 지난다.
  - 막힘 `lock_held`는 B로만 보았다.
  - 터미널(TTY)에서의 출력(U-23)은 보지 않았다. 모든 실험은 파이프였다.
  - 그 밖에 보지 않은 것: GUI(이 단위는 `gui/`를 바꾸지 않았다), Linux·macOS.

## 시험 수치

- 판 `5800754`의 사본에서 프로젝트 스크립트로 다시 쟀다. PM 수치와 같다.
  - `npm run test:unit`: 2470개 중 2466 통과, 실패 0, 건너뜀 3, 할 일 1
  - `npm run test:integration`: 559개 중 559 통과, 실패 0
- GUI 시험은 돌리지 않았다. 이 단위는 `gui/`를 바꾸지 않았다.
