# 실제 API 점검 (tests/live)

> **실행한 적 없음.** 이 폴더의 점검은 이 저장소에서 아직 한 번도 실제 API로 실행되지 않았다. 작업자는 키 없이 "변수가 없으면 건너뛴다"만 확인했다(U-101, 2026-11-13: 5건 모두 건너뜀, 실패 0). 결과를 믿기 전에 사용자가 직접 한 번 돌려 보아야 한다.

이 폴더는 **실제 Anthropic API와 실제 OpenAI API**를 호출하는 점검이다. 모의 API 검증(`tests/integration/m0*`, `o0*`)과 다르다.

- 기본 npm 명령(`test`, `test:unit`, `test:integration`)에는 들어가지 않는다. 파일 이름이 `.test.ts`로 끝나지 않으므로 `dist/tests/**/*.test.js`에 걸리지 않는다.
- PM과 작업자는 실행하지 않는다. 사용자가 키를 설정한 뒤 직접 실행한다.
- 공통 부분은 `live-support.ts`에 있다. 시험 파일이 아니라서 불러와도 시험이 생기지 않는다.

## 실행

먼저 빌드한다.

```powershell
npm run build
```

키는 미리 사용자 환경에 설정해 둔다. 값을 명령줄이나 파일에 적지 않는다.

### Anthropic

```powershell
$env:CODARYN_LIVE = "1"
$env:CODARYN_MODEL = "<모델 id>"
# ANTHROPIC_API_KEY는 미리 설정해 둔다.
node --test dist/tests/live/anthropic-live.js
```

### OpenAI

```powershell
$env:CODARYN_LIVE = "1"
$env:CODARYN_OPENAI_MODEL = "<모델 id>"   # 점검 3을 보려면 추론 모델
# OPENAI_API_KEY는 미리 설정해 둔다.
node --test dist/tests/live/openai-live.js
```

- 각 파일은 세 변수 가운데 하나라도 없으면 모든 시험을 "건너뜀"으로 표시한다. 그때는 아무것도 전송하지 않는다.
  - Anthropic: `CODARYN_LIVE=1`, `ANTHROPIC_API_KEY`, `CODARYN_MODEL`
  - OpenAI: `CODARYN_LIVE=1`, `OPENAI_API_KEY`, `CODARYN_OPENAI_MODEL`
- 두 파일을 한 번에 돌릴 수도 있다(`node --test dist/tests/live/anthropic-live.js dist/tests/live/openai-live.js`). 변수가 있는 쪽만 돈다.
- 이 점검은 변수 파일을 쓰지 않고 위 환경 변수만 CLI에 넘긴다. CLI를 직접 쓸 때 키를 파일로 주려면 `--vars-file <작업 공간 밖 경로>`를 쓴다. `--env-file`은 받지 않는다(T-15: Node가 그 이름을 스스로 먼저 읽는다).

## 하는 일과 드는 것

모두 임시 폴더에서 하고, 끝나면 지운다. CLI 프로세스에는 허용 목록 변수와 그 제공자의 키·모델 변수만 넘긴다. `CODARYN_CONFIG`와 주소 변수(`CODARYN_API_BASE_URL`, `CODARYN_OPENAI_API_BASE_URL`)는 넘기지 않으므로, 임시 설정 파일과 공식 주소를 쓴다.

### Anthropic (`anthropic-live.ts`): 작업 둘

| 점검 | 하는 일 | 성공 기준 |
| --- | --- | --- |
| 문서 작업 | `README.md`에 `## 점검` 절을 더한다. 검증기는 `file_rules`의 `contains` | `done`, 원래 글이 그대로 |
| 코드 작업(U-101) | `math.mjs`의 `add`가 빼기를 하는 것을 더하기로 고친다. 검증기는 이 Node.js로 `check.mjs`를 돌리는 `command`이고, `check.mjs`는 `protectedPaths`라 모델이 쓸 수 없다 | `done`, 검증기 `pass`, `check.mjs`가 그대로 |

- 상한(작업마다 같음): 모델 턴 4, 도구 호출 4, 요청당 재시도 1, 요청당 출력 토큰 1024, 총 토큰 30000, 3분.
- 드는 것: HTTP 요청은 작업마다 최대 8건, 둘이면 최대 16건. 토큰은 작업마다 최대 30000, 둘이면 최대 60000.

### OpenAI (`openai-live.ts`): 점검 셋

| 점검 | 하는 일 | 성공 기준 |
| --- | --- | --- |
| 1 모델 목록 | `codaryn models --provider openai --json` | `listed`, 모델이 하나 이상, `CODARYN_OPENAI_MODEL`이 목록에 있음 |
| 2 도구 한 바퀴 | Anthropic 문서 작업과 같은 일: 도구 호출 → 결과 → 마지막 답 | `done`, 성공한 도구 결과가 있음, 마지막 응답이 `final` |
| 3 추론 항목 다시 보내기([C-11](../../docs/design/second-provider-facts.md)) | 점검 2의 실행 기록을 읽는다. 요청을 따로 보내지 않는다. 어댑터는 저장 없이(`store: false`) 요청하므로, 추론 모델이 돌려준 추론 항목을 다음 요청에 다시 실어야 한다. 추론 항목을 돌려준 응답 뒤에 같은 실행의 응답이 또 있으면, API가 그것을 받은 것이다 | 그 뒤의 응답이 있고 모델 오류가 없음 |

- 점검 3은 모델이 추론 항목을 돌려주지 않으면 "건너뜀"이 되고 까닭을 적는다. 그 경우 C-11은 확인되지 않은 것이다. 추론 모델로 다시 돌린다.
- 상한: 모델 턴 4, 도구 호출 4, 요청당 재시도 1, 요청당 출력 토큰 4096(추론 토큰도 출력에 든다, 사실 C-10), 총 토큰 40000, 3분.
- 드는 것: HTTP 요청은 점검 1이 최대 2건, 점검 2가 최대 8건, 점검 3은 0건이라 합쳐 최대 10건이다. 토큰은 점검 2의 최대 40000이다(목록 요청은 토큰을 쓰지 않는다).

### 공통

- 키 값은 출력하지 않는다. stdout, stderr, 실행 기록에서 키 원문과 정해진 변형을 먼저 찾고, 찾으면 변형 이름만 보고한다.
- 결과로 상태, 이유, 턴 수, 토큰 수(OpenAI는 응답마다 추론 항목 수도)를 진단 줄에 남긴다.

## 입증하지 않는 것

- 실제 모델이 매번 같은 결과를 내는지, 요금, 다른 모델이나 긴 작업에서의 동작, 속도 제한 상황.
- 이 점검 한 번은 "실제 API 경로가 연결되고, 도구 한 바퀴와 작은 코드 수정이 검증까지 가고, 키가 기록에 남지 않는다"는 것만 보여 준다.
- OpenAI 점검 3은 저장 없이 이어 가는 요청이 받아들여졌다는 것만 보인다. 요청 본문(`store: false`, 다시 보낸 항목)은 이 점검이 직접 보지 않는다. 그것은 모의 시험(`tests/unit/model/openai`)이 고정한다.
