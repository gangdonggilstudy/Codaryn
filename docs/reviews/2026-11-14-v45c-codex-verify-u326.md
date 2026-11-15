# V45c — U326 APP-DOCTOR 독립 검증

검증자 **codex-probe**, 정확성·앱 아키텍처·비밀값 경계 검토. 2026-11-14, Windows / Node v26.13.1.

**높음 0 / 중간 0 / 낮음 0.** 지정 최종 판에서 검증 범위의 회귀를 발견하지 못했다. 병합 판단은 PM에게 남긴다.

| 판·격리 | 값 |
| --- | --- |
| OLD / parent | `bb382b0452f66063fde0530f9dfacb4dfd03f841` |
| exact board | `de99a20d86905ca035559b835db5d60b946af90e` |
| exact tree | `7f35dc0faef78e70491c39eda5c25b08c0a647a6` |
| 구현 | `a70c71cc` |
| 자체 archive/evidence | `.worktrees/codex-verify/.codaryn/codex-probe-v45c-u326/{old,head}` |
| 변경 범위 | `src/app/app.ts`, `tests/unit/app/u326-doctor-direct.test.ts` 두 파일만 |

## 실행 결과

| 독립 실행 | 실제 결과 |
| --- | --- |
| OLD / head archive 빌드 | 각각 종료 0; 약 1.885초 / 1.795초 |
| 원래 baseline | 91+8 = **99관찰, 차이 0** |
| E4 양성 supplement | 10쌍 = **20관찰, 차이 0** |
| canonical scheduling v2 | **22관찰, 차이 0**, networkAttempts 0 |
| 불변 oracle 합계 | **141관찰, 차이 0** |
| head 관련 시험 | **88/88 통과**, 실패·취소·skip·todo 0; TAP 2,041.9004ms |
| OLD 대조 시험 | 신규 public 12 + 기존 CLI scheduling 8 = **20/20 통과**, 실패·취소·skip·todo 0; 300.1214ms |
| public app 비교 | **6쌍**, trace·직렬화 바이트 길이·SHA-256 차이 0 |
| CLI scheduling 비교 | **8쌍**, 기존 진단 trace·출력 길이/해시 차이 0 |
| 원래 seal / 입력 | 실행 전후 유효, **101입력 파일 불변** |

head 88개는 기존 관련 76개에 U326 신규 12개를 더한 수다. OLD 20개는 별도 대조 실행이며 head 수에 중복 가산하지 않았다. 동일한 신규 시험을 OLD에 적용하기 위해 head의 컴파일된 `dist/tests/unit/app/u326-doctor-direct.test.js`만 OLD의 대응 시험 경로에 복사했다. 상대 import는 OLD 제품 모듈을 읽으며 OLD 제품 소스·제품 JS는 바꾸지 않았다.

## 소스·계약 판단

- 후보 `src/app/app.ts:729`의 공개 메서드는 계속 `async`이며 `Promise<AppCallOutcome<DoctorOutput>>`다. `src/contracts/app.ts:1230` 계약과 공개 export는 바뀌지 않았다. `gui/src/engine-host/host.ts:48,281`도 Promise 계약으로 호출하고, `gui/src/main/ipc.ts:361` 및 renderer는 완료를 기다린다. constructor/reflection을 새 API 정책으로 취급하지 않았다.
- `src/app/app.ts:730`의 **pre-try 요청 본문 전체**, `:737`의 **io literal 본문·주석 전체**, `:770`의 기존 jsonOutcome, outer catch·결과 매핑이 OLD와 원문 동일하다. 요청의 non-null getter 두 번 읽기, 두 번째 getter가 던진 값의 동일성, try 밖 rejection, try 안 환경 getter 실패의 INTERNAL_ERROR 변환을 OLD/head 동일한 assertion으로 확인했다.
- `:737–755`의 env·cwd·nodeVersion·installDir·readFile·isDirectory·isFile·default 설정·locale 평가가 파싱보다 먼저다. 잘못된 인수여도 이 순서를 유지한다. `:756`의 checking은 ordinary Promise 반환 함수다. 파싱 거부는 Promise.resolve, core는 **Promise 직접 반환**, 동기 예외는 Promise.reject이며 추가 await/then이 없다. `:769`의 바깥 await가 기존 비동기 경계를 유지한다.
- public 6쌍은 no-I/O, parse 거부, path 거부, 실제 미해결 readFile, core 예외, io getter 예외다. no-I/O는 returned→queued→fulfilled→after-await, io getter 예외는 readFile.get→returned→fulfilled→queued→after-await이며 OLD와 같다. deferred 읽기와 getter 순서도 양쪽 모두 신규 assertion을 통과했다. CLI v2 22관찰은 text/JSON, 즉시 terminal/messages 변경, 실제 readFile 대기 뒤 늦은 변경, presentation 비접근 거부, getter 예외와 microtask 순서를 별도로 보존한다.
- `src/app/app.ts:760–763`의 completion callback은 core의 원래 return 지점에서 동기 실행된다(`src/app/doctor.ts:36,605`). **jsonLine → 전체 hideKeys → CommandOutcome → 기존 jsonOutcome** 순서다. raw output/currentKey/platform 문맥을 공개 outcome에 직접 반환하지 않는다. `src/app/doctor-types.ts:56`의 문맥은 내부 same-process용이며 contracts·public index·IPC·window 필드 변경은 없다. E4 재사용 두 입력도 OLD/head에서 masked JSON 및 기존 INTERNAL_ERROR 결과를 유지했다.
- `tests/unit/app/u326-doctor-direct.test.ts:152`의 UNKNOWN 추가 getter들은 **지원 AppEnvironment 포트가 아니다**. 환경을 실수로 spread하거나 새로운 필드를 읽는 것을 잡는 sentinel이며 새 포트 보장을 뜻하지 않는다. 생략된 실제 포트·기존 fallback은 기존 oracle과 관련 시험 범위에서 유지됐다.
- doctor core/types/helper/CLI, args, guard, command-outcome **7파일 바이트 동일**이다. doctor 메서드와 문서화된 import 두 변경을 역치환하면 app.ts 전체가 OLD와 같다. 따라서 다른 app 메서드 변경은 없다. app의 CLI doctor 직접 import는 제거됐지만 기존 CLI args·guard·renderer 의존성은 남는다. **전체 app→CLI 의존성 0이라는 판단은 하지 않았다.**

원문·파일 SHA 증거는 `codex-probe-v45c-u326/source-results.json`에 있다. 핵심 고정 fingerprint:

| 파일 | OLD = head SHA-256 |
| --- | --- |
| `src/app/doctor.ts` | `0ac6506a949f6c89d04d4e710827f3668c578939589000896c25fe177ead64d3` |
| `src/app/doctor-types.ts` | `eafb18c3c38f984bfe186463f86630995a57789e8c31837022d6b3560b732e95` |
| `src/app/doctor-checks.ts` | `d991256a60f2ab19fa14e9b14375040697b3a527d8addddb3d5c864ebe603c33` |
| `src/cli/doctor.ts` | `1b39ab2e1aa51376eeb9cc8eceb7302e81f1e5fc9cb24fd3d05866c185acfc16` |

## 명령·봉인·한계

저장소 cwd `D:/project/Codaryn`에서 지정 두 commit을 `git archive --format=tar --output=<자체 경로>/old.tar <OLD>` 및 대응 `head.tar <board>`로 만들고 각 자체 old/head에 `tar -xf <tar> -C <directory>`로 풀었다. board/tree 및 두 파일 diff를 Git으로 확인했다. 각 old/head cwd에서 실제 빌드 명령은 다음과 같다.

```powershell
node D:/project/Codaryn/node_modules/typescript/bin/tsc -p tsconfig.json --typeRoots D:/project/Codaryn/node_modules/@types
```

자체 evidence cwd에서 실행한 bounded runner:

```powershell
node replay.mjs
node test-runner.mjs
node old-tests.mjs
node source-audit.mjs
```

`replay.mjs`는 원래 seal→91→8→E4 20→canonical v2 22→seal 순서로 실행했고 C10_BOARD/C10_SCHEDULING_BOARD는 exact head archive로 지정했다. 새 expected 생성이나 정규화 변경은 없었다. `test-command.json`과 `old-tests-command.json`에 실제 node 인수·cwd가 있다. `node --test --test-concurrency=1 --test-reporter=tap`에 cleanup guard와 기존 network-fence를 preload했다. head 관련 파일은 app/u324-doctor-helpers, app/u325-doctor-scheduling, app/u326-doctor-direct 및 CLI n-wiring, n-reclaim, g-doctor-parked, g-doctor-config-source, g-sp6-doctor, g-u100-doctor-key-hint, k-report-doctor, g-doctor-q5다.

| 보존 대상 | SHA-256 |
| --- | --- |
| 원래 91 expected | `3db5c8809a51681e9476633b7d4a73a1a1105eaabe20bb3cf8aa52837ddf89a4` |
| 원래 8 expected | `e225f7dc76ef1dc1f823b4583ea6d9935662e8b316232d13bc87b9169d97070e` |
| E4 20 expected | `f5577725c283fa3f206b86a2d66d3f5c164dd1184883350169ffe4bfcfab3f23` |
| 원래 seal | `0c638603fdf938430f552e604e31ec121bf7170d24f08c952176bf66f1cbc0a9` |
| canonical v2 22 expected | `be2e9ed29e5d754f42aa59f45c9983d54ae667b5a51263a0eb9e0774be7e2257` |

실행 증거: `replay-results.json`, `unit-tests.tap`, `old-tests.tap`, `promise-comparison.json`, `source-results.json`, `test-result.json`을 자체 evidence 폴더에 남겼다. 원래 119 및 v2 22의 입력·harness·expected·seal은 수정하지 않았다. 초기 U325 await-core 회귀는 수정 전 이력이며 이번 최종 후보의 발견으로 집계하지 않았다.

실제 API·키 파일·실제 사용자 설정·외부 네트워크를 사용하지 않았다. 합성 env/port/canary와 guarded 자체 fixture만 사용했다. 전체 suite·GUI·smoke는 이번 검증에서 실행하지 않았고 PM 제출 결과를 자체 통과 수로 세지 않았다. 모듈은 양쪽 빌드 및 공개 app/CLI 시험에서 실제 load됐다. 모든 getter 조합·모든 OS 스케줄을 망라한다는 주장은 하지 않는다. 남은 blocker 없음.
