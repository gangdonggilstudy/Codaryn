# V-34 — U-306 / C-7a 독립 검증

- 담당: codex-sec. 2026-11-14.
- 대상: `pm/unit-C7a`, `3ef9a59cd50a0a60e99222210bcf03eda358547c`. 기준: `601eabe4`.
- 사본: `.worktrees/codex-verify/.codaryn/v34/source`(대상), `v34/base-source`(기준). 두 판 모두 git archive로 추출했다.
- 범위: `git diff -M 601eabe4 3ef9a59cd50a0a60e99222210bcf03eda358547c -- src`의 9개 파일, 추가 734줄 / 삭제 608줄.
- **발견: 높음 0건 / 중간 0건 / 낮음 0건.** 아래 재현 범위에서 출력·거부·쓰기·잠금 순서의 회귀나 등록값의 비가림 노출을 발견하지 못했다.

## 실행 수치와 비교 방법

| 항목 | 결과 |
|---|---|
| 기준/대상 오프라인 설치 및 빌드 | 각각 성공, 종료 코드 0 |
| 관련 시험 5개 파일 | 35 통과, 실패 0, 건너뜀 0, 2,156.6806ms |
| 최종 실제 CLI 비교 | 50쌍, 100회 호출, 50쌍 일치 |
| 합성 실행·계획·적용 이력 준비 | 기준 CLI 4회 |
| 최종 비교기의 검사 묶음 | 15개 통과 |
| 대상 CLI 파일 접근 추적 | 1,462개 사건 |
| 실제 review 기록 변경 사례 | 13개, 모두 잠금 아래 기록 |
| 독립 프로세스 모듈 로드 | 기준 3회 + 대상 5회, 모두 종료 코드 0 |

대본 모델은 `scripted` 제공자이며 도구 입력·파일·등록값·키 모양 문자열은 모두 합성했다. 자식 CLI에는 필요한 Windows 환경, 언어, 임시 경로, 합성 등록값만 전달했다. 실제 API 키 환경이나 키 파일을 사용하지 않았다. 네트워크는 사용하지 않았고 작업 정책도 `network: deny`였다.

기준 CLI로 만든 동일한 실행 이력을 각 판의 별도 디렉터리에 복제했다. `stdout`, `stderr`, 종료 코드, 작업 공간 전체의 변경 파일·내용·삭제·생성 디렉터리를 비교했다. 시각, 새 apply 실행 ID, 소요 시간, 사본 절대 경로는 정규화했다. 무작위 가림 토큰은 응답과 기록 전체에 걸쳐 일대일 대응시켜 동일 토큰의 재사용 관계를 유지했다. 따라서 **정규화 후 일치**이며 원시 바이트 전체가 같다는 뜻은 아니다. 원시 출력도 보존했다.

`audited/results.json`의 초기 `equal` 값은 가림 토큰 대응 전 값이다. 최종 판정은 `checked.json`과 `checked.log`이다. 예비 배치 100회 + 준비 4회는 최종 100회에 중복 산입하지 않았다. 준비 중 Windows import URL과 합성 config 형식 오류 2회는 검증기에서 수정했으며 제품 실패로 계산하지 않았다.

## 사례별 재현과 근거

아래 `src/...:줄`은 대상 커밋 기준이다. 자동 재현 입력과 명령 전체는 `v34/probe-v34.mjs`, 각 호출의 원시 결과는 `v34/audited/cases/<사례>/<base|head>/audit.json`에 있다.

| 재현 | 관찰 결과 | 근거 |
|---|---|---|
| 등록값을 이름에 포함한 파일의 이동 계획을 만들고 `plan --task task.json --config config.json --run <id>` 실행. ko/en × text/JSON | 경로와 요약에서 등록값이 가려짐. 두 판의 출력·종료·쓰기 일치 | `src/app/plan-view.ts:268`, `:294`, `:343`, `:436`; `src/cli/plan-commands.ts:280` |
| 같은 계획을 `--workspace ws` 간단 형식으로 표시. ko/en × text/JSON | `plan_secrets_differ`, 등록값 노출·파일 변경 없음 | `src/app/plan-view.ts:179`, `:294` |
| 실행 폴더에 내용이 유효 JSON이 아닌 `records-changed.json` 생성 후 표시. ko/en × text/JSON | 표시 자체는 성공, JSON의 `recordsChanged: true`, 요약 제외. 경고/출력 동일 | `src/app/plan-view.ts:318`, `:458` |
| `--run latest`, 키 모양 ID, `../outside`, 대소문자가 다른 ID, 없는 ID, 실제 `runs/latest` 폴더 | latest 해석·안내 동일. 잘못된 참조는 거부, 파일 변경 없음 | `src/app/input/run-ref.ts:73`; `src/app/plan-view.ts:189` |
| `review --accept/--reject --note ...`; 등록값과 제어 문자 포함. ko/en × text/JSON | 판정·안내·종료 코드 동일. 변경은 해당 `review.json` 하나, note 가림/정리 유지 | `src/app/plan-view.ts:481`, `:499`, `:513`; `src/cli/plan-commands.ts:794` |
| 기존 accepted 기록을 둔 뒤 reject | `replaced` 판정 동일. 기존 기록 재읽기와 교체 쓰기가 잠금 안에 있음 | `src/app/plan-view.ts:508`, `:512`, `:513`, `:524` |
| 키 모양 note; 별도로 없는 task + 점유 잠금까지 겹침 | `key_in_file` 우선. 작업 공간 접근 추적 0, 파일 변경 0 | `src/app/plan-view.ts:488`, `:491`, `:494` |
| apply에 틀린 digest / 이미 적용 / 기록 변경 / 다른 살아 있는 프로세스의 잠금 | 오류 코드, stdout/stderr, 종료 코드, 최종 파일 상태 모두 기준과 동일 | `src/cli/plan-commands.ts:316`, `:359`, `:430` |
| 정상 apply 추가 대조 | 파일 이동과 적용 기록 동일. 잠금 아래 records-changed 재검사가 사용자 파일 이동보다 앞섬 | `src/cli/plan-commands.ts:503`; `src/engine/apply.ts:365` |

복합 실패의 우선순위도 재현했다.

| 동시 조건 | 두 판의 결과 |
|---|---|
| 등록값 설정 불일치 + 틀린 digest | `plan_secrets_differ` |
| 이미 적용 + 기록 변경 + 틀린 digest | `plan_already_applied` |
| 기록 변경 + 틀린 digest | `plan_records_changed` |
| 틀린 digest + 잠금 점유 | `plan_not_approved` |
| 키 모양 note + 없는 task + 잠금 점유 | `key_in_file` |

이 조기 거부 사례들은 파일 쓰기 시도도 0이었다. 정상 review의 기록 쓰기 13건과 정상 apply의 사용자 파일·실행 기록 쓰기는 자기 프로세스의 잠금 아래였다. 점유 잠금 거부는 실행 기록이나 기존 잠금을 변경하지 않았다. 잠금 획득 과정의 임시 파일과 `.codaryn/.gitignore` 쓰기 시도는 잠금 획득 전에 존재하므로, 모든 종류의 쓰기가 잠금 아래라고 판정하지는 않았다. 이것도 기준과 동일했고 해당 거부 사례의 최종 바이트 변경은 없었다.

`audit-fs.mjs`로 실제 CLI의 파일 읽기·상태 확인·쓰기·이름 변경·링크·삭제를 관찰하고 당시 잠금 소유 PID를 확인했다. 임시 파일명·PID·실행 ID를 대응시킨 **50쌍 전부에서 관찰된 파일 접근 순서도 동일**했다. 이 범위에서 검사가 쓰기 뒤로 이동하거나 잠금 밖으로 이동한 사례는 없었다.

## 이동 코드와 모듈 로드

- 이동한 helper 13개를 포함한 함수 본문 27개가 빌드된 JavaScript의 본문 문자열 비교에서 동일했다. `loadShown`, `planRunMarked`, `planSummary`, `awaitingReview`, `runApply`, `applyChangesPlan`을 포함한다. 원문 diff도 검토했다.
- run resolver는 상대 import 경로와 줄바꿈을 대응시키면 소스 전체가 동일했다. 이전 위치의 re-export와 새 위치가 같은 함수 객체를 제공함을 확인했다. 근거: `src/cli/run-ref.ts:1`, `src/app/input/run-ref.ts:73`.
- 변경 전체가 단순한 텍스트 이동인 것은 아니다. `runPlan`/`runReview`는 새 반환 계약에 맞게 wrapper로 바뀌었다. 일반 계획의 JSON 출력에서는 사용하지 않는 `knownKeyValues` 계산이 생략되고, review에서는 wrapper와 앱 함수에서 각각 계산된다. 고정된 실제 CLI 환경에서 출력·검사·쓰기 차이는 없었다. 근거: `src/cli/plan-commands.ts:280`, `:798`; `src/app/plan-view.ts:488`.
- 정적 import/re-export 그래프는 기준 182개 → 대상 185개 모듈. 순환 성분은 양쪽 모두 기존 `store/lock.js`, `store/review.js`, `store/runs.js`의 1개뿐이었다. 새 순환은 없었다. 앱에서 CLI 표시 helper를 참조하는 의존성은 남아 있지만 새 순환을 만들지 않았다.
- 기준은 `cli/plan-commands`, `cli/run-ref`, `app/index`, 대상은 이 세 곳과 `app/plan-view`, `app/input/run-ref`를 각각 첫 import로 하는 새 프로세스에서 로드했다. 8회 모두 성공했다. 근거 자료: `v34/static.json`, 재현기 `v34/static-v34.mjs`.

## 실행 명령과 재실행

저장소 루트에서 판과 변경을 읽고 archive를 만들었다. 기존 worktree나 브랜치를 변경하지 않았다.

```powershell
git status --short
git branch --show-current
git rev-parse --show-toplevel
git diff -M 601eabe4 3ef9a59cd50a0a60e99222210bcf03eda358547c -- src
git diff -M --color-moved=plain --color-moved-ws=allow-indentation-change 601eabe4 3ef9a59cd50a0a60e99222210bcf03eda358547c -- src
```

`git archive --format=tar --output=<v34 내부 tar> <판>`으로 만든 두 tar를 각각 `source`, `base-source`에 풀었다. 로컬 npm 캐시에서 lockfile에 명시된 공개 패키지 4개(10,655,176바이트)만 사본 내부 캐시로 준비했다. 사용자/전역 npm 설정은 빈 파일로 대체하고 사본 안에서 다음 명령을 각각 실행했다.

```powershell
npm.cmd ci --offline
npm.cmd run build
```

대상 사본에서 TEMP/TMP를 `v34/test-tmp`로 지정하고 관련 시험만 실행했다.

```powershell
node --test dist/tests/integration/n09-plan-secrets.test.js dist/tests/unit/cli/g-u14-plan-view.test.js dist/tests/unit/cli/g-u1-apply-marked-plan.test.js dist/tests/unit/cli/g-u22-latest-every-command.test.js dist/tests/unit/app/plan-review.test.js
```

`v34`에서 최종 CLI 배치와 비교를 실행했다.

```powershell
$env:V34_BATCH='audited'
node probe-v34.mjs
node static-v34.mjs
node check-v34.mjs
```

`audited`는 보존된 결과이므로 같은 폴더에 배치를 덮어 실행하지 않는다. 새 재현은 아직 없는 `V34_BATCH` 이름을 사용하고, 새 결과 비교 시 사본의 비교기 `data` 경로도 그 이름으로 맞춘다. 보존 결과를 다시 확인하는 `node check-v34.mjs`는 그대로 실행할 수 있다.

실제 명령은 `node --import <audit-fs.mjs의 file URL> <각 판>/dist/src/cli/main.js ...`로 실행된다. 별도의 가짜 CLI나 출력 모의는 사용하지 않았다. 로그: `ci.log`, `base-ci.log`, `build.log`, `base-build.log`, `targeted-tests.log`, `audited-probe.log`, `checked.log`.

## 검증 한계와 작업 격리

전체 시험 묶음, 실제 API, 외부 네트워크, 실제 키, 권한 상승은 사용하지 않았다. 대화형 TTY 입력, 모든 파일 시스템 장애 주입, 모든 경쟁 실행 일정은 시험하지 않았다. 독립 CLI 배치는 이동 계획을 사용했으며 `kind: changes` 계획은 이동 helper의 본문 대조 범위다. 동적 import가 만들 수 있는 모든 잠재 경로에 대한 형식적 증명도 아니다.

원본 저장소의 시작·종료 상태는 `main`, `D:/project/Codaryn`, 추적 파일 변경 없음이었다. Git 전역 ignore 파일 접근 경고는 있었지만 상태 확인은 성공했다. 작성물은 지정된 v34 사본·합성 재현 자료와 이 보고서뿐이며 커밋·푸시·worktree 추가는 하지 않았다.
