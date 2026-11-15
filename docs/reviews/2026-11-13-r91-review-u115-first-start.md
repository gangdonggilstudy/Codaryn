# R-91 검토: U-115 CLI 첫 시작 안내 (UXM-9)

- 대상: 고정 판 `pm/unit-U-115` = `2138901` (main `68b93b3` 위). `git diff 68b93b3 2138901`, 14개 파일 +711 −13.
- 검토자: w3:p7 (nd-docs). 읽기 전용. 코드는 바꾸지 않았다.
- 방법: 두 판을 각각 `git archive`로 풀어 빌드했다(`.codaryn/R-91/base` = main `68b93b3`, `.codaryn/R-91/head` = `2138901`). 같은 경우를 두 판에 같은 경로·같은 환경으로 돌려 stdout, stderr, 종료 코드를 맞댔다.
  - 처음 쓰는 사람의 환경: APPDATA·LOCALAPPDATA는 빈 임시 폴더(기본 설정 위치에 파일 없음), `ANTHROPIC_*`·`OPENAI_*`·`CODARYN_*` 변수 없음, 언어는 `CODARYN_LANG=en`, `ko`, 지정 없음(OS 로캘, 한국어) 세 가지.
  - 터미널 흉내: `--import`로 미리 읽는 파일이 `process.stdout/stderr/stdin.isTTY`만 참으로 바꾼다(단위의 `u115-terminal-preload`와 같은 방식, 검토자가 따로 쓴 파일). 쓴 글은 그대로 파이프로 받는다.
  - 비교 전에 실행 id, 시각, 걸린 시간, 판 경로만 자리표로 바꿨다.
  - 실제 API 호출과 외부 네트워크는 없다. 키 변수가 필요한 경우에는 키 모양이 아닌 평범한 글자(`plain-test-value`)를 넣었다. 제공자 주소 변수는 막이로 닫힌 loopback 포트(쓰기 직전에 찾은 빈 높은 포트)를 가리키게 했다.
- 판의 시험(검토자 측정, `2138901`): unit 2,962개 중 실패 0, integration 564/564. 자세한 수치는 아래 "판의 시험" 절.

## 결과 요약

| 심각도 | 개수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 4 |
| 정보 | 5 |

볼 것 (1)~(6)은 모두 확인했다. (1) 터미널이 아닐 때 달라진 것은 `config_missing` 힌트뿐이었다. (4) 설정 파일이 있는데 잘못된 경우에는 힌트가 붙지 않았다. (5) 명령마다의 도움말은 전과 같았다. 낮음 4개는 안내 글이 실제와 어긋나는 곳 셋(L-1, L-3, L-4)과 100칸을 넘는 줄(L-2)이다.

## 낮음

### L-1: 기본 설정 위치가 아예 없을 때 doctor가 `codaryn init`을 안내하지만, init은 그 환경에서 실패한다

- 코드: `src/cli/doctor.ts` `nextStepLines`. `config_file`의 text가 `doctor.config_file.none`(기본 위치 없음)이어도 `default_missing`과 똑같이 `doctor.next.init`을 낸다.
- 재현(U-115 판, 터미널 흉내, APPDATA를 지운 환경, `CODARYN_LANG=en`). doctor:

  ```
  [skipped] config file               no --config given, CODARYN_CONFIG is not set and there is no default location
  ...
  Not set up yet, and what to do next:
    1. Create the config file: codaryn init (it writes the default limits too)
  ```

  안내대로 `codaryn init`을 하면 종료 2다. `init --json`의 메시지는 `there is no default config location (APPDATA, XDG_CONFIG_HOME or the home directory is not available); give --config <file>`이다. main도 같다.
- 제안: `.none`이면 `--config <파일>`로 만들고 그 뒤 실행에 `--config`를 주거나 `CODARYN_CONFIG`를 정하라는 단계를 따로 둔다(예: `codaryn init --config <file>`).
- 드문 환경이다(서비스 계정, 컨테이너). 그래서 낮음.

### L-2: 새 줄 4가지가 100칸을 넘어 접힌다

새로 생긴 줄 58개(두 언어, 겹치는 것 하나로 셈)의 화면 너비를 쟀다. 한글은 2칸으로 셌다.

| 너비 | 줄 |
| --- | --- |
| 112 | `First time? In this order: codaryn init -> codaryn doctor -> codaryn run "<task>" -> codaryn report --run latest` |
| 109 | `Options and usage of each command: codaryn help <command> (e.g. codaryn help run). Version: codaryn --version` |
| 108 | `처음이라면 이 순서로: codaryn init -> codaryn doctor -> codaryn run "<할 일>" -> codaryn report --run latest` |
| 101 | `  1. Register the key: set ANTHROPIC_API_KEY as the API key line above says, then open a new terminal` (번호가 2여도 같다) |

- 그다음은 95칸(한국어 키 등록 줄)이다. 나머지는 모두 93칸 이하다.
- `OPENAI_API_KEY`이면 키 등록 줄은 98칸이다.
- 제안: 처음 순서는 두 줄로 나눈다(예: 제목 줄과 명령 줄). `help.more`는 버전 문장을 떼어 낸다. 키 등록 줄은 "as the API key line above says"를 줄인다.
- 참고: 짧은 도움말에 그대로 남은 `help.output`(영어 한 줄 약 430자)과 `help.key`는 전체 도움말에서 옮겨 온 줄이다. 어느 너비에서나 접힌다. 이것은 U-115가 새로 만든 줄이 아니라 표에서 뺐다.

### L-3: "다음: `codaryn run "<task>"`"은 현재 폴더에서 돈다는 것을 말하지 않는다

- 코드: `nextStepLines`의 `doctor.next.ready`, `help.first_steps`.
- 한 줄 실행은 현재 디렉터리가 작업 공간이다. 그런데 `--workspace`나 `--task` 없이 돈 doctor는 작업 공간 항목을 모두 `skipped`로 둔다. 그래서 다 되었다고 하고 이 줄을 낸다.
- 재현(U-115 판, 터미널 흉내, 설정·모델·키 변수가 다 있는 환경). 판의 루트(설치 위치)에서 doctor를 돌렸다:

  ```
  doctor: ok (exit code 0). No network access was made and nothing was changed.
  Next: codaryn run "<task>"
  ```

  같은 곳에서 그대로 `run "add a line"`을 하면 종료 2이고 stderr는 다음과 같다. 아무것도 쓰이지 않았다.

  ```
  codaryn: error — the workspace overlaps the Codaryn install directory (workspace_is_install_dir)
    To fix: Use another folder, such as a copy, as the workspace.
    Check: codaryn doctor
  ```

- README는 `npm link` 없이 저장소 루트에서 `node dist/src/cli/main.js …`로 쓰는 예를 먼저 보인다. 그래서 이 길로 오는 사람이 있다.
- `doctor --workspace <다른 폴더>`로 점검해도 같은 줄(`codaryn run "<task>"`)이 나온다. 이 명령은 점검한 폴더가 아니라 현재 폴더에서 돈다.
- 제안: "작업할 폴더에서"를 붙인다. `--workspace`로 점검했으면 `codaryn run --workspace <dir> --goal "<task>"`를 안내한다.

### L-4: 키 값을 보낼 수 없을 때도 모델 단계가 "키를 등록한 뒤"라고 한다

- 코드: `nextStepLines`. `keyMissing || keyUnusable`이면 `doctor.next.model_after_key`를 쓴다.
- 재현(키 변수에 공백이 든 값, 모델은 자리표시자):

  ```
  Not set up yet, and what to do next:
    1. Check the key: ANTHROPIC_API_KEY holds a character that cannot be sent
    2. Choose a model once the key is registered: codaryn models --use
    3. Check again: codaryn doctor
  ```

  키는 이미 등록되어 있다. 고칠 것은 값이다. 한국어도 `모델 고르기(키를 등록한 뒤)`다.
- 제안: 보낼 수 없는 키일 때는 "키 값을 고친 뒤"로 쓴다. 아니면 두 경우 모두에 맞는 말("키가 준비된 뒤")을 쓴다.
- 이 경우를 다루는 단위 시험(`a key that cannot be sent`)은 모델이 설정된 상태라 이 줄을 보지 않는다.

## 정보

- **I-1:** run의 `provider_not_configured`는 키가 있어도 '키 없이 해 보는 길'을 붙인다.
  - 재현: 키 변수가 있고 모델만 자리표시자다. stderr 끝에 `To try the flow without a key: docs/usage.md section 3 (examples/demo)`가 붙는다.
  - doctor와 init은 키가 없을 때만 이 줄을 낸다. 계약 문서의 글(`provider_not_configured`이면)과는 맞다. 맞출지는 결정할 일이다.
- **I-2:** stdout과 stderr는 터미널이고 stdin은 아닐 때(질문 없음) `init`의 첫 줄과 끝줄이 서로 다른 말을 한다.
  - 첫 줄은 `Not a terminal: nothing was asked and only the defaults were written.`이다. 그런데 터미널에서만 붙는 줄이 끝에 온다.
  - 질문 조건은 stdin·stderr, 이 줄의 조건은 stdout이기 때문이다. 드문 조합이다.
- **I-3:** 계약 문서는 "간편 형식·한 줄 실행의 설정 오류(`invalid_config`)는 힌트 `config_missing`"이라고 쓴다.
  - plan·apply·review의 간편 형식은 이 힌트를 달지 않는다. `apply --workspace … --workflow organize`는 main처럼 `quick_form_needs_task`를 단다. plan·review·changes는 실행 기록이 없다는 오류(`run_not_found`)가 먼저 난다.
  - 동작은 main과 같고 맞다고 본다. 문서의 "간편 형식"을 "run의 간편 형식"으로 좁히면 정확하다.
- **I-4 (U-115 밖, 원래 있던 것):** 기본 위치가 없을 때 `init`의 사람용 오류 설명에 메시지(`… give --config <file>`)가 나오지 않는다.
  - 대신 `To fix: Fix the named field in the config file. Without a config file, codaryn init creates one.`만 나온다. init 자신을 다시 가리키는 셈이다.
  - L-1과 겹친다. 오류 설명 담당에게 넘긴다.
- **I-5:** '키 없이 해 보는 길'의 `docs/usage.md section 3 (examples/demo)`는 저장소 기준 경로다.
  - 지금 설치는 저장소를 복제해 빌드하는 방식이라 맞다. 다만 `package.json`의 `files`는 `dist/src`, `README.md`, `LICENSE`뿐이다. 패키지로 내면 이 경로가 없다.

## 볼 것별 확인

### (1) 터미널이 아닐 때: main과 글자까지 같은가

- 경우 72개를 언어 세 가지로 돌렸다. 맞댄 쌍은 216개다.
  - 도움말: 인자 없음, `--help`, `-h`, `help`, `--version`, `help <명령>` 12개, `<명령> --help` 12개
  - doctor: 그대로, `--json`, `--workspace`, `--task` 데모, `--config` 없는 파일, init 뒤
  - init: 그대로, `--json`
  - models: 그대로, `--json`
  - run: 인자 없음, 간편 형식(그대로, `--json`, `--quiet`), 한 줄 실행, `--profile`, `--workflow organize`, `--workflow` 없는 이름, `--config` 없는 파일, `CODARYN_CONFIG` 없는 파일, 기본 위치에 깨진 JSON, `{}`, 폴더, APPDATA 없음, init 뒤의 run(종료 7), 데모 task
  - 데모 뒤의 runs·report·changes·revert --dry-run
  - plan·apply·review·changes의 간편 형식, cleanup
  - 모르는 명령, 모르는 옵션
- **종료 코드는 216쌍 모두 같다.**
- **글이 다른 것은 언어마다 6개였고, 모두 `config_missing`이다.** 해당 경우는 run 간편 형식(그대로, `--json`, `--quiet`), 한 줄 실행, `--workflow organize`, `--workflow nope`이다.
  - 오류 JSON 끝에 `"hint":"config_missing"`이 더해진다. `message`·`diagnostic`·`code`·`exitCode`는 그대로다.
  - stderr에는 힌트 줄 하나가 더해진다. 영어는 `  There is no config file yet (none at the default location). Create one with codaryn init.`, 한국어는 `  설정 파일이 아직 없습니다(기본 위치에 파일이 없습니다). codaryn init으로 만드세요.`이다.
  - `--quiet`는 사람용 줄이 없으므로 JSON만 다르다.
- 이 밖에 언어 지정 없음의 데모 run 하나가 `0초`와 `0.1초`로 달랐다. 이것은 걸린 시간이고, 한국어 시간 표기를 자리표로 바꾸지 않아서 남은 차이다.

### (2) 터미널의 안내가 사실과 맞는가

- **짧은 도움말:** `codaryn`, `--help`, `-h`, `help`에서 나온다. 들어 있는 것은 intro, 처음 순서, 키 없이 해 보는 길, 명령 12개(첫 사용 순서), `help.more`·`help.key`·`help.output`·`help.contract`다.
  - 명령 목록은 `COMMANDS`의 12개와 같다. 빠진 명령은 없다.
  - 한마디 설명은 각 명령의 `help.command.<명령>` 설명과 맞다. plan은 저장된 계획을 보이고, changes는 바뀐 파일을 보이고, cleanup은 기록과 폐기 보관함을 다룬다.
- **처음 순서:** init → doctor → run → report 순서를 따라 했다.
  - init은 키가 없다는 것과 모델이 자리표시자라는 것을 말하고 `Next: codaryn doctor`로 끝난다.
  - doctor는 키 등록과 모델 고르기를 단계로 낸다(아래 (3)).
  - 키와 모델 없이 run을 하면 `provider_not_configured`(종료 7)이고 끝에 키 없이 해 보는 길이 붙는다.
  - 순서 자체는 doctor가 빈 곳을 채워 주므로 따라 할 수 있다. 다만 run 단계는 L-3이 있다.
- **키 없이 해 보는 길:** usage 3절 "키 없이 체험하기"와 `examples/demo`가 있다. 3절의 명령을 U-115 판으로 돌린 결과는 다음과 같다.
  - `doctor --task`: 종료 0
  - `run --task`: 종료 0, `done/verified`
  - `runs`: 종료 0
  - `report --run latest`: 종료 0
  - `revert --dry-run`: 종료 0
- **init:** 질문이 있는 경우(stdin까지 터미널, 질문마다 Enter)와 질문이 없는 경우 모두 확인했다. 두 언어 모두 `Next: codaryn doctor` 뒤에 한 줄만 더해진다. 나머지는 main과 같다.

### (3) doctor의 '다음에 할 일'

| 상태 | 단계 |
| --- | --- |
| 아무것도 없음(기본 위치에 파일 없음, 키 없음) | 1 init, 2 키 등록, 3 모델(키 등록 뒤), 4 다시 점검, 그리고 키 없이 해 보는 길 |
| `--workspace`만 줌 | 위와 같음 |
| init 뒤(모델 자리표시자, 키 없음) | 1 키, 2 모델(키 뒤), 3 다시 점검, 그리고 키 없이 해 보는 길 |
| 키 있음, 모델 자리표시자 | 1 모델 고르기, 2 다시 점검(키 없이 해 보는 길 없음) |
| 보낼 수 없는 키, 모델 자리표시자 | 1 키 확인, 2 모델(키 등록 뒤, L-4), 3 다시 점검 |
| `--config` 없는 파일 / 기본 위치의 `{}` / 깨진 JSON | 1 설정 파일 고치기, 2 키, 3 모델, 4 그 밖의 실패 1개(한도), 5 다시 점검 |
| 설정 없음 + 언어 경고(`CODARYN_LANG=fr`) | 1 init, 2 키, 3 모델, 4 경고 1개, 5 다시 점검 |
| 다 됨 | `Next: codaryn run "<task>"`(제목 없음) |
| 다 됨 + 경고 1개 | 경고 줄, 그다음 `다음: codaryn run "<할 일>"` |
| `--task` 데모(키 필요 없음) | `Next: codaryn run --task <task file>` |
| 기본 위치 없음(APPDATA 없음) | 1 init(L-1), 2 키, 3 모델, 4 다시 점검 |

- 단계는 실제 실패 항목과 맞다. 순서(설정 → 키 → 모델 → 그 밖 → 경고 → 다시 점검)도 옳다. 모델 고르기(`models --use`)는 키가 있어야 목록을 받으므로 키 다음이 맞다.
- 설정 파일이 고장 났을 때 "그 밖의 실패 1개"는 한도 항목이다. `{}`처럼 한도가 정말 없는 파일도 있으므로 따로 세는 것이 맞다고 본다.
- `doctor --json`은 터미널에서도 main과 같다. 점검 줄과 끝 줄도 같고, 더해지는 것은 끝 줄 뒤뿐이다.

### (4) `config_missing`은 설정 파일이 있는데 잘못된 경우에는 붙지 않는가

다음 경우 모두 main과 글자까지 같았고 힌트가 없었다.

- 기본 위치에 깨진 JSON
- 기본 위치에 `{}`(`config schemaVersion must be 1`)
- 기본 위치가 폴더
- `--config`가 없는 파일
- `CODARYN_CONFIG`가 없는 파일
- 기본 위치 자체가 없음(APPDATA 없음)
- init이 쓴 설정 뒤의 run(`provider_not_configured`)
- `--profile p`(설정 없음)는 main처럼 `profile_needs_config`를 단다. apply 간편 형식은 main처럼 `quick_form_needs_task`를 단다. 둘 다 덮이지 않았다.

### (5) `codaryn help <명령>`과 터미널이 아닐 때의 `--help`

- `help <명령>` 12개와 `<명령> --help` 12개는 터미널에서도, 아닐 때에도 main과 글자까지 같다. 두 언어 모두 확인했다.
- 터미널이 아닐 때의 `--help`, `-h`, `help`는 main과 같은 전체 사용법이다. 인자 없음은 main처럼 `invalid_arguments`(종료 2)다.

### (6) 화살표와 줄 너비

- 처음 순서의 화살표는 두 언어 모두 ASCII `->`다. 새 줄 58개에 ASCII가 아닌 좁은 글자(화살표, 따옴표, 줄표)는 없다.
- 100칸을 넘는 줄은 L-2.

## 판의 시험

고정 판 `2138901`의 사본에서 잰 수치다. APPDATA·LOCALAPPDATA는 임시 폴더로 두었고 키 변수는 없다.

- `npm run test:unit`: 2,962개 중 통과 2,958, 실패 0, 건너뜀 3, todo 1
- `npm run test:integration`: 564/564

PM의 수치(유닛 2962, 실패 0, 통합 564)와 같다.

## 남긴 것

- 판 사본: `.codaryn/R-91/base`, `.codaryn/R-91/head` (지우지 않음).
- 비교 도구와 원본 결과: 검토자 scratchpad의 `r91/` 아래에 있다. 들어 있는 것은 `harness.mjs`, `showdiff.mjs`, `widths.mjs`, `ready.mjs`, `initq.mjs`, `plain-*.json`, `tty-*.json`이다.
