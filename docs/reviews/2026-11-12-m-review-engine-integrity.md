# 작업 M 교차 검토: 엔진의 무결성 연동(K3)과 실패 서명(V-1)

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조)
- 대상: 관리용 main `53eb466`의 `src/engine/**`
  - K3: integrity capture·compare 시점, `protected_changed` 처리
  - V-1: 좁힌 숫자 정규화(`normalizeVolatile`)
  - 결과를 해석하는 `src/cli/report.ts`의 해당 부분도 영향 범위로 함께 봤습니다(수정 대상 아님).
- 기준: `docs/work-orders/phase-3-self-development.md`(U-1~U-8, V-1~V-3), `docs/cli-contract.md`, `src/contracts`(integrity.ts, engine.ts의 `EngineDeps.integrity`·`protectedChanged`).
- 방법
  - `53eb466`을 `git archive`로 `.codaryn/m/tree`에 풀고 `.codaryn/m/dist`에 빌드했습니다. 저장소와 브랜치는 바꾸지 않았습니다.
  - U-3 때문에 빌드 폴더에 이름이 `codaryn`인 가짜 `package.json`을 두어, 설치 위치를 그 폴더로 좁혔습니다.
  - 실제 CLI 프로세스를 scripted 제공자로 돌리고, 검증기는 실제 `node --test`를 썼습니다. 실제 API·네트워크·키는 쓰지 않았고 가짜 값만 썼습니다.
- 결과: 높음 1건, 중간 2건, 낮음 1건. 모두 실제 CLI로 재현했습니다(4번의 일부 입력만 함수 단위 확인).

## 1. 높음: 검증 라운드 없이 끝난 실행은 마지막 점검 뒤의 보호 대상 변경을 확인하지 않아, 결과와 report가 "변경 없음"이라고 함. 같은 작업 공간의 다음 실행은 바뀐 테스트를 기준선으로 삼아 통과함

- 위치
  - `src/engine/index.ts:698`: run_start 점검.
  - `src/engine/index.ts:587`: 검증기가 없으면 before_verify 전에 끝납니다.
  - `src/engine/index.ts:591, 640`: 점검은 검증 라운드 앞뒤에만 있습니다.
  - `src/engine/index.ts:723-739`: 실행 끝에는 점검 없이 `protectedChanged`(마지막 기록)를 그대로 결과에 싣습니다.
  - 영향받는 곳: `src/cli/report.ts:367, 374`가 빈 목록을 "No protected path changed since the run started."로 출력합니다.
- 깨지는 입력
  - `protectedPaths: ["test"]`이고, 정책이 허용한 명령(`node tools/tamper.mjs`)으로 모델이 보호 테스트를 빈 테스트로 바꿉니다.
  - 실행은 검증 라운드 없이 끝납니다.
- 결과(실제 CLI)
  - A, 턴 한도: `budget-exhausted/max_model_turns`
    - `integrity_checked`는 `run_start:[]` 한 번뿐이고 `protectedChanged: []`입니다. 보호 테스트는 바뀐 상태입니다.
    - report: "Checked 1 time(s): at run start. No protected path changed since the run started."
  - B, 검증기 없음: `needs-input/no_verifier`. A와 같이 `protectedChanged: []`이고 report도 "No protected path changed"입니다.
  - C, A의 작업 공간에서 두 번째 실행(모델은 아무것도 바꾸지 않음): `done/verified`
    - 점검 세 번이 모두 빈 목록이고 `protectedChanged: []`입니다.
    - 기준선이 바뀐 테스트이므로, 고쳐지지 않은 코드(`calc.js`)가 빈 테스트로 통과합니다.
- 왜 문제인가
  - U-2는 "바뀐 경로 목록을 결과와 기록에 남긴다"이고, 계약은 `protectedChanged`를 "Empty when nothing changed"라고 적습니다.
  - 그런데 다음 경우는 마지막 점검 뒤의 변경이 기록되지 않습니다.
    - 턴·도구·토큰·시간 한도
    - 취소
    - `model_error`, `unknown_tool_outcome`
    - 검증기 없음
    - 검증 도중 시간 한도(T-8 판정이 after_verify보다 먼저 옴)
  - report는 그 상태를 "변경 없음"으로 단정합니다.
  - 기준선은 실행마다 새로 잡으므로, 이 실행이 남긴 변경은 다음 실행의 기준이 됩니다.
  - 적대적 모델은 한도까지 도구를 부르기만 해도 실행을 검증 없이 끝낼 수 있습니다.
- 조건
  - 단일 실행만으로는 `done`이 되지 않습니다. 그 실행의 상태는 `done`이 아니지만, 무결성 결과는 거짓으로 "변경 없음"입니다.
  - 통과까지 가려면 같은 작업 공간에서 두 번째 실행이 필요합니다. 단계 3에서 한도 소진 뒤 같은 후보로 다시 돌리는 흐름은 자연스럽다고 봅니다(추측: 절차 문서 K4가 재실행을 막는지는 확인하지 않음).
- 재현: `node .codaryn/m/m1-stale-protected.mjs`(약 5초, A·B·C 출력).
- 권고(결정은 PM, 계약 변경 필요: p7)
  - 실행 끝 점검을 둡니다. 예: `run_end` 단계. run_start 뒤 어떤 이유로 끝나든, 마지막 점검이 after_verify가 아니면 capture·compare해 기록·결과에 싣습니다.
  - 적어도 `protectedChanged`와 report가 "마지막 점검 뒤에는 확인하지 않음"을 구분해야 합니다.
  - 기준선을 실행마다 새로 잡는 한계(앞 실행이 바꾼 보호 파일이 다음 실행의 기준이 됨)는 절차 문서나 report에 적거나, 단계 3에서는 작업 공간 밖 `integrity.paths`(바뀌지 않는 기준 사본)를 쓰도록 안내하면 좋습니다.

## 2. 중간: 모델이 띄운 백그라운드 프로세스가 검증 라운드 동안만 보호 테스트를 약하게 바꿨다가 되돌리면, 한 번의 실행이 무결성 점검을 모두 통과하고 `done/verified`가 됨

- 위치: `src/engine/index.ts:591`(before_verify), `src/engine/index.ts:640`(after_verify). 점검이 라운드 경계 두 시점뿐입니다. T-2로 분리된 자손은 명령이 끝난 뒤에도 살아 있습니다(`src/tools/command-runner.ts` 머리 주석의 알려진 한계).
- 깨지는 입력
  - 정책이 `node`를 허용하고, 검증기는 `build`(400ms) → `tests`(`node --test test/`) → `lint`(1.5초)입니다.
  - 모델은 두 가지만 합니다.
    - `write_file`로 `tools/helper.mjs`를 새로 만듭니다.
    - `run_command`로 그것을 실행합니다. helper는 분리된 자손을 남기고 곧바로 끝납니다.
  - 자손은 작업 공간의 `.codaryn/runs/<id>/journal.jsonl`을 2ms 간격으로 읽습니다.
    - `before_verify` 기록이 보이면 보호 테스트를 빈 테스트로 바꿉니다.
    - `tests`의 `verifier_result`가 보이면 원본으로 되돌립니다.
- 결과(실제 CLI, 3회 중 3회 재현)
  - `done/verified`, 검증기 셋 모두 pass.
  - `integrity_checked`는 `run_start:[]`, `before_verify:[]`, `after_verify:[]`이고 `protectedChanged: []`입니다.
  - 끝에서 보호 테스트는 원본과 같고, `calc.js`는 여전히 틀린 코드입니다.
- 결정표와의 관계
  - PM이 한계로 기록하라고 한 것은 "검증기가 고쳤다 되돌리는 경우"입니다.
  - 이 경우는 행위자가 모델이 남긴 프로세스이고, 기준선과 두 점검이 모두 정상으로 지나가는 한 번의 실행입니다. 그래서 별도 발견으로 셉니다. 한계로 둘지는 PM이 판단할 일입니다.
  - journal은 상태 디렉터리에 있어 파일 도구로는 읽을 수 없지만, 실행된 명령은 읽을 수 있습니다. journal 없이도 시간 추정으로 같은 일을 할 수 있지만, 그 경우는 확률적입니다(추측).
- 재현: `node .codaryn/m/m3-timing-gap.mjs`(사례 A, 약 5초).
- 권고(결정은 PM)
  - 검증 라운드 시작 전에 이 실행이 띄운 프로세스가 남아 있지 않게 합니다(Windows job object로 실행 단위 자손 추적·종료, POSIX 프로세스 그룹). 그래도 남아 있으면 검증을 무효로 합니다.
  - 아니면 한계로 문서에 적고, report의 "검사하지 않은 범위"에 "검증 도중의 일시 변경"을 넣습니다.

## 3. 중간: V-1이 여전히 서로 다른 실패를 묶음. 시험 대상 값이 시간 이름 필드·날짜·시각·시간 단위 문자열·8자리 이상 16진수이면 진전이 있어도 `repeated_failure`

- 위치: `src/engine/feedback.ts:161-189`
  - 165행: 날짜·시각 패스.
  - 171행: 16진수 패스. 글자가 하나라도 있으면 바꿉니다.
  - 176행: 시간 단위 패스.
  - 181행: 시간 키 패스. 186행 `TIME_KEY_WORDS`, 189행 `isTimeKey`.
- 깨지는 입력과 결과(실제 CLI, node --test, 기본 `maxSameFailures` 2, `maxRepairAttempts` 3)
  - (a) Codaryn 자기 코드에 흔한 시간 이름 필드
    - 테스트: `assert.deepEqual(limits(), { maxDurationMs: 60000, maxModelTurns: 12 })`
    - 1회차 근거 `+   maxDurationMs: 1000,`, 2회차 `+   maxDurationMs: 30000,`(모델 수정으로 값이 바뀜). 둘 다 `maxDurationMs: #`가 됩니다.
    - 결과: `failed/repeated_failure`, 재수정 1회.
    - 대조(`maxSameFailures` 3): 세 번째 시도에서 `done/verified`.
  - (b) SHA-256 값을 검사하는 테스트(Codaryn은 내용 해시를 많이 씀)
    - 근거의 actual이 `edeaaff3…`에서 `b5d4045c…`로 바뀌지만, 둘 다 `#`가 되어 `failed/repeated_failure`(재수정 1회)입니다.
  - 함수 단위 확인(`normalizeVolatile`, 53eb466 빌드). 아래 쌍은 서로 다른 실패인데 같아집니다.
    - `'2026-11-13' !== '2026-11-12'`와 `'2026-11-14' !== …`
    - `'07:30:00'`과 `'07:45:00'`
    - `'1.6 s' !== '1.5 s'`와 `'2 s' !== …`(시간 형식화 함수)
    - `elapsedMs: 300`과 `elapsedMs: 250`
    - 커밋 id `4ddc6510`과 `53eb4660`
    - 16진 글자만으로 된 단어 `deadbeefcafe`와 `facadebeef`
- 영향
  - L1-1과 같은 종류의 조기 종료입니다. 범위는 좁아졌지만, 단계 3의 대상인 Codaryn 자체가 `durationMs`, `maxDurationMs`, `startedAt`, SHA-256, 실행 id(날짜) 값을 많이 검사하므로 자기 개발 예행에서 드러날 수 있습니다.
  - 보안 결함은 아닙니다.
- 재현: `node .codaryn/m/m2-v1-signature.mjs`(앞 세 줄, 약 5초). `node .codaryn/m/m4-normalize-probe.mjs`(함수 단위).
- 권고(결정은 PM)
  - 어설션 diff의 값 줄(`+ `/`- `로 시작하는 줄, `actual:`/`expected:` 줄, `!==` 양쪽)은 정규화에서 빼는 방법을 검토할 수 있습니다.
  - 아니면 "정규화만 같고 원문이 다른" 두 번째 실패는 `sameFailures`를 올리지 않고 한 번 더 기회를 주는 방법도 있습니다.

## 4. 낮음: V-1이 같은 실패를 묶지 못하는 입력. 임시 디렉터리 이름(실제 CLI 재현), 임시 포트·PID·숫자뿐인 hashCode·난수 시드(함수 단위)

- 위치: `src/engine/feedback.ts:161-206`. 이런 값은 정규화 대상이 아닙니다.
- 깨지는 입력과 결과(실제 CLI)
  - 테스트가 `mkdtempSync(join(tmpdir(), "rep-"))` 아래 파일을 읽습니다. 코드는 그 파일을 만들지 않습니다.
  - 모델은 주석만 바꾸며 진전이 없습니다.
  - 근거의 `ENOENT ... '...\rep-CzQTc0\report.txt'`가 매번 `rep-6rLUAp`, `rep-eoQ5vL`처럼 달라집니다.
  - 결과: 같은 실패 4번이 모두 다르게 판정되어 `failed/verifier_failed`, 재수정 3회를 모두 썼습니다. R-3의 의도라면 1회 뒤 `repeated_failure`입니다.
- 함수 단위(재현은 함수만, 실제 러너 출력은 추측)
  - `ECONNREFUSED 127.0.0.1:54321` 대 `:61234`(임시 포트)
  - `worker 41234 exited` 대 `41890`(PID)
  - `Foo@12345678` 대 `@87654321`(Java hashCode가 숫자뿐인 경우)
  - `seed 31337` 대 `4242`(RSpec 같은 무작위 순서)
  - 모두 같은 실패인데 다르게 남습니다.
- 추측: 여러 테스트 파일을 병렬로 돌리는 러너는 출력 순서가 실행마다 바뀔 수 있습니다. 실험하지 않았습니다.
- 영향: 비용만 듭니다. `maxRepairAttempts`가 상한이므로 무한 반복은 아닙니다.
- 재현: `node .codaryn/m/m2-v1-signature.mjs`(마지막 줄), `node .codaryn/m/m4-normalize-probe.mjs`.

## 참고: 알려진 한계 재확인(결함 수에 넣지 않음)

- **검사 대상 코드가 검증기 프로세스 안에서 판정을 바꿀 수 있음(T-7 계열, U-1이 잡지 못함)**
  - 보호 테스트가 `../src/calc.js`를 import하므로, 모델이 고친 `calc.js`의 첫 줄 `import assert from "node:assert/strict"; assert.equal = () => {};`가 같은 프로세스의 `assert`를 바꿉니다.
  - 보호 파일은 하나도 바뀌지 않고, 점검 세 번이 모두 빈 목록인 채로 `done/verified`가 됩니다(`m3-timing-gap.mjs` 사례 B).
  - U-1은 "명령이 테스트를 고치는 경로"만 탐지합니다. 단계 3의 "보호된 검증(유닛 일부)"이 후보 코드를 같은 프로세스에서 import하는 한, 판정 자체를 믿을 수 없다는 점을 문서나 report에 적어 두면 좋습니다.
- **검증기 자신이 고쳤다 되돌리는 경우**: PM이 정한 한계입니다. 다시 실험하지 않았습니다.
- **capture가 예외로 끝난 경우**
  - 엔진은 `protected_changed`와 notice로 fail closed합니다(문제 없음). 다만 `integrity_checked` 기록이 없으므로 report는 "Not checked: the run had no integrity check (nothing was protected, or it ran without the check)."를 냅니다.
  - 상태는 맞지만 문구가 실제와 다릅니다(코드 읽기, `report.ts:366-371`; K1 영역).

## 문제 없던 범위(확인한 것)

- `protected_changed`에서 재수정으로 가는 경로는 없습니다. before_verify·after_verify 결과가 비어 있지 않으면 `verify()`가 바로 End를 돌려주고, `decideRepair`와 `repair`에 닿지 않습니다(코드 읽기, 1·2번 실험 기록으로도 확인).
- 바뀐 경로의 가림
  - 기록과 결과는 경로마다 `mask`합니다. 가림이 실패하면 `failed/model_error`로 끝나고 아무것도 기록하지 않습니다.
  - notice는 원문을 이어 붙인 뒤 통째로 가립니다. 비밀이 경로 경계에 걸쳐도 더 많이 가릴 뿐 새지 않습니다.
  - `protected_changed`이면 실행이 바로 끝나므로 바뀐 경로가 모델 요청에 실리지 않습니다.
- capture 실패와 상한
  - capture 예외는 `protected_changed`입니다(fail closed).
  - `unchecked`(읽기 실패·상한)는 run_start의 `compare(m, m)`에 나오므로 첫 모델 요청 전에 `protected_changed`가 됩니다. 통과로 처리되는 경로는 찾지 못했습니다.
- 취소·한도와 겹칠 때
  - 점검 시점에 이미 걸린 중단은 점검보다 먼저 와서 점검을 건너뜁니다(`checkPoint`).
  - 점검 결과가 비어 있지 않으면, 그 capture 도중 생긴 중단보다 우선합니다.
  - 빈 after_verify 뒤에는 `late` 중단 판정이 `done`보다 먼저 옵니다.
  - 상태가 잘못 `done`이 되는 조합은 찾지 못했습니다. 다만 1번처럼 중단으로 끝나면 끝 점검이 없습니다.
- `done`으로 가는 경로는 항상 같은 라운드의 after_verify를 지납니다(`index.ts:640` 뒤에만 `verified` 판정).
- V-1이 의도대로 묶는 입력(같은 실패)
  - node --test의 `(1.2345ms)`, `duration_ms 52.3`
  - Python `in 0.004s`
  - 주소 `0x7f…`
  - 위 1번 실험의 node --test 출력
  - 줄·열 번호(`calc.test.js:6:10`)와 actual/expected 정수는 그대로 둡니다(L1-1 입력에서 확인).

## 검사하지 않은 범위

- POSIX 실행은 하지 않았습니다. 2번의 분리된 자손 동작은 Windows(libuv, `detached: true`)에서만 확인했습니다.
- 다른 테스트 러너(Jest, Vitest, pytest, Go, JUnit, RSpec)의 실제 출력으로는 실행하지 않았습니다. 4번의 해당 부분은 함수 단위 입력이며, 실제 출력 형식은 추측입니다.
- capture 도중 다른 프로세스가 파일을 바꿔 목록이 찢어지는 경우, 큰 저장소에서 capture 시간이 검증 시간보다 긴 경우의 성능은 재지 않았습니다.
- K1의 `integrity.paths` 설정 검사(위치, 중복, 작업 공간 포함 관계), `doctor`, report의 무결성 외 부분, K4 절차 문서의 재실행 안내는 이번 대상이 아니어서 보지 않았습니다.
- 실제 API·UNC·실제 키는 쓰지 않았습니다.

## 실험 파일(`.codaryn/m`, 저장소 밖)

- `tree/`: 53eb466 원본(`git archive`). `dist/`: 빌드와 가짜 `package.json`(U-3 설치 위치를 좁히는 용도).
- `harness.mjs`: 사례 디렉터리 생성과 CLI 실행.
- `m1-stale-protected.mjs`: 1번.
- `m3-timing-gap.mjs`: 2번(사례 A)과 참고의 assert 덮어쓰기(사례 B).
- `m2-v1-signature.mjs`: 3번 (a)(b)와 대조, 4번 임시 디렉터리.
- `m4-normalize-probe.mjs`: 3·4번 함수 단위.
- `cases/`, `tmp/`: 실행 결과.
