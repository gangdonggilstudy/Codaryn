# 단계 4·5 설계 작업 지시

사용자가 2026-11-12에 "개발 목표는 최종 설계까지 다 구현하는 것"이라고 지시했다. 단계 4 범용 작업 확장과 단계 5 GUI·IDE를 설계에서 구현까지 이어 간다. 이 문서는 그 첫 부분인 설계 지시다. 설계 문서의 "결정 필요" 항목은 PM이 정해 이 문서의 결정 절에 남기고, 구현 지시는 설계를 채택한 뒤 이 문서에 추가한다.

- 기준: main `34393bd` 이후의 재개 기록 커밋. 유닛 726건 중 725 통과·1 건너뜀, 통합 343건 통과. 실제 API 미실행.
- 입력 문서: [단계별 계획](../roadmap.md) 단계 4·5, [아키텍처](../architecture.md), [결정 기록](../decisions.md)(M-2 엔진 하나와 어댑터), [사용성 검토](../design/usability-review.md), [UX 설계](../design/ux-design.md)(UX-D1, UX-D2), [사용성 개선 지시](phase-4-usability.md)(N-11, N-13), [구현 지도](../design/implementation-map.md).

## 작업

| 작업 | pane | worktree / 브랜치 | 페르소나 | 소유 파일 |
| --- | --- | --- | --- | --- |
| P4-G 범용 작업 워크플로 설계 | w3:p9 | `claude-general` / `claude/general-tasks` | 수석 아키텍트(주), 문서·데이터 작업 전문가(보조) | `docs/design/general-tasks.md` (신규) |
| P5-A 어댑터 계약과 VS Code 확장 설계 | w3:pA | `claude-adapter` / `claude/adapter-contract` | 수석 아키텍트(주), CLI 개발자(보조) | `docs/design/adapter-contract.md`, `docs/design/vscode-extension.md` (신규) |
| P5-U 독립 GUI 설계 | w3:pB | `claude-gui` / `claude/gui-design` | 수석 아키텍트(UX, 주), 보안·개인정보 검토자(보조) | `docs/design/standalone-gui.md` (신규) |

### P4-G 범용 작업 워크플로

- 문서 작성, 파일 정리, 자료 분석 워크플로 각각의 목표, 도구 묶음, 권한, 검증기를 정한다. 자동 검증이 없는 작업은 "검증 없음" 또는 사람 확인으로 끝난다(roadmap 단계 4).
- 워크플로를 엔진 코드 변경 없이 등록만으로 추가하는 방식을 설계한다. 엔진을 고쳐야 한다면 그 이유를 적는다.
- 실행 전 계획 확인 절차를 설계한다. 파일 정리는 계획 확인 없이 이동·삭제하지 않는다.
- 네트워크·파괴적 동작의 확인과 기록 절차, 그리고 단계 4 이후로 미룬 실행 중 권한 확인(N-11)의 위치를 정한다.
- 필요한 계약 변경은 `src/contracts`를 고치지 않고 제안으로 적는다.
- 유닛 P0와 통합 사례 계획, 소유 파일이 겹치지 않는 구현 분할안을 적는다.

### P5-A 어댑터 계약과 VS Code 확장

- 먼저 `adapter-contract.md`를 쓰고 커밋한다. 다룰 것은 다음과 같다.
  - 엔진 쪽 어댑터 계약: 실행 시작, 진행 이벤트 구독, 취소, 결과, 보고서, 되돌리기, 확인 질문(계획 확인과 권한 확인, P4-G와 맞춘다), 오류 모델.
  - CLI를 이 계약으로 옮기는 이행 계획(N-13, UX-D2). stdout JSON 한 줄 계약과 종료 코드는 그대로 둔다.
  - 단일 프로세스 원칙(architecture 1절)을 지키며 로컬 웹 서버 방식은 쓰지 않는다.
- 이어서 `vscode-extension.md`를 쓴다.
  - 엔진을 부르는 방식의 선택지(확장 호스트에서 엔진 모듈 직접 사용, CLI 자식 프로세스와 JSON 줄 등)와 권고.
  - 화면과 명령, 확인 질문·취소가 CLI와 같은 의미로 동작하는 방법.
  - 설정·키 규칙(C-1~C-8, S-1~S-12)을 지키는 방법, 패키징과 시험 방법.
  - 새 의존성(예: VS Code 시험 도구)은 도입하지 않고 "PM 승인 필요"로 적는다.
  - 구현 분할안.

### P5-U 독립 GUI

- 비개발자용 독립 GUI의 화면 흐름, 형태 후보(데스크톱 셸 종류 등) 비교와 권고, 지원 OS, 접근성, 두 언어(N-4), 보안 경계(로컬 웹 서버 금지, 키 규칙)를 적는다.
- 형태 확정은 단계 4 뒤(N-13)이므로 문서는 권고안까지 쓴다.
- 어댑터 계약은 P5-A의 문서를 따른다. 아직 커밋 전이면 가정으로 표시하고, 커밋되면 `git merge claude/adapter-contract`로 받아 맞춘다.

## 공통 규칙

- 설계 단계에서는 코드, 테스트, `package.json`을 수정하지 않는다. 자기 소유 문서만 쓴다.
- 확정 사실, 설계 선택, 권고, 미정을 구분한다. 문서 끝에 "결정 필요" 표(번호, 선택지, 권고, 근거)를 둔다.
- 다른 설계 문서와 맞춰야 할 점은 "다른 문서와 맞출 점" 절에 적는다. 다른 작업자의 문서는 고치지 않는다.
- 커밋 전에 `git diff --check`, `node scripts/check-secrets.mjs --staged`를 실행한다. 작성자는 `gangdonggil <gangdonggilstudy@gmail.com>`, trailer는 쓰지 않는다. push와 병합은 PM이 한다.
- 실제 API, 외부 네트워크, 키 파일은 쓰지 않는다. 사용자 판단이 필요한 질문은 PM에게 보고하고, 가정을 명시해 계속 진행한다.
- 보고는 [개발 절차](../development-workflow.md) 11절 형식이고 긴 내용은 자기 worktree의 `.codaryn/report-<작업>.md`에 쓴다.

## 이후 순서

1. PM이 세 문서의 결정 필요 항목을 정하고 아래 결정 절에 남긴다.
2. 구현: 어댑터 계약(역할 1, `src/contracts`) → 엔진 쪽 어댑터와 CLI 이행 → 범용 워크플로 → VS Code 확장 → 독립 GUI(형태 확정 뒤).
3. 각 구현은 유닛·통합 시험, 구현자가 아닌 세션의 교차 검토, Codex 검증을 거쳐 병합한다.

## 결정 (PM)

세 설계 문서를 2026-11-12에 main에 병합했다(`3d1eec2`, `09bbb2e`, `b246f7c`). PM이 각 문서의 "결정 필요"를 아래와 같이 정했다. 근거는 각 문서의 표에 있다.

| 계열 | 결정 | 비고 |
| --- | --- | --- |
| AC-D1~D12 ([어댑터 계약](../design/adapter-contract.md) 10절) | 모두 권고대로 채택한다. 앱 계층은 새 모듈 `src/app`, 이벤트는 가림본 `JournalRecord`, 프로세스 밖 어댑터는 실행마다 CLI 자식 하나와 줄 프로토콜(`--events jsonl`, `--confirm stdio`), 취소는 기존 `--cancel-file` | 단일 프로세스 원칙의 조건(듣는 소켓 없음, 상주 없음, 실행 하나에 자식 하나)을 architecture 1절에 적는다(AC-D11) |
| VX-D1~D3, D5~D12 ([VS Code 확장](../design/vscode-extension.md) 11절) | 권고대로 채택한다. 엔진 호출은 B안(실행마다 CLI 자식), 확장 코드는 같은 저장소 `vscode/` | M-1 단일 패키지의 예외로 decisions에 기록한다 |
| VX-D4 (`@types/vscode` 개발 의존성) | 보류. 새 의존성이므로 사용자 확인 대기(Q-3). 그 전에는 VS Code API에 의존하지 않는 확장 코어(줄 해석, 상태 모델)까지만 구현한다 | |
| GT-D1~D7, D9~D14 ([범용 작업](../design/general-tasks.md) 14절) | 권고대로 채택한다. 워크플로 정의와 `workflowRef`, 실행 사이 계획 확인(`plan_pending` → `apply --digest`), 폐기는 보관함 이동, 사람 확인은 `awaiting_review` | GT-D5, GT-D7과 바이너리 이동은 가정으로 진행하고 사용자 확인 대기(Q-5, Q-6) |
| GT-D8 (개인정보가 든 자료 분석) | (b)로 진행한다. 집계 도구(P1) 전에는 개인정보 자료를 다루지 않는다 | 보수적인 쪽이다. 사용자 확인 대기(Q-4) |
| GUI-D ([독립 GUI](../design/standalone-gui.md) 14절) | 형태 확정은 단계 4 뒤(N-13)다. 권고(Electron과 엔진 전용 프로세스)는 설계 기준으로만 받고, 구현은 Q-7의 답과 외부 사실 확인(E-1~E-8) 뒤에 연다 | |

## 구현 배정 (1차)

| 작업 | pane | worktree / 브랜치 | 소유 파일 | 선행 |
| --- | --- | --- | --- | --- |
| G-A 범용 작업 계약(역할 1b) | w3:p9 | `claude-general` / `claude/general-tasks` | `src/contracts/**` 중 general-tasks 9절의 추가분, `tests/unit/contracts/g-*.test.ts`(신규) | 없음. N-A의 계약 커밋 `9735b5f`를 먼저 병합해 그 위에 더한다. `docs/cli-contract.md`는 N-A 소유이므로 추가할 내용을 보고서에 적는다 |
| A-1 앱 계층(신규 모듈) | w3:pA | `claude-adapter` / `claude/adapter-contract` | `src/app/**`, `tests/unit/app/**`(신규) | 없음. 기존 `src/cli/**`, `src/contracts/**`, `src/store/**`를 고쳐야 하는 이행 단계는 고치지 않고 필요한 변경을 보고한다(N-A 병합 뒤 배정) |
| D3 설계 문서 맞춤 | w3:pB | `claude-gui` / `claude/gui-design` | `docs/architecture.md`, `docs/decisions.md`, `docs/README.md`, `docs/design/README.md`, `docs/design/ux-design.md`, `docs/roadmap.md` | 없음. 세 설계 문서의 "다른 문서와 맞출 점"과 위 결정을 반영한다. `cli-contract.md`, `usage.md`, `privacy.md`, `testing.md`는 다른 소유자이므로 고치지 않고 목록으로 보고한다 |
| R-1 설계 교차 검토(읽기 전용) | w3:p7 | `claude-store` | 없음(보고서만) | 없음. 세 설계 문서 사이의 어긋남과 현재 코드와 맞지 않는 서술을 찾는다 |

- G-B~G-H(엔진, 도구·적용기, 검증기, 저장, CLI 연결, 통합, 문서)는 G-A 계약 커밋과 N-A·N-C 병합 뒤 배정한다.
- 계약 소유: N-A(w3:p2)의 사용성 계약은 `9735b5f`로 끝났다. 이후 `src/contracts`의 범용 작업 추가분은 w3:p9가 맡는다. 두 담당이 같은 계약 파일의 다른 부분을 바꿀 수 있으므로 PM이 병합 때 합친 트리로 확인한다.
