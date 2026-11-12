# R-52 병합 전 보안 검토: 단위 U-21 에이전트의 마지막 답(finalMessage) (w3:p4, 2026-11-13)

## 0. 대상과 방법

- 페르소나: 검증 엔지니어(보안 검토). 읽기 전용이며 파일 수정·커밋은 없다.
  - 이 단위에서 내가 고친 것은 통합 시험의 기대값(`unit/U-21-ne-verify` `65222c2`)뿐이다. src와 gui는 내 코드가 아니다.
- **검토한 판: `pm/unit-U-21` = `4cf605a`**(main `4ad99ba` 위). 비교판은 main `4ad99ba`.
  - src: `src/engine/final-message.ts`(새 파일), `src/engine/index.ts`, `src/cli/human/output.ts`, `src/cli/report.ts`, `src/contracts/engine.ts`, `src/contracts/human.ts`, `src/i18n/*`
  - gui: `gui/src/engine-host/runs.ts`, `report.ts`, `host.ts`, `gui/src/shared/ipc.ts`, `gui/src/renderer/run/run-screen.ts`, `report/report-screen.ts`, `styles.css`
- Codex의 중간 산출물(`codex-verify/.codaryn/r52-*.json`, `r52-probe.mjs`)은 사례를 고르는 데만 참고했다. 아래 결과는 모두 내가 다시 돌린 것이다.
- 사본: `.codaryn/r52/u`(`git archive 4cf605a`), `.codaryn/r52/m`(`git archive 4ad99ba`). 둘 다 `npm run build` 성공. 검토 뒤 지웠다.
- 실험: `.codaryn/r52/r52.mjs`(X, C, D, N, S), `app.mjs`, `x15.mjs`. 로그는 `X.log`, `C.log`, `D.log`, `N.log`, `S.log`, `A.log`, `gui-unit.log`, `smoke.log`.
  - 실제 CLI에 대본(scripted) 실행을 줬다. 대본의 마지막 답을 경우마다 바꿨다. 주소는 쓰지 않았다(링크 흉내 글에 닫힌 포트 `127.0.0.1:9`를 썼을 뿐 접속하지 않음).
  - 앱 계층은 `createCodarynApp`, GUI는 엔진 호스트의 `runResultValue`·`reportValue`와 IPC 검사(`toRunResultView`·`toReportReply`)를 실제 모듈로 불렀다. 표시 거르개는 `gui/src/engine-host/main.ts`와 같게 만들었다.
  - 가릴 값과 키 모양 글은 모두 합성 값이다. 키 모양 글은 스크립트에서 조각을 이어 만들었고, 로그에서는 지웠다.

심각도: 높음, 중간(재현되는 결정 위반, 선행 조건 있음), 낮음, 정보.

## 1. 요약

| 심각도 | 건수 |
| --- | --- |
| 높음 | 0 |
| 중간 | 2 (R52-M1 짧은 가릴 값이 다시 붙어 나간다, R52-M2 줄 바꿈으로 나뉜 키 모양 글이 남는다) |
| 낮음 | 1 (R52-L1 좁은 터미널에서 모델의 글이 줄 머리에 온다) |
| 정보 | 5 (R52-I1~I5) |

| 볼 것 | 결과 |
| --- | --- |
| (1) 가릴 값·키 모양 글이 모든 출구에서 가려지는지 | **대부분 가려진다. 두 가지가 샌다**(R52-M1, M2). |
| | - 등록된 가릴 값(그대로, 또는 ZWSP·소프트 하이픈·단어 결합자·BOM·BEL·ESC·CR·LF로 나뉨), 현재 키 값(그대로·나뉨): 모든 출구에서 토큰 |
| | - 키 모양 글(그대로, ZWSP·ESC로 나뉨): 모든 출구에서 `[key]`. 다만 journal에는 원문이 있다(R52-I1, main과 같음) |
| | - **16 코드 포인트보다 짧은 가릴 값이 보이지 않는 문자로 나뉘면, 처리가 그 문자를 지워 원래 값이 그대로 나간다**(R52-M1) |
| | - **LF·TAB·CRLF로 나뉜 키 모양 글은 처리 뒤에도 나뉜 채 남는다**(R52-M2) |
| (2) 제어 문자·이스케이프·보이지 않는 문자, 2000 상한 | **됨.** 모두 지워진다. 남는 것은 이스케이프 뒤의 보이는 조각(`[2J` 등)뿐이다(R52-I4) |
| | - 2000 상한: 정확히 2000이면 자르지 않고, 2001이면 `truncated: true` |
| | - 자르는 자리에 걸친 가릴 값 토큰과 `[key]`는 통째로 빠진다. 반쪽 토큰과 외톨이 서로게이트는 없다 |
| (3) Codaryn의 줄처럼 보이게 속이기 | **막힌다**(76칸 이상의 터미널). 모델의 모든 줄이 `  | `로 시작하고, 긴 공백은 하나로 줄며, 머리말 흉내도 `  | ` 뒤에 있다. 보고서 Markdown은 더 긴 펜스 안에 둔다. **76칸보다 좁은 터미널은 예외**(R52-L1) |
| (4) GUI | - 렌더러는 `textContent`로만 넣는다(`gui/src/renderer/shell/dom.ts:8`). `innerHTML` 같은 HTML 해석은 `gui/src` 어디에도 없다. CSS `white-space: pre-wrap` |
| | - **유닛 168건 중 168 통과, 연기 시험 178건 중 178 통과(한 번), 앱 종료 0** (`4cf605a`). 연기 시험에 `runFinalMessage` 확인이 있다 |
| | - R52-M1의 짧은 값은 GUI 창에도 그대로 간다. R52-M2의 나뉜 키는 엔진 호스트가 다시 가려 창에는 `[key]`다 |
| (5) 답 없이 끝난 실행 | **필드도 블록도 없다.** 한도, 모델 오류, 모델이 생각하는 중의 취소, 답 뒤에 다시 물은 경우, 공백뿐인 답, `stop: length`, 계획 실행, 적용 실행 |
| | - 답 뒤에 끝난 실행(검증 실패, 검증 중 취소, 검증 중 시간 한도)에는 있다(R52-I3) |
| (6) 답이 없는 실행이 main과 같은지 | **같다.** 다섯 경우 × 두 언어, 그리고 정리 예제의 계획·적용 열 가지 출력 × 두 언어에서 stdout·stderr·result.json·journal의 기록 종류·report 두 가지가 모두 같다(실행 id·시각·소요 시간·임시 폴더 이름·해시만 치환) |

## 2. 중간

### R52-M1 16 코드 포인트보다 짧은 가릴 값이 보이지 않는 문자로 나뉘면, 마지막 답의 처리가 다시 붙여 그대로 내보낸다

- 위치: `src/engine/final-message.ts`의 `finalMessageOf`. 게이트웨이가 가린 글에서 제어·보이지 않는 문자를 **가린 뒤에** 지운다. 그 뒤에 다시 가리지 않는다.
  - 게이트웨이는 16 코드 포인트 이상인 값만 나뉜 꼴로도 찾는다(`src/privacy/index.ts`의 `MIN_SPLIT_MATCH_LENGTH = 16`). 짧은 값은 정확히 같을 때만 가린다(문서화된 규칙).
  - 그래서 `R52<ZWSP>pass` 같은 글은 기록 단계에서 가려지지 않는다. `finalMessageOf`가 ZWSP를 지우면 등록된 값 `R52pass`가 그대로 생긴다.
- 재현(X11, `x15.mjs`, `app.mjs` A2): 대본의 마지막 답에 등록된 7자 값을 가운데 ZWSP를 넣어 쓴다.

  | 출구 | 결과 |
  | --- | --- |
  | `run`의 stdout JSON `finalMessage.text` | **등록된 값 그대로** |
  | `result.json` | **그대로** |
  | `report --json`, `report`(Markdown) | **그대로** |
  | 앱 계층의 실행 결과, `report`, `reportMarkdown` | **그대로** |
  | GUI 엔진 호스트 → IPC → 창(실행 결과, 보고서) | **그대로** |
  | CLI 사람용 끝 요약 | 가려짐(`src/cli/run.ts`가 요약 글을 게이트웨이로 한 번 더 가린다) |
  | journal | ZWSP가 든 꼴 그대로(정확한 값은 없음) |

  - 15자 값도 같다. 16자 값은 게이트웨이가 나뉜 꼴을 찾아 토큰이 된다.
- 영향
  - 가릴 값으로 등록한 것은 기록과 출력에 그 값이 그대로 남지 않게 하려는 것이다. 이 단위 전에는 그 값이 어디에도 정확한 꼴로 없었다. 이제 Codaryn 자신이 만들어 결과 JSON, `result.json`, 보고서, GUI에 싣는다.
  - 선행 조건: 등록된 값이 16 코드 포인트보다 짧고, 모델이 그것을 보이지 않는 문자로 나눠 쓴다(사고이거나 주입된 지시).
- 판단: DR-47의 "가림을 거친다"에 어긋나고 재현된다. 중간.
- 권고(엔진 담당): 보이지 않는 문자를 지운 글을 그 실행의 게이트웨이로 다시 가린다. 또는 지우기를 가리기 전에 한다. 시험에 짧은 값을 ZWSP로 나눈 사례를 더한다.

### R52-M2 LF·TAB·CRLF로 나뉜 키 모양 글이 결과와 끝 요약에 나뉜 채 남는다

- 위치
  - `finalMessageOf`가 LF와 TAB을 남긴 뒤 키 모양(`API_KEY_MASK_PATTERN_SOURCES`)을 찾는다. 그 사이에 LF나 TAB이 낀 키는 맞지 않는다.
  - 사람용 끝 요약과 보고서 Markdown은 `quoteModelText`가 줄마다 먼저 나눈 뒤 가린다. 나뉜 두 조각은 각각 키 모양이 아니다. 그 뒤 쓰기 단계의 `hideKeys`는 두 줄 사이의 `  | `(보이는 글자) 때문에 다시 잇지 못한다.
- 재현(X14, X15, X18, `app.mjs` A4): 대본의 마지막 답에 합성 키 모양 글을 앞 12자 뒤에서 LF로 나눠 쓴다(TAB, CRLF도 같다).

  | 출구 | 결과 |
  | --- | --- |
  | `run`의 stdout JSON, `result.json`, 앱 계층의 실행 결과 | **키가 LF 하나로 나뉜 채 있다** |
  | CLI 사람용 끝 요약 | **두 줄로 나뉘어 보인다**(`  | <앞 12자>` / `  | <나머지>`) |
  | `report`(Markdown), 앱 계층 `reportMarkdown` | **두 줄로 나뉘어 보인다** |
  | `report --json`, 앱 계층 `report` | `[key]` |
  | GUI 창 | `[key]`(엔진 호스트가 글 전체에 다시 `hideKeys`를 건다) |

- 영향
  - DR-40 (a)는 제어 문자로 나뉜 키도 키로 찾기로 정했다. CLI의 다른 출력은 그렇게 한다(`report --json`이 가리는 것이 그 예다). 계약(`EngineResult.finalMessage`)도 키 모양을 `[key]`로 보인다고 한다.
  - 사람이 터미널이나 CI 기록에서 두 줄을 이어 읽으면 키다.
  - 선행 조건: 모델이 키를 줄 바꿈이나 탭으로 나눠 쓴다(작업 공간 파일에서 읽은 키를 줄 맞춰 옮겨 쓰는 경우 등).
- 판단: 재현되는 결정 위반. 중간.
- 권고(엔진·CLI 담당): 키 모양을 찾을 때 LF와 TAB도 건너뛴다(CLI `hideKeys`의 `strippedOf`와 같이). 끝 요약과 보고서는 줄로 나누기 전의 글 전체에 먼저 `hideKeys`를 건다.

## 3. 낮음

### R52-L1 76칸보다 좁은 터미널에서는 모델의 글이 줄 머리에 온다

- 위치: `quoteModelText`는 76칸에서 접는다(`MODEL_TEXT_COLUMNS`). 터미널이 그보다 좁으면 터미널이 한 번 더 접는다.
- 재현(D4): 35자 낱말 뒤에 `Run id: <지어낸 id>`를 둔 답을 40칸으로 접으면 다음처럼 된다.

  ```
    | aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  Run id: 20260101T000000Z-deadbeef
    | bbbbbbbbbbbbbbbbbbbbbbbbbb Report: c
  odaryn report --run
  ```

- 영향: 접힌 줄에는 `  | `가 없어 Codaryn의 "Run id" 줄처럼 보인다. 진짜 줄은 블록 아래에 그대로 있고, 76칸 이상에서는 생기지 않는다.
- 권고: 알려진 한계로 적거나, 터미널 너비(`process.stderr.columns`)가 있으면 그 너비로 접는다.

## 4. 정보

- **R52-I1 journal은 모델 답의 원문을 남긴다.** `model_response.text`에는 등록된 값만 가려지고, 키 모양 글과 제어 문자가 그대로 있다(main과 같다. 예전부터의 기록 방식). `result.json`에는 처리한 글이 있다. journal을 읽어 보이는 출구(`report` 등)는 다시 가린다.
- **R52-I2 서식 문자가 아닌 결합 문자로 나뉜 가릴 값은 모든 출구에서 읽힌다.** 결합 자소 결합자(U+034F, Mn)는 지우지도 건너뛰지도 않는다. journal에도 같은 꼴이 있다(게이트웨이의 규칙, main과 같다).
- **R52-I3 답 뒤에 끝난 실행에는 마지막 답이 있다.** 검증 실패(N3), 검증 중 취소(N8, `cancelled`), 검증 중 시간 한도(N9, `budget-exhausted`/`max_duration`). "마지막 모델 응답이 최종 답이면"이라는 계약과 맞다. 다만 계약의 "(a limit, a model error, a cancel)"은 취소와 한도에는 없다고 읽힐 수 있다. 머리말이 검증된 사실이 아니라고 말한다.
- **R52-I4 이스케이프를 지운 뒤의 보이는 조각이 남는다.** `[2J`, `[1;1H`, `]8;;http://…`처럼 ESC·BEL만 빠진 글이 남는다. 터미널을 움직이지는 못한다.
- **R52-I5 GUI는 맞지 않는 마지막 답이 있으면 결과 화면 전체를 거부한다(코드 읽기).** `toFinalMessage`가 제어·방향 문자를 찾으면 `"bad"`이고, 그러면 실행 결과와 보고서 답이 통째로 실패한다(`gui/src/shared/ipc.ts`). 엔진이 그런 문자를 지우므로 이번 실험에서는 생기지 않았다. 손댄 `result.json`의 보고서는 마지막 답만 빼는 대신 화면이 열리지 않을 수 있다.

## 5. 실험 표

**출구별 가림**(X. RAW: 그대로, readable: 공백·`|`·보이지 않는 문자를 빼면 읽힘, -: 없음)

| 경우 | run JSON | 끝 요약 | result.json | journal | report --json | report | 마지막 답 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 가릴 값 | - | - | - | - | - | - | 토큰 |
| 가릴 값 + ZWSP·SHY·WJ·BOM·BEL·ESC·CR·LF | - | - | - | - | - | - | 토큰 |
| 가릴 값 + CGJ(U+034F) | readable | readable | readable | readable | - | readable | 그대로(R52-I2) |
| **짧은 가릴 값(7자) + ZWSP** | **RAW** | - | **RAW** | readable | **RAW** | **RAW** | **값 그대로**(R52-M1) |
| 짧은 가릴 값(7자) | - | - | - | - | - | - | 토큰 |
| 키 모양 | - | - | - | **RAW** | - | - | `[key]`(R52-I1) |
| **키 모양 + LF·TAB·CRLF** | **readable** | **readable** | **readable** | readable | - | **readable** | 나뉜 채(R52-M2) |
| 키 모양 + ZWSP·ESC | - | - | - | readable(ZWSP)·-(ESC) | - | - | `[key]` |
| 현재 키 값 + ZWSP(키 모양 아님) | - | - | - | - | - | - | 토큰 |

**2000 상한**(C)

| 경우 | truncated | 코드 포인트 | 끝 |
| --- | --- | --- | --- |
| 2000자 | false | 2000 | |
| 2001자 | true | 2000 | |
| 1990자 + 가릴 값 | true | 1990 | 토큰을 통째로 뺌 |
| 1997자 + 공백 + 키 모양 | true | 1998 | `[key]`를 통째로 뺌 |
| 1999자 + 이모지 + 1자 | true | 2000 | 이모지 온전 |
| 이모지 2001개 | true | 2000(UTF-16 4000) | 온전, GUI 검사 통과 |
| 2000자 + 가릴 값 | true | 2000 | 값 없음 |
| 1995자 + ZWSP로 나뉜 긴 가릴 값 | true | 1995 | 토큰을 통째로 뺌 |

- 사람용 끝 요약은 20줄 + `… (+N)` + 잘림 안내 줄이다.

**속이기**(D, 영어·한국어)

| 경우 | 결과 |
| --- | --- |
| 끝 요약의 줄들을 흉내 냄(결과, 검증 통과, Run id, Report, Revert, `codaryn:` 줄) | 모두 `  | ` 뒤. 진짜 안내 줄은 블록 다음에 그대로 |
| 긴 공백·전각 공백·NBSP | 공백 하나로 줄어 한 줄 안 |
| 머리말 흉내 | `  | ` 뒤 |
| `  | `·`… (+99)`로 시작하는 줄 | `  | | …`, `  | … (+99)`(앞에 표시가 붙음) |
| Markdown 펜스·제목·HTML·링크 | 끝 요약은 `  | ` 뒤, 보고서는 다섯 개 백틱 펜스 안. 보고서의 제목 목록에 모델의 `## Verification`이 없다 |
| 40칸·60칸 터미널 | R52-L1 |

**답이 없는 실행**(N)

| 경우 | 상태 | 필드·블록 |
| --- | --- | --- |
| 한도(도구 차례 둘, maxModelTurns 2) | `budget-exhausted`/`max_model_turns` | 없음 |
| 답 뒤 검증 실패 → 다시 물음 → 대본 끝 | `failed`/`model_error` | 없음 |
| 공백뿐인 답, 보이지 않는 문자뿐, 제어 문자뿐 | `done`/`verified` | 없음 |
| `stop: length` | `failed`/`model_error` | 없음 |
| 모델이 생각하는 중 취소(취소 파일) | `cancelled` | 없음 |
| 계획 실행, 적용 실행 | `needs-input`/`plan_pending`, `done`/`verified` | 없음 |
| 답 뒤 검증 실패(수리 없음) | `failed`/`verifier_failed` | 있음(R52-I3) |
| 답 뒤 검증 중 취소 | `cancelled` | 있음(R52-I3) |
| 답 뒤 검증 중 시간 한도 | `budget-exhausted`/`max_duration` | 있음(R52-I3) |

## 6. 검사하지 않은 범위

- 실제 Electron 창(렌더러는 코드와 연기 시험으로 봤다)
- 실제 모델 제공자(anthropic, openai)의 응답. 마지막 답의 처리는 제공자와 무관한 엔진 코드다.
- 취소 사례의 main 비교(S는 동기 실행만 비교했다)
- 루트 유닛·통합 시험 재실행(PM이 이 판에서 잰 수치를 받았다), macOS·Linux

## 7. PM 판단 필요

- **Q-1(R52-M1, M2)**: 병합 전에 고칠지. 둘 다 `finalMessageOf`(엔진)와 끝 요약·보고서의 가림 순서 문제다.
- **Q-2(R52-I3)**: 답 뒤에 취소·한도로 끝난 실행에 마지막 답을 둘지, 계약의 괄호 문구를 바로잡을지.

사용자에게 물을 질문은 없다.
