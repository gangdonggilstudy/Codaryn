# R-107 검토: U-213 읽기 다시 시도 정책 P5 (읽기 전용)

- 검토: ne-verify (w3:p4). 커밋하지 않았다.
- 대상: `unit/U-213-p5u-gui`의 끝 `dcde67a10a9b8cde2740df9a275987ac18ceaa14`
  - `0a8d4b98`: P5
  - `dd96be1c`: main `f52c228`(U-203)을 받아 충돌을 푼 병합
  - `349aae33`: 시계 눈금의 틈을 적은 주석
  - `dcde67a1`: Codex V-16 고침
- 비교한 main: `cff3c764d7ab6a4e4b3d4fb52f32445a58b7a36e`. 두 판 모두 `git archive` 사본으로 빌드했다.
- 오늘의 main(`cff3c76`, U-220 포함)과 `git merge-tree --write-tree`는 충돌 없이 끝난다(트리 `2dcc8c6`).
- 실제 API, 외부 네트워크, 임시 worktree는 쓰지 않았다.

## 결론

- **발견: 높음 0, 중간 0, 낮음 0.** 참고 넷(5절).
- 충돌을 푼 곳에서 U-203의 "읽을 수 없는 경로는 세기 전에 뺌"과 U-189의 신원 대조·다시 걷기가 둘 다 살아 있다.
  - 다시 시도는 U-213대로 신호와 시간 한도를 받는다.
- 몰아치기 거부(측정 두 번 합계)는 제안만큼 줄었다.
  - `read_file`: main 138/600(23%) → head 7/600(1.2%)
  - 목록·inspect: main 184/960(19%) → head 12/960(1.25%)
  - 제안 때 측정은 각각 30→1/300, 92→5/480이었다.
- 조용할 때 시간은 늘지 않았다. 첫 시도가 성공하면 코드 경로가 main과 같고, 잰 값의 차이는 부하의 흔들림 안이다.
- 시험
  - 루트 build: exit 0
  - GUI `npm test`: 315/315
  - smoke 두 번: 219/219, 219/219
  - (덧붙임) 루트 unit: 3,755건, 통과 3,750, 실패 0, 건너뜀 4, todo 1
  - (덧붙임) 루트 integration: 610/610

## 1. 충돌을 푼 곳

### 1.1 `search_files` (`src/tools/index.ts`, 손으로 푼 충돌)

순서는 다음과 같다.
1. `retryDeadline()`로 한도를 정한다. U-203 스냅숏보다 앞이라, 스냅숏 시간도 2초에 든다. 병합 메시지가 밝힌 대로다.
2. U-203 `unreadable.snapshot`을 뜬다.
3. 목록을 만든다.
   - 읽을 수 없는 경로가 없으면 `workspace.list(path, { signal, retryUntil })`
   - 있으면 `listVisible(workspace, path, hidden, { signal, retryUntil })`
4. 항목마다 `hidden.covers(entry.relative)`면 건너뛴다.
5. 다시 `resolve`한 실제 경로가 `hidden.covers`면 읽지 않는다. 숨은 곳을 가리키는 링크다.
6. `workspace.readText(file.path, { signal, retryUntil })`로 읽는다. `io_error`면 `truncated = true`다(U-189 V-10b).

U-203의 거르기 둘(이름, 링크의 실제 경로)과 U-189의 `truncated`가 모두 남았다. 목록과 모든 읽기가 같은 한도를 쓴다.

### 1.2 `listVisible` (`src/tools/visible-list.ts`, main 쪽 파일에 병합이 더한 것)

- 병합이 바꾼 것은 import와 `listVisible` 한 함수뿐이다(`git diff f52c228 dd96be1c`). `listOnce`는 main 그대로다.
- U-203
  - `hidden.covers(childRelative)`면 `pending`에 넣기 전에 건너뛴다.
  - 폴더도 파일도 아닌 항목(링크·정션)은 `leadsToVisible`로 실제 경로를 보고, 숨은 곳이거나 찾을 수 없으면 뺀다.
  - 500개 상한(`MAX_SEARCH_ENTRIES`)은 그 뒤 `entries`로 센다. 그래서 숨은 항목이 수와 `truncated`에 끼지 않는다.
- U-189
  - 처음과 끝에 `walkChain` → `sameChain`을 한다.
  - 폴더마다 `readdir` 전에 `watch.enter`를 하고, 끝에 `watch.unchanged()`를 본다.
- U-213: `retried(listOnce, { signal, until: retryUntil ?? retryDeadline() })`. 옵션 없이 불러도 2초 한도가 있다. `Workspace.list`와 같다.

### 1.3 `inspect_files` (`src/tools/workflow-tools.ts`, 자동 병합)

- `inspectOnce`는 시도마다 U-203 스냅숏을 새로 뜬다.
- `walk`가 하는 일
  - 폴더마다 `watch.enter`를 한다(U-189).
  - `hidden.covers(relative)`면 `found`에 넣기 전, 상한 비교 전에 건너뛴다(U-203).
- 시도 하나는 `walkChain` → `inspectOnce` → `walkChain`·`sameChain`·`watch.unchanged()`다. 이것이 `retried(…, { signal, until: retryDeadline() })` 안에 있다.
- 신호로 끝나 `changed`면 `cancelled`를 준다. 이미 있는 문구다.

### 1.4 `Workspace.readText`·`list` (`src/workspace/workspace.ts`)

- `readChecked`의 순서는 그대로다: 걷기 → 열기(O_NOFOLLOW, ELOOP는 changed) → 연 핸들 `stat`의 `sameId` → 다시 걷기 `sameChain` → 읽기.
- 바뀐 것은 `retried(attempt, { signal, until: retryUntil })` 한 줄이다. 한 번의 읽기에는 따로 한도가 없다.
- `list`는 `retryUntil ?? retryDeadline()`이다.

### 1.5 `retried` (`src/workspace/guard.ts`)와 V-16

- `GUARD_ATTEMPTS = 6`, `GUARD_PAUSES_MS = [0, 0, 50, 200, 500]`, `GUARD_TIME_LIMIT_MS = 2000`. 제안 P5와 같다.
- 첫 시도는 늘 한다.
- `changed`이고 6번 전이고 신호가 없으면 다음을 본다.
  - 기다리기 전: `now + pause >= until`
  - 기다린 뒤: `aborted || now >= until`. Codex V-16의 고침이다.
  - 기다림 0인 두 번은 기다리기 전 검사로 덮인다.
- U-189의 V-10b 시험은 3을 `GUARD_ATTEMPTS`로 바꿨다. 약해진 것이 아니라 정책을 따른 것이다.

### 1.6 신호를 넘기지 않는 읽기 (참고 O-1)

- `src/verify/index.ts:203`(파일 규칙의 `contains`류)과 `src/app/changes.ts:160`(변경 보기)은 옵션 없이 `readText`를 부른다.
- 그 기다림(가장 길게 750 ms)은 취소로 끊기지 않는다.

## 2. 측정 (네 측정 틀, 판 자체의 빌드)

- 틀: `.codaryn/rr`의 `actors.mjs`, `readbench.mjs`, `listbench.mjs`를 `.codaryn/r107/rr/`로 복사했다.
  - 실험 변수 대신 `CODARYN_RR_DIST`로 판의 `dist`를 부른다. 그래서 정책은 판에 빌드된 그대로다.
- 경우와 크기는 [읽기 거부 측정](report-read-refusals.md)과 같다.
  - `read_file`: 경우마다 150회
  - 목록·inspect: 조작마다 40회
- 경우마다 main과 head를 번갈아 돌려 같은 부하를 받게 했다. 처음부터 끝까지를 두 번 했다.
- 기록
  - `r107/rr/drive.log`: 1회, 시작 때 node 21개
  - `r107/rr/drive2.log`: 2회, 시작 때 node 22개, 도중 49개, CPU 51%
  - `r107/rr/results.jsonl`

### 2.1 몰아치기 (1초 동안 쉬지 않는 생성·삭제, 2초 쉼)

`read_file`(150회 중 io_error):

| 경우 | main 1회 | head 1회 | main 2회 | head 2회 |
|---|---|---|---|---|
| burst-parent | 30 | 2 | 28 | 3 |
| burst-root | 45 | 2 | 35 | 0 |
| 합계 | 75/300 | **4/300** | 63/300 | **3/300** |

목록·inspect(40회 중 io_error, 순서는 list . / inspect . / inspect src):

| 경우 | 크기 | main 1회 | head 1회 | main 2회 | head 2회 |
|---|---|---|---|---|---|
| burst-root | small | 8/7/8 | 2/0/0 | 8/8/6 | 1/0/0 |
| burst-root | medium | 9/8/9 | 2/0/0 | 9/6/8 | 1/0/1 |
| burst-parent | small | 9/10/9 | 1/1/0 | 9/7/8 | 0/1/1 |
| burst-parent | medium | 0/9/11 | 0/0/0 | 0/9/9 | 0/1/0 |
| 합계 | | 97/480 | **6/480** | 87/480 | **6/480** |

- 두 번 합계
  - `read_file`: 138/600 → 7/600
  - 목록·inspect: 184/960 → 12/960
- 조작별 head 합계: list . 7, inspect . 3, inspect src 2.
- 이번 main의 거부율(23%, 19%)은 제안 때 P0(10%, 19%)보다 높다. 기계 부하와 타이밍 탓이다. head의 비율(1.2%, 1.25%)은 제안 때 P5(0.3%, 1%)와 같은 크기다.
- burst-parent·medium의 `list .`이 0인 까닭은 이렇다. 목록은 이름 순으로 500개에서 멈춘다. `node_modules`가 앞을 채워 `src`를 펼치지 않는다.

시간(head, ms)
- 몰아치기에서 `read_file`의 p50은 1.8~13.5, p95는 6.3~117, 최대는 789~1,047이다. 최대는 긴 기다림을 쓴 읽기다.
- 목록·inspect의 최대는 1회 1,809, 2회 2,583이다. 5절 O-2를 본다.

### 2.2 조용할 때와 실제와 가까운 활동

`read_file`
- io_error: 여섯 경우 × 150회 × 두 번 × 두 판에서 **모두 0**이다. 경우는 idle, after-command, watcher, autosave 둘, sync다.
- idle의 시간

| | main 1회 | head 1회 | main 2회 | head 2회 |
|---|---|---|---|---|
| p50 | 1.7 | 1.7 | 1.6 | 3.8 |
| p95 | 3.2 | 2.2 | 2.2 | 13.1 |

- 2회의 head는 높았다. 같은 2회에 main도 흔들렸다. 예를 들어 autosave-inplace의 p50이 main 73.7, head 15.7이었다. 첫 시도가 성공하는 읽기는 두 판의 코드 경로가 같다. `retried`는 첫 결과가 `changed`가 아니면 곧바로 돌려준다. 그래서 이 차이는 부하로 본다.

목록·inspect
- idle·small의 p50(list . / inspect . / inspect src)

| | 1회 | 2회 |
|---|---|---|
| main | 5.1 / 20.4 / 16.7 | 11.0 / 54.6 / 46.5 |
| head | 4.0 / 12.9 / 10.8 | 9.6 / 38.3 / 30.7 |

- medium도 비슷하거나 head가 빠르다. 늘어난 곳은 없다.
- 실제와 가까운 활동에서도 드물게 거부가 났다(참고 O-3).
  - main: 12/1,920. 1회 sync·medium `inspect .` 11/40, 2회 watcher·medium `inspect .` 1/40.
  - head: 3/1,920. 1회 sync·medium `inspect .` 2/40, 2회 autosave-safe·small `inspect .` 1/40.
  - 제안 때 측정(0/2,880)과 다르다. 1회의 sync·medium은 main의 `inspect .` p95가 929 ms로 걷기가 느렸을 때다. 같은 경우 2회는 두 판 모두 0이었다.

### 2.3 쉬지 않는 생성·삭제 (V-10c의 경우, 참고)

| 경우 | main 1회 | head 1회 | main 2회 | head 2회 |
|---|---|---|---|---|
| churn-parent | 139 | 74 | 72 | 58 |
| churn-root | 121 | 79 | 111 | 61 |

- head는 긴 기다림을 자주 쓴다. p50은 264~785 ms, p95는 847~1,176 ms, 최대는 1,547 ms다.
- 0이 되지 않는 것과 이 지연은 제안 때 적은 그대로다.

## 3. 시험

판 사본 `.codaryn/r107/c` = `dcde67a1`. GUI는 루트 dist를 쓰므로 루트 build가 먼저다.

| 시험 | 결과 |
|---|---|
| 루트 `npm run build` | exit 0 |
| GUI `npm test`(빌드 포함) | 315/315 |
| smoke 조용함 | 219/219, 50초, 시작 때 CPU 62%, node 24개, hostEndsWhenMainKilled 1,399 ms |
| smoke 부하 | 219/219, 75초, 시작 때 CPU 100%, node 113개, hostEndsWhenMainKilled 118 ms |
| (덧붙임) 루트 `npm run test:unit` | 3,755건: 통과 3,750, 실패 0, 건너뜀 4, todo 1 |
| (덧붙임) 루트 `npm run test:integration` | 610/610 |

- 부하는 claude-operations worktree의 dist에서 루트 unit·integration을 두 갈래로 쉬지 않고 돌린 것이다.
- 조용한 쪽의 1,399 ms는 지난번(106~108 ms)보다 길다. 그래도 그 검사의 통과 범위 안이다(`ok`).
- 기록: `r107/build.log`, `gui-unit.log`, `series.log`, `smoke-quiet.log`, `smoke-busy.log`, `unit.log`, `integration.log`, `base-build.log`(main).

## 4. 판정 근거로 본 것

- `git diff f52c228 dd96be1c -- src/tools`: 병합이 main의 U-203 위에 더한 것
- `git show dcde67a1:` 다음 파일들
  - `src/tools/visible-list.ts`
  - `src/tools/workflow-tools.ts`(`walk`, `inspectFiles`, `inspectOnce`)
  - `src/tools/index.ts`(`searchFiles`)
  - `src/workspace/workspace.ts`(`readChecked`, `list`)
  - `src/workspace/guard.ts`
- `git grep "\.readText(\|workspace\.list(\|listVisible("`: 모든 부르는 곳
- `docs/cli-contract.md`의 U-213 줄
- Codex V-16 보고(`.worktrees/codex-verify/.codaryn/verify-V16-u213.md`, 기준 `0a8d4b9`, 병합 전 판)

## 5. 참고 (발견 아님, PM 판단)

- **O-1**: 신호를 넘기지 않는 읽기 둘(1.6절)이 있다.
  - 파일 규칙 검증기의 읽기와 앱의 변경 보기다.
  - 몰아치기 중에 실행을 취소하면 파일 하나에 가장 길게 750 ms를 더 기다릴 수 있다.
  - 커밋은 "실행의 신호가 기다림을 끝낸다"고 하는데, 이 둘은 도구 밖이라 범위가 다르다.
- **O-2**: 2초 한도는 새 시도의 시작만 막는다(계약 문장과 같다). 그래서 부하에서 한 번의 걷기가 길면 호출 전체는 2초를 넘는다.
  - 2회에서 head의 `inspect src`(burst-root·small)는 2,583 ms였다.
  - `inspect .`은 2,486 ms(burst-parent·medium)와 2,422 ms(autosave-safe·small)였다.
  - 사람 쪽 문서에 "약 2초"라고 적는다면 "2초와 걷기 한 번"이 정확하다.
- **O-3**: 실제와 가까운 활동에서도 걷기가 느릴 때(부하, 큰 트리) `inspect .`이 거부될 수 있다(2.2절).
  - 다른 폴더가 자주 바뀌는 것이 원인이다. sync는 150 ms마다 바꾼다.
  - P5가 줄였지만(11→2/40) 없애지는 않는다. 큰 트리의 inspect는 걷는 동안 그 안 어느 폴더든 바뀌면 그 시도가 무효다.
- **O-4**: 오늘의 main(`cff3c76`)과 충돌은 없다. 이 검토의 시험은 `dcde67a1` 자체(main `f52c228` 기반)에서 했다. U-220과 합친 판은 돌리지 않았다.
