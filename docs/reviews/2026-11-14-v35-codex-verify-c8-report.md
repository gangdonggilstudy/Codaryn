# V-35 — U-311 / C-8 report 읽기·판정 이동

- 검증자: **codex-probe**, 읽기 전용 검증 엔지니어. Windows / Node v26.13.1.
- 기준 `c3c9b61e1bcec41ccdd3e34b79b80e2d296fa128` → 후보 `dd02351fd91af3d399007aeae38ed7660bb05138`.
- 시작·종료 시 `git rev-parse pm/unit-C8`가 후보와 일치했다. `git diff -M ... -- src`의 변경 파일은 app/report-read.ts와 cli/report.ts 2개다.
- **높음 0건 / 중간 0건 / 낮음 0건.** 검사한 입력에서 새로 허용하거나 더 노출하는 동작은 발견하지 못했다. **일반 symlink 생성 4개는 EPERM으로 미실행**이며 통과 수에 넣지 않았다.
- 사본·합성 자료·시험 코드: 사용자 지정 `.worktrees/codex-verify/.codaryn/v35/`. 저장소 파일 수정·커밋·푸시·worktree 추가 없음. 종료 시 관리용 저장소 `git status --short`는 비어 있었다.

| 검증 | 수치 | 결과 |
| --- | ---: | --- |
| git archive 사본 빌드 | 2판 | 종료 0; 기준 1,279ms / 후보 1,262ms |
| 이동 원문 | 367 + 176 + 18 = 561줄 | 세 블록 모두 바이트 동일 |
| runReport → readReport 판정 본문 | 1블록 | 인자 이름·오류 반환 포장·타입 표기 변경을 반영하면 원문 동일 |
| 남은 렌더링·출력 처리 | 2구간 + 함수 끝부분 | 원문 동일; report.ts 1,186 → 439줄 확인 |
| 대본 실행으로 기록 생성 | 12프로세스 | 정상·거부 포함·취소·비밀값·계획·적용을 각 판에서 생성 |
| 실제 report CLI | 49사례 × 2형식 × 2언어 = **196쌍 / 392프로세스** | stdout·stderr·종료 코드 차이 **0**, 정규화 없음 |
| 합성 비밀값·외부 기록 표식·키 모양 출력 | 전체 비교 | 노출 **0** |
| 실패 주입 | 4쌍 / 8회 | 결과와 호출 순서 동일 |
| 모듈 로드 | 후보 6순서 + 기준 6대조 프로세스 | 바인딩·재수출·호출 오류 0 |
| 후보 관련 기존 시험 | 7파일, 38시험 | 통과 38 / 실패·건너뜀 0; 12,429ms |

## 실제 CLI 비교

각 판의 실제 CLI와 scripted 모델로 기록을 만든 뒤, **동일한 작업 공간·동일한 기록을 기준/후보 report가 각각 읽게 했다.** 두 실행에 같은 `CODARYN_LANG=en/ko`와 text/`--json`을 적용했다. 실행 ID·시각·기간을 포함한 stdout 및 stderr도 그대로 비교했다. 아래 건수는 출력 비교 쌍이며 각 쌍에 CLI 프로세스 2개가 있다.

| 사례 | 비교 쌍 | 양쪽 관찰 결과 |
| --- | ---: | --- |
| 정상, 거부 포함, 취소, 비밀값 포함, 적용 전/후 계획, 적용 실행, latest | 96 | `complete`, report 종료 0; 결과·거부 수·계획 적용 표시·latest 안내 동일 |
| result/journal: 절단, 비JSON, 내부 runId 불일치 | 24 | `invalid_run_record`, 종료 2 |
| result/journal 자리를 일반 폴더로 교체 | 8 | `invalid_run_record`, 종료 2 |
| run 폴더를 다른 폴더로 향하는 실제 정션으로 교체 | 4 | `invalid_run_record`, 종료 2; 대상 기록의 합성 표식 미노출 |
| result/journal 자리를 외부 폴더 정션으로 교체 | 8 | `invalid_run_record`, 종료 2 |
| journal/result 각각 상한 초과 | 8 | 268,435,457바이트(256 MiB + 1), `invalid_run_record`, 종료 2 |
| result 없음 / journal 없음 | 8 | 각각 `incomplete`/3, `invalid_run_record`/2 |
| records-changed: 파일, 비JSON 파일, 폴더, 끊긴 정션 | 16 | 보고서는 유지, JSON `recordsChanged:true`; text 경고도 동일 |
| mark+손상 result / journal 없음+손상 result | 8 | 둘 다 `invalid_run_record`, 종료 2 |
| 위험 run ID, 키 모양 run ID, 위험 ID+없는 workspace, 없는 workspace | 16 | 각각 `invalid_arguments`, `run_not_found`, `invalid_arguments`, `workspace_not_found`; 모두 종료 2, 입력 값 미노출 |
| **합계** | **196** | **차이 0** |

거부 포함 실행은 실제 `tool_decision allowed:false` 2건을 생성했다. 취소 실행은 실제 `cancelled`/종료 5였으며, 그 기록을 읽는 report의 종료 코드는 양쪽 모두 0이었다. 계획 실행은 `plan_pending`/3, 적용 실행은 `done`/0이었다. 원래 실행의 성공 여부와 report 명령의 성공을 구분했다.

비밀값 시험은 `V35_SECRET_ENV`에 등록한 **합성 일반 문자열**을 실제 파일명과 대본의 마지막 메시지에 넣었다. 양쪽 실행 모두 실제 파일을 생성했고, result의 변경 경로와 finalMessage가 존재하며 가림 토큰을 담는 것까지 확인했다. report에는 해당 환경 변수를 넘기지 않아도 저장된 가림이 유지됐다. 일반 등록값과 키 모양의 탐지를 같은 것으로 집계하지 않았다.

키 모양 run ID는 양쪽 모두 경로 성분으로는 안전한 문자열로 처리한 뒤 해당 기록이 없어 `run_not_found`가 됐다. journal만 지운 사례는 앞선 손상 검사에서 `invalid_run_record`가 됐다. 이 관찰을 임의로 `invalid_arguments` 또는 `run_not_found`로 바꾸어 보고하지 않았다.

## 안전 판정·검사 순서·파일 위치

- **원문:** 기준 `src/cli/report.ts:106`, `:714`, `:1023`의 367·176·18줄이 후보 `src/app/report-read.ts:97`, `:466`, `:642`에 그대로 있다. 파일 상태 판정의 256 MiB 상한과 읽은 뒤 크기 재검사도 동일하다(`src/app/report-read.ts:644`, `:655`).
- **판정 순서:** 후보 `src/cli/report.ts:414`에서 인자 파싱 후 `:420`의 readReport를 호출한다. 이어 `src/app/report-read.ts:690` 경로 검사 → `:701` run 참조 → `:710` 손상 검사 → `:735` 정션/링크 실경로 검사 → `:743` 변경 표식 → `:750` 파일 상태·크기 → 저널/결과 검증 순서가 기준과 같다. runReport의 판정 본문을 인자명과 `{ok:false,outcome}` 반환 포장만 치환해 대조했다.
- **실패 시 처리:** 실제 mark의 비JSON·폴더·끊긴 정션도 `recordsChanged:true`였다. 별도 함수 경계 실패 주입에서 `isDamaged` 예외는 거부, `hasRecordsChangedMark` 예외는 표시 유지였다. 손상 판정이 true/예외이면 mark 판정과 latest 안내를 호출하지 않았다. 4쌍의 결과·호출 순서가 동일했다. 이는 실제 OS 권한 실패 재현과 구분한다.
- **가림:** 후보 `src/cli/report.ts:424`, `:429`, `:438`의 현재 키 수집, JSON 문자열 가림, 최종 hideKeys가 그대로 남았다. text 렌더링도 동일하다. 등록값은 실행 중 가린 기록을 읽는 기존 구조다. 이번 이동 때문에 기록에 원래 없던 비밀값을 복원하거나 재조회하는 경로는 발견하지 못했다. 변조된 임의 기록의 모든 문자열을 과거 secretEnv에 맞추어 다시 가린다고 주장하는 결과는 아니다.
- **모듈:** 후보 `src/cli/report.ts:29`, `:33`에서 새 읽기 모듈을 import/재수출하고, `src/app/app.ts:63`, `src/app/run-events.ts:57`의 이전 CLI 경로도 정상 동작한다. 정적 JS 그래프는 기준 168모듈·625간선, 후보 169모듈·629간선. 양쪽의 유일한 순환 묶음은 기존 store/lock·review·runs이고 **새 순환 없음**. report-read에서 CLI로 이어지는 정적 의존 경로는 0개다. 후보 report-read → cli/report → app/index의 6가지 로드 순서에서 재수출 5함수의 신원과 실제 오류 경로 호출을 확인했다.

판정: 검사한 정션·손상·크기 초과 입력은 후보에서도 거부됐고, 비교한 출력의 허용 범위나 가림은 넓어지지 않았다. 기록 내용이 반환되지 않았다는 실행 관찰과 원문·검사 순서 대조를 근거로 한다. 모든 가능한 동시 파일 바꿔치기나 운영체제 상태를 증명한 것은 아니다.

## 미실행·재현 자료

- 일반 symlink 4개: result 파일, journal 파일, run 폴더, 끊긴 mark 파일. 생성이 `EPERM`으로 거부됐다. 권한 상승은 요청하지 않았다. **실제 정션 시험은 수행했으며 위 표에 별도로 집계했다.**
- 실제 API, 외부 네트워크, 실제 키/키 파일 조회, 전체 시험 묶음은 수행하지 않았다. CLI 네트워크 가드 기록은 모두 비어 있었다.
- 정확한 입력·argv와 원본 출력: [v35/cli-compare.mjs](v35/cli-compare.mjs), `v35/artifacts/`, [v35/boundary-results.json](v35/boundary-results.json). 후자는 실제 정션 CLI 12쌍과 경계 실패 주입 4쌍을 구분한다.
- 집계: [v35/validated-results.json](v35/validated-results.json), [v35/source-results.json](v35/source-results.json), [v35/module-results.json](v35/module-results.json), `v35/unit-tests.tap`, `v35/skips.json`.

실행 cwd는 `D:/project/Codaryn`. 아래 R은 `.worktrees/codex-verify/.codaryn/v35`이다.

```text
git rev-parse pm/unit-C8 c3c9b61e
git diff -M c3c9b61e dd02351fd91af3d399007aeae38ed7660bb05138 -- src
node R/setup.mjs
node R/source-audit.mjs
node R/cli-compare.mjs
node R/boundary-probe.mjs
node R/validate-results.mjs
node R/module-audit.mjs
node R/test-runner.mjs
git status --short
```

archive·빌드의 실제 명령과 시간은 `v35/setup-results.json`에 있다. 생성기는 기존 실험 폴더를 덮어쓰지 않도록 새 폴더를 요구한다. 기존 관련 시험은 후보의 cli/g-report, g-report-kinds, g-report-apply, g-u25-report-masking, g-u46-report-cause, k-report-doctor 및 app/report-markdown만 `node --test --test-concurrency=1`로 실행했다. 정확한 인자는 `v35/test-command.json`에 남겼다.
