# 실제 API 점검 (tests/live)

이 폴더는 **실제 Anthropic API**를 호출하는 점검이다. 모의 API 검증(`tests/integration/m0*`)과 다르다. 기본 npm 명령(`test`, `test:unit`, `test:integration`)에는 들어가지 않는다. 파일 이름이 `.test.ts`로 끝나지 않으므로 `dist/tests/**/*.test.js`에 걸리지 않는다.

PM과 작업자는 실행하지 않는다. 사용자가 키를 설정한 뒤 직접 실행한다.

## 실행

PowerShell:

```powershell
npm run build
$env:CODARYN_LIVE = "1"
$env:CODARYN_MODEL = "<모델 id>"
# ANTHROPIC_API_KEY는 미리 사용자 환경에 설정해 둔다. 값을 명령줄이나 파일에 적지 않는다.
node --test dist/tests/live/anthropic-live.js
```

세 변수(`CODARYN_LIVE=1`, `ANTHROPIC_API_KEY`, `CODARYN_MODEL`) 중 하나라도 없으면 테스트는 "건너뜀"으로 표시되고 아무것도 전송하지 않는다.

이 점검은 변수 파일을 쓰지 않고 위 환경 변수만 CLI에 넘긴다. CLI를 직접 쓸 때 키를 파일로 주려면 `--vars-file <작업 공간 밖 경로>`를 쓴다. `--env-file`은 받지 않는다(T-15: Node가 그 이름을 스스로 먼저 읽는다).

## 하는 일

임시 폴더에 문서 하나를 만들고, CLI가 `README.md`에 `## 점검` 절을 추가하게 한다. 검증기는 `file_rules`의 `contains`다.

- 고정 상한: 모델 턴 4, 도구 호출 4, 요청당 재시도 1, 요청당 출력 토큰 1024, 총 토큰 30000, 3분. HTTP 요청은 최대 8건이다.
- CLI 프로세스에는 허용 목록 변수와 `ANTHROPIC_API_KEY`, `CODARYN_MODEL`만 넘긴다. `CODARYN_CONFIG`와 `CODARYN_API_BASE_URL`은 넘기지 않으므로 임시 설정 파일과 공식 주소를 쓴다.
- 키 값은 출력하지 않는다. stdout, stderr, 실행 기록에서 키 원문과 정해진 변형을 먼저 찾고, 찾으면 변형 이름만 보고한다.
- 결과로 상태, 이유, 턴 수, 토큰 수를 진단 줄에 남긴다. 성공 기준은 `done`이다.
- 임시 폴더는 끝나면 지운다.

## 입증하지 않는 것

실제 모델이 매번 같은 결과를 내는지, 요금, 다른 모델이나 긴 작업에서의 동작, 속도 제한 상황. 이 점검 한 번은 "실제 API 경로가 연결되고 키가 기록에 남지 않는다"는 것만 보여 준다.
