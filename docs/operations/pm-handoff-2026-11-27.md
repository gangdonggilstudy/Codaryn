# 오케스트레이터 임시 이관: Claude w3:pG → Codex w3:pJ (2026-11-27)

사용자가 2026-11-27 직접 지시했다: "codex 중 하나에 오케스트레이터 임시로 이관하고 작업도 codex들만 하도록 이관".

- 새 위임: **pm-20261127-codex-01**, 담당 **codex-worker (w3:pJ)**, 임시다. 사용자가 되돌리라고 하면 이 위임을 `revoked`로 하고 사용자가 정한 PM에게 넘긴다.
- 이전 위임 pm-20261115-claude-01(Claude w3:pG)은 `pm-control.json`의 이력으로 끝났다. Claude w3:pG는 이 문서와 그 커밋을 push한 뒤 새 배정·병합·push를 멈췄다.
- **작업자는 Codex만:** codex-worker-2(w3:pK) 하나다. 새 PM(w3:pJ)도 필요하면 작은 일을 직접 할 수 있다. 그때는 구현과 검토를 같은 세션이 하지 않게 한다.
- claude-worker(w3:pH)에게는 새 일을 주지 않는다. 그 창에는 Claude Code의 피드백 초안 화면(`1 to review · 2 to send · 0 to dismiss`)이 떠 있다. 이 화면에는 답하지 않는다(사용자 몫).
- 권한 기준과 범위는 그대로다: 관리용 main의 `docs/pm-control.json`, 이미 승인된 오프라인 개발·검증·문서·운영. 실제 API 호출, 키 파일 조회, GUI-D9(서명·설치 파일·외부 게시)는 여전히 승인되지 않았다.

## 1. 지금 상태 (이관 시점)

- main = origin/main = 이 문서를 담은 커밋. 그 바로 앞이 `4705b8ba`다.
- 진행 기록: [PM 상태](../pm-status.md)의 CP-72·CP-73.
- 마지막 전체 보드는 `90acd0a2`·`a9a8dd37`이다. unit 4,631건(4,620 통과·10 건너뜀·1 TODO), integration 686건(684·1·1), GUI 780건(778·2), 연기 시험 227/227, 실패 0.

### 진행 중인 단위

| 단위 | 누가 | 작업 공간 / branch | 상태 | 다음 |
| --- | --- | --- | --- | --- |
| `flake-g5g6g9-codex-01` 개선 검토 G의 중간 셋(G5 실제 시간 상한, G6 GUI 호스트 타이머 경주, G9 taskkill 시험 순서), 시험만 | codex-worker(새 PM 자신) | `.worktrees/claude-adapter` / `test/flake-g5g6g9`(기준 `4705b8ba`) | 작업 중 | 끝나면 보고서를 쓰고, **codex-worker-2가 검토**한 뒤 합친다. 자기 작업을 자기가 검토하지 않는다. |
| `fix-latest-window-codex2-02` `latest`가 run 시작 직후 `run_not_found`인 틈의 재작업 | codex-worker-2 | `.worktrees/codex-verify` / `fix/latest-window`(첫 판 `84d0b0b3`, 미커밋 재작업) | 작업 중. "잠금 한 번"의 범위를 묻는 질문 화면이 떠 있다. PM 답은 파일로 남겼다: `.worktrees/codex-verify/.codaryn/session-comms/fix-latest-window-codex2-02/pm-answer.md` | READY가 오면 새 PM이 **정적 검토**한다(재작업자가 아니므로). 보드는 unit·integration으로 보고, 통과하면 합친다. 결정 근거는 그 작업 지시 `.codaryn/pm-tools/fix-latest-window-codex2-02.md`에 있다. |
| `fix-f-low-claude-01` 개선 검토 F의 낮음 셋(F1 HTTP 취소 경계, F2 설정 임시 파일, F4 이동 계획 잠금 수명) | claude-worker(멈춤) | `.worktrees/claude-store` / `fix/f-low`(기준 `66f8d179`), **미커밋 7파일** | 구현·시험은 끝났다(작업자 기록: unit 4,584 통과·실패 0, integration 684·0). 보고서는 없다. 작업자가 금지된 `git add -N`을 실행했다고 스스로 적고 멈췄다. PM이 확인한 결과 인덱스는 깨끗하다(staged·intent-to-add 0). | **Codex가 이어받는다.** 작업 지시 `.codaryn/pm-tools/fix-f-low-claude-01.md`, 남은 기록 `.worktrees/claude-store/.codaryn/session-comms/fix-f-low-claude-01/`. 미커밋 diff를 읽고, 다시 빌드·시험하고, 재현 근거를 확인해 보고서를 쓰게 한다. 그 뒤 독립 검토. 그 작업 공간에는 GUI 의존성이 없다. claude-worker 창은 건드리지 않는다. |

### 남은 후보 (작업 지시가 필요한 것)

- 개선 검토 G의 중간·낮음: G7(o06 포트 반환 뒤 공백), G8(n7 실행 정리 finally), G10~G13(대역 tick, env 가정, 출발 barrier). 근거는 `.worktrees/codex-verify/.codaryn/session-comms/ir-review-g-tests-codex2-01/report.md`. U-213 실제 시간 상한은 기록만 했다.
- 기록만 한 정보 의견:
  - MRR-2~4: 큰 잠금의 재시도 2초, 하드 링크 없는 볼륨의 회수, 성장 시험 자료.
  - SS-1·SS-2: 상태 저장 직렬화 횟수, 불가능한 RangeError.
  - E2에서 남은 낮은 위험 읽기: 현재 파일 해시, Linux `/proc`, revert stream 해시.
  - C1: POSIX FIFO, POSIX 환경에서만 재현할 수 있다.
  - DR-73: 확인과 교체 사이의 경주.
- 사용자를 기다리는 것: 꾸러미 화면 확인(M-3.19), 실제 API 3.1, 키 없는 수동 12항목, GUI-D9(미승인), E-5·E-6 보류.

## 2. 작업 방식 (지금까지 지킨 것)

### 배정과 통신

- 작업 지시는 `.codaryn/pm-tools/<id>.md`(gitignore)에 쓴다. 각 지시에는 PM 결정, 할 일, 위치(작업 공간·branch·HEAD), **소유 파일**, 확인, 경계, 보고 형식을 담는다.
- 통신 도구는 `scripts/pm-session-comms.mjs`다. 순서는 다음과 같다.
  1. `register --task-file --task-sha --report --receipt`
  2. `dispatch`
  3. 창 상태를 확인한 뒤 `herdr agent prompt <pane> "<짧은 알림과 지시 경로·SHA256>"`
  4. 작업자가 `started` → `ready`
  5. PM이 보고서를 끝까지 읽고 `ack --read --sha <보고 SHA256>`
- 창 상태 확인 조건:
  - Codex 창: `idle`/`done`이고, 화면 끝에 `› `가 있고, 다음 글이 없을 것: `enter select|Approaching rate limits|Switch to |Keep current|Yes, proceed|Press enter to confirm|question`.
- `ack`가 `ACK_NOT_READY`로 거절되면 Codex 세션 ID가 바뀐 경우다. `herdr agent rename <pane> <이름>`을 하고, 수동 수신 기록을 `.codaryn/pm-tools/receipts/<id>-manual-ack.json`에 남긴다.
- 대기는 `.codaryn/pm-tools/wait-ready.sh "<이름>=<작업 공간>/.codaryn/session-comms/<id>=<pane>"`로 한다(백그라운드). 종료 코드의 뜻은 이렇다.
  - 3: 창이 막혔거나 선택 화면이다.
  - 5: 준비 파일 없이 쉬고 있다.
  - 창 상태와 무관하게 기다릴 때는 ready.json만 보는 반복을 쓴다.
- **작업자 창의 승인·사용량·크레딧·모델 전환·피드백·질문 화면에는 절대 답하지 않는다.** 질문은 작업 폴더에 파일로 답한다.

### 소유 범위를 줄 때 (멈춤을 줄이는 교훈)

- 바뀌는 형·반환·I/O의 **호출자**를 `git grep`으로 찾아 소유에 넣는다.
- 옛 호출을 대역으로 감싼 기존 시험이 있으면 그것도 넣는다. "대역 부분만, 단언은 그대로"로 허용한다.
- 일부러 동작을 바꾸는 단위라면, 옛 결과를 단언하는 unit·integration 시험을 찾는다. 그리고 "결정대로의 새 동작으로 단언을 바꿔도 된다. 다른 뜻이면 멈춤"을 미리 허용한다.
- 아직 합쳐지지 않은 후보 위에 쌓기 전에, main이 그 소유 파일을 그사이 바꾸지 않았는지 확인한다.
- 새 worktree는 만들지 않는다(`git worktree add`/`remove` 금지). 기존 넷을 다시 쓴다.
  - `claude-adapter`: GUI 의존성 있음, Electron 없음.
  - `codex-verify`: 루트만.
  - `claude-store`: 루트만.
  - `claude-gui`: PM 보드. GUI 의존성과 Electron이 있다.

### 검토와 합치기

- **검토 규칙**
  - 제품 변경은 구현하지 않은 세션이 정적 독립 검토를 한다.
  - 시험·주석·문서만 바꾼 단위는 PM이 검토한다.
  - 결함은 재현을 먼저 한다.
- **작업 branch에 커밋**(PM만 한다)
  1. 소유 파일만 `git -C <wt> add`
  2. `git diff --cached --check`
  3. 작업 공간에서 `node <main>/scripts/check-secrets.mjs --staged`
  4. `git -c user.name=gangdonggil -c user.email=gangdonggilstudy@gmail.com commit`
  5. `git log -1 --format='%(trailers:only)' | wc -c`가 1인지 확인한다.
- **main에 합치기**
  1. `git merge --no-ff --no-commit <branch>`
  2. `git diff --cached --binary HEAD | sha256sum`과 `git diff --binary <기준> <branch> | sha256sum`이 같은지 본다. 같은 파일을 main이 그사이 바꿨으면 파일별로 "바뀐 줄이 같음"을 대조한다.
  3. `--check`
  4. **check-secrets는 따로 실행해 결과를 읽은 뒤에** 커밋한다. 검사와 커밋을 한 명령에 잇지 않는다.
- **보드**(`claude-gui`, detached HEAD)
  - `npm run test:unit`, `npm run test:integration`
  - GUI에 닿으면 루트 `npm run build` → `gui`에서 `npm test`와 `npm run test:smoke`
  - `scripts/review-branch.test.mjs`는 unit glob 밖이라 검사기를 바꾸면 따로 돌린다.
- **push**
  1. 위임 확인
  2. `git merge-base --is-ancestor origin/main <sha>`
  3. `git push -q origin <sha>:refs/heads/main`
  4. `git ls-remote`로 확인한다.
- **커밋 메시지**
  - 어떤 Git trailer도 쓰지 않는다(Co-authored-by·Signed-off-by·Claude-Session·Reviewed-by 등).
  - 마지막 줄이 `키: 값` 모양이면 trailer로 읽히니 문장으로 끝낸다.
  - amend·force push·이력 재작성·`--no-verify`는 금지다.
- **문서를 합칠 때:** 링크 검사 `node .codaryn/pm-tools/check-md-links.mjs`의 깨진 링크 수가 49 그대로여야 한다.

### 알려진 환경 차이 (Codex 작업 공간)

- Codex 샌드박스에서는 `taskkill`이 "액세스가 거부되었습니다"로 실패한다.
  - 제품은 이제 직접 자식을 끝낸다(`eedfa9f4`).
  - 그래도 `windows-cmd-real`의 손자 사례 두 건은 Codex 환경에서 실패한다. 정상 환경에서는 통과한다.
  - 보드를 Codex 환경에서 돌리면 이 둘은 알려진 환경 실패로 구분한다. 정상 환경의 증거는 PM 보드 `eedfa9f4`의 `windows-cmd-real` 10/10이다.
- Git이 사용자의 개인 ignore 파일에 접근하다 권한 거부가 날 수 있다. 내용은 조회하지 않는다.
- 시험을 실행할 때 바깥 LANG을 자식에게 넘기지 않는다. U-285는 이제 격리돼 있다.

## 3. 새 PM의 첫 순서 (권장)

1. 이 문서, [PM 상태](../pm-status.md)의 CP-73·CP-72, [현재 오케스트레이터 인수인계](../pm-handoff.md)의 머리를 읽는다.
2. `docs/pm-control.json`이 `pm-20261127-codex-01`·`active`·`w3:pJ`인지 확인한다. 그 뒤로는 배정·합치기·push 전마다 이 셋을 확인한다.
3. `git -C D:/project/Codaryn status -sb`로 main이 origin과 같고 깨끗한지 본다. 네 작업 공간의 branch와 미커밋 상태가 위 표와 맞는지 본다.
4. 자기 단위 `flake-g5g6g9-codex-01`을 끝내고 READY를 낸다. 검토는 codex-worker-2에게 맡긴다.
5. codex-worker-2의 `latest` 재작업이 READY면 PM으로서 정적 검토 → 보드 → 합치기 순서로 처리한다.
6. `fix/f-low`의 미커밋 F1·F2·F4를 Codex 단위로 이어받게 한다. 보고서 작성 → 독립 검토 → 합치기 순서다.
7. 위 후보 목록에서 다음 단위를 고른다.
8. 끝난 묶음마다 `docs/pm-status.md`에 새 체크포인트를 적는다.
