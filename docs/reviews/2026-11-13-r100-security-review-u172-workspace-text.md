# R-100 보안 검토 — U-172 앱 계층의 작업 공간 텍스트 읽기·쓰기 (`pm/unit-U-172` 9db60f3 = main 07cd600 + `unit/U-172-p5a-adapter` 3616c5b)

- 검토자: nc-human(보안 검토자 페르소나). 읽기 전용이다. 저장소 수정, 커밋, worktree 없음.
- 판을 `git archive`로 스크래치에 풀고 `node_modules`를 junction으로 이어 빌드했다(오류 0). 판의 시험 `u172-workspace-text` 19/19.
- 앱 계층(`createCodarynApp().readWorkspaceText` / `writeWorkspaceText`)을 task 형식 설정으로 직접 불렀다. 임시 폴더(C:, 8.3 짧은 이름이 만들어지는 드라이브), 합성 값, 네트워크 없음.
- 스크립트(스크래치): `C:\Users\gangd\AppData\Local\Temp\claude\21110c3621286809\5b7900db-80c9-408f-9e9b-76ab71d0546a\scratchpad\r100\probe.mjs`(79건), `probe2.mjs`(9건). 출력은 같은 폴더의 `probe-out.txt`, `probe2-out.txt`.
- 시험 설계로 틀린 셋은 다시 돌렸다(`nul.bin`은 Windows 예약 이름이라 파일이 생기지 않았음 → `zero.bin`; 작업 공간 안의 변수 파일·task 파일은 설정 단계가 먼저 거부함).

## 결론

- **높음 0, 중간 0, 낮음 2, 정보 5.** 병합을 막을 결함은 없다.
- 경로 가둠은 정적인 모든 꼴에서 막힌다: `..`, 절대 경로, `\`, `:`(ADS), 상태 디렉터리(대소문자·끝 점·끝 공백·8.3 `CODARY~1`), 장치 이름, 정션, 하드 링크(읽기만, 쓰기 거부).
- 보호 경로는 다른 철자(대소문자, 8.3 `PROTEC~1`)로도 보호된다.
- 쓰기는 잠금 아래에서 새 설정으로 다시 판정한다. 기준 해시와 원자적 쓰기, 줄 끝·BOM 복원이 맞다.
- 돌려주는 글은 가린 글뿐이다. 새 글의 등록 값, 키 모양, 제어 문자는 거부된다.
- 남는 것은 둘이다: 쓰는 도중 정션으로 바꿔치면 밖에 쓰이는 경주(L-1), 풀지 못한 잠금이 이 프로세스가 살아 있는 동안 모든 쓰기와 실행을 막는 것(L-2).

## 항목별 결과

### (1) 경로 가둠 — 정적인 꼴은 모두 막힘, 경주 하나(L-1)

| 꼴 | 결과 |
| --- | --- |
| `../outside.txt`, `C:/x.txt`, `sub\a.txt`, `notes.txt:ads` | `invalid_arguments`(읽기 전에) |
| `.codaryn/…`, `.CODARYN/…`, `.codaryn./…`(끝 점), `.codaryn /…`(끝 공백), `CODARY~1/…`(8.3) | `refused`, 상태 파일 글 없음. 같은 꼴로 쓰기도 열리지 않음(상태 파일 그대로) |
| `notes.txt.`, `notes.txt ` | `refused`(Win32가 끝을 떼는 이름) |
| `NOTES.TXT` | 열림(같은 파일). 쓰기 뒤에도 이름은 `notes.txt` 그대로 |
| 8.3 `LONGFI~1.TXT` | 열림. 쓰기 뒤에도 긴 이름 `longfilename-here.txt` 그대로 |
| `con`, `nul`, `aux.txt`, `com1` | `refused`(멈춤 없음, 100 ms 안) |
| 길 위의 정션(`jdir/…` → 밖) | `refused` |
| 밖의 파일에 이은 하드 링크 | 읽기는 그 글(작업 공간 안의 이름이므로 보통 파일과 같다), 편집 불가(`hard_link`), 쓰기 `not_editable`, 밖의 파일 그대로 |
| 파일 심볼릭 링크 | 이 환경에서 권한 없이 만들 수 없어 보지 못함(lstat 검사는 정션과 같은 길) |
| 보호 경로 `tests/t.txt`, `TESTS/t.txt`, `protected-folder/p.txt`, `PROTECTED-FOLDER/p.txt`, `PROTEC~1/p.txt` | 모두 `protected`, 편집 불가. `tests./t.txt`, `tests /t.txt`는 `refused` |
| 쓰는 도중 정션 바꿔치기 | **밖에 쓰임(L-1)** |

### (2) 잠금 — 다시 판정함, 잠금이 남는 경우 하나(L-2)

- 실행이 잠금을 쥐면 읽기는 `workspace_locked`(편집 불가), 쓰기는 `workspace_locked`이고 파일은 그대로다.
- 읽을 수 없는 잠금, 남은 회수 파일: 쓰기 `workspace_locked`.
- 쓰기는 잠금을 잡은 뒤 파일을 다시 열고, 그때의 설정으로 다시 판정한다.
  - 읽은 뒤 그 파일을 보호 경로로 바꾸면 쓰기가 `not_editable`(`protected`)이다.
- 풀기가 두 번 실패하면 `lockLeft: true`로 알린다. 쓰기 자체는 끝난다. 그 뒤의 일은 L-2.

### (3) 기준 해시, 원자적 쓰기, 줄 끝·BOM — 맞음

- CRLF+BOM 파일
  - 읽기: LF 글, BOM 없음, `lineEnding: "crlf"`, `bom: true`.
  - 쓰기: `\ufeffone\r\ntwo\r\nthree\r\n`으로 둘 다 되돌린다.
- 쓴 뒤 같은 폴더에 임시 파일이 남지 않는다.
- 섞인 줄 끝과 홀로 있는 CR은 편집 불가다.
- 읽은 뒤 파일이 바뀌면 `conflict`이고 파일은 그대로다.
- CR이 든 새 글은 `text_refused`. 같은 글은 `unchanged`.

### (4) 가림 — 맞음

| 꼴 | 결과 |
| --- | --- |
| 등록 값이 든 파일 | 보이는 글 `token [[CODARYN_SECRET:…]] end`, `masked`, 편집 불가 |
| 키 모양이 든 파일 | `key [key]`, 편집 불가 |
| 폭 없는 공백으로 쪼갠 등록 값 | 가린 토큰으로 보이고(합쳐진 값이 안 보임), 편집 불가 |

- 새 글에 넣으면 모두 `text_refused`다(lone surrogate는 `invalid_arguments`). 파일은 그대로였다.
  - 등록 값, 키 모양, 쪼갠 등록 값
  - ESC, RLO, NUL, U+2028
- 모든 결과 JSON에 기반 경로, 등록 값, 키 모양이 없었다.

### (5) 크기와 텍스트 판정 — 맞음

| 꼴 | 결과 |
| --- | --- |
| 262,145바이트 | `too_large` |
| 262,144바이트 | 열림 |
| 새 글이 상한을 넘음 | `text_refused`(`too_large`) |
| NUL 바이트 | `not_text` |
| 잘못된 UTF-8 | `not_text` |

### (6) 오류 글 — 새지 않음

- 결과는 상태 코드, 요청이 준 경로, 다이제스트, 사유 목록뿐이다. 앱 오류 문장은 고정 글이다.
  - 예: "the file could not be read", "the workspace is not an existing directory"

## 낮음

### L-1 쓰는 도중 폴더를 정션으로 바꿔치면 작업 공간 밖에 쓰인다 (TOCTOU)

- **실제**: `writeUnderLock`은 `open`에서 경로의 모든 마디를 `lstat`로 보고(링크면 거부), 판정한 뒤 엔진의 `Workspace.writeText`를 부른다. `writeText`는 해시를 다시 보고, 같은 폴더의 임시 파일을 이름을 바꿔 들인다. 그 사이에 링크를 다시 보지 않는다.
- **재현**:
  - 엔진만: `resolve` 뒤 `sub`를 밖으로 가는 정션으로 바꾸고 `writeText`를 부르면 밖의 `a.txt`가 바뀐다.
  - 앱 계층 쓰기와 경주: 쓰기를 부른 직후 0~7 ms에 `sub`를 바꿔치기를 40회 했다. 38회 바꿔쳤고, **8회는 글이 밖의 파일에 쓰였다**.
- **왜 낮음인가**:
  - 바꿔치는 쪽은 같은 사용자 권한으로 같은 때에 도는 프로그램이어야 한다. 그런 프로그램은 이미 밖에 직접 쓸 수 있다. 권한 경계를 넘지 않는다.
  - 해시 확인이 링크 너머의 파일을 읽으므로, 밖의 대상이 원래 파일과 같은 바이트여야만 쓰인다. 엉뚱한 파일을 덮는 데 쓰기 어렵다.
  - 다만 모듈 주석의 "a link or junction on the way is refused, never followed"는 쓰는 순간까지는 지켜지지 않는다.
- **권고**(p5a-adapter, 엔진 소유자):
  - 엔진 `writeText`가 임시 파일을 쓴 뒤, 이름을 바꾸기 직전에 대상 폴더의 실경로가 열 때와 같은지(또는 마디마다 `lstat`, dev/ino) 다시 본다. 창을 크게 좁힌다. Windows의 Node에는 폴더 손잡이로 쓰는 길이 없어 완전히 닫지는 못한다.
  - 남는 한계를 주석과 설계(text-editing-ux 5절)에 적는다.

### L-2 풀지 못한 잠금은 이 프로세스가 살아 있는 동안 모든 쓰기와 실행을 막는다

- **실제**: 풀기가 두 번 실패하면 `lockLeft: true`를 알린다. 그런데 그 잠금의 주인 pid가 이 앱 프로세스 자신이라, `inspectLock`과 `acquireLock`은 계속 "살아 있는 주인"(`held`)으로 본다.
- **재현**: 실패하는 풀기 hook으로 쓴 뒤 `inspectLock`은 `held`였고, 같은 앱의 다음 쓰기는 `workspace_locked`였다. 실행 시작도 같은 판정을 쓴다.
- **영향**: GUI 앱을 다시 시작할 때까지 그 작업 공간에서 실행, 적용, 되돌리기, 정리, 편집이 모두 막힌다. 앱 안에서 거둘 길이 없다.
- 이것은 PM이 이어서 준 U-176(3)("이 프로세스가 더는 쥐지 않은 자기 pid의 잠금을 거둠")과 같은 문제다. 거기서 store 몫을 다룬다.
- **권고**: U-176 뒤에 쓰기의 `lockLeft`가 사람에게 무엇을 할지(다시 시도 / 앱 다시 시작) 말하게 한다(GUI 몫).

## 정보

- **I-1** `settings_file` 사유는 겹쳐 지키는 몫이다. 작업 공간 안의 task 파일과 변수 파일은 설정 단계가 먼저 `invalid_task` / `invalid_config`로 거부해, 이 경로로는 나오지 않았다.
- **I-2** 가림 토큰처럼 생긴 글(`[[CODARYN_SECRET:…]]`)을 새 글로 쓰면 `text_refused`(`masked`)다. 게이트가 토큰 꼴을 바꾸기 때문이다. 토큰을 흉내 낸 글은 쓸 수 없다. 의도라면 문서에 한 줄 적어 둔다.
- **I-3** 두 줄로 쪼갠 등록 값이 든 파일은 `masked: true`, 편집 불가였다.
- **I-4** 설정 형식은 호출자가 준다(다른 앱 호출과 같다). 등록 값이 없는 설정 형식을 고를 수 있는 쪽은 가리지 않은 글을 읽는다.
  - GUI 호스트가 사람이 고른 설정을 넘기는지는 GUI 연결 단위에서 볼 것이다. 렌더러가 task 경로를 마음대로 정할 수 없게 해야 한다.
- **I-5** 쓰기의 잠금 id는 실행 id 꼴(`createRunId`)이다. 쓰는 동안이나 잠금이 남았을 때 `doctor`와 `--run latest`(`run_in_progress`)는 그것을 실행으로 말한다. 실행 기록은 없다.

## 수치

- `probe.mjs` 79건 중 76 통과: 실패 셋 = L-1(엔진만), 시험 설계 둘(위에서 다시 돔).
- `probe2.mjs` 9건 중 8 통과: 실패 하나 = L-1(앱 계층 경주, 40회 중 8회 밖에 쓰임).
- 판의 `tests/unit/app/u172-workspace-text.test.ts` 19/19.
