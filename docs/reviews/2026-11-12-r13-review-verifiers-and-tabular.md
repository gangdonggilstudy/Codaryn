# R-13 병합 전 검토: G-D 검증기와 표 해석 (inventory, data_checks, CSV·TSV·JSON Lines)

## 0. 이해 확인과 대상

- 페르소나: 보안·개인정보 검토자(주), 검증 엔지니어(보조). 읽기 전용이며 구현자가 아니다.
- **검토 대상(고정)**: PM 통합 트리 `pm/bundle-1` = **`7de824a`**("Merge branch 'claude/cli-verification' into pm/integration", 10개 브랜치를 합친 것)
  - 범위 파일을 바꾼 커밋(main..7de824a)
    - `47847a2` feat(verify): data_checks 검증기와 적용 인벤토리 (G-D, VF-04, VF-05, DR-6)
    - `b382508` feat(tabular): CSV·TSV·JSON Lines 표 해석과 집계 (G-D, VF-04)
    - `f53fb16` feat(contracts): 범용 작업 계약 (G-A, `src/contracts/verify.ts` 부분)
  - 범위 코드: `src/verify/data-checks.ts`, `src/verify/inventory.ts`, `src/verify/result.ts`, `src/verify/index.ts`(달라진 부분), `src/tabular/{table,aggregate,index}.ts`, `src/contracts/verify.ts`(추가분)
- 기준: `docs/design/general-tasks.md` 5절(특히 5.2·5.3, 표의 "자동 검증", "확인하지 못하는 것", "형식 한계")과 10절(GT-U09, GT-U10, GI-06, GI-07), 결정 DR-6.
- 읽기 방법: `git -C D:\project\Codaryn archive 7de824a`로 빌드 사본을 만들었다(`D:\project\Codaryn\.worktrees\claude-general\.codaryn\r13\b1`). 비교는 `git diff main...7de824a`로 했다.
  - 저장소 파일 수정·커밋은 없다. 통합 트리와 main은 읽기만 했다.
- 빌드 사본 상태
  - typecheck 오류 0(PM 수치와 같다).
  - 범위 유닛(`tests/unit/verify`, `tests/unit/tabular`) 73건 통과.
  - 통합 `n07-analyze` 8건, `n08-workflows` 18건 통과.
- 실험: 빌드 사본의 `dist`를 불러 실제 파일과 실제 `Workspace`로 했다. 실제 API, 외부 네트워크, 키 파일은 쓰지 않았다.
  - 스크립트: `.codaryn/r13/exp13.mjs`(parse, numbers, agg, leak, limits, inv), `inv13.mjs`, `timing13.mjs`, `perf13.mjs`

심각도: 높음(지금 틀린 통과나 원자료 유출, 선행 조건 없음), 중간(재현되는 결정 위반, 선행 조건 있음), 낮음, 정보.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 3 (L-1~L-3) |
| 정보 | 8 (I-1~I-8) |

**PM 중점 항목(재현)**

| 항목 | 결과 |
| --- | --- |
| 상한에 닿았을 때 판단 불가를 통과로 내지 않는가 | 지켜짐. 원본 표가 상한을 넘으면 `inconclusive`, 결과 표가 넘으면 `fail`이다(16 MiB+1 바이트 실제 상한 포함). 정확히 상한이면 읽는다. 인벤토리는 상한 초과면 `inconclusive`이고, 정확히 상한 개수면 정상 비교한다. 상한에 닿은 목록 둘 사이의 변화는 `inconclusive`(통과 아님). 규칙 없음, 취소, 경로 거부도 `inconclusive`다. double 넘침은 NaN이 되어 통과하지 못한다(분류는 L-1) |
| CSV 따옴표·줄바꿈·BOM·빈 값·숫자 경계 | 계약(RFC 4180 부분집합)대로다. 따옴표 안의 `,`·LF·CRLF·`""` 처리, 닫는 따옴표 뒤 글자, 따옴표 없는 칸 안의 `"`, 홀로 선 CR, 닫히지 않은 따옴표는 각 오류 코드다. 빈 줄은 열 하나 표에서는 빈 칸 행, 그 밖은 `field_count`다. 숫자는 `-?digits[.digits][e±digits]`만 받는다(`+1`, `.5`, `1.`, `1,000`, 앞뒤 공백, `0x10`, `NaN`, 전각·아랍 숫자 거부, `1e309` 거부). 세부 경계는 I-3, I-4 |
| 집계가 손계산과 맞는가 | 맞다. 손계산한 표(따옴표 안 쉼표가 든 묶음 값, 빈 금액 칸, 빈 묶음 칸 포함)에서 묶지 않은 합계 115.35와 묶은 sum·count·min·max·mean 다섯 가지가 모두 통과했다. 0.01 차이는 `fail`이다. 0.1 열 개의 합은 보정 덧셈으로 정확히 1이다 |
| 검증기 결과와 기록에 원자료 값이 새는가 | 칸 값은 새지 않는다. 표지 문자열을 모든 칸에 넣고 9가지 실패 경로를 돌렸다. 근거·`checked`·`limits`에 나온 것은 결과 표의 열 이름뿐이다(설계가 허용하는 "열 이름", I-2). 묶음 키와 숫자가 아닌 칸은 행 번호로만 나온다. 통합 GG-D05(등록 비밀이 근거·기록·출력에 원문으로 없음)도 통과한다 |
| 기존 검증기 동작이 그대로인가 | 그대로다. `command`·`file_rules` 코드는 바뀌지 않았다. `createRawVerifierResult`는 `result.ts`로 옮겼고 함수 몸체는 main과 글자까지 같다. 허용 종류에 `data_checks`, `inventory`만 더했다. 모르는 종류는 main처럼 예외다. 기존 시험(`verify`, `evidence`, `integrity`)은 main과 바뀐 줄이 없고 통과한다 |

## 2. 낮음

### L-1 원본 합이 double 범위를 넘으면 NaN이 되어 "결과 표가 틀림"(`fail`)으로 분류된다

- 위치: `src/tabular/aggregate.ts:42-51`(Neumaier 덧셈), `src/verify/data-checks.ts:280-296`(`compareValue`), `:321-332`
- 재현(`exp13.mjs agg`)
  - 원본 `v` 열이 `1e308`, `1e308`이고 결과 표 `total`이 `5`이면 `fail`이다. 근거는 `recomputed NaN, found 5`다. mean도 같다.
  - `1e308, 1e308, -1e308, -1e308` 대 `0`도 `fail`이다(`recomputed NaN, found 0`).
  - 원인: 합이 Infinity가 되면 보정 항이 −Infinity가 되어 마지막 합이 NaN이다. NaN과의 비교는 늘 거짓이라 **통과로 새지는 않는다**.
- 결과
  - 원본 탓(모델이 고칠 수 없음)인데 `fail`이라 재수정을 돌다가 `failed`/`verifier_failed`로 끝난다.
  - 설계 5.2 "원본을 해석하지 못하면 `inconclusive`"와 다르다.
- 선행 조건: 원본 값의 합이 약 1.8e308을 넘어야 한다. 실제 자료로는 드물다.
- 권고: 다시 계산한 값이 유한하지 않으면 원본 문제(`undecided`)로 판정한다(`sourceProblem`에 "계산이 범위를 넘음" 사유).

### L-2 값이 모두 빈 묶음이 하나라도 있으면 규칙 전체가 `inconclusive`이고, 한계 목록에 없다

- 위치: `src/tabular/aggregate.ts:62`(`no_values`), `src/verify/data-checks.ts:343-347`(`sourceProblem` 즉시 반환)
- 재현(`exp13.mjs agg`): 원본 `k,v` / `a,1` / `b,`에서 `k`로 묶은 sum은 `inconclusive`다. 근거는 "source column "v" has no number to compute (group first seen at source data row 2)"다. 결과 표가 `b`를 0으로 적어도, 비워도 같다.
- 결과
  - 결측이 있는 실제 자료에서는 이 규칙이 통과할 수 없다(늘 `needs-input`/`verifier_inconclusive`).
  - 보수적이라 틀린 통과는 아니다. 다만 `DATA_CHECKS_LIMITS`와 사용 문서에 이 동작이 없다.
- 권고(PM 판단): 다음 중 하나
  - (가) 한계 목록에 "열의 값이 모두 빈 묶음이 있으면 sum·min·max·mean 규칙은 판단 불가"를 적는다.
  - (나) 그런 묶음은 결과 표 칸이 비어 있을 때 일치로 본다.

### L-3 인벤토리 목록이 `lstat`을 하나씩 순서대로 하고 취소를 보지 않아, DR-6 상한 근처에서 오래 걸릴 수 있다

- 위치: `src/verify/inventory.ts:144-183`(`capture`): 파일마다 `await files.lstat(child)`를 순서대로 부르고, `signal`을 받지 않는다.
- 측정(`exp13.mjs inv`, `timing13.mjs`, 같은 기계, 파일 12,000개)
  - 만든 직후(차가운 상태) `capture`: 23.7초, 다른 실행에서 104초. 따뜻한 상태: 0.26초.
  - 같은 조건에서 순차 `lstat` 37초 대 64개씩 동시 `lstat` 0.8초.
  - [주의] 이 기계는 다른 세션의 시험이 함께 돌아 수치가 크게 흔들린다(PM이 말한 V-2 흔들림과 같은 환경). 절대값보다 순차와 동시의 차이를 근거로 든다.
- 결과
  - 적용 한 번에 목록을 앞뒤로 두 번 잡는다. 계획 보기(`plan`)도 파일 수를 센다(DR-6).
  - 상한 10만 개 근처에서는 몇 분에서 수십 분이 걸릴 수 있고, 그동안 취소가 먹지 않는다.
  - 판정이 틀리지는 않는다. 상한 도달은 정확히 `inconclusive`이고, 12,000개는 다 잡힌다(GT-U09).
- 권고: `lstat`을 정해진 수만큼 동시에 부르고, `capture`가 신호를 받아 취소되면 미완(`inconclusive`/중단)으로 끝내게 한다. 또는 사용 문서에 큰 작업 공간의 시간을 적는다.

## 3. 정보

- **I-1 문제 없던 범위(재현)**
  - 표 해석: BOM 하나 제거, 빈 파일·BOM만 있는 파일 `empty`, 머리 행만 있는 표는 행 0, 끝의 쉼표는 빈 이름의 열, 끝의 여러 줄바꿈 무시, CRLF·LF 섞임, TSV의 `"`는 일반 글자, JSON Lines의 빈 줄·공백 줄 `blank_line`, 배열 줄 `not_object`, 중첩 20만 단 예외 없음.
  - data_checks
    - 원본이 없거나 UTF-16이거나 상태 디렉터리·밖 경로·밖을 가리키는 정션이면 `inconclusive`다. 결과 표가 없거나 상한을 넘으면 `fail`이다.
    - 규칙 없음 `inconclusive`, 취소 `inconclusive`.
    - 한 규칙이 `fail`이고 다른 규칙이 `inconclusive`면 `fail`.
  - 16 MiB 근처 CSV 해석 시간: 큰 따옴표 칸 하나 0.8초, 140만 행 0.3초(`perf13.mjs`).
  - inventory(`inv13.mjs`, 실제 파일): 계획대로 `pass`이다. 다음은 모두 `fail`이다.
    - 계획 밖 파일의 삭제·크기 변화·생성·이동
    - 옮긴 파일과 보관함 파일의 해시 차이, 보관함 파일 없음
- **I-2 근거에 결과 표의 열 이름이 나온다**
  - `table_shape`이 열을 "정확히" 비교하다 다르면, 근거에 결과 표의 실제 머리 행을 적는다(`data-checks.ts:226`).
  - CSV에서는 열 이름이라 설계 5.2가 허용하는 범위다.
  - JSON Lines는 객체의 키가 열이므로, 키를 자료로 쓰는 표(`{"<이름>": 1}`)면 그 자료가 근거에 나온다(재현: 표지 `PII-KEYASDATA`).
  - 대상은 모델이 쓴 결과 표뿐이다. 다만 사용자가 `table_shape`을 입력 자료에 걸면 입력의 머리 행이 근거(기록, 재수정 때 모델)로 간다. 사용 문서에 적을 만하다.
- **I-3 빈 값의 경계**
  - 길이 0만 빈 칸이다. 공백만 있는 칸은 `count`에서 값으로 세고(재현: 2), `sum`에서는 숫자가 아니다(원본이면 `inconclusive`).
  - 묶음 값은 정확한 글자로 비교한다(`a`와 `a `는 다른 묶음). 한계 목록에 있다.
- **I-4 숫자·BOM 세부**
  - JSON Lines의 큰 정수는 double로 읽혀 정밀도가 소리 없이 깎인다(`12345678901234567890` → `12345678901234567000`). `-0`은 `0`이다.
  - 검증기는 `TextDecoder`와 해석기가 앞의 BOM을 하나씩 떼므로, BOM 두 개까지는 머리 행에 남지 않는다. 둘째 줄 이후의 BOM은 칸 값에 남아 숫자가 아니다.
- **I-5 Windows에서 계획 밖 파일의 대소문자만 바뀐 이름 변경은 `pass`다**
  - 경로를 소문자로 접어 비교하기 때문이다(`inventory.ts:131`).
  - NTFS가 대소문자를 구별하지 않으니 같은 파일로 보는 것은 맞다. 대소문자를 구별하는 폴더(WSL 설정)에서는 두 파일이 한 키로 겹칠 수 있다.
- **I-6 기본 허용 오차의 상대 1e-9는 값이 크면 절대 오차가 커진다**: 1e15 합계면 1e6 차이까지 맞다고 본다. 계약대로이며 사용 문서에 예를 들 만하다.
- **I-7 작은 묶음**
  - 한 명뿐인 묶음의 sum·min·max는 그 사람의 값 그대로다. 근거와 기록에 "다시 계산한 수"로 나온다.
  - 설계 5.2의 "그룹 최소 크기 이하는 숨김"은 [미정]이고 구현되지 않았다(이번 범위에서 결정된 것은 아님).
- **I-8 측정 환경**: L-3의 시간 수치는 이 기계의 부하로 실행마다 크게 달랐다(0.26초~104초). 수치 자체보다 같은 조건의 순차·동시 비교를 근거로 삼았다.

## 4. 설계·결정 대조

| 기준 | 결과 |
| --- | --- |
| 5.2: 원본 해석 실패 `inconclusive`, 결과 해석 실패 `fail` | 맞다(L-1의 넘침만 예외) |
| 5.2: 근거에는 열 이름, 행 번호, 다시 계산한 수와 결과 표의 수만 | 맞다(I-2의 JSON Lines 키 예외) |
| 5.2: 한계에 "열거한 형태와 집계만" | `DATA_CHECKS_LIMITS` 첫 줄에 있다 |
| 5 표: 숫자는 `.` 소수점만 | 맞다 |
| 5 표·DR-6: 계획 대상은 해시, 나머지는 경로·크기, 10만 개 | 맞다(`MAX_INVENTORY_FILES` 100,000) |
| 5 표: 확인 못 함 — 계획 밖 파일의 같은 크기 내용 변경 | 실제로 `pass`이고 `INVENTORY_LIMITS` 첫 줄에 있다 |
| GT-U09 | 재현으로 모두 확인했다(1만 개 초과 목록 포함) |
| GT-U10 | 열·행 수·허용 오차 밖 `fail`, 원본 `inconclusive`, 결과 `fail`, 근거에 칸 값 없음을 확인했다 |
| DR-6 "상한에 닿으면 적용 전에 알린다" | 검사기 쪽(`limitReached`, 상한 도달 `inconclusive`)은 맞다. 적용 전 중단은 엔진(G-B)이 `plan_stale`로 한다(범위 밖이지만 내 코드라 확인함) |

## 5. 검사하지 않은 범위

- macOS·Linux, 대소문자를 구별하는 NTFS 폴더(I-5)
- 10만 개 실제 작업 공간(12,000개까지만 만들었다)
- 설정·task의 `data_checks` 해석(N-A·CLI 몫)과 CLI의 `plan` 파일 수 보고
- 검증 중 링크를 바꾸는 경쟁 조건(`resolve` 뒤 `fs.open`). 검증 중에는 모델이 명령을 돌리지 않아 따로 실험하지 않았다.

## 6. PM 판단 필요

- **P-1(L-2)**: 값이 모두 빈 묶음의 판정. 한계 목록에 적을지, 결과 표 빈 칸과 일치로 볼지.
- **P-2(L-3)**: 인벤토리 목록의 동시 처리와 취소를 지금 고칠지, 사용 문서로 알릴지.
- **P-3(I-7)**: 작은 묶음 숨김 규칙(설계 5.2 [미정])을 언제 정할지.

사용자에게 물을 질문은 없다.

## 7. 실행한 것

- 읽기: `git show`·`git diff main...7de824a`. 범위 파일 전부, 설계 5·10절, DR-6.
- 빌드: `git archive 7de824a` 사본에서 `tsc`(오류 0).
- 시험
  - 범위 유닛 73건
  - 통합 `n07-analyze` 8건, `n08-workflows` 18건
- 실험: `exp13.mjs`(parse, numbers, agg, leak, limits, inv), `inv13.mjs`, `timing13.mjs`, `perf13.mjs`
- 저장소 파일 변경과 커밋 없음. **실제 API 미실행.**
