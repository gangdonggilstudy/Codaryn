# V-4b 재확인 — U-176b

- 검증자: codex-review, 보안·정확성 검토자. 작업 worktree: `D:/project/Codaryn/.worktrees/codex-verify`(detached HEAD).
- 기준: main `6f9eff4ae241553c9d9759659231d1032ca10ed1`. 후보: `pm/unit-U-176b`, `078542bcb010813d947b06a13e0771863e9fa747`(담당 구현 `677ccb5`).
- 범위: `git diff 6f9eff4 078542b -- src/store`. 환경: Windows, Node `v26.13.1`.
- 실험 폴더: 이 보고서 옆 `codex-review-v4b-078542b`. 이전 V-4 폴더는 읽기만 했다.
- **새 범위의 결함: 높음 0 / 중간 0 / 낮음 0. H-1·M-1·M-2는 재현되지 않았다. M-3의 “실패 뒤 새 획득 거부” 현상은 유지되므로 네 현상이 모두 사라졌다고 판정하지 않는다. 자기 잠금 회수를 제거한 새 방침에서는 의도된 차단이며, 원래 실행의 재풀기로 복구됨을 확인했다.**

## V-4 재현 네 건

이전 `codex-review-v4-b5c7fa5/probe.mjs`를 새 폴더의 `v4-replay.mjs`로, `focused.mjs`·`holder.mjs`도 새 폴더로 복사했다. 사본의 상대 import가 새 기준·후보를 가리키며, 재현 스크립트 내용은 그대로 실행했다.

| V-4 항목 | 후보의 재실행 결과 |
| --- | --- |
| H-1 자기 잠금 회수 중 B의 새 잠금 삭제 | 예약된 순서 3/3회에서 회수 rename에 도달하지 않음. hook 진입 0, 획득 false, 원래 run-a 보존. B·C는 hook 안에서 생성하므로 이 3회에서는 생성되지 않음 |
| M-1 같은 runId·clock의 실패한 중복 획득이 등록 삭제 | `[첫 획득, 두 번째, 세 번째]=[true,false,false]`, 두 번째 뒤 held, 최종 run-a. 기준 판과 동일 |
| M-2 경로 대소문자·JSON 형식·runId·실행 startedAt 변경 | 4/4회 새 획득 거부, held 유지. 기준 판과 동일 |
| M-3 읽기 실패 뒤 같은 프로세스의 후속 획득 차단 | 지속 EPERM·EBUSY 뒤 예외 전달, held·새 획득 거부 유지. 보유 등록 표는 존재하지 않음. 원래 run-a의 release를 다시 호출하면 true, 그 뒤 새 획득 true |

- 실제 Windows 손잡이 재현도 다시 실행했다. `FileShare.None`으로 1,600 ms 동안 파일을 열었을 때 release는 **812 ms** 뒤 `TransientLockError`를 던졌다. 손잡이가 닫힌 뒤에도 held·새 획득 false·잠금 존재 true였다. 이는 새 방침의 차단 동작이다(`focused-results.json`).
- H-1의 후속 경로는 후보의 관련 회귀 시험에서도 확인했다. 원래 소유자가 정상적으로 풀고 실제 자식 B가 획득한 뒤, 부모의 재획득과 자식 C의 획득은 거부되며 B의 파일이 보존됐다.
- 원문 결과: `results.json`, `focused-results.json`, `unit-tests.tap`.

## 획득 판정의 기준 판 대조

| 검사 | 수치 |
| --- | ---: |
| livenessJudge 함수 원문 비교 | 동일 1/1 |
| inspectLock 함수 원문 비교 | 동일 1/1 |
| acquireLock 함수 원문 비교 | 동일 1/1 |
| 후보 heldLocks / isOwnLeftOver 식별자 | 0 / 0 |
| 동일 입력 표 | 29건, 결과 차이 0 |
| 이전 재현 스크립트의 시나리오 행 | 두 판 합계 46건 |
| 정상 연속 획득·해제 | 기준 20/20, 후보 20/20 |

- 29건은 같은 잠금 원문·같은 생존 조회 답으로 두 판의 inspect, acquire, 원문 보존 여부, 최종 파일 내용을 비교했다. 기준과 후보에 **같은 실제 자식의 pid·시작 시각**을 사용했다. 비교 흔들림을 막기 위해 생존·시작 시각·Linux identity 외부 조회의 답만 고정했고 파일 작업은 실제로 했다.
- 입력: 파일 없음·빈 파일·잘린 JSON·잘못된 JSON, 자기 pid의 정확한 시작 시각·옛 꼴·±1/4,999/5,001/60,000 ms, 형식/runId/실행 startedAt 변경, 잘못된 pid·누락 필드·잘못된 시작 시각, 살아 있는 자식의 현재/옛 꼴/편집된 기록, 죽은 것으로 지정한 pid, 일치/불일치/불완전 Linux identity.
- 원문 함수 SHA-256과 입력별 전후 결과는 `recheck-results.json`의 `static`, `matrix`에 기록했다. Linux identity는 조회 경계 모의이며 Linux OS에서 실제 실행한 결과가 아니다.
- 시작 시각을 크게 변조하여 기존 규칙상 stale이 되는 경우도 두 판 결과가 같았다. 기준 판과 동일하다는 결과를 임의 메타데이터 변경에 대한 새로운 보장으로 해석하지 않는다.

## 재시도 사이 소유자 변경

`node ./recheck.mjs`의 `retryOwnership`:

- 읽기/삭제 2종 × EPERM/EBUSY 2종 × 교체 상태 5종 = **20건**.
- 첫 실패와 다음 시도 사이에 원래 실행의 정상 release를 별도로 호출했다. 그 뒤 실제 자식이 같은 runId로 획득, 실제 자식이 다른 runId로 획득, 같은 프로세스의 다른 runId가 획득, 파일 없음, 읽을 수 없는 JSON의 다섯 상태를 만들었다.
- 실제 자식이 획득한 경우는 **8건**이고, 결과 측정 시 모두 살아 있었다. 가짜 자식 소유자 원문을 작성하지 않았다.
- **20/20회 원래 release는 false를 반환하고 교체된 상태를 보존했다.** 바깥 release의 읽기 2회, 삭제는 최초 실패 주입 1회 또는 0회였다. 새 잠금을 삭제한 경우 0건.
- 함수는 매 재시도마다 파일을 다시 읽고 pid와 runId를 확인했다. 이는 통제한 재시도 간 교체 순서의 결과이며, 한 시도 안의 읽기와 삭제 사이까지 포함한 모든 동시 실행 순서의 원자성을 증명한 것은 아니다.

## 재시도 상한·실패 전달·복구

`recheck-results.json`의 `recovery`:

| 실패 위치·오류 | 실패 횟수 | 총 시도 | 측정 ms | 첫 release 결과 | 실패 해제 후 원래 run 재풀기 / 새 획득 |
| --- | --- | ---: | ---: | --- | --- |
| 읽기 EBUSY | 2 | 3 | 89 | true | 후속 획득 true |
| 읽기 EBUSY | 지속 | 6 | 834 | 예외 | true / true |
| 읽기 EPERM | 2 | 3 | 97 | true | 후속 획득 true |
| 읽기 EPERM | 지속 | 6 | 844 | 예외 | true / true |
| 삭제 EBUSY | 2 | 3 | 103 | true | 후속 획득 true |
| 삭제 EBUSY | 지속 | 6 | 829 | 예외 | true / true |
| 삭제 EPERM | 2 | 3 | 104 | true | 후속 획득 true |
| 삭제 EPERM | 지속 | 6 | 874 | 예외 | true / true |

- 지속 실패 4/4회에서 재풀기 전의 새 획득은 거부됐다. 실패가 사라진 뒤 같은 runId의 release를 재호출하면 잠금이 제거되고 다음 획득이 성공했다.
- 재시도 대기 `[25,50,100,200,400]` ms, 합계 **775 ms**, 최대 **6회**. 이 값은 코드가 예약하는 대기 합계다. I/O와 스케줄러 시간을 포함한 함수 전체의 강제 종료 시한은 없으며, 측정 최댓값은 **874 ms**였다.
- 읽기 지속 실패는 `TransientLockError`, 삭제 지속 실패는 해당 EPERM/EBUSY 예외로 직접 호출자에게 전달됐다. 이전 재현의 삭제 EACCES는 1회 뒤 예외였다.
- 실패 알림은 **releaseLock의 Promise 거부를 호출자가 받는 경계**까지 확인했다. 앱·CLI·GUI의 사용자 알림 표시 및 상위 호출자의 처리 전부는 이번 src/store 검증에서 실행하지 않았다.

## 관련 시험·실행 명령

- 두 사본 TypeScript 컴파일 **2/2 통과**.
- 관련 유닛 파일 **8개**, 시험 **71건**, suite **8개**, **통과 71 / 실패 0 / 건너뜀 0**, 측정 **12,094.7861 ms**.
- 파일: `lock-errors`, `lock-inspect`, `lock-identity`, `lock-no-link`, `lock-reclaim`, `lock-start-time`, `u176-lock-release`, `u176-v4-repros`의 `.test.js`. 전체 시험 묶음은 실행하지 않았다.

관리 저장소에서:

```powershell
Get-Content -LiteralPath 'D:\project\Codaryn\AGENTS.md' -Encoding UTF8
git status --short
git branch --show-current
git rev-parse --show-toplevel
git diff 6f9eff4 078542b -- src/store
git archive --format=tar --output="$v4broot\base.tar" 6f9eff4
tar -xf "$v4broot\base.tar" -C "$v4broot\base"
git archive --format=tar --output="$v4broot\candidate.tar" 078542b
tar -xf "$v4broot\candidate.tar" -C "$v4broot\candidate"
git diff --check 6f9eff4 078542b -- src/store
```

`$v4broot = D:\project\Codaryn\.worktrees\codex-verify\.codaryn\codex-review-v4b-078542b`의 `base`, `candidate` 각각에서:

```powershell
node 'D:\project\Codaryn\node_modules\typescript\bin\tsc' -p tsconfig.json --pretty false
```

실험 폴더에서:

```powershell
node ./v4-replay.mjs > ./v4-replay-output.json
node ./focused.mjs
node ./recheck.mjs > ./recheck-output.json
node ./run-tests.mjs
```

- `run-tests.mjs`는 TEMP/TMP를 새 실험 하위 폴더로 한정하고, `guard.mjs`로 삭제 대상의 절대·실효 경로를 검사한 뒤 위 8개 파일만 실행했다. 시험 원문은 `unit-tests.tap`이다.
- 새로 만든 자식 프로세스만 종료했다. 과거 검증 폴더와 저장소 추적 파일 수정 0, 커밋 0, 푸시 0, worktree 추가 0, 실제 API 0, 네트워크 0, 키 조회 0, 권한 요청 0. 새 실험 폴더와 이 보고서만 작성했다.
