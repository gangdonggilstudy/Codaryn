# Codaryn 아키텍처

상태: 2026-11-12, main `1d23dda` 기준.
- 단계 0 설계(같은 날 Codex 채택)를 바탕으로 단계 1a, 1b(모의 API까지), 2, 3의 오프라인 기구와 `codaryn models`가 구현·병합됐다.
- 사용성 개선(N-1~N-22)은 구현이 진행 중이다.
  - 사용성 계약(N-A)이 main에 있다.
  - 문구 카탈로그 `src/i18n`(N-B)과 사람용 출력·실행 목록·되돌리기 미리보기 모듈(N-C)이 유닛 시험과 함께 main에 있다.
  - CLI 명령 연결(N-A)은 아직이다. 그래서 `runs`, `revert --dry-run`, `init`, `--profile`, 사람용 stderr 출력은 CLI에서 쓸 수 없다.
- 단계 4·5 설계(어댑터 계약, VS Code 확장, 범용 작업 워크플로, 독립 GUI)는 PM이 채택했고 구현은 착수 단계다(코드 없음). 설계 교차 검토 R-1 뒤의 결정 DR-1~DR-9가 앞의 채택보다 우선한다([단계 4·5 설계 지시](work-orders/phase-4-5-design.md) "설계 교차 검토 뒤 결정").
- **실제 Anthropic API는 한 번도 호출하지 않았다**(`tests/live` 미실행). 모든 검증은 대본 모델, 가짜 HTTP 서버, 실제 CLI 프로세스로 한 오프라인 검증이다.
- 이 문서는 구조를 설명한다. 각 기능의 파일, 결정 번호, 시험은 [구현 위치표](design/implementation-map.md)에 있다. 단계 4·5 설계의 세부는 [설계 문서 색인](design/README.md)의 문서들이 기준이다.

표기:
- 성격: **[확정]** 사용자 확정 요구, **[선택]** 관리자(Codex, 위임 기간에는 임시 PM)의 설계 선택, **[미정]** 결정 전.
- 상태
  - **구현**: 코드와 시험이 있다.
  - **결정만**: 작업 지시서에 결정이 있거나 PM이 설계 문서를 채택했지만 코드가 없다.
  - **설계만**: 설계 문서의 권고뿐이고 PM이 채택하지 않았다.
- 근거: [decisions.md](decisions.md). 결정 번호(C-, R-, S-, T-, N-, AC-D, VX-D, GT-D, DR- 등)의 원문은 `docs/work-orders/`와 각 설계 문서의 결정 표다. "AC 5.7"은 [어댑터 계약](design/adapter-contract.md) 5.7절이다.

## 1. 목표와 설계 원칙

- [확정] 코딩 외에 문서 작성, 자료 분석, 파일 정리도 하는 범용 로컬 작업 에이전트다. CLI부터 만들고 Anthropic API를 먼저 연결한다. 코딩과 자기 소스 개발이 첫 작업 유형이다.
- [선택] TypeScript(엄격 검사, ESM), 단일 패키지, 단일 프로세스. 실행 의존성은 없다(개발 의존성 `typescript`, `@types/node`만). 서버, 큐, 데몬, 플러그인 런타임, 다중 에이전트는 없다. **구현**
  - **단일 프로세스 원칙의 조건은 "듣는 소켓 없음, 어댑터보다 오래 사는 프로세스 없음"이다**(DR-8. AC-D11의 조건 문장을 대신한다). **결정만**
    - 듣는 소켓에는 로컬 웹 서버(N-13)도 든다.
    - 프로세스 밖 어댑터(VS Code 확장)는 실행마다 CLI 자식 하나를 표준 입출력으로 부른다([어댑터 계약](design/adapter-contract.md) 6절).
    - 명령과 검증기를 자식 프로세스로 실행하는 것은 지금과 같다(7절).
    - 앱 수명 동안만 사는 엔진 전용 프로세스(독립 GUI 권고안, [독립 GUI](design/standalone-gui.md) 5.1절)는 이 조건 안의 후보다. 채택 여부는 GUI 형태를 확정할 때 정한다. **설계만**
  - 단일 패키지의 예외(VX-D3). **결정만**
    - VS Code 확장은 같은 저장소의 `vscode/`에 별도 매니페스트로 둔다. 루트 `package.json`은 바꾸지 않는다.
    - 독립 GUI의 배치(`gui/`)는 권고만 있다(GUI-D5). **설계만**
- [선택] 엔진은 하나다. CLI·VS Code 확장·독립 GUI는 엔진을 부르는 어댑터이며 작업 논리를 갖지 않는다(M-2). **CLI만 구현**
  - 어댑터가 함께 쓰는 실행 준비(입력 해석, 실행 전 보안 검사, 조립, 실행 수명)를 `src/cli`에서 새 앱 계층 `src/app`으로 옮긴다(AC-D1, 어댑터 계약 7절의 이행 1~7). **결정만**(A-1 배정)
  - VS Code 확장은 실행마다 CLI 자식과 줄 프로토콜로 엔진을 부른다(VX-D1). **결정만**
  - 독립 GUI의 형태는 단계 4 뒤에 정한다(N-13). 설계 기준은 Electron과 엔진 전용 프로세스다(GUI-D1, GUI-D3). 구현은 사용자 확인(Q-7)과 외부 사실 확인 뒤에 연다. **설계만**
- [선택] 공통 엔진은 Git이나 코드 테스트를 전제로 하지 않는다. Git은 후보 준비 스크립트(엔진 밖)만 쓴다. **구현**
- [선택] 테스트 통과는 "그 검증기가 확인한 범위에서 통과"만 뜻한다. 보안이나 정확성 전체를 보장한다고 쓰지 않는다.

## 2. 모듈

`src/` 아래 열한 개 모듈(`i18n` 포함)이 구현돼 있다. 설계가 채택된 세 모듈(`app`, `workflows`, `tabular`)이 더해질 예정이다. 다른 모듈은 각 모듈의 `index.ts` 공개 export로만 쓴다.

| 모듈 | 책임 | 알지 못해야 하는 것 | 상태 |
| --- | --- | --- | --- |
| `contracts` | 모듈 사이의 타입·상수·한도(계약). 역할 1(계약 담당)만 바꾼다 | 구현 | 구현 |
| `cli` | 인자 해석, 설정·task 해석, 실행 전 보안 검사(`cli/security`), 조립(`assemble.ts`), 명령(run, revert, report, doctor, models, help/version), 진행 표시, 취소 신호 | 모델 형식, 도구 내부 | 구현. 실행 전 검사와 조립은 `app`으로 옮길 예정(결정만). 사람용 출력 `cli/human`과 실행 목록 `cli/runs.ts`(N-5~N-7, N-16)는 모듈과 유닛 시험만 있고 명령 연결 전. `init`(N-2)은 계약만 |
| `engine` | 상태 기계, 모델↔도구 반복, 한도, 가림 적용 순서, 검증 회차, 재수정 판단, 무결성 점검 시점 | 파일 시스템, Git, 테스트 러너, Anthropic 형식 | 구현 |
| `model` | 제공자 중립 `complete` 인터페이스. `anthropic`(내장 `fetch`)과 `scripted`(대본) | 파일 시스템, 정책 | 구현 |
| `tools` | 내장 도구 네 개(`read_file`, `search_files`, `write_file`, `run_command`)와 명령 실행기 | 모델 제공자 | 구현 |
| `policy` | 호출 허용·거부 판정(경로, 명령, 네트워크, 파괴적 동작), 보호 경로 | 모델 출력의 의도 | 구현 |
| `privacy` | 가림(치환), 토큰 검증, 필드 단위 복원, 원위치 문서 재구성. 실행 단위 메모리 대응표 | 작업 유형 | 구현 |
| `verify` | 검증기(`command`, `file_rules`) 실행, 무결성 목록(`integrity.ts`) | 수정 방법 | 구현 |
| `store` | journal(가림본 기록), result.json, 작업 공간 잠금(`lock.ts`), 스냅샷과 되돌리기(`changes.ts`) | 모델 제공자 | 구현 |
| `workspace` | 허용 루트 안의 경로 해석(링크·8.3 이름 해석), 텍스트 읽기, 원자적 쓰기, 목록 | 정책 판단 | 구현 |
| `app` | 어댑터 공통 계층: 입력 해석과 실행 전 보안 검사, 조립, 실행 수명(이벤트 전달, 취소, 확인 질문 중계, 결과 저장, 잠금 해제), report·revert·runs·doctor·models 함수([어댑터 계약](design/adapter-contract.md) 3~5절) | 어댑터의 화면과 인자 형식, 프로세스 전역(`process.env`, 신호, stdout) | 결정만(AC-D1) |
| `i18n` | 사람용 고정 문구 카탈로그(ko, en)와 언어 선택(N-4) | CLI 모듈(어댑터들이 함께 쓴다), 파일·환경의 값 | 구현(유닛 `tests/unit/i18n`). CLI 연결 전. N-20, N-21의 문구 추가는 결정만 |
| `workflows` | 내장 워크플로 정의(`general`, `code`, `document`, `analyze`, `organize`). 로직 없는 데이터 상수([범용 작업](design/general-tasks.md) 4절) | 실행 논리 | 결정만(GT-D12) |
| `tabular` | 표(CSV, TSV, JSON Lines) 해석과 집계. 순수 함수. `query_table` 도구와 `data_checks` 검증기가 함께 쓴다 | 파일 시스템, 모델 | 결정만(GT-D12, P1) |

- 의존 방향
  - 지금: `cli/assemble.ts`가 모듈을 만들어 `EngineDeps`로 엔진에 넣는다. 엔진은 `contracts`만 import한다. **구현**
  - 이행 뒤: `cli` → `app` → (`engine`, `store`, `tools`, `policy`, `privacy`, `verify`, `workspace`, `model`) → `contracts`. 엔진은 계속 `contracts`만 import한다. **결정만**
  - `src` 밖의 어댑터: `vscode/`(VX-D3)는 결정만, `gui/`(GUI-D5)는 설계만이다. VS Code 확장 코어는 엔진·정책·가림을 import하지 않는다.
- 작업 유형(워크플로)
  - 지금: task의 `workflow`는 자유 문자열 이름표다. 엔진은 기록만 하고 분기하지 않는다. 작업 유형은 검증기·정책 설정으로만 구분한다. **구현**
  - 단계 4: 워크플로 정의(도구 묶음, 지시문, 계획 방식, 완료 방식, 기본값과 상한)를 내장(`src/workflows`)과 사용자 설정 `workflows`에 두고 task의 `workflowRef`로 고른다(GT-D1, GT-D2). CLI가 정의를 펼쳐 명시적 task 필드로 엔진에 넣는다. 엔진은 워크플로 이름을 모른다. **결정만**

## 3. 공통 계약

단계 0의 다섯 계약은 아래 타입으로 구현됐다(`src/contracts/`).

| 단계 0 계약 | 구현 |
| --- | --- |
| Task | `TaskSpec`·`ResolvedTaskSpec`(task.ts). 목표, `workflow`, 작업 공간, 모델, 정책, 개인정보(`secretEnv`), 한도, 검증기 |
| Tool | `ToolDescriptor`·`BUILTIN_TOOLS`(tool.ts). 표시 등급, 요구 권한, 복원 허용 필드(`restoreFields`), 문서 필드(`documentFields`) |
| Artifact | 별도 타입 없음. 파일 변경 기록 `FileChangeRecord`(경로, 전후 해시, 생성 여부)와 `EngineResult`(result.json)가 대신한다 |
| Verifier | `VerifierConfig`(`command`, `file_rules`), `RawVerifierResult`, `VerifierResult`(verify.ts). 결과는 pass, fail, inconclusive와 근거, 검사한 것, 한계 |
| Policy | `PolicyConfig`(명령 허용 규칙, network, destructive, `restorePathTokens`, `protectedPaths`)와 `PolicyGate`(policy.ts) |

그 밖의 계약:
- `model.ts`: 메시지·응답·사용량, 대본 형식.
- `privacy.ts`, `text.ts`: 가림 게이트, 토큰 형식, `RawText`·`MaskedText` 브랜드.
- `journal.ts`, `changes.ts`, `engine.ts`: 기록 사건, 스냅샷, 결과, 종료 코드.
- `config.ts`: 설정 파일. `integrity.ts`: 무결성. `commands.ts`: report, doctor, models.

채택된 계약 추가(코드 없음, **결정만**). 계약은 역할 1만 바꾼다(`src/contracts/**`).
- 어댑터 계약(`app.ts` 신규 제안)
  - 타입: `AppEnvironment`, `StartRunRequest`, `RunHandle`, `RunEvent`, `RunObserver`, `AppError`.
  - `Journal.append`가 저장한 레코드를 돌려준다(AC-D3).
  - 확인 질문 기록 `confirmation_requested`, `confirmation_answered`를 더한다. 확인 질문 `ConfirmRequest`는 권한 확인 전용이다(DR-1, DR-3).
  - R-1 뒤 더할 것(DR. 어댑터 계약 문서는 아직 이대로 고쳐지지 않았다)
    - 실행 요청의 워크플로 선택 `workflowRef`(DR-2).
    - 앱 계층의 계획 보기, `applyPlan(runId, digest)`, 사람 확인 `review`(DR-1). 적용도 이벤트와 취소 통로를 갖는다(DR-2).
    - 대소문자를 무시하는 환경 조회. 명령 실행기의 부모 환경은 앱 환경에서 넘긴다(DR-4).
    - 다시 가린 변경 비교를 내주는 함수(DR-7).
  - 출처: [어댑터 계약](design/adapter-contract.md) 4·5절, 이행 1.
- 범용 작업 계약([범용 작업](design/general-tasks.md) 9절, G-A 배정)
  - task·설정: `workflowRef`, 펼친 `tools`·`instructions`·`plan`·`completion`, 정책 `planActions`, 설정 `workflows`.
  - 도구: `propose_plan`, `inspect_files`.
  - 결과 이유: `plan_pending`·`awaiting_review`(`needs-input`), `plan_stale`·`apply_incomplete`(`failed`). 적용 결과 `ApplyResult`.
  - 기록 사건: `plan_proposed`, `plan_rejected`, `plan_approved`, `file_moved`, `file_discarded`.
  - 검증기: `data_checks`, `inventory`. `inventory`는 계획 대상의 해시와 나머지의 경로·크기 목록을 쓰고 자체 상한을 둔다(DR-6).
  - `ask`와 `EngineDeps.confirm`은 G-A에 넣지 않는다. 단계 5 시작에 넣는다(DR-3).
- 사용성 계약(N-A, main `b78d62e`로 병합): 설정 `language`·`profiles`, 기본 설정 위치, 새 명령의 출력 객체(`InitOutput`, `RunsOutput` 등), 문구 계약(`human.ts`). **구현(계약)**. 이를 쓰는 CLI 명령 연결은 아직이다. N-22의 계약 보완은 결정만이다.

표시 등급(`read`, `write-local`, `exec`, `external`)은 보여 주기용이다. 허용 판단은 호출마다 권한별로 따로 한다. **구현**

| 권한 | 검사 |
| --- | --- |
| 경로 | 실효 경로(링크 해석 후)가 허용 루트 안인지, 상태 디렉터리가 아닌지, 쓰기면 보호 경로가 아닌지 |
| 명령 | 실행 파일과 인자가 허용 규칙(실행 파일, 인자 접두사, 추가 인자 허용 여부)에 맞는지, cwd가 루트 안인지 |
| 네트워크 | 네트워크를 쓰는 도구가 없다. 정책값 `network: "deny"`만 받는다. 단계 4에도 네트워크 도구를 두지 않는다(general-tasks 7.1). |
| 파괴적 동작 | **구현**: 삭제·무버전 덮어쓰기 도구가 없다. `write_file`은 `expectedHash`가 맞을 때만 쓴다. **결정만**: 파일 이동과 폐기는 모델 도구가 아니다. 사람이 다이제스트로 승인한 계획을 결정적 적용기가 실행하고, 폐기는 실행 디렉터리 밖 보관함 `.codaryn/discarded/<runId>/`로 옮긴다(GT-D4, GT-D5, DR-9). 영구 삭제는 없다 |

- 판정 값은 지금 허용·거부 둘뿐이다("never ask"). **구현**
- 세 번째 값 `ask`(확인 후 허용)는 결정만 있다(GT-D9, AC-D5, DR-3). 단계 5 시작에 어댑터 확인 질문 통로와 함께 구현한다.
  - `ask`를 낼 수 있는 것은 사용자 설정과 프로필의 규칙뿐이다. task 파일의 규칙은 질문을 만들 수 없다(DR-3, M-9). 나중에 들일 네트워크 도구도 같은 통로를 쓴다.
  - 루트 밖, 상태 디렉터리, 보호 경로, 토큰 복원 거부는 묻지 않고 거부한다.
  - 물을 수 없으면 거부하고 `by: "default"`로 기록한다. 기록은 새 사건 `confirmation_requested`·`confirmation_answered`다(DR-3).
  - 답은 그 호출 한 번에만 쓴다. 답을 받은 뒤 실효 인자 검사(정책 2차 판정)를 다시 한다(DR-3).

## 4. 실행 흐름(`codaryn run`)

### 4.1 실행 전(CLI, `src/cli/run.ts`). 하나라도 실패하면 아무것도 만들지 않고 오류 JSON 한 줄로 끝난다

1. 인자를 해석한다. `--env-file`과 `--env-file-if-exists`는 거부한다(T-15, V-3).
2. 명령줄의 경로가 UNC·장치 경로이면 거부한다(S-5).
3. `--vars-file`을 읽어(BOM이면 거부) 환경에 적재한다. 새로 생긴 값은 비밀 후보로 둔다(S-4). 이미 있는 변수가 이긴다.
4. 현재 키를 확인하고, `CODARYN_CONFIG` 경로를 검사하고, `--goal`에 키가 없는지 본다(S-5, S-8).
5. 설정 파일과 task 파일을 읽는다. 원문 키 검사 → JSON 해석 → 값 키 검사(깊이 64)를 한다(C-1, S-6, T-14).
6. 설정과 task를 해석한다.
   - 한도는 설정 값이 상한이고 코드 절대 상한이 있다(S-7).
   - `protectedPaths` 형식을 검사한다(T-13).
   - 명령 규칙과 검증기의 실행 파일·cwd에 UNC가 없어야 한다(X-1).
7. 작업 공간이 있는지, 실행 중인 CLI 설치 위치와 겹치지 않는지 본다(U-3).
8. 변수·설정·task·대본·취소 파일이 작업 공간 밖인지 실경로로 본다(S-1, T-12).
9. `integrity.paths`가 있고 작업 공간 밖인지 본다(U-1).
10. 비밀을 등록한다: `secretEnv` 값(S-3), 환경의 `ANTHROPIC_API_KEY`(S-2), 변수 파일의 새 값(S-4).
11. 모델 제공자를 만든다. anthropic이면 설정 해석(C-4, C-5, S-9), 대본이면 대본 파일 해석.

### 4.2 조립(`src/cli/assemble.ts`)

- 순서: 작업 공간 → **잠금**(P-4, T-9) → 가림 게이트 → 정책 게이트 → 명령 실행기 하나(도구와 검증기가 공유, T-1) → 변경 기록기(스냅샷, R-6) → 도구 → 검증기 → **journal** → 무결성 검사기.
- 무결성 검사기는 보호 경로나 `integrity.paths`가 있을 때만 만든다(U-1).
- 잠금과 journal은 엔진이 아니라 조립 단계가 연다. 실행이 끝나면 result.json을 쓰고 잠금을 푼다.

### 4.3 엔진(`src/engine/index.ts`)

1. 실행 시간 타이머를 건다. 시스템 문구, 목표, workflow를 가리고 `run_started`를 기록한다.
2. 무결성 기준선을 잡는다(`run_start`). 확인할 수 없는 경로가 있으면 바로 `needs-input`/`protected_changed`로 끝난다(U-1, U-2).
3. 대화 반복: 한도 확인 → `model_request` 기록 → 모델 호출 → 응답을 가려 기록 → 도구 호출마다 아래 순서.
   1. 인자 형식 검사
   2. 정책 1차(토큰이 든 인자 그대로)
   3. 허용된 필드만 복원
   4. 형식 재검사
   5. 정책 2차(실효 인자)
   6. 실행
   7. 결과 가림
   8. `tool_result`(쓰기면 `file_changed`) 기록
4. 모델이 도구 호출 없이 끝나면 검증 회차로 간다.
   1. `before_verify` 무결성 점검
   2. 검증기 실행. 근거는 가린 뒤 자른다(T-6).
   3. 실행 시간·취소 확인(T-8)
   4. `after_verify` 무결성 점검
5. 결과 판정
   - 모두 pass → `done`/`verified`
   - inconclusive가 있으면 재수정하지 않는다 → `needs-input` 또는 `failed`(R-1)
   - fail
     - 재수정 한도(R-2)와 같은 실패 서명(R-3, V-1)을 본다.
     - 남아 있으면 가린 근거로 재수정 메시지를 만들어(R-4) 3으로 돌아간다.
     - 아니면 `failed`(`verifier_failed`/`repeated_failure`)다.
6. 어떤 이유로 끝나든, 마지막 점검 뒤에 모델 턴이나 검증기가 있었으면 무결성을 한 번 더 점검한다(W-1).
   - 바뀌었으면 기록·결과·알림에 남긴다.
   - `done`은 `protected_changed`로 바뀐다. 다른 종료 상태는 유지한다.
   - 계약에 `run_end` 단계가 없어 `before_verify`나 `after_verify` 이름으로 기록한다.
7. `run_finished`를 기록하고 결과를 돌려준다.

- 결과를 모르는 도구 호출(실행기 예외)은 이렇게 다룬다. **구현**
  - 읽기는 한 번 다시 실행한다.
  - 쓰기는 해시를 읽어 적용 여부를 확인한다.
  - 그 밖은 `needs-input`/`unknown_tool_outcome`이다.
- 상태: `created → running → verifying → (running) → done | failed | needs-input | cancelled | budget-exhausted`. 모델의 완료 선언은 `done`을 만들지 못한다.
- 재수정은 기본으로 꺼져 있다(`maxRepairAttempts` 기본 0, `maxSameFailures` 기본 2).
- 실행 중 진행 상황은 가림본 기록으로 만든 한 줄씩을 stderr에 낸다. `--quiet`로 끈다(U-8). stdout은 항상 JSON 한 줄이다.

### 4.4 어댑터 계층과 단계 4 흐름 (결정만, 코드 없음)

어댑터 계층([어댑터 계약](design/adapter-contract.md))
- 4.1의 2~8단계와 4.2의 조립을 앱 계층 `startRun`으로 옮긴다. 순서, 오류 코드, stdout 바이트, 종료 코드는 바꾸지 않는다(AC 7.1).
  - 변수 파일은 `process.env`에 적재하지 않는다. 환경 사본에 합친다(AC 4절).
  - 사본으로 옮겨도 동작이 같아야 한다. 그래서 앱 환경은 대소문자를 무시하는 이름 조회(Windows의 `process.env`와 같음)를 주고, 명령 실행기의 부모 환경도 앱 환경에서 넘긴다. 이행의 완료 기준에 이 두 경우의 시험을 넣는다(DR-4, R-1 M-3).
  - 실행 요청은 워크플로 선택(`workflowRef`)을 받는다(DR-2).
- 진행 이벤트는 journal에 쓴 가림본 `JournalRecord` 그대로다(AC-D2). 사람용 문장은 어댑터가 문구 카탈로그(N-4)로 만든다.
- 취소는 `handle.cancel()` 하나로 모인다. CLI의 신호·취소 파일과 VS Code 확장의 취소 파일이 이 함수를 부른다(AC 5.3, AC-D9).
- 확인 질문 통로(AC 5.7)는 실행 중 권한 확인 전용이다(DR-1).
  - 기본 거부, 그 호출 한 번만 허용, 대기 시간은 실행 시간 한도에 포함(AC-D5, AC-D6).
  - 형태는 DR-3(3절)이다. 엔진 연결은 단계 5 시작에 한다.
- 계획 승인은 실행 사이 확인 하나다(DR-1, GT-D4).
  - 앱 계층에 계획 보기, `applyPlan(runId, digest)`, 사람 확인 `review`를 둔다.
  - 어댑터는 `needs-input`/`plan_pending` 결과 뒤에 계획 화면을 연다. 해시는 GT의 다이제스트 하나다.
- 변경 비교는 다시 가린 비교만 내준다. 비교 내용은 CLI와 앱 계층의 함수가 만들고, 어댑터는 스냅샷 저장 형식을 직접 읽지 않는다(DR-7).
- 프로세스 밖 어댑터용 줄 프로토콜: `run --events jsonl --confirm stdio`(AC-D7, AC-D8). 적용도 `apply --events jsonl --cancel-file`로 같은 통로를 갖는다(DR-2). stdout과 종료 코드는 그대로다.

단계 4 엔진 변경([범용 작업](design/general-tasks.md) 4.3절, 이유는 [decisions.md](decisions.md) 3절)

| 번호 | 변경 |
| --- | --- |
| GT-E1 | 도구 묶음. 엔진은 task의 묶음만 모델에 제시하고 묶음 밖 호출은 `unknown_tool`이다 |
| GT-E2 | 워크플로 지시문. 고정 시스템 문구 뒤에 붙여 가린 뒤 보낸다 |
| GT-E3 | 계획 단계. 읽기 도구와 `propose_plan`만 제시하고, 제안이 성공하면 `needs-input`/`plan_pending`으로 끝낸다 |
| GT-E4 | 완료 방식. `human_review`이면 자동 검증 통과 뒤 `needs-input`/`awaiting_review`로 끝낸다. `done`이 아니다 |
| GT-E5 | 도구 설명자의 `endsRun: "plan"` 속성. 엔진은 도구 이름으로 분기하지 않는다 |

계획 확인과 적용은 실행 사이에서 한다(GT-D4, GT-D13, DR-1).

```
run (workflowRef: organize) → 계획 검증 → plan.json, plan_proposed → needs-input/plan_pending(파일 그대로)
plan --run <id>                   plan.json을 다시 가려 행동 목록과 다이제스트를 보인다(DR-5)
apply --run <id> --digest <앞 12자 이상> [--events jsonl] [--cancel-file <f>]
  → 잠금 → 전 항목 사전 점검(어긋나면 plan_stale, 아무것도 옮기지 않음) → 순서대로 이동·폐기
  → inventory 검증 → 새 runId(planRunId로 계획 실행을 가리킴)
revert --run <적용 runId>         이동을 되돌리고 보관함의 파일을 되살린다
```

- 엔진은 기다리지 않는다. 확인을 기다리는 동안 모델 연결과 잠금을 쥐지 않는다.
- `plan.json`에는 행동과 원본 해시만 둔다. 적용 때의 정책과 검증기는 그때의 사용자 설정과 task에서 읽는다(DR-5). 작업 공간 안의 파일이 다음 실행의 정책·검증기를 정하지 못하게 하기 위해서다(S-1의 목적, R-1 M-4).
- `inventory` 검증기는 계획 대상의 해시와 나머지의 경로·크기 목록을 쓰고 자체 상한을 둔다. 상한에 닿으면 적용 전에 알린다(DR-6). 무결성 목록의 상한(파일 10,000개, 256 MiB)에 닿으면 판단 불가가 되는 문제를 피한다(R-1 M-5).
- 적용 단계에는 모델이 없으므로 재수정하지 않는다.
- 적용을 취소했을 때의 끝 상태는 아직 정하지 않았다(R-1 L-7, 범용 작업 담당). [미정]

## 5. 명령과 상태 디렉터리

| 명령 | 하는 일 | 상태 |
| --- | --- | --- |
| `run --task <f>` / `run --workspace <d> --goal <t>` | 4절의 실행. 간편 형식은 설정 파일의 정책·검증기를 쓴다(C-8) | 구현 |
| `revert --workspace <d> --run <id>` | 잠금을 잡고 스냅샷으로 되돌린다. 현재 해시가 그 실행의 결과와 같은 파일만 되돌린다(R-7, T-10, T-12) | 구현 |
| `report --workspace <d> --run <id> [--json]` | result.json과 journal만 읽어 사람이 읽는 보고서를 만든다. 잠금을 잡지 않는다(U-5, X-2) | 구현 |
| `doctor [--config] [--vars-file] [--task \| --workspace] [--json]` | 네트워크 없이 12개 항목을 점검한다. 키 값은 출력하지 않는다(U-6, W-5, X-1, X-3) | 구현 |
| `--help`, `help <명령>`, `--version` | 도움말과 버전(U-7) | 구현 |
| `models [--json] [--use <번호\|id> --config]` | 모델 목록 조회와 선택(Y-1~Y-4). 키와 실제 접속이 필요하다 | 구현(유닛 `cli/y-models`, 통합 `y01-models`는 가짜 서버). 실제 API 미실행 |
| `init` | 기본 설정 위치에 설정 파일을 만든다. 키는 받지 않는다(N-2) | 계약만(N-A). 명령 없음 |
| `runs --workspace <d>`, `--run latest` | 실행 목록과 가장 최근 실행(N-7, N-16, N-18) | 모듈 구현(`store/runs`, `cli/runs.ts`, 유닛). CLI 명령 연결 전 |
| `revert --dry-run` | 바꾸지 않고 되돌릴 것만 보인다. 이미 되돌린 파일은 `already_reverted`(N-7, N-22) | 저장소 함수 구현(`store/changes`의 `dryRun`, 유닛). CLI 옵션 연결 전. `already_reverted`는 결정만 |
| `run --profile <이름>`, `run "<목표>"` | 프로필(N-8)과 현재 디렉터리를 작업 공간으로 쓰는 한 줄 실행(N-9) | 결정만(N-A) |
| `run --events jsonl --confirm stdio` | 프로세스 밖 어댑터용 줄 프로토콜(AC-D7, AC-D8). `apply`도 `--events jsonl`과 `--cancel-file`을 받는다(DR-2) | 결정만 |
| `run --workflow <id>` | 워크플로 정의 고르기(간편 형식, GT 4.2) | 결정만 |
| `plan --run <id>`, `apply --run <id> --digest <d>` | 계획 보기와 승인한 계획의 적용(GT-D4) | 결정만 |
| `review --run <id> --accept\|--reject [--note]` | 사람 확인의 판정을 `review.json`에 기록. 결과 상태는 바꾸지 않는다(GT-D6) | 결정만 |

상태 디렉터리는 작업 공간 루트의 `.codaryn/`이다. 파일 도구는 이 안을 읽거나 쓸 수 없다.

```
.codaryn/
  .gitignore            "*" (Git 추적 제외, 이미 있으면 덮어쓰지 않음)
  lock.json             {pid, runId, startedAt}
  runs/<runId>/
    journal.jsonl       가림본 사건 기록(추가 전용)
    result.json         EngineResult(가림본)
    snapshots/          쓰기 전 원문(평문)과 index.json
    plan.json           (결정만) 계획의 행동과 원본 해시만(DR-5). 로컬 원문, 모델에 보내지 않고 보일 때는 다시 가린다
    review.json         (결정만) 사람 확인의 판정
  discarded/<runId>/    (결정만) 적용 실행이 폐기한 파일의 보관함. 실행 디렉터리 밖이라 실행 기록을 정리해도 남는다.
                        revert가 되살린다. 보관함 정리는 파일 수와 크기를 보이고 따로 확인한다(DR-9)
```

종료 코드와 출력 형식은 [CLI 계약](cli-contract.md)이 기준이다. 결정만 있는 명령과 파일은 아직 CLI 계약에 없다.

## 6. Anthropic 모델 어댑터(`src/model/anthropic/index.ts`)

- [확정] 첫 제공자는 Anthropic이다.
- [선택] 공식 SDK가 아니라 **Node 내장 `fetch`로 Messages API를 직접 호출한다**(C-7). 근거:
  - 허용 의존성 목록을 넓히지 않는다.
  - 유닛 시험에서 전송을 바꿔 끼울 수 있다.
  - 엔진이 반복을 소유하므로 SDK의 tool runner가 필요 없다.
  - 단계 0의 "공식 SDK" 서술(decisions.md M-5)을 대체한다.
- 요청
  - `POST {apiBaseUrl}/v1/messages`, 리디렉션 따르지 않음. 헤더는 `content-type`, `x-api-key`, `anthropic-version`이다.
  - 본문은 `model`, `max_tokens`, `system`, `messages`, `tools`(도구 네 개)다.
  - 스트리밍, thinking 설정, `tool_choice`, 캐시 지시는 보내지 않는다.
  - `anthropic-workspace-id`는 보내지 않는다.
  - `anthropic-version` 값은 코드 상수다. 실제 호출로 확인한 값이 아니다.
- 응답
  - thinking 블록은 검사 후 버리고 다음 요청에 되돌려 보내지 않는다.
  - 본문 상한은 성공 8 MiB, 오류 4096바이트다(S-10).
  - 사용량은 입력(캐시 토큰 포함)과 출력이다. 사용량이 없고 토큰 한도가 있으면 실행이 `budget-exhausted`/`usage_unknown`으로 끝난다.
- 시간·재시도
  - 시도마다 타이머가 있다(`requestTimeoutMs` 기본 600000).
  - 재시도는 `maxRetries`(기본 2, 최대 10)회다. 대상은 429, 408, 409, 5xx, 시간 초과, 연결 오류다.
  - `retry-after`를 따르되 60초 이내, 아니면 지수 대기(8초 상한)다. 401·403과 다른 4xx는 재시도하지 않는다.
  - 시간 초과한 POST를 같은 본문으로 다시 보낸다(중복 처리 가능성, 한계로 기록).
- 키
  - `ANTHROPIC_API_KEY` 환경 변수(또는 `--vars-file`)로만 받는다. 파일 속 키는 거부한다(C-1).
  - 출력 가능한 ASCII만 허용한다(S-11). 이 검사는 제공자 안에서 전송 직전에 한다. 그래서 키 형식이 틀리면 실행이 시작된 뒤 `failed`/`model_error`로 끝난다.
  - 오류 메시지에서는 키 전체·8자 조각·키 모양을 지우고 300자로 자른다(S-12).
- 모델과 주소
  - 모델은 task `model.model` → `CODARYN_MODEL` → 설정 파일 순이다. 코드 기본값은 없고, 없으면 실행 전 `provider_not_configured`다(C-4).
  - `maxOutputTokens`는 필수다(상한 200000, T-14).
  - 주소는 https만 허용한다(루프백만 http). 사용자 정보, `?`, `#`가 있거나 `/v1`로 끝나면 거부한다(S-9). task로는 바꿀 수 없다(C-5).
- 대본 제공자(`scripted.ts`)
  - 단계별 응답을 순서대로 돌려준다.
  - 키 없이 전 과정을 실행하는 오프라인 검증의 기본 수단이다.
- 구독 계정은 API 자격증명이 아니다. 키가 없으면 호출하지 않는다.

## 7. 경계

**문맥.**
- 모델에 가는 것은 목표, 도구 결과, 검증 근거, 고정 문구뿐이며 모두 가림본이다.
- 크기 상한이 있다.
  - 명령 출력: 스트림당 65,536바이트(여유 4,096바이트 더 받아 가린 뒤 자름)
  - 검증 근거: 8,192바이트
  - 재수정 메시지: 별도 상한
  - 검색 줄: 1,000자
- 잘렸으면 잘렸다고 표시한다. 문서와 도구 출력은 자료이며 권한을 넓힐 수 없다.
- 긴 대화의 요약·압축은 없다. [미정]

**변경.**
- 모든 쓰기는 `write_file`을 거친다. 읽을 때의 해시(`expectedHash`)와 현재 해시가 다르면 `conflict`로 쓰지 않는다. 쓰기는 원자적이다.
- 쓰기 전 원문은 `snapshots/`에 둔다. 평문이며, 자동 삭제가 없고, 파일 도구로는 닿지 않는다. 다만 허용된 명령은 읽을 수 있다(R-6, R-8, T-11).
- `codaryn revert`가 이 원문으로 되돌린다. 자동 롤백은 없다.
- 단계 4의 파일 이동·폐기(GT-D4, GT-D5). **결정만**
  - 모델은 계획만 제안하고 적용기가 실행한다.
  - 대상이 이미 있으면 덮어쓰지 않고 계획 검증에서 거부한다.
  - 폐기한 파일은 실행 디렉터리 밖 `.codaryn/discarded/<runId>/` 보관함에 평문으로 남는다(DR-9).
  - 실행 기록 정리는 보관함을 지우지 않는다. 보관함 정리는 파일 수와 크기를 보여 주고 따로 확인한다. 기록을 지우려다 사용자 파일(폐기한 원본)을 영구히 지우는 일을 막는다(R-1 M-8).

**민감정보.** [확정] 전송 전 가역 치환과 로컬 복원.
- 구현 규칙은 [privacy.md](privacy.md)에 있다.
- 게이트는 하나다. 모델로 가는 내용과 기록으로 가는 내용이 모두 이 게이트를 지난다.
- 대응표는 실행 단위 메모리에만 있다.
- 복원은 도구가 선언하고 정책이 허용한 필드(경로·cwd)만 한다. 명령 인자와 환경은 복원하지 않는다.
- 문서 내용은 토큰이 든 줄을 그대로 두는 원위치 규칙으로만 다시 쓴다.
- 어댑터와 단계 4에 대한 결정. **결정만**
  - 어댑터 이벤트는 가림본이다. 화면에 내기 전에 어댑터가 제어 문자를 정리한다(AC 5.2).
    - 예외: 모델이 준 도구 호출의 이름과 id는 기록에서 가려지지 않는다. 지금은 CLI 진행 줄만 이를 막는다(R-1 L-1).
    - 앱 계층이 이벤트를 내기 전에 다시 가릴지는 어댑터 계약 담당이 정한다. [미정]
  - 확인 질문의 글은 화면에 보이려고 복원하지 않는다(AC 5.7).
  - 변경 비교는 다시 가린 비교만 보인다. 두 어댑터 모두 같다(DR-7). 스냅샷 원문을 어댑터 화면이나 편집기로 열지 않는다.
  - 자료 분석은 원자료 행을 모델로 보낸다. 가림은 등록한 비밀 값에만 적용된다. 그래서 개인정보가 든 자료는 집계 도구(P1) 전에는 다루지 않는다(GT-D8 (b), 사용자 확인 대기 Q-4).

**도구 실행(`src/tools/command-runner.ts`).**
- 자식 환경
  - 허용 목록 11개 이름만 넘긴다.
  - 값에 등록 비밀이 든 변수는 뺀다(T-1). 단 Windows에서 libuv가 스스로 넣는 변수는 예외다.
- 실행 파일 해석(Windows)
  - 자식 환경의 PATH와 PATHEXT로 찾는다. 작업 디렉터리와 상대 PATH 항목은 찾지 않는다.
  - 실행 파일이 작업 공간 안으로 풀리면 실행하지 않는다(T-4).
  - `.cmd`·`.bat`는 작업 공간 밖에 있고 인자가 좁은 문자 집합일 때만 `cmd.exe /d /s /c`로 실행한다.
  - UNC 실행 파일과 cwd는 거부한다(X-1).
- 종료 처리
  - 자식이 끝나면 종료 코드를 확정하고, 파이프는 500ms 더 읽은 뒤 닫는다(T-2).
  - 시간 한도·취소 시에는 살아 있는 동안만 트리를 끝낸다(Windows `taskkill /T /F`, POSIX 프로세스 그룹).
  - 끝까지 읽지 못한 출력은 마지막 불완전 줄을 버린다(V-2).
- 이것은 실수 방지 수준이다. OS 격리가 없어서 자식의 파일·네트워크 접근을 막지 못한다. 분리된 자손은 실행과 CLI보다 오래 살 수 있다. 네트워크 차단이나 샌드박스라고 부르지 않는다. OS 격리는 [미정].

**보호 경로(`src/policy/protected.ts`).**
- `policy.protectedPaths` 아래로의 파일 도구 쓰기는 `protected_path`로 거부한다(R-5).
- 판정은 어휘 경로와 실경로 둘 다로 한다.
- 항목이 링크이면 그 실경로도 보호한다. 실경로가 작업 공간 밖이면 모든 쓰기를 거부한다(T-13).
- 형식 검사는 CLI와 게이트가 같은 함수를 쓴다.
- 명령이 바꾸는 것은 막지 못하므로 무결성 확인(8절)이 사후 탐지로 보완한다.

## 8. 자기 개발: 실행본, 후보, 보호된 검증

[확정] 검증된 CLI가 별도 후보 작업 디렉터리에서 자기 소스를 개발한다. [선택] 실행본, 후보, 보호된 검증 자료를 분리한다.

| 역할 | 위치 | 구현 |
| --- | --- | --- |
| 실행본 | 채택된 커밋에서 빌드한 CLI(설치 위치) | 작업 공간이 설치 위치와 같거나 그 안이거나 그것을 포함하면 실행 전에 거부한다(U-3). 구현 |
| 후보 | 별도 Git worktree와 브랜치 | `scripts/new-candidate.mjs`가 만든다(U-4). 대상이 이미 있으면 아무것도 바꾸지 않는다. 엔진은 Git을 쓰지 않는다. 구현 |
| 보호된 검증 자료 | 작업 공간 안의 `protectedPaths`와 작업 공간 밖의 `integrity.paths` | 무결성 확인(U-1, U-2, W-1, W-2). 후보 틀은 공유 Git `hooks`·`config`와 CLI `dist`를 미리 채운다(W-3). 구현 |
| 채택 | 사람(PM) | `codaryn report`로 결과를 읽고 사람이 병합·교체한다. 자동 교체는 없다(U-5). 구현 |

무결성 확인(`src/verify/integrity.ts`, 엔진 연동):
- 목록: 보호 대상 아래 모든 파일의 SHA-256 목록을 만든다.
  - 링크는 저장된 대상 문자열 해시로 기록한다. 대상이 작업 공간 안이면 그 내용도 대상의 실경로로 넣는다(W-2).
  - 순환은 실디렉터리를 한 번만 들어가 끊는다.
  - 상한은 파일 10,000개, 256 MiB다.
- 점검 시점: 기준선(실행 시작), 검증 전, 검증 후, 끝(W-1).
- 결과: 바뀌었거나 확인할 수 없으면 `needs-input`/`protected_changed`이고 재수정하지 않는다.
- 바뀐 경로는 가린 뒤 기록과 결과의 `protectedChanged`에 남긴다.

한계(고치지 않고 기록한 것):
- 검증 도중에만 보호 파일을 바꿨다 되돌리는 배경 프로세스는 잡지 못한다.
- 검증기는 모델이 쓴 코드를 실행하고 그 출력이 모델로 돌아간다(T-7). 후보 코드가 검증 프로세스 안에서 판정 자체를 바꾸는 경우도 무결성 확인으로 잡을 수 없다.
- 작업 공간 밖 링크 대상의 내용은 `integrity.paths`에 적어야 확인된다(W-2).
- 기준선은 실행마다 새로 잡는다.
- 후보 worktree는 OS 경계가 아니다.

실제 모델로 자기 소스를 고치는 실행은 사용자의 실제 호출 점검 뒤에 연다. 지금까지는 대본 모델 예행(통합 `k03`)만 했다.

## 9. 재시작, 중복, 충돌, 취소

- **기록**
  - journal은 추가 전용 JSON Lines다. 가림본만 담고 원문, 대응표, 키는 넣지 않는다.
  - 잘린 마지막 줄은 읽을 때 무시하고, 그 밖의 깨진 줄은 거부한다(T-10).
- **재시작**: 자동 이어 하기는 없다. 기록으로 무엇이 끝났는지 보고, 사용자가 되돌리거나 새로 실행한다.
- **중복**
  - 작업 공간마다 `lock.json` 하나다. 완성된 임시 파일을 하드 링크해 원자적으로 만든다.
  - 죽은 프로세스의 잠금은 회수 파일로 한 번에 하나씩 원자적으로 회수한다. EPERM·EBUSY는 `workspace_locked`다(P-4, T-9, W-4).
  - 죽은 pid가 다른 프로세스에 재배정되면 그 프로세스가 끝날 때까지 잠금이 살아 있는 것으로 보인다(한계).
- **충돌**: 쓰기 직전 해시 비교. 사용자 변경을 덮어쓰지 않는다.
- **취소**
  - SIGINT·SIGTERM과 `--cancel-file`(작업 공간 밖) 두 경로가 있다(P-2).
  - 모델 요청을 끊고 자식 트리를 끝낸다. 상태는 `cancelled`다.
  - 적용된 변경은 유지하고 되돌리기는 `revert`로 한다.
  - 이행 뒤. **결정만**
    - 모든 취소 출처가 앱 계층의 `handle.cancel()`을 부른다.
    - 프로세스 밖 어댑터는 Windows에서 신호 대신 `--cancel-file`을 쓴다(AC-D9).
    - 적용기도 같은 신호로 항목 사이에서 멈추고 한 것을 기록한다(general-tasks 12절). 적용도 프로세스 밖 어댑터를 위해 `--cancel-file`을 받는다(DR-2). 적용 취소의 끝 상태는 미정이다(R-1 L-7).
    - 사전 검사 중 취소와 질문 대기 중 창 닫기의 기록이 어댑터마다 다를 수 있다(R-1 L-2). 어댑터 계약 담당이 맞춘다. [미정]

## 10. 범위와 남은 위험

- **범용 계약**: 코딩과 작은 문서 작업(통합 `a02`)으로 계약에 Git·테스트 가정이 새지 않는지 확인했다. 자료 분석·파일 정리 유형은 설계가 채택됐고 구현은 없다([범용 작업](design/general-tasks.md)). 엔진 변경은 GT-E1~GT-E5 한 번으로 정했다.
- **민감정보**
  - 등록한 값과 정해진 변형만 정확 일치로 가린다. 다른 인코딩(UTF-16 등)이나 임의 변환은 놓친다.
  - 모델이 실행한 코드는 원문을 읽고 변환해 내보낼 수 있다.
- **자기 개발**: 무결성 확인은 사후 탐지이며 OS 격리가 없다. 실제 모델 실행 전이다.
- **실제 API**: 연결 코드는 모의 서버로만 확인했다. 503 분류, `retry-after` 형식, thinking 블록, 시간 초과 뒤 재전송은 실제 호출 점검에서 확인할 항목이다.
- **GUI·IDE**: 구현은 없다. 설계 상태는 다음과 같다.
  - 어댑터 계약과 VS Code 확장 설계는 채택됐고, 교차 검토 R-1 뒤 DR-1~DR-9로 고칠 곳이 정해졌다. 설계 문서의 수정은 각 담당이 한다.
  - VS Code 확장은 `@types/vscode` 승인(Q-3) 전까지 VS Code API에 의존하지 않는 코어만 만든다.
  - 독립 GUI는 권고만 있다. 형태, 코드 서명, 지원 OS는 사용자 확인 대기다(Q-7).
  - 어댑터는 같은 엔진을 쓰므로 위의 민감정보·격리 한계를 그대로 가진다.
  - VS Code 확장은 목표 문장을 명령줄 인자로 넘긴다. 같은 사용자의 다른 프로세스가 볼 수 있다(VX-D9, 한계로 기록).

## 11. 결정 필요

| 번호 | 선택지 | 권고 |
| --- | --- | --- |
| A-1 | 키 형식 검사(S-11)를 실행 전 단계로 올릴지. 지금은 잠금·journal을 만든 뒤 `failed`/`model_error`로 끝난다 | 올린다. run 사전 단계와 doctor에서 같은 함수로 검사해 실행 디렉터리를 만들지 않는다 |
| A-2 | 무결성 계약에 `run_end` 단계를 둘지. W-1 종료 점검이 `before_verify`/`after_verify` 이름으로 기록돼 report에서 구분되지 않는다 | 둔다(계약 담당 p7). 기록 해석이 명확해진다 |
| A-3 | 계약 주석 `src/contracts/integrity.ts`의 "링크는 따라가지 않는다"가 W-2 구현과 다르다 | 계약 담당이 주석을 W-2에 맞춘다 |
| A-4 | `anthropic-workspace-id` 헤더. 작업공간에 묶이지 않은 키에는 필요하다는 외부 문서 확인(decisions.md 4절)이 있다 | 실제 호출 점검에서 필요 여부를 보고, 필요하면 설정 필드로 추가한다 |
| A-5 | 스냅샷 수명. 자동 삭제가 없고 평문이다(R-8) | report와 doctor에 크기·위치 안내를 넣고, 정리 명령은 UX 설계와 함께 정한다. 폐기 보관함은 실행 기록과 따로 정리한다(DR-9) |
| A-6 | 잠금의 pid 재사용 오판(W-4 조사) | 잠금에 프로세스 시작 시각을 더하는 형식 변경을 단계 4 전에 검토한다. 그때까지 doctor·오류 메시지에 수동 삭제 안내를 둔다 |
| A-7 | 계획 승인의 통로. 어댑터 계약 5.7(실행 중 `plan` 질문)과 범용 작업 GT-D4(실행 사이 확인)가 둘 다 채택됐다 | **해소(DR-1)**: 실행 사이 확인 하나다. 확인 질문은 권한 확인 전용이고, 앱 계층에 계획 보기·`applyPlan`·`review`를 둔다 |
