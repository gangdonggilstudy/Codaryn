# 세션 통신 실제 적용 확인

PM codex-review. 운영 채택 main 8caa83b6954d9076a915c15c10c086eda48740d0, 검증 후보 c22fa348fb40c692fe3356acefabb8835e6ae049, tree41c33a35e182265e5b60da1aa5b422c0c2dc46b1 일치. 사용자 요청에 따라 기존 Codex만 배정하고 지시 재확인을 요구하지 않았으며 원격 push는 PM만 수행했다.

실제 Herdr로 LOOP에 새 ID를 한 번 전달하고 STARTED/READY 파일을 회수했다. PM이 보고 본문과 SHA를 읽고 명시 ACK했다. 전달 접수와 착수·완료·인수는 별개다. 채택 후 canonical main 절대 스크립트로 같은 closed 기록을 재확인하고, 기존 다섯 Codex도 문서/진행상황/규칙을 읽고 각각 STARTED→보고→READY→PM read/ACK를 완료했다. worker는 직접 Herdr 접속 없이 파일만으로 완료했고 제품/Git 변경이나 push를 하지 않았다. 본 시험은 통신·교육이며 제품 후보 시험으로 세지 않는다.

| 작업 ID | 실제 고정 세션 | 보고 SHA256 | PM 상태 |
| --- | --- | --- | --- |
| comm-live-loop-02 | codex-loop / w3:p8 | ad78eb096bc731a454586aea96193fcb492a3bcfce73adff4ea0367d10ba4d9f | ACK closed |
| comm-edu-check-01 | codex-check / w3:pD | 4f2850a494ea206778ce2adfceff54d55dc246ebc2e330def37dea493f8c0661 | ACK closed |
| comm-edu-loop-01 | codex-loop / w3:p8 | f29101c8b44575c328ca58da03869795c58f4c3ca22f981d299c61dfc840eeac | ACK closed |
| comm-edu-sec-01 | codex-sec / w3:pC | 5e54128d771688ccaf3370750e8eaa9741d6d805d3016c49306c7ba540616784 | ACK closed |
| comm-edu-audit-01 | codex-audit / w3:pE | 7e16807409b6090eedb8975be28523bf755a9c200276a996227a7229557553c7 | ACK closed |
| comm-edu-probe-01 | codex-probe / w3:pF | 8102608c7c5dafabf9fa3494933213aff19701071c4ca940f5be549f19cfd65e | ACK closed |

PM registry/inbox/ack/events는 .codaryn/pm-comms, 각 worker 원문/receipt는 등록된 worktree의 .codaryn/session-comms/<id>에 남는다. 운영 로그에는 task/report/화면 본문이나 host 환경값을 넣지 않는다. PM working일 때 notify는 큐에 보관하는 실제 경로를 확인했다. idle 이후 자동 알림까지 이미 실행했다고 주장하지 않는다. PM 감시는 canonical CLI의 watch --notify --pm-pane w3:p3로 별도 실행하며 수신 전송과 ACK는 구분한다.

첫 실제 comm-live-loop-01은 잘못된 native --timeout 옵션이 CLI 검증에서 거부돼 helper가 UNKNOWN으로 보존했다. 별도 실제 진단 exit2 '--timeout requires --wait'로 입력 전 거부를 확인했고 원래 registry/events를 덮지 않았다. PM 수동 retirement 기록을 남기고 그 ID를 재전송하지 않았으며 새02로 검증했다. 이전 H0/M1/L1, Windows case 낮음1 및 당시 실패/준비 오류도 독립 기록과 원문에 보존한다. 파일이 ASSIGNED/UNKNOWN이라는 이유로 STARTED나 성공으로 올리지 않는다.

PM의 c22fa 정확판 통신77/비밀 검사0, 독립77+원본7+원본20+CLI1와 추가 전송경계 검사는 최종 독립 보고에 있다. c22fa의 나머지1369 tracked raw blob은 앞서 전체 검사한0e711과 같다. 0e711에서 offline ci/typecheck/clean build/GUI build·lock0, unit4316/4305pass/0fail/10skip/1TODO, integration684/682pass/0fail/1skip/1TODO였고 c22fa에서 전체 제품 검사를 다시 실행한 것으로 쓰지 않는다. 이 운영 작업의 full GUI/smoke/CLI95 신규 실행은 없다.

PC 재시작 뒤에는 미인수 poll부터 하고 PM watcher를 다시 시작한다. watchdog/OS 서비스의 자동 재기동을 구현한 것은 아니다. 모호한 send claim은 재송신하지 않고 파일과 실제 세션을 확인한다. 전원·디스크 손상, ACL, PID/terminal 재사용, 최종 확인과 send 사이의 변경 및 미지 UI의 완전한 보장은 없다. 실제 API/키/외부 시험망과 제품 최종 graph는 이 작업의 범위가 아니다.
