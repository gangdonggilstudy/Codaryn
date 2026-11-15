# R-5 검토: G-B 엔진 변경과 G-C 도구·적용기 (읽기 전용)

## 0. 이해 확인

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 구현자가 아닌 세션의 교차 검토다.
- worktree: `D:\project\Codaryn\.worktrees\claude-quality`(main `8b012b8` 병합 `bd29265`). 저장소 파일은 고치지 않았고 커밋하지 않았다.
  - 실험은 `.codaryn/r5/` 안에서만 했다. 빌드 사본(`git archive`), 합성 파일, 작업 공간 밖 역할의 폴더(`.codaryn/r5/outside*`)를 썼다.
  - 실제 API, 네트워크, 키 파일은 쓰지 않았다.
- **검토한 커밋**(11:48 기준 고정. 검토 중에 두 브랜치와 main이 움직였다):
  - G-B: `claude/general-tasks` `720aa5a`.
    - 엔진 `ef99dd2` feat(engine) GT-E1~E5.
    - 계약 `2cbd8e6`(정책 게이트가 워크플로 도구·계획 동작을 판정), `720aa5a`(DR-16, DR-17).
  - G-C: `claude/gui-design` `98a52db`.
    - `573fc8a` inspect_files·propose_plan.
    - `98a52db` 계획 실행기.
    - 이 브랜치는 G-A 기준 `069cb73` 위에 있다.
  - 비교 기준: main `b8fbb92`. `git diff b8fbb92 720aa5a -- src/engine`는 G-B 변경 두 파일뿐이다.
- 합친 사본: G-B `720aa5a`에 G-C의 `src/tools` 4개 파일과 `tests/unit/tools/g-*` 3개를 덮었다. `069cb73`과 `720aa5a` 사이에 `src/tools` 변경이 없어 병합과 같다.
- 대조 기준:
  - `docs/design/general-tasks.md` 4.3(E1~E5), 6.1~6.4.
  - `docs/work-orders/phase-4-5-design.md` GT-D(채택), DR-1~DR-17.

## 1. 결과

- 심각도별: **높음 0 / 중간 1 / 낮음 3 / 정보 6**.
- 계획 실행(엔진 + G-C 도구 + 실제 정책 게이트·작업 공간·가림, 대본 모델) 27사례:
  - 작업 공간 밖, 상태 디렉터리, 연결점(junction), 보호 경로(대소문자, `..`), ADS, 끝 점, 절대 경로, 복원 금지 토큰, `planActions` 밖 종류가 모두 도구 실행 전에 거부됐다.
  - 모든 사례에서 작업 공간 파일이 바뀌지 않았고 밖의 파일도 그대로였다.
- 실행기 13사례:
  - 원본 변경, 대상 생성, 원본의 연결점 교체, `discarded`·`.codaryn` 연결점, 대상 부모 연결점에서 옮기지도 덮어쓰지도 않았고 밖에 쓰지 않았다.
  - 예외: 하드 링크를 못 쓰는 경로의 창(L-1).
- workflowRef 없는 기존 실행: main과 G-B+G-C 빌드의 실제 CLI 결과가 같다. stdout, 기록 27줄, stderr 모두 일치했다(I-2).
- 지금 파일을 옮기거나 지우는 경로는 없다. 실행기를 부르는 코드가 없고, 앱 계층의 `applyPlan`도 비어 있다(I-3). 그래서 적용 때의 다이제스트 승인과 정책 재판정은 실행으로 확인할 수 없었다.

## 2. 발견

### 중간

#### M-1. 정책 게이트가 `requires.planAction`을 판정하지 않는다. 적용 때 `planActions` 재확인이 빠질 수 있다

- 위치: `src/policy/index.ts`(`720aa5a`; `planAction` 처리 없음). 계약 `src/contracts/plan.ts:157-187`(`PLAN_ACTION_DESCRIPTORS`의 `requires.planAction`), `:402`(적용 사전 점검: "every action judged by `policy`"). 설계 6.3의 3단계: "게이트가 … 판정한다. 이 판정은 아직 구현되지 않았다(11절 G-C)".
- 재현(`.codaryn/r5/exp/plan-engine.mjs` G1): `planActions: []`인 정책으로 만든 실제 게이트에 `plan.discard {path:"a.txt"}`를 주면 `checkRequested`와 `checkEffective` 모두 `{allowed:true}`다.
- 지금 막히는 이유: 계획 실행에서는 엔진이 `task.policy.planActions`를 따로 본다(`src/engine/index.ts` handlePlanCall). P7(discard 불허)과 P7b(`planActions` 없음)는 `destructive/plan_action_not_allowed`로 거부됐다.
- 영향 [추정, 적용 구현 전]:
  - DR-5는 적용 때 지금의 task·설정 정책으로 다시 판정하라고 한다.
  - 사전 점검이 계약 주석대로 게이트만 쓰면 `planActions` 재판정이 빠진다. 폐기를 허용할 때 만든 계획이, 폐기를 뺀 task나 프로필로도 적용된다.
- 소유: 설계 11절은 이 판정을 G-C에 두지만 G-C의 소유는 `src/tools/**`다. `src/policy`의 담당이 정해져 있지 않다.
- 권고:
  - 게이트에 `requires.planAction` 판정을 넣고 G1을 회귀 시험으로 고정한다(담당 지정 필요).
  - 그 전까지는 적용 사전 점검이 `planActions`를 직접 보게 계약 주석에 적는다.

### 낮음

#### L-1. 하드 링크를 못 쓰는 경우의 이동은 사이에 생긴 대상 파일을 덮어쓴다

- 위치: `src/tools/plan-files.ts` `moveNoReplace`의 2단계(`98a52db`; 확인한 뒤 `rename`). 코드 주석이 알려진 한계로 적었다.
- 재현(executor.mjs E9): `link`가 `EPERM`으로 실패하게 하고, 확인과 `rename` 사이에 대상 파일을 만들게 했다. 결과는 적용 `ok`이고, 대상의 "created in the window" 내용이 원본 내용으로 바뀌었다(덮어씀).
  - 실제로 이 경로를 타는 경우: FAT·exFAT처럼 하드 링크가 없는 볼륨. 또는 Windows에서 읽기 전용 원본이라 `unlink`가 실패해 링크를 되돌리는 경우(`plan-files.ts` 주석).
- 영향: 설계 6.4와 계약 `PlanExecutor.apply`의 "never replaces an existing file"이 이 경로에서는 확률적으로만 지켜진다. 같은 시점의 다른 쓰기가 필요하므로 가능성은 낮다.
- 권고: PM이 정한다.
  - (a) 이 경로에서는 옮기지 않고 `cross_device`나 별도 문제 코드로 멈춘다.
  - (b) 한계로 설계 6.4와 사용 안내에 적는다.

#### L-2. 계획 저장 중에 온 취소는 무시되고 `plan_pending`으로 끝난다

- 위치: `src/engine/index.ts`(`ef99dd2`). 저장된 계획이 있으면 그 턴 뒤에 PLAN_PENDING으로 끝나며, 취소 확인보다 먼저다.
- 재현(P13b): 기록기가 `plan.json`을 쓴 직후 취소 신호를 보냈다. 결과는 `needs-input/plan_pending`이고, plan.json과 결과의 다이제스트가 일치한다.
- 영향: 사용자가 취소를 눌렀는데 결과는 "승인 대기"다. 파일은 바뀌지 않았고 적용에는 따로 승인이 필요하므로 위험은 낮다. 설계 6.4는 적용 중 취소만 정한다.
- 권고: 계획 실행의 취소 의미를 정한다. (a) 지금처럼 저장이 끝났으면 plan_pending으로 둔다(설계에 명시), 또는 (b) cancelled로 끝내되 남은 plan.json이 적용되지 않음을 적는다.

#### L-3. 실행기는 이미 중단된 신호를 `io_error`로 돌려준다

- 위치: `src/tools/plan-executor.ts` `apply`의 첫 줄(`98a52db`). 원본 해시 중 중단도 `hashProblem("aborted")`이면 `io_error`다.
- 재현(E7): 중단된 신호로 `apply`를 부르면 `io_error`가 나오고, 원본은 그대로다.
- 영향 [추정, 적용 루프 구현 전]: 설계 6.4의 4는 취소를 항목 사이에서 받아 `cancelled/cancelled`로 끝내라고 한다. 적용 루프가 항목 실패를 그대로 `apply_incomplete`로 바꾸면 취소가 실패로 보고된다.
- 권고: `PlanItemProblem`에 `cancelled`를 두거나, 적용 루프가 매 항목 전에 신호를 먼저 보도록 계약 주석에 적는다.

### 정보

- **I-1 작업 공간 밖 파일을 가리키는 하드 링크**(P8, P15):
  - `hardlink.txt`(밖 파일과 하드 링크)는 계획할 수 있고, `inspect_files`가 그 내용 해시를 낸다.
  - 옮기거나 폐기해도 바뀌는 것은 작업 공간 안의 이름뿐이다. 밖 파일은 그대로임을 확인했다.
  - 하드 링크는 경로로 구분할 수 없는 기존 한계다(`read_file`도 같다).
- **I-2 workflowRef 없는 실행은 바뀌지 않았다**:
  - 같은 레거시 task와 대본을 main(`b8fbb92`)과 G-B+G-C 빌드의 실제 CLI로 돌렸다(읽기, 쓰기, 거부되는 명령, `propose_plan`·`inspect_files` 호출, 끝).
  - runId, 시각, 소요 시간을 빼면 stdout, 기록 27줄, stderr가 모두 같다.
  - 새 도구 이름의 호출은 전처럼 `unknown_tool`이다. `run_started`에 워크플로 필드가 없고, 시스템 문구에 지시 표지가 없다.
  - 유닛 963건 중 953 통과·7 실패·3 건너뜀. 7건은 main의 i18n 카탈로그에 G-A id가 없어서이고 `claude/security-core` `fd54d32`이 채웠다.
  - 통합은 385건이 모두 통과했다. `k03` 3건은 처음에 빌드 사본에 `node_modules`가 없어 실패했고, 연결 뒤 7/7 통과했다.
- **I-3 지금은 파일을 옮기거나 지우는 경로가 없다**:
  - `createPlanExecutor`를 부르는 코드가 없다(`src/tools/index.ts`의 export뿐).
  - 앱 계층은 `applyPlan`을 비워 뒀다(`src/app/app.ts:315`).
  - `PlanRecorder` 구현(G-E)이 없어 실제 CLI의 `propose_plan`은 저장소가 없다는 `io_error`로 끝난다(`workflow-tools.ts:363`).
  - 그래서 다음은 실행으로 확인하지 못했다: 다이제스트 앞 12자 승인과 두 다이제스트 일치, `applied.json` 배타 생성, 터미널 `[y/N]`, 적용 사전 점검의 전 항목 확인과 정책 재판정(DR-5), 인벤토리(DR-6), 이동·폐기 되돌리기.
- **I-4 다이제스트**:
  - 계획이 저장된 모든 사례에서 `EngineResult.plan.digest`가 plan.json 바이트의 SHA-256과 같았다(계약 모양의 시험 기록기).
  - 모델은 다이제스트를 정할 수 없다. 해시는 도구가 계산한다(`proposePlan`).
  - 한 턴에 계획 두 개를 내면 첫 것만 실행되고 두 번째는 실행되지 않는다(P11).
  - 엔진의 `isProposedPlan`은 다이제스트 형식(64자 16진수)을 확인하지 않고 기록기를 믿는다.
- **I-5 원본 해시 생략과 마지막 확인**:
  - `apply`는 `check` 때와 (장치, inode, 크기, mtime ns)가 같으면 다시 해시하지 않는다. 마지막 확인은 장치와 inode만 본다.
  - E8에서 내용을 같은 크기로 바꾸고 mtime을 되돌렸지만 Node로는 ns 단위로 되돌릴 수 없었다(500 ns 차이). 그래서 `source_changed`로 잡혔다.
  - 해시와 rename 사이에 같은 파일을 제자리에서 고치는 것은 잡지 않는다.
  - 적용 뒤 인벤토리 검증(DR-6, G-D)이 계획 대상의 해시를 다시 비교하므로 사후 탐지 대상이다.
- **I-6 검토 중 브랜치 이동**: `claude/gui-design`은 처음 확인 때 `069cb73`(G-C 커밋 없음)이었다. 몇 분 뒤 `573fc8a`, `98a52db`가 올라왔다. 이 보고서는 위 고정 해시 기준이다.

## 3. 설계·결정 대조

| 항목 | 결과 |
| --- | --- |
| GT-E1 제시 도구 | 계획 실행은 `read_file`, `search_files`, `inspect_files`, `propose_plan`만 제시했다. 쓰기·명령·없는 도구는 `unknown_tool`(P12) |
| GT-E2 지시 | 레거시는 시스템 문구가 그대로다(I-2). 지시가 있는 실행은 실행 확인하지 않았다(G-B 유닛에 있음) |
| GT-E3 계획 단계 | 계획 저장 → `needs-input/plan_pending`, 검증기 호출 0(P1). 계획 없이 끝나면 `failed/model_error`(P14) |
| GT-E4 사람 확인 | 실행 확인하지 않았다 |
| GT-E5 설명자 기준 | 제시 목록이 설명자(`displayClass`, `endsRun`)로 정해진다 |
| 6.3의 2단계 행동별 정책 | 요청 단계(어휘)와 실효 단계(링크 해석) 모두 판정한다. 연결점은 실효 단계에서 `outside_root`(P4, P5, P5b) |
| 6.3의 3단계 `planActions` | 엔진은 막는다(P7, P7b). 게이트는 막지 않는다(M-1) |
| 6.3의 4단계 해시는 도구가 | 확인함. 모델 입력에 해시 필드가 없다 |
| DR-5 plan.json 내용 | 도구가 기록기에 행동과 해시만 넘긴다(요약 제외). 기록기 구현(G-E)은 아직 없다 |
| DR-9 폐기 보관 위치 | `.codaryn/discarded/<적용 runId>/<순번>`(E1). 그 경로가 링크면 거부하고 밖에 쓰지 않는다(E5, E5b) |
| 6.4 적용기 1·2·3·6·7 | 구현 전(I-3) |

## 4. 문제 없던 범위

- P2~P9c, P10·P10b(토큰 복원 허용·금지), P12, P13(계획 전 취소 → `cancelled`, plan.json 없음), P14, P15·P15b(루트 조사에 연결점과 `.codaryn`이 없음, 연결점 조사는 거부).
- E1(정상 이동·폐기, 해시 일치), E1b(재적용 `source_missing`), E2(원본 변경), E3(대상 생성, 남의 파일 보존), E4(원본이 연결점), E5·E5b·E6(연결점으로 밖에 쓰기 시도), E10(보관함의 같은 이름 보존).

## 5. 검사하지 않은 범위

- 적용 진입점, 승인, 사전 점검 루프, 인벤토리, 되돌리기(구현 전).
- GT-E4, 지시가 있는 실행, 실제 CLI의 계획 실행(G-F 연결 전).
- macOS·Linux(O_NOFOLLOW가 있는 경로), FAT·exFAT 실제 볼륨(L-1은 주입으로만 재현), 파일 심볼릭 링크(이 PC는 관리자 권한 없이 만들 수 없어 연결점과 하드 링크만 썼다).
- G-B·G-C 유닛 시험 자체의 품질.

## 6. 재현 자료 (`.codaryn/r5/`, Git 추적 제외)

- `gbc/`(G-B+G-C 빌드 사본), `main/`(기준 빌드 사본).
- `exp/plan-engine.mjs` → `exp/plan-engine.out`(P1~P15, G1).
- `exp/executor.mjs` → `exp/executor.out`(E1~E10).
- `legacy-in/`(레거시 task·대본), `legacy-{main,gbc}.{stdout,stderr,journal.jsonl}`.
- `unit-gbc.txt`, `integration-gbc.txt`.
