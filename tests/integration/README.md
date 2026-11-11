# 단계 1a 프로세스 통합 테스트

담당: 검증 엔지니어(작업 D). 실제 CLI 프로세스, 실제 파일시스템, 실제 자식 프로세스로 수용 기준을 확인한다. 모델은 scripted 대본이고 API 키는 쓰지 않는다. 실제 API 검증(1b)은 여기에 없다.

실행: `npm run test:integration`(빌드 후 `dist/tests/integration/**`). CLI(`dist/src/cli/main.js`)가 없으면 모든 사례가 실패한다. 최종 실행은 G3b 뒤 PM이 지시한다.

## 수용 기준 대응

| 기준 | 파일 | 판정 근거 |
| --- | --- | --- |
| A1 코드 작업 완주 | `a01-code-task` | 종료 코드 0, 파일 바이트, 변경 해시, 명령 검증기 |
| A2 Git 없는 문서 작업 | `a02-document-task` | PATH 없이 실행, `.git` 부재, file_rules |
| A3 충돌 쓰기 거절 | `a03-conflict` | 읽기 후 외부 수정과 오래된 해시 모두 `conflict`, 사용자 바이트 동일 |
| A4 실효 경로 | `a04-path-escape` | `..`, 절대 경로, 정션(못 만들면 건너뜀), 상태 디렉터리 |
| A5 독립 권한 | `a05-permissions` | 명령·인자·cwd 각각 거부, 무버전 덮어쓰기와 삭제 도구 없음, 허용 명령 1회 |
| A6 원위치 보존·새 위치 거절 | `a06-protected-span` | `{{secret_token:1}}` 복제·새 파일·명령 인자·경로 거절 |
| A7 치환 후 기록 | `a07-masking` | 카나리 원문과 변형 0건, 토큰 존재, 자식 환경 필터 |
| A8 한도·취소·자식 정리 | `a08-limits-cancel` | 네 가지 한도, cancel-file, 자식·손자 종료, 잠금 |
| A9 완료 선언만으로 성공 아님 | `a09-a10-status-provider` | `failed`, `needs-input`(no_verifier, inconclusive) |
| A10 실제 호출 경로 거부 | `a09-a10-status-provider` | `provider_not_configured`, 실행 디렉터리 없음 |
| A11 유닛 P0·타입 검사 | (각 모듈 유닛 테스트) | `npm run typecheck`, `npm run test:unit` 결과 |
| A12 보고 구분 | (보고서) | 모든 결과의 `provider`가 `scripted`인지 확인, 1b 미수행 명시 |
| T9 인코딩 | `encoding` | CRLF·BOM·한글 경로 바이트 보존 |

## 교차 검토 회귀 (`r01-privacy-regress`)

2026-11-12 교차 검토(`docs/reviews/2026-11-12-cross-review-*.md`)에서 재현된 결함의 기대 동작이다. 담당 모듈이 고치기 전에는 실패하는 것이 정상이며, 삭제·건너뛰기·약화하지 않는다.

| 사례 | 기대 동작 | 출처 |
| --- | --- | --- |
| R-a | `search_files.text`가 비밀 접두사여도 없는 문자열과 같은 결과 | tools #1 |
| R-b | 검색 줄 1000자, 명령 출력 65,536바이트 경계에서 비밀 4자 조각도 없음 | tools #2, #3 |
| R-c | JSON을 출력하는 명령의 기록에 이스케이프된 비밀 없음(3중 이스케이프와 디코드까지 검사) | tools #4 |
| R-d | 겹치는 두 비밀의 어느 쪽 4자 조각도 없음 | privacy #2 |
| R-e | 토큰 줄의 문맥을 바꾸면 `protected_span_violation`, 파일 바이트 그대로 | privacy #1 |
| R-e2 | 토큰 없는 옆 줄 수정은 허용(과잉 차단 방지) | privacy #1 |
| R-f | `CODARYN_SECRET` 문자열이 든 파일의 다른 줄 수정 허용 | privacy #3 |
| R-g | 패딩 없는 Base64, base64url, 소문자 퍼센트 인코딩도 가림 | privacy #6 |

## 격리

- 사례마다 `<tmp>/codaryn-it-*/`를 만들고 끝나면 지운다. task와 대본은 작업 공간 밖(base)에 둔다.
- CLI 환경은 `CHILD_ENV_ALLOWLIST`만 상속한다. 개발자 환경의 API 키나 모델 설정은 넘어가지 않고, 테스트 코드가 키 변수를 넣으면 예외가 난다.
- 바이트가 중요한 fixture는 실행 중 생성한다. 가짜 비밀은 `tests/fixtures/secrets.ts`에만 있다.

## 입증하지 않는 것

네트워크 차단, OS 격리, 목록 밖 변형이나 최선 노력 탐지의 누락률, 실제 API 동작, 전원 차단 수준의 원자성. 프로세스 정리는 이 테스트가 띄운 손자 프로세스 한 단계까지만 확인한다.
