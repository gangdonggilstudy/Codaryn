# cli-host-parity-loop-01 — BLOCKED / PM 기준 판단 필요

codex-loop, 공개 관찰 계약 보존 통합검증 구현자. 지정 WT D:/project/Codaryn/.worktrees/claude-adapter, branch test/cli-host-parity-loop, 실제 HEAD/base 2c202d859c7e1d3a1502eefc8b17d3d03891a0ff, tree f1f182f26856666feb0d9990a9827b83c9eed151 유지. STARTED는 started.json에 기록했다. 이 READY는 실패 증거의 인계이며 성공·채택·ACK가 아니다.

## 결정이 필요한 차이

실제 CLI 자식 1회와 별도 실제 engine-host 자식 1회의 단일 문서 쌍은 완료했다. 두 저장 result 모두 scripted/done/verified/exit0이고 usage는 modelTurns=4, toolCalls=2, inputTokens=4, outputTokens=4, repairAttempts=0이다(CLI duration37ms, host39ms). assignment의 toolCalls=3 단언에서 새 시험이 실패했다. 기대값3·정규화 기준·제품 코드는 변경하지 않았다.

고정 base 소스 src/engine/index.ts:1198 및 :1229는 정책 거부 시 denied로 반환하고, :1240에서만 일반 도구 실행 계수를 증가시킨다. denied의 :832는 policy_denied 결과를 만든다. 양쪽 원본에는 r1 성공, wdeny 실패(policy_denied), w1 성공의 tool_result 3개가 있지만 실제 실행 계수는2다. 이는 현재 고정 소스의 계수 위치로 설명되며 이 제출만으로 제품 결함 또는 전체 CLI/host parity 성공이라고 판정하지 않는다. criterion-mismatch.json과 source-pins/src__engine__index.ts에서 확인할 수 있다.

PM이 이 차이를 전체 읽고 사용량 기준을 명시적으로 재배정해야 이후 검증을 진행할 수 있다. 승인 전 count3→2 변경이나 반복 실행은 하지 않는다. 현재 소유 두 파일은 검증 미완료 후보다.

## 변경과 실행 결과

새 파일 gui/tests/unit/cli-host-parity-support.ts(327줄), cli-host-parity.test.ts(79줄), 총406줄만 작성했다. 실제 CLI/host 실행·전체 저장 result/JSONL 수집·좁은 정규화·독립 IPC 기대값·복사본 제어검사를 구현했으나 아래 미실행 부분을 구분한다. 기존 tracked 파일 변경0, index 비어 있음, 소유 파일 공백 검사0건, 정적 저장소 비밀 규칙0건. 소유 patch/raw·LF 해시는 owned.patch와 owned-files.json에 있다. stage/commit/push하지 않았다.

| 검사 | 실제 결과 |
|---|---|
| root typecheck, containment 확인 후 clean/build | 각각 exit0 |
| GUI 기존4config build / lock 검사 | exit0 / exit0, lock13 packages |
| 새 파일 첫 실행 parity-first | tests1 pass0 fail1 cancelled0 skip0 TODO0; 제품 실행0 |
| evidence 이름 처리 수정 후 GUI test config compile | exit0 |
| 새 파일 parity-fix1 | tests1 pass0 fail1 cancelled0 skip0 TODO0; 실제 제품 쌍1 |
| 필수 negative7 + 추가 unknown-field1 / positive1 | 실행0 / 실행0 |
| 독립 IPC 투영 / 전체 정규화 비교 | 미실행 / 미실행 |
| 관련 GUI2파일 / root c01 | 미실행(새 파일 통과 조건 미충족) |

첫 실패는 evidence 함수가 확장자 포함 이름을 요구하면서 호출자는 stem을 전달한 소유 harness 오류다. 원본을 failed-v1에 보존하고 stem 검증 후 .json을 붙이는 부분만 고쳤다. 이 최초 시도에는 같은 writer 오류로 신뢰할 cleanup receipt가 없으므로 정리 성공을 주장하지 않는다. 다음 1회에서 실제 쌍이 완료됐고 고정 usage 단언에서 멈췄다. failure-ledger.json에 두 실패와 Windows 검색 경로 오류, 읽기 전용 Git ignore 접근 경고도 보존했다. 명령별 argv/cwd/exit/raw log는 command-*.json 및 *.log, 집계는 command-summary.json에 있다. 성공 검사를 반복하지 않았다.

## 보존 증거와 한계

parity-fix1-observations/에는 초기 fixture 양쪽 해시, 전체 cli-observation.json(단일 stdout/stderr/종료값과 완전한 저장 JSON/JSONL), host-observation.json(저장물·실제 start 응답·events/done·transport), cleanup.json을 보존했다. 수집 단계에서 실제 CLI stdout 전체와 저장 result 동일, LF journal·run 디렉터리·잠금 해제, 별도 host·정확한 routing·done1회·question없음·loopback-only/refused0·두 합성값 미노출·fixture/보호 marker 불변·NOTE 실제 바이트·금지 파일 부재 검사를 수행했다. 원본은 이후 수정하지 않았다. 후속 로컬 의미 단언은 usage에서 중단되었으므로 나머지 단언이나 전체 정규화/IPC 독립 검사를 통과했다고 주장하지 않는다. 정규화 및 controls receipt 대신 execution-status.json에 미실행 상태를 기록했다.

성공한 실제 쌍의 cleanup.json은 hostExited=true, cliClosed=true, errors=[], removed=true다. 소유 빌드용 private TEMP도 해석된 절대 경로/비심볼릭 ancestry·하위 항목을 확인하고 삭제했으며 build-environment-cleanup.json에 기록했다. 전역 PID 종료나 설정 변경은 없다.

TypeScript7.0.2/@types-node26.6.6/electron45.3.1의 manifest·선언/설치 lock integrity metadata 및 지정 leaf bytes를 사전 확인했고 동일 leaf 해시를 사후 확인했다. 독립 tarball/패키지 전체 무결성 증명이 아니다. source-build-provenance.json은 고정 base Git blob/LF 일치와 원본 소스 snapshot, 사용 build entry SHA를 보존한다. 전체 transitive build 재현성 증명은 아니다. 정적 scanner는 원본 저장소 RULES/금지 경로만 새2파일에 적용했으며 host secret env를 읽는 canonical staged scanner는 실행하지 않았다(PM 담당).

실제 client는 host 내부 stderr를 버리므로 해당 stream을 수집·검증했다고 주장하지 않는다. scripted loopback-only 경로는 OS/syscall/socket 보안 격리 증명이 아니다. 실제 API·키·host secret env/config·외부망·GUI/OS dialog는 사용하지 않았다. C11 COMPLETE 상태나 기존 U333/U321/JSON 역사적 pin, 실제 API/OS/설치기 한계를 새로 해소했다는 주장은 없다. PM fullread/독립검토/정확 보드 판단과 commit/integrate/push는 codex-review 전권이다.

## 인계 해시

proof-hashes.json SHA256: 7a05570f46866a775a06c95625c4d4c41e93464b23cbf756433591427e5e79cd

이 proof index가 report/checked/index자체/아직 생성 전 ready를 제외한 현 증거를 고정한다. checked.json은 reportSHA·indexSHA·base/tree·소유 raw/LF 해시·실행/미실행 상태를 결합한다. 준비된 고정 보고서를 canonical ready로 전달한 뒤 모든 명령을 중단한다.
