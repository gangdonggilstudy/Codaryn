# V-9 U-181 정확성 검증

- 담당: codex-check. 높음 **0건**, 중간 **0건**, 낮음 **0건**(아래 실행 범위).
- 비교: main `de2256f17369e99f1153a175db0076becc9113f8` → unit/U-181-nc-human `b4a5b2adcae999f45d5a4eb953a44734ef43a051`.
- 사본: `D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-check-v9-u181-1794555909741`의 `base`, `head`. git archive 사본에서만 빌드·시험·재현 자료를 생성했다. 저장소 소스 수정·커밋·푸시·worktree 추가, 실제 API·외부 네트워크·키 조회·권한 요청은 하지 않았다.

## 결과와 재현 방법

| 확인 항목 | 재현 방법 | 수치·판정 |
| --- | --- | --- |
| 기존 이동 계획 바이트 | base/head의 실제 savePlan에 동일 runId와 일반·shown 포함·한글 경로 입력을 각각 전달하고 파일 Buffer, 반환 digest, loadPlan 결과 비교 | 3/3 일치. plan.json 212·365·295바이트 |
| 두 종류 읽기·손상 판정 | 각 kind에 정상 1개, 손상 11개를 생성. 손상은 kind 누락/오류, schemaVersion 오류, runId 오류, actions/files 혼합, summary 혼합·누락, digest 불일치, result.plan.kind 불일치, 깨진 JSON, 항목 0개, 추가 필드. digest 불일치 시험 외에는 변조된 실제 바이트로 digest를 다시 계산 | loadAnyPlan: 정상 2/2 수용, 손상 22/22 `invalid_run_record`. loadPlan은 정상 changes도 거부 |
| 누락 기록 | plan.json, result.json, journal.jsonl 누락 및 없는 runId를 base/head에서 읽음 | 4/4 동일. 차례로 `plan_run_missing`, `run_not_plan`, `run_not_found`, `run_not_found` |
| applied.json 동시 선점 | 동일 계획을 가리키는 createRunRecorders를 별도 Node 프로세스 2개에서 생성. 두 프로세스의 준비 응답 후 동시에 markApplied 요청. 독립 디렉터리로 8회 반복 | 16프로세스/8회 모두 `marked` 1개 + `already_applied` 1개. 저장 승자 일치 8/8, 재시도 후 바이트 불변 8/8, 재읽기 성공 8/8, 임시 파일 잔류 0 |
| plan.json 한 번 저장 | 먼저 move 또는 changes를 저장한 뒤 같은 run에 savePlan과 saveChangesPlan 각각 재호출 | 2사례/4회 모두 거부, 기존 바이트 불변 |
| 등록 값 가림 | 합성 시험 문자열 1개를 실제 createPrivacyGateway에 등록 → mask → maskedParts → saveChangesPlan → 실제 plan.json 검사 | 원문 잔존 0, 내부 치환 토큰 잔존 0. summary는 `["before "," after"]`. 파일 SHA-256과 반환 digest 일치, loadAnyPlan 성공 |
| 실행 목록 planRunId | 일반 실행, 계획 실행 완료·진행 중, approval 누락, 결과 digest 불일치, result에만 계획 정보, 자기 runId 참조의 7사례 | 정상 3/3 checked. 계획 실행 2/2만 planRunId 노출. 손상 4/4 damaged |

loadPlan 비교 28사례 중 **27개 동일, 1개 판정 강화**: 정상 이동 plan.json과 digest는 그대로 두고 result.json의 `plan.kind="changes"`만 넣으면 base는 성공, head는 `invalid_run_record`다. 두 기록의 종류 불일치를 거부하는 변경이며 정상 구형 이동 기록의 호환성 결함으로 집계하지 않았다. plan.json의 kind가 없는 파일은 base/head 모두 손상 판정이다.

가림 검증은 계약에 맞는 **gateway → 가린 문자열 조각 → 저장기** 경로다. saveChangesPlan 자체에는 등록 값 목록이나 gateway가 없으며, 이미 가린 조각을 받는 계약이다(`src/contracts/plan.ts:322`). 전체 엔진에서 이 경로가 연결되는지는 이번 저장 모듈 검증에 포함하지 않았다.

## 상한

독립 입력 경계 16사례: 수용 6개, 거부 10개. 거부한 changes 입력은 plan.json을 만들지 않았다.

| 대상 | 수용 | 거부 |
| --- | --- | --- |
| changes 파일 수 | 1, 100 | 0, 101 |
| 동일 경로 중복 | — | 같은 경로 2개 |
| summary 조각 수 | 501 | 502 |
| summary 문자열 합계(UTF-16 단위) | 2000 | 2001 |
| shown 문자열 합계(UTF-16 단위) | 8192 | 8193 |
| summary 내부 치환 토큰 | — | 토큰 포함 |
| 파일 hash 계약 | — | create에 hash, modify에 null |
| 기존 이동 action 수 | 1000 | 1001 |

summary 500자 제한은 도구 입력 계약이고, 저장 조각의 실제 검사 상한은 501조각·2000단위다. 위 표는 저장 모듈에서 실행한 경계다.

파일 크기는 `MAX_REPORT_FILE_BYTES=268435456`(256MiB). plan.json/result.json/journal.jsonl/applied.json을 각각 실제 **268435457바이트**로 늘린 4사례 모두 `invalid_run_record`. 해당 초과 파일에 대한 readFile 호출은 **0회**였다(읽기 감시를 설치하고 시험 후 복구). 정확히 256MiB인 유효 파일의 수용 여부는 실행하지 않았다.

## 돌린 명령과 수치

저장소 루트에서 변경을 읽고 지정 위치에 archive 사본을 만들었다.

```powershell
git diff de2256f...b4a5b2a -- src/store
git archive --format=tar --output=<사본 루트>/base.tar de2256f
git archive --format=tar --output=<사본 루트>/head.tar b4a5b2a
tar -xf <사본 루트>/base.tar -C <사본 루트>/base
tar -xf <사본 루트>/head.tar -C <사본 루트>/head
```

base/head 각각에서 기존 로컬 TypeScript로 빌드: **2회 모두 종료 코드 0**. 의존성 설치 없음.

```powershell
node D:/project/Codaryn/node_modules/typescript/bin/tsc -p tsconfig.json --pretty false
```

head에서 TEMP/TMP를 사본 루트의 test-tmp로 지정하고 관련 시험만 실행:

```powershell
node --test --test-timeout=30000 dist/tests/unit/store/u181-changes-plan.test.js dist/tests/unit/store/u181-runs-carried-plan.test.js dist/tests/unit/store/g-plan.test.js dist/tests/unit/store/g-apply-runs.test.js dist/tests/unit/store/dr38-state-guard.test.js dist/tests/unit/store/u16-plan-applied-by.test.js dist/tests/unit/store/u162-runs-phase.test.js
```

**23 suite, 71 test, 통과 71, 실패 0, 취소 0, 건너뜀 0, todo 0, 2555.3333ms, 종료 코드 0.** 전체 시험 묶음은 실행하지 않았다.

사본 루트에서 독립 재현 실행:

```powershell
node probe-v9.mjs
```

**결과 행 69개, 종료 코드 0, 약 3.738초**. 전체 60초·경쟁 자식 프로세스 5초 제한, 시간 초과 0. 행 구성: 바이트 비교 3 + 읽기 28 + 입력 경계 16 + 가림 1 + 크기 4 + 경쟁 8 + 중복 저장 2 + 목록 7. 이 수치는 유닛 테스트 71개와 별도다.

재현 자료: 사본 루트의 `probe-v9.mjs`, `probe-v9-results.json`, `probe-v9.log`, `related-tests.log`, `head/build.log`, `base/build.log`. 입력·결과 파일은 `probes-2S53Q1` 아래에 남겼다. 재현 스크립트를 다시 실행하면 별도의 probes 폴더를 만든다.

