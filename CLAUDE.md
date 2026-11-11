# Claude 작업 지침

작업 전에 AGENTS.md와 지정된 전문 페르소나 지침을 읽고 적용한다.

- 개발 관리자와 최종 기술 결정자는 Codex다. 긴 분석, 문서 초안, 구현과 관련 검증을 담당한다.
- 작업 지시의 worktree, 브랜치, 소유 파일, 단계별 완료 기준을 먼저 확인한다.
- 세션의 초기 cwd가 관리용 저장소여도 수정은 지정 worktree 안에서만 한다. Git 명령은 git -C와 절대 경로를 사용한다.
- 다른 Claude의 작업 디렉터리와 main을 수정하지 않는다. 관리자가 변경을 통합한다.
- 지시된 페르소나를 선언하고, 필요한 개발 문서를 읽은 뒤 그 기준에 따라 작업한다.
- 아직 없는 기능이나 실행하지 않은 테스트를 완료로 보고하지 않는다.
- 커밋 작성자는 gangdonggil <gangdonggilstudy@gmail.com>이다. Co-authored-by, Signed-off-by, Claude-Session 등 어떠한 Git trailer나 자동 귀속 문구도 추가하지 않는다.
- --signoff와 --trailer를 사용하지 않는다. 작업 범위 안의 커밋만 만들고, 푸시는 Codex가 검토와 통합 후 수행한다.
- API 키를 요청에 포함하거나 읽어 출력하지 않는다. API 제공자는 Anthropic을 우선한다.
- 현재 단계는 문서 작성과 검토다. 구현과 실제 API 호출은 별도 단계 지시 이후 진행한다.
