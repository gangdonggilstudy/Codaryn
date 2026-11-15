# V-7 U-180 정확성 검증

- 검증자: codex-check(검증 엔지니어·보안 검토).
- 대상: `unit/U-180-p4g-general`, `6098f7718777fc9716dfafa60b260192ce6ab8fb`; 기준 main `21107dc91d9522efbbb694f4da1bf79ffa1495d5`.
- 결과: **높음 0 / 중간 1 / 낮음 0**.
- 사본·증거: [codex-check-v7-u180-1794554537775](./codex-check-v7-u180-1794554537775/). 제품 소스 수정·커밋·푸시·git worktree add·실제 API·외부 네트워크·실제 키 조회·권한 요청 0.
- 검증 범위: 실제 엔진·도구 실행기·작업 공간·정책·가림 모듈, 대본 모델, 저장 경계 대역. 이 판의 CLI 파서는 `plan: run`을 `plan_run_not_available`로 거부하며 실제 `createPlanRecorder`에는 `saveChangesPlan`이 없다. **제품 CLI에서 새 계획 파일을 저장하는 전체 연결은 검증하지 못했다.** 아래 계획 파일은 대역이 받은 인자를 바꾸지 않고 JSON으로 기록한 것이다.

## 중간 M-1: 등록되지 않은 키 모양이 요약의 저장 인자에 원문으로 남는다

- 위치: `src/tools/workflow-tools.ts:538`, `:548`.
- `privacy.mask(args.summary)`는 등록 값만 가리고, `maskedParts(summary.text)`는 토큰을 제거한다. 별도의 키 모양 가림을 거치지 않아 등록하지 않은 키 모양은 `saveChangesPlan` 인자에 그대로 남는다.
- 재현: 사본에서 `node probe-v7.mjs`. `key-shaped-summary`는 프로그램이 만든 합성 Anthropic·OpenAI 키 모양 두 개를 summary에 넣고, 둘을 가림 값으로 등록하지 않는다. 실제 API 키는 사용하지 않는다.
- 실제 엔진과 도구를 통과한 결과: `needs-input/plan_pending`, 저장 호출 1회. 저장 인자의 summary 및 그 인자를 직렬화한 plan.json에 합성 키 모양 둘 다 남음. 기존 `hideKeys(summary, [])`는 같은 입력을 가리므로 모양 인식 실패가 아니다.
- `mixed-summary`에서는 등록 합성 값은 사라졌지만 미등록 키 모양은 남았다. **재현 2/2 사례**.
- 대조: `registered-summary`와 `registered-key-summary`는 원문·치환 토큰 잔류 0. 키 모양을 명시적으로 등록하면 가려진다.
- 증거: [probe-v7-results.json](./codex-check-v7-u180-1794554537775/probe-v7-results.json)의 `summaryRawAnthropic`, `summaryRawOpenai`, `shapeRecognizerMasks`. 합성 키 문자열 자체는 결과 로그에 출력하지 않았다.
- 한계: 현재 제품 저장기는 연결되지 않았으므로 실제 사용자 CLI의 저장 유출로 보고하지 않는다. 이번 B-3 도구가 저장 계약에 넘기는 요약의 가림 누락이다.

## 재현 수치

[probe-v7.mjs](./codex-check-v7-u180-1794554537775/probe-v7.mjs)는 원본 제품 소스를 수정하지 않고 새 임시 사례 폴더에 실제 파일·정션을 만든다. 엔진 journal·모델·검증기 경계는 시험 대역, 정책·가림·파일 검사·해시는 제품 구현이다. 저장 대역은 받은 summary/files에 schemaVersion/kind/runId만 붙이고 JSON 바이트 해시를 반환한다.

| 확인 항목 | 결과 |
| --- | --- |
| 대본 사례 | 35건, 저장 경계 호출 성공 7건, 거부·비계획 모드 28건 |
| 100개 파일 | 계획 1개에 정확히 100개 저장, needs-input/plan_pending |
| 101개·빈 목록 | 2/2 invalid_args, 저장 0 |
| 기존 디렉터리의 modify/create | 각각 not_file/file_exists, 저장 0 |
| 없는 파일의 modify·있는 파일의 create | 각각 file_missing/file_exists, 저장 0 |
| 파일 아래 경로·계획 파일 아래 계획 파일 | parent_not_dir; 부모·자식 입력 순서 양쪽 모두 거부, 3/3 저장 0 |
| 같은 경로·./ 별칭·대소문자 차이·구분자 차이·미존재 경로 대소문자 차이·내부 정션 별칭 | 6/6 duplicate_path, 저장 0; Windows 실파일 검사 |
| 작업 공간 밖 상대·절대 경로·외부 정션 | 3/3 policy_denied/outside_root, 저장 0 |
| 상태 경로 직접·대문자·정션 | 3/3 policy_denied/state_dir, 저장 0 |
| 보호 경로 modify/create·목록 뒤의 보호 경로·보호 경로 정션 | 4/4 policy_denied/protected_path, 전체 계획 저장 0 |
| writable 목록 밖 modify / 허용된 out 아래 신규 경로 | 각각 path_not_writable / 계획 성공 |
| 정상 create/modify | create의 sha256 null, modify는 실제 파일 바이트 SHA-256, kind changes |
| 성공 계획 7건 | 각각 요청 1회·저장 1회, plan.actions가 파일 수와 일치, digest가 기록한 plan.json의 SHA-256과 일치 |
| 계획 성공 직후 같은 응답의 write_file | 7/7 실행 안 됨; 검증기 실행 0 |
| 성공 계획의 파일 사후 확인 | 107개 항목 검사, create 대상 생성 0·modify 해시 불일치 0 |
| none/apply에서 propose_changes 호출 | 두 모드 모두 unknown_tool, 저장 0 |
| 도구 부분집합 × 계획 모드 | 384조합, run 이외에 propose_changes 제공 0 |
| 실제 제공자 직렬화 | Anthropic·OpenAI × none/apply/run = 6건. run만 propose_changes, apply는 propose_plan, none은 둘 다 없음. 주입 fetch만 사용, 실제 HTTP 요청 0 |
| 등록 값·등록 키 모양 summary | 원문 잔류 0, 토큰 잔류 0 |
| 미등록 키 모양 summary | 위 M-1의 2사례에서 원문 잔류 |

none 모드 대조에서는 원래 허용된 write_file이 실행되었다. 이를 계획 성공 후 실행으로 세지 않았다.

## 기존 출력 비교

[compare.md](./codex-check-v7-u180-1794554537775/compare.md): **27장면 중 차이 0, 종료 0, 네트워크 차단 기록 0**.

- `plan-apply`: stdout·stderr·종료값·JSON·저장 파일 등 33개 산출물 동일.
- `terminal-apply-yes` 20개, `terminal-apply-no` 17개, `handoff-plan-applied` 26개 산출물 동일.
- terminal 장면은 isTTY 모의이며 실제 콘솔 검증은 아니다.

## 실행 명령·시험 수치

`$V`는 위 사본의 절대 경로다. 관련 시험 TEMP·TMP는 `$V/test-tmp`로 지정했다. 설치 0회, 기존 로컬 TypeScript를 사용했다.

| 명령 | 결과 |
| --- | --- |
| `git status --short; git branch --show-current; git rev-parse --show-toplevel` | main, 추적 변경 출력 0행, D:/project/Codaryn |
| `git diff 21107dc...6098f77 -- src` | src 12파일, +399 / -82행 |
| `git archive --format=tar --output="$V/snapshot.tar" 6098f77`; `tar -xf "$V/snapshot.tar" -C $V` | 종료 0 |
| `node D:/project/Codaryn/node_modules/typescript/bin/tsc -p tsconfig.json --pretty false` | 종료 0, 타입 오류 0; build.log |
| 아래 관련 시험 10파일 | **110시험 / 25묶음 / 통과 109 / 실패 0 / 건너뜀 1 / 취소 0**, 769.897ms, 종료 0 |
| `node probe-v7.mjs` | 종료 0, 사례 35건·도구 선택 384조합·직렬화 6건 |
| 계획 파일 107항목 사후 fs 검사 | 생성·수정 발생 0 |
| `node scripts/compare-cli-boards.mjs --base 21107dc --head 6098f77 --work "$V/compare" --out "$V/compare.md" --keep` | 종료 0, 27장면 차이 0 |

관련 시험 명령(사본 cwd):

```powershell
node --test --test-timeout=30000 dist/tests/unit/cli/g-u180-plan-mode-rules.test.js dist/tests/unit/contracts/g-tool-contracts.test.js dist/tests/unit/contracts/g-u170-plan-run.test.js dist/tests/unit/engine/g-workflow-engine.test.js dist/tests/unit/engine/u170-plan-run-mode.test.js dist/tests/unit/engine/u180-propose-changes-engine.test.js dist/tests/unit/i18n/u180-propose-changes-texts.test.js dist/tests/unit/policy/u180-writable-create.test.js dist/tests/unit/tools/g-propose-plan.test.js dist/tests/unit/tools/u180-propose-changes.test.js
```

건너뜀 1건: 기존 propose_plan의 파일 심볼릭 링크 시험. Windows 생성 권한이 없어 실행되지 않았다. 정션 사례는 독립 재현에서 실행했다. 전체 시험 묶음·실제 API·새 run 계획의 승인 후 적용·제품 저장기 연결·경로 검사 중 동시 바꿔치기·다른 OS는 미검증이다.

