# R-46 병합 전 검토: 단위 U-20 — GUI 오류 문구와 기록 변경 표시

## 0. 대상과 방법

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 이 코드는 내 것이 아니다. 읽기 전용이며, 저장소 파일 수정과 커밋은 없다.
- **검토한 판(고정)**: `unit/U-20-p5u-gui` = `ddeea1fc57cac27d668e415364c819a3215baaa7`
  - 커밋은 하나이고 작성자는 `gangdonggil`이다.
  - 기준은 `ebb54d80de3666e86c2fd78537b1827f0506760a`(U-12 병합)다. `git diff ebb54d8 ddeea1f`: 16개 파일, 208줄 더함, 18줄 뺌.
- 빌드와 시험(`git archive`로 `.codaryn/r46/`에 풀었다)
  - Electron은 `claude-gui` 작업 공간에 설치된 45.3.1의 `gui/node_modules`를 복사해 썼다. 새로 설치하거나 내려받지 않았다.
  - 두 판에서 돌렸다.
    - `b/`: `ddeea1f` 그대로
    - `m/`: 지금 main `a9a98fd`(U-7, U-8 병합)의 루트에 `ddeea1f`의 `gui/`만 얹은 사본. git worktree가 아니다.

  | 판 | 루트 빌드 | GUI 유닛(`npm test`) | GUI 연기(`npm run test:smoke`) |
  | --- | --- | --- | --- |
  | `ddeea1f` | 종료 0 | 152건 통과, 실패 0 | 158/158 통과, 앱 종료 0 |
  | main `a9a98fd` + `ddeea1f`의 `gui/` | 종료 0 | 152건 통과, 실패 0 | 158/158 통과, 앱 종료 0 |

  - 연기 시험의 바깥 요청 확인: `transportRefused` `refused: 0`, `sockets` `outside: 0`, `noDictionaryDownload: []`, `fetchHttp`·`fetchFile` `blocked`. 기록 변경 표시 셋(`runsRecordsChanged`, `runsUnmarked: 1`, `reportRecordsChanged`)도 통과했다.
  - 연기 시험의 `NOTE --inspect-brk`(GU-9)는 전부터 있던 알림이다.
- 실제 CLI와 앱 계층 실험
  - 모델은 대본 모델이고 작업 공간은 임시 폴더다. API 주소는 닫힌 포트 `127.0.0.1:9`이고 키 변수는 없앴다. 실제 API와 외부 네트워크는 쓰지 않았다.
  - `r46/texts.mjs`: 빌드된 두 카탈로그에서 15개 코드의 문구를 나란히 뽑았다.
  - `r46/r46-exp.mjs`: 같은 작업 공간에서 CLI의 `runs`·`report`와, 창이 받는 값을 비교했다. 창이 받는 값은 앱 계층 `listRuns`·`report` → 엔진 호스트 `runsValue`·`reportValue` → 메인 `toRunsReply`·`toReportReply`를 거친 것이다.
  - `r46/r46-plan.mjs`: UXM-24의 새 안내를 따라 `codaryn plan`을 실행했다.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 2 (L-1, L-2) |
| 정보 | 2 (I-1, I-2) |

| 확인할 것 | 결과 |
| --- | --- |
| 오류 코드 15개의 뜻 | **15개 모두 CLI 카탈로그(what + fix)와 뜻이 같다**(2.1). 고치는 법은 CLI 명령 대신 화면 이름으로 말한다. 그중 하나가 없는 화면을 가리킨다(L-1) |
| 값이 들어가는지 | **들어가지 않는다.** 15개 문구에는 자리표시자가 없다. 창은 오류를 고정 문구 + `error.code`(코드 이름)로만 보이고(`errorText`, 호출 16곳), 엔진의 `message`를 붙이지 않는다 |
| 기록 변경 표시의 조건 | **CLI의 `runs`·`report`와 같다.** 둘 다 실행 폴더의 `records-changed.json` 유무(store `recordsChangedMarkIn`, `lstat`)를 쓴다. 여섯 경우에서 결과가 같았다(2.2). 표시가 있는 계획은 창이 적용 단추를 숨기고, CLI의 `apply`는 `plan_records_changed`(종료 2)로 거부한다 |

## 2. 확인 결과

### 2.1 오류 코드 15개(`ENGINE_CODES`)

| 코드 | CLI(what / fix의 뜻) | 창 | 판단 |
| --- | --- | --- | --- |
| `provider_not_configured` | 키·모델·출력 상한 설정이 덜 돼 보내지 않음 / `doctor`로 확인 | 같음 / "처음 설정이나 점검 화면" | 뜻 같음. "처음 설정" 화면이 없다(L-1) |
| `key_in_file` | task·설정 파일이나 목표에 키 필드·키 값 / 지우고 환경 변수로 | 설정 파일이나 목표에 키 값 / 지우고 환경 변수로, 변수 이름은 설정 화면 | 뜻 같음. 창은 task 파일을 받지 않으므로 범위를 좁게 말한 것이다. 설정 화면에 "Key ({env})"가 있다 |
| `plan_records_changed` | 기록 변경 표시, 묻거나 바꾸지 않음 / 새 계획 | 같음 / 같은 작업 종류로 새 계획 | 같음(U-10) |
| `plan_not_approved` | 승인 안 됨, 바꾸지 않음 / `--digest`로 승인 | 같음 / 계획 화면에서 다시 열어 적용 | 같음 |
| `invalid_run_record` | 기록을 읽거나 해석할 수 없음 / `.codaryn/runs` 확인 | 같음 | 같음 |
| `invalid_task` | task를 읽을 수 없거나 값이 틀림 / 필드 고치기, `doctor --task` | 같음 / 점검 화면 | 같음 |
| `secret_env_missing` | 가릴 값으로 정한 변수가 없음 / 설정하거나 이름 빼기 | 같음 / 설정 화면의 가릴 값(영어 "Secret names") | 같음. 설정 화면에 그 목록이 있다 |
| `workspace_is_install_dir` | 설치 위치와 겹침 / 다른 폴더 | 같음 | 같음 |
| `workspace_not_found` | 폴더를 찾을 수 없음 / 경로 확인 | 같음 / 그대로 있는지 보고 다시 열기 | 같음 |
| `model_list_failed` | 목록을 못 가져옴 / 키·네트워크, 나중에 | 같음 | 같음 |
| `provider_not_implemented` | 지원하지 않는 제공자 / `model.provider` 고치기 | 같음 / 설정 화면에서 고르기 | 같음. 설정 화면에 "Provider to use"가 있다 |
| `invalid_script` | 대본을 읽을 수 없거나 형식이 틀림 / cli-contract 4절 | 같음 / 사용 안내의 대본 형식 | 같음(I-2) |
| `invalid_arguments` | 명령 인수가 틀림 / `help` | 요청의 값이 틀림, 아무것도 안 함 / 다시, 되풀이되면 알림 | 같음. 창에서는 내부 요청의 잘못이라 알맞다 |
| `config_exists` | 이미 있어 쓰지 않음 / 그 파일을 고치거나 다른 위치 | 같음 / 설정 화면에서 내용 바꾸기 | 같음 |
| `internal_error` | 예상하지 못한 내부 오류 / 다시, 되풀이되면 알림 | 같음 | 같음 |

- 두 언어 모두 같은 뜻이다. 한국어 문구의 용어는 DR-50과 맞다(작업 종류, 가릴 값).

### 2.2 기록 변경 표시(`r46-exp.mjs`)

| 실행 | 디스크의 표시 | CLI `runs` | 창 `runs` | CLI `report` | 창 `report` |
| --- | --- | --- | --- | --- | --- |
| 표시 없음 | 없음 | 없음 | 없음 | 없음 | 없음 |
| 손으로 만든 `records-changed.json` 파일 | 있음 | 있음(글에 "records changed") | 있음 | 있음(글에 "records-changed mark") | 있음 |
| 같은 이름의 폴더 | 있음 | 있음 | 있음 | 있음 | 있음 |
| 계획 실행. 뒤의 실행이 허용한 명령으로 그 `result.json`을 고침(엔진이 붙인 표시) | 있음 | 있음 | 있음 | 있음 | 있음 |
| 그 고친 실행 자신(`failed`/`state_changed`) | 있음 | 있음 | 있음 | 있음 | 있음 |
| 손상된 실행(`result.json` 깨짐) + 표시 | 있음 | `damaged`, 표시 없음 | `damaged`, 표시 없음 | `invalid_run_record` | `invalid_run_record` |

- 표시가 있는 계획 실행의 `apply --digest`: 종료 2, `plan_records_changed`
- 창의 계획 화면은 실행 목록에서 연 계획에만 미리 알린다(`marked`). 다른 길로 열면 알림 없이 적용 단추가 보이지만, 엔진이 거부하고 `error.plan_records_changed` 문구가 나온다. 막는 쪽은 엔진이므로 결과는 같다.

## 3. 낮음

### L-1 `provider_not_configured`의 창 문구가 없는 화면("처음 설정")을 가리킨다

- 어디: `gui/src/renderer/i18n/en.ts`·`ko.ts`의 `error.provider_not_configured`
  - 영어: "See what is missing in First setup or Checks."
  - 한국어: "처음 설정이나 점검 화면에서 빠진 것을 확인하세요."
- 사실: 창의 화면 목록(`nav.*`)은 작업 공간, 점검, 설정, 새 작업, 실행, 실행 목록, 계획, 변경, 기록 정리, 보고서다. "처음 설정"(First setup)이라는 화면이나 구역은 카탈로그 어디에도 없다. 이 문구에만 나온다.
- 영향
  - 키나 모델이 없을 때 처음 쓰는 사람이 가장 먼저 보는 오류다. 그런데 찾을 수 없는 곳을 먼저 가리킨다.
  - 같은 문장에 점검 화면이 함께 있어 막히지는 않는다.
  - UXM-24의 취지("따를 수 없는 안내를 하지 않는다")와 어긋난다. 이번 시험은 CLI 명령 이름만 검사한다(`codaryn (doctor|help|apply)`).
- 권고(GUI 문구): 있는 화면으로 바꾼다. 예: "설정 화면(제공자, 모델, 키 변수 이름)이나 점검 화면에서 빠진 것을 확인하세요." 시험에는 문구가 가리키는 화면 이름이 `nav.*`에 있는지를 더한다.

### L-2 계획 화면의 한국어 안내가 "붙여 쓸 적용 명령"을 약속하지만, `codaryn plan`은 채워야 하는 틀을 보인다

- 어디: `plan.formUnknown`(UXM-24로 바뀐 문구)
  - 한국어: "…codaryn plan으로 실행 {runId}의 계획을 열면 붙여 쓸 적용 명령을 알려 줍니다."
  - 영어: "…it tells the apply command to use."
- 재현(`r46-plan.mjs`, 이 판의 루트 CLI)
  - task 파일로 시작한 계획 실행에 `codaryn plan --task <파일> --run <id>`를 쓰면 종료 0이다.
  - 출력의 안내 줄은 `To apply it: codaryn apply <the same task form> --run <run id> --digest <digest>`이다. `CODARYN_LANG=ko`에서도 이 줄은 영어다.
  - 이 줄을 그대로 실행하면 종료 2, `invalid_arguments`다. `<the same task form>`을 시작한 방식(`--task <파일>` 등)으로 바꿔야 한다.
- 영향
  - 고친 안내가 실행할 수 있는 명령(`codaryn plan`)으로 가는 점은 맞다. UXM-24의 결함은 닫혔다.
  - 다만 한국어 문구는 그대로 붙여 넣으면 되는 것처럼 말한다. 영어 문구는 그보다 정확하다.
  - DR-51(다음 명령 안내에 작업 공간 경로를 넣는다)이 들어오면 일부는 해결된다. 그래도 task 파일 형식은 사람이 채워야 한다.
- 권고(GUI 문구): 한국어를 "적용 명령의 형식을 알려 줍니다. 작업 지정 부분(`<the same task form>`)은 실행을 시작한 방식 그대로 채우세요."처럼 바꾼다. CLI 안내 줄의 한국어화는 CLI·문구 담당 몫이다.

## 4. 정보

- **I-1 새 영어 문구가 "task kind"를 쓴다.** DR-50은 영어를 "task type"으로 정했다. 예: `plan.recordsChanged`("…with the same task kind…"), `plan.formUnknown`, U-10의 `error.plan_records_changed`.
  - DR-50(main `565a93c`)은 이 단위의 기준(`ebb54d8`)보다 뒤에 기록됐으므로 이 단위의 결함은 아니다.
  - U-24의 GUI 몫에 이 문구들을 넣어야 한다. 한국어는 이미 DR-50과 맞다.
- **I-2 `invalid_script`의 "사용 안내의 대본 형식"**: 사용 안내에는 대본 형식이 없다. 3절 "대본을 직접 쓸 때"가 CLI·공통 계약 4절로 링크할 뿐이다. 링크를 따라가면 찾을 수 있어 뜻은 통한다. "사용 안내 3절이 가리키는 대본 형식"이 더 정확하다.

## 5. PM 판단 필요

- **P-1(L-1)**: "처음 설정"을 없는 화면으로 보고 문구를 고칠지, 처음 설정 화면을 만들 계획(DR-46의 `init`이 제공자를 묻는 것과 같은 흐름)이 있어 이름을 미리 쓴 것인지
- **P-2(L-2)**: 한국어 문구만 고칠지, CLI `plan`의 안내 줄을 붙여 쓸 수 있는 명령으로 만드는 일(DR-51과 함께)까지 볼지

사용자에게 물을 질문은 없다.

### 문서 담당 메모(내 몫, 이 검토의 결과가 아님)

- `r46-exp.mjs`에서, 다른 실행의 `result.json`을 고친 실행은 자기에게도 표시가 붙고 `failed`/`state_changed`로 끝났다. 고쳐진 계획 실행에도 표시가 붙었다.
- 사용 안내 16절과 개인정보 8절의 "표시가 붙는 것"(R-41 L-1)을 고칠 때 이 결과를 쓴다. store 담당의 정확한 조건 보고를 기다린다.

## 6. 실행한 것

- 읽기: `git diff ebb54d8 ddeea1f`(GUI 문구, 엔진 호스트, 메인 IPC, 화면, 시험, 설계 문서 한 줄)
- 빌드와 시험: 위 0절 표(두 판)
- 실험: `texts.mjs`, `r46-exp.mjs`, `r46-plan.mjs`(출력은 `.codaryn/r46/`)
- 저장소 파일 변경과 커밋 없음. 실제 API·외부 네트워크 미사용. 새 설치·내려받기 없음.
