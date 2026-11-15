# 설정과 실제 모델 연결 준비 작업 지시

사용자가 2026-11-12에 임시 PM(w1:p3)에게 직접 "설정 가능하게 해"라고 지시했다. 1a 완료 보고에서 PM이 "1b를 열려면 모델, 로컬 `ANTHROPIC_API_KEY`와 `CODARYN_MODEL`, 호출·비용 한도가 필요하다"고 적은 데 대한 지시다.

PM의 해석: 모델, 키, 한도를 사용자가 설정으로 정할 수 있게 만들고, 그 설정으로 동작하는 Anthropic 제공자를 구현한다. 이 해석은 PM의 것이며 사용자가 다르게 뜻했다면 바로 조정한다.

## 범위

- 포함: 설정 파일과 환경 변수의 계약, 우선순위, CLI 옵션, Anthropic 제공자 구현, 모의 전송 유닛 테스트(AD-01~06), 로컬 가짜 서버를 쓰는 프로세스 통합 테스트, 사용자가 직접 켜서 돌리는 실제 호출 점검 스크립트.
- 제외: PM과 작업자가 실제 Anthropic API를 호출하는 일, 키 파일을 읽거나 키 값을 출력하는 일, 기본 모델을 코드에 고정하는 일, 재수정 반복(단계 2).
- 위임 문서(`docs/pm-control.json`)의 범위는 PM이 바꾸지 않는다. 이 작업은 사용자의 직접 지시를 근거로 하며, 실제 호출 검증(1b 완료 판단)은 사용자가 키를 설정하고 직접 실행하거나 Codex가 연다.

## 설계 결정 (PM)

| 번호 | 결정 | 근거 |
| --- | --- | --- |
| C-1 | 키는 프로세스 환경 변수 `ANTHROPIC_API_KEY`로만 받는다. task 파일과 설정 파일에 키 필드가 있으면 실행 전에 거부한다 | 키가 커밋되는 파일에 들어가지 않게 한다 |
| C-2 | `--env-file <경로>`를 명시했을 때만 그 파일에서 환경 변수를 읽는다(Node의 `process.loadEnvFile`). 자동으로 `.env`를 찾지 않는다 | 사용 편의와 명시적 동의. `.env`는 Git이 무시한다 |
| C-3 | 설정 파일은 `--config <경로>` 또는 환경 변수 `CODARYN_CONFIG`로 명시한 것만 읽는다. 작업 공간 안에서 자동으로 찾지 않는다 | 프로젝트 문서가 권한이나 전송 목적지를 넓힐 수 없어야 한다 |
| C-4 | 모델 우선순위: task의 `model.model` → 환경 변수 `CODARYN_MODEL` → 설정 파일의 `model`. 어디에도 없으면 전송 없이 거부한다. 코드에 기본 모델을 두지 않는다 | architecture 5절 |
| C-5 | API 주소는 기본 공식 주소다. 바꾸려면 설정 파일의 `apiBaseUrl` 또는 환경 변수 `CODARYN_API_BASE_URL`을 쓴다. task 파일로는 바꿀 수 없다 | 키가 임의 주소로 전송되는 것을 막는다. 가짜 서버 테스트에도 쓴다 |
| C-6 | 한도는 설정 파일의 `limits`가 기본값이고 task의 `limits`가 우선한다. 요청당 출력 토큰 상한(`maxOutputTokens`), 요청 시간 제한, 재시도 횟수도 설정으로 둔다. 한도 없이 실제 호출하지 않는다 | roadmap 단계 3의 "한도 없이 실행하지 않는다"와 같은 원칙 |
| C-7 | 전송은 Node 내장 `fetch`로 Messages API를 호출한다. 새 의존성을 추가하지 않는다. 전송 계층은 주입 가능하게 한다 | 허용 의존성 목록을 넓히지 않고 유닛 테스트에서 전송 경계를 대신할 수 있다. architecture의 "공식 SDK" 선택과 다르므로 decisions.md 갱신 대상이다 |
| C-8 | task 파일 없이 `--workspace <디렉터리> --goal <문장>`으로 실행하는 간편 형식을 추가한다. 정책, 한도, 검증기는 설정 파일의 기본값을 쓴다 | architecture 9절의 "명령 하나" 형식. 빨리 도구로 쓰기 위해서다 |

## 작업

| 작업 | pane | worktree / 브랜치 | 소유 파일 | 선행 |
| --- | --- | --- | --- | --- |
| E1 계약과 설정 | w1:p1 | `claude-design` / `claude/core-engine` | `src/contracts/**`, `docs/cli-contract.md`, `src/cli/**`, `tests/unit/cli/**`, `.env.example` | 없음 |
| E2 Anthropic 제공자 | w1:p8 | `claude-store` / `claude/anthropic-provider` | `src/model/anthropic/**`, `tests/unit/model/anthropic/**` | E1의 계약 커밋 병합 |
| E3 가짜 서버 통합 검증 | w1:p4 | `claude-operations` / `claude/cli-verification` | `tests/integration/**`, `tests/support/**`, `tests/fixtures/**`, `tests/live/**` | E1 계약 병합 후 작성, E2 병합 후 실행 |

- 유닛 P0: AD-01~06을 제공자와 같은 커밋에 넣는다. 설정 우선순위, 키 필드 거부, 모델 미설정 거부를 CLI 유닛으로 고정한다.
- 통합: 로컬 HTTP 서버를 Anthropic 주소로 지정해 실제 CLI 프로세스를 실행한다. 가짜 키가 요청 헤더에만 있고 본문, 실행 기록, stdout에 없는지, 본문에 가짜 비밀 원문이 없는지, 오류와 재시도, 사용량 집계를 확인한다. 이것은 모의 API 검증이며 실제 API 검증이 아니다.
- 실제 호출 점검: `tests/live/**`는 `CODARYN_LIVE=1`과 키, 모델이 환경에 있을 때만 실행되고 기본 실행에서 제외한다. 사용자가 직접 실행한다.
- 커밋 작성자, trailer 금지, 병합 전 검토(`scripts/review-branch.mjs`), 비밀 검사 훅은 1a와 같다.

## 완료 기준

1. 키 없이 타입 검사, 유닛, 통합(가짜 서버 포함)이 모두 통과한다.
2. 키나 모델이 없으면 전송 없이 거부한다. 키 값은 어떤 출력과 기록에도 없다.
3. `docs/cli-contract.md`에 설정 항목, 우선순위, 실행 예시가 있다.
4. 보고서가 "모의 API 검증 통과, 실제 API 미실행"으로 구분해 적는다.
