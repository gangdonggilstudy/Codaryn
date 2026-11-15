# R-31 병합 전 보안 검토: DR-41 작업 종류 정책 합치기 (w3:p4, 2026-11-12)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어(보안 검토). 읽기 전용이며 파일 수정·커밋은 없다.
- **고정 판: `pm/bundle-5` = `ab31417`**(main `18128f4`에 8개 브랜치를 합친 것). 비교판은 main `18128f4`.
- DR-41에 닿는 커밋(`git log main..pm/bundle-5`)

  | 영역 | 커밋 |
  | --- | --- |
  | 계약 | `e7b6652`(mergeWorkflowPolicy), `ff71597`(workflowPolicyNarrowings), `b190bdf`(task 파일에도 적용) |
  | CLI | `4b0295b`(간편 형식과 task 파일에 적용) |
  | 엔진 | `43e7538`(run_started 기록) |
  | 앱 계층 | `a5a3f8d`(넓힘 판정이 합친 정책을 비교) |
  | 병합 | `f1a8301`, `6c99681`, `10eaca6`, `1a88560`, `522247e` |

  - 같은 범위의 `753b761`·`0d38bfa`(doctor 문구), `f38bfdd`·`368d5cd`(키 문구), `27afb01`·`e49f6f8`(DR-38·39)은 DR-41과 닿는 곳만 읽었다.
- 사본: `.codaryn/r31/b`(`git archive ab31417`), `.codaryn/r31/m`(`git archive 18128f4`)
  - 둘 다 `npm run build` 성공. 루트 `node_modules`는 내 작업 트리로 정션.
  - GUI는 `b/gui/node_modules`를 이미 설치된 `.worktrees/claude-gui/gui/node_modules`(Electron 45.3.1)로 정션했다. 새로 내려받은 것은 없다.
- 실험: `.codaryn/r31/r31.mjs`(P, Q, V, A), `r31b.mjs`. 로그는 `.codaryn/r31/*.log`.
  - 실제 CLI와 앱 API에 실제 설정·task·대본 파일을 줬다.
  - 대본 실행은 주소가 없다. 간편 형식은 127.0.0.1의 가짜 Anthropic 서버와 네트워크 울타리를 썼다(차단 0건).
  - 닿지 않아야 하는 주소에는 `127.0.0.1:9`(닫힌 포트)를 썼다.

심각도: 높음, 중간(재현되는 결정 위반, 선행 조건 있음), 낮음, 정보.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 2 (R31-L1 실행 시작 줄에 알림 없음, R31-L2 검증기는 여전히 대체됨) |
| 정보 | 3 (R31-I1~I3) |

| 중점 | 결과 |
| --- | --- |
| (1) 합친 뒤에도 작업 종류의 규칙이 풀리는 길 | **정책에서는 찾지 못했다**(2절). |
| | - task 파일 다섯 가지와 간편 형식의 프로필 정책이 모두 작업 종류 규칙 안에 머물렀다. |
| | - 보호 경로는 표기를 바꿔 적어도 정의의 것이 남는다. |
| | - 명령 교집합은 인자 접두와 `allowExtraArgs`에서 늘 좁은 쪽을 남긴다. |
| | - 정책 필드 6개와 명령 규칙 필드 3개를 모두 다룬다. 빠지는 제한 필드가 없다. |
| | - 환경 변수는 정책을 바꾸지 않는다. |
| | - **검증기는 대체된다**(R31-L2). |
| (2) 작업 종류 없는 task와 기존 간편 실행 | **main과 같다.** 대본 task의 결과, 도구 판정, 기록 종류 순서, `run_started` 내용이 같다. 작업 종류 없는 간편 실행(`--profile p`)의 결과·판정·`run_started` 필드도 같다 |
| (3) 알림의 값과 개수 | **값은 없다.** doctor 글·JSON과 `run_started`는 종류와 개수만 싣는다. task 파일과 `profile.workflowRef` 경로에서 doctor와 `run_started`의 개수가 같다. **그러나 실행 시작 줄은 아무것도 말하지 않는다**(R31-L1). `--workflow`로 고르는 간편 실행은 doctor가 미리 보일 수 없다(R31-I1) |
| (4) 앱 판정과 CLI의 합친 정책 | **어긋남을 찾지 못했다.** 8가지 설정 변경 모두 CLI가 실제로 쓰는 합친 정책의 넓어짐과 같게 잡혔다. `planActions` 생략으로 organize가 `discard`를 되찾는 경우도 잡힌다 |
| (5) GUI | **유닛 `npm test` 134건 중 134 통과**, 실패·건너뜀·todo 0. **연기 시험 두 번 모두 131건 중 131 통과**, 앱 종료 0 |

## 2. 규칙을 풀어 보는 실험(P, Q)

작업 종류 w1의 정의(설정의 `workflows`)
- `commands`: node(절대 경로) `["check.mjs"]`, 추가 인자 없음
- `protectedPaths`: `["secret"]`
- 대본은 네 호출을 한다: `node -e 1`, `node check.mjs`, `node check.mjs --x`, `secret/x.txt` 쓰기

**P. task 파일(`workflowRef: w1`)이 자기 정책을 줄 때**(고정 판)

| task 정책 | 도구 결과(네 호출) | `run_started.policyNarrowings` | doctor `--task` |
| --- | --- | --- | --- |
| 아무 node 명령, 추가 인자 허용, 보호 경로 `[]` | 거부, 허용, 거부, 거부(`secret` 보호 유지) | `commands_narrowed` 1 | 같음 1 |
| 정의와 같은 접두에 추가 인자 허용 | 거부, 허용, 거부(추가 인자), 거부 | `commands_narrowed` 1 | 같음 |
| 실행 파일을 대문자로 | 모두 거부(규칙 빠짐) | `commands_dropped` 1 | 같음 |
| 보호 경로 `SECRET/`, `./secret`, `secret\` | 명령 모두 거부, `secret/x.txt` 거부 | 없음 | 없음 |
| `restorePathTokens: true` | 명령 거부, 쓰기 거부 | `restore_path_tokens_off` | 같음 |

- 다섯 경우 모두 `secret/x.txt`는 만들어지지 않았다.

**Q. 간편 형식 `--profile p --workflow w1`**: 프로필 정책은 아무 node 명령을 허용한다. 대본은 `node -e 1`, `node check.mjs` 두 호출이다.

| 판 | 도구 결과 | 비고 |
| --- | --- | --- |
| main `18128f4` | 허용, 허용 | 프로필 정책이 w1의 규칙을 통째로 대체한다. F-5의 느슨해짐이다 |
| 고정 판 `ab31417` | **거부**, 허용 | 합쳐짐. `run_started`에 `commands_narrowed` 1 |
| 작업 종류 없이 `--profile p`(두 판) | 허용, 허용 | 두 판 같음 |

- 코드 확인
  - `PolicyConfig`(`commands`, `network`, `destructive`, `restorePathTokens`, `protectedPaths`, `planActions`)와 `CommandRule`(`executable`, `argsPrefix`, `allowExtraArgs`)의 모든 필드를 `mergeWorkflowPolicy`가 다룬다(`src/contracts/workflow.ts:109-166`).
  - 교집합(`commandRuleIntersection`)
    - 접두 길이가 같으면 `allowExtraArgs`가 둘 다 참일 때만 참이다.
    - 다르면 긴 접두를 남기고, 짧은 쪽이 추가 인자를 허용할 때만 남긴다.
    - 짧은 쪽이 추가 인자를 허용하지 않으면 공통 명령 줄이 없어 규칙이 빠진다. 넓은 쪽이 남는 경우는 없다.
  - 빈 배열과 생략의 차이
    - `planActions`를 생략하면 정의의 것이 그대로 남는다.
    - `[]`로 주면 모두 빠진다(좁아짐).
    - `protectedPaths`는 어느 쪽이든 합집합이다.
  - 설정 안의 여러 정책 블록: 프로필 정책이 설정 정책을 대신한 다음 정의와 합친다(N-8 그대로). 그래서 어느 블록도 정의를 풀지 못한다.

## 3. 낮음

### R31-L1 실행 시작 줄이 빠진 것을 알리지 않는다: doctor와 run_started만 말한다

- 위치
  - 계약과 카탈로그에는 문구가 있다: `src/contracts/human.ts:481-484`의 `progress.workflow_policy.*`, `src/i18n/en.ts:82` 등.
  - 그러나 그리는 코드가 없다. 사람용 출력의 `run_started`는 제공자 줄만 낸다(`src/cli/human/output.ts:276-278`).
  - 전체 소스에서 `progress.workflow_policy`를 쓰는 곳은 카탈로그뿐이다.
- 재현
  - P(task 파일)와 Q(간편 형식) 모두 `run_started`에 개수가 있는데 stderr의 시작 줄에는 해당 줄이 없다.
  - 예: P 첫 경우의 stderr 앞 8줄은 "run started — provider scripted", 보호 대상 확인, turn 1, "run command — denied …" 순이다.
- 영향
  - 사람이 실행 중에는 자기 정책의 일부가 쓰이지 않았다는 것을 모른다. doctor를 따로 돌리거나 기록을 봐야 안다.
  - 판정 자체는 맞고(좁아질 뿐) 값 노출도 없다.
  - 계약 주석(`workflowPolicyNarrowings`: "so doctor and the run's start can tell the person")과 다르다.
- 권고(CLI 담당): `run_started`의 `policyNarrowings`를 사람용 진행 줄로 그린다.

### R31-L2 검증기는 합쳐지지 않고 대체된다: 설정의 검증기가 작업 종류 자신의 검사를 없앤다

- 위치: `src/cli/run.ts:274`의 `const verifiers = quick ? (base.verifiers ?? definition.verifiers) : base.verifiers`
- 재현(V): w1에 자기 검증기(없는 파일 `must.txt`가 있어야 함)를 두었다.
  - 설정에 검증기가 없으면 w1의 검사가 돌아 `failed`/`verifier_failed`다.
  - 설정에 다른 검증기(`seed.txt` 있음)를 두면 **w1의 검사는 돌지 않고** `done`/`verified`다.
  - 실행·doctor 어디에도 알림이 없다.
- 판단
  - DR-41 본문은 정책(보호 경로, 명령, 계획 동작)만 정했다. 그러니 결정 위반은 아니다.
  - 그러나 같은 원칙("설정을 더했는데 제한이 풀리는 것")에 해당한다.
  - 앱 계층은 설정 검증기가 생기거나 없어질 때 `verifier_removed@workflows.<id>.verifiers`로 확인을 받는다(R-27에서 재현). CLI·설정 파일 직접 수정·프로필 경로에는 그런 확인이나 알림이 없다.
- 권고(PM 판단): 다음 중 하나
  - 검증기도 합집합으로 둔다(정의의 검사를 늘 돌림).
  - 대체를 유지하되 doctor와 실행 시작 줄에 "작업 종류의 검사 n개가 쓰이지 않음"을 알린다.

## 4. 정보

- **R31-I1 doctor는 `--workflow`를 받지 않는다**(`invalid_arguments`, 사용법 `codaryn doctor [--config] [--vars-file] [--task | --workspace] [--profile] [--json]`).
  - `run --workspace … --workflow <id>`의 빠진 것은 doctor로 미리 볼 수 없다.
  - 프로필의 `workflowRef`로 고르면 볼 수 있다. 실험에서 세 종류(`commands_dropped`, `commands_narrowed`, `plan_actions_dropped`)를 개수로 보였고, 글 줄에 규칙·경로·실행 파일 값이 없었다.
  - task 파일 경로도 개수가 맞는다.
- **R31-I2 명령 규칙은 실행 파일 이름을 글자 그대로 비교한다.** 같은 프로그램을 다른 표기(대소문자, `node`와 `node.exe`, 절대 경로)로 적은 설정 규칙은 빠진다. `commands_dropped`로 알리고 좁아지는 쪽이라 안전하지만, Windows 사용자에게는 뜻밖일 수 있다.
- **R31-I3 보호 경로 합집합도 글자 그대로다.** `SECRET/`, `./secret`, `secret\`는 별도 항목으로 더해질 뿐 정의의 `secret`은 늘 남는다. 빠지는 경우는 없다. 실제 거부는 `secret/x.txt` 쓰기에서 확인했다.

## 5. 앱 계층 판정 대 CLI(과제 4)

`proposeSettingsChange`에 실제 설정 파일을 줬다(앞 → 뒤).

| 변경 | 넓힘 | CLI가 쓰는 합친 정책의 변화 |
| --- | --- | --- |
| 정책의 `planActions: ["move"]` → 생략 | `plan_action_allowed@workflows.organize.policy.planActions` | organize `[move]` → `[move, discard]`(합치기 함수로 확인) |
| `["move"]` → `["move","discard"]` | `plan_action_allowed@policy.planActions` | 넓어짐 |
| `[]` → 생략 | `plan_action_allowed@workflows.organize…` | organize가 move·discard를 되찾음 |
| w1이 허용하는 명령 규칙 추가 | `command_added@policy.commands[0]`, `extra_args_allowed` | 작업 종류 없는 실행이 넓어짐 |
| w1이 허용하지 않는 명령 규칙 추가 | `command_added@policy.commands[0]` 등 | 작업 종류 없는 실행이 넓어짐(w1에서는 빠짐) |
| 설정의 보호 경로 삭제 | `protected_path_removed@policy.protectedPaths` | 넓어짐(w1의 것은 남음) |
| 설정 정책 통째로 삭제 | 위와 `command_added@workflows.w1.policy.commands[0]` | w1 간편 실행이 자기 규칙(check.mjs)을 되찾음 |
| w1 정의 안의 규칙을 넓힘 | `workflow_changed`, `command_added@workflows.w1…` | 넓어짐 |

- 확인 없이 넓어지는 경우는 없었다.
- 프로필 정책의 변경은 `profile_changed`로 잡힌다(R-27 I-4와 같음).

## 6. GUI(과제 5)

- `npm test`(빌드, `check-lock`, 유닛): 134건 중 134 통과
- `npm run test:smoke` 두 번: 각각 131건 중 131 통과, 앱 종료 0
  - `apiRequests`와 `transportRefused`(loopback-only, 0)는 두 번 모두 통과했다.
  - R-29 L1(창 닫기 경합)은 이번에는 드러나지 않았다.
- 로그: `.codaryn/r31/gui-unit.log`, `smoke-1.log`, `smoke-2.log`

## 7. 검사하지 않은 범위

- 계획 실행과 적용(`plan`·`apply`) 경로의 합친 정책을 실제 계획으로 확인하는 것. 코드상 같은 준비 함수(`prepareTask`)를 지난다.
- 앱 계층 `startRun`의 합친 정책. CLI 경로만 실행했다.
- macOS·Linux

## 8. PM 판단 필요

- **Q-1(R31-L2)**: 검증기를 합집합으로 바꿀지, 대체를 유지하고 알릴지.
- **Q-2(R31-L1, I1)**: 실행 시작 줄 알림을 이번 병합 전에 넣을지. doctor에 `--workflow`를 더할지.

사용자에게 물을 질문은 없다.
