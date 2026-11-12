# R-33 병합 전 보안 검토: DR-38 기록 변조 감지 (w3:p4, 2026-11-12)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어(보안 검토). 읽기 전용이며 파일 수정·커밋은 없다.
- **고정 판: `pm/bundle-6` = `05f3b7c`**(main `23daf6b`에 9개 브랜치를 합친 것). 시간 비교에는 main `23daf6b`를 썼다.
- 읽은 곳
  - `src/store/state-guard.ts`: `createRunRecorders`, `createApplyRecorders`, 지문 두 층, 노트, 임시 이름 규칙
  - `src/contracts/state.ts`
  - `src/engine/index.ts:495-550`(`checkState`)과 `:895-906`(명령 창)
  - `src/engine/apply.ts`
  - `src/store/changes.ts:630-662`(`readRunOriginals`)
  - `src/app/changes.ts:140-170`(`changeShownMatches`)
  - `src/cli/progress.ts`, `src/cli/human/output.ts`, `src/cli/report.ts`
  - `docs/cli-contract.md` 18.12, `src/tools/command-runner.ts:17-39`
- 사본: `.codaryn/r33/b`(`git archive 05f3b7c`), `.codaryn/r33/m`(`git archive 23daf6b`)
  - 둘 다 `npm run build` 성공. 루트 `node_modules`는 내 작업 트리로 정션.
  - GUI는 `.worktrees/claude-gui/gui/node_modules`(이미 설치된 Electron)로 정션했다. 새로 내려받은 것은 없다.
- 실험: `.codaryn/r33/r33.mjs`(T, F, P, L), `r33b.mjs`(S, X), `A.mjs`. 로그는 `.codaryn/r33/*.log`.
  - 모두 실제 CLI에 실제 task·대본 파일을 준 대본(scripted) 실행이다. 주소는 하나도 쓰지 않았다.
  - 변조는 정책이 허용한 `node <script>` 명령이 했다. 이 명령은 실행 중인 실행의 폴더를 직접 고르거나(`result.json`이 아직 없는 폴더), 부모가 넘긴 폴더를 쓴다.
- 가짜 비밀은 환경 변수 하나로 등록했다. 키 모양이 아닌 영숫자이고, 보고서에는 값을 적지 않는다.

심각도: 높음, 중간(재현되는 결정 위반, 선행 조건 있음), 낮음, 정보.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 3 (R33-L1~L3) |
| 정보 | 5 (R33-I1~I5) |

- **R33-L1** 실행이 남긴 자식이 실행이 끝난 뒤 `shown`을 고치면 감지되지 않는다. 그러면 `changes`가 가린 글을 보인다. DR-37 (b)는 실행 창 안에서만 닫혔다.
- **R33-L2** "확인하지 못함"과 기록 변경 표시가 사람용 출력에 거의 닿지 않는다. `report`만 말한다.
- **R33-L3** 적용(`apply`)은 표시가 있는 계획 실행을 아무 말 없이 실행한다.

| 중점 | 결과 |
| --- | --- |
| (1) 감지를 빠져나가는 변조 | **실행 중 실행 자신의 기록 변조는 모두 그 명령 바로 뒤(`after_command`)에 잡혔다.** journal 덧붙이기, 같은 크기로 고치고 수정 시각 되돌리기, `shown` 고치기, 2만 개 넘는 파일 만들기가 그렇다. 다른 실행의 기록 변조·삭제는 `before_verify`에 잡혔다(설계대로 `state` 층은 검증 회차와 끝에만 본다). |
| | 빠져나간 것은 셋이다. |
| | - 한 창 안에서 고쳤다가 되돌리기, 이름 바꿨다가 되돌리기(R33-I1) |
| | - 임시 이름을 흉내 낸 새 파일(R33-I2) |
| | - **실행이 끝난 뒤 남은 자식이 고친 것(R33-L1)** |
| (2) 거짓 감지 | **없다.** 실행 중에 다음을 돌려도 실행은 `done`/`verified`로 끝났고 변화 기록도 없었다. |
| | - 두 번째 `codaryn run`(`workspace_locked`) |
| | - `runs`, `report`, `changes`, `revert --dry-run` |
| | - `revert`(`workspace_locked`로 거절) |
| | 폐기가 든 적용도 `done`/`verified`이고 변화가 없었다(R33-I5) |
| (3) 표시가 있는 실행의 뒤처리 | **실행 중 변조는 닫혔다.** 실행 중에 `shown`을 고치면 표시가 붙고, `changes`는 비밀을 등록했든 안 했든 글을 보이지 않는다. 되돌리기는 막지 않고 JSON에 `recordsChanged: true`를 싣는다(결정대로). |
| | **실행 뒤 남은 자식이 고치면 열려 있다**(R33-L1). 비밀을 등록하지 않은 `changes --json`이 비밀이 든 원문을 보였다. |
| | **적용은 표시를 보지 않는다**(R33-L3) |
| (4) 시간과 상한 | **실행 500개에서 실행 한 번이 약 1.27초다**(main 0.20초, 대본 실행에 명령 3개). |
| | - `run` 층은 상한을 넘으면 실패로 닫힌다: 자기 폴더에 2만 100개를 만들자 `failed`/`state_changed`. |
| | - `state` 층은 결정대로 계속한다: 항목 2만 개를 넘으면 끊긴 뒤쪽은 비교하지 않는다. 그 뒤쪽 다른 실행의 `result.json`을 명령이 고쳐도 `done`/`verified`였다. 사람에게는 아무 말이 없다(R33-L2, I3) |
| (5) GUI | **유닛 `npm test` 135건 중 135 통과**, 실패·건너뜀·todo 0. **연기 시험 두 번 모두 132건 중 132 통과**, 앱 종료 0 |

## 2. 변조 실험(T)

각 경우는 새 작업 공간에서 했다. 먼저 실행 하나를 끝내 두고, 두 번째 실행이 `write_file` → 허용 명령(변조) → 끝내기 순서로 갔다. 뒤 네 열은 그 실행의 보기 결과다.

| 변조(명령이 함) | 결과 | 감지 위치 | `runs` 표시 | `report` | `changes` | `revert --dry-run` |
| --- | --- | --- | --- | --- | --- | --- |
| 없음 | `done`/`verified` | 없음 | 없음 | 표시 없음 | 글 보임 | `complete` |
| 자기 journal에 한 줄 덧붙임 | `failed`/`state_changed` | `after_command` | 있음 | `invalid_run_record` | `invalid_run_record` | `invalid_run_record` |
| 자기 journal 같은 크기로 고치고 수정 시각 되돌림 | 같음 | `after_command` | 상태 `damaged` | 같음 | 같음 | 같음 |
| 고쳤다가 같은 명령 안에서 되돌림(시각도) | `done`/`verified` | 없음 | 없음 | 표시 없음 | 글 보임 | `complete` |
| 이름을 `.<16 hex>.tmp`로 바꿨다가 되돌림 | `done`/`verified` | 없음 | 없음 | 표시 없음 | 글 보임 | `complete` |
| 자기 폴더에 `.<16 hex>.tmp` 새 파일 | `done`/`verified` | 없음 | 없음 | 표시 없음 | 글 보임 | `complete` |
| 자기 `snapshots/shown-0.json` 한 글자 | `failed`/`state_changed` | `after_command` | 있음 | 표시 줄 | **글 없음** | `complete`, 표시 있음 |
| 앞 실행의 journal 같은 크기로 고침 | `failed`/`state_changed` | `before_verify` | 있음 | 표시 줄 | 글 없음 | `complete`, 표시 있음 |
| 앞 실행의 `snapshots/index.json` 삭제 | `failed`/`state_changed` | `before_verify` | 있음 | 표시 줄 | 글 없음 | `complete`, 표시 있음 |
| 떨어진 자식(3초 뒤 `shown` 한 글자) | `done`/`verified` | 없음(실행은 0.2초에 끝남) | 없음 | 표시 없음 | 4초 뒤 글 없음(다이제스트 불일치) | `complete` |
| 자기 폴더에 파일 20,100개 | `failed`/`state_changed`(5초) | `after_command`, 경로 20,101개 | 있음 | | | |

- 앞 실행을 고친 경우에는 앞 실행에도 표시가 붙었다(`markRecordsChanged`가 그 실행 폴더에 씀).
- journal을 고친 경우 보기들이 `invalid_run_record`로 거절한다. journal 자체의 검사가 먼저 걸리기 때문이다.

## 3. 낮음

### R33-L1 실행이 남긴 자식이 실행 끝 뒤에 `shown`을 고치면 감지되지 않고, `changes`가 가린 글을 보인다

- 위치
  - 엔진의 마지막 점검은 `run_end`다(`src/engine/index.ts:547-549`).
  - 명령 실행기는 떨어진 자식(detached, `start /b`)을 끝내지 않는다. 문서에도 "They can outlive the run and the CLI"라고 적혀 있다(`src/tools/command-runner.ts:28`).
  - 계약 머리말(`src/contracts/state.ts:5`)은 기록을 쓸 수 있는 것으로 "a command the policy allows, a command verifier, or a child they leave running"을 든다. 그러나 남은 자식이 실행 끝 뒤에 쓰는 것은 잡을 자리가 없다.
- 재현(S, `r33b.mjs`)
  - `notes.md`의 둘째 줄에 등록한 비밀이 있다. 실행은 `write_file`(`replace_text`로 마지막 줄만 고침)을 한 뒤 허용 명령 `node rewrite.mjs late`를 돌린다.
  - 이 명령은 떨어진 자식을 띄우고 바로 끝난다. 자식은 2초 뒤 그 실행의 `shown-0.json`을 고친다: `original`과 `next.partsDigest`를 아무것도 가리지 않은 글의 다이제스트로 바꾼다. 자식은 작업 공간의 파일만 읽고 계산하며, 모델에게는 아무것도 보내지 않는다.

  | 경우 | 실행 결과 | 표시 | `changes`(비밀 등록) | `changes`(비밀 미등록) |
  | --- | --- | --- | --- | --- |
  | 고치지 않음 | `done`/`verified` | 없음 | 글 보임(가림) | 글 없음(`masking_unverified`) |
  | 명령이 바로 고침(`sync`) | `failed`/`state_changed`(`after_command`) | 있음 | 글 없음 | 글 없음 |
  | **떨어진 자식이 실행 뒤 고침(`late`)** | **`done`/`verified`** | **없음** | 글 없음 | **글 보임: JSON 출력에 비밀 원문이 있다** |

  - 사람용 `changes` 출력에는 비밀 줄이 나오지 않았다. 바뀐 줄만 보이기 때문으로 보인다. GUI의 변경 보기(앱 계층)는 돌리지 않았다.
- 판단
  - DR-38 결정이 약속한 창(명령·검증 회차 앞뒤, 실행 끝)은 지켜졌다. 그러니 결정 위반은 아니다.
  - 그러나 DR-37 (b)·R-24 L-1의 길이 **실행 자신의 허용 명령으로** 아직 열려 있다. 선행 조건은 세 가지다.
    - 정책이 자식을 띄울 수 있는 명령(예: `node` 아무 스크립트)을 허용한다.
    - 모델이 그 스크립트를 쓸 수 있다.
    - 사람이 뒤에 비밀을 등록하지 않은 채 `changes`를 본다.
- 권고(PM·store/엔진 담당 판단)
  - 명령이 끝날 때 그 명령의 프로세스 묶음을 끝낸다(Windows Job 개체, POSIX 프로세스 그룹·세션). 그러면 "남은 자식"이 없어진다.
  - 그게 어렵다면 계약 머리말의 "a child they leave running"에 "실행 끝 뒤에 쓰는 자식은 잡지 못한다"를 알려진 한계로 적는다.

### R33-L2 "확인하지 못함"과 기록 변경 표시가 사람용 출력에 거의 닿지 않는다

- 위치
  - 사람용 진행 렌더러(`src/cli/human/output.ts:273-347`)에는 `state_checked` 경우가 없어 `default`로 빠진다(줄 없음).
  - 카탈로그의 `progress.state_changed`·`progress.state_unchecked`(`src/i18n/en.ts:79-80`)는 어디서도 그려지지 않는다.
  - `src/cli/progress.ts:86-90`에 영어 줄이 있지만, 사람용 렌더러가 있을 때는 쓰이지 않는다(`src/cli/run.ts:776`).
  - `runs.records_changed`, `changes.records_changed`, `revert.records_changed`(`en.ts:104, 123, 125`)도 쓰는 곳이 없다. `report.records_changed`만 쓰인다(`src/cli/report.ts:456`).
- 재현
  - X(`r33b.mjs`): 앞 실행 폴더에 파일 20,500개가 있는 작업 공간에서 실행했다.
    - 네 점검이 모두 `limited`로 기록됐다.
    - 실행의 stderr와 `report` 사람용 출력에는 그 말이 없었다. `report`의 "Not checked"는 보호 경로 점검에 관한 줄이다.
    - 같은 실행의 명령이 끊긴 뒤쪽 다른 실행의 `result.json`을 고쳤지만 `done`/`verified`였다.
  - T `shown` 경우(표시가 있는 실행)
    - 사람용 `runs`와 `changes`에 표시 줄이 없었다.
    - `revert --dry-run`은 JSON의 `recordsChanged: true`만 있다(계약 18.12가 "사람용 줄은 렌더러(N-C) 몫"이라고 미뤄 둠).
    - `report`에는 표시 줄이 있다.
- 영향
  - 판정은 맞다(바뀌면 멈추고, 상한은 결정대로 계속한다). 그러나 사람은 실행 중이나 목록에서 "기록 일부를 확인하지 못했다"거나 "이 실행의 기록은 바뀌었다"는 것을 `report`를 열어야만 안다.
  - DR-38 "확인하지 못함을 기록한다"는 journal로 충족된다. 그러나 카탈로그에 준비된 글이 쓰이지 않는다(R31-L1과 같은 꼴).
- 권고(CLI 담당): `state_checked`(변화, `limited`)를 사람용 진행 줄로 그린다. `runs`·`changes`·`revert` 사람용 출력에 카탈로그의 표시 줄을 더한다.

### R33-L3 적용은 표시가 있는 계획 실행을 아무 말 없이 실행한다

- 위치
  - `src/cli/plan-commands.ts`, `src/engine/apply.ts`는 `recordsChanged`·표시 파일을 읽지 않는다.
  - 계약 18.12와 `src/contracts/state.ts:133-140`의 처리 목록에는 `changes`, `runs`, `report`, `revert`, `cleanup`만 있고 적용은 없다.
- 재현(A, `A.mjs`)
  1. 정리 예제로 계획 실행(`needs-input`/`plan_pending`)을 만들었다.
  2. 같은 작업 공간의 문서 실행에서 허용 명령이 그 계획 실행 폴더에 파일 하나를 더했다. 그 실행은 `failed`/`state_changed`로 끝났고, 계획 실행에 표시가 붙었다(`runs`의 `recordsChanged: true`).
  3. 그 계획 실행을 `apply --digest`로 적용했다. 결과는 `done`/`verified`였고 stderr에 표시에 관한 말은 없었다. 그 적용의 되돌리기도 `complete`였고 표시는 없었다.
- 영향
  - `--digest`가 계획 내용을 지키는 것은 사람이 변조 전에 다이제스트를 받아 둔 경우뿐이다.
  - 계획과 그 다이제스트가 함께 바뀐 뒤 `report`에서 다이제스트를 옮겨 적는다면, 표시 줄은 `report`에만 있다.
- 권고(PM 판단)
  - 표시가 있는 계획의 적용을 막는다.
  - 막지 않는다면 적어도 적용 출력과 GUI 승인 화면에 표시를 알린다.

## 4. 정보

- **R33-I1 한 창 안의 순변화 0은 보이지 않는다.** 고쳤다가 같은 명령 안에서 내용과 시각을 되돌리거나, 이름을 바꿨다가 되돌린 경우다.
  - 지문은 창의 앞뒤만 비교하므로 설계대로다.
  - 다만 실행 중에도 `report`·`changes`·`revert --dry-run`은 돌 수 있다(F). 그 창 안에서 사람이 본 것은 변조된 기록일 수 있다.
- **R33-I2 임시 이름 규칙**(`TRANSIENT_NAME`, `state-guard.ts:106`)**에 맞는 이름은 상태 디렉터리 어디서든 지문에 들지 않는다.**
  - 그래서 명령이 실행 폴더에 그런 이름의 파일을 남겨도 감지되지 않는다(T `hide`).
  - 그런 이름을 읽는 보기는 없다. 기록을 그 이름으로 옮기면 기록이 없어진 것으로 잡힌다.
- **R33-I3 `state` 층 항목 상한(20,000)은 작업 공간 크기로 닿는다.** 실행 하나가 폴더·journal·result·snapshots·index·shown으로 약 6항목이므로, 실행 약 3,300개에서 닿는다.
  - 끊긴 뒤쪽은 비교하지 않는다(결정대로 계속).
  - 실행 자신의 명령이 끊긴 앞쪽에 파일을 더해 끊는 자리를 당기면 그 파일들이 변화로 잡힌다. 그래서 상한을 일부러 일으키는 길은 보이지 않았다.
  - `run` 층은 상한이 없고 읽지 못하면 실패로 닫힌다. 2만 개를 만든 경우 `state_checked` 기록 하나에 경로 20,101개가 실렸다.
- **R33-I4 시간**(P, 실행 500개, 대본 실행에 명령 3개)

  | 판 | 1회 | 2회 |
  | --- | --- | --- |
  | 고정 판 | 1,262ms | 1,276ms |
  | main | 208ms | 199ms |

  - `state` 층을 네 번(시작, 검증 앞뒤, 끝) 걷는 몫이다.
  - 다른 실행의 journal은 해시하지 않는다(메타데이터만). 그래서 34 MiB journal에도 `limited`가 아니었다.
  - 다른 실행의 2 MiB 기록 파일은 `limited`가 되지만, 다른 경로의 변화는 그대로 잡혔다.
- **R33-I5 거짓 감지 없음**(F, L)
  - 느린 명령 중인 실행에 대해 두 번째 `codaryn run`, `runs`, `report`, `changes`, `revert --dry-run`, `revert`를 돌렸다. 실행은 `done`/`verified`였고 점검은 `run_start`와 `run_end`뿐이었다.
  - 폐기가 든 정리 적용도 `done`/`verified`였고 변화가 없었다. 그 되돌리기는 `complete`였다.

## 5. GUI(과제 5)

- `npm test`(빌드, `check-lock`, 유닛): 135건 중 135 통과
- `npm run test:smoke` 두 번: 각각 132건 중 132 통과, 앱 종료 0
- 로그: `.codaryn/r33/gui-unit.log`, `smoke-1.log`, `smoke-2.log`

## 6. 검사하지 않은 범위

- 앱 계층의 실행(`src/app/assemble.ts:71`의 `createRunRecorders`). CLI 경로만 돌렸다.
- GUI 변경 보기에서 R33-L1의 글이 보이는지
- 명령 검증기(`kind: command`)가 하는 변조. 검증 회차 앞뒤 점검이 있다.
- 적용 중 바깥 프로세스가 하는 변조(적용 자체에는 명령이 없다)
- macOS·Linux(POSIX 프로세스 그룹에서 남은 자식의 동작)

## 7. PM 판단 필요

- **Q-1(R33-L1)**: 명령이 끝날 때 프로세스 묶음 전체를 끝낼지, 남은 자식을 알려진 한계로 계약에 적을지.
- **Q-2(R33-L3)**: 표시가 있는 계획 실행의 적용을 막을지, 알리기만 할지.
- **Q-3(R33-L2)**: 사람용 표시 줄을 이번 병합 전에 넣을지.

사용자에게 물을 질문은 없다.
