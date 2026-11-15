# Native transport 정확판 표적 독립 검토 — READY

운영 transport·입력 경계 독립 검증자(AUDIT). **신규 H0/M0/L0.** native argv 수정은 정확 소스와 합성 nativeExec 경계에서 확인했으며, 실제 수정 transport의 live 전달 성공은 아직 검증하지 않았다. READY는 채택·live 성공·push 승인이 아니다.

## 정확판과 고정 입력

- Board `c22fa348fb40c692fe3356acefabb8835e6ae049`; tree `41c33a35e182265e5b60da1aa5b422c0c2dc46b1`.
- Parents: actual main `7258b45dcb43c3782ab138e84a0f6e4d3dd07feb`, worker `18bc21826989c9ecffa93ce28f8f72d3353fdd53`.
- 기존 worktree `D:/project/Codaryn/.worktrees/codex-verify`, detached HEAD `4cf605a2f8bd4b3089af1052d87f51577272bdf7` 전후 불변. status 변경 출력 없음, branch 비어 있음, toplevel 일치. 전역 Git ignore 접근 경고는 있었다.
- 소유는 새 `.codaryn/session-comms-review-transport/`뿐이다. 세 운영 파일을 exact archive로 고정했으며, prior0e711 대비 범위는3파일 +43/-5다. 이동 중인 worker source를 실행하지 않았다.

| 입력 | SHA256 |
| --- | --- |
| comms-transport-review.md | `db2bbdf4a17bc910dea64252239fa80a9ef254e6a60e37d0ad1bee153ee94624` |
| PM-VALIDATION.md | `8363704142023f4019dfe0267347e71168b89b123ce3c3c15393322c73e87c4c` |
| worker fix-transport-report.md | `2ecc7f5a3263bad777a552b4f86698b6f15d616a032dc69edffd8a33fc24287e` |
| PM unchanged-input-proof.json | `edb841ef097898ae13f64c28d5d35006d0c253e0e9cbacbea067805b85b0d569` |
| PM actual native diagnostic01 | `675bca8afc5678959666382937bfabd83947a9e504b3849700759d51a32a06e4` |
| source.tar | `96ae51da9dffa8f860d837c7705e455f23130eb2d4bbf0a6c2549d10da4b8fe0` |

원문 다섯 개를 전부 읽고 bytes 그대로 `inputs/`에 보존했다(`input-provenance.json`). 실행 helper archive SHA256은 `2c8b50e0225bc4f98fa5d18a78198f56e84cd36640a48fca19d508c3713dbf60`, 가역 CRLF→LF bytes SHA256은 PM의 `459893b32daedbae561c9f5eb6be96bba0533b304c68b87e97b9128c68219fc9`와 같다. 세 파일의 archive/LF 지문과 exact Git blob을 `archive-proof.json`에 분리했다. source bytes를 정규화해 덮어쓰지 않았다.

## 실제 실패와 수정의 구분

PM actual diagnostic은 native exit2, stdout 빈 값, stderr `--timeout requires --wait`를 기록했다. PM-VALIDATION상 live01은 UNKNOWN이며 STARTED가 아니고 retired 상태로 보존됐다. **이것은 이전 mock-suite 통과와 별개인 실제 transport 실패**다. 이전 검토 보고/실패·진단을 덮어쓰거나 성공으로 바꾸지 않았다. 이 리뷰에서 old live01을 재송신·수정하지 않았으며 retired 여부는 PM 기록 READ로 구분한다.

현재 helper는 native prompt argv를 `['agent','prompt',name,text]`로 바꿔 CLI `--timeout`을 제거하고 `--wait`도 추가하지 않는다. execFile의 부모 timeout10000/maxBuffer1MiB/windowsHide는 유지한다. 부모 timeout은 접수 실행 한도이지 worker 착수·완료 대기가 아니다. 가이드도 native 옵션 의존성과 부모 timeout, unknown 보존 및 새 ID 사용을 구분한다.

`source-delta-proof.json`은 prior0e711 helper에 네 개의 고유 치환(선택 nativeExec/inHerdr seam, 동일한 기본 context 검사, 동일한 기본 executor의 주입 경계, prompt 인자 제거)만 적용하면 현재 helper 전체와 가역 CRLF 처리 후 동일함을 증명한다. 기본은 원래 promisify(execFile)와 HERDR_ENV 검사다. 다른 schema·cwd pin·checkout·입력 guard·파일/claim/재시작 계약은 변하지 않았다. seam이 실제 환경·서버·권한을 수정하는 기능은 아니다.

## 실제 실행·독립 native 경계

각 suite는 새 root에서 `node run-checks.mjs <mode>`로 한 번씩 실행했다. child의 exe/args/cwd/exit/signal/기간과 고정 환경은 `<mode>-command.json`, 원문은 `<mode>.log`다. 명시한 Windows/Node 경로와 자기 TEMP/HOME만 child에 전달했으며 host secret 환경값은 읽어 상속하지 않았다.

| mode / 실제 child 대상 | 결과 |
| --- | --- |
| original / `node --test scripts/pm-session-comms.test.mjs` | **77pass/0fail**, exit0 |
| old7 / 원래 independent.test.mjs 무수정 | **7pass/0fail**, exit0 |
| delta20 / 원래 delta.test.mjs 무수정 | **20pass/0fail**, exit0 |
| cli1 / 원래 cli-process.test.mjs 무수정 | **1pass/0fail**, exit0 |
| native / 새 native-boundary.test.mjs | **7pass/0fail**, exit0 |

전 실행 cancel/skip/TODO0. 이번 감사 준비 오류/시험 실패/성공 후 반복 없음. 서로 중첩되는 계약을 합산해 고유 사례 수로 주장하지 않는다.

old7/delta20/CLI1은 원문 bytes 그대로 새 root에 복사했고 상대 import가 맞아 adapter도 없다. assertion·기대값은 변경하지 않았다(`unchanged-tests-proof.json`). 지문은 old7 `9d44ca845b44448df9d5fd803caa50b7ab431f7b3fba6df23f68f81abb1c37c5`, delta20 `188b21167d716aeb349e66ef0cba6bd28db41378ef2c768c87e16d5562e82b6a`, CLI1 `09a1897a1e353c00ac9e39b48919cee3ea4dceaee6477308db297594a0395f21`이다. 이전30파일·이번 source3파일·읽은 입력5파일을 각 실행 전후 hash 대조해 불변 확인했다. 첫 판4fail·Windows case1fail·각 보고 및 prior0e711 보고도 보존했다.

기존 새3시험 외에 다음을 별도 독립7개로 확인했다.

- 기본 inHerdr 경계는 HERDR_ENV가 없는 명시 child 환경에서 get/visible/prompt 모두 NOT_IN_HERDR로 **nativeExec 호출 전에 거부**, 실행0.
- 정확한 admission argv, no --wait/no CLI --timeout, shell 옵션 없음, 부모 timeout10000/maxBuffer/windowsHide를 확인했다. 따옴표·줄바꿈·flag 모양의 metadata도 하나의 text 인자로 유지했다. get은 JSON, visible은 ANSI/줄바꿈 포함 plain stdout 그대로이며 child context를 바꾸지 않았다.
- malformed JSON은 한 번의 TRANSPORT_UNKNOWN만 반환하고 raw body/stdout/stderr를 오류에 붙이지 않는다.
- ETIMEDOUT·EACCES × dispatch·notify 네 경로에서 실제 파일 계약과 synthetic nativeExec를 연결했다. 첫 결과 unknown, 새 controller 재시도도 unknown, **native prompt 시도는 각1회**, claim 보존·중복 없음. raw visible/error body의 합성 marker는 event에 없고 짧은 error code만 기록됐다. notify의 READY report/inbox와 dispatch의 ASSIGNED 상태도 유지됐다.

이 추가7개는 주입된 nativeExec boundary 시험이며 설치 Herdr binary의 실제 메시지 전송·실제 10초 timeout 실험이라고 보고하지 않는다. 원래 CLI1의 실제 Node 프로세스는 worker cwd에서 canonical 절대 archive helper로 STARTED/READY를 실행하고 기본 ready는 stdin 없이 완료했다. 이것도 Herdr native prompt 성공 시험은 아니다.

기존 M1/L1/Windows case는 무수정7/20 및 현재77에서 닫힘을 유지했다. main TUI/WT tool 분리, metadata·cwd drift, assignment 전/visible 후 checkout 및 post-visible worker/PM identity, closed ACK 역사, unknown/no blind retry, 정상 본문·입력 footer 구분도 보호됐다.

## PM READ·남은 범위

PM exact ops77pass와 tracked/staged secrets0 및 native read-only emptywatch1은 **READ**이며 이 리뷰의 native live 결과가 아니다. PM raw blob proof의 다른1369파일 동일을 READ했다. prior0e711의 전체 product 결과는 변경 없는 입력에 대한 기존 증거이고 이 판에서 새 실행했다고 쓰지 않는다. full product build/unit/integration/GUI/smoke/CLI95를 재실행하지 않았다. worker의 RED1fail/2pass는 합성 native validator이며 actual diagnostic과 별도로 보존됐다고 확인했다.

수정 native의 실제 새 live02 두 역할 flow는 여전히 PM 소관으로 남는다. reviewer의 실제 Herdr get/visible/prompt는0이고 메시지 발송0이다. 새 live02 등록·전송·채택·교육·ACK·push를 대신하지 않았다. 현재 결과로 이전 actual failure가 실제 환경에서 해소됐다고 단정하지 않는다.

최종 metadata 조회와 send의 비원자성, 세션 metadata 부재, PID/디스크/ACL/악의적 경로 교체, 미지 UI와 POSIX runtime 미실행 한계는 유지한다. 파일/JS 검사는 OS sandbox나 완전한 인증 보증이 아니다. 제품 최종 graph와 별개다. API/키/외부망/권한·서버 변경/승인·한도 응답/제품·main·타WT·Git 변경/stage/commit/push/new worktree 없음.

**정확판 표적 평가 H0/M0/L0. native argv 수정의 소스·합성 경계 확인, 실제 수정 transport 전달은 PM live02 대기. 보고/READY 기록 후 모든 명령 정지.**
