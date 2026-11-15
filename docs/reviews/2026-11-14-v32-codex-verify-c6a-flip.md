# V-32 — U-296 / C-6a CLI flip 읽기 전용 검증

- 담당: codex-check / 보안·개인정보 검토자 + 검증 엔지니어.
- 대상: pm/unit-C6g = fa65290d03e015270895635e163de46dfe45940f. git rev-parse로 일치 확인.
- 기준: f503fffb. 지정 src diff는 3파일, +186/-77: cli/run.ts, cli/progress.ts, cli/cancel.ts.
- **높음 0 / 중간 0 / 낮음 0.** 검증 범위에서 새 결함을 재현하지 못했다. V-31 L-1의 두 경계는 닫혔다.
- archive·스크립트·로그: D:/project/Codaryn/.worktrees/codex-verify/.codaryn/v32/codex-check-1794603634091. head/base는 각 지정 판의 git archive 사본이다.

## 출력·저장 결과 비교

실제 node dist/src/cli/main.js를 base/head 각각 실행했다. **35 비교 사례, 양쪽 합계 CLI 172회, 차이 0**. 증거 JSON 70개에 stdout/stderr/exit 및 생성 파일을 보관했다. result.json 92개, journal.jsonl 92개(각 46쌍)를 포함한다. 네트워크 차단 로그 0.

동일성은 기존 scripts/compare-cli/normalize.mjs로 실행 ID, 시각·소요시간, 난수 마스킹 토큰, 계획 digest, 시험/빌드 경로, 로컬 API 포트·잠금 PID를 정규화한 뒤 텍스트를 비교한 결과다. 정규화 전 파일 전체가 바이트 동일하다는 뜻은 아니다. 그 밖의 값·문장·키 순서·기록 순서는 비교 대상이다.

| 사례 | 결과 |
|---|---|
| 정상 문서 run, 쓰기 거부, 등록 비밀값 읽기 | stdout/stderr/exit/result/journal 일치. 거부 및 정상 run은 한·영 포함. |
| 권한 확인이 필요한 명령, 터미널 없음 | 한·영 일치. 기본 거부와 사람용 설명·기록 순서 유지. 터미널 모의 승인/거부 및 Ctrl+C 사례도 일치. |
| 시작 전 cancel file | 한·영 cancelled/cancelled, exit 5; 저장 결과·기록 일치. |
| 실행 중 cancel file | 첫 쓰기 뒤 두 번째 model_request를 확인하고 파일 생성. 한·영 일치; 이미 쓴 made.txt 유지, 잠금 해제. |
| SIGINT | CLI 내부 preload가 두 번째 model_request 뒤 process.emit("SIGINT") 실행. 한·영 일치, 취소 및 잠금 해제. 실제 OS 콘솔 신호 전달은 미검증. |
| model-not-found | 127.0.0.1 합성 HTTP 404 서버. 한·영 동일한 종료·notice·진행 글. |
| 다른 프로세스가 가진 잠금 | assembly-guards 및 locked-ko의 살아 있는 시험 부모 PID로 거부. 한·영 출력 동일. 전역 프로세스 조회 없음. |
| 닫힌 단어 안의 등록 값 | not_writable, before_verify 합성 등록값. 한·영 거부 코드의 표시, 접힌 검사 횟수, 요약·JSON·journal 동일. |
| unreadablePaths + analyze-private | 한·영 실행·거부·query_table·요약·저장 기록 동일. |
| 기본 설정 위치·writablePaths 안내·끝 요약 | 관련 한·영 사례에서 순서와 텍스트 동일. |
| DR-4 vars file | 한·영에서 짧은 LANG은 자식 verifier에 전달, 8자 이상 합성값은 전달되지 않음. 두 판 모두 done/verified, 출력·저장 결과 동일. |
| 두 종류의 apply | 이동 계획과 승인된 run plan의 정상 적용 일치. 각 한·영에서 시작 전 취소는 exit 5, 뒤의 정상 재적용은 done/verified, exit 0; 기록·결과 일치. |

기본 23사례는 compare-v32.mjs / compare-results.json / compare-report.md, 취소·신호·DR-4 추가 8사례는 extra-v32.mjs / extra-results.json, apply 추가 4사례는 apply-v32.mjs / apply-results.json. 원자료는 evidence/, 집계는 metrics.json이다.

## 마스킹·관찰자·수명 확인

근거:
- src/cli/run.ts:353은 주입된 io를 runLife에 직접 넘긴다. app.startRun으로 다시 환경을 만들지 않는다.
- src/cli/run.ts:309의 mask는 gateway 실패·예외를 null로 바꾸고, :323의 저장 콜백은 src/cli/progress.ts:175에서 줄 전체를 마스킹한 뒤 :178에서 쓴다.
- src/app/events.ts:99는 저장 기록을 복제해 전달하고 관찰자 예외를 삼킨다. :116의 저장 콜백은 :118의 이벤트 재마스킹과 별개다.
- src/cli/run.ts:361/:365의 404·writable 안내는 writeMasked, :376의 요약은 writeHuman(:234)을 거친다. 기본 위치 안내도 같은 gateway를 사용한다.
- src/app/assembly.ts:197의 finish는 결과 저장과 잠금 해제를 담당하며 gateway를 폐기하지 않는다. CLI는 그 gateway 참조를 유지한다.

boundaries-v32.mjs에서 실제 assembly와 journal을 사용해 다음 7개 실행 경계를 확인했다. 각 실행은 기록 11개, 실행 후 잠금 잔류 0, 사람용 출력의 등록 합성 비밀값 원문 노출 0이었다.

1. 저장 기록의 한 문자열을 이벤트로 재마스킹할 때 실패하도록 주입: sanitizeRecord가 null인 기록도 저장 콜백에서 그릴 수 있으나, 그려진 줄의 합성 비밀값은 토큰으로 바뀐다.
2. renderer가 비밀값을 포함한 예외를 throw: 해당 진행 글을 버리고 정상 종료.
3. 진행 줄 마스킹이 throw: 해당 줄을 버리고 정상 종료.
4. 기본 위치 안내의 mask가 throw하여 onStoredRecord 콜백 밖으로 예외가 나감: deliverStored가 격리, 정상 종료, 원문 출력 없음.
5. 출력 writer가 throw: 실행·기록·잠금 해제 유지. writer에 도달한 문자열도 이미 마스킹된 상태.
6. finish 뒤 gateway가 마스킹 불가를 반환하도록 주입: 뒤의 writable 안내와 요약을 출력하지 않음. 원문으로 대체하지 않음.
7. 정상 finish 뒤의 안내·요약: 계속 마스킹되어 출력됨. 마지막 출력은 실제 잠금 해제 뒤임을 함께 확인.

이 경계 시험은 주입된 오류를 포함한다. 실제 기본 gateway가 종료 시 폐기된다는 관측은 아니다. 기본 경로에는 그런 폐기 동작이 없다.

## 잠금·취소 소스와 V-31 L-1 재확인

- src/app/assembly.ts:124에서 동일한 acquireLock, :203에서 동일한 releaseLock을 쓴다. 정상 종료·실행 중 취소·SIGINT 이벤트·DR-4의 16개 추가 CLI 실행에서 잠금 존재를 관측했고 종료 후 잔류는 0이었다. U-220 관련 시험은 잠금 해제 실패가 원래 결과를 바꾸지 않고 요약에 남는 경우도 통과했다.
- src/app/assembly.ts:139는 parentEnv 훅이 없으면 기존 process.env 경로를 유지한다. CLI main의 assembleRun 주입을 runThroughApp이 그대로 호출한다.
- src/cli/cancel.ts:13은 앱 취소 소스를 그대로 재수출한다. src/cli/main.ts:281은 이동 계획 apply, :410은 일반 run 및 run plan 실행 환경에서 그 소스를 쓴다.
- src/cli/run.ts:395는 approved가 없는 경우만 새 수명으로 보낸다. 승인된 run plan의 실행·진행 출력은 기존 runPrepared/withProgress 경로에 남아 있다.

실제 process.on/off에 합성 예외를 주입한 재현:

| V-31 경계 | base | head |
|---|---|---|
| SIGINT 등록 뒤 SIGTERM 등록이 throw | SIGINT 1개 잔류, 예외 전달 | 잔류 0, 원래 예외 전달 |
| SIGINT 제거 뒤 첫 remover가 throw | SIGTERM 1개 잔류, dispose throw | 잔류 0, dispose 정상 반환 |

시험이 만든 base의 잔류 리스너는 같은 시험이 제거했다. head의 수정 위치는 src/app/cancel.ts:49/:51의 부분 등록 정리와 :34/:70의 remover별 독립 정리다. SIGINT·SIGTERM 취소와 반복 dispose도 확인했다. 이는 remover 호출을 보장한다는 뜻이며, 외부 remover가 실제 제거 자체를 하지 않는 임의 구현까지 대신 고친다는 뜻은 아니다.

## 명령·시험 수치

저장소에서 실행:
~~~text
git status --short
git branch --show-current
git rev-parse --show-toplevel
git rev-parse pm/unit-C6g
git diff f503fffb fa65290d03e015270895635e163de46dfe45940f -- src
git archive --format=tar --output=<v32 사본 부모>/head.tar fa65290d03e015270895635e163de46dfe45940f
git archive --format=tar --output=<v32 사본 부모>/base.tar f503fffb
tar -xf <각 archive> -C <각 새 사본>
~~~
main, D:/project/Codaryn, 추적 파일 변경 없음. 전역 git ignore 권한 경고는 우회하지 않았다.

각 사본에서:
~~~text
node D:/project/Codaryn/node_modules/typescript/bin/tsc -p tsconfig.json --pretty false
~~~
base/head 모두 종료 0, 진단 0. 로컬 기존 의존성만 사용했다.

head 관련 시험:
~~~text
node --test --test-timeout=60000 dist/tests/unit/cli/u296-cancel-edges.test.js dist/tests/unit/cli/human/u291-stored-record-lines.test.js dist/tests/unit/cli/u291-real-cli-pins.test.js dist/tests/unit/cli/u285-dr4-cli-path.test.js dist/tests/unit/cli/n-wiring.test.js dist/tests/unit/app/u293-run-life.test.js dist/tests/unit/app/u293-v31-signal-edges.test.js dist/tests/unit/contracts/g-u292-stored-record-channel.test.js dist/tests/unit/cli/u220-lock-left-cli.test.js
~~~
첫 묶음 **52시험 / 성공 51 / 실패 1**, 3681.2244 ms. 실패는 u285 짧은 LANG 사례였다. 기준 판의 해당 파일도 **3시험 / 성공 2 / 실패 1**로 동일했다.

시험 부모 환경에 LANG이 이미 설정된 사실만 확인했다(값 출력 없음). 그 변수만 해당 시험 프로세스에서 제거한 뒤 아래 파일을 다시 실행:
~~~text
node --test --test-timeout=30000 dist/tests/unit/cli/u285-dr4-cli-path.test.js
~~~
**base 3/3 성공(737.9859 ms), head 3/3 성공(753.8202 ms)**. vars-file 로딩이 기존 환경값을 덮지 않는 조건과 시험 전제가 충돌한 것으로, 이번 변경의 회귀로 세지 않았다. 별도 extra-v32의 최소 환경에서도 짧은 값 전달/긴 값 제거를 양쪽 판·양 언어로 확인했다. 로그: targeted-tests.log, base-dr4.log, base-dr4-clean.log, head-dr4-clean.log.

사본 부모에서:
~~~text
node compare-v32.mjs
node extra-v32.mjs
node apply-v32.mjs
node --test --test-timeout=30000 boundaries-v32.mjs
node metrics-v32.mjs
~~~
비교 **23 + 8 + 4 = 35사례, 차이 0**. 독립 경계 **9시험 / 성공 9 / 실패 0**, 265.1631 ms. 자체 하네스의 오류 주입 조건은 실제 진행 접두사와 기본 위치 안내에 맞춰 수정한 뒤 최종 9개 모두 주입·관측을 assert했다. 제품 소스 수정은 없다. 관련 유닛·경계 시험 및 extra-v32 자식의 TEMP/TMP는 이 v32 사본 부모의 test-tmp로 지정했다.

미실행: 실제 OS SIGINT/콘솔·PTY, 전체 시험 묶음, 대량 이동 apply 도중 취소. apply는 정상·시작 전 취소·재적용 및 공유 취소 소스 경계를 확인한 범위다. 터미널 사례는 기존 preload의 isTTY 모의다. 실제 API·실제 키 조회·외부 네트워크·권한 요청·전역 프로세스 조회·저장소 파일 수정·커밋·푸시·worktree 추가는 하지 않았다.
