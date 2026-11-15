# 통신 도구 수정판 독립 재검토 — 기존 M1/L1 닫힘, 신규 낮음 1

운영자동화/파일경계·메시지중복 검증자(AUDIT). **기존 첫 판 M1/L1의 재현 4건은 닫힘. 신규 H0/M0/L1(N-L1).** 첫 판 원문·4fail을 성공으로 바꾸지 않았으며 새 정확판만 재검토했다.

- Exact board `bfb5e3ad26b9bf035fd61e706e556845938c2348`, tree `a4ef486abeeaba220fef678ec330caef1cf0f014`.
- Parents: main `7258b45dcb43c3782ab138e84a0f6e4d3dd07feb`, worker fix `498ca307f505efb2de171c8eb1314e16c798a5c4`.
- Worktree `D:/project/Codaryn/.worktrees/codex-verify`, detached HEAD `4cf605a2f8bd4b3089af1052d87f51577272bdf7` 전후 불변. status 변경 출력 없음, branch 비어 있음, toplevel 일치. 전역 Git ignore 읽기 경고는 있었다.
- 새 소유 `.codaryn/session-comms-review-fixed/`만 썼다. actual parent와의 신규3파일 +1110을 archive하고 Git blob/가역 LF 정규화/실제 source bytes를 고정했다(`archive-proof.json`). helper SHA256 `cce8df764993d30efb54b7aa6fa093bf9a67038d1c991445cde0e5ecd1ed202a`.

## N-L1 — 같은 Windows main 경로의 drive-letter 표기 차이를 거부

위치: `scripts/pm-session-comms.mjs:72`의 `absolute === root`, 이를 호출하는 `verifiedAgentCwd`(185–187) 및 register(319–320).

실제 재현: 새 소유의 물리 main 디렉터리를 `D:\...\delta-cases\case-main`으로 만들고, mock live worker cwd에 drive letter만 소문자인 `d:\...\delta-cases\case-main`을 넣었다. **두 경로의 실제 `fs.realpath` 결과가 동일함을 먼저 assertion으로 확인했다.** 그래도 등록이 `AGENT_CWD_UNCONFIRMED`로 거부됐다. `worktree()`의 root 동일성만 대소문자를 구별하고, Windows `path.relative(root, absolute)`는 빈 문자열이어서 `.worktrees/<name>` 조건도 충족하지 못한다. 뒤의 canonical/realpath 비교에 도달하지 못한다.

증거: `delta.test.mjs:141`, `delta-case-main.json`, `delta.log`의 유일한 실패. `run-checks.mjs delta` 실제 exit1. 입력은 자기 폴더와 합성 Herdr metadata만 사용했다. 실제 잘못된 프로젝트 접근/메시지 전송은 없고 prompt0이다.

영향/수정 요구: 같은 허용 main에서 시작한 정상 세션이 cwd 문자열의 drive-letter 표기만으로 등록·활성 identity 확인에 실패할 수 있는 가용성 문제다. 차단을 우회하거나 다른 프로젝트를 허용한 결함은 아니다. Windows root scope 동일성도 기존 canonical 의미에 맞춰 정규화하고, link/realpath·허용 main/해당 WT·등록 pin 검사는 유지한다. 실제 현행 pane에서 소문자 drive 표기를 관측했다는 뜻은 아니며 live 영향은 미확인이다. PM은 수정 또는 명시적 한계 기록 여부를 판단해야 한다.

## 기존 발견 닫힘과 독립 경계 확인

- 원래 AUDIT `independent.test.mjs` 7개는 **바이트 그대로** 새 root에 복사했다. 상대 import가 이미 `./source/...`이므로 경로 adapter도 필요 없고 assertion/기대값/관찰을 변경하지 않았다. SHA256 `9d44ca845b44448df9d5fd803caa50b7ab431f7b3fba6df23f68f81abb1c37c5` 일치(`unchanged-test-proof.json`). 새 실행은7pass/0fail로 원래 등록/dispatch/ACK cwd 허용3건과 stale checkout dispatch1건의 거부를 확인했다. 기존 폴더의12개 원문/실패/관측/소스 지문도 전후 불변이다.
- **M1:** 정상 main TUI cwd를 정규화해 pin하고 worker tool은 별도 WT cwd로 실행하는 positive가 통과했다. 원래69개는 assigned-WT TUI positive도 포함한다. 다른 프로젝트/다른 WT/허용 main→assigned-WT 이동/metadata 누락은 active 검증에서 거부됐다. Herdr 조회 자체가 불가능하면 READY 파일 회수는 유지하되 identityVerified/acceptanceReady=false, ACK 금지다. cwd pin 없는 초기 schema의 active job은 거부하고 초기 코드가 만든 유효 closed ACK는 새 코드에서 Git/live identity 조회 없이 보존했다.
- **L1:** checkout drift는 파일 assignment 전 거부돼 assignment/claim/prompt가 없었다. visible 응답 중 HEAD 변경은 assignment만 남고 claim/prompt는 없었다. checkout 미지정 운영 job은 Git 조회0이며 subject와 HEAD는 별개다.
- post-visible dispatch-worker, notify-worker, notify-PM의 **cwd/session/status 변경9조합**을 별도 확인했다. 알려진 변경은 거부/queued이며 모든 조합에서 send claim 없음·mock prompt0이었다. 정상 main TUI/WT tool 및 명시 fixed PM-pane override는 환경/context 변경 없이 유지됐다.
- delta의 schema는 cwd를 pin한 새 identity와 closed 전용 초기 identity를 구분한다. guide의 canonical 절대 main helper/기본 no-stdin 계약과 파일 원자 publication/claim·unknown/restart/no중복·기존 입력 guard는 관련 변경 외 보존됐다. 원래69개 전체 실행과 별도 실제 Node CLI 실행으로 회귀를 확인했다.

## 실제 명령·결과

모든 명령은 이 폴더의 `node run-checks.mjs <mode>`로 기록했다. child Node의 cwd는 새 archive이고, OS/Node 고정 경로와 자기 TEMP/HOME만 지정했다. 외부 Herdr/Git은 주입된 합성 경계이고 실제 파일 연산은 자기 하위에서 수행했다.

| mode / 실행 대상 | 실제 결과 | 원문 |
| --- | --- | --- |
| original: `node --test scripts/pm-session-comms.test.mjs` | 69pass/0fail, exit0 | original.log, original-command.json |
| old7: 무수정 원본 AUDIT 7개 | 7pass/0fail, exit0 | old7.log, old7-command.json |
| delta: 새 독립20개 | 19pass/**1fail(N-L1)**, exit1 | delta.log, delta-command.json, delta-*.json |
| cli-process: 원래 실제 CLI 감사 시험 무수정 | 1pass/0fail, exit0 | cli-process.log, cli-process-command.json, cli-process-observation.json |

각 실행 cancel/skip/TODO0. 시험 준비 실패나 성공 후 불필요 반복은 없었다. 실제 CLI는 worker cwd에서 새 archive canonical 절대 helper로 STARTED/READY를 실행했고, stdin 없이 기존 UTF-8 report로 완료했다. worker 복사본의 WORKTREE_SCOPE/exit1은 의도된 negative이며 CLI 감사 시험 자체는 통과다. 정상 main TUI metadata positive는 별도 delta에서 모의 검증했으며 live Herdr 확인으로 보고하지 않는다.

PM-VALIDATION과 worker fix-audit1-report.md/fix-audit1-visible-report.md는 전부 READ했다. PM setup/type/build/GUI build·lock0, ops69pass, unit4316/4305pass/0fail/10skip/1TODO, integration684/682pass/0fail/1skip/1TODO, secrets0는 **PM 원문 READ**이고 재실행하지 않았다. full product GUI/smoke/CLI95는 PM도 이번 판 재실행으로 주장하지 않는다. worker의 수정 전4fail·post-visible RED3와 이전66pass를 보존한 이력도 독립 실행 결과와 구분한다.

한계: 최종 identity 조회와 실제 send는 원자 연산이 아니므로 그 이후 변경까지 보증하지 않는다. session metadata 부재, PID 재사용, ACL/디스크/전원 장애, 악의적 동일 사용자 경로 교체와 알려지지 않은 UI를 완전히 보장하지 않는다. 파일/link 검사는 OS sandbox/인증 체계가 아니다. 실제 Herdr 메시지·live 두 역할 smoke는 PM 소관이며 수행하지 않았다. 제품 최종 graph와 별개다.

옛 감사 폴더·제품·Git/기준·타WT·main 수정, 실제 API/키/host 환경값 조회·외부 시험망·서버/권한 변경·승인 응답·새 worktree·commit/push 없음. **첫 M1/L1은 닫힘, 신규 N-L1은 PM 판단 필요. 현재 보고/READY 기록 후 추가 실행 없이 정지한다.**
