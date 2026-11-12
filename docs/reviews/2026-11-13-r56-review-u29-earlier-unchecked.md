# R-56 병합 전 검토: 단위 U-29, 계획 뒤의 실행이 확인하지 못한 것을 apply가 알린다 (w3:p4, 2026-11-13)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어(보안 검토). 읽기 전용이며 저장소 수정·커밋은 없다.
- **검토한 판: `pm/unit-U-29` = `2d755c3`**(main `a191a50` 위, 11파일 415줄). 비교판은 main `a191a50`.
  - 고친 곳: `src/store/unchecked.ts`(새 `stateUncheckedSince`), `src/engine/apply.ts:376-389`(물음과 알림), `src/cli/plan-commands.ts:629`(CLI가 store의 함수를 넘김), 계약 `src/contracts/plan.ts`·`state.ts`, `docs/cli-contract.md:1138`.
- 사본: `.codaryn/r56/u`(`git archive 2d755c3`), `.codaryn/r56/m`(`git archive a191a50`). 둘 다 `npm run build` 성공. 확인 뒤 지웠다.
- 실험: `r56/r56.mjs`(구역 E, W, Q, K, S, D), `r56/c-probe.mjs`(cleanup), `r56/u8-probe.mjs`(U-8의 경우). 로그는 `r56/*.log`.
  - 실제 CLI와 대본(scripted) 모델만 썼다. 주소는 쓰지 않았다(대본 실행에는 네트워크가 없다). 실제 API 호출은 없다.
  - 상태 디렉터리가 "다 확인하지 못함(`limited`)"이 되게 하는 방법은 단위 시험과 같다. 상태 디렉터리 맨 위에 1 MiB보다 1바이트 큰 파일을 두었다. E5만 R-44의 방법(항목 20,500개)을 썼다.
  - 실행 id는 시작한 초로 시작하므로, "뒤"와 "앞"은 1초 경계를 기다려 만들었다. Q만 일부러 같은 초에 넣었다.
- 실행을 끝낸 것은 K 한 번이다. 내가 띄운 CLI 자식을 그 핸들로 끝냈다(`child.kill()`). 그 자식이 띄운 명령은 3초 뒤 스스로 끝났다.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 4 (R56-L1~L4) |
| 정보 | 5 (R56-I1~I5) |

| 볼 것 | 결과 |
| --- | --- |
| (1) 알림이 닿는지 | **닿는다.** 아래 셋 모두에서 apply가 `done`/`verified`(종료 0)로 옮기고 알린다 |
| | - 계획 뒤 실행이 `limited`(E1) |
| | - 계획 실행 자신이 `limited`(E3, R-44 X2) |
| | - R-44 Y1 그대로: 사이의 실행이 계획 실행 폴더에 쓰고, 항목 상한을 넘김(E5. main은 알리지 않는다) |
| | - JSON(`noticeKinds: ["plan_records_unchecked"]`, `notices`에 새 고정 글 한 줄), `result.json`, `report --json`, 사람용 `report`, apply의 사람용 요약(영어·한국어)에 모두 있다 |
| | - 사람용 줄은 U-8의 글("상태 디렉터리가 너무 커서 … cleanup으로 줄이세요")이다(R56-L3) |
| (1) 조건 | - 계획 앞 실행(앞 초): 알리지 않는다(E2) |
| | - 두 번째 계획 실행이 뒤에서 `limited`: 첫 계획의 apply가 알린다(E6, 의도대로 보수적) |
| | - **같은 초: 실행 id의 무작위 부분 순서로 갈린다.** 계획 뒤에 시작한 실행이 16번 중 8번 세어지지 않았다. 계획 앞에 시작한 실행은 16번 중 9번 세어졌다(R56-L1) |
| (2) 기존 거부 | **약해지지 않는다.** `limited` 실행이 계획 뒤에 있어도 아래는 main과 같다 |
| | - 표시가 붙은 계획: `plan_records_changed`, 종료 2, 옮긴 것 없음(W1) |
| | - 다이제스트가 틀림, 두 번째 apply, 터미널에서 `n`: 출력까지 main과 같다(W2, W3, W6) |
| | - 원본이 바뀌거나 없어짐(`failed`/`plan_stale`, 종료 1, W4·W5)과 터미널에서 `y`(W7): 상태·종료·옮긴 것은 main과 같다. 다른 것은 알림 한 줄과 `noticeKinds`뿐이다 |
| | - 엔진에서 물음은 U-1 확인(`planRecordsChanged`) 다음이고, 예외는 "확인 못 함"으로 센다(`apply.ts:378-389`) |
| (3) store의 답 | - 읽을 수 없는 경우는 `true`다: 없는 runs 폴더나 `.codaryn`, 없는 계획 실행이나 그 journal, 빈 journal, 빈 줄·BOM이 든 journal, 정션인 실행 폴더 |
| | - **조용히 `false`가 되는 경우가 있다** |
| | - 계획 뒤 실행이 확인 전에 끝나 기록이 없음(K, R56-L4) |
| | - 그 실행의 폴더가 없음, 예: `cleanup --run`으로 지움(R56-I1) |
| | - 같은 초에서 id가 앞섬(R56-L1) |
| (4) main과 같은지 | **평범한 apply는 같다.** 아래 열한 가지 출력 × 두 언어에서 stdout과 stderr가 모두 같다(S) |
| | - 문서 실행, 계획 실행, apply, 거부되는 두 번째 apply, apply의 보고서(사람용, JSON), `runs`, 되돌리기 |
| | - `--quiet` apply, 터미널에서 `y`, 앞 초에 `limited` 실행이 있는 apply |
| | - **다른 것: U-8의 경우**(상태 디렉터리가 내내 너무 큼). JSON·`result.json`·`report --json`의 알림 글이 U-8 글에서 새 글로 바뀐다. 사람용 출력은 같다(R56-L2) |
| (5) 시험의 초 기다림 | **흔들리지 않는다.** 기다림은 계획 실행이 끝난 뒤 다음 초가 될 때까지 도는 방식이다. CLI의 실행 id도 같은 벽시계(`Date.now`)로 정하므로 순서가 보장된다(R56-I4) |
| | - 새 시험 세 파일(12건)을 연달아 10번, 6개 동시로 3번 돌렸다. 28번 모두 12건 통과 |

## 2. 낮음

### R56-L1 같은 초에 시작한 실행은 id의 무작위 부분으로 "앞"과 "뒤"가 갈린다

- 위치: `src/store/unchecked.ts:60`(`name >= planRunId`). 실행 id는 `YYYYMMDDTHHMMSSZ-<8자리 16진>`이다. 같은 초 안에서는 무작위 부분이 순서를 정한다. store의 실행 목록(`listRuns`)은 시작 시각(ms)으로 먼저 줄 세운다(`src/store/runs.ts:367-371`). 이 함수는 id만 본다.
- 재현(Q, `Q.log`, 판 `2d755c3`): 새 작업 공간마다 초 머리(+2 ms)에 맞춰 두 실행을 잇달아 띄웠다. 32번 모두 같은 초에 들었다. 하나는 계획 실행, 다른 하나는 큰 파일을 두고 띄운 문서 실행(`limited`)이다. 큰 파일을 지우고 apply한다.

  | 순서(실제 시작 시각) | 다른 실행의 id가 계획 id보다 | apply가 알림 | 횟수 |
  | --- | --- | --- | --- |
  | 계획 → 다른 실행 | 앞 | **없음** | **8 / 16** |
  | 계획 → 다른 실행 | 뒤 | 있음 | 8 / 16 |
  | 다른 실행 → 계획 | 앞 | 없음 | 7 / 16 |
  | 다른 실행 → 계획 | 뒤 | 있음(앞 실행인데 셈) | 9 / 16 |

  - store만 다시 보기(D): 계획 뒤 `limited` 실행의 폴더 이름을 계획과 같은 초, 무작위 부분 `00000000`으로 바꾸면 `false`다.
- 영향: 계획 뒤에 시작해 상태 디렉터리를 다 확인하지 못한 실행이 있어도, 같은 초에서 id가 앞서면 apply는 알리지 않는다. 대본·스크립트로 잇달아 실행하면 쉽게 생긴다. 이 판의 CLI에서는 계획 실행과 다음 실행이 1초 안에 들어갔다. 반대쪽(앞 실행을 셈)은 알림이 더 붙을 뿐이다(fail closed 쪽).
- 계약은 "id가 뒤인 실행"이라고 적었다(`src/contracts/state.ts:132-138`). 그러나 `docs/cli-contract.md:1138`의 "계획 실행보다 앞선 실행은 세지 않는다"와 PM의 조건("계획 뒤 실행만")은 시각으로 읽힌다. 시험의 주석도 이 경우를 따로 남겼다(`tests/unit/cli/g-u29-earlier-unchecked.test.ts:12`).
- 고칠 방향(제안)
  - 가장 단순: 같은 초의 실행을 모두 센다. 예: id 앞 16자(`runIdSecond`)가 계획 실행의 초 이상이면 센다. fail closed다.
  - 또는 `listRuns`처럼 journal 첫 기록의 `at`(ms)으로 비교한다.

### R56-L2 U-8의 경우에 JSON의 알림 글이 main과 달라지고 cleanup 안내가 빠진다

- 위치: `src/engine/apply.ts:376-389`. 새 물음은 apply 자신의 첫 점검(`checkState("run_start")`, 391행)보다 먼저다. 그래서 `planUnchecked`가 먼저 참이 되고, 자기 점검이 `limited`여도 U-8의 글(320행)은 더해지지 않는다.
- 재현(`u8-probe.mjs`, `U8.log`, S의 "too large throughout"): 상태 디렉터리에 큰 파일을 두고 계획 실행과 apply를 한다. 큰 파일은 지우지 않는다. 이것이 U-8이 고친 그 경우다.
  - main `a191a50` `notices`: `the plan run's records could not be checked for changes, because the state directory is too large to check entirely (plan_records_unchecked); a cleanup that makes it smaller lets them be checked`
  - 판 `2d755c3` `notices`: `a run since the plan was made could not check the state directory entirely, so the plan run's records may have changed without a mark (plan_records_unchecked)`
  - `noticeKinds`, 상태, 종료, 사람용 stderr는 같다. `result.json`과 `report --json`의 글도 위처럼 바뀐다(E4도 같다).
- 영향
  - 상태 디렉터리가 지금 너무 크면 계획 실행도 거의 늘 `limited`였다. 그래서 U-8이 다루던 흔한 경우의 글이 바뀐다.
  - JSON과 GUI(결과의 `notices`를 그대로 보인다, R-44에서 코드로 봄)에서는 "지금 너무 크다"는 까닭과 cleanup 안내가 사라진다. 대신 앞선 실행 탓처럼 읽힌다.
  - 거부가 약해지지는 않는다.
- 고칠 방향(제안): 자기 점검이 `limited`면 U-8 글을 쓴다. 예를 들어 물음의 답을 기억해 두었다가, 실행 끝에 자기 점검이 `limited`가 아니었을 때만 새 글을 더한다. 또는 물음을 run_start 점검 뒤로 옮긴다(run_start에서 `limited`인 흔한 경우는 이것으로 맞는다).

### R56-L3 새 경우의 사람용 줄이 "상태 디렉터리가 너무 크다, cleanup 하라"고 말한다

- 위치: 사람용 요약은 `noticeKinds`의 종류마다 `apply.notice.<kind>` 한 줄을 쓴다(`src/cli/human/output.ts:580`). 종류가 하나뿐이라 새 경우에도 U-8의 글이 나온다(`src/i18n/en.ts:435`, `src/i18n/ko.ts:434`).
- 재현(E1, `E.log`): 계획 → 다음 초 → 큰 파일을 두고 문서 실행 → 큰 파일 지움 → apply. apply 자신의 점검은 `run_start run_end`로 온전하다.
  - JSON: 새 글(앞선 실행이 확인하지 못함). 맞다.
  - 사람용(en): `The plan run's records could not be checked for changes, because the state directory is too large to check entirely; … run codaryn cleanup to make the state directory small enough to check.`
  - 사람용(ko): `상태 디렉터리가 너무 커서 다 확인하지 못해, … codaryn cleanup으로 상태 디렉터리를 확인할 수 있는 크기로 줄이세요.`
  - E3, E5, E6, W4, W5, W7도 같다.
- 영향
  - 사람은 지금 상태 디렉터리가 크다고 듣지만 실제로는 이미 작다. cleanup을 해도 이 계획의 알림은 사라지지 않는다. 기록은 앞선 실행의 journal에 남아 있기 때문이다.
  - 들어야 할 말("계획 뒤의 어떤 실행이 확인하지 못했다, 결과를 확인하라")은 JSON에만 있다.
- 고칠 방향(제안): 사람용 글이 두 까닭을 함께 말하게 한다. 또는 까닭별로 다른 글을 고른다. 종류를 나누는 것은 PM 결정 범위다(Q-1).

### R56-L4 확인 전에 끝난 실행은 조용히 "확인함"으로 센다

- 위치: `src/store/unchecked.ts`의 `uncheckedIn`은 `limited: true` 기록과 읽을 수 없는 journal만 찾는다. 실행 기록이 중간에 끝난 journal(`run_finished`가 없음)은 `false`다.
- 재현(K, `K.log`, 판과 main 같음)
  1. 계획 실행을 한다. 다음 초에 문서 실행을 띄운다. 그 실행에 허용된 명령은 계획 실행 폴더에 `extra.txt`를 쓰고 3초 기다린다.
  2. 파일이 생기면 CLI 자식을 핸들로 끝낸다. journal은 `run_started, state_checked, model_request, model_response, tool_decision`에서 멈추고, 결과·표시가 없다. 잠금이 남는다.
  3. apply: 잠금을 되찾고 `done`/`verified`, 종료 0으로 옮긴다. **`noticeKinds` 없음, 알림 없음.**
  - 비교(K2): 같은 명령을 끝까지 둔 실행은 `failed`/`state_changed`로 표시를 붙이고, apply는 `plan_records_changed`(종료 2)로 거부한다.
  - store만 다시 보기(D): 뒤 실행 journal의 마지막 줄(`run_finished`)을 지우거나 `run_started`만 남기면 `false`다.
- 영향
  - 계획 실행의 기록을 바꾸고 확인 전에 끝난 실행이 있으면, U-1도 U-29도 말하지 않는다. 프로세스가 강제로 끝나거나 전원이 나간 경우다.
  - main도 같으므로 이 판에서 나빠진 것은 아니다. 다만 새 함수가 맡은 "계획 뒤 실행이 확인하지 못함"의 한 형태다. 지시의 (3)("조용히 없음")에 해당한다.
- 고칠 방향(제안): 계획 뒤 실행 가운데 journal에 `run_finished`가 없는 것도 센다. 묻는 apply 자신의 journal은 아직 끝나지 않았으니 빼야 한다. 그 실행 id를 넘기면 된다. 실행 중인 다른 실행은 잠금 때문에 없다.

## 3. 정보

- **R56-I1 기록을 지우면 근거도 사라진다.** `cleanup --workspace <ws> --run <limited 실행>`으로 그 실행만 지울 수 있다. 미리보기 항목 1, 경고 없음. 확인한 뒤의 apply는 알리지 않는다(`c-probe.mjs`, `C.log`). store만 다시 보면 "뒤 실행 폴더 없음"이 `false`다(D). 사람이 고른 삭제이므로 낮음으로 세지 않았다.
- **R56-I2 journal 모양별 답**(D, 실제 CLI가 만든 기록을 고친 뒤 store를 직접 부름)

  | 바꾼 것 | 답 |
  | --- | --- |
  | BOM, 중간의 빈 줄, 빈 journal, 정션인 실행 폴더, 없는 계획 journal·폴더, 없는 runs·`.codaryn` | `true` |
  | CRLF 줄 끝 | 평소대로 읽음(`limited`가 있으면 `true`, 없으면 `false`) |
  | `0notes` 폴더(앞에 줄 섬) / `notes`(뒤) / `.notes`(실행 id 모양이 아님) | `false` / `true` / `false` |
  | `limited: "true"`(글자) | `false`(엔진은 불리언만 쓴다) |

  - 파일 심볼릭 링크 journal은 권한(EPERM) 때문에 만들지 못해 보지 않았다(단위 시험에는 "폴더가 그 자리에 있음"이 있다).
- **R56-I3 비용**: 계획 뒤 실행이 2,000개면 답하는 데 1.9초다(D). 각 journal을 통째로 읽는다(상한 256 MiB). 물음은 잠금 아래, 아무것도 옮기기 전이다. 이 시간은 apply의 `maxDurationMs` 안에서 쓰인다.
- **R56-I4 시험의 초 기다림**(`T.log`, `T-counts.log`)
  - `after_plan`: 계획 CLI가 끝난 뒤 `nextSecond()`가 다음 초까지 50 ms 간격으로 돈다. 그 뒤에 다른 실행을 띄우므로, 그 id의 초는 계획 id의 초보다 반드시 크다. `before_plan`도 같다. 벽시계가 뒤로 가지 않는 한 순서가 보장된다.
  - 시험 하나에 약 1초가 들고, 대부분이 기다림이다.
  - 같은 초의 경우(R56-L1)는 어느 시험도 다루지 않는다.
- **R56-I5 `plan_stale`로 실패한 apply에도 알림이 붙는다**(W4, W5). 사람용 줄에 "이 때문에 적용을 멈추지는 않았습니다"가 그대로 나온다. 계약의 "상태와 상관없이"(`src/contracts/human.ts:919`)와 맞다.
- R-44의 R44-L1은 닫혔다. 그때의 재현 Y1(E5)과 X2(E3) 모두 이 판에서 알린다. main은 알리지 않는다.
- 앱 계층의 `applyPlan`은 CLI의 `runApply`를 그대로 쓴다. `stateUncheckedSince`를 넘기지 않으므로 store의 기본 함수가 쓰이고, 감싼 `applyPlan`은 `deps`를 그대로 넘긴다(`src/app/app.ts:666-673`, 코드로만 봄).

## 4. 검사하지 않은 범위

- GUI와 앱 계층의 실제 실행(코드로만 봤다). 루트 유닛·통합 시험 전체 재실행(PM이 이 판에서 잰 수치를 받았다). 새 시험 세 파일만 28번 돌렸다.
- 해시 바이트 상한 전체(`MAX_STATE_HASH_BYTES`)로 `limited`가 되는 경우. 1 MiB를 넘는 파일 하나와 항목 상한만 일으켰다.
- 파일 심볼릭 링크인 journal(R56-I2). macOS·Linux. 실제 터미널(승인 질문은 R-52b의 미리 읽기 모듈로 흉내 냈다).

## 5. PM 판단 필요

- **Q-1(R56-L2, L3)**: 두 까닭(apply 자신의 점검, 앞선 실행)이 한 종류 `plan_records_unchecked`를 같이 쓴다. 어떻게 맞출지 정해야 한다. (가) 종류는 하나로 두고, 글을 까닭에 따라 고르고 자기 점검을 우선한다. (나) 종류를 나눈다. 가정: (가)가 PM 결정("거부 아님·알림")과 가장 가깝다.
- **Q-2(R56-L1)**: 같은 초의 실행을 모두 셀지(fail closed), 시작 시각(ms)으로 가를지.
- **Q-3(R56-L4)**: 확인 전에 끝난 실행(`run_finished` 없음)도 "확인하지 못함"으로 셀지.

사용자에게 물을 질문은 없다.
