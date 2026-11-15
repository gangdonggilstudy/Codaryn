# R-68 병합 전 검토 — 단위 U-50 (도구가 실행되고 실패하면 다음에 할 일을 모델에게 말함, AXM-6)

```
검토자: w3:pA (이 코드의 구현자가 아님). 읽기 전용: 저장소 파일 수정·커밋 없음
대상: pm/unit-U-50 ee32da6 (main 4010905 위). git diff 4010905 ee32da6: 4파일 +155/-3
  src/contracts/tool.ts: TOOL_FAILURE_HINTS, toolFailureMessage
  src/engine/index.ts: 일반 도구와 작업 도구 두 곳에서 실패 메시지에 힌트를 붙인다
결과: 높음 0, 중간 1, 낮음 2, 정보 3
판: git archive로 board = ee32da6, main = 4010905를 .codaryn/r68/에 풀어 빌드했다(둘 다 tsc 0)
실행:
  board 전체 유닛: 2555건 중 통과 2551·실패 0·건너뜀 3·todo 1
  통합: 559/559
  sp0-pins(요청 고정 값): 8/8
  실험 1 r68.test.mjs: 힌트가 붙는 코드를 실제 도구로 일으켰다
    대본 실행 4번, 실패 18건. 두 판에서 기록된 content를 비교했다
  실험 2 R-65의 r65-runs.test.mjs를 두 판에서 다시 돌렸다
    실행 7가지 × 7파일을 글자까지 비교했다
  대본 모델, 합성 값, 네트워크 없음. 실제 API 없음
```

## 판단: M-1을 고친 뒤 병합하기를 권한다

- 비밀이나 기록에 해는 없다.
- 그러나 AXM-6의 목적은 모델에게 맞는 다음 일을 말하는 것이다. `spawn_failed` 힌트는 그 코드가 나는 다섯 까닭 중 넷에서 틀린 일을 시킨다. 둘(c2, c3)에서는 바로 앞의 도구 메시지와도 어긋난다.
- 고치는 것은 작다(아래 권고).
- L-1·L-2도 같은 자리에서 함께 고치면 좋다.

## 중점별 결론

### (1) 붙는 글이 고정 문장뿐인가

**그렇다.**

- 힌트는 `TOOL_FAILURE_HINTS`의 상수뿐이고 `FIXED_MODEL_TEXTS`에 들어 있다.
- 실험 1의 18건 모두, board의 content는 main의 content에 `. ` + 힌트(또는 마침표 뒤 ` ` + 힌트)를 더한 것과 정확히 같다.
- 인자 값, 경로, 파일 내용은 힌트에 섞이지 않는다. 메시지 부분은 main 그대로다.

### (2) 가림 관문을 지나도 그대로인가, 토큰 모양

**그렇다.**

- 힌트는 메시지와 함께 `mask(failedToolContent(…))`를 지난다.
- 등록 값이 힌트의 낱말과 같으면(실험 1 `hintword`: 값 "Nothing") 다른 글과 똑같이 가려진다. 결과는 "`[[CODARYN_SECRET:…]]` is at this path; …"이고, 토큰은 온전하다. 설계대로다.
- 메시지가 토큰으로 끝나는 자리에 마침표가 붙어도 토큰 꼴(`]]`)은 깨지지 않는다.

### (3) 두 번 붙는 경우, 마침표로 끝나는 메시지

**문제 없다.**

- 힌트는 실행기 결과 하나에 한 번만 붙는다(`index.ts:722`, `:949`).
- 같은 id를 되풀이한 호출은 처음 결과를 다시 쓴다. 거부(REFUSAL_HINTS)에는 붙지 않는다.
- 메시지가 마침표로 끝나면 ". ."이 되지 않는다. 이미 힌트로 끝나면 붙이지 않는다. 빈 메시지는 힌트만 쓴다.
- 실험 18건에 ".."이나 같은 힌트 두 번은 없다.

### (4) 힌트가 사실과 맞는가 (실제 도구로 일으킨 18건)

| 호출 | 코드 | 도구 메시지 | 힌트가 참인가 |
| --- | --- | --- | --- |
| r1 없는 파일 읽기 | not_found | cannot read file | 참 |
| r2 **디렉터리**를 read_file | not_text | cannot read file | **거짓**: "The file is not UTF-8 text" (L-1) |
| r3 300 KB 파일 읽기 | too_large | cannot read file | 대체로 참(정보 I-1) |
| r4 NUL이 든 파일 | not_text | | 참 |
| r5 UTF-16 파일 | not_text | | 참 |
| r6 `a.txt/inner.txt`(부모가 파일) | not_found | | 참("Nothing is at this path") |
| w1 **디렉터리**에 write_file | not_text | cannot read current file | **거짓** (L-1) |
| w2 없는 파일에 replace_text | not_found | replace_text needs an existing file | 참 |
| w3 300 KB 파일을 덮어쓰기 | too_large | cannot read current file | 반쯤(정보 I-1) |
| s1 **파일 경로**를 search_files | not_found | cannot list directory | **거짓**: "Nothing is at this path". 파일이 있다 (L-2) |
| s2 없는 디렉터리 검색 | not_found | | 참 |
| c1 없는 실행 파일 | spawn_failed | could not start process (ENOENT) | 참 |
| c2 작업 공간 안의 .cmd(정책은 허용) | spawn_failed | (script_refused) .cmd and .bat files inside the workspace are not run | **거짓**, 메시지와 어긋남 (M-1) |
| c3 밖의 .cmd, 인자 `a b` | spawn_failed | (script_refused) argument 1 has a character outside the set allowed for cmd.exe … | **거짓**, 메시지와 어긋남 (M-1) |
| c4 밖의 .ps1 | spawn_failed | (unsupported_type) only .exe, .com, .cmd and .bat files can be started | **거짓** (M-1) |
| p1 가림 자리가 든 줄을 고침 | protected_span_violation | change rejected | 참 |
| p2 가짜 토큰을 씀 | invalid_token | change rejected | 참 |
| h1 (등록 값이 힌트 낱말) | not_found | | 참(가려짐, 위 (2)) |

- 코드로 본 것(실험하지 않음):
  - `spawn_failed`에는 `executable_refused`(작업 공간 안의 실행 파일)와 `script_refused`(작업 공간 뿌리를 모름) 까닭도 있다(`src/tools/windows-launch.ts:188`, `:197`).
  - 도구 실행기의 `policy_denied`(`path rejected by workspace: <code>`)는 정책 관문이 같은 `workspace.resolve`로 먼저 거른다. 그래서 결정과 실행 사이에 경로가 바뀔 때만 난다. 이번에 일으키지 못했다(정보 I-2).
  - `masking_failed`도 일으키지 못했다. 힌트는 참이다.

### (5) 모델 요청 고정 값과 두 제공자의 요청 꼴

**변화 없다.**

- sp0-pins 8/8. 이 판은 고정 시험 파일을 바꾸지 않았다(바뀐 시험은 `u15-model-feedback.test.ts` 한 단언과 새 `u50-failure-hints.test.ts`).
- Anthropic은 `tool_result.content`에, OpenAI는 `function_call_output.output`에 content 글을 그대로 넣는다(`src/model/anthropic/index.ts:142-145`, `src/model/openai/index.ts:219`). 그래서 꼴은 같고 글만 길어진다.

### (6) 결과 JSON, journal, 사람용 출력

**journal의 `tool_result.content` 말고는 그대로다.**

- 실험 2에서 main과 board의 7가지 실행을 비교했다.
  - stdout JSON, result.json, report 글, report --json, stderr가 모두 같다. stderr에는 U-18 실패 줄과 끝 요약이 들어 있다.
  - 달랐던 것은 실패가 있는 journal 셋과 한국어 stderr 둘의 초 표기뿐이다. 초 표기는 내 정규화가 놓친 것이다.
- content를 읽는 곳은 U-18의 `resultLine`(`src/cli/human/output.ts:166-169`)뿐이다. 그것도 `ok: true`인 `run_command`만 JSON으로 읽는다. 실패한 결과의 content는 읽지 않는다.
- 보고서, GUI 진행 목록(같은 렌더러), 앱 계층은 content를 읽지 않는다.

## 중간

### M-1 spawn_failed 힌트가 다섯 까닭 중 넷에서 틀린 일을 시킨다

- **어디:** `TOOL_FAILURE_HINTS.spawn_failed`("The command could not be started; check that the executable's name is right and that it is installed.")가 `spawn_failed`의 모든 메시지에 붙는다.
- **까닭별로 보면:** `spawn_failed`는 실행 파일이 없을 때(ENOENT)만이 아니라 Windows에서 일부러 거부할 때도 난다(`windows-launch.ts`). 힌트가 맞는 것은 ENOENT 하나뿐이다.
  - 작업 공간 안의 .cmd/.bat나 실행 파일
  - cmd.exe에 넘길 수 없는 인자 글자(공백, 따옴표, `%`, 괄호 …)
  - .exe/.com/.cmd/.bat가 아닌 꼴
  - 작업 공간 뿌리를 모를 때
- **재현:** 실험 1의 c2·c3·c4. 정책이 허용한 명령이다.
  - c2: 메시지는 "작업 공간 안의 .cmd는 실행하지 않는다"인데, 힌트는 "이름이 맞는지, 설치됐는지 보라"다.
  - c3: 메시지는 "인자 1에 허용되지 않은 글자"인데, 힌트는 같은 "이름·설치"다.
- **영향:**
  - 모델이 힌트를 따르면 다른 실행 파일 이름을 시도하거나 설치를 의심한다. 한도 안에서 헛걸음을 한다.
  - Windows에서 npm·npx 같은 .cmd에 공백이 든 인자를 넘기는 일은 흔하다.
  - 비밀이나 기록에는 해가 없다.
- **권고(계약·엔진 담당):** 둘 중 하나.
  - (가) `spawn_failed` 힌트를 ENOENT일 때만 붙인다. 메시지가 `could not start process (ENOENT)`로 시작할 때다. 거부는 메시지가 이미 까닭을 말한다.
  - (나) 코드를 나눈다. 예를 들어 거부를 `spawn_refused`로 두고 힌트를 따로 쓴다.
  - (가)가 작다.

## 낮음

### L-1 디렉터리(파일이 아닌 것)를 read_file·write_file하면 "The file is not UTF-8 text"라고 한다

- **어디:** `workspace.readText`가 `!stat.isFile()`이면 `not_text`를 돌려준다(`src/workspace/workspace.ts:114-115`). 그 위에 `not_text` 힌트가 붙는다.
- **재현:** 실험 1의 r2(read_file `dir1`), w1(write_file `dir1`).
- **영향:** 모델이 디렉터리를 이진 파일로 여길 수 있다. 맞는 다음 일은 `search_files`로 그 안을 보는 것이다.
- **권고:** 둘 중 하나.
  - 힌트를 둘 다에 참인 말로 바꾼다. 예: "The path is not a UTF-8 text file (a directory or binary data), so these tools cannot read or change it."
  - 도구 메시지가 디렉터리라고 말하게 한다.

### L-2 search_files에 파일 경로를 주면 "Nothing is at this path"라고 한다

- **어디:** `workspace.list`가 디렉터리가 아니면 `not_found`를 돌려준다(`workspace.ts:146-148`). 그 위에 `not_found` 힌트가 붙는다.
- **재현:** 실험 1의 s1(`search_files` path `a.txt`). 파일이 있다.
- **영향:** 모델이 있는 파일을 없는 것으로 여길 수 있다.
- **권고:** 둘 중 하나.
  - 힌트를 "Nothing usable is at this path (it is missing, or it is not a directory where one is needed); …"처럼 둘 다에 참이게 한다.
  - `list`가 파일일 때 다른 코드나 메시지를 쓰게 한다.

## 정보 (건수에 넣지 않음)

- **I-1:** `too_large`의 "use a smaller file or directory"는 큰 파일 읽기(r3)에는 대체로 맞다. read_file은 일부만 읽는 선택이 없다. 큰 파일을 덮어쓰려는 write_file(w3)에는 반만 맞다. 지금 파일을 먼저 읽어 스냅샷을 남기기 때문에 거절되며, 모델이 파일을 작게 만들 수는 없다.
- **I-2:** 도구 실행기의 `policy_denied` 힌트는 정책 관문이 같은 경로 판정으로 먼저 거르기 때문에, 결정과 실행 사이에 경로가 바뀔 때만 붙는다. 이번에 일으키지 못했다. 그 경우의 문장 내용(작업 공간 안, 링크를 따른 뒤에도, 기록 폴더 밖)은 `resolve`의 까닭(`outside_root`, 기록 폴더)에는 맞다. `invalid_path`(예: 권한, 이름 꼴)에는 맞지 않을 수 있다.
- **I-3:** 실험 1에는 메시지 부분에 토큰이 든 실패가 없다. 실행기 메시지는 경로를 거의 싣지 않는다. 그래서 "토큰 뒤 마침표"는 코드로 본 것이다.

## PM 질문

- **M-1을 이 단위에서 고칠지:** 고친다면 (가) ENOENT일 때만 붙임, 또는 (나) 코드를 나눔.
  - 가정: (가)로 이 단위에서 고친다. L-1·L-2의 문장도 같은 자리에서 함께 고친다.


---

# R-68b 좁은 확인 — U-50 고친 판

```
검토자: w3:pA. 읽기 전용: 저장소 파일 수정·커밋 없음
대상: pm/unit-U-50 51e1e64 (main 2ee6c0b 위). R-68의 ee32da6 뒤 U-50 수정은 unit/U-50-p4g-general c7c8888 하나
  src/contracts/tool.ts만 바뀌었다(engine은 그대로):
    spawn_failed 힌트를 뺐다
    not_found와 not_text 힌트를 다시 썼다
  그 사이에 main에서 온 다른 단위(U-52, U-53)는 보지 않았다
결과: R-68의 M-1, L-1, L-2 모두 닫힘. 새로 틀린 힌트 없음. 높음 0, 중간 0, 낮음 0, 정보 2
판: git archive로 board = 51e1e64, main = 2ee6c0b를 .codaryn/r68b/에 풀어 빌드(둘 다 tsc 0)
실행:
  R-68의 실험 그대로(.codaryn/r68/r68.test.mjs). 실제 CLI, 대본 모델, 18가지 실패
  두 판의 기록된 content를 비교했다(.codaryn/r68b/r68b-main.txt, r68b-board.txt)
  board의 u50-failure-hints, u15-model-feedback, sp0-pins: 22/22
  대본 모델, 합성 값, 네트워크 없음
```

## 판단: 병합해도 된다

## R-68 결과별

| R-68 | 이 판 | 근거(실험 호출) |
| --- | --- | --- |
| M-1 spawn_failed 힌트가 넷에서 틀림 | **닫힘** | c1(ENOENT), c2(작업 공간 안의 .cmd), c3(cmd.exe가 받지 못하는 인자), c4(.ps1). 넷 모두 content가 main과 같다. 실행기 메시지가 까닭을 말하고, 힌트는 붙지 않는다 |
| L-1 디렉터리에 "The file is not UTF-8 text" | **닫힘** | 새 not_text 힌트: "The path is not a UTF-8 text file: it is a directory, or the file holds binary data or another encoding. These tools cannot read or change it." r2(디렉터리 읽기), w1(디렉터리에 쓰기), r4(NUL), r5(UTF-16) 모두에 맞다 |
| L-2 search_files에 파일 경로를 주면 "Nothing is at this path" | **닫힘** | 새 not_found 힌트: "No entry of the kind this tool needs is at this path: it is missing, or it is a file where a directory is needed. Check the path before you try again." 다섯 경우 모두에 맞다(아래) |

- not_found 다섯 경우:
  - s1: search_files에 파일 경로
  - s2: 없는 디렉터리
  - r1: 없는 파일 읽기
  - r6: `a.txt/inner.txt`(부모가 파일, 그 경로는 없다)
  - w2: 없는 파일에 replace_text

## 새로 틀린 힌트가 없는가

**없다.**

- 18건 가운데 14건은 board content가 main content에 `. ` + 힌트를 더한 것과 정확히 같다. 나머지 4건(spawn_failed)은 main과 같다. 그 밖의 다름은 없다.
- 바뀌지 않은 힌트도 R-68 때와 같이 맞다.
  - too_large: r3, w3
  - protected_span_violation: p1
  - invalid_token: p2
- 새 not_found 힌트는 R-68에서 일으킨 모든 not_found에 참이다.
  - 코드로 본 것: 작업 도구 inspect_files의 "cannot list directory" not_found(없음, `isMissing`)에도 참이다.
- 새 not_text 힌트는 디렉터리·이진·다른 인코딩에 참이다.

## 정보 (건수에 넣지 않음)

- **I-1 (R-68 I-1 그대로):** too_large의 "use a smaller file or directory"는 큰 파일을 덮어쓰려는 write_file(w3)에는 반만 맞다. 지금 파일을 먼저 읽어 스냅샷을 남기기 때문이다.
- **I-2:** `readText`는 `stat`이 파일이 아니면 모두 not_text로 본다. 그래서 디렉터리가 아닌 특수 항목(FIFO, 장치)도 "it is a directory, or the file holds binary data or another encoding"을 받는다. Windows 작업 공간에서는 드물고, 이번에 일으키지 않았다.
- R-68의 다른 중점((1)(2)(3)(5)(6))은 이 수정이 힌트 문장 셋만 바꿨기에 다시 보지 않았다.
  - sp0-pins와 U-15·U-50 시험은 이 판에서 다시 돌렸다(22/22).
  - 가림 실험(h1)은 새 not_found 힌트에 "Nothing"이 없어서 가려진 곳이 없다. 가림 방식은 그대로다.

## PM 질문

없음.
