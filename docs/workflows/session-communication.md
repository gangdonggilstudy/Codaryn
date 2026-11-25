# Codaryn 세션 통신

## 2026-11-15 Claude PM 인계 시 운영

2026-11-15 인계 당시 사용자 지시로 `pm-20261115-claude-01` active 기간의 PM은 Claude w3:pG였고 codex-review w3:p3는 일반 작업자로 전환됐다. 당시 원래 도구의 이름·pane·전송 제한은 변경하지 않았다. 아래 항목은 그 인계 당시의 운영 기록이다.

- 당시 `dispatch --send`, `poll/watch --notify`, `checkPM`은 codex-review/w3:p3/Codex identity에 고정돼 있었다. Claude는 그 이름이나 pane/환경을 위장하지 않고 운영했다. 이전 notifier PID32360은 인계자가 소유 검증 후 종료하고 로그·종료 기록을 보존했으며, 재시작하거나 중복 감시기를 띄우지 않기로 했다.
- 당시 canonical main cwd에서 file-only `register` → `dispatch`(send 없음) → 실제 worker get/visible 확인 후 명시 Herdr native prompt 1회 → worker STARTED/READY → `poll`(notify 없음) → PM 본문 전체/해시/proof 확인 → `ack --read` 방식으로 운영했다. 전송은 새 PM이 직접 담당했고 자동 알림이 없어 필요한 주기로 file-only poll을 회수했다. 전달 accepted는 착수/완료를 뜻하지 않았다.
- 당시 worker 허용 목록은 기존 다섯 Codex 그대로였다. former PM codex-review는 register 허용 worker가 아니어서 검토된 도구 변경 전에는 별도 수동 task/report/receipt/READ/hash/ACK 기록을 구분해 사용하고 기존 canonical receipt를 위조하지 않기로 했다. 인계 당시 former PM의 활성 배정은 없었다.
- 인계 시 기존 등록 보고는 모두 ACK CLOSED였다. 폐기/보존한 `comm-live-loop-01`의 예상 CHECKOUT_MISMATCH만 예외였으며 재전송하지 않기로 했다. task·registry·receipt·실패 증거는 불변으로 보존하고, 실제 API/키 조회/한도·크레딧 선택/승인 UI 응답은 계속 제외한 운영이었다.

## 2026-11-22 작업자 변경

사용자 결정으로 현재 작업자는 codex-worker(`w3:pJ`, Codex)와 claude-worker(`w3:pH`, Claude) 둘이다. codex-review를 포함한 옛 Codex 세션은 지금 없다. 전체 절차와 소유권은 [현재 인계](../operations/pm-handoff-2026-11-15.md)와 main `docs/pm-control.json`을 따른다.

- 새 등록과 작업 재개는 아래 두 worker만 받는다. 옛 이름 codex-check/w3:pD, codex-loop/w3:p8, codex-sec/w3:pC, codex-audit/w3:pE, codex-probe/w3:pF는 닫힌 기록 확인용으로만 보존한다. ACK된 기록은 기존 registry/inbox/ack 검증으로 계속 closed를 반환하고, 폐기된 `comm-live-loop-01`의 checkout 불일치는 계속 `CHECKOUT_MISMATCH`로 표시한다.
- PM 전송 경로의 고정 신원(codex-review/w3:p3)과 Codex 전용 입력 줄 판정은 변경하지 않았다. 현재 Claude PM은 file-only 운영과 별도 명시 native prompt를 사용하며 고정 신원이나 pane/환경을 위장하지 않는다.
- Claude worker에게 `dispatch --send`를 사용하지 않는다. 현재 코드는 어느 경로에서도 Claude worker에게 prompt를 보내지 않는다. Codex 전용 입력 줄 검사까지 도달하면 화면 내용과 관계없이 `VISIBLE_UNCONFIRMED`로 보류하지만, 그 전에 PM 신원 확인에서 실패하거나 작업자 상태에 따라 먼저 보류될 수도 있다. Claude worker의 file-only dispatch와 STARTED/READY는 지원한다.

## 2026-11-25 작업자 추가

사용자 결정으로 Codex 세션 codex-worker-2(`w3:pK`, agent `codex`)를 추가한다. 현재 작업자는 codex-worker(`w3:pJ`)·claude-worker(`w3:pH`)·codex-worker-2(`w3:pK`) 세 명이다. 새 작업자에도 같은 이름·agent 종류·pane·terminal·cwd·session digest 확인 규칙을 적용하며, Codex 입력 줄 판정도 codex-worker와 같다. 옛 이름의 닫힌 기록 검증과 PM 전송 계약은 유지한다.

## 현재 작업자와 원래 Codex PM 전송 계약

현재 w3의 세 worker와 고정된 PM 전송 경로를 위한 운영 도구다. 제품 엔진이나 범용 agent framework가 아니다. PM은 canonical 관리 main cwd에서 `node scripts/pm-session-comms.mjs --help`로 안내를 보고, 시험은 `node --test scripts/pm-session-comms.test.mjs`로 실행한다. worker의 실행 경로는 아래 절대 main 스크립트 계약을 따른다. Node의 표준 모듈만 사용한다.

| 역할 | 허용 이름 | 고정 pane | agent 종류 |
| --- | --- | --- | --- |
| PM 전송 신원(현재 PM은 위 절 참고) | codex-review | w3:p3 | codex |
| worker | codex-worker | w3:pJ | codex |
| worker | claude-worker | w3:pH | claude |
| worker | codex-worker-2 | w3:pK | codex |

이름마다 agent 종류·pane을 확인하고, 제공된 agent_session은 digest로 고정한다.

다른 프로젝트/미등록 pane, 서버 설정, 권한 설정, raw keys, agent start/close, Git 변경, merge/push와 승인 응답 기능은 없다. 실제 메시지 전송은 PM이 인수 후 실행한다. Herdr는 설치된 `--skill`, `agent` 도움말과 실제 `agent get`의 `result.type=agent_info`, `result.agent` 형식을 기준으로 연결했다. 발견에 `agent list`나 UI focus를 사용하지 않는다.

## 파일 계약과 상태

PM 명령의 cwd는 명시한 `--pm`과 같아야 한다. worker 명령의 cwd는 등록한 `--worktree`와 같아야 한다. PM 경로는 이 프로젝트 root 또는 기존 `.worktrees/<이름>`이며 worker도 같은 프로젝트의 명시 경로로 제한한다. 파일 저장은 Herdr 연결과 독립적이다.

| 상태 | 의미 | 저장 주체/위치 |
| --- | --- | --- |
| REGISTERED | 이름/pane/terminal, worktree, task digest, subject, 선택 checkout, report/receipt 경로를 PM이 고정 | PM `.codaryn/pm-comms/registry/<id>.json` |
| ASSIGNED | 지속 assignment가 공개됨 | PM `events/<id>.assignment.json` |
| delivery accepted/unknown | 보조 prompt 전달 접수/불명확함. 실제 착수는 아님 | PM `events/<id>.dispatch.*.json` |
| STARTED | worker가 등록 assignment와 subject를 확인함 | worker `.codaryn/session-comms/<id>/assignment.json`, `started.json` |
| READY | report bytes와 SHA256, exact assignment/subject/identity가 공개됨 | worker 같은 폴더 `report.md`, `ready.json` |
| collected | PM이 파일을 검증해 미인수 결과로 보존함 | PM `inbox/<id>.started.json`, `<id>.<reportSHA>.ready.json` |
| notification accepted/unknown | PM에게 metadata 전달 접수/불명확함. PM이 읽었다는 뜻이 아님 | PM `events/<id>.notify.<reportSHA>.*.json` |
| ACK, closed | PM이 보고를 읽었다고 명시 확인함 | PM `ack/<id>.<reportSHA>.json` |

worker는 자기 `.codaryn/session-comms/<id>`에만 쓴다. PM은 자기 registry/inbox/ack/events에만 쓰며 worker 파일을 삭제/수정하지 않는다. report/receipt는 등록 시 위 두 고정 경로를 모두 명시한다. task는 PM이 명시한 `.codaryn/pm-tools/*.md`만 digest 목적으로 읽는다. 경로 traversal/ADS/device 이름, symlink/junction, 설명되지 않는 hard link, 임의 키 파일 경로를 허용하지 않는다. task 본문·report 본문·prompt 본문·host 환경값은 운영 event/log에 기록하지 않는다. 보고 본문은 worker의 지정 report에만 있다.

`subject: {base, target}`는 검증/구현 대상 SHA다. `checkout: {head, branch}`는 실제 worker checkout gate이며 선택 사항이다. 독립 검증자가 detached checkout에서 다른 target의 archive를 검증할 수 있다. Git 없는 운영 job은 checkout을 생략한다. `--checkout-head`를 주면 `--checkout-branch`도 반드시 주며 detached는 `DETACHED`다. subject를 HEAD로 추정하지 않는다. 객체 순서는 비교에 영향을 주지 않지만 schema의 추가 키는 거부한다.

worker의 Herdr TUI cwd와 실제 tool cwd는 구분한다. 기존 worker는 TUI가 PM main에 있고 tool만 배정 WT에서 실행할 수 있다. 등록 시 실제 TUI cwd는 해당 PM main 또는 그 job의 배정 WT 중 하나여야 하며, 정규화·실경로·link 검증 후 actual cwd를 identity에 pin한다. active dispatch/poll/ACK에서는 동일 pin을 요구한다. 다른 프로젝트/다른 WT/등록 후 cwd 변경/metadata 누락·확인 불가는 거부하며 cwd나 환경을 자동 변경하지 않는다. tool 명령은 계속 배정 WT cwd gate를 따른다. cwd pin이 없는 초기 registry는 active 재사용하지 않고 새 ID로 명시 등록한다. 이미 ACK된 불변 기록은 live cwd/checkout과 독립적으로 유지한다.

Windows에서만 root scope와 `.worktrees` 디렉터리명의 대소문자 차이를 동일 경로로 비교한다. lowercase drive/root 및 `.WORKTREES` alias도 실제 경로·link 검사와 해당 job의 identity pin을 통과해야 한다. POSIX 비교는 계속 case-sensitive이며 다른 프로젝트/다른 WT/링크를 허용하는 변경은 아니다.

명시 checkout gate를 사용할 operator는 등록 전에 workspace의 branch/HEAD를 준비한다. 파일 dispatch 검사점에서 drift하면 assignment를 만들지 않으며, 보조 전송 claim 직전 검사점에서 drift하면 prompt를 보내지 않는다. subject의 검증 target을 checkout HEAD로 대체하지 않는다.

visible 응답이 돌아온 뒤 claim 직전에도 dispatch는 고정 worker identity/CWD를, notify는 고정 PM과 worker identity/CWD를 재확인한다. 이때 관측된 변경은 claim/prompt 전에 거부한다. Herdr 상태 조회와 실제 send를 원자화할 수는 없으므로 최종 확인 이후의 변경 가능성은 잔여 한계다.

## 최소 사용 순서

PM은 canonical 관리 main인 `D:/project/Codaryn` cwd에서 task 파일을 작성하고 SHA256을 확인한 뒤 다음과 같이 상대 스크립트 경로로 등록할 수 있다. SHA는 실제 task bytes의 digest로 바꾼다. Windows PowerShell 줄 연결 대신 한 줄씩 실행하면 된다.

```text
node scripts/pm-session-comms.mjs register --pm D:/project/Codaryn --id ops-example --worker codex-worker --pane w3:pJ --worktree D:/project/Codaryn/.worktrees/claude-adapter --task-file .codaryn/pm-tools/ops-example.md --task-sha <SHA256> --report .codaryn/session-comms/ops-example/report.md --receipt .codaryn/session-comms/ops-example/ready.json
node scripts/pm-session-comms.mjs dispatch --pm D:/project/Codaryn --id ops-example
```

등록은 실제 worker identity 조회가 필요하다. 파일 assignment만으로도 worker가 직접 확인할 수 있다. 기존 입력 경로로 보조 전달할 때만 PM이 dispatch에 `--send`를 명시한다. 전달 접수만 보고 STARTED로 올리지 않는다. transport error/timeout 뒤 같은 ID의 자동 재송신은 없다. 먼저 `poll`로 receipt와 실제 상태를 확인한다. 새 작업/수정은 새 ID로 등록한다.

native prompt는 전달 접수만 요청하며 Herdr `--wait`/`--timeout`을 붙이지 않는다. 설치된 CLI는 `--timeout`을 `--wait` 없이 주면 입력 전에 exit2로 거부한다. 프로세스 실행 자체는 별도로 execFile timeout10000으로 제한한다. 이 부모 프로세스 timeout은 실제 착수/완료 대기가 아니다. PM의 실제 진단에서 잘못된 CLI 인자 거부가 확인되어 정정했으며, 기존 UNKNOWN live job은 보존하고 재전송하지 않는다. 실제 재검증 전송은 PM이 새 job ID로 진행한다.

worker는 **본인의 지정 worktree cwd를 유지하면서 반드시 canonical 관리 main의 절대 스크립트** `D:/project/Codaryn/scripts/pm-session-comms.mjs`를 실행한다. script 위치가 projectRoot를 결정하므로 worker 복사본의 상대 `scripts/...`를 실행하면 파일이 없거나 WORKTREE_SCOPE로 실패할 수 있다. Git root 자동 추정이나 환경변수 변경으로 보완하지 않는다. 관리 main에 채택된 스크립트를 사용한다.

기본 사용은 비대화식이다. 모든 작업/검증을 마친 뒤 등록된 `.codaryn/session-comms/ops-example/report.md`를 worker cwd 안에 완전히 작성하고, `--stdin` 없이 `ready`를 실행한다. 지정 report bytes를 읽어 같은 내용과 receipt를 공개하며 stdin 입력을 기다리지 않는다. READY 후에는 명령을 정지한다.

```text
node D:/project/Codaryn/scripts/pm-session-comms.mjs started --pm D:/project/Codaryn --worktree D:/project/Codaryn/.worktrees/claude-adapter --id ops-example --worker codex-worker
node D:/project/Codaryn/scripts/pm-session-comms.mjs ready --pm D:/project/Codaryn --worktree D:/project/Codaryn/.worktrees/claude-adapter --id ops-example --worker codex-worker
```

선택 기능 `ready --stdin`만 stdin의 UTF-8 보고 bytes를 받아 EOF까지 기다린다. 이를 사용할 때는 보고 bytes를 pipe하고 stdin을 닫거나 명시적으로 EOF를 전달한다. 기본 복사 실행 예제에는 쓰지 않는다. 빈 보고/2MiB 초과는 거부하며 재시도는 같은 bytes만 허용한다. worker에는 직접 Herdr 전송 기능이 없어 PermissionDenied가 파일 완료 계약을 실패시키지 않는다.

PM은 다음과 같이 회수한다. poll 기본 동작에는 메시지 전송이 없다. READY는 ACK까지 재시작 후에도 계속 보인다. `identityVerified=false`면 결과는 수집하지만 아직 인수할 수 없다. `workerStatus`와 `acceptanceReady`를 확인한다. worker가 working/blocked/unknown/quota이면 report는 보존하고 ACK/알림은 보류한다.

```text
node scripts/pm-session-comms.mjs poll --pm D:/project/Codaryn
node scripts/pm-session-comms.mjs watch --pm D:/project/Codaryn --notify --pm-pane w3:p3 --interval-ms 2000
node scripts/pm-session-comms.mjs ack --pm D:/project/Codaryn --id ops-example --sha <REPORT_SHA256> --read
```

watch는 foreground의 PM 권한 문맥에서 실행한다. 제한 실행은 `--iterations N`으로 한다. PM working일 때는 큐를 보존하고, idle/done일 때만 metadata prompt를 보낸다. blocked/unknown/quota UI에는 입력/승인 응답하지 않는다. 메시지 직전에 고정 PM/worker의 현재 metadata를 다시 확인하며 Herdr의 blocked-prompt 거부도 그대로 따른다. dispatch/PM 알림 대상의 visible 화면에 정상 `› Ask Codex` 입력 footer가 있어야 한다. 마지막 footer와 그 뒤 입력 UI 영역만 판정하므로 정상 완료 본문의 승인·한도 설명이나 번호 답변은 입력을 막지 않는다. 인용된 가짜 footer 뒤 실제 선택 메뉴가 있으면 거부한다. 좁은 pane의 줄바꿈은 허용하지만 현재 UI의 알려진 승인/선택/한도 화면, footer 없음, visible 조회 실패는 모두 `VISIBLE_UNCONFIRMED`로 큐에 보존하며 입력하지 않는다. `agent get`은 JSON, `agent read --source visible`은 plain stdout인 계약을 분리했다. 화면 본문은 저장/출력하지 않으며 UI 응답·raw keys fallback은 없다.

`HERDR_ENV=1`은 필수다. backend의 상속 pane이 다른 프로젝트 pane으로 남는 경우 PM이 `--pm-pane w3:p3`를 명시할 수 있다. 이것은 다른 target을 허용하는 옵션이 아니다. 실제 codex-review/w3:p3/Codex identity와 PM process/agent cwd를 검증한 뒤 mismatch/명시 override 여부만 기록하며 환경변수는 바꾸지 않는다. 다른 pane 값과 worker의 override는 거부한다. 권한이 막히면 서버를 재시작하거나 권한을 넓히지 말고 PM 권한 문맥에서 실행한다.

ACK된 job은 PM의 불변 registry/inbox/ack 일치만으로 closed를 반환한다. 이후 PM commit, worker branch/HEAD 이동, 세션 교체, 원본 task/report 정리가 과거 ACK를 REJECTED로 퇴행시키지 않는다. active/new ID의 checkout·subject·identity gate는 그대로다. legacy 보고에는 STARTED를 추정/위조하지 않는다. 이미 시작된 legacy job은 PM이 실제 SHA/상태/보고 digest를 별도 운영 기록에 명시해 수동 인수하며, 이 도구의 미래 job 계약에 자동 편입하지 않는다.

## 동시성·재시작·한계

모든 파일은 고유 temp에 완성/fsync 후 exclusive hard-link로 공개한다. 기존 파일은 덮어쓰지 않는다. 전역 lock이 없어 mkdir와 owner 기록 사이의 종료로 생기는 LOCK_UNKNOWN 영구 대기가 없다. concurrent poll은 같은 불변 inbox에 수렴하며, jobID+reportSHA의 exclusive claim을 얻은 실행 하나만 전송한다. claim 후 종료/timeout은 unknown으로 보존하고 자동 재전송하지 않는다. 이는 모호한 전송에서 중복을 피하는 계약이며 정확히 한 번 전달을 보장한다는 뜻은 아니다. 보고는 미인수 상태로 남아 PM이 읽고 ACK할 수 있다.

공개 전 temp만 남으면 무시한다. 공개 후 temp unlink 전 종료로 link가 남으면 같은 inode의 정확한 temp 이름과 확실히 dead인 PID로 모든 extra link를 설명할 수 있을 때만 완성된 파일로 읽는다. 파일을 삭제하지 않는다. live/PID 재사용/EPERM/불명확 owner는 탈취하지 않고 실패 상태를 유지한다. 프로세스 liveness 확인은 signal 0만 사용하며 프로세스를 종료하지 않는다. 이전 개발판의 ownerless/live lock 폴더도 건드리지 않고 새 claim 흐름으로 회수할 수 있다.

부분 JSON, 불일치 SHA/ID/subject/등록 branch, 알려진 identity 변경은 REJECTED로 보여 준다. 재시작했다고 실패 파일을 성공으로 덮지 않는다. NTFS 등 exclusive hard-link를 지원하는 로컬 파일시스템이 필요하다. OS 전체 전원 장애나 파일시스템 손상까지 보장하지 않는다. 일부 디스크/ACL 오류는 실패 후 원본 보존·운영자 점검이 필요하다.

실제 `agent get`에 agent_session이 없으면 name/pane/기대 agent 종류/terminal까지 고정하며 `sessionBound=false`를 노출한다. 같은 terminal의 새 세션을 그 metadata만으로 항상 구분할 수는 없다. agent_session이 있으면 digest를 고정하고 변경/소실을 거부한다. Herdr idle/done 판정은 report의 READY와 별개이며 알려지지 않은 UI를 완전히 증명하지 않는다. 경로/realpath 검사도 동일 사용자에 의한 악의적인 동시 경로 교체를 막는 OS sandbox는 아니다. 실제 session live 시험과 독립 검토는 PM/AUDIT가 수행한다.
