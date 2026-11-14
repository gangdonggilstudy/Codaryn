# CP28 기준 판 검증 — codex-check

- 날짜: 2026-11-14. 배정: codex-review의 BASE-28(전체 시험 명시 승인).
- 판: `b129ebb80985d0c6a10fac59b3fa2d5b0e4f4003`. 실행 중 main이 이동해도 이 판을 유지했다.
- 사본: `D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-check-cp28/head`. `git archive`로 만들었으며 기존 dist는 사용하지 않았다.
- 결론: **전체 통과 아님**. typecheck·tracked secrets·root build·GUI 단위 시험은 통과했다. 전체 unit은 끝나지 않아 중단했고, integration은 실패 3·취소 1, GUI smoke는 Electron 기동 실패로 결과가 없다. 제품 회귀와 실행 환경의 영향을 이 결과만으로 분리하지 못했다.

## 실행 조건

Node `v26.13.1`, npm `11.20.0`, Windows 샌드박스 안에서 실행했다. 권한 요청·ACL 변경·전역 프로세스 조회·키 파일 조회·실제 API·외부 네트워크 호출을 하지 않았다. 제품 소스, main, 다른 worktree를 수정하거나 커밋·푸시하지 않았다. 사본의 의존성·빌드·시험 산출물과 자체 실행 스크립트만 만들었다.

실행기는 `codex-check-cp28/run-baseline.mjs`다. 부모 환경에서 PATH/PATHEXT/SYSTEMROOT/WINDIR/COMSPEC만 넘기고 TEMP/TMP/HOME/USERPROFILE/APPDATA/LOCALAPPDATA를 자기 폴더로 지정했다. LANG과 API 키 환경 변수는 넘기지 않았다. TEMP는 설치 사본 head의 **밖인 형제 폴더** `test-tmp`다. npm은 빈 user/global 설정 파일과 기존 로컬 캐시, offline/no-audit/no-fund를 사용했다.

아래 표의 npm 명령은 최초 ci를 제외하면 동일 npm의 `node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" ...`로 실행했다. 최초 자체 cmd.exe 래퍼의 인용 오류로 npm 시작 전에 exit 1이 난 시도는 `commands.json`에 보존했으며 제품 시험 실패 수에는 넣지 않았다.

## 명령과 수치

표의 시간은 실행기 벽시계이며, 시험 자체 시간은 별도로 적었다. `—`는 시험 집계 대상이 아님, `없음`은 집계되지 않았음을 뜻한다.

| 명령 / cwd | exit | 시간 | 전체 / 통과 / 실패 / 취소 / skip / todo |
|---|---:|---:|---|
| `npm ci --offline --no-audit --no-fund --userconfig <root>/empty.npmrc --globalconfig <root>/global.npmrc --logs-dir <root>/logs` / head | 0 | 약 5.5초 | 패키지 4개 설치 |
| `npm run typecheck` / head | 0 | 1.330초 | — |
| `npm run test:unit` / head | 정상 종료 없음; 실행 터미널 중단 exit 1 | 약 5분 후 중단 | 최종 집계 없음 |
| `npm run test:unit -- --test-timeout=120000` / head | 정상 종료 없음; 실행 터미널 중단 exit 1 | 약 3분 후 중단 | 최종 집계 없음 |
| `npm run test:integration -- --test-timeout=120000` / head | 1 | 225.766초 | **671 / 665 / 3 / 1 / 1 / 1** |
| `node scripts/check-secrets.mjs --tracked` / head | 0 | 44.291초 | findings 0; 추적 파일 1,311개 |
| `npm run build` / head | 0 | 2.036초 | — |
| `npm ci --offline --ignore-scripts --no-audit --no-fund` / head/gui | 0 | 1.005초 | 패키지 13개 설치 |
| `npm test` / head/gui | 0 | 47.080초 | **424 / 424 / 0 / 0 / 0 / 0**, suites 7 |
| `npm run test:smoke` / head/gui | 1 | 2.108초 | 결과 없음; Electron exit 2147483651 |

integration 시험 자체 시간은 223381.8279ms, GUI 단위 시험 자체 시간은 45782.8662ms다. CP27의 기존 수치를 이번 결과로 옮겨 적지 않았다. integration 671건은 이번 실행이 출력한 수치이며 기존 675건 전체의 통과를 뜻하지 않는다. skip은 대용량 4GiB 선택 시험, todo는 취소된 실행의 검증 요약 문제다.

tracked secrets에는 별도 `baseline.index`를 사용했다. `GIT_DIR=D:/project/Codaryn/.git`, `GIT_WORK_TREE=<root>/head`, `GIT_INDEX_FILE=<root>/baseline.index`에서 `git read-tree b129ebb80985d0c6a10fac59b3fa2d5b0e4f4003`, `git write-tree`, `git ls-files`를 실행했다(각 exit 0). tree는 기준 판과 같은 `01a2d60fbd5637369ebe248ca501802f4e0feb80`이다. main의 index는 사용하거나 변경하지 않았다.

## 실패 및 미완료 재현

1. **전체 unit 미종료**: 두 실행 모두 `tests/unit/tools/cut-output.test.ts:38`의 after 정리 지점에 대응하는 파일 단위 실패가 나온 뒤 최종 집계 없이 남았다. 자기 터미널에 Ctrl+C를 보내 중단했다. 프로세스를 열거하거나 다른 세션을 종료하지 않았다. 시간 제한을 추가해도 미종료가 해결되지 않았다.

   추가 재현: `node --test --test-reporter=tap --test-timeout=15000 --test-name-pattern="a timed-out command loses its unfinished line" dist/tests/unit/tools/cut-output.test.js`. 해당 assertion은 통과(6536.925ms)했지만 after의 `fs.rmSync`가 자기 임시 폴더에서 `EPERM, Permission denied`를 냈다(compiled `dist/tests/unit/tools/cut-output.test.js:28`). 파일 wrapper는 hookFailed이며 이 진단 실행도 종료되지 않아 자기 터미널을 중단했다. 이 결과를 제품 assertion 실패나 전체 unit 통과로 계산하지 않았다.

2. **integration 실패 3, 취소 1**:

   | 위치 | 결과 | 관찰 |
   |---|---|---|
   | `tests/integration/a08-limits-cancel.test.ts:155` | 실패 | A8 command 취소: cancelled 결과 JSON/사람용 종료 문구는 나왔으나 CLI가 60초 안에 종료하지 않아 assertion 실패(60035.2401ms). |
   | `tests/integration/a09-a10-status-provider.test.ts:62` | 취소 | A9 verifier timeout: 테스트 자체 60000ms 제한, 표시 시간 66680.9445ms. |
   | `tests/integration/p01-repair-loop.test.ts:256` | 실패 | F5-g2: budget-exhausted/max_duration 결과는 썼으나 CLI가 100초 안에 종료하지 않음(100031.1192ms). |
   | `tests/integration/p01-repair-loop.test.ts:298` | 실패 | F5-f: needs-input/verifier_inconclusive 결과는 썼으나 CLI가 110초 안에 종료하지 않음(110019.7043ms). |

   재현 명령은 위 표의 전체 integration 명령이다. 시간 제한 및 프로세스 정리 경로에 실패가 모였지만, 이 실행만으로 제품 결함이라고 확정하지 않았다. 테스트가 출력한 private-canary 탐지기 자체의 검출 수를 실제 제품 누출로 집계하지 않았다.

3. **GUI smoke 미실행**: 로컬 `D:/project/Codaryn/.worktrees/claude-gui/gui/node_modules/electron`의 버전 45.3.1을 확인하고 dist만 자기 사본의 의존성 폴더로 복사했다. 내려받기나 원본 수정은 하지 않았다. Electron은 `install_dir_access.cc:52`에서 AppContainer package SID가 있으나 ALL APPLICATION PACKAGES 허용 항목이 없는 설치 폴더 ACL을 이유로 fatal 종료했다. smoke의 메시지는 `gui smoke: no result (exit 2147483651, no error)`다. ACL 변경이나 샌드박스 해제로 우회하지 않았다. 따라서 smoke 통과 건수는 **0으로 집계한 실패 시험 수가 아니라, 결과 자체가 없음**이다.

추가 옵션 확인 실행 `node --test dist/tests/unit/cli/u296-cancel-edges.test.js --test-timeout=1000`은 exit 0, 5/5 통과, 실패/취소/skip/todo 0, 168.5637ms였다. 이는 전체 unit 집계를 대체하지 않는다.

## 근거 파일과 남은 판단

모든 경로의 `<root>`는 `D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-check-cp28`다.

- 명령·exit·시간: `commands.json`, `commands-v2.json`, `commands-v4.json`, `baseline-driver-v2.log`, `baseline-driver-v3.log`, `baseline-driver-v4.log`.
- 설치·정적 확인: `logs/npm-ci.log`, `logs/typecheck-v2.log`, `logs/secrets.log`, `logs/tracked-files.log`, `logs/index-tree.log`, `logs/root-build-v4.log`.
- unit 미완료/진단: `logs/unit-v2.log`, `logs/unit-v3.log`, `logs/cut-output-focused.tap`, `logs/timeout-option-check.log`.
- integration 집계·실패 상세: `logs/integration-v4.log`(집계 809~816행).
- GUI: `logs/gui-ci-v4.log`, `logs/gui-unit-v4.log`, `logs/gui-smoke-v4.log`.

관리자가 판단할 부분은 unit의 최종 집계 부재, integration의 프로세스 종료 실패 3건과 취소 1건, GUI smoke의 환경 제약이다. 별도 환경의 통과 결과가 있더라도 이 보고서의 실패·미완료 실행과 구분해야 한다. 이번 기준 판 검증을 전체 통과로 승인하지 않는다.
