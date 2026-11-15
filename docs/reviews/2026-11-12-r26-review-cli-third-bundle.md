# R-26 검토 보고서: CLI 세 번째 묶음 (`pm/bundle-3` 005e10b)

```
검토자: w3:pA (이 코드의 구현자가 아님). 읽기 전용: 파일 수정·커밋 없음
대상: pm/bundle-3 005e10b (main e75726e + 8개 브랜치). 범위 안의 커밋:
  7547ac1 doctor 키 목적지와 다른 제공자 변수 (DR-36 b)
  5c0b4e1 그 문구 두 언어와 매개변수 검사
  2bffd6f, 8f4de51 SP-0 고정 값의 doctor 줄
  d38a82d models 의 현재 모델 출처 (DR-36 a)
  0f74f0a doctor 의 parked 알림 (DR-37 c)
  5cc0600 changes 의 파일별 표시와 help
  5eda414 approval.adapter, help.command.revert, 폐기 보관함 이름
  fb037da revert dry-run 다음 줄
  be9ee0d, d823802 todo 재현 시험(알려진 것, 건수에 넣지 않음)
기준: DR-36 (a)(b), DR-37 (c), DR-29, docs/cli-contract.md 18.11·19.4, 문구 카탈로그 두 언어
결과: 높음 0, 중간 0, 낮음 2, 참고 6
실행(005e10b 를 이 worktree 의 .codaryn/r26/tree 에 풀어 빌드):
  typecheck 오류 0
  유닛 1755건: 통과 1740, 실패 0, 건너뜀 3, todo 12
  통합 559건 중 559 통과
  PM 수치와 같다
비교: main e75726e 를 .codaryn/r26/main-tree 에 따로 빌드했다
실제 CLI(dist/src/cli/main.js)로 확인:
  - 깨끗한 환경 변수와 임시 홈을 썼다(사용자의 실제 설정을 읽지 않음)
  - 서버는 127.0.0.1 의 가짜 Anthropic·OpenAI 뿐이다
  - 탐침은 .codaryn/r26/probes/ 에 있다
실행하지 않은 것: 실제 API, 외부 네트워크
```

## 1. 중점별 결론

| 중점 | 결론 | 근거(실제 CLI) |
| --- | --- | --- |
| doctor 주소 표시에 사용자 정보·질의 문자열이 나오는지 | 나오지 않음 | 탐침 `doctor.mjs` 10가지 경우(주소 변수와 설정 필드에 사용자 정보·질의·경로·다른 제공자 변수 값을 표지로 넣음), 영어·한국어·JSON 어디에도 표지가 없다. 사용자 정보·`?`·`#`가 든 주소는 주소 규칙(`normalizeApiBaseUrlStrict`)이 먼저 거부하고 거부 글은 필드 이름만 낸다. 받아들인 주소는 `toApiOrigin`으로 스킴·호스트·포트만 낸다(경로의 `path-SECRETP`, `cfg-SECRETC` 없음). 문구 매개변수 `apiOrigin`은 `toApiOrigin`이 만든 꼴만 통과한다 |
| notes 에 값이 새는지 | 새지 않음 | `doctor.model.other_provider_variable`의 매개변수는 변수 이름, 소유 제공자, 실행 제공자뿐이다(`settingEnv`는 정해진 이름 집합). `CODARYN_OPENAI_MODEL`·`CODARYN_OPENAI_API_BASE_URL`에 표지를 넣어도 출력에 값이 없다 |
| JSON 한 줄 계약과 종료 코드 | 그대로 | doctor 10가지, models 7가지, changes 2가지, lock 2가지 모두 JSON 한 줄·ASCII이고, 종료 코드는 main과 같다. doctor JSON에는 `notes`가 더해진다(선택 필드). `message`는 main과 같다. Anthropic의 models 출력(JSON·글·쓴 설정)은 main과 바이트 단위로 같다 |
| 변경 보기의 섞인 표시 | 맞음 | 실제 `codaryn run`(가짜 API, task `secretEnv`)이 README.md(비밀 있음)를 바꾸고 NOTES.md를 만들었다. 다른 비밀로 부르면 README.md 아래에 `the text is not shown (masking_unverified)`, NOTES.md 아래에 차이가 나온다(main은 README.md에 표시가 없었다). 같은 비밀이면 두 파일 모두 차이가 나온다. 비밀 평문 없음. JSON은 main과 같다(토큰 id만 호출마다 다름) |
| 두 언어 문구의 뜻 | 하나 다름 | 새 doctor 문구 5개, `approval.adapter`, `help.command.revert`는 뜻이 같다. `revert.dry_run_next`가 다르다(L-2) |
| DR-36 (a) models | 맞음 | `CODARYN_OPENAI_MODEL`이 있으면 `current.source`·`selected.overriddenBy`가 그 이름이다(main은 null). 목록에 없는 id는 `(not in this list)`. 다른 제공자의 변수는 anthropic의 현재 모델에 쓰이지 않는다 |
| DR-37 (c) parked | 맞음 | 실제 잠금 둘(깨진 `lock.json`, 실제 `codaryn run`이 쥔 잠금)에 parked 파일 2개가 있을 때, 잠금 줄 아래에 parked 줄이 두 언어로 나온다. 잠금 글·JSON `message`·종료 코드 3은 main과 같다 |

## 2. 결과

### 낮음

#### R26-L-1 설정 파일이 검사를 지나지 못하면 doctor가 키의 목적지를 기본 주소로 잘못 말한다(7547ac1)

- **재현(실제 CLI, `CODARYN_LANG=en`·`ko`)**
  - 설정
    - `apiBaseUrl: "http://127.0.0.1:8447/proxy"`(올바름)
    - `limits.maxModelTurns: -5`(틀림)
    - `ANTHROPIC_API_KEY` 설정
  - 출력
    - `[failed] config file ... invalid value at limits.maxModelTurns`
    - `[ok] API key  ANTHROPIC_API_KEY is set; anthropic requests send it to https://api.anthropic.com, the default address`(한국어도 같은 뜻)
  - 한도를 고치면 `... send it to http://127.0.0.1:8447, the address the config field apiBaseUrl sets`로 바뀐다.
  - 설정의 주소 자체가 틀린 경우(사용자 정보, 질의)도 같다(탐침의 D, J).
  - openai 설정이 같은 이유로 틀리면 더 어긋난다.
    - 설정: `provider: "openai"`, `providers.openai.apiBaseUrl: http://127.0.0.1:8448/v1`
    - 출력: `ANTHROPIC_API_KEY is set; anthropic requests send it to https://api.anthropic.com`. 제공자와 주소가 둘 다 다르다.
- **원인**: `runDoctor`는 설정을 읽지 못하면 `config`를 null로 둔다. 그러면 제공자는 anthropic(`quickProvider`)이 되고, `keyDestination`은 기본 주소가 된다.
- **main과 비교**
  - JSON `message`에는 DR-34 (a)부터 같은 주장이 있었다.
  - main의 사람용 글은 `ANTHROPIC_API_KEY is set (its value is not looked at)`이라 목적지를 말하지 않았다.
  - 이 묶음부터 사람이 보는 줄이 틀린 목적지를 말한다.
- **영향**
  - 설정이 틀린 동안 실행은 설정 오류로 멈추므로 키는 어디에도 가지 않는다. 바로 위 줄이 설정 실패를 보인다.
  - 다만 "키가 어디로 가는지"를 알리려고 만든 줄이 사실과 다른 곳을 말한다.
- **권고**
  - 설정 파일이 검사를 지나지 못했고 주소 변수가 없으면, 목적지를 말하지 않는다.
    - 예: 새 문구 `doctor.api_key.destination_unknown` "설정 파일을 고치기 전에는 알 수 없음"
    - 또는 지금의 `doctor.api_key.ok`
  - JSON `message`도 같이 고친다.
  - 주소 변수가 있으면 그것이 설정보다 앞서므로 지금 판정이 맞다.

#### R26-L-2 `revert.dry_run_next` 의 두 언어 뜻이 다르다(fb037da)

- 실제 CLI `revert --workspace ws --run latest --dry-run`
  - en: `Run again without --dry-run to revert.`
  - ko: `실행하려면 --dry-run 없이 다시 실행하세요.`("실행하려면" = to run)
- `fb037da`가 영어만 "to apply" → "to revert"로 고쳤고, 한국어는 그대로다.
- 권고: ko를 `되돌리려면 --dry-run 없이 다시 실행하세요.`로 바꾸고, 카탈로그 시험(`tests/unit/i18n/catalog.test.ts`)이 ko도 확인하게 한다.

### 참고 (건수에 넣지 않음)

- **I-1** 새 목적지 문구는 두 언어 모두 "only"를 뺐다.
  - JSON `message`: `send it only to <origin>`
  - en: `send it to <origin>, ...` / ko: `이 키를 <origin>에 보냅니다`
  - 이 줄의 요점은 "다른 곳에는 보내지 않는다"이므로 `only` / `에만`을 두는 편이 정확하다.
- **I-2** 주소 변수가 규칙을 어기면 `api_key`가 `[ok]`인데 글은 "아무것도 보내지 않습니다"다.
  - 전체 결과는 `model` 점검 실패로 `failed`(종료 1)다.
  - 상태는 main과 같다(새 문제 아님).
- **I-3** (GUI 담당) GUI 엔진 호스트는 `current.source`가 `CODARYN_MODEL`이 아니면 모두 `config`로 바꾼다(`gui/src/engine-host/settings.ts:125`).
  - 이제 `CODARYN_OPENAI_MODEL`이 오므로, GUI는 그 모델을 "설정 파일에서"라고 보이게 된다.
  - 받는 쪽(`gui/src/shared/ipc.ts:336, 359`)도 두 값만 받는다.
- **I-4** `changes`의 이유 줄은 모든 파일에 글이 없을 때도 "no text for some files"라고 한다. 파일마다 표시가 있어 오해는 적다.
- **I-5** 알려진 todo가 실제 출력에도 보인다.
  - `CODARYN_CONFIG`로 준 파일을 `the config file at the default location CODARYN_CONFIG is valid`라고 부른다(`d823802`의 재현 시험).
  - 이번 범위의 변경이 아니다.
- **I-6** `approval.adapter`는 앱 계층이 적용한 실제 기록을 사람용 진행 줄(`applyProgressLine`)로 그려 확인했다.
  - en: `approved in the app` / ko: `앱 화면에서 승인`. 동의 줄 꼴도 같다.
  - `codaryn report`의 Markdown은 이 문구가 아니라 채널 코드(`adapter`)를 그대로 낸다. main과 같다.

## 3. 실행 기록

- 빌드·시험: `.codaryn/r26/{build,typecheck,unit,integration}.txt`
- 탐침은 모두 `.codaryn/r26/probes/` 아래에 있다. 키 값은 `cdy-fake-r26-...` 꼴의 가짜 값이고 키 모양이 아니다.
  - `doctor.mjs`(→ `doctor-probe.txt`): 10가지 경우, 묶음과 main
  - `lock.mjs`(→ `lock-probe.txt`): 깨진 `lock.json`, 실제 실행이 쥔 잠금
  - `models.mjs`(→ `models-probe.txt`): 가짜 OpenAI·Anthropic 서버에 7가지 경우
  - `changes.mjs`(→ `changes-probe.txt`): 실제 `codaryn run` 뒤 같은 비밀과 다른 비밀
  - `approval.mjs`, `approval-line.mjs`: 앱 계층 적용과 사람용 줄
- 끝난 뒤 남은 node·electron 프로세스 없음. worktree 의 추적 파일 변경 없음.

## 4. 고친 것

없음(읽기 전용 검토).
