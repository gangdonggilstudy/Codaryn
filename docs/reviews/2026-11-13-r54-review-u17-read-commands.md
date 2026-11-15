# R-54 병합 전 검토: 단위 U-17 읽기 명령의 가벼운 형식과 `--workspace` 생략 (w3:p4, 2026-11-13)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어(보안 검토). 읽기 전용이며 파일 수정·커밋은 없다.
- **검토한 판: `pm/unit-U-17` = `11723f3`**(main `b2dad78` 위, 15개 파일 351줄 더함·52줄 뺌). 비교판은 main `b2dad78`.
  - 제품 코드: `src/cli/args.ts`, `src/cli/task.ts`, `src/cli/run.ts`, `src/cli/plan-commands.ts`, `src/cli/changes.ts`, `src/cli/cleanup.ts`, `src/app/app.ts`, `src/app/changes.ts`
- 사본: `.codaryn/r54/u`(`git archive 11723f3`), `.codaryn/r54/m`(`git archive b2dad78`). 둘 다 `npm run build` 성공. 검토 뒤 지웠다.
- 실험: `.codaryn/r54/r54.mjs`(E, W, S, D, L), `p.mjs`. 로그는 `Eu.log`, `Wu.log`, `S.log`, `D.log`, `L.log`, `P.log`.
  - 실제 CLI에 대본(scripted) 실행을 줬다. 주소는 쓰지 않았다.
  - 샌드박스마다 기본 설정 위치(`APPDATA\Codaryn\config.json`)를 임시 폴더로 돌렸다. 키 변수는 없다.
  - 작업 공간의 `notes.txt` 첫 줄과 셋째 줄에 등록된 가릴 값 둘(25자, 12자)이 있다. task 실행(가릴 값 둘을 등록)이 둘째 줄만 바꾼다. 같은 샌드박스에 정리 예제의 계획 실행이 있다.
  - 설정 넷: 없음, 한도 없음(secretEnv만), 한도 있음(모델·키 없음), 깨진 JSON. 실행은 설정 없이 task로 만들고, 설정은 그 뒤에 놓았다.

심각도: 높음, 중간(재현되는 결정 위반, 선행 조건 있음), 낮음, 정보.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 2 (R54-L1 현재 폴더 안내가 사람에게 보이지 않는다, R54-L2 작업 공간이 아닌 폴더에서의 문구) |
| 정보 | 5 (R54-I1~I5) |

| 볼 것 | 결과 |
| --- | --- |
| (1) 키·모델·한도 없이 읽기 명령 | **된다.** `report`, `runs`, `changes`, `plan`(task 형식, 간편 형식, 생략)이 설정 없음·한도 없음·모델과 키 없음에서 모두 종료 0이다. main은 간편 형식의 `changes`와 `plan`을 한도나 제공자 설정 때문에 거부했다 |
| | - 깨진 설정에서는 `report`와 `runs`만 된다. `changes`와 `plan`은 `invalid_config`다(가릴 값을 설정에서 읽으므로 막는 쪽, R54-I1) |
| (1) 바꾸는 명령의 검사 | **그대로다.** `run`(간편 형식)은 한도가 없으면 `invalid_config`, 한도가 있고 모델·키가 없으면 `provider_not_configured`다. `apply`(간편 형식)는 한도가 없으면 `invalid_config`다. `revert`와 `cleanup`은 원래 설정을 읽지 않는다. `review`만 한도를 요구하지 않게 됐다(계약대로, R54-I2) |
| | - 읽기 쪽의 다른 검사도 그대로다: 설정 파일 안의 키(`key_in_file`), 설치 폴더(`workspace_is_install_dir`), 준 한도의 값 검사(한 가지 예외, R54-I3) |
| | - 읽기 명령은 작업 공간에 아무것도 쓰지 않았다(파일 목록과 크기가 같다) |
| (2) `--workspace` 생략 | `report`, `plan`, `changes`만 현재 폴더를 쓴다. `runs`는 원래 그랬다. **`revert`, `cleanup`, `apply`, `review`는 생략을 거부한다**(종료 2, `invalid_arguments`) |
| | - 거부 메시지의 "현재 폴더라면 `--workspace .`를 주라"는 안내는 영어 JSON에만 있다(R54-L1) |
| | - 작업 공간이 아닌 폴더(빈 폴더, 작업 공간의 하위 폴더)에서는 "이 작업 공간에 그 실행의 기록이 없습니다"뿐이다(R54-L2) |
| (3) 가림 | **약해지지 않았다.** 모든 설정과 모든 읽기 출력(사람용, JSON)에서 등록된 값이 원문으로 나온 곳이 없다 |
| | - `changes --task`: 본문을 토큰으로 가려 보인다 |
| | - 생략·간편 형식 + secretEnv가 있는 설정: 같다 |
| | - 생략·간편 형식 + 설정 없음: 지금 등록된 값이 실행과 달라 본문을 보이지 않는다(`masking_unverified`, DR-29) |
| (4) main과 같은지 | **명시한 형식은 같다.** `report`(Markdown, JSON), `runs`, `changes --task`(사람용, JSON), `plan --task`(사람용, JSON), `plan --workspace`(한도 있는 설정), `revert --dry-run`, `revert`, `cleanup` 미리보기, `apply --task`가 두 언어에서 같다 |
| | - 다른 것은 의도한 것뿐이다: 바꾸는 명령의 인수 오류 메시지(안내 더함), `report`의 사용법 줄과 `--run` 오류, 가벼운 형식이 이제 되는 것 |

## 2. 낮음

### R54-L1 "`--workspace .`를 주라"는 안내가 사람용 오류 줄에 나오지 않는다

- 위치: `src/cli/args.ts`(`CURRENT_DIRECTORY_HINT`), `src/cli/cleanup.ts`. 안내는 `invalid_arguments`의 `message`에만 붙는다.
- 재현(W, 두 언어): 작업 공간 안에서 `revert --run latest`, `cleanup --older-than 0`, `apply --run … --digest …`, `review --run latest --accept`
  - stdout JSON의 `message`: "… If you mean the current directory, give --workspace . usage: …"(영어)
  - stderr: "codaryn: 오류 — 명령 인수가 올바르지 않습니다 (invalid_arguments) / 고치는 법: codaryn help <명령>으로 사용법을 확인하세요." 영어도 같은 일반 문구다.
- 영향: 계약 18.14의 "오류에 `--workspace .`를 주면 현재 폴더라는 안내를 붙인다"가 JSON을 읽는 도구에만 닿는다. 사람은 읽기 명령과 달리 왜 거부됐는지, 무엇을 주면 되는지 보지 못한다(UXM-2와 같은 꼴).
- 덧붙임: `cleanup`의 메시지는 "give --workspace .. usage:"로 마침표가 둘이다.
- 권고(CLI·문구 담당): 사람용 줄에 고정 문구 하나(두 언어)를 더한다.

### R54-L2 작업 공간이 아닌 폴더에서 읽으면, 현재 폴더를 썼다는 말이 없다

- 재현(W, 두 언어)
  - 빈 폴더에서 `report`·`plan`·`changes --run latest`: `run_not_found` "이 작업 공간에 그 실행의 기록이 없습니다 / codaryn runs로 실행 목록을 보세요."
  - 같은 폴더에서 `runs`: "이 작업 공간에는 실행 기록이 없습니다."
  - **작업 공간의 하위 폴더**에서도 같다. 실행 기록은 한 단계 위에 있다.
- 영향: 사람은 `--workspace`를 주지 않았으므로 "이 작업 공간"이 지금 폴더라는 것을 알기 어렵다. 하위 폴더에서는 실행이 없다고 믿게 된다. 아무것도 쓰지 않으므로 안전 문제는 아니다.
- 권고: `--workspace`를 생략했을 때는 "현재 폴더(…)를 작업 공간으로 읽었습니다" 한 줄을 더하거나, 위 폴더에 `.codaryn`이 있으면 알린다.

## 3. 정보

- **R54-I1 깨진 설정에서는 `changes`와 `plan`이 거부된다.** `report`와 `runs`는 설정을 읽지 않아 된다. 가릴 값을 설정에서 읽으므로 막는 쪽이 맞다. 설정 파일 안의 키 모양 값도 그대로 `key_in_file`로 막는다(main과 같다).
- **R54-I2 바꾸는 명령 `review`도 한도를 요구하지 않게 됐다.** 계약 18.14대로다(모델·검증기를 돌리지 않음). 형식은 여전히 명시해야 하고, 다른 검사(가릴 값, 판정 대상)는 그대로다.
- **R54-I3 한도 하나가 빠지면 다른 한도의 상한 검사가 건너뛰어진다.** 설정 한도가 `maxDurationMs: 999999999999` 하나뿐이면 `plan`과 `changes`가 종료 0이다. 네 한도를 모두 주면 같은 값이 "must be at most 86400000"으로 거부된다. 값의 꼴(0, 글자)은 빠진 것이 있어도 검사한다.
  - 원인: `readOnlyLimits`가 `resolveBoundedLimits`의 첫 메시지에 "is not set"이 있으면 `READ_ONLY_LIMITS`로 바꾼다. 상한 검사는 그 뒤에 온다(`src/cli/task.ts`).
  - 그 한도로 실행되는 것은 없고, 같은 설정으로 `run`과 `apply`는 거부된다. 계약 문구 "준 한도는 그대로 검사"와 어긋날 뿐이다. 메시지 글로 판정하는 것도 깨지기 쉽다.
- **R54-I4 생략한 `changes`는 간편 형식이다.** task로 실행하고 설정에 가릴 값이 없으면, 생략한 `changes`는 본문을 보이지 않는다(`masking_unverified`). 안전한 쪽이다. 본문을 보려면 `--task`를 줘야 한다는 것을 사람용 출력이 알려 주는지는 보지 않았다.
- **R54-I5 한 줄 실행 `codaryn run "<목표>"`은 예전부터 현재 폴더를 바꾼다.** 이 단위가 바꾼 것이 아니다. "바꾸는 명령은 생략을 허용하지 않는다"는 규칙의 예외로 남는다.

## 4. 실험 표

**읽기와 바꾸는 명령, 작업 공간 안에서**(E, 판 `11723f3`)

| 명령 | 설정 없음 | 한도 없음 | 한도 있음(모델·키 없음) | 깨진 설정 |
| --- | --- | --- | --- | --- |
| `report --run latest`(생략) | 0 | 0 | 0 | 0 |
| `runs`(생략) | 0 | 0 | 0 | 0 |
| `changes --run latest`(생략) | 0, 본문 없음(`masking_unverified`) | 0, 가린 본문 | 0, 가린 본문 | 2 `invalid_config` |
| `changes --task` | 0, 가린 본문 | 0, 가린 본문 | 2 `invalid_task`(task의 한도가 설정보다 큼, main과 같음) | 2 `invalid_config` |
| `plan --run latest`(생략) | 0 | 0 | 0 | 2 `invalid_config` |
| `plan --task` | 0 | 0 | 0 | 2 `invalid_config` |
| `run --workspace . --goal g` | 2 `invalid_config`(한도) | 2 `invalid_config`(한도) | 7 `provider_not_configured` | 2 `invalid_config` |
| `apply --workspace . --workflow organize` | 2 `invalid_config`(한도) | 2 `invalid_config`(한도) | 0 | 2 `invalid_config` |
| `review --workspace .` | 2 `run_not_awaiting_review` | 같음 | 같음 | 2 `invalid_config` |
| `revert --workspace . --dry-run` | 0 | 0 | 0 | 0 |
| `cleanup --workspace .`(미리보기) | 0 | 0 | 0 | 0 |

- 모든 칸에서 등록된 값이 원문으로 나온 출력은 없다. 읽기 명령 뒤 작업 공간의 파일 목록·크기는 같다.

**가벼운 형식, main과 비교**(L)

| 명령 | 설정 없음 | 한도 없음 | 한도 있음(모델·키 없음) |
| --- | --- | --- | --- |
| `changes --workspace` | 판 0 / main 2 `invalid_config` | 판 0 / main 2 `invalid_config` | 판 0 / main 7 `provider_not_configured` |
| `plan --workspace` | 판 0 / main 2 `invalid_config` | 판 0 / main 2 `invalid_config` | 둘 다 0 |
| `report --workspace` | 둘 다 0 | 둘 다 0 | 둘 다 0 |

**그 밖의 검사**(P)

| 설정 | 판의 `plan`·`changes` |
| --- | --- |
| `maxModelTurns: 0`, 나머지 없음 | `invalid_config`(양의 정수) |
| `maxModelTurns` 상한 초과, 나머지 없음 | `invalid_config`(상한) |
| `maxModelTurns`가 글자, 나머지 없음 | `invalid_config` |
| `maxModelTurns` 없음, `maxToolCalls: 0` | `invalid_config` |
| **`maxModelTurns` 없음, `maxDurationMs` 상한 초과** | **0**(R54-I3) |
| 네 한도 모두, `maxDurationMs` 상한 초과 | `invalid_config`(상한) |
| 설정 파일 안의 키 모양 값 | `key_in_file` |
| 현재 폴더가 설치 폴더 | `changes`·`plan`은 `workspace_is_install_dir`, `report`·`runs`는 기록 없음. `.codaryn`을 만들지 않음 |

**main과 같은지**(S, D. 실행 id·시각·소요 시간·임시 폴더 이름·해시·토큰 번호만 치환)

- 같음(두 언어): `report`(Markdown, JSON), `runs`, `changes --task`(사람용, JSON), `plan --task`(사람용, JSON), `plan --workspace --workflow organize`(한도 있는 설정), `revert --dry-run`, `revert`, `cleanup` 미리보기, `apply --task`
- 다름(의도): `report`의 사용법 줄과 "--run is required", `revert`·`cleanup`·`apply`·`review`의 생략 오류 메시지(안내 더함). 사람용 stderr는 두 판이 같다(R54-L1)

## 5. 검사하지 않은 범위

- 앱 계층·GUI의 `changes`(코드와 유닛 시험 `tests/unit/app/u17-read-changes.test.ts`만 봤다). GUI 시험은 지시에 없어 돌리지 않았다.
- 터미널 승인 질문, 실제 모델 제공자
- 유닛·통합 시험 재실행(PM이 이 판에서 잰 수치를 받았다), macOS·Linux

## 6. PM 판단 필요

- **Q-1(R54-L1)**: 생략을 거부한 바꾸는 명령의 사람용 오류에 "현재 폴더라면 `--workspace .`" 문구를 더할지.
- **Q-2(R54-I3)**: 계약 문구를 고칠지, 빠진 한도가 있어도 준 한도의 상한을 검사하게 할지.

사용자에게 물을 질문은 없다.
