# V-17b 재확인 — 잠금 지연 재해제

- 검증자: codex-review, 보안·개인정보 검토자. worktree: `D:/project/Codaryn/.worktrees/codex-verify`(detached HEAD).
- 대상 브랜치 끝: `unit/U-211-p5a-adapter`, **`9531b01885864c1eee6979133f468fb884bd5ad6`**. 시작 시 main과의 merge-base: **`f52c228f6066870b52bd6467827989129d8a8e9c`**.
- `git log 3303b49..9531b018 -- src`의 고침은 `9531b018` 1개다. 앱의 해제를 큐로 합쳤으며 **store 변경 0, 지연 재해제는 유지**했다.
- **기존 H-1 잔존: 높음 1 / 중간 0 / 낮음 0. 추가 결함 0.** 앱의 새 큐를 거치는 세 재현은 닫혔다. 하지만 이전 스크립트 그대로의 저장기 직접 호출 세 재현은 남으며, 외부 프로그램의 직접 삭제 후 재획득 조건도 남는다. 일반적인 다른 프로세스의 releaseLock이 부모 잠금을 지우는 경우와는 구분한다.
- 환경: Windows, Node `v26.13.1`. 새 archive·스크립트·결과: 보고서 옆 `codex-review-v17b-9531b018`.

## 이전 세 재현: 원본과 고친 앱 경로를 따로 실행

이전 `codex-review-v17-4ab1e612/locks.mjs`를 새 폴더의 `v17-replay.mjs`로 **내용 변경 없이** 복사했다. 상대 import만 새 candidate를 자연히 가리킨다.

```powershell
node --import ./guard.mjs ./v17-replay.mjs > ./v17-replay-output.json
node --import ./guard.mjs ./recheck.mjs > ./recheck-output.json
```

| 다음 소유자 | 원본: 두 번째 해제가 store.releaseLock 직접 호출 | 변경된 앱 경로: 두 번째 해제가 releaseOwnLock |
| --- | --- | --- |
| 같은 프로세스의 다음 run-b | 새 잠금 삭제, run-c 획득 | 새 잠금 보존, run-c 거부 |
| 살아 있는 자식의 다른 runId | 새 잠금 삭제, run-c 획득 | 새 잠금 보존, run-c 거부 |
| 살아 있는 자식의 같은 runId 문자열 | 새 잠금 삭제, run-c 획득 | 새 잠금 보존, run-c 거부 |

- 원본 **3/3 재현 유지**. 지연 재해제가 자기 pid/runId를 읽은 뒤 rm 직전 멈춘 동안, 큐 밖의 직접 release가 먼저 지우고 다음 소유자가 획득한다. 멈춘 rm은 여전히 새 잠금을 지운다. 결과: `lock-results.json/race`.
- 앱 경로 **3/3 차단**. 멈춘 동안 요청한 두 번째 해제는 끝나지 않고 같은 Promise의 결과를 기다린다. 그 사이 조기 획득도 거부된다. 첫 rm을 진행하면 두 호출이 한 번의 삭제 결과를 공유한다. 이후 새 소유자가 획득하고 계속 보유하며 추가 run-c는 거부된다. 삭제 호출은 각각 **1회**였다. 결과: `recheck-results.json/appReplay`.
- 양쪽 시험 모두 실제 파일·실제 저장기 acquire/release와 실제 자식 프로세스를 사용했다. 잠금 JSON·pid를 손으로 바꾸지 않았다. 삭제 syscall 경계의 순서만 통제했다. 각 표의 자식 2개는 관찰 시 살아 있었다.
- 따라서 “앱의 고친 해제 경로는 닫혔다”와 “이전 직접 저장기 재현도 더 이상 성립하지 않는다”는 다른 판정이다. 후자는 성립하지 않는다.

## 앱 안에서 한 runId의 동시 해제

- `src/app/lock-retry.ts:103`의 releaseOwnLock은 실행 중 Promise를 공유하고, `:131`의 retryLockRelease는 대기 중 재시도 묶음도 공유한다. 첫 해제가 답한 동안 남은 재시도는 저장기에 다시 묻지 않는다.
- 동일 경로·Windows 대소문자·`/.`·끝 구분자 **4조건**에서 두 요청의 Promise가 같았고, 실제 release 호출 **각 1회**, 동시 실행 최대 **각 1개**였다.
- 재시도 두 요청을 겹치고 매번 예외를 주면 Promise 하나를 공유하여 **총 2회**만 시도하고 둘 다 left였다. 두 번째 요청의 다른 지연 옵션은 사용하지 않았다.
- 타이머 대기 중 즉시 해제가 성공한 뒤 run-b가 획득하면, 대기 중 재시도는 저장기를 부르지 않았다(**0회**). 앞서 얻은 released 답만 반환했고 run-b를 보존했다.
- 관련 시험의 run finish·checkApply·writeWorkspaceText 각각에서도 큐 공유가 통과했다. 해당 제품 호출부는 `src/app/assemble.ts:119`, `:130`, `src/app/check-apply.ts:213`, `src/app/workspace-text.ts:455`다. 세 경로는 createWorkspace의 실효 workspace.root를 전달한다.
- 이 결과는 **같은 앱 모듈의 releaseOwnLock 경로**에 대한 것이다. 큐는 store.releaseLock 자체를 감싸거나 변경하지 않는다. 직접 저장기 호출 및 다른 프로세스와 큐가 공유되는 보장은 없다.

## 다른 프로세스와 겹치는 길·남긴 근거

`recheck.mjs`의 실제 자식 프로세스 시험:

1. 부모 A가 자기 잠금의 지연 재해제에서 소유자를 확인한 뒤 rm 직전에 멈춘다.
2. 살아 있는 자식 B가 정상 store.releaseLock을 A의 runId로 호출한다. **false**다. 이어 B의 acquire도 **false**이며 A의 잠금은 그대로다. pid 확인이 작동한다.
3. 같은 자식 B가 이번에는 **파일시스템 unlink로 lock.json을 직접 삭제**하고 정상 acquire로 run-b를 획득한다. **성공**한다.
4. 멈춘 부모 rm을 진행한다. B의 잠금은 삭제되고 지연 재해제는 released다. B는 살아 있고 풀기를 호출하지 않았는데 run-c의 acquire가 **성공**한다.

- 정상 다른 프로세스의 해제/획득 대조 **1/1 차단**, 외부 직접 삭제 조건 **1/1 재현**. 결과: `recheck-results.json/crossProcess`.
- **남는 조건은 명확하다:** 부모가 살아 있고 소유자를 확인한 뒤 실제 삭제하기 전, 같은 프로세스에서 큐 밖 해제가 선행하거나, 사람/다른 프로그램이 잠금 파일을 직접 삭제하여 새 소유자가 그 이름을 획득해야 한다. 정상 다른 pid의 releaseLock만으로는 이 조건을 만들지 못했다.
- **담당은 지연 재해제를 빼지 않았다.** `LOCK_RELEASE_RETRY_DELAYS_MS=[2000,8000]`과 앱의 세 예약 호출부가 남아 있다. 근거는 커밋 `9531b018` 본문 및 `docs/design/adapter-contract.md:210`: 정상 다른 pid는 살아 있는 부모의 잠금을 풀지 못하고, 직접 삭제에 따른 틈은 최초 해제에도 있으므로 지연 재해제를 빼도 저장기의 틈 자체는 없어지지 않는다는 판단이다. 문서는 지연 재해제가 그런 틈을 최대 두 번 더한다고도 적는다.
- 이 근거는 **잔존 조건을 범위 밖으로 두고 기능을 유지한 판단**이지, 그 조건이 시험으로 없어졌다는 근거가 아니다. PM의 “남으면 지연 재해제를 빼라”는 지시가 위 조건까지 포함한다면 **이행되지 않았다**. 원본 H-1을 무조건 종결하거나 0/0/0으로 보고하지 않는다.

## 종료 시 타이머

- 원본 스크립트의 기본 지연 관찰: **2,000 ms·8,000 ms 요청, unref 2/2, 최대 시도 2회**. 계속 예외이면 left. 실제 지연만 시험에서 줄여 관찰한 값이며 10초 경과 실측은 아니다.
- 실제 자식이 잠금을 획득하고 기본 지연 재해제를 예약한 뒤 자연 종료했다. 강제 process.exit 없이 **82 ms, 종료 코드 0**, 잠금 파일은 남았다. 대기 타이머가 프로세스 종료를 붙들지 않았다.
- 예약 후 호출자가 대상 객체를 바꿔도 원래 복사한 대상만 처리했다. 이전 스크립트의 재시도 사이 소유자 변경 **4조건도 모두 not_held·원문 보존**이었다.
- 타이머는 취소된 것이 아니라 unref 상태다. 프로세스에 다른 참조 손잡이가 있으면 계속 실행될 수 있고, 앱의 close/dispose로 취소하는 API는 없다. 실제 Electron 창 종료 및 진행 중 파일 I/O 강제 종료는 실행하지 않았다. 결과: `lock-results.json/timers`, `between`.

## 명령·시험 수치·경계

- 후보 TypeScript 컴파일 통과. 관련 유닛 **4개 파일, 11 suites, 34 tests: 통과 34 / 실패 0 / 건너뜀 0 / TODO 0**, **13,295.2234 ms**, 종료 코드 0. 원문: `unit-tests.tap`.
- AGENTS.md를 먼저 읽었다. 관리 저장소에서 status·branch·toplevel 및 다음 값을 확인했다.

```powershell
git rev-parse unit/U-211-p5a-adapter
git merge-base main 9531b01885864c1eee6979133f468fb884bd5ad6
git log --oneline 3303b49..9531b01885864c1eee6979133f468fb884bd5ad6 -- src
$v17bBase = git merge-base main 9531b01885864c1eee6979133f468fb884bd5ad6
git diff $v17bBase 9531b01885864c1eee6979133f468fb884bd5ad6 -- src/app src/store
git diff --check $v17bBase 9531b01885864c1eee6979133f468fb884bd5ad6 -- src/app src/store
git diff --numstat $v17bBase 9531b01885864c1eee6979133f468fb884bd5ad6 -- src/store
```

지정 worktree에서:

```powershell
git archive --format=tar --output=.codaryn/codex-review-v17b-9531b018/candidate.tar 9531b01885864c1eee6979133f468fb884bd5ad6
tar -xf .codaryn/codex-review-v17b-9531b018/candidate.tar -C .codaryn/codex-review-v17b-9531b018/candidate
```

candidate에서 컴파일, 실험 폴더에서 재현·시험:

```powershell
node 'D:\project\Codaryn\node_modules\typescript\bin\tsc' -p tsconfig.json --pretty false
node --import ./guard.mjs ./v17-replay.mjs > ./v17-replay-output.json
node --import ./guard.mjs ./recheck.mjs > ./recheck-output.json
node ./run-tests.mjs
```

- 래퍼는 `node --import <guard.mjs의 file URL> --test --test-reporter=tap`으로 `dist/tests/unit/`의 `app/u211-v17-release-race`, `app/u211-lock-retry`, `app/u193-lock-left`, `store/u176-lock-release`만 실행했다. TEMP/TMP는 새 실험 폴더 안이며 guard가 삭제 대상의 절대·실효 경로를 확인했다. 다른 프로세스의 직접 unlink도 새 실험 잠금 파일 하나에 한정했다.
- 새 프로세스가 OS에서 같은 pid를 재사용하는 상황, Linux, 모든 경로 별칭·모듈 중복 적재 조합은 시험하지 않았다. 저장기 자체의 전체 동시성 보장을 증명한 검증은 아니다.
- diff --check 통과, 종료 시 두 저장소의 추적 변경 없음. 저장소 추적 파일 수정 0, 커밋 0, 푸시 0, worktree 추가 0, 실제 API 0, 네트워크 0, 실제 키 조회 0, 권한 요청 0. 새 실험 폴더와 이 보고서만 작성했다.
