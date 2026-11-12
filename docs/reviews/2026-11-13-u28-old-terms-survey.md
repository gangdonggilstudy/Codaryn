# U-28 조사: 코드에 남은 옛 용어 (DR-50) — 담당 p4g-general의 보고에서 옮김

PM 확인: 병합한 변경은 주석과 시험뿐이다(제품 코드의 실행 줄 변경 0). 판 `1a1ea07`에서 유닛 2,395건 중 2,391 통과·0 실패, 통합 559건 통과. 아래 표의 남의 소유 항목은 뒤 단위에서 고친다.

## U-28 (DR-50): 코드에 남은 옛 용어 — `unit/U-28-p4g-general` `d3e8d90` (main `a191a50`에서 땀)

### 찾은 법

- 범위: `src/`, `gui/src/`의 `.ts`·`.html`·`.css` 전체. 주석과 문자열 리터럴을 나눠 읽었다(코드는 이름이라 뺐다).
- 옛 용어(DR-50, `ux-design.md` 5절, 카탈로그 시험 `catalog.test.ts:447`의 낱말)
  - 영어: workflow, task kind, discard box, run archive, "discarded files folder"(R-48 L-5의 한 표기는 "discarded-files folder").
  - 한국어: 행동, 워크플로, 비밀, 단독 "보관함", 한국어 글 속 digest, 쓰기 막음을 뜻하는 "보호 대상".
- 이름은 그대로 둔다(DR-50): 식별자(`WorkflowSettings`, `WORKFLOW_TOOL_NAMES`), 옵션(`--workflow`), JSON·설정 필드(`workflowRef`, `workflows`, `TaskSpec.workflow`), 문구 id(`progress.workflow_policy.*`), 자리 표시(`{workflow}`), 파일 이름(`workflow.ts`, `src/workflows`), 주석의 코드 표기.
- 결과
  - 한국어 옛 용어: 사람이 읽는 글에 없다. 주석에도 없다.
  - 한국어 글 속 `digest`: 모두 `{digest}` 자리 표시라 그대로다.
  - 남은 것은 영어 "workflow"(주석과 CLI 오류 글), GUI 주석의 "task kind"·"discard box", GUI 영어 글 하나, 그리고 "보호 대상"의 판단 둘이다.

### 내 몫(고침): 47곳, 주석만

- `src/contracts` 11개 파일, `src/engine/index.ts`, `src/engine/validate-args.ts`, `src/model/anthropic/index.ts`의 주석 47곳: workflow → task type
  - 함께 바꾼 말: workflow definition → task type definition, workflow tools → task type tools, workflow settings/fields/id → task type settings/fields/id.
- `src/contracts/workflow.ts` 머리에 한 번 적었다: 사람의 말은 task type(작업 종류)이고 주석도 그 말을 쓴다. 코드의 이름은 옵션·필드 이름처럼 workflow를 그대로 둔다.
- 주석의 필드 이름은 코드 표기로 감쌌다: `config.ts:52` 의 `workflows`, `config.ts:264` 의 `workflow` label.
- 일부러 둔 것: `src/engine/index.ts:154` `INSTRUCTIONS_LABEL = "Workflow instructions:"`
  - 모델에게 보내는 시스템 글이고 사람이 읽는 글이 아니다.
  - 바꾸면 instructions가 있는 작업 종류로 하는 모든 실행의 요청이 바뀐다(요청 고정 값). 그 주석에 그렇게 적었다. 바꾸려면 따로 승인이 필요하다.
- 코드, 문구 id, 고정 값은 바뀌지 않았다. 고정 시험 파일(sp0-golden, sp0-pins, sp0-expected, sp0-cli, g-workflow-tools)은 main과 같다.
- 재현 시험(새 파일): `tests/unit/contracts/g-u28-terms.test.ts`
  - 세 폴더의 주석과 문자열에서 DR-50의 옛 낱말(두 언어)을 찾는다.
  - 고치기 전에는 47곳이 나와 실패했고, 고친 뒤에는 통과한다.
  - 모델용 라벨 하나와 이름 규칙(옵션, 필드, 파일 이름)도 확인한다.

### 수치 (G-9)

| 판 | typecheck | 유닛 | 통합 | 고정 시험 |
| --- | --- | --- | --- | --- |
| `unit/U-28-p4g-general` `d3e8d90` | 0 | 2276건: 2272 통과 / 실패 0 (건너뜀 3, todo 1) | 559/559 | sp0-pins·sp0-cli·g-workflow-tools·g-workflow-engine 49/49 |

### 병합 주의

- `git merge-tree`로 보았다.
  - 충돌 없음: `pm/unit-U-16`, `pm/unit-U-29`, U-16·U-29의 각 담당 브랜치.
  - 충돌: `pm/unit-U-25`와 U-25 브랜치들, `src/contracts/engine.ts` 한 곳.
- 충돌의 까닭: U-25가 `EngineResult.masking`을 `review?` 바로 위에 넣었고, U-28은 그 바로 아래 줄(`review?`의 주석 "The workflow's checklist")을 고쳤다.
- 해결: 두 쪽을 다 둔다. U-25의 `masking` 블록 다음에 U-28의 줄 "The task type's checklist"를 둔다.
- 해결한 판을 임시로 만들어 쟀다(`pm/unit-U-25` + main `a191a50` + U-28).
  - 결과: typecheck 0, 유닛 2294건: 2284/3, 통합 559: 558/1.
  - 같은 판에서 U-28만 뺀 것(`pm/unit-U-25` + main): 유닛 2291: 2281/3, 통합 558/1. 실패 이름이 똑같다. U-28이 더한 실패는 없다.
- 그 실패 넷은 U-25 판이 지금 main을 받으면 생긴다. U-28 몫이 아니다. 참고로 적는다.
  - `masking`이 빠진다: `report`의 `ReportOutput`(앱 `u25-masking-counts`, CLI `--json` 보고서). main의 U-21 보고서 읽기가 `masking`을 옮기지 않는다.
  - SP-0 `run --json`의 고정 값(main의 U-21 판)에 `masking`이 없다. 통합 U-5 report도 같다.

### 남의 소유: 표로만 보고 (고치지 않음)

담당은 배정표(`phase-4-5-design.md` 159–176, `phase-4-usability.md` 30–31)의 폴더 기준이다. 틀린 곳은 PM이 바로잡아 주기 바란다.

#### (가) 사람이 읽는 글 (17곳: CLI 16, GUI 1)

| 파일:줄 | 지금 글 | 바꿀 글 | 담당 |
| --- | --- | --- | --- |
| `src/cli/progress.ts:43` | the workflow's own rules leave out command rules of the configured policy: N | the task type's own rules leave out command rules of the configured policy: N (카탈로그 `progress.workflow_policy.commands_dropped`와 같게) | CLI na-core (w3:p2) |
| `src/cli/progress.ts:45` | the workflow's own rules narrow command rules of the configured policy: N | the task type's own rules narrow command rules of the configured policy: N | CLI na-core (w3:p2) |
| `src/cli/progress.ts:47` | the workflow's own rules leave out plan actions of the configured policy: N | the task type's own rules leave out plan actions of the configured policy: N | CLI na-core (w3:p2) |
| `src/cli/progress.ts:49` | the workflow's own rules turn off restoring path tokens, which the configured policy allows | the task type's own rules turn off restoring path tokens, which the configured policy allows | CLI na-core (w3:p2) |
| `src/cli/progress.ts:51` | the workflow's own checks leave out configured verifiers that take their ids: N | the task type's own checks leave out checks given in the config or task with the same id: N (이 줄은 낱말 말고도 카탈로그 글과 다르다. 주석 34줄은 카탈로그 영어와 같다고 한다) | CLI na-core (w3:p2) |
| `src/cli/report.ts:463` | `- Task: <id> (workflow <name>)` | `- Task: <id> (task type <name>)` (보고서 본문) | CLI na-core (w3:p2) |
| `src/cli/args.ts:119` | --workflow must be a workflow id: 1-64 letters, … | --workflow must be a task type id: 1-64 letters, … | CLI na-core (w3:p2) |
| `src/cli/args.ts:121` | --workflow is for the quick form; a task file names its workflow with workflowRef | … a task file names its task type with workflowRef | CLI na-core (w3:p2) |
| `src/cli/config.ts:244` | … has an id that is not a valid workflow id | … has an id that is not a valid task type id | CLI na-core (w3:p2) |
| `src/cli/config.ts:245` | … uses the id of a built-in workflow; copy it under a new id | … uses the id of a built-in task type; copy it under a new id | CLI na-core (w3:p2) |
| `src/cli/task.ts:381` | <field> must be a workflow id: 1-64 letters, … | <field> must be a task type id: 1-64 letters, … | CLI na-core (w3:p2) |
| `src/cli/run.ts:254` | names no built-in workflow and no workflows entry of the config file | names no built-in task type and no `workflows` entry of the config file | CLI na-core (w3:p2) |
| `src/cli/run.ts:255` | names a tool the workflow definition does not offer (tools only narrow) | names a tool the task type definition does not offer (tools only narrow) | CLI na-core (w3:p2) |
| `src/cli/run.ts:256` | cannot be "none" under a workflow with plan "apply" | cannot be "none" under a task type with plan "apply" | CLI na-core (w3:p2) |
| `src/cli/run.ts:257` | must be empty: the workflow allows no command | must be empty: the task type allows no command | CLI na-core (w3:p2) |
| `src/cli/plan-commands.ts:488` | the task given to apply does not resolve to a workflow with plan "apply"; nothing was moved | … does not resolve to a task type with plan "apply"; nothing was moved | CLI na-core (w3:p2) |
| `gui/src/renderer/i18n/en.ts:312` | restored from the discarded files folder | restored from the discarded-files folder (R-48 L-5의 한 표기. CLI 카탈로그는 이미 이 표기) | GUI p5u-gui (w3:pB) |

- 둔 것(이름):
  - `src/cli/config.ts:238`, `:240`의 "workflows must be an object", "workflows may have at most …": 설정 필드 이름이다. 코드 표기로 쓸지는 CLI 담당이 판단한다.
  - `{workflow}` 자리 표시가 든 GUI 글(`settings.profileWorkflow` 등): 보이는 말은 이미 Task type·작업 종류다.
- 이 글을 인용하는 시험(담당이 함께 고칠 것): `k-report-doctor`, `g-dr43-progress`, `g-dr43-verifiers`, `g-resolve`, `g-workflows`(모두 `tests/unit/cli`), `tests/unit/app/settings-workflow-rules`. 고정 시험 파일(SP-0)은 아니다.
- 문서: `docs/usage.md`·`cli-contract.md`에는 이 오류 글을 인용한 곳이 없다(검색 0).

#### (나) "보호 대상" — 판단 필요 (문구 담당)

| 파일:줄 | 지금 글 | 뜻 | 권고 | 담당 |
| --- | --- | --- | --- | --- |
| `gui/src/renderer/i18n/ko.ts:178` `widen.integrity_path_removed` | 보호 대상 경로 뺌 | 설정의 `integrity.paths`(사후 확인의 경로)를 뺌. 영어 "an integrity path removed" | 둔다. 쓰기 막음(보호 경로, `protectedPaths`)이 아니라 보호 대상 확인의 경로다. CLI 카탈로그의 `doctor.check.integrity_paths`("보호 대상 경로" / "protected material paths")와 같은 말이다. R50-I1의 "보호 경로" 권고는 뜻이 달라진다 | GUI p5u-gui (w3:pB) |
| `gui/src/main/dialog-texts.ts:141` `integrity_path_removed` | 보호 대상 경로 뺌 | 위와 같음 | 위와 같음 | GUI p5u-gui (w3:pB) |
| `src/i18n/ko.ts:70`, `:71`, `:176`, `:367`, `:388`, `:506` | 보호 대상 확인 …, 보호 대상(보고서 절) …, 보호 대상 경로 | 사후 확인과 보고서의 절 | 둔다. 용어표(ux-design 5절)의 "보호 대상 확인"과 같다. 카탈로그 시험 `catalog.test.ts:467`이 이 이름을 지킨다 | 문구 nb-i18n (w3:p5) |
| `gui/src/renderer/i18n/ko.ts:493`, `:511`, `:512` | 보호 대상(보고서 탭), 보호 대상 확인은 사후 탐지 | 위와 같음 | 둔다 | GUI p5u-gui (w3:pB) |

#### (다) 주석 (78줄, 기계적 바꿈: workflow → task type, task kind → task type, discard box → discarded-files folder; 이름·코드 표기는 그대로)

| 파일:줄 | 지금 글 | 바꿀 글 | 담당 |
| --- | --- | --- | --- |
| `src/app/settings-change.ts:17` | workflow definition changed. Narrowing changes need no confirmation. | task type definition changed. Narrowing changes need no confirmation. | 앱 p5a-adapter (w3:pA) |
| `src/app/settings-change.ts:99` | The rules of the quick runs of every workflow that has its own (built-in or the config's), as | The rules of the quick runs of every task type that has its own (built-in or the config's), as | 앱 p5a-adapter (w3:pA) |
| `src/app/settings-change.ts:100` | such runs see them, compared before and after. A workflow defined on one side only is | such runs see them, compared before and after. A task type defined on one side only is | 앱 p5a-adapter (w3:pA) |
| `src/app/settings-change.ts:105` | workflow's own rules allow widens that workflow's runs; one organize drops does not. | task type's own rules allow widens that task type's runs; one organize drops does not. | 앱 p5a-adapter (w3:pA) |
| `src/app/settings-change.ts:106` | - Verifiers, DR-43 (a) (R-31 L-2): a workflow's own verifiers always run and the config's are | - Verifiers, DR-43 (a) (R-31 L-2): a task type's own verifiers always run and the config's are | 앱 p5a-adapter (w3:pA) |
| `src/app/settings-change.ts:107` | added unless their id is one of the workflow's (mergeWorkflowVerifiers), so the merged lists | added unless their id is one of the task type's (mergeWorkflowVerifiers), so the merged lists | 앱 p5a-adapter (w3:pA) |
| `src/app/settings-change.ts:108` | are compared whatever changed. An empty config list removes none of the workflow's. | are compared whatever changed. An empty config list removes none of the task type's. | 앱 p5a-adapter (w3:pA) |
| `src/app/settings-change.ts:195` | A workflow's entry that only repeats a config entry (same kind, same field without the | A task type's entry that only repeats a config entry (same kind, same field without the | 앱 p5a-adapter (w3:pA) |
| `src/app/settings-change.ts:196` | workflow's prefix and the list index) is left out: the workflow's runs widen in the way the | task type's prefix and the list index) is left out: the task type's runs widen in the way the | 앱 p5a-adapter (w3:pA) |
| `src/app/settings-change.ts:197` | config's entry already says. What a workflow drops is in the narrowings (policyNarrowingsOf). | config's entry already says. What a task type drops is in the narrowings (policyNarrowingsOf). | 앱 p5a-adapter (w3:pA) |
| `src/app/settings-change.ts:276` | DR-41: what each workflow's own rules would leave out of the new config's policy. | DR-41: what each task type's own rules would leave out of the new config's policy. | 앱 p5a-adapter (w3:pA) |
| `src/app/settings.ts:3` | config file a run would read, whether it is there, what it says, and the profile and workflow | config file a run would read, whether it is there, what it says, and the profile and task type | 앱 p5a-adapter (w3:pA) |
| `src/app/settings.ts:116` | DR-41, DR-43 (a): for each workflow (built-in, then the config's), what its own rules leave out of | DR-41, DR-43 (a): for each task type (built-in, then the config's), what its own rules leave out of | 앱 p5a-adapter (w3:pA) |
| `src/app/settings.ts:118` | workflowVerifierNarrowings: a config verifier whose id is one of the workflow's). Kinds and | workflowVerifierNarrowings: a config verifier whose id is one of the task type's). Kinds and | 앱 p5a-adapter (w3:pA) |
| `src/app/settings.ts:132` | Each profile with the workflow it uses when the task names none, in the file's order. Pure. */ | Each profile with the task type it uses when the task names none, in the file's order. Pure. */ | 앱 p5a-adapter (w3:pA) |
| `src/app/types.ts:159` | DR-41: what each workflow's own rules would leave out of the new config's policy. See WorkflowPolicyNarrowing. */ | DR-41: what each task type's own rules would leave out of the new config's policy. See WorkflowPolicyNarrowing. */ | 앱 p5a-adapter (w3:pA) |
| `src/app/types.ts:166` | DR-41: a workflow whose own policy leaves part of the config's policy out of its quick runs | DR-41: a task type whose own policy leaves part of the config's policy out of its quick runs | 앱 p5a-adapter (w3:pA) |
| `src/app/types.ts:168` | restoring). Kinds and counts only, never a rule, a command or a path. Built-in workflows first, | restoring). Kinds and counts only, never a rule, a command or a path. Built-in task types first, | 앱 p5a-adapter (w3:pA) |
| `src/app/types.ts:211` | G-A: workflow ids the config file defines, in the file's order. */ | G-A: task type ids the config file defines, in the file's order. */ | 앱 p5a-adapter (w3:pA) |
| `src/app/types.ts:213` | G-A BUILTIN_WORKFLOW_IDS: the built-in workflows, available with or without a config file. */ | G-A BUILTIN_WORKFLOW_IDS: the built-in task types, available with or without a config file. */ | 앱 p5a-adapter (w3:pA) |
| `src/app/types.ts:215` | N-8, G-A: each profile with the workflow it uses when the task names none (`workflowRef`), or null; file order. */ | N-8, G-A: each profile with the task type it uses when the task names none (`workflowRef`), or null; file order. */ | 앱 p5a-adapter (w3:pA) |
| `src/app/types.ts:222` | DR-41: what each workflow's own rules leave out of this config's policy. See WorkflowPolicyNarrowing. */ | DR-41: what each task type's own rules leave out of this config's policy. See WorkflowPolicyNarrowing. */ | 앱 p5a-adapter (w3:pA) |
| `src/app/types.ts:238` | DR-2: the workflow definition to use (`--workflow`, GT 4.2). Assumption (G-A): the CLI takes | DR-2: the task type definition to use (`--workflow`, GT 4.2). Assumption (G-A): the CLI takes | 앱 p5a-adapter (w3:pA) |
| `src/app/types.ts:490` | R-14 L-3: `--workflow` (G-F, GT-D1): the workflow the workspace form resolves to, so a plan made | R-14 L-3: `--workflow` (G-F, GT-D1): the task type the workspace form resolves to, so a plan made | 앱 p5a-adapter (w3:pA) |
| `src/app/types.ts:631` | The config file a run would read and what it holds; profile and workflow names. Reads only. */ | The config file a run would read and what it holds; profile and task type names. Reads only. */ | 앱 p5a-adapter (w3:pA) |
| `src/cli/args.ts:49` | `--workflow` (G-A, DR-2): the quick form's workflow definition id. Absent for a task file. */ | `--workflow` (G-A, DR-2): the quick form's task type definition id. Absent for a task file. */ | CLI na-core (w3:p2) |
| `src/cli/args.ts:380` | form does not need the run's limits; the form is read for the secrets and the workflow only. | form does not need the run's limits; the form is read for the secrets and the task type only. | CLI na-core (w3:p2) |
| `src/cli/changes.ts:99` | The workflow decides no secret, so `changes` takes no --workflow. | The task type decides no secret, so `changes` takes no --workflow. | CLI na-core (w3:p2) |
| `src/cli/doctor.ts:782` | DR-41: where a workflow definition applies (the task's workflowRef, else the profile's), the | DR-41: where a task type definition applies (the task's workflowRef, else the profile's), the | CLI na-core (w3:p2) |
| `src/cli/human/output.ts:133` | G-A: the workflow tools (inspect_files, propose_plan) have names for people too (ALL_TOOL_NAMES). | G-A: the task type tools (inspect_files, propose_plan) have names for people too (ALL_TOOL_NAMES). | 사람용 출력 nc-human (w3:p6) |
| `src/cli/plan-commands.ts:6` | so they register the same secrets and resolve the same workflow. None of them sends anything to | so they register the same secrets and resolve the same task type. None of them sends anything to | CLI na-core (w3:p2) |
| `src/cli/progress.ts:8` | each, what the workflow's rules left out of the given policy (run_started.policyNarrowings). | each, what the task type's rules left out of the given policy (run_started.policyNarrowings). | CLI na-core (w3:p2) |
| `src/cli/progress.ts:34` | DR-43 (b): what the workflow's own rules left out of the given policy, in the words of the | DR-43 (b): what the task type's own rules left out of the given policy, in the words of the | CLI na-core (w3:p2) |
| `src/cli/report.ts:344` | G-A: a plan run names its plan; a run awaiting review carries the workflow's checklist. | G-A: a plan run names its plan; a run awaiting review carries the task type's checklist. | CLI na-core (w3:p2) |
| `src/cli/run.ts:252` | G-A: what each workflow problem means, after the field position (never a value). */ | G-A: what each task type problem means, after the field position (never a value). */ | CLI na-core (w3:p2) |
| `src/cli/run.ts:265` | G-A: the config as a task sees it when a workflow definition applies: the definition's limits | G-A: the config as a task sees it when a task type definition applies: the definition's limits | CLI na-core (w3:p2) |
| `src/cli/run.ts:287` | G-A: the resolved task carries every workflow field when a workflow applies; a task with no | G-A: the resolved task carries every task type field when a task type applies; a task with no | CLI na-core (w3:p2) |
| `src/cli/run.ts:288` | workflow keeps none of them, so it runs exactly as before stage 4 (GT-U14). | task type keeps none of them, so it runs exactly as before stage 4 (GT-U14). | CLI na-core (w3:p2) |
| `src/cli/run.ts:570` | G-A (GT-D1): the workflow definition named by the task's workflowRef, --workflow or the | G-A (GT-D1): the task type definition named by the task's workflowRef, --workflow or the | CLI na-core (w3:p2) |
| `src/cli/run.ts:600` | G-A: resolve the workflow settings under the definition's ceilings (resolveWorkflow). | G-A: resolve the task type settings under the definition's ceilings (resolveWorkflow). | CLI na-core (w3:p2) |
| `src/cli/task.ts:345` | G-A: the workflow fields a task file and a definition share (`tools`, `plan`, `completion`, `humanReview`). */ | G-A: the task type fields a task file and a definition share (`tools`, `plan`, `completion`, `humanReview`). */ | CLI na-core (w3:p2) |
| `src/cli/task.ts:378` | A workflow definition id (WORKFLOW_ID_PATTERN_SOURCE). */ | A task type definition id (WORKFLOW_ID_PATTERN_SOURCE). */ | CLI na-core (w3:p2) |
| `src/cli/task.ts:601` | G-A, review R-11 L-1: a workflow definition's limits. Values for the fields the task leaves | G-A, review R-11 L-1: a task type definition's limits. Values for the fields the task leaves | CLI na-core (w3:p2) |
| `src/cli/task.ts:608` | R-11 L-1: the task's own limits with the workflow definition's defaults under them. */ | R-11 L-1: the task's own limits with the task type definition's defaults under them. */ | CLI na-core (w3:p2) |
| `src/cli/task.ts:681` | G-A: the task's own workflow fields; resolved against the definition afterwards (resolveWorkflow). | G-A: the task's own task type fields; resolved against the definition afterwards (resolveWorkflow). | CLI na-core (w3:p2) |
| `src/cli/task.ts:727` | U-17: as boundedLimits, but a limit that is not set (the config's, or a workflow's partial ones) is no error. */ | U-17: as boundedLimits, but a limit that is not set (the config's, or a task type's partial ones) is no error. */ | CLI na-core (w3:p2) |
| `src/store/runs.ts:352` | DR-37 (d): the run's profile and workflow definition; an apply run's plan run has them. | DR-37 (d): the run's profile and task type definition; an apply run's plan run has them. | store nc-human (w3:p6) |
| `src/tools/index.ts:95` | For tests: replaces parts of the file system the workflow tools use. */ | For tests: replaces parts of the file system the task type tools use. */ | 도구 p5u-gui (w3:pB, G-C) |
| `src/tools/workflow-tools.ts:2` | The workflow tools `inspect_files` and `propose_plan` (G-C). Design: docs/design/general-tasks.md | The task type tools `inspect_files` and `propose_plan` (G-C). Design: docs/design/general-tasks.md | 도구 p5u-gui (w3:pB, G-C) |
| `src/workflows/index.ts:2` | Workflow definitions that ship with Codaryn, and `resolveWorkflow` (G-F, GT-D12). | Task type definitions that ship with Codaryn, and `resolveWorkflow` (G-F, GT-D12). | CLI na-core (w3:p2) |
| `src/workflows/index.ts:4` | workflow's name; the CLI resolves a definition into the task's explicit fields. | task type's name; the CLI resolves a definition into the task's explicit fields. | CLI na-core (w3:p2) |
| `src/workflows/index.ts:90` | GT-D1, GT-D2: the workflow settings of a task. Order: the definition's values (from the task's | GT-D1, GT-D2: the task type settings of a task. Order: the definition's values (from the task's | CLI na-core (w3:p2) |
| `src/workflows/index.ts:153` | A task with no workflow at all keeps the legacy settings object, field for field. | A task with no task type at all keeps the legacy settings object, field for field. | CLI na-core (w3:p2) |
| `gui/src/engine-host/host.ts:177` | A profile or task kind name: one short line without control characters. */ | A profile or task type name: one short line without control characters. */ | GUI p5u-gui (w3:pB) |
| `gui/src/engine-host/runs.ts:155` | config file's defaults, the profile, and (R-14 L-3) the task kind the run was started with. | config file's defaults, the profile, and (R-14 L-3) the task type the run was started with. | GUI p5u-gui (w3:pB) |
| `gui/src/engine-host/settings.ts:200` | DR-41: what a task kind's own rules leave out of the config's policy (the app layer's | DR-41: what a task type's own rules leave out of the config's policy (the app layer's | GUI p5u-gui (w3:pB) |
| `gui/src/engine-host/settings.ts:201` | policyNarrowings): the task kind, the kind of narrowing and a count. Never a rule or a path. | policyNarrowings): the task type, the kind of narrowing and a count. Never a rule or a path. | GUI p5u-gui (w3:pB) |
| `gui/src/main/gui-state.ts:4` | per workspace, the task form (profile and task kind names) of the runs started in this app and | per workspace, the task form (profile and task type names) of the runs started in this app and | GUI p5u-gui (w3:pB) |
| `gui/src/main/gui-state.ts:28` | A run's task form as the GUI started it: the profile and the task kind (null: the config's). */ | A run's task form as the GUI started it: the profile and the task type (null: the config's). */ | GUI p5u-gui (w3:pB) |
| `gui/src/main/gui-state.ts:54` | A profile or task kind name as the engine host takes it (no control characters, at most 200). */ | A profile or task type name as the engine host takes it (no control characters, at most 200). */ | GUI p5u-gui (w3:pB) |
| `gui/src/main/plans.ts:16` | R-14 L-3: the task kind the plan run was started with, or null. */ | R-14 L-3: the task type the plan run was started with, or null. */ | GUI p5u-gui (w3:pB) |
| `gui/src/renderer/api.ts:257` | DR-41: task kinds' narrowings of the config's policy; entries that do not fit are left out. */ | DR-41: task types' narrowings of the config's policy; entries that do not fit are left out. */ | GUI p5u-gui (w3:pB) |
| `gui/src/renderer/changes/changes-screen.ts:27` | Which run's changes to show next, and the profile and task kind of its task form. */ | Which run's changes to show next, and the profile and task type of its task form. */ | GUI p5u-gui (w3:pB) |
| `gui/src/renderer/plan/plan-screen.ts:33` | Which plan run to show next, and the profile and task kind of its task form. `formKnown` false | Which plan run to show next, and the profile and task type of its task form. `formKnown` false | GUI p5u-gui (w3:pB) |
| `gui/src/renderer/run/new-task.ts:3` | the open workspace (a handle), a goal, and the task kind and profile chosen from the settings. | the open workspace (a handle), a goal, and the task type and profile chosen from the settings. | GUI p5u-gui (w3:pB) |
| `gui/src/renderer/runs/cleanup-screen.ts:3` | workspace's run records and discard boxes. | workspace's run records and discarded-files folders. | GUI p5u-gui (w3:pB) |
| `gui/src/renderer/runs/cleanup-screen.ts:7` | discard boxes (older than some days, or one by one), and sees the plan first. Cleaning sends the | discarded-files folders (older than some days, or one by one), and sees the plan first. Cleaning sends the | GUI p5u-gui (w3:pB) |
| `gui/src/renderer/runs/cleanup-screen.ts:9` | runs not (or only partly) reverted, and apart the discard boxes (people's files, gone for good). | runs not (or only partly) reverted, and apart the discarded-files folders (people's files, gone for good). | GUI p5u-gui (w3:pB) |
| `gui/src/renderer/settings/settings.ts:109` | DR-41: one line per task kind and narrowing ("organize: 1 allowed command left out"); null when none. */ | DR-41: one line per task type and narrowing ("organize: 1 allowed command left out"); null when none. */ | GUI p5u-gui (w3:pB) |
| `gui/src/renderer/settings/settings.ts:124` | DR-41: the config's rules are merged with each task kind's own, never put in their place. | DR-41: the config's rules are merged with each task type's own, never put in their place. | GUI p5u-gui (w3:pB) |
| `gui/src/shared/ipc.ts:197` | A run's task form as the GUI started it (profile and task kind names; null: the config's). */ | A run's task form as the GUI started it (profile and task type names; null: the config's). */ | GUI p5u-gui (w3:pB) |
| `gui/src/shared/ipc.ts:290` | DR-41: what each task kind's own rules leave out of these rules. */ | DR-41: what each task type's own rules leave out of these rules. */ | GUI p5u-gui (w3:pB) |
| `gui/src/shared/ipc.ts:362` | DR-41: what a task kind's own rules leave out of the config's policy (kinds and counts only). */ | DR-41: what a task type's own rules leave out of the config's policy (kinds and counts only). */ | GUI p5u-gui (w3:pB) |
| `gui/src/shared/ipc.ts:459` | DR-41: what each task kind's own rules would leave out of the new policy. */ | DR-41: what each task type's own rules would leave out of the new policy. */ | GUI p5u-gui (w3:pB) |
| `gui/src/shared/ipc.ts:569` | `startRun` arguments: the workspace handle, the goal, and the profile and task kind chosen, or null. */ | `startRun` arguments: the workspace handle, the goal, and the profile and task type chosen, or null. */ | GUI p5u-gui (w3:pB) |
| `gui/src/shared/ipc.ts:661` | A plan action as the window shows it: a move from → to, or a discard of `from` (to the discard box). */ | A plan action as the window shows it: a move from → to, or a discard of `from` (to the discarded-files folder). */ | GUI p5u-gui (w3:pB) |
| `gui/src/shared/ipc.ts:758` | GU-5: `plan` and `changes` arguments: the workspace, the run chosen, and the profile and task kind | GU-5: `plan` and `changes` arguments: the workspace, the run chosen, and the profile and task type | GUI p5u-gui (w3:pB) |
| `gui/src/shared/ipc.ts:759` | of its task form (DR-17, DR-28; R-14 L-3: the task kind the run was started with). | of its task form (DR-17, DR-28; R-14 L-3: the task type the run was started with). | GUI p5u-gui (w3:pB) |

- 담당별 주석 줄 수: 앱 p5a-adapter 25, GUI p5u-gui 25(task kind 21, discard box 4), CLI na-core 24, 도구 p5u-gui 2, store nc-human 1, 사람용 출력 nc-human 1.
- 이 표는 `d3e8d90`(main `a191a50`과 같은 남의 파일)에서 만들었다. 생성 스크립트와 원자료: scratchpad `u28_table.mjs`, `u28_scan.mjs`, `u28_rows.tsv`.

