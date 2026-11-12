# R-69 병합 전 검토: 단위 U-37, 인자·task·설정 오류의 이유 힌트 (w3:p4, 2026-11-13)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어(보안 검토 포함). 읽기 전용이며 저장소 수정·커밋은 없다.
- **검토한 판: `pm/unit-U-37` = `91e190a`**(main `4010905` 위, 21파일 832줄). 비교판은 main `4010905`.
  - 들어 있는 브랜치는 셋이다: `unit/U-37-p4g-general`(계약 `8cb38f1`), `nb-i18n`, `na-core`. 사람용 렌더러(`src/cli/human`)는 바뀌지 않았다.
- 사본: `.codaryn/r69/u`(`91e190a`), `r69/m`(`4010905`). 둘 다 `npm run build` 성공. 확인 뒤 지웠다.
- 실험
  - `r69/r69.mjs`: 사례 93가지 × 판 둘 × 언어 둘. 로그 `H.log`
    - 인자 오류 40, 이 이유가 아닌 오류 13, 입력 10, 설정 6, 키 8, 제공자 설정 4
    - 키 모양 글을 여러 자리에 친 경우 12
  - `r69/fs.mjs`: 판의 사람용 오류 전체를 두 언어로(`FS.log`)
  - `r69/pos.mjs`: 판의 해석기가 주는 `unknown_option` 순번(`POS.log`)
  - 모든 CLI 호출은 stdout이 터미널이 아니다. 시험의 네트워크 막이를 얹었다. 대본(scripted) 모델만 썼고, 키 변수는 넣지 않았다(모든 사례가 모델을 만들기 전에 멈춘다).
  - 키 모양 글은 조각을 이어 실행 중에만 만들었다(G-10). 로그에는 보였는지만 적었다.
  - 기본 설정 위치는 시험 폴더로 돌렸다. 비교할 때 임시 폴더 경로만 `<base>`로 바꿨다.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 1 (R69-M1) |
| 낮음 | 3 (R69-L1~L3) |
| 정보 | 6 (R69-I1~I6) |

| 볼 것 | 결과 |
| --- | --- |
| (1) 오류 JSON | **`hint` 말고는 main과 바이트까지 같다.** 오류가 난 사례는 두 언어 모두, 판의 stdout에서 `,"hint":"…"` 한 조각을 빼면 main과 같다 |
| | - `message`(사용법 묶음 포함), `code`, `diagnostic`, 종료 코드가 같다 |
| | - 세부 값(순번, 필드, 빠진 설정)은 JSON에 없다(심볼 키) |
| (2) 힌트가 사실과 맞는지 | **붙은 힌트는 뜻이 모두 참이다.** 하나만 예외다(R69-L1). 일으킨 경우: |
| | - `unknown_command`: 명령 없음, 모르는 명령, `help` 뒤의 모르는 명령, `--json`만 |
| | - `version_no_json`: `--version --json`, `version x`, `-v x` |
| | - `workspace_goal_together`: `--workspace`만, `--goal`만 |
| | - `unknown_option`: 열한 명령의 모르는 옵션과 되풀이한 옵션. 순번 17가지가 모두 맞다(`POS.log`) |
| | - `apply_needs_run_id`: `--run latest` |
| | - `digest_form`: `XYZ`, 짧음, 대문자, `cleanup --confirm zz` |
| | - `review_needs_verdict`: 판정 없음, 둘 다 |
| | - `run_id_form`: `report`·`revert`·`plan`·`changes`·`review`의 `--run` |
| | - `task_file_unreadable`: 없는 파일과 폴더(`run`, `plan`) |
| | - `input_too_large`: 1 MiB보다 큰 task·설정 파일 |
| | - `input_inside_workspace`: 작업 공간 안의 task·설정·변수 파일. 취소 파일에도 붙는다(R69-L1) |
| | - `profile_needs_config`(`run`과 `plan`의 간편 형식), `profile_not_found` |
| | - `task_type_not_found`: `--workflow nope`, task의 `workflowRef: "nope"` |
| | - `key_in_goal`: 간편 형식과 한 줄 실행 |
| | - `key_in_task`, `key_in_config`: 값, 필드, 깨진 파일 |
| | - `provider_settings_missing`: 아무것도 없음, 키만 없음, 간편 형식, `models` |
| | - **값을 받는 힌트 넷(`unknown_option`, `key_field_in_task`·`key_field_in_config`, `provider_settings_missing`)은 사람용 줄이 없다**(R69-M1) |
| (3) 친 값이 되풀이되는지 | **되풀이되지 않는다.** 키 모양 글을 친 열두 자리 모두, 두 판·두 언어의 stdout과 stderr에 그 글(앞 24자도)이 없다 |
| | - 열두 자리: 옵션 이름 자리(`run`, `cleanup`, `changes`), 명령 낱말, `help` 뒤, `--workflow`, `--profile`, `report`·`cleanup`의 `--run`, 덤으로 붙은 낱말, `--task`, `--config` |
| | - 키 사례 여덟도 같다 |
| | - 힌트 글은 옵션을 순번으로만 말한다 |
| (4) 틀리게 붙는 힌트 | - 작업 공간 안의 취소 파일에 "task, 설정, 변수 파일" 힌트가 붙는다(R69-L1) |
| | - 같은 이유인데 힌트가 없는 곳이 둘 있다: `runs`의 옵션 오류, `cleanup --run`의 id 꼴(R69-L2) |
| | - 이 이유가 아닌 열세 가지 오류에는 힌트가 없다(맞다): 값이 없는 옵션, `run`만, task와 간편 형식을 함께, 프로필 이름 꼴, `--env-file`, `--dry-run`과 `--allow-unsafe-move`, 긴 `--note`, 작업 종류 id 꼴, `--run` 없는 `apply`, 없는 설정·변수 파일, 없는 실행 |
| (5) 두 언어, 고치는 법 줄 | - 힌트 줄은 두 언어 모두 고치는 법(과 `점검:`) 줄 다음 줄에 나온다. 한국어는 뜻이 영어와 같다 |
| | - 두 경우에 고치는 법 줄과 어긋난다(R69-L3): `--workflow`가 틀린 간편 형식, 설정 파일 없이 준 `--profile` |
| | - `unknown_command`는 고치는 법 줄과 같은 안내(`codaryn --help`)를 되풀이한다(R69-I5) |

## 2. 중간

### R69-M1 가장 흔한 옵션 오류와 빠진 제공자 설정에는 사람용 이유 줄이 없다

- 위치: `src/cli/human/output.ts:263`. 렌더러는 `CLI_ERROR_HINTS`에 든 힌트만 그린다. 계약은 값을 받는 힌트(`DETAILED_CLI_ERROR_HINTS`)를 일부러 따로 두었다(`src/contracts/engine.ts`, "a renderer that knows only those leaves these lines out rather than fail").
  - 그러나 이 판에는 `CLI_ERROR_HINT_DETAIL`을 읽어 `error.hint.unknown_option`, `error.hint.key_field_in_*`, `error.hint.provider_settings_missing`, `error.missing.*`를 그리는 코드가 없다. 판의 브랜치 셋 가운데 렌더러 담당은 없다.
- 재현(`H.log`, 판 `91e190a`, 두 언어)
  1. `codaryn run --bogus`(그리고 `--task` 되풀이, `report`·`plan`·`changes`·`cleanup`·`revert`·`review`·`apply`·`doctor`·`models`·`init`의 모르는 옵션)
     - JSON에는 `"hint":"unknown_option"`이 붙는다.
     - stderr는 main과 같은 두 줄뿐이다: `codaryn: 오류 — 명령 인수가 올바르지 않습니다 (invalid_arguments)`, `고치는 법: …`.
     - 카탈로그의 `명령어 뒤 {position}번째 인수는 이 명령이 받지 않는 옵션이거나 두 번 준 옵션입니다 …`는 나오지 않는다.
  2. `provider: "anthropic"`인 task로 `run`(키·모델·출력 상한 모두 없음), 그리고 `codaryn models`(키 없음)
     - JSON에는 `"hint":"provider_settings_missing"`이 붙는다.
     - stderr에는 `error.hint.provider_settings_missing`과 `error.missing.*` 줄이 없다. main과 같다.
  3. 키 필드 두 경우(`key_field_in_*`)는 실제 CLI로 일으키지 못했다(R69-I4). 같은 까닭으로 그려지지 않는다.
- 영향
  - 이 단위가 고치려던 것은 "사람용 오류가 일반 문장 한 줄뿐이고 이유는 영어 `message`에만 있다"(UXM-2, U-19 조사)이다.
  - 이유가 가장 자주 필요한 두 경우가 그대로다: 모르는·되풀이한 옵션, 실행 전 빠진 키·모델·출력 상한. 한국어 사용자는 여전히 영어 JSON `message`를 봐야 한다.
  - 유닛 시험은 세부 값이 심볼 키로 실리는 것까지만 본다(`tests/unit/cli/g-u37-cli-hints.test.ts`). 사람용 줄은 보지 않는다(코드로 봄).
- 고칠 방향(제안)
  - 렌더러(N-C)가 `CLI_ERROR_HINT_DETAIL`을 읽어 네 힌트의 줄을 그린다. `provider_settings_missing`은 그 뒤에 `error.missing.*` 항목 줄을 둔다.
  - 이 판에 렌더러 브랜치를 더하거나, 그리기 전까지는 병합하지 않는다. 판단은 PM의 몫이다(Q-1).

## 3. 낮음

### R69-L1 작업 공간 안의 취소 파일에 "task, 설정, 변수 파일" 힌트가 붙는다

- 위치: `src/cli/run.ts:723`. 입력 파일 위치 검사 하나가 task, 설정, 변수 파일과 `--cancel-file`(`invalid_arguments`, 717행)에 함께 `input_inside_workspace`를 붙인다.
- 재현(`FS.log`): `codaryn run --task <task> --cancel-file <작업 공간>\cancel.txt`
  - 종료 2, `invalid_arguments`, `"hint":"input_inside_workspace"`
  - 사람용 줄: `An input file (task, config or variables file) is inside the workspace, …` / `입력 파일(task, 설정, 변수 파일)이 작업 공간 안에 있거나 …`
  - 취소 파일은 셋 가운데 어느 것도 아니다. 그 오류의 `message`는 `the file given by --cancel-file is inside the workspace …`로 맞게 말한다.
- 고칠 방향(제안): 취소 파일에는 따로 힌트를 두거나 이 힌트를 붙이지 않는다. 또는 힌트 글을 "입력 파일(task, 설정, 변수, 취소 파일)"로 넓힌다.

### R69-L2 같은 이유인데 힌트가 없는 곳이 둘 있다

- `codaryn runs --bogus`: `invalid_arguments`, `unknown or repeated option. …`인데 `hint`가 없다. `runs`의 해석기(`src/cli/runs.ts:59, 64`)는 이 단위에서 바뀌지 않았다. 다른 열한 명령은 `unknown_option`이다.
- `codaryn cleanup --workspace <ws> --run !`: `--run takes run ids separated by commas …`인데 `hint`가 없다(`src/cli/cleanup.ts:129`). 다른 다섯 명령의 `--run` 꼴 오류는 `run_id_form`이다.
- 영향: 두 명령에서만 이유 줄이 없고 JSON의 `hint`도 없다. R69-M1과 달리 이것은 붙이는 쪽의 빈 곳이다.

### R69-L3 두 경우에 힌트와 고치는 법 줄이 다른 것을 말한다

- `codaryn run --workspace <ws> --goal g --workflow nope --config <cfg>`(`FS.log`)
  - 머리 줄은 `the config file cannot be read or has an invalid value (invalid_config)`이고, 고치는 법은 `Fix the named field in the config file. …`이다.
  - 힌트는 `The task type given (with --workflow …) … check its name.`이다.
  - 설정 파일에는 틀린 필드가 없다. 틀린 것은 인자다. 사람은 두 안내 가운데 어느 쪽을 따를지 모른다.
- 설정 파일 없이 준 `--profile p`
  - 고치는 법은 "설정 파일의 알려 준 필드를 고치라"이고, 힌트는 "--profile에는 설정 파일이 필요하다"이다. 고칠 설정 파일이 없다.
  - 고치는 법 줄의 뒷문장("설정 파일이 없으면 codaryn init")은 힌트와 맞는다.
- 머리 줄과 고치는 법 줄은 예전부터 있던 일반 글이다. 힌트가 더 정확해지면서 둘이 어긋나 보이게 됐다.
- 고칠 방향(제안): 힌트가 있을 때 고치는 법 줄을 힌트로 갈음하거나, 일반 고치는 법 줄을 "알려 준 이유를 보고 고치라"처럼 넓힌다.

## 4. 정보

- **R69-I1 JSON과 종료 코드는 main과 같다.** `hint`가 붙는 오류는 21~35바이트(`,"hint":"<힌트>"`)가 늘 뿐이다. `message`의 사용법 묶음(명령 없음, 모르는 명령, `run`·`revert`의 옵션 오류)도 같다.
  - 다른 사례는 하나다. 1 MiB보다 큰 변수 파일은 오류가 아니라 실행이 돌았다(R69-I3). 실행 id만 다르다.
- **R69-I2 키 모양 글은 어디에도 되풀이되지 않는다.** 위 (3)과 같다. 모르는 옵션 자리의 키 모양 글은 순번으로만 다뤄진다(`hint` 값과 세부 값 모두). 두 판 모두 그렇다.
- **R69-I3 1 MiB보다 큰 변수 파일은 막지 않는다.** `--vars-file`의 1 MiB 넘는 파일로도 실행이 `needs-input`(검증기 없음)까지 갔다(두 판 같음). `input_too_large`는 task·설정 파일만이다. 힌트 글("입력 파일이 1 MiB보다…")은 그 범위를 말하지 않지만, 붙는 곳이 그 둘뿐이라 틀리지는 않다.
- **R69-I4 `key_field_in_task`·`key_field_in_config`는 일으키지 못했다.**
  - task의 `model.apiKey`와 설정의 `apiKey`(키 필드)는 `message`가 필드를 말하는데도 위치가 스키마 경로가 아니라서 그냥 `key_in_task`·`key_in_config`다.
  - 키 모양 값은 글 검사가 먼저 잡아 역시 `key_in_*`다.
  - 시험 주석은 "JSON 검사가 스키마 필드 경로에서 찾은 키 값"이라고 한다. 지금 키 값(환경 변수의 값)이 task에 있을 때로 보이지만, 키 변수에 값을 넣는 실험은 하지 않았다.
- **R69-I5 `unknown_command`는 고치는 법 줄과 같은 안내를 되풀이한다.**
  - 고치는 법은 `… codaryn --help로 명령 목록을 확인하세요.`이고, 힌트는 `… 명령 목록은 codaryn --help로 확인하세요.`이다.
  - 또 `codaryn --quiet run …`처럼 옵션을 명령 앞에 둔 경우에도 이 힌트("명령이 없거나, 준 낱말이 명령이 아님")다. 참이지만, 옵션을 명령 뒤에 두라는 말은 없다.
- **R69-I6 작업 공간 안의 설정 파일은 한도 비교 뒤에야 걸린다.** 한도가 든 설정을 작업 공간 안에 두면, 먼저 `limits.maxTotalTokens in the task must not exceed …`(`invalid_task`, 힌트 없음)로 끝난다. 한도가 없는 설정이면 `input_inside_workspace`다. 두 판 같은 순서라 이 단위의 것은 아니다.

## 5. 검사하지 않은 범위

- 터미널일 때(지시대로 터미널이 아닐 때만 봤다. 사람용 줄은 stderr라 같다)
- 읽기 권한이 없는 task 파일(없는 파일과 폴더로 대신했다)
- 지금 키 값이 든 task·설정(R69-I4)
- 모델 자리표시자(`model_placeholder`)와 OpenAI 제공자의 빠진 설정(R69-M1 때문에 사람용 줄이 없으므로 JSON의 `hint`만 같다)
- 루트 유닛·통합 시험 재실행(PM이 이 판에서 잰 수치를 받았다)

## 6. PM 판단 필요

- **Q-1(R69-M1)**: 값을 받는 힌트 넷의 렌더러를 이 단위에 더할지, 다른 단위(N-C)로 미루고 지금 병합할지. 미루면 가장 흔한 두 오류에는 이유 줄이 없는 채로 남는다. 가정: 더한 뒤 좁게 다시 본다.

사용자에게 물을 질문은 없다.


---

# R-69b 좁은 확인: 단위 U-37 고친 판 (w3:p4, 2026-11-13)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어(보안 검토 포함). 읽기 전용이며 저장소 수정·커밋은 없다.
- **검토한 판: `pm/unit-U-37` = `3dacc60`**(main `123815a` 위). 비교판은 main `123815a`.
- R-69(`91e190a`) 뒤의 U-37 수정
  - `6b3701d`: 렌더러(`src/cli/human/output.ts`)가 값을 받는 힌트 넷을 그린다. `runs`의 옵션 오류에 `unknown_option`을 붙였다.
  - `0232570`: 작업 공간 안의 취소 파일에는 입력 힌트를 붙이지 않는다. `cleanup --run`의 꼴 오류는 `run_id_form`이다.
  - 시험은 `f59df56`과 `6b3701d`에 있다.
- 사본: `.codaryn/r69b/u`(`3dacc60`), `r69b/m`(`123815a`). 둘 다 `npm run build` 성공. 확인 뒤 지웠다.
- 실험: R-69의 `r69.mjs`를 그대로 쓰고(`r69b/r69b.mjs`) 사례 여섯을 더했다. 99가지 × 판 둘 × 언어 둘, 로그 `r69b/H.log`.
  - 더한 사례
    - 첫 글자를 `s`으로 쓴 키 모양 값: task의 `goal`, task의 `policy.protectedPaths`, 설정의 `model`
    - 작업 공간 안의 대본 파일
    - 설정의 모델 자리표시자(`<model id>`)
    - OpenAI task의 빠진 설정
  - stdout은 터미널이 아니다. 시험의 네트워크 막이를 얹었다. 대본(scripted) 모델만 썼고, 키 변수는 넣지 않았다.
  - 키 모양 글은 조각을 이어 실행 중에만 만들었다(G-10). 로그에는 보였는지만 적었다.

## 1. 요약

| 심각도(새로 찾은 것) | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 1 (R69b-L1) |
| 정보 | 1 (R69b-I1) |

| 볼 것 | 결과 |
| --- | --- |
| **M1** `unknown_option` | **닫혔다.** 두 언어 모두 고치는 법 줄 다음에 한 줄이 나온다. 순번은 쓴 그대로다 |
| | - 확인한 순번: `run --bogus` → 1, `run --task t --bogus` → 3, `changes --json --json` → 2, `runs --bogus` → 1 |
| | - 영어: `Argument 3 after the command word is an option this command does not take, or one given twice; codaryn help <command> lists its options.` |
| | - 한국어: `명령어 뒤 3번째 인수는 이 명령이 받지 않는 옵션이거나 두 번 준 옵션입니다. 받는 옵션은 codaryn help <명령>으로 확인하세요.` |
| | - `--quiet`를 두 번 준 경우는 `--quiet` 때문에 사람용 줄이 아예 없다(맞다) |
| **M1** `provider_settings_missing` | **닫혔다.** 머리 한 줄 아래에 빠진 설정이 하나씩 `- ` 항목으로, 키·모델·출력 상한 순서로 나온다. 두 언어 같다 |
| | - 아무것도 없음: 셋 |
| | - 모델과 출력 상한이 있는 task: 키 하나 |
| | - `models`(키 없음): 키 하나 |
| | - 자리표시자 모델: `- model: only a placeholder is set (…)` / `- 모델: 자리표시자만 있습니다(…)` |
| | - OpenAI: `OPENAI_API_KEY`, `CODARYN_OPENAI_MODEL`, `providers.openai.model`, `providers.openai.maxOutputTokens` |
| | - 줄에 나오는 것은 변수 이름과 필드 위치뿐이고 값은 없다 |
| **M1** `key_field_in_*` | **일으킬 수 없다**(R69b-I1). 렌더러는 그 줄을 그리게 됐지만, 실제 CLI에서는 이 힌트가 나오지 않는다 |
| **L1** 취소 파일 | **닫혔다.** 작업 공간 안의 `--cancel-file`은 `invalid_arguments`이고 `hint`가 없다. stderr도 main과 같다 |
| | - 같은 검사의 대본 파일에는 같은 문제가 남아 있다(R69b-L1) |
| **L2** `runs`·`cleanup --run` | **닫혔다.** `runs --bogus`는 `unknown_option`(순번 1)이고, `cleanup --run !`은 `run_id_form`이다. 둘 다 사람용 줄이 나온다 |
| 오류 JSON | **`hint` 말고는 main과 바이트까지 같다**(오류가 난 사례 모두, 두 언어). 세부 값은 JSON에 없다 |
| | - 1 MiB보다 큰 변수 파일은 R-69와 같이 실행이 돌아서 실행 id만 다르다 |
| 키 모양 글 | **되풀이되지 않는다.** 키 모양 글을 친 열두 자리와 키 사례 열하나, 두 판·두 언어의 stdout·stderr 어디에도 그 글(앞 24자도)이 없다 |
| 붙지 말아야 할 곳 | 이 이유가 아닌 오류 열셋에는 R-69처럼 힌트가 없다 |

## 2. 낮음

### R69b-L1 작업 공간 안의 대본 파일에 "task, 설정, 변수 파일" 힌트가 붙는다

- 위치: `src/cli/run.ts:717`. 입력 위치 검사의 대본 파일 줄이 `input_inside_workspace`를 붙인다(마지막 값 `true`). `0232570`은 취소 파일만 뺐다.
- 재현(`H.log`, "script file inside the workspace")
  - `provider: "scripted"`이고 `scriptPath: "./ws/s.json"`(작업 공간 안)인 task로 `codaryn run --task …`
  - 종료 2, `invalid_script`, `"hint":"input_inside_workspace"`
  - 사람용 줄: `An input file (task, config or variables file) is inside the workspace, …` / `입력 파일(task, 설정, 변수 파일)이 작업 공간 안에 있거나 …`
  - 대본 파일은 셋 가운데 어느 것도 아니다. `message`는 `the script file is inside the workspace …`로 맞게 말한다.
- 영향: R69-L1과 같은 꼴이다. 대본 파일은 키 없이 체험하거나 시험할 때 쓰므로 사용자가 만날 수 있다.
- 고칠 방향(제안): 대본 파일도 `false`로 두거나, 힌트 글을 "입력 파일(task, 설정, 변수, 대본 파일)"로 넓힌다.

## 3. 정보

- **R69b-I1 `key_field_in_task`·`key_field_in_config`는 CLI에서 나오지 않는다.**
  - `run.ts`의 순서
    - 파일 글 검사(`rawTextHoldsKey`, `src/cli/security/keys.ts:201`)가 먼저다. 키 모양 값과 지금 키를 `\u` 이스케이프까지 풀어 모두 잡는다.
    - 그 뒤의 JSON 검사(`findKeyInJson`, 156행)까지 오는 것은 키 필드 이름(`isKeyFieldName`)뿐이다.
  - JSON 검사가 주는 위치는 그 필드 이름으로 끝난다(예: `model.apiKey`, `apiKey`). 그래서 스키마 필드 경로가 아니고, `toSchemaFieldPath`가 `null`이 되어 힌트는 그냥 `key_in_task`·`key_in_config`다.
  - 이번에 해 본 것: task의 `model.apiKey`, 설정의 `apiKey`, 이스케이프한 키 값 셋. 모두 `key_in_*`였다.
  - 지금 키를 환경 변수에 넣는 경우는 해 보지 않았다. 그 값도 글 검사가 먼저 잡는다(코드로 봄).
  - 힌트와 렌더러에는 문제가 없다. 다만 이 두 힌트의 사람용 줄은 지금 닿는 길이 없다.

## 4. 검사하지 않은 범위

- 터미널일 때(사람용 줄은 stderr라 같다), 읽기 권한이 없는 task 파일, 지금 키 값이 든 task·설정
- R69-L3(고치는 법 줄과 힌트의 어긋남)은 지시대로 이번에 보지 않았다.
- 루트 유닛·통합 시험 재실행

## 5. PM 판단 필요

- 없음. R69b-L1은 R69-L1과 같은 방법으로 고칠 수 있다.

사용자에게 물을 질문은 없다.
