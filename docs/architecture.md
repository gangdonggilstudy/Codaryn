# Codaryn 아키텍처

상태: 2026-11-13, main `f8fb993` 기준. 아래 두 목록은 main `3aca6b5`에서 다시 확인했다(실행 중 권한 확인은 `cd1cace`, U-147. Markdown 규칙은 U-165. GUI의 권한 대화상자는 main `07cd600`, U-179. 앱 계층의 작업 공간 글 읽기·쓰기는 main `5ee11a1`, U-188. 쓰기 허용 경로는 main `c83ec5b`, U-200. GUI의 파일 보기는 main `c0afedb`, U-209. 묶음 A·B의 "없는 것"은 main `79e1a3f`, U-214. 묶음 B의 실행 계획은 main `13ea1ac`, U-216. 묶음 A와 앱·GUI의 실행 계획 수행은 main `1f0eb85`, U-253). 본문의 다른 절은 `f8fb993` 기준 그대로다(7절의 읽기 제외 경로, 9절의 자료 분석, 10절은 U-253).
- **main에 있는 것:**
  - 단계 0 설계(2026-11-12 Codex 채택)를 바탕으로 한 단계 1a, 1b(모의 API까지), 2, 3의 오프라인 기구와 `codaryn models`
  - 두 번째 제공자 OpenAI(DR-31)와 두 제공자가 함께 쓰는 전송 `src/model/http`
  - 사용성 개선 N-1~N-28(N-11은 단계 5로 미뤘고, N-13은 DR-20이 대체했다)
  - 단계 4 범용 작업의 P0, 앱 계층 `src/app`, 독립 GUI `gui/`(DR-20, DR-26)
  - 단계 4 P1 묶음 가운데 Markdown 규칙 `markdown_headings`, `markdown_links`(`file_rules`, U-116 `4df5be8`)
  - 실행 중 권한 확인(판정 `ask`, DR-3). 설정 파일과 프로필의 명령 규칙에 둔 `confirm: true`만 질문을 만든다. CLI의 `run`은 터미널에서만 묻고, 물을 수 없으면 거부한다(U-74, U-108~U-110, U-137. 3절, main `cd1cace`). GUI는 메인 프로세스의 OS 대화상자로 묻고 기본과 Esc는 거부다(U-124, 병합 `aa723d2`, [독립 GUI 설계](design/standalone-gui.md) 3.6)
  - 앱 계층의 작업 공간 텍스트 파일 읽기·쓰기 `readWorkspaceText`·`writeWorkspaceText`(`src/app/workspace-text.ts`, U-172, 병합 `b25edb1`, AC 5.15, DR-72 (나)). 폴더 바꿔치기로 남은 틈은 알려진 한계다(DR-73, [privacy.md](privacy.md) 13절)
  - GUI의 파일 보기(텍스트 보기와 고치기, DR-72): 위 함수로 연다. 가리면 글이 달라지는 파일과 보호 경로 등은 읽기 전용이고, 저장은 연 파일마다 첫 저장에 메인의 OS 확인을 거치며 실행 기록에 들지 않는다(U-174·U-184·U-192, 병합 `111e25d`, [독립 GUI 설계](design/standalone-gui.md) 3.14, [사용 안내](usage.md) 19절). CLI는 이 함수를 부르지 않는다(코드 기준)
  - 단계 4 P1 묶음 B의 쓰기 허용 경로 `writablePaths`(DR-69, U-182·U-186·U-183, 병합 `a1d5c65`). task 파일, 설정 파일, 프로필, 작업 종류 정의의 `policy`에 두고, 목록마다 따로 남아 쓰기는 모든 목록이 덮어야 한다(좁히기만). CLI와 앱 계층의 실행·적용 게이트가 판정한다(`path/path_not_writable`). 명령은 묶지 않는다. 7절 "쓰기 허용 경로", [사용 안내](usage.md) 13절
  - 단계 4 P1 묶음 B의 실행 계획(`plan: "run"`, DR-69, DR-74). 계약(U-170·U-175·U-177, 병합 `a2f67c1`), 엔진의 `propose_changes`와 승인된 계획의 실행 `runApprovedPlan`, 저장의 변경 계획(U-180·U-187·U-181, 병합 `283e6cd`), CLI의 `run`·`plan`·`apply`·`runs`·`report`·`doctor`(U-191·U-195·U-198, 병합 `2ef6b48`). `apply`가 승인한 파일만 쓸 수 있는 새 모델 실행을 계획을 만든 실행의 목표로 시작하고, 한 계획을 한 번만 수행한다. 앱 계층은 보기와 점검을 주고(U-196) CLI와 같은 길로 계획을 수행한다(사건, 권한 질문, 취소. U-218). GUI 계획 화면은 메인 프로세스의 대화상자로 파일과 요약을 보이고 수행한다(U-226. 둘 다 병합 `eb042d9`, 실제 OS 대화상자는 누르지 않음). [사용 안내](usage.md) 18.11절
  - 단계 4 P1 묶음 A(DR-69, DR-70, DR-74, 병합 `8b4e204`): 읽기 제외 경로 `unreadablePaths`와 묶음 크기 k `minGroupSize`(task 파일, 설정 파일, 프로필, 작업 종류 정의의 `policy`. 목록은 합하고 k는 가장 큰 값이며 5 아래로 내리지 못한다), 표 집계 도구 `query_table`(U-208), 내장 작업 종류 `analyze-private`(U-210). 실행마다 게이트·도구 실행기·검증기 실행기·무결성 대상이 한 함수(`runGuards`)에서 목록과 k를 받는다. CLI와 앱 계층이 같다(U-237). 7절 "읽기 제외 경로", [민감정보 처리](privacy.md) 15절, [예시](../examples/analyze-private-demo/README.md)
- **없는 것:**
  - CLI의 앱 계층 이행(CLI에서 앱 계층을 거치는 명령은 `changes`뿐이다). 기능 뒤에 직렬로 한다(DR-65)
  - 줄 프로토콜의 CLI 연결과 VS Code 확장(DR-20으로 만들지 않는다). 남아 있던 코드는 지웠다(DR-66, U-81)
  - GUI 설치 패키지(GU-9). 기능이 끝난 뒤 다시 묻는다(DR-67)
- **실제 Anthropic API와 실제 OpenAI API는 한 번도 호출하지 않았다**(`tests/live` 미실행). 모든 검증은 대본 모델, 가짜 HTTP 서버, 실제 CLI 프로세스로 한 오프라인 검증이다.
- 이 문서의 대조는 [설계 대조 조사](reviews/2026-11-13-design-gap-survey.md) 2.4절, 단계별 판정은 같은 조사 3절을 따른다.
- 이 문서는 구조를 설명한다. 각 기능의 파일, 결정 번호, 시험은 [구현 위치표](design/implementation-map.md)에, 단계 4·5 설계의 세부는 [설계 문서 색인](design/README.md)의 문서들에 있다. 결정의 현재 상태는 [결정 대장](decision-register.md)이 기준이다.

표기:
- 성격: **[확정]** 사용자 확정 요구, **[선택]** 관리자(Codex, 위임 기간에는 임시 PM)의 설계 선택, **[미정]** 결정 전.
- 상태
  - **구현**: 코드와 시험이 있다.
  - **일부**: 일부만 코드가 있다. 빠진 것을 같은 자리에 적는다.
  - **결정만**: 결정은 있지만 코드가 없다.
  - **없음**: 결정도 코드도 없다.
  - **중단**: 결정으로 만들지 않기로 했다.
- 확인 방법
  - **코드 기준**: main `f8fb993`의 소스를 읽어 확인했다.
  - **실제 CLI**: main `f8fb993`를 빌드한 CLI를 임시 폴더에서 실행해 확인했다(대본 모델, 키 없음, 닫힌 루프백 포트).
  - 표시가 없는 "구현"은 앞선 판의 시험과 검토가 근거다([개발 진행 현황](progress.md)).
- 근거: [decisions.md](decisions.md). 결정 번호(C-, R-, S-, T-, N-, AC-D, VX-D, GT-D, DR- 등)의 원문은 `docs/work-orders/`와 각 설계 문서의 결정 표다. "AC 5.7"은 [어댑터 계약](design/adapter-contract.md) 5.7절이다.

## 1. 목표와 설계 원칙

- [확정] 코딩 외에 문서 작성, 자료 분석, 파일 정리도 하는 범용 로컬 작업 에이전트다. CLI부터 만들고 Anthropic API를 먼저 연결한다. 코딩과 자기 소스 개발이 첫 작업 유형이다.
- [선택] TypeScript(엄격 검사, ESM). 엔진과 CLI는 단일 패키지이고 실행 의존성이 없다(개발 의존성 `typescript`, `@types/node`만). 서버, 큐, 데몬, 플러그인 런타임, 다중 에이전트는 없다. **구현**
  - **단일 프로세스 원칙의 조건은 "듣는 소켓 없음, 어댑터보다 오래 사는 프로세스 없음"이다**(DR-8. AC-D11의 조건 문장을 대신한다).
    - 듣는 소켓에는 로컬 웹 서버(N-13)도 든다.
    - 독립 GUI는 Electron 주 프로세스가 엔진 전용 Node 프로세스(엔진 호스트) 하나를 띄운다(DR-26). 엔진 호스트는 표준 입출력으로만 말하고, stdin이 끝나면 끝나므로 주 프로세스보다 오래 살지 않는다(`gui/src/engine-host/main.ts`). **구현(코드 기준)**
    - 명령과 검증기를 자식 프로세스로 실행하는 것은 지금과 같다(7절).
    - 알려진 예외(한계): 허용된 명령이 분리해 띄운 자손은 실행과 CLI보다 오래 살 수 있다(T-2, 7절). Codaryn이 띄우는 상주 프로세스가 아니라 사용자가 허용한 명령의 동작이다. OS 격리가 없어서 막지 못한다.
  - 단일 패키지의 예외: 독립 GUI는 같은 저장소의 `gui/`에 별도 매니페스트(`gui/package.json`)로 둔다. 루트 `package.json`은 GUI 의존성을 갖지 않는다. **구현(코드 기준)**
    - VS Code 확장의 `vscode/`(VX-D3)는 **중단**(DR-20)이다. 그 전에 커밋된 `vscode/src/core`는 그 시험과 함께 지웠다(DR-66, U-81).
- [선택] 엔진은 하나다. CLI와 독립 GUI는 엔진을 부르는 어댑터이며 작업 논리를 갖지 않는다(M-2). **일부**
  - 어댑터가 함께 쓰는 실행 준비(입력 해석, 실행 전 보안 검사, 조립, 실행 수명)를 앱 계층 `src/app`에 둔다(AC-D1). `src/app`은 있고, GUI 엔진 호스트는 앱 계층만 부른다(`gui/src/engine-host/host.ts`).
  - CLI의 이행(어댑터 계약 7절의 이행 2~5: run, 진행·취소, report·revert·runs, doctor·models)은 하지 않았다. CLI에서 앱 계층을 거치는 명령은 `changes`뿐이다(`src/cli/main.ts`, 코드 기준). 사용자 결정으로 이행은 "최종 설계까지 구현"에 들지만, 실행 중 권한 확인·GUI 남은 항목·사용성 지적 뒤에 직렬로 하고, 단위마다 고정 출력이 글자까지 같아야 병합한다(DR-65).
  - 반대로 앱 계층의 아홉 파일이 `src/cli`의 함수를 가져다 쓴다(AC-D16의 임시 의존, 코드 기준).
  - 같은 대본을 CLI와 GUI 엔진 호스트로 돌려 결과와 기록을 비교하는 계약 층 시험은 없다.
  - VS Code 확장(VX-D1)은 **중단**(DR-20)이다.
- [선택] 공통 엔진은 Git이나 코드 테스트를 전제로 하지 않는다. Git은 후보 준비 스크립트(엔진 밖)만 쓴다. **구현**
- [선택] 테스트 통과는 "그 검증기가 확인한 범위에서 통과"만 뜻한다. 보안이나 정확성 전체를 보장한다고 쓰지 않는다.

## 2. 모듈

`src/` 아래 열네 개 모듈이 있다(코드 기준).

| 모듈 | 책임 | 알지 못해야 하는 것 | 상태 |
| --- | --- | --- | --- |
| `contracts` | 모듈 사이의 타입·상수·한도(계약). 역할 1(계약 담당)만 바꾼다 | 구현 | 구현 |
| `cli` | 인자 해석, 설정·task 해석, 실행 전 보안 검사(C-3a부터 `app/input/security`에 있다), 조립(`assemble.ts`), 5절의 명령, 사람용 출력(`cli/human`), 진행 표시, 취소 신호 | 모델 형식, 도구 내부 | 구현. 연결되지 않았던 줄 프로토콜 코드 `cli/protocol`은 지웠다(DR-20, DR-66, U-81) |
| `engine` | 상태 기계, 모델↔도구 반복, 한도, 가림 적용 순서, 검증 회차, 재수정 판단, 무결성·상태 디렉터리 점검 시점(DR-38), 에이전트의 마지막 답(`final-message.ts`, DR-47), 승인한 계획의 적용(`apply.ts`, GT-D4) | 파일 시스템, Git, 테스트 러너, 제공자 형식 | 구현 |
| `model` | 제공자 중립 `complete`·모델 목록. `anthropic`(Messages API), `openai`(Responses API, DR-31), 두 제공자가 함께 쓰는 전송 `http`, 대본 제공자 `scripted.ts` | 파일 시스템, 정책 | 구현. 실제 API 미확인 |
| `tools` | 내장 도구 네 개(`read_file`, `search_files`, `write_file`, `run_command`), 작업 종류 도구 두 개(`inspect_files`, `propose_plan`, `workflow-tools.ts`), 명령 실행기(`command-runner.ts`, Windows 실행 `windows-launch.ts`), 계획 적용기(`plan-executor.ts`, `plan-files.ts`) | 모델 제공자 | 구현 |
| `policy` | 호출 허용·거부 판정(경로, 명령, 네트워크, 파괴적 동작, 계획 행동 `planActions`), 보호 경로 | 모델 출력의 의도 | 구현 |
| `privacy` | 가림(치환), 토큰 검증, 필드 단위 복원, 원위치 문서 재구성. 실행 단위 메모리 대응표 | 작업 유형 | 구현 |
| `verify` | 검증기 `command`, `file_rules`, `data_checks`(`tabular`을 쓴다)와 적용 실행마다 만드는 `inventory`(설정할 수 없다). 무결성 목록(`integrity.ts`) | 수정 방법 | 구현 |
| `store` | journal(가림본 기록), result.json, 작업 공간 잠금(`lock.ts`), 스냅샷과 되돌리기(`changes.ts`, 적용 실행은 `apply-revert.ts`), 계획과 적용 표시(`plan.ts`), 폐기 보관함(`discarded.ts`), 사람 확인(`review.ts`), 실행 목록(`runs.ts`), 정리(`cleanup.ts`), 상태 디렉터리 점검(`state-guard.ts`)과 기록 변경 표시(`marks.ts`, DR-38), 계획 뒤 점검하지 못한 실행 찾기(`unchecked.ts`, U-29) | 모델 제공자 | 구현 |
| `workspace` | 허용 루트 안의 경로 해석(링크·8.3 이름 해석), 텍스트 읽기, 원자적 쓰기, 목록 | 정책 판단 | 구현 |
| `app` | 어댑터 공통 계층. 실행 전 입력 검사(`app/input`: 보안 검사, 글 정리, 설치 위치, 실행 id, 사람용 글 꼴. C-3a)도 여기에 있고 CLI가 가져다 쓴다. `startRun`(이벤트, 취소, 결과 저장), `report`·`reportMarkdown`·`revert`·`listRuns`·`resolveRun`, 정리(`stateSummary`, `previewCleanup`, `applyCleanup`), `doctor`, 설정(`readSettings`, `createSettings`, 설정 변경 제안·적용), `listModels`·`selectModel`, `changes`, `plan`·`applyPlan`·`review`(`src/app/types.ts`의 `CodarynApp`, 코드 기준) | 어댑터의 화면과 인자 형식, 프로세스 전역(`process.env`, 신호, stdout) | 일부. GUI가 쓴다. CLI는 `changes`만 거친다. 여러 함수가 안에서 `src/cli` 함수를 감싼다(AC-D16) |
| `i18n` | 사람용 고정 문구 카탈로그(ko, en)와 언어 선택(N-4) | 파일·환경의 값 | 구현. CLI와 GUI 엔진 호스트가 쓴다 |
| `workflows` | 내장 작업 종류 정의 다섯 개(`general`, `code`, `document`, `analyze`, `organize`). 로직 없는 데이터 상수([범용 작업](design/general-tasks.md) 4절) | 실행 논리 | 구현 |
| `tabular` | 표(CSV, TSV, JSON Lines) 해석과 집계. 순수 함수. 표를 조각 단위로 읽는다(U-202) | 파일 시스템, 모델 | 구현. `data_checks` 검증기와 `query_table` 도구(U-208)가 쓴다 |

- 의존 방향
  - 엔진은 `contracts`만 import한다(코드 기준). `cli/assemble.ts`와 `app/assemble.ts`가 모듈을 만들어 `EngineDeps`로 엔진에 넣는다. **구현**
  - 목표는 `cli` → `app` → (`engine`, `store`, `tools`, `policy`, `privacy`, `verify`, `workspace`, `model`) → `contracts`다. 지금은 `app` → `cli`의 역방향 의존이 있다(AC-D16). **일부**
  - "다른 모듈은 각 모듈의 `index.ts` 공개 export로만 쓴다"는 규칙도 **일부**다. 앱 계층이 `src/cli`의 파일을 직접 가져다 쓴다.
  - `src` 밖의 어댑터: `gui/`(Electron, DR-20). 엔진 호스트는 빌드한 엔진(`dist/src`)을 불러 앱 계층을 쓴다. `vscode/src/core`는 지웠다(DR-20, DR-66, U-81).
- 작업 유형(워크플로)
  - 작업 종류 정의(도구 묶음, 지시문, 계획 방식, 완료 방식, 기본값과 상한)를 내장(`src/workflows`)과 사용자 설정 `workflows`에 두고, task의 `workflowRef`나 간편 형식의 `--workflow <id>`로 고른다(GT-D1, GT-D2). **구현**
  - CLI가 정의를 펼쳐 명시적 task 필드로 엔진에 넣는다. 엔진은 정의 이름을 모른다.
  - `workflowRef`가 없는 task는 단계 4 전과 똑같이 실행된다. task의 `workflow`는 자유 문자열 이름표로 남는다(GT-U14).

## 3. 공통 계약

단계 0의 다섯 계약은 아래 타입으로 구현됐다(`src/contracts/`).

| 단계 0 계약 | 구현 |
| --- | --- |
| Task | `TaskSpec`·`ResolvedTaskSpec`(task.ts). 목표, `workflow`·`workflowRef`, 작업 공간, 모델(제공자 포함), 정책, 개인정보(`secretEnv`), 한도, 검증기 |
| Tool | `ToolDescriptor`, `BUILTIN_TOOLS`, `WORKFLOW_TOOLS`(tool.ts). 표시 등급, 요구 권한, 복원 허용 필드(`restoreFields`), 문서 필드(`documentFields`), 계획으로 끝내는 도구의 `endsRun: "plan"` |
| Artifact | 별도 타입 없음. 파일 변경 기록 `FileChangeRecord`(경로, 전후 해시, 생성 여부), 저장한 계획 `StoredPlan`, `EngineResult`(result.json)가 대신한다 |
| Verifier | `VerifierConfig`(`command`, `file_rules`, `data_checks`), `RawVerifierResult`, `VerifierResult`(verify.ts). 결과는 pass, fail, inconclusive와 근거, 검사한 것, 한계. `inventory`는 설정할 수 없는 종류다 |
| Policy | `PolicyConfig`(명령 허용 규칙, network, destructive, `restorePathTokens`, `protectedPaths`, `planActions`)와 `PolicyGate`(policy.ts) |

그 밖의 계약:
- `model.ts`: 메시지·응답·사용량, 대본 형식.
- `privacy.ts`, `text.ts`, `keys.ts`: 가림 게이트, 토큰 형식, `RawText`·`MaskedText` 브랜드, 키 모양.
- `journal.ts`, `changes.ts`, `engine.ts`: 기록 사건, 스냅샷, 결과, 종료 코드.
- `plan.ts`, `workflow.ts`: 계획과 적용(행동, 다이제스트, 적용 기록 사건), 작업 종류 정의와 사람 확인.
- `state.ts`: 상태 디렉터리 점검(DR-38). `cleanup.ts`: 정리.
- `config.ts`: 설정 파일과 제공자 표 `API_PROVIDERS`. `integrity.ts`: 무결성. `commands.ts`: report, doctor, models. `human.ts`: 사람용 문구 계약. `workspace.ts`: 작업 공간.

어댑터 계약([어댑터 계약](design/adapter-contract.md) 4·5절)
- 타입은 계약 폴더가 아니라 `src/app/types.ts`에 있다(`StartRunRequest`, `RunHandle`, `RunEvent`, `RunObserver`, `AppError` 등, 코드 기준). **일부**
- 실행 요청의 `workflowRef`(DR-2), 계획 보기·`applyPlan(runId, digest)`·`review`(DR-1), 다시 가린 변경 비교 `changes`(DR-7)는 앱 계층에 있다. **구현**
- `Journal.append`는 저장한 레코드를 돌려주지 않는다(`append(event): Promise<void>`, 코드 기준). AC-D3은 **없음**이다.
- 확인 질문 기록(`confirmation_requested`, `confirmation_answered`)과 `ConfirmRequest`는 **구현**(U-74, DR-1, DR-3)이다. 앱 계층은 엔진의 질문을 `RunObserver.confirm`으로 어댑터에 넘긴다(U-108, `app/permission.ts`). 통로가 없거나, 답하다 실패하거나, 답이 정한 결정이 아니면 `dismissed`이고, 엔진은 그것을 `deny`/`default`로 기록한다(DR-10, 코드 기준).

범용 작업 계약([범용 작업](design/general-tasks.md) 9절, G-A). **구현**
- task·설정: `workflowRef`, 펼친 `tools`·`instructions`·`plan`·`completion`, 정책 `planActions`, 설정 `workflows`.
- 도구: `propose_plan`, `inspect_files`.
- 결과 이유: `plan_pending`·`awaiting_review`·`consent_required`(`needs-input`), `plan_stale`·`apply_incomplete`(`failed`). 적용 결과는 실행 결과와 같은 이유 표를 쓴다(DR-16).
- 기록 사건: 계획 실행은 일반 실행의 사건을 쓴다(`propose_plan`의 `tool_result`). 적용 실행은 `apply_started`, `plan_checked`, `plan_item_started`, `file_moved`, `file_discarded`, `plan_item_failed`를 쓴다(`plan.ts`, 코드 기준). 설계안의 `plan_proposed`, `plan_rejected`, `plan_approved`는 두지 않았다.
- 검증기: `data_checks`, `inventory`. `inventory`는 계획 대상의 해시와 나머지의 경로·크기 목록을 쓰고 자체 상한을 둔다(DR-6).
- `ask`(명령 규칙의 `confirm` 표시)와 `EngineDeps.confirm`은 엔진에 있다(U-74, DR-3). 판정과 기록 차례는 3절 끝에 있다. **구현**

사용성 계약(N-A): 설정 `language`·`profiles`, 기본 설정 위치, 새 명령의 출력 객체(`InitOutput`, `RunsOutput` 등), 문구 계약(`human.ts`). **구현**. CLI 명령에 연결돼 있다(5절).

표시 등급(`read`, `write-local`, `exec`, `external`)은 보여 주기용이다. 허용 판단은 호출마다 권한별로 따로 한다. **구현**

| 권한 | 검사 |
| --- | --- |
| 경로 | 실효 경로(링크 해석 후)가 허용 루트 안인지, 상태 디렉터리가 아닌지, 쓰기면 보호 경로가 아닌지 |
| 명령 | 실행 파일과 인자가 허용 규칙(실행 파일, 인자 접두사, 추가 인자 허용 여부)에 맞는지, cwd가 루트 안인지 |
| 네트워크 | 네트워크를 쓰는 도구가 없다. 정책값 `network: "deny"`만 받는다. 단계 4에도 네트워크 도구를 두지 않았다(general-tasks 7.1) |
| 파괴적 동작 | 삭제·무버전 덮어쓰기 도구가 없다. `write_file`은 `expectedHash`가 맞을 때만 쓴다. 파일 이동과 폐기는 모델 도구가 아니다. 사람이 다이제스트로 승인한 계획을 결정적 적용기가 실행하고, 폐기는 실행 디렉터리 밖 보관함 `.codaryn/discarded/<runId>/`로 옮긴다(GT-D4, GT-D5, DR-9). 계획 행동의 종류는 `planActions`가 허용한 것만 받는다. 영구 삭제 도구는 없다. **구현** |

- 판정 값은 허용, 거부, 그리고 확인 후 허용(`ask`, GT-D9, AC-D5, DR-3)이다. `ask`는 명령 규칙의 `confirm: true`로만 생긴다. **구현**(U-74, U-109, U-110, U-137, 코드 기준. 실제 출력은 [사용 안내](usage.md) 13절)
  - 질문을 만들 수 있는 것은 사용자 설정 파일과 프로필의 명령 규칙뿐이다(`policy.commands[i].confirm`, 값은 `true`만). task 파일이나 작업 종류 정의의 규칙에 두면 모르는 필드(`unknown_field`)다(DR-3, M-9). 묻는 권한은 명령 하나다.
  - `confirm` 규칙만 그 호출을 허용할 때 정책 2차 판정이 확인 표시(`confirmation_required`)를 낸다. 다른 거부가 하나라도 있으면 그 거부가 이긴다. 그래서 루트 밖, 상태 디렉터리, 보호 경로, 토큰 복원 거부, 허용 목록 밖의 명령은 묻지 않고 거부한다. 같은 호출을 `confirm` 없는 규칙도 허용하면 묻지 않고 실행한다.
  - 물을 통로가 없으면 묻지 않고 거부하고 `by: "default"`로 기록한다. CLI의 `run`은 표준 입력과 stderr가 모두 터미널이고 `--quiet`가 아닐 때만 통로를 준다(U-110). 답은 `y`·`yes`·`예`·`네`면 그 호출 한 번만 허용, 그 밖의 줄(Enter 포함)은 그 사람의 거부, 입력 끝은 답 없음(기본 거부)이다. 질문 중의 Ctrl+C는 실행 전체를 취소한다.
  - 기록 차례(U-137): `confirmation_requested`, `confirmation_answered`, 그 호출의 `tool_decision`이다. 허용이면 실행과 `tool_result`가 이어진다. 거부면 거부(`policy_effective`, `command`/`confirmation_required`)가 `tool_result`로 모델에 돌아간다. 질문 중에 실행이 취소되거나 시간이 다 되면 답은 `deny`(`cancelled` 또는 `default`)이고, 거부 `tool_decision` 뒤 `tool_result` 없이 실행이 끝난다.
  - 답은 그 호출 한 번에만 쓴다. `allow_once`를 받으면 같은 호출을 다시 판정한다(정책 2차, DR-3). 질문을 기다리는 시간도 `maxDurationMs`에 든다.

## 4. 실행 흐름(`codaryn run`)

### 4.1 실행 전(CLI, `src/cli/run.ts`)

하나라도 실패하면 아무것도 만들지 않고 오류로 끝난다. 출력 형식은 4.3 끝에 있다. 순서는 `run.ts` 머리 주석의 1~8이다(코드 기준). `plan`, `apply`, `review`도 1~7을 같이 쓴다(DR-17).

1. 인자를 해석한다. 명령줄의 경로가 UNC·장치 경로이면 거부한다(S-5). `--env-file`과 `--env-file-if-exists`는 거부한다(T-15, V-3).
2. `--vars-file`을 읽어(BOM이면 거부) 환경에 적재한다. 새로 생긴 값은 비밀 후보로 둔다(S-4). 이미 있는 변수가 이긴다.
3. 현재 키를 확인한다. 설정 파일은 `--config`, `CODARYN_CONFIG`(로컬 경로만, S-5), 기본 설정 위치(N-1) 순이다. `--goal`이나 한 줄 목표(N-9)에 키가 없는지 본다(S-8).
4. 설정 파일과 task 파일을 읽는다. 원문 키 검사 → JSON 해석 → 값 키 검사(깊이 64)를 한다(C-1, S-6, T-14). 키가 보이면 다른 검사보다 먼저 멈춘다.
5. 설정을 검사하고(S-3, S-7, S-9), `--profile`을 얹고(N-8), task를 해석한다.
   - 한도는 설정 값이 상한이고 코드 절대 상한이 있다(S-7).
   - `protectedPaths` 형식을 검사한다(T-13).
   - 명령 규칙과 검증기의 실행 파일·cwd에 UNC가 없어야 한다(X-1).
   - 작업 종류 정의가 있으면 정의의 한도를 설정 아래에, 간편 형식이면 정의의 정책·검증기를 프로필·설정의 것과 합친다(DR-41, DR-43).
6. 작업 공간이 있는지, 실행 중인 CLI 설치 위치와 겹치지 않는지 본다(U-3). 변수·설정·task·대본·취소 파일이 작업 공간 밖인지 실경로로 본다(S-1, T-12). `integrity.paths`가 있고 작업 공간 밖인지 본다(U-1).
7. 비밀을 등록한다: `secretEnv` 값(S-3), 키(S-2), 변수 파일의 새 값(S-4).
   - 쓰는 제공자의 키는 길이와 상관없이 등록한다. 다른 제공자의 키 변수 값은 20자 이상일 때만 등록한다(DR-34 (b), `MIN_OTHER_PROVIDER_KEY_LENGTH`, 코드 기준).
8. 모델 제공자를 만든다(6절). 그다음 조립한 엔진에 넘긴다.

### 4.2 조립(`src/cli/assemble.ts`)

- 순서: 작업 공간 → **잠금**(P-4, T-9) → 가림 게이트 → 정책 게이트 → 명령 실행기 하나(도구와 검증기가 공유, T-1) → 실행 기록기 묶음(`createRunRecorders`: journal, 변경 기록기, 계획 기록기, 상태 디렉터리 점검기. DR-38) → 도구 → 검증기 → 무결성 검사기(코드 기준).
- 상태 디렉터리 점검기는 같은 기록기 묶음에서 만든다. 그래야 실행이 스스로 쓴 기록을 변경으로 보지 않는다(`src/contracts/state.ts`).
- 무결성 검사기는 보호 경로나 `integrity.paths`가 있을 때만 만든다(U-1).
- 잠금과 journal은 엔진이 아니라 조립 단계가 연다. 실행이 끝나면 result.json을 쓰고 잠금을 푼다.
- GUI 쪽은 앱 계층의 `app/assemble.ts`가 같은 일을 한다.

### 4.3 엔진(`src/engine/index.ts`)

1. 실행 시간 타이머를 건다. 시스템 문구, 목표, workflow, 작업 종류 지시문(GT-E2)을 가리고 `run_started`를 기록한다.
2. 무결성 기준선을 잡는다(`run_start`). 확인할 수 없는 경로가 있으면 바로 `needs-input`/`protected_changed`로 끝난다(U-1, U-2). 상태 디렉터리 점검의 기준선도 잡는다(DR-38).
3. 대화 반복: 한도 확인 → `model_request` 기록 → 모델 호출 → 응답을 가려 기록 → 도구 호출마다 아래 순서.
   1. 인자 형식 검사
   2. 정책 1차(토큰이 든 인자 그대로)
   3. 허용된 필드만 복원
   4. 형식 재검사
   5. 정책 2차(실효 인자). 확인 표시면 묻고, 답을 기록한 뒤 다시 판정한다(3절 끝, U-74)
   6. 실행. 명령 앞뒤에는 상태 디렉터리를 점검한다(`before_command`, `after_command`)
   7. 결과 가림
   8. `tool_result`(쓰기면 `file_changed`) 기록
   - 모델에 제시하는 도구는 task의 도구 묶음뿐이다. 묶음 밖 호출은 `unknown_tool`이다(GT-E1).
   - 모델이 준 도구 이름과 호출 id는 기록 전에 제한한다. 모르는 이름은 `unknown_tool`로, 안전한 id 규칙에 맞지 않는 id는 `codaryn-call-`로 시작하는 새 id로 기록한다(AC-D15, 코드 기준).
   - 계획 단계(GT-E3, GT-E5): `endsRun: "plan"`인 도구(`propose_plan`)가 성공하면 `needs-input`/`plan_pending`으로 끝난다. 결과에 계획의 다이제스트와 행동 수(`plan`), 에이전트의 계획 설명(`planSummary`, U-59)을 담는다.
4. 모델이 도구 호출 없이 끝나면 검증 회차로 간다.
   1. `before_verify` 무결성·상태 디렉터리 점검
   2. 검증기 실행. 근거는 가린 뒤 자른다(T-6).
   3. 실행 시간·취소 확인(T-8)
   4. `after_verify` 무결성·상태 디렉터리 점검
5. 결과 판정
   - 모두 pass → `done`/`verified`. 완료 방식이 `human_review`이면 `needs-input`/`awaiting_review`이고 `done`이 아니다(GT-E4).
   - 검증기가 없으면 `needs-input`/`no_verifier`다.
   - inconclusive가 있으면 재수정하지 않는다 → `needs-input` 또는 `failed`(R-1)
   - fail
     - 재수정 한도(R-2)와 같은 실패 서명(R-3, V-1)을 본다.
     - 남아 있으면 가린 근거로 재수정 메시지를 만들어(R-4) 3으로 돌아간다.
     - 아니면 `failed`(`verifier_failed`/`repeated_failure`)다.
6. 어떤 이유로 끝나든, 마지막 점검 뒤에 모델 턴이나 검증기가 있었으면 무결성을 한 번 더 점검한다(W-1).
   - 바뀌었으면 기록·결과·알림에 남긴다.
   - `done`은 `protected_changed`로 바뀐다. 다른 종료 상태는 유지한다.
   - 무결성 계약에는 `run_end` 단계가 없어 `before_verify`나 `after_verify` 이름으로 기록한다(A-2, 코드 기준). 상태 디렉터리 점검에는 `run_end` 단계가 있다.
7. 실행 자신이 아닌 것이 상태 디렉터리의 기록을 바꿨으면 그 실행과 기록이 바뀐 실행에 `records-changed.json` 표시를 남기고 `failed`/`state_changed`로 끝난다(DR-38). 사후 탐지이고 되돌리지는 않는다.
8. `run_finished`를 기록하고 결과를 돌려준다. 결과에는 에이전트의 마지막 답(`finalMessage`, 가림과 안전 처리 뒤, DR-47)과 가림 개수(`masking`, DR-52)가 들어간다. 모델 오류로 끝났으면 그 종류, 몇 번째 턴인지, 다시 시도해 나아질 수 있는지(`modelError`, U-55)도 들어간다.

- 결과를 모르는 도구 호출(실행기 예외)은 이렇게 다룬다. **구현**
  - 읽기는 한 번 다시 실행한다.
  - 쓰기는 해시를 읽어 적용 여부를 확인한다.
  - 그 밖은 `needs-input`/`unknown_tool_outcome`이다.
- 상태: `created → running → verifying → (running) → done | failed | needs-input | cancelled | budget-exhausted`. 모델의 완료 선언은 `done`을 만들지 못한다.
- 재수정은 기본으로 꺼져 있다(`maxRepairAttempts` 기본 0, `maxSameFailures` 기본 2).
- 출력(DR-49, U-45. `src/cli/guard.ts`, 코드 기준)
  - 실행 중 진행 줄과 끝 요약, 오류 설명은 가림본으로 만든 사람용 줄이며 stderr로 간다. `--quiet`로 끈다(U-8).
  - stdout의 결과는 JSON 한 줄(ASCII만, N-19)이다. 오류 JSON에는 문제의 종류(`category`: input, state, environment, internal)와 같은 명령을 나중에 다시 해도 될지(`retryable`)가 있다. 알 수 없으면 `retryable`을 빼며, 거짓으로 적지 않는다(U-55, 코드 기준).
  - stdout과 stderr가 모두 터미널이면 그 JSON 줄은 내지 않는다. `--json`이나 `--quiet`를 주거나, stdout이나 stderr가 터미널이 아니면 낸다.
  - `codaryn`만 치면 터미널에서는 도움말을 보인다(DR-49).

### 4.4 앱 계층과 단계 4 흐름

앱 계층([어댑터 계약](design/adapter-contract.md)). **일부**
- `startRun`이 4.1의 준비와 4.2의 조립을 앱 환경으로 한다. GUI 엔진 호스트가 이것을 부른다. CLI의 `run`은 거치지 않는다(이행 2 미완).
  - 변수 파일은 `process.env`에 적재하지 않고 환경 사본에 합친다(AC 4절).
  - 환경 사본은 Windows에서 이름을 대소문자 없이 맞춘다(`app/environment.ts`). 앱 계층의 조립은 명령 실행기의 부모 환경을 이 사본에서 넘긴다(DR-4, `app/assemble.ts`, 코드 기준). DR-4가 CLI 이행의 완료 기준에 넣은 두 시험은 이행을 하지 않아 아직 해당이 없다.
- 진행 이벤트는 journal에 쓴 가림본 `JournalRecord` 그대로다(AC-D2). 사람용 문장은 어댑터가 문구 카탈로그(N-4)로 만든다.
- 취소: 앱 계층과 GUI에서는 `handle.cancel()` 하나로 모인다. CLI의 신호·취소 파일은 앱 계층을 거치지 않고 CLI의 취소 출처(`cli/cancel.ts`)가 받는다. **일부**
- 확인 질문 통로(AC 5.7)는 실행 중 권한 확인 전용이다(DR-1). 엔진은 `EngineDeps.confirm`으로 묻고(U-74), 앱 계층은 그것을 `RunObserver.confirm`으로 넘긴다(U-108). CLI의 `run`은 앱 계층을 거치지 않고 터미널 질문(`cli/confirm.ts`, `cli/terminal.ts`)을 엔진에 직접 준다(U-110). 형태는 DR-3(3절). **구현**
- 계획 승인은 실행 사이 확인 하나다(DR-1, GT-D4). 앱 계층에 `plan`, `applyPlan(runId, digest)`, `review`가 있고, CLI에는 같은 이름의 명령이 있다. **구현**
- 변경 비교는 다시 가린 비교만 내준다. 비교는 앱 계층의 `changes`가 만들고, CLI `changes`와 GUI가 이것을 쓴다. 어댑터는 스냅샷 저장 형식을 직접 읽지 않는다(DR-7). **구현**
- 프로세스 밖 어댑터용 줄 프로토콜(`--events jsonl`, `--confirm stdio`, AC-D7, AC-D8)은 **중단**(DR-20)이다. 연결되지 않았던 `src/cli/protocol/`은 지웠다(DR-66, U-81). `--cancel-file`은 `run`과 `apply`에 있다(실제 CLI, `--help`).

단계 4 엔진 변경([범용 작업](design/general-tasks.md) 4.3절, 이유는 [decisions.md](decisions.md) 3절). **구현**

| 번호 | 변경 |
| --- | --- |
| GT-E1 | 도구 묶음. 엔진은 task의 묶음만 모델에 제시하고 묶음 밖 호출은 `unknown_tool`이다 |
| GT-E2 | 작업 종류 지시문. 고정 시스템 문구 뒤에 붙여 가린 뒤 보낸다 |
| GT-E3 | 계획 단계. 읽기 도구와 `propose_plan`만 제시하고, 제안이 성공하면 `needs-input`/`plan_pending`으로 끝낸다 |
| GT-E4 | 완료 방식. `human_review`이면 자동 검증 통과 뒤 `needs-input`/`awaiting_review`로 끝낸다. `done`이 아니다 |
| GT-E5 | 도구 설명자의 `endsRun: "plan"` 속성. 엔진은 도구 이름으로 분기하지 않는다 |

계획 확인과 적용은 실행 사이에서 한다(GT-D4, GT-D13, DR-1). 아래 흐름은 실제 CLI로 확인했다(`examples/organize-demo`: `run` → `needs-input`/`plan_pending`, 행동 3 → `apply` → `done`/`verified` → `revert`로 셋 되돌림).

```
run (workflowRef: organize) → 계획 검증 → plan.json → needs-input/plan_pending(파일 그대로)
plan --run <id>                   plan.json을 다시 가려 행동 목록과 다이제스트를 보인다
apply --run <id> --digest <앞 12자 이상> [--allow-unsafe-move] [--cancel-file <f>]
  → 잠금 → 전 항목 사전 점검(어긋나면 plan_stale, 아무것도 옮기지 않음) → applied.json → 순서대로 이동·폐기
  → inventory 검증 → 새 runId(planRunId로 계획 실행을 가리킴)
revert --run <적용 runId>         이동을 되돌리고 보관함의 파일을 되살린다
```

- 엔진은 기다리지 않는다. 확인을 기다리는 동안 모델 연결과 잠금을 쥐지 않는다.
- `plan.json`에는 행동과 원본 해시, 그리고 계획 실행이 가린 행동의 표기(`shown`, DR-28)만 둔다. 정책, 검증기, 한도, 비밀 이름이나 값은 두지 않는다. 적용 때의 정책과 검증기는 그때의 사용자 설정과 task에서 읽는다(DR-5, `src/contracts/plan.ts`, 코드 기준). 작업 공간 안의 파일이 다음 실행의 정책·검증기를 정하지 못하게 하기 위해서다(S-1의 목적, R-1 M-4).
- 계획을 보이거나 적용할 때는 지금 가린 표기가 저장된 `shown`과 같아야 한다. 다르면 `plan_secrets_differ`로 보이지도 적용하지도 않는다(DR-28).
- 적용은 처음 행동 전에 계획 실행의 디렉터리에 `applied.json`을 배타적으로 만든다. 두 번째 적용은 `plan_already_applied`다.
- 하드 링크가 없는 드라이브에서 안전하게 옮길 수 없는 항목은 사람의 동의(`--allow-unsafe-move` 등) 없이는 옮기지 않고 `needs-input`/`consent_required`로 멈춘다(DR-21).
- `inventory` 검증기는 계획 대상의 해시와 나머지의 경로·크기 목록을 쓰고 자체 상한을 둔다(DR-6).
- 적용 단계에는 모델이 없으므로 재수정하지 않는다.
- 적용 취소의 끝 상태: 항목 사이의 취소는 `cancelled`/`cancelled`, 시간 한도는 `budget-exhausted`/`max_duration`이다. 한 것만 남고 되돌리기로 원래대로 된다(GT-U15).

## 5. 명령과 상태 디렉터리

명령의 사용법 줄은 실제 CLI의 `codaryn --help`로 확인했다. 옵션의 전체 목록은 `codaryn help <명령>`과 [CLI 계약](cli-contract.md)에 있다.

| 명령 | 하는 일 | 상태 |
| --- | --- | --- |
| `run` (`"<목표>"` \| `--task <f>` \| `--workspace <d> --goal <t>`) | 4절의 실행. 한 줄 목표는 현재 디렉터리를 작업 공간으로 쓴다(N-9). 간편 형식은 설정 파일의 정책·검증기를 쓴다(C-8). `--profile`(N-8), `--workflow <id>`(GT 4.2), `--cancel-file` | 구현 |
| `revert --workspace <d> --run <id\|latest>` | 잠금을 잡고 스냅샷으로 되돌린다. 현재 해시가 그 실행의 결과와 같은 파일만 되돌린다(R-7, T-10, T-12). `--dry-run`은 바꾸지 않고 되돌릴 것만 보인다(N-7). 적용 실행이면 이동을 되돌리고 보관함의 파일을 되살린다 | 구현 |
| `report [--workspace <d>] --run <id\|latest> [--json]` | result.json과 journal만 읽어 보고서를 만든다. 잠금을 잡지 않는다(U-5, X-2) | 구현 |
| `doctor [--config] [--vars-file] [--task \| --workspace] [--profile] [--json]` | 네트워크 없이 14개 항목을 점검한다(실제 CLI: `node_version`, `config_file`, `vars_file`, `task_file`, `api_key`, `model`, `limits`, `file_locations`, `commands`, `workspace`, `install_dir`, `integrity_paths`, `language`, `lock`). 키 값은 출력하지 않는다(U-6, W-5, X-1, X-3) | 구현 |
| `models [--provider <name>] [--json] [--use <번호\|id>]` | 제공자의 모델 목록 조회와 선택(Y-1~Y-4, SP-6). 키와 실제 접속이 필요하다 | 구현(가짜 서버 통합 `y01`, `o04`). 실제 API 미실행 |
| `init [--config] [--workspace] [--json]` | 기본 설정 위치에 설정 파일을 만든다. 키는 받지 않는다(N-2). 터미널에서는 제공자를 묻고 그 제공자의 형식으로 쓴다. 터미널이 아니거나 `--json`이면 예전과 같다(U-26, UXM-11, 코드 기준) | 구현 |
| `runs [--workspace <d>] [--limit <n>] [--json]` | 실행 목록(N-7, N-16). `--run latest`는 가장 최근 실행이다(N-18, N-23) | 구현 |
| `plan`, `apply`, `review` | 계획 보기, 승인한 계획의 적용, 사람 확인의 판정을 `review.json`에 기록(GT-D4, GT-D6). `review`는 결과 상태를 바꾸지 않는다 | 구현 |
| `changes (--task \| --workspace) --run <id\|latest> [--json]` | 다시 가린 변경 비교(DR-7, DR-14). 앱 계층을 거친다 | 구현 |
| `cleanup --workspace <d> [...] [--confirm <다이제스트 앞 12자 이상>] [--json]` | 오래된 실행 기록과 폐기 보관함의 정리. `--confirm` 없이는 미리보기만 하고, 폐기한 파일을 지우려면 `--delete-discarded`도 있어야 한다(DR-39, DR-9) | 구현 |
| `--help`, `help <명령>`, `<명령> --help`, `--version` | 도움말과 버전(U-7) | 구현 |
| `run --events jsonl --confirm stdio` | 프로세스 밖 어댑터용 줄 프로토콜(AC-D7, AC-D8) | 중단(DR-20) |

상태 디렉터리는 작업 공간 루트의 `.codaryn/`이다. 파일 도구는 이 안을 읽거나 쓸 수 없다. 아래 가운데 `실제 CLI` 표시가 있는 이름은 organize 예시(run → apply → revert)와 분석 실행(`write_file`로 기존 파일 수정 → `review --accept`) 뒤에 실제로 생긴 것이다. 나머지는 코드 기준이다(`src/contracts/journal.ts`, `changes.ts`, `plan.ts`, `state.ts`, `cleanup.ts`, `workflow.ts`).

```
.codaryn/
  .gitignore              "*" (Git 추적 제외, 이미 있으면 덮어쓰지 않음)                   실제 CLI
  lock.json               {pid, runId, startedAt, processStartedAt}. 명령이 잠금을 쥔 동안에만 있다(N-25 (b))
  lock.json.reclaim       죽은 잠금을 회수할 때 쓰는 파일(T-9)
  runs/<runId>/
    journal.jsonl         가림본 사건 기록(추가 전용)                                        실제 CLI
    result.json           EngineResult 또는 적용 결과(가림본)                                 실제 CLI
    snapshots/            쓰기 전 원문(평문) <n>.orig, index.json,                           실제 CLI
                          경로를 어떻게 가렸는지의 다이제스트 shown-<n>.json(DR-29, DR-32 (c))
    plan.json             계획의 행동, 원본 해시, 가린 표기(DR-5, DR-28). 로컬 원문            실제 CLI
    applied.json          계획 실행의 디렉터리에. 적용이 시작됐다는 표시                         실제 CLI
    revert.json           마지막 되돌리기의 기록(N-7)                                        실제 CLI
    review.json           사람 확인의 판정(GT-D6)                                           실제 CLI
    records-changed.json  실행 밖에서 기록이 바뀌었다는 표시(DR-38)
  discarded/<runId>/      적용 실행이 폐기한 파일의 보관함. 실행 디렉터리 밖이라 기록을 정리해도 남는다.  실제 CLI
                          revert가 되살린다. 지우려면 cleanup --confirm과 --delete-discarded(DR-9, DR-39)
  parked/<revert runId>/  되돌리기가 옆으로 옮겼다가 제자리에 돌려놓지 못한 파일(R-16 L-1). 자동으로 지우지 않는다
  cleanup.jsonl           정리 한 번에 한 줄. 지운 것의 개수와 크기만, 이름이나 경로는 없다
  cleanup-<16 hex>/       정리가 지우다 남긴 폴더. 안에 cleanup-leftover.json 표시가 있다(R-34b P-2)
```

종료 코드와 출력 형식은 [CLI 계약](cli-contract.md)이 기준이다.

## 6. 모델 제공자(`src/model`)

- [확정] 첫 제공자는 Anthropic이다. 두 번째 제공자 OpenAI는 DR-31로 들였다([두 번째 제공자](design/second-provider.md)).
- [선택] 공식 SDK가 아니라 **Node 내장 `fetch`로 직접 호출한다**(C-7). 근거:
  - 허용 의존성 목록을 넓히지 않는다.
  - 유닛 시험에서 전송을 바꿔 끼울 수 있다.
  - 엔진이 반복을 소유하므로 SDK의 tool runner가 필요 없다.
  - 단계 0의 "공식 SDK" 서술(decisions.md M-5)을 대체한다.
- 제공자 고르기: task 파일의 `model.provider`. 간편 형식에서는 고른 프로필의 `provider`, 설정 파일의 `provider`, 둘 다 없으면 `anthropic`이다. 제공자의 설정은 `providers.<name>`에서 읽고, `anthropic`은 예전처럼 최상위 필드도 읽는다(SP-D3, SP-D10, DR-31. `src/contracts/config.ts`, 코드 기준).

공통 전송(`src/model/http/index.ts`, SP-3. Anthropic 어댑터에서 옮겼다)
- 요청마다 시간 한도가 있다(`requestTimeoutMs` 기본 600000). 리디렉션은 따르지 않는다.
- 본문 상한은 성공 8 MiB, 오류 4096바이트다(S-10). 넘는 성공 본문은 `malformed_response`다.
- 재시도는 `maxRetries`(기본 2, 최대 10)회다. 연결 오류는 알려진 연결 코드가 있을 때만 연결 실패로 보고 재시도한다.
- 대기: 지수 대기 0.5초부터 두 배씩, 8초 상한. `retry-after`를 읽는 방식은 제공자마다 다르다(아래).
- 메시지는 잘라서(300자) 키 전체, 키의 8자 조각, 키 모양을 지운 뒤에만 내보낸다(S-12). 전송 오류의 글은 옮기지 않고 고정 문구와 허용한 코드만 쓴다.
- 키는 출력 가능한 ASCII(0x21~0x7E)만 허용한다(S-11). 이 검사는 실행 전 단계가 아니라 제공자 안에서 요청 전에 한다(A-1, 코드 기준).
- 주소는 https만 허용한다(루프백만 http). 사용자 정보, `?`, `#`가 있으면 거부한다(S-9). 경로 규칙은 제공자마다 다르다(`API_PROVIDERS`의 `baseUrlPath`). task로는 바꿀 수 없다(C-5).
- 모델 id는 task `model.model` → 제공자의 모델 변수 → 설정 파일 순이다. 코드 기본값은 없고, 없으면 실행 전 `provider_not_configured`다(C-4).
- 시간 초과한 POST를 같은 본문으로 다시 보낸다(중복 처리 가능성, 한계로 기록).
- 모델 오류의 재시도 가능 여부(`modelErrorRetryable`, U-55)는 어댑터의 분류에서 정한다. HTTP 상태가 없는 연결 실패는 지금 "알 수 없음"이다. 전송 층의 재시도 판정을 모델 결과에 `retryable`로 남기는 일은 DR-68로 정했고 아직 병합되지 않았다(U-82).

Anthropic(`src/model/anthropic/index.ts`)
- 요청
  - `POST {apiBaseUrl}/v1/messages`. 주소는 `/v1`로 끝나면 거부한다(`without_version`). 기본 주소 변수는 `CODARYN_API_BASE_URL`이다.
  - 헤더는 `content-type`, `x-api-key`, `anthropic-version`이다. 키는 `x-api-key`에만 넣는다.
  - 본문은 `model`, `max_tokens`, `system`, `messages`, `tools`다. `tools`는 엔진이 이 요청에 제시한 도구(task의 도구 묶음)의 정의다.
  - 스트리밍, thinking 설정, `tool_choice`, 캐시 지시는 보내지 않는다. `anthropic-workspace-id`는 보내지 않는다(A-4).
  - `anthropic-version` 값은 코드 상수다. 실제 호출로 확인한 값이 아니다.
- 응답
  - thinking 블록은 검사 후 버리고 다음 요청에 되돌려 보내지 않는다.
  - 사용량은 입력(캐시 토큰 포함)과 출력이다. 사용량이 없고 토큰 한도가 있으면 실행이 `budget-exhausted`/`usage_unknown`으로 끝난다.
- 재시도 대상은 429, 408, 409, 5xx, 시간 초과, 연결 오류다. `retry-after`는 60초까지 따르고, 없으면 지수 대기다. 401·403과 다른 4xx는 재시도하지 않는다.
- 키는 `ANTHROPIC_API_KEY` 환경 변수(또는 `--vars-file`)로만 받는다. 파일 속 키는 거부한다(C-1).
- 모델 변수는 `CODARYN_MODEL`이다. `maxOutputTokens`는 Anthropic 실행에 필수다(상한 200000, T-14). Anthropic 실행에는 토큰 한도도 있어야 한다.
- 모델 목록은 `GET /v1/models`의 모든 쪽을 같은 전송으로 읽는다(Y-1).

OpenAI(`src/model/openai/index.ts`, SP-5, DR-31. 코드 기준)
- 요청
  - `POST {apiBaseUrl}/responses`. 주소에 `/v1`이 들어 있어야 한다(`with_version`). 주소 변수는 `CODARYN_OPENAI_API_BASE_URL`이다.
  - 키는 `authorization: Bearer` 헤더에만 넣는다. 조직·프로젝트 헤더는 보내지 않는다.
  - 본문은 `model`, `instructions`(시스템 글), `input`, `tools`(평평한 함수 도구, `strict: false`), `max_output_tokens`, `store: false`다. `maxOutputTokens`가 없으면 `max_output_tokens`를 보내지 않는다.
- 저장하지 않는 응답이라 다음 요청에 앞선 응답의 `output` 항목(추론 항목 포함)을 그대로 돌려보내야 한다. 제공자 객체가 한 실행 동안 메모리에 두고 상한(`MAX_KEPT_OUTPUT_BYTES`)까지 보낸다(DR-35 (d)). 이 항목은 엔진, 기록, 결과, 보고서에 닿지 않는다. 엔진은 추론 항목의 개수만 본다.
- 호출 id: `call_id`가 안전한 id 규칙(AC-D15)을 통과하면 그대로 기록한다. 엔진이 다른 id로 기록하면 제공자가 메모리 안에서 원래 `call_id`로 짝을 맞춘다(DR-31 (e), DR-35 (c)).
- 종료: `completed`이고 `function_call`이 있으면 도구 호출, 없으면 끝. `max_output_tokens` 때문의 `incomplete`는 길이 초과다. 거절과 `content_filter`는 고정 문구의 `api_error`다(거절 글은 인용하지 않는다).
- 오류: 401·403은 고정 문구의 `auth_failed`다(DR-35 (a)). 429는 할당량 소진이면 `quota_exhausted`(재시도 안 함), 아니면 `rate_limited`(재시도). 503은 `overloaded`, 408·409·그 밖의 5xx는 `api_error`이고 재시도한다.
- `retry-after`는 최소 대기다. 60초를 넘으면 기다리지 않고 멈춘다(DR-31 (f)).
- 키는 `OPENAI_API_KEY`, 모델 변수는 `CODARYN_OPENAI_MODEL`이다. 모델 목록은 `GET {apiBaseUrl}/models`를 한 번 읽는다.
- 알려진 한계: 모델의 앞선 호출 인자를 가림 없이 그대로 돌려받는다(Anthropic 쪽은 가려진다. pm-status CP-20).

대본 제공자(`scripted.ts`)
- 단계별 응답을 순서대로 돌려준다.
- 키 없이 전 과정을 실행하는 오프라인 검증의 기본 수단이다.

구독 계정은 API 자격증명이 아니다. 키가 없으면 호출하지 않는다.

## 7. 경계

**문맥.**
- 모델에 가는 것은 목표, 도구 결과, 검증 근거, 고정 문구와 작업 종류 지시문뿐이며 모두 가림본이다.
- 크기 상한이 있다.
  - 명령 출력: 스트림당 65,536바이트(여유 4,096바이트 더 받아 가린 뒤 자름)
  - 검증 근거: 8,192바이트
  - 재수정 메시지: 별도 상한
  - 검색 줄: 1,000자
- 잘렸으면 잘렸다고 표시한다. 문서와 도구 출력은 자료이며 권한을 넓힐 수 없다.
- 긴 대화의 요약·압축은 없다. [미정]

**변경.**
- 모든 쓰기는 `write_file`을 거친다. 읽을 때의 해시(`expectedHash`)와 현재 해시가 다르면 `conflict`로 쓰지 않는다. 쓰기는 원자적이다.
- 쓰기 전 원문은 `snapshots/`에 둔다. 평문이며, 자동 삭제가 없고, 파일 도구로는 닿지 않는다. 다만 허용된 명령은 읽을 수 있다(R-6, R-8, T-11). `cleanup`으로 실행 기록째 지울 수 있다.
- `codaryn revert`가 이 원문으로 되돌린다. 자동 롤백은 없다.
- 단계 4의 파일 이동·폐기(GT-D4, GT-D5). **구현**
  - 모델은 계획만 제안하고 적용기가 실행한다.
  - 대상이 이미 있으면 덮어쓰지 않고 계획 검증에서 거부한다.
  - 폐기한 파일은 실행 디렉터리 밖 `.codaryn/discarded/<runId>/` 보관함에 평문으로 남는다(DR-9).
  - 실행 기록 정리는 보관함의 파일이 남아 있는 적용 실행의 기록을 지우지 않는다(U-13). 보관함 정리는 따로 확인한다(`--delete-discarded`). 기록을 지우려다 사용자 파일(폐기한 원본)을 영구히 지우는 일을 막는다(R-1 M-8).

**민감정보.** [확정] 전송 전 가역 치환과 로컬 복원.
- 구현 규칙은 [privacy.md](privacy.md)에 있다.
- 게이트는 하나다. 모델로 가는 내용과 기록으로 가는 내용이 모두 이 게이트를 지난다.
- 대응표는 실행 단위 메모리에만 있다.
- 복원은 도구가 선언하고 정책이 허용한 필드(경로·cwd)만 한다. 명령 인자와 환경은 복원하지 않는다.
- 문서 내용은 토큰이 든 줄을 그대로 두는 원위치 규칙으로만 다시 쓴다.
- 어댑터와 단계 4
  - 어댑터 이벤트는 가림본이다. 화면에 내기 전에 어댑터가 제어 문자를 정리한다(AC 5.2).
  - 모델이 준 도구 이름과 호출 id는 엔진이 기록할 때 제한한다(AC-D15, 4.3). **구현**
  - 변경 비교는 다시 가린 비교만 보인다. CLI와 GUI가 같다(DR-7). 스냅샷 원문을 어댑터 화면이나 편집기로 열지 않는다.
  - GUI의 파일 보기(DR-72, U-174·U-184)는 앱 계층이 지금 가린 글만 그린다. 가리면 글이 달라지는 파일은 읽기 전용이라, 고칠 수 있는 파일은 화면의 글과 파일의 글이 같다. 등록 값이나 키 모양이 든 새 글은 저장하지 않는다(`text_refused`). 화면은 경로를 보내지 않고 메인이 준 항목 id와 편집 토큰만 쓴다. 코드 기준.
  - 계획 보기도 다시 가린 표기가 저장된 것과 같을 때만 보인다(DR-28).
  - 자료 분석(`analyze`)이 `read_file`로 읽은 표는 원자료 행이 모델로 간다. 가림은 등록한 비밀 값에만 적용된다. 그래서 개인정보가 든 표는 읽기 제외 경로 아래에 두고 `analyze-private`로 다룬다. 모델은 `query_table`의 집계만 받는다(GT-D8 (b), 사용자 확정 DR-23, DR-70. [민감정보 처리](privacy.md) 15절).
  - 확인 질문의 글은 화면에 보이려고 복원하지 않는다(AC 5.7). 확인 질문 자체가 아직 없다(DR-3).

**도구 실행(`src/tools/command-runner.ts`).**
- 자식 환경
  - 허용 목록 11개 이름(`CHILD_ENV_ALLOWLIST`)만 넘긴다.
  - 값에 등록 비밀이 든 변수는 뺀다(T-1). 단 Windows에서 libuv가 스스로 넣는 변수는 예외다.
- 실행 파일 해석(Windows)
  - 자식 환경의 PATH와 PATHEXT로 찾는다. 작업 디렉터리와 상대 PATH 항목은 찾지 않는다.
  - 실행 파일이 작업 공간 안으로 풀리면 실행하지 않는다(T-4).
  - `.cmd`·`.bat`는 작업 공간 밖에 있고 인자가 좁은 문자 집합일 때만 `cmd.exe /d /s /c`로 실행한다(G1).
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

**쓰기 허용 경로(`writablePaths`, `src/policy/path-set.ts`, DR-69).** U-182·U-186·U-183, 병합 `a1d5c65`. 계약은 [cli-contract.md](cli-contract.md) 13.1이다.
- `policy.writablePaths`가 있으면 파일 도구의 쓰기와 계획 동작은 목록 안이어야 한다. 밖이면 권한 `path`, 코드 `path_not_writable`로 거부한다. 읽기와 검색은 막지 않는다.
- 목록은 원천마다 따로 남는다(`writablePathSets`: 설정, 프로필, 작업 종류 정의, task). 하나로 합치지 않는다. 링크를 풀면 글자로 만든 교집합이 원래 목록보다 넓어질 수 있기 때문이다. 설정과 프로필의 목록은 task 파일 실행에도 걸린다.
- 판정은 링크를 푼 경로로 하고, 쓸 수 없는 항목은 아무것도 덮지 않는다(fail closed). 보호 경로가 먼저 보고된다.
- 실행(`assembleRun`)과 적용(`runApply`)의 게이트, 앱 계층의 조립과 적용 점검(U-186)이 같은 목록을 받는다.
- 명령은 묶지 않는다(B-8). 그래서 보호 경로처럼 실수 방지 수준이다. 목록과 명령 규칙이 함께 있으면 `doctor`가 주의를 낸다.
- 앱 계층의 설정 변경은 목록에 없던 항목(옛 항목 안의 항목도)과 목록 삭제를 넓히기로 본다(U-183, Codex V-8). GUI의 설정 화면에는 이 목록을 고치는 편집이 없고, 넓히기 확인 대화상자는 두 종류에 이름을 붙인다(U-192, 병합 `111e25d`. 코드 기준).
- 게이트가 판정한 실경로와 도구가 다시 푼 실경로가 다르면 그 호출은 아무것도 하지 않는다(U-189, `policy_denied`). 그러나 도구가 경로를 푼 뒤의 폴더 바꿔치기는 쓰기에서 닫지 못한다(DR-73, [cli-contract.md](cli-contract.md) 10절, [privacy.md](privacy.md) 13절).

**읽기 제외 경로(`unreadablePaths`, `src/cli/unreadable.ts`, `src/policy/path-set.ts`, DR-69·DR-70).** U-203·U-208·U-210·U-237, 병합 `8b4e204`. 계약은 [cli-contract.md](cli-contract.md) 13.2다.
- 그 아래의 파일 도구 읽기·쓰기와 목록의 시작은 권한 `path`, 코드 `unreadable_path`로 거부한다. `search_files`와 `inspect_files`는 그 아래 항목을 세기 전에 이름째 뺀다. 그 아래 표는 `query_table`(경로 접근 `aggregate`)만 집계한다.
- 형식과 판정은 보호 경로와 같다(어휘 경로와 실경로, 쓸 수 없는 항목은 모두를 덮음). 목록은 원천마다의 항목을 합친다. 설정 파일과 프로필의 항목은 task 파일로 실행해도 걸린다.
- `query_table`은 그 아래 표에 count·sum·mean만 받고, k행 미만 묶음과 k칸 미만으로 만든 값을 뺀다. k(`minGroupSize`)는 5~1,000이고 원천들의 가장 큰 값이다.
- 게이트, 도구 실행기, 검증기 실행기(`data_checks`의 근거에 그 표의 수를 쓰지 않음, U-223), 무결성 대상이 모두 `runGuards`에서 목록과 k를 받는다. 실행, 이동 계획의 적용, 승인된 계획을 수행하는 실행이 같고(R-108 H-1), 앱 계층의 조립도 CLI의 것이다(R-108 H-2, U-237).
- 명령과는 함께 둘 수 없다(R-5). 명령은 어떤 파일이든 읽을 수 있기 때문이다. 그래서 보호 경로나 쓰기 허용 경로와 달리 이 막음은 명령으로 우회되지 않는다.
- 사람의 화면(변경 보기, GUI의 파일 보기)과 `revert`는 읽기 제외를 보지 않는다. 막는 대상은 모델로 가는 것이다(PM 결정, [민감정보 처리](privacy.md) 13절).
- 앱 계층의 설정 변경은 항목 빼기와 k 낮추기를 넓히기로 본다(U-204). GUI에는 이 목록을 고치는 편집이 없다.
- 보장은 행을 보내지 않는다는 것이다. 여러 질의의 차로 작은 묶음을 알아내는 것은 막지 않는다(제안서 Q-8).

**상태 디렉터리(DR-38).**
- 파일 도구는 상태 디렉터리를 쓸 수 없지만, 허용된 명령, 명령 검증기, 그들이 남긴 자식은 쓸 수 있다.
- 그래서 엔진은 명령마다, 검증 회차마다, 끝에 상태 디렉터리의 지문을 비교한다. 실행 자신이 쓴 것 말고 바뀐 것이 있으면 4.3의 7처럼 끝낸다.
- 사후 탐지이고 실행 자신의 명령만 덮는다. 실행 앞뒤의 같은 사용자 다른 프로세스는 알려진 한계다(DR-37 (b)). 실행이 끝난 뒤의 기록 변조는 감지하지 못한다.

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
  - 잠금에는 프로세스 시작 시각(`processStartedAt`)이 있다. pid가 살아 있어도 시작 시각이 다르면 다른 프로세스에 재배정된 것으로 보고 죽은 잠금으로 다룬다. 시작 시각을 알 수 없으면 예전처럼 pid만으로 판정한다(N-25 (b), `src/store/lock.ts`, 코드 기준).
  - 죽은 실행의 잠금이 남으면 `--run latest`가 `run_in_progress`, 새 실행이 `workspace_locked`로 막히는 경우가 하나 있다(알려진 한계, pm-status CP-20).
- **충돌**: 쓰기 직전 해시 비교. 사용자 변경을 덮어쓰지 않는다.
- **취소**
  - SIGINT·SIGTERM과 `--cancel-file`(작업 공간 밖) 두 경로가 있다(P-2). `run`과 `apply`에 있다.
  - 모델 요청을 끊고 자식 트리를 끝낸다. 상태는 `cancelled`다.
  - 적용된 변경은 유지하고 되돌리기는 `revert`로 한다.
  - 적용기도 같은 신호로 항목 사이에서 멈추고 한 것을 기록한다(GT-U15, 4.4).
  - 앱 계층과 GUI의 취소는 `handle.cancel()`로 모인다. CLI는 앱 계층을 거치지 않는다(AC-D9). **일부**
  - 사전 검사 중 취소와 질문 대기 중 창 닫기의 기록이 어댑터마다 다를 수 있다(R-1 L-2). [미정]

## 10. 범위와 남은 위험

- **범용 계약**: 코딩, 작은 문서 작업(통합 `a02`), 파일 정리(`n06`), 자료 분석(`n07`), 등록만으로 작업 종류 추가(`n08`)로 확인했다. 엔진 변경은 GT-E1~GT-E5 한 번이다. P1 묶음 가운데 Markdown 규칙, `writablePaths`, 묶음 B의 실행 계획(CLI와 GUI), 묶음 A(읽기 제외 경로, `query_table`, `analyze-private`)가 쓰인다.
- **민감정보**
  - 등록한 값과 정해진 변형만 정확 일치로 가린다. 다른 인코딩(UTF-16 등)이나 임의 변환은 놓친다.
  - 모델이 실행한 코드는 원문을 읽고 변환해 내보낼 수 있다.
  - 자료 분석이 `read_file`로 읽은 표는 원자료 행이 모델로 간다(7절). 읽기 제외 아래 표는 집계만 가지만, 여러 질의의 차로 작은 묶음을 알아낼 수 있다(7절 "읽기 제외 경로").
- **자기 개발**: 무결성 확인은 사후 탐지이며 OS 격리가 없다. 실제 모델 실행 전이다.
- **실제 API**: 두 제공자의 연결 코드는 모의 서버로만 확인했다. 503 분류, `retry-after` 형식, thinking 블록·추론 항목, 시간 초과 뒤 재전송은 실제 호출 점검에서 확인할 항목이다. OpenAI용 실제 호출 점검 스크립트는 없다.
- **GUI**
  - 독립 GUI는 구현했다(DR-20, DR-26). 남은 설계 항목은 GUI 대조 조사(DR-63)의 순서로 U-60~U-70에서 한다.
  - 설치 패키지와 코드 서명은 없다(GU-9). 새 개발 의존성과 내려받기는 지금 승인하지 않았고, 기능이 끝난 뒤 다시 묻는다(DR-67).
  - 어댑터는 같은 엔진을 쓰므로 위의 민감정보·격리 한계를 그대로 가진다.
  - 파일 보기(DR-72)는 병합 `111e25d`에 있다. 저장하지 않은 글이 있을 때의 창 닫기, 실제 OS 대화상자, 실제 한글 입력기는 자동 시험이 닿지 않아 [수동 점검](manual-checks.md) M-3.12~M-3.17이 맡는다(U-205).
  - VS Code 확장은 만들지 않는다(DR-20).

## 11. 결정 필요

| 번호 | 선택지 | 권고 | 지금(main `f8fb993`) |
| --- | --- | --- | --- |
| A-1 | 키 형식 검사(S-11)를 실행 전 단계로 올릴지. 지금은 잠금·journal을 만든 뒤 실패한다 | 올린다. run 사전 단계와 doctor에서 같은 함수로 검사해 실행 디렉터리를 만들지 않는다 | 없음. 검사는 제공자 안에 있다(코드 기준) |
| A-2 | 무결성 계약에 `run_end` 단계를 둘지. W-1 종료 점검이 `before_verify`/`after_verify` 이름으로 기록돼 report에서 구분되지 않는다 | 둔다(계약 담당). 기록 해석이 명확해진다 | 없음. `INTEGRITY_PHASES`에 `run_end`가 없다(상태 디렉터리 점검에는 있다) |
| A-3 | 계약 주석 `src/contracts/integrity.ts`의 링크 설명이 W-2 구현과 다르다 | 계약 담당이 주석을 W-2에 맞춘다 | 해소(U-275) |
| A-4 | `anthropic-workspace-id` 헤더. 작업공간에 묶이지 않은 키에는 필요하다는 외부 문서 확인(decisions.md 4절)이 있다 | 실제 호출 점검에서 필요 여부를 보고, 필요하면 설정 필드로 추가한다 | 확인 불가(실제 API 필요) |
| A-5 | 스냅샷 수명. 자동 삭제가 없고 평문이다(R-8) | report와 doctor에 크기·위치 안내를 넣고, 정리 명령은 UX 설계와 함께 정한다. 폐기 보관함은 실행 기록과 따로 정리한다(DR-9) | 일부. `cleanup`은 있다. report·doctor의 크기·위치 안내는 없다 |
| A-6 | 잠금의 pid 재사용 오판(W-4 조사) | 잠금에 프로세스 시작 시각을 더한다 | 해소(N-25 (b), 9절) |
| A-7 | 계획 승인의 통로. 어댑터 계약 5.7(실행 중 `plan` 질문)과 범용 작업 GT-D4(실행 사이 확인)가 둘 다 채택됐다 | 실행 사이 확인 하나 | 해소(DR-1). 확인 질문은 권한 확인 전용이고, 앱 계층에 계획 보기·`applyPlan`·`review`를 둔다 |
