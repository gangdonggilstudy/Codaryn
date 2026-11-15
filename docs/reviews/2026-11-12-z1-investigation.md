# Z-1 간헐 실패 조사 (읽기 전용, 2026-11-12)

## 0. 이해 확인

- 페르소나: 검증 엔지니어(주), 보안·개인정보 검토자(보조). 저장소 코드는 바꾸지 않았다.
- 대상 트리: `claude/security-core` `dff3ea9`.
  - `git archive`로 `.codaryn/z1/src`에 빌드 사본을 만들었다.
  - 진단 코드는 사본에만 넣었다(1.3절). 실험 자료는 `.codaryn/z1/diag`, 기록은 `.codaryn/z1/logs`.
- 호스트: Windows 11, 논리 코어 32, Node v26.13.1. 실제 API 미실행. API 주소는 닫힌 루프백이고 키 변수는 지웠다.
- 조사 중에 PM 지시로 문구 작업 두 건을 끼워 했다(`c96226b`, `315713c`, `da4a85d`, `23196e3`). 이 조사와는 무관하다.

## 1. 결론

| 가설 | 판정 | 근거 |
| --- | --- | --- |
| (a) stdout을 쓰고 버퍼가 비기 전에 `process.exit`로 끝나 잘림 | **기각(확정, 이 호스트)** | `src`에 `process.exit` 호출이 없다. `src/cli/main.ts:351-352`는 쓰기 뒤 `process.exitCode`만 정하고 이벤트 루프가 비면 끝난다. 부하 중 파이프 실험 E3: 합성 자식 560회(200 B~4 MiB, `exitCode`·즉시 `process.exit` 두 방식)와 실제 CLI 300회에서 잘림 0건. 관측된 "종료 코드 1, stderr도 비어 있음"과도 맞지 않는다 |
| (b) 시험 지원 코드의 자식 수거 시점 | **기각(코드)** | `tests/support/cli.ts:178-212`는 spawn 직후 같은 틱에 data 수신기를 달고 `close`(두 파이프가 끝난 뒤)에서 결과를 만든다. 자체 시간 초과는 `child.kill()`(:192)이라 `timedOut: true`이고 신호가 남아 증상과 다르다 |
| (b') **다른 시험이 pid로 정리하다 다시 배정된 pid의 CLI를 죽임** | **증상 일치는 확정. 실제 원인 여부는 추정(가장 유력)** | 아래 2절 |
| (c) Node 시작 실패(자원 부족) | **근거 없음(추정으로 배제)** | 부하 중 CLI 시작 9,504회와 합성 자식 수백 회에서 한 번도 나오지 않았다. Windows 시작 실패는 보통 큰 상태 코드(예: 0xC0000142)나 stderr 글을 남긴다. "종료 1, 출력 없음"과 맞지 않는다(이 부분은 실험하지 않은 지식이다) |
| 관측 (3) `cut-output` V-2 시간 시험 | **Z-1과 다른 원인. 시험 시나리오의 순서 경쟁(기제 확정)** | 3절 |

## 2. (b') pid 재사용 살해

### 2.1 확정

- **E1 증상.** 부모가 파이프로 띄운 자식을 다른 프로세스가 `process.kill(pid)`로 끝냈다.
  - Windows에서 부모가 받는 값은 항상 `code=1, signal=null`, stdout 0바이트, stderr 0바이트다.
  - 잠자는 프로세스, 시작 직후의 CLI(`--help`), 실행 중의 CLI(`doctor`) 세 경우 모두 같다.
  - 관측 (2) "CLI 자식이 종료 코드 1, 출력 없음"과 정확히 같다.
- **E6 시험 단위 재현.** 통합 전체 1회 중에 외부 프로세스가 CLI 30개마다 하나를 시작 80 ms 뒤에 죽였다.
  - 죽인 9개가 모두 `close … code=1 signal=null out=0 err=0`이었다.
  - 시험 메시지는 `exit 1, signal null, 87~102 ms, pid N, stdout "", stderr ""`(`describeRun`)이다.
  - 통합 결과는 361 통과, 22 실패다(기준 8건 + 주입 영향 14건).
- **E2·E7 Windows는 놓인 pid를 곧 다시 준다.**
  - E2: 짧은 프로세스 240개를 5.5초에 띄우니 11개가 이 실행에서 놓인 pid를 받았다. 최소 1.77초, 중앙값 2.09초 뒤다.
  - E7: 통합 2개를 돌리는 중에 놓인 pid 100개를 살폈다. +2초까지 재배정 0개, +3초와 +5초에 1개다. 그 1개는 Codaryn CLI가 아니었다.
  - 결론: 프로세스가 끝난 지 몇 초 뒤의 pid 살해는 대부분 빈 pid에 떨어진다. 드물게 다른 프로세스에 떨어진다.
- **지금 모든 브랜치에 남은 "확인 없는 pid 살해"**
  - `tests/unit/tools/cut-output.test.ts:37-50`의 `after()`가 기록된 배경 writer pid를 조건 없이 죽인다(:44).
  - writer는 시작 약 3초 뒤 스스로 끝난다(:97 `setTimeout(() => {}, 3000)`). 이 훅은 파일의 시험이 모두 끝난 뒤에 돈다.
  - 사본 실행 B·C(단위 14회)에서 이 훅의 살해 시도는 28번이었다. 27번은 이미 놓인 pid(ESRCH)였고, 1번은 살아 있는 pid였다(B-r3 `48980`, 정체 미확인).
  - 즉, 단위 전체를 돌릴 때마다 놓인 pid에 살해를 보낸다.
  - main, pm/integration과 작업 브랜치 11개 모두에 있다. `a08` 수정(`3d4509d`)은 11개 모두에 들어 있다.
  - 이것은 `tests/integration/README.md:157` 규칙("멈춘 것을 확인하지 못한 pid에만")을 어긴다. 그 규칙은 통합 시험에만 적혀 있다.
- **확인 뒤 살해(창이 좁은 같은 부류)**
  - 대상: `tests/unit/tools/exit-settle.test.ts:45-46`, `windows-cmd-real.test.ts:190, 208, 233`.
  - `process.kill(pid, 0)`로 살아 있음을 본 뒤 죽인다. 살아 있음은 같은 프로세스라는 뜻이 아니다.
  - C에서 표적을 조사하니 모두 그 시험의 잠자는 프로세스였다(sleeper 10건). 30건은 확인과 조사 사이에 스스로 끝났다.
- **pid는 기계 전체에서 공유된다.** 한 세션의 단위 실행이 놓인 pid를 죽이면, 같은 시각에 다른 worktree에서 도는 통합 시험의 CLI가 표적이 될 수 있다. "부하에서만"은 여러 세션이 동시에 시험을 돌릴 때라는 뜻과 맞는다.

### 2.2 추정

- 관측 (2) k01-integrity 2건과 (1) V-2 빈 stdout(약 235 ms)의 실제 살해자는 이 조사에서 잡지 못했다.
  - 가장 유력한 후보는 `cut-output` `after()`다(위 확정 사실들의 결합).
  - 관측 (1)은 `3d4509d` 이전이라 `a08`의 같은 결함이 후보다. 그때는 종료 코드가 기록되지 않았다.
- 제품 코드의 나무 끝내기(`src/tools/command-runner.ts:292-313`, `taskkill /PID /T /F`)는 원인이 아니라고 본다.
  - 자식이 살아 있을 때만 한다(:18, :401-404).
  - CLI의 부모는 살아 있는 시험 파일 프로세스라서, 다른 실행의 `/T`가 부모 pid로 그 CLI를 고를 수 없다.

### 2.3 이 조사의 실행 기록

| 묶음 | 동시 실행 | 반복 | 통합 실행 | CLI 시작 | 종료 1·출력 없음 |
| --- | --- | --- | --- | --- | --- |
| A(PM 지시) | 통합 3 | 3 | 9 | 2,673 | 0 |
| B | 통합 3 + 단위 2 | 3 | 9 | 2,673 | 0 |
| C(표적 조사 포함) | 통합 3 + 단위 2 | 4 | 12 | 3,564 | 0 |
| E7 | 통합 2 | 1 | 2 | 594 | 0 |
| 합계 | | | 32 | 9,504(close 9,504) | **0** |

- 통합 실패는 매번 기준 8건(실제 시험 6건)과 같았다.
- 결론: 이 조사 안에서 Z-1은 자연 재현되지 않았다. 원인 판단은 증상 일치(E1, E6)와 살해 경로 존재(2.1)에 기댄다.

## 3. 관측 (3) `cut-output` V-2 시간 시험

- 실패 값은 `'bg log: token=l1fakeTq7Rstarted background writer\n'`이었다. writer의 앞 반이 부모 줄보다 먼저 파이프에 들어갔다.
- 시나리오(`tests/unit/tools/cut-output.test.ts:105-108`)
  - 부모가 writer를 띄운 뒤(:105) `fs.appendFileSync`로 pid 파일을 새로 만들고(:106), 그다음에 자기 줄을 쓴다(:108).
  - 그 사이가 writer의 시작 시간보다 길면 순서가 바뀐다.
- **E4b(확정)**
  - 띄움과 쓰기 사이에 지연을 넣고 사본의 실행기로 돌렸다.
  - 0 ms와 20 ms에서는 20/20 기대값이다. 40·60·80·120·200 ms에서는 50/50이 위 실패 문자열과 정확히 같다.
  - CPU 부하만으로는(E4) 30/30 기대값이었다.
- **추정**
  - 지연의 출처는 새 파일 만들기의 지연으로 본다. 표본기에서 `mkdtemp`+`appendFileSync`가 통합·단위 동시 실행 중 최대 47.5~235.5 ms였고, 40 ms 초과가 회당 1~3번 나왔다.
  - 단독 실행에서는 3/3 통과다.
- **제품 결함이 아니다.**
  - 다른 프로세스의 줄이 끝을 맺어 줄 안에 비밀 앞부분이 남는 경우다. 명령이 비밀 일부를 직접 찍는 것과 같은 부류로, V-2(실행기가 자른 자리만)의 범위 밖이다.
  - 다만 같은 경쟁이 `:171` run_command 판에도 있다.
- 시험 고침 제안(담당 몫): 부모가 자기 줄을 먼저 쓰고 writer를 띄운다.

## 4. 같은 부하에서 나온 다른 단위 실패(Z-1 아님, 정보)

- `tests/unit/store/lock-start-time.test.ts:135` Z-2 end to end: B에서 2회. "the crashed run's lock is reclaimed although its pid is alive" 거짓.
- `tests/unit/store/lock-errors.test.ts:118` W-4: B에서 1회. 남은 회수 파일이 지워지지 않음.
- `tests/unit/tools/exit-settle.test.ts:141` T-2 시간 한도가 유예 안에 떨어지는 경우: B에서 2회. `timedOut`이 참.
- `tests/unit/scripts/new-candidate.test.ts:254`: B에서 1회. `git worktree list --porcelain failed`. 사본이 worktree 안 `.codaryn`에 있어 부모 저장소를 보는 환경 탓일 수 있다.
- C의 T-2 3종(`exit-settle`)은 내 진단(살해 전 PowerShell 조회 약 1초)이 정리를 늦춰 생긴 것이라 셈에서 뺐다.

## 5. 권고(담당 몫, 내가 고치지 않음)

1. `cut-output.test.ts` `after()`:
   - writer pid 살해를 없앤다. writer는 3초 뒤 스스로 끝난다. 디렉터리 삭제가 그 뒤에 되도록 기다린다.
   - 또는 `g01`처럼 시작 뒤 일정 시간(예: 2.5초)이 지난 pid는 죽이지 않는다.
2. `exit-settle`, `windows-cmd-real`의 확인 뒤 살해: 수명 상한을 두거나, 시작 시각을 함께 기록해 같은 프로세스일 때만 죽인다.
3. `tests/integration/README.md:157`의 pid 정리 규칙을 단위 시험에도 적용하도록 개발 문서에 옮긴다.
4. 재발 추적: 각 세션이 시험을 돌릴 때 `CODARYN_IT_PID_LOG`를 공용 위치(작업 디렉터리 밖)에 켜고 살해 기록(아래 preload)을 함께 남기면, 다음 Z-1 때 살해자를 pid와 시각으로 맞출 수 있다. 세션을 넘는 살해는 한 세션의 기록만으로는 잡히지 않는다.

## 6. 재현 절차(`.codaryn/z1/diag`)

- 사본: `git archive HEAD | tar -x -C .codaryn/z1/src`, node_modules 연결, `npx tsc -p tsconfig.json`.
- 사본 진단 패치: `dist/tests/support/cli.js`의 `close` 처리기에 `pidLog("close <pid> <ms> code= signal= out= err=")`를 더했다.
- `e1-kill-signature.mjs <cli>`: 외부 살해의 종료 값.
- `e2-pid-reuse.mjs 60`: pid 재배정 간격.
- `e3-pipe-exit.mjs 50`, `e3b-real-cli.mjs <cli> 100`: (a) 파이프 잘림. CPU 32개 부하.
- `e4-v2-order.mjs <dist> 30`, `e4b-v2-delay.mjs <dist> 10`: V-2 순서 경쟁.
- `drive.mjs <tag> <통합 수> <단위 수> <반복>`, `analyze.mjs <tag…>`: 동시 실행과 집계.
  - `killlog.mjs`를 `NODE_OPTIONS=--import`로 모든 시험 프로세스에 넣는다. 신호 있는 `process.kill` 호출을 대상, 살아 있음, 호출 위치와 함께 기록한다.
  - 살아 있는 대상은 이미지 이름, 생성 시각, 명령줄 성격 표시만 남긴다. 명령줄 자체는 남기지 않는다.
- `e7-reuse-probe.mjs <pidlog> 100`: 살해 없이 재배정만 관찰한다.
- `e6-inject.mjs <pidlog> <stop>`: 자기 CLI만 대상으로 한 주입이다.
- 기록: `logs/A-r*`, `B-r*`, `C-r*`(`.pids`에 spawn·close·kill 줄), `E6*`, `E7*`.
