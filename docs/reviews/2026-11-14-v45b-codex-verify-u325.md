# V45b — U325 doctor core 최종 판 독립 검증

- 검증자: **codex-probe**, 정확성·스케줄링·비밀값 경계 검토. Windows / Node v26.13.1.
- **높음 0 / 중간 0 / 낮음 0.** 지정 최종 판에서 검사 범위의 회귀를 발견하지 못했다. 병합 판단은 PM이 한다.
- parent **`df69a1bdd427d340c8fdf631d5e88c187aa99764`** → exact board **`62cfd5d30cc5377ac64915228ce59e87d9703f4a`**, tree **`27d503322e3d93abf549ac4c53097de50b0e7dc2`**. 구현 `3c01d767`.
- 사용자 지정 새 archive/evidence: `.worktrees/codex-verify/.codaryn/codex-probe-v45b-u325/`. Git에서 board/tree와 소유 4파일을 확인했다. app.ts·기존 helper·GUI·contracts·비교 cases는 이 판에서 변경되지 않았다.

| 독립 검증 | 실측 |
| --- | --- |
| exact archive 루트 빌드 | 종료 **0** |
| 원래 baseline 91+8 | **99관찰, 차이 0** |
| E4 양성 10쌍 | **20관찰, 차이 0** |
| canonical scheduling v2 | **22사례, 차이 0** |
| **불변 기대값 replay 합계** | **141관찰 동일** |
| 관련 doctor 시험, 후보 | **76/76 통과**, 실패·취소·skip·todo 0; 1,921ms |
| scheduling 8시험, OLD / 후보 | **8/8 / 8/8**, trace·결과 bytes/hash·예외 동일성 진단 **8쌍 동일** |
| 원래 seal·입력 | 실행 전후 동일, 입력 **101파일 불변** |
| 판정 본문·await | 반환 completion 포장 외 본문/내부 주석 동일, **12개 await 지점 동일** |
| renderer / 기존 helper / app.ts | **각각 바이트 동일** |
| 타입·입력 필드 | 동등성·양방향 할당 검사 종료 **0** |

후보 76시험은 이전 관련 68개에 신규 scheduling 8개를 더한 것이다. OLD 8개는 별도 대조 실행이고 후보 통과 수에 다시 더하지 않았다. 전체 suite는 실행하지 않았다.

## 반환 경계·Promise와 소스 검토

- 후보 `src/app/doctor.ts:36`의 checkDoctor는 원래 runDoctor의 platform 읽기부터 output 생성까지를 옮겼다. 선행 경로 거부를 `complete({ok:false,outcome})`로, 마지막 반환을 `complete({ok:true,output,currentKey,platform})`로 바꾼 경계 외 판정 본문이 일치했다. 내부 주석·검사 배열/notes·오류·await 순서도 그대로다.
- 후보 `src/cli/doctor.ts:199–214`: parseDoctorArgs(io.argv) → 실패 시 Promise.resolve(argumentsError) → **checkDoctor Promise 직접 반환**이다. wrapper에 await나 then을 추가하지 않았다. try/catch의 Promise.reject는 argv getter 등 동기 평가 실패도 기존처럼 rejected Promise로 연결한다.
- formatter는 `:204`의 같은 프로세스 callback이며 **core의 원래 반환 지점에서 동기 실행**된다. `:207`에서 JSON/text를 나누고 기존 renderDoctor·jsonLine과 최종 hideKeys를 적용한다. core가 관찰한 platform을 받아 쓰므로 getter를 다시 읽지 않는다. core 자체는 messages/stdoutIsTerminal에 접근하지 않는다.
- **함수 종류 차이는 공개한다:** 옛 async function에서 ordinary Promise-returning function으로 바뀌었다. constructor/reflection이 같다고 주장하지 않는다. PM이 수락한 범위대로 Promise<CommandOutcome>와 실제 호출·관찰·완료 순서를 검증했다. 함수 종류 introspection을 새로운 API 정책으로 만들지 않았다.
- `src/cli/main.ts:343`, `src/app/app.ts:737`가 실제 제품 소비자이며 둘 다 await로 CommandOutcome을 받는다. src/gui/scripts의 runDoctor 사용처를 확인했고 생성자 종류에 기대는 실제 제품 경로는 없었다. 테스트의 Promise assertion/await/assert.rejects 경로도 통과했다.
- 기존 renderer 구간 SHA-256은 계속 `02611c5731d2d5d11d58979be939df0bdf5d4cb42be990d3ee416752f475dc6f`다. U324 상수·inspectLockFile 옛 binding 신원은 기존 u324 시험 5개에서 다시 확인했다. DoctorCheckEnvironment·LockState 본문은 그대로이고 DoctorEnvironment의 argv/messages/stdoutIsTerminal도 유지된다. 같은 계약 타입 정체성으로 원래 공개 환경형과 새 형의 동등성·양방향 할당을 컴파일 확인했다. DoctorCheckInput은 기존 DoctorArgs에서 command/json만 뺀 필드와 같다.

## 스케줄링과 비밀값 경계

canonical v2의 OLD 기대값·harness를 수정하지 않고 후보를 지정해 실행했다. I/O 없음의 messages/terminal 즉시 변경·queued 변경은 반환 전 값을 읽고, 실제 미해결 readFile Promise 뒤에는 늦은 변경값을 읽었다. JSON은 presentation getter를 읽지 않았다. 잘못된 argv/UNC 경로는 presentation 접근 없이 거부했다. getter 예외는 원래 canary 동일 객체로 reject했고 동기 throw는 없었다. Promise callback과 queueMicrotask의 순서, 출력 원문과 Symbol 오류 진단도 기대값과 일치했다.

신규 scheduling 8개를 동일한 후보 시험 파일로 OLD adopted archive에 연결해 **8/8 통과**, 후보에서도 **8/8 통과**시켰다. 두 TAP의 scenario별 trace·출력 길이·직렬화 bytes·SHA-256·canary 동일성 진단 8개를 직접 맞대어 모두 같았다. no-I/O 표본의 출력은 그 시험의 결정적 입력에서 양쪽 **1,342자**다. 독립 v2는 자기 입력에 대한 별도 22기대값이며 둘의 문자 수를 섞지 않는다.

초기 미커밋 await-core 후보의 +402자/늦은 getter 회귀는 PM이 재현해 거부한 **수정 전 이력**이다. 이번 archive는 수정된 최종 판이며, 그 초기 후보를 이번에 다시 실행하거나 최종 결함으로 집계하지 않았다.

비공개 문맥은 `src/app/doctor-types.ts:56`의 DoctorCheckResult에 한정된다. output/currentKey/platform은 필수 completion callback에 주어지고, 현재 유일한 제품 소비자는 CLI formatter다. `src/app/doctor.ts`가 raw 문맥을 자동으로 공개 outcome에 반환하지 않으며, callback은 기존 text/exitCode 또는 기존 오류만 돌려준다. app/index·공개 AppCallOutcome·IPC/GUI에는 새 문맥을 추가하지 않았다. E4의 JSON 필드/escape 경계 가림과 앱 internal_error도 동일했다.

신규 core의 정적 런타임 의존 폐쇄 **79모듈**에서 CLI 도달 경로는 **0**이었다. 새 app/doctor 및 doctor-types에 CLI 직접 import도 없다. 이는 **해당 core 폐쇄 범위**이며 전체 앱→CLI 0 주장이 아니다. 앱 doctor의 직접 연결은 아직 후속 단계다.

## 명령·봉인·증거

cwd `D:/project/Codaryn`에서 다음 정확한 archive/build를 실행했다.

```text
git archive --format=tar --output=D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-v45b-u325/board.tar 62cfd5d30cc5377ac64915228ce59e87d9703f4a
tar -xf D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-v45b-u325/board.tar -C D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-v45b-u325
node node_modules/typescript/bin/tsc -p .worktrees/codex-verify/.codaryn/codex-probe-v45b-u325/tsconfig.json --typeRoots D:/project/Codaryn/node_modules/@types
```

이후 후보 archive cwd에서 `node replay.mjs`, `node audit.mjs`, `node D:/project/Codaryn/node_modules/typescript/bin/tsc -p tsconfig.audit.json`, `node test-runner.mjs`, `node scheduling-old.mjs`를 실행했다. 타입 log/exit, 정확한 node --test argv/cwd와 전체 TAP을 자기 폴더에 저장했다. 관련 파일은 app/u324-doctor-helpers·u325-doctor-scheduling 및 cli/n-wiring·n-reclaim·g-doctor-parked·g-doctor-config-source·g-sp6-doctor·g-u100-doctor-key-hint·k-report-doctor·g-doctor-q5다.

- [replay-results.json](codex-probe-v45b-u325/replay-results.json): 모든 실행 exit·stdout·기간. C10_BOARD와 C10_SCHEDULING_BOARD만 새 정확한 archive로 지정했다. 기존 기대값·harness·정규화는 그대로다.
- [source-results.json](codex-probe-v45b-u325/source-results.json), type-audit.ts·type-audit.log·type-audit-exit.txt: 소스·형 감사.
- unit-tests.tap·test-command.json, scheduling-old.tap·scheduling-old-command.json 및 [scheduling-comparison.json](codex-probe-v45b-u325/scheduling-comparison.json): 후보 76·OLD 8과 진단 직접 비교.
- 원래 expected hash는 `3db5c880…ddf89a4` / `e225f7dc…d97070e`, E4 `f5577725…fab3f23`, canonical v2 **`be2e9ed29e5d754f42aa59f45c9983d54ae667b5a51263a0eb9e0774be7e2257`**이다. original seal은 실행 전후 **`0c638603fdf938430f552e604e31ec121bf7170d24f08c952176bf66f1cbc0a9`**. v2 expected/harness/fence·기존 증거 참조 hash도 replay에서 확인했다. v1은 사용하지 않았다.

PM final-evidence/report.md는 읽었지만 PM의 전체 unit/integration·GUI426·smoke227·CLI95·secrets/pins 결과를 독립 실측에 합산하지 않았다. 실제 provider/API·키 파일·외부 네트워크/DNS·실제 TTY/Linux는 미수행이며 fence 시도는 0이었다. 모든 동시성·악의적인 런타임 전역 변경 상태를 보증하는 결과는 아니다. teardown 차단·권한 요청·새 worktree·제품/worker/Git mutation은 없었다. 후속 appdirect는 별도 정확한 최종 판의 검증이 필요하다.
