# Codaryn 사용 안내

Codaryn CLI를 실제 작업에 쓰는 방법이다. 설명은 현재 코드 동작 기준이며 세부 규칙은 [CLI·공통 계약](cli-contract.md)이 기준이다.

> 오프라인 검증(유닛, 프로세스 통합)과 로컬 가짜 서버를 쓴 모의 API 검증만 통과했다. 실제 Anthropic API와 실제 OpenAI API로는 아직 검증하지 않았다. 처음에는 [키 없이 체험하기](#3-키-없이-체험하기)로 흐름을 익히고, 실제 작업 전에 [실제 호출 점검](#14-실제-호출-점검)을 한다.

처음 쓰는 순서: 설치(2절) → 기본 설정 만들기 `init`(4절) → 실행 전 점검 `doctor`(7절) → 키 없는 체험(3절) → 결과 읽기 `runs`·`report`(10절) → 되돌리기 `revert`(11절). 체험은 `init` 없이도 된다. 워크플로를 고르는 범용 작업(파일 정리의 계획 확인 → 적용 → 되돌리기, 자료 분석의 사람 확인)은 18절이다.

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

**run:** stdout에는 결과 JSON 한 줄, stderr에는 진행 줄과 끝 요약이 나온다(8절). 아래는 stderr의 실제 출력이다. 실행 id와 시간은 실행마다 다르다.

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
codaryn: protected material check — unchanged (before_verify)
codaryn: check #1 — not passed (fail)
codaryn: protected material check — unchanged (after_verify)
codaryn: repair 1 — checks not passed: 1
codaryn: turn 5
codaryn: write file — allowed (write_file)
codaryn: changed summary.md
codaryn: turn 6
codaryn: protected material check — unchanged (before_verify)
codaryn: check #1 — passed (pass)
codaryn: protected material check — unchanged (after_verify)
codaryn: finished — done (verified)
── Result: done — every configured check passed (done/verified) ──
Checks passed: 1 of 1 (within the configured checks)
Files changed: 1
  summary.md (created)
Denied calls: 1
To allow a command, add a rule to policy.commands in the task file. Fixing its arguments as well is recommended.
Usage: model turns 6 · tool calls 3 · 0 s
Read the report, and revert if needed.
Run id: 20261112T030342Z-42ed82a7
Report: codaryn report --workspace <workspace> --run 20261112T030342Z-42ed82a7
Revert: codaryn revert --workspace <workspace> --run 20261112T030342Z-42ed82a7
```

- `protected material check — unchanged`: 보호 경로(`notes.md`)가 실행 시작 때와 같은지 확인한 결과다(13절).
- `run command — denied (command/command_not_allowed)`: 허용 목록이 비어 있어 명령이 거부됐다. 거부는 실행을 끝내지 않고 모델에 돌아간다. 끝 요약의 `Denied calls`와 그 아래 안내가 이것이다. task 파일 실행이므로 안내는 task 파일의 `policy.commands`를 가리킨다.
- `check #1 — not passed (fail)` → `repair 1`: 검증 실패 근거를 모델에 돌려보내 다시 고치게 했다(9절). 검증기는 id가 아니라 순번으로 나온다.
- 끝 요약의 `Files changed`는 바뀐 파일 수다. `summary.md`를 두 번 썼어도 파일은 하나다.
- stdout의 JSON은 `status` `done`, `reason` `verified`, `exitCode` 0이다. `changes`에는 `summary.md`의 생성과 변경 두 건, `usage.repairAttempts`는 1이다. JSON의 한글은 `\uXXXX`로 나오므로 PowerShell에서 `$r = node dist/src/cli/main.js run --task $demo\task.json | ConvertFrom-Json`처럼 바로 변수로 받을 수 있다.
- `init`으로 기본 설정을 만든 뒤라면(4절) 두 줄이 더 나온다: 진행 줄 `codaryn: using the config file in the default location: %APPDATA%\Codaryn\config.json`과 요약 줄 `Used the config file in the default location: %APPDATA%\Codaryn\config.json`. `init`의 기본 한도는 이 예시의 한도보다 크므로 실행 결과는 같다.

**runs:** 작업 공간의 실행 목록이다(10절). 실제 출력:

```
run id                     started              changes  result
20261112T030342Z-42ed82a7  2026-11-12 12:03:42  1        done (done/verified)
```

시작 시각은 지역 시간이다. `changes`는 실행이 바꾼 서로 다른 파일 수다. 이 체험은 `summary.md`를 두 번 썼으므로 결과 JSON의 `changes`에는 두 건이 있지만 목록에는 1로 나온다(끝 요약의 `Files changed`와 같다).

**report:** `--run latest`는 가장 최근 실행을 고른다. 고른 실행은 stderr에 먼저 나온다.

```
codaryn: Chose the latest run: 20261112T030342Z-42ed82a7 (started 2026-11-12 12:03:42)
```

stdout은 사람이 읽는 Markdown 요약이다(10절). 이 체험에서는 `Provider: scripted (scripted model; no API was called)`, 검증기 1번 **pass**, `Repairs started: 1`, 보호 대상 확인 5회와 변경 없음, 변경 두 건, `Tool calls: 3 of 8 (denied: 1)`, 검사하지 않은 범위가 나온다. 보고서도 검증기를 순번(`verifier 1`)으로 쓴다. id는 `--json`에만 있다.

**revert --dry-run:** 아무것도 바꾸지 않고 무엇을 되돌릴지 보인다. stdout은 `"dryRun":true`가 붙은 결과 JSON 한 줄이고 종료 코드는 실제 되돌리기와 같다(0). stderr:

```
codaryn: Chose the latest run: 20261112T030342Z-42ed82a7 (started 2026-11-12 12:03:42)
codaryn: Files to revert: 1 (preview, nothing changed) (complete)
  summary.md — deleted (created by this run)
Run again without --dry-run to revert.
```

**revert:** 실행이 만든 `summary.md`를 지운다. 결과는 `"status":"complete"`, `"reverted":[{"path":"summary.md","action":"deleted"}]`, 종료 0이다. `.codaryn/`의 기록은 남는다. stderr:

```
codaryn: Chose the latest run: 20261112T030342Z-42ed82a7 (started 2026-11-12 12:03:42)
codaryn: Files reverted: 1 (complete)
  summary.md — deleted (created by this run)
```

같은 실행을 한 번 더 되돌리면 할 일이 없다. `complete`, 종료 0이고 `skipped[].reason`은 `already_reverted`, 결과에 이전 되돌리기의 시각과 상태(`revertedBefore`)가 붙는다. 실행 목록의 그 줄에는 `· reverted (complete)`가 붙는다. stderr:

```
codaryn: Chose the latest run: 20261112T030342Z-42ed82a7 (started 2026-11-12 12:03:42)
codaryn: Files reverted: 0 (complete)
Files skipped: 1
  summary.md — already as it was before the run (already_reverted)
This run was already reverted before, so its files may show as changed since the run. (complete, 2026-11-12 12:03:53)
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
- 터미널에서 실행하면 모델(키가 있을 때 목록을 받아 고름), 한도, 명령 허용과 보호 경로 제안(`--workspace`를 줄 때), 언어를 하나씩 묻는다. 명령 허용 제안의 기본 답은 "아니오"다. 터미널 대화는 이 문서 작성 때 확인하지 않았다.
- 터미널이 아니면 묻지 않고 기본값만 쓴다. 실제 출력(stdout, 종료 0):

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
- 출력과 문구에는 펼친 경로 대신 `%APPDATA%\Codaryn\config.json` 같은 고정 표기만 나온다.

### 설정 파일을 찾는 순서

`--config` → `CODARYN_CONFIG` → 기본 위치. 앞의 것이 있으면 뒤의 것은 보지 않는다. 기본 위치에 파일이 없으면 설정 파일 없이 실행한다. 기본 위치의 설정을 쓴 실행은 진행 줄과 끝 요약에 그 사실을 한 줄씩 남긴다(3절). 기본 위치의 파일도 작업 공간 안이면 거부한다(5절).

### 키

- 키는 제공자마다 정해진 환경 변수로만 받는다: Anthropic은 `ANTHROPIC_API_KEY`, OpenAI는 `OPENAI_API_KEY`(아래 "두 번째 제공자: OpenAI"). 한 제공자의 키는 그 제공자의 주소로만 간다. Windows 사용자 환경 변수에 등록하는 것이 기본이다: `rundll32 sysdm.cpl,EditEnvironmentVariables`로 창을 열어 사용자 변수 `ANTHROPIC_API_KEY`를 더하고 새 터미널을 연다(`init`이 같은 안내를 한다. `init`은 Anthropic 키만 안내한다). 키 파일을 자동으로 읽는 기능은 없다.
- 작업 공간 밖의 변수 파일에 적고 `--vars-file <경로>`로 읽을 수도 있다. 변수 파일은 이 옵션을 줄 때만 읽고 자동으로 찾지 않으며, 이미 설정된 환경 변수가 파일 값보다 우선한다.
- **`--env-file`은 쓰지 않는다.** Node 26이 그 이름을 스스로 먼저 읽는다. 파일이 없으면 CLI가 시작되기 전에 Node 오류(종료 코드 9)로 끝나고, 있으면 Node가 읽은 뒤 CLI가 `invalid_arguments`로 거부한다.
- 변수 파일 만들기: `New-Item -ItemType Directory -Force D:\codaryn-settings`와 `Copy-Item .env.example D:\codaryn-settings\.env`로 만들고 편집기에서 값을 채운다. BOM 없는 UTF-8로 저장한다(BOM이 있으면 `invalid_config`). 메모장의 "UTF-8"은 BOM이 없고, PowerShell 5.1의 `Set-Content -Encoding utf8`은 BOM을 붙인다.
- **변수 파일이 새로 설정한 값은 비밀로 등록되어** 파일 내용, 명령 출력, 기록에 나타나면 가려진다. 예외는 이미 설정돼 있던 변수(Windows는 이름의 대소문자 무시), `CODARYN_CONFIG`와 제공자별 모델·주소 변수(`CODARYN_MODEL`, `CODARYN_API_BASE_URL`, `CODARYN_OPENAI_MODEL`, `CODARYN_OPENAI_API_BASE_URL`), 8자 미만 값이다. 비밀로 등록된 값은 실행하는 명령의 환경에도 넘어가지 않는다(12절).
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

**확인 범위:** 실제 OpenAI API로는 점검하지 않았다. OpenAI의 공식 문서로 확인한 사실([사실 확인](design/second-provider-facts.md))과 로컬 가짜 서버로만 확인했다. 아래 출력은 main `3e36b1b`의 실제 CLI를 가짜 키와 루프백 가짜 서버로 실행한 것이다. 14절의 실제 호출 점검은 Anthropic용만 있다.

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
run id                     started              changes  result
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
| `policy`, `verifiers` | 간편 형식과 한 줄 실행에서만 쓴다. task 파일은 자기 값을 쓴다 |
| `secretEnv` | 비밀로 등록할 환경 변수 이름. task의 것에 더해진다 |
| `integrity.paths` | 작업 공간 밖 검증 자료(기준 테스트 등)의 절대 경로. 실행 중 바뀌면 `needs-input`/`protected_changed`([계약 15절](cli-contract.md#15-단계-3-계약-u-1u-3-u-5-u-6)) |
| `language` | 사람용 글의 언어 `"ko"` 또는 `"en"`(8절) |
| `profiles` | 이름 → `policy`·`verifiers`·`limits`·`workflowRef` 묶음. `--profile <이름>`으로 고른다(아래) |
| `workflows` | 사용자 정의 워크플로. id → 정의(18.1절) |

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
- 간편 형식과 한 줄 실행에서는 프로필의 `policy`·`verifiers`가 설정의 것을 대신하고, `limits`는 설정 `limits` 위에 필드별로 덮인다. task 파일 실행에서는 프로필의 한도만 상한으로 쓴다.
- 프로필의 한도는 설정 최상위 `limits`보다 클 수 없다. 파일을 읽을 때 모든 프로필을 검사하므로, 고르지 않은 프로필 하나가 넘어도 `invalid_config`다. 오류는 이름 대신 순번으로 위치를 말한다(`profiles[1].limits.maxModelTurns`).
- 프로필을 쓴 실행은 끝 요약에 `A profile was applied (--profile).`가 붙는다. 이름은 나오지 않는다.
- 그 이름의 프로필이 없으면 `run`은 `invalid_config`다. 프로필은 사용자 설정 파일에만 있고 task 파일은 프로필을 가질 수 없다.

**task 파일 필드:** 모르는 필드가 있으면 `invalid_task`다. task·설정 파일은 BOM이 있어도 읽는다.

- `schemaVersion`(1), `id`(영문·숫자·`.`·`_`·`-`, 1~64자), `goal`(작업 목표), `workflow`(표시용 문자열).
- `workspaceRoot`: task 파일 위치 기준 상대 경로 또는 절대 경로. 도구가 접근할 수 있는 루트는 이 하나뿐이다.
- `model`: `{"provider":"anthropic"}`에 선택 필드 `model`, `maxOutputTokens`. 키 없는 시험은 `{"provider":"scripted","scriptPath":"<대본 파일>"}`(3절)이다.
- 그리고 `policy`(`protectedPaths` 포함, 13절), `privacy.secretEnv`, `limits`, `verifiers`.
- 범용 작업(18절): `workflowRef`(워크플로 선택), 그 워크플로 안에서 좁히는 `tools`, `plan`, `completion`, `humanReview`, 파일 정리의 계획 행동 허용 `policy.planActions`(`move`, `discard`). 없으면 지금까지와 같이 실행된다.

**한도(`limits`):**

- 예산 한도 넷은 재수정을 포함한 실행 전체에 적용한다: `maxModelTurns`, `maxToolCalls`, `maxTotalTokens`(모든 요청의 입력과 출력 토큰 합), `maxDurationMs`. 처음에는 낮게 두고 결과의 `usage`를 보며 올린다.
- 재수정 한도 둘(9절): `maxRepairAttempts`(0 이상, 기본 0)와 `maxSameFailures`(1 이상, 기본 2). 두 파일 모두에서 생략할 수 있다.
- **설정 파일의 한도는 상한이다.** task는 필드마다 그 값 이하만 정할 수 있고, 넘으면 `invalid_task`다. 설정이 숫자인데 task가 `maxTotalTokens: null`을 주어도 `invalid_task`다. 예산 한도가 어디에도 없으면 task 형식은 `invalid_task`, 간편 형식은 `invalid_config`다.
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
- 항목은 Node.js 버전, 설정 파일, 변수 파일, task 파일, API 키, 모델, 한도, 파일 위치, 허용 명령(실행 때와 같은 규칙으로 찾고 판정), 작업 공간, 설치 위치, 보호 자료 경로, 메시지 언어, 작업 공간 잠금이다. 줄마다 상태(`[ok]`, `[warning]`, `[failed]`, `[skipped]`)와 이유가 나온다. `--json`의 점검 id와 상태 값(`ok`, `warn`, `fail`, `skipped`)은 영어로 고정이다.
- 종료: 가장 나쁜 항목이 `ok`(또는 `skipped`)면 0, `fail`이면 1, `warn`이면 3이다. 인자 오류는 `invalid_arguments`(종료 2)다. `--task`와 `--workspace`를 함께 주면 이 오류다.
- 키는 있음·없음만 적고 값은 내지 않는다. 파일이나 환경에서 읽은 값도 내지 않는다. 키가 있으면 그 키를 보낼 주소와, 그 주소를 정한 곳(제공자의 주소 변수, 설정 필드, 기본값)을 함께 적는다. 예: `OPENAI_API_KEY is set; openai requests send it to https://api.openai.com, the default address`.
- 설정 파일 항목은 그 파일을 어디서 받았는지 적는다. 기본 위치면 위 예처럼, `--config`로 주면 `the config file given by --config is valid`다.
- 프로필이나 task 파일이 워크플로를 고르면, 그 워크플로의 규칙이 설정의 정책에서 빼는 것을 허용 명령 항목 아래에 알린다(18.1절 "정책 합치기"). 설정 정책에 명령 규칙 하나(`node --test`)와 `restorePathTokens: true`가 있고 프로필 `tidy`가 `workflowRef: "organize"`일 때 `doctor --workspace … --profile tidy`의 실제 출력 일부(main `23daf6b`):

```
[skipped] allowed commands          no command is allowed and no command check is configured
                                    a run of this workflow leaves out command rules of the configured policy: 1
                                    a run of this workflow does not restore path tokens, although the configured policy allows it
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

**사람용 출력(stderr):** stdout은 늘 JSON 한 줄이고, 사람이 읽는 글은 stderr에 나온다.

- 진행 줄: `codaryn: `로 시작한다. 실행 시작, 턴 번호, 도구 허용·거부(사람 말 뒤 괄호에 `권한/코드`), 만들거나 바꾼 파일, 검증 결과(검증기 순번), 재수정 회차, 보호 대상 확인, 종료 상태. 모델 응답과 도구 결과의 내용은 쓰지 않는다.
- 끝 요약: 상태와 이유, 통과한 검증 수, 바뀐 파일 수와 목록(5개까지), 거부된 호출 수와 허용 방법, 사용량(턴, 도구 호출, 초), 기본 설정·프로필 사용 여부, 실행 id, 다음 명령(`report`, `revert`). 예시는 3절.
- 오류 설명: 무엇이 잘못됐는지, 위치(6절 "오류 위치"), 고치는 법, 코드. 실행 전 오류에도 나온다. 오류 JSON의 영어 `message`는 stdout에만 있다. 예:

```
codaryn: error — the model provider is not fully configured (key, model, output limit), so nothing was sent (provider_not_configured)
  To fix: Run codaryn doctor to see what is missing, including the provider's key variable; choose the model with codaryn models --use.
  Check: codaryn doctor
```

- 이 예는 키도 모델도 없는 상태(`init` 직후)의 `run --workspace … --goal …`이다(main `3e36b1b`, `CODARYN_LANG=en`). 빠진 것(어느 키 변수인지 포함)은 stdout JSON의 `message`와 `doctor`가 알린다(`not set: ANTHROPIC_API_KEY; the model …`).

- **`--quiet`**: `run`과 `revert`가 받는다. 진행 줄, 끝 요약, 오류 설명을 모두 생략한다. stdout의 JSON은 그대로다.

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

`run`의 stdout에는 JSON 한 줄만 나온다. 비 ASCII 문자는 `\uXXXX`로 나오므로 어느 코드 페이지에서도 JSON으로 읽힌다.

- **실행이 시작되었으면 `kind:"run"`:** `runId`, `status`, `reason`, `exitCode`, `journalPath`, `notices`, `verifiers`(검증기별 `outcome`, `evidence`, `checked`, `limits`), `changes`(적용한 파일 변경과 해시), `usage`(턴, 도구 호출, 토큰, 시간, 재수정 수). 보호 대상이 있으면 `protectedChanged`(바뀐 보호 경로 목록)도 있다.
- **되돌리기는 `kind:"revert"`**(11절). **시작 전에 멈췄으면 `kind:"error"`:** `code`, `exitCode`, `message`, 선택 `diagnostic`(6절). 메시지에는 값 대신 필드 이름만 적힌다.
- `report`, `doctor`, `models`, `init`, `runs`는 기본이 사람이 읽는 글이고 `--json`이면 각각 `kind:"report"`, `"doctor"`, `"models"`, `"init"`, `"runs"` JSON 한 줄이다. 오류는 어느 명령이든 `kind:"error"` 한 줄이다.

### 실행 목록 (`runs`)

```powershell
node dist/src/cli/main.js runs --workspace D:\work\notes
node dist/src/cli/main.js runs --workspace D:\work\notes --limit 5 --json
```

- 최근 실행이 먼저 나온다(예시는 3절). `--workspace`가 없으면 현재 디렉터리, `--limit`은 1~1000(기본 20)이다. 아무것도 만들거나 바꾸지 않고 잠금도 잡지 않는다. 기록이 없으면 `This workspace has no runs.`이고 종료 0이다.
- 되돌린 실행에는 `· reverted (complete)`가 붙는다.
- 기록이 확인을 통과하지 못한 실행은 목록 뒤쪽에 실행 id와 손상 표시만 나오고 `latest`로 고르지 않는다. `.codaryn`이나 `runs`가 링크이거나 나열할 수 없으면 `invalid_run_record`(종료 2)다.

### `--run latest`

`report`와 `revert`의 `--run`에 `latest`를 주면 실행 목록의 맨 위(확인을 통과한 가장 최근 실행)를 쓴다. 무엇을 하기 전에 stderr에 고른 실행 id와 시작 시각을 쓴다(3절). `--quiet`이면 쓰지 않는다.

- 그런 실행이 없으면 `run_not_found`(종료 2)다.
- 이름이 `latest`인 실행 디렉터리가 실제로 있으면 별칭으로 풀지 않고 `invalid_arguments`(종료 2)로 끝난다. 이때는 `runs`의 실행 id를 준다.

### 보고서 (`report`)

```powershell
node dist/src/cli/main.js report --workspace D:\work\notes --run latest
node dist/src/cli/main.js report --workspace D:\work\notes --run 20261112T031500Z-9f2c41ab --json
```

- 그 실행의 `result.json`과 `journal.jsonl`(가림본)만 읽어 Markdown 요약을 낸다. 아무것도 바꾸지 않고 잠금도 잡지 않는다.
- 절: 실행 요약(실행 id, 작업, 제공자, 결과), 검증(마지막 회차와 통과하지 않은 검증기의 근거. 검증기는 순번), 보호 대상, 변경, 사용량(한도 대비, 거부된 도구 호출 수), 검사하지 않은 범위.
- 종료: `complete`(0)는 두 파일을 모두 읽음, `incomplete`(3)는 `result.json`이 없음(실행 중이거나 쓰지 못하고 멈춤)이다. 이때는 기록만으로 만들고 "Result: none"과 기록의 종료 기록을 적는다.
- 오류(종료 2): 그 runId의 기록이 없으면 `run_not_found`, 기록을 읽거나 해석할 수 없으면 `invalid_run_record`, 작업 공간이 없으면 `workspace_not_found`다.
- 보고서는 이 두 파일만큼만 믿을 수 있다. 상태 디렉터리는 파일 도구에만 닫혀 있으므로, 실행 중 허용된 명령이 기록을 바꿀 수 있다.
- 계획 실행은 행동 수와 다이제스트를, 사람 확인을 기다리는 실행은 확인 항목과 판정을 함께 보여 준다(18.6절). 적용 실행은 따로 만든 형식(`# Codaryn apply run report`)으로 보여 준다(18.2절).

| 종료 코드 | 뜻 |
| --- | --- |
| 0 | `done`: 모든 검증기 통과. 되돌리기 `complete`, 보고서 `complete`, 점검 `ok`, 모델 목록 `listed`·`selected`, `init` `created`, `runs` `listed`, `plan` 보기, `review` 판정 |
| 1 | `failed`: `verifier_failed`, `repeated_failure`, `model_error`, `state_changed`(16절 "실행 기록 변조"), 적용의 `plan_stale`·`apply_incomplete`(18.3절). 점검 `fail`. 정리에서 지우지 못하고 남긴 항목(`partly_removed` 등, 18.8절) |
| 2 | 입력 오류: `invalid_arguments`, `invalid_task`, `invalid_config`, `invalid_script`, `key_in_file`, `secret_env_missing`, `workspace_not_found`, `workspace_is_install_dir`, `run_not_found`, `invalid_run_record`, `config_write_failed`, `config_exists`, `run_not_plan`, `plan_not_approved`, `plan_already_applied`, `plan_secrets_differ`, `plan_records_changed`, `plan_run_missing`, `run_not_awaiting_review` |
| 3 | `needs-input`: `no_verifier`, `verifier_inconclusive`, `unknown_tool_outcome`, `protected_changed`, `plan_pending`, `awaiting_review`, `consent_required`(18절). 되돌리기 `partial`, 보고서 `incomplete`, 점검 `warn`, `init` `declined`, 정리의 `plan_changed`(미리보기 뒤 상태가 바뀜, 18.8절) |
| 4 | `budget-exhausted`: `max_model_turns`, `max_tool_calls`, `max_total_tokens`, `max_duration`, `usage_unknown` |
| 5 | `cancelled` |
| 6 | `workspace_locked`: 같은 작업 공간에서 다른 실행이나 되돌리기가 진행 중 |
| 7 | `provider_not_configured`: 키·모델·출력 상한 미설정(자리표시자 모델 포함). 전송 없음 |
| 8 | `model_list_failed`: `models`의 API 요청 실패 |
| 70 | `internal_error` |

작업 공간의 `.codaryn/` 폴더:

- `runs/<runId>/journal.jsonl`: 한 줄에 사건 하나. `run_started`, `model_request`, `model_response`, `model_error`, `tool_decision`, `tool_result`, `file_changed`, `verifier_result`, `repair_started`, `integrity_checked`, `run_finished`. 가림본만 담는다.
- `runs/<runId>/result.json`: stdout과 같은 객체.
- `runs/<runId>/revert.json`: 마지막 되돌리기의 시각과 상태(11절).
- `runs/<runId>/snapshots/`: 실행이 파일 도구로 바꾼 파일의 변경 전 원문(11절). **가림본이 아니다.**
- `runs/<계획 실행 id>/plan.json`, `applied.json`: 제안된 계획(행동과 원본 해시)과 적용 표시(18.3절). 계획 실행의 폴더는 그 적용을 되돌리는 데 필요하다(18.8절).
- `runs/<runId>/review.json`: 사람 확인의 판정(18.6절).
- `discarded/<적용 실행 id>/`: 파일 정리에서 폐기한 **사람의 파일**(18.8절). 실행 기록이 아니다.
- `lock.json`: 실행 중 잠금. 기록된 프로세스가 이미 끝났으면 다음 실행이 회수한다.

도구는 `.codaryn/` 안을 읽거나 쓸 수 없다. 거부된 도구 호출은 `tool_result`의 `errorCode`(`policy_denied`, `protected_span_violation`, `conflict` 등)와 `tool_decision`의 `code`(`protected_path`, `command_not_allowed` 등)로 남는다.

### 변경 보기 (`changes`)

```powershell
node dist/src/cli/main.js changes --task <task.json> --run <runId|latest> [--json]
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

- 글은 **지금 등록된 비밀로 가린 것**이다. 쓰기 도구가 실행 때 가린 표기의 다이제스트를 기록해 두고, 지금 다시 가린 글이 그것과 같을 때만 글을 보인다. 비밀 자리는 토큰으로 보인다. 예: 비밀로 등록한 값이 든 줄은 `+ - [[CODARYN_SECRET:f44831dde79cb2f6]] 개편은 다음 주에 시작한다.`처럼 나온다.
- 다음 경우에는 그 파일의 경로와 상태만 보이고(JSON의 `unavailable`은 `masking_unverified`), 머리에 그 사실을 한 줄로 알린다.
  - 실행 뒤에 파일이 바뀌었을 때(상태 `changed_since_run`). 예: 위 실행 뒤 `summary.md`에 한 줄을 더하면
    ```
    no text for some files: a file's text is shown only when the secrets registered now mask it as the run did and the file is as the run left it; the others have their path and state only (DR-29)
    == summary.md: created by the run; changed again since the run
       the text is not shown (masking_unverified)
    ```
  - 지금 등록된 비밀의 값이 실행 때와 달라 가린 결과가 다를 때. 상태는 `as_run_left` 그대로다.
  - 이 기록이 없는 실행(쓰기 도구가 다이제스트를 남기기 전의 실행).
- `--json`이면 `kind:"changes"` JSON 한 줄이고, 파일마다 `before`·`after`(가린 글 또는 `null`)와 `unavailable`(글이 없는 이유 또는 `null`)이 있다.
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
  - `missing_snapshot`: 원문이 없다. 경로에 등록된 비밀이 든 파일도 여기에 해당한다.
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

## 12. 비밀 등록과 가려지는 범위

- `privacy.secretEnv`(task)나 `secretEnv`(설정)에는 환경 변수 **이름**만 적는다. 값은 실행할 때 환경에서 읽는다(`--vars-file`로 읽은 값 포함). 값이 없으면 `secret_env_missing`이다.
- 다음 값은 자동으로 비밀로 등록된다.
  - 실행이 쓰는 제공자의 키(길이와 관계없이)
  - 다른 제공자의 키 변수 값 중 20자 이상인 것. 예: openai 실행에서 `ANTHROPIC_API_KEY` 값이 작업 공간 파일에 있으면 모델에 가려져 간다. 20자 미만이면 등록하지 않는다(`x` 같은 자리표시자가 흔한 글자를 가리지 않게)
  - 변수 파일이 새로 설정한 값(4절)
- **가리는 범위:** 모델에 보내는 내용과 실행 기록 전체. 목표, 파일 내용, 경로, 명령 출력, 검증 근거, 오류 문구가 모두 해당한다.
- **가리는 형태:** 원문, Base64(패딩 유무, URL 문자 집합), URL 인코딩(대·소문자), JSON 이스케이프, 16진(대·소문자), 여러 줄 비밀의 LF와 CRLF 표기. 가려진 자리는 토큰으로 보이고, 대응표는 실행 중 메모리에만 있다. 공백, 줄바꿈, 영폭 공백 같은 보이지 않는 문자로 끊긴 비밀도 가린다. 키 같은 값(4절 "키")이면 `.`이나 이체 선택자 같은 다른 문자로 끊긴 것도 가린다. 키 같지 않은 값이 그런 문자로 끊긴 것은 가리지 않는다(16절 "키 거부와 가림의 빈틈").
- 비밀이 든 줄을 모델이 고치거나 옮기는 변경은 전체가 거부된다(`protected_span_violation`). 다른 줄은 고칠 수 있다.
- 실행하는 명령의 환경에는 `PATH`, `PATHEXT`, `SYSTEMROOT`, `WINDIR`, `COMSPEC`, `TEMP`, `TMP`, `TMPDIR`, `HOME`, `USERPROFILE`, `LANG`만 넘어간다. 키는 넘어가지 않고, 값에 등록된 비밀이 든 변수도 넘기지 않는다. 그래서 변수 파일로 설정한 8자 이상의 값(예: 긴 `PATH`)은 명령에 전달되지 않는다.

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
- 허용 목록에 없는 명령은 `command_not_allowed`로 거부되고 실행은 계속된다(3절 체험의 2번째 턴). 끝 요약이 거부 수와 고칠 곳(task 파일이면 task의 `policy.commands`, 간편 형식·한 줄 실행이면 설정 파일이나 프로필)을 알린다. `doctor`의 허용 명령 항목으로 허용한 명령을 실행 때와 같은 규칙으로 찾을 수 있는지 미리 본다(7절).

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

자세한 내용은 [tests/live/README.md](../tests/live/README.md)를 본다. 키는 미리 사용자 환경 변수에 등록해 둔다(이 점검은 변수 파일을 쓰지 않는다).

```powershell
npm run build
$env:CODARYN_LIVE = "1"
$env:CODARYN_MODEL = "<모델 ID>"
node --test dist/tests/live/anthropic-live.js
```

- 모델 ID는 `models`(4절)로 확인한다.
- 이 점검은 Anthropic용이다. OpenAI용 실제 호출 점검은 아직 없다(4절 "두 번째 제공자: OpenAI").
- 임시 폴더 문서에 절 하나를 추가하는 작업을 실행하고 `done`인지, stdout·stderr·기록에 키가 없는지 확인한다. 세 변수 중 하나라도 없으면 아무것도 보내지 않고 "건너뜀"으로 끝난다. 고정 상한: 턴 4, 도구 호출 4, 출력 1024토큰/요청, 총 30000토큰, 3분, HTTP 요청 최대 8건.

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
- [ ] 작업 공간 안의 비밀 값을 `secretEnv`로 등록했다.
- [ ] 검증기가 성공 조건을 실제로 확인한다(테스트 명령, 파일 규칙).
- [ ] 재수정은 모델이 쓴 코드를 실행해도 되는 작업 공간에서만 켰다.
- [ ] 한도를 낮게 시작했다. 실행 뒤 `report`로 결과와 `changes`를 확인한다.
- [ ] 실행 기록은 `codaryn cleanup`으로 미리 본 뒤 지운다. `--include-not-reverted`와 `--delete-discarded`는 잃는 것을 읽고 따로 준다(11절, 18.8절).
- [ ] 개인정보가 든 표나 문서는 작업 공간에 두지 않는다(18.7절).

## 16. 알려진 한계

알려진 한계를 이 절에 모은다. 범용 작업(18절)의 한계도 여기에 있다.

- **검증기와 재수정:** 재수정을 켜면 명령형 검증기가 모델이 쓴 코드를 실행하고 그 출력(가린 뒤)이 모델에 돌아간다. 명령 허용 목록이 비어 있어도 마찬가지다.
- **OS 격리 없음:** 허용한 명령과 검증기 명령은 사용자 권한으로 실행된다. 작업 공간 밖 파일 접근과 네트워크 사용을 OS 수준에서 막지 않는다.
- **비밀이 든 줄:** 수정, 이동, 삭제할 수 없다. 사람이 직접 고친다. 그 줄 앞뒤의 다른 줄을 바꿔 여러 줄에 걸친 식의 의미가 달라지는 것은 막지 못한다.
- **남는 자손 프로세스:** 명령이 끝난 뒤에도 분리되어 떠 있는 자손 프로세스(예: 백그라운드로 띄운 서버)는 남을 수 있다.
- **스냅샷:** 원문이라 비밀이 있을 수 있고, 실행된 명령이 읽을 수 있다. 보관 기간 관리가 없으므로 `cleanup`으로 미리 본 뒤 지운다(18.8절). 손으로 지우면 계획 실행을 잃어 그 적용을 되돌릴 수 없게 될 수 있다.
- **개인정보:** 표와 문서의 내용은 그대로 모델에 간다. 등록한 비밀 말고는 가리지 않고, 원자료 대신 집계만 보내는 도구가 아직 없다(18.7절).
- **하드 링크가 없는 드라이브:** FAT32·exFAT처럼 하드 링크가 없는 드라이브에서는 파일 정리의 이동과 그 되돌리기를 기본으로 하지 않는다. 사람이 그 적용·되돌리기 한 번마다 `--allow-unsafe-move`로 동의해야 하고, 동의하면 "대상에 생긴 파일을 덮어쓰지 않는다"는 보장이 없다(18.5절). 이 경로는 하드 링크 만들기가 실패하도록 흉내 낸 환경에서만 확인했고, 실제 FAT32·exFAT 드라이브에서는 확인하지 않았다.
- **키 거부와 가림의 빈틈(사용자 결정 DR-45):** 키가 든 입력의 거부(4절 "키")와 실행 중 가림(12절)에 남은 것이다. main `6df2eae`의 실제 CLI(대본 모델)로 확인했다.
  - **키 같지 않은 등록 값이 드문 문자로 끊긴 경우:** 짧거나 한 가지 대소문자만 쓴 값(예: `summer2026winter`)이 `.`이나 이체 선택자(U+FE0F)로 끊기면 거부도 가림도 되지 않는다. 공백, 줄바꿈, 영폭 공백으로 끊긴 것은 거부하고 가린다. 키 같은 값은 어떤 문자로 끊겨도 거부하고 가린다. 모든 등록 값에 같은 비교를 하면 평범한 글의 오탐이 늘어서, 이것은 알려진 한계로 둔다(DR-45).
    - 확인: 작업 공간 파일의 `summer20.26winter`와 `summer20` + U+FE0F + `26winter`는 모델에 그대로 갔고, 같은 값의 원문, 공백·줄바꿈·영폭 공백으로 끊긴 형태는 토큰이 됐다. 대문자·소문자·숫자가 섞인 20자 값은 다섯 가지 끊김 모두 토큰이 됐다.
    - 피하는 법: 비밀로 등록할 값이 짧거나 한 가지 대소문자뿐이면, 그 값이 이상한 문자로 끊겨 들어 있을 수 있는 파일은 작업 공간에 두지 않는다.
  - **찾지 못하는 끊김:** 등록되지 않은 키가 보이는 공백으로 끊긴 경우(`sk-proj-` 키를 공백으로 가른 목표가 통과했다, main `23daf6b`), 등록된 키가 `&#8203;` 같은 문자 참조로 끊긴 경우.
  - 키 변수에 낱말을 이은 자리표시자(예: `not-needed-for-local-server`)를 두어도 같은 낱말을 띄어 쓴 평범한 목표는 이제 멈추지 않는다(키 같은 값만 영문자·숫자로 비교한다).
- **정책에서 빠진 것의 알림이 한 줄에 길게 이어진다(DR-43 (b), 검토 R-37 낮음):** 워크플로의 규칙이 설정·task의 정책과 검증기에서 뺀 것은 실행 시작 줄 하나에 ` · `로 이어 붙는다(18.1절 "정책 합치기"의 예). 둘만 빠져도 영어 줄이 227자라 좁은 터미널에서는 여러 줄로 접혀 묻히기 쉽다. 끝 요약과 `report`에는 나오지 않는다. 실행 전에 `doctor`를 같은 옵션으로 돌려 보면 한 항목씩 나뉘어 나온다(7절). `run --workflow <id>`는 `doctor`에 같은 옵션이 없어 미리 볼 수 없다. 프로필이나 task 파일로 고르면 볼 수 있다.
- **OpenAI 제공자:** 실제 OpenAI API로는 점검하지 않았다. 추론 항목은 암호문이라 가림이 볼 수 없고, 다음 요청에 받은 그대로 다시 간다([민감정보 처리](privacy.md) "OpenAI 제공자").
- **변경 보기의 글:** `changes`는 지금 등록된 비밀로 가린 글이 실행 때와 같을 때만 글을 보인다. 실행 뒤 바뀐 파일, 비밀의 값이 바뀐 경우, 쓰기 도구가 기록을 남기기 전의 실행은 경로와 상태만 보인다(10절 "변경 보기").
- **보관함:** 폐기한 파일은 `.codaryn\discarded\`에 쌓인다. `cleanup --discarded-older-than <일> --confirm … --delete-discarded`로만 지운다(18.8절).
- **계획의 비밀 표기:** 계획 보기는 비밀이 든 경로를 실행마다 다른 토큰(`[[CODARYN_SECRET:…]]`)으로 보인다. 그래서 비밀이 둘 이상 등록되어 있으면 어느 비밀 이름의 폴더로 가는지 보기만으로 구별할 수 없다. 계획 실행의 끝 요약에 나온 다이제스트로 승인한다(18.3절).
- **계획 뒤에 등록한 비밀:** 계획 경로에 든 값을 계획 실행 뒤에 비밀로 새로 등록하면, 그 계획은 `plan_secrets_differ`로 보거나 적용할 수 없다. 계획을 새로 만든다(18.3절).
- **파일 정리의 명령 금지:** `organize`의 명령 금지는 모델이 부를 수 있는 명령에 대한 것이다. task나 설정에 사람이 둔 `command` 검증기는 적용 뒤에 실행되고, 그 검증기가 바꾼 파일은 파일 목록 확인(`inventory`)이 보지 못한다(18.1절).
- **자료 검증(`data_checks`):** 판단 불가(`inconclusive`)가 되는 경우가 둘 있다. 검증 결과의 한계 목록에도 같은 내용이 나온다.
  - 열이나, 묶은 규칙의 묶음 하나라도 값이 모두 비어 있으면 sum·min·max·mean 규칙
  - 더해 가는 합이 double 범위를 넘으면 sum·mean 규칙. 넘는지는 행 순서에 달렸다. 같은 값 `1e308, -1e308, 1e308`은 검사되고 `1e308, 1e308, -1e308`은 판단 불가다.
- **큰 작업 공간의 파일 목록:** 작업 공간의 파일 목록(상한 10만 개)을 `plan`은 한 번, `apply --digest`는 두 번(행동 앞뒤) 만든다. 터미널 질문으로 승인하면 계획을 보이기 전에 한 번 더 만든다(코드 기준, 터미널 대화는 확인하지 않았다). 파일이 아주 많으면 시간이 걸린다. 목록을 만드는 중의 취소는 목록이 끝나기를 기다리지 않는다. 파일 5만 개(목록 하나에 약 0.5초)에서 첫 목록 중에 취소 파일을 만들자 약 0.1초 뒤 `cancelled`로 끝났고 아무것도 옮기지 않았다(main `3e36b1b`).
- **보호 경로:** 파일 도구만 막는다. 명령으로 고치는 것은 막지 못하고, 무결성 확인은 사후 탐지다. 두 확인 사이에 바뀌었다가 다음 확인 전에 되돌려진 변경은 탐지하지 못한다.
- **되돌리기:** 명령이 바꾼 파일은 대상이 아니다. 실행 중 다른 프로그램이 같은 파일을 바꾸면 스냅샷이 실제 실행 전 상태와 다를 수 있다.
- **같은 실패 판정:** 숫자만 바뀌는 진전(실패 3건 → 1건)도 같은 실패로 보아 `maxSameFailures`에서 멈춘다. 임시 경로처럼 숫자가 아닌 내용이 매번 바뀌면 다른 실패로 보아 `maxRepairAttempts`와 예산 한도만 반복을 멈춘다.
- **가림의 빈틈:** 12절 목록 밖의 변형, 다른 값과 함께 인코딩된 Base64, UTF-16·CP949 출력은 가려지지 않는다. 출력 끝에서 4096바이트보다 긴 변형이 잘리면 일부가 남을 수 있다. 아주 짧은 비밀이나 변수 파일의 흔한 값(예: `postgres`)은 엉뚱한 곳까지 가릴 수 있다.
- **파일 해시 노출:** 파일 해시가 모델과 기록에 남는다. 짧은 비밀이 든 파일은 추측 검증이 가능하다.
- **쓰기 경합:** 해시 비교와 파일 교체 사이에 다른 프로그램이 쓰면 그 변경을 덮어쓸 수 있다.
- **점검:** `doctor`는 모델이 실제로 있는지 확인하지 않는다.
- **실행 기록 변조(결정 DR-38, DR-37 (b)):** `report`, `changes`, `revert`는 `.codaryn\`의 실행 기록을 믿는다. 이 폴더는 모델의 파일 도구로는 쓸 수 없지만, 허용한 명령이나 같은 사용자의 다른 프로그램은 쓸 수 있다.
  - **실행 중의 변경은 알아챈다.** 실행의 시작과 끝, 그리고 명령을 돌린 뒤마다 `.codaryn\`을 살피고, 그 실행이 쓴 것 말고 바뀐 것이 있는지 본다. 다른 것이 바뀌었으면 실행을 `failed`/`state_changed`(종료 1)로 끝내고 그 실행에 "기록이 바뀜" 표시를 남긴다. 확인(main `6df2eae`, 허용한 `node` 명령이 고침): 그 실행 자신의 기록, 이미 끝난 다른 실행의 `result.json`, `.codaryn\`에 새 파일 하나 모두 이렇게 끝났다. 끝 요약은 `the state directory was changed by something other than the run, or could not be checked (failed/state_changed)`와 "허용한 명령과 검사를 살펴보라"는 안내를 낸다.
  - 표시가 붙는 것은 그때 돌던 실행이다. 기록이 고쳐진 다른 실행에는 표시가 없다.
  - 표시가 있는 실행: `report`가 `This run has a records-changed mark: … this report may not match what happened.`를 낸다. `changes`는 파일 글을 보이지 않는다(이유는 `masking_unverified`로만 나오고 표시는 따로 말하지 않는다). `revert`는 막지 않고 파일마다 스냅숏과 다이제스트를 확인하며 JSON에 `recordsChanged: true`를 싣는다(사람용 글에는 아직 표시가 없다). `runs`는 결과 칸 끝에 표시를 붙이고, `--json`에는 `recordsChanged: true`가 있다. 실제 출력(main `bded611`):

    ```
    run id                     started              changes  result
    20261112T133827Z-be2edb3c  2026-11-12 22:38:27  0        failed (failed/state_changed) · records changed (something other than the run changed its records)
    ```

    한국어로는 `실패 (failed/state_changed) · 기록 변경됨(실행이 아닌 것이 실행 기록을 바꿈)`이다. 표시가 붙은 줄은 영어로 155자라 80칸 터미널에서는 접힌다.
  - 표시가 있는 계획 실행은 `apply`가 거부한다(`plan_records_changed`, 18.3절).
  - 실행 자신의 `journal.jsonl`에 엉뚱한 줄이 들어가면 `report`와 `changes`가 그 실행을 `invalid_run_record`로 읽지 않는다.
  - **실행이 끝난 뒤의 변경은 알아채지 못한다.** 실행이 남긴 자식 프로세스나 다른 프로그램이 끝난 실행의 기록을 고치면 표시가 붙지 않는다. 확인: 끝난 실행의 스냅숏 파일을 고치자 `runs`는 그대로였다. `revert`는 그 파일을 `snapshot missing (missing_snapshot)`으로 건너뛰고 아무것도 쓰지 않았다(다이제스트가 맞지 않아서).
  - 실행이 끝난 뒤 변경 기록 파일의 다이제스트를 지금 값으로 바꿔 넣으면, `changes`를 다른 비밀로 볼 때 실행 때 가렸던 값이 그대로 보인다(DR-37 (b)). 드러나는 값은 작업 공간 파일에 이미 있는 값이다.
  - `report`는 실행 기록만큼만 믿을 수 있다.
- **출력 언어:** `report`의 Markdown과 `models`의 표는 `CODARYN_LANG`과 관계없이 영어다. 오류 JSON의 `message`, `--json` 출력도 영어다. `plan`·`apply`·`review`·`changes`의 도움말과 적용·동의를 묻는 터미널 질문도 아직 영어다.
- **OS 언어 판단:** `CODARYN_LANG`과 설정의 `language`가 없으면 Node의 `Intl` 기본 로캘로 언어를 고른다. Windows에서는 이것이 표시 언어가 아니라 지역 형식을 따를 수 있다. 원하는 언어가 아니면 `CODARYN_LANG`이나 설정의 `language`로 고정한다(8절). Linux·macOS에서는 확인하지 않았다.
- **잠금 판정:** 프로세스 id는 다시 쓰일 수 있어서, 잠금을 쥔 프로세스가 같은 프로세스인지 시작 시각으로 함께 확인한다. 끝난 실행의 잠금은 다음 실행이 회수한다.
- **심한 부하에서의 잠금:** 시작 시각 조회(Windows PowerShell)가 5초 안에 답하지 않으면 그 잠금을 "쥐고 있음"으로 본다. 그래서 컴퓨터가 몹시 바쁠 때는 이미 끝난 실행의 잠금인데도 `workspace_locked`(종료 6)로 끝날 수 있다. 두 실행이 함께 작업 공간을 쓰지 않게 하려고 안전한 쪽으로 끝내는 것이다. 잠시 뒤 다시 실행하고, 계속되면 `doctor`의 작업 공간 잠금 항목을 본다(17절).

## 17. 문제 해결

| 코드 | 뜻과 조치 |
| --- | --- |
| `invalid_arguments` | 옵션 오류. 같은 옵션 반복, 모르는 옵션, `--env-file`, `--workspace`·`--goal` 한쪽만, 한 줄 실행 목표와 `--task` 등을 함께 씀, 작업 공간 안의 취소 파일, `doctor`의 `--task`와 `--workspace` 함께, 프로필 이름 형식, 목록에 없는 `models --use` 번호, 이름이 `latest`인 실행 디렉터리가 있는데 `--run latest`, `apply`의 `--run latest`나 형식이 틀린 `--digest`, task 파일과 `--workflow`를 함께 줌, `revert`의 `--dry-run`과 `--allow-unsafe-move`를 함께 줌 |
| Node 오류, 종료 9 | `--env-file`의 파일이 없다. `--vars-file`로 바꾼다 |
| `invalid_task`, `invalid_config` | stderr의 오류 설명이 파일과 필드(또는 줄·열)를 알려 준다(6절). 설정 상한보다 큰 task 한도, 설정 최상위보다 큰 프로필 한도, 없는 프로필, anthropic의 `maxTotalTokens: null`, 작업 공간 안의 파일, 변수 파일의 BOM, 1 MiB보다 큰 task·설정 파일(4절 "키")도 여기다 |
| `config_exists` | `init`의 대상 위치에 파일이 이미 있다. 그 파일을 고치거나, `--config`로 다른 위치를 준다 |
| `key_in_file` | task·설정 파일이나 `--goal`, 한 줄 실행 목표에서 키 필드나 키 값을 지우고 환경 변수로 옮긴다. 메시지가 어느 키 변수의 값을 찾았는지 알린다(16절 "키 거부와 가림의 빈틈") |
| `secret_env_missing` | `secretEnv`에 적은 환경 변수가 없다 |
| `workspace_not_found` | `workspaceRoot`나 `--workspace`가 있는 디렉터리가 아니다 |
| `workspace_is_install_dir` | 작업 공간(한 줄 실행이면 현재 디렉터리)이 CLI 설치 위치(이 저장소)와 겹친다. 저장소 밖으로 복사해 실행한다(3절, 5절) |
| `workspace_locked` | 다른 실행이나 되돌리기가 끝나기를 기다린다. 컴퓨터가 몹시 바쁠 때는 끝난 실행의 잠금도 이렇게 끝날 수 있으니 잠시 뒤 다시 실행한다(16절). 이 작업 공간에서 실행 중인 Codaryn이 없으면 `.codaryn/lock.json`을 지운다(오류 설명과 `doctor`의 작업 공간 잠금 항목이 같은 안내를 한다) |
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
| `invalid_run_record` | 기록을 읽을 수 없다. `runs`에서는 `.codaryn`이나 `runs`가 링크이거나 나열할 수 없을 때다. 파일 정리의 적용 실행을 되돌릴 때는 계획 실행의 `plan.json`이 승인한 다이제스트와 다르게 바뀐 경우도 여기다(18.4절) |
| `plan_run_missing` | 되돌리려는 적용 실행의 계획 실행 폴더나 `plan.json`이 없다. 그 폴더를 지웠다면 되살린다. 없으면 그 적용은 되돌릴 수 없다(18.4절, 18.8절) |
| `plan_secrets_differ` | 지금 등록한 비밀이 계획 실행 때와 다르게 계획의 경로를 가린다. 아무것도 보이거나 옮기지 않았다. 계획 실행에 쓴 task로 다시 하거나, 계획을 새로 만든다(18.3절) |
| `run_not_plan` | `plan`·`apply`에 준 실행이 계획을 제안하고 멈춘 실행(`plan_pending`)이 아니다. 또는 `apply`의 task가 `workflowRef`로 `plan: "apply"` 워크플로를 고르지 않았다. 계획 실행에 쓴 task로 한다(18.3절) |
| `plan_not_approved` | `--digest`가 없거나 그 계획의 다이제스트와 맞지 않는다. `plan`으로 다이제스트를 보고 앞 12자 이상을 준다 |
| `plan_already_applied` | 그 계획은 이미 적용됐다. 결과는 `report --run <적용 실행 id>`로 보고, 되돌리려면 `revert --run <적용 실행 id>`를 쓴다 |
| `run_not_awaiting_review` | `review`에 준 실행이 `awaiting_review`로 끝나지 않았다 |
| `plan_records_changed` | 그 계획 실행에 기록 변경 표시가 있다(`runs`의 결과 칸 끝에 `records changed`). 실행이 아닌 것이 그 기록을 바꿔 계획이 읽은 것과 다를 수 있어 아무것도 묻거나 옮기지 않았다. 계획을 새로 만들어 적용한다(18.3절) |
| `failed`/`state_changed` | 실행 중에 그 실행이 아닌 것(허용한 명령, 명령형 검증기, 다른 프로그램)이 `.codaryn\`을 바꿨다. 실행을 멈췄고 표시를 남겼다. `report`를 읽고, 허용한 명령과 검증기가 `.codaryn\`에 쓰지 않는지 본 뒤 다시 실행한다(16절 "실행 기록 변조") |
| `cleanup`의 `plan_changed`(종료 3) | 미리보기 뒤에 새 실행, 되돌리기, 남은 폴더 등으로 상태 디렉터리가 바뀌었다. 아무것도 지우지 않았다. 다시 미리 보고 새 digest로 확인한다(18.8절) |
| `cleanup`의 `partly_removed`(종료 1) | 권한이나 다른 프로그램 때문에 다 지우지 못했다. 원인을 없앤 뒤 다시 미리 보면 남은 것이 `Leftover folders to remove`로 나온다(18.8절) |
| `needs-input`/`plan_pending` | 계획을 제안하고 멈췄다. 정상이다. `plan`으로 보고 승인하면 `apply`한다(18.3절) |
| `needs-input`/`awaiting_review` | 검증을 통과했고 사람의 판정을 기다린다. 결과를 보고 `review --accept` 또는 `--reject`를 한다(18.6절) |
| `needs-input`/`consent_required` | 하드 링크가 없는 드라이브라 이동을 하지 않았다. 계획은 그대로다. 위험을 받아들이면 `--allow-unsafe-move`로 다시 적용한다(18.5절) |
| `failed`/`plan_stale` | 계획 뒤에 원본이 바뀌었거나 없어졌거나, 지금 정책이 행동을 거부했거나, 파일 목록 확인의 상한을 넘었다. 아무것도 옮기지 않았다. 계획 실행부터 다시 한다 |
| `failed`/`apply_incomplete` | 적용 도중 한 행동이 실패해 멈췄다. 이미 한 행동은 `revert --run <적용 실행 id>`로 되돌린다 |
| 되돌리기 `original_path_taken`, `unsafe_move` | 원래 자리에 다른 파일이 생겨 덮어쓰지 않았거나, 하드 링크가 없는 드라이브라 동의 없이는 옮기지 않았다(18.4절, 18.5절) |
| `done`인데 `changes`가 비어 있음 | 이번 실행은 파일을 바꾸지 않았고, 이미 조건을 만족하던 파일로 검증이 통과했다. 끝 요약의 `Files changed`가 0이다. 이전 실행을 되돌렸는지 확인한다(3절) |
| 도구 `policy_denied` | 명령이나 경로가 정책 밖이거나 보호 경로 쓰기다. `tool_decision.code`를 본다 |
| 도구 `conflict` | 파일이 모델이 읽은 뒤 바뀌었거나, 새 파일로 쓰려는 경로에 파일이 이미 있다 |
| 도구 `invalid_args` | 인자 형식 오류. `run_command.timeoutMs`가 600000을 넘는 경우도 여기다 |
| 도구 `spawn_failed` | `PATH`에서 찾지 못함(`ENOENT`), 지원하지 않는 형식, 작업 공간 안의 실행 파일(`executable_refused`)이나 스크립트·허용 문자 밖 인자(`script_refused`) |
| `codaryn`이 PowerShell에서 막힘 | 실행 정책이 npm의 `.ps1` 실행 파일을 막았다. `codaryn.cmd`로 부른다(2절) |
| 사람용 글이 원하는 언어가 아님 | `$env:CODARYN_LANG = "ko"` 또는 `"en"`, 또는 설정 파일의 `language`. `doctor`의 메시지 언어 항목이 출처를 알려 준다(8절) |
| PowerShell에서 `2>`로 stderr를 돌릴 때 `NativeCommandError` | PowerShell 5.1이 네이티브 명령의 stderr 줄을 오류 레코드로 감싸 보여 주는 것이다. 종료 코드(`$LASTEXITCODE`)와 stdout JSON은 영향받지 않는다 |

## 18. 범용 작업: 워크플로, 계획 확인, 사람 확인

워크플로는 실행에 쓸 도구, 고정 지시, 계획 확인 여부, 끝나는 방식을 묶은 것이다. 워크플로를 고르지 않은 task는 지금까지와 같이 실행된다(도구 넷 `read_file`, `search_files`, `write_file`, `run_command`, 계획 없음, 검증기로 완료).

새 명령 `plan`, `apply`, `review`, `changes`는 모델을 부르지 않는다. 도움말은 사용법 줄과 영어 한 문장이고, 적용과 동의를 묻는 터미널 질문도 아직 영어로만 나온다.

### 18.1 워크플로 고르기

| id | 도구 | 끝나는 방식 | 쓰는 곳 |
| --- | --- | --- | --- |
| `general` | 도구 넷 | 검증기 | 지금까지와 같은 작업 |
| `code` | 도구 넷 | 검증기 | 코드 변경. 명령은 정책이 허용한 것만 |
| `document` | `read_file`, `search_files`, `write_file` | 검증기 | 문서 작성. 명령 도구 없음 |
| `analyze` | `read_file`, `search_files`, `write_file` | 검증기를 통과한 뒤 사람 확인(18.6) | 자료 분석. 개인정보 자료는 다루지 않는다(18.7) |
| `organize` | `read_file`, `search_files`, `inspect_files`, `propose_plan` | 계획을 제안하고 멈춤. 사람이 승인하면 적용(18.3) | 파일 이동·폐기. 명령 금지 |

- **고르는 곳**(앞의 것이 우선): task 파일의 `workflowRef` → 간편 형식의 `--workflow <id>` → 프로필의 `workflowRef`. task 파일과 `--workflow`를 함께 주면 `invalid_arguments`다.
- task의 `workflow`는 표시용 이름표일 뿐이다. `"workflow": "organize"`만 쓰고 `workflowRef`가 없으면 예전 방식으로 실행되고 계획 도구가 없다.
- **사용자 정의 워크플로:** 설정 파일의 `workflows`에 `"<id>": { 정의 }`로 둔다. 내장 id는 다시 정의할 수 없다.
  - 필드: `label`, `tools`, `instructions`, `plan`(`none`·`apply`), `completion`(`verifiers`·`human_review`), `humanReview`(`checklist`), `allowCommands`, `policy`, `verifiers`, `limits`
  - 정의는 사용자 설정 파일에만 있다. task 파일은 워크플로를 정의할 수 없고, 작업 공간 안의 파일로는 바꿀 수 없다(5절).
- **task가 바꿀 수 있는 범위**(넘으면 `invalid_task`, 간편 형식·프로필의 값이면 `invalid_config`):
  - `tools`는 워크플로가 주는 도구 안에서 줄이기만 한다.
  - `plan: "apply"` 워크플로에서 `plan: "none"`으로 바꿀 수 없다.
  - `organize`처럼 `allowCommands: false`인 워크플로에서는 `policy.commands`가 비어 있어야 한다. `run_command`도 도구에서 빠진다. 이 금지는 모델이 부를 수 있는 명령에 대한 것이다. task나 설정에 사람이 둔 `command` 검증기는 적용 뒤에 실행된다.
  - 없는 `workflowRef`는 `invalid_task`다.
- **정책 합치기(결정 DR-41):** 워크플로가 적용되면 그 정의의 정책은 설정·프로필의 정책(간편 형식)이나 task 파일의 자기 정책으로 대체되지 않고 합쳐진다. 워크플로의 규칙을 느슨하게 하는 정책은 없다.
  - 보호 경로(`protectedPaths`): 양쪽을 모두 쓴다.
  - 명령 규칙: 양쪽이 모두 허용하는 명령만 남는다. `organize`처럼 명령을 허용하지 않는 워크플로에서는 설정·프로필의 명령 규칙이 모두 빠진다(task 파일 자신의 명령 규칙은 위처럼 `invalid_task`다).
  - 계획 행동(`planActions`): 설정 정책이 적었을 때만 양쪽에 다 있는 것으로 줄인다. 적지 않았으면 워크플로의 것을 그대로 쓴다.
  - 경로 토큰 되살리기(`restorePathTokens`): 양쪽이 모두 허용할 때만 켜진다.
  - 빠진 것은 `doctor`가 알리고(7절의 예), 실행 시작 줄에 이어 붙으며, 실행 기록의 `run_started`에 종류와 개수만 남는다. 확인(main `23daf6b`): 위 7절의 설정으로 `run --workspace … --workflow organize`를 하면 기록에 `commands_dropped` 1과 `restore_path_tokens_off` 1이 남았다.
  - 실행 시작 줄의 실제 출력(main `bded611`). task 파일이 `workflowRef`로 고른 설정의 워크플로가 경로 토큰 되살리기를 끄고 같은 id의 검증기 하나를 뺀 경우다:

    ```
    codaryn: run started — provider scripted · the workflow's own rules turn off restoring path tokens, which the configured policy allows · the workflow's own checks leave out checks given in the config or task with the same id: 1
    ```

    한국어로는 `codaryn: 실행 시작 — 모델 제공자 scripted · 작업 종류(workflow) 자체 규칙 때문에, 설정한 정책이 허용한 경로 토큰 복원을 끕니다 · 작업 종류(workflow) 자체 검증과 id가 같아, 설정이나 task에 준 검증 1개를 뺐습니다`이다. 모두 한 줄이라 좁은 터미널에서는 접힌다(16절).
  - 검증기(결정 DR-43 (a)): 워크플로 정의의 검증기는 늘 실행된다. 설정·프로필·task의 검증기는 그 뒤에 더해지고, 정의의 검증기와 id가 같은 것만 빠진다(정의의 것이 판정한다). 빈 목록(`[]`)도 정의의 검증기를 지우지 않는다. id가 같은데 내용이 다른 검증기가 빠지면 `doctor`가 `a run of this workflow leaves out checks given in the config or task with the same id as its own: 1`처럼 알리고, `run_started`에 `verifiers_dropped`가 남는다.
    - 확인(main `6df2eae`): 설정의 워크플로 `notes`에 검증기 `has-summary`(`summary.md`가 있다)를 두고, task 파일이 `workflowRef: "notes"`로 같은 id를 더 느슨하게(`a.txt`가 있다) 적고 `a-kept`를 더하면, `has-summary`(정의의 것)와 `a-kept`가 실행됐다. `doctor --task`가 위 줄을 냈다.
- **한도:** 워크플로 정의의 한도(`organize`: 턴 8, 도구 호출 40)는 task가 비운 한도를 채우는 기본값이다. 상한은 설정 파일의 한도만 정한다(6절).
- **간편 형식**(`--workspace … --workflow organize`)으로 `run`하면 다른 간편 형식처럼 설정 파일의 한도와 모델 설정을 쓴다. `plan`·`apply`·`review`의 간편 형식도 모델을 부르지는 않지만 설정 파일에 한도가 모두 있어야 한다(없으면 `invalid_config`). 보통은 계획 실행에 쓴 task를 `--task`로 준다(18.3절). 한도가 없는 설정 파일로 `plan --workspace …`를 하면 오류 설명 끝에 그 안내가 한 줄 더 나온다(main `bded611`의 실제 출력, stderr):

  ```
  codaryn: error — the config file cannot be read or has an invalid value (invalid_config)
    config file — limits.maxModelTurns has an invalid value (values are not shown)
    To fix: Fix the named field in the config file. Without a config file, codaryn init creates one.
    Check: codaryn doctor
    The quick form (--workspace) of plan, apply and review reads the run settings, limits included, from the config file. Give the plan run's task with --task instead: it brings its own settings and secrets.
  ```

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
Usage: model turns 2 · tool calls 2 · 0.1 s
Read the plan with codaryn plan, and apply it with codaryn apply if you approve it.
Run id: 20261112T055810Z-6916ecde
Report: codaryn report --workspace <workspace> --run 20261112T055810Z-6916ecde
Plan: codaryn plan --task <task.json> --run 20261112T055810Z-6916ecde
Apply after approval: codaryn apply --task <task.json> --run 20261112T055810Z-6916ecde --digest <digest>
  e6abc377e2b93985f86db63918ed90f73076e316f56f5d7917de5befb58cc887
```

- 계획 실행은 검증기를 돌리지 않는다. task의 검증기는 적용 때 돈다.
- stdout JSON의 `plan`에 다이제스트와 행동 수가 있다. 다이제스트는 실행마다 다르다(`plan.json`에 실행 id가 들어간다).

**계획 보기(`plan`):** 실제 출력(stdout).

```
Plan of run 20261112T055810Z-6916ecde: 3 action(s), pending
Digest: e6abc377e2b93985f86db63918ed90f73076e316f56f5d7917de5befb58cc887
  1. move     inbox/beach-2025.jpg  ->  photos/2025/beach-2025.jpg
  2. move     inbox/receipt-2026.pdf  ->  documents/2026/receipt-2026.pdf
  3. discard  inbox/old-draft.tmp  (kept in .codaryn/discarded/ until removed)
To apply it: codaryn apply <the same task form> --run 20261112T055810Z-6916ecde --digest e6abc377e2b9
```

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
Plan run: 20261112T055810Z-6916ecde
Checks passed: 2 of 2 (within the configured checks)
Read the report, and revert if needed.
Run id: 20261112T055810Z-56c6d7c5
Report: codaryn report --workspace <workspace> --run 20261112T055810Z-56c6d7c5
Revert: codaryn revert --workspace <workspace> --run 20261112T055810Z-56c6d7c5
```

- 검증 1번은 적용이 늘 돌리는 파일 목록 확인(`inventory`)이다. 계획에 있던 이동·폐기만 일어났는지 본다. 2번은 task의 `file_rules`다.
- 적용은 새 실행(적용 실행)이다. stdout은 `kind:"apply"` JSON 한 줄이고(`planRunId`, `digest`, `applied` 등), 같은 내용이 그 실행의 `result.json`이 된다.
- 폐기한 파일은 `.codaryn\discarded\<적용 실행 id>\` 아래에 행동 번호 이름(`2`)으로 있다.
- `runs`에는 적용 실행이 맨 위에 `3  done (done/verified)`로 나온다(`changes`는 적용한 행동 수). `plan`을 다시 보면 상태가 `applied`이고 `Applied by run <적용 실행 id> at <시각>` 줄이 붙는다.
- `report --run <적용 실행 id>`는 적용 실행의 보고서다(실제 출력, 앞부분):

```
# Codaryn apply run report

- Run: `20261112T055919Z-fa06002b` (an apply run: no model takes part)
- Plan run: `20261112T055919Z-fc288980`, digest `9e2cf832027da6e15743b8d1694d5b966384be4addfd6278fcce805c669b86da`
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
- action 3: discard `inbox/old-draft.tmp` (kept as `.codaryn/discarded/20261112T055919Z-fa06002b/2`)
```

  이어서 검증(`inventory`와 task 검증기의 확인 항목), 보호 대상, 사용량, 되돌리기 명령(`Undo`), 확인하지 않은 범위가 나온다. 이 보고서는 다른 실행에서 만든 것이라 위의 id와 다르다.

**되돌리기:** `revert --dry-run`은 아무것도 바꾸지 않고 판정만 보인다(실제 출력, stderr).

```
codaryn: Files to revert: 3 (preview, nothing changed) (complete)
  inbox/old-draft.tmp — restored from the discarded files folder
  inbox/receipt-2026.pdf — moved back to where it was
  inbox/beach-2025.jpg — moved back to where it was
The preview did not check whether this drive can move files back without risking replacing a file; the real revert checks it and, without consent, skips such files.
Run again without --dry-run to revert.
```

`--dry-run` 없이 실행하면 `Files reverted: 3 (complete)`, 종료 0이다. 세 파일이 `inbox`로 돌아오고 보관함의 그 실행 폴더는 빈다. 다시 되돌리면 세 파일 모두 `already_reverted`이고 `complete`다.

### 18.3 계획 확인과 적용 (`plan`, `apply`)

```powershell
node dist/src/cli/main.js plan --task <task.json> --run <계획 실행 id> [--json]
node dist/src/cli/main.js apply --task <task.json> --run <계획 실행 id> --digest <다이제스트 앞 12자 이상> [--allow-unsafe-move] [--cancel-file <파일>] [--quiet]
```

- **계획 실행:** `organize`(또는 `plan: "apply"`인 워크플로)의 `run`은 모델이 계획 하나를 제안하면 `needs-input`/`plan_pending`(종료 3)으로 끝난다.
  - 계획은 `.codaryn\runs\<계획 실행 id>\plan.json`에 행동(이동·폐기)과 원본 파일의 해시만 담는다.
  - 다이제스트는 그 파일의 SHA-256이다. 승인은 이 다이제스트로 한다.
  - 한 계획은 행동 1,000개, 원본 크기 합계 4 GiB까지다.
- **계획 보기(`plan`):** `plan.json`을 지금 명령의 비밀로 다시 가려 보여 준다. 아무것도 바꾸지 않고 잠금도 잡지 않는다. `--run latest`를 받는다. 비밀이 든 경로는 `documents/[[CODARYN_SECRET:7a30010719392743]]/receipt-2026.pdf`처럼 토큰으로 보인다.
- **승인**(둘 다 없으면 `plan_not_approved`, 종료 2, 아무것도 옮기지 않음):
  - `--digest`에 다이제스트 앞 12~64자(소문자 16진수)를 준다. 그 계획의 다이제스트와 맞아야 한다.
  - stdin과 stderr가 모두 터미널이고 `--digest`가 없으면, 계획을 보이고 `Apply this plan? [y/N]`을 묻는다. 기본은 아니오다.
  - 다이제스트는 계획 실행의 끝 요약에 나온 값을 쓴다. 상태 디렉터리는 허용 명령이 바꿀 수 있으므로, `plan`에서 본 다이제스트가 그 값과 같은지 확인하고 승인한다.
- **같은 비밀로 한다:** 계획 파일은 계획 실행이 가린 표기를 행동마다 함께 담는다(비밀 값이나 그 해시는 담지 않는다). `plan`·`apply`는 지금 명령이 등록한 비밀로 다시 가린 결과가 그 표기와 같을 때만 진행한다.
  - 다르면 계획을 읽은 직후 `plan_secrets_differ`(종료 2)로 끝난다. 아무것도 보이거나 묻거나 기록하거나 옮기지 않고, 적용 실행도 만들지 않는다. `--allow-unsafe-move`를 줘도 같다. 실제 출력(stderr):

    ```
    codaryn: error — the secrets registered now hide the plan's paths differently from the plan run, so nothing was shown or changed (plan_secrets_differ)
      To fix: Use the same task form as the plan run, and so the same secrets, or make the plan again.
    ```

  - 계획 실행에 쓴 task 파일(같은 `privacy.secretEnv`)로 `plan`과 `apply`를 한다. 경로에 든 값을 계획 실행 뒤에 새로 비밀로 등록했다면, 그 계획은 보거나 적용할 수 없으니 계획을 새로 만든다.
- **기록이 바뀐 계획은 적용하지 않는다(U-1):** 그 계획 실행에 기록 변경 표시가 있으면(16절 "실행 기록 변조") `apply`는 묻기 전에 `plan_records_changed`(종료 2)로 거부한다. 아무것도 묻거나 기록하거나 옮기지 않고, 적용 실행도 만들지 않는다. 그 계획이 사람이 읽은 것과 다를 수 있기 때문이다.
  - `plan`은 표시가 있는 계획도 그대로 보이고 표시를 말하지 않는다. `runs`의 결과 칸 끝의 `records changed`로 알 수 있다.
  - 확인(main `a7f3a2f`, 파일 정리 체험): 계획 실행 뒤 다른 실행의 허용한 명령이 그 계획 실행의 `result.json`을 고치자 계획 실행에 표시가 붙었다. 그 계획의 `apply --digest`는 아래와 같이 끝났고 파일은 그대로였다. 같은 task로 계획을 새로 만들어 적용하자 `done`/`verified`였다.

    ```
    codaryn: error — the plan run has a records-changed mark: something other than the run changed its records, so its plan may not be the one you read; nothing was asked or changed (plan_records_changed)
      To fix: Make the plan again with codaryn plan, read the new plan, and apply that one. The marked run stays as evidence of what happened.
    ```

  - 표시가 있는 실행은 무슨 일이 있었는지의 증거로 남긴다. `cleanup` 미리보기는 그 기록에 `the run has a records-changed mark; its records are evidence of what happened`를 붙인다(경고만 하고 따로 확인을 받지는 않는다).
- **`--run`은 계획 실행 id로 꼭 준다.** `--run latest`는 받지 않는다(`invalid_arguments`). 승인이 계획 하나를 가리켜야 하기 때문이다.
- **적용 때의 정책:** 정책, 검증기, 비밀은 계획을 만들 때가 아니라 **적용할 때**의 task와 설정에서 읽는다.
  - 행동마다 지금 정책(`policy.planActions`, 보호 경로)으로 다시 판정한다.
  - 계획 뒤에 원본이 바뀌었거나 없어졌으면 아무것도 옮기지 않고 `failed`/`plan_stale`(종료 1)이다. 정책이 거부한 행동이 있어도 같다.
  - 작업 공간 파일이 파일 목록 확인의 상한을 넘어도 `plan_stale`이다. `plan`이 이 경우를 미리 알린다.
- **적용 순서:** 잠금 → 사전 점검(파일 목록, 모든 행동) → 계획 순서대로 이동·폐기 → 파일 목록 확인(`inventory`, 두 번째 목록과 비교) → task 검증기. 목록 횟수와 취소는 16절 "큰 작업 공간의 파일 목록"
  - 이동은 대상에 파일이 있으면 하지 않는다(덮어쓰지 않음). 대상의 부모 폴더는 만든다.
  - **폐기는 지우지 않는다.** `.codaryn\discarded\<적용 실행 id>\`로 옮긴다.
  - 중간에 한 행동이 실패하면 그 뒤 행동은 하지 않고 `failed`/`apply_incomplete`(종료 1)다. 이미 한 행동은 `revert`로 되돌린다.
- **한 번만 적용된다:** 적용을 시작하면 계획에 `applied.json`이 생긴다. 같은 계획을 다시 적용하면 `plan_already_applied`(종료 2)다. 다시 하려면 되돌린 뒤 계획 실행부터 새로 한다.
- 다른 종류의 실행 id를 주면 `run_not_plan`(종료 2)이다. `workflowRef`가 없어 `plan: "apply"`로 해석되지 않는 task로 적용해도 같다.
- **취소:** `--cancel-file`(작업 공간 밖) 또는 Ctrl+C. 상태는 `cancelled`(5)다.
  - 행동을 시작하기 전에 취소되면 아무것도 옮기지 않고 계획도 적용되지 않은 채로 남아, 다시 `apply`할 수 있다.
  - 행동을 시작한 뒤라면 하던 행동은 끝내고 멈춘다. 계획은 적용된 것으로 남으므로 이미 한 행동은 `revert`로 되돌린다.
- **결과 읽기:** `report`는 계획 실행(행동 수, 다이제스트)도, 적용 실행(승인 경로와 동의, 사전 점검, 행동, 검증, 되돌리기 명령)도 읽는다(18.2절). stdout JSON과 `runs`도 같은 결과를 준다.

### 18.4 적용을 되돌리기

```powershell
node dist/src/cli/main.js revert --workspace <작업 공간> --run <적용 실행 id> [--dry-run | --allow-unsafe-move]
```

- 적용 실행을 되돌리면 이동은 원래 자리로 옮기고(`moved_back`), 폐기는 보관함에서 되살린다(`restored_from_discard`). 뒤의 행동부터 되돌린다. 적용이 만든 폴더는 남긴다.
- 원래 자리에 다른 파일이 생겼으면 덮어쓰지 않고 건너뛴다(`original_path_taken`). 옮긴 파일이 그 뒤 바뀌었으면 `changed_since_run`이다. 하나라도 건너뛰면 `partial`(종료 3)이다.
- 적용이 행동 도중 멈췄으면, 시작 기록만 있는 행동도 실제 파일 상태를 보고 되돌린다. 상태가 분명하지 않으면 건드리지 않고 `changed_since_run`으로 알린다.
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

`analyze`처럼 끝나는 방식이 `human_review`인 워크플로는 검증기를 모두 통과해도 `done`이 아니라 `needs-input`/`awaiting_review`(종료 3)로 끝난다. 끝 요약에 확인할 항목이 나온다(실제 출력, 일부):

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
- 메모는 500자 이하다. 키 모양이 있으면 `key_in_file`이고, 등록한 비밀은 가려서 저장한다.
- `awaiting_review`로 끝나지 않은 실행이면 `run_not_awaiting_review`(종료 2)다. `--run latest`를 받으므로, 고른 실행 id(stderr)가 본 실행과 같은지 확인한다.
- `report`의 `Review checklist` 절이 확인 항목과 판정을 보여 준다. 판정 전에는 `No verdict yet.`, 판정 뒤에는 예를 들어 `Verdict: **rejected** (`2026-11-12T05:58:15.969Z`)`다. 판정은 그 실행의 `review.json`에 있다.
- 확인 항목은 워크플로가 정한다. task의 `humanReview.checklist`로 바꿀 수 있다.
- 사람 확인은 사람의 판단을 기록할 뿐이다. 보고서의 해석이나 분석 방법을 Codaryn이 확인하지는 않는다.
- 결과 표의 형태와 집계는 `data_checks` 검증기로 확인한다(규칙은 [CLI·공통 계약](cli-contract.md)과 `src/contracts/verify.ts`).

### 18.7 개인정보가 든 자료는 다루지 않는다

- `read_file`과 `search_files`는 표의 행을 그대로 모델에 보낸다. 가려지는 것은 등록한 비밀 값(12절)뿐이다. 이름, 연락처 같은 개인정보는 가려지지 않는다.
- 원자료 행을 모델에 보내지 않고 집계만 돌려주는 도구는 아직 없다. 그 전까지 개인정보가 든 표나 문서는 어떤 워크플로로도 작업 공간에 두지 않는다. `analyze`를 포함한다.
- 파일 정리(`organize`)는 파일 내용을 모델에 보내지 않는다. `inspect_files`는 경로, 크기, 수정 시각, 요청하면 해시만 준다. 그래도 파일 이름과 폴더 이름은 모델에 간다. 이름에 개인정보가 있으면 그 값을 비밀로 등록하거나 그 폴더를 작업 공간에서 뺀다.
- 이미지나 오피스 문서 같은 바이너리 파일도 내용을 읽지 않고 옮길 수 있다.

### 18.8 기록 폴더와 보관함 정리 (`cleanup`)

`codaryn cleanup`이 상태 디렉터리(`.codaryn\`)의 실행 기록과 보관함을 보이고 지운다. 기본은 미리보기이고 아무것도 지우지 않는다.

```powershell
# 요약만(아무것도 고르지 않음)
node dist/src/cli/main.js cleanup --workspace D:\work\notes
# 미리보기: 30일보다 오래된 실행 기록을 고르고, 경고와 digest를 본다
node dist/src/cli/main.js cleanup --workspace D:\work\notes --older-than 30
# 지우기: 같은 고르기에 미리보기의 digest(앞 12자 이상)를 준다
node dist/src/cli/main.js cleanup --workspace D:\work\notes --older-than 30 --confirm <digest>
```

- **고르기**
  - 실행 기록: `--older-than <일>`, `--run <id>[,<id>…]`, `--reverted`(마지막 되돌리기가 완전했던 실행만)
  - 보관함: `--discarded-older-than <일>`, `--discarded-run <id>[,<id>…]`
  - 한 부분의 기준을 모두 만족하는 것이 골라진다. 기준이 없는 부분은 아무것도 고르지 않는다. 실행 id는 정확히 쓴다(`latest`는 받지 않는다).
- **확인은 셋이고, 뒤의 둘은 `--confirm`과 함께만 받는다.**
  - `--confirm <digest>`: 미리보기가 보인 계획 그대로일 때만 지운다. 미리보기 뒤에 새 실행이나 되돌리기로 상태가 바뀌면 `plan_changed`(종료 3)이고 아무것도 지우지 않는다. 다시 미리 본다.
  - `--include-not-reverted`: 되돌리지 않았거나 일부만 되돌린 실행, 기록을 확인할 수 없는 실행의 기록을 지운다. 없으면 그 기록은 남고(`not_reverted_not_confirmed`) 나머지만 지워진다(종료 0). 남은 적용 실행이 쓰는 계획 실행도 함께 남는다. 지운 실행은 더는 되돌릴 수 없다.
  - `--delete-discarded`: 고른 보관함(사람의 파일)을 지운다. 없으면 보관함은 남는다. 적용 실행의 기록만 지우고 보관함을 남기면 그 파일은 되돌리기로 제자리에 돌아가지 않는다. 미리보기가 그 적용 실행 줄에 이것을 알린다.
- 3절 체험을 두 번 실행하고 처음 것만 되돌린 작업 공간에서 `--older-than 0` 미리보기의 실제 출력(stdout, main `6df2eae`):

```
Run records: 2 (30151 bytes)
Discarded files (people's own files an apply set aside): 0 (0 bytes)
Files a revert could not put back (.codaryn/parked/, never cleaned up): 0 (0 bytes)

Run records to remove: 2 (30151 bytes)
  Of these, runs not reverted, only partly reverted, or whose records cannot be checked: 1. Their records go only with a confirmation of their own; without them those runs can no longer be reverted or put back by hand.
- 20261112T132239Z-0fca101f: 4 file(s), 14977 bytes; not reverted: without its records it can no longer be reverted
- 20261112T132239Z-af1ad371: 5 file(s), 15174 bytes

Nothing was removed. To remove the run records, run the same command with --confirm 3c7ebbb02bcc.
The records of 1 run(s) not reverted, or only partly, are kept unless you add --include-not-reverted yourself; once they are removed, those runs can no longer be reverted.
```

  - 그 digest로 `--confirm`만 주면 `Removed: run records 1, discarded-files folders 0, 15174 bytes`이고, 되돌리지 않은 실행은 `not reverted or only partly reverted, and removing it was not confirmed apart`로 남는다.
  - 새 미리보기의 digest로 `--include-not-reverted`를 더하면 그 실행도 지워진다.
  - 파일 정리의 적용(폐기 하나)이 있는 작업 공간에서 `--discarded-older-than 0`을 더하면, 적용 실행 줄에 `the apply run's records go; if its discarded files stay (their folder not selected, or its deletion not confirmed), a revert can no longer put them back`이 붙는다. 보관함 줄은 `a discarded-files folder: people's own files are deleted`이고, 끝에 `People's discarded files are deleted only with --delete-discarded besides.`가 나온다.
- **지우지 않는 것**: `.codaryn\parked\`(되돌리기가 제자리에 두지 못한 파일), 잠금, `.gitignore`, 돌고 있는 실행(`lock_held`, 적용 중이면 `workspace_locked`), 결과가 없는 실행(`no_result`), 고르지 않은 적용이 쓰는 계획 실행. 상태 디렉터리 안의 링크를 따라 밖을 지우지 않는다.
- **다 지우지 못한 경우**: 권한이나 다른 프로그램 때문에 지우기가 중간에 실패하면 그 항목은 `partly_removed`이고 종료 1이다. 남은 것은 `.codaryn\cleanup-<16자리 16진수>\`에 정리의 표지와 함께 남고, 다음 미리보기에 `Leftover folders to remove`로 나와 `--confirm`으로 지운다. 표지가 없는 같은 이름 꼴의 폴더는 정리의 것이 아니므로 지우지 않고, 요약에 한 줄로만 보인다: `Unknown folders (.codaryn/cleanup-…, named like a cleanup's leftover but without its mark; never removed): 1 (2 bytes)`(한국어 `알 수 없는 폴더(…, 지우지 않음)`). 이전 판(main `6f85b65`~`5396225`)의 정리가 남긴 폴더도 표지가 달라 이렇게 보이고, 지금은 정리로 지울 수 없다(검토 R-40 낮음, store 담당 다음 단위).
- **기록을 확인할 수 없는 실행**(결과 기록이 깨진 실행 등)의 줄에는 `records cannot be checked: whether it changed files or was reverted is not known, and removing them may remove the last copies of those files`가 붙고, `--include-not-reverted`를 따로 줘야 지워진다.
- 지운 것은 `.codaryn\cleanup.jsonl`에 개수와 바이트만 남는다(이름과 경로는 없다).
- `--json`이면 `kind:"cleanup"` JSON 한 줄이다(`mode` `preview`, `applied`, `plan_changed`). 터미널 질문은 없다. 지우는 길은 digest 확인뿐이다.
- 한국어 출력에서도 크기 조각(`N file(s), N bytes`)과 끝의 안내 줄은 아직 영어다.
- 확인 범위: 위 출력과 `--confirm`·`--include-not-reverted`의 결과는 main `6df2eae`의 실제 CLI다. 지우지 않는 것과 다 지우지 못한 경우는 판 `39df2ba`에서(검토 R-34·R-34b·R-34c), 알 수 없는 폴더의 줄과 기록을 확인할 수 없는 실행의 줄은 main `a7f3a2f`에서, 이전 판이 남긴 폴더는 `7556be6`(검토 R-40)에서 실제 CLI로 확인했다.
- **계획 실행의 기록**은 그 계획의 적용 실행을 되돌리는 데 필요하다. 손으로 지우면 그 적용은 되돌릴 수 없다(`revert`는 `plan_run_missing`, 종료 2). 적용 실행의 stdout JSON과 `runs --json`의 `planRunId`가 어느 계획 실행인지 알려 준다.
