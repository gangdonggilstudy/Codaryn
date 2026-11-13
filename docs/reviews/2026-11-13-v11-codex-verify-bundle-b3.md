# V-11 정확성 검증 — 묶음 B-3

- 검증자: codex-review, 보안·정확성 검토자. 작업 worktree: `D:/project/Codaryn/.worktrees/codex-verify`(detached HEAD).
- 기준: main `5c08a8c6b8e2e8efa918de621a37544967120247`. 후보: `pm/unit-B3`, `f07ba7a95cce3596c243cefd17c3b58792369641`.
- 범위: 요청한 `src/engine`, `src/tools`, `src/contracts`, `src/workflows` diff와 실행에 연결되는 정책·계획 저장기. 기존 V-7 보고서는 읽기만 했다.
- **높음 1 / 중간 1 / 낮음 0. 승인 목록 밖의 실효 경로에 쓰는 경우 3건, 계획 생성 journal에 미등록 키 모양이 남는 경우 3건 재현.**
- 환경: Windows, Node `v26.13.1`. 사본·재현·원문 결과: 이 보고서 옆 `codex-review-v11-f07ba7a`.
- 실제 Workspace·정책 gate·개인정보 가림·파일 도구·계획 저장/로드·run recorders·state guard를 연결했다. 모델은 메모리 대본 대역이고 네트워크를 사용하지 않았다. CLI는 실행하지 않았다.

## H-1 높음 — 승인 뒤 부모 정션을 바꾸면 승인된 파일의 실효 경로가 바뀜

- 위치: `src/engine/index.ts:1638`, `:1644`, `:1781`; `src/tools/workflow-tools.ts:581`; `src/policy/path-set.ts:140`, `:147`.
- 재현: 실험 폴더에서 `node ./probe.mjs`, 결과 `results.json/paths`의 `create-parent-retarget-false`, `create-parent-retarget-true`, `modify-parent-retarget`.
  1. 실제 `propose_changes`로 `docs/new.md`의 create 계획을 저장하고 실제 `loadAnyPlan`으로 로드한다. 이때 docs는 일반 디렉터리이며 plan.json에는 `docs/new.md`가 저장된다.
  2. 승인 뒤, 실행 시작 전에 docs를 같은 실험 작업공간의 saved-docs로 옮기고 `docs → other` 정션을 만든다. **동시 바꿔치기나 파일시스템 실패 주입이 아니다.**
  3. `runApprovedPlan`에 원래 계획을 전달하고 대본 모델이 `write_file("other/new.md")`를 요청하게 한다.
  4. create 낡음 검사는 새 대상이 없다는 이유로 통과한다. 승인 목록 항목도 현재 정션을 다시 풀어 other/new.md를 허용한다.

| 사례 | 저장된 승인 경로 | 실제 쓰기 경로 | 쓰기 | 모델 요청 | applied claim |
| --- | --- | --- | --- | ---: | ---: |
| create, 정책 목록 없음 | docs/new.md | **other/new.md** | 성공 | 2 | 1 |
| create, 정책 writablePaths=[docs] | docs/new.md | **other/new.md** | 성공 | 2 | 1 |
| modify, 새 대상에 동일 바이트 배치 | docs/guide.md | **other/guide.md** | 성공 | 2 | 1 |

- 3/3회 plan_stale 없이 진행하여 실제 대상 파일에 시험 내용을 썼다. 계획 파일과 승인 다이제스트는 바꾸지 않았다.
- modify 사례는 other/guide.md에 기존 승인 파일과 같은 바이트를 둔 뒤 부모를 정션으로 바꿨다. 현재 내용 해시는 같아도 승인 당시 실효 파일과는 다른 경로다.
- 정책 목록과 계획 목록 모두 현재 경로를 다시 해석하므로 `[docs]` 정책과 교집합을 취해도 두 번째 사례를 막지 못했다.
- 실행 결과의 최종 사유는 `needs-input/no_verifier`다. 검증기 없는 시험 작업이므로 최종 작업 완료로 보고하지 않으며, **쓰기 자체의 성공과 승인 범위 이탈**을 확인했다.

## M-1 중간 — 계획 생성 실행의 model_response 기록에 요약의 키 모양이 남음

- 위치: `src/engine/index.ts:1412`의 `maskJson(call.args)`와 뒤의 model_response 기록. 등록 값 가림은 적용하지만, 미등록 키 모양을 숨기는 요약 처리는 이 기록보다 뒤의 도구에서 이뤄진다.
- 재현: `node ./probe.mjs`, `results.json/privacy`의 `keys`, `mixed`, `split-key`.
- 합성 Anthropic·OpenAI 모양 문자열을 프로그램에서 조립하여 summary에 넣었다. 실제 키를 읽거나 사용하지 않았다. mixed는 별도의 합성 등록 값도 넣고, split-key는 모양 중간에 zero-width 문자를 넣었다.

| 산출물·전송 내용 | 미등록 키 모양 원문 | 등록 값 원문 |
| --- | --- | --- |
| 새 plan.json의 summary | 3/3 없음 | mixed에서 없음 |
| 계획 실행 모델의 system 지시문 | 3/3 없음 | mixed에서 없음 |
| 계획 실행 journal | 3/3 없음 | mixed에서 없음 |
| 계획 생성·계획 실행 result | 3/3 없음 | mixed에서 없음 |
| **계획 생성 journal의 model_response.toolCalls[].argsJson** | **3/3 잔류** | mixed에서 없음 |

- keys·mixed에서는 두 합성 키 모양이 그대로 남았다. split-key에서는 분리된 원문과 다른 키 모양이 그대로 남았다. 재현 결과에는 문자열 자체 대신 잔류 여부와 이벤트 유형만 기록했다.
- **V-7 M-1의 원래 대상인 저장 인자·plan.json 요약 누락은 수정됐다.** 실제 저장기로 만든 파일에서도 확인했다. 다만 이번 요청의 “기록에도 원문이 남지 않음” 범위는 위 생성 journal 잔류 때문에 충족하지 못했다.
- 생성된 계획을 실행할 때 지시문에는 `Approved plan:`이 고정 프롬프트·워크플로 지시 뒤에 있었고, 요약을 새 지시가 아닌 승인된 설명으로 표시했다. mixed의 등록 값 자리는 `[masked]`였으며, 이 지시문 검사 3/3 통과했다.

## 승인 목록·정책 교집합·낡음 검사

| 검사 | 결과 |
| --- | --- |
| 승인된 modify / create | 실제 쓰기 허용 |
| config·profile 목록과 승인 파일 목록의 정상 교집합 | 실제 쓰기 허용 |
| 목록에 없는 docs/extra.md | path_not_writable, 생성 없음 |
| 승인 파일 이름에 접미사를 더한 형제 경로 | path_not_writable, 생성 없음 |
| 승인된 create / modify 파일 아래 child.txt | 2/2 거부, 생성 없음 |
| 승인 파일과 대소문자만 다른 이름 | Windows에서 같은 파일로 해석되어 2/2 허용 |
| `./`가 포함된 같은 경로 | 같은 승인 파일 쓰기 허용 |
| 내부 정션을 통해 승인 파일을 가리키는 별칭 | 승인된 실효 파일에만 쓰기 허용 |
| docs/link → other를 통해 목록 밖 파일 요청 | path_not_writable, 생성 없음 |
| 계획을 만들 때부터 부모가 내부 정션 | 저장 경로를 실경로 docs/new.md로 정규화하고 그 파일에 쓰기 |
| 승인 뒤 부모를 내부 정션으로 변경 | H-1의 3건 |

- Windows 대소문자 사례는 서로 다른 파일에 대한 허용으로 세지 않았다. Linux·대소문자 구분 디렉터리의 별도 파일 동작은 실행하지 않았다.
- **실행 전 중단 11/11건:** config 제한 불일치, 빈 task 허용 목록, config/profile 교집합 불일치, modify 내용 변경, modify 삭제, create 자리에 파일 생성, 디렉터리 생성, 정션 생성, create 부모가 파일로 변경, 파일 probe 예외, create 부모가 작업공간 밖으로 향하는 정션으로 변경.
- 위 11건 모두 `failed/plan_stale`, **모델 요청 0 / applied claim 0**이었다. 모델 호출 전에 중단하는지 실제 요청 횟수로 확인했다.
- 경로 검사 표의 원문은 `results.json/paths` 16행, 실행 전 중단은 `stale` 11행이다.

## 다이제스트·한 번 실행·식별자

### 다이제스트 신뢰 경계

- 실제 도구로 생성한 계획 34개 모두 반환 digest가 plan.json 바이트 SHA-256과 일치했다.
- plan.json 바이트만 바꾸고 결과 기록의 digest는 그대로 둔 경우 `loadAnyPlan`은 `invalid_run_record`로 거부했다.
- 반면 로드한 정상 계획 객체를 유지하고 `ApprovedChangesPlan.digest`에 다른 64자리 값을 전달하여 **엔진을 직접 호출하면 모델 요청 1회·claim 1회가 발생하고 잘못 준 digest가 result·run_started에 기록됐다.** 엔진 자체의 다이제스트 불일치 차단은 없다.
- `src/contracts/plan.ts:547`의 계약은 LoadAnyPlan과 사람의 승인 digest 대조를 **호출자(B-4 CLI/app)의 사전 책임**으로 명시한다. 따라서 위 직접 호출은 그 전제를 어긴 시험이며, 별도 엔진 구현 결함 건수로 더하지 않았다. 현재 CLI는 plan run을 거부하므로 사용자 승인 다이제스트를 받는 전체 연결의 불일치 차단은 **미검증**이다. 엔진이 이를 방어했다고 보고하지 않는다.

### applied.json

- 직렬 2회: 모델 요청 `[1,0]`, claim `[marked,already_applied]`. 두 번째는 `plan_stale`, applied.json 바이트 변경 없음. 파일의 planRunId·applyRunId는 첫 실행과 일치했다.
- 동시 2회: claim은 marked 1개·already_applied 1개, 모델 요청이 발생한 실행도 1개였다. 실제 저장기의 exclusive create를 사용했다.
- 동시 시험은 호출자 작업공간 잠금을 걸지 않고 엔진 두 개를 직접 호출했다. claim을 얻은 실행은 다른 실행의 기록 때문에 최종 `state_changed`, 나머지는 `plan_stale`로 끝났다. **한 번만 claim됨을 검증한 시험이며 동시 작업의 정상 완료로 보고하지 않는다.**

### run_started와 result

- 계획 실행 35회에서 result의 planRunId·planDigest와 run_started의 planRunId·planDigest·approval이 전달 인자와 **35/35 일치**했다. plan_stale 종료도 포함한다.
- 그중 정상 digest를 전달한 34회는 로드된 계획 digest와 일치했다. 나머지 1회는 위 잘못된 digest 시험으로, 틀린 인자가 그대로 전달된 결과다.
- 원문: `results.json`의 `proposal`, `digest`, `claim`, `metadata`.

## 실행 명령·시험 수치

- 두 사본 TypeScript 컴파일 **2/2 통과**.
- 관련 유닛 파일 **10개**, 시험 **99건**, suite **24개**, **통과 99 / 실패 0 / 건너뜀 0**, 측정 **328.6619 ms**. 전체 시험 묶음은 실행하지 않았다.
- 독립 최종 재현: 실제 계획 생성 **34회**, 계획 실행 **35회**. 정책·파일·가림·저장기는 제품 구현이다. 대본 모델과 시험 작업의 검증기 대역을 사용했으며, 작업의 자동 검증기 목록은 비워 파일 경계 검증에 집중했다.

관리 저장소에서:

```powershell
Get-Content -LiteralPath 'D:\project\Codaryn\AGENTS.md' -Encoding UTF8
git status --short
git branch --show-current
git rev-parse --show-toplevel
git diff 5c08a8c f07ba7a95cce3596c243cefd17c3b58792369641 -- src/engine src/tools src/contracts src/workflows
git archive --format=tar --output="$v11root\base.tar" 5c08a8c
tar -xf "$v11root\base.tar" -C "$v11root\base"
git archive --format=tar --output="$v11root\candidate.tar" f07ba7a95cce3596c243cefd17c3b58792369641
tar -xf "$v11root\candidate.tar" -C "$v11root\candidate"
git diff --check 5c08a8c f07ba7a95cce3596c243cefd17c3b58792369641 -- src/engine src/tools src/contracts src/workflows
```

`$v11root = D:\project\Codaryn\.worktrees\codex-verify\.codaryn\codex-review-v11-f07ba7a`의 `base`, `candidate` 각각에서:

```powershell
node 'D:\project\Codaryn\node_modules\typescript\bin\tsc' -p tsconfig.json --pretty false
```

실험 폴더에서:

```powershell
node ./probe.mjs > ./probe-output.json
node ./run-tests.mjs
```

- probe는 최초 실행 뒤 정상 교집합과 승인 create 이름 자체의 정션 사례를 보강하여 재실행했다. 최종 수치는 `results.json`에 기록했다. 제품 소스는 바꾸지 않았다.
- 시험 파일: `engine/u187-approved-plan-run`, `engine/u180-propose-changes-engine`, `contracts/g-u187-approved-plan`, `tools/u180-propose-changes`, `tools/u180-v7-summary-keys`, `tools/u187-planned-file-probe`, `policy/u180-writable-create`, `store/u181-changes-plan`, `store/u181-runs-carried-plan`, `engine/g-workflow-engine`.
- 래퍼는 TEMP/TMP를 새 실험 폴더 아래로 한정하고 `guard.mjs`로 삭제 대상의 절대·실효 경로를 검사한 뒤 위 파일만 `node --test --test-reporter=tap`으로 실행했다. 시험 원문은 `unit-tests.tap`이다.
- 저장소 추적 파일 수정 0, 커밋 0, 푸시 0, worktree 추가 0, 실제 API 0, 네트워크 0, 실제 키 조회 0, 권한 요청 0. 과거 검증 폴더는 수정하지 않았고 새 실험 폴더와 이 보고서만 작성했다.
