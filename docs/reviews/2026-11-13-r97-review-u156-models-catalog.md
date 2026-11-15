# R-97 좁은 검토: U-156, models 글을 카탈로그로 (w3:p5 nb-i18n, 2026-11-13)

## 0. 대상과 방법

- 읽기 전용이다. 저장소 수정·커밋은 없다. 실제 API와 바깥 네트워크는 쓰지 않았다.
  - 모델 목록은 127.0.0.1의 가짜 Anthropic 서버다. 키는 가짜 값이다.
  - 모든 CLI 호출에 시험의 네트워크 막이를 얹었다.
- **판 `pm/unit-U-156` = `cac4ed0`**(main `d435c63` + `unit/U-156-na-core` `663f9f4`), 7파일 +272 −15
  - 제품: `src/cli/models.ts`, `src/cli/main.ts`(카탈로그 넘김), `src/contracts/human.ts`(id 15개), `src/i18n/en.ts`·`ko.ts`, `docs/cli-contract.md` 한 줄
  - 시험: `tests/unit/cli/g-u156-models-korean.test.ts`
- 사본: `.codaryn/r97/base`(`d435c63`), `.codaryn/r97/u`(`cac4ed0`). 둘 다 `tsc` 0이다.
- 실험(`.codaryn/r97/r97.mjs`, 로그 `r97.log`)
  - A: 두 판의 실제 CLI를 `CODARYN_LANG=en`으로 견줬다. 글 13경우, `--json` 10경우.
    - 견준 것: 종료 코드, stdout, stderr, 쓴 설정의 `model`
    - 터미널 질문 셋은 stdin·stdout을 터미널로 흉내 냈다.
  - B: `renderModels`를 프로세스 안에서 불렀다.
    - OpenAI 쪽 이름(`CODARYN_OPENAI_MODEL`, `providers.openai.model`)
    - 대체 넷: 카탈로그 없음, 영어 카탈로그, 늘 던지는 카탈로그, 카탈로그가 받지 않는 변수·필드
    - 제어 문자가 든 모델 id·이름
  - C: 같은 경우의 한국어 출력을 읽었다.
- 수치(고정 판 트리 `cac4ed0`, 내 worktree에서 분리 체크아웃해 dist를 지우고 빌드한 뒤 원래 브랜치로 돌아옴)
  - typecheck 0
  - 유닛 3284(통과 3279, 실패 0, 건너뜀 4, todo 1)
  - 통합 590/590

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 0 |
| 정보 | 3 (R97-I1~I3) |

| 볼 것 | 결과 |
| --- | --- |
| (1) 두 언어 글이 U-154 표와 같은가 | **같다.** id 15개, 매개 이름과 종류(`count`, `variable: settingEnv`, `field: field`), 영어 15개, 한국어 14개가 표와 글자까지 같다. 다른 하나는 `models.table.id`의 한국어 "모델 id"(표는 "id")다. PM 결정대로다 |
| (2) 영어 출력이 예전과 같은가 | **같다.** 23경우(글 13, `--json` 10) 모두 종료 코드·stdout·stderr·쓴 설정이 바이트까지 같다(다른 경우 0) |
| | - 글 13경우: 목록, 목록에 없는 현재 모델, 현재 모델 없음, `CODARYN_MODEL`에서 온 현재 모델, `--use`(기록 / 파일 새로 만듦 / 덮어씀 알림), 빈 목록, 이름의 제어 문자, `--use` 오류, 터미널 질문(Enter, 2, 입력 끝) |
| | - 프로세스 안: OpenAI 쪽 이름으로도 세 대체 모두 main과 같다 |
| (3) 카탈로그가 없거나 글을 못 줄 때 | **영어 그대로다.** 카탈로그 없음과 늘 던지는 카탈로그 모두 main과 같다 |
| | - `{field}`가 필드 경로가 아니면 그 줄만 영어다(`toSchemaFieldPath` 확인) |
| | - `{variable}`이 모델 변수가 아니면 카탈로그 규칙대로 "?"가 된다(I1) |
| | - 앱 계층(GUI)은 카탈로그 없이 `runModels`의 JSON만 쓴다(`src/app/app.ts:569`). 영향이 없다 |
| (4) 바깥 값의 가림·제어 문자 | **예전과 같다.** 모델 id·이름은 그리는 쪽이 `cleanText`로 넣는다(표, 현재 모델, 기록). 글에 들어가지 않는다 |
| | - 이름의 ESC·BEL·줄바꿈·탭은 두 판 모두 `?`다: `Odd?[31mRed??Name?Tab` |
| | - 한국어 출력에도 제어 문자가 남지 않는다 |
| | - 표 전체는 예전처럼 `scrub`·`hideKeys`를 거친다 |
| (5) JSON | **그대로다.** `--json` 10경우가 main과 같다. 같은 판의 한국어와 영어 `--json`도 같다 |

## 2. 한국어 출력 (C, 읽음)

```
이 키로 쓸 수 있는 모델(2개):

  #  모델 id     이름         입력 토큰  출력 토큰
* 1  fake-r97-a  Fake A          200000       8192
  2  fake-r97-b  Fake B 한글          -          -

* 현재 모델(CODARYN_MODEL에서): fake-r97-a
기록함: fake-r97-b — 이제 설정 파일의 model 값입니다.
참고: CODARYN_MODEL 변수가 있어, 지울 때까지 설정 파일의 model 대신 그 값을 씁니다.
```

- 열은 터미널 칸으로 맞는다. 한글 머리와 한글 이름이 섞여도 같다(U-127).
- 그 밖의 줄
  - "현재 모델이 없습니다(CODARYN_MODEL에도 설정 파일에도 없음). --use <번호|id> --config <config.json> 옵션으로 고르세요."
  - "(이 목록에 없음)"
  - "…값입니다(파일을 새로 만듦)."
  - 터미널 질문 "설정 파일의 model에 쓸 번호나 id(Enter면 건너뜀): "
- 표에 있는 그대로다.

## 3. 정보

- **R97-I1 카탈로그가 받지 않는 `{variable}`은 영어가 아니라 "?"가 된다.**
  - 실제 CLI가 넘기는 값은 늘 모델 변수다: `API_PROVIDERS`의 `CODARYN_MODEL`·`CODARYN_OPENAI_MODEL`, 현재 모델의 출처, 덮어쓰는 변수. 그래서 실제로는 생기지 않는다.
  - 프로세스 안에서 다른 이름을 주면 한국어·영어 카탈로그 모두 "현재 모델이 없습니다(?에도 …)"다. 맞지 않는 값은 보이지 않는다는 카탈로그 규칙(`src/i18n/params.ts` `REPLACEMENT`)이다.
  - main은 그 이름을 그대로 냈다.
  - `{field}`는 `models.ts`가 먼저 확인해 영어 줄(값 그대로)로 돌린다. 두 매개의 처리가 다르다.
  - `models.ts` 주석의 "a text the catalog cannot give (an id or value it refuses) is the English one"은 `{variable}`에는 맞지 않는다. 고칠 필요는 낮다. 맞추려면 `{variable}`도 모델 변수인지 먼저 확인하면 된다.
- **R97-I2 `models.table.id` "모델 id"**: 카탈로그 시험(한글 요구) 때문에 들어왔고 PM이 그대로 둔다. `runs.column.run_id` "실행 id (UTC)"와 같은 꼴이라 어색하지 않다.
- **R97-I3 언어가 바뀌는 조건**: `models`의 글은 이제 고른 언어를 따른다(`CODARYN_LANG`, 설정, OS 언어). 예전에는 늘 영어였다.
  - OS가 한국어이고 아무것도 정하지 않은 사람에게는 표가 한국어로 바뀐다.
  - 의도한 변화다(E 묶음). 계약 762행에 적혔다.

## 4. 검사하지 않은 범위

- 실제 OpenAI 목록 요청. OpenAI 쪽은 프로세스 안의 `renderModels`로만 보았다.
- 실제 터미널(흉내만)
- GUI(바뀌지 않음)

## 5. PM 판단 필요

없다. 사용자에게 물을 질문도 없다.
