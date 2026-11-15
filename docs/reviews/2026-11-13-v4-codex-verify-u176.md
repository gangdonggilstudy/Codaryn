# V-4 정확성 검증 — U-176

- 검증자: codex-review, 보안·정확성 검토자. 작업 worktree: `D:/project/Codaryn/.worktrees/codex-verify`(detached HEAD).
- 비교: main `07cd600` → `pm/unit-U-176`의 `b5c7fa5`(구현 `2509f10`). 검토 파일: `src/store/lock.ts`.
- 설계 근거: `claude-tools/.codaryn/report-N-C.md`의 U-176 절과 그 절이 참조하는 `report-U176.md`.
- 환경: Windows, Node `v26.13.1`. 실험 폴더: 이 보고서 옆 `codex-review-v4-b5c7fa5`.
- **높음 1건 / 중간 3건 / 낮음 0건. 살아 있는 다른 프로세스의 잠금 보존 불변식 위반 3/3회 재현.**

## H-1 높음 — 회수 중 다른 프로세스의 새 잠금을 옮기고 삭제함

- 위치: 후보 `src/store/lock.ts:643`의 자기 잠금 회수 진입, `:629`의 재확인, `:433`의 rename, `:447`의 복원 시도, `:455`의 이동 파일 삭제.
- 재현: `node ./probe.mjs`, `results.json`의 `races`, `kind:"scheduled"` 3건.
  1. 부모 A가 `run-a`를 획득한다. 삭제 syscall에만 `EBUSY`를 주입하여 풀기 6회가 실패하게 한다. A의 잠금이 남는다.
  2. A의 새 획득이 남은 잠금을 회수한다. 회수 파일 획득 및 내용 재확인이 끝난 뒤, 실제 rename 직전에 파일시스템 경계에서 실행 순서를 멈춘다.
  3. 원래 `run-a`의 `releaseLock`을 다시 호출한다. 이번에는 실제 삭제가 성공한다. 실제 자식 프로세스 B가 `child-b` 획득에 성공하고 계속 살아 있다.
  4. 회수기의 rename을 실행하면 **B의 살아 있는 잠금**이 `.stale`로 이동한다. 그 빈 이름으로 실제 자식 프로세스 C가 `child-c` 획득에 성공한다.
  5. 회수기는 이동한 내용이 예상과 다름을 확인하지만, C의 파일 때문에 원위치 링크가 `EEXIST`로 실패한다. 이어 B의 `.stale` 파일을 삭제한다.
- 3/3회: 원래 소유자의 재풀기 `true`, B 획득 `true`·생존 `true`, C 획득 `true`·생존 `true`, 최종 `lock.json=child-c`, B의 이동 파일 존재 `false`. B와 C 어느 쪽도 결과 측정 전에 풀기를 호출하지 않았다.
- 실제 자식 프로세스·실제 파일·실제 acquire/release 사용. 가짜 pid 생존 판정이나 손으로 바꾼 잠금 내용은 사용하지 않았다. 최초 삭제 오류와 rename 경계의 실행 순서만 통제했다. 결과는 자연 발생 빈도가 아니라 해당 순서의 재현 성공률이다.
- `removeIfUnchanged` 자체는 기존 코드다. 새 자기 잠금 회수 경로에서, 아직 살아 있는 원래 프로세스의 재풀기와 충돌하는 순서를 확인했다. 기준 판의 같은 자기 잠금 풀기 실패 후 획득 대조: `ok:false`, rename 0회(`focused-results.json`).

## M-1 중간 — 내용이 같은 실패한 획득 시도가 기존 소유자의 등록을 지움

- 위치: `src/store/lock.ts:323`, `:664`, `:686`.
- 재현: 같은 작업공간·같은 `runId=run-a`·같은 clock 값으로 순서대로 두 번 acquire한다. 첫 번째는 성공, 두 번째는 거부된다. 세 번째는 `runId=run-c`로 acquire한다. 첫 소유자는 풀지 않는다.
- 두 시도의 `ownKey`가 같다. `Set.add`는 별도 소유권을 만들지 않고, 실패한 두 번째 시도의 `finally`가 첫 소유자의 키까지 삭제한다.
- 기준 판: `[true,false,false]`, 두 번째 뒤 `held`, 최종 `run-a`.
- 후보: **`[true,false,true]`**, 두 번째 뒤 **`stale`**, 최종 **`run-c`**.
- 재현 명령: `node ./probe.mjs`. 결과: `cases`, `kind:"active-owner", variant:"identical"`. 입력 clock은 계약에 주입하는 고정 밀리초 값이다. 다른 runId 두 개의 일반 중복 획득은 두 판 모두 두 번째를 거부했다.

## M-2 중간 — 경로 표기·원문 변경만으로 진행 중인 자기 잠금을 남은 잠금으로 판정

- 위치: `src/store/lock.ts:323`, `:340`. 등록 키가 파일시스템상의 동일 파일이나 안정적인 소유권 대신 경로 문자열과 원문 전체에 의존한다.
- 재현 A: 실제 경로로 `run-a` 획득 후, 같은 Windows 경로를 `root.toUpperCase()`로 전달하여 `run-b` 획득. 파일과 잠금 내용은 손대지 않는다.
- 재현 B: 정상 획득한 잠금 JSON을 들여쓰기만 바꾸거나, `runId` 또는 실행 `startedAt`만 수정한 뒤 새 획득. pid와 `processStartedAt`은 유지한다.

| 입력 | 기준 판 두 번째 획득 | 후보 두 번째 획득 |
| --- | --- | --- |
| 경로 대소문자만 변경 | 거부 | **성공** |
| JSON 들여쓰기만 변경 | 거부 | **성공** |
| runId만 변경 | 거부 | **성공** |
| 실행 startedAt만 변경 | 거부 | **성공** |

- 후보 4/4회 첫 소유자가 풀지 않은 잠금을 회수했다. 경로 별칭 사례는 손으로 잠금 파일을 바꾸지 않는 재현이다.
- 명령: `node ./probe.mjs`. 결과: `active-owner/case-alias`, `manual-edit/format`, `manual-edit/runId`, `manual-edit/startedAt`.

## M-3 중간 — 풀기 중 읽기 실패가 끝나도 heldLocks가 남아 후속 실행을 막음

- 위치: `src/store/lock.ts:706`, `:708`, `:722`.
- `ownText`는 매 시도 null로 시작한다. 읽기가 실패하면 마지막 시도에서도 null이므로 보유 등록을 제거하지 못한다. 오류 원인이 사라진 뒤에도 해당 프로세스의 후속 획득은 계속 거부된다.
- 실패 주입: 잠금 readText에만 `EPERM` 또는 `EBUSY`. 각각 6회 읽고 예외를 반환했다. 실패 주입을 해제한 뒤 두 경우 모두 inspect=`held`, 후속 acquire=`false`.
- **실제 Windows 재현:** 정상 획득 뒤 PowerShell의 `[System.IO.File]::Open(file,"Open","Read","None")`으로 1,600 ms 동안 파일을 연다. `releaseLock`은 830 ms 뒤 `TransientLockError`를 던졌다. 손잡이가 닫힌 뒤에도 inspect=`held`, 다음 acquire=`false`, 잠금 파일 존재=`true`.
- 명령: `node ./probe.mjs`, `node ./focused.mjs`. 결과: `results.json/release`의 read 2건, `focused-results.json`의 `real-windows-read-denial`.
- 기존 구현에도 읽기 실패 뒤 막히는 상태는 있었다. U-176의 “풀기 실패 뒤 자기 잠금 회수”가 삭제 실패에서만 작동하고 읽기 실패에서는 작동하지 않는 잔여 문제로 집계했다.

## 불변식 관련 나머지 결과

| 시험 | 결과 |
| --- | --- |
| 실제 자식 소유자, 내용 정상 | 두 판 모두 획득 거부·원문 보존 |
| 실제 자식 pid, 시작 시각 없는 옛 꼴 | 두 판 모두 획득 거부·원문 보존 |
| 실제 자식 pid·시작 시각 유지, runId만 변경 | 두 판 모두 획득 거부·원문 보존 |
| 자기 pid, 시작 시각 없음 | 두 판 모두 held·획득 거부 |
| 등록되지 않은 자기 pid, 시작 시각 정확 일치 | 기준 판 거부, 후보 회수·획득 성공 |
| 자기 pid, 시작 시각 +1 / +4,999 ms | 두 판 모두 held·획득 거부 |
| 자기 pid, 시작 시각 +5,001 / +60,000 ms | 두 판 모두 stale·획득 성공; 기존 시작 시각 오차 규칙 |
| 프로세스 시작 시각이 형식에 맞지 않음 | 두 판 모두 unreadable·획득 거부 |
| 한 프로세스의 정상 획득→해제 연속 실행 | 기준 판 20/20, 후보 20/20 |
| 자기 잠금 회수와 자식의 일반 경합 | 부모 1개만 획득, 자식 거부 |

- **손으로 소유자 정보를 바꾸는 입력의 한계:** 살아 있는 자식 잠금의 시작 시각을 +60초로 바꾸면 두 판 모두 회수했다. 후보만의 새 결함으로 집계하지 않았다. pid와 시작 시각을 모두 부모 값으로 바꾸면 후보는 회수했고 기준 판은 거부했다. pid만 부모로 바꾼 이번 입력에서는 두 판 모두 거부했다. 이는 잠금 파일의 소유자 정보를 신뢰하는 판정이며, 임의 메타데이터 변경까지 포함한 무조건 보존은 확인되지 않았다.
- 위 결과는 `results.json`의 두 판 합계 46개 시나리오 행에 기록했다. 이 중 연속 실행 2행은 각 20회 반복이다. Linux 실제 프로세스 환경은 미실행이며, 관련 기존 identity 시험은 아래 유닛 시험에 포함했다.

## 재시도 지연·기존 관련 시험

| 풀기 실패 조건 | syscall 시도 | 측정 ms | 결과 | 다음 획득 |
| --- | ---: | ---: | --- | --- |
| 삭제 EBUSY 지속 | 6 | 812 | EBUSY 예외 | 성공 |
| 삭제 EPERM 지속 | 6 | 816 | EPERM 예외 | 성공 |
| 삭제 EBUSY 두 번 후 정상 | 3 | 99 | true | 성공 |
| 삭제 EACCES | 1 | 2 | EACCES 예외 | 성공 |
| 읽기 EPERM 지속 | 6 | 801 | TransientLockError | 거부 |
| 읽기 EBUSY 지속 | 6 | 827 | TransientLockError | 거부 |
| 실제 Windows 읽기 금지 손잡이 | — | 830 | TransientLockError | 닫힌 뒤에도 거부 |

- 재시도 대기 배열 `[25,50,100,200,400]`, 대기 합계 **775 ms**, 최대 **6회**. 고정된 것은 대기 합계와 시도 횟수다. 파일 I/O·스케줄러 시간이 더해지며 전체 함수의 강제 종료 시한은 없다.
- 두 사본 TypeScript 컴파일: **2/2 종료 코드 0**.
- 후보 관련 시험 **7개 파일, 65건, 통과 65·실패 0·건너뜀 0**, 측정 **12,088.7577 ms**. 전체 시험 묶음은 실행하지 않았다.
- 파일: `lock-errors`, `lock-inspect`, `lock-identity`, `lock-no-link`, `lock-reclaim`, `lock-start-time`, `u176-lock-release`의 `.test.js`. 원문 `unit-tests.tap`.

## 실행 명령·산출물

관리 저장소 `D:/project/Codaryn`에서:

```powershell
Get-Content -LiteralPath 'D:\project\Codaryn\AGENTS.md' -Encoding UTF8
git status --short
git branch --show-current
git rev-parse --show-toplevel
git diff 07cd600 b5c7fa5 -- src/store
git archive --format=tar --output="$v4root\base.tar" 07cd600
tar -xf "$v4root\base.tar" -C "$v4root\base"
git archive --format=tar --output="$v4root\candidate.tar" b5c7fa5
tar -xf "$v4root\candidate.tar" -C "$v4root\candidate"
```

`$v4root = D:\project\Codaryn\.worktrees\codex-verify\.codaryn\codex-review-v4-b5c7fa5`의 새 폴더. `base`, `candidate` 각각에서:

```powershell
node 'D:\project\Codaryn\node_modules\typescript\bin\tsc' -p tsconfig.json --pretty false
```

실험 폴더 `$v4root`에서:

```powershell
node ./probe.mjs > ./probe-output.json
node ./run-tests.mjs
node ./focused.mjs
```

- `probe.mjs`: 두 판 비교, syscall 실패 주입, 실제 자식 프로세스 경합. 초기 실행 1회는 회수 후 잠금 파일이 없는 상태를 결과 코드가 읽다가 ENOENT로 종료했다. 검증 코드의 없음 처리만 보완하여 완료했고 최종 결과는 `results.json`에 기록했다.
- `run-tests.mjs`: TEMP/TMP를 새 실험 하위 폴더로 한정하고 `guard.mjs`로 삭제 대상의 절대·실효 경로가 실험 폴더 안인지 검사한다. `node --import <guard 파일 URL> --test --test-reporter=tap`으로 위 7개 관련 파일만 실행했다.
- `focused.mjs`: 기준 판 회수 경로 대조, 실제 Windows 읽기 금지 손잡이 재현. `holder.mjs`: 검증에서 생성한 자식 프로세스의 획득·생존 제어. 검증에서 생성한 자식만 종료했다.
- 저장소 추적 파일 수정 0, 커밋 0, 푸시 0, worktree 추가 0, 실제 API 0, 외부 네트워크 0, 키 파일 조회 0, 샌드박스 밖 권한 요청 0. Git 전역 ignore 파일 읽기 권한 경고는 승격 없이 그대로 두었다.
