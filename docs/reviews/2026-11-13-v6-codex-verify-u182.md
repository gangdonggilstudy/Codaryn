# V-6 정확성 검증 — U-182

- 검증자: codex-probe. 페르소나: 검증 엔지니어, 보안·개인정보 검토 관점 보조.
- 대상 브랜치: `unit/U-182-na-core`.
- 기준: `21107dc91d9522efbbb694f4da1bf79ffa1495d5`.
- 후보: `f5b09686813766f064a7e9015a72d5add7ef2fbe`.
- 근거: DR-69, `docs/reviews/2026-11-13-p1-bundle-proposal.md` 4절 B-4·B-8.
- 환경: Windows, Node `v26.13.1`. 관리 저장소는 `D:/project/Codaryn`, 브랜치는 `main`; 검증용 브랜치나 worktree를 만들지 않았다.
- 실험 루트: `D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-v6-f5b0968` (이하 R). 두 판은 R의 `compare/base`, `compare/head`에 `git archive`로 풀었다.
- **새 발견: 높음 0건 / 중간 0건 / 낮음 0건.** 아래 유한 입력에서 범위 확대를 재현하지 못했다. 알려진 앱 계층 누락은 별도로 재현하고 건수에서 제외했다. 채택 판단은 PM에게 맡긴다.

## 실행 결과

| 구분 | 결과 |
| --- | --- |
| 두 archive 사본 TypeScript 컴파일 | 2/2 성공, 비교 도구 종료 코드 0 |
| writablePaths 없는 기존 CLI 비교 | 27개 시나리오, 508개 산출물 비교, 차이 0, 네트워크 가드 위반 0 |
| 관련 기존 시험 8개 파일 | 55건 통과, 실패 0, 건너뜀 0, 취소 0, todo 0; Node 러너 3,757.5785 ms |
| 독립 대본 모델 CLI 쓰기 사례 | 18/18 기대 결과 일치 |
| 네 원천의 잘못된 목록 입력 | 48/48 실행 전 거부 |
| 설정·프로필·task의 이동 계획 제안·적용 | 18/18 기대 결과 일치 |
| 사용자 정의 작업 종류의 이동 계획 제안·적용 | 8/8 기대 결과 일치 |
| doctor 명령 경고 | 8/8 기대 결과 일치 |
| 정의 선택 경로(task 참조·프로필 참조) | 2/2 기대 결과 일치 |
| 간편 CLI, 127.0.0.1 모의 API | 8/8 기대 결과 일치; 로컬 HTTP 요청 24회 |
| 기존 `plan: "run"` 미지원 확인 | task·정의 2/2 입력 단계 거부 |
| 알려진 앱 계층 누락 | 같은 입력의 CLI 거부 / 앱 쓰기 허용 1/1 재현, 발견 건수 제외 |

독립 검증의 일반 기대 결과는 합계 110/110이고, 미지원·알려진 누락 확인은 별도 3건이다. 이 113건을 기존 시험 55건과 합쳐 제품 유닛 시험 수로 보고하지 않는다. CLI 프로세스, 실제 파일, journal을 확인했으며 모델은 대본 또는 로컬 모의 서버다.

## 원천별 교집합과 입력 의미

- `src/cli/run.ts:739`에서 설정 원본·선택한 프로필·적용 정의·task의 목록을 모은다. `src/cli/writable.ts`는 목록을 합집합으로 펴지 않고 원천별로 유지한다. `src/cli/assemble.ts:377`과 `src/cli/plan-commands.ts:729`가 이를 관문에 전달한다.
- 네 원천 각각에 대해 단독 `['a']`, 그 원천만 `['a']`이고 다른 세 원천은 `['.']`, 그 원천만 `[]`이고 다른 세 원천은 `['.']`를 시험했다. `a/yes.txt`와 `ab/no.txt`를 실제 `write_file`로 요청했다. `['a']` 제한은 `a/yes.txt`만 허용했고, `ab/no.txt`는 `path_not_writable`로 거부되어 생성되지 않았다. 빈 목록은 두 파일 모두 거부했다.
- 서로 다른 네 목록 `{config:['a','c'], profile:['a/sub','b'], definition:['a/sub/yes.txt','d'], task:['a','e']}`에서도 공통 파일 `a/sub/yes.txt`만 생성됐다. 나머지 5개 경로는 `path_not_writable`이고 파일이 없었다. `['a']`와 `['ab']`의 교집합도 두 쓰기를 모두 거부했다.
- 모든 원천에서 필드가 없으면 이 제한은 없다. task 형식과 간편 형식 모두 두 파일을 썼다. 이는 다른 정책이나 보호 경로를 해제한다는 뜻이 아니다.
- 목록은 Windows에서 대소문자를 구분하지 않았다. `A`/`a`는 같은 범위였고 `Ab`는 밖이었다. `a/`도 `a` 아래만 허용했다.
- 쓰기 경로 `a./bad.txt`, `a /bad.txt`, `a/bad.txt.`, `a/bad.txt `는 모두 `invalid_path`로 거부됐고 파일이 없었다. 잘못된 경로 형식의 거부 코드와 유효한 범위 밖 경로의 `path_not_writable`을 구분했다.
- 잘못된 목록 12종 × 네 원천 = 48건: 배열 아닌 문자열, null, 숫자 항목, 빈 문자열, 공백, 상위 경로, 절대 경로, 끝 점, 끝 공백, NUL, 장치명, ADS. task는 `invalid_task`, 설정·프로필·정의는 `invalid_config`로 거부했고 실행 기록과 쓰기 대상 파일이 생성되지 않았다. `src/cli/task.ts:318,363`의 형식 검사와 일치한다.
- 간편 형식은 `--workspace --goal --config --profile`에 정의를 `--workflow` 또는 프로필 참조로 골랐다. 설정·프로필·정의 각각의 좁은 목록과 빈 목록이 유지됐다. 간편 형식에는 task 파일 원천이 없으므로 네 원천 task 형식 검증과 구분한다.

재현 자료: R의 `probe.mjs`, `results.json`, `cases/config-narrow-all-others-wide/{task.json,config.json,script.json,run.stdout,run.stderr}` 및 각 사례의 `ws/.codaryn/runs/*/journal.jsonl`. 예를 들어 해당 사례의 입력으로 실제 CLI에 `run --task <task.json> --config <config.json> --profile p`를 주면 결정은 `allowed`, `path_not_writable` 순서다. 초기 workspace가 빈 새 사례에서 실행해야 생성 성공까지 같은 조건으로 재현된다.

## 계획 제안과 적용

- `propose_plan`에 `inbox/source.txt → out/dest.txt` 이동을 제안했다. 원천 하나가 `['inbox']` 또는 `['out']`만 허용하면 원본이나 목적지의 쓰기 범위가 빠져 `path_not_writable`로 거부됐다. `['inbox','out']`이면 `plan_pending`이 됐으며 제안만으로 파일을 옮기지 않았다.
- 목록 없는 상태에서 유효한 계획을 만든 뒤 적용 입력의 설정·프로필·task 또는 정의를 좁혔다. 원본·목적지 중 하나가 빠지면 `failed/plan_stale`, `plan_checked`의 `denied` 문제로 적용을 거부했다. 원본 바이트는 그대로였고 목적지는 생성되지 않았다. 양쪽이 허용되면 적용되어 원본은 없어지고 목적지가 생겼다. 정의의 빈 목록도 제안·적용을 모두 막았다.
- 적용은 적용 시점의 task와 설정 정책으로 판정했다. 제안 시점의 목록을 영구 정책으로 저장한다고 주장하지 않는다.
- **`plan: "run"`과 승인된 파일 목록의 교집합 실행은 미검증이다.** 이 후보는 U-177의 미지원 방어를 유지한다. task의 `plan: "run"`과 정의의 같은 필드는 `plan_run_not_available` 힌트와 함께 실행 전에 거부됐다. 이번 계획 검증은 기존 `plan: "apply"` 이동 계획이다. 관련 기존 시험에는 폐기 동작도 포함되지만 독립 계획 탐침은 이동으로 수행했다.

원문: R의 `results.json`의 `plan-proposal`·`plan-apply`, `supplement-results.json`의 `definition-plan`·`known-unavailable`, 해당 사례의 proposal/apply 출력과 journal.

## doctor와 알려진 앱 계층 누락

- 네 원천 각각의 좁은 목록·빈 목록에 실제 존재하는 Node 실행 파일의 명령 규칙을 함께 두었다. doctor 8건 모두 `commands`가 warn이고 `doctor.commands.writable_with_commands`를 제공했다. 목록이 명령 자체를 제한한다고 주장하지 않는다. 이 검사는 명령을 통한 범위 밖 쓰기 실험이 아니다.
- 알려진 누락 재현: `config.policy.writablePaths=['a']`, `task.policy.writablePaths=['.']`, `ab/no.txt` 쓰기 1회. 같은 입력에서 CLI는 `path_not_writable`로 거부했다. 이어 실제 앱의 공개 `createCodarynApp(...).startRun(...)`을 대본 모델로 실행하자 `ab/no.txt`가 생성됐다. 제품 모듈을 대역으로 바꾸지 않았다.
- 원인은 후보 `src/app/assemble.ts:60`의 `createPolicyGate({ config: task.policy, workspace })`에 `writablePathSets`가 없는 기존 누락이다. PM 지시대로 **건수 제외**. 실제 Electron 화면 조작은 하지 않았고, GUI가 사용하는 앱 실행 경로로 재현했다. 앱의 다른 실행·사전 점검 경로 전체를 재검증한 것은 아니다.
- 원문: R의 `supplement.mjs`, `supplement-results.json`, `cases/known-app-omission`의 CLI 출력 및 앱·CLI 두 run journal.

## 두 판 출력 비교

요청한 `scripts/compare-cli-boards.mjs`를 실행했다. 두 판을 archive로 풀어 각각 컴파일한 뒤 stdout·stderr·종료 코드·workspace와 실행 기록·모의 API 요청을 도구 규칙대로 정규화해 비교했다. 27개 시나리오, 508개 산출물 모두 같았다. 원문은 R의 `compare.md`.

시간·실행 ID·경로 등의 정규화 후 비교이므로 원시 바이트가 모두 같다는 뜻은 아니다. 터미널 사례는 `isTTY`를 흉내 낸 파이프이며 실제 콘솔은 아니다. 실행한 비교 스크립트의 Git blob은 `9bc7ff813033c667b26f8eb892907d984140c7a2`로 후보의 같은 파일과 일치했다.

## 실행 명령과 보존 자료

관리 저장소를 명시한 읽기 전용 Git 명령:

```powershell
git -C D:/project/Codaryn status --short
git -C D:/project/Codaryn branch --show-current
git -C D:/project/Codaryn rev-parse --show-toplevel
git -C D:/project/Codaryn rev-parse 21107dc f5b0968
git -C D:/project/Codaryn diff 21107dc...f5b0968 -- src
```

실험 루트를 새로 만든 뒤 TEMP/TMP를 R/tmp로 정하고 관리 저장소에서:

```powershell
node D:/project/Codaryn/scripts/compare-cli-boards.mjs --base 21107dc --head f5b0968 --work D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-v6-f5b0968/compare --out D:/project/Codaryn/.worktrees/codex-verify/.codaryn/codex-probe-v6-f5b0968/compare.md --keep
```

비교 도구 내부의 각 판 준비 명령은 `git -C D:/project/Codaryn archive --format=tar <전체 해시>` → 새 사본에서 `tar -x -f -` → `node <사본>/node_modules/typescript/bin/tsc -p tsconfig.json`이다. 빌드 동안만 사본의 node_modules를 기존 설치본에 연결하고 연결을 제거한다. 의존성을 설치하거나 다운로드하지 않았다.

R에서:

```powershell
node ./probe.mjs
node ./run-tests.mjs
node ./supplement.mjs
node ./quick.mjs
```

- `run-tests.mjs`가 후보 사본에서 실행한 것은 `node --import <R/cleanup-guard.mjs의 file URL> --test --test-concurrency=1 --test-reporter=tap`과 아래 8개 컴파일된 시험 파일뿐이다. 정확한 절대 Node 경로·인자·cwd는 `test-command.json`에 있다.
  - `cli/g-u182-writable-paths`, `cli/g-workflows`, `cli/g-u177-plan-run-refused`
  - `policy/u175-path-set`, `policy/u175-writable-gate`, `policy/u175-v3-allow-unchecked`
  - `contracts/g-u170-writable-paths`, `i18n/u175-path-not-writable-texts`
- `unit-tests.tap`, `unit-tests.stderr`, `test-result.json` 보존. 전체 시험 묶음은 실행하지 않았다.
- 탐침은 허용한 환경 변수만 자식 CLI에 전달하고 키 파일과 실제 API를 사용하지 않는다. 간편 실행은 합성 인증 값과 `127.0.0.1`의 모의 서버만 사용했다.
- 원문 입력·stdout·stderr·journal·결과 JSON은 R에 보존했다. 탐침은 기존 사례 폴더가 있으면 덮어쓰지 않고 중단한다. 전체 재실행은 새 `codex-probe-*` 루트에 동일 두 판을 archive로 준비하고 검증 스크립트를 복사하여 수행한다.
- 준비 중 검증 코드 오류: supplement의 닫는 중괄호 누락으로 구문 오류 1회. 제품을 실행하기 전 실패했으며 검증 스크립트만 고친 뒤 21건의 최종 수치를 얻었다. 제품 결함에 포함하지 않았다. 존재하지 않는 추정 시험 파일 조회 및 Windows rg 파일 glob 조회 실패는 실행 시험으로 세지 않았다.

## 범위와 제한

- 저장소 추적 파일 수정 0, 커밋 0, 푸시 0, worktree 추가 0. 시작·종료 `git status --short`의 변경 출력은 없었다. 새 파일은 R의 실험 자료와 이 보고서다.
- 실제 API 호출 0, 외부 네트워크 호출 0, 키 파일 조회 0, 권한·한도·크레딧 승인 요청 0. Git 전역 ignore 읽기 권한 경고는 있었지만 권한 상승을 요청하지 않았다.
- 미실행: 전체 유닛·통합 묶음, 실제 Anthropic/OpenAI, 실제 Electron UI·터미널, Linux/macOS, FAT/exFAT, OS 권한 경쟁·실제 8.3 별칭·정션 바꿔치기 공격. 이 범위의 정확성이나 보안을 보증하지 않는다.
- PM 판단 사항: U-182 CLI 범위에서는 새 차단 결함을 찾지 못했다. 앱 계층 연결과 `plan: "run"` 후속 단위를 이번 검증 완료에 포함하면 안 된다.
