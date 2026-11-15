# cli-host-parity-count-fix-loop-01 — 지정 범위 검증 통과, PM 독립 검토 대기

codex-loop / 공개 관찰 계약 보존 통합검증 구현자. WT D:/project/Codaryn/.worktrees/claude-adapter, branch test/cli-host-parity-loop, HEAD/base 2c202d859c7e1d3a1502eefc8b17d3d03891a0ff, tree f1f182f26856666feb0d9990a9827b83c9eed151 유지. STARTED는 started.json에 기록했다. READY는 인계이며 PM ACK·채택·제품 전체 완료를 뜻하지 않는다.

## 수정과 근거

PM의 새 assignment(b29df7bdb1c490963d9ae3bcdb2c46d81a68bf362896f06c24f105639464d809)와 pm-count-decision.json에 따라 support의 엄격 usage 튜플만 [4,3,4,4,0]→[4,2,4,4,0]로 수정하고 근거 주석1줄을 추가했다. src/engine/index.ts:1198/1229의 거부 반환은 :1240 실행 계수 증가보다 앞이며, 기존 tests/integration/n17-private-query-assembled.test.ts:199–200도 거부5회를 계수에서 제외한다. 실행된 r1/w1은2개, wdeny를 포함한 tool_result는3개다. 제품·기존 시험·fixture·정규화·다른 기준은 변경하지 않았다. test 파일은 이전 해시와 동일하다. exact-delta.json은 이 단일 치환만 있음을 검증한다.

소유 파일은 gui/tests/unit/cli-host-parity-support.ts(328줄), cli-host-parity.test.ts(79줄), 총407줄이다. raw/LF SHA256:

- support: f01d30216ce653da13f1aacc452ac3197f7420416a91c110c79b50586e3f1e1a
- test: 553c48f3e47666f77c873cf7ea0de48827b5cffc5877a1bce22b512ef71f8159

두 파일은 untracked/uncommitted 후보다. 기존 tracked 변경0, index 비어 있음, 소유 공백 위반0, 저장소 정적 비밀 규칙0. 새 증거·도구·보고서는 이 A에만 썼고 stage/commit/push/branch 이동은 하지 않았다.

## 실제 실행 결과

| 이번 명령 | 결과 |
|---|---|
| GUI affected test config compile | 1회, exit0 |
| 새 parity 파일 단독 | tests10 pass10 fail0 cancelled0 skip0 TODO0 |
| 관련 gsec-host-process + gsec-host-contract | tests5 / suites2 / pass5 fail0 cancelled0 skip0 TODO0 |
| 기존 root c01-cli-app-contract | tests24 pass24 fail0 cancelled0 skip0 TODO0 |

새 파일 tests10은 실제 쌍을 실행하는 부모1개와 복사본 제어9개다. 고유 fixture는1개이며 원래 제출의 실제 제품 쌍1회(실패 기준 유지)와 이번 후속 쌍1회, 총2쌍이다. 최초 이름 처리 실패 시에는 제품 실행0이다. 회귀시험의 기존 시나리오들을 추가 parity 고유 사례로 세지 않는다. 이번 시험 재실행·성공 검사 반복은 없었다. 선택적 archived replay도 실행하지 않았다. 명령별 절대 executable/argv/cwd/exit와 원출력은 command-*.json/*.log, command-index.json에 있다.

이번 실제 CLI/별도 host 모두 scripted/done/verified/exit0, usage turns4/tools2/input4/output4/repair0, journal23개, tool_result3개다. 결과 callId 순서는 r1/wdeny/w1이며, 양쪽 거부는 wdeny/policy_requested/permission=path/code=protected_path, 실패 결과는 policy_denied다. test의 전체 저장물 비교가 이 필드들을 그대로 보존했고 별도 요약 도구도 기존 정책 src/policy/index.ts:251을 근거로 단계·권한을 확인했다. NOTE 내용/해시·단일 change·verifier 전체·보호 marker 불변·차단 파일 부재·privacy2값과 양수 masking 수·run/seq/완료/잠금 불변식을 통과했다.

필수 negative7(status/errorCode/policy/order/token merge/ISO-looking content/foreign runId)과 추가 unknown-field negative1은 관련 경로·불변식으로 거절됐고, 승인된 비결정성만 바꾸는 positive1은 통과했다. 원본 JSON·원시 result/journal 해시와 sibling clone 불변을 확인했다. controls.json에 각 진단이 있다. 이후 CLI/host COMPLETE 저장 result+순서 있는 journal 전체를 비교해 통과했고 normalization.json은 허용한 RUN 포인터·각 journal root at·두 duration 포인터·발급된 두 토큰만 매핑한 좌표를 보존한다. unknown 필드/배열 순서/값/존재 여부는 보존하며 경로·hash·오류·일반 ISO 문자열을 넓게 가리지 않았다.

독립 minimized IPC 검증은 동일 host 저장 result로 수작업한 기대 투영과 실제 받은 done을 비교했고, 실제 toRunResultView는 수용 검사기로만 사용했다. 변경 path/created 순서·verifier ordinal/outcome·usage·notices·finalMessage·masking·null plan/review·protectedChanged와 원시 private 필드 부재를 확인했다. ipc-receipt.json과 실제 host-observation.json에 해당 done·저장물 해시·routing/transport 증거가 있다. 이 투영이 전체 disk 비교를 대체하지 않는다.

## 불변성·빌드·실패 이력

수정 전에 원래 소스2개와 generated JS/maps4개를 pre-change에 복사했다. 원래 기록된 소스17개·build9개 해시와 의존성 핀이 일치했다. maps는 원래 SHA 기록이 없어 이번에 처음 핀했다는 한계를 명시했다. root typecheck/build·전체 GUI build·lock 성공 검사는 재실행하지 않았고 제품 build7개를 그대로 재사용했다. GUI test config만1회 컴파일했으며 사용 제품 build/기존 소스/의존성 leaf는 사후에도 동일하다. reuse-verification.json/source-build-final.json은 재사용·재생성 구분과 base Git blob/source snapshot을 보존한다. 선언·설치 lock integrity metadata 및 선택 leaf/entry 해시 검증이며 독립 tarball·전체 패키지·모든 transitive module attestation은 아니다.

원래 제출 S의63개 파일과 계획72개 파일이 전후 경로·바이트 수·SHA 모두 동일하다(frozen-before.json/frozen-after.json). S의 report/checked/ready/proof/failed-v1/관찰/cleanup/ledger는 수정하지 않았다. 원래 이름 처리 harness 실패1건과 PM 예상3 오류로 실패한 실제 쌍1건을 통과로 다시 표시하지 않았다. 최초 시도는 writer 오류 때문에 신뢰할 cleanup receipt가 없다는 제한을 그대로 유지한다. 원래 실제 쌍의 cleanup은 증명됐다.

이번 시험 실패는0이다. 별도 증거 요약 도구 finalize-v1에는 제가 permission=write라고 잘못 가정한 오류1건이 있었다. 실제 path는 기존 정책 :251과 일치한다. failed-finalize-v1.mjs와 finalize-v1-error-transcript.log(최초 tool 출력의 LF 전사이며 원래 프로세스 바이트 캡처라는 주장은 아님)를 보존했다. 소유 요약 도구만 path로 바로잡고 이미 생성된 증거는 동일 바이트인지 확인하며 완료했다. 시험·제품·정규화를 바꾸거나 시험을 반복하지 않았다. 초기 부분 source-build-after.json도 남기고 추가 정책 근거를 포함한 source-build-final.json을 새로 썼다. 수정 후 요약 명령 exit0과 출력도 보존했다. 읽기전용 Git ignore 접근 경고는 설정/권한을 바꾸지 않고 보존했다. 전체 구분은 failure-ledger.json에 있다.

## 정리와 검증 한계

이번 parity cleanup은 hostExited=true, cliClosed=true, errors=[], removed=true이며 완료 후 잠금 부재를 검증했다. 생성한 private TEMP/HOME도 해석된 절대 경로·비심볼릭 ancestry/하위를 확인한 뒤 제거했다. 기존 related/c01 helper의 cleanup 계약은 유지하며 OS 전체 자식/잠금 잔존을 독립 열거한 증명은 아니다.

모든 시험 자식은 정적 synthetic allowlist/private home으로 실행했고 host secret env/config/키를 읽거나 API·외부망·실제 GUI/OS dialog를 사용하지 않았다. c01의 기존 mock API 사례는 실제 API 검증이 아니다. host client는 내부 stderr를 버리므로 해당 stream 수집·비밀 미노출은 주장하지 않는다. scripted loopback-only/refused0은 OS/syscall/socket 격리나 모든 네트워크 시도 계측의 증거가 아니다. 정적 비밀 규칙만 소유2파일에 적용했고 canonical staged scanner는 PM 담당이다. C11 COMPLETE, 과거 U333/U321/JSON pin 및 실제 API/OS/설치기 한계를 이 단위로 해소했다는 주장은 없다.

미해결 지정 검사 실패는 없다. PM이 이 보고서/증거를 전체 읽고 명시 ACK한 뒤 다른 Codex 독립 검토와 정확 보드 판단을 진행한다. commit/integrate/push·채택은 codex-review 전권이다.

proof-hashes.json SHA256: 27d1e53bc82898cf1e24d90c9f91c8e07fdd47f3b2500eb509ef67aa31ceb085

위 index는 report/checked/index자체/생성 전 ready를 제외한 A의 모든 증거를 고정한다. checked.json은 reportSHA/indexSHA/base/tree/소유 해시/실제 검사 상태를 결합한다. canonical READY를 마지막 명령으로 기록한 뒤 모두 정지한다.
