# GUI 설계 대 구현 조사 — `docs/design/standalone-gui.md` 대 main 2ee6c0b

```
페르소나: GUI 개발자(주), 보안·개인정보 검토자(보조)
기준: main 2ee6c0b (worktree를 그 커밋에 detached로 두고 읽음). 코드 수정 없음
방법
  - 설계 문서 947줄(1~16절)을 처음부터 끝까지 읽었다.
  - 항목마다 gui/src의 코드(파일·함수·문구 id)와 gui/tests(유닛 파일, 연기 시험 검사 이름)를 grep과 읽기로 맞대었다.
  - 앱 계층(src/app/types.ts의 CodarynApp)과 계약(src/contracts)은 GUI가 기대는 함수가 있는지만 보았다.
수치는 돌리지 않았다(조사 단위). main 2ee6c0b의 수치는 U-54 보고와 PM 확인분: 유닛 193/193, 연기 191/191
```

## 표기

| 판정 | 뜻 |
|---|---|
| **구현됨** | 설계대로 있고 시험이 있다 |
| **일부** | 핵심은 있으나 설계의 일부가 없다 |
| **없음** | 코드가 없다 |
| **낡음** | 설계 문서의 서술이 지금 main과 맞지 않는다. 설계를 고칠 일이다 |
| **다름** | 구현이 설계와 다르게 갔고, 어느 쪽으로 맞출지 결정이 필요하다 |
| **환경 밖** | 이 환경에서 할 수 없다. 외부 네트워크, 새 의존성, 인증서, 사람의 수동 점검, 다른 OS가 필요하다 |

- 시험 이름은 유닛 시험 파일(`gui/tests/unit/*.test.ts`)이나 연기 시험 검사 이름(`scripts/build/smoke.mjs`의 `[이름, 판정]`)이다.

## 요약

| 판정 | 1~5절 표의 줄 수 | 비고 |
|---|---|---|
| 구현됨 | 66 | |
| 일부 | 18 | |
| 없음 | 27 | 그중 8줄은 앱 계층·엔진 함수를 기다리는 네 기능이다(작업 공간 목록, 적용 전 점검, 실행 사건 목록, 실행 중 권한 확인). 1절(화면)과 2절(5절 표)에 두 번씩 들었다. GUI만으로 할 수 있는 없음은 19줄이다 |
| 낡음 | 3 | 표의 줄. 문서에서 고칠 곳은 7절에 11곳으로 모았다 |
| 다름(결정 필요) | 2 | 3.1 실행 목록 위치, 보안 시험의 자리(8.1·GU-8) |
| 환경 밖 | 11 | 6절 목록과 같은 것 |

- 셈은 보고서의 표를 스크립트로 세었다. 한 설계 항목이 여러 줄이면 여러 번 센다.

- 3절(화면)의 큰 흐름은 다 있다: 열기, 트리, 비교, 새 작업, 진행·취소, 결과, 실행 목록, 되돌리기, 정리, 계획, 사람 확인, 설정, 첫 실행.
- 4·6절(프로세스, 보안)은 거의 다 구현·시험되어 있다.
- 빠진 것은 주로 다음 셋이다.
  - **편의 기능**: 명령 찾기, 복사, 다음 행동 단추 일부, 나란히 보기, 트리 변경 표시, 창 상태 기억.
  - **앱 계층 함수를 기다리는 것**: 작업 공간 목록, 적용 전 점검, 실행 사건 목록, 실행 중 권한 확인.
  - **GU-9 패키징 전부.**

## 1. 화면(3절)

| 절 | 설계 항목 | 판정 | 근거(코드 / 시험) | 빠진 것 |
|---|---|---|---|---|
| 3.1 | 창 하나, 왼쪽 파일 트리, 작업 영역, 아래 상태 표시줄 | 일부 | `renderer/shell/shell.ts`(header·nav·files·work·footer), `renderer/app.ts` / 연기 `initialTree`, `url` | 끌어서 바꾸는 경계 |
| 3.1 | 왼쪽 아래 실행 목록 패널 | **다름** | 실행 목록은 위 메뉴의 한 화면(`runs/runs-screen.ts`)이다 | 패널로 둘지, 설계를 지금 배치로 고칠지 결정 |
| 3.1 | 창 제목은 폴더 이름만 | 구현됨 | `shell.ts:91` `document.title` | — |
| 3.2 | 열기(Ctrl+O, OS 대화상자) → 작업 공간 핸들 | 구현됨 | `main/workspaces.ts`, `main/handles.ts`, `shell.ts` Ctrl+O / `workspaces.test.ts`, 연기 `initialWorkspace`, `secondOpened` | — |
| 3.2 | 최근 폴더(20개, 빼기, 찾을 수 없음) | 구현됨 | `main/gui-state.ts` `MAX_RECENT = 20`, `workspace/home.ts` / 연기 `recentShown`, `recentNames`, `stateFile` | — |
| 3.2 | 명령줄 인자, 단일 인스턴스 | 구현됨 | `main/cli-args.ts`, `main/app.ts`(`requestSingleInstanceLock`, `second-instance`) / `workspaces.test.ts`(command line) | — |
| 3.2 | UNC·장치 경로 거절(R10b-L-2) | 구현됨 | `main/workspaces.ts` / `workspaces.test.ts`, 연기 `networkFolder` | — |
| 3.2 | 열 때 점검으로 미리 검사(막음·경고 카드) | 일부 | 점검 화면(`checks/checks.ts`)은 핸들로 `doctor`를 부른다 / 연기 `checks`, `checksShown` | 열 때 자동으로 점검하지 않는다. "더 좁은 폴더를 고르세요" 카드가 없다 |
| 3.2 | 잠금 중이면 알리고 새 작업 단추 끔 | 없음 | 실행할 때 `workspace_locked` 오류 글만 있다 | 열 때 잠금 표시, 새 작업 끄기 |
| 3.2 | 작업 공간 고지(제공자 이름) | 구현됨 | `run/new-task.ts` `task.notice`(`{provider}`), `home.notice` / `new-task.test.ts` | — |
| 3.2 | 자료 분석의 개인정보 원자료 안내(DR-23) | 없음 | 문구 없음 | 분석 작업 종류일 때 한 줄 |
| 3.2 | 작업 공간을 바꾸면 핸들·항목 id·토큰을 버림 | 구현됨 | `main/tree-ids.ts` `forget`, `main/handles.ts` `clear` / `workspaces.test.ts`, `tree-host.test.ts` | — |
| 3.3 | 트리: 한 단계씩, 500개 쪽, 링크 표시, `.codaryn` 열지 않음, 가린 이름은 열 수 없음 | 구현됨 | `engine-host/tree.ts`(`TREE_PAGE_SIZE = 500`), `workspace/tree-model.ts`, `tree-view.ts`, `main/tree-ids.ts` / `tree-host.test.ts`, `tree-model.test.ts`, 연기 `expanded`, `keyboard`, `treeText`, `treeUnknownNode` | — |
| 3.3 | 트리를 앱 계층 작업 공간 목록 함수로, 등록한 가릴 값(`secretEnv`)도 가림 | 없음(임시) | 엔진 호스트의 임시 읽기(`tree.ts` 머리말: secretEnv는 가리지 않음) | **앱 계층 함수가 필요하다** |
| 3.3 | 고른 실행의 변경 표시(만듦·바꿈·옮겨 옴·보관함으로), 보호 표시 | 없음 | — | `changes`와 설정의 `protectedPaths`로 표시 |
| 3.3 | 바뀐 파일을 고르면 비교로, "상대 경로 복사" | 없음 | — | |
| 3.3 | "탐색기에서 보기"(항목 id로만) | 구현됨 | `main/ipc.ts`(`showItemInFolder`), `tree-view.ts` / 연기 `revealUnknown` | — |
| 3.3 | 새로 고침(F5), 실행 끝 뒤 한 번 다시 읽기 | 없음 | 트리는 작업 공간을 열 때만 읽는다(`app.ts:39`) | |
| 3.4 | 다시 가린 비교(DR-7), 파일마다 상태·이유, 줄 비교, F7·Alt+F7 | 구현됨 | `changes/changes-screen.ts`, `diff/line-diff.ts`, `engine-host/plans.ts` `changesValue` / `changes.test.ts`, `u48-…`, 연기 `reportDiff`, `reportF7`, `changesPerFile*`, `changesRecordsChanged` | — |
| 3.4 | 나란히 보기, 줄 바꿈 켜기·끄기 | 없음 | 한 줄 보기만 있다 | |
| 3.4 | 적용 실행은 "어디서 어디로"·"보관함으로" 목록 | 일부 | 보고서의 동작 탭(`report-screen.ts`)에는 있다. 변경 화면은 `applyRun`(U-16)을 보이지 않는다 | 변경 화면에 적용 실행 안내 |
| 3.4 | 비교 화면의 "탐색기에서 보기", 변경 파일 항목 id | 없음 | — | |
| 3.5 | 간편 형식 실행(작업 종류·프로필, 모델 보기 전용, 고급은 보기 전용) | 구현됨 | `run/new-task.ts`(`task.model`, `task.advanced`) / `new-task.test.ts`, `run-forms.test.ts`, `taskform.test.ts` | — |
| 3.5 | 마지막 작업 형태를 작업 공간별로 | 구현됨 | `gui-state.ts` `lastForm`, `new-task.ts:68` | — |
| 3.5 | task 파일로 실행, 변수 파일(GUI-D8) | 없음 | — | 메인의 파일 대화상자 2개, `startTaskRun` 통로 |
| 3.5 | 실행은 앱 전체에서 하나, 실행 중 새 작업 끔 | 구현됨 | `task.busy`, 엔진 호스트 `run_active` / 연기 `secondStartRefused` | — |
| 3.5 | 목표 원문 저장 안 함, 같은 세션에서만 다시 채움 | 구현됨 | `new-task.ts:75`(`run.last.goal`, 메모리만) | — |
| 3.6 | 진행: RunEvent → CLI 문장, 100 ms 묶음, 빠진 기록 안내, 거르기 | 구현됨 | `engine-host/runs.ts`, `engine-host/main.ts` `runItems`, `run/run-screen.ts`, `run-model.ts` / `runs.test.ts`, 연기 `runLog`, `runCounts`, `firstRunDenied`, `failedAfterDenial` | — |
| 3.6 | 상태 표시줄(누르면 실행 화면) | 구현됨 | `shell.ts:28,48` `status-run` | 턴/한도 형식은 간단함 |
| 3.6 | 작업 표시줄 진행 중 표시, 끝 알림(비활성일 때만, 고정 문구) | 구현됨 | `main/app.ts`(`setProgressBar`, `Notification`) / 연기 `endNotice`, `endNotices` | — |
| 3.6 | 취소(준비 중 끔, 화면 안 확인, 기본 "계속 실행", Esc 안 씀) | 구현됨 | `run-screen.ts` / 연기 `cancelReady`, `cancelAsked`, `cancelDone` | — |
| 3.6 | 창 닫기: 묻고 취소 뒤 최대 10초 대기 | 구현됨 | `main/app.ts` / 연기 `closeGuard`, `closeRequestArrived` | — |
| 3.6 | 실행 중 권한 확인 패널(AC 5.7, DR-3) | 없음 | 앱 계층 `RunObserver.confirm`은 선언만 있다. 엔진이 부르지 않는다(`src/app/types.ts:263` "until then never called") | **엔진·앱 계층이 먼저(단계 5)** |
| 3.7 | 결과·보고서 탭: 요약·검증·변경/동작·보호 대상·사용량·사람 확인 | 구현됨 | `report/report-screen.ts`, `engine-host/report.ts` / `report.test.ts`, `u21-…`, `u40-…`, 연기 `reportTabs`, `reportSummary`, `reportMasking` | — |
| 3.7 | 기록(사건 목록) 탭 | 없음 | — | **앱 계층에 실행 사건을 가린 채 읽는 함수가 필요하다** |
| 3.7 | 요약의 실행 id 복사, 거부 모음과 허용 방법 | 일부 | 거부 수는 사용량 탭(`report.runCounts`) | 복사(클립보드), 거부 목록 |
| 3.7 | 보고서 저장(OS 저장 대화상자, 가림본) | 구현됨 | `main/save-file.ts`, `engine-host/report.ts` `reportMarkdownValue` / `report-save.test.ts`, 연기 `reportSaved` | — |
| 3.7 | 사람 확인(승인·반려·메모, 화면 안 확인) | 구현됨 | `run-screen.ts`(review), `engine-host/plans.ts` `reviewValue` / `plans.test.ts`, 연기 `reviewAsked`, `reviewRecorded`, `reportVerdict` | — |
| 3.8 | 실행 목록(손상 실행, 되돌리기 기록 손상, 되돌림, 기록 변경됨), `latest` 안 씀 | 구현됨 | `runs/runs-screen.ts`, `engine-host/history.ts` / `history.test.ts`, `u20-…`, 연기 `runsListed`, `runsRows`, `previewLatest`, `runsRecordsChanged` | — |
| 3.8 | 목록의 적용 관계(U-16 `appliedBy`)와 실행 id 복사 | 없음 | 엔진 호스트 `runsValue`가 `appliedBy`를 넘기지 않는다 | |
| 3.8 | 되돌리기: 미리보기 토큰 → 메인 OS 확인, DR-25 동의 | 구현됨 | `main/history.ts`, `main/ipc.ts` / `history.test.ts`, 연기 `revertPreview`, `revertForged`, `revertDone`, `revertConsentForged` | — |
| 3.8 | 실행 기록·보관함 정리(DR-9, DR-39, DR-44, DR-53, DR-48) | 구현됨 | `runs/cleanup-screen.ts`, `engine-host/cleanup.ts`, `shared/cleanup.ts`, `main/cleanup-previews.ts` / `cleanup.test.ts`, `u13-…`, `u22-…`, 연기 `cleanup*`, `discard*` | — |
| 3.9 | 계획 보기(승인 토큰), 요약(에이전트의 말), 기록 변경 표시, 형태 모르는 계획의 CLI 안내 | 구현됨 | `plan/plan-screen.ts`, `engine-host/plans.ts`, `model-text.ts`, `main/plans.ts` / `plans.test.ts`, `u32-…`, `u44-…`, `u48-…`, 연기 `planShown`, `planAgentWords`, `markedPlan`, `planForged` | — |
| 3.9 | 다이제스트 앞 12자 복사 단추 | 일부 | 12자는 보인다 | 복사 |
| 3.9 | `inventoryLimitReached` 알림 | 구현됨 | `plan.inventoryLimit` | — |
| 3.9 | 적용 전 점검(행동별 문제, 하드 링크 없는 이동을 미리) | 없음 | 대신 첫 적용이 `consent_required`로 끝나고 다시 묻는 흐름(14.4) / 연기 `consentUnasked` | **앱 계층 적용 전 점검 함수가 필요하다** |
| 3.9 | 적용 메인 OS 확인, DR-21 동의 별도 대화상자 | 구현됨 | `main/plans.ts`, `main/dialog-texts.ts` / 연기 `applyDone`, `applyMoved`, `closeGuard`(대화상자 목록) | — |
| 3.9 | 적용함 표시, `plan_stale` → "다시 실행" | 일부 | 적용함(`appliedBy`)은 있다 | `plan_stale` 결과의 다음 행동 단추 |
| 3.10 | 설정: 위치·언어·모델(누를 때만, 접속 고지)·제공자·프로필 보기·권한 규칙·가릴 값 이름·키 있음/없음, 넓히기는 메인 확인 | 구현됨 | `settings/settings.ts`, `engine-host/settings.ts`, `main/settings-proposals.ts`, `shared/settings-edit.ts`, `main/model-entries.ts` / `settings*.test.ts`, `model-list.test.ts`, `provider-choice.test.ts`, 연기 `settings*`, `models*`, `provider*` | — |
| 3.10 | 프로필 내용 바꾸기, 새 작업 기본 프로필 고르기 | 일부 | 보기만 있다. 마지막 형태는 기억한다 | 프로필 편집(앱 계층 변경 제안에 프로필 편집 종류가 있는지 확인 필요) |
| 3.10 | 설정 파일 "탐색기에서 보기" | 없음 | — | |
| 3.10 | 언어 바꾸면 다시 그림(재시작 없음, 11절) | 일부 | 설정 파일 `language`는 바꾼다. 창은 다시 시작해야 바뀐다(14.4) | 즉시 다시 그리기 |
| 3.11 | 첫 실행 안내 4쪽, 덮어쓰지 않음, 키 입력란 없음, 설정 못 읽으면 점검으로(R45-L-1) | 구현됨 | `setup/setup-screen.ts`, `engine-host/setup.ts` / `setup.test.ts`, `u27-…`, 연기 `setup*` | 안내 안의 대본 예시 실행은 없다(사용 안내로 보냄) |
| 3.12 | 오류 카드(무엇·고치는 법·코드), 엔진 오류 코드의 GUI 문구 | 구현됨 | `i18n/catalog.ts` `errorText` / `u20-…`(UXM-12), `i18n.test.ts` | — |
| 3.12 | 고치는 법이 화면 이동이면 그 화면 단추 | 일부 | 첫 실행·점검 등 몇 곳만 | 오류 카드의 화면 단추 |
| 3.12 | 상태별 다음 행동 단추 | 일부 | 보고서·저장·변경·계획·동의·사람 확인·새 작업(`run-screen.ts:43-51,300`) | 결과에서 되돌리기(done, apply_incomplete, cancelled), 보호 대상 탭(protected_changed), 설정의 한도(budget-exhausted), `plan_stale`의 다시 실행 |
| 3.12 | 엔진 호스트가 끝난 경우의 카드와 "엔진 다시 시작" | 일부 | 카드 글은 "앱을 다시 시작하세요"(`error.adapter_host_exited`) | `restartEngine` 통로와 단추 |
| 3.13 | 명령 찾기(Ctrl+Shift+P) | 없음 | — | |
| 3.13 | 단축키 | 일부 | Ctrl+O, Ctrl+Enter, F6, F7·Shift+F7, Alt+F7(구현됨). Ctrl+1~9 화면 이동(설계에 없음) | Ctrl+N, Ctrl+쉼표, F5 |

## 2. 프로세스·통로(4절)와 앱 계층 연결(5절)

| 절 | 항목 | 판정 | 근거 | 빠진 것 |
|---|---|---|---|---|
| 4.1·4.3 | Node 26 별도 엔진 호스트, 셸 없이, 환경 걸러내기, Node 찾기 | 구현됨 | `main/engine-client.ts`, `environment.ts`, `node-path.ts`, `engine-host/main.ts` / `main-pure.test.ts`, `node-path-parity.test.ts`, `host-process.test.ts` | — |
| 4.2 | 통로 판 1(8 MiB, 준비·요청·응답·이벤트·끝, stdout 보호, 프로토콜 위반) | 구현됨 | `shared/protocol.ts`, `engine-host/host.ts` / `protocol.test.ts`, `host.test.ts`, `host-process.test.ts` | — |
| 4.4 | 준비 15초, 시작 실패 처리, 함께 끝나기, 호출 시간 상한 | 구현됨 | `engine-client.ts` / `host-process.test.ts`, 연기 `hostEndsWithQuit`, `hostEndsWhenMainKilled` | — |
| 4.4 | "엔진 다시 시작" 단추 | 없음 | — | 3.12와 같은 단위 |
| 4.5 | `gui-state.json`: 최근 목록·작업 형태·실행의 형태(원자적 쓰기) | 구현됨 | `main/gui-state.ts` / `workspaces.test.ts`(gui-state), `run-forms.test.ts` | — |
| 4.5 | 창 크기·위치, 마지막 탭, 트리 너비 | 없음 | — | |
| 5 | 함수 표: `startRun`·`report`·`changes`·`doctor`·`revert`(미리보기)·`listRuns`·`plan`·`applyPlan`·`review`·설정 읽기·변경 제안·적용·모델·정리 | 구현됨 | `src/app/types.ts` `CodarynApp`와 GUI 엔진 호스트의 호출 24개(`host.ts`) | — |
| 5 | 작업 공간 목록 함수 | 없음(앱 계층) | `src/app`에 없음 | p5a-adapter·계약 |
| 5 | 적용 전 점검 함수 | 없음(앱 계층) | `src/app`에 없음 | p5a-adapter·계약 |
| 5 | 권한 확인 `RunObserver.confirm` | 없음(엔진) | 선언만 있다 | 엔진(단계 5) |
| 5 | 실행 사건 목록(기록 탭, 3.7) | 없음(앱 계층) | 설계 5절 표에도 없다 | 표에 더하고 p5a-adapter에 요청 |
| 5 | 표의 "없음. 추가 요청" 표시 | **낡음** | 설정·모델·정리·실행 목록·미리보기는 이미 있다 | 문서 고침 |

## 3. 보안(6절)

| 절 | 항목 | 판정 | 근거 | 빠진 것 |
|---|---|---|---|---|
| 6.1 | 듣는 소켓 없음, 원격 디버깅 끔, 키는 환경 변수로만 | 구현됨 | `main/security*.ts`, `app.ts` / 연기 `sockets`, `settingsKey`, `providerText` | — |
| 6.2 | 샌드박스, 격리, Node 없음, 맞춤법 검사 끔, devTools 제품 끔, 저장 없는 세션 | 구현됨 | `main/security-policy.ts`, `security.ts`, `app.ts`(`enableSandbox`) / `main-pure.test.ts`, 연기 `renderer`, `noDictionaryDownload` | — |
| 6.2 | 화면 금지 API 검사(innerHTML 등) | 구현됨 | `scripts/build/build.mjs` / `i18n.test.ts` 일부 | — |
| 6.3 | `app://codaryn/`, CSP, 요청 막기, 탐색·새 창·webview 막기, 권한 거부, userData 위치 | 구현됨 | `main/protocol.ts`, `app-url.ts`, `security.ts` / 연기 `url`, `fetchHttp`, `fetchFile`, `windowOpen`, `urlAfterNavigation`, `linkedScript` | — |
| 6.4 | preload의 좁은 통로, 보낸 쪽 확인, 손으로 쓴 인자 검사 | 구현됨 | `preload/preload.cts`, `main/ipc.ts:132`(`senderFrame`), `shared/ipc.ts` / `ipc.test.ts`, 연기 `treePathString`, `doctorWithPath` | — |
| 6.4 | 함수 목록 | **낡음** | 실제는 `cancelRun()`, `listModels(provider)`, `plan(workspace, runId, profile, workflow)`, 언어는 `proposeSettings` 등이다. `copyText`·`restartEngine`·`startTaskRun`·`planCheck`는 없다 | 문서를 실제 목록으로 |
| 6.5 | 작업 공간 핸들, 항목 id, 미리보기·계획·제안 토큰(한 번), 실행 토큰 | 구현됨 | `main/handles.ts`, `tree-ids.ts`, `plans.ts`, `history.ts`, `settings-proposals.ts`, `cleanup-previews.ts` / 연기 `settingsTokenOnce`, `cleanupForged`, `planForged` | 변경 파일의 항목 id(3.4)는 없음 |
| 6.6 | 메인 OS 확인(적용·동의·되돌리기·정리·넓히기·가릴 값 빼기), 기본 "바꾸지 않음" | 구현됨 | `main/dialog-texts.ts`, `ipc.ts` / 연기 `closeGuard`(대화상자 목록), `settingsWiden*`, `settingsSecretDialogs` | — |
| 6.7 | 시작 때 원격 디버깅·inspect 스위치를 보면 끝냄 | 구현됨 | `security-policy.ts`, `app.ts` / 연기 switch 검사 | `--inspect-brk`는 fuses만 막는다(NOTE GU-9) |
| 6.7 | fuses(RunAsNode 등 끔, asar 무결성 켬), 꾸러미에서 `build/tests` 제외 | 환경 밖 | — | GU-9 |
| 6.8 | "탐색기에서 보기"만, `openPath`·`openExternal` 없음 | 구현됨 | `main/ipc.ts`(`showItemInFolder`만) | — |
| 6.9 | 창 제목·알림·작업 표시줄에 값 없음, 파일 로그 없음 | 구현됨 | `shell.ts:91`, `app.ts` / 연기 `endNotices` | — |
| 6.10 GS-1 | 듣는 소켓 0 | 구현됨 | 연기 `sockets` | — |
| GS-2 | 틀린 인자·경로·모르는 핸들·다른 프레임 | 일부 | 연기 `treePathString`, `treeUnknownNode`, `revealUnknown`, `doctorWithPath`, `ipc.test.ts` | 다른 프레임에서 온 요청의 시험 |
| GS-3 | HTML·스크립트 글을 대본에 넣어도 글로 보임 | 일부 | 유닛(`u21-…` `<b>done</b>`), `build.mjs` 금지 API 검사 | 목표·파일 이름·근거·계획에 넣은 대본 연기 시험 |
| GS-4 | 가짜 키·가짜 가릴 값이 화면·제목·`gui-state.json`·프로필·알림에 없음 | 일부 | 연기 `treeText`, `recentText`, `settingsText`, `runText`, `reportText`, `stateFile`, `endNotices` | 가짜 `secretEnv` 값으로 돌린 실행, Chromium 프로필 디렉터리 검사 |
| GS-5 | 화면 API만으로 넓히기 불가 | 구현됨 | 연기 `settingsWidenRefused`, `settingsForgedToken`, `settingsAfterRefusal` | — |
| GS-6 | 외부 탐색·새 창·`file://` 막힘 | 구현됨 | 연기 `fetchHttp`, `fetchFile`, `windowOpen`, `urlAfterNavigation` | — |
| GS-7 | CLI와 GUI 동시 실행 → 한쪽 `workspace_locked` | 없음 | — | 연기 시험 한 경우 |
| GS-8 | 가짜 비밀이 든 파일의 비교·트리에 원문 없음 | 일부 | 연기 `changesText`, `changesPerFileText`(가짜 키) | 등록한 가짜 `secretEnv` 값으로 |
| GS-9 | 가짜 비밀·제어 문자 이름의 모르는 도구 → `(unknown tool)` | 없음(GUI) | CLI 시험에만 있음 | 연기 시험 한 경우 |
| GS-10 | 정리 뒤 보관함 그대로 | 구현됨 | 연기 `cleanupKeep*`, `discardApplied`, `discardLeftStatuses` | — |
| GS-11 | 바깥 연결 0 | 구현됨 | 연기 `sockets`, `transportRefused`, `transportRefusedEnd`, `lifeTransportRefused` | — |
| GS-12 | 화면에 `process`·`require`·`ipcRenderer` 없음 | 구현됨 | 연기 `renderer` | — |
| GS-13 | 토큰 없이·남의 토큰·두 번 | 구현됨 | 연기 `planForged`, `revertForged`, `cleanupForged`, `settingsTokenOnce` | — |
| GS-14 | 화면 인자로 DR-21 동의 불가 | 구현됨 | 연기 `consentUnasked`, `revertConsentForged`, `revertNoConsentOffer` | — |
| GS-15 | 원격 디버깅·inspect로 제품 실행 → 끝남 | 일부 | 연기 switch 검사(세 형태) | `--inspect-brk`는 fuses 뒤(환경 밖) |
| GS-16 | 링크·정션·키 모양·제어 문자 이름 | 구현됨 | 연기 `treeText`(정션, 키 모양 파일), `tree-host.test.ts` | — |
| GS-17 | 맞춤법 사전 받지 않음 | 구현됨 | 연기 `noDictionaryDownload` | — |
| 8.1 | 보안 시험을 `gui/tests/security`에 따로(GU-8, 구현자가 아닌 세션) | **다름** | 연기 시험에 섞여 있다 | 그대로 둘지, 따로 둘지 결정 |

## 4. 의존성·배치·빌드·시험(7·8절), OS·접근성·언어·검증(9~12절)

| 절 | 항목 | 판정 | 근거 | 빠진 것 |
|---|---|---|---|---|
| 7 | electron 45.3.1 하나, lock 검사(레지스트리·sha512·설치 스크립트 없음) | 구현됨 | `gui/package.json`, `scripts/build/check-lock.mjs` / `npm test`의 lock 검사 | — |
| 7 | `@electron/fuses`, `@electron/packager` | 환경 밖 | 새 의존성(PM 승인)과 외부 내려받기 | GU-9 |
| 8.1 | 배치 그림(`tests/security`, `tests/contract`, `scripts/package`, `*.model.ts`, 화면 디렉터리 목록) | **낡음** | 실제: `changes/`, `checks/`, `report/`, `setup/`, `runs/cleanup-screen.ts`, `run-model.ts`·`tree-model.ts` | 문서 고침 |
| 8.2 | `npm run package` | 환경 밖 | 스크립트 줄 없음 | GU-9 |
| 8.3 | 유닛·연기·화면 코드 검사 | 구현됨 | 유닛 193, 연기 191(main 2ee6c0b) | — |
| 8.3·12 | 계약 시험(같은 대본을 CLI와 엔진 호스트로 돌려 `EngineResult`·기록 사건 비교) | 없음 | `gui/tests/contract` 없음 | 시험 단위 |
| 9 | Windows 11 x64 | 구현됨(이 기계) | 모든 시험이 Windows에서 돈다 | — |
| 9 | macOS·Linux | 환경 밖 | — | 그 OS의 기계 |
| 10 | 키보드: 트리 화살표·Home·End, F6, 포커스 표시 | 구현됨 | `tree-model.ts:166-189`, `styles.css:85-88` / `tree-model.test.ts`, 연기 `keyboard` | — |
| 10 | 트리 첫 글자 이동 | 없음 | — | |
| 10 | 낭독기: tree/treeitem, 상태 알림(aria-live), 탭 역할 | 구현됨 | `role` 사용(tree 1, treeitem 3, tab·tablist·tabpanel, status 9, alert 15), `aria-live` 4 | — |
| 10 | forced-colors, 동작 줄이기, `lang` 속성 | 구현됨 | `styles.css:220,265`, `app.ts:30` | — |
| 10 | 밝은·어두운 테마를 OS 설정대로 | 없음 | `prefers-color-scheme` 없음 | |
| 10 | 수동 점검표(Narrator, NVDA, 200%, 고대비) | 환경 밖 | 점검표 문서도 없다 | 점검표 문서는 쓸 수 있다. 점검은 사람 |
| 11 | 두 층 카탈로그(GUI-D21), 두 언어, 값 넣기 금지 | 구현됨 | `renderer/i18n/*`, 엔진 호스트 `messages` / `i18n.test.ts`, `u24-terms.test.ts`, `u27-…` | — |
| 11 | 언어 즉시 바꾸기 | 일부 | 3.10과 같음 | |
| 12 | 완료 기준: 교차 검토 | 구현됨(단위마다) | `docs/reviews/*`(R-59, R-63, R-65, R-67 등) | GU-8의 별도 세션 검토는 없음 |

## 5. 결정(16절)과 외부 사실(13절)

| 번호 | 판정 | 비고 |
|---|---|---|
| GUI-D7 키 등록 뒤 앱 재시작 안내 | 구현됨 | 설정·첫 실행의 키 안내 |
| GUI-D8 변수 파일을 실행마다 대화상자로 | 없음 | 3.5 task 파일 단위와 같이 |
| GUI-D9 서명·설치·업데이트(첫 배포 zip, 자동 업데이트·충돌 보고 없음) | 환경 밖 | 자동 업데이트·충돌 보고는 설계상 끈다(코드에 없음 = 맞음) |
| GUI-D11·D12·D15·D16·D17·D19·D20·D21·D22 | 구현됨 | 각각 3.5, 3.5, 7, 6.3, 3.1, 3.2(끌어 놓기 없음), 3.3(파일 내용 보기 없음), 11, 6.6 |
| GUI-D18 macOS·Linux 단일 인스턴스 | 환경 밖 | E-9 |
| E-4 fuses 이름과 Chromium 스위치 | 환경 밖 | 공식 문서(외부 네트워크) 또는 GU-9 실행 |
| E-5 UIA·Narrator·NVDA·forced-colors 동작 | 환경 밖 | 사람의 수동 점검 |
| E-6 설치 크기·코드 서명·SmartScreen | 환경 밖 | 인증서, 배포 |
| E-8 사용자 환경 변수를 등록한 뒤 새 앱이 받는지 | 환경 밖(수동) | 이 기계에서 사람이 한 번 해 볼 수는 있다 |

## 6. 이 환경에서 못 하는 것 (따로 표시)

| 무엇 | 왜 | 필요한 것 |
|---|---|---|
| 패키징(`@electron/packager`, zip) | 새 개발 의존성과 npm 내려받기(외부 네트워크) | PM 승인, 설치 단계 승인 |
| fuses(`@electron/fuses`) 적용과 GS-15의 `--inspect-brk` 막기 | 위와 같음. 패키지한 실행 파일이 있어야 시험할 수 있다 | 위와 같음 |
| Node 26 실행 파일 묶기(DR-26) | Node 배포물 내려받기, 판 고정·체크섬 | PM 결정과 내려받기 승인 |
| 코드 서명, SmartScreen(E-6) | 인증서와 과금 | 사용자 결정(GUI-D9) |
| 설치 파일(NSIS·MSI), 탐색기 "Codaryn에서 열기" 메뉴 | 첫 배포는 zip(GUI-D9). 설치 도구는 새 의존성 | 배포 결정 |
| 자동 갱신, 충돌 보고 | 설계가 끈다(6.7, GUI-D9). 할 일 없음 | — |
| macOS·Linux 시험(9절, E-9, GUI-D18) | 다른 OS의 기계 | 그 기계 |
| 접근성 수동 점검(E-5) | 사람이 낭독기로 확인 | 사람(점검표는 쓸 수 있다) |
| 외부 사실 확인(13절 E-4·E-6) | 공식 문서 열람은 외부 네트워크 | 허락된 조사 세션 |

## 7. 설계가 낡은 곳 (문서 고침, 내 소유 `docs/design/standalone-gui.md`)

1. 머리말 "구현: GU-1(골격)이 `claude/gui-design`에 있다"가 지금과 맞지 않는다.
2. 1절의 "두 번째 API 제공자 … 구현은 범용 작업 묶음 뒤", 3.10의 "지금 제공자는 Anthropic 하나"가 낡았다. 지금은 `CONNECTED_MODEL_PROVIDERS`가 anthropic과 openai이고, 제공자 선택이 있다.
3. 4.4의 "GU-1에는 아직 없다". 내용(다시 시작 단추 없음)은 맞지만 단위 이름이 낡았다.
4. 5절 표의 상태 열 "없음. 추가 요청"이 실행 목록·미리보기·설정 읽기·변경·모델·정리에서는 이미 있다. 실행 사건 목록 줄은 표에 없다.
5. 6.4의 preload 함수 표가 실제 이름·인자와 다르다.
6. 8.1의 배치 그림이 지금 디렉터리와 다르다(`tests/security`, `tests/contract`, `scripts/package`는 없다. 화면 디렉터리가 늘었다).
7. 14.4 GU-6 줄의 "마지막 프로필을 작업 공간별로 남기기는 아직 없다"가 낡았다. `lastForm`으로 남긴다.
8. 14.4 GU-3 줄의 "보고서의 마지막 답은 CLI의 보고서 읽기가 `finalMessage`를 남긴 뒤에 보인다"가 낡았다. 이미 보인다(U-21).
9. 14.4 GU-4 줄의 "DR-44에만 있는 동작의 연기 시험은 … 들어온 뒤 붙인다"가 낡았다. `cleanupKeep*`가 있다.
10. 3.1 배치 그림(왼쪽 아래 실행 목록)이 실제와 다르다. '다름'으로 결정을 받은 뒤 고친다.
11. 14.2 분할표의 담당·순서는 다 지났다. 이 보고의 단위 제안으로 바꿀지 PM이 정한다.

## 8. 단위 제안 (각 1,500줄 이하, 순서)

- 순서는 사용자에게 보이는 값이 크고 앱 계층 변경이 없는 것을 먼저 둔다.
- 앱 계층이 필요한 것은 그 단위가 main에 들어온 뒤 GUI 단위를 둔다.
- 줄 수는 어림이다(코드와 시험을 합친 것).

| 순서 | 단위 | 내용 | 어림 | 앱 계층·다른 담당 |
|---|---|---|---|---|
| 1 | **G-docs** 설계 문서 현행화 | 7절의 1~9, 11. 3.1은 결정 뒤 | 문서 ~150 | 없음 |
| 2 | **G-next** 결과의 다음 행동과 적용 관계 | 3.12 다음 행동(결과에서 되돌리기 미리보기로, 보호 대상 탭으로, budget → 설정의 한도, `plan_stale` → 새 작업), 3.8 목록의 `appliedBy`, 3.4 변경 화면의 `applyRun` 안내, 3.2 분석 작업의 DR-23 한 줄 | ~600 | 없음(U-16 필드는 이미 앱 계층에 있다) |
| 3 | **G-copy** 복사 | 6.4 `copyText`(메인이 글을 검사하고 clipboard에 씀, 가림본만): 실행 id, 다이제스트 12자, 상대 경로(가린 이름) | ~400 | 없음 |
| 4 | **G-task** task 파일로 실행과 변수 파일 | 3.5, GUI-D8: 메인의 OS 파일 대화상자 2개(task, vars), 경로 기억 안 함, `startTaskRun`. 작업 공간 안 task 거부는 `startRun`이 한다 | ~700 | 없음(`StartRunRequest`가 task 형식과 `varsFile`을 받는다. 엔진 호스트 형만 넓힘) |
| 5 | **G-engine** 엔진 다시 시작과 엔진 종료 카드 | 3.12, 4.4: `restartEngine` 통로, 토큰·핸들 표 정리, 진행 중 실행의 끝 알 수 없음 안내 | ~500 | 없음 |
| 6 | **G-tree** 트리의 변경·보호 표시와 새로 고침 | 3.3: 고른 실행의 `changes` 상태로 표시, 설정의 `protectedPaths`로 `[보호]`, 바뀐 파일 → 비교, F5, 실행 끝 뒤 다시 읽기 | ~900 | 없음 |
| 7 | **G-diff** 비교 보기 | 3.4: 나란히 보기, 줄 바꿈 켜기·끄기, 비교 화면의 "탐색기에서 보기"(변경 파일 항목 id) | ~700 | 없음 |
| 8 | **G-keys** 명령 찾기와 단축키 | 3.13: Ctrl+Shift+P 고정 목록(모델이 만든 글로 명령을 만들지 않음), Ctrl+N, Ctrl+쉼표, F5, 트리 첫 글자 이동(10절) | ~600 | 없음 |
| 9 | **G-open** 열 때 점검과 잠금 표시 | 3.2: 열 때 `doctor` 작업 공간 항목, 막음·경고 카드, 잠금이면 새 작업 끔 | ~500 | 확인 필요: `doctor`가 작업 공간 잠금을 말하는지. 없으면 앱 계층에 잠금 상태 항목 요청(p5a-adapter) |
| 10 | **G-lang** 언어 즉시 바꾸기, 설정 파일 탐색기에서 보기, 어두운 테마 | 11절, 3.10, 10절 | ~400 | 없음 |
| 11 | **G-state** 창 상태 기억과 끌어서 바꾸는 경계 | 4.5, 3.1 | ~400 | 없음 |
| 12 | **G-sec** 보안·계약 시험 보강 | GS-2 다른 프레임, GS-3 HTML 대본, GS-4 가짜 `secretEnv` 값과 프로필 디렉터리, GS-7 CLI·GUI 동시 잠금, GS-9 모르는 도구, 8.3 계약 시험 | 시험 ~900 | 없음. 설계는 구현자가 아닌 세션을 권한다(GU-8). 8.1 '다름' 결정과 같이 |
| 13 | **A-list → G-list** 작업 공간 목록 함수 | 3.3: 앱 계층 함수(디렉터리 하나, 쪽, 링크 표시, 키 모양·`secretEnv` 값 가림) 뒤 엔진 호스트 `tree.ts`의 임시 읽기를 바꿈 | 앱 ~500 + GUI ~300 | **계약·p5a-adapter 먼저** |
| 14 | **A-events → G-log** 기록 탭 | 3.7: 앱 계층이 실행의 사건을 가려 쪽으로 주는 함수(`RunEvent`와 같은 정리) 뒤 기록 탭(거르기 재사용) | 앱 ~400 + GUI ~500 | **p5a-adapter 먼저**. 5절 표에 줄 추가 |
| 15 | **A-check → G-check** 적용 전 점검 | 3.9: 앱 계층 적용 전 점검(옮기지 않고 판정, 볼륨 하드 링크 시험) 뒤 계획 화면에 행동별 문제와 DR-21 동의를 적용 전에 묻기. 지금의 `consent_required` 흐름을 대신함 | 앱 ~600 + GUI ~600 | **계약(w3:p9)·p5a-adapter 먼저** |
| 16 | **E-confirm → G-confirm** 실행 중 권한 확인 | 3.6, AC 5.7, DR-3: 엔진이 `confirm`을 부르는 단계 5 뒤 패널(기본 거부, 대기 시간 표시, 화면이 답 못 하면 메인이 거부) | GUI ~700 | **엔진·앱 계층(단계 5) 먼저** |
| 17 | **G-a11y** 접근성 점검표 문서 | 10절 수동 점검표(Narrator·NVDA·200%·고대비·키보드만) | 문서 ~150 | 점검은 사람 |
| 18 | **GU-9** 패키징 | packager·fuses·zip·Node 26 묶기·`docs/gui-usage.md`·GS-15 `--inspect-brk` | 별도 | **환경 밖**: PM 승인(새 의존성, 내려받기) |

- 3.10의 프로필 편집은 표에 넣지 않았다.
  - 앱 계층의 변경 제안(`proposeSettingsChange`)은 다음 설정 전체(`next`)를 받는다. 그래서 GUI 쪽은 편집 종류(`gui/src/shared/settings-edit.ts`, 지금 프로필 편집 없음)만 더하면 된다.
  - 다만 앱 계층의 넓히기 판정이 프로필 안의 한도·허용 명령을 넓히는 것도 잡는지 p5a-adapter에게 먼저 확인해야 한다. 확인 뒤 G-lang 다음에 둔다.
- 결정이 필요한 것(PM)
  - 3.1 실행 목록을 왼쪽 아래 패널로 할지, 지금의 화면 방식으로 설계를 고칠지.
  - 8.1·GU-8 보안 시험을 `tests/security`로 따로 둘지, 연기 시험에 둘지. 구현자가 아닌 세션이 맡을지.
  - 단위 13~16의 앱 계층·엔진 쪽 순서와 담당.
