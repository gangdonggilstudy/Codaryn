# 설계 문서 색인

사용성·UX 설계와 단계 4·5(범용 작업, 어댑터, GUI·IDE) 설계 문서를 모은다. 구조와 보안 설계는 상위 문서([architecture.md](../architecture.md), [decisions.md](../decisions.md), [cli-contract.md](../cli-contract.md))가 기준이다. 이 폴더의 문서는 그 결정을 바꾸지 않는다. 바꿔야 하는 것은 각 문서의 "결정 필요" 절에 권고와 함께 적고 PM이 정한다. PM의 결정은 작업 지시서([사용성 개선 지시](../work-orders/phase-4-usability.md), [단계 4·5 설계 지시](../work-orders/phase-4-5-design.md))의 결정 절에 있다.

상태 칸은 main `207d36e`(범용 작업 묶음 병합 `d7f8381` 뒤)에서 코드와 대조해 적었다. 표기는 **구현됨**, **일부 구현**, **설계만**, **추진하지 않음**, 그리고 문서 자체의 **갱신 대기**다.

| 문서 | 내용 | 상태 |
| --- | --- | --- |
| [usability-review.md](usability-review.md) | 현재 CLI를 처음 쓰는 사람의 관점으로 실행해 찾은 문제 16건(R-1~R-16)과 개선안 12건(A1~A12). 기존 보안 결정과의 충돌 검토, 우선순위(P0~P2), 결정 필요 D-1~D-6 | 검토 기록(main `349726a` 기준). 결정 N-1~N-13 중 N-1~N-10과 N-12는 **구현됨**(사용성 묶음, main `d7f8381`). N-11(실행 중 권한 확인)은 미뤘고 구현 없음(DR-3). N-13은 DR-20으로 바뀌었다 |
| [ux-design.md](ux-design.md) | CLI·GUI 공통 UX: 대상 사용자와 과업, 정보 구조, 핵심 흐름(계획 확인과 적용 포함), 용어와 문구, 상태 표현, 위험한 동작 확인, 접근성과 언어, GUI 형태, 결정 필요 UX-D1~UX-D7 | **일부 구현.** CLI 쪽(두 언어 문구, 사람용 오류와 끝 요약, `runs`·`--run latest`·되돌리기 미리보기, 계획 확인과 적용, 위험한 이동 동의, 사람 확인)은 구현됨(`d7f8381`). 실행 중 권한 확인(N-11, DR-3)은 없다. GUI 화면은 GU-1·GU-2 뼈대만 있다. UX-D6·UX-D7은 DR-7·DR-1로 정해졌다. 문서는 main `1d23dda` 기준으로 맞춘 판이다 |
| [implementation-map.md](implementation-map.md) | 기능마다 구현 파일, 결정 번호, 유닛·통합 시험을 잇는 표 | **갱신 대기.** main `349726a` 기준이다. 그 뒤 구현된 것(`models`, 사용성 묶음, 범용 작업, 앱 계층, GUI 뼈대, `d7f8381`)이 표에 없다 |
| [adapter-contract.md](adapter-contract.md) | 엔진 쪽 어댑터 계약(P5-A): 앱 계층 `src/app`, 실행 시작·이벤트·취소·결과·보고서·되돌리기·확인 질문·오류 모델, 줄 프로토콜, CLI 이행 계획, 결정 AC-D1~AC-D12 | **일부 구현.** 앱 계층 `src/app`(실행 목록, 설정 읽기와 만들기, 모델, 계획 보기·적용·사람 확인·변경 보기, 동의 전달)은 구현됨(`d7f8381`)이고, GUI의 엔진 호스트가 쓴다. 줄 프로토콜(`--events jsonl`, `--confirm stdio`)은 `src/cli/protocol`에 모듈만 있고 CLI에 연결되지 않았다(DR-20, `--events`를 주면 `invalid_arguments`). 실행 중 권한 확인(DR-3)은 없다. DR-1~DR-4·DR-7·DR-8 반영 |
| [vscode-extension.md](vscode-extension.md) | VS Code 확장 설계(P5-A): 실행마다 CLI 자식, 화면과 명령, 확인 질문·취소의 같은 의미, 설정·키 규칙, 패키징, 시험, 결정 VX-D1~VX-D12 | **추진하지 않음(DR-20).** 참고용 기록이다. 편의성 요구는 독립 GUI가 갖는다. `vscode/src/core`(줄 해석과 상태)는 main에 남아 있지만 시험(`tests/unit/vscode`, `tests/unit/cli/protocol`)에서만 쓰인다 |
| [general-tasks.md](general-tasks.md) | 범용 작업 워크플로 설계(P4-G): 워크플로 정의와 등록, 문서 작성·자료 분석·파일 정리, 실행 사이 계획 확인과 적용, 사람 확인, 엔진 변경 E1~E5, 계약 제안, 결정 GT-D1~GT-D14 | **구현됨(P0).** 내장 워크플로 다섯, `workflowRef`, 계획 확인과 적용(`plan`·`apply`), 보관함과 되돌리기, 사람 확인(`review`), `inventory`·`data_checks` 검증기, 위험한 이동 동의(DR-21·DR-25), 계획의 가린 표기(DR-28)가 main에 있다(`d7f8381`). 없는 것: P1의 `query_table`, `plan: "run"`, `analyze-private`, 읽기 제외 경로, 실행 중 권한 확인(DR-3). 문서 머리의 "구현은 아직 없다"는 병합 전 서술이다 |
| [standalone-gui.md](standalone-gui.md) | 비개발자용 독립 GUI 설계(P5-U): 화면 흐름(계획 화면, 사람 확인 포함), 형태 후보와 권고, 엔진 연결, 지원 OS, 접근성, 두 언어, 보안 경계, 결정 GUI-D1~GUI-D13 | **일부 구현.** GU-1(격리된 창, Node 26 엔진 호스트, `doctor` 호출)과 GU-2(창 틀, 두 언어, 작업 공간과 최근 폴더, 읽기 전용 파일 트리)가 `gui/`에 있다(`d7f8381`). 변경 비교 화면, 실행 시작과 진행(GU-3 이후), 패키징(GU-9)은 없다. 형태는 DR-20(Electron 하나)과 DR-26(엔진 호스트)으로 정해졌다 |
| [second-provider-facts.md](second-provider-facts.md) | 두 번째 제공자(OpenAI, DR-22)의 사실 확인: 두 번째 제공자 설계의 확인 필요 C-1~C-15에 대한 답(Responses API, 인증, 키 환경 변수, 주소, 오류와 429 구분 등), 설계의 가정과 다른 점, 출처. 항목마다 [확인]·[미확인] 표기 | PM이 OpenAI 공식 문서로 확인(2026-11-12, `1396caa`). 실제 API는 호출하지 않았다. DR-31의 사실 기준. 짝인 설계 문서는 아직 main에 없다 |

## 표기 규칙

- 근거: [실행]은 직접 실행한 결과, [코드]는 코드를 읽어 확인한 것, [추정]은 확인하지 않은 것이다.
- 상태: [구현]은 main에 있는 것, [설계]는 결정만 된 것(코드 없음), [제안]은 이 폴더의 안이다. 단계 4·5 설계 문서는 각자 머리에 표기를 정의한다([선택], [권고], [가정] 등).
- 출처: 사용자 확정 요구, PM 설계 선택, 미정을 구분해 적는다.
- 결정 번호는 문서 접두를 붙인다: 사용성 검토 D-n, UX 설계 UX-Dn, 어댑터 계약 AC-Dn, VS Code 확장 VX-Dn, 범용 작업 GT-Dn, 독립 GUI GUI-Dn, 교차 검토 뒤 PM 결정 DR-n. 범용 작업의 엔진 변경 E1~E5는 다른 문서에서 GT-E1~GT-E5로 인용한다(decisions.md D-4).
- 출력 예시는 문구 초안이다. 실제 문구는 구현 때 고정 문구 카탈로그로 정한다.

## 문서 사이의 어긋남과 그 결정

- 설계 교차 검토 R-1([검토 보고](../reviews/2026-11-12-r1-review-stage-4-5-designs.md))이 네 설계 문서 사이의 충돌을 찾았다. PM이 DR-1~DR-9로 정했다([단계 4·5 설계 지시](../work-orders/phase-4-5-design.md) "설계 교차 검토 뒤 결정"). DR이 앞의 채택보다 우선한다.
- 요약은 [decisions.md](../decisions.md) 3절의 DR 표에 있다.
- 각 설계 문서의 수정은 그 문서의 담당이 한다. 수정 전에는 문서 원문보다 DR이 기준이다.

| 어긋남 | 결정 | 고칠 문서(상태) |
| --- | --- | --- |
| 계획 승인: 어댑터 계약 5.7의 실행 중 `plan` 질문과 범용 작업 GT-D4의 실행 사이 확인(R-1 H-1, D3 UX-D7) | DR-1 실행 사이 확인 하나 | adapter-contract(반영), standalone-gui(반영), vscode-extension(DR-20으로 추진하지 않음) |
| 변경 비교: VS Code 원문 비교(VX-D6)와 GUI 다시 가린 비교(R-1 M-6, D3 UX-D6) | DR-7 다시 가린 비교만 | adapter-contract(반영), standalone-gui(반영), vscode-extension(DR-20으로 추진하지 않음) |
| 단일 프로세스 조건 문장과 GUI 엔진 전용 프로세스(R-1 M-7) | DR-8 | architecture 1절(반영), standalone-gui(반영, DR-26으로 엔진 호스트 확정) |
| 실행 중 권한 확인의 형태(R-1 M-1) | DR-3 | general-tasks(반영), adapter-contract(반영). 구현은 없다 |
| 워크플로 선택과 적용 통로(R-1 M-2) | DR-1, DR-2 | adapter-contract(반영), vscode-extension(DR-20으로 추진하지 않음) |
| 앱 환경 사본의 동작 차이(R-1 M-3) | DR-4 | adapter-contract(반영) |
| `plan.json`의 정책 사본, `inventory` 상한, 보관함 위치(R-1 M-4, M-5, M-8) | DR-5, DR-6, DR-9 | general-tasks(반영), standalone-gui(DR-9 반영). 구현됨(`d7f8381`) |

## 관련 문서

- [사용 안내](../usage.md): 현재 명령(설치, 키 없는 체험, `init`, `models`, `doctor`, 프로필, 한 줄 실행, `runs`, `report`, `changes`, 되돌리기)과 범용 작업(워크플로, `plan`·`apply`·`review`, 18절)을 다룬다. 알려진 한계는 16절에 모았다. 두 번째 제공자는 구현된 뒤에 더한다.
- [자기 개발 절차](../self-development.md): 후보 준비, 무결성 확인, 보고서와 검토 순서.
- [단계 3 작업 지시](../work-orders/phase-3-self-development.md): `models` 명령 결정 Y-1~Y-5 포함.
