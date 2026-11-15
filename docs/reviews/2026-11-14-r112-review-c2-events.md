# R-112: pm/unit-C2b (이행 C-2: 앱 이벤트의 seq·at을 저장된 기록에서)

- 검토: ne-verify (w3:p4). 읽기 전용이고 커밋하지 않았다.
- 판: `pm/unit-C2b` = `6d9a1532294ec7d6035bc5f555dff6a6f53d026d`. main `6ef6e3ae` 위에 U-262(p4g)와 U-269(nc-human)를 얹은 판이고, U-247은 없다.
- 실제 API와 외부 네트워크는 쓰지 않았다.

## 결론

- **높음 0, 중간 0, 낮음 1(전부터 있던 것), 참고 1.**
- C-2로 바뀐 값이 GUI를 틀어지게 하는 곳은 찾지 못했다.
  - 실행 이벤트의 `seq`·`at`은 이제 파일의 줄과 같다. 앞에서 앱이 세던 `seq`와도 같은 수다.
  - 렌더러는 `seq`를 쓰지 않는다. 쓰는 곳은 엔진 호스트의 틈 검사 하나다.
- 시험
  - 루트 build: exit 0
  - GUI `npm test`: 336/336
  - smoke 조용함: 220/220
  - smoke 부하: 처음 219/220(`openCheck`, 참고 I-1), 다시 두 번 220/220

## 1. 시험

판 사본 `.codaryn/r112/c` = `6d9a1532`.

| 시험 | 결과 |
|---|---|
| 루트 `npm run build` | exit 0 |
| GUI `npm test`(빌드 포함) | 336/336 |
| smoke 조용함 | 220/220, 28초, 시작 때 CPU 22%, node 22개, hostEndsWhenMainKilled 109 ms |
| smoke 부하(처음) | 219/220, 146초, CPU 100%, node 144개. 실패 `openCheck`: `{"held":"held","runOff":[false,true],"freed":"timeout","runOn":false}` |
| smoke 부하(다시 1) | 220/220, 77초, CPU 100%, node 112개 |
| smoke 부하(다시 2) | 220/220, 72초, CPU 100%, node 85개 |

- 부하는 claude-operations worktree의 dist에서 루트 unit·integration을 두 갈래로 돌린 것이다.
- 기록: `r112/series.log`, `series2.log`, `smoke-*.log`

## 2. GUI가 이벤트의 seq·at에 기대는 곳 (`gui/src`)

- `seq`
  - 엔진 호스트 `gui/src/engine-host/runs.ts`의 `launch`가 받은 기록의 `seq`가 앞 것보다 2 이상 뛰면 "틈" 항목을 넣는다.
  - 그러면 렌더러(`run-model.ts`)가 `gap`을 켜고, 실행 화면(`run-screen.ts`)이 `run.gap`("Some progress lines are missing. The result's records have all of them.")을 보인다.
  - 렌더러의 진행 항목에는 `seq`가 없다. 순서는 도착 순이다.
  - 기록 탭(`report/run-log.ts`)은 파일의 기록을 따로 읽는다. 이벤트와 `seq`로 대조하는 곳은 없다.
- `at`
  - 진행 줄의 시각(`run-screen.ts`의 `localTime(item.at)`)
  - 기록 탭의 시각(파일의 `at`)
  - 이제 둘이 같은 값이다. 앞에서는 앱 시계를 저장 뒤에 읽어 몇 ms 늦었다.
  - `at`으로 정렬하거나 비교하는 곳은 없다.
  - 그 밖의 `.at`(`cleanup-previews`, `history`, `plans`, `settings-proposals`의 만료)은 이벤트가 아니다.

**판의 빌드로 잰 것**(`.codaryn/r112/probe/seq.mjs`)
- 방법: 판의 저장소 기록(`appendOnlyJournal`)을 앱의 감싸개로 싸서 기록을 넣는다. 전달된 기록과 파일의 줄을 맞대고, 엔진 호스트의 틈 규칙(`seq > last + 1`)을 센다.

| 경우 | 저장 | 전달된 seq | 파일과 seq·at 같음 | 틈 규칙 | `append`가 돌려준 것 = 파일의 줄 |
|---|---|---|---|---|---|
| 실행(3기록) | 3 | 1,2,3 | 예 | 0 | 예 |
| 적용(동작 2개) | 6 | 1,3,5,6 | 예 | **2** | 예 |

- 앱 실행과 적용은 늘 새 실행 id의 새 기록이다. 그래서 저장소의 `seq`는 1부터다.
- 엔진의 모든 기록은 앱의 감싸개를 지난다. 조립 때 저장소 바로 위에 놓이고(`app.ts` 325행), CLI의 감싸개들은 그 위다.
- 그래서 새 `seq`는 앞의 앱 셈과 같은 수다. 같은 실행의 기록을 이어 쓰는 길(저장소 66행, 줄 수부터)은 앱의 이벤트 길에 없다.

## 3. 발견

### L-1 (낮음, C-2 전부터) GUI의 적용은 늘 "진행 표시 일부가 빠졌습니다"를 띄운다

- 적용의 `plan_item_started`(R-9 I-4)는 저장되지만 전달되지 않는다.
  - 그래서 동작마다 전달된 `seq`가 하나 건너뛴다(위 표: 1,3,5,6).
  - 엔진 호스트의 틈 규칙은 그것을 빠진 진행으로 본다.
- 적용도 같은 규칙을 지난다: `startApply` → `launch`.
  - 바꾸기 계획의 적용도 `onRunEvent`가 `onEvent`로 간다.
- 그래서 동작이 하나라도 있는 GUI 적용은 실행 화면에 `run.gap` 알림이 뜰 것이다. 진행은 빠지지 않았는데도 그렇다.
- C-2 전에도 같았다. main `6ef6e3ae`의 `applyJournalWithEvents`도 `plan_item_started`를 세고(`seq += 1`) 건너뛰었다.
- GUI 시험 어디에서도 `run-gap`을 보지 않는다.
- 제안: 틈 규칙이 적용의 알려진 건너뜀을 틈으로 세지 않게 한다. 방법은 둘이다.
  - 전달 쪽이 건너뛴 수를 알린다.
  - 엔진 호스트가 적용에서 `plan_item_started` 자리를 기대한다.
- 담당은 p5u-gui·p5a다. 실제 창에서 보이는지는 M-7.5나 M-3.1의 적용 때 사람이 확인할 수 있다.

### 참고

- **I-1**: 부하 smoke의 처음 실패(`openCheck`, `runOff: [false, true]`)는 이 판에 U-247이 없어서 나는 이미 알려진 경합이다.
  - 9e63369가 고친 것으로, 그 커밋 설명에는 "the smoke's openCheck read it then once in three runs"라고 되어 있다.
  - 다시 점검하는 동안 잠금이 풀린 것으로 세어져, 그 사이 그린 화면이 실행 단추를 켰다.
  - C-2의 이벤트 값과는 상관없는 길이다. 열기 점검은 `doctor`의 답을 쓴다.
  - 다시 돌린 두 번은 통과했다.

## 4. 판정 근거로 본 것

- `git diff 6ef6e3ae 6d9a1532`
  - `src/app/events.ts`, `src/app/apply.ts`, `src/contracts/journal.ts`, `src/store/journal.ts`
  - `src/cli/run.ts`, `src/cli/plan-commands.ts`, `src/cli/progress.ts`, `src/engine/index.ts`
- 판의 GUI 코드
  - `gui/src/engine-host/runs.ts`(`launch`, `startApply`)
  - `gui/src/renderer/run/run-model.ts`, `run-screen.ts`
  - `gui/src/renderer/report/run-log.ts`
  - `git grep "\.seq\b|seq:|\.at\b|gap" -- gui/src`
- 탐침(커밋하지 않음): `.codaryn/r112/probe/seq.mjs`. 판 사본의 빌드를 불러 쓴다.
