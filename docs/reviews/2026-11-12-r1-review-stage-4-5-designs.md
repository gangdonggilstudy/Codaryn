# R-1 설계 교차 검토 보고서

## 0. 이해 확인

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 읽기 전용 검토이며 구현자가 아니다.
- worktree: `D:\project\Codaryn\.worktrees\claude-store` / `claude/revert-store`. 시작 때 main을 병합했다(fast-forward, `0c3ec73` → `7d35d61`, 새 커밋 없음).
- 대상: main `7d35d61`의 `docs/design/adapter-contract.md`(AC), `vscode-extension.md`(VX), `general-tasks.md`(GT), `standalone-gui.md`(GUI). 기준 결정: `docs/work-orders/phase-4-5-design.md`의 "결정 (PM)"과 "구현 배정 (1차)".
- 규칙(개발 절차 9절): 저장소 파일 수정·커밋 없음. 실험은 빌드본(`dist/`)과 세션 scratchpad에서만 했다. 실제 API·외부 네트워크·키 파일 사용 없음. 작업 디렉터리 밖은 scratchpad 말고 읽지 않았다.
- `b386166..7d35d61` 사이에 `src`, `tests`, `package.json` 변경이 없다. 그래서 문서의 줄 번호는 지금 코드와 그대로 맞춰 볼 수 있다.

심각도 기준(설계 검토용)
- 높음: 채택된 결정끼리 충돌한다. 지금 배정된 구현(G-A 계약, A-1 앱 계층)이 서로 다른 계약을 만들게 된다.
- 중간: 보안·개인정보 경계의 빈틈, 검증할 수 없는 설계, 구현하면 동작이 바뀌는 서술.
- 낮음: 같은 의미 원칙과 어긋나는 세부, 근거 서술의 오류, 고지 부족.
- 정보: 고칠 필요는 없지만 알아 둘 점, 문제 없던 범위.

## 1. 요약

| 심각도 | 건수 | 번호 |
| --- | --- | --- |
| 높음 | 1 | H-1 |
| 중간 | 8 | M-1~M-8 |
| 낮음 | 7 | L-1~L-7 |
| 정보 | 6 | I-1~I-6 |

- 문서가 인용한 코드 근거(약 60곳)는 모두 지금 코드와 맞았다(I-5). 어긋남은 줄 번호가 아니라 의미에 있다.
  - L-1: 기록이 모두 가림본이라는 전제
  - M-3: 사본 환경으로 옮겨도 동작이 같다는 전제
  - L-4: 키가 확장 호스트에 없다는 근거
- 가장 급한 것은 H-1이다. 계획 승인이 AC에서는 실행 중 질문이고 GT에서는 실행 사이 확인인데, PM이 둘 다 채택했다. 두 어댑터 설계는 AC 쪽을 따랐다. G-A와 A-1이 지금 계약을 만들고 있으므로 먼저 정해야 한다.

## 2. 높음

### H-1 계획 승인: 실행 중 질문(AC)과 실행 사이 확인(GT)이 둘 다 채택됐다

- AC 쪽
  - `adapter-contract.md:225`: "계획 확인(파일 정리 등)과 실행 중 권한 확인을 같은 통로로"
  - `:238-245`: `ConfirmRequest`에 `kind: "plan"`, `planHash`, `steps`
  - `:249`: 답 `approve` + `planHash`
  - `:258`: "계획 승인은 해시에 묶인다"
  - `:372`(AC-D4): 확인 질문 타입을 지금 정함
- GT 쪽
  - `general-tasks.md:228-231`(GT-D4): "계획 확인은 실행 중에 엔진을 멈춰 기다리는 질문이 아니다. 실행 사이의 확인"
  - `:236-244`: `plan_pending`(종료 3) → `codaryn plan` → `codaryn apply --digest <앞 12자 이상>`
  - `:257`: 다이제스트는 `plan.json` 바이트의 SHA-256이다
  - `:278`: 어댑터는 `applyPlan(runId, digest)`를 부른다
- PM 결정: `phase-4-5-design.md:65`는 AC-D1~D12, `:68`은 GT-D4를 함께 채택했다.
- 어댑터 설계는 AC 쪽을 따랐다.
  - `standalone-gui.md:75`: 흐름이 `[새 작업] → [계획 확인]* → [실행]`이다. 계획은 실행(제안 실행)이 만들므로 실행 앞에 올 수 없다.
  - `standalone-gui.md:161`, `:326`: 계획 확인을 `RunObserver.confirm`의 실행 중 패널로 그린다.
  - `vscode-extension.md:102`, `:114`: 계획 승인을 `--confirm stdio` 모달로 처리한다.
- 해시 정의도 다르다.
  - AC는 "계획 본문의 해시"(`ContentHash` 전체)다.
  - GT는 `plan.json` 바이트 해시이고 앞 12자 이상으로 승인한다.
  - `plan.json`에는 정책·검증기 사본도 들어 있어(`general-tasks.md:255`) 같은 "계획"이라도 해시가 다르다.
- 결과
  - G-A(계약)가 GT 9절대로 `plan_pending`·`ApplyPlan`을 넣는다.
  - A-1(앱 계층)이 AC 5.7대로 `plan` 질문 통로를 넣는다.
  - 그러면 같은 기능에 두 계약이 생긴다. 실행 중 `plan` 질문은 GT 엔진에서 나올 곳이 없다.
- 권고(PM 판단)
  - AC 5.7의 `ConfirmRequest`에서 `plan`을 빼고 권한 확인 전용으로 둔다.
  - 계획은 `CodarynApp`에 `plan(runId)`·`applyPlan(runId, digest)`로 넣는다(M-2).
  - 두 어댑터는 `needs-input`/`plan_pending` 결과 뒤에 계획 화면을 연다.
  - 해시는 GT의 다이제스트 하나로 통일한다.

## 3. 중간

### M-1 실행 중 권한 확인(N-11): 기록, 거부 표현, 질문을 만드는 주체, 시점이 문서마다 다르다

| 항목 | AC | GT |
| --- | --- | --- |
| 기록 | 새 사건 `confirmation_requested`·`confirmation_answered { by: user/default/cancelled }` (`adapter-contract.md:265-269`) | `tool_decision`에 단계 `confirm`을 더함 (`general-tasks.md:316`) |
| 물을 수 없을 때 | 거부, `by: "default"` (`:255`, `:268`) | 거부, 코드 `confirmation_unavailable` (`:315`) |
| 질문을 만드는 주체 | 사용자 설정·프로필의 "확인 후 허용"만. "task 파일이 질문을 만들 수 없다" (`:254`) | 명령 규칙의 `confirm: true`, 나중의 네트워크 도구 (`:313`) |
| 구현 시점 | "단계 4에 구현" (`:223`), 이행 7 "단계 4 P4-G 결정 뒤" (`:329`). VX도 "이행 7(단계 4)" (`vscode-extension.md:197`) | "P5-A와 함께(단계 5 시작)" (`:319`, `:462`) |
| 답 뒤 재판정 | "답 뒤에도 같은 검사"(2차 판정 `engine/index.ts:456` 포함으로 읽힘, `:257`) | 2차 판정 뒤·실행 전 훅. 재판정 언급 없음 (`:312`) |

- 주체 충돌의 근거: 명령 규칙은 task 파일에도 있다. task 형식은 자기 `policy`를 쓴다(`src/contracts/config.ts:32`). 그래서 GT대로면 task 파일이 질문을 만들 수 있고, AC 의미 1과 어긋난다.
- 재판정: 사람을 기다리는 동안(초~분) 작업 공간이 바뀔 수 있다. 예를 들어 남은 자손 프로세스가 링크를 바꿀 수 있다(알려진 한계). 지금은 `checkEffective`(`engine/index.ts:456`)와 실행(`:469`) 사이가 즉시다. 답을 받은 뒤 `checkEffective`를 다시 하도록 명시하길 권한다.
- 시점: G-A가 GT 9절의 P5 항목(`policy.ts`의 `ask`, `EngineDeps.confirm?`)을 넣기 전에 한 형태로 정해야 한다.

### M-2 적용·계획 보기·사람 확인이 어댑터 계약과 두 어댑터에 없다. 워크플로 선택도 없다

- 함수
  - AC의 `CodarynApp`(`adapter-contract.md:138-141`, `:193-212`)에는 `startRun`, `report`, `listRuns`, `revert`, 점검·모델만 있다.
  - GT가 기대하는 `applyPlan`(`general-tasks.md:278`), `plan` 보기(`:240`), `review`(`:333`)가 없다.
- 결과 형식
  - AC `:190`: "결과는 EngineResult 그대로. 어댑터마다 다른 결과 형식을 만들지 않는다"
  - GT `:349`: `ApplyResult`(`kind: "apply"`), `EngineResult.review`. 두 문장이 맞지 않는다.
- 이벤트·취소
  - `--events jsonl`과 `--cancel-file`은 `run`에만 정의돼 있다(`adapter-contract.md:293-295`).
  - 적용은 파일을 옮기는 새 실행이고 취소 대상이다(`general-tasks.md:428`). 그런데 VS Code(B안)와 GUI가 적용의 진행·취소를 받을 통로가 없다.
- 화면
  - VS Code 명령 표(`vscode-extension.md:76-86`), GUI 동작 표(`standalone-gui.md:315-331`), GUI 결과 탭(`:172-179`)에 계획·적용·사람 확인이 없다.
  - GT `:336`은 "GUI는 결과 화면에 확인 목록과 승인·반려 단추"를 기대한다.
- 워크플로 선택
  - `StartRunRequest`(`adapter-contract.md:104-116`)에 `workflowRef`나 `--workflow`가 없다. GT-D1·D2와 간편 형식 `--workflow`(`general-tasks.md:119`)가 채택됐다.
  - GUI는 이 빈칸을 스스로 적었다(`standalone-gui.md:123`). VS Code "새 작업"은 프로필만 고른다(`vscode-extension.md:78`).

### M-3 앱 환경 사본(AC 4절)이 지금 동작을 바꾼다

AC는 `AppEnvironment.env`를 보통 객체 사본으로 두고(`adapter-contract.md:83`, `:96`) 이행 2에서 "stdout 바이트 동일"을 완료 기준으로 둔다(`:324`). 그런데 다음 두 가지가 바뀐다.

1. **Windows의 이름 대소문자**
   - `process.env`는 Windows에서 이름의 대소문자를 무시하고, 보통 객체 사본은 구분한다.
   - 재현(빌드본, scratchpad 사본)
     - 체험 예시 task의 `privacy.secretEnv`를 `["codaryn_r1_probe"]`로 바꾼다.
     - 환경 변수 `CODARYN_R1_PROBE=<가짜 값>`으로 `run`하면 지금은 `done`(종료 0)이다.
     - 같은 조회를 `{...process.env}` 사본에서 하면 값이 없다. 사본으로 옮기면 `secret_env_missing`(종료 2)이 된다.
     - `process.env.path`는 있고 사본의 `path`는 없다는 것도 확인했다.
   - 현재 코드는 S-4에서 이름을 접어 비교한다(`src/cli/security/env.ts:51`). 다른 조회(`src/cli/run.ts:337`)는 `process.env`의 성질에 기댄다.
2. **명령 실행기의 자식 환경**
   - 실행기는 `parentEnv`가 없으면 `process.env`를 쓴다(`src/tools/command-runner.ts:263`). 조립은 넘기지 않는다(`src/cli/assemble.ts:145`).
   - 지금 CLI는 변수 파일을 `process.env`에 적재하므로(`src/cli/main.ts:129`) 허용 목록 변수(`PATH`, `TEMP` 등)가 자식 명령에 그 값으로 간다.
   - 사본 환경으로 옮기면 그 값이 자식에 가지 않는다. 같은 프로세스 어댑터(GUI 엔진 호스트)에서는 자식 환경이 `AppEnvironment.env`가 아니라 호스트의 `process.env`에서 온다.
- A-1이 지금 `src/app`을 만들고 있으므로 다음을 계약에 넣길 권한다.
  - 대소문자를 무시하는 환경 조회 함수
  - 실행기의 `parentEnv`를 `AppEnvironment.env`에서 넘김

### M-4 `plan.json`의 정책·검증기 사본이 작업 공간 안에서 다음 실행(적용)을 정한다

- GT는 `plan.json`(`.codaryn/runs/<runId>/`, 작업 공간 안)에 "해석된 정책·검증기 사본"을 저장한다(`general-tasks.md:255`).
- 적용은 정책만 "지금 설정 기준으로 다시 판정"한다(`:264`). "사용자 검증기도 이어서 실행한다"(`:271`)는 출처를 밝히지 않아 사본으로 읽힌다.
- S-1의 목적과 충돌한다. S-1은 "작업 공간 안 파일이 다음 실행의 정책·검증기를 바꾸지 못하게"(사용 안내 5절)다.
- 상태 디렉터리는 파일 도구에만 닫혀 있다. 허용된 명령은 바꿀 수 있다(cli-contract 15절 report 한계).
  - `organize`는 명령을 금지한다(GT-D10).
  - 하지만 `plan: "apply"`는 사용자 정의 워크플로에도 쓸 수 있고, 명령 금지 상한은 `organize`에만 있다(`:97`, `:129-130`).
- 승인 화면도 원본이 아니다.
  - `codaryn plan`은 기록(가림본)의 행동 목록을 보여 주고, 기록과 `plan.json`의 다이제스트가 같은지만 본다(`:258`).
  - 계획 실행 중 명령이 둘을 함께 바꾸면 사람은 바뀐 목록을 승인한다.
  - 다이제스트가 덮는 검증기 사본은 화면에 나오지 않는다.
- 권고
  - `plan.json`에는 행동과 원본 해시만 둔다.
  - 적용의 정책·검증기는 지금의 사용자 설정·task에서 읽는다.
  - `codaryn plan`은 `plan.json`을 다시 가려 보여 준다.

### M-5 `organize`의 필수 검증기 `inventory`가 큰 폴더에서는 늘 판단 불가다

- GT는 `inventory`가 무결성 목록(`"."` 항목)을 다시 쓴다고 했다(`general-tasks.md:268`). 이 검증기는 끌 수 없다(`:162`).
- 목록에는 상한이 있다: 파일 `MAX_INTEGRITY_FILES` 10,000개, `MAX_INTEGRITY_BYTES` 256 MiB(`src/contracts/integrity.ts:17`, `:20`). 도달하면 나열 중이던 항목 전체가 `unchecked`/`limit` 하나가 된다(`:63-66`).
- 재현(빌드본 `createIntegrityChecker`, scratchpad의 빈 파일 10,001개, `protectedPaths: ["."]`)
  - 항목 1개 `{ path: ".", kind: "unchecked", why: "limit" }`
  - `compare(m, m)`은 1건
  - 즉 사전 점검의 기준 목록이 생기지 않고, 적용 뒤 비교는 늘 `inconclusive`다.
- 사진·영상 폴더(GT 질문 3의 바이너리 이동)는 256 MiB를 쉽게 넘는다. GT 5절 표와 13절 미정에 이 한계가 없다.
- 권고: `inventory`는 내용 해시 대신 계획 대상 경로의 해시와 나머지 경로·크기 목록을 쓰거나 별도 상한을 둔다. 상한에 닿으면 적용 전에 알린다.

### M-6 변경 비교의 원문 노출: VX-D6(원문, 채택)과 GUI-D6(가림본만)이 반대다

- VS Code는 작업 공간 파일과 스냅샷 원문을 비교 편집기로 연다(`vscode-extension.md:101`, `:234`). 채택됐다(`phase-4-5-design.md:66`).
- GUI는 원문 비교를 화면 노출 때문에 버리고, 다시 가린 비교만 둔다(`standalone-gui.md:538`, `:455`).
- 스냅샷은 등록 비밀이 그대로인 평문이다(R-8).
  - VS Code에서 문서로 열면 열린 문서를 읽는 다른 확장(언어 서버, AI 보조 등)이 그 내용을 받을 수 있다 [추정, VS Code API 미확인].
  - 일부는 외부로 보낼 수 있다 [추정].
- 확장이 스냅샷을 열려면 `.codaryn/runs/<id>/snapshots/`의 저장 형식을 직접 알아야 한다. 이를 내주는 CLI 명령이 없다.
  - "확장 코어는 인자·줄 해석·상태만"(`vscode-extension.md:60`)과 B안(CLI만 부름)의 경계를 넘는다.
- 권고: 두 어댑터를 한 규칙(GUI-D6 (a))으로 맞추고, 비교 내용을 내주는 CLI·앱 함수를 둔다.

### M-7 단일 프로세스 조건: 채택된 AC-D11 문장과 GUI-D3 엔진 호스트가 맞지 않는다

- PM은 AC-D11의 조건 "듣는 소켓 없음, 상주 없음, 실행 하나에 자식 하나"를 architecture 1절에 적기로 했다(`phase-4-5-design.md:65`). 이 문서는 D3(w3:pB)가 지금 맞추고 있다.
- GUI 권고(GUI-D2·D3)의 엔진 호스트는 앱이 켜질 때 하나 만들어 앱 수명 동안 모든 실행을 맡는다(`standalone-gui.md:311`, `:534-535`). "실행 하나에 자식 하나"가 아니다.
- VS Code는 같은 모양(상주 자식, C안)을 "데몬 없음과 충돌"로 버렸다(`vscode-extension.md:33`).
- GUI 결정은 보류지만, architecture 문장이 먼저 확정되면 권고안이 원칙 위반이 된다. D3에 GUI-D2 (b)의 문장(앱보다 오래 살지 않음)을 함께 적게 하길 권한다.

### M-8 폐기 보관함이 실행 기록 정리와 함께 지워진다

- GT는 폐기를 `.codaryn/runs/<적용 runId>/discarded/`로 옮기고, 실행 디렉터리를 지울 때 실제로 지운다고 했다(`general-tasks.md:207-209`).
- 그런데 실행 기록을 지우는 동선이 여러 곳에 있고, 모두 "기록·스냅샷 정리"로 설명된다.
  - GUI 홈의 "실행 기록 정리"(`standalone-gui.md:195`)
  - 사용 안내 11절 "폴더째 지운다"
  - 검토 R-16의 `runs --prune` 후보
- 사람은 기록을 지운다고 생각하지만 실제로는 자기 파일(폐기한 원본)이 영구 삭제된다. GT-D5의 "되돌릴 수 있다"는 전제가 그 동선에서 깨진다.
- 권고: 보관함을 실행 디렉터리 밖(예: `.codaryn/discarded/<runId>/`)에 두거나, 정리 동선이 보관함의 파일 수와 크기를 따로 묻게 한다.

## 4. 낮음

### L-1 이벤트가 가림본이라는 전제의 빈틈: 도구 이름과 호출 id는 가리지 않는다

- 모델이 준 도구 호출의 `name`과 `id`는 가리지 않고 기록된다.
  - `src/engine/index.ts:403-412`: 모르는 도구의 `tool: call.name`, `callId: call.id`
  - `:573`: `model_response.toolCalls[].id/name`
  - 형은 `MaskedText`가 아닌 `string`이다(`src/contracts/journal.ts:65-66`, `src/contracts/model.ts:11-15`). journal 머리 주석 "Free text fields are MaskedText"(`journal.ts:3`)와 다르다.
  - 제공자는 비어 있지 않은지만 본다(`src/model/anthropic/index.ts:453-454`).
- 지금 CLI 진행 줄은 이를 막는다(`src/cli/progress.ts:3-5`, `:18-20`, `:71`). 모르는 도구는 `(unknown tool)`로 쓰고 줄 전체를 다시 가린다.
- AC는 레코드를 그대로 이벤트로 보낸다(`adapter-contract.md:153-154`, `:175`). 제어 문자 정리만 어댑터 몫으로 둔다(`:171`). 그래서 `--events jsonl`과 GUI 화면에서는 이 방어가 빠진다.
- 모델은 보통 비밀을 토큰으로만 보므로 실제 위험은 낮다(심층 방어 문제).
- 권고: 앱 계층이 이벤트를 내기 전에 다시 가린다. 모르는 도구 이름은 진행 줄처럼 바꾼다. 또는 기록할 때 가린다(역할 1의 계약 변경).

### L-2 취소 의미가 어댑터마다 다르다

- 사전 검사 중 취소
  - CLI: 처리기가 없어 Node 기본 동작으로 끝나고 JSON이 없다(`adapter-contract.md:52`, AC-D12).
  - VS Code: 취소 파일이 이미 있으면 감시를 시작하자마자 취소된다(`src/cli/cancel.ts:30-33`의 즉시 `check()`). 그래서 실행 기록이 생기고 `cancelled`(5)로 끝난다.
  - GUI: 단추를 비활성화한다(`standalone-gui.md:154`).
  - 셋이 다르다.
- 질문을 기다리는 중 창 닫기
  - VS Code(`vscode-extension.md:118`): stdin이 닫혀 EOF가 되고 그 질문은 `by: "default"` 거부다(`adapter-contract.md:305`). 거부는 실행을 끝내지 않으므로, 취소 파일 감시(최대 100ms)가 잡을 때까지 실행이 이어진다. 그 뒤 `cancelled`다.
  - GUI(`standalone-gui.md:337`): `by: "cancelled"`다.
  - 같은 사람 행동인데 기록이 다르다.
- VS Code 표의 "대화상자를 닫음 → `by: "default"`"(`vscode-extension.md:115`)는 답 줄 형식(`adapter-contract.md:305`, `by` 없음)으로 표현할 수 없다. 거부 답을 보내면 CLI는 사람이 답한 것으로 기록할 수밖에 없다.

### L-3 GUI 종료가 `done`이 아니라 `run_finished`를 기다린다

- `standalone-gui.md:168`은 취소 뒤 `run_finished`를 기다리고 닫는다.
- AC는 끝을 `done`으로 알라고 한다(`adapter-contract.md:131`, `:169`). `done`은 result.json 저장과 잠금 해제 뒤에 풀린다.
- `run_finished` 직후 닫으면 result.json이 없을 수 있다(`src/cli/assemble.ts:176-182`의 `finish`가 그 뒤에 돈다).

### L-4 VS Code B안의 근거 하나가 문서 자신과 맞지 않는다. 자식 환경을 그대로 넘긴다

- `vscode-extension.md:39`는 "키와 변수 파일 값이 다른 확장과 같은 프로세스에 들어가지 않는다"라고 한다.
- 그런데 같은 문서가 자식이 확장 호스트의 환경을 그대로 물려받아 키를 얻는다고 한다(`:65`, `:132`). 키(`ANTHROPIC_API_KEY`)는 이미 확장 호스트의 환경에 있다.
- B안이 실제로 분리하는 것은 변수 파일 값, 전역 `fetch`, 신호 처리기다. 근거를 그렇게 고치길 권한다.
- 자식 환경을 그대로 넘기면 `NODE_OPTIONS` 등도 자식 Node에 적용된다. GUI는 이를 위험으로 본다(`standalone-gui.md:267`, E-4). 자식에서 빼길 권한다.

### L-5 GUI 새 작업 화면에 "작업 공간의 내용이 API로 간다" 고지가 없다

- 대상 사용자는 터미널·환경 변수에 익숙하지 않다(`standalone-gui.md:41`).
- 읽기 도구는 등록하지 않은 개인정보와 다른 앱의 자격 증명 파일도 그대로 보낸다. 가림은 등록 값만이다.
- 홈 폴더 거부는 N-1 기본 설정 위치가 그 안에 있을 때의 부수 효과에만 기댄다(`:121`). 다른 드라이브 루트나 "문서" 폴더는 막지도 알리지도 않는다.
- 권고: GT-D8처럼 고지 문구를 넣고, 넓은 루트를 경고한다. P1 `unreadablePaths`와 연결한다.

### L-6 `inspect_files`가 해시 노출 범위를 넓힌다

- `general-tasks.md:202-205`의 `inspect_files`는 모든 파일(바이너리 포함)의 크기, 수정 시각, 선택적 SHA-256을 모델에 묶어서 준다.
- 알려진 한계 "파일 해시 노출"(짧은 비밀 추측 검증)은 지금 `read_file` 대상 텍스트에만 해당한다. 이 도구는 그 범위를 넓힌다.
- GT 12절의 privacy.md 맞출 점에 이것을 더하길 권한다.

### L-7 적용(apply) 취소의 끝 상태가 정의되지 않았다

- GT 12절은 "취소 신호를 적용기에도 같은 의미로, 항목 사이에서 멈추고 기록"이라고만 한다(`general-tasks.md:428`).
- 적용의 상태·이유(`:265`, `:349`)에는 취소가 없다. `cancelled`/`cancelled`와 부분 이동 목록, `revert` 안내를 명시하길 권한다.

## 5. 정보

- **I-1** GT의 "`document`·`code` 이름표를 쓰는 22개 파일"(`general-tasks.md:123`, `:439`)
  - 지금은 23개다. `examples/demo/task.json`(N-D, `aa1b59e`)이 더해졌다.
  - 회귀 기준 목록에 넣으면 된다. 오류는 아니다.
- **I-2** GUI 경로 입력
  - `standalone-gui.md:106`은 작업 공간 입력란에 경로 문자열을 보인다.
  - 9.2절 3은 "화면은 경로 문자열을 넘기지 못하고 경로 핸들만"이다(`:437`).
  - 직접 입력을 허용한다면 메인이 핸들로 바꾸는 단계를 적어야 한다.
- **I-3** 다이제스트 앞 12자(48비트) 승인(`general-tasks.md:241`)
  - 실수로 다른 계획을 승인하는 것을 막기에는 충분하다.
  - 작업 공간에 쓸 수 있는 공격자에게는 의미가 없다(M-4). 위협 모델을 한 줄 적으면 된다.
- **I-4** GUI 3.7 상태 표현(`standalone-gui.md:210-217`)
  - `plan_pending`, `awaiting_review`가 없다. GT 12절이 ux-design 6절에 더하라고 했으므로 D3와 함께 맞추면 된다.
- **I-5** 코드 근거 대조(문제 없던 범위). 아래는 모두 지금 코드와 줄까지 맞았다.
  - AC
    - `contracts/engine.ts:78-84`, `:86-117`, `:151-177`, `:179-187`, `:223-252`
    - `engine/index.ts:26-65`, `:165`, `:198-202`, `:431-457`, `:456`, `:468-469`, `:518-522`, `:781`
    - `cli/run.ts:6-16`, `:62-99`, `:106-112`, `:118-137`, `:172`, `:294-305`, `:375`, `:376`, `:380-401`
    - `cli/assemble.ts:95-124`, `:126-188`, `:176-182`
    - `cli/main.ts:68`, `:101`, `:129`, `:137-148`, `:153-155`
    - `cli/progress.ts:65-81`, `cli/cancel.ts:20-45`
    - `contracts/journal.ts:31-124`, `:120-122`, `store/index.ts:35-39`
    - `cli/report.ts:178`, `:262`, `:347`, `:464`, `cli/revert.ts:34`
    - `cli/guard.ts:26-29`, `:41-47`, `cli/text-safety.ts:25`
    - `contracts/commands.ts:62-71`, `:117-126`, `contracts/task.ts:72-75`
  - VX
    - `model/anthropic/index.ts:709`, `cli/run.ts:86-87`
    - `package.json:8-10`, `cli/doctor.ts:59`, `cli/install.ts:30-48`
  - GT
    - `contracts/task.ts:21-22`, `contracts/config.ts:32`, `:94-96`, `:104-115`, `contracts/policy.ts:27-30`
    - `contracts/tool.ts:9-10`, `:33-45`, `:77-88`, `:359-360`, `contracts/model.ts:29-30`
    - `engine/index.ts:86-94`, `:161-163`, `:403-414`, `:416`, `:518-531`, `:533`, `:547`, `:554`, `:639-643`, `:658-669`, `:704-710`
    - `engine/validate-args.ts:42-43`, `tools/index.ts:416-425`, `model/anthropic/index.ts:382-388`
    - `policy/index.ts:49-53`, `:100-114`, `:125-131`, `cli/task.ts:196-197`, `:293-325`, `:403-416`
    - `verify/index.ts:311-334`, `workspace/workspace.ts:115-134`
    - `contracts/changes.ts:57`, `:96-101`, `contracts/integrity.ts:57-68`, `contracts/engine.ts:127-131`
    - `tests/integration/a05-permissions.test.ts:74`, `:115`
- **I-6** VS Code가 보고서를 Markdown 문서로 여는 것(`vscode-extension.md:82`)
  - `renderReport`는 기록에서 온 글을 모두 인라인 코드나 코드 블록에 넣는다(`src/cli/report.ts:350-437`). 그래서 Markdown 주입(원격 이미지 등)은 지금 막혀 있다.
  - 이 성질을 바꾸지 말라는 한 줄을 보고서 계약에 남기길 권한다.

## 6. 재현 방법 요약

모두 키 없이 했다. 빌드본 `dist/`와 세션 scratchpad만 썼다.

- M-3
  - `examples/demo`를 scratchpad로 복사하고 task의 `privacy.secretEnv`를 소문자 이름으로 바꾼다.
  - `CODARYN_R1_PROBE=<가짜 값> node dist/src/cli/main.js run --task <사본>/task.json --quiet` → `done`, 종료 0.
  - `node -e "const c={...process.env}; ..."`로 사본 조회가 없음을 확인했다.
- M-5: `dist/src/workspace/index.js`의 `createWorkspace`, `dist/src/verify/index.js`의 `createIntegrityChecker`로 빈 파일 10,001개 폴더를 `protectedPaths: ["."]`로 `capture()`한다. 결과는 항목 1개 `unchecked`/`limit`, `compare(m, m)` 1건.
- 나머지는 문서와 코드를 읽어 대조했다. L-2의 VS Code 쪽 동작(EOF와 취소 파일 사이 시간)은 아직 없는 기능이라 코드 근거(`cancel.ts`)와 문서로 추론했다 [추정].

## 7. 검사하지 않은 범위

- VS Code API, Electron, Tauri 등 외부 제품 사실(네트워크 금지). 문서도 [추정]으로 둔 부분이다.
- N-A·N-B·N-C 브랜치의 미병합 내용. main에 없는 기본 설정 위치(N-1), `runs`, `--dry-run` 구현은 보지 않았다.
- privacy.md, ux-design.md, architecture.md 전체와의 대조. 네 문서가 인용한 곳만 봤다.
- 실제 API, macOS·Linux, Windows에서 부모가 보낸 SIGINT의 실제 동작.

## 8. PM 판단 필요

- **P-1(H-1)**: 계획 승인을 실행 사이 확인(GT-D4) 하나로 정할지
  - 권고: AC 5.7에서 `plan`을 빼고 `CodarynApp`에 `plan`·`applyPlan`을 더한다.
  - G-A와 A-1에 바로 알려야 한다.
- **P-2(M-1)**: 권한 확인의 기록 형식, 거부 표현, 질문을 만드는 주체, 구현 단계를 한 표로 정할지. 답 뒤 `checkEffective` 재실행을 넣을지.
- **P-3(M-3)**: A-1의 `AppEnvironment`에 대소문자 무시 조회와 실행기 `parentEnv` 전달을 넣을지.
- **P-4(M-6)**: 변경 비교를 두 어댑터 모두 GUI-D6 (a)로 맞출지. VX-D6 채택을 다시 볼지.
- **P-5(M-7)**: D3가 architecture 1절에 쓸 단일 프로세스 문장에 GUI-D2 (b)를 포함할지.

사용자에게 물을 질문은 없다.

## 9. 실행한 것

- 문서 읽기: 네 설계 문서 전체, 작업 지시서 `phase-4-5-design.md`
- 코드 대조: I-5의 줄
- 빌드: `npm run build`(dist는 Git 무시)
- 재현 실행: M-3, M-5. 저장소 파일 변경 없음, 커밋 없음. 실제 API 미실행.
