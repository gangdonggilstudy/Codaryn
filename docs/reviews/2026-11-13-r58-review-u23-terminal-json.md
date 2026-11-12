# R-58 병합 전 검토: 단위 U-23, 터미널에서는 JSON 줄을 내지 않는다 (w3:p4, 2026-11-13)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어. 읽기 전용이며 저장소 수정·커밋은 없다.
- **검토한 판: `pm/unit-U-23` = `9905a72`**(main `0ad28bc` 위, 10파일 404줄). 비교판은 main `0ad28bc`.
  - 고친 곳
    - `src/cli/guard.ts`: `jsonLineLeftOut`, `stdoutText`
    - `src/cli/main.ts`: stdout에 쓰기, 인자 없는 실행
    - `src/cli/help.ts`: `helpRequest`, `run`·`revert` 옵션 목록, `apply` 설명
    - `src/cli/args.ts`: `run`·`revert`·`apply`의 `--json`
    - `src/i18n/en.ts`·`ko.ts`: `help.output`
    - `docs/cli-contract.md:600-618`
- 사본: `.codaryn/r58/u`(`git archive 9905a72`), `.codaryn/r58/m`(`git archive 0ad28bc`). 둘 다 `npm run build` 성공. 확인 뒤 지웠다.
- 실험: `r58/r58.mjs`(구역 A, B, F, J, E)와 `r58/aq.mjs`. 로그는 `r58/*.log`.
  - 모든 CLI 호출은 시험의 네트워크 막이(`dist/tests/support/net-guard.js`)를 `--import`로 얹었다. 주소는 쓰지 않았고 대본(scripted) 모델만 썼다. 키 변수는 넘기지 않았다(`models`는 키 없음 오류까지만 간다).
  - 기본 설정 위치(`APPDATA`, `HOME` 등)는 매번 시험 폴더로 돌렸다.
  - "터미널"은 시험과 같은 미리 읽기 방식으로 만들었다. `r58/tty.mjs`가 `process.stdout`·`stderr`·`stdin`의 `isTTY`를 참으로 표시한다(100칸). 모드는 셋이다.
    - pipe: 아무것도 터미널이 아님
    - out: stdout만
    - full: stdout, stderr, stdin
  - 비교할 때 실행 id, 시각, 소요 시간, 임시 폴더 이름, 해시, 다이제스트, 바이트 수만 치환했다. 기록 크기는 실행마다 한두 바이트씩 달라진다.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 2 (R58-L1, L2) |
| 정보 | 5 (R58-I1~I5) |

| 볼 것 | 결과 |
| --- | --- |
| (1) 터미널이 아닐 때 main과 같은지 | **같다.** 출력 54가지 × 두 언어 가운데 50가지가 stdout·stderr·종료 코드까지 main과 같다(A) |
| | - 명령: `run`(완료, 검증 실패, 턴 한도, 계획 실행, `--quiet`), `plan`(글, `--json`), `review`, `apply`(완료, 틀린 다이제스트, 두 번째), `report`(글, `--json`, `latest`), `runs`(글, `--json`), `changes`(글, `--json`) |
| | - 명령(이어서): `revert`(`--dry-run`, 되돌림, 두 번째, 문서 실행), `cleanup`(미리보기, `--json`), `doctor`(글, `--json`), `models`(키 없음, 글과 `--json`), `init`(글, `--json`), 도움말 넷, `--version` |
| | - 오류 열네 가지: 인자, 없는 파일, 모르는 명령, 없는 실행, 잠긴 작업 공간 등 |
| | - 다른 넷은 모두 도움말 글이다: `--help`, `help run`, `revert --help`, `apply --help`(의도, (5)) |
| | - 인자 없는 실행도 main과 같다: `invalid_arguments`, 종료 2, stdout 글자까지(E) |
| (2) 터미널일 때(stdout만) | **JSON 줄이 빠지는 것은 결과 JSON과 오류 JSON뿐이다.** 한 언어에 25가지씩, 두 언어 모두 그렇다(B) |
| | - 빠지는 것: `run`·`apply`·`revert`의 결과, 모든 명령의 오류(`models`의 키 없음, `review`의 거부 포함) |
| | - 모두 stderr에 사람용 글(끝 요약, 되돌림 요약, 오류 설명)이 그대로 있다. 종료 코드는 터미널이 아닐 때와 같다. stderr는 main을 터미널에서 돌린 것과 바이트까지 같다 |
| | - 아무것도 보이지 않는 경우는 없었다 |
| | - 빠지지 않는 것: 글 출력과 모든 `--json`(`plan`, `review`, `report`, `runs`, `changes`, `cleanup`, `doctor`, `models`, `init`, 오류 포함), `--quiet`. 터미널이 아닐 때와 바이트까지 같다 |
| | - 인자 없는 실행: 터미널이면 `--help`와 같은 글, 종료 0, stderr 없음. 두 언어 모두 그렇다(E2) |
| (3) `--json`이 섞일 때 | **계약대로다**(J, 터미널과 아닐 때 모두) |
| | - `run`·`revert`·`apply`의 `--json`은 앞에 있어도 뒤에 있어도, `--quiet`·`--allow-unsafe-move`·`--dry-run`과 함께여도 받는다 |
| | - 두 번 주면 `invalid_arguments`다. `--dry-run`과 `--allow-unsafe-move`를 함께 줘도 예전처럼 거부된다 |
| | - `--JSON`, `--json=1`은 세지 않는다. 터미널에서는 JSON이 빠지고 설명만 나온다 |
| | - 명령 앞의 `--json`, 값 자리의 `--json`·`--quiet`(`--note --json` 등)는 `invalid_arguments`다. 그래도 인자에 있으므로 터미널에서도 JSON이 나온다(R58-I2) |
| (4) 가장자리, 앱 계층·GUI | - **stdout은 터미널인데 stderr만 파일로 돌리면 터미널에 아무것도 안 나온다.** 성공도 오류도 그렇다(R58-L1) |
| | - stdout과 stderr, stdin 모두 터미널(F): apply의 `[y/N]` 질문 뒤 `n`이면 오류 설명만 나오고, `y`이면 끝 요약만 나온다. `--json`을 주면 JSON 한 줄이 함께 나온다 |
| | - 앱 계층과 GUI는 `main.ts`를 거치지 않는다. 새 판정(`stdoutText`, `helpRequest`)을 쓰는 곳은 `main.ts`뿐이다. GUI는 CLI가 아니라 자기 엔진 호스트를 띄운다(`gui/src/main/engine-client.ts:65`) |
| | - **GUI 유닛 171건 중 171, 연기 시험 182건 중 182 통과, 앱 종료 0**(`9905a72`, 한 번) |
| (5) 도움말 글 | - `help.output` 두 언어의 둘째·셋째 문장은 동작과 맞다 |
| | - `apply` 설명("터미널에서는 `--json`일 때만")은 `--quiet`를 빠뜨렸다 |
| | - `run`·`revert`의 `--json` 옵션 글은 `report`의 것을 그대로 썼다 |
| | - 첫 문장은 너무 넓게 말한다(R58-L2) |

## 2. 낮음

### R58-L1 stdout이 터미널이고 stderr만 돌리면 화면에 아무것도 남지 않는다

- 위치: `src/cli/guard.ts`의 `jsonLineLeftOut`. stdout이 터미널인지만 본다. JSON 줄을 빼는 까닭은 "사람용 글이 stderr에 보이기 때문"이다(같은 파일의 주석, 계약 600행). 그러나 stderr가 화면에 있는지는 보지 않는다.
- 재현(E1, `E.log`): stdout만 터미널로 표시하고 stderr를 파일로 받는다. 화면에서 `codaryn run --task doc.json 2> log.txt`를 친 것과 같다.
  - 완료한 실행: 종료 0, 화면(stdout) 0바이트, 파일 723바이트
  - 인자 오류(`run --bogus`): 종료 2, 화면 0바이트, 파일 178바이트
  - `--json`을 주면 JSON 한 줄이 화면에 나온다
  - main은 두 경우 모두 화면에 JSON을 냈다
- 영향: 진행 줄을 파일로 모으려고 stderr만 돌리는 것은 흔하다. 이때 사람은 성공했는지, 실행 id가 무엇인지 화면에서 알 수 없다. 오류도 보이지 않는다.
  - 계약(`docs/cli-contract.md:613`)에는 "이때는 `--json`을 준다"고 적었지만, 도움말(`help.output`)에는 없다.
- 고칠 방향(제안): stdout과 stderr가 **둘 다** 터미널일 때만 JSON 줄을 뺀다. stdout이 터미널이므로 기계가 읽는 출력에는 영향이 없다. 시험 하나(stdout만 터미널)는 그대로 통과하지 않으므로 함께 고쳐야 한다.

### R58-L2 도움말 몇 곳이 실제 동작과 어긋난다

- `apply --help`의 설명(`src/cli/help.ts:23-27`): "At a terminal the result's JSON line is printed only with --json (DR-49)."
  - 실제로는 `--quiet`여도 낸다. 터미널(stdout)에서 `apply --quiet`는 종료 0, stdout에 `apply`/`done` JSON 한 줄, stderr 0바이트였다(`aq.mjs`, `AQ.log`).
  - 사람이 읽는 도움말에 결정 번호 `(DR-49)`가 나온다.
  - 이 설명은 한국어 도움말에서도 영어다. 기존 설명도 영어이므로 새로 생긴 것은 아니다.
- `run --help`, `revert --help`의 `--json` 줄은 `help.option.json`("결과를 JSON 한 줄로 냅니다")을 그대로 쓴다(A의 차이 줄).
  - 실제 뜻은 "터미널에서도 JSON 한 줄을 낸다"다. `run`은 파이프에서는 `--json` 없이도 JSON 한 줄을 낸다.
  - `report`·`doctor`처럼 "글 대신 JSON"으로 읽힌다.
- `help.output` 첫 문장: "터미널에서는 stderr의 사람용 줄(진행 줄, 요약, 오류 설명)만 보입니다."
  - 터미널에서도 `report`, `runs`, `plan`, `doctor`, 도움말 같은 글 출력은 stdout에 보인다(B).
  - stderr를 돌리면 아무것도 보이지 않는다는 말(R58-L1)이 없다.
  - 둘째 문장(`run`·`revert`·`apply`의 결과와 오류)과 셋째 문장(`--quiet`)은 J·B에서 본 동작과 맞다.
- 고칠 방향(제안)
  - `apply` 설명은 "`--json`이나 `--quiet`일 때만"으로 고치고 `(DR-49)`를 뺀다.
  - `run`·`revert`에는 "터미널에서도 결과 JSON 줄을 낸다"는 별도 옵션 글을 둔다.
  - `help.output` 첫 문장은 `run`·`revert`·`apply`와 오류로 좁힌다.

## 3. 정보

- **R58-I1 계약의 한 줄이 이 판과 맞지 않는다.** `docs/cli-contract.md:618`은 "문구 `help.output`은 아직 예전 규칙을 말한다. 고치는 것은 문구 담당의 몫이다"라고 적었다. 그러나 이 판에는 nb-i18n의 고친 문구(`f970f48`)가 이미 들어 있다.
- **R58-I2 `--json`·`--quiet`는 어디에 있어도 센다.** 그래서 해석하지 못한 인자에서도 터미널에 JSON이 나온다.
  - 예: `codaryn --json run --task …`, `review … --note --json`, `review … --note --quiet`. 모두 `invalid_arguments`다. `--quiet`가 있으면 오류 설명도 나오지 않는다.
  - 계약 609행("해석하지 못한 경우도 같다")과 맞다.
  - `--JSON`, `--json=1`은 세지 않는다.
- **R58-I3 터미널이 아닐 때의 새 동작은 `--json`을 받는 것뿐이다.** main에서는 `run`·`revert`·`apply`에 `--json`을 주면 `invalid_arguments`(종료 2)였다. 이제는 그대로 실행한다(J).
  - 예: `apply --json`에 틀린 다이제스트를 주면 이제 `plan_not_approved`다.
  - 도움말 넷을 빼면, 터미널이 아닐 때 main과 다른 출력은 이것뿐이다.
- **R58-I4 흉내의 한계.** 셋 모두 터미널로 표시한 `init`은 질문 뒤 종료 13(Node의 끝나지 않은 최상위 await)으로 끝났다. 판과 main이 같다. stdin이 실제 터미널이 아니라 파이프라서 생긴 것으로 보고 세지 않았다. `init --json`은 묻지 않고 JSON 한 줄을 냈다.
- **R58-I5 판정은 `process.stdout.isTTY`다.** Windows 콘솔과 Windows Terminal에서는 참이다. winpty 없이 쓰는 Git Bash(mintty)에서는 stdout이 파이프로 보여 예전처럼 JSON이 나올 것이다(돌려 보지 않음).

## 4. 검사하지 않은 범위

- 실제 콘솔 창(미리 읽기로 흉내 냈다), mintty, macOS·Linux
- 실제 API가 필요한 `models` 목록과 `init`의 모델 질문
- 루트 유닛·통합 시험 전체 재실행(PM이 이 판에서 잰 수치를 받았다)

## 5. PM 판단 필요

- **Q-1(R58-L1)**: JSON 줄을 stdout과 stderr가 둘 다 터미널일 때만 뺄지. 지금은 stdout만 본다. 가정: 둘 다 볼 때 DR-49의 까닭("사람용 글이 보인다")과 맞는다.

사용자에게 물을 질문은 없다.
