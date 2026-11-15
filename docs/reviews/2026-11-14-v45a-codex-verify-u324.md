# V45a — U324 doctor helper/type 독립 검증

- 검증자: **codex-probe**, 정확성·비밀값 경계 검토. Windows / Node v26.13.1.
- **높음 0 / 중간 0 / 낮음 0.** 지정 통합 판에서 검사 범위의 회귀를 발견하지 못했다. 병합 판단은 PM이 한다.
- 정확한 parent: `d1a95ce24764ea3b11fc2f033adc8e19af5c5172`.
- 정확한 PM board: **`68e74aed42c0b28e675db2724c995442050a1b07`**, tree **`6a78f509bdb13ad06f5447c184e5e3d55319c7d8`**. 구현 `fc40e42f`. Git에서 board/tree를 확인했다.
- archive: `.worktrees/codex-verify/.codaryn/codex-probe-v45a-u324/`. 지정 판을 git archive로 새로 추출했다. parent 대비 변경은 새 app/doctor-checks.ts·doctor-types.ts, CLI doctor, 신규 u324 시험 **4파일**뿐이다. app.ts diff는 비어 있다.

## 실측

| 검증 | 결과 |
| --- | --- |
| 정확한 archive 루트 빌드 | 종료 **0** |
| 원래 봉인 관찰 | **91+8 = 99개**, 차이 **0** |
| 별도 E4 양성 보충 | **10쌍 / 20관찰**, 차이 **0** |
| 합계 | **119관찰 모두 동일** |
| 기존 봉인·입력 | 실행 전후 original seal 동일, 입력 **101파일 불변** |
| 관련 doctor 시험 | **68 통과 / 실패·취소·skip·todo 0**, 1,935ms |
| 위 시험 중 신규 U324 | **5/5 통과**; 기존 관련 **63/63** |
| helper 본문·내부 주석 | export·io 타입·블록 경계 EOF 제외 원문 동일 |
| CLI core / renderer | **둘 다 바이트 동일** |
| 옛 binding | 상수 3개와 inspectLockFile **4개 동일 신원/값** |
| 환경·LockState 타입 | 동일 계약 타입 정체성을 사용한 동등성·양방향 할당 검사 종료 **0** |
| 새 helper 의존 그래프 | **70개 런타임 모듈 범위**, CLI 도달 경로 **0** |

## bounded 소스·타입·비밀값 검토

- 후보 `src/app/doctor-checks.ts:19`, `:40`, `:157`, `:250`, `:271`, `:283`, `:299`: 상수, loadJson, 명령 점검, 진단 글, 필드 판정, lock 검사, worst의 원래 폐쇄를 대조했다. 원래 CLI의 constants + LoadFailure부터 worst까지를 조립하고, 새 export 및 `DoctorEnvironment → DoctorCheckEnvironment`만 되돌리면 내부 주석까지 일치한다. 분기·await·반환 내용 변경 없음.
- 후보 `src/cli/doctor.ts:257`의 **runDoctor 전체부터 EOF까지 동일**. SHA-256 `79292ecc53b153c01e6c46181ab9e3eb022059fe4c1492e5445a97a963bf5aa1`. renderer 구간도 SHA-256 `02611c5731d2d5d11d58979be939df0bdf5d4cb42be990d3ee416752f475dc6f`로 동일하다. 기존 순서와 마지막 jsonLine/renderDoctor → hideKeys가 유지된다.
- 후보 `src/cli/doctor.ts:80`·`:81`의 옛 export를 실제 import해 MODELS_HINT/MODEL_EXISTENCE_NOT_CHECKED/REQUIRED_NODE_MAJOR/inspectLockFile이 앱 원천과 같음을 확인했다. `:83`의 DoctorEnvironment는 새 포트를 상속하고 기존 argv/messages/stdoutIsTerminal을 유지한다.
- 후보 `src/app/doctor-types.ts:6`의 포트는 원래 DoctorEnvironment에서 위 표시 필드 3개를 제외한 것과 같다. LockState(`:42`), 전체 필드·optional·readonly·함수 타입, 양방향 할당과 필수 readFile/readonly cwd 거부를 컴파일 확인했다. 최초 두 archive 타입 직접 비교에서는 MessageCatalog 내부의 unique-symbol 브랜드가 서로 다른 선언으로 인식됐다. 제품 결함이 아니며, **원래 인터페이스 원문을 복사하고 변경 없는 의존 타입 정체성만 후보와 공유**한 감사 파일로 재검사했다. 원본 인터페이스를 새 구현에 맞춰 재작성하지 않았다.
- 새 helper의 런타임 정적 의존 폐쇄 **70개만** 확인했다. 여기서 CLI로 돌아가는 경로와 새 두 앱 파일의 직접 CLI import는 없다. **전체 src/app 의존 0이라는 주장은 하지 않는다.** CLI core는 아직 CLI에 있고 앱 doctor도 아직 그 래퍼를 쓴다. 실제 공개 CLI replay와 binding import가 모듈 로드를 통과했다.
- 비밀값 경계: `doctor-checks.ts:40`의 currentKey는 입력 검사 인자로만 받고 raw/parsed key 검사에 쓴다. 새 반환/환경 포트에 currentKeys나 renderer용 가림 context를 추가하지 않았다. loadJson의 value 반환은 기존 내부 config 읽기 결과이며 새 AppCallOutcome/IPC 출력으로 연결하지 않았다. app.ts·contracts·GUI는 이 판에서 바뀌지 않았다.
- 봉인 E4의 **12자 node_version은 음성 대조** 그대로다. 별도 22자 typed-id·19자 직렬화 필드 경계·30자 escaped 표시 표본도 그대로다. whole-text 가림으로 JSON이 깨지는 경우와 앱 internal_error까지 같은 결과였으며 이를 고치거나 기대값을 바꾸지 않았다.

## 독립 replay와 봉인

봉인된 세 harness를 **수정 없이** 실행했다. `C10_BOARD`만 정확한 후보 archive로 지정했다. 공개 CLI **24프로세스**(기존 20 + E4 대조/양성 4)의 stdout/stderr/exit, 공개 runDoctor·앱 doctor의 반환·check 순서·외부 포트 순서, 원래 입력 트리 효과를 기존 기대값과 대조했다. 후보 결과로 refreeze하지 않았고 정규화도 늘리지 않았다. 네트워크/DNS fence는 시도 0이었다.

- original99의 expected SHA-256: `3db5c8809a51681e9476633b7d4a73a1a1105eaabe20bb3cf8aa52837ddf89a4`, supplement `e225f7dc76ef1dc1f823b4583ea6d9935662e8b316232d13bc87b9169d97070e`.
- E4 expected SHA-256: `f5577725c283fa3f206b86a2d66d3f5c164dd1184883350169ffe4bfcfab3f23`.
- original seal SHA-256는 실행 전후 `0c638603fdf938430f552e604e31ec121bf7170d24f08c952176bf66f1cbc0a9`. seal의 fixed 7파일·입력 101파일·기준 원천 7파일 및 별도 E4 소스 hash 검사도 유지됐다.

원문은 [codex-probe-v45a-u324/replay-results.json](codex-probe-v45a-u324/replay-results.json), 소스 대조는 [source-results.json](codex-probe-v45a-u324/source-results.json), 타입 검사는 `type-audit.ts`·`audit-original-environment.ts`·`type-audit.log`·`type-audit-exit.txt`다. 기존 기대값과 입력은 원래 `codex-probe-c10-baseline-28561286/`에 그대로 있다.

## 실제 명령·시험·한계

관리용 cwd `D:/project/Codaryn`에서 다음 정확한 archive/build 명령을 실행했다.

```text
git archive --format=tar --output=D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-v45a-u324/board.tar 68e74aed42c0b28e675db2724c995442050a1b07
tar -xf D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-v45a-u324/board.tar -C D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-v45a-u324
node node_modules/typescript/bin/tsc -p .worktrees/codex-verify/.codaryn/codex-probe-v45a-u324/tsconfig.json --typeRoots D:/project/Codaryn/node_modules/@types
```

후보 archive cwd에서 `node replay.mjs`, `node source-audit.mjs`, `node D:/project/Codaryn/node_modules/typescript/bin/tsc -p tsconfig.audit.json`, `node test-runner.mjs`를 실행했다. replay의 정확한 argv/cwd/exit/stdout은 replay-results.json, node --test 인자는 test-command.json, TAP은 unit-tests.tap에 있다. 관련 파일은 app/u324-doctor-helpers 및 cli/n-wiring, n-reclaim, g-doctor-parked, g-doctor-config-source, g-sp6-doctor, g-u100-doctor-key-hint, k-report-doctor, g-doctor-q5다. 임시 폴더·recursive cleanup은 자기 archive 아래로 제한했다. teardown 차단이나 권한 요청은 없었다.

PM의 `.worktrees/pm-unit/.codaryn/codex-u324-final-evidence/report.md`도 읽었으나 전체 unit/integration·CLI95·GUI426·smoke227·비밀 검사 수치를 이번 독립 실측에 합치지 않았다. 이번에는 전체 suite·GUI·smoke를 재실행하지 않았다. 실제 provider/API·키 파일·외부 네트워크·실제 TTY·Linux 실환경은 미수행이다. 소스 및 반환 형태의 모든 가능한 상태를 증명한 것은 아니다. 제품·worker·관리용 Git 수정, 새 worktree, 새 위임은 없었다.

최종 결론: **U324 helpers/types 범위의 지정 판은 독립 검증에서 H0/M0/L0**다. 후속 doctor core와 appdirect는 각각 정확한 최종 판에서 별도 V45가 필요하다.
