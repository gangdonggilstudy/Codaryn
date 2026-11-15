# R-76 검토: U-86 정리 미리보기의 묶음

- 대상: `pm/unit-U-86` = `df426b0`(main `92c75b4` 위, `git diff 92c75b4 df426b0`, 21파일 +1043/−234). 검토자 w3:p7(nd-docs). 이 단위의 코드를 쓰지 않았다.
- 방법: 읽기 전용. 저장소 파일은 하나도 바꾸지 않았다.
  - 빌드 둘: main `92c75b4`(`git archive`), U-86 `df426b0`(`git archive`). 둘 다 `npm run build`.
  - 실제 CLI, 대본 모델, 임시 폴더, 닫힌 루프백 포트(127.0.0.1:9), 키 변수 없음.
  - 기준 상태는 main CLI로 한 번 만들었다. 경우마다 같은 상태의 새 사본을 (빌드, en | ko | `--json`)마다 하나씩 쓰고 같은 인자로 돌렸다.
  - ACL 실험(지우다 실패해 남은 폴더)은 사본에서만 했고 끝에 모두 풀었다.
  - 스크립트 `.codaryn/r76/r76.mjs`, 출력 `.codaryn/r76/r76-out.txt`(1,528줄).
- 결과: **높음 0, 중간 1, 낮음 1, 정보 5.**

## 1. 요청한 여섯 가지의 답

| # | 볼 것 | 결과 |
| --- | --- | --- |
| (1) | `cleanup --json`이 미리보기·확인 뒤 모든 경우에 main과 바이트까지 같은지 | **같다.** R-62의 17가지 경우와 이번에 더한 8가지(X1~X8), 40단계 모두 같다(다이제스트·남은 폴더 id·작업 공간 경로만 같은 규칙으로 바꿔 비교) |
| (2) | 확인 뒤(지운 뒤) 사람용 출력이 main과 같은지 | **같다.** `--confirm`이 든 15단계 모두 en·ko 둘 다 같다. `cleanup_plan_changed`(X7)도 같다 |
| (3) | 미리보기가 말하는 것이 사실과 맞는지 | 18가지 선택에서 그 선택을 네 가지 옵션 조합(없음, `--include-not-reverted`, `--delete-discarded`, 둘 다)으로 각각 새 사본에서 실제로 지워 보았다. **두 곳이 맞지 않는다**: M-1(두 옵션이 다 필요한 항목이 `--delete-discarded` 묶음에만 있다), L-1(막힌 항목 줄이 마지막 묶음에 섞여 보인다). 그 밖은 맞다(아래 2절) |
| (4) | 경고 문장이 main보다 약해지지 않았는지 | 세 문장 자체는 그대로다. 다만 **두 옵션이 다 필요한 항목에는 "되돌리지 않은 실행" 묶음의 문장이 붙지 않는다**(M-1). 전·후는 3절 |
| (5) | 묶음이 비면 머리 줄이 안 나오는지, 고른 것이 없을 때의 예시 명령이 도는지 | **맞다.** 빈 묶음의 머리 줄은 어느 경우에도 나오지 않았다. 예시 두 명령은 `<workspace>`만 바꿔 그대로 돌렸고 둘 다 종료 0이다 |
| (6) | 두 언어, 미리보기 뒤 상태가 바뀌었을 때 | 18가지 모두 ko의 묶음 구성(머리 줄의 수와 항목)이 en과 같다. X7(미리보기 → `revert` → 옛 다이제스트로 확인)은 두 빌드 모두 `cleanup_plan_changed`(종료 2, `category` `state`, `retryable` false)이고 사람용 글도 en·ko 모두 같다 |

## 2. (3)의 대조

각 선택마다 네 가지를 보았다: 묶음 머리 줄의 수가 그 아래 줄 수와 같은가, 묶음에 든 항목이 계획(`--json`의 `plan.items`)과 같은가, 각 묶음의 항목이 그 옵션으로만 지워지는가, 끝의 명령을 그 사본의 미리보기에 찍힌 그대로(다이제스트 포함) 돌리면 말한 것만 지워지는가.

| 기준 상태 | 선택 | 미리보기의 묶음 | 실제 | 끝 명령 |
| --- | --- | --- | --- | --- |
| W1(되돌린 R1, 안 되돌린 R2) | `--older-than 0` | confirm 1, include 1 | 없음 1, include 2, dd 1, 둘 다 2 | 둘 다 말한 대로 |
| W1 | `--run R2` | include 1 | 0, 1, 0, 1 | 말한 대로 |
| W1 | `--reverted` | confirm 1 | 1, 1, 1, 1 | 말한 대로 |
| W5(안 되돌린 실행 둘, 둘째는 바꾼 것 없음) | `--older-than 0` | confirm 1, include 1 | 1, 2, 1, 2 | 둘 다 말한 대로 |
| W2(계획 P1, 적용 A1, 보관함에 파일) | `--older-than 0` | kept 2 | 0, 0, 0, 0 | 명령 없음(맞다) |
| W2 | `--discarded-older-than 0` | dd 1 | 0, 0, 1, 1 | 말한 대로 |
| W2 | `--older-than 0 --discarded-older-than 0` | **dd 3** | 0, 0, **1**, 3 | 말한 대로(둘 다 붙음) |
| W2 | `--run P1` | 막힘 1 | — | 명령 없음 |
| W2 | `--run A1` | kept 1 | 0, 0, 0, 0 | 명령 없음 |
| W2 | `--run A1 --discarded-run A1` | **dd 2** | 0, 0, **1**, 2 | 말한 대로 |
| W2 | `--run P1 --discarded-run A1` | dd 1 + **막힌 줄 1이 그 아래** | 0, 0, 1, 1 | 머리 줄의 수(1)대로. 막힌 줄까지 묶음으로 읽으면 어긋난다(L-1) |
| W4(되돌린 적용 A2와 그 계획, 빈 보관함) | `--older-than 0` | confirm 2 | 2, 2, 2, 2 | 말한 대로 |
| W4 | `--older-than 0 --discarded-older-than 0` | confirm 2, dd 1 | 2, 2, 3, 3 | 둘 다 말한 대로 |
| W3(남은 폴더 1, R2) | 선택 없음 | confirm 1(남은 폴더) | 1, 1, 1, 1 | 말한 대로. 예시 두 명령 종료 0 |
| W3 | `--older-than 0` | confirm 1(남은 폴더), include 1 | 1, 2, 1, 2 | 둘 다 말한 대로 |
| W8(결과 없는 R2) | `--older-than 0` | confirm 1 + **막힌 줄 1이 그 아래** | 1, 1, 1, 1 | 머리 줄의 수(1)대로. 막힌 줄까지 묶음으로 읽으면 어긋난다(L-1) |
| W10(A1의 기록만 지움) | `--older-than 0 --discarded-older-than 0` | confirm 1, dd 1 | 1, 1, 2, 2 | 둘 다 말한 대로 |
| W6(표시 없는 `cleanup-…` 폴더) | `--older-than 0` | confirm 1, include 1 | 1, 2, 1, 2 | 둘 다 말한 대로 |

- "실제" 칸은 옵션 조합 (없음, `--include-not-reverted`, `--delete-discarded`, 둘 다)마다 지워진 항목 수다.
- "`--confirm` 옵션만으로 지우는 것 N개"의 N은 18가지 모두 `--confirm`만 준 실제 삭제 수와 같았다. "남는 것"으로 적힌 항목은 어느 조합으로도 지워지지 않았다.
- W10의 새 요약 줄 `Discarded-files folders whose run has no records left: 1 (17 bytes). No revert can put those files back.`의 수와 크기는 실제(기록을 지운 적용 하나의 보관함, 파일 1개 17바이트)와 같다. 다른 상태에서는 나오지 않았다.

## 3. (4) 경고 문장의 전·후

| 경고 | main `92c75b4` | U-86 `df426b0` |
| --- | --- | --- |
| 지우면 되돌릴 수 없다(묶음) | 머리 줄 아래 `Of these, runs not reverted, only partly reverted, or whose records cannot be checked: {count}. Their records go only with a confirmation of their own; without them those runs can no longer be reverted or put back by hand.` / `그중 되돌리지 않았거나, …: {count}개. 이 기록은 따로 확인해야 지우며, 지우면 그 실행을 더는 되돌릴 수 없고 손으로 되살릴 수도 없습니다.` | `--include-not-reverted` 묶음의 머리 줄에 같은 두 문장이 있다. **이 묶음에 들지 않는 안 되돌린 항목(두 옵션이 다 필요한 것)에는 없다**(M-1) |
| 지우면 되돌릴 수 없다(명령 앞) | `The records of {count} run(s) … are kept unless you add --include-not-reverted yourself; once they are removed, those runs can no longer be reverted.` / `… --include-not-reverted 옵션을 직접 붙이지 않으면 남습니다. 지우면 그 실행은 더는 되돌릴 수 없습니다.` | 없어졌다. 대신 끝의 "모두" 명령이 `--include-not-reverted`를 붙여 준다(I-1) |
| 지우면 되돌릴 수 없다(항목) | `; not reverted: without its records it can no longer be reverted` | 같은 글을 항목 아래 한 줄로 |
| 사람의 파일이며 되살릴 수 없다 | `Discarded files to delete as well: {files} ({bytes} bytes). They are people's own files and cannot be put back.` / `… 사람의 파일이며 되살릴 수 없습니다.` | `Removed only with --delete-discarded besides: … people's discarded files among them. They are people's own files and cannot be put back.` / `… 그 파일은 사람의 파일이며 되살릴 수 없습니다.` 같은 강도 |
| `--delete-discarded`가 따로 필요 | `People's discarded files are deleted only with --delete-discarded besides.` | 묶음 머리 줄 `Removed only with --delete-discarded besides`가 대신한다 |
| 보관함이 남은 적용 실행 | `The records of {count} apply run(s) whose discarded files are still kept stay unless those files are deleted in the same cleanup (--delete-discarded, with their folders selected) or the apply is reverted first; only the records say what the files were.` | 남는 경우: 남는 것 묶음의 머리 줄이 같은 내용(`… or the apply is reverted first; only the records say what the files were.`)이고, 항목 아래 `its discarded files stay, and only its records say what each file was called and where it was`. 지워지는 경우: 항목 경고 줄(main과 같은 글) |

## 4. 지적

### M-1(중간) 두 옵션이 다 필요한 항목이 `--delete-discarded` 묶음에만 있고, 그 묶음의 머리 줄은 `--delete-discarded`만 말한다

- 재현: W2(계획 P1, 안 되돌린 적용 A1, A1의 보관함에 파일 1개). `cleanup --workspace <ws> --older-than 0 --discarded-older-than 0`.
- U-86 미리보기(en, 실제):

  ```
  Removed only with --delete-discarded besides: 3 (7 file(s), 13999 bytes), people's discarded files among them. They are people's own files and cannot be put back.
  - run <A1>: 2 file(s), 6161 bytes
    not reverted: without its records it can no longer be reverted
    an apply run with discarded files: its records are kept unless those files are deleted in the same cleanup, since only the records say what each file was called and where it was
  - run <P1>: 4 file(s), 7821 bytes
  - discarded <A1>: 1 file(s), 17 bytes
    a discarded-files folder: people's own files are deleted

  Nothing was removed. To remove all of the above but what is kept, run the same command with --confirm <digest> --include-not-reverted --delete-discarded
  ```

- 사실: `--confirm <d> --delete-discarded`로는 셋 중 **하나(보관함)만** 지워지고 A1과 P1은 남는다(`not_reverted_not_confirmed`, `used_by_kept_apply`). 둘 다 줘야 셋이 지워진다. 머리 줄 "Removed only with --delete-discarded besides: 3"은 A1과 P1에 대해 틀린다. `--run A1 --discarded-run A1`에서도 같다(2개라 하지만 `--delete-discarded`만으로는 1개).
- 약해진 것:
  - main은 같은 상태에서 A1을 "되돌리지 않은 실행" 머리 줄(`Their records go only with a confirmation of their own; without them those runs can no longer be reverted or put back by hand.`)에 세고, 명령 앞에 `… unless you add --include-not-reverted yourself`를 따로 말했다.
  - U-86에서는 A1에 그 두 문장이 없다. 짧은 항목 경고(`… it can no longer be reverted`, "손으로 되살릴 수도 없다"가 없음)만 남는다. 그런데 끝의 명령은 `--include-not-reverted`를 붙여 준다. 그 명령을 붙여 넣으면 A1의 기록이 지워진다.
  - P1의 줄에는 아무 경고도 없다. 왜 두 옵션이 필요한지(그 적용이 안 되돌린 실행이라서) 말하는 곳이 없다. 계약 주석의 "an item that needs both flags is here, and its warning lines say it was not reverted"는 계획 실행에는 맞지 않는다.
- PM 조건 "main보다 한 마디도 약해지지 않는다"에 걸린다고 본다.
- 고칠 방향(제안): 두 옵션이 다 필요한 항목은 별도 묶음("`--include-not-reverted`와 `--delete-discarded`를 둘 다 주어야 지우는 것", 머리 줄에 두 경고 문장 모두)으로 두거나, `--include-not-reverted` 묶음의 문장을 이 묶음 머리 줄에도 붙인다. 계획 실행 줄에는 "그 적용 실행과 함께 지워짐" 같은 까닭 한 줄을 둔다.

### L-1(낮음) 막힌 항목의 줄이 마지막 묶음의 항목처럼 보이고, 머리 줄의 수와 줄 수가 어긋난다

- 재현 1: W8(결과 없는 R2). `cleanup --workspace <ws> --older-than 0`

  ```
  Removed with --confirm alone: 1 (15671 bytes)
  - run <R1>: 5 file(s), 15671 bytes
  - run <R2>: no result yet (it may still be running)
  ```

- 재현 2: W2, `--run P1 --discarded-run A1`. `Removed only with --delete-discarded besides: 1 …` 아래에 `- discarded <A1>: …`와 `- run <P1>: a plan run that an apply run not selected uses; …`가 나란히 나온다.
- main도 막힌 줄을 같은 자리에 두었지만, main의 항목 줄은 `- <id>: …`(종류 없음)이고 막힌 줄만 `- run <id>: …`라 모양이 달랐다. U-86은 항목 줄에도 종류를 붙여(`- run <id>: …`) 둘이 같은 모양이 됐다.
- 안전한 쪽의 어긋남이다(막힌 항목은 지워지지 않고 그 줄이 까닭을 말한다). 그래도 "무엇을 주면 무엇이 지워지는가"로 묶는 단위의 목적과 어긋난다. 막힌 항목에 머리 줄(예: "고를 수 없는 것: N")을 두면 풀린다.

### 정보

- **I-1 "모두" 명령이 `--include-not-reverted`를 붙인다.** main은 R-34b P-3에 따라 권하는 명령에 그 옵션을 넣지 않았다. 커밋 `5e3e116`("after R-34b P-3")에 의도한 변경으로 적혀 있고, `--include-not-reverted` 묶음의 머리 줄이 잃는 것을 말한다. M-1의 경우만 그 말이 빠진다.
- **I-2 빈 보관함 폴더**(W4, 되돌린 적용): `Removed only with --delete-discarded besides: 1 (0 file(s), 0 bytes), people's discarded files among them.` 파일이 0개인데 "사람의 파일이 들어 있다"고 말한다. main도 `Discarded files to delete as well: 0 (0 bytes). They are people's own files …`였으므로 새로 생긴 것은 아니다.
- **I-3 선택이 없는데 남은 폴더가 있을 때**(W3): `Removed with --confirm alone: 1`과 `--confirm` 명령 뒤에 `No selection option was given, so nothing is selected.`가 온다. 계약 주석이 "Leftovers still show their group above it"라고 정한 대로이지만, 두 글이 나란히 있으면 "아무것도 고르지 않았다"와 "1개를 지운다"가 함께 읽힌다.
- **I-4 모든 항목이 남을 때**(W2 `--older-than 0`, `--run A1`): 명령을 내지 않는다. main은 `--confirm <d>`를 권했고 그 명령은 아무것도 지우지 않았으므로, 이쪽이 사실에 맞다. 끝에 빈 줄 하나가 남는다.
- **I-5 실행이 없는 작업 공간**(W9, 선택 없음): 예시 두 명령을 그대로 보인다. 돌리면 종료 0이고 지울 것이 없다고 나온다.

## 5. 판 수치

- PM 검증: 유닛 2,747건 중 2,743 통과·0 실패, 통합 559.
- 이 검토의 판(`df426b0`을 `git archive`해 빌드, 키 변수 없음, APPDATA를 임시 폴더로): 타입 검사 통과, 유닛 2,747건 중 2,743 통과·0 실패·3 건너뜀·todo 1, 통합 559건 통과. PM의 수와 같다.

## 6. 확인하지 않은 것

- GUI의 정리 화면(이 단위는 CLI·저장·문구만 바꿨다).
- 지우는 도중의 실패(`changed`, `not_plain_directory`, `io_error`, `partly_removed`)를 미리보기가 내다보지 않는 것은 계약 주석대로라 따로 재지 않았다. W3의 실패 경우는 (2)의 같음만 보았다.
- Linux·macOS.


---

# R-76b 좁은 확인: U-86 고친 판

- 대상: `pm/unit-U-86` = `fd9e796`(main `08bee85` 위). R-76이 본 `df426b0` 뒤의 수정: 다섯째 묶음 "`--include-not-reverted`와 `--delete-discarded`를 둘 다 주어야 지워지는 것", 막힌 항목을 맨 끝에 제 머리 줄과 함께. 검토자 w3:p7(nd-docs).
- 방법: R-76의 스크립트를 이 판에 맞춰 다시 돌렸다(`.codaryn/r76b/r76b.mjs`, 출력 `r76b-out.txt`). 읽기 전용.
  - 빌드 둘: main `08bee85`, U-86 `fd9e796`(둘 다 `git archive` 뒤 빌드).
  - 실제 CLI, 대본 모델, 임시 폴더, 닫힌 루프백 포트, 키 변수 없음. ACL 실험은 사본에서만 했고 끝에 풀었다.
  - 2절 대조의 검사를 다섯 묶음과 막힌 줄에 맞게 고쳤다:
    - 각 묶음의 항목이 그 옵션 조합에서만 지워지는가.
    - 묶음의 수를 더한 값이 조합마다 실제 지워진 수와 같은가: `--include-not-reverted` = confirm+include, `--delete-discarded` = confirm+delete, 둘 다 = confirm+include+delete+both.
    - 막힌 항목이 계획의 `blocked`와 같고 모든 묶음의 항목 뒤에 제 머리 줄 아래 있는가.
- 결과: **R-76의 M-1과 L-1은 고쳐졌다. 새 지적 없음**(높음 0, 중간 0, 낮음 0, 정보 0).

## 1. 확인 항목

| 볼 것 | 결과 |
| --- | --- |
| 2절 대조표(18가지 선택 × 네 옵션 조합): 각 묶음의 수가 그 조합으로 실제 지워지는 수와 같은지 | **같다.** 18가지 모두 문제 0건. 끝 명령은 그 사본의 미리보기에 찍힌 그대로(다이제스트 포함) 돌렸고 모두 말한 대로 지웠다(2절) |
| M-1 재현(W2, `--older-than 0 --discarded-older-than 0`): `--delete-discarded`만 주면 지워진다고 말한 수와 실제 | **같다.** `--delete-discarded` 묶음 1개(보관함), `--confirm <d> --delete-discarded`가 실제로 지운 수 1개. 적용 A1과 계획 P1은 "둘 다" 묶음 2개이고 둘 다 줘야 셋이 지워졌다 |
| "둘 다" 묶음에 두 경고가 다 붙는지 | **붙는다.** 머리 줄에 "되돌리지 않은 실행"의 두 문장(따로 확인해야 지움, 지우면 되돌릴 수도 손으로 되살릴 수도 없음)과 "사람의 파일이며 되살릴 수 없음"이 둘 다 있다. en·ko 모두(3절) |
| L-1: 막힌 줄이 앞 묶음 아래에 붙지 않는지 | **붙지 않는다.** 막힌 항목이 있는 세 경우(W2 `--run P1`, W2 `--run P1 --discarded-run A1`, W8) 모두 모든 묶음의 항목 뒤에 `Cannot be removed in this cleanup: 1. …`(`이 정리에서 지울 수 없는 것: 1개. …`) 아래로 나왔다. 머리 줄의 수와 그 아래 줄 수가 같다 |
| `cleanup --json`과 확인 뒤 출력이 여전히 main과 같은지 | **같다.** R-62의 17가지와 R-76의 8가지, 40단계에서 `--json`이 모두 main과 같다. `--confirm`이 든 15단계의 사람용 출력도 en·ko 모두 같다 |
| 두 언어 | 18가지 모두 ko의 묶음 구성(머리 줄 수와 항목)이 en과 같다 |

## 2. 대조표(U-86 `fd9e796`)

"말함"은 미리보기 묶음의 수(confirm / include / delete / both / kept)다. "실제"는 옵션 조합(없음 / `--include-not-reverted` / `--delete-discarded` / 둘 다)마다 지워진 수다.

| 기준 상태 | 선택 | 말함 | 막힌 항목 | 실제 |
| --- | --- | --- | --- | --- |
| W1 | `--older-than 0` | 1 / 1 / 0 / 0 / 0 | 0 | 1 / 2 / 1 / 2 |
| W1 | `--run R2` | 0 / 1 / 0 / 0 / 0 | 0 | 0 / 1 / 0 / 1 |
| W1 | `--reverted` | 1 / 0 / 0 / 0 / 0 | 0 | 1 / 1 / 1 / 1 |
| W5 | `--older-than 0` | 1 / 1 / 0 / 0 / 0 | 0 | 1 / 2 / 1 / 2 |
| W2 | `--older-than 0` | 0 / 0 / 0 / 0 / 2 | 0 | 0 / 0 / 0 / 0(명령 없음) |
| W2 | `--discarded-older-than 0` | 0 / 0 / 1 / 0 / 0 | 0 | 0 / 0 / 1 / 1 |
| **W2** | **`--older-than 0 --discarded-older-than 0`** | **0 / 0 / 1 / 2 / 0** | 0 | **0 / 0 / 1 / 3** |
| W2 | `--run P1` | 묶음 없음 | 1 | —(명령 없음) |
| W2 | `--run A1` | 0 / 0 / 0 / 0 / 1 | 0 | 0 / 0 / 0 / 0(명령 없음) |
| W2 | `--run A1 --discarded-run A1` | 0 / 0 / 1 / 1 / 0 | 0 | 0 / 0 / 1 / 2 |
| W2 | `--run P1 --discarded-run A1` | 0 / 0 / 1 / 0 / 0 | 1 | 0 / 0 / 1 / 1 |
| W4 | `--older-than 0` | 2 / 0 / 0 / 0 / 0 | 0 | 2 / 2 / 2 / 2 |
| W4 | `--older-than 0 --discarded-older-than 0` | 2 / 0 / 1 / 0 / 0 | 0 | 2 / 2 / 3 / 3 |
| W3 | 선택 없음 | 1 / 0 / 0 / 0 / 0 | 0 | 1 / 1 / 1 / 1(예시 두 명령 종료 0) |
| W3 | `--older-than 0` | 1 / 1 / 0 / 0 / 0 | 0 | 1 / 2 / 1 / 2 |
| W8 | `--older-than 0` | 1 / 0 / 0 / 0 / 0 | 1 | 1 / 1 / 1 / 1 |
| W10 | `--older-than 0 --discarded-older-than 0` | 1 / 0 / 1 / 0 / 0 | 0 | 1 / 1 / 2 / 2 |
| W6 | `--older-than 0` | 1 / 1 / 0 / 0 / 0 | 0 | 1 / 2 / 1 / 2 |

## 3. M-1 재현의 미리보기(실제 출력, 실행 id는 그대로)

en:

```
Removed only with --delete-discarded besides: 1 (1 file(s), 17 bytes), people's discarded files among them. They are people's own files and cannot be put back.
- discarded 20261113T014805Z-1a0b0119: 1 file(s), 17 bytes
  a discarded-files folder: people's own files are deleted
Removed only with both --include-not-reverted and --delete-discarded besides: 2 (6 file(s), 13982 bytes). Among them are runs not reverted, only partly reverted, or whose records cannot be checked. Their records go only with a confirmation of their own; without them those runs can no longer be reverted or put back by hand. Among them are also people's discarded files. They are people's own files and cannot be put back.
- run 20261113T014805Z-1a0b0119: 2 file(s), 6161 bytes
  not reverted: without its records it can no longer be reverted
  an apply run with discarded files: its records are kept unless those files are deleted in the same cleanup, since only the records say what each file was called and where it was
- run 20261113T014804Z-e90de6cf: 4 file(s), 7821 bytes

Nothing was removed. To remove all of the above but what is kept, run the same command with --confirm <digest> --include-not-reverted --delete-discarded
```

ko의 "둘 다" 머리 줄:

```
--include-not-reverted 옵션과 --delete-discarded 옵션을 둘 다 주어야 지우는 것: 2개(파일 6개, 13982바이트). 되돌리지 않았거나, 일부만 되돌렸거나, 기록을 확인할 수 없는 실행이 들어 있습니다. 이 기록은 따로 확인해야 지우며, 지우면 그 실행을 더는 되돌릴 수 없고 손으로 되살릴 수도 없습니다. 폐기 보관함의 파일도 들어 있습니다. 그 파일은 사람의 파일이며 되살릴 수 없습니다.
```

- R-76 M-1에서 지적한 "계획 실행 줄에 까닭이 없음"은 그대로다(P1 줄에 경고 줄이 없다). 묶음 머리 줄이 "Among them are …"로 묶음 전체를 말하므로 틀린 말은 없어졌다. 지적으로 다시 세지 않는다.
- 이 경우 `--delete-discarded` 묶음에는 보관함 하나만 남아, 머리 줄의 "people's discarded files among them"이 맞는다.

## 4. 판 수치

- 이 확인의 판(`fd9e796`을 `git archive`해 빌드, 키 변수 없음, APPDATA를 임시 폴더로): 타입 검사 통과, 유닛 2,821건 중 2,817 통과·0 실패·3 건너뜀·todo 1, 통합 559건 통과.
