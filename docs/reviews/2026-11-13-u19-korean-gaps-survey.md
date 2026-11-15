# U-19 한국어 빈 곳 메우기 (UXM-7, UXM-2, AXM-22) — nb-i18n

```
페르소나: CLI 개발자(주)
브랜치: unit/U-19-nb-i18n (main a191a50에서 땀) → 66292f4
작성자: gangdonggil <gangdonggilstudy@gmail.com>, trailer 없음. push 안 함. 실제 API·외부 네트워크 안 씀
확인 방법: main a191a50을 빌드해 CODARYN_LANG=ko로 직접 돌림
  - 예시 둘(examples/demo, organize-demo)과 analyze 작업 하나를 세션 임시 폴더에 복사
    (작업 공간이 설치 위치 안이면 CLI가 workspace_is_install_dir로 거부해 worktree 밖에 둠)
  - scripted 제공자만. 키 변수는 지우고, 기본 설정 위치(APPDATA, XDG_CONFIG_HOME)는 시험 폴더로 돌림
  - 터미널 질문과 models 표는 터미널·실제 API가 있어야 나와 코드로 봄
```

## 1. 지금 main에 남은 것

### 이미 닫혀 빠진 것

- `plan`의 기록 변경 경고와 다이제스트 설명 줄: 한국어(U-14)
- `plan`의 에이전트 설명: 한국어(U-21)
- `cleanup`의 틀린 다이제스트: 한국어 오류(U-22)
- 용어: U-24
- `changes`가 키를 요구하던 것(UXM-3): U-17. UXM-7 범위는 아니다.
- U-15(모델이 받는 글), U-20(GUI 오류 글)은 사람용 CLI 글에 닿지 않는다.

### 남은 것

| 지적 | 어디 | a191a50에서 본 것(ko) | 내 소유로 고치나 |
| --- | --- | --- | --- |
| UXM-7 ①, AXM-22 | `cleanup` 미리보기 | 항목 크기 `2 file(s), 6161 bytes`. 끝 안내 세 줄 `Nothing was removed. To remove the run records, run the same command with --confirm …`, `The records of 1 run(s) not reverted …`, `The records of 1 apply run(s) whose discarded files …`는 영어다 | 아니오. 새 id와 CLI가 필요하다 |
| UXM-7 ①, AXM-22 | `cleanup` 확인 뒤 | 지운 것이 없으면 `Nothing was removed.`(영어 고정). 남긴 줄과 막힌 줄의 이름표 `run`·`discarded`·`leftover`도 영어다 | 아니오 |
| UXM-7 ② | 도움말 다섯(`plan`·`apply`·`review`·`changes`·`cleanup`) | 사용법 줄과 영어 한 문장뿐이다. 옵션 목록과 종료 코드가 없다. `(DR-29)`, `(DR-39)`가 그대로 있다 | 아니오. 계약에 `HELP_COMMANDS`가 없다 |
| UXM-7 ③ | `plan` 본문 | `Plan of run …: 3 action(s), pending`, `Digest:`, `move`/`discard`, `(kept in .codaryn/discarded/ until removed)`, `To apply it: …`, `Applied by run … at <ISO 시각>.`가 영어다 | 아니오 |
| UXM-7 ③ | `changes` 본문 | 머리줄, `created by the run; as the run left it`, `the run changed no file`, 상태 넷, `the text is not shown (…)`, `… more lines`가 영어다. `(DR-29)`도 있다 | 아니오 |
| UXM-7 ④ | 터미널 질문(코드로 봄) | `Apply this plan? [y/N]`, 위험한 이동 동의 질문, `models`의 고르기 질문은 영어다. `init`의 질문은 이미 카탈로그를 쓴다 | 아니오 |
| UXM-7 (범위 근처) | `review`의 결과 | `Review of run …: accepted.`, `The run's result and records are unchanged; …`는 영어다 | 아니오 |
| UXM-7 | `models` 표(코드로 봄) | 머리, 현재 모델 줄, 쓴 뒤 줄이 모두 영어다 | 아니오 |
| UXM-7 ⑤ | `report` | 전체가 영어다(`# Codaryn run report`, `## Verification` …). 검토서는 따로 한 단위(11번)로 본다 | 아니오 |
| UXM-2 | 모든 인자 오류 | 사람용 줄은 `명령 인수가 올바르지 않습니다`뿐이다. 이유(없는 명령, 빠진 짝 옵션, 모르는 옵션, `apply`의 `latest`, 다이제스트 꼴, `review`의 판정, run id 꼴)는 영어 JSON에만 있다 | **일부.** 고치는 법 줄만 고쳤다(2절) |
| UXM-2 | task 파일 | 없는 파일과 작업 공간 안의 task 둘 다 필드 줄이 없다. 그런데 고치는 법은 "알려 준 필드를 고치세요"였다. 없는 파일의 JSON 글도 `cannot be read as JSON`이다 | **일부.** 고치는 법 줄만 고쳤다(2절) |
| UXM-2 | 설정 파일 | `--profile nope`, `--workflow nope` 둘 다 "설정 파일에서 알려 준 필드를 고치세요"인데 필드 줄이 없다 | 아니오. 아래 고정 시험과 문서에 걸린다 |
| UXM-2 | `key_in_file` | task·설정·목표 가운데 어디인지 사람용 줄에 없다 | 아니오 |
| UXM-2 | `provider_not_configured` | 빠진 항목(키 변수, 모델 자리표시자)이 영어 JSON에만 있다 | 아니오 |

**`error.invalid_config.fix`를 고치지 않은 이유.** 그 글자가 아래에 고정되어 있다.

- `tests/unit/cli/human/real-catalog.test.ts:151`(출력 담당)
- `docs/usage.md:428,435,541,940`(문서 담당)

바꾸면 다른 소유자의 시험과 문서가 바뀐다. 그래서 4절의 이유 줄(힌트)로 푸는 것이 낫다.

## 2. 이번에 고친 것 (`66292f4`)

| id | 전 | 후(ko) | 후(en) |
| --- | --- | --- | --- |
| `error.invalid_arguments.fix` | codaryn help <명령>으로 사용법을 확인하세요. | codaryn help <명령>으로 그 명령의 사용법을, codaryn --help로 명령 목록을 확인하세요. | See codaryn help <command> for a command's usage, and codaryn --help for the list of commands. |
| `error.invalid_task.fix` | task 파일에서 알려 준 필드를 고치세요. codaryn doctor --task <파일>로 점검할 수 있습니다. | --task에 준 파일이 있는지, 작업 공간 밖에 있는지 확인하세요. 필드를 알려 주었으면 그 필드를 고치세요. codaryn doctor --task <파일>로 점검할 수 있습니다. | Check that the file given with --task exists and is outside the workspace. If a field is named, fix that field. codaryn doctor --task <file> checks it. |

- **`invalid_arguments`:** 같은 코드가 없는 명령에도 나온다. 없는 명령에는 `help <명령>`이 없으므로 명령 목록 자리도 알린다.
- **`invalid_task`:** 모든 `invalid_task`는 `--task` 파일에서 나온다(`run.ts:428,516,517,617,668`).
  - 없는 파일과 작업 공간 안의 task는 필드 줄이 없다. 그래서 파일과 자리를 먼저 보게 했다.
  - `doctor --task`는 두 경우의 이유를 실제로 말한다: "task 파일을 읽을 수 없습니다", "입력 파일 1개가 작업 공간 안에 있거나 …".
- **두 글을 고정한 시험·문서는 없다.** `tests`, `gui`, `docs/usage.md`, `docs/cli-contract.md`를 찾았다. GUI는 자기 오류 글을 쓴다(`gui/src/renderer/i18n`).
- **시험:** `tests/unit/i18n/catalog.test.ts`에 "U-19 (UXM-2) …"를 더했다. 두 언어의 글, `doctor --task` 안내, 매개 없음을 본다.

**수치** (`66292f4`의 판, dist를 지우고 빌드, 키 변수 없이)

| 항목 | 결과 |
| --- | --- |
| typecheck (`npx tsc -p tsconfig.json`) | 0 |
| i18n (`node --test "dist/tests/unit/i18n/**/*.test.js"`) | 70/70 |
| unit (`npm run -s test:unit`) | 2274 (통과 2270, 실패 0, 건너뜀 3, todo 1) |
| integration (`npm run -s test:integration`) | 559/559 |

크기: 3개 파일, +21 −4줄.

## 3. 계약·CLI 목록 (고치지 않음): 파일:줄, 필요한 id, 담당

- 줄 번호는 main `a191a50`의 것이다. 이 브랜치는 `src/cli/**`를 바꾸지 않아 같다.
- id 이름과 매개 종류는 제안이다. 계약 담당이 정한다.
- 영어 글은 지금 문장을 그대로 영어 카탈로그에 옮기면 영어 출력을 고정한 시험이 덜 움직인다. 바뀌는 것은 결정 번호를 빼는 두 줄과 `file(s)` 꼴뿐이다.
- 담당 표기
  - 계약: `src/contracts/**`(w3:p9)
  - CLI: `src/cli/**`(w3:p2. `src/cli/human/**`를 출력 담당 w3:p6이 맡으면 PM이 나눈다)
  - 문구: 나(id가 들어오면 두 언어 글과 시험)

### A. `cleanup` — AXM-22가 가장 먼저 옮기라는 줄 (새 id 9 + 이름표 3)

| 파일:줄 | 지금 영어 | 필요한 id(매개) | 담당 |
| --- | --- | --- | --- |
| `src/cli/cleanup.ts:256`(쓰는 곳 355) | `N file(s), M bytes` | `cleanup.size` {files, bytes} | 계약, CLI |
| `cleanup.ts:394` | `Nothing was removed. To remove the run records, run the same command with --confirm <d>.` | `cleanup.next.confirm_runs` {}. CLI가 `--confirm <d>`를 뒤에 붙인다 | 계약, CLI |
| `cleanup.ts:398` | `The records of N run(s) not reverted … --include-not-reverted yourself; …` | `cleanup.next.not_reverted` {count} | 계약, CLI |
| `cleanup.ts:401` | `People's discarded files are deleted only with --delete-discarded besides.` | `cleanup.next.discarded` {} | 계약, CLI |
| `cleanup.ts:406` | `The records of N apply run(s) whose discarded files are still kept stay …` | `cleanup.next.discarded_left` {count} | 계약, CLI |
| `cleanup.ts:410` | `Nothing was removed. To delete the discarded files, … --confirm <d> --delete-discarded.` | `cleanup.next.confirm_discarded` {} | 계약, CLI |
| `cleanup.ts:412` | `Nothing was removed. To remove what earlier cleanups left, … --confirm <d>.` | `cleanup.next.confirm_leftovers` {} | 계약, CLI |
| `cleanup.ts:293` | 확인 뒤 `Nothing was removed.`(U-22 주석: "no catalog text yet") | `cleanup.nothing_removed` {} | 계약, CLI |
| `cleanup.ts:314`, `cleanup.ts:384` | `- run <id>: …`의 이름표 `run`·`discarded`·`leftover` | `cleanup.target.run`, `.discarded`, `.leftover` {} | 계약, CLI |

- `cleanup.ts:281,302,310,328,339,377`의 영어는 카탈로그가 실패할 때만 쓰는 대체 글이다. 카탈로그에 그 id가 모두 있다(ko·en 확인). CLI 담당이 지워도 된다.

### B. 도움말 다섯 (새 id 22)

| 파일:줄 | 지금 | 필요한 것 | 담당 |
| --- | --- | --- | --- |
| `src/contracts/human.ts:251` | `HELP_COMMANDS`에 다섯 명령이 없다 | `plan`, `apply`, `review`, `changes`, `cleanup`을 더한다. 그러면 `help.command.*`, `help.exit.*` 10개가 생긴다 | 계약 |
| `src/contracts/human.ts:274` 근처 | `HelpOption`에 새 옵션이 없다 | `help.option.digest`, `.accept`, `.reject`, `.note`, `.older_than`, `.run_ids`(cleanup의 `--run`은 `latest`를 받지 않음), `.reverted`, `.discarded_older_than`, `.discarded_run`, `.confirm`, `.include_not_reverted`, `.delete_discarded` (12개) | 계약 |
| `src/cli/help.ts:21-36`, `112`, `116` | `USAGE_ONLY`(영어 한 문장, `(DR-29)`(30행), `(DR-39)`(34행)) | `USAGE_ONLY`를 없애고 `USAGES`·`COMMAND_OPTIONS`·`OPTION_SYNTAX`에 넣는다 | CLI |

### C. `plan`·`apply`·`review` (새 id 약 13 + 상태 목록)

| 파일:줄 | 지금 영어 | 필요한 id(매개) | 담당 |
| --- | --- | --- | --- |
| `src/cli/plan-commands.ts:365` | `Plan of run <id>: N action(s), <status>` | `plan.heading` {runId, count} + `plan.status.<상태>` | 계약, CLI |
| `plan-commands.ts:366` | `Digest: <d>` | `plan.digest_label` {} | 계약, CLI |
| `plan-commands.ts:214,215` | `move`, `discard`, `(kept in .codaryn/discarded/ until removed)` | `plan.action.move`, `.discard`, `.discard_note` {} | 계약, CLI |
| `plan-commands.ts:374` | `The workspace has more files than the inventory check can list; …` | `plan.inventory_limit` {} | 계약, CLI |
| `plan-commands.ts:376` | `Applied by run <id> at <ISO>.` | `plan.applied_by` {runId}. 시각 꼴은 `runs`처럼 지역 시각으로 할지 계약 담당이 정한다(UXM-23) | 계약, CLI |
| `plan-commands.ts:378` | `To apply it: codaryn apply <the same task form> --run … --digest …` | `plan.next_apply` {}. 명령 줄은 CLI가 붙인다 | 계약, CLI |
| `plan-commands.ts:545` | `Apply this plan? [y/N] ` | `apply.question` {} + 기존 `prompt.yes_no_default_no` | 계약, CLI |
| `plan-commands.ts:660-662` | 위험한 이동 동의 질문 | `apply.unsafe_move_question` {count} | 계약, CLI |
| `plan-commands.ts:795` | `Review of run <id>: <verdict>[ (an earlier review was replaced)].` | `review.recorded` {runId} + `review.verdict.<accepted/rejected>`, `review.replaced` | 계약, CLI |
| `plan-commands.ts:797` | `The run's result and records are unchanged; …` | `review.unchanged` {} | 계약, CLI |

### D. `changes` (새 id 약 12)

| 파일:줄 | 지금 영어 | 필요한 id(매개) | 담당 |
| --- | --- | --- | --- |
| `src/cli/changes.ts:149` | `renderChanges(output)`가 카탈로그를 받지 않는다 | 카탈로그를 넘긴다 | CLI |
| `changes.ts:150` | `changes of run <id>, masked with the secrets registered now …` | `changes.heading` {runId} | 계약, CLI |
| `changes.ts:155` | `no text for some files: … (DR-29)` | `changes.no_text_note` {}. `(DR-29)`는 뺀다 | 계약, CLI |
| `changes.ts:157` | `the run changed no file` | `changes.none` {}. 적용 실행이면 UXM-4 쪽 문구(U-16 범위)와 맞춘다 | 계약, CLI |
| `changes.ts:159` | `created by the run` / `changed by the run` | `changes.file.created`, `.changed` {} | 계약, CLI |
| `changes.ts:111-116` | 상태 넷 | `changes.state.as_run_left`, `.changed_since_run`, `.missing`, `.unknown` {} | 계약, CLI |
| `changes.ts:162` | `the text is not shown (<이유 코드>)` | `changes.text_not_shown` {} + 이유 넷(`masking_unverified`, `masked_path`, `mask_failed` 등)의 글 | 계약, CLI |
| `changes.ts:166` | `no difference to the original` | `changes.no_difference` {} | 계약, CLI |
| `changes.ts:127` | `... N more lines` | `changes.more_lines` {count} | 계약, CLI |

- 이미 있는 `changes.records_changed`(ko: "이 실행에는 기록 변경 표시가 있어 파일 글을 보이지 않습니다. …")는 지금도 아무 데서도 쓰지 않는다(`src` 전체에서 카탈로그 밖 사용 0곳).

### E. `models` (새 id 약 7, 코드로 봄)

| 파일:줄 | 지금 영어 | 필요한 id | 담당 |
| --- | --- | --- | --- |
| `src/cli/models.ts:208` | 표 머리 `id`, `name`, `input tokens`, `output tokens` | `models.column.*` | 계약, CLI |
| `models.ts:230,232` | `No model was listed for this key.`, `Models this key can use (N):` | `models.none`, `models.heading` {count} | 계약, CLI |
| `models.ts:237,240` | 현재 모델 없음 / `* current model (from …)` | `models.no_current`, `models.current` | 계약, CLI |
| `models.ts:244,246` | `Written: …`, `Note: … is set and is used instead …` | `models.written`, `models.overridden` | 계약, CLI |
| `models.ts:394` | `Number or id to write into the config file's … (Enter to skip): ` | `models.pick` | 계약, CLI |

### F. `report` — UXM-7 ⑤, 따로 한 단위

- 어디
  - `src/cli/report.ts:461-560`: 실행 보고서
  - `report.ts:775-860`: 적용 보고서
- 제목, 고정 문장, `Not checked`의 넷째 줄까지 약 40곳이다. 카탈로그를 쓰지 않는다(`messages` 0곳).
- 검증기의 `checked`·`limits`는 엔진이 만드는 영어 근거다. 검토서 권고대로 "원문(영어)"로 두는 것이 맞다.
- 담당: 계약, CLI. 크기가 커서 1,500줄을 넘으면 절 단위로 나눈다.

### G. UXM-2 이유 줄 — 이미 있는 힌트 길을 쓰는 안

- **이미 있는 길:** `CliErrorOutput.hint`(`src/contracts/engine.ts:388`의 `CLI_ERROR_HINTS`, 지금 `quick_form_needs_task` 하나)가 있다. 사람용 오류에 들여 쓴 한 줄로 나온다(`src/cli/human/output.ts:211`, `error.hint.<hint>`).
- **안:** 힌트 코드를 더하면 JSON에는 필드 값만 늘어난다(DR-48의 "더하기만"과 맞음). 사람용 줄에 이유가 한국어로 나온다.

| 파일:줄 | JSON의 영어 이유 | 힌트 id 제안(매개) | 담당 |
| --- | --- | --- | --- |
| `src/cli/args.ts:545`(인자 없음과 없는 명령), `help.ts:140`(`help <없는 명령>`) | `usage: …` 900자 | `error.hint.unknown_command` {} — 인자 없음은 DR-49대로 도움말(CLI) | 계약, CLI |
| `args.ts:575` | `--workspace and --goal must be given together` | `error.hint.workspace_goal_together` {} | 계약, CLI |
| `args.ts:158,165`, `changes.ts:60,65`, `runs.ts:59,64`, `cleanup.ts:140` | `unknown or repeated option` | `error.hint.unknown_option` {position}. 옵션 이름을 되풀이할지 순번만 줄지는 PM이 정한다(UXM-2 개선안은 순번) | 계약, CLI, PM |
| `args.ts:486` | `apply needs the plan run's id; latest is not accepted …` | `error.hint.apply_needs_run_id` {} | 계약, CLI |
| `args.ts:490` | `--digest must be 12 to 64 lowercase hexadecimal characters …` | `error.hint.digest_form` {} | 계약, CLI |
| `args.ts:533` | `give --accept or --reject` | `error.hint.review_needs_verdict` {} | 계약, CLI |
| `args.ts:106`, `changes.ts:88` | `--run must be a run id (…) or "latest"` | `error.hint.run_id_form` {} | 계약, CLI |
| `src/cli/run.ts:516` | 없는 파일에도 `the task file cannot be read as JSON` | `error.hint.task_file_unreadable` {}. 영어 이유 자체도 틀렸다(읽지 못한 것이지 JSON 문제가 아님) | 계약, CLI |
| `run.ts:517` | 입력 파일이 너무 큼 | `error.hint.input_too_large` {} | 계약, CLI |
| `run.ts:668` | `… is inside the workspace or its location cannot be confirmed …` | `error.hint.input_inside_workspace` {} | 계약, CLI |
| `src/cli/config-file.ts:159` | `--profile needs a config file …` | `error.hint.profile_needs_config` {} | 계약, CLI |
| `config-file.ts:161,163` | `the config file has no profile with the name given by --profile` | `error.hint.profile_not_found` {}. 안내: `codaryn doctor --profile <이름>` | 계약, CLI |
| `run.ts:254`(쓰는 곳 617) | `workflowRef names no built-in workflow …` | `error.hint.task_type_not_found` {} | 계약, CLI |
| `run.ts:484` / `run.ts:538`, `models.ts:328` | 목표 / task·설정 파일의 키(`at <필드>`) | `error.hint.key_in_goal` {}, `error.hint.key_in_task` {field}, `error.hint.key_in_config` {field}. 필드 경로는 이미 `field` 종류가 있다 | 계약, CLI |
| `src/cli/settings.ts:183,275` | `not set: ANTHROPIC_API_KEY; the model …` | 빠진 항목 목록. 힌트가 하나뿐이라 `missing_key`·`missing_model`·`missing_output_limit` 중 여럿이면 꼴을 계약 담당이 정한다(목록 매개 종류가 없다) | 계약, CLI |
| `args.ts` `--version --json` | `usage: …` | `error.hint.version_no_json` {} | 계약, CLI |

- **이유 줄이 생기면 고정 글은 그대로 두어도 된다.** `error.invalid_config.fix`는 "알려 준 필드"를 말한다. 그 아래에 프로필·작업 종류 이유 줄이 붙으면 그 글을 바꾸지 않아도 사람이 맞는 곳으로 간다. 고정 시험(`real-catalog.test.ts:151`)과 문서도 그대로다.
- **작업 순서 제안:** 계약이 id를 올리면 나는 두 언어 글과 시험을, CLI는 연결과 영어 고정 시험을 맡는다. 그다음 문서 담당이 `docs/usage.md` 16절 "출력 언어"의 한계 목록과 18.8절의 "아직 영어" 줄을 줄인다.

### H. 확인하다 더 본 것 (UXM-7 목록 밖)

- **analyze 작업 종류의 확인 항목이 영어다.**
  - 어디: `src/workflows/index.ts:59-60`. "The report's interpretation matches the result table." 등이다.
  - 한국어 끝 요약의 "확인할 항목 2개", `review` 결과, 보고서에 그대로 나온다.
  - 이 글은 결과 JSON의 `review.checklist`에 실리는 값이다. 바꾸면 고정 값이 바뀐다.
  - 언어별로 둘지는 PM이 정할 일이다. 담당은 작업 종류 정의 쪽이다.
- **`help run`의 옵션 목록에 `--workflow`가 없다.** 사용법 줄에는 있다. UXM-20 몫이라 이 단위에서는 뺐다.
- **`usage:` 머리(`help.ts:116,118`)와 사용법 줄의 `<first 12+ hex>`가 영어다.** 사용법 꼴이라 둘 만하다. 바꾸려면 `help.usage_label`이 필요하다.

## 4. 합계

| 담당 | 묶음 | 할 일 |
| --- | --- | --- |
| 계약 | A~G | 새 문구 id 약 75개를 더한다. 묶음별 개수는 아래 표 |
| CLI | A~G | 연결한다 |
| 문구(나) | 이번 | 고친 것은 2절의 두 id다 |
| 문구(나) | 다음 | id가 들어오는 대로 두 언어 글과 시험을 넣는다 |

| 묶음 | 새 id |
| --- | --- |
| A `cleanup` | 12 |
| B 도움말 | 22 |
| C `plan`·`apply`·`review` | 약 13 + 상태 |
| D `changes` | 약 12 |
| E `models` | 약 7 |
| G 이유 힌트 | 약 18 |
| F `report` | 따로 |

- **G-12에 맞춘 나눔 제안:** 한 단위 1,500줄 이하이므로 넷으로 나눈다.
  1. A(+B의 `cleanup` 도움말)
  2. B
  3. C+D
  4. G
- E와 F는 각각 따로 한다.
- AXM-22의 요구대로 **A가 먼저다.** 지우기의 확인 방법과 "지우면 되돌릴 수 없다"는 경고가 아직 영어다.
