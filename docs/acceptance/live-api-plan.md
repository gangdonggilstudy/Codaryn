# 실제 API 실행 계획 (초안)

> **독립 검토(live-plan-review-codex-01)의 지적을 반영해 PM이 채택했다(2026-11-23, main `a82f8a19`). 아무것도 실행하지 않았다.** 이 저장소에서 실제 Anthropic API와 실제 OpenAI API는 아직 한 번도 호출되지 않았다([tests/live/README.md](../../tests/live/README.md) 3줄, [pm-status](../pm-status.md) CP-59의 "남은 것" 줄과 CP-60). 이 문서는 사용자가 직접 실행할 순서와, 실행 전에 사용자가 정할 값을 모은다.

- 작성: 2026-11-22, claude-worker(작업 지시 live-api-plan-claude-01), 기준 main `a91cf12a`.
- 보완: 2026-11-23, claude-worker(작업 지시 live-plan-fix-claude-01), 기준 main `6643d54c`. 검토의 L1·L2와 정보 I1~I3을 반영하고 인용 줄을 이 판에 다시 맞췄다.
- 실행 주체: **사용자만**. PM과 작업자는 실제 API를 호출하지 않는다([개발 절차](../development-workflow.md) 240줄, [테스트 전략](../testing.md) 72줄).
- 표기: 근거는 `파일:줄`로 적는다. 문서와 코드에 없는 값은 **사용자 결정 필요** 또는 **기준 필요**로 둔다. "권고(초안)"는 이 초안의 제안이며, PM이 검토한 뒤 사용자에게 묻는다.

## 1. 목적과 범위

단계 1b, 2, 3의 완료 판정에는 실제 모델로 한 관찰이 필요하다. 지금까지는 오프라인·모의 API·대본 모델로만 확인했다([단계별 계획](../roadmap.md) 34–36줄).

| 단계 | 문서의 완료 기준(실제 API 부분) | 근거 |
| --- | --- | --- |
| 1b | 1a의 두 작업(작은 코드 수정, 문서 작성)을 실제 API로 실행하고 모의 결과와 구분해 기록한다. 하지 않았으면 "1b 미수행"이다 | roadmap.md:55·69 |
| 2 | 준비한 연습 과제 묶음에서 반복이 한도 안에 통과로 끝나거나 실패 이유와 함께 멈춘다. 한도 초과·취소·시험 명령 시간 초과가 정해진 상태로 끝난다. 보호 경로가 시험·검증 설정 수정을 막는다. 보고서가 "지정한 테스트 통과"라고만 말한다 | roadmap.md:82–87 |
| 3 | 실행본·검증기·정책 파일 쓰기가 거부된다. 보호 대상이 바뀌면 검증이 무효다. 과제 하나 이상에서 후보가 보호된 검증을 거쳐 보고서를 낸다. 채택·반려는 사람이 정하고 자동 교체는 없다 | roadmap.md:92–103 |

**이 계획으로 보이려는 것**
- 실제 API 경로가 연결되고, 도구 한 바퀴와 작은 코드 수정이 검증까지 가며, 키가 출력과 기록에 남지 않는다(tests/live/README.md:79).
- 실제 모델에서도 재수정 반복, 보호 경로, 한도, 취소가 문서대로 끝나는지 관찰한다(단계 2).
- 실제 모델로 후보 하나를 만들고 보호된 검증과 보고서까지 가는지 관찰한다(단계 3).

**이 계획으로 보이지 않는 것**
- 실제 모델이 매번 같은 결과를 내는지, 요금, 다른 모델이나 긴 작업에서의 동작, 속도 제한 상황(tests/live/README.md:78).
- OS 수준 격리나 네트워크 차단. worktree와 보호 경로는 보안 경계가 아니다(testing.md:107–112, self-development.md:101–107).
- 검증 도중에만 바꿨다 되돌리는 변조의 탐지(self-development.md:110).
- 키 없는 Windows 수동 12항목, 다른 OS, 설치 패키지·서명·배포(GU-9/DR-67). 이것들은 별도 범위다([CP54 수동 인수](windows-keyless-cp54.md) 58–59줄).

## 2. 사전 준비 (사용자)

### 2.1 판과 빌드

- PM이 실행할 판(커밋)과 체크아웃 위치를 알려 준다. 사용자는 실행 전에 `git rev-parse HEAD`와 `node --version`(26 이상)을 적는다(manual-checks.md 0절, usage.md 1절).
- 빌드는 `npm run build`다(tests/live/README.md:13–17). 의존성이 없는 체크아웃이면 먼저 `npm ci`가 필요하다. 이것은 네트워크를 쓰는 설치이므로 사용자가 판단한다.
- 실제 API 점검은 기본 npm 시험 명령에 들어 있지 않다. 사용자가 일부러 실행해야만 돈다(tests/live/README.md:7).

### 2.2 키

- 키는 사용자 PC의 **환경 변수로만** 둔다. Anthropic은 `ANTHROPIC_API_KEY`, OpenAI는 `OPENAI_API_KEY`다(usage.md:237, privacy.md:255). Windows에서는 `rundll32 sysdm.cpl,EditEnvironmentVariables`로 사용자 변수를 더하고 **새 터미널**을 연다.
- 키를 파일, 채팅, 로그, 결과 보고, 커밋, 명령줄에 쓰지 않는다(AGENTS.md:68, tests/live/README.md:19). task·설정 파일이나 목표에 키가 있으면 CLI가 `key_in_file`(종료 2)로 바로 멈추고 아무것도 보내지 않는다(usage.md:242–245).
- 실제 API 점검(3.1)은 변수 파일을 쓰지 않고 환경 변수만 넘긴다(tests/live/README.md:43). CLI 실행(3.2·3.3)에서도 같은 방식을 권한다. `--vars-file`은 작업 공간 밖의 파일일 때만 쓰고, `--env-file`은 쓰지 않는다(usage.md:238–239).
- 키, 모델, 출력 상한 가운데 하나라도 없으면 `provider_not_configured`(종료 7)이고 아무것도 보내지 않는다(usage.md:262).

### 2.3 모델

- 모델은 `codaryn models`로 키가 쓸 수 있는 목록을 보고 고른다(usage.md:264–302). 이 명령도 **실제 API 요청**이다(`GET /v1/models`, usage.md:275). 사용자가 실행한다.
- 실제 API 점검은 `CODARYN_MODEL`(OpenAI는 `CODARYN_OPENAI_MODEL`) 환경 변수로 모델을 받는다(tests/live/README.md:25·34). CLI는 task `model.model` → 이 변수 → 설정 파일 순서다(usage.md:252·255). `models --use <번호>`는 설정 파일에 쓴다(usage.md:296).
- **어떤 모델을 쓸지는 이 문서에서 정하지 않는다(사용자 결정 필요).** 결과에는 쓴 모델 id를 꼭 적는다(testing.md:79·194).
- OpenAI 점검 3을 보려면 추론 모델이 필요하다. 추론 항목을 돌려주지 않는 모델이면 점검 3은 "건너뜀"이 된다(tests/live/README.md:34·67).

### 2.4 비용·호출 상한

- 비용 한도 값은 정해지지 않았다(testing.md:83·204 [미정]). 문서에는 요금 정보가 없다. 아래는 **호출 수와 토큰 수의 상한**일 뿐 금액이 아니다.
- 실제 API 점검의 상한은 코드에 고정돼 있다. 바꾸려면 코드를 고쳐야 한다(anthropic-live.ts:36–38, openai-live.ts:36–38).
  - Anthropic: 작업마다 턴 4, 도구 호출 4, 요청당 재시도 1, 요청당 출력 1,024토큰, 총 30,000토큰, 3분. 작업 둘을 합쳐 HTTP 요청 최대 16건, 토큰 최대 60,000(tests/live/README.md:56–57).
  - OpenAI: 턴 4, 도구 호출 4, 재시도 1, 출력 4,096토큰, 총 40,000토큰, 3분. HTTP 요청 최대 10건(tests/live/README.md:68–69).
- CLI 실행의 상한은 task와 설정 파일의 `limits`로 정한다: `maxModelTurns`, `maxToolCalls`, `maxTotalTokens`, `maxDurationMs`, `maxRepairAttempts`, `maxSameFailures`. 설정 파일 값이 상한이고, task는 그 값 이하만 줄 수 있다. anthropic에서는 총 토큰 한도가 필수다(usage.md:452–456). 처음에는 낮게 두고 `usage`를 보며 올린다(usage.md:452, 1209).
- 권고(초안) 출발값: 저장소에 이미 있는 값을 그대로 쓴다. **사용자 결정 필요.**

| 쓰는 곳 | 턴 | 도구 | 총 토큰 | 시간 | 재수정 / 같은 실패 | 근거 |
| --- | --- | --- | --- | --- | --- | --- |
| 3.1 실제 API 점검 | 4 | 4 | 30,000(OpenAI 40,000) | 3분 | 0 / 기본 | 코드 고정 |
| 3.2 문서 과제 | 8 | 12 | 60,000 | 5분 | 1 / 2 | examples/doc-task.json |
| 3.2 코드 과제 | 12 | 24 | 150,000 | 10분 | 2 / 2 | examples/code-task.json |
| 3.3 후보 과제 | 12 | 24 | 150,000 | 30분 | 2 / 2 | self-development.md:55(틀 기본값) |

- 위 값을 그대로 쓰면, 계획 전체(3.1 Anthropic·OpenAI, 3.2 두 과제, 3.3 과제 하나)의 총 토큰 상한은 약 46만이다. 각 실행의 상한을 더한 값이며 실제 사용량이 아니다.

## 3. 실행 단계

모든 단계는 **원본이나 개발 소스가 아닌 연습 폴더**에서 한다. 3.1은 시험이 임시 폴더를 만들고 끝나면 지운다(tests/live/README.md:47). 3.2와 3.3은 사용자가 저장소 **밖**에 새 연습 폴더를 만든다. 예시를 저장소 안에서 돌리면 모델이 예시 파일을 실제로 고치고, 작업 공간이 설치 위치와 겹치면 `workspace_is_install_dir`로 거부된다(usage.md:588·591). 각 단계는 앞 단계 결과를 PM이 읽은 뒤에 시작한다.

### 3.1 단계 1b — 기존 실제 API 점검(M-2.1, 선택 M-2.2)

| 항목 | 내용 |
| --- | --- |
| 명령 | 아래 PowerShell(tests/live/README.md:21–36, manual-checks.md:525–531) |
| 작업 공간 | 시험이 만드는 임시 폴더. CLI에는 허용 목록 변수와 그 제공자의 키·모델만 넘기고, `CODARYN_CONFIG`와 주소 변수는 넘기지 않는다(live-support.ts:25–33) |
| 보호된 검증기 | 코드 작업의 `check.mjs`(`protectedPaths`)를 실행하는 `command` 검증기(anthropic-live.ts:117–118) |
| 예상 산출 | 진단 줄 `status`·`reason`·`turns`·토큰 수(anthropic-live.ts:66–69), 끝의 pass·fail·skipped 집계 |
| 합격 기준 | Anthropic: 문서 작업 `done`이고 원래 글이 그대로다. 코드 작업 `done`, 검증기 `pass`, `check.mjs`가 그대로다. 키 원문과 변형 0건. 집계 `fail 0`, `skipped 0`(tests/live/README.md:53–54, manual-checks.md:533–537). OpenAI: tests/live/README.md:63–65의 세 기준 |

```powershell
npm run build
$env:CODARYN_LIVE = "1"
$env:CODARYN_MODEL = "<모델 ID>"          # ANTHROPIC_API_KEY는 사용자 환경 변수에 미리 둔다
node --test dist/tests/live/anthropic-live.js
# 선택(OpenAI, 사용자 결정 필요): OPENAI_API_KEY를 미리 두고
# $env:CODARYN_OPENAI_MODEL = "<모델 ID>"
# node --test dist/tests/live/openai-live.js
Remove-Item Env:CODARYN_LIVE, Env:CODARYN_MODEL, Env:CODARYN_OPENAI_MODEL -ErrorAction SilentlyContinue
```

- 세 변수 가운데 하나라도 없으면 아무것도 보내지 않고 모든 시험이 "건너뜀"이다(live-support.ts:14–19). `skipped`는 통과가 아니다.
- 실제 호출에서 관찰할 수 있으면 함께 적는다: 503 분류, `retry-after` 형식, 빈 `tool_result`, thinking 블록, 시간 초과 뒤 재전송, `anthropic-version`, `anthropic-workspace-id` 필요 여부(testing.md:82). 이 점검이 직접 검사하는 항목은 아니므로 관찰하지 못했으면 NOT_RUN이다.
- 1b 판정: 3.1의 Anthropic 두 작업이 합격이면 roadmap.md:69의 "1a의 두 작업"을 실제 API로 실행한 기록이 된다. OpenAI는 두 번째 제공자의 확인이며 1b 기준 자체에는 들어 있지 않다(roadmap.md:55는 Anthropic만 말한다).

### 3.2 단계 2 — 연습 과제의 재수정 반복

| 항목 | 내용 |
| --- | --- |
| 과제 | `examples/code-task.json`(`workspaces/calc`: 빈 배열에서 `sum`이 틀림, `sum.test.mjs` 보호, 재수정 2회). 선택으로 `examples/doc-task.json`(`workspaces/notes`, `file_rules`, 재수정 1회)(usage.md:406–407). 연습용 저장소이며 Codaryn 자신이 아니다(roadmap.md:76) |
| 작업 공간 | `examples` 폴더 전체를 저장소 밖 연습 폴더로 복사한 사본. task의 `workspaceRoot`는 task 파일 기준 상대 경로다(usage.md:445) |
| 설정 | 연습 폴더 밖의 전용 설정 파일을 `--config`로 준다. 설정의 한도가 task 한도의 상한이다(usage.md:454). `examples/config.example.json`을 바탕으로 모델만 채운다 |
| 보호된 검증기 | `tests`(`node --test`, 120초)와 `test-kept`(`sum.test.mjs`에 원래 단언이 있는지)(code-task.json). `sum.test.mjs`는 `protectedPaths`다 |
| 예상 산출 | `run --json`의 stdout JSON 한 줄(아래 참고), stderr의 끝 요약, `.codaryn/runs/<runId>/`의 `result.json`·`journal.jsonl`(usage.md:838–841), `report` 출력 |
| 합격 기준 | `done`/`verified`(모든 검증기 `pass`, 종료 0)이거나, 한도·실패 이유와 함께 정해진 상태로 멈춤(roadmap.md:84, usage.md:682–696). `sum.test.mjs` 불변, `protectedChanged` 없음. **연습 과제 묶음의 과제 수와 합격 기준은 testing.md에 없다(roadmap.md:35·84) → 기준 필요** |

```powershell
$practice = "<저장소 밖 새 연습 폴더>"
Copy-Item -Recurse <저장소>\examples $practice
node <저장소>\dist\src\cli\main.js doctor --task $practice\code-task.json --config <연습 폴더 밖 설정 파일>
node <저장소>\dist\src\cli\main.js run --task $practice\code-task.json --config <연습 폴더 밖 설정 파일> --json
node <저장소>\dist\src\cli\main.js report --workspace $practice\workspaces\calc --run latest --json
```

- `run`에 `--json`을 준 까닭: stdout과 stderr가 둘 다 터미널이면 결과 JSON 한 줄이 생략된다(src/cli/guard.ts:45–57, usage.md:596). `--json`이 있으면 터미널에서도 그 줄이 나온다(`run`의 옵션, src/cli/help.ts:87). stdout을 파일로 받아도 나온다. 이 줄은 `report --json`의 보고서 출력과 별개이고, 서로를 대신하지 않는다.
- 재수정이 실제로 일어났는지는 결과의 `usage.repairAttempts`로 본다(usage.md:696). 첫 검증에서 통과해 0이면, 그 실행은 "통과"이지만 실제 모델의 재수정 경로는 관찰되지 않은 것이다. 이 둘을 따로 적는다.
- 명령형 검증기는 모델이 고친 코드를 실행한다. 재수정을 켜면 그 출력이 모델에 돌아간다. 연습 폴더에서만 한다(usage.md:697).
- **선택 관찰(사용자 결정 필요).** 각각 별도 실행이며 오프라인 시험이 이미 있다(testing.md:122–123의 T5·T6).
  - 취소: 작업 공간 밖 경로로 `--cancel-file`을 주고 실행 중에 그 파일을 만든다. 또는 Ctrl+C. 기대는 `cancelled`(종료 5), 이미 적용한 변경은 남음(usage.md:593).
  - 한도 초과: 설정 파일과 task의 한도를 **함께** 낮춘다. task 값은 설정 값 이하여야 한다. 예를 들어 연습 사본 `code-task.json`의 `limits.maxModelTurns`와 설정의 `maxModelTurns`를 같은 낮은 값으로 두거나, `limits`를 뺀 별도 task로 설정 값이 쓰이게 한다(src/app/input/security/limits.ts:93–96). 기대는 `budget-exhausted`(종료 4)와 그 한도 이름(`max_model_turns` 등, usage.md:831)이다. 모델이 한도 전에 끝내면 한도에 닿지 않을 수 있다.
  - 설정만 낮추고 task의 명시 한도(`maxModelTurns` 12 등)를 그대로 두면, API를 부르기 전에 `invalid_task`(종료 2)로 멈춘다(limits.ts:87–90·110, usage.md:454). 그것은 한도 초과 관찰이 아니다.
  - 보호 경로 유도: 목표에 시험 파일 수정을 요구하는 과제. 기대는 쓰기 거부와 `sum.test.mjs` 불변(roadmap.md:86). 모델이 실제로 시도하는지는 보장되지 않는다.
  - 시험 명령 시간 초과(roadmap.md:85)는 실제 모델이 필요 없는 경로다. 오프라인 시험으로 갈음할지는 기준 필요다.

### 3.3 단계 3 — 실제 모델의 후보 자기 개발

**시작 조건:** 3.2가 합격이고 PM이 기록했다(roadmap.md:92 "단계 2의 오프라인·실 API 검증을 모두 통과한 실행본"). 실행본은 채택 커밋에 고정한다. 과제는 관리자가 정한 작은 과제 하나이고, 과제별 한도를 정한다(roadmap.md:92·102). 첫 실행은 사람이 지켜본다(self-development.md:117).

**막힌 점(사용자 결정 필요):** 후보 준비 스크립트 `scripts/new-candidate.mjs`는 `git worktree add -b candidate/<이름>`을 실행한다(self-development.md:48·52). 그런데 현재 사용자 지시는 `git worktree add`를 관리자·스크립트 경유로도 금지하고, 이 스크립트 설명은 실행 허가가 아니라고 적는다(development-workflow.md:176). 후보는 원래 저장소와 Git 객체·ref·훅·설정을 공유한다(self-development.md:103). 별도 복제본도 이 금지의 자동 예외가 아니다. 스크립트는 `--repo`로 준 저장소에서도 `git worktree add`를 실행한다(scripts/new-candidate.mjs:444). 그래서 **D-8이 정해지기 전에는 단계 3을 실행하지 않는다.** 권고(초안): 사용자가 명시적 예외를 준다면, 관리용 저장소가 아니라 **프로젝트 폴더 밖의 별도 복제본**을 `--repo`로 쓴다. 관리용 저장소의 worktree 목록과 공유 Git 설정에 닿지 않게 하려는 것이다.

| 항목 | 내용 |
| --- | --- |
| 명령 | `new-candidate.mjs --dry-run`으로 먼저 확인 → 실제 생성(**D-8 결정 뒤 구체화**) → 설정·task 틀 편집 → `doctor` → `run` → `report`(self-development.md:21–43·71, 아래) |
| 작업 공간 | `candidate/<이름>` worktree. 설치 위치와 겹치면 실행 전에 거부된다(self-development.md:11, U-3) |
| 보호된 검증기 | 후보 밖 설정·task, 검증기 명령, 후보 안 `protectedPaths`(제안 목록 self-development.md:60), `integrity.paths`(공유 Git `hooks`·`config`, 실행본 `dist`, self-development.md:57–58) |
| 의존성 | 후보에는 추적 파일만 있다. 검증기에 의존성이 필요하면 사람이 후보에 설치한다(`npm ci`, 네트워크)(self-development.md:25) → 사용자 결정 필요 |
| 예상 산출 | 후보의 변경 파일, `report`(상태·검증·보호 대상 확인·변경·사용량·검사하지 않은 범위)(self-development.md:36–38) |
| 합격 기준 | 실행본·검증기·정책 파일 쓰기 거부. 보호 대상이 바뀌면 `needs-input`/`protected_changed`. 후보 하나가 보호된 검증을 거쳐 보고서까지 감. 채택·반려는 사람이 기록(roadmap.md:97–101). **과제와 그 합격 조건은 정해지지 않았다 → 기준 필요** |

```powershell
node <실행본>\scripts\new-candidate.mjs --repo <별도 복제본> --name <이름> --out <후보 디렉터리> --state <설정 디렉터리> --dry-run
# 실제 생성 명령(--dry-run 없이)은 D-8 결정 뒤 구체화한다
node <실행본>\dist\src\cli\main.js doctor --config <설정 디렉터리>\<이름>.config.json --task <설정 디렉터리>\<이름>.task.json
node <실행본>\dist\src\cli\main.js run --task <설정 디렉터리>\<이름>.task.json --config <설정 디렉터리>\<이름>.config.json --json
node <실행본>\dist\src\cli\main.js report --workspace <후보 디렉터리> --run latest --json
```

- task 틀에는 `limits`가 없어 설정 파일 값을 쓴다. 설정 파일 없이 실행하면 `invalid_task`로 멈춘다(self-development.md:63).
- 검증기 명령은 후보 코드를 실행하므로 후보 코드가 검증 결과에 영향을 줄 수 있다(self-development.md:105–106). 보고서에 "검증 자료 무결성은 해시 확인 수준"을 적는다(testing.md:112).

## 4. 안전 장치

| 장치 | 내용 | 근거 |
| --- | --- | --- |
| 연습 폴더 | 원본·개발 소스·실제 업무 파일을 쓰지 않는다. 설치 위치와 겹치는 작업 공간은 거부된다 | usage.md:588·591·1197, self-development.md:11 |
| 보호 경로 | 시험·검증 설정은 `protectedPaths`로 파일 도구 쓰기를 막는다. 명령이 바꾼 것은 무결성 확인이 사후에 알린다 | usage.md:1203, testing.md:93 |
| 명령 허용 | 필요한 명령만, `allowExtraArgs: false`. 네트워크와 파괴적 동작은 `deny` | usage.md:1204, code-task.json |
| 계획 승인 | 파일 정리·계획 실행(`plan: "run"`)은 승인한 계획만 적용한다. 이 계획의 과제는 쓰지 않는다 | roadmap.md:114, usage.md 18.3·18.11절 |
| 취소 | Ctrl+C 또는 `--cancel-file` → `cancelled`(5) | usage.md:593 |
| 상한 | 한도를 넘기 전에 `budget-exhausted`(4)로 멈춘다. 한도 없이 실행하지 않는다 | usage.md:696·831, roadmap.md:102 |
| 키 | 사용자 환경 변수만. 키는 그 제공자 주소의 요청 헤더에만 간다. 401·403은 고정 문구로만 남는다 | privacy.md:256–263 |
| 후보 분리 | 후보는 별도 worktree, 실행본은 후보 밖. 자동 채택·병합·교체·push 없음 | self-development.md:11–16, roadmap.md:101·103 |
| 카나리 | 실제 API 단계에서도 가짜 비밀(카나리)만 쓴다. 실제 개인정보·비밀을 과제에 넣지 않는다 | testing.md:152 |

## 5. 결과 기록 (사용자 → PM)

**돌려줄 것** (키 값, 실제 자료 원문, 개인 경로는 지운다)
- 판(`git rev-parse HEAD`), `node --version`, OS, 터미널, 실행 시각.
- 제공자와 모델 id(testing.md:194).
- 실행한 명령 그대로(키 없이)와 종료 코드.
- 3.1: `node --test`의 끝 집계(pass·fail·skipped), 진단 줄 전체, 키 누출 줄이 있었는지.
- 3.2·3.3: `run --json`의 stdout JSON 한 줄(`status`·`reason`·`usage`)과, 그와 별개인 `report --json` 출력. 바뀐 파일 목록(`changes`)과 보호 파일이 그대로인지.
- 기대와 다르면 화면 글을 그대로 보낸다(manual-checks.md 0절 "결과 알리기").
- 짧은 비밀을 가릴 값으로 쓴 실행이면 그 출력을 공개 로그에 남기지 않는다(usage.md:1206).

**판정 표** (항목마다 한 줄)

| 항목 | 판 | 제공자·모델 | 명령·종료 코드 | 관찰 | 판정 |
| --- | --- | --- | --- | --- | --- |
| 1b-A 문서(Anthropic) | | | | | PASS / FAIL / NOT_RUN |
| 1b-A 코드(Anthropic) | | | | | |
| 1b-O 점검 1~3(OpenAI, 선택) | | | | | |
| 2 코드 과제(재수정 수 함께) | | | | | |
| 2-R 실제 재수정 경로(`repairAttempts` 1 이상) | | | | | |
| 2 선택 관찰(취소·한도·보호) | | | | | |
| 3 후보 과제 | | | | | |

- 실행하지 않은 항목은 NOT_RUN이다. `skipped`는 NOT_RUN으로 적는다. 2-R은 `repairAttempts`가 0이면 NOT_RUN이다(D-6b). 모의 결과로 채우지 않는다(testing.md:22·43).
- 보관과 폐기: 3.1의 임시 폴더는 시험이 지운다(tests/live/README.md:47). 연습 폴더의 `.codaryn/` 기록은 PM이 결과를 읽을 때까지 둔다. 그 뒤 `cleanup`으로 미리 본 다음 지운다(usage.md:1210). 후보를 반려하면 사람이 지운다(self-development.md:42).

## 6. PM이 이후에 할 일

1. 돌려받은 결과를 전부 읽고, 판정 표의 각 행을 문서의 기준(1절 표)과 대조한다. 기준이 없는 항목은 "기준 필요"로 둔다. 통과로 올리지 않는다.
2. `docs/pm-status.md`에 판, 모델, 판정, 실행하지 않은 범위를 기록한다. 실제 API 결과를 모의·오프라인 결과와 섞지 않는다(testing.md:43·194–199).
3. 실패가 나오면 그 출력과 기록으로 재현 조건을 정리한다. 실패가 재현될 때만 새 코드 단위를 만든다. 수정은 재현 입력으로 실패하는 회귀 시험부터 쓰고(testing.md:20), 독립 검토를 거친다.
4. 단계 전환(1b → 2 → 3)은 앞 단계 기록 뒤에 PM이 판단하고, 사용자 결정이 필요한 값은 하나씩 묻는다.

## 7. 사용자 결정 필요 목록

| 번호 | 항목 | 권고(초안) | 근거 |
| --- | --- | --- | --- |
| D-1 | 이번에 실행할 범위 | **사용자 결정(2026-11-23): 3.1(Anthropic)만 먼저.** 결과를 본 뒤 3.2, 그 뒤 3.3을 다시 묻는다 | roadmap.md:92(단계 3 입력이 단계 2 통과) |
| D-2 | 실행 판과 체크아웃 위치 | PM이 지정한 채택 커밋. 관리용 main 작업 트리에 빌드 산출물을 만들지 여부 포함 | development-workflow.md:113(G-9) |
| D-3 | 모델(Anthropic, OpenAI) | 문서는 정하지 않는다. `models`로 고르고 결과에 id를 적는다 | testing.md:83, usage.md:264 |
| D-4 | OpenAI 점검 포함 여부 | **사용자 결정(2026-11-23): 이번에는 빼고 Anthropic 결과를 먼저 본다.** 나중에 하면 점검 3을 위해 추론 모델 | tests/live/README.md:34·67 |
| D-5 | 토큰·호출·비용 상한 | **사용자 결정(2026-11-23): 코드에 고정된 점검 상한(2.4) 그대로.** 금액 한도는 따로 두지 않고, 제공자 쪽 사용량은 사용자가 본다 | testing.md:83, usage.md:452 |
| D-6a | 단계 2 과제 수와 합격 기준 | `code-task.json` 1개로 시작한다. 기준은 "done 또는 정해진 상태로 멈춤 + 보호 파일 불변"으로 두고 testing.md에 정식으로 정한다 | roadmap.md:35·84 |
| D-6b | 실제 모델의 "실패 → 실패 근거 → 재수정" 관찰을 단계 2 판정의 필수로 할지 | 필수로 하지 않는다. 판정은 D-6a 기준으로 하고, `repairAttempts`가 0이면 2-R 행은 NOT_RUN으로 둔다. 단계 3 진입(roadmap.md:92)은 이와 별개로 PM이 기록을 보고 판단하며, 2-R이 NOT_RUN이면 남은 경계로 함께 적는다. 필수로 정하면 첫 검증에서 실패하는 과제가 필요하다 → 기준 필요 | 실 API 기준은 통과 또는 이유 있는 멈춤(roadmap.md:84). 실패 → 재수정 → 통과는 오프라인 기준이 재현한다(:83). 단계 2가 더하는 반복(:74·78). 실제 모델이 같은 결과를 내는지는 입증하지 않는다(tests/live/README.md:78) |
| D-7 | 단계 2 선택 관찰 | 취소와 한도 초과 각 1회(한도 초과는 3.2의 절차대로 task와 설정을 함께 낮춤). 보호 경로 유도는 선택 | roadmap.md:85–86 |
| D-8 | 단계 3 후보 만드는 방법 | 별도 복제본도 `git worktree add` 금지의 자동 예외가 아니다. 사용자가 명시적 예외를 주면 프로젝트 폴더 밖 별도 복제본에서 `new-candidate.mjs`를 쓴다. 다른 준비 방식을 정할 수도 있다. 정해지기 전에는 단계 3을 실행하지 않고, 실제 생성 명령은 결정 뒤 구체화한다 | development-workflow.md:176, scripts/new-candidate.mjs:444, self-development.md:103 |
| D-9 | 단계 3 과제와 과제별 한도 | 작은 과제 하나, 틀 기본값(12/24/150,000/30분/2/2)에서 시작 | roadmap.md:102, self-development.md:55 |
| D-10 | 후보 의존성 설치(`npm ci`) | 필요할 때만, 사용자가 실행 | self-development.md:25 |
| D-11 | 실행 주기 | 1회. 판이 바뀌면 PM이 다시 묻는다 | testing.md:83 |

## 8. 참고: 근거 문서 사이의 어긋남

초안(main `a91cf12a` 기준)에서 찾은 두 건은 2026-11-23 main에서 바로잡았다.

- roadmap.md:34는 `anthropic-live.ts`가 "문서 작업 하나만 다루고(코드 작업 없음)"라고 적었다. **2026-11-23 main에서 바로잡음**(`4f0922c1`): 지금은 문서 작업과 코드 작업(U-101) 둘, 그리고 `openai-live.ts`를 적는다(anthropic-live.ts:105–125, tests/live/README.md:49–59).
- testing.md:35는 실제 API 층에 `anthropic-live.ts`만 적고, 4절 상한은 HTTP 요청 8회로 적었다. **2026-11-23 main에서 바로잡음**(`4f0922c1`, `6643d54c`): 지금은 35줄에 두 파일, 73~76줄에 두 점검의 실행 조건과 상한(Anthropic 둘이면 16건, OpenAI 10건)을 적는다(tests/live/README.md:57·69).
