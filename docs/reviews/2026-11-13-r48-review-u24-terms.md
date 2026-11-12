# R-48 병합 전 검토: 단위 U-24 (용어 통일, DR-50)의 문구·문서 몫

```
검토자: w3:pA (이 문구·문서의 작성자가 아님). 읽기 전용: 저장소 파일 수정·커밋 없음
대상: 고정 판 pm/unit-U-24 338f28d 중 src/i18n, tests/unit/i18n, README.md, docs (main 00d18aa 기준. gui/ 는 보지 않음)
  커밋: 1bf61b0(문구), 2ceed59·b1314aa(문서). 8개 파일 +217/-196
기준: DR-50(docs/work-orders/phase-4-5-design.md:147), UXM-16, ux-design.md 5절의 용어표
결과: 높음 0, 중간 0, 낮음 5, 참고 6
직접 실행(338f28d 를 이 worktree 의 .codaryn/r48/tree 에 풀어 빌드):
  빌드 0, typecheck 0
  유닛·통합은 PM 이 이 판에서 돌린 수치를 받았고 다시 돌리지 않았다
  CLI 를 실제로 돌렸다:
    - 저장소 밖 임시 폴더(scratchpad\r48)
    - 키와 CODARYN_* 를 뺀 환경, 기본 설정 위치는 빈 폴더
    - 문서가 인용한 언어(영어, 일부 한국어)로
    - 대본 모델만 썼다. 실제 API·네트워크 없음
```

## 1. 결론 요약

- 카탈로그(두 언어)
  - 옛 용어가 남은 곳이 없다. 새 시험(`catalog.test.ts:370`)이 막는 낱말(행동, 워크플로, `workflow`, `digest`, 비밀, 단독 보관함 / workflow, task kind, discard box, run archive)을 넘어, 비슷한 다른 말(보관 폴더, 해시, 지문, 민감, 숨길 값, archive, bin, box 등)까지 전수로 찾았다.
  - 보호 경로(쓰기 막음, `protected path`)와 보호 대상(사후 확인·보고서 절, `protected material`)은 두 언어에서 같은 항목끼리 짝이 맞는다.
- 이름·필드·코드
  - 잘못 바꾼 곳이 없다. 바뀐 줄의 코드 표기(`…`) 353개 가운데 달라진 것은 privacy.md에 새로 붙은 `secretEnv` 하나다(참고 I-1).
  - 코드 블록 줄은 하나도 바뀌지 않았다. 그래서 인용 출력 몇 곳이 옛 글로 남았다(L-1).
- 인용 출력: 표본 18곳을 실제로 돌려 맞대었다(4절). 15곳은 같다. 3곳은 이 판의 출력과 다르고, 셋 다 이번 용어 바꿈 때문이다(L-1).
- 뜻
  - 카탈로그의 바꿈은 뜻이 그대로다.
  - 문서에서 "비밀"을 "가릴 값"으로 바꾼 것도 뜻이 그대로다. 예전 "비밀"이 키, `secretEnv`, 변수 파일 값을 아우르던 말이고, 지금 "가릴 값"이 그 자리에 선다(privacy.md "7. 가릴 값: secretEnv, 키, 변수 파일 값").
  - 뜻이 갈린 곳은 하나다. "보호 대상"을 "보호 경로"로 바꾼 몇 곳이 보고서의 절과 사후 확인까지 쓰기 막음의 이름으로 부르게 됐다(L-2).

## 2. 낮음

### R48-L-1 문서가 인용한 출력 넷이 이 판의 출력과 글자가 다르다 (옛 "workflow")

카탈로그는 바뀌었고 문서의 인용(코드 블록·인라인 코드)은 그대로다. 아래는 모두 이 판의 실제 CLI로 재현했다.

| 곳 | 문서 | 이 판의 실제 출력 |
| --- | --- | --- |
| `docs/usage.md:458` | `a run of this workflow leaves out command rules of the configured policy: 1` | `a run of this task type leaves out command rules of the configured policy: 1` |
| `docs/usage.md:459` | `a run of this workflow does not restore path tokens, although …` | `a run of this task type does not restore path tokens, although …` |
| `docs/usage.md:908` | `codaryn: run started — provider scripted · the workflow's own rules turn off …` | `codaryn: run started — provider scripted · the task type's own rules turn off …` |
| `docs/usage.md:913`(인라인) | `codaryn: 실행 시작 — 모델 제공자 scripted · 작업 종류(workflow) 자체 규칙 때문에, …` | `codaryn: 실행 시작 — 모델 제공자 scripted · 작업 종류 자체 규칙 때문에, …` |

- 재현
  - 458·459: `doctor --config <정책에 명령 규칙 하나와 restorePathTokens: true, 프로필 org = workflowRef "organize"> --workspace … --profile org`
  - 908·913: `examples/organize-demo`의 task에 `restorePathTokens: true`를 준 `run`(en·ko)
- 908의 둘째 구절(`the workflow's own checks leave out …`)도 카탈로그에서 `the task type's own checks …`로 바뀌었다. 같은 id 검증기 경우는 돌리지 않았다(카탈로그 글로 확인).
- 권고: 네 곳을 이 판의 출력으로 바꾼다. 913은 "작업 종류(workflow)"의 괄호를 뺀다.

### R48-L-2 문서가 보고서의 "보호 대상" 절과 사후 확인을 "보호 경로"라고 부르게 됐다

- 위치: U-24가 "보호 대상," → "보호 경로,"로 바꾼 줄 가운데 보고서 절을 말하는 셋
  - `docs/usage.md:590`
  - `docs/usage.md:1028`
  - `docs/cli-contract.md:557`
- 근거
  - 보고서는 그 절을 `## Protected material`로 낸다(실제 출력, en·ko 모두 영어). 카탈로그의 한국어는 그것을 보호 대상이라 한다.
    - `help.command.report`: "상태, 검증, 보호 대상, 변경, …"
    - `advice.protected_changed`: "보고서의 보호 대상 절을 보고…"
  - 용어표(`docs/design/ux-design.md` 5절)도 같다. integrity check는 "보호 대상 확인"이고, 상태 표의 안내는 `보고서의 "보호 대상" 절`이다.
  - 같은 usage.md 안에서도 843줄은 "보호 대상 절"이라 하고 590·1028줄은 "보호 경로"라 한다.
- 같은 갈래(뜻은 통하나 출력과 이름이 다름)
  - `docs/cli-contract.md:511`의 절 제목 "### 보호 경로 무결성"(출력은 `보호 대상 확인`)
  - `docs/cli-contract.md:157`, `docs/usage.md:560`의 `protectedChanged` 설명 "바뀐 보호 경로"(카탈로그는 `reason.protected_changed` "보호 대상이 바뀌어…")
- 권고: 보고서 절 셋은 "보호 대상"으로 되돌린다. 무결성 절 제목과 `protectedChanged` 설명은 "보호 대상 확인"·"바뀐 보호 대상"으로 맞춘다. 아니면 "보호 경로의 무결성(출력: 보호 대상 확인)"처럼 출력 이름을 함께 적는다.

### R48-L-3 등록한 값을 가리키는 "비밀"이 사용자 문서에 남았다

DR-50의 "가릴 값"은 등록해 가리는 값(키, `secretEnv`, 변수 파일 값)이다. 아래는 그 뜻인데 "비밀"로 남았다.

- `docs/privacy.md:95`: 항목 제목 "**끊긴 비밀**"의 본문이 "등록한 가릴 값이 … 끊긴 형태도 가린다"다. 한 항목 안에서 두 말을 쓴다.
- `docs/privacy.md:6`, `:257`, `:266`: "끊긴 비밀"(같은 개념, DR-40)
- `docs/usage.md:647`: "글은 지금 등록된 가릴 값으로 가린 것이다. … 비밀 자리는 토큰…"(같은 문장의 앞은 가릴 값)
- `docs/privacy.md:60`: "비밀 파일 내용 등록"(가릴 값을 파일에서 등록하는 설계 항목)

등록 여부와 상관없이 민감한 내용 일반을 뜻하는 "비밀"은 다른 개념이라 남겨도 된다고 봤다. 부록 A에 사용자 문서 다섯의 남은 "비밀"을 모두 나누어 적었다.

### R48-L-4 기준 용어표(ux-design.md 5절)의 폐기 줄이 DR-50과 다르다

- `docs/design/ux-design.md` 5절 discard 줄은 "폐기(보관함으로 옮김) / discard (moved to the run archive)"다.
  - DR-50은 폐기 보관함 / discarded files다.
  - UXM-16은 이 표를 기준으로 갱신하라고 했다. 이 판은 이 파일을 바꾸지 않았다.
- 같은 표의 `secretEnv` 영어는 "secret variables"다. 카탈로그 영어는 "secrets"다(DR-50은 영어를 정하지 않음).
- 권고: 표의 폐기 줄을 DR-50에 맞춘다. 다른 줄(가릴 값, 보호 경로, 보호 대상 확인, 작업 종류/task type, 다이제스트)은 이미 맞다.

### R48-L-5 영어 카탈로그가 폐기 보관함 폴더를 두 가지로 쓴다

- "the discarded files folder": `revert.action.restored_from_discard`, `help.command.revert`
- "discarded-files folder(s)": `cleanup.done`, `cleanup.warning.people_files`
- 한국어는 모두 "폐기 보관함"이다. 한 표기로 맞추기를 권한다. DR-50의 "discarded files"에 맞추면 "discarded-files folder"가 낫다.

## 3. 참고 (건수에 넣지 않음)

- **I-1** 이름·필드·코드 확인
  - 바뀐 줄의 인라인 코드 353개 중 달라진 것은 `docs/privacy.md`에 더해진 `secretEnv` 하나(설명에 필드 이름을 붙임)다.
  - 옵션(`--workflow`, `--digest` 등), JSON 필드(`workflowRef`, `planActions`, `secretEnv` 등), 오류 코드는 그대로다.
  - 카탈로그도 `--digest <다이제스트>`처럼 옵션 이름은 두고 자리 표시만 바꿨다.
- **I-2** `docs/README.md:38`의 링크 이름 "범용 작업 워크플로"는 설계 문서 `docs/design/general-tasks.md`의 제목("범용 작업 워크플로 설계")을 따른 것이다. 설계 문서들은 이 단위 범위 밖이다. 사용자 색인에서는 "작업 종류"로 바꾸는 편이 맞다.
- **I-3** 다이제스트의 자리 표시가 셋이다(모두 코드 안이라 허용 범위).
  - `README.md:46`·`docs/usage.md:1180`: `--confirm <digest>`
  - `docs/usage.md:933`: `--digest <다이제스트 앞 12자>`
  - 카탈로그 ko: `--digest <다이제스트>`
- **I-4** `docs/usage.md:697`, `docs/privacy.md:258`의 "여러 줄인 가릴 값"(예전 "여러 줄 비밀")
  - 문법은 맞다(여러 줄 + 인).
  - 다만 "줄인"이 "줄인(줄여진)"으로 읽힐 수 있다. "여러 줄로 된 가릴 값"이 덜 헷갈린다.
- **I-5** U-13과의 순서
  - 이 판에는 U-13이 없어 `cleanup.warning.discarded_left`가 옛 동작("기록은 지워짐")을 말하지만, 이 판에서는 맞다.
  - U-13의 문구 브랜치(`unit/U-13-nb-i18n` e853522)가 그 글을 고치고 새 글 둘을 더한다. 여섯 글 모두 U-24 용어 시험의 규칙을 지킨다(직접 대조).
  - `git merge-tree`로 이 판과 지금 main(4654296), 이 판과 U-13 문구 브랜치가 각각 충돌 없이 합쳐진다.
- **I-6** 범위 밖 개발 문서(이 판이 바꾸지 않음)에 옛 용어가 남은 수. 다음 단위에서 범위를 정할 재료다.
  - `docs/architecture.md`: 워크플로 9, 단독 보관함 7, 비밀 4, 행동 3
  - `docs/decisions.md`: 워크플로 9, 단독 보관함 6, 비밀 4
  - `docs/decision-register.md`: 비밀 14, 단독 보관함 13, 행동 6
  - `docs/roadmap.md`: 워크플로 5, 단독 보관함 3
  - `docs/progress.md`·`unit-test-plan.md`·`testing.md` 등: 비밀
  - 결정 기록과 검토 보관본은 그때의 말을 두는 것이 맞다.

## 4. 인용 출력 표본 (3)

- 출력에서 실행 id, 다이제스트, 시각, 걸린 시간, 바이트 수, 기록 수를 정규화한 뒤 줄 단위로 맞대었다.
- 영어 출력은 `CODARYN_LANG=en`(문서의 인용이 영어), 한국어는 `ko`로 돌렸다.

| # | 문서 | 명령 | 결과 |
| --- | --- | --- | --- |
| 1 | usage.md:67 (33줄) | 3절 `run --task demo` | 같음 |
| 2 | usage.md:112 | 3절 `runs` | 같음 |
| 3 | usage.md:121 | 3절 `report --run latest`(stderr) | 같음 |
| 4 | usage.md:129 | 3절 `revert --dry-run` | 같음 |
| 5 | usage.md:138 | 3절 `revert` | 같음 |
| 6 | usage.md:146 | 3절 두 번째 `revert` | 같음 |
| 7 | usage.md:62(인라인) | 3절 `doctor`의 API key 줄 | 같음 |
| 8 | usage.md:942 (16줄) | 18.2 계획 실행 `run` | 같음 |
| 9 | usage.md:966 | 18.2 `plan` | 같음 |
| 10 | usage.md:977 (19줄) | 18.2 `apply --digest <12자>` | 같음 |
| 11 | usage.md:1005 (15줄) | 18.2 적용 실행 `report` 앞부분 | 같음 |
| 12 | usage.md:1032 | 18.2 `revert --dry-run` | 같음 |
| 13 | usage.md:177 | `init`(터미널 아님) | 같음 |
| 14 | usage.md:516 | 설정 없이 한 줄 실행 | 같음 |
| 15 | usage.md:1193 (3줄) | `cleanup`(요약만) | 형식 같음(수는 작업 공간 상태라 다름) |
| 16 | usage.md:456–459 | `doctor --profile`(작업 종류 규칙) | **다름**: 2줄(L-1) |
| 17 | usage.md:908 | 작업 종류 규칙이 있는 `run`(en) | **다름**(L-1) |
| 18 | usage.md:913(인라인) | 같은 `run`(ko) | **다름**(L-1) |

모든 명령의 종료 코드도 문서와 같았다: run 0, 계획 실행 3, apply 0, 설정 없는 실행 7, doctor 0.

## 5. 카탈로그가 아닌 코드에 박힌 사람용 글의 옛 용어 (5, 다음 단위의 재료)

- 찾은 범위: `src/`(`src/i18n` 제외)의 문자열 리터럴 가운데 공백이 있는 것(식별자·키·코드 제외). 주석은 뺐다. `gui/`는 이 판 범위 밖이라 보지 않았다.
- 한국어 옛 용어는 0곳, 영어 `workflow`는 19곳이다(task kind, discard box, run archive는 0곳).

| 파일:줄 | 글(앞부분) | 누가 보는가 |
| --- | --- | --- |
| `src/cli/progress.ts:43` | the workflow's own rules leave out command rules of the configured policy | 사람용 렌더러가 없을 때의 진행 줄(`run.ts:776`). 주석은 "카탈로그 영어의 말"이라 하는데 카탈로그는 task type으로 바뀌어 어긋남 |
| `src/cli/progress.ts:45` | the workflow's own rules narrow command rules … | 위와 같음 |
| `src/cli/progress.ts:47` | the workflow's own rules leave out plan actions … | 위와 같음 |
| `src/cli/progress.ts:49` | the workflow's own rules turn off restoring path tokens … | 위와 같음 |
| `src/cli/progress.ts:51` | the workflow's own checks leave out configured verifiers … | 위와 같음 |
| `src/cli/report.ts:449` | `- Task: … (workflow …)` | 보고서 본문. 실제 출력 `- Task: \`demo-summary\` (workflow \`document\`)` |
| `src/cli/args.ts:119` | --workflow must be a workflow id: … | 인자 오류의 자세한 글 |
| `src/cli/args.ts:121` | … a task file names its workflow with workflowRef | 인자 오류 |
| `src/cli/config.ts:238` | workflows must be an object | 설정 오류(`workflows`는 필드 이름이라 둘 수 있음) |
| `src/cli/config.ts:240` | workflows may have at most … entries | 설정 오류(필드 이름) |
| `src/cli/config.ts:244` | … not a valid workflow id | 설정 오류 |
| `src/cli/config.ts:245` | … the id of a built-in workflow; copy it under a new id | 설정 오류 |
| `src/cli/task.ts:381` | … must be a workflow id: … | task 오류 |
| `src/cli/run.ts:254` | names no built-in workflow and no workflows entry … | task 오류 |
| `src/cli/run.ts:255` | names a tool the workflow definition does not offer … | task 오류 |
| `src/cli/run.ts:256` | cannot be "none" under a workflow with plan "apply" | task 오류 |
| `src/cli/run.ts:257` | must be empty: the workflow allows no command | task 오류 |
| `src/cli/plan-commands.ts:362` | … does not resolve to a workflow with plan "apply" … | apply 오류 |
| `src/engine/index.ts:138` | Workflow instructions: | 모델에게 보내는 시스템 글(사람용 아님). 참고로만 |

## 부록 A. 사용자 문서 다섯에 남은 "비밀"(단독)

| 곳 | 뜻 | 판단 |
| --- | --- | --- |
| privacy.md:6, 95, 257, 266 | 끊긴(등록한) 값 | L-3 |
| privacy.md:60 | 가릴 값을 파일에서 등록 | L-3 |
| usage.md:647 | 등록한 값의 자리 | L-3 |
| privacy.md:22, 194, 236, 256 | 민감한 내용 일반(등록하지 않은 것 포함) | 둠 |
| cli-contract.md:55, 151, 209, 229, 495, 990 | 민감한 내용 일반 | 둠 |
| usage.md:683, 761, 776, 800 | 민감한 내용 일반(761은 "비밀을 가릴 값으로 등록") | 둠 |

## 부록 B. 실행 기록

- 판 사본과 빌드: `.codaryn/r48/tree`, `build.txt`, `typecheck.txt`
- 탐침 스크립트: `.codaryn/r48/`
  - `scan-catalog.mjs`: 카탈로그 전수
  - `scan-docs.mjs`: 문서, 본문·코드 나눔
  - `compare.mjs`: 인용 출력 대조
  - `code-spans.mjs`: 이름·필드·코드
  - `scan-code.mjs`: 코드의 사람용 글
- CLI 실행 출력: scratchpad `r48\out\`(명령마다 `.out`/`.err`)
