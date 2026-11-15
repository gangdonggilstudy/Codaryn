# R-111 검토: pm/unit-G1 (U-247: GUI의 읽기 제외·k 편집과 analyze-private 안내)

- 검토: ne-verify (w3:p4). 읽기 전용이고 커밋하지 않았다.
- 판: `pm/unit-G1` = `c522bc869e13bcc58a37d9f621666ec0d07b11b4`. main `01333d18` 위에 U-247(p5u-gui)과 U-251(ne-verify)을 얹은 판이다.
- 범위: `git diff 01333d18 c522bc86 -- gui`. 판정에 쓰인 앱 계층의 함수(`src/app/settings-change.ts`)도 읽었다.
- 실제 API, 외부 네트워크, 임시 worktree는 쓰지 않았다. 탐침은 판 사본의 빌드를 불러 썼다.

## 결론

- **높음 0, 중간 0, 낮음 3, 참고 3.**
- 시험
  - 루트 build: exit 0
  - GUI `npm test`: 341/341
  - smoke 두 번: 221/221, 221/221
- (2-1) 설정 화면에서 읽기 제외 경로를 빼거나 k를 내리는 모든 길이 메인 프로세스의 넓히기 대화상자를 지난다.
  - 렌더러가 확인을 건너뛸 길은 없다.
  - 빈 목록, 다른 항목, 좁은 항목이나 넓은 항목만 남기는 빼기는 넓힘이다.
  - 똑같은 중복, Windows 대소문자, 끝 `/`·`\`, `./`의 빼기는 덮는 범위가 같아 넓힘이 아니다(관문과 같은 규칙).
  - k를 지우면 기본 5다. 전에 6 이상이었으면 넓힘이고, 5였으면 아니다.
- (2-2) 9e63369의 잠금 이어받기는 새 답이 오면 그 답을 따른다. 풀린 잠금이 잡힌 것으로 남지 않는다.
  - 다만 다시 점검하는 호출이 답 대신 거부(reject)로 끝나면 "잡힘"이 남는다(L-1).
- (2-3) analyze-private 안내의 첫 문장은 사실과 맞다.
  - 그 아래 경고 둘은 고른 프로필이 목록이나 정책을 가지면 거짓 경보다(L-2, L-3).
- (3) M-8.5를 "할 수 있음"으로, M-8.4를 새 안내에 맞게 고칠 글을 부록에 두었다.

## 1. 시험

판 사본 `.codaryn/r111/c` = `c522bc86`. GUI는 루트 dist를 쓰므로 루트 build가 먼저다.

| 시험 | 결과 |
|---|---|
| 루트 `npm run build` | exit 0 |
| GUI `npm test`(빌드 포함) | 341/341 |
| smoke 조용함 | 221/221, 32초, 시작 때 CPU 66%, node 25개, hostEndsWhenMainKilled 108 ms |
| smoke 부하 | 221/221, 77초, 시작 때 CPU 100%, node 115개, hostEndsWhenMainKilled 10,446 ms(NOTE: 5초 넘고 30초 안, 바쁜 기계의 경우) |

- 부하는 claude-operations worktree의 dist에서 루트 unit·integration을 두 갈래로 돌린 것이다.
- 기록: `r111/build.log`, `gui-unit.log`, `series.log`, `smoke-*.log`

## 2. 넓히기 대화상자를 지나는가

### 2.1 길

- 렌더러가 보내는 것은 둘뿐이다.
  - 편집 하나: 읽기 제외 더하기·빼기(빼기는 자리와 보인 글), k 설정·지우기
  - 제안의 토큰
- 메인 프로세스
  - `proposeSettings`: 편집을 `parseSettingsEdit`로 검사하고, 엔진 호스트가 지금 파일에 적용(`applySettingsEdit`)하게 한다. 앱 계층의 `proposeSettingsChange`가 넓힘을 판정하고, 새 설정은 메인에 남는다.
  - `applySettings`: 토큰으로 제안을 꺼낸다(한 번만 쓴다). 이름 없는 넓힘이면 쓰지 않는다. 넓힘이 있으면 `confirmWidening`(OS 대화상자, 기본 "쓰지 않음")을 묻는다.
- 앱 계층(`applySettingsChangeIn`)
  - 파일이 제안 때 그대로인지 본다(`baseDigest`).
  - 넓힘을 **다시** 판정한다. 넓힘이 있는데 `confirmWidening`이 참이 아니면 쓰지 않는다.
- 그래서 렌더러는 새 설정을 보낼 수도, 넓힘 목록을 바꿀 수도, 대화상자를 건너뛸 수도 없다. 판정은 편집 연산과 상관없이 앞뒤 설정의 비교다.
- 설정 파일을 쓰는 다른 길도 보았다.
  - 모델 고르기(`selectModel` → `writeConfigAtomic`)는 모델 필드만 바꾼다.
  - 첫 설정(`writeNewFile`, `wx`)은 없을 때만 만든다.
  - 둘 다 읽기 제외와 k를 건드리지 않는다.

### 2.2 판의 함수로 잰 판정 (`.codaryn/r111/probe/widen.mjs`)

방법
- 판의 GUI 편집 함수(`gui/build/.../settings-edit.js`의 `applySettingsEdit`)로 다음 설정을 만든다.
- 앞뒤를 CLI의 `parseConfig`로 읽는다.
- 앱 계층의 `wideningOf`로 판정한다.

| 경우(빼기는 둘째 항목) | 결과 |
|---|---|
| 하나뿐인 항목을 뺌(빈 목록) | 넓힘(`unreadable_path_removed`) |
| 다른 두 항목 가운데 하나를 뺌 | 넓힘 |
| `private/sub`만 남기고 `private`를 뺌(좁게) | 넓힘 |
| `private`만 남기고 `private/sub`를 뺌(넓게) | 넓힘(보수적: 링크 때문, 설계 주석대로) |
| 똑같은 중복 `private`를 뺌 | 넓힘 아님 |
| `private`가 남고 `Private`를 뺌(Windows) | 넓힘 아님 |
| `private/`·`./private`·`private\`가 남고 `private`를 뺌 | 넓힘 아님 |
| `..`가 든 항목, 절대 경로를 더함 | 거부(`invalid_config`: 자리와 까닭) |
| k 7→6, 7→지움(기본 5) | 넓힘(`min_group_size_lowered`) |
| k 5→지움 | 넓힘 아님(실행의 k는 그대로 5) |
| k 6→1000 | 넓힘 아님 |
| k 3, 1001 | 거부(`invalid_config`) |
| 정책이 없는 파일에 k나 읽기 제외를 더함 | 넓힘 아님(기본 정책에 그 필드를 더함) |

- "넓힘 아님"인 빼기는 모두 남은 항목이 관문에서 같은 경로를 덮는 경우다.
- 그래서 빼기를 숨기는 길은 찾지 못했다. 빈 목록, 중복, 대소문자, 끝 구분자, 상대 경로 모두 그렇다.
- 같은 판정을 쓰므로 연속 편집으로 나눠도 같다. 예를 들어 `Private`를 먼저 더하고 `private`를 빼면, 덮는 범위가 남아 넓힘이 아니다.

## 3. 9e63369 잠금 이어받기

- 한 일: 같은 작업 공간을 다시 점검하는 동안, 앞 점검이 찾은 "잡힘"을 이어받는다(`checking` + `lockHeld: true`). 그래서 그동안 실행 단추가 켜지지 않는다.
- 새 답이 오면 그 답(`done`, 잡힘 또는 풀림)으로 바뀐다. 다른 작업 공간은 이어받지 않는다. 단위 시험 `u247-lock-recheck`가 이것을 확인한다.
- 실제로 풀린 잠금은, 다시 점검한 답이 오는 순간 풀린 것이 된다. 오류 답(`ok: false`)이면 `error`가 되고 잡힘이 사라진다. 호스트 호출에는 시간 한도(`DOCTOR_TIMEOUT_MS`)가 있어 답이 온다.
- **L-1**은 아래에 적었다.

## 4. 발견

### L-1 (낮음) 다시 점검하던 `doctor` 호출이 거부되면 "잡힘"이 남아 실행 단추가 꺼진 채다

- 곳: `gui/src/renderer/workspace/open-check.ts`의 `run`
  - 이어받은 `checking` + `lockHeld: true`를 먼저 둔다.
  - 그 뒤 `await this.api.doctor(handle)`가 예외로 끝나면 다음 `set`에 가지 않는다.
- 판의 빌드로 재현했다(`.codaryn/r111/probe/lock.mjs`).
  1. 첫 점검 "held" → `done, lockHeld true`
  2. 다시 점검, `doctor`가 reject → `checking, lockHeld true`로 남음(`run`은 예외로 끝남)
  3. 그다음 점검이 오류 답 → `error`
- 영향
  - 2 뒤로는 그 작업 공간을 다시 점검할 때까지 `lockedByOther`가 참이다. 잠금이 실제로 풀렸어도 새 작업 화면의 실행 단추가 꺼져 있다.
  - 9e63369 전에는 같은 경우 `lockHeld`가 남지 않았다.
- 일어날 길: 메인의 처리기 감싸개(`ipc.ts`의 `handle`)는 예외를 잡지 않는다.
  - 그래서 `doctor` 처리기나 호스트 호출이 던지면 렌더러의 invoke가 거부된다.
  - 드물다. 오류 답으로 돌아오는 것이 보통이다.
  - 안전한 쪽(실행 못 함)으로 남고, 화면을 다시 열면 풀린다.
- 제안: `run`에서 `await`을 감싸 거부도 `error` 상태로 두기. 시험에 거부하는 가짜 `doctor` 한 경우를 더하기.

### L-2 (낮음) analyze-private의 "읽기 제외 없음" 경고가, 고른 프로필에 목록이 있어도 "거부된다"고 한다

- 곳: `gui/src/renderer/run/new-task.ts`의 `task.privateNeedsUnreadable`(`role="alert"`)
  - 조건은 설정 자신의 목록이 비었을 때(`view.privateData.unreadablePaths.length === 0`)다.
  - 글은 "analyze-private needs at least one, or the run is refused"다. 괄호에 "(one in the chosen profile does too)"가 있다.
- 사실(이 판의 CLI, 키 없이 마른 실행): 설정에는 없고 프로필 `p`에만 `unreadablePaths`가 있으면, `--profile p --workflow analyze-private`는 해석을 통과한다. 키가 없어 `provider_not_configured`에서 멈췄으니, 거부되지 않는다.
- 그런데 GUI는 그 프로필을 골라도 거부된다는 경보를 띄운다. `ProfileView`에 프로필의 목록이 없어서 알 수 없다.
- task 파일에 목록이 있는 실행도 마찬가지다.
- 제안: 고른 프로필의 목록을 보기에 더해 조건에 넣거나, 글을 "the config file has none; unless the chosen profile or the task file has one, the run is refused"처럼 조건으로 쓰기. 결정은 p5u-gui·문구 담당이다.

### L-3 (낮음) analyze-private의 "명령 규칙" 경고가, 고른 프로필이 정책을 가지면 거짓 경보다

- 곳: 같은 파일의 `task.privateCommands`(`role="alert"`). 조건은 설정에 명령 규칙이 있을 때다.
- 사실(마른 실행)

| 경우 | 결과 |
|---|---|
| 설정의 명령 규칙과 설정의 읽기 제외 | 거부(`invalid_config`, `policy.commands must be empty: the workflow allows no command`) |
| 설정의 명령 규칙과 프로필 `p`의 읽기 제외, `--profile p` | 해석 통과(간편 형식에서 프로필의 정책이 설정의 정책을 대신하므로 설정의 명령 규칙이 걸리지 않음) |
| 같은 설정에 프로필 없이 | 거부(읽기 제외가 없어도 analyze-private는 명령을 허용하지 않음) |

- 그래서 정책을 가진 프로필을 고른 경우 경고는 사실이 아니다.
- 글의 까닭("together with unreadable paths")도 셋째 경우의 실제 까닭(명령을 허용하지 않는 작업 종류)과 다르다.
- 제안: 조건과 글을 프로필을 아는 쪽으로 고치거나, "with the config's policy" 같은 조건을 글에 쓰기.

### 참고

- **I-1**: 설정 화면의 `settings.unreadableCommands`("With these settings runs are refused")는 간편 형식에서 프로필 정책 없이 설정의 정책을 쓰는 실행에만 맞다.
  - task 파일 실행은 자기 정책이 명령을 대신한다. 설정의 읽기 제외는 늘 합쳐진다.
  - 그래서 설정의 명령 규칙이 걸리지 않고, 거부되지 않을 수 있다.
- **I-2**: `settings.minGroupSizeNote`는 "groups of fewer than k rows are not shown"만 말한다. "k칸 미만으로 셈한 값도 빠짐"(U-208 V-19, 끝 요약의 `summary.groups_hidden`이 말하는 것)이 없다.
- **I-3**: 설정 화면의 "Personal data"는 설정 자신의 목록과 k만 보인다. 프로필이나 작업 종류 정의의 목록과 k는 보이지 않는다. 그런 것이 있어도 화면에는 "No unreadable paths."로 보일 수 있다. 편집 범위가 설정뿐인 것은 맞다(U-215).
- 첫 안내 `task.privateNotice`는 사실과 맞다: 읽기 제외 아래 표는 `query_table`의 집계로만, 명령 없음, 끝은 사람 확인.

## 5. 판정 근거로 본 것

- `git diff 01333d18 c522bc86 -- gui`
  - `settings-edit.ts`, `engine-host/settings.ts`, `renderer/settings/settings.ts`
  - `renderer/run/new-task.ts`, `renderer/workspace/open-check.ts`, `renderer/app.ts`
  - i18n
  - 시험 `u247-*`
- 판 안의 다음 파일
  - `gui/src/main/ipc.ts`(`proposeSettings`, `applySettings`, `handle`)
  - `gui/src/main/app.ts`(`confirmWidening`)
  - `src/app/settings-change.ts`(`unreadableWidening`, `wideningOf`, `prepare`, `applySettingsChangeIn`)
- 탐침(커밋하지 않음): `.codaryn/r111/probe/widen.mjs`, `lock.mjs`. 둘 다 판 사본의 빌드를 불러 쓴다.
- 마른 실행(analyze-private와 명령·프로필): 판 사본의 CLI, 키 없음, 네트워크 막음. 설정과 출력은 scratchpad에 두었다가 지웠다.

## 부록: 병합 뒤 `docs/manual-checks.md`에 넣을 글 (준비만, 커밋하지 않음)

### 점검 목록의 두 줄

```
| M-8.4 | GUI에서 analyze-private 고르기: 안내 글과 경고, 거부 까닭 표시 | 없음(뒷부분은 필요) | NVDA는 선택 | U-212, U-247, U-210, R-110 |
| M-8.5 | GUI 설정 화면의 읽기 제외 경로·k 편집과 넓히기 대화상자의 새 두 종류 | 없음 | — | U-204, U-212, U-247, R-7 |
```

### M-8.4에서 바꿀 곳

- 준비의 "읽기 제외 경로가 없어야 한다"는 그대로 둔다.
- 순서 6의 "손으로 더한다. GUI 설정 화면에는 이 칸이 없다"는 바꾼다. 새 글: "설정 화면의 Personal data에서 `private`를 더한다(M-8.5)."
- 기대 결과의 "`analyze-private`를 고르면 안내 글이 사라진다. 이 작업 종류만의 안내는 없다(코드 기준)."를 다음으로 바꾼다.
  - `analyze-private`를 고르면 `analyze` 안내 대신 이 안내가 나온다: `Analysis of personal data (analyze-private): keep the tables with personal data under an unreadable path; the model gets only query_table's groups. This task type cannot use commands, and it ends with a person's review.`
  - 설정에 읽기 제외 경로가 없으면 그 아래에 경고(알림)가 나온다: `The config file has no unreadable path. analyze-private needs at least one, or the run is refused. …`
  - 설정에 명령 규칙이 있으면 경고가 하나 더 나온다: `The config has command rules; together with unreadable paths runs are refused. …`
  - 프로필에만 목록이 있는 경우의 경고(R-111 L-2)는 담당 판단 뒤에 맞춘다.

### M-8.5 전체 (새 글)

```markdown
### M-8.5 GUI 설정 화면의 읽기 제외 경로·k 편집과 넓히기 대화상자 (키 없음)

**확인할 것**
- 설정 화면의 "Personal data (unreadable paths)"에서 읽기 제외 경로를 더하고 빼고, k를 정하고 지울 수 있는지
- 실행이 할 수 있는 일을 넓히는 변경(경로 빼기, k 낮추기·지우기)이 화면의 넓힘 목록과 OS 대화상자에서 그 종류를 말하는지
- 기본 단추가 "Do not write"인지
- 넓히지 않는 변경(더하기, 같은 경로의 다른 철자 빼기, k 올리기)은 묻지 않고 쓰는지

**여기서 못 한 까닭**
- 판정은 앱 계층과 GUI 단위 시험이 확인했다(U-204, U-212, U-247).
- R-111이 판의 함수로 다음 경우의 판정을 쟀다: 빈 목록, 중복, 대소문자, 끝 구분자, `./`, k 지움.
- 실제 OS 대화상자의 모양, 기본 단추, 키 입력, 낭독은 사람이 봐야 한다.

**준비**: 3절의 시험용 설정(`$m\gui-config.json`, `CODARYN_CONFIG`)으로 GUI를 띄운다. 설정 화면을 연다.

**순서**(매번 "See the change"로 제안을 본 뒤 "Write to the config file"을 누른다. 결과는 `Get-Content $m\gui-config.json`으로 본다)
1. 경로 `private`를 더한다.
2. 경로 `Private`를 더한다(Windows: 같은 경로의 다른 철자). 그다음 목록에서 `Private`를 뺀다.
3. 목록에서 `private`를 뺀다. 대화상자에서 Enter, Esc, "Do not write"를 차례로 해 보고, 마지막에 "Write"로 쓴다.
4. k를 7로 정한다. 그다음 6으로 정한다(대화상자에서 "Do not write"). 그다음 "Use the default"를 누른다(대화상자에서 "Write").
5. 잘못된 값을 넣어 본다: 경로 `..\x`, `C:\data`, k 3, k 1001.

**기대 결과**
- 1·2: 넓힘 목록이 없고, 대화상자 없이 쓴다. 2의 빼기도 묻지 않는다. 남은 `private`가 같은 경로를 덮기 때문이다.
- 3
  - 화면의 제안에 `This change lets runs do more. …`와 `an unreadable path removed (the model may read those files) (policy.unreadablePaths)`가 나온다.
  - OS 대화상자
    - 제목: `Codaryn`
    - 글: `This settings change lets runs do more. Write it to the config file?`
    - 자세한 글: 위 종류와 필드. 경로 값은 나오지 않는다.
    - 단추: "Write"와 "Do not write". 기본 단추와 처음 포커스는 "Do not write"다.
  - Enter, Esc, "Do not write"는 쓰지 않는다. 파일은 그대로다.
  - 한국어면 `읽기 제외 경로 뺌(모델이 그 파일을 읽을 수 있게 됨)`이다.
- 4
  - 7은 묻지 않고 쓴다.
  - 6은 `the minimum group size k lowered (…) (policy.minGroupSize)`로 묻는다.
  - "Use the default"(7에서 기본 5로)도 같은 종류로 묻는다.
  - k가 5일 때 "Use the default"는 묻지 않는다(실행의 k가 그대로 5).
- 5: 쓰지 않는다.
  - 경로는 제안이 거부되며 까닭을 보인다: `policy.unreadablePaths[i] must not contain a '..' segment`나 `must be relative to the workspace root`.
  - k 3·1001은 화면이 먼저 막고 경고를 보인다. 제안하지 않는다. 앱 계층도 그런 값을 `policy.minGroupSize must be a whole number from 5 to 1000`으로 거부한다(R-111 탐침).
- 이 화면은 설정 자신의 목록과 k만 보인다. 프로필이나 작업 종류 정의의 것은 보이지 않는다(R-111 I-3).

**다르면 볼 곳**
- `gui/src/renderer/settings/settings.ts`, `gui/src/shared/settings-edit.ts`
- `gui/src/main/ipc.ts`(`applySettings`), `gui/src/main/dialog-texts.ts`
- `src/app/settings-change.ts`(`unreadableWidening`)

**관련**: U-204, U-212, U-215, U-247, R-7, R-111
```

- 위 기대 결과는 R-111 탐침의 판정과 코드에서 읽었다. 대화상자 단추 글("Write", "Do not write")과 화면 단추 글("See the change", "Write to the config file", "Use the default", "Set")은 이 판의 문구다.
