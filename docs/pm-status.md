# PM 상태

현재 운영자: 2026-11-27 사용자 임시 위임(CP-73)의 codex-worker(w3:pJ). canonical main pm-control.json의 pm-20261127-codex-01·active·owner_pane=w3:pJ를 기준으로 한다. 작업자는 Codex인 codex-worker-2(w3:pK)만 쓰며 claude-worker(w3:pH)에게 새 일을 주지 않는다. 아래 Claude 위임과 이전 세션 표는 당시 이력이며, 현재 운영은 [2026-11-27 인계](operations/pm-handoff-2026-11-27.md)를 따른다.

PM 인계와 작업 묶음의 체크포인트다. 2026-11-14 사용자 지시로 codex-review(w3:p3)가 PM과 통합을 회수했다. 아래 임시 위임 기록과 active 조건은 Claude 임시 PM에게 적용되며, 회수 후 Codex의 원래 관리 권한을 중단시키지 않는다. 작업별 상세는 [개발 진행 현황](progress.md), 배분과 PM 결정은 [단계 1a 작업 배분](work-orders/phase-1a-assignments.md)에 둔다.

## 위임

- 위임 ID: pm-20261112-01. 기준 파일은 main의 `docs/pm-control.json`이다.
- 임시 PM: w3:p1 (session 35d190ab-f250-4f81-bf71-df394b34110a), 페르소나는 개발 PM 겸 수석 소프트웨어 아키텍트. Herdr 사용자 화면에서는 "오케스트레이터"라고 부른다.
- 인수: 2026-11-12 완료(`789733f`, 당시 w1:p3). 같은 날 사용자가 새 Herdr 세션(w3)의 w3:p1에 오케스트레이터를 맡겼다(CP-12). 위임 ID와 범위는 그대로다.
- 작업 배분, 변경 묶음, 커밋, 병합, 푸시 전에 status와 ID를 확인한다. active가 아니거나 ID가 다르면 새 배분과 변경을 멈추고 이 문서의 마지막 체크포인트를 보고한다.
- 실제 API 호출, 키 파일 조회, 모델 변경, force push, 기존 이력 재작성은 하지 않는다.

## 체크포인트 기록

| 번호 | 시점 | 내용 | main 커밋 | push |
| --- | --- | --- | --- | --- |
| CP-1 | 인수 | 위임 확인, 이 문서 생성 | `789733f` | 완료 |
| CP-2 | G2 | 기반 커밋 `cba57fa` 검토·병합, 작업자 worktree와 브랜치 준비, 배분 문서 작성 | `cc29b50`, `35b5102` | 완료 |
| CP-3 | 배분 | 여섯 작업(B1, B2, B3, C1, C2, D)을 Herdr로 전달. 검증 체계와 비밀 검사 스크립트·커밋 전 훅 추가 | 이 문서를 담은 커밋 | 완료 |
| CP-4 | G3a | B2 `9496d14`, B3 `d3e6350` `6d35746`, C1 `ec4aa5f`, C2 `ae27dc1` `063605d` `bca12d3`을 검토·병합. main 유닛 108건 통과. D의 통합 테스트 `8b40f46` `7942bfd` 병합(아직 실행 전). B1 조립과 교차 검토 지시 | `7b39c96`과 이 문서를 담은 커밋 | 완료 |
| CP-5 | G3b와 교차 검토 | B1 조립 `e8b5bd2` 병합(`58dcfde`). 첫 통합 실행에서 13건 실패, 원인은 거부된 호출의 `tool_result` 미기록. 엔진 수정 `5333feb` 병합(`3982a6c`) 뒤 유닛 157건, 통합 63건 통과. 교차 검토 보고 3건을 `docs/reviews/`에 기록(`e70b827`)하고 결함 수정과 회귀 테스트를 배정 | `3982a6c`, `e70b827`과 이 문서를 담은 커밋 | 완료 |
| CP-6 | G4 | 교차 검토 수정 `7a74c2c`(privacy), `df1ceff`(tools), `7eca0c0`(workspace), `54e59fd` `2323ad6` `2b5167c`(engine, 계약 문서), 회귀 통합 테스트 `db1e043` 병합. main `db1c55c`에서 유닛 189건, 통합 76건 통과. 수용 기준 A1~A12 대조 후 1a 오프라인 검증을 채택 | `db1c55c`와 이 문서를 담은 커밋 | 완료 |
| CP-7 | 설정과 제공자 | 사용자 직접 지시("설정 가능하게 해")에 따라 설정 계약 `86f3d62`, CLI 설정 처리 `7a2d02d`, Anthropic 제공자 `a5f62e7`, 조립 `7359cef`, 가짜 서버 통합 테스트와 실제 호출 점검 스크립트 `e8dbdb9`를 병합. main `dd930e2`에서 유닛 234건, 통합 130건 통과. 실제 API 미실행 | `dd930e2`와 이 문서를 담은 커밋 | 완료 |
| CP-8 | 단계 2 착수 | 사용자 직접 지시("단계 2 재수정 반복도 이어서 진행해", "세션들 최대한 활용해서 진행해줘 투입 가능하게")에 따라 작업 지시서 `docs/work-orders/phase-2-repair-loop.md` 작성. F1(p1), F5 준비(p4), G1(p6), G2(p5), H1(p7), H2(p8) 배정. 작업자 브랜치를 main `0164b10`에 맞춤 | `0164b10`과 이 문서를 담은 커밋 | 완료 |
| CP-9 | 단계 2 구현과 검토 | 재수정 반복 엔진, 보호 경로, 스냅샷·되돌리기, `.cmd` 실행, 제공자 수정, CLI 보안 모듈, 사용 문서를 main에 병합(`5989d79`까지). 교차 검토 H1·H2·F6와 결정 S-1~S-12, T-1~T-15를 기록(`1037593`). p1의 연결 커밋 `3f3756d`는 통합 8건 실패가 남아 main 미병합. p1이 주간 사용 한도로 멈춰 PM이 p1의 계약 변경을 검증 후 `f45959a`로 커밋하고 나머지를 p5~p8에 재배정 | `1037593`과 이 문서를 담은 커밋 | 완료 |
| CP-10 | 단계 2 병합 | 수정 묶음 T(p5 `b807001`, p6 `a51002c`, p7 `c3d9865`, p8 `2f014a4` `c748821` `1677b1c`, 계약 `f45959a`)와 p4의 통합 테스트 `52a634d` `2410686`를 합친 뒤 PM이 병합 전에 전체를 실행해 통과를 확인하고 main `4074d5c`로 병합 | `4074d5c`와 이 문서를 담은 커밋 | 완료 |
| CP-11 | 일시 정지 | 사용자 지시로 전체 작업을 멈췄다. 단계 3 구현(무결성 확인, 설치 위치 거부, report, doctor, 후보 스크립트), 수정 V·W·X, `models` 명령, 사용성·UX 설계, 문서화 누락 보완을 main `39219c8`까지 병합. 작업 브랜치를 원격에 올림 | `39219c8`과 이 문서를 담은 커밋 | 완료 |
| CP-12 | 재개 | 새 Herdr 세션 w3에서 w3:p1이 오케스트레이터를 맡았다. 새로 받은 저장소에 worktree 8개를 원격 브랜치와 main에서 다시 만들고 저장소 작성자를 설정했다. main `34393bd` 기준 검증 통과. 사용성 개선(N-A~N-E)과 단계 4·5 설계(P4-G, P5-A, P5-U)를 배정 | 이 문서를 담은 커밋 | 완료 |

## 사용자 상시 지시 (2026-11-12)

사용자가 임시 PM에게 직접 지시했다: "GUI 등 최종 모든 설계를 중간에 멈추지 말고 내 지시가 없으면 끝까지 연속 진행하고 있어." PM은 이를 다음과 같이 적용한다.

- roadmap의 남은 단계(단계 3 마무리, 단계 4 범용 작업 확장, 단계 5 GUI·IDE)를 사용자의 추가 지시 없이 차례로 설계·구현·검증한다. 미정 항목은 PM이 정하고 근거를 작업 지시서에 남긴다.
- 그대로 지키는 한계: PM과 작업자는 실제 Anthropic API를 호출하지 않고 키 파일을 읽지 않는다. 과금이 걸린 선택(세션 사용 한도 창 등)과 force push, 이력 재작성은 하지 않는다. `docs/pm-control.json`이 active가 아니면 멈춘다.
- 실제 API 검증이 필요한 완료 판단(1b, 단계 2·3의 실 API 기준)은 "미수행"으로 적고 다음 단계의 오프라인 작업을 계속한다.

- 추가 지시(같은 날): 편의성을 확보하게 설계한다. 설계 전문가를 다시 붙여 사용성 개선을 협의하고 추가 설계한다. UX 설계도 진행하고 모두 문서화한다. 문서화 없이 진행된 부분은 다 문서화한다. 모델명을 외워 치지 않도록 모델 목록을 불러와 고를 수 있게 한다(결정 Y-1~Y-5, `work-orders/phase-3-self-development.md`).
- 적용: p6이 사용성 검토와 UX 설계 문서(`docs/design/usability-review.md`, `docs/design/ux-design.md`)를, p8이 문서화 누락 점검과 설계 문서 보완(`architecture.md`, `decisions.md`, `privacy.md`, `testing.md`, `unit-test-plan.md`, `development-workflow.md`, `personas.md`, `docs/design/implementation-map.md`)을 맡았다. 선택지는 각 문서의 "결정 필요"에 권고안과 함께 올라오고 PM이 정해 작업 지시서에 기록한다.

## 진행 요약 (CP-79, 2026-11-27) — G12·G13 채택, 인수 묶음 완료

- **G12·G13 채택:** Codex 작업자의 최종 READY 보고 `8d5a4129…422893e6`를 끝까지 읽고 해시 확인·ACK했다. PM이 제품을 바꾸지 않은 시험 3파일 전체, baseline·diff·계측 코드·원시 기록과 110개 근거 해시를 독립 검토했다. 새 발견 0, 작업 branch `e5601f82`를 main `9ae6c8cc`에 합쳤다. 검토 patch `b0c871f3…b148e79`와 main staged patch·검증 트리가 일치하며 review-branch PASS·별도 비밀 검사 뒤 지정 작성자·trailer 없이 커밋했다.
  - G12는 부모의 해당 환경값을 읽거나 바꾸지 않고 완전 합성 자식 안에서 native/앱 로더를 같은 초기 조건으로 비교한다. 기존 값 보존과 parsed 이름·값 단언을 유지했다. 가짜 상속 충돌 실패 5/5→0/5, 후보는 기본/기존 값 두 조건을 매번 확인했다.
  - G13은 모든 자식 ready 뒤 go, 원 결과 단언 뒤 release, 실제 close 뒤 fixture 삭제로 바꿨다. 750ms 준비 지연에서 기능 실패는 전후 0/10이며 준비 누락 회전만 10/60→0/60이다. 고의 준비 실패 전후 각 10회는 계속 실패하되 삭제 시 생존 자식은 2→0이다. 실제 동시 CPU 실행이나 모든 interleaving의 보장으로 해석하지 않는다.
- **최종 root 보드:** 타입 검사 exit 0. unit 4,673건(4,662 통과·10 건너뜀·1 TODO), integration 686건(684 통과·1 건너뜀·1 TODO), 실패·취소 0. 관련 파일은 작업자 19/19다. 이번 root 시험만의 변경에는 GUI를 반복하지 않았으며, 직전 G11 합친 GUI 보드(CP-78)의 GUI 780건·Electron 연기 227/227을 구분해 유지한다.
- **임시 PM 인수 묶음 완료:** 자신의 G5/G6/G9는 Codex 독립 검토와 보완 재검토 뒤 채택했고, latest·미커밋 F1/F2/F4도 Codex 인수/독립 검토·전체 보드 뒤 채택했다. 뒤이은 G7/G8·G11·G12/G13도 완료했으며 새 작업자를 만들거나 Claude에게 새 일을 주지 않았다. Codex 작업자는 READY 뒤 대기한다. PM 위임은 active이며 사용자의 회수 권한은 그대로다.
- **남은 기록/사용자 항목:** G10·U-213, MRR-2~4·SS-1/2·낮은 위험 읽기·POSIX FIFO·DR-73은 인계의 정보/환경 제약 기록으로 남긴다. 꾸러미 화면·키 없는 수동 12항목·실제 API 3.1·GUI-D9·E-5/E-6은 완료로 처리하지 않는다. 실제 API·키/개인 설정 조회·미승인 설치/서명/게시·질문/선택 화면 응답·새 worktree·이력 재작성은 수행하지 않았다.

## 진행 요약 (CP-78, 2026-11-27) — G11 채택, G12·G13 진행

- **G11 채택:** codex-worker-2의 최종 독립 검토 `747b84e9…715a36a`에서 새 발견 0을 확인하고 작업 branch `b24fdaef`를 main `97d2b4e3`에 합쳤다. GUI 계획 시험 한 파일의 150ms 추정을 실제 write 콜백의 done 대기로 바꿨으며 원래 assert 48문장은 동일하다. 검토한 patch `ef77e89b…e6443612`와 main staged patch 및 보드 트리가 일치한다.
- **합친 보드:** 타입 검사와 root build exit 0. unit 4,673건(4,662 통과·10 건너뜀·1 TODO), integration 686건(684 통과·1 건너뜀·1 TODO), GUI 780건(778 통과·2 건너뜀), Electron 연기 227/227, 실패·취소 0. 연기의 바깥 소켓은 0이다. 별도 check-secrets 결과를 읽고 커밋했으며 지정 작성자·trailer 없음이다.
- **G12·G13 배정:** Codex 작업자만 기존 codex-verify의 `test/flake-g12g13`(기준 `60185c7f`)에서 시험 3파일을 맡는다. 합성 환경의 기존 값 충돌과 자식 준비 지연을 먼저 대조하며, 제품 변경 없이 환경 비교 격리·모든 자식 ready 뒤 출발·명시적 종료 대기를 구현한다. 원 제품의 경합으로 과장하지 않으며 PM 독립 검토와 합친 보드 뒤 채택한다.
- **인수 작업 상태:** latest·F1/F2/F4·G5/G6/G9·G7/G8·G11은 채택했다. G10과 인계의 정보 의견은 기록으로 유지한다. 실제 API·키 조회·미승인 설치/서명/게시·사용자 몫 수동 확인은 수행하지 않았다.

## 진행 요약 (CP-77, 2026-11-27) — G7·G8 채택, G11 독립 검토 통과

- **G7·G8 채택:** Codex 보고 `678028e8…a5f2a93`를 PM이 읽고 독립 검토·ACK했다. 작업 branch `fecdb088`, main `60185c7f`. 합친 판에서 타입 검사 0, unit 4,673건(4,662 통과·10 건너뜀·1 TODO), integration 686건(684 통과·1 건너뜀·1 TODO), 실패 0. 검토 도구·트리/패치 일치·별도 비밀 검사 뒤 커밋했다.
  - G7은 반납된 빈 포트 대신 TCP listener를 시험 수명 동안 소유하고 연결을 통제된 RST로 끝낸다. PM이 허용한 fixture 코드 차이는 ECONNREFUSED→ECONNRESET뿐이며 api_error·retryable·고정 문구·누출 없음의 뜻을 유지한다. 경쟁 포트 대조 실패 5/5→0/5, 소유 중 경쟁 bind는 EADDRINUSE 5/5다.
  - G8은 handle을 얻은 뒤 finally에서 cancel→done을 기다려 fixture 삭제보다 먼저 정리한다. 고의 기능 실패는 계속 실패하지만 정리 누락/after-hook 실패는 각각 5/5→0/5다. 정상 관련 파일은 o06 3/3·n7 7/7이다.
- **G11 독립 검토:** PM이 구현한 write 콜백의 실제 done 대기를 codex-worker-2가 검토했고 최종 보고 `747b84e9…715a36a`에서 새 발견 0·채택 권고다. 기존 48개 assert 문장 보존, 350ms fake 완료 지연 실패 5/5→0/5, 관련 6/6을 확인했다. 작업 branch `b24fdaef`, review-branch PASS이며 아직 main 합친 GUI 보드 전이다.
- **운영 정정:** PM이 G11 보고 초안을 먼저 읽고 임시 해시로 ACK를 시도한 뒤 다음 branch를 너무 일찍 준비했다. 실제 READY·화면을 확인해 이전 branch를 복원하고 최종 보고를 다시 읽어 올바른 해시로 ACK한 뒤 재배정했다. 소스 손상은 없고 정적 검토 패킷도 불변이다. 앞으로 의존 동작은 READY·ACK 성공을 확인한 뒤 진행하고 checkout은 clean 상태를 강제 확인한다.
- **다음:** G11의 전체 GUI 보드와 채택, G12 합성 환경 비교·G13 명시적 자식 출발 barrier. G10은 현재 즉시 Promise 대역의 정보 의견으로 남기며 미재현 미래 가정만으로 바꾸지 않는다.

## 진행 요약 (CP-76, 2026-11-27) — G5·G6·G9 채택과 전체 GUI 보드, 남은 시험 수명 보완

- **G5·G6·G9 채택:** PM 자신의 구현은 codex-worker-2의 독립 검토·보완 재검토를 거쳤다(`48dfcf33…4ea523d`, 새 발견 0). 작업 branch `70660220`, main `b1b58ee4`이며 제품 변경 없이 시험 네 파일만 합쳤다. staged patch와 검토 patch 및 검증한 트리의 일치를 확인했고 check-secrets는 별도 실행 뒤 커밋했다.
- **합친 보드:** 타입 검사와 root build exit 0. unit 4,673건(4,662 통과·10 건너뜀·1 TODO), integration 686건(684 통과·1 건너뜀·1 TODO), GUI 780건(778 통과·2 건너뜀), Electron 연기 227/227, 모두 실패 0. 실제 API 검증으로 간주하지 않으며 smoke의 바깥 소켓 수는 0이다.
- **F1·F2·F4와 CP-75**는 원격 `f3a52c18`에서 확인했다. 새 PM 인수 뒤 진행한 latest·F·G5/G6/G9는 독립 검토·main 합친 보드·지정 작성자·trailer 없음으로 구분해 채택했다.
- **G7·G8 진행:** codex-worker-2가 main의 F 채택 판 `9a6e8596` 위 `test/flake-g7g8`에서 포트 반환 공백과 실패 때 실행 정리 누락을 재현 먼저로 시험만 다룬다. 통제된 실제 connection error가 다른 코드이면 의미를 보존하는 범위만 허용하며, 다른 계약이 필요하면 보고하고 제품을 바꾸지 않는다.
- **G11 착수:** PM이 GUI 계획 시험의 150ms 추정을 실제 done 사건 대기로 바꾸는 작은 단위를 직접 맡았다. 메모리 fake 완료 지연을 사본에 넣어 재현하고, Codex 작업자가 나중에 독립 검토한다.
- **G10 판단:** 현재 대표 settings-change 대역은 I/O 없이 즉시 해결하는 Promise이고 `settle`은 이벤트 루프 차례를 넘긴다. 현재 실패를 재현하지 않은 상태에서 미래 I/O 변경을 가정해 모든 tick을 바꾸지 않는다. 대역이 외부 비동기 I/O로 바뀔 때 완료 조건을 갱신하는 정보 의견으로 남긴다. G12 환경 가정·G13 출발 barrier는 후속 후보로 유지한다.
- **미승인 범위 유지:** 실제 API·키 조회·설치/서명/외부 게시·작업자 질문/피드백/크레딧 화면 응답·새 worktree·이력 재작성은 하지 않았다. 현재 위임과 회수 권한은 바꾸지 않았다.

## 진행 요약 (CP-75, 2026-11-27) — F1·F2·F4 Codex 인수와 채택, GGR 보완 재검토 통과

- **F1·F2·F4 채택:** 원 작업자 보고 `4ef7cd40…df7261`과 add -N 미준수 이력은 그대로 보존하고, Codex 인수 보고 `e7787647…8038f9d`를 읽고 ACK했다. Codex 작업자는 같은 미커밋 7파일을 바꾸지 않고 build·새 회귀 9/9를 확인했다. PM은 제품 코드를 수정하지 않은 독립 검토자로서 HTTP 취소·wx 임시 파일 소유·apply 잠금 finally를 검토했다.
  - 작업 branch `1e21fc4d`, main `9a6e8596`. 합친 PM 보드에서 타입 검사 exit 0, unit 4,672건(4,661 통과·10 건너뜀·1 TODO), integration 686건(684 통과·1 건너뜀·1 TODO), 실패 0. 검토 도구 PASS·트리/패치 일치·별도 비밀 검사를 확인했다.
  - exclusive 새 config의 부분 쓰기와 별도 close 실패 주입은 이번 범위에서 미수정/미실행으로 남긴다. 원 보고의 “인덱스 쓰기 없음”을 다시 인증하지 않으며 현재 빈 인덱스와 Codex 인수 중의 바이트 보존을 확인했다.
- **GGR-1·GGR-2 보완:** PM이 구현한 보완을 codex-worker-2가 재검토했고 `48dfcf33…4ea523d`에서 새 발견 0·채택 권고다. CLI가 실제 쓰는 `rawTextHoldsKey`에 16/64/256KiB의 작업량 관측과 알려진 제곱 시간 source 대조를 추가했다. 느린 host 시험은 gate 해제·진행 중 close 재사용·동결 kill 소진·중첩 finally 정리를 갖췄다. 임의 정규식 VM 시간이나 모든 I/O 실패의 정리를 보장한다는 뜻은 아니다.
  - 작업 branch `70660220`으로 커밋했고 review-branch PASS다. 관련 66/66, 통제 지연 45/45 및 EOF 실패 사본의 종료·정리 대조가 통과했다. GUI를 포함한 main 병합 보드를 다음에 실행하며 아직 이 시험 후보는 main에 채택하지 않았다.
- **운영:** `latest` 채택과 CP-74는 `1d35c1d1`까지 원격 main에서 확인했다. 새 PM의 배정·통합·푸시 전 위임 확인, separate check-secrets, 지정 작성자·trailer 금지, 기존 작업 공간 재사용을 계속 적용한다.
- **다음 단위:** G7(포트 반환 뒤 소유권 공백)·G8(실행 정리 finally)을 재현 먼저로 시험만 보완한다. 낮음 G10~G13은 현재 동작과 재현 근거에 따라 처리하고, 근거 없이 모든 tick을 바꾸지 않는다.

## 진행 요약 (CP-74, 2026-11-27) — Codex PM 인수, latest 재작업 채택

- **PM 인수:** 새 위임 ID·active·w3:pJ 및 main과 origin/main의 동일·clean 상태를 확인했다. 기존 네 작업 공간을 재사용하며 Claude 작업자에게 새 일을 주지 않는다. Herdr의 관리자 서버 접근에는 권한 있는 실행을 사용했고 질문·피드백·사용량 화면에는 응답하지 않았다.
- **latest 시작 틈 재작업:** codex-worker-2의 LW-1~4 구현과 회귀를 PM이 정적으로 독립 검토했다. resolver가 직접 하는 `inspectLock` 1회만 세고 `listRuns`의 기존 phase 검사는 그대로 둔다. 살아 있는 holder의 목록상 무결과 run이 완료 run보다 먼저 생성됐어도 진행 중으로 처리하며 ID·startedAt 비교는 없다.
  - 남은 U-22 CLI 시험의 제목·기대 질의 목록 두 줄을 별도 허용했고, 반환 code/runId와 기존 제품 후보 바이트를 유지했다. 관련 40/40·기존 42/42가 통과했다.
  - 작업 branch `c8a24365`, main 채택 `180a7661`. main과 합친 PM 보드에서 타입 검사 exit 0, unit 4,663건(4,652 통과·10 건너뜀·1 TODO), integration 686건(684 통과·1 건너뜀·1 TODO), 실패 0. 검증한 트리·패치와 main staged 결과 일치를 확인하고 비밀 검사는 별도 호출로 통과한 뒤 커밋했다. 작성자·커미터는 지정 사용자이며 trailer는 없다.
- **G5·G6·G9:** PM 자신의 시험 후보를 codex-worker-2에게 독립 검토시켰다. 중간 둘(GGR-1 병적 검사 경로의 회귀 검출, GGR-2 EOF 실패 때 시험 정리)을 받아 채택을 보류했다. PM이 보완했고, 최종 관련 66/66·원 통제 지연 45/45가 통과했다. EOF 전달을 막은 오류 주입 사본에서는 이전 정리가 남긴 폴더가 보완 뒤 제거되고 소유 호스트가 종료됨을 확인했다. 재검토 전이므로 main에는 아직 합치지 않는다.
- **F1·F2·F4 인수:** 이관 문서와 달리 원 작업자의 완료 보고·READY가 남아 있어 원문과 해시를 확인했다. 미커밋 7파일·빈 인덱스를 보존했고 Codex 작업자에게 인수·검증 보고를 배정했다. 새 PM이 같은 7파일 raw 해시로 build·새 회귀 9/9·unit 4,595건(4,584 통과·10 건너뜀·1 TODO)·integration 686건(684·1·1)을 재검증했으며 실패 0이다. 아직 채택 전이다.
- **검증 환경 기록:** taskkill 대비책 이전 F 기준판의 sandbox 전체 실행은 종료 제한으로 중단했다. 별도 합성 PATH에 PowerShell 경로가 없던 실행의 실패도 정상 성공으로 덮지 않았다. 고정 PowerShell 경로를 포함한 정상 환경의 최종 결과를 위 수치로 사용한다. 작업자 latest 전체 실행도 같은 PATH 누락 8건과 알려진 손자 종료 2건을 기록했고, 누락을 고친 해당 3파일 25/25와 최종 PM 병합 보드 전체 성공으로 구분했다.
- **다음:** F 인수 보고와 독립 검토·main 보드, GGR 두 보완의 독립 재검토, 개선 검토 G의 G7·G8·G10~G13. 사용자의 꾸러미 화면·실제 API·키 없는 수동 항목·GUI-D9 미승인 범위는 그대로다.

## 진행 요약 (CP-73, 2026-11-27) — 오케스트레이터 임시 이관(Claude w3:pG → Codex w3:pJ), 개선 검토 G 높음 넷

- **이관:** 사용자 직접 지시 "codex 중 하나에 오케스트레이터 임시로 이관하고 작업도 codex들만 하도록 이관".
  - 새 위임은 `pm-20261127-codex-01`, 담당은 codex-worker(w3:pJ)다. 작업자는 codex-worker-2(w3:pK)만이고, claude-worker(w3:pH)에게는 새 일을 주지 않는다.
  - 진행 중 단위·작업 방식·첫 순서는 [2026-11-27 이관 문서](operations/pm-handoff-2026-11-27.md)에 있다. Claude w3:pG는 이 기록을 push한 뒤 배정·합치기·push를 멈췄다.
- **CP-72 이후 main에 들어간 것:**
  - U-22 준비 대기(`42179c82`)
  - RR-1·D4 시험의 실제 사건 대기(`68a48c9a`)
  - 작은 정리 셋(`a9a8dd37`): 쓰이지 않는 `integrity` 인자, OFG-2 `plan_checked`, 설정 화면 "다음 실행부터 적용" 안내
  - 개선 검토 G(시험의 시간·순서 가정, 읽기만, 후보 13) 가운데 높음 넷
    - G2·G3(`ff822763`): 잠금 방해 핸들을 부모가 풀 때까지 유지, n03의 running 대기
    - G1·G4(`4705b8ba`): 실제 exit 관측과 runner 시계 제어
  - 넷 모두 통제 지연 재현에서 실패하다가 0으로 줄었다.
- **진행 중(이관 문서의 표):**
  - G5·G6·G9 시험 견고화(codex-worker)
  - `latest` 시작 직후 틈의 재작업(codex-worker-2, "잠금 한 번" 규칙). 첫 판은 검토에서 시각 추정의 문제 셋이 나왔다.
  - F1·F2·F4(claude-worker가 미커밋으로 남김, Codex가 이어받을 것)
- **PM 측정:** `4705b8ba`에서 unit 4,631건(4,620 통과·10 건너뜀·1 TODO), integration 686건(684·1·1), 실패 0. GUI는 `a9a8dd37`에서 780건(778·2), 연기 시험 227/227.

## 진행 요약 (CP-72, 2026-11-27) — 개선 검토 C·D·E 수정 끝, 개선 검토 F의 F3, taskkill 대비책

- **개선 검토 C:** IR-C2 data_checks가 표를 읽는 중에도 취소 신호를 본다. 검토 의견 C2R-1·C2R-2에 따라 규칙이 끝난 뒤 신호가 있으면 그 규칙은 늘 "취소됨"이다(`fc4852a4`). 이로써 C2·C3·C3R-1·C4가 끝났고, C1(POSIX FIFO)은 한계로 남는다.
- **개선 검토 D(GUI) 끝:**
  - IR-D4: 렌더러 `Screen.dispose`. Shell이 버려질 때 구독·타이머·키 리스너를 한 번 정리한다.
  - RR-1: 둘째 실행·명령줄 열기에서도 마지막 형태를 보낸다. preload는 고정 쌍만 복사한다(`94db3a4c`).
  - DR-1: 버린 Shell은 늦은 재시작 응답에도 아무것도 만들지 않는다. GUI review가 `lockLeft` 안내를 보인다(`90acd0a2`).
- **개선 검토 E(저장소·엔진·스크립트) 끝:**
  - E1 후속(E1R-1·E1R-2): 현재 run mark도 상태 폴더 검사를 거친다(`66f8d179`). cleanup의 요약·미리보기·적용도 `state_dir_not_plain`으로 거부한다(`d17e55bd`).
  - E2 후속: 잠금 파일(64 KiB)·journal·변경 색인·원문과, 읽기 전에만 상한을 보던 7곳을 같은 handle 제한 읽기로 바꿨다. 넘으면 그 자리의 기존 실패다. 검토 의견 MRR-1에 따라 큰 원문은 전처럼 `missing_snapshot`이다(`e35ce004`).
  - E3R-2: 끝 점검 중 취소에 대한 안내를 사용 문서와 구조 문서에 적었다(`68e934a2`).
  - 남은 상한 없는 읽기(현재 파일 해시, Linux `/proc`, revert stream 해시)는 위험이 낮다고 기록한다.
- **개선 검토 F(앱·CLI·모델, 읽기만):** 중간 1, 낮음 3.
  - F3(review 판정은 저장됐는데 잠금 해제 실패가 `internal_error`): U-220과 같게, 성공 결과에 `lockLeft: true`를 단다. 검토 의견 F3R-1에 따라 release가 false인 경우도 같다. 공개 결과 필드 추가는 PM 결정이다(`37d84ea4`).
  - F1(HTTP 취소 경계)·F2(설정 임시 파일)·F4(이동 계획 잠금 수명)는 구현이 끝났다. 보고 전에 작업자 창의 피드백 화면에서 멈췄다(아래 운영).
- **taskkill 대비책(새 발견):** Codex 작업 공간에서 `taskkill`이 OS 접근 거부로 실패하면 runner가 자식을 살려 둔 채 돌아가, 시험 정리가 EPERM으로 막혔다. 이제 taskkill이 실패하면 살아 있는 직접 자식을 한 번 끝낸다. 손자는 DR-11 경계에 남는다. 정상 taskkill 보드에서 `windows-cmd-real` 10/10이다(`eedfa9f4`).
- **시험 견고화:** U-285가 상속된 LANG에 흔들리지 않게 했다. 통합 시험 목록에 o06·u321 행을 넣었다(`6f17b610`). 부하에서 한 번씩 실패한 U-22(report latest, `run_not_found`)와 RR-1 second-instance(두 tick 가정)는 원인 조사·수정 중이다.
- **운영:**
  - claude-worker가 F1·F2·F4 보고 직전에 금지된 `git add -N`을 실행한 것을 스스로 피드백 초안으로 남기고 멈췄다. PM이 확인한 바로는 그 작업 공간의 인덱스가 깨끗하다(staged·intent-to-add 0).
  - 작업자 창의 피드백 화면에는 응답하지 않는 원칙이라 사용자 처리를 기다린다.
  - cleanup 단위는 PM의 범위 누락으로 두 번 더 멈췄다. 이후 지시에는 옛 결과를 단언하는 시험도 미리 허용한다.
- **PM 측정(합친 판마다 프로젝트 스크립트, 실패 0):** `90acd0a2`에서 unit 4,631건(4,620 통과·10 건너뜀·1 TODO), GUI 780건(778 통과·2 건너뜀), 연기 시험 227/227. `eedfa9f4`에서 integration 686건(684 통과·1 건너뜀·1 TODO), `windows-cmd-real` 10/10. `37d84ea4` 첫 보드의 U-22 한 건은 재실행에서 통과했다(불안정 시험으로 기록).
- 남은 것: F1·F2·F4 보고와 검토, 작은 정리 셋(쓰이지 않는 인자·OFG-2 `plan_checked`·설정 "다음 실행부터" 안내, `ebbda7ea`) 채택, U-22·RR-1 불안정 시험, 사용자의 꾸러미 화면 확인(M-3.19), 실제 API 3.1, 키 없는 수동 12항목, GUI-D9(미승인), E-5·E-6 보류.

## 진행 요약 (CP-71, 2026-11-27) — 개선 검토 D 수정 대부분, 개선 검토 E의 E1~E6, 상태 폴더 링크 거부

- **개선 검토 D(GUI) 수정:**
  - 설정 적용 뒤 늦게 온 트리·변경 응답이 옛 가림 규칙의 항목에 새 id를 받던 것을 막았다. 리셋 세대를 보고 기존 `unknown_entry`로 거부한다. 리셋 세대 함수는 RD-1에 따라 필수 인자다. IR-D7 상태 저장은 큐 하나로 묶었다(`768e8053`).
  - 렌더러의 늦은 응답(IR-D1 설정 저장, IR-D2 변경 보기)을 막았고, 작업 공간별 마지막 형태가 전달되게 했다(IR-D3, `1a478884`).
  - GUI 상태 파일이 읽기 상한(UTF-16 262,144)을 넘지 않게 오래된 실행 기억부터 줄인다. 메모리와 파일은 같다. 읽기는 같은 handle로 786,433바이트까지만 한다(IR-D5·D6, `990b1213`).
  - 남은 것은 IR-D4(언어 재구성마다 구독 누적)와 RR-1(둘째 실행·명령줄 열기의 마지막 형태, main 쪽)이다.
- **개선 검토 E(저장소·엔진·스크립트) 수정:**
  - E3: 검증 회차의 상태 점검 뒤에도 취소·기한을 다시 본다(`1db933d2`). E3R-1에 따라 점검이 없는 구성에서 취소를 더 늦게 관찰하는 것도 허용한다. 끝 점검 도중의 취소는 이미 정한 끝을 바꾸지 않는다. 이 점을 사용 문서에 적는 일(E3R-2)이 남았다.
  - E4·E5·E6: 비밀 검사가 hunk 상태를 추적하고 NUL 경로·Git quoting을 읽는다. index 조회 실패는 finding으로 친다. branch 검사는 커밋별 본문을 본다. 검토 의견 GR-1에 따라 gitlink는 건너뛰고, GR-2에 따라 조합 diff는 exit 2로 거부한다(`76126e3d`). 새 검사기를 이 저장소의 tracked 전체·범위·staged·병합 자체에 돌려 오탐이 없음을 확인했다.
  - **E1(보안):** `.codaryn`이나 `runs`가 처음부터 링크(junction·symlink)면 run의 잠금·journal·result·snapshot이 작업 공간 밖에 쓰였다(재현됨). 이제 쓰기 전에 거부하고, 새 code `state_dir_not_plain`(종료 2, state, 재시도 아님)을 run·apply·revert·review·GUI 적용 점검·GUI 글 저장이 함께 쓴다(PM 결정 안 A, `d1bbd080`). cleanup은 아직 빈 목록·`internal_error`라 다음 단위다. 검토 의견 E1R-1(store를 직접 부를 때 현재 run mark)·E1R-2(시험 단언)는 고치는 중이다.
  - E2: state-guard·revert·applied·result·plan reader가 lstat 뒤 커진 파일을 끝까지 읽던 것을, 같은 handle의 제한 읽기(`readBounded`)로 바꿨다. 새 code는 없다(`43b26552`). 상한 없는 나머지 읽기(잠금·journal·변경 기록 등)는 검토자의 위험 순서대로 고치는 중이다.
- **IR-C2:** data_checks가 표를 읽는 중에도 취소 신호를 본다. 계약 변경은 없고 내부 전달만 한다. 후보 `f90f86e4`는 독립 검토 중이다.
- **운영:** 작업자 단위가 세 번 시작 직후 멈췄다(GUI 상태 파일 두 번, E1 한 번). 모두 PM이 소유 파일을 좁게 준 탓이었다. 이후로는 지시 전에 바뀌는 형·반환의 호출자와 옛 호출을 감싼 시험 대역을 찾아 소유에 넣는다. Codex 세션 ID 변동으로 ACK가 거절되면 수동 수신 기록으로 처리했다.
- **PM 측정(합친 판마다 프로젝트 스크립트, 실패 0):** `43b26552`에서 unit 4,562건(4,551 통과·10 건너뜀(POSIX symlink 4 포함)·1 TODO), integration 686건(684 통과·1 건너뜀·1 TODO), GUI 758건(756 통과·2 건너뜀), 연기 시험 227/227. `review-branch.test.mjs`는 unit glob 밖이라 보드에서 따로 돌린다(4/4).
- 남은 것: C2 채택, E1R-1·E1R-2, 남은 제한 읽기, cleanup의 `state_dir_not_plain`, IR-D4, RR-1, E3R-2 문서, 쓰이지 않게 된 `createRunVerify`의 `integrity` 인자 정리, 설정 화면 "다음 실행부터 적용" 안내(낮음), GUI 시험 3에 `plan_checked`(OF-2), 사용자의 꾸러미 화면 확인(M-3.19), 실제 API 3.1, 키 없는 수동 12항목, GUI-D9(미승인), E-5·E-6 보류.

## 진행 요약 (CP-70, 2026-11-27) — 개선 검토 C 수정 끝(C3·C3R-1·C4), OFG-2, GUI 정리, 개선 검토 D·E 시작

- **OFG-2(`096f10c8`):** GUI 엔진 호스트가 apply 전용 기록(`apply_started`·`plan_checked`·`file_moved`·`file_discarded`·`plan_item_failed`)만 `applyProgressLine`에 넘기고 나머지는 `progressLine`으로 보낸다(선택 A). 같은 사건이 렌더러 안에서 두 번 처리되던 것이 없어졌다. CLI 쪽 u52 시험은 GUI 순서를 따로 고정했다(`ac1f2804`).
- **GUI 정리:** 검토 의견 정리 묶음 GB-1·GC-1~3·SR-1(`ec3b7d06`), 실행 중 설정 바꿈은 다음 실행부터 적용된다는 사용 문서(`eadc4a02`), `ipc.ts`의 `ipcMain` 규칙 강화 GCL-1(`5b5c1b17`). GCL-1은 처음에 GUI 정리가 없는 판에 쌓아 충돌했고, main에서 다시 만들었다(쌓기 전 main이 소유 파일을 바꿨는지 확인하는 것을 PM 절차로 삼음).
- **개선 검토 C의 결정:**
  - C1(data_checks가 writer 없는 POSIX FIFO를 열면 open에서 기다려 취소·시간 한도를 돌려주지 못할 수 있음): Windows에서 재현할 수 없어 한계로 기록한다. POSIX 환경이 생기면 재현한다.
  - C2(data_checks의 취소 신호가 읽기 루프와 뒤따르는 결과표 읽기에 전달되지 않아 취소 뒤에도 그 규칙의 읽기·계산이 이어짐, 4 MB당 약 113 ms): 엔진이 await 뒤 취소를 다시 확인하므로 잘못된 성공 종료는 아니다. 반환 지연만이라 계약 결정이 필요한 후보로 둔다. 마지막 단계 뒤 신호를 다시 확인할지(Q/D가 신호 발화 뒤에도 원래 ok를 돌려줌)도 같은 후보다.
  - C3(작은 파일 무결성 해시가 한도 확인 전에 전체를 읽음): 같은 handle에서 64 KiB 조각을 남은 예산 + 감지 1바이트까지만 읽게(`f60a66ae`). 검토 의견 C3R-1(큰 파일 분기가 경로를 다시 열고 예산 밖을 한 조각 더 읽음)도 고쳤다(`8287aac8`): fstat 크기가 한도를 넘으면 읽지 않고 `too_large`, 그 밖은 모든 크기를 첫 handle로. 주석 둘(SR1-1·SR1-2, `73ffca84`).
  - C4(행마다 새 키가 생기는 JSONL에서 작업량이 행 수의 제곱으로 늘고 취소도 늦음): **PM 결정 (a)** 결과·오류 바이트는 그대로 두고 내부만 희소하게(새 열 상한은 유효 입력을 거부하므로 하지 않음). 동등성 시험 72건을 먼저 세워 수정 전후 모두 통과, 희소 8k행 describe 1,066 → 17 ms, 취소 지연 472 → 5 ms, 고정 열은 느려지지 않음(`3d1c6452`). 검토 의견 SP-1(희소 행의 그룹 상한 시험; PM이 C4 이전 판에서도 같은 바이트로 통과 확인)·SP-2(`columns` 문서)(`9ccc2dfe`).
- **개선 검토 D(GUI 화면·preload·main 보안 경계·엔진 호스트, 읽기만):** 새 발견 중간 5·낮음 2와 보안 관찰 1. 막혀 있음을 코드로 확인: HTML 주입(textContent·textarea 값만), CSP·sandbox·새 창·navigation 거부, `app://` 경로·MIME, sender 검사, preload 고정 채널, 토큰 TTL, 자식 프로세스 환경.
  - 보안 관찰: 설정 적용이 트리 id를 폐기하는 동안 그 전에 시작된 트리·변경 응답이 폐기 뒤 도착하면 옛 가림 규칙의 항목이 새 id를 받을 수 있다(추정, C1·C2와 별개).
  - PM 순서: (1) 보안 관찰과 IR-D7(창 기억과 실행 형태 저장이 겹치면 한쪽이 사라짐) — 재현 먼저로 진행 중, (2) IR-D1~D3(화면을 떠난 뒤 늦은 응답이 새 화면·작업 공간을 덮음, 작업 공간별 마지막 형태가 전달되지 않음), (3) IR-D4(언어 재구성마다 구독·타이머 누적), IR-D5·D6.
  - IR-D5·D6 PM 결정: GUI 상태 파일은 쓸 때 가장 오래된 실행 기억부터 지워 읽기 상한(UTF-16 길이 262,144)을 넘는 파일을 만들지 않는다. 읽기는 같은 길이 규칙을 유지하며 읽는 양에 상한을 둔다. GUI 시험 환경이 있는 작업 공간이 하나라 (1) 뒤에 차례로 한다.
- **개선 검토 E 시작:** 실행 기록 저장소, 나눈 뒤의 엔진, 표현·언어, 작업 흐름, 스크립트(읽기만).
- **PM 측정(합친 판마다 프로젝트 스크립트, 실패 0):** `3d1c6452`에서 unit 4,469건(4,462 통과·6 건너뜀·1 TODO), integration 684건(682 통과·1 건너뜀·1 TODO), GUI 712건(710 통과·2 건너뜀), 연기 시험 227/227. `9ccc2dfe`에서 unit 4,472건(4,465 통과·6 건너뜀·1 TODO). 제품 변경은 구현하지 않은 세션이 정적 독립 검토를 했고, 시험·주석만의 단위는 PM이 검토했다.
- 남은 것: 개선 검토 D 수정 (1)~(3), 개선 검토 E, C2 계약 후보, 설정 화면의 "다음 실행부터 적용" 안내(낮음), GUI 시험 3에 `plan_checked` 추가(OF-2), 사용자의 꾸러미 화면 확인(M-3.19), 실제 API 3.1, 키 없는 수동 12항목, GUI-D9(미승인), E-5·E-6 보류.

## 진행 요약 (CP-69, 2026-11-26~27) — IR-26 3단계 끝, G-4 되돌리기 예약, 보고서 저장 보호, 지킴 시험

- **IR-26 3단계(codex-worker-2 설계 초안, PM 결정 D3-1~D3-4; 이동만, 단위마다 구현하지 않은 세션의 독립 검토, 합친 판마다 PM 시험):** 600줄 이상 27개를 판단해 8개를 나눴다.
  - 계약 `app.ts` 1,274 → 469(A0·A1 `876d9c1b`, A2·A3 `be7b8b7e`; `app-core`·`app-settings`·`app-files`·`app-plans`, 형만), `engine.ts` 841 → 469(E1 `31330794`; `engine-errors`), `plan.ts` 1,296 → 276(P0·P1 `a02a2d96`, P2 `c1b95a5d`; `plan-core`·`plan-changes`·`plan-apply`). **P3는 하지 않기로 결정**(P2 뒤 276줄이라 나눌 기준 아래, 형 전용 조합 층 예외의 비용이 더 큼; 검토자 동의).
  - 작업 파일 해석 `task.ts` 881 → 384(T0·T1 `3d4c2a27`, T2 `60cb7868`; `InputError` 한 클래스), Markdown `markdown.ts` 847 → 296(M1 `f174c9e8`; 파일 I/O 없는 `markdown-reader`), CLI 사람 출력 `output.ts` 1,010 → 389(O1·O2 `81b095ab`, O3·O4 `b4e3a439`; 만들 때 무동작 factory, 진행 상태는 root — D3-3).
  - GUI 렌더러 `api.ts` 663 → 82(R0·R1 `54def902`, R2·R3 `0838dc0b`), GUI main `ipc.ts` 883 → 484(G-4 뒤 G-4 구현자가 41채널 지도를 다시 그리고 다른 검토자가 대조 — D3-4; 묶음 A `83202dab`, B `cce3bd18`, C `05cbedf0`; live 상태·예약을 쓰는 17채널은 등록 root에 남김).
  - 나누지 않은 19개(정리 트랜잭션·잠금·스냅샷·실행 기록 읽기·입력 준비·doctor·데이터 검사·카탈로그 등)는 한 흐름의 순서나 한 등록 계약이라 이번 단계에서 둔다.
  - 평가 위치 변화(E1, P0·P1, P2: 옮긴 맨 수준 값이 facade의 남은 값보다 먼저 만들어짐)는 단위마다 초기화 목록·교차 읽기 0·두 진입점의 정적 순서·하위의 facade import 0을 보고하게 했고, 검토자가 독립으로 확인해 소비자에게 보이지 않음을 확인했다.
- **지킴:** 계약 `app*.ts` 경계(`0e93670c`), 가족 경계(`f8d1e156`; app·engine·plan·task·output을 표로, 하위를 목록으로 찾음), CLI 출력 가족 실행 성질(`17d0747f`), GUI main 분할(묶음 C에 포함; 분야 모듈의 `ipcMain`·root import 금지), IPC 계산 로더 허용 목록과 BMP 전체 문자 정책(IG-1·IG-2 `41bfa81a`). 마무리 정리(`fb550236`): facade 머리 주석, 낡은 문서 위치, P3 관련 예외 삭제. 구조 문서(`0d75e4a5`).
- **GUI 수정:** G-4(`a3fcbe89`, codex-worker 구현, claude-worker 검토) — 시작 예약 중 되돌리기 거부, 되돌리기 중 시작·다른 되돌리기는 새 code `revert_active`(PM 결정 B, 기존 `run_active` 문구는 그대로). 보고서 저장이 `.codaryn` 기록 폴더 안(대소문자·junction 포함)을 고르면 `save_state_dir`로 거부(`b8980cb0`; 남은 경계 SR-2 검사와 쓰기 사이 틈, SR-3 `.codaryn` 안을 뿌리로 하는 SMB 공유는 위험 기록).
- **시험 견고화:** n13 잠금 긴 잡음 시험이 부하에서 두 번 실패(제품의 안전한 "잡힘" 판정) → 시험이 자기 자식의 종료를 확인한 뒤 "잡힘"일 때만 최대 4번 다시 묻게(`1b2f6082`, 제품 그대로). U-213 실제 시간 시험이 부하로 한 번 실패(재실행 통과, 기록만).
- **발견·진행 중:** OFG-2 — GUI 엔진 호스트가 progressLine이 null인 기록을 applyProgressLine에 넘기고 그것이 공유 기록을 progressLine으로 되넘겨 같은 사건이 렌더러 안에서 두 번 처리된다(분할 전부터, GUI에 보이지 않음) → 선택 A(호스트가 apply 전용 기록만 넘김)로 수정 중. GUI 검토 의견 정리 묶음(GB-1·GC-1~3·SR-1) 검토 중. 개선 검토 C(도구·검증·정책·개인정보·작업 공간·표·모델) 진행 중.
- **PM 측정(합친 판마다 프로젝트 스크립트, 실패 0):** 마지막 전체 판 `c1b95a5d`에서 unit 4,372건(4,365 통과·6 건너뜀·1 TODO), integration 684건(682 통과·1 건너뜀·1 TODO), GUI 702건(700 통과·2 건너뜀), 연기 시험 227/227. `fb550236`에서 unit 4,387건(4,378 통과·6 건너뜀·3 TODO — OFG-2 둘).
- **운영:** 작업자 창의 질문·권한 창에는 답하지 않았다(claude-worker의 읽기 명령이 안전 검사에 걸려 자동 거절, codex-worker의 소유 확대 질문은 파일 지시로 답함). 작업자들이 지시 범위를 벗어나야 할 때 멈추고 보고했다(IPC 4a·4b 공유, OFG-1·OFG-2, SR-1 소유). Codex 세션 ID 변동의 ACK 거절은 수동 수신 기록으로 처리했다.
- 남은 것: 사용자의 꾸러미 화면 확인(M-3.19), 실제 API 3.1, 키 없는 수동 12항목, 서명·설치 파일·외부 게시(GUI-D9, 미승인), E-5·E-6 보류.

## 진행 요약 (CP-68, 2026-11-26) — IR-26 첫 범위 끝(엔진·GUI 공유 IPC), 구조 문서와 지킴 시험

- **IR-26 엔진 2단계 끝(이동만, 단위마다 구현하지 않은 세션의 정적 검토, 합친 판마다 PM 전체 시험):** U4 공유 상태 `RunTally`(`af754be7`), U5 도구 호출 → `run-tools.ts`(`25de0050`), U6 대화 → `run-converse.ts`(`4f5bc0d5`), U7 검증·재수정·승인 계획 점검 → `run-verify.ts`(`1d42acc6`). 정리(`6cf0cc46`, codex-worker-2 구현, claude-worker 검토): 쓰이지 않는 import 바인딩 59개 제거(모듈 요청 순서는 부수효과 import로 유지), 떠돌던 doc 주석 둘을 제 함수로, 상태 디렉터리 guard에 한 줄 주석. **`engine/index.ts` 1,792 → 274줄**(공개 facade와 조립 뿌리 `runWith`).
- **IR-26 GUI 공유 IPC 끝:** 2 설정·제안·모델(`03886e48`), 3a 실행 시작·결과·확인·계획 점검(`8da16246`), 공통 도우미를 primitives·core로(`b1931ff7`), 3b 텍스트 열기·저장(`6523b3b6`), 4a 실행 사건·계획·변경·검토(`b1a28b6f`), 4b 실행 결과 보기·보고서(`708f357e`), 4c 실행 목록·되돌리기·정리·설정 만들기(`dfdcc730`). **`shared/ipc.ts` 1,838 → 92줄**(채널·이벤트 목록과 157개 이름의 명시 재수출만). 방향은 facade → 분야 → core → primitives, 분야끼리 import 0. 4a·4b의 구현자는 분야끼리 공유가 드러나자 지시대로 멈추고 보고했다 — PM이 공유 항목(`TIME`, `RunItemView`, 실행 상태·가림 보기·결과 보기)을 primitives·core로 옮기도록 소유를 넓혀 다시 보냈다.
- **지킴(`46b1e3c1`, codex-worker 구현, claude-worker 검토):** 새 시험 `gui/tests/unit/ipc-guards.test.ts`가 `gui/src` 소스에서 `shared/` 밖의 `shared/ipc/*` 직접 import 0(정적·동적·`require`·`import type`·재수출)과 내부 방향을 고정한다. 텍스트 보기의 비공개 문자 집합이 `primitives`의 `UNSAFE_IN_MESSAGE`와 모든 코드 포인트(1,114,112개)에서 같아 한 선언으로 합쳤다. 남은 선택 보강: IG-1(계산 경로 동적 import 허용 목록), IG-2(BMP 전체 집합 고정).
- **문서(claude-worker):** IR-26 뒤 엔진·앱·계약 모듈 구성과 설계 결정 넷(`7bd50f49`). GUI 공유 IPC의 facade와 열 모듈, `standalone-gui.md` 6.4의 결정 "검사기의 자리"(facade로만, 분야끼리 import 0, 보안 문자 집합 한 선언, 지킴 시험이 고정), 개인정보 문서의 가림 위치(`27baf5fc`).
- **PM 측정(합친 판마다 프로젝트 스크립트, 실패 0):** 마지막 `46b1e3c1`에서 unit 4,364건(4,357 통과·6 건너뜀·1 TODO), integration 684건(682 통과·1 건너뜀·1 TODO), GUI 587건(585 통과·2 건너뜀; 지킴 시험 5건 추가), 연기 시험 227/227. 로그는 `.codaryn/pm-tools/evidence/main-*`.
- **운영:** claude-worker 창에 읽기 명령이 안전 검사에서 `rm`으로 오인돼 권한 확인 창이 한 번 떴다. 작업자 창 UI에는 답하지 않았고, 약 110초 뒤 자동 거절된 다음 작업자가 보고 폴더의 스크립트로 같은 확인을 마쳤다. Codex 세션 ID 변동으로 ACK가 거절되면 보고를 끝까지 읽고 해시를 확인한 뒤 수동 수신 기록을 남겼다.
- 진행 중: G-4(되돌리기 처리기가 시작 예약을 보지 않음 — 재현 먼저, codex-worker), IR-26 다음 단계 설계 초안(남은 600줄 이상 파일, codex-worker-2).
- 남은 것: 사용자의 꾸러미 화면 확인(M-3.19), 실제 API 3.1, 키 없는 수동 12항목, 서명·설치 파일·외부 게시(GUI-D9, 미승인), E-5·E-6 보류.

## 진행 요약 (CP-67, 2026-11-25~26) — 계약 층 분기 모두 비교, IR-26 앱 분할 끝, 엔진 2단계 U1~U3, H-1

- **사용자 결정(2026-11-25):** 계약 층 남은 분기 설계(claude-worker)의 Q-4에 "규칙으로 적기" — 제품 코드(`src/`, `gui/src/`)에 시험할 때만 읽는 환경 변수·플래그를 두지 않고, 시험 주입은 코드로 넘기는 선택지와 `tests/` 아래 preload로만 한다(`docs/development-workflow.md` 7절, `4bccd1c4`). 사용자가 다시 로그인해 claude-worker 주간 한도(11-29 21시 KST 해제 예정)와 무관하게 이어 썼다.
- **계약 층(설계 12절) 모든 분기 비교(`809cb4f2`, claude-worker 설계·구현, codex-worker 검토):** C-5 사람의 거부, C-6 질문 중 취소(CLI는 Ctrl+C → SIGINT, 호스트는 `cancelRun`), C-7 질문 대기 시간 한도(쪽마다 4초). 실제 CLI child를 기존 시험 preload(`isTTY`만 바꿈)로 띄워 실제 `main.ts` 질문·터미널 읽기·SIGINT 길을 지나게 하고 두 쪽 저장 result·journal을 엄격 비교 — 차이 없음. 제품 코드 변경 없음. 남는 한계: raw mode·echo는 흉내 내지 않음, C-7은 시간에 기댐, Windows에서만 측정. 현재형 문서는 `8242abb0`로 맞췄다.
- **GUI 실행 흐름 후속:** H-1(`883b0b12`, codex-worker 구현, claude-worker 검토) — 적용 결과가 앞 요청이 아니라 적용한 계획의 form(profile·workflow)을 쓴다. 재현에서 계획 프로필의 합성 가릴 값이 검토 메모에 남는 것을 확인(19건 중 15 실패 → 19/19). F-1·F-3(`511a5ea9`) — form 인자를 필수로, 시험 두 사례 추가.
- **IR-26 큰 파일 나누기(이동만, 단위마다 구현하지 않은 세션의 정적 검토, 합친 판마다 PM 전체 시험):**
  - 앱: 2a 읽기 문맥(`ddcb6c6a`), 2b 읽기 명령(`333ddccd`), `AppHooks` 형 파일(`5796d665`, 빌드 JS 동일), 3 보고서·되돌리기·실행 조회(`bd60ed2d`), 4 doctor·models·settings(`5526fb94`), 5a 계획 보기·검토(`9ea68544`), 5b 적용·적용 점검 한 덩어리(`0cb1fc18`), 쓰지 않는 import 정리(`fcb0a45f`). **앱 분할 끝: `app.ts` 1,247 → 300줄**(모듈 도우미, factory 조립, `startRun`, 26개 facade). 평가 순서를 지키는 부수효과 import에는 모두 주석을 달았다.
  - 엔진 2단계(claude-worker 설계 `engine-split-2-design-claude-01`, PM 결정 D-1~D-6): U1 상수만 쓰는 도우미 → `run-helpers.ts`(`ef3222d7`), U2 호출 id·권한 질문 → `run-calls.ts`(`3dfefccb`), U3 무결성·상태 점검 → `run-checks.ts`(`1ed48aea`, `sinceCheck` 소유와 `noteActivity`). `engine/index.ts` 1,792 → 1,074줄. 단위마다 기준·후보 빌드로 같은 대본을 돌려 결과·journal·경계 호출 bytes를 비교(U1 57, U2 73, U3 113개 모두 같음).
  - GUI 공유 IPC 1단계(`1f79c10b`): `shared/ipc.ts` 1,838 → 1,584줄, facade 157개 이름 그대로. 계약 `human.ts` 1단계(`f1b14834`): 고정 문구 표를 `human-messages.ts`로, 1,617 → 843줄.
  - 진행 중(branch): 엔진 U4 `RunTally`(`b7812382`), U5 도구 호출, IPC 2 설정·모델(`d859107a`), IPC 3a 실행 묶음.
- **PM 측정(합친 판마다 프로젝트 스크립트, 실패 0):** 마지막 `fcb0a45f`에서 unit 4,364건(4,357 통과·6 건너뜀·1 TODO), integration 684건(682 통과·1 건너뜀·1 TODO), GUI 582건(580 통과·2 건너뜀), 연기 시험 227/227. 부하로 한 번씩 실패한 시험 둘: n13 잠금(기록된 한계 Z-1, 재실행 통과), GUI `u298`(고정 40ms 대기 — `b0c6c8be`에서 "등록부의 끝까지" 기다리도록 고침). 로그는 `.codaryn/pm-tools/evidence/main-*`.
- **운영:** claude-worker가 주간 사용 한도에 한 번 걸렸다(작업 중 멈춤, 바뀐 파일 없음). 그 창에 자기 동작 버그 보고 초안(금지된 `git add -N` 실행)이 떴다 — 작업자 창 UI에는 답하지 않았고, 모든 작업 공간의 인덱스에 남은 항목이 없음을 확인했다. Codex 세션 ID 변동으로 도구 ACK가 거절되면 보고를 끝까지 읽고 해시를 확인한 뒤 수동 수신 기록을 남겼다.
- 남은 것: 엔진 U4~U7, IPC 2~4, 사용자의 꾸러미 화면 확인(M-3.19), 실제 API 3.1, 키 없는 수동 12항목, 서명·설치 파일·외부 게시(GUI-D9, 미승인), E-5·E-6 보류.

## 진행 요약 (CP-66, 2026-11-25) — Codex 작업자 추가, 개선 검토 A·B와 수정, IR-26 나누기 1단계

- **사용자 지시(2026-11-25):** "codex 작업 세션 추가했으니 교육 후 활용하고 codex 위주로 작업 할당해줘", 외부 검토 의견(IR-26 큰 파일, IR-27 libuv 변수 등의 끝부분)을 "참고해서 지너릭하게 적용". 사용자 결정: 받은 끝부분만으로 판단하지 않고 **Codex가 같은 형식으로 새로 검토**, 그 형식을 **개발 절차 문서에 검토 틀로 추가**, IR-A2(토큰 한도)는 **추가 요청만 금지(지금 동작) + 문서 고침**.
- **작업자:** codex-worker-2(w3:pK, Codex, 작업 공간 codex-verify)를 교육하고 통신 도구에 넣었다(`17563630`, 통신 시험 128/128). 작업자는 codex-worker(w3:pJ), codex-worker-2(w3:pK), claude-worker(w3:pH) 셋이고 구현은 Codex 우선, 검토는 구현하지 않은 세션이 맡는다.
- **검토 틀(`95e150e3`):** `docs/development-workflow.md` 8절 "개선 검토 보고 틀" — 발견 표(사실과 경로:줄, 동작 보존 제안, 등급), 이미 기록된 한계, 막혀 있음을 확인한 것, 역할별 배정, 재현 먼저, 금지 확인. 같은 커밋에 낡은 현재형 문장 셋과 IR-27(`docs/privacy.md`에 libuv가 넣는 여섯 변수)을 고쳤다. 아키텍처의 "AC n" 참조 규칙과 권한 질문의 현재 위치(`6c7e01d8`).
- **개선 검토 A(핵심 모듈, codex-worker)와 수정(`0903b857`, codex-worker-2 구현):** 검증 없는 실행이 마지막 답을 기록하는 중 취소·기한이 오면 `no_verifier`/`awaiting_review`로 끝나던 것을 공통 중단 검사 뒤로 옮겨 `cancelled`/`max_duration`으로 끝낸다. 승인된 실행 계획의 파일 확인이 기한을 포함한 실행 신호를 받는다. 토큰 한도는 지금 동작(도달하면 추가 요청 금지, 받은 응답은 처리)을 계약 주석과 문서에 적었다.
- **개선 검토 B(CLI·앱·저장·GUI·스크립트, codex-worker-2)와 수정:**
  - IR-B4·B5·B6(`7a55009d`, claude-worker 구현, codex-worker-2 검토): GUI 설정이 `maxRepairAttempts` 0을 받는다(그 필드만). CLI stdout 읽는 쪽이 사라지면(EPIPE) 실행의 저장 결과와 종료 코드를 그대로 두고 스택을 찍지 않으며, 그 밖의 stdout 쓰기 오류는 고정 한 줄과 종료 1. 그 상수는 `src/cli/stdout-failure.ts`에 두었다 — 처음 `guard.ts`에 둔 판은 PM 전체 시험에서 guard 이름 목록 고정 시험 1건을 깨뜨려 고정값을 바꾸지 않고 옮겼다. `scripts/review-branch.mjs`가 어떤 Git trailer든 거부하고 병합 커밋도 본다.
  - IR-B1·B2·B3(`742d1918`, codex-worker 구현, claude-worker 검토 두 번): GUI의 세 시작 처리기가 시작 예약 하나를 함께 써 동시에 둘이 시작되지 않는다. 결과의 다음 행동이 결과를 낸 폴더로 간다. 명령 찾기가 떠난 화면·옛 응답을 버린다. 검토 G-1(task 파일 실행 뒤 적용 결과가 지금 폴더로 감)을 재현(46건 중 9 실패) 뒤 고쳤다.
  - 남은 검토 의견: H-1(낮음, 개인정보 가능성[추정]) 적용 결과의 `last`가 적용한 계획의 form이 아니라 앞 요청의 form이라, 검토 메모의 가림이 계획의 프로필과 다를 수 있다 — 재현 먼저로 배정 예정. G-4(되돌리기 처리기가 시작 예약을 보지 않음, 기존)는 따로 판단.
- **IR-26 큰 파일 나누기(codex-worker-2의 설계 초안, 기능 수정과 분리, 단위마다 다른 세션 검토):**
  - 엔진 1단계(`bc017ae8`, codex-worker): 고정 모델 문구를 `src/engine/model-texts.ts`, 순수 판정·상수·내부 형을 `src/engine/pure.ts`로. `engine/index.ts` 1,792→1,542줄, 공개 export 같음, 공개 값 덤프 전후 bytes 같음(12,566 bytes). codex-worker-2 정적 검토 발견 0.
  - 앱 1단계(`6aa8422a`, codex-worker-2): `appRunHooks`를 본문 그대로 `src/app/run-hooks.ts`로. `app.ts` 1,247→1,146줄. claude-worker 정적 검토 채택(정보 A-1: 새 모듈의 `hooks`는 구조적 부분형이라 `AppHooks` 필드 이름이 바뀌어도 컴파일러가 알리지 않는다 — 다음 단계 참고).
  - 진행 중: 앱 2단계 첫 단위(읽기 문맥, codex-worker-2), GUI 공유 IPC 1단계(`gui/src/shared/ipc.ts` 1,838줄, codex-worker).
- **PM 측정(합친 판마다 프로젝트 스크립트):** `6aa8422a`에서 unit 4,364건(4,357 통과·6 건너뜀·1 TODO·실패 0), integration 684건(682 통과·실패 0), GUI 511건(509 통과·2 건너뜀·실패 0), 연기 시험 227/227. `742d1918`에서 unit·integration 같은 수치, GUI 557건(555 통과·2 건너뜀·실패 0; 실행 흐름 시험 46건 추가), 연기 시험 227/227. `bc017ae8`의 첫 integration에서 n13 잠금 시험 1건이 `doctor.lock.held`로 실패했다 — 다른 작업자 빌드가 겹친 부하에서 Windows 시작 시각 조회가 늦어 "알 수 없음 = 잡혀 있음"으로 판정하는 기록된 한계(`src/store/lock.ts` Z-1)와 맞고, 그 파일 단독 2/2와 integration 재실행 682/684·실패 0을 확인한 뒤 push했다. 로그는 `.codaryn/pm-tools/evidence/main-*`.
- **운영:** Codex 창의 세션 ID가 READY 뒤 바뀌어 도구 ACK가 거절되는 일이 되풀이됐다(engine-split-1, fix-gui-run-flow-codex-02 등). 보고를 끝까지 읽고 해시를 확인한 뒤 수동 수신 기록(`.codaryn/pm-tools/receipts/*-manual-ack.json`)과 이름 복구로 처리했다. Codex 보안 검토는 정적 검토로만 맡긴다(재현 코드 작성이 제공자 필터에 한 번 걸렸다).
- 남은 것: 사용자의 꾸러미 화면 확인(M-3.19), 실제 API 3.1, 키 없는 수동 12항목, 계약 층의 남은 세 분기, H-1, IR-26의 나머지 단계, 서명·설치 파일·외부 게시(GUI-D9, 미승인), E-5·E-6 보류.

## 진행 요약 (CP-65, 2026-11-24) — 계약 층 시험 넓힘, CLI 구조 문서 현행화, 문서 정리

- **사용자 선택(2026-11-24):** 남은 오프라인 코드 작업 가운데 "계약 층 시험 마저 채우기". PM이 앞 질문에서 CLI 구조 이행을 "앱 계층이 `src/cli` 파일 9개를 가져다 쓴다"고 설명했으나, 이는 낡은 문서를 따른 것이었다. 코드에는 `src/app` → `src/cli` 의존이 하나도 없다(아래). 사용자에게 정정했다.
- **계약 층 시험 채택(`d692e8d6`, worker `583047ff`):** `gui/tests/unit/cli-host-contract.test.ts`·`cli-host-contract-support.ts`. 실제 CLI child와 별도 실제 엔진 호스트 child로 같은 사례를 돌려 저장 result·journal 전체를 비교한다(CP53 정규화 그대로). C-1 검증 실패→재수정→통과, C-2 도구 호출 한도(각 쪽이 첫 호출만 실행, 두 번째 파일 없음, toolCalls 1), C-3 모델 요청 중 취소(CLI 취소 파일 ↔ 호스트 `cancelRun`, 요청 기록 뒤의 취소까지만 보인다), C-4 답 없는 권한 질문(두 쪽 모두 `deny`/`by: "default"` 두 번, 시험 안 루프백 가짜 API — PM이 허용, 바깥 연결 0, 경로 치환 0을 단언, 가짜 키 부재를 불리언으로 단언). 두 쪽 차이는 발견되지 않았다. claude-worker 구현 → codex-worker 독립 검토 H0/M1(C-2가 같은 위반을 놓칠 수 있음)/L2/정보1, 사본 독립 실행 4/4 → 보완(PM 검토). PM 환경 GUI 507건(505 통과·2 건너뜀·실패 0), 연기 시험 227/227.
- **설계 12절의 남은 계약 분기:** 사람의 거부(`by: "user"`), 질문 중 취소(`by: "cancelled"`), 질문 대기의 시간 한도(`max_duration`)는 CLI 자식을 터미널 없이 띄우는 지금 방식으로 만들 수 없어 비교하지 않았다(시험 머리 주석). 12절 계약 층은 **전부 완료가 아니다.**
- **CLI 구조(DR-65) 문서 현행화(`dd8210d0`, worker `7ddac9d5`):** codex-worker가 코드로 확인했다: `src/app` 66개 파일에서 CLI를 향한 정적·동적 import·require·경로 문자열 의존 0, CLI는 실행 준비·조립·수명, 보고·되돌리기·실행 목록, doctor·models·init의 공통 core를 앱과 공유. 이행 2의 원래 단일 공개 창구(`startRun`) 형태와 CLI 고유 인자·질문·출력은 남는다. architecture·roadmap·progress의 "앱 계층 이행 덜 됨", "앱의 아홉 파일이 `src/cli`를 씀(AC-D16)" 같은 현재형을 고쳤다(날짜 붙은 기록은 그대로).
- **그 밖의 문서 정리:** 실제 API 점검 설명(`4f0922c1`, `6643d54c`), GU-9 문서 현행화(`32cfe154`), DR-63 현황과 계약 층 시험 한 사례(`2274e446`, `944e0e82`), 권한 질문의 옛 절 번호 "AC 5.7" → 어댑터 계약 5.9(`d692e8d6`에 포함).
- **운영:** codex-worker 창의 Codex 세션 ID가 READY 직후 두 값 사이를 다시 오갔다(contract-review-codex-01). 수동 ACK와 이름 복구로 처리했다(`.codaryn/pm-tools/receipts/contract-review-codex-01-manual-ack.json`).
- 남은 것: 사용자의 꾸러미 화면 확인(M-3.19), 실제 API 3.1, 키 없는 수동 12항목, 계약 층의 남은 세 분기, 서명·설치 파일·외부 게시(GUI-D9, 미승인), E-5·E-6 보류.

## 진행 요약 (CP-64, 2026-11-24) — GU-9 꾸러미 스크립트 채택, 첫 로컬 꾸러미와 PM 자동 점검

- **꾸러미 스크립트 채택(`27115387`, worker `8f5d450d`):** `npm run package -- --electron-zip-dir <폴더> --node-exe <node.exe> --node-license <LICENSE>`. 입력은 파일 접근 전에 로컬 경로 규칙(UNC·장치 거부)으로 검사하고 Electron zip·node.exe·Node LICENSE를 SHA-256으로 고정, 내려받지 않음(`electronZipDir`, `download` 없음), packager 임시 폴더를 자기 준비 폴더 안으로 한정(packager 기본값은 `%TEMP%\electron-packager`를 통째로 지움), 빌드 파일은 허용 목록(확장자·위치, 숨은 이름 거부)으로만 고르고 그 밖의 파일이 있으면 멈춤, 복사본을 앱의 시작 확인으로 다시 대조, fuse 9개를 strict로 설정하고 다시 읽음, 산출을 덮어쓰지 않음, 기록 파일은 끝까지 성공한 실행만 마지막에 남김. 시작 확인은 꾸러미 루트 `package.json`(이름 `codaryn`)까지 포함해 엔진의 `installDir`이 꾸러미 폴더 전체가 된다. claude-worker 구현 → codex-worker 독립 보안 검토 H0/M3/L1 → 보완 → 재검토 L1 → 보완(PM 검토). PM 환경 GUI 503건(501 통과·2 건너뜀·실패 0), 연기 시험 227/227. main 위 patch가 worker patch(`4e526949`)와 같다.
- **첫 로컬 꾸러미(사용자 승인 D-8b, 2026-11-24):** claude-gui 작업 공간에서 한 번 실행, 종료 0. 산출 `gui/out/Codaryn-win32-x64/`(파일 300개), zip 197,946,337 bytes·SHA-256 `46a7aa711f0a587dba1b160a969a2b854f76d106e24ef6de291f44d4c10b3918`, 엔진 목록 225개(SHA-256 `d0e8983c…`). app.asar 89항목에 시험·`.map` 없음, 목록 있음. fuse: RunAsNode·NODE_OPTIONS·CLI inspect·file 추가 권한 끔, asar 무결성·asar에서만 읽기 켬, 나머지 셋은 바이너리 기본값(쿠키 암호화 끔, 브라우저 전용 스냅숏 끔, Wasm trap handlers 켬). 네트워크 없음. 기록·로그는 `.codaryn/pm-tools/evidence/gu9-run/`.
- **PM 자동 점검(D-9, 사용자 결정 "PM 자동 점검 + 사용자 화면 확인"):** 설정·프로필 폴더를 시험 폴더로 돌려 실행. 정상 시작: 엔진이 `resources\node\node.exe`로 뜸, TCP 대기 0·UDP 0. `ELECTRON_RUN_AS_NODE=1`: 무시되고 앱이 정상 시작. `--inspect`·`--inspect-brk`·`--remote-debugging-port`: 시작 검사로 종료 코드 2(`--inspect-brk`도 이제 막힘). `NODE_OPTIONS=--inspect`: 앱은 정상 시작하나 검사기 포트가 열리지 않음(fuse가 무시하고 엔진 호스트에도 넘기지 않음; 시작 검사가 그 값을 보지 못하는 것은 관찰한 동작). 엔진 파일 변조 사본: 앱은 떠 있으나 엔진을 띄우지 않음. app.asar 변조 사본: Electron이 `Integrity check failed for asar archive`로 즉시 종료 — **asar 무결성 fuse의 Windows 효과를 실행으로 확인했다**(E-4의 미확인 해소). 결과 `.codaryn/pm-tools/evidence/gu9-check/results.json`.
- **남는 것:** 사용자 화면 확인(키 없이 시작했을 때 점검 표시, 변조 사본의 오류 문구), 문서 현행화(제안서 상태, 설계 6.7·13.2 E-4, 사용 안내), 서명·설치 파일·외부 게시(GUI-D9, 미승인). D-7의 남는 경계(비원자성, TOCTOU, 하드 링크, 목록 밖 Electron 런타임은 asar 무결성에 기댐)는 그대로다.

## 진행 요약 (CP-63, 2026-11-24) — GU-9 D-7 채택과 꾸러미 결정

- **D-7 채택(`9c373178`, worker `466450a7`):** 꾸러미 앱(`app.isPackaged`)은 `resources/node/node.exe`, `resources/engine/build/src/engine-host/main.js`, `resources/engine/dist/src`로 엔진 호스트를 띄우되, 그 전에 app.asar 안 `engine-manifest.json`과 대조한다: 두 트리의 파일 집합(빠짐·남음), 크기, SHA-256, 순회 때 기록한 파일 정체성(dev·ino·size)과 연 핸들의 비교, 같은 핸들에서의 해시, 모든 해시 뒤 두 번째 순회. 하나라도 다르거나 링크·junction·특수 항목·Windows 별칭 이름(끝 점·공백, 장치 이름, 8.3 짧은 이름 모양)이 있으면 `engine_integrity_failed`로 엔진을 띄우지 않는다. 개발 모드 경로는 그대로다. 남는 경계: 원자적이지 않음(검사 중 교체 후 되돌림, 검사 뒤 TOCTOU), 하드 링크 구별 안 함, 목록은 asar 무결성 fuse에 기대며 Windows 효과 미확인, 목록과 파일을 함께 바꾸는 공격자는 막지 못함, 시작마다 전체 해시(시간 미측정).
- **검토:** claude-worker 구현 → codex-worker 독립 보안 검토 H0/M1(검사 중 경로 재열기)/정보3 → 보완 → 재검토 M1 닫힘·L1(8.3 판정이 정상 긴 이름까지 거부) → 보완(PM 검토). 첫 검토 중 codex-worker의 출력 일부가 서비스 쪽 사이버보안 필터에 막혀, 경합 재현 없이 정적 검토로 마치게 했다. 작업자가 첫 구현 때 `git add -N`(intent-to-add)을 실행했다고 스스로 보고했다(내용 stage 없음, 영향 없음, PM이 커밋 때 정리). PM 환경 최종: GUI 473건(472 통과·1 건너뜀(파일 심볼릭 링크 EPERM)·실패 0), 연기 시험 227/227. main 위 patch가 worker patch(`008c361f`)와 같다.
- **사용자 결정(2026-11-24):** D-8b 꾸러미 스크립트를 만들고 이 PC에서만 실행(내려받기 없음, `electronZipDir`; D-4b = 내려받지 않음), D-5b Node 26.13.1 `node.exe`와 LICENSE 묶기, D-6 설계 6.7의 여섯 fuse + `strictlyRequireAllFuses`, 나머지 셋(`EnableCookieEncryption`, `WasmTrapHandlers`, `LoadBrowserProcessSpecificV8Snapshot`)은 Electron 기본값, 설치 폴더 보호 범위는 꾸러미 폴더 전체(루트 `package.json` 이름 `codaryn`, 그 파일도 해시 확인). 서명·설치 파일·외부 게시는 포함하지 않는다.
- **진행 중:** 꾸러미 스크립트와 확인 범위 확장(claude-worker, branch `gu9/package-script`). 실제 꾸러미 실행은 독립 보안 검토 뒤 PM이 한 번 한다. 꾸러미 앱 확인 기준(D-9)은 그 뒤에 묻는다.

## 진행 요약 (CP-62, 2026-11-23~24) — GU-9 의존성 설치와 꾸러미 입력 확인

- **사용자 결정(2026-11-23~24, 제안서 11절):** D-1 `@electron/packager` 20.3.0 추가, D-2 `@electron/fuses` 2.1.3 추가, D-3a lock 해석, D-3b 작업 공간에만 설치와 `npm audit signatures` 1회, BlueOak-1.0.0 원문 1회 조회, lock의 main 채택, D-7 진행(시작 때 해시 확인), D-4a는 PM이 캐시의 Electron zip 하나만 확인, D-5a는 설치된 node.exe와 Node LICENSE 원문 1회 조회. **꾸러미 만들기(D-8b), fuses 적용, Node 묶기(D-5b), 배포는 아직 승인 전이다.**
- **lock(D-3a):** claude-worker가 `gui`에서 `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`를 한 번 실행했다. 새 40개(전체 53), 모두 npm 레지스트리·sha512·설치 스크립트 없음·dev, 기존 13개는 한 필드도 바뀌지 않았고, `engines`는 모두 Node 26.13.1과 맞는다. 관찰한 사실: 이 명령은 `node_modules/.package-lock.json`에도 설치되지 않은 두 패키지를 적었다(제안서의 "lock만 쓴다"는 추정과 다름). 작업자가 멈춤 조건대로 멈췄고, PM이 그 파일을 증거로 옮겼다. codex-worker 독립 검토 H0/M0/L0/정보3.
- **라이선스:** review 6개는 모두 `@electron/asar` 경로의 BlueOak-1.0.0(glob 14.0.6, minimatch 11.0.9, lru-cache 11.5.3, minipass 7.1.3, path-scurry 3.0.0, @isaacs/nonrecursive-glob-match 1.1.0)이다. `graceful-fs`는 4.2.11 ISC로 남았다. PM이 SPDX 원문(SHA256 `8a1af140…`)을 읽었다: 저작권·특허를 철회할 수 없게 허락하고, 조건은 사본을 줄 때 라이선스 글이나 링크를 함께 주는 것 하나다. 배포물에 들어가지 않는 개발 도구이므로 지금 고지 의무는 없고, 배포물에 들어가게 되면 그 조건을 지킨다(DR-75의 원문 확인 절차). 허용 목록 자체는 바꾸지 않았다.
- **설치(D-3b):** 같은 작업 공간에서 `npm install --ignore-scripts --no-audit --no-fund` 한 번(`npm ci`는 node_modules를 지워 Electron 실행 파일을 없애므로 쓰지 않음): 40개 추가, `electron/dist` 73개 파일이 바이트까지 그대로, 추적 파일 변화 없음, 53/53 경로·판 일치, 새 숨은 lock은 실제 설치와 맞음, `check-lock` 통과. `npm audit signatures`: 53개 레지스트리 서명 검증, 14개 증명 검증, 실패 0. PM 환경에서 그 작업 공간의 GUI 시험 440/440, 연기 시험 227/227 통과. 채택 `1dce881d`(tree `9c64aa0b`).
- **packager의 Electron 경로(제안서 5.2, 설치된 소스로 확인):** `electronZipDir`가 있으면 `<폴더>/electron-v45.3.1-win32-x64.zip`을 그대로 쓰고 `@electron/get`을 부르지 않는다(내려받기·체크섬 대조 없음). 없으면 사용자가 준 `download` 옵션만 넘겨 기본 캐시를 쓰고, 원격 `SHASUMS256.txt`를 받아 대조한다(캐시가 있어도 네트워크). 그래서 내려받기 없는 꾸러미는 `electronZipDir`과 사전 SHA-256 확인으로 한다.
- **꾸러미 입력(Git 밖, `D:/project/Codaryn/.codaryn/gu9-inputs/`):** Electron zip은 GU-1 때의 캐시에 있었고 SHA-256 `d92d1aa4…`(패키지의 `checksums.json`과 같음), 158,352,921 bytes. 전용 폴더로 복사해 다시 쟀다. Node는 설치된 `C:\Program Files\nodejs\node.exe`가 공식 `win-x64/node.exe`와 SHA-256 `f5109dc8…`로 같다. Node v26.13.1 LICENSE(SHA256 `8e603aa8…`, 2,923줄)는 MIT 본문과 제3자 고지(BSD·Apache-2.0·ICU 등)이고, GPL 표기는 ICU4C 빌드 스크립트(aclocal.m4, config.guess)의 Autoconf 예외 조항뿐이라 node.exe와 함께 LICENSE를 그대로 두면 된다는 것이 PM 판단이다.
- **증거:** `.codaryn/pm-tools/evidence/gu9/`(raw 25, 작업·검토 보고, 숨은 lock, BlueOak 원문, 목록 `SHA256SUMS.txt` 79행)와 `.codaryn/pm-tools/evidence/gu9-install/`(PM의 빌드·시험 기록).
- **진행 중:** D-7 코드(claude-worker, branch `gu9/packaged-engine`): 꾸러미 앱에서 `resources/node`·`resources/engine`을 쓰고, app.asar 안 목록으로 시작 전에 파일 집합·크기·SHA-256을 확인해 다르면 엔진을 띄우지 않는다.

## 진행 요약 (CP-61, 2026-11-23) — GU-9 꾸러미 승인 제안서 채택

- **제안서 채택:** [`docs/design/gu9-packaging-proposal.md`](design/gu9-packaging-proposal.md). 사용자가 승인한 메타데이터 조회(curl 25회: npm 레지스트리, nodejs.org, README 원문)로 `@electron/packager` 20.3.0(BSD-2-Clause, 직접 의존성 17, 설치 스크립트 없음)·`@electron/fuses` 2.1.3(MIT, 의존성 0)의 sha512·tarball 주소, Node v26.13.1 win-x64 zip SHA-256 `e2edda75…`, 명령·산출·검증·비용·DR-75 고지, 사용자 결정을 적었다. Electron zip의 기본 주소·캐시 위치·체크섬 대조는 설치된 `@electron/get` 소스로 확인했고, packager의 내려받기 동작은 미확인이라 "승인 전 확인 단계"로 분리했다. claude-worker 작성, codex-worker 독립 검토 H0/M1/L2/정보4(값 173건 중 172 일치) → 보완 → 재검토 H0/M0/L1(구현 보고서의 집계 21→20 오기만, 제안서 본문 영향 없음). PM이 원문 대조(해시·integrity·Node SHA·캐시 폴더 해시)를 따로 했다. worker `f46c2e4e`, 채택 `01cbe538`(main 위 patch가 검토한 patch `89b3618a`와 같다). PM 후속: pm-status 줄 인용을 체크포인트 이름(CP-54)으로 바꾸고 설계 색인에 넣었다.
- **설치·내려받기·꾸러미 만들기·서명·게시는 여전히 미승인이다.** 승인 질문은 제안서 11절 순서대로 하나씩 묻는다. 먼저 lock에 올 패키지와 라이선스를 보려면 D-1·D-2(의존성 추가) → D-3a(lock 해석) 순서다.
- **통신 도구 기록:** `gu9-rereview-codex-01`은 READY 뒤 Herdr가 w3:pJ의 Codex agent_session을 새 값으로 보고하고(같은 terminal, 화면 대화는 이어짐) pane 이름을 지워, 도구가 ACK를 거부했다(`ACK_NOT_READY`, identityVerified false). assignment·started·ready는 모두 등록된 session digest로 남았다. PM은 도구를 우회하지 않고 보고 본문·해시를 확인한 수동 ACK를 `.codaryn/pm-tools/receipts/gu9-rereview-codex-01-manual-ack.json`에 남겼고, 이름을 다시 붙였다. 다음 codex-worker 작업은 새 session으로 등록된다.

## 진행 요약 (CP-60, 2026-11-23) — 실제 API 실행 계획 채택과 첫 사용자 결정, 문서 사실 보정

- **통신 도구 실제 사용:** 채택한 도구로 두 작업자의 작업 6건을 register → dispatch → 명시 prompt → started/ready → poll → ack 순서로 돌렸다. 모두 identityVerified·sessionBound였다.
- **문서 사실 보정(PM 검토 작은 단위):** `docs/roadmap.md:34`·`docs/testing.md` 1절·4절이 실제 API 점검을 문서 작업 하나와 HTTP 8회로 적고 OpenAI 점검을 빠뜨렸던 것을 지금 파일(Anthropic 작업 둘 최대 16회·60,000토큰, OpenAI 점검 셋 최대 10회·40,000토큰)에 맞췄다. `docs/development-workflow.md:105–106`은 공용 pre-commit 훅이 설치된 것처럼 적었으나 공용 hooks 폴더에는 샘플만 있어(PM 확인) "설치하면"과 "훅이나 PM의 staging 검사에서 거부"로 고쳤다. claude-worker 구현, PM이 소스·README·package 스크립트와 대조. 채택 `4f0922c1`(tree `3377d0ed`), `6643d54c`(tree `ca4d1947`).
- **실제 API 실행 계획 채택:** [`docs/acceptance/live-api-plan.md`](acceptance/live-api-plan.md). 단계 1b·2·3에서 사용자가 직접 할 명령, 연습 폴더 격리, 상한, 결과를 돌려줄 형식(PASS/FAIL/NOT_RUN), 사용자 결정 D-1~D-11. claude-worker 작성, codex-worker 독립 검토 H0/M0/L2/정보3(인용 139곳 위치 전부 맞음) → 보완(한도 초과 관찰은 task와 설정을 함께 낮춤, `run --json`, D-6을 D-6a·D-6b로, 단계 3은 D-8 전 미실행) → PM이 보완분 전부 읽음. 채택 `a82f8a19`(tree `5a11343b`). 아무것도 실행하지 않았다.
- **사용자 결정(2026-11-23):** D-1 이번 실행 범위는 3.1(Anthropic 점검)만 먼저, D-4 OpenAI 점검은 이번에 뺌, D-5 상한은 코드에 고정된 점검 상한 그대로(금액 한도 없음). 나머지 D-2·D-3·D-6~D-11은 3.1 결과 뒤 또는 실행 직전에 묻는다. 실제 실행은 사용자가 한다.
- **진행 중:** GU-9 꾸러미 승인 제안서는 codex-worker 독립 검토 H0/M1/L2/정보4(값 173건 중 172 일치)를 받아 claude-worker가 보완 중이다. M1은 Electron zip 재다운로드 주소와 packager 캐시·체크섬 동작이 미확인인 채 실행 승인을 묻던 점이다. 설치·내려받기·꾸러미 만들기는 여전히 미승인이다.

## 진행 요약 (CP-59, 2026-11-22~23) — 새 작업자 둘과 교육, 문서 현행화·통신 도구 채택

- **작업자 교체(사용자 결정, 2026-11-22):** 세션 재시작 뒤 사용자가 Claude w3:pG의 오케스트레이터 역할을 다시 확인했다. 새 세션 둘을 작업자로 쓴다: codex-worker(`w3:pJ`, Codex)와 claude-worker(`w3:pH`, Claude Code). codex-review를 포함한 옛 Codex 세션 여섯은 없다. 통합·커밋·푸시는 계속 현재 PM만 한다. PM이 w3:pJ에 Herdr 이름 `codex-worker`를 붙였다(w3:pH는 이미 `claude-worker`).
- **사전 교육:** 교육 자료 `.codaryn/pm-tools/onboarding-20261122.md`(지침·절차 문서 목록, 금지 규칙, 이해 확인 질문 14개). 두 작업자 모두 14개 답이 정확해 통과했다(codex-worker 보고 `9e24382f…`, claude-worker 보고 `b307a36d…`, 수동 ACK). 질문 14에서 찾은 낡은 현재형 문장은 아래 문서 현행화로 넘겼다.
- **문서 현행화 채택:** `AGENTS.md`, `docs/README.md`, `docs/development-workflow.md`, `docs/operations/pm-handoff-2026-11-15.md`, `docs/personas.md`, `docs/unit-test-plan.md`의 현재형 문장을 지금 사실(active 위임 PM, 두 작업자, 최신 체크포인트)로 맞추고 날짜 붙은 기록은 그대로 두었다. claude-worker 구현, codex-worker 독립 검토 H0/M0/L0(정보 4: 일부러 남긴 문장의 판단이 타당). worker `a4890e31`, 채택 `a6b212c3`(tree `13fa8982` 일치). 깨진 상대 링크는 49개 그대로(새 링크 2).
- **세션 통신 도구 채택:** `scripts/pm-session-comms.mjs`의 새 등록·재개를 codex-worker(w3:pJ, agent codex)와 claude-worker(w3:pH, agent claude)만 받게 했다. 옛 다섯 이름은 닫힌 기록 확인용으로만 남고, 옛 이름 기록은 git을 부르기 전에 작업 공간 범위를 검사한다. PM 전송 신원(codex-review/w3:p3)은 그대로이고 Claude 작업자에게는 어느 경로에서도 prompt를 보내지 않는다. codex-worker 구현, claude-worker 독립 검토 H0/M0/L2(L1 검사 순서, L2 문서 시제) → codex-worker 보완(회귀 시험 5개 추가) → PM이 보완분을 읽고 PM 환경에서 111/111 통과를 확인했다. worker `33749851`, 채택 `1c6f5751`(main에 놓인 patch가 검토한 patch `2705b6c7`과 같다). 채택 뒤 실제 file-only poll: 등록 43건 중 ACK closed 42건, 폐기된 `comm-live-loop-01`은 예상대로 `CHECKOUT_MISMATCH`. 첫 실제 등록·dispatch(codex-worker의 `live-plan-review-codex-01`)가 성공했다. 결과는 `.codaryn/pm-tools/evidence/poll-after-comms-adopt.json`.
- **운영 메모:** Codex 샌드박스는 다른 작업 공간에 git을 쓸 때 소유권 검사로 승인 창을 띄운다. 이후 검토 작업은 PM이 후보 사본을 검토자 자기 작업 공간의 `.codaryn/review-packets/`에 둔다. 작업자 화면의 승인·한도 창에는 PM이 답하지 않고 사용자가 처리한다.
- **진행 중:** 실제 API 실행 계획 초안 `docs/acceptance/live-api-plan.md`(claude-worker 작성, 사용자 결정 D-1~D-11 포함, codex-worker 검토 중). GU-9 설치 꾸러미 승인 제안서(claude-worker 작성 중; 2026-11-23 사용자가 버전·체크섬 메타데이터의 웹 조회만 승인했고, 설치·내려받기·꾸러미 만들기는 여전히 미승인).
- 남은 것: E-5·E-6 보류, E-7은 실제 API 경계. 키 없는 Windows 수동 12항목 NOT_RUN(패킷 v2 준비됨), 실제 API·GU9/DR67 설치·서명·게시·역사적 한계(U333 u22, U321 경합, JSON pin) 그대로.

## 진행 요약 (CP-58, 2026-11-15) — 저장소 정리, CLAUDE.md 현행화, 수동 점검 패킷 v2

- **저장소 정리(사용자 결정):** 다른 추적 파일이 이름으로 가리키지 않고 묶음 와일드카드(`2026-11-12-cross-review-*`, `f6-review-*`, `m-review-*`, `2026-11-13-v*-codex-*`)에도 속하지 않는 `docs/reviews/` 원문 126개와 옛 지침 사본 `docs/guidelines.md`, 옛 인계 `docs/session-handoff.md`를 지웠다(128개). 날짜만 있는 넓은 와일드카드는 보관 위치 설명으로 보고 `docs/README.md`의 reviews 행에 archive 안내를 넣었다. PM이 목록을 만들고(`.codaryn/pm-tools/evidence/cleanup/reviews-delete-manifest.txt`, SHA256 `60e17abd…`), codex-check가 파일마다 blob을 대조한 뒤 지웠다. PM이 지운 집합이 목록+2와 정확히 같음, 그 밖의 staged 변경 0, 링크 검사(깨진 상대 링크 93→49, 새로 깨진 것은 남긴 옛 검토 `2026-11-13-source-docs-drift.md`의 `../guidelines.md` 하나), unit 4347/fail 0·integration 684/fail 0을 확인했다. worker `18fb6bcf`, 병합 `461185f2`(tree `b7ee4514` 일치). 전문은 private `Codaryn-archive`에 있다.
- **CLAUDE.md 현행화(사용자 확인):** "관리자는 Codex·푸시는 Codex·현재 단계 1a"를 지우고, 관리 권한은 `docs/pm-control.json`의 active 위임 PM, 현재 단계는 이 문서의 최신 체크포인트, 실제 API·키 조회는 사용자 승인 범위에서만, 어떤 trailer도 금지·amend/force push/이력 재작성 금지·푸시는 현재 PM만으로 맞췄다. AGENTS.md에 이미 있는 규칙만 옮겼다.
- **키 없는 Windows 수동 점검 패킷 v2:** `D:/project/Codaryn/.codaryn/manual-packet-v2/`(Git 밖). 현재 제품 빌드(tree `0ef2d46e`, 새 main과 제품 소스 같음)를 복사해 572개 파일(Node·Electron은 v1과 같은 해시)을 고정했다. M-3.12~3.17용 작업 공간 `edit-ws`(`masked.txt` 포함)·`edit-config.json`과 실행 모드 `gui-edit`(가짜 가릴 값 등록)을 더해 M-3.17까지 실행할 수 있다. 실행기 `info`만 확인했고 제품은 시작하지 않았다. 12항목 모두 NOT_RUN. 영수증 `.codaryn/pm-tools/receipts/keyless-manual-v2-seal.json`. v1 temp 패킷은 그대로 두었다.

## 진행 요약 (CP-57, 2026-11-15) — 새 저장소로 시작, E-2·E-4(DR-76)·E-3(DR-77) 채택

- **저장소 재시작(사용자 결정):** 이력이 과도하게 많아 지금 상태를 시작점으로 삼았다. 사용자가 기존 GitHub 저장소를 `gangdonggilstudy/Codaryn-archive`(private)로 바꾸고 새 `gangdonggilstudy/Codaryn`을 만들었다. 새 저장소는 GitHub의 첫 커밋 `76620ad5`(LICENSE만, 우리 LICENSE와 같은 blob `261eeb9e`) 위에 `9e28e301`로 시작한다. 그 tree `2638c3e5`는 archive의 main `5b7946cd` tree와 같다. force push·이력 재작성은 하지 않았다. **이 문서와 다른 문서에 적힌 그 이전의 커밋 해시는 모두 `Codaryn-archive`의 이력을 가리킨다.** 로컬에는 fetch 전용 원격 `archive`(push 막음)를 두었고, 원격의 병합된 옛 브랜치 10개는 사용자 지시로 지웠다(이름·SHA는 `.codaryn/pm-tools/evidence/remote-branches-deleted-20261115.txt`). 로컬 브랜치와 worktree의 옛 브랜치는 그대로 두었고, 새 작업 브랜치는 새 main에서 만든다.
- **E-2 채택(시험 코드만):** GUI 프로세스 시험 도우미 `isolatedEnv`가 자식 환경을 허용 목록(Windows `SystemRoot`·`WINDIR`, 최소 PATH, 시험 폴더 안의 설정·임시 위치)으로만 만든다. codex-loop 구현, codex-sec 독립 검토 H0/M0/L0, GUI 전체 438/438. archive `3ab78fca`.
- **E-4 채택(DR-76, 사용자 결정):** `data_checks`가 원본·결과표마다 서로 다른 묶음 키 10,000개까지만 담고, 넘으면 그 규칙은 `inconclusive`(넘을 때만 안내). 16MiB 표 상한은 그대로. 측정(codex-probe): 16MiB 안 약 231만 묶음에서 RSS 약 1.63GiB였다. codex-check 구현, codex-audit 독립 검토 H0/M0/L0. archive `586ab6aa`.
- **E-3 채택(DR-77, 사용자 결정):** 사람용 Markdown 보고서를 한국어가 전달될 때만 한국어로 만든다. CLI `report`는 `CODARYN_LANG` → OS 언어, GUI 보고서 저장은 창 언어, 생략하면 영어다. JSON·기록·종료 코드·기존 영어 출력과 공개 표면(C11/V55)은 그대로다. 1단계(언어별 core·한국어 단어표, codex-loop 구현, codex-probe 독립 검토 H0/M0/L1 → 자기 속성 조회로 보완)는 archive `5b7946cd`, 2단계(연결·문서, 189줄 PM 검토 단위)는 새 저장소 `e14d1a88`.
- **PM 측정:** 작업자 환경에서는 전체 unit이 멈추거나 integration의 프로세스·시간 시험(A8, A9, F5, n13)이 실패했다. PM 환경에서 같은 프로젝트 스크립트로 base와 후보를 재면 모두 실패 0이었다(예: E-3 2단계 후보 unit 4347/4340 pass/0 fail/6 skip/1 TODO, integration 684/682/0/1/1, GUI 440/440). 작업자 환경의 실패는 그 셸의 프로세스·임시 폴더 권한 문제로 보며 원인을 확정하지는 않았다. 로그는 `.codaryn/pm-tools/evidence/`(e4, e3a, e3b)에 있다.
- **PM 실수 기록:** E-4 배정 때 codex-check 화면에 사용 한도 선택 창이 떠 있었는데 입력 확인 결과를 전송 조건으로 쓰지 않아, 그 Enter가 모델 전환을 고른 것으로 보인다(이후 GPT-6-Luna). 이후 모든 전송은 입력 줄과 선택 창 부재를 확인한 뒤에만 한다. 한도·모델 선택은 사용자가 처리했다.
- 남은 것: E-5(GUI 프로필 편집)·E-6(들여쓰기 키)은 사용자 결정으로 보류, E-7은 실제 API 경계. 키 없는 Windows 수동 12항목 NOT_RUN(M-3.17 4단계는 패킷 보완 필요), 실제 API·GU9/DR67·역사적 한계 그대로. Codex 주간 한도 약 6%.

## 진행 요약 (CP-56, 2026-11-15) — 고도화 검토, E-1 문서 현행화, 라이선스 결정 DR-75 채택

- Claude PM(w3:pG)이 활성화 뒤 기존 Codex 다섯에게 새 PM·STOP 유지·PM 전용 push·무trailer를 직접 통지했고 다섯 모두 확인 응답했다. 키 없는 수동 패킷 4파일 해시가 seal과 일치함을 확인하고 원 점검표 12항목 본문을 읽었다. 패킷의 editor 폴더에 M-3.17 4단계용 `masked.txt`와 가릴 값 설정이 없어 그 단계는 이 패킷으로 실행할 수 없다(NOT_RUN 유지, 보완은 별도 결정).
- 사용자 요청 "고도화 작업 검토"로 enhancement-review-check-01(codex-check)을 등록·회수·ACK했다. 후보 7개: E-1 개인정보 집계 안내 문서 불일치(O/P1), E-2 GUI 프로세스 시험 도우미의 호스트 환경 전달 축소(O/P2), E-3 Markdown 보고서 한국어화(U, 사람용 고정 출력 변화), E-4 data_checks 고카디널리티 메모리 예산(U), E-5 GUI 프로필 내용 편집(U), E-6 텍스트 편집 들여쓰기 키(U), E-7 read_file 줄 범위·여러 곳 바꾸기(X, 실제 모델 점검 뒤). PM이 O 후보의 근거 줄을 target blob에서 직접 확인했다.
- E-1 채택: usage.md 16절·privacy.md 13절·standalone-gui.md 152–153줄의 "집계 도구 없음" 문장을 현재 사실(`unreadablePaths`+`analyze-private`/`query_table`, 보장은 행 비전송뿐)로 고쳤다. 과거 결정 표는 이력으로 두었다. 3파일 +4/−4의 작은 문서 단위라 DR-64 관행대로 PM이 diff를 검토했다. worker `d4a2e412`, 병합 `53497ce0`(tree `e9ffd0d0` 일치, staged 공백·비밀 검사 0).
- 사용자 요청 라이선스 검토 license-policy-review-sec-01(codex-sec)을 회수·ACK했다. 현재 의존성 36개(루트 23·GUI 13 lock 항목)는 모두 MIT·ISC·Apache-2.0이며 유료·비상업 조건을 찾지 못했다(법률 의견 아님). 사용자가 2026-11-15 지침 반영·허용 기준·README/NOTICE 표기(Copyright 2026 gangdonggil)·비차단 lock 목록 스크립트를 결정했다(**DR-75**).
- DR-75 채택: codex-loop 구현과 OR 식 분류 보완(정책 문서와 일치하도록 PM 판단: OR은 거부 아닌 대안이 있으면 검토, AND·WITH에 거부 계열이 있으면 거부), codex-audit 독립 검토 **H0/M0/L0**. 12파일 +265/−6, LICENSE 무변경. worker `4b50f696`, 병합 `1421a922`. main이 base `97964ef7`에서 E-1로 움직였으므로 staged 병합 patch가 후보 patch와 byte 동일함을 확인했다. 시험 6/6, 실제 lock allow36/review0/deny0, GUI lock 검사 0, staged 공백·비밀 검사 0. 모든 새 커밋 작성자·committer gangdonggil, trailer 0.
- 남은 것: E-2는 다음 O 후보, E-3~E-6은 사용자 결정 대기, E-7은 실제 API 경계. 12 수동 항목 NOT_RUN, 실제 API·GU9/DR67·역사적 한계는 그대로다. Codex 주간 한도가 약 12%라 배정을 좁게 유지한다.

## 진행 요약 (CP-55, 2026-11-15) — 사용자 요청 Claude PM 재위임·codex-review 일반 작업자 전환

- Claude가 명시 **ACK pm-20261115-claude-01**로 인수했고, 필수 문서의 실제 읽은 범위·완료/미실행/한계·소유권·통신 전환·무trailer 금지를 자기 말로 확인했다. ACK 화면 원문 SHA256 8d5a3fbc29645416bdbc22be344c62dce9594e1e2b0930d2c1a8dc139b727376와 인수 기록은 .codaryn/pm-tools/claude-handoff-20261115/에 보존한다. 큰 설계의 관련 절을 읽은 것과 수동 점검표 본문/외부 temp 패킷은 아직 읽지 않은 것을 구분했고 후자는 활성화 뒤 수신자가 이어서 확인한다. pm-control은 새 ID·실제 owner로 active로 전환했다.
- 최신 사용자 지시로 실제 조회한 Claude **w3:pG/session9d6ad963-02c1-4d06-848f-f3c59b3a04e9**에게 [전체 업무](operations/pm-handoff-2026-11-15.md)를 인계한다. 위임 ID는 pm-20261115-claude-01이며 canonical main pm-control.json의 active를 기준으로 한다. 인수자는 필수 문서·CP54·증거·세션·통신 한계·금지사항을 읽고 명시 ACK하며, 인계자의 마지막 활성화 문서 커밋/push 알림 뒤 새 PM 단독 운영으로 전환한다. codex-review w3:p3는 일반 작업자로서 배정 전 STOP, main 수정·배분·통합·push를 하지 않는다. 구현/문서/분석/검증은 기존 Codex 세션에 배정한다.
- 출발 main/origin은 c8cf7a9dd9c2780def3b8ea9e111371b03a5ffaa/tree5db495c219afb6e0e36e33f23aeb1c04f99905b7, clean이다. CP51 C11·CP52 현재문서·CP53 한 대본 actual CLI/별도host 비교·CP54 유한한 오프라인 인계는 완료 상태를 유지한다. 모든 worker report는 full READ/hash/explicit ACK CLOSED 후 STOP이다. 폐기/보존 live01 CHECKOUT_MISMATCH만 예상 예외이며 재전송하지 않는다.
- notifier32360은 codex-review 고정이라 전체 ACK 확인 후 PID/Node/명령줄/시작시각/owner를 확인해 그 프로세스만 종료했다. 즉시 조회는 종료 중 프로세스를 관찰했으나 다음 독립 CIM 조회에서 부재를 확인했다. 재kill/다른 프로세스 종료 없이 로그와 종료 증거를 .codaryn/pm-tools/claude-handoff-20261115/에 보존했다. 이전17044도 종료 상태다. 새 PM은 helper의 file-only register/dispatch(no send)/poll(no notify)/ack와 별도 명시 native prompt를 사용한다. 이름/pane/env 위장이나 기존 Codex notifier 재시작은 하지 않는다. former PM은 worker 허용 목록 밖이라 별도 수동 task/receipt/READ/hash/ACK로 구분한다.
- 실제 API·모델·키 조회·installer GU9/DR67 미승인/실제Windows12수동 NOT_RUN/다른OS·실볼륨/U333u22원인/U321경합/JSONpin 한계를 빠짐없이 인계한다. 패킷과 모든 실패·raw proof/기존 이력을 보존한다. 사용자 추가 지시 **어떤 Git trailer/자동 귀속도 금지**를 인계자·수신자·작업자에게 명시하고 푸시 전 작성자/committer/메시지를 확인한다. 이 체크포인트는 운영 문서만 바꾸며 제품·시험·권한 범위를 확장하지 않는다.

## 진행 요약 (CP-54, 2026-11-15) — 승인된 오프라인 범위 인계, 키 없는 수동 패킷 준비

- [인계 조사 원문](reviews/2026-11-15-offline-acceptance-handoff.md)과 [요구별 행렬](reviews/2026-11-15-offline-acceptance-matrix.md)을 읽고 SHA/report/matrix/checked/proof 체인·34proof·19literalGitblob·기존 읽기 metadata6개를 PM이 확인해 canonical 명시 ACK했다. 대상은 exactc00ce7d0a30a855afda3111ebf83b969509ef222/tree75f8fb0d632097f7487bdac92604e41d508cde5c다. 새 실행/읽기 실패0이며 tracked/index/checkout 무변경이다. 이 제한된 조사에서 새로 착수할 근거가 있는 승인된 오프라인 코드 단위를 확인하지 못했고, C1~C11·현재문서·CP53 한 대본 비교를 닫힌 범위로 인계한다. 추가 optional 시험/새gate/C12/반복 문서 작업을 발명하지 않는다.
- 다음 유한한 행동은 기존 [수동 점검표](manual-checks.md)의 keyless Windows 항목이다. [CP54 운영자 패킷](acceptance/windows-keyless-cp54.md)에 M-1.1~1.4, M-3.2/3.3/3.4/3.5/3.6/3.13/3.15/3.17의 준비·정확한 기대·기록 형식을 고정했다. 실제 TTY·OS dialog 기본/Enter/Esc·IME·Narrator/고대비/배율은 실제 운영자 관찰이 필요하다. **12항목 전부 NOT_RUN**, 제품 CLI/GUI를 시작하거나 실제 UI를 통과 처리하지 않았다.
- 준비 패킷은 C:/Users/gangd/AppData/Local/Temp/codaryn-manual-cp54-vlZX3f다. CP53 독립 fresh root/GUI 빌드2056파일의 SHA와 기존 Node26.13.1/Electron45.3.1 실행파일을 고정하고, 서로 분리된 CLI/GUI 합성 예시·원문 slowJSON·LF/CRLF+BOM 편집파일·private HOME/config/user-data·NOT_RUN 기록표를 만들었다. 기존 Electron은 pm-unit의 설치본이며 새 설치/다운로드/패키징은 없다. 실행기는 매번 핀을 확인하고 정적 자식환경만 전달하며 사용자 기존 key/env/config를 읽거나 지우지 않는다. 자동 삭제도 없다. launcher syntax와 info-only만 확인했고 actual cli/gui 모드는 운영자 실행 전이다. 이는 OS sandbox가 아니다.
- PM packet helper의 첫 node --check는 Markdown template의 미이스케이프 backtick SyntaxError로 코드 실행 전에 실패했다. 원래 helper/도구 출력을 보존하고 template만 바로잡은 뒤 syntax0·준비0·launcher syntax0·info0을 확인했다. 제품/API/UI/시험 실행 실패로 세지 않으며 수동 결과도 생성하지 않았다. 로컬 manifest/receipt/seal은 .codaryn/pm-tools/receipts/keyless-manual-cp54*.json, 이전 오프라인 증거/실패/보고는 그대로다.
- 실제 API 단계1b/2/3 및 실제 모델 자기개발은 미실행이다. 키 없는 패킷과 live/key 필요 항목을 섞지 않는다. GU9/DR67 installer·서명/게시/비용은 명시적 미승인 상태이며 버전/체크섬/실제URL/명령/산출/검증/비용의 구체 제안 없이 승인 질문을 올리지 않는다. 다른OS/실볼륨·실제 UI/접근성 한계와 U333u22 원인/U321 부모교체·hardlink 경합/과거JSONpin 범위도 남는다. 전체 제품·단계5 완료로 확대하지 않는다.
- 기존 Codex 작업은 모두 보고 회수·읽기/해시·명시 ACK 후 STOP이다. 새 코드 단위를 임의 배정하지 않고 실제 수동 관찰 또는 구체적인 범위 결정이 들어오면 해당 요구와 재현을 확인해 좁게 이어간다. Claude 배정/worker push/새worktree/이력 재작성/키 조회/실API/외부시험망은 없다. PM-only push·file-first 통신을 유지하며 갱신된 watcher32360/session39452가 explicitPMw3:p3에서 살아 있다. 이전17044는 모든 job ACK 후 소유/PID/시작시각을 확인해 갱신했고 로그를 보존했다. 이 인계는 자동 제품 검증의 반복이나 수동 합격 판정이 아니다.

## 진행 요약 (CP-53, 2026-11-15) — 실제 CLI·별도 host의 한 대본 완전 저장물 비교 채택

- 추가 오프라인 CLI/HOST-PARITY 증거를 main/origin/main **823486b5b81d2c1a956bc074f574a383559475ce**에 채택·push했다. PM worker commitcc41c47559f11de6f232e297d25b5a557740ff19, 검토·병합 treed00713587784543cb4f4ce10aa8bf9db14b7c160 일치. gui/tests/unit/cli-host-parity-support.ts328줄과 cli-host-parity.test.ts79줄, 정확2개 새 시험 파일407줄만 추가했다. 기존 제품·시험·fixture·설정·package/lock을 바꾸지 않았다. C11 완료를 다시 여는 필수 gate나 새 C12/제품 기능/전체 단계5 완료가 아니다.
- [계획](reviews/2026-11-15-cli-host-composition-plan.md)에서 기존 c01 실제CLI↔인프로세스 앱·GUI bridge/process 시험을 인정하고 첫 범위를 한 paired 문서 대본으로 좁혔다. 실제 CLI child와 actual startEngineHost의 별도 Node child가 같은 초기 task/script/workspace로 README 읽기·보호 경로 쓰기 거부·NOTE 쓰기·file_rules verifier·마지막 답을 수행한다. 전체 disk result/journal과 순서/필드를 비교하며 의도적으로 축약된 IPC view는 같은 host run의 저장 결과로 별도 대조한다. engineDir/--engine-dir가 실제 API이고 새 환경변수 API를 만들지 않았다.
- [최초 실패 보고](reviews/2026-11-15-cli-host-parity-initial.md)는 그대로 보존했다. 최초 writer 이름 처리 오류는 제품 실행0/신뢰할 cleanup receipt 없음, 다음 실제 쌍은 PM이 잘못 지정한 toolCalls3에서 멈췄고 controls/IPC/full 비교는 미실행이었다. PM은 고정 BASE2c202 engine handleCall1198/1229 거부가1240 증가 전에 반환함과 기존 n17:199–200의 거부 제외 assertion을 직접 읽고 **실행2회·tool_result3개**를 새 배정으로 명시했다. 제품/기존 oracle를 관찰값에 맞춘 변경이 아니라 신규 PM 기준 오류 교정이다. [후속 수정](reviews/2026-11-15-cli-host-parity-count-fix.md)은 tuple3→2+근거 주석1줄만 바꾸고 모든 다른 기준을 유지했다.
- worker 실제 후속: 새 파일 **10pass(실제 쌍 부모1+negative8+positive1)**, 관련GUI5pass, 기존 rootc01 24pass, 모두 fail/cancel/skip/TODO0. 양쪽 scripted/done/verified0, usage4turns/2tools/4input/4output/repair0,23journal·3tool_result와 wdeny의 requested/path/protected_path·policy_denied를 확인했다. 원래 failed pair1와 후속 pair1은 같은 고유 fixture1의 별도 실행이며 두 시나리오로 더하지 않는다. root/전체GUI의 이미 성공한 build/type/lock은 핀 확인 후 재사용하고 해당 GUI test config만 다시 컴파일했다. S0+plan135개 파일 불변과 첫 cleanup 한계·요약 helper permission 가정 오류를 보존했다.
- [PROBE 독립 검토](reviews/2026-11-15-cli-host-parity-probe.md) **H0/M0/L0**. exact2c202 archive1388멤버+정확2working bytes를 자기 A/source에 구성하고, 기존 pinned compiler/type 패키지와 Electron 선언2개만 복사해 설치·Electron 실행 없이 fresh root1678/GUI378출력을 만들었다. 실제 새 시험10/10·관련GUI5/5, 독립 복사본 negative4가 통과했고 worker c0124는 READ로 구분했다. 고유 fixture1/독립 실제쌍1이다. 원본 S0/plan/S1의196개 및 working/source/dependency/build bytes 불변을 확인했다. 준비 helper 오류3와 잘못 잡은 workflow 분기 근거를 보존하고 일반 handleCall 증명을 별도로 고정했다. PM은 본문·checked/proof 체인·4,226파일 해시(별도 metadata-only2개 제외)·원본196·working2핀·명령/관찰을 읽고 명시 ACK했다.
- 완전 저장 비교는 unknown field·presence·array/journal 순서·비허용 leaf를 보존한다. 정규화는 검증된 RUN 포인터·각 journal 최상위at·같은 run에서 일치하는 duration2곳·A/B 발급 token2개의 bijection/좌표뿐이다. status/error/policy/order/token merge/일반ISO문자/외부runId/unknownfield 거부와 허용 비결정성 positive, 추가 nestedISO/음수duration/local불일치/unknownjournalfield 검사를 원본·sibling·raw관찰 불변 상태로 수행했다. IPC는 독립 기대 투영에 연결하며 전체 disk 비교를 대신하지 않는다. host/CLI 종료·잠금 부재·정상 cleanup도 확인했다.
- PM은 두 worker 보고와 PROBE 보고를 읽고 ACK한 뒤 staged2새파일 raw/GitLF·scope·공백/비밀0을 확인해 커밋했다. main/origin clean·동일 BASE 확인 후 literalcc41 --no-commit 병합→동일d007 tree→staged 검사0→별도 merge commit→새2커밋 작성자/committer·무trailer 확인→PM만 push했다. 제품 입력이 그대로라 성공한 root 전체suite/GUI전체/smoke/graph를 반복하지 않았고, 기존4328unit/684integration/GUI426/smoke227/CLI95를 새 전체 수치로 덮거나 GUI436을 실측처럼 계산하지 않았다.
- 현재 문서의 추가증거를 미래 선택으로만 적은 문장을 이번 한 사례의 실제 검증 범위로 갱신했다. 원래 실패·보고·과거 CP/수치·사용자 결정은 보존한다. 합성 repository fixture는 compiler/tests가 읽을 수 있다는 PM 보완을 fresh build 전에 전달했고 수동 hash 제외/metadata와 compiler 입력 읽기를 구분했다. 실제 개발자 key/env/config·private mapping은 읽지 않았다. 실제 client는 host 내부 stderr를 버리므로 그 stream은 검증하지 못했으며 loopback-only/refused0은 OS/syscall/socket 격리 증명이 아니다. 실제 API/model/다른OS/realTTY/dialog/IME/접근성/installer DR67 및 U333u22/U321경합/JSONpin 한계는 남는다. 다음 판단은 이미 승인된 요구의 남은 증거·수동/승인 경계를 구체적으로 정리하는 것이며 추측성 기능·추가 gate를 만들지 않는다.

## 진행 요약 (CP-52, 2026-11-15) — C11 뒤 현재 상태 문서4개 보완 채택

- DOC-POST-C11-CURRENT를 main/origin/main **42b16b94512ee8d696c36d53ae48450e4980abbf**에 통합·push했다. PM이 만든 worker commit5bf48869756f5ee0778529acc074e3c611a62951과 병합 tree47596dad2c0bd3871bee8c7c536aaa347ad87474가 일치한다. roadmap/progress/implementation-map/decision-register 정확4파일 +52/-4=56줄이며 제품·기존 시험·설정·패키지 변경은 없다. 기존 fullchecked881533부터 현재까지 비문서 raw Git 차이0을 별도로 확인해 같은 제품 입력에 기존 검증을 연결했다.
- [선행 읽기 전용 조사](reviews/2026-11-15-post-c11-next-plan.md)의 보고/계획을 PM이 읽고84proof·52literalGitblob을 직접 확인·ACK한 뒤 작은 문서 보완을 채택했다. 실제 CLI↔인프로세스 앱의 전체 EngineResult/journal 비교(c01), real app→GUI view/parser, 실제 host/CLI 잠금·취소 시험이 이미 있다. 포괄적인 “계약시험 없음”은 낡은 현재 상태 설명이었고 이번 조사에서 새 제품 결함을 확정하지 않았다. 조사 helper 읽기 오류2건도 보존했다.
- [구현 보고](reviews/2026-11-15-post-c11-current-check.md)는 D1~D6의 날짜 있는 현재 overlay와 DR65 구현 상태만 보완했다. C11 경계 완료·P1 A/B/Markdown/models/권한 질문 구현을 현재로 연결하며 3aca6b5/76c5280/349726a의 원래 표·수치·경로·실패는 이력으로 남긴다. DR65 사용자 결정문은 그대로, 이전 상태는 날짜를 붙여 cell 안에 보존했고 DR67 등 다른 모든 결정 bytes도 동일하다. 원래4문서 before/work raw bytes는 선언한 추가/치환을 역변환하면 완전히 재구성된다. LF/CRLF를 구분했다. worker helper 실패4건도 보고에 남겼다.
- [AUDIT 독립 검토](reviews/2026-11-15-post-c11-current-audit.md) **H0/M0/L0·사실 오류0**. 같은 미커밋4working raw/GitLF pins·patch3f95eac7...를 검토하고 전·후 역변환/정변환 전체raw·기존 표/CP/DR65/DR67를 확인했다. 신규 링크30(추가 줄 물리33 중 재포함 기존3 제외), heading4/t17·실제 source/test assertion을 대조했다. 원래 S49+envelope3/P84+envelope3 및 literal52+추가5blob도 확인했다. PM은 보고 본문·checked/proof 체인·own551proof·4working hashes를 직접 확인 후 canonical ACK했다. AUDIT helper 오류3(신규 링크/순서/CRLF 가정), 잘못 추정한 읽기 경로 등은 보존했고 제품 시험 실패로 세지 않았다.
- PM은 구현/AUDIT ACK를 HEAD 이동 전에 완료하고, 별도 staged 비밀 검사·공백0과 raw/GitLF4핀·소유를 확인해 worker commit을 만들었다. main/origin clean·동일판 확인 뒤 literal5bf48869 --no-commit 병합→검토47596dad tree 일치→staged 검사0→별도 merge commit→두 새 커밋 작성자/committer·무trailer 확인→PM 전용 push 순서를 지켰다. 새 worktree/Claude/worker push/amend/이력 재작성/--no-verify는 없다.
- 문서 단위에서는 제품 시험·build·graph·selftest·API·GUI를 실행하지 않았다. 기존 unit4328/4317pass0fail10skip1TODO, integration684/682pass0fail1skip1TODO, GUI426/smoke227/CLI95same과 CP51 source/runtime0·selftest30/147은 기존 정확판의 READ·동일 입력 근거다. C11 완료를 다시 열거나 전체 단계5/제품/API 완료로 넓히지 않는다.
- 다음은 같은 대본의 실제 CLI와 별도 GUI host 프로세스가 남기는 전체 저장 결과·journal을 직접 대조하는 **추가 오프라인 증거 단위의 구체화**다. 기존 c01/bridge/process 시험이 없는 것으로 취급하거나 새 C12·필수 gate·제품 기능 요구를 만들지 않는다. 먼저 실제 host 진입점·정규화 허용 범위·동기화·오류/취소/DR4 시나리오와 최소 소유 파일을 설계해 PM이 범위를 고정한다. U333 최초u22 원인/U321 경쟁/JSON narrow-pin scope 및 실제API/model/다른OS/realTTY/manualdialog/IME/접근성/installer·서명·배포 한계와 GU9/DR67 미승인 경계는 유지한다. 통신 file-first·READY 후 STOP·명시 ACK 및 PM만 push 규칙을 계속 적용한다.

## 진행 요약 (CP-51, 2026-11-15) — C11 완료: 실제 최종 혼합 source union·fresh runtime CLI 의존0

- PM은 U327~U336 **10/10 구현 채택과 C11 최종 구조 검증 완료**를 판단했다. 정확한 검증 대상은 main/origin/main37fb966abe088a666cb33ce533f484a5b06b5957, treef1be8b6ef2b5a825354f1d370a786f69f242823f다. 기존 전체 검사 판881533de4b66d9ab3e1497cf22c7043c7b398504와는 CP50 문서2개만 다르고, 제품·빌드·시험 입력이 동일하다. 이 체크포인트도 문서 변경으로만 연결하며 성공한 전체 시험·빌드를 불필요하게 반복하지 않는다.
- [SEC 실제 최종 그래프](reviews/2026-11-15-c11-final-graph-sec.md): exact archive1383멤버, production src200+package/lock/tsconfig3=203입력, 처음 dist 부재 뒤 pinned native compiler의 새 production build exit0, JS200+map200=400출력과 source-map origin을 확인했다. 권위 있는 **혼합 source union roots66/reachable156/edges918(value522/type396)/CLI0/unknown0**, **fresh runtime roots66/reachable154/edges522/CLI0/unknown0**이며 두 실제 graph CLI 모두 exit0·zero-within-model이다. 물리 ALL app roots와 native program/graph inputs 집합을 대조했고 source151/runtime140 boundary·unknown/witness·독립 BFS를 확인했다. type/value 투영이나 wrapper exit0을 통과 판정으로 쓰지 않았다.
- SEC 최초 제출은 전체 성공이 아니었다. PM이 지정한 중첩 session-comms cwd에서 원본 selftest의 상대 typeRoots가 잘못 풀려 첫 사례2688/unknown1·exit1, 완료0/30·입력4개(3동일/1config차이)·143미생성이었다. 원래 BLOCKED 보고/checked/실패를 보존하고, PM이 새 sibling cwd를 명시 허용한 **별도 PROBE 검토**로 배치를 바로잡았다. 도구·기준·expected·config를 패치하거나 링크로 우회하지 않았다. 도구의 일반 cwd 의존 자체가 사라진 것은 아니다.
- [PROBE 독립 최종 검토](reviews/2026-11-15-c11-final-graph-probe.md) **신규 H0/M0/L0, 배치 M1 해소**. 원본 selftest를 올바른 새 sibling cwd에서 단1회 무수정 실행해 **30/30pass·fail0/skip0**이며 원래 입력147파일 전부 raw bytes 동일,30결과 의미·음성 진단·witness도 같다. 동일 SEC 입력으로 graph native CLI를 모드별1회 독립 실행했고 source/runtime 전체 JSON이 각각0fd1074a.../95a32e85...로 **raw bytes 동일**, roots66·CLI0·unknown0·exit0을 재확인했다. 별도 새 제품 build/fullsuite는 하지 않았고 추가8 loader 회귀는 기존 독립 검토 READ로 구분했다.
- PM은 두 보고 본문·정확 SHA와 checked/proof 체인을 읽고 canonical 명시 ACK했다. SEC 증거89·production203·fresh400·dependencies673과 PROBE own 증거246(A64/B182)를 직접 해시 확인했고, selftest147 입력도 양쪽 실제 bytes를 직접 비교했다. 원본 SEC89와 보고/checked/envelope/첫 실패·입력·출력·의존성은 전후 그대로다. frozen v1/v2 봉인1282/889도 전후 exit0·불변, graph/selftest/compiler/API/AST/Node-types·Node26.13.1win32x64/TS7.0.2 핀을 유지했다. 가짜 fixture/제품 프로그램은 실행하지 않았다.
- PM의 기존 전체 검사(offline ci/type/build/GUI build·lock0, unit4328/4317pass/0fail/10skip/1TODO, integration684/682pass/0fail/1skip/1TODO, GUI426, smoke227, CLI95차이0, 비밀 검사0)는 동일 제품 입력에 연결되는 별도 실행 결과다. 이번 graph/selftest 관찰과 합산하지 않는다. 환경형 leaf2개는 metadata만 확인한 한계, 컨테이너 archive 해시와 leaf 내용 검사의 구분도 보존한다.
- adapter-contract 3절 현재 방향과7.2 상태를 갱신했다. 공통 init core는 app/init-command.ts, JSON/Markdown 표시는 presentation/json.ts·report.ts이고 CLI는 기존 공개 binding을 유지한다. **검사한 AST/native resolver 모델에서 전체 app의 CLI 값·형 의존0**을 뜻하며 모든 CLI parser/질문/출력을 앱에 옮겼다는 선언은 아니다. 과거 구조·시험 수는 당시 이력으로 구분한다.
- C11 완료는 제품 전체/단계5/실 API·실제 모델 자기 개발 완료가 아니다. U333 최초u22 원인 미확정, U321 부모 교체/마지막 검사 뒤 hard-link 경합, historical JSON narrow-pin scope와 realAPI/model/다른OS/실제TTY 미검증은 남는다. 임의 reflection/custom loader/global monkeypatch/경합의 보편적 증명으로 확대하지 않는다. 다음 작업은 최신 설계와 구현의 남은 차이를 읽기 전용으로 다시 분류해 오프라인 후속 단위를 정하는 것이다. 설치 패키지·실 API 등의 별도 사용자 경계를 자동 승인하지 않는다. 통신은 파일 기준 STARTED→READY→전체 읽기/해시→ACK, 구현·검증은 기존 Codex만, push는 PM만 유지한다.

## 진행 요약 (CP-50, 2026-11-15) — REPORT presentation 채택, 구현10/10과 최종 그래프 준비

- U336 REPORT-PRESENTATION을 main/origin/main `aa1eb936ab4c206d93fb2f91e4952b353b898cd3`에 채택·push했다. worker 최종 `ef009c7adcda299d746a5566080404a6a7c16d0f`, 정확 후보 `881533de4b66d9ab3e1497cf22c7043c7b398504`, 검증·병합 tree `0e7da89ab9a5b2dd392017617b70c4c179648aa1` 일치. 4파일 +633/-381=1014줄. 전체 Markdown helper·상태·상수·renderer closure는 src/presentation/report.ts로 이동하고 CLI는 같은 함수/배열과 형을 공개한다. app.ts는 renderer import 한 곳만 바꿨으며 reader/runReport/앱 본문·가림·순서·null-finally·폭 기본 getter는 보존했다.
- 첫 worker 보고59c41e는 읽고 ACK했으나 채택하지 않았다. 전체 namespace 타입 비교 실패를 Readonly로 정규화한 결과가 실제 const-binding 읽기 전용 약화를 가린 사실을 PM의 native compiler로 재현했다. 수정 보고4d8d94와 source/hash를 검토·ACK한 뒤, 같은 배열 객체의 명시 export const aliases로 원래 전체 타입을 복원했다. PM의 무수정 raw probe도 성공했고 새 영구 modifier 시험을 추가했다. 기존 실패·잘못된 해석·expected-error 로그는 그대로 보존했다.
- [V55 독립 검증](reviews/2026-11-15-v55-codex-verify-u336.md) 신규 H0/M0/L0이며 PM M1을 독립적으로 닫았다. actual-parent 전체 선언 fresh emit·import8곳 가역 연결 뒤 **정규화 없는 FULL RAW namespace equality**,27 Assert/10개 exact members/양방향8대입 통과. 구조 namespace 값의 두 const 쓰기는 OLD/후보 모두 의도한 TS2540 네 건, 원래 함수 멤버 할당4개는 허용됐다. getter/throw/state/default/폭/배열·함수 binding의 OLD8/동일 후보8 차이0과 원래368호출/90조건 차이0, FS trace352/key-order368,253봉인 및 기존15415항목/1005디렉터리 불변을 확인했다. 환경형4파일은 내용·hash를 읽지 않고 경로/크기만 확인한 한계를 유지했다.
- PM exact 후보 첫 전체 검사: offline ci/typecheck/clean root build/GUI build·lock0, unit4328 중4317pass/0fail/10skip/1TODO(단독 먼저), integration684 중682pass/0fail/1skip/1TODO, GUI426/426, smoke227/227, CLI95차이0, tracked/staged 비밀 검사0. 재시도 없고 모든 실제 결과와 V55 본문·checked SHA/tree·proof19개/해시 체인·archive를 읽고 확인했다. pm-unit/.codaryn/codex-u336-final-evidence/에 명령/원문을 보존했다. V55의 새 archive/build src200/dist1678은 산출물 수이며 PM 전체 시험이나 부모368을 후보 고유 수로 더하지 않았다.
- PM이 첫 커밋5a5e935의 EOF 구분용 빈줄 경고를 커밋 전에 반영하지 못한 실수도 보존했다. 추가 커밋ef009는 마지막 함수 밖 separator LF 하나만 제거하며 이력을 재작성하지 않았다. 최종381라인 canonical에 그 한 LF를 붙이면 원래369라인 closure가 재구성되고 renderer/compiled body는 동일하다. V55 준비 오류2건(도구 생성 SyntaxError, compiled EOF 가정)과 worker fixture/parser/EOL/형 검증 오류도 원문 그대로다. 현재 branch/staged 공백·비밀 검사0을 별도로 확인했다.
- worker와 AUDIT 보고는 본문·정확 SHA를 읽고 명시 ACK했다. worker HEAD 이동 전에 보고 ACK를 완료하고, V55 ACK 후 별도 literal 후보 병합→동일 tree→staged 검사/공백→새 커밋 작성자·메시지 확인→PM 전용 push를 지켰다. Claude 배정/worker push/새 worktree/이력 재작성 없음.
- C11의 **구현 단위10/10을 채택**했다. 다음은 이 운영·문서 뒤 실제 최종 판에서 동결 GRAPH v2의 selftest와 도구/compiler/API/AST/Node-type 지문·seal을 확인하고, exact archive/production fresh build의 **권위 있는 혼합 source union과 runtime 각각 roots>0·CLI0·unknown0**을 검증하는 단계다. type-only/value-only 투영이나 wrapper exit0으로 대신하지 않는다. 별도 독립 확인 후 C11 완료를 판단한다. 현재 전체 app→CLI0/최종 그래프 완료를 아직 선언하지 않으며 U333 u22 원인·U321 경쟁 위험·JSON narrow-pin scope 및 실제 API/모델/다른 OS/실제 TTY 미검증은 유지한다.

## 진행 요약 (CP-49, 2026-11-15) — JSON presentation 채택, REPORT 부모 준비

- U335 JSON-PRESENTATION을 main/origin/main `ba9889b33ff9d68c1b17461c9808c46a497ced89`에 채택·push했다. 구현 `7dfeef15563db698b30a899ff93f517d45b8f7ba`, 정확 후보 `016b02f7601cbdeac4698a82d88cbb68fde836c7`, 검증·병합 tree `94ea63b96b08efd404f8d0b25c41ea5ff66c7262` 일치. 4파일 +84/-11=95줄이다. N19 주석과 jsonLine 함수9줄은 src/presentation/json.ts의 순수 단일 원천으로 옮겼고 guard는 같은 binding을 재수출하며 app.ts는 import 한 곳만 바꿨다. plan alias·기존 exports/types·readonly·함수/prototype·예외·UTF16 escape/LF·가림/재파싱/await 본문을 보존했다.
- PM의 exact 후보 실측: offline ci/typecheck/clean root build/GUI build·lock0, full unit4319 중4308pass/0fail/10skip/1TODO, integration684 중682pass/0fail/1skip/1TODO, GUI426/426, smoke227/227, CLI95 차이0, tracked/staged 비밀 검사0. 첫 unit은 단독 실행했고 재시도 없었다. 명령·원문은 pm-unit의 .codaryn/codex-u335-final-evidence/다. 고정 기준·기존 시험·패키지·설정 등 소유4파일 밖의 tracked 내용은 그대로다.
- [V54 독립 검증](reviews/2026-11-15-v54-codex-verify-u335.md) 신규 H0/M0/L0 원문과 checked.json·입력13해시를 PM이 모두 확인했다. exact archive1379파일/fresh production build398출력, 원래25×두 legacy 진입점=50관찰 차이0(반환24/의도 예외26), 원본29봉인 전후 불변, 소스11+compiled guard1·binding23·strict 타입12조건+양방향6 통과. canonical=guard=plan 동일 객체와 namespace·readonly·함수 반사·constructibility를 별도로 확인했다. 새 준비/관찰 실패0, network/예상 밖 실제FS/fixture쓰기0이다. 원본 oracle·expected·normalization은 무수정이며 제한 출력 guard의 경로 한 곳만 가역 비교했다.
- worker OLD58/후보61 및 source12는 worker 실행으로 구분한다. 최초 private TEMP/HOME이 설치 안쪽인 절차 오류를 제품 수정 없이 harness에서 outside-installation으로 고쳐 최종 type/build/61/source를 재실행했고 이전 결과를 보존했다. 반복을 새 고유 사례로 더하지 않았다. 과거 N19 narrow snippet-pin 추출 범위는 여전히 미확인이며 전체 guard/actual9줄의 직접 동일성으로 이동을 검증했다. U333 최초 u22 원인·U321 기존 경합 위험도 해결로 처리하지 않았다.
- 새 통신 절차로 worker와 SEC의 STARTED/READY를 실제 회수하고 보고 본문·정확 SHA를 읽어 명시 ACK했다. worker HEAD를 PM 커밋으로 옮기기 전에 구현 보고 ACK를 마쳤다. SEC ACK 후 별도 호출의 literal 병합→동일 tree→staged 검사/공백→작성자·메시지 확인→PM 전용 push 순서를 지켰다. 감시의 idle 알림이 실제 후속 PM turn을 시작한 것도 확인했다. Claude/worker push 없음.
- C11 구현 단위는 **9/10 채택**이다. 남은 REPORT presentation은 CHECK의 읽기 전용 소유/상태 closure 계획과 AUDIT의 INIT+JSON 뒤 실제 부모 V42 원본368호출/90조건·253봉인 gate를 확인한 뒤 연다. 과거 안전 replay 준비는 별도 old-parent 자료이며 새 actual 부모나 REPORT 후보 승인으로 쓰지 않는다. 이후 별도 최종 source union/fresh-dist CLI0·unknown0이 남았다. 전체 app→CLI0, 더 넓은 앱 masking/실제 API·모델/다른 OS·실제 TTY 완료를 아직 주장하지 않는다.

## 진행 요약 (CP-48, 2026-11-15) — 세션 통신 적용·실제 수신 확인

- 운영 통신 도구를 main `8caa83b6954d9076a915c15c10c086eda48740d0`에 채택·push했다. 정확 후보 `c22fa348fb40c692fe3356acefabb8835e6ae049`, tree `41c33a35e182265e5b60da1aa5b422c0c2dc46b1` 일치. 새 script·자체 시험·[사용 절차](workflows/session-communication.md) 3파일 +1183이며 제품/기존 시험/패키지/고정 기준은 바꾸지 않았다. 별도 PM 검토·staged 검사·작성자/메시지 확인 뒤 PM만 push했다.
- [초기 독립 검토](reviews/2026-11-15-session-comms-initial.md)의 cwd/checkout 결함과 [첫 수정 검토](reviews/2026-11-15-session-comms-cwd-fix.md)의 Windows case 낮음1을 추가 커밋으로 고쳤다. [case 재검토](reviews/2026-11-15-session-comms-case-fix.md) 신규0/0/0 후에도 실제 송신에서 native CLI 인자 거부를 찾았다. 최초 UNKNOWN과 별도 진단을 보존하고 같은 작업을 재전송하지 않았다. native timeout 옵션을 제거하되 부모 프로세스10초 제한과 전달 접수 의미는 유지했고 [최종 독립 검토](reviews/2026-11-15-session-comms-transport-final.md)를 받았다. 실패를 성공으로 덮거나 이력을 재작성하지 않았다.
- 통신77 통과, tracked/staged 비밀 검사0. 독립 원본77/원래7/원래20/CLI1 및 추가 경계 검사의 실행 결과·준비 오류·한계는 최종 보고를 따른다. 나머지1369 raw blob은 전체 검사한0e711과 동일하며 빌드/유닛4316 중4305pass·0fail/통합684 중682pass·0fail 증거를 입력 동일성으로 연결했다. c22fa에서 제품 전체 검사를 새로 실행한 것으로 세지 않는다.
- [실제 통신 확인](reviews/2026-11-15-session-comms-live.md): 새 LOOP 지시→STARTED→READY→PM 보고 원문·SHA 확인→명시 ACK 완료. main 채택 후 기존 Codex5개도 canonical 절대 script로 같은 교육/통신 흐름을 수행하고 모두 closed ACK했다. Claude 배정/worker push 없음. 앞으로 파일이 기준이며 직접 Herdr 통지는 필수가 아니다. 전달 접수·착수·완료·인수·제품 채택을 구분하고 READY 후 worker는 정지한다.
- PM watcher는 PM 권한 문맥에서만 실행하며 working 때 큐, idle/done과 확인된 정상 입력 footer에서만 metadata를 전달한다. PC 재시작 후 poll→미인수 회수→watch 재기동 순서다. 모호한 전송은 맹목 재송신하지 않는다. OS 전원/디스크/ACL·세션 재사용 등 한계와 실제 API 미검증은 유지한다.
- C11 구현 단위는8/10 채택 상태다. 남은 JSON presentation→REPORT presentation→별도 최종 source union/fresh-dist CLI0·unknown0을 이어간다. JSON의 provisional7258 gate는 완료했고 이 운영·문서 채택 뒤 실제 부모 입력 동일성을 SEC가 확인한 후 LOOP 구현을 연다. U333 최초 u22 원인 미확정과 U321 등 기존 위험은 해결로 처리하지 않는다.

## 진행 요약 (CP-47, 2026-11-15) — 앱 초기화 직접 연결 채택, 작업 세션 통신 보완

- main/origin/main `dbdeab5d2493a2c0e6181397cd85ba592f4e3be3`: U334 APP-INIT-DIRECT 채택·push. 구현 `b0ebdb2f4e01ffb5ff17cb91b71fa2fe3284ef36`, 정확한 판 `2f5c4742cc7dead53c956ff8b064e7313cdf924a`, 검증·병합 tree `eecff415240391bfc6aa9e450414f113eeea30e9` 일치. app.ts의 private JSON facade와 createSettings 연결, 새 공개 시험만2파일 +195/-4=199줄이다. 기존 try/IO 평가순서·single outer await·JSON 완료/catch·wx 포트를 보존했고 CLI init 값·형 의존을 제거했다. 전체 app→CLI0을 선언하지 않는다.
- PM 첫 전체 검사: offline ci·typecheck/clean build·GUI build/lock 통과. 유닛4316 중4305pass/0fail/10skip/1TODO, 통합684 중682pass/0fail/1skip/1TODO, GUI426/426(skip/TODO0), smoke227/227, CLI95 차이0, tracked/staged 비밀 검사0, 고정5파일 불변. 유닛은 다른 모드 전에 단독 실행했고 이번 판의 재실행은 없었다. `.worktrees/pm-unit/.codaryn/codex-u334-final-evidence/`에 원문·명령을 보존했다. U333 u22 최초 실패 원인은 미확정이며 해결로 처리하지 않았다.
- [V53](reviews/2026-11-15-v53-codex-verify-u334.md) 신규 H0/M0/L0을 PM이 전체 읽었다. OLD10을 독립 fresh parent에서 먼저 통과시킨 뒤 같은 후보10·기존 관련90=후보 고유100개 통과, CLI40/APP16-182 차이0, 원본80/333/V52-3213봉인 전후 불변. 독립 소스14·Promise/receiver/getter13·타입10 equality+양방향2 조건 통과. 전체 app.ts는 허용6사이트만 다르고 fresh createSettings는 callee/comment 외 동일했다. 자체 도구 준비 실패2건과 worker OLD8pass/1잘못된 새 fixture 예상→제품 수정 전OLD10고정 이력을 보존했다. PM은 READY.json의 보고서/checked 해시도 확인했다.
- 검증 원문과 전체 결과를 읽고, 별도 호출로 literal SHA 병합→tree 일치→staged 비밀 검사/공백→작성자·메시지 검사 뒤 오케스트레이터만 push했다. 관리 main과 원격의 추가 변경 없음도 먼저 확인했다. 문서 기록은 이 채택 뒤 별도 커밋이다.
- 사용자가 진행률을 조회했을 때 LOOP는 READY였지만 Herdr elevated-server 접근 거부로 PM 직접 통지가 안 돼 대기 중이었다. PM이 파일·세션 상태를 직접 조회해 보고를 회수했고, `.codaryn/pm-tools/receipts/U334-pm-received.json`에 보고서SHA·기준·판·인수 상태를 남기고 LOOP에 ACK를 전달했다. 이 수신 확인과 제품 채택을 구분했다.
- **사용자 추가 요청: 작업 세션 통신을 안정적으로 정리한다.** CHECK를 기존 claude-store의 별도 `ops/session-comms-codex-check`에 배정했다. 소유는 새 `scripts/pm-session-comms.mjs`, 자체 시험, `docs/workflows/session-communication.md`뿐이며 U334 판에는 포함되지 않는다. assignment→STARTED→READY→PM 수집/ACK를 지속 파일로 연결하고 Herdr 직접 통지는 보조 수단으로 둔다. 권한 거부·모호한 전송·중복·재시작·잘못된 세션/SHA/path·PM 승인 화면을 실패 경로로 검증한다. 현재 구현/검토 중이며 도구 완료·라이브 통신 검증·채택을 아직 주장하지 않는다. 별도 AUDIT 검토와 정확한 통합판 검사를 거쳐 PM이 채택한다.
- 다음 제품 단위는 JSON presentation→REPORT presentation→최종 source union/fresh-dist CLI0·unknown0이다. 통신 보완을 먼저 인수해 이후 지시·완료 회수에 사용한다. Claude 배정/worker push 없음. 실제 API·키·외부 시험망 금지 및 이전 경쟁 경계·실제 API 미검증 한계는 유지한다.

## 진행 요약 (CP-46, 2026-11-14) — 초기화 core 채택과 복구 후 검증

- main/origin/main `db688901f395665e91f5547ae3e21b892391c309`: U333 INIT-CORE 채택·push. 구현 `b4a76402dbb0ff75da8f3c350bad3f20ff93224c`, 정확한 검증판 `f852df5892b80f17f62bafce42af80d205e4d280`, 검증·병합 tree `a0406098d084e1c6705516f9ff23d2c06f69d7dc` 일치. 5파일 +542/-296=838줄이며 상수·설정 생성·생성 규칙은 app/init-core·init-command에 단일 원천으로, 인자·질문·해석·표시는 CLI에 둔다. 기존6개 export와4개 binding을 보존하고 app/init.ts는 import 원천 한 곳만 바꿨다. app.ts 직접 연결은 아직이다.
- PM 실측: 오프라인 ci·typecheck/clean build·GUI build/lock·tracked/staged 비밀 검사 통과. 최종 같은 판 유닛4306 중4295pass/0fail/10skip/1TODO, 통합684 중682pass/0fail/1skip/1TODO, GUI426/426(skip/TODO0), smoke227/227, CLI95 차이0, 고정5파일 변경 없음. 증거는 pm-unit의 `.codaryn/codex-u333-recovered-final-evidence/`와 별도 유닛 재실행 `.codaryn/codex-u333-retry1/`이다. 전체 결과와 독립 원문을 읽고 별도 호출로 literal SHA를 병합해 tree·staged scan·작성자/메시지를 확인한 뒤 PM이 push했다.
- **최초 전체 유닛은 실패1이었다.** u22 only-busy report가 run_in_progress 대신 run_not_found였다(4306/4294pass/1fail/10skip/1TODO). 제품·시험을 바꾸지 않고 다른 전체 검사 종료 뒤 같은 SHA로 재실행해 위 최종 실패0을 확인했다. [독립 분석](reviews/2026-11-14-u333-unit-flake-analysis.md)은 관련9소스 동일과 busyOn이 damaged 목록도 준비 완료로 받는 기존 빈틈을 확인했다. OLD/후보 제한 재현 각1회는 둘 다 통과했다. **실제 최초 원인은 미확정**이며 초기 journal 경합은 가능한 설명이다. 최초 실패를 성공으로 덮지 않았고 U333의 직접 회귀 근거를 찾지 못한 것과 모든 timing의 보장을 구분한다. 이 기존 위험은 미해결 후속 항목이다.
- [V52](reviews/2026-11-14-v52-codex-verify-u333.md) 신규 H0/M0/L0. 별도 exact archive/fresh build에서 원래 CLI40·APP16/182 차이0, 봉인80/333/637 불변, 독립 소스69검사·strict 타입12조건·공개 binding/Promise9검사 통과. 관련 고유92개 중 최초91pass/1검증 guard 실패 뒤 sp0 파일2개만 재실행해2pass(중복1)를 기록했다. 최초 실패는127.0.0.1 모의 서버까지 막은 검증 guard였고 제품/시험은 고치지 않았다. SEC 원문은 실패·도구 수정·한계를 구분한다. 증거3213개 봉인도 PM이 재확인했다.
- 커밋 전 staged 비밀 검사가 합성 fixture 표기1건을 거부했다. 커밋 없이 지정5파일만 unstage한 뒤 담당자에게 반환했고, 계산 property 한 줄로 실행 이름·합성 값을 동일하게 유지했다. 제품4파일 hash 불변, OLD12·HEAD92·타입/binding/source42 및 실제 staged 검사0 뒤 커밋했다. 원래 실패 로그·봉인·기대값을 보존했고 scanner를 바꾸지 않았다.
- runInit의 AsyncFunction→일반 Function 반사 차이는 C10/U331과 같은 허용된 경계로 공개한다. 실제 Promise·예외·microtask·receiver/getter·질문 await와 동기 finish는 보존했다. init wx 생성을 CAS writer로 합치지 않았다. 전체 app→CLI0이나 최종 그래프 완료를 선언하지 않는다.
- 다음 U334 APP-INIT-DIRECT는 LOOP가 app.ts의 createSettings/직접 필요한 helper·import와 새 공개 시험만 맡고 PROBE가 독립 검증한다. 실제 채택 부모의 source/원래 CLI40+APP16 gate를 확인한 뒤 구현을 연다. JSON→REPORT→최종 source union/fresh-dist CLI0·unknown0은 이후다. Codex만 배정하고 결과 수신·검토·통합·push는 오케스트레이터가 맡는다. 실제 API·키·외부 시험망 금지와 U321 경쟁 경계 등 기존 한계는 유지한다.

## 진행 요약 (CP-45, 2026-11-14) — 강제 종료 복구와 Codex 재교육

- 사용자 재개 지시로 codex-review가 Codaryn 오케스트레이션을 이어간다. 최신 사용자 지시: Claude에는 토큰 소진으로 업무를 배정하지 않는다. 기존 Codex 작업 지시는 재확인 없이 직접 전달한다. 작업자는 결과를 오케스트레이터에게 제출하며 **원격 push는 오케스트레이터만 수행한다**. 다른 프로젝트의 세션은 배정하지 않았다.
- 복구 기준은 main/origin/main `88484a844d9c093f5da3d971b5d5ddaa73af7a58`(CP44 기록)이다. 초기 main은 깨끗했고 기존 worktree를 모두 조회했다. U333의 `claude-store` / `unit/U-333-codex-check`에 중단 전 새 시험 `tests/unit/app/u333-init-command.test.ts` 하나가 미추적으로 남아 있어 보존·재사용을 명시했다. 나머지 기존 worktree 11개에는 변경 표시가 없었다. 새 worktree를 만들거나 기존 변경을 지우지 않았다.
- OPTIONAL(`w3:t3`)·OPTIONAL-sub(`w3:t5`)의 기존 Codex 다섯 worker를 확인하고 역할 이름을 복구했다. `codex-check`(`w3:pD`)는 U333 구현, `codex-sec`(`w3:pC`)는 V52 독립 검증, `codex-loop`(`w3:p8`)는 U334 후속 구현, `codex-probe`(`w3:pF`)는 U334 독립 검증, `codex-audit`(`w3:pE`)는 REPORT 독립 감사 준비를 맡는다. PM은 `w3:p3`이다. Claude pane에는 업무를 보내지 않았다.
- 다섯 worker에게 main AGENTS·personas·development-workflow·CP44·현재 배정표를 읽히고 역할, 소유 파일/worktree/브랜치, 완료 기준, 금지사항, OLD 확인→구현→정확한 통합판 전체 검사→독립 검증→PM 채택 순서를 복창하게 해 확인했다. 현재 CHECK만 제품을 구현한다. 나머지는 각자 교육 기록만 지정된 ignored 경로에 남기고 기준을 동결한 채 대기한다. 모든 worker의 직접 push를 금지했으며 CHECK는 stage/commit도 하지 않고 READY 후 명령을 정지한다.
- PM이 기존 SEC 실제 부모 `88484a84` gate 보고를 다시 읽었다(CLI40+APP16/182조건 차이0, 원본 및 새637봉인 보존). 이는 중단 전 검증 증거이며 이번 후보 검증으로 세지 않는다. 재개 후 CHECK의 기존 제품 새 빌드에서 새 공개 시험 12개 통과 로그를 확인했다. CP44의 전체 검사 결과는 이전 실행 기록이며 재부팅 후 전체 검사 완료로 기록하지 않는다. U333은 아직 구현·후보 전체 검사·V52·채택 전이다.
- 다음 순서는 U333 READY 검토→PM 커밋과 정확한 통합판 전체 검사→SEC V52→SHA/tree·staged 비밀 검사·작성자/메시지 확인 후 PM 채택·push→실제 부모를 지정해 LOOP U334를 연다. JSON·REPORT·최종 그래프는 그 뒤다. 기존 corpus/oracle/expected/seal·실패 기록을 보존한다. 실제 API·키 조회·외부 시험망 금지, 이력 재작성·새 worktree 금지 및 U321 경쟁 경계 등 기존 미해결 한계는 유지한다.

## 진행 요약 (CP-44, 2026-11-14) — 앱 모델 직접 연결 채택, 초기화 core 준비

- main/origin/main `d3db0d26d2ae95cf126e7c8a5607023567254c83`: U-332 APP-MODELS-DIRECT 채택·푸시. 구현 `8a864de3`, 최종 판 `1575bde19948162612bf1af1d3e49ccc28a04375`, 검증·병합 트리 `b8761df68721d67554ccf34a18445cc80d599077` 일치. 두 파일 +193/-5=198줄이다. app.ts는 모델 core와 canonical hook형을 직접 쓰고 private Promise adapter에서 기존 JSON·가림을 완료한다. CLI/core/writer/계약/기존 시험은 그대로다.
- 최종 PM 실측: 오프라인 npm ci·typecheck/build·GUI build/lock·tracked/staged 비밀 검사 통과. 유닛 4,294 중 4,283 통과/실패 0/skip 10/TODO 1, 통합 684 중 682 통과/실패 0/skip 1/TODO 1, GUI 426/426, smoke 227/227, CLI 95사례 차이 0, 고정 파일 5개 변경 없음. 증거 `.worktrees/pm-unit/.codaryn/codex-u332-final-evidence/`. 전체 결과 후 독립 검증을 열고 최종 보고·트리·staged 검사를 읽은 뒤 별도 병합했다.
- [V51](reviews/2026-11-14-v51-codex-verify-u332.md) 높음 0/중간 0/낮음 0. 원래 CLI85/541·APP20/157=105사례/698조건 차이0·205+335봉인 불변. 후보32와 같은 assertion OLD10 통과, 소스40비교·strict hook/Promise 타입 통과. 전체 app.ts는 명시한6경계만 다르고 models 본문은 callee 외 동일하다. pretry 요청/env 복사·io 구성·1await/jsonOutcome/catch·가림과 getter/this·지연 Promise를 유지했다. 공개 함수 종류도 유지했다.
- 초기 OLD의 8통과/1실패/1cancel은 Windows 합성 fixture 경로 비교 오류였고 app.ts 수정 전 path.resolve로 바로잡아 OLD10을 먼저 고정했다. 최초 컴파일/TS5112/EOL 경고 도구 오류도 보존했으며 독립 검증자가 원문 이력을 별도로 보존했다. 후보에 맞춰 기존 oracle·기대값을 고치지 않았다.
- 모델 core→앱 연결의 두 단위가 끝났다. 앱은 CLI models의 값·형을 직접 가져오지 않으며 CLI는 같은 앱 core와 writer를 쓴다. guard/report/init 의존은 남으므로 전체 app→CLI 0은 아직 선언하지 않는다.
- 다음 U-333 INIT-CORE는 codex-check가 helper 포함 core 한 벌과 CLI 외피를 맡고 app.ts는 제외한다. 새 app/init-core.ts·app/init-command.ts, CLI init.ts, app/init.ts의 canonical import, 새 공개/경계 시험을 약950~1300줄로 예상한다. 1500줄 초과 전망이면 helper만 먼저 별도 단위로 분리한다. 질문·숫자/언어 해석·표시를 CLI에 남기고 원래 async question/direct ask/lister·finish 순서를 보존한다. init wx 생성과 CAS writer를 통일하지 않는다. 실제 MODELS 뒤 부모 source gate와 CLI40+APP16 원래 기준을 먼저 확인한다. 앱 직접 연결은 그 뒤 별도 U-334다.
- SEC는 기존 CLI40/APP16을 안전하게 재사용할 provisional 실행 경로를 준비하고 AUDIT는 고정 root를 요구하는 V42 보고서 oracle의 add-only head/출력 격리를 준비한다. 원본 corpus/봉인/기대값/예전 실행 파일은 그대로 두며 안전한 격리를 확인하지 못하면 진행하지 않는다. 그래프 v2와 독립 재검토는 동결됐고 실제 최종 C11 판의 source union/runtime CLI0·unknown0 검사는 아직 남았다. API·키·외부 시험망 금지 및 이전 사용자 질문·한계는 그대로다.

## 진행 요약 (CP-43, 2026-11-14) — 모델 core 채택, 앱 직접 연결 준비

- main/origin/main `474c26c6cd5e0f878a697990be6e42d31a65f149`: U-331 MODELS-CORE 채택·푸시. 구현 `e69587cc`, 최종 판 `b6f610b88f0b5ff9eb5c9f4462ee8989d3ca290b`, 검증·병합 트리 `19c8f4e91711163ae6b33d31ee68d11843223bf9` 일치. 세 파일 +519/-298=817줄이다. app/models-command.ts가 규칙·내부 포트와 원래5await를 소유하고 CLI는 파서·질문·renderer·카탈로그·최종 가림을 유지한다. app.ts·계약·writer·고정 파일은 바꾸지 않았다.
- 최종 PM 실측: 오프라인 npm ci·typecheck/build·GUI build/lock·tracked/staged 비밀 검사 통과. 유닛 4,284 중 4,273 통과/실패 0/skip 10/TODO 1, 통합 684 중 682 통과/실패 0/skip 1/TODO 1, GUI 426/426, smoke 227/227, CLI 95사례 차이 0, 고정 파일 5개 변경 없음. 증거 `.worktrees/pm-unit/.codaryn/codex-u331-final-evidence/`. 결과를 읽고 독립 검증을 연 뒤 최종 보고·정확한 트리·staged 검사를 확인해 별도 병합했다.
- [V50](reviews/2026-11-14-v50-codex-verify-u331.md) 높음 0/중간 0/낮음 0. 원래 CLI85/541·APP20/157=105사례/698조건 차이0,205+335봉인 불변. 관련95·프로세스40=135시험과 OLD 공개8 대조 통과, 소스40비교·타입 호환 통과. renderer/catalog/helpers·currentModel과 flow의 지정 callback 경계 외 원문이 같고, core type83/runtime45 전이에서 CLI0이다. 전체 앱 의존0은 아직 아니다.
- runModels의 AsyncFunction→일반 Function 및 constructibility/prototype 차이는 공개한다. 실제 소비자는 await Promise 계약을 사용하고 parse 거부/동기 예외/core Promise 직접 반환·기존 getter/this·5await·동기 완료 순서를 보존했다. C10과 같은 기술 경계로 수용하며 새 함수 반사 계약을 선언하지 않는다. 값·형·공개 CLI runtime export 네 개는 유지했다. raw key/context는 같은 프로세스 내부 completion에만 있고 공개 결과/IPC를 늘리지 않았다.
- 다음 U-332 APP-MODELS-DIRECT는 codex-check 구현/codex-probe 검증으로 app.ts의 models/import·동형 hook형과 새 공개 시험만 소유한다. 기존 pre-try 요청/env 복사, io literal 평가 순서, private Promise adapter, jsonLine→scrub→전체 hideKeys→기존 jsonOutcome을 유지한다. 원래105기준을 다시 적용하며 core/CLI/계약/기존 시험은 제외한다. PM은 검증 후보→채택 전체 트리와 문서 전용 부모의 제품/빌드 입력 동일성을 기계적으로 확인해 실제 부모 gate를 기록한 뒤 구현을 연다. 이 연결은 새 판의 재생 성공으로 세지 않는다.
- INIT은 실제 소스분량상 helper 포함 core 약950~1300줄→앱 직접 연결 약180~350줄이 기본안이다. 실제 core가1500줄을 넘을 전망일 때만 helper 단위를 먼저 분리한다. CLI suggestedScripts와 앱 scriptsIn의 protected-lstat/직접fs 순서는 합치지 않고 init의 wx 생성을 CAS writer로 통일하지 않는다. 실제 MODELS 뒤 부모 확인과 CLI40+APP16 기준은 그대로 필요하다.
- [그래프 v1 도구 검토](reviews/2026-11-14-graph-tool-v1-review.md)의 runtime builtin alias 중간1은 [동결 v2 재검토](reviews/2026-11-14-graph-tool-v2-review.md)에서 닫혔다. 원래30입력147파일·추가8회귀/총38확인, source/runtime 실제 재현이 모두 incomplete로 막히고 새 발견0이다. v1/v2 봉인1282/889와 OLD source955/runtime549 CLI12/unknown0·입력/출력 핀을 보존했다. 도구 재사용 READY일 뿐 최종 C11의0 판정이 아니며 실제 최종 판 archive/fresh build/혼합source union+runtime CLI0/unknown0이 모두 필요하다. 실제 API·키·외부 시험망 금지 및 이전 질문·한계는 그대로다.

## 진행 요약 (CP-42, 2026-11-14) — 설정 writer 채택, 모델 core 준비

- main/origin/main `9a0f33284f047af9f5a48c2da5782ccc5f466b8d`: U-330 CONFIG-WRITER 채택·푸시. 구현 `1af048d4`, 최종 판 `4b8598f88aa535594366b50bee6f7cea0288d14a`, 검증·병합 트리 `c26ef3c06efd851607280e4efeee28b2fec64889` 일치. 네 파일 +240/-86=326줄이다. app/config-write.ts가 writer 단일 원천이고 CLI는 같은 두 함수·형을 재수출한다. LF/BOM은 내부 공유이며 CLI public export는 네 개 그대로다. settings-change의 import 한 줄 외 소비자·모델 선택/질문/renderer·app.ts는 그대로다.
- 최종 PM 실측: 오프라인 npm ci·typecheck/build·GUI build/lock·tracked/staged 비밀 검사 통과. 유닛 4,272 중 4,261 통과/실패 0/skip 10/TODO 1, 통합 684 중 682 통과/실패 0/skip 1/TODO 1, GUI 426/426, smoke 227/227, CLI 95사례 차이 0, 고정 파일 5개 변경 없음. 증거 `.worktrees/pm-unit/.codaryn/codex-u330-final-evidence/`. 집계 후 독립 검증을 열고 최종 보고를 읽은 뒤 별도 병합했다.
- [V49](reviews/2026-11-14-v49-codex-verify-u330.md) 높음 0/중간 0/낮음 0. 원래 26관찰(계약 안25/밖JS1) JSON bytes 동일·14봉인 유지, 공개14+관련130+프로세스40=184시험 통과. 8블록/주석·CLI 나머지·settings import만 확인, 같은 함수 binding·옵션형·오류/cleanup 우선순위 유지. 새 core의 runtime은 builtin3, type 폐쇄의 CLI 도달0이며 전체 앱 의존0을 선언하지 않았다.
- 별도 [모델 소비자 검증](reviews/2026-11-14-u330-models-consumer.md)도 높음 0/중간 0/낮음 0이다. CLI85/541·APP20/157=105사례/698조건 차이0, 원래205+335봉인 불변. writer 이동 후에도 모델 호출·가림·getters/Promise 경계가 같다. 실제 post-writer M1 부모 확인 전에는 구현 승인으로 쓰지 않는다.
- 작업자 최초 프로세스37통과/3실패는 설치 내부 TEMP 설정 오류였고 제품 수정 없이 외부 전용 TEMP로 해당 두 파일만 재실행40통과했다. 최초 로그 및 독립 검증 도구 초기 오류는 보존했다. READY 후 PM 커밋에 따라 작업자의 oldHEAD assertion이 멈춰 final-state.json은 생성되지 않았다는 정정을 받았다. 소스 네 해시는 같았으며 없는 파일을 증거로 쓰지 않고 정확한 판을 새로 전체·독립 검증했다.
- [V48 해시 출처 보충](reviews/2026-11-14-v48-hash-format.md): archive CRLF와 raw Git LF는 594줄/594바이트 차이이고 줄 끝만 변환하면 양방향 bytes 동일하다. V48의 두 형식 지문은 모두 맞으며 고정판·채택판·문서판의 raw blob도 같다. 기존 보고서·봉인·기대값을 고치지 않았다.
- 다음 U-331 MODELS-CORE는 codex-loop 구현/codex-probe 검증으로 새 app/models-command.ts·CLI models.ts·새 관련 시험을 소유한다. app.ts와 공개 계약은 제외하고 core와 앱 직접 연결을 직렬로 나눈다. 실제 채택 부모 source gate 후 시작하며 sync completion·기존 ask Promise·getter/this·최종 JSON/전체 가림 순서를 보존한다. CLI85와 APP20을 core 단계부터 함께 검증한다. 1,500줄을 넘는 논리 폐쇄는 별도 분할한다.
- 최종 그래프 도구의 독립 검토에서 package imports alias가 node:module로 해석되는 합성 runtime 사례의 거짓0을 찾았다. 같은 사례는 source에서 incomplete여서 이중 게이트 우회·제품 결함으로 주장하지 않는다. 원본 도구/30사례/봉인은 보존하고 SEC가 별도 v2에서 실제 해석 뒤 capability를 판정하도록 수정 중이며 AUDIT 재확인 전 최종 완료에 쓰지 않는다. 기존 API·키 파일·외부 시험망 금지, 사용자 질문과 한계는 그대로다.

## 진행 요약 (CP-41, 2026-11-14) — 전체 파서 채택, 설정 writer 준비

- main/origin/main `056ed984730df0932ca0fab1e1059bfc551215d3`: U-329 C11-ARGS 채택·푸시. 구현 `dac2ad05`, 정확한 최종 판 `79371e7d19b7abb28bc1415d5000420e3d5dad2b`, 검증·병합 트리 `94630692419f510f0319e094f19bee00748c51a2` 일치. 네 파일 +644/-595=1,239줄이다. 원래 594줄 parser는 app/input/args.ts로 옮기고 상대 import 7곳만 바꿨다. CLI args.ts는 모든 값·형의 재수출, app.ts는 import 원천 한 줄만 바꿨다. 기존 runs 전용 파서는 그대로다.
- 최종 PM 실측: 오프라인 npm ci·typecheck/build·GUI build/lock·tracked/staged 비밀 검사 통과. 유닛 4,258 중 4,247 통과/실패 0/skip 10/TODO 1, 통합 684 중 682 통과/실패 0/skip 1/TODO 1, GUI 426/426, smoke 227/227, CLI 95사례 차이 0, 고정 파일 5개 변경 없음. 증거 `.worktrees/pm-unit/.codaryn/codex-u329-final-evidence/`. 종료 집계 후 독립 검증을 열고 최종 보고를 읽은 뒤 정확한 SHA·트리로 별도 병합했다.
- [V48](reviews/2026-11-14-v48-codex-verify-u329.md) 높음 0/중간 0/낮음 0. 원래 262호출/399조건 차이 0, 옛/새 26값 Object.is 동일, 10함수·15문자열 bytes·contracts 정규식 binding 유지, 18옛 경로 형·18개 양방향 및 canonical 3형 호환 통과. 관련 204시험·c01 프로세스 24시험 통과, 원래 25봉인 불변이다. parser JS는 contracts 경로, app TS/JS는 parser import 외 동일하다. source map까지 동일하다고 주장하지 않는다.
- adapter-contract 현재 입력 그림·의존 설명·7.2 상태만 갱신했다. 과거 U308 실측 및 옛 main의 설계 이력은 보존했다. CLI 계약의 동작이나 문구는 바꾸지 않았다. 전체 app→CLI 의존 0은 아직 아니다.
- 다음 U-330 설정 writer는 codex-check 구현/codex-loop 독립 검증이다. 새 app/config-write.ts·CLI models facade·app/settings-change.ts import·새 공개/fs 시험만 소유하고 app.ts·app/models.ts·모델 선택/질문/renderer는 제외한다. LF/BOM은 새 앱 모듈의 내부 export를 CLI에서 local import하며 CLI public export에 더하지 않는다. 원래 오류 우선순위·원자 쓰기·모델 ID 무검증을 보존한다. LOOP가 채택280d148e에서 원래 26관찰(계약 안25/밖JS1)·14봉인·8블록 동일을 확인했으나 실제 post-ARGS 부모의 좁은 확인 전 구현하지 않는다.
- 모델·초기화 후속은 core와 앱 직접 연결을 나눠 채택한다. PROBE의 앱 모델 OLD 20사례/157조건·335봉인과 앱 초기화 OLD 16사례/182조건·333봉인을 준비했다. SEC의 CLI 초기화 OLD는 40조건/40호출(반환35·거부5, 계약 밖 exists 거부1 포함)·같은 OLD 차이 0·80봉인이다. 봉인 전 Symbol 메타데이터 저장 오류의 폐기 실행은 최종 수에 가산하지 않았다. 기존 CLI 모델 85/541과 함께 잠정 기준으로 보존한다. 각 실제 부모 확인과 core 채택 때에도 CLI·앱 기준을 함께 재생해 기존 wrapper 소비자의 경계를 확인한다.
- SEC는 기존 TypeScript 7 native AST/해석기와 fresh dist를 쓰는 최종 그래프 감사 도구를 자기 폴더에서 준비한다. 타입·동적 import·require·재수출·중립 경유 및 불명 경로를 구분하며 정규식 검색이나 예외 목록으로 0을 선언하지 않는다. 아직 최종 후보 검증이 아니다. 실제 API·키 파일·외부 시험망 금지 및 이전 사용자 질문·기존 한계는 그대로다.

## 진행 요약 (CP-40, 2026-11-14) — 공용 정리 B 채택, 전체 파서 이동 준비

- main/origin/main `67d974b902e4115d12ab3d60d72866de902050b9`: U-328 SHARED-B 채택·푸시. 구현 `b7c237ff`, 실제 채택 A 부모 `400c12ae`, 정확한 최종 판 `3b1bf0300d870c4250b5cce736b0c95add1e5a7d`, 검증·병합 트리 `7cc341efb595524c07971014eeee6bc909598c89` 일치. 다섯 파일 +119/-84다. changes-plan-output의 순수 closure만 앱 원천으로 이동했고 옛 CLI와 human index는 같은 값·형을 재수출한다. CLI runIdOf·renderer·질문 tail, app.ts와 A의 reader/resolver는 그대로다.
- 최종 PM 실측: 오프라인 npm ci·typecheck/build·GUI build/lock·tracked/staged 비밀 검사 통과. 유닛 4,230 중 4,219 통과/실패 0/skip 10/TODO 1, 통합 684 중 682 통과/실패 0/skip 1/TODO 1, GUI 426/426, smoke 227/227, CLI 95사례 차이 0, 고정 파일 5개 변경 없음. 증거 `.worktrees/pm-unit/.codaryn/codex-u328-final-evidence/`. A 채택 후 새 union 판의 결과를 읽고 독립 검증을 열었으며 최종 보고를 읽은 뒤 별도 병합했다.
- [V47](reviews/2026-11-14-v47-codex-verify-u328.md) 높음 0/중간 0/낮음 0. 실제 A 부모 15소스 동일, 원래 24사례/48관찰·mask 102호출 차이 0, 관련 72시험 통과, 새/legacy/barrel binding·타입 호환과 원문 closure/tail 확인. 독립 타입 명령 최초 두 번의 설정 오류를 보존했고 명시적 Node 타입 설정의 최종 명령은 실제 종료 0이었다. 원래 34봉인과 expected/harness 불변이며 전체 앱 의존 0 선언은 아니다.
- 다음 U-329 전체 args는 codex-loop 구현/codex-audit 검증으로 직렬 분리한다. 새 app/input/args.ts에 원래 파서 전체를 옮기고 CLI args.ts는 모든 값·형의 같은 binding 재수출, app.ts는 import 원천 한 줄만 바꾼다. 파서 규칙·문구·요청 변환·runs 전용 파서·고정 파일은 바꾸지 않는다. 채택 후 실제 부모의 source gate 확인 전 구현하지 않는다. 잠정 기준은 262호출/399조건·26값/18형·25봉인이다. B의 승인된 plan-view import 변경은 설명해서 대조하며 옛 88개 type 폐쇄 목록을 억지로 유지시키지 않는다.
- 후속 writer는 codex-check 구현/codex-loop 검증으로 분리한다. 실제 소비자는 app/settings-change.ts이며 app/models.ts는 writer를 쓰지 않는다. 새 config-write·CLI models facade·settings-change import·새 관련 시험만 한 단위로 삼고 app.ts·모델 선택/질문/renderer는 제외한다. LF/BOM은 내부 공유 상수로 두고 CLI에서 재수출하지 않는다. 실제 post-ARGS source gate와 기존 26관찰을 먼저 확인한다.
- models core의 독립 OLD 기준은 codex-probe가 eddd72df 자체 archive에서 85사례/541조건·같은 OLD 차이 0·205봉인으로 준비했다. 오류 outcome 31·거부 Promise 10은 의도한 관찰이며 실제 원자 쓰기 검증은 별도 writer 기준이다. 실제 post-args/writer 부모 확인 전 잠정이다. 모델/초기화 core와 app direct를 각각 나누고 JSON·report·최종 AST/fresh-dist 그래프를 뒤에 둔다. 기존 API·키 파일·외부 시험 네트워크 금지, 사용자 질문과 기존 한계는 그대로다.

## 진행 요약 (CP-39, 2026-11-14) — 공용 정리 A 채택, B 통합 검증

- main/origin/main `38d4591e5d4a3cbe4a37b681066d02f9c3ed31bd`: U-327 SHARED-A 채택·푸시. 구현 `35eb7006`, 최종 판 `4c05d17378d71f643c14af7ee8bd83b992401b2c`, 검증·병합 트리 `4385e6f064c6d8ae8da8e1915068f55321be711d` 일치. 네 파일 +25/-9다. app.ts의 기존 앱 환경형 참조와 reader/resolver 원천 import만 정리했고 새 공개 포트는 없다. 컴파일한 app.js 55,889바이트가 OLD와 같고 옛 CLI 함수 binding도 유지했다.
- 최종 PM 실측: 오프라인 npm ci·typecheck/build·GUI build/lock·tracked/staged 비밀 검사 통과. 유닛 4,229 중 4,218 통과/실패 0/skip 10/TODO 1, 통합 684 중 682 통과/실패 0/skip 1/TODO 1, GUI 426/426, smoke 227/227, CLI 95사례 차이 0, 고정 파일 5개 변경 없음. 증거 `.worktrees/pm-unit/.codaryn/codex-u327-final-evidence/`. 종료 집계를 읽은 뒤 독립 검증을 열고 최종 보고를 읽은 뒤 정확한 SHA를 별도 병합했다.
- [V46](reviews/2026-11-14-v46-codex-verify-u327.md) 높음 0/중간 0/낮음 0. 불변 V44 60사례/604조건 차이 0, 31+9봉인 불변, strict 타입 호환 검사와 옛 경로 함수 5개 identity 통과. 관련 93개 고유 사례는 최초 92통과/1환경 실패였으며, 빠진 PowerShell PATH를 보완한 뒤 실패 사례 하나만 재실행해 통과했다. 최초 전체 명령의 종료 1과 재실행 로그를 보존했으며 처음부터 전체 통과였다고 처리하지 않았다.
- U-328 B는 codex-check의 구현 `b7c237ff`로 다섯 파일 +119/-84를 동결했다. 순수 changes 계획 출력 closure만 이동하고 CLI 질문·renderer는 남긴다. 이 문서가 채택된 A main에 B를 합친 정확한 별도 판에서 PM 전체 검사 후 codex-sec의 V47을 받는다. 작업자 옛 기준에서의 시험으로 최종 union 검증을 대신하지 않는다. 다음 args·writer·models·init·표시·최종 그래프는 기존 순서이며 app.ts 작성자는 계속 한 명이다.
- codex-probe는 자체 새 archive에서 models 명령의 OLD 비교 기준만 준비한다. 제품 수정은 없고 실제 args/writer 뒤 parent의 원천 확인 전 구현을 열지 않는다. API·키 파일·외부 시험 네트워크 금지, 사용자 확인 대기와 기존 한계는 그대로다. 전체 app→CLI 의존 0을 아직 선언하지 않는다.

## 진행 요약 (CP-38, 2026-11-14) — C10 완료, 공용 정리 분담

- main/origin/main `ae90664b6180c965c3c23aea50e23eed7c0ec674`: U-326 APP-DOCTOR 채택·푸시. 구현 `a70c71cc`, 최종 판 `de99a20d86905ca035559b835db5d60b946af90e`, 검증·병합 트리 `7f35dc0faef78e70491c39eda5c25b08c0a647a6` 일치. app.ts doctor/import와 새 공개 시험 두 파일만 +193/-4다. 요청·io 구성 원문, inner Promise 한 번 await, 동기 completion의 JSON/전체 가림, 기존 결과·예외 변환을 유지했다. C10의 helper→core→앱 연결 세 단위가 모두 채택됐다.
- 최종 PM 실측: 오프라인 npm ci·typecheck/build·GUI build/lock·tracked/staged 비밀 검사 통과. 유닛 4,224 중 4,213 통과/실패 0/skip 10/TODO 1, 통합 684 중 682 통과/실패 0/skip 1/TODO 1, GUI 426/426, smoke 227/227, CLI 95사례 차이 0, 고정 파일 5개 변경 없음. 결과를 읽은 뒤 V45c를 열고 최종 독립 보고를 읽은 뒤 별도 병합했다. 증거 `.worktrees/pm-unit/.codaryn/codex-u326-final-evidence/`.
- [V45c](reviews/2026-11-14-v45c-codex-verify-u326.md) 높음 0/중간 0/낮음 0. 원래 119+보충 22=141관찰 동일, 후보 88시험·OLD 20시험 통과, 공개 앱 Promise/결과 6쌍 및 CLI 8쌍 차이 0, 입력 101개·봉인 불변. core/types/helper/CLI/args/guard/command-outcome 7파일 바이트 동일. 공개 결과나 IPC에 raw context를 추가하지 않았다. 전체 app→CLI 의존 0은 아직 아니며 C11이 남았다.
- 이행 계획의 문서 절차에 따라 adapter-contract 3절 현재 구조와 7.2 상태 열만 갱신했다. 옛 main b386166/6ef6e3a의 설계·실측 수치는 이력으로 보존했다. CLI 계약에 migration C10 doctor의 낡은 물리 위치 표기는 없어 변경하지 않았고, U100 설계 공백 C-10을 혼동해 고치지 않았다. 원래 호출 경로의 다른 역사 서술을 이번 문서 정정에 섞지 않았다.
- 다음 공용 정리는 U-327 A(이미 앱에 있는 포트형·reader/resolver 원천 직접 참조)와 U-328 B(순수 changes 계획 출력 closure 이동)로 나눈다. A는 codex-loop가 기존 adapter worktree에서 app.ts의 타입 주석/import·run-events/runs import만, B는 codex-check가 기존 store worktree에서 새 changes-plan-output·옛 CLI human facade·changes-plan/plan-view import만 소유한다. B는 app.ts를 수정하지 않으며 새 command-ports나 중복 포트 interface는 필요 없다.
- 이 두 단위는 소유 파일이 겹치지 않으므로 채택된 같은 C10 기준에서 각각 OLD oracle/source gate를 닫은 뒤 구현을 병렬로 열 수 있다. 통합은 A를 먼저 전체 검증·독립 검토·채택하고, B는 A가 채택된 main과 B 단위로 만든 정확한 별도 판에서 다시 전체 검증·독립 검토한다. A 검증자는 codex-audit(기존 V44 원본), B 검증자는 codex-sec(새 순수 출력 기준)이며 구현자와 분리한다. 그 밖의 app.ts 후속은 기존 직렬 순서를 유지한다.
- B 잠정 기준은 codex-sec가 bb382b04의 공개 helper 24사례×두 legacy 경로=48관찰·같은 기준 차이 0·관련 16통과·34파일 봉인으로 준비했다. A는 실제 채택 parent에서 기존 V44 60사례/604조건과 31+9봉인을 확인한다. 소스 확인 전 구현을 열거나 새 결과로 기대값을 재생성하지 않는다. args/JSON/writer의 잠정 기준은 그대로 보존한다. 실제 API·키 파일·외부 시험 네트워크 금지, 사용자 출력 질문과 기존 위험은 이전 CP 범위 그대로다.

## 진행 요약 (CP-37, 2026-11-14) — doctor core 채택, 앱 연결 준비

- main/origin/main `4034eb77b6397a6571574c8e5ed33c1175300bdb`: U-325 C10-2 core 이동 채택·푸시. 구현 `3c01d767`, 최종 판 `62cfd5d30cc5377ac64915228ce59e87d9703f4a`, 검증·병합 트리 `27d503322e3d93abf549ac4c53097de50b0e7dc2` 일치. 소유 4파일 +706/-635=1,341줄. 새 checkDoctor가 점검을 맡고 CLI는 파서·동기 completion 안의 원래 표시/가림을 유지한다. app.ts·기존 helper·renderer는 그대로다.
- 최초 미커밋 후보의 await checkDoctor가 I/O 없는 호출에도 새 중단점을 만들었다. PM 재현에서 호출 직후 terminal 옵션을 바꾸면 출력이 1,342→1,744자로 달라져 채택하지 않았다. 동기 completion과 core Promise 직접 반환으로 고쳤다. 정확한 OLD의 고정 scheduling 8시험은 기준 8통과 → 거부 후보 2통과/6실패 → 수정 8통과이며 trace·출력 bytes/hash도 일치했다. 이전 289시험 통과만으로 이 회귀가 없었다고 처리하지 않았다.
- CLI runDoctor는 Promise<CommandOutcome> 서명·예외 거부·관찰 순서를 유지하는 일반 Promise 반환 함수다. AsyncFunction constructor 종류는 달라진다는 점을 숨기지 않고 PM이 구현 경계로 수용했다. 실제 제품 소비자가 모두 Promise 계약을 사용하고 함수 종류를 검사하지 않음을 독립 검토했다. 광범위 reflection·전역 monkeypatch를 새 공개 계약으로 만들지 않는다.
- 최종 PM 실측: 오프라인 npm ci·typecheck/build·GUI build/lock·tracked/staged 비밀 검사 통과. 유닛 4,212 중 4,201 통과/실패 0/skip 10/TODO 1, 통합 684 중 682 통과/실패 0/skip 1/TODO 1, GUI 426/426, smoke 227/227, CLI 95사례 차이 0, 고정 파일 5개 변경 없음. 실패 0을 읽은 뒤 독립 검증을 열고 최종 보고·정확한 트리·staged 검사를 읽은 뒤 별도 병합했다. 증거 `.worktrees/pm-unit/.codaryn/codex-u325-final-evidence/`.
- [V45b](reviews/2026-11-14-v45b-codex-verify-u325.md) 높음 0/중간 0/낮음 0. 원래 119관찰 + 새 OLD scheduling 22개 = 141개 동일, 관련 76시험 통과, 동일 고정 scheduling의 OLD/후보 8쌍 동일. 원래 봉인·입력 101개 불변. 보충의 v1은 Symbol 진단 저장 오류로 폐기·보존하고, 손실 없이 기록한 별도 v2만 OLD 재생 차이 0을 확인해 사용했다. 후보로 기대값을 재생성하지 않았다. 12개 await 지점과 renderer/helper/app.ts 바이트가 유지됐고 private currentKey 문맥은 공개 결과·IPC에 추가하지 않았다. core 런타임 폐쇄 79모듈의 CLI 도달 0은 전체 앱 의존 0 선언이 아니다.
- 다음 U-326 APP-DOCTOR는 어댑터 구현 경험이 있는 codex-loop의 기존 `.worktrees/claude-adapter`에 맡긴다. app.ts doctor/import와 새 공개 경계 시험만 직렬 소유하고 core/CLI/계약은 동결한다. codex-audit의 읽기 전용 준비안대로 request getter는 기존 try 앞, 전체 io/env/default 구성은 parse 앞, parse 거부도 inner Promise 한 번 await, completion의 jsonLine→전체 hideKeys→기존 jsonOutcome 순서를 지킨다. 구현 전 실제 채택 기준에서 공개 getter/완료 순서 시험을 먼저 실행한다. 독립 검증은 codex-probe다.
- C11 writer 잠정 기준은 codex-loop의 별도 archive에서 원래 공개 함수 26관찰·같은 기준 차이 0·14파일 봉인으로 준비됐다. 그중 25개는 타입 계약 안, 1개는 지원되지 않는 provider 문자열을 넣은 JS 관찰임을 분리했다. 지원 제공자는 anthropic/openai 두 개이며 Gemini 지원을 주장하지 않는다. 보고 문구만 고쳤고 기대값/harness/seal은 보존했다. 그 단위 구현은 다른 담당에게 배정한다. 기존 실제 API·키·외부 시험 네트워크 금지와 출력 질문·남은 위험은 그대로다.

## 진행 요약 (CP-36, 2026-11-14) — doctor helper 채택

- main/origin/main `cf6868bf0de8dfbcca7bbb71c76939306cbf4532`: U-324 C10-1 helper·점검 포트 이동 채택·푸시. 구현 `fc40e42f`, 최종 판 `68e74aed42c0b28e675db2724c995442050a1b07`, 검증·병합 트리 `6a78f509bdb13ad06f5447c184e5e3d55319c7d8` 일치. 지정 4파일 +436/-346=782줄. 새 doctor-checks/types가 단일 원천이고 옛 CLI 값·형 export는 유지한다. app.ts·CLI renderer·runDoctor 본문·고정 시험은 그대로다.
- 최종 PM 실측: 오프라인 npm ci·typecheck/build·GUI build/lock·tracked/staged 비밀 검사 통과. 유닛 4,204 중 4,193 통과/실패 0/skip 10/TODO 1, 통합 684 중 682 통과/실패 0/skip 1/TODO 1, GUI 426/426, smoke 227/227, CLI 95사례 차이 0, 고정 파일 5개 변경 없음. 각 종료 JSON과 집계를 읽은 뒤 V45a를 열고 최종 독립 보고를 읽은 뒤 별도 병합했다. 증거 `.worktrees/pm-unit/.codaryn/codex-u324-final-evidence/`.
- [V45a](reviews/2026-11-14-v45a-codex-verify-u324.md) 높음 0/중간 0/낮음 0. 원래 99+E4 양성 20관찰 모두 동일, 관련 68시험 통과, 입력 101개·봉인 불변. helper 실행문과 주석은 export·환경 타입·EOF 경계 외 동일하며 core·renderer는 바이트 동일하다. 옛 값 binding과 환경/LockState 타입도 확인했다. helper 런타임 폐쇄 70모듈의 CLI 도달 0이며 전체 앱의 의존 0을 선언한 것은 아니다. currentKeys/context를 새 공개 결과나 IPC로 추가하지 않았다.
- 실제 staged 검사에서 새 파일 EOF 빈 줄 두 곳을 발견해 담당이 각 1바이트만 제거하고 재동결했다. cached diff-check와 비밀 검사 통과 뒤 커밋했으며 최종 전체 판은 정리된 바이트로 검증했다. 최초 작업자의 untracked 제외 diff-check만으로 공백 검증을 마쳤다고 처리하지 않았다.
- 다음 U-325는 같은 codex-check의 기존 claude-store에서 점검 본문만 앱 doctor.ts로 옮긴다. 소유 범위는 새 core·필요한 check input/result 형·CLI wrapper이며 app.ts는 U-326까지 제외한다. renderer·parse·마지막 가림·오류/await 순서와 옛 export를 유지하고 앞 단계의 봉인 119관찰을 재생한다. U-326 뒤에만 C-10 전체 완료를 판정한다.
- 뒤 단계 준비는 구현과 겹치지 않는 자기 archive에서 병렬 수행했다. C11-ARGS(codex-audit): 공개 262호출/399조건, value export 26·type export 18, 같은 기준 차이 0, 25파일 봉인. C11-JSON(codex-sec): 25사례/50관찰, 예외 identity/순서·옛 alias 확인, 같은 기준 차이 0, 29파일 봉인. 둘 다 기준 d1a95ce2의 잠정 자료이며 실제 착수 parent 확인·후보 비교 전 통과로 승격하지 않는다. 설정 writer 기준은 codex-loop가 준비 중이고 그 단위 구현은 다른 담당에게 배정해 독립성을 유지한다.
- 새 정책/출력 변경 없이 CP-35의 단위 경계를 따른다. 실제 API·키 파일·외부 시험 네트워크는 미수행이며 사용자 출력 질문과 기존 위험은 이전 CP 범위 그대로다.

## 진행 요약 (CP-35, 2026-11-14) — APP-APPLY 채택, 남은 단위 분할

- main/origin/main `00cfa2b6aa98107089b298a13d684aa8222ee180`: U-323 APP-APPLY 채택·푸시. 구현 `9e86d99d`, 최종 판 `dbb849fe14dfbc98df327e307f9e6c31ce736cd3`, 병합 트리 `0a68b54ec5d3daf4060af37d21d3e16debdac860` 일치. app.ts의 applyPlan/import와 새 시험 두 파일만 바뀌었다. 같은 parse/prepare 뒤 앱 applyLife를 직접 한 번 부르며 기존 raw callback 0회·시작 gate·늦은 조회/this·가림·changes만의 lockLeft를 유지한다.
- 최종 실측: 오프라인 npm ci(빈 user/global npmrc, ignore-scripts)·typecheck/build·GUI build/lock·tracked/staged 비밀 검사 통과. 유닛 4,199 중 4,188 통과/실패 0/skip 10/TODO 1, 통합 684 중 682 통과/실패 0/skip 1/TODO 1, GUI 426/426, smoke 227/227, CLI 95사례 차이 0, 고정 파일 변경 없음. 전체 결과를 읽은 뒤 V-44를 열고, 독립 결과를 읽은 뒤 별도 호출로 병합했다. 증거는 `.worktrees/pm-unit/.codaryn/codex-u323-final-evidence/`다.
- 검증자의 최초 preload 경로 오류에서 이전 판 로그 사본이 섞인 것을 발견해 격리했다. 검증 세션의 Windows sandbox에서 끝나지 않은 유닛·통합과 기동 실패한 Electron도 별도 보존하고 통과 수치에서 제외했다. PM 환경에서 같은 환경 격리 명령을 끝까지 실행한 유닛·통합·smoke의 새 로그/종료 JSON이 최종 근거다. 제품 assertion·정규화·ACL은 바꾸지 않았다. 중단한 sandbox 실행의 모든 자손 종료까지 증명하지는 못했으며 광역 process kill도 하지 않았다.
- [V-44](reviews/2026-11-14-v44-codex-verify-u323.md) 높음 0/중간 0/낮음 0. 독립 공개 앱 60사례·604조건 차이 0, 관련 13파일 57시험 통과, 원래 31개와 보충 9개 봉인 불변. 동시 append의 저장 seq별 boxed 오류는 undefined/null/Error도 자기 Promise에만 대응하며 앱 이벤트 래퍼를 중복하지 않는다. 기존 callback 미전달이나 기존 경쟁 한계를 수정 성과로 세지 않는다.
- 사용자 지시("작업 단위를 잘 분할해서 잘 분배")에 따라 doctor는 U-324 helper·점검 포트, U-325 core, U-326 공개 앱 직접 연결로 나눈다. 구현은 codex-check의 기존 `.worktrees/claude-store`를 재사용하고, 독립 비교는 codex-probe가 맡는다. U-324/325에는 app.ts 수정권이 없다. 채택 소스의 독립 기준 확인 후 각 단위를 열며, 다음 구현은 앞 단위 독립 검증·병합 뒤 시작한다.
- C-11 준비는 codex-loop가 공용 포트/계획 출력 → 전체 args → 설정 writer → models → init → JSON → report → 독립 그래프의 기능 경계로 나눴다. models/init이 커지면 규칙 추출과 앱 연결도 나눈다. app.ts 수정권은 한 명씩 직렬로 넘긴다. codex-sec는 기존 TypeScript 7의 unstable/sync·ast를 로컬 확인했고, 소스(타입 포함)와 fresh dist의 전이 그래프를 각각 검사하는 방향을 채택했다. 미해석/계산 로딩은 의존 0으로 숨기지 않는다. 아직 구현·완료 판정은 아니다.
- 위 분할과 검증 준비 보고서는 각 담당의 `.codaryn/`에 있고 현재 소유권은 PM의 `.codaryn/pm-tools/dispatch-current.md`로 추적한다. 실제 API·키 파일 조회·외부 시험 네트워크는 미수행, 기존 위험과 사용자 출력 질문은 CP-31/32 및 CP-25~27의 범위를 유지한다.

## 진행 요약 (CP-34, 2026-11-14) — APP-REVERT 채택, APP-APPLY 기준 확인

- main/origin/main `d68ecab9406c61bb0c50d5bd60d039a3143b6e8b`: U-322 APP-REVERT 채택·푸시. 구현 `8cfa7ee4`, 최종 판 `ca00809ca4e474939857cc8a85f954e08de23c25`, 최종 병합 트리 `7c9d0d3f23590afdf943dbc4d225aff79d7b91c4` 일치. app.ts의 revert/import와 새 시험만 바뀌었고 공용 helper·store·CLI·계약·고정 출력은 그대로다.
- 최종 실측: typecheck/build·GUI build/lock 검사·tracked/staged 비밀 검사 통과. 유닛 4,190 중 4,179 통과/실패 0/skip 10/TODO 1, 통합 684 중 682 통과/실패 0/skip 1/TODO 1, GUI 426/426, smoke 227/227, CLI 95사례 차이 0. 전체 판 결과를 읽은 뒤 V-43에 후보를 넘겼고, 최종 독립 결과·트리·staged 검사를 다시 확인한 뒤 병합했다. 증거는 `.worktrees/pm-unit/.codaryn/codex-u322-final-evidence/`에 있다.
- [V-43](reviews/2026-11-14-v43-codex-verify-u322.md) 높음 0/중간 0/낮음 0. 공개 revert 54사례·접근 사건 1,298개·파일/기록/잠금·오류 키 순서 일치, 관련 30시험 통과(새 7 포함), 봉인 71파일 불변. 최종 비교는 PID와 복원 임시 이름만 좁게 대응했다. 동의 선검사·adapter 바인딩·단일 원복·loadPlan 부재·dryRun·lockLeft sibling을 보존했다.
- 첫 독립 재생의 Windows 경로 치환 오류로 검증자 자신의 이전 비봉인 실행용 fixture가 재처리됐다. 그 실행은 전부 폐기하고 오류 증거를 보존했다. 봉인 expected/prestate/스크립트 71파일은 변하지 않았고, 새 fixture와 쓰기 경로 guard로 다시 비교했다. 최종 쓰기 가능 경로 인수 341개는 각 새 fixture 안이었다. 이전 시도 경로 194개는 실제 수정 파일 수가 아니며 저장소/작업자 트리는 변경되지 않았다. 이 도구 오류를 제품 결함이나 유효한 통과 수치로 섞지 않았다.
- 다음 U-323 APP-APPLY를 기존 `.worktrees/claude-adapter`, `unit/U-323-codex-loop`, 기준 d68ecab9에서 시작했다. codex-loop가 app.ts의 applyPlan/import와 새 `tests/unit/app/u323-apply-direct.test.ts`만 직렬 소유한다. codex-audit가 채택 원천의 6개 app 블록·26개 의존 파일 및 원래 봉인 31개·추가 봉인 9개의 불변을 확인한 뒤 구현 배정을 열었다. 기존 raw callback 0회, masked event/confirm의 횟수·지연 조회·this·시작 gate·취소·환경·오류 순서를 유지한다. 기존 수명·공용 helper·계약·GUI는 소유 범위에 넣지 않는다.
- V-44 기준 준비는 기존 46+4시나리오/451조건에 유효한 읽기 제외 10사례/153조건을 별도 봉인으로 추가했다. 네 원천의 승인 경로 제외는 모델 전 plan_stale, 실행 중 private read/write는 unreadable_path, 명령 validator와 함께면 준비 단계 invalid_task를 구분했다. 기존 잘못된 privacy 필드 사례는 입력 거부 대조로 유지했으며 기대값을 새 결과로 덮지 않았다. 후보 U-323 검증은 아직 아니다.
- C-10 독립 기준은 codex-probe가 준비 중이다. C-11에서 새로 남은 jsonLine 의존은 순수 함수·주석만 `src/presentation/json.ts`로 이동하고 guard의 같은 binding 재수출과 planJsonLine identity를 유지하기로 했다. ASCII 직렬화·두 단계 가림·기존 오류 경계를 바꾸지 않는다. C-10 뒤 배정할 기술 경계이며 아직 구현하지 않았다. 운영 문구 정정은 15e981cb로 반영·교차 검토 완료, 미해결 제품 위험은 CP-31/32의 범위 그대로다.

## 진행 요약 (CP-33, 2026-11-14) — APP-REPORT 채택, 현재 운영 지시 정리

- main/origin/main `e52ac23e07199b13aeccdc85f96ba54c90747cd1`: U-316 APP-REPORT 채택·푸시. 구현 `5f68f0c4`, 최종 판 `4122f0846394d512e327b5e851c4203615745b9d`, 최종 병합 트리 `f9db08f0210aeb0e46c3669b4251948d8a791737` 일치. report/reportMarkdown은 앱 readReport를 직접 부르며 기존 파서·renderer·직렬화·최종 가림을 유지한다. 앱→CLI 의존 0을 주장하지 않는다.
- 최종 실측: typecheck/build·GUI build/lock 검사·tracked/staged 비밀 검사 통과. 유닛 4,183 중 4,172 통과/실패 0/skip 10/TODO 1, 통합 684 중 682 통과/실패 0/skip 1/TODO 1, GUI 426/426, smoke 227/227, CLI 95사례 차이 0. 고정 출력 파일 변경 없음. 로그는 `.worktrees/pm-unit/.codaryn/codex-u316-final-evidence/`에 보존했다. 최초 staged 검사에서 합성 시험값 표기 2건을 발견해 실행 바이트가 같은 분할 fixture로 고쳤고, 재검사 발견 0 뒤 커밋했다. 시험의 네트워크형 경로도 127.0.0.1로 맞췄다.
- [V-42](reviews/2026-11-14-v42-codex-verify-u316.md) 높음 0/중간 0/낮음 0. 사전 봉인한 공개 앱 352+16호출 차이 0, 기본 호출의 파일 접근 순서 동일, 독립 조건 90개 통과, 253개 봉인 항목 불변, 관련 49시험 통과. JSON 직렬화 경계의 합성 현재 값이 기존 internal_error를 만드는 경우도 보존했다. 직접 CLI 모듈 의존은 jsonLine 때문에 8→9, 간접 CLI 모듈은 양쪽 22이며 C-11에서 정리할 잔여다.
- U-322 APP-REVERT를 codex-loop에게 배정했다. 기존 `.worktrees/claude-workspace`, `unit/U-322-codex-loop`, 기준 e52ac23e. 소유 파일은 app.ts의 revert/import와 새 `tests/unit/app/u322-revert-direct.test.ts`뿐이다. 동의 선검사·파서·잠금·오류/JSON·lockLeft를 보존하며 app startRevert→revertOnce 1회→revertOutput을 직접 연결한다. loadPlan·취소·새 가림 정책을 추가하지 않는다. app.ts 작성자는 한 명이며 뒤의 applyPlan은 아직 구현하지 않는다.
- codex-sec의 V-43 기준은 최종 U-316 판에서 공개 revert 54사례·파일 접근 1,298 events·관련 23시험으로 고정됐다. 수집 당시에는 미채택 후보였으나 위 최종 병합 트리 일치로 같은 원천임을 확인했다. 후보 U-322는 아직 미검증이다. codex-probe가 APP-APPLY 준비를, codex-check가 운영 규칙 점검을 맡았다.
- APP-APPLY 준비에서 기존 앱 소비자의 onStoredRecord/onStoredRunRecord가 0회 전달됨을 확인했다. PM은 이번 이행에서 0회 동작을 유지하고 masked event·confirm만 기존 횟수/시점/this로 전달하도록 정했다. 계약상 선택 콜백의 실제 연결은 별도 후속 검토로 남기며 raw 기록이나 새 handle/IPC 필드를 이번 연결로 열지 않는다. codex-audit가 e52ac23e에서 변경 전 공개 API 기준을 준비하되 U-322 채택 후 같은 apply 원천인지 확인한다.
- 사용자 지시대로 PM·오케스트레이션과 규칙 관리를 계속한다. [운영 문구 감사](reviews/2026-11-14-codex-rules-audit.md)는 중간 4/낮음 1을 찾았으며 제품 결함이나 실제 잘못된 병합의 수치가 아니다. 기존 지시를 반영해 AGENTS/workflow/personas/handoff의 Codex 전용 배정, 미보고 커밋에도 재작성 금지, 관리자도 worktree add 금지, 명시 배정 범위에서만 main 병합, 최신 체크포인트 우선 문구를 정리했다. 과거 체크포인트·종료한 위임 owner는 보존했다. 새 권한·정책을 추가한 것이 아니다.

## 진행 요약 (CP-32, 2026-11-14) — U-321 한정 수정 채택, APP-REPORT 검증 준비

- main/origin/main `e56ba0dcbfac87dd119b6f8da98fb2cc3e1c0d78`: U-321 cleanup 메타데이터 검증을 채택·푸시했다. 구현 `399f7731`, 최종 판 `00f7085cc3dc77cb756ecd1c0eff5482832a7e94`; main 병합 트리 `c375487582e12759687d8d7f43ac49a47539994d`가 검증 판과 같았다. 작성자·본문 없는 커밋·staged 비밀 검사를 확인했다.
- 최종 실측: typecheck/build 및 tracked/staged 비밀 검사 통과. 유닛 4,179 중 4,168 통과/실패 0/skip 10/TODO 1, 통합 684 중 682 통과/실패 0/skip 1/TODO 1, GUI 426/426, smoke 227/227, CLI 95사례 차이 0. 고정 출력 파일 변경 없음. 유닛의 추가 skip 2는 파일 symlink 권한과 열린 부모 디렉터리 rename 거부다. 통합 로그 끝의 assertion은 기존 U-295 TODO이며 실패 건수는 0이다. 증거는 `.worktrees/pm-unit/.codaryn/codex-u321-final-evidence/`에 보존했다.
- [V-41b](reviews/2026-11-14-v41b-codex-verify-u321.md): 신규 0/0/0, 최종 archive 전용 시험 20통과/2skip, 실제 CLI/앱 24회와 store 16경계. 준비된 정션·하드 링크를 삭제 전에 거부하고 선택 기록을 보존했다. **기존 중간 잔여 위험은 미해결**: 마지막 검사 뒤 부모 교체로 외부 `.gitignore` 2바이트 쓰기, 마지막 검사 뒤 로그의 새 hard-link alias 추가로 같은 inode의 로그 137바이트 노출. 기준에도 같은 결과가 있고, 이번 채택은 정적으로 준비된 공격과 실행한 교체 경계의 한정 수정이다. 모든 경쟁 조건의 안전성을 승인한 것이 아니다.
- U-316 APP-REPORT 구현은 codex-loop가 지정 두 파일만 완료했다. 기준에서 새 4시험을 먼저 통과시켰고 변경 뒤 관련 58시험·typecheck/build가 통과했다. PM 검토 중 시험의 네트워크형 경로를 loopback 표기로 맞추도록 지시했다. 아직 커밋·판 검증·채택 전이다. codex-audit는 기준 23a41eaf 공개 앱 352호출과 추가 16호출, 90 assertion을 고정했고 같은 기준 재실행에서 결과·파일 호출 순서 차이가 없었다. 후보에 대한 판정으로 세지 않는다.
- 사용자 지시에 따라 Codex pane 명령 전달은 재확인하지 않는다. `herdr --skill`의 명령과 실제 pane을 확인해 기존 Codex만 배분한다. 세션 한도·크레딧 질문에는 답하지 않는다. U-316 다음은 앱 revert, applyPlan을 직렬로 진행한다. codex-sec의 revert 준비, codex-check의 C-10 준비 갱신, codex-probe의 C-11 의존 정리가 완료됐다.
- C-11의 구현 경계를 [이행 계획의 2026-11-14 보완](reviews/2026-11-13-cli-migration-plan.md)에 기록했다. 기존 출력과 옛 경로 재수출을 보존하며 공용 순수 파서·표시 모듈을 옮기는 기술 선택이다. 새 기능이나 출력 변경 승인이 아니다. 기존 V-40 낮음 잠금 잔류와 U-321 경쟁 경계는 별도 미해결 항목으로 유지한다.

## 진행 요약 (CP-31, 2026-11-14) — C-7b 채택, 앱 후속 시작

- main/origin/main `23a41eaf801d20a0ab365b8075936358e44e1688`: U-320 C-7b CLI apply 수명 전환 채택·푸시. 구현 `374103ff`, helper 거부 복구 `89f279bb`. 최종 판 `f930d147fa7374b7db7ffab713040854735fb76f`, main 병합 트리 `05d659f2751f4e439070a9e221fb28f0eb67c658`가 검증 판과 같았다. 최초 write-tree는 샌드박스의 index.lock 쓰기 거부로 실패했고, 허용된 권한으로 다시 산출해 일치를 확인했다.
- 최종 실측: typecheck/build·tracked/staged 비밀 검사 통과, 유닛 4,166 중 4,157 통과/실패 0/skip 8/TODO 1, 통합 675 중 673 통과/실패 0/skip 1/TODO 1, GUI 426/426, smoke 227/227, CLI 95사례 차이 0. 고정 출력 파일 변경 없음. `.worktrees/pm-unit/.codaryn/codex-cp28/`의 수정판 로그와 `compare-u320-b.md`, 거부했던 첫 판은 `codex-u320-first-evidence/`에 보존했다.
- [V-39](reviews/2026-11-14-v39-codex-verify-u320.md)의 낮음 1 helper 거부 차이를 수정했다. [V-39b](reviews/2026-11-14-v39b-codex-verify-u320.md) 0/0/0: 직접 moves 계획 거부의 전체 오류·파일 불변, 정상 changes/run의 load 1→assemble 1, 봉인 기준 26사례/84호출 차이 0, 일반 run 12사례/72호출 차이 0, 관련 104시험 통과. task:run이라는 지원 전제를 보존하며 잘못된 종류에 새 쓰기 권한을 열지 않는다.
- [V-40](reviews/2026-11-14-v40-codex-verify-u320.md) 새 회귀 0/0/0. 기존 낮음 L1은 미해결 후속 항목: moves 적용의 잠금 획득 뒤 cancelSignal 생성이 예외를 던지면 try/finally 진입 전이라 잠금이 남는다. 합성 주입에서 재현, 기본 CLI 등록 100회 정상·일반 입력으로 실제 등록 실패 미재현. 이행에서는 고치지 않았다.
- U-321 보안 수정 후보 `399f773121a28c2dd5a7d0bc860dfc02b6f9d917`를 PM이 검토·검사 후 작업 브랜치에 커밋했다. [V-41 분기 검증](reviews/2026-11-14-v41-codex-verify-u321.md): 새 회귀 0/0/0, 준비된 상태 정션/로그 하드 링크 차단과 선택 기록 보존, 관련 42통과/2skip. 정상 CLI 35쌍 동일+상태 정션의 의도된 거부 1쌍, 앱 11쌍과 추가 정상 4쌍 동일. **최종 통합판은 아직 미검증·미병합**.
- U-321의 보장 범위는 정적으로 준비된 M1와 실행한 교체 경계까지다. 기존 중간 경쟁 경계는 남는다: 최초 `.gitignore` 쓰기 직전 부모 교체로 외부 2바이트 생성, 마지막 검사 뒤 하드 링크 추가로 외부 alias에 로그 137바이트 추가가 기준/후보에서 같이 재현됐다. 모든 경쟁 조건을 닫았다고 보고하지 않는다. 개별 파일 손잡이는 부모 경로와 향후 링크 수를 잠그지 못한다.
- U-316 APP-REPORT는 codex-loop가 기존 claude-adapter의 `unit/U-316-codex-loop`, 기준 23a41eaf에서 구현한다. app.ts의 report/reportMarkdown 및 필요한 import, 새 `tests/unit/app/u316-report-direct.test.ts`만 소유한다. app readReport를 직접 부르되 기존 검사 순서·JSON/Markdown·두 단계 가림·끝 개행을 유지한다. 렌더러와 파서는 기존 것을 사용하며 앱→CLI 의존 전부가 없어졌다고 주장하지 않는다. codex-audit가 변경 전 공개 앱 결과를 독립 기준으로 고정한다.
- 다음 앱 작성 순서는 report 채택 → revert → applyPlan. 다른 app.ts 작성자는 없다. codex-probe는 C-11의 남은 의존과 렌더러·파서 경계를 읽기 전용으로 정리 중이고, C-10 준비 보고는 완료됐다. U-321은 별도 보안 후보로 독립 검증과 전체 판 검사를 거쳐 판단한다.

## 진행 요약 (CP-30, 2026-11-14) — U-318 채택, C-7b 호환성 재확인

- main/origin/main `406d3860cd4f3dd0a2b053ed03ae0ee51cf76246`: U-318 GUI 경로 가림 수정까지 병합·푸시했다. 최초 시험 판 `91d98b64`, 최종 판 `9b589b3f`는 이후 PM 보고서 문서만 달랐다. 제품 차이 없음과 최종 병합 트리 `3043cfb9f46d6fb9d1db1b5ef345156694a580fe` 일치를 확인했다.
- U-318 실측: 유닛 4,150 통과(전체 4,159/skip 8/TODO 1), 통합 673 통과(675/skip 1/TODO 1), GUI 426/426, smoke 227/227, 모두 실패 0. [V-38b](reviews/2026-11-14-v38b-codex-verify-u318.md) 새 회귀 0/0/0, 후보 4시험 통과, 다른 사유의 화면 24쌍 동일. 기록은 `.worktrees/pm-unit/.codaryn/codex-u318-evidence/`에 보존했다.
- U-320 C-7b: codex-loop 구현 `374103ffde87aa1f716ae445bd270cb917f4d82b`(PM이 지정 5파일을 검토·검사 후 작업 브랜치에서 커밋). 후보판 `372ad5355f414e889088aca40db00d64a8e8f50b`. typecheck/build/비밀 검사 통과, 유닛 4,155/4,164(실패 0/skip 8/TODO 1), 통합 673/675(실패 0/skip 1/TODO 1), GUI 426, smoke 227, CLI 95사례 차이 0. **아직 미채택**이다.
- C-7b 독립 기준: codex-audit가 전환 전 e7229c03에서 고정한 26사례/84 CLI 호출과 기대값 해시를 그대로 후보에 적용해 차이 0. 일반 run 12사례/72호출도 차이 0. 그러나 시험용 export `applyChangesPlan`에 moves 계획과 plan:apply task를 직접 주면 기존에는 run_not_plan/plan_kind_differs로 거부했는데 후보는 이동·폐기를 수행했다. 제품 호출자는 없고 문서의 task:run 전제 밖이지만, PM은 이행에서 해당 helper의 쓰기 허용 범위를 넓히지 않도록 기존 거부 복구를 지시했다. codex-loop가 같은 파일 소유권으로 수정하고 V-39 재확인을 받는다. 현재 판을 통과로 병합하지 않는다.
- V-40(codex-sec)는 동의·잠금·취소·가림의 별도 보안 검증 중이다. 기준에도 있는 cancelSignal 생성 예외 뒤 잠금 잔류 후보를 분리해 조사한다. C-7b에서 기존 결함을 몰래 고치지 않는다.
- 별도 U-321: codex-check가 기존 claude-store를 재사용, `unit/U-321-codex-check`, 기준 406d3860에서 cleanup M1 수정 중이다. 소유 파일은 `src/store/cleanup.ts`, 새 `tests/unit/store/u321-cleanup-metadata.test.ts`, 새 `tests/integration/u321-cleanup-metadata.test.ts` 세 개. 공통 ensureStateDir/lock/계약/CLI/고정 출력 수정 금지. 정적 상태 정션과 로그 하드 링크를 첫 외부 쓰기·삭제 전에 거부하며 잔여 경쟁 조건을 명시한다. 별도 보안 단위로 검토하고 이행 후보에 섞지 않는다. codex-sec이 작성자와 분리해 재검증한다.
- 사용자 상시 지시 추가 확인: **기존 Codex pane 명령 전달은 재확인 없이 바로 한다.** `herdr --skill`에 따른 명령과 실제 agent 이름을 쓰고, `herdr agent prompt` 허용 규칙을 사용한다. Claude는 배정하지 않으며 사용 한도·크레딧 선택은 사용자 몫이다.
- C-10 준비(codex-check)와 app.ts 세 후속 준비(codex-audit)는 보고서로 완료됐다. 구현 순서는 C-7b 채택 → app.ts report/revert/applyPlan 직렬 전환 → C-10/C-11이다. app.ts는 아직 작성자 미배정이다.

## 진행 요약 (CP-29, 2026-11-14) — U-319 채택, Codex 전용 배분

- 현재 PM은 codex-review(w3:p3). 사용자 재확인대로 `herdr --skill`·설치된 도움말·HERDR_ENV=1·실제 세션 목록을 확인하고 **기존 Codex만** 배정한다. Claude 세션이나 한도·크레딧 화면은 조작하지 않는다. Herdr 서버 접속에 필요한 권한은 사용자 승인으로 확보했다.
- 회수 문서 `647a3bcf`와 U-319 채택 `e7229c030d10f333e42c64ee72a55017ebac7557`을 origin/main에 푸시했다. U-319 판은 `ac91a17ac0a02f2d68d81d2785303dc6abc3ae05`, 병합 트리는 검증 트리 `afe7e82935a219d1da69c515c805a978f4a4291e`와 일치했다. 작성자·단일 제목·trailer 없음과 staged 비밀 검사를 확인했다.
- U-319 최종 PM 실측: 오프라인 npm ci, typecheck, build, tracked/staged 비밀 검사 통과. 유닛 4,159 중 4,150 통과/실패 0/skip 8/TODO 1, 통합 675 중 673 통과/실패 0/skip 1/TODO 1, GUI 424/424, Electron smoke 227/227. CLI 비교 95사례 차이 0. 고정 출력 파일 변경 없음. 로그는 `.worktrees/pm-unit/.codaryn/codex-u319-evidence/`에 보존했다.
- 처음 샌드박스 시험은 프로세스 종료·정리 EPERM으로 완료되지 않았다. 후보판 재실행은 사용자 승인된 실행 권한, LANG·키를 상속하지 않는 환경, 설치 경로 밖의 합성 임시 폴더를 사용했다. 처음 잘못 둔 임시 폴더 때문에 발생한 workspace_is_install_dir 실패는 제품 회귀가 아니며 재실행과 구분한다. 위 통과 수치는 재실행의 실제 종료 코드 0을 읽은 뒤 기록했다. 8 skip은 8.3 이름 4개, 파일 링크 권한 2개, 대소문자 구분 파일시스템 1개, POSIX FIFO 1개다.
- 기준 b129ebb8의 별도 샌드박스 재측정은 전체 통과가 아니다. [BASE-28](reviews/2026-11-14-cp28-codex-baseline.md): GUI 424 통과, full unit 미종료, 통합 665 통과/3 실패/1 취소/1 skip/1 TODO, smoke ACL 오류. 환경 제한을 후보판의 위 최종 결과와 섞지 않는다.
- [V-37](reviews/2026-11-14-v37-codex-verify-u319.md): U-319 새 회귀 0/0/0, 관련 59시험, CLI 48쌍·공개 앱 11쌍 일치. **기존 중간 M1** 별도: 상태 폴더 정션 또는 cleanup.jsonl 하드 링크가 바깥 합성 파일 쓰기로 이어짐. 기준에도 재현되므로 이행에 섞지 않았으며 codex-sec에 최소 수정 설계를 배정했다. 미해결 결함이지 해결 완료가 아니다.
- U-318: [V-38](reviews/2026-11-14-v38-codex-verify-u318.md) 0/0/0. 통합 후보판 `91d98b64d38c1e927e9fb8616b0825d9dc171a39`를 기존 pm-unit에 만들었고 PM 전체 검사와 codex-probe의 V-38b 진행 중. 아직 main 미병합.

| Codex | 현재 작업 / 역할 | 소유와 경계 |
| --- | --- | --- |
| codex-loop p8 | U-320, C-7b CLI 개발 | 기존 claude-workspace, `unit/U-320-codex-loop`, 기준 e7229c03. plan-commands.ts/run.ts, 새 표시 연결 시험, 필요한 최소 u280·cli-contract 위치 설명. app.ts·apply-life·계약·고정 출력 제외. push는 PM만 |
| codex-audit pE | C-7b 독립 검증 기대값 준비 | 기준판 archive에서 승인·동의·취소·잠금·기록 순서의 독립 결과를 고정. 구현 파일 수정 없음. app.ts 후속 세 작업의 준비 보고는 완료 |
| codex-check pD | C-10 doctor 전환 준비 | 읽기 전용 범위·옮길 코드·불변식·시험 계획. 구현 배정 전까지 수정 없음 |
| codex-sec pC | 기존 cleanup M1 수정 설계 | 읽기 전용. 공유 ensureStateDir 영향·로그 신원·경쟁 조건·기존 오류 매핑 검토. 구현은 별도 배정 |
| codex-probe pF | U-318 통합판 V-38b | 자기 archive에서 호스트 IPC·메인 상태·한영 화면 재검증 |

- app.ts 작성권은 아직 누구에게도 넘기지 않았다. C-7b 뒤 report → revert → applyPlan을 직렬로 배정한다. 사용자 결정 목록은 CP-25~27을 유지하며 출력 변경을 이행에 섞지 않는다.

## 진행 요약 (CP-28, 2026-11-14) — Codex PM 회수

- 사용자 인계 지시에 따라 codex-review(w3:p3)가 개발 관리자·통합 담당을 맡고 `pm-control.json`의 임시 위임을 `revoked`로 바꿨다. 기존 owner 필드는 종료한 위임의 이력이다. Claude PM의 새 배정·병합·푸시는 종료됐다.
- 회수 전 확인: main과 로컬 origin/main은 `b129ebb80985d0c6a10fac59b3fa2d5b0e4f4003`, main과 두 미완료 단위의 추적 파일은 깨끗했다. 네트워크 fetch로 새 원격 상태를 조회한 것은 아니다.
- U-319: `7cadaea69764593615cde1b7258bc2b368064929`, 기준 분기점 `0a47499b`. 완료 수치가 없고 기존 dist는 변이 시험 중 멈춘 것이므로 다시 빌드한다. PM이 기존 pm-unit에 후보판을 만들고 검증한 뒤 판단한다.
- U-318: `818e58fb91e4be7fedbf3d798b4aa135db7d1fd3`, `.worktrees/claude-gui/.codaryn/report-U-318.md` 완료 보고 확인. 보고된 통과 수치는 아직 PM 재실행 결과가 아니다.
- 배정(별도 git archive 사본, 제품 파일 수정 없음): codex-check는 b129ebb8 전체 기준 수치 재측정(BASE-28), codex-sec은 U-319 독립 보안 검증(V-37), codex-probe는 U-318 호스트·IPC·화면의 경로 가림 독립 검증(V-38), codex-loop는 C-7b CLI 전환 준비. 결과는 `.worktrees/codex-verify/.codaryn/`의 각 보고서에 쓴다. codex-audit는 후속 배정 대기.
- Herdr 서버는 일반 클라이언트 접속을 거부했다. 서버나 권한을 바꾸지 않고 기존 Codex 작업 연결 도구로 위 네 세션에 전달했다. 한도·크레딧 질문은 조작하지 않았다.
- 다음 순서: 기준 수치와 U-319 후보판 검증·독립 검증 → U-319 및 U-318 채택 판단 → C-7b 전환 → app.ts의 report/revert/applyPlan 후속을 직렬 처리 → C-10/C-11. 출력 변경을 요구하는 질문은 CP-25~27의 목록을 유지하고 하나씩 사용자에게 묻는다.
- 실제 API·키 조회 금지, 시험 네트워크는 127.0.0.1, 이력 재작성·amend·검사 우회 금지, 지정 작성자와 trailer 없는 커밋, 새 board worktree 생성 금지, 이행 출력·JSON 유지 규칙을 그대로 적용한다.

## 진행 요약 (CP-27, 2026-11-14 09:26, main `2f2e103`) — Codex로 전수 인계

- **사용자 지시(2026-11-14 09:2x)**: "클로드 이제 토큰 다 썼을거야 코덱스들에게 전수 인계해줘". 임시 PM(w3:p1)은 이 체크포인트를 끝으로 새 배정·병합·푸시를 멈춘다. 인계 문서는 [임시 PM 인수인계](pm-handoff.md)의 "2026-11-14 Codex로 전수 인계" 절이다. `pm-control.json`은 임시 PM이 바꾸지 않았다(회수 규칙: Codex가 `revoked`로 바꾼다).
- **CP-26 뒤 병합한 단위 27개**(새 체계 합계 298개; 병합 커밋 제목에서 셈): U-295, U-294, U-293, U-297, U-298, U-296, U-301, U-302, U-299, U-303, U-300, U-304, U-305, U-307, U-306, U-310, U-308, U-312, U-309, U-311, U-314, U-315, U-317, U-313, 그리고 CP-26 직후의 U-292·U-271(CP-26에 이미 셈)을 뺀 것. 내용은 병합 커밋 제목에 있다.
- **CLI 구조 이행**(DR-65): 16단계 가운데 열둘이 main에 있다 - P-2, C-1, C-2, C-3a, C-3b, C-4, C-5, C-6a, C-6b, C-7a, C-8, C-9a. `codaryn run`, 승인 계획 수행, 계획 보기·검토, report, revert가 앱 계층의 규칙을 쓴다. 앱이 CLI 모듈에 기대는 곳은 26개에서 11개가 됐다(담당이 센 수). 판 비교 사례는 93개. 고정 출력은 바뀌지 않았다.
  - **C-7b(적용을 앱의 수명으로)는 중간이다**: 사례(U-308)·계약(U-309)·앱의 적용 수명(U-313)은 main에 있고 **아직 아무 제품 코드도 `src/app/apply-life.ts`를 부르지 않는다**. 남은 것은 CLI 전환(na-core)과 문서. 전환 판은 Codex 검증과 ne-verify 검토·연기 뒤에 병합한다(U-303→U-300 때와 같은 방식: 분기와 전환을 함께 본다).
  - 남은 단계: C-7b 전환, C-9b(진행 중), C-10, C-11, 그리고 이행 끝의 정리(옛 자리 다시 내보내기, 지금 목록 시험이 지키는 것 약 스무 곳).
- **가장 최근 검증**(U-313 판 `0f4486e`, 트리는 병합 `2f2e103`과 같음, 임시 PM 실행): 타입 검사 통과, 유닛 4,146건 중 4,141 통과·0 실패·todo 1, 통합 675건 중 673 통과·0 실패·건너뜀 1(4 GiB 실측)·todo 1(U-295의 발견), 비밀 검사 통과, 고정 값 변화 없음, GUI 유닛 424건 통과, 판 비교 93사례 차이 0. GUI 연기 시험은 C-9a 판 `4868687`에서 227/227 세 번(ne-verify); **main `2f2e103`에서의 연기 시험은 요청했으나 결과를 받지 못했다**.
- **진행 중인 작업(인계 시점)**
  - na-core(w3:p2): `unit/U-319-na-core`(C-9b, cleanup을 한 벌로; 끝 `7cadaea`까지 커밋 여섯, 완료 보고 전). 이 단위에 한해 `src/app/cleanup.ts`를 na-core가 고친다(PM 예외; p5a가 diff 검토). 판을 만들면 Codex 검증 뒤 병합(파일을 지우는 명령). 그 뒤 C-7b 전환.
  - p5u-gui(w3:pB): `unit/U-318-p5u-gui`(R-119 L-1: GUI의 되돌리기 목록이 CLI는 감추는 경로를 보임; 끝 `818e58f`, 완료 보고 전).
  - p5a-adapter(w3:pA): 다음 차례 U-316(C-8의 앱 쪽: report import, 앱의 report()가 readReport를 바로 부르게), 그 뒤 C-9a의 앱 쪽(앱의 revert()가 옮긴 함수를 바로 부르게; 앱→CLI 11에서 9), na-core의 cleanup diff 검토. 아직 가지 없음.
  - ne-verify(w3:p4): main의 병합 뒤 연기 시험(요청 중).
  - nc-human(w3:p6): 대기. 이행 뒤에 할 것 - 검증을 둔 task가 첫 턴 전에 끝나면 끝 요약이 "Checks: none configured"라고 쓰는 낮음(U-295의 todo; 준비 보고서 있음).
  - nb-i18n, nd-docs, p4g-general: 대기.
- **열려 있는 것**: R-119 L-1(U-318로 고치는 중). `revert --json`의 건너뛴 경로가 원문인데 계약 주석은 "가린 경로"라고 함(JSON을 바꾸는 일이라 사용자 질문). 계획을 claim한 프로세스가 죽으면 계획이 applied로 남고 잠금이 남음(전부터, 한계). 잠금 아래 거부 때 앱이 손잡이를 먼저 줘 GUI에 실행 화면이 잠깐 열림(기능 단위 후보). 해시 조각 크기 두 가지(기능 단위 후보). DR-25 동의 질문을 C-7b의 동의 고리 꼴로 맞추기(이행 뒤 정리 후보). cleanup의 입력 검사를 CLI와 GUI에서 하나로(기능 단위 후보).
- **PM의 실수와 조치**(CP-26 뒤): C-9a를 둘에게 나란히 배정하면서 시험 파일 하나(목록 시험의 표)가 겹치는 것을 확인하지 않았다(담당이 시작 전에 찾아 멈춤; 나란히 배정할 때는 시험 파일의 겹침도 나눔에 적게 한다).
- **확인하지 않은 범위**(그대로): 실제 Anthropic·OpenAI API 호출(한 번도 없음), 실제 터미널과 실제 콘솔 Ctrl+C, 실제 OS 대화상자·알림, 실제 한글 입력기, FAT/exFAT(하드 링크 실패는 시험 모듈로 흉내만), 일반 심볼릭 링크(권한 없음; 정션은 봄), Linux·macOS, GUI 패키징·서명, 접근성 수동 점검.
- **사용자에게 물을 것(모아 둠, 아직 묻지 않음)**: CP-25·CP-26의 목록에 더해, 진행 줄을 100칸에서 접을지(이행에 섞지 않고 미룸), 적용의 글을 설정 언어로 맞출지, 이동 계획 적용 결과에 lockLeft를 더할지(GUI에 보임), `revert --json`의 건너뛴 경로 원문.

## 진행 요약 (CP-26, 2026-11-14 05:06, main `82e8285`)

- **CP-25 뒤 병합한 단위 43개**(새 체계 합계 271개; 병합 커밋 제목에서 셈): U-250, U-249, U-246, U-252, U-255, U-253, U-254, U-257, U-256, U-265, U-267, U-268, U-258, U-261, U-270, U-278, U-262, U-269, U-272, U-279, U-275, U-276, U-259, U-273, U-280, U-277, U-274, U-283, U-281, U-282, U-284, U-285, U-247, U-251, U-266, U-286, U-288, U-287, U-291, U-290, U-289, U-292, U-271. 내용은 병합 커밋 제목에 있다.
- **CLI 구조 이행**(DR-65, 계획서 `docs/reviews/2026-11-13-cli-migration-plan.md`): 16단계 가운데 P-2(U-250), C-1(U-254), C-2(U-262·U-269), C-3a(U-280), C-3b(U-282), C-4(U-285·U-286), C-5(U-287)의 일곱이 main에 있다. 앱이 CLI 모듈에 기대는 곳은 26개에서 14개가 됐다(담당이 센 수). 판 비교 사례는 32개에서 65개로 늘었고, 단계마다 PM이 판에서 돌려 차이 0을 확인했다. 고정 출력은 바뀌지 않았다.
  - 옛 자리에 남긴 다시 내보내기는 15곳이고 목록 시험이 지킨다. 이행 끝에 정리 여부를 정한다.
  - C-4(조립)는 Codex V-29, C-5(실행 전 단계)는 V-30을 받고 병합했다(둘 다 높음 0·중간 0·낮음 0).
  - **C-6a(위험 높음)가 진행 중이다**: 사례(U-289)와 계약 형(U-290, U-292)과 지금 동작을 고정하는 시험(U-291)이 들어갔고, 앱의 실행 수명(U-293, p5a)이 진행 중이다. 그 뒤가 CLI 뒤집기(na-core)다.
  - PM 판단: 끝 요약의 수는 앱이 세어 결과 옆에 준다. CLI는 저장된 기록 그대로로 진행 줄을 그린다(앱의 새 통로 `onStoredRecord`; GUI의 호스트는 쓰지 않으며 시험이 지킨다). 진행 줄을 100칸에서 접을지는 이행에 섞지 않고 이행 뒤 사용자에게 묻는다. 계획서와 다르게 `unreadable.ts`는 C-3b에서 통째로 옮겼다.
- **개인정보 표(묶음 A)에서 모델로 새던 길을 닫았다**(DR-70; 묶음 A 문서를 쓰다가, 그리고 Codex V-28이 찾음):
  - 검증기(U-258, U-276): 읽기 제외 원본은 실행의 k행 이상 묶음만 맞대고 행 번호를 싣지 않는다. 표 질의가 주지 않는 값의 규칙, 읽기 제외 아래 대상의 규칙, 읽기 제외 아래 파일을 보는 `file_rules` 규칙은 맞대지 않는다(맞대지 않은 규칙만 있으면 inconclusive). 실행의 k가 검증기에 간다.
  - 표 질의(U-261, U-277, U-283): 거부 까닭마다 맞는 안내, 읽기 제외 표에서는 행·줄 번호 없음, `not_number`로 거부하지 않고 숫자 아닌 칸을 빈 칸처럼 뺌.
  - Codex V-28(높음 1·중간 1, 둘 다 묶음 A 때부터 main에 있던 것), V-28b(첫 고침이 만든 중간 1), V-28c(0·0·0). 남는 것은 계약과 `privacy.md` 13절에 적은 한계다: 받은 수끼리의 차로 추론할 수 있다.
  - 실제 API로는 돌린 적이 없어 이 길로 실제 모델에 나간 것은 없다.
- **GUI**: 설정 화면의 읽기 제외·k 편집과 `analyze-private` 안내(U-247; Codex V-27, 검토 R-111·R-111b·R-111c), 후속 모음(U-271; 검토 R-113), 구현자가 아닌 세션의 보안·계약 시험(U-274, U-284). R-111b는 부하에서 연기가 11번 중 5번 실패하는 것을 찾았고(잠금 이어받기), 고친 뒤 부하 10번을 통과했다.
- **가장 최근 검증**(U-271 판 `8485eab`, 트리는 병합 `3ee4f8b`와 같음, PM 실행): 타입 검사 통과, 유닛 4,096건 중 4,091 통과·0 실패·todo 1, 통합 643건 중 642 통과·0 실패·건너뜀 1(4 GiB 실측, 환경 변수를 줄 때만 돎), 비밀 검사 통과, 고정 값 변화 없음, GUI 유닛 409건 통과. GUI 연기 시험은 판 `eb6ce05`에서 227/227 네 번(ne-verify, 셋은 부하에서); 그 뒤 계약 형과 판 비교 사례만 바뀌었고, main `82e8285`에서의 연기 시험은 요청해 둔 상태다(아직 결과 없음).
- **열려 있는 것**: R-113의 낮음 둘(텍스트 저장의 잠금 거부가 이 창의 호출로 세어짐, 보고서 요약의 거부 안내가 한 가지 글)은 U-294(p5u-gui)로 고치는 중. 해시를 읽는 조각 크기가 두 가지(64 KiB, 1 MiB)인 것과 읽는 동안 폴더가 바뀐 실패를 사람에게 따로 알리는 것은 기능 단위 후보.
- **PM의 실수와 조치**(CP-25 뒤): 판의 유닛에 실패 1건(시간에 기대는 시험)이 있는 채로 문서 단위 U-278을 병합했다(판 만들기와 병합을 한 명령에 묶음; 같은 트리의 재실행은 실패 0; 그 뒤로는 판 결과에서 실패 0을 읽은 뒤 따로 병합한다; 그 시험은 U-279로 고침). C-3a가 대기 중인데 같은 문서를 건드리는 단위를 먼저 병합해 담당이 main을 두 번 다시 받았다(대기 중인 판이 있으면 겹치는 파일의 단위를 넣지 않는다). C-3a의 첫 판은 GUI 시험 하나를 조용히 건너뛰게 했고, PM이 통과 수가 아니라 건너뜀 수를 보고 찾았다(그 뒤로 GUI 수치는 건너뜀과 todo도 읽는다).
- **확인하지 않은 범위**(그대로, `docs/manual-checks.md`): 실제 Anthropic·OpenAI API 호출(한 번도 없음), 실제 터미널, 실제 OS 대화상자, 실제 한글 입력기, FAT/exFAT, Linux·macOS, GUI 패키징·서명, 접근성 수동 점검, 실제 창의 CSP(연기 시험이 위반 수는 봄)와 OS 알림.
- **사용자에게 물을 것(모아 둠)**: CP-25의 목록에 더해, 고정 출력이 바뀌는 열 가지(p4g의 `.codaryn/report-pin-change-questions.md`: 실패 수의 코드별 내역, 진행 줄의 대상, 권한 요약과 doctor 항목, organize 지시문, 다음 명령의 다이제스트, 보고서의 지역 시각, 시작 줄의 실행 id, doctor의 가릴 값 점검 등), 넓은 폴더 경고의 기준(`.codaryn/report-c14-wide-folder.md`), `data_checks`의 묶음 수 상한(64 MB에서 약 0.8 GiB), macOS·Linux 지원 범위, 수동 점검 항목을 언제 할지.

## 진행 요약 (CP-25, 2026-11-14 00:15, main `1f0eb85`)

- **CP-24 뒤 병합한 단위 56개**(새 체계 합계 228개; 병합 커밋 제목에서 셈): U-190, U-199, U-200, U-201, U-174, U-184, U-192, U-180, U-187, U-181, U-189, U-205, U-209, U-197, U-202, U-214, U-191, U-198, U-195, U-196, U-206, U-203, U-220, U-217, U-219, U-227, U-224, U-213, U-221, U-208, U-228, U-230, U-232, U-216, U-235, U-236, U-238, U-231, U-241, U-234, U-243, U-242, U-248, U-218, U-229, U-226, U-240, U-244, U-210, U-207, U-223, U-237, U-204, U-215, U-212, U-245. 내용은 병합 커밋 제목에 있다.
- **P1 묶음 B가 사용자에게 열렸다**(DR-69): 계획을 만든 실행의 계획을 사람이 승인하면 실행기가 그대로 옮긴다. CLI의 `plan run`(U-191·U-198·U-195·U-196·U-206)과 GUI의 계획 실행(U-218·U-229·U-226·U-240·U-244). 엔진·저장은 U-180·U-187·U-181.
- **P1 묶음 A가 사용자에게 열렸다**(DR-69, DR-70, DR-74): 읽기 제외 경로와 묶음 크기 하한 5를 task·설정·프로필·작업 유형 정의에서 읽고, 어느 원천도 경로를 빼거나 크기를 내리지 못한다. 작업 유형 `analyze-private`과 `query_table`(U-208), 모든 실행의 관문·도구·검증기·무결성 대상이 한 함수로 받는다(CLI와 앱 계층). 설정에서 경로를 빼거나 크기를 내리는 것은 넓히기다. GUI가 그 넓히기를 이름 붙여 묻고 분석이 무엇을 보내는지 말한다.
- **GUI의 텍스트 편집 화면**(DR-71~DR-73; U-174·U-184·U-192)과 그 앱 계층 통합 시험(U-199), 읽기 도구의 신원 재대조(U-189·U-205), 읽기 다시 시도(U-213)가 들어갔다.
- **PM 결정 DR-74**: k 하한 5, 계획 실행의 목표는 계획을 만든 실행의 목표, 길 위 링크면 계획 낡음, 가린 표시는 `[masked]`, 표 상한 64 MiB로 올리지 않음, 읽기 도구는 신원 재대조·쓰기와 계획 적용의 폴더 바꿔치기는 알려진 한계. 그 밖의 판단: 지연 잠금 재해제(U-211)는 Codex V-17·V-17b 뒤 뺌. 읽기 제외는 모델로 가는 것을 막고 사람의 파일 보기·변경 보기는 연다. 100칸 줄 나눔(U-233)은 고정 출력이 바뀌어 하지 않음.
- **Codex 검증 V-11~V-26**과 검토 R-99~R-110b는 `docs/reviews/2026-11-13-*`, `2026-11-14-*`에 있다. 묶음 A: V-22·V-23 높음 0·중간 0·낮음 0(실제 CLI), V-24 중간 3을 고친 뒤 V-24b 0, V-26은 203개 확인에서 0. 검토 R-108의 높음 2(실행된 계획의 관문과 앱 조립에 목록이 없음)는 고쳤다.
- **가장 최근 검증**(묶음 A 판 `3eb1c09`, PM 실행): 타입 검사 통과, 유닛 3,974건 중 3,969 통과·0 실패·todo 1, 통합 635건 통과, 비밀 검사 통과, 고정 값 변화 없음. GUI 유닛 336건 통과. GUI 연기 시험은 판 `87ddd92`에서 220/220 두 번(ne-verify, 하나는 부하에서); 그 뒤 GUI 안내 글 하나와 시험 표시 다섯이 바뀌었고, main `1f0eb85`에서의 연기 시험은 ne-verify에 요청해 둔 상태다(아직 결과 없음).
- **진행 중**: U-247(GUI 설정 화면의 읽기 제외 편집), U-249·U-252(문구 다듬기), U-250(이행 P-2: 실행 이벤트의 도구 이름 제한), U-251(사람 점검표의 묶음 A·계획 실행 항목), U-253(묶음 A 예시와 개인정보 문서), 설계 대조 재점검(p4g).
- **CLI 구조 이행 시작**(DR-65, 계획서 `docs/reviews/2026-11-13-cli-migration-plan.md`, U-248): 직렬로 P-2, C-1~C-11. 첫 단계 C-1(계약 형 옮김, U-254)을 p4g에 배정했다. 출력과 JSON은 바뀌지 않아야 한다. C-6a 전에 "진행 줄을 접을지" 사용자 답이 필요하다.
- **PM의 실수와 조치**(CP-24 뒤): U-138을 "읽었다"고 과장해 적었다가 바로잡았다. U-246을 두 사람에게 겹쳐 배정했다(하나를 거둠. 배정 전에 진행 표를 본다). Codex에 잘못된 해시·기준을 준 것은 합쳐 네 번이다(판 생성이 실패했는지 확인한 뒤에만 해시를 넘기고, 조상 관계를 먼저 본다).
- **알려진 한계(새로 적음)**: 에이전트 쓰기와 계획 실행기의 폴더 바꿔치기 틈(DR-73·DR-74), 계획 기록을 다른 작업 공간에 복사하면 거기서 실행됨, 여러 질의의 차로 작은 묶음을 추정할 수 있음, `revert`는 지금의 읽기 제외를 보지 않음, 읽기 다시 시도의 남은 틈(시계 눈금, FAT).
- **확인하지 않은 범위**(그대로, `docs/manual-checks.md`): 실제 Anthropic·OpenAI API 호출(한 번도 없음. 묶음 A의 확인은 대본 모델과 모의 Anthropic뿐), 실제 터미널, 실제 OS 대화상자, 실제 한글 입력기, FAT/exFAT, Linux·macOS, GUI 패키징·서명, 접근성 수동 점검.
- **사용자에게 물을 것(모아 둠)**: CP-24의 목록에 더해, 도구 호출 기록의 미등록 키 모양이 원문으로 남는 공통 동작을 고칠지, 표 상한 64 MiB(고정 문장이 바뀜), 100칸 줄 나눔을 위해 고정 출력을 바꿀지(진행 줄 포함, C-6a 전 필요), 계획 기록을 작업 공간에 묶을지, 읽기 제외가 사람의 화면에도 걸려야 하는지.

## 진행 요약 (CP-24, 2026-11-13 17:10, main `c83ec5b`)

- **CP-23 뒤 병합한 단위 51개**(새 체계 합계 172개): U-137, U-123, U-135, U-140, U-136, U-141, U-131, U-116, U-138, U-139, U-145, U-146, U-148, U-150, U-149, U-143, U-153, U-152, U-147, U-151, U-154b, U-155, U-160, U-157, U-161, U-156, U-158, U-124, U-144, U-162, U-164, U-165, U-166, U-171, U-167, U-163, U-173, U-170, U-175, U-177, U-179, U-172, U-185, U-188, U-182, U-186, U-183, U-176, U-178, U-193, U-194. 내용은 병합 커밋 제목에 있다.
- **사용자 결정 DR-69~DR-73**(`docs/work-orders/phase-4-5-design.md`): P1 묶음 A·B를 범위에 넣고 B 먼저(DR-69). 개인정보 표에서 모델로 가는 것은 열 이름과 5행 이상 묶음의 키 값·개수·집계 수뿐(DR-70). 텍스트 편집 기능 검토 요청(DR-71)과 PM 판단(DR-72: 에이전트는 이미 `replace_text`가 있어 새 도구 없음, GUI에 사람이 고치는 작은 화면을 넣음). 편집 화면 바탕의 폴더 바꿔치기 틈은 알려진 한계로 적고 진행(DR-73).
- **main에 들어온 것**: Markdown 규칙(P1 묶음 C, U-116), GUI의 권한 대화상자(U-124)와 경합 고침(U-144), `writablePaths`(U-170·U-175·U-182·U-186·U-183: 네 원천이 좁히기만, 앱 계층도 관문에 넘김, 설정 넓히기 판정), 묶음 B의 계약(U-170·U-175; CLI는 `plan run`을 아직 거부, U-177), 텍스트 편집의 앱 계층(U-172), `write_file`의 16 MiB 쓰기 상한(U-173), 잠금 풀기의 다시 시도와 실패 알림(U-176·U-193), 연기 시험 견고성(U-178), `models`의 한국어(U-156), 실행 목록의 `phase`(U-155·U-158·U-162).
- **Codex 검증 세션 여섯**(사용자가 더함; PM이 이름을 붙이고 교육 뒤 배정): `codex-review`(w3:p3), `codex-loop`(w3:p8, 한도 안내 1%라 쓰지 않음), `codex-sec`(w3:pC), `codex-check`(w3:pD), `codex-audit`(w3:pE), `codex-probe`(w3:pF). 읽기 전용 검증만 맡긴다. 보고서는 `docs/reviews/2026-11-13-v*-codex-*.md`.
  - Codex가 찾아 고친 것: U-170의 승인 없는 쓰기(V-2), U-175의 확인 없는 허용(V-3), U-176 첫 판의 '자기 잠금 거두기'가 다른 프로세스의 살아 있는 잠금을 지움(V-4, 그 기능을 뺌), U-183의 링크를 지나는 좁히기(V-8), U-180 요약의 키 모양(V-7).
  - PM의 검증(시험 통과)만으로는 위 결함을 잡지 못했다. 보안·정합에 닿는 단위는 Codex 검증 뒤에 병합한다.
  - Codex가 '내용을 표시할 수 없다'는 안내로 보고서 없이 멈춘 적이 세 번 있다(V-4 첫 시도, V-1b, V-10; 경로 바꿔치기 재현을 다룰 때). 남긴 결과 파일을 PM이 집계했고 그렇게 밝혔다.
- **가장 최근 검증**(U-193·U-194 판 `d9ae775`, 트리는 `c83ec5b`와 같음, PM 실행): 타입 검사 통과, 유닛 3,475건 중 3,469 통과·0 실패·4 건너뜀·todo 2, 통합 603건 통과, 비밀 검사 통과. GUI 유닛 273건 통과(판 `d5a36a5`, PM 실행), GUI 연기 시험 216/216 네 번(같은 판, ne-verify 실행, 둘은 부하에서).
- **병합 전에 멈춰 있는 것**: 묶음 B-3(U-180·U-187 엔진, U-181 저장; 판 `f07ba7a`)은 Codex V-11의 높음 1(승인 뒤 부모 폴더가 정션으로 바뀌면 승인 밖에 씀)을 p4g가 고치는 중. GUI 편집 화면(U-174·U-184·U-192)은 V-5b의 중간 1을, 읽기 도구 신원 대조(U-189)는 V-10에서 빠진 `inspect_files`·이름 찾기를 p5u-gui가 고치는 중.
- **진행 중**: U-190(오류 글 둘), U-191·U-198(계획 실행의 사람용 글), U-195(CLI의 apply 나눔), U-196(앱 계층), U-197(묶음 A 계약), U-199(편집 앱 계층 통합 시험), U-200(writablePaths 문서), U-201(잠금 알림의 남은 연결).
- **nb-i18n(w3:p5)은 14:55쯤부터 권한 질문에서 멈춰 있다**(작업 폴더 밖 임시 파일 읽기). PM은 작업자의 권한 질문에 답하지 않는다. 사용자에게 여러 번 알렸다. 문구 다듬기는 그동안 각 단위 담당이 초안으로 넣었다.
- **PM의 실수와 조치**: Codex에 고침이 없는 병합 커밋의 해시를 주어 재확인이 헛돌았다(U-184, 다시 맡김. 해시는 `git rev-parse <브랜치>` 출력으로 넣는다). 사용자에게 "nb-i18n의 권한 질문이 사라졌다"고 잘못 알렸다가 바로잡았다(화면 끝 몇 줄만 봄). "모델은 파일 전체 쓰기만 한다"고 잘못 알렸다가 바로잡았다(DR-72). U-138 병합 커밋에 '읽음'이라 적었으나 일부만 읽었다.
- **확인하지 않은 범위**(그대로, `docs/manual-checks.md`): 실제 Anthropic·OpenAI API 호출, 실제 터미널, FAT/exFAT, Linux·macOS, GUI 패키징·서명, 실제 OS 대화상자, 접근성 수동 점검.
- **사용자에게 물을 것(모아 둠)**: 원천 문서의 어긋남 다섯(`docs/reviews/2026-11-13-source-docs-drift.md`), 임시 관행 넷, OpenAI가 다시 보내는 앞 응답 항목의 가림, 보고서 언어(Q-1~5, Q-7), 한국어 상태 낱말(고정 시험이 바뀜), `review --json`의 status 필드와 무결성 `run_end` 단계, `apply`·`revert --json`의 질문 중 Ctrl+C(R88b-I2), 기존 JSON 필드를 바꾸는 AX 지적, 기능 뒤 GUI 패키징.

## 진행 요약 (CP-23, 2026-11-13, main `3af68f5`)

- **CP-22 뒤 병합한 단위 33개**(새 체계 합계 121개): U-106, U-64, U-103, U-65, U-105, U-104, U-90, U-97, U-98, U-91, U-112, U-108, U-117, U-120, U-66, U-67, U-68, U-69, U-111, U-121, U-70, U-122, U-125, U-128, U-115, U-127, U-109, U-110, U-118, U-119, U-130, U-132, U-129. 내용은 병합 커밋 제목에 있다.
- **실행 중 권한 확인(DR-3)**: CLI까지 main에 있다(U-74, U-107, U-106, U-108, U-109, U-110). 설정·프로필의 명령 규칙에 `confirm: true`를 두면 터미널에서 묻고, 질문 중 Ctrl+C는 실행 전체를 취소한다. 실제 터미널에서는 확인하지 않았다(흉내 낸 터미널로만). GUI의 OS 대화상자(U-124)는 진행 중이다. architecture·usage의 권한 확인 서술은 아직 갱신하지 않았다.
- **앱 계층 함수 셋**(작업 공간 목록, 실행 사건 목록 U-90, 적용 전 점검 U-91)이 main에 있고, GUI가 이것을 쓴다: 기록 탭(U-118), 적용 전 점검(U-119), 조사서의 GUI 항목(U-60~U-70, U-103).
- **그 밖에 들어간 것**: 첫 시작 안내(U-115), 화면 폭 함수(U-125), 실행 목록의 사람 판정과 적용 실행의 동작 수(U-129, `runs --json`에 `review` 더함), 두 판의 CLI 출력을 맞대는 도구(U-130, `scripts/compare-cli-boards.mjs`), 계약 층 시험(U-112), 예시 둘(U-122).
- **가장 최근 검증**(U-129 판 `fc609c5`, 트리는 `3af68f5`와 같음, PM이 직접 실행): 타입 검사 통과, 유닛 3,072건 중 3,068 통과·0 실패·3 건너뜀·todo 1, 통합 584건 통과, 비밀 검사 통과. GUI 유닛 254건 통과(판 `1901063`, PM 실행), GUI 연기 시험 213건 통과(검토 R-92의 검토자 실행. PM의 worktree에는 Electron이 없다).
- **작업자 한도 중단**: 12:24에 Claude 작업자 여섯이 주간 한도 안내로 멈췄다. 사용자의 "멈춘 세션 재개" 지시로 12:52쯤 다시 시작했고, 반쯤 된 변경은 없었다. 한도·크레딧 안내는 PM이 누르지 않고 사용자에게 알린다.
- **PM의 실수와 조치**: U-110에서 담당이 끝났다고 보고하기 전에 판을 고정해 검토에 넘겼다(뒤 커밋이 빠져 다시 고정했다. 그 뒤로는 담당의 완료 보고를 받은 뒤 고정한다). 작업자에게 잘못된 해시를 한 번 전달했다(그 뒤로는 `git rev-parse` 출력을 그대로 붙인다).
- **진행 중**: U-116(Markdown 규칙, 검토 R-89 중간 1 수정), U-123(GUI 낮음 셋, 검토 R-93), U-124(권한 확인의 GUI 대화상자), U-131(보고서의 판정 기다림 줄 등), U-135(비교 도구의 터미널 사례), U-136(임시 문구 다듬기), U-137(R88b-L1), U-138(사람이 직접 할 점검표 `docs/manual-checks.md`), U-139(R88b-I1).
- **기능 뒤 예정**(DR-65, DR-67): CLI 구조 이행(`docs/reviews/2026-11-13-cli-migration-plan.md`), GUI 패키징 재질문.
- **확인하지 않은 범위**(그대로): 실제 Anthropic·OpenAI API 호출, 실제 터미널, FAT/exFAT, Linux·macOS, GUI 패키징·서명, 실제 OS 대화상자, 접근성 수동 점검.
- **사용자에게 물을 것(모아 둠)**: CP-22의 목록에 더해, P1 묶음 A(개인정보 자료 분석)·B(`plan: "run"`)를 범위에 넣을지와 A의 "표에서 모델로 가도 되는 것"(`docs/reviews/2026-11-13-p1-bundle-proposal.md`).

## 진행 요약 (CP-22, 2026-11-13, main `bc3305d`)

- **CP-21 뒤 병합한 단위 36개**(새 체계 합계 88개): U-58, U-60, U-37, U-38, U-55, U-61, U-73, U-57, U-71, U-72, U-75, U-76, U-77, U-81, U-26, U-88, U-78, U-80, U-79, U-83, U-84, U-82, U-89, U-62, U-63, U-92, U-93, U-87, U-101, U-74, U-100, U-102, U-99a, U-107, U-86, U-59. 검토 기록은 `docs/reviews/2026-11-13-*.md`(R-69~R-81, 조사 넷).
- **사용자 결정 DR-65~DR-68**: CLI 구조 이행은 넣되 기능 뒤에, 연결되지 않은 줄 프로토콜·VS Code 코드 삭제(U-81로 함), GUI 패키징은 기능 뒤 다시 묻기, 전송 층의 재시도 판정을 결과에 남기고 고정 값에 키 하나를 더하는 것 승인(U-82로 함).
- **설계 대조 조사 셋**(`docs/reviews/2026-11-13-gui-design-gap-survey.md`, `-adapter-design-gap-survey.md`, `-design-gap-survey.md`): 단계 0, 1a, 4(P0), 그리고 2·3의 오프라인 몫은 충족. 1b·2·3의 실제 API 몫은 확인하지 않았다(실제 API는 한 번도 호출하지 않음). 단계 5는 완료가 아니다.
- **실행 중 권한 확인(DR-3)의 진행**: 계약·정책 관문·엔진(U-74)과 넓히기 판정(U-107)이 main에 있다. 아직 어떤 파일로도 확인 규칙을 켤 수 없고 어떤 어댑터도 묻지 않는다. 남은 순서: U-106(엔진의 답 읽기 견고함, 질문 글의 키 가림) → U-108(앱 연결) → U-109(설정·프로필에서만 `confirm`을 받음), U-110(터미널 질문) → GUI 대화상자.
- **앱 계층 함수**: 작업 공간 목록(U-89, U-102)이 main에 있다. 실행 사건 목록(U-90)은 보안 검토 R-80의 중간 1로 수정 중이고, 적용 전 점검(U-91)은 R-81을 통과해 U-90을 기다린다. GUI의 임시 트리 읽기를 목록 함수로 바꾸는 단위(U-103)는 검토 R-82 중이다.
- **가장 최근 검증**(U-86 판 `590d75b`, 트리는 `bc3305d`와 같음, PM이 직접 실행): 타입 검사 통과, 유닛 2,845건 중 2,841 통과·0 실패·3 건너뜀·todo 1, 통합 559건 통과, 비밀 검사 통과, 고정 시험 파일 `sp0-expected`·`real-catalog`는 변경 없음. GUI 유닛은 U-93까지 든 판 `42330f0`에서 222건 통과(PM), 연기 시험은 같은 넷을 합친 판에서 200건 통과(검토자 R-77).
- **PM이 승인한 고정 값 변경**(더하기만): `sp0-golden.ts`의 실패 결과에 `retryable` 키 31개와 머리 주석(U-82, 사용자 결정 DR-68. PM이 스크립트로 "그 줄을 빼면 이전 파일과 같다"를 두 번 확인). U-34에서 만든 정리 미리보기의 영어 고정 시험 네 사례(U-86, 사람용 글의 구조를 바꾸는 것이 목적).
- **검토에서 되돌린 것**(모두 고쳐 병합했거나 수정 중): U-37(R-69 M1), U-38(R-70 M-1, 허용 목록으로), U-62(R-73 M1, 경로 복사를 뺌), U-82(R-75 M1), U-86(R-76 M-1), U-90(R-80 M-1, 수정 중).
- **PM의 실수와 조치**: 문서 단위 셋(U-60, U-72, U-76)을 병합 커밋에 "읽음"이라 적고 병합 뒤에 읽었다(문제는 없었다. 그 뒤로는 읽은 뒤에 병합한다). 사용자 질문 네 개에 답을 기다리는 동안 작업자들이 약 25분 쉬었다. 문구 담당이 다른 담당의 커밋을 기다리며 멈춰 있었는데 PM이 해시를 전달하지 않았다.
- **임시 관행(사용자 확인 전)**: DR-64 둘에 더해, 문구 id만 더하는 계약 변경은 그 단위의 담당이 직접 하고 계약 담당이 뒤에 확인한다. 작은 단위 여럿을 한 판에 합쳐 한 번 검증한 뒤 단위별로 병합하고 최종 트리를 맞댄다(중간 상태는 따로 검증하지 않는다).
- **진행 중**: U-90·U-91(앱 계층), U-103·U-64·U-65(GUI, 검토 R-82)와 U-66~U-70, U-104(진행 줄의 되풀이 줄 접기), U-105(엔진 쪽 빈 곳: 적용 전 점검 함수 등), U-106, U-108~U-110(권한 확인), U-97·U-98(문서).
- **알려진 한계(바뀐 것)**: 연결 실패는 이제 재시도 가능으로 나온다(U-82). 자료 분석은 표의 행을 그대로 모델에 보낸다, `inspect_files`는 읽지 않은 파일의 해시도 준다, `plan.json`과 폐기 보관함은 로컬 원문이다(U-84가 문서로 남김). 실행 사건 목록 함수가 들어오기 전까지 GUI의 기록 탭은 없다.
- **확인하지 않은 범위**(그대로): 실제 Anthropic·OpenAI API 호출(직접 실행할 점검 스크립트는 U-101로 준비됨, `tests/live/README.md`), FAT/exFAT, Linux·macOS, GUI 패키징·서명, 실제 OS 대화상자, 접근성 수동 점검.
- **사용자에게 물을 것(모아 둠)**: 원천 문서와 지금 상태의 어긋남, 임시 관행(위), OpenAI가 다시 보내는 앞 응답 항목의 가림, 분석 작업 확인 항목 글의 언어, 범용 작업 P1 묶음의 범위와 값, 기존 JSON 필드를 바꾸는 종류의 AX 지적(AXM-12, AXM-19), 기능이 끝난 뒤 GUI 패키징.

## 진행 요약 (CP-21, 2026-11-13, main `604f9e5`)

- **CP-20 뒤 병합한 단위 30개**(새 체계 합계 52개): U-29, U-16, U-19, U-25, U-39, U-28, U-32, U-23, U-33, U-42, U-43, U-45, U-46, U-31, U-41, U-34, U-40, U-44, U-47, U-18, U-35, U-49, U-52, U-51, U-48, U-53, U-54, U-56, U-50, U-36. 내용은 병합 커밋 제목과 `docs/reviews/2026-11-13-*.md`(R-55~R-68b, 조사 셋)에 있다.
- **사용자 결정 DR-54**: 가림 개수가 알리는 것(등록 값 전체와 같은 글이 모델에 갔는지)을 받아들이고 문서로 남긴다(U-25, U-39).
- **PM 결정 DR-55~DR-63**과 임시 관행 DR-64(`docs/work-orders/phase-4-5-design.md`).
- **닫힌 사용성 지적**: UX·AX 높음 넷(CP-20), AXM-4(U-18), AXM-5·AXM-7(U-15), AXM-6(U-50), AXM-17(U-25), UXM-4·5·15(U-16), UXM-7의 정리 안내·도움말·plan·changes 본문과 질문(U-34, U-35, U-36), UXM-14·24(U-32), UXM-17과 UXM-9의 인자 없는 실행(U-23, U-45). 열린 것의 목록은 문서 담당이 조사 중이다.
- **가장 최근 검증**(U-36 판 `13414fc`, 트리는 `604f9e5`와 같음, PM이 직접 실행): 타입 검사 통과, 유닛 2,602건 중 2,598 통과·0 실패·3 건너뜀·todo 1, 통합 559건 통과, 비밀 검사 통과, 고정 시험 파일 셋은 변경 없음. GUI는 main `2ee6c0b`에서 유닛 193건·연기 시험 191건 통과(GUI 담당 측정. PM의 worktree에는 Electron 실행 파일이 없어 연기 시험을 돌리지 못한다).
- **PM이 승인한 고정 값 변경**(더하기만): `sp0-expected.ts` "run --json"의 `masking`(U-25). 그 밖에 고정 시험 파일은 바뀌지 않았다. U-18과 U-55에서는 고정 값을 지키는 쪽으로 설계를 바꿨다.
- **검토에서 되돌린 것**: U-16(M-1b와 PM이 찾은 뒷걸음), U-18(고정 시험·문서 인용이 깨짐), U-35(낡은 사실을 말하는 도움말), U-36(실제 CLI에서 한국어가 나오지 않음, R-66 M1), U-50(틀린 힌트, R-68 M-1), U-37(값을 받는 힌트의 사람용 줄 없음, R-69 M1), U-38(둥근 따옴표가 든 경로를 PowerShell에 붙이면 뒤가 명령이 됨, R-70 M-1). 앞의 다섯은 고쳐 병합했고 U-37과 U-38은 수정 중이다.
- **진행 중**: U-37, U-38(수정), U-26(`init`이 제공자를 물음), U-55(다시 시도해도 되는 실패인지), U-57(시각 표기 등 UX 낮음), U-58(CLI에 남은 옛 용어), U-60~U-70(GUI 남은 설계 항목), 설계 대조 조사 둘(앱 계층, 나머지 설계 문서와 열린 사용성 지적).
- **GUI 설계 대조**(`docs/reviews/2026-11-13-gui-design-gap-survey.md`, main `2ee6c0b`): 구현됨 66줄, 일부 18, 없음 27, 환경 밖 11. 화면의 큰 흐름과 보안 항목은 거의 다 있다. 남은 것은 편의 기능, 앱 계층 함수를 기다리는 네 기능, 패키징(GU-9)이다.
- **PM의 실수와 조치**: 사용자 질문의 답을 기다리는 동안 작업자들이 약 한 시간 쉬었다(05:26~06:21). 병합 충돌을 손으로 풀다 닫는 괄호가 어긋났다(검증에서 걸려 고침, 시험 수를 세어 확인). U-37을 나눌 때 사람용 출력 담당을 빠뜨렸다(R-69 M1). 병합은 `/tmp`의 가드 스크립트(충돌·트리 해시 불일치·비밀 검사 실패에서 중단)로 한다.
- **알려진 한계(새로 적음)**: 연결 실패처럼 HTTP 상태가 없는 모델 오류는 `retryable`이 없다(U-55가 병합되면). `revert`의 다음 명령 안내는 친 경로를 보이지 않는다. 읽기 명령은 쓰지 않는 한도의 상한을 검사하지 않는다. GUI 연기 시험은 병합 뒤 main에서 GUI 담당이 잰다.
- **확인하지 않은 범위**(그대로): 실제 Anthropic·OpenAI API 호출, FAT/exFAT, Linux·macOS, GUI 패키징·서명, 실제 OS 대화상자, 접근성 수동 점검.
- **사용자에게 물을 것(모아 둠)**: 원천 문서와 지금 상태의 어긋남 9건, 확정하지 않은 관행(DR-64 포함), OpenAI 인자 재전송의 가림, 분석 작업 확인 항목 글의 언어(고정 값이 바뀜), 전송 층의 재시도 판정을 결과에 남길지(고정 값 32개에 키 하나), GUI 패키징(새 의존성 둘과 내려받기)·서명.

## 진행 요약 (CP-20, 2026-11-13, main `a191a50`)

- **병합 방식이 바뀌었다(G-12, 사용자 확인)**: 묶음 대신 결정·기능 하나가 한 단위다. 약 1,500줄 이하, 검토 1건, PM 검증과 검토를 통과하면 바로 병합·푸시한다. 브랜치는 `unit/<id>-<pane 이름>`이고 main에서 딴다.
- **새 체계로 병합한 단위 22개**: U-1, U-2, U-3, U-4, U-5, U-6, U-7, U-8, U-9, U-10, U-11, U-12, U-13, U-14, U-15, U-17, U-20, U-21, U-22, U-24, U-27, U-30. 각 단위의 내용은 병합 커밋 제목(`merge: accept unit …`)과 `docs/reviews/2026-11-13-*.md`에 있다.
- **사용성 중간 점검(DR-46)**: UX·AX 전문가 페르소나의 점검 문서 `docs/design/ux-midpoint-review.md`, `docs/design/ax-midpoint-review.md`(U-12). 높음 네 건은 모두 병합했다: 정리가 폐기 파일을 주인 없이 남김(U-13), 승인 화면이 변조된 계획을 경고 없이 보임(U-14), 에이전트의 마지막 말이 사람에게 닿지 않음(U-21), 정리 JSON이 사실과 다름(U-22).
- **사용자 결정 DR-47~DR-53**(`docs/work-orders/phase-4-5-design.md`): 에이전트 마지막 답을 머리말과 가림을 거쳐 보임, JSON 계약을 깨는 변경은 두 곳만, 터미널에서 JSON 줄 숨김·인자 없으면 도움말, 용어 통일, 다음 명령 안내에 사용자가 친 경로, 가림 개수만 결과에(보안 검토가 병합 조건), 보관함에 파일이 남은 적용 실행의 기록은 지우지 않음.
- **통합 문서**: `docs/guidelines.md`(규칙 색인)와 `docs/decision-register.md`(결정 대장)를 U-6으로 넣었다.
- **PM이 승인한 고정 값 변경**(더하기만): `tests/unit/cli/sp0-expected.ts`의 "run request" system 글(U-15), "run --json"의 `finalMessage`(U-21).
- **가장 최근 검증**(U-22 판 `4eda8d8`, 트리는 `a191a50`과 같음, PM이 직접 실행): 타입 검사 통과, 유닛 2,273건 중 2,269 통과·0 실패·3 건너뜀·todo 1, 통합 559건 통과, 비밀 검사 통과. GUI 유닛 165건·연기 시험 181건 통과(검토 R-51b).
- **진행 중**: U-16(실행 목록·되돌리기 안내가 적용 상태를 사실대로. 확인 R-55b의 중간 M-1b 수정 중), U-29(앞선 실행이 확인하지 못한 것을 apply가 알림. 검토 R-56 중), U-25(가림 개수, DR-52. CLI·사람용 몫 구현 중, 그 뒤 보안 검토), U-19(한국어 빈 곳), U-28(코드에 남은 옛 용어), U-31(문서), U-32(GUI 계획 화면 후속).
- **대기**: U-18(실패한 도구 호출 보이기), U-23(DR-49·DR-51), U-26(`init`이 제공자를 물음).
- **중단과 재개**: 2026-11-13 01:22~01:53에 작업 세션들이 사용 한도로 멈췄고, 사용자의 재개 지시 뒤 이어 갔다. Codex 두 세션(w3:p3, w3:p8)은 작업 공간 크레딧이 소진되어 멈춰 있다. 화면의 질문에는 답하지 않았다. 검토는 그 단위를 구현하지 않은 Claude 세션이 맡는다.
- **알려진 한계(새로 적음)**: 죽은 실행의 잠금이 남으면 `--run latest`가 `run_in_progress`, 새 실행이 `workspace_locked`로 막히는 경우가 하나 있다(기존 잠금 규칙에서 옴, U-31에서 문제 해결 절에 적는다). OpenAI 제공자는 모델의 앞선 호출 인자를 가림 없이 그대로 돌려받는다(Anthropic 쪽은 가려진다). 실행이 끝난 뒤의 기록 변조는 감지하지 못한다.
- **확인하지 않은 범위**(그대로): 실제 Anthropic·OpenAI API 호출, FAT/exFAT, Linux·macOS, GUI 패키징·서명, 실제 Electron 창과 OS 대화상자.
- **사용자에게 물을 것(모아 둠)**: 원천 문서(CLAUDE.md, AGENTS.md 등)와 지금 상태의 어긋남 9건, 확정하지 않은 관행 12건, OpenAI 인자 재전송의 가림, GUI 배포 전 패키징·서명.

## 진행 요약 (CP-19, 2026-11-12, main `6f85b65`)

- **여섯 번째 묶음을 main에 병합했다**(`6f85b65`). 고정 판 `pm/bundle-6c`(`39df2ba`)와 트리 해시가 같다.
- 고정 판에서 PM이 실행한 검증(루트만): 타입 검사 통과, 유닛 2077건 중 2065 통과·실패 0·건너뜀 3·todo 9, 통합 559건 통과, `check-secrets --tracked` 발견 없음, 고정 시험 파일 셋은 main과 같음. Codex(w3:p8)가 같은 판에서 독립으로 같은 수치를 냈고 유닛 두 번의 결과가 같았다. GUI 시험은 검토자(w3:p4)가 돌렸다.
- 들어간 것: 기록 변조 감지(DR-38), 정리(DR-39)와 별도 확인(DR-44), 실행 중 가림의 끊긴 등록 값 처리, 검증기 합치기와 '키 같은 값' 조건(DR-43), GUI 정리 화면.
- 경과: 고정 전 PM 검증에서 네 번 떨어졌다(타입 오류 3건, 고정 시험 실패 1건, 부하에 흔들리는 시간 시험 1건, PM이 문구 담당을 빠뜨려 생긴 타입 오류). 모두 검토에 넘기기 전에 잡았다. 정리는 검토 R-34, R-34b, R-34c 세 번을 거쳤다.
- 병합 전 검토: R-33, R-33b, R-34, R-34b, R-34c, R-35, R-36, R-28c. 병합 시점에 열린 높음·중간 지적은 없다.
- 남은 낮음(다음 단위): 실행이 끝난 뒤의 기록 변조는 감지되지 않는다(R-33), 기록 변경 표시가 사람용 출력에서 보고서에만 나온다, apply가 변경 표시가 있는 계획을 말없이 적용한다, 실행 시작 줄의 알림과 적용 기록의 알림(R-36), 정리의 계약과 store의 어긋남(손상 실행의 표시, 표지 파일 이름, 표지 없는 폴더가 보이지 않음, R-34c), todo 9건.
- 사용자 결정(2026-11-12): 키처럼 생기지 않은 등록 값이 드문 문자로 끊긴 경우는 한계로 두고 문서화한다. 지침 G-7~G-11 추가. **병합·푸시 단위는 결정 하나가 한 단위(G-12)** — 이 묶음이 마지막 큰 묶음이다.
- 확인하지 않은 범위: 실제 Anthropic·OpenAI API 호출, FAT·exFAT 실제 볼륨, Linux·macOS, GUI 패키지 빌드와 코드 서명.

## 진행 요약 (CP-18, 2026-11-12, main `3bd0646`)

- **다섯 번째 묶음을 main에 병합했다**(`3bd0646`). 고정 판 `pm/bundle-5`(`ab31417`)와 트리 해시가 같다.
- 고정 판에서 PM이 실행한 검증(루트만): 타입 검사 통과, 유닛 1879건 중 1865 통과·실패 0·건너뜀 3·todo 11, 통합 559건 통과, `check-secrets --tracked` 발견 없음. GUI 시험은 검토자(w3:p4)가 같은 판에서 돌렸다: GUI 유닛 134/134, 연기 시험 131/131을 두 번.
- 들어간 것: DR-41(설정·프로필·task 파일의 정책을 작업 종류의 규칙과 합침, 빠진 것 알림), DR-42 (a)(b) 키 거부, `doctor`와 키 안내 문구 수정, 되돌리기 미리보기 한국어, DR-38·DR-39의 계약(구현은 다음), GUI 후속(연기 시험 경합 수정 등).
- 고정 시험 값: 바뀐 곳은 승인한 세 곳뿐임을 검토자(R-32)가 main과 직접 비교해 확인했다.
- 가림 모듈의 끊긴 등록 값 가림은 R-28, R-28b를 거쳤고 낮음 1(토큰 범위 상한)을 고친 뒤 다음 묶음에 넣는다. 그때까지 main의 실행 중 가림은 끊긴 값을 가리지 못한다.
- 다음 묶음: DR-43 (a)~(d), 가림 변경, DR-38·DR-39 구현(store, 엔진, CLI), GUI 남은 화면.
- 확인하지 않은 범위: 실제 Anthropic·OpenAI API 호출, FAT·exFAT 실제 볼륨, Linux·macOS, GUI 패키지 빌드와 코드 서명.

## 진행 요약 (CP-17, 2026-11-12, main `aedbb9d`)

- **네 번째 묶음을 main에 병합했다**(`aedbb9d`). 고정 판 `pm/bundle-4`(`700fa35`)와 트리 해시가 같다.
- 고정 판에서 PM이 실행한 검증(루트만): 타입 검사 통과, 유닛 1820건 중 1802 통과·실패 0·건너뜀 3·todo 15, 통합 559건 통과, `check-secrets --tracked` 발견 없음. GUI 시험은 PM이 돌리지 않았고 검토자(w3:p4)가 같은 판에서 돌렸다: GUI 유닛 133/133, 연기 시험 129/129를 세 번.
- 들어간 것: GUI의 제공자 선택과 새 작업 화면의 제공자·모델 표시, 실행 목록에서 계획 열기, 모든 제공자에 걸리는 시험용 루프백 전용 전송과 소켓 감싸기·거절 횟수 단언(예약 주소 대신 닫힌 포트), 제공자 변경의 OS 확인, 앱 계층의 목적지 판정 다듬기와 설정 크기 상한, 문서.
- 병합 전 검토: R-29(GUI, 높음 0·중간 0·낮음 1), R-30(앱 계층의 목적지 판정을 CLI의 실제 주소 해석과 설정 순서쌍 약 720만 개로 대조, 높음 0·중간 0·낮음 1). 낮음: 연기 시험의 '실행 중 창 닫기' 단계가 요청 수 검사와 경합할 수 있다(GUI), 상한 크기의 BOM 붙은 설정을 `models`만 거부한다(CLI).
- 가림 모듈의 끊긴 등록 값 가림(`1f242fc`)은 R-28(높음 0·중간 0·낮음 0)을 통과했고 다음 묶음에 넣는다.
- 확인하지 않은 범위: 실제 Anthropic·OpenAI API 호출, FAT·exFAT 실제 볼륨, Linux·macOS, GUI 패키지 빌드와 코드 서명.

## 진행 요약 (CP-16, 2026-11-12, main `36cc99c`)

- **세 번째 묶음을 main에 병합했다**(`36cc99c`). PM 통합 worktree의 고정 판 `pm/bundle-3b`(`57ff974`)와 한 파일도 다르지 않다(트리 해시 같음).
- 고정 판에서 PM이 실행한 검증(검토에 넘기기 전): `npm ci` 성공, 타입 검사 통과, 유닛 1810건 중 1792 통과·실패 0·건너뜀 3·todo 15, 통합 559건 통과·실패 0, `check-secrets --tracked` 발견 없음. 실제 API 미실행.
- 들어간 것: Anthropic 실행 거부용 키 모양 좁히기(DR-36 c)와 그 회귀 수정(DR-40: 끊긴 키, 붙은 키, 선형 시간, task·설정 파일 크기 상한), Anthropic 인증 실패 고정 문구(DR-37 a), `doctor`의 키 주소 안내와 모델 출처(DR-36 a, b), 변경 보기의 파일별 표시, 잠금 중 parked 알림(DR-37 c), OpenAI 통합 사례, 문서(privacy.md, usage.md 제공자 절, README, 색인), 앱 계층 수정 다섯 건(제공자·주소 변경을 넓히는 변경으로 판정, 모든 제공자의 키 값 거부, OpenAI 모델 목록). 그 앞에 store 수정 `e75726e`(OpenAI 실행의 목록·보고·되돌리기)를 따로 병합했다.
- 병합 전 검토: 첫 고정 판 `005e10b`에 R-25(중간 1: main 대비 회귀), R-26, Codex의 고정 값 확인. 중간 때문에 병합을 멈추고 DR-40으로 고친 뒤 `57ff974`에 R-25b, R-27. 병합 시점에 열린 높음·중간 지적은 없다. 남은 낮음은 DR-42에 적었다.
- todo 15건: `doctor` 설정 출처 문구와 제공자 문구(계약 id 대기), 끊긴 등록 값의 실행 중 가림(DR-42 c), R-12 L-2, G-C 등 다음 묶음에서 풀 재현 시험이다.
- 바깥 연결 시도 세 건(작업자 자진 보고): 문서 담당의 `.test` 이름 조회 1회, GUI 담당의 예약 주소 `192.0.2.1` 요청 2회. 모두 가짜 키였고 실제 제공자 주소로 간 요청은 없다. 연결·응답 여부는 기록이 없다. 지침 후보 G-11을 임시 적용했다.
- 다음 묶음: DR-41(설정 정책이 작업 종류 규칙을 대체하지 않게), DR-42 (a)~(e), DR-38(기록 변조 감지), DR-39(정리), `doctor` 문구 결함, GUI 묶음(제공자 선택, 실행 목록의 계획, 네트워크 거절 집계).
- 확인하지 않은 범위: 실제 Anthropic·OpenAI API 호출, FAT·exFAT 실제 볼륨, Linux·macOS, GUI 패키지 빌드와 코드 서명.

## 진행 요약 (CP-15, 2026-11-12, main `c20c51d`)

- **두 번째 묶음을 main에 병합했다**(`c20c51d`). PM 통합 worktree의 판 `fe54cc6`(작업 브랜치 9개를 합친 `47756b4`에 문구 커밋 `5c0b4e1` 하나를 더한 것)과 한 파일도 다르지 않다.
- 병합 뒤 main에서 PM이 실행한 검증: `npm ci` 성공, 타입 검사 통과, 유닛 1702건 중 1696 통과·실패 0·건너뜀 3·todo 3, 통합 537건 통과·실패 0, `check-secrets --tracked` 발견 없음. 실제 API 미실행.
- 들어간 것: 두 번째 제공자 OpenAI(계약 SP-1, 공용 HTTP 모듈 SP-3, Responses API 어댑터 SP-5, CLI의 키 등록·가림 SP-2와 설정 SP-4와 연결 SP-6, 결정 DR-31~DR-35), 변경 보기의 가린 글 표시(DR-29, DR-32: 도구·store·앱 계층), 되돌리기의 parked 위치 알림, 적용 사전 점검 중 취소, 독립 GUI 화면(GU-3~GU-7), Anthropic 고정 시험(SP-0).
- 병합 전 검토(구현자가 아닌 세션): r16, r17, r18, r19, r20, r21·r21b, r22·r22b, r23, r24와 Codex(w3:p3)의 계약 수정 확인, Codex(w3:p8)의 main 3회 독립 검증. 병합 시점에 열린 높음·중간 지적은 없다.
- PM의 실수와 조치: 고정 판 `47756b4`를 만들 때 계약 브랜치의 최신 판을 합쳐, 다음 묶음으로 넘기기로 한 DR-36 (a)(b) 계약(문구 id와 타입만 추가)이 들어갔고 문구가 없어 타입 검사가 실패했다. 고정 판을 만든 뒤 빌드하지 않고 검토에 넘긴 것이 원인이다. 문구 커밋 하나만 골라 더해 바로잡고 전체 검증을 다시 통과시킨 뒤 병합했다. 기존 동작을 바꾸는 DR-36 (c)(d)는 들어가지 않았음을 확인했다.
- 다음 묶음: DR-36 (c) Anthropic 실행 거부용 키 모양과 (d), DR-37 (a) Anthropic 인증 실패 고정 문구(둘 다 기존 Anthropic 동작을 바꾼다), `doctor`의 키 주소 안내와 모델 출처, 변경 보기의 파일별 표시, DR-37 (c)(d), 문서(privacy.md, usage.md의 제공자 절과 한계 절).
- 확인하지 않은 범위: **실제 Anthropic·OpenAI API 호출**(OpenAI 어댑터는 공식 문서의 서술과 가짜 서버로만 확인했다), FAT·exFAT 실제 볼륨, Linux·macOS, GUI 패키지 빌드와 코드 서명. 현행 Codex 계열 모델 id가 API에 없으므로 OpenAI 제공자의 모델은 사용자가 고른다.
- 알려진 한계(추가): 변경 기록 파일을 변조하면 변경 보기의 가림을 우회할 수 있다(DR-37 b). 심한 부하에서 잠금 판정이 안전한 쪽(`workspace_locked`)으로 끝날 수 있다.

## 진행 요약 (CP-14, 2026-11-12, main `d7f8381`)

- **사용성 개선과 범용 작업 묶음을 main에 병합했다**(`d7f8381`). 작업 브랜치 10개를 PM 통합 worktree(`pm/integration` `4ebc945`)에서 합쳐 검증한 판과 한 파일도 다르지 않다.
- 병합 뒤 main에서 PM이 실행한 검증: `npm ci` 성공, 타입 검사 통과, 유닛 1508건 중 1503 통과·실패 0·건너뜀 3·todo 2, 통합 519건 통과·실패 0, `check-secrets --tracked` 발견 없음. 실제 API 미실행.
- 들어간 것: 사용성 CLI 연결(N-1~N-27: 기본 설정 위치, `init`, 프로필, 한 줄 실행, 두 언어, 사람용 출력, `runs`, `--run latest`, `revert --dry-run`, 진단, 잠금 안내), 범용 작업(계약 G-A, 엔진 G-B, 도구·적용기·정책 G-C, 검증기·표 해석 G-D, 저장·되돌리기 G-E, CLI `plan`·`apply`·`review` G-F, 통합 사례 G-G), 앱 계층 추가분(실행 목록, 설정 만들기, 계획·적용·사람 확인, 동의 전달), 독립 GUI 뼈대(`gui/`, GU-1·GU-2), 사용 문서.
- 병합 전 검토(모두 구현자가 아닌 세션, 원문은 `docs/reviews/2026-11-12-`): r5, r6, r7·r7b, r9·r9b·r9c, r10·r10b, r11, r12, r13, r14, r15. 병합 시점에 열린 높음·중간 지적은 없다. R-14·R-15의 중간(계획 보기의 가림 비교)은 CLI 연결 `2f6d5c8`로 닫혔고 PM이 통합 판에서 앱 계층 시험으로 확인했다.
- CP-13에 적은 main의 알려진 결함 세 건(위조 실행 기록의 되돌리기, 검증기 id 출력, pid만 보는 잠금)은 이 병합으로 고쳐졌다.
- 남은 것(후속 배정):
  - 검토의 낮음 지적: R-10b 2건, R-12 4건, R-13 3건, R-14 3건, R-15 1건(링크와 원본 지우기 사이에서 끊긴 적용).
  - todo로 표시된 시험 2건(`tests/unit/app/plan-review.test.ts`, `tests/unit/engine/g-real-combination.test.ts`)의 표시 제거.
  - N-28 시험 수정(pid로 죽이는 유닛 시험, 간헐 실패 Z-1의 유력한 원인)은 w3:p5가 main 기준 커밋을 준비 중이다.
  - DR-29 후속: 실행이 변경 파일의 가린 표기를 기록해 `changes`가 다시 글을 보여 줄 수 있게 한다. 폐기 보관함·실행 기록 정리의 계약과 함수.
  - 두 번째 제공자(Codex, DR-22): 묶음이 병합됐으므로 착수한다.
  - 독립 GUI의 화면 단위(GU-3 이후).
- 확인하지 않은 범위: 실제 Anthropic API, FAT·exFAT 실제 볼륨(동의 경로는 링크 실패를 주입한 유닛으로만 확인), Linux·macOS, GUI 패키지 빌드와 코드 서명.

## 진행 요약 (CP-13, 2026-11-12, main `143d161`)

- main에 병합된 것(재개 뒤): 체험 예시와 사용 문서(N-D), 단계 4·5 설계 문서 넷과 맞춤(D3), `models` 통합 사례와 Z-1 진단, 사용성 계약(N-14~N-18 수정 포함), 두 언어 문구 카탈로그(N-B), 사람용 출력·실행 목록·`revert --dry-run` 모듈(N-C), 앱 계층 `src/app`(A-1, DR-15 수정 포함), 시험의 죽은 잠금 pid 수정(Z-2).
- 마지막 합친 트리 검증(PM 실행, `143d161`): 타입 검사 통과, 유닛 850건 중 849 통과·실패 0·건너뜀 1, 통합 387건 통과, 비밀 검사 발견 없음. 실제 API 미실행.
- 아직 main에 없는 것(브랜치에서 진행 중): 사용성 모듈의 CLI 연결(N-A, `claude/workspace-policy`), N-23~N-26 수정(`claude/core-tools`), 새 계약의 문구(`claude/security-core`), 범용 작업 계약·엔진(`claude/general-tasks`), 도구·적용기·정책(`claude/gui-design`), 검증기·표 해석(`claude/revert-store`), 앱 계층의 실행 목록·`changes`·VS Code 확장 코어(`claude/adapter-contract`). 계약·문구·출력·CLI는 합친 트리가 통과할 때 한 묶음으로 병합한다.
- main에 남아 있는 알려진 결함: 위조된 실행 기록을 되돌리면 사용자 파일이 지워진다(R-2 M-2, 결정 N-23 (b)·N-26, 수정 진행 중). 진행 줄과 `report`가 task의 검증기 id를 그대로 낸다(R-3, N-24 (a), 연결 때 수정). 잠금이 pid만으로 생존을 판정한다(N-25).
- 간헐 실패: Z-1(빈 stdout)은 재현되지 않았고 원인 미확정이다. Z-2(T-9)는 원인을 확인하고 시험을 고쳤다.
- 검토 기록: `docs/reviews/2026-11-12-`의 n(계약), r1(설계), r2(문구·출력), r3(계약 수정), r4(범용 계약·앱 계층). R-5(엔진·도구)는 w3:p5가 진행 중이다.
- 결정 번호: 사용성 N-14~N-26은 [사용성 개선 지시](work-orders/phase-4-usability.md), 설계 DR-1~DR-17은 [단계 4·5 설계 지시](work-orders/phase-4-5-design.md).
- 운영 교훈: 새 모듈(A-1, N-C)을 독립 검토 전에 병합해 높음·중간 결함이 main에 들어갔다. 이후 새 모듈은 교차 검토 결과를 본 뒤 병합한다.

## 사용자 지시 (CP-12, 2026-11-12)

- 개발 목표는 최종 설계까지 모두 구현하는 것이다. 사용성 개선, 단계 4 범용 작업, 단계 5 어댑터 계약·VS Code 확장·독립 GUI를 설계에서 구현까지 이어 간다.
- 작업자는 작업 지침 교육(개발 절차 5절)을 받고 시작한다.
- 작업 중 필요해진 새 지침은 PM이 바로 추가하지 않는다. 아래 "지침 후보"에 모아 두고 사용자가 확인한 뒤 추가한다. 사용자가 수시로 필요한 지침이 있는지 묻는다.
- 사용자 판단이 필요한 질문은 PM이 먼저 받아 아래 "사용자 확인 대기"에 모은다. 사용자가 질문을 알려 달라고 하면 하나씩 정리한다. 이미 쌓인 결정이나 문서에 근거가 있으면 PM이 직접 답하고 근거를 작업 지시서에 남긴다.
- Codex는 사용 한도가 적어 검증 작업만 맡긴다. 한도로 멈추면 5시간 주기로 초기화되므로 그때 확인해 다시 배정한다.
- 커밋과 push는 적절한 단위로 하고, 작성자는 `gangdonggil <gangdonggilstudy@gmail.com>`이다.
- 필요하면 각 작업 탭에서 Claude 한 세션을 보조 관리자로 지정해도 된다(Codex 제외). 지금은 PM이 모두 직접 배정한다. 사용성 개선의 순서 조율이 PM의 병목이 되면 그때 WORKING 탭에 보조 관리자를 둔다.

- 제품 방향(같은 날 추가): **GUI를 지원한다. Codex도 지원한다.** 참고 사항으로 받았다.
  - GUI: 독립 GUI는 설계에서 끝내지 않고 구현 대상이다. 형태와 비용에 관한 Q-7은 그대로 확인이 필요하다.
  - Codex: PM은 "Anthropic 외에 OpenAI Codex 계열 모델을 두 번째 제공자로 쓸 수 있게 한다"로 이해했다(Q-9로 확인 대기). 이 이해에 따라 모델 인터페이스, 설정, 문구, 어댑터 계약에 Anthropic 전용 가정을 새로 넣지 않는다. 구현 착수는 사용자 확인 뒤다. API 제공자 우선순위는 여전히 Anthropic이다.

### 사용자 답 (2026-11-12, 질문을 하나씩 확인함)

| 번호 | 사용자 답 | 적용 |
| --- | --- | --- |
| Q-9 | Codex 지원은 OpenAI Codex 계열 모델을 Anthropic에 이은 두 번째 API 제공자로 추가하는 것이다. 지금은 제공자 중립 조사만 하고 구현은 범용 작업 묶음이 main에 들어간 뒤 시작한다 | w3:p9가 조사 중. 결정 DR-22 |
| Q-7 | 독립 GUI는 Electron, Windows 11 64비트 먼저. 코드 서명은 배포 전에 다시 정한다 | 결정 DR-20 |
| Q-3 | **VS Code 플러그인은 개발하지 않는다.** 플러그인과 같은 편의성을 독립 GUI가 갖게 한다. GUI에 필요한 개발 의존성은 PM이 근거를 기록하고 버전을 고정해 추가한다. CLI·엔진의 실행 의존성은 0개로 유지한다 | 결정 DR-20. N-13(VS Code 확장 먼저)과 VX 계열 결정을 대체한다 |
| Q-4 | 개인정보가 든 표의 원자료 행은 모델로 보내지 않는다. 로컬 집계 도구가 생길 때까지 개인정보 자료 분석은 지원하지 않는다 | GT-D8 (b) 확정 |
| Q-5, Q-6 | 삭제는 보관함 이동, 자료 분석은 사람 확인이 기본, 바이너리 파일 이동 허용 | GT-D5, GT-D7 확정 |
| Q-8 | 하드 링크가 없는 드라이브에서는 기본으로 막고, 적용 전 점검에서 위험을 알린 뒤 사용자가 그 실행에 한해 따로 동의하면 옮긴다 | 결정 DR-21. DR-18 (b)를 고친다 |
| Q-1 | 비밀 검사 훅은 설치하지 않고 커밋마다 수동 검사를 유지한다 | 지금 방식 그대로 |

### 사용자 확인 대기

(위 답으로 Q-1, Q-3~Q-9는 모두 정리됐다. 아래 표는 기록으로 남긴다. 새 질문이 생기면 이 표에 더한다.)

| 번호 | 출처 | 질문 | PM 가정(진행 중) |
| --- | --- | --- | --- |
| Q-1 | PM | 비밀 검사 커밋 전 훅 설치가 자동 권한 판단에서 막혔다. 사용자가 직접 설치하거나 허용할지 | 훅이 생길 때까지 모든 커밋 전에 `node scripts/check-secrets.mjs --staged`를 직접 실행한다 |

| Q-2 | PM | `git push origin main`이 거부됐다(이 PC의 SSH 키는 GitHub 계정 gangdonggil로 인증되는데 원격 `gangdonggilstudy/Codaryn`에 쓰기 권한이 없다). 저장소에 그 계정을 협업자로 추가할지, gangdonggilstudy용 키를 등록할지 | **해결(2026-11-12).** 사용자가 권한을 줬고 `b386166` push가 성공했다 |

| Q-3 | P5-A (VX-D4) | VS Code 확장 개발에 개발 의존성 `@types/vscode`를 추가해도 되는가 | 추가하지 않고 VS Code API에 의존하지 않는 확장 코어까지만 구현한다 |
| Q-4 | P4-G (GT-D8) | 개인정보가 든 표를 분석할 때 원자료 행을 Anthropic API로 보내도 되는가 | 안 된다. 집계 도구가 생기기 전에는 개인정보 자료를 다루지 않는다 |
| Q-5 | P4-G (GT-D5, D7) | 파일 정리의 "삭제"를 보관함 이동으로 대신하고, 자료 분석은 기본으로 사람 확인을 거치게 해도 되는가 | 둘 다 그렇게 한다 |
| Q-6 | P4-G | 파일 정리가 이미지·오피스 문서 같은 바이너리 파일을 (내용을 읽지 않고) 옮겨도 되는가 | 된다 |
| Q-7 | P5-U (PQ-1~3) | 독립 GUI: 코드 서명 비용을 쓸지, 설치 크기가 큰 Electron을 받아들일지, Windows 11 x64만으로 시작할지 | 답을 받기 전에는 GUI 구현을 열지 않는다. 설계 기준은 Electron, Windows 11 x64 우선 |

| Q-8 | G-C, R-5 (DR-18 b) | 하드 링크가 없는 드라이브(FAT·exFAT, 예: USB 메모리)에서는 이동 중 다른 파일을 덮어쓸 작은 가능성이 있다. 그런 드라이브에서 파일 정리를 아예 막을지, 위험을 알리고 허용할지 | 막는다. 첫 항목에서 멈추고 아무것도 바꾸지 않는다. 적용 전 점검에서 미리 알린다. Windows의 읽기 전용 파일도 옮기지 않는다 |

| Q-9 | PM | "Codex 지원"의 뜻: (a) OpenAI Codex 계열 모델을 두 번째 API 제공자로 추가, (b) Codex CLI와의 연동(예: Codex가 Codaryn을 부르거나 그 반대), (c) 둘 다. 그리고 착수 시점 | (a)로 이해하고, 지금은 Anthropic 전용 가정을 새로 넣지 않는 것까지만 한다. 제공자 구현은 확인 뒤 |

### 지침 후보

| 번호 | 출처 | 내용 | 상태 |
| --- | --- | --- | --- |
| G-1 | PM | 비밀 검사 훅이 없을 때는 커밋 전에 같은 검사를 직접 실행하고 보고서에 결과를 적는다 | 사용자 확인(2026-11-12). `development-workflow.md` 7절에 추가 |
| G-2 | w3:pA | 자기 브랜치의 push 전 커밋을 되돌려야 할 때의 규칙(예: `git reset --keep`만 허용, 되돌리기 전에 보고서에 먼저 기록). 지금 지침은 `reset --hard`만 금지한다 | 사용자 확인(2026-11-12). 7절에 추가 |
| G-3 | PM | 새 모듈은 구현자가 아닌 세션의 교차 검토 결과를 본 뒤 main에 병합한다(지금 절차는 병합 뒤 검토) | 사용자 확인(2026-11-12). 8절에 추가 |
| G-4 | w3:p9 | 커밋 전 `git diff --cached --check`가 실패하면 커밋하지 않는다(검사 실패에도 커밋이 만들어진 일이 있었다) | 사용자 확인(2026-11-12). 7절에 추가 |
| G-6 | 사용자 | 원격 push는 오케스트레이터만 한다. 오케스트레이터가 직접 검증한 변경만 올린다 | 사용자 제안(2026-11-12). 8절에 추가 |
| G-7 | w3:p5 | 시험은 자기가 띄운 자식의 핸들로만 프로세스를 끝낸다. 기록해 둔 pid 번호로 죽이지 않는다(끝난 pid는 다른 프로세스에 다시 주어진다). 통합 시험 규칙을 유닛 시험에도 적용한다 | 사용자 확인(2026-11-12). 7절에 추가 |
| G-8 | w3:pB | 여러 담당이 계약을 함께 따라가는 구간에는 어느 브랜치도 단독으로 타입 검사를 통과하지 못할 수 있다. 그때는 자기 범위의 시험 통과를 확인하고, 물려받은 오류의 파일 목록을 커밋 메시지나 보고서에 적은 뒤 커밋한다(G-4의 보완) | 사용자 확인(2026-11-12). 7절에 추가 |
| G-9 | w3:pB, PM | 보고하는 수치는 실제로 올리는 판에서 잰 것이어야 하고 판의 해시를 함께 적는다. 병합하거나 고정 판을 만든 뒤에는 그 판에서 빌드와 시험을 다시 돌린다(PM의 고정 판 포함) | 사용자 확인(2026-11-12). 7절에 추가 |
| G-10 | w3:p7 | 보고서와 문서에 키 모양으로 보일 수 있는 합성 예시는 문자열을 쪼개 쓰거나 설명으로 적는다(커밋 비밀 검사에 걸린다) | 사용자 확인(2026-11-12). 7절에 추가 |
| G-11 | w3:pB, w3:p7 | 닿지 않는 주소가 필요한 시험과 탐침은 예약 주소(TEST-NET, `.test`)를 쓰지 않고 `127.0.0.1`의 닫힌 포트를 쓴다. 방어를 일부러 지워 보는 확인은 바깥으로 나갈 수 없는 조건에서만 한다(예약 주소라도 연결 시도와 이름 조회는 컴퓨터 밖으로 나간다) | 사용자 확인(2026-11-12). 7절에 추가 |
| G-12 | 사용자 | 병합·푸시 단위는 결정 하나 또는 기능 하나(계약·문구·구현·연결)로 한다. 약 1,500줄 이하, 검토 1건, 통과하면 바로 병합·push. 무관한 결정을 섞지 않는다 | 사용자 확인(2026-11-12). 8절에 추가 |
| G-5 | w3:p5 | TypeScript 7이 정규식 리터럴의 U+2028 이스케이프를 원문자로 내보낸다. 그런 정규식은 문자열로 만든다 | 사용자 확인(2026-11-12). 7절에 추가 |

## 현재 상태 (CP-12, 재개)

**사용자가 2026-11-12에 새 Herdr 세션 w3의 w3:p1에 오케스트레이터를 맡기고 작업을 재개시켰다.**

- 저장소를 새로 받은 상태였다. worktree, `node_modules`, 공용 훅, 정지 전 `.codaryn/` 메모가 없었다.
  - worktree 5개를 원격 작업 브랜치에서 다시 만들었다.
  - 설계 작업용 worktree 3개(`claude-general`, `claude-adapter`, `claude-gui`)를 main에서 새로 만들었다.
  - 저장소 로컬 설정의 작성자를 `gangdonggil <gangdonggilstudy@gmail.com>`으로 맞췄다. 전역 설정의 메일이 달랐다.
  - 공용 훅 설치는 권한 판단에서 막혀 Q-1로 대기한다.
- main `34393bd` 기준 검증(PM 실행): `npm ci` 성공, 타입 검사 통과, 유닛 726건 중 725 통과·실패 0·건너뜀 1, 통합 343건 통과·실패 0, `check-secrets --tracked` 발견 없음.
- 실행하지 않은 검증: **실제 Anthropic API 호출은 한 번도 하지 않았다.** `tests/live` 점검, Windows 외 OS, OS 수준 격리, 실제 모델로 하는 자기 개발은 모두 미수행이다.
- 미해결 문제:
  - 간헐 실패 Z-1: 통합 전체 4회 중 1회, V-2 사례에서 CLI가 빈 stdout으로 끝났다. 원인 미확정. 진단 보강 `688a918`은 `claude/cli-verification`에만 있다. w3:p8(Codex)이 반복 재현을 맡는다.
  - `models` 통합 사례(`dd638a3`, `832168d`)는 `claude/cli-verification`에만 있다. w3:p4가 main을 병합해 실행한 뒤 PM이 병합한다.
- 배정: 사용성 개선은 [사용성 개선 지시](work-orders/phase-4-usability.md)의 "재개 배정", 단계 4·5 설계는 [단계 4·5 설계 지시](work-orders/phase-4-5-design.md)를 따른다.

### PM 결정 (CP-4, CP-5)

- 도구가 `workspace.resolve` 거부를 `policy_denied`로 돌려주는 것을 승인했다. 계약에 도구 전용 코드를 추가하지 않는다.
- 정책의 거부 사유 보고 순서(path, command, network, destructive, restore)와 내장 도구 고정 요구 표와의 합산 판정을 승인했다.
- Workspace 계약에 `exists`/`stat`을 추가하지 않는다.
- 실행 기록에는 모델에 돌려준 모든 도구 결과를 `tool_result`로 남긴다. 거부된 호출도 `tool_decision` 뒤에 `ok:false` 결과를 기록한다.
- 원위치 규칙을 강화한다: `mask(original)`과 `maskedNext`를 줄로 나눠, 토큰이 든 줄의 목록이 내용과 순서 모두 같아야 한다. 토큰이 없는 줄만 자유롭게 바꿀 수 있다. 비밀이 든 줄 자체는 수정할 수 없다.
- 겹치는 비밀 일치는 구간을 합쳐 하나의 보호 구간으로 만든다. 원문의 `CODARYN_SECRET` 조각은 거부하지 않고 보호 구간으로 가린다(자기 소스 수정이 가능해지도록).
- 검색은 가림본을 대상으로 한다. 자르기는 가린 뒤 토큰 경계에서 한다. 엔진은 직렬화 전에 문자열 필드별로 가린다.
- `allowExtraArgs:true`인 명령 규칙은 추가 인자의 경로를 검사하지 않는다. 코드는 바꾸지 않고 알려진 한계로 문서화한다.
- 설정 결정 C-1~C-8(`docs/work-orders/phase-1b-config.md`): 키는 환경 변수로만, 설정·env 파일은 명시했을 때만, 모델과 출력 상한에 코드 기본값 없음, API 주소는 task로 바꿀 수 없음, 한도 없이는 호출하지 않음.
- 전송은 SDK 대신 Node 내장 `fetch`를 쓴다. 허용 의존성을 넓히지 않기 위해서이며 architecture와 decisions의 "공식 SDK" 선택과 다르다. 두 문서의 갱신은 Codex 판단에 맡긴다.
- 1a 자리표시자 `src/model/anthropic.ts`와 그 유닛 2건은 실제 제공자로 대체되어 삭제했다. 같은 동작은 `tests/unit/cli/anthropic-wire.test.ts`와 통합 m02가 확인한다.
- 알려진 한계로 기록: 파일 해시가 모델과 기록에 노출됨, `CODARYN_SECRET` 리터럴이 든 파일은 수정할 수 없음(자기 개발 단계 전에 완화 여부를 정해야 한다), Windows에서 `.cmd`/`.bat`은 셸 없이 실행되지 않음.

## 세션 (CP-12)

| pane | tab | 작업 | worktree | 브랜치 | 상태 |
| --- | --- | --- | --- | --- | --- |
| w3:p1 | MAIN | 오케스트레이터(PM·통합) | main | `main` | 진행 |
| w3:p2 | WORKING | N-A 계약과 CLI 핵심(역할 1) | `claude-workspace` | `claude/workspace-policy` | 배정 |
| w3:p4 | WORKING | `models` 통합 사례 정리, 이어서 N-E 통합 | `claude-operations` | `claude/cli-verification` | 배정 |
| w3:p5 | WORKING | N-B 문구 카탈로그와 언어 선택 | `claude-quality` | `claude/security-core` | 배정 |
| w3:p6 | WORKING | N-C 사람용 출력과 실행 목록 | `claude-tools` | `claude/core-tools` | 배정 |
| w3:p7 | WORKING-sub | N-D 체험 예시와 사용 문서 | `claude-store` | `claude/revert-store` | 배정 |
| w3:p9 | WORKING-sub | P4-G 범용 작업 워크플로 설계 | `claude-general` | `claude/general-tasks` | 배정 |
| w3:pA | WORKING-sub | P5-A 어댑터 계약과 VS Code 확장 설계 | `claude-adapter` | `claude/adapter-contract` | 배정 |
| w3:pB | WORKING-sub | P5-U 독립 GUI 설계 | `claude-gui` | `claude/gui-design` | 배정 |
| w3:p3 | OPTIONAL | Codex 검증: N-A 계약 검토 완료(`docs/reviews/2026-11-12-n-review-usability-contract.md`) | 읽기 전용 | — | 사용 한도로 정지. 15:43 초기화 뒤 다시 배정. 화면의 한도 증액 질문에는 답하지 않는다 |
| w3:p8 | OPTIONAL-sub | Codex 검증: 반복 실행 4회 완료(실패는 `models` 연결이 없는 커밋 탓, Z-1 아님) | `codex-verify`(분리 HEAD) | — | 사용 한도로 정지. 15:43 초기화 뒤 다시 배정 |

세션 ID는 바뀔 수 있으므로 `herdr agent list`로 실제 상태를 확인한다. 원격에 남은 이전 브랜치 `claude/core-engine`(정지 전 w1:p1)은 worktree 없이 보존한다. 이전 초안 브랜치도 삭제하지 않는다.

## 재개 방법

재개 지시가 오면 다음 순서로 한다. 누가 재개하든(임시 PM, Codex) 같다.

1. `docs/pm-control.json`의 status와 위임 ID를 확인한다.
2. `git -C D:\project\Codaryn status -sb`와 `git worktree list`로 main이 원격과 같고 worktree가 깨끗한지 확인한다. `herdr agent list`로 세션 상태를 확인한다(세션이 닫혔으면 새 세션에 아래 문서를 읽혀 배정한다).
3. main에서 `npm ci`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`을 돌려 기준 상태를 확인한다.
4. `claude/cli-verification`을 main과 합쳐 `models` 통합 사례와 진단 보강을 실행하고, 통과하면 병합한다. 간헐 실패(Z-1)는 진단이 보강된 상태로 다시 나타나면 종료 코드와 stderr로 원인을 찾는다.
5. 사용성 개선을 이어 간다(`work-orders/phase-4-usability.md`): p7이 계약을 먼저 커밋 → p5(N-B), p6(N-C) 병렬 → p7 연결 → p8(N-D 체험 예시와 사용 문서) → p4 통합 → 교차 검토.
6. 그다음 순서: 단계 4 범용 작업 확장 설계와 구현, 어댑터 계약 정의, VS Code 확장(결정 N-13), 독립 GUI 설계 문서. 사용자의 상시 지시(추가 지시가 없으면 끝까지 연속 진행)는 재개 뒤에도 유효하다.
7. 사용자가 직접 해야 하는 것: 실제 호출 점검(`tests/live/README.md`), p1 세션의 사용 한도 선택.

## 회수 시 인계 방법

1. 이 문서의 마지막 체크포인트와 세션 표를 읽는다.
2. `git -C D:\project\Codaryn worktree list`와 각 worktree의 `status --short`, `log --oneline -3`로 실제 상태를 확인한다.
3. 병합되지 않은 작업 브랜치는 그대로 둔다. 진행 중인 작업자는 `herdr agent read <pane>`으로 마지막 보고를 확인한다.
