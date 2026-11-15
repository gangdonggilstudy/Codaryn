# V-14 — B-4 끝에서 끝까지 정확성 검증

- 검증자: **codex-audit**, 검증 엔지니어 / 보안·개인정보 경계 검토.
- 대상: `pm/unit-B4b`, `fa492bee76be94ba3f3978b5b5b6636d7c399103`.
- 기준: main `c0afedb96e2e2b2fe4443d080a9056999a6f4017`. `git diff c0afedb fa492bee -- src`를 검토했다.
- 근거: DR-69, `docs/reviews/2026-11-13-p1-bundle-proposal.md` 4절 B-1~B-8 및 PM의 V-14 검사 항목.
- 환경: Windows / Node `v26.13.1`. 후보는 이 폴더의 `candidate/`에 `git archive`로 풀었다. 기존 로컬 개발 의존성을 복사해 빌드했으며 설치·다운로드하지 않았다.
- **높음 0건 / 중간 1건 / 낮음 1건.** 중간 건은 **계획 기록을 다른 작업 공간으로 복사한 조건**에서 재현했다. 기록 없는 다른 작업 공간에 실행 ID만 주는 일반 경로는 거부된다. 두 경우를 구분해야 한다.
- 저장소 수정·커밋·푸시·worktree 추가·권한 요청 없음. 관리 main의 마지막 `git status --short` 출력도 비어 있었다. 모든 생성물은 이 `codex-audit-v14-fa492bee/` 아래에 있다.

## M-1 — 계획 기록을 복사하면 다른 작업 공간에서도 원래 다이제스트로 실행된다

**심각도: 중간.** PM 검사 (2)의 ‘다른 작업 공간의 계획 거부’를 기록 복사까지 포함하면 충족하지 못한다. 기록 복제·이전의 의도된 의미에 대한 PM 판단도 필요하다.

- 관련 위치: `candidate/src/cli/plan-commands.ts:909`, `:950`, `:972`; 기반 계약·저장소 `candidate/src/contracts/plan.ts:494`, `candidate/src/store/plan.ts:325`.
- `StoredChangesPlan`에는 실행 ID, 상대 경로, 파일 해시, 요약이 있으나 원래 작업 공간 식별값이 없다. 로더는 현재 작업 공간 아래의 기록이 서로 맞는지 확인한다. 새 실행 경로도 계획이 생성된 작업 공간과 현재 작업 공간을 비교하지 않는다.
- **전제:** A에서 생성한 미적용 계획의 `.codaryn` 기록을 B로 복사한다. B에는 계획의 수정 대상과 같은 바이트가 있고, 생성 대상은 아직 없다. 계획 파일·다이제스트·저널 내부 필드는 변경하지 않았다. B를 가리키는 작업 파일과 A에서 받은 다이제스트 앞 12자로 `apply`한다.
- 실제 결과: 종료 **0**, `done/verified`, 모델 **3턴**, B의 파일 **2개 변경**. A의 `docs/guide.md`는 `old guide\n` 그대로이고, B에서는 `new guide\n`으로 바뀌며 `docs/new.md`가 생성됐다.
- 계획 실행 ID `20261113T090310Z-72411971`, B의 실행 ID `20261113T090310Z-d5ddb203`, 승인 접두사 `da4bdd468f0c`.
- 원문: `cases-2026-11-13T09-03-06-296Z/commands.json`의 `copy-source`와 `copy-target`; `findings-evidence.json`의 `copy`.

재현:

1. A와 B에 각각 `docs/guide.md = "old guide\n"`를 만든다. 둘 다 `docs/new.md`는 없다.
2. A에서 `plan: "run"` 작업으로 `run`하여 `docs/guide.md` 수정과 `docs/new.md` 생성을 제안한다.
3. A의 `.codaryn`을 B의 `.codaryn`으로 그대로 복사한다.
4. B의 작업 파일로 `node dist/src/cli/main.js apply --task <B/task.json> --config <B/config.json> --run <A의 계획 실행 ID> --digest <A의 다이제스트 앞 12자>`를 실행한다.
5. 거부 대신 B에서 계획이 실행된다. 자동 재현: 이 보고서 폴더에서 `node audit-v14.mjs "copied plan cannot target different workspace"`.

범위: **승인 없이 쓰거나 임의 작업 공간을 탐색하는 공격을 재현한 것은 아니다.** B를 명시한 승인 명령과 기록 복사가 모두 필요하다. 기록 없는 B에는 같은 ID와 다이제스트를 줘도 `run_not_found`, 모델 요청 0회, 사용자 파일 변경 0개였다. 현재 보호는 ‘현재 작업 공간에 일관된 계획 기록이 있음’이며, ‘원래 생성한 작업 공간임’까지 확인하지 않는다.

권고: V-14의 거부 요구에 복사한 기록도 포함한다면 계획 승인에 작업 공간을 묶고, 이동·복제된 기록의 재승인 방식을 정해야 한다. 기록의 휴대성을 의도한 것이라면 이 조건을 명시적인 한계로 판단·기록할 필요가 있다. 기반 저장 형식부터 있던 제약이며 B-4에서 처음 열린 실행 경로로 관찰했다.

## L-1 — 계획 밖 쓰기의 전용 거부 수가 끝 요약에 전달되지 않고 안내도 맞지 않는다

**심각도: 낮음.** 쓰기 차단은 정상이다. 사람용 출력의 연결 누락이다.

- 위치: `candidate/src/cli/run.ts:476`의 `summaryContext`, `:976`의 집계, `:1059`의 안내; `candidate/src/cli/human/output.ts:476`; `candidate/src/i18n/en.ts:59`, `:147`.
- `notes.deniedNotWritable`는 집계하지만 `summaryContext()`가 `RunSummaryContext.deniedNotWritable`로 전달하지 않는다. 렌더러의 새 전용 줄은 실제 CLI에서 나오지 않는다. 렌더러에 문맥을 직접 주는 유닛 시험은 통과하므로 프로세스 연결 시험이 필요하다.
- 재현 입력: 승인 목록은 `docs/guide.md`, `docs/new.md`. 실행 대본은 사용할 수 없는 `run_command` 1회, 목록 밖 파일 `not-approved.txt`와 `docs/guide.md.extra`에 쓰기 2회, 승인된 쓰기 2회, 완료 답변이다.
- 실제 결과: 종료 **0**, 승인 밖 쓰기 **2회 모두 거부**, 해당 파일 생성 **0개**. 끝 요약에는 `Denied calls: 3`만 있고 승인 밖 쓰기 2회를 별도로 보여 주는 줄이 없다.
- 끝 요약 바로 앞에는 `Writes denied because the file is not in writablePaths: 2. To allow a file, add it to writablePaths ...`가 나온다. 이 사례는 사용자 `writablePaths` 설정이 전혀 없고 **승인 계획의 정확한 파일 목록** 때문에 거부된 것이다. 설정 목록을 넓혀도 계획 목록과의 교집합 때문에 허용되지 않는다. 새 계획·새 승인이 필요한 경우에 맞지 않는 안내다.
- 원문: `cases-2026-11-13T09-03-06-296Z/commands.json`의 `mixed-denial/apply`; `findings-evidence.json`의 `mixed`.
- 자동 재현: `node audit-v14.mjs "specific write refusal count in mixed summary"`. 예상 전용 줄 검사가 실패한다.

일반 거부 합계가 사라지는 것은 아니다. 승인 밖 쓰기만 2회 있는 별도 사례에는 끝 요약 `Denied calls: 2`가 정상 표시된다. 낮음 건은 다른 거부와 섞였을 때의 전용 수치 누락과 계획 실행에 맞지 않는 해결 안내를 다룬다.

권고: 집계값을 끝 요약 문맥으로 연결하고, 계획 실행에서는 현재 계획의 승인 범위라는 점과 새 계획/승인이 필요하다는 점을 안내한다.

## 요청 항목별 결과

| 항목 | 실제 관찰 |
| --- | --- |
| (1) run → plan → digest 12자 승인 → 실행 | `plan_pending` → JSON/사람용 plan 보기 → `done/verified`. 계획과 실행 ID가 다르고 실행 결과의 `planRunId`, `planDigest`가 원래 계획과 일치 |
| 결과·runs·report·changes·revert | plan 상태 `applied`, `appliedBy.runId` 일치. runs와 양쪽 report에서 연결 확인. changes에 수정 1개·생성 1개의 전후 글과 `as_run_left` 표시. revert `complete`; 생성 파일 제거를 포함해 사용자 파일 전체 해시가 실행 전과 일치 |
| (2) 계획 생성 중 쓰기 | 수정·생성 쓰기 시도 2회 후 계획 제안. 사용자 파일 해시 변화 0, 계획 결과 `changes: []` |
| 승인 누락·틀린 다이제스트 | 둘 다 `plan_not_approved`, 종료 2. 추가 모델 요청 0, 사용자 파일 변화 0 |
| 없는 실행 | 유효한 형식의 미존재 ID `20261113T000000Z-00000000` 사용. `run_not_found`, 종료 2, 모델 요청·파일 변화 0 |
| 이미 적용된 계획 | `plan_already_applied`, 종료 2, 추가 모델 요청·파일 변화 0 |
| 다른 작업 공간 | 기록 없는 경우 정상 거부. 기록까지 복사한 경우는 M-1 |
| (3) 목록 밖 쓰기 | 유사 접두사를 포함한 2개 파일 모두 `path_not_writable`. 승인된 2개만 변경. 전체 거부 수는 정상; 전용 요약·안내는 L-1 |
| (4) stale 계획 | 수정 대상 바이트 변경 / 생성 대상 선점, 각각 `failed/plan_stale`, 종료 1. 두 실행 모두 `modelTurns: 0`, `toolCalls: 0`, `changes: []`. 저널의 추가 `model_request` 0회, 승인 명령 직전의 사용자 파일 해시 유지 |
| (5) 원래 goal | 계획 후 task의 goal을 다른 글로 바꿨음에도 실행의 첫 사용자 메시지는 원래 goal과 정확히 일치. 모델 요약은 system에 포함되며 goal을 대체하지 않음 |
| goal 기록을 없앰 | 저널 파일 전체 삭제와 첫 `model_request` 행만 삭제를 각각 실행. 모두 `invalid_run_record`, 종료 2, 추가 모델 요청·사용자 파일 변화 0. 두 번째는 ‘goal을 읽을 수 없음’ 전용 메시지도 확인 |
| (6) doctor | 명령 규칙 + plan run → `warn`, `doctor.commands.plan_run_with_commands`. writablePaths도 있으면 기존 경고와 추가 note가 함께 나옴. 명령 규칙 없음 → `skipped`. 허용 명령 자체는 실행하지 않음 |
| (7) 이동 계획 회귀 | 지정 비교 스크립트의 **27개 사례, 508개 정규화 비교 항목, 차이 0**, 종료 0. `plan-apply`, 터미널 승인/거절, 다른 task로 apply, report/revert 포함 |

정상 흐름 원문은 `cases-2026-11-13T09-03-06-296Z/results.json`의 `happy chain and original goal`과 같은 폴더 `commands.json`에 있다. 계획 ID `20261113T090306Z-dab21baa`, 실행 ID `20261113T090307Z-e9e0cc56`이다. goal 행 삭제 시험은 `cases-2026-11-13T09-04-20-913Z/`에 있다.

## 실행 명령과 수치

아래 명령은 전부 샌드박스 기본 권한으로 실행했다. `R`은 이 보고서가 있는 절대 경로다.

```text
git -c safe.directory=D:/project/Codaryn -C D:/project/Codaryn status --short
git -c safe.directory=D:/project/Codaryn -C D:/project/Codaryn branch --show-current
git -c safe.directory=D:/project/Codaryn -C D:/project/Codaryn rev-parse --show-toplevel
git -c safe.directory=D:/project/Codaryn -C D:/project/Codaryn archive --format=zip --output=<R>/candidate.zip fa492bee76be94ba3f3978b5b5b6636d7c399103
git -c safe.directory=D:/project/Codaryn -C D:/project/Codaryn diff c0afedb fa492bee -- src
npm.cmd run build                       [cwd: <R>/candidate]
node audit-v14.mjs                       [cwd: <R>]
node audit-v14.mjs "missing initial goal request refused"
node run-units.mjs
node run-compare.mjs
```

- 후보 루트 빌드: **종료 0**. 원문 `root-build.log`.
- 최종 판정용 독립 시나리오: **14개 중 기대 결과 일치 12 / 결함 재현 2**, 실제 CLI **39회** 호출(본 실행 37 + goal 행 삭제 2). 종료 1인 독립 검사기는 위 재현 2건을 실패로 남긴 결과이며 무시하지 않았다. 사용자 파일 비교는 `.codaryn` 상태 기록을 제외한 파일별 SHA-256으로 했다.
- 앞선 예비 실행도 **35회** 호출했고 `cases-2026-11-13T09-01-09-723Z/`에 보존했다. 최종 39회 수치에 중복 합산하지 않는다. 예비 실행의 미존재 ID는 형식부터 잘못되어 최종 실행에서 유효한 미존재 ID로 바로잡았다. 단순 거부 수와 전용 거부 수 검사를 분리하고 혼합 거부 대본을 추가했다. 제품 코드는 바꾸지 않았다.
- `commands.json`에는 실제 CLI의 모든 인자, 종료 코드, 시간, stdout/stderr가 있다. CLI 호출 형태는 `node --import <R>/offline-guard.mjs <R>/candidate/dist/src/cli/main.js ...`다. 독립 검사는 환경 변수 허용 목록만 넘기고 모든 네트워크 연결을 차단했다.
- 관련 유닛 **9개 파일 / 72개 시험 / 통과 72 / 실패 0 / 건너뜀 0**, 러너 시간 약 **502ms**. `unit-tests.log`, `unit-execution.json` 참조. `node --import <R>/offline-guard.mjs --test`에 다음 파일을 명시했다(모두 `candidate/dist/tests/unit/` 기준).

```text
cli/g-u195-apply-run-plan.test.js
cli/human/u198-carried-plan-texts.test.js
cli/human/u198-r103-summary-hidden.test.js
cli/human/u191-changes-plan-view.test.js
app/u196-changes-plan-app.test.js
app/u196-r103-l1-plan-kind.test.js
engine/u187-approved-plan-run.test.js
engine/u187-v11-retarget.test.js
store/u181-runs-carried-plan.test.js
```

비교 래퍼가 실행한 명령(cwd `D:/project/Codaryn`):

```text
node scripts/compare-cli-boards.mjs --base c0afedb --head fa492bee76be94ba3f3978b5b5b6636d7c399103 --work <R>/comparison --out <R>/cli-comparison.md --keep
```

- **종료 0 / 약 41.1초**, 결과 `cli-comparison.md`, 실행 인자·종료 수치 `compare-execution.json`. base/head도 스크립트가 `git archive`로 만든 사본이다.
- 삭제 대상 `comparison/base`, `comparison/head`, `comparison/case`가 모두 자기 실험 폴더의 자식임을 실행 전 확인했다. 사본 빌드 때만 기존 node_modules의 junction을 쓰고 스크립트가 해당 링크를 해제했다.
- 비교에는 대본 모델 외에 **127.0.0.1의 모의 API**를 쓰는 기존 사례가 있다. 실제 API가 아니다. 터미널 사례는 isTTY를 대체한 파이프 모의이며 실제 콘솔 검증이 아니다. 네트워크 가드 위반 0, 비교 차이 0.

## 미실행·판정 한계

- GUI/Electron 및 GUI 연기 시험, 전체 시험 묶음, 실제 API, 외부 네트워크, 실제 사용자 작업 공간은 시험하지 않았다. 키/키 파일을 조회하지 않았다.
- stale 시험은 계획 생성 뒤 파일을 바꾸고 승인 명령을 실행하여 모델 요청 전 중단을 확인했다. 모델 실행 도중의 모든 외부 파일 변경 시점을 망라한 경쟁 시험은 아니다.
- 독립 CLI 시험은 대본 모델이다. 실제 모델이 계획 설명을 얼마나 충실히 수행하는지는 판단하지 않는다. B-2대로 파일 범위와 해시의 검증이며 요약 의미를 강제하는 보장은 아니다.
- 채택·수정 여부는 PM 판단이다. M-1은 기록 복사 조건을 포함한 작업 공간 결합 요구를 확인해야 하고, L-1은 집계/안내 연결 수정이 필요하다.
