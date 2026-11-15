# V-11b 재확인 — 묶음 B-3

- 검증자: codex-review, 보안·정확성 검토자. 작업 worktree: `D:/project/Codaryn/.worktrees/codex-verify`(detached HEAD).
- 후보: `pm/unit-B3b`, `6ac0b24fcc0e773937fbb384b426d9fe3e24125f`. 기준: `71437e2`. 고침: `8997d7c1e5eb48ae7bb0f3f2aeb8987b73a43d5f`.
- **이번 재확인 추가 결함: 높음 0 / 중간 0 / 낮음 0. V-11 H-1의 세 재현은 모두 차단됐다.** 기존 M-1의 수정 완료를 뜻하지 않는다.
- 환경: Windows, Node `v26.13.1`. 사본·재현·결과는 보고서 옆 `codex-review-v11b-6ac0b24`에 있다.
- 실제 propose_changes → 계획 저장/로드 → runApprovedPlan을 연결했다. Workspace·정책 gate·파일 도구·파일 probe·가림·저장기·state guard는 제품 구현이고, 모델은 메모리 대본 대역이다.

## H-1 세 재현

재현: `node ./recheck.mjs`. 실제 도구로 계획을 만든 다음 `docs`를 `saved-docs`로 옮기고 `docs → other` 정션을 만든다. modify는 other의 대상에 승인 당시와 같은 바이트를 먼저 둔다. 계획과 digest는 유지하고 대본 모델이 other의 파일에 쓰도록 준비한다.

| 이전 재현 | 결과 | 모델 요청 | applied claim | 대상 변경 |
| --- | --- | ---: | ---: | --- |
| create, 정책 목록 없음 | failed/plan_stale | 0 | 0 | 없음 |
| create, writablePaths=[docs] | failed/plan_stale | 0 | 0 | 없음 |
| modify, 새 대상의 내용 해시 동일 | failed/plan_stale | 0 | 0 | 없음 |

- **3/3 차단.** 승인 경로는 각각 `docs/new.md`, `docs/new.md`, `docs/guide.md`다. 결과: `results.json/retarget`.
- `src/tools/workflow-tools.ts:586`은 저장된 경로와 현재 실효 경로를 비교한다. `src/policy/path-set.ts:155`도 계획 항목의 재해석으로 승인 범위가 다른 실효 경로로 옮겨가는 것을 거부한다.

## 앞의 실행 전 차단 11건

- config 제한 불일치, 빈 task 허용 목록, config/profile 교집합 불일치.
- modify 내용 변경, modify 삭제.
- create 자리에 파일·디렉터리·정션 생성.
- create 부모가 일반 파일로 변경, 파일 probe 예외, create 부모가 작업공간 밖을 가리키는 정션으로 변경.

**11/11 failed/plan_stale, 각각 모델 요청 0 / applied claim 0.** 이전 재현과 같은 입력 조건으로 재실행했다. probe 예외는 합성 EACCES 예외 주입이며, 그 밖의 경로 조건은 실제 파일시스템에서 만들었다. 작업공간 밖 정션의 대상도 새 실험 폴더 내부에 한정했다. 결과: `results.json/stale`.

## 링크 없는 부모 폴더 교체

두 전략을 각각 create·동일 내용 modify·다른 내용 modify에 적용했다.

1. 별도 일반 폴더 `incoming`을 먼저 만들고, 승인 당시 `docs`를 `saved-docs`로 옮긴 뒤 incoming을 docs로 옮긴다.
2. 승인 당시 `docs`를 `saved-docs`로 이름 변경한 뒤 같은 이름의 새 일반 폴더 docs를 만든다.

| 전략 | create: 대상 없음 | modify: 승인 당시와 같은 내용 | modify: 다른 내용 |
| --- | --- | --- | --- |
| 별도 일반 폴더로 교체 | 쓰기 허용 | 쓰기 허용 | plan_stale |
| 이름 변경 뒤 같은 이름으로 mkdir | 쓰기 허용 | 쓰기 허용 | plan_stale |

- **6/6 폴더 신원 변경 확인:** `stat({bigint:true}).ino`가 바뀌고, 새 docs는 링크가 아니며, 승인 파일의 실효 상대 경로는 그대로였다. 첫 사례 폴더 ID는 `281474978597776 → 281474978597787`이다. 전체 ID는 `results.json/plainReplacement`에 있다.
- 허용 **4건**은 각각 모델 요청 2회·claim 1회이며 실제 승인 경로에 시험 내용을 썼다. 내용 변경 **2건**은 각각 모델 요청 0·claim 0·쓰기 없음으로 차단됐다.
- **판단: 허용 4건은 명시된 경로 기반 승인에 맞는다.** 폴더 신원을 묶지 않는 조건에서 같은 실효 경로를 유지하고, create는 대상 부재, modify는 기존 내용 해시 일치를 만족한다. 옮겨 둔 원래 폴더/파일의 객체 신원까지 보존하는 승인은 아니다.
- 시험 작업에는 자동 검증기를 두지 않아 허용된 실행의 최종 상태는 `needs-input/no_verifier`다. 쓰기 성공을 확인한 것이며 최종 작업 완료로 세지 않았다.

## 제안 때부터 내부 링크를 지나는 정상 계획

재현: 제안 전에 `inside-link → docs` 정션을 만들고 `inside-link/new.md` 또는 `inside-link/guide.md`로 propose_changes를 호출한다. 저장 경로는 각각 `docs/new.md`, `docs/guide.md`다.

| 실행 조건 | 결과 |
| --- | --- |
| 링크를 통한 정상 create | plan_stale 없음, 승인 파일 쓰기 |
| 링크를 통한 정상 modify | plan_stale 없음, 승인 파일 쓰기 |
| 제안 후 별칭만 other로 바꾸고 저장된 docs 경로에 쓰기 | plan_stale 없음, 승인 파일 쓰기 |
| 제안 후 별칭만 other로 바꾸고 그 별칭에 쓰기 | plan_stale 없음, 도구에서 path_not_writable, 쓰기 없음 |

- **4/4 거짓 낡음 없음**, 각각 모델 요청 2회·claim 1회. 승인 범위 밖 쓰기 **0건**. 정상 경로 쓰기 3건, 바뀐 별칭 쓰기 거부 1건. 결과: `results.json/normalLinks`.
- M-1 설명 대조: 합성 미등록 키 모양을 넣은 `write_file`도 같은 `model_response.toolCalls[].argsJson` 기록에 원문이 남았다(1/1); propose_changes에만 생기는 현상이라는 해석은 맞지 않으며, 공통 기록 동작이라는 담당 설명과 일치한다.

## 명령·수치·실행 범위

- 후보 TypeScript 컴파일 **통과**. 관련 유닛 파일 **6개**, suite **13개**, 시험 **39건: 통과 39 / 실패 0 / 건너뜀 0**, 측정 **163.9388 ms**. 원문: `unit-tests.tap`.
- 독립 재현: 실제 계획 생성 **25회**, 계획 실행 **25회**. 실행 전 plan_stale **16회**, 실행 모델 요청이 있는 경우 **9회**. result/run_started의 planRunId·planDigest·approval 비교 불일치 **0/25**.
- 재현 스크립트: `recheck.mjs`, 공통 실제 엔진 연결: `harness.mjs`, 결과: `results.json`, 시험 래퍼: `run-tests.mjs`.

관리 저장소에서 AGENTS.md, 시작/종료 git status·branch·toplevel을 확인하고 지정 판을 git archive로 추출했다. 실행 명령은 다음과 같다(`$v11broot`는 위 새 실험 폴더).

```powershell
Get-Content -LiteralPath 'D:\project\Codaryn\AGENTS.md' -Encoding UTF8
git status --short
git branch --show-current
git rev-parse --show-toplevel
git rev-parse 6ac0b24
git archive --format=tar --output="$v11broot\candidate.tar" 6ac0b24fcc0e773937fbb384b426d9fe3e24125f
tar -xf "$v11broot\candidate.tar" -C "$v11broot\candidate"
git diff --check 71437e2 6ac0b24 -- src/engine src/tools src/contracts src/policy
```

candidate에서:

```powershell
node 'D:\project\Codaryn\node_modules\typescript\bin\tsc' -p tsconfig.json --pretty false
```

실험 폴더에서:

```powershell
node .\recheck.mjs > .\probe-output.json
node .\run-tests.mjs
```

- 래퍼는 `node --import <guard.mjs의 file URL> --test --test-reporter=tap`에 아래 `dist/tests/unit/*.test.js` 파일만 전달했다: `engine/u187-v11-retarget`, `engine/u187-approved-plan-run`, `policy/u187-v11-plan-entries`, `policy/u180-writable-create`, `tools/u187-planned-file-probe`, `contracts/g-u187-approved-plan`.
- TEMP/TMP는 새 실험 폴더 아래에 두고, guard에서 삭제 대상의 절대·실효 경로를 검사했다. 폴더 이동도 출발·도착 절대 경로가 시험 작업공간 내부인지 검사했다.
- Linux·대소문자 구분 디렉터리, 검사 직후 다른 프로세스가 경로를 바꾸는 동시 경쟁, CLI 전체 연결은 실행하지 않았다. 이전 V-11의 다른 항목 전체를 다시 실행한 보고서는 아니다.
- 저장소 추적 파일 수정 0, 커밋 0, 푸시 0, worktree 추가 0, 실제 API 0, 네트워크 0, 실제 키 조회 0, 권한 요청 0. 과거 검증 폴더는 읽기만 했고 새 실험 폴더와 이 보고서만 작성했다. 종료 시 두 저장소의 추적 변경은 없었다.
