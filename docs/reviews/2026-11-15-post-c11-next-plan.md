# Post-C11 next offline unit — read-only assessment

**권고 하나: 현재 상태 문서 4개를 CP51에 맞추는 작은 보완.** 이번 읽기 범위에서 제품 기능 결함을 확정하지 못했으므로 추측성 제품 코드를 제안하지 않는다. 구체적인 수정 문구·근거는 [inventory.md](inventory.md), 다음 배정안은 [next-unit.md](next-unit.md), 시험 범위 대조는 [coverage.md](coverage.md)에 분리했다. 계획 제출이며 새 단위 구현·C12 완료·단계5 완료 선언이 아니다.

페르소나: 수석 소프트웨어 아키텍트·검증 계획자 / codex-check. Tool worktree `D:/project/Codaryn/.worktrees/claude-store`, branch `unit/U-336-codex-check`, checkout HEAD `ef009c7adcda299d746a5566080404a6a7c16d0f` 유지. Subject는 별개인 exact main/origin **`b55ef4a32e8fd6c59c2cd0c6a77382c3b712713c`**, tree **`650455f5cb41171c8d2c7c1534ed27e46d5a560b`**다. task digest `aee8bac3b702f7ffac9bb73808c6ab1abf196dcc2085693373ca6ca446d418ac` 및 registry를 읽고 STARTED 기록 후 진행했다.

## 현재 기준과 남은 것

- 최신 AGENTS/personas/workflow/통신 절차·CP51, adapter-contract3/7.2/8, architecture 현재 overlay, roadmap/progress/구현 위치표, 결정/설계 차이 조사, standalone GUI와 testing/manual 점검을 literal target blob으로 확인했다. 52개 source/doc/test/package blob을 자기 A/evidence에 보존하고 관련 절·실제 assertion/entrypoint를 조사했다. provenance는 Git blob OID와 SHA256로 고정한다. worker checkout 파일을 현재 main 자료로 간주하지 않았다.
- b55와37fb 차이는 문서5개뿐임을 Git metadata로 확인했다(`target-relation.json`). CP51/SEC/PROBE의 C11 source roots66/reachable156/edges918(value522,type396)/CLI0/unknown0, runtime66/154/522/CLI0/unknown0, selftest30/147·독립검토는 **READ된 채택 증거**다. SEC 최초 nested-cwd 실패와 PROBE sibling 배치 해소 이력도 유지한다. 여기서 graph/selftest/fullsuite를 다시 실행하지 않았다.
- c01-cli-app-contract:178–185는 실제 CLI 프로세스↔실제 앱의 전체 결과·journal kinds/order/fields를 비교한다. 문서·정책 거부·수정 반복·모델 오류·사전 취소·deny/default·잠금·계획/적용/되돌리기까지 이미 있다. “계약시험이 없다”는 포괄 문구는 현재 사실이 아니다.
- GUI는 fake-app host/IPC 시험뿐 아니라 real app→host view/parser 검증(gsec-host-contract), 실제 별도 Node host 시험(host-process), 실제 CLI↔host 잠금/취소와 사건 표기(gsec-host-process)도 있다. source/test 경계를 읽고 이 층들을 구분했다. DR4도 실제 CLI u285와 앱 environment/u71에서 이미 검사한다. 확인 질문 기본 거부·취소는 u108/c01, GUI OS 질문·접근성·실제 TTY는 자동 대역과 수동 증거를 구분해야 한다.
- 좁은 추가 증거 후보: 같은 대본 두 복사본을 실제 CLI와 별도 GUI host 프로세스로 끝까지 실행하여 **전체 저장 result/journal**을 직접 비교하는 하나의 통합 시험은 지정 process suite 및 target symbol search에서 찾지 못했다. c01은 앱을 직접 호출하고 GUI done은 의도적으로 축약된 view다. 이는 제한된 조사 결과이며 전 저장소의 간접 동등성 부재나 제품 결함의 증명은 아니다. 기존 C32의 app-route 비교+host bridge 증거가 충분한지, 별도 직접 composition 시험이 필요한지는 PM이 요구 범위를 정할 사항이다.

## 권고 다음 단위

`DOC-POST-C11-CURRENT`는 제안 이름이며 실제 ID·branch는 PM이 준비한다. 기존 claude-store를 재사용하고 exact b55에서 새 unused `docs/post-c11-current-check`를 PM이 준비한 뒤 별도 등록한다(새 worktree/worker switch 없음).

정확 소유는 **docs/roadmap.md, docs/progress.md, docs/design/implementation-map.md, docs/decision-register.md**뿐이다. D1–D6의 현재 overlay/표시를 약90–180 added+deleted 범위로 고친다. C11 경계 완료, P1 A/B·models·확인 질문 구현, 기존 CLI↔앱 계약시험을 정확히 적고, 실제 host 직접 전체비교와 수동/배포/실 API의 잔여 범위를 구분한다. 사용자 DR65 결정 문구와 과거 CP 표·수치·실패 보고는 보존한다. architecture는 이미 CP51 historical overlay가 있어 다음 소유에서 제외했다. testing의349726a·GUI193/191 등 날짜와 SHA가 붙은 수치를 현재 실패로 취급하거나 모두 새 숫자로 덮지 않는다.

수정 전 해당 문장/근거 matrix를 고정하고 수정 후 각 문구와 실제 경로/heading/link를 대조한다. 미래 acceptance는 scoped diff/ownership·빈 index, `git diff --check`, 기존 규칙의 scope-local secret scan, 비소유/과거 표 bytes 보존, 독립 문장·근거 검토다. 가역 문서 보완에 새 제품 시험을 만들거나 성공한 전체 빌드/graph를 반복할 이유는 없다. 구체적인 before/after 문구·commands·금지 경계는 next-unit.md에 있다.

후속 선택지는 제품 확장이 아니라 coverage.md의 직접 CLI↔host 증거 composition이다. PM이 필요하다고 정할 때만 새 test2파일 약600–900줄로 제한하며 정상/정책 거부, 시작 전 오류·기록 없음, 관찰 경계에서 취소, DR4 합성 환경을 우선한다. permission의 user/default/cancelled 차이를 무차별 정규화하지 않고, 비교기의 실패 감도는 복사 관찰 한 필드만 변이해 확인한다. 기존 시험/oracle/expected/product를 바꾸어 통과시키지 않는다. 이번에는 이 대안의 코드를 작성하거나 시험을 실행하지 않았다.

## 실행·실패·한계·인계

실행한 것은 파일 통신 STARTED, 읽기 전용 Git status/branch/toplevel/HEAD/tree/diff/show/grep 및 자기 A 안에서의 Node 추출/metadata·hash/제안 문서 작성이다. 실제 제품/fixture/시험 프로그램, compiler/build/설치/graph/oracle/GUI/API/모델/네트워크는 실행하지 않았다. 테스트 통과 수를 새로 만들거나 CP51 PM fullchecks 수치를 이번 실행으로 합산하지 않았다. 보호된 fixture·oracle·frozen graph 입력과 환경형/key-like leaf 내용은 읽지 않았다(전체 tree metadata만 포함).

새 계획용 읽기 실패2건은 planning-failures.json에 구분했다: u71 파일명 추정 오류로 collector가 중단됨(두 valid blob은 그대로 보존), 첫 Git grep ERE 괄호 오류 exit128(원래 json/txt 보존). 올바른 literal metadata 경로와 별도 v2 결과로 조사했다. 제품/시험 실패가 아니며 새 blocker는 없다. 초기 Git ignore 경고도 설정/권한 변경 없이 남겼다. 원래 U336 보고·실패·ACKclosed 이력을 수정하지 않았다.

U333 u22 원인 미확정, U321 부모 교체/post-final-check hardlink 경합, historical JSON narrow-pin scope는 별도 잔여 한계다. 이번 문서 계획으로 해결을 주장하지 않는다. 실제 API·키/live model 자기 개발, GU9/DR67 installer/새 다운로드·fuses·서명/배포, 외부 메시지/새 통합/OS 지원 확대는 나중에 PM이 구체적인 사용자 범위를 다룰 사항이며 여기서 시작하거나 승인 질문하지 않는다. 실제 OS dialog/IME/접근성·TTY도 미실행이며 수동 증거 수집이 남아 있다.

생성물은 A의 추출52개 및 metadata/read-command/search 자료, inventory/coverage/next-unit/report와 checked.json/proof-hashes.json이다. 각 실제 생성 경로·해시와 subject/tree/report SHA는 두 proof 파일에 연결한다. 모든 tracked 파일·main·타WT·기존 자료는 무수정이며 시작/종료 checkout/status를 대조한다. PM만 다음 범위 채택·기존 Codex 배정·검토·커밋·push를 결정한다. Claude·타 세션 위임/Herdr/live발송/권한·한도 응답/branch 변경·stage·commit·push 없음.

모든 파일 확정 뒤 canonical READY를 stdin 없이 마지막 명령으로 기록하고 모든 명령을 정지한다. READY는 제출이며 PM의 전체 읽기·hash 확인·명시 ACK·다음 작업 OPEN과 구분한다.
