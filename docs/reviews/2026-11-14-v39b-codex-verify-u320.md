# V39b — U320 helper 거부 복원 재검증

검증자 codex-audit, 2026-11-14. **높음 0 / 중간 0 / 낮음 0. V39 L-1은 이 판에서 해소됐다.** 잘못된 종류의 계획을 helper에 직접 넘겨도 이동·폐기·claim을 하지 않는다. 지원되는 helper 호출의 단일 계획 읽기와 조립 순서, 봉인된 CLI 기준, 일반 run 표시에서 회귀를 찾지 못했다. PM의 전체 판 검사와 병합 판단은 별도다. U321은 검증 범위에 넣지 않았다.

- 대상: `f930d147fa7374b7db7ffab713040854735fb76f`, 브랜치 `pm/unit-C7b-codex-b`의 정확한 끝과 일치.
- 조립: main `1f726366` + U320 tip `89f279bb`. main이 대상의 조상임을 확인했다.
- 고정 기준: `e7229c030d10f333e42c64ee72a55017ebac7557`. `git diff e7229c03 1f726366 -- src`는 비어 있다.
- 사본 R: `D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-audit-c7b-oracle`. 정확한 대상의 `git archive`를 `R/head-v39b.zip`에 쓰고 `R/head-v39b`에 추출했다. worker tree·제품 소스·고정 출력 수정 없음.
- 직전 거부 판 `372ad535` 이후 제품 차이는 `src/cli/plan-commands.ts`의 guard 복원뿐이다. `src/cli/run.ts`, 앱 수명·엔진·store는 그 판과 같다. 시험은 U320 직접 거부·읽기/조립 횟수 검사가 보강됐다.

## 1. L-1 재현의 해소

수정 위치: head `src/cli/plan-commands.ts:255`. task mode가 run이 아니면 `:259`에서 계획을 한 번 읽고, changes가 아니면 옛 run_not_plan/plan_kind_differs 오류로 끝낸다. mode가 run이면 추가 사전 읽기 없이 기존 수명으로 들어가 그 수명의 wrong-kind 검사를 사용한다. 앱 수명 dispatch를 바꾸지 않았다.

독립 재현은 `R/v39b-extra.mjs`다. 실제 CLI로 만든 이동·폐기 두 행동의 계획을 준비한 다음 공개 export `applyChangesPlan`을 직접 호출했다. parsed args와 prepareFor 결과를 사용하고, 검사 대상인 resolved task.plan만 apply/none/run으로 바꿨다. 요청의 다이제스트는 계획의 앞 12자다. 파일 및 **상태 디렉터리 전체**를 호출 전후 hex snapshot으로 비교했다.

| stored plan / task mode | 수정 판 결과 | 계획 읽기·조립 | 파일·기록 효과 |
|---|---|---|---|
| moves / apply | 옛 오류 객체와 완전히 동일, exit 2 | load 1, assemble 0 | 전체 work snapshot 동일, claim·잠금 없음 |
| moves / none | 옛 오류 객체와 완전히 동일, exit 2 | load 1, assemble 0 | 위와 동일 |
| moves / run | 옛 오류 객체와 완전히 동일, exit 2 | load 1, assemble 0 | 위와 동일 |
| changes / run (지원 전제) | verified/0, 계획대로 summary.md 생성 | **load 1 → assemble 1** | claim 1, 종료 후 잠금 없음 |

이동 계획은 `inbox/a.txt = "alpha\n"`를 sorted/a.txt로 이동하고 `inbox/old.tmp = "old\n"`를 discard하는 두 행동이다. 세 mode 모두 두 원본 파일이 그대로이고 목적지·폐기 파일·새 수행 기록·applied.json이 생기지 않았다. V39에서 실제로 수행되던 moves/apply 입력도 이제 거부된다.

복원된 오류의 핵심 필드:

```json
{
  "code": "run_not_plan",
  "message": "that run made a plan of moves and discards (plan \"apply\"), but the task given to apply resolves to plan \"run\"; give the task the plan run used; nothing was run",
  "hint": "plan_kind_differs",
  "exitCode": 2
}
```

schemaVersion/kind/category/retryable를 포함한 전체 outcome도 old와 deepEqual로 확인했다. task mode가 apply/none이어도 위의 옛 고정 run 문구가 유지된다.

기존 지원 전제는 changes 계획 + resolved task.plan run이다. 이 정상 입력은 base와 head 모두 실제 적용에 성공했고 주입한 읽기·조립 추적은 정확히 `['load', 'assemble']`였다. guard 때문에 정상 경로에서 계획을 두 번 읽거나 조립을 두 번 하는 일이 없었다.

추가로 changes + apply/none도 직접 호출했다. 옛 helper는 수행하고 새 수명은 run_not_plan으로 거부하는 V39의 관찰은 그대로다. 이는 명시된 task mode 전제를 벗어난 입력의 더 좁은 거부이며, PM이 이번에 복원하도록 지시한 **다른 종류를 이동·폐기로 수행하는 확대**와 구분한다. 이 관찰을 정상 입력과의 완전한 함수 동등성이라고 표현하지 않는다.

직접 호출 총 12회(2 kinds × 3 modes × 2 versions). 별도 증거 검사 23조건이 통과했다. `tests/unit/cli/u320-apply-display.test.ts:75`의 새 회귀 시험도 통과했다. 이 시험은 이동만인 계획·폐기만인 계획 각각에서 거부와 workspace snapshot 불변을 보고, `:180` 이후는 direct helper와 runApply 각각의 단일 읽기·조립·그리기를 검사한다. 독립 스크립트는 추가로 none mode와 두 행동을 함께 가진 계획을 검사했다.

## 2. 봉인 oracle — 변경 없이 통과

다음 기대값과 스크립트를 재생성하거나 수정하지 않았다. 기존 manifest의 12개 파일 해시를 다시 검사해 전부 일치했다(`R/v39b-evidence.json`).

```text
expected-v2.json SHA-256
8eefc0941acdf06e19bfb2be994c51eebee729a19393ba8228d9d0bd17947e29
```

`node oracle.mjs compare ./head-v39b`: **26사례·84 실제 CLI 호출, 차이 0, exit 0**. 기존 `check-oracle.mjs`의 독립 **55조건도 통과**했다.

승인 없음·거절·틀린 digest, 위험 이동 동의 yes/no와 영/한, 첫 요약→동의 질문→두 번째 적용, 다른 task 안내(승인 후 잠금 거부 앞의 안내 포함), 계획 종류·goal·표지·stale 거부, 실행 계획의 시작 전/모델 중/첫 쓰기 후 취소, 계획 밖 쓰기 수, quiet·기본 설정 안내, 잠금 해제 실패의 출력·기록·파일이 봉인된 base 결과와 같았다. 저장 journal의 seq/type/approval와 result·plan·applied·discarded·작업 파일·잠금도 비교 대상이다.

증거 폴더: `R/execution-compare-2026-11-14T06-02-45-436Z`. `summary.json`과 `results.json`, 각 사례의 raw.json 및 실제 work가 보존돼 있다. 로그는 `compare-v39b.log`, `assertions-v39b.log`다. 기존 oracle의 경로·ID·시간·PID·무작위 token 정규화만 그대로 사용했다.

## 3. 일반 run·표시·관련 시험

별도 일반 run 비교 **12사례·72 CLI 호출(각 버전 36회), 차이 0**. 사례는 document-run/ko/quiet, denials, repair, default-config/ko, cancel-file, invalid-script/ko, private-run, workflow-tools-inspect다. 진행 줄·요약·기본 설정 안내·오류·거부·재수정·기록과 파일을 비교했다.

증거: `R/v39b-extra-1794636165151/ordinary.json`, raw.json, `direct-matrix.json`, 각 direct-result.json과 실제 work. 정상 helper에서 관찰된 순서도 direct-result.json의 order에 남겼다.

새 head의 `npm.cmd run build`: **exit 0**, 로그 `build-head-v39b.log`. 기존 로컬 node_modules만 복사했으며 설치·다운로드하지 않았다.

관련 유닛 파일만 선택해 `node --import <R/offline-guard.mjs> --test ...`로 실행했다. **104 tests / 21 suites / 104 pass / 0 fail·cancelled·skipped·todo, 4538.1996 ms, exit 0**.

선택 파일(`dist/tests/unit/<이름>.test.js`):

```text
app/u313-apply-life
app/u293-run-life
app/u218-run-plan-apply
app/u229-finish-lock-left
app/u293-v31-signal-edges
cli/g-consent
cli/g-u195-apply-run-plan
cli/g-u195-v14-not-writable
cli/u220-lock-left-cli
cli/u280-dist-old-paths
cli/u320-apply-display
```

U320의 질문 reject/동의 뒤 두 번째 실행 여부·기록/요약 1회·다른 task 안내·정상 helper 읽기/조립 순서가 통과했다. U313 비교가 전환 후 같은 수명을 볼 수 있다는 한계는 그대로이며, 독립 동등성의 핵심 근거는 봉인 oracle이다. 앱 handle·관찰자·취소·lockLeft는 선택한 기존 관련 시험으로 확인했다.

로그와 정확한 argv: `units-v39b-head-v39b.log/.json/.stderr`. 이번에는 base 유닛 전체를 반복하지 않았고 V39의 base 97개 결과를 재실행으로 세지 않는다.

## 4. 재현 명령·경계·판정

R에서 실행한 명령:

```powershell
node oracle.mjs compare ./head-v39b
node check-oracle.mjs execution-compare-2026-11-14T06-02-45-436Z
node v39b-extra.mjs
node v39b-units.mjs
node v39b-evidence.mjs
```

직접 호출 재현만 원하면 `node v39b-extra.mjs direct`로 새 합성 폴더에서 수행할 수 있다. 이 스크립트는 작업자 트리가 아닌 자기 base/head-v39b archive만 사용한다. oracle의 기대 파일은 건드리지 않는다.

실제 API·키/키 파일·외부 네트워크·실제 터미널·실제 FAT·Electron·전체 시험 묶음은 미실행이다. 선택 사례는 scripted 모델이고 offline-guard가 fetch/TCP/HTTP(S)를 차단한다. 터미널 입력과 fs 실패는 preload 모의다. 시험 환경의 TEMP·홈·설정 위치는 감사 폴더로 격리했고 필요한 OS 실행 변수만 전달했다. 권한 상승·한도·크레딧 응답 없음.

제품 소스·worker tree·고정 출력·기존 oracle 수정, commit/push/worktree add 없음. 종료 시 관리 main의 git status --short는 비어 있었다. **검증 범위에서 V39 L-1 복원 완료, 새 지적 없음.** PM이 수행하는 전체 판 검사·최종 통합과는 별도로 이 결과를 제출한다.
