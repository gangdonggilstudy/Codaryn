# 세션 통신 도구 첫 판 독립 검토 — 수정 필요

운영자동화/파일경계·메시지중복 검증자, AUDIT. **신규 H0 / M1 / L1: 근본 원인 2개.** 독립 4개 실패는 M1의 3개 관측과 L1의 1개 관측이다. 수정 후 판은 검토하지 않았다. PM은 아직 채택/live를 수행하지 않았다고 확인했다.

- Exact combined board: `09df017f62da4f45dc131def1114911f1b3f5363`
- Tree: `13e69af6bd0c347958bdf6ea91108e2a4f91d81e`
- Main parent: `7258b45dcb43c3782ab138e84a0f6e4d3dd07feb`; worker: `23a13fff5614eb43976dbdcb5e5eddf257fc74d5`.
- Worktree: `D:/project/Codaryn/.worktrees/codex-verify`; detached HEAD `4cf605a2f8bd4b3089af1052d87f51577272bdf7` 전후 불변, status 변경 출력 없음, branch 비어 있음, toplevel 일치. 전역 Git ignore 접근 경고는 있었다.
- 소유는 이 `.codaryn/session-comms-review/` 하위 archive/검사/증거/보고뿐이다. 지정 신규3파일 +986만 archive했고 Node 내장 모듈 외 추가 원천·설치는 필요하지 않았다. 원래 Git blob과 archive의 LF 역변환 hash를 대조하고 세 파일의 실제 bytes도 매 실행 후 불변 확인했다(`archive-proof.json`). helper SHA256은 `7f387c46388b4de6fe5c35735695791c9366006af269b256ccf1a748e207b421`이다.

## M1 — live worker cwd의 허용 범위와 등록 후 드리프트를 검사하지 않는다

위치: `scripts/pm-session-comms.mjs:170`의 identity(170–179), register(300–309), dispatch(319–326), collect/ACK(249–254, 376–385). identity는 name/pane/Codex/terminal/선택 session은 검사하지만 cwd는 반환만 한다. PM 송신 context의 cwd 검사는 worker에 적용되지 않는다.

실제 재현: 같은 name/pane/terminal/session/status를 유지하고 mock Herdr 응답의 worker cwd만 자기 소유의 별도 프로젝트 디렉터리로 지정했다. (1) 등록부터 잘못된 프로젝트 cwd인데 REGISTERED 성공, (2) 정상 등록 후 다른 프로젝트 cwd로 이동해도 dispatch `delivery=accepted` 및 mock prompt 1회, (3) 정상 READY 뒤 이동해도 poll `identityVerified=true`, `acceptanceReady=true`, 명시 ACK 성공을 관측했다. 파일 동작은 실제 FS이며 외부 Herdr 경계만 모의했다. 원문 `independent.log`의 첫3실패와 `register-cwd-observation.json`, `dispatch-cwd-observation.json`, `ack-cwd-observation.json`을 보존했다.

영향: 잘못된 프로젝트의 live 세션을 올바른 작업자로 취급해 task metadata를 전달하거나 active 결과의 인수 준비 상태를 승인할 수 있다. 같은 사용자/프로세스의 임의 파일 변조를 막는 인증 체계라는 주장은 하지 않는다.

수정 요구(PM의 최신 운영 경계 반영): 등록 시 live agent.cwd를 canonical 관리 main 또는 명시 worker WT로 한정하고 **그때의 실제 cwd를 pin**한다. 이후 active dispatch/수집·알림/ACK에서 그 값의 드리프트를 거부한다. 다른 프로젝트와 다른 worker WT는 허용하지 않는다. TUI cwd가 관리 main인 정상 worker를 허용해야 하므로 `actual agent.cwd == assigned WT`만 강제하지 않는다. 현재 재현의 별도 프로젝트 cwd는 두 허용 경로 모두 밖이므로 발견은 유효하다. 재현 assertion/원문은 수정하지 않았으며, 향후 회귀에서는 main-cwd 정상 허용과 등록된 cwd 유지도 별도로 검증해야 한다. closed ACK의 역사 보존은 active 검증과 분리한다.

## L1 — dispatch가 선택 checkout gate를 건너뛰고 STARTED에서야 거부한다

위치: `scripts/pm-session-comms.mjs:312`의 dispatch(315–326). register·worker·collect는 checkout을 검사하지만 dispatch는 load 뒤 선택 checkout을 다시 검사하지 않는다.

실제 재현: 등록 checkout HEAD `a`×40/branch `ops/fixed`를 고정한 뒤 mock Git HEAD만 `d`×40으로 바꿨다. dispatch는 `delivery=accepted`와 mock prompt 1회였고, 이어 STARTED는 `CHECKOUT_MISMATCH`로 거부됐다. `dispatch-checkout-observation.json`과 `independent.log`의 네 번째 실패를 보존했다.

영향/등급: stale checkout에 불필요한 지시를 전달하고 착수 단계에서 실패한다. STARTED/READY/collect의 후속 gate가 살아 있어 잘못된 checkout 결과가 ACK된 재현은 없으므로 낮음으로 분류한다. 수정 요구: active dispatch에서 assignment/send claim·prompt 전에 명시 checkout의 현재 HEAD/branch를 검증한다. subject SHA를 checkout으로 대신 사용하지 않고 선택 gate 생략 계약도 유지한다.

## 실행 결과와 검증 범위

PM-VALIDATION과 worker report.md/addendum-guide.md/addendum-footer.md를 먼저 전부 읽었다. PM setup/type/build/GUI build·lock0, ops57pass, full unit4316/4305pass/0fail/10skip/1TODO, integration684/682pass/0fail/1skip/1TODO, tracked/staged secrets0는 **READ**이며 여기서 반복하지 않았다. PM도 이 운영 단위에서 full GUI/smoke/CLI95는 재실행하지 않았다고 명시했다. worker의 54→55→57 개발 이력과 footer positive 최초 RED를 성공으로 덮지 않았다.

| 독립 실행 | 실제 결과 | 증거 |
| --- | --- | --- |
| exact archive에서 `node --test scripts/pm-session-comms.test.mjs` | 57pass/0fail/cancel0/skip0/TODO0, exit0 | original.log, original-command.json |
| 별도 independent.test.mjs | 7개 중3pass/4fail/cancel0/skip0/TODO0, exit1 | independent.log, independent-command.json, 관측 JSON4개 |
| 실제 CLI 프로세스 계약 | 1pass/0fail/cancel0/skip0/TODO0, exit0 | cli-process.log, cli-process-command.json, cli-process-observation.json |

성공 수를 합산해 발견을 가리지 않는다. 독립 실패4개는 도구 준비 오류가 아니라 위 두 계약 결함의 재현이다. 자체 준비 실패나 재시험은 없었다. 모든 child 환경은 고정 OS/Node 경로와 자기 TEMP/HOME만 명시했으며 host 환경값·키를 읽어 상속하지 않았다.

코드/guide 전체와 기존57개 실행으로 파일 STARTED/READY/pull/명시 ACK, Herdr 권한 거부 시 파일 회수, unknown claim의 무조건 재송신 방지, 동시 publication/claim, partial JSON/orphan temp, ACK 후 재사용, subject/선택 checkout 구분, stale/hash/schema/path/junction/hard-link, name/pane/session, blocked/unknown 및 plain visible/footer 처리, 고정 PM-pane override를 확인했다. 위 cwd/dispatch checkout 발견은 이 성공 범위의 예외다. 추가 독립 성공3건은 stdin 없는 ready의 실제 보고 파일 읽기, worker 디렉터리 이동·task 제거 후 closed ACK 유지, PM registry의 정적 junction 쓰기 거부다.

실제 별도 Node CLI 프로세스에서는 worker cwd를 유지하고 archive의 canonical 절대 helper로 STARTED/READY가 성공했다. 기본 ready는 stdin을 닫아 둔 상태에서 기존 UTF-8 report bytes로 즉시 완료했다. worker 복사본 실행은 안내대로 WORKTREE_SCOPE/exit1로 거부됐고 이 의도된 negative를 시험 실패로 세지 않았다. 이 과정에 live Herdr get/prompt는 없었다.

재현 원문/도구/관측은 이 폴더에 남겼다. 별도 빈 허용 감사 디렉터리로 source.tar와 run-checks.mjs/independent.test.mjs를 복사·압축 해제한 뒤 `node run-checks.mjs independent`로 같은 경계 입력을 재현할 수 있다. 현재 출력은 add-only이므로 동일 폴더에서 불필요하게 다시 실행하지 않는다.

한계: 실제 Herdr 메시지/live 두 역할 smoke는 PM 소관이며 수행하지 않았다. 독립 재현의 Herdr/Git 응답은 합성이다. 파일/link/realpath 검사와 PID 생존 판정은 OS sandbox·완전한 인증·전원 장애/악의적인 동시 경로 교체 보장이 아니다. footer는 알려진 입력 UI의 보수적 판정이며 모든 미지 UI를 보증하지 않는다. API/키/외부 시험망/서버·권한 설정 변경/승인 응답/new worktree/제품·원본·타WT/main 수정/stage/commit/push 없음. 제품 최종 graph 검증과 별개다.

**PM 반환: 첫 판 H0/M1/L1, 두 수정 요구. 원문·실패 증거 보존. 수정 후 정확판은 별도 재검토하며 현재 추가 실행 없이 정지한다.**
