# Codaryn 사용 안내

Codaryn CLI를 실제 작업에 쓰는 방법이다. 설명은 현재 코드 동작 기준이며 세부 규칙은 [CLI·공통 계약](cli-contract.md)이 기준이다.

> 오프라인 검증(유닛, 프로세스 통합)과 로컬 가짜 서버를 쓴 모의 API 검증만 통과했다. 실제 Anthropic API와 실제 OpenAI API로는 아직 검증하지 않았다. 처음에는 [키 없이 체험하기](#3-키-없이-체험하기)로 흐름을 익히고, 실제 작업 전에 [실제 호출 점검](#14-실제-호출-점검)을 한다.

처음 쓰는 순서: 설치(2절) → 기본 설정 만들기 `init`(4절) → 실행 전 점검 `doctor`(7절) → 키 없는 체험(3절) → 결과 읽기 `runs`·`report`(10절) → 되돌리기 `revert`(11절). 체험은 `init` 없이도 된다. 작업 종류를 고르는 범용 작업(파일 정리의 계획 확인 → 적용 → 되돌리기, 자료 분석의 사람 확인)은 18절이다.

**출력 언어:** 사람이 읽는 글(오류 설명, 진행 줄, 끝 요약, 도움말, `doctor`)은 한국어와 영어로 나온다(8절 "언어"). 이 문서의 출력 예시는 `CODARYN_LANG=en`으로 실행한 실제 출력이다. 같은 글을 보려면 먼저 `$env:CODARYN_LANG = "en"`을 실행한다. 한국어 Windows에서 이 변수가 없으면 한국어로 나온다.

## 1. 요구 사항

- Node.js 26 이상(`package.json`의 `engines`). 검증은 Windows에서 했고 다른 OS는 확인하지 않았다.
- 실제 호출에는 고른 제공자의 API 키와 모델 ID가 필요하다. 3절의 체험에는 둘 다 필요 없다.
- 모델 제공자는 Anthropic API(기본)와 OpenAI API(Responses API) 둘이다([4절 "두 번째 제공자"](#두-번째-제공자-openai)).
- 이 문서는 CLI를 다룬다. 독립 데스크톱 GUI(`gui/`)는 만드는 중이고, 설치 패키지가 없어 개발 환경에서만 띄울 수 있다. VS Code 확장은 만들지 않는다.

## 2. 설치와 빌드

저장소 루트에서 실행한다.

```powershell
npm ci
npm run build                       # dist/ 에 컴파일
node dist/src/cli/main.js --help    # 명령 목록. 명령별 도움말은 help <명령> 또는 <명령> --help
node dist/src/cli/main.js --version
```

**`codaryn` 명령으로 쓰기(`npm link`, 선택):**

```powershell
npm link             # npm 전역 bin 폴더에 codaryn 명령을 만든다. 이 저장소를 가리키는 링크다
codaryn --version
npm rm -g codaryn    # 링크를 지운다
```

- 링크는 이 저장소를 가리키므로 소스를 바꾼 뒤에는 `npm run build`만 다시 하면 된다.
- npm 전역 bin 폴더가 `PATH`에 있어야 한다. Windows에서는 `npm prefix -g`가 가리키는 폴더다.
- PowerShell에서 `codaryn`이 스크립트 실행이 막혔다는 오류(영문 "running scripts is disabled on this system")로 멈추면 실행 정책이 npm의 `.ps1` 실행 파일을 막은 것이다. `codaryn.cmd`로 부르면 된다.
- 이 문서의 예시는 `node dist/src/cli/main.js`로 적는다. 링크했으면 `codaryn`으로 바꿔 쓴다.
- 확인 범위: 실제 전역 위치 대신 별도 prefix(`npm_config_prefix`)에서 link, `codaryn`·`codaryn.cmd` 실행, 체험 예시 실행, `npm rm -g`를 확인했다. 실행 정책 Restricted에서는 `codaryn`이 막히고 `codaryn.cmd`는 실행됐다.

## 3. 키 없이 체험하기

[`examples/demo/`](../examples/demo)는 API 키와 네트워크 없이 실행 → 실행 목록 → 보고서 → 되돌리기를 보는 예시다. 모델 대신 정해진 대본(scripted 모델)이 응답하고, 그 도구 호출은 실제 모델과 같은 정책, 가림, 검증, 기록 경로를 지난다.

과제: 회의 메모 `notes.md`를 읽어 `summary.md`에 요약을 만든다. 대본은 허용되지 않은 명령(`node --version`)을 한 번 요청해 거부되고, 처음 만든 요약에 '## 할 일' 절을 빠뜨려 검증에 실패한 뒤 재수정 1회로 고친다. `notes.md`는 보호 경로다.

```powershell
# 저장소 루트에서, 2절의 빌드를 마친 뒤
$demo = "$HOME\codaryn-demo"                          # 아직 없는 폴더. 저장소 밖이어야 한다
Copy-Item -Recurse examples\demo $demo
node dist/src/cli/main.js doctor --task $demo\task.json
node dist/src/cli/main.js run --task $demo\task.json
node dist/src/cli/main.js runs --workspace $demo\workspace
node dist/src/cli/main.js report --workspace $demo\workspace --run latest
node dist/src/cli/main.js revert --workspace $demo\workspace --run latest --dry-run
node dist/src/cli/main.js revert --workspace $demo\workspace --run latest
```

**왜 복사하나:** 실행이 작업 공간의 파일을 실제로 바꾸고 `.codaryn/`를 만든다. 또 작업 공간이 CLI 설치 위치(이 저장소) 안이면 실행 전에 `workspace_is_install_dir`(종료 2)로 거부된다. 저장소의 `examples\demo`를 그대로 실행해도 이 오류다.

**doctor:** 모든 항목이 `ok`이거나 `skipped`이고 종료 0이다. `API key` 항목은 "the task uses the scripted model; no key is needed"로 건너뛴다. 기본 설정 파일이 없으면 `config file` 항목도 건너뛴다(4절).

**run:** stdout에는 결과 JSON 한 줄, stderr에는 진행 줄과 끝 요약이 나온다(8절). 결과 JSON 줄은 stdout이 파이프나 파일일 때 나온다. 콘솔에서 그대로 치면 stdout과 stderr가 둘 다 터미널이라, 그 줄은 없고 stderr의 글만 보인다(10절 "터미널에서"). 아래는 stderr의 실제 출력이다. 실행 id와 시간은 실행마다 다르다.

```
codaryn: run started — provider scripted
codaryn: protected material check — unchanged (run_start)
codaryn: turn 1
codaryn: read file — allowed (read_file)
codaryn: turn 2
codaryn: run command — denied (command/command_not_allowed)
codaryn: turn 3
codaryn: write file — allowed (write_file)
codaryn: created summary.md
codaryn: turn 4
codaryn: check #1 — not passed (fail)
codaryn: repair 1 — checks not passed: 1
codaryn: turn 5
codaryn: write file — allowed (write_file)
codaryn: changed summary.md
codaryn: turn 6
codaryn: check #1 — passed (pass)
codaryn: finished — done (verified)
── Result: done — every configured check passed (done/verified) ──
Checks passed: 1 of 1 (within the configured checks)
Protected material checks that found no change: 5
Files changed: 1
  summary.md (created)
Denied calls: 1
To allow a command, add a rule to policy.commands in the task file. Fixing its arguments as well is recommended.
Usage: model turns 6 · tool calls 3 · 0.1 s
The agent's last message (the agent's own words, not a verified fact):
  | 빠진 '## 할 일' 절을 더했다.
Read the report, and revert if needed.
Run id: 20261113T021512Z-b4fd29f4
Report: codaryn report --workspace <workspace> --run 20261113T021512Z-b4fd29f4
Revert: codaryn revert --workspace <workspace> --run 20261113T021512Z-b4fd29f4
```

- `protected material check — unchanged`: 보호 경로(`notes.md`)가 실행 시작 때와 같은지 확인한 결과다(13절). 이 실행은 시작 때와 검증 회차마다 검증 전과 후, 모두 5번 확인한다. 바뀐 것이 없으면 진행 줄에는 첫 확인만 나오고, 나머지는 끝 요약의 `Protected material checks that found no change: 5`가 함께 센다. 바뀐 것을 찾은 확인은 접지 않고 언제나 제 줄로 나오며, 그때는 이 요약 줄이 없다.
- `run command — denied (command/command_not_allowed)`: 허용 목록이 비어 있어 명령이 거부됐다. 거부는 실행을 끝내지 않고 모델에 돌아간다. 끝 요약의 `Denied calls`와 그 아래 안내가 이것이다. task 파일 실행이므로 안내는 task 파일의 `policy.commands`를 가리킨다.
- `check #1 — not passed (fail)` → `repair 1`: 검증 실패 근거를 모델에 돌려보내 다시 고치게 했다(9절). 검증기는 id가 아니라 순번으로 나온다.
- 끝 요약의 `Files changed`는 바뀐 파일 수다. `summary.md`를 두 번 썼어도 파일은 하나다.
- `The agent's last message (…)` 아래의 `|` 줄은 모델이 마지막에 한 답이다(대본의 마지막 단계). 에이전트의 말이며 검증된 사실이 아니다. 무엇이 확인됐는지는 위의 `Checks passed`가 말한다(8절 "에이전트의 마지막 답").
- stdout의 JSON은 `status` `done`, `reason` `verified`, `exitCode` 0이다. `changes`에는 `summary.md`의 생성과 변경 두 건, `usage.repairAttempts`는 1이다. JSON의 한글은 `\uXXXX`로 나오므로 PowerShell에서 `$r = node dist/src/cli/main.js run --task $demo\task.json | ConvertFrom-Json`처럼 바로 변수로 받을 수 있다. 이때 stdout은 파이프이므로 콘솔에서도 JSON 줄이 온다.
- `init`으로 기본 설정을 만든 뒤라면(4절) 두 줄이 더 나온다: 진행 줄 `codaryn: using the config file in the default location: %APPDATA%\Codaryn\config.json`과 요약 줄 `Used the config file in the default location: %APPDATA%\Codaryn\config.json`. `init`의 기본 한도는 이 예시의 한도보다 크므로 실행 결과는 같다.

**runs:** 작업 공간의 실행 목록이다(10절). 실제 출력:

```
run id (UTC)               started (local)      changes  result
20261113T021512Z-b4fd29f4  2026-11-13 11:15:12  1        done (done/verified)
```

시작 시각은 지역 시간이다. `changes`는 실행이 바꾼 서로 다른 파일 수다. 이 체험은 `summary.md`를 두 번 썼으므로 결과 JSON의 `changes`에는 두 건이 있지만 목록에는 1로 나온다(끝 요약의 `Files changed`와 같다).

**report:** `--run latest`는 가장 최근 실행을 고른다. 고른 실행은 stderr에 먼저 나온다.

```
codaryn: Chose the latest run: 20261113T021512Z-b4fd29f4 (started 2026-11-13 11:15:12)
```

stdout은 사람이 읽는 Markdown 요약이다(10절). 이 체험에서는 `Provider: scripted (scripted model; no API was called)`, 검증기 1번 **pass**, `Repairs started: 1`, 보호 대상 확인 5회와 변경 없음, 변경 두 건, `Tool calls: 3 of 8 (denied: 1)`, 검사하지 않은 범위가 나온다. 보고서도 검증기를 순번(`verifier 1`)으로 쓴다. id는 `--json`에만 있다. 변경과 사용량 사이에는 `## The agent's last message` 절이 있다. 머리말 `The agent's last message. These are the agent's own words, not a verified fact.` 아래에 끝 요약과 같은 `|` 줄이 코드 블록으로 나온다(8절 "에이전트의 마지막 답").

**revert --dry-run:** 아무것도 바꾸지 않고 무엇을 되돌릴지 보인다. stdout은 `"dryRun":true`가 붙은 결과 JSON 한 줄이고 종료 코드는 실제 되돌리기와 같다(0). 이 JSON 줄도 파이프나 파일일 때만 나오고, 콘솔에서는 stderr의 글만 보인다. stderr:

```
codaryn: Chose the latest run: 20261113T021512Z-b4fd29f4 (started 2026-11-13 11:15:12)
codaryn: Files to revert: 1 (preview, nothing changed) (complete)
  summary.md — deleted (created by this run)
Run again without --dry-run to revert.
```

**revert:** 실행이 만든 `summary.md`를 지운다. 결과는 `"status":"complete"`, `"reverted":[{"path":"summary.md","action":"deleted"}]`, 종료 0이다. `.codaryn/`의 기록은 남는다. stderr:

```
codaryn: Chose the latest run: 20261113T021512Z-b4fd29f4 (started 2026-11-13 11:15:12)
codaryn: Files reverted: 1 (complete)
  summary.md — deleted (created by this run)
```

같은 실행을 한 번 더 되돌리면 할 일이 없다. `complete`, 종료 0이고 `skipped[].reason`은 `already_reverted`, 결과에 이전 되돌리기의 시각과 상태(`revertedBefore`)가 붙는다. 실행 목록의 그 줄에는 `· reverted (complete)`가 붙는다. stderr:

```
codaryn: Chose the latest run: 20261113T021512Z-b4fd29f4 (started 2026-11-13 11:15:12)
codaryn: Files reverted: 0 (complete)
Files skipped: 1
  summary.md — already as it was before the run (already_reverted)
Files already as before the run are skipped; it was reverted before (complete, 2026-11-13 11:15:13)
```

**다시 체험하기:** 되돌린 뒤 같은 사본에서 `run`부터 다시 하거나 새로 복사한다. 되돌리지 않고 다시 실행하면 `summary.md`가 이미 있어 첫 `write_file`이 `conflict`로 거부되고, 이전 실행이 만든 파일로 검증이 통과해 `changes`가 빈 `done`이 된다. **검증 통과는 이번 실행이 파일을 바꿨다는 뜻이 아니다.** 끝 요약의 `Files changed`와 `changes`를 함께 본다.

**정리:** `Remove-Item -Recurse -Force $demo`.

**대본을 직접 쓸 때:** 형식은 [CLI·공통 계약 4절](cli-contract.md#4-scripted-모델-파일-scriptedmodelscript)이다. 대본과 task 파일은 작업 공간 밖에 둔다.

- 대본은 토큰을 쓰지 않으므로 체험 예시는 단계마다 `usage`를 0으로 적었다. `usage`가 없으면 사용량을 알 수 없어, `maxTotalTokens`가 숫자일 때 첫 응답에서 `budget-exhausted`/`usage_unknown`(종료 4)으로 끝난다. `maxTotalTokens: null`은 scripted에서만 쓸 수 있다.
- 기존 파일을 고치는 `write_file`에는 그 파일의 SHA-256(`expectedHash`)이 필요하다. Git의 줄 끝 변환(`core.autocrlf`)이 저장소 파일의 바이트를 바꿀 수 있으므로, 체험 예시는 새 파일을 만들고 그 파일만 고친다.

## 4. 처음 설정: init, 키, 모델

### 기본 설정 만들기 (`init`)

```powershell
node dist/src/cli/main.js init
```

- 설정 파일을 **기본 위치**에 만든다. Windows는 `%APPDATA%\Codaryn\config.json`, 그 밖은 `$XDG_CONFIG_HOME/codaryn/config.json`(없으면 `~/.config/codaryn/config.json`)이다. `--config <파일>`이면 그 위치에 만든다.
- 이미 파일이 있으면 아무것도 쓰지 않고 `config_exists`(종료 2)로 끝난다. 덮어쓰지 않는다.
- 키를 묻지도 읽지도 쓰지 않는다. 키가 있는지와 등록 방법만 알린다.
- 터미널에서 실행하면(stdin과 stderr가 모두 터미널, `--json` 없음) 차례로 묻는다(U-26, UXM-11):
  1. 그 위치에 만들지(기본 예)
  2. **제공자**(번호나 이름. Enter나 목록에 없는 답이면 anthropic). 파일, 키 안내, 모델 목록이 그 제공자의 것이 된다. openai를 고르면 최상위 `provider`와 `providers.openai` 아래에 모델·출력 한도를 쓴다(6절).
  3. 모델(그 제공자의 키가 있을 때 목록을 받아 고름. 없으면 자리표시자)
  4. 명령 허용과 보호 경로 제안(`--workspace`를 줄 때. 명령 허용 제안의 기본 답은 "아니오")
  5. 언어
- 터미널 대화의 실제 예(main `bc3305d`, 키 없음, `--config <파일>`, 답은 `y`, `2`, Enter). stderr의 질문이다. 터미널 제어 문자는 뺐고, 줄 끝의 `y`와 `2`는 친 답이 보인 것이다. 터미널은 시험과 같은 방식(미리 읽기로 stdin·stderr의 `isTTY`를 참으로 둠)으로 흉내 냈다:

```
Config file location: --config
Create the config file there? [Y/n] y
  1  anthropic
  2  openai
Choose the provider by number or name (Enter, or an answer not listed, gives anthropic). 2
Provider: openai. The config file is written for it.
Model: without a key the list cannot be fetched. After registering the key, choose one with codaryn models --use.
Limits (defaults): turns 12 · tool calls 24 · tokens 150000 · 10 min
Choose the message language (ko/en, Enter to follow the operating system).
```

  만들어진 파일은 아래 기본 파일과 같고, 모델 두 줄 대신 `"provider": "openai"`와 `"providers": { "openai": { "model": "<model id>", "maxOutputTokens": 4096 } }`가 들어 있다. stdout의 키 안내는 `OPENAI_API_KEY`를 말한다. 한국어 질문은 `제공자를 번호나 이름으로 고르세요(Enter나 목록에 없는 답이면 anthropic).`이다.
- 터미널이 아니거나 `--json`이면 묻지 않고 기본값만 쓴다(제공자는 anthropic, 예전과 바이트까지 같음). 실제 출력(stdout, 종료 0):

```
Not a terminal: nothing was asked and only the defaults were written.
Saved: %APPDATA%\Codaryn\config.json
The model was left as a placeholder. Choose one with codaryn models --use.
Key: ANTHROPIC_API_KEY is not set. Register it as a user environment variable (Codaryn never asks for the value).
Windows: run rundll32 sysdm.cpl,EditEnvironmentVariables, add the user variable ANTHROPIC_API_KEY, then open a new terminal.
Next: codaryn doctor
```

만들어진 파일:

```json
{
  "schemaVersion": 1,
  "model": "<model id>",
  "maxOutputTokens": 4096,
  "limits": {
    "maxModelTurns": 12,
    "maxToolCalls": 24,
    "maxTotalTokens": 150000,
    "maxDurationMs": 600000
  },
  "policy": {
    "commands": [],
    "network": "deny",
    "destructive": "deny",
    "restorePathTokens": false
  }
}
```

- `--json`이면 `kind:"init"` JSON 한 줄이다(`status` `created`, `model` `placeholder`, `keySet` 등).
- 출력과 문구에는 펼친 경로 대신 `%APPDATA%\Codaryn\config.json` 같은 고정 표기만 나온다(값을 문구에 넣지 않기 때문이다). 그 표기는 그대로 쓸 수 있다: 명령 프롬프트(cmd)는 `%APPDATA%`를 풀고, PowerShell에서는 `$env:APPDATA\Codaryn\config.json`으로 쓴다(예: `notepad "$env:APPDATA\Codaryn\config.json"`). 두 셸에서 `init`이 만든 파일이 그 경로에 있는 것을 확인했다. 탐색기 주소창에 붙여도 열릴 것으로 보지만 화면으로는 확인하지 않았다(UXM-20).

### 설정 파일을 찾는 순서

`--config` → `CODARYN_CONFIG` → 기본 위치. 앞의 것이 있으면 뒤의 것은 보지 않는다. 기본 위치에 파일이 없으면 설정 파일 없이 실행한다. 기본 위치의 설정을 쓴 실행은 진행 줄과 끝 요약에 그 사실을 한 줄씩 남긴다(3절). 기본 위치의 파일도 작업 공간 안이면 거부한다(5절).

### 키

- 키는 제공자마다 정해진 환경 변수로만 받는다: Anthropic은 `ANTHROPIC_API_KEY`, OpenAI는 `OPENAI_API_KEY`(아래 "두 번째 제공자: OpenAI"). 한 제공자의 키는 그 제공자의 주소로만 간다. Windows 사용자 환경 변수에 등록하는 것이 기본이다: `rundll32 sysdm.cpl,EditEnvironmentVariables`로 창을 열어 사용자 변수 `ANTHROPIC_API_KEY`를 더하고 새 터미널을 연다(`init`이 같은 안내를 한다. `init`은 Anthropic 키만 안내한다). 키 파일을 자동으로 읽는 기능은 없다.
- 작업 공간 밖의 변수 파일에 적고 `--vars-file <경로>`로 읽을 수도 있다. 변수 파일은 이 옵션을 줄 때만 읽고 자동으로 찾지 않으며, 이미 설정된 환경 변수가 파일 값보다 우선한다.
- **`--env-file`은 쓰지 않는다.** Node 26이 그 이름을 스스로 먼저 읽는다. 파일이 없으면 CLI가 시작되기 전에 Node 오류(종료 코드 9)로 끝나고, 있으면 Node가 읽은 뒤 CLI가 `invalid_arguments`로 거부한다.
- 변수 파일 만들기: `New-Item -ItemType Directory -Force D:\codaryn-settings`와 `Copy-Item .env.example D:\codaryn-settings\.env`로 만들고 편집기에서 값을 채운다. BOM 없는 UTF-8로 저장한다(BOM이 있으면 `invalid_config`). 메모장의 "UTF-8"은 BOM이 없고, PowerShell 5.1의 `Set-Content -Encoding utf8`은 BOM을 붙인다.
- **변수 파일이 새로 설정한 값은 가릴 값으로 등록되어** 파일 내용, 명령 출력, 기록에 나타나면 가려진다. 예외는 이미 설정돼 있던 변수(Windows는 이름의 대소문자 무시), `CODARYN_CONFIG`와 제공자별 모델·주소 변수(`CODARYN_MODEL`, `CODARYN_API_BASE_URL`, `CODARYN_OPENAI_MODEL`, `CODARYN_OPENAI_API_BASE_URL`), 8자 미만 값이다. 가릴 값으로 등록된 값은 실행하는 명령의 환경에도 넘어가지 않는다(12절).
- 키를 task 파일, 설정 파일, 명령줄 인자에 적지 않는다. task·설정 파일, 간편 형식의 `--goal`, 한 줄 실행의 목표에 다음이 있으면 `key_in_file`(종료 2)로 바로 멈추고 아무것도 보내지 않는다.
  - 키 이름의 필드(`apiKey`, `token`, `password` 등)
  - 지금 설정된 키 변수(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)의 값. 16자 이상인 값만 찾는다. 줄바꿈, 공백, 영폭 공백 같은 보이지 않는 문자로 끊겨 있어도 찾는다. 값이 '키 같은 값'(영문자와 숫자가 16자 이상이고 숫자와 대문자·소문자가 다 있거나, 32자 이상이고 숫자와 글자가 있는 값)이면 그 사이에 어떤 문자가 끼어 있어도(이체 선택자, 한글 채움 문자, `.`, `\` 등) 찾는다. 키 같지 않은 값(낱말을 이은 자리표시자 등)은 이 비교를 하지 않으므로 같은 낱말을 띄어 쓴 평범한 목표를 멈추지 않는다.
  - 키 모양의 값: Anthropic 키 모양(실제 키 형식이면 앞에 다른 글자가 붙어 있거나 줄바꿈으로 끊겨 있어도), OpenAI 키 모양 두 가지(`sk-proj-` 같은 접두사가 붙은 것, 대소문자와 숫자가 섞인 긴 예전 형식). 줄바꿈이나 보이지 않는 문자로 끊긴 것도 찾는다. 보이는 공백은 빼지 않으므로 `sk-learn`, `sk-SK` 같은 이름 뒤에 단어가 이어지는 평범한 문장은 멈추지 않는다.
  - 남은 빈틈은 16절 "키 거부와 가림의 빈틈".
- task·설정 파일이 1 MiB(1,048,576바이트)보다 크면 내용을 쓰지 않고 `invalid_task`·`invalid_config`(종료 2)로 멈춘다. 메시지는 `the config file is larger than 1048576 bytes (1 MiB); nothing in it was used`이다(task 파일도 같은 꼴).

| 환경 변수 | 뜻 |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic API 키 |
| `CODARYN_MODEL` | Anthropic 모델 ID. 우선순위는 task `model.model` → 이 변수 → 설정 파일 `model`. 코드 기본값은 없다 |
| `CODARYN_API_BASE_URL` | Anthropic API 주소. 기본은 공식 주소(`https://api.anthropic.com`). `https`만 허용하며 `http`는 루프백 시험용이다 |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `CODARYN_OPENAI_MODEL` | OpenAI 모델 ID. 우선순위는 task `model.model` → 이 변수 → 설정 파일 `providers.openai.model`. 코드 기본값은 없다 |
| `CODARYN_OPENAI_API_BASE_URL` | OpenAI API 주소. 기본은 `https://api.openai.com/v1`(버전 경로 포함). 규칙은 위와 같고, `/responses`나 `/models`로 끝나면 안 된다 |
| `CODARYN_CONFIG` | 설정 파일 경로. `--config`가 없을 때 쓴다 |
| `CODARYN_LANG` | 사람용 글의 언어(`ko`, `en`). 8절 |

제공자별 변수는 그 제공자에만 쓰인다. 예를 들어 `CODARYN_MODEL`은 openai 실행의 모델을 정하지 않는다. 제공자를 고르는 환경 변수는 없다(설정 파일이나 task에서 고른다).

키, 모델, 요청당 출력 토큰 상한(`maxOutputTokens`) 중 하나라도 없으면 `provider_not_configured`(종료 코드 7)로 끝나고 아무것도 전송하지 않는다. 모델 값이 `<model id>` 같은 자리표시자이거나 비어 있으면 설정되지 않은 것으로 본다.

### 모델 고르기 (`models`)

모델 ID를 외워 칠 필요 없이, 키로 쓸 수 있는 모델 목록을 보고 번호로 고른다.

```powershell
# 목록 보기 (설정 파일은 기본 위치)
node dist/src/cli/main.js models
# 2번 모델을 설정 파일의 model로 쓴다
node dist/src/cli/main.js models --use 2
```

- **실제 API에 요청한다**(`GET /v1/models`). 키는 요청 헤더에만 들어간다. 키가 없으면 `provider_not_configured`(종료 7)이고 아무것도 보내지 않는다. 작업 공간은 필요 없다.
- **`--provider <anthropic|openai>`**: 어느 제공자의 목록인지 고른다. 없으면 설정 파일의 `provider`, 그것도 없으면 anthropic이다. 고른 제공자의 키·주소·모델 변수만 쓴다.
- 표에는 번호, id, 이름, 입력·출력 토큰 상한이 나온다. 지금 실행이 쓸 모델(그 제공자의 모델 변수, 없으면 설정 파일)에는 `*`가 붙는다. `--json`이면 `kind:"models"` JSON 한 줄이다.
- 표와 그 아래 줄, `--use`의 확인 줄, 터미널의 질문은 고른 언어를 따른다(U-156). 영어는 예전과 같다. 한국어 실제 출력(main `07cd600`, 루프백의 가짜 서버가 준 목록과 가짜 키, `--use 2`):

  ```
  이 키로 쓸 수 있는 모델(5개):

    #  모델 id                   이름                입력 토큰  출력 토큰
    1  cdy-listed-model-alpha    Fake Model Alpha      1000000     128000
  * 2  cdy-listed-model-beta     Fake Model Beta       1000000      64000
    3  cdy-listed-model-gamma    Fake Model Gamma       200000      64000
    4  cdy-listed-model-delta    Fake Model Delta       200000       8192
    5  cdy-listed-model-epsilon  Fake Model Epsilon     100000       4096

  * 현재 모델(설정 파일에서): cdy-listed-model-beta
  기록함: cdy-listed-model-beta — 이제 설정 파일의 model 값입니다.
  ```

  - 영어로는 머리 줄이 `Models this key can use (5):`, 확인 줄이 `Written: cdy-listed-model-beta is now the config file's model.`이다.
  - 터미널 질문(stdout)은 `Number or id to write into the config file's model (Enter to skip): `, 한국어로 `설정 파일의 model에 쓸 번호나 id(Enter면 건너뜀): `다. 질문은 터미널을 흉내 내어 보았다(답은 넣지 않았다).
- **`--use <번호|id>`**: 설정 파일에서 그 제공자의 모델 한 곳만 바꾼다. anthropic은 최상위 `model`, openai는 `providers.openai.model`이다. 다른 필드와 값, 순서는 그대로이고, 줄 안의 공백 배치는 다시 쓴다(한 줄에 쓴 배열이 여러 줄로 펼쳐진다).
  - `--config`나 `CODARYN_CONFIG`로 준 파일, 또는 기본 위치에 있는 파일이 필요하다. 기본 위치에 파일이 없으면 요청을 보내기 전에 `invalid_arguments`(종료 2)다. 먼저 `init`을 한다.
  - `--config`로 준 파일이 없으면 `schemaVersion`과 `model`만 있는 파일을 새로 만든다.
  - 목록에 없는 번호나 id는 `invalid_arguments`이고 아무것도 쓰지 않는다.
  - 그 제공자의 모델 변수(`CODARYN_MODEL`, `CODARYN_OPENAI_MODEL`)가 설정돼 있으면 실행은 그 값을 쓴다.
- 터미널에서 `--use`와 `--json` 없이 실행하면 번호를 묻는다. 빈 줄이면 쓰지 않는다(터미널 대화는 확인하지 않았다).
- 오류: API 요청 실패는 `model_list_failed`(종료 8, 메시지에 종류), 설정 파일을 쓰지 못하면 `config_write_failed`(종료 2, 파일은 그대로)다.
- 확인 범위: 실제 API로는 실행하지 않았다. 로컬 가짜 서버와 가짜 키로 확인했다. Anthropic은 1차 문서 작성 때 `CODARYN_API_BASE_URL`에 루프백 `http` 주소로 표, `--json`, `--use`를 봤다. OpenAI는 main `3e36b1b`에서 `CODARYN_OPENAI_API_BASE_URL`로 같은 것을 봤다(아래).

### 두 번째 제공자: OpenAI

제공자는 Anthropic(기본)과 OpenAI 둘이다. OpenAI는 Responses API(`POST /v1/responses`)를 쓴다.

**확인 범위:** 실제 OpenAI API로는 점검하지 않았다. OpenAI의 공식 문서로 확인한 사실([사실 확인](design/second-provider-facts.md))과 로컬 가짜 서버로만 확인했다. 아래 출력은 main `3e36b1b`의 실제 CLI를 가짜 키와 루프백 가짜 서버로 실행한 것이다. 14절의 실제 호출 점검은 OpenAI용도 있지만(U-101) 한 번도 실행하지 않았다.

**고르기:** 간편 형식과 한 줄 실행은 설정 파일의 `provider`를 쓰고, 없으면 anthropic이다. task 파일은 `model.provider`로 고른다. 제공자를 고르는 환경 변수는 없다.

**설정:** OpenAI의 설정은 설정 파일의 `providers.openai` 아래에 둔다(`model`, `maxOutputTokens`, 필요하면 `apiBaseUrl`, `requestTimeoutMs`, `maxRetries`). 최상위의 `model`·`maxOutputTokens`·`apiBaseUrl`은 Anthropic 몫이다. 그래서 `init`이 만든 파일에 `"provider": "openai"`만 더하면 출력 상한이 없어 실행이 멈춘다:

```
{"schemaVersion":1,"kind":"error","code":"provider_not_configured","exitCode":7,"message":"not set: maxOutputTokens (task model.maxOutputTokens or config providers.openai.maxOutputTokens). Nothing was sent"}
```

- 이때 `doctor`의 모델 항목도 `maxOutputTokens is not set (task model.maxOutputTokens or config providers.openai.maxOutputTokens)`로 채울 곳을 알린다(main `23daf6b`). 모델이 없으면 `no model is set (task model.model, CODARYN_OPENAI_MODEL or config providers.openai.model); codaryn models lists the models`다.
- `init`은 지금처럼 Anthropic 설정만 만들고 Anthropic 키만 안내한다. OpenAI 설정은 직접 더한다.

**모델:** 코드에 기본 모델이 없다. 현행 Codex 계열 모델 id는 API에 없으므로(결정 DR-31) 특정 모델을 전제로 하지 않는다. `models --provider openai`로 키가 쓸 수 있는 목록을 보고 고른다.

```powershell
# OPENAI_API_KEY는 미리 사용자 환경 변수로 등록해 둔다(4절 "키"와 같은 방법)
node dist/src/cli/main.js models --provider openai
node dist/src/cli/main.js models --provider openai --use 1
```

가짜 서버의 목록으로 본 실제 출력(stdout):

```
Models this key can use (2):

  #  id            name          input tokens  output tokens
* 1  fake-model-a  fake-model-a             -              -
  2  fake-model-b  fake-model-b             -              -

* current model (from the config file): fake-model-a
Written: fake-model-a is now the config file's providers.openai.model.
```

- OpenAI 목록에는 이름과 토큰 상한이 없어 이름 칸에 id가, 상한 칸에 `-`가 나온다.
- `OPENAI_API_KEY`가 없으면 `provider_not_configured`(종료 7, 메시지 `not set: OPENAI_API_KEY. Nothing was sent`)이고 아무것도 보내지 않는다.

`--use 1`은 `init`이 만든 파일 끝에 `providers.openai.model`을 더한다. 여기에 `maxOutputTokens`와 `provider`를 직접 더하면 설정 파일의 뒷부분이 이렇게 된다(앞부분은 `init`이 만든 그대로):

```json
  "providers": {
    "openai": {
      "model": "fake-model-a",
      "maxOutputTokens": 4096
    }
  },
  "provider": "openai"
}
```

이 설정으로 `doctor --workspace <폴더>`는 키 항목이 `OPENAI_API_KEY is set; openai requests send it to https://api.openai.com, the default address`(main `5701ebe`. 주소 변수를 두면 그 주소와 변수 이름이 나온다), 모델 항목이 ok이고 종료 0이다. 간편 형식 실행의 진행 줄(stderr):

```
codaryn: run started — provider openai
codaryn: using the config file in the default location: %APPDATA%\Codaryn\config.json
codaryn: turn 1
codaryn: write file — allowed (write_file)
codaryn: created summary.md
codaryn: turn 2
codaryn: finished — needs input (no_verifier)
```

**보내는 것과 남기는 것:**
- 키는 `Authorization` 헤더에만 들어간다. 요청 본문과 기록에는 없다.
- 요청마다 `store: false`로 OpenAI 쪽 응답 저장을 끈다. 그래서 다음 요청에 앞 응답의 항목(추론 항목 포함)을 다시 보낸다. 추론 항목은 암호문이라 Codaryn의 가림이 볼 수 없다. 자세한 것은 [민감정보 처리](privacy.md) "OpenAI 제공자"다.
- 실행 기록에는 추론 항목의 개수만 남는다(`model_response`의 `reasoningItems`).
- 키가 거부되면(401·403) 제공자의 문구를 옮기지 않고 고정 문구와 요청 id만 남긴다. 예: `HTTP 401: the key or its access was refused; the provider's message is not shown (request req_fake_1)`.
- 할당량 소진(429 중 `insufficient_quota`나 과금 코드)은 다시 시도하지 않는다.

**결과 읽기와 되돌리기:** OpenAI로 한 실행도 Anthropic 실행과 같이 `runs`, `report`, `changes`, `revert`로 다룬다(10절, 11절). main `e75726e`에서 위 실행을 다룬 실제 출력:

```
run id (UTC)               started (local)      changes  result
20261112T083533Z-dcf48f22  2026-11-12 17:35:33  1        needs input (needs-input/no_verifier)
```

- `report --run latest`의 머리에 ``- Provider: `openai` ``가 나온다.
- `revert --run <실행 id>`는 `codaryn: Files reverted: 1 (complete)`, `summary.md — deleted (created by this run)`로 실행이 만든 파일을 지웠다. 그 뒤 `runs`의 결과 칸에 `· reverted (complete)`가 붙는다.

## 5. 파일 위치 규칙

- 변수 파일, 설정 파일, task 파일, 대본 파일(scripted 모델), 취소 파일은 **작업 공간 밖**에 둔다. 기본 위치의 설정 파일도 같다. 모델이 작업 공간 안 파일을 고쳐 다음 실행의 API 주소, 정책, 검증기, 한도를 바꾸지 못하게 하기 위해서다.
- 실경로(링크, 정션, 8.3 이름을 푼 경로)가 작업 공간 안이거나 위치를 확인할 수 없으면 실행 전에 거부한다. 변수·설정 파일은 `invalid_config`, task 파일은 `invalid_task`, 대본 파일은 `invalid_script`, 취소 파일은 `invalid_arguments`다.
- 그래서 사용자 홈 폴더 전체처럼 `%APPDATA%`를 품는 폴더는 기본 설정 파일이 있을 때 작업 공간으로 쓸 수 없다. 더 좁은 폴더를 고른다.
- 네트워크·장치 경로(UNC `\\server\share`, `\\?\`, `\\.\`, `NUL`·`CON`·`COM1` 같은 장치 이름)는 쓸 수 없다.
- **작업 공간은 CLI 설치 위치 밖에 둔다.** 작업 공간이 설치 위치(`npm link`했으면 이 저장소)와 같거나, 그 안에 있거나, 그것을 포함하면 실행 전에 `workspace_is_install_dir`(종료 2)로 거부하고 아무것도 쓰지 않는다. 실행 중인 CLI가 자기 파일을 고치지 못하게 하기 위해서다.

## 6. 설정 파일과 task 파일

예시는 [`examples/`](../examples)에 있고 키가 없다.

- `demo/`: 키 없는 체험(3절). scripted 대본, task, 작업 공간.
- `organize-demo/`: 키 없는 파일 정리 체험(18.2절). 계획 실행 → 승인과 적용 → 되돌리기.
- `analyze-demo/`: 키 없는 자료 분석 체험(18.9절). 합성 표 하나, `data_checks` 검증기, 재수정 1회, 사람 확인.
- `workflow-demo/`: 사용자 정의 작업 종류 체험(18.10절). 설정 파일의 `workflows`에 정의 하나, 그것을 고르는 task.
- `config.example.json`: 모델 자리표시자, 보수적 한도와 재수정 한도, `node --test` 규칙, `test`·`tests` 보호, 테스트 검증기.
- `doc-task.json`: `workspaces/notes/README.md`에 절 추가, `file_rules` 검증기, 재수정 1회.
- `code-task.json`: `workspaces/calc`의 실패하는 테스트 수정, `sum.test.mjs` 보호, 재수정 2회.

설정 파일은 4절의 순서로 찾은 하나만 읽는다. `schemaVersion`(1)만 필수이고, 모르는 필드나 잘못된 값은 `invalid_config`다.

| 항목 | 뜻 |
| --- | --- |
| `model` | 모델 ID. 자리표시자(`<model id>` 등)는 설정되지 않은 것으로 본다. `models --use`로 바꾼다(4절) |
| `maxOutputTokens` | 요청당 출력 토큰 상한(1~200,000) |
| `requestTimeoutMs`, `maxRetries` | HTTP 요청 시간 제한(기본 600000)과 재시도 횟수(0~10, 기본 2) |
| `apiBaseUrl` | API 주소. 보통 비워 둔다 |
| `limits` | 한도의 **상한**. task가 비운 필드에는 이 값을 쓴다 |
| `policy`, `verifiers` | 간편 형식과 한 줄 실행에서만 쓴다. task 파일은 자기 값을 쓴다. 명령 규칙에 묻고 실행하는 `confirm: true`를 둘 수 있다(13절) |
| `secretEnv` | 가릴 값으로 등록할 환경 변수 이름. task의 것에 더해진다 |
| `integrity.paths` | 작업 공간 밖 검증 자료(기준 테스트 등)의 절대 경로. 실행 중 바뀌면 `needs-input`/`protected_changed`([계약 15절](cli-contract.md#15-단계-3-계약-u-1u-3-u-5-u-6)) |
| `language` | 사람용 글의 언어 `"ko"` 또는 `"en"`(8절) |
| `profiles` | 이름 → `policy`·`verifiers`·`limits`·`workflowRef` 묶음. `--profile <이름>`으로 고른다(아래) |
| `workflows` | 사용자 정의 작업 종류. id → 정의(18.1절) |

**프로필(`profiles`):**

```json
"profiles": {
  "doc": {
    "limits": { "maxModelTurns": 8, "maxToolCalls": 12 },
    "verifiers": [{ "id": "readme", "kind": "file_rules", "rules": [{ "type": "contains", "path": "README.md", "text": "## Install" }] }]
  }
}
```

- `--profile <이름>`은 `run`(모든 형식)과 `doctor`가 받는다. 이름은 영문·숫자·`.`·`_`·`-` 1~64자이며, 형식이 틀리면 `invalid_arguments`다.
- 간편 형식과 한 줄 실행에서는 프로필의 `policy`·`verifiers`가 설정의 것을 대신하고, `limits`는 설정 `limits` 위에 필드별로 덮인다. task 파일 실행에서는 프로필의 한도만 상한으로 쓴다. 프로필의 명령 규칙에도 `confirm: true`를 둘 수 있다(13절).
- 프로필의 한도는 설정 최상위 `limits`보다 클 수 없다. 파일을 읽을 때 모든 프로필을 검사하므로, 고르지 않은 프로필 하나가 넘어도 `invalid_config`다. 오류는 이름 대신 순번으로 위치를 말한다(`profiles[1].limits.maxModelTurns`).
- 프로필을 쓴 실행은 끝 요약에 `A profile was applied (--profile).`가 붙는다. 이름은 나오지 않는다.
- 그 이름의 프로필이 없으면 `run`은 `invalid_config`다. 프로필은 사용자 설정 파일에만 있고 task 파일은 프로필을 가질 수 없다.

**task 파일 필드:** 모르는 필드가 있으면 `invalid_task`다. task·설정 파일은 BOM이 있어도 읽는다.

- `schemaVersion`(1), `id`(영문·숫자·`.`·`_`·`-`, 1~64자), `goal`(작업 목표), `workflow`(표시용 문자열).
- `workspaceRoot`: task 파일 위치 기준 상대 경로 또는 절대 경로. 도구가 접근할 수 있는 루트는 이 하나뿐이다.
- `model`: `{"provider":"anthropic"}`에 선택 필드 `model`, `maxOutputTokens`. 키 없는 시험은 `{"provider":"scripted","scriptPath":"<대본 파일>"}`(3절)이다.
- 그리고 `policy`(`protectedPaths` 포함, 13절), `privacy.secretEnv`, `limits`, `verifiers`.
- 범용 작업(18절): `workflowRef`(작업 종류 선택), 그 작업 종류 안에서 좁히는 `tools`, `plan`, `completion`, `humanReview`, 파일 정리의 계획 동작 허용 `policy.planActions`(`move`, `discard`). 없으면 지금까지와 같이 실행된다.

**한도(`limits`):**

- 예산 한도 넷은 재수정을 포함한 실행 전체에 적용한다: `maxModelTurns`, `maxToolCalls`, `maxTotalTokens`(모든 요청의 입력과 출력 토큰 합), `maxDurationMs`. 처음에는 낮게 두고 결과의 `usage`를 보며 올린다.
- 재수정 한도 둘(9절): `maxRepairAttempts`(0 이상, 기본 0)와 `maxSameFailures`(1 이상, 기본 2). 두 파일 모두에서 생략할 수 있다.
- **설정 파일의 한도는 상한이다.** task는 필드마다 그 값 이하만 정할 수 있고, 넘으면 `invalid_task`다. 설정이 숫자인데 task가 `maxTotalTokens: null`을 주어도 `invalid_task`다. 예산 한도가 어디에도 없으면 task 형식은 `invalid_task`, 간편 형식은 `invalid_config`다. 모델과 검증기를 돌리지 않는 `plan`·`review`·`changes`의 간편 형식은 한도를 요구하지 않는다(18.1절 "간편 형식").
- **anthropic에서는 총 토큰 한도가 필수다.** `maxTotalTokens: null`은 task에 있으면 `invalid_task`, 설정에 있으면 `invalid_config`다.
- **절대 상한(코드):** 턴 1000, 도구 호출 5000, 총 토큰 50,000,000, 실행 시간 86,400,000ms(24시간), `maxRepairAttempts` 20, `maxSameFailures` 10. 넘으면 그 값을 적은 파일의 오류다.
- 다른 시간 값(`requestTimeoutMs`, 검증기 `timeoutMs`)은 2,147,483,647ms 이하다. 모델이 `run_command`에 주는 `timeoutMs`는 600000ms 이하이며, 넘으면 그 호출이 `invalid_args`로 거부된다.

**검증기(`verifiers`):** `command`(`executable`, `args`, 선택 `cwd`, `timeoutMs` 기본 60000, `expectExitCode` 기본 0), `file_rules`(`exists`, `absent`, `contains`, `not_contains`), 표를 확인하는 `data_checks`(18.6절). 모든 검증기가 통과해야 `done`이다. 모델의 완료 선언만으로는 성공하지 않고, 검증기가 없으면 `needs-input`으로 끝난다.

**오류 위치:** 설정·task·대본 파일의 오류는 어느 파일의 어느 필드인지, JSON 문법 오류는 줄과 열을 알려 준다. 값은 보이지 않는다. stdout JSON의 `diagnostic`(`code`, `file`, `field`, `line`, `column`)에도 같은 위치가 있다. 실제 출력(stderr):

```
codaryn: error — the config file cannot be read or has an invalid value (invalid_config)
  config file — JSON syntax error at line 5, column 3
  To fix: Fix the named field in the config file. Without a config file, codaryn init creates one.
  Check: codaryn doctor
```

```
codaryn: error — the config file cannot be read or has an invalid value (invalid_config)
  config file — limits has an unknown field. Did you mean limits.maxModelTurns?
  To fix: Fix the named field in the config file. Without a config file, codaryn init creates one.
  Check: codaryn doctor
```

모르는 필드는 그 이름을 보이지 않고, 그 필드를 가진 객체(`limits`)와 가까운 허용 이름만 알린다.

## 7. 실행 전 점검 (`doctor`)

실행에 필요한 것을 실행 없이 점검한다. 네트워크에 접속하지 않고, 모델에 요청하지 않고, 아무것도 쓰지 않는다.

```powershell
# 간편 형식·한 줄 실행 전에 (설정은 기본 위치)
node dist/src/cli/main.js doctor --workspace D:\work\notes
# task 파일로 실행할 때(task가 작업 공간을 정하므로 --workspace와 함께 쓰지 않는다)
node dist/src/cli/main.js doctor --task D:\codaryn-settings\tasks\fix-sum.json
```

- 옵션: `--config`, `--vars-file`, `--task` 또는 `--workspace`, `--profile`, `--json`.
- 항목은 Node.js 버전, 설정 파일, 변수 파일, task 파일, API 키, 모델, 한도, 파일 위치, 허용 명령(실행 때와 같은 규칙으로 찾고 판정), 작업 공간, 설치 위치, 보호 대상 경로, 메시지 언어, 작업 공간 잠금이다. 줄마다 상태(`[ok]`, `[warning]`, `[failed]`, `[skipped]`)와 이유가 나온다. `--json`의 점검 id와 상태 값(`ok`, `warn`, `fail`, `skipped`)은 영어로 고정이다.
- 종료: 가장 나쁜 항목이 `ok`(또는 `skipped`)면 0, `fail`이면 1, `warn`이면 3이다. 인자 오류는 `invalid_arguments`(종료 2)다. `--task`와 `--workspace`를 함께 주면 이 오류다.
- 키는 있음·없음만 적고 값은 내지 않는다. 파일이나 환경에서 읽은 값도 내지 않는다. 키가 있으면 그 키를 보낼 주소와, 그 주소를 정한 곳(제공자의 주소 변수, 설정 필드, 기본값)을 함께 적는다. 예: `OPENAI_API_KEY is set; openai requests send it to https://api.openai.com, the default address`.
- 설정 파일 항목은 그 파일을 어디서 받았는지 적는다. 기본 위치면 위 예처럼, `--config`로 주면 `the config file given by --config is valid`다.
- 프로필이나 task 파일이 작업 종류를 고르면, 그 작업 종류의 규칙이 설정의 정책에서 빼는 것을 허용 명령 항목 아래에 알린다(18.1절 "정책 합치기"). 설정 정책에 명령 규칙 하나(`node --test`)와 `restorePathTokens: true`가 있고 프로필 `tidy`가 `workflowRef: "organize"`일 때 `doctor --workspace … --profile tidy`의 실제 출력 일부(U-24 문구 브랜치 `f2ed116`(main `266c46d` 위)):

```
[skipped] allowed commands          no command is allowed and no command check is configured
                                    a run of this task type leaves out command rules of the configured policy: 1
                                    a run of this task type does not restore path tokens, although the configured policy allows it
```

  같은 설정에서 `workflowRef: "code"`인 프로필은 빼는 것이 없어 `executables found and allowed by the run's rules: 1`만 나온다.
- **모델이 실제로 있는지는 확인하지 않는다**(네트워크 없음). 자리표시자 모델은 `failed`다. 목록은 `models`(4절)로 본다.

`init`만 한 상태(키 없음, 자리표시자 모델)에서 작업 공간을 점검한 실제 출력이다.

```
[ok]      Node.js version           Node.js 26 meets the requirement (26 or later)
[ok]      config file               the config file at the default location %APPDATA%\Codaryn\config.json is valid
[skipped] variables file            no --vars-file given
[skipped] task file                 no --task given
[failed]  API key                   ANTHROPIC_API_KEY is not set; a run with the anthropic provider stops with provider_not_configured
                                    Windows: run rundll32 sysdm.cpl,EditEnvironmentVariables, add the user variable ANTHROPIC_API_KEY, then open a new terminal.
[failed]  model                     the model is still a placeholder, so it counts as not set; choose one with codaryn models --use
[ok]      limits                    every limit is set for the quick form
[ok]      file locations            input files outside the workspace: 1
[skipped] allowed commands          no command is allowed and no command check is configured
[ok]      workspace                 the workspace is an existing directory
[ok]      install directory         the workspace is outside the CLI's install directory
[skipped] protected material paths  integrity.paths is not set
[ok]      message language          message language en (from CODARYN_LANG)
[ok]      workspace lock            no workspace lock file

doctor: failed (exit code 1). No network access was made and nothing was changed.
```

- 위 출력은 main `bc3305d`의 실제 CLI다(`init` 직후, 키 없음).
- **키가 없을 때**(U-100): `API key` 줄 아래에 이 OS에서 키 변수를 등록하는 방법 한 줄이 붙는다. `init`의 안내와 같은 글이고, 명령에 값을 넣지 않는다. 한국어는 `Windows: rundll32 sysdm.cpl,EditEnvironmentVariables 로 환경 변수 창을 열어 사용자 변수 ANTHROPIC_API_KEY를 더하고 새 터미널을 여세요.`다. `--json`은 예전과 같다(이 줄이 없다). Windows에서만 확인했다.
- **키는 있지만 보낼 수 없을 때**(U-87): 값에 출력 가능한 ASCII(0x21~0x7E)가 아닌 글자(공백 포함)가 있으면 `API key`가 `[failed]`다. 실행하면 아무것도 보내지 않고 `model_error`(`not_configured`)로 끝나기 때문이다. 값은 출력하지 않는다(값과 그 10자 조각이 stdout·stderr·`--json` 어디에도 없음을 확인).

  ```
  [failed]  API key                   ANTHROPIC_API_KEY is set but holds a character other than printable ASCII (0x21-0x7E, no spaces), so it cannot be sent; check the variable's value
  ```

  - 한국어는 `ANTHROPIC_API_KEY 값에 출력 가능한 ASCII(0x21-0x7E, 공백 없음)가 아닌 글자가 있어 보낼 수 없습니다. 변수 값을 확인하세요`다. `--json`의 점검은 `"status":"fail"`, 글 id `doctor.api_key.unusable`이다.
  - 확인: main `bc3305d`의 실제 CLI, 공백이 든 합성 값.
- `message language`는 언어가 어디서 정해졌는지 알린다. `CODARYN_LANG`이 `ko`·`en`이 아니면 `warn`이다(8절).
- `workspace lock`은 `.codaryn/lock.json`을 바꾸지 않고 읽는다. 살아 있는 프로세스가 쥐고 있으면 `[warning]`이고 `doctor`는 종료 3이다(17절 `workspace_locked`).

## 8. 실행

```powershell
# 한 줄 실행: 현재 디렉터리가 작업 공간이다. 정책·한도·검증기는 설정 파일(과 프로필)에서 온다
Set-Location D:\work\notes
node C:\path\to\Codaryn\dist\src\cli\main.js run "README에 설치 절을 추가한다"
# 간편 형식: 작업 공간을 명시한다
node dist/src/cli/main.js run --workspace D:\work\notes --goal "README에 설치 절을 추가한다" --profile doc
# task 파일 형식 (task 파일도 작업 공간 밖에 둔다)
node dist/src/cli/main.js run --task D:\codaryn-settings\tasks\fix-sum.json --vars-file D:\codaryn-settings\.env
```

- **한 줄 실행** `run "<목표>"`은 `--workspace <현재 디렉터리> --goal <목표>`와 같다. 위치 인자는 하나만 받고, `--task`·`--workspace`·`--goal`과 함께 쓰면 `invalid_arguments`다. `--`로 시작하는 목표는 옵션으로 읽힌다. `npm link`했으면 `codaryn run "<목표>"`다.
  - 현재 디렉터리가 설치 위치(이 저장소)와 겹치면 `workspace_is_install_dir`(종료 2)다.
  - 확인 범위: 이 문서 작성 때 한 줄 실행은 키 없음·자리표시자 모델의 `provider_not_configured`(종료 7, 전송 없음)와 설치 위치 거부까지 실제로 확인했다. 실제 모델로 끝까지 실행하지는 않았다(실제 API 미검증).
- 제공자는 anthropic과 openai다(키 없는 시험용 `scripted` 제외). 간편 형식과 한 줄 실행은 설정 파일의 `provider`를 쓰고, 없으면 anthropic이다(4절 "두 번째 제공자: OpenAI").
- 예시를 직접 돌릴 때는 `examples` 폴더를 저장소 밖에 복사한 뒤 그 사본의 task를 실행한다. 모델이 예시 파일을 실제로 고치고, 작업 공간에 `.codaryn/`가 생긴다.
- 옵션은 `--config`, `--vars-file`, `--cancel-file`, `--profile`, `--quiet`이다.
- 취소는 Ctrl+C로 하거나, `--cancel-file`로 지정한 파일(작업 공간 밖)을 만들어서 한다. 상태는 `cancelled`(5)가 되고 이미 적용한 변경은 남는다.
- 모델은 허용 명령 목록을 따로 받지 않는다. 실행할 명령을 `goal`에 정확히 적는다(예: `code-task.json`).

**사람용 출력(stderr):** 사람이 읽는 글은 stderr에 나온다. stdout에는 결과 JSON 한 줄이 나온다. 다만 콘솔처럼 stdout과 stderr가 둘 다 터미널이면, `--json`이나 `--quiet`가 없는 한 그 줄을 내지 않는다(10절 "터미널에서").

- 진행 줄: `codaryn: `로 시작한다. 실행 시작, 턴 번호, 도구 허용·거부(사람 말 뒤 괄호에 `권한/코드`), 허용됐지만 실패한 호출과 명령의 종료 코드·시간 초과(아래 "실패한 호출"), 만들거나 바꾼 파일, 검증 결과(검증기 순번), 재수정 회차, 보호 대상 확인, 종료 상태. 모델 응답과 도구 결과의 내용은 쓰지 않는다.
- 끝 요약: 상태와 이유, 통과한 검증 수, 바뀐 파일 수와 목록(5개까지), 거부된 호출 수, 실패한 호출 수(있을 때), 허용 방법, 사용량(턴, 도구 호출, 초), 가림 개수(가릴 값을 등록한 실행), 에이전트의 마지막 답(있을 때), 기본 설정·프로필 사용 여부, 실행 id, 다음 명령(`report`, `revert`). 예시는 3절.
- **다음 명령의 작업 공간 경로**(DR-51, DR-60, U-38): `--workspace`로 친 경로를 그대로 큰따옴표에 넣어 보인다. 복사해 쓸 수 있게 하려는 것이다. `run`과 `apply`의 끝 요약이 그렇다.
  - 큰따옴표로 보이는 조건: 모든 글자가 글자·숫자·결합 부호, 공백, `\ / : . _ - ( ) , + = @` 가운데 하나다. 그리고 80자 이하이고, 끝이 역슬래시가 아니며, 등록한 가릴 값·키 모양·토큰 모양이 들어 있지 않다.
  - 그 밖이면 예전처럼 `<workspace>`다. 예: 작은따옴표가 든 경로, 둥근 따옴표가 든 경로.
  - task 파일 형식(`--task`)은 친 작업 공간 경로가 없으므로 `<workspace>`다(3절의 예). 한 줄 실행은 `--workspace .`이다(코드 기준).
  - `revert`가 내는 다음 명령 안내(위험한 이동에 대한 동의, 18.5절)는 등록 값을 모르므로 늘 `<workspace>`다.
  - JSON 결과와 실행 기록에는 경로를 싣지 않는다.
  - 확인(main `bc3305d`의 실제 CLI, 간편 형식): 절대 경로 → `Report: codaryn report --workspace "D:\…\proj" --run <id>`(경로와 id는 줄임). 상대 경로 `proj` → `--workspace "proj"`. `it's here` 폴더 → `--workspace <workspace>`. `apply --workspace <경로>`의 끝 요약도 `Report:`와 `Revert:` 두 줄 모두 큰따옴표의 경로였다. 한국어 줄(`보고서: …`)도 같다.
- **실패한 호출(U-18, AXM-4):** 정책이 허용했지만 해 보니 실패한 도구 호출은, 허용 줄 다음에 `<도구> — failed (<코드>)` 줄이 하나 더 붙는다. 실행이 끝나면 끝 요약에 `Failed calls: <수>`가 `Denied calls` 다음에 나온다.
  - 명령이 0이 아닌 코드로 끝나거나 시간 한도에 걸린 것은 실패로 세지 않는다. 대신 줄 하나가 붙는다. 실행 자체는 된 것이기 때문이다.
  - 거부된 호출(정책 밖, 인자 검사)은 실패로 세지 않는다. 거부 줄 하나뿐이다.
  - 실패가 없는 실행의 출력은 예전과 같다(3절).
  - 실제 출력(main `4010905`, stderr, 일부). 대본이 차례로 다음을 부른 실행이다: 없는 파일 읽기, 틀린 해시로 쓰기, 허용했지만 없는 실행 파일, `process.exit(3)`, 400 ms 한도를 넘는 명령, 정책 밖 명령(`git status`).

    ```
    codaryn: read file — allowed (read_file)
    codaryn: read file — failed (not_found)
    codaryn: write file — allowed (write_file)
    codaryn: write file — failed (conflict)
    codaryn: run command — allowed (run_command)
    codaryn: run command — failed (spawn_failed)
    codaryn: run command — allowed (run_command)
    codaryn: command ran — exit code 3
    codaryn: run command — allowed (run_command)
    codaryn: command ran — stopped at its time limit
    codaryn: run command — denied (command/command_not_allowed)
    ```

    끝 요약에는 `Denied calls: 1` 다음에 `Failed calls: 3`이 나왔다(그 사이의 `turn` 줄은 뺐다). 실행은 검증을 통과해 `done`(종료 0)이었다.
  - 한국어 줄:
    - `파일 읽기 — 실패 (not_found)`, `파일 쓰기 — 실패 (conflict)`, `명령 실행 — 실패 (spawn_failed)`
    - `명령 실행됨 — 종료 코드 3`, `명령 실행됨 — 제한 시간이 지나 멈춤`
    - 끝 요약 `거부된 호출: 1건`, `실패한 호출: 3건`
  - 보고서는 10절 "보고서"를 본다.
- **가림 개수(DR-52):** 가릴 값이 하나라도 등록된 실행이면 끝 요약의 사용량 다음 줄에 두 개수가 나온다. 개수만 나오고 값, 위치, 길이는 나오지 않는다. 진행 줄에는 없다. `--quiet`이면 이 줄도 없고, stdout JSON의 `masking`은 그대로다(10절).

  ```
  Masking: values registered 1 · places masked in what the model was sent 1
  ```

  - 한국어는 `가림: 등록된 가릴 값 1개 · 모델에 보낸 글에서 가린 곳 1개`다.
  - 확인: main `0ad28bc`의 실제 CLI(대본 모델, 합성 값)에서 `secretEnv`에 값 하나를 등록하고 그 값이 든 파일을 한 번 읽은 실행이다. 경우별로 잰 개수는 [민감정보 처리](privacy.md) 5절 "가림 개수"에 있다.
  - 앞의 수(`registeredValues`)는 이 실행이 등록한 서로 다른 가릴 값의 수다. `secretEnv`의 값만이 아니라 키 변수와 변수 파일의 값도 든다(12절 "가림 개수가 알리는 것").
  - 뒤의 수(`maskedPlaces`)는 엔진이 모델에 보낸 글(시스템 글, 작업 메시지, 도구 결과, 재수정 메시지)에서 가린 곳의 수다. 글마다 처음 보낼 때 한 번 센다. 그래서 같은 파일을 두 번 읽으면 두 번 세고, 한 파일에 값이 두 번 있으면 두 번 센다. 맞닿은 두 값은 토큰 하나가 되어 한 번 센다. 모델이 돌려준 글은 세지 않는다.
  - 0은 "모델에 보낸 글에서 가린 곳이 없었다"는 뜻이다. 값이 모델에 가지 않았다는 보증은 아니다. 가리지 못하는 형태(16절 "가림의 빈틈", "키 거부와 가림의 빈틈")는 세지도 않는다.
  - 가린 곳의 수는 등록 값이 나온 횟수와 다를 수 있다. 표지 글 `CODARYN_SECRET`이 든 파일도 가린 곳으로 센다(12절).
  - 등록한 가릴 값이 없으면 이 줄이 없다.
  - GUI도 실행 끝 화면과 보고서의 사용량 탭에 같은 글의 줄을 보인다(U-40). 근거는 코드와 검토 R-63이고, GUI는 띄우지 않았다([민감정보 처리](privacy.md) 5절 "가림 개수").
  - 이 줄과 결과의 `masking`은 짧은 가릴 값의 추측을 확인하는 데 쓰일 수 있다. 짧은 비밀을 쓰는 실행의 출력은 공개 로그에 남기지 않는다(12절).
- **에이전트의 마지막 답(DR-47):** 실행이 모델의 마지막 답(도구 호출 없이 끝낸 응답)으로 끝났으면, 끝 요약의 사용량 다음에 머리말 `The agent's last message (the agent's own words, not a verified fact):`(한국어 `에이전트의 마지막 답(에이전트의 말이며 검증된 사실이 아님):`) 아래로 그 글이 나온다.
  - 머리말 그대로 에이전트의 말이며 검증된 사실이 아니다. "다 고쳤다"고 써도 검증을 통과했다는 뜻이 아니다. 판정은 검증 결과와 `report`로 한다.
  - 글은 줄마다 `  | `로 시작한다. 탭과 이어진 공백은 공백 하나로 보이고, 긴 줄은 접힌다.
  - 글은 가린 기록에서 만든다. 가릴 값은 토큰(`[[CODARYN_SECRET:…]]`)으로, 키 모양은 `[key]`로 보인다. 제어 문자와 보이지 않는 문자(양방향 제어, 영폭 공백 등)는 빠진다(개인정보 문서 5절).
  - 2,000자(코드 포인트)까지다. 넘으면 앞 2,000자만 보이고 그 아래에 `(cut: only the first 2000 characters are shown)`(한국어 `(잘림: 앞 2000자만 보입니다)`)가 붙는다.
  - 없는 경우: 계획 실행(`plan_pending`, 그 자리는 계획의 요약이다. 18.3절 "계획 보기"), 한도에 걸리는 등 모델의 답 없이 끝난 실행, 답이 비었거나 공백뿐인 실행.
  - 같은 글이 나오는 곳: stdout JSON(터미널이 아닐 때와 `--json`·`--quiet`일 때, 10절 "터미널에서")과 `result.json`의 `finalMessage`(10절), `report`의 `## The agent's last message` 절(머리말 `The agent's last message. These are the agent's own words, not a verified fact.`, 3절), `report --json`의 `result.finalMessage`, GUI의 실행 결과 화면과 보고서 화면(같은 뜻의 머리말. GUI는 코드로만 확인했고 화면은 띄우지 않았다).
  - **journal에는 모델이 보낸 글이 그대로 남는다.** `journal.jsonl`의 `model_response` 기록마다 `text`에 그 턴의 모델 글이 있다. 등록한 가릴 값만 토큰으로 바뀌어 있고(가림본), 위의 처리(키 모양을 `[key]`로, 제어 문자와 보이지 않는 문자 빼기, 2,000자 자르기)는 거치지 않는다. 마지막이 아닌 답도 남는다. 3절 체험의 journal에는 4턴의 `요약을 만들었다.`와 6턴의 `빠진 '## 할 일' 절을 더했다.`가 둘 다 있고, 끝 요약에는 6턴의 것만 나온다. journal을 열어 보거나 남에게 줄 때는 이 점을 생각한다([민감정보 처리](privacy.md) 5절).
  - 확인(U-21 통합 판 `be5e089`의 실제 CLI): 3절 체험, `analyze` 실행(답 `done`), 가릴 값·키 모양·탭·CRLF·제어 문자·이어진 공백·2,100자를 넣은 대본(영어·한국어), 계획 실행, `max_model_turns`로 끝난 실행, 공백뿐인 답(셋 다 없음). main `a191a50`에서 3절 체험의 끝 요약, `report`, `report --json`, journal을 다시 봤다.
- 오류 설명: 무엇이 잘못됐는지, 위치(6절 "오류 위치"), 고치는 법, 코드. 실행 전 오류에도 나온다. 오류 JSON의 영어 `message`는 stdout에만 있다. 콘솔에서는 그 줄이 나오지 않으므로, `message`를 보려면 `--json`을 준다(10절 "터미널에서"). 예:

```
codaryn: error — the model provider is not fully configured (key, model, output limit), so nothing was sent (provider_not_configured)
  To fix: Run codaryn doctor to see what is missing, including the provider's key variable; choose the model with codaryn models --use.
  Check: codaryn doctor
```

- 이 예는 키도 모델도 없는 상태(`init` 직후)의 `run --workspace … --goal …`이다(main `3e36b1b`, `CODARYN_LANG=en`). 빠진 것(어느 키 변수인지 포함)은 stdout JSON의 `message`와 `doctor`가 알린다(`not set: ANTHROPIC_API_KEY; the model …`). 콘솔에서 `message`를 보려면 `--json`을 준다.

- **`--quiet`**: `run`, `revert`, `apply`가 받는다. 진행 줄, 끝 요약, 오류 설명을 모두 생략한다. stdout의 JSON 한 줄은 그대로이고, 콘솔에서도 나온다(10절 "터미널에서").

**언어:** 사람용 글(위 출력, 도움말, `doctor`)은 한국어와 영어다. 고르는 순서는 `CODARYN_LANG`(`ko`·`en`, 대소문자 무시) → 설정 파일 `language` → OS 표시 언어(한국어면 ko) → en이다. `CODARYN_LANG`이 그 밖의 값이면 무시하고 `doctor`의 메시지 언어 항목이 `[warning]`으로 알린다. 오류 코드, JSON 필드, 종료 코드, 명령 이름, `--json` 출력은 영어로 고정이다. 같은 오류의 한국어 출력 예:

```
codaryn: 오류 — 설정 파일을 읽을 수 없거나 값이 올바르지 않습니다 (invalid_config)
  설정 파일 — limits에 모르는 필드가 있습니다. 가까운 이름: limits.maxModelTurns
  고치는 법: 설정 파일에서 알려 준 필드를 고치세요. 설정 파일이 없으면 codaryn init으로 만들 수 있습니다.
  점검: codaryn doctor
```

## 9. 재수정 반복

모델이 도구 호출 없이 답하면 검증기를 모두 한 번 실행한다(한 회차). 실패하면 그 근거를 모델에 돌려보내 다시 고치게 할 수 있다. `maxRepairAttempts`가 0(기본)이면 첫 실패에서 끝난다. 3절의 체험이 재수정 1회를 보여 준다. 판정은 아래 표의 위에서 아래 순서다.

| 회차 결과 | 결과 |
| --- | --- |
| 모두 `pass` | `done`/`verified` |
| `fail` 없이 `inconclusive`가 있음 | `needs-input`/`verifier_inconclusive`. 재수정하지 않는다 |
| `fail`과 `inconclusive`가 함께 있음 | `failed`/`verifier_failed`. 재수정하지 않는다 |
| `fail`만 있음, 재수정을 `maxRepairAttempts`번 다 씀 | `failed`/`verifier_failed` |
| `fail`만 있음, 같은 실패가 `maxSameFailures`번 연속 | `failed`/`repeated_failure` |
| `fail`만 있음, 그 밖 | 재수정 |

- **같은 실패:** 실패한 검증기의 id, 결과, 근거가 직전 회차와 같으면 같은 실패다. 근거 속 숫자(연속한 숫자와 소수)는 비교에서 무시하므로 실행 시간이나 실패 개수만 다르면 같은 실패다. 테스트 이름이나 메시지 단어가 바뀌면 다른 실패다. `maxSameFailures`가 1이면 어떤 실패도 재수정하지 않는다.
- **예시**(`maxRepairAttempts` 2, `maxSameFailures` 2). 어느 회차든 모두 통과하면 `done`이다.
  - 1회차 실패 A → 재수정 1. 2회차도 실패 A → `failed`/`repeated_failure`.
  - 2회차가 다른 실패 B → 재수정 2. 3회차가 실패 → 재수정 횟수를 다 써서 `failed`/`verifier_failed`.
- 재수정 메시지에는 실패한 검증기의 id, 결과, 가린 근거가 들어간다. 근거는 검증기마다 8192바이트, 메시지 전체 8192바이트 안에서 앞뒤를 남기고 가운데를 생략한다.
- 재수정 전에 다음 모델 호출이 예산 한도 안인지 확인하고, 아니면 그 한도로 `budget-exhausted`다. 검증 도중 실행 시간 한도가 지나도 `budget-exhausted`/`max_duration`이다. 기록에는 `repair_started`(`attempt`, `failedVerifiers`, `feedbackTruncated`)가 남는다. 결과의 `verifiers`는 마지막 회차, `usage.repairAttempts`는 시작한 재수정 수다.
- **주의:** 명령형 검증기는 모델이 고친 코드를 실행한다(예: `node --test`). 재수정을 켜면 그 출력(가린 뒤)이 모델에 돌아간다. 명령 허용 목록이 비어 있어도 마찬가지다. 모델이 쓴 코드를 실행해도 되는 작업 공간에서만 켠다. `file_rules`만 쓰는 문서 작업은 코드를 실행하지 않는다.

## 10. 결과 읽기

`run`의 stdout에는 JSON 한 줄만 나온다(콘솔에서는 아래 "터미널에서"). 비 ASCII 문자는 `\uXXXX`로 나오므로 어느 코드 페이지에서도 JSON으로 읽힌다.

- **실행이 시작되었으면 `kind:"run"`:** `runId`, `status`, `reason`, `exitCode`, `journalPath`, `notices`, `verifiers`(검증기별 `outcome`, `evidence`, `checked`, `limits`), `changes`(적용한 파일 변경과 해시), `usage`(턴, 도구 호출, 토큰, 시간, 재수정 수). 보호 대상이 있으면 `protectedChanged`(바뀐 보호 대상 목록)도 있다. 에이전트의 마지막 답이 있으면 `finalMessage`(`text`, `truncated`)도 있다(8절). `text`는 끝 요약과 같은 처리를 거친 글이고, 줄바꿈은 LF, 탭은 그대로다. 가릴 값을 등록한 실행이면 `masking`(`registeredValues`, `maskedPlaces`: 정수 둘, 8절 "가림 개수")도 있다. 등록한 값이 없으면 필드가 없고, 등록했지만 가린 곳이 없으면 `maskedPlaces`가 0이다. 실행 폴더의 `result.json`에도 같은 필드가 있다. DR-47 전의 판이 쓴 `result.json`에는 `finalMessage`가, DR-52 전의 판이 쓴 것에는 `masking`이 없다. `report --json`의 `result`에도 같은 두 개수가 있고, `report`의 Markdown 본문에는 가림 개수가 없다.
  - **모델 오류로 끝났으면 `modelError`**(U-55, U-82): `{kind, turn, retryable?}`. `kind`는 모델 오류 종류, `turn`은 실패한 요청의 턴(1부터)이다. `retryable`은 나중에 다시 하면 될 수 있는지다(아래 "다시 해도 되는지"). `result.json`과 `report --json`의 `result`에도 같다. 키, 요청 본문, 제공자의 응답은 들어가지 않는다. 사람용 끝 요약과 진행 줄은 바뀌지 않았다(진행 줄은 전처럼 `turn 1 — model request failed (api_error)`, 끝 요약은 `Check with codaryn doctor and codaryn models, then try again later.`).
  - **계획 실행이면 `plan`과 `planSummary`**(U-59): `plan`은 `{digest, actions}`이고, `planSummary`는 에이전트가 `propose_plan`에 쓴 계획 설명이다. 가린 뒤 마지막 답과 같은 처리를 거친 글이다. 다이제스트와 `plan.json`에 들지 않으므로 승인하는 대상이 아니다(18.3절 "에이전트의 설명"과 같은 글). `result.json`에도 같다. 설명이 비었으면 필드가 없다. 확인(main `bc3305d`): 2절의 정리 체험(18.2절)에서 `"planSummary":"사진과 영수증을 연도 폴더로 옮기고 임시 파일을 폐기한다"`(JSON에서는 `\uXXXX`)였고 `finalMessage`는 없었다.
- **되돌리기는 `kind:"revert"`**(11절). **시작 전에 멈췄으면 `kind:"error"`:** `code`, `exitCode`, `message`, 선택 `diagnostic`(6절), `category`, `retryable`(U-55). 메시지에는 값 대신 필드 이름만 적힌다.
  - `category`는 무엇을 고쳐야 하는지의 종류다: `input`(준 인자·파일·경로를 고침), `state`(작업 공간이나 기록이 명령이 바라는 상태가 아님), `environment`(키·설정·제공자·모델 목록·설정 파일 쓰기), `internal`(Codaryn 자신의 실패).
  - 종료 코드와 `message`는 바뀌지 않았다. 필드를 더하기만 했다.
- **다시 해도 되는지(`retryable`)**(U-55, U-82): 같은 명령을 그대로 나중에 다시 하면 될 수 있으면 `true`다. 된다는 약속은 아니다. 제공자 어댑터는 이미 할 수 있는 만큼 다시 시도했다(`maxRetries`, `retry-after`).
  - **없으면 "알 수 없음"이다.** `false`로 읽지 않는다.
  - 오류 JSON: `workspace_locked`, `run_in_progress`만 `true`다(잠금이나 실행이 끝나면 됨). `config_write_failed`는 없다(시스템이 받지 않는 이름이나 없는 드라이브와, 다른 프로그램이 쥔 파일이나 가득 찬 디스크가 같은 코드라 가를 수 없음, U-82). `model_list_failed`는 목록 요청의 실패로 정한다. 나머지는 `false`다.
  - 모델 오류(`modelError.retryable`과 `model_list_failed`): 전송 층의 판정이 먼저다(U-82). 연결 실패(`ECONNREFUSED`, `ECONNRESET` 등)와 시간 초과는 `true`, TLS 실패와 보낼 수 없는 요청 꼴과 읽을 수 없는 응답 본문은 `false`, 전송이 가르지 못한 실패는 없음이다. HTTP 응답이 있으면 속도 제한(429)·과부하(503, 529)·408·409·5xx가 `true`, 인증 실패(401, 403)·할당량 소진(다시 해도 풀리지 않는 429)·그 밖의 4xx가 `false`다(코드 기준).
  - 확인(main `bc3305d`의 실제 CLI, 루프백만):

    | 경우 | 결과 |
    | --- | --- |
    | 닫힌 포트로 `run`(간편 형식) | `modelError` `{"kind":"api_error","turn":1,"retryable":true}`, 기록의 메시지 `network error: connection failed (ECONNREFUSED)` |
    | 닫힌 포트로 `models --json` | `model_list_failed`, `category` `environment`, `retryable` `true` |
    | 연결을 바로 끊는 루프백 서버 | `ECONNRESET`, `retryable` `true` |
    | 포트 9(`fetch`가 막는 포트) | `retryable` `false`, 기록의 메시지 `the transport refused the request format (header, URL or port); nothing was sent` |
    | `run --bogus` | `invalid_arguments`, `input`, `false` |
    | 없는 실행의 `report` | `run_not_found`, `state`, `false` |
    | 모델·키가 없는 설정으로 `run` | `provider_not_configured`, `environment`, `false` |
    | 살아 있는 프로세스가 잠금을 쥔 작업 공간 | `workspace_locked`, `state`, `true` |
    | 쓰기를 막은 폴더에 `init --config` | `config_write_failed`, `environment`, `retryable` 없음 |

    전송이 가르지 못해 `retryable`이 없는 모델 오류는 이 환경에서 만들지 못했다(코드 기준). HTTP가 아닌 바이트로 답하는 서버도 `false`(요청 꼴)로 분류됐다.
- `report`, `doctor`, `models`, `init`, `runs`는 기본이 사람이 읽는 글이고 `--json`이면 각각 `kind:"report"`, `"doctor"`, `"models"`, `"init"`, `"runs"` JSON 한 줄이다. 오류는 어느 명령이든 `kind:"error"` 한 줄이다(콘솔에서는 아래 "터미널에서").
- **터미널에서(DR-49, DR-56, U-23, U-45):** stdout과 stderr가 **둘 다** 터미널이면(콘솔에서 그대로 칠 때) 두 가지 JSON 줄을 내지 않는다. `run`·`apply`·`revert`의 결과 JSON 줄과, 어느 명령이든 오류 JSON 줄이다. 사람용 글(끝 요약, 되돌림 요약, 오류 설명)은 stderr에 그대로 나오고, 종료 코드도 같다.
  - JSON 줄이 나오는 때: 인자 어디에든 `--json`이나 `--quiet`가 있을 때, stdout이 파이프나 파일일 때(`| ConvertFrom-Json`, `> out.json`), stderr를 파일로 돌릴 때(`2> log.txt`). stderr를 돌리면 화면에는 JSON 줄이 남는다.
  - `--quiet`이면 사람용 글 없이 JSON 한 줄만 낸다. 콘솔에서도 그렇다.
  - 글을 내는 명령(`report`, `runs`, `plan`, `changes`, `cleanup`, `doctor`, `models`, `init`, 도움말)은 콘솔에서도 그대로다. 그 명령들의 `--json`도 그대로 JSON 한 줄이다.
  - 계획 실행의 다이제스트는 콘솔에서도 끝 요약의 마지막 줄(`Apply after approval: …` 아래)에 전체가 나온다.
  - **인자 없이** `codaryn`만 치면, stdout이 터미널일 때 `--help`와 같은 도움말을 보이고 종료 0이다. stdout이 파이프나 파일이면 예전처럼 `invalid_arguments`(종료 2)다. `codaryn --quiet`는 콘솔에서도 오류 JSON 한 줄이다.
  - 확인(main `9934a9a`의 실제 CLI): 터미널은 시험과 같은 방식으로 흉내 냈다. 미리 읽기로 `process.stdout`·`process.stderr`의 `isTTY`를 참으로 둔 것이고, 실제 콘솔 창은 쓰지 않았다. "없음"은 stdout 0바이트다.

    | 경우 | 파이프 | stdout만 터미널 | stderr만 터미널 | 둘 다 터미널 |
    | --- | --- | --- | --- | --- |
    | `run`(완료, 종료 0) | 결과 JSON | 결과 JSON | 결과 JSON | 없음. stderr의 끝 요약 |
    | `revert --dry-run`(종료 0) | 결과 JSON | 결과 JSON | 결과 JSON | 없음. stderr의 요약 |
    | 오류: `run --bogus`, 없는 실행의 `report`, 두 번째 `apply`(종료 2) | 오류 JSON | 오류 JSON | 오류 JSON | 없음. stderr의 오류 설명 |
    | `report`, `runs`(종료 0) | 글 | 글 | 글 | 글 |
    | 인자 없음 | 오류 JSON(종료 2) | 도움말(종료 0) | 오류 JSON(종료 2) | 도움말(종료 0) |

    - 둘 다 터미널일 때 더 잰 것:
      - `run --json`과 `revert --dry-run --json`: JSON 한 줄과 stderr의 글
      - `run --quiet`, `apply --quiet`, `revert --dry-run --quiet`: JSON 한 줄, stderr 0바이트
      - `apply`(완료): stdout 없음, stderr의 끝 요약
      - `plan`(글)과 `plan --json`, `report --json`: 그대로
    - 한국어(`CODARYN_LANG=ko`)도 같았다.
  - Git Bash(mintty)를 winpty 없이 쓰면 stdout이 파이프로 보일 수 있어 JSON 줄이 나올 것이다(검토 R-58 R58-I5). 돌려 보지 않았다.
- **`--workspace` 생략(U-17):** 읽기 명령 `report`, `plan`, `changes`는 `--workspace`(와 `--task`)가 없으면 현재 폴더를 작업 공간으로 쓴다. `runs`는 원래 그렇다. 한 줄 실행으로 시작해 그 폴더에 있으면 `codaryn report --run latest`로 된다.
  - 키, 모델, 한도가 없어도 된다(18.1절 "간편 형식"). `plan`·`changes`는 가릴 값을 설정 파일에서 읽으므로, 설정 파일이 깨졌으면 `invalid_config`다(간편 형식은 이번에 쟀고, 생략한 형식은 검토 R-54가 쟀다). `report`와 `runs`는 설정 파일을 읽지 않는다.
  - 바꾸는 명령 `revert`, `cleanup`, `apply`, `review`는 생략하면 `invalid_arguments`(종료 2)로 아무것도 하지 않는다. 현재 폴더라면 `--workspace .`를 준다.
  - 그 안내(`If you mean the current directory, give --workspace .`)는 stdout JSON의 `message`에만 있다. stderr는 `codaryn help <command>`를 보라는 일반 안내뿐이다.
  - 그래서 콘솔에서는 이 안내가 어디에도 보이지 않는다(검토 R-61 R61-L2). 오류 JSON 줄을 내지 않기 때문이다(위 "터미널에서"). 보려면 `--json`을 준다.
    - 확인(main `9934a9a`, 흉내 낸 터미널): 작업 공간 폴더 안에서 `revert --run latest --dry-run`은 종료 2, stdout 0바이트, stderr는 일반 안내 두 줄이었다.
    - 같은 명령에 `--json`을 더하면 stdout의 `message`가 `--workspace and --run are required. If you mean the current directory, give --workspace . usage: …`였다.
  - `apply`와 `review`의 `message`는 둘 다 주지 않았는데도 `give --task or --workspace, not both`로 시작한다.
  - **작업 공간의 하위 폴더에서** 생략하면 그 하위 폴더를 작업 공간으로 읽는다. 실행 기록은 한 단계 위에 있으므로 `run_not_found`("this workspace has no record of that run")다. 작업 공간 폴더로 옮겨 가거나 `--workspace`를 준다.
  - 확인(main `0ad28bc`의 실제 CLI, 작업 공간 폴더 안, 설정 없음과 한도 있는 설정): `report --run latest`, `plan --run <id>`, `changes --run latest`, `runs`는 종료 0이었다. `revert --run latest --dry-run`, `cleanup --older-than 0`, `apply --run … --digest …`, `review --run … --accept`는 `invalid_arguments`였다.

### 실행 목록 (`runs`)

```powershell
node dist/src/cli/main.js runs --workspace D:\work\notes
node dist/src/cli/main.js runs --workspace D:\work\notes --limit 5 --json
```

- 최근 실행이 먼저 나온다(예시는 3절). `--workspace`가 없으면 현재 디렉터리, `--limit`은 1~1000(기본 20)이다. 아무것도 만들거나 바꾸지 않고 잠금도 잡지 않는다. 기록이 없으면 `This workspace has no runs.`이고 종료 0이다.
- 되돌린 실행에는 `· reverted (complete)`가 붙는다.
- **결과가 없는 실행**(U-162): 아직 도는 실행은 결과 칸이 `running`(한국어 `진행 중`)이다. 결과를 남기지 못하고 멈춘 실행(강제로 끝낸 프로세스 등)은 `stopped without a result`(한국어 `결과 없이 중단됨`)다. 변경 칸은 `-`다.
  - 실제 출력(main `07cd600`, 대본 모델의 실행이 허용한 `node` 명령을 기다리는 동안, 그리고 그 CLI 프로세스를 끝낸 뒤):

    ```
    run id (UTC)               started (local)      changes  result
    20261113T064706Z-50e3928a  2026-11-13 15:47:06  -        running
    ```

    ```
    run id (UTC)               started (local)      changes  result
    20261113T064706Z-50e3928a  2026-11-13 15:47:06  -        stopped without a result
    ```

  - 가르는 기준은 잠금이다: `result.json`이 없고 작업 공간 잠금이 그 실행을 가리키며 잠금을 쥔 프로세스가 살아 있으면 도는 중이다. 아니면 결과 없이 멈춘 것이다. 멈춘 실행의 잠금은 남아 있다가 다음 실행이 회수한다(17절).
  - `runs --json`의 항목에는 `phase`가 있다: `running`, `finished`, `no_result`. 위 두 경우는 `"status":null`과 함께 `"phase":"running"`, `"phase":"no_result"`였다.
- 기록이 확인을 통과하지 못한 실행은 목록 뒤쪽에 실행 id와 손상 표시만 나오고 `latest`로 고르지 않는다. `.codaryn`이나 `runs`가 링크이거나 나열할 수 없으면 `invalid_run_record`(종료 2)다.

### `--run latest`

`report`, `revert`, `changes`, `plan`, `review`의 `--run`에 `latest`를 주면 실행 목록의 맨 위(확인을 통과하고 결과가 있는 가장 최근 실행)를 쓴다. `apply`는 `latest`를 받지 않는다(18.3절). 무엇을 하기 전에 stderr에 고른 실행 id와 시작 시각을 쓴다(3절). `--quiet`이면 쓰지 않는다.

- 그런 실행이 없으면 `run_not_found`(종료 2)다.
- **가장 새 실행이 아직 도는 중이면** 앞에 끝난 실행이 있어도 그것을 고르지 않고 `run_in_progress`(종료 6)로 끝난다. 아무것도 바꾸지 않는다(DR-48). 앞선 실행을 보려면 그 실행 id를 준다. 도는 실행의 id를 주면 `report`는 지금까지의 기록을 `incomplete`(종료 3)로 보인다. 실행이 끝나면 `latest`는 그 실행이다.
  - "도는 중"은 결과가 없는 그 실행이 작업 공간 잠금(`.codaryn\lock.json`)을 쥐고 있고, 잠금 규칙이 그 프로세스를 살아 있다고 볼 때다. 결과 없이 멈춘 실행(강제로 끝낸 실행 등)은 잠금이 남아 있어도 그 프로세스가 끝났으면 건너뛰고 앞선 실행을 고른다. 멈춘 실행의 잠금 때문에 이 오류가 계속되면 17절 "멈춘 실행의 잠금이 남아 막힐 때"를 본다.
  - 확인(U-22 판(main `b2dad78`에 U-22의 네 브랜치를 더한 것)과 main `a191a50`의 실제 CLI): 끝난 실행 뒤에 명령 검사 하나를 기다리는 실행을 띄워 두고 `report`, `changes`, `revert --dry-run`, `plan`, `review`의 `--run latest`가 모두 아래 오류였다(`changes`는 main `a191a50`에서 확인). 같은 때 끝난 실행의 id를 준 `report`와 `changes`는 그 실행을 보였다. 한국어는 `가장 최근 실행이 아직 도는 중이어서 결과가 없습니다. 아무것도 바꾸지 않았습니다`로 시작한다.

    ```
    codaryn: error — the latest run is still going and has no result yet; nothing was changed (run_in_progress)
      To fix: Try again when the run ends. To see an earlier run, give its id; codaryn runs lists the runs of the workspace.
    ```
- 이름이 `latest`인 실행 디렉터리가 실제로 있으면 별칭으로 풀지 않고 `invalid_arguments`(종료 2)로 끝난다. 이때는 `runs`의 실행 id를 준다.

### 보고서 (`report`)

```powershell
node dist/src/cli/main.js report --workspace D:\work\notes --run latest
node dist/src/cli/main.js report --workspace D:\work\notes --run 20261112T031500Z-9f2c41ab --json
```

- 그 실행의 `result.json`과 `journal.jsonl`(가림본)만 읽어 Markdown 요약을 낸다. 아무것도 바꾸지 않고 잠금도 잡지 않는다.
- 절: 실행 요약(실행 id, 작업, 제공자, 결과), 검증(마지막 회차와 통과하지 않은 검증기의 근거. 검증기는 순번), 보호 대상, 변경, 에이전트의 마지막 답(있을 때. 검증된 사실이 아니라는 머리말과 함께, 8절), 사용량(한도 대비, 거부된 도구 호출 수, 실패한 도구 호출 수), 검사하지 않은 범위.
- 사용량의 도구 호출 줄은 실패가 있으면 그 수를 함께 적는다(U-18). 8절 "실패한 호출"의 실행에서는 `- Tool calls: 5 of 12 (denied: 1, failed: 3)`였다. 실패가 없으면 `, failed`가 붙지 않아 예전과 같다(3절 체험의 `Tool calls: 3 of 8 (denied: 1)`).
  - `result.json`이 없는 실행(`incomplete`)의 보고서는 기록에서 센 `- Denied tool calls: 1`과 `- Failed tool calls: 3` 줄을 적는다. 같은 실행의 `result.json`을 지우고 확인했다(main `4010905`).
  - `report --json`과 `run`의 결과 JSON에는 실패 수가 없다.
- `--json`은 `kind:"report"` 한 줄이다. `result`는 그 실행의 `result.json`(마지막 답은 `result.finalMessage`. 없으면 `null`이고 `incomplete`다), `journal`은 기록에서 읽은 요약이다.
- 종료: `complete`(0)는 두 파일을 모두 읽음, `incomplete`(3)는 `result.json`이 없음(실행 중이거나 쓰지 못하고 멈춤)이다. 이때는 기록만으로 만들고 "Result: none"과 기록의 종료 기록을 적는다.
- 오류(종료 2): 그 runId의 기록이 없으면 `run_not_found`, 기록을 읽거나 해석할 수 없으면 `invalid_run_record`, 작업 공간이 없으면 `workspace_not_found`다.
- 보고서는 이 두 파일만큼만 믿을 수 있다. 상태 디렉터리는 파일 도구에만 닫혀 있으므로, 실행 중 허용된 명령이 기록을 바꿀 수 있다.
- 계획 실행은 동작 수와 다이제스트를, 사람 확인을 기다리는 실행은 확인 항목과 판정을 함께 보여 준다(18.6절). 적용 실행은 따로 만든 형식(`# Codaryn apply run report`)으로 보여 준다(18.2절).
- 검사하지 않은 범위(`## Not checked`)의 끝에는 가림이 가리지 않는 것이 한 줄 붙는다(U-166). 실제 줄(main `07cd600`): `Masking hides only the values registered for this run and the forms of them it looks for. A secret that was not registered, another form of a value or text in another encoding (such as UTF-16) is not masked.` 적용 실행의 보고서에는 이 줄이 없다(모델에 보내는 것이 없다).

| 종료 코드 | 뜻 |
| --- | --- |
| 0 | `done`: 모든 검증기 통과. 되돌리기 `complete`, 보고서 `complete`, 점검 `ok`, 모델 목록 `listed`·`selected`, `init` `created`, `runs` `listed`, `plan` 보기, `review` 판정 |
| 1 | `failed`: `verifier_failed`, `repeated_failure`, `model_error`, `state_changed`(16절 "실행 기록 변조"), 적용의 `plan_stale`·`apply_incomplete`(18.3절). 점검 `fail`. 정리의 `partly_failed`(지우기가 일부 실패해 남긴 것이 있음, 18.8절) |
| 2 | 입력 오류: `invalid_arguments`, `invalid_task`, `invalid_config`, `invalid_script`, `key_in_file`, `secret_env_missing`, `workspace_not_found`, `workspace_is_install_dir`, `run_not_found`, `invalid_run_record`, `config_write_failed`, `config_exists`, `run_not_plan`, `plan_not_approved`, `plan_already_applied`, `plan_secrets_differ`, `plan_records_changed`, `plan_run_missing`, `run_not_awaiting_review`, `cleanup_plan_changed`(정리의 다이제스트가 지금의 미리보기와 다름, 18.8절) |
| 3 | `needs-input`: `no_verifier`, `verifier_inconclusive`, `unknown_tool_outcome`, `protected_changed`, `plan_pending`, `awaiting_review`, `consent_required`(18절). 되돌리기 `partial`, 보고서 `incomplete`, 점검 `warn`, `init` `declined`, 정리의 `nothing_removed`(확인했지만 지운 것이 없음, 18.8절) |
| 4 | `budget-exhausted`: `max_model_turns`, `max_tool_calls`, `max_total_tokens`, `max_duration`, `usage_unknown` |
| 5 | `cancelled` |
| 6 | `workspace_locked`: 같은 작업 공간에서 다른 실행이나 되돌리기가 진행 중. `run_in_progress`: `--run latest`가 고를 가장 새 실행이 아직 도는 중(이 절의 "`--run latest`") |
| 7 | `provider_not_configured`: 키·모델·출력 상한 미설정(자리표시자 모델 포함). 전송 없음. `provider_not_implemented`: 그 제공자가 이 판에 없음(계약 표, U-166) |
| 8 | `model_list_failed`: `models`의 API 요청 실패 |
| 70 | `internal_error` |

작업 공간의 `.codaryn/` 폴더:

- `runs/<runId>/journal.jsonl`: 한 줄에 사건 하나. `run_started`, `model_request`, `model_response`, `model_error`, `tool_decision`, `tool_result`, `file_changed`, `verifier_result`, `repair_started`, `integrity_checked`, `run_finished`. 가림본만 담는다.
- `runs/<runId>/result.json`: stdout과 같은 객체.
- `runs/<runId>/revert.json`: 마지막 되돌리기의 시각과 상태(11절).
- `runs/<runId>/snapshots/`: 실행이 파일 도구로 바꾼 파일의 변경 전 원문(11절). **가림본이 아니다.**
- `runs/<계획 실행 id>/plan.json`, `applied.json`: 제안된 계획(동작과 원본 해시)과 적용 표시(18.3절). 계획 실행의 폴더는 그 적용을 되돌리는 데 필요하다(18.8절).
- `runs/<runId>/review.json`: 사람 확인의 판정(18.6절).
- `discarded/<적용 실행 id>/`: 파일 정리에서 폐기한 **사람의 파일**(18.8절). 실행 기록이 아니다.
- `lock.json`: 실행 중 잠금. 기록된 프로세스가 이미 끝났으면 다음 실행이 회수한다.

도구는 `.codaryn/` 안을 읽거나 쓸 수 없다. 거부된 도구 호출은 `tool_result`의 `errorCode`(`policy_denied`, `protected_span_violation`, `conflict` 등)와 `tool_decision`의 `code`(`protected_path`, `command_not_allowed` 등)로 남는다.

### 변경 보기 (`changes`)

```powershell
node dist/src/cli/main.js changes --task <task.json> --run <runId|latest> [--json]
node dist/src/cli/main.js changes --workspace <작업 공간> --run <runId|latest> [--json]   # 간편 형식: 가릴 값은 설정 파일에서
node dist/src/cli/main.js changes --run latest                                            # 작업 공간 폴더 안에서(현재 폴더)
```

실행이 파일 도구로 바꾼 파일과 그 상태, 그리고 가린 글의 줄 단위 비교를 보여 준다. 읽기만 하고 잠금도 잡지 않는다. 3절 체험 실행의 실제 출력(stdout, main `3e36b1b`. 빈 줄을 나타내는 `+` 뒤의 공백 하나는 이 문서에서 뺐다):

```
changes of run 20261112T081531Z-dfd155bd, masked with the secrets registered now (not the run's own masking)
== summary.md: created by the run; as the run left it
@@ -1,0 +1,11 @@
+ # 회의 요약
+
+ ## 결정 사항
+
+ - 문서 사이트 개편은 다음 주에 시작한다.
+ - 체험 예시는 API 키 없이 실행되게 한다.
+
+ ## 할 일
+
+ - 문서 담당: 사용 안내 초안(금요일까지)
+ - 개발 담당: 오류 문구 목록 정리
```

- 글은 **지금 등록된 가릴 값으로 가린 것**이다. 쓰기 도구가 실행 때 가린 표기의 다이제스트를 기록해 두고, 지금 다시 가린 글이 그것과 같을 때만 글을 보인다. 가릴 값 자리는 토큰으로 보인다. 예: 가릴 값이 든 줄은 `+ - [[CODARYN_SECRET:f44831dde79cb2f6]] 개편은 다음 주에 시작한다.`처럼 나온다.
- 다음 경우에는 그 파일의 경로와 상태만 보이고(JSON의 `unavailable`은 `masking_unverified`), 머리에 그 사실을 한 줄로 알린다.
  - 실행 뒤에 파일이 바뀌었을 때(상태 `changed_since_run`). 예: 위 실행 뒤 `summary.md`에 한 줄을 더하면
    ```
    no text for some files: a file's text is shown only when the secrets registered now mask it as the run did and the file is as the run left it; the others have their path and state only (DR-29)
    == summary.md: created by the run; changed again since the run
       the text is not shown (masking_unverified)
    ```
  - 지금 등록된 가릴 값이 실행 때와 달라 가린 결과가 다를 때. 상태는 `as_run_left` 그대로다.
  - 이 기록이 없는 실행(쓰기 도구가 다이제스트를 남기기 전의 실행).
- `--json`이면 `kind:"changes"` JSON 한 줄이고, 파일마다 `before`·`after`(가린 글 또는 `null`)와 `unavailable`(글이 없는 이유 또는 `null`)이 있다.
- **간편 형식과 생략(U-17):** 키, 모델, 한도가 없어도 된다(18.1절 "간편 형식"). 이때 지금 등록된 가릴 값은 설정 파일(과 프로필)의 `secretEnv`로 정해진다. 실행이 task의 `privacy.secretEnv`로 등록한 값이 설정에 없으면 가린 결과가 실행 때와 달라서, 그 파일은 경로와 상태만 보인다(`masking_unverified`, 검토 R-54). 글을 보려면 실행에 쓴 task를 `--task`로 준다.
- 실행이 끝난 뒤에 기록 파일을 고치면 이 확인을 속일 수 있다(16절 "실행 기록 변조").

## 11. 되돌리기

```powershell
# 무엇을 되돌릴지 먼저 본다(아무것도 바꾸지 않음)
node dist/src/cli/main.js revert --workspace D:\work\notes --run latest --dry-run
node dist/src/cli/main.js revert --workspace D:\work\notes --run latest
node dist/src/cli/main.js revert --workspace D:\work\notes --run 20261112T031500Z-9f2c41ab --quiet
```

- `--workspace`와 `--run`(실행 id 또는 `latest`, 10절)이 필요하다. 선택 옵션은 `--dry-run`, `--quiet`, 그리고 하드 링크가 없는 드라이브에서 파일 정리를 되돌릴 때의 동의 `--allow-unsafe-move`(18.5절)다.
- 파일 정리의 적용 실행을 되돌리는 규칙은 18.4절에 있다. 이 절은 모델 실행(파일 도구의 변경)을 다룬다.
- **`--dry-run`:** 실제 되돌리기와 같은 판정을 하고 아무것도 바꾸지 않는다. 잠금을 잡지 않고 되돌리기 기록도 쓰지 않는다. 결과는 `"dryRun":true`가 붙고 상태·종료 코드는 실제와 같다. 미리보기 뒤에 파일이 바뀌면 실제 되돌리기는 그 파일을 건너뛴다.
- **대상:** 그 실행이 파일 도구(`write_file`)로 바꾼 파일. 현재 파일이 실행이 남긴 상태와 같을 때만 원래 바이트로 복원하고(`restored`), 실행이 새로 만든 파일은 지운다(`deleted`).
- **건너뛴 이유(`skipped[].reason`):** 한 파일의 실패는 나머지를 막지 않는다.
  - `already_reverted`: 파일이 이미 실행 전 상태다(이미 되돌렸거나, 실행이 만든 파일이 이미 없다). 할 일이 없으므로 `partial`로 세지 않는다.
  - `changed_since_run`: 실행 뒤 파일이 다시 바뀌었다.
  - `missing_snapshot`: 원문이 없다. 경로에 등록된 가릴 값이 든 파일도 여기에 해당한다.
  - `missing_record`: 원문은 있는데 기록에 변경이 없다(실행이 그 사이에 멈춤). 이 경로는 가리지 않은 경로이므로 사람용 요약에는 `?`로 나온다.
  - `io_error`: 그 파일을 읽거나 쓰지 못했다.
- **결과:** 할 일이 남은 파일이 없으면 `complete`(종료 0), 하나라도 건너뛰면 `partial`(종료 3). 같은 실행을 다시 되돌리면 `already_reverted`로 `complete`다(3절).
- **되돌리기 기록:** 실제 되돌리기는 끝난 뒤 `runs/<runId>/revert.json`에 시각과 상태를 쓴다. 다음 되돌리기의 결과에 `revertedBefore`로 붙고, `runs` 목록에 `reverted`로 나온다. 이 기록을 읽지 못하면 그 기록 없이 진행한다.
- **오류:** 그 runId의 기록이 없으면 `run_not_found`, 기록을 읽을 수 없으면 `invalid_run_record`, 실행 중이면 `workspace_locked`다. 이때는 아무것도 바꾸지 않는다.
- **되돌리지 않는 것:** 명령(`run_command`, 명령형 검증기)이 바꾼 파일. 그래서 작업 공간은 Git 커밋이나 사본으로도 보존한다.
- **스냅샷:** `<작업 공간>\.codaryn\runs\<runId>\snapshots\`에 변경 전 원문 그대로 남아 비밀이 들어 있을 수 있다. 파일 도구로는 닿지 않지만 허용한 명령은 읽을 수 있고, 자동으로 지우지 않는다.
- **실행 폴더 정리:** `codaryn cleanup`으로 미리 본 뒤 지운다(18.8절). 손으로 지우지 않는다. 지운 실행은 되돌릴 수 없다.
  - 되돌리지 않았거나 일부만 되돌린 실행, 기록을 확인할 수 없는 실행의 기록은 `--include-not-reverted`를 따로 줘야 지워진다.
  - **계획 실행**(`plan_pending`으로 끝난 실행)의 기록은 그 계획을 적용한 실행을 되돌리는 데 필요하다. `cleanup`은 그 적용을 함께 지울 때만 지운다.
  - **`.codaryn\discarded\`**: 실행 기록이 아니라 파일 정리에서 폐기한 사람의 파일이다. `cleanup`에 `--delete-discarded`를 따로 줘야 지워지고, 지우면 되찾을 수 없다.
  - **폐기 보관함에 파일이 남은 적용 실행**의 기록에만 그 파일들의 원래 이름과 자리가 있다. `cleanup`은 그 폐기 보관함을 같은 정리에서 함께 지우거나 그 적용을 되돌린 뒤에만 이 기록을 지운다(DR-53, 18.8절).

## 12. 가릴 값 등록과 가려지는 범위

- `privacy.secretEnv`(task)나 `secretEnv`(설정)에는 환경 변수 **이름**만 적는다. 값은 실행할 때 환경에서 읽는다(`--vars-file`로 읽은 값 포함). 값이 없으면 `secret_env_missing`이다.
- 다음 값은 자동으로 가릴 값으로 등록된다.
  - 실행이 쓰는 제공자의 키(길이와 관계없이)
  - 다른 제공자의 키 변수 값 중 20자 이상인 것. 예: openai 실행에서 `ANTHROPIC_API_KEY` 값이 작업 공간 파일에 있으면 모델에 가려져 간다. 20자 미만이면 등록하지 않는다(`x` 같은 자리표시자가 흔한 글자를 가리지 않게)
  - 변수 파일이 새로 설정한 값(4절)
- **가리는 범위:** 모델에 보내는 내용과 실행 기록 전체. 목표, 파일 내용, 경로, 명령 출력, 검증 근거, 오류 문구가 모두 해당한다.
- **가리는 형태:** 원문, Base64(패딩 유무, URL 문자 집합), URL 인코딩(대·소문자), JSON 이스케이프, 16진(대·소문자), 여러 줄로 된 가릴 값의 LF와 CRLF 표기. 가려진 자리는 토큰으로 보이고, 대응표는 실행 중 메모리에만 있다. 공백, 줄바꿈, 영폭 공백 같은 보이지 않는 문자로 끊긴 가릴 값도 가린다. 키 같은 값(4절 "키")이면 `.`이나 이체 선택자 같은 다른 문자로 끊긴 것도 가린다. 키 같지 않은 값이 그런 문자로 끊긴 것은 가리지 않는다(16절 "키 거부와 가림의 빈틈").
- 가릴 값이 든 줄을 모델이 고치거나 옮기는 변경은 전체가 거부된다(`protected_span_violation`). 다른 줄은 고칠 수 있다.
- 실행하는 명령의 환경에는 `PATH`, `PATHEXT`, `SYSTEMROOT`, `WINDIR`, `COMSPEC`, `TEMP`, `TMP`, `TMPDIR`, `HOME`, `USERPROFILE`, `LANG`만 넘어간다. 키는 넘어가지 않고, 값에 등록된 가릴 값이 든 변수도 넘기지 않는다. 그래서 변수 파일로 설정한 8자 이상의 값(예: 긴 `PATH`)은 명령에 전달되지 않는다.

**가림 개수가 알리는 것(DR-52, 사용자 결정 DR-54):** 끝 요약의 가림 줄과 결과의 `masking`(8절, 10절)은 개수만 담는다. 그래도 출력을 보는 사람에게 아래 사실을 알린다. DR-54는 이 성질을 받아들이고 문서에 적기로 했다(보안 검토 R-57의 낮음 L-1~L-3).

- **등록 값 전체와 같은 글이 모델에 갔는지(L-1):** 가린 곳의 수는 모델이 받은 글에 등록 값 전체, 또는 위 "가리는 형태"의 변형과 같은 글이 있었는지를 알린다. 값의 일부만 맞으면 개수는 바뀌지 않는다. 한 글자가 다르거나 앞이나 뒤가 빠진 글은 세지 않는다.
  - 그래서 모델이 읽을 파일에 글을 넣을 수 있고 실행의 출력(stdout JSON, 끝 요약, `report --json`)도 보는 사람은, 짧은 값(PIN, 짧은 암호)의 추측이 맞는지를 개수로 확인할 수 있다. 한 파일에 추측을 여럿 넣으면 맞은 수만큼 는다.
  - 키처럼 긴 무작위 값은 통째로 맞혀야 하므로 이 길로 알아낼 수 없다.
  - 같은 사실은 이미 실행 기록(journal)에도 있다. 도구 결과에서 값이 있던 자리에 토큰이 남는다.
  - **짧은 비밀을 가릴 값으로 쓰는 실행의 출력은 공개 로그(공개 CI 로그 등)에 남기지 않는다.** stdout JSON, stderr의 끝 요약, `report --json`의 출력이 해당한다. 작업 공간에 남이 넣은 파일이 있으면 더욱 그렇다.
- **표지 글이 든 파일도 가린 곳으로 센다(L-2):** 모델이 읽은 글에 `CODARYN_SECRET`(대소문자와 관계없이, 토큰 모양이 아닌 낱말 하나라도)이 있으면 그 자리도 가려지고 가린 곳으로 세어진다. 등록 값이 어디에도 없어도 그렇다. 그래서 가린 곳의 수는 "등록 값이 나온 횟수"가 아니다. 예를 들어 가릴 값을 등록한 실행이 Codaryn의 소스나 이 문서의 사본을 읽으면 0보다 크게 나온다. 개수가 늘 뿐 값이 새지는 않는다.
- **등록 개수에 드는 것(L-3):** 등록 개수는 서로 다른 값의 수다. 위 목록의 값이 모두 든다: `secretEnv`의 값, 실행 제공자의 키, 20자 이상인 다른 제공자의 키 변수 값, 변수 파일이 새로 정한 8자 이상 값.
  - 같은 값은 출처가 달라도 하나로 센다. 줄바꿈만 LF와 CRLF로 다른 값도 하나다.
  - 변수 파일 값의 앞뒤에 공백이 있으면 공백을 뺀 형태도 함께 등록되어 둘로 센다.
  - 그래서 출력을 보는 사람은 그 실행 환경에 설정에 없는 다른 제공자의 키 변수가 있는지, 설정한 두 값이 같은지를 알 수 있다. 값이나 길이는 알 수 없다.
- 실제로 잰 개수는 [민감정보 처리](privacy.md) 5절 "가림 개수"에 있다.

## 13. 권한 정책

```json
"policy": { "commands": [{ "executable": "node", "argsPrefix": ["--test"], "allowExtraArgs": false }],
            "network": "deny", "destructive": "deny", "restorePathTokens": false,
            "protectedPaths": ["tests"] }
```

- **`executable`:** 모델이 요청한 문자열과 정확히 같아야 허용된다. 실행 방식은 아래 "Windows 실행 규칙"이다.
- **`allowExtraArgs: false`(권장):** 인자가 `argsPrefix`와 정확히 같을 때만 허용한다. `true`면 접두가 같을 때 뒤의 인자를 무엇이든 허용하며, 그 인자 속 경로는 검사하지 않는다.
- **규칙 작성 요령:** 필요한 명령마다 규칙을 하나씩 만들고 인자까지 고정한다(예: `["--test"]`). `node -e`처럼 임의 코드를 실행하는 형태는 넣지 않는다.
- **`network`, `destructive`:** `"deny"`만 있다. 네트워크 도구가 없다는 뜻일 뿐이며, 허용한 명령의 네트워크 사용을 막지는 않는다. **`restorePathTokens`**(경로 인자 속 토큰을 원래 값으로 바꿔 쓸지)는 보통 `false`로 둔다.
- **파일 접근:** 경로는 `workspaceRoot` 안만 허용한다. 링크를 따라 밖으로 나가는 경로는 거부한다. **검증기 명령**은 사용자가 정한 것이므로 이 허용 목록과 따로 실행된다.
- **쓰기 크기(U-173, DR-72):** `write_file`은 디스크에서 16 MiB(16,777,216바이트, UTF-8과 BOM 포함)보다 큰 파일을 남기지 않는다.
  - 그런 쓰기는 `too_large`로 실패하고 아무것도 쓰지 않는다. 실행은 계속되고, 실패한 호출로 센다.
  - 실제 출력(main `07cd600`, 대본 모델이 16 MiB보다 1바이트 큰 글을 쓰려 함, stderr의 앞부분):

    ```
    codaryn: turn 1
    codaryn: write file — allowed (write_file)
    codaryn: write file — failed (too_large)
    codaryn: turn 2
    codaryn: finished — needs input (no_verifier)
    ── Result: needs input — no check is configured (needs-input/no_verifier) ──
    Checks: none configured
    Files changed: 0
    Failed calls: 1
    ```

  - 한국어 진행 줄은 `파일 쓰기 — 실패 (too_large)`, 끝 요약은 `실패한 호출: 1건`이다. 그 파일은 만들어지지 않았다.
  - 읽기 상한(256 KiB)과는 따로다. 그래서 256 KiB보다 크게 쓴 파일은 `read_file`·`write_file`이 다시 읽지 못한다([계약](cli-contract.md) DR-72).
- 허용 목록에 없는 명령은 `command_not_allowed`로 거부되고 실행은 계속된다(3절 체험의 2번째 턴). 끝 요약이 거부 수와 고칠 곳(task 파일이면 task의 `policy.commands`, 간편 형식·한 줄 실행이면 설정 파일이나 프로필)을 알린다. `doctor`의 허용 명령 항목으로 허용한 명령을 실행 때와 같은 규칙으로 찾을 수 있는지 미리 본다(7절).

**묻고 실행하는 규칙(`confirm`):** 설정 파일이나 프로필의 명령 규칙에 `"confirm": true`를 두면, 그 규칙이 허용하는 명령은 실행 중에 사람에게 묻는다. 허락받으면 그 호출 한 번만 실행한다(U-74, U-109, U-110, U-137).

```json
"policy": { "commands": [{ "executable": "node", "argsPrefix": ["ask.mjs"], "allowExtraArgs": false, "confirm": true }],
            "network": "deny", "destructive": "deny", "restorePathTokens": false }
```

- **받는 곳:** 설정 파일의 `policy.commands[i]`와 프로필의 `profiles.<이름>.policy.commands[i]`뿐이다. 그래서 간편 형식과 한 줄 실행에서만 쓰인다.
  - task 파일에 두면 `invalid_task`(종료 2)이고 메시지는 `policy.commands[0] has an unknown field; allowed fields: executable, argsPrefix, allowExtraArgs`다.
  - 작업 종류 정의(`workflows.<id>.policy`)에 두면 설정 파일 오류다. `doctor`의 설정 파일 항목이 `workflows[0].policy.commands[0] has an unknown field; allowed fields: executable, argsPrefix, allowExtraArgs`로 실패한다.
  - 값은 `true`뿐이다. `false`면 `invalid_config`(종료 2)이고 메시지는 `policy.commands[0].confirm must be true when it is given`이다.
  - `doctor`는 이런 설정을 유효하게 읽는다(`config file` 항목 `ok`). 묻는 규칙이 있다고 따로 알리지는 않는다.
- **묻는 호출:** `confirm` 규칙만 그 호출을 허용할 때 묻는다. 같은 호출을 `confirm` 없는 규칙도 허용하면 묻지 않고 실행한다. 허용 목록 밖이거나 다른 이유(작업 공간 밖 등)로 거부되는 호출은 묻지 않고 거부한다. 묻는 것은 명령뿐이다.
- **터미널에서만 묻는다:** `run`의 표준 입력과 stderr가 모두 터미널이고 `--quiet`가 아닐 때만 묻는다. stdout은 상관없다(파이프면 JSON 한 줄도 나온다). 질문은 stderr에 한 줄이다. 실제 출력(stderr의 앞부분, 줄 끝의 `y`는 친 답):

  ```
  codaryn: run started — provider anthropic
  codaryn: turn 1
  Allow a command for this one call? With no answer it is denied. Only its executable and its number of arguments (1) are shown, not the arguments themselves. Executable: node [y/N] y
  codaryn: permission question — allowed by the person, for this call only
  codaryn: run command — allowed (run_command)
  codaryn: turn 2
  ```

  - 보이는 것은 실행 파일(가린 뒤)과 인자 개수뿐이다. 인자는 보이지 않는다.
  - 한국어 질문은 `명령 하나를 이번 호출에만 허용할까요? 답하지 않으면 거부합니다. 보이는 것은 실행 파일 이름과 인자 개수(1개)뿐이며, 인자 자체는 보이지 않습니다. 실행 파일: node [y/N] (y·예·네: 예, Enter: 아니오)`다.
- **답:** 한 줄로 답한다.
  - `y`, `yes`, `예`, `네`(앞뒤 공백과 대소문자는 무시)면 그 호출 한 번만 허용한다. 다음 호출은 다시 판정한다.
  - 그 밖의 줄(Enter 포함)은 그 사람의 거부다. 명령은 돌지 않고, 거부가 모델에 돌아가며 실행은 계속된다. 끝 요약은 다음과 같고, 이 호출에는 "규칙을 더하라"는 안내를 내지 않는다.

    ```
    Denied calls: 1
    Denied by the person: 1 call(s) whose rule asks first.
    ```

    한국어로는 `거부된 호출: 1건`, `확인을 받게 된 명령의 호출 1건을 사람이 거부했습니다.`다.
  - 답 없이 입력이 끝나면(Ctrl+D 등) 기본 거부다. 끝 요약은 `Denied with no answer: 1 call(s) whose rule asks first (the input ended or time ran out).`다.
  - 질문을 기다리는 시간도 실행 시간 한도(`maxDurationMs`)에 든다. 한도에 닿으면 답 없이 거부되고 실행은 끝난다(코드 기준).
- **질문 중의 Ctrl+C:** 그 호출만이 아니라 실행 전체를 취소한다(`cancelled`, 종료 5). 모델은 다시 부르지 않는다. 실제 출력(stderr):

  ```
  codaryn: permission question — denied: the run was cancelled while it waited
  codaryn: run command — denied (command/confirmation_required)
  codaryn: finished — cancelled (cancelled)
  ── Result: cancelled — cancellation was requested (cancelled/cancelled) ──
  Checks: none configured
  Files changed: 0
  Denied calls: 1
  Denied because the run was cancelled while it waited: 1 call(s) whose rule asks first.
  ```

- **물을 수 없으면 기본 거부:** 터미널이 아니거나(파이프, 파일, 예약 작업) `--quiet`면 묻지 않고 거부한다. 실제 출력(표준 입력·stdout·stderr가 모두 파이프인 실행의 stderr):

  ```
  codaryn: turn 1
  codaryn: permission question — denied by default (no answer, could not ask, or time ran out)
  codaryn: run command — denied (command/confirmation_required)
  codaryn: turn 2
  codaryn: finished — needs input (no_verifier)
  ── Result: needs input — no check is configured (needs-input/no_verifier) ──
  Checks: none configured
  Files changed: 0
  Denied calls: 1
  Denied without asking: 1 call(s) whose rule asks first (not at a terminal, or --quiet).
  ```

  - 한국어 끝 요약은 `확인을 받게 된 명령의 호출 1건을 묻지 않고 거부했습니다(터미널이 아니거나 --quiet 옵션을 줌).`다.
  - `--quiet`면 사람용 줄 없이 JSON 한 줄만 나오고, 기록은 같다.
- **기록:** 질문마다 실행 기록(`journal.jsonl`)에 세 줄이 이 차례로 남는다. 아래는 사람이 거부한 실행의 실제 기록이다(각 줄의 `seq`, `at`, `runId`는 뺐다).

  ```
  {"type":"confirmation_requested","kind":"permission","id":"q1","callId":"toolu_a1","tool":"run_command","permission":"command","subject":"node","argumentCount":1}
  {"type":"confirmation_answered","id":"q1","decision":"deny","by":"user"}
  {"type":"tool_decision","callId":"toolu_a1","tool":"run_command","stage":"policy_effective","allowed":false,"permission":"command","code":"confirmation_required"}
  ```

  - 답(`decision`, `by`): 허락은 `allow_once`/`user`, 그 사람의 거부는 `deny`/`user`, 답 없음과 물을 수 없음은 `deny`/`default`, 기다리는 동안의 취소는 `deny`/`cancelled`다. 인자는 기록하지 않는다.
  - 그 뒤: 허락이면 `tool_decision`이 허용이고 명령의 `tool_result`가 이어진다. 거부면 거부 `tool_result`(`policy_denied`)가 모델에 돌아간다. 기다리는 동안 실행이 취소되거나 시간이 다 되면 거부 `tool_decision` 뒤 `tool_result` 없이 실행이 끝난다(U-137). 그래서 이런 호출도 `Denied calls`에 든다.
- **확인 범위:** 위 출력은 main `cd1cace`의 실제 CLI를 루프백의 가짜 Anthropic 서버(네트워크 막이 켬)와 흉내 낸 터미널로 돌린 것이다. 흉내는 표준 입력·stdout·stderr의 `isTTY`만 참으로 두고, 답은 파이프로 넣었다.
  - 이 흉내에서 `y`, `yes`, `예`, `네`, `  Y `는 허락으로, `no`와 Enter는 그 사람의 거부로, Ctrl+D는 답 없음으로, Ctrl+C는 취소로 기록됐다.
  - 프로필(`--profile`)에 둔 규칙도 같이 물었다.
  - 실제 Windows 콘솔과 Unix 터미널에서는 확인하지 않았다(16절).
- **GUI에서 시작한 실행:** 같은 규칙으로 묻는다. 터미널 대신 GUI의 메인 프로세스가 OS 대화상자로 묻고, 기본 단추와 Esc는 거부다(U-124, 병합 `aa723d2`. 화면은 [독립 GUI 설계](design/standalone-gui.md) 3.6). 이 문서는 CLI를 다루므로 그 화면의 글은 옮기지 않았다.

**보호 경로(`protectedPaths`):** 작업 공간 기준 상대 경로 목록이다. 그 아래에 대한 파일 도구의 쓰기를 거부한다(`tool_decision.code`가 `protected_path`). 읽기와 검색은 된다.

- **권고:** 테스트와 검증 설정을 보호한다. 테스트 폴더, 테스트 파일, 검증기가 읽는 설정 파일(예: `npm test`를 쓴다면 `package.json`)이 대상이다. 모델이 테스트를 고쳐 검증을 통과시키는 길을 막는다. 문서 작업에서는 원본 자료를 보호한다(3절 체험의 `notes.md`).
- 경로 조각 단위로 비교한다. `tests`는 `tests/a.ts`를 덮고 `tests2`는 덮지 않는다. `.`은 작업 공간 전체다. Windows에서는 대소문자를 무시한다.
- 링크를 푼 경로로 비교한다. 항목이 작업 공간 밖을 가리키는 링크(끊긴 링크 포함)이면 모든 쓰기를 거부한다.
- task 파일이나 설정 파일(간편 형식)만 정할 수 있고 모델은 풀 수 없다. 절대 경로, `..`, 빈 값, Windows 파일 이름이 될 수 없는 값은 task에서 `invalid_task`, 설정에서 `invalid_config`다.
- **무결성 확인:** 보호 경로(또는 설정의 `integrity.paths`)가 있으면 실행 시작, 검증 회차마다 검증 전과 후에 그 내용을 시작 때와 비교한다(진행 줄 `protected material check`, 기록 `integrity_checked`). 바뀌었으면 검증 결과와 관계없이 `needs-input`/`protected_changed`(종료 3)로 끝나고, 결과의 `protectedChanged`에 경로가 남는다.
- **한계:** 쓰기를 막는 것은 파일 도구뿐이다. 허용한 명령과 명령형 검증기는 보호 경로의 파일도 바꿀 수 있고, 무결성 확인은 그것을 사후에 알아챌 뿐 막지 않는다. 명령 허용 목록을 좁게 두고, `file_rules` 검증기(예: `code-task.json`의 `test-kept`)와 결과의 `changes`로 함께 확인한다.

**Windows 실행 규칙:** 도구 명령과 검증기 명령에 똑같이 적용한다.

- 이름은 자식에게 넘기는 `PATH`와 `PATHEXT`로 찾는다. 작업 디렉터리와 상대 `PATH` 항목은 찾지 않는다. `.exe`, `.com`, `.cmd`, `.bat`만 실행한다.
- **작업 공간 안으로 풀리는 실행 파일과 스크립트는 실행하지 않는다**(`spawn_failed`, 사유 `executable_refused`·`script_refused`). 경로로 부르든 `PATH`로 찾든 같다.
- `.exe`·`.com`은 셸 없이 실행한다. `.cmd`·`.bat`은 `cmd.exe /d /s /c`로 실행하되 다음을 모두 만족할 때만 실행하고, 아니면 `script_refused`다.
  - 모든 인자가 영문, 숫자, `_ - . : / \ = + @ ~ #`만으로 이루어져 있다. 공백, 따옴표, `& | < > ^ % ! ( )`, 쉼표, 세미콜론, `*`, `?`, 한글 등 ASCII 밖 문자, 빈 인자는 안 된다.
  - 스크립트의 실경로가 `C:\...` 형태이고 영문, 숫자, 공백, `_ - . \ = + @ ~ #`만 쓴다.
- 정책 판정은 모델이 요청한 이름(예: `npm`)으로 한다. 이 규칙은 가짜 `.cmd`로 검증했고, 실제 `npm` 실행은 점검하지 않았다.

## 14. 실제 호출 점검

> **실행한 적 없음.** 아래 두 점검은 이 저장소에서 아직 한 번도 실제 API로 실행되지 않았다. 작업자는 키 없이 "변수가 없으면 건너뛴다"만 확인했다(U-101: 5건 모두 건너뜀, 실패 0). 결과를 믿기 전에 사용자가 직접 한 번 돌려 본다.

자세한 내용은 [tests/live/README.md](../tests/live/README.md)를 본다. 키는 미리 사용자 환경 변수에 등록해 둔다(이 점검은 변수 파일을 쓰지 않는다). 기본 npm 명령(`test`, `test:unit`, `test:integration`)에는 들어가지 않는다.

```powershell
npm run build
$env:CODARYN_LIVE = "1"
# Anthropic: ANTHROPIC_API_KEY는 미리 설정해 둔다
$env:CODARYN_MODEL = "<모델 ID>"
node --test dist/tests/live/anthropic-live.js
# OpenAI: OPENAI_API_KEY는 미리 설정해 둔다. 점검 3을 보려면 추론 모델
$env:CODARYN_OPENAI_MODEL = "<모델 ID>"
node --test dist/tests/live/openai-live.js
```

- 모델 ID는 `models`(4절)로 확인한다.
- 각 파일은 그 제공자의 세 변수(`CODARYN_LIVE=1`, 키, 모델 변수) 가운데 하나라도 없으면 아무것도 보내지 않고 모든 시험을 "건너뜀"으로 끝낸다. 두 파일을 한 번에 줄 수도 있다(변수가 있는 쪽만 돈다).
- **Anthropic(`anthropic-live.ts`), 작업 둘**
  - 문서 작업: 임시 폴더의 `README.md`에 절 하나를 더하고 `done`인지, 원래 글이 그대로인지 본다.
  - 코드 작업(U-101): `math.mjs`의 틀린 `add`를 고치고, 보호 경로인 `check.mjs`를 도는 `command` 검증기가 `pass`이고 `check.mjs`가 그대로인지 본다.
  - 상한(작업마다): 턴 4, 도구 호출 4, 출력 1024토큰/요청, 총 30000토큰, 3분. HTTP 요청은 작업마다 최대 8건, 둘이면 16건.
- **OpenAI(`openai-live.ts`), 점검 셋**(U-101)
  1. `models --provider openai --json`이 그 모델을 포함한 목록을 주는지.
  2. 도구 한 바퀴(문서 작업과 같은 일)가 `done`인지.
  3. 점검 2의 기록으로, 추론 항목을 다시 보낸 뒤의 요청이 받아들여졌는지([사실 C-11](design/second-provider-facts.md)). 모델이 추론 항목을 돌려주지 않으면 이 점검은 "건너뜀"이다.
  - 상한: 턴 4, 도구 호출 4, 출력 4096토큰/요청, 총 40000토큰, 3분, HTTP 요청 최대 10건.
- 두 파일 모두 stdout·stderr·기록에 키 원문과 정해진 변형이 없는지 본다(값은 출력하지 않고 변형 이름만 보고한다).

## 15. 투입 전 점검표

- [ ] 3절 체험을 해 보고 진행 줄, 끝 요약, `runs`, `report`, `revert --dry-run`, `revert`를 읽을 수 있다.
- [ ] 14절 실제 호출 점검을 **먼저** 실행했고 `done`이다.
- [ ] 처음 몇 번은 중요하지 않은 저장소(사본, 연습용)에서 실행한다.
- [ ] `npm run build`가 성공하고 Node 26 이상이다.
- [ ] 키가 사용자 환경 변수나 변수 파일(BOM 없음, `--vars-file`)에만 있고, 변수·설정·task 파일이 작업 공간 밖에 있다.
- [ ] 설정 파일의 모델이 자리표시자가 아닌 실제 ID다(`models --use`).
- [ ] 같은 옵션으로 `doctor`를 실행해 `failed`가 없다.
- [ ] 작업 공간이 Git으로 커밋되어 있거나 사본이다. `revert`는 파일 도구의 변경만 되돌린다.
- [ ] `protectedPaths`로 테스트와 검증 설정을 보호했다.
- [ ] 명령 허용 목록이 필요한 명령만 담고 `allowExtraArgs`가 `false`다.
- [ ] 작업 공간 안의 비밀을 가릴 값(`secretEnv`)으로 등록했다.
- [ ] 짧은 비밀(PIN, 짧은 암호)을 가릴 값으로 쓰는 실행이면, 그 출력(stdout JSON, 끝 요약, `report --json`)을 공개 로그에 남기지 않는다(12절 "가림 개수가 알리는 것").
- [ ] 검증기가 성공 조건을 실제로 확인한다(테스트 명령, 파일 규칙).
- [ ] 재수정은 모델이 쓴 코드를 실행해도 되는 작업 공간에서만 켰다.
- [ ] 한도를 낮게 시작했다. 실행 뒤 `report`로 결과와 `changes`를 확인한다.
- [ ] 실행 기록은 `codaryn cleanup`으로 미리 본 뒤 지운다. `--include-not-reverted`와 `--delete-discarded`는 잃는 것을 읽고 따로 준다(11절, 18.8절).
- [ ] 개인정보가 든 표나 문서는 작업 공간에 두지 않는다(18.7절).

## 16. 알려진 한계

알려진 한계를 이 절에 모은다. 범용 작업(18절)의 한계도 여기에 있다.

- **검증기와 재수정:** 재수정을 켜면 명령형 검증기가 모델이 쓴 코드를 실행하고 그 출력(가린 뒤)이 모델에 돌아간다. 명령 허용 목록이 비어 있어도 마찬가지다.
- **OS 격리 없음:** 허용한 명령과 검증기 명령은 사용자 권한으로 실행된다. 작업 공간 밖 파일 접근과 네트워크 사용을 OS 수준에서 막지 않는다.
- **가릴 값이 든 줄:** 수정, 이동, 삭제할 수 없다. 사람이 직접 고친다. 그 줄 앞뒤의 다른 줄을 바꿔 여러 줄에 걸친 식의 의미가 달라지는 것은 막지 못한다.
- **남는 자손 프로세스:** 명령이 끝난 뒤에도 분리되어 떠 있는 자손 프로세스(예: 백그라운드로 띄운 서버)는 남을 수 있다.
- **실행 중 권한 질문(13절 `confirm`):** 터미널을 흉내 내어서만 확인했다. 실제 Windows 콘솔과 Unix 터미널의 키 입력(Ctrl+C, Ctrl+D, Windows의 Ctrl+Z)은 그대로 재현되지 않았다. 묻는 것은 명령뿐이다.
- **스냅샷:** 원문이라 비밀이 있을 수 있고, 실행된 명령이 읽을 수 있다. 보관 기간 관리가 없으므로 `cleanup`으로 미리 본 뒤 지운다(18.8절). 손으로 지우면 계획 실행을 잃어 그 적용을 되돌릴 수 없게 될 수 있다.
- **개인정보:** 표와 문서의 내용은 그대로 모델에 간다. 등록한 가릴 값 말고는 가리지 않고, 원자료 대신 집계만 보내는 도구가 아직 없다(18.7절).
- **하드 링크가 없는 드라이브:** FAT32·exFAT처럼 하드 링크가 없는 드라이브에서는 파일 정리의 이동과 그 되돌리기를 기본으로 하지 않는다. 사람이 그 적용·되돌리기 한 번마다 `--allow-unsafe-move`로 동의해야 하고, 동의하면 "대상에 생긴 파일을 덮어쓰지 않는다"는 보장이 없다(18.5절). 이 경로는 하드 링크 만들기가 실패하도록 흉내 낸 환경에서만 확인했고, 실제 FAT32·exFAT 드라이브에서는 확인하지 않았다.
- **키 거부와 가림의 빈틈(사용자 결정 DR-45):** 키가 든 입력의 거부(4절 "키")와 실행 중 가림(12절)에 남은 것이다. main `6df2eae`의 실제 CLI(대본 모델)로 확인했다.
  - **키 같지 않은 등록 값이 드문 문자로 끊긴 경우:** 짧거나 한 가지 대소문자만 쓴 값(예: `summer2026winter`)이 `.`이나 이체 선택자(U+FE0F)로 끊기면 거부도 가림도 되지 않는다. 공백, 줄바꿈, 영폭 공백으로 끊긴 것은 거부하고 가린다. 키 같은 값은 어떤 문자로 끊겨도 거부하고 가린다. 모든 등록 값에 같은 비교를 하면 평범한 글의 오탐이 늘어서, 이것은 알려진 한계로 둔다(DR-45).
    - 확인: 작업 공간 파일의 `summer20.26winter`와 `summer20` + U+FE0F + `26winter`는 모델에 그대로 갔고, 같은 값의 원문, 공백·줄바꿈·영폭 공백으로 끊긴 형태는 토큰이 됐다. 대문자·소문자·숫자가 섞인 20자 값은 다섯 가지 끊김 모두 토큰이 됐다.
    - 피하는 법: 가릴 값이 짧거나 한 가지 대소문자뿐이면, 그 값이 이상한 문자로 끊겨 들어 있을 수 있는 파일은 작업 공간에 두지 않는다.
  - **찾지 못하는 끊김:** 등록되지 않은 키가 보이는 공백으로 끊긴 경우(`sk-proj-` 키를 공백으로 가른 목표가 통과했다, main `23daf6b`), 등록된 키가 `&#8203;` 같은 문자 참조로 끊긴 경우.
  - 키 변수에 낱말을 이은 자리표시자(예: `not-needed-for-local-server`)를 두어도 같은 낱말을 띄어 쓴 평범한 목표는 이제 멈추지 않는다(키 같은 값만 영문자·숫자로 비교한다).
- **정책에서 빠진 것의 알림이 한 줄에 길게 이어진다(DR-43 (b), 검토 R-37 낮음):** 작업 종류의 규칙이 설정·task의 정책과 검증기에서 뺀 것은 실행 시작 줄 하나에 ` · `로 이어 붙는다(18.1절 "정책 합치기"의 예). 둘만 빠져도 영어 줄이 229자라 좁은 터미널에서는 여러 줄로 접혀 묻히기 쉽다. 끝 요약과 `report`에는 나오지 않는다. 실행 전에 `doctor`를 같은 옵션으로 돌려 보면 한 항목씩 나뉘어 나온다(7절). `run --workflow <id>`는 `doctor`에 같은 옵션이 없어 미리 볼 수 없다. 프로필이나 task 파일로 고르면 볼 수 있다.
- **OpenAI 제공자:** 실제 OpenAI API로는 점검하지 않았다. 추론 항목은 암호문이라 가림이 볼 수 없고, 다음 요청에 받은 그대로 다시 간다([민감정보 처리](privacy.md) "OpenAI 제공자").
- **변경 보기의 글:** `changes`는 지금 등록된 가릴 값으로 가린 글이 실행 때와 같을 때만 글을 보인다. 실행 뒤 바뀐 파일, 가릴 값이 바뀐 경우, 쓰기 도구가 기록을 남기기 전의 실행은 경로와 상태만 보인다(10절 "변경 보기").
- **폐기 보관함:** 폐기한 파일은 `.codaryn\discarded\`에 쌓인다. `cleanup --discarded-older-than <일> --confirm … --delete-discarded`로만 지운다(18.8절).
- **계획의 가린 표기:** 계획 보기는 가릴 값이 든 경로를 실행마다 다른 토큰(`[[CODARYN_SECRET:…]]`)으로 보인다. 그래서 가릴 값이 둘 이상 등록되어 있으면 어느 값을 이름으로 한 폴더로 가는지 보기만으로 구별할 수 없다. 계획 실행의 끝 요약에 나온 다이제스트로 승인한다(18.3절).
- **계획 뒤에 등록한 가릴 값:** 계획 경로에 든 값을 계획 실행 뒤에 가릴 값으로 새로 등록하면, 그 계획은 `plan_secrets_differ`로 보거나 적용할 수 없다. 계획을 새로 만든다(18.3절).
- **파일 정리의 명령 금지:** `organize`의 명령 금지는 모델이 부를 수 있는 명령에 대한 것이다. task나 설정에 사람이 둔 `command` 검증기는 적용 뒤에 실행되고, 그 검증기가 바꾼 파일은 파일 목록 확인(`inventory`)이 보지 못한다(18.1절).
- **자료 검증(`data_checks`):** 판단 불가(`inconclusive`)가 되는 경우가 둘 있다. 검증 결과의 한계 목록에도 같은 내용이 나온다.
  - 열이나, 묶은 규칙의 묶음 하나라도 값이 모두 비어 있으면 sum·min·max·mean 규칙
  - 더해 가는 합이 double 범위를 넘으면 sum·mean 규칙. 넘는지는 행 순서에 달렸다. 같은 값 `1e308, -1e308, 1e308`은 검사되고 `1e308, 1e308, -1e308`은 판단 불가다.
- **큰 작업 공간의 파일 목록:** 작업 공간의 파일 목록(상한 10만 개)을 `plan`은 한 번, `apply --digest`는 두 번(동작 앞뒤) 만든다. 터미널 질문으로 승인하면 계획을 보이기 전에 한 번 더 만든다(코드 기준, 터미널 대화는 확인하지 않았다). 파일이 아주 많으면 시간이 걸린다. 목록을 만드는 중의 취소는 목록이 끝나기를 기다리지 않는다. 파일 5만 개(목록 하나에 약 0.5초)에서 첫 목록 중에 취소 파일을 만들자 약 0.1초 뒤 `cancelled`로 끝났고 아무것도 옮기지 않았다(main `3e36b1b`).
- **보호 경로:** 파일 도구만 막는다. 명령으로 고치는 것은 막지 못하고, 무결성 확인은 사후 탐지다. 두 확인 사이에 바뀌었다가 다음 확인 전에 되돌려진 변경은 탐지하지 못한다.
- **되돌리기:** 명령이 바꾼 파일은 대상이 아니다. 실행 중 다른 프로그램이 같은 파일을 바꾸면 스냅샷이 실제 실행 전 상태와 다를 수 있다.
- **같은 실패 판정:** 숫자만 바뀌는 진전(실패 3건 → 1건)도 같은 실패로 보아 `maxSameFailures`에서 멈춘다. 임시 경로처럼 숫자가 아닌 내용이 매번 바뀌면 다른 실패로 보아 `maxRepairAttempts`와 예산 한도만 반복을 멈춘다.
- **가림의 빈틈:** 12절 목록 밖의 변형, 다른 값과 함께 인코딩된 Base64, UTF-16·CP949 출력은 가려지지 않는다. 출력 끝에서 4096바이트보다 긴 변형이 잘리면 일부가 남을 수 있다. 아주 짧은 가릴 값이나 변수 파일의 흔한 값(예: `postgres`)은 엉뚱한 곳까지 가릴 수 있다.
- **파일 해시 노출:** 파일 해시가 모델과 기록에 남는다. 짧은 비밀이 든 파일은 추측 검증이 가능하다.
- **가림 개수(사용자 결정 DR-54):** 끝 요약의 가림 줄과 결과의 `masking`은 개수만 담지만 세 가지를 알린다(12절 "가림 개수가 알리는 것").
  - 작업 공간에 글을 넣을 수 있고 출력도 보는 사람은 짧은 가릴 값의 추측이 맞는지 확인할 수 있다. 짧은 비밀을 쓰는 실행의 출력은 공개 로그에 남기지 않는다.
  - 표지 글 `CODARYN_SECRET`이 든 파일도 가린 곳으로 센다.
  - 등록 개수로 다른 제공자의 키 변수가 있는지, 설정한 두 값이 같은지를 알 수 있다.
- **쓰기 경합:** 해시 비교와 파일 교체 사이에 다른 프로그램이 쓰면 그 변경을 덮어쓸 수 있다.
- **점검:** `doctor`는 모델이 실제로 있는지 확인하지 않는다.
- **도움말과 사용법의 빠진 곳(UXM-20):** main `0ad28bc`에서 처음 확인했고, U-53 뒤의 main `76c5280`에서 실제 CLI로 다시 쟀다.
  - **고쳐진 것(U-53):**
    - `help run`·`plan`·`apply`·`review`의 옵션 목록에 `--workflow <id>`가 있다(18.1절).
    - `run`·`revert`·`apply`의 `--json` 옵션 글은 `--json: print the result's JSON line at a terminal too (stdout and stderr both); through a pipe or a file, or with stderr redirected, it is printed without it`이다. `apply`에도 이제 옵션 목록이 있다.
    - `codaryn --help`의 출력 설명은 지금 동작과 맞다: `At a terminal (stdout and stderr both), the result of run, revert and apply, and any command's error, show only as human lines on stderr (progress, summary, explained error).` 다음 문장이 stderr를 파일로 돌린 경우(`such as 2> log.txt`)도 든다.
    - `plan`·`changes`의 옵션 목록이 생략을 알린다: `--workspace <dir>: the workspace directory; when it is left out (and no --task is given), the current directory`.
  - **그대로인 것:**
    - `run`·`revert`·`apply`의 사용법 줄에는 `[--json]`이 없다. 오류 JSON의 사용법 묶음이 바뀌므로 넣지 않기로 했다(DR-59).
    - `plan`·`changes`의 사용법 줄은 아직 `(--task <task.json> | --workspace <dir> …)` 꼴이다.
  - 다음 경우 오류 JSON의 `message`는 여러 명령의 사용법을 이어 붙인 묶음이다(검토 R-61의 R61-L1, R61-I1). main `76c5280`에서도 그대로다.
    - 모르는 명령일 때
    - 명령 없이 쳤는데 stdout이 터미널이 아닐 때. 터미널에서는 도움말이 나온다(10절 "터미널에서").
    - `run`과 `revert`의 옵션 오류일 때
    - 그 묶음은 `codaryn plan|apply|review ... | codaryn --help | codaryn --version`으로 끝나고 `changes`와 `cleanup`이 없다. 두 명령의 사용법은 `codaryn help changes`, `codaryn help cleanup`으로 본다. 다른 명령의 옵션 오류는 그 명령의 사용법만 보인다.
    - 콘솔에서는 오류 JSON 줄이 나오지 않으므로, 이 묶음을 보려면 `--json`을 준다(10절 "터미널에서").
  - 한국어 `doctor` 표는 열이 맞지 않는다(`[정상]      설치 위치       …`, `[건너뜀]     보호 대상 경로    …`, main `76c5280`). 영어 표는 맞는다.
- **실행 기록 변조(결정 DR-38, DR-37 (b)):** `report`, `changes`, `revert`는 `.codaryn\`의 실행 기록을 믿는다. 이 폴더는 모델의 파일 도구로는 쓸 수 없지만, 허용한 명령이나 같은 사용자의 다른 프로그램은 쓸 수 있다.
  - **실행 중의 변경은 알아챈다.** 실행의 시작과 끝, 그리고 명령을 돌린 뒤마다 `.codaryn\`을 살피고, 그 실행이 쓴 것 말고 바뀐 것이 있는지 본다. 다른 것이 바뀌었으면 실행을 `failed`/`state_changed`(종료 1)로 끝내고 그 실행에 "기록이 바뀜" 표시를 남긴다. 확인(main `6df2eae`, 허용한 `node` 명령이 고침): 그 실행 자신의 기록, 이미 끝난 다른 실행의 `result.json`, `.codaryn\`에 새 파일 하나 모두 이렇게 끝났다. 끝 요약은 `the state directory was changed by something other than the run, or could not be checked (failed/state_changed)`와 "허용한 명령과 검사를 살펴보라"는 안내를 낸다.
  - 표시가 붙는 것은 그때 돌던 실행이다. 기록이 고쳐진 다른 실행에는 표시가 없다.
  - 표시가 있는 실행: `report`가 `This run has a records-changed mark: … this report may not match what happened.`를 낸다. `changes`는 파일 글을 보이지 않는다(이유는 `masking_unverified`로만 나오고 표시는 따로 말하지 않는다). `revert`는 막지 않고 파일마다 스냅숏과 다이제스트를 확인하며 JSON에 `recordsChanged: true`를 싣는다. 사람용 글에는 파일 목록 뒤에 `This run has a records-changed mark. The revert still checks every file against its snapshot and digest.`(한국어 `이 실행에는 기록 변경 표시가 있습니다. 되돌리기는 그래도 파일마다 스냅샷과 다이제스트를 확인합니다.`)가 나온다(U-139). `runs`는 결과 칸 끝에 짧은 표시를 붙이고, 그 뜻은 표 아래에 한 줄로 한 번 말한다(U-157). `--json`에는 `recordsChanged: true`가 있다. `runs`의 실제 출력(U-157, 파일 하나를 만든 뒤 허용한 `node -e` 명령이 `.codaryn\`에 파일 하나를 쓴 실행):

    ```
    run id (UTC)               started (local)      changes  result
    20261113T051057Z-c61169fd  2026-11-13 14:10:57  1        failed (failed/state_changed) · records changed
    records changed: something other than the run changed that run's records
    ```

    한국어로는 `실패 (failed/state_changed) · 기록 변경됨`이고, 표 아래 줄은 `기록 변경됨: 실행이 아닌 것이 그 실행의 기록을 바꿨습니다`이다. 표시가 붙은 줄은 영어로 104칸, 한국어로 95칸(한글은 두 칸으로 셈)이다. 설명을 표 아래로 옮겨 영어 121칸, 한국어 118칸에서 줄었다. 영어는 상태 글이 길어 아직 100칸을 넘는다(`done (done/verified)` 줄은 95칸).
  - 표시가 있는 계획 실행은 `apply`가 거부한다(`plan_records_changed`, 18.3절).
  - 실행 자신의 `journal.jsonl`에 엉뚱한 줄이 들어가면 `report`와 `changes`가 그 실행을 `invalid_run_record`로 읽지 않는다.
  - **실행이 끝난 뒤의 변경은 알아채지 못한다.** 실행이 남긴 자식 프로세스나 다른 프로그램이 끝난 실행의 기록을 고치면 표시가 붙지 않는다. 확인: 끝난 실행의 스냅숏 파일을 고치자 `runs`는 그대로였다. `revert`는 그 파일을 `snapshot missing (missing_snapshot)`으로 건너뛰고 아무것도 쓰지 않았다(다이제스트가 맞지 않아서).
  - 실행이 끝난 뒤 변경 기록 파일의 다이제스트를 지금 값으로 바꿔 넣으면, `changes`를 다른 가릴 값으로 볼 때 실행 때 가렸던 값이 그대로 보인다(DR-37 (b)). 드러나는 값은 작업 공간 파일에 이미 있는 값이다.
  - `report`는 실행 기록만큼만 믿을 수 있다.
- **출력 언어:** U-36·U-37 뒤의 main `76c5280`을 `CODARYN_LANG=ko`로 실제 CLI로 다시 쟀다. 한국어 설정에서도 영어로 나오는 것은 다음이다.
  - `report`의 Markdown. 실행 보고서와 적용 실행 보고서 모두다.
  - `review` 결과의 확인 항목. 머리 줄(`실행 <id>의 검토: 받아들임.`)과 끝 줄은 한국어다. 내장 `analyze`의 두 항목(`The report's interpretation matches the result table.`, `No input data the goal names is missing from the analysis.`)은 작업 종류 정의의 고정 값이라 영어다. 그 글의 언어는 사용자에게 묻기로 했다(DR-57).
  - 도움말의 사용법 줄(`usage: codaryn …`), 옵션 이름, 종료 코드 줄의 상태 낱말(`done 0`, `preview 0` 등)
  - 오류 JSON의 `message`와 모든 `--json` 출력(고정)
- 한국어로 나온 것(이번에 잰 것):
  - 진행 줄과 끝 요약(실패한 호출 줄 포함, 8절), `runs`, `revert`의 글, `doctor`, `init`
  - 오류 설명과 그 이유 줄(U-37)
  - `cleanup`의 안내 전부(U-34, 18.8절)
  - `plan` 본문 전부(U-36, 18.2절): 머리 줄 `실행 <id>의 계획: 동작 3개, 적용 전`, `다이제스트:` 줄, 동작 줄(`이동`, `폐기`), 적용 명령 줄 `적용하려면: …`, 적용한 계획의 `적용 실행 <id>에서 적용함 (<지역 시각>)`
  - `apply`의 터미널 질문 `이 계획을 적용할까요? [y/N] (y·예·네: 예, Enter: 아니오)`(U-36)
  - `changes`의 본문(U-36)
  - 키가 없을 때 `models`의 오류
  - `models`의 표, `--use`의 확인 줄, 터미널 질문(U-156. main `07cd600`에서 가짜 서버로 잼, 4절)
  - 모든 명령의 도움말 설명, 옵션 설명, 종료 코드 설명(U-35, U-53)
- 이번에 다시 재지 못한 것:
  - 하드 링크가 없는 드라이브의 동의 질문. DR-59는 그 영어 글이 바뀌었다고 적었다.
- **OS 언어 판단:** `CODARYN_LANG`과 설정의 `language`가 없으면 Node의 `Intl` 기본 로캘로 언어를 고른다. Windows에서는 이것이 표시 언어가 아니라 지역 형식을 따를 수 있다. 원하는 언어가 아니면 `CODARYN_LANG`이나 설정의 `language`로 고정한다(8절). Linux·macOS에서는 확인하지 않았다.
- **잠금 판정:** 프로세스 id는 다시 쓰일 수 있어서, 잠금을 쥔 프로세스가 같은 프로세스인지 시작 시각으로 함께 확인한다(5초 안으로 맞으면 같은 프로세스로 본다). 끝난 실행의 잠금은 다음 실행이 회수한다. 시작 시각이 없는 잠금(이 확인이 생기기 전의 판이 쓴 것)은 프로세스 id만으로 판정하므로, 그 id를 다른 프로그램이 다시 쓰면 그 프로그램이 끝날 때까지 쥔 것으로 보인다(17절 "멈춘 실행의 잠금이 남아 막힐 때").
- **심한 부하에서의 잠금:** 시작 시각 조회(Windows PowerShell)가 5초 안에 답하지 않으면 그 잠금을 "쥐고 있음"으로 본다. 그래서 컴퓨터가 몹시 바쁠 때는 이미 끝난 실행의 잠금인데도 `workspace_locked`(종료 6)로 끝날 수 있다. 두 실행이 함께 작업 공간을 쓰지 않게 하려고 안전한 쪽으로 끝내는 것이다. 잠시 뒤 다시 실행하고, 계속되면 `doctor`의 작업 공간 잠금 항목을 본다(17절).

## 17. 문제 해결

| 코드 | 뜻과 조치 |
| --- | --- |
| `invalid_arguments` | 옵션 오류. 같은 옵션 반복, 모르는 옵션, `--env-file`, `--workspace`·`--goal` 한쪽만, 한 줄 실행 목표와 `--task` 등을 함께 씀, 작업 공간 안의 취소 파일, `doctor`의 `--task`와 `--workspace` 함께, 프로필 이름 형식, 목록에 없는 `models --use` 번호, 이름이 `latest`인 실행 디렉터리가 있는데 `--run latest`, `apply`의 `--run latest`나 형식이 틀린 `--digest`, task 파일과 `--workflow`를 함께 줌, `revert`의 `--dry-run`과 `--allow-unsafe-move`를 함께 줌, 바꾸는 명령(`revert`, `cleanup`, `apply`, `review`)에 `--workspace`를 주지 않음(현재 폴더라면 `--workspace .`, 10절 "`--workspace` 생략") |
| Node 오류, 종료 9 | `--env-file`의 파일이 없다. `--vars-file`로 바꾼다 |
| `invalid_task`, `invalid_config` | stderr의 오류 설명이 파일과 필드(또는 줄·열)를 알려 준다(6절). 설정 상한보다 큰 task 한도, 설정 최상위보다 큰 프로필 한도, 없는 프로필, anthropic의 `maxTotalTokens: null`, 작업 공간 안의 파일, 변수 파일의 BOM, 1 MiB보다 큰 task·설정 파일(4절 "키")도 여기다 |
| `config_exists` | `init`의 대상 위치에 파일이 이미 있다. 그 파일을 고치거나, `--config`로 다른 위치를 준다 |
| `key_in_file` | task·설정 파일이나 `--goal`, 한 줄 실행 목표에서 키 필드나 키 값을 지우고 환경 변수로 옮긴다. 메시지가 어느 키 변수의 값을 찾았는지 알린다(16절 "키 거부와 가림의 빈틈") |
| `secret_env_missing` | `secretEnv`에 적은 환경 변수가 없다 |
| `workspace_not_found` | `workspaceRoot`나 `--workspace`가 있는 디렉터리가 아니다 |
| `workspace_is_install_dir` | 작업 공간(한 줄 실행이면 현재 디렉터리)이 CLI 설치 위치(이 저장소)와 겹친다. 저장소 밖으로 복사해 실행한다(3절, 5절) |
| `workspace_locked` | 다른 실행이나 되돌리기가 끝나기를 기다린다. 컴퓨터가 몹시 바쁠 때는 끝난 실행의 잠금도 이렇게 끝날 수 있으니 잠시 뒤 다시 실행한다(16절). 이 작업 공간에서 실행 중인 Codaryn이 없으면 `.codaryn/lock.json`을 지운다(오류 설명과 `doctor`의 작업 공간 잠금 항목이 같은 안내를 한다). 어떤 흔적에서 이렇게 되는지는 이 절 아래 "멈춘 실행의 잠금이 남아 막힐 때" |
| `provider_not_configured` | `doctor`로 무엇이 빠졌는지 본다. 키는 사용자 환경 변수, 모델은 `models --use`(자리표시자는 설정되지 않은 것), `maxOutputTokens`는 설정 파일 |
| `model_list_failed` | `models`의 API 요청이 실패했다. 메시지의 종류를 본다(`auth_failed`는 키 확인). 아무것도 쓰지 않았다 |
| `config_write_failed` | `models --use`나 `init`이 설정 파일을 쓰지 못했다. 파일은 그대로다 |
| `failed`/`model_error` | 기록의 `model_error.kind`를 본다. `auth_failed`는 키 확인, `rate_limited`·`overloaded`는 잠시 뒤 재시도, `timeout`은 `requestTimeoutMs` 확인. 모델 ID가 틀렸으면 진행 줄의 안내대로 `models`로 고른다 |
| `failed`/`repeated_failure` | 같은 실패가 반복됐다. 근거를 보고 목표나 검증기를 고친다 |
| `needs-input`/`no_verifier` | 검증기를 추가한다 |
| `needs-input`/`protected_changed` | 보호 경로나 `integrity.paths`의 파일이 실행 중 바뀌었다. 결과의 `protectedChanged`와 `report`의 보호 대상 절을 보고, 허용 명령과 검증기를 확인한다 |
| `budget-exhausted` | `reason`의 한도를 올리거나(설정 상한 이내) 목표를 작게 나눈다 |
| `budget-exhausted`/`usage_unknown` | 제공자가 토큰 사용량을 알려 주지 않았다. scripted 대본이면 단계마다 `usage`를 적는다(3절) |
| `run_not_found` | 그 작업 공간에 그 runId의 기록이 없거나, `--run latest`로 고를 실행이 없다. `runs`로 실행 목록을 본다 |
| `run_in_progress`(종료 6) | `--run latest`가 고를 가장 새 실행이 아직 돈다. 끝난 뒤 다시 하거나, 앞선 실행의 id를 준다(10절 "`--run latest`"). 도는 실행이 없는데도 계속되면 이 절 아래 "멈춘 실행의 잠금이 남아 막힐 때" |
| `invalid_run_record` | 기록을 읽을 수 없다. `runs`에서는 `.codaryn`이나 `runs`가 링크이거나 나열할 수 없을 때다. 파일 정리의 적용 실행을 되돌릴 때는 계획 실행의 `plan.json`이 승인한 다이제스트와 다르게 바뀐 경우도 여기다(18.4절) |
| `plan_run_missing` | 되돌리려는 적용 실행의 계획 실행 폴더나 `plan.json`이 없다. 그 폴더를 지웠다면 되살린다. 없으면 그 적용은 되돌릴 수 없다(18.4절, 18.8절) |
| `plan_secrets_differ` | 지금 등록한 가릴 값이 계획 실행 때와 다르게 계획의 경로를 가린다. 아무것도 보이거나 옮기지 않았다. 계획 실행에 쓴 task로 다시 하거나, 계획을 새로 만든다(18.3절) |
| `run_not_plan` | `plan`·`apply`에 준 실행이 계획을 제안하고 멈춘 실행(`plan_pending`)이 아니다. 또는 `apply`의 task가 `workflowRef`로 `plan: "apply"` 작업 종류를 고르지 않았다. 계획 실행에 쓴 task로 한다(18.3절) |
| `plan_not_approved` | `--digest`가 없거나 그 계획의 다이제스트와 맞지 않는다. `plan`으로 다이제스트를 보고 앞 12자 이상을 준다 |
| `plan_already_applied` | 그 계획은 이미 적용됐다. 결과는 `report --run <적용 실행 id>`로 본다. 다시 하려면 `revert --run <적용 실행 id>`로 되돌린 뒤 `run`으로 새 계획을 만든다. 오류 설명의 고칠 곳은 `To fix: See codaryn report. To do it again, revert it, then make a new plan with codaryn run.`(한국어 `고치는 법: codaryn report로 결과를 보고, 다시 하려면 되돌린 뒤 codaryn run으로 새 계획을 만드세요.`)이다(main `cd1cace`) |
| `run_not_awaiting_review` | `review`에 준 실행이 `awaiting_review`로 끝나지 않았다 |
| `plan_records_changed` | 그 계획 실행에 기록 변경 표시가 있다(`runs`의 결과 칸 끝에 `records changed`). 실행이 아닌 것이 그 기록을 바꿔 계획이 읽은 것과 다를 수 있어 아무것도 묻거나 옮기지 않았다. `codaryn run`으로 계획을 새로 만들어(`codaryn plan`은 계획을 보여 주기만 한다) 새 계획을 읽고 적용한다. `plan`은 그 계획을 경고와 함께 보이지만 적용 명령은 보이지 않는다(18.3절) |
| `failed`/`state_changed` | 실행 중에 그 실행이 아닌 것(허용한 명령, 명령형 검증기, 다른 프로그램)이 `.codaryn\`을 바꿨다. 실행을 멈췄고 표시를 남겼다. `report`를 읽고, 허용한 명령과 검증기가 `.codaryn\`에 쓰지 않는지 본 뒤 다시 실행한다(16절 "실행 기록 변조") |
| `cleanup_plan_changed`(종료 2) | 준 다이제스트가 지금의 정리 미리보기의 것과 다르다. 미리보기 뒤에 새 실행, 되돌리기, 남은 폴더 등으로 상태 디렉터리가 바뀌었거나 다른 미리보기의 다이제스트다. 아무것도 지우지 않았다. 다시 미리 보고 새 다이제스트로 확인한다(18.8절) |
| `cleanup`의 `nothing_removed`(종료 3) | 확인했지만 지운 것이 없다. 줄마다 남긴 이유가 나온다(되돌리지 않은 실행, 폐기 보관함이 남은 적용 등). 지우려면 그 이유가 말하는 확인(`--include-not-reverted`, `--delete-discarded`)을 더해 다시 미리 본다(18.8절) |
| `cleanup`의 `partly_failed`(종료 1) | 권한이나 다른 프로그램 때문에 다 지우지 못했다. 원인을 없앤 뒤 다시 미리 보면 남은 것이 `Removed with --confirm alone` 묶음의 `leftover` 항목으로 나온다(18.8절) |
| `needs-input`/`plan_pending` | 계획을 제안하고 멈췄다. 정상이다. `plan`으로 보고 승인하면 `apply`한다(18.3절) |
| `needs-input`/`awaiting_review` | 검증을 통과했고 사람의 판정을 기다린다. 결과를 보고 `review --accept` 또는 `--reject`를 한다(18.6절) |
| `needs-input`/`consent_required` | 하드 링크가 없는 드라이브라 이동을 하지 않았다. 계획은 그대로다. 위험을 받아들이면 `--allow-unsafe-move`로 다시 적용한다(18.5절) |
| `failed`/`plan_stale` | 계획 뒤에 원본이 바뀌었거나 없어졌거나, 지금 정책이 동작을 거부했거나, 파일 목록 확인의 상한을 넘었다. 아무것도 옮기지 않았다. 계획 실행부터 다시 한다 |
| `failed`/`apply_incomplete` | 적용 도중 한 동작이 실패해 멈췄다. 이미 한 동작은 `revert --run <적용 실행 id>`로 되돌린다 |
| 되돌리기 `original_path_taken`, `unsafe_move` | 원래 자리에 다른 파일이 생겨 덮어쓰지 않았거나, 하드 링크가 없는 드라이브라 동의 없이는 옮기지 않았다(18.4절, 18.5절) |
| `done`인데 `changes`가 비어 있음 | 이번 실행은 파일을 바꾸지 않았고, 이미 조건을 만족하던 파일로 검증이 통과했다. 끝 요약의 `Files changed`가 0이다. 이전 실행을 되돌렸는지 확인한다(3절) |
| 도구 `policy_denied` | 명령이나 경로가 정책 밖이거나 보호 경로 쓰기다. `tool_decision.code`를 본다 |
| 도구 `conflict` | 파일이 모델이 읽은 뒤 바뀌었거나, 새 파일로 쓰려는 경로에 파일이 이미 있다 |
| 도구 `invalid_args` | 인자 형식 오류. `run_command.timeoutMs`가 600000을 넘는 경우도 여기다 |
| 도구 `spawn_failed` | `PATH`에서 찾지 못함(`ENOENT`), 지원하지 않는 형식, 작업 공간 안의 실행 파일(`executable_refused`)이나 스크립트·허용 문자 밖 인자(`script_refused`) |
| `codaryn`이 PowerShell에서 막힘 | 실행 정책이 npm의 `.ps1` 실행 파일을 막았다. `codaryn.cmd`로 부른다(2절) |
| 사람용 글이 원하는 언어가 아님 | `$env:CODARYN_LANG = "ko"` 또는 `"en"`, 또는 설정 파일의 `language`. `doctor`의 메시지 언어 항목이 출처를 알려 준다(8절) |
| PowerShell에서 `2>`로 stderr를 돌릴 때 `NativeCommandError` | PowerShell 5.1이 네이티브 명령의 stderr 줄을 오류 레코드로 감싸 보여 주는 것이다. 종료 코드(`$LASTEXITCODE`)와 stdout JSON은 영향받지 않는다 |
| 콘솔에서 결과나 오류의 JSON 줄이 보이지 않음 | 정상이다. stdout과 stderr가 둘 다 터미널이면 `run`·`apply`·`revert`의 결과 JSON 줄과 오류 JSON 줄을 내지 않고 stderr의 글만 보인다. JSON이 필요하면 `--json`을 주거나 파이프로 받는다(`| ConvertFrom-Json`). 오류 `message`의 안내(예: `--workspace .`)도 이때만 보인다(10절 "터미널에서") |

### 멈춘 실행의 잠금이 남아 막힐 때 (`run_in_progress`, `workspace_locked`)

실행이나 적용, 되돌리기는 도는 동안 `.codaryn\lock.json`을 쥔다. 이 파일에는 그 실행의 `runId`, 프로세스 번호 `pid`, 시작 시각(`startedAt`, `processStartedAt`)이 있다. 정상으로 끝나면 지우고, 강제로 끝나면(작업 관리자로 끝냄, 전원이 꺼짐 등) 남는다. 다음 명령은 그 `pid`의 프로세스가 살아 있고 시작 시각이 5초 안으로 맞을 때만 "아직 쥐고 있음"으로 본다(16절 "잠금 판정").

남은 흔적마다 실제로 어떻게 되는지는 아래와 같다. 확인(main `a191a50`의 실제 CLI, 3절 체험 사본): 끝난 실행 A 뒤에, 명령 검사에서 기다리는 실행 B를 띄우고 B를 프로세스째 강제로 끝냈다(결과 없음, 잠금 남음). 그다음 잠금 파일을 각 경우의 모양으로 바꿨다. "다른 프로그램"은 Codaryn이 아닌 `node` 프로세스 하나다.

| 남은 흔적 | `--run latest`(`report` 등) | 새 실행, `revert`, `cleanup --confirm` | `doctor`의 `workspace lock` 항목 | 빠져나오는 법 |
| --- | --- | --- | --- | --- |
| 강제로 끝낸 실행의 잠금. 그 `pid`의 프로세스가 없음 | A를 고른다 | 새 실행이 잠금을 회수하고 진행한다(`done`) | `[ok]` `a lock left by a process that has ended; the next run reclaims it` | 할 일 없음 |
| 그 `pid`를 다른 프로그램이 다시 씀. 잠금에 시작 시각이 있음(지금 판이 쓰는 잠금) | A를 고른다(시작 시각이 달라 끝난 것으로 본다) | 새 실행이 회수하고 진행한다(`done`) | `[ok]` (위와 같은 줄) | 할 일 없음 |
| 그 `pid`를 다른 프로그램이 다시 씀. 잠금에 시작 시각이 없음(옛 판이 쓴 잠금) | `run_in_progress`(종료 6). 그 프로그램이 끝날 때까지 계속되고, 끝나면 A를 고른다 | `workspace_locked`(종료 6). 정리는 아무것도 지우지 않는다 | `[warning]` `a running process holds the workspace lock; if no Codaryn is running, delete .codaryn/lock.json (a reused process id can make this wrong)` | `lock.json`을 지운다. 그 뒤 `latest`는 A이고 새 실행은 `done`이었다 |
| `lock.json`을 읽을 수 없음(깨진 내용) | A를 고른다 | `workspace_locked`(종료 6). 이런 잠금은 회수하지 않는다 | `[warning]` `the workspace lock file (.codaryn/lock.json) cannot be read` | `lock.json`을 지운다. 그 뒤 새 실행은 `done`이었다 |
| 끝난 실행의 잠금 옆에 회수 파일 `lock.json.reclaim`이 남음(그 안의 `pid`가 살아 있는 다른 프로그램) | A를 고른다 | `workspace_locked`(종료 6). 회수 파일이 있는 동안 잠금을 회수하지 않는다 | `[warning]` `a lock reclaim file (.codaryn/lock.json.reclaim) is left, so a lock left by an ended process is not reclaimed; if no Codaryn is running in this workspace, remove that file` | `lock.json.reclaim`을 지운다. 그 뒤 새 실행이 남은 잠금을 회수하고 `done`이었다 |

- 막힌 동안에도 실행 id를 직접 주면 그 실행을 볼 수 있다. 위 모든 경우에 `report --run <A의 id>`는 종료 0이었다. `run_in_progress`의 고치는 법 줄(`To see an earlier run, give its id; codaryn runs lists the runs of the workspace.`)이 이것이다.
- 멈춘 실행 B는 `runs`에 `stopped without a result`(한국어 `결과 없이 중단됨`)로 남는다(`runs --json`의 `phase`는 `no_result`, U-162). 잠금이 B를 가리키고 그 주인이 살아 있는 것으로 보일 때만, 곧 위 셋째 경우(시작 시각이 없는 옛 판의 잠금, 그 `pid`를 다른 프로그램이 씀)에만 `running`(한국어 `진행 중`)이다. 읽을 수 없는 잠금이나 남은 회수 파일로는 B가 돈다고 말하지 않는다. 정리 미리보기는 B를 고르지 않고, 잠금이 쥔 것으로 보이면 `running (it holds the workspace lock)`, 아니면 `no result yet (it may still be running)`이라고 적는다.
- `workspace_locked`의 사람용 오류는 이렇게 끝난다(실제 출력, 한국어는 `이 작업 공간에서 실행 중인 Codaryn이 없으면 .codaryn/lock.json과, 있다면 .codaryn/lock.json.reclaim을 지우세요.`).

  ```
  codaryn: error — another run is using this workspace (workspace_locked)
    To fix: Run again after the other run finishes.
    If no Codaryn is running in this workspace, delete .codaryn/lock.json and, if it is there, .codaryn/lock.json.reclaim.
  ```

- **지우기 전에 정말 도는 Codaryn이 없는지 사람이 확인한다.** 그 작업 공간에서 Codaryn을 돌리는 터미널이나 GUI 창이 없는지 본다. `lock.json`의 `pid`로 `Get-Process -Id <pid>`를 볼 수는 있지만, `node`라고 나와도 Codaryn이라는 뜻은 아니다(위 확인의 다른 프로그램도 `node`였다). 도는 실행의 잠금을 지우면 두 실행이 같은 작업 공간을 함께 쓰게 된다.
- `run_in_progress`의 고치는 법 줄은 "끝난 뒤 다시"와 "실행 id를 주라"만 말하고, 잠금이나 `doctor`는 말하지 않는다. 도는 실행이 없는데도 계속되면 `doctor --task <task.json>`(또는 `--workspace`)의 `workspace lock` 항목을 본다. 설정 없이 `--workspace`만 주면 키·모델·한도 항목이 실패해 `doctor`가 종료 1이 되지만, 잠금 항목은 그대로 읽을 수 있다.
- 확인하지 못한 것: GUI가 이 경우들을 어떻게 보이는지, Linux·macOS의 판정(프로세스 시작을 다른 방법으로 읽는다), 하드 링크가 없는 드라이브에서 쓰는 도중의 잠금, 시작 시각 조회가 실제로 5초를 넘긴 경우(16절 "심한 부하에서의 잠금"은 코드로만 안다).

## 18. 범용 작업: 작업 종류, 계획 확인, 사람 확인

작업 종류는 실행에 쓸 도구, 고정 지시, 계획 확인 여부, 끝나는 방식을 묶은 것이다. 작업 종류를 고르지 않은 task는 지금까지와 같이 실행된다(도구 넷 `read_file`, `search_files`, `write_file`, `run_command`, 계획 없음, 검증기로 완료).

새 명령 `plan`, `apply`, `review`, `changes`는 모델을 부르지 않는다. 도움말은 영어 사용법 줄 아래에 설명, 옵션, 종료 코드를 한국어·영어로 보인다(U-35). 본문과 적용을 묻는 터미널 질문도 한국어 설정에서는 한국어다(U-36, 16절 "출력 언어").

### 18.1 작업 종류 고르기

| id | 도구 | 끝나는 방식 | 쓰는 곳 |
| --- | --- | --- | --- |
| `general` | 도구 넷 | 검증기 | 지금까지와 같은 작업 |
| `code` | 도구 넷 | 검증기 | 코드 변경. 명령은 정책이 허용한 것만 |
| `document` | `read_file`, `search_files`, `write_file` | 검증기 | 문서 작성. 명령 도구 없음 |
| `analyze` | `read_file`, `search_files`, `write_file` | 검증기를 통과한 뒤 사람 확인(18.6) | 자료 분석. 개인정보 자료는 다루지 않는다(18.7) |
| `organize` | `read_file`, `search_files`, `inspect_files`, `propose_plan` | 계획을 제안하고 멈춤. 사람이 승인하면 적용(18.3) | 파일 이동·폐기. 명령 금지 |

- **고르는 곳**(앞의 것이 우선): task 파일의 `workflowRef` → 간편 형식의 `--workflow <id>` → 프로필의 `workflowRef`. task 파일과 `--workflow`를 함께 주면 `invalid_arguments`다.
  - `codaryn help run`(그리고 `plan`, `apply`, `review`)의 옵션 목록에 `--workflow <id>: the task type of the quick form (built in, or defined in the config file); not with --task, whose file names its own`가 있다(U-53, main `76c5280`의 실제 CLI).
- task의 `workflow`는 표시용 이름표일 뿐이다. `"workflow": "organize"`만 쓰고 `workflowRef`가 없으면 예전 방식으로 실행되고 계획 도구가 없다.
- **사용자 정의 작업 종류:** 설정 파일의 `workflows`에 `"<id>": { 정의 }`로 둔다. 내장 id는 다시 정의할 수 없다.
  - 필드: `label`, `tools`, `instructions`, `plan`(`none`·`apply`), `completion`(`verifiers`·`human_review`), `humanReview`(`checklist`), `allowCommands`, `policy`, `verifiers`, `limits`
  - 정의는 사용자 설정 파일에만 있다. task 파일은 작업 종류를 정의할 수 없고, 작업 공간 안의 파일로는 바꿀 수 없다(5절).
- **task가 바꿀 수 있는 범위**(넘으면 `invalid_task`, 간편 형식·프로필의 값이면 `invalid_config`):
  - `tools`는 작업 종류가 주는 도구 안에서 줄이기만 한다.
  - `plan: "apply"` 작업 종류에서 `plan: "none"`으로 바꿀 수 없다.
  - `organize`처럼 `allowCommands: false`인 작업 종류에서는 `policy.commands`가 비어 있어야 한다. `run_command`도 도구에서 빠진다. 이 금지는 모델이 부를 수 있는 명령에 대한 것이다. task나 설정에 사람이 둔 `command` 검증기는 적용 뒤에 실행된다.
  - 없는 `workflowRef`는 `invalid_task`다.
- **정책 합치기(결정 DR-41):** 작업 종류가 적용되면 그 정의의 정책은 설정·프로필의 정책(간편 형식)이나 task 파일의 자기 정책으로 대체되지 않고 합쳐진다. 작업 종류의 규칙을 느슨하게 하는 정책은 없다.
  - 보호 경로(`protectedPaths`): 양쪽을 모두 쓴다.
  - 명령 규칙: 양쪽이 모두 허용하는 명령만 남는다. `organize`처럼 명령을 허용하지 않는 작업 종류에서는 설정·프로필의 명령 규칙이 모두 빠진다(task 파일 자신의 명령 규칙은 위처럼 `invalid_task`다).
  - 계획 동작(`planActions`): 설정 정책이 적었을 때만 양쪽에 다 있는 것으로 줄인다. 적지 않았으면 작업 종류의 것을 그대로 쓴다.
  - 경로 토큰 되살리기(`restorePathTokens`): 양쪽이 모두 허용할 때만 켜진다.
  - 빠진 것은 `doctor`가 알리고(7절의 예), 실행 시작 줄에 이어 붙으며, 실행 기록의 `run_started`에 종류와 개수만 남는다. 확인(main `23daf6b`): 위 7절의 설정으로 `run --workspace … --workflow organize`를 하면 기록에 `commands_dropped` 1과 `restore_path_tokens_off` 1이 남았다.
  - 실행 시작 줄의 실제 출력(U-24 문구 브랜치 `f2ed116`(main `266c46d` 위)). task 파일이 `workflowRef`로 고른 설정의 작업 종류가 경로 토큰 되살리기를 끄고 같은 id의 검증기 하나를 뺀 경우다:

    ```
    codaryn: run started — provider scripted · the task type's own rules turn off restoring path tokens, which the configured policy allows · the task type's own checks leave out checks given in the config or task with the same id: 1
    ```

    한국어로는 `codaryn: 실행 시작 — 모델 제공자 scripted · 작업 종류 자체 규칙 때문에, 설정한 정책이 허용한 경로의 가린 값 되살리기를 끕니다 · 작업 종류 자체 검증과 id가 같아, 설정이나 task에 준 검증 1개를 뺐습니다`이다. 모두 한 줄이라 좁은 터미널에서는 접힌다(16절).
  - 검증기(결정 DR-43 (a)): 작업 종류 정의의 검증기는 늘 실행된다. 설정·프로필·task의 검증기는 그 뒤에 더해지고, 정의의 검증기와 id가 같은 것만 빠진다(정의의 것이 판정한다). 빈 목록(`[]`)도 정의의 검증기를 지우지 않는다. id가 같은데 내용이 다른 검증기가 빠지면 `doctor`가 `a run of this task type leaves out checks given in the config or task with the same id as its own: 1`처럼 알리고, `run_started`에 `verifiers_dropped`가 남는다.
    - 확인(main `6df2eae`): 설정의 작업 종류 `notes`에 검증기 `has-summary`(`summary.md`가 있다)를 두고, task 파일이 `workflowRef: "notes"`로 같은 id를 더 느슨하게(`a.txt`가 있다) 적고 `a-kept`를 더하면, `has-summary`(정의의 것)와 `a-kept`가 실행됐다. `doctor --task`가 위 줄을 냈다.
- **한도:** 작업 종류 정의의 한도(`organize`: 턴 8, 도구 호출 40)는 task가 비운 한도를 채우는 기본값이다. 상한은 설정 파일의 한도만 정한다(6절).
- **간편 형식**(`--workspace … --workflow organize`)으로 `run`하면 다른 간편 형식처럼 설정 파일의 한도와 모델 설정을 쓴다. 모델을 부르지 않는 명령의 간편 형식은 명령마다 다르다(U-17). 보통은 계획 실행에 쓴 task를 `--task`로 준다(18.3절).
  - **`apply`:** 모델은 부르지 않지만 검증기를 그 설정으로 돌리므로, 설정 파일에 한도가 모두 있어야 한다. 한도가 빠졌거나 설정 파일이 없으면 `invalid_config`다.
  - **`plan`, `review`, `changes`:** 실행 한도를 요구하지 않는다. 설정 파일에서는 가릴 값과 작업 종류만 읽고, 키와 모델도 필요 없다. 설정 파일이 없어도 된다. 설정 파일이 JSON으로 읽히지 않으면 `invalid_config`다. 가릴 값을 거기서 읽기 때문이다.
  - 한도가 하나라도 빠진 설정에서는 준 한도의 상한을 검사하지 않는다. 그 한도로 실행되는 것은 없다(검토 R-54 R54-I3). 예: `maxDurationMs: 999999999999` 하나만 둔 설정으로도 `plan`은 종료 0이었다.
    - 읽기 명령은 한도를 쓰지 않으므로 이 동작은 그대로 둔다(PM 결정, U-47 보고의 7번).
    - 같은 값을 네 한도와 함께 두면 `plan`, `changes`, `apply` 모두 `invalid_config`(`limits.maxDurationMs must be at most 86400000`)였다. 값의 꼴은 한도가 빠져 있어도 검사한다. `maxModelTurns: 0` 하나만 두면 셋 다 `limits.maxModelTurns must be a positive integer`였다(main `9934a9a`).
  - 확인(main `0ad28bc`의 실제 CLI, 18.2절 예시의 계획 실행, 설정 파일은 기본 위치):

    | 명령 | 설정 없음 | 한도 없음 | 한도 하나 | 한도 모두 | 깨진 JSON |
    | --- | --- | --- | --- | --- | --- |
    | `plan --workspace … --run <id>` | 0 | 0 | 0 | 0 | 2 `invalid_config` |
    | `changes --workspace … --run latest` | 0 | 0 | 0 | 0 | 2 `invalid_config` |
    | `review --workspace … --run <id> --accept` | 2 `run_not_awaiting_review` | 같음 | 같음 | 같음 | 2 `invalid_config` |
    | `apply --workspace … --workflow organize` | 2 `invalid_config` | 2 `invalid_config` | 2 `invalid_config` | 0 | 2 `invalid_config` |
    | `report`, `runs` | 0 | 0 | 0 | 0 | 0 |

    - `review`에 준 것은 사람 확인을 기다리는 실행이 아니다. 그래서 한도 검사를 지나 실행을 고르는 데까지 갔다는 뜻으로만 읽는다.
    - `report`와 `runs`는 설정 파일을 읽지 않는다.
  - 한도가 없는 설정(또는 설정 파일 없음)으로 `apply --workspace … --workflow organize`를 하면, 오류 설명 끝에 task를 주라는 안내가 한 줄 더 나온다(main `0ad28bc`의 실제 출력, stderr):

    ```
    codaryn: error — the config file cannot be read or has an invalid value (invalid_config)
      config file — limits.maxTotalTokens has an invalid value (values are not shown)
      To fix: Fix the named field in the config file. Without a config file, codaryn init creates one.
      Check: codaryn doctor
      The quick form (--workspace) of plan, apply and review reads the run settings, limits included, from the config file. Give the plan run's task with --task instead: it brings its own settings and secrets.
    ```

    - `organize`의 정의가 턴과 도구 호출의 한도를 채우므로, 처음 빠진 한도로 `limits.maxTotalTokens`가 나온다. 값이 틀린 것이 아니라 없는 것이다.
    - 마지막 줄은 U-17 전의 문구라 아직 `plan`과 `review`도 한도를 읽는다고 말한다. 위 표처럼 두 명령은 한도 없이 된다.
    - 한국어 마지막 줄은 `plan, apply, review의 간편 형식(--workspace)은 한도를 포함한 실행 설정을 설정 파일에서 읽습니다. 대신 계획 실행의 task를 --task로 주세요. task는 자기 설정과 가릴 값을 함께 가져옵니다.`이다.
    - 깨진 JSON이면 이 줄 없이 `config file — JSON syntax error at line 1, column 2`가 나온다.

### 18.2 키 없이 체험하기: 파일 정리

[`examples/organize-demo/`](../examples/organize-demo)는 키 없이 계획 실행 → 계획 보기 → 승인과 적용 → 되돌리기를 보는 예시다. 3절처럼 저장소 밖으로 복사해서 실행한다.

```powershell
$org = "$HOME\codaryn-organize-demo"
Copy-Item -Recurse examples\organize-demo $org
node dist/src/cli/main.js run --task $org\task.json                       # 계획 실행
node dist/src/cli/main.js plan --task $org\task.json --run <계획 실행 id>  # 계획 보기
node dist/src/cli/main.js apply --task $org\task.json --run <계획 실행 id> --digest <다이제스트 앞 12자>
node dist/src/cli/main.js runs --workspace $org\workspace
node dist/src/cli/main.js revert --workspace $org\workspace --run <적용 실행 id> --dry-run
node dist/src/cli/main.js revert --workspace $org\workspace --run <적용 실행 id>
```

**계획 실행(`run`):** 대본이 `inbox`를 살펴보고(`inspect_files`) 계획 하나를 제안한다(`propose_plan`). 파일은 바뀌지 않는다. 종료 3이다. 끝 요약(실제 출력):

```
codaryn: run started — provider scripted
codaryn: turn 1
codaryn: inspect files — allowed (inspect_files)
codaryn: turn 2
codaryn: propose a plan — allowed (propose_plan)
codaryn: finished — needs input (plan_pending)
── Result: needs input — a plan was proposed and waits for approval (needs-input/plan_pending) ──
A plan is ready: actions 3. Nothing was changed; it waits for approval.
Files changed: 0
Usage: model turns 2 · tool calls 2 · 0 s
The agent's description (the model's own words, not checked, and not what you approve):
  | 사진과 영수증을 연도 폴더로 옮기고 임시 파일을 폐기한다
Read the plan with codaryn plan, and apply it with codaryn apply if you approve it.
Run id: 20261112T200120Z-c27683db
Report: codaryn report --workspace <workspace> --run 20261112T200120Z-c27683db
Plan: codaryn plan --task <task.json> --run 20261112T200120Z-c27683db
Apply after approval: codaryn apply --task <task.json> --run 20261112T200120Z-c27683db --digest <digest>
  1eff19809df98cd22c5117163c09128e658fe5ea0e0afceaa3a371251e9693cd
```

- 계획 실행은 검증기를 돌리지 않는다. task의 검증기는 적용 때 돈다.
- stdout JSON의 `plan`에 다이제스트와 동작 수가 있다. 다이제스트는 실행마다 다르다(`plan.json`에 실행 id가 들어간다). 콘솔에서는 이 JSON 줄이 없고, 다이제스트는 위 끝 요약의 마지막 줄에 나온다(10절 "터미널에서").

**계획 보기(`plan`):** 실제 출력(stdout).

```
Plan of run 20261112T200120Z-c27683db: 3 action(s), pending
Digest: 1eff19809df98cd22c5117163c09128e658fe5ea0e0afceaa3a371251e9693cd
  1. move     inbox/beach-2025.jpg  ->  photos/2025/beach-2025.jpg
  2. move     inbox/receipt-2026.pdf  ->  documents/2026/receipt-2026.pdf
  3. discard  inbox/old-draft.tmp  (kept in .codaryn/discarded/ until removed)
The agent's description (the model's own words, not checked, and not what you approve):
  | 사진과 영수증을 연도 폴더로 옮기고 임시 파일을 폐기한다
To apply it: codaryn apply <the same task form> --run 20261112T200120Z-c27683db --digest 1eff19809df9
The digest names exactly these actions and the contents the plan's files had when the plan was made. The apply refuses if the plan or one of its files changed since, and when the plan run has a records-changed mark. The digest does not cover the run's other records.
```

- `The agent's description (…)` 아래의 `|` 줄은 모델이 계획을 제안하며 쓴 요약이다(U-14). 모델의 말이며 검증되지 않았고, **승인하는 대상이 아니다.** 요약은 `plan.json`과 다이제스트에 들지 않는다. 승인은 그 위의 동작 목록과 다이제스트로 한다. 이 체험의 요약이 한국어인 것은 대본이 그렇게 썼기 때문이다.
- 끝 문장은 다이제스트가 묶는 것을 말한다: 이 동작들과, 계획을 만들 때 계획에 든 파일의 내용. 그 뒤 계획이나 그 파일이 바뀌었거나 계획 실행에 기록 변경 표시가 있으면 적용을 거부한다. 실행의 다른 기록(journal 등)은 다이제스트에 들지 않는다.
- 한국어 설정에서는 계획 보기 전체가 한국어다(U-36). 경로, 실행 id, 명령은 그대로다. main `76c5280`의 실제 출력(같은 예시, 일부):

  ```
  실행 20261112T235113Z-bcb77c7d의 계획: 동작 3개, 적용 전
  다이제스트: 55c7dc68225a3dc542f376f49d738253cd55ce10a347eb2acc3169b4793b3e99
    1. 이동  inbox/beach-2025.jpg  ->  photos/2025/beach-2025.jpg
    2. 이동  inbox/receipt-2026.pdf  ->  documents/2026/receipt-2026.pdf
    3. 폐기  inbox/old-draft.tmp  (지울 때까지 폐기 보관함 .codaryn/discarded/에 남음)
  에이전트의 설명(모델이 쓴 말이며 검증되지 않았고, 승인하는 대상이 아님):
    | 사진과 영수증을 연도 폴더로 옮기고 임시 파일을 폐기한다
  적용하려면: codaryn apply <같은 작업 지정> --run 20261112T235113Z-bcb77c7d --digest 55c7dc68225a
  ```

  - 그 아래 끝 문장도 한국어다(`다이제스트는 바로 이 동작들과, …`).

**적용(`apply`):** 실제 출력(stderr). 종료 0이다.

```
codaryn: apply started — actions: 3, approved by a command-line argument
codaryn: preflight — problems: 0
codaryn: action #1 — moved inbox/beach-2025.jpg → photos/2025/beach-2025.jpg
codaryn: action #2 — moved inbox/receipt-2026.pdf → documents/2026/receipt-2026.pdf
codaryn: action #3 — moved to the discarded files inbox/old-draft.tmp
codaryn: check #1 — passed (pass)
codaryn: check #2 — passed (pass)
codaryn: finished — done (verified)
── Result: done — every configured check passed (done/verified) ──
Actions applied: 3 of 3
  action #1 — moved inbox/beach-2025.jpg → photos/2025/beach-2025.jpg
  action #2 — moved inbox/receipt-2026.pdf → documents/2026/receipt-2026.pdf
  action #3 — moved to the discarded files inbox/old-draft.tmp
Folders the actions left without files (kept in place): 1
Plan run: 20261112T200120Z-c27683db
Checks passed: 2 of 2 (within the configured checks)
Read the report, and revert if needed.
Run id: 20261112T200121Z-da084c3e
Report: codaryn report --workspace <workspace> --run 20261112T200121Z-da084c3e
Revert: codaryn revert --workspace <workspace> --run 20261112T200121Z-da084c3e
```

- 검증 1번은 적용이 늘 돌리는 파일 목록 확인(`inventory`)이다. 계획에 있던 이동·폐기만 일어났는지 본다. 2번은 task의 `file_rules`다.
- 적용은 새 실행(적용 실행)이다. stdout은 `kind:"apply"` JSON 한 줄이고(`planRunId`, `digest`, `applied` 등. 콘솔에서는 `--json`이나 `--quiet`일 때만, 10절 "터미널에서"), 같은 내용이 그 실행의 `result.json`이 된다.
- 폐기한 파일은 `.codaryn\discarded\<적용 실행 id>\` 아래에 동작 번호 이름(`2`)으로 있다.
- `runs`에는 적용 실행이 맨 위에 `3 actions  done (done/verified) · applies the plan of run <계획 실행 id>`로 나온다(한국어는 결과 칸 끝이 `· 실행 <계획 실행 id>의 계획 적용`). 적용 실행의 변경 칸은 바꾼 파일 수가 아니라 적용한 동작 수이고, 그렇다고 낱말로 말한다(한국어 `동작 3개`). `runs --json`의 `changes`는 수(`3`) 그대로다. `plan`을 다시 보면 상태가 `applied`이고 `Applied by run <적용 실행 id> (<지역 시각>)` 줄이 붙는다(예: `Applied by run 20261112T235227Z-ff199ffc (2026-11-13 08:52:27)`, main `76c5280`, DR-59). 한국어는 `적용 실행 <id>에서 적용함 (<지역 시각>)`이다.
- **실행 목록의 계획 실행 줄(U-16):** 결과 칸이 그 계획의 적용이 어떻게 되었는지 말한다. 판정은 적용 실행의 기록으로 한다(계약의 `planApplyStateOf`).

  | 상태 | 결과 칸(영어) | 한국어 | 언제 |
  | --- | --- | --- | --- |
  | `applied` | `plan applied by run <적용 실행 id> (needs-input/plan_pending)` | `계획 적용됨(적용 실행 <id>)` | 적용 실행이 `done` |
  | `unfinished` | `plan apply not finished (apply run <id>, verifier_failed) (needs-input/plan_pending)` | `계획 적용이 끝나지 않음(적용 실행 <id>, verifier_failed)` | 적용 실행이 `done`이 아닌 채 끝남. 괄호에 그 이유 |
  | `applying` | `plan being applied, or its apply stopped (apply run <id>, no result yet) (needs-input/plan_pending)` | `계획 적용 중이거나 적용이 멈춤(적용 실행 <id>, 결과 없음)` | 적용 실행에 결과가 아직 없음 |
  | `reverted` | `plan applied, then reverted (apply run <id>) (needs-input/plan_pending)` | `계획을 적용했다가 되돌림(적용 실행 <id>)` | 적용 실행의 되돌리기가 `complete` |
  | `record_missing` | `no readable records of the apply run <id> (removed, or cannot be checked) (needs-input/plan_pending)` | `적용 실행 <id>의 기록 없음(지웠거나 확인할 수 없음)` | 그 적용 실행의 기록이 목록에 없음 |

  - 적용한 적이 없는 계획 실행은 예전처럼 `needs input (needs-input/plan_pending)`(한국어 `확인 필요`)이다.
  - 사전 점검에서 멈춘 적용(`plan_stale`)은 계획을 적용한 것으로 남기지 않는다. 그래서 계획 줄도 그대로다.
  - `runs --json`의 계획 실행 항목에는 `appliedBy`(`runId`, `at`)만 있다. 상태 낱말은 사람용 글에만 있다.
  - 확인(main `4010905`의 실제 CLI, 18.2절 예시, 두 언어). 상태마다 이렇게 만들었다.
    - `applied`: 적용
    - `unfinished`: 계획 뒤에 task에 실패하는 검증기를 더해 적용. 동작은 했고 `failed`/`verifier_failed`로 끝났다.
    - `applying`: 적용 실행의 `result.json`을 지움
    - `reverted`: 적용 실행을 되돌림
    - `record_missing`: 적용 실행 폴더를 지움
- **기록을 확인하지 못했다는 알림(U-8, U-29, U-33, DR-55):** 적용은 계획 실행의 기록이 바뀌지 않았는지 상태 디렉터리를 살펴 확인한다. 다 확인하지 못하면 적용을 멈추지는 않고 한 줄로 알린다. 까닭은 둘이고 글이 다르다.
  - **적용 자신이 다 살펴보지 못함:** 상태 디렉터리가 너무 크다. 코드의 한도는 셋이다: 항목이 20,000개를 넘을 때, 지문을 뜰 파일의 합이 32 MiB를 넘을 때, 그 실행 자신의 기록 밖(다른 실행의 폴더, `.codaryn\` 바로 아래 파일 등)에 1 MiB를 넘는 파일이 있을 때(`src/store/state-guard.ts`, `src/contracts/state.ts`).

    ```
    The plan run's records could not be checked for changes, because the state directory is too large to check entirely; the apply was not stopped for this. Read the result, and run codaryn cleanup to make the state directory small enough to check.
    ```

    한국어는 `상태 디렉터리가 너무 커서 다 확인하지 못해, 계획 실행의 기록이 바뀌었는지 확인하지 못했습니다. 이 때문에 적용을 멈추지는 않았습니다. 결과를 확인하고, codaryn cleanup으로 상태 디렉터리를 확인할 수 있는 크기로 줄이세요.`다.
  - **계획 뒤의 실행이 다 확인하지 못함:** 적용 자신의 확인은 온전하다. 그러나 계획 실행이나 그 뒤의 실행 가운데, 상태 디렉터리를 다 확인하지 못했거나 끝 기록 없이 멈춘 실행이 있다. 같은 초에 시작한 실행도 계획 뒤로 센다(DR-55).

    ```
    The plan run's records could not be checked for changes, because the plan run or a run after it could not check the state directory entirely or stopped part way; the apply was not stopped for this. Read the result.
    ```

    한국어는 `계획 실행이나 그 뒤의 실행 가운데 상태 디렉터리를 다 확인하지 못했거나 중간에 멈춘 실행이 있어, 계획 실행의 기록이 바뀌었는지 확인하지 못했습니다. 이 때문에 적용을 멈추지는 않았습니다. 결과를 확인하세요.`다.
  - 둘 다 결과 JSON의 `noticeKinds`에 `plan_records_unchecked`가 들어간다. 뒤의 것만 `planRecordsUncheckedCause: "run_since_plan"`이 있다. 둘이 겹치면 앞의 것(적용 자신의 것)을 알린다.
  - 적용 실행의 보고서에는 `## Notices` 절에 한 줄이 나온다. 뒤의 까닭이면 `` `a run since the plan was made could not check the state directory entirely, so the plan run's records may have changed without a mark (plan_records_unchecked)` ``였다.
  - 다 살펴보지 못한 실행의 진행 줄은 `codaryn: part of the state directory was too large to check; the run goes on`이다. 한국어는 `상태 디렉터리 일부가 너무 커서 확인하지 못했습니다. 실행은 계속합니다`다.
  - 확인(main `4010905`의 실제 CLI, 두 언어, 18.2절 예시):
    - 앞의 까닭: 계획 실행 뒤 `.codaryn\`에 2 MiB 파일을 두고 적용했다.
    - 뒤의 까닭: 그 파일을 둔 채 같은 작업 공간에서 다른 실행을 하나 마친 뒤, 파일을 지우고 적용했다.
    - 두 적용 모두 `done`(종료 0)이었다.
- `report --run <적용 실행 id>`는 적용 실행의 보고서다(실제 출력, 앞부분):

```
# Codaryn apply run report

- Run: `20261112T200121Z-da084c3e` (an apply run: no model takes part)
- Plan run: `20261112T200120Z-c27683db`, digest `1eff19809df98cd22c5117163c09128e658fe5ea0e0afceaa3a371251e9693cd`
- Task: `organize-demo`
- Approval: `cli-flag`; consent to unsafe moves: none
- Result: `done` / `verified`, exit code 0
- Report: complete (13 journal records)

## Preflight

- Actions that could not be applied: 0
- Workspace too large to check: no
- Moves that could only be made without the guarantee (no hard links): 0

## Actions (3 of 3 done)

- action 1: move `inbox/beach-2025.jpg` -> `photos/2025/beach-2025.jpg`
- action 2: move `inbox/receipt-2026.pdf` -> `documents/2026/receipt-2026.pdf`
- action 3: discard `inbox/old-draft.tmp` (kept as `.codaryn/discarded/20261112T200121Z-da084c3e/2`)
```

  이어서 검증(`inventory`와 task 검증기의 확인 항목), 보호 대상, 사용량, 되돌리기 명령(`Undo`), 확인하지 않은 범위가 나온다. 이 절의 블록은 모두 main `a191a50`에서 한 번에 만든 같은 실행들의 출력이다.

**되돌리기:** `revert --dry-run`은 아무것도 바꾸지 않고 판정만 보인다(실제 출력, stderr).

```
codaryn: Files to revert: 3 (preview, nothing changed) (complete)
  inbox/old-draft.tmp — restored from the discarded-files folder
  inbox/receipt-2026.pdf — moved back to where it was
  inbox/beach-2025.jpg — moved back to where it was
The preview did not check whether this drive can move files back without risking replacing a file; the real revert checks it and, without consent, skips such files.
Run again without --dry-run to revert.
```

`--dry-run` 없이 실행하면 `Files reverted: 3 (complete)`, 종료 0이다. 세 파일이 `inbox`로 돌아오고 폐기 보관함의 그 실행 폴더는 빈다. 다시 되돌리면 세 파일 모두 `already_reverted`이고 `complete`다.

### 18.3 계획 확인과 적용 (`plan`, `apply`)

```powershell
node dist/src/cli/main.js plan --task <task.json> --run <계획 실행 id> [--json]
node dist/src/cli/main.js apply --task <task.json> --run <계획 실행 id> --digest <다이제스트 앞 12자 이상> [--allow-unsafe-move] [--cancel-file <파일>] [--quiet]
```

- **계획 실행:** `organize`(또는 `plan: "apply"`인 작업 종류)의 `run`은 모델이 계획 하나를 제안하면 `needs-input`/`plan_pending`(종료 3)으로 끝난다.
  - 계획은 `.codaryn\runs\<계획 실행 id>\plan.json`에 동작(이동·폐기)과 원본 파일의 해시만 담는다.
  - 다이제스트는 그 파일의 SHA-256이다. 승인은 이 다이제스트로 한다.
  - 한 계획은 동작 1,000개, 원본 크기 합계 4 GiB까지다.
- **계획 보기(`plan`):** `plan.json`을 지금 명령의 가릴 값으로 다시 가려 보여 준다. 아무것도 바꾸지 않고 잠금도 잡지 않는다. `--run latest`를 받는다. 가릴 값이 든 경로는 `documents/[[CODARYN_SECRET:7a30010719392743]]/receipt-2026.pdf`처럼 토큰으로 보인다. 보이는 것(U-14, 18.2절의 예):
  - 머리 줄(동작 수와 `pending`·`applied`), 다이제스트, 동작 목록.
  - **에이전트의 설명:** 모델이 `propose_plan`에 쓴 요약(500자까지)을 `The agent's description (the model's own words, not checked, and not what you approve):` 아래 `|` 줄로 보인다. 계획 실행의 journal에서 읽어 지금 가릴 값으로 다시 가리고, 키 모양과 지금 키는 숨기고, 제어 문자는 뺀다. 요약은 다이제스트에 들지 않으므로 승인하는 대상이 아니다. 찾거나 읽거나 가리지 못하면 이 줄 없이 보인다.
  - 적용하지 않은 계획이면 적용 명령(`To apply it: …`), 적용한 계획이면 `Applied by run <적용 실행 id> (<지역 시각>)`(DR-59 전에는 UTC 시각이었다).
  - 끝 문장: 다이제스트가 이 동작들과 계획을 만들 때의 파일 내용을 묶는다는 것, 그 뒤 계획이나 파일이 바뀌었거나 기록 변경 표시가 있으면 적용을 거부한다는 것, 실행의 다른 기록은 다이제스트에 들지 않는다는 것.
  - `--json`은 `kind:"plan"` 한 줄이다(`digest`, `actions`, `appliedBy`, `inventoryLimitReached`, 요약이 있으면 `summary`, 표시가 있으면 `recordsChanged: true`).
- **승인**(둘 다 없으면 `plan_not_approved`, 종료 2, 아무것도 옮기지 않음):
  - `--digest`에 다이제스트 앞 12~64자(소문자 16진수)를 준다. 그 계획의 다이제스트와 맞아야 한다.
  - stdin과 stderr가 모두 터미널이고 `--digest`가 없으면, 계획을 보이고 `Apply this plan? [y/N]`을 묻는다. 기본은 아니오다.
  - 다이제스트는 계획 실행의 끝 요약에 나온 값을 쓴다. 상태 디렉터리는 허용 명령이 바꿀 수 있으므로, `plan`에서 본 다이제스트가 그 값과 같은지 확인하고 승인한다.
- **같은 가릴 값으로 한다:** 계획 파일은 계획 실행이 가린 표기를 동작마다 함께 담는다(가릴 값이나 그 해시는 담지 않는다). `plan`·`apply`는 지금 명령이 등록한 가릴 값으로 다시 가린 결과가 그 표기와 같을 때만 진행한다.
  - 다르면 계획을 읽은 직후 `plan_secrets_differ`(종료 2)로 끝난다. 아무것도 보이거나 묻거나 기록하거나 옮기지 않고, 적용 실행도 만들지 않는다. `--allow-unsafe-move`를 줘도 같다. 실제 출력(stderr):

    ```
    codaryn: error — the secrets registered now hide the plan's paths differently from the plan run, so nothing was shown or changed (plan_secrets_differ)
      To fix: Use the same task form as the plan run, and so the same secrets, or make the plan again.
    ```

  - 계획 실행에 쓴 task 파일(같은 `privacy.secretEnv`)로 `plan`과 `apply`를 한다. 경로에 든 값을 계획 실행 뒤에 새로 가릴 값으로 등록했다면, 그 계획은 보거나 적용할 수 없으니 계획을 새로 만든다.
- **기록이 바뀐 계획은 적용하지 않는다(U-1):** 그 계획 실행에 기록 변경 표시가 있으면(16절 "실행 기록 변조") `apply`는 묻기 전에 `plan_records_changed`(종료 2)로 거부한다. 아무것도 묻거나 기록하거나 옮기지 않고, 적용 실행도 만들지 않는다. 그 계획이 사람이 읽은 것과 다를 수 있기 때문이다.
  - `plan`은 표시가 있는 계획도 보인다(종료 0). 맨 앞에 경고가 붙고, 적용 명령 대신 적용할 수 없다는 줄이 나오며, 에이전트의 설명은 빠진다(그 journal도 바뀌었을 수 있어서). `--json`에는 `recordsChanged: true`가 있고 `summary`는 없다. `runs`의 결과 칸 끝에도 `records changed`가 붙는다. 실제 출력(stdout, main `a191a50`):

    ```
    Warning: this plan run has a records-changed mark: something other than the run changed its records, so this plan may not be the one the run made.
    Plan of run 20261112T200122Z-4f73c4b0: 3 action(s), pending
    Digest: f660f1db888b62a3a7862e3d91f67478b0d3a644d88e60c4442f20a8c830b1a1
      1. move     inbox/beach-2025.jpg  ->  photos/2025/beach-2025.jpg
      2. move     inbox/receipt-2026.pdf  ->  documents/2026/receipt-2026.pdf
      3. discard  inbox/old-draft.tmp  (kept in .codaryn/discarded/ until removed)
    This plan cannot be applied. Make the plan again with a new run (codaryn run), read the new plan, and apply that one.
    The digest names exactly these actions and the contents the plan's files had when the plan was made. The apply refuses if the plan or one of its files changed since, and when the plan run has a records-changed mark. The digest does not cover the run's other records.
    ```

    한국어 설정에서 경고는 `경고: 이 계획 실행에는 기록 변경 표시가 있습니다. 실행이 아닌 것이 기록을 바꿔, 이 계획이 실행이 만든 계획과 다를 수 있습니다.`, 적용할 수 없다는 줄은 `이 계획은 적용할 수 없습니다. 새 실행(codaryn run)으로 계획을 다시 만들고, 새 계획을 확인한 뒤 그것을 적용하세요.`다.
  - 그 계획의 `apply --digest`는 아래와 같이 끝나고 파일은 그대로다(실제 출력, stderr, main `a191a50`). 고치는 법은 `codaryn run`으로 계획을 새로 만들라고 한다. `codaryn plan`은 계획을 보여 주기만 한다.

    ```
    codaryn: error — the plan run has a records-changed mark: something other than the run changed its records, so its plan may not be the one you read; nothing was asked or changed (plan_records_changed)
      To fix: Make the plan again with a new codaryn run (codaryn plan only shows a plan), read the new plan, and apply that one. The marked run stays as evidence of what happened.
    ```

  - 확인
    - main `a7f3a2f`, 파일 정리 체험: 계획 실행 뒤 다른 실행의 허용한 명령이 그 계획 실행의 `result.json`을 고치자 계획 실행에 표시가 붙었다. 그 계획의 `apply --digest`는 `plan_records_changed`로 끝났고 파일은 그대로였다. 같은 task로 계획을 새로 만들어 적용하자 `done`/`verified`였다.
    - main `a191a50`: 위의 두 블록은 계획 실행 폴더에 기록 변경 표시 파일(`records-changed.json`)을 직접 두고 본 것이다(두 언어). 표시를 붙이는 감지 자체는 다시 돌리지 않았다.

  - 표시가 있는 실행은 무슨 일이 있었는지의 증거로 남긴다. `cleanup` 미리보기는 그 기록에 `the run has a records-changed mark; its records are evidence of what happened`를 붙인다(경고만 하고 따로 확인을 받지는 않는다).
- **`--run`은 계획 실행 id로 꼭 준다.** `--run latest`는 받지 않는다(`invalid_arguments`). 승인이 계획 하나를 가리켜야 하기 때문이다.
- **적용 때의 정책:** 정책, 검증기, 가릴 값은 계획을 만들 때가 아니라 **적용할 때**의 task와 설정에서 읽는다.
  - 동작마다 지금 정책(`policy.planActions`, 보호 경로)으로 다시 판정한다.
  - 계획 뒤에 원본이 바뀌었거나 없어졌으면 아무것도 옮기지 않고 `failed`/`plan_stale`(종료 1)이다. 정책이 거부한 동작이 있어도 같다.
  - 작업 공간 파일이 파일 목록 확인의 상한을 넘어도 `plan_stale`이다. `plan`이 이 경우를 미리 알린다.
- **적용 순서:** 잠금 → 사전 점검(파일 목록, 모든 동작) → 계획 순서대로 이동·폐기 → 파일 목록 확인(`inventory`, 두 번째 목록과 비교) → task 검증기. 목록 횟수와 취소는 16절 "큰 작업 공간의 파일 목록"
  - 이동은 대상에 파일이 있으면 하지 않는다(덮어쓰지 않음). 대상의 부모 폴더는 만든다.
  - **폐기는 지우지 않는다.** `.codaryn\discarded\<적용 실행 id>\`로 옮긴다.
  - 중간에 한 동작이 실패하면 그 뒤 동작은 하지 않고 `failed`/`apply_incomplete`(종료 1)다. 이미 한 동작은 `revert`로 되돌린다.
- **한 번만 적용된다:** 적용을 시작하면 계획에 `applied.json`이 생긴다. 같은 계획을 다시 적용하면 `plan_already_applied`(종료 2)다. 다시 하려면 되돌린 뒤 계획 실행부터 새로 한다.
- 다른 종류의 실행 id를 주면 `run_not_plan`(종료 2)이다. `workflowRef`가 없어 `plan: "apply"`로 해석되지 않는 task로 적용해도 같다.
- **취소:** `--cancel-file`(작업 공간 밖) 또는 Ctrl+C. 상태는 `cancelled`(5)다.
  - 동작을 시작하기 전에 취소되면 아무것도 옮기지 않고 계획도 적용되지 않은 채로 남아, 다시 `apply`할 수 있다.
  - 동작을 시작한 뒤라면 하던 동작은 끝내고 멈춘다. 계획은 적용된 것으로 남으므로 이미 한 동작은 `revert`로 되돌린다.
- **결과 읽기:** `report`는 계획 실행(동작 수, 다이제스트)도, 적용 실행(승인 경로와 동의, 사전 점검, 동작, 검증, 되돌리기 명령)도 읽는다(18.2절). stdout JSON과 `runs`도 같은 결과를 준다.

### 18.4 적용을 되돌리기

```powershell
node dist/src/cli/main.js revert --workspace <작업 공간> --run <적용 실행 id> [--dry-run | --allow-unsafe-move]
```

- 적용 실행을 되돌리면 이동은 원래 자리로 옮기고(`moved_back`), 폐기는 폐기 보관함에서 되살린다(`restored_from_discard`). 뒤의 동작부터 되돌린다. 적용이 만든 폴더는 남긴다.
- **계획 실행을 `revert`하면(U-16):** 계획 실행은 스스로 파일을 바꾸지 않으므로 되돌릴 것이 없다(`complete`, 종료 0). 그 계획을 적용한 실행이 있으면 stderr에 그렇다는 줄과, 위 실행 목록의 상태에 맞는 줄이 붙는다. 되돌리라고 하는 것은 `applied`와 `unfinished`일 때뿐이다. 실제 출력(main `4010905`, `--dry-run`, 상태마다 둘째 문장):
  - 공통 첫 문장: `This run only made a plan and changed no file itself, so it has nothing of its own to put back and it is not marked as reverted.`
  - `applied`, `unfinished`: `To undo the changes of its plan, revert the run that applied it (--run <적용 실행 id>).`
  - `applying`: `The run that applies its plan (<id>) has no result yet: it is still going, or it stopped. Look at that run before you revert anything.`
  - `reverted`: `The run that applied its plan (<id>) has already been reverted: nothing of it is left to undo.`
  - `record_missing`: `The run that applied its plan (<id>) has no readable records in this workspace any more, so Codaryn cannot revert it.`
  - 적용한 적이 없는 계획 실행이면 이 줄들이 없다.
  - 한국어는 `이 실행은 계획만 만들었고 파일을 직접 바꾸지 않아, 되돌릴 것이 없으며 되돌린 것으로 표시하지 않습니다.`로 시작한다.
- 원래 자리에 다른 파일이 생겼으면 덮어쓰지 않고 건너뛴다(`original_path_taken`). 옮긴 파일이 그 뒤 바뀌었으면 `changed_since_run`이다. 하나라도 건너뛰면 `partial`(종료 3)이다.
- 적용이 동작 도중 멈췄으면, 시작 기록만 있는 동작도 실제 파일 상태를 보고 되돌린다. 상태가 분명하지 않으면 건드리지 않고 `changed_since_run`으로 알린다.
- **계획 실행의 폴더가 필요하다.** 실제 경로는 계획 실행의 `plan.json`에서 읽는다.
  - 그 폴더나 `plan.json`을 지웠으면 아무것도 바꾸지 않고 `plan_run_missing`(종료 2)으로 끝난다. 실제 출력(stderr):

    ```
    codaryn: error — the plan run this apply used has no record (plan.json) any more, so nothing was changed (plan_run_missing)
      To fix: An apply can be reverted only while its plan run is kept. Restore that run's folder if you removed it.
    ```

  - `plan.json`이 승인한 다이제스트와 다르게 바뀌었으면 `invalid_run_record`로 끝나고 아무것도 바꾸지 않는다. 18.8을 본다.

### 18.5 하드 링크가 없는 드라이브: 위험한 이동에 대한 동의

이동과 폐기는 하드 링크를 만든 뒤 원본을 지우는 방식으로 한다. 그래서 대상에 파일이 있으면 실패하고 덮어쓰지 않는다. FAT32·exFAT처럼 하드 링크가 없는 드라이브에서는 이 보장이 없다. 대상이 비었는지 확인하고 이름을 바꾸는 사이에 생긴 파일을 덮을 수 있다. 그래서 기본으로는 옮기지 않는다.

- **적용:** 사전 점검이 그런 이동을 찾으면 아무것도 옮기지 않고 `needs-input`/`consent_required`(종료 3)로 끝난다. 계획은 소모되지 않는다. 끝 요약(실제 출력, 일부):

  ```
  ── Result: needs input — some moves could replace a file, so they wait for a person's consent; nothing was moved (needs-input/consent_required) ──
  Actions applied: 0 of 3
  Not applied: moves that could replace a file: 3. Nothing was moved.
  Consent for this apply only: codaryn apply --task <task.json> --run 20261112T055816Z-69d6cb14 --digest <digest> --allow-unsafe-move
  ```

- **동의:** 그 적용 한 번에만 유효하고, 사람의 입력으로만 받는다.
  - `apply … --allow-unsafe-move`
  - 터미널에서는 `consent_required`로 끝난 직후 한 번 묻는 `[y/N]`에 예라고 답한다. 예이면 동의를 붙여 적용 실행을 하나 더 한다.
  - task 파일, 설정 파일, 프로필, 환경 변수, 계획, 모델은 동의를 줄 수 없다. task나 설정에 그런 필드를 두면 `invalid_task`·`invalid_config`다.
- **기록:** 동의는 적용 실행의 첫 기록(`apply_started.unsafeMoveConsent`)에 남는다. 그렇게 한 이동은 결과의 `applied[].unsafe`가 `true`다. 진행 줄에 `consent to moves that could replace a file — approved by a command-line argument`가 나온다.
- **되돌리기도 같다.** 동의 없이 되돌리면 그 파일들을 `unsafe_move`로 건너뛰고(`partial`) 다음 명령을 알려 준다. `revert … --allow-unsafe-move`로 그 되돌리기 한 번에 동의한다.
  - 동의한 되돌리기는 `Files moved back with your consent in a way that could replace a file: <수>`를 알리고, 되돌리기 기록에 동의가 남는다.
  - `--dry-run`과 함께 줄 수 없다. 미리보기는 드라이브를 판정하지 않으므로, 미리보기에서 되돌릴 수 있다고 나온 파일도 실제로는 건너뛸 수 있다.
- 확인 범위: 위 출력은 하드 링크 만들기가 실패하도록 흉내 낸 프로세스에서 확인했다. 실제 FAT32·exFAT 드라이브에서는 아직 확인하지 않았다(16절). 터미널 질문(적용 승인과 동의의 `[y/N]`)은 stdin·stderr를 터미널로 표시한 프로세스에 답을 넣어 확인했고, 실제 콘솔 창에서는 확인하지 않았다.

### 18.6 사람 확인 (`review`)

`analyze`처럼 끝나는 방식이 `human_review`인 작업 종류는 검증기를 모두 통과해도 `done`이 아니라 `needs-input`/`awaiting_review`(종료 3)로 끝난다. 끝 요약에 확인할 항목이 나온다(실제 출력, 일부):

```
── Result: needs input — waiting for a person's review (needs-input/awaiting_review) ──
Checks passed: 1 of 1 (within the configured checks)
Items to check: 2
  - The report's interpretation matches the result table.
  - No input data the goal names is missing from the analysis.
Record a verdict: codaryn review --task <task.json> --run 20261112T055815Z-425804d4 --accept or --reject
```

```powershell
node dist/src/cli/main.js review --task <task.json> --run <실행 id> --accept --note "합계를 원본과 대조했다"
node dist/src/cli/main.js review --task <task.json> --run <실행 id> --reject
```

- 판정은 그 실행의 `review.json`에 쓴다. 다시 판정하면 앞의 판정을 바꾸고 `(an earlier review was replaced)`가 붙는다.
- 실행의 `result.json`은 바뀌지 않는다. 판정해도 실행이 `done`이 되지는 않는다.
- 메모는 500자 이하다. 키 모양이 있으면 `key_in_file`이고, 등록한 가릴 값은 가려서 저장한다.
- `awaiting_review`로 끝나지 않은 실행이면 `run_not_awaiting_review`(종료 2)다. `--run latest`를 받으므로, 고른 실행 id(stderr)가 본 실행과 같은지 확인한다.
- `report`의 `Review checklist` 절이 확인 항목과 판정을 보여 준다. 판정 전에는 `No verdict yet.`, 판정 뒤에는 예를 들어 `Verdict: **rejected** (`2026-11-12T05:58:15.969Z`)`이고, 그 뒤에 판정을 바꾸는 명령 줄(`A later review replaces it: …`)이 붙는다(18.9절). 판정은 그 실행의 `review.json`에 있다.
- 확인 항목은 작업 종류가 정한다. task의 `humanReview.checklist`로 바꿀 수 있다.
- 사람 확인은 사람의 판단을 기록할 뿐이다. 보고서의 해석이나 분석 방법을 Codaryn이 확인하지는 않는다.
- 결과 표의 형태와 집계는 `data_checks` 검증기로 확인한다(규칙은 [CLI·공통 계약](cli-contract.md)과 `src/contracts/verify.ts`).

### 18.7 개인정보가 든 자료는 다루지 않는다

- `read_file`과 `search_files`는 표의 행을 그대로 모델에 보낸다. 가려지는 것은 등록한 가릴 값(12절)뿐이다. 이름, 연락처 같은 개인정보는 가려지지 않는다.
- 원자료 행을 모델에 보내지 않고 집계만 돌려주는 도구는 아직 없다. 그 전까지 개인정보가 든 표나 문서는 어떤 작업 종류로도 작업 공간에 두지 않는다. `analyze`를 포함한다.
- 파일 정리(`organize`)는 파일 내용을 모델에 보내지 않는다. `inspect_files`는 경로, 크기, 수정 시각, 요청하면 해시만 준다. 그래도 파일 이름과 폴더 이름은 모델에 간다. 이름에 개인정보가 있으면 그 값을 가릴 값으로 등록하거나 그 폴더를 작업 공간에서 뺀다.
- 이미지나 오피스 문서 같은 바이너리 파일도 내용을 읽지 않고 옮길 수 있다.

### 18.8 기록 폴더와 폐기 보관함 정리 (`cleanup`)

`codaryn cleanup`이 상태 디렉터리(`.codaryn\`)의 실행 기록과 폐기 보관함을 보이고 지운다. 기본은 미리보기이고 아무것도 지우지 않는다.

```powershell
# 요약과 고르는 예(아무것도 고르지 않음)
node dist/src/cli/main.js cleanup --workspace D:\work\notes
# 미리보기: 30일보다 오래된 실행 기록을 고르고, 경고와 다이제스트를 본다
node dist/src/cli/main.js cleanup --workspace D:\work\notes --older-than 30
# 지우기: 같은 고르기에 미리보기의 다이제스트(앞 12자 이상)를 준다
node dist/src/cli/main.js cleanup --workspace D:\work\notes --older-than 30 --confirm <digest>
```

- **고르기**
  - 실행 기록: `--older-than <일>`, `--run <id>[,<id>…]`, `--reverted`(마지막 되돌리기가 완전했던 실행만)
  - 폐기 보관함: `--discarded-older-than <일>`, `--discarded-run <id>[,<id>…]`
  - 한 부분의 기준을 모두 만족하는 것이 골라진다. 기준이 없는 부분은 아무것도 고르지 않는다. 실행 id는 정확히 쓴다(`latest`는 받지 않는다).
- **확인은 셋이고, 뒤의 둘은 `--confirm`과 함께만 받는다.**
  - `--confirm <digest>`: 미리보기가 보인 계획 그대로일 때만 지운다. 미리보기 뒤에 새 실행이나 되돌리기로 상태가 바뀌었거나 다른 미리보기의 다이제스트면 오류 `cleanup_plan_changed`(종료 2)이고 아무것도 지우지 않는다. 다시 미리 본다.
  - `--include-not-reverted`: 되돌리지 않았거나 일부만 되돌린 실행, 기록을 확인할 수 없는 실행의 기록을 지운다. 없으면 그 기록은 남고(`not_reverted_not_confirmed`) 나머지만 지워진다. 나머지에서 하나라도 지웠으면 종료 0, 하나도 지우지 못했으면 `nothing_removed`(종료 3)다. 남은 적용 실행이 쓰는 계획 실행도 함께 남는다. 지운 실행은 더는 되돌릴 수 없다.
  - `--delete-discarded`: 고른 폐기 보관함(사람의 파일)을 지운다. 없으면 폐기 보관함은 남고, 그 폐기 보관함을 만든 적용 실행의 기록도 남는다(DR-53, `discarded_left`). 파일의 원래 이름과 자리는 그 기록에만 있기 때문이다. 그 적용 실행이 쓰는 계획 실행도 함께 남는다(`used_by_kept_apply`). 이 기록은 같은 정리에서 그 폐기 보관함을 고르고 `--delete-discarded`를 줄 때, 또는 그 적용을 먼저 되돌린 뒤에 지워진다. 다른 것을 하나라도 지웠으면 종료 0, 하나도 지우지 못했으면 `nothing_removed`(종료 3)다.
- **미리보기는 무엇을 주면 무엇이 지워지는지로 묶는다**(U-86, UXM-10). 묶음은 이 순서이고, 항목이 있는 묶음만 머리 줄이 나온다.
  1. `--confirm`만으로 지우는 것(앞선 정리가 남긴 폴더도 여기)
  2. `--include-not-reverted`도 주어야 지우는 것: 되돌리지 않았거나 일부만 되돌렸거나 기록을 확인할 수 없는 실행. 머리 줄이 지우면 되돌릴 수 없다는 것을 말한다.
  3. `--delete-discarded`도 주어야 지우는 것: 폐기 보관함. 머리 줄이 사람의 파일이며 되살릴 수 없다고 말한다.
  4. 둘 다 주어야 지우는 것: 되돌리지 않은 적용 실행과 그 계획 실행 등. 머리 줄이 위의 두 경고를 다 말한다.
  5. 이 선택에서는 무엇을 확인해도 남는 것: 폐기 보관함이 남는 적용 실행과 그 계획 실행.
  - 그 뒤에 지울 수 없는 것(돌고 있는 실행, 결과가 없는 실행, 고르지 않은 적용이 쓰는 계획 실행)이 `Cannot be removed in this cleanup: <수>. …` 아래 따로 나온다.
  - 항목 줄은 `- <종류> <이름>: <크기>`다. 경고는 그 아래 한 줄씩이고, 남는 항목은 남는 까닭 한 줄이다.
  - 끝에 명령이 둘까지 나온다. `--confirm`만으로 지우는 것이 있으면 `--confirm <다이제스트 앞 12자>`, 다른 옵션이 필요한 항목이 있으면 그 옵션을 모두 붙인 명령이다. 두 번째 명령에는 `--include-not-reverted`가 붙을 수 있다. 그대로 붙여 넣으면 되돌리지 않은 실행의 기록이 지워진다(그 묶음의 머리 줄이 말하는 것).
  - 묶음의 수는 그 옵션으로 실제 지워지는 수와 같았다(검토 R-76·R-76b, 18가지 선택 × 네 옵션 조합).
  - 아무것도 고르지 않으면 요약 뒤에 고르는 예 두 줄(`--older-than 30`, `--reverted`)이 나온다. 앞선 정리가 남긴 폴더가 있으면 그 묶음과 명령도 그 위에 나온다.
- 3절 체험을 두 번 실행하고 처음 것만 되돌린 작업 공간에서 `--older-than 0` 미리보기의 실제 출력(stdout, main `bc3305d`. 실행 id와 다이제스트는 실행마다, 기록의 바이트 수는 판마다 다르다):

```
Run records: 2 (31145 bytes)
Discarded files (people's own files an apply set aside): 0 (0 bytes)
Files a revert could not put back (.codaryn/parked/, never cleaned up): 0 (0 bytes)

Removed with --confirm alone: 1 (15671 bytes)
- run 20261113T015938Z-b4e55869: 5 file(s), 15671 bytes
Removed only with --include-not-reverted besides: 1 (15474 bytes). These are runs not reverted, only partly reverted, or whose records cannot be checked. Their records go only with a confirmation of their own; without them those runs can no longer be reverted or put back by hand.
- run 20261113T015939Z-96f785fb: 4 file(s), 15474 bytes
  not reverted: without its records it can no longer be reverted

Nothing was removed. To remove what needs no other option, run the same command with --confirm 4612d2674054
Nothing was removed. To remove all of the above but what is kept, run the same command with --confirm 4612d2674054 --include-not-reverted
```

  - 첫 명령(`--confirm`만)이면 `Removed: run records 1, discarded-files folders 0, 15671 bytes`이고 종료 0이다. 되돌리지 않은 실행은 `- run <id>: not reverted or only partly reverted, and removing it was not confirmed apart`로 남는다.
  - 남은 것이 그 실행뿐일 때 다시 `--confirm`만 주면 첫 줄이 `Nothing was removed.`이고 종료 3(`nothing_removed`)이다.
  - 둘째 명령(`--include-not-reverted`까지)이면 `Removed: run records 2, discarded-files folders 0, 31145 bytes`이고 종료 0이다.
- 파일 정리의 적용(폐기 하나)이 있는 작업 공간(main `bc3305d`의 실제 출력):
  - `--older-than 0`만 고르면 두 실행 모두 "남는 것"이고 명령은 나오지 않는다.

    ```
    Kept in this selection, whatever is confirmed: 2. An apply run's records go once its discarded files are deleted in the same cleanup (with their folders selected and --delete-discarded) or the apply is reverted first; only the records say what the files were. A plan run goes with its apply run.
    - run 20261113T015941Z-0ed0cf10: 2 file(s), 6161 bytes
      its discarded files stay, and only its records say what each file was called and where it was
    - run 20261113T015941Z-2766ed4d: 4 file(s), 7821 bytes
      a plan run whose apply run is kept; without it that apply could not be reverted
    ```

  - `--discarded-older-than 0`을 더하면 보관함은 셋째 묶음, 되돌리지 않은 적용 실행과 그 계획 실행은 넷째 묶음이다(요약 세 줄 다음):

    ```
    Removed only with --delete-discarded besides: 1 (1 file(s), 17 bytes), people's discarded files among them. They are people's own files and cannot be put back.
    - discarded 20261113T015941Z-0ed0cf10: 1 file(s), 17 bytes
      a discarded-files folder: people's own files are deleted
    Removed only with both --include-not-reverted and --delete-discarded besides: 2 (6 file(s), 13982 bytes). Among them are runs not reverted, only partly reverted, or whose records cannot be checked. Their records go only with a confirmation of their own; without them those runs can no longer be reverted or put back by hand. Among them are also people's discarded files. They are people's own files and cannot be put back.
    - run 20261113T015941Z-0ed0cf10: 2 file(s), 6161 bytes
      not reverted: without its records it can no longer be reverted
      an apply run with discarded files: its records are kept unless those files are deleted in the same cleanup, since only the records say what each file was called and where it was
    - run 20261113T015941Z-2766ed4d: 4 file(s), 7821 bytes

    Nothing was removed. To remove all of the above but what is kept, run the same command with --confirm d026e8ac8384 --include-not-reverted --delete-discarded
    ```

  - 그 다이제스트로 `--include-not-reverted`만 더해 확인하면 아무것도 지우지 않고 종료 3(`nothing_removed`)이다:

    ```
    Nothing was removed.
    Kept: the records of apply runs whose discarded files stay: 1. The records are the only note of what each of those files was called and where it was. They go once those applies are reverted, or when their discarded files are deleted in the same cleanup.
    - discarded 20261113T015941Z-0ed0cf10: deleting the discarded files was not confirmed
    - run 20261113T015941Z-0ed0cf10: its discarded files stay, and only its records say what each file was called and where it was
    - run 20261113T015941Z-2766ed4d: a plan run whose apply run is kept; without it that apply could not be reverted
    ```

  - `--delete-discarded`만 더하면 보관함만 지우고 종료 0이다(`Removed: run records 0, discarded-files folders 1, 17 bytes`). 두 실행은 `not reverted or only partly reverted, and removing it was not confirmed apart`와 `a plan run whose apply run is kept; without it that apply could not be reverted`로 남는다. 보관함의 파일은 되살릴 수 없게 된다.
  - 둘 다 더하면(끝의 명령) `Removed: run records 2, discarded-files folders 1, 13999 bytes`이고 종료 0이다. 바이트 수는 기록에 든 시각과 걸린 시간에 따라 실행마다 몇 바이트씩 다르다.
  - 실행 기록만 고른 경우(`--discarded-older-than` 없음)와 기록을 확인할 수 없는 적용 실행도 같은 이유로 남는다. 적용을 먼저 되돌리면(`complete`) 그 실행의 폐기 보관함 폴더는 비고, `--older-than 0`의 확인으로 두 실행의 기록이 지워진다. 빈 폴더는 남는다.
- **지우지 않는 것**: `.codaryn\parked\`(되돌리기가 제자리에 두지 못한 파일), 잠금, `.gitignore`, 돌고 있는 실행(`lock_held`, 적용 중이면 `workspace_locked`), 결과가 없는 실행(`no_result`), 고르지 않은 적용이 쓰는 계획 실행. 상태 디렉터리 안의 링크를 따라 밖을 지우지 않는다.
- **다 지우지 못한 경우**: 권한이나 다른 프로그램 때문에 지우기가 중간에 실패하면 그 항목은 `partly_removed`로 남고 정리는 `partly_failed`(종료 1)다. 남은 것은 `.codaryn\cleanup-<16자리 16진수>\`에 정리의 표지와 함께 남고, 다음 미리보기의 `Removed with --confirm alone` 묶음에 `- leftover cleanup-<16자리 16진수>: …` 항목으로 나와 `--confirm`으로 지운다(고르는 옵션이 없어도 나온다). 표지가 없는 같은 이름 꼴의 폴더는 정리의 것이 아니므로 지우지 않고, 요약에 한 줄로만 보인다: `Unknown folders (.codaryn/cleanup-…, named like a cleanup's leftover but without its mark; never removed): 1 (2 bytes)`(한국어 `알 수 없는 폴더(…, 지우지 않음)`). 이전 판(main `6f85b65`~`5396225`)의 정리가 남긴 폴더도 표지가 달라 이렇게 보이고, 지금은 정리로 지울 수 없다(검토 R-40 낮음, store 담당 다음 단위).
- **기록을 확인할 수 없는 실행**(결과 기록이 깨진 실행 등)은 항목 아래에 `records cannot be checked: whether it changed files or was reverted is not known, and removing them may remove the last copies of those files` 줄이 붙고, `--include-not-reverted`도 주어야 지우는 묶음에 든다.
- 지운 것은 `.codaryn\cleanup.jsonl`에 개수와 바이트만 남는다(이름과 경로는 없다).
- `--json`이면 `kind:"cleanup"` JSON 한 줄이고, `status`가 한 일을 말한다(DR-48): `preview`(종료 0), `removed`(하나라도 지움, 0), `nothing_removed`(지운 것이 없음, 3), `partly_failed`(지우기가 일부 실패, 1). `outcome.ok`는 `removed`일 때만 `true`다. 다이제스트가 다르면 정리 JSON이 아니라 오류 JSON(`kind:"error"`, `cleanup_plan_changed`, 종료 2)이다. 터미널 질문은 없다. 지우는 길은 다이제스트 확인뿐이다.
- 한국어 출력은 묶음 머리 줄, 항목의 종류와 크기, 끝 줄까지 한국어다(U-34, U-86). main `bc3305d`의 위 미리보기에서는 `--confirm 옵션만으로 지우는 것: 1개(15671바이트)`, `- 실행 기록 <실행 id>: 파일 5개, 15671바이트`, `아무것도 지우지 않았습니다. 다른 옵션이 필요 없는 것만 지우려면 같은 명령에 다음을 붙여 다시 실행하세요: --confirm <앞 12자>`였다. 넷째 묶음의 머리 줄은 `--include-not-reverted 옵션과 --delete-discarded 옵션을 둘 다 주어야 지우는 것: …`이다.
- 확인 범위: 위 미리보기와 확인 결과(네 옵션 조합), 고르지 않은 요약은 main `bc3305d`의 실제 CLI다. `status`와 종료 코드(`removed`, `nothing_removed`, 지우기 거부 ACL로 만든 `partly_failed`, 틀리거나 낡은 다이제스트의 `cleanup_plan_changed`)는 U-22 판(main `b2dad78`에 U-22의 네 브랜치를 더한 것)에서 확인했고, U-86은 확인 뒤의 출력과 `--json`을 바꾸지 않았다(검토 R-76, R-76b). 지우지 않는 것과 다 지우지 못한 경우는 판 `39df2ba`에서(검토 R-34·R-34b·R-34c), 알 수 없는 폴더의 줄과 기록을 확인할 수 없는 실행의 줄은 main `a7f3a2f`에서, 이전 판이 남긴 폴더는 `7556be6`(검토 R-40)에서 실제 CLI로 확인했다.
- **계획 실행의 기록**은 그 계획의 적용 실행을 되돌리는 데 필요하다. 손으로 지우면 그 적용은 되돌릴 수 없다(`revert`는 `plan_run_missing`, 종료 2). 적용 실행의 stdout JSON과 `runs --json`의 `planRunId`가 어느 계획 실행인지 알려 준다.

### 18.9 키 없이 체험하기: 자료 분석

[`examples/analyze-demo/`](../examples/analyze-demo)는 키 없이 `analyze` 작업 종류를 끝까지 보는 예시다. 합성 판매 표 `sales.csv`(지역, 품목, 금액 여섯 줄)의 금액을 지역별로 더해 `summary.csv`와 `report.md`를 만든다. 대본은 처음에 east의 합계를 틀리게 쓰고, `data_checks` 검증기가 그것을 잡아 재수정 한 번으로 고친다. 검증을 통과하면 `done`이 아니라 사람 확인을 기다린다(18.6절).

```powershell
# 저장소 루트에서, 2절의 빌드를 마친 뒤. 복사본은 저장소 밖이어야 한다
$an = "$HOME\codaryn-analyze-demo"
Copy-Item -Recurse examples\analyze-demo $an
node dist/src/cli/main.js doctor --task $an\task.json
node dist/src/cli/main.js run --task $an\task.json
node dist/src/cli/main.js report --workspace $an\workspace --run latest
node dist/src/cli/main.js review --task $an\task.json --run latest --accept --note checked-by-hand
node dist/src/cli/main.js runs --workspace $an\workspace
```

- `doctor`는 모든 항목이 `ok`나 `skipped`이고 종료 0이다. 키도 설정 파일도 필요 없다.
- **검증기 둘**(`task.json`):
  - `data_checks`(`summary-table`): `summary.csv`의 열이 정확히 `region`, `total`이고 데이터 행이 3개인지(`table_shape`), `sales.csv`의 `amount`를 `region`별로 더한 값이 `summary.csv`의 `total`과 같은지(`aggregate_match`, 열쇠 열 `region`).
  - `file_rules`(`report`): `report.md`가 있고 `# 지역별 판매 합계`를 담는지.
  - `sales.csv`는 보호 경로다(`protectedPaths`). 재수정은 1회까지다(`maxRepairAttempts: 1`).

**run:** stderr의 실제 출력이다(main `28696fa`, `CODARYN_LANG=en`). 실행 id와 시간은 실행마다 다르다. 종료 코드는 3(`needs-input`)이다.

```
codaryn: run started — provider scripted
codaryn: protected material check — unchanged (run_start)
codaryn: turn 1
codaryn: read file — allowed (read_file)
codaryn: turn 2
codaryn: write file — allowed (write_file)
codaryn: created summary.csv
codaryn: turn 3
codaryn: write file — allowed (write_file)
codaryn: created report.md
codaryn: turn 4
codaryn: check #1 — not passed (fail)
codaryn: check #2 — passed (pass)
codaryn: repair 1 — checks not passed: 1
codaryn: turn 5
codaryn: write file — allowed (write_file)
codaryn: changed summary.csv
codaryn: turn 6
codaryn: check #1 — passed (pass)
codaryn: check #2 — passed (pass)
codaryn: finished — needs input (awaiting_review)
── Result: needs input — waiting for a person's review (needs-input/awaiting_review) ──
Checks passed: 2 of 2 (within the configured checks)
Protected material checks that found no change: 5
Files changed: 2
  summary.csv (created)
  report.md (created)
Usage: model turns 6 · tool calls 4 · 0.1 s
The agent's last message (the agent's own words, not a verified fact):
  | east의 합계를 85로 고쳤다.
Look at the result and record a verdict with codaryn review.
Run id: 20261113T025019Z-d83b9b61
Report: codaryn report --workspace <workspace> --run 20261113T025019Z-d83b9b61
Revert: codaryn revert --workspace <workspace> --run 20261113T025019Z-d83b9b61
Items to check: 2
  - The report's interpretation matches the result table.
  - No input data the goal names is missing from the analysis.
Record a verdict: codaryn review --task <task.json> --run 20261113T025019Z-d83b9b61 --accept or --reject
```

- `check #1 — not passed (fail)`: 첫 회차의 `data_checks`다. 그 근거는 진행 줄에 나오지 않고 기록(`journal.jsonl`의 첫 `verifier_result`)에 있다. 그 근거가 가린 뒤 재수정 메시지로 모델에 간다(9절). 실제 근거:

  ```
  held: table "summary.csv" (csv) has exactly the columns ["region", "total"] and has exactly 3 data rows (columns as required; 3 data rows)
  not held: sum of "amount" in "sales.csv" (csv) grouped by "region" matches "total" in "summary.csv" (csv) (key column "region") within absolute 1e-9, relative 1e-9 (target data row 3 (group first seen at source data row 5): recomputed 85, found 80)
  ```

  - 근거는 열 이름, 행 번호, 비교한 두 수만 말한다. 표의 다른 칸 값은 담지 않는다([민감정보 처리](privacy.md) 15절).
- `Items to check`: 내장 `analyze`의 확인 항목이다. 고정된 영어 글이라 한국어 설정에서도 영어로 나온다(16절 "출력 언어").
- 고친 뒤 `summary.csv`는 `region,total` / `north,150` / `south,125` / `east,85`다.
- 한국어(`CODARYN_LANG=ko`) 끝 요약의 마지막 줄들은 `결과를 확인하고 codaryn review로 판정을 기록하세요.`, `확인할 항목 2개:`, `판정 기록: codaryn review --task <task.json> --run <id> --accept 또는 --reject`다.

**report:** `--run latest`가 고른 실행의 보고서다. 검증 절과 사람 확인 절(판정 전):

```
## Verification

- verifier 1 (data_checks): **pass**
  - checked: `table "summary.csv" (csv) has exactly the columns ["region", "total"] and has exactly 3 data rows`
  - checked: `sum of "amount" in "sales.csv" (csv) grouped by "region" matches "total" in "summary.csv" (csv) (key column "region") within absolute 1e-9, relative 1e-9`
- verifier 2 (file_rules): **pass**
  - checked: `"report.md" exists`
  - checked: `"report.md" contains the literal text "# 지역별 판매 합계"`

Repairs started: 1.

## Review checklist

The run waits for a person's verdict (`codaryn review --run 20261113T025019Z-d83b9b61 --accept | --reject`).
- `The report's interpretation matches the result table.`
- `No input data the goal names is missing from the analysis.`

No verdict yet.
```

- 보고서의 "Not checked" 절은 `data_checks`가 확인하지 않는 것(방법, 해석, 글 속의 숫자, 표의 읽기 규칙)을 검증기마다 적는다.

**review:** 결과 표와 보고서를 직접 본 뒤 판정을 기록한다. stdout(종료 0):

```
Review of run 20261113T025019Z-d83b9b61: accepted.
  1. The report's interpretation matches the result table.
  2. No input data the goal names is missing from the analysis.
The run's result and records are unchanged; `codaryn report` shows the verdict.
```

- 판정은 `review.json`에만 남는다. 실행의 상태는 그대로 `needs-input`/`awaiting_review`이고, `runs`도 그렇게 보인다. 결과 칸 끝에는 판정이 붙는다(한국어 `검토: 받아들임`). `runs --json`의 그 항목에는 `review`(`verdict`, `at`)가 있다. 메모는 `report`에만 나온다:

  ```
  run id (UTC)               started (local)      changes  result
  20261113T045806Z-27e1337b  2026-11-13 13:58:06  2        needs input (needs-input/awaiting_review) · review: accepted
  ```

- 판정 뒤 보고서의 사람 확인 절은 다음과 같다(U-131). 판정 전과 달리 `The run waits …` 줄이 없고, `No verdict yet.` 자리에 판정 줄이, 그 뒤에 판정을 바꾸는 명령 줄이 온다. 이 블록과 위 `runs` 표는 main `cd1cace`에서 다시 돌린 실행이라 실행 id와 시간이 위와 다르다.

  ```
  ## Review checklist

  - `The report's interpretation matches the result table.`
  - `No input data the goal names is missing from the analysis.`

  Verdict: **accepted** (`2026-11-13T04:58:06.648Z`), note: `checked-by-hand`
  A later review replaces it: `codaryn review --run 20261113T045806Z-27e1337b --accept | --reject`.
  ```

  - 처음 실행(`20261113T025019Z-d83b9b61`, main `28696fa`)의 판정 줄은 ``Verdict: **accepted** (`2026-11-13T02:50:19.833Z`), note: `checked-by-hand` ``였다.
- 한국어 `review` 출력의 첫 줄은 `실행 <id>의 검토: 받아들임.`이다.
- 자기 표로 해 볼 때는 `task.json`의 목표와 검증기 경로·열 이름을 바꾸고, 실제 모델 설정(4절)으로 돌린다. 개인정보가 든 표는 쓰지 않는다(18.7절).
- 확인 범위: 위 출력은 main `28696fa`의 실제 CLI를 저장소 밖의 복사본에서 돌린 것이다(키 없음, 대본 모델). 판정 뒤의 `runs` 표와 보고서는 main `cd1cace`에서 다시 돌렸다. 그때 run·report(판정 전)·review의 블록은 실행 id와 시간 말고는 위와 같았다.

### 18.10 사용자 정의 작업 종류 체험

[`examples/workflow-demo/`](../examples/workflow-demo)는 설정 파일에 작업 종류 하나를 정의하고(18.1절 "사용자 정의 작업 종류") task가 그것을 고르는 예시다. 키 없이 대본 모델로 돈다.

`config.json`(설정 파일, 작업 공간 밖)의 정의:

```json
"release-notes": {
  "label": "Release notes",
  "tools": ["read_file", "write_file"],
  "instructions": "CHANGES.txt의 줄을 읽어 RELEASE-NOTES.md를 쓴다. add: 줄은 ## 더한 것, fix: 줄은 ## 고친 것 아래에 둔다. CHANGES.txt는 바꾸지 않는다.",
  "policy": { "commands": [], "network": "deny", "destructive": "deny", "restorePathTokens": false, "protectedPaths": ["CHANGES.txt"] },
  "verifiers": [
    { "id": "notes", "kind": "file_rules", "rules": [
      { "type": "exists", "path": "RELEASE-NOTES.md" },
      { "type": "contains", "path": "RELEASE-NOTES.md", "text": "## 더한 것" },
      { "type": "contains", "path": "RELEASE-NOTES.md", "text": "## 고친 것" }
    ] }
  ],
  "limits": { "maxModelTurns": 6, "maxToolCalls": 6 }
}
```

- 위는 `"workflows": { … }` 안의 한 항목을 줄여 옮긴 것이다(파일은 줄마다 펼쳐 썼다).
- `task.json`은 `"workflowRef": "release-notes"`로 이 정의를 고른다. task 자신의 `verifiers`는 비어 있다. 정의의 검증기는 늘 돈다(DR-43 (a)).
- 이 정의의 도구는 `read_file`과 `write_file`뿐이다. 모델에는 이 둘만 보이고, 다른 도구를 부르면 거부된다.
- 지시문(`instructions`)은 고정 시스템 글 뒤에 붙어(가린 뒤) 모델에 간다.

```powershell
$wf = "$HOME\codaryn-workflow-demo"
Copy-Item -Recurse examples\workflow-demo $wf
node dist/src/cli/main.js doctor --task $wf\task.json --config $wf\config.json
node dist/src/cli/main.js run --task $wf\task.json --config $wf\config.json
node dist/src/cli/main.js report --workspace $wf\workspace --run latest
```

**run:** stderr의 실제 출력이다(main `28696fa`, `CODARYN_LANG=en`, 종료 0):

```
codaryn: run started — provider scripted
codaryn: protected material check — unchanged (run_start)
codaryn: turn 1
codaryn: search files — rejected by a check of the call (unknown_tool)
codaryn: turn 2
codaryn: read file — allowed (read_file)
codaryn: turn 3
codaryn: write file — allowed (write_file)
codaryn: created RELEASE-NOTES.md
codaryn: turn 4
codaryn: check #1 — passed (pass)
codaryn: finished — done (verified)
── Result: done — every configured check passed (done/verified) ──
Checks passed: 1 of 1 (within the configured checks)
Protected material checks that found no change: 3
Files changed: 1
  RELEASE-NOTES.md (created)
Denied calls: 1
Usage: model turns 4 · tool calls 2 · 0.1 s
The agent's last message (the agent's own words, not a verified fact):
  | RELEASE-NOTES.md를 썼다.
Read the report, and revert if needed.
Run id: 20261113T025137Z-78bbf85d
Report: codaryn report --workspace <workspace> --run 20261113T025137Z-78bbf85d
Revert: codaryn revert --workspace <workspace> --run 20261113T025137Z-78bbf85d
```

- `search files — rejected by a check of the call (unknown_tool)`: 대본이 정의에 없는 `search_files`를 불렀다. 작업 종류의 도구 밖이라 실행하지 않았고, 거부는 실행을 끝내지 않고 모델에 돌아간다. 한국어는 `파일 검색 — 호출 검사에서 거부 (unknown_tool)`이다.
- `check #1`: 정의의 검증기 `notes`다. task에는 검증기가 없지만 정의의 것이 돌았다.
- `doctor`는 `[ok]      config file               the config file given by --config is valid`를 포함해 모두 `ok`나 `skipped`이고 종료 0이다.
- `report`의 머리에 `` - Task: `workflow-demo` (task type `release-notes`) ``가 나온다.
- **설정 파일을 빼면** 작업 종류를 찾지 못한다. `run --task $wf\task.json`(`--config` 없음)은 종료 2이고 stderr는 다음과 같다:

  ```
  codaryn: error — the task file cannot be read or has an invalid value (invalid_task)
    To fix: Check that the file given with --task exists and is outside the workspace. If a field is named, fix that field. codaryn doctor --task <file> checks it.
    Check: codaryn doctor
    The task type given (with --workflow or in the task file) is neither built in nor defined in the config file; check its name.
  ```

- **task는 정의의 도구를 줄이기만 한다.** task에 `"tools": ["read_file", "write_file", "run_command"]`를 더하면 실행 전에 `invalid_task`(종료 2)이고, stdout JSON의 `message`는 `tools[2] names a tool the workflow definition does not offer (tools only narrow)`다.
- 간편 형식에서는 `--workflow release-notes`로 고른다. 그때는 모델·키·한도도 설정 파일에서 오므로 실제 모델 설정(4절)이 필요하다. 이 예시는 task 파일 형식만 보인다.
- 확인 범위: 위 출력은 main `28696fa`의 실제 CLI를 저장소 밖의 복사본에서 돌린 것이다(키 없음, 대본 모델).
