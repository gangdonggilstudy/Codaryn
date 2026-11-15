# R-53 병합 전 검토: 단위 U-15 (모델이 받는 것, AXM-5·6·7·16)

```
검토자: w3:p5 (이 단위의 작성자가 아님). 읽기 전용: 저장소 파일 수정·커밋 없음
대상: 고정 판 pm/unit-U-15 8850dfd (main 4ad99ba + unit/U-15-p4g-general + unit/U-15-na-core). 7개 파일
결과: 높음 0, 중간 0, 낮음 2, 참고 6
직접 실행
  - 4ad99ba와 8850dfd를 이 worktree의 .codaryn/r53/{base,u15}에 풀어 빌드: 둘 다 typecheck 0
  - 이 단위의 시험과 고정 시험(u15-model-feedback, g-workflow-tools, sp0 둘, FIXED_MODEL_TEXTS 시험): 8850dfd에서 59/59
  - 유닛·통합 전체는 PM이 이 판에서 잰 수치를 받았고 다시 돌리지 않았다
  - CLI를 프로세스 안에서 돌려 요청 본문을 받았다(.codaryn/r53/capture.mjs)
    - 가짜 서버는 127.0.0.1의 저장소 시험용 가짜(Anthropic, OpenAI)
    - 가짜 키와 가짜 가릴 값만 썼다(secretEnv로 등록, 작업 공간 파일에도 넣음)
    - 실제 API·외부 네트워크 없음
  - 같은 입력을 main과 이 판, 두 제공자에서 돌렸다: 네 경우 × 세 가지(기본, restorePathTokens: true, 계획 실행)
```

## 1. 결론 요약

| 볼 것 | 결과 |
| --- | --- |
| (1) 새 글에 값이 새는가 | **새지 않는다.** 등록된 가릴 값을 인자 값과 모르는 키 이름에 넣어 재현했다. 모델이 받은 글에 값도 키 이름도 없다(2절 표). 힌트는 고정 문장이고 경로·명령·값이 없다 |
| (2) Anthropic 요청에서 지시문 말고 바뀐 것 | **없다.** 요청 4개씩을 맞대었다. 다른 곳은 시스템 글과 실패한 도구 결과의 글뿐이다. 도구 정의, 메시지 구조, 나머지 필드는 바이트로 같다. OpenAI도 같다. `sp0-golden.ts`와 `src/model/**`는 바뀌지 않았다(diff 0줄) |
| (3) 실패 결과의 꼴 | **두 제공자가 같은 글을 받는다.** `error (<code>): <message>`. Anthropic의 `is_error: true`는 그대로다. 두 어댑터 모두 `result.content`를 그대로 보낸다 |
| (4) 지시문 세 줄 | 문장은 분명하다. 그러나 **기존 지시문·작업 종류 지시와 어긋나는 곳이 둘이다**(L-1 계획 실행의 끝, L-2 둘째 줄의 도구) |
| (5) 없는 도구에 돌려주는 목록 | **요청에 실은 도구와 같다.** 계획 실행에서 `write_file`, `run_command`, 지어낸 이름을 불러도 목록은 `read_file, search_files, inspect_files, propose_plan`이다. 요청의 tools도 같은 넷이다. 모델이 준 이름은 되읊지 않는다 |

## 2. 재현: 모델이 받은 결과 글 (8850dfd, Anthropic과 OpenAI 같음)

`<값>`은 등록된 가짜 가릴 값이다. 표는 모델이 받은 글을 그대로 옮긴 것이다.

| 호출 | 모델이 보낸 것 | main 4ad99ba | 8850dfd |
| --- | --- | --- | --- |
| c2 | 없는 도구 `delete_everything` | `unknown tool` | `error (unknown_tool): unknown tool; the tools offered in this run: read_file, search_files, write_file, run_command` |
| c3 | `read_file`에 키 `<값>`, 값 `<값>` | `invalid arguments for this tool` | `error (invalid_args): invalid arguments: unknown field; allowed: path` |
| c4 | `path: 42` | 같은 글 | `… path: required: a non-empty string` |
| c5 | `../outside.txt` | `denied by policy: path/outside_root` | `error (policy_denied): denied by policy: path/outside_root. Paths must stay inside the workspace.` |
| c6 | 없는 파일 | `cannot read file: not_found` | `error (not_found): cannot read file: not_found` |
| c7 | `expectedHash: <값>`, `content: <값>` | `invalid arguments for this tool` | `… expectedHash: required: 64 lowercase hex characters, or null for a new file` |
| c8 | 이 실행이 낸 토큰을 경로에 | `denied by policy: restore/restore_denied` | `… restore/restore_denied. A protected placeholder cannot be used in this field.` |
| c10 | `run_command`의 실행 파일과 인자가 `<값>` | `denied by policy: command/command_not_allowed` | `… command_not_allowed. Only the commands this task allows can be run.` |
| c11 | `change.kind: "rename"`, `to: <값>` | `invalid arguments for this tool` | `… change.kind: must be "replace_all" or "replace_text"` |
| c12 | `search_files`의 `text: 7` | 같은 글 | `… text: must be a string` |

`restorePathTokens: true`에서 토큰을 `text`·`nameContains`에 넣으면 `error (unresolved_token): token not usable in field: text. A protected placeholder cannot be used in this field.`이다. 내지 않은 토큰이면 코드가 `invalid_token`이고 힌트는 `Keep protected placeholders exactly as they were given, or leave them out.`이다. 필드 이름만 나오고 값은 나오지 않는다.

## 3. 낮음

### R53-L1 계획 실행에서 마지막 줄과 작업 종류의 지시가 서로 다른 끝을 말한다

- 위치: `src/engine/index.ts`의 `SYSTEM_PROMPT` 마지막 줄, `src/workflows/index.ts`의 `organize` 지시
- 글
  - 고정 지시문(모든 실행): "When the work is finished, reply without tool calls: what you changed, what you could not do and why, and what the person should check."
  - organize 지시(그 뒤에 붙음): "Propose exactly one plan with propose_plan. You cannot change files yourself."
- 어긋나는 곳
  - 계획 실행은 `propose_plan`을 불러야 끝난다(`endsRun: "plan"`). 도구 없이 답하면 계획이 없다.
  - 대본 모델이 계획 없이 글로 답한 실행은 `failed`로 끝났다(두 판 모두. 이 실패 자체는 전부터의 동작이다).
  - 새 줄은 그 답에 "바꾼 것"을 쓰라고 한다. 계획 실행은 파일을 바꾸지 않는다.
- 근거: AXM-16 개선안이 바로 이 경우를 따로 적었다. "계획 실행에는 둘째 줄 대신 `Put the reason for the plan in propose_plan's summary.`". 이 단위는 그 대체 줄 없이 한 지시문을 모든 실행에 쓴다.
- 영향(추측, 실제 모델은 돌리지 않음): 모델이 계획을 내기 전에 설명하는 답부터 내면 그 실행은 계획 없이 끝난다.
- 권고: 계획 실행(`plan: "apply"`)에는 마지막 줄을 AXM-16의 대체 줄로 바꾼다. 지시문은 PM이 승인한 글이라 바꿀지는 PM이 정한다.

### R53-L2 둘째 줄이 내주지 않은 도구를 말한다

- 둘째 줄 "Use the tools to read, search, change files and run allowed commands."는 그대로다. 새 줄 "Only the tools offered in this run exist."와 한 지시문에 함께 있다.
- 어긋나는 실행
  - 문서·분석 작업: `run_command`가 없다.
  - 정리 작업: `write_file`, `run_command`가 없고, 지시가 "You cannot change files yourself"라고 한다. 둘째 줄의 "change files"와 바로 부딪친다.
- AXM-16의 "빠진 것" 3이 바로 이 줄을 문제로 적었다. 새 줄이 그 답의 절반이고, 둘째 줄은 고치지 않았다.
- 권고: 둘째 줄을 "Use the offered tools to work on the task."처럼 도구를 꼽지 않는 글로 바꾼다(지시문 변경이라 PM 승인).

## 4. 참고 (건수에 넣지 않음)

- **I-1 OpenAI는 모델이 앞서 보낸 호출의 인자를 가리지 않고 되돌려 보낸다(main도 같음, 이 단위와 무관).**
  - 모델이 인자에 등록된 가릴 값을 쓰면, 다음 요청의 `function_call` 항목에 그 값이 그대로 실린다(c3, c7, c10, c11).
  - Anthropic은 같은 호출을 토큰으로 바꿔 보낸다.
  - 원인: `src/model/openai/index.ts` 196~208행이 제공자가 준 출력 항목을 바뀌지 않게 다시 보낸다(SP-D8, 추론 항목 때문).
  - 제공자가 스스로 낸 글을 되돌려 보내는 것이라 제공자에게 새로 알려지는 값은 없다. 그래도 "보내는 글은 모두 가린다"는 성질이 두 제공자에서 다르다. 다른 단위의 재료다.
- **I-2 실행 안의 실패에는 힌트가 없다.** `change rejected: protected_span_violation`(`src/tools/index.ts:379`)은 `error (protected_span_violation): change rejected: protected_span_violation`이 된다.
  - 코드가 두 번 나오고 다음에 할 일은 없다. AXM-6 개선안의 넷째 예시가 이 경우였다.
  - 같은 `invalid_token`도 실행 전 거부에는 힌트가 붙고 이 경로에는 붙지 않는다.
  - 계약(`REFUSAL_HINTS`)이 범위를 정책 거부와 실행 전 자리표시자 거부로 정했으므로 결함으로 세지 않았다.
- **I-3 거부 뒤 힌트와 "A denied tool call is final … Do not try to work around it."은 어긋나지 않는다.**
  - 힌트는 규칙을 말하고 우회하는 법을 말하지 않는다.
  - `invalid_path`의 "Give a relative path inside the workspace with plain names."는 같은 요청을 다시 하라는 뜻으로 읽힐 수 있다. 그래도 고친 호출이 규칙 안이라 우회가 아니다.
- **I-4 인자 오류는 실행 뒤의 인자로도 같은 글이다.** 토큰을 되살린 뒤(`resolved.args`) 다시 검사해 실패하면 그 필드와 규칙만 말한다.
  - 되살린 값은 비지 않은 글이므로, 되살린 값 때문에 규칙이 달라지는 경우를 찾지 못했다(값 길이로 갈리는 규칙은 summary뿐이고 summary는 되살리지 않는다).
  - 그래서 이 글은 값을 맞혀 보는 길이 되지 않는다.
- **I-5 고정 문구.** 새 글(`UNKNOWN_TOOL_LEAD`, `INVALID_ARGS_LEAD`, `ARGS_RULES`, `REFUSAL_HINTS`, `error (`·`): `)이 모두 `FIXED_MODEL_TEXTS`에 들었다. 진짜 게이트웨이로 가려도 토큰이 생기지 않는다는 시험이 통과한다.
- **I-6 도구 목록은 비지 않는다.** task·설정의 `tools`는 비지 않은 배열이어야 한다(`src/cli/task.ts:347`). 그래서 목록이 빈 채 "the tools offered in this run: "로 끝나는 경우는 보통의 실행에서 나오지 않는다.

## 5. 실행 기록

- 판 사본: `.codaryn/r53/base`(4ad99ba), `.codaryn/r53/u15`(8850dfd)
- 스크립트: `.codaryn/r53/capture.mjs`(실행), `results.cjs`(결과 글 비교), `reqdiff.cjs`(요청 본문 비교)
- 출력: `.codaryn/r53/out-*.json`(기본), `rs-*.json`(restorePathTokens), `pl-*.json`(계획 실행). 가짜 값만 들어 있다
