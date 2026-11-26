# Codex PM 주기 감시와 후속 배정 (2026-11-27)

사용자가 임시 PM에게 세션 상태를 주기적으로 확인해 후속 배정이 멈추지 않게 하고, 같은 workspace에 추가한 Codex 세션을 교육 후 쓰라고 지시했다. 권한 기준은 관리용 main의 `docs/pm-control.json`에 있는 `pm-20261127-codex-01`·`active`·`owner_pane=w3:pJ`다. 이 운영은 실제 API·키 조회·설치/서명/외부 게시의 승인을 넓히지 않는다.

| 담당 | pane | 도구 작업 공간 | 교육 |
| --- | --- | --- | --- |
| 임시 PM codex-worker | w3:pJ | 관리 main | 기존 작업자, 사용자 임시 위임 |
| codex-worker-2 | w3:pK | codex-verify | 기존 통과 |
| codex-worker-3 | w3:pM | claude-adapter | 보고 전체/SHA·14답 확인, 수동 ACK·통과 |
| codex-worker-4 | w3:pN | claude-store | 보고 전체/SHA·14답 확인, 수동 ACK·통과 |

작업 공간은 모두 기존 `.worktrees` 아래 공간을 재사용한다. claude-gui는 PM 보드다. Claude 두 세션에는 새 일을 배정하지 않는다. 도구 cwd와 Herdr TUI cwd는 구분하며 다른 프로젝트의 pane이나 표시된 session ID를 추정해 사용하지 않는다.

## 감시와 알림

- 이 환경에 로컬 Codex 세션을 깨우는 예약 API가 없어 PM 소유의 로컬 Node 감시기를 사용한다. 경로는 main `.codaryn/pm-tools/continuous-20261127/`이며 소스는 `pm-watch-20261127.mjs`, 설정은 `config.json`, 후속 처리 메모는 `continuation.md`다. 이 폴더는 Git 추적 대상이 아닌 실제 운영 근거다.
- 30초마다 등록한 작업의 READY/ACK와 세 작업자의 실제 Herdr 상태를 읽는다. config의 pane·terminal·workspace·Codex 종류·cwd를 대조한다. PM의 표시 이름이 사라지는 현상에는 고정된 PM pane/terminal/cwd만 허용하고, 다른 명시 이름이나 worker 이름 소실을 허용하는 변경은 아니다.
- READY, 보고 없이 대기/차단한 작업자, 명시적 후속 큐가 있으면 PM이 idle/done인 정상 `Ask Codex` 입력 상태일 때만 PM에게 점검 prompt를 보낸다. working/신원 불일치/알 수 없는 UI/선택 화면이면 입력하지 않고 다음 관측에 남긴다. 반복 알림의 최소 간격은 5분이다.
- 감시기는 보고 본문을 읽거나 ACK/채택하거나 worker에게 작업을 자동 전송하지 않는다. 깨어난 PM이 실제 본문 전체·SHA·증거를 읽고 ACK한 뒤 독립 검토·검증·후속 배정을 수행한다. 정상 worker 전달도 실제 상태/입력 UI 확인 뒤 명시 pane으로 한 번만 한다. 전송 접수는 STARTED/READY/인수가 아니다.
- 새 작업은 canonical 통신 도구의 register/dispatch → started/ready → PM 전체 읽기·hash/ACK를 쓴다. 새 3/4의 교육과 첫 배정 때 쓴 수동 보고/ACK는 별도 근거로 보존한다. [통신 절차](../workflows/session-communication.md)의 고정된 옛 PM 자동 전송 gate를 위장하지 않는다.

## 종료·재시작·모호한 전송

- `watch/state.json`이 현재 건강 상태, `watch/owner.json`이 PID·시작·소스 SHA다. owner는 배타 생성하므로 중복 실행하지 않는다. PM 회수/위임 불일치나 `watch/stop.json` 종료 요청을 관측하면 멈춘다. 임의 PID 종료나 창/서버 재시작으로 해결하지 않는다.
- 전송 claim/결과는 실행 폴더와 분리된 `outbox/`에 배타 공개한다. claim만 남거나 UNKNOWN/기록 실패가 있으면 재시작해도 알림을 보류한다. accepted 시각을 복원해 cooldown도 유지한다. PM이 실제 전송 여부를 확인한 사건에만 key별 명시적 해결 기록을 남길 수 있으며 자동 해결·모호한 재송신은 없다.
- 재시작 전 PM은 기존 owner의 PID·명령줄·시작/종료 기록과 미해결 outbox를 확인한다. 종료를 확인한 실행 폴더를 보존한 뒤에만 `start-watch.mjs`를 기존 Node로 숨김 실행한다. outbox는 옮기거나 초기화하지 않는다. source/config/log/receipt의 기존 상위 junction/링크와 namespace 밖 경로를 거부한다.
- 이는 OS 서비스나 클라우드 예약이 아니다. PC/Herdr가 꺼졌을 때 자동 재기동하지 않으며, 다시 켠 뒤 PM이 미인수 보고와 감시 상태를 회수한다. 같은 terminal의 세션 교체, 검사 직후 UI/경로 변경, 전원/디스크 장애까지 완전히 보장하지 않는다. 고정 Herdr 설치 경로가 바뀌면 PM이 확인해야 한다.

## 검토와 실제 확인

- PM 자신의 구현을 worker-4가 독립 검토했다. 첫 검토는 PWR-1(재시작 후 미해결 전송), PWR-2(상위 경로 링크), PWR-3(ACK 모드 구분)를 지적했고 모두 보완했다. 재검토 보고 `83991adc…b2130cd`에서 세 항목 닫힘·새 발견 0을 확인해 ACK한 뒤 notify를 활성화했다.
- 최종 모의/합성 디스크 시험은 22/22, 실패·취소·skip·TODO 0이다. 두 새 Node 프로세스의 outbox 복원과 자기 임시 fixture의 기존 상위 junction 거부를 포함한다. 실제 daemon 전체 재시작/PM 알림 접수/장기 수명을 모두 검증한 수치는 아니다.
- 실제 관측에서는 코드 SHA가 재검토 후보와 일치하는 감시기가 worker READY/ACK와 PM_WORKING을 읽고 입력을 보류함을 확인했다. notify 활성화는 그 뒤 설정 한 항목으로 수행했다. 실제 알림 접수는 후속 idle 때의 outbox accepted 기록으로 따로 확인한다.
- 작업자 이름 3/4를 추가한 통신 변경은 전용 시험 164/164, 합친 타입 검사 exit 0, unit 4,673건(4,662 통과·10 skip·1 TODO), integration 686건(684 통과·1 skip·1 TODO), 실패·취소 0 뒤 채택했다. 라이브 전송과 교육 통과는 이 fake 시험 수치와 별도다.

현재 배정과 채택 판은 [PM 상태](../pm-status.md)의 최신 체크포인트를 따른다. 사용자가 승인을 남겨 둔 범위만 남으면 그 사유를 기록하고, 진행 중인 척하기 위해 불필요한 작업이나 반복 시험을 만들지 않는다.
