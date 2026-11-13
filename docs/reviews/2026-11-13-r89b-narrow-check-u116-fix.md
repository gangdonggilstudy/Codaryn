# R-89b 좁은 확인 — U-116 고침(`pm/unit-U-116` = `28fafed`)

- 검토자: w3:p9(p4g-general). 읽기 전용이다.
  - 판과 main `57d0109`을 임시 폴더에 풀어 빌드했고, 작업 트리는 만들지 않았다.
  - 내 U-143 브랜치에 커밋하지 않은 시험 파일이 있으나, 이 확인과 무관하고 건드리지 않았다.
- 판: main `57d0109` + nd-docs `263a56e` + 내 계약 `ba2e949` + na-core `2d187ef`.
- 볼 것(PM): R-89 중간 1(M-1)과 낮음 셋(L-1~L-3)이 닫혔는지, 고침이 새로 연 것이 없는지.
  - 선형 훑기.
  - 줄 상한 100,000자, 대괄호 깊이 32(링크 규칙에만) → 판정 불가.
  - HTML 주석·블록 제외.
  - CR 줄 끝.
  - 취소·시간 상한이 제때 듣는지.
- PM이 받아들인 것: 두 상한 값, "대괄호 상한은 링크 규칙에만", 정확히 1 MiB 한 줄 문서가 판정 불가가 되는 것.
- 도구: R-89의 확인 스크립트(`.codaryn/r89/`)를 그대로 다시 돌렸고, 둘을 더했다.
  - `probe-perf`: 1 MiB 크기, 그리고 상한 밑 줄로 이은 문단 넷.
  - `r89b-dos`: 없는 대상 4만 개, 1 MB 문단.
  - 원출력은 `.codaryn/r89b/`에 둔다.

## 결론(건수)

| 구분 | 건수 | 항목 |
| --- | --- | --- |
| R-89 지적 중 닫힘 | **4/4** | M-1, L-1, L-2, L-3(L-3은 코드로) |
| R-89 참고 중 닫힘 | 1 | I-2(CR 하나인 줄 끝) |
| 고침이 새로 연 결함 | **0** | |
| 남은 어긋남(낮음) | **2** | N-1 계약 문장(내 몫), N-2 목록 이어진 줄의 제목(nd-docs 몫) |
| 받아들인 차이(PM 결정) | 1 | 정확히 1 MiB 한 줄 문서 → 판정 불가 |
| 수치 | | 유닛 3,173건 중 3,168 통과, 실패 0(건너뜀 4, todo 1). 통합 584/584. PM의 수치와 같다 |

## 1. 닫힌 것

### M-1 제곱 시간 — 닫힘

`probe-perf`, 사례마다 자식 프로세스에 30초 제한을 두었다.

| 입력 | R-89(10만 자) | 지금(99,000자) | 지금(30만~100만 자) |
| --- | --- | --- | --- |
| `#` + 공백 + U+2028 | 3.4 s | 1 ms | 1~2 ms, 줄 상한으로 판정 불가 |
| `# a` + 공백 + `#x` | 12.5 s | 2 ms | 같음 |
| 백틱 + U+2028 | 18.7 s | 2 ms | 같음 |
| 닫히지 않은 `[` | 23.8 s | 9 ms | 같음 |
| 한 문단의 링크 | 3.5 s(70만 자) | (줄 상한) | 1~2 ms |
| 겹친 링크 | 8.5 s, `RangeError` | (줄 상한) | 1~2 ms |

상한(100,000자) 밑의 줄 9만 자를 11줄 이어 만든 약 1 MB 문단(링크 읽기와 제목만 읽기, 두 번 읽은 합):

| 문단 | 30만 자 | 100만 자 |
| --- | --- | --- |
| `[` 줄 | 37 ms | 170 ms |
| `[a](b(` 줄 | 162 ms | 714 ms |
| `[a](b)` 줄(링크 14만 개) | 65 ms | 225 ms |
| 깊이 30 겹침 반복(링크 19.8만 개) | 83 ms | 436 ms |

모두 1초 안이다. 크기에 거의 비례한다.

### L-1 HTML 주석·블록 — 닫힘

R-89 확인 75건을 다시 돌렸다. R-89와 다른 것은 5건이고, 모두 의도한 변화다:
- 여러 줄 HTML 주석 안의 `# Hidden`: 제목 아님(예전에는 셈).
- `<div>` 블록 안의 `# Inside div`: 제목 아님.
- 주석 안의 `[x](gone.md)`: 읽지 않음, 링크 규칙 `held`.
- CR 하나인 줄 끝 `# A\r# B`: 제목 둘(I-2 닫힘).
- 정확히 1 MiB 문서(둘째 줄 1,048,572자): 줄 상한으로 판정 불가. PM이 받아들였다.

나머지 69건은 R-89와 같다(제목·링크·근거·범위의 결과와 근거 글 모두).

### L-2 대상 확인 중의 신호 — 닫힘

실제 CLI와 대본 모델로 확인했다(`r89b-dos`).

| 문서 | 경우 | 끝 | 벽시계 | `durationMs` |
| --- | --- | --- | --- | --- |
| R-89의 `[` 15만 개 한 줄 | 상한 10초 | `needs-input`/`verifier_inconclusive`(줄 상한) | 402 ms | 65 |
| 같음 | 5초에 취소 | 같음(취소 전에 끝남) | 416 ms | 69 |
| 없는 대상 4만 개 | 상한 3초 | `budget-exhausted`/`max_duration` | 3,332 ms | 3,005 |
| 같음 | 2.01초에 취소 | `cancelled`/`cancelled` | 2,133 ms | 1,897 |
| 약 1 MB 문단(상한 밑 줄) | 상한 10초 | `done`/`verified` | 345 ms | 129 |

- R-89에서는 상한 10초인 실행이 23.3초에 끝났고, 취소가 21초 늦었다.
- 지금은 상한과 취소가 대상 확인 도중에도 듣는다. 검증기 근거는 "cancelled while the link targets were checked"(판정 불가)다.

### L-3 FIFO — 닫힘(코드로, 이 환경에서 재현 불가)

- `loadMarkdown`이 열기 전에 `stat`으로 일반 파일인지 본다(`src/verify/markdown.ts` 636~637행). 연 뒤 `fstat`으로 다시 본다(653~654행).
- POSIX 시험(`mkfifo`)이 있고, Windows에서는 건너뛴다(`tests/unit/verify/u116-r89-markdown.test.ts` 326행).

### 그 밖에 그대로인 것

- 기존 글자 규칙(`exists`, `absent`, `contains`, `not_contains`):
  - main `57d0109`과 판의 검증기 결과 16줄이 바이트 단위로 같다.
  - 실제 CLI의 `verifiers`, 상태, 종료 코드도 같다.
- R-89 CLI 확인 3/3:
  - 가림: 등록 값이 stdout·상태 디렉터리에 없다.
  - 1 MiB 초과·UTF-8 아님: 판정 불가(종료 3).
  - 형식 검사: `invalid_task`(종료 2).

## 2. 남은 어긋남(낮음 2)

### N-1 (낮음, 계약 — 내 몫) 결과의 한계 문장과 계약 상수가 실제 동작과 다르다

- **실제:** 판의 `file_rules` 결과에 실리는 `limits`(계약 `MARKDOWN_RULE_LIMITS`, 내 `ba2e949`)가 동작과 다른 말을 한다.
  - "a file with a line longer than **10000** characters or brackets nested deeper than 32 is not checked". 실제는 100,000자이고, 대괄호는 링크 규칙에만 적용된다.
  - "indented code blocks and **other HTML are read as ordinary text**". 실제는 HTML 블록(`<div>` 등)도 건너뛴다.
  - "headings inside list items and block quotes do not [count]". 실제는 아래 N-2.
- **같은 이름 상수 두 벌:** 계약 `MAX_MARKDOWN_LINE_CHARS = 10_000`과 `src/verify/markdown.ts:52`의 `MAX_MARKDOWN_LINE_CHARS = 100_000`.
- **근거 글이 계약 머리말과 다르다:** 구현은 nd-docs가 `bca7823` 위에서 고쳤고 내 `ba2e949`를 보지 못했다.

  | 경우 | 계약 `MARKDOWN_EVIDENCE_LEADS` | 구현의 글 |
  | --- | --- | --- |
  | 줄 상한 | `a line longer than 10000 characters, not checked: line N` | `line N is longer than 100000 characters, not read` |
  | 대괄호 깊이 | `brackets nested deeper than 32, not checked: line N` | `brackets nested deeper than 32 levels at line N, not read` |
  | 신호로 멈춤 | 계약에 없음 | `cancelled before the document was read`, `cancelled while the link targets were checked` |

- **고치는 법(U-143, PM 지시대로 U-116 병합 뒤):**
  - 계약을 받아들인 값과 지금 구현의 글에 맞춘다: 100,000, 대괄호는 링크 규칙에만, HTML 블록도 건너뜀, 판정 불가 원인 셋(줄 상한, 대괄호 깊이, 신호), CR 줄 끝.
  - 구현이 계약 상수를 쓰게 할지는 nd-docs와 맞춘다(한 줄씩).
  - 이렇게 하면 구현의 출력 글은 바뀌지 않는다.

### N-2 (낮음, 구현 — nd-docs 몫) 목록 항목의 이어진 줄에 있는 제목을 아직 센다

- **실제:** `- item\n\n  # Inner`에서 `# Inner`를 제목으로 센다(`held`, R-89와 같음).
  - `- # In list`, `> # In quote`, 목록 안 펜스는 세지 않는다(맞음).
- **기대:** PM 결정 "목록·인용 안의 제목은 세지 않는다"(내 `ba2e949`: 항목의 내용 열까지 들여 쓴 줄은 항목의 줄).
- **영향:** 목록 안에 들여 쓴 `#` 줄이 있는 문서가 그 제목으로 통과할 수 있다. 거짓 통과지만 드물고 위험은 작다.
- **고치는 법:** 목록 항목의 내용 열을 기억하고, 그만큼 들여 쓴 줄의 ATX·Setext를 세지 않는다. nd-docs 몫이다. 계약의 정의는 이미 있다.

## 3. 수치

- 판 `28fafed`(임시 폴더에서 빌드): typecheck 0.
  - 유닛 3,173건: 3,168 통과 / 0 실패. 건너뜀 4(원래 3 + POSIX 전용 FIFO 1), todo 1.
  - 통합 584/584. PM의 수치와 같다.
- 확인 스크립트:
  - `probe-judge` 75건: R-89와 69건 같음, 5건은 위의 의도한 변화.
  - `probe-perf` 20사례 × 6크기: 상한 밑은 모두 1초 안.
  - `r89b-dos` 5/5.
  - `r89-literal`: main과 같음.
  - `r89-cli` 3/3.
