# 독립 검증 V-2 — U-170

- 검증자: codex-check, 검증 엔지니어·보안 검토.
- 대상: `pm/unit-U-170`의 `134c2ce94cfc77f33bcfa7a17d0dfb0e8aecabaf`; 기준 `f2a4625df94a0d956a1cc0728368e93101eeb3b1`.
- 검증 사본·증거: [codex-check-v2-u170-1794551383121](./codex-check-v2-u170-1794551383121/). git archive 사본만 사용.
- 지적: **높음 1 / 중간 1 / 낮음 1**. 높음·중간은 PM이 전달한 R-99 현상의 독립 재현이다. 전체 시험 실패의 원인·회귀 여부는 미확정이며 이 건수에 더하지 않았다.
- 제품 소스 수정·커밋·푸시·실제 API 호출: 각각 0. 의존성 설치는 오프라인. 샌드박스 밖 프로세스 조회 미실행.

## 지적과 재현

### 높음 1 — 정의의 run 계획을 task의 none으로 해제하면 승인 없이 쓴다

- 위치: `src/workflows/index.ts:137`. `plan_weakened`가 apply만 검사한다.
- 어긋나는 계약: `src/contracts/task.ts:46-48`, `src/contracts/workflow.ts:318-319`는 run → none도 거부한다고 명시한다. 제안서 B-1~B-4의 승인 전 쓰기 금지와 맞지 않는다.
- 재현: 사용자 설정 `workflows.planned = { tools: ["read_file", "write_file"], plan: "run" }`; task에 `workflowRef: "planned", plan: "none"`; 대본에 파일 생성·기존 파일 수정을 넣고 `node <사본>/dist/src/cli/main.js run --task task.json --config config.json --json`.
- 결과: 종료 0, `done/verified`, 모델 요청 3, 실제 파일 변경 2(생성 1·수정 1), 계획 파일 0, 승인 0. 프로필의 workflowRef로 같은 정의를 선택해도 동일.
- 대조: task의 `plan: "none"`을 생략하면 변경 0, 종료 1 `failed/model_error`.
- 증거: [repro-results.json](./codex-check-v2-u170-1794551383121/repro-results.json)의 `definition-run`, `definition-run-override-none`, `definition-run-profile-override-none`. 입력·출력·journal은 같은 이름의 `repro/` 하위 폴더.

### 중간 1 — 아직 계획을 만들 수 없는 run 모드가 요청 한도까지 실행된다

- 위치: `src/contracts/plan.ts:60`, `src/cli/task.ts:380-382`, `src/engine/index.ts:1471`.
- 재현: task `plan: "run"`, `maxModelTurns: 2`; 대본에 `read_file` 4회.
- 결과: 요청 2, 읽기 2, 변경 0, 계획 0, 종료 4 `budget-exhausted/max_model_turns`. 입력 단계 거부가 아니다.
- 대본이 최종 응답을 내면 요청 3 뒤 종료 1 `failed/model_error`. 안내는 `the run ended without a plan: propose_plan did not succeed`인데 run 모드에는 propose_plan도 제공되지 않는다.
- 계약 `plan.ts:55-59`에 임시 읽기 동작은 예고되어 있다. 따라서 미구현 기능의 요청 소비를 확인한 것이며, 실제 API 비용은 측정하지 않았다. 해당 주석의 실패 종료 설명에는 예산 소진 경로가 빠져 있다.
- 증거: [check-turn-limit.mjs](./codex-check-v2-u170-1794551383121/check-turn-limit.mjs), [실행 결과](./codex-check-v2-u170-1794551383121/repro/run-turn-limit/stdout.txt).

### 낮음 1 — writablePaths의 계약 포함 여부를 설명하는 주석이 충돌한다

- `src/contracts/workflow.ts:19-20`: writablePaths를 “이름만 있고 계약에 포함되지 않음”으로 설명.
- 같은 판의 `src/contracts/task.ts:181-197`, `workflow.ts:145-147`: 실제 정책 필드·교집합 계약을 명시. 제안서 B-4도 정책 필드로 정한다.
- 재현: 위 줄을 대조한다. 실제 파서 거부·정책 관문 미구현은 별도로 명시되어 있으므로 계약 존재 여부와 구분해야 한다.

## 실행 명령과 수치

PowerShell에서 `npm`은 npm.ps1 실행 정책으로 실패하여 `npm.cmd`로 실행했다. 아래 로그 경로는 증거 폴더 기준이다. TEMP·TMP·npm 로그도 그 폴더 아래로 지정했다.

| 명령 | 결과 |
| --- | --- |
| `git archive --format=tar --output=<증거>/head.tar 134c2ce`, `tar -xf ... -C <증거>/head` | 종료 0 |
| `npm.cmd ci --offline --ignore-scripts --no-audit --no-fund --logs-dir <증거>/npm-logs` | 종료 0, 4개 패키지, 약 1초 |
| `npm.cmd run typecheck` | 종료 0, 타입 오류 0; `typecheck.log` |
| `npm.cmd run test:unit` | 종료 집계 없이 중단; `unit.log` |
| `npm.cmd run test:integration` | 별도 동일 판 사본 `compare/head`에서 npm ci 후 실행. 종료 집계 없이 중단; `integration.log` |
| `node bounded-tests.mjs <증거>/head test:unit <증거>/unit-bounded.log 180` | **끝나지 않음: 3분(180,013ms), 제한 종료값 124**, 전체 성공·실패·총수 확정 불가 |
| `node bounded-tests.mjs <증거>/compare/head test:integration <증거>/integration-bounded.log 180` | **끝나지 않음: 3분(180,018ms), 제한 종료값 124**, 전체 성공·실패·총수 확정 불가 |
| `node --test --test-timeout=30000 dist/tests/unit/contracts/g-u170-plan-run.test.js dist/tests/unit/contracts/g-u170-writable-paths.test.js dist/tests/unit/engine/u170-plan-run-mode.test.js` | 종료 0, **21시험 / 8묶음 / 성공 21 / 실패 0 / 취소·건너뜀 0**, 98.5248ms; `u170-targeted.log` |
| `node scripts/compare-cli-boards.mjs --base f2a4625 --head 134c2ce --work <증거>/compare --out <증거>/compare.md --keep` | 종료 0, **27장면 / 차이 0 / 네트워크 차단 기록 0** |
| `git diff --exit-code f2a4625 134c2ce -- tests/unit/cli/sp0-expected.ts tests/unit/model/anthropic/sp0-golden.ts tests/unit/cli/human/real-catalog.test.ts` | 종료 0, **3파일 동일**; 각 판의 `git ls-tree` blob도 동일 |
| `node repro-v2.mjs` | 종료 0, CLI 사례 9개. 결과는 아래 표 |
| `node check-turn-limit.mjs` | 재현 스크립트 종료 0; 내부 CLI 종료 4, 요청 2 |
| `node check-tool-requests.mjs` | 종료 0, **도구 부분집합×모드 192조합, 제공자 직렬화 6건, propose_changes 정의 포함 0건** |

제한 실행기는 npm의 각 시험 스크립트에 `--test-timeout=90000 --test-force-exit`을 추가하고 전체 180초를 제한했다. 정상 전체 시험 완료로 세지 않았다. 결과 메타데이터는 `unit-bounded.log.result.json`, `integration-bounded.log.result.json`이다. 제한 도달 뒤 해당 실행 세션에 중단 신호를 보냈으나 잔존 프로세스 여부는 조회하지 않았다.

미완료 로그에서 확인한 실패 표기: 단위 `tests/unit/tools/cut-output.test.js` 파일 1건, 통합 `F5-g2 T-8 검증 도중 실행 시간 한도가 끝나면 budget-exhausted/max_duration` 1건(제한 재실행에서 100,054.6187ms). 최종 집계·실패 원인은 확보하지 못했다.

### 입력별 실제 결과

| 입력 | CLI 종료 / 모델 요청 / 파일 변경 / 계획 | 관찰 |
| --- | --- | --- |
| 직접 plan: run | 1 / 3 / 0 / 0 | 읽기만 실행. 생성·수정·명령·propose_plan·propose_changes 5호출 모두 unknown_tool |
| policy.writablePaths: [] | 2 / 0 / 0 / 0 | invalid_task, unknown_field; 무시하지 않음 |
| policy.writablePaths: ["out"] | 2 / 0 / 0 / 0 | 같은 거부 |
| task 최상위 writablePaths: [] | 2 / 0 / 0 / 0 | unknown_field |
| plan: run + policy.writablePaths: [] | 2 / 0 / 0 / 0 | unknown_field |
| tools: ["propose_changes"] | 2 / 0 / 0 / 0 | invalid_task |
| 정의의 plan: run | 1 / 3 / 0 / 0 | 쓰기 거부 |
| 정의 run + task none | 0 / 3 / 2 / 0 | 승인 우회 |
| 프로필로 정의 선택 + task none | 0 / 3 / 2 / 0 | 승인 우회 |

### 고정 값·정의·B-1~B-8 대조

- [compare.md](./codex-check-v2-u170-1794551383121/compare.md): 기존 plan/apply 장면 33개 산출물, terminal-apply-yes 20개, terminal-apply-no 17개가 각각 동일. stdout·stderr·종료값·JSON·저장 파일을 비교했다. 터미널 장면은 isTTY 모의이며 실제 콘솔 검증은 아니다.
- 세 고정 파일의 공통 blob: sp0-expected `6039ef2ff3918e1d23257c8edb5f0fdf42610e22`; sp0-golden `ce9737adcf6c3d011fda0f73ebf11fef00fa93c5`; real-catalog `9d6565618796dd61f87a1c52442bd50dabe1a338`.
- 도구 정의: `ALL_TOOL_NAMES`, `WORKFLOW_TOOL_NAMES`, 설명자·정의 등록표에서 propose_changes 없음. none/apply/run별 엔진 요청을 Anthropic·OpenAI 직렬화에 전달한 6건 모두 없음. 요청에 이름을 강제로 넣은 추가 6건도 전송 전에 `has no definition`으로 거부. 주입 fetch만 사용했으며 실제 HTTP 호출은 0.
- B-1: 인자 summary/files, create/modify, endsRun: plan, 저장 kind: changes 일치. 기존 kind: plan 유지.
- B-2: modify의 SHA-256, create의 null, 요약은 강제하지 않는 지시라는 주석 일치. 요약도 저장 JSON의 다이제스트에는 포함된다고 명시한다.
- B-3: EngineResult의 planRunId·planDigest, run_started의 같은 필드·approval 추가 일치. 실제 승인 실행 연결은 후속 단위이며 이번 판에는 없음.
- B-4: 교집합·출처별 집합·보호 경로 우선 계약 일치. JSON 입력은 위 표대로 거부. 헤더 불일치는 낮음 1, 승인 약화는 높음 1.
- B-5: 파일 상한 100, 계획 경로는 정확한 파일만 포함한다는 계약 일치.
- B-6: 파일 소실·종류 변경·해시 변경·create 자리 점유의 plannedFileStale 순수 판정 일치. 실제 승인 전 점검 연결은 후속 단위.
- B-7: 이미 실행한 계획의 plan_stale 계약 명시. applied.json 연결은 후속 단위.
- B-8: writablePaths가 파일 도구만 제한하고 허용 명령의 쓰기는 막지 못한다는 주석 일치. doctor 경고는 후속 CLI·앱 단위이며 이번 판에서 검증하지 않았다.

