# CLI/별도 host parity 독립 검토 — PM 검토용 READY

codex-probe / 통합·privacy 비교 독립 검증 엔지니어. **신규 H0/M0/L0.** 지정된 추가 오프라인 증거 범위에서 차단 결함을 발견하지 못했다. 두 파일은 여전히 미커밋이며 채택·commit/integration/push는 PM 판단이다. **C11 COMPLETE는 유지**, 새 C12/제품 기능/전체 제품 완료를 만들지 않는다.

## 정확한 대상·역할·소유

- Assignment `cli-host-parity-probe-01`, frozen task SHA `992a37e2e522cd65c98366bd414adb450b7241937ece3f4e5d89b888219aacf6` 확인, canonical STARTED exit0. PM fixture clarification을 **fresh build 전에** 읽고 적용했다. task/기준/제품 bytes는 변경하지 않았다.
- BASE `2c202d859c7e1d3a1502eefc8b17d3d03891a0ff`, tree `f1f182f26856666feb0d9990a9827b83c9eed151` **+ 아래 두 working bytes**가 검토 대상이다. 별도 committed candidate SHA/tree가 존재한다고 주장하지 않는다.
- `gui/tests/unit/cli-host-parity-support.ts`: 328줄/23281bytes/LF, SHA `f01d30216ce653da13f1aacc452ac3197f7420416a91c110c79b50586e3f1e1a`.
- `gui/tests/unit/cli-host-parity.test.ts`: 79줄/5739bytes/LF, SHA `553c48f3e47666f77c873cf7ea0de48827b5cffc5877a1bce22b512ef71f8159`.
- tool worktree `D:/project/Codaryn/.worktrees/codex-verify`, DETACHED HEAD `4cf605a2f8bd4b3089af1052d87f51577272bdf7` 불변. 새 쓰기는 `.codaryn/session-comms/cli-host-parity-probe-01/`(**A**) 아래뿐이다. W=기존 claude-adapter와 main/원본 자료는 읽기 전용이다.
- W branch `test/cli-host-parity-loop`, HEAD2c202·tracked 변경0·index empty·해당 untracked2개뿐임을 전후 확인했다. 소유 두 파일/원래 S0·S1·plan 및 기존 source/build/dependency bytes를 변경하지 않았다.

AGENTS/personas/workflow/통신 guide는 이전에 읽은 지침과 BASE까지 Git diff0임을 확인했고 최신 CP52, 원래 작업/후속 count 작업과 보고·계획/증거를 읽었다. 기존 c01 실제 CLI↔인프로세스 app, bridge/process 시험이 이미 있음을 인정하며 이번은 별도 host의 **좁은 추가 증거**다.

## PM usage 교정의 독립 근거

고정 BASE의 일반 **handleCall**에서 requested refusal1198, effective refusal1229가 execution increment1240보다 앞이다. denied는832에서 policy_denied 결과를 낸다. 기존 n17의199–200행도 거부5회를 실행 계수에서 제외한다. 따라서 `[turns4, tools2, input4, output4, repair0]`과 **엄격한 tool_result3개/r1→wdeny→w1**이 맞다. 원래 새 PM 기대3이 잘못됐으며 제품·기존 시험/오라클을 관찰값에 맞춘 변경이 아니다.

S1 exact-delta를 직접 재구성해 **새 support tuple3→2 + 주석1줄만**, test파일은 동일함을 확인했다. 실제 새 관찰에서도 두 도구만 실행되고 journal23·tool_result3이다. wdeny의 stage=`policy_requested`, permission=`path`, code=`protected_path`, 결과 errorCode=`policy_denied`를 각각 확인했다. `source-count-handle-call-proof.json`이 이 fixture의 정확한 정적 근거다. 앞선 workflow 분기 source-count proof도 보존하되 일반 handleCall 근거로 혼동하지 않는다.

## fresh archive·의존·빌드·실제 실행

literal BASE archive를 **새 A/source**에 추출했다. Git/물리1388멤버 일치, 일반 입력은 exact raw Git blob, 두 working file copy hash 전후 일치다. 처음 root dist/gui/build가 **없었고**, 재귀 clean을 수행하는 기존 GUI build의 resolved target이 새 A/source 안임을 선확인했다. root는 기존 tsconfig/compiler로 빈 dist에 직접 빌드했다.

Archive container SHA `d0d526a77f1c1645f88d7424454fc49dbadbe20f5e6065c592fa772c0b5ca887`. `.env.example` 및 tests/fixtures/secrets.ts는 **수동 원문/leaf hash provenance에서 제외**하고 metadata만 기록했다. 다만 PM clarification대로 기존 root tsconfig가 포함하는 **합성 test fixture 소스는 compiler/tests가 읽을 수 있고 허용된다**. “어느 프로세스도 fixture를 읽지 않았다”는 주장은 하지 않는다. 실제 개발자 key/env/config·private token mapping/snapshot은 읽지 않았다. container hash는 leaf 검사와 별개다.

설치 없이 W의 허용 패키지만 add-only 복사했다: TypeScript7.0.2(416파일), native win32-x647.0.2(113), @types/node26.6.6(92), 필요한 undici-types8.9.0(48), Electron45.3.1의 **package.json/electron.d.ts 두 선언 leaf만**. 이름/버전·lock integrity metadata·containment/no symlink·모든 복사 hash와 원본 불변을 확인했다. Electron binary/install script는 복사/실행하지 않았다. actual compiler/API/native/AST/types 패키지 핀과 Node26.13.1 win32/x64 실행 지문은 `dependency-copies.json`, `verification-summary.json`에 있다. 독립 tarball/모든 공급망 attestation은 아니다.

| 독립 실제 명령 | 결과 / 기간 |
| --- | --- |
| root 기존 compiler `-p tsconfig.json` | exit0 /1435ms, fresh 출력1678 |
| 기존 GUI build 4config | exit0 /1046ms, fresh 출력378 |
| 기존 GUI check-lock | exit0 /47ms, 13개 dev packages |
| 원래 copied 새 test 단독, 1회 | **10pass/0fail/cancel/skip/TODO0**, /570ms |
| gsec-host-process + gsec-host-contract, 1회 | **5pass/0fail/cancel/skip/TODO0**, /1585ms |
| 독립 copied-observation controls | **4개 모두 의도한 거부**, 제품 실행0 |
| root c01 기존24pass | **worker 원문 READ만**, 독립 재실행 없음 |

정확 exe/argv/cwd/env/exit/signal·stdout/stderr는 `command-*.json`/대응 logs와 phase launcher raw logs에 있다. 기존 module/layout/options를 바꾸지 않았다. 새 test artifact는 요구대로 **A/source/.codaryn/session-comms/independent-observations/**에 생성했다. test의 ROOT-local containment를 바꾸거나 설치 밖 A를 직접 evidence 경로로 주지 않았다.

독립 새 test10은 실제 쌍 부모1 + copied negative8 + positive1이다. **고유 fixture1**, 원래 count-failure 쌍1·worker followup 쌍1·이번 독립 fresh 쌍1은 별도 실행이며 세 고유 시나리오가 아니다. 관련5/c01의 기존 사례를 추가 parity 시나리오로 세지 않는다. 새 build/test/related는 각각 첫 실행 성공, 반복하지 않았다.

## 소스·완전 저장물·정규화·IPC·lifecycle

두 파일 **407줄 전체**를 검토했다. 실제 Node CLI spawn와 실제 startEngineHost의 별도 Node host/engineDir·--engine-dir를 쓴다. fake app/provider/transport나 인프로세스 대체가 없다. CLI stdout 전체를 단일 JSON으로 읽고 disk result 전체와 비교하며 stderr·error/close/code/signal도 수집한다. host listener를 start call 전에 등록해 early messages를 보관하고 callback 오류를 밖에서 재확인한다. transport runToken과 실제 runId를 별도로 검증·연결하며 exactly-one done과 routing을 확인한다. 실제 완료·disk result/journal·잠금 부재·정상 host.close/exited가 barrier다.

실제 두 run 각각 **23개 LF journal**, seq/runId/first/last, 결과와 마지막 usage의 전체 일치, NOTE bytes/SHA·단일 변화·보호 marker 불변·blocked 없음·동일 초기 task/script/workspace hash·verifier 모든 필드가 보존된 전체 비교를 확인했다. known synthetic2개가 전체 persisted JSON의 **keys/strings**, CLI streams, host response/events/done에 노출되지 않는다. 실제 README 자체의 합성값은 fixture이며 비밀 미포함을 요구하지 않았다.

허용 정규화는 검증된 RUN 포인터, **journal top-level at**, 결과/마지막 record의 **두 duration**(finite/nonnegative/같은 run 안 일치), A/B label에서 독립 검증한 **발급 token2개 bijection**뿐이다. token 좌표·두 role의 injective/surjective/반복 일관성을 유지한다. 일반 time/path/hash/error/channel wildcard, sandbox-root/plan/digest 치환, journal sort/filter, unknown property나 payload omission은 없다. 독립 audit가 original↔normalized의 모든 key·property presence·array 순서·비허용 leaf를 대조했다.

받은 minimized IPC는 **동일 host의 전체 저장 result**로 별도 구성한 기대값에 연결했다. toRunResultView는 수용 검사에만 쓴다. changes path/created 순서, verifier ordinal/outcome, usage/notices/defaults, finalMessage/truncated, masking, null plan/review, protectedChanged 길이를 확인했고 taskId/provider/journalPath/evidence/changehash/private context를 IPC로 옮기지 않았다. 이 intentionally minimized view는 완전 disk 비교를 대체하지 않는다.

원래 negative8(status/error/policy/order/token merge/ordinary ISO/foreign runId/unknown property)과 positive approved nondeterminism이 실제 실행됐고 관련 진단을 확인했다. 추가4는 **nested payload ISO 값**, **음수 duration**, **local 불일치 duration**, **unknown journal field**의 복사본만 바꾸어 동일 comparator가 거부함을 확인했다. 원본/sibling JSON·raw observations/persisted hashes는 모두 불변이다. `independent-observation-proof.json`과 실제 controls/normalization receipts에 있다.

이번 parity cleanup은 **hostExited=true/cliClosed=true/errors=[]/removed=true**, 완료 후 lock 부재가 확인됐다. 같은 env의 caller copy 불변, own child handle만 닫고 PID/allprocess kill이나 임의 sleep/retry는 없다. 기존 관련 helper의 cleanup 계약을 유지하며 OS 전체 프로세스/잠금 잔존 열거 증명은 아니다. default client는 **host 내부 stderr를 버리므로 그 stream은 수집·비밀 미노출을 입증하지 못한다**. loopback-only/refused0은 OS network/syscall/socket 격리 증명이 아니다.

## 불변성·실패·한계와 인계

원래 S0 **63** + plan **72** 파일, S1 **57proof+4 envelope=61** 파일과 source/build/working/dependency pins를 직접 검증하고 전후 bytes/hash 동일을 확인했다. 최초 이름 writer 실패는 제품쌍0·신뢰할 cleanup receipt 없음, 원래 count3 실패 쌍은 별도 실패로 유지한다. S1 permission=write 요약 도구 가정 실패/실제 path 교정도 그대로다. 실패를 pass로 재표기하거나 기존 fixture/expected를 recapture하지 않았다.

자체 **준비 명령 실패3건**은 archive/build/test 전에 발생했다: before/after의 추가 unchanged metadata를 전체 equality로 비교한 오류, rawSHA를 LF hash로 해석한 오류, reused snapshot의 S0/S1 기준 경로 오류. 각 이전 script/진단·phase raw logs를 보존하고 자기 provenance 도구만 바로잡았다. 첫 stderr 전체는 파일로 포착하지 못했으며 대화 tool output/명시한 재구성 설명과 구분했다. 별도 source selector의 workflow 분기를 정확한 handleCall로 좁힌 provenance 보완도 이전 proof를 지우지 않고 추가했다. **제품/새 시험 기준/정규화/worker 파일 변경이나 시험 재실행은 없다.** 상세 `preparation-failures.md`.

정적 child allowlist/private TEMP/HOME·빈 npm config는 A/private로 설치 밖이다. host secret env/config·실제 key/API/model·외부 시험망·Electron/실제 GUI/OS dialog·fullsuite·설치·Git/stage/commit/push/new worktree·Herdr/권한/서버/UI/한도 조작 없음. 기존 U333 u22 미확정/U321 경쟁/JSON pin scope, 실제 API/model/다른 OS/realTTY/manual GUI·IME/접근성/installer·서명/배포 한계는 남는다. 이 한 fixture/경계의 추가 confidence를 보편적 제품 보안/전체 완료로 넓히지 않는다.

`checked.json`은 BASE/tree·**두 uncommitted pins**·report/proof hash와 실제 수치를 연결한다. canonical ready는 통신 envelope다. **PM은 파일을 읽고 명시 ACK 및 후속 exact candidate의 채택 여부를 판단한다. 현재 W 두 파일은 불변 STOP 상태로 남겼고, canonical ready를 마지막 명령으로 기록한 뒤 이 검토도 정지한다.**
