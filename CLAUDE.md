# Claude 작업 지침

작업 전에 AGENTS.md와 지정된 전문 페르소나 지침(docs/personas.md)을 읽고 적용한다.

- 관리 권한의 기준은 관리용 main의 `docs/pm-control.json`이다. active인 위임의 PM만 작업 배정·통합·커밋·푸시를 하고, 그 범위와 절차는 `docs/pm-handoff.md`와 그 문서가 가리키는 최신 인계 문서를 따른다. 위임이 revoked이거나 위임 ID·담당이 맞지 않으면 새 변경과 지시를 멈추고 보고한다.
- 작업자로 배정되면 작업 지시의 worktree, 브랜치, 소유 파일, 완료 기준을 먼저 확인한다. 수정은 지정 worktree 안에서만 하고 Git 명령은 `git -C <절대 경로>`로 한다. 다른 작업 디렉터리와 관리용 main을 수정하지 않는다.
- 지시된 페르소나를 선언하고 필요한 개발 문서를 읽은 뒤 그 기준에 따라 작업한다.
- 아직 없는 기능이나 실행하지 않은 시험을 완료로 보고하지 않는다.
- 현재 단계와 완료·남은 범위는 `docs/pm-status.md`의 최신 체크포인트를 따른다. 실제 API 호출과 키 파일 조회는 사용자가 승인한 범위가 아니면 하지 않는다. API 키를 요청에 넣거나 읽어 출력하지 않는다. API 제공자는 Anthropic을 우선한다.
- 커밋 작성자와 committer는 gangdonggil <gangdonggilstudy@gmail.com>이다. Co-authored-by, Signed-off-by, Claude-Session, Reviewed-by 등 어떤 Git trailer나 자동 귀속 문구도 넣지 않는다. `--signoff`, `--trailer`, amend, force push, 이력 재작성을 하지 않는다. 커밋은 작업 지시가 허용한 경우에만 만들고, 푸시는 현재 PM만 한다.
