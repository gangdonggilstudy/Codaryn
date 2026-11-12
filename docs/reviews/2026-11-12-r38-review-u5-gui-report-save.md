# R-38 병합 전 검토: 단위 U-5 (GUI 보고서 저장, 실행 끝 알림, 셋째 정리 대화상자)

```
검토자: w3:pA (이 코드의 구현자가 아님). 읽기 전용: 저장소 파일 수정·커밋 없음
대상: unit/U-5-p5u-gui 2cc204f (main 6df2eae 위 커밋 둘: b41d91f, 2cc204f, 20개 파일 +404/-16, gui/ 와 docs/design/standalone-gui.md 만)
기준: standalone-gui 3.6, 3.7, 6.9, R-33b 정보 1, 담당 보고 claude-gui/.codaryn/report-U-5a.md
결과: 높음 0, 중간 0, 낮음 1, 참고 4
실행(2cc204f 를 이 worktree 의 .codaryn/r38/tree 에 풀어 빌드):
  루트 빌드 0
  GUI npm test: 빌드·lock 검사 통과, GUI 유닛 146건 중 146 통과
  연기 시험 두 번: 155건 중 155 통과, 155건 중 155 통과
  Electron 은 claude-gui 의 설치된 것을 경로로만 썼다. smoke.mjs 의 경로 한 줄만 바꾼 사본으로 돌렸고, 새로 내려받지 않았다
  끝난 뒤 electron.exe 없음
탐침(.codaryn/r38/probes, 실제 GUI, 가짜 Anthropic API 127.0.0.1):
  - 연기 시험과 같은 주입점을 썼다: 저장 대화상자의 답, OS 알림, 창 활성
  - 모델이 등록된 비밀(설정 secretEnv)이 든 파일을 읽고 말한다
  - 목표에는 표지 문자열을 넣었다
실행하지 않은 것: 실제 OS 저장 대화상자와 OS 알림(주입점으로 대신함), Linux·macOS, OS 알림 권한을 끈 상태
```

## 1. 중점별 결론

| 중점 | 결론 | 근거 |
| --- | --- | --- |
| 렌더러가 저장 경로를 정할 수 있는가 | **없음** | preload의 `saveReport`는 작업 공간 핸들과 실행 id 둘만 글로 넘긴다. 메인은 보낸 쪽을 보고(`fromAppWindow`) `parseRunArgs`(모르는 필드 거부, 핸들·실행 id 꼴)를 거친다. 경로는 메인의 `dialog.showSaveDialog`만 정한다. 탐침: 셋째 인자로 준 경로는 쓰이지 않았다(그 파일 없음). 경로를 핸들·실행 id 자리에 넣으면 `invalid_args`다. 렌더러는 파일 이름만 받는다(폴더 없음) |
| 기존 파일 덮어쓰기 확인 | Windows·macOS는 OS 대화상자가 묻는다. **Linux는 묻지 않는다(L-1)** | 쓰기는 같은 폴더의 임시 파일(`wx`)에 쓴 뒤 이름을 바꾼다. 탐침: 있던 파일이 새 보고서로 통째로 바뀌었고 남은 `.tmp`는 없다 |
| 작업 공간 밖·시스템 경로 | 사람이 OS 대화상자에서 고른 곳에만 쓴다 | 기본 위치는 문서 폴더, 이름은 `codaryn-report-<runId>.md`, 걸러 보기는 md다. 쓸 수 없는 곳·없는 폴더는 `save_failed`이고 아무것도 남지 않는다(탐침). 시스템 경로는 OS 권한이 막는다 |
| 저장 내용에 가려지지 않은 비밀 | **없음. 앱 계층의 `reportMarkdown` 그대로** | 탐침: 저장된 파일이 같은 실행에 대한 앱 계층 `reportMarkdown`의 글과 같다. 등록 비밀·가짜 키 없음. 엔진 호스트는 줄마다 `shownText`(제어 문자 바꿈, 키 모양·값 가림)를 한 번 더 거친다(I-3). 연기 시험도 가짜 Anthropic·OpenAI 키가 없음을 본다 |
| 종료 알림의 글 | **목표·경로·비밀 없음** | `endNotice`: 고정 글과 공용 카탈로그의 상태 낱말뿐이다. 낱말은 제어 문자를 바꾸고 40자로 자른다. 창이 활성이면 보내지 않는다. 탐침: 알림 `Codaryn 실행이 끝났습니다: 확인 필요` 한 건, 목표 표지·비밀·작업 공간 경로 없음. 영어도 같은 꼴이다 |
| 알림을 누르면 | 앱 창을 보이고 앞으로 가져올 뿐이다 | 다른 실행·파일·주소를 열지 않는다. 그 실행의 결과 화면으로 옮겨 가지도 않는다(I-1) |
| OS 알림 권한이 없을 때 | 아무 일도 없다 | `Notification.isSupported()`가 거짓이면 보내지 않는다. OS 설정으로 꺼진 경우 `show()`는 보이지 않을 뿐 오류가 없다(코드 읽기, 실행하지 않음, I-2). 창 안의 끝 알림은 그대로다 |
| 셋째 대화상자 경고 | **두 언어로 나옴, 뜻 같음** | `cleanupDiscardedDetail`: 이번 정리로 기록이 지워지는 적용 실행이 있을 때만 한 줄을 더한다. ko "보관함을 남기면, 기록이 지워지는 적용 실행 N개의 보관함 파일은 되돌리기로 제자리에 되살릴 수 없게 됩니다." / en "If you keep them, the files in the discard boxes of the N apply runs whose records go can no longer be put back by a revert." 그런 실행이 없으면 원래 한 줄뿐이다 |

## 2. 낮음

### R38-L-1 Linux에서는 저장 대화상자가 기존 파일 덮어쓰기를 묻지 않는다 [추정: Electron 문서, Linux에서 실행하지 않음]

- 위치: `gui/src/main/app.ts`의 `chooseSavePath`. `dialog.showSaveDialog`에 `properties`가 없다.
- 근거
  - Electron의 `showSaveDialog` 옵션 `properties: ["showOverwriteConfirmation"]`은 Linux 전용이다.
  - 주지 않으면 이미 있는 파일 이름을 골라도 확인 대화상자가 나오지 않는다.
  - Windows와 macOS의 저장 대화상자는 스스로 덮어쓰기를 묻는다.
- 영향
  - Linux에서 사람이 이미 있는 파일 이름을 고르면, `writeTextFile`이 임시 파일과 이름 바꾸기로 그 파일을 말없이 바꾼다.
  - 사람이 고른 이름이고 기본 이름에 실행 id가 들어 있어 드물다.
- 권고: `properties: ["showOverwriteConfirmation"]`을 넣는다(다른 OS에는 영향 없음). Linux 검증 때 확인한다.

## 3. 참고 (건수에 넣지 않음)

- **I-1** 알림을 누르면 창만 보인다. 끝난 그 실행의 결과로 옮겨 가지는 않는다. 다른 것을 여는 길이 없어 안전하다. 끝난 실행의 결과는 창 안에 이미 있다.
- **I-2** OS 알림이 꺼져 있으면 알림이 조용히 사라진다.
  - 남는 것은 창 안의 실행 화면이 보여 주는 끝뿐이다.
  - 작업 표시줄의 진행 표시(`setProgressBar`)는 실행 중에만 있고 끝나면 지워진다.
  - 그래서 창을 보지 않는 사람에게는 끝났다는 신호가 없다. 알림을 끈 것은 사람의 선택이다.
  - OS 권한을 끈 상태는 실행하지 않았다.
- **I-3** 저장 글은 앱 계층의 Markdown에 GUI의 표시 정리(`shownText`)를 줄마다 한 번 더 건 것이다.
  - 이번 탐침에서는 둘이 같았다.
  - 키 모양을 가진 평범한 이름이 있으면 `[key]`로 바뀔 수 있다. CLI `report`도 같은 모양을 가리므로 대체로 같다. 안전한 쪽이다.
- **I-4** 작업 공간 안에 저장해도 막지 않는다(사람의 선택).
  - 그러면 가린 보고서가 작업 공간 파일이 되어, 다음 실행의 모델이 읽을 수 있다. 담긴 것은 가린 글뿐이다.
  - 대화상자의 기본 위치를 문서 폴더로 두는 지금 동작이 맞다.

## 4. 실행 기록

- 빌드·GUI npm test: `.codaryn/r38/gui-test.txt`
- 연기 시험: `.codaryn/r38/smoke-1.txt`, `smoke-2.txt`
- 탐침: `.codaryn/r38/probes/r38-run.mjs`, `r38-electron.mjs`(→ `probe.txt`)
  - 실제 GUI의 `saveReport` 여섯 경우: 보통, 셋째 인자, 경로 자리 바꿈, 취소, 덮어쓰기, 없는 폴더
  - 알림 한 건
  - 앱 계층 `reportMarkdown`과 비교
  - 탐침의 `done: false`는 탐침의 한계다. preload의 `onRunDone`은 듣는 쪽을 하나만 두므로, 탐침이 건 것이 화면의 것으로 바뀌었다. 실행이 끝난 것은 끝 알림(`onEnded`)이 온 것으로 확인했다. 그 뒤 저장한 보고서는 앱 계층의 같은 실행 보고서와 같았다.
- 대화상자 글: 빌드된 `dialog-texts.js`의 `cleanupDiscardedDetail`, `endNotice`를 두 언어·경계 값(0건, 2건, 활성, 상태 없음, 제어 문자)으로 불렀다.
