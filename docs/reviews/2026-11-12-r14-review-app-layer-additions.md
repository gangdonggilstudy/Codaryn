# R-14 교차 검토 보고서: 앱 계층 추가분(병합 전, 읽기 전용)

## 0. 대상과 방법

- 대상: PM 통합 트리의 고정 판 `pm/bundle-1` **`7de824a`**
  - `src/app` 전체(17개 파일, 약 2,800줄)와 `src/cli/changes.ts`
  - 실행 목록·되돌리기 미리보기·latest, 설정 만들기, 설정 읽기·바꾸기, 계획 보기·`applyPlan`·`review`, 적용·되돌리기의 동의 전달, 변경 비교
- 각 파일의 마지막 커밋(`7de824a` 기준)

  | 파일 | 커밋 |
  | --- | --- |
  | `app.ts`, `plans.ts` | `64ecaee` |
  | `consent.ts`, `apply.ts`, `events.ts`, `assemble.ts` | `ec1914d` |
  | `changes.ts` | `a1d7a69` |
  | `settings-change.ts` | `c1957d8` |
  | `settings.ts` | `59dc39a` |
  | `init.ts` | `b015c9f` |
  | `runs.ts`, `environment.ts` | `0bc6bad` |
  | `src/cli/changes.ts` | `9abdf8b` |

- 대조 기준: `docs/design/adapter-contract.md`(같은 커밋), 결정 DR-1~DR-30(`docs/work-orders/phase-4-5-design.md`), UX 7절
- 방법
  - `git archive 7de824a`를 스크래치에 풀어 빌드했다(tsc 오류 0).
  - 실제 앱 계층(`createCodarynApp`)을 실제 파일·store·엔진과 scripted 모델로 불렀다.
  - 값은 모두 가짜다(비밀 `zz-r14-…-zz`, 키 자리 `fake-r14-key-value-0001`). 실제 API, 네트워크, 키 파일은 쓰지 않았다.
  - 저장소 파일은 고치지 않았다.
- 재현 스크립트와 출력(스크래치): `r14/exp/r14.mjs`·`r14.out`, `r14b.mjs`·`r14b.out`, `r14c.mjs`·`r14c.out`, `r14c-head.mjs`(같은 입력을 `claude/workspace-policy` `2948744` 빌드로)

## 1. 요약

| 등급 | 건수 | 항목 |
| --- | --- | --- |
| 높음 | 0 | |
| 중간 | 1 | M-1 고정 판의 앱 `plan`이 계획 실행이 가린 값을 보인다(R-11 M-1이 앱 경로로 남음) |
| 낮음 | 3 | L-1 손상 실행의 `changes`, L-2 명령 검증기 추가가 넓히기로 잡히지 않음, L-3 `TaskForm`에 `workflowRef` 없음 |
| 정보 | 5 | I-1~I-5 |

중점 다섯 가지의 결과

- 보안 검사 건너뛰기: 찾지 못했다.
  - 실행·계획·적용·검토·변경 비교는 모두 CLI 함수를 인자 목록으로 부른다. `runCli`, `runPlan`, `runApply`, `runReview`, `probeSecrets`(→ `runCli`)가 같은 검사를 한다.
  - 설치 위치(U-3), S-5, 키 규칙(S-6, S-8)이 앱을 거쳐도 거부됐다(H, I, K).
  - 옵션을 끼워 넣는 길도 막혀 있다. CLI 파서는 `--`로 시작하는 값을 받지 않고, 검토 메모의 `--` 시작은 앱이 거부한다.
- 설정 만들기
  - 기존 파일을 덮지 않는다(`config_exists`, 내용 그대로).
  - 작업 공간 안이면 디렉터리도 만들기 전에 거부한다(S-1).
  - 네트워크 경로도 거부한다(A1~A4).
- 동의: 요청에 담긴 것만, 경로 `adapter`로 엔진에 간다(B).
  - 요청에 경로를 바꿔 넣어도 `adapter`가 된다.
  - 다른 계획의 다이제스트, `latest`, 다른 실행, 드라이 런은 실행 전에 거부한다.
- `process.env`: 실행과 적용의 명령은 환경 사본을 받는다(C2: 사본에만 있는 `LANG`이 검증기에 닿음). 사본 밖에서 읽는 곳은 I-1, I-2다.
- 이벤트: 실행 이벤트 9건에 비밀이 없다(C1). 적용 이벤트도 같은 게이트로 다시 가린다(코드, M-2 재현의 이벤트에도 없음). 단, M-1은 이벤트가 아니라 `plan`의 출력이다.

## 2. 중간

### M-1 고정 판의 앱 `plan`이 계획 실행이 가린 값을 보인다

- 위치: `src/app/app.ts:568-574`(`plan`) → `src/cli/plan-commands.ts`의 `loadShown`(고정 판에는 DR-28 비교가 없다)
- 재현(`r14c.mjs`, `7de824a`)
  1. `privacy.secretEnv`로 비밀을 등록한 task로 계획 실행을 한다. 이동 원본은 `<비밀 값>/a.txt`이다.
  2. 같은 작업 공간을 워크스페이스 형식(`TaskForm`)으로 부른다. 비밀을 등록하지 않은 설정에 `organize` 프로필을 둔다.
  3. 결과
     - `app.plan`이 `pending`으로 끝나고 출력에 비밀 값이 그대로 있다.
     - `app.applyPlan`은 엔진의 두 번째 방어(DR-28 엔진)에서 `failed`/`plan_stale`로 멈춘다.
     - 적용 실행 기록이 1개 생긴다. 그 기록과 출력, 이벤트에 비밀은 없고 파일은 옮겨지지 않았다.
- 원인: CLI의 DR-28 비교 `2f6d5c8`(claude/workspace-policy)이 고정 판보다 뒤에 커밋됐다. `git merge-base --is-ancestor 2f6d5c8 7de824a`가 거짓이다.
- 확인: 같은 입력을 `claude/workspace-policy` `2948744` 빌드로 돌리면(`r14c-head.mjs`) 다음과 같다.
  - `app.plan`, `app.applyPlan`이 모두 `plan_secrets_differ`다.
  - 비밀 값이 나오지 않고, 적용 실행 기록도 생기지 않는다.
- 권고: 묶음에 `2f6d5c8`(과 문서 `2948744`)을 넣은 판으로 병합한다. 앱 계층은 고칠 것이 없다.

## 3. 낮음

### L-1 실행 목록이 손상으로 보는 실행도 `changes`는 경로 목록을 낸다

- 위치: `src/app/changes.ts:204-234`(`readChanges`). 실행 디렉터리를 `realpath`와 대소문자 무시 비교로만 확인한다. store의 `inspectRun` 판정은 쓰지 않는다.
- 재현(`r14.mjs` D2)
  - `20991231T235959Z-0c0ffee0`에 다른 내용의 기록을 쓴다.
  - `listRuns`는 `damaged`, `report`는 `invalid_run_record`(N-27 b)로 본다.
  - 그런데 `changes`는 그 기록의 경로(`forged-path.md`)를 정상 목록처럼 낸다.
- 영향: 글은 DR-29로 나오지 않는다. 그래서 위조된 기록의 경로가 GUI 변경 보기에 실제 실행처럼 보이는 정도다.
- 덧붙여(D1): 대소문자만 바꾼 id는 거부되긴 한다. 다만 코드가 `invalid_run_record`("the run directory is a link")다. N-27 (a)의 `run_not_found`와 다르다.
- 권고(A-1): `readChanges` 앞에서 store `inspectRun`을 부른다. `missing`이면 `run_not_found`, `damaged`면 `invalid_run_record`다(report·revert와 같은 판정).

### L-2 설정 변경에서 명령 검증기 추가가 넓히기로 잡히지 않는다

- 위치: `src/app/settings-change.ts`의 `wideningOf`. 검증기는 제거만 본다.
- 재현(`r14.mjs` F1)
  - 설정에 `{ kind: "command", executable: "node", args: ["-e", "…rmSync…"] }` 검증기를 더한다.
  - 결과: 제안의 `widening`이 `[]`이고, `confirmWidening: false`로 적용해도 `written: true`다.
- 기준: UX 7절은 "허용 명령 추가"를 확인 대상으로 둔다(그 행은 [제안]). 명령 검증기는 실행마다 사용자 권한으로 돈다(R-11 L-3: 적용 뒤 인벤토리 다음에도 돈다). 모델이 부를 수 있는 명령은 아니지만 실행이 하는 일을 넓힌다.
- 권고(A-1, PM 판단): `command` 검증기의 추가·변경을 넓히기(`verifier_command_added`)로 본다.

### L-3 `TaskForm`에 `workflowRef`가 없어 간편 형식으로 만든 계획을 같은 형식으로 적용할 수 없다

- 위치
  - `docs/design/adapter-contract.md:251-254`, `src/app/types.ts:372-377`(`TaskForm`)
  - `src/app/apply.ts` `taskFormArguments`: `--workflow`를 만들지 않는다.
  - CLI의 task 형식에는 `--workflow`가 있다(DR-2, `TASK_FORM_USAGE`).
- 재현(`r14b.mjs` E)
  - 계획 실행 뒤 워크스페이스 형식 `applyPlan`은 `run_not_plan`이다. 그 형식이 `plan: "apply"` 워크플로로 해석되지 않기 때문이다.
  - `organize`를 지정한 프로필로는 `done/verified`다.
  - GUI가 `startRun`의 `workflowRef`로 만든 계획은 프로필 없이는 적용·검토할 수 없다. 보안 문제는 아니고 기능 공백이다.
- 권고(계약 담당, A-1): `TaskForm`에 `workflowRef: string | null`을 두고 `--workflow`로 넘긴다. 아니면 GUI가 프로필로만 워크플로를 고르도록 문서에 적는다.

## 4. 정보

- **I-1** `src/store/lock.ts:166`이 `process.env`의 `SystemRoot`를 읽는다. Windows에서 잠금 주인의 시작 시각을 물을 PowerShell을 찾으려는 것이다. 실행의 환경 사본(DR-4)과 무관한 프로세스 사실이다. 앱 계층에서 다른 `process.env` 읽기는 `createNodeAppEnvironment`의 스냅샷뿐이다(의도).
- **I-2** 앱 `applyPlan` → `runApply`가 `platform`을 넘기지 않아 검증기 명령 실행기는 `process.platform`을 쓴다. 부모 환경은 사본이다(`parentEnv` 기본값이 받은 `env`). 시험에서 `platform`을 바꿀 때만 차이가 난다.
- **I-3** `readSettings`·설정 변경의 출력에 펼친 경로(`file.path`)가 `display`와 함께 있다. N-1의 "펼친 경로를 쓰지 않음"은 문구와 사람용 출력 규칙이다. GUI 메인 프로세스가 화면에 `display`만 쓰는지는 GUI 검토 몫이다.
- **I-4** 낡은 글
  - `src/app/app.ts:438`의 주석 "plan, applyPlan and review … are left out": 바로 아래에 구현돼 있다.
  - `adapter-contract.md:173`의 "값이 있으면 `invalid_arguments`": 지금은 `--workflow`로 넘긴다.
- **I-5** `settingsSuggestions`는 `package.json`을 통째로 읽은 뒤 크기를 보고, 링크도 따라간다. CLI `init`(`src/cli/init.ts:113-117`)과 같다. 고정 이름만 취하므로 내용은 나가지 않는다.

## 5. 문제 없던 범위(재현)

- A1~A4 설정 만들기
  - 작업 공간 안이면 `invalid_config`이고 디렉터리를 만들지 않는다.
  - 기존 파일은 `config_exists`로 남기고 내용도 그대로다.
  - 바깥 새 경로는 만든다. UNC 경로는 `invalid_arguments`다.
- B 동의
  - 없음, 이 계획, 경로를 `cli-flag`로 바꿔 넣은 경우: 엔진이 받은 것은 각각 `null`, `adapter`, `adapter`다.
  - 다른 계획의 다이제스트는 `invalid_arguments`다.
  - 되돌리기의 `latest`, 다른 실행, 드라이 런 동의는 모두 `invalid_arguments`다.
  - `approval`은 언제나 `adapter`다.
- C 이벤트와 DR-4
  - 비밀이 든 파일을 읽고 비밀을 말하는 scripted 실행의 이벤트 9건에 비밀이 없다.
  - 사본에만 있는 `LANG`이 검증기 명령에 닿았다. `process.env.LANG`은 없다.
- D1 대소문자 변형 id: `report`는 `run_not_found`, `changes`는 거부(L-1의 코드 차이)
- H 설치 위치: `startRun`, `plan` 모두 `workspace_is_install_dir`
- I S-5(`\\server\share`, `\\.\pipe`, `\\?\GLOBALROOT`): `settingsSuggestions`·`listRuns`는 `invalid_arguments`, `readSettings`는 `invalid_config`
- K 설정 변경의 키(현재 키 값, 키 모양, `apiKey` 필드): 모두 `key_in_file`
- 변경 비교의 글: DR-29대로 나오지 않는다(`masking_unverified`).

## 6. 검사하지 않은 범위

- Linux·macOS 경로와 대소문자를 구분하는 볼륨
- `startRun`의 취소와 핸들 순서(어댑터 계약 5.1), 모델 목록·선택(`models`)
- 하드 링크 없는 볼륨의 실제 동의 흐름(B는 대리 엔진으로 전달만 확인)
- GUI(Electron) 쪽 화면과 메인 프로세스
- 실제 Anthropic API

## 7. 담당별 요청

- PM: M-1. 묶음에 `claude/workspace-policy` `2f6d5c8`을 넣은 판으로 병합한다.
- A-1(w3:pA): L-1(`changes`에 store 판정), L-2(명령 검증기 추가를 넓히기로), I-4(낡은 주석)
- 계약 담당: L-3(`TaskForm.workflowRef`), I-4(`adapter-contract.md:173`)
