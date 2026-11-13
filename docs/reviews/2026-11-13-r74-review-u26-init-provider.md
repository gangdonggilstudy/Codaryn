# R-74 병합 전 검토: 단위 U-26, init이 터미널에서 제공자를 묻는다 (UXM-11) (w3:p5, 2026-11-13)

## 0. 대상과 방법

- 페르소나: 검증, 보안·개인정보 검토자(보조). 읽기 전용이다. 저장소 수정·커밋은 없다. 실제 API와 외부 네트워크는 쓰지 않았다.
- **검토한 판: `pm/unit-U-26` = `79cdcc4`**(main `ac7dd6d` 위, 12파일 +341 −16)
  - 문구(`src/i18n/*`)는 내가 쓴 것이라 이번에는 코드만 본다: `src/cli/init.ts`, `src/cli/main.ts`
- 사본: `git archive`로 `.codaryn/r74/base`(`ac7dd6d`)와 `.codaryn/r74/u`(`79cdcc4`)를 풀었다. 둘 다 `tsc` 0이다.
- 실험: 두 스크립트를 썼고, 로그는 `.codaryn/r74/*.log`다.
  - `r74.mjs`
    - N: 터미널 없음, `--json`, 두 판 비교 8가지
    - T: 터미널의 제공자 답 14가지와 입력 끝, 거절
    - F: 쓴 파일과 다음 단계
    - O: `runInit`을 직접 불러 본 `InitOutput`
  - `r74b.mjs`: 각 질문에서 입력이 끝날 때(두 판), 터미널 대화 전체를 두 판에서 견줌
- 실행 조건
  - 모든 CLI 호출에 시험의 네트워크 막이를 얹었다.
  - 모델 목록은 `127.0.0.1`의 가짜 Anthropic·OpenAI 목록 서버로만 갔다.
  - 키는 키 모양이 아닌 가짜 값이다.
  - 기본 설정 위치는 사례마다 새 폴더로 돌렸다.
- 터미널 흉내: 미리 읽기 `tty.mjs`가 stdin과 stderr의 `isTTY`를 참으로 둔다. stdout은 파이프로 두어 글을 읽는다. 질문이 기다리면 답 한 줄을 쓴다.
  - stderr가 터미널로 보이므로 readline이 친 글을 메아리한다. 실제 터미널의 메아리와 같다.
  - 그래서 "되풀이되지 않음"은 "질문 바로 뒤의 메아리 한 번 말고는 없음"으로 본다.
- 수치(고정 판 트리 `79cdcc4`, 내 worktree에서 분리 체크아웃해 dist를 지우고 빌드): typecheck 0, 유닛 2733(통과 2729, 실패 0, 건너뜀 3, todo 1), 통합 559/559. PM의 수치와 같다.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 1 (R74-L1) |
| 정보 | 4 (R74-I1~I4) |

| 볼 것 | 결과 |
| --- | --- |
| (1) 터미널 없음, `--json` | **main과 바이트까지 같다.** 여덟 가지 모두 stdout, stderr, 종료 코드, 만든 설정 파일이 같다 |
| | - 경우: 터미널 없음, `--json`, 키 둘 각각, 작업 공간 제안, 터미널에서 `--json`, 있는 파일(터미널 없음, 터미널) |
| | - 터미널 대화 전체도, 제공자 질문 덩어리를 빼면 두 판이 바이트까지 같다(작업 공간 있음·없음) |
| (2) 터미널의 답 | **설계대로다.** 답한 글은 메아리 한 번 말고는 stderr, stdout, 파일 어디에도 없다 |
| | - `1`·`anthropic`·Enter → anthropic |
| | - `2`·`openai`·`  OpenAI  `·`02` → openai |
| | - 목록에 없는 답, `3`, `0`, 전각 숫자, 2만 자 답, 제어 문자가 든 답, 키 모양 답 → anthropic |
| | - **입력 끝은 기본값이 아니다.** 종료 13, 출력과 파일이 없다. main도 같다(R74-L1) |
| (3) 만든 파일 | **맞다.** |
| | - anthropic은 예전 꼴, openai는 `provider`와 `providers.openai.{model, maxOutputTokens}`다 |
| | - 키 값은 없다(가짜 키 둘을 넣고 확인) |
| | - 있는 파일은 묻기 전에 `config_exists`로 끝나고 그대로 남는다 |
| (4) openai의 다음 단계 | **맞다.** |
| | - 키 줄과 Windows 안내가 `OPENAI_API_KEY`를 댄다 |
| | - `init.model_no_key`가 권하는 `codaryn models --use`가 `providers.openai.model`에 쓴다 |
| | - `doctor`가 `OPENAI_API_KEY`와 `providers.openai.model`의 자리표시자를 짚는다 |
| (5) `InitOutput.provider` | **반환된 JSON에는 늘 없다.** 묻는 경우와 `--json`이 서로 배타라, 물었을 때의 값은 글 출력의 키 줄에만 쓰인다(R74-I1) |

## 2. 터미널 없음, `--json` (N, `r74.log`)

| 경우 | 종료(두 판) | stdout | stderr | 파일 |
| --- | --- | --- | --- | --- |
| `init --config`(터미널 없음) | 0/0 | 같음 | 같음 | 같음 |
| `init --config --json` | 0/0 | 같음 | 같음 | 같음 |
| `ANTHROPIC_API_KEY` 있음 | 0/0 | 같음 | 같음 | 같음 |
| `OPENAI_API_KEY` 있음(키 줄은 예전처럼 ANTHROPIC) | 0/0 | 같음 | 같음 | 같음 |
| `--workspace`(scripts, tests 있음) | 0/0 | 같음 | 같음 | 같음 |
| 터미널에서 `--json`(묻지 않음) | 0/0 | 같음 | 같음 | 같음 |
| 있는 파일(터미널 없음) | 2/2 | 같음 | 같음 | 그대로 |
| 있는 파일(터미널, 답 `y`, `2`를 준비함) | 2/2 | 같음 | 같음 | 그대로. 묻지 않았다 |

- 터미널 대화 전체(S, `r74b.log`): u에서 제공자 덩어리를 빼면 두 판이 바이트까지 같다. stdout과 파일도 같다.
  - 제공자 덩어리: 목록 두 줄, 질문, 메아리, `Provider: anthropic. …`
  - 작업 공간 없음, 작업 공간(명령·보호 경로 제안) 있음, 둘 다다.

## 3. 터미널의 답 (T, `r74.log`)

| 답 | 알린 줄 | 파일 | 끝 글의 키 줄 |
| --- | --- | --- | --- |
| `1` | Provider: anthropic | 최상위(예전 꼴) | ANTHROPIC_API_KEY |
| `2` | Provider: openai | `provider: openai` | OPENAI_API_KEY |
| `openai` | openai | openai | OPENAI_API_KEY |
| `  OpenAI  ` | openai | openai | OPENAI_API_KEY |
| `anthropic` | anthropic | 최상위 | ANTHROPIC_API_KEY |
| Enter | anthropic | 최상위 | ANTHROPIC_API_KEY |
| `R74UNKNOWN` | anthropic | 최상위 | ANTHROPIC_API_KEY |
| `3`, `0`, `２`(전각) | anthropic | 최상위 | ANTHROPIC_API_KEY |
| `02` | openai | openai | OPENAI_API_KEY |
| `openai` + 2만 자 + 표지 | anthropic | 최상위 | ANTHROPIC_API_KEY |
| BEL, ESC, NUL이 든 답 | anthropic | 최상위 | ANTHROPIC_API_KEY |
| 키 모양 값 | anthropic | 최상위 | ANTHROPIC_API_KEY |

- 표지를 단 네 답의 출현 수: 목록에 없는 답, 긴 답, 제어 문자, 키 모양.
  - stderr: 한 번이다(readline의 메아리).
  - stdout: 0, 파일: 0.
  - 알린 줄은 고른 이름만 댄다(`init.provider_chosen {provider}`).
- 거절(`n`): 종료 3, 제공자를 묻지 않고, 파일이 없고, stdout은 `Nothing was created.`다.
- 사람이 보는 질문(영어): 위치 확인 뒤 다음 순서다.
  1. 목록 두 줄(`  1  anthropic`, `  2  openai`)
  2. `Choose the provider by number or name (Enter, or an answer not listed, gives anthropic).`
  3. 답
  4. `Provider: openai. The config file is written for it.`
  5. 모델 줄

## 4. 낮음

### R74-L1 입력이 끝나면 기본값이 아니라 종료 13이다(main과 같음, 이 단위가 새로 약속함)

- 위치: `src/cli/main.ts`의 `askLine`(이 단위가 고치지 않은 줄), `src/cli/init.ts`의 제공자 질문, 계약 문서 "init이 제공자를 묻는다".
  - 계약 문서: "Enter, 목록에 없는 답, 입력 끝이면 기본값(anthropic)이다"
  - 코드 주석: "Enter, an unknown answer or the end of input give the default"
  - 계약의 `InitOutput.provider` 주석도 같다.
- 재현(E, `r74b.log`, 흉내 낸 터미널에서 stdin을 닫음)

  | 입력이 끝난 곳 | main(`ac7dd6d`) | u(`79cdcc4`) |
  | --- | --- | --- |
  | 만들기 확인 | 종료 13, 출력 없음, 파일 없음 | 같음 |
  | 확인 다음 질문(main: 언어, u: 제공자) | 종료 13, 출력 없음, 파일 없음 | 같음 |
  | 그다음(main: 끝남, u: 언어) | 종료 0, 파일 있음 | 종료 13, 출력 없음, 파일 없음 |

  - 종료 13은 Node의 "끝나지 않은 최상위 await"다. `askLine`의 `prompt.question`이 입력 끝에서 null을 돌려주지 않고 끝내 정해지지 않는다.
  - 단위의 시험은 null을 돌려주는 대역 `ask`를 쓴다. 그래서 실제 CLI의 이 경우를 보지 못한다.
- 영향
  - 질문 하나가 늘어 입력 끝에 걸리는 자리가 하나 늘었다. 표의 셋째 줄은 main에서는 파일이 생기고 u에서는 생기지 않는다.
  - 13은 `init`의 종료 코드(created 0, declined 3, 오류 2)에 없다. 오류 JSON도 사람용 줄도 없다.
  - 아무것도 쓰지 않으므로 안전한 쪽이다.
  - 실제 콘솔의 Ctrl-D·Ctrl-Z로는 보지 못했다(흉내 낸 터미널).
- 고칠 방향(제안)
  - 코드: `askLine`이 readline의 `close`(입력 끝)에서 null을 돌려주게 한다. 그러면 계약대로 기본값이다. CLI 담당 몫이고, 다른 명령의 터미널 질문(`apply`, `revert`)도 같은 함수를 쓰는지 함께 본다.
  - 또는 계약 문서와 주석에서 "입력 끝"을 빼고, 지금 동작을 적는다.

## 5. 쓴 파일과 다음 단계 (F, `r74.log`)

- openai, 키 없음: 파일은 다음과 같다. 키 값은 없다.

  ```json
  {
    "schemaVersion": 1,
    "provider": "openai",
    "providers": { "openai": { "model": "<model id>", "maxOutputTokens": 4096 } },
    "limits": { … },
    "policy": { … }
  }
  ```

  - 알린 줄: `Provider: openai. …`, `Model: without a key the list cannot be fetched. After registering the key, choose one with codaryn models --use.`
  - 끝 글: `Key: OPENAI_API_KEY is not set. …`, Windows 안내도 `OPENAI_API_KEY`다. 다음은 `codaryn doctor`다.
  - `doctor --json`(종료 1)
    - `config_file: ok`
    - `api_key: fail - OPENAI_API_KEY is not set; an openai run stops with provider_not_configured`
    - `model: fail - … CODARYN_OPENAI_MODEL or config providers.openai.model): only a placeholder …`
  - 그 파일로 `codaryn models --use 1`(가짜 OpenAI 목록, `GET /v1/models`): 종료 0. `providers.openai.model`이 `"gpt-r74-a"`가 됐다. 최상위 `model`은 생기지 않았다. 키 값도 없다.
- openai와 그 키(가짜 목록): 목록 요청은 `GET /v1/models` 하나다. 파일은 `providers.openai.model = "gpt-r74-a"`이고, 키 줄은 `OPENAI_API_KEY is set`이다.
- anthropic과 그 키(가짜 목록): `GET /v1/models?limit=1000` 하나다. 최상위 `model = "claude-r74-a"`로 예전 꼴이다.
- openai를 골랐는데 anthropic 키만 있음: 목록 요청이 없다(anthropic 서버로도 가지 않음). 파일은 openai 꼴에 자리표시자이고, 키 줄은 `OPENAI_API_KEY is not set`이다.

## 6. 정보

- **R74-I1 `InitOutput.provider`는 어떤 반환 JSON에도 실리지 않는다.**
  - `ask = args.json ? undefined : io.ask`라서 `--json`이면 묻지 않는다. 묻는 경우는 글(`renderInit`)만 돌려준다.
  - 그래서 CLI의 `--json`과 앱 계층(`init --json`으로 부름)에서는 늘 없다. O의 여섯 경우가 이를 확인한다.
  - 물었을 때의 값은 글의 키 줄에만 쓰인다(`OPENAI_API_KEY`).
  - 거절한 경우도 `interactive`이므로 내부 값은 `provider: "anthropic"`이다(제공자를 묻지 않았는데). 글에는 드러나지 않는다.
  - 계약 주석 "물었을 때만 있다"는 맞지만, 프로그램이 이 필드를 볼 길은 지금 없다. GUI가 제공자를 묻게 되면 그때 정할 일이다.
- **R74-I2 `02`는 openai, `0`과 `3`은 기본값이다.** `providerOf`는 한두 자리 숫자를 1부터 센다. 앞의 0은 받는다. 해가 없다.
- **R74-I3 메아리는 readline의 것이다.** 키 모양 값을 답으로 치면 그 글이 터미널에 그대로 보인다. 실제 터미널도 친 글을 보인다.
  - Codaryn의 줄(`writeHuman`, 키 숨김)에는 나오지 않는다.
  - 질문 글(목록과 `init.provider_pick`)은 `askLine`이 stderr에 바로 쓴다. 고정 글뿐이라 문제없다.
- **R74-I4 GUI.** 이 단위는 GUI를 고치지 않았다. 앱 계층의 `init --json`은 N에서 main과 같았다. GUI 시험은 돌리지 못했다(`gui/node_modules` 없음).

## 7. 검사하지 않은 범위

- 실제 콘솔 창(흉내 낸 터미널), Ctrl-D·Ctrl-Z, Linux·macOS
- 두 프로세스가 같은 설정 파일을 동시에 만들 때(쓰기의 `wx`는 코드로만 확인)
- 실제 제공자의 모델 목록(가짜 서버만)

## 8. PM 판단 필요

- **Q-1(R74-L1)**: 입력 끝을 어떻게 할지.
  - `askLine`이 null을 돌려주게 고칠지(CLI 담당, 다른 터미널 질문에도 미침)
  - 계약 문서와 주석에서 "입력 끝이면 기본값"을 뺄지
  - 가정: 고친다. 계약이 이미 그렇게 적었기 때문이다.

사용자에게 물을 질문은 없다.
