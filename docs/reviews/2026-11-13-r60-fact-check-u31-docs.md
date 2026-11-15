# R-60 사실 확인: 문서 단위 U-31 (w3:p4, 2026-11-13)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어. 읽기 전용이며 저장소 수정·커밋은 없다.
- **대상: `unit/U-31-nd-docs` = `8ff4b19`**. `git diff main...unit/U-31-nd-docs`로 5파일 109줄 더함, 43줄 지움이다. 갈라진 곳은 `a191a50`이다.
  - 파일: `README.md`, `docs/README.md`, `docs/design/ux-design.md`, `docs/privacy.md`, `docs/usage.md`
  - 문서는 스스로 "main `a191a50`을 따른다"고 적었다.
  - 지금 main `ae4021d`에는 다음이 더 들어왔다: U-29, U-16, U-19, U-25, U-39, U-28, U-32, U-23. 문서 브랜치는 이 main과 충돌 없이 합쳐진다(`git merge-tree`).
- **돌린 판**
  - `a`: main `a191a50`, 문서가 따른다고 한 판
  - `n`: 지금 main `ae4021d`, 병합될 판
  - 사본 `.codaryn/r60/a`, `.codaryn/r60/n`(`git archive`). 둘 다 `npm run build` 성공. 확인 뒤 지웠다.
- 실험: `r60/r60.mjs`(구역 T, J, L, K, P), `r60/i4.mjs`(`init` 표기), `r60/x.mjs`. 로그는 `r60/*.log`.
  - CLI 호출에는 시험의 네트워크 막이를 얹었다. 대본(scripted) 모델만 썼고 주소는 쓰지 않았다.
  - 기본 설정 위치(`APPDATA` 등)는 시험 폴더로 돌렸다.
  - "강제로 끝낸 실행"은 문서의 방법을 따랐다. 3절 체험 사본에서 끝난 실행 A 뒤에, 명령 검사(`node wait.mjs`, 15초 기다림)에서 기다리는 실행 B를 띄운다. 그 CLI 자식을 내 핸들로 끝낸다(`child.kill()`, Windows에서는 프로세스 종료). 검사 명령은 15초 뒤 스스로 끝났다.
  - "다른 프로그램"은 내가 띄운 `node` 프로세스다. 자기 `performance.timeOrigin`을 파일에 쓰고 기다린다. 그 pid를 잠금 파일에 넣었고, 끝낼 때도 그 핸들로 끝냈다.
  - 키 모양 글은 조각을 이어 실행 중에만 만들었다. 로그에는 있음·없음만 적었다.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 0 |
| 정보 | 4 (R60-I1~I4) |

**판단: 문서가 말하는 동작은 두 판 모두에서 실제 CLI와 맞다.** 고칠 서술은 찾지 못했다. 병합 뒤에 손볼 점은 정보로 적었다.

| 볼 것(문서 위치) | 결과 |
| --- | --- |
| **잠금이 남아 막히는 경우와 빠져나오는 법**(usage 17절 새 소절의 표) | **다섯 행 모두 맞다**(K, 두 판) |
| | - 1행(pid 끝남), 2행(pid를 다른 프로그램이 다시 씀, 잠금에 시작 시각 있음): `--run latest`가 A를 고르고, 새 실행이 잠금을 회수해 `done`이다. `doctor`는 `[ok] a lock left by a process that has ended; the next run reclaims it` |
| | - 2행은 다른 프로그램을 B보다 6초 늦게 띄웠다(허용 차 5초, 16절) |
| | - 3행(시작 시각 없는 옛 잠금): `latest`는 `run_in_progress`(종료 6). 새 실행, `revert`, `cleanup --confirm`은 `workspace_locked`(종료 6)이고 A의 기록은 남는다. `doctor`는 표의 `[warning]` 줄 |
| | - 3행 빠져나오기: 다른 프로그램이 끝나자 A를 골랐다. 그 프로그램이 도는 동안 `lock.json`을 지우자 A를 골랐고 새 실행은 `done`이었다 |
| | - 4행(깨진 `lock.json`): `latest`는 A다. 새 실행, `revert`, `cleanup --confirm`은 `workspace_locked`다. `doctor`는 `[warning] the workspace lock file (.codaryn/lock.json) cannot be read`. 지우자 새 실행이 `done`이었다 |
| | - 5행(살아 있는 주인의 `lock.json.reclaim`): `latest`는 A다. 셋은 `workspace_locked`이고, `doctor`는 표의 `[warning]` 줄이다. 회수 파일을 지우자 새 실행이 남은 잠금을 회수해 `done`이었고 잠금은 남지 않았다 |
| 표 아래 서술 | **맞다.** |
| | - 다섯 행 모두에서 `report --run <A>`는 종료 0이다 |
| | - B는 `runs`에 `no result (running or stopped)`(한국어 `결과 없음(진행 중이거나 중단됨)`)로 남는다 |
| | - 정리 미리보기는 B를 항목으로 고르지 않는다. 돌 때는 `running (it holds the workspace lock)`(`lock_held`), 끝낸 뒤에는 `no result yet (it may still be running)`(`no_result`)이다(L, X) |
| | - `workspace_locked`의 사람용 세 줄은 영어·한국어 모두 문서와 글자까지 같다 |
| | - `run_in_progress`의 고치는 법 줄은 잠금이나 `doctor`를 말하지 않는다. `doctor --workspace`만 주면 종료 1이지만 잠금 항목은 읽힌다 |
| **`run_in_progress`와 `--run latest`**(usage 10절) | **맞다**(L, 두 판 × 두 언어) |
| | - B가 도는 동안 다섯 명령의 `--run latest`가 모두 `run_in_progress`(종료 6)이다: `report`, `changes`, `revert --dry-run`, `plan`, `review` |
| | - 한국어 첫 줄은 문서대로 `가장 최근 실행이 아직 도는 중이어서 결과가 없습니다. 아무것도 바꾸지 않았습니다`로 시작한다 |
| | - 같은 때 A의 id를 준 `report`와 `changes`는 종료 0이다. B의 id를 준 `report`는 `incomplete`(종료 3)이고, `--json`의 `result`는 `null`이다(10절 "보고서") |
| | - B를 끝내면 잠금이 남아도 `latest`는 A다. `apply --run latest`는 `invalid_arguments`다(X) |
| **journal에 모델 원문이 남는다**(usage 8절, privacy 5절·기록 절, ux-design) | **맞다**(T, J, 두 판) |
| | - 3절 체험의 journal에는 4턴의 `요약을 만들었다.`와 6턴의 `빠진 '## 할 일' 절을 더했다.`가 둘 다 있다. 끝 요약과 `finalMessage`에는 6턴의 것만 있다 |
| | - 대본으로 확인한 것: journal에는 등록한 가릴 값이 토큰으로만 남는다 |
| | - 그 밖은 그대로 남는다: 키 모양 글(통째로, LF로 나뉜 꼴도), ESC와 BEL, 2,262자 |
| | - 마지막이 아닌 답도 남는다 |
| | - `finalMessage`는 2,000자, `[key]`, 토큰, `truncated: true`이고 원래 값이 없다. 끝 요약에는 키 모양과 원래 값이 없고 잘림 줄이 있다 |
| 3절 체험(마지막 답, 보고서) | **맞다.** 끝 요약의 stderr가 문서 블록과 실행 id만 빼고 같다(두 판) |
| | - `report`의 절 순서는 `Changes` → `The agent's last message` → `Usage`다. 머리말과 코드 블록의 `|` 줄도 문서와 같다 |
| | - `report --json`의 `result.finalMessage`가 있다 |
| 18.2·18.3 계획 보기, 표시가 있는 계획, `apply`의 거부 | **맞다**(P, 두 판 × 두 언어) |
| | - 계획 보기의 줄(에이전트의 설명, 끝 문장)이 문서와 같다 |
| | - 표시가 있는 계획 보기의 경고와 "적용할 수 없다" 줄도 같다(설명 없음, 종료 0). `--json`에는 `recordsChanged: true`가 있고 `summary`가 없다 |
| | - `apply` 거부의 새 고치는 법 줄(`codaryn plan only shows a plan`)과 한국어도 같다 |
| | - 16절 "출력 언어"의 섞임(머리 줄·동작 줄·적용 명령은 영어, 경고·설명 머리말·끝 문장은 한국어)도 맞다 |
| | - `revert --dry-run`의 `restored from the discarded-files folder`도 맞다 |
| 18.1 `help run` | **맞다.** 사용법 줄에 `[--workflow <id>]`가 있지만 옵션 목록에는 없다(두 판. `ae4021d`에는 U-23의 `--json`이 더 있다) |
| 4절 `init`의 고정 표기 | **맞다**(`i4.mjs`, 두 판) |
| | - `init`이 `%APPDATA%\Codaryn\config.json`을 찍는다 |
| | - cmd에서 `if exist "%APPDATA%\Codaryn\config.json"`과 `type`이 그 파일을 찾는다 |
| | - PowerShell에서 `Test-Path "$env:APPDATA\Codaryn\config.json"`이 참이다 |

## 2. 정보

- **R60-I1 지금 main에 합치면 "stdout JSON"이라는 서술은 파이프일 때만 맞다.**
  - `ae4021d`에는 U-23(DR-49)이 들어 있다. stdout이 터미널이면 결과 JSON 줄을 내지 않는다(`--json`·`--quiet`면 낸다).
  - U-31이 더한 문장 가운데 이 점이 걸리는 것: "같은 글이 나오는 곳: stdout JSON과 `result.json`의 `finalMessage`"(usage 8절). 그 밖의 예전 문장도 터미널에서는 맞지 않는다: 3절 "run: stdout에는 결과 JSON 한 줄", "revert --dry-run: stdout은 … 결과 JSON 한 줄".
  - 문서는 `a191a50` 기준이라고 밝혔으므로 이 단위의 잘못은 아니다. DR-49의 문서 몫이 따로 필요하다.
  - 3절의 `| ConvertFrom-Json` 예는 파이프라서 그대로 맞다.
- **R60-I2 막힌 동안에도 `revert --dry-run --run <id>`는 된다.** 3~5행에서 `revert --run <A> --dry-run`은 종료 0, `complete`였다. 진짜 `revert`만 `workspace_locked`다. 표의 "revert" 칸이 진짜 되돌리기라는 것을 적거나, 미리보기는 된다고 더하면 읽는 사람에게 도움이 된다.
- **R60-I3 1·2행에서는 `cleanup --confirm`도 잠금을 회수하고 지운다.** A의 기록이 `removed`(종료 0)였다. 표의 그 칸은 새 실행만 말한다. 틀린 것은 아니다.
- **R60-I4 표의 `doctor` 줄은 영어만 적었다.** 한국어는 다음과 같다(L).
  - `[정상] … 끝난 프로세스가 남긴 잠금이 있습니다. 다음 실행이 회수합니다`
  - `[주의] … 실행 중인 프로세스가 작업 공간을 잠그고 있습니다. …`
  - 정리 미리보기의 두 줄도 한국어가 있다: `실행 중(작업 공간 잠금을 쥐고 있음)`, `결과 없음(아직 실행 중일 수 있음)`

## 3. 검사하지 않은 범위

- GUI(문서도 확인하지 않았다고 적었다), Linux·macOS의 잠금 판정, 하드 링크가 없는 드라이브
- 작업 관리자나 전원 차단으로 끝낸 경우. 프로세스 종료(`child.kill()`)로 대신했다.
- 시작 시각 조회가 5초를 넘긴 경우
- 계획 요약의 500자 상한
- 정리의 `nothing_removed`(종료 3)와 `partly_failed`(종료 1)
- 실험 중 `r60.mjs`의 `I` 구역은 cmd에 넘기는 따옴표가 Node에서 바뀌어 잘못 잰 것이다. 결과는 `i4.mjs`로 다시 쟀고 `I.log`가 그것이다.

## 4. PM 판단 필요

- 없음. R60-I1은 DR-49의 문서 단위를 따로 둘지 PM이 정할 일이다.

사용자에게 물을 질문은 없다.
