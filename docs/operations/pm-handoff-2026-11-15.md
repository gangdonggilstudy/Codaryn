# 2026-11-15 Codex → Claude 오케스트레이터 인계

## 2026-11-22 이후 바뀐 점

아래 본문은 2026-11-15 인계 당시의 기록이다. 그 뒤 바뀐 현재 사실만 여기에 적는다.

- 작업자 세션은 codex-worker(`w3:pJ`, Codex)와 claude-worker(`w3:pH`, Claude Code) 둘이다(2026-11-22 사용자 결정, 둘 다 사전 교육 통과). 아래 "세션·worktree 소유권" 표의 Codex 세션(codex-review 포함)은 지금 없다. 통합·커밋·푸시는 계속 현재 PM만 한다.
- 키 없는 Windows 수동 점검 패킷은 v2 `D:/project/Codaryn/.codaryn/manual-packet-v2/packet.md`다(pm-status CP-58). 아래의 v1 temp 패킷 경로는 당시 것이다. 12항목은 여전히 모두 NOT_RUN이다.
- 세션 통신 도구 `scripts/pm-session-comms.mjs`는 2026-11-23에 두 작업자만 받도록 고쳐 채택했다(main `1c6f5751`, pm-status CP-59). 새 작업은 register → dispatch(전송 없음) → PM의 명시 Herdr prompt → 작업자 started/ready → poll → ack 순서다. Claude 작업자에게 `--send`를 쓰지 않는다. 그 전의 수동 보고(report.md와 ready-manual.json)는 도구가 실패할 때의 대체 방법으로만 쓴다.

이 문서는 사용자 직접 지시로 준비한 현재 운영 인계다. 과거 Claude 토큰 부족·배정 금지와 11월 14일 회수 기록은 당시 이력이다. 사용자가 이번에 기존 Claude를 찾아 오케스트레이터를 인계하고 codex-review를 일반 작업자로 전환하라고 지시했다. 제품 범위·실행 권한을 새로 확장하는 지시는 아니다. **커밋에 trailer를 넣지 말라는 추가 사용자 지시도 받았다.**

## 소유권 전환과 인수 확인

- 수신자: 실제 조회한 Claude Code `w3:pG`, `w3:t6`, cwd `D:/project/Codaryn`, session `9d6ad963-02c1-4d06-848f-f3c59b3a04e9`, terminal `term_660488a65c75615`. 이전 w3:p1은 현재 수신자가 아니다.
- 인계자: `codex-review`, `w3:p3`. 인수 확인 전에는 전환 문서·통신 정리만 담당하며 새 제품 작업을 배정하지 않는다.
- 새 위임 ID: `pm-20261115-claude-01`. 관리 main의 `docs/pm-control.json`이 이 ID와 수신자 pane/session으로 active가 된 뒤 수신자가 유일한 PM·통합·커밋·푸시 담당이다.
- 수신자는 아래 필수 자료와 로컬 증거를 읽고, 인수 내용을 자기 말로 요약해 명시 ACK한다. 그 전에는 main 수정·배정·Git 변경을 하지 않는다. ACK 후 인계자가 활성화 문서 커밋·푸시를 마지막으로 수행하고 활성화 알림을 보낸다. 그 뒤 인계자는 일반 Codex 작업자이며 main 수정·배정·통합·푸시를 하지 않는다.
- 구현·문서·분석·검증의 작업 실행은 기존 Codex 세션에 배정한다. Claude는 PM 한 세션이다. 작업자에게 push를 시키지 않는다. Codex는 기존 회수 규칙을 유지하되 요청 없이 PM 일을 병행하지 않는다.
- 회수 문구는 `PM 회수`다. 새 PM은 배정 전, 작업 묶음 시작 전, 커밋·병합·푸시 전에 canonical main의 status/위임 ID/owner를 확인한다. revoked 또는 불일치이면 새 배정·변경을 멈추고 모든 산출물을 보존해 보고한다.

## 반드시 먼저 읽을 자료

1. main `AGENTS.md`, `docs/pm-control.json`, 이 문서와 `docs/pm-handoff.md`의 최신 overlay. 예전 인계의 "바로 이어갈 순서"를 현재 미완료 목록으로 재실행하지 않는다.
2. `docs/pm-status.md`의 CP54→53→52→51 및 관련 CP50. `docs/roadmap.md`, `docs/progress.md`, `docs/design/implementation-map.md`, `docs/decision-register.md`의 날짜 있는 현재 설명.
3. `docs/personas.md`, `docs/development-workflow.md`, `docs/unit-test-plan.md`, `docs/work-orders/phase-4-5-design.md`, `docs/workflows/session-communication.md`. 과거 Codex PM 표기는 이번 active 위임 동안 수신 PM이 대행한다. Claude 작업자들을 새로 켜는 허가는 아니다.
4. `docs/reviews/2026-11-15-offline-acceptance-handoff.md`, `2026-11-15-offline-acceptance-matrix.md`, `docs/acceptance/windows-keyless-cp54.md`, 관련 원문 `docs/manual-checks.md`.
5. CP53 계획·최초 실패·수정·독립 검토 네 문서: `docs/reviews/2026-11-15-cli-host-composition-plan.md`, `2026-11-15-cli-host-parity-initial.md`, `2026-11-15-cli-host-parity-count-fix.md`, `2026-11-15-cli-host-parity-probe.md`.
6. 로컬 `.codaryn/pm-tools/codex-current.json`, `dispatch-current.md`, `receipts/cp54-adoption.json`, `receipts/keyless-manual-cp54-seal.json`. 인계 전 상태 사본·전체 poll·worktree/agent 목록·watcher 종료 증거는 `.codaryn/pm-tools/claude-handoff-20261115/`에 둔다. 원문 `.codaryn` 파일들은 삭제·덮어쓰지 않는다.

## 정확한 출발점과 이미 완료된 범위

- 인계 준비 전 main=origin/main=`c8cf7a9dd9c2780def3b8ea9e111371b03a5ffaa`, tree `5db495c219afb6e0e36e33f23aeb1c04f99905b7`, clean. 이번 운영 인계 문서 커밋은 이 뒤에 추가된다. 최신 HEAD는 `git rev-parse HEAD`로 확인한다.
- C1~C11 이행 완료(CP51). U327~U336 10/10 채택. C11 마감 `b55ef4a32e8fd6c59c2cd0c6a77382c3b712713c`.
- CP52 현재 문서 4개 현행화 완료: worker `5bf48869756f5ee0778529acc074e3c611a62951`, 채택 `42b16b94512ee8d696c36d53ae48450e4980abbf`, CP52 기록 `2c202d859c7e1d3a1502eefc8b17d3d03891a0ff`. 옛 결정·수치·DR65 사용자 결정·DR67은 보존했다.
- CP53 선택한 한 대본의 actual CLI child ↔ 별도 actual host child 저장물 비교 완료. 새 GUI 시험 2파일 407줄만 추가. worker `cc41c47559f11de6f232e297d25b5a557740ff19`, 검토 tree `d00713587784543cb4f4ce10aa8bf9db14b7c160`, main 채택 `823486b5b81d2c1a956bc074f574a383559475ce`, CP53 기록 `c00ce7d0a30a855afda3111ebf83b969509ef222`. 제품 코드·기존 시험·설정·package/lock 불변.
- CP54 승인된 오프라인 범위의 유한한 인계와 키 없는 수동 패킷 준비 완료. 제한된 요구 대조에서 새로 시작할 근거가 있는 승인된 오프라인 코드 단위를 확인하지 못했다. 모든 Codex 보고 회수·본문 읽기·해시 검증·명시 ACK 후 STOP. 임의 C12/새 gate/추측성 시험/끝없는 문서 보완을 만들지 않는다. **전체 제품 또는 단계5 완료라는 뜻은 아니다.**
- 마지막 보고 `offline-acceptance-handoff-check-01`: SHA256 `2133caee5febe2b84e3f8cbd9686dee3ed5eea70dde74420ae37f8a160961ffb`. PM이 report+matrix 전체를 읽고 34 proof파일,19 literal Git blobs,기존 읽기 metadata6개를 확인해 canonical ACK CLOSED. 보고 원본은 `.worktrees/claude-store/.codaryn/session-comms/offline-acceptance-handoff-check-01/`.

## 실제 검증과 읽기 증거의 경계

| 증거 | 실제 대상과 결과 | 확대하면 안 되는 내용 |
| --- | --- | --- |
| 마지막 전체 제품 검증 | `881533de4b66d9ab3e1497cf22c7043c7b398504`: offline ci/type/root·GUI build/lock0, unit4328 중 pass4317/fail0/skip10/TODO1, integration684 중 pass682/fail0/skip1/TODO1, GUI426, smoke227, CLI95 diff0, secrets0 | CP53 이후 전체 suite를 다시 실행한 수치가 아니다 |
| C11 최종 graph | exact `37fb966abe088a666cb33ce533f484a5b06b5957`: source roots66/reachable156/edges918(value522,type396), runtime66/154/522, CLI0/unknown0/native exit0. 원본 selftest30/30·147입력 bytes 동일, 두 독립 graph raw 일치 | source union이 기준. type/value 투영이나 wrapper exit만으로 판단하지 않는다 |
| CP53 worker | 새 시험10pass(실제 쌍 부모1+negative8+positive1), 관련 GUI5pass, 기존 root c01 24pass. fail/skip/TODO0 | 전체 GUI436을 새 실측으로 더하지 않는다 |
| CP53 PROBE | exact2c202 archive1388+정확2파일, fresh root출력1678/GUI378, 새10·관련5·별도 복사 negative4 pass. 기존 c0124는 READ로 구분. H0/M0/L0 | API·다른 OS·실제 Electron 수동 UI 검증이 아니다 |
| CP54 준비 | 빌드2056파일+Node/Electron pin, 실행기 syntax·info-only0, 결과표12 NOT_RUN | actual CLI/GUI를 열지 않았고 수동 관찰은 없다 |

- CP53 양쪽 scripted/done/verified0, usage turns4/tools2/input4/output4/repair0, journal23·tool_result3. 거부된 도구는 tool_result에 남지만 실제 실행 tool counter에는 세지 않는다. PM의 잘못된 3→2 기대 교정 근거는 기존 engine handleCall의 거부 조기 반환과 기존 n17 assertion이다. 제품/옛 oracle을 관찰에 맞춰 바꾸지 않았다.
- 완전 저장 비교는 unknown field·presence·순서·허용되지 않은 leaf를 보존한다. 정규화는 검증된 run 포인터·journal 최상위 at·같은 run 내부 일치하는 duration2곳·발급 token2개의 bijection/좌표만 허용한다. IPC 축약 view는 같은 host run 저장물의 독립 기대 투영으로 검증하며 전체 disk 비교를 대신하지 않는다.
- PM은 CP53 PROBE 4,226파일 해시+metadata-only2개, 원본196개와 working2핀을 확인하고 ACK했다. 합성 repository fixture를 compiler/test가 읽는 것과 개발자 key/env/config/private mapping 금지를 구분한다. 메타데이터 제외를 모든 프로세스의 무읽기로 표현하지 않는다.
- 기존 host client는 stderr를 버리므로 그 stream은 미검증이다. loopback-only/refused0은 OS 전체 네트워크 차단 증명이 아니다. worktree·launcher static env는 OS sandbox가 아니다.

## 보존할 실패·미해결 사항

- U333 최초 전체 unit의 u22: busy에서 run_in_progress 기대/run_not_found 관찰. 동일 SHA 재실행은 통과했지만 **최초 원인 불명**, 직접 INIT 회귀로 입증된 것이 아니다.
- U321 부모 교체 시 `.gitignore` 외부2bytes 쓰기, 최종 검사 이후 hardlink append137bytes 경계. 좁은 V41/V41b 수정 채택은 범용 OS 경합 봉쇄 증명이 아니다. 별도 승인된 미완료 보완 단위가 있다고 추정하지 않는다.
- 과거 JSON N19 narrow snippet-pin의 추출 scope 미해결. full guard+실제9줄 증거와 구분하고 과거 pin을 억지로 맞추지 않는다.
- U336 처음 보고는 Readonly 정규화로 raw const-binding readonly 약화를 가렸다. 원래 실패 보고59c41e는 읽기/ACK만 했고 통과로 채택하지 않았다. direct export const alias와 영구 modifier assertion+V55로 수정·독립 확인했다. PM EOF 경고 커밋5a5e935는 새 ef009로만 고쳤고 이력 재작성하지 않았다.
- C11 SEC의 중첩 cwd selftest는2688/unknown1/exit1/30중0, 입력147중143없음으로 막혔다. PROBE가 허용된 sibling 위치에서 원본 tool/입력147 bytes 그대로 selftest30/30과 graph 동일을 확인해 배치 문제를 닫았다. 일반 cwd 의존성을 제품 수정했다고 쓰지 않는다. 최초 SEC 보고0235b4d는 보존한다.
- CP53 최초 writer 오류, 첫 실제 쌍의 PM count3 실패, 최초 cleanup 증거 한계, 후속 summary helper 오류, PROBE 준비 오류3은 모두 원문 보고에 있다. 같은 fixture의 재실행을 새 시나리오로 합산하지 않는다.
- CP54 helper 첫 syntax check는 Markdown backtick SyntaxError로 어떤 코드도 실행 전에 실패했다. 원본 `.codaryn/pm-tools/prepare-keyless-cp54.failed-v1.mjs`와 출력을 보존하고 template만 수정한 뒤 syntax/준비/info-only 성공. 제품 실행 실패나 수동 결과로 세지 않는다.
- 실제 Anthropic/OpenAI API·명시 모델 검증·모델 자기개발은 미실행. 실제 키를 읽거나 사용자에게 채팅으로 달라고 하지 않는다. TTY/OS dialogs/IME/Narrator/다른OS/실볼륨은 해당 실제 관찰이 없는 한 NOT_RUN.
- GU9/DR67 packager·installer·fuses·Node bundle·서명·외부 게시·비용은 명시 미승인. 기존 승인된 Electron 개발 runtime 사용과 구분한다. 필요한 승인은 실제 버전/체크섬/URL/명령/산출물/검증/비용을 검토 가능하게 준비한 뒤 하나씩 올린다.
- VS Code/line protocol은 DR20/66에서 취소된 방향이다. 미완료 기능으로 되살리지 않는다.

## 세션·worktree 소유권

| 실제 세션 | 현재 역할/상태 | 사용할 기존 worktree·checkout |
| --- | --- | --- |
| Claude w3:pG | 새 PM. explicit ACK→active 알림 후 관리 main 소유 | `D:/project/Codaryn`, main |
| codex-review w3:p3 | 인계 후 일반 작업자, 현재 배정 없음. PM 지시 전 main/제품 변경·커밋·push 없음 | 새 PM이 기존 worktree와 소유 파일을 지정해야 착수 |
| codex-check w3:pD | 요구/문서·분석, 최신 보고 ACK 후 STOP | `.worktrees/claude-store`, `docs/post-c11-current-check`, HEAD5bf48869756f5ee0778529acc074e3c611a62951 |
| codex-loop w3:p8 | CLI/앱 구현·검증, ACK 후 STOP | `.worktrees/claude-adapter`, `test/cli-host-parity-loop`, HEADcc41c47559f11de6f232e297d25b5a557740ff19 |
| codex-sec w3:pC | 보안 독립 검토, STOP | `.worktrees/codex-verify`, detached4cf605a2f8bd4b3089af1052d87f51577272bdf7, 고유 ignored 폴더만 |
| codex-audit w3:pE | 독립 감사, STOP | 같은 verify checkout, 서로 다른 ignored 폴더만 |
| codex-probe w3:pF | 재현·별도 프로세스 독립 검증, STOP | 같은 verify checkout, 서로 다른 ignored 폴더만 |

- 표의 경로는 모두 `D:/project/Codaryn` 기준이다. Herdr TUI cwd가 main이어도 tool cwd는 지정 worktree 절대 경로다. 시작마다 status/branch/toplevel을 확인한다.
- 기존 `pm-unit` HEAD881533/branchpm/u336-report-codex는 마지막 전체 검증판이며 기존 Electron 설치가 있다. 임의 checkout/clean을 하지 않는다. `.worktrees/claude-workspace` 등 다른 오래된 worktree의 checkout을 현재 미완료 작업으로 추측하지 않는다. 전체 실제 목록은 로컬 인계 snapshot에 있다.
- 새 worktree 생성 금지. 독립 검증은 지정 verify WT의 새 고유 ignored git archive 사본으로 한다. 공유 verify checkout 자체를 바꾸거나 다른 사람 폴더를 수정하지 않는다.
- 모든 작업에 전문 페르소나·목적·소유 파일·worktree/branch·대상 SHA·완료 기준·실행 범위를 명시한다. 구현자는 자기 결과를 독립 검토하지 않는다. STOP 상태는 결과 보존이며 삭제 허가가 아니다.

## 실패하지 않는 세션 통신과 PM 변경 한계

- 현재 tracked `scripts/pm-session-comms.mjs`는 Codex PM 이름 `codex-review`와 pane `w3:p3`에 **전송 identity를 고정**했다. Claude를 codex-review로 이름 바꾸거나 환경·pane을 위장해 우회하지 않는다. 새 Claude PM에서 기존 `dispatch --send`, `poll/watch --notify`, `checkPM`을 그대로 사용하면 안 된다. `codex-review`는 새 작업자의 허용 목록에도 없다.
- 인계 전 모든 등록 job은 ACK CLOSED다. `comm-live-loop-01` 하나는 pre-input CLI 인자 오류 뒤 PM이 폐기/보존한 UNKNOWN의 과거 건으로, 지금 CHECKOUT_MISMATCH REJECTED가 예상 결과다. 이를 재전송·삭제하거나 실제 미완료 작업으로 되살리지 않는다.
- 기존 watcher PID32360/exec39452는 codex-review로 알림을 보내므로 인계자가 소유 PID·시작 시각·Node 경로·명령줄을 확인해 **해당 watcher만 종료**한다. old17044는 이미 종료. owner/log/종료 record는 보존하며 Herdr/server/다른 Node 프로세스를 종료하지 않는다. 종료 증거가 없으면 새 알림 감시기를 켜지 않는다.
- file-only `register`, `dispatch`(send 없음), `poll`(notify 없음), `ack --read`는 canonical cwd/worker identity·checkout·digest 검사를 유지하며 PM 전송 identity를 요구하지 않는다. 코드 source를 확인한 현 상태의 사용법이며 실행 권한 확대가 아니다. Claude PM은 이 파일 계약과 **별도 명시 Herdr native prompt**를 조합할 수 있다. 새 PM 전용 전송 변경이 필요하면 좁은 운영도구 변경으로 독립 검토한 뒤 채택한다. 인계 때문에 무조건 새 코드/새 gate를 만들 필요는 없다.
- task를 `.codaryn/pm-tools/<새ID>.md`에 완성→SHA256→register(정확 worker/pane/WT/report/receipt/subject/선택 checkout)→file-only dispatch→실제 Herdr agent get+visible 확인→작업자에게 task 경로/digest/새ID native prompt를 **한 번만** 보낸다. accepted는 STARTED가 아니다. 작업자는 `started`, 완료 시 report 완성 후 `ready`를 마지막 명령으로 실행하고 STOP한다.
- PM은 poll로 회수→본문 전체/해시/proof/실제 검증/미실행 경계 읽기→명시 `ack --read`. ACK는 보고를 읽었다는 뜻이며 실패 보고의 통과·채택이 아니다. READY만 보고 성공으로 처리하지 않는다. worker가 working/blocked/unknown/quota이면 인수/입력은 보류한다.
- worker script는 반드시 `node D:/project/Codaryn/scripts/pm-session-comms.mjs started|ready --pm D:/project/Codaryn --worktree <배정WT> --id <새ID> --worker <허용이름>`이며 **cwd는 배정WT**. old WT 복사본의 상대 helper는 쓰지 않는다. 기본 ready는 stdin을 기다리지 않는다. `--stdin`을 쓸 때만 pipe+EOF가 필요하다.
- former PM codex-review에게는 현재 helper로 register가 안 된다. 별도 새 ID/task digest/정확 소유 WT·report·receipt·대상 SHA를 파일로 고정하고 STARTED→READY→PM full READ/hash→explicit ACK를 **수동 운영 기록으로 구분**해 남기거나, 검토된 도구 확장 후 배정한다. 기존 helper의 canonical job인 것처럼 receipt를 위조하지 않는다. 현재 배정이 없어 이 문제로 막힌 작업은 없다.
- Herdr 사용 전 설치된 `herdr --skill`, `herdr --help`, `herdr agent`와 `HERDR_ENV=1` 확인. 명시 pane/실제 agent get/visible을 쓴다. **상속 HERDR_PANE_ID가 다른 프로젝트 w5:p1로 남는 backend 이력이 있다.** `--current`/UI focus/상속 pane에 기대지 않는다. 실제 Claude PM은 w3:pG, 작업자 표는 위와 같다. 다른 프로젝트 Recoryn은 건드리지 않는다.
- `herdr agent prompt <실제pane> <text>`는 native arguments 배열로 보내고 shell 문자열 보간을 피한다. 설치된 CLI는 `--timeout`을 `--wait` 없이 주면 입력 전에 exit2다. 필요하면 부모 execFile timeout만 둔다. timeout/UNKNOWN 뒤 무조건 재전송하지 말고 get/read/receipt를 먼저 본다. 세션 사용 한도·크레딧 선택이나 익숙하지 않은 승인 UI에 답하지 않는다. raw keys·설정 변경으로 뚫지 않는다. 승인된 일상 작업 지시 자체를 사용자에게 재확인하지 않는다.
- registry/inbox/ack/events/worker report/receipt는 원본 불변이다. task 수정은 새 ID로 한다. SHA/checkout/identity drift는 거부하고 기존 실패를 보존한다. 이미 ACK한 건은 live HEAD/pane 변화와 별개로 CLOSED를 유지한다. OS 전원 장애까지 보장하는 도구가 아니다.

## Git·검증·승인 업무 전체

- PM 한 명만 main과 통합을 소유한다. 검토 완료 후 PM이 worker commit도 만들며 작업자에게 commit/merge/push를 맡기지 않는다. 합의 없는 amend/rebase/reset/force push/--no-verify/--signoff/--trailer/이력 재작성/브랜치 삭제 금지.
- **작성자와 committer는 `gangdonggil <gangdonggilstudy@gmail.com>`. 모든 Git trailer/자동 귀속 금지. `Co-authored-by`, `Signed-off-by`, `Claude-Session`, `Reviewed-by`와 기타 어떤 trailer도 넣지 않는다.** `.claude/settings.json`은 이미 attribution.commit 빈 문자열/sessionUrl false다. 설정만 믿지 말고 커밋 후 `git show -s --format=fuller <SHA>`로 작성자·committer·제목/본문을 읽고 푸시 전 새 커밋 모두 확인한다.
- 메시지는 보통 한 줄 제목. 오류는 새 수정 커밋으로 고친다. 작성자/trailer 오류가 발견되면 해당 해시를 보고하며 새 커밋으로 옛 metadata가 고쳐졌다고 주장하지 않는다. 사용자 변경·기존 이력은 보존한다.
- 단계: 정확한 diff/소유 범위/사용자 변경 확인→관련 의미 있는 시험·실패 경로→독립 검토→report full READ/hash/ACK→staged scope/`git diff --cached --check`/staged secrets→worker commit→관리 main의 clean·base 확인→literal SHA `merge --no-ff --no-commit`→검토 tree와 `git write-tree` 동일→staged 검사→별도 PM merge commit→author/committer/message 검사→PM push→원격 일치/clean→상태 갱신.
- 실패한 gate를 읽고 해결하기 전에 후속 commit/merge를 같은 연속 명령으로 실행하지 않는다. PowerShell은 `$LASTEXITCODE`를 명시 확인한다. 이미 성공한 같은 입력의 전체 suite를 문서 인계만으로 재실행하지 않는다.
- PM clean child helper `.codaryn/pm-tools/run-clean.mjs <절대cwd> <command> <args...>`는 OS/PATH 최소 env+Git NOSYSTEM/GLOBAL NUL/safe.directory만 전달한다. commit/merge에는 invocation-only `git -c core.autocrlf=true -c user.name=gangdonggil -c user.email=gangdonggilstudy@gmail.com ...`를 사용했다. 정적 env에서 Git system config를 끄면 CRLF 파일이 dirty로 오인될 수 있어 이 옵션을 붙였다. 영구 config/host env를 변경하지 않는다. 민감한 설정/키 파일을 읽지 않는다.
- 실제 API·키 파일/private mapping 조회·실제 모델/외부 시험망은 여전히 제외다. 기존 승인 의존성과 합성 fixture 검증의 범위는 각 task에 구체화한다. 제품은 Git 없는 문서/분석/정리 작업도 수행하는 범용 작업 에이전트이므로 공통 엔진을 Git/코딩 전제로 다시 좁히지 않는다.
- 사용자에게 필요한 질문은 이미 승인한 일상 선택을 반복하지 않는다. 범위 변경·결정적 장애·명시 미승인 실행이 실제로 필요할 때 구체 결과/계획을 먼저 준비해 하나씩 묻는다. PM 위임은 OS/셸/MCP 권한을 넓히지 않는다.

## 바로 이어갈 유한한 행동

1. 이번 운영 인계 full READ/explicit ACK→활성화 알림을 확인한다. main/remote/clean, 모든 job 상태, watcher 종료 증거를 확인하고 작업자들에게 새 PM과 기존 STOP 상태를 알린다.
2. 다음 실제 입력은 Windows 수동 관찰 또는 구체 범위 결정이다. 준비 패킷 `C:/Users/gangd/AppData/Local/Temp/codaryn-manual-cp54-vlZX3f`의 `packet.md`, `launch.mjs`, `packet.json`, `results.tsv`와 `docs/acceptance/windows-keyless-cp54.md`를 인수한다. 12항목 **전부 NOT_RUN**, actual CLI/GUI launch0이다. 원본·개인 설정·개발 소스를 연습 대상으로 쓰지 않는다.
3. 기존 Node26.13.1/Electron45.3.1 설치와 검증 빌드2056개를 pin했다. Electron은 `.worktrees/pm-unit/gui/node_modules/electron/dist/electron.exe`이고 source는 `.worktrees/codex-verify/.codaryn/session-comms/cli-host-parity-probe-01/source`다. 새 다운로드/설치 없다. 실행기는 static child env/private HOME/config/data만 전달하고 매번 hash 확인, 기본 info-only다. 패킷/receipt/seal을 지우지 않는다.
4. 실제 TTY·dialog·IME·낭독기/접근성은 실제 운영자 증거를 받아 PASS/FAIL/NOT_RUN으로 기록한다. 없는 관찰을 모의로 통과시키지 않는다. 실패가 오면 해당 재현과 요구에 한정해 기존 Codex에 배정·독립 검토한다. 근거 없는 추가 코드 단위를 만들지 않는다.

## 로컬 증거를 찾는 방법

- PM registry/inbox/ack/events: main `.codaryn/pm-comms/`. 보고는 각 worker WT `.codaryn/session-comms/<ID>/report.md`, ready.json. PM full-read와 adoption receipts는 `.codaryn/pm-tools/receipts/`다. 실행 가능한 helper를 읽기 증거처럼 재실행하지 않는다. 여러 파일은 wx/create-once다.
- C11 final graph SEC/PROBE 원문은 verify WT의 해당 session-comms job과 `.codaryn/codex-probe-c11-final-review-01`에 있다. frozen v2 도구 `.codaryn/codex-sec-c11-graph-tool-v2`와 옛 seal/input을 그대로 둔다.
- CP53 plan/최초/수정은 LOOP WT의 `cli-host-composition-plan-loop-01`, `cli-host-parity-loop-01`, `cli-host-parity-count-fix-loop-01`; 독립 PROBE는 verify WT의 `cli-host-parity-probe-01`. 각각 report+proof+source/outputs가 있다. 독립 보고 hash `e98883b48df1dcb31e816ed352d2bddb2264d688e481066e6c37eceb4bfbb99d`.
- CP54 원문 report/matrix/proof는 CHECK WT job, prepared packet receipts/seal과 adoption은 main 위 경로다. temp 패킷은 같은 PC의 로컬 산출물이며 Git clone에 포함되지 않는다. temp가 사라지면 기존 proof를 유지한 채 새로 준비해야 한다.

인수 완료 증거와 활성화 이후 정확한 commit/owner는 main control과 최신 PM 체크포인트가 기준이다. 역사 자료와 실제 현재 상태를 섞지 않는다.
