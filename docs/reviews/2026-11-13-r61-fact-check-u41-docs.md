# R-61 사실 확인: 문서 단위 U-41 (w3:p4, 2026-11-13)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어. 읽기 전용이며 저장소 수정·커밋은 없다. R-60(U-31)과는 따로 적는다.
- **대상: `unit/U-41-nd-docs` = `7e6f1bc`**(`git diff main...unit/U-41-nd-docs`, `docs/usage.md` 한 파일, 46줄 더함, 10줄 지움). 갈라진 곳은 `0ad28bc`이고, 문서는 "main `0ad28bc`의 실제 CLI로 확인"이라고 적었다.
- **돌린 판: main `1e54ca9`**(지시대로). `0ad28bc` 위에 다음이 더 있다:
  - U-29, U-16 등 R-60 보고서의 목록
  - U-23(터미널에서는 JSON 줄 없음, `ae4021d`)
  - U-33
  - 사본 `.codaryn/r61/e`(`git archive 1e54ca9`), `npm run build` 성공. 확인 뒤 지웠다.
- 실험: `r61/r61.mjs`(구역 Q, W, C, U)와 `r61/v.mjs`. 로그는 `r61/*.log`.
  - 모든 CLI 호출에 시험의 네트워크 막이를 얹었다. 대본(scripted) 모델과 18.2절의 파일 정리 예시만 썼다. 주소는 쓰지 않았다.
  - 설정 파일은 기본 위치에 둔다(시험 폴더로 돌린 `APPDATA`의 `Codaryn\config.json`). 모양은 문서 표의 다섯 가지다.
    - 설정 없음
    - 한도 없음(`{"schemaVersion":1}`)
    - 한도 하나(`maxDurationMs: 999999999999`)
    - 한도 넷
    - 깨진 JSON(`{x`)
  - 터미널은 R-58의 미리 읽기(`r58/tty.mjs`, stdout을 터미널로 표시)로 흉내 냈다.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 2 (R61-L1, L2) |
| 정보 | 3 (R61-I1~I3) |

**판단: 18.1의 간편 형식 서술과 인용 출력은 `1e54ca9`에서 그대로 맞다.** UXM-20의 문서 몫에는 한 줄이 틀렸다(R61-L1, `revert`). `--workspace` 생략 절에는 `1e54ca9`(U-23)에서 빠진 말이 하나 있다(R61-L2).

| 볼 것(문서 위치) | 결과 |
| --- | --- |
| **18.1 간편 형식의 표**(950행부터) | **다섯 칸 × 여섯 명령이 모두 같다**(Q) |
| | - `plan`, `changes`: 0이 넷, 깨진 JSON만 2 `invalid_config` |
| | - `review`: 2 `run_not_awaiting_review`가 넷, 깨진 JSON만 `invalid_config` |
| | - `apply --workflow organize`: 한도 넷일 때만 0, 나머지는 2 `invalid_config` |
| | - `report`, `runs`: 모두 0 |
| | - 한도 하나(`999999999999`)로도 `plan`이 0이다(R54-I3과 같음) |
| 인용한 stderr | **같다**(Q) |
| | - 한도가 없거나 설정이 없을 때 `apply`의 다섯 줄이 글자까지 같다. 처음 빠진 한도는 `limits.maxTotalTokens`다 |
| | - 마지막 줄은 아직 U-17 전 문구다("plan, apply and review reads … limits included"). 문서가 그렇다고 적은 그대로다 |
| | - 한국어 마지막 줄도 문서와 같다 |
| | - 깨진 JSON이면 그 줄 없이 `config file — JSON syntax error at line 1, column 2`다 |
| 6절 한도 문단에 더한 문장 | **맞다.** `plan`·`review`·`changes`의 간편 형식은 한도를 요구하지 않는다(Q) |
| **10절 "`--workspace` 생략"**(573행부터) | **맞다**(W). 작업 공간 폴더 안에서, 설정 없음과 한도 넷 모두: |
| | - `report --run latest`, `plan --run <id>`, `changes --run latest`, `runs`는 0 |
| | - `revert --dry-run`, `cleanup`, `apply`, `review`는 2 `invalid_arguments`이고 아무것도 옮기지 않았다 |
| | - 깨진 설정이면 `plan`과 `changes`만 `invalid_config`이고, `report`와 `runs`는 0이다 |
| | - 안내 `If you mean the current directory, give --workspace .`는 JSON의 `message`에만 있다. stderr는 일반 안내 두 줄이다 |
| | - `apply`와 `review`의 `message`는 `give --task or --workspace, not both`로 시작한다 |
| | - 하위 폴더(`inbox`)에서는 `run_not_found`다. 문서가 인용한 `this workspace has no record of that run`은 stderr의 설명 줄이다(JSON의 `message`는 따로다, `V.log`) |
| | - 다만 터미널에서는 이 안내가 보이지 않는다(R61-L2) |
| 10절 `changes`의 간편 형식과 생략 | **맞다**(C) |
| | - task의 `privacy.secretEnv`로 등록한 값이 든 파일을 실행이 만들었다 |
| | - `changes --workspace …`와 생략한 형식은 그 파일을 `as_run_left`, `masking_unverified`로 보이고 글이 없다 |
| | - 실행의 task를 `--task`로 주면 글이 보이고, 원래 값은 가려져 있다 |
| | - 문서에 더한 두 사용법 줄의 형식도 그대로 된다 |
| 17절 `invalid_arguments` 행에 더한 말 | **맞다**(W) |
| **16절 UXM-20의 빠진 곳**(833행부터) | |
| | - `help run`: 사용법 줄에 `[--workflow <id>]`가 있고 옵션 목록에는 없다. 맞다(`1e54ca9`의 목록에는 U-23의 `--json`이 있다) |
| | - 명령 없음, 모르는 명령, `run`의 옵션 오류: `message`가 여덟 사용법의 묶음이다. `… | codaryn plan|apply|review ... | codaryn --help | codaryn --version`으로 끝나고 `changes`·`cleanup`이 없다. 맞다(파이프일 때. R61-I1) |
| | - **"다른 명령의 옵션 오류는 그 명령의 사용법만": `revert`는 아니다**(R61-L1) |
| | - `report`, `plan`, `changes`, `cleanup`, `apply`, `review`, `runs`, `doctor`, `models`, `init`은 자기 사용법만 낸다 |
| | - `plan`·`changes`의 사용법 줄은 `(--task <task.json> \| --workspace <dir> …)`이다. 맞다 |
| | - 한국어 `doctor` 표는 설명이 시작하는 화면 열이 26~31로 줄마다 다르다. 영어는 모두 36이다. 문서가 인용한 두 줄도 출력과 같다. 맞다 |

## 2. 낮음

### R61-L1 `revert`의 옵션 오류도 사용법 묶음을 낸다

- 문서(16절 UXM-20, 833행): "명령이 없거나 모르는 명령일 때, 그리고 `run`의 옵션 오류일 때 … 묶음이다. … 다른 명령의 옵션 오류는 그 명령의 사용법만 보인다."
- 실제(`1e54ca9`, `U.log`): `codaryn revert --bogus`의 `message`는 `unknown or repeated option. usage: codaryn run (…`으로 시작한다. 여덟 사용법(`run`, `revert`, `report`, `doctor`, `models`, `init`, `runs`, `plan|apply|review ...`)의 묶음이다.
  - 까닭: `revert`의 인자 해석이 묶음 `USAGE`를 오류 글로 쓴다(`src/cli/args.ts:214`).
- 영향: 문서를 믿고 `revert`의 사용법을 오류 글에서 찾는 사람은 묶음을 받는다. 묶음에 `revert` 줄이 들어 있어 큰 혼란은 아니다.
- 고칠 방향(제안): 문서의 "`run`의 옵션 오류" 자리를 "`run`과 `revert`의 옵션 오류"로 고친다. 제품을 고칠지는 UXM-20의 몫이다.

### R61-L2 터미널에서는 `--workspace .` 안내가 어디에도 보이지 않는다

- 문서(10절, 576행): "그 안내(`If you mean the current directory, give --workspace .`)는 stdout JSON의 `message`에만 있다. stderr는 `codaryn help <command>`를 보라는 일반 안내뿐이다."
- 실제(`1e54ca9`, W): 이 판에는 U-23이 있어, stdout이 터미널이면 오류 JSON 줄을 내지 않는다.
  - 작업 공간 폴더 안에서 터미널로 `revert --run latest --dry-run`을 하면 종료 2다. stdout은 0바이트, stderr는 일반 안내 두 줄이다. 안내는 어디에도 없다.
  - `--json`을 주면 stdout의 JSON에 안내가 있다.
- 영향: 문서의 문장은 틀리지 않았다. 그러나 콘솔에서 치는 사람에게 실제 결과는 "안내가 보이지 않는다"이다. 문서만 읽으면 화면 어딘가에 안내가 있으리라 생각할 수 있다.
  - 제품 쪽 원인은 R-54의 R54-L1(안내가 영어 JSON에만 있음)이다. U-23이 이를 키웠다.
- 고칠 방향(제안): 문서에 "터미널에서는 JSON 줄이 나오지 않으므로 이 안내도 보이지 않는다(`--json`을 주면 보인다). 현재 폴더라면 `--workspace .`를 준다"를 더한다. 제품에서 안내를 사람용 stderr에도 내는 것은 R54-L1의 몫이다.

## 3. 정보

- **R61-I1 "명령이 없을 때"의 묶음은 파이프일 때만이다.** `1e54ca9`에서는 stdout이 터미널이면 `codaryn`만 쳐도 도움말과 종료 0이다(U-23, DR-56). 16절 UXM-20 줄과 그 위 문단은 `0ad28bc` 기준이다. "터미널이 아닐 때"를 붙이면 맞다.
- **R61-I2 `cleanup`의 안내 끝에 마침표가 둘이다.** `--workspace is required. If you mean the current directory, give --workspace .. usage: …`(W). `revert`, `apply`, `review`는 `give --workspace . usage:`다. 문서의 몫은 아니고 제품 문구의 작은 흠이다.
- **R61-I3 문서가 잰 판과 이번 판.** 문서의 "확인(main `0ad28bc`)" 문장들은 이번에 `1e54ca9`에서 다시 재도 맞았다. 표, 인용 stderr, 생략 결과, 하위 폴더, `changes` 가림이 그렇다. U-23과 겹치는 곳(R61-L2, I1)만 판에 따라 다르다.

## 4. 검사하지 않은 범위

- 실제 콘솔 창(stdout 터미널은 미리 읽기로 흉내 냈다), Linux·macOS
- 프로필(`--profile`)이 가릴 값을 정하는 경우. 설정 최상위의 `secretEnv`가 없는 경우만 봤다.
- 루트 유닛·통합 시험(문서 단위라 돌리지 않았다)

## 5. PM 판단 필요

- **Q-1(R61-L2)**: DR-49(U-23) 뒤의 터미널 동작을 문서 곳곳에 반영할 문서 단위를 따로 둘지. R-60의 R60-I1과 같은 뿌리다. 가정: U-41은 그대로 병합하고, R61-L1과 L2의 한 줄씩만 고친다.

사용자에게 물을 질문은 없다.
