# 설계 문서 색인

사용성·UX 설계와 단계 4·5(범용 작업, 어댑터, GUI·IDE) 설계 문서를 모은다. 구조와 보안 설계는 상위 문서([architecture.md](../architecture.md), [decisions.md](../decisions.md), [cli-contract.md](../cli-contract.md))가 기준이다. 이 폴더의 문서는 그 결정을 바꾸지 않는다. 바꿔야 하는 것은 각 문서의 "결정 필요" 절에 권고와 함께 적고 PM이 정한다. PM의 결정은 작업 지시서([사용성 개선 지시](../work-orders/phase-4-usability.md), [단계 4·5 설계 지시](../work-orders/phase-4-5-design.md))의 결정 절에 있다.

| 문서 | 내용 | 상태 |
| --- | --- | --- |
| [usability-review.md](usability-review.md) | 현재 CLI를 처음 쓰는 사람의 관점으로 실행해 찾은 문제 16건(R-1~R-16)과 개선안 12건(A1~A12). 기존 보안 결정과의 충돌 검토, 우선순위(P0~P2), 결정 필요 D-1~D-6 | main `349726a` 기준 검토 기록. 결정은 N-1~N-13으로 내려졌다 |
| [ux-design.md](ux-design.md) | CLI·GUI 공통 UX: 대상 사용자와 과업, 정보 구조, 핵심 흐름(계획 확인과 적용 포함), 용어와 문구, 상태 표현, 위험한 동작 확인, 접근성과 언어, GUI 형태, 결정 필요 UX-D1~UX-D7 | UX-D1~UX-D5 결정(N 계열). UX-D6, UX-D7 미정. D3에서 main `7d35d61` 기준으로 맞춤. 대부분 구현 없음 |
| [implementation-map.md](implementation-map.md) | 기능마다 구현 파일, 결정 번호, 유닛·통합 시험을 잇는 표 | main `349726a` 기준. 이후 구현분(`models` 등)과 설계 채택분은 갱신 대기 |
| [adapter-contract.md](adapter-contract.md) | 엔진 쪽 어댑터 계약(P5-A): 앱 계층 `src/app`, 실행 시작·이벤트·취소·결과·보고서·되돌리기·확인 질문·오류 모델, 줄 프로토콜, CLI 이행 계획, 결정 AC-D1~AC-D12 | PM 채택(`3d1eec2`), 모두 권고대로. 코드 없음. 구현 A-1 착수 |
| [vscode-extension.md](vscode-extension.md) | VS Code 확장 설계(P5-A): 실행마다 CLI 자식, 화면과 명령, 확인 질문·취소의 같은 의미, 설정·키 규칙, 패키징, 시험, 결정 VX-D1~VX-D12 | PM 채택(`3d1eec2`). VX-D4(`@types/vscode`)는 사용자 확인 대기(Q-3). 코드 없음 |
| [general-tasks.md](general-tasks.md) | 범용 작업 워크플로 설계(P4-G): 워크플로 정의와 등록, 문서 작성·자료 분석·파일 정리, 실행 사이 계획 확인과 적용, 사람 확인, 엔진 변경 E1~E5, 계약 제안, 결정 GT-D1~GT-D14 | PM 채택(`09bbb2e`). GT-D8은 (b). Q-4~Q-6 사용자 확인 대기. 코드 없음. 구현 G-A 착수 |
| [standalone-gui.md](standalone-gui.md) | 비개발자용 독립 GUI 설계(P5-U): 화면 흐름, 형태 후보와 권고, 엔진 연결, 지원 OS, 접근성, 두 언어, 보안 경계, 결정 GUI-D1~GUI-D13 | 병합(`b246f7c`). 권고는 설계 기준으로만 받았고 채택된 GUI-D는 없다. 형태 확정은 단계 4 뒤, 구현은 Q-7 뒤 |

## 표기 규칙

- 근거: [실행]은 직접 실행한 결과, [코드]는 코드를 읽어 확인한 것, [추정]은 확인하지 않은 것이다.
- 상태: [구현]은 main에 있는 것, [설계]는 결정만 된 것(코드 없음), [제안]은 이 폴더의 안이다. 단계 4·5 설계 문서는 각자 머리에 표기를 정의한다([선택], [권고], [가정] 등).
- 출처: 사용자 확정 요구, PM 설계 선택, 미정을 구분해 적는다.
- 결정 번호는 문서 접두를 붙인다: 사용성 검토 D-n, UX 설계 UX-Dn, 어댑터 계약 AC-Dn, VS Code 확장 VX-Dn, 범용 작업 GT-Dn, 독립 GUI GUI-Dn. 범용 작업의 엔진 변경 E1~E5는 다른 문서에서 GT-E1~GT-E5로 인용한다(decisions.md D-4).
- 출력 예시는 문구 초안이다. 실제 문구는 구현 때 고정 문구 카탈로그로 정한다.

## 문서 사이의 알려진 어긋남

D3 맞춤에서 찾은 것이다. PM이 정할 때까지 각 문서의 원문을 고치지 않는다.

| 번호 | 어긋남 | 기록 위치 |
| --- | --- | --- |
| UX-D7 | 계획 승인: 어댑터 계약 5.7의 `plan` 확인 질문(실행 중)과 범용 작업 GT-D4(실행 사이)가 둘 다 채택됨. VS Code 확장·독립 GUI 설계에 계획·사람 확인 화면이 없거나 5.7을 따른다 | ux-design.md 11절, architecture.md A-7, decisions.md D-5 |
| UX-D6 | 변경 비교: VS Code 확장은 원문 비교(VX-D6), 독립 GUI는 다시 가린 비교(GUI-D6 권고) | ux-design.md 11절 |

## 관련 문서

- [사용 안내](../usage.md): 현재 명령(설치, 키 없는 체험, `models`, `doctor`, `report`, 진행 표시)을 다룬다(N-12, `aa1b59e`). `init`, `runs`, `--profile`, 한 줄 실행, 워크플로와 계획 확인 절은 해당 기능이 병합된 뒤 더한다.
- [자기 개발 절차](../self-development.md): 후보 준비, 무결성 확인, 보고서와 검토 순서.
- [단계 3 작업 지시](../work-orders/phase-3-self-development.md): `models` 명령 결정 Y-1~Y-5 포함.
