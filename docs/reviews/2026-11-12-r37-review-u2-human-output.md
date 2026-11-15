# R-37 병합 전 검토: 단위 U-2 사람용 출력 세 줄 (w3:p4, 2026-11-12)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어(보안 검토). 읽기 전용이며 파일 수정·커밋은 없다.
- **검토한 판: `unit/U-2-nc-human` = `b9ac42e`**(main `6df2eae` 위의 커밋 하나). 비교판은 main `6df2eae`.
  - 바뀐 제품 코드는 `src/cli/human/output.ts` 18줄이다. 나머지는 todo 시험 세 건을 켠 것이다.
- 사본: `.codaryn/r37/u`(`git archive b9ac42e`), `.codaryn/r37/m`(`git archive 6df2eae`). 둘 다 `npm run build` 성공.
- 실험: `.codaryn/r37/r37.mjs`, 로그 `.codaryn/r37/r37.log`.
  - 실제 CLI에 실제 설정·task·대본 파일을 줬다. 대본(scripted) 실행뿐이고 주소는 쓰지 않았다.
  - 같은 입력을 두 판에 주고 stdout·stderr·종료 코드를 비교했다.
    - `runs`와 오류는 같은 작업 공간에서 바이트 그대로 비교했다.
    - `run`은 판마다 새 작업 공간이라 실행 id, 시각, 소요 시간, 임시 폴더 이름만 치환한 뒤 비교했다.
  - `run`에는 `--json`이 없다. stdout은 늘 JSON 한 줄이고 사람용 줄은 stderr다. 그래서 JSON 쪽은 stdout과 `--quiet`로 봤다. `runs`는 `--json`으로 봤다.

심각도: 높음, 중간(재현되는 결정 위반, 선행 조건 있음), 낮음, 정보.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 1 (R37-L1 시작 줄 하나에 알림이 모두 이어 붙는다) |
| 정보 | 3 (R37-I1~I3) |

| 볼 것 | 결과 |
| --- | --- |
| (1) 세 줄이 두 언어로 나오는지, 값이 없는지 | **나온다. 값은 없다.** |
| | - 실행 시작 줄: 다섯 종류 모두 실제 출력에서 봤다(`commands_dropped`, `commands_narrowed`, `restore_path_tokens_off`, `verifiers_dropped`, `plan_actions_dropped`). 개수는 `run_started.policyNarrowings`와 같다. 실행 파일 경로, `git`, `check.mjs`, 보호 경로, 검증기 id는 줄에 없다. |
| | - `runs`: 표시가 붙은 두 실행의 결과 칸 끝에 표시 글이 붙는다. |
| | - 오류 안내: `plan`·`apply`·`review` 간편 형식에서 main의 줄 뒤에 안내 한 줄이 더해진다. 경로, 실행 id, 설정 값은 없다 |
| (2) 해당하지 않는 실행이 main과 같은지 | **같다.** |
| | - `run`의 진행 줄: 네 경우(완료, 명령 거부, 검증 실패, 좁혀진 것 없는 `workflowRef`) × 두 언어 |
| | - `runs`: 표시 없는 작업 공간, 두 언어, 바이트 그대로 |
| | - 오류: 안내가 없는 일곱 경우 × 두 언어, 바이트 그대로 |
| | - 알림이 있는 실행도 시작 줄 말고는 main과 같다 |
| (3) JSON 출력 | **바뀌지 않았다.** `run`의 stdout JSON과 `--quiet`, `runs --json`, 오류의 stdout JSON이 모든 경우에 main과 같다 |
| (4) 열 정렬·좁은 터미널·색 없는 모드 | **정렬은 깨지지 않는다.** 표시는 마지막 열 끝에만 붙고, 달라진 줄은 모두 "main의 줄 + 표시"다. `NO_COLOR`·`COLUMNS=40`·`TERM=dumb`에서 바이트가 같고, 출력에 제어·이스케이프 문자가 없다(색과 너비를 쓰지 않는다). **다만 시작 줄이 매우 길다**(R37-L1) |

## 2. 낮음

### R37-L1 알림이 실행 시작 줄 하나에 모두 이어 붙어, 좁은 터미널에서 묻힌다

- 위치: `src/cli/human/output.ts`의 `run_started` 경우. 알림을 시작 줄 뒤에 " · "로 잇는다.
  - 커밋 메시지도 적었다: `HumanOutput.progressLine`이 기록 하나에 한 줄만 주기 때문이다. `withProgress`(`src/cli/progress.ts`)는 이미 여러 줄을 받을 수 있다.
- 재현: 알림 네 종류가 있는 실행의 시작 줄

  | 언어 | 글자 수 |
  | --- | --- |
  | 영어 | 382 |
  | 한국어 | 248(한글은 두 칸이라 화면 너비는 더 넓다) |

  - 80칸 터미널에서 다섯 줄쯤으로 접히고, 알림 사이의 구분은 " · "뿐이다.
  - 표시가 붙은 `runs` 줄도 영어 155자라 80칸에서는 접힌다(R37-I1).
- 영향: 판정과 내용은 맞다. 읽기 문제다. 사람이 "정책 일부가 쓰이지 않았다"는 알림을 시작 줄 꼬리에서 놓치기 쉽다.
- 권고(CLI·계약 담당): `progressLine`이 여러 줄을 줄 수 있게 해서 알림마다 한 줄씩 쓴다. 계약(`HumanOutput`)이 바뀌므로 다음 단위로 미뤄도 된다.

## 3. 정보

- **R37-I1 `runs`의 표시 글이 길다.** 영어 "records changed (something other than the run changed its records)"가 결과 칸에 그대로 붙어, 표시가 있는 줄이 155자다. 열 정렬에는 영향이 없다.
- **R37-I2 R33-L2의 나머지는 이 단위에 없다.** 다음 카탈로그 글은 이 판에서도 쓰는 곳이 없다.
  - `changes.records_changed`, `revert.records_changed`
  - `progress.state_changed`, `progress.state_unchecked`
  - 이 단위의 범위(`runs` 표시, 시작 줄, 오류 안내) 밖이므로 결함으로 세지 않았다.
- **R37-I3 영어 대체 줄의 글이 카탈로그와 다르다.** 사람용 렌더러가 없을 때 쓰는 `src/cli/progress.ts`의 `verifiers_dropped` 글("configured verifiers that take their ids")이 카탈로그의 글과 다르다. 이번 커밋이 바꾼 곳이 아니고, 실험의 실제 출력은 모두 카탈로그 글이었다.

## 4. 실험 표

**실행 시작 줄**(task가 `workflowRef: w1`, w1보다 넓은 정책과 w1과 id가 같은 검증기를 줌)

| 언어 | 단위 `b9ac42e` | main `6df2eae` |
| --- | --- | --- |
| 영어 | "run started — provider scripted" 뒤에 알림 넷: 명령 규칙 뺌 1, 좁힘 1, 경로 토큰 복원 끔, 검증 뺌 1 | "run started — provider scripted" |
| 한국어 | "실행 시작 — 모델 제공자 scripted" 뒤에 같은 넷 | "실행 시작 — 모델 제공자 scripted" |

- `plan_actions_dropped`는 계획 동작을 `move`만 둔 정의로 따로 확인했다: "…leave out plan actions of the configured policy: 1".

**`runs`**(한 작업 공간: 표시 2, 되돌린 실행 1, 검증 실패 1)

| 언어 | main과 다른 줄 | 다른 줄의 모양 | `--json` |
| --- | --- | --- | --- |
| 영어 | 2 | main의 줄 + " · records changed (…)" | 같음 |
| 한국어 | 2 | main의 줄 + " · 기록 변경됨(…)" | 같음 |

**오류 안내**(간편 형식, 한도 없는 설정)

| 명령 | 종료 코드(단위/main) | stdout JSON | stderr |
| --- | --- | --- | --- |
| `plan`, `apply`, `review` × 두 언어 | 2 / 2 | 같음(`hint`는 main에도 있다) | main의 줄 그대로 + 안내 1줄 |

## 5. 검사하지 않은 범위

- 실제 터미널(TTY)에 그린 모습. 출력은 파이프로 받았다. 코드에 색·너비 처리가 없어 TTY에서도 같은 바이트일 것으로 본다.
- 적용 실행(`apply`)의 진행 줄. 같은 `progressLine`을 지나지만 적용 기록에는 알림이 없다.
- 유닛·통합 시험 재실행(PM이 이 판에서 잰 수치를 받았다)
- macOS·Linux

## 6. PM 판단 필요

- **Q-1(R37-L1)**: 알림을 줄마다 나누는 것을 이 단위에서 고칠지, 다음 단위로 넘길지.

사용자에게 물을 질문은 없다.
