# 최종 통신 후보 독립 검토 — READY

운영자동화/파일경계·메시지중복 독립 검증자(AUDIT). **신규 H0/M0/L0. 첫 판 M1/L1 및 이전 수정판 Windows case N-L1은 이 정확판에서 닫힘.** READY는 독립 검토 완료이며 채택·live 성공·push 승인이 아니다.

## 정확판·입력·소유

- Board `0e711809427e806657e8ee81fa18a237bfe11330`; tree `4cd1adc4c9ada706ba887ed6175e485e7e61482b`.
- Parents: actual main `7258b45dcb43c3782ab138e84a0f6e4d3dd07feb`, worker `d1b805415ad42abc655cb4ce184d9f0536b898e7`.
- 지정 worktree `D:/project/Codaryn/.worktrees/codex-verify`, detached HEAD `4cf605a2f8bd4b3089af1052d87f51577272bdf7` 전후 불변. status 변경 출력 없음, branch 비어 있음, toplevel 일치. 전역 Git ignore 접근 경고는 보존했다.
- 새 소유는 `.codaryn/session-comms-review-case/`뿐이다. actual parent 대비 신규3파일 +1145를 exact archive로 고정했다. 이동 중인 worker 제품 파일은 검증 source로 사용하지 않았다.
- 지시서·PM-VALIDATION·worker fix-case-report를 전부 읽고 원문 사본과 SHA256을 `inputs/`, `input-provenance.json`에 남겼다.

| 입력 | SHA256 |
| --- | --- |
| 지정 comms-final-review.md | `eec8201086c69d83e8be06cfab2ed641f088ae2f8c1fc69a4db86717fb1dea52` |
| PM-VALIDATION.md | `e3ad7876b5ed550f3b68ec0a93ba7c71854940bf6d796bf8e3f5bb02c1cfde82` |
| worker fix-case-report.md | `0a6ea23e560c23819e819acb2bb12e25f4375f0543613d23b22dcdfb5ad8dfaf` |
| source.tar | `b0036703a54d56f75b0867eb02afe37097147ccc5ea4d699ee407de36a3fd9f1` |

三 source의 Git blob·archive 실제 bytes 핀은 `archive-proof.json`에 있다. Windows Git archive는 CRLF를 확장했으며 source를 수정하지 않고 LF 역변환 hash로 exact Git blob을 확인했다. 실행한 helper archive SHA256은 `1d0c5e33d9b98be6da6da11d52ba0c983a9588ddb4d235a5cb4914cee2b4cc1b`; 그 LF bytes SHA256은 PM의 `1c103c616539bf01e06f669b1850d43fb64d331717b74b59332d3a024dca90f5`와 같다. 476 CRLF 차이를 `archive-line-endings.json`에 분리 기록했다. 실행 archive bytes와 PM LF 지문을 같은 원시 bytes라고 보고하지 않는다.

## 실제 실행

각 명령은 이 폴더의 `node run-checks.mjs <mode>`로 실행했다. 실제 child exe/args/cwd/exit/signal/기간과 고정 환경은 `<mode>-command.json`, 원문은 `<mode>.log`다. child cwd는 새 source archive이며 OS/Node 경로 및 자기 TEMP/HOME만 지정했다.

| mode / 실제 child 명령 | 결과 |
| --- | --- |
| original / `node --test scripts/pm-session-comms.test.mjs` | **74pass/0fail**, exit0 |
| old7 / `node --test ../independent.test.mjs` | **7pass/0fail**, exit0 |
| delta20 / `node --test ../delta.test.mjs` | **20pass/0fail**, exit0 |
| cli1 / `node --test ../cli-process.test.mjs` | **1pass/0fail**, exit0 |

표의 ../ 표기는 source cwd 기준이며 실제 argv에는 절대 경로를 사용했다. 전 실행 cancel/skip/TODO0. 중첩되는 계약이 있으므로 합계를 고유 사례 수로 주장하지 않는다. 준비를 바로잡은 뒤 각 suite를 한 번만 실행했으며 성공 후 반복하지 않았다.

old7·delta20·CLI1은 원문 bytes 그대로 새 root에 복사했다. 상대 import가 이미 맞아 adapter도 필요 없고 assertion/expected/기준을 수정하지 않았다(`unchanged-tests-proof.json`). 각 SHA256은 다음과 같다.

- old7 `9d44ca845b44448df9d5fd803caa50b7ab431f7b3fba6df23f68f81abb1c37c5`.
- delta20 `188b21167d716aeb349e66ef0cba6bd28db41378ef2c768c87e16d5562e82b6a`.
- CLI1 `09a1897a1e353c00ac9e39b48919cee3ea4dceaee6477308db297594a0395f21`.

첫 판의4fail 및 이전 delta19pass/1fail 원문·관측·보고는 그대로다. 지정 이전22파일 hash와 이번 source3파일 hash가 각 실행 전후 동일했다(`prior-evidence-pins.json`, `*-unchanged.json`). 옛 폴더에는 쓰지 않았다.

## 소스·경계 판정

- **N-L1 닫힘:** prior bfb5 helper에서 root 비교 한 줄을 현재 두 줄로 바꾸면 전체 helper가 가역 CRLF 처리 후 정확히 같다(`source-delta-proof.json`). `scripts/pm-session-comms.mjs:72`의 Windows 전용 상대 scope 소문자 비교와 73의 canonical root 비교 외 helper 변경은 없다. lstat/realpath/link, 해당 job의 identity pin, schema와 전송/파일 계약은 그대로다. 원래 delta20의 same-realpath `D:`→`d:` 입력은 이번에 REGISTERED로 성공했다(`delta-case-main.json`). 원래74의 lowercase drive/root 및 `.WORKTREES` positive는 실제 fs.realpath 일치를 먼저 확인한 뒤 등록→dispatch→STARTED→READY→poll→ACK까지 통과했다. 다른 프로젝트/다른 WT/link negative도 유지됐다.
- **M1 닫힘 유지:** TUI cwd는 관리 main 또는 해당 WT만 등록 허용하고 actual 값을 pin한다. main TUI/WT tool positive와 metadata 누락/확인 불가·다른 프로젝트/다른 WT·등록 후 pin 변경의 거부를 확인했다. Herdr 조회 불가 시 파일 회수와 identityVerified/acceptanceReady=false·ACK 금지를 구분한다. cwd pin 없는 초기 active schema는 거부하며, 원래 first-board helper로 새 소유 하위에 만든 cwd-less closed ACK는 현재 코드에서 live identity/Git 조회 없이 보존됐다.
- **L1 닫힘 유지:** 선택 checkout은 assignment 전과 visible 후에 검사한다. 앞선 drift는 assignment/claim/prompt0이고, visible 후 drift는 assignment만 남고 claim/prompt0이다. checkout 생략 시 Git 조회0이며 subject와 checkout을 혼동하지 않는다.
- **최종 입력 경계:** 기존 delta20의 post-visible dispatch-worker·notify-worker·notify-PM × cwd/session/status 9조합에서 claim 없음·mock prompt0을 확인했다. 정상 main TUI와 worker tool cwd를 분리하고 explicit fixed PM-pane override가 context/환경을 바꾸지 않는 positive도 통과했다.
- **파일·재시작·메시지:** 원자 claim/publication, unknown의 no blind retry, 중복·재시작·closed 역사, partial/orphan temp, schema/hash/path/link, 알려진 입력 UI의 footer 처리와 정상 본문 승인 단어 구분은 helper에서 보존됐고 전체74 및 무수정 재현에서 회귀를 확인했다. 실제 CLI 프로세스는 worker cwd에서 canonical 절대 archive helper로 STARTED/READY를 실행하고 기본 ready는 stdin 없이 기존 UTF-8 report로 완료했다. worker 복사본 WORKTREE_SCOPE/exit1은 의도된 negative이며 CLI 시험 자체는 통과다. guide의 실제 절대 main 호출/no-stdin 안내도 유지한다.
- **POSIX:** canonical은 POSIX에서 대소문자를 낮추지 않고 scopedRelative도 원래 relative를 쓴다. 소스상 case-sensitive 분기 보존만 확인했으며 POSIX에서 실행하지 않았다.

## 실패 보존·READ·한계

자체 준비 실패2회가 있었다. 최초 original과 이어 old7 harness 호출 모두 이전 helper 경로에서 source/를 빠뜨려 ENOENT로 **시험 spawn 전** 종료했다. 당시 제품 시험은 실행되지 않았다. 감사 harness의 경로·provenance 표기만 고치고 두 오류 원문을 `preparation-errors.md`에 남겼다. 이것을 제품/시험 실패나 성공 실행으로 세지 않는다. 이후 위 네 실제 suite는 모두 통과했다.

PM-VALIDATION의 offline ci/typecheck/clean build/GUI build·lock0, ops74pass, unit4316/4305pass/0fail/10skip/1TODO, integration684/682pass/0fail/1skip/1TODO, tracked/staged secrets0는 **READ**다. PM의 node-e quoting 준비 오류도 시험 전 오류로 보존됐다고 확인했다. PM 전체 product 검사, GUI/smoke/CLI95를 여기서 반복하지 않았다. 이 운영 판의 full GUI/smoke/CLI95 실행을 주장하지 않는다.

실제 Herdr get/visible/prompt·live 두 역할 smoke는 수행하지 않았다. 테스트 prompt는 외부 경계 mock이며 실제 메시지 발송0이다. live/채택/ACK/push는 PM 소관이다. 최종 identity 조회와 실제 send 사이의 변경, session metadata 부재, PID 재사용, OS 전원/디스크/ACL 문제, 악의적인 동시 경로 교체, 미지 UI 전부를 보증하지 않는다. 파일 검사는 OS sandbox/완전한 인증 체계가 아니다. 제품 최종 graph 검증과 별개다.

실제 API/키/host secret 환경 조회·외부 시험망·서버/권한 변경·승인/한도 응답·제품/main/타WT 수정·Git 변경/stage/commit/push/new worktree 없음. **최종 평가: 기존 M1/L1/N-L1 닫힘, 신규0/0/0. 보고/READY 기록 후 모든 명령 정지.**
