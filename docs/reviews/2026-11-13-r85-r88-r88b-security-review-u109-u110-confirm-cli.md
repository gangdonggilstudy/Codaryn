# R-85 병합 전 보안 검토: 단위 U-109, 사람의 설정에서만 `confirm: true` (w3:p5, 2026-11-13)

## 0. 대상과 방법

- 페르소나: 보안·개인정보 검토자. 읽기 전용이다. 저장소 수정·커밋은 없다. 실제 API는 쓰지 않았다.
- **검토한 판: `pm/unit-U-109` = `e8bd6d0`**(main `def3a0e` 위, 4파일 +206 −7)
  - 바뀐 파일: `src/cli/task.ts`(`parsePolicy`에 출처), `src/cli/config.ts`(출처 셋), `docs/cli-contract.md` 18.16, 시험 하나
- 사본: `git archive`로 `.codaryn/r85/base`(`def3a0e`)와 `.codaryn/r85/u`(`e8bd6d0`)를 풀었다. 둘 다 `tsc` 0이다.
- 실험: 로그는 `.codaryn/r85/r85.log`, `r85b.mjs`의 출력이다.
  - 간편 형식은 API 제공자가 필요하다. 그래서 모델은 `127.0.0.1`의 가짜 Anthropic이다. 대본처럼 정해진 답을 낸다: 1턴에 `run_command node ask.mjs`, 2턴에 끝.
  - 키는 가짜 값이다. 모든 CLI 호출에 시험의 네트워크 막이를 얹었다.
  - `ask.mjs`·`mark.mjs`는 돌면 작업 공간에 표지 파일(`*-ran.txt`)을 쓴다. 명령이 정말 돌았는지를 그 파일로 본다.
  - 앱 계층은 `createCodarynApp(...).proposeSettingsChange`를 직접 불렀다.
- 수치(고정 판 트리 `e8bd6d0`, 내 worktree에서 분리 체크아웃해 dist를 지우고 빌드): typecheck 0, 유닛 2887(통과 2883, 실패 0, 건너뜀 3, todo 1), 통합 559/559. PM의 수치와 같다.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 1 (R85-M1) |
| 낮음 | 1 (R85-L1) |
| 정보 | 4 (R85-I1~I4) |

| 볼 것 | 결과 |
| --- | --- |
| (1) 받는 곳 | **맞다.** |
| | - 받음: 설정의 `policy`, 프로필의 `policy`에서 `confirm: true` |
| | - 알 수 없는 필드로 거부: task 파일의 `policy`(`invalid_task`), 설정의 작업 종류 정의 `workflows.w.policy`(`invalid_config`) |
| | - 값 오류로 거부: `false`, `"true"`, `1`(설정·프로필 모두, `confirm must be true when it is given`) |
| | - 간편 형식은 자기 정책이 없다. 설정이나 프로필의 정책을 쓰므로, 그 `confirm`이 그대로 쓰이는 것이 설계다 |
| (2) 실행 때 | **명령은 돌지 않는다.** 표지 파일이 없다 |
| | - 기록: `tool_decision` `policy_effective` 거부 `confirmation_required` → `confirmation_requested {id q1, subject(실행 파일), argumentCount 1}` → `confirmation_answered {deny, default}` → `tool_result` `policy_denied` |
| | - 두 사건에 인자 글(`ask.mjs`)은 없다 |
| | - **사람에게 보이는 글은 부족하고 거꾸로 이끈다**(R85-M1) |
| (3) 조용히 허용되는 조합 | 둘이다. 둘 다 사람이 자기 설정에 쓴 규칙이고, 계약(U-74)과 18.16이 적은 동작이다(I1) |
| | - 같은 실행 파일에 `confirm` 없는 넓은 규칙이 있을 때 |
| | - 고른 프로필이 자기 정책(보통 규칙)을 가져 설정의 정책을 대신할 때 |
| | - 작업 종류와 합칠 때는 `confirm`이 남는다. 대상: `code`, 넓은 보통 규칙을 가진 설정의 작업 종류. `organize`는 `run_command`를 아예 뺀다 |
| (4) `confirm` 없는 설정 | **main과 같다**(두 언어: stdout, stderr, journal, 표지) |
| (5) 읽기 명령 | **깨지지 않는다.** `doctor`(ok, `config_file ok`), `runs`, `report`, `plan`·`review`·`apply`·`changes` 모두 설정을 읽는다. 비교판은 넷이 `invalid_config`였다 |
| (6) 설정 바꾸기 제안 | **규칙의 `confirm`을 지우는 것은 `confirm_removed`로 잡는다**(설정, 프로필) |
| | - 설정의 `confirm` 규칙을 쓰던 프로필이 자기 보통 규칙을 갖게 되는 변경은 `profile_changed`로만 잡힌다(R85-L1) |

## 2. 받는 곳 (P, `r85.log`)

| 놓은 곳 | main `def3a0e` | U-109 `e8bd6d0` |
| --- | --- | --- |
| 설정 `policy`, `confirm: true` | `config_file fail`(알 수 없는 필드) | **`ok`** |
| 설정 `policy`, `false`·`"true"`·`1` | fail(알 수 없는 필드) | fail: `policy.commands[0].confirm must be true when it is given` |
| 프로필 `policy`, `true` | fail | **`ok`** |
| 프로필 `policy`, `false` | fail | fail: `profiles[0].policy.commands[0].confirm must be true when it is given` |
| 설정의 작업 종류 `workflows.w.policy`, `true` | fail | fail(알 수 없는 필드, 그대로) |
| task 파일 `policy`, `true` | `invalid_task`(알 수 없는 필드) | `invalid_task`(그대로) |

- `parsePolicy`를 부르는 곳은 셋뿐이다: 설정 `policy`(settings), 프로필 `policy`(settings), 작업 종류 정의(definition). 그리고 task 파일(task)이 있다.
- 출처를 주지 않고는 부를 수 없다(타입 오버로드).

## 3. 실행 때 (R, `r85.log`, `r85b`)

| 설정 | 결과 | 명령이 돌았나 | 기록 |
| --- | --- | --- | --- |
| 설정에 `confirm` 규칙 | needs-input/no_verifier | 아니오 | 거부 `confirmation_required`, 질문 q1, 답 `deny`/`default` |
| 프로필에 `confirm` 규칙(`--profile p`) | 같음 | 아니오 | 같음 |
| 자기 정책 없는 프로필 + 설정의 `confirm` 규칙 | 같음 | 아니오 | 같음 |
| `--workflow code` + 설정의 `confirm` 규칙 | 같음 | 아니오 | 같음 |
| 설정의 작업 종류(`node` 아무 인자나 허용하는 보통 규칙) + 설정의 `confirm` 규칙 | 같음 | 아니오 | 같음. 교집합에 `confirm`이 남는다 |
| `--workflow organize` + 설정의 `confirm` 규칙 | failed/model_error | 아니오 | `run_command`가 없어 `unknown_tool`(묻지 않음) |
| 같은 실행 파일에 `confirm` 규칙과 넓은 보통 규칙 | needs-input/no_verifier | **예** | 허용(묻지 않음) — I1 |
| 설정엔 `confirm` 규칙, 고른 프로필엔 보통 규칙 | 같음 | **예** | 허용(프로필이 정책을 대신함) — I1 |

## 4. 중간

### R85-M1 묻지 못해 거부된 호출을 사람에게 "규칙을 더하라"고 안내한다. 질문이 있었다는 줄은 없다

- 재현(`r85b`, 실제 CLI, 설정에 `confirm` 규칙 하나, 모델이 그 명령을 부름). stderr 전체에서:

  ```
  codaryn: run command — denied (command/confirmation_required)
  …
  Denied calls: 1
  To allow a command, add a rule to policy.commands in the config. Fixing its arguments as well is recommended.
  ```

  ```
  codaryn: 명령 실행 — 거부 (command/confirmation_required)
  …
  거부된 호출: 1건
  명령을 허용하려면 설정의 policy.commands에 규칙을 더하세요. 인자까지 고정하길 권합니다.
  ```

- 두 가지가 겹친다.
  1. **질문 줄이 없다.**
     - 사람용 렌더러(`src/cli/human/output.ts`의 `progressLine`)에 `confirmation_requested`·`confirmation_answered`의 case가 없다.
     - 그래서 U-74의 문구(`progress.confirmation_denied.default` "권한 확인 — 기본값으로 거부함(…물을 수 없었거나…)")가 쓰이지 않는다.
     - 영어 줄(`src/cli/progress.ts:140-147`)은 렌더러가 없을 때만 쓰인다.
     - 사람은 "정책이 막았다"와 "물을 수 없어 기본값으로 거부했다"를 가를 수 없다. 코드 `confirmation_required`만 보인다.
  2. **끝 요약의 안내가 거꾸로 이끈다.**
     - `summary.denied_hint`는 "규칙을 더하라"고 한다. 그런데 규칙은 이미 있고, 묻게 되어 있다.
     - 안내대로 같은 명령의 보통 규칙을 더하면, 3절 마지막 줄들처럼 **그 명령은 묻지 않고 돈다.** `confirm`을 둔 뜻이 사라진다.
     - 이 단위가 `confirm`을 처음 켤 수 있게 했으므로, 이 안내가 처음 보이는 것도 이 단위부터다.
- 영향: 질문을 원해서 `confirm`을 둔 사람이, CLI의 안내를 따르면 질문 없는 허용으로 바꾸게 된다. 기록에는 남지만 사람용 출력만으로는 까닭을 알 수 없다.
- 고칠 방향(제안)
  - 사람용 렌더러에 두 사건의 case를 더한다. 문구는 U-74로 이미 있다. 담당은 nc-human이다. U-110(터미널 질문)과 함께 해도 된다.
  - 거부된 호출이 모두 `confirmation_required`이면 `summary.denied_hint`를 내지 않는다. 대신 "묻는 규칙이라 이 CLI는 아직 묻지 못해 거부했다. 묻지 않고 돌리려면 그 규칙의 `confirm`을 지운다(질문이 없어진다)"는 뜻의 줄을 둔다. 새 문구 id가 필요하다.
  - 또는 U-110 전까지 18.16에 이 안내를 적는다.

## 5. 낮음

### R85-L1 설정의 `confirm` 규칙을 쓰던 프로필이 자기 보통 규칙을 갖는 변경이 `confirm_removed`로 잡히지 않는다

- 위치: `src/app/settings-change.ts:207-212`. 프로필은 예전 프로필의 `policy`끼리만 견준다(`old.policy?.commands ?? []`). 예전 프로필에 정책이 없었으면(설정의 정책을 썼으면) 빈 목록과 견주게 되고, `confirm_removed`만 남기는 거름에 걸려 아무것도 남지 않는다.
- 재현(W, `r85.log`): `proposeSettingsChange`를 직접 불렀다.

  | 바뀜 | 넓히기 |
  | --- | --- |
  | 설정의 `confirm` 규칙에서 `confirm`을 지움 | `confirm_removed@policy.commands[0]` |
  | 프로필의 `confirm` 규칙에서 `confirm`을 지움 | `profile_changed@profiles`, `confirm_removed@profiles.p.policy.commands[0]` |
  | `confirm` 규칙 옆에 `node` 아무 인자나 허용하는 보통 규칙을 더함 | `command_added@policy.commands[1]`, `extra_args_allowed@policy.commands[1]` |
  | **설정의 `confirm` 규칙을 쓰던 프로필 p가 같은 명령의 보통 규칙을 자기 정책으로 가짐** | **`profile_changed@profiles`만** |
  | `confirm` 규칙을 지움 | 없음(좁히기) |
  | 보통 규칙에 `confirm`을 더함 | 없음(좁히기) |

- 영향: 넓히기로는 잡힌다(`profile_changed`). 그래서 GUI는 확인을 받는다. 그러나 그 프로필로 도는 실행에서 묻던 명령이 묻지 않게 된다는 이름(`confirm_removed`)은 없다. 사람이 확인 화면에서 그 뜻을 읽지 못할 수 있다.
- 고칠 방향(제안): 예전 프로필에 `policy`가 없으면 설정의 예전 `policy`와 견준다(`old.policy ?? before.policy`).

## 6. 정보

- **R85-I1 묻던 명령이 조용히 허용되는 두 조합은 설계대로다.**
  - 같은 실행 파일의 넓은 보통 규칙(U-74: 보통 규칙이 허용하면 묻지 않는다), 정책을 대신하는 프로필(`config-file.ts:166` `profile.policy ?? config.policy`)이다.
  - 둘 다 사람이 자기 설정에 쓴 것이다. 18.16과 계약이 적었다.
  - 다만 M1의 안내가 바로 이 조합으로 이끈다.
- **R85-I2 task 파일로 도는 실행에서는 `confirm`이 늘 없다.** task 파일은 자기 정책만 쓰고, 그 정책은 `confirm`을 받지 않는다. 그래서 task 형식(`--task`)에는 질문이 생길 수 없다. 작업과 함께 오는 파일이 질문을 만들 수 없게 한 설계(Q-2)와 맞다.
- **R85-I3 기록의 두 사건은 고정 필드뿐이다.**
  - `confirmation_requested`: `kind`, `id`(q1), `callId`, `tool`, `permission`, `subject`(가린 실행 파일 경로), `argumentCount`
  - `confirmation_answered`: `id`, `decision`, `by`
  - 모델이 준 인자 글은 어디에도 없다.
- **R85-I4 `doctor`는 묻는 규칙이 있다는 것을 말하지 않는다**(18.16에 "알림은 아직 없다"). 지금 CLI에서는 그런 규칙이 늘 거부로 끝나므로, 알림이 있으면 M1의 혼동을 줄인다.

## 7. 검사하지 않은 범위

- 실제 터미널 질문(이 단위에 없음, U-110), GUI·앱 계층의 실행 중 질문
- `allow_once` 뒤 재판정(엔진, U-74 검토에서 봄)
- Linux·macOS의 실행 파일 경로 표기

## 8. PM 판단 필요

- **Q-1(R85-M1)**: 두 가지를 정한다.
  - 사람용 렌더러에 질문 줄을 언제 넣을지: 지금(이 단위의 후속), 또는 U-110과 함께
  - `confirmation_required`만으로 거부된 실행에서 "규칙을 더하라"는 안내를 무엇으로 바꿀지(새 문구 id 필요)
  - 가정: 안내는 이 단위의 후속에서 바꾼다. `confirm`을 처음 켜는 단위이기 때문이다.
- **Q-2(R85-L1)**: 정책 없던 프로필의 비교를 설정의 예전 정책과 할지. 가정: 한다.

사용자에게 물을 질문은 없다.


---

# R-88 병합 전 보안 검토: 단위 U-109 + U-110, 확인 규칙과 터미널의 권한 질문 (w3:p5, 2026-11-13)

## 0. 대상과 방법

- 페르소나: 보안·개인정보 검토. 읽기 전용이다. 저장소 수정·커밋은 없다. 실제 API와 바깥 네트워크는 쓰지 않았다.
  - 모델은 127.0.0.1의 가짜 Anthropic 서버(대본처럼 답함)다. 키는 가짜 값이다.
  - 모든 CLI 호출에 시험의 네트워크 막이(`dist/tests/support/net-guard.js`)를 얹었다.
  - 기본 설정 위치(APPDATA, XDG, HOME)는 사례마다 새 폴더로 돌렸다.
- **검토한 판: `pm/unit-U-110` = `79b16c8`**(main `dc100dc` 위, 14파일 +774 −18)
  - 브랜치: `unit/U-109-na-core`, `unit/U-110-na-core`, `unit/U-110-nc-human`
  - 제품 코드: `src/cli/{config,confirm(새),main,run,task,terminal(새)}.ts`, `src/contracts/human.ts`, `src/i18n/{en,ko}.ts`
  - 문서: `docs/cli-contract.md` 18.16·18.17
  - 새 시험 4파일
- 사본: `git archive`로 `.codaryn/r88/base`(`dc100dc`)와 `.codaryn/r88/u`(`79b16c8`)를 풀었다. 둘 다 `tsc` 0이다.
- 터미널 흉내: `tty.mjs`를 미리 불러 stdin·stderr의 `isTTY`를 참으로 했다. models는 stdout까지 참으로 했다(`tty-out.mjs`).
  - 질문이 기다리면(줄바꿈 없이 멈추면) 답을 쓴다.
  - stdin은 파이프다. 그래서 두 가지로 나눠 보았다.
    - (가) 파이프를 닫는다: 입력이 정말 끝난다.
    - (나) 파이프는 연 채 키를 친다: Ctrl+D는 `\u0004`, Ctrl+C는 `\u0003`. readline이 터미널 방식으로 읽는다. `tty-raw.mjs`로 `setRawMode`가 있을 때도 보았다. 실제 터미널에 더 가깝다.
- 실험 스크립트와 로그(`.codaryn/r88/`)
  - `r88.mjs`(`r88.log`): A~F, 질문·답·가림·취소·같은 출력
  - `r88b.mjs`(`r88b.log`): G, init·apply·models의 질문을 두 판에서 견줌. (가) 방식
  - `r88c.mjs`(`r88c.log`): H1~H3, 키로 친 Ctrl+D·Ctrl+C. (나) 방식
  - `r88d.mjs`·`r88e.mjs`(`r88d.log`·`r88e.log`): H4~H6, 끝난 뒤 프로세스가 끝나는지, init 도중의 Ctrl+C
  - 따로 확인한 것(scratch의 `eof2.mjs`, `linger.mjs`): `askLine`을 직접 불러 끝난 입력과 남은 읽기를 보았다.
- 수치(고정 판 트리 `79b16c8`, 내 worktree에서 분리 체크아웃해 dist를 지우고 빌드한 뒤 원래 브랜치로 돌아옴)
  - typecheck 0
  - 유닛 2971(통과 2967, 실패 0, 건너뜀 3, todo 1)
  - 통합 564/564
  - PM의 수치와 같다.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 2 (R88-M1, R88-M2) |
| 낮음 | 2 (R88-L1, R88-L2) |
| 글(nb-i18n 확인 몫) | 3 (R88-T1~T3) |
| 정보 | 4 (R88-I1~I4) |

| 볼 것 | 결과 |
| --- | --- |
| (1) R-85 M1이 닫혔나 | **닫히지 않았다(R88-M1).** 실행이 센 값과 글 id는 들어왔다. 그러나 사람용 렌더러가 그것을 쓰지 않는다. 두 언어 모두 질문 뒤 거부에도 여전히 '규칙을 더하라'가 나오고, 질문·답의 진행 줄이 없다 |
| (2) 터미널의 답 | **맞다.** y·yes·예·네(앞뒤 공백, 대문자 포함)는 그 호출 한 번만 돈다. 그 밖의 답과 Enter는 그 사람의 거부다. 다음 호출은 다시 묻는다. 입력 끝은 답이 없는 거부다 |
| (3) 물을 수 없을 때 | **맞다.** 터미널이 아니거나 `--quiet`이면 묻지 않고 기본 거부다. 파이프로 넣은 `y`는 답이 되지 않는다 |
| (4) 질문 줄 | **맞다.** 인자와 경로는 나오지 않고 실행 파일과 인자 개수만 나온다. 키 모양과 등록 값은 가려진다. 줄바꿈·제어 문자는 `?`로 바뀐다. `confirmQuestion` 함수만 놓고 보면 키를 가리지 않는다(I1) |
| (5) 기다리는 동안의 취소·시간 | 취소 파일은 `cancelled`(종료 5), 시간 한도는 `default`(종료 4)로 맞다. **Ctrl+C는 실행을 취소하지 않는다(R88-M2).** 답 없음으로 기록되고 실행이 다음 턴으로 간다 |
| (6) 확인 규칙이 없을 때, 다른 질문들 | **확인 규칙이 없으면 main과 같다**(두 언어, 터미널 여부: stdout·stderr·journal·실행 결과). apply·models·init의 보통 답도 같다. 입력 끝은 main의 종료 13이 고쳐졌다. 남은 것은 아래 둘이다: |
| | - 질문을 키로 닫은 뒤에도 프로세스가 끝나지 않는다(R88-L1, main에도 있음) |
| | - 이미 끝난 입력에 다음 질문을 하면 종료 13이다(R88-L2) |
| (7) 기록 `by` | `user`·`default`·`cancelled`가 각 경우에 맞다. 다만 Ctrl+C는 `default`로 남는다(R88-M2) |

## 2. 결과

### A. 질문 뒤 거부의 사람용 출력 (R-85 M1)

모델이 `node ask.mjs`를 한 번 부르고, 규칙에 `confirm: true`가 있다.

| 경우(en·ko 같음) | 실행 결과 | 돈 횟수 | 기록 | 끝 요약 |
| --- | --- | --- | --- | --- |
| 터미널 아님 | needs-input, 종료 3 | 0 | deny/default | "To allow a command, add a rule to policy.commands…" |
| 터미널, 답 n | 같음 | 0 | deny/user | 같음 |
| 터미널, 입력 끝 | 같음 | 0 | deny/default | 같음 |
| 터미널, `--quiet` | 같음 | 0 | deny/default | (요약 없음, `--quiet`) |

- 한국어도 같다: "명령을 허용하려면 설정의 policy.commands에 규칙을 더하세요. 인자까지 고정하길 권합니다."
- 진행 줄은 "run command — denied (command/confirmation_required)" 하나뿐이다. 질문과 답의 진행 줄(`progress.confirmation_*`)이 없다.
- 질문 줄 자체는 맞게 나온다.

### B. 답 (모델이 두 번 부름)

| 친 답 | 돈 횟수 | 질문 | 기록 |
| --- | --- | --- | --- |
| y, n | 1 | 2 | allow_once/user, deny/user |
| yes, yes | 2 | 2 | allow_once/user ×2 |
| 예, 네 | 2 | 2 | allow_once/user ×2 |
| "␣␣Y␣␣", YES | 2 | 2 | allow_once/user ×2 |
| no, Enter | 0 | 2 | deny/user ×2 |
| ㅛ, yy | 0 | 2 | deny/user ×2 |
| n, y | 1 | 2 | deny/user, allow_once/user |
| (가) 첫 질문에서 입력이 끝남 | 0 | 1 | q1 deny/default, q2 질문 기록 뒤 끝 없음. **종료 13**, JSON·result.json 없음, `lock.json` 남음 (L2) |
| (나) Ctrl+D 키, 다음에 y | 1 | 2 | deny/default, allow_once/user. 종료 3 (H1) |

### C. 묻지 않을 때

- 터미널이 아니고 stdin에 `y`를 넣어 둠: 묻지 않는다. stderr에 질문 글이 없다. 돈 횟수 0, deny/default.
- 터미널이고 `--quiet`, `y`를 칠 준비: 질문 0, 돈 횟수 0, deny/default.

### D. 질문 줄

- 모델의 인자 `["ask.mjs", "R88ARGCANARY", "C:/r88/private/notes.txt"]`
  - 질문: "…Only its executable and its number of arguments (3) are shown, not the arguments themselves. Executable: `<node>` [y/N]"
  - stderr 어디에도 인자가 없다.
- 실행 파일 경로에 키 모양과 등록 값(`secretEnv`)을 넣음
  - 질문과 journal의 subject 모두 `C:/r88-bin/[key]/[[CODARYN_SECRET:…]]/tool.exe`
  - stderr에 키 모양도 등록 값도 없다.
- `confirmQuestion`을 직접 부름
  - 줄바꿈과 ESC·BEL은 `?`로 바뀌고 한 줄이다.
  - 키 모양은 그대로 남는다(I1).

### E·H. 기다리는 동안

| 경우 | 결과 | 기록 |
| --- | --- | --- |
| 취소 파일이 생김 | cancelled/cancelled, 종료 5, 0.5 s, 돈 횟수 0 | deny/cancelled |
| 답 없음, maxDurationMs 4000 | budget-exhausted/max_duration, 종료 4, 4.3 s | deny/default |
| (나) Ctrl+C 키, 두 번 부르는 모델(H1, `setRawMode` 있고 없고 같음) | 실행이 계속된다. 모델 턴 3, **두 번째 질문을 또 묻는다**. needs-input, 종료 3 | deny/default, 그다음 답 |
| (나) Ctrl+C 키, 한 번 부르는 모델(H4) | 실행은 0.3 s에 끝났다. 프로세스는 입력을 닫을 때(8 s 뒤)까지 남았다(L1) | deny/default |

### F. 확인 규칙이 없을 때 (base와 u)

- en·ko, 터미널 아님·터미널, 네 경우 모두 같다: 종료 코드 3/3, stdout, stderr, journal, 명령이 돈 횟수 1/1.

### G. 다른 질문들 (base와 u, (가) 방식)

| 명령 | 경우 | base | u | 비교 |
| --- | --- | --- | --- | --- |
| init | 모두 Enter | 0 | 0 | 출력과 쓴 설정 모두 같음 |
| init | 첫 질문에 n | 3 | 3 | 같음 |
| init | 첫 질문에서 입력 끝 | **13** | 3 ("Nothing was created.") | 고쳐짐 |
| init | Enter, 둘째 질문에서 입력 끝 | 13 | **13** | 셋째 질문이 끝나지 않음(L2) |
| init | Enter 둘, 셋째에서 입력 끝 | 13 | **13** | 같은 까닭 |
| apply(--digest 없음) | y | 0 | 0 | 같음. stdout은 `durationMs`만 다름 |
| apply | n, Enter | 2 | 2 | 같음 |
| apply | 입력 끝 | **13** | 2 (`plan_not_approved`) | 고쳐짐 |
| models | 2, Enter | 0 | 0 | 같음. 쓴 설정도 같음 |
| models | 입력 끝 | **13** | 0 (건너뜀) | 고쳐짐 |

- (나) 방식(H2·H3·H6, base와 u 같음)
  - init 첫 질문의 Ctrl+D 키는 "Nothing was created."로 종료 3이다.
  - 둘째 질문의 Ctrl+D 키나 Ctrl+C 키는 그 질문을 기본값으로 넘긴다. init은 남은 질문을 계속 묻고 설정을 쓴다(종료 0, I2).
- revert의 질문(위험한 이동 동의)은 만들지 못했다. 같은 `askLine`을 한 번만 부른다.

## 3. 발견

### R88-M1 (중간) R-85 M1이 닫히지 않았다: 렌더러가 새 요약과 진행 줄을 쓰지 않는다

- 들어온 것
  - `run.ts`가 질문 뒤 거부를 `RunSummaryContext.confirmationDenied {user, default, cancelled, couldAsk}`로 센다.
  - `contracts/human.ts`와 `i18n`에 `summary.confirm_denied.{user,unasked,unanswered,cancelled}` 글이 있다.
- 빠진 것: 사람용 렌더러 `src/cli/human/output.ts`가 이 판에서 바뀌지 않았다.
  - `confirmationDenied`와 `summary.confirm_denied.*`를 쓰지 않는다.
  - `deniedCommandCalls > 0`이면 그대로 `summary.denied_hint`를 낸다(`output.ts:417-418`).
  - `confirmation_answered`의 진행 줄(`progress.confirmation_allowed`, `progress.confirmation_denied.<by>`)도 없다.
- 문서와 어긋난다: `docs/cli-contract.md` 18.17은 이미 된 일처럼 쓴다.
  - "렌더러는 그 호출에 '규칙을 더하라'(`summary.denied_hint`)를 내지 않는다."
  - "대신 0보다 큰 것마다 한 줄"
- 시험이 이를 잡지 못한다: `tests/unit/cli/g-u110-r85-summary.test.ts`는 렌더러에 넘기는 값만 보고, 그려진 글은 보지 않는다.
- 영향: 확인 규칙이 있는 명령을 사람이 거부하거나 물을 수 없어 거부되면, 요약은 "policy.commands에 규칙을 더하라"고 한다.
  - 그 명령에는 이미 규칙이 있다.
  - 이 안내를 따라 확인 없는 규칙을 더하면 묻는 단계가 사라진다. 권한이 넓어지는 쪽이다.
  - R-85에서 중간으로 본 그대로다.
- 고칠 곳: `src/cli/human/output.ts`(nc-human)
  - 그 호출을 `denied_hint`에서 빼고, 0보다 큰 `by`마다 줄을 낸다.
  - 질문 기록마다 진행 줄을 낸다.
  - 그려진 글을 두 언어로 보는 시험을 둔다.
- 모습: A 표. en·ko, 세 경우 모두.

### R88-M2 (중간) 질문 중의 Ctrl+C가 실행을 취소하지 않는다: 답 없음으로 기록되고 실행이 계속된다

- 원인
  - readline은 터미널 방식에서 stdin을 raw로 둔다. 그래서 Ctrl+C가 신호(SIGINT)가 아니라 키로 들어온다. 운영 체제가 신호를 보내지 않으니 CLI의 취소(`cancel.ts`의 SIGINT 처리)가 불리지 않는다.
  - Node 26.13.1 readline의 Ctrl+C 처리는 이렇다: 인터페이스에 'SIGINT' 듣는 쪽이 없으면 `close()` 하고, 질문을 'Aborted with Ctrl+C'로 거절한다.
  - `askLine`은 이것을 null로 받는다. `terminalConfirm`은 답 없음(dismissed)으로 돌려주고, 엔진은 `deny`/`default`로 기록한다.
- 모습: H1(`setRawMode` 있고 없고 같음)
  - Ctrl+C 키 뒤에도 모델 턴이 이어졌다(3턴).
  - 두 번째 호출에서 또 물었다.
  - 기록은 deny/default다(cancelled가 아님).
- 기대와 어긋난다
  - 계약은 취소를 SIGINT로 받는다고 한다(cli-contract 56행).
  - 18.17은 Ctrl+C를 말하지 않는다.
  - 사람은 Ctrl+C로 실행 전체를 멈추려 한다. 그런데 모델 호출(비용)과 규칙이 허용한 다른 도구 호출이 계속된다.
  - 끝 요약을 렌더러가 붙이면 `unanswered`로 "입력이 끝났거나 시간 한도"라고 할 것이다. 일어난 일과 다르다.
- 권한을 넓히지는 않는다: 그 호출은 거부된다. 다음 질문도 사람이 답해야 돈다.
- 고칠 방향(na-core 판단): `askLine`(또는 질문 통로)에서 readline 인터페이스의 'SIGINT'를 듣고 실행 취소로 돌린다.
  - 예: 같은 취소 통로를 abort한다. 그러면 엔진의 신호가 질문을 끝내고 기록이 `cancelled`가 된다.
  - apply·revert·models·init의 질문에서도 Ctrl+C는 지금 '아니오/기본값'이다. init은 이어서 묻고 설정을 쓴다(I2). 같이 정할 일이다.
- 실제 터미널로는 확인하지 못했다(흉내). 판단 근거는 Node 소스와 raw 방식의 동작이다.

### R88-L1 (낮음) 질문을 Ctrl+D·Ctrl+C 키로 닫으면, 명령이 끝나도 입력이 열린 동안 프로세스가 끝나지 않는다

- 모습
  - H4: run은 0.3 s에 끝나고 요약까지 썼다. 프로세스는 하네스가 입력을 닫은 8 s 뒤에야 끝났다. Ctrl+D·Ctrl+C 모두 그렇다.
  - H5: apply도 같다. **main(base)도 같다.**
  - 보통 답(`n⏎`)이면 0.5 s에 끝난다.
- 원인(`linger.mjs`로 확인)
  - 키로 닫으면 readline이 stdin의 'data' 처리 안에서 `pause()` 한다.
  - Node의 stdin 'pause' 처리(다음 tick의 readStop)가 돌고, 이어서 Readable의 read-more가 다시 읽기를 시작한다.
  - 결과: `readableFlowing`은 false인데 handle은 계속 읽는다(`handleReading: true`). 보통 답이면 나중에 false가 된다.
- 영향: 실제 터미널에서 입력은 저절로 끝나지 않는다.
  - Ctrl+D·Ctrl+C로 질문을 닫은 사람에게는 CLI가 요약 뒤에 멈춘 것처럼 보일 수 있다.
  - raw가 풀린 뒤 Ctrl+D(입력 끝)나 Ctrl+C를 한 번 더 눌러야 할 것이다.
  - 18.17의 "이제 그 질문들도 입력 끝을 '아니오'(또는 답 없음)로 받는다"는 답에 대해서는 맞다. 셸로 돌아오는 것까지는 아니다.
- U-110이 만든 문제는 아니다(main의 apply도 같다). 다만 run의 질문이 같은 길을 새로 탄다.
- 실제 터미널로는 확인하지 못했다(흉내). 고칠 방향 예: 질문마다 stdin을 `ref()` 했다가 끝나면 `unref()`, 또는 질문이 끝난 뒤 읽기를 확실히 멈춤. 실제 터미널로 확인해야 한다.

### R88-L2 (낮음) 이미 끝난 입력에 다음 질문을 하면 끝나지 않는다: 종료 13, 결과 없음, 잠금 남음

- 원인: `askLine`은 질문마다 새 readline 인터페이스를 만든다.
  - 입력이 이미 끝났으면 새 인터페이스에는 'close'도 줄도 오지 않는다. 약속이 끝나지 않는다.
  - 이벤트 루프가 비어 Node가 "unsettled top-level await"로 종료 13을 낸다.
  - `eof2.mjs`: 첫 `askLine`은 null, 둘째는 끝나지 않음. 종료 13.
- 모습
  - run(B (가)): 첫 질문에서 입력이 끝남 → q1은 deny/default. q2를 기록한 뒤 종료 13. stdout JSON도 result.json도 없고 `lock.json`이 남는다.
  - init(G): 둘째·셋째 질문에서 입력이 끝나면 종료 13. base도 같다.
- 실제 터미널에서는 드물다
  - Ctrl+D 키는 인터페이스만 닫고 스트림을 끝내지 않는다. 그래서 다음 질문이 보통대로 묻는다(H1: Ctrl+D 뒤 y로 한 번 돎).
  - stdin이 터미널인데 정말 끝나는 경우(터미널이 닫힘, 터미널로 보이는 파이프)에만 나온다.
- 18.17의 "모든 질문의 한 줄 읽기는 입력이 끝나면 null로 끝난다"는 끝난 그 질문에만 맞다.
- 고칠 방향 예: `askLine`이 `input.readableEnded`(또는 한 번 들은 'end')면 곧 null을 돌려준다.

## 4. 글 (nc-human의 `summary.confirm_denied.*`, "p4g-general과 nb-i18n 확인용")

- 금지어(안전·보장·차단 등, workflow, 보관함 단독)는 없다. 매개변수 `{count}`는 글마다 한 번씩이다.
- **R88-T1** ko `summary.confirm_denied.unasked`: "…--quiet이 아닐 때만 묻습니다"
  - 옵션 이름 바로 뒤에 받침 따라 바뀌는 조사가 붙었다(우리 규칙: 불변형이나 "--x 옵션을").
  - 제안: "…모두 터미널이고 --quiet 옵션이 없을 때만 묻습니다"
  - 같은 글의 "stderr가"도 코드 이름 뒤 조사다. 기존 글(253·276·285행)과 같이 쓰므로 바꿀지는 PM 판단이다.
- **R88-T2** `summary.confirm_denied.unanswered`와 `progress.confirmation_denied.default`
  - 답이 없는 까닭으로 "입력 끝, 시간 한도"만 든다.
  - R88-M2를 그대로 두면 Ctrl+C도 여기에 들어오니, 글에 Ctrl+C를 더해야 한다.
  - M2를 고쳐 Ctrl+C가 취소가 되면 지금 글이 맞다. M2의 결정 뒤에 정한다.
- **R88-T3** ko `summary.confirm_denied.cancelled`: "…호출 {count}건은 답을 기다리는 동안 실행이 취소되어 거부했습니다"
  - 주어가 "호출은"인데 "거부했습니다"라 어색하다.
  - 제안: "…취소되어 거부되었습니다"
- 이 글들은 렌더러가 붙기 전까지 쓰이지 않는다(M1). 지금 고치는 비용이 작다. `src/i18n/**`는 내 소유이니 PM이 맡기면 고친다.

## 5. 정보

- **R88-I1** `confirmQuestion`만으로는 키 모양을 가리지 않는다(D). 실제 CLI에는 두 겹이 있어 새지 않는다.
  - `main.ts`가 `cleanText(hideKeys(…))`로 감싼다.
  - 엔진이 준 subject는 이미 `[key]`로 가려져 있다.
  - 다른 곳(GUI 등)이 이 함수를 쓸 때를 위해, 함수 안에서도 가리면 한 겹 더 된다.
- **R88-I2** init 도중의 Ctrl+D·Ctrl+C 키는 init을 멈추지 않는다. 그 질문을 기본값으로 넘기고 남은 질문을 묻고 설정을 쓴다(H2·H6, 종료 0). base도 같다. M2와 함께 정할 일이다.
- **R88-I3** Windows의 Ctrl+Z
  - 18.17은 Ctrl+Z를 입력 끝이라 한다.
  - Node readline은 터미널 방식의 win32에서 Ctrl+Z 키를 무시한다(`case 'z': if (process.platform === 'win32') break;`).
  - 그래서 Windows 콘솔에서 Ctrl+Z 뒤 Enter는 빈 줄, 곧 그 사람의 거부(deny/user)가 될 것이다. 결정은 같은 거부이고 기록의 `by`만 다르다.
  - 소스로만 보았고 실제 콘솔로는 확인하지 못했다.
- **R88-I4** 이전에 남긴 두 점
  - `--json`과 질문: 계약 18.17이 "run에는 --json 옵션이 없다"고 적었다. 앞서 PM에게 알린 점(질문은 stdin·stderr와 `--quiet`만 본다)은 문서와 맞다.
  - E의 Ctrl+C 사례에서 프로세스가 30 s까지 남은 것은 L1으로 설명된다.

## 6. 검사하지 않은 범위

- 실제 터미널(Windows 콘솔, Unix pty): 모두 흉내다. M2·L1·I3는 Node 소스와 흉내로 판단했다.
- revert의 위험한 이동 동의 질문(만들 조건이 없었다)
- GUI(이 판은 GUI를 고치지 않았다)
- Linux·macOS

## 7. PM 판단 필요

- M1: 렌더러 단위를 언제, 누가 할지(nc-human). 그 전까지 18.17의 두 문장이 코드보다 앞서 있다.
- M2: 질문 중 Ctrl+C를 실행 취소로 할지. apply·revert·models·init의 Ctrl+C도 같이 정할지(I2).
- T1~T3: 고칠지와 맡을 사람(내 소유 파일).
- 사용자에게 물을 질문은 없다.


---

# R-88b 좁은 확인: U-109 + U-110 고친 판 (w3:p5, 2026-11-13)

## 0. 대상과 방법

- 페르소나: 보안·개인정보 검토. 읽기 전용이다. 저장소 수정·커밋은 없다. 실제 API와 바깥 네트워크는 쓰지 않았다.
  - 모델은 127.0.0.1의 가짜 Anthropic 서버(대본처럼 답함, 받은 요청 수를 셈)다. models의 목록도 127.0.0.1의 가짜 서버다. 키는 가짜 값이다.
  - 모든 CLI 호출에 시험의 네트워크 막이를 얹었다. 기본 설정 위치는 사례마다 새 폴더로 돌렸다.
- **고정 판: `pm/unit-U-110` = `5e2885e`**(main `00cc57b` 위, 19파일 +1418 −19)
  - R-88 판(`79b16c8`) 뒤에 들어온 것
    - nc-human `5cb6c2a`: 렌더러 `src/cli/human/output.ts`
    - na-core `b13ece5`·`f4ebb7f`·`85b5d2f`
      - 제품 코드: `src/cli/terminal.ts`, `src/cli/main.ts`
      - 글 `prompt.interrupted`
      - 문서 18.17
      - 시험 `g-u110-r88-terminal.test.ts`
- 사본: `git archive`로 `.codaryn/r88b/base`(`00cc57b`)와 `.codaryn/r88b/u`(`5e2885e`)를 풀었다. 둘 다 `tsc` 0이다.
- **터미널은 흉내다. 실제 터미널(Windows 콘솔, Unix pty)로는 확인하지 못했다.**
  - 미리 읽는 모듈이 stdin·stderr(models는 stdout까지)의 `isTTY`를 참으로 둔다. `tty-raw.mjs`를 더하면 stdin에 `setRawMode`가 생긴다.
  - stdin은 파이프다. readline이 터미널 방식으로 읽는다. Ctrl+C는 0x03, Ctrl+D는 0x04 바이트로 쳤다.
  - 키를 친 뒤에도 입력은 열어 두었다. 8 s(일부 3~6 s) 뒤에 하네스가 닫는다. 그래서 "입력이 닫힐 때까지 남은 프로세스"가 시간으로 드러난다.
  - 실제 터미널의 raw 방식과 신호(SIGINT)는 그대로 재현되지 않는다.
- 실험: `.codaryn/r88b/r88b.mjs`(로그 `r88b.log`), `r88b-raw.mjs`(로그 `r88b-raw.log`, 질문 뒤 stderr 원문)
- 수치(고정 판 트리 `5e2885e`, 내 worktree에서 분리 체크아웃해 dist를 지우고 빌드한 뒤 원래 브랜치로 돌아옴)
  - typecheck 0
  - 유닛 3026(통과 3022, 실패 0, 건너뜀 3, todo 1)
  - 통합 584/584
  - PM의 수치와 같다.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 0 |
| 낮음 | 1 (R88b-L1) |
| 정보 | 4 (R88b-I1~I4) |

| 볼 것 | 결과 |
| --- | --- |
| M1 진행 줄과 끝 요약 | **닫혔다.** 네 경우(물을 수 없었다, 사람이 거부, 답이 없었다, 취소)와 허용이 두 언어에서 사실대로 나온다. 질문 뒤 거부된 그 호출에는 '규칙을 더하라'가 나오지 않는다 |
| M1 규칙 없는 거부와 섞임 | 질문에 답이 난 경우(n, Ctrl+D, 터미널 아님)는 안내가 남는다. **실행이 질문에서 끝난 경우(취소, 시간 한도)는 규칙 없는 호출의 안내까지 빠진다(R88b-L1)** |
| M2 run의 Ctrl+C | **닫혔다.** 실행 전체가 cancelled(종료 5)다. 기록은 `deny`/`cancelled`다. 그 뒤 모델 호출이 없다(가짜 서버가 센 요청 수 = journal의 요청 수). 잠금이 풀리고 result.json이 있다 |
| M2 apply·models·init의 Ctrl+C | **닫혔다.** 종료 5, "Stopped with Ctrl+C. Nothing more was changed." 한 줄이다(ko도 같음) |
| | - apply: 작업 공간이 그대로다. 새 실행 폴더가 없고 잠금이 없다 |
| | - models: 설정이 그대로다 |
| | - init: 다섯 질문 어디서 눌러도 설정을 쓰지 않는다 |
| | - revert는 만들지 못했다(코드 읽기, 5절) |
| L1 질문을 닫은 뒤 프로세스 | **닫혔다.** Ctrl+D·Ctrl+C로 닫아도 명령이 끝나면 0.4~1.5 s에 끝난다. main은 입력이 닫힐 때(8.4 s)까지 남았다 |
| L2 이미 끝난 입력 | **닫혔다.** run은 종료 3으로 결과를 낸다. 잠금이 풀리고 result.json이 있다. 둘째 질문은 묻지 않고 deny/default다. init은 종료 13이 아니라 종료 0이다(I3) |
| 뒷걸음: 보통 답, 파이프 입력 | **없다.** 일곱 가지 답의 돈 횟수·기록이 R-88과 같다. 파이프로 넣은 `y`, `--quiet`, 질문 줄(인자 없음)도 같다 |
| 뒷걸음: 다른 질문의 보통 답 | **없다.** init·apply·models의 보통 답은 main과 다음이 같다: 종료 코드, stdout, stderr, 쓴 상태 |
| 뒷걸음: 확인 규칙 없는 설정 | **main과 같다.** en·ko, 터미널 여부 네 경우 모두 같다: stdout, stderr, journal, 명령이 돈 횟수. 규칙 없는 호출의 안내도 그대로다 |

## 2. 결과

### M1. 질문 뒤 거부의 사람용 출력 (u, en·ko 같은 모양)

| 경우 | 실행 | 진행 줄 | 끝 요약(질문 줄) | '규칙을 더하라' |
| --- | --- | --- | --- | --- |
| 터미널 아님 | needs-input, 3 | denied by default | "Denied without asking: 1 call(s)… This run could not ask: …" | 없음 |
| 터미널, n | needs-input, 3 | denied by the person | "Denied by the person: 1 call(s)…" | 없음 |
| 터미널, y | needs-input, 3, 1번 돎 | allowed by the person, for this call only | (없음) | 없음 |
| 터미널, Ctrl+D 키 | needs-input, 3 | denied by default (질문 줄에 붙음, I1) | "Denied with no answer: 1 call(s)… (the input ended, or the time limit ended the wait)" | 없음 |
| 터미널, 입력 끝 | needs-input, 3 | 같음(I1) | 같음 | 없음 |
| 터미널, 답 없음, 시간 한도 4000 | budget-exhausted, 4 | denied by default | "Denied with no answer…" | 없음 |
| 터미널, 취소 파일 | cancelled, 5 | denied: the run was cancelled while it waited | "Denied because the run was cancelled while it waited: 1 call(s)…" | 없음 |
| 터미널, Ctrl+C 키 | cancelled, 5 | 같음 | 같음 | 없음 |

- 한국어도 같은 자리에 나온다. 예:
  - "권한 확인 — 사람이 거부함"
  - "실행 전에 확인을 받게 된 명령의 호출 1건을 사람이 거부했습니다."
  - "…1건은 답을 기다리는 동안 실행이 취소되어 거부했습니다."

규칙 없는 명령(`node norule.mjs`, `args_not_allowed`)이 먼저 거부되고 다음에 묻는 명령이 온 경우:

| 경우(en·ko 같음) | 거부된 tool_decision | "Denied calls" | 질문 줄 | '규칙을 더하라' |
| --- | --- | --- | --- | --- |
| 터미널 아님 | 2 | 2 | unasked 1 | **있음** |
| 터미널, n | 2 | 2 | user 1 | **있음** |
| 터미널, Ctrl+D | 2 | 2 | unanswered 1 | **있음** |
| 터미널, Ctrl+C | 1 | 1 | cancelled 1 | **없음** (L1) |
| 터미널, 취소 파일 | 1 | 1 | cancelled 1 | **없음** (L1) |
| 터미널, 시간 한도 | 1 | 1 | unanswered 1 | **없음** (L1) |

### M2. Ctrl+C 키

run(u, en·ko, `setRawMode` 있고 없고 같음):

| 경우 | 결과 | 기록 | 돈 횟수 | 모델 요청(서버/journal) | 잠금 | result.json | 끝난 시각 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 한 번 부름, Ctrl+C | cancelled, 5 | deny/cancelled | 0 | 1/1 | 풀림 | 있음 | 0.4~0.5 s |
| 두 번 부름, 첫 질문에 Ctrl+C | cancelled, 5 | deny/cancelled | 0 | 1/1 | 풀림 | 있음 | 0.4~0.5 s |
| 두 번 부름, y 뒤 둘째에 Ctrl+C | cancelled, 5 | allow_once/user, deny/cancelled | 1 | 2/2 | 풀림 | 있음 | 0.7~0.8 s |

다른 질문(base와 u):

| 명령 | 키 | base | u |
| --- | --- | --- | --- |
| apply(--digest 없음) | Ctrl+C | 종료 2 `plan_not_approved`. 입력이 닫힐 때(8.4 s)까지 남음 | **종료 5**, stdout JSON 없음(I2). 작업 공간 그대로, 새 실행 폴더 0, 잠금 없음. 0.4 s |
| apply | Ctrl+D | 종료 2. 8.4 s까지 남음 | 종료 2 `plan_not_approved`. 0.4 s |
| models | Ctrl+C | 종료 0, 설정 그대로. 8.4 s까지 남음 | **종료 5**, 설정 그대로. 0.4 s |
| models | Ctrl+D | 종료 0. 8.4 s까지 남음 | 종료 0(건너뜀). 0.4 s |
| init, Ctrl+C를 1번 질문(만들까?)에서 | | 종료 3, 쓰지 않음, 8.4 s까지 남음 | **종료 5**, 쓰지 않음, 0.4 s |
| init, 2·3·4번 질문(제공자, 명령 제안, 보호 경로)에서 | | **종료 13**, 쓰지 않음 | **종료 5**, 쓰지 않음, 0.7~1.2 s |
| init, 5번 질문(언어)에서 | | **종료 0, 설정을 씀** | **종료 5**, 쓰지 않음, 1.5 s |

- 한국어 줄: "Ctrl+C로 멈췄습니다. 더 바꾼 것은 없습니다."
- `prompt.interrupted`는 고정 글이다. 매개변수와 금지어는 없다.

### L1. 질문을 닫은 뒤 프로세스 (입력은 8 s 열어 둠, `setRawMode` 있고 없고 같음)

| 명령 | base | u |
| --- | --- | --- |
| apply, Ctrl+D | 종료 2, 8.4 s(입력이 닫힐 때) | 종료 2, 0.4 s |
| run, Ctrl+D | (main에는 질문 없음) | 종료 3, 0.5 s |
| run, n | | 종료 3, 0.5 s |
| init, Enter·Ctrl+D·Enter… | | 종료 0, 1.4 s |
| models, Ctrl+D | | 종료 0, 0.4 s |

### L2. 입력이 정말 끝나고 다음 질문이 옴

- run(두 번 부름, 첫 질문에서 입력 끝)
  - 종료 3이고 결과 JSON이 있다. journal은 needs-input으로 끝난다.
  - 기록은 deny/default 둘이다. stderr의 질문 줄은 하나다: 둘째는 묻지 않았다.
  - 잠금은 풀렸고 result.json이 있다.
- init(Enter… 뒤 2·3·4번 질문에서 입력 끝): base는 종료 13이고 쓰지 않았다. u는 종료 0이고 설정을 썼다(I3).

### 뒷걸음

- 보통 답(u, 두 번 부름): R-88의 B와 돈 횟수·기록이 같다.
  - y,n → 1번
  - yes,yes / 예,네 / "␣␣Y␣␣",YES → 2번
  - no,Enter / ㅛ,yy → 0번
  - n,y → 1번
  - 모두 0.7~0.9 s에 끝났다.
- 파이프 입력: 터미널이 아니고 `y`를 넣어 둠 → 묻지 않고 deny/default. 터미널이고 `--quiet` → 질문 0. 질문 줄에 인자가 없다.
- 다른 질문의 보통 답(base와 u): 아래 일곱 경우 모두 종료 코드·stdout·stderr·상태가 같다.
  - init 모두 Enter, init n
  - apply y, apply n, apply Enter
  - models 2, models Enter
- 확인 규칙 없는 설정(base와 u): en·ko × 터미널 아님·터미널.
  - 다음이 모두 같다: 종료 3/3, stdout, stderr, journal, 명령이 돈 횟수 1/1.
  - 규칙 없는 호출의 '규칙을 더하라'도 그대로다.

## 3. 발견

### R88b-L1 (낮음) 실행이 질문에서 끝나면, 규칙 없는 다른 호출의 '규칙을 더하라'까지 빠진다

- 모습(위 섞인 경우 표, en·ko)
  - 규칙 없는 명령이 `args_not_allowed`로 거부되었다.
  - 그 뒤 묻는 명령에서 실행이 취소(Ctrl+C, 취소 파일)되거나 시간 한도로 끝났다.
  - 끝 요약에는 "Denied calls: 1"과 질문 줄만 있고, 그 규칙 없는 호출을 위한 안내가 없다.
- 원인: 렌더러는 `deniedCommandCalls > confirmationDenied의 합`일 때만 안내를 낸다(`output.ts`).
  - 실행이 질문에서 끝나면 그 호출에는 `tool_decision`이 없다. 그래서 `deniedCommandCalls`에 들어 있지 않다.
  - 질문에서 끝나는 경우: `confirmation_answered` 뒤 곧 `run_finished`. 시간 한도의 `default`도, 취소의 `cancelled`도 그렇다.
  - 그런데 합에서는 빠진다. 위 예에서 `deniedCommandCalls` 1 > 합 1이 거짓이 된다.
  - 계약 18.17의 "그 호출은 `deniedCommandCalls`에도 들어 있다"는 이 두 경우에 맞지 않는다.
- 영향: 잘못된 안내가 아니라 빠진 안내다. 규칙 없는 호출은 그대로 거부되었고, "Denied calls"와 진행 줄은 맞다. 권한 쪽 위험은 없다.
- 고칠 방향 예: 안내를 덜어 낼 수를 '질문 뒤 `tool_decision`으로 거부된 호출'로 센다.
  - 예: run이 `confirmation_required`로 거부된 `tool_decision`을 따로 센다.
  - 또는 `run_finished`가 질문 바로 뒤면 그 호출을 빼고 센다.
  - 몫: na-core(run.ts) 또는 nc-human(output.ts).
- 같은 원인의 작은 어긋남
  - 질문에서 취소된 한 호출만 있는 실행은 "Denied calls" 줄이 없다. 그런데 "Denied because the run was cancelled…: 1 call(s)"는 있다.
  - 두 수가 세는 대상이 다르다. 그 줄 자체는 사실이다.

## 4. 정보

- **R88b-I1** 줄 없이 끝난 질문 뒤의 글이 질문 줄에 붙는다(`r88b-raw.log`).
  - run의 Ctrl+D·입력 끝: "…[y/N] codaryn: permission question — denied by default…"
  - apply·models·init의 Ctrl+C: "Apply this plan? [y/N] Stopped with Ctrl+C. Nothing more was changed."
  - run의 Ctrl+C와 보통 답은 줄을 바꾼다.
  - 보기만의 문제다. main의 apply 입력 끝도 같았다.
  - 질문이 줄 없이 끝나면 다음 글 앞에 줄바꿈을 하나 두면 된다.
- **R88b-I2** apply·models·init의 Ctrl+C는 `process.exit(5)`로 끝난다. 그래서 stdout에 JSON 한 줄이 없다.
  - 계약은 "끝 요약은 내지 않는다"고만 한다.
  - 질문은 stdin·stderr가 터미널일 때만 나온다. 그러나 stdout은 파이프일 수 있다(예: 결과를 다른 명령으로 넘김). 그 쪽은 빈 출력과 종료 5만 받는다.
  - revert의 질문은 첫 되돌림이 끝난 뒤다(코드: `once` 뒤). 그 결과 JSON도 나오지 않는다. 결과는 기록에 있다(계약에 적힘).
  - 그대로 둘지 PM 판단이다.
- **R88b-I3** init은 입력이 끝난 뒤의 질문을 '아니오'로 받고 설정을 쓴다(L2, 종료 0).
  - 보호 경로 제안의 기본값은 예(`[Y/n]`)다. 그런데 답 없음은 `yesNo(null)` = 아니오다.
  - 그래서 그 설정은 모두 Enter일 때와 다르다(`071d7dd7c5e5` ≠ `8d4945224b77`). 보호 경로가 덜 든다.
  - 실제 터미널의 Ctrl+D 키도 같은 길이다(L1 표의 init, 종료 0, 씀).
  - 계약의 "입력 끝을 '아니오'(또는 답 없음)로 받는다"와는 맞다. 보호 쪽 제안에 아니오를 쓰는 것이 맞는지는 PM 판단이다.
- **R88b-I4** R-88의 글 메모
  - T2(Ctrl+C가 '답 없음' 글에 빠짐)는 M2를 고쳐 맞게 되었다. Ctrl+C는 이제 cancelled 글이다.
  - T1(ko "--quiet이 아닐 때")과 T3(ko `.cancelled`의 "…거부했습니다")은 그대로다. 내 소유 파일이니 PM이 맡기면 고친다.

## 5. 검사하지 않은 범위

- **실제 터미널**(Windows 콘솔, Unix pty): 모두 흉내다. 실제 raw 방식, 실제 SIGINT, Windows의 Ctrl+Z는 재현하지 않았다.
- revert의 질문(위험한 이동 동의): 하드 링크가 되는 드라이브라 만들 조건이 없었다. 코드만 읽었다.
  - 질문은 첫 되돌림이 끝난 뒤라 잠금은 이미 풀려 있다.
  - Ctrl+C면 `stopAtInterrupt`로 종료 5다.
- apply의 위험한 이동 동의 질문: 같은 까닭으로 만들지 못했다. 코드상 첫 apply가 `consent_required`로 끝난 뒤(아무것도 옮기지 않음)에 묻는다.
- GUI, Linux·macOS

## 6. PM 판단 필요

- L1: 고칠지, 몫(na-core 또는 nc-human).
- I2: Ctrl+C로 멈춘 apply·models·init·revert가 stdout에 아무것도 내지 않는 것을 그대로 둘지.
- I3: 입력이 끝난 init이 보호 경로 제안(기본값 예)을 아니오로 쓰는 것.
- R-88 T1·T3 글.
- 사용자에게 물을 질문은 없다.
