# DOC-POST-C11-CURRENT — 문서 4파일 제출

codex-check / 문서·데이터 담당, 아키텍처·검증 증거 판단. Worktree `D:/project/Codaryn/.worktrees/claude-store`, branch `docs/post-c11-current-check`, 변경 없는 HEAD/base **b55ef4a32e8fd6c59c2cd0c6a77382c3b712713c**, tree `650455f5cb41171c8d2c7c1534ed27e46d5a560b`. Task digest `353c07606b9a6affffa045d180a5e3c2c047b2d36514f33b64d1008b07ba7a1f`와 registry를 확인하고 STARTED 후 작업했다. 현재 AGENTS/personas/workflow/통신·CP51/architecture overlay/adapter3·7.2와 이전 inventory/coverage/next-unit을 기준으로 D1–D6만 반영했다.

**총 +52/−4=56줄.** 예상90–180보다 작은 현재 상태 보완으로 충분해 역사적 본문을 대량 수정하지 않았다. 새 제품 기능·C12·단계5 전체 완료가 아니다.

| 변경 파일 | +/− | 최종 raw SHA256 |
| --- | ---: | --- |
| docs/roadmap.md | 18/1 | f10210b13f8337e4ff3c652ecb82653df2cc390c568c2e888033aa0382a03e96 |
| docs/progress.md | 14/1 | b63e9b49917f9bcac120efb0b97276064b23a77de39ee1169e7c29358792a1f9 |
| docs/design/implementation-map.md | 19/1 | fa0867371296cdb0323009d0ffb1a458075d0c31b0351f8c4386360e98e0b1f1 |
| docs/decision-register.md | 1/1 | 693701f1a873781995d6ff0881d3e89ae7eb8bff9a8672221be17315d1836cbb |

원래 Git blob/OID/SHA256와 working raw/LF hash는 before/hashes.json 및 verification.json에 있다. 완전한 changes.patch SHA256는 **3f95eac7a9b5fd84e0cb87b92879f3154ae6145abf41dc3c14556a9fdae7570c**다. checkedSHA는 이 base와 working-change hashes의 조합이며 존재하지 않는 후보 commit을 가리키지 않는다.

## 변경과 이력 보존

- Roadmap/progress에 날짜가 있는 CP51 현재 보완을 추가했다. C11 경계 완료, P1 A/B·Markdown·models·권한 질문 구현, 실제 CLI↔인프로세스 앱 계약시험을 구분했다. 실제 별도 host와의 전체 저장물 직접 비교는 PM이 범위를 정할 증거 후보이며, 기존 계약시험 전체가 없다고 하지 않는다.
- 구현 위치표에는 canonical models/공통 core/renderer의 실제 파일·시험 링크만 작게 추가했다. 349726a 표의 models 없음/결정만 및684/343 등은 당시 스냅샷으로 명시하고 원래 행을 유지했다.
- DR65는 사용자 결정문을 그대로 두고 실질 결정 행의 상태 cell만 CP51 현재 판정으로 보완했다. 원래 구현 전/changes뿐 상태도 날짜가 있는 이력으로 cell 안에 보존했다. DR67과 나머지 모든 행·번호·대체 사슬은 동일하다.
- 의도적인 과거 표시 변경은 현재 상태→과거 상태 두 곳, 현재 수치→당시 수치 한 곳이다. 허용된 추가·치환을 역으로 적용하면 네 문서 전체가 원래 working **raw bytes/hash와 완전히 같다**. 원래 표 전체, progress 작업 현황 이후 CP 구간 전체, DR65 사용자 문구 및 다른 결정 행을 별도로 raw 비교했다. LF/CRLF도 유지했다.

## 수행한 검증

assigned cwd에서 `node .codaryn/session-comms/doc-post-c11-current-check-01/run.mjs <phase>`를 실행했다. prepare/edit-v2/verify-v2는 exit0이다. 실제 exe/argv/cwd/exit와 stdout/stderr는 phase별 JSON/log, Git 인자·결과는 prepare-commands.json과 verify-commands-v2.json에 있다. static 자식 환경만 사용했고 Git safe.directory는 이 저장소, core.autocrlf=true는 호출 인자로 한정했다. persistent 설정·권한은 바꾸지 않았다.

| 확인 | 결과 |
| --- | --- |
| 변경 전 | Git4blob＋working4raw/hash/행말 저장, D1–D6 before/after matrix를 변경 전에 저장 |
| 이력·결정 | 네 문서 완전 역변환raw 일치, 원래 표·progress CP·DR65 사용자 문구·그 외 DR67 포함 전 행 일치 |
| 추가/변경 링크·heading | link occurrence30개의 실제 path/base b55 blob, 명시 anchor t17 및 참조 heading4개 확인 |
| 소유·HEAD·index | 지정4docs만 변경, 비소유tracked Git 차이0, branch/HEAD 유지, index empty |
| 공백 | git diff --check exit0 |
| local secret | 추가52행과 변경path만 검사해 finding0. 기존 static RULES7/forbidden-path criteria4를 그대로 사용, literal hash/scope는 secret-scan.json. host secret env값은 읽지 않음 |
| 제품 시험·build·graph·API·UI | 실행0. 문서 보완을 위해 기존 성공 fullsuite 등을 반복하지 않음 |

완전한 diff도 읽고 확인했다. Code/test 링크는 정확한 b55 대상·존재를 확인한 것으로 시험을 새로 실행했다는 뜻이 아니다. CP51의 기존4328unit/684integration/GUI426/smoke227/CLI95와 graph/selftest30/147은 READ 근거만이며 이번 실행의 pass 수가 아니다. PM의 canonical staged secret 검사는 별도 단계다.

## 실패·한계·PM 인계

준비/검증 helper 실패4건은 failure-ledger.json에 분리했다: 초기 inline과 prepare module의 남는 괄호 SyntaxError 각1, DR65 색인 행을 선택한 edit 실패1, 허용된 상태 cell까지 불변으로 비교한 verify 실패1. 첫 두 오류의 원래 command/raw stderr는 session tool output이 권위이며 ledger는 요약이다. 실패 script snapshot과 후자 두 건의 native log/exit/stack을 A에 보존했다. 처음 세 건은 tracked 쓰기 전이고, 검증 오류도 문서를 고치지 않고 helper의 정확한 행/필드 판정만 바로잡았다. 실패·이전 job 자료를 덮어쓰지 않았다. 제품/시험 실패는 아니다.

현재 blocker는 없다. 비소유 파일에 쓰지 않았고 Git 차이와 명시4path만 쓰는 writer로 범위를 확인했다. 모든 secret-like leaf의 raw hash를 새로 읽는 검사는 하지 않았다. 신규 보고/증거는 A에만 있으며 main·타WT·기존 보고·frozen tools/oracle/fixture/기준·제품/기존 시험·package/lock은 무수정이다.

C11은 지정 AST/native resolver 모델의 경계 검증이며 reflection/loader/race/OS 전체 증명이 아니다. U333 u22 원인·U321 부모 교체/최종 검사 뒤 hardlink 경합·historical JSON narrow-pin scope는 남는다. 실제 API/모델 자기 개발/다른OS/실제TTY·OS dialog·IME·접근성/installer·서명·배포는 미검증 또는 별도 범위다. GU9/DR67 미승인 경계도 유지한다.

stage/commit/push/merge/switch/reset/amend/new worktree, Herdr live 발송, Claude/다른 session 위임, 외부망/API/key/host secret·config 읽기, 권한/server/UI/한도 응답은 없다. PM이 exact working diff/hash를 읽고 ACK한 뒤 독립 문서 검토와 staged scope/history/secrets를 확인하고 PM만 commit/통합/push한다. checked.json/proof-hashes.json은 base·working hashes·report SHA를 연결한다. READY는 제출이며 채택이 아니다. 모든 byte 확정 뒤 canonical ready를 마지막 명령으로 실행하고 정지한다.
