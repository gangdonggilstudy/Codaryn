# V-17 정확성 검증 — 앱 잠금 재해제·개인정보 설정

- 검증자: codex-review, 보안·개인정보 검토자. worktree: `D:/project/Codaryn/.worktrees/codex-verify`(detached HEAD).
- 시작 시 `git rev-parse pm/unit-A4` = **`4ab1e61241c8fdb2fe63e068045fbde335714b33`**. main = **`f52c228f6066870b52bd6467827989129d8a8e9c`**. 서로 다른 판이며 main은 요청한 기준과 일치했다.
- **높음 1 / 중간 0 / 낮음 0.** 높음은 원래 runId의 해제가 동시에 한 번 더 실행되는 조건에서, 지연 재해제가 새 소유자의 잠금을 지우는 경쟁이다. 기존 저장기의 읽기→삭제 간격이며 이번에 저장기 코드가 바뀐 것은 아니다.
- 새 설정 필드의 실제 제안·적용은 **파서 미연결로 검증 불완전**하다. 순수 넓히기 판정과 기존 필드의 확인 강제는 별도로 검증했다.
- 환경: Windows, Node `v26.13.1`. 후보 archive·재현·결과: 보고서 옆 `codex-review-v17-4ab1e612`. 이전 V-4/V-4b 보고서와 자식 소유자 스크립트는 읽기만 했고, 필요한 스크립트는 새 폴더로 복사했다.

## H-1 높음 — 지연 재해제의 소유자 확인 뒤 새 잠금이 들어오면 삭제됨

- 위치: `src/app/lock-retry.ts:63` → `src/store/lock.ts:656`의 pid/runId 확인 → `:657`의 `rm(lockFile)`.
- 재현 명령: `node --import ./guard.mjs ./locks.mjs`. 결과: `lock-results.json/race`.
  1. 프로세스 A가 run-a로 실제 acquireLock에 성공한다.
  2. 새 retryLockRelease를 예약한다. 대기는 시험용 1 ms이며, 호출되는 release는 실제 저장기 함수다.
  3. 지연 재해제가 A의 pid/runId를 읽고 확인한 뒤, **실제 rm 직전** 파일시스템 경계에서 멈춘다.
  4. 같은 원래 run-a의 releaseLock을 별도로 한 번 호출해 정상 해제한다. 그 뒤 다음 소유자가 실제 acquireLock으로 획득한다.
  5. 멈춘 rm을 진행하면 새 소유자의 lock.json이 지워지고, 지연 재해제는 `released`를 반환한다. 새 소유자는 풀기를 호출하지 않았다.

| 새 소유자 | 지연 재해제 결과 | 새 lock.json | 추가 run-c 획득 |
| --- | --- | --- | --- |
| 같은 프로세스의 다음 run-b | released | 삭제됨 | 성공 |
| 살아 있는 자식 프로세스의 run-b | released | 삭제됨 | 성공 |
| 살아 있는 자식 프로세스, 같은 문자열 run-a | released | 삭제됨 | 성공 |

- **3/3 재현**, 그중 실제 다른 프로세스 소유자 **2/2 생존 확인** 후에도 run-c가 획득했다. pid·잠금 JSON을 손으로 바꾸거나 가짜 생존 판정을 넣지 않았다. 변경한 것은 삭제 경계의 실행 순서뿐이다.
- **필요 조건을 한정한다:** 같은 원래 runId의 별도 해제가 지연 재해제와 겹쳐야 한다. 이번 시험은 새 재시도 API와 실제 저장기 API의 동시 호출이다. 정상 앱 완료 한 번만으로 중복 해제가 자동 생성되는 경로까지 재현한 것은 아니다. 그 별도 해제 없이 타이머만 실행되는 일반 순서에서 새 소유자의 잠금을 삭제했다고 보고하지 않는다.
- `git diff f52c228f 4ab1e612 -- src/store/lock.ts`의 변경은 **0**이다. V-4b에서 범위 밖으로 명시했던 한 시도 안의 읽기/삭제 경쟁을 이번에 구체화한 결과이며, U-211이 저장기에 새로 만든 경쟁이라고 분류하지 않는다. 다만 “매번 같은 runId로 부르므로 언제나 다른 잠금은 건드리지 않는다”는 보장에는 이 조건이 남는다.
- 수정 판단 지점: 같은 대상의 동시 해제와 소유권 이전을 직렬화하는 등, 확인한 소유자와 삭제 대상이 같다는 보장이 필요하다. 삭제 직전 다시 읽기만 추가하면 그 다음 간격은 남는다.

## 재시도 사이 교체·타이머 종료·대기 상한

- 첫 재시도에서 예외가 난 뒤 다음 재시도의 저장기 읽기 전에 원래 잠금을 정상 해제하고 상태를 바꿨다. 같은 프로세스 다음 runId, 실제 자식의 다른 runId, 실제 자식의 같은 runId, 파일 없음 **4조건 모두 `not_held`**, 교체 상태 보존 **4/4**.
- 실제 자식 소유자가 있던 **2조건 모두 생존 확인**. 매 호출의 workspaceRoot·runId는 원래 값이었다. 호출자가 예약 후 전달 객체의 runId를 바꿔도 복사한 원래 대상만 해제하는 것 **1/1** 확인.
- 기본 지연은 **2,000 ms + 8,000 ms**, 최대 **2회**다. 타이머 경계에서 실제 대기만 1 ms로 축소해 관찰한 요청 값과 unref 호출은 각각 `[2000,8000]`, **2/2**이며, 계속 예외이면 두 번 뒤 `left`였다. 10초를 실제로 기다렸다는 측정은 아니다.
- 저장기 내부 EPERM/EBUSY 재시도는 각 해제당 최대 6회·대기 합계 775 ms다. 두 지연 재해제가 모두 내부 재시도를 소진하면 고정 대기 합은 **11,550 ms**다. 최초 해제, I/O, 스케줄러 지연은 별도이며 전체 함수의 강제 종료 시한은 없다.
- 실제 자식 프로세스에서 잠금을 획득하고 **기본 지연**의 재해제를 예약한 뒤 다른 손잡이를 두지 않았다. 강제 process.exit 없이 **194 ms, 종료 코드 0**, 잠금 파일은 남았다. 대기 타이머는 프로세스 종료를 붙들지 않았다.
- 앱 인터페이스에 재시도 취소/close 메서드는 없고, unref는 취소가 아니다. 프로세스가 다른 이유로 계속 살아 있으면 예약된 시도도 남는다. 실제 Electron 창 종료, 이미 실행 중인 파일 I/O 도중의 종료는 실행하지 않았다. 결과: `lock-results.json/between`, `timers`.

## U-204 넓히기 판정

- `node ./settings.mjs`, `settings-results.json/paths`, `k`, `sources`.
- config/profile/workflow 각 원천에서 경로 변화 **11종 × 3 = 33건**, k 변화 **25종 × 3 = 75건**, 원천 간 대조 **6건**, 총 **114건 기대와 일치**. 넓히기를 좁히기로 판정하는 입력은 이 표에서 발견하지 못했다.

| 입력 | 결과 |
| --- | --- |
| unreadablePaths의 a → a/b | 세 원천 모두 해당 목록의 unreadable_path_removed |
| 항목 제거·목록 없음·a → a/b와 c 추가 | 모두 해당 목록의 넓히기 |
| a/b → a | 링크의 실효 범위 차이를 보수적으로 보아 넓히기 |
| 같은 항목 순서 변경·Windows 대소문자·끝 구분자·역슬래시·./ | unreadable_path_removed 없음 |
| 항목 추가 | unreadable_path_removed 없음 |
| k 없음/5/6/10/20의 모든 전후 조합 | 실효 k가 낮아질 때 해당 원천의 min_group_size_lowered |
| config의 제외를 profile에만 옮김 | config의 제거로 표시 |
| 한 profile의 제외를 다른 profile로 옮김 | 원래 profile의 제거로 표시 |
| profile에서 뺀 항목이 config에 그대로 있음 | 별도의 unreadable_path_removed 없음 |
| profile k=12→11, config k=10 / 20 | 전자는 k 낮춤, 후자는 config에 가려 실효 낮춤 없음 |
| config k=10→6, profile k=20 유지 | config 자체의 낮춤을 누락하지 않음 |

- profile/workflow의 객체가 바뀌면 기존 `profile_changed`/`workflow_changed`도 생긴다. 따라서 그 원천의 순서·철자 변경이 새 읽기 제외 전용 경고를 만들지 않는다는 뜻이며, **전체 widening 목록이 항상 비어 있다는 뜻은 아니다.**
- privateDataOf는 config의 목록·configured/effective k·범위 5~1000을 보여 주고 profile 값을 섞지 않는 것 **3조건** 확인했다.

## U-215 실제 제안·적용과 확인 우회

- 실제 createCodarynApp의 createSettings로 새 실험 폴더에 설정을 만들었다. env는 빈 객체로 전달했고, 파일 읽기는 그 폴더 안으로 한정했다. 실제 키·환경 파일은 읽지 않았다.
- `unreadablePaths=[a]`, `[]`, `minGroupSize=5`, `10`과 잘못된 k `4`, `0`, `1001`, `5.5`의 **8조건 × propose/apply = 16회**가 모두 `invalid_config`, 진단 `unknown_field`, field=`policy`로 거부됐다. apply에는 확인 true와 정확한 baseDigest를 주어도 같았고 파일 바이트 변경 **0회**였다.
- **k<5 제안은 거부되지만, 범위 검사가 작동해서 거부된 증거는 아니다.** 5·10도 거부되는 상태다. 새 필드 파서 연결은 U-210 후속이라고 담당 시험 `tests/unit/app/u215-private-data-settings.test.ts:28`에 명시돼 있으며 관련 시험 **5건이 TODO 실패**다. 알려진 미연결 항목을 별도 결함 건수에 더하지 않았지만, 새 설정의 제안·대화상자·확인 후 저장을 완료 검증한 것으로 보고하지 않는다.
- 파서를 바꾸지 않고 현재 지원되는 명령 규칙 추가를 대조 입력으로 사용하여 같은 apply 경계를 시험했다. confirmWidening 없음/false/0/문자열 true/객체/배열 **6조건 모두 거부**, 파일 보존. 좁히기 제안의 baseDigest를 재사용해 next를 넓히기로 바꿔도 **재판정 후 거부**했다. 잘못된 baseDigest도 거부했다. 문자 그대로의 true는 양성 대조에서 저장됐다. **거부 8 / 허용 대조 1**.
- `src/app/settings-change.ts:442`는 실제 새 설정을 다시 판정하고 확인 true를 요구한다. 앱 API는 사람의 클릭을 직접 증명하지 않고 신뢰한 호출자의 bool을 받는 계약이다. GUI main은 저장된 제안을 token으로 꺼내며, 알 수 없는 넓히기는 거부하고 `confirmWidening` 대화상자에서 승인한 뒤 host를 호출한다(`gui/src/main/ipc.ts:499`~510, 코드 확인). renderer가 준 next나 bool을 그대로 적용하는 경로는 그 코드에서 확인되지 않았다. 실제 GUI 대화상자는 실행하지 않았다.

## 실행 명령·시험 수치

- 후보 TypeScript 컴파일 통과.
- 관련 유닛 파일 **8개**, suite **19개**, 시험 **63건: 통과 58 / 일반 실패 0 / 건너뜀 0 / TODO 5**, **11,941.2132 ms**, 종료 코드 0. TODO 5건은 실제 단언 실패이며 통과로 세지 않았다. 원문: `unit-tests.tap`.
- 관련 시험에는 앱 실행·checkApply·writeWorkspaceText의 재시도 연결과 실제 Windows 파일 손잡이 때문에 해제가 실패하는 사례가 포함된다. 전체 시험 묶음은 실행하지 않았다.

관리 저장소에서 먼저:

```powershell
Get-Content -LiteralPath AGENTS.md -Encoding UTF8
git status --short
git branch --show-current
git rev-parse --show-toplevel
git rev-parse pm/unit-A4
git rev-parse main
git rev-parse f52c228f
git diff f52c228f pm/unit-A4 -- src/app src/contracts
```

지정 worktree에서:

```powershell
git archive --format=tar --output=.codaryn/codex-review-v17-4ab1e612/candidate.tar 4ab1e61241c8fdb2fe63e068045fbde335714b33
tar -xf .codaryn/codex-review-v17-4ab1e612/candidate.tar -C .codaryn/codex-review-v17-4ab1e612/candidate
```

candidate에서 컴파일, 실험 폴더에서 재현:

```powershell
node 'D:\project\Codaryn\node_modules\typescript\bin\tsc' -p tsconfig.json --pretty false
node --import ./guard.mjs .\locks.mjs > .\lock-output.json
node .\settings.mjs > .\settings-output.json
node .\run-tests.mjs
```

- 래퍼는 `node --import <guard.mjs의 file URL> --test --test-reporter=tap`에 `dist/tests/unit/` 아래 `app/u211-lock-retry`, `app/u204-unreadable-k-widening`, `app/u215-private-data-settings`, `app/u193-lock-left`, `app/settings-change`, `app/settings-widening-precision`, `app/settings-workflow-rules`, `store/u176-lock-release`의 `.test.js`만 전달했다. TEMP/TMP는 새 실험 폴더 아래이며 삭제 guard가 절대·실효 대상 경로를 검사했다.
- `git diff --check f52c228f 4ab1e612 -- src/app src/contracts` 통과. 종료 시 관리 저장소·지정 worktree의 추적 변경 없음.
- 저장소 추적 파일 수정 0, 커밋 0, 푸시 0, worktree 추가 0, 실제 API 0, 네트워크 0, 실제 키 조회 0, 권한 요청 0. 새 실험 폴더와 이 보고서만 작성했다.
