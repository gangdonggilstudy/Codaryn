# Codaryn 개발 문서

Codaryn의 범용 작업 엔진, CLI 우선 설계, 코딩과 자기 개발 루프, 민감정보 처리, 검증과 협업 절차를 관리한다. 사용자가 제품 방향을 정하고 Codex가 최종 기술 판단과 개발 관리를 맡는다(위임 기간에는 임시 PM). 코딩과 토큰 사용이 많은 작업은 전문 페르소나를 지정한 Claude에 배정한다.

현재 상태(2026-11-12, main `1d23dda`):
- 단계 1a·2·3의 오프라인 구현과 `codaryn models`가 main에 있다. 1b는 모의 API 검증까지다.
- **실제 Anthropic API는 한 번도 호출하지 않았다.**
- 사용성 개선(N-1~N-22)을 구현하고 있다. 계약, 문구 카탈로그, 사람용 출력·실행 목록 모듈은 main에 있고 CLI 명령 연결은 아직이다.
- 단계 4·5는 설계를 채택했고 구현에 착수했다.

세부는 [개발 진행 현황](progress.md)과 [임시 PM 상태](pm-status.md), 단계별 완료 기준은 [단계별 계획](roadmap.md)을 따른다.

## 문서 목록

### 기준 문서

| 문서 | 내용 |
| --- | --- |
| [사용 안내](usage.md) | 설치, 키 없는 체험, 설정, 실행, 재수정 반복, 결과, 되돌리기, 비밀, 정책, 점검표, 한계, 문제 해결 |
| [아키텍처](architecture.md) | 요구사항, 모듈 경계, 실행 흐름, Anthropic 연결, 자기 개발 구조. 구현·결정만·설계만을 구분한다 |
| [단계별 계획](roadmap.md) | 단계별 범위와 완료 기준, 현재 상태 |
| [설계 결정](decisions.md) | 확정 사항, 선택 근거, 작업 지시서와 설계 문서 결정의 요약, 미정과 사용자 확인 대기 |
| [CLI·공통 계약](cli-contract.md) | 실행 형식, task와 대본 파일, 도구, 종료 코드, 상태 디렉터리, 설정, `models` |
| [민감정보 처리](privacy.md) | 치환과 복원, 원문 보호, 외부 전송과 실행 경계 |
| [테스트 전략](testing.md) | 자동 테스트, 실제 API 검증, 후보 버전 채택 기준 |
| [유닛 테스트 계획](unit-test-plan.md) | 핵심 계약과 실패 경로, 우선순위, 구현 단계별 테스트 기준 |
| [자기 개발 절차](self-development.md) | 후보 준비, 무결성 확인, 보고서와 검토 순서 |

### 설계 문서 ([색인](design/README.md))

| 문서 | 내용 |
| --- | --- |
| [사용성 검토](design/usability-review.md) | CLI를 처음 쓰는 사람의 관점으로 찾은 문제와 개선안 |
| [UX 설계](design/ux-design.md) | CLI·GUI 공통 UX: 흐름, 문구, 상태 표현, 위험한 동작 확인, 접근성과 언어 |
| [구현 위치표](design/implementation-map.md) | 기능별 구현 파일, 결정 번호, 시험 |
| [어댑터 계약](design/adapter-contract.md) | 어댑터 공통 앱 계층, 이벤트·취소·확인 질문, 줄 프로토콜, CLI 이행 |
| [VS Code 확장](design/vscode-extension.md) | 실행마다 CLI 자식을 부르는 확장의 화면, 명령, 설정, 시험 |
| [범용 작업 워크플로](design/general-tasks.md) | 문서 작성·자료 분석·파일 정리, 계획 확인과 적용, 사람 확인 |
| [독립 GUI](design/standalone-gui.md) | 비개발자용 GUI의 화면 흐름, 형태 후보와 권고, 보안 경계 |
| [두 번째 제공자 사실 확인](design/second-provider-facts.md) | OpenAI(Responses API)에 대해 공식 문서로 확인한 사실과 미확인 항목. 두 번째 제공자 결정(DR-31)의 사실 기준 |

### 협업과 작업 지시

| 문서 | 내용 |
| --- | --- |
| [전문 페르소나](personas.md) | 설계, 구현, 보안, 검증 역할과 제출 기준 |
| [개발 절차](development-workflow.md) | worktree 분리, 작업 배분, 커밋, 검토, 통합과 보고 |
| [작업 인수인계](session-handoff.md) | 완료 상태, 작업 공간, 다음 단계의 확인 사항 |
| [개발 진행 현황](progress.md) | 작업 배분, 검토 단계와 실제 검증 결과 |
| [임시 PM 상태](pm-status.md) | PM 체크포인트, 세션 현황, 사용자 확인 대기, 회수 시 인계 방법 |
| [임시 PM 인수인계](pm-handoff.md), `pm-control.json` | 위임 범위, 작업 상태와 PM 회수 절차 |
| [단계 1a 기능 작업 지시서](work-orders/phase-1a.md) | 단계 1a의 기능 범위와 수용 기준 A1~A12(채택 완료) |
| [단계 1a 작업 배분](work-orders/phase-1a-assignments.md) | 세션별 worktree·브랜치·소유 파일, 통합 순서, PM 결정 P |
| [설정 작업 지시](work-orders/phase-1b-config.md) | 설정과 Anthropic 제공자, 결정 C |
| [단계 2 작업 지시](work-orders/phase-2-repair-loop.md) | 재수정 반복과 교차 검토 수정, 결정 R, S, T |
| [단계 3 작업 지시](work-orders/phase-3-self-development.md) | 자기 개발 준비와 `models`, 결정 U(단계 3), V, W, X, Y |
| [사용성 개선 지시](work-orders/phase-4-usability.md) | 사용성 결정 N-1~N-22와 구현 배정 |
| [단계 4·5 설계 지시](work-orders/phase-4-5-design.md) | 설계 배정, 설계 결정(AC, VX, GT, GUI), 교차 검토 뒤 결정(DR-1~DR-9, 앞의 채택보다 우선)과 1차 구현 배정 |
| `reviews/` | 교차 검토 원문 보관. 단계 4·5 설계 검토는 [R-1 검토 보고](reviews/2026-11-12-r1-review-stage-4-5-designs.md) |

## 문서 적용 원칙

사용자의 최신 지시가 문서에 우선한다. 확정된 요구와 관리자 판단, 아직 결정하지 않은 항목을 구분해 기록한다. 문서가 충돌하면 임의로 구현하지 말고 Codex(위임 기간에는 임시 PM)가 해결한다. 설계 문서 사이의 알려진 어긋남은 [설계 문서 색인](design/README.md)에 모은다.

검증은 층을 나눠 기록한다.
- 설계 문서: 문서 간 충돌과 Git 작업 분리를 확인한다.
- 코드: 유닛, 실제 CLI 프로세스 통합, 가짜 HTTP 서버를 쓴 모의 API로 확인한다.
- 실제 API 검증: 로컬 자격증명과 모델 설정이 준비된 뒤 사용자가 `tests/live`로 한다. 모의 응답 테스트와 구분한다.
