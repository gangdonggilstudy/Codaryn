# R-103 검토 — U-196 (앱 계층의 실행 계획 보기와 적용 전 점검)

- 검토자: nc-human (store와 사람용 출력 담당). 읽기 전용. 실험은 scratch 사본에서 했다(`git archive ede80f7`, node_modules 정션, 끝나고 지움).
- 대상: `unit/U-196-p5a-adapter` `ede80f7` (`pm/unit-B3` 위). U-196 자기 커밋은 `86d2adc`(재현), `ede80f7`(구현)이다. `d4c2113`은 내 U-191 병합이다.
- 근거: p5a 보고 `claude-adapter/.codaryn/report-units-p5a.md`의 "U-196" 절. 코드 `src/app/changes-plan.ts`, `src/app/app.ts`(`plan`, `checkApply`, `checkRunPlan`, `runPlanView`), `src/app/types.ts`, `docs/design/adapter-contract.md`.
- **결과: 높음 0 / 중간 1 / 낮음 1 / 정보 6.**
- **M-1의 뿌리는 내 U-191(`changesPlanOutput`)이다.** U-196은 그것을 그대로 넘긴다. 고침은 내 쪽 한 곳과 p5a 쪽 한 줄이다.

## M-1 중간 — 실행 계획 요약이 키 모양·현재 키·제어 문자를 가리지 않은 채 앱 출력(GUI)으로 간다

- **규칙:** 이동 계획의 요약은 출력 객체 자체에 가린 꼴로 들어간다(R-49 R49-M1, `src/cli/plan-commands.ts` `planSummary`).
  - 등록 비밀을 가린 뒤 `cleanText(hideKeys(masked, knownKeyValues(env))).trim()`을 거친다.
  - 주석: "so every output that carries the summary (--json, the app layer, apply's question) has it".
- **실행 계획:**
  - `changesPlanOutput`(U-191)은 요약을 등록 비밀로만 다시 가린다. 키 숨김과 제어 문자 처리는 사람용 글을 그릴 때(`renderChangesPlan`)만 한다.
  - U-196의 `plan()`은 이 출력 객체를 GUI에 그대로 준다. 그래서 GUI가 받는 `ChangesPlanOutput.summary`에는 키 모양 글, 현재 키 값, 제어 문자가 남는다.
- **재현 (scratch, ede80f7):**
  - 요약이 `Use <키 모양 가짜 값> here<BEL> and go`인 실행 계획을 store의 기록기로 저장한 뒤 `app.plan()`을 불렀다.
  - 결과: `summary`에 키 모양 값이 있다(true), BEL이 있다(true), `hideKeys`를 거치면 글이 바뀐다(true).
  - 같은 글이 이동 계획의 요약이었다면 출력에서 `[key]`로 바뀌고 제어 문자도 정리되었을 것이다(위 코드).
- **위험:**
  - 요약은 모델이 쓴 글이다. 작업 공간 파일에 있던 키 모양 문자열이나 등록되지 않은 키를 모델이 옮겨 적으면, 그 값이 GUI에 그대로 간다.
  - 다이제스트가 요약을 묶으므로, 사람이 승인 화면에서 읽는 글이기도 하다.
- **고침 제안:**
  - `changesPlanOutput`이 현재 키(`KnownKeys`)를 받아, 요약에 `planSummary`와 같은 처리(`cleanText(hideKeys(…)).trim()`)를 하게 한다(nc-human, U-191에 새 커밋).
  - 앱(`changesPlanViewIn`)은 `knownKeyValues(environment.env)`를 넘긴다(p5a). `app.ts`는 `knownKeyValues`를 이미 import하고 있다.
  - CLI의 U-195도 같은 값을 넘긴다.
  - 그러면 `--json`, 앱, 승인 화면이 같은 요약을 갖는다.
- 계획 파일 경로(`files[].path`)는 이동 계획의 `actions` 경로와 같게 비밀만 가린다. 그래서 이 지적에 넣지 않았다(정보 I-4).

## L-1 낮음 (B-4 뒤) — 점검이 읽을 수 없는 실행 계획을 "실행 계획 아님"으로 갈라 잘못된 거부를 준다

- `checkApply`는 `storedPlanKindOf`로 종류를 가른다. 이 함수는 `loadAnyPlan`이 실패하면(손상, plan.json 없음, result의 종류 불일치) `null`을 준다. 그러면 적용 계획 갈래로 간다.
- 그 갈래는 먼저 task가 plan "apply"인지 본다. 그래서 task가 plan "run"으로 풀리면, 손상된 실행 계획이 `invalid_run_record`·`plan_run_missing` 대신 `run_not_plan`("does not resolve to a workflow with plan \"apply\"")으로 거부된다.
  - 거부 자체는 맞다. 하지만 코드와 문구가 원인을 숨긴다.
- **지금은 닿지 않는다.** B-4 전에는 어떤 설정도 plan "run"으로 풀리지 않는다(U-177).
  - apply task로 같은 손상 계획을 점검하면 `invalid_run_record`가 나온다(재현 b2).
  - 보기(`plan()`)는 CLI의 `loadPlan`으로 떨어져 같은 코드를 준다(재현 b: `invalid_run_record`).
- **고침 제안:** `storedPlanKindOf`가 실패할 때 `loadAnyPlan`의 코드를 돌려주게 하고, `checkApply`는 종류 판정 전에 그 코드를 그대로 준다.

## 정보

- **I-1 loadAnyPlan 쓰기: 바르다.**
  - **손상:** 보기는 `storedPlanKindOf`가 `null`이면 CLI의 `runPlan`(`loadPlan`)으로 떨어지고, 같은 코드가 나온다(재현 b).
  - **종류 가름:** 쓰는 자리에서 다시 확인한다. `changesPlanViewIn`은 `kind !== "changes"`면 `internal_error`, `checkApply`의 적용 갈래는 `planKind`가 있으면 `internal_error`다. 두 읽기 사이에 종류가 바뀌어도 잘못 보이지 않는다.
  - **기록 변경 표시:** `hasRecordsChangedMark`는 그 이름의 무엇이든, 읽을 수 없는 것도 표시로 센다(fail closed). CLI의 `planRunMarked`와 같은 규칙이다(재현 c: `recordsChanged: true`).
  - `latest`는 CLI와 같은 `resolveRunReference`로 푼다.
- **I-2 U-191 보기와 같다.** 앱은 `changesPlanOutput`의 객체를 손대지 않고 준다. 같은 필드, 같은 DR-28 규칙(계획 경로가 지금 다르게 가려지면 `plan_secrets_differ`, 아무것도 보이지 않음), 같은 표시다. M-1을 고치면 함께 고쳐진다.
- **I-3 요약은 goal로 쓰이지 않는다.**
  - U-196에는 실행을 시작하는 길이 없다. 요약은 보기의 `summary`로만 간다.
  - 문서(adapter-contract)는 실행할 goal이 계획을 만든 실행의 goal이고, 읽을 수 없으면 시작하지 않는다고 적는다(PM, AC-D16).
  - U-195 뒤 앱 연결 단위에서 이 문장을 지키는지 다시 볼 것.
- **I-4 경로의 키 모양:** 두 종류 모두 출력의 경로는 비밀만 가린다. 키 숨김은 그리는 쪽(CLI 렌더러, GUI)의 몫이다. GUI의 변경 목록도 이동 표처럼 키 모양을 숨겨 그려야 한다.
- **I-5 기록 변경 표시가 있을 때의 요약:**
  - 이동 계획 보기는 표시가 있으면 요약을 뺀다. 요약이 일지에서 오고 일지도 바뀌었을 수 있기 때문이다.
  - 실행 계획의 요약은 plan.json 안에 있어 파일 목록과 같은 기록이다. 그래서 U-191·U-196은 경고, "적용할 수 없음"과 함께 보인다. 점검은 `plan_records_changed`로 거부한다.
  - 이유가 있는 차이지만 PM이 알고 있을 것.
- **I-6 효율:**
  - 이동 계획의 `plan()`은 이제 매번 설정 읽기(`readingSecrets`)와 `loadAnyPlan`을 한 번 더 한다(`runPlanView`).
  - 이동 계획의 `checkApply`는 계획을 세 번 읽는다(`storedPlanKindOf`, `runPlanView`, CLI `loadPlan`).
  - 정확성 문제는 아니다. 점검 시간이 조금 는다.

## 확인한 것

- 관문: `checkChangesPlanFiles`의 `createPolicyGate` 옵션(`config`, `workspace`, `writablePathSets`)이 CLI·앱의 실행 조립과 같다.
  - 계획 목록을 더하는 방법도 `approvedPlanWritablePathSets`, 엔진의 `checkApprovedPlan`(요청 판정 뒤 실효 판정)과 같다.
  - 점검 결과에는 순번만 나가고 경로는 나가지 않는다.
- 가림: 오류 문구에 경로나 요약이 없다(run id와 코드만).
- U-196 시험: scratch에서 7/7 통과(ede80f7).
- 재현 시험(scratch, 커밋 없음): a(키 모양·BEL), b(result에 계획 종류 없음 → 보기 `invalid_run_record`), b2(같은 손상 + apply task → 점검 `invalid_run_record`), c(표시 있음 → 요약과 `recordsChanged`).

## 뒤 (고침)

- M-1: `unit/U-198-nc-human` `b03ef96f83c1fe1c8c407bc2abf2918c53968317`. changesPlanOutput가 `options.currentKey`를 받아 요약을 `cleanText(hideKeys(masked, currentKey), true).trim()`으로 둔다(LF·TAB 남김). 앱은 p5a가 `knownKeyValues(environment.env)`를 넘기면 현재 키까지 숨긴다. 넘기지 않아도 키 모양과 제어 문자는 이미 처리된다.
- V-7(main)로 실제 도구가 저장하는 요약은 이미 안전하다(safeModelText). 이 고침은 출력 쪽 규칙(R-49 M1)을 plan.json을 누가 썼든 지키게 하고, 저장 때 알 수 없는 현재 키를 숨긴다.
- L-1: p5a 코드(src/app)라 손대지 않음.
