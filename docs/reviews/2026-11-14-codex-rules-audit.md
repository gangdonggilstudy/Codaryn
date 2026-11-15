# 운영 규칙 감사 — codex-check

2026-11-14, 개발 절차 감사자. 관측 기준 main `1d4d612a33a50eb4629aefc8cb524756dfa98cc2`. 시작 시 main 작업 트리는 clean이었다. AGENTS.md, pm-control.json, pm-handoff.md, development-workflow.md와 pm-status의 CP-32 및 현재 권한을 설명하는 인접 절을 읽었다. 이 판의 최신 체크포인트는 CP-32다. 최신 사용자 상시 지시는 이번 PM 요청과 기존 인계 지시를 기준으로 대조했다.

**운영 문구 발견: 중간 4 / 낮음 1. 실제 잘못된 위임·병합이 발생했다고 판정한 것은 아니다.** 아래 제안은 이미 받은 사용자 지시를 명확히 표시하는 최소 정정안이며 새 정책 제안이 아니다. 소스·추적 문서·설정은 변경하지 않았고 이 보고서만 작성했다. 시험·API·외부 네트워크·키 파일 조회·Git 변경 명령은 실행하지 않았다.

## 현재 권한과 적용 순서

- 사용자가 방향·범위와 금지사항을 정한다. 현재 PM·통합자는 **codex-review(w3:p3)**다. 근거: `docs/pm-status.md:3`, `docs/pm-handoff.md:99`, 사용자 2026-11-14 인계 지시. 원격 push는 PM 한 세션만 수행한다(`docs/development-workflow.md:131`). 작업자는 배정된 소유 파일과 명시된 Git 범위 안에서만 일한다(`AGENTS.md:31`, `:33`).
- `docs/pm-control.json:4`의 revoked는 종료한 Claude 임시 위임 상태다. owner/pane/session(`:5`~`:7`)은 현 관리자가 아니며 이력이다. `docs/pm-status.md:3`은 active 검사·중단 규칙이 Claude 임시 PM에게만 적용되고 Codex의 원래 관리 권한을 멈추지 않는다고 이미 명시한다. 다시 active로 만들거나 owner를 바꿀 필요가 없다.
- 기존 **Codex 작업자만** 배정하고, 기존 Codex pane 프롬프트 전달은 재확인 없이 한다. 실제 pane와 해당 도구 사용법은 확인한다. 한도·크레딧 선택에는 답하지 않는다. 근거: 최신 사용자 지시, `docs/pm-status.md:47`, `:69`, `:74`.
- 실제 API·키 파일 읽기·외부 시험 네트워크는 금지다. 시험 주소는 127.0.0.1이다(`docs/pm-handoff.md:90`, `docs/development-workflow.md:115`, `:142`, `:225`, `:227`). worktree 분리는 보안 샌드박스가 아니다(`AGENTS.md:60`).
- force push·amend·이력 재작성·no-verify·trailers 금지, 작성자 `gangdonggil <gangdonggilstudy@gmail.com>`, **git worktree add 금지**는 현재 사용자 지시를 적용한다. 문서의 과거 예외로 완화하지 않는다. 근거: `AGENTS.md:48`~`:52`, `docs/pm-handoff.md:91`, `docs/pm-status.md:101`, 최신 사용자 지시.
- 합친 실제 판에서 검사하고 결과를 읽은 뒤 별도 호출로 병합, 최종 트리 동일성·비밀 검사·독립 검토를 확인하는 기존 규칙은 유지된다(`docs/development-workflow.md:96`, `:113`, `:128`, `:131`, `:137`; `docs/pm-handoff.md:83`~`:84`). 전체 통과와 미실행/환경 제한은 구분한다. CP-32의 한정 보안 채택은 잔여 경쟁까지 승인한 것이 아니다(`docs/pm-status.md:45`).

## M1 — 현재형 Claude 배정 규칙이 Codex 전용 배정을 뒤집을 수 있음

근거: `AGENTS.md:8`은 여전히 “코딩, 긴 문서 초안, 대량 분석은 Claude에 배정한다”라고 강제한다. `docs/development-workflow.md:3`도 여러 Claude 세션과의 현재 절차로 소개하고, `:17`은 w1:p3 임시 PM 위임을 현재 운영 규칙처럼 둔다. AGENTS의 위임 예외(`:5`)는 active 조건이 있으므로 현재 자체 활성화되지는 않지만, 별개의 8행 배정 강제에는 종료 조건이 없다.

영향: 새 세션이 AGENTS만 먼저 읽으면 구현을 Claude에게 보내거나, 명시적으로 배정된 Codex 구현을 거부하고 PM/사용자 확인을 반복할 수 있다. 최신 사용자 지시와 CP-32 47행이 우선이므로 지금은 Codex만 배정한다.

최소 PM 명확화: AGENTS 8행과 workflow 17행 가까이에 “2026-11-14 회수 후 현재 PM은 codex-review, 남은 구현·검증은 기존 Codex만 배정; 아래 Claude 위임/배치는 당시 기록”이라는 기존 사실을 표시한다. 종료한 pm-control owner 필드는 수정 대상이 아니다. Codex 프롬프트 전달에 별도 승인 단계를 만들지 않는다.

## M2 — 미보고 자기 커밋 재작성 허용이 현재 amend 금지와 충돌

근거: `docs/development-workflow.md:103`은 보고 전 자기 커밋은 고칠 수 있다고 허용한다. 같은 파일 `:102`는 잘못된 작성자/trailer 수정에 amend/rebase를 금지하고, 최신 `docs/pm-handoff.md:91`과 `docs/pm-status.md:101`은 amend·이력 재작성을 금지한다. 103행의 과거 예외가 현재형 [확정] 규칙으로 남았다.

영향: 작업자가 아직 미보고라는 이유로 amend/rebase해 독립 검증의 기준 해시를 바꾸거나, 잘못된 author/trailer를 자기 판단으로 재작성할 수 있다. 최신 금지는 보고 여부에 따른 예외를 두지 않는다.

최소 PM 명확화: 103행의 “아직 보고하지 않은 자기 커밋은 고칠 수” 부분을 과거 규칙으로 표시하고, 현재는 새 수정 커밋/PM 보고로 처리한다는 기존 지시를 붙인다. author/trailer 오류의 처리 권한을 작업자에게 새로 주지 않는다. 강제 push나 기존 해시 재작성 허용을 추가하지 않는다.

## M3 — 관리자 worktree 생성 허용이 현재 전면 add 금지로 읽히지 않음

근거: `docs/development-workflow.md:166`은 worktree add/remove/prune 등을 관리자만 실행하고 후보를 new-candidate.mjs로 만든다고 한다. `docs/pm-handoff.md:86`도 add는 관리자 몫이라는 예외를 반복한다. 최신 사용자 지시는 **git worktree add를 하지 말라**이며 PM도 예외라고 하지 않았다.

영향: “나는 관리자이므로 가능” 또는 candidate 스크립트를 통한 간접 생성으로 새 board/worktree를 만들 수 있다. 검토자는 archive 사용, 구현자는 기존 배정 worktree 재사용이 현재 운영이다.

최소 PM 명확화: 두 문구에 현재 add 금지가 관리자/스크립트 경유에도 적용된다는 기존 지시를 표시한다. workflow 209행의 후보 생성 기능 설명 자체는 제품 동작 기록이므로 삭제할 필요가 없다. 그 설명을 이번 운영에서 스크립트를 실행해도 된다는 권한으로 쓰지 않도록 구분한다. add 금지를 근거로 remove/prune/gc에 새 정책을 만들지는 않는다.

## M4 — 작업 시작 시 무조건 merge main이 지정 판·소유 범위를 바꿀 수 있음

근거: `docs/development-workflow.md:35`는 모든 작업자가 시작 시 `git merge main`을 하도록 규정한다. 반면 `AGENTS.md:33`과 workflow `:91`은 작업 지시 범위 안의 Git 변경만 허용한다. 현재 독립 검토는 지정 해시 archive, 구현은 PM이 정한 기존 브랜치·기준 판, app.ts는 단일 작성자의 직렬 배정이다(`docs/pm-status.md:46`~`:47`).

영향: 특정 후보 해시 검증을 시작하며 부모를 자동 갱신하거나, 자기 소유가 아닌 파일 변경/미채택 단위를 들여올 수 있다. 그 결과 보고된 판과 실제 시험 트리가 달라져 병합 판단을 흐린다. 읽기 전용 검토자에게는 merge 자체가 배정 위반이다. 이 문제는 main 수용이 필요한 작업까지 금지하자는 주장이 아니다.

최소 PM 명확화: 35행은 “관리자가 해당 작업에 main/기준 병합을 지시한 경우”에만 해당하며, exact board·archive·읽기 전용 배정에는 적용하지 않는다고 명시한다. 이는 새 권한 제한이 아니라 기존 소유/Git 지시 범위의 적용이다. PM이 정한 기준이 이미 명시되면 재확인 질문 없이 그 기준을 따른다.

## L1 — 현재 인계 진입점이 종료한 체크포인트를 가리킴

근거: `docs/pm-handoff.md:60`은 CP-27부터 읽게 하고, `:99`는 회수 후 “현재 배정과 진행은 CP-28”이라고 한다. `docs/development-workflow.md:34`는 세션 표를 현재 배치의 기준으로 지정하지만 pm-status의 Codex 표는 CP-29 아래 `:82` 이후에 있다. 반면 최신 CP-32 `:46`~`:47`에는 U316/report 진행과 뒤의 revert/applyPlan 순서가 있다.

영향: 과거 BASE28 재측정·끝난 C7b·이미 채택한 U321을 다시 배정하거나, 진행 중 app.ts 소유권을 잘못 부여할 수 있다. 다만 CP-27/28/29 제목·해시가 명시된 기록 자체는 거짓이 아니므로 중간 이상으로 세지 않았다.

최소 PM 명확화: handoff 상단 또는 99행의 현재 포인터를 “pm-status 최신 체크포인트(CP-32 이후)와 최신 배정 우선; CP-27/28은 인계 이력”으로 연결한다. 예전 수치와 세션 표를 덮어쓰지 않는다. AGENTS 18~24행의 “현재 단계 1a” 역시 workflow 4행의 이미 완료한 오프라인 단계 설명과 시제가 달라, 현재 포인터 정정 시 함께 당시 단계 설명으로 구분하면 충분하다. 제품 로드맵이나 API 허용 범위를 이번 감사로 재결정하지 않는다.

## 발견으로 세지 않은 이력과 일치 항목

- pm-control의 revoked + Claude owner 조합은 CP-28 94행과 handoff 99행이 이유를 설명한다. 현재 관리자를 오기한 JSON 결함으로 보지 않는다. status를 active로 되돌리는 정정은 오히려 잘못이다.
- handoff 16~29행의 초기 상태는 44행이 2026-11-12 기록이라고 명시한다. 54행 이하 Claude 인계 메모와 103~107행의 멈춘 세션/변이 dist 경고도 당시 사실이다. Claude가 전에 작업했다는 이유만으로 삭제 대상에 넣지 않는다.
- pm-status CP-31 이하의 “U321 미병합”, “C7b 미채택”, CP-12의 “Codex는 검증만”은 해당 체크포인트 이력이다. 최신 CP-32/사용자 지시를 우선하면 현재 배정과 충돌하지 않는다. 과거 사용자 결정 전체를 재심사하지 않았다.
- pane 전달 재확인 금지, quota/credit 무응답은 최신 CP-32 47행에서 이미 명확하다. workflow 194행도 사용·결제 선택을 대신하지 말라고 일치한다. 정책 추가나 더 넓은 승인 예외가 필요하지 않다.
- 작성자/trailer/no-verify/실 API/키 파일/시험 주소 규칙은 위 M2 재작성 예외를 빼면 서로 일치한다. 현재 사용자 금지를 낮추는 해석을 하지 않는다.
- handoff 95행의 새 지침 사용자 확인과 AGENTS 10행의 일상 구현 판단 자율은 다른 범위다. 기존 승인 범위의 구현·pane 전달을 매번 사용자에게 묻는 근거로 해석하지 않는다. 이 감사도 새 정책을 채택하지 않고 문구 명확화만 PM에게 제안한다.
- handoff 82행의 판 만들기 checkout -B 절차는 당시 PM 절차다. 이를 기존 작업/증거 브랜치를 덮어쓸 권한으로 확대하지 않는다. 현재 변경 보존/판 해시/소유권/검증 트리 일치 규칙이 적용된다. 이번 감사에서 실제 덮어쓰기나 잘못된 병합이 있었다는 증거는 조사하지 않았다.

## 수행과 한계

읽기 명령은 `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, `git rev-parse --show-toplevel`, Get-Content와 rg다. main Git 상태/파일을 변경하지 않았다. 전역 git ignore 읽기 경고가 있었으나 권한 요청하지 않았다. 결과는 규칙 문구 감사이며 실제 pane 제어·훅 설치 상태·과거 병합 전부·제품 결정을 재검증한 것이 아니다.

현재 권한은 이미 충분해 정상 배정을 중단할 이유가 없다. PM이 M1~M4의 기존 지시 우선순위와 L1의 진입점만 명확히 표시하면 된다. 추적 문서 변경은 이 작업 소유권 밖이므로 실행하지 않았다.

## PM 반영과 독립 재확인 (2026-11-14)

PM이 AGENTS.md, development-workflow.md, personas.md, pm-handoff.md에 기존 사용자 지시와 최신 체크포인트 우선순위를 명시했다. 이력·revoked owner·기존 API 금지·worktree remove/prune/gc 권한은 그대로 보존했다. codex-check가 해당 diff를 읽고 작성자·trailer 오류를 새 수정 커밋으로 처리하는 것으로 오해할 문구 1건을 지적했다. PM은 새 수정 커밋을 코드·문서 내용 오류에 한정하고, 기존 작성자·trailer 오류는 해시를 보고하며 추가 커밋으로 고쳐졌다고 처리하지 않도록 명확히 했다. codex-check가 최종 AGENTS 56행과 workflow 102~103행을 다시 읽어 남은 지적 없이 검토를 종료했다. 제품 코드 변경이나 새 운영 권한 추가는 없다.
