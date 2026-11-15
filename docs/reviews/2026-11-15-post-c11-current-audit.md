# DOC-POST-C11-CURRENT 독립 문서 감사

결론: **신규 H0 / M0 / L0**, 사실 오류 발견 0. 네 파일의 현재 상태 보완은 CP51 및 literal b55 소스·시험의 범위를 정확히 구분한다. 채택·커밋·통합·push는 아직 PM 판단 사항이다. READY는 채택이 아니다.

담당은 독립 문서·아키텍처 증거 검토자 codex-audit다. 도구 worktree는 `D:/project/Codaryn/.worktrees/codex-verify`, detached HEAD `4cf605a2f8bd4b3089af1052d87f51577272bdf7`이다. 등록 task SHA256은 `3eea1ba4d6a1adb0f96b75a87099fcab9782e26ed0834e1e53dd3a81cdf6d144`. canonical STARTED를 먼저 기록했다. 쓰기는 이 job A 내부의 사본·검사·보고에만 한정했다.

## 정확한 대상과 바이트 증거

검토 대상은 BASE `b55ef4a32e8fd6c59c2cd0c6a77382c3b712713c`, tree `650455f5cb41171c8d2c7c1534ed27e46d5a560b` **및 아래 미커밋 working bytes**다. 새 committed candidate가 있다는 뜻이 아니다. W는 `claude-store`, branch `docs/post-c11-current-check`, HEAD b55다. 실제 tracked diff는 정확히 네 경로 +52/-4=56줄이며 index는 비어 있고 다른 tracked 변경은 없다.

| 파일 | bytes | raw SHA256 | Git LF SHA256 |
| --- | ---: | --- | --- |
| docs/roadmap.md | 22990 | f10210b13f8337e4ff3c652ecb82653df2cc390c568c2e888033aa0382a03e96 | raw와 같음 |
| docs/progress.md | 18126 | b63e9b49917f9bcac120efb0b97276064b23a77de39ee1169e7c29358792a1f9 | raw와 같음 |
| docs/design/implementation-map.md | 14385 | fa0867371296cdb0323009d0ffb1a458075d0c31b0351f8c4386360e98e0b1f1 | 991d85cbf91385ff135d24e98847787cb3404811f775ec8460356e1379fe305d |
| docs/decision-register.md | 97706 | 693701f1a873781995d6ff0881d3e89ae7eb8bff9a8672221be17315d1836cbb | 81cd262fa931f9ae5311f9e79f3c95fd3c9651c2636fb960dd7781339d5ad5f2 |

독립 Git diff와 S/changes.patch는 전체 bytes 동일하다. patch SHA256 `3f95eac7a9b5fd84e0cb87b92879f3154ae6145abf41dc3c14556a9fdae7570c`.

- S 보고 SHA `60dfcd18e17bdf5df0b884a6269a14c09b69506269192ffe361b09ca82ce72fa`, proof manifest SHA `2f0b56a495bfb7570398542e887ce1b4a7247a879de689dab0c4be86c9a7fd87`를 실제 bytes로 확인했다. manifest의 49개 모두 hash/bytes 일치, manifest·checked·READY를 포함한 52개 지문을 전후 비교했다.
- P 보고 SHA `ce82a236bb018b89039d3f67e84b7102869cb4ca94b190340ecb9934d26f2873`. 기존 계획 manifest 84개 및 manifest·checked·READY 합계 87개도 같은 방식으로 전후 비교했다. P의 literal b55 source provenance 52개를 각각 다시 Git blob/SHA256/bytes로 확인했다.
- 원래 네 Git blob을 literal b55에서 독립 추출하여 S/before/git와 raw bytes 일치, S/before/work의 LF 정규화와 일치함을 확인했다. LF 원본과 CRLF 작업 원본은 별개로 보존했다.
- A 사본에서만 선언한 삽입 3개·역사 표시 교체 3개·DR65 상태 cell 교체 1개를 역변환하여 **원래 before/work 전체 raw bytes**를 재현했다. 정방향 재적용도 현재 전체 raw bytes와 일치했다. 현재 파일 전체가 옛 파일과 같다는 주장은 하지 않는다.
- 원래 표의 행·순서·raw 줄, progress의 `## 작업 현황` 이하 CP 구간, DR65 USER 결정 문구와 나머지 cell, DR67 및 DR65 실제 행 외 decision-register 전체 bytes를 별도 대조했다. 이전 DR65 상태는 날짜를 붙인 현재 cell 안에 그대로 남는다.

주요 기계 증거: `independent-v4/audit-result.json`, `preservation.json`, `new-links.json`, `independent-links.json`, `independent-secret-scan.json`, `commands.json`; `source-review/provenance.json`, `full-check-input-relation.json`; `additional-source/proof.json`. 최종 `checked.json`과 `proof-hashes.json`이 이 자료를 연결한다.

## 문장·근거 검토 D1–D6

| 항목 | 확인한 변경과 실제 근거 | 판정 |
| --- | --- | --- |
| D1 roadmap CLI 이행/계약 | 날짜 CP51 overlay가 C11 지정 모델 완료를 표시한다. c01의 viaCli/viaApp와 assertSameRun(116–185행)은 실제 CLI 프로세스와 **인프로세스 앱**의 결과 및 journal 종류·순서·정규화된 전체 필드를 비교한다. gsec-host-contract의 실제 app→view/parser 검사와 gsec-host-process의 별도 실제 host/CLI 잠금·취소·사건 검사를 구분한다. | 일치 |
| D2 roadmap P1 A/B | Markdown은 literal b55 src/verify/markdown.ts 및 u116-markdown.test.ts의 heading/link held/not_held assertion으로 확인했다. A는 query-table 및 n17의 query_table/unreadablePaths·k/허용값·비공개값 assertion, B는 c01의 run 계획 정상 수행·낡음·계획 밖 쓰기 거부(612–675행 등)와 architecture의 현재 구현 설명/DR69·70에 연결된다. | 일치 |
| D3 roadmap 확인 질문 | u108-confirm-relay의 allow_once/user, deny/user, observer 없음·비정상 응답→deny/default, 취소→deny/cancelled 및 c01의 비TTY 기본 거부 assertion을 확인했다. GUI 질문 시험의 대역과 manual-checks의 실제 OS/TTY 미검증을 구분한다. | 일치 |
| D4 progress | CP51 기준·기존 시험 수·현재 구현·한계를 보완하고 과거 3aca6b5 요약/CP 표를 이력으로 명시한다. 4328=4317pass+10skip+1TODO, integration684=682pass+1skip+1TODO, fail0, GUI426/smoke227/CLI95차이0은 기존 PM 결과의 READ이며 새 실행이 아니다. | 일치 |
| D5 implementation-map | app/models-command의 runModelsIn을 CLI models 및 app.ts가 실제 공유한다. y01의 목록·선택·키 없음/요청0 assertion과 모의 API 경계를 확인했다. CLI run/app가 run-life/assembly를 공유하고, report-read와 presentation/json/report가 역할을 나눈다. 공개 report renderer 회귀의 정확 Markdown·예외 identity·상태 정리 assertion을 읽었다. app/init-command와 doctor를 CLI/app가 쓰되 질문·사람용 표시는 adapter에 남는다. 349726a 원본 표/684·343은 당시 수치로 보존한다. | 일치 |
| D6 DR65 | 실제 USER 결정 행의 상태 cell만 현재 CP51 및 지정 AST/native resolver 범위로 보완한다. 사용자 결정 문구·옛 상태·다른 모든 행 및 DR67을 보존한다. 모든 parser/질문/출력 이동이나 단계5 전체 완료라고 쓰지 않는다. | 일치 |

새 링크는 **30 occurrence**다. 독립 unified diff의 물리 추가 줄에는 33개가 있으며, DR65 교체 줄에 재포함된 기존 링크 3개를 뺀 신규 링크가 30개다. 모든 target을 b55 blob으로 확인했고 worker 링크 목록과 순서에 무관한 occurrence multiset이 같다. CP51 heading, adapter 3절·7.2절, decision-register 17절의 heading 4개와 실제 `t17` anchor를 확인했다. 파일 존재만으로 시험 의미를 인정하지 않고 위 assertion과 호출 경계를 읽었다.

실제 CLI와 별도 GUI host가 같은 대본의 **전체 저장 result/journal을 직접 비교하는 하나의 새 실행 증거**를 이 문서 작업이 만들었다고 해석하지 않는다. c01은 실제 app을 같은 프로세스에서 호출하며, GUI host의 done은 축약된 view다. 기존 bridge 및 process 시험은 존재한다. 별도 직접 composition은 PM이 필요 범위를 정할 후속 선택이며 새 필수 gate/제품 결함으로 만들지 않는다.

## 최신 CP51·이력·한계

최신 CP51과 tracked SEC/PROBE 원문을 읽었다. U327~U336 10/10 구현 및 C11 지정 모델 완료가 현재 판정이다. source union roots66/reachable156/edges918(value522/type396), runtime66/154/522, 두 모델 CLI0/unknown0/native exit0을 **기존 증거 READ**로 확인했다. SEC 최초 nested-cwd selftest 2688/unknown1/exit1·완료0/30·입력4(3동일/1config차이)·143미생성을 보존한다. 별도 허용 sibling 배치의 PROBE 원본 selftest30/147 동일 및 H0/M0/L0·배치 M1 해소와 구분한다. 일반 cwd 의존 자체를 고쳤다고 하지 않는다.

기존 fullchecked `881533de4b66d9ab3e1497cf22c7043c7b398504`에서 b55까지 실제 Git 변경은 docs 6개뿐이다(`source-review/full-check-input-relation.json`). 제품·빌드·시험 입력은 같다. CP51의 881533→37fb 문서2개 설명과 이후 CP51 문서 연결을 합쳐 b55에서도 동일 입력임을 확인한 것이다. 이 job은 시험·build·graph·selftest를 실행하지 않았다.

3aca6b5/76c5280/349726a 기록·과거 표·수치·실패는 삭제하거나 현재 수치로 덮지 않는다. C11 완료는 모든 CLI parser/질문/출력 이전, 단계5/제품 전체, 실제 API/모델 자기 개발, 다른 OS/실제 TTY/OS 대화상자/IME/접근성/설치·서명·배포 완료가 아니다. GU9/DR67 미승인 경계, U333 최초 u22 원인 미확정, U321 부모 교체/post-final-check hard-link 경합, historical JSON narrow-pin scope를 그대로 남긴다. AST 모델 결과를 reflection/custom-loader/OS·경합의 보편적 보증으로 확대하지 않는다.

## 실제 검사·실패와 제출 경계

독립 `git diff --check` exit0. 52개 추가 줄과 변경 경로4개만 기존 **7 RULES/4 forbidden-path 조건**의 정적 literal로 검사하여 0건이다. worker scanner의 CRLF literal 지문과 base Git LF source의 정규화 동일성을 구분해 확인했다. LIVE_ENV 조회는 실행하지 않았고 Git 자식에는 정적으로 구성한 환경을 사용했다. host 키/환경·설정·민감 leaf를 읽지 않았다. PM canonical staged scan은 나중 일이며 stage하지 않았다.

worker helper 실패 4건은 그대로 남는다: 첫 inline/prepare SyntaxError 2건은 쓰기 전이며 원래 raw stderr는 session tool 출력에만 존재한다. 잘못 고른 DR65 index 행 assertion은 tracked 쓰기 전, 잘못된 status-cell 동등성 assertion은 문서 bytes 불변 상태에서 발생했다. S failure-ledger와 원래 failed script/로그를 보존·지문 확인했다. P의 계획 helper 실패2도 보존했다. 이들을 첫 시도 성공이나 제품 시험 실패로 바꾸지 않는다.

감사자 자신의 검사 helper도 첫 시도 성공이 아니다. `audit.mjs` exit1은 물리 추가 줄 링크33을 신규30으로 가정한 검사 오류, `audit-v2.mjs` exit1은 Git 경로 정렬과 worker 목록 순서를 같다고 가정한 오류, `audit-v3.mjs` exit1은 LF/CRLF 정적 literal hash 차이를 구분하지 않은 오류였다. 각각 A의 코드·중간 증거 및 v2/v3 로그를 보존했다(v1 native stderr는 session tool 출력). 신규/재포함 occurrence 구분·multiset 비교·raw literal과 LF source 동일성 분리 후 `audit-v4.mjs` exit0, 내부 read-only Git 39명령 모두 exit0이다. `source-review.mjs` exit0(52blob 및 문서-only 관계), `additional-source-review.mjs` exit0(추가5blob·heading4)을 확인했다. 읽기 과정의 잘못 추정한 verify-commands-v2.mjs 경로 조회 실패1과 src/verifiers 경로의 미발견 검색도 제품 실패가 아니며 session tool 출력에 남는다. 일부 제한 출력/파이프의 exit1은 성공한 제품 검사 수로 합산하지 않는다.

전체 기준/제품/worker 작업 파일·index·HEAD·기존 보고/증거/원본은 수정하지 않았다. 실제 API·live·Herdr·GUI·네트워크·권한/한도 응답·서버 변경·새 worktree·커밋·push는 하지 않았다. 파일 통신은 canonical STARTED→완성 report/checked/proof→canonical READY 순서다. 최종 전후 지문/checkout 검사를 `checked.json`에 기록한 뒤 READY를 마지막 명령으로 실행하고 정지한다. PM은 본문·해시·working pins를 회수해 명시 ACK하고, 필요 staged 검사·작성자 확인·문서-only 통합과 원격 push를 수행한다.
