# R-72 병합 전 검토 — GUI 단위 U-61

```
검토자: w3:pA (이 코드의 구현자가 아님). 읽기 전용: 저장소 파일 수정·커밋 없음
대상: pm/unit-U-61 826d5a7 (main 7f17caf 위). git diff 7f17caf 826d5a7: 17파일 +489/-28 (gui와 docs/design/standalone-gui.md)
  결과 화면의 다음 행동(되돌리기 미리보기, 보호 대상 탭, 설정의 한도, plan_stale 뒤 새 작업)
  실행 목록의 적용 관계(planApply, U-16의 appliedBy)
  분석 작업의 DR-23 안내
  변경 화면의 applyRun은 쓰지 않기로 했다(아래 (2))
결과: 높음 0, 중간 0, 낮음 0, 정보 3
판: git archive 826d5a7을 .codaryn/r72/tree에 풀어 빌드했다
실행 (그 판에서):
  루트 빌드: tsc 0
  GUI npm test: 빌드·lock 검사 통과, GUI 유닛 199건 중 199 통과
  연기 시험 두 번: 193/193, 193/193. 두 번 다 app exit 0
    U-61의 revertFromResult, planApplyInList 포함
  Electron:
    claude-gui에 설치된 것을 경로로만 썼다. smoke.mjs의 경로 한 줄만 바꾼 사본(smoke-r72.mjs)으로 돌렸다
    끝난 뒤 남은 electron.exe 없음
  실험: .codaryn/r72/r72.test.mjs, 출력 r72-out.txt
    그 판의 앱 계층·엔진 호스트·주 프로세스 모듈, 대본 모델, 합성 값을 썼다. 네트워크 없음
```

## 판단: 병합해도 된다

## 중점별 결론

### (1) 단추가 여는 것이 미리보기·화면 이동뿐이고 파괴적 동작을 바로 하지 않는가

**그렇다.** 새 단추 다섯 개(`gui/src/renderer/run/run-screen.ts`, `app.ts`)를 따라가 보았다.

| 단추 | 하는 일 | 파괴적 동작 |
| --- | --- | --- |
| "이 실행 되돌리기 미리보기"(`run-revert-preview`) | 실행 목록의 `choosePreview(runId)` 다음 목록 화면을 보인다. 목록이 들어온 뒤 그 실행이 목록에 있을 때만 `showPreview` → `api.previewRevert`를 부른다 | 없음. 미리보기는 dryRun이다. 실제 되돌리기는 전처럼 미리보기가 준 토큰으로 "되돌리기" 단추를 따로 눌러야 하고(`api.revert(token)`), 메인이 OS 확인을 한다. 새 단추는 이 길을 건너뛰지 않는다 |
| "보호 대상 보기"(`protected_changed`) | 보고서를 그 실행의 `protected` 탭으로 연다(`choose(runId, form, "protected")`) | 없음(읽기) |
| "설정에서 한도 보기"(`budget-exhausted`) | 설정 화면을 보인다(`shell.show("settings")`) | 없음. 설정은 전처럼 변경 제안·토큰·메인 확인으로만 바뀐다 |
| "다시 실행해 새 계획 만들기"(`plan_stale`) | 새 작업 화면을 보인다(`deps.newTask`) | 없음. 실행은 사람이 그 화면에서 시작한다 |
| (분석 안내) | 작업 종류나 프로필의 작업 종류가 `analyze`일 때 안내 한 줄을 보인다 | 해당 없음 |

- 연기 시험 `revertFromResult`: 첫 실행의 결과에 단추가 있다. 누르면 실행 목록에 그 실행의 미리보기가 뜨고(`data-preview` "1"), 제목에 그 실행 id가 있다.

### (2) 주 프로세스가 appliedBy·applyRun 값을 다시 검사하는가

**appliedBy(목록의 `planApply`): 한다.**

- **엔진 호스트**(`gui/src/engine-host/history.ts`):
  - 계약의 `planApplyStateOf(entry, entries)`(CLI `runs`와 같은 규칙)로 계획 실행마다 판정한다.
  - 상태가 목록에 있고 `applyRunId`가 실행 id 꼴일 때만 세 필드(`state`, `applyRunId`, `reason`)를 다시 짓는다. 던지거나 다른 꼴이면 그 줄에 필드가 없다.
- **주 프로세스**(`gui/src/shared/ipc.ts`):
  - `toRunsReply` → `planApplyOf`가 다시 검사한다: 세 키뿐인지(`hasOnlyKeys`), 상태가 다섯 중 하나인지, `isRunId`인지, `reason`이 null이거나 낱말 꼴인지.
  - 하나라도 아니면 목록 전체가 `host_error`다.
- **렌더러**: `asPlanApply`가 한 번 더 거른다.
- 실험(`r72.test.mjs`) 결과:

  | 경우 | 결과 |
  |---|---|
  | 앱 계층으로 만든 실제 계획·적용 | 목록의 계획 줄이 `{state: "applied", applyRunId: <그 적용 실행>, reason: null}`. 적용 실행 줄에는 없음 |
  | 규칙이 없는 엔진 | 어느 줄에도 없음 |
  | 엔진 호스트에서 규칙이 던짐, 모르는 상태, 틀린 id | 그 줄에 필드 없음, 목록은 열림 |
  | 덧붙은 필드와 200자 `reason`(합성 값 포함) | 세 필드만 남고 `reason`은 null. 호스트 값에 그 합성 값 없음 |
  | 주 프로세스에 바로: 덧붙은 키, 모르는 상태, `latest`인 id, 공백·`<b>`가 든 `reason`, 문자열 | 모두 `host_error` |
  | 주 프로세스에 바로: `null` | 필드 없음 |

- 연기 시험 `planApplyInList`: 적용한 두 계획 모두 `applied`다.

**applyRun(변경 화면): 쓰지 않는다.**

- U-61은 "적용 실행은 변경 화면을 열지 않으므로 `applyRun`을 쓰지 않는다"로 정하고 설계(3.4)를 그렇게 고쳤다.
- 코드로 확인했다. "변경 보기" 단추는 세 곳에만 있다.
  - 실행 목록: `run.kind === "run" && run.changes > 0`일 때(`runs-screen.ts:94`)
  - 결과: `result.kind === "run" && result.changes.length > 0`일 때(`run-screen.ts:51`)
  - 보고서: 실행 보고서의 "변경" 탭(`report-screen.ts:101-106`)
- 적용 실행의 보고서는 "동작" 탭을 쓴다. 그래서 적용 실행이 변경 화면에 가는 길이 없고, 다시 검사할 값도 GUI로 가지 않는다(정보 I-1).

### (3) 화면에 가는 글이 textContent인가

**그렇다.**

- 새 요소는 모두 `el(tag, text, attrs)`(`textContent`)와 `button(...)`으로 만든다.
- 매개로 들어가는 값은 다시 검사한 것뿐이다: `runs.planApply.<state>`의 `{runId}`(실행 id 꼴)와 `{reason}`(낱말 꼴이나 "-").
- `data-plan-apply` 속성에는 다섯 상태 중 하나만 들어간다.
- `innerHTML`은 쓰지 않는다.

### (4) 두 언어

**맞다.**

- 새 문구 11개가 en·ko 둘 다에 있다: `task.analyzeNotice`, `run.revertPreview`, `run.viewProtected`, `run.viewLimits`, `run.planStale`, `run.newPlan`, `runs.planApply.<5>`.
- GUI 카탈로그는 `TextId` 형식으로 두 언어의 키가 같아야 빌드된다.
- 유닛 시험이 목록의 적용 관계 문구를 CLI `runs`의 낱말과 대조한다(커밋 설명).

## 정보 (건수에 넣지 않음)

- **I-1:** 변경 화면은 `ChangesOutput.applyRun`(U-16)을 받지 않는다. 적용 실행이 변경 화면을 열 길이 없어서이고, 설계 3.4가 그렇게 바뀌었다. 나중에 적용 실행에서 변경 화면을 여는 길을 만들면 그때 `applyRun`을 다시 검사하고 보여야 한다.
- **I-2:** 목록 줄 하나의 `planApply`가 꼴에 맞지 않으면 주 프로세스는 목록 전체를 `host_error`로 거부한다(닫힌 쪽). 엔진 호스트가 먼저 걸러서 실제로는 생기지 않는다(실험의 규칙 이상값은 모두 그 줄의 필드만 빠졌다).
- **I-3:** 결과의 "되돌리기 미리보기"는 그 실행이 목록(최대 200, `RUN_LIST_LIMIT`)에 있을 때만 미리보기를 연다. 아니면 목록만 보인다. 방금 끝난 실행은 가장 새 실행이라 늘 목록에 있다.

## PM 질문

없음.
